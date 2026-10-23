import * as React from 'react'
import { ArrowLeft, Bell, Check, Clock3, Mail, RefreshCw, Trash2, X } from 'lucide-react'
import { useNavigate } from 'react-router'
import { toast } from 'sonner'

import type { BoardTask, BoardTaskStatus } from '../../../shared/types'
import { ResponsiveDialog } from '@renderer/components/responsive-dialog'
import { Button } from '@renderer/components/ui/button'
import { Checkbox } from '@renderer/components/ui/checkbox'
import { cn } from '@renderer/lib/utils'

const columns: Array<{ status: BoardTaskStatus; label: string; tone: string }> = [
  { status: 'todo', label: '待办', tone: 'border-t-primary' },
  { status: 'in_progress', label: '正在进行', tone: 'border-t-amber-500' },
  { status: 'completed', label: '已完成 / 已取消', tone: 'border-t-emerald-600' }
]

export function BoardPage(): React.JSX.Element {
  const navigate = useNavigate()
  const [tasks, setTasks] = React.useState<BoardTask[]>([])
  const [selected, setSelected] = React.useState<Set<number>>(new Set())
  const [loading, setLoading] = React.useState(true)
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [deleteIds, setDeleteIds] = React.useState<number[] | null>(null)
  const [deleteError, setDeleteError] = React.useState<string | null>(null)
  const [desktopSupported, setDesktopSupported] = React.useState<boolean | null>(null)
  const mounted = React.useRef(false)
  const mutating = React.useRef(false)
  const revision = React.useRef(0)
  const loadRequest = React.useRef(0)

  const applyTasks = React.useCallback((nextTasks: BoardTask[]): void => {
    setTasks(nextTasks)
    const existing = new Set(nextTasks.map((task) => task.taskId))
    setSelected((current) => new Set([...current].filter((id) => existing.has(id))))
  }, [])

  const loadTasks = React.useCallback(async (): Promise<void> => {
    const request = ++loadRequest.current
    const version = revision.current
    setLoading(true)
    setError(null)
    try {
      const nextTasks = await window.api.tasks.list()
      if (mounted.current && request === loadRequest.current && version === revision.current) {
        applyTasks(nextTasks)
      }
    } catch (loadError) {
      if (mounted.current && request === loadRequest.current && version === revision.current) {
        setError(errorMessage(loadError, '加载看板失败，请重试。'))
      }
    } finally {
      if (mounted.current && request === loadRequest.current) setLoading(false)
    }
  }, [applyTasks])

  React.useEffect(() => {
    mounted.current = true
    const unsubscribe = window.api.tasks.onChanged((nextTasks) => {
      if (!mounted.current) return
      revision.current += 1
      setError(null)
      applyTasks(nextTasks)
    })
    void loadTasks()
    void window.api.notifications.status().then(
      (status) => {
        if (mounted.current) setDesktopSupported(status.desktopSupported)
      },
      () => {
        if (mounted.current) setDesktopSupported(null)
      }
    )
    return () => {
      mounted.current = false
      loadRequest.current += 1
      unsubscribe()
    }
  }, [applyTasks, loadTasks])

  async function moveSelected(status: BoardTaskStatus): Promise<void> {
    if (selected.size === 0 || mutating.current) return
    mutating.current = true
    setBusy(true)
    const version = revision.current
    try {
      const nextTasks = await window.api.tasks.updateStatus({ taskIds: [...selected], status })
      if (!mounted.current) return
      if (version === revision.current) applyTasks(nextTasks)
      setSelected(new Set())
      toast.success('已更新任务状态。')
    } catch (updateError) {
      if (mounted.current) toast.error(errorMessage(updateError, '更新任务失败，请重试。'))
    } finally {
      mutating.current = false
      if (mounted.current) setBusy(false)
    }
  }

  async function deleteSelected(): Promise<void> {
    if (!deleteIds?.length || mutating.current) return
    mutating.current = true
    setBusy(true)
    setDeleteError(null)
    try {
      const count = await window.api.tasks.delete(deleteIds)
      if (!mounted.current) return
      const removed = new Set(deleteIds)
      setTasks((current) => current.filter((task) => !removed.has(task.taskId)))
      setSelected((current) => new Set([...current].filter((id) => !removed.has(id))))
      setDeleteIds(null)
      toast.success(`已删除 ${count} 项任务，原邮件不受影响。`)
    } catch (removeError) {
      if (mounted.current) setDeleteError(errorMessage(removeError, '删除任务失败，请重试。'))
    } finally {
      mutating.current = false
      if (mounted.current) setBusy(false)
    }
  }

  function toggleTask(taskId: number): void {
    setSelected((current) => {
      const next = new Set(current)
      if (next.has(taskId)) next.delete(taskId)
      else next.add(taskId)
      return next
    })
  }

  const allSelected = tasks.length > 0 && selected.size === tasks.length
  const actionsDisabled = selected.size === 0 || busy || loading

  return (
    <main className="flex h-screen min-h-0 flex-col bg-background text-foreground">
      <header className="flex shrink-0 items-center gap-2 border-b px-4 py-2">
        <Button variant="ghost" size="icon-sm" aria-label="返回邮箱" onClick={() => navigate('/')}>
          <ArrowLeft />
        </Button>
        <div className="min-w-0 flex-1">
          <h1 className="text-sm font-semibold">看板</h1>
          <p className="text-xs text-muted-foreground">在邮件列表右键菜单中添加待办事项</p>
        </div>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="刷新看板"
          disabled={loading || busy}
          onClick={() => void loadTasks()}
        >
          <RefreshCw className={cn(loading && 'motion-safe:animate-spin')} />
        </Button>
      </header>

      <div
        className="flex shrink-0 flex-wrap items-center gap-2 border-b px-4 py-2"
        aria-label="批量任务操作"
      >
        <label className="mr-2 flex items-center gap-2 text-xs">
          <Checkbox
            checked={allSelected ? true : selected.size > 0 ? 'indeterminate' : false}
            disabled={tasks.length === 0 || busy || loading}
            onCheckedChange={(checked) =>
              setSelected(checked ? new Set(tasks.map((task) => task.taskId)) : new Set())
            }
            aria-label="选择全部任务"
          />
          {selected.size > 0 ? `已选 ${selected.size} 项` : `共 ${tasks.length} 项`}
        </label>
        <Button
          variant="outline"
          size="sm"
          disabled={actionsDisabled}
          onClick={() => void moveSelected('todo')}
        >
          设为待办
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={actionsDisabled}
          onClick={() => void moveSelected('in_progress')}
        >
          设为正在进行
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={actionsDisabled}
          onClick={() => void moveSelected('completed')}
        >
          设为已完成
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={actionsDisabled}
          onClick={() => void moveSelected('cancelled')}
        >
          取消任务
        </Button>
        <Button
          variant="ghost"
          size="sm"
          disabled={actionsDisabled}
          onClick={() => {
            setDeleteError(null)
            setDeleteIds([...selected])
          }}
        >
          <Trash2 data-icon="inline-start" />
          删除任务
        </Button>
      </div>
      <p className="shrink-0 border-b px-4 py-2 text-xs leading-5 text-muted-foreground">
        提醒仅在 OneMail
        运行时发送；完全退出后不会提醒，重启或电脑唤醒后会补发未完成任务的到期提醒。
        {desktopSupported === false ? (
          <span className="ml-1 text-destructive">当前环境不支持系统通知，提醒将保持待通知。</span>
        ) : null}
      </p>
      {error ? (
        <div className="flex items-center gap-2 px-4 py-2 text-sm text-destructive" role="alert">
          <span>{error}</span>
          <Button variant="outline" size="sm" disabled={loading} onClick={() => void loadTasks()}>
            重试
          </Button>
        </div>
      ) : null}
      {loading && tasks.length === 0 ? (
        <p className="px-4 py-2 text-xs text-muted-foreground" role="status">
          正在加载任务…
        </p>
      ) : null}

      <div className="min-h-0 flex-1 overflow-auto bg-muted/20 p-3">
        <div className="grid h-full min-w-[720px] grid-cols-3 gap-3">
          {columns.map((column) => {
            const columnTasks = tasks.filter(
              (task) => (task.status === 'cancelled' ? 'completed' : task.status) === column.status
            )
            return (
              <section
                key={column.status}
                aria-label={column.label}
                className={cn(
                  'flex min-h-0 flex-col overflow-hidden rounded-md border border-t-2 bg-background',
                  column.tone
                )}
              >
                <div className="flex items-center justify-between border-b px-3 py-2">
                  <h2 className="text-sm font-semibold">{column.label}</h2>
                  <span className="text-xs text-muted-foreground">{columnTasks.length}</span>
                </div>
                <div className="min-h-0 flex-1 space-y-2 overflow-auto p-2">
                  {columnTasks.map((task) => (
                    <TaskCard
                      key={task.taskId}
                      task={task}
                      selected={selected.has(task.taskId)}
                      disabled={busy}
                      onToggle={() => toggleTask(task.taskId)}
                      onOpen={() => {
                        if (task.accountId && task.messageId)
                          navigate(`/${task.accountId}/${task.messageId}`)
                      }}
                    />
                  ))}
                  {!loading && columnTasks.length === 0 ? (
                    <p className="p-5 text-center text-xs text-muted-foreground">暂无任务</p>
                  ) : null}
                </div>
              </section>
            )
          })}
        </div>
      </div>

      <ResponsiveDialog
        open={deleteIds !== null}
        onOpenChange={(open) => {
          if (!open && !mutating.current) setDeleteIds(null)
        }}
        title={`删除 ${deleteIds?.length ?? 0} 项任务？`}
        description="任务及其提醒将被永久删除，原邮件不会删除。此操作无法撤销。"
        footer={
          <>
            <Button variant="outline" disabled={busy} onClick={() => setDeleteIds(null)}>
              保留任务
            </Button>
            <Button variant="destructive" disabled={busy} onClick={() => void deleteSelected()}>
              {busy ? '删除中…' : '确认删除'}
            </Button>
          </>
        }
      >
        {deleteError ? (
          <p role="alert" className="text-sm text-destructive">
            {deleteError}
          </p>
        ) : null}
      </ResponsiveDialog>
    </main>
  )
}

function TaskCard({
  task,
  selected,
  disabled,
  onToggle,
  onOpen
}: {
  task: BoardTask
  selected: boolean
  disabled: boolean
  onToggle: () => void
  onOpen: () => void
}): React.JSX.Element {
  const pending = task.reminders.filter((reminder) => reminder.status === 'pending').length
  const fired = task.reminders.filter((reminder) => reminder.status === 'fired').length
  const cancelled = task.reminders.filter((reminder) => reminder.status === 'cancelled').length
  const canOpen = Boolean(task.accountId && task.messageId)
  return (
    <article className={cn('rounded-md border bg-card p-3', selected && 'ring-2 ring-ring')}>
      <div className="flex items-start gap-2">
        <Checkbox
          disabled={disabled}
          checked={selected}
          aria-label={`选择 ${task.subjectSnapshot || '无主题邮件'}`}
          onCheckedChange={onToggle}
        />
        <button
          type="button"
          className="min-w-0 flex-1 rounded-sm text-left outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default"
          disabled={!canOpen}
          aria-label={
            canOpen ? `打开邮件：${task.subjectSnapshot || '无主题邮件'}` : '原邮件已不可用'
          }
          onClick={onOpen}
        >
          <div className="flex items-center gap-1 text-xs text-muted-foreground">
            <Mail className="size-3 shrink-0" />
            <span className="truncate">{task.accountEmail ?? '邮件快照'}</span>
          </div>
          <h3 className="mt-1 line-clamp-2 break-words text-sm font-medium">
            {task.subjectSnapshot || '无主题邮件'}
          </h3>
          <p className="mt-1 truncate text-xs text-muted-foreground">
            {task.senderSnapshot || '未知发件人'}
          </p>
          {!canOpen ? (
            <p className="mt-1 text-xs text-muted-foreground">原邮件已不可用，保留任务快照</p>
          ) : null}
        </button>
      </div>
      {task.note ? (
        <p className="mt-3 whitespace-pre-wrap break-words border-t pt-2 text-xs leading-5 text-muted-foreground">
          {task.note}
        </p>
      ) : null}
      <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        {task.status === 'in_progress' ? (
          <span className="flex items-center gap-1">
            <Clock3 className="size-3" />
            正在进行
          </span>
        ) : null}
        {task.status === 'completed' ? (
          <span className="flex items-center gap-1">
            <Check className="size-3" />
            已完成
          </span>
        ) : null}
        {task.status === 'cancelled' ? (
          <span className="flex items-center gap-1">
            <X className="size-3" />
            已取消
          </span>
        ) : null}
      </div>
      {task.reminders.length > 0 ? (
        <details className="mt-2 text-xs text-muted-foreground">
          <summary className="cursor-pointer rounded-sm leading-5 focus-visible:outline-2 focus-visible:outline-ring">
            <Bell className="mr-1 inline size-3" />
            {[
              pending ? `${pending} 条待通知` : '',
              fired ? `${fired} 条已通知` : '',
              cancelled ? `${cancelled} 条已停止` : ''
            ]
              .filter(Boolean)
              .join('，')}
          </summary>
          <ul className="mt-1 space-y-2 border-l pl-3">
            {task.reminders.map((reminder, index) => (
              <li key={reminder.reminderId ?? index} className="leading-5">
                <time dateTime={reminder.fireAt}>{formatTime(reminder.fireAt)}</time>
                <span className="ml-1">
                  {reminder.status === 'fired'
                    ? '已通知'
                    : reminder.status === 'cancelled'
                      ? '已停止'
                      : '待通知'}
                </span>
                {reminder.firedAt ? <p>通知显示于 {formatTime(reminder.firedAt)}</p> : null}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </article>
  )
}

function formatTime(value: string): string {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '时间无效' : date.toLocaleString()
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback
}
