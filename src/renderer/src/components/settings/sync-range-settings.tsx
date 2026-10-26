import * as React from 'react'
import { Save } from 'lucide-react'
import { toast } from 'sonner'
import { Input } from '@renderer/components/ui/input'
import { Button } from '@renderer/components/ui/button'
import { Checkbox } from '@renderer/components/ui/checkbox'
import { Switch } from '@renderer/components/ui/switch'
import { useI18n, type TranslationKey } from '@renderer/lib/i18n'
import type { AppSettings, SettingsUpdateInput } from '../../../../shared/types'
import {
  DEFAULT_SYNC_RANGES,
  getSyncRangeError,
  type SyncRangeField,
  type SyncRanges
} from '../../../../shared/sync-range'
import { CacheCleanupControl } from './settings-advanced-sections'

const fields: SyncRangeField[] = ['syncWindowDays', 'syncBodyWindowDays', 'cacheRetentionDays']
type RangeValues = SyncRanges &
  Pick<AppSettings, 'downloadAttachmentsSeparately' | 'cleanupMetadata'>

function rangeValues(settings: AppSettings | null): RangeValues {
  return {
    syncWindowDays: settings?.syncWindowDays ?? DEFAULT_SYNC_RANGES.syncWindowDays,
    syncBodyWindowDays: settings?.syncBodyWindowDays ?? DEFAULT_SYNC_RANGES.syncBodyWindowDays,
    cacheRetentionDays: settings?.cacheRetentionDays ?? 0,
    downloadAttachmentsSeparately: settings?.downloadAttachmentsSeparately ?? false,
    cleanupMetadata: settings?.cleanupMetadata ?? false
  }
}

export function SyncRangeSettings({
  settings,
  onSubmit
}: {
  settings: AppSettings | null
  onSubmit: (input: SettingsUpdateInput) => Promise<void>
}): React.JSX.Element {
  const { t } = useI18n()
  const [values, setValues] = React.useState(() => rangeValues(settings))
  const [draft, setDraft] = React.useState(
    () =>
      Object.fromEntries(fields.map((field) => [field, String(values[field])])) as Record<
        SyncRangeField,
        string
      >
  )
  const accepted = React.useRef(values)
  const [pending, setPending] = React.useState(false)
  const [cleaning, setCleaning] = React.useState(false)
  const saving = React.useRef(false)
  const [error, setError] = React.useState<string | null>(null)
  const [invalidField, setInvalidField] = React.useState<SyncRangeField | null>(null)

  async function commit(next: RangeValues): Promise<void> {
    if (saving.current) return
    for (const field of fields) {
      const issue = getSyncRangeError(next, field)
      if (issue) throw new Error(t(`settings.syncRange.error.${issue}`))
    }
    saving.current = true
    setPending(true)
    setError(null)
    try {
      await onSubmit(next)
      setValues(next)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('settings.updateError'))
    } finally {
      saving.current = false
      setPending(false)
    }
  }

  async function validateAndSave(
    field?: SyncRangeField,
    options: Partial<Pick<RangeValues, 'downloadAttachmentsSeparately' | 'cleanupMetadata'>> = {}
  ): Promise<void> {
    if (saving.current || cleaning) return
    const next = { ...values, ...options }
    for (const key of fields) {
      const text = draft[key].trim()
      next[key] = /^\d+$/.test(text) ? Number(text) : NaN
    }
    const invalid = (field ? [field, ...fields.filter((key) => key !== field)] : fields).find(
      (key) => getSyncRangeError(next, key)
    )
    if (invalid) {
      const issue = getSyncRangeError(next, invalid)!
      const message = t(`settings.syncRange.error.${issue}`)
      const restore = field ?? invalid
      setDraft((current) => ({ ...current, [restore]: String(accepted.current[restore]) }))
      setInvalidField(restore)
      setError(message)
      toast.error(message)
      return
    }
    setInvalidField(null)
    accepted.current = next
    await commit(next)
  }

  const hasUnsavedRanges = fields.some((field) => draft[field] !== String(values[field]))
  const busy = pending || cleaning

  return (
    <section className="mx-auto flex w-full max-w-2xl flex-col gap-5 p-4" aria-busy={busy}>
      <h2 className="text-sm font-semibold">{t('settings.syncRange')}</h2>
      {fields.map((field) => (
        <div
          key={field}
          className="grid gap-3 border-b pb-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center"
        >
          <div className="min-w-0">
            <label htmlFor={field} className="text-sm font-medium">
              {t(`settings.syncRange.${field}` as TranslationKey)}
            </label>
            <p className="mt-1 text-xs text-muted-foreground">
              {t(`settings.syncRange.${field}.description` as TranslationKey)}
            </p>
          </div>
          <Input
            id={field}
            type="number"
            step={1}
            min={field === 'cacheRetentionDays' ? 0 : 1}
            max={field === 'syncWindowDays' ? 90 : field === 'syncBodyWindowDays' ? 30 : undefined}
            className="w-28"
            value={draft[field]}
            disabled={busy}
            aria-invalid={invalidField === field}
            onChange={(event) =>
              setDraft((current) => ({ ...current, [field]: event.target.value }))
            }
            onBlur={() => void validateAndSave(field)}
          />
        </div>
      ))}
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <label htmlFor="separate-attachments" className="text-sm font-medium">
            {t('settings.syncRange.attachments')}
          </label>
          <p className="mt-1 text-xs text-muted-foreground">
            {t('settings.syncRange.attachments.description')}
          </p>
          {values.downloadAttachmentsSeparately && (
            <p className="mt-2 text-xs text-muted-foreground">{t('settings.syncRange.pop3')}</p>
          )}
        </div>
        <Switch
          id="separate-attachments"
          checked={values.downloadAttachmentsSeparately}
          disabled={busy}
          onCheckedChange={(checked) =>
            void validateAndSave(undefined, { downloadAttachmentsSeparately: checked })
          }
        />
      </div>
      <label className="flex items-center gap-2 text-sm">
        <Checkbox
          checked={values.cleanupMetadata}
          disabled={busy}
          onCheckedChange={(checked) =>
            void validateAndSave(undefined, { cleanupMetadata: checked === true })
          }
        />
        {t('settings.syncRange.cleanupMetadata')}
      </label>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <Button
        className="self-start"
        variant="outline"
        size="sm"
        disabled={busy}
        onClick={() => void validateAndSave()}
      >
        <Save data-icon="inline-start" />
        {t(pending ? 'common.saving' : 'common.save')}
      </Button>
      <CacheCleanupControl
        disabled={busy || hasUnsavedRanges || values.cacheRetentionDays === 0}
        settings={{
          cacheRetentionDays: values.cacheRetentionDays,
          cleanupMetadata: values.cleanupMetadata
        }}
        onPendingChange={setCleaning}
      />
    </section>
  )
}
