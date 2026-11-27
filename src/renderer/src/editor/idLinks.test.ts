// @vitest-environment jsdom
// 本文の中の ID の印。画面の飾りだけで、本文（書き出す md）は変えないことを確かめる

import { editorViewCtx, type Editor } from '@milkdown/kit/core'
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

  const openedIds: string[] = []
  const openedUrls: string[] = []

  afterEach(() => {
    openedIds.length = 0
    openedUrls.length = 0
  })

  async function open(markdown: string, titles: Record<string, string>): Promise<HTMLElement> {
    const root = document.createElement('div')
    document.body.appendChild(root)
    const editor = await createMarkdownEditor({
      root,
      markdown,
      idLinks: {
        titleOf: (id) => titles[id],
        open: (id) => openedIds.push(id),
        openUrl: (url) => openedUrls.push(url)
      }
    })
    editors.push(editor)
    expect(getMarkdown(editor)).toBe(markdown)
    return root
  }

  /** 文字 text の真ん中を（修飾キーを付けて）クリックする。ProseMirror の handleClick までを通す */
  function clickOn(root: HTMLElement, text: string, init: MouseEventInit): void {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
    let node: globalThis.Node | null
    while ((node = walker.nextNode())) {
      const index = node.textContent?.indexOf(text) ?? -1
      if (index < 0) continue
      // jsdom は位置を計算しないので、クリックの位置から文書の位置を引く処理を、文字の位置で置き換える
      const editorView = editors[editors.length - 1].action((ctx) => ctx.get(editorViewCtx))
      const pos = editorView.posAtDOM(node, index + Math.floor(text.length / 2))
      editorView.someProp('handleClick', (f) =>
        f(editorView, pos, new MouseEvent('click', { bubbles: true, ...init }))
      )
      return
    }
    throw new Error(`${text} が見つかりません`)
  }

  // テストは Windows・Linux として動く（Ctrl だけを受ける。Mac の ⌘ だけを受けることは keys.test.ts の isModKey）
  it('http/https のリンクは Ctrl+クリックでブラウザに渡し、ふつうのクリックでは渡さない', async () => {
    const root = await open(
      '[手順書](https://example.com/manual) と <http://example.com/bare> と [ファイル](file:///C:/x.exe)\n',
      {}
    )
    clickOn(root, '手順書', {})
    expect(openedUrls).toEqual([])
    clickOn(root, '手順書', { ctrlKey: true })
    clickOn(root, 'example.com/bare', { ctrlKey: true })
    clickOn(root, 'ファイル', { ctrlKey: true })
    expect(openedUrls).toEqual(['https://example.com/manual', 'http://example.com/bare'])
    // Windows・Linux の Win キー（metaKey）+クリックでは開かない
    clickOn(root, '手順書', { metaKey: true })
    expect(openedUrls).toHaveLength(2)
    expect(openedIds).toEqual([])
  })

  it('チケットやノートへのリンクは、ブラウザではなくアプリで開く', async () => {
    const root = await open('[定例](../notes/20261015-1400-mt01_定例.md)\n', {
      '20261015-1400-mt01': 'A社定例'
    })
    clickOn(root, '定例', { ctrlKey: true })
    expect(openedIds).toEqual(['20261015-1400-mt01'])
    expect(openedUrls).toEqual([])
  })

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
