import { ipcMain } from 'electron'

import {
  deleteRule,
  getMailRules,
  reorderRules,
  saveRule,
  setRuleEnabled
} from '../services/mail-rule.service'

export function registerRulesIpc(): void {
  ipcMain.handle('rules/list', () => getMailRules())
  ipcMain.handle('rules/save', (_event, input: unknown) => saveRule(input))
  ipcMain.handle('rules/delete', (_event, ruleId: unknown) => deleteRule(ruleId))
  ipcMain.handle('rules/reorder', (_event, ruleIds: unknown) => reorderRules(ruleIds))
  ipcMain.handle('rules/setEnabled', (_event, ruleId: unknown, enabled: unknown) =>
    setRuleEnabled(ruleId, enabled)
  )
}
