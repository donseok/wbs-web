# 에이전트 작업 루프(Agent Work Loop) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 외부 Claude Code CLI 하네스가 WBS 리프 작업을 pull+claim 으로 가져가 구현하고, 보고로 실적이 반영되며 완료는 사람이 승인하는 루프를 D'Flow 에 추가한다.

**Architecture:** 작업 원장 분리형 — 신규 테이블 3개(`agent_projects`/`agent_work_orders`/`agent_work_reports`) + 신규 API(`/api/v1/agent/*`) + 신규 화면(`/agent-ops`)만 추가한다. WBS 반영은 기존 실적 기록과 같은 3종 세트(`actual_pct` 갱신 + `change_logs` insert + `recordProgressSnapshot`)를 수행하고, 승인 경로는 기존 `updateActual` 서버 액션을 호출자로 재사용한다.

**Tech Stack:** Next.js 15 App Router · Supabase(service_role, Management API 적용) · vitest · 기존 회의록 외부 API 패턴(`src/lib/minutes/externalApi.ts`) 재사용

**정본 스펙:** `docs/superpowers/specs/2026-07-31-agent-work-loop-design.md`

## Global Constraints

- **기존 테이블 ALTER 금지.** 마이그레이션은 CREATE(+RLS)만. ALTER 가 한 줄이라도 들어가면 스펙 §1.1 위반.
- **마이그레이션과 코드는 다른 커밋** (pre-push G1). `supabase/migrations/*` 는 항상 단독 커밋 + `_rollback.sql` 동반.
- **`git add -A` 금지** — 파일명 명시 stage.
- **사이드바 메뉴 추가 금지** (1차 범위 제외, 스펙 §5). `src/components/app/*` 는 이 계획에서 절대 건드리지 않는다.
- **D-CUBE 미등록 유지** — 어떤 태스크도 `agent_projects` 에 D-CUBE(7a1c6034-a647-4673-ae85-d0b6daa2f6f3)를 넣지 않는다. 런타임 검증은 전용 샘플 프로젝트에서만.
- **에러 3원칙**: 조회 실패 표시=로깅 · 쓰기 선행조회 실패 중단 · 보안 가드 fail-closed.
- env 이름: `AGENT_API_ENABLED`, `AGENT_API_SECRET` (회의록 API 의 `MINUTES_API_*` 짝).
- 상태 enum: `ready → claimed → reported → approved / cancelled` (**`rejected` 상태 없음** — 반려는 보고 행 기록 + `claimed` 복귀).
- percent 규칙: `progress` = 0~99 (100 은 400), `completion` = 100 고정.
- 권한: 발행·승인·반려·회수·취소 = 프로젝트 관리자 이상(`requireProjectAdmin`), 프로젝트 등록 = 슈퍼유저(`requireSuperuser`), 에이전트 API 쓰기 = `user_email` 계정이 해당 프로젝트 멤버 이상.
- 커밋 메시지는 한국어 "왜" 중심 + `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>` 트레일러.

---

### Task 1: 마이그레이션 0057 — 신규 테이블 3개 + 조회 RLS

**Files:**
- Create: `supabase/migrations/0057_agent_work_loop.sql`
- Create: `supabase/migrations/0057_agent_work_loop_rollback.sql`

**Interfaces:**
- Produces: 테이블 `agent_projects(project_id pk, enabled, note, created_by, created_at, updated_at)` · `agent_work_orders(id, project_id, wbs_item_id, status, instructions, priority, claimed_by, claimed_at, created_by, created_at, updated_at)` · `agent_work_reports(id, work_order_id, kind, percent, summary, links, agent, actor_user_id, applied_to_wbs, review_action, reviewed_by, reviewed_at, review_note, created_at)`
- 이후 모든 태스크가 이 컬럼명을 그대로 쓴다.

- [ ] **Step 1: 마이그레이션 SQL 작성**

`supabase/migrations/0057_agent_work_loop.sql`:

```sql
-- 에이전트 작업 루프 (스펙: docs/superpowers/specs/2026-07-31-agent-work-loop-design.md)
-- 추가 전용 — 기존 테이블 ALTER 0건이 D-CUBE 리스크 0 보장의 1층이다(스펙 §1.1).

create table agent_projects (
  project_id uuid primary key references projects(id) on delete cascade,
  enabled boolean not null default true,
  note text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table agent_work_orders (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  -- 항목 삭제 후에도 원장은 감사 기록으로 남긴다(스펙 §2.2) — cascade 가 아니라 set null.
  wbs_item_id uuid references wbs_items(id) on delete set null,
  status text not null default 'ready'
    check (status in ('ready','claimed','reported','approved','cancelled')),
  instructions text not null default '',
  priority int not null default 0,
  claimed_by text,
  claimed_at timestamptz,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index agent_work_orders_project_status_idx on agent_work_orders (project_id, status);
create index agent_work_orders_item_idx on agent_work_orders (wbs_item_id);

create table agent_work_reports (
  id uuid primary key default gen_random_uuid(),
  work_order_id uuid not null references agent_work_orders(id) on delete cascade,
  kind text not null check (kind in ('progress','completion')),
  percent int not null check (percent between 0 and 100),
  summary text not null,
  links jsonb not null default '[]'::jsonb,
  agent text not null,
  actor_user_id uuid references auth.users(id),
  applied_to_wbs boolean not null default false,
  review_action text check (review_action in ('approve','reject')),
  reviewed_by uuid references auth.users(id),
  reviewed_at timestamptz,
  review_note text,
  created_at timestamptz not null default now()
);
create index agent_work_reports_order_idx on agent_work_reports (work_order_id);

-- RLS: 조회는 프로젝트 구성원(0053 헬퍼 재사용). 쓰기 정책은 만들지 않는다 —
-- 쓰기는 전부 service_role 경유이며 서버 가드가 유일한 관문이다(스펙 §2.4).
alter table agent_projects enable row level security;
alter table agent_work_orders enable row level security;
alter table agent_work_reports enable row level security;

create policy read_agent_projects on agent_projects for select to authenticated
  using (public.is_project_member(project_id));
create policy read_agent_work_orders on agent_work_orders for select to authenticated
  using (public.is_project_member(project_id));
create policy read_agent_work_reports on agent_work_reports for select to authenticated
  using (exists (
    select 1 from agent_work_orders o
    where o.id = agent_work_reports.work_order_id
      and public.is_project_member(o.project_id)
  ));
```

- [ ] **Step 2: 롤백 SQL 작성**

`supabase/migrations/0057_agent_work_loop_rollback.sql`:

```sql
-- 0057 롤백 — 신규 테이블만 제거한다. 기존 테이블은 0057 이 건드리지 않았으므로 복원 대상 없음.
drop table if exists agent_work_reports;
drop table if exists agent_work_orders;
drop table if exists agent_projects;
```

- [ ] **Step 3: 마이그레이션 규약 테스트 실행**

Run: `npx vitest run tests/migrations`
Expected: PASS (롤백 파일 짝 규약 등 기존 검사 통과. 실패하면 파일명 규약을 검사 출력대로 고친다)

- [ ] **Step 4: 커밋 (마이그레이션 단독 — G1)**

```bash
git add supabase/migrations/0057_agent_work_loop.sql supabase/migrations/0057_agent_work_loop_rollback.sql
git commit -m "db: 에이전트 작업 루프 테이블 3개 — 추가 전용, 쓰기 RLS 없음(서버 관문)

기존 테이블 ALTER 0건. 조회만 0053 is_project_member 로 열고
쓰기는 service_role 전용으로 남겨 회의록 계열과 같은 구조를 따른다.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

(적용은 Task 11 에서 Management API 로 한다 — 지금은 리포에만 존재.)

---

### Task 2: 도메인 상태 머신 (`src/lib/domain/agentWork.ts`)

**Files:**
- Create: `src/lib/domain/agentWork.ts`
- Test: `tests/domain/agent-work.test.ts`

**Interfaces:**
- Produces:
  - `type AgentOrderStatus = 'ready' | 'claimed' | 'reported' | 'approved' | 'cancelled'`
  - `type AgentReportKind = 'progress' | 'completion'`
  - `canTransition(from: AgentOrderStatus, to: AgentOrderStatus): boolean`
  - `validateReport(kind: AgentReportKind, percent: number): string | null` (null=유효, 문자열=거절 사유)
  - `isClaimStale(claimedAt: string | null, now?: Date): boolean`
  - `AGENT_CLAIM_STALE_HOURS = 24`, `AGENT_NAME_RE`(에이전트 이름 검증), `AGENT_LINKS_MAX = 20`

- [ ] **Step 1: 실패하는 테스트 작성**

`tests/domain/agent-work.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import {
  AGENT_CLAIM_STALE_HOURS, AGENT_NAME_RE, canTransition, isClaimStale, validateReport,
} from '@/lib/domain/agentWork'

describe('agentWork 상태 머신', () => {
  it('허용 전이 전수', () => {
    expect(canTransition('ready', 'claimed')).toBe(true)
    expect(canTransition('ready', 'cancelled')).toBe(true)
    expect(canTransition('claimed', 'ready')).toBe(true)      // release/회수
    expect(canTransition('claimed', 'reported')).toBe(true)
    expect(canTransition('claimed', 'cancelled')).toBe(true)
    expect(canTransition('reported', 'claimed')).toBe(true)   // 반려 복귀
    expect(canTransition('reported', 'approved')).toBe(true)
    expect(canTransition('reported', 'cancelled')).toBe(true)
  })
  it('금지 전이 — 종료 상태에서 못 나오고, 건너뛰기 불가', () => {
    expect(canTransition('approved', 'ready')).toBe(false)
    expect(canTransition('cancelled', 'claimed')).toBe(false)
    expect(canTransition('ready', 'reported')).toBe(false)    // claim 없이 보고 불가
    expect(canTransition('ready', 'approved')).toBe(false)
    expect(canTransition('claimed', 'approved')).toBe(false)  // 보고 없이 승인 불가
  })
  it('progress 는 0~99 만 — 100 은 완료 요청 경로로 강제', () => {
    expect(validateReport('progress', 0)).toBeNull()
    expect(validateReport('progress', 99)).toBeNull()
    expect(validateReport('progress', 100)).toMatch(/completion/)
    expect(validateReport('progress', -1)).not.toBeNull()
    expect(validateReport('progress', 50.5)).not.toBeNull()   // 정수만
  })
  it('completion 은 100 고정', () => {
    expect(validateReport('completion', 100)).toBeNull()
    expect(validateReport('completion', 99)).not.toBeNull()
  })
  it('좀비 점유 판정 — 24h 경계', () => {
    const now = new Date('2026-08-01T12:00:00Z')
    const fresh = new Date(now.getTime() - (AGENT_CLAIM_STALE_HOURS - 1) * 3600_000).toISOString()
    const stale = new Date(now.getTime() - (AGENT_CLAIM_STALE_HOURS + 1) * 3600_000).toISOString()
    expect(isClaimStale(fresh, now)).toBe(false)
    expect(isClaimStale(stale, now)).toBe(true)
    expect(isClaimStale(null, now)).toBe(false)
  })
  it('에이전트 이름 형식', () => {
    expect(AGENT_NAME_RE.test('claude-cli.jerry_1')).toBe(true)
    expect(AGENT_NAME_RE.test('')).toBe(false)
    expect(AGENT_NAME_RE.test('이름에 공백')).toBe(false)
    expect(AGENT_NAME_RE.test('x'.repeat(65))).toBe(false)
  })
})
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run tests/domain/agent-work.test.ts`
Expected: FAIL — `Cannot find module '@/lib/domain/agentWork'`

- [ ] **Step 3: 구현**

`src/lib/domain/agentWork.ts`:

```ts
/**
 * 에이전트 작업 루프 상태 머신 — 스펙 §2.2·§4.
 * 순수 함수만 둔다(도메인 계층 관례) — DB·요청 컨텍스트를 모른다.
 */
export type AgentOrderStatus = 'ready' | 'claimed' | 'reported' | 'approved' | 'cancelled'
export type AgentReportKind = 'progress' | 'completion'

export const AGENT_CLAIM_STALE_HOURS = 24
/** 식별 라벨일 뿐 권한 주체가 아니다(권한은 user_email 계정) — 형식만 좁게 잡는다. */
export const AGENT_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/
export const AGENT_LINKS_MAX = 20

const TRANSITIONS: Record<AgentOrderStatus, readonly AgentOrderStatus[]> = {
  ready: ['claimed', 'cancelled'],
  claimed: ['ready', 'reported', 'cancelled'],
  reported: ['claimed', 'approved', 'cancelled'],
  approved: [],
  cancelled: [],
}

export function canTransition(from: AgentOrderStatus, to: AgentOrderStatus): boolean {
  return TRANSITIONS[from].includes(to)
}

/** null = 유효. 문자열 = 400 사유. progress 100 을 막아 완료를 승인 경로로 강제한다(스펙 §4-1). */
export function validateReport(kind: AgentReportKind, percent: number): string | null {
  if (!Number.isInteger(percent)) return 'percent는 정수여야 합니다.'
  if (kind === 'progress') {
    if (percent < 0 || percent > 99) return 'progress percent는 0~99입니다. 완료는 kind=completion으로 요청하세요.'
    return null
  }
  if (percent !== 100) return 'completion percent는 100이어야 합니다.'
  return null
}

export function isClaimStale(claimedAt: string | null, now: Date = new Date()): boolean {
  if (!claimedAt) return false
  const t = Date.parse(claimedAt)
  if (Number.isNaN(t)) return false
  return now.getTime() - t > AGENT_CLAIM_STALE_HOURS * 3600_000
}
```

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run tests/domain/agent-work.test.ts`
Expected: PASS (6 tests)

- [ ] **Step 5: 커밋**

```bash
git add src/lib/domain/agentWork.ts tests/domain/agent-work.test.ts
git commit -m "feat(agent): 작업 원장 상태 머신 — 전이표·percent 경계·좀비 판정

progress 100 을 도메인에서 막아 완료가 반드시 사람 승인 경로를
지나게 한다(스펙 §4). rejected 상태는 두지 않는다 — 반려는 보고
기록 + claimed 복귀라 죽은 enum 이 되기 때문.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: 에이전트 API 공용 헬퍼 (`src/lib/agent/externalApi.ts`)

**Files:**
- Create: `src/lib/agent/externalApi.ts`
- Test: `tests/agent/external-api.test.ts`

**Interfaces:**
- Consumes: `resolveUserByEmail`, `type AdminClient`, `type ResolvedUser` — `@/lib/minutes/externalApi` 에서 import (listUsers 순회 로직 재사용. 파일은 수정하지 않는다 — 이미 export 되어 있다).
- Produces:
  - `agentApiEnabled(): boolean`
  - `gateAgentApi(req: Request): NextResponse | null` — 실패 응답 or 통과 null
  - `apiNotFound() / apiUnauthorized() / apiBadRequest(msg) / apiFail(status, code, msg) / apiInternalError(msg?)`
  - `requireAgentProject(admin: AdminClient, projectId: string): Promise<boolean>` — 등록·enabled 확인, 조회 실패는 throw(fail-loud)
  - `isAgentProjectMember(admin: AdminClient, userId: string, projectId: string): Promise<boolean>` — `is_superuser` OR `project_roles` 행(admin|member). 조회 실패 = false(fail-closed)

- [ ] **Step 1: 실패하는 테스트 작성**

`tests/agent/external-api.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

describe('agent externalApi 게이트', () => {
  const OLD = { ...process.env }
  beforeEach(() => { vi.resetModules() })
  afterEach(() => { process.env = { ...OLD } })

  async function load() { return await import('@/lib/agent/externalApi') }
  function req(auth?: string) {
    return new Request('http://localhost/api/v1/agent/work', {
      headers: auth ? { Authorization: auth } : {},
    })
  }

  it('env 미설정이면 닫힘(fail-closed) — 404', async () => {
    delete process.env.AGENT_API_ENABLED
    delete process.env.AGENT_API_SECRET
    const m = await load()
    expect(m.agentApiEnabled()).toBe(false)
    const res = m.gateAgentApi(req('Bearer x'))
    expect(res?.status).toBe(404)
  })
  it('ENABLED=true 여도 SECRET 없으면 닫힘', async () => {
    process.env.AGENT_API_ENABLED = 'true'
    delete process.env.AGENT_API_SECRET
    const m = await load()
    expect(m.agentApiEnabled()).toBe(false)
  })
  it('시크릿 불일치 401, 일치 통과(null)', async () => {
    process.env.AGENT_API_ENABLED = 'true'
    process.env.AGENT_API_SECRET = 's3cret'
    const m = await load()
    expect(m.gateAgentApi(req('Bearer wrong'))?.status).toBe(401)
    expect(m.gateAgentApi(req())?.status).toBe(401)
    expect(m.gateAgentApi(req('Bearer s3cret'))).toBeNull()
  })
})

describe('isAgentProjectMember — fail-closed', () => {
  function admin(memberships: unknown, roles: unknown, memErr?: unknown, roleErr?: unknown) {
    const builder = (data: unknown, error: unknown) => {
      const b: Record<string, unknown> = {}
      for (const k of ['select', 'eq', 'in', 'limit']) b[k] = () => b
      b.maybeSingle = async () => ({ data, error })
      b.then = (r: (v: unknown) => unknown) => Promise.resolve({ data, error }).then(r)
      return b
    }
    return {
      from: (t: string) => t === 'memberships' ? builder(memberships, memErr ?? null) : builder(roles, roleErr ?? null),
    }
  }
  it('슈퍼유저 통과', async () => {
    const { isAgentProjectMember } = await import('@/lib/agent/externalApi')
    expect(await isAgentProjectMember(admin({ is_superuser: true }, []) as never, 'u', 'p')).toBe(true)
  })
  it('프로젝트 역할 보유 통과, 없으면 거절', async () => {
    const { isAgentProjectMember } = await import('@/lib/agent/externalApi')
    expect(await isAgentProjectMember(admin({ is_superuser: false }, [{ role: 'member' }]) as never, 'u', 'p')).toBe(true)
    expect(await isAgentProjectMember(admin({ is_superuser: false }, []) as never, 'u', 'p')).toBe(false)
  })
  it('조회 실패는 거절(fail-closed)', async () => {
    const { isAgentProjectMember } = await import('@/lib/agent/externalApi')
    expect(await isAgentProjectMember(admin(null, [], { message: 'db down' }) as never, 'u', 'p')).toBe(false)
  })
})
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run tests/agent/external-api.test.ts`
Expected: FAIL — 모듈 없음

- [ ] **Step 3: 구현**

`src/lib/agent/externalApi.ts`:

```ts
import { NextResponse } from 'next/server'
import { timingSafeEqual } from 'node:crypto'
import type { AdminClient } from '@/lib/minutes/externalApi'

/**
 * 에이전트 작업 루프 외부 API 공용 헬퍼 — 스펙 §3.1.
 * 회의록 API(src/lib/minutes/externalApi.ts) 패턴을 따르되 env 축(AGENT_API_*)만 다르다.
 * resolveUserByEmail/AdminClient 는 그 모듈에서 import 해 재사용한다(수정 금지).
 */
export function agentApiEnabled(): boolean {
  return process.env.AGENT_API_ENABLED === 'true' && !!process.env.AGENT_API_SECRET
}

function secretMatches(provided: string | null, expected: string): boolean {
  if (!provided) return false
  const a = Buffer.from(provided)
  const b = Buffer.from(expected)
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}

export const apiNotFound = () =>
  NextResponse.json({ error: 'Not Found' }, { status: 404 })
export const apiUnauthorized = () =>
  NextResponse.json({ error: '인증이 필요합니다.', code: 'unauthorized' }, { status: 401 })
export const apiBadRequest = (error: string) =>
  NextResponse.json({ error, code: 'validation_failed' }, { status: 400 })
export const apiFail = (status: number, code: string, error: string) =>
  NextResponse.json({ error, code }, { status })
export const apiInternalError = (error = '서버 오류가 발생했습니다.') =>
  NextResponse.json({ error, code: 'internal_error' }, { status: 500 })

/** 전 라우트 공통 선두 게이트 — 닫힘=404(존재 은닉), 시크릿 불일치=401, 통과=null. */
export function gateAgentApi(req: Request): NextResponse | null {
  if (!agentApiEnabled()) return apiNotFound()
  const header = req.headers.get('authorization')
  const provided = header && header.startsWith('Bearer ') ? header.slice('Bearer '.length) : null
  if (!secretMatches(provided, process.env.AGENT_API_SECRET as string)) return apiUnauthorized()
  return null
}

/** 등록·enabled 프로젝트만 루프가 열린다(스펙 §1.1-2). 조회 실패는 404 로 위장하지 않고 throw. */
export async function requireAgentProject(admin: AdminClient, projectId: string): Promise<boolean> {
  const { data, error } = await admin
    .from('agent_projects').select('project_id, enabled').eq('project_id', projectId).maybeSingle()
  if (error) throw new Error(`agent_projects 조회 실패: ${error.message}`)
  return !!data && (data as { enabled: boolean }).enabled === true
}

/**
 * user_email 계정이 해당 프로젝트 멤버 이상인지 — 기존 3단 권한 축 그대로(스펙 §3.1).
 * 보안 가드이므로 조회 실패는 false(fail-closed). memberships.role 은 deprecated(0054) — 읽지 않는다.
 */
export async function isAgentProjectMember(
  admin: AdminClient, userId: string, projectId: string,
): Promise<boolean> {
  const { data: mem, error: memErr } = await admin
    .from('memberships').select('is_superuser').eq('user_id', userId).maybeSingle()
  if (memErr) {
    console.error('[agent-api] 등급 조회 실패(거절):', memErr.message)
    return false
  }
  if ((mem as { is_superuser?: boolean } | null)?.is_superuser) return true
  const { data: roles, error: roleErr } = await admin
    .from('project_roles').select('role').eq('user_id', userId).eq('project_id', projectId).limit(1)
  if (roleErr || !roles) {
    console.error('[agent-api] 프로젝트 역할 조회 실패(거절):', roleErr?.message)
    return false
  }
  return roles.length > 0
}
```

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run tests/agent/external-api.test.ts`
Expected: PASS

- [ ] **Step 5: 커밋**

```bash
git add src/lib/agent/externalApi.ts tests/agent/external-api.test.ts
git commit -m "feat(agent): API 게이트·프로젝트 등록·멤버 판정 헬퍼

회의록 API 와 같은 fail-closed 구조(닫힘=404 존재 은닉)를 AGENT_API_*
env 축으로 복제한다. 멤버 판정은 새 권한 축(is_superuser+project_roles)만
읽는다 — memberships.role 은 0054 박제라 드리프트가 쌓인다.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: 진척 자동 반영 (`src/lib/agent/applyProgress.ts`)

**Files:**
- Create: `src/lib/agent/applyProgress.ts`
- Test: `tests/agent/apply-progress.test.ts`

**Interfaces:**
- Consumes: `AdminClient`(Task 3 경유 re-export 또는 `@/lib/minutes/externalApi`)
- Produces: `applyAgentProgress(admin: AdminClient, args: { wbsItemId: string; percent: number; actorUserId: string }): Promise<{ ok: true; projectId: string } | { ok: false; error: string }>`
- 호출부(Task 7 report 라우트)가 성공 시 `revalidatePath('/p/'+projectId, 'layout')` + `after(() => recordProgressSnapshot(projectId, admin))` 을 수행한다. `recordProgressSnapshot(projectId, client?)` 은 `@/lib/data/snapshots` — **admin 클라이언트를 반드시 주입**한다(기본값은 세션 클라이언트라 라우트에는 세션이 없다).

- [ ] **Step 1: 실패하는 테스트 작성**

`tests/agent/apply-progress.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest'
import { applyAgentProgress } from '@/lib/agent/applyProgress'

type Resp = { data?: unknown; error?: { message: string } | null }
function admin(queues: Record<string, Resp[]>) {
  return {
    from: vi.fn((table: string) => {
      const resp = (queues[table] ?? []).shift() ?? { data: null, error: null }
      const b: Record<string, unknown> = {}
      for (const k of ['select', 'update', 'insert', 'eq', 'limit']) b[k] = () => b
      b.maybeSingle = async () => ({ data: resp.data ?? null, error: resp.error ?? null })
      b.single = b.maybeSingle
      b.then = (r: (v: unknown) => unknown) =>
        Promise.resolve({ data: resp.data ?? null, error: resp.error ?? null }).then(r)
      return b
    }),
  } as never
}

const ITEM = { id: 'w1', actual_pct: 30, project_id: 'p1' }

describe('applyAgentProgress', () => {
  it('리프 항목이면 갱신 + change_logs 기록', async () => {
    const a = admin({
      wbs_items: [{ data: ITEM }, { data: null }, { data: [{ id: 'w1' }] }], // 항목, 자식 없음, update.select
      change_logs: [{ data: [{}] }],
    })
    const r = await applyAgentProgress(a, { wbsItemId: 'w1', percent: 55, actorUserId: 'u1' })
    expect(r).toEqual({ ok: true, projectId: 'p1' })
  })
  it('항목 조회 실패는 중단 — 없음으로 위장하지 않는다', async () => {
    const a = admin({ wbs_items: [{ data: null, error: { message: 'db down' } }] })
    const r = await applyAgentProgress(a, { wbsItemId: 'w1', percent: 10, actorUserId: 'u1' })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toContain('db down')
  })
  it('롤업 부모(자식 있음)는 거부', async () => {
    const a = admin({ wbs_items: [{ data: ITEM }, { data: { id: 'child' } }] })
    const r = await applyAgentProgress(a, { wbsItemId: 'w1', percent: 10, actorUserId: 'u1' })
    expect(r.ok).toBe(false)
  })
  it('범위 밖 percent 거부', async () => {
    const a = admin({})
    expect((await applyAgentProgress(a, { wbsItemId: 'w1', percent: 100, actorUserId: 'u1' })).ok).toBe(false)
    expect((await applyAgentProgress(a, { wbsItemId: 'w1', percent: -1, actorUserId: 'u1' })).ok).toBe(false)
  })
})
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run tests/agent/apply-progress.test.ts`
Expected: FAIL — 모듈 없음

- [ ] **Step 3: 구현**

`src/lib/agent/applyProgress.ts`:

```ts
import type { AdminClient } from '@/lib/minutes/externalApi'

/**
 * 에이전트 progress 보고의 WBS 실적 반영 — 스펙 §4.
 * actions/wbs.ts updateActual 과 같은 3종 세트(actual_pct + change_logs + 스냅샷)를 만들되,
 * 세션이 없는 라우트 컨텍스트라 admin(service_role) 로 쓴다. 스냅샷·revalidate 는 호출부 몫.
 *
 * updateActual 의 담당팀(item_owners) 검사는 여기 없다 — 주문 발행이 프로젝트 관리자
 * 전용이므로(스펙 §5) 항목 선정 검증은 발행 시점에 이미 끝났다.
 */
export async function applyAgentProgress(
  admin: AdminClient,
  args: { wbsItemId: string; percent: number; actorUserId: string },
): Promise<{ ok: true; projectId: string } | { ok: false; error: string }> {
  const { wbsItemId, percent, actorUserId } = args
  if (!Number.isInteger(percent) || percent < 0 || percent > 99) {
    return { ok: false, error: 'percent는 0~99 정수여야 합니다.' }
  }
  // 쓰기 선행조회 — 실패는 중단(3원칙).
  const { data: item, error: itemErr } = await admin
    .from('wbs_items').select('id, actual_pct, project_id').eq('id', wbsItemId).maybeSingle()
  if (itemErr) return { ok: false, error: `항목 조회 실패: ${itemErr.message}` }
  if (!item) return { ok: false, error: '항목 없음' }
  const row = item as { id: string; actual_pct: number | null; project_id: string }

  const { data: child, error: childErr } = await admin
    .from('wbs_items').select('id').eq('parent_id', wbsItemId).limit(1).maybeSingle()
  if (childErr) return { ok: false, error: `하위 항목 확인 실패: ${childErr.message}` }
  if (child) return { ok: false, error: '하위 항목이 있어 롤업으로 계산됩니다' }

  const { data: updated, error: upErr } = await admin
    .from('wbs_items')
    .update({ actual_pct: percent, updated_at: new Date().toISOString() })
    .eq('id', wbsItemId)
    .select('id')
  if (upErr) return { ok: false, error: upErr.message }
  if (!updated || (updated as unknown[]).length === 0) return { ok: false, error: '갱신 대상 없음' }

  // 본 저장 성공 후의 이력 실패는 되돌리지 않되 조용히 삼키지도 않는다(updateActual 관례).
  const { error: logErr } = await admin.from('change_logs').insert({
    user_id: actorUserId, wbs_item_id: wbsItemId, field: 'actual_pct',
    old_value: row.actual_pct == null ? null : String(row.actual_pct), new_value: String(percent),
  })
  if (logErr) console.error('[agent-api] 변경 이력 기록 실패:', logErr.message)

  return { ok: true, projectId: row.project_id }
}
```

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run tests/agent/apply-progress.test.ts`
Expected: PASS

- [ ] **Step 5: 커밋**

```bash
git add src/lib/agent/applyProgress.ts tests/agent/apply-progress.test.ts
git commit -m "feat(agent): progress 보고의 WBS 실적 반영 — updateActual 3종 세트 복제

세션 없는 라우트라 updateActual 을 그대로 못 부른다. 같은 불변식
(리프만·선행조회 중단·이력 기록)을 admin 경유로 유지하고, 담당팀
검사는 발행이 관리자 전용이라 발행 시점으로 흡수됐다.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: 조회 라우트 — 목록 GET `/api/v1/agent/work` + 상세 GET `/api/v1/agent/work/[id]`

**Files:**
- Create: `src/app/api/v1/agent/work/route.ts`
- Create: `src/app/api/v1/agent/work/[id]/route.ts`
- Test: `tests/agent/work-routes.test.ts`

**Interfaces:**
- Consumes: Task 3 헬퍼 전부, Task 2 `isClaimStale`
- Produces (응답 계약 — 하네스·Task 10 문서가 이 모양을 쓴다):
  - 목록: `{ ok: true, orders: [{ id, status, priority, instructions, claimed_by, claimed_at, wbs_item_id, item: { code, name, biz, deliverable, planned_start, planned_end } | null }] }`
  - 상세: `{ ok: true, order: {...같은 필드, stale: boolean}, reports: [{ id, kind, percent, summary, links, agent, review_action, review_note, created_at }] }`

- [ ] **Step 1: 실패하는 테스트 작성**

`tests/agent/work-routes.test.ts` (tests/minutes/folder-batch.test.ts 의 mock 하네스 축약판):

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({ createAdminClient: vi.fn() }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: mocks.createAdminClient }))

import { GET as listGET } from '@/app/api/v1/agent/work/route'
import { GET as detailGET } from '@/app/api/v1/agent/work/[id]/route'

const SECRET = 'test-agent-secret'
type Resp = { data?: unknown; error?: { message: string } | null }

function useAdmin(queues: Record<string, Resp[]>) {
  const admin = {
    from: vi.fn((table: string) => {
      const resp = (queues[table] ?? []).shift() ?? { data: null, error: null }
      const b: Record<string, unknown> = {}
      for (const k of ['select', 'eq', 'in', 'order', 'limit']) b[k] = () => b
      b.maybeSingle = async () => ({ data: resp.data ?? null, error: resp.error ?? null })
      b.single = b.maybeSingle
      b.then = (r: (v: unknown) => unknown) =>
        Promise.resolve({ data: resp.data ?? null, error: resp.error ?? null }).then(r)
      return b
    }),
  }
  mocks.createAdminClient.mockReturnValue(admin)
  return admin
}
const get = (url: string) =>
  new NextRequest(url, { headers: { Authorization: `Bearer ${SECRET}` } })

beforeEach(() => {
  process.env.AGENT_API_ENABLED = 'true'
  process.env.AGENT_API_SECRET = SECRET
  vi.clearAllMocks()
})

describe('GET /api/v1/agent/work', () => {
  it('게이트 닫힘 404', async () => {
    process.env.AGENT_API_ENABLED = 'false'
    const res = await listGET(get('http://l/api/v1/agent/work?project_id=p1'))
    expect(res.status).toBe(404)
  })
  it('미등록 프로젝트 404 — D-CUBE 은닉의 근거', async () => {
    useAdmin({ agent_projects: [{ data: null }] })
    const res = await listGET(get('http://l/api/v1/agent/work?project_id=p1'))
    expect(res.status).toBe(404)
  })
  it('project_id 누락 400', async () => {
    useAdmin({})
    const res = await listGET(get('http://l/api/v1/agent/work'))
    expect(res.status).toBe(400)
  })
  it('ready 목록 + 항목 컨텍스트 join', async () => {
    useAdmin({
      agent_projects: [{ data: { project_id: 'p1', enabled: true } }],
      agent_work_orders: [{ data: [
        { id: 'o1', status: 'ready', priority: 1, instructions: '지시', claimed_by: null, claimed_at: null, wbs_item_id: 'w1' },
      ] }],
      wbs_items: [{ data: [
        { id: 'w1', code: '1.2.3', name: '로그인 화면', biz: '설명', deliverable: '화면', planned_start: null, planned_end: null },
      ] }],
    })
    const res = await listGET(get('http://l/api/v1/agent/work?project_id=p1'))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.orders[0].item.name).toBe('로그인 화면')
  })
  it('주문 조회 실패는 500 — 빈 목록으로 위장하지 않는다', async () => {
    useAdmin({
      agent_projects: [{ data: { project_id: 'p1', enabled: true } }],
      agent_work_orders: [{ data: null, error: { message: 'db down' } }],
    })
    const res = await listGET(get('http://l/api/v1/agent/work?project_id=p1'))
    expect(res.status).toBe(500)
  })
})

describe('GET /api/v1/agent/work/[id]', () => {
  it('주문 + 보고 이력 반환', async () => {
    useAdmin({
      agent_work_orders: [{ data: { id: 'o1', project_id: 'p1', status: 'reported', priority: 0, instructions: '', claimed_by: 'cli', claimed_at: null, wbs_item_id: 'w1' } }],
      agent_projects: [{ data: { project_id: 'p1', enabled: true } }],
      agent_work_reports: [{ data: [{ id: 'r1', kind: 'completion', percent: 100, summary: 'done', links: [], agent: 'cli', review_action: null, review_note: null, created_at: 'x' }] }],
      wbs_items: [{ data: [{ id: 'w1', code: '1', name: 'n', biz: null, deliverable: null, planned_start: null, planned_end: null }] }],
    })
    const res = await detailGET(get('http://l/api/v1/agent/work/o1'), { params: Promise.resolve({ id: 'o1' }) })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.reports).toHaveLength(1)
  })
  it('없는 주문 404', async () => {
    useAdmin({ agent_work_orders: [{ data: null }] })
    const res = await detailGET(get('http://l/api/v1/agent/work/ox'), { params: Promise.resolve({ id: 'ox' }) })
    expect(res.status).toBe(404)
  })
})
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run tests/agent/work-routes.test.ts`
Expected: FAIL — 라우트 모듈 없음

- [ ] **Step 3: 목록 라우트 구현**

`src/app/api/v1/agent/work/route.ts`:

```ts
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import {
  apiBadRequest, apiInternalError, apiNotFound, gateAgentApi, requireAgentProject,
} from '@/lib/agent/externalApi'

/** GET /api/v1/agent/work?project_id= — ready 작업 목록 + 항목 컨텍스트. 계약: 스펙 §3.2. */
export const dynamic = 'force-dynamic'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function GET(req: NextRequest) {
  const gate = gateAgentApi(req)
  if (gate) return gate
  const projectId = req.nextUrl.searchParams.get('project_id') ?? ''
  if (!UUID_RE.test(projectId)) return apiBadRequest('project_id가 필요합니다.')
  try {
    const admin = createAdminClient()
    if (!(await requireAgentProject(admin, projectId))) return apiNotFound()

    const { data: orders, error } = await admin
      .from('agent_work_orders')
      .select('id, status, priority, instructions, claimed_by, claimed_at, wbs_item_id')
      .eq('project_id', projectId).eq('status', 'ready')
      .order('priority', { ascending: false }).order('created_at', { ascending: true })
    if (error) {
      console.error('[agent-api] 주문 목록 조회 실패:', error.message)
      return apiInternalError()
    }
    const rows = (orders ?? []) as Array<{ wbs_item_id: string | null } & Record<string, unknown>>
    const itemIds = [...new Set(rows.map(o => o.wbs_item_id).filter((v): v is string => !!v))]
    const itemById = new Map<string, unknown>()
    if (itemIds.length > 0) {
      const { data: items, error: itemErr } = await admin
        .from('wbs_items')
        .select('id, code, name, biz, deliverable, planned_start, planned_end')
        .in('id', itemIds)
      if (itemErr) {
        console.error('[agent-api] 항목 컨텍스트 조회 실패:', itemErr.message)
        return apiInternalError()
      }
      for (const it of (items ?? []) as Array<{ id: string }>) itemById.set(it.id, it)
    }
    return NextResponse.json({
      ok: true,
      orders: rows.map(o => ({ ...o, item: o.wbs_item_id ? itemById.get(o.wbs_item_id) ?? null : null })),
    })
  } catch (e) {
    console.error('[agent-api] 목록 처리 실패:', e instanceof Error ? e.message : e)
    return apiInternalError()
  }
}

export const POST = apiNotFound
export const PUT = apiNotFound
export const DELETE = apiNotFound
export const PATCH = apiNotFound
export const OPTIONS = apiNotFound
```

- [ ] **Step 4: 상세 라우트 구현**

`src/app/api/v1/agent/work/[id]/route.ts`:

```ts
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { isClaimStale } from '@/lib/domain/agentWork'
import {
  apiInternalError, apiNotFound, gateAgentApi, requireAgentProject,
} from '@/lib/agent/externalApi'

/** GET /api/v1/agent/work/{id} — 상태 폴링. 에이전트는 여기서 승인/반려·반려 사유를 읽는다(스펙 §3.4-2). */
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const gate = gateAgentApi(req)
  if (gate) return gate
  const { id } = await ctx.params
  try {
    const admin = createAdminClient()
    const { data: order, error } = await admin
      .from('agent_work_orders')
      .select('id, project_id, status, priority, instructions, claimed_by, claimed_at, wbs_item_id')
      .eq('id', id).maybeSingle()
    if (error) {
      console.error('[agent-api] 주문 조회 실패:', error.message)
      return apiInternalError()
    }
    if (!order) return apiNotFound()
    const row = order as { project_id: string; claimed_at: string | null; wbs_item_id: string | null }
    // 미등록 프로젝트의 주문은 존재 자체를 숨긴다 — 게이트 순서상 등록 해제 뒤에도 새지 않게.
    if (!(await requireAgentProject(admin, row.project_id))) return apiNotFound()

    const { data: reports, error: repErr } = await admin
      .from('agent_work_reports')
      .select('id, kind, percent, summary, links, agent, review_action, review_note, created_at')
      .eq('work_order_id', id).order('created_at', { ascending: true })
    if (repErr) {
      console.error('[agent-api] 보고 이력 조회 실패:', repErr.message)
      return apiInternalError()
    }
    let item: unknown = null
    if (row.wbs_item_id) {
      const { data: items, error: itemErr } = await admin
        .from('wbs_items')
        .select('id, code, name, biz, deliverable, planned_start, planned_end')
        .in('id', [row.wbs_item_id])
      if (itemErr) {
        console.error('[agent-api] 항목 컨텍스트 조회 실패:', itemErr.message)
        return apiInternalError()
      }
      item = (items ?? [])[0] ?? null
    }
    return NextResponse.json({
      ok: true,
      order: { ...order, item, stale: isClaimStale(row.claimed_at) },
      reports: reports ?? [],
    })
  } catch (e) {
    console.error('[agent-api] 상세 처리 실패:', e instanceof Error ? e.message : e)
    return apiInternalError()
  }
}

export const POST = apiNotFound
export const PUT = apiNotFound
export const DELETE = apiNotFound
export const PATCH = apiNotFound
export const OPTIONS = apiNotFound
```

- [ ] **Step 5: 통과 확인**

Run: `npx vitest run tests/agent/work-routes.test.ts`
Expected: PASS

- [ ] **Step 6: 커밋**

```bash
git add src/app/api/v1/agent/work/route.ts "src/app/api/v1/agent/work/[id]/route.ts" tests/agent/work-routes.test.ts
git commit -m "feat(agent): 작업 목록·상태 폴링 라우트 — 미등록 프로젝트는 404 은닉

조회 실패를 빈 목록으로 위장하지 않는다(3원칙). 상세는 등록 해제
뒤에도 과거 주문이 새지 않게 프로젝트 게이트를 다시 확인한다.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 6: 점유 라우트 — POST `claim` / `release`

**Files:**
- Create: `src/lib/agent/routeShared.ts` (쓰기 라우트 공통 선행부 — **route.ts 에 두면 안 된다**: App Router 는 라우트 파일의 HTTP 메서드 외 export 를 빌드에서 거부한다)
- Create: `src/app/api/v1/agent/work/[id]/claim/route.ts`
- Create: `src/app/api/v1/agent/work/[id]/release/route.ts`
- Test: `tests/agent/claim-routes.test.ts`

**Interfaces:**
- Consumes: Task 3 헬퍼 + `resolveUserByEmail`(`@/lib/minutes/externalApi`) + Task 2 `AGENT_NAME_RE`
- Produces: 요청 바디 `{ user_email: string, agent: string }`. 성공 `{ ok: true, status: 'claimed'|'ready' }`. CAS 실패 `409 { code: 'conflict', status: <현재상태> }`.
- `routeShared.ts` 가 `parseAgentActor(raw)` 와 `loadGatedOrder(admin, id, userEmail)` 를 export — claim·release·report(Task 7)가 import 한다.

- [ ] **Step 1: 실패하는 테스트 작성**

`tests/agent/claim-routes.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({ createAdminClient: vi.fn() }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: mocks.createAdminClient }))

import { POST as claimPOST } from '@/app/api/v1/agent/work/[id]/claim/route'
import { POST as releasePOST } from '@/app/api/v1/agent/work/[id]/release/route'

const SECRET = 'test-agent-secret'
const USER = { id: 'u-1', email: 'dev@example.com', user_metadata: {} }
type Resp = { data?: unknown; error?: { message: string } | null }

function useAdmin(queues: Record<string, Resp[]>, users = [USER]) {
  const admin = {
    from: vi.fn((table: string) => {
      const resp = (queues[table] ?? []).shift() ?? { data: null, error: null }
      const b: Record<string, unknown> = {}
      for (const k of ['select', 'update', 'eq', 'in', 'limit']) b[k] = () => b
      b.maybeSingle = async () => ({ data: resp.data ?? null, error: resp.error ?? null })
      b.then = (r: (v: unknown) => unknown) =>
        Promise.resolve({ data: resp.data ?? null, error: resp.error ?? null }).then(r)
      return b
    }),
    auth: { admin: { listUsers: vi.fn(async () => ({ data: { users }, error: null })) } },
  }
  mocks.createAdminClient.mockReturnValue(admin)
  return admin
}
const post = (url: string, body: unknown) => new NextRequest(url, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${SECRET}` },
  body: JSON.stringify(body),
})
const ORDER = { id: 'o1', project_id: 'p1', status: 'ready', claimed_by: null }
const BODY = { user_email: 'dev@example.com', agent: 'claude-cli-dev1' }
const ctx = { params: Promise.resolve({ id: 'o1' }) }

beforeEach(() => {
  process.env.AGENT_API_ENABLED = 'true'
  process.env.AGENT_API_SECRET = SECRET
  vi.clearAllMocks()
})

describe('POST claim', () => {
  it('ready 주문 점유 성공', async () => {
    useAdmin({
      agent_work_orders: [{ data: ORDER }, { data: [{ id: 'o1' }] }], // 조회, CAS update.select
      agent_projects: [{ data: { project_id: 'p1', enabled: true } }],
      memberships: [{ data: { is_superuser: false } }],
      project_roles: [{ data: [{ role: 'member' }] }],
    })
    const res = await claimPOST(post('http://l/api/v1/agent/work/o1/claim', BODY), ctx)
    expect(res.status).toBe(200)
  })
  it('CAS 경합 — 이미 claimed 면 409 + 현재 상태', async () => {
    useAdmin({
      agent_work_orders: [{ data: ORDER }, { data: [] }, { data: { status: 'claimed' } }], // CAS 0행 → 재조회
      agent_projects: [{ data: { project_id: 'p1', enabled: true } }],
      memberships: [{ data: { is_superuser: false } }],
      project_roles: [{ data: [{ role: 'member' }] }],
    })
    const res = await claimPOST(post('http://l/api/v1/agent/work/o1/claim', BODY), ctx)
    expect(res.status).toBe(409)
    expect((await res.json()).status).toBe('claimed')
  })
  it('멤버 아님 403', async () => {
    useAdmin({
      agent_work_orders: [{ data: ORDER }],
      agent_projects: [{ data: { project_id: 'p1', enabled: true } }],
      memberships: [{ data: { is_superuser: false } }],
      project_roles: [{ data: [] }],
    })
    const res = await claimPOST(post('http://l/api/v1/agent/work/o1/claim', BODY), ctx)
    expect(res.status).toBe(403)
  })
  it('agent 이름 형식 위반 400', async () => {
    useAdmin({})
    const res = await claimPOST(post('http://l/api/v1/agent/work/o1/claim', { ...BODY, agent: '공백 있음' }), ctx)
    expect(res.status).toBe(400)
  })
})

describe('POST release', () => {
  it('본인 점유만 반납 가능 — 타인 점유 403', async () => {
    useAdmin({
      agent_work_orders: [{ data: { ...ORDER, status: 'claimed', claimed_by: 'other-cli' } }],
      agent_projects: [{ data: { project_id: 'p1', enabled: true } }],
      memberships: [{ data: { is_superuser: false } }],
      project_roles: [{ data: [{ role: 'member' }] }],
    })
    const res = await releasePOST(post('http://l/api/v1/agent/work/o1/release', BODY), ctx)
    expect(res.status).toBe(403)
  })
})
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run tests/agent/claim-routes.test.ts`
Expected: FAIL — 라우트 모듈 없음

- [ ] **Step 3: 공용 선행부 + claim 라우트 구현**

`src/lib/agent/routeShared.ts`:

```ts
import { NextResponse } from 'next/server'
import { resolveUserByEmail, type AdminClient } from '@/lib/minutes/externalApi'
import { AGENT_NAME_RE } from '@/lib/domain/agentWork'
import {
  apiFail, apiInternalError, apiNotFound, isAgentProjectMember, requireAgentProject,
} from '@/lib/agent/externalApi'

/**
 * 쓰기 라우트(claim/release/report) 공통 선행부.
 * route.ts 안에 두지 않는 이유: App Router 는 라우트 파일에서 HTTP 메서드 외 export 를
 * 빌드에서 거부한다 — 공용 로직은 lib 로 빼는 것이 유일한 합법 경로다.
 */
export function parseAgentActor(raw: unknown): { userEmail: string; agent: string } | { error: string } {
  if (typeof raw !== 'object' || raw === null) return { error: '잘못된 요청입니다.' }
  const b = raw as Record<string, unknown>
  const userEmail = typeof b.user_email === 'string' ? b.user_email.trim() : ''
  if (!userEmail) return { error: 'user_email이 필요합니다.' }
  const agent = typeof b.agent === 'string' ? b.agent.trim() : ''
  if (!AGENT_NAME_RE.test(agent)) return { error: 'agent 이름 형식이 올바르지 않습니다(영숫자·._- 64자).' }
  return { userEmail, agent }
}

/** 주문 로드 + 프로젝트 게이트 + 멤버 판정. 실패는 완성된 NextResponse 로 돌려준다. */
export async function loadGatedOrder(admin: AdminClient, id: string, userEmail: string): Promise<
  | { ok: true; order: { id: string; project_id: string; status: string; claimed_by: string | null; wbs_item_id: string | null }; userId: string }
  | { ok: false; res: NextResponse }
> {
  const { data: order, error } = await admin
    .from('agent_work_orders')
    .select('id, project_id, status, claimed_by, wbs_item_id')
    .eq('id', id).maybeSingle()
  if (error) {
    console.error('[agent-api] 주문 조회 실패:', error.message)
    return { ok: false, res: apiInternalError() }
  }
  if (!order) return { ok: false, res: apiNotFound() }
  const row = order as { id: string; project_id: string; status: string; claimed_by: string | null; wbs_item_id: string | null }
  if (!(await requireAgentProject(admin, row.project_id))) return { ok: false, res: apiNotFound() }
  const user = await resolveUserByEmail(admin, userEmail)
  if (!user) return { ok: false, res: apiFail(403, 'unknown_user', "해당 이메일의 D'Flow 사용자가 없습니다.") }
  if (!(await isAgentProjectMember(admin, user.id, row.project_id))) {
    return { ok: false, res: apiFail(403, 'forbidden_role', '그 프로젝트의 멤버 이상만 실행할 수 있습니다.') }
  }
  return { ok: true, order: row, userId: user.id }
}
```

`src/app/api/v1/agent/work/[id]/claim/route.ts`:

```ts
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { apiBadRequest, apiInternalError, apiNotFound, gateAgentApi } from '@/lib/agent/externalApi'
import { loadGatedOrder, parseAgentActor } from '@/lib/agent/routeShared'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const gate = gateAgentApi(req)
  if (gate) return gate
  const { id } = await ctx.params
  let raw: unknown
  try { raw = await req.json() } catch { return apiBadRequest('잘못된 요청입니다.') }
  const actor = parseAgentActor(raw)
  if ('error' in actor) return apiBadRequest(actor.error)
  try {
    const admin = createAdminClient()
    const loaded = await loadGatedOrder(admin, id, actor.userEmail)
    if (!loaded.ok) return loaded.res

    // CAS: ready 일 때만 점유된다 — 동시 claim 은 한쪽이 0행을 본다.
    const { data: updated, error: casErr } = await admin
      .from('agent_work_orders')
      .update({
        status: 'claimed', claimed_by: actor.agent,
        claimed_at: new Date().toISOString(), updated_at: new Date().toISOString(),
      })
      .eq('id', id).eq('status', 'ready')
      .select('id')
    if (casErr) {
      console.error('[agent-api] claim 갱신 실패:', casErr.message)
      return apiInternalError()
    }
    if (!updated || (updated as unknown[]).length === 0) {
      const { data: cur } = await admin
        .from('agent_work_orders').select('status').eq('id', id).maybeSingle()
      return NextResponse.json(
        { error: '이미 다른 에이전트가 점유했거나 점유 불가 상태입니다.', code: 'conflict', status: (cur as { status?: string } | null)?.status ?? 'unknown' },
        { status: 409 },
      )
    }
    return NextResponse.json({ ok: true, status: 'claimed' })
  } catch (e) {
    console.error('[agent-api] claim 처리 실패:', e instanceof Error ? e.message : e)
    return apiInternalError()
  }
}

export const GET = apiNotFound
export const PUT = apiNotFound
export const DELETE = apiNotFound
export const PATCH = apiNotFound
export const OPTIONS = apiNotFound
```

- [ ] **Step 4: release 라우트 구현**

`src/app/api/v1/agent/work/[id]/release/route.ts`:

```ts
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { apiBadRequest, apiFail, apiInternalError, apiNotFound, gateAgentApi } from '@/lib/agent/externalApi'
import { loadGatedOrder, parseAgentActor } from '@/lib/agent/routeShared'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const gate = gateAgentApi(req)
  if (gate) return gate
  const { id } = await ctx.params
  let raw: unknown
  try { raw = await req.json() } catch { return apiBadRequest('잘못된 요청입니다.') }
  const actor = parseAgentActor(raw)
  if ('error' in actor) return apiBadRequest(actor.error)
  try {
    const admin = createAdminClient()
    const loaded = await loadGatedOrder(admin, id, actor.userEmail)
    if (!loaded.ok) return loaded.res
    // 본인 점유만 반납 — 남의 점유를 뺏는 회수는 사람(UI, Task 8) 몫이다.
    if (loaded.order.claimed_by !== actor.agent) {
      return apiFail(403, 'not_claim_owner', '본인이 점유한 주문만 반납할 수 있습니다.')
    }
    const { data: updated, error } = await admin
      .from('agent_work_orders')
      .update({ status: 'ready', claimed_by: null, claimed_at: null, updated_at: new Date().toISOString() })
      .eq('id', id).eq('status', 'claimed').eq('claimed_by', actor.agent)
      .select('id')
    if (error) {
      console.error('[agent-api] release 갱신 실패:', error.message)
      return apiInternalError()
    }
    if (!updated || (updated as unknown[]).length === 0) {
      return apiFail(409, 'conflict', '반납 가능한 상태가 아닙니다.')
    }
    return NextResponse.json({ ok: true, status: 'ready' })
  } catch (e) {
    console.error('[agent-api] release 처리 실패:', e instanceof Error ? e.message : e)
    return apiInternalError()
  }
}

export const GET = apiNotFound
export const PUT = apiNotFound
export const DELETE = apiNotFound
export const PATCH = apiNotFound
export const OPTIONS = apiNotFound
```

- [ ] **Step 5: 통과 확인**

Run: `npx vitest run tests/agent/claim-routes.test.ts`
Expected: PASS

- [ ] **Step 6: 커밋**

```bash
git add src/lib/agent/routeShared.ts "src/app/api/v1/agent/work/[id]/claim/route.ts" "src/app/api/v1/agent/work/[id]/release/route.ts" tests/agent/claim-routes.test.ts
git commit -m "feat(agent): claim/release — CAS 점유와 본인 반납

동시 claim 은 조건부 UPDATE 0행으로 갈라 한쪽에 409+현재상태를
돌려준다. 타인 점유 해제는 API 에 두지 않는다 — 그건 사람의
회수(UI) 권한이다.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 7: 보고 라우트 — POST `report`

**Files:**
- Create: `src/app/api/v1/agent/work/[id]/report/route.ts`
- Test: `tests/agent/report-route.test.ts`

**Interfaces:**
- Consumes: Task 6 `parseAgentActor`/`loadGatedOrder`(`@/lib/agent/routeShared`), Task 2 `validateReport`/`AGENT_LINKS_MAX`, Task 4 `applyAgentProgress`, `recordProgressSnapshot(projectId, client)`(`@/lib/data/snapshots`)
- Produces: 요청 바디 `{ user_email, agent, kind: 'progress'|'completion', percent: number, summary: string, links?: [{label?: string, url: string}] }`
  - progress 성공: `{ ok: true, status: 'claimed', applied_to_wbs: boolean }`
  - completion 성공: `{ ok: true, status: 'reported' }` (WBS 무변경 — 승인 대기)

- [ ] **Step 1: 실패하는 테스트 작성**

`tests/agent/report-route.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({
  createAdminClient: vi.fn(),
  applyAgentProgress: vi.fn(),
  recordProgressSnapshot: vi.fn(async () => {}),
}))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: mocks.createAdminClient }))
vi.mock('@/lib/agent/applyProgress', () => ({ applyAgentProgress: mocks.applyAgentProgress }))
vi.mock('@/lib/data/snapshots', () => ({ recordProgressSnapshot: mocks.recordProgressSnapshot }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('next/server', async (orig) => {
  const m = await orig() as Record<string, unknown>
  return { ...m, after: (fn: () => unknown) => { void fn() } }
})

import { POST as reportPOST } from '@/app/api/v1/agent/work/[id]/report/route'

const SECRET = 'test-agent-secret'
const USER = { id: 'u-1', email: 'dev@example.com', user_metadata: {} }
type Resp = { data?: unknown; error?: { message: string } | null }

function useAdmin(queues: Record<string, Resp[]>, users = [USER]) {
  const admin = {
    from: vi.fn((table: string) => {
      const resp = (queues[table] ?? []).shift() ?? { data: null, error: null }
      const b: Record<string, unknown> = {}
      for (const k of ['select', 'update', 'insert', 'eq', 'in', 'limit']) b[k] = () => b
      b.maybeSingle = async () => ({ data: resp.data ?? null, error: resp.error ?? null })
      b.then = (r: (v: unknown) => unknown) =>
        Promise.resolve({ data: resp.data ?? null, error: resp.error ?? null }).then(r)
      return b
    }),
    auth: { admin: { listUsers: vi.fn(async () => ({ data: { users }, error: null })) } },
  }
  mocks.createAdminClient.mockReturnValue(admin)
  return admin
}
const CLAIMED = { id: 'o1', project_id: 'p1', status: 'claimed', claimed_by: 'cli-1', wbs_item_id: 'w1' }
const gates = {
  agent_projects: [{ data: { project_id: 'p1', enabled: true } }],
  memberships: [{ data: { is_superuser: false } }],
  project_roles: [{ data: [{ role: 'member' }] }],
}
const post = (body: unknown) => new NextRequest('http://l/api/v1/agent/work/o1/report', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${SECRET}` },
  body: JSON.stringify(body),
})
const BASE = { user_email: 'dev@example.com', agent: 'cli-1', summary: '요약', links: [{ url: 'https://github.com/x/pr/1' }] }
const ctx = { params: Promise.resolve({ id: 'o1' }) }

beforeEach(() => {
  process.env.AGENT_API_ENABLED = 'true'
  process.env.AGENT_API_SECRET = SECRET
  vi.clearAllMocks()
  mocks.applyAgentProgress.mockResolvedValue({ ok: true, projectId: 'p1' })
})

describe('POST report', () => {
  it('progress — WBS 자동 반영 + 보고 행 기록', async () => {
    useAdmin({
      agent_work_orders: [{ data: CLAIMED }, { data: [{ id: 'o1' }] }], // 조회, updated_at 갱신
      agent_work_reports: [{ data: [{ id: 'r1' }] }],
      ...gates,
    })
    const res = await reportPOST(post({ ...BASE, kind: 'progress', percent: 40 }), ctx)
    expect(res.status).toBe(200)
    expect(mocks.applyAgentProgress).toHaveBeenCalledWith(expect.anything(),
      { wbsItemId: 'w1', percent: 40, actorUserId: 'u-1' })
    expect((await res.json()).applied_to_wbs).toBe(true)
  })
  it('progress 100 은 400 — 완료는 승인 경로로', async () => {
    useAdmin({ agent_work_orders: [{ data: CLAIMED }], ...gates })
    const res = await reportPOST(post({ ...BASE, kind: 'progress', percent: 100 }), ctx)
    expect(res.status).toBe(400)
    expect(mocks.applyAgentProgress).not.toHaveBeenCalled()
  })
  it('completion — WBS 무변경, reported 전이', async () => {
    useAdmin({
      agent_work_orders: [{ data: CLAIMED }, { data: [{ id: 'o1' }] }], // 조회, CAS reported
      agent_work_reports: [{ data: [{ id: 'r1' }] }],
      ...gates,
    })
    const res = await reportPOST(post({ ...BASE, kind: 'completion', percent: 100 }), ctx)
    expect(res.status).toBe(200)
    expect((await res.json()).status).toBe('reported')
    expect(mocks.applyAgentProgress).not.toHaveBeenCalled()
  })
  it('reported 상태에서 추가 보고 409 — 판정 전 원장 동결', async () => {
    useAdmin({ agent_work_orders: [{ data: { ...CLAIMED, status: 'reported' } }], ...gates })
    const res = await reportPOST(post({ ...BASE, kind: 'progress', percent: 50 }), ctx)
    expect(res.status).toBe(409)
  })
  it('타 에이전트 점유 주문에 보고 403', async () => {
    useAdmin({ agent_work_orders: [{ data: { ...CLAIMED, claimed_by: 'other' } }], ...gates })
    const res = await reportPOST(post({ ...BASE, kind: 'progress', percent: 50 }), ctx)
    expect(res.status).toBe(403)
  })
  it('wbs_item 이 삭제된 주문의 progress 는 409', async () => {
    useAdmin({ agent_work_orders: [{ data: { ...CLAIMED, wbs_item_id: null } }], ...gates })
    const res = await reportPOST(post({ ...BASE, kind: 'progress', percent: 50 }), ctx)
    expect(res.status).toBe(409)
  })
})
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run tests/agent/report-route.test.ts`
Expected: FAIL — 라우트 모듈 없음

- [ ] **Step 3: 구현**

`src/app/api/v1/agent/work/[id]/report/route.ts`:

```ts
import { NextRequest, NextResponse, after } from 'next/server'
import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import { recordProgressSnapshot } from '@/lib/data/snapshots'
import { AGENT_LINKS_MAX, validateReport, type AgentReportKind } from '@/lib/domain/agentWork'
import { applyAgentProgress } from '@/lib/agent/applyProgress'
import { apiBadRequest, apiFail, apiInternalError, apiNotFound, gateAgentApi } from '@/lib/agent/externalApi'
import { loadGatedOrder, parseAgentActor } from '@/lib/agent/routeShared'

export const dynamic = 'force-dynamic'

type Link = { label?: string; url: string }

function parseLinks(raw: unknown): Link[] | { error: string } {
  if (raw === undefined) return []
  if (!Array.isArray(raw)) return { error: 'links는 배열이어야 합니다.' }
  if (raw.length > AGENT_LINKS_MAX) return { error: `links는 ${AGENT_LINKS_MAX}건 이하여야 합니다.` }
  const out: Link[] = []
  for (const l of raw) {
    if (typeof l !== 'object' || l === null) return { error: 'links의 각 원소는 객체여야 합니다.' }
    const { url, label } = l as Record<string, unknown>
    if (typeof url !== 'string' || !/^https?:\/\//.test(url)) return { error: 'links[].url은 http(s) URL이어야 합니다.' }
    out.push({ url, ...(typeof label === 'string' && label ? { label } : {}) })
  }
  return out
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const gate = gateAgentApi(req)
  if (gate) return gate
  const { id } = await ctx.params
  let raw: unknown
  try { raw = await req.json() } catch { return apiBadRequest('잘못된 요청입니다.') }
  const actor = parseAgentActor(raw)
  if ('error' in actor) return apiBadRequest(actor.error)
  const b = raw as Record<string, unknown>
  const kind = b.kind
  if (kind !== 'progress' && kind !== 'completion') return apiBadRequest('kind는 progress 또는 completion이어야 합니다.')
  const percent = typeof b.percent === 'number' ? b.percent : NaN
  const invalid = validateReport(kind as AgentReportKind, percent)
  if (invalid) return apiBadRequest(invalid)
  const summary = typeof b.summary === 'string' ? b.summary.trim() : ''
  if (!summary) return apiBadRequest('summary가 필요합니다.')
  const links = parseLinks(b.links)
  if ('error' in links) return apiBadRequest(links.error)

  try {
    const admin = createAdminClient()
    const loaded = await loadGatedOrder(admin, id, actor.userEmail)
    if (!loaded.ok) return loaded.res
    const order = loaded.order
    // 보고는 점유 상태에서만, 본인 점유만. reported(승인 대기)는 판정 전 원장 동결(스펙 §6).
    if (order.status !== 'claimed') {
      return apiFail(409, 'conflict', `보고 가능한 상태가 아닙니다(현재: ${order.status}).`)
    }
    if (order.claimed_by !== actor.agent) {
      return apiFail(403, 'not_claim_owner', '본인이 점유한 주문만 보고할 수 있습니다.')
    }

    let appliedToWbs = false
    if (kind === 'progress') {
      // 항목이 삭제된 주문(set null)의 진척은 반영할 곳이 없다 — 실패로 알리고 사람이 정리한다.
      if (!order.wbs_item_id) return apiFail(409, 'wbs_item_missing', 'WBS 항목이 삭제된 주문입니다.')
      const applied = await applyAgentProgress(admin, {
        wbsItemId: order.wbs_item_id, percent, actorUserId: loaded.userId,
      })
      if (!applied.ok) return apiFail(409, 'apply_failed', applied.error)
      appliedToWbs = true
      revalidatePath(`/p/${applied.projectId}`, 'layout')
      after(() => recordProgressSnapshot(applied.projectId, admin as never))
    }

    // completion 은 CAS 로 reported 전이 — 경합 시 한쪽만 성공.
    if (kind === 'completion') {
      const { data: updated, error: casErr } = await admin
        .from('agent_work_orders')
        .update({ status: 'reported', updated_at: new Date().toISOString() })
        .eq('id', id).eq('status', 'claimed').eq('claimed_by', actor.agent)
        .select('id')
      if (casErr) {
        console.error('[agent-api] completion 전이 실패:', casErr.message)
        return apiInternalError()
      }
      if (!updated || (updated as unknown[]).length === 0) {
        return apiFail(409, 'conflict', '완료 요청 가능한 상태가 아닙니다.')
      }
    } else {
      // progress 는 상태 유지 — updated_at 만 갱신해 보드의 활동 시각을 살린다.
      const { error: touchErr } = await admin
        .from('agent_work_orders')
        .update({ updated_at: new Date().toISOString() })
        .eq('id', id).eq('status', 'claimed')
      if (touchErr) console.error('[agent-api] 주문 활동 시각 갱신 실패:', touchErr.message)
    }

    // 보고 행은 판정·감사의 원천 — 실패를 삼키면 승인 화면이 거짓이 된다(fail-loud 500).
    // progress 의 WBS 반영은 이미 끝났지만, 같은 percent 재보고는 멱등이라 재시도로 수렴한다.
    const { data: report, error: repErr } = await admin
      .from('agent_work_reports')
      .insert({
        work_order_id: id, kind, percent, summary, links,
        agent: actor.agent, actor_user_id: loaded.userId, applied_to_wbs: appliedToWbs,
      })
      .select('id')
    if (repErr || !report || (report as unknown[]).length === 0) {
      console.error('[agent-api] 보고 기록 실패:', repErr?.message ?? '0행')
      return apiInternalError('보고를 기록하지 못했습니다. 같은 내용으로 재시도하세요.')
    }

    return NextResponse.json(
      kind === 'completion'
        ? { ok: true, status: 'reported' }
        : { ok: true, status: 'claimed', applied_to_wbs: appliedToWbs },
    )
  } catch (e) {
    console.error('[agent-api] report 처리 실패:', e instanceof Error ? e.message : e)
    return apiInternalError()
  }
}

export const GET = apiNotFound
export const PUT = apiNotFound
export const DELETE = apiNotFound
export const PATCH = apiNotFound
export const OPTIONS = apiNotFound
```

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run tests/agent/report-route.test.ts`
Expected: PASS

- [ ] **Step 5: 전체 테스트 회귀 확인**

Run: `npx vitest run tests/agent tests/domain/agent-work.test.ts`
Expected: PASS 전량

- [ ] **Step 6: 커밋**

```bash
git add "src/app/api/v1/agent/work/[id]/report/route.ts" tests/agent/report-route.test.ts
git commit -m "feat(agent): report — 진척 자동 반영과 완료 요청의 이원화

progress 는 즉시 WBS 3종 세트(실적+이력+스냅샷)를 태우고,
completion 은 원장만 reported 로 바꿔 사람 승인 앞에 세운다.
보고 행 기록 실패는 500 fail-loud — 승인 화면의 거짓을 막는다.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 8: 서버 액션 (`src/app/actions/agentWork.ts`)

**Files:**
- Create: `src/app/actions/agentWork.ts`
- Test: `tests/actions/agent-work-actions.test.ts`

**Interfaces:**
- Consumes: `requireProjectAdmin`/`requireSuperuser`(`@/lib/authz`), `updateActual`(`@/app/actions/wbs`), `canTransition`(Task 2), `createAdminClient`, `createServerClient`(`@/lib/supabase/server`)
- Produces (UI 가 쓰는 시그니처):
  - `registerAgentProject(projectId: string, note: string): Promise<{ ok: boolean; error?: string }>` — 슈퍼유저
  - `unregisterAgentProject(projectId: string): Promise<{ ok: boolean; error?: string }>` — 슈퍼유저
  - `createAgentWorkOrder(projectId: string, wbsItemId: string, instructions: string, priority: number): Promise<{ ok: boolean; error?: string; id?: string }>` — 관리자. 항목이 그 프로젝트의 리프인지 선행 확인
  - `approveAgentCompletion(orderId: string): Promise<{ ok: boolean; error?: string }>` — 관리자. `updateActual(wbsItemId, 100)` 성공 후 주문 CAS `reported→approved` + 최신 completion 보고에 review 기록
  - `rejectAgentCompletion(orderId: string, note: string): Promise<{ ok: boolean; error?: string }>` — 관리자. note 필수. CAS `reported→claimed` + review 기록
  - `reclaimAgentOrder(orderId: string): Promise<{ ok: boolean; error?: string }>` — 관리자. CAS `claimed→ready`(claimed_by 해제)
  - `cancelAgentOrder(orderId: string): Promise<{ ok: boolean; error?: string }>` — 관리자. `ready|claimed|reported → cancelled`
  - `fetchAgentOps(projectId: string): Promise<{ ok: true; registered: boolean; orders: AgentOpsOrder[] } | { ok: false; error: string }>` — 세션 클라이언트(RLS 조회 정책) 사용. `AgentOpsOrder = { id, status, priority, instructions, claimed_by, claimed_at, updated_at, wbs_item_id, item_name: string | null, item_code: string | null, reports: { id, kind, percent, summary, links, agent, review_action, review_note, created_at }[] }`

- [ ] **Step 1: 실패하는 테스트 작성**

`tests/actions/agent-work-actions.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  requireProjectAdmin: vi.fn(),
  requireSuperuser: vi.fn(),
  updateActual: vi.fn(),
  createAdminClient: vi.fn(),
  createServerClient: vi.fn(),
}))
vi.mock('@/lib/authz', () => ({
  requireProjectAdmin: mocks.requireProjectAdmin,
  requireSuperuser: mocks.requireSuperuser,
}))
vi.mock('@/app/actions/wbs', () => ({ updateActual: mocks.updateActual }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: mocks.createAdminClient }))
vi.mock('@/lib/supabase/server', () => ({ createServerClient: mocks.createServerClient }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

import {
  approveAgentCompletion, createAgentWorkOrder, rejectAgentCompletion,
} from '@/app/actions/agentWork'

type Resp = { data?: unknown; error?: { message: string } | null }
function admin(queues: Record<string, Resp[]>) {
  const client = {
    from: vi.fn((table: string) => {
      const resp = (queues[table] ?? []).shift() ?? { data: null, error: null }
      const b: Record<string, unknown> = {}
      for (const k of ['select', 'insert', 'update', 'eq', 'in', 'order', 'limit']) b[k] = () => b
      b.maybeSingle = async () => ({ data: resp.data ?? null, error: resp.error ?? null })
      b.single = b.maybeSingle
      b.then = (r: (v: unknown) => unknown) =>
        Promise.resolve({ data: resp.data ?? null, error: resp.error ?? null }).then(r)
      return b
    }),
  }
  mocks.createAdminClient.mockReturnValue(client)
  return client
}
const ACTOR = { ok: true, actor: { userId: 'admin-1' } }

beforeEach(() => {
  vi.clearAllMocks()
  mocks.requireProjectAdmin.mockResolvedValue(ACTOR)
  mocks.requireSuperuser.mockResolvedValue(ACTOR)
  mocks.updateActual.mockResolvedValue({ ok: true })
})

describe('createAgentWorkOrder', () => {
  it('리프가 아닌 항목은 발행 거부', async () => {
    admin({ wbs_items: [
      { data: { id: 'w1', project_id: 'p1' } }, // 항목
      { data: { id: 'child' } },                // 자식 있음
    ] })
    const r = await createAgentWorkOrder('p1', 'w1', '지시', 0)
    expect(r.ok).toBe(false)
  })
  it('타 프로젝트 항목은 발행 거부', async () => {
    admin({ wbs_items: [{ data: { id: 'w1', project_id: 'OTHER' } }] })
    const r = await createAgentWorkOrder('p1', 'w1', '지시', 0)
    expect(r.ok).toBe(false)
  })
  it('권한 없으면 거부', async () => {
    mocks.requireProjectAdmin.mockResolvedValue({ ok: false, error: '권한 없음' })
    const r = await createAgentWorkOrder('p1', 'w1', '지시', 0)
    expect(r).toEqual({ ok: false, error: '권한 없음' })
  })
})

describe('approveAgentCompletion', () => {
  const ORDER = { id: 'o1', project_id: 'p1', status: 'reported', wbs_item_id: 'w1' }
  it('updateActual(100) 성공 후 승인 전이 + 보고 review 기록', async () => {
    admin({
      agent_work_orders: [{ data: ORDER }, { data: [{ id: 'o1' }] }],       // 조회, CAS approved
      agent_work_reports: [{ data: { id: 'r9' } }, { data: [{ id: 'r9' }] }], // 최신 completion, review 기록
    })
    const r = await approveAgentCompletion('o1')
    expect(r.ok).toBe(true)
    expect(mocks.updateActual).toHaveBeenCalledWith('w1', 100)
  })
  it('updateActual 실패면 주문은 reported 유지', async () => {
    mocks.updateActual.mockResolvedValue({ ok: false, error: '하위 항목이 있어 롤업으로 계산됩니다' })
    admin({ agent_work_orders: [{ data: ORDER }] })
    const r = await approveAgentCompletion('o1')
    expect(r.ok).toBe(false)
  })
  it('wbs_item 삭제된 주문은 승인 불가 — 사람이 취소로 정리', async () => {
    admin({ agent_work_orders: [{ data: { ...ORDER, wbs_item_id: null } }] })
    const r = await approveAgentCompletion('o1')
    expect(r.ok).toBe(false)
    expect(mocks.updateActual).not.toHaveBeenCalled()
  })
})

describe('rejectAgentCompletion', () => {
  it('사유 없으면 거부', async () => {
    const r = await rejectAgentCompletion('o1', '   ')
    expect(r.ok).toBe(false)
  })
})
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run tests/actions/agent-work-actions.test.ts`
Expected: FAIL — 모듈 없음

- [ ] **Step 3: 구현**

`src/app/actions/agentWork.ts`:

```ts
'use server'

import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import { createServerClient } from '@/lib/supabase/server'
import { requireProjectAdmin, requireSuperuser } from '@/lib/authz'
import { updateActual } from '@/app/actions/wbs'

/**
 * 에이전트 작업 루프 UI 서버 액션 — 스펙 §5.
 * 쓰기는 admin(service_role) 경유(신규 테이블은 쓰기 RLS 가 없다 — 서버 가드가 유일한 관문).
 * 조회(fetchAgentOps)만 세션 클라이언트로 해 RLS 조회 정책을 2차 방어선으로 쓴다.
 */

const AGENT_OPS_PATH = '/agent-ops'

type ActionResult = { ok: boolean; error?: string }

export async function registerAgentProject(projectId: string, note: string): Promise<ActionResult> {
  const g = await requireSuperuser()
  if (!g.ok) return { ok: false, error: g.error }
  const admin = createAdminClient()
  const { data, error } = await admin.from('agent_projects')
    .insert({ project_id: projectId, note: note.trim() || null, created_by: g.actor.userId })
    .select('project_id')
  if (error) return { ok: false, error: error.message }
  if (!data || data.length === 0) return { ok: false, error: '등록에 실패했습니다.' }
  revalidatePath(AGENT_OPS_PATH)
  return { ok: true }
}

export async function unregisterAgentProject(projectId: string): Promise<ActionResult> {
  const g = await requireSuperuser()
  if (!g.ok) return { ok: false, error: g.error }
  const admin = createAdminClient()
  const { error } = await admin.from('agent_projects').delete().eq('project_id', projectId)
  if (error) return { ok: false, error: error.message }
  revalidatePath(AGENT_OPS_PATH)
  return { ok: true }
}

export async function createAgentWorkOrder(
  projectId: string, wbsItemId: string, instructions: string, priority: number,
): Promise<ActionResult & { id?: string }> {
  const g = await requireProjectAdmin(projectId)
  if (!g.ok) return { ok: false, error: g.error }
  const admin = createAdminClient()
  // 쓰기 선행조회 — 항목 실재·프로젝트 일치·리프 여부. 실패는 중단(3원칙).
  const { data: item, error: itemErr } = await admin
    .from('wbs_items').select('id, project_id').eq('id', wbsItemId).maybeSingle()
  if (itemErr) return { ok: false, error: `항목 조회 실패: ${itemErr.message}` }
  if (!item) return { ok: false, error: '항목 없음' }
  if ((item as { project_id: string }).project_id !== projectId) {
    return { ok: false, error: '이 프로젝트의 항목이 아닙니다.' }
  }
  const { data: child, error: childErr } = await admin
    .from('wbs_items').select('id').eq('parent_id', wbsItemId).limit(1).maybeSingle()
  if (childErr) return { ok: false, error: `하위 항목 확인 실패: ${childErr.message}` }
  if (child) return { ok: false, error: '리프 항목만 발행할 수 있습니다.' }

  const { data, error } = await admin.from('agent_work_orders')
    .insert({
      project_id: projectId, wbs_item_id: wbsItemId,
      instructions: instructions.trim(), priority: Math.trunc(priority) || 0,
      created_by: g.actor.userId,
    })
    .select('id')
  if (error) return { ok: false, error: error.message }
  const id = (data?.[0] as { id?: string } | undefined)?.id
  if (!id) return { ok: false, error: '발행에 실패했습니다.' }
  revalidatePath(AGENT_OPS_PATH)
  return { ok: true, id }
}

async function loadOrderForAdmin(orderId: string): Promise<
  | { ok: true; order: { id: string; project_id: string; status: string; wbs_item_id: string | null } }
  | { ok: false; error: string }
> {
  const admin = createAdminClient()
  const { data: order, error } = await admin
    .from('agent_work_orders').select('id, project_id, status, wbs_item_id').eq('id', orderId).maybeSingle()
  if (error) return { ok: false, error: `주문 조회 실패: ${error.message}` }
  if (!order) return { ok: false, error: '주문 없음' }
  const row = order as { id: string; project_id: string; status: string; wbs_item_id: string | null }
  const g = await requireProjectAdmin(row.project_id)
  if (!g.ok) return { ok: false, error: g.error }
  return { ok: true, order: row }
}

/** 승인 — WBS 100% 반영이 먼저다. 반영 실패면 주문은 reported 로 남아 재시도 가능해야 한다. */
export async function approveAgentCompletion(orderId: string): Promise<ActionResult> {
  const loaded = await loadOrderForAdmin(orderId)
  if (!loaded.ok) return loaded
  const { order } = loaded
  if (order.status !== 'reported') return { ok: false, error: `승인 가능한 상태가 아닙니다(${order.status}).` }
  if (!order.wbs_item_id) return { ok: false, error: 'WBS 항목이 삭제된 주문입니다. 취소로 정리하세요.' }

  const applied = await updateActual(order.wbs_item_id, 100)
  if (!applied.ok) return { ok: false, error: applied.error ?? 'WBS 반영 실패' }

  const admin = createAdminClient()
  const g = await requireProjectAdmin(order.project_id)
  if (!g.ok) return { ok: false, error: g.error }
  const now = new Date().toISOString()
  const { data: updated, error: casErr } = await admin
    .from('agent_work_orders')
    .update({ status: 'approved', updated_at: now })
    .eq('id', orderId).eq('status', 'reported')
    .select('id')
  if (casErr) return { ok: false, error: casErr.message }
  if (!updated || updated.length === 0) {
    // WBS 는 100 이 됐는데 주문 전이가 경합으로 밀렸다 — 재시도하면 updateActual(100) 은 멱등.
    return { ok: false, error: '상태가 바뀌어 승인하지 못했습니다. 다시 시도하세요.' }
  }
  const { data: latest, error: latestErr } = await admin
    .from('agent_work_reports').select('id').eq('work_order_id', orderId).eq('kind', 'completion')
    .order('created_at', { ascending: false }).limit(1).maybeSingle()
  if (latestErr || !latest) {
    console.error('[agentWork] 승인 보고 조회 실패:', latestErr?.message ?? '0행')
  } else {
    const { error: revErr } = await admin.from('agent_work_reports')
      .update({ review_action: 'approve', reviewed_by: g.actor.userId, reviewed_at: now })
      .eq('id', (latest as { id: string }).id).select('id')
    if (revErr) console.error('[agentWork] 승인 기록 실패:', revErr.message)
  }
  revalidatePath(AGENT_OPS_PATH)
  return { ok: true }
}

export async function rejectAgentCompletion(orderId: string, note: string): Promise<ActionResult> {
  const trimmed = note.trim()
  if (!trimmed) return { ok: false, error: '반려 사유가 필요합니다.' }
  const loaded = await loadOrderForAdmin(orderId)
  if (!loaded.ok) return loaded
  if (loaded.order.status !== 'reported') {
    return { ok: false, error: `반려 가능한 상태가 아닙니다(${loaded.order.status}).` }
  }
  const admin = createAdminClient()
  const g = await requireProjectAdmin(loaded.order.project_id)
  if (!g.ok) return { ok: false, error: g.error }
  const now = new Date().toISOString()
  const { data: updated, error: casErr } = await admin
    .from('agent_work_orders')
    .update({ status: 'claimed', updated_at: now })
    .eq('id', orderId).eq('status', 'reported')
    .select('id')
  if (casErr) return { ok: false, error: casErr.message }
  if (!updated || updated.length === 0) return { ok: false, error: '상태가 바뀌어 반려하지 못했습니다.' }
  const { data: latest, error: latestErr } = await admin
    .from('agent_work_reports').select('id').eq('work_order_id', orderId).eq('kind', 'completion')
    .order('created_at', { ascending: false }).limit(1).maybeSingle()
  if (latestErr || !latest) {
    console.error('[agentWork] 반려 보고 조회 실패:', latestErr?.message ?? '0행')
  } else {
    const { error: revErr } = await admin.from('agent_work_reports')
      .update({ review_action: 'reject', reviewed_by: g.actor.userId, reviewed_at: now, review_note: trimmed })
      .eq('id', (latest as { id: string }).id).select('id')
    if (revErr) console.error('[agentWork] 반려 기록 실패:', revErr.message)
  }
  revalidatePath(AGENT_OPS_PATH)
  return { ok: true }
}

export async function reclaimAgentOrder(orderId: string): Promise<ActionResult> {
  const loaded = await loadOrderForAdmin(orderId)
  if (!loaded.ok) return loaded
  if (loaded.order.status !== 'claimed') return { ok: false, error: '점유 상태가 아닙니다.' }
  const admin = createAdminClient()
  const { data: updated, error } = await admin
    .from('agent_work_orders')
    .update({ status: 'ready', claimed_by: null, claimed_at: null, updated_at: new Date().toISOString() })
    .eq('id', orderId).eq('status', 'claimed')
    .select('id')
  if (error) return { ok: false, error: error.message }
  if (!updated || updated.length === 0) return { ok: false, error: '상태가 바뀌어 회수하지 못했습니다.' }
  revalidatePath(AGENT_OPS_PATH)
  return { ok: true }
}

export async function cancelAgentOrder(orderId: string): Promise<ActionResult> {
  const loaded = await loadOrderForAdmin(orderId)
  if (!loaded.ok) return loaded
  if (!['ready', 'claimed', 'reported'].includes(loaded.order.status)) {
    return { ok: false, error: '취소 가능한 상태가 아닙니다.' }
  }
  const admin = createAdminClient()
  const { data: updated, error } = await admin
    .from('agent_work_orders')
    .update({ status: 'cancelled', updated_at: new Date().toISOString() })
    .eq('id', orderId).in('status', ['ready', 'claimed', 'reported'])
    .select('id')
  if (error) return { ok: false, error: error.message }
  if (!updated || updated.length === 0) return { ok: false, error: '상태가 바뀌어 취소하지 못했습니다.' }
  revalidatePath(AGENT_OPS_PATH)
  return { ok: true }
}

export type AgentOpsReport = {
  id: string; kind: 'progress' | 'completion'; percent: number; summary: string
  links: { label?: string; url: string }[]; agent: string
  review_action: 'approve' | 'reject' | null; review_note: string | null; created_at: string
}
export type AgentOpsOrder = {
  id: string; status: string; priority: number; instructions: string
  claimed_by: string | null; claimed_at: string | null; updated_at: string
  wbs_item_id: string | null; item_name: string | null; item_code: string | null
  reports: AgentOpsReport[]
}

/** 관제 보드 데이터 — 세션 클라이언트(RLS 조회 정책이 2차 방어선). 조회 실패는 위장하지 않는다. */
export async function fetchAgentOps(projectId: string): Promise<
  | { ok: true; registered: boolean; orders: AgentOpsOrder[] }
  | { ok: false; error: string }
> {
  const sb = await createServerClient()
  const { data: reg, error: regErr } = await sb
    .from('agent_projects').select('project_id, enabled').eq('project_id', projectId).maybeSingle()
  if (regErr) return { ok: false, error: `등록 조회 실패: ${regErr.message}` }
  if (!reg) return { ok: true, registered: false, orders: [] }

  const { data: orders, error: ordErr } = await sb
    .from('agent_work_orders')
    .select('id, status, priority, instructions, claimed_by, claimed_at, updated_at, wbs_item_id')
    .eq('project_id', projectId)
    .order('updated_at', { ascending: false })
  if (ordErr) return { ok: false, error: `주문 조회 실패: ${ordErr.message}` }
  const rows = (orders ?? []) as Array<Omit<AgentOpsOrder, 'reports' | 'item_name' | 'item_code'>>

  const itemIds = [...new Set(rows.map(o => o.wbs_item_id).filter((v): v is string => !!v))]
  const itemById = new Map<string, { name: string; code: string }>()
  if (itemIds.length > 0) {
    const { data: items, error: itemErr } = await sb
      .from('wbs_items').select('id, name, code').in('id', itemIds)
    if (itemErr) return { ok: false, error: `항목 조회 실패: ${itemErr.message}` }
    for (const it of (items ?? []) as Array<{ id: string; name: string; code: string }>) {
      itemById.set(it.id, { name: it.name, code: it.code })
    }
  }
  const orderIds = rows.map(o => o.id)
  const reportsByOrder = new Map<string, AgentOpsReport[]>()
  if (orderIds.length > 0) {
    const { data: reports, error: repErr } = await sb
      .from('agent_work_reports')
      .select('id, work_order_id, kind, percent, summary, links, agent, review_action, review_note, created_at')
      .in('work_order_id', orderIds)
      .order('created_at', { ascending: true })
    if (repErr) return { ok: false, error: `보고 조회 실패: ${repErr.message}` }
    for (const r of (reports ?? []) as Array<AgentOpsReport & { work_order_id: string }>) {
      const list = reportsByOrder.get(r.work_order_id) ?? []
      list.push(r)
      reportsByOrder.set(r.work_order_id, list)
    }
  }
  return {
    ok: true, registered: (reg as { enabled: boolean }).enabled,
    orders: rows.map(o => ({
      ...o,
      item_name: o.wbs_item_id ? itemById.get(o.wbs_item_id)?.name ?? null : null,
      item_code: o.wbs_item_id ? itemById.get(o.wbs_item_id)?.code ?? null : null,
      reports: reportsByOrder.get(o.id) ?? [],
    })),
  }
}
```

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run tests/actions/agent-work-actions.test.ts`
Expected: PASS

- [ ] **Step 5: 커밋**

```bash
git add src/app/actions/agentWork.ts tests/actions/agent-work-actions.test.ts
git commit -m "feat(agent): 발행·승인·반려·회수 서버 액션 — 승인은 updateActual 재사용

승인 시 WBS 100% 반영이 주문 전이보다 먼저다 — 실패하면 주문이
reported 로 남아 재시도가 성립한다(역순이면 승인됐는데 실적이
안 박힌 주문이 생긴다). updateActual 호출로 기존 검증·이력·스냅샷
경로를 그대로 상속한다.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 9: 관제 UI (`/agent-ops`) + i18n

**Files:**
- Create: `src/app/(app)/agent-ops/page.tsx`
- Create: `src/components/agent/AgentOpsView.tsx`
- Create: `src/lib/i18n/dict/agentOps.ts`
- Modify: `src/lib/i18n/dict.ts` (import + spread 2줄 추가 — minutes 와 같은 방식, `dict.ts:17,38,56` 참조)

**주의:** `src/components/app/*` 는 절대 수정하지 않는다(사이드바 메뉴 제외 — Global Constraints). 신규 파일 + dict.ts 2줄이 전부다.

**Interfaces:**
- Consumes: Task 8 의 모든 액션 + `AgentOpsOrder` 타입, `useLocale`(`@/components/providers/LocaleProvider`), `Modal`(`@/components/ui/Modal`), `EmptyState`(`@/components/ui/EmptyState`), `useToast`(`@/components/ui/Toast`), `isClaimStale`(Task 2)
- Produces: 페이지 `/agent-ops?project=<id>`

- [ ] **Step 1: i18n 사전 작성**

`src/lib/i18n/dict/agentOps.ts`:

```ts
export const agentOpsKo = {
  'agentops.title': '에이전트 관제',
  'agentops.desc': 'WBS 작업을 에이전트에 발행하고, 보고를 확인·승인합니다.',
  'agentops.notRegistered': '이 프로젝트는 에이전트 루프가 등록되지 않았습니다.',
  'agentops.register': '루프 등록 (슈퍼유저)',
  'agentops.unregister': '등록 해제',
  'agentops.issue': '작업 발행',
  'agentops.issueItem': '대상 리프 항목',
  'agentops.issueInstructions': '지시문',
  'agentops.issuePriority': '우선순위',
  'agentops.issueSubmit': '발행',
  'agentops.col.ready': '대기',
  'agentops.col.claimed': '작업 중',
  'agentops.col.reported': '승인 대기',
  'agentops.col.done': '완료·취소',
  'agentops.stale': '응답 없음',
  'agentops.reclaim': '회수',
  'agentops.cancel': '취소',
  'agentops.approve': '승인',
  'agentops.reject': '반려',
  'agentops.rejectNote': '반려 사유 (필수)',
  'agentops.reports': '보고 이력',
  'agentops.links': '증적 링크',
  'agentops.empty': '작업이 없습니다',
  'agentops.error': '불러오지 못했습니다',
  'agentops.actionFailed': '처리에 실패했습니다',
}

export const agentOpsEn: Record<keyof typeof agentOpsKo, string> = {
  'agentops.title': 'Agent Ops',
  'agentops.desc': 'Issue WBS work to agents, review and approve reports.',
  'agentops.notRegistered': 'Agent loop is not registered for this project.',
  'agentops.register': 'Register loop (superuser)',
  'agentops.unregister': 'Unregister',
  'agentops.issue': 'Issue work',
  'agentops.issueItem': 'Target leaf item',
  'agentops.issueInstructions': 'Instructions',
  'agentops.issuePriority': 'Priority',
  'agentops.issueSubmit': 'Issue',
  'agentops.col.ready': 'Ready',
  'agentops.col.claimed': 'In progress',
  'agentops.col.reported': 'Awaiting approval',
  'agentops.col.done': 'Done / cancelled',
  'agentops.stale': 'No response',
  'agentops.reclaim': 'Reclaim',
  'agentops.cancel': 'Cancel',
  'agentops.approve': 'Approve',
  'agentops.reject': 'Reject',
  'agentops.rejectNote': 'Rejection note (required)',
  'agentops.reports': 'Reports',
  'agentops.links': 'Evidence links',
  'agentops.empty': 'No work orders',
  'agentops.error': 'Failed to load',
  'agentops.actionFailed': 'Action failed',
}
```

`src/lib/i18n/dict.ts` 에 minutes 와 같은 방식으로 2곳 추가:

```ts
import { agentOpsKo, agentOpsEn } from './dict/agentOps'
// ko spread 블록에:
  ...agentOpsKo,
// en spread 블록에:
  ...agentOpsEn,
```

- [ ] **Step 2: 페이지(서버 컴포넌트) 작성**

`src/app/(app)/agent-ops/page.tsx`:

```tsx
import { createServerClient } from '@/lib/supabase/server'
import { AgentOpsView } from '@/components/agent/AgentOpsView'

export const dynamic = 'force-dynamic'

/**
 * 에이전트 관제 — 스펙 §5. 사이드바 미노출(1차 범위 제외), URL 직접 접근.
 * 데이터는 클라이언트에서 fetchAgentOps 액션으로 읽는다(RLS 조회 정책이 2차 방어선).
 */
export default async function AgentOpsPage() {
  const sb = await createServerClient()
  // 조회 실패는 빈 목록으로 위장하지 않는다 — 에러 문자열을 뷰에 넘겨 표시한다.
  const { data: projects, error } = await sb.from('projects').select('id, name').order('name')
  return (
    <AgentOpsView
      projects={(projects ?? []) as { id: string; name: string }[]}
      loadError={error ? error.message : null}
    />
  )
}
```

- [ ] **Step 3: 클라이언트 뷰 작성**

`src/components/agent/AgentOpsView.tsx` — 골격(전체 코드). 스타일은 기존 유틸 클래스(`btn`, `btn-primary`, `app-input`)와 공용 프리미티브만 쓴다:

```tsx
'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useLocale } from '@/components/providers/LocaleProvider'
import { Modal } from '@/components/ui/Modal'
import { EmptyState } from '@/components/ui/EmptyState'
import { useToast } from '@/components/ui/Toast'
import { isClaimStale } from '@/lib/domain/agentWork'
import {
  approveAgentCompletion, cancelAgentOrder, createAgentWorkOrder, fetchAgentOps,
  reclaimAgentOrder, registerAgentProject, rejectAgentCompletion, unregisterAgentProject,
  type AgentOpsOrder,
} from '@/app/actions/agentWork'

const COLS = ['ready', 'claimed', 'reported', 'done'] as const

export function AgentOpsView({ projects, loadError }: {
  projects: { id: string; name: string }[]
  loadError: string | null
}) {
  const { t } = useLocale()
  const toast = useToast()
  const [projectId, setProjectId] = useState(projects[0]?.id ?? '')
  const [registered, setRegistered] = useState(false)
  const [orders, setOrders] = useState<AgentOpsOrder[]>([])
  const [error, setError] = useState<string | null>(loadError)
  const [detail, setDetail] = useState<AgentOpsOrder | null>(null)
  const [rejectNote, setRejectNote] = useState('')
  const [issueOpen, setIssueOpen] = useState(false)
  const [issueItemId, setIssueItemId] = useState('')
  const [issueInstructions, setIssueInstructions] = useState('')
  const [issuePriority, setIssuePriority] = useState(0)
  const [busy, setBusy] = useState(false)

  const reload = useCallback(async () => {
    if (!projectId) return
    const r = await fetchAgentOps(projectId)
    if (!r.ok) { setError(r.error); return }
    setError(null)
    setRegistered(r.registered)
    setOrders(r.orders)
  }, [projectId])
  useEffect(() => { void reload() }, [reload])

  const byCol = useMemo(() => ({
    ready: orders.filter(o => o.status === 'ready'),
    claimed: orders.filter(o => o.status === 'claimed'),
    reported: orders.filter(o => o.status === 'reported'),
    done: orders.filter(o => o.status === 'approved' || o.status === 'cancelled'),
  }), [orders])

  async function run(action: () => Promise<{ ok: boolean; error?: string }>) {
    setBusy(true)
    try {
      const r = await action()
      if (!r.ok) toast.error(r.error ?? t('agentops.actionFailed'))
      await reload()
      setDetail(null)
      setRejectNote('')
    } finally { setBusy(false) }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-lg font-semibold">{t('agentops.title')}</h1>
        <select className="app-input h-9 w-56" value={projectId} onChange={e => setProjectId(e.target.value)}>
          {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        {registered ? (
          <>
            <button className="btn btn-primary" onClick={() => setIssueOpen(true)}>{t('agentops.issue')}</button>
            <button className="btn" disabled={busy}
              onClick={() => void run(() => unregisterAgentProject(projectId))}>{t('agentops.unregister')}</button>
          </>
        ) : (
          <button className="btn" disabled={busy}
            onClick={() => void run(() => registerAgentProject(projectId, ''))}>{t('agentops.register')}</button>
        )}
      </div>
      <p className="text-sm text-ink-subtle">{t('agentops.desc')}</p>
      {error && <p className="text-sm text-red-600">{t('agentops.error')}: {error}</p>}
      {!error && !registered && <EmptyState title={t('agentops.notRegistered')} description="" />}

      {registered && (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
          {COLS.map(col => (
            <section key={col} className="rounded-lg border border-border p-2">
              <h2 className="mb-2 text-sm font-medium">{t(`agentops.col.${col}`)} ({byCol[col].length})</h2>
              <div className="space-y-2">
                {byCol[col].length === 0 && <p className="text-xs text-ink-subtle">{t('agentops.empty')}</p>}
                {byCol[col].map(o => (
                  <button key={o.id} className="block w-full rounded-md border border-border p-2 text-left text-sm"
                    onClick={() => setDetail(o)}>
                    <div className="font-medium">{o.item_code} {o.item_name ?? '(항목 삭제됨)'}</div>
                    <div className="text-xs text-ink-subtle">
                      {o.claimed_by ?? '—'}
                      {o.status === 'claimed' && isClaimStale(o.claimed_at) && (
                        <span className="ml-1 text-red-600">{t('agentops.stale')}</span>
                      )}
                      {' · '}{o.reports.at(-1)?.percent ?? 0}%
                    </div>
                  </button>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}

      <Modal open={issueOpen} onClose={() => setIssueOpen(false)} title={t('agentops.issue')} size="md">
        <div className="space-y-3">
          <label className="block text-sm">{t('agentops.issueItem')}
            <input className="app-input mt-1 w-full" value={issueItemId}
              onChange={e => setIssueItemId(e.target.value)} placeholder="WBS 항목 ID (트리에서 복사)" />
          </label>
          <label className="block text-sm">{t('agentops.issueInstructions')}
            <textarea className="app-input mt-1 h-28 w-full" value={issueInstructions}
              onChange={e => setIssueInstructions(e.target.value)} />
          </label>
          <label className="block text-sm">{t('agentops.issuePriority')}
            <input type="number" className="app-input mt-1 w-24" value={issuePriority}
              onChange={e => setIssuePriority(Number(e.target.value))} />
          </label>
          <button className="btn btn-primary" disabled={busy || !issueItemId.trim()}
            onClick={() => void run(async () => {
              const r = await createAgentWorkOrder(projectId, issueItemId.trim(), issueInstructions, issuePriority)
              if (r.ok) setIssueOpen(false)
              return r
            })}>{t('agentops.issueSubmit')}</button>
        </div>
      </Modal>

      <Modal open={!!detail} onClose={() => setDetail(null)} title={detail?.item_name ?? ''} size="md">
        {detail && (
          <div className="space-y-3 text-sm">
            <p className="whitespace-pre-wrap">{detail.instructions}</p>
            <h3 className="font-medium">{t('agentops.reports')}</h3>
            <ul className="space-y-2">
              {detail.reports.map(r => (
                <li key={r.id} className="rounded-md border border-border p-2">
                  <div className="text-xs text-ink-subtle">{r.created_at} · {r.agent} · {r.kind} · {r.percent}%
                    {r.review_action && ` · ${r.review_action}${r.review_note ? `: ${r.review_note}` : ''}`}</div>
                  <p className="whitespace-pre-wrap">{r.summary}</p>
                  {r.links.length > 0 && (
                    <div className="mt-1 text-xs">
                      {t('agentops.links')}: {r.links.map((l, i) => (
                        <a key={i} className="mr-2 underline" href={l.url} target="_blank" rel="noreferrer">
                          {l.label ?? l.url}
                        </a>
                      ))}
                    </div>
                  )}
                </li>
              ))}
            </ul>
            <div className="flex flex-wrap gap-2">
              {detail.status === 'reported' && (
                <>
                  <button className="btn btn-primary" disabled={busy}
                    onClick={() => void run(() => approveAgentCompletion(detail.id))}>{t('agentops.approve')}</button>
                  <input className="app-input h-9 w-56" placeholder={t('agentops.rejectNote')}
                    value={rejectNote} onChange={e => setRejectNote(e.target.value)} />
                  <button className="btn" disabled={busy || !rejectNote.trim()}
                    onClick={() => void run(() => rejectAgentCompletion(detail.id, rejectNote))}>{t('agentops.reject')}</button>
                </>
              )}
              {detail.status === 'claimed' && (
                <button className="btn" disabled={busy}
                  onClick={() => void run(() => reclaimAgentOrder(detail.id))}>{t('agentops.reclaim')}</button>
              )}
              {['ready', 'claimed', 'reported'].includes(detail.status) && (
                <button className="btn" disabled={busy}
                  onClick={() => void run(() => cancelAgentOrder(detail.id))}>{t('agentops.cancel')}</button>
              )}
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}
```

구현 시 확인: `useToast`·`Modal`·`EmptyState` 의 실제 시그니처가 다르면 **그 컴포넌트 쪽에 맞춘다**(회의록 컴포넌트의 사용례가 정본). 발행 폼의 항목 선택은 1차에서 ID 직접 입력으로 시작한다(WBS 트리 픽커는 후속 — YAGNI).

- [ ] **Step 4: 빌드·린트·타입 검증**

Run: `npx tsc --noEmit && npx eslint src/app/\(app\)/agent-ops src/components/agent src/lib/i18n/dict/agentOps.ts src/app/actions/agentWork.ts && npm run build`
Expected: 전부 통과 (dict 키 타입 parity 는 `Record<keyof typeof agentOpsKo, string>` 가 컴파일 타임에 강제)

- [ ] **Step 5: 커밋**

```bash
git add "src/app/(app)/agent-ops/page.tsx" src/components/agent/AgentOpsView.tsx src/lib/i18n/dict/agentOps.ts src/lib/i18n/dict.ts
git commit -m "feat(agent): 관제 화면 /agent-ops — 발행·보드·승인, 사이드바 미노출

1차는 URL 직접 접근이다(스펙 §5) — components/app 무접촉으로
D-CUBE 화면 회귀 표면적을 0으로 유지한다. 메뉴는 안정화 후 별도 배포.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 10: 계약 문서 + 레퍼런스 하네스

**Files:**
- Create: `docs/design/dflow-agent-work-api-spec.md`
- Create: `scripts/agent-harness-example.mjs`

**Interfaces:**
- Consumes: Task 5~7 의 응답 계약(그 모양을 문서·스크립트에 그대로 옮긴다)

- [ ] **Step 1: 계약 문서 작성**

`docs/design/dflow-agent-work-api-spec.md` — 다음 목차로, Task 5~7 의 요청/응답 JSON 을 예시와 함께 명세한다(스펙 §3 을 하네스 개발자 관점으로 풀어쓴 것):

```markdown
# D'Flow 에이전트 작업 API 계약 v1.0

1. 개요 — 루프 그림(스펙 §1 다이어그램 재수록), 완성 인지 원칙(스펙 §3.4)
2. 인증 — Bearer AGENT_API_SECRET, user_email/agent 의미, 404 존재 은닉
3. 엔드포인트 5개 — 요청/응답 JSON 예시 전수
   - GET /api/v1/agent/work?project_id=
   - POST /api/v1/agent/work/{id}/claim
   - POST /api/v1/agent/work/{id}/report  (progress vs completion, 100 규칙)
   - POST /api/v1/agent/work/{id}/release
   - GET /api/v1/agent/work/{id}
4. 오류 코드 표 — validation_failed / unauthorized / unknown_user / forbidden_role /
   conflict / not_claim_owner / wbs_item_missing / apply_failed / internal_error
5. 하네스 규약 — 폴링 주기(권장 60s+), completion 전 빌드·테스트 자체 검증,
   summary 에 검증 결과 포함, 반려 사유는 GET 상세의 reports[].review_note 에서 읽기
6. Claude Code CLI 하네스 두 모드(스펙 §3.3 표 재수록) + 예제 스크립트 사용법
```

- [ ] **Step 2: 레퍼런스 하네스 스크립트 작성**

`scripts/agent-harness-example.mjs` (헤드리스 모드 최소 구현 — 실전 하네스의 출발점):

```js
#!/usr/bin/env node
/**
 * 에이전트 작업 루프 레퍼런스 하네스 (헤드리스 모드 예시).
 * 사용: AGENT_BASE=https://wbs-web.vercel.app AGENT_SECRET=... AGENT_EMAIL=dev@example.com \
 *      AGENT_NAME=claude-cli-dev1 AGENT_PROJECT=<uuid> REPO_DIR=/path/to/repo \
 *      node scripts/agent-harness-example.mjs
 * 전제: 로컬에 claude CLI 로그인 완료. 1회 실행 = 주문 1건 처리(크론/루프는 사용자 몫).
 */
import { execFileSync } from 'node:child_process'

const { AGENT_BASE, AGENT_SECRET, AGENT_EMAIL, AGENT_NAME, AGENT_PROJECT, REPO_DIR } = process.env
for (const [k, v] of Object.entries({ AGENT_BASE, AGENT_SECRET, AGENT_EMAIL, AGENT_NAME, AGENT_PROJECT, REPO_DIR })) {
  if (!v) { console.error(`env ${k} 필요`); process.exit(1) }
}

async function api(path, init = {}) {
  const res = await fetch(`${AGENT_BASE}/api/v1${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${AGENT_SECRET}`, ...init.headers },
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(`${path} → ${res.status} ${JSON.stringify(body)}`)
  return body
}
const actor = { user_email: AGENT_EMAIL, agent: AGENT_NAME }

const { orders } = await api(`/agent/work?project_id=${AGENT_PROJECT}`)
if (orders.length === 0) { console.log('ready 작업 없음'); process.exit(0) }
const order = orders[0]
console.log(`claim: ${order.item?.code} ${order.item?.name}`)
await api(`/agent/work/${order.id}/claim`, { method: 'POST', body: JSON.stringify(actor) })

const prompt = [
  `너는 D'Flow WBS 작업을 수행하는 에이전트다. 아래 작업을 이 리포에서 구현하라.`,
  `## WBS 항목`, `- 코드: ${order.item?.code}`, `- 이름: ${order.item?.name}`,
  `- 업무내용: ${order.item?.biz ?? '-'}`, `- 산출물: ${order.item?.deliverable ?? '-'}`,
  `## 지시문`, order.instructions || '(없음)',
  `## 완료 조건`, `- 구현 후 빌드·테스트를 실행해 통과를 확인하고 커밋한다.`,
  `- 마지막 출력 줄에 JSON 한 줄만 출력한다: {"summary":"...", "links":[{"url":"<커밋/PR URL>"}]}`,
].join('\n')

let result
try {
  const out = execFileSync('claude', ['-p', prompt], { cwd: REPO_DIR, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] })
  const lastJson = out.trim().split('\n').reverse().find(l => l.trim().startsWith('{'))
  result = lastJson ? JSON.parse(lastJson) : { summary: out.slice(-2000), links: [] }
} catch (e) {
  // 실패 = 진척 없음으로 보고하고 점유 반납 — 침묵이 좀비 점유로 남지 않게 한다.
  await api(`/agent/work/${order.id}/report`, {
    method: 'POST',
    body: JSON.stringify({ ...actor, kind: 'progress', percent: 0, summary: `실패: ${e.message}`.slice(0, 2000) }),
  })
  await api(`/agent/work/${order.id}/release`, { method: 'POST', body: JSON.stringify(actor) })
  process.exit(1)
}

await api(`/agent/work/${order.id}/report`, {
  method: 'POST',
  body: JSON.stringify({ ...actor, kind: 'completion', percent: 100, summary: result.summary, links: result.links ?? [] }),
})
console.log('completion 보고 완료 — 승인은 /agent-ops 에서')
```

- [ ] **Step 3: 커밋**

```bash
git add docs/design/dflow-agent-work-api-spec.md scripts/agent-harness-example.mjs
git commit -m "docs(agent): API 계약 v1.0 + 헤드리스 하네스 레퍼런스

하네스 개발자(사람·CLI)가 서버 코드를 읽지 않고 루프를 붙일 수
있어야 한다. 실패 시 progress 0 보고 + release 로 침묵-좀비를
막는 규약을 예제에 박았다.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 11: 배포·런타임 검증 (사람 개입 구간)

**Files:** 없음 (운영 절차)

- [ ] **Step 1: 전체 회귀 확인**

Run: `npm run test && npm run lint && npm run build`
Expected: 전량 초록 (기존 vitest 포함 — D-CUBE 무영향 증명 ③)

- [ ] **Step 2: main 푸시 → Vercel 배포**

```bash
git push origin main
# vercel inspect 로 Ready 확인 (deploy 스킬 절차)
npm run smoke:prod
```

주의: 이 시점엔 `AGENT_API_ENABLED` env 가 없어 **에이전트 API 는 전부 404(fail-closed)** — 코드가 먼저 나가도 아무것도 열리지 않는다.

- [ ] **Step 3: 마이그레이션 0057 적용 (Supabase Management API)**

키체인 토큰 → `/database/query` 로 0057 SQL 적용(supabase-mgmt-api-recipe 메모리의 레시피, `db push` 금지). 적용 후 검증:

```sql
select table_name from information_schema.tables
 where table_name in ('agent_projects','agent_work_orders','agent_work_reports');
-- 3행이어야 한다
```

- [ ] **Step 4: env 개통**

```bash
openssl rand -hex 32   # 시크릿 생성 (값은 키체인/1password 에 보관)
printf '<시크릿>' | vercel env add AGENT_API_SECRET production
printf 'true' | vercel env add AGENT_API_ENABLED production
vercel redeploy <현재 prod URL>   # env 적용 재배포
```

- [ ] **Step 5: D-CUBE 무영향 프로브 (읽기 전용)**

```bash
# D-CUBE 는 미등록 → 404 여야 한다 (무영향 증명 ②)
curl -s -o /dev/null -w "%{http_code}\n" \
  -H "Authorization: Bearer $AGENT_SECRET" \
  "https://wbs-web.vercel.app/api/v1/agent/work?project_id=7a1c6034-a647-4673-ae85-d0b6daa2f6f3"
# 기대: 404
```

- [ ] **Step 6: 샘플 프로젝트 E2E 1루프**

1. `/projects` 에서 전용 샘플 프로젝트 생성(또는 기존 테스트 프로젝트 재사용 — D-CUBE 데이터 보호 결정)
2. 샘플 WBS 임포트(리프 1개 이상)
3. `/agent-ops` 에서 루프 등록(슈퍼유저) → 리프에 작업 발행
4. 로컬에서 `scripts/agent-harness-example.mjs` 실행 → claim→구현→completion 보고 확인
5. `/agent-ops` 승인 → 샘플 WBS 실적 100% 확인, `change_logs` 행 확인
6. `npm run smoke:prod` 재실행 → 통과 시 `npm run mark:good` (화면 확인 후)

- [ ] **Step 7: 완료 보고**

배포 커밋 해시·프로브 결과(D-CUBE 404)·E2E 루프 결과를 사용자에게 보고하고, 메모리에 기능 상태를 기록한다.

---

## Self-Review 결과 (계획 작성 시점)

- **스펙 커버리지**: §1 안전 경계(T1·T5·T9·T11) · §2 데이터 모델(T1) · §3.1~3.2 API(T3·T5~7) · §3.3 하네스(T10) · §3.4 완성 인지(T5 상세·T10 규약) · §4 반영 규칙(T4·T7·T8 승인) · §5 UI(T9, 사이드바 제외 준수) · §6 에러(전 태스크 + T2 좀비 판정) · §7 검증(각 태스크 테스트 + T11) — 공백 없음.
- **타입 일관성**: `parseAgentActor`/`loadGatedOrder` 는 T6 정의를 T7 이 import. `AgentOpsOrder` 는 T8 정의를 T9 가 import. percent 규칙은 T2 `validateReport` 단일 원천(T4 는 방어적 재검증).
- **알려진 유의점**: T9 의 공용 컴포넌트(Modal/Toast) 시그니처는 구현 시 실물 확인 — 계획의 사용례가 다르면 실물이 이긴다. 쓰기 라우트 공용 헬퍼는 처음부터 `src/lib/agent/routeShared.ts` 에 있다 — App Router 가 라우트 파일의 임의 export 를 빌드에서 거부하기 때문(라우트 파일로 되돌리지 말 것).
```
