import { normalizeMailDisplayText } from '../../shared/mail-text'

export function readMimeFilename(params: Map<string, string>, name: string): string | undefined {
  let value = params.get(`${name}*`)
  let encoded = value !== undefined
  if (value === undefined && (params.has(`${name}*0*`) || params.has(`${name}*0`))) {
    encoded = params.has(`${name}*0*`)
    value = ''
    for (let index = 0; ; index++) {
      const part = params.get(`${name}*${index}*`) ?? params.get(`${name}*${index}`)
      if (part === undefined) break
      value += part
    }
  }
  if (value === undefined) return normalizeMailDisplayText(params.get(name))
  if (!encoded) return normalizeMailDisplayText(value)
  const match = /^([^']*)'[^']*'(.*)$/.exec(value)
  if (!match) throw new Error('附件文件名的 MIME 参数编码无效。')
  const bytes: number[] = []
  for (let index = 0; index < match[2].length; index++) {
    const char = match[2][index]
    if (char === '%') {
      const hex = match[2].slice(index + 1, index + 3)
      if (!/^[0-9a-f]{2}$/i.test(hex)) throw new Error('附件文件名的百分号编码无效。')
      bytes.push(parseInt(hex, 16))
      index += 2
    } else bytes.push(char.charCodeAt(0))
  }
  return normalizeMailDisplayText(
    new TextDecoder(match[1] || 'utf-8').decode(new Uint8Array(bytes))
  )
}
