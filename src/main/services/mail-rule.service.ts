import { BrowserWindow } from 'electron'

import type { MailRule } from '../../shared/types'

export {
  enqueueMailRulesForNewMessages,
  processPendingMailRules,
  type MailRuleAdmissionOptions,
  type MailRuleRunResult
} from './mail-rule-engine.service'
import {
  deleteMailRule,
  listMailRules,
  reorderMailRules,
  saveMailRule,
  setMailRuleEnabled
} from '../db/repositories/mail-rule.repository'

export function getMailRules(): MailRule[] {
  return listMailRules()
}

export function saveRule(input: unknown): MailRule {
  const rule = saveMailRule(input)
  broadcastRulesChanged()
  return rule
}

export function deleteRule(ruleId: unknown): boolean {
  const deleted = deleteMailRule(ruleId)
  if (deleted) broadcastRulesChanged()
  return deleted
}

export function reorderRules(ruleIds: unknown): MailRule[] {
  const rules = reorderMailRules(ruleIds)
  broadcastRulesChanged(rules)
  return rules
}

export function setRuleEnabled(ruleId: unknown, enabled: unknown): MailRule {
  const rule = setMailRuleEnabled(ruleId, enabled)
  broadcastRulesChanged()
  return rule
}

export function broadcastRulesChanged(rules = listMailRules()): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) window.webContents.send('rules/changed', rules)
  }
}
