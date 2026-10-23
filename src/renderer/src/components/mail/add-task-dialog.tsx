import * as React from 'react'
import { Bell, Plus, Trash2 } from 'lucide-react'
import { toast } from 'sonner'

import type { CreateBoardTaskInput } from '../../../../shared/types'
import type { Message } from './types'
import { ResponsiveDialog } from '@renderer/components/responsive-dialog'
import { Button } from '@renderer/components/ui/button'
import { Checkbox } from '@renderer/components/ui/checkbox'
import { Input } from '@renderer/components/ui/input'
import { Textarea } from '@renderer/components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@renderer/components/ui/select'

type ReminderDraft = {
  id: number
  mode: 'relative' | 'absolute'
  days: string
  hours: string
  minutes: string
  absolute: string
}

function newReminder(id: number): ReminderDraft {
  return { id, mode: 'relative', days: '0', hours: '1', minutes: '0', absolute: '' }
}

export function AddTaskDialog({
  message,
  open,
  onOpenChange,
  onCreated
}: {
  message: Message | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreated: () => Promise<void> | void
}): React.JSX.Element {
  const [note, setNote] = React.useState('')
  const [notificationsEnabled, setNotificationsEnabled] = React.useState(true)
  const [reminders, setReminders] = React.useState<ReminderDraft[]>([newReminder(0)])
  const [pending, setPending] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [notificationWarning, setNotificationWarning] = React.useState<string | null>(null)
  const nextReminderId = React.useRef(1)
  const submitting = React.useRef(false)
  const formId = React.useId()

  React.useEffect(() => {
    if (!open) return
    setNote('')
    setNotificationsEnabled(true)
    setReminders([newReminder(nextReminderId.current++)])
    setError(null)
    setNotificationWarning(null)
    let current = true
    void window.api.notifications.status().then(
      (status) => {
        if (current && !status.desktopSupported) {
          setNotificationWarning(
            '当前环境不支持系统通知。仍可保存提醒，但它会保持待通知，不会显示系统通知。'
          )
        }
      },
      () => {
        if (current) setNotificationWarning('无法确认系统通知能力，请检查系统通知设置。')
      }
    )
    return () => {
      current = false
    }
  }, [open, message?.accountId, message?.messageId])

  function updateReminder(id: number, patch: Partial<ReminderDraft>): void {
    setReminders((current) =>
      current.map((item) => (item.id === id ? { ...item, ...patch } : item))
    )
    setError(null)
  }

  function handleOpenChange(nextOpen: boolean): void {
    if (!submitting.current) onOpenChange(nextOpen)
  }

  async function create(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    if (submitting.current || !message) return
    setError(null)
    let input: CreateBoardTaskInput
    try {
      const now = Date.now()
      input = {
        accountId: message.accountId,
        messageId: message.messageId,
        note,
        reminders: notificationsEnabled
          ? reminders.map((reminder, index) => ({ fireAt: reminderTime(reminder, now, index) }))
          : []
      }
    } catch (validationError) {
      setError(validationError instanceof Error ? validationError.message : '请检查提醒时间。')
      return
    }
    submitting.current = true
    setPending(true)
    try {
      await window.api.tasks.createFromMessage(input)
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : '添加看板任务失败，请重试。')
      submitting.current = false
      setPending(false)
      return
    }
    // Refresh failures must not suggest that the committed task was never created.
    submitting.current = false
    setPending(false)
    onOpenChange(false)
    toast.success('已添加到待办。')
    try {
      await onCreated()
    } catch {
      toast.error('任务已创建，但刷新看板失败。请打开看板刷新，不要重复添加。')
    }
  }

  return (
    <ResponsiveDialog
      open={open}
      onOpenChange={handleOpenChange}
      title="添加到看板"
      description={
        message ? `邮件：${message.subject || '无主题'}` : '请先在邮件列表选择一封邮件。'
      }
      contentClassName="sm:max-w-xl"
      bodyClassName="max-h-[65vh] overflow-y-auto"
      footer={
        <div className="flex justify-end gap-2">
          <Button
            type="button"
            variant="outline"
            disabled={pending}
            onClick={() => handleOpenChange(false)}
          >
            取消
          </Button>
          <Button type="submit" form={formId} disabled={!message || pending}>
            {pending ? '添加中…' : '添加到待办'}
          </Button>
        </div>
      }
    >
      <form id={formId} onSubmit={(event) => void create(event)} noValidate>
        <fieldset disabled={pending} className="grid min-w-0 gap-4 p-1">
          <label className="grid gap-1.5 text-xs font-medium">
            邮件备注
            <Textarea
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder="记录这封邮件需要处理的事项（选填）"
              rows={4}
            />
          </label>
          <p className="text-xs text-muted-foreground">
            新任务会添加到「待办」。完成或取消任务后，尚未发送的提醒会停止。
          </p>
          <div className="grid gap-3 rounded-md border bg-card p-3">
            <label className="flex items-center gap-2 text-sm font-medium">
              <Checkbox
                checked={notificationsEnabled}
                onCheckedChange={(checked) => {
                  setNotificationsEnabled(checked === true)
                  setError(null)
                }}
              />
              <Bell className="size-4" />
              通知提醒
            </label>
            {notificationsEnabled ? (
              <div className="grid gap-3">
                {reminders.map((reminder, index) => (
                  <div
                    key={reminder.id}
                    className="grid gap-2 rounded-md border p-3"
                    role="group"
                    aria-label={`第 ${index + 1} 条提醒`}
                  >
                    <div className="flex items-center gap-2">
                      <span className="flex-1 text-xs font-medium">提醒 {index + 1}</span>
                      <Select
                        value={reminder.mode}
                        onValueChange={(value) =>
                          updateReminder(reminder.id, { mode: value as ReminderDraft['mode'] })
                        }
                      >
                        <SelectTrigger className="w-36" aria-label={`第 ${index + 1} 条提醒的方式`}>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="relative">一段时间后</SelectItem>
                          <SelectItem value="absolute">指定时间</SelectItem>
                        </SelectContent>
                      </Select>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-xs"
                        aria-label={`删除第 ${index + 1} 条提醒`}
                        disabled={reminders.length <= 1}
                        onClick={() => {
                          setReminders((current) =>
                            current.filter((item) => item.id !== reminder.id)
                          )
                          setError(null)
                        }}
                      >
                        <Trash2 />
                      </Button>
                    </div>
                    {reminder.mode === 'relative' ? (
                      <div className="grid grid-cols-3 gap-2">
                        <label className="grid gap-1 text-xs text-muted-foreground">
                          天
                          <Input
                            type="number"
                            min={0}
                            step={1}
                            inputMode="numeric"
                            aria-label={`第 ${index + 1} 条提醒的天数`}
                            value={reminder.days}
                            onChange={(event) =>
                              updateReminder(reminder.id, { days: event.target.value })
                            }
                          />
                        </label>
                        <label className="grid gap-1 text-xs text-muted-foreground">
                          小时
                          <Input
                            type="number"
                            min={0}
                            step={1}
                            inputMode="numeric"
                            aria-label={`第 ${index + 1} 条提醒的小时数`}
                            value={reminder.hours}
                            onChange={(event) =>
                              updateReminder(reminder.id, { hours: event.target.value })
                            }
                          />
                        </label>
                        <label className="grid gap-1 text-xs text-muted-foreground">
                          分钟
                          <Input
                            type="number"
                            min={0}
                            step={1}
                            inputMode="numeric"
                            aria-label={`第 ${index + 1} 条提醒的分钟数`}
                            value={reminder.minutes}
                            onChange={(event) =>
                              updateReminder(reminder.id, { minutes: event.target.value })
                            }
                          />
                        </label>
                      </div>
                    ) : (
                      <label className="grid gap-1 text-xs text-muted-foreground">
                        本地日期和时间
                        <Input
                          type="datetime-local"
                          aria-label={`第 ${index + 1} 条提醒的指定时间`}
                          value={reminder.absolute}
                          onChange={(event) =>
                            updateReminder(reminder.id, { absolute: event.target.value })
                          }
                        />
                      </label>
                    )}
                  </div>
                ))}
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    setReminders((current) => [...current, newReminder(nextReminderId.current++)])
                  }
                >
                  <Plus data-icon="inline-start" />
                  添加另一条提醒
                </Button>
                <p className="text-xs leading-5 text-muted-foreground">
                  相对时间从点击「添加到待办」时开始计算；指定时间使用此电脑的本地时区。每条提醒只通知一次。
                </p>
                {notificationWarning ? (
                  <p role="status" className="text-xs leading-5 text-destructive">
                    {notificationWarning}
                  </p>
                ) : null}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">仅保存任务，不创建提醒。</p>
            )}
          </div>
          <p className="text-xs leading-5 text-muted-foreground">
            OneMail
            完全退出后不会提醒。重启或电脑唤醒后，会补发仍待办或正在进行的到期提醒；系统通知权限或免打扰设置可能影响显示。
          </p>
          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          ) : null}
        </fieldset>
      </form>
    </ResponsiveDialog>
  )
}

function reminderTime(reminder: ReminderDraft, now: number, index: number): string {
  const label = `第 ${index + 1} 条提醒`
  let date: Date
  if (reminder.mode === 'absolute') {
    const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(reminder.absolute)
    if (!match) throw new Error(`${label}：请选择完整的日期和时间。`)
    const [year, month, day, hour, minute] = match.slice(1).map(Number)
    date = new Date(year, month - 1, day, hour, minute)
    if (
      year < 1000 ||
      date.getFullYear() !== year ||
      date.getMonth() !== month - 1 ||
      date.getDate() !== day ||
      date.getHours() !== hour ||
      date.getMinutes() !== minute
    )
      throw new Error(`${label}：日期无效或处于夏令时跳过的时段，请重新选择。`)
  } else {
    const fields = [reminder.days, reminder.hours, reminder.minutes]
    if (fields.some((value) => !/^\d+$/.test(value) || !Number.isSafeInteger(Number(value)))) {
      throw new Error(`${label}：天、小时和分钟都必须是非负整数，不能留空。`)
    }
    const [days, hours, minutes] = fields.map(Number)
    const milliseconds = ((days * 24 + hours) * 60 + minutes) * 60_000
    if (milliseconds <= 0) throw new Error(`${label}：请设置大于零的间隔。`)
    if (!Number.isSafeInteger(milliseconds)) throw new Error(`${label}：时间超出可用范围。`)
    date = new Date(now + milliseconds)
  }
  if (!Number.isFinite(date.getTime()) || date.getFullYear() > 9999) {
    throw new Error(`${label}：时间超出可用范围。`)
  }
  if (date.getTime() <= now) throw new Error(`${label}：提醒时间必须晚于当前时间。`)
  return date.toISOString()
}
