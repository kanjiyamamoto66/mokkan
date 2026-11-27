// ヘルプ（「？」から開く）の中身。画面ごとに「どこを押すと何ができるか」と「手元の AI に頼めること」を出す
// 細かいことは使い方のページ（docs/guide.md）を正とし、ここは要約にする。AI に頼む文は、裏方が id で引いてクリップボードに書く
// （画面から任意の文字を受け取ってクリップボードに書く IPC は作らない決まりなので、文はこの表にあるものだけ）

import type { AiService } from './aiService'
import type { SkillName } from './ruleFiles'

/** ヘルプのタブ。はじめに（初回の案内と同じ。AI に指定するフォルダと最初に頼む文）と、画面ごと */
export const HELP_TOPICS = [
  'start',
  'list',
  'calendar',
  'gantt',
  'timetable',
  'notes',
  'editor'
] as const
export type HelpTopic = (typeof HELP_TOPICS)[number]
/** 画面ごとのタブ */
export type ScreenTopic = Exclude<HelpTopic, 'start'>

export const HELP_TOPIC_LABELS: Record<HelpTopic, string> = {
  start: 'はじめに',
  list: '一覧',
  calendar: 'カレンダー',
  gantt: 'ガント',
  timetable: '時間割',
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
  /** この文で AI が使う skill（`/名前` でも呼べると添える） */
  skill?: SkillName
}

export interface HelpSection {
  actions: HelpAction[]
  prompts: HelpPrompt[]
}

/** 詳しい使い方（docs/guide.md。画面ごとにできることを書く）の場所 */
export const GUIDE_URL = 'https://github.com/kanjiyamamoto66/mokkan/blob/main/docs/guide.md'

/**
 * ヘルプのタブから開く、使い方のページの節。docs/guide.md の見出しと同じ名前にする
 * （GitHub は見出しをそのまま節の名前にする。括弧などの記号は消えるので、見出しに記号を使わない）
 */
export function guideUrl(topic: HelpTopic): string {
  return `${GUIDE_URL}#${encodeURIComponent(HELP_TOPIC_LABELS[topic])}`
}

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
        text: '期限を過ぎた未完了のチケットを一覧にして、それぞれ期限を延ばすか完了にするか案を出して（書き換えるのは確かめてから）',
        skill: 'mokkan-tidying-tickets'
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
  timetable: {
    actions: [
      {
        label: '日の移動',
        text: '「←」「→」で前後の日に、「今日」で今日に戻ります。日付の欄で日を選ぶと、その日に移ります。時間割は days/（日付）.md に1行ずつ書かれます。'
      },
      {
        label: '候補から置く',
        text: '左の「まずやる候補」（期限切れ・この日が期限・作業中）のチケットを、時間の欄へドラッグして置きます。長さは所要時間（なければ30分）です。着手日を過ぎたものは折りたたんであり、ほかのチケットは「ほかのチケットを置く」でタイトルから探せます。'
      },
      {
        label: '予定を足す',
        text: '空いている時間をダブルクリックして、MTG や昼休みなど、チケットでない予定を打ち込み、「追加」（または Enter）で足します。'
      },
      {
        label: '動かす・長さを変える',
        text: '予定をドラッグすると動き、下の端をドラッグすると長さが変わります（15分刻み）。'
      },
      {
        label: '予定のボタン',
        text: '予定にマウスを乗せる（Tab で移る）と出ます。「完了にする」でチケットを完了に（確かめてから）、「書き換え」で内容を書き換え、「議事メモ」でその MTG の議事メモを作り、「外す」で時間割から外します（文字だけの予定は確かめてから）。'
      },
      {
        label: 'いつもの予定',
        text: 'days/routine.md に繰り返しの予定（- weekly:tue 10:00-11:00 定例MTG など）を書くと、その日のファイルを初めて作るときに写します。まだ写していない日は点線で出し、「この日は外す」でその日だけ外せます。ファイルにないいつもの予定は、上に出る「写す」で足せます。作業する時間は、このファイルの先頭の work: 09:00-18:00（設定の画面でも変えられます）です。'
      }
    ],
    prompts: [
      {
        id: 'timetable-plan',
        text: '今日の時間割を組んで。候補のチケットと所要時間から、空いている時間に置く案を出して（書くのは確かめてから）',
        skill: 'mokkan-planning-days'
      },
      {
        id: 'timetable-meeting',
        text: '（日付）の 14:00-15:00 に（MTG の名前）を時間割に入れて'
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
        text: 'notes/（プロジェクト名）/ の最新の議事メモを、知識のノートに取り込む案を出して',
        skill: 'mokkan-ingesting-knowledge'
      },
      {
        id: 'notes-review',
        text: 'notes/（プロジェクト名）/ の知識のノートを点検して、直す案を出して',
        skill: 'mokkan-reviewing-knowledge'
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
        text: '本文で [[ と打つと、チケットやノートの候補が出ます。リンクは Ctrl+クリック（Mac は ⌘+クリック）で開きます（http/https のリンクはブラウザで開きます）。'
      },
      {
        label: '＋ ここからチケット',
        text: 'ノートから手でチケットを起こします（「宿題」の行にリンクが付きます）。'
      },
      {
        label: 'AI に頼む文をコピー',
        text: 'このノートからタスクを起こしてもらう文をコピーします。AI のアプリで mokkan のデータのフォルダを開いて貼ると、候補を出してくれます（作るのは確かめてから）。'
      }
    ],
    prompts: [
      {
        id: 'editor-homework',
        text: 'notes/（ファイル名）の「宿題」から、タスクの候補を出して（作るのは確かめてから）',
        skill: 'mokkan-creating-tasks-from-notes'
      }
    ]
  }
}

/**
 * はじめに：AI をどこで起動するか（設定の「使っている AI」に合わせて書き分ける）
 * AI は tasks/ のフォルダで動かすと、そこの CLAUDE.md・AGENTS.md を読み、RULES.md の決まりで読み書きする
 */
export const START_LAUNCH: Record<AiService, string[]> = {
  claude: [
    'ターミナル（PowerShell など）で上のフォルダに移り、claude と入力して Claude Code を起動します。',
    'フォルダの場所は「コピー」で取れます（例：cd "コピーした場所" → claude）。'
  ],
  'claude-desktop': [
    'Claude のデスクトップアプリの「Code」を開き、作業するフォルダに上のフォルダを選んでから頼みます。',
    'フォルダの場所は「コピー」で取れます（フォルダを選ぶ窓に貼れます）。'
  ],
  cursor: [
    'Cursor の「ファイル」→「フォルダーを開く」で上のフォルダを開きます。ターミナルで使うときは、上のフォルダに移って agent と入力します。',
    'フォルダの場所は「コピー」で取れます。'
  ]
}

/** はじめに：最初に頼む文の例 */
export const START_PROMPTS: HelpPrompt[] = [
  // 決まりそのものより、何ができるか（何を頼めるか）を先に知ってもらう。手順は RULES.md と skill から読ませる
  {
    id: 'start-overview',
    text: 'mokkan で何ができるかを教えて。RULES.md と .claude/skills/ の手順を読んで、このフォルダであなたに頼めることを、頼む文の例と一緒に挙げて'
  },
  {
    id: 'start-index',
    text: 'notes/（プロジェクト名）/ の入口のノートを作って',
    skill: 'mokkan-writing-project-indexes'
  }
]

/**
 * はじめに：mokkan が tasks/ に置く skill（作業の手順）。AI はふつうの文で頼んでも合うものを使い、
 * `/名前` で呼ぶこともできる。skill を読まない AI も、RULES.md の一覧から手順のファイルを読む
 */
export const START_SKILLS: ReadonlyArray<{ name: SkillName; text: string }> = [
  { name: 'mokkan-creating-tasks-from-notes', text: 'ノートからタスクを起こす' },
  { name: 'mokkan-ingesting-knowledge', text: '記録のノートを知識のノートに取り込む' },
  { name: 'mokkan-reviewing-knowledge', text: '知識のノートを点検する' },
  { name: 'mokkan-writing-project-indexes', text: 'プロジェクトの入口のノートを作る・直す' },
  { name: 'mokkan-tidying-tickets', text: 'チケットを整理する（期限切れ・止まっているもの）' },
  { name: 'mokkan-planning-days', text: 'その日の時間割を組む（MTG の取り込みも）' }
]

/**
 * ノートの下の「AI に頼む文をコピー」の文。ノートのキー（`notes/…/ファイル名`）は tasks/ からの場所なので、
 * AI を tasks/ で起動していれば、そのまま読める
 */
export function notePromptText(noteKey: string): string {
  return `${noteKey} から、タスクの候補を出して（作るのは確かめてから）`
}

/** id から、AI に頼む文を引く。なければ null */
export function helpPromptText(id: string): string | null {
  const all = [...START_PROMPTS, ...Object.values(HELP_SECTIONS).flatMap((s) => s.prompts)]
  return all.find((p) => p.id === id)?.text ?? null
}
