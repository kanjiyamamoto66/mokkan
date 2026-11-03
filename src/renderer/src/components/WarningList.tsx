import type { TicketWarning } from '../../../shared/ticket'

interface Props {
  warnings: TicketWarning[]
  onOpen: (fileName: string) => void
}

/** 競合コピーやIDの食い違い、親子関係の問題を知らせる。ファイルは自動で直さない */
function WarningList({ warnings, onOpen }: Props): React.JSX.Element | null {
  if (warnings.length === 0) return null

  return (
    <details className="warnings">
      <summary>⚠ 確認が必要なファイルが {warnings.length} 件あります</summary>
      <ul>
        {warnings.map((w, i) => (
          <li key={`${w.kind}-${i}`}>
            <span className="message">{w.message}</span>
            {w.fileNames.map((f) => (
              <button key={f} className="link" onClick={() => onOpen(f)}>
                {f}
              </button>
            ))}
          </li>
        ))}
      </ul>
    </details>
  )
}

export default WarningList
