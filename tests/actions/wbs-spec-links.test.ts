import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  requireProjectMember: vi.fn(),
  resolveProjectId: vi.fn(),
  createServerClient: vi.fn(),
}))
vi.mock('@/lib/authz', () => ({
  // wbsSpec.ts 는 모듈 스코프에서 requireProjectAdmin 도 함께 import 한다 — vi.mock 은 모듈
  // 전체를 교체하므로 이 키를 빼면 다른 export(updateWbsSpec 등)가 쓰는 값이 undefined 가 된다.
  // 이 파일의 테스트는 getWbsSpecLinks 만 호출해 실제로는 쓰이지 않지만, import 자체가
  // 깨지지 않도록 자리를 채워둔다.
  requireProjectAdmin: vi.fn(),
  requireProjectMember: mocks.requireProjectMember,
  resolveProjectId: mocks.resolveProjectId,
}))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }))
vi.mock('@/lib/supabase/server', () => ({ createServerClient: mocks.createServerClient }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

import { getWbsSpecLinks } from '@/app/actions/wbsSpec'

const P1 = '11111111-1111-4111-8111-111111111111'
const W1 = '33333333-3333-4333-8333-333333333333'

type Resp = { data?: unknown; error?: { message: string } | null }

/**
 * createServerClient 목 — sb.from('wbs_items') 호출 순서대로 큐에서 응답을 꺼낸다.
 * getWbsSpecLinks 는 wbs_items 테이블만 최대 3번 호출한다(자기 행 조회 → 선행 → 후행,
 * 좌→우 평가 순서라 Promise.all 안에서도 순서가 보장된다). 각 응답은 .maybeSingle()(자기 행
 * 조회)과 thenable(선행·후행 조회, supabase-js 쿼리 빌더가 그 자체로 awaitable) 양쪽에 쓰인다.
 * methodLog[i] 는 i 번째 from() 호출에서 실제로 불린 체이닝 메서드 이름 목록 — 선행 조회는
 * `.in('external_ref', depends)`, 후행 조회는 `.contains('depends', [externalRef])` 를 쓰므로
 * 이걸로 "어느 쿼리가 실제로 나갔는지" 구분한다(단순 from() 호출 횟수만으로는 선행·후행이 둘 다
 * 스킵됐는지 하나만 스킵됐는지 가릴 수 없다).
 */
function serverClient(responses: Resp[]) {
  const queue = [...responses]
  const calls: string[] = []
  const methodLog: string[][] = []
  const client = {
    from: vi.fn((table: string) => {
      calls.push(table)
      const resp = queue.shift() ?? { data: null, error: null }
      const used: string[] = []
      methodLog.push(used)
      const b: Record<string, unknown> = {}
      for (const k of ['select', 'eq', 'in', 'contains', 'order', 'limit']) {
        b[k] = () => { used.push(k); return b }
      }
      b.maybeSingle = async () => ({ data: resp.data ?? null, error: resp.error ?? null })
      b.then = (resolve: (v: unknown) => unknown) =>
        Promise.resolve({ data: resp.data ?? null, error: resp.error ?? null }).then(resolve)
      return b
    }),
  }
  mocks.createServerClient.mockResolvedValue(client)
  return { calls, methodLog }
}

type Row = {
  id: string
  code: string | null
  name: string | null
  stage: string | null
  actual_pct: number | string | null
  external_ref: string | null
}

function row(over: Partial<Row> & { id: string }): Row {
  return { code: null, name: null, stage: null, actual_pct: null, external_ref: null, ...over }
}

const ACTOR = { ok: true, actor: { userId: 'admin-1' } }

beforeEach(() => {
  vi.clearAllMocks()
  mocks.requireProjectMember.mockResolvedValue(ACTOR)
  mocks.resolveProjectId.mockResolvedValue({ ok: true, projectId: P1 })
})

describe('getWbsSpecLinks', () => {
  it('depends 배열 순서를 유지한다 — 조회 결과가 뒤섞여 와도, name·stage 는 그대로 전달되고 actual_pct 는 숫자로 변환된다', async () => {
    // actual_pct 는 postgres numeric 이라 실제로는 문자열로 온다('42.5') — Number() 변환이
    // 안 되면 화면의 진도율 표시가 문자열 그대로 새어나간다.
    const r1 = row({ id: 'id-1', external_ref: 'TSK-01', code: 'TSK-01', name: '작업1', stage: 'todo', actual_pct: null })
    const r2 = row({ id: 'id-2', external_ref: 'TSK-02', code: 'TSK-02', name: '작업2', stage: 'in_progress', actual_pct: '42.5' })
    const r3 = row({ id: 'id-3', external_ref: 'TSK-03', code: 'TSK-03', name: '작업3', stage: 'done', actual_pct: 100 })
    serverClient([
      { data: { depends: ['TSK-01', 'TSK-02', 'TSK-03'], external_ref: null } }, // 자기 행
      { data: [r3, r1, r2] }, // 선행 조회 — DB 가 뒤섞어 반환
    ])
    const result = await getWbsSpecLinks(W1)
    expect(result).not.toBeNull()
    expect(result!.predecessors).toEqual([
      { ref: 'TSK-01', itemId: 'id-1', code: 'TSK-01', name: '작업1', stage: 'todo', actualPct: null },
      { ref: 'TSK-02', itemId: 'id-2', code: 'TSK-02', name: '작업2', stage: 'in_progress', actualPct: 42.5 },
      { ref: 'TSK-03', itemId: 'id-3', code: 'TSK-03', name: '작업3', stage: 'done', actualPct: 100 },
    ])
    expect(result!.successors).toEqual([])
  })

  it('해석 안 되는 external_ref 는 빈 자리(itemId 등 전부 null)로 남는다 — 빠지지 않는다', async () => {
    const r1 = row({ id: 'id-1', external_ref: 'TSK-01', code: 'TSK-01' })
    serverClient([
      { data: { depends: ['TSK-01', 'TSK-99-missing'], external_ref: null } },
      { data: [r1] }, // TSK-99-missing 은 조회되지 않음
    ])
    const result = await getWbsSpecLinks(W1)
    expect(result).not.toBeNull()
    expect(result!.predecessors).toEqual([
      { ref: 'TSK-01', itemId: 'id-1', code: 'TSK-01', name: null, stage: null, actualPct: null },
      { ref: 'TSK-99-missing', itemId: null, code: null, name: null, stage: null, actualPct: null },
    ])
  })

  it('successors 는 code 오름차순으로 정렬된다(external_ref 없는 행은 id 로 ref 가 폴백)', async () => {
    const rA = row({ id: 'id-a', external_ref: 'mod/TSK-03', code: 'TSK-03' })
    const rB = row({ id: 'id-b', external_ref: 'mod/TSK-01', code: 'TSK-01' })
    const rC = row({ id: 'id-c', external_ref: null, code: 'TSK-02' }) // external_ref 없음 → ref 는 id 로 폴백
    const { methodLog } = serverClient([
      { data: { depends: [], external_ref: 'mod/self' } }, // 자기 행 — depends 없음
      { data: [rA, rB, rC] }, // 후행 조회 — code 뒤섞임
    ])
    const result = await getWbsSpecLinks(W1)
    expect(result).not.toBeNull()
    expect(result!.successors.map(s => s.code)).toEqual(['TSK-01', 'TSK-02', 'TSK-03'])
    expect(result!.successors.find(s => s.code === 'TSK-02')).toMatchObject({ ref: 'id-c', itemId: 'id-c' })
    expect(result!.predecessors).toEqual([])
    // 후행 조회는 depends 배열 포함(contains) 로 이뤄진다 — 선행의 in 과 다른 경로임을 확인.
    expect(methodLog[1]).toContain('contains')
    expect(methodLog[1]).not.toContain('in')
  })

  it('depends 가 빈 배열이면 선행 쿼리를 아예 하지 않고 predecessors 는 빈 배열', async () => {
    // external_ref 는 일부러 채워 후행 쿼리는 나가게 둔다 — 그래야 "쿼리가 총 몇 번 나갔는지"가
    // 아니라 "선행 쿼리 자체가 나갔는지"를 가릴 수 있다(후행까지 같이 스킵되면 구분이 안 된다).
    const { calls, methodLog } = serverClient([
      { data: { depends: [], external_ref: 'mod/self' } }, // 자기 행 — depends 없음
      { data: [] }, // 후행 조회(성공, 빈 결과)
    ])
    const result = await getWbsSpecLinks(W1)
    expect(result).not.toBeNull()
    expect(result!.predecessors).toEqual([])
    // sb.from('wbs_items') 호출은 자기 행 + 후행 2번뿐이고, 두 번째 호출은 .contains 를 쓴다
    // (선행 조회였다면 .in 을 썼을 것) — 선행 쿼리가 실제로 나가지 않았음을 이걸로 확인한다.
    expect(calls).toHaveLength(2)
    expect(methodLog[1]).toContain('contains')
    expect(methodLog[1]).not.toContain('in')
  })

  it('external_ref 가 null 이면 successors 는 빈 배열이다(후행 쿼리 자체가 나가지 않는다)', async () => {
    const r1 = row({ id: 'id-1', external_ref: 'TSK-01', code: 'TSK-01' })
    const { calls, methodLog } = serverClient([
      { data: { depends: ['TSK-01'], external_ref: null } },
      { data: [r1] }, // 선행 조회만
    ])
    const result = await getWbsSpecLinks(W1)
    expect(result).not.toBeNull()
    expect(result!.successors).toEqual([])
    expect(calls).toHaveLength(2) // 자기 행 + 선행. 후행 쿼리는 호출되지 않는다.
    expect(methodLog[1]).toContain('in')
    expect(methodLog[1]).not.toContain('contains')
  })

  it('권한 가드 실패 → null(조회 자체를 하지 않는다)', async () => {
    mocks.requireProjectMember.mockResolvedValue({ ok: false, error: '권한 없음' })
    const result = await getWbsSpecLinks(W1)
    expect(result).toBeNull()
    expect(mocks.createServerClient).not.toHaveBeenCalled()
  })

  it('선행 쿼리 error → null(빈 배열로 위장하지 않는다 — "선행 없음"으로 뒤집히면 시작 가능으로 오판된다)', async () => {
    serverClient([
      { data: { depends: ['TSK-01'], external_ref: null } },
      { data: null, error: { message: 'boom' } }, // 선행 조회 실패
    ])
    const result = await getWbsSpecLinks(W1)
    expect(result).toBeNull()
  })

  it('후행 쿼리 error → null(빈 배열로 위장하지 않는다)', async () => {
    serverClient([
      { data: { depends: [], external_ref: 'mod/self' } },
      { data: null, error: { message: 'boom' } }, // 후행 조회 실패
    ])
    const result = await getWbsSpecLinks(W1)
    expect(result).toBeNull()
  })
})
