import type { AppState } from '../../../shared/api'

interface Props {
  state: AppState
  onChoose: () => void
  onInit: () => void
}

/** tasks フォルダがまだ使えないときの案内 */
function FolderSetup({ state, onChoose, onInit }: Props): React.JSX.Element {
  return (
    <div className="setup">
      {state.folderStatus === 'unset' && (
        <>
          <h2>tasks フォルダを選んでください</h2>
          <p>
            チケットのmdファイルを置くフォルダです。Google Drive・OneDrive・Dropbox
            などの同期フォルダの中も選べます（ファイルを PC にも置く設定にしてください）。
          </p>
          <button className="primary" onClick={onChoose}>
            フォルダを選ぶ
          </button>
        </>
      )}
      {state.folderStatus === 'missing' && (
        <>
          <h2>フォルダが見つかりません</h2>
          <p>
            <code>{state.tasksDir}</code>{' '}
            {
              'がありません。同期フォルダなら同期を終えているか確かめるか、別のフォルダを選んでください。'
            }
          </p>
          <button className="primary" onClick={onChoose}>
            フォルダを選び直す
          </button>
        </>
      )}
      {state.folderStatus === 'not-initialized' && (
        <>
          <h2>このフォルダを mokkan 用に準備しますか？</h2>
          <p>
            <code>{state.tasksDir}</code> に <code>tickets/</code> フォルダを作ります。
            <code>RULES.md</code> と <code>TEMPLATE.md</code>{' '}
            がなければ原本を置きます（あるファイルは変えません）。
          </p>
          <div className="actions">
            <button className="primary" onClick={onInit}>
              準備する
            </button>
            <button className="ghost" onClick={onChoose}>
              別のフォルダを選ぶ
            </button>
          </div>
        </>
      )}
    </div>
  )
}

export default FolderSetup
