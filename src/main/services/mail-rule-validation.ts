import { z } from 'zod'

import type { MailRuleInput } from '../../shared/types'

export const MAIL_RULE_LIMITS = {
  rules: 100,
  name: 120,
  conditions: 20,
  value: 2048,
  actions: 3,
  note: 2000,
  reminders: 10
} as const

const id = z.number().int().positive().max(Number.MAX_SAFE_INTEGER)
const condition = z
  .object({
    field: z.enum(['recipient', 'sender', 'subject', 'body', 'has_attachment']),
    operator: z.enum(['contains', 'not_contains', 'equals', 'starts_with', 'ends_with']),
    value: z
      .string()
      .max(MAIL_RULE_LIMITS.value)
      .refine((value) => value.trim().length > 0, '条件值不能为空'),
    connector: z.enum(['and', 'or']).optional()
  })
  .strict()
  .superRefine((value, ctx) => {
    if (
      value.field === 'has_attachment' &&
      (value.operator !== 'equals' || !['true', 'false'].includes(value.value))
    ) {
      ctx.addIssue({ code: 'custom', message: '附件条件必须使用等于及“有附件 / 无附件”选择' })
    }
  })
const action = z.discriminatedUnion('type', [
  z.object({ type: z.literal('mark_read') }).strict(),
  z
    .object({
      type: z.literal('add_to_board'),
      note: z.string().max(MAIL_RULE_LIMITS.note).optional(),
      reminderMinutes: z
        .array(z.number().int().min(1).max(525600))
        .max(MAIL_RULE_LIMITS.reminders)
        .refine((values) => new Set(values).size === values.length, '提醒时间不能重复')
        .optional()
    })
    .strict(),
  z.object({ type: z.literal('move_to_trash') }).strict()
])
const ruleInput = z
  .object({
    ruleId: id.optional(),
    name: z.string().trim().min(1).max(MAIL_RULE_LIMITS.name),
    accountId: id.optional(),
    enabled: z.boolean(),
    sortOrder: z.number().int().min(0).max(1_000_000),
    conditions: z.array(condition).min(1).max(MAIL_RULE_LIMITS.conditions),
    actions: z
      .array(action)
      .min(1)
      .max(MAIL_RULE_LIMITS.actions)
      .refine(
        (values) => new Set(values.map((item) => item.type)).size === values.length,
        '同一规则不能重复添加相同动作'
      )
  })
  .strict()
  .superRefine((value, ctx) => {
    const last = value.conditions.length - 1
    value.conditions.forEach((item, index) => {
      if (index === last && item.connector !== undefined) {
        ctx.addIssue({
          code: 'custom',
          path: ['conditions', index, 'connector'],
          message: '最后一条条件不能连接到下一条'
        })
      }
    })
  })

/** Treat all IPC data as untrusted; return a new, bounded, canonical value. */
export function validateMailRuleInput(input: unknown): MailRuleInput {
  const parsed = ruleInput.safeParse(input)
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    throw new Error(`邮件规则无效（${issue.path.join('.') || '规则'}）：${issue.message}。`)
  }
  return parsed.data
}

export function validateMailRuleId(value: unknown): number {
  const parsed = id.safeParse(value)
  if (!parsed.success) throw new Error('规则 ID 必须是正整数。')
  return parsed.data
}

export function validateMailRuleOrder(value: unknown): number[] {
  const parsed = z.array(id).max(MAIL_RULE_LIMITS.rules).safeParse(value)
  if (!parsed.success || new Set(parsed.data).size !== parsed.data.length) {
    throw new Error('规则排序必须是不重复的有效 ID 完整排列。')
  }
  return parsed.data
}
