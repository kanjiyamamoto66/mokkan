// 動作確認用のタスクデータを sandbox/tasks に作る（sandbox/ は .gitignore 済み）
// 既にあるファイルには触れない。作り直したいときは sandbox/ を消してから実行する
//
//   npm run sandbox

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const tasksDir = join(root, 'sandbox', 'tasks')
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
    tags: ['家'],
    parent: '20261001-0900-pa01',
    title: '医療費の領収書を集める',
    memo: '- [ ] 病院\n- [ ] 薬局'
  }),
  '20261005-1400-ov01_見積書を送る.md': ticket({
    id: '20261005-1400-ov01',
    priority: 1,
    due: day(-1),
    tags: ['仕事', 'A社'],
    title: '見積書を送る'
  }),
  '20261006-1000-wt01.md': ticket({
    id: '20261006-1000-wt01',
    status: 'waiting',
    priority: 3,
    due: day(5),
    tags: ['仕事'],
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
  '20261015-1400-mt01_A社定例.md': [
    '---',
    'id: 20261015-1400-mt01',
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
for (const [name, content] of Object.entries(notes)) write(join(tasksDir, 'notes', name), content)
console.log(`sandbox：${tasksDir}`)
