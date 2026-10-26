import { getDatabase } from '../connection'
import { getSettings } from './settings.repository'
import { isCacheInUse } from '../../services/cache-activity'
import { validateSyncRanges } from '../../../shared/sync-range'
import type { CacheCleanupInput, CacheCleanupResult } from '../../ipc/types'

export function cleanupMessageCache(
  now = Date.now(),
  expected?: CacheCleanupInput
): CacheCleanupResult {
  const settings = getSettings()
  validateSyncRanges(settings)
  if (
    expected &&
    (expected.cacheRetentionDays !== settings.cacheRetentionDays ||
      expected.cleanupMetadata !== settings.cleanupMetadata)
  ) {
    throw new Error('缓存清理设置已发生变化，请重新打开设置页确认后再清理。')
  }
  const days = settings.cacheRetentionDays
  if (days === 0) throw new Error('本地缓存保留天数为 0，不能清理缓存。')
  const db = getDatabase()
  const cleanupTime = new Date(now).toISOString()
  const result: CacheCleanupResult = {
    days,
    deletedMessages: 0,
    clearedBodies: 0,
    clearedAttachments: 0
  }
  db.exec('BEGIN IMMEDIATE')
  try {
    const rows = db
      .prepare<{ message_id: number; account_id: number }>(
        `SELECT m.message_id, m.account_id FROM onemail_mail_messages m
       WHERE MAX(julianday(COALESCE(m.received_at, m.internal_date, m.created_at)),
                 julianday(COALESCE(m.last_user_accessed_at, m.received_at, m.internal_date, m.created_at))) < julianday(:cleanupTime) - :days
         AND NOT EXISTS (SELECT 1 FROM onemail_tasks t WHERE t.message_id = m.message_id)
         AND NOT EXISTS (
           SELECT 1 FROM onemail_outbox_messages o
           WHERE o.status IN ('draft', 'queued', 'sending', 'failed')
             AND (o.related_message_id = m.message_id OR EXISTS (
               SELECT 1 FROM onemail_outbox_attachments a
               LEFT JOIN onemail_message_attachments source ON source.attachment_id = a.source_attachment_id
               WHERE a.outbox_id = o.outbox_id
                 AND (a.source_message_id = m.message_id OR source.message_id = m.message_id)
             ))
         )
         AND NOT EXISTS (
           SELECT 1 FROM onemail_remote_writebacks w
           WHERE w.message_id = m.message_id AND w.status IN ('queued', 'running', 'failed')
         )
         AND NOT EXISTS (
           SELECT 1 FROM onemail_message_operations op
           WHERE op.message_id = m.message_id AND op.status IN ('pending', 'running', 'failed')
         )
         AND NOT EXISTS (
           SELECT 1 FROM onemail_rule_executions r
           WHERE r.message_id = m.message_id AND r.status IN ('matched', 'failed')
         )`
      )
      .all({ cleanupTime, days })
    for (const row of rows) {
      if (isCacheInUse(row.message_id, row.account_id)) continue
      const params = { messageId: row.message_id }
      result.clearedAttachments += Number(
        db
          .prepare<{ count: number }>(
            `SELECT COUNT(*) AS count FROM onemail_message_attachments a
         WHERE a.message_id = :messageId AND (a.cached_content IS NOT NULL OR EXISTS (
           SELECT 1 FROM onemail_message_bodies b WHERE b.message_id = a.message_id AND b.raw_source IS NOT NULL))`
          )
          .get(params)?.count ?? 0
      )
      result.clearedBodies += db
        .prepare('DELETE FROM onemail_message_bodies WHERE message_id = :messageId')
        .run(params).changes
      db.prepare(
        'UPDATE onemail_message_attachments SET cached_content = NULL WHERE message_id = :messageId'
      ).run(params)
      db.prepare(
        'UPDATE onemail_pop3_messages SET raw_source = NULL WHERE message_id = :messageId'
      ).run(params)
      if (settings.cleanupMetadata) {
        db.prepare('DELETE FROM onemail_message_search WHERE message_id = :messageId').run(params)
        result.deletedMessages += db
          .prepare('DELETE FROM onemail_mail_messages WHERE message_id = :messageId')
          .run(params).changes
      } else {
        db.prepare(
          `UPDATE onemail_message_search SET body_text = '', snippet = subject WHERE message_id = :messageId`
        ).run(params)
        db.prepare(
          `UPDATE onemail_mail_messages SET body_status = 'none', body_error = NULL,
          snippet = COALESCE(subject, '') WHERE message_id = :messageId`
        ).run(params)
      }
    }
    const orphaned = db
      .prepare<{ account_id: number; uidl: string }>(
        `SELECT account_id, uidl FROM onemail_pop3_messages
       WHERE message_id IS NULL AND raw_source IS NOT NULL AND julianday(mail_date) < julianday(:cleanupTime) - :days`
      )
      .all({ cleanupTime, days })
    for (const row of orphaned) {
      if (!isCacheInUse(-1, row.account_id)) {
        db.prepare(
          'UPDATE onemail_pop3_messages SET raw_source = NULL WHERE account_id = :account_id AND uidl = :uidl'
        ).run(row)
      }
    }
    db.exec('COMMIT')
    return result
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
}
