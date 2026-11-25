// 動作確認用のタスクデータを sandbox/tasks に作る（sandbox/ は .gitignore 済み）
// 既にあるファイルには触れない。作り直したいときは sandbox/ を消してから実行する
// 別のフォルダに作るときは、場所を引数で渡す（スクリーンショットを撮るときなど。npm run screenshots を参照）
//
//   npm run sandbox
//   node scripts/make-sandbox.mjs sandbox/screenshots

import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const tasksDir = process.argv[2] ? resolve(process.argv[2]) : join(root, 'sandbox', 'tasks')
const ticketsDir = join(tasksDir, 'tickets')

/** 今日から days 日ずらした `YYYY-MM-DD` */
function day(days) {
  const d = new Date()
  d.setDate(d.getDate() + days)
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

function ticket({
  id,
  status = 'todo',
  priority = 2,
  start = '',
  due = '',
  estimate = '',
  tags = [],
  parent = '',
  source = '',
  assignee = '',
  done = '',
  title,
  memo = ''
}) {
  const value = (v) => (v === '' ? '' : ` ${v}`)
  return [
    '---',
    `id: ${id}`,
    `status: ${status}`,
    `priority: ${priority}`,
    `start:${value(start)}`,
    `due:${value(due)}`,
    `estimate:${value(estimate)}`,
    'repeat:',
    `tags: [${tags.join(', ')}]`,
    `parent:${value(parent)}`,
    `source:${value(source)}`,
    `assignee:${value(assignee)}`,
    'author:',
    `created: ${day(-7)}`,
    `done:${value(done)}`,
    '---',
    '',
    `# ${title}`,
    ...(memo ? ['', '## メモ', memo] : []),
    ''
  ].join('\n')
}

const files = {
  '20261001-0900-pa01_確定申告の準備.md': ticket({
    id: '20261001-0900-pa01',
    priority: 1,
    due: day(10),
    tags: ['家'],
    title: '確定申告の準備'
  }),
  '20261001-0910-ch01.md': ticket({
    id: '20261001-0910-ch01',
    status: 'doing',
    due: day(3),
    // 所要時間（時間割に置くときの長さ）の例
    estimate: '30m',
    tags: ['家'],
    parent: '20261001-0900-pa01',
    title: '医療費の領収書を集める',
    memo: '- [ ] 病院\n- [ ] 薬局'
  }),
  '20261005-1400-ov01_見積書を送る.md': ticket({
    id: '20261005-1400-ov01',
    priority: 1,
    due: day(-1),
    estimate: '1h30m',
    // キーと値のタグ（顧客/…・種類/…）の例
    tags: ['仕事', 'A社', '顧客/A社', '種類/見積'],
    title: '見積書を送る'
  }),
  '20261006-1000-wt01.md': ticket({
    id: '20261006-1000-wt01',
    status: 'waiting',
    priority: 3,
    due: day(5),
    tags: ['仕事', '顧客/B社'],
    title: 'B社の返事を待つ'
  }),
  '20261007-1100-fs01.md': ticket({
    id: '20261007-1100-fs01',
    start: day(14),
    due: day(21),
    tags: ['仕事'],
    title: '来月の企画を考える（着手日が先）'
  }),
  '20261008-0800-nd01.md': ticket({
    id: '20261008-0800-nd01',
    priority: 3,
    title: '本棚を片付ける'
  }),
  '20261009-1200-dn01.md': ticket({
    id: '20261009-1200-dn01',
    status: 'done',
    due: day(-3),
    done: day(-3),
    title: '完了済みのチケット（一覧には出ない）'
  }),
  // ガントチャート用：深い親子関係（6段）と、親の期限を子がはみ出す例
  '20261010-0900-pj01_新サービスの立ち上げ.md': ticket({
    id: '20261010-0900-pj01',
    priority: 1,
    due: day(20),
    tags: ['仕事'],
    title: '新サービスの立ち上げ'
  }),
  '20261010-0901-pj02.md': ticket({
    id: '20261010-0901-pj02',
    status: 'doing',
    start: day(-3),
    due: day(6),
    tags: ['仕事'],
    parent: '20261010-0900-pj01',
    title: '要件をまとめる'
  }),
  '20261010-0902-pj03.md': ticket({
    id: '20261010-0902-pj03',
    start: day(7),
    due: day(25),
    tags: ['仕事'],
    parent: '20261010-0900-pj01',
    title: '開発する（親の期限をはみ出す）'
  }),
  '20261010-0903-pj04.md': ticket({
    id: '20261010-0903-pj04',
    start: day(7),
    due: day(14),
    parent: '20261010-0902-pj03',
    title: '画面を作る'
  }),
  '20261010-0904-pj05.md': ticket({
    id: '20261010-0904-pj05',
    start: day(8),
    due: day(10),
    parent: '20261010-0903-pj04',
    title: '一覧画面'
  }),
  '20261010-0905-pj06.md': ticket({
    id: '20261010-0905-pj06',
    due: day(9),
    parent: '20261010-0904-pj05',
    title: '並べ替えを作る'
  }),
  '20261010-0906-pj07.md': ticket({
    id: '20261010-0906-pj07',
    parent: '20261010-0905-pj06',
    title: '6段目のチケット（日付なし）'
  }),
  // 同期サービスの競合コピーを想定（同じIDで、名前がIDで始まらない）
  '見積書を送る (1).md': ticket({
    id: '20261005-1400-ov01',
    priority: 1,
    due: day(-1),
    tags: ['仕事', 'A社'],
    title: '見積書を送る'
  }),
  // 議事メモ（notes/）から起こしたチケット
  '20261015-1510-mt02_A社に見積書を送る.md': ticket({
    id: '20261015-1510-mt02',
    priority: 1,
    due: day(3),
    tags: ['A社'],
    source: '20261015-1400-mt01',
    assignee: '高橋',
    title: 'A社に見積書を送る',
    memo: '- 高橋: 来週の金曜までに見積書を出します'
  }),
  '20261015-1511-mt03_次回の日程を調整する.md': ticket({
    id: '20261015-1511-mt03',
    status: 'done',
    tags: ['A社'],
    source: '20261015-1400-mt01',
    done: day(-1),
    title: '次回の日程を調整する'
  })
}

/** 会議の文字起こしに似せた長い原文（1時間の会議を想定して、約3万字） */
function transcript() {
  const speakers = ['高橋', '佐藤', 'A社 田中']
  const phrases = [
    'それでは定例を始めます。前回の宿題から確認させてください。',
    '見積書の件は、金額は前回と同じで問題ないと聞いています。',
    'スケジュールについては、少し余裕を持たせたほうがいいと思います。',
    'その点は社内で確認して、来週までにお返事します。',
    '資料はあとで共有フォルダに置いておきますので、見ておいてください。',
    'ちなみに、先週の展示会はいかがでしたか。人は多かったですか。',
    '検討します。決まったらまたご連絡します。'
  ]
  const blocks = []
  for (let i = 0; i < 300; i++) {
    const seconds = i * 12
    const time = [seconds / 3600, (seconds / 60) % 60, seconds % 60]
      .map((n) => String(Math.floor(n)).padStart(2, '0'))
      .join(':')
    const lines = [0, 1, 2].map(
      (j) => `${speakers[(i + j) % 3]}: ${phrases[(i * 3 + j) % phrases.length]}`
    )
    blocks.push([time, ...lines].join('\n'))
  }
  return blocks.join('\n\n')
}

const notes = {
  'A社/20261015-1400-mt01_A社定例.md': [
    '---',
    'id: 20261015-1400-mt01',
    'type: record',
    `date: ${day(-2)}`,
    'tags: [A社]',
    'author: 高橋',
    `created: ${day(-2)}`,
    '---',
    '',
    '# A社定例',
    '',
    '## 要点',
    '- 見積は前回と同じ金額で進める',
    '- 次回は2週間後',
    '',
    '## 決定事項',
    '- 見積書は高橋が来週金曜までに送る',
    '',
    '## 宿題',
    '- A社に見積書を送る（高橋）→ 20261015-1510-mt02',
    '- 次回の日程を調整する（佐藤）→ 20261015-1511-mt03',
    '- 資料を共有フォルダに置く（田中）',
    '',
    '## 文字起こし',
    '',
    transcript(),
    ''
  ].join('\n'),
  '20261012-2000-nt01_引っ越しの調べもの.md': [
    '---',
    'id: 20261012-2000-nt01',
    'type: record',
    `date: ${day(-5)}`,
    'tags: [個人]',
    'author:',
    `created: ${day(-5)}`,
    '---',
    '',
    '# 引っ越しの調べもの',
    '',
    '- 見積は3社から取る（20261001-0900-pa01 が終わってから）',
    '- 粗大ごみは2週間前までに申し込む',
    ''
  ].join('\n'),
  'A社/20261001-0900-ix01_A社_入口.md': [
    '---',
    'id: 20261001-0900-ix01',
    'type: index',
    `date: ${day(-16)}`,
    'tags: [A社]',
    'author: 高橋',
    `created: ${day(-16)}`,
    '---',
    '',
    '# A社_入口',
    '',
    '## 目的',
    '',
    'A社向けの見積と導入支援。',
    '',
    '## 知識の状況',
    '',
    '- 定例の議事メモから、見積の条件（税込・有効期限）をまだ取り込んでいない。',
    '',
    '## ノートの一覧',
    '',
    '- [見積の出し方](../共通/20261002-0900-kn01_見積の出し方.md)：見積書の作り方と送り方',
    ''
  ].join('\n'),
  '共通/20261002-0900-kn01_見積の出し方.md': [
    '---',
    'id: 20261002-0900-kn01',
    'type: knowledge',
    `date: ${day(-15)}`,
    `reviewed: ${day(-15)}`,
    'tags: []',
    'author: 高橋',
    `created: ${day(-15)}`,
    '---',
    '',
    '# 見積の出し方',
    '',
    '見積書を作って送るまでの手順。',
    '',
    '## 手順',
    '',
    '1. 前回の見積書を複製する',
    '2. 金額は税込で書く',
    '3. PDF にして送る',
    ''
  ].join('\n'),
  // ノートの点検で見つかるものの例（長く見直していない・確かめていない記述・切れたリンク・入口の一覧にない）
  'A社/20261003-0900-kn02_A社の窓口.md': [
    '---',
    'id: 20261003-0900-kn02',
    'type: knowledge',
    `date: ${day(-200)}`,
    `reviewed: ${day(-200)}`,
    'tags: [A社]',
    'author: 高橋',
    `created: ${day(-200)}`,
    '---',
    '',
    '# A社の窓口',
    '',
    'A社とやりとりするときの担当者と連絡のしかた。',
    '',
    '- 見積と契約の窓口は田中さん（要確認：担当が変わったかもしれない）',
    '- 連絡はメールで、件名に案件名を入れる',
    '- 詳しくは [前の担当の引き継ぎ](../共通/20260101-0900-zzzz_引き継ぎ.md)',
    ''
  ].join('\n')
}

mkdirSync(ticketsDir, { recursive: true })
mkdirSync(join(tasksDir, 'notes'), { recursive: true })
const write = (path, content) => {
  try {
    writeFileSync(path, content, { flag: 'wx' })
    console.log(`作成：${path}`)
  } catch (error) {
    if (error.code !== 'EEXIST') throw error
  }
}
// アプリの「準備する」と同じファイルを置く（CLAUDE.md と AGENTS.md は AI_GUIDE.md から作る）
for (const [name, source] of [
  ['RULES.md', 'RULES.md'],
  ['TEMPLATE.md', 'TEMPLATE.md'],
  ['NOTE_TEMPLATE.md', 'NOTE_TEMPLATE.md'],
  ['CLAUDE.md', 'AI_GUIDE.md'],
  ['AGENTS.md', 'AI_GUIDE.md']
]) {
  write(join(tasksDir, name), readFileSync(join(root, 'templates', source), 'utf8'))
}
for (const [name, content] of Object.entries(files)) write(join(ticketsDir, name), content)
for (const [name, content] of Object.entries(notes)) {
  mkdirSync(dirname(join(tasksDir, 'notes', name)), { recursive: true })
  write(join(tasksDir, 'notes', name), content)
}
// ノートのテンプレートの見本（アプリの「準備する」と同じ名前で置く）
mkdirSync(join(tasksDir, 'templates', 'notes'), { recursive: true })
for (const [name, source] of [
  ['議事メモ', 'meeting'],
  ['手順', 'howto'],
  ['参照', 'reference'],
  ['解説', 'explanation'],
  ['入口', 'index']
]) {
  write(
    join(tasksDir, 'templates', 'notes', `${name}.md`),
    readFileSync(join(root, 'templates', 'samples', 'notes', `${source}.md`), 'utf8')
  )
}
// 標準の skill（アプリの「準備する」と同じ場所に置く）
for (const name of readdirSync(join(root, 'templates', 'skills'))) {
  mkdirSync(join(tasksDir, '.claude', 'skills', name), { recursive: true })
  write(
    join(tasksDir, '.claude', 'skills', name, 'SKILL.md'),
    readFileSync(join(root, 'templates', 'skills', name, 'SKILL.md'), 'utf8')
  )
}
// 時間割：いつもの予定と、今日の時間割
mkdirSync(join(tasksDir, 'days'), { recursive: true })
write(
  join(tasksDir, 'days', 'routine.md'),
  [
    // 作業する時間。既定（9:00〜18:00）と違う値にして、AI が読んでいるかを評価で見分けられるようにする
    '---',
    'work: 09:00-17:30',
    '---',
    '',
    '# いつもの予定',
    '',
    '- weekdays 09:00-09:15 朝会',
    '- weekly:mon,thu 11:00-12:00 A社定例',
    `- every:2w@${day(0)} 15:00-16:00 1on1`,
    ''
  ].join('\n')
)
write(
  join(tasksDir, 'days', `${day(0)}.md`),
  [
    '---',
    `date: ${day(0)}`,
    '---',
    '',
    '- 09:00-09:15 朝会',
    '- 09:30-11:00 [見積書を送る](../tickets/20261005-1400-ov01_見積書を送る.md)',
    '- 12:00-13:00 昼休み',
    '- 13:00-13:30 [医療費の領収書を集める](../tickets/20261001-0910-ch01.md)',
    '- 15:00-16:00 1on1',
    '',
    'メモ：午後は来客あり',
    ''
  ].join('\n')
)
console.log(`sandbox：${tasksDir}`)
