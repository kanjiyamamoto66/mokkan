// README と docs/guide.md のスクリーンショットを撮り、docs/images/ に PNG で置く（npm run screenshots）
//
// 手順（見本のデータで撮る。本物のデータ・名前・PC のパスが写らないように）：
//   1. node scripts/make-sandbox.mjs sandbox/screenshots          （見本を作る。撮り直すときは消してから）
//   2. 開発版を、その見本で CDP を開いて起動する（PowerShell）：
//        $env:MOKKAN_TASKS_DIR = "<リポジトリ>\sandbox\screenshots"; $env:REMOTE_DEBUGGING_PORT = '9339'; npm run dev
//   3. npm run screenshots
// 開いているフォルダが sandbox/screenshots でなければ止める。画面はライトの配色・1280×800 で撮る。
// 撮る前に、フォルダの場所の文字を見本の場所に置き換え、設定の「自分の名前」は見本の名前にする（保存はしない）。
// 撮り直すのは、版を上げるとき（画面が変わったものだけ入れ替える）

import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const outDir = join(root, 'docs', 'images')
const port = process.env.MOKKAN_CDP_PORT || '9339'
const WIDTH = 1280
const HEIGHT = 800
/** 画面に出るフォルダの場所の代わりに出す文字 */
const SAMPLE_DIR = 'C:\\Users\\you\\Documents\\tasks'
const SAMPLE_NAME = '高橋'

const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json()
const page = targets.find((t) => t.type === 'page' && !t.url.startsWith('devtools'))
if (!page)
  throw new Error(`CDP（ポート ${port}）に mokkan の画面が見つかりません。開発版を起動してください`)
const ws = new WebSocket(page.webSocketDebuggerUrl)
await new Promise((r) => ws.addEventListener('open', r, { once: true }))
let seq = 0
const pending = new Map()
ws.addEventListener('message', (e) => {
  const msg = JSON.parse(e.data)
  if (msg.id && pending.has(msg.id)) {
    pending.get(msg.id)(msg)
    pending.delete(msg.id)
  }
})
const send = (method, params = {}) =>
  new Promise((resolve) => {
    const id = ++seq
    pending.set(id, resolve)
    ws.send(JSON.stringify({ id, method, params }))
  })
/** 画面で関数の中身を動かす（async。戻り値は JSON にできるもの） */
async function run(body) {
  const res = await send('Runtime.evaluate', {
    expression: `(async () => { const sleep = (ms) => new Promise((r) => setTimeout(r, ms)); ${body} })()`,
    awaitPromise: true,
    returnByValue: true
  })
  if (res.result?.exceptionDetails) {
    throw new Error(
      JSON.stringify(res.result.exceptionDetails.exception?.description ?? res.result)
    )
  }
  return res.result?.result?.value
}

// 見本のフォルダで動いているかを確かめる
const tasksDir = await run('return (await window.api.getState()).tasksDir')
if (!tasksDir || !/[\\/]sandbox[\\/]screenshots[\\/]?$/.test(tasksDir)) {
  throw new Error(
    `開いているフォルダが sandbox/screenshots ではありません（${tasksDir}）。見本のデータで起動してください`
  )
}

await send('Emulation.setDeviceMetricsOverride', {
  width: WIDTH,
  height: HEIGHT,
  deviceScaleFactor: 1,
  mobile: false
})
await send('Emulation.setEmulatedMedia', {
  features: [{ name: 'prefers-color-scheme', value: 'light' }]
})

/** 画面を今の状態に戻す（窓を閉じ、編集画面を閉じ、帯を隠す） */
const RESET = `
  for (let i = 0; i < 3; i++) {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
  }
  document.querySelector('.dialog-backdrop')?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
  await sleep(200)
  document.querySelector('.editor button[title="閉じる"]')?.click()
  await sleep(300)
  if (!document.getElementById('shot-style')) {
    const style = document.createElement('style')
    style.id = 'shot-style'
    // 案内の帯と、見本にわざと入れてある警告は、どの画像でも同じなので隠す
    style.textContent = '.banner, .warnings { display: none !important; }'
    document.head.append(style)
  }
`
const view = (label) => `
  [...document.querySelectorAll('nav.views button')].find((b) => b.getAttribute('aria-label') === '${label}').click()
  await sleep(700)
`
const openListItem = (title) => `
  const item = [...document.querySelectorAll('.main li')].find((li) => li.textContent.includes(${JSON.stringify(title)}))
  ;(item.querySelector('button') ?? item).click()
  await sleep(1500)
`
/** 写る文字のうち、PC のフォルダの場所と自分の名前を見本のものにする */
const SANITIZE = `
  const dir = ${JSON.stringify(tasksDir)}
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (n.nodeValue.includes(dir)) n.nodeValue = n.nodeValue.split(dir).join(${JSON.stringify(SAMPLE_DIR)})
  }
  for (const el of document.querySelectorAll('[title]')) {
    if (el.title.includes(dir)) el.title = el.title.split(dir).join(${JSON.stringify(SAMPLE_DIR)})
  }
  const name = document.querySelector('.dialog input[maxlength="100"], .dialog input[aria-label="自分の名前"]')
  if (name) name.value = ${JSON.stringify(SAMPLE_NAME)}
`

const shots = [
  { name: 'overview', steps: [view('一覧'), openListItem('A社に見積書を送る')] },
  { name: 'list', steps: [view('一覧')] },
  { name: 'calendar', steps: [view('カレンダー')] },
  { name: 'gantt', steps: [view('ガント')] },
  {
    name: 'timetable',
    // 前に別の日へ移っていたら、今日（見本の時間割がある日）に戻す。
    // 開いたときは今の時刻のあたりを出すので、撮るときはいつも朝（8:30）からにする。
    // 今の時刻の赤い線は、撮る時刻で位置が変わり、予定の文字に重なると取り消し線に見えるので隠す
    steps: [
      view('時間割'),
      `const today = [...document.querySelectorAll('.timetable-bar button')].find((b) => b.textContent.trim() === '今日')
       if (today && !today.disabled) { today.click(); await sleep(600) }
       document.querySelector('.timetable-scroll').scrollTop = 8.5 * 48
       const now = document.querySelector('.timetable-now')
       if (now) now.style.display = 'none'
       await sleep(200)`
    ]
  },
  { name: 'notes', steps: [view('ノート'), openListItem('A社_入口')] },
  { name: 'editor-ticket', steps: [view('一覧'), openListItem('医療費の領収書を集める')] },
  { name: 'editor-note', steps: [view('ノート'), openListItem('A社定例')] },
  {
    name: 'note-lint',
    steps: [
      view('ノート'),
      `[...document.querySelectorAll('button')].find((b) => b.textContent.trim() === '点検…').click(); await sleep(1200)`
    ]
  },
  {
    name: 'settings',
    steps: [
      view('一覧'),
      `document.querySelector('button[aria-label="設定"]').click(); await sleep(1200)`
    ]
  },
  {
    name: 'help',
    steps: [
      view('一覧'),
      `document.querySelector('.help-button').click(); await sleep(500)
       ;[...document.querySelectorAll('.help-tabs button')].find((b) => b.textContent === 'はじめに').click()
       await sleep(500)`
    ]
  }
]

mkdirSync(outDir, { recursive: true })
for (const shot of shots) {
  await run(RESET)
  for (const step of shot.steps) await run(step)
  await run(SANITIZE)
  await new Promise((r) => setTimeout(r, 400))
  const png = await send('Page.captureScreenshot', { format: 'png' })
  const path = join(outDir, `${shot.name}.png`)
  writeFileSync(path, Buffer.from(png.result.data, 'base64'))
  console.log(`撮りました：docs/images/${shot.name}.png`)
}
await run(RESET)
await send('Emulation.clearDeviceMetricsOverride')
await send('Emulation.setEmulatedMedia', { features: [] })
ws.close()
