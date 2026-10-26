import { getDatabase } from '../db/connection'
import { normalizeMailDisplayText } from '../../shared/mail-text'

export function persistHeaderAddresses(messageId: number, rawHeader: string): void {
  const unfolded = rawHeader.replace(/\r?\n[ \t]+/g, ' ')
  const db = getDatabase()
  db.prepare(
    `UPDATE onemail_mail_messages SET in_reply_to = :inReplyTo,
    references_header = :referencesHeader WHERE message_id = :messageId`
  ).run({
    messageId,
    inReplyTo: /^in-reply-to:\s*(.*)$/im.exec(unfolded)?.[1]?.trim() ?? null,
    referencesHeader: /^references:\s*(.*)$/im.exec(unfolded)?.[1]?.trim() ?? null
  })
  const insert = db.prepare(`INSERT INTO onemail_message_addresses
    (message_id, kind, name, email, normalized_email, sort_order)
    VALUES (:messageId, :kind, :name, :email, :normalizedEmail, :sortOrder)`)
  db.prepare('DELETE FROM onemail_message_addresses WHERE message_id = :messageId').run({
    messageId
  })
  for (const [field, kind] of [
    ['from', 'from'],
    ['to', 'to'],
    ['cc', 'cc'],
    ['reply-to', 'reply_to']
  ]) {
    const value = new RegExp(`^${field}:\\s*(.*)$`, 'im').exec(unfolded)?.[1]
    const decoded = normalizeMailDisplayText(value)
    if (!decoded) continue
    const addresses = decoded.split(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/)
    addresses.forEach((address, sortOrder) => {
      const match = /^(.*?)<([^>]+)>$/.exec(address.trim())
      const email = (match?.[2] ?? address).trim()
      if (!email) return
      insert.run({
        messageId,
        kind,
        email,
        normalizedEmail: email.toLowerCase(),
        sortOrder,
        name: match?.[1]?.trim().replace(/^"|"$/g, '') || null
      })
    })
  }
}
