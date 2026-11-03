// @vitest-environment jsdom
// 本文の中の ID の印。画面の飾りだけで、本文（書き出す md）は変えないことを確かめる

import type { Editor } from '@milkdown/kit/core'
import { afterEach, describe, expect, it } from 'vitest'
import { findIds } from './idLinks'
import { createMarkdownEditor, getMarkdown } from './markdown'

describe('findIds', () => {
  it('文の中の ID を探す', () => {
    const text = '見積書を送る → 20261015-1510-mt02、20261015-1400-mt01の続き'
    expect(findIds(text).map((m) => [m.id, text.slice(m.start, m.end)])).toEqual([
      ['20261015-1510-mt02', '20261015-1510-mt02'],
      ['20261015-1400-mt01', '20261015-1400-mt01']
    ])
  })

  it('英数字に続いているものや、形の違うものは ID とみなさない', () => {
    expect(findIds('x20261015-1510-mt02 20261015-1510-mt02a 20261015-151-mt02')).toEqual([])
    expect(findIds('20261015-1510-MT02')).toEqual([])
  })
})

describe('ID の印', () => {
  const editors: Editor[] = []

  afterEach(async () => {
    await Promise.all(editors.splice(0).map((e) => e.destroy()))
    document.body.innerHTML = ''
  })

  async function open(markdown: string, titles: Record<string, string>): Promise<HTMLElement> {
    const root = document.createElement('div')
    document.body.appendChild(root)
    const editor = await createMarkdownEditor({
      root,
      markdown,
      idLinks: { titleOf: (id) => titles[id], open: () => {} }
    })
    editors.push(editor)
    expect(getMarkdown(editor)).toBe(markdown)
    return root
  }

  it('知っている ID に印とタイトルを付け、本文は変えない', async () => {
    const root = await open(
      '## 宿題\n\n- 見積書を送る → 20261015-1510-mt02\n- 不明 → 20261015-0000-zzzz\n',
      { '20261015-1510-mt02': 'A社に見積書を送る' }
    )
    const links = [...root.querySelectorAll('.id-link')]
    expect(links.map((l) => [l.textContent, l.classList.contains('unknown')])).toEqual([
      ['20261015-1510-mt02', false],
      ['20261015-0000-zzzz', true]
    ])
    expect([...root.querySelectorAll('.id-title')].map((t) => t.textContent)).toEqual([
      'A社に見積書を送る'
    ])
  })

  it('コードの中の ID には印を付けない', async () => {
    const root = await open('`20261015-1510-mt02`\n\n```\n20261015-1510-mt02\n```\n', {
      '20261015-1510-mt02': 'A'
    })
    expect(root.querySelectorAll('.id-link')).toHaveLength(0)
  })
})
