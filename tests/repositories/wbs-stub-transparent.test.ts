// AI 도구 스냅샷(repositories/supabase/wbs)도 stub 하위(0103)를 구조에 투명하게 둔다 — 화면 로더와 같은 규칙(강제 진행 F9).
import { describe, expect, it, vi } from 'vitest'
vi.mock('@/lib/teams/master', () => ({ teamsForProjectSync: () => [] }))
import { createSupabaseWbsRepository } from '@/lib/repositories/supabase/wbs'
import { computeTree } from '@/lib/domain/rollup'
import { collectLeaves } from '@/lib/domain/tree'

function q(data: unknown) {
  const b: Record<string, unknown> = {}
  for (const m of ['select', 'eq', 'order', 'maybeSingle']) b[m] = vi.fn(() => b)
  b.then = (res: (v: unknown) => unknown) => Promise.resolve({ data, error: null }).then(res)
  return b
}
const row = (id: string, parent: string | null, over: Record<string, unknown> = {}) => ({
  id, project_id: 'p1', parent_id: parent, code: id, sort_order: 1, name: id, biz: null, deliverable: null,
  planned_start: '2026-09-01', planned_end: '2026-09-30', weight: null, actual_pct: null, updated_at: null,
  is_owner_split: false, external_ref: `m/${id}`, depends: null, item_owners: [], ...over,
})

describe('WBS 봇 스냅샷 — stub 하위 투명', () => {
  it('stub_for 를 읽어 트리·리프·롤업에서 후행을 리프로 두고, 부모→스텁 간선을 긋지 않는다', async () => {
    const tables: Record<string, unknown> = {
      projects: { id: 'p1', base_date: null },
      wbs_items: [
        row('wp', null),
        row('succ', 'wp', { actual_pct: 80 }),
        row('sub', 'succ', { actual_pct: 0, stub_for: 'm/pred', depends: ['m/succ'], external_ref: 'm/succ.stub.pred' }),
      ],
      holidays: [], task_dependencies: [],
    }
    const client = { from: vi.fn((t: string) => q(tables[t])) }
    const r = await createSupabaseWbsRepository(client as never).getProjectSnapshot('p1')
    if (!r.ok || !r.data) throw new Error('snapshot')
    const select = (client.from.mock.results[1].value as { select: ReturnType<typeof vi.fn> }).select
    expect(String(select.mock.calls[0][0])).toContain('stub_for')
    expect(r.data.items.find(i => i.id === 'sub')!.stubFor).toBe('m/pred')
    const [wp] = computeTree(r.data.items, '2026-09-15', new Set(), { subActTeamOrder: new Map() })
    expect(collectLeaves([wp]).map(l => l.id)).toEqual(['succ'])
    expect(wp.rolledActualPct).toBe(80)
    expect(r.data.dependencies).toEqual([])
  })
})
