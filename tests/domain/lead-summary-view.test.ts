// 조정 팀장 자리 요약의 화면 모델 — 중요도 순서 1~6·alive 45분 경계·회차 여럿·요약 없음·입력 대기 집계(계약 (A)).
import { describe, expect, it } from 'vitest'
import { buildLeadSummaryView, leadInputWaits, LEAD_ALIVE_STALE_MS } from '@/lib/domain/leadSummaryView'
import { parseLeadSummary, type LeadSummary } from '@/lib/domain/watcherExtras'

const NOW = Date.parse('2026-10-06T14:00:00+09:00')
const run = (over: Record<string, unknown> = {}) => ({
  run: 'r1',
  decision: { pending_user: 1, open: 2, first_title: 'main 에 push 해도 됩니까' },
  merge: { in_flight: 'engine', queue: ['server', 'web'] },
  progress: { goal: '레인 요약 화면', started_at: '2026-10-06T11:55:00+09:00', items_done: 4, items_total: 9 },
  lanes: { working: 3, waiting: 1, done: 2, quiet: ['docs'] },
  resource: { band: 'normal', five: 40, week: 12, load_adjust: 2, banned: false },
  alive: { last_tick_at: '2026-10-06T13:50:00+09:00' },
  ...over,
})
const lead = (...runs: Record<string, unknown>[]): LeadSummary => {
  const r = parseLeadSummary({ v: 1, runs })
  if (!r.ok || !r.value) throw new Error('픽스처가 계약을 어겼습니다')
  return r.value
}

describe('buildLeadSummaryView', () => {
  it('요약이 없으면 null — 화면이 「요약 없음」 을 쓴다', () => {
    expect(buildLeadSummaryView(null, NOW)).toBeNull()
    expect(buildLeadSummaryView(undefined, NOW)).toBeNull()
  })

  it('한 회차는 중요도 순서 1~6 으로 나온다', () => {
    const v = buildLeadSummaryView(lead(run()), NOW)!
    expect(v.runs).toHaveLength(1)
    expect(v.runs[0].items.map(i => [i.order, i.id])).toEqual([[1, 'decision'], [2, 'merge'], [3, 'progress'], [4, 'lanes'], [5, 'resource'], [6, 'alive']])
  })

  it('1 결정 대기 — pending_user+open 합, 첫 건 제목, 배지(카드와 같은 합계)', () => {
    const v = buildLeadSummaryView(lead(run()), NOW)!
    const d = v.runs[0].items[0]
    expect(d.tone).toBe('alert')
    expect(d.badge).toBe('결정 대기 3건')
    expect(d.lines.join('\n')).toContain('사용자 몫이 1건, 미결 결정이 2건')
    expect(d.lines.join('\n')).toContain('「main 에 push 해도 됩니까」')
    expect(v.decision).toMatchObject({ count: 3, pendingUser: 1, open: 2, firstTitle: 'main 에 push 해도 됩니까', text: '결정 3건' })
  })
  it('결정이 없으면 배지가 없고 흐리게 보인다', () => {
    const v = buildLeadSummaryView(lead(run({ decision: { pending_user: 0, open: 0 } })), NOW)!
    expect(v.decision).toBeNull()
    expect(v.runs[0].items[0]).toMatchObject({ tone: 'muted', lines: ['결정을 기다리는 건이 없습니다.'] })
    expect(v.runs[0].items[0].badge).toBeUndefined()
  })

  it('2 머지 — in_flight 와 queue 순서', () => {
    const m = buildLeadSummaryView(lead(run()), NOW)!.runs[0].items[1]
    expect(m.lines).toEqual(['engine 레인을 머지하고 있습니다.', '머지 대기 순서는 server → web 입니다.'])
    const none = buildLeadSummaryView(lead(run({ merge: {} })), NOW)!.runs[0].items[1]
    expect(none).toMatchObject({ tone: 'muted', lines: ['머지 중이거나 순서를 기다리는 레인이 없습니다.'] })
  })

  it('3 진행 — 목표 한 줄·시작 뒤 경과·항목 합계', () => {
    const p = buildLeadSummaryView(lead(run()), NOW)!.runs[0].items[2]
    expect(p.lines).toEqual([
      '이번 회차의 목표는 「레인 요약 화면」입니다.',
      '시작 후 2시간 5분 경과했습니다.',
      '레인의 작업 항목 9개 가운데 4개를 마쳤습니다.',
    ])
    const empty = buildLeadSummaryView(lead(run({ progress: {} })), NOW)!.runs[0].items[2]
    expect(empty.lines).toEqual(['집계된 레인 작업 항목이 없습니다.'])
  })

  it('4 레인 — 수와 오래 조용한 레인 이름', () => {
    const l = buildLeadSummaryView(lead(run()), NOW)!.runs[0].items[3]
    expect(l.tone).toBe('warn')
    expect(l.lines).toEqual(['작업 중인 레인이 3개, 대기 중인 레인이 1개, 끝난 레인이 2개입니다.', '보고 없이 오래 조용한 레인은 docs 입니다.'])
    const calm = buildLeadSummaryView(lead(run({ lanes: { working: 1, waiting: 0, done: 0, quiet: [] } })), NOW)!.runs[0].items[3]
    expect(calm.tone).toBe('ok')
    expect(calm.lines).toHaveLength(1)
  })

  it('5 자원 — band·five·week·부하 조절·banned', () => {
    const r = buildLeadSummaryView(lead(run()), NOW)!.runs[0].items[4]
    expect(r.tone).toBe('ok')
    expect(r.lines).toEqual(['사용량은 구간 normal, 5시간 40%, 주간 12% 입니다.', '부하 조절은 2회 했습니다.', '차단 상태는 아닙니다.'])
    const banned = buildLeadSummaryView(lead(run({ resource: { banned: true, load_adjust: 0 } })), NOW)!.runs[0].items[4]
    expect(banned.tone).toBe('alert')
    expect(banned.lines[0]).toBe('사용량 정보가 없습니다.')
    expect(banned.lines).toContain('차단(banned) 상태입니다.')
  })

  it('6 alive — 마지막 tick 경과, 45분을 넘으면 빨강(정확히 45분은 아니다)', () => {
    const at = (min: number, extraMs = 0) => buildLeadSummaryView(
      lead(run({ alive: { last_tick_at: new Date(NOW - min * 60_000 - extraMs).toISOString() } })), NOW)!.runs[0].items[5]
    expect(LEAD_ALIVE_STALE_MS).toBe(45 * 60_000)
    expect(at(10)).toMatchObject({ tone: 'ok', lines: ['마지막 tick 이 10분 전에 있었습니다.'] })
    expect(at(45).tone).toBe('ok')
    expect(at(45, 1_000).tone).toBe('alert')
    expect(at(45, 1_000).lines[0]).toContain('오래 멈춰 있습니다')
    expect(at(120).lines[0]).toContain('2시간 전')
  })
  it('tick 기록이 없으면 경고색(warn)과 없다는 문장', () => {
    expect(buildLeadSummaryView(lead(run({ alive: {} })), NOW)!.runs[0].items[5]).toMatchObject({ tone: 'warn', lines: ['마지막 tick 기록이 없습니다.'] })
  })

  it('회차가 여럿이면 회차별로 구분하고, 결정 배지는 합쳐 센다', () => {
    const v = buildLeadSummaryView(lead(
      run({ run: 'r1' }),
      run({ run: 'r2', decision: { pending_user: 0, open: 4, first_title: '둘째 회차 결정' }, merge: {} }),
    ), NOW)!
    expect(v.runs.map(r => r.run)).toEqual(['r1', 'r2'])
    expect(v.runs[1].items[0].badge).toBe('결정 대기 4건')
    expect(v.runs[1].items[1].tone).toBe('muted')
    expect(v.decision).toMatchObject({ count: 7, pendingUser: 1, open: 6, firstTitle: 'main 에 push 해도 됩니까' })
  })
  it('첫 회차에 결정이 없으면 결정이 있는 회차의 제목을 쓴다', () => {
    const v = buildLeadSummaryView(lead(run({ decision: {} }), run({ run: 'r2', decision: { open: 1, first_title: '둘째' } })), NOW)!
    expect(v.decision).toMatchObject({ count: 1, firstTitle: '둘째' })
  })
  it('회차가 하나도 없는 요약은 빈 회차 목록이다(null 이 아니다)', () => {
    const v = buildLeadSummaryView(lead(), NOW)!
    expect(v).toEqual({ runs: [], decision: null })
  })
})

describe('leadInputWaits — 같은 PC 행의 임시 팀원 입력 대기', () => {
  const req = (over: Record<string, unknown> = {}) => ({ v: 1 as const, kind: 'permission' as const, since: '2026-10-06T13:50:00Z', handled: null, ...over })
  const desk = (kind: 'temp' | 'lead' | 'member', lane: string, inputRequest: ReturnType<typeof req> | null, summaryLane?: string) => ({
    kind,
    watcher: { agent: `jji/mac/임시:${lane}·x`, host: null, slots: null, busy: null, untilLabel: null, lastSeenAt: '2026-10-06T13:59:00Z', projectId: null, inputRequest,
      ...(summaryLane ? { summary: { lane: summaryLane } as never } : {}) },
    temp: { lane, summary: 'x' },
  })
  it('임시 팀원 책상 중 입력 요청이 있고 handled 가 null 인 수만 센다', () => {
    const w = leadInputWaits([desk('temp', 'a', req()), desk('temp', 'b', req()), desk('temp', 'c', null), desk('lead', 'd', req()), desk('member', 'e', req())])
    expect(w).toEqual({ waiting: 2, records: [] })
  })
  it('조정자·자동이 처리한 건은 건수에서 빼고 처리됨 기록 문장으로만 남긴다(레인 이름순)', () => {
    const w = leadInputWaits([
      desk('temp', 'l10', req({ kind: 'question', handled: { by: 'auto', at: '2026-10-06T09:03:00Z' } })),
      desk('temp', 'l2', req({ handled: { by: 'coordinator', at: '2026-10-06T09:01:00Z' } })),
      desk('temp', 'z', req()),
    ])
    expect(w.waiting).toBe(1)
    expect(w.records).toEqual([
      'l2 레인의 입력 요청(권한 요청)은 조정자가 18:01에 처리했습니다.',
      'l10 레인의 입력 요청(질문)은 자동으로 18:03에 처리했습니다.',
    ])
  })
  it('레인 이름은 요약의 lane 이 우선이고, 처리 시각을 읽을 수 없으면 시각 없이 쓴다', () => {
    const w = leadInputWaits([desk('temp', 'slot', req({ handled: { by: 'coordinator', at: 'x' } }), 'real-lane')])
    expect(w.records).toEqual(['real-lane 레인의 입력 요청(권한 요청)은 조정자가 처리했습니다.'])
  })
  it('책상이 없거나 요청이 없으면 0건', () => {
    expect(leadInputWaits([])).toEqual({ waiting: 0, records: [] })
  })
})
