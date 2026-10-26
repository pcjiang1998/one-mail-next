import { withDatabaseTask } from '../db/activity'

const messages = new Map<number, number>()
const accounts = new Map<number, number>()

async function track<T>(
  entries: Map<number, number>,
  id: number,
  run: () => Promise<T>
): Promise<T> {
  entries.set(id, (entries.get(id) ?? 0) + 1)
  try {
    return await withDatabaseTask(run)
  } finally {
    const remaining = entries.get(id)! - 1
    if (remaining) entries.set(id, remaining)
    else entries.delete(id)
  }
}

export function withMessageCacheAccess<T>(messageId: number, run: () => Promise<T>): Promise<T> {
  return track(messages, messageId, run)
}

export function withAccountCacheAccess<T>(accountId: number, run: () => Promise<T>): Promise<T> {
  return track(accounts, accountId, run)
}

export function isCacheInUse(messageId: number, accountId: number): boolean {
  return messages.has(messageId) || accounts.has(accountId)
}
