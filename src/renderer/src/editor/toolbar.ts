// 本文エディタのツールバーの操作（見出し・太字・斜体・取り消し線・コード・リスト・チェックボックス・字下げ・引用・
// コードブロック・区切り線・リンク・表・元に戻す／やり直す）
// 書式は Milkdown のコマンドで付け外しする。書き出しは STRINGIFY_OPTIONS の正式な書き方になる
// 標準の md で書けるものだけを扱う（独自記法は出さない）

import { commandsCtx, editorViewCtx, type Editor } from '@milkdown/kit/core'
import { redoCommand, undoCommand } from '@milkdown/kit/plugin/history'
import {
  createCodeBlockCommand,
  liftListItemCommand,
  sinkListItemCommand,
  toggleEmphasisCommand,
  toggleInlineCodeCommand,
  toggleStrongCommand,
  wrapInBlockquoteCommand,
  wrapInBulletListCommand,
  wrapInOrderedListCommand
} from '@milkdown/kit/preset/commonmark'
import { lift, setBlockType } from '@milkdown/kit/prose/commands'
import { redoDepth, undoDepth } from '@milkdown/kit/prose/history'
import {
  addColAfterCommand,
  addColBeforeCommand,
  addRowAfterCommand,
  addRowBeforeCommand,
  insertTableCommand,
  toggleStrikethroughCommand
} from '@milkdown/kit/preset/gfm'
import type { MarkType, Node } from '@milkdown/kit/prose/model'
import {
  deleteColumn,
  deleteRow,
  deleteTable,
  isInTable,
  selectedRect
} from '@milkdown/kit/prose/tables'
import { Selection, type EditorState, type Transaction } from '@milkdown/kit/prose/state'
import type { EditorView } from '@milkdown/kit/prose/view'

/** 書式の付け外し（押された状態で表示する） */
export type FormatAction =
  | 'strong'
  | 'emphasis'
  | 'strike'
  | 'inlineCode'
  | 'bullet'
  | 'ordered'
  | 'task'
  | 'quote'
  | 'codeBlock'
/** 押すたびに1回行う操作 */
export type CommandAction = 'hr' | 'indent' | 'outdent' | 'undo' | 'redo'
/** 表の挿入と、行・列の追加と削除 */
export type TableAction =
  'table' | 'rowAbove' | 'rowBelow' | 'colLeft' | 'colRight' | 'deleteRow' | 'deleteCol'
export type ToolbarAction = FormatAction | CommandAction | TableAction

/** カーソル位置の状態。書式はボタンを押された状態で表示し、表の操作は表の中でだけ出す */
export type ToolbarState = Record<FormatAction, boolean> & {
  inTable: boolean
  /** 表の見出しの行にいる（見出しの行は消したり上に足したりできない） */
  inHeaderRow: boolean
  /** カーソルのある見出しの段（1〜6）。見出しでなければ 0 */
  heading: number
  /** カーソルのあるリンクの URL。リンクの中でなければ null */
  link: string | null
  /** リストの中にいる（字下げ・字下げを戻す） */
  inList: boolean
  canUndo: boolean
  canRedo: boolean
}

export const EMPTY_TOOLBAR_STATE: ToolbarState = {
  strong: false,
  emphasis: false,
  strike: false,
  inlineCode: false,
  bullet: false,
  ordered: false,
  task: false,
  quote: false,
  codeBlock: false,
  inTable: false,
  inHeaderRow: false,
  heading: 0,
  link: null,
  inList: false,
  canUndo: false,
  canRedo: false
}

/** 表を挿入するときの大きさ（見出しの行を含む） */
const NEW_TABLE = { row: 3, col: 3 }

interface ListContext {
  list: Node
  listPos: number
  item: Node
}

/** カーソルのある一番内側のリスト項目と、それを含むリスト */
function currentList(state: EditorState): ListContext | null {
  const { $from } = state.selection
  for (let depth = $from.depth; depth > 1; depth--) {
    const node = $from.node(depth)
    if (node.type.name === 'list_item') {
      return { list: $from.node(depth - 1), listPos: $from.before(depth - 1), item: node }
    }
  }
  return null
}

function isTask(item: Node): boolean {
  return item.attrs.checked !== null && item.attrs.checked !== undefined
}

function markActive(state: EditorState, type: MarkType | undefined): boolean {
  if (!type) return false
  const { from, to, empty, $from } = state.selection
  if (empty) return Boolean(type.isInSet(state.storedMarks ?? $from.marks()))
  return state.doc.rangeHasMark(from, to, type)
}

/** カーソルが表の見出しの行にあるか */
function inHeaderRow(state: EditorState): boolean {
  const { $from } = state.selection
  for (let depth = $from.depth; depth > 0; depth--) {
    if ($from.node(depth).type.name === 'table_header_row') return true
  }
  return false
}

/** カーソルが引用の中にあるか */
function inBlockquote(state: EditorState): boolean {
  const { $from } = state.selection
  for (let depth = $from.depth; depth > 0; depth--) {
    if ($from.node(depth).type.name === 'blockquote') return true
  }
  return false
}

/** カーソル（選択範囲の始まり）にあるリンクの範囲と URL */
function linkAt(state: EditorState): { from: number; to: number; href: string } | null {
  const type = state.schema.marks.link
  if (!type) return null
  const { $from } = state.selection
  const mark = type.isInSet($from.marks()) ?? type.isInSet($from.nodeAfter?.marks ?? [])
  if (!mark) return null
  // 段落の中の文字のかたまりを並べ、カーソルのところから同じリンクが続く範囲を前後に広げる
  const start = $from.start()
  const pieces: { from: number; to: number; linked: boolean }[] = []
  $from.parent.forEach((child, offset) => {
    pieces.push({
      from: start + offset,
      to: start + offset + child.nodeSize,
      linked: Boolean(mark.isInSet(child.marks))
    })
  })
  let index = pieces.findIndex((p) => p.linked && p.from <= $from.pos && $from.pos <= p.to)
  if (index < 0) return null
  let last = index
  while (index > 0 && pieces[index - 1].linked) index--
  while (last < pieces.length - 1 && pieces[last + 1].linked) last++
  return { from: pieces[index].from, to: pieces[last].to, href: String(mark.attrs.href ?? '') }
}

function stateOf(state: EditorState): ToolbarState {
  const list = currentList(state)
  const task = list !== null && isTask(list.item)
  const inTable = isInTable(state)
  const parent = state.selection.$from.parent
  return {
    inTable,
    inHeaderRow: inTable && inHeaderRow(state),
    strong: markActive(state, state.schema.marks.strong),
    emphasis: markActive(state, state.schema.marks.emphasis),
    strike: markActive(state, state.schema.marks.strike_through),
    inlineCode: markActive(state, state.schema.marks.inlineCode),
    bullet: list !== null && list.list.type.name === 'bullet_list' && !task,
    ordered: list !== null && list.list.type.name === 'ordered_list',
    task,
    quote: inBlockquote(state),
    codeBlock: parent.type.name === 'code_block',
    heading: parent.type.name === 'heading' ? Number(parent.attrs.level) : 0,
    link: linkAt(state)?.href ?? null,
    inList: list !== null,
    canUndo: undoDepth(state) > 0,
    canRedo: redoDepth(state) > 0
  }
}

/**
 * カーソルのある段落を見出し（2〜4。本文の先頭のタイトルは 1）か本文にする
 * @param level 1〜6 は見出しの段、0 は本文（段落）
 */
export function setBlockLevel(editor: Editor, level: number): void {
  editor.action((ctx) => {
    const view = ctx.get(editorViewCtx)
    const { schema } = view.state
    const command =
      level === 0
        ? setBlockType(schema.nodes.paragraph)
        : setBlockType(schema.nodes.heading, { level })
    command(view.state, view.dispatch)
    view.focus()
  })
}

/**
 * リンクを付ける・直す・外す
 * - 文字を選んでいれば、その文字をリンクにする
 * - リンクの中にカーソルがあれば、そのリンクの URL を直す（空なら外す）
 * - どちらでもなければ、URL をそのまま文字として入れてリンクにする
 */
export function setLink(editor: Editor, href: string): void {
  editor.action((ctx) => {
    const view = ctx.get(editorViewCtx)
    const { state } = view
    const type = state.schema.marks.link
    const url = href.trim()
    const existing = linkAt(state)
    const { from, to, empty } = state.selection
    const tr = state.tr
    if (empty && existing) {
      tr.removeMark(existing.from, existing.to, type)
      if (url) tr.addMark(existing.from, existing.to, type.create({ href: url }))
    } else if (!empty) {
      tr.removeMark(from, to, type)
      if (url) tr.addMark(from, to, type.create({ href: url }))
    } else if (url) {
      tr.insert(from, state.schema.text(url, [type.create({ href: url })]))
      // 続けて打つ文字はリンクにしない
      tr.removeStoredMark(type)
    }
    if (tr.docChanged) view.dispatch(tr)
    view.focus()
  })
}

/** 今のカーソル位置の書式（ボタンを押された状態で表示するため） */
export function getToolbarState(editor: Editor): ToolbarState {
  return editor.action((ctx) => stateOf(ctx.get(editorViewCtx).state))
}

/**
 * リストの種類を変え、選択範囲にかかる項目のチェックボックスを付け外しする
 * @param checked null ならチェックボックスを外す。boolean なら付ける（付いている項目はそのまま）
 */
function retypeList(
  state: EditorState,
  ctx: ListContext,
  listType: 'bullet_list' | 'ordered_list',
  checked: boolean | null
): Transaction {
  const { schema, selection } = state
  const tr = state.tr
  if (ctx.list.type.name !== listType) {
    tr.setNodeMarkup(ctx.listPos, schema.nodes[listType], ctx.list.attrs)
  }
  const itemListType = listType === 'ordered_list' ? 'ordered' : 'bullet'
  ctx.list.forEach((item, offset) => {
    const pos = ctx.listPos + 1 + offset
    const selected = pos + item.nodeSize > selection.from && pos < selection.to
    // 番号付きにするときは、どの項目にもチェックボックスを残さない（RULES.md は `- [ ]` だけ）
    let nextChecked = item.attrs.checked ?? null
    if (listType === 'ordered_list') nextChecked = null
    else if (selected) nextChecked = checked === null ? null : (item.attrs.checked ?? checked)
    if (nextChecked !== item.attrs.checked || item.attrs.listType !== itemListType) {
      tr.setNodeMarkup(pos, undefined, {
        ...item.attrs,
        checked: nextChecked,
        listType: itemListType
      })
    }
  })
  return tr
}

/**
 * カーソルのあるリストを、すぐ前・すぐ後の同じ種類のリストとつなげる
 * 隣り合う別々のリストは、区別するために2つ目が `*` で書き出されてしまう（RULES.md は `-` だけ）
 */
function joinAdjacentLists(view: EditorView): void {
  const ctx = currentList(view.state)
  if (!ctx) return
  const tr = view.state.tr
  const end = ctx.listPos + ctx.list.nodeSize
  const after = tr.doc.resolve(end).nodeAfter
  if (after && after.type === ctx.list.type) tr.join(end)
  const before = tr.doc.resolve(ctx.listPos).nodeBefore
  if (before && before.type === ctx.list.type) tr.join(ctx.listPos)
  if (tr.docChanged) view.dispatch(tr)
}

/**
 * カーソルのある列の左か右に列を足し、その列の揃え（:---）を引き継ぐ
 * （そのままだと、足した列が既定の「左揃え」になり `:---` と書き出されるため）
 */
function addColumn(view: EditorView, side: 'before' | 'after', add: () => void): void {
  const rect = selectedRect(view.state)
  const source = side === 'after' ? rect.right - 1 : rect.left
  const alignments = Array.from(
    { length: rect.map.height },
    (_, row) => rect.table.nodeAt(rect.map.map[row * rect.map.width + source])?.attrs.alignment
  )
  add()
  const added = selectedRect(view.state)
  const column = side === 'after' ? source + 1 : source
  const tr = view.state.tr
  for (let row = 0; row < added.map.height; row++) {
    const pos = added.tableStart + added.map.map[row * added.map.width + column]
    const cell = tr.doc.nodeAt(pos)
    if (cell && cell.attrs.alignment !== alignments[row]) {
      tr.setNodeMarkup(pos, undefined, { ...cell.attrs, alignment: alignments[row] })
    }
  }
  if (tr.docChanged) view.dispatch(tr)
}

/**
 * 表を挿入した後の片付け。セルの揃えをなしにし、カーソルが表の外に残っていたら最初のセルに移す
 * （Milkdown は挿入した位置の前にカーソルを残すことがある）
 */
function afterInsertTable(view: EditorView): void {
  const { state } = view
  const inTable = isInTable(state)
  let tablePos = inTable ? selectedRect(state).tableStart - 1 : -1
  if (!inTable) {
    state.doc.nodesBetween(state.selection.from, state.doc.content.size, (node, pos) => {
      if (tablePos >= 0) return false
      if (node.type.name === 'table') tablePos = pos
      return tablePos < 0
    })
  }
  if (tablePos < 0) return
  const tr = state.tr
  // 挿入した表のセルは既定で「左揃え」（:---）になるので、揃えなし（---）にする
  state.doc.nodeAt(tablePos)?.descendants((node, offset) => {
    if (node.attrs.alignment !== undefined && node.attrs.alignment !== null) {
      tr.setNodeMarkup(tablePos + 1 + offset, undefined, { ...node.attrs, alignment: null })
    }
    return true
  })
  if (!inTable) {
    const selection = Selection.findFrom(tr.doc.resolve(tablePos + 1), 1, true)
    if (selection) tr.setSelection(selection)
  }
  if (tr.docChanged || tr.selectionSet) view.dispatch(tr)
}

/**
 * カーソルのある段落の後ろに区切り線を入れ、その次の段落にカーソルを移す
 * （Milkdown の insertHrCommand は段落の途中で分けて空の段落を残し、`<br />` と書き出されることがあるため）
 * カーソルのある段落が空なら、その段落を区切り線に置き換える
 */
function insertHr(view: EditorView): void {
  const { state } = view
  const { $from } = state.selection
  const { schema } = state
  // 一番外側のブロック（リストや引用の中なら、その外側）の後ろに入れる
  const depth = Math.min(1, $from.depth)
  if (depth < 1) return
  const block = $from.node(depth)
  const start = $from.before(depth)
  const end = $from.after(depth)
  const tr = state.tr
  let after: number
  if (block.type.name === 'paragraph' && block.content.size === 0) {
    tr.replaceWith(start, end, schema.nodes.hr.create())
    after = start + 1
  } else {
    tr.insert(end, schema.nodes.hr.create())
    after = end + 1
  }
  // 区切り線が最後なら、続けて書けるよう空の段落を足す（最後の空の段落は書き出されない）
  if (after >= tr.doc.content.size) tr.insert(after, schema.nodes.paragraph.create())
  tr.setSelection(Selection.near(tr.doc.resolve(after + 1)))
  view.dispatch(tr.scrollIntoView())
}

/** ツールバーのボタンを押したときの操作 */
export function runToolbarAction(editor: Editor, action: ToolbarAction): void {
  editor.action((ctx) => {
    const view = ctx.get(editorViewCtx)
    const commands = ctx.get(commandsCtx)
    const before = stateOf(view.state)
    const list = currentList(view.state)

    switch (action) {
      case 'strong':
        commands.call(toggleStrongCommand.key)
        break
      case 'strike':
        commands.call(toggleStrikethroughCommand.key)
        break
      case 'emphasis':
        commands.call(toggleEmphasisCommand.key)
        break
      case 'inlineCode':
        commands.call(toggleInlineCodeCommand.key)
        break
      case 'quote':
        // 引用の中で押したら引用から出す
        if (before.quote) lift(view.state, view.dispatch)
        else commands.call(wrapInBlockquoteCommand.key)
        break
      case 'codeBlock':
        // コードブロックの中で押したら本文に戻す
        if (before.codeBlock)
          setBlockType(view.state.schema.nodes.paragraph)(view.state, view.dispatch)
        else commands.call(createCodeBlockCommand.key)
        break
      case 'hr':
        insertHr(view)
        break
      case 'indent':
        if (before.inList) commands.call(sinkListItemCommand.key)
        break
      case 'outdent':
        if (before.inList) commands.call(liftListItemCommand.key)
        break
      case 'undo':
        commands.call(undoCommand.key)
        break
      case 'redo':
        commands.call(redoCommand.key)
        break
      case 'bullet':
      case 'ordered': {
        const listType = action === 'bullet' ? 'bullet_list' : 'ordered_list'
        if (before[action]) {
          // 同じ種類のリストの中で押したら、リストから外す
          commands.call(liftListItemCommand.key)
        } else if (list) {
          view.dispatch(retypeList(view.state, list, listType, null))
        } else {
          commands.call(
            action === 'bullet' ? wrapInBulletListCommand.key : wrapInOrderedListCommand.key
          )
        }
        break
      }
      case 'table':
        // 表の中には表を入れられない（GFM の表のセルには、文字の書式しか書けない）
        if (before.inTable) break
        commands.call(insertTableCommand.key, NEW_TABLE)
        afterInsertTable(view)
        break
      case 'rowAbove':
        if (before.inTable && !before.inHeaderRow) commands.call(addRowBeforeCommand.key)
        break
      case 'rowBelow':
        if (before.inTable) commands.call(addRowAfterCommand.key)
        break
      case 'colLeft':
      case 'colRight':
        if (before.inTable)
          addColumn(view, action === 'colLeft' ? 'before' : 'after', () =>
            commands.call(action === 'colLeft' ? addColBeforeCommand.key : addColAfterCommand.key)
          )
        break
      case 'deleteRow':
        if (before.inTable && !before.inHeaderRow) deleteRow(view.state, view.dispatch)
        break
      case 'deleteCol':
        if (!before.inTable) break
        // 最後の1列を消すときは、表ごと消す
        if (selectedRect(view.state).map.width <= 1) deleteTable(view.state, view.dispatch)
        else deleteColumn(view.state, view.dispatch)
        break
      case 'task': {
        if (before.task && list) {
          view.dispatch(retypeList(view.state, list, 'bullet_list', null))
          break
        }
        if (!list) {
          commands.call(wrapInBulletListCommand.key)
          const wrapped = currentList(view.state)
          if (!wrapped) break
          view.dispatch(retypeList(view.state, wrapped, 'bullet_list', false))
        } else {
          view.dispatch(retypeList(view.state, list, 'bullet_list', false))
        }
        break
      }
    }
    if (action === 'bullet' || action === 'ordered' || action === 'task') joinAdjacentLists(view)
    view.focus()
  })
}
