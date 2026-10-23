import * as React from 'react'
import { ArrowDown, ArrowUp, GripVertical, Plus, RefreshCw, Save, Trash2 } from 'lucide-react'
import { toast } from 'sonner'

import type {
  MailAccount,
  MailRule,
  MailRuleAction,
  MailRuleCondition,
  MailRuleField,
  MailRuleInput,
  MailRuleOperator
} from '../../../../shared/types'
import { Button } from '@renderer/components/ui/button'
import { Input } from '@renderer/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@renderer/components/ui/select'
import { Switch } from '@renderer/components/ui/switch'
import { cn } from '@renderer/lib/utils'

const fieldLabels: Record<MailRuleField, string> = {
  recipient: '收件邮箱',
  sender: '发件邮箱',
  subject: '主题',
  body: '正文',
  has_attachment: '有无附件'
}
const operatorLabels: Record<MailRuleOperator, string> = {
  contains: '包含',
  not_contains: '不包含',
  equals: '等于',
  starts_with: '开头',
  ends_with: '结尾'
}
const actionLabels: Record<MailRuleAction['type'], string> = {
  mark_read: '标为已读',
  add_to_board: '添加到看板',
  move_to_trash: '移入“已删除”（不永久删除）'
}
const actionTypes = Object.keys(actionLabels) as MailRuleAction['type'][]

function createAction(type: MailRuleAction['type']): MailRuleAction {
  switch (type) {
    case 'mark_read':
      return { type }
    case 'add_to_board':
      return { type }
    case 'move_to_trash':
      return { type }
  }
  throw new Error('未知规则动作。')
}

function ruleInput(rule: MailRule): MailRuleInput {
  return {
    ruleId: rule.ruleId,
    name: rule.name,
    accountId: rule.accountId,
    enabled: rule.enabled,
    sortOrder: rule.sortOrder,
    conditions: rule.conditions.map((item, index, conditions) => ({
      ...item,
      connector: index === conditions.length - 1 ? undefined : (item.connector ?? 'and')
    })),
    actions: rule.actions.map((item) => ({ ...item }))
  }
}

export function MailRulesSettings(): React.JSX.Element {
  const [rules, setRules] = React.useState<MailRule[]>([])
  const [accounts, setAccounts] = React.useState<MailAccount[]>([])
  const [draft, setDraft] = React.useState<MailRuleInput | null>(null)
  const [draggingId, setDraggingId] = React.useState<number | null>(null)
  const [busy, setBusy] = React.useState(false)
  const [loading, setLoading] = React.useState(true)
  const [loadError, setLoadError] = React.useState<string | null>(null)
  const busyRef = React.useRef(false)
  const loadVersion = React.useRef(0)

  const applyRules = React.useCallback((next: MailRule[]) => {
    setRules(next)
    setDraft((current) => {
      if (!current?.ruleId) return current
      const saved = next.find((rule) => rule.ruleId === current.ruleId)
      // Ordering/enabled state changes outside the editor must not be overwritten by Save.
      return saved ? { ...current, sortOrder: saved.sortOrder, enabled: saved.enabled } : null
    })
  }, [])

  const load = React.useCallback(async (): Promise<void> => {
    const version = ++loadVersion.current
    setLoading(true)
    try {
      const next = await window.api.rules.list()
      if (version !== loadVersion.current) return
      applyRules(next)
      setLoadError(null)
    } catch (error) {
      if (version !== loadVersion.current) return
      const message = error instanceof Error ? error.message : '加载邮件规则失败。'
      setLoadError(message)
      toast.error(message)
    } finally {
      if (version === loadVersion.current) setLoading(false)
    }
  }, [applyRules])

  React.useEffect(() => {
    // Load the current rule/account snapshots when this settings section mounts.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load()
    void window.api.accounts
      .list()
      .then(setAccounts)
      .catch(() => toast.error('加载邮箱账号失败，请刷新后重试。'))
    return () => {
      loadVersion.current += 1
    }
  }, [load])

  async function perform(operation: () => Promise<void>, fallback: string): Promise<void> {
    if (busyRef.current) return
    busyRef.current = true
    setBusy(true)
    ++loadVersion.current
    try {
      await operation()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : fallback)
    } finally {
      busyRef.current = false
      setBusy(false)
      setLoading(false)
    }
  }

  function startNew(): void {
    setDraft({
      name: '新规则',
      enabled: true,
      sortOrder: rules.length,
      conditions: [{ field: 'sender', operator: 'contains', value: '' }],
      actions: [{ type: 'mark_read' }]
    })
  }

  async function save(): Promise<void> {
    if (!draft) return
    await perform(async () => {
      const saved = await window.api.rules.save(draft)
      setRules((current) =>
        [...current.filter((rule) => rule.ruleId !== saved.ruleId), saved].sort(
          (left, right) => left.sortOrder - right.sortOrder || left.ruleId - right.ruleId
        )
      )
      setDraft(null)
      toast.success('规则已保存，仅对之后新收邮件生效。')
    }, '保存规则失败。')
  }

  async function remove(ruleId: number): Promise<void> {
    await perform(async () => {
      const deleted = await window.api.rules.delete(ruleId)
      if (!deleted) throw new Error('该规则已不存在，请刷新列表。')
      setRules((current) => current.filter((rule) => rule.ruleId !== ruleId))
      setDraft((current) => (current?.ruleId === ruleId ? null : current))
    }, '删除规则失败。')
  }

  async function toggle(rule: MailRule): Promise<void> {
    await perform(async () => {
      const next = await window.api.rules.setEnabled(rule.ruleId, !rule.enabled)
      setRules((current) => current.map((item) => (item.ruleId === next.ruleId ? next : item)))
      setDraft((current) =>
        current?.ruleId === next.ruleId ? { ...current, enabled: next.enabled } : current
      )
    }, '修改规则启用状态失败。')
  }

  async function reorder(sourceId: number, targetId: number): Promise<void> {
    if (sourceId === targetId) return
    const ids = rules.map((rule) => rule.ruleId)
    const sourceIndex = ids.indexOf(sourceId)
    const targetIndex = ids.indexOf(targetId)
    if (sourceIndex < 0 || targetIndex < 0) return
    ids.splice(sourceIndex, 1)
    ids.splice(targetIndex, 0, sourceId)
    await perform(async () => {
      applyRules(await window.api.rules.reorder(ids))
    }, '调整规则顺序失败，请刷新后重试。')
  }

  function updateCondition(index: number, patch: Partial<MailRuleCondition>): void {
    setDraft((current) =>
      current
        ? {
            ...current,
            conditions: current.conditions.map((condition, conditionIndex) => {
              if (conditionIndex !== index) return condition
              if (patch.field === 'has_attachment')
                return { ...condition, ...patch, operator: 'equals', value: 'true' }
              if (patch.field && condition.field === 'has_attachment')
                return { ...condition, ...patch, operator: 'contains', value: '' }
              return { ...condition, ...patch }
            })
          }
        : current
    )
  }

  const disabled = busy || loading
  return (
    <section
      className="flex h-full min-h-0 flex-col bg-background text-foreground"
      aria-label="邮件规则"
    >
      <header className="flex min-h-14 shrink-0 items-center gap-2 border-b px-4 py-2">
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold">邮件规则</h2>
          <p className="text-xs text-muted-foreground">
            从上到下执行所有匹配规则；关闭的规则不执行。
          </p>
        </div>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="刷新规则"
          disabled={disabled}
          onClick={() => void load()}
        >
          <RefreshCw />
        </Button>
        <Button size="sm" disabled={disabled || rules.length >= 100} onClick={startNew}>
          <Plus data-icon="inline-start" />
          新建规则
        </Button>
      </header>
      <div className="border-b bg-muted/30 px-4 py-2 text-xs text-muted-foreground">
        仅自动处理首次同步完成后新收到的收件箱邮件。首次同步、历史回填不执行规则；保存或修改规则不会重新处理历史邮件。规则不会发送邮件。
      </div>
      <div className="grid min-h-0 flex-1 grid-cols-[minmax(220px,34%)_minmax(0,1fr)]">
        <section aria-label="规则列表" className="min-h-0 overflow-auto border-r bg-muted/20 p-3">
          {loadError ? (
            <p
              role="alert"
              className="mb-3 rounded-md border border-destructive/30 p-3 text-xs text-destructive"
            >
              {loadError}
            </p>
          ) : null}
          <div className="space-y-2" aria-busy={disabled}>
            {rules.map((rule, index) => (
              <article
                key={rule.ruleId}
                draggable={!disabled}
                onDragStart={(event) => {
                  setDraggingId(rule.ruleId)
                  event.dataTransfer.setData('text/plain', String(rule.ruleId))
                  event.dataTransfer.effectAllowed = 'move'
                }}
                onDragEnd={() => setDraggingId(null)}
                onDragOver={(event) => {
                  if (!disabled) event.preventDefault()
                }}
                onDrop={(event) => {
                  event.preventDefault()
                  if (!disabled && draggingId !== null) void reorder(draggingId, rule.ruleId)
                  setDraggingId(null)
                }}
                className={cn(
                  'rounded-md border bg-card p-3',
                  draggingId === rule.ruleId && 'opacity-50',
                  draft?.ruleId === rule.ruleId && 'border-primary/60'
                )}
              >
                <div className="flex items-start gap-2">
                  <GripVertical
                    className="mt-1 size-4 shrink-0 cursor-grab text-muted-foreground"
                    aria-hidden="true"
                  />
                  <button
                    type="button"
                    disabled={disabled}
                    className="min-w-0 flex-1 text-left"
                    onClick={() => setDraft(ruleInput(rule))}
                  >
                    <h2 className="truncate text-sm font-medium">
                      {index + 1}. {rule.name}
                    </h2>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {rule.conditions.length} 个条件 · {rule.actions.length} 个动作
                    </p>
                  </button>
                  <Switch
                    size="sm"
                    checked={rule.enabled}
                    disabled={disabled}
                    onCheckedChange={() => void toggle(rule)}
                    aria-label={`启用 ${rule.name}`}
                  />
                </div>
                <div className="mt-2 flex justify-end gap-1">
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    disabled={disabled || index === 0}
                    aria-label={`上移 ${rule.name}`}
                    onClick={() => void reorder(rule.ruleId, rules[index - 1].ruleId)}
                  >
                    <ArrowUp />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    disabled={disabled || index === rules.length - 1}
                    aria-label={`下移 ${rule.name}`}
                    onClick={() => void reorder(rule.ruleId, rules[index + 1].ruleId)}
                  >
                    <ArrowDown />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    disabled={disabled}
                    aria-label={`删除规则 ${rule.name}`}
                    onClick={() => void remove(rule.ruleId)}
                  >
                    <Trash2 />
                  </Button>
                </div>
              </article>
            ))}
            {rules.length === 0 && !loadError ? (
              <p className="rounded-md border border-dashed p-8 text-center text-xs text-muted-foreground">
                {loading ? '正在加载规则…' : '还没有规则。'}
              </p>
            ) : null}
          </div>
        </section>
        <section className="min-h-0 overflow-auto">
          {draft ? (
            <RuleEditor
              draft={draft}
              accounts={accounts}
              disabled={disabled}
              setDraft={setDraft}
              updateCondition={updateCondition}
              onSave={() => void save()}
              onCancel={() => setDraft(null)}
            />
          ) : (
            <div className="flex h-full items-center justify-center p-8 text-center text-sm text-muted-foreground">
              选择规则进行编辑，或新建一条规则。
            </div>
          )}
        </section>
      </div>
    </section>
  )
}

type RuleEditorProps = {
  draft: MailRuleInput
  accounts: MailAccount[]
  disabled: boolean
  setDraft: React.Dispatch<React.SetStateAction<MailRuleInput | null>>
  updateCondition: (index: number, patch: Partial<MailRuleCondition>) => void
  onSave: () => void
  onCancel: () => void
}

function RuleEditor({
  draft,
  accounts,
  disabled,
  setDraft,
  updateCondition,
  onSave,
  onCancel
}: RuleEditorProps): React.JSX.Element {
  const groups: string[][] = [[]]
  draft.conditions.forEach((condition, index) => {
    groups[groups.length - 1].push(`条件 ${index + 1}`)
    if (condition.connector === 'or' && index < draft.conditions.length - 1) groups.push([])
  })
  const expression = groups
    .map((group) => (group.length > 1 ? `（${group.join(' AND ')}）` : group[0]))
    .join(' OR ')
  return (
    <fieldset
      disabled={disabled}
      className="mx-auto flex w-full min-w-0 max-w-3xl flex-col gap-5 p-5"
    >
      <div className="flex items-center justify-between gap-3 border-b pb-3">
        <div className="min-w-0">
          <p className="text-xs text-muted-foreground">规则编辑</p>
          <h2 className="truncate text-lg font-semibold">{draft.name}</h2>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" disabled={disabled} onClick={onCancel}>
            取消
          </Button>
          <Button disabled={disabled} onClick={onSave}>
            <Save data-icon="inline-start" />
            {disabled ? '处理中…' : '保存'}
          </Button>
        </div>
      </div>
      <label className="grid gap-1.5 text-xs font-medium">
        规则名称
        <Input
          value={draft.name}
          maxLength={120}
          onChange={(event) =>
            setDraft((current) => (current ? { ...current, name: event.target.value } : current))
          }
        />
      </label>
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-xs font-medium">适用邮箱</span>
        <Select
          disabled={disabled}
          value={draft.accountId === undefined ? 'all' : String(draft.accountId)}
          onValueChange={(value) =>
            setDraft((current) =>
              current
                ? { ...current, accountId: value === 'all' ? undefined : Number(value) }
                : current
            )
          }
        >
          <SelectTrigger className="max-w-sm" aria-label="适用邮箱">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">所有邮箱</SelectItem>
            {accounts.map((account) => (
              <SelectItem key={account.accountId} value={String(account.accountId)}>
                {account.email}
              </SelectItem>
            ))}
            {draft.accountId !== undefined &&
            !accounts.some((account) => account.accountId === draft.accountId) ? (
              <SelectItem value={String(draft.accountId)}>账号 #{draft.accountId}</SelectItem>
            ) : null}
          </SelectContent>
        </Select>
        <label className="flex items-center gap-2 text-xs">
          <Switch
            checked={draft.enabled}
            disabled={disabled}
            onCheckedChange={(enabled) =>
              setDraft((current) => (current ? { ...current, enabled } : current))
            }
          />
          启用规则
        </label>
      </div>
      <section className="grid gap-2">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold">条件</h3>
          <Button
            variant="outline"
            size="sm"
            disabled={disabled || draft.conditions.length >= 20}
            onClick={() =>
              setDraft((current) =>
                current
                  ? {
                      ...current,
                      conditions: current.conditions
                        .map((condition, index) =>
                          index === current.conditions.length - 1
                            ? { ...condition, connector: condition.connector ?? 'and' }
                            : condition
                        )
                        .concat({ field: 'subject', operator: 'contains', value: '' })
                    }
                  : current
              )
            }
          >
            <Plus data-icon="inline-start" />
            添加条件
          </Button>
        </div>
        <p className="text-xs leading-relaxed text-muted-foreground">
          连接符连接本行与下一行；AND（并且）优先于
          OR（或者）。文本忽略大小写；收件邮箱包含接收账号和邮件中已记录的收件地址。
        </p>
        <p
          aria-label="条件表达式"
          className="rounded-md bg-muted/50 px-3 py-2 text-xs leading-relaxed"
        >
          {expression}
        </p>
        {draft.conditions.map((condition, index) => (
          <div key={index} className="grid gap-2 rounded-md border bg-card p-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs text-muted-foreground">条件 {index + 1}</span>
              <Select
                disabled={disabled}
                value={condition.field}
                onValueChange={(value) => updateCondition(index, { field: value as MailRuleField })}
              >
                <SelectTrigger className="w-32" aria-label={`条件 ${index + 1} 字段`}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(fieldLabels).map(([value, label]) => (
                    <SelectItem key={value} value={value}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select
                disabled={disabled || condition.field === 'has_attachment'}
                value={condition.field === 'has_attachment' ? 'equals' : condition.operator}
                onValueChange={(value) =>
                  updateCondition(index, { operator: value as MailRuleOperator })
                }
              >
                <SelectTrigger className="w-28" aria-label={`条件 ${index + 1} 运算符`}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(operatorLabels).map(([value, label]) => (
                    <SelectItem key={value} value={value}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                variant="ghost"
                size="icon-sm"
                className="ml-auto"
                aria-label={`删除条件 ${index + 1}`}
                disabled={disabled || draft.conditions.length <= 1}
                onClick={() =>
                  setDraft((current) => {
                    if (!current) return current
                    const conditions = current.conditions.filter(
                      (_, conditionIndex) => conditionIndex !== index
                    )
                    return {
                      ...current,
                      conditions: conditions.map((item, conditionIndex) => ({
                        ...item,
                        connector:
                          conditionIndex === conditions.length - 1
                            ? undefined
                            : (item.connector ?? 'and')
                      }))
                    }
                  })
                }
              >
                <Trash2 />
              </Button>
            </div>
            <div className="flex items-center gap-2">
              {condition.field === 'has_attachment' ? (
                <Select
                  disabled={disabled}
                  value={['true', 'false'].includes(condition.value) ? condition.value : ''}
                  onValueChange={(value) => updateCondition(index, { value, operator: 'equals' })}
                >
                  <SelectTrigger className="flex-1" aria-label={`条件 ${index + 1} 附件`}>
                    <SelectValue placeholder="请选择有无附件" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="true">有附件</SelectItem>
                    <SelectItem value="false">无附件</SelectItem>
                  </SelectContent>
                </Select>
              ) : (
                <Input
                  className="min-w-0 flex-1"
                  value={condition.value}
                  maxLength={2048}
                  aria-label={`条件 ${index + 1} 值`}
                  onChange={(event) => updateCondition(index, { value: event.target.value })}
                  placeholder="条件值"
                />
              )}
              {index < draft.conditions.length - 1 ? (
                <Select
                  disabled={disabled}
                  value={condition.connector ?? 'and'}
                  onValueChange={(value) =>
                    updateCondition(index, { connector: value as MailRuleCondition['connector'] })
                  }
                >
                  <SelectTrigger className="w-36" aria-label={`条件 ${index + 1} 连接到下一条`}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="and">AND · 并且</SelectItem>
                    <SelectItem value="or">OR · 或者</SelectItem>
                  </SelectContent>
                </Select>
              ) : null}
            </div>
          </div>
        ))}
      </section>
      <section className="grid gap-2">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold">动作</h3>
          <Button
            variant="outline"
            size="sm"
            disabled={disabled || draft.actions.length >= 3}
            onClick={() =>
              setDraft((current) => {
                if (!current) return current
                const type = actionTypes.find(
                  (type) => !current.actions.some((action) => action.type === type)
                )
                return type
                  ? { ...current, actions: [...current.actions, createAction(type)] }
                  : current
              })
            }
          >
            <Plus data-icon="inline-start" />
            添加动作
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          动作按此处顺序执行。失败时暂停该邮件的后续规则，之后同步会从失败处重试；不会重复创建已成功添加的看板任务。
        </p>
        {draft.actions.map((action, index) => (
          <div key={index} className="grid gap-2 rounded-md border bg-card p-3">
            <div className="flex items-center gap-2">
              <Select
                disabled={disabled}
                value={action.type}
                onValueChange={(value) =>
                  setDraft((current) =>
                    current
                      ? {
                          ...current,
                          actions: current.actions.map((item, actionIndex) =>
                            actionIndex === index
                              ? value === item.type
                                ? item
                                : createAction(value as MailRuleAction['type'])
                              : item
                          )
                        }
                      : current
                  )
                }
              >
                <SelectTrigger className="min-w-0 flex-1" aria-label={`动作 ${index + 1}`}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {actionTypes
                    .filter(
                      (type) =>
                        type === action.type || !draft.actions.some((item) => item.type === type)
                    )
                    .map((type) => (
                      <SelectItem key={type} value={type}>
                        {actionLabels[type]}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={`删除动作 ${index + 1}`}
                disabled={disabled || draft.actions.length <= 1}
                onClick={() =>
                  setDraft((current) =>
                    current
                      ? {
                          ...current,
                          actions: current.actions.filter((_, actionIndex) => actionIndex !== index)
                        }
                      : current
                  )
                }
              >
                <Trash2 />
              </Button>
            </div>
            {action.type === 'add_to_board' ? (
              <Input
                value={action.note ?? ''}
                maxLength={2000}
                aria-label="看板备注"
                placeholder="看板备注（可选）"
                onChange={(event) =>
                  setDraft((current) =>
                    current
                      ? {
                          ...current,
                          actions: current.actions.map((item, actionIndex) =>
                            actionIndex === index && item.type === 'add_to_board'
                              ? { ...item, note: event.target.value }
                              : item
                          )
                        }
                      : current
                  )
                }
              />
            ) : null}
          </div>
        ))}
      </section>
    </fieldset>
  )
}
