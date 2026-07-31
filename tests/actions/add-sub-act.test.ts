import { describe, it, expect, vi, beforeEach } from 'vitest'

// addSubAct·addWbsItem 의 SUB-ACT 판별 가드(플래그 기반, Task 9)만 검증한다.
// wbs_items/teams/item_owners/change_logs 를 필터 매칭 인메모리 테이블로 모의한다
// (tests/actions/teams-actions.test.ts 의 체이너블 패턴을 select().eq().single()/
// 미종결 await/insert().select().single() 까지 지원하도록 확장).
const { db, resetDb, createServerClient, requireProjectAdmin, resolveProjectId } = vi.hoisted(() => {
  type TableName = 'wbs_items' | 'teams' | 'item_owners' | 'change_logs'
  const tables: Record<TableName, Array<Record<string, unknown>>> = {
    wbs_items: [], teams: [], item_owners: [], change_logs: [],
  }
  const db = {
    tables,
    get wbs_items() { return tables.wbs_items },
    set wbs_items(v: Array<Record<string, unknown>>) { tables.wbs_items = v },
    get teams() { return tables.teams },
    set teams(v: Array<Record<string, unknown>>) { tables.teams = v },
    inserted: {
      wbs_items: [], item_owners: [], change_logs: [],
    } as Partial<Record<TableName, Array<Record<string, unknown>>>>,
    nextId: 1,
  }
  const resetDb = () => {
    tables.wbs_items = []
    tables.teams = []
    tables.item_owners = []
    tables.change_logs = []
    db.inserted.wbs_items = []
    db.inserted.item_owners = []
    db.inserted.change_logs = []
    db.nextId = 1
  }

  /** 체이너블 최소 모의 — select/eq/in/is/limit 는 자기 자신, single/maybeSingle 은 필터 매칭 결과.
   *  종결 메서드 없이 바로 await 되는 조회(예: 형제 목록)를 위해 체인 자체도 thenable 이다. */
  function table(name: TableName) {
    const rows = () => tables[name]
    const filters: Array<[string, unknown, 'eq' | 'in']> = []
    let limitN: number | null = null
    const matches = (r: Record<string, unknown>) =>
      filters.every(([c, v, op]) =>
        op === 'in' ? (v as unknown[]).includes(r[c]) : (r[c] ?? null) === v,
      )
    const selected = () => {
      const found = rows().filter(matches)
      return limitN != null ? found.slice(0, limitN) : found
    }
    const q: Record<string, unknown> = {}
    const chain = (fn?: (...a: unknown[]) => void) => (...a: unknown[]) => { fn?.(...a); return q }
    Object.assign(q, {
      select: chain(),
      eq: chain((c, v) => filters.push([String(c), v, 'eq'])),
      is: chain((c, v) => filters.push([String(c), v, 'eq'])),
      in: chain((c, v) => filters.push([String(c), v, 'in'])),
      limit: chain((n) => { limitN = n as number }),
      order: chain(),
      single: async () => {
        const found = selected()
        return found.length
          ? { data: found[0], error: null }
          : { data: null, error: { code: 'PGRST116', message: '0행' } }
      },
      maybeSingle: async () => {
        const found = selected()
        return { data: found[0] ?? null, error: null }
      },
      insert: (row: Record<string, unknown>) => {
        const withId = { id: `gen-${db.nextId++}`, ...row }
        rows().push(withId)
        db.inserted[name]?.push(withId)
        return {
          select: chain(() => ({})),
          single: async () => ({ data: withId, error: null }),
          then: (resolve: (v: unknown) => unknown) =>
            Promise.resolve({ data: null, error: null }).then(resolve),
        }
      },
      update: (patch: Record<string, unknown>) => ({
        eq: (c: string, v: unknown) => {
          const target = rows().filter(r => r[c] === v)
          target.forEach(r => Object.assign(r, patch))
          return {
            select: async () => ({ data: target.map(r => ({ id: r.id })), error: null }),
            then: (resolve: (v: unknown) => unknown) =>
              Promise.resolve({ data: target, error: null }).then(resolve),
          }
        },
      }),
      delete: () => ({
        eq: async (c: string, v: unknown) => {
          const idx = rows().findIndex(r => r[c] === v)
          if (idx >= 0) rows().splice(idx, 1)
          return { error: null }
        },
      }),
      then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
        Promise.resolve({ data: selected(), error: null }).then(resolve, reject),
    })
    return q
  }

  const createServerClient = vi.fn(async () => ({
    from: (n: TableName) => table(n),
  }))
  const requireProjectAdmin = vi.fn()
  const resolveProjectId = vi.fn()
  return { db, resetDb, createServerClient, requireProjectAdmin, resolveProjectId }
})

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
// after() 는 요청 스코프 밖에서 throw — 콜백을 실행하지 않는 원본 대체는 authz-gate-wbs.test.ts 관례.
vi.mock('next/server', async (importOriginal) => {
  const actual = await importOriginal<typeof import('next/server')>()
  return { ...actual, after: vi.fn() }
})
vi.mock('@/lib/authz', () => ({ requireProjectAdmin, resolveProjectId }))
vi.mock('@/lib/supabase/server', () => ({ createServerClient }))
vi.mock('@/lib/data/snapshots', () => ({ recordProgressSnapshot: vi.fn() }))

import { addSubAct, addWbsItem } from '@/app/actions/wbs'

const ADMIN = { ok: true as const, actor: { userId: 'u-admin' } }

beforeEach(() => {
  resetDb()
  createServerClient.mockClear()
  requireProjectAdmin.mockReset()
  resolveProjectId.mockReset()
  requireProjectAdmin.mockResolvedValue(ADMIN)
  resolveProjectId.mockResolvedValue({ ok: true, projectId: 'p1' })
})

describe('addSubAct 가드 ① — 대상은 리프여야 한다', () => {
  it('일반(비 SUB-ACT) 자식이 있는 항목에는 추가를 거부한다', async () => {
    db.wbs_items = [
      { id: 'act-1', project_id: 'p1', code: '1', name: '작업', biz: null, deliverable: null,
        planned_start: null, planned_end: null, is_owner_split: false },
      { id: 'child-1', parent_id: 'act-1', sort_order: 1, is_owner_split: false },
    ]
    const r = await addSubAct('act-1', 'PMO', 'primary')
    expect(r).toEqual({ ok: false, error: 'SUB-ACT가 아닌 하위 항목이 있는 곳에는 추가할 수 없습니다' })
    // 거부는 insert 이전 — wbs_items 는 늘지 않는다.
    expect(db.wbs_items).toHaveLength(2)
  })

  it('자식이 전부 SUB-ACT면 허용 경로로 진입한다(성공)', async () => {
    db.wbs_items = [
      { id: 'act-2', project_id: 'p1', code: '2', name: '복수 담당 작업', biz: 'PI', deliverable: '산출물',
        planned_start: '2026-01-01', planned_end: '2026-01-10', is_owner_split: false },
      { id: 'sub-1', parent_id: 'act-2', sort_order: 1, is_owner_split: true },
    ]
    db.teams = [{ id: 'team-erp', code: 'ERP' }]
    const r = await addSubAct('act-2', 'ERP', 'primary')
    expect(r.ok).toBe(true)
  })
})

describe('addSubAct 가드 ②', () => {
  it('대상 자신이 SUB-ACT면 거부한다', async () => {
    db.wbs_items = [
      { id: 'act-3', project_id: 'p1', code: '3', name: '기존 SUB-ACT', biz: null, deliverable: null,
        planned_start: null, planned_end: null, is_owner_split: true },
    ]
    const r = await addSubAct('act-3', 'PMO', 'primary')
    expect(r).toEqual({ ok: false, error: 'SUB-ACT 아래에는 추가할 수 없습니다' })
    expect(db.wbs_items).toHaveLength(1)
  })
})

describe('addSubAct 가드 ③ — insert 페이로드', () => {
  it('성공 insert 에 is_owner_split:true 와 level:\'activity\'(하위호환)를 싣는다', async () => {
    db.wbs_items = [
      { id: 'act-4', project_id: 'p1', code: '4', name: '데이터 이관', biz: '가공', deliverable: '이관 결과서',
        planned_start: '2026-02-01', planned_end: '2026-02-10', is_owner_split: false },
      { id: 'sub-4a', parent_id: 'act-4', sort_order: 1, is_owner_split: true },
    ]
    db.teams = [{ id: 'team-mes', code: 'MES' }]
    const r = await addSubAct('act-4', 'MES', 'support')
    expect(r.ok).toBe(true)
    const inserted = db.inserted.wbs_items?.find(row => row.parent_id === 'act-4')
    expect(inserted).toMatchObject({
      project_id: 'p1',
      parent_id: 'act-4',
      level: 'activity',
      is_owner_split: true,
      code: '4',
      biz: '가공',
      deliverable: '이관 결과서',
      planned_start: '2026-02-01',
      planned_end: '2026-02-10',
      weight: null,
      actual_pct: null,
    })
  })
})

describe('addWbsItem 대칭 가드 — SUB-ACT 형제가 있으면 일반 항목을 거부한다', () => {
  it('부모의 기존 자식 중 is_owner_split 이 하나라도 있으면 거부', async () => {
    db.wbs_items = [
      { id: 'sib-1', project_id: 'p1', parent_id: 'parent-1', sort_order: 1, is_owner_split: true },
    ]
    const r = await addWbsItem('p1', 'parent-1', 'activity', '새 항목')
    expect(r).toEqual({ ok: false, error: 'SUB-ACT 형제로는 일반 항목을 추가할 수 없습니다' })
    expect(db.wbs_items).toHaveLength(1)
  })

  it('기존 자식이 전부 일반 항목이거나 없으면 현행 동작 유지(성공)', async () => {
    db.wbs_items = [
      { id: 'sib-2', project_id: 'p1', parent_id: 'parent-2', sort_order: 1, is_owner_split: false },
    ]
    const r = await addWbsItem('p1', 'parent-2', 'activity', '새 항목')
    expect(r.ok).toBe(true)
  })
})
