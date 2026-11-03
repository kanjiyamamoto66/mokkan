import type { Priority, SortDirection, SortKey, Status } from '../../shared/ticket'

export const STATUS_LABELS: Record<Status, string> = {
  todo: '未着手',
  doing: '作業中',
  waiting: '待ち',
  done: '完了'
}

export const PRIORITY_LABELS: Record<Priority, string> = {
  1: '高',
  2: '中',
  3: '低'
}

export const SORT_LABELS: Record<SortKey, string> = {
  due: '期限',
  start: '着手日',
  priority: '優先度',
  created: '作成日',
  modified: '更新日時',
  status: '状態',
  title: 'タイトル'
}

/** 並べ替えの向きの表示（基準ごとにわかりやすい言葉にする） */
export const SORT_DIRECTION_LABELS: Record<SortKey, Record<SortDirection, string>> = {
  due: { asc: '近い順', desc: '遠い順' },
  start: { asc: '早い順', desc: '遅い順' },
  priority: { asc: '高い順', desc: '低い順' },
  created: { asc: '古い順', desc: '新しい順' },
  modified: { asc: '古い順', desc: '新しい順' },
  status: { asc: '未着手から', desc: '完了から' },
  // 漢字は読みの順には並ばないので、五十音順とは書かない
  title: { asc: '昇順', desc: '降順' }
}
