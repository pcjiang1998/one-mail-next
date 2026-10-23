import * as React from 'react'
import { AlertTriangle, CheckCircle2, LoaderCircle, RefreshCw, Trash2, X } from 'lucide-react'

import type { RemoteWriteback, WritebackStatus } from '../../../../shared/types'
import { Button } from '@renderer/components/ui/button'
import { cn } from '@renderer/lib/utils'

export function WritebackStatusPanel({
  status,
  onClear,
  onClearCompleted,
  onRetry
}: {
  status: WritebackStatus
  onClear: (writebackId: number) => void
  onClearCompleted: () => void
  onRetry: (writebackId: number) => void
}): React.JSX.Element {
  const [open, setOpen] = React.useState(false)
  const activeCount = status.queuedCount + status.runningCount
  const hasFailure = status.failedCount > 0
  const label =
    activeCount > 0
      ? `正在写回 ${activeCount} 项`
      : hasFailure
        ? `写回失败 ${status.failedCount} 项`
        : '远端写回'

  return (
    <div className="relative">
      <Button
        variant="ghost"
        size="sm"
        className={cn('h-6 gap-1 px-1.5 text-xs', hasFailure && 'text-destructive')}
        onClick={() => setOpen((value) => !value)}
      >
        {activeCount > 0 ? (
          <LoaderCircle className="size-3 animate-spin" />
        ) : hasFailure ? (
          <AlertTriangle className="size-3" />
        ) : (
          <CheckCircle2 className="size-3" />
        )}
        {label}
      </Button>
      {open ? (
        <div className="absolute bottom-8 right-0 z-50 w-[min(520px,calc(100vw-24px))] overflow-hidden rounded-md border bg-popover text-popover-foreground shadow-lg">
          <div className="flex items-center justify-between border-b px-3 py-2">
            <span className="text-xs font-semibold">远端写回状态</span>
            <div className="flex items-center gap-1">
              <Button
                variant="ghost"
                size="sm"
                className="h-6 px-2 text-[11px]"
                onClick={onClearCompleted}
              >
                清除成功/失败
              </Button>
              <Button
                variant="ghost"
                size="icon-xs"
                aria-label="关闭"
                onClick={() => setOpen(false)}
              >
                <X />
              </Button>
            </div>
          </div>
          <div className="max-h-72 overflow-auto">
            {status.items.length === 0 ? (
              <p className="p-5 text-center text-xs text-muted-foreground">暂无写回记录。</p>
            ) : (
              status.items.map((item) => (
                <WritebackRow
                  key={item.writebackId}
                  item={item}
                  onClear={() => onClear(item.writebackId)}
                  onRetry={() => onRetry(item.writebackId)}
                />
              ))
            )}
          </div>
        </div>
      ) : null}
    </div>
  )
}

function WritebackRow({
  item,
  onClear,
  onRetry
}: {
  item: RemoteWriteback
  onClear: () => void
  onRetry: () => void
}): React.JSX.Element {
  const title = item.messageSubject || '无主题邮件'
  const operation =
    item.operationKind === 'mark_read'
      ? '标记已读'
      : item.operationKind === 'mark_unread'
        ? '标记未读'
        : item.operationKind === 'restore'
          ? '恢复邮件'
          : item.operationKind === 'move_to_trash'
            ? '移到已删除'
            : item.operationKind === 'permanent_delete'
              ? '永久删除'
              : item.operationKind === 'mark_answered'
                ? '标记已回复'
                : item.operationKind === 'append_sent'
                  ? '追加到已发送'
                  : item.operationKind === 'smtp_send'
                    ? '发送邮件'
                    : '远端操作'
  const state =
    item.status === 'running'
      ? '执行中'
      : item.status === 'queued'
        ? '排队中'
        : item.status === 'failed'
          ? '失败'
          : item.status === 'cancelled'
            ? '已取消'
            : '成功'
  const canRetry = ['mark_read', 'mark_unread', 'mark_answered'].includes(item.operationKind)
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2 border-b px-3 py-2 last:border-b-0">
      <div className="min-w-0">
        <div className="flex items-center gap-1.5 text-xs">
          <span
            className={cn(
              'size-1.5 rounded-full',
              item.status === 'running'
                ? 'bg-amber-500'
                : item.status === 'queued'
                  ? 'bg-blue-500'
                  : item.status === 'failed'
                    ? 'bg-destructive'
                    : 'bg-emerald-600'
            )}
          />
          <span className="truncate font-medium">{title}</span>
        </div>
        <div className="mt-0.5 truncate text-[11px] text-muted-foreground">
          账号：{item.accountEmail ?? `账号 ${item.accountId}`} · 操作：{operation} · 状态：{state}
          {item.errorMessage ? ` · 原因：${item.errorMessage}` : ''}
          {item.status === 'failed' && !canRetry
            ? ' · 为避免重复发送、移动或删除，不能安全重试'
            : ''}
        </div>
      </div>
      <div className="flex items-center gap-1">
        {item.status === 'failed' && canRetry ? (
          <Button variant="ghost" size="icon-xs" aria-label="重试" onClick={onRetry}>
            <RefreshCw />
          </Button>
        ) : null}
        {item.status !== 'running' && item.status !== 'queued' ? (
          <Button variant="ghost" size="icon-xs" aria-label="清除记录" onClick={onClear}>
            <Trash2 />
          </Button>
        ) : null}
      </div>
    </div>
  )
}
