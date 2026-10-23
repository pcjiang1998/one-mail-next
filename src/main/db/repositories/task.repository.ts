import {
  getDatabase,
  toNumber,
  toOptionalString,
  type SqliteDatabaseSync,
  type SqliteRow
} from '../connection'
import type {
  BoardTask,
  BoardTaskStatus,
  CreateBoardTaskInput,
  TaskReminder
} from '../../../shared/types'

type TaskRow = SqliteRow & {
  task_id: number
  account_id: number
  account_email: string | null
  message_id: number | null
  status: BoardTaskStatus
  note: string
  subject_snapshot: string
  sender_snapshot: string
  created_at: string
  updated_at: string
  completed_at: string | null
}

type ReminderRow = SqliteRow & {
  reminder_id: number
  fire_at: string
  status: TaskReminder['status']
  fired_at: string | null
}

type DueReminderRow = TaskRow & {
  reminder_id: number
  fire_at: string
  reminder_status: TaskReminder['status']
  fired_at: string | null
}

export function listTasks(): BoardTask[] {
  return getDatabase()
    .prepare<TaskRow>(
      `SELECT t.*, a.email AS account_email
       FROM onemail_tasks t
       LEFT JOIN onemail_mail_accounts a ON a.account_id = t.account_id
       ORDER BY CASE t.status WHEN 'todo' THEN 0 WHEN 'in_progress' THEN 1 ELSE 2 END,
                t.updated_at DESC, t.task_id DESC`
    )
    .all()
    .map(mapTaskRow)
}

export function getTask(taskId: number): BoardTask | null {
  assertId(taskId, '任务')
  const row = getDatabase()
    .prepare<TaskRow>(
      `SELECT t.*, a.email AS account_email
       FROM onemail_tasks t
       LEFT JOIN onemail_mail_accounts a ON a.account_id = t.account_id
       WHERE t.task_id = :taskId`
    )
    .get({ taskId })
  return row ? mapTaskRow(row) : null
}

export function createTaskFromMessage(input: CreateBoardTaskInput): BoardTask {
  // IPC and rule actions share this boundary. Validate the entire request before writing anything.
  if (!input || typeof input !== 'object') throw new Error('看板任务参数无效。')
  assertId(input.accountId, '账号')
  assertId(input.messageId, '邮件')
  if (input.note !== undefined && typeof input.note !== 'string') {
    throw new Error('事项说明必须是文本。')
  }
  if (input.reminders !== undefined && !Array.isArray(input.reminders)) {
    throw new Error('提醒列表无效。')
  }
  const now = Date.now()
  const fireTimes = (input.reminders ?? []).map((reminder, index) => {
    if (!reminder || typeof reminder !== 'object') {
      throw new Error(`第 ${index + 1} 条提醒无效。`)
    }
    return validateReminderTime(reminder.fireAt, now, index)
  })

  return transaction((db) => {
    const message = db
      .prepare<{
        account_id: number
        subject: string | null
        from_name: string | null
        from_email: string | null
      }>(
        `SELECT account_id, subject, from_name, from_email
         FROM onemail_mail_messages WHERE message_id = :messageId`
      )
      .get({ messageId: input.messageId })
    if (!message) throw new Error('邮件不存在，无法添加到看板。')
    if (toNumber(message.account_id) !== input.accountId) throw new Error('邮件账号不匹配。')

    const result = db
      .prepare(
        `INSERT INTO onemail_tasks (account_id, message_id, status, note, subject_snapshot, sender_snapshot)
         VALUES (:accountId, :messageId, 'todo', :note, :subjectSnapshot, :senderSnapshot)`
      )
      .run({
        accountId: input.accountId,
        messageId: input.messageId,
        note: input.note?.trim() ?? '',
        subjectSnapshot: message.subject ?? '',
        senderSnapshot: message.from_name || message.from_email || ''
      })
    const taskId = Number(result.lastInsertRowid)
    const insertReminder = db.prepare(
      `INSERT INTO onemail_task_reminders (task_id, fire_at)
       VALUES (:taskId, :fireAt)`
    )
    for (const fireAt of fireTimes) insertReminder.run({ taskId, fireAt })

    const task = getTask(taskId)
    if (!task) throw new Error('创建看板任务失败。')
    return task
  })
}

export function updateTaskStatuses(taskIds: number[], status: BoardTaskStatus): BoardTask[] {
  if (!['todo', 'in_progress', 'completed', 'cancelled'].includes(status)) {
    throw new Error('不支持的任务状态。')
  }
  const ids = validateTaskIds(taskIds)
  return transaction((db) => {
    assertTasksExist(db, ids)
    const updatedAt = new Date().toISOString()
    for (const taskId of ids) {
      db.prepare(
        `UPDATE onemail_tasks
         SET status = :status,
             completed_at = CASE
               WHEN :status IN ('completed', 'cancelled') THEN COALESCE(completed_at, :updatedAt)
               ELSE NULL END,
             updated_at = :updatedAt
         WHERE task_id = :taskId`
      ).run({ taskId, status, updatedAt })
      if (status === 'completed' || status === 'cancelled') {
        db.prepare(
          `UPDATE onemail_task_reminders SET status = 'cancelled'
           WHERE task_id = :taskId AND status = 'pending'`
        ).run({ taskId })
      }
    }
    // Reopening a task never resurrects cancelled or already delivered reminders.
    return listTasks()
  })
}

export function deleteTasks(taskIds: number[]): number {
  const ids = validateTaskIds(taskIds)
  return transaction((db) => {
    assertTasksExist(db, ids)
    let deleted = 0
    for (const taskId of ids) {
      deleted += db
        .prepare('DELETE FROM onemail_tasks WHERE task_id = :taskId')
        .run({ taskId }).changes
    }
    return deleted
  })
}

export function listDueReminders(
  now = new Date().toISOString()
): Array<BoardTask & { reminder: TaskReminder }> {
  const rows = getDatabase()
    .prepare<DueReminderRow>(
      `SELECT t.*, a.email AS account_email, r.reminder_id, r.fire_at,
              r.status AS reminder_status, r.fired_at
       FROM onemail_task_reminders r
       JOIN onemail_tasks t ON t.task_id = r.task_id
       LEFT JOIN onemail_mail_accounts a ON a.account_id = t.account_id
       WHERE r.status = 'pending' AND r.fire_at <= :now
         AND t.status IN ('todo', 'in_progress')
       ORDER BY r.fire_at, r.reminder_id`
    )
    .all({ now })

  return rows.map((row) => ({
    ...mapTaskRow(row),
    reminder: {
      reminderId: toNumber(row.reminder_id),
      fireAt: row.fire_at,
      status: row.reminder_status,
      firedAt: toOptionalString(row.fired_at)
    }
  }))
}

/** Only call after Electron confirms the notification was shown, never merely because it is due. */
export function markReminderFired(reminderId: number, firedAt = new Date().toISOString()): boolean {
  assertId(reminderId, '提醒')
  return (
    getDatabase()
      .prepare(
        `UPDATE onemail_task_reminders
         SET status = 'fired', fired_at = :firedAt
         WHERE reminder_id = :reminderId AND status = 'pending'
           AND EXISTS (
             SELECT 1 FROM onemail_tasks t
             WHERE t.task_id = onemail_task_reminders.task_id
               AND t.status IN ('todo', 'in_progress')
           )`
      )
      .run({ reminderId, firedAt }).changes > 0
  )
}

function mapTaskRow(row: TaskRow): BoardTask {
  const reminders = getDatabase()
    .prepare<ReminderRow>(
      `SELECT reminder_id, fire_at, status, fired_at
       FROM onemail_task_reminders WHERE task_id = :taskId ORDER BY fire_at, reminder_id`
    )
    .all({ taskId: row.task_id })
    .map((reminder) => ({
      reminderId: toNumber(reminder.reminder_id),
      fireAt: reminder.fire_at,
      status: reminder.status,
      firedAt: toOptionalString(reminder.fired_at)
    }))

  return {
    taskId: toNumber(row.task_id),
    accountId: toNumber(row.account_id),
    accountEmail: toOptionalString(row.account_email),
    messageId: row.message_id === null ? undefined : toNumber(row.message_id),
    status: row.status,
    note: row.note,
    subjectSnapshot: row.subject_snapshot,
    senderSnapshot: row.sender_snapshot,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: toOptionalString(row.completed_at),
    reminders
  }
}

function assertId(value: unknown, label: string): asserts value is number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${label}编号无效。`)
  }
}

function validateTaskIds(ids: number[]): number[] {
  if (!Array.isArray(ids) || ids.length === 0) throw new Error('请先选择任务。')
  for (const id of ids) assertId(id, '任务')
  return Array.from(new Set(ids))
}

function assertTasksExist(db: SqliteDatabaseSync, ids: number[]): void {
  const select = db.prepare('SELECT task_id FROM onemail_tasks WHERE task_id = :taskId')
  for (const taskId of ids) {
    if (!select.get({ taskId })) throw new Error('部分任务已不存在，请刷新看板后重试。')
  }
}

function validateReminderTime(value: unknown, now: number, index: number): string {
  const invalid = (): never => {
    throw new Error(`第 ${index + 1} 条提醒的日期无效，请指定包含时区的完整时间。`)
  }
  // Date.parse alone accepts impossible dates such as February 30 and silently normalizes them.
  if (typeof value !== 'string') return invalid()
  const parts =
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?(Z|[+-]\d{2}:\d{2})$/.exec(
      value
    )
  if (!parts) return invalid()
  const [, yearText, monthText, dayText, hourText, minuteText, secondText, , zone] = parts
  const [year, month, day, hour, minute, second] = [
    yearText,
    monthText,
    dayText,
    hourText,
    minuteText,
    secondText ?? '0'
  ].map(Number)
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)
  const daysInMonth = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
  if (
    year < 1 ||
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > daysInMonth[month - 1] ||
    hour > 23 ||
    minute > 59 ||
    second > 59 ||
    (zone !== 'Z' && (Number(zone.slice(1, 3)) > 23 || Number(zone.slice(4)) > 59))
  )
    return invalid()
  const timestamp = Date.parse(value)
  if (!Number.isFinite(timestamp)) return invalid()
  if (timestamp <= now) throw new Error(`第 ${index + 1} 条提醒必须晚于当前时间。`)
  return new Date(timestamp).toISOString()
}

function transaction<T>(operation: (db: SqliteDatabaseSync) => T): T {
  const db = getDatabase()
  // A savepoint also composes with the transaction used by automatic mail rules.
  db.exec('SAVEPOINT onemail_task_write')
  try {
    const result = operation(db)
    db.exec('RELEASE SAVEPOINT onemail_task_write')
    return result
  } catch (error) {
    db.exec('ROLLBACK TO SAVEPOINT onemail_task_write')
    db.exec('RELEASE SAVEPOINT onemail_task_write')
    throw error
  }
}
