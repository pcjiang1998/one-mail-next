import { getDatabase } from '../db/connection'
import { getSettings } from '../db/repositories/settings.repository'
import { syncCutoff } from '../../shared/sync-range'
import { loadMessageBodyFromImap } from './body-loader'

export async function fillMissingMessageBodies(accountId: number): Promise<void> {
  const cutoff = syncCutoff(getSettings().syncBodyWindowDays)
  const rows = getDatabase()
    .prepare<{ message_id: number }>(
      `SELECT m.message_id FROM onemail_mail_messages m
     JOIN onemail_mail_folders f ON f.folder_id = m.folder_id
     LEFT JOIN onemail_message_bodies b ON b.message_id = m.message_id
     WHERE m.account_id = :accountId AND f.sync_enabled = 1
       AND m.remote_missing = 0 AND m.remote_deleted = 0 AND m.user_deleted = 0
       AND julianday(COALESCE(m.received_at, m.internal_date, m.created_at)) >= julianday(:cutoff)
       AND (b.message_id IS NULL OR m.body_status != 'ready')
     ORDER BY COALESCE(m.received_at, m.internal_date, m.created_at) DESC`
    )
    .all({ accountId, cutoff })
  for (const row of rows) await loadMessageBodyFromImap(row.message_id)
}
