import { describe, expect, it } from 'vitest'
import { parseLeaseBody } from '@/lib/agent/leadLease'

const P1 = '11111111-1111-4111-8111-111111111111'
const H = '0123abcd-0000-4000-8000-00000000abcd:4294967295'

describe('parseLeaseBody', () => {
  it('acquire — projects 중복을 지우고 takeover 기본 false', () => {
    expect(parseLeaseBody({ op: 'acquire', projects: [P1, P1], holder: H, host: 'mbp', agent: 'hong/mbp/lead' }))
      .toEqual({ op: 'acquire', projects: [P1], holder: H, host: 'mbp', agent: 'hong/mbp/lead', takeover: false })
  })
  it.each([
    [{ op: 'acquire', projects: [], holder: H, host: 'm', agent: 'a' }, 'projects'],
    [{ op: 'acquire', projects: ['x'], holder: H, host: 'm', agent: 'a' }, 'projects'],
    [{ op: 'acquire', projects: [P1], holder: 'mbp', host: 'm', agent: 'a' }, 'holder'],
    [{ op: 'acquire', projects: [P1], holder: H, host: '', agent: 'a' }, 'host'],
    [{ op: 'acquire', projects: [P1], holder: H, host: 'm', agent: 'a', takeover: 'yes' }, 'takeover'],
    [{ op: 'renew', holder: H, leases: [{ project_id: P1, generation: 0 }] }, 'generation'],
    [{ op: 'renew', holder: H, leases: [] }, 'leases'],
    [{ op: 'steal', holder: H }, 'op'],
  ])('%j → 오류(%s)', (body, word) => {
    const r = parseLeaseBody(body)
    expect('error' in r && r.error).toContain(word)
  })
  it('renew·release — leases 를 그대로 받는다', () => {
    for (const op of ['renew', 'release'] as const) {
      expect(parseLeaseBody({ op, holder: H, leases: [{ project_id: P1, generation: 3 }] }))
        .toEqual({ op, holder: H, leases: [{ project_id: P1, generation: 3 }] })
    }
  })
  // 무거운 작업 표시(2026-09-26) — renew 에만 선택으로 싣는다. 틀려도 renew 는 받아들인다(lease 를 잃지 않게).
  const heavy = { pc: { k: 2, held: 1, waiting: 0, load: 3.5, cpus: 10 },
    orders: [{ id8: 'abcdef12', state: 'run', kind: 'run', pool: 'general', since: 1790000000, pos: null, n: 1, cmd: 'npm test' }] }
  it('renew 의 heavy 는 검사해 싣는다', () => {
    expect(parseLeaseBody({ op: 'renew', holder: H, leases: [{ project_id: P1, generation: 3 }], heavy }))
      .toEqual({ op: 'renew', holder: H, leases: [{ project_id: P1, generation: 3 }], heavy })
  })
  it('heavy 가 틀리면 renew 는 그대로, heavy 대신 heavyError', () => {
    const r = parseLeaseBody({ op: 'renew', holder: H, leases: [{ project_id: P1, generation: 3 }], heavy: { pc: 1, orders: [] } })
    expect(r).toEqual({ op: 'renew', holder: H, leases: [{ project_id: P1, generation: 3 }], heavyError: expect.stringContaining('heavy') })
  })
  it('release 는 heavy 를 보지 않는다', () => {
    expect(parseLeaseBody({ op: 'release', holder: H, leases: [{ project_id: P1, generation: 3 }], heavy }))
      .toEqual({ op: 'release', holder: H, leases: [{ project_id: P1, generation: 3 }] })
  })
})
