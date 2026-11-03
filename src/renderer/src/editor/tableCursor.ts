// 本文の表で、カーソルのあるセルと、その行・列に印を付ける ProseMirror のプラグイン
// 画面の飾り（decoration）だけで、本文（ファイル）には何も書かない
// 複数のセルを選んだとき（CellSelection）は、prosemirror-tables が付ける .selectedCell の色で見せる

import type { EditorState } from '@milkdown/kit/prose/state'
import { Plugin, PluginKey } from '@milkdown/kit/prose/state'
import { CellSelection, TableMap, isInTable } from '@milkdown/kit/prose/tables'
import { Decoration, DecorationSet } from '@milkdown/kit/prose/view'
import { $prose } from '@milkdown/kit/utils'

const key = new PluginKey<DecorationSet>('mokkanTableCursor')

const CELL_TYPES = new Set(['table_cell', 'table_header'])

/** カーソルのあるセル・行・列に付ける飾り */
export function tableCursorDecorations(state: EditorState): DecorationSet {
  const { selection, doc } = state
  if (selection instanceof CellSelection || !isInTable(state)) return DecorationSet.empty
  const { $from } = selection
  let cellDepth = -1
  for (let depth = $from.depth; depth > 0; depth--) {
    if (CELL_TYPES.has($from.node(depth).type.name)) {
      cellDepth = depth
      break
    }
  }
  // 表のセル → 行 → 表 の順に入れ子になっている
  if (cellDepth < 2) return DecorationSet.empty
  const table = $from.node(cellDepth - 2)
  const tableStart = $from.start(cellDepth - 2)
  const cellPos = $from.before(cellDepth)
  const rowPos = $from.before(cellDepth - 1)
  const map = TableMap.get(table)
  const rect = map.findCell(cellPos - tableStart)

  const decorations: Decoration[] = [
    Decoration.node(rowPos, rowPos + $from.node(cellDepth - 1).nodeSize, {
      class: 'mk-current-row'
    })
  ]
  // 同じ列のセル（結合したセルは GFM の表にはないので、1列ずつ見ればよい）
  for (let row = 0; row < map.height; row++) {
    const pos = tableStart + map.map[row * map.width + rect.left]
    const cell = doc.nodeAt(pos)
    if (!cell) continue
    decorations.push(
      Decoration.node(pos, pos + cell.nodeSize, {
        class: pos === cellPos ? 'mk-current-col mk-current-cell' : 'mk-current-col'
      })
    )
  }
  return DecorationSet.create(doc, decorations)
}

/** カーソルのあるセルに印を付ける Milkdown のプラグイン */
export const tableCursor = $prose(
  () =>
    new Plugin({
      key,
      props: {
        decorations: (state) => tableCursorDecorations(state)
      }
    })
)
