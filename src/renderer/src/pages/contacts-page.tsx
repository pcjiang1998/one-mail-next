import * as React from 'react'
import { ArrowLeft, Download, Plus, Search, Star, Trash2, Upload } from 'lucide-react'
import { useBlocker, useNavigate } from 'react-router'
import { toast } from 'sonner'

import type { Contact, ContactInput } from '../../../shared/types'
import { ResponsiveDialog } from '@renderer/components/responsive-dialog'
import { Button } from '@renderer/components/ui/button'
import { Input } from '@renderer/components/ui/input'
import { Textarea } from '@renderer/components/ui/textarea'
import { Switch } from '@renderer/components/ui/switch'
import { cn } from '@renderer/lib/utils'

type DraftContact = Omit<ContactInput, 'emails'> & {
  emails: Array<ContactInput['emails'][number] & { key: string }>
}
type Editor = { draft: DraftContact; saved: DraftContact }
type Notice = { kind: 'error' | 'success'; text: string }
let emailSequence = 0

function newEmail(): DraftContact['emails'][number] {
  return { key: `email-${++emailSequence}`, email: '', label: '', isDefault: false }
}

function createEditor(contact?: Contact): Editor {
  const draft: DraftContact = contact
    ? {
        contactId: contact.contactId,
        displayName: contact.displayName,
        note: contact.note,
        isStarred: contact.isStarred,
        emails: contact.emails.map((email) => ({ ...email, key: newEmail().key }))
      }
    : {
        displayName: '',
        note: '',
        isStarred: false,
        emails: [{ ...newEmail(), isDefault: true }]
      }
  return { draft, saved: draft }
}

function toInput(draft: DraftContact): ContactInput {
  return {
    contactId: draft.contactId,
    displayName: draft.displayName,
    note: draft.note,
    isStarred: draft.isStarred,
    emails: draft.emails.map((email) => ({
      email: email.email,
      label: email.label,
      isDefault: email.isDefault
    }))
  }
}

function isDirty(editor: Editor): boolean {
  return JSON.stringify(toInput(editor.draft)) !== JSON.stringify(toInput(editor.saved))
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback
}

function validateDraft(draft: DraftContact): void {
  const seen = new Set<string>()
  for (const [index, email] of draft.emails.entries()) {
    const address = email.email.trim().toLowerCase()
    if (!/^[^\s@<>,;]+@[^\s@<>,;]+\.[^\s@<>,;]+$/.test(address)) {
      throw new Error(`请填写有效的第 ${index + 1} 个邮箱地址，或删除该邮箱行。`)
    }
    if (seen.has(address)) throw new Error(`第 ${index + 1} 个邮箱地址重复。`)
    seen.add(address)
  }
}

export function ContactsPage(): React.JSX.Element {
  const navigate = useNavigate()
  const [contacts, setContacts] = React.useState<Contact[]>([])
  const [search, setSearch] = React.useState('')
  const [editor, setEditor] = React.useState<Editor>(() => createEditor())
  const [loading, setLoading] = React.useState(true)
  const [loadError, setLoadError] = React.useState<string | null>(null)
  const [editorError, setEditorError] = React.useState<string | null>(null)
  const [deleteError, setDeleteError] = React.useState<string | null>(null)
  const [notice, setNotice] = React.useState<Notice | null>(null)
  const [busy, setBusy] = React.useState<'save' | 'delete' | 'import' | 'export' | null>(null)
  const [deleteOpen, setDeleteOpen] = React.useState(false)
  const [pendingAction, setPendingAction] = React.useState<(() => void) | null>(null)
  const requestId = React.useRef(0)
  const choseEditor = React.useRef(false)
  const { draft } = editor
  const dirty = isDirty(editor)
  const locked = busy !== null || loading
  const blocker = useBlocker(dirty || busy !== null)

  const loadContacts = React.useCallback(async (selectFirst = false): Promise<void> => {
    const request = ++requestId.current
    setLoading(true)
    try {
      const next = await window.api.contacts.list()
      if (request !== requestId.current) return
      setContacts(next)
      setLoadError(null)
      if (selectFirst && next[0] && !choseEditor.current) {
        setEditor((current) => (isDirty(current) ? current : createEditor(next[0])))
      }
    } catch (error) {
      if (request === requestId.current) {
        setLoadError(errorMessage(error, '加载联系人失败。'))
      }
    } finally {
      if (request === requestId.current) setLoading(false)
    }
  }, [])

  React.useEffect(() => {
    void loadContacts(true)
    return () => {
      requestId.current += 1
    }
  }, [loadContacts])

  React.useEffect(() => {
    if (!dirty && !busy) return
    const beforeUnload = (event: BeforeUnloadEvent): void => {
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', beforeUnload)
    return () => window.removeEventListener('beforeunload', beforeUnload)
  }, [dirty, busy])

  // Filtering never reloads the editor: an unsaved draft survives searching, imports and refreshes.
  const filteredContacts = React.useMemo(() => {
    const query = search.trim().toLocaleLowerCase()
    return contacts
      .filter((contact) =>
        [contact.displayName, contact.note, ...contact.emails.map((email) => email.email)].some(
          (value) => value.toLocaleLowerCase().includes(query)
        )
      )
      .sort(
        (a, b) =>
          Number(b.isStarred) - Number(a.isStarred) ||
          a.displayName.localeCompare(b.displayName) ||
          a.contactId - b.contactId
      )
  }, [contacts, search])

  function updateDraft(update: (current: DraftContact) => DraftContact): void {
    choseEditor.current = true
    setEditor((current) => ({ ...current, draft: update(current.draft) }))
    setEditorError(null)
  }

  function changeEditor(contact?: Contact): void {
    if (locked || (contact && contact.contactId === draft.contactId)) return
    const action = (): void => {
      choseEditor.current = true
      setEditor(createEditor(contact))
      setEditorError(null)
    }
    if (dirty) setPendingAction(() => action)
    else action()
  }

  function updateEmail(key: string, patch: Partial<ContactInput['emails'][number]>): void {
    updateDraft((current) => ({
      ...current,
      emails: current.emails.map((email) => (email.key === key ? { ...email, ...patch } : email))
    }))
  }

  function removeEmail(key: string): void {
    updateDraft((current) => {
      if (current.emails.length <= 1) return current
      const emails = current.emails.filter((email) => email.key !== key)
      return {
        ...current,
        emails: emails.some((email) => email.isDefault)
          ? emails
          : emails.map((email, index) => ({ ...email, isDefault: index === 0 }))
      }
    })
  }

  async function save(): Promise<void> {
    if (locked) return
    setEditorError(null)
    try {
      validateDraft(draft)
      setBusy('save')
      const saved = await window.api.contacts.save(toInput(draft))
      setContacts((current) => [
        ...current.filter((item) => item.contactId !== saved.contactId),
        saved
      ])
      setEditor(createEditor(saved))
      toast.success('联系人已保存。')
    } catch (error) {
      setEditorError(errorMessage(error, '保存联系人失败。'))
    } finally {
      setBusy(null)
    }
  }

  async function remove(): Promise<void> {
    if (locked || draft.contactId === undefined) return
    setBusy('delete')
    setDeleteError(null)
    try {
      const deleted = await window.api.contacts.delete(draft.contactId)
      if (!deleted) throw new Error('联系人不存在，可能已被删除。请刷新列表后重试。')
      setContacts((current) => current.filter((item) => item.contactId !== draft.contactId))
      setEditor(createEditor())
      setEditorError(null)
      setDeleteOpen(false)
      toast.success('联系人已删除。')
    } catch (error) {
      setDeleteError(errorMessage(error, '删除联系人失败。'))
    } finally {
      setBusy(null)
    }
  }

  async function importContacts(): Promise<void> {
    if (locked) return
    setBusy('import')
    setNotice(null)
    try {
      const result = await window.api.contacts.importVCard()
      if ('canceled' in result && result.canceled === true) return
      setContacts(result.contacts)
      if (!dirty && draft.contactId === undefined && result.contacts[0]) {
        setEditor(createEditor(result.contacts[0]))
      }
      // These additive fields can be promoted to shared/types.ts by the integration owner.
      const skipped = 'skipped' in result && typeof result.skipped === 'number' ? result.skipped : 0
      setNotice({
        kind: 'success',
        text: `已导入 ${result.imported} 个联系人，跳过 ${skipped} 个冲突联系人（已有邮箱）。已有联系人未更改。`
      })
    } catch (error) {
      setNotice({ kind: 'error', text: errorMessage(error, '导入联系人失败。') })
    } finally {
      setBusy(null)
    }
  }

  async function exportContacts(): Promise<void> {
    if (locked) return
    setBusy('export')
    setNotice(null)
    try {
      const path = await window.api.contacts.exportVCard()
      if (path) setNotice({ kind: 'success', text: '已导出所有已保存的联系人。' })
    } catch (error) {
      setNotice({ kind: 'error', text: errorMessage(error, '导出联系人失败。') })
    } finally {
      setBusy(null)
    }
  }

  function cancelDiscard(): void {
    setPendingAction(null)
    if (blocker.state === 'blocked') blocker.reset()
  }

  function confirmDiscard(): void {
    if (busy) return
    if (pendingAction) pendingAction()
    setPendingAction(null)
    if (blocker.state === 'blocked') blocker.proceed()
  }

  return (
    <main className="flex h-screen min-h-0 flex-col bg-background text-foreground">
      <header className="flex min-h-12 shrink-0 flex-wrap items-center gap-2 border-b px-4 py-2">
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="返回邮箱"
          disabled={locked}
          onClick={() => navigate('/')}
        >
          <ArrowLeft />
        </Button>
        <div className="min-w-0 flex-1">
          <h1 className="text-sm font-semibold">联系人</h1>
          <p className="text-xs text-muted-foreground">所有账号共用的联系人</p>
        </div>
        <Button
          variant="outline"
          size="sm"
          disabled={locked}
          onClick={() => void importContacts()}
          title="UTF-8 vCard 3.0/4.0，最多 5 MiB、1000 个联系人；邮箱冲突将跳过"
        >
          <Upload data-icon="inline-start" />
          {busy === 'import' ? '导入中…' : '导入'}
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={locked || contacts.length === 0}
          onClick={() => void exportContacts()}
          title="导出所有已保存的联系人（vCard 3.0）"
        >
          <Download data-icon="inline-start" />
          {busy === 'export' ? '导出中…' : '导出'}
        </Button>
        <Button size="sm" disabled={locked} onClick={() => changeEditor()}>
          <Plus data-icon="inline-start" />
          新建
        </Button>
      </header>
      {notice ? (
        <p
          role={notice.kind === 'error' ? 'alert' : 'status'}
          className={cn(
            'border-b px-4 py-2 text-xs',
            notice.kind === 'error' ? 'text-destructive' : 'text-muted-foreground'
          )}
        >
          {notice.text}
        </p>
      ) : null}

      <div className="grid min-h-0 flex-1 grid-cols-[minmax(160px,30%)_minmax(0,1fr)]">
        <section className="min-h-0 overflow-auto border-r bg-muted/20" aria-label="联系人列表">
          <div className="sticky top-0 z-10 border-b bg-background/95 p-3 backdrop-blur">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
              <Input
                className="pl-8"
                aria-label="搜索联系人"
                maxLength={1000}
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="搜索姓名、邮箱或备注"
              />
            </div>
          </div>
          <div className="p-2">
            {loading ? (
              <p role="status" className="p-4 text-xs text-muted-foreground">
                正在加载联系人…
              </p>
            ) : null}
            {loadError ? (
              <div className="space-y-2 p-3">
                <p role="alert" className="text-xs text-destructive">
                  {loadError}
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={locked}
                  onClick={() => void loadContacts()}
                >
                  重试
                </Button>
              </div>
            ) : null}
            {filteredContacts.map((contact) => {
              const defaultEmail =
                contact.emails.find((email) => email.isDefault) ?? contact.emails[0]
              return (
                <button
                  key={contact.contactId}
                  type="button"
                  disabled={locked}
                  aria-pressed={contact.contactId === draft.contactId}
                  onClick={() => changeEditor(contact)}
                  className={cn(
                    'flex w-full items-start gap-2 rounded-md px-3 py-2 text-left outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50',
                    contact.contactId === draft.contactId && 'bg-secondary'
                  )}
                >
                  <div
                    className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary"
                    aria-hidden="true"
                  >
                    {(contact.displayName || defaultEmail?.email || '?').slice(0, 1).toUpperCase()}
                  </div>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1 text-sm font-medium">
                      <span className="truncate">{contact.displayName || defaultEmail?.email}</span>
                      {contact.isStarred ? (
                        <Star
                          aria-label="星标"
                          className="size-3 shrink-0 fill-primary text-primary"
                        />
                      ) : null}
                    </span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {defaultEmail?.email}
                    </span>
                  </span>
                </button>
              )
            })}
            {!loading && !loadError && filteredContacts.length === 0 ? (
              <p className="p-4 text-center text-xs text-muted-foreground">
                {search.trim() ? '没有匹配的联系人。' : '还没有联系人，可以新建或导入。'}
              </p>
            ) : null}
          </div>
        </section>

        <section className="min-h-0 overflow-auto" aria-label="联系人编辑">
          <form
            noValidate
            onSubmit={(event) => {
              event.preventDefault()
              void save()
            }}
            className="mx-auto flex w-full max-w-2xl flex-col gap-5 p-5"
          >
            <fieldset disabled={locked} className="flex min-w-0 flex-col gap-5">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b pb-3">
                <div className="min-w-0">
                  <p className="text-xs text-muted-foreground">
                    {draft.contactId ? '联系人详情' : '新联系人'}
                    {dirty ? ' · 未保存' : ''}
                  </p>
                  <h2 className="truncate text-lg font-semibold">
                    {draft.displayName || '未命名联系人'}
                  </h2>
                </div>
                <div className="flex items-center gap-2">
                  <label className="flex items-center gap-2 text-xs text-muted-foreground">
                    星标置顶
                    <Switch
                      checked={Boolean(draft.isStarred)}
                      onCheckedChange={(checked) =>
                        updateDraft((current) => ({ ...current, isStarred: checked }))
                      }
                    />
                  </label>
                  {draft.contactId ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      aria-label="删除联系人"
                      onClick={() => {
                        setDeleteError(null)
                        setDeleteOpen(true)
                      }}
                    >
                      <Trash2 />
                    </Button>
                  ) : null}
                </div>
              </div>
              <label className="grid gap-1.5 text-xs font-medium">
                姓名
                <Input
                  value={draft.displayName}
                  maxLength={256}
                  onChange={(event) =>
                    updateDraft((current) => ({ ...current, displayName: event.target.value }))
                  }
                  placeholder="例如：张三"
                />
              </label>
              <div className="grid gap-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-xs font-medium">邮箱地址</span>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={draft.emails.length >= 50}
                    onClick={() =>
                      updateDraft((current) => ({
                        ...current,
                        emails: [...current.emails, newEmail()]
                      }))
                    }
                  >
                    <Plus data-icon="inline-start" />
                    添加邮箱
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  只设置一个默认地址；写信时每次选择一个邮箱，不会自动群发。
                </p>
                {draft.emails.map((email, index) => (
                  <div key={email.key} className="flex min-w-0 flex-wrap items-center gap-2">
                    <Input
                      className="min-w-36 flex-1"
                      aria-label={`邮箱地址 ${index + 1}`}
                      type="email"
                      maxLength={254}
                      value={email.email}
                      onChange={(event) => updateEmail(email.key, { email: event.target.value })}
                      placeholder="name@example.com"
                    />
                    <Input
                      className="w-24"
                      aria-label={`邮箱标签 ${index + 1}`}
                      maxLength={100}
                      value={email.label ?? ''}
                      onChange={(event) => updateEmail(email.key, { label: event.target.value })}
                      placeholder="标签"
                    />
                    <Button
                      type="button"
                      variant={email.isDefault ? 'secondary' : 'outline'}
                      size="sm"
                      aria-label={`将邮箱 ${index + 1} 设为默认`}
                      aria-pressed={email.isDefault}
                      onClick={() =>
                        updateDraft((current) => ({
                          ...current,
                          emails: current.emails.map((item) => ({
                            ...item,
                            isDefault: item.key === email.key
                          }))
                        }))
                      }
                    >
                      {email.isDefault ? '默认' : '设为默认'}
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`删除邮箱 ${index + 1}`}
                      disabled={draft.emails.length === 1}
                      title={
                        draft.emails.length === 1 ? '至少保留一个邮箱地址' : '删除这个邮箱地址'
                      }
                      onClick={() => removeEmail(email.key)}
                    >
                      <Trash2 />
                    </Button>
                  </div>
                ))}
              </div>
              <label className="grid gap-1.5 text-xs font-medium">
                备注
                <Textarea
                  value={draft.note ?? ''}
                  maxLength={32768}
                  onChange={(event) =>
                    updateDraft((current) => ({ ...current, note: event.target.value }))
                  }
                  placeholder="添加备注信息"
                  rows={5}
                />
              </label>
              {editorError ? (
                <p role="alert" className="text-xs text-destructive">
                  {editorError}
                </p>
              ) : null}
              <div className="flex justify-end gap-2 border-t pt-4">
                {dirty ? (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() =>
                      setPendingAction(() => () => {
                        setEditor((current) => ({ ...current, draft: current.saved }))
                        setEditorError(null)
                      })
                    }
                  >
                    放弃修改
                  </Button>
                ) : null}
                <Button type="submit" disabled={Boolean(draft.contactId) && !dirty}>
                  {busy === 'save' ? '保存中…' : '保存联系人'}
                </Button>
              </div>
            </fieldset>
          </form>
        </section>
      </div>

      <ResponsiveDialog
        open={deleteOpen}
        onOpenChange={(open) => {
          if (!busy) setDeleteOpen(open)
        }}
        title="删除联系人？"
        description="删除后无法撤销，所有账号的联系人列表都会移除此人。"
        footer={
          <>
            <Button variant="outline" disabled={busy !== null} onClick={() => setDeleteOpen(false)}>
              取消
            </Button>
            <Button variant="destructive" disabled={locked} onClick={() => void remove()}>
              {busy === 'delete' ? '删除中…' : '确认删除'}
            </Button>
          </>
        }
      >
        <p className="break-words text-sm">
          {editor.saved.displayName || editor.saved.emails[0]?.email}
        </p>
        {deleteError ? (
          <p role="alert" className="mt-2 text-xs text-destructive">
            {deleteError}
          </p>
        ) : null}
      </ResponsiveDialog>
      <ResponsiveDialog
        open={pendingAction !== null || blocker.state === 'blocked'}
        onOpenChange={(open) => {
          if (!open && !busy) cancelDiscard()
        }}
        title="放弃未保存的修改？"
        description="当前联系人的修改尚未保存。继续后这些修改将丢失。"
        footer={
          <>
            <Button variant="outline" disabled={busy !== null} onClick={cancelDiscard}>
              继续编辑
            </Button>
            <Button variant="destructive" disabled={busy !== null} onClick={confirmDiscard}>
              放弃并继续
            </Button>
          </>
        }
      >
        {busy ? <p className="text-xs text-muted-foreground">请等待当前操作完成。</p> : null}
      </ResponsiveDialog>
    </main>
  )
}
