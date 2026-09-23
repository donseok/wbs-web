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
})
