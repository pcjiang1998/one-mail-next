import type { SettingsSection } from '@renderer/components/settings/settings-dialog'
import { MailboxWorkspace } from '@renderer/features/mailbox/mailbox-workspace'

export function MailboxPage({
  initialSettingsSection
}: {
  initialSettingsSection?: SettingsSection
}): React.JSX.Element {
  return <MailboxWorkspace initialSettingsSection={initialSettingsSection} />
}
