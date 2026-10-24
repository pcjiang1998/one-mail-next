import * as React from 'react'
import { Users } from 'lucide-react'

import type { ContactGroup } from '../../../../shared/types'
import { Button } from '@renderer/components/ui/button'
import { Input } from '@renderer/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@renderer/components/ui/popover'
import { mailboxKey } from '@renderer/lib/mail-addresses'

export function ContactGroupPicker({
  value,
  disabled,
  onChange
}: {
  value: string[]
  disabled?: boolean
  onChange: (value: string[]) => void
}): React.JSX.Element {
  const [open, setOpen] = React.useState(false)
  const [groups, setGroups] = React.useState<ContactGroup[]>([])
  const [search, setSearch] = React.useState('')
  const [loading, setLoading] = React.useState(false)
  const [pending, setPending] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  React.useEffect(() => {
    if (!open) return
    let active = true
    void window.api.contacts
      .listGroups()
      .then(
        (next) => {
          if (active) setGroups(next)
        },
        (loadError) => {
          if (active) setError(loadError instanceof Error ? loadError.message : '加载分组失败。')
        }
      )
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [open])

  async function addGroup(group: ContactGroup): Promise<void> {
    setPending(true)
    setError(null)
    try {
      const contacts = await window.api.contacts.list(undefined, group.groupId)
      const keys = new Set(value.map(mailboxKey))
      const next = [...value]
      for (const contact of contacts) {
        const email = contact.emails.find((item) => item.isDefault)!
        const key = mailboxKey(email.email)
        if (!keys.has(key)) {
          next.push(email.email)
          keys.add(key)
        }
      }
      onChange(next)
      setOpen(false)
    } catch (addError) {
      setError(addError instanceof Error ? addError.message : '添加分组收件人失败。')
    } finally {
      setPending(false)
    }
  }

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        if (pending) return
        setOpen(next)
        if (next) {
          setLoading(true)
          setError(null)
          setSearch('')
        }
      }}
    >
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          disabled={disabled}
          aria-label="按联系人组添加收件人"
          title="按联系人组添加收件人"
        >
          <Users />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="max-w-[90vw]">
        <Input
          aria-label="搜索联系人组"
          placeholder="搜索联系人组"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          disabled={pending}
        />
        {loading ? (
          <p role="status" className="text-xs text-muted-foreground">
            正在加载分组…
          </p>
        ) : null}
        <div className="max-h-56 overflow-auto" aria-label="联系人组">
          {groups
            .filter((group) =>
              group.name.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase())
            )
            .map((group) => (
              <button
                key={group.groupId}
                type="button"
                disabled={pending || loading}
                className="w-full break-words rounded-sm px-2 py-2 text-left text-sm hover:bg-accent focus-visible:outline-ring disabled:opacity-50"
                onClick={() => void addGroup(group)}
              >
                {group.name}
              </button>
            ))}
          {!loading && groups.length === 0 ? (
            <p className="text-xs text-muted-foreground">暂无联系人分组</p>
          ) : null}
        </div>
        {error ? (
          <p role="alert" className="text-xs text-destructive">
            {error}
          </p>
        ) : null}
      </PopoverContent>
    </Popover>
  )
}
