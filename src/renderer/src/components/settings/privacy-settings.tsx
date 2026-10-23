import * as React from 'react'
import { ShieldCheck, Trash2, UserPlus } from 'lucide-react'
import { toast } from 'sonner'

import type {
  AccountPrivacyPolicy,
  MailAccount,
  PrivacyMode,
  SettingsUpdateInput
} from '../../../../shared/types'
import { getDefaultPrivacyMode, MAIL_PRIVACY_CHANGED_EVENT } from '../../../../shared/mail-privacy'
import { Button } from '@renderer/components/ui/button'
import { Input } from '@renderer/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@renderer/components/ui/select'

const modeDescriptions: Record<PrivacyMode, string> = {
  unrestricted: '不拦截外部图片和跟踪器；仍会始终执行安全 HTML 净化。',
  loose: '默认加载外部图片，但继续拦截可识别的跟踪器；识别仅为启发式，不能保证拦截全部跟踪器。',
  strict:
    '默认拦截外部图片和跟踪器，可逐封邮件加载普通图片；跟踪器识别仅为启发式，不能保证拦截全部。'
}

export function PrivacySettings({
  onUpdateSettings
}: {
  onUpdateSettings: (input: SettingsUpdateInput) => Promise<void>
}): React.JSX.Element {
  const [defaultMode, setDefaultMode] = React.useState<PrivacyMode>('strict')
  const [policies, setPolicies] = React.useState<AccountPrivacyPolicy[]>([])
  const [accounts, setAccounts] = React.useState<MailAccount[]>([])
  const [error, setError] = React.useState<string>()
  const [trustedValue, setTrustedValue] = React.useState<Record<number, string>>({})
  const [trustedType, setTrustedType] = React.useState<Record<number, 'email' | 'domain'>>({})

  const load = React.useCallback(async (): Promise<void> => {
    const [settings, nextPolicies, nextAccounts] = await Promise.all([
      window.api.settings.get(),
      window.api.privacy.list(),
      window.api.accounts.list()
    ])
    setDefaultMode(getDefaultPrivacyMode(settings))
    setPolicies(nextPolicies)
    setAccounts(nextAccounts)
    setError(undefined)
  }, [])

  React.useEffect(() => {
    // Loading IPC-backed settings is the external synchronization this effect owns.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load().catch((loadError) => {
      const message = loadError instanceof Error ? loadError.message : '加载隐私设置失败。'
      setError(message)
      toast.error(message)
    })
  }, [load])

  async function updateDefaultMode(value: PrivacyMode): Promise<void> {
    const previous = defaultMode
    setDefaultMode(value)
    try {
      await onUpdateSettings({
        privacyDefaultMode: value,
        externalImagesBlocked: value === 'strict'
      })
      await load() // Refresh resolvedMode for every inherited account immediately.
      window.dispatchEvent(new Event(MAIL_PRIVACY_CHANGED_EVENT))
    } catch (updateError) {
      setDefaultMode(previous)
      const message = updateError instanceof Error ? updateError.message : '更新默认隐私策略失败。'
      setError(message)
      toast.error(message)
    }
  }

  async function updateAccountMode(
    accountId: number,
    mode: 'inherit' | PrivacyMode
  ): Promise<void> {
    try {
      const next = await window.api.privacy.update({ accountId, mode })
      setPolicies((current) => current.map((item) => (item.accountId === accountId ? next : item)))
      window.dispatchEvent(new Event(MAIL_PRIVACY_CHANGED_EVENT))
    } catch (updateError) {
      const message = updateError instanceof Error ? updateError.message : '更新邮箱隐私策略失败。'
      setError(message)
      toast.error(message)
    }
  }

  async function addTrusted(policy: AccountPrivacyPolicy): Promise<void> {
    const value = trustedValue[policy.accountId]?.trim()
    if (!value) return
    try {
      const entry = await window.api.privacy.addTrustedSender({
        accountId: policy.accountId,
        matchType: trustedType[policy.accountId] ?? 'email',
        matchValue: value
      })
      setPolicies((current) =>
        current.map((item) =>
          item.accountId === policy.accountId
            ? { ...item, trustedSenders: [...item.trustedSenders, entry] }
            : item
        )
      )
      setTrustedValue((current) => ({ ...current, [policy.accountId]: '' }))
      window.dispatchEvent(new Event(MAIL_PRIVACY_CHANGED_EVENT))
    } catch (addError) {
      const message = addError instanceof Error ? addError.message : '添加可信发件人失败。'
      setError(message)
      toast.error(message)
    }
  }

  async function removeTrusted(
    policy: AccountPrivacyPolicy,
    trustedSenderId: number
  ): Promise<void> {
    try {
      await window.api.privacy.removeTrustedSender(trustedSenderId)
      setPolicies((current) =>
        current.map((item) =>
          item.accountId === policy.accountId
            ? {
                ...item,
                trustedSenders: item.trustedSenders.filter(
                  (entry) => entry.trustedSenderId !== trustedSenderId
                )
              }
            : item
        )
      )
      window.dispatchEvent(new Event(MAIL_PRIVACY_CHANGED_EVENT))
    } catch (removeError) {
      const message = removeError instanceof Error ? removeError.message : '删除可信发件人失败。'
      setError(message)
      toast.error(message)
    }
  }

  return (
    <section
      className="flex min-h-full flex-col bg-background text-foreground"
      aria-label="远程内容隐私"
    >
      <header className="flex h-12 shrink-0 items-center gap-2 border-b px-4">
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold">远程内容隐私</h2>
          <p className="text-xs text-muted-foreground">
            控制外部图片和跟踪器在每个邮箱中的加载方式
          </p>
        </div>
      </header>
      <div className="min-h-0 flex-1 overflow-auto">
        <div className="mx-auto flex w-full max-w-4xl flex-col gap-5 p-5">
          <section className="rounded-md border bg-card p-4">
            <div className="flex items-start gap-3">
              <div className="flex size-8 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
                <ShieldCheck className="size-4" />
              </div>
              <div className="min-w-0 flex-1">
                <h2 className="text-sm font-semibold">默认远程内容策略</h2>
                <p className="mt-1 max-w-2xl text-xs leading-5 text-muted-foreground">
                  默认策略会应用到没有单独设置的邮箱。HTML
                  安全净化始终保留，策略只控制外部图片和跟踪器。跟踪器识别是启发式，不能保证发现全部跟踪器。
                </p>
                <div className="mt-4 grid gap-3 sm:grid-cols-[220px_minmax(0,1fr)] sm:items-center">
                  <Select
                    value={defaultMode}
                    onValueChange={(value) => void updateDefaultMode(value as PrivacyMode)}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="unrestricted">无限制</SelectItem>
                      <SelectItem value="loose">宽松</SelectItem>
                      <SelectItem value="strict">严格</SelectItem>
                    </SelectContent>
                  </Select>
                  <p className="text-xs leading-5 text-muted-foreground">
                    {modeDescriptions[defaultMode]}
                  </p>
                </div>
              </div>
            </div>
          </section>

          {error ? (
            <div
              role="alert"
              className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs text-destructive"
            >
              隐私设置异常：{error}
            </div>
          ) : null}
          <div className="grid gap-3">
            {policies.map((policy) => {
              const account = accounts.find((item) => item.accountId === policy.accountId)
              const accountLabel = account?.email ?? '邮箱地址不可用'
              return (
                <section key={policy.accountId} className="rounded-md border bg-card p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <h2 className="text-sm font-semibold">{accountLabel}</h2>
                      <p className="text-xs text-muted-foreground">
                        当前生效：
                        {policy.resolvedMode === 'unrestricted'
                          ? '无限制'
                          : policy.resolvedMode === 'loose'
                            ? '宽松'
                            : '严格'}
                      </p>
                    </div>
                    <Select
                      value={policy.mode}
                      onValueChange={(value) =>
                        void updateAccountMode(
                          policy.accountId,
                          value as AccountPrivacyPolicy['mode']
                        )
                      }
                    >
                      <SelectTrigger className="w-36">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="inherit">继承全局默认</SelectItem>
                        <SelectItem value="unrestricted">无限制</SelectItem>
                        <SelectItem value="loose">宽松</SelectItem>
                        <SelectItem value="strict">严格</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="mt-4 border-t pt-3">
                    <div className="flex items-center justify-between gap-2">
                      <div>
                        <h3 className="text-xs font-medium">信任发件人和域名</h3>
                        <p className="text-[11px] text-muted-foreground">
                          来自这些地址的外部内容不受当前邮箱策略限制。
                        </p>
                      </div>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {policy.trustedSenders.map((sender) => (
                        <span
                          key={sender.trustedSenderId}
                          className="flex items-center gap-1 rounded-full bg-muted px-2 py-1 text-xs"
                        >
                          <span>
                            {sender.matchType === 'domain'
                              ? `域名 ${sender.matchValue}`
                              : sender.matchValue}
                          </span>
                          <button
                            type="button"
                            aria-label="删除可信地址"
                            onClick={() => void removeTrusted(policy, sender.trustedSenderId)}
                          >
                            <Trash2 className="size-3" />
                          </button>
                        </span>
                      ))}
                      {policy.trustedSenders.length === 0 ? (
                        <span className="text-xs text-muted-foreground">尚未添加。</span>
                      ) : null}
                    </div>
                    <div className="mt-3 flex max-w-xl gap-2">
                      <Select
                        value={trustedType[policy.accountId] ?? 'email'}
                        onValueChange={(value) =>
                          setTrustedType((current) => ({
                            ...current,
                            [policy.accountId]: value as 'email' | 'domain'
                          }))
                        }
                      >
                        <SelectTrigger className="w-28">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="email">邮箱</SelectItem>
                          <SelectItem value="domain">域名</SelectItem>
                        </SelectContent>
                      </Select>
                      <Input
                        value={trustedValue[policy.accountId] ?? ''}
                        onChange={(event) =>
                          setTrustedValue((current) => ({
                            ...current,
                            [policy.accountId]: event.target.value
                          }))
                        }
                        placeholder="sender@example.com"
                      />
                      <Button
                        variant="outline"
                        size="icon"
                        aria-label="添加可信发件人"
                        onClick={() => void addTrusted(policy)}
                      >
                        <UserPlus />
                      </Button>
                    </div>
                  </div>
                </section>
              )
            })}
            {policies.length === 0 ? (
              <p className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">
                添加邮箱后，可以在这里设置账号级隐私策略。
              </p>
            ) : null}
          </div>
        </div>
      </div>
    </section>
  )
}
