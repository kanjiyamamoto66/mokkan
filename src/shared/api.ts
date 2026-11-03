// 裏方（main）と画面（renderer）の間でやりとりする型

import type { Note } from './note'
import type { SearchHit, SearchOptions } from './search'
import type { TagColors } from './tagColor'
import type { ListSort, Ticket } from './ticket'

/**
 * tasks/ フォルダの状態
 * - unset：まだ選ばれていない
 * - missing：選んだフォルダが見つからない（同期フォルダや外付けのドライブが未接続など）
 * - not-initialized：フォルダはあるが tickets/ がない
 * - ready：読み込める
 */
export type FolderStatus = 'unset' | 'missing' | 'not-initialized' | 'ready'

export interface AppState {
  tasksDir: string | null
  folderStatus: FolderStatus
  tickets: Ticket[]
  /** tasks/notes/ のノート */
  notes: Note[]
  /** tasks/TAGS.md に書いたタグの色（タグ → 色相）。選んでいないタグは入らない */
  tagColors: TagColors
  /** TAGS.md の確認が必要なこと（読めない理由と、同期サービスの競合コピーのファイル名） */
  tagFile: { error: string | null; conflicts: string[] }
  /** 起動時に、ID だけのファイル名に見出しを付け足した件数 */
  renamedOnStart: number
}

export interface CreateResult {
  fileName: string
}

/**
 * 保存の結果
 * - saved：書き込んだ（text は書き込んだ内容）
 * - conflict：最後に読んでから外部で変わっていたので書き込まなかった（text は今のファイルの内容）
 * - missing：ファイルがなくなっていた
 */
export type SaveResult =
  { status: 'saved'; text: string } | { status: 'conflict'; text: string } | { status: 'missing' }

/**
 * 繰り返しの次回分を作った結果
 * - created：作った（fileName は次回分のファイル名）
 * - exists：同じ次回分がすでにあったので作らなかった
 * - none：完了していない・繰り返しがないなど、作る対象ではなかった
 */
export type RepeatResult =
  | { status: 'created'; fileName: string; due: string | null; start: string | null }
  | { status: 'exists'; fileName: string }
  | { status: 'none' }

/** ノートからチケットを起こすときの、タイトルのほかの値 */
export interface FromNoteRequest {
  /** 「宿題」の項目の文。あればその行の最後に「→ リンク」を付ける */
  homeworkItem?: string | null
  /** 担当者。空なら自分 */
  assignee?: string[]
  /** 期限（YYYY-MM-DD） */
  due?: string | null
}

/**
 * ノートからチケットを起こした結果
 * - created：チケットを作り、ノートの「宿題」に書き戻した（noteText は書き戻した後のノートの中身）
 * - conflict：ノートが最後に読んでから外部で変わっていたので、何も作らなかった（text は今のノートの中身）
 * - not-written-back：チケットは作ったが、ノートに書き戻せなかった（作っている間にノートが外部で変わった、
 *   書き込みに失敗したなど）。line は「宿題」に書くはずだった行（手で書き足してもらう）
 */
export type FromNoteResult =
  | { status: 'created'; fileName: string; noteText: string }
  | { status: 'conflict'; text: string }
  | { status: 'not-written-back'; fileName: string; line: string; reason: string }

/**
 * tasks/ 直下のルールのファイル（RULES.md など）が、アプリの原本と同じか
 * - same：同じ
 * - different：違う（手で直した、古い版のまま、など）
 * - missing：ない
 */
export interface RuleFileStatus {
  name: string
  state: 'same' | 'different' | 'missing'
}

/** AI が出したタスクの候補 */
export interface AiCandidate {
  title: string
  assignees: string[]
  /** 期限（YYYY-MM-DD）。はっきりしなければ null */
  due: string | null
  /** 根拠になった発言 */
  evidence: string
  /** 「宿題」の項目から起こしたときの、その項目の文 */
  homework: string | null
  /** 迷っているときの理由 */
  doubt: string | null
}

/**
 * AI に候補を出してもらった結果
 * - ok：候補（truncated は長すぎて途中までを送ったか）
 * - not-installed：Claude Code（claude コマンド）が見つからない
 * - error：AI がエラーを返した・止めたなど
 */
export type AiSuggestResult =
  | { status: 'ok'; candidates: AiCandidate[]; truncated: boolean }
  | { status: 'not-installed' }
  | { status: 'error'; message: string }

/**
 * 設定ボタンへの案内
 * - first：初めての起動。自分の名前を入れてもらう
 * - rules-updated：バージョンアップで、ルールのファイルが原本と違う
 */
export type Onboarding = 'first' | 'rules-updated'

export interface MokkanApi {
  getState(): Promise<AppState>
  /** 状態が変わるたびに呼ばれる。戻り値の関数で購読をやめる */
  onStateChange(listener: (state: AppState) => void): () => void
  /** フォルダを選ぶダイアログを開く。キャンセルしたら今の状態を返す */
  chooseFolder(): Promise<AppState>
  /** tickets/ を作り、ルールのファイル（RULES.md・テンプレート・CLAUDE.md・AGENTS.md）がなければ置く */
  initFolder(): Promise<AppState>
  /**
   * TEMPLATE.md から新しいチケットを作る。着手日に今日・担当者と作成者に自分の名前を入れる
   * @param tags 初めに付けるタグ（絞り込みでタグを1つだけ選んでいるときのそのタグ）
   */
  createTicket(tags?: string[]): Promise<CreateResult>
  /** NOTE_TEMPLATE.md から新しいノートを作る。fileName は `notes/ファイル名` */
  createNote(): Promise<CreateResult>
  /**
   * ノートからチケットを起こし、ノートの「宿題」に書き戻す
   * @param noteBase 画面が最後に読んだノートの中身。ファイルがこれと違えば何もしない
   */
  createTicketFromNote(
    noteFileName: string,
    noteBase: string,
    title: string,
    options?: FromNoteRequest
  ): Promise<FromNoteResult>
  /** ルールのファイルが原本と同じかを調べる */
  checkRuleFiles(): Promise<RuleFileStatus[]>
  /** 指定したルールのファイルを原本にする（違うものは今のファイルをごみ箱に移してから置く） */
  updateRuleFiles(names: string[]): Promise<RuleFileStatus[]>
  /** 完了した繰り返しのチケットの次回分を作る（完了にした操作のあとで呼ぶ） */
  createNextRepeat(fileName: string): Promise<RepeatResult>
  /** チケット（またはノート。キーは `notes/ファイル名`）のファイルの中身を読む。ないときは null */
  readTicket(fileName: string): Promise<string | null>
  /**
   * チケットを保存する。ファイルの今の中身が baseText と同じときだけ書き込む
   * @param force 外部の変更があっても上書きする（ユーザーが「自分の変更を残す」を選んだとき）
   */
  saveTicket(
    fileName: string,
    baseText: string,
    newText: string,
    force?: boolean
  ): Promise<SaveResult>
  /** このアプリで作ったばかりで、タイトルも本文も空のままなら削除する。削除したら true */
  discardIfEmpty(fileName: string): Promise<boolean>
  /**
   * 完了したチケットを、子孫と一緒に archive/ に移す
   * @returns 元のキー（Ticket.fileName）から、移した後のキーへの対応
   */
  archiveTicket(fileName: string): Promise<Record<string, string>>
  /** アーカイブしたチケットを、アーカイブしている子孫と一緒に tickets/ に戻す。戻り値は archiveTicket と同じ */
  restoreTicket(fileName: string): Promise<Record<string, string>>
  /** 完了日が cutoff（YYYY-MM-DD）以前のチケットを、まとめて archive/ に移す。戻り値は archiveTicket と同じ */
  archiveDoneBefore(cutoff: string): Promise<Record<string, string>>
  /** チケットを子孫と一緒に OS のごみ箱に移す。移した件数を返す */
  deleteTicket(fileName: string): Promise<number>
  /** チケットを既定のアプリ（外部のエディタ）で開く */
  openExternal(fileName: string): Promise<void>
  /** tasks/ フォルダをエクスプローラーで開く */
  revealFolder(): Promise<void>
  /** 保存した一覧の並び順（個人設定）。保存していなければ null */
  getListSort(): Promise<ListSort | null>
  setListSort(sort: ListSort): Promise<void>
  /** 自分の名前（個人設定）。新しく作るチケットの作成者に入れる。未設定なら空文字 */
  getUserName(): Promise<string>
  /** 自分の名前を保存する。前後の空白を除いた、保存した名前を返す */
  setUserName(userName: string): Promise<string>
  /**
   * 設定ボタンへの案内が要るか。初めての起動なら first、バージョンアップでルールのファイルが原本と違えば rules-updated、
   * 要らなければ null（そのときは今の版を覚える）。tasks/ のフォルダが使える状態になってから呼ぶ
   */
  getOnboarding(): Promise<Onboarding | null>
  /**
   * ノートを AI（パソコンの Claude Code）に送り、タスクの候補を出してもらう。チケットは作らない
   * @param noteBase 画面が最後に読んだノートの中身（送るのはこの中身）
   */
  suggestTasksFromNote(
    noteFileName: string,
    noteBase: string,
    options: { includeTranscript: boolean }
  ): Promise<AiSuggestResult>
  /** AI に候補を出してもらっている途中なら止める */
  cancelSuggestTasks(): Promise<void>
  /** チケット・ノート・アーカイブを、タイトルと本文から探す */
  search(query: string, options: SearchOptions): Promise<SearchHit[]>
  /** 案内を閉じた（または設定を開いた）。今の版を覚え、次からは出さない */
  dismissOnboarding(): Promise<void>
  /** タグの色（色相 0〜359）を tasks/TAGS.md に書く。null なら指定を外す（名前から決める色に戻す） */
  setTagColor(tag: string, hue: number | null): Promise<void>
}

/** IPC のチャンネル名 */
export const IPC = {
  getState: 'mokkan:get-state',
  stateChanged: 'mokkan:state-changed',
  chooseFolder: 'mokkan:choose-folder',
  initFolder: 'mokkan:init-folder',
  createTicket: 'mokkan:create-ticket',
  createNote: 'mokkan:create-note',
  createTicketFromNote: 'mokkan:create-ticket-from-note',
  checkRuleFiles: 'mokkan:check-rule-files',
  updateRuleFiles: 'mokkan:update-rule-files',
  createNextRepeat: 'mokkan:create-next-repeat',
  readTicket: 'mokkan:read-ticket',
  saveTicket: 'mokkan:save-ticket',
  discardIfEmpty: 'mokkan:discard-if-empty',
  archiveTicket: 'mokkan:archive-ticket',
  restoreTicket: 'mokkan:restore-ticket',
  archiveDoneBefore: 'mokkan:archive-done-before',
  deleteTicket: 'mokkan:delete-ticket',
  openExternal: 'mokkan:open-external',
  revealFolder: 'mokkan:reveal-folder',
  getListSort: 'mokkan:get-list-sort',
  setListSort: 'mokkan:set-list-sort',
  getUserName: 'mokkan:get-user-name',
  setUserName: 'mokkan:set-user-name',
  setTagColor: 'mokkan:set-tag-color',
  getOnboarding: 'mokkan:get-onboarding',
  dismissOnboarding: 'mokkan:dismiss-onboarding',
  search: 'mokkan:search',
  suggestTasksFromNote: 'mokkan:suggest-tasks-from-note',
  cancelSuggestTasks: 'mokkan:cancel-suggest-tasks'
} as const
