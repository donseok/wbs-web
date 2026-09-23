// 강제 진행(스펙 2026-09-23 F2) — 면제된 선행은 대기 사유에서 빠진다. claim 게이트와 같은 판정이어야 화면이 거짓말하지 않는다.
import { describe, expect, it } from 'vitest'
import { deriveWaitReason, unmetDepends, type PredecessorLike } from '@/lib/domain/waitReason'

const pred = (ref: string, stage: string | null): PredecessorLike =>
  ({ external_ref: ref, code: ref.split('/').pop()!, name: `선행 ${ref}`, stage, order_approved: false, actual_pct: 0 })
const byRef = (m: Record<string, PredecessorLike>) => (ref: string) => m[ref]

describe('unmetDepends — waived', () => {
  it('면제된 ref 는 미충족에서 빠진다', () => {
    const m = { 'm/TSK-01': pred('m/TSK-01', 'ip'), 'm/TSK-02': pred('m/TSK-02', 'ip') }
    const u = unmetDepends(['m/TSK-01', 'm/TSK-02'], byRef(m), ['m/TSK-01'])
    expect(u.map(d => d.ref)).toEqual(['m/TSK-02'])
  })
  it('프로젝트에 없는 ref 라도 면제면 충족이다(판정은 면제가 먼저)', () => {
    expect(unmetDepends(['m/GONE'], byRef({}), ['m/GONE'])).toEqual([])
  })
  it('waived 를 안 넘기면 종전과 같다', () => {
    expect(unmetDepends(['m/TSK-01'], byRef({ 'm/TSK-01': pred('m/TSK-01', 'ip') })).length).toBe(1)
  })
})

describe('deriveWaitReason — waived', () => {
  it('유일한 미충족 선행이 면제면 선행 대기가 아니다', () => {
    const r = deriveWaitReason({
      depends: ['m/TSK-01'], predecessorByRef: byRef({ 'm/TSK-01': pred('m/TSK-01', 'ip') }),
      assignee: null, watchers: [], waived: ['m/TSK-01'],
    })
    expect(r.kind).not.toBe('dependency')
  })
})
