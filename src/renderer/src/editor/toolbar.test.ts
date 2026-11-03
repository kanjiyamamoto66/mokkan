// @vitest-environment jsdom
// ツールバーの操作で付けた書式が、正式な書き方で書き出されるか

import { editorViewCtx, type Editor } from '@milkdown/kit/core'
import { TextSelection } from '@milkdown/kit/prose/state'
import { afterEach, describe, expect, it } from 'vitest'
import { mergeBody } from '../../../shared/body'
import { createMarkdownEditor, getMarkdown } from './markdown'
import { getToolbarState, runToolbarAction, setBlockLevel, setLink } from './toolbar'

// jsdom には文字の範囲の位置を測る機能がないので、カーソルへのスクロールの計算のために空の値を返す
const emptyRect = (): DOMRect => ({
  x: 0,
  y: 0,
  width: 0,
  height: 0,
  top: 0,
  left: 0,
  right: 0,
  bottom: 0,
  toJSON: () => ({})
})
Range.prototype.getClientRects ??= () => [] as unknown as DOMRectList
Range.prototype.getBoundingClientRect ??= emptyRect

const editors: Editor[] = []

async function open(markdown: string): Promise<Editor> {
  const root = document.createElement('div')
  document.body.appendChild(root)
  const editor = await createMarkdownEditor({ root, markdown })
  editors.push(editor)
  return editor
}

afterEach(async () => {
  await Promise.all(editors.splice(0).map((e) => e.destroy()))
  document.body.innerHTML = ''
})

/** text が最初に出てくる位置を選択する（length を省くとその文字の先頭にカーソルを置く） */
function select(editor: Editor, text: string, length = 0): void {
  editor.action((ctx) => {
    const view = ctx.get(editorViewCtx)
    let from = -1
    view.state.doc.descendants((node, pos) => {
      if (from >= 0) return false
      if (node.isText && node.text!.includes(text)) from = pos + node.text!.indexOf(text)
      return true
    })
    if (from < 0) throw new Error(`${text} が見つかりません`)
    view.dispatch(
      view.state.tr.setSelection(TextSelection.create(view.state.doc, from, from + length))
    )
  })
}

describe('太字・取り消し線', () => {
  it('選んだ文字に付けて、正式な書き方で書き出す', async () => {
    const editor = await open('見積書を送る\n')
    select(editor, '見積書', 3)
    runToolbarAction(editor, 'strong')
    expect(getMarkdown(editor)).toBe('**見積書**を送る\n')
    expect(getToolbarState(editor).strong).toBe(true)

    select(editor, '送る', 2)
    runToolbarAction(editor, 'strike')
    expect(getMarkdown(editor)).toBe('**見積書**を~~送る~~\n')
    expect(getToolbarState(editor).strike).toBe(true)
  })

  it('もう一度押すと外す', async () => {
    const editor = await open('**見積書**を送る\n')
    select(editor, '見積書', 3)
    expect(getToolbarState(editor).strong).toBe(true)
    runToolbarAction(editor, 'strong')
    expect(getMarkdown(editor)).toBe('見積書を送る\n')
  })
})

describe('リスト', () => {
  it('段落を箇条書き・番号付きリスト・チェックボックスにする', async () => {
    const bullet = await open('金額を確定する\n')
    select(bullet, '金額')
    runToolbarAction(bullet, 'bullet')
    expect(getMarkdown(bullet)).toBe('- 金額を確定する\n')
    expect(getToolbarState(bullet)).toMatchObject({ bullet: true, ordered: false, task: false })

    const ordered = await open('金額を確定する\n')
    select(ordered, '金額')
    runToolbarAction(ordered, 'ordered')
    expect(getMarkdown(ordered)).toBe('1. 金額を確定する\n')
    expect(getToolbarState(ordered)).toMatchObject({ bullet: false, ordered: true })

    const task = await open('金額を確定する\n')
    select(task, '金額')
    runToolbarAction(task, 'task')
    expect(getMarkdown(task)).toBe('- [ ] 金額を確定する\n')
    expect(getToolbarState(task)).toMatchObject({ bullet: false, task: true })
  })

  it('同じ種類のリストの中で押すと、リストから外す', async () => {
    const editor = await open('- 金額を確定する\n')
    select(editor, '金額')
    runToolbarAction(editor, 'bullet')
    expect(getMarkdown(editor)).toBe('金額を確定する\n')
  })

  it('リストの種類を切り替える（チェックボックスはカーソルのある項目だけ）', async () => {
    const editor = await open('- 金額を確定する\n- PDFにする\n')
    select(editor, 'PDF')
    runToolbarAction(editor, 'task')
    expect(getMarkdown(editor)).toBe('- 金額を確定する\n- [ ] PDFにする\n')

    runToolbarAction(editor, 'ordered')
    expect(getMarkdown(editor)).toBe('1. 金額を確定する\n2. PDFにする\n')

    runToolbarAction(editor, 'bullet')
    expect(getMarkdown(editor)).toBe('- 金額を確定する\n- PDFにする\n')
  })

  it('すぐ前の同じ種類のリストとつなげる（別のリストにすると2つ目が * で書き出されるため）', async () => {
    const editor = await open('- 雑誌を捨てる\n\n文庫本を並べる\n')
    select(editor, '文庫本')
    runToolbarAction(editor, 'task')
    expect(getMarkdown(editor)).toBe('- 雑誌を捨てる\n- [ ] 文庫本を並べる\n')

    const ordered = await open('1. 金額を確定する\n\nPDFにする\n\n3. 送る\n')
    select(ordered, 'PDF')
    runToolbarAction(ordered, 'ordered')
    expect(getMarkdown(ordered)).toBe('1. 金額を確定する\n2. PDFにする\n3. 送る\n')
  })

  it('チェック済みの項目は、チェックボックスを付け直しても状態を保つ。外すと普通の箇条書きになる', async () => {
    const editor = await open('- [x] 金額を確定する\n- [ ] PDFにする\n')
    select(editor, '金額')
    expect(getToolbarState(editor).task).toBe(true)
    runToolbarAction(editor, 'task')
    expect(getMarkdown(editor)).toBe('- 金額を確定する\n- [ ] PDFにする\n')
  })
})

describe('見出し・斜体・コード・引用・区切り線・字下げ・リンク・元に戻す', () => {
  it('見出し2〜4と本文を切り替える。本文の途中の見出し1も見出し1として出す', async () => {
    const editor = await open('# タイトル\n\n見積\n')
    select(editor, '見積')
    setBlockLevel(editor, 2)
    expect(getMarkdown(editor)).toBe('# タイトル\n\n## 見積\n')
    expect(getToolbarState(editor).heading).toBe(2)
    setBlockLevel(editor, 4)
    expect(getMarkdown(editor)).toBe('# タイトル\n\n#### 見積\n')
    setBlockLevel(editor, 0)
    expect(getMarkdown(editor)).toBe('# タイトル\n\n見積\n')
    select(editor, 'タイトル')
    expect(getToolbarState(editor).heading).toBe(1)
  })

  it('斜体とインラインコードを、正式な書き方で付け外しする', async () => {
    const editor = await open('見積書を送る\n')
    select(editor, '見積書', 3)
    runToolbarAction(editor, 'emphasis')
    expect(getMarkdown(editor)).toBe('*見積書*を送る\n')
    expect(getToolbarState(editor).emphasis).toBe(true)
    runToolbarAction(editor, 'emphasis')
    select(editor, '送る', 2)
    runToolbarAction(editor, 'inlineCode')
    expect(getMarkdown(editor)).toBe('見積書を`送る`\n')
    expect(getToolbarState(editor).inlineCode).toBe(true)
  })

  it('引用とコードブロックは、もう一度押すと戻す', async () => {
    const editor = await open('大事な発言\n')
    select(editor, '大事')
    runToolbarAction(editor, 'quote')
    expect(getMarkdown(editor)).toBe('> 大事な発言\n')
    expect(getToolbarState(editor).quote).toBe(true)
    runToolbarAction(editor, 'quote')
    expect(getMarkdown(editor)).toBe('大事な発言\n')

    runToolbarAction(editor, 'codeBlock')
    expect(getMarkdown(editor)).toBe('```\n大事な発言\n```\n')
    expect(getToolbarState(editor).codeBlock).toBe(true)
    runToolbarAction(editor, 'codeBlock')
    expect(getMarkdown(editor)).toBe('大事な発言\n')
  })

  it('区切り線は --- で書き出す', async () => {
    const editor = await open('上\n')
    editor.action((ctx) => {
      const view = ctx.get(editorViewCtx)
      view.dispatch(view.state.tr.setSelection(TextSelection.atEnd(view.state.doc)))
    })
    runToolbarAction(editor, 'hr')
    expect(getMarkdown(editor)).toBe('上\n\n---\n')

    // 段落の途中にカーソルがあっても、段落を分けずに後ろに入れる（空の段落 <br /> を残さない）
    const middle = await open('上の段落\n\n下\n')
    select(middle, 'の段')
    runToolbarAction(middle, 'hr')
    expect(getMarkdown(middle)).toBe('上の段落\n\n---\n\n下\n')
  })

  it('リストの項目を字下げし、字下げを戻す', async () => {
    const editor = await open('- 金額を確定する\n- PDFにする\n')
    select(editor, 'PDF')
    expect(getToolbarState(editor).inList).toBe(true)
    runToolbarAction(editor, 'indent')
    expect(getMarkdown(editor)).toBe('- 金額を確定する\n  - PDFにする\n')
    runToolbarAction(editor, 'outdent')
    expect(getMarkdown(editor)).toBe('- 金額を確定する\n- PDFにする\n')
  })

  it('選んだ文字をリンクにし、URL を直し、空にすると外す', async () => {
    const editor = await open('見積書を送る\n')
    select(editor, '見積書', 3)
    setLink(editor, 'https://example.com/a')
    expect(getMarkdown(editor)).toBe('[見積書](https://example.com/a)を送る\n')
    // リンクの中にカーソルを置くと、その URL が出る。直すとリンク全体が変わる
    select(editor, '積')
    expect(getToolbarState(editor).link).toBe('https://example.com/a')
    setLink(editor, 'https://example.com/b')
    expect(getMarkdown(editor)).toBe('[見積書](https://example.com/b)を送る\n')
    select(editor, '積')
    setLink(editor, '')
    expect(getMarkdown(editor)).toBe('見積書を送る\n')
  })

  it('文字を選んでいなければ、URL をそのまま入れてリンクにする', async () => {
    const editor = await open('参考：\n')
    editor.action((ctx) => {
      const view = ctx.get(editorViewCtx)
      view.dispatch(view.state.tr.setSelection(TextSelection.atEnd(view.state.doc)))
    })
    setLink(editor, 'https://example.com')
    // 文字と URL が同じリンクは、標準の md の自動リンク <URL> で書き出される
    expect(getMarkdown(editor)).toBe('参考：<https://example.com>\n')
  })

  it('元に戻す・やり直す', async () => {
    const editor = await open('見積書を送る\n')
    expect(getToolbarState(editor).canUndo).toBe(false)
    select(editor, '見積書', 3)
    runToolbarAction(editor, 'strong')
    expect(getToolbarState(editor).canUndo).toBe(true)
    runToolbarAction(editor, 'undo')
    expect(getMarkdown(editor)).toBe('見積書を送る\n')
    expect(getToolbarState(editor).canRedo).toBe(true)
    runToolbarAction(editor, 'redo')
    expect(getMarkdown(editor)).toBe('**見積書**を送る\n')
  })
})

describe('mergeBody と組み合わせたとき', () => {
  it('ツールバーで書式を付けたブロックだけが書き換わり、ほかのブロックは1文字も変わらない', async () => {
    const body = '\n# 見積書\n\n* 書き方の違う箇条書き\n\n金額を確定する\n'
    const editor = await open(body)
    const baseline = getMarkdown(editor)
    select(editor, '金額', 2)
    runToolbarAction(editor, 'strike')
    expect(mergeBody(body, baseline, getMarkdown(editor))).toBe(
      '\n# 見積書\n\n* 書き方の違う箇条書き\n\n~~金額~~を確定する\n'
    )
  })
})

describe('表', () => {
  it('表を挿入すると、最初のセルにカーソルを置き、列の幅を揃えない正式な書き方で書き出す', async () => {
    const editor = await open('見積\n')
    editor.action((ctx) => {
      const view = ctx.get(editorViewCtx)
      // 段落の後ろにカーソルを置く
      view.dispatch(view.state.tr.setSelection(TextSelection.atEnd(view.state.doc)))
    })
    runToolbarAction(editor, 'table')
    expect(getToolbarState(editor)).toMatchObject({ inTable: true, inHeaderRow: true })
    expect(getMarkdown(editor)).toBe('見積\n\n| | | |\n| --- | --- | --- |\n| | | |\n| | | |\n')
  })

  it('行と列を足して消す。見出しの行は消せない', async () => {
    const editor = await open('| 項目 | 金額 |\n| --- | --- |\n| 見積 | 1,000円 |\n')
    select(editor, '見積')
    expect(getToolbarState(editor)).toMatchObject({ inTable: true, inHeaderRow: false })

    // カーソルは「見積」（1列目）にあるので、その下に行、右に列を足す
    runToolbarAction(editor, 'rowBelow')
    runToolbarAction(editor, 'colRight')
    expect(getMarkdown(editor)).toBe(
      '| 項目 | | 金額 |\n| --- | --- | --- |\n| 見積 | | 1,000円 |\n| | | |\n'
    )

    select(editor, '見積')
    runToolbarAction(editor, 'deleteRow')
    select(editor, '金額')
    runToolbarAction(editor, 'deleteCol')
    expect(getMarkdown(editor)).toBe('| 項目 | |\n| --- | --- |\n| | |\n')

    // 見出しの行では、行を消す操作をしても何もしない
    select(editor, '項目')
    runToolbarAction(editor, 'deleteRow')
    expect(getMarkdown(editor)).toBe('| 項目 | |\n| --- | --- |\n| | |\n')
  })

  it('足した列は、元の列の揃えを引き継ぐ', async () => {
    const editor = await open('| 項目 | 金額 |\n| :--- | ---: |\n| 見積 | 1,000円 |\n')
    select(editor, '1,000')
    runToolbarAction(editor, 'colLeft')
    expect(getMarkdown(editor)).toBe(
      '| 項目 | | 金額 |\n| :--- | ---: | ---: |\n| 見積 | | 1,000円 |\n'
    )
  })

  it('揃え（:---）は残す', async () => {
    const editor = await open('| 項目 | 金額 |\n| :--- | ---: |\n| 見積 | 1,000円 |\n')
    select(editor, '見積', 2)
    runToolbarAction(editor, 'strong')
    expect(getMarkdown(editor)).toBe('| 項目 | 金額 |\n| :--- | ---: |\n| **見積** | 1,000円 |\n')
  })
})

describe('表（空の行に挿入）', () => {
  it('空の段落に挿入しても、揃えなしの表になる', async () => {
    const editor = await open('見積\n\n\n')
    editor.action((ctx) => {
      const view = ctx.get(editorViewCtx)
      view.dispatch(view.state.tr.setSelection(TextSelection.atEnd(view.state.doc)))
    })
    runToolbarAction(editor, 'table')
    expect(getToolbarState(editor).inTable).toBe(true)
    expect(getMarkdown(editor)).toContain('| --- | --- | --- |')
  })
})
