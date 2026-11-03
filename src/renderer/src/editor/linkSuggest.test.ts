// @vitest-environment jsdom
// [[ と打ったときの候補のきっかけと、選んだときに入る md のリンク

import { editorViewCtx, type Editor } from '@milkdown/kit/core'
import { TextSelection } from '@milkdown/kit/prose/state'
import { afterEach, describe, expect, it } from 'vitest'
import { findLinkQuery, insertLink } from './linkSuggest'
import { createMarkdownEditor, getMarkdown } from './markdown'

const editors: Editor[] = []
const openedIds: string[] = []

async function open(markdown: string): Promise<Editor> {
  const root = document.createElement('div')
  document.body.appendChild(root)
  const editor = await createMarkdownEditor({
    root,
    markdown,
    idLinks: {
      titleOf: (id) => (id === '20261015-1400-mt01' ? 'A社定例' : undefined),
      open: (id) => openedIds.push(id)
    }
  })
  editors.push(editor)
  return editor
}

afterEach(async () => {
  await Promise.all(editors.splice(0).map((e) => e.destroy()))
  document.body.innerHTML = ''
  openedIds.length = 0
})

/** 文字を打った後のように、text の後ろにカーソルを置く */
function cursorAfter(editor: Editor, text: string): void {
  editor.action((ctx) => {
    const view = ctx.get(editorViewCtx)
    let at = -1
    view.state.doc.descendants((node, pos) => {
      if (at >= 0) return false
      if (node.isText && node.text!.includes(text))
        at = pos + node.text!.indexOf(text) + text.length
      return true
    })
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, at)))
  })
}

const query = (editor: Editor): ReturnType<typeof findLinkQuery> =>
  editor.action((ctx) => findLinkQuery(ctx.get(editorViewCtx).state))

describe('[[ のきっかけ', () => {
  it('[[ と、日本語入力のままの「「 の後ろの文字を拾う', async () => {
    const editor = await open('前回の[[A社 の続き\n')
    cursorAfter(editor, '[[A社')
    expect(query(editor)).toMatchObject({ query: 'A社' })

    const ime = await open('前回の「「てい\n')
    cursorAfter(ime, '「「てい')
    expect(query(ime)).toMatchObject({ query: 'てい' })
  })

  it('閉じたもの・コードの中・きっかけのないところでは拾わない', async () => {
    const closed = await open('[[A社]] の続き\n')
    cursorAfter(closed, '続き')
    expect(query(closed)).toBeNull()

    const code = await open('`[[A社`\n')
    cursorAfter(code, '[[A社')
    expect(query(code)).toBeNull()
  })
})

describe('リンクを入れる', () => {
  it('[[ と打った文字を、標準の md のリンクに置き換える（[[ はファイルに残さない）', async () => {
    const editor = await open('前回の[[てい の続き\n')
    cursorAfter(editor, '[[てい')
    editor.action((ctx) => {
      const view = ctx.get(editorViewCtx)
      insertLink(
        view,
        findLinkQuery(view.state)!,
        'A社定例',
        '../notes/20261015-1400-mt01_A社定例.md'
      )
    })
    expect(getMarkdown(editor)).toBe(
      '前回の[A社定例](../notes/20261015-1400-mt01_A社定例.md) の続き\n'
    )
  })

  it('ファイル名に空白があるときも、読み直すと同じリンクになる', async () => {
    const editor = await open('[[\n')
    cursorAfter(editor, '[[')
    editor.action((ctx) => {
      const view = ctx.get(editorViewCtx)
      insertLink(
        view,
        findLinkQuery(view.state)!,
        '定例 10月',
        '../notes/20261015-1400-mt01_定例 10月.md'
      )
    })
    const markdown = getMarkdown(editor)
    expect(markdown).toBe('[定例 10月](<../notes/20261015-1400-mt01_定例 10月.md>)\n')
    const reopened = await open(markdown)
    expect(getMarkdown(reopened)).toBe(markdown)
  })
})

describe('md のリンクを ID で開く', () => {
  it('リンク先のファイル名の ID に印を付け、Ctrl+クリックで開く', async () => {
    const editor = await open('[A社定例](../notes/20261015-1400-mt01_古い名前.md) の続き\n')
    const root = editor.action((ctx) => ctx.get(editorViewCtx).dom)
    const link = root.querySelector('.file-link')
    expect(link?.getAttribute('title')).toContain('A社定例')
  })

  it('見つからないリンク先には unknown の印を付ける', async () => {
    const editor = await open('[消えた](../tickets/20261001-0000-zzzz_x.md)\n')
    const root = editor.action((ctx) => ctx.get(editorViewCtx).dom)
    expect(root.querySelector('.file-link.unknown')).not.toBeNull()
  })
})
