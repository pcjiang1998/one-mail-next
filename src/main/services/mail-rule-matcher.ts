import type { MailRuleCondition, MailRuleOperator } from '../../shared/types'

export type MailRuleMatchContext = {
  recipients: string[]
  /** False means headers containing To/Cc/Bcc are not cached yet. */
  recipientsKnown?: boolean
  sender: string
  subject: string
  /** Undefined means not cached/known, NOT an empty body or no attachments. */
  body?: string
  hasAttachment?: boolean
}

export type MailRuleMatchResult = 'match' | 'no_match' | 'needs_body'
type Truth = boolean | undefined

/**
 * Each connector joins its condition to the NEXT one. AND binds more tightly
 * than OR: A OR B AND C is A OR (B AND C). Missing connectors default to AND;
 * the last connector is ignored. Unknown body data never silently becomes false.
 */
export function matchMailRule(
  conditions: readonly MailRuleCondition[],
  message: MailRuleMatchContext
): MailRuleMatchResult {
  if (conditions.length === 0) return 'no_match'
  let result: Truth = false
  let group: Truth = true
  for (let index = 0; index < conditions.length; index += 1) {
    const condition = conditions[index]
    group = and(group, matchCondition(condition, message))
    if (index === conditions.length - 1 || condition.connector === 'or') {
      result = or(result, group)
      group = true
    }
  }
  return result === undefined ? 'needs_body' : result ? 'match' : 'no_match'
}

function matchCondition(condition: MailRuleCondition, message: MailRuleMatchContext): Truth {
  if (condition.field === 'has_attachment') {
    if (condition.operator !== 'equals' || !['true', 'false'].includes(condition.value)) {
      throw new Error('附件条件必须使用布尔选择。')
    }
    return message.hasAttachment === undefined
      ? undefined
      : message.hasAttachment === (condition.value === 'true')
  }
  if (condition.field === 'body' && message.body === undefined) return undefined
  if (condition.field === 'recipient' && message.recipientsKnown === false) return undefined
  const values =
    condition.field === 'recipient'
      ? message.recipients
      : [
          condition.field === 'sender'
            ? message.sender
            : condition.field === 'subject'
              ? message.subject
              : (message.body ?? '')
        ]
  // A negative address predicate means NONE of the recipients contains it.
  return condition.operator === 'not_contains'
    ? values.every((value) => !matchText(value, 'contains', condition.value))
    : values.some((value) => matchText(value, condition.operator, condition.value))
}

function matchText(value: string, operator: MailRuleOperator, needle: string): boolean {
  const text = value.normalize('NFKC').toLowerCase()
  const expected = needle.normalize('NFKC').toLowerCase()
  switch (operator) {
    case 'contains':
      return text.includes(expected)
    case 'not_contains':
      return !text.includes(expected)
    case 'equals':
      return text === expected
    case 'starts_with':
      return text.startsWith(expected)
    case 'ends_with':
      return text.endsWith(expected)
    default:
      throw new Error('不支持的规则条件。')
  }
}

function and(left: Truth, right: Truth): Truth {
  if (left === false || right === false) return false
  return left === undefined || right === undefined ? undefined : true
}

function or(left: Truth, right: Truth): Truth {
  if (left === true || right === true) return true
  return left === undefined || right === undefined ? undefined : false
}

/** Text-only conversion. No browser, image loading, URL fetch or HTML execution. */
export function mailRuleBodyText(text?: string | null, html?: string | null): string {
  if (text != null && text !== '') return text
  return (html ?? '')
    .replace(/<(script|style|head)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&(#x[0-9a-f]+|#\d+|nbsp|amp|lt|gt|quot|apos);/gi, (entity, code: string) => {
      if (code[0] === '#') {
        const point =
          code[1].toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10)
        return point > 0 && point <= 0x10ffff && !(point >= 0xd800 && point <= 0xdfff)
          ? String.fromCodePoint(point)
          : entity
      }
      return (
        { nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" } as Record<string, string>
      )[code.toLowerCase()]
    })
    .replace(/\s+/g, ' ')
    .trim()
}
