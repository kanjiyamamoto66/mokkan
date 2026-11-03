import { app, shell, BrowserWindow, dialog, ipcMain, session } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import { IPC, type AppState } from '../shared/api'
import {
  getLastVersion,
  getListSort,
  getTasksDir,
  getUserName,
  saveLastVersion,
  saveListSort,
  saveTasksDir,
  saveUserName
} from './settings'
import {
  isExternalUrl,
  normalizeFromNoteOptions,
  normalizeTag,
  normalizeTitle,
  onboardingHandlers,
  requireString,
  requireStringArray,
  settingsHandlers,
  ticketHandlers
} from './ipc'
import { cancelClaude, suggestTasksFromNote } from './aiTasks'
import { TaskStore } from './taskStore'
import bundledRules from '../../templates/RULES.md?raw'

// 開発中は設定やキャッシュを配布版と分ける（%APPDATA%\mokkan-dev）
if (!app.isPackaged) {
  app.setPath('userData', join(app.getPath('appData'), 'mokkan-dev'))
}

// 同じ tasks/ を2つのウィンドウで監視・保存しないよう、起動は1つだけにする。
// 2つ目に起動されたら、すでに開いているウィンドウを前に出して終わる。
// ロックは userData ごとなので、開発版（mokkan-dev）とインストール版は同時に動かせる
const isPrimaryInstance = app.requestSingleInstanceLock()
if (!isPrimaryInstance) {
  app.quit()
}

let mainWindow: BrowserWindow | null = null
let store: TaskStore | null = null

app.on('second-instance', () => {
  if (!mainWindow) return
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.focus()
})

function sendState(state: AppState): void {
  mainWindow?.webContents.send(IPC.stateChanged, state)
}

/** 今の設定のフォルダで読み込みと監視をやり直す */
async function restartStore(): Promise<AppState> {
  await store?.discardAllEmpty()
  await store?.stop()
  // 削除は OS のごみ箱に移す（同期フォルダなら、同期サービスの側でも戻せることが多い）
  store = new TaskStore(getTasksDir(), sendState, { trash: (path) => shell.trashItem(path) })
  try {
    await store.start()
    // 読み込んだ後に1回だけ（起動時と、フォルダを選び直したり準備したりして開き直したとき）、
    // ID だけのファイル名に見出しを付け足す
    await store.renameUntitledFiles(getUserName())
  } catch (error) {
    console.error('[mokkan] tasks フォルダを読み込めませんでした', error)
  }
  const state = store.getState()
  sendState(state)
  return state
}

function requireStore(): TaskStore {
  if (!store) throw new Error('まだ準備ができていません')
  return store
}

function registerIpc(): void {
  ipcMain.handle(IPC.getState, () => requireStore().getState())

  ipcMain.handle(IPC.chooseFolder, async () => {
    const options: Electron.OpenDialogOptions = {
      title: 'tasks フォルダを選ぶ',
      properties: ['openDirectory', 'createDirectory']
    }
    const result = mainWindow
      ? await dialog.showOpenDialog(mainWindow, options)
      : await dialog.showOpenDialog(options)
    if (result.canceled || result.filePaths.length === 0) return requireStore().getState()
    saveTasksDir(result.filePaths[0])
    return restartStore()
  })

  ipcMain.handle(IPC.initFolder, async () => {
    await requireStore().initFolder()
    return restartStore()
  })

  // 作成者には、設定の「自分の名前」を入れる
  // 絞り込みでタグを1つだけ選んでいるときは、そのタグを初めの値にする（画面から渡す）
  ipcMain.handle(IPC.createTicket, async (_, tags: unknown) => ({
    fileName: await requireStore().createTicket(
      getUserName(),
      tags === undefined ? [] : requireStringArray(tags, 'tags').map(normalizeTag)
    )
  }))
  ipcMain.handle(IPC.createNote, async () => ({
    fileName: await requireStore().createNote(getUserName())
  }))
  ipcMain.handle(
    IPC.createTicketFromNote,
    (_, noteFileName: unknown, noteBase: unknown, title: unknown, options: unknown) =>
      requireStore().createTicketFromNote(
        requireString(noteFileName, 'noteFileName'),
        requireString(noteBase, 'noteBase'),
        normalizeTitle(title),
        getUserName(),
        normalizeFromNoteOptions(options)
      )
  )
  // ノートを AI（パソコンの Claude Code）に送り、タスクの候補を出してもらう。チケットは作らない
  ipcMain.handle(
    IPC.suggestTasksFromNote,
    (_, noteFileName: unknown, noteBase: unknown, options: unknown) =>
      suggestTasksFromNote(
        requireStore(),
        requireString(noteFileName, 'noteFileName'),
        requireString(noteBase, 'noteBase'),
        typeof options === 'object' &&
          options !== null &&
          (options as Record<string, unknown>).includeTranscript === true,
        bundledRules
      )
  )
  ipcMain.handle(IPC.cancelSuggestTasks, () => cancelClaude())
  ipcMain.handle(IPC.createNextRepeat, (_, fileName: unknown) =>
    requireStore().createNextRepeat(requireString(fileName, 'fileName'), getUserName())
  )

  const handlers = {
    ...ticketHandlers(requireStore, (path) => shell.openPath(path)),
    ...settingsHandlers({ getListSort, saveListSort, getUserName, saveUserName })
  }
  for (const [channel, handler] of Object.entries(handlers)) {
    ipcMain.handle(channel, (_, ...args: unknown[]) => handler(...args))
  }

  // 設定ボタンへの案内。案内が要らなければ、その場で今の版を覚える
  const onboarding = onboardingHandlers({
    version: app.getVersion(),
    getLastVersion,
    saveLastVersion,
    getUserName,
    checkRuleFiles: () => requireStore().checkRuleFiles()
  })
  for (const [channel, handler] of Object.entries(onboarding)) {
    ipcMain.handle(channel, (_, ...args: unknown[]) => handler(...args))
  }

  ipcMain.handle(IPC.revealFolder, async () => {
    const tasksDir = requireStore().getState().tasksDir
    if (tasksDir) await shell.openPath(tasksDir)
  })
}

/** ウィンドウのタイトル。開発版は (dev) を付けて、インストール版と見分けられるようにする */
function windowTitle(): string {
  return `mokkan ${app.getVersion()}${app.isPackaged ? '' : ' (dev)'}`
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    show: false,
    autoHideMenuBar: true,
    title: windowTitle(),
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      // preload は CommonJS で出力し、@electron-toolkit/preload も同梱している（electron.vite.config.ts）ので
      // sandbox の中でも動く。preload で Node の機能が要るようになったら、裏方に IPC で頼むこと
      sandbox: true
    }
  })

  // index.html の <title> で、バージョンのないタイトルに上書きされないようにする
  mainWindow.on('page-title-updated', (event) => {
    event.preventDefault()
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow?.show()
  })

  mainWindow.on('closed', () => {
    mainWindow = null
  })

  // 新しいウィンドウは作らず、http/https のリンクだけを既定のブラウザで開く。
  // file: などは開くとファイルやプログラムが実行されうるので無視する
  mainWindow.webContents.setWindowOpenHandler((details) => {
    if (isExternalUrl(details.url)) {
      shell.openExternal(details.url).catch((error) => {
        console.error(`[mokkan] ${details.url} を開けませんでした`, error)
      })
    } else {
      console.warn(`[mokkan] http/https 以外のリンクは開きません：${details.url}`)
    }
    return { action: 'deny' }
  })

  // 画面は1ページだけで、ページを移ることはない。HTML ファイルをウィンドウにドラッグしたときなどに
  // ほかのページへ移ると、そのページからも preload の window.api（ファイルの読み書き）が使えてしまうので止める
  mainWindow.webContents.on('will-navigate', (event, url) => {
    // 同じページの読み込み直し（location.reload や開発中の Vite の再読み込み）も will-navigate が出るので、それは通す
    if (url === mainWindow?.webContents.getURL()) return
    event.preventDefault()
    console.warn(`[mokkan] ページの移動を止めました：${url}`)
  })

  // HMR for renderer base on electron-vite cli.
  // Load the remote URL for development or the local html file for production.
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(async () => {
  // app.quit() は待たずに戻るので、2つ目の起動では読み込みも監視も始めない
  if (!isPrimaryInstance) return

  electronApp.setAppUserModelId('com.kanjiyamamoto66.mokkan')

  // カメラ・マイク・通知・位置などの権限は使わないので、求められてもすべて断る
  session.defaultSession.setPermissionRequestHandler((_, __, callback) => callback(false))
  session.defaultSession.setPermissionCheckHandler(() => false)

  // Default open or close DevTools by F12 in development
  // and ignore CommandOrControl + R in production.
  // see https://github.com/alex8088/electron-toolkit/tree/master/packages/utils
  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  registerIpc()
  await restartStore()
  createWindow()

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

// 終了する前に、作ったまま空で残っているチケットを片付ける
let cleanedUp = false
app.on('before-quit', (event) => {
  if (cleanedUp || !store) return
  event.preventDefault()
  const s = store
  void s
    .discardAllEmpty()
    .catch((error) => console.error('[mokkan] 終了前の片付けに失敗しました', error))
    .finally(() => {
      cleanedUp = true
      void s.stop().finally(() => app.quit())
    })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
