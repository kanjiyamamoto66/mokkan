// @vitest-environment jsdom
// 検索の結果から開いたときに、本文で当たった箇所を選ぶか

import { editorViewCtx, type Editor } from '@milkdown/kit/core'
import { afterEach, describe, expect, it } from 'vitest'
import { selectFirstMatch } from './findText'
import { createMarkdownEditor } from './markdown'

// jsdom には文字の範囲の位置を測る機能がないので、カーソルへのスクロールの計算のために空の値を返す
Range.prototype.getClientRects ??= () => [] as unknown as DOMRectList
Range.prototype.getBoundingClientRect ??= () => new DOMRect()

const editors: Editor[] = []

afterEach(async () => {
  await Promise.all(editors.splice(0).map((e) => e.destroy()))
  document.body.innerHTML = ''
})

async function open(markdown: string): Promise<Editor> {
  const root = document.createElement('div')
  document.body.appendChild(root)
  const editor = await createMarkdownEditor({ root, markdown })
  editors.push(editor)
  return editor
}

const selected = (editor: Editor): string =>
  editor.action((ctx) => {
    const { state } = ctx.get(editorViewCtx)
    return state.doc.textBetween(state.selection.from, state.selection.to)
  })

describe('selectFirstMatch', () => {
  it('タイトルより本文の中を先に探して選ぶ。大文字小文字・全角半角を区別しない', async () => {
    const editor = await open('# 見積書を送る\n\n前回のＡ社の見積と同じ\n')
    expect(selectFirstMatch(editor, '見積')).toBe(true)
    expect(selected(editor)).toBe('見積')
    expect(selectFirstMatch(editor, 'a社')).toBe(true)
    expect(selected(editor)).toBe('Ａ社')
  })

  it('本文になければタイトルを選び、どこにもなければ false', async () => {
    const editor = await open('# 見積書を送る\n\nメモ\n')
    expect(selectFirstMatch(editor, '送る')).toBe(true)
    expect(selected(editor)).toBe('送る')
    expect(selectFirstMatch(editor, '請求')).toBe(false)
  })
})
