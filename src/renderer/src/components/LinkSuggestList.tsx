// 本文で `[[` と打ったときに出す、リンクの候補の一覧。キー操作は editor/linkSuggest.ts から受け取る

import type { LinkTarget } from '../../../shared/links'
import { isNoteKey } from '../../../shared/note'

interface Props {
  items: LinkTarget[]
  active: number
  /** 一覧を出す位置（画面の座標） */
  position: { left: number; top: number }
  onPick: (item: LinkTarget) => void
}

function kindLabel(fileName: string): string {
  if (isNoteKey(fileName)) return 'ノート'
  if (fileName.startsWith('archive/')) return 'アーカイブ'
  return 'チケット'
}

function LinkSuggestList({ items, active, position, onPick }: Props): React.JSX.Element {
  return (
    <ul
      className="link-suggest"
      role="listbox"
      aria-label="リンクの候補"
      style={{ left: position.left, top: position.top }}
    >
      {items.length === 0 && <li className="empty-item">見つかりません（Esc で閉じる）</li>}
      {items.map((item, i) => (
        <li
          key={item.fileName}
          role="option"
          aria-selected={i === active}
          className={i === active ? 'active' : ''}
          // クリックでエディタのカーソルが外れないようにする
          onMouseDown={(e) => {
            e.preventDefault()
            onPick(item)
          }}
        >
          <span className="kind">{kindLabel(item.fileName)}</span>
          <span className={item.title ? 'title' : 'title untitled'}>
            {item.title || '（タイトルなし）'}
          </span>
        </li>
      ))}
    </ul>
  )
}

export default LinkSuggestList
