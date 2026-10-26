import { describe, expect, it } from 'vitest'
import { parseBodyStructure } from './imap-body-structure'

describe('IMAP MIME part identification', () => {
  it('decodes continued international filenames', () => {
    const parts = parseBodyStructure(
      `* 1 FETCH (BODYSTRUCTURE ("APPLICATION" "PDF" NIL NIL NIL "BASE64" 12 NIL ("ATTACHMENT" ("FILENAME*0*" "UTF-8''%E6%8A%A5" "FILENAME*1*" "%E5%91%8A.pdf"))))`
    )
    expect(parts[0].filename).toBe('报告.pdf')
  })
  it('keeps nested MIME section paths and distinguishes text attachments from body text', () => {
    const parts = parseBodyStructure(
      '* 1 FETCH (BODYSTRUCTURE ((("TEXT" "PLAIN" ("CHARSET" "UTF-8") NIL NIL "7BIT" 5 1)("TEXT" "HTML" NIL NIL NIL "7BIT" 9 1) "ALTERNATIVE")("TEXT" "PLAIN" NIL NIL NIL "BASE64" 4 1 NIL ("ATTACHMENT" ("FILENAME" "note.txt"))) "MIXED"))'
    )
    expect(parts.map((part) => [part.partId, part.mimeType, part.filename])).toEqual([
      ['1.1', 'text/plain', undefined],
      ['1.2', 'text/html', undefined],
      ['2', 'text/plain', 'note.txt']
    ])
  })

  it('supports literal filenames and quoted escape characters', () => {
    const parts = parseBodyStructure(
      '* 1 FETCH (BODYSTRUCTURE ("APPLICATION" "PDF" NIL NIL NIL "BASE64" 12 NIL ("ATTACHMENT" ("FILENAME" {9}\r\npaper.pdf))))'
    )
    expect(parts[0]).toMatchObject({ partId: '1', filename: 'paper.pdf', sizeBytes: 12 })
    expect(() => parseBodyStructure('* 1 FETCH (BODYSTRUCTURE (')).toThrow()
  })
})
