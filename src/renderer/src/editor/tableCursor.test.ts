// @vitest-environment jsdom
// 表のカーソルのあるセル・行・列に印が付き、本文は変わらないか

import { editorViewCtx, type Editor } from '@milkdown/kit/core'
import { TextSelection } from '@milkdown/kit/prose/state'
import { afterEach, describe, expect, it } from 'vitest'
import { createMarkdownEditor, getMarkdown } from './markdown'

const editors: Editor[] = []

async function open(markdown: string): Promise<{ editor: Editor; root: HTMLElement }> {
  const root = document.createElement('div')
  document.body.appendChild(root)
  const editor = await createMarkdownEditor({ root, markdown })
  editors.push(editor)
  return { editor, root }
}

afterEach(async () => {
  await Promise.all(editors.splice(0).map((e) => e.destroy()))
  document.body.innerHTML = ''
})

/** text の先頭にカーソルを置く */
function placeCursor(editor: Editor, text: string): void {
  editor.action((ctx) => {
    const view = ctx.get(editorViewCtx)
    let from = -1
    view.state.doc.descendants((node, pos) => {
      if (from >= 0) return false
      if (node.isText && node.text!.includes(text)) from = pos + node.text!.indexOf(text)
      return true
    })
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, from)))
  })
}

const table = '| 項目 | 金額 |\n| --- | --- |\n| 見積 | 1,000円 |\n| 請求 | 2,000円 |\n'

describe('表のカーソルの印', () => {
  it('カーソルのあるセルと、その行・列に印を付ける', async () => {
    const { editor, root } = await open(table)
    placeCursor(editor, '1,000')
    const text = (selector: string): string[] =>
      [...root.querySelectorAll(selector)].map((el) => el.textContent ?? '')
    expect(text('.mk-current-cell')).toEqual(['1,000円'])
    expect(text('.mk-current-col')).toEqual(['金額', '1,000円', '2,000円'])
    expect(text('tr.mk-current-row')).toEqual(['見積1,000円'])
  })

  it('表の外では印を付けず、本文も変えない', async () => {
    const { editor, root } = await open(`見出しの前\n\n${table}`)
    const before = getMarkdown(editor)
    placeCursor(editor, '見出しの前')
    expect(
      root.querySelectorAll('.mk-current-cell, .mk-current-col, .mk-current-row')
    ).toHaveLength(0)
    placeCursor(editor, '請求')
    expect(root.querySelector('.mk-current-cell')?.textContent).toBe('請求')
    expect(getMarkdown(editor)).toBe(before)
  })
})
