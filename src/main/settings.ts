// 個人の設定（tasks/ フォルダの場所や一覧の並び順など）。共有するデータと混ぜないよう userData に置く

import { app } from 'electron'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { DEFAULT_AI_SERVICE, asAiService, type AiService } from '../shared/aiService'
import type { TemplateKind } from '../shared/api'
import { asPaneWidths, type PaneView, type PaneWidths } from '../shared/paneWidth'
import { asListSort, type ListSort } from '../shared/ticket'

interface Settings {
  tasksDir?: string
  listSort?: unknown
  userName?: unknown
  lastVersion?: unknown
  templateChoice?: unknown
  aiService?: unknown
  paneWidths?: unknown
}

function settingsPath(): string {
  return join(app.getPath('userData'), 'settings.json')
}

function readSettings(): Settings {
  try {
    return JSON.parse(readFileSync(settingsPath(), 'utf8')) as Settings
  } catch {
    return {}
  }
}

function writeSettings(update: Settings): void {
  writeFileSync(settingsPath(), JSON.stringify({ ...readSettings(), ...update }, null, 2) + '\n')
}

/**
 * 使う tasks/ フォルダ。優先順は
 * 1. 環境変数 MOKKAN_TASKS_DIR
 * 2. 設定ファイル
 * 3. 開発中だけ、リポジトリの sandbox/tasks（.gitignore 済み）
 */
export function getTasksDir(): string | null {
  const fromEnv = process.env['MOKKAN_TASKS_DIR']
  if (fromEnv) return fromEnv
  const saved = readSettings().tasksDir
  if (saved) return saved
  if (!app.isPackaged) return join(app.getAppPath(), 'sandbox', 'tasks')
  return null
}

export function saveTasksDir(tasksDir: string): void {
  writeSettings({ tasksDir })
}

/** 一覧の並び順。保存していない・読めない値なら null */
export function getListSort(): ListSort | null {
  return asListSort(readSettings().listSort)
}

export function saveListSort(sort: ListSort): void {
  writeSettings({ listSort: sort })
}

/** 画面ごとの編集画面の幅。動かしていない画面は入らない */
export function getPaneWidths(): PaneWidths {
  return asPaneWidths(readSettings().paneWidths)
}

/** 編集画面の幅を保存する。null ならその画面の幅を消す（初めの幅に戻す） */
export function savePaneWidth(view: PaneView, width: number | null): void {
  const widths = getPaneWidths()
  if (width === null) delete widths[view]
  else widths[view] = width
  writeSettings({ paneWidths: widths })
}

/** 自分の名前（新しく作るチケットの author に入れる）。未設定なら空文字 */
export function getUserName(): string {
  const name = readSettings().userName
  return typeof name === 'string' ? name : ''
}

export function saveUserName(userName: string): void {
  writeSettings({ userName })
}

/** 最後に設定への案内を済ませた（または案内が要らなかった）アプリの版。覚えていなければ null */
export function getLastVersion(): string | null {
  const version = readSettings().lastVersion
  return typeof version === 'string' && version !== '' ? version : null
}

export function saveLastVersion(version: string): void {
  writeSettings({ lastVersion: version })
}

function templateChoices(): Partial<Record<TemplateKind, string>> {
  const saved = readSettings().templateChoice
  return saved && typeof saved === 'object' && !Array.isArray(saved)
    ? (saved as Partial<Record<TemplateKind, string>>)
    : {}
}

/** 前回選んだテンプレートの名前（新規作成の既定にする）。既定のテンプレートなら null */
export function getTemplateChoice(kind: TemplateKind): string | null {
  const name = templateChoices()[kind]
  return typeof name === 'string' && name !== '' ? name : null
}

export function saveTemplateChoice(kind: TemplateKind, name: string | null): void {
  writeSettings({ templateChoice: { ...templateChoices(), [kind]: name ?? '' } })
}

/** 使っている AI（「はじめに」の起動のしかたの書き分けに使う）。設定していない・知らない値なら Claude Code */
export function getAiService(): AiService {
  return asAiService(readSettings().aiService) ?? DEFAULT_AI_SERVICE
}

export function saveAiService(service: AiService): void {
  writeSettings({ aiService: service })
}
