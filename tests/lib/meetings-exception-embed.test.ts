import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('@/lib/supabase/server', () => ({ createServerClient: vi.fn() }))

import { createServerClient } from '@/lib/supabase/server'
import { getProjectMeetingData, getMyMeetings } from '@/lib/data/meetings'

type Reply = { data: unknown[] | null; error: { message: string } | null }
const OK = (rows: unknown[]): Reply => ({ data: rows, error: null })
const ERR = (message: string): Reply => ({ data: null, error: { message } })

const EMBED_ERR = ERR("Could not find a relationship between 'meetings' and 'meeting_exceptions'")

/**
 * 최소 supabase 스텁. meetings 는 select 문자열을 그대로 넘겨받아(임베드 포함 여부로 분기)
 * 응답을 정한다 — selectMeetings 의 "임베드 → 실패 시 임베드 없이 재시도" 경로를 실제로 태운다.
 */
function makeSb(opts: {
  user?: { id: string; email?: string | null } | null
  meetings: (select: string) => Reply | Promise<Reply>
  exceptions?: Reply
  members?: Reply | Promise<Reply>
}) {
  const selects: string[] = []
  const tables: string[] = []
  const chain = (resolve: () => Reply | Promise<Reply>) => {
    const o: Record<string, unknown> = {}
    for (const k of ['eq', 'or', 'order', 'in', 'limit', 'maybeSingle']) o[k] = () => o
    o.then = (res: unknown, rej: unknown) =>
      Promise.resolve(resolve()).then(res as never, rej as never)
    return o
  }
  const sb = {
    auth: { getUser: async () => ({ data: { user: opts.user ?? null } }) },
    from: (table: string) => {
      tables.push(table)
      return {
        select: (sel: string) => {
          if (table === 'meetings') { selects.push(sel); return chain(() => opts.meetings(sel)) }
          if (table === 'meeting_exceptions') return chain(() => opts.exceptions ?? OK([]))
          if (table === 'project_members') return chain(() => opts.members ?? OK([]))
          return chain(() => OK([]))
        },
      }
    },
  }
  ;(createServerClient as unknown as { mockResolvedValue: (v: unknown) => void })
    .mockResolvedValue(sb)
  return { selects, tables }
}

const meetingRow = (id: string, extra: Record<string, unknown> = {}) => ({
  id, project_id: 'p1', title: `회의 ${id}`, meeting_date: '2026-07-20',
  start_time: null, end_time: null, location: null, category: 'weekly',
  recurrence: 'none', recurrence_until: null, created_by: null, created_by_name: null,
  created_at: '2026-07-20T00:00:00Z', updated_at: '2026-07-20T00:00:00Z',
  meeting_attendees: [], ...extra,
})
const exRow = (meetingId: string, date: string) =>
  ({ meeting_id: meetingId, occurrence_date: date, kind: 'cancelled' })

beforeEach(() => { vi.spyOn(console, 'error').mockImplementation(() => {}) })
afterEach(() => { vi.restoreAllMocks() })

describe('getProjectMeetingData — 예외 FK 임베드', () => {
  it('임베드가 성공하면 별도 meeting_exceptions 왕복 없이 예외를 평탄화한다', async () => {
    const { tables } = makeSb({
      meetings: () => OK([
        meetingRow('m1', { meeting_exceptions: [exRow('m1', '2026-07-27')] }),
        meetingRow('m2', { meeting_exceptions: [] }),
      ]),
    })
    const res = await getProjectMeetingData('embed-ok')
    expect(res.meetings.map(m => m.id)).toEqual(['m1', 'm2'])
    expect(res.exceptions).toEqual([
      { meetingId: 'm1', occurrenceDate: '2026-07-27', kind: 'cancelled' },
    ])
    // 왕복 절감이 이 수정의 목적 — 예외 테이블을 따로 치면 안 된다.
    expect(tables).not.toContain('meeting_exceptions')
  })

  it('임베드 실패 시 임베드 없이 재시도하고 예외는 별도 조회한다 — 결과는 동일', async () => {
    const { selects, tables } = makeSb({
      meetings: sel => sel.includes('meeting_exceptions')
        ? EMBED_ERR
        : OK([meetingRow('m1')]),
      exceptions: OK([exRow('m1', '2026-07-27')]),
    })
    const res = await getProjectMeetingData('embed-fail')
    expect(res.meetings.map(m => m.id)).toEqual(['m1'])
    expect(res.exceptions).toEqual([
      { meetingId: 'm1', occurrenceDate: '2026-07-27', kind: 'cancelled' },
    ])
    expect(selects).toHaveLength(2)          // 임베드 시도 → 임베드 없는 재시도
    expect(tables).toContain('meeting_exceptions')
    expect(console.error).toHaveBeenCalled() // 조용히 넘어가지 않는다
  })

  it('재시도까지 실패하면 빈 목록이지만 로그를 남긴다 — 조용한 빈 화면 금지', async () => {
    makeSb({ meetings: () => EMBED_ERR })
    const res = await getProjectMeetingData('embed-fail-twice')
    expect(res).toEqual({ meetings: [], exceptions: [] })
    expect(console.error).toHaveBeenCalledTimes(2)
  })
})

describe('getMyMeetings — 멤버 조회 병렬화 + 임베드', () => {
  it('비로그인이면 조회 없이 빈 결과', async () => {
    const { tables } = makeSb({ user: null, meetings: () => OK([]) })
    expect(await getMyMeetings('2026-07-01', '2026-07-31'))
      .toEqual({ meetings: [], exceptions: [] })
    expect(tables).not.toContain('meetings')
  })

  it('멤버 조회를 기다리지 않고 회의 조회를 함께 띄운다', async () => {
    let releaseMembers: (r: Reply) => void = () => {}
    const membersPending = new Promise<Reply>(r => { releaseMembers = r })
    const { selects } = makeSb({
      user: { id: 'u1', email: null },
      members: membersPending,
      meetings: () => OK([]),
    })

    const p = getMyMeetings('2026-07-01', '2026-07-31')
    // 멤버 응답을 아직 주지 않았는데도 회의 select 가 이미 나가 있어야 병렬이다.
    // (직렬이었다면 멤버가 풀릴 때까지 meetings 는 시작조차 못 한다.)
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve()
    expect(selects.length).toBe(1)
    releaseMembers(OK([]))
    await p
  })

  it('isMine 을 작성자·참석자 양쪽으로 계산한다 — 멤버 ID 병렬화 후에도 보존', async () => {
    makeSb({
      user: { id: 'u1', email: null },
      members: OK([{ id: 'member-a' }]),
      meetings: () => OK([
        meetingRow('mine-by-author', { created_by: 'u1' }),
        meetingRow('mine-by-attendee', { meeting_attendees: [{ member_id: 'member-a' }] }),
        meetingRow('not-mine', { meeting_attendees: [{ member_id: 'member-z' }] }),
      ]),
    })
    const res = await getMyMeetings('2026-07-01', '2026-07-31')
    expect(res.meetings.map(m => [m.id, m.isMine])).toEqual([
      ['mine-by-author', true], ['mine-by-attendee', true], ['not-mine', false],
    ])
  })

  it('임베드된 예외를 평탄화한다', async () => {
    const { tables } = makeSb({
      user: { id: 'u1', email: null },
      meetings: () => OK([
        meetingRow('m1', { meeting_exceptions: [exRow('m1', '2026-07-27'), exRow('m1', '2026-08-03')] }),
      ]),
    })
    const res = await getMyMeetings('2026-07-01', '2026-07-31')
    expect(res.exceptions).toEqual([
      { meetingId: 'm1', occurrenceDate: '2026-07-27', kind: 'cancelled' },
      { meetingId: 'm1', occurrenceDate: '2026-08-03', kind: 'cancelled' },
    ])
    expect(tables).not.toContain('meeting_exceptions')
  })
})
