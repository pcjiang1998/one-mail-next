import { describe, expect, it } from 'vitest'

import type { MailRuleCondition } from '../../shared/types'
import { mailRuleBodyText, matchMailRule } from './mail-rule-matcher'

const context = {
  recipients: ['team@example.com', 'backup@example.com'],
  sender: 'Alice@Example.com',
  subject: 'Quarterly report',
  body: 'Please review the attached report.',
  hasAttachment: true
}

function conditions(...items: MailRuleCondition[]): MailRuleCondition[] {
  return items
}

describe('mail rule matcher', () => {
  it('supports all text operators case-insensitively', () => {
    expect(
      matchMailRule(conditions({ field: 'sender', operator: 'contains', value: 'alice' }), context)
    ).toBe('match')
    expect(
      matchMailRule(
        conditions({ field: 'subject', operator: 'not_contains', value: 'invoice' }),
        context
      )
    ).toBe('match')
    expect(
      matchMailRule(
        conditions({ field: 'subject', operator: 'equals', value: 'QUARTERLY REPORT' }),
        context
      )
    ).toBe('match')
    expect(
      matchMailRule(
        conditions({ field: 'sender', operator: 'starts_with', value: 'alice@' }),
        context
      )
    ).toBe('match')
    expect(
      matchMailRule(
        conditions({ field: 'subject', operator: 'ends_with', value: 'REPORT' }),
        context
      )
    ).toBe('match')
  })

  it('matches recipient predicates against any recipient and negative against all', () => {
    expect(
      matchMailRule(
        conditions({ field: 'recipient', operator: 'equals', value: 'team@example.com' }),
        context
      )
    ).toBe('match')
    expect(
      matchMailRule(
        conditions({ field: 'recipient', operator: 'not_contains', value: 'blocked.example' }),
        context
      )
    ).toBe('match')
    expect(
      matchMailRule(
        conditions({ field: 'recipient', operator: 'not_contains', value: 'backup' }),
        context
      )
    ).toBe('no_match')
  })

  it('makes AND bind tighter than OR, with each connector joining the next row', () => {
    // A OR B AND C => A OR (B AND C)
    expect(
      matchMailRule(
        conditions(
          { field: 'sender', operator: 'equals', value: 'nobody', connector: 'or' },
          { field: 'subject', operator: 'contains', value: 'quarterly', connector: 'and' },
          { field: 'has_attachment', operator: 'equals', value: 'true' }
        ),
        context
      )
    ).toBe('match')
    // A AND B OR C => (A AND B) OR C
    expect(
      matchMailRule(
        conditions(
          { field: 'sender', operator: 'equals', value: 'alice@example.com', connector: 'and' },
          { field: 'subject', operator: 'contains', value: 'missing', connector: 'or' },
          { field: 'has_attachment', operator: 'equals', value: 'true' }
        ),
        context
      )
    ).toBe('match')
  })

  it('requires uncached body, recipient headers, or attachment state instead of guessing false', () => {
    expect(
      matchMailRule(
        conditions({ field: 'recipient', operator: 'contains', value: 'other@example.com' }),
        {
          ...context,
          recipientsKnown: false
        }
      )
    ).toBe('needs_body')
    expect(
      matchMailRule(conditions({ field: 'body', operator: 'contains', value: 'review' }), {
        ...context,
        body: undefined
      })
    ).toBe('needs_body')
    expect(
      matchMailRule(conditions({ field: 'has_attachment', operator: 'equals', value: 'false' }), {
        ...context,
        hasAttachment: undefined
      })
    ).toBe('needs_body')
    expect(() =>
      matchMailRule(
        conditions({ field: 'has_attachment', operator: 'contains', value: 'true' }),
        context
      )
    ).toThrow('布尔选择')
  })

  it('extracts only local text from HTML and never evaluates or fetches resources', () => {
    expect(
      mailRuleBodyText(
        undefined,
        '<script>throw new Error()</script><p>A &amp; B</p><img src="https://remote.invalid/pixel">'
      )
    ).toBe('A & B')
  })
})
