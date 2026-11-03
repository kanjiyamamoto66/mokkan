// 本文の中の語を探して選び、そこまで動かす（検索の結果から開いたとき）

import { editorViewCtx, type Editor } from '@milkdown/kit/core'
import { TextSelection } from '@milkdown/kit/prose/state'
import { normalizeForSearch } from '../../../shared/links'

/**
 * 本文で最初に term が出てくる箇所を選んで、見えるところまで動かす
 * term は検索と同じ形（かな・全角半角・大文字小文字を揃えた形）で渡す。見つからなければ false
 */
export function selectFirstMatch(editor: Editor, term: string): boolean {
  if (term === '') return false
  return editor.action((ctx) => {
    const view = ctx.get(editorViewCtx)
    /** タイトル（本文の先頭の見出し1）を飛ばすか。検索の結果に出した文と同じく、本文の中を先に探す */
    const find = (skipTitle: boolean): { from: number; to: number } | null => {
      let found: { from: number; to: number } | null = null
      view.state.doc.descendants((node, pos) => {
        if (found) return false
        if (skipTitle && node.type.name === 'heading' && node.attrs.level === 1) return false
        if (!node.isText || !node.text) return true
        // 揃えた形と元の文で文字の位置がずれることがある（全角→半角など）が、目安として使う
        const at = normalizeForSearch(node.text).indexOf(term)
        if (at >= 0) {
          found = { from: pos + at, to: Math.min(pos + at + term.length, pos + node.nodeSize) }
        }
        return true
      })
      return found
    }
    const found = find(true) ?? find(false)
    if (!found) return false
    view.dispatch(
      view.state.tr
        .setSelection(TextSelection.create(view.state.doc, found.from, found.to))
        .scrollIntoView()
    )
    view.focus()
    return true
  })
}
