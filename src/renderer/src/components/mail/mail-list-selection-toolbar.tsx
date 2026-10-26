import * as React from 'react'
import { CheckCheck, Trash2, X } from 'lucide-react'

import { Button } from '@renderer/components/ui/button'
import { Checkbox } from '@renderer/components/ui/checkbox'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger
} from '@renderer/components/ui/tooltip'
import { useI18n } from '@renderer/lib/i18n'

type MailListSelectionToolbarProps = {
  selectedCount: number
  unreadSelectedCount: number
  allVisibleSelected: boolean
  someVisibleSelected: boolean
  disabled?: boolean
  onSelectAllVisible: () => void
  onClearSelection: () => void
  onMarkSelectedRead: () => void
  onDeleteSelected: () => void
}

export function MailListSelectionToolbar({
  selectedCount,
  unreadSelectedCount,
  allVisibleSelected,
  someVisibleSelected,
  disabled = false,
  onSelectAllVisible,
  onClearSelection,
  onMarkSelectedRead,
  onDeleteSelected
}: MailListSelectionToolbarProps): React.JSX.Element {
  const { t } = useI18n()

  return (
    <div
      role="toolbar"
      aria-label={t('mail.selection.selectedCount', { count: selectedCount })}
      className="app-no-drag flex h-12 shrink-0 items-center gap-2 border-t px-4"
    >
      <Checkbox
        checked={allVisibleSelected ? true : someVisibleSelected ? 'indeterminate' : false}
        disabled={disabled}
        aria-label={t('mail.selection.selectVisible')}
        onCheckedChange={onSelectAllVisible}
      />
      <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
        {t('mail.selection.selectedCount', { count: selectedCount })}
      </span>
      <TooltipProvider>
        <SelectionAction
          label={t('mail.selection.markRead')}
          disabled={disabled || unreadSelectedCount === 0}
          onClick={onMarkSelectedRead}
        >
          <CheckCheck />
        </SelectionAction>
        <SelectionAction
          label={t('mail.selection.deletePermanently')}
          disabled={disabled || selectedCount === 0}
          onClick={onDeleteSelected}
        >
          <Trash2 />
        </SelectionAction>
        <SelectionAction
          label={t('mail.selection.clear')}
          disabled={disabled || selectedCount === 0}
          onClick={onClearSelection}
        >
          <X />
        </SelectionAction>
      </TooltipProvider>
    </div>
  )
}

function SelectionAction({
  label,
  disabled,
  onClick,
  children
}: {
  label: string
  disabled: boolean
  onClick: () => void
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          size="icon-sm"
          variant="ghost"
          disabled={disabled}
          aria-label={label}
          onClick={onClick}
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}
