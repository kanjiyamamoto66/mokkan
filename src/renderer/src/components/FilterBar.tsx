import {
  SORT_KEYS,
  UNASSIGNED,
  type ListFilter,
  type ListSort,
  type Priority,
  type SortDirection,
  type SortKey,
  type Status
} from '../../../shared/ticket'
import type { TagColors } from '../../../shared/tagColor'
import { PRIORITY_LABELS, SORT_DIRECTION_LABELS, SORT_LABELS, STATUS_LABELS } from '../labels'
import { tagStyle } from '../tagStyle'

interface Props {
  filter: ListFilter
  tags: string[]
  /** これまでに入力された担当者の名前 */
  assignees: string[]
  /** 自分の名前（個人設定）。空なら「自分」の選択は出さない */
  userName: string
  /** 「着手日が先のものも表示」を出すか（一覧だけ） */
  showFutureStartOption: boolean
  /** 最新の絞り込み条件から新しい条件を作る関数を渡す（連続して押しても取りこぼさない） */
  onChange: (update: (filter: ListFilter) => ListFilter) => void
  /** 一覧の並び順。渡したときだけ並べ替えの選択を出す（一覧だけ） */
  sort?: ListSort
  onSortChange?: (sort: ListSort) => void
  /** タグの絞り込みだけを出す（ノートの一覧。タグの選択は一覧・カレンダー・ガントと共通） */
  tagsOnly?: boolean
  /** タグの色（TAGS.md） */
  tagColors: TagColors
}

const FILTER_STATUSES: Status[] = ['todo', 'doing', 'waiting']
const PRIORITIES: Priority[] = [1, 2, 3]

/** 基準を選んだときの向き。作成日・更新日時は新しいものから見たいことが多いので降順にする */
const INITIAL_DIRECTION: Record<SortKey, SortDirection> = {
  due: 'asc',
  start: 'asc',
  priority: 'asc',
  created: 'desc',
  modified: 'desc',
  status: 'asc',
  title: 'asc'
}

/** 担当者の選択肢。自分を先頭に、未割り当てを最後に置く */
function assigneeChoices(
  assignees: string[],
  userName: string
): { value: string; label: string }[] {
  return [
    ...(userName ? [{ value: userName, label: '自分' }] : []),
    ...assignees.filter((a) => a !== userName).map((a) => ({ value: a, label: a })),
    { value: UNASSIGNED, label: '未割り当て' }
  ]
}

function toggle<T>(list: T[], value: T): T[] {
  return list.includes(value) ? list.filter((v) => v !== value) : [...list, value]
}

function FilterBar({
  filter,
  tags,
  assignees,
  userName,
  showFutureStartOption,
  onChange,
  sort,
  onSortChange,
  tagsOnly = false,
  tagColors
}: Props): React.JSX.Element {
  const tagGroup = tags.length > 0 && (
    <div className="group">
      <span className="label">タグ</span>
      {tags.map((tag) => (
        <button
          key={tag}
          className={filter.tags.includes(tag) ? 'chip tag-colored on' : 'chip tag-colored'}
          style={tagStyle(tag, tagColors)}
          onClick={() => onChange((f) => ({ ...f, tags: toggle(f.tags, tag) }))}
        >
          {tag}
        </button>
      ))}
    </div>
  )
  if (tagsOnly) return <div className="filters">{tagGroup}</div>

  return (
    <div className="filters">
      {sort && onSortChange && (
        <div className="group">
          <span className="label">並び順</span>
          <select
            className="sort-key"
            aria-label="並べ替えの基準"
            value={sort.key}
            onChange={(e) => {
              const key = e.target.value as SortKey
              onSortChange({ key, direction: INITIAL_DIRECTION[key] })
            }}
          >
            {SORT_KEYS.map((k) => (
              <option key={k} value={k}>
                {SORT_LABELS[k]}
              </option>
            ))}
          </select>
          <button
            className="chip"
            title="並べる向きを切り替える"
            onClick={() =>
              onSortChange({ ...sort, direction: sort.direction === 'asc' ? 'desc' : 'asc' })
            }
          >
            {sort.direction === 'asc' ? '↑' : '↓'} {SORT_DIRECTION_LABELS[sort.key][sort.direction]}
          </button>
        </div>
      )}
      <div className="group">
        <span className="label">状態</span>
        {FILTER_STATUSES.map((s) => (
          <button
            key={s}
            className={filter.statuses.includes(s) ? 'chip on' : 'chip'}
            onClick={() => onChange((f) => ({ ...f, statuses: toggle(f.statuses, s) }))}
          >
            {STATUS_LABELS[s]}
          </button>
        ))}
      </div>
      <div className="group">
        <span className="label">優先度</span>
        {PRIORITIES.map((p) => (
          <button
            key={p}
            className={filter.priorities.includes(p) ? 'chip on' : 'chip'}
            onClick={() => onChange((f) => ({ ...f, priorities: toggle(f.priorities, p) }))}
          >
            <span className={`priority-dot p${p}`} aria-hidden />
            {PRIORITY_LABELS[p]}
          </button>
        ))}
      </div>
      {tagGroup}
      {(assignees.length > 0 || userName !== '') && (
        <div className="group">
          <span className="label">担当者</span>
          {assigneeChoices(assignees, userName).map(({ value, label }) => (
            <button
              key={value === UNASSIGNED ? 'unassigned' : `name:${value}`}
              className={filter.assignees.includes(value) ? 'chip on' : 'chip'}
              title={value === userName ? `自分（${userName}）` : undefined}
              onClick={() => onChange((f) => ({ ...f, assignees: toggle(f.assignees, value) }))}
            >
              {label}
            </button>
          ))}
        </div>
      )}
      {showFutureStartOption && (
        <label className="check">
          <input
            type="checkbox"
            checked={filter.showFutureStart}
            onChange={(e) => onChange((f) => ({ ...f, showFutureStart: e.target.checked }))}
          />
          着手日が先のものも表示
        </label>
      )}
      <label className="check">
        <input
          type="checkbox"
          checked={filter.showDone}
          onChange={(e) => onChange((f) => ({ ...f, showDone: e.target.checked }))}
        />
        完了も表示
      </label>
      <label className="check">
        <input
          type="checkbox"
          checked={filter.showArchived}
          onChange={(e) => onChange((f) => ({ ...f, showArchived: e.target.checked }))}
        />
        アーカイブも表示
      </label>
    </div>
  )
}

export default FilterBar
