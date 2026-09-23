// depends_evidence.waived(계약 2.8) — 면제된 선행은 reached 가 참이다. claim 게이트와 스킬이 같은 값을 본다.
import { describe, expect, it } from 'vitest'
import { loadDependsInfo } from '@/lib/agent/depends'

function admin(items: unknown[]) {
  const q = (data: unknown) => {
    const b: Record<string, unknown> = {}
    for (const k of ['select', 'eq', 'in', 'order', 'limit']) b[k] = () => b
    b.maybeSingle = async () => ({ data: null, error: null })
    b.then = (r: (v: unknown) => unknown) => Promise.resolve({ data, error: null }).then(r)
    return b
  }
  return { from: (t: string) => q(t === 'wbs_items' ? items : null) } as never
}

describe('loadDependsInfo — waived', () => {
  it('면제된 선행은 waived:true·reached:true, 나머지는 종전 판정', async () => {
    const out = await loadDependsInfo(admin([
      { id: 'a', external_ref: 'm/TSK-01', stage: 'ip', actual_pct: 30 },
      { id: 'b', external_ref: 'm/TSK-03', stage: 'ip', actual_pct: 30 },
    ]), { projectId: 'p', depends: ['m/TSK-01', 'm/TSK-03'], waived: ['m/TSK-01'] })
    expect(out.map(d => [d.external_ref, d.waived, d.reached])).toEqual([['m/TSK-01', true, true], ['m/TSK-03', false, false]])
  })
  it('프로젝트에 없는 ref 라도 면제면 reached 다', async () => {
    const out = await loadDependsInfo(admin([]), { projectId: 'p', depends: ['m/GONE'], waived: ['m/GONE'] })
    expect(out[0]).toEqual(expect.objectContaining({ waived: true, reached: true }))
  })
})
