// ノートの画面の左に出す、notes/ の下のフォルダの木と、種類の絞り込み
// フォルダを選ぶと、その下のノート（サブフォルダも含む）を一覧に出す。新規ノートは選んでいるフォルダに作る

import { useMemo, useState } from 'react'
import { NOTE_TYPES, type Note, type NoteType } from '../../../shared/note'
import { NOTE_TYPE_HINTS, NOTE_TYPE_LABELS } from '../labels'

interface Props {
  /** notes/ の下のフォルダ（`案件A/定例` の形） */
  folders: string[]
  /** 一覧の件数を数えるノート（タグの絞り込みの後） */
  notes: Note[]
  /** 選んでいるフォルダ。空文字なら「すべて」 */
  selected: string
  onSelect: (folder: string) => void
  /** 絞り込む種類。空なら絞り込まない */
  types: NoteType[]
  onTypesChange: (types: NoteType[]) => void
  /** フォルダを作る。作れなかったときは理由を返す */
  onCreateFolder: (parent: string, name: string) => Promise<string | null>
}

interface TreeNode {
  /** `案件A/定例` の形 */
  path: string
  name: string
  children: TreeNode[]
}

/** フォルダの一覧を木にする（途中のフォルダが一覧になくても補う） */
function buildTree(folders: string[]): TreeNode[] {
  const roots: TreeNode[] = []
  const byPath = new Map<string, TreeNode>()
  const ensure = (path: string): TreeNode => {
    const found = byPath.get(path)
    if (found) return found
    const at = path.lastIndexOf('/')
    const node: TreeNode = { path, name: path.slice(at + 1), children: [] }
    byPath.set(path, node)
    if (at < 0) roots.push(node)
    else ensure(path.slice(0, at)).children.push(node)
    return node
  }
  for (const f of folders) ensure(f)
  const sort = (nodes: TreeNode[]): void => {
    nodes.sort((a, b) => a.name.localeCompare(b.name, 'ja'))
    nodes.forEach((n) => sort(n.children))
  }
  sort(roots)
  return roots
}

/** フォルダの名前の入力欄（フォルダを作るとき） */
function NewFolderInput({
  parent,
  onCreate,
  onDone
}: {
  parent: string
  onCreate: Props['onCreateFolder']
  onDone: () => void
}): React.JSX.Element {
  const [name, setName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const submit = async (): Promise<void> => {
    if (name.trim() === '' || busy) return
    setBusy(true)
    const reason = await onCreate(parent, name.trim())
    setBusy(false)
    if (reason) setError(reason)
    else onDone()
  }
  return (
    <form
      className="new-folder"
      onSubmit={(e) => {
        e.preventDefault()
        void submit()
      }}
    >
      <input
        autoFocus
        value={name}
        maxLength={100}
        placeholder={parent ? `${parent} の中に作る` : 'notes/ の直下に作る'}
        aria-label="フォルダの名前"
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') onDone()
        }}
      />
      <div className="new-folder-actions">
        <button type="submit" className="primary" disabled={busy || name.trim() === ''}>
          作る
        </button>
        <button type="button" className="ghost" onClick={onDone}>
          やめる
        </button>
      </div>
      {error && <p className="dialog-error">{error}</p>}
    </form>
  )
}

function NoteFolderTree({
  folders,
  notes,
  selected,
  onSelect,
  types,
  onTypesChange,
  onCreateFolder
}: Props): React.JSX.Element {
  const tree = useMemo(() => buildTree(folders), [folders])
  /** 閉じているフォルダ（初めはすべて開いている） */
  const [closed, setClosed] = useState<Set<string>>(new Set())
  const [creating, setCreating] = useState(false)

  // フォルダごとの件数（その下のフォルダも含む）
  const counts = useMemo(() => {
    const map = new Map<string, number>()
    for (const n of notes) {
      const parts = n.folder ? n.folder.split('/') : []
      for (let i = 1; i <= parts.length; i++) {
        const path = parts.slice(0, i).join('/')
        map.set(path, (map.get(path) ?? 0) + 1)
      }
    }
    return map
  }, [notes])

  const toggle = (path: string): void => {
    const next = new Set(closed)
    if (next.has(path)) next.delete(path)
    else next.add(path)
    setClosed(next)
  }

  const renderNodes = (nodes: TreeNode[], depth: number): React.JSX.Element[] =>
    nodes.map((node) => {
      const open = !closed.has(node.path)
      return (
        <li key={node.path}>
          <div
            className={node.path === selected ? 'folder-row selected' : 'folder-row'}
            style={{ paddingLeft: 4 + depth * 14 }}
          >
            {node.children.length > 0 ? (
              <button
                type="button"
                className="folder-toggle"
                aria-label={open ? '閉じる' : '開く'}
                aria-expanded={open}
                onClick={() => toggle(node.path)}
              >
                {open ? '▾' : '▸'}
              </button>
            ) : (
              <span className="folder-toggle" />
            )}
            <button
              type="button"
              className="folder-name"
              title={`notes/${node.path}`}
              onClick={() => onSelect(node.path)}
            >
              {node.name}
              <span className="folder-count">{counts.get(node.path) ?? 0}</span>
            </button>
          </div>
          {open && node.children.length > 0 && <ul>{renderNodes(node.children, depth + 1)}</ul>}
        </li>
      )
    })

  return (
    <aside className="note-folders">
      <div className="note-types" role="group" aria-label="種類で絞り込む">
        {NOTE_TYPES.map((t) => (
          <button
            key={t}
            type="button"
            className={types.includes(t) ? 'chip on' : 'chip'}
            title={NOTE_TYPE_HINTS[t]}
            aria-pressed={types.includes(t)}
            onClick={() =>
              onTypesChange(types.includes(t) ? types.filter((x) => x !== t) : [...types, t])
            }
          >
            {NOTE_TYPE_LABELS[t]}
          </button>
        ))}
      </div>
      <ul className="folder-tree">
        <li>
          <div className={selected === '' ? 'folder-row selected' : 'folder-row'}>
            <span className="folder-toggle" />
            <button type="button" className="folder-name" onClick={() => onSelect('')}>
              すべて
              <span className="folder-count">{notes.length}</span>
            </button>
          </div>
        </li>
        {renderNodes(tree, 0)}
      </ul>
      {creating ? (
        <NewFolderInput
          parent={selected}
          onCreate={onCreateFolder}
          onDone={() => setCreating(false)}
        />
      ) : (
        <button
          type="button"
          className="ghost new-folder-button"
          title={
            selected
              ? `「${selected}」の中にフォルダを作ります`
              : 'notes/ の直下にフォルダを作ります'
          }
          onClick={() => setCreating(true)}
        >
          ＋ フォルダ
        </button>
      )}
    </aside>
  )
}

export default NoteFolderTree
