import { handleDatabaseIpc } from './database-handler'

import {
  deleteRule,
  getMailRules,
  reorderRules,
  saveRule,
  setRuleEnabled
} from '../services/mail-rule.service'

export function registerRulesIpc(): void {
  handleDatabaseIpc('rules/list', () => getMailRules())
  handleDatabaseIpc('rules/save', (_event, input: unknown) => saveRule(input))
  handleDatabaseIpc('rules/delete', (_event, ruleId: unknown) => deleteRule(ruleId))
  handleDatabaseIpc('rules/reorder', (_event, ruleIds: unknown) => reorderRules(ruleIds))
  handleDatabaseIpc('rules/setEnabled', (_event, ruleId: unknown, enabled: unknown) =>
    setRuleEnabled(ruleId, enabled)
  )
}
