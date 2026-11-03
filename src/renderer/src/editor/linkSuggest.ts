// 本文で `[[`（日本語入力のままなら `「「`）と打つと、チケットやノートの候補を出し、選ぶと標準の md のリンクを入れる
// `[[` は入力のきっかけにすぎず、ファイルには残さない（独自記法を出さない決まりはそのまま守る）
// 候補の一覧は画面（TicketEditor）が描き、このプラグインは「今どこで何を打っているか」とキー操作の受け渡しだけをする

import type { Node } from '@milkdown/kit/prose/model'
import { Plugin, PluginKey, type EditorState } from '@milkdown/kit/prose/state'
import type { EditorView } from '@milkdown/kit/prose/view'
import { $prose } from '@milkdown/kit/utils'

/** きっかけの文字と、その後ろに打った文字（`]`・改行を含まない、30文字まで） */
const TRIGGER = /(\[\[|「「)([^\]」\n]{0,30})$/

export interface LinkQuery {
  /** きっかけの文字の始まりの位置（ここから to までをリンクに置き換える） */
  from: number
  /** カーソルの位置 */
  to: number
  /** きっかけの文字の後ろに打った文字 */
  query: string
}

export interface LinkSuggestOptions {
  /** 打っている途中の状態が変わったとき（null は候補を閉じる） */
  onQuery: (query: LinkQuery | null, view: EditorView) => void
  /** 候補を出している間のキー操作。扱ったら true を返す（↑↓・Enter・Tab・Esc） */
  onKey: (event: KeyboardEvent) => boolean
}

const key = new PluginKey<LinkQuery | null>('mokkanLinkSuggest')

/** カーソルの前に `[[` と打った途中の文字があれば返す（コードの中は対象外） */
export function findLinkQuery(state: EditorState): LinkQuery | null {
  const { selection } = state
  if (!selection.empty) return null
  const $pos = selection.$from
  const parent: Node = $pos.parent
  if (!parent.isTextblock || parent.type.spec.code) return null
  // インラインコードの中（コードの終わりにカーソルがあるときも含む）は対象外
  const inCode = (marks: readonly { type: { name: string } }[]): boolean =>
    marks.some((m) => m.type.name === 'inlineCode')
  if (inCode($pos.marks()) || inCode($pos.nodeBefore?.marks ?? [])) return null
  // 段落の始まりからカーソルまでの文字（画像などの文字でないものは、改行として扱って区切る）
  const before = parent.textBetween(0, $pos.parentOffset, undefined, '\n')
  const match = TRIGGER.exec(before)
  if (!match) return null
  return { from: $pos.pos - match[0].length, to: $pos.pos, query: match[2] }
}

/** きっかけの文字と打った文字を、`[title](href)` のリンクに置き換える */
export function insertLink(view: EditorView, query: LinkQuery, title: string, href: string): void {
  const { state } = view
  const type = state.schema.marks.link
  const tr = state.tr.replaceWith(
    query.from,
    query.to,
    state.schema.text(title, [type.create({ href })])
  )
  // 続けて打つ文字はリンクにしない
  tr.removeStoredMark(type)
  view.dispatch(tr)
  view.focus()
}

/** `[[` で候補を出す Milkdown のプラグイン */
export function linkSuggest(options: LinkSuggestOptions): ReturnType<typeof $prose> {
  return $prose(
    () =>
      new Plugin<LinkQuery | null>({
        key,
        state: {
          init: () => null,
          apply: (tr, old, _, state) =>
            tr.docChanged || tr.selectionSet ? findLinkQuery(state) : old
        },
        view: () => {
          let last: LinkQuery | null = null
          return {
            update: (view) => {
              const current = key.getState(view.state) ?? null
              if (JSON.stringify(current) === JSON.stringify(last)) return
              last = current
              options.onQuery(current, view)
            },
            destroy: () => {
              last = null
            }
          }
        },
        props: {
          handleKeyDown: (view, event) => {
            // 日本語入力の変換中のキーは、変換の操作なので扱わない
            if (view.composing || event.isComposing || event.keyCode === 229) return false
            if (!key.getState(view.state)) return false
            return options.onKey(event)
          }
        }
      })
  )
}
