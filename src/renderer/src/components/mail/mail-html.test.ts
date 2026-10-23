import { describe, expect, it } from 'vitest'

import { prepareMailHtml } from './mail-html'

describe('prepareMailHtml privacy resource policy', () => {
  const html = `
    <p>Message</p>
    <img src="https://cdn.example.test/logo.png" alt="logo">
    <img src="https://track.example.test/pixel.gif" width="1" height="1">
    <img srcset="https://cdn.example.test/a.png 1x, https://track.example.test/pixel.gif 2x">
    <div style="color:red;background-image:url(https://cdn.example.test/bg.png)">card</div>
    <style>@import url(https://track.example.test/theme.css); body { background:url(https://track.example.test/css.png) }</style>
    <svg><image href="https://track.example.test/svg.png" /></svg>
  `

  it('unrestricted loads remote images but still removes unsafe SVG/style content', () => {
    const result = prepareMailHtml(html, { mode: 'unrestricted' })
    const wrapper = document.createElement('div')
    wrapper.innerHTML = result.html

    expect(wrapper.querySelector('img[src="https://cdn.example.test/logo.png"]')).not.toBeNull()
    expect(wrapper.querySelector('img[src="https://track.example.test/pixel.gif"]')).not.toBeNull()
    expect(wrapper.querySelector('svg')).toBeNull()
    expect(wrapper.querySelector('style')).toBeNull()
    expect(wrapper.innerHTML).not.toContain('track.example.test/theme.css')
    expect(wrapper.querySelector('[style*="cdn.example.test/bg.png"]')).not.toBeNull()
  })

  it('loose loads ordinary images but blocks recognizable tracking resources', () => {
    const result = prepareMailHtml(html, { mode: 'loose' })
    const wrapper = document.createElement('div')
    wrapper.innerHTML = result.html

    expect(wrapper.querySelector('img[src="https://cdn.example.test/logo.png"]')).not.toBeNull()
    expect(wrapper.querySelector('img[src="https://track.example.test/pixel.gif"]')).toBeNull()
    expect(result.blockedTrackerResourceCount).toBeGreaterThan(0)
    expect(wrapper.innerHTML).toContain('data-blocked-src="https://track.example.test/pixel.gif"')
  })

  it('strict blocks ordinary images until the per-message action and keeps originals reversible', () => {
    const preview = prepareMailHtml(html, { mode: 'strict' })
    const previewRoot = document.createElement('div')
    previewRoot.innerHTML = preview.html
    expect(previewRoot.querySelector('img[src="https://cdn.example.test/logo.png"]')).toBeNull()
    expect(previewRoot.querySelector('[style*="cdn.example.test/bg.png"]')).toBeNull()
    expect(previewRoot.innerHTML).toContain('data-blocked-src="https://cdn.example.test/logo.png"')

    const afterMessageAction = prepareMailHtml(preview.html, {
      mode: 'strict',
      allowRemoteImages: true
    })
    const fullRoot = document.createElement('div')
    fullRoot.innerHTML = afterMessageAction.html
    expect(fullRoot.querySelector('img[src="https://cdn.example.test/logo.png"]')).not.toBeNull()
    expect(fullRoot.querySelector('img[src="https://track.example.test/pixel.gif"]')).toBeNull()
    expect(fullRoot.querySelector('[style*="cdn.example.test/bg.png"]')).not.toBeNull()
    expect(afterMessageAction.blockedTrackerResourceCount).toBeGreaterThan(0)
  })

  it('does not leak CSS, srcset, background, or SVG external URLs when blocked', () => {
    const result = prepareMailHtml(
      '<img srcset="https://cdn.example.test/a.png 1x, https://cdn.example.test/b.png 2x"><div background="https://cdn.example.test/bg.png" style="background:url(https://cdn.example.test/css.png)">text</div><svg><use href="https://cdn.example.test/icon.svg#x" /></svg>',
      { mode: 'strict' }
    )
    const root = document.createElement('div')
    root.innerHTML = result.html

    expect(root.querySelector('img[srcset]')).toBeNull()
    expect(root.querySelector('[style*="url("]')).toBeNull()
    expect(root.querySelector('[background]')).toBeNull()
    expect(root.querySelector('svg')).toBeNull()
    expect(root.innerHTML).toContain('data-blocked-srcset=')
    expect(root.innerHTML).toContain('data-blocked-style=')
  })
})
