// 本文エディタ（Milkdown）の組み立て。書き出しの書き方は RULES.md の「正式な書き方」に固定する

import {
  Editor,
  commandsCtx,
  defaultValueCtx,
  editorViewCtx,
  editorViewOptionsCtx,
  remarkStringifyOptionsCtx,
  rootCtx,
  serializerCtx
} from '@milkdown/kit/core'
import { history } from '@milkdown/kit/plugin/history'
import { listener, listenerCtx } from '@milkdown/kit/plugin/listener'
import { commonmark, wrapInHeadingCommand } from '@milkdown/kit/preset/commonmark'
import { gfm } from '@milkdown/kit/preset/gfm'
import { $remark } from '@milkdown/kit/utils'
import { gfmTableToMarkdown } from 'mdast-util-gfm-table'
import type { Processor } from 'unified'
import { idLinks, type IdLinkOptions } from './idLinks'
import { linkSuggest, type LinkSuggestOptions } from './linkSuggest'
import { tableCursor } from './tableCursor'

/**
 * remark-stringify の設定。RULES.md の「正式な書き方」の表と同じにする
 * （見出しは #、箇条書きは -、番号付きは 1.、強調は * と **、コードはバッククォート3つ、区切り線は ---。
 * 取り消し線の ~~ は remark-gfm の既定の書き方）
 */
export const STRINGIFY_OPTIONS = {
  bullet: '-',
  emphasis: '*',
  strong: '*',
  fence: '`',
  fences: true,
  rule: '-',
  listItemIndent: 'one',
  setext: false
} as const

/**
 * 表の区切り行を `| --- |` の形にする（揃えの `:` は残す）。RULES.md の正式な書き方
 * remark は列の幅を揃えない設定だと `| - |` と書くので、書き出した後に直す
 */
export function canonicalDelimiterRow(table: string): string {
  const lines = table.split('\n')
  if (lines.length < 2) return table
  lines[1] = lines[1].replace(/(:?)-+(:?)/g, '$1---$2')
  return lines.join('\n')
}

/** 表を書き出す処理。列の幅は揃えない（日本語は幅がずれやすく、セルを変えるたびにほかの行も変わるため） */
const tableHandler = gfmTableToMarkdown({ tablePipeAlign: false }).handlers!.table!
type TableHandler = typeof tableHandler

/** remark-gfm の表の書き出しを、正式な書き方に差し替える（gfm より後に use する） */
const remarkCanonicalTable = $remark(
  'remarkCanonicalTable',
  () =>
    function (this: Processor) {
      const data = this.data() as { toMarkdownExtensions?: unknown[] }
      const extensions = (data.toMarkdownExtensions ??= [])
      const table: TableHandler = (...args) => canonicalDelimiterRow(tableHandler(...args))
      extensions.push({ handlers: { table } })
    }
)

export interface MarkdownEditorOptions {
  root: HTMLElement
  /** エディタに渡す本文（frontmatter は渡さない） */
  markdown: string
  /** 本文が変わるたびに、書き出した md を渡す */
  onChange?: (markdown: string) => void
  /** カーソルや本文が変わったとき（ツールバーのボタンの状態を更新するため） */
  onSelectionChange?: () => void
  editable?: () => boolean
  /** 本文の中の ID に印とタイトルを付け、Ctrl+クリックで開けるようにする（画面だけで、本文は変えない） */
  idLinks?: IdLinkOptions
  /** `[[` と打つと、チケットやノートのリンクの候補を出す */
  linkSuggest?: LinkSuggestOptions
}

export async function createMarkdownEditor(options: MarkdownEditorOptions): Promise<Editor> {
  const editor = Editor.make()
    .config((ctx) => {
      ctx.set(rootCtx, options.root)
      ctx.set(defaultValueCtx, options.markdown)
      ctx.update(remarkStringifyOptionsCtx, (prev) => ({ ...prev, ...STRINGIFY_OPTIONS }))
      if (options.editable) {
        const editable = options.editable
        ctx.update(editorViewOptionsCtx, (prev) => ({ ...prev, editable }))
      }
      if (options.onChange) {
        const onChange = options.onChange
        ctx.get(listenerCtx).markdownUpdated((_, markdown) => onChange(markdown))
      }
      if (options.onSelectionChange) {
        const onSelectionChange = options.onSelectionChange
        ctx
          .get(listenerCtx)
          .selectionUpdated(() => onSelectionChange())
          .updated(() => onSelectionChange())
      }
    })
    .use(commonmark)
    .use(gfm)
    .use(remarkCanonicalTable)
    .use(history)
    .use(listener)
    .use(tableCursor)
  if (options.idLinks) editor.use(idLinks(options.idLinks))
  if (options.linkSuggest) editor.use(linkSuggest(options.linkSuggest))
  return editor.create()
}

/** 今の本文を md として書き出す */
export function getMarkdown(editor: Editor): string {
  return editor.action((ctx) => ctx.get(serializerCtx)(ctx.get(editorViewCtx).state.doc))
}

/** 本文が空のとき、1行目を見出しにしてカーソルを置く（新規作成でタイトルから書けるように） */
export function startWithTitle(editor: Editor): void {
  editor.action((ctx) => {
    const view = ctx.get(editorViewCtx)
    if (view.state.doc.textContent === '' && view.state.doc.childCount <= 1) {
      ctx.get(commandsCtx).call(wrapInHeadingCommand.key, 1)
    }
    view.focus()
  })
}
