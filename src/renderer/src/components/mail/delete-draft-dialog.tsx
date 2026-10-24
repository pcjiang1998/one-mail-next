import * as React from 'react'
import { Loader2, Trash2 } from 'lucide-react'

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogMedia,
  AlertDialogTitle
} from '@renderer/components/ui/alert-dialog'
import { useI18n } from '@renderer/lib/i18n'

type DeleteDraftDialogProps = {
  open: boolean
  pending?: boolean
  subject?: string
  count?: number
  onOpenChange: (open: boolean) => void
  onConfirm: () => void
}

export function DeleteDraftDialog({
  open,
  pending = false,
  subject,
  count = 1,
  onOpenChange,
  onConfirm
}: DeleteDraftDialogProps): React.JSX.Element {
  const { t } = useI18n()

  return (
    <AlertDialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!pending) onOpenChange(nextOpen)
      }}
    >
      <AlertDialogContent size="sm">
        <AlertDialogHeader>
          <AlertDialogMedia className="bg-destructive/10 text-destructive ring-1 ring-destructive/20">
            {pending ? (
              <Loader2 className="animate-spin" aria-hidden="true" />
            ) : (
              <Trash2 aria-hidden="true" />
            )}
          </AlertDialogMedia>
          <AlertDialogTitle>
            {count > 1 ? t('mail.drafts.bulkDeleteTitle', { count }) : t('mail.draft.deleteTitle')}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {count > 1 ? t('mail.drafts.bulkDeleteDescription') : t('mail.draft.deleteDescription')}
          </AlertDialogDescription>
        </AlertDialogHeader>
        {subject ? (
          <p className="truncate rounded-md border bg-muted/40 px-3 py-2 text-sm font-medium">
            {subject}
          </p>
        ) : null}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>{t('common.cancel')}</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            disabled={pending}
            onClick={(event) => {
              event.preventDefault()
              onConfirm()
            }}
          >
            {pending ? t('common.deleting') : t('common.delete')}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
