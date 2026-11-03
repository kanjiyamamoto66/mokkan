// 本文の中のチケット・ノートの ID に印を付け、横にタイトルを薄く出す。Ctrl+クリック（macは⌘+クリック）で開く
// 他のチケットやノートへの md のリンクも、リンク先のファイル名の先頭の ID で開く（ファイル名が変わっても開ける）
// 画面の飾り（ProseMirror の decoration）だけで、本文（ファイル）には何も書かない

import type { Node } from '@milkdown/kit/prose/model'
import { Plugin, PluginKey } from '@milkdown/kit/prose/state'
import { Decoration, DecorationSet, type EditorView } from '@milkdown/kit/prose/view'
import { $prose } from '@milkdown/kit/utils'
import { idFromHref } from '../../../shared/links'

/** 文の中の ID（`YYYYMMDD-HHMM-xxxx`）。前後が英数字に続いているものは除く */
const ID_IN_TEXT = /(?<![0-9A-Za-z])\d{8}-\d{4}-[a-z0-9]{4}(?![0-9A-Za-z])/g

export interface IdMatch {
  /** 文字列の中の位置 */
  start: number
  end: number
  id: string
}

/** 文字列の中の ID を探す */
export function findIds(text: string): IdMatch[] {
  return [...text.matchAll(ID_IN_TEXT)].map((m) => ({
    start: m.index,
    end: m.index + m[0].length,
    id: m[0]
  }))
}

export interface IdLinkOptions {
  /** ID のタイトル。チケットにもノートにもない ID なら undefined */
  titleOf: (id: string) => string | undefined
  /** ID のチケットかノートを開く */
  open: (id: string) => void
}

const key = new PluginKey<DecorationSet>('mokkanIdLinks')

/** ID の横に薄く出すタイトル（画面だけで、本文には書かない） */
function titleWidget(title: string): HTMLElement {
  const span = document.createElement('span')
  span.className = 'id-title'
  span.textContent = title
  span.contentEditable = 'false'
  return span
}

function decorate(doc: Node, options: IdLinkOptions): DecorationSet {
  const decorations: Decoration[] = []
  doc.descendants((node, pos) => {
    // コードの中の ID はそのまま（コードとして書いたものなので）
    if (node.type.name === 'code_block') return false
    if (!node.isText || !node.text) return true
    if (node.marks.some((m) => m.type.name === 'inlineCode')) return true
    // 他のチケットやノートへの md のリンク（`[タイトル](../tickets/ID_….md)`）は、リンク先の ID で開く
    const link = node.marks.find((m) => m.type.name === 'link')
    const linkedId = link ? idFromHref(String(link.attrs.href ?? '')) : null
    if (linkedId) {
      const title = options.titleOf(linkedId)
      decorations.push(
        Decoration.inline(
          pos,
          pos + node.nodeSize,
          {
            class: title !== undefined ? 'id-link file-link' : 'id-link file-link unknown',
            title:
              title !== undefined
                ? `${title || '（タイトルなし）'}（Ctrl+クリックで開く）`
                : `見つからないリンク先（${linkedId}）`
          },
          { id: linkedId }
        )
      )
      // 「宿題」の `→ [ID](…)` のように文字が ID だけのリンクは、横にタイトルも出す
      if (title && node.text.trim() === linkedId) {
        decorations.push(
          Decoration.widget(pos + node.nodeSize, () => titleWidget(title), {
            side: 1,
            ignoreSelection: true,
            key: `${linkedId}:${title}`
          })
        )
      }
      return true
    }
    for (const { start, end, id } of findIds(node.text)) {
      const title = options.titleOf(id)
      const known = title !== undefined
      decorations.push(
        Decoration.inline(
          pos + start,
          pos + end,
          {
            class: known ? 'id-link' : 'id-link unknown',
            title: known
              ? `${title || '（タイトルなし）'}（Ctrl+クリックで開く）`
              : '見つからない ID'
          },
          { id }
        )
      )
      if (known && title) {
        decorations.push(
          Decoration.widget(pos + end, () => titleWidget(title), {
            side: 1,
            ignoreSelection: true,
            key: `${id}:${title}`
          })
        )
      }
    }
    return true
  })
  return DecorationSet.create(doc, decorations)
}

/** ID に印を付ける Milkdown のプラグイン */
export function idLinks(options: IdLinkOptions): ReturnType<typeof $prose> {
  return $prose(
    () =>
      new Plugin<DecorationSet>({
        key,
        state: {
          init: (_, state) => decorate(state.doc, options),
          apply: (tr, old) => (tr.docChanged || tr.getMeta(key) ? decorate(tr.doc, options) : old)
        },
        props: {
          decorations: (state) => key.getState(state),
          handleClick: (view, pos, event) => {
            if (!(event.ctrlKey || event.metaKey)) return false
            const found = key.getState(view.state)?.find(pos, pos) ?? []
            const id = found.map((d) => (d.spec as { id?: string }).id).find(Boolean)
            if (!id || options.titleOf(id) === undefined) return false
            options.open(id)
            return true
          }
        }
      })
  )
}

/** タイトルが変わったときなどに、印を付け直す */
export function refreshIdLinks(view: EditorView): void {
  view.dispatch(view.state.tr.setMeta(key, true))
}
