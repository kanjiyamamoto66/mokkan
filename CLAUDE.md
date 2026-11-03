# CLAUDE.md

このリポジトリで作業するときに、最初に読むファイルです。応答とコメントは日本語で書いてください。

## プロジェクトの概要

標準のmdファイル群をデータベースにした、個人用のタスク管理デスクトップアプリ（名称：mokkan）です。1チケット＝1つのmdファイル（YAMLのfrontmatter＋本文）で、人・AI・アプリが同じファイルを直接読み書きします。

- 仕様の全体は `docs/spec.md` にあります。設計判断の根拠もそこに書いてあるので、迷ったら先に読んでください。
- `templates/RULES.md`・`templates/TEMPLATE.md`・`templates/NOTE_TEMPLATE.md` は、データ側（`tasks/` フォルダ）に置くファイルの原本です。`templates/AI_GUIDE.md` は、`tasks/` に `CLAUDE.md` と `AGENTS.md` の2つの名前で置く、AI向けの案内の原本です。

## 進め方

要望や不具合は GitHub の Issue にし、決めることがあるものは Issue のコメントで方針を決めてから実装します。次の候補は仕様書の「今後の候補」にあります。

## 必ず守ること

このアプリの価値は「どのツールで開いても壊れない標準md」にあります。次のルールは、コードを書くときに常に守ってください。

1. **編集していない部分は1文字も変えない**：開いて保存しただけで差分を出さない。frontmatterは変わった行だけを書き換え、本文は実際に編集されたときだけ書き出す。
2. **frontmatterをWYSIWYGエディタに渡さない**：ファイルを開いたらfrontmatterと本文を分け、本文だけをMilkdownに渡す。
3. **書き出しの書き方を固定する**：Milkdown（remark-stringify）の出力を `templates/RULES.md` の「正式な書き方」に合わせる。変換を往復させるテスト（読み込み→書き出し→元と一致）を必ず用意する。
4. **標準md以外の記法を出力しない**：`[[リンク]]`、コールアウト、`==ハイライト==` などの独自記法はアプリから一切出さない。
5. **ファイルだけがデータ**：アプリ独自のDBやキャッシュを正として扱わない。キャッシュを持つ場合も、ファイルからいつでも作り直せるようにする。
6. **ファイル名の扱い**：ファイル名は `ID.md` か `ID_任意の文字.md`。アプリは先頭のIDだけを読む。自動で名前を変えるのは、起動時に `tickets/`・`notes/` の ID だけのファイル（作成者が自分か空のもの）に見出しを付けるときだけ（`renameUntitledFiles`）で、それ以外は変えない。新規作成は、同名ファイルがないときだけ作る方法（排他的な作成）で書き込む。
7. **外部の変更に追従する**：AIや他のエディタ、同期サービスによる変更を監視して反映する。編集中に外から変わった場合は、上書きせずにユーザーに選ばせる。
8. **同期フォルダ前提の安全策**：md以外のファイルや隠しファイルは無視する。同じ `id` を持つファイルが複数ある、またはファイル名とfrontmatterのIDが食い違う場合は、競合として警告する。

## コードの置き場所

ファイルに触るのは裏方（`src/main`）だけです。画面に依存しない処理は `src/shared` に置き、Node 上でテストします。

| 場所 | 内容 |
| --- | --- |
| `src/shared/ticket.ts` | チケットの読み取り・ID・テンプレートの埋め込み・絞り込みと並べ替え・警告 |
| `src/shared/frontmatter.ts` | frontmatter の書き換え。変えた項目の行だけを書き換える（`setFields`） |
| `src/shared/body.ts` | 本文の保存。編集していないブロックを元のテキストに戻す（`mergeBody`、`canPreserveBlocks`） |
| `src/shared/schedule.ts` | カレンダーの予定と、ガントの行（親子の木・まとめ棒の期間・はみ出しの警告・祖先を薄く・タグごと）の計算 |
| `src/shared/note.ts` | ノート（`notes/`）の読み取り・一覧の並び順・ノートから起こしたチケット・「宿題」への書き戻し（`attachHomework`・`appendHomework`）と項目の読み取り（`parseHomeworkItem`） |
| `src/shared/archive.ts` | アーカイブ（`archive/` に移す）・戻す・削除の対象（子孫を含む）を決める |
| `src/shared/tagColor.ts` | タグの色（`tasks/TAGS.md` の読み取りと、変えたタグの行だけの書き換え・名前から決める色相） |
| `src/shared/repeat.ts` | 繰り返し（`repeat`）の書式の読み取り、次回の日付の計算、次回分のチケットの中身の組み立て |
| `src/shared/search.ts` | 全文検索の当たりの判定（語の分け方・文字起こしを除く・当たった箇所の文）。ファイルを読むのは `TaskStore.search`（探すたびに読む） |
| `src/shared/links.ts` | 他のチケット・ノートへの md のリンク（相対パス・リンク先の ID）と、リンクの候補の絞り込み・探すための文字の揃え方（`normalizeForSearch`） |
| `src/shared/api.ts` | 裏方と画面の間の IPC の型とチャンネル名 |
| `src/main/taskStore.ts` | `tasks/` の読み込み・監視（`tickets/`・`archive/`・`notes/`・`TAGS.md`）・作成（チケット・ノート・ノートから起こすチケット）・保存・空チケットの削除・繰り返しの次回分の作成・アーカイブ・ごみ箱への削除・ルールのファイル（`RULE_FILES`）の確認と更新・タグの色の書き込み（`setTagColor`）・全文検索（`search`）・起動時の見出しの付け足し（`renameUntitledFiles`） |
| `src/main/ipc.ts` | IPC の入力の確かめ（`requireString`・`requireStringArray`・`normalizeTitle`・`normalizeTag`・`requireHue`・`normalizeFromNoteOptions`）、ハンドラー、設定への案内の判定（`decideOnboarding`・`onboardingHandlers`）、外部のブラウザで開いてよい URL か（http/https だけ）。electron に依存しないので Node 上でテストできる |
| `src/main/aiTasks.ts` | ノートを AI（パソコンの Claude Code、`claude -p`）に送ってタスクの候補を出してもらう。送る文の組み立て・答えの読み取り・`claude` の呼び出し（文は標準入力で渡し、道具は使わせない）。electron に依存しないので Node 上でテストできる |
| `src/main/settings.ts` | `tasks/` の場所や一覧の並び順・自分の名前・最後に案内を済ませた版（`lastVersion`）などの個人設定（userData に保存。開発中は `%APPDATA%\mokkan-dev`） |
| `src/main/index.ts` | ウィンドウと IPC の登録。画面は sandbox で動かし、ページの移動（`will-navigate`。今のページの読み込み直しは通す）と権限の要求（カメラ・通知など）は断る |
| `src/preload/index.ts` | 画面に渡す API（`window.api`） |
| `src/renderer/src/App.tsx` | 画面の全体（表示の切り替え・選択中のチケットと「← 戻る」の履歴・新規作成・並び順と自分の名前の読み込み・アーカイブで移したときの切り替え・検索の結果から開く・設定への案内と名前の付け足しの案内の帯） |
| `src/renderer/src/components/` | 一覧・絞り込み・警告・編集画面・プロパティフォーム・カレンダー・ガント・凡例（`Legend`）・タグと担当者の入力（`TagInput`）・タグの色の選択（`TagColorPicker`）・繰り返しの指定（`RepeatInput`）・本文のツールバー（`EditorToolbar`）・`[[` の候補（`LinkSuggestList`）・検索欄（`SearchBox`）・設定とルールのファイル（`SettingsDialog`）・まとめてアーカイブ（`ArchiveDialog`）・ノートの一覧（`NoteList`）・ノートのプロパティと「＋ ここからチケット」（`NoteProperties`）・AI でタスクを起こす窓（`AiTasksDialog`）。編集画面（`TicketEditor`）はチケットとノートの両方を開く |
| `src/renderer/src/tagStyle.ts` | タグの色を画面に付ける（色相を `--tag-h` で渡す）・タグの色を保存する |
| `src/renderer/src/editor/markdown.ts` | Milkdown の組み立てと書き出し設定（`STRINGIFY_OPTIONS`）。往復テストは同じ場所の `markdown.test.ts`（jsdom） |
| `src/renderer/src/editor/idLinks.ts` | 本文の中の ID と、他のチケット・ノートへの md のリンク（リンク先の ID で探す）に印とタイトルを付け、Ctrl+クリックで開く ProseMirror のプラグイン（画面の飾りだけで、本文は変えない）。テストは `idLinks.test.ts`（jsdom） |
| `src/renderer/src/editor/linkSuggest.ts` | 本文で `[[`（`「「`）と打つとリンクの候補を出し、選ぶと `[タイトル](相対パス)` を入れる ProseMirror のプラグイン。候補の絞り込みと相対パスは `src/shared/links.ts`。テストは `linkSuggest.test.ts`（jsdom） |
| `src/renderer/src/editor/tableCursor.ts` | 本文の表で、カーソルのあるセルと行・列に印を付ける ProseMirror のプラグイン（画面の飾りだけ）。テストは `tableCursor.test.ts`（jsdom） |
| `src/renderer/src/editor/findText.ts` | 検索の結果から開いたときに、本文で当たった箇所を選んで見えるところまで動かす。テストは `findText.test.ts`（jsdom） |
| `src/renderer/src/editor/toolbar.ts` | 本文エディタのツールバーの操作（見出し・太字・斜体・取り消し線・コード・リスト・チェックボックス・字下げ・引用・コードブロック・区切り線・リンク・表の挿入と行・列の追加と削除・元に戻す／やり直す）。テストは `toolbar.test.ts`（jsdom） |
| `tests/` | テンプレートの文字コード・改行のテストと、往復テスト用のサンプル（`tests/fixtures/canonical.md`） |
| `scripts/make-sandbox.mjs` | 動作確認用のサンプルデータを作る（`npm run sandbox`） |
| `scripts/make-icons.mjs` | アイコンの原本 `build/icon.svg` から ico・png を作る（`npm run icons`） |
| `electron-builder.yml` | インストーラーの設定（下の「インストーラーとリリース」を参照） |

## 実装の注意

### 本文の保存（`mergeBody`）

- Milkdown は本文全体を書き出し直す。設定（`STRINGIFY_OPTIONS`）で正式な書き方に揃えても、`[` → `\[`、裸のURL → `<URL>`、表の区切り行、行末2スペースの改行などは変わってしまう。
- そこで `mergeBody` が、書き出し結果を一番外側のブロック（段落・見出し・リスト・表など）に分け、編集していないブロックは元のファイルのテキストに戻す。その場で書き換えたブロックの前後の空行も元のまま残す。
- 限界：書き換えはブロック単位。リストの1項目を変えると、そのリスト全体が正式な書き方で書き出される。
- 表は、`markdown.ts` の `remarkCanonicalTable` が remark-gfm の書き出しを差し替えて、列の幅を揃えない形（区切り行は `| --- |`）で書き出す。処理は `mdast-util-gfm-table`（remark-gfm の依存。devDependencies に明記）を使う。
- 表のセルの中の `\|`（エスケープした縦棒。コードの中も）は、列の区切りにならず、表を編集しても `\|` のまま書き出される（`markdown.test.ts` に往復テストあり）。テストで md を JS の文字列に書くときは `String.raw` を使う（`'\|'` は `|` になり、列の区切りに見えてしまう）。
- 例外：元の本文と読み込み直後の書き出し結果で、ブロックの数か中身（書式を除いた文字）が食い違うと、ブロックの対応が取れない（リンク参照定義 `[a]: URL` はエディタが展開して消す、など）。このときは編集すると本文全体を書き出し直す。編集画面は開いたときに案内を出す。

### 保存と競合

- 編集画面は、入力が止まってから（600ms）保存する。裏方の `saveTicket` は、ファイルの今の中身が「最後に読んだ内容」と同じときだけ書き込む。違えば上書きせず、画面でユーザーに選ばせる。
- 一時ファイル＋rename では書き込まない（同期サービスで版の履歴が切れる、Windows で開かれているファイルの置き換えに失敗する）。理由は `saveTicket` のコメントを参照。
- 空のまま閉じた新規チケットは、このアプリがそのセッションで作り、項目も変えていないものだけを削除する。React の StrictMode は開発中に画面部品を作り直すので、削除は画面部品の片付けではなく `editor/closing.ts` の `afterClose` で行う。

### アーカイブと削除

- `archive/` のチケットは、`Ticket.fileName` を `archive/ファイル名` にして区別する（画面と裏方の間のキー）。ファイル名から読む ID（`fileId`）はファイル名だけから読む。
- 監視は `tasks/` から1段下まで（`tickets/`・`archive/`・`notes/` の直下の md と、`tasks/` 直下の `TAGS.md` とその競合コピーだけ）。`archive/` は最初のアーカイブで、`notes/` は最初のノートで作られる。

### ノート

- ノートは `Ticket` とは別の型（`Note`）で、`AppState.notes` に入る。キーは `notes/ファイル名`。読み書き・保存・競合・ごみ箱への削除は、チケットと同じ IPC（`readTicket`・`saveTicket` など）にこのキーを渡して行う。
- ID はチケットとノートをまたいで重ならないようにする（`writeNewFile` で確かめ、`findWarnings(tickets, notes)` で警告する）。`findWarnings` にノートを渡さないと、`source` のあるチケットがすべて「元のノートが見つからない」になる。
- ノートの frontmatter は `NOTE_FIELD_ORDER` の並び順で書き換える（`setFields` の第3引数）。
- 「＋ここからチケット」（`createTicketFromNote`）は、画面が最後に読んだノートの中身を受け取り、ファイルがそれと同じときだけチケットを作って「宿題」に書き戻す。書き戻しは、選んだ「宿題」の項目の行末に付ける `attachHomework`（項目の文で探す）か、見つからなければ最後に行を足す `appendHomework` で、付けたもののほかは変えない。書き戻すのは `→ [ID](../tickets/ファイル名)` の md のリンクで、チケットのファイル名は初めから `ID_タイトル.md` にする（起動時の名前の付け足しでリンクが切れないように）。
- 移すときは rename だけ。移す先に同じ名前のファイルがあれば、どれも移さない。削除は `shell.trashItem` でごみ箱に移し、完全には消さない（TaskStore には `trash` として渡す。テストでは偽物を渡す）。

### カレンダーとガント

- FullCalendar は 7 系を使う。daygrid やテーマは `@fullcalendar/react` の中にある（`@fullcalendar/react/daygrid` など）。6 系の別パッケージ（`@fullcalendar/daygrid` など）は入れない。`temporal-polyfill` は peer 依存なので、コードから使っていなくても消さない。
- SVAR React Gantt は MIT 版だけを使う。PRO 版の機能（日付のないタスク・グループ化・まとめタスクの期間の自動計算など）は使わず、アプリ側で補う。
- SVAR の名前の列は自前で描く。列の id を `text` にすると、SVAR が木の列として独自の字下げと開閉ボタンを付ける。
- SVAR は文字列の id の前に `:` を付けて `data-id` に入れる。日付のない行の棒は、これを使って CSS で隠している。
- SVAR は幅が650px以下だと、グリッドか棒の一方だけを表示する。狭いときは棒（日程）を出す。
- SVAR のテーマの div（`Willow` / `WillowDark`）は高さを持たないので、CSS で `height: 100%` を渡している。渡さないとガントが中身の高さまで伸び、最後の行が横スクロールバーに隠れ、縦にスクロールできなくなる。
- SVAR の棒には class を付けられないので、`GanttView` が行ごとの CSS（`data-id` で選ぶ）で `--bar-bg` などの変数を入れ、塗り方は `main.css` で決める。SVAR の `.wx-task:not(.wx-split).wx-xxx` より強くするため、`main.css` では `.wx-bar.wx-bar` と重ねている。
- FullCalendar の予定には style を渡せないので、タグの色は色相ごとの class（`mk-hue-210` など）を `<style>` で作って付ける。予定の塗り方は FullCalendar のクラシックのテーマより強い `.calendar .mk-event.mk-doing` などで上書きする。
- カレンダーの並び順は、`calendarItems` が1つの数（`order`）にして `eventOrder="mkOrder"` で渡す。比べる関数にすると、親子のまとまりと既定の順を混ぜたときに順が矛盾する。FullCalendar は 0 を「値なし」と同じに扱うことがあるので、1から数える。

### 色とタグの色

- 色の意味の決まりは仕様書の「色の意味」。色は `main.css` の変数（状態＝`--status-*`、優先度＝`--priority-*`、注意＝`--danger`、選択中＝`--selected-ring`）を使い、画面の部品に色を直接書かない。ダークモードの値も変数で切り替える。
- タグの色は色相だけを `tasks/TAGS.md` に保存し、画面では `--tag-h` を渡して `.tag-colored` が淡い色を作る（`tagStyle`）。選んでいないタグは名前から色相を決める（`autoHue`）。
- `TAGS.md` の書き換え（`setTagColor`）は、選んだその場で読んで変えたタグの行だけを書き換え、待ち行列で1件ずつ行う。`TAGS.md` はルールのファイル（`RULE_FILES`）に入れない。

### 本文のリンク

- 他のチケット・ノートへは標準の md のリンク（`[タイトル](../notes/ID_….md)`）で書き、アプリはリンク先のファイル名の先頭の ID だけで探す（`idFromHref`）。名前が変わっても、archive/ に移っても開ける。
- `[[` は入力のきっかけにすぎず、ファイルには残さない。日本語入力の変換中のキーは扱わない（`view.composing`）。
- エディタを通さずに書くリンク（「宿題」への書き戻し）は、空白や括弧のあるリンク先を `<…>` で囲む（`markdownLinkDestination`）。

### 起動時の見出しの付け足し

- `index.ts` の `restartStore` で、`start` の後に `renameUntitledFiles` を呼ぶ（起動時と、フォルダを開き直したとき）。対象の条件は仕様書の「ファイル名」の節。
- rename は Windows で同じ名前のファイルを上書きするので、直前に `existsSync` で確かめてから変える（コピーして消す方法は同期サービスの版の履歴が切れるので使わない。`moveTickets` と同じ）。

### 検索と AI

- 全文検索は、探すたびに裏方がファイルを読む（`TaskStore.search`）。本文を持ち続けない。
- AI でタスクを起こすときは、パソコンの Claude Code を `claude -p --tools "" --no-session-persistence --json-schema …` で呼ぶ（`aiTasks.ts`）。文は標準入力で渡し、シェルは通さない。作業フォルダは、呼ぶたびに `%TEMP%` の下に作る空のフォルダにする（Windows はコマンドを作業フォルダから先に探すので、`%TEMP%` そのものにしない）。チケットは作らせず、人が選んだものを `createTicketFromNote` で作る。

## コマンド

| コマンド | 内容 |
| --- | --- |
| `npm run dev` | 開発モードで起動（画面の変更はすぐ反映、裏方を変えたら自動で再起動） |
| `npm run sandbox` | `sandbox/tasks` にサンプルデータを作る。開発モードは既定でここを読む |
| `npm test` | Vitest（テストは `src/**/*.test.ts` か `tests/**/*.test.ts`） |
| `npm run typecheck` / `npm run lint` | 変更したら両方通す |
| `npm run format` | Prettier。mdは「編集していない部分は変えない」ため `.prettierignore` で対象外にしている |
| `npm run build:win` | Windows 用のインストーラー（NSIS のワンクリック形式、ユーザーごとに入れる）を `dist/` に作る |
| `npm run icons` | `build/icon.svg` から `build/icon.ico`・`build/icon.png`・`resources/icon.png` を作る（Electron で描く。追加のパッケージなし） |

- 別のデータフォルダを使うときは、環境変数 `MOKKAN_TASKS_DIR` で指定するか、画面の「フォルダを変える」で選ぶ（環境変数が最優先）。

## インストーラーとリリース

- 設定は `electron-builder.yml`。同梱するのは `out/`・`resources/`・`package.json` と、`dependencies` のパッケージだけ。
- ビルドは、出力にまとめたパッケージのライセンスの一覧を `out/*/THIRD_PARTY_LICENSES.md` に作る（`electron.vite.config.ts` の `license`）。インストーラーは、それと mokkan の `LICENSE` をインストール先の `licenses/` に置く（`extraFiles`）。
- **`dependencies` には、裏方（`src/main`）が実行時に require するものだけを置く**（今は `@electron-toolkit/utils`・`chokidar`・`yaml`）。画面や preload で使うパッケージは Vite が出力にまとめるので `devDependencies` に入れる。`dependencies` に入れると、インストーラーに `node_modules` として二重に入る。
- 起動は1つだけ（`requestSingleInstanceLock`）。2つ目は、開いているウィンドウを前に出して終わる。ロックは userData ごとなので、開発版とインストール版は同時に動かせる。
- リリース：`package.json` の `version` を上げて main にマージし、`v<version>` のタグを main のコミットに付けて push すると、`.github/workflows/release.yml` がインストーラーを GitHub Release に置く（main 以外のコミットや、version と違うタグでは止まる）。自動更新（electron-updater）とコード署名はまだ使っていない。
- `release.yml` はジョブを2つに分けている。`build`（Windows）は読み取りの権限だけで、依存パッケージを入れてテストとビルドをし、インストーラーを成果物として渡す。`release`（Ubuntu）だけが書き込みの権限を持ち、依存パッケージを入れずに、ハッシュ値（`SHA256SUMS.txt`）を作って Release を作る。依存パッケージに悪いコードが入っても、Release を書き換えるトークンに届かないようにするため。
- `electron-builder.yml` の `electronFuses` で、配布するアプリで使わない機能を切っている（`ELECTRON_RUN_AS_NODE`・`NODE_OPTIONS`・`--inspect` を無効にし、コードは app.asar からだけ読んで改ざんを確かめる）。子プロセスに `process.fork` は使えないので、Node のプロセスが要るときは `utilityProcess` を使う。`grantFileProtocolExtraPrivileges` は、画面を `file://` から ES モジュールで読んでいるので切らない。
- インストール版の動作確認は、`dist/win-unpacked/mokkan.exe --remote-debugging-port=<空いているポート> --user-data-dir=<別のフォルダ>` で起動すれば、Chrome DevTools Protocol（CDP）で画面を操作して確かめられる。`--user-data-dir` を付けないと、インストールした mokkan と同じ設定フォルダを使い、それが動いていれば「起動は1つだけ」の仕組みで終わってしまう（環境変数の `APPDATA` では設定フォルダは変わらない）。

## PRとCI

- 変更はブランチを切って PR にする。main に直接 push しない。
- CI：PRとmainへのpushで、GitHub Actions（`.github/workflows/ci.yml`、windows-latest）が `npm ci` → typecheck → lint → test → `electron-vite build` を実行する。フォークからの PR でも動くよう、権限は読み取りだけで、Secret は使わない。
- ワークフローのアクションはコミットの SHA で固定する（横にバージョンをコメントで書く）。更新は Dependabot（`.github/dependabot.yml`）が週に1回 PR にする。
- PR を積み重ねる（前の PR のブランチを向き先にする）ときは注意する。GitHub が向き先を main に変えるのは、向き先のブランチが消されたときだけなので、続けてマージすると後ろの PR は feature のブランチに入り、main には入らない。1つマージしたらそのブランチを消してから次をマージするか、最後に main 向きの PR を1つ出す。

## 技術構成

| 役割 | 採用 |
| --- | --- |
| デスクトップアプリ | Electron 45（TypeScript）。雛形とビルドは electron-vite 6 |
| 画面 | React 19 |
| 本文エディタ | Milkdown 7（`@milkdown/kit`。`@milkdown/react` は使わない） |
| frontmatter | yaml（書式を保ったまま書き換える） |
| 本文のブロック分け | unified / remark-parse / remark-gfm（Milkdown と同じバージョン） |
| カレンダー | FullCalendar 7（MITの標準機能のみ） |
| ガントチャート | SVAR React Gantt（MIT版。有料のPRO機能は使わない） |
| ファイル監視 | chokidar 6（Node 22.22 以上が必要） |
| AI でタスクを起こす | Claude Code（`claude -p`。パソコンに入っているものを呼ぶ。同梱しない） |
| Node.js | 24 LTS（`.node-version` に記載）。Electron が同梱する Node のメジャー版に合わせる（`@types/node` も同じ） |
| パッケージマネージャー | npm |
| テストランナー | Vitest（画面側の往復テストは jsdom） |

上の表にない部品を足すときは、採用する前に最新の状況を確認してから提案してください。

## データの置き場所について

- タスクのデータ（`tasks/`）は、クラウドの同期フォルダ（Google Drive・OneDrive・Dropbox など。ファイルを PC にも置く設定）に置いても使えるようにしています。
- **このリポジトリは同期フォルダの外に置いてください。** 同期フォルダの中に `.git` を置くと壊れることがあります。
- 開発中の動作確認には、リポジトリ内の `.gitignore` 済みの `sandbox/` か、リポジトリ外の適当なフォルダを使ってください。

## 作業環境

- アプリは Windows 専用です。パスの区切りや改行コード（ファイルはLFで保存）に注意してください。
- Node.js は `.node-version` の版を使います（fnm などで切り替える）。
- 日本語入力（IME）の動作は自動テストでは確かめられないので、エディタ周りを変えたら実際に入力して確かめてください。
- `npm run dev` で、使う側と import を別々の編集で続けて足すと、Vite が古い変換を返して「X is not defined」で画面が真っ白（真っ黒）になることがある。ファイルを保存し直してから再読み込みすると直る。
