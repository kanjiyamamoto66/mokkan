// チケットとノートの編集画面。上がプロパティフォーム（frontmatter）、下が本文エディタ（Milkdown）
// ノート（キーが notes/ で始まる）は、プロパティが会議の日・タグ・作成者だけで、アーカイブはない
//
// 保存の決まり
// - 編集していなければ書き込まない
// - frontmatter は変えた項目の行だけ、本文は編集したブロックだけを書き換える（mergeBody）
// - 保存は最後に読んだ内容（baseText）とファイルが同じときだけ。外部で変わっていたら上書きせずに選ばせる

import type { Editor } from '@milkdown/kit/core'
import { editorViewCtx } from '@milkdown/kit/core'
import type { Node as ProseNode } from '@milkdown/kit/prose/model'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { AiSuggestResult, FromNoteRequest, RepeatResult } from '../../../shared/api'
import { archivePlan, deleteTargets } from '../../../shared/archive'
import { canPreserveBlocks, mergeBody } from '../../../shared/body'
import {
  FIELD_ORDER,
  NOTE_FIELD_ORDER,
  replaceBody,
  setFields,
  type FieldKey,
  type FieldUpdates
} from '../../../shared/frontmatter'
import { linkCandidates, relativeLinkPath, type LinkTarget } from '../../../shared/links'
import { isNoteKey, parseNote, type Note } from '../../../shared/note'
import type { TagColors } from '../../../shared/tagColor'
import {
  formatDate,
  isBlankBody,
  parseTicket,
  splitFrontmatter,
  type Ticket
} from '../../../shared/ticket'
import { selectFirstMatch } from '../editor/findText'
import { refreshIdLinks } from '../editor/idLinks'
import { insertLink, type LinkQuery, type LinkSuggestOptions } from '../editor/linkSuggest'
import { createMarkdownEditor, getMarkdown, startWithTitle } from '../editor/markdown'
import {
  EMPTY_TOOLBAR_STATE,
  getToolbarState,
  runToolbarAction,
  setBlockLevel,
  setLink,
  type ToolbarAction,
  type ToolbarState
} from '../editor/toolbar'
import { pendingSaves } from '../editor/closing'
import EditorToolbar from './EditorToolbar'
import LinkSuggestList from './LinkSuggestList'
import NoteProperties from './NoteProperties'
import PropertyForm from './PropertyForm'

/** 入力が止まってから保存するまでの時間 */
const SAVE_DELAY_MS = 600

interface Props {
  fileName: string
  /** このアプリで作ったばかりのチケットか（空のまま閉じたら削除する） */
  isNew: boolean
  tickets: Ticket[]
  notes: Note[]
  /** タグの色（TAGS.md） */
  tagColors: TagColors
  onOpen: (fileName: string) => void
  /** 直前に開いていたチケットやノートに戻る。戻る先がなければ undefined */
  onBack?: () => void
  /** 戻る先のタイトル（ボタンの説明に出す） */
  backLabel?: string
  onClose: () => void
  /** アーカイブ・戻すでファイルを移したとき（元のキー → 移した後のキー） */
  onMoved: (moved: Record<string, string>) => void
  /** 検索の結果から開いたとき、本文で探して選ぶ語（nonce が変わるたびに探し直す） */
  jump?: { term: string; nonce: number }
}

type Notice =
  { kind: 'conflict'; text: string } | { kind: 'missing' } | { kind: 'error'; message: string }

/** 編集中の本文の状態（描画に関係しないので ref に持つ） */
interface BodyState {
  /** ファイルにある本文 */
  original: string
  /** original をエディタで読み込んだ直後の書き出し結果 */
  baseline: string
  /** 編集後の書き出し結果。編集していなければ null */
  edited: string | null
}

/** 変えた項目があるときだけ frontmatter を書き換える（frontmatter のないファイルでも本文は編集できるように） */
function applyFields(text: string, fields: FieldUpdates, order: readonly FieldKey[]): string {
  return Object.keys(fields).length > 0 ? setFields(text, fields, order) : text
}

function bodyOf(text: string): string {
  return splitFrontmatter(text)?.body ?? text
}

function TicketEditor({
  fileName,
  isNew,
  tickets,
  notes,
  tagColors,
  onOpen,
  onBack,
  backLabel,
  onClose,
  onMoved,
  jump
}: Props): React.JSX.Element {
  const isNote = isNoteKey(fileName)
  const order = isNote ? NOTE_FIELD_ORDER : FIELD_ORDER
  const [ticket, setTicket] = useState<Ticket | null>(null)
  const [note, setNote] = useState<Note | null>(null)
  const [notice, setNotice] = useState<Notice | null>(null)
  const [saving, setSaving] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)
  /** frontmatter があるか（ないファイルはフォームで項目を編集できない） */
  const [hasFrontmatter, setHasFrontmatter] = useState(true)
  /** 編集すると本文全体が書き出し直される（リンク参照定義があるなど） */
  const [wholeBodyRewrite, setWholeBodyRewrite] = useState(false)
  /** カーソル位置の書式（ツールバーのボタンを押された状態で表示する） */
  const [toolbar, setToolbar] = useState<ToolbarState>(EMPTY_TOOLBAR_STATE)
  /** 繰り返しの次回分を作った（またはすでにあった）ときの案内 */
  const [repeatNotice, setRepeatNotice] = useState<Exclude<
    RepeatResult,
    { status: 'none' }
  > | null>(null)

  const rootRef = useRef<HTMLDivElement>(null)
  const editorRef = useRef<Editor | null>(null)
  /** 最後に読んだ（または書いた）ファイルの中身 */
  const baseRef = useRef<string | null>(null)
  const bodyRef = useRef<BodyState>({ original: '', baseline: '', edited: null })
  const fieldsRef = useRef<FieldUpdates>({})
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const chainRef = useRef<Promise<void>>(Promise.resolve())
  const conflictRef = useRef(false)

  const isDirty = (): boolean =>
    bodyRef.current.edited !== null || Object.keys(fieldsRef.current).length > 0

  // 検索の結果から開いたときに探す語。エディタを作った後と、別の語で開き直したときに探す
  const jumpRef = useRef(jump)
  useEffect(() => {
    jumpRef.current = jump
    const editor = editorRef.current
    if (editor && jump) selectFirstMatch(editor, jump.term)
  }, [jump])

  // 本文の中の ID に付けるタイトルと、開く先（エディタは作り直さずに、印だけ付け直す）
  const linksRef = useRef(new Map<string, { title: string; fileName: string }>())
  const onOpenRef = useRef(onOpen)
  useEffect(() => {
    onOpenRef.current = onOpen
    linksRef.current = new Map(
      [...tickets, ...notes].flatMap((f) =>
        f.id ? [[f.id, { title: f.title, fileName: f.fileName }] as const] : []
      )
    )
    const editor = editorRef.current
    if (editor) editor.action((ctx) => refreshIdLinks(ctx.get(editorViewCtx)))
  }, [tickets, notes, onOpen])

  // ---- 本文で `[[` と打ったときのリンクの候補 ----
  const [suggest, setSuggest] = useState<{
    query: LinkQuery
    position: { left: number; top: number }
  } | null>(null)
  const [suggestActive, setSuggestActive] = useState(0)
  const linkTargets = useMemo<LinkTarget[]>(
    () =>
      [...tickets, ...notes].map((f) => ({
        fileName: f.fileName,
        id: f.id,
        title: f.title,
        modified: f.modified
      })),
    [tickets, notes]
  )
  const candidates = useMemo(
    () => (suggest ? linkCandidates(suggest.query.query, linkTargets, fileName) : []),
    [suggest, linkTargets, fileName]
  )
  // エディタのプラグインは作ったときの関数を持ち続けるので、最新の値は ref で渡す
  const suggestRef = useRef(suggest)
  const candidatesRef = useRef(candidates)
  const suggestActiveRef = useRef(suggestActive)
  useEffect(() => {
    suggestRef.current = suggest
    candidatesRef.current = candidates
    suggestActiveRef.current = suggestActive
  }, [suggest, candidates, suggestActive])
  /** Esc で閉じた `[[` の位置（打ち直すまで出さない） */
  const dismissedSuggestRef = useRef<number | null>(null)

  /** 候補を選んだら、`[[…` を `[タイトル](相対パス)` のリンクに置き換える */
  const pickLink = useCallback(
    (item: LinkTarget) => {
      const editor = editorRef.current
      const current = suggestRef.current
      if (!editor || !current) return
      editor.action((ctx) =>
        insertLink(
          ctx.get(editorViewCtx),
          current.query,
          item.title || item.id || '',
          relativeLinkPath(fileName, item.fileName)
        )
      )
      setSuggest(null)
    },
    [fileName]
  )
  const pickLinkRef = useRef(pickLink)
  useEffect(() => {
    pickLinkRef.current = pickLink
  }, [pickLink])

  const linkSuggestOptions = useRef<LinkSuggestOptions>({
    onQuery: (query, view) => {
      if (!query) {
        dismissedSuggestRef.current = null
        setSuggest(null)
        return
      }
      if (dismissedSuggestRef.current === query.from) return
      const coords = view.coordsAtPos(query.from)
      setSuggest({ query, position: { left: coords.left, top: coords.bottom + 4 } })
      setSuggestActive(0)
    },
    onKey: (event) => {
      const current = suggestRef.current
      if (!current) return false
      const items = candidatesRef.current
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        if (items.length === 0) return true
        const step = event.key === 'ArrowDown' ? 1 : -1
        setSuggestActive((i) => (i + step + items.length) % items.length)
        return true
      }
      if (event.key === 'Enter' || event.key === 'Tab') {
        const item = items[suggestActiveRef.current]
        if (!item) return false
        pickLinkRef.current(item)
        return true
      }
      if (event.key === 'Escape') {
        dismissedSuggestRef.current = current.query.from
        setSuggest(null)
        return true
      }
      return false
    }
  })

  /** ファイルの中身を読み取って、フォームに出す */
  const showParsed = useCallback(
    (text: string): void => {
      if (isNote) setNote(parseNote(fileName, text))
      else setTicket(parseTicket(fileName, text))
    },
    [fileName, isNote]
  )

  /** 今の編集内容からファイル全体を組み立てる */
  const compose = useCallback((): string | null => {
    const base = baseRef.current
    if (base === null) return null
    let text = applyFields(base, fieldsRef.current, order)
    const body = bodyRef.current
    if (body.edited !== null) {
      text = replaceBody(text, mergeBody(body.original, body.baseline, body.edited))
    }
    return text
  }, [order])

  /** 保存する。保存中に呼ばれたら、前の保存が終わってから順に行う */
  const save = useCallback(
    (force = false): Promise<void> => {
      if (timerRef.current) clearTimeout(timerRef.current)
      timerRef.current = null
      const run = async (): Promise<void> => {
        if (!isDirty() || (conflictRef.current && !force)) return
        const base = baseRef.current
        const text = compose()
        if (base === null || text === null) return
        const sentBody = bodyRef.current.edited
        const sentFields = fieldsRef.current
        if (text === base) {
          // 変換結果が元と同じなら書き込まない
          if (bodyRef.current.edited === sentBody) {
            bodyRef.current = { ...bodyRef.current, edited: null }
          }
          if (fieldsRef.current === sentFields) fieldsRef.current = {}
          return
        }
        setSaving(true)
        try {
          const result = await window.api.saveTicket(fileName, base, text, force)
          if (result.status === 'saved') {
            baseRef.current = result.text
            conflictRef.current = false
            setNotice(null)
            // 保存中に新しい編集がなければ、保存した内容を新しい基準にする
            if (bodyRef.current.edited === sentBody && sentBody !== null) {
              bodyRef.current = { original: bodyOf(result.text), baseline: sentBody, edited: null }
            } else if (sentBody === null) {
              bodyRef.current = { ...bodyRef.current, original: bodyOf(result.text) }
            } else {
              bodyRef.current = {
                ...bodyRef.current,
                original: bodyOf(result.text),
                baseline: sentBody
              }
            }
            if (fieldsRef.current === sentFields) {
              fieldsRef.current = {}
            } else {
              const rest = { ...fieldsRef.current }
              for (const key of Object.keys(sentFields) as Array<keyof FieldUpdates>) {
                if (rest[key] === sentFields[key]) delete rest[key]
              }
              fieldsRef.current = rest
            }
            showParsed(applyFields(result.text, fieldsRef.current, order))
          } else if (result.status === 'conflict') {
            conflictRef.current = true
            setNotice({ kind: 'conflict', text: result.text })
          } else {
            setNotice({ kind: 'missing' })
          }
        } catch (error) {
          setNotice({ kind: 'error', message: (error as Error).message })
        } finally {
          setSaving(false)
        }
      }
      chainRef.current = chainRef.current.then(run, run)
      return chainRef.current
    },
    [compose, fileName, order, showParsed]
  )

  const scheduleSave = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => void save(), SAVE_DELAY_MS)
  }, [save])

  // ファイルを読み、本文エディタを作る（外部の変更を読み込むときも reloadKey を変えて作り直す）
  useEffect(() => {
    let cancelled = false
    let editor: Editor | null = null
    const root = rootRef.current
    if (!root) return

    void (async () => {
      // 同じチケットを閉じてすぐ開き直したときは、前の保存が終わってから読む（古い内容を基準にしないため）
      await pendingSaves.get(fileName)
      const text = await window.api.readTicket(fileName)
      if (cancelled) return
      if (text === null) {
        setNotice({ kind: 'missing' })
        return
      }
      baseRef.current = text
      fieldsRef.current = {}
      conflictRef.current = false
      setNotice(null)
      showParsed(text)
      setHasFrontmatter(splitFrontmatter(text) !== null)

      const body = bodyOf(text)
      root.innerHTML = ''
      editor = await createMarkdownEditor({
        root,
        // frontmatter はエディタに渡さない
        markdown: body,
        onChange: (markdown) => {
          if (markdown === bodyRef.current.baseline && bodyRef.current.edited === null) return
          bodyRef.current = { ...bodyRef.current, edited: markdown }
          scheduleSave()
        },
        onSelectionChange: () => {
          if (editorRef.current) setToolbar(getToolbarState(editorRef.current))
        },
        linkSuggest: linkSuggestOptions.current,
        idLinks: {
          titleOf: (id) => linksRef.current.get(id)?.title,
          open: (id) => {
            const target = linksRef.current.get(id)
            if (target) onOpenRef.current(target.fileName)
          }
        }
      })
      if (cancelled) {
        void editor.destroy()
        return
      }
      editorRef.current = editor
      // 検索の結果から開いたときは、当たった箇所まで動かす
      if (jumpRef.current) selectFirstMatch(editor, jumpRef.current.term)
      const baseline = getMarkdown(editor)
      bodyRef.current = { original: body, baseline, edited: null }
      // ブロック単位で元のテキストを残せない本文なら、編集する前に知らせる
      setWholeBodyRewrite(!isBlankBody(body) && !canPreserveBlocks(body, baseline))
      if (isNew && reloadKey === 0) startWithTitle(editor)
    })()

    return () => {
      cancelled = true
      editorRef.current = null
      void editor?.destroy()
    }
  }, [fileName, isNew, reloadKey, scheduleSave, showParsed])

  // 閉じるとき（別のチケットに切り替えたときも）は、残っている編集を保存する
  useEffect(() => {
    return () => {
      pendingSaves.set(fileName, save())
    }
  }, [fileName, save])

  // 外部（AI・他のエディタ・同期サービス）の変更に追従する
  useEffect(() => {
    let cancelled = false
    void (async () => {
      await chainRef.current
      const base = baseRef.current
      if (base === null) return
      const text = await window.api.readTicket(fileName)
      if (cancelled || baseRef.current !== base) return
      if (text === null) {
        setNotice({ kind: 'missing' })
      } else if (text !== base) {
        if (isDirty()) {
          // 編集中なので上書きせず、どちらを残すか選んでもらう
          conflictRef.current = true
          setNotice({ kind: 'conflict', text })
        } else {
          setReloadKey((k) => k + 1)
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [tickets, notes, fileName])

  /**
   * 繰り返しのチケットを完了にしたら、保存してから次回分を作る（RULES.md「完了にするとき」）
   * 保存できなかった（外部の変更と競合したなど）ときは作らない
   */
  const createNextRepeat = useCallback(async () => {
    await save()
    const base = baseRef.current
    if (conflictRef.current || base === null || parseTicket(fileName, base).status !== 'done') {
      return
    }
    try {
      const result = await window.api.createNextRepeat(fileName)
      if (result.status !== 'none') setRepeatNotice(result)
    } catch (error) {
      setNotice({ kind: 'error', message: `次回分を作れませんでした：${(error as Error).message}` })
    }
  }, [fileName, save])

  /**
   * ノートからチケットを起こし、ノートの「宿題」に書き戻してから、そのチケットを開く
   * 残っている編集を保存してから頼む。外部の変更と競合したら作らない
   * @returns 作れなかったときの理由（作れたら null）
   */
  const createTicketFromNote = async (
    title: string,
    request: FromNoteRequest = {},
    /** 作ったチケットを開くか（AI の候補をまとめて作るときは開かない） */
    open = true
  ): Promise<string | null> => {
    await save()
    const base = baseRef.current
    if (conflictRef.current || base === null) return '保存できていないので、作れませんでした'
    try {
      const result = await window.api.createTicketFromNote(fileName, base, title, request)
      if (result.status === 'conflict') {
        conflictRef.current = true
        setNotice({ kind: 'conflict', text: result.text })
        return 'ノートが外部で変更されていたので、作りませんでした'
      }
      if (result.status === 'not-written-back') {
        // チケットは作れた（下の「このノートから作ったチケット」に出る）ので、ノートに残って手で書き足してもらう
        return `チケットは作りましたが、「宿題」に書き戻せませんでした（${result.reason}）。「宿題」に「${result.line}」を書き足してください。`
      }
      // 書き戻した内容を新しい基準にしてから、作ったチケットを開く
      baseRef.current = result.noteText
      bodyRef.current = { ...bodyRef.current, edited: null }
      if (open) onOpen(result.fileName)
      return null
    } catch (error) {
      return (error as Error).message.replace(
        /^Error invoking remote method '[^']+': (Error: )?/,
        ''
      )
    }
  }

  /**
   * カーソルのある「宿題」の箇条書きの項目の文（書式を除いた文字）。「宿題」の中でなければ null
   * 「宿題」の下に小見出し（### A社 など）があっても、その上の「宿題」までさかのぼる
   */
  const homeworkItemAtCursor = (): string | null => {
    const editor = editorRef.current
    if (!editor) return null
    return editor.action((ctx) => {
      const { state } = ctx.get(editorViewCtx)
      const { $from } = state.selection
      let item: ProseNode | null = null
      for (let depth = $from.depth; depth > 0; depth--) {
        if ($from.node(depth).type.name === 'list_item') {
          item = $from.node(depth)
          break
        }
      }
      if (!item) return null
      let level = Infinity
      for (let i = $from.index(0) - 1; i >= 0; i--) {
        const block = state.doc.child(i)
        if (block.type.name !== 'heading') continue
        const blockLevel = Number(block.attrs.level)
        if (blockLevel >= level) continue
        if (block.textContent.trim() === '宿題') return item.firstChild?.textContent.trim() || null
        level = blockLevel
      }
      return null
    })
  }

  /**
   * ノートを AI に送り、タスクの候補を出してもらう。残っている編集を保存してから、保存した中身を送る
   */
  const suggestTasks = async (includeTranscript: boolean): Promise<AiSuggestResult> => {
    await save()
    const base = baseRef.current
    if (conflictRef.current || base === null) {
      return { status: 'error', message: '保存できていないので、送りませんでした' }
    }
    try {
      return await window.api.suggestTasksFromNote(fileName, base, { includeTranscript })
    } catch (error) {
      return {
        status: 'error',
        message: (error as Error).message.replace(
          /^Error invoking remote method '[^']+': (Error: )?/,
          ''
        )
      }
    }
  }

  /** AI に送る本文の大きさと、「文字起こし」の節があるか（送る前の確認に出す） */
  const noteBodyInfo = (): { bodyLength: number; hasTranscript: boolean } => {
    const body = bodyOf(baseRef.current ?? '')
    return { bodyLength: body.length, hasTranscript: /^#{1,6}[ \t]+文字起こし[ \t]*$/m.test(body) }
  }

  /** 本文で選んでいる文字（「＋ ここからチケット」のタイトルの初めの値に使う） */
  const selectedText = (): string => {
    const editor = editorRef.current
    if (!editor) return ''
    return editor.action((ctx) => {
      const { state } = ctx.get(editorViewCtx)
      return state.doc.textBetween(state.selection.from, state.selection.to, ' ').trim()
    })
  }

  /** フォームで項目を変えたとき */
  const changeFields = useCallback(
    (updates: FieldUpdates) => {
      const base = baseRef.current
      if (base === null) return
      if (isNote) {
        fieldsRef.current = { ...fieldsRef.current, ...updates }
        showParsed(applyFields(base, fieldsRef.current, order))
        scheduleSave()
        return
      }
      const before = parseTicket(fileName, applyFields(base, fieldsRef.current, order))
      fieldsRef.current = { ...fieldsRef.current, ...updates }
      const after = parseTicket(fileName, applyFields(base, fieldsRef.current, order))
      setTicket(after)
      if (before.status !== 'done' && after.status === 'done' && after.repeat) {
        void createNextRepeat()
      } else {
        scheduleSave()
      }
    },
    [fileName, isNote, order, showParsed, scheduleSave, createNextRepeat]
  )

  /** チェックボックスの部分をクリックしたら、完了・未完了を切り替える */
  const onEditorMouseDown = (e: React.MouseEvent<HTMLDivElement>): void => {
    const editor = editorRef.current
    const li = (e.target as HTMLElement).closest('li[data-item-type="task"]')
    if (!editor || !(li instanceof HTMLElement)) return
    const box = li.getBoundingClientRect()
    if (e.clientX - box.left > 24 || e.clientY - box.top > 24) return
    e.preventDefault()
    editor.action((ctx) => {
      const view = ctx.get(editorViewCtx)
      const pos = view.posAtDOM(li, 0)
      const $pos = view.state.doc.resolve(pos)
      for (let depth = $pos.depth; depth > 0; depth--) {
        const node = $pos.node(depth)
        if (node.type.name === 'list_item' && node.attrs.checked != null) {
          view.dispatch(
            view.state.tr.setNodeMarkup($pos.before(depth), undefined, {
              ...node.attrs,
              checked: !node.attrs.checked
            })
          )
          return
        }
      }
    })
  }

  /** ツールバーのボタンを押したとき */
  const onToolbarAction = (action: ToolbarAction): void => {
    const editor = editorRef.current
    if (!editor) return
    runToolbarAction(editor, action)
    // 文字を選ばずに太字にしたときなどは本文が変わらないので、ここでも状態を更新する
    setToolbar(getToolbarState(editor))
  }

  /** エディタに操作をして、ツールバーの状態を更新する */
  const withEditor = (run: (editor: Editor) => void): void => {
    const editor = editorRef.current
    if (!editor) return
    run(editor)
    setToolbar(getToolbarState(editor))
  }

  /** 裏方の一覧にあるこのチケット（アーカイブしているか・子孫を調べるのに使う） */
  const stored = tickets.find((t) => t.fileName === fileName) ?? null

  /** アーカイブ（tasks/archive/ に移す）。完了していて、未完了の子孫がないときだけ */
  const archive = async (): Promise<void> => {
    if (!ticket || !stored) return
    // 状態はフォームで変えたばかりかもしれないので、画面の値を使う
    const plan = archivePlan({ ...stored, status: ticket.status }, tickets)
    if (!plan.ok) {
      window.alert(plan.reason)
      return
    }
    const children = plan.tickets.length - 1
    const message = `このチケット${children > 0 ? `と子チケット ${children} 件` : ''}を tasks/archive/ に移します。よろしいですか？`
    if (!window.confirm(message)) return
    await save()
    if (conflictRef.current) return
    try {
      onMoved(await window.api.archiveTicket(fileName))
    } catch (error) {
      setNotice({
        kind: 'error',
        message: `アーカイブできませんでした：${(error as Error).message}`
      })
    }
  }

  /** アーカイブから戻す（アーカイブしている子孫も一緒に戻す） */
  const restore = async (): Promise<void> => {
    await save()
    if (conflictRef.current) return
    try {
      onMoved(await window.api.restoreTicket(fileName))
    } catch (error) {
      setNotice({ kind: 'error', message: `戻せませんでした：${(error as Error).message}` })
    }
  }

  /** 削除（子孫と一緒に OS のごみ箱に移す。ノートはそのノートだけ） */
  const remove = async (): Promise<void> => {
    let message: string
    if (isNote) {
      if (!notes.some((n) => n.fileName === fileName)) return
      message =
        'このノートをごみ箱に移します。このノートから起こしたチケットは残ります。よろしいですか？'
    } else {
      if (!stored) return
      const children = deleteTargets(stored, tickets).length - 1
      message = `このチケット${children > 0 ? `と子チケット ${children} 件` : ''}をごみ箱に移します。よろしいですか？`
    }
    if (!window.confirm(message)) return
    // 消すので、残っている編集は保存しない
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = null
    bodyRef.current = { ...bodyRef.current, edited: null }
    fieldsRef.current = {}
    try {
      await window.api.deleteTicket(fileName)
      onClose()
    } catch (error) {
      setNotice({ kind: 'error', message: `削除できませんでした：${(error as Error).message}` })
    }
  }

  const loadExternal = (): void => {
    bodyRef.current = { ...bodyRef.current, edited: null }
    fieldsRef.current = {}
    conflictRef.current = false
    setReloadKey((k) => k + 1)
  }

  const keepMine = (): void => {
    if (!window.confirm('外部の変更はすべて消えます。自分の変更で上書きしますか？')) return
    void save(true)
  }

  return (
    <section className="editor">
      <header className="editor-header">
        {onBack && (
          <button
            className="ghost back"
            onClick={onBack}
            title={`${backLabel ? `「${backLabel}」に` : ''}戻る（Alt+←）`}
          >
            ← 戻る
          </button>
        )}
        <span className="file" title={fileName}>
          {fileName}
        </span>
        <span className="save-state">{saving ? '保存中…' : ''}</span>
        {isNote ? null : stored?.archived ? (
          <button className="ghost" onClick={() => void restore()}>
            アーカイブから戻す
          </button>
        ) : (
          ticket?.status === 'done' && (
            <button className="ghost" onClick={() => void archive()}>
              アーカイブ
            </button>
          )
        )}
        <button className="ghost danger" onClick={() => void remove()} title="ごみ箱に移す">
          削除
        </button>
        <button className="ghost" onClick={() => void window.api.openExternal(fileName)}>
          外部のエディタで開く
        </button>
        <button className="ghost" onClick={onClose} title="閉じる">
          ✕
        </button>
      </header>

      {notice?.kind === 'conflict' && (
        <div className="notice warn" role="alert">
          <p>
            編集中に、このファイルが外部（AI・他のエディタ・同期など）で変更されました。どちらを残しますか？
          </p>
          <div className="actions">
            <button onClick={loadExternal}>外部の変更を読み込む（自分の変更は捨てる）</button>
            <button onClick={keepMine}>自分の変更で上書きする</button>
            <button className="ghost" onClick={() => void window.api.openExternal(fileName)}>
              外部の内容を見る
            </button>
          </div>
        </div>
      )}
      {notice?.kind === 'missing' && (
        <div className="notice warn" role="alert">
          <p>このファイルは削除されたか、名前が変わりました。</p>
          <button onClick={onClose}>閉じる</button>
        </div>
      )}
      {notice?.kind === 'error' && (
        <div className="notice error" role="alert">
          <p>保存できませんでした：{notice.message}</p>
          <button onClick={() => void save()}>もう一度保存する</button>
        </div>
      )}

      {repeatNotice && (
        <div className="notice info" role="status">
          <p>
            {repeatNotice.status === 'created'
              ? `繰り返しの次回分を作りました（${repeatNotice.due ? `期限 ${repeatNotice.due}` : `着手 ${repeatNotice.start}`}）。`
              : '繰り返しの次回分は、すでに作ってあります。'}
            <button className="link" onClick={() => onOpen(repeatNotice.fileName)}>
              次回分を開く
            </button>
          </p>
        </div>
      )}
      {wholeBodyRewrite && (
        <div className="notice info">
          <p>
            この本文には、エディタが書き方を変えてしまう記法（リンク参照定義など）があります。本文を編集すると、編集していない部分も含めて本文全体が正式な書き方で保存されます。元の書き方を残したいときは、外部のエディタで編集してください。
          </p>
        </div>
      )}
      {(ticket ?? note)?.parseError && (
        <div className="notice warn">
          <p>{(ticket ?? note)?.parseError}。項目はフォームで編集できません。</p>
        </div>
      )}
      {ticket && !isNote && (
        <PropertyForm
          disabled={!hasFrontmatter}
          ticket={ticket}
          tickets={tickets}
          notes={notes}
          today={formatDate(new Date())}
          tagColors={tagColors}
          onChange={changeFields}
          onOpen={onOpen}
        />
      )}
      {note && isNote && (
        <NoteProperties
          disabled={!hasFrontmatter}
          note={note}
          notes={notes}
          tickets={tickets}
          tagColors={tagColors}
          onChange={changeFields}
          onOpen={onOpen}
          onCreateTicket={createTicketFromNote}
          selectedText={selectedText}
          homeworkItem={homeworkItemAtCursor}
          onSuggestTasks={suggestTasks}
          noteBodyInfo={noteBodyInfo}
        />
      )}
      <EditorToolbar
        state={toolbar}
        disabled={!ticket && !note}
        onAction={onToolbarAction}
        onHeading={(level) => withEditor((editor) => setBlockLevel(editor, level))}
        onLink={(href) => withEditor((editor) => setLink(editor, href))}
      />
      <div className="body-editor" ref={rootRef} onMouseDown={onEditorMouseDown} />
      {suggest && (
        <LinkSuggestList
          items={candidates}
          active={suggestActive}
          position={suggest.position}
          onPick={pickLink}
        />
      )}
    </section>
  )
}

export default TicketEditor
