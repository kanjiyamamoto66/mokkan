// build/icon.svg から、アプリのアイコン（build/icon.png・build/icon.ico・resources/icon.png）を作る。
// 実行：npm run icons（Electron の画面で SVG をサイズごとに描いて PNG にする。追加のパッケージは使わない）

import { app, BrowserWindow } from 'electron'
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const svg = readFileSync(join(root, 'build', 'icon.svg'), 'utf8')

// ico に入れる大きさ。小さい大きさも縮小ではなく SVG から描き直すので、線がにじみにくい
const ICO_SIZES = [16, 24, 32, 48, 64, 128, 256]
const PNG_SIZE = 512

/** SVG を描くための、見えないウィンドウ（一番大きい PNG_SIZE に合わせる） */
async function openCanvas() {
  const win = new BrowserWindow({
    width: PNG_SIZE,
    height: PNG_SIZE,
    show: false,
    useContentSize: true,
    transparent: true,
    frame: false,
    webPreferences: { offscreen: true }
  })
  const html =
    '<html><body style="margin:0;background:transparent;overflow:hidden">' +
    `<img src="data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}" ` +
    'style="display:block"></body></html>'
  await win.loadURL(`data:text/html;base64,${Buffer.from(html).toString('base64')}`)
  return win
}

/** SVG を size×size の PNG にする */
async function render(win, size) {
  // 大きさを変えて、描き終わるのを待つ
  await win.webContents.executeJavaScript(
    `(() => { const img = document.images[0]; img.width = ${size}; img.height = ${size};` +
      ' return img.decode().then(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))) })()'
  )
  const image = await win.webContents.capturePage({ x: 0, y: 0, width: size, height: size })
  const { width, height } = image.getSize()
  if (width !== size || height !== size) {
    throw new Error(
      `${size}px のはずが ${width}x${height}px で描かれました（画面の拡大率を確かめてください）`
    )
  }
  return image.toPNG()
}

/** PNG をそのまま入れた ico を作る（Windows Vista 以降が読める形式） */
function toIco(pngs) {
  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0)
  header.writeUInt16LE(1, 2) // 1 = アイコン
  header.writeUInt16LE(pngs.length, 4)
  const entries = []
  let offset = 6 + 16 * pngs.length
  for (const { size, data } of pngs) {
    const entry = Buffer.alloc(16)
    entry.writeUInt8(size >= 256 ? 0 : size, 0) // 256 は 0 と書く決まり
    entry.writeUInt8(size >= 256 ? 0 : size, 1)
    entry.writeUInt8(0, 2) // パレットなし
    entry.writeUInt8(0, 3)
    entry.writeUInt16LE(1, 4) // カラープレーン
    entry.writeUInt16LE(32, 6) // ビット数
    entry.writeUInt32LE(data.length, 8)
    entry.writeUInt32LE(offset, 12)
    entries.push(entry)
    offset += data.length
  }
  return Buffer.concat([header, ...entries, ...pngs.map((p) => p.data)])
}

app.disableHardwareAcceleration()
// 拡大率が 100% でない画面でも、指定した大きさのまま描く
app.commandLine.appendSwitch('force-device-scale-factor', '1')

app.whenReady().then(async () => {
  try {
    const win = await openCanvas()
    const png = await render(win, PNG_SIZE)
    writeFileSync(join(root, 'build', 'icon.png'), png)
    writeFileSync(join(root, 'resources', 'icon.png'), png)
    const pngs = []
    for (const size of ICO_SIZES) pngs.push({ size, data: await render(win, size) })
    win.destroy()
    writeFileSync(join(root, 'build', 'icon.ico'), toIco(pngs))
    console.log('build/icon.png・build/icon.ico・resources/icon.png を作りました')
    app.exit(0)
  } catch (error) {
    console.error(error)
    app.exit(1)
  }
})
