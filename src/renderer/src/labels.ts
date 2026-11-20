import type { NoteType } from '../../shared/note'
import type { Priority, SortDirection, SortKey, Status } from '../../shared/ticket'

/** ノートの種類（RULES.md「ノートの書き方」の記録と知識、と入口） */
export const NOTE_TYPE_LABELS: Record<NoteType, string> = {
  record: '記録',
  knowledge: '知識',
  index: '入口'
}

/** ノートの種類の説明（選ぶ欄のヒントに出す） */
export const NOTE_TYPE_HINTS: Record<NoteType, string> = {
  record:
    'その時に起きたこと（議事メモ・作業の記録など）。事情が変わっても書き換えず、その時の事実として残します',
  knowledge:
    '今の正しい状態（手順・仕様・今の決まりなど）。事情が変わったら書き換えて、今の正しい状態を示します',
  index: 'プロジェクトの入口（目的・知識の状況・ノートの一覧）。進み具合はチケットに書きます'
}

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
