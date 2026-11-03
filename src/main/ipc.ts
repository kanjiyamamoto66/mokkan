import { IPC, type Onboarding, type RuleFileStatus } from '../shared/api'
import { validDate } from '../shared/schedule'
import { asListSort, type ListSort } from '../shared/ticket'
import type { TaskStore } from './taskStore'

// electron に依存しない部分だけをここに置き、Node 上でテストできるようにする

/** 画面から渡された値が文字列かを確かめる（IPC の入力は信用しない） */
export function requireString(value: unknown, name: string): string {
  if (typeof value !== 'string') throw new Error(`${name} が文字列ではありません`)
  return value
}

/** 画面から渡された値が文字列の配列かを確かめる */
export function requireStringArray(value: unknown, name: string): string[] {
  if (!Array.isArray(value) || !value.every((v) => typeof v === 'string')) {
    throw new Error(`${name} が文字列の配列ではありません`)
  }
  return value
}

/** チケットのタイトルの長さの上限 */
const MAX_TITLE_LENGTH = 200

/**
 * 画面から来たチケットのタイトルを確かめて整える（前後の空白を除く）
 * 見出しの1行とノートの「宿題」の1行に書くので、空や、改行などの制御文字は受け付けない
 */
export function normalizeTitle(value: unknown): string {
  const title = requireString(value, 'title').trim()
  if (title === '') throw new Error('タイトルを入れてください')
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(title))
    throw new Error('タイトルに改行などの制御文字は使えません')
  if (title.length > MAX_TITLE_LENGTH) {
    throw new Error(`タイトルは${MAX_TITLE_LENGTH}文字までにしてください`)
  }
  return title
}

/** 検索の文字列の長さの上限 */
const MAX_QUERY_LENGTH = 200

/** 「宿題」の項目の文の長さの上限 */
const MAX_HOMEWORK_LENGTH = 1000

/**
 * 画面から来た「ノートからチケットを起こす」ときの値を確かめる
 * 宿題の項目の文は1行、担当者は名前の配列、期限は YYYY-MM-DD だけを受け付ける
 */
export function normalizeFromNoteOptions(value: unknown): {
  homeworkItem: string | null
  assignee: string[]
  due: string | null
} {
  if (value === undefined || value === null) return { homeworkItem: null, assignee: [], due: null }
  if (typeof value !== 'object' || Array.isArray(value))
    throw new Error('options が正しくありません')
  const { homeworkItem, assignee, due } = value as Record<string, unknown>
  let item: string | null = null
  if (homeworkItem !== undefined && homeworkItem !== null) {
    item = requireString(homeworkItem, 'homeworkItem').trim() || null
    // eslint-disable-next-line no-control-regex
    if (item && /[\u0000-\u001f\u007f]/.test(item)) throw new Error('宿題の項目は1行にしてください')
    if (item && item.length > MAX_HOMEWORK_LENGTH) throw new Error('宿題の項目が長すぎます')
  }
  const names =
    assignee === undefined || assignee === null
      ? []
      : requireStringArray(assignee, 'assignee')
          .map((n) => normalizeUserName(n))
          .filter((n) => n !== '')
  let date: string | null = null
  if (due !== undefined && due !== null && due !== '') {
    date = validDate(requireString(due, 'due'))
    if (!date) throw new Error('期限の日付が正しくありません')
  }
  return { homeworkItem: item, assignee: names, due: date }
}

/** タグの名前の長さの上限 */
const MAX_TAG_LENGTH = 100

/** 画面から来たタグの名前を確かめて整える。TAGS.md の1行に書くので、空や制御文字は受け付けない */
export function normalizeTag(value: unknown): string {
  const tag = requireString(value, 'tag').trim()
  if (tag === '') throw new Error('タグが空です')
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(tag)) throw new Error('タグに改行などの制御文字は使えません')
  if (tag.length > MAX_TAG_LENGTH) throw new Error(`タグは${MAX_TAG_LENGTH}文字までにしてください`)
  return tag
}

/** 画面から来た色相を確かめる。0〜359 の整数か null（指定を外す）だけを受け付ける */
export function requireHue(value: unknown): number | null {
  if (value === null) return null
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > 359) {
    throw new Error('色相は 0〜359 の整数にしてください')
  }
  return value
}

/** 外部のブラウザで開いてよい URL か（http と https だけ。file: などは開かない） */
export function isExternalUrl(url: string): boolean {
  try {
    const { protocol } = new URL(url)
    return protocol === 'http:' || protocol === 'https:'
  } catch {
    return false
  }
}

type TicketStore = Pick<
  TaskStore,
  | 'readTicket'
  | 'saveTicket'
  | 'discardIfEmpty'
  | 'ticketPath'
  | 'archiveTicket'
  | 'restoreTicket'
  | 'archiveDoneBefore'
  | 'deleteTicket'
  | 'checkRuleFiles'
  | 'updateRuleFiles'
  | 'setTagColor'
  | 'search'
>

/** IPC のハンドラー。引数は ipcMain.handle の event を除いたもの */
export type IpcHandler = (...args: unknown[]) => unknown

/**
 * チケットを読み書きする IPC のハンドラーを作る。
 * 画面から来た引数はここで確かめてから TaskStore に渡す。
 */
export function ticketHandlers(
  getStore: () => TicketStore,
  openPath: (path: string) => Promise<string>
): Record<string, IpcHandler> {
  return {
    [IPC.readTicket]: (fileName) => getStore().readTicket(requireString(fileName, 'fileName')),

    // force は true のときだけ上書きする。true 以外（文字列の "true" なども）は false 扱い
    [IPC.saveTicket]: (fileName, baseText, newText, force) =>
      getStore().saveTicket(
        requireString(fileName, 'fileName'),
        requireString(baseText, 'baseText'),
        requireString(newText, 'newText'),
        force === true
      ),

    [IPC.discardIfEmpty]: (fileName) =>
      getStore().discardIfEmpty(requireString(fileName, 'fileName')),

    [IPC.archiveTicket]: (fileName) =>
      getStore().archiveTicket(requireString(fileName, 'fileName')),

    [IPC.restoreTicket]: (fileName) =>
      getStore().restoreTicket(requireString(fileName, 'fileName')),

    [IPC.archiveDoneBefore]: (cutoff) => {
      const date = validDate(requireString(cutoff, 'cutoff'))
      if (!date) throw new Error('日付が正しくありません')
      return getStore().archiveDoneBefore(date)
    },

    [IPC.deleteTicket]: (fileName) => getStore().deleteTicket(requireString(fileName, 'fileName')),

    [IPC.checkRuleFiles]: () => getStore().checkRuleFiles(),

    [IPC.updateRuleFiles]: (names) =>
      getStore().updateRuleFiles(requireStringArray(names, 'names')),

    [IPC.setTagColor]: (tag, hue) => getStore().setTagColor(normalizeTag(tag), requireHue(hue)),

    // 検索の文字列は長さだけを確かめる（ファイルには書かない）。文字起こしを探すのは true のときだけ
    [IPC.search]: (query, options) => {
      const q = requireString(query, 'query')
      if (q.length > MAX_QUERY_LENGTH) throw new Error('検索の文字列が長すぎます')
      const includeTranscript =
        typeof options === 'object' &&
        options !== null &&
        (options as Record<string, unknown>).includeTranscript === true
      return getStore().search(q, { includeTranscript })
    },

    [IPC.openExternal]: async (fileName) => {
      const path = getStore().ticketPath(requireString(fileName, 'fileName'))
      const error = await openPath(path)
      if (error) throw new Error(error)
    }
  }
}

/** 自分の名前の長さの上限 */
const MAX_USER_NAME_LENGTH = 100

/**
 * 画面から来た自分の名前を確かめて整える（前後の空白を除く）
 * frontmatter の1行に書くので、改行などの制御文字は受け付けない
 */
export function normalizeUserName(value: unknown): string {
  const name = requireString(value, 'userName').trim()
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(name)) throw new Error('名前に改行などの制御文字は使えません')
  if (name.length > MAX_USER_NAME_LENGTH) {
    throw new Error(`名前は${MAX_USER_NAME_LENGTH}文字までにしてください`)
  }
  return name
}

/**
 * 設定ボタンへの案内が要るかを決める
 * - 覚えた版がなく、自分の名前も空なら、初めての起動（必ず出す）
 * - 覚えた版と今の版が違えば（または名前だけある古い設定なら）バージョンアップとみなし、
 *   ルールのファイルが原本と違うときだけ出す
 * @param ruleStates ルールのファイルの確認の結果（バージョンアップのときだけ使う）
 */
export function decideOnboarding(
  lastVersion: string | null,
  currentVersion: string,
  userName: string,
  ruleStates: () => Promise<RuleFileStatus[]>
): Promise<Onboarding | null> {
  if (lastVersion === currentVersion) return Promise.resolve(null)
  if (lastVersion === null && userName.trim() === '') return Promise.resolve('first')
  return ruleStates().then((states) =>
    states.some((s) => s.state !== 'same') ? 'rules-updated' : null
  )
}

/**
 * 設定ボタンへの案内の IPC のハンドラー
 * 案内が要らなければ、その場で今の版を覚える（次からは確かめない）。案内を出したときは、閉じるまで覚えない
 */
export function onboardingHandlers(deps: {
  version: string
  getLastVersion: () => string | null
  saveLastVersion: (version: string) => void
  getUserName: () => string
  checkRuleFiles: () => Promise<RuleFileStatus[]>
}): Record<string, IpcHandler> {
  return {
    [IPC.getOnboarding]: async () => {
      const result = await decideOnboarding(
        deps.getLastVersion(),
        deps.version,
        deps.getUserName(),
        deps.checkRuleFiles
      )
      if (result === null) deps.saveLastVersion(deps.version)
      return result
    },
    [IPC.dismissOnboarding]: () => deps.saveLastVersion(deps.version)
  }
}

interface SettingsStore {
  getListSort: () => ListSort | null
  saveListSort: (sort: ListSort) => void
  getUserName: () => string
  saveUserName: (userName: string) => void
}

/** 個人設定の IPC のハンドラー。画面から来た値は確かめてから保存する */
export function settingsHandlers(settings: SettingsStore): Record<string, IpcHandler> {
  return {
    [IPC.getListSort]: () => settings.getListSort(),

    [IPC.setListSort]: (sort) => {
      const valid = asListSort(sort)
      if (!valid) throw new Error('並び順の値が正しくありません')
      settings.saveListSort(valid)
    },

    [IPC.getUserName]: () => settings.getUserName(),

    [IPC.setUserName]: (userName) => {
      const name = normalizeUserName(userName)
      settings.saveUserName(name)
      return name
    }
  }
}
