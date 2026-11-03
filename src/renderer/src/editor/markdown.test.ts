// @vitest-environment jsdom
// 変換を往復させるテスト（読み込み→書き出し→元と一致）。Milkdown の設定やバージョンを変えたら必ず通す

import { editorViewCtx, type Editor } from '@milkdown/kit/core'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { canPreserveBlocks, mergeBody, splitBlocks } from '../../../shared/body'
import { splitFrontmatter } from '../../../shared/ticket'
import { createMarkdownEditor, getMarkdown, startWithTitle } from './markdown'

const canonical = readFileSync(
  resolve(__dirname, '../../../../tests/fixtures/canonical.md'),
  'utf8'
)
const rules = readFileSync(resolve(__dirname, '../../../../templates/RULES.md'), 'utf8')
const template = readFileSync(resolve(__dirname, '../../../../templates/TEMPLATE.md'), 'utf8')

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

/** 本文の n 番目の段落の末尾に文字を足す（エディタ上での編集の代わり） */
function appendToParagraph(editor: Editor, index: number, text: string): void {
  editor.action((ctx) => {
    const view = ctx.get(editorViewCtx)
    let count = -1
    let pos = -1
    view.state.doc.descendants((node, offset) => {
      if (pos >= 0) return false
      if (node.type.name === 'paragraph' && ++count === index) pos = offset + node.nodeSize - 1
      return true
    })
    if (pos < 0) throw new Error(`段落 ${index} がありません`)
    view.dispatch(view.state.tr.insertText(text, pos))
  })
}

describe('正式な書き方の往復', () => {
  it('正式な書き方で書いた md は、読み込んで書き出しても1文字も変わらない', async () => {
    expect(getMarkdown(await open(canonical))).toBe(canonical)
  })

  it('一番外側のブロックの数も変わらない', async () => {
    const out = getMarkdown(await open(canonical))
    expect(splitBlocks(out).length).toBe(splitBlocks(canonical).length)
  })
})

describe('保存する本文（エディタ＋mergeBody）', () => {
  it('編集しなければ、元の本文がそのまま残る（RULES.md のような正式でない書き方を含む文書でも）', async () => {
    const body = '\n' + rules
    const baseline = getMarkdown(await open(body))
    expect(mergeBody(body, baseline, baseline)).toBe(body)
  })

  it('1つの段落を編集しても、ほかのブロックは1文字も変わらない', async () => {
    const body = '\n' + rules
    const editor = await open(body)
    const baseline = getMarkdown(editor)
    appendToParagraph(editor, 0, '（追記）')
    const saved = mergeBody(body, baseline, getMarkdown(editor))

    const before = splitBlocks(body).map((b) => b.text)
    const after = splitBlocks(saved).map((b) => b.text)
    expect(after).toHaveLength(before.length)
    const changed = before.flatMap((text, i) => (text === after[i] ? [] : [i]))
    expect(changed).toHaveLength(1)
    expect(after[changed[0]]).toContain('（追記）')
    // 変えたブロック以外は、間の空行も含めて元のまま
    expect(saved.replace('（追記）', '')).toBe(body)
  })

  it('リンク参照定義がある本文は、ブロック単位で残せない（開いたときに知らせ、編集すると本文全体を書き出す）', async () => {
    // エディタはリンク参照定義を本文中のリンクに展開し、定義の行を消す
    const body = '\n参照 [手順書] を見る\n\n[手順書]: https://example.com/manual\n\n最後の段落\n'
    const editor = await open(body)
    const baseline = getMarkdown(editor)
    expect(canPreserveBlocks(body, baseline)).toBe(false)

    // 編集しなければ、元のまま
    expect(mergeBody(body, baseline, baseline)).toBe(body)

    // 編集すると、本文全体がエディタの書き出し結果になる（仕様。画面の案内で知らせる）
    appendToParagraph(editor, 1, '（追記）')
    expect(mergeBody(body, baseline, getMarkdown(editor))).toBe(
      '\n参照 [手順書](https://example.com/manual) を見る\n\n最後の段落（追記）\n'
    )
  })

  it('表のセルの \\|（エスケープした縦棒）は列の区切りにならず、表を編集しても列が保たれる', async () => {
    // JS の文字列では '\|' が '|' になるので、md は String.raw で書く
    const body = [
      '',
      '| 項目 | メモ |',
      '| --- | --- |',
      String.raw`| a\|b | ${'`'}p\|q${'`'} |`,
      '| c | d |',
      ''
    ].join('\n')
    const editor = await open(body)
    const baseline = getMarkdown(editor)
    expect(baseline).toBe(body.slice(1))

    // 段落の番号は、セルの中の段落を上から数える（項目, メモ, a|b, p|q, c, d）
    appendToParagraph(editor, 5, '（e|f）')
    expect(mergeBody(body, baseline, getMarkdown(editor))).toBe(
      body.replace('| d |', String.raw`| d（e\|f） |`)
    )
  })

  it('普段の書き方の本文は、ブロック単位で残せる', async () => {
    expect(canPreserveBlocks(canonical, getMarkdown(await open(canonical)))).toBe(true)
    const body = '\n' + rules
    expect(canPreserveBlocks(body, getMarkdown(await open(body)))).toBe(true)
  })

  it('テンプレートの本文（空の見出し）は、開いただけなら変わらない', async () => {
    const body = splitFrontmatter(template)!.body
    const editor = await open(body)
    const baseline = getMarkdown(editor)
    startWithTitle(editor)
    expect(mergeBody(body, baseline, getMarkdown(editor))).toBe(body)
  })

  it('新規作成でタイトルを書くと、見出しとして保存される', async () => {
    const body = splitFrontmatter(template)!.body
    const editor = await open(body)
    const baseline = getMarkdown(editor)
    startWithTitle(editor)
    editor.action((ctx) => {
      const view = ctx.get(editorViewCtx)
      view.dispatch(view.state.tr.insertText('見積書を送る'))
    })
    expect(mergeBody(body, baseline, getMarkdown(editor))).toBe('\n# 見積書を送る\n')
  })
})
