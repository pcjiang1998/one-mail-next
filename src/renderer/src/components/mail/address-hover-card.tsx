import * as React from 'react'
import { Check, UserPlus } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@renderer/components/ui/button'
import { HoverCard, HoverCardContent, HoverCardTrigger } from '@renderer/components/ui/hover-card'
import { parseMailAddresses } from '@renderer/lib/mail-addresses'

export function AddressHoverCard({ value }: { value: string }): React.JSX.Element {
  const [open, setOpen] = React.useState(false)
  const [pending, setPending] = React.useState(false)
  const [saved, setSaved] = React.useState<Set<string>>(new Set())
  const addresses = React.useMemo(() => parseMailAddresses(value), [value])

  async function add(address: { displayName: string; email: string }): Promise<void> {
    setPending(true)
    try {
      await window.api.contacts.addFromAddress(address)
      setSaved((current) => new Set([...current, address.email.toLowerCase()]))
      toast.success('已保存到联系人。')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '添加联系人失败。')
    } finally {
      setPending(false)
    }
  }

  return (
    <HoverCard open={open} onOpenChange={setOpen} openDelay={250} closeDelay={200}>
      <HoverCardTrigger asChild>
        <button
          type="button"
          title={value}
          className="min-w-0 truncate text-left text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
          onClick={() => setOpen((current) => !current)}
        >
          {value}
        </button>
      </HoverCardTrigger>
      <HoverCardContent align="start" className="max-h-80 w-80 max-w-[90vw] overflow-auto">
        {addresses.length === 0 ? <p className="break-words">{value}</p> : null}
        <ul className="divide-y">
          {addresses.map((address, index) => {
            const added = saved.has(address.email.toLowerCase())
            return (
              <li key={`${address.email}-${index}`} className="space-y-2 py-2">
                {address.displayName ? (
                  <p className="break-words font-medium">{address.displayName}</p>
                ) : null}
                <p className="break-all text-xs text-muted-foreground">{address.email}</p>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={pending || added}
                  onClick={() => void add(address)}
                >
                  {added ? <Check /> : <UserPlus />}
                  {added ? '已在联系人中' : '添加到联系人'}
                </Button>
              </li>
            )
          })}
        </ul>
      </HoverCardContent>
    </HoverCard>
  )
}
