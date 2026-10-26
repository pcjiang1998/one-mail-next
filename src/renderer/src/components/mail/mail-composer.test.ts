import { describe, expect, it } from 'vitest'

import { getAttachmentKey, getUnselectedForwardAttachments, hasDraftContent } from './mail-composer'

describe('MailComposer empty drafts', () => {
  it.each(['', '<p></p>', '<p><br></p>', '<p> \n\t&nbsp; </p>', '<p>&#32;&#10;&#160;</p>'])(
    'does not save blank subject and blank rich text: %s',
    (bodyHtml) => {
      expect(
        hasDraftContent({ subject: ' \t\n', bodyText: ' \r\n\t\u00a0', bodyHtml, attachments: [] })
      ).toBe(false)
    }
  )

  it.each([
    { subject: 'Subject', bodyText: '', bodyHtml: '', attachments: [] },
    { subject: '', bodyText: 'Content', bodyHtml: '', attachments: [] },
    { subject: '', bodyText: '', bodyHtml: '<p>&lt;Hello&gt;</p>', attachments: [] },
    {
      subject: '',
      bodyText: '',
      bodyHtml: '<img src="data:image/png;base64,AA==">',
      attachments: []
    },
    { subject: '', bodyText: '', bodyHtml: '', attachments: [{ filename: 'report.pdf' }] }
  ])('keeps meaningful draft content: %o', (form) => {
    expect(hasDraftContent(form)).toBe(true)
  })
})

describe('MailComposer forwarded attachments', () => {
  it('keeps unselected forward attachments separate from selected attachments', () => {
    const first = {
      sourceMessageId: 1,
      sourceAttachmentId: 10,
      filename: 'one.txt',
      sizeBytes: 100
    }
    const second = {
      sourceMessageId: 1,
      sourceAttachmentId: 11,
      filename: 'two.txt',
      sizeBytes: 200
    }

    expect(getAttachmentKey(first)).toBe('source:1:10')
    expect(
      getUnselectedForwardAttachments(
        {
          kind: 'forward',
          accountId: 1,
          to: [],
          cc: [],
          bcc: [],
          subject: 'Fwd',
          bodyText: '',
          forwardAttachments: [first, second]
        },
        [first]
      )
    ).toEqual([second])
  })

  it('does not confuse forwarded attachments with local attachments of the same filename', () => {
    const forwarded = {
      sourceMessageId: 1,
      sourceAttachmentId: 10,
      filename: 'report.pdf',
      sizeBytes: 100
    }
    const local = {
      filePath: '/tmp/report.pdf',
      filename: 'report.pdf',
      sizeBytes: 100
    }

    expect(getAttachmentKey(forwarded)).not.toBe(getAttachmentKey(local))
    expect(
      getUnselectedForwardAttachments(
        {
          kind: 'forward',
          accountId: 1,
          to: [],
          cc: [],
          bcc: [],
          subject: 'Fwd',
          bodyText: '',
          forwardAttachments: [forwarded]
        },
        [local]
      )
    ).toEqual([forwarded])
  })
})
