// 팀장 자리 요약(lead_summary)·입력 요청(input_request) 검증 — 계약 (A)(B).
import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { excerptMaterial, parseInputRequest, parseLeadSummary, readInputRequest, readLeadSummary, leadSummaryWire } from '@/lib/domain/watcherExtras'

const sha = (m: string) => createHash('sha256').update(m, 'utf8').digest('hex')
const run = {
  run: 'r1', decision: { pending_user: 1, open: 2, first_title: '삭제 확인' }, merge: { in_flight: 'eng', queue: ['srv', 'ui'] },
  progress: { goal: '목표 한 줄', started_at: '2026-10-06T09:00:00+09:00', items_done: 3, items_total: 9 },
  lanes: { working: 2, waiting: 1, done: 0, quiet: ['kit'] }, resource: { band: 'Y', five: 30, week: 64, load_adjust: 1, banned: false },
  alive: { last_tick_at: '2026-10-06T13:50:00+09:00' },
}

describe('parseLeadSummary', () => {
  it('없으면 null, 회차 배열을 읽어 정규화한다', () => {
    expect(parseLeadSummary(undefined)).toEqual({ ok: true, value: null })
    const r = parseLeadSummary({ v: 1, runs: [run] })
    expect(r).toMatchObject({ ok: true, value: { v: 1, runs: [{ run: 'r1', decision: { pendingUser: 1, open: 2, firstTitle: '삭제 확인' }, merge: { inFlight: 'eng', queue: ['srv', 'ui'] },
      progress: { itemsDone: 3, itemsTotal: 9 }, lanes: { working: 2, quiet: ['kit'] }, resource: { band: 'Y', five: 30, week: 64, loadAdjust: 1, banned: false }, alive: { lastTickAt: '2026-10-06T13:50:00+09:00' } }] } })
  })
  it('하위 객체를 생략하면 빈 값으로 채운다(터미널 화면·세부는 싣지 않는 계약)', () => {
    const r = parseLeadSummary({ v: 1, runs: [{ run: 'r1' }] })
    expect(r).toMatchObject({ ok: true, value: { runs: [{ decision: { pendingUser: 0, open: 0, firstTitle: null }, merge: { inFlight: null, queue: [] }, resource: { five: null, banned: false } }] } })
  })
  it('모르는 키를 버린다', () => {
    const r = parseLeadSummary({ v: 1, runs: [{ ...run, screen: ['터미널 화면'], pid: 3, lanes: { ...run.lanes, handle: 'term_x' } }], path: '/Users/jji' })
    expect(r.ok).toBe(true)
    if (r.ok && r.value) {
      const wire = JSON.stringify(leadSummaryWire(r.value))
      for (const k of ['screen', '터미널 화면', 'pid', 'handle', 'term_x', '/Users/jji']) expect(wire).not.toContain(k)
    }
  })
  it('형식 오류 — v·runs 개수·제목 길이·비율 범위·불리언', () => {
    expect(parseLeadSummary({ v: 2, runs: [] }).ok).toBe(false)
    expect(parseLeadSummary({ v: 1 }).ok).toBe(false)
    expect(parseLeadSummary({ v: 1, runs: Array.from({ length: 6 }, () => run) }).ok).toBe(false)
    expect(parseLeadSummary({ v: 1, runs: [{ ...run, decision: { ...run.decision, first_title: '가'.repeat(101) } }] }).ok).toBe(false)
    expect(parseLeadSummary({ v: 1, runs: [{ ...run, decision: { ...run.decision, first_title: '가'.repeat(100) } }] }).ok).toBe(true)
    expect(parseLeadSummary({ v: 1, runs: [{ ...run, progress: { ...run.progress, goal: '가'.repeat(121) } }] }).ok).toBe(false)
    expect(parseLeadSummary({ v: 1, runs: [{ ...run, resource: { ...run.resource, week: 101 } }] }).ok).toBe(false)
    expect(parseLeadSummary({ v: 1, runs: [{ ...run, resource: { ...run.resource, banned: 'no' } }] }).ok).toBe(false)
    expect(parseLeadSummary({ v: 1, runs: [{ ...run, merge: { in_flight: null, queue: Array.from({ length: 11 }, (_, i) => `l${i}`) } }] }).ok).toBe(false)
    expect(parseLeadSummary({ v: 1, runs: [{ ...run, run: '' }] }).ok).toBe(false)
    expect(parseLeadSummary({ v: 1, runs: ['x'] }).ok).toBe(false)
  })
  it('읽기는 깨진 값을 null 로 둔다', () => {
    expect(readLeadSummary({ nope: 1 })).toBeNull()
    expect(readLeadSummary(leadSummaryWire({ v: 1, runs: [] }))).toEqual({ v: 1, runs: [] })
  })
})

describe('리뷰 반영 — 오류 경로·중복·유니코드·해시 고정 벡터', () => {
  it('오류 사유의 칸 경로가 겹치지 않는다', () => {
    const r = parseLeadSummary({ v: 1, runs: [{ ...run, decision: { ...run.decision, first_title: '가'.repeat(101) } }] })
    expect(r.ok ? '' : r.error).toMatch(/^lead_summary\.first_title 는 100자/)
    const i = parseInputRequest({ v: 1, kind: 'permission', since: '어제', excerpt: [] }, sha)
    expect(i.ok ? '' : i.error).toMatch(/^input_request\.since /)
  })
  it('회차 이름이 겹치면 칸을 거절하고, 완료가 전체를 넘으면 자른다', () => {
    expect(parseLeadSummary({ v: 1, runs: [{ run: 'r' }, { run: 'r' }] }).ok).toBe(false)
    const r = parseLeadSummary({ v: 1, runs: [{ ...run, progress: { ...run.progress, items_done: 9, items_total: 3 } }] })
    expect(r).toMatchObject({ ok: true, value: { runs: [{ progress: { itemsDone: 3, itemsTotal: 3 } }] } })
  })
  it('NUL·제어 문자는 지우고 짝 없는 서로게이트는 거절한다', () => {
    expect(parseLeadSummary({ v: 1, runs: [{ run: 'r\u0000x' }] })).toMatchObject({ ok: true, value: { runs: [{ run: 'rx' }] } })
    expect(parseLeadSummary({ v: 1, runs: [{ run: 'r\ud800' }] }).ok).toBe(false)
    const e = parseInputRequest({ v: 1, kind: 'choice', since: '2026-10-06T13:40:00+09:00', excerpt: ['a\u0000b', 'c\u001b[0m'] }, sha)
    expect(e).toMatchObject({ ok: true, value: { excerpt: ['ab', 'c[0m'] } })
    expect(parseInputRequest({ v: 1, kind: 'choice', since: '2026-10-06T13:40:00+09:00', excerpt: ['x\udc00'] }, sha).ok).toBe(false)
  })
  it('줄 길이는 끝 공백을 지운 뒤에 잰다 — 195자 + 끝 공백 10개는 통과', () => {
    const line = 'a'.repeat(195) + ' '.repeat(10)
    expect(parseInputRequest({ v: 1, kind: 'choice', since: '2026-10-06T13:40:00Z', excerpt: [line] }, sha).ok).toBe(true)
    expect(parseInputRequest({ v: 1, kind: 'choice', since: '2026-10-06T13:40:00Z', excerpt: ['a'.repeat(201)] }, sha).ok).toBe(false)
  })
  it('해시 고정 벡터(킷과 맞추는 값) — 줄 끝 공백을 지우고 줄바꿈으로 이은 UTF-8 의 sha256', () => {
    const r = parseInputRequest({ v: 1, kind: 'choice', since: '2026-10-06T13:40:00Z', excerpt: ['a  ', 'b'] }, sha)
    // `printf 'a\nb' | shasum -a 256` 과 같은 값이다 — 서버 구현이 바뀌어도 킷과 어긋나지 않게 고정한다.
    expect(r.ok && r.value ? r.value.sha : null).toBe('7e18f737311b2dc3b2f269dd78396b0351f14fb66efa879f768cb23181883c78')
  })
})

const req = { v: 1, kind: 'permission', since: '2026-10-06T13:40:00+09:00', excerpt: ['Allow? (y/n)', '1) yes  2) no'], handled: null }

describe('parseInputRequest', () => {
  it('없으면 null, 있으면 발췌 sha 를 서버가 계산한다', () => {
    expect(parseInputRequest(undefined, sha)).toEqual({ ok: true, value: null })
    const r = parseInputRequest({ ...req, sha: 'f'.repeat(64) }, sha)
    expect(r).toMatchObject({ ok: true, value: { kind: 'permission', excerpt: ['Allow? (y/n)', '1) yes  2) no'], handled: null } })
    if (r.ok && r.value) expect(r.value.sha).toBe(sha(excerptMaterial(['Allow? (y/n)', '1) yes  2) no'])))
  })
  it('줄 끝 공백만 다듬고, 같은 발췌는 같은 해시다', () => {
    const a = parseInputRequest({ ...req, excerpt: ['x  ', 'y'] }, sha)
    const b = parseInputRequest({ ...req, excerpt: ['x', 'y'] }, sha)
    expect(a.ok && b.ok && a.value?.sha === b.value?.sha).toBe(true)
  })
  it('종류 6가지만 허용한다', () => {
    for (const k of ['permission', 'question', 'choice', 'usage-limit', 'trust', 'message']) expect(parseInputRequest({ ...req, kind: k }, sha).ok).toBe(true)
    expect(parseInputRequest({ ...req, kind: 'shell' }, sha).ok).toBe(false)
    expect(parseInputRequest({ ...req, kind: undefined }, sha).ok).toBe(false)
  })
  it('발췌 10줄·줄당 200자·since 필수·handled 형식', () => {
    expect(parseInputRequest({ ...req, excerpt: Array.from({ length: 10 }, () => 'a') }, sha).ok).toBe(true)
    expect(parseInputRequest({ ...req, excerpt: Array.from({ length: 11 }, () => 'a') }, sha).ok).toBe(false)
    expect(parseInputRequest({ ...req, excerpt: ['가'.repeat(200)] }, sha).ok).toBe(true)
    expect(parseInputRequest({ ...req, excerpt: ['가'.repeat(201)] }, sha).ok).toBe(false)
    expect(parseInputRequest({ ...req, excerpt: [1] }, sha).ok).toBe(false)
    expect(parseInputRequest({ ...req, since: undefined }, sha).ok).toBe(false)
    expect(parseInputRequest({ ...req, since: 'x' }, sha).ok).toBe(false)
    expect(parseInputRequest({ ...req, handled: { by: 'coordinator', at: '2026-10-06T13:41:00+09:00' } }, sha)).toMatchObject({ ok: true, value: { handled: { by: 'coordinator' } } })
    expect(parseInputRequest({ ...req, handled: { by: 'user', at: '2026-10-06T13:41:00+09:00' } }, sha).ok).toBe(false)
    expect(parseInputRequest({ ...req, handled: { by: 'auto' } }, sha).ok).toBe(false)
  })
  it('읽기 — sha 가 없거나 형식이 깨지면 null(fail-closed), 정상 저장값은 그대로', () => {
    const r = parseInputRequest(req, sha)
    expect(r.ok && r.value ? readInputRequest(r.value) : null).toMatchObject({ kind: 'permission' })
    expect(readInputRequest(req)).toBeNull()
    expect(readInputRequest({ ...req, sha: 'zz' })).toBeNull()
    expect(readInputRequest(null)).toBeNull()
  })
})
