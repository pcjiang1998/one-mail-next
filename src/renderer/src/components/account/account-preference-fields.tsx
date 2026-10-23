import type * as React from 'react'
import { Controller, type UseFormReturn } from 'react-hook-form'
import { Checkbox } from '@renderer/components/ui/checkbox'
import { Input } from '@renderer/components/ui/input'
import { RadioGroup, RadioGroupItem } from '@renderer/components/ui/radio-group'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@renderer/components/ui/select'
import { useI18n } from '@renderer/lib/i18n'
import type { MailSignature } from '../../../../shared/types'
import type { AccountFormValues } from './account-form-types'
import { AccountFormField } from './account-form-field'

export function AccountPreferenceFields({
  form,
  signatures
}: {
  form: UseFormReturn<AccountFormValues>
  signatures: MailSignature[]
}): React.JSX.Element {
  const { t } = useI18n()
  const proxyMode = form.watch('proxyMode')

  return (
    <>
      <AccountFormField
        id="account-desktop-notifications"
        label={t('account.form.desktopNotifications')}
      >
        <Controller
          control={form.control}
          name="desktopNotificationsEnabled"
          render={({ field }) => (
            <Checkbox
              id="account-desktop-notifications"
              checked={field.value}
              onCheckedChange={(checked) => field.onChange(checked === true)}
            />
          )}
        />
      </AccountFormField>
      <AccountFormField
        id="account-proxy-mode"
        label={t('account.form.proxy')}
        error={form.formState.errors.customProxyUrl?.message}
      >
        <Controller
          control={form.control}
          name="proxyMode"
          render={({ field }) => (
            <RadioGroup
              id="account-proxy-mode"
              value={field.value}
              onValueChange={field.onChange}
              className="grid gap-2 sm:grid-cols-2"
            >
              {(['global', 'none', 'system', 'custom'] as const).map((mode) => (
                <label
                  key={mode}
                  className="flex items-center gap-2 rounded-md border px-2.5 py-2 text-xs"
                >
                  <RadioGroupItem value={mode} />
                  {t(`account.form.proxy.${mode}`)}
                </label>
              ))}
            </RadioGroup>
          )}
        />
        {proxyMode === 'custom' ? (
          <Input
            className="mt-2"
            placeholder="http://127.0.0.1:8080"
            aria-invalid={Boolean(form.formState.errors.customProxyUrl)}
            {...form.register('customProxyUrl')}
          />
        ) : null}
      </AccountFormField>

      <AccountFormField id="account-signature" label={t('account.form.signature')}>
        <Select
          value={toSignatureSelectValue(form.watch('signatureMode'), form.watch('signatureId'))}
          onValueChange={(value) => {
            if (value === 'global' || value === 'none') {
              form.setValue('signatureMode', value)
              form.setValue('signatureId', undefined)
              return
            }
            form.setValue('signatureMode', 'custom')
            form.setValue('signatureId', Number(value.slice('signature:'.length)))
          }}
        >
          <SelectTrigger id="account-signature" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="global">{t('settings.signature.useGlobal')}</SelectItem>
            <SelectItem value="none">{t('settings.signature.none')}</SelectItem>
            {signatures.map((signature) => (
              <SelectItem key={signature.signatureId} value={`signature:${signature.signatureId}`}>
                {signature.title}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </AccountFormField>
    </>
  )
}

function toSignatureSelectValue(mode: string, signatureId?: number): string {
  return mode === 'custom' && signatureId ? `signature:${signatureId}` : mode
}
