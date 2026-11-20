// ヘルプ（「？」から開く）の中身。画面ごとに「どこを押すと何ができるか」と「手元の AI に頼めること」を出す
// 細かいことは README を正とし、ここは要約にする。AI に頼む文は、裏方が id で引いてクリップボードに書く
// （画面から任意の文字を受け取ってクリップボードに書く IPC は作らない決まりなので、文はこの表にあるものだけ）

import type { AiService } from './aiService'

/** ヘルプのタブ。はじめに（初回の案内と同じ。AI に指定するフォルダと最初に頼む文）と、画面ごと */
export const HELP_TOPICS = ['start', 'list', 'calendar', 'gantt', 'notes', 'editor'] as const
export type HelpTopic = (typeof HELP_TOPICS)[number]
/** 画面ごとのタブ */
export type ScreenTopic = Exclude<HelpTopic, 'start'>

export const HELP_TOPIC_LABELS: Record<HelpTopic, string> = {
  start: 'はじめに',
  list: '一覧',
  calendar: 'カレンダー',
  gantt: 'ガント',
  notes: 'ノート',
  editor: '編集画面'
}

/** 操作の説明（ボタンの名前と1行の説明） */
export interface HelpAction {
  label: string
  text: string
}

/** 手元の AI に頼む文の例（コピーして貼れる） */
export interface HelpPrompt {
  /** 裏方がこの id で文を引いてクリップボードに書く */
  id: string
  text: string
}

export interface HelpSection {
  actions: HelpAction[]
  prompts: HelpPrompt[]
}

/** 詳しい説明（README）の場所 */
export const README_URL = 'https://github.com/kanjiyamamoto66/mokkan#readme'

/** 画面ごとのヘルプ */
export const HELP_SECTIONS: Record<ScreenTopic, HelpSection> = {
  list: {
    actions: [
      { label: '＋ 新規（Ctrl+N）', text: 'チケットを作ります。▾ でテンプレートを選べます。' },
      {
        label: '絞り込み',
        text: '状態・優先度・タグ・担当者で絞り込みます。タグはキー（顧客/A社 の「顧客」）ごとにまとまり、同じキーは「または」、違うキーは「かつ」です。'
      },
      { label: '並び順', text: '期限・着手日・優先度・作成日などで並べ替えます。' },
      { label: '検索（Ctrl+K）', text: 'チケットとノートを、タイトルと本文から探します。' },
      {
        label: 'まとめてアーカイブ…',
        text: '完了してから日がたったチケットを archive/ に移します。'
      },
      {
        label: '境目',
        text: '一覧と編集画面の境目はドラッグで動かせます（ダブルクリックで元の幅）。'
      }
    ],
    prompts: [
      {
        id: 'list-next-week',
        text: '来週が期限か着手日のチケットを一覧にして、優先して片付ける順を提案して'
      },
      {
        id: 'list-overdue',
        text: '期限を過ぎた未完了のチケットを一覧にして、それぞれ期限を延ばすか完了にするか案を出して（書き換えるのは確かめてから）'
      }
    ]
  },
  calendar: {
    actions: [
      { label: '月の移動', text: '上の矢印で前後の月に、「今日」で今月に戻ります。' },
      {
        label: '予定',
        text: '期限の日（着手日があれば期限までの帯）に出ます。押すと右に開きます。塗り方が状態、左の線がタグの色です。'
      },
      { label: '凡例', text: '色や印の意味を出します。' }
    ],
    prompts: [
      {
        id: 'calendar-busy-days',
        text: '今月、期限が集中している日と空いている日を教えて'
      }
    ]
  },
  gantt: {
    actions: [
      {
        label: 'まとめ方',
        text: '親チケットごと・タグごとのほか、キーのあるタグ（顧客/A社）があれば「顧客ごと」にもまとめられます。'
      },
      {
        label: '棒',
        text: '押すと右に開きます。親の棒は子孫全体の期間で、子がはみ出すと ⚠ が出ます。'
      }
    ],
    prompts: [
      {
        id: 'gantt-split',
        text: '「（親チケットのタイトル）」を、1〜3日でできる子チケットに分ける案を出して（作るのは確かめてから）'
      }
    ]
  },
  notes: {
    actions: [
      {
        label: 'フォルダと種類',
        text: '左の木でプロジェクトのフォルダを、上の「記録・知識・入口」で種類を絞り込みます。'
      },
      {
        label: '＋ 新規ノート',
        text: '木で選んでいるフォルダに作ります。▾ で議事メモ・手順・入口などのテンプレートを選べます。'
      },
      {
        label: '点検…',
        text: '切れたリンク・見直していない知識・入口から外れた知識などを一覧にします。「md でコピー」した結果をそのまま AI に貼ると、直す案を出してもらえます（頼む文は結果の頭に入っています）。'
      }
    ],
    prompts: [
      {
        id: 'notes-ingest',
        text: 'notes/（プロジェクト名）/ の最新の議事メモを、RULES.md の手順で知識のノートに取り込む案を出して'
      },
      {
        id: 'notes-ask',
        text: '（プロジェクト名）の入口のノートから読んで、（知りたいこと）に答えて。根拠のノートへのリンクも付けて'
      }
    ]
  },
  editor: {
    actions: [
      {
        label: 'ツールバー',
        text: '見出し・太字・リスト・チェックボックス・表などを付け外しします。保存は自動です。'
      },
      {
        label: '[[ でリンク',
        text: '本文で [[ と打つと、チケットやノートの候補が出ます。リンクは Ctrl+クリックで開きます。'
      },
      {
        label: '＋ ここからチケット',
        text: 'ノートから手でチケットを起こします（「宿題」の行にリンクが付きます）。'
      },
      {
        label: 'AI でタスクを起こす…',
        text: 'ノートを手元の AI に送り、タスクの候補を出してもらいます。作るのは選んだものだけです。'
      }
    ],
    prompts: [
      {
        id: 'editor-homework',
        text: 'notes/（ファイル名）の「宿題」を、RULES.md の手順でタスクの候補にして（作るのは確かめてから）'
      }
    ]
  }
}

/**
 * はじめに：AI をどこで起動するか（設定の「使う AI」に合わせて書き分ける）
 * AI は tasks/ のフォルダで動かすと、そこの CLAUDE.md・AGENTS.md を読み、RULES.md の決まりで読み書きする
 */
export const START_LAUNCH: Record<AiService, string[]> = {
  claude: [
    'ターミナル（PowerShell など）で上のフォルダに移り、claude と入力して Claude Code を起動します。',
    'フォルダの場所は「コピー」で取れます（例：cd "コピーした場所" → claude）。'
  ],
  cursor: [
    'Cursor の「ファイル」→「フォルダーを開く」で上のフォルダを開きます。ターミナルで使うときは、上のフォルダに移って agent と入力します。',
    'フォルダの場所は「コピー」で取れます。'
  ]
}

/** はじめに：最初に頼む文の例 */
export const START_PROMPTS: HelpPrompt[] = [
  { id: 'start-rules', text: 'RULES.md を読んで、このフォルダの決まりを教えて' },
  { id: 'start-index', text: 'notes/（プロジェクト名）/ の入口のノートを作って' }
]

/** id から、AI に頼む文を引く。なければ null */
export function helpPromptText(id: string): string | null {
  const all = [...START_PROMPTS, ...Object.values(HELP_SECTIONS).flatMap((s) => s.prompts)]
  return all.find((p) => p.id === id)?.text ?? null
}
