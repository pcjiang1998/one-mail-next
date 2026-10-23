import { describe, expect, it } from 'vitest'

import { validateMailRuleInput, validateMailRuleOrder } from './mail-rule-validation'

const base = {
  name: '安全规则',
  enabled: true,
  sortOrder: 0,
  conditions: [{ field: 'subject', operator: 'contains', value: 'report' }],
  actions: [{ type: 'mark_read' }]
} as const

describe('mail rule validation', () => {
  it('requires attachment conditions to use a boolean selection', () => {
    expect(() =>
      validateMailRuleInput({
        ...base,
        conditions: [{ field: 'has_attachment', operator: 'contains', value: 'yes' }]
      })
    ).toThrow('附件条件')
    expect(
      validateMailRuleInput({
        ...base,
        conditions: [{ field: 'has_attachment', operator: 'equals', value: 'true' }]
      }).conditions[0].value
    ).toBe('true')
  })

  it('treats connector as the link to the next condition and rejects a dangling final connector', () => {
    expect(() =>
      validateMailRuleInput({
        ...base,
        conditions: [{ field: 'subject', operator: 'contains', value: 'a', connector: 'and' }]
      })
    ).toThrow('最后一条条件')
    expect(
      validateMailRuleInput({
        ...base,
        conditions: [
          { field: 'subject', operator: 'contains', value: 'a', connector: 'or' },
          { field: 'sender', operator: 'contains', value: 'b' }
        ]
      }).conditions
    ).toHaveLength(2)
  })

  it('rejects duplicate or incomplete reorder input before any SQL runs', () => {
    expect(() => validateMailRuleOrder([1, 1])).toThrow('不重复')
    expect(validateMailRuleOrder([3, 1, 2])).toEqual([3, 1, 2])
  })
})
