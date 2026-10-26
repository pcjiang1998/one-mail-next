import type * as React from 'react'
import { Controller, type UseFormReturn } from 'react-hook-form'

import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@renderer/components/ui/select'
import { Input } from '@renderer/components/ui/input'
import { Switch } from '@renderer/components/ui/switch'
import { Checkbox } from '@renderer/components/ui/checkbox'
import { Alert, AlertDescription } from '@renderer/components/ui/alert'
import { useI18n } from '@renderer/lib/i18n'
import type { AccountFormValues } from './account-form-types'
import { AccountFormField } from './account-form-field'
import { CommonAccountFields } from './common-account-fields'

type CustomImapAccountFormProps = {
  form: UseFormReturn<AccountFormValues>
}

export function CustomImapAccountForm({ form }: CustomImapAccountFormProps): React.JSX.Element {
  const { t } = useI18n()
  const smtpEnabled = form.watch('smtpEnabled')
  const usePopProtocol = form.watch('usePopProtocol')

  return (
    <>
      <CommonAccountFields
        form={form}
        passwordLabel={t('account.form.password')}
        passwordPlaceholder={t('account.form.passwordPlaceholder')}
      />

      <Controller
        control={form.control}
        name="usePopProtocol"
        render={({ field }) => (
          <label className="flex items-center gap-2 rounded-md border px-3 py-2.5 text-sm">
            <Checkbox
              checked={field.value}
              onCheckedChange={(checked) => {
                field.onChange(checked === true)
                if (checked === true && !form.getValues('popHost')) {
                  form.setValue('popPort', 995)
                  form.setValue('popSecurity', 'ssl_tls')
                }
              }}
            />
            {t('account.form.usePopProtocol')}
          </label>
        )}
      />

      {usePopProtocol ? (
        <Alert variant="warning">
          <AlertDescription className="text-xs">
            {t('account.form.popNoRealtimeWarning')}
            <p className="mt-1">{t('account.form.popRetentionWarning')}</p>
          </AlertDescription>
        </Alert>
      ) : null}

      <div className="grid gap-2.5 sm:grid-cols-[minmax(0,1fr)_112px]">
        <AccountFormField
          id={usePopProtocol ? 'pop-host' : 'imap-host'}
          label={t(usePopProtocol ? 'account.form.popHost' : 'account.form.imapHost')}
          required
          error={
            usePopProtocol
              ? form.formState.errors.popHost?.message
              : form.formState.errors.imapHost?.message
          }
        >
          <Input
            id={usePopProtocol ? 'pop-host' : 'imap-host'}
            placeholder={usePopProtocol ? 'pop.example.com' : 'imap.example.com'}
            required
            aria-invalid={Boolean(
              usePopProtocol ? form.formState.errors.popHost : form.formState.errors.imapHost
            )}
            {...form.register(usePopProtocol ? 'popHost' : 'imapHost')}
          />
        </AccountFormField>

        <AccountFormField
          id={usePopProtocol ? 'pop-port' : 'imap-port'}
          label={t('account.form.port')}
          required
          error={
            usePopProtocol
              ? form.formState.errors.popPort?.message
              : form.formState.errors.imapPort?.message
          }
        >
          <Input
            id={usePopProtocol ? 'pop-port' : 'imap-port'}
            type="number"
            min={1}
            max={65535}
            required
            aria-invalid={Boolean(
              usePopProtocol ? form.formState.errors.popPort : form.formState.errors.imapPort
            )}
            {...form.register(usePopProtocol ? 'popPort' : 'imapPort', { valueAsNumber: true })}
          />
        </AccountFormField>
      </div>

      <AccountFormField
        id={usePopProtocol ? 'pop-security' : 'imap-security'}
        label={t('account.form.security')}
        required
        error={
          usePopProtocol
            ? form.formState.errors.popSecurity?.message
            : form.formState.errors.imapSecurity?.message
        }
      >
        <Controller
          control={form.control}
          name={usePopProtocol ? 'popSecurity' : 'imapSecurity'}
          render={({ field }) => (
            <Select value={field.value} onValueChange={field.onChange} required>
              <SelectTrigger
                id={usePopProtocol ? 'pop-security' : 'imap-security'}
                className="w-full"
                aria-label={t('account.form.security')}
                aria-invalid={Boolean(
                  usePopProtocol
                    ? form.formState.errors.popSecurity
                    : form.formState.errors.imapSecurity
                )}
              >
                <SelectValue placeholder={t('account.form.security')} />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectItem value="ssl_tls">SSL/TLS</SelectItem>
                  <SelectItem value="starttls">STARTTLS</SelectItem>
                  <SelectItem value="none">{t('account.form.securityNone')}</SelectItem>
                </SelectGroup>
              </SelectContent>
            </Select>
          )}
        />
      </AccountFormField>

      <div className="flex items-center justify-between gap-3 rounded-md border px-3 py-2.5">
        <label htmlFor="smtp-enabled" className="text-sm font-medium">
          {t('account.form.smtpEnabled')}
        </label>
        <Controller
          control={form.control}
          name="smtpEnabled"
          render={({ field }) => (
            <Switch
              id="smtp-enabled"
              checked={field.value}
              onCheckedChange={field.onChange}
              aria-label={t('account.form.smtpEnabled')}
            />
          )}
        />
      </div>

      {smtpEnabled ? (
        <>
          <div className="grid gap-2.5 sm:grid-cols-[minmax(0,1fr)_112px]">
            <AccountFormField
              id="smtp-host"
              label={t('account.form.smtpHost')}
              required
              error={form.formState.errors.smtpHost?.message}
            >
              <Input
                id="smtp-host"
                placeholder="smtp.example.com"
                required
                aria-invalid={Boolean(form.formState.errors.smtpHost)}
                {...form.register('smtpHost')}
              />
            </AccountFormField>

            <AccountFormField
              id="smtp-port"
              label={t('account.form.port')}
              required
              error={form.formState.errors.smtpPort?.message}
            >
              <Input
                id="smtp-port"
                type="number"
                min={1}
                max={65535}
                required
                aria-invalid={Boolean(form.formState.errors.smtpPort)}
                {...form.register('smtpPort', { valueAsNumber: true })}
              />
            </AccountFormField>
          </div>

          <AccountFormField
            id="smtp-security"
            label={t('account.form.security')}
            required
            error={form.formState.errors.smtpSecurity?.message}
          >
            <Controller
              control={form.control}
              name="smtpSecurity"
              render={({ field }) => (
                <Select value={field.value} onValueChange={field.onChange} required>
                  <SelectTrigger
                    id="smtp-security"
                    className="w-full"
                    aria-label={t('account.form.security')}
                    aria-invalid={Boolean(form.formState.errors.smtpSecurity)}
                  >
                    <SelectValue placeholder={t('account.form.security')} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      <SelectItem value="ssl_tls">SSL/TLS</SelectItem>
                      <SelectItem value="starttls">STARTTLS</SelectItem>
                      <SelectItem value="none">{t('account.form.securityNone')}</SelectItem>
                    </SelectGroup>
                  </SelectContent>
                </Select>
              )}
            />
          </AccountFormField>
        </>
      ) : null}
    </>
  )
}
