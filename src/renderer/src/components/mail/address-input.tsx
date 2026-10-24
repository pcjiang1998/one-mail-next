import * as React from 'react'
import { X } from 'lucide-react'

import type { Contact } from '../../../../shared/types'
import { Button } from '@renderer/components/ui/button'
import { Input } from '@renderer/components/ui/input'
import { ContactGroupPicker } from './contact-group-picker'
import { mailboxKey } from '@renderer/lib/mail-addresses'
import { useI18n } from '@renderer/lib/i18n'
import { cn } from '@renderer/lib/utils'

type AddressInputProps = {
  id: string
  value: string[]
  placeholder?: string
  disabled?: boolean
  variant?: 'default' | 'ghost'
  className?: string
  onChange: (value: string[]) => void
}

export function AddressInput({
  id,
  value,
  placeholder,
  disabled,
  variant = 'default',
  className,
  onChange
}: AddressInputProps): React.JSX.Element {
  const { t } = useI18n()
  const [draft, setDraft] = React.useState('')
  const [contacts, setContacts] = React.useState<Contact[]>([])
  const [focused, setFocused] = React.useState(false)
  const inputRef = React.useRef<HTMLInputElement>(null)
  const suggestions = React.useMemo(() => {
    const query = draft.trim().toLocaleLowerCase()
    if (!query) return []
    const existing = new Set(value.map(mailboxKey))
    return contacts
      .flatMap((contact) => contact.emails.map((email) => ({ contact, email })))
      .filter(({ contact, email }) => {
        const nameMatches = contact.displayName.toLocaleLowerCase().includes(query)
        return (
          (nameMatches || email.email.toLocaleLowerCase().includes(query)) &&
          !existing.has(email.email.toLowerCase())
        )
      })
      .sort(
        (a, b) =>
          Number(b.email.isDefault) - Number(a.email.isDefault) ||
          a.email.email.localeCompare(b.email.email)
      )
      .slice(0, 8)
  }, [contacts, draft, value])

  React.useEffect(() => {
    if (!focused || !draft.trim()) return
    let active = true
    void window.api.contacts
      .list(draft.trim())
      .then((next) => {
        if (active) setContacts(next)
      })
      .catch(() => {
        if (active) setContacts([])
      })
    return () => {
      active = false
    }
  }, [draft, focused])

  function commitAddress(address: string): void {
    const item = address.trim()
    if (!isMailbox(item)) return
    if (value.some((existing) => mailboxKey(existing) === mailboxKey(item))) {
      setDraft('')
      return
    }
    // One commit action adds one address. Suggestions intentionally never expand a contact.
    onChange([...value, item])
    setDraft('')
  }

  function commitDraft(): void {
    // Pasting a recipient list remains safe, but each entered/selected suggestion is one chip.
    const items = splitAddresses(draft)
    if (items.length === 0) return
    const next = [...value]
    for (const item of items) {
      if (isMailbox(item) && !next.some((existing) => mailboxKey(existing) === mailboxKey(item)))
        next.push(item)
    }
    if (next.length !== value.length) onChange(next)
    setDraft('')
  }

  function removeAddress(address: string): void {
    onChange(value.filter((item) => item !== address))
  }

  return (
    <div
      className={cn(
        'relative flex min-h-8 w-full min-w-0 flex-wrap items-center gap-1.5 px-2 py-1',
        variant === 'default'
          ? 'rounded-lg border border-input bg-background focus-within:ring-2 focus-within:ring-ring/50'
          : 'rounded-none border-0 bg-transparent px-0 py-0 focus-within:ring-0',
        className
      )}
    >
      {value.map((address) => (
        <span
          key={address}
          className="inline-flex max-w-full items-center gap-1 rounded-md bg-muted px-2 py-0.5 text-xs"
        >
          <span className="max-w-48 truncate">{address}</span>
          <Button
            type="button"
            size="icon-xs"
            variant="ghost"
            aria-label={t('common.removeAddress', { address })}
            disabled={disabled}
            onClick={() => removeAddress(address)}
          >
            <X aria-hidden="true" />
          </Button>
        </span>
      ))}
      <Input
        ref={inputRef}
        id={id}
        value={draft}
        disabled={disabled}
        placeholder={value.length === 0 ? placeholder : undefined}
        autoComplete="off"
        className="h-6 min-w-36 flex-1 border-0 bg-transparent px-0 py-0 shadow-none focus-visible:ring-0"
        onChange={(event) => setDraft(event.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => {
          // Let a mouse click on a suggestion run before committing the raw text.
          window.setTimeout(() => {
            setFocused(false)
            commitDraft()
          }, 0)
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ',' || event.key === ';') {
            event.preventDefault()
            if (suggestions[0] && event.key === 'Enter') commitAddress(suggestions[0].email.email)
            else commitDraft()
          }
          if (event.key === 'Backspace' && !draft && value.length > 0) onChange(value.slice(0, -1))
        }}
      />
      <ContactGroupPicker value={value} disabled={disabled} onChange={onChange} />
      {focused && suggestions.length > 0 ? (
        <div
          role="listbox"
          aria-label="联系人邮箱建议"
          className="absolute inset-x-0 top-full z-50 mt-1 max-h-64 overflow-auto rounded-md border bg-popover p-1 text-popover-foreground shadow-md"
        >
          {suggestions.map(({ contact, email }) => (
            <button
              key={`${contact.contactId}-${email.contactEmailId ?? email.email}`}
              type="button"
              role="option"
              className="flex w-full items-start gap-2 rounded-sm px-2 py-1.5 text-left text-sm outline-none hover:bg-accent focus-visible:bg-accent"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => {
                commitAddress(email.email)
                inputRef.current?.focus()
              }}
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate">{contact.displayName || email.email}</span>
                <span className="block truncate text-xs text-muted-foreground">
                  {email.email}
                  {email.label ? ` · ${email.label}` : ''}
                </span>
              </span>
              {email.isDefault ? <span className="text-xs text-muted-foreground">默认</span> : null}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
}

function isMailbox(value: string): boolean {
  return /^[^\s@<>,;]+@[^\s@<>,;]+\.[^\s@<>,;]+$/.test(value)
}

function splitAddresses(value: string): string[] {
  return value
    .split(/[;,]/)
    .map((item) => item.trim())
    .filter(Boolean)
}
