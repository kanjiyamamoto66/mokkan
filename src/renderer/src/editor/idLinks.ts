// 本文の中のチケット・ノートの ID に印を付け、横にタイトルを薄く出す。Ctrl+クリック（macは⌘+クリック）で開く
// 他のチケットやノートへの md のリンクも、リンク先のファイル名の先頭の ID で開く（ファイル名が変わっても開ける）
// http/https のリンクも、同じ操作で既定のブラウザで開く（編集できる場所のリンクは、クリックしてもブラウザが開かないため）
// 画面の飾り（ProseMirror の decoration）だけで、本文（ファイル）には何も書かない

import type { Node } from '@milkdown/kit/prose/model'
import { Plugin, PluginKey } from '@milkdown/kit/prose/state'
import { Decoration, DecorationSet, type EditorView } from '@milkdown/kit/prose/view'
import { $prose } from '@milkdown/kit/utils'
import { findIds, idFromHref, isExternalUrl } from '../../../shared/links'
import { clickLabel, isModKey } from '../keys'

export { findIds, type IdMatch } from '../../../shared/links'

export interface IdLinkOptions {
  /** ID のタイトル。チケットにもノートにもない ID なら undefined */
  titleOf: (id: string) => string | undefined
  /** ID のチケットかノートを開く */
  open: (id: string) => void
  /** http/https のリンクを開く。既定は window.open で、裏方（setWindowOpenHandler）が既定のブラウザに渡す */
  openUrl?: (url: string) => void
}

/** 新しいウィンドウは作られず、裏方が http/https だけを既定のブラウザで開く（index.ts の setWindowOpenHandler） */
function openInBrowser(url: string): void {
  window.open(url, '_blank', 'noopener')
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
    const href = link ? String(link.attrs.href ?? '') : ''
    // http/https のリンクは、Ctrl+クリック（Mac は ⌘+クリック）でブラウザで開けることを添える（印の見た目はリンクのまま）
    if (isExternalUrl(href)) {
      decorations.push(
        Decoration.inline(
          pos,
          pos + node.nodeSize,
          { title: `${href}（${clickLabel()}でブラウザで開く）` },
          { url: href }
        )
      )
    }
    const linkedId = link ? idFromHref(href) : null
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
                ? `${title || '（タイトルなし）'}（${clickLabel()}で開く）`
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
              ? `${title || '（タイトルなし）'}（${clickLabel()}で開く）`
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
            // Ctrl+クリック（Mac は ⌘+クリック。Mac の ⌃+クリックは右クリックなので開かない）
            if (!isModKey(event)) return false
            const found = key.getState(view.state)?.find(pos, pos) ?? []
            const specs = found.map((d) => d.spec as { id?: string; url?: string })
            const id = specs.map((s) => s.id).find(Boolean)
            if (id && options.titleOf(id) !== undefined) {
              options.open(id)
              return true
            }
            const url = specs.map((s) => s.url).find(Boolean)
            if (url && isExternalUrl(url)) {
              ;(options.openUrl ?? openInBrowser)(url)
              return true
            }
            return false
          }
        }
      })
  )
}

/** タイトルが変わったときなどに、印を付け直す */
export function refreshIdLinks(view: EditorView): void {
  view.dispatch(view.state.tr.setMeta(key, true))
}
