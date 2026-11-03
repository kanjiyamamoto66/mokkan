import { describe, expect, it } from 'vitest'
import {
  archivePlan,
  bulkArchiveTargets,
  deleteTargets,
  descendantsOf,
  restoreTargets
} from './archive'
import { DEFAULT_FILTER, listTickets, type Ticket } from './ticket'

function ticket(partial: Partial<Ticket> & { id: string }): Ticket {
  return {
    fileName: `${partial.archived ? 'archive/' : ''}${partial.id}.md`,
    archived: false,
    fileId: partial.id,
    title: partial.id,
    status: 'done',
    priority: null,
    start: null,
    due: null,
    repeat: null,
    tags: [],
    parent: null,
    source: null,
    assignee: [],
    author: null,
    created: null,
    done: '2026-09-01',
    modified: null,
    parseError: null,
    ...partial
  }
}

const names = (tickets: Ticket[]): string[] => tickets.map((t) => t.id ?? '').sort()

describe('descendantsOf', () => {
  it('子・孫をたどる。循環していても止まる', () => {
    const tickets = [
      ticket({ id: 'p' }),
      ticket({ id: 'c', parent: 'p' }),
      ticket({ id: 'g', parent: 'c' }),
      ticket({ id: 'x', parent: 'y' }),
      ticket({ id: 'y', parent: 'x' })
    ]
    expect(names(descendantsOf(tickets[0], tickets))).toEqual(['c', 'g'])
    expect(names(descendantsOf(tickets[3], tickets))).toEqual(['y'])
  })
})

describe('archivePlan', () => {
  it('完了したチケットを、子孫と一緒に移す', () => {
    const tickets = [ticket({ id: 'p' }), ticket({ id: 'c', parent: 'p' })]
    const plan = archivePlan(tickets[0], tickets)
    expect(plan.ok && names(plan.tickets)).toEqual(['c', 'p'])
  })

  it('完了していない・未完了の子孫がある・アーカイブ済みなら移さない', () => {
    const open = ticket({ id: 'o', status: 'doing' })
    expect(archivePlan(open, [open])).toMatchObject({ ok: false })

    const tickets = [ticket({ id: 'p' }), ticket({ id: 'c', parent: 'p', status: 'todo' })]
    expect(archivePlan(tickets[0], tickets)).toEqual({
      ok: false,
      reason: '未完了の子チケットが 1 件あるので、アーカイブできません'
    })

    const archived = ticket({ id: 'a', archived: true })
    expect(archivePlan(archived, [archived])).toMatchObject({ ok: false })
  })
})

describe('bulkArchiveTargets', () => {
  it('完了日が基準の日以前で、子孫もすべて完了しているものを集める', () => {
    const tickets = [
      ticket({ id: 'old', done: '2026-09-01' }),
      ticket({ id: 'oldChild', parent: 'old', done: '2026-10-15' }),
      ticket({ id: 'new', done: '2026-10-15' }),
      ticket({ id: 'blocked', done: '2026-09-01' }),
      ticket({ id: 'openChild', parent: 'blocked', status: 'todo', done: null }),
      ticket({ id: 'noDate', done: null }),
      ticket({ id: 'archived', archived: true })
    ]
    expect(names(bulkArchiveTargets(tickets, '2026-09-18'))).toEqual(['old', 'oldChild'])
  })
})

describe('restoreTargets / deleteTargets', () => {
  it('戻すのは本人とアーカイブ済みの子孫、削除は本人とすべての子孫', () => {
    const tickets = [
      ticket({ id: 'p', archived: true }),
      ticket({ id: 'c', parent: 'p', archived: true }),
      ticket({ id: 'd', parent: 'p' })
    ]
    expect(names(restoreTargets(tickets[0], tickets))).toEqual(['c', 'p'])
    expect(names(deleteTargets(tickets[0], tickets))).toEqual(['c', 'd', 'p'])
    expect(restoreTargets(tickets[2], tickets)).toEqual([])
  })
})

describe('一覧での表示', () => {
  it('アーカイブしたものは既定で隠し、「アーカイブも表示」で出す', () => {
    const tickets = [
      ticket({ id: 'a', archived: true }),
      ticket({ id: 'b', status: 'todo', done: null })
    ]
    const ids = (showArchived: boolean): (string | null)[] =>
      listTickets(tickets, { ...DEFAULT_FILTER, showArchived }, '2026-10-19').map((t) => t.id)
    expect(ids(false)).toEqual(['b'])
    expect(ids(true)).toEqual(['a', 'b'])
  })
})
