// アーカイブ（tasks/archive/ に移す）と削除の対象を決める処理。ファイルや画面に依存しない
// 親子は ID でつながるので、移しても切れない。親を移すときは子孫も一緒に移す

import type { Ticket } from './ticket'

/** アーカイブに置くフォルダの名前（tasks/ の中） */
export const ARCHIVE_DIR = 'archive'
/** アーカイブしたチケットのキー（Ticket.fileName）の頭 */
export const ARCHIVE_PREFIX = `${ARCHIVE_DIR}/`
/** まとめてアーカイブするときの「完了から何日たったものか」の既定値 */
export const DEFAULT_ARCHIVE_DAYS = 30

/** 子孫を返す（親子が循環していても止まる） */
export function descendantsOf(ticket: Ticket, tickets: Ticket[]): Ticket[] {
  const result: Ticket[] = []
  const seen = new Set<string>([ticket.fileName])
  const queue = [ticket]
  while (queue.length > 0) {
    const current = queue.shift()!
    if (!current.id) continue
    for (const t of tickets) {
      if (t.parent === current.id && !seen.has(t.fileName)) {
        seen.add(t.fileName)
        result.push(t)
        queue.push(t)
      }
    }
  }
  return result
}

export type ArchivePlan = { ok: true; tickets: Ticket[] } | { ok: false; reason: string }

/**
 * 1件をアーカイブするときに移すチケット（本人と、アーカイブしていない子孫）
 * 完了していない、または未完了の子孫があるときは移さない
 */
export function archivePlan(ticket: Ticket, tickets: Ticket[]): ArchivePlan {
  if (ticket.archived) return { ok: false, reason: 'すでにアーカイブしています' }
  if (ticket.status !== 'done')
    return { ok: false, reason: '完了したチケットだけをアーカイブできます' }
  const family = descendantsOf(ticket, tickets).filter((t) => !t.archived)
  const open = family.filter((t) => t.status !== 'done')
  if (open.length > 0) {
    return {
      ok: false,
      reason: `未完了の子チケットが ${open.length} 件あるので、アーカイブできません`
    }
  }
  return { ok: true, tickets: [ticket, ...family] }
}

/**
 * まとめてアーカイブするチケット：完了日が cutoff 以前で、子孫もすべて完了しているもの（と、その子孫）
 * @param cutoff この日以前に完了したものを対象にする（`YYYY-MM-DD`）
 */
export function bulkArchiveTargets(tickets: Ticket[], cutoff: string): Ticket[] {
  const targets = new Map<string, Ticket>()
  for (const t of tickets) {
    if (t.archived || t.status !== 'done' || !t.done || t.done > cutoff) continue
    const plan = archivePlan(t, tickets)
    if (plan.ok) for (const p of plan.tickets) targets.set(p.fileName, p)
  }
  return [...targets.values()]
}

/** アーカイブから戻すチケット（本人と、アーカイブしている子孫） */
export function restoreTargets(ticket: Ticket, tickets: Ticket[]): Ticket[] {
  if (!ticket.archived) return []
  return [ticket, ...descendantsOf(ticket, tickets).filter((t) => t.archived)]
}

/** 削除するチケット（本人と、すべての子孫） */
export function deleteTargets(ticket: Ticket, tickets: Ticket[]): Ticket[] {
  return [ticket, ...descendantsOf(ticket, tickets)]
}
