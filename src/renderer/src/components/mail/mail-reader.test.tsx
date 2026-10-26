import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('@renderer/lib/api', () => ({
  translateMail: vi.fn()
}))

import type { Message } from './types'
import { MailReader } from './mail-reader'
import { I18nProvider } from '@renderer/lib/i18n'
import { translateMail } from '@renderer/lib/api'

afterEach(() => {
  vi.unstubAllGlobals()
})

function createMessage(overrides: Partial<Message> = {}): Message {
  return {
    id: '1',
    messageId: 1,
    accountId: 1,
    folderId: 1,
    from: '很长的发件人名称',
    fromAddress: 'sender@example.com',
    to: '真实收件人 <real-recipient@example.com>',
    subject: '测试邮件',
    preview: '邮件预览',
    body: ['正文内容'],
    bodyStatus: 'ready',
    bodyLoaded: true,
    detailLoaded: true,
    receivedAt: '2026-05-16T08:00:00.000Z',
    time: '16:00',
    dateLabel: '今天',
    unread: false,
    starred: false,
    attachments: [],
    ...overrides
  }
}

describe('MailReader metadata', () => {
  it('continues displaying cached content for a local-only message', () => {
    renderMailReader(
      <MailReader
        message={createMessage({ remoteMissing: true })}
        recipientAddress="account@example.com"
        onLoadBody={vi.fn()}
      />
    )
    expect(screen.getByRole('status')).toHaveTextContent('仅本地保留')
    expect(screen.getByText('正文内容')).toBeInTheDocument()
  })

  it('does not offer repeated body requests for an uncached missing message', () => {
    const onLoadBody = vi.fn()
    renderMailReader(
      <MailReader
        message={createMessage({
          remoteMissing: true,
          bodyLoaded: false,
          bodyStatus: 'error',
          body: []
        })}
        recipientAddress="account@example.com"
        onLoadBody={onLoadBody}
      />
    )
    fireEvent.click(screen.getByText('远端原位置已不存在，且本地未缓存正文，无法加载邮件内容。'))
    expect(onLoadBody).not.toHaveBeenCalled()
    expect(screen.queryByText('正文加载失败，点击重试')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '翻译' })).toBeDisabled()
  })

  it('uses the message To header before falling back to the account address', () => {
    renderMailReader(
      <MailReader
        message={createMessage()}
        recipientAddress="account@example.com"
        onLoadBody={() => {}}
      />
    )

    expect(screen.getByText('真实收件人 <real-recipient@example.com>')).toBeInTheDocument()
    expect(screen.queryByText('account@example.com')).not.toBeInTheDocument()
  })

  it('keeps sender and recipient values available as tooltip titles', () => {
    renderMailReader(
      <MailReader
        message={createMessage()}
        recipientAddress="account@example.com"
        onLoadBody={() => {}}
      />
    )

    expect(screen.getByText('很长的发件人名称 <sender@example.com>')).toHaveAttribute(
      'title',
      '很长的发件人名称 <sender@example.com>'
    )
    expect(screen.getByText('真实收件人 <real-recipient@example.com>')).toHaveAttribute(
      'title',
      '真实收件人 <real-recipient@example.com>'
    )
  })
})

describe('MailReader remote content', () => {
  it('shows full remote content automatically when remote blocking is disabled', async () => {
    const { container } = renderMailReader(
      <MailReader
        message={createMessage({
          html: '<p>Hello</p><img src="https://example.com/tracker.png">',
          bodyLoaded: true
        })}
        recipientAddress="account@example.com"
        externalImagesBlocked={false}
        onLoadBody={() => {}}
      />
    )

    await waitFor(() => {
      expect(container.querySelector('img')?.getAttribute('src')).toBe(
        'https://example.com/tracker.png'
      )
    })
    expect(screen.queryByText('加载完整内容')).not.toBeInTheDocument()
  })

  it('loads ordinary images on request while keeping trackers blocked by default', async () => {
    const { container } = renderMailReader(
      <MailReader
        message={createMessage({
          html: '<p>Hello</p><img src="https://example.com/photo.png"><img src="https://example.com/tracker.png">',
          bodyLoaded: true
        })}
        recipientAddress="account@example.com"
        onLoadBody={() => {}}
      />
    )

    const loadContent = await screen.findByText('加载完整内容')
    expect(container.querySelector('img[src]')).toBeNull()
    fireEvent.click(loadContent)
    await waitFor(() => {
      expect(container.querySelector('img[src="https://example.com/photo.png"]')).not.toBeNull()
    })
    expect(container.querySelector('img[src="https://example.com/tracker.png"]')).toBeNull()
  })
})

describe('MailReader privacy isolation', () => {
  it('applies each account mode and clears the per-message grant when switching messages', async () => {
    const privacyList = vi
      .fn()
      .mockResolvedValueOnce([
        { accountId: 1, mode: 'strict', resolvedMode: 'strict', trustedSenders: [] }
      ])
      .mockResolvedValueOnce([
        { accountId: 2, mode: 'unrestricted', resolvedMode: 'unrestricted', trustedSenders: [] }
      ])
      .mockResolvedValueOnce([
        { accountId: 1, mode: 'strict', resolvedMode: 'strict', trustedSenders: [] }
      ])
    vi.stubGlobal('api', { privacy: { list: privacyList } })

    const first = createMessage({
      id: 'privacy-a',
      accountId: 1,
      html: '<p>A</p><img src="https://cdn.example.test/a.png">'
    })
    const second = createMessage({
      id: 'privacy-b',
      accountId: 2,
      html: '<p>B</p><img src="https://cdn.example.test/b.png">'
    })
    const view = renderMailReader(
      <MailReader message={first} recipientAddress="account@example.com" onLoadBody={() => {}} />
    )

    expect(await screen.findByText('加载完整内容')).toBeInTheDocument()
    view.rerender(
      <I18nProvider>
        <MailReader message={second} recipientAddress="account@example.com" onLoadBody={() => {}} />
      </I18nProvider>
    )
    await waitFor(() => {
      expect(
        view.container.querySelector('img[src="https://cdn.example.test/b.png"]')
      ).not.toBeNull()
    })
    expect(screen.queryByText('加载完整内容')).not.toBeInTheDocument()

    view.rerender(
      <I18nProvider>
        <MailReader message={first} recipientAddress="account@example.com" onLoadBody={() => {}} />
      </I18nProvider>
    )
    expect(await screen.findByText('加载完整内容')).toBeInTheDocument()
  })
})

describe('MailReader translation', () => {
  it('translates only HTML text nodes without mutating the original used by reply', async () => {
    const message = createMessage({
      html: '<div class="message" style="color: red">Original <strong>content</strong></div>'
    })
    const onReply = vi.fn()
    vi.mocked(translateMail).mockResolvedValue({
      provider: 'google',
      targetLanguage: 'zh-CN',
      translatedText: '原始\n内容',
      translatedSegments: ['原始', '内容']
    })
    renderMailReader(
      <MailReader
        message={message}
        recipientAddress="account@example.com"
        onLoadBody={() => {}}
        onReply={onReply}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: '翻译' }))

    expect(await screen.findByText('译文')).toBeInTheDocument()
    expect(screen.getByText('原始')).toBeInTheDocument()
    expect(translateMail).toHaveBeenCalledWith({ segments: ['Original', 'content'] })
    expect(JSON.stringify(vi.mocked(translateMail).mock.calls)).not.toContain('color: red')
    expect(message.html).toBe(
      '<div class="message" style="color: red">Original <strong>content</strong></div>'
    )

    fireEvent.click(screen.getByRole('button', { name: '回复' }))
    expect(onReply).toHaveBeenCalledTimes(1)
  })
})

function renderMailReader(ui: React.ReactElement): ReturnType<typeof render> {
  return render(<I18nProvider>{ui}</I18nProvider>)
}
