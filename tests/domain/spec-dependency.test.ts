import { describe, expect, it } from 'vitest'
import { specLinkState, specStartReadiness, type SpecLinkView } from '@/lib/domain/specDependency'

const link = (itemId: string | null, stage: string | null): SpecLinkView => ({ itemId, stage })

describe('specLinkState', () => {
  it('external_ref 해석 실패(itemId=null)는 unknown — stage 와 무관하게 fail-closed', () => {
    expect(specLinkState(link(null, 'im'))).toBe('unknown')
    expect(specLinkState(link(null, null))).toBe('unknown')
  })

  it('stage 가 im 이면 satisfied', () => {
    expect(specLinkState(link('i1', 'im'))).toBe('satisfied')
  })

  it('stage 가 xx 이면 satisfied', () => {
    expect(specLinkState(link('i1', 'xx'))).toBe('satisfied')
  })

  it('stage 가 as/fp/ip 는 아직 waiting', () => {
    expect(specLinkState(link('i1', 'as'))).toBe('waiting')
    expect(specLinkState(link('i1', 'fp'))).toBe('waiting')
    expect(specLinkState(link('i1', 'ip'))).toBe('waiting')
  })

  it('stage 가 null 이면 waiting — itemId 는 찾았지만 단계 미지정', () => {
    expect(specLinkState(link('i1', null))).toBe('waiting')
  })
})

describe('specStartReadiness', () => {
  it('선행이 0건이면 ready true', () => {
    const r = specStartReadiness([])
    expect(r.waitingCount).toBe(0)
    expect(r.unknownCount).toBe(0)
    expect(r.ready).toBe(true)
  })

  it('전부 satisfied 면 ready true', () => {
    const r = specStartReadiness([link('a', 'im'), link('b', 'xx')])
    expect(r.waitingCount).toBe(0)
    expect(r.unknownCount).toBe(0)
    expect(r.ready).toBe(true)
  })

  it('하나라도 waiting 이면 ready false 이고 waitingCount 에 반영', () => {
    const r = specStartReadiness([link('a', 'im'), link('b', 'fp')])
    expect(r.waitingCount).toBe(1)
    expect(r.unknownCount).toBe(0)
    expect(r.ready).toBe(false)
  })

  it('하나라도 unknown 이면 ready false 이고 unknownCount 에 반영 — fail-closed', () => {
    const r = specStartReadiness([link('a', 'im'), link(null, null)])
    expect(r.waitingCount).toBe(0)
    expect(r.unknownCount).toBe(1)
    expect(r.ready).toBe(false)
  })

  it('waiting 과 unknown 이 섞이면 둘 다 세고 ready false', () => {
    const r = specStartReadiness([link('a', 'fp'), link(null, null), link('c', 'im')])
    expect(r.waitingCount).toBe(1)
    expect(r.unknownCount).toBe(1)
    expect(r.ready).toBe(false)
  })
})
