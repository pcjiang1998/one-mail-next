import { readMimeFilename } from './mime-parameter'

type ImapValue = string | number | null | ImapValue[]
export type ImapBodyPart = {
  partId: string
  mimeType: string
  charset: string
  encoding: string
  sizeBytes: number
  contentId?: string
  filename?: string
  contentDisposition?: 'attachment' | 'inline'
}

export function parseBodyStructure(response: string): ImapBodyPart[] {
  const match = /\bBODYSTRUCTURE\s+/i.exec(response)
  if (!match) throw new Error('IMAP 响应缺少 BODYSTRUCTURE。')
  let offset = match.index + match[0].length
  function parse(): ImapValue {
    while (/\s/.test(response[offset] ?? '') && offset < response.length) offset++
    const char = response[offset++]
    if (char === '(') {
      const list: ImapValue[] = []
      while (offset < response.length) {
        while (/\s/.test(response[offset] ?? '') && offset < response.length) offset++
        if (response[offset] === ')') {
          offset++
          return list
        }
        list.push(parse())
      }
      throw new Error('IMAP BODYSTRUCTURE 括号不完整。')
    }
    if (char === '"') {
      let result = ''
      while (offset < response.length) {
        const next = response[offset++]
        if (next === '"') return result
        result += next === '\\' ? response[offset++] : next
      }
      throw new Error('IMAP BODYSTRUCTURE 字符串不完整。')
    }
    if (char === '{') {
      const literal = /^(\d+)\}\r\n/.exec(response.slice(offset))
      if (!literal) throw new Error('IMAP BODYSTRUCTURE literal 无效。')
      offset += literal[0].length
      let remaining = Number(literal[1])
      const start = offset
      while (remaining > 0 && offset < response.length) {
        const point = String.fromCodePoint(response.codePointAt(offset)!)
        remaining -= Buffer.byteLength(point)
        offset += point.length
      }
      if (remaining !== 0) throw new Error('IMAP BODYSTRUCTURE literal 长度错误。')
      return response.slice(start, offset)
    }
    if (!char || char === ')') throw new Error('IMAP BODYSTRUCTURE 格式错误。')
    let atom = char
    while (offset < response.length && !/[\s()]/.test(response[offset])) atom += response[offset++]
    return /^NIL$/i.test(atom) ? null : /^\d+$/.test(atom) ? Number(atom) : atom
  }
  const structure = parse()
  if (!Array.isArray(structure)) throw new Error('IMAP BODYSTRUCTURE 不是列表。')
  return flatten(structure, '')
}

function parameters(value: ImapValue): Map<string, string> {
  const result = new Map<string, string>()
  if (!Array.isArray(value)) return result
  for (let i = 0; i + 1 < value.length; i += 2) {
    if (typeof value[i] === 'string' && typeof value[i + 1] === 'string') {
      result.set((value[i] as string).toLowerCase(), value[i + 1] as string)
    }
  }
  return result
}

function flatten(value: ImapValue[], prefix: string): ImapBodyPart[] {
  if (Array.isArray(value[0])) {
    const subtypeIndex = value.findIndex((item) => !Array.isArray(item))
    const disposition = value[subtypeIndex + 2]
    const params = parameters(value[subtypeIndex + 1])
    const dispositionParams = parameters(Array.isArray(disposition) ? disposition[1] : null)
    const filename =
      readMimeFilename(dispositionParams, 'filename') ?? readMimeFilename(params, 'name')
    if (
      prefix &&
      (filename ||
        (Array.isArray(disposition) && String(disposition[0]).toLowerCase() === 'attachment'))
    ) {
      return [
        {
          partId: prefix,
          mimeType: `multipart/${String(value[subtypeIndex]).toLowerCase()}`,
          charset: 'utf-8',
          encoding: '7bit',
          sizeBytes: 0,
          filename: filename ?? `part-${prefix}.mime`,
          contentDisposition: 'attachment'
        }
      ]
    }
    const parts: ImapBodyPart[] = []
    for (let i = 0; Array.isArray(value[i]); i++) {
      parts.push(...flatten(value[i] as ImapValue[], prefix ? `${prefix}.${i + 1}` : String(i + 1)))
    }
    return parts
  }
  const type = String(value[0]).toLowerCase()
  const subtype = String(value[1]).toLowerCase()
  const params = parameters(value[2])
  const dispositionIndex = type === 'text' ? 9 : type === 'message' && subtype === 'rfc822' ? 11 : 8
  const disposition = value[dispositionIndex]
  const dispositionParams = parameters(Array.isArray(disposition) ? disposition[1] : null)
  const dispositionName = Array.isArray(disposition) ? String(disposition[0]).toLowerCase() : ''
  const partId = prefix || '1'
  const filename =
    readMimeFilename(dispositionParams, 'filename') ?? readMimeFilename(params, 'name')
  const contentId = typeof value[3] === 'string' ? value[3] : undefined
  const attachment = Boolean(filename || dispositionName === 'attachment' || type !== 'text')
  return [
    {
      partId,
      mimeType: `${type}/${subtype}`,
      charset: params.get('charset') ?? 'utf-8',
      encoding: String(value[5]).toLowerCase(),
      sizeBytes: Number(value[6]),
      contentId,
      filename: attachment
        ? (filename ?? `part-${partId}.${subtype === 'rfc822' ? 'eml' : subtype}`)
        : undefined,
      contentDisposition: attachment
        ? dispositionName === 'inline'
          ? 'inline'
          : 'attachment'
        : undefined
    }
  ]
}
