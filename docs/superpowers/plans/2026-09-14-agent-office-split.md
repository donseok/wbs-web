# 에이전트 스튜디오 분리 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 프로젝트 허브(`/p/[id]/agents`)에서 좌석 층을 빼고, 프로젝트 스튜디오(`/p/[id]/agents/office`)를 좌석표 컴포넌트 재사용으로 신설하며, 두 페이지를 탭으로 잇는다.

**Architecture:** 도메인(`agentHub.ts`)에서 층 조립 제거 → 좌석표 로더·액션에 `projectId` 필터 → `SeatmapView` 에 `projectId` prop → 탭 컴포넌트 → 허브 화면 정리 → 스튜디오 페이지·라벨. 마이그레이션 없음. 사이드바 변경 없음.

**Tech Stack:** Next.js 15 App Router, React 19, Tailwind v4 토큰(`chip`, `text-ink*`, `bg-brand-weak`), CSS module(`seatmap.module.css`), Supabase service_role, vitest + jsdom.

**Spec:** `docs/superpowers/specs/2026-09-14-agent-office-split-design.md`

## Global Constraints

- 보안 가드는 fail-closed. `refreshSeatmap` 의 `projectId` 는 클라이언트 입력 — UUID 형식 검증 후 `isProjectMember` 검증(스펙 §3).
- 로더는 게이트를 통과했어도 `seatmapProjectIds(actor)` 와 교집합으로 다시 좁힌다(스펙 §3, §4-1).
- 조회 실패를 데이터 없음으로 위장하지 않는다 — 로더는 throw, 액션은 `{ ok:false }` + `console.error`.
- `'use server'` 파일의 export 는 전부 액션이 된다 — 가드 없는 본문을 액션 파일에 두지 않는다.
- 허브 컴포넌트(`src/components/agent-hub/*`) 소스에 `router.refresh` 문자열이 없어야 한다(기존 테스트).
- 상태 변형 display 유틸(`group-hover:flex` 등) 금지(CLAUDE.md CSS 규칙).
- `Sidebar.tsx`·`globals.css`·`layout.tsx` 는 건드리지 않는다.
- 커밋: 파일명 명시 stage, `git add -A` 금지, 한국어 메시지(왜 중심), 트레일러 `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>` / `Claude-Session: https://claude.ai/code/session_018V49dnv2npGi72Lj7RkeK4`. rtk 훅이 막으면 `/usr/bin/git`.
- 문구(정확히): 빈 스튜디오 "이 프로젝트에 위임된 주문이 없습니다. 위임·승인 탭에서 리프 항목에 위임을 켜면 좌석이 생깁니다.", 탭 '위임·승인' / '에이전트 스튜디오', 링크 '전체 스튜디오', 라벨 `nav.agents` ko '전체 스튜디오' en 'All studios', 액션 오류 '프로젝트 값이 잘못됐습니다.', 전역 제목 '에이전트 스튜디오 · 전체'.

---

### Task 1: 도메인 — 허브에서 층 조립 제거

**Files:**
- Modify: `src/lib/domain/agentHub.ts` (import 줄, `AgentHub` 인터페이스, `assembleAgentHub` 끝부분)
- Test: `tests/domain/agent-hub.test.ts`

**Interfaces:**
- Produces: `AgentHub` 에 `floor` 필드가 없다. `assembleAgentHub(rows, nowMs, viewer)` 시그니처는 그대로. `watchers` 는 `watchersFor(rows.watchers, projectId, nowMs)`.

- [ ] **Step 1: 실패하는 테스트로 바꾼다**

`tests/domain/agent-hub.test.ts` 에서 `it('floor: agent 태그 항목의 주문만 좌석이 된다. 없으면 null', …)` 블록을 통째로 삭제한다. 감시자 describe 의 첫 테스트를 아래로 바꾼다(`noFloor.floor` 단언 제거, 타입에 `floor` 가 없음을 고정):

```ts
  it('위임 주문이 0 이어도 이 프로젝트 감시자는 보이고, 결과에 floor 필드가 없다', () => {
    const noOrders = assembleAgentHub(rows({ orders: [], watchers: [w] }), NOW, VIEWER)
    expect(noOrders.watchers.map(x => x.agent)).toEqual(['hong/mbp'])
    expect('floor' in noOrders).toBe(false)
    const withOrders = assembleAgentHub(rows({ watchers: [w] }), NOW, VIEWER)
    expect(withOrders.watchers.map(x => x.agent)).toEqual(['hong/mbp'])
```

(이 `it` 의 나머지 줄은 그대로 둔다.)

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run tests/domain/agent-hub.test.ts`
Expected: FAIL — `'floor' in noOrders` 가 true.

- [ ] **Step 3: 구현**

`src/lib/domain/agentHub.ts`:
1. import 에서 `assembleSeatmap`, `type Floor`, `type ItemRow`, `type ReviewRow` 를 지운다(`AGENT_TAG`, `type OrderRow`, `type Watcher`, `type WatcherRow` 등 나머지는 유지).
2. `AgentHub` 인터페이스에서 아래 두 줄을 지운다.
```ts
  /** 이 프로젝트 층 — 좌석표 규칙(agent 태그 주문만). 없으면 null. */
  floor: Floor | null
```
3. `assembleAgentHub` 에서 `// 좌석 층 — …` 주석부터 `const floor = seatmap.floors.find(f => f.id === projectId) ?? null` 까지 블록을 지우고, return 을 아래로 바꾼다.
```ts
  return {
    projectId, projectName: rows.project?.name ?? '',
    registered: rows.agentProject !== null, enabled: rows.agentProject?.enabled === true,
    // 좌석 층은 /agents/office 가 그린다(2026-09-14 스튜디오 분리 스펙 §4-2). 감시자만 이 프로젝트 것으로.
    counters, watchers: watchersFor(rows.watchers, projectId, nowMs),
    rows: hubRows, queue, fetchedAt: new Date(nowMs).toISOString(),
    viewer: { isAdmin: viewer.isAdmin, memberIds },
  }
```

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run tests/domain/agent-hub.test.ts && npx eslint src/lib/domain/agentHub.ts`
Expected: PASS, lint 오류 0(안 쓰는 import 가 남으면 lint 가 잡는다).

- [ ] **Step 5: 커밋**

```bash
/usr/bin/git add src/lib/domain/agentHub.ts tests/domain/agent-hub.test.ts
/usr/bin/git commit -m "refactor(agent-hub): 허브 조립에서 좌석 층을 뺀다 — 층은 에이전트 스튜디오 라우트가 그린다"
```

---

### Task 2: 데이터 — 좌석표 로더에 프로젝트 필터와 스튜디오 로더

**Files:**
- Modify: `src/lib/data/agentSeatmap.ts` (`getSeatmap` 시그니처, 신규 `seatmapFloorIds`·`getProjectOffice`)
- Create: `tests/data/agent-seatmap-project.test.ts`

**Interfaces:**
- Consumes: `seatmapProjectIds(actor)` (`@/lib/authz/agentsAccess`, null=전체 / [] =없음).
- Produces:
  - `export interface SeatmapOptions { projectId?: string }`
  - `export function seatmapFloorIds(actor: Actor, projectId?: string): string[] | null`
  - `export async function getSeatmap(actor, nowMs = Date.now(), scope: SeatmapScope = 'mine', opts: SeatmapOptions = {}): Promise<Seatmap>`
  - `export interface ProjectOffice { projectName: string | null; seatmap: Seatmap }`
  - `export async function getProjectOffice(actor, projectId: string, nowMs = Date.now(), scope: SeatmapScope = 'mine'): Promise<ProjectOffice>`

- [ ] **Step 1: 실패하는 테스트 작성**

`tests/data/agent-seatmap-project.test.ts`:

```ts
// tests/data/agent-seatmap-project.test.ts
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Actor } from '@/lib/domain/authz'

const mocks = vi.hoisted(() => ({ createAdminClient: vi.fn() }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: mocks.createAdminClient }))
import { getProjectOffice, getSeatmap, seatmapFloorIds } from '@/lib/data/agentSeatmap'

const NOW = Date.parse('2026-09-14T09:00:00Z')
type Resp = { data?: unknown; error?: { message: string } | null }

/** 테이블별 응답 큐 + 호출 기록. tests/data/agent-seatmap.test.ts 의 헬퍼에 maybeSingle 과 auth 를 더한 것. */
function admin(queues: Record<string, Resp[]>, calls: Record<string, unknown[][]> = {}) {
  const client = {
    from: vi.fn((table: string) => {
      const resp = (queues[table] ?? []).shift() ?? { data: [], error: null }
      const b: Record<string, unknown> = {}
      for (const k of ['select', 'in', 'eq', 'or', 'gte', 'gt', 'order', 'limit', 'maybeSingle']) {
        b[k] = (...a: unknown[]) => { (calls[`${table}.${k}`] ??= []).push(a); return b }
      }
      b.then = (r: (v: unknown) => unknown) => Promise.resolve({ data: resp.data ?? null, error: resp.error ?? null }).then(r)
      return b
    }),
    auth: { admin: { getUserById: vi.fn(async () => ({ data: { user: { email: 'a@x.com' } }, error: null })) } },
  }
  mocks.createAdminClient.mockReturnValue(client)
  return client
}
const actor = (over: Partial<Actor>): Actor => ({
  userId: 'u1', isSuperuser: false, projectRoles: new Map(), rosterTeams: new Map(), teamCode: null, teamId: null, ...over,
} as Actor)
const SUPER = actor({ isSuperuser: true })
const MEMBER_P1 = actor({ projectRoles: new Map([['p1', 'member' as const]]) })

beforeEach(() => { vi.clearAllMocks() })

describe('seatmapFloorIds', () => {
  it('projectId 없으면 seatmapProjectIds 그대로(슈퍼유저 null, 멤버는 역할 목록)', () => {
    expect(seatmapFloorIds(SUPER)).toBeNull()
    expect(seatmapFloorIds(MEMBER_P1)).toEqual(['p1'])
  })
  it('projectId 있으면 접근 범위와 교집합 — 슈퍼유저 [id], 멤버는 목록에 있을 때만 [id], 없으면 []', () => {
    expect(seatmapFloorIds(SUPER, 'p2')).toEqual(['p2'])
    expect(seatmapFloorIds(MEMBER_P1, 'p1')).toEqual(['p1'])
    expect(seatmapFloorIds(MEMBER_P1, 'p2')).toEqual([])
  })
})

describe('getSeatmap({ projectId })', () => {
  it('범위 밖 프로젝트면 조회 없이 빈 좌석표', async () => {
    const a = admin({})
    const map = await getSeatmap(MEMBER_P1, NOW, 'all', { projectId: 'p2' })
    expect(map.floors).toEqual([])
    expect(a.from).not.toHaveBeenCalled()
  })
  it('슈퍼유저 + projectId 면 주문 조회에 그 프로젝트 필터 하나만 건다', async () => {
    const calls: Record<string, unknown[][]> = {}
    admin({ agent_work_orders: [{ data: [] }] }, calls)
    await getSeatmap(SUPER, NOW, 'all', { projectId: 'p1' })
    expect(calls['agent_work_orders.in']?.[0]).toEqual(['project_id', ['p1']])
  })
})

describe('getProjectOffice', () => {
  it('프로젝트 이름과 이 프로젝트 층 좌석표를 함께 돌려준다', async () => {
    const calls: Record<string, unknown[][]> = {}
    admin({ projects: [{ data: { id: 'p1', name: 'mes-base' } }], agent_work_orders: [{ data: [] }] }, calls)
    const office = await getProjectOffice(MEMBER_P1, 'p1', NOW, 'all')
    expect(office.projectName).toBe('mes-base')
    expect(office.seatmap.floors).toEqual([])
    expect(calls['projects.eq']?.[0]).toEqual(['id', 'p1'])
    expect(calls['projects.maybeSingle']).toHaveLength(1)
  })
  it('프로젝트가 없으면 projectName null(페이지가 notFound 로 보낸다)', async () => {
    admin({ projects: [{ data: null }], agent_work_orders: [{ data: [] }] })
    const office = await getProjectOffice(SUPER, 'p9', NOW, 'all')
    expect(office.projectName).toBeNull()
  })
  it('프로젝트 조회가 error 면 throw', async () => {
    admin({ projects: [{ data: null, error: { message: 'boom' } }], agent_work_orders: [{ data: [] }] })
    await expect(getProjectOffice(SUPER, 'p1', NOW, 'all')).rejects.toThrow(/boom/)
  })
})
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run tests/data/agent-seatmap-project.test.ts`
Expected: FAIL — `seatmapFloorIds`/`getProjectOffice` 가 export 되지 않음.

- [ ] **Step 3: 구현**

`src/lib/data/agentSeatmap.ts` 의 `getSeatmap` 을 아래로 교체하고 그 위에 `SeatmapOptions`·`seatmapFloorIds`, 아래에 `ProjectOffice`·`getProjectOffice` 를 추가한다.

```ts
export interface SeatmapOptions { projectId?: string }

/**
 * 층 목록 — projectId 가 있으면 접근 가능 범위와 교집합(슈퍼유저는 그대로 [projectId]).
 * 범위 밖이면 [] 라 조회가 일어나지 않는다. 페이지 게이트를 통과했어도 여기서 다시 좁힌다(fail-closed).
 */
export function seatmapFloorIds(actor: Actor, projectId?: string): string[] | null {
  const ids = seatmapProjectIds(actor)
  if (projectId === undefined) return ids
  if (ids === null) return [projectId]
  return ids.includes(projectId) ? [projectId] : []
}

export async function getSeatmap(actor: Actor, nowMs = Date.now(), scope: SeatmapScope = 'mine', opts: SeatmapOptions = {}): Promise<Seatmap> {
  const admin = createAdminClient()
  const projectIds = seatmapFloorIds(actor, opts.projectId)
  const rows = await fetchSeatmapRows(admin, projectIds, nowMs)
  if (scope === 'all') return assembleSeatmap(rows, nowMs)
  const memberIds = await fetchMyMemberIds(admin, { userId: actor.userId, userEmail: await viewerEmail(admin, actor.userId) }, projectIds)
  return assembleSeatmap(rows, nowMs, { mine: { userId: actor.userId, memberIds: new Set(memberIds) } })
}

export interface ProjectOffice { projectName: string | null; seatmap: Seatmap }

/** 프로젝트 스튜디오 — 이름 + 이 프로젝트 층 하나. 프로젝트가 없으면 projectName null(페이지가 notFound 로 보낸다). */
export async function getProjectOffice(actor: Actor, projectId: string, nowMs = Date.now(), scope: SeatmapScope = 'mine'): Promise<ProjectOffice> {
  const admin = createAdminClient()
  const [project, seatmap] = await Promise.all([
    admin.from('projects').select('id, name').eq('id', projectId).maybeSingle().then(r => {
      if (r.error) throw new Error(`[seatmap] 프로젝트 조회 실패: ${r.error.message}`)
      return r.data as { id: string; name: string } | null
    }),
    getSeatmap(actor, nowMs, scope, { projectId }),
  ])
  return { projectName: project?.name ?? null, seatmap }
}
```

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run tests/data/agent-seatmap-project.test.ts tests/data/agent-seatmap.test.ts`
Expected: PASS(기존 파일 포함).

- [ ] **Step 5: 커밋**

```bash
/usr/bin/git add src/lib/data/agentSeatmap.ts tests/data/agent-seatmap-project.test.ts
/usr/bin/git commit -m "feat(agent-office): 좌석표 로더에 프로젝트 필터와 스튜디오 로더 — 접근 범위와 교집합으로 층 하나만"
```

---

### Task 3: 액션 — `refreshSeatmap(scope, projectId?)`

**Files:**
- Modify: `src/app/actions/agentSeatmap.ts`
- Modify: `docs/superpowers/specs/2026-09-14-agent-office-split-design.md` §3 (정규식 문구를 구현과 맞춘다)
- Create: `tests/actions/agent-seatmap-refresh.test.ts`

**Interfaces:**
- Consumes: Task 2 의 `getSeatmap(actor, nowMs, scope, { projectId })`, `isProjectMember(actor, projectId)` (`@/lib/domain/authz`).
- Produces: `refreshSeatmap(scope: SeatmapScope = 'mine', projectId?: string)` — 반환 타입 그대로.

- [ ] **Step 1: 실패하는 테스트 작성**

```ts
// tests/actions/agent-seatmap-refresh.test.ts
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ getActorForView: vi.fn(), getSeatmap: vi.fn() }))
vi.mock('@/lib/authz', () => ({ getActorForView: mocks.getActorForView }))
vi.mock('@/lib/data/agentSeatmap', () => ({ getSeatmap: mocks.getSeatmap }))
import { refreshSeatmap } from '@/app/actions/agentSeatmap'

const P1 = '11111111-1111-4111-8111-111111111111'
const P2 = '22222222-2222-4222-8222-222222222222'
const MEMBER_P1 = { userId: 'u1', isSuperuser: false, projectRoles: new Map([[P1, 'member']]), rosterTeams: new Map(), teamCode: null, teamId: null }

beforeEach(() => { vi.clearAllMocks(); mocks.getActorForView.mockResolvedValue(MEMBER_P1); mocks.getSeatmap.mockResolvedValue({ floors: [] }) })

describe('refreshSeatmap — projectId', () => {
  it('내 프로젝트면 getSeatmap 에 { projectId } 옵션으로 넘긴다', async () => {
    const r = await refreshSeatmap('mine', P1)
    expect(r).toEqual({ ok: true, seatmap: { floors: [] } })
    expect(mocks.getSeatmap).toHaveBeenCalledWith(MEMBER_P1, expect.any(Number), 'mine', { projectId: P1 })
  })
  it('projectId 없으면 빈 옵션', async () => {
    await refreshSeatmap('all')
    expect(mocks.getSeatmap).toHaveBeenCalledWith(MEMBER_P1, expect.any(Number), 'all', {})
  })
  it('멤버가 아닌 프로젝트는 권한 없음 — 조회하지 않는다', async () => {
    expect(await refreshSeatmap('mine', P2)).toEqual({ ok: false, error: '권한이 없습니다.' })
    expect(mocks.getSeatmap).not.toHaveBeenCalled()
  })
  it('UUID 형식이 아니면 프로젝트 값 오류 — 조회하지 않는다', async () => {
    expect(await refreshSeatmap('mine', 'p1')).toEqual({ ok: false, error: '프로젝트 값이 잘못됐습니다.' })
    expect(await refreshSeatmap('mine', "' or 1=1" as string)).toEqual({ ok: false, error: '프로젝트 값이 잘못됐습니다.' })
    expect(mocks.getSeatmap).not.toHaveBeenCalled()
  })
  it('actor 없으면 권한 없음', async () => {
    mocks.getActorForView.mockResolvedValue(null)
    expect(await refreshSeatmap('mine', P1)).toEqual({ ok: false, error: '권한이 없습니다.' })
  })
  it('조회가 throw 하면 고정 문구로 실패', async () => {
    mocks.getSeatmap.mockRejectedValue(new Error('boom'))
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(await refreshSeatmap('mine', P1)).toEqual({ ok: false, error: '좌석표 재조회에 실패했습니다.' })
    spy.mockRestore()
  })
})
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run tests/actions/agent-seatmap-refresh.test.ts`
Expected: FAIL — 두 번째 인자를 무시해 `{ projectId }` 가 안 넘어가고 비멤버도 통과.

- [ ] **Step 3: 구현**

`src/app/actions/agentSeatmap.ts` 전체:

```ts
'use server'

import { getActorForView } from '@/lib/authz'
import { canViewAgents } from '@/lib/authz/agentsAccess'
import { isProjectMember } from '@/lib/domain/authz'
import { getSeatmap, type SeatmapOptions } from '@/lib/data/agentSeatmap'
import { SEATMAP_SCOPES, type Seatmap, type SeatmapScope } from '@/lib/domain/seatmap'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * 좌석표 재조회(30초 폴링). 페이지와 같은 게이트를 다시 검사한다 — 액션은 URL 로도 불릴 수 있다.
 * projectId 가 있으면 프로젝트 스튜디오(/p/[id]/agents/office): 형식 검증 → 멤버 검증 → 그 층 하나만.
 */
export async function refreshSeatmap(scope: SeatmapScope = 'mine', projectId?: string): Promise<{ ok: true; seatmap: Seatmap } | { ok: false; error: string }> {
  const actor = await getActorForView()
  if (!actor || !canViewAgents(actor)) return { ok: false, error: '권한이 없습니다.' }
  if (!SEATMAP_SCOPES.includes(scope)) return { ok: false, error: '범위 값이 잘못됐습니다.' } // 액션 인자는 클라이언트 입력이다
  const opts: SeatmapOptions = {}
  if (projectId !== undefined) {
    if (typeof projectId !== 'string' || !UUID_RE.test(projectId)) return { ok: false, error: '프로젝트 값이 잘못됐습니다.' }
    if (!isProjectMember(actor, projectId)) return { ok: false, error: '권한이 없습니다.' }
    opts.projectId = projectId
  }
  try {
    return { ok: true, seatmap: await getSeatmap(actor, Date.now(), scope, opts) }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error('[seatmap] 재조회 실패:', msg)
    return { ok: false, error: '좌석표 재조회에 실패했습니다.' }
  }
}
```

스펙 §3 의 `UUID 형식(`/^[0-9a-f-]{36}$/i`)` 을 `UUID 형식(8-4-4-4-12 hex)` 으로 고친다.

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run tests/actions/agent-seatmap-refresh.test.ts tests/components/agents-seatmap-view.test.tsx`
Expected: PASS.

- [ ] **Step 5: 커밋**

```bash
/usr/bin/git add src/app/actions/agentSeatmap.ts tests/actions/agent-seatmap-refresh.test.ts docs/superpowers/specs/2026-09-14-agent-office-split-design.md
/usr/bin/git commit -m "feat(agent-office): 좌석표 재조회 액션에 projectId — 형식·멤버 검증 뒤 그 층 하나만"
```

---

### Task 4: 컴포넌트 — `SeatmapView` 의 `projectId` 와 `AgentTabs`

**Files:**
- Modify: `src/components/agents/SeatmapView.tsx`, `src/components/agents/seatmap.module.css`
- Create: `src/components/agent-hub/AgentTabs.tsx`
- Test: `tests/components/agents-seatmap-view.test.tsx` (describe 추가), Create `tests/components/agent-tabs.test.tsx`

**Interfaces:**
- Consumes: Task 3 의 `refreshSeatmap(scope, projectId?)`.
- Produces: `SeatmapView({ initial, pollMs?, projectId? })`, `AgentTabs({ projectId })` — data attr `data-office-all-link`, `data-agent-tab="hub"|"office"`.

- [ ] **Step 1: 실패하는 테스트 작성**

`tests/components/agents-seatmap-view.test.tsx` 끝에 추가:

```tsx
describe('SeatmapView — 프로젝트 스튜디오(projectId)', () => {
  it('재조회에 projectId 를 넘기고 전체 스튜디오 링크가 보인다', async () => {
    refresh.mockResolvedValue({ ok: true, seatmap: map() })
    act(() => root.render(<SeatmapView initial={map()} pollMs={1000} projectId="p1" />))
    expect((host.querySelector('[data-office-all-link]') as HTMLAnchorElement).getAttribute('href')).toBe('/agents')
    await act(async () => { await vi.advanceTimersByTimeAsync(1000) })
    expect(refresh).toHaveBeenCalledWith('mine', 'p1')
  })
  it('projectId 없으면 링크가 없고 재조회는 범위만 넘긴다', async () => {
    refresh.mockResolvedValue({ ok: true, seatmap: map() })
    act(() => root.render(<SeatmapView initial={map()} pollMs={1000} />))
    expect(host.querySelector('[data-office-all-link]')).toBeNull()
    await act(async () => { await vi.advanceTimersByTimeAsync(1000) })
    expect(refresh).toHaveBeenCalledWith('mine')
  })
  it('층이 비면 범위와 무관하게 프로젝트 문구 하나', () => {
    act(() => root.render(<SeatmapView initial={map({ floors: [], attention: [], counters: { active: 0, standby: 0, idle: 0, offline: 0 }, scope: 'all' })} projectId="p1" />))
    expect(host.textContent).toContain('이 프로젝트에 위임된 주문이 없습니다. 위임·승인 탭에서 리프 항목에 위임을 켜면 좌석이 생깁니다.')
    expect(host.textContent).not.toContain('표시할 주문이 없습니다')
  })
})
```

`tests/components/agent-tabs.test.tsx`:

```tsx
// tests/components/agent-tabs.test.tsx
// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

const nav = vi.hoisted(() => ({ pathname: '/p/p1/agents' }))
vi.mock('next/navigation', () => ({ usePathname: () => nav.pathname }))
import { AgentTabs } from '@/components/agent-hub/AgentTabs'

let host: HTMLDivElement, root: Root
beforeEach(() => { host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host) })
afterEach(() => { act(() => root.unmount()); host.remove() })

const tab = (k: string) => host.querySelector(`[data-agent-tab="${k}"]`) as HTMLAnchorElement

describe('AgentTabs', () => {
  it('허브 경로에서는 위임·승인이 활성, 스튜디오 링크는 /agents/office', () => {
    nav.pathname = '/p/p1/agents'
    act(() => root.render(<AgentTabs projectId="p1" />))
    expect(tab('hub').getAttribute('href')).toBe('/p/p1/agents')
    expect(tab('hub').getAttribute('aria-current')).toBe('page')
    expect(tab('hub').textContent).toBe('위임·승인')
    expect(tab('office').getAttribute('href')).toBe('/p/p1/agents/office')
    expect(tab('office').getAttribute('aria-current')).toBeNull()
    expect(tab('office').textContent).toBe('에이전트 스튜디오')
  })
  it('스튜디오 경로에서는 에이전트 스튜디오가 활성', () => {
    nav.pathname = '/p/p1/agents/office'
    act(() => root.render(<AgentTabs projectId="p1" />))
    expect(tab('office').getAttribute('aria-current')).toBe('page')
    expect(tab('hub').getAttribute('aria-current')).toBeNull()
  })
})
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run tests/components/agents-seatmap-view.test.tsx tests/components/agent-tabs.test.tsx`
Expected: FAIL — `data-office-all-link` 없음, `AgentTabs` 모듈 없음.

- [ ] **Step 3: 구현**

`src/components/agents/SeatmapView.tsx` 변경점:

```tsx
import Link from 'next/link'   // 상단 import 에 추가
```

시그니처와 refresh:
```tsx
/** 좌석표 클라이언트 루트. 30초 폴링, 숨긴 탭은 쉬고 다시 보이면 즉시 1회. 실패는 마지막 데이터 유지 + 표시.
 *  projectId 가 있으면 프로젝트 스튜디오(/p/[id]/agents/office): 재조회를 그 층으로 좁히고 전체 스튜디오 링크를 보인다. */
export function SeatmapView({ initial, pollMs = 30_000, projectId }: { initial: Seatmap; pollMs?: number; projectId?: string }) {
```
```tsx
      const r = projectId === undefined ? await refreshSeatmap(scopeRef.current) : await refreshSeatmap(scopeRef.current, projectId)
```
`useCallback` 의 의존성 배열을 `[projectId]` 로 바꾼다.

헤더 오른쪽(`<div className={css.topRight}>` 첫 자식으로):
```tsx
          {projectId !== undefined && <Link href="/agents" data-office-all-link className={css.allLink}>전체 스튜디오</Link>}
```

빈 상태:
```tsx
          {map.floors.length === 0 && (projectId !== undefined
            ? <p className={css.doneNote}>이 프로젝트에 위임된 주문이 없습니다. 위임·승인 탭에서 리프 항목에 위임을 켜면 좌석이 생깁니다.</p>
            : map.scope === 'mine'
              ? <p className={css.doneNote}>배정된 에이전트 작업이 없습니다. 담당자가 나이거나 내 에이전트가 잡은 주문만 보입니다 — 다른 사람 것까지 보려면 ‘전체’를 누르세요.</p>
              : <p className={css.doneNote}>표시할 주문이 없습니다. 에이전트 위임(agent 태그) 항목의 주문만 보이며, 내가 속한 프로젝트에 그런 주문이 생기면 여기 층이 생깁니다.</p>)}
```

`src/components/agents/seatmap.module.css` 의 `.scope` 규칙 앞에:
```css
.allLink { font-size: 12px; color: var(--sm-band-ink); text-decoration: underline; text-underline-offset: 2px; }
.allLink:hover { opacity: .85; }
```

`src/components/agent-hub/AgentTabs.tsx`:
```tsx
'use client'
// 허브(위임·승인)와 에이전트 스튜디오를 오가는 탭 — 두 페이지의 ProjectPageShell pinned 슬롯에 얹는다(컴팩트 뷰포트에서도 남는다).
// 사이드바 항목은 '에이전트' 하나(2026-09-14 스튜디오 분리 스펙 §6-1). 활성 판정은 경로 완전 일치.
import Link from 'next/link'
import { usePathname } from 'next/navigation'

export function AgentTabs({ projectId }: { projectId: string }) {
  const pathname = usePathname()
  const base = `/p/${projectId}/agents`
  const tabs = [
    { key: 'hub', href: base, label: '위임·승인' },
    { key: 'office', href: `${base}/office`, label: '에이전트 스튜디오' },
  ] as const
  return (
    <nav aria-label="에이전트 화면" className="flex items-center gap-2">
      {tabs.map(t => {
        const active = pathname === t.href
        return (
          <Link key={t.key} href={t.href} data-agent-tab={t.key} aria-current={active ? 'page' : undefined}
            className={`chip ${active ? 'bg-brand-weak text-brand' : 'text-ink-muted hover:text-ink'}`}>{t.label}</Link>
        )
      })}
    </nav>
  )
}
```

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run tests/components/agents-seatmap-view.test.tsx tests/components/agent-tabs.test.tsx && npx eslint src/components/agents/SeatmapView.tsx src/components/agent-hub/AgentTabs.tsx`
Expected: PASS, lint 0.

- [ ] **Step 5: 커밋**

```bash
/usr/bin/git add src/components/agents/SeatmapView.tsx src/components/agents/seatmap.module.css src/components/agent-hub/AgentTabs.tsx tests/components/agents-seatmap-view.test.tsx tests/components/agent-tabs.test.tsx
/usr/bin/git commit -m "feat(agent-office): 좌석표 화면에 projectId 와 전체 스튜디오 링크, 허브·스튜디오 탭 컴포넌트"
```

---

### Task 5: 허브 화면 정리 — 층 제거, 상태 줄 링크 이동, 탭 부착

**Files:**
- Modify: `src/components/agent-hub/AgentHubView.tsx`, `src/components/agent-hub/HubStatusBar.tsx`, `src/app/(app)/p/[projectId]/agents/page.tsx`
- Test: `tests/components/agent-hub-view.test.tsx`, `tests/components/agent-hub-queue.test.tsx`

**Interfaces:**
- Consumes: Task 1 의 `AgentHub`(floor 없음), Task 4 의 `AgentTabs`.

- [ ] **Step 1: 실패하는 테스트로 바꾼다**

`tests/components/agent-hub-view.test.tsx`:
- 픽스처 `hub()` 에서 `floor: null,` 을 지운다.
- `it('층이 있으면 FloorCard 와 상세 패널이 그려진다', …)` 블록을 아래로 교체:
```tsx
  it('좌석 층 섹션이 없다 — 층은 /agents/office 가 그린다(스튜디오 분리 스펙 §6-2)', () => {
    act(() => root.render(<AgentHubView initial={hub()} />))
    expect(host.querySelector('section[aria-label="좌석"]')).toBeNull()
    expect(host.querySelector('[data-panel]')).toBeNull()
  })
```
- 첫 테스트의 `expect(host.textContent).toContain('위임된 주문이 아직 없습니다')` 줄을 지운다.

`tests/components/agent-hub-queue.test.tsx` 의 HubStatusBar describe 에서
`expect((host.querySelector('[data-hub-seatmap-link]') as HTMLAnchorElement).getAttribute('href')).toBe('/agents')` 를
`expect(host.querySelector('[data-hub-seatmap-link]')).toBeNull() // 전체 스튜디오 링크는 스튜디오 탭으로 옮겼다` 로 바꾼다.

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run tests/components/agent-hub-view.test.tsx tests/components/agent-hub-queue.test.tsx`
Expected: FAIL — 좌석 섹션·링크가 아직 있다(타입 오류로 컴파일 실패해도 FAIL 로 본다).

- [ ] **Step 3: 구현**

`src/components/agent-hub/AgentHubView.tsx` 전체:

```tsx
'use client'
// 에이전트 허브 클라이언트 루트 — 상태 줄 → 위임 표 → 승인 큐. 폴링 없음(조작 화면).
// 좌석 층은 /agents/office 가 그린다(2026-09-14 스튜디오 분리). 변경 뒤 refreshAgentHub 1회, 탭이 다시 보이면 1회.
// 실패는 마지막 데이터 유지 + 상단 표시. 페이지 전체 refresh 금지(허브 스펙 §7).
import { useCallback, useEffect, useRef, useState } from 'react'
import type { AgentHub } from '@/lib/domain/agentHub'
import { refreshAgentHub } from '@/app/actions/agentHub'
import { HubStatusBar } from './HubStatusBar'
import { DelegationTable, type HubFilter } from './DelegationTable'
import { ApprovalQueue } from './ApprovalQueue'

const hhmmss = (iso: string) => new Date(iso).toLocaleTimeString('ko-KR', { hour12: false, timeZone: 'Asia/Seoul' })

export function AgentHubView({ initial }: { initial: AgentHub }) {
  const [hub, setHub] = useState(initial)
  const [error, setError] = useState<{ at: string; message: string } | null>(null)
  // 관리자는 프로젝트 전체를 관리하니 all, 멤버는 자기 담당부터.
  const [filter, setFilter] = useState<HubFilter>(initial.viewer.isAdmin ? 'all' : 'mine')
  const [nowMs, setNowMs] = useState(() => Date.parse(initial.fetchedAt))
  const inflight = useRef(false)

  const refresh = useCallback(async () => {
    if (inflight.current) return
    inflight.current = true
    try {
      const r = await refreshAgentHub(hub.projectId)
      if (r.ok) { setHub(r.hub); setNowMs(Date.parse(r.hub.fetchedAt)); setError(null) }
      else setError({ at: new Date().toISOString(), message: r.error })
    } catch (e) {
      setError({ at: new Date().toISOString(), message: e instanceof Error ? e.message : String(e) })
    } finally { inflight.current = false }
  }, [hub.projectId])

  useEffect(() => {
    const onVis = () => { if (document.visibilityState === 'visible') void refresh() }
    document.addEventListener('visibilitychange', onVis)
    return () => document.removeEventListener('visibilitychange', onVis)
  }, [refresh])
  // 경과 시간 표시만 1초마다 — 데이터는 건드리지 않는다.
  useEffect(() => { const t = window.setInterval(() => setNowMs(n => n + 1000), 1000); return () => window.clearInterval(t) }, [])

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2 text-xs text-ink-muted">
        <span data-hub-stamp className={error ? 'text-accent-warning' : ''}>
          {error ? `갱신 실패 ${hhmmss(error.at)} · ${error.message}` : `갱신 ${hhmmss(hub.fetchedAt)}`}
        </span>
        <button type="button" data-hub-refresh className="btn btn-ghost h-8 px-2 text-xs" onClick={() => { void refresh() }}>새로고침</button>
      </div>
      <HubStatusBar projectId={hub.projectId} registered={hub.registered} enabled={hub.enabled} counters={hub.counters}
        watchers={hub.watchers} isAdmin={hub.viewer.isAdmin} onChanged={refresh} />
      <DelegationTable rows={hub.rows} projectId={hub.projectId} isAdmin={hub.viewer.isAdmin} filter={filter} onFilter={setFilter}
        nowMs={nowMs} onChanged={refresh} />
      <ApprovalQueue queue={hub.queue} isAdmin={hub.viewer.isAdmin} onChanged={refresh} />
    </div>
  )
}
```

`src/components/agent-hub/HubStatusBar.tsx`: 머리 주석 두 줄을
`// 허브 상단 상태 줄 — 켜짐/중지(관리자 토글), 카운터 4개, 감시 중 에이전트, 내 토큰 링크. 전체 스튜디오 링크는 스튜디오 탭에 있다(2026-09-14).`
로 바꾸고, `<Link href="/agents" data-hub-seatmap-link …>전체 스튜디오</Link>`(또는 '전체 좌석표') 줄을 지운다.

`src/app/(app)/p/[projectId]/agents/page.tsx`: import 에 `import { AgentTabs } from '@/components/agent-hub/AgentTabs'` 추가, 머리 주석의 "좌석 층을 한 화면에" 를 "승인을 한 화면에(좌석 층은 /agents/office)" 로, 렌더를 아래로:
```tsx
    <ProjectPageShell hero={<PageHero eyebrow="AGENTS" title={`${hub.projectName} 에이전트`} description="위임과 승인을 한곳에서 합니다." />}
      pinned={<AgentTabs projectId={projectId} />}>
      <AgentHubView initial={hub} />
    </ProjectPageShell>
```

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run tests/components/agent-hub-view.test.tsx tests/components/agent-hub-queue.test.tsx tests/components/agent-hub-table.test.tsx && npx eslint src/components/agent-hub "src/app/(app)/p/[projectId]/agents/page.tsx"`
Expected: PASS, lint 0(`FloorCard`·`DetailPanel`·`seatCss`·`useMemo` import 가 남으면 잡힌다).

- [ ] **Step 5: 커밋**

```bash
/usr/bin/git add src/components/agent-hub/AgentHubView.tsx src/components/agent-hub/HubStatusBar.tsx "src/app/(app)/p/[projectId]/agents/page.tsx" tests/components/agent-hub-view.test.tsx tests/components/agent-hub-queue.test.tsx
/usr/bin/git commit -m "refactor(agent-hub): 허브 화면에서 좌석 층을 빼고 탭을 단다 — 조작 화면은 폴링 없이 조작만"
```

---

### Task 6: 스튜디오 페이지·전역 제목·라벨·회귀 테스트

**Files:**
- Create: `src/app/(app)/p/[projectId]/agents/office/page.tsx`
- Modify: `src/app/(app)/agents/page.tsx`, `src/lib/i18n/dict/common.ts`, `src/lib/i18n/dict/common.en.ts`, `src/lib/domain/usageMenu.ts`, `docs/superpowers/specs/2026-09-14-agent-hub-design.md` §6-5
- Test: `tests/domain/agents-access.test.ts`, `tests/domain/usage-menu.test.ts`, `tests/ui/sidebar-project-context.test.tsx`

**Interfaces:**
- Consumes: Task 2 `getProjectOffice`, Task 4 `AgentTabs`·`SeatmapView projectId`.

- [ ] **Step 1: 실패하는 테스트로 바꾼다**

`tests/domain/agents-access.test.ts` 의 nav 사전 키 테스트:
```ts
    expect(KO['nav.agents']).toBe('전체 스튜디오'); expect(EN['nav.agents']).toBe('All studios')
```

`tests/domain/usage-menu.test.ts` 의 `resolveMenuKey` it.each 표에 두 줄 추가:
```ts
    [`/p/${PID}/agents`, 'agents'],
    [`/p/${PID}/agents/office`, 'agents'],
    ['/agents', 'seatmap'],
```
(이미 있는 줄이면 중복 추가하지 않는다.)

`tests/ui/sidebar-project-context.test.tsx` 의 `'전역 좌석표(/agents)는 사이드바에 없다 …'` 테스트 뒤에:
```tsx
  it('에이전트 스튜디오(/p/p1/agents/office)에서도 사이드바 활성 항목은 에이전트 하나다', async () => {
    await renderAt('/p/p1/agents/office')
    const link = container.querySelector<HTMLAnchorElement>('a[href="/p/p1/agents"]')
    expect(link?.className).toContain('side-link-active')
    expect(link?.getAttribute('aria-current')).toBe('page')
    expect(container.querySelector('a[href="/agents"]')).toBeNull()
  })
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run tests/domain/agents-access.test.ts tests/domain/usage-menu.test.ts tests/ui/sidebar-project-context.test.tsx`
Expected: agents-access FAIL(라벨). 나머지 둘은 PASS 여도 된다(회귀 고정용) — 사이드바가 FAIL 이면 `aria-current` 부여 규칙을 확인해 단언을 `side-link-active` 만으로 줄인다.

- [ ] **Step 3: 구현**

`src/app/(app)/p/[projectId]/agents/office/page.tsx`:
```tsx
import { notFound, redirect } from 'next/navigation'
import { getActorForView } from '@/lib/authz'
import { isProjectMember } from '@/lib/domain/authz'
import { getProjectOffice } from '@/lib/data/agentSeatmap'
import { PageHero } from '@/components/ui/PageHero'
import { ProjectPageShell } from '@/components/app/ProjectPageShell'
import { AgentTabs } from '@/components/agent-hub/AgentTabs'
import { SeatmapView } from '@/components/agents/SeatmapView'

export const dynamic = 'force-dynamic' // 좌석은 항상 최신이어야 한다

/**
 * 프로젝트 스튜디오 — 이 프로젝트 층 하나를 전역 좌석표와 같은 규칙·폴링으로 그린다(2026-09-14 스튜디오 분리 스펙 §6-3).
 * 멤버 이상만 — 허브와 같은 게이트. 로더가 접근 범위와 다시 교집합을 낸다.
 */
export default async function ProjectOfficePage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params
  const actor = await getActorForView()
  if (!actor || !isProjectMember(actor, projectId)) redirect(`/p/${projectId}/dashboard`)
  // 조회 실패는 throw → Next 의 error 경계가 받는다. 빈 스튜디오로 위장하지 않는다.
  const office = await getProjectOffice(actor, projectId)
  if (office.projectName === null) notFound()
  return (
    <ProjectPageShell
      hero={<PageHero eyebrow="AGENTS" title={`${office.projectName} 에이전트 스튜디오`} description="이 프로젝트 층의 좌석을 30초마다 갱신합니다." />}
      pinned={<AgentTabs projectId={projectId} />}>
      <SeatmapView initial={office.seatmap} projectId={projectId} />
    </ProjectPageShell>
  )
}
```

`src/app/(app)/agents/page.tsx`: 주석을 `// 슈퍼유저 또는 역할이 있는 프로젝트 1개 이상 — 판정은 canViewAgents 한 곳. 입구는 프로젝트 스튜디오 탭의 "전체 스튜디오" 링크(사이드바 항목 없음).` 로, `<PageHero eyebrow="OPERATIONS" title="에이전트 스튜디오 · 전체" />` 로.

`src/lib/i18n/dict/common.ts`: `'nav.agents': '전체 스튜디오',` / `common.en.ts`: `'nav.agents': 'All studios',`.
`src/lib/domain/usageMenu.ts`: `{ key: 'seatmap', labelKey: 'nav.agents', fallback: '전체 스튜디오' },`.

`docs/superpowers/specs/2026-09-14-agent-hub-design.md` `### 6-5. 좌석 층` 바로 아래에 한 줄:
`> 2026-09-14 대체: 좌석 층은 허브에서 빠지고 `/p/[projectId]/agents/office` 가 그린다 — `2026-09-14-agent-office-split-design.md`.`

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run tests/domain/agents-access.test.ts tests/domain/usage-menu.test.ts tests/ui/sidebar-project-context.test.tsx && npx eslint "src/app/(app)/p/[projectId]/agents/office/page.tsx" "src/app/(app)/agents/page.tsx"`
Expected: PASS, lint 0.

- [ ] **Step 5: 커밋**

```bash
/usr/bin/git add "src/app/(app)/p/[projectId]/agents/office/page.tsx" "src/app/(app)/agents/page.tsx" src/lib/i18n/dict/common.ts src/lib/i18n/dict/common.en.ts src/lib/domain/usageMenu.ts docs/superpowers/specs/2026-09-14-agent-hub-design.md tests/domain/agents-access.test.ts tests/domain/usage-menu.test.ts tests/ui/sidebar-project-context.test.tsx
/usr/bin/git commit -m "feat(agent-office): 프로젝트 스튜디오 페이지 — 허브 탭에서 열고, 전역은 전체 스튜디오로 이름을 맞춘다"
```

---

### Task 7: 전체 검증

**Files:** 없음(검증만). 문제가 나오면 해당 Task 의 파일을 고치고 별도 fix 커밋.

- [ ] **Step 1: 전체 테스트**

Run: `npx vitest run`
Expected: 전부 PASS.

- [ ] **Step 2: 타입·린트**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep "error TS" | grep -v "^tests/report\|^tests/agent\|authz-gate-global" ; npx eslint src/components/agents src/components/agent-hub src/lib/data/agentSeatmap.ts src/app/actions/agentSeatmap.ts`
Expected: 새 tsc 오류 0(기존 19건은 `tests/report`·`tests/agent`·`authz-gate-global` 뿐), lint 0.

- [ ] **Step 3: 소스 검사**

Run: `grep -rn "floor" src/components/agent-hub src/lib/domain/agentHub.ts; grep -rn "data-hub-seatmap-link" src`
Expected: 출력 없음.
