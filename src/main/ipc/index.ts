import { registerAccountIpc } from './accounts'
import { registerComposeIpc } from './compose'
import { registerContactsIpc } from './contacts'
import { registerLogoIpc } from './logos'
import { registerMessageActionIpc } from './message-actions'
import { registerMessageIpc } from './messages'
import { registerNotificationIpc } from './notifications'
import { registerPrivacyIpc } from './privacy'
import { registerSettingsIpc } from './settings'
import { registerRulesIpc } from './rules'
import { registerSyncIpc } from './sync'
import { registerTasksIpc } from './tasks'
import { registerSystemIpc } from './system'
import { registerUpdateIpc } from './updates'
import { registerTranslationIpc } from './translations'
import { registerWritebackIpc } from './writeback'

let registered = false

export function registerIpcHandlers(): void {
  if (registered) {
    return
  }

  registerAccountIpc()
  registerComposeIpc()
  registerContactsIpc()
  registerLogoIpc()
  registerMessageIpc()
  registerMessageActionIpc()
  registerNotificationIpc()
  registerPrivacyIpc()
  registerSyncIpc()
  registerSettingsIpc()
  registerRulesIpc()
  registerSystemIpc()
  registerTasksIpc()
  registerUpdateIpc()
  registerTranslationIpc()
  registerWritebackIpc()

  registered = true
}
