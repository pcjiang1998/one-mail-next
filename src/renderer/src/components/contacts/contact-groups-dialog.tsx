import * as React from 'react'
import { Check, Pencil, Plus, Trash2 } from 'lucide-react'

import type { ContactGroup } from '../../../../shared/types'
import { ResponsiveDialog } from '@renderer/components/responsive-dialog'
import { Button } from '@renderer/components/ui/button'
import { Input } from '@renderer/components/ui/input'

export function ContactGroupsDialog({
  open,
  groups,
  onOpenChange,
  onChanged
}: {
  open: boolean
  groups: ContactGroup[]
  onOpenChange: (open: boolean) => void
  onChanged: () => Promise<void>
}): React.JSX.Element {
  const [name, setName] = React.useState('')
  const [editing, setEditing] = React.useState<ContactGroup | null>(null)
  const [deleting, setDeleting] = React.useState<ContactGroup | null>(null)
  const [pending, setPending] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  async function mutate(operation: () => Promise<unknown>): Promise<void> {
    setPending(true)
    setError(null)
    try {
      await operation()
      setName('')
      setEditing(null)
      setDeleting(null)
      await onChanged()
    } catch (mutationError) {
      setError(mutationError instanceof Error ? mutationError.message : '更新分组失败。')
    } finally {
      setPending(false)
    }
  }

  return (
    <ResponsiveDialog
      open={open}
      onOpenChange={(next) => {
        if (!pending) onOpenChange(next)
      }}
      title="管理联系人分组"
      footer={
        <Button disabled={pending} onClick={() => onOpenChange(false)}>
          完成
        </Button>
      }
    >
      <div className="space-y-3">
        <form
          className="flex gap-2"
          onSubmit={(event) => {
            event.preventDefault()
            void mutate(() => window.api.contacts.saveGroup({ groupId: editing?.groupId, name }))
          }}
        >
          <Input
            aria-label="分组名称"
            placeholder="分组名称"
            maxLength={100}
            value={name}
            disabled={pending}
            onChange={(event) => setName(event.target.value)}
          />
          <Button
            type="submit"
            size="icon"
            disabled={pending || !name.trim()}
            aria-label={editing ? '保存分组名称' : '新建分组'}
            title={editing ? '保存分组名称' : '新建分组'}
          >
            {editing ? <Check /> : <Plus />}
          </Button>
        </form>
        <ul className="max-h-72 divide-y overflow-auto">
          {groups.map((group) => (
            <li key={group.groupId} className="flex min-w-0 items-center gap-2 py-2">
              <span className="min-w-0 flex-1 break-words text-sm">{group.name}</span>
              <Button
                variant="ghost"
                size="icon-sm"
                disabled={pending}
                aria-label={`重命名 ${group.name}`}
                title="重命名分组"
                onClick={() => {
                  setEditing(group)
                  setName(group.name)
                }}
              >
                <Pencil />
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                disabled={pending}
                aria-label={`删除分组 ${group.name}`}
                title="删除分组"
                onClick={() => setDeleting(group)}
              >
                <Trash2 />
              </Button>
            </li>
          ))}
        </ul>
        {deleting ? (
          <div className="space-y-2 border-t pt-3">
            <p className="break-words text-sm">删除分组「{deleting.name}」？联系人会保留。</p>
            <div className="flex justify-end gap-2">
              <Button variant="outline" disabled={pending} onClick={() => setDeleting(null)}>
                取消
              </Button>
              <Button
                variant="destructive"
                disabled={pending}
                onClick={() => void mutate(() => window.api.contacts.deleteGroup(deleting.groupId))}
              >
                删除分组
              </Button>
            </div>
          </div>
        ) : null}
        {error ? (
          <p role="alert" className="text-xs text-destructive">
            {error}
          </p>
        ) : null}
      </div>
    </ResponsiveDialog>
  )
}
