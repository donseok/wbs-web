# 무인 개발 루프 ⓐ 신원·보안 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 무인 러너가 쓸 자격증명을 합법 경로로 만들 수 있게 하고, 그 토큰이 전역 등급이나 마스터 시크릿으로 번지는 경로를 닫는다.

**Architecture:** 설계 `docs/superpowers/specs/2026-08-19-unattended-dev-loop-design.md` 의 P0 중 세 건 — P0-5(legacy 시크릿 차단) · P0-6(러너 PAT 발급 경로) · P0-12(자기승인 방지) — 을 구현한다. 기존 `agent_runners`(0078) 테이블과 PAT 리졸버를 그대로 쓰고, 발급 규칙과 멤버 판정 두 곳만 좁힌다. 신규 테이블·신규 API 라우트는 없다.

**Tech Stack:** Next.js 15 App Router · TypeScript · Supabase(service_role) · Vitest · Tailwind v4

---

## 왜 이 덩어리가 먼저인가

지금 `work:report` 스코프를 발급할 코드 경로가 **없다**(`SELF_ISSUE_SCOPES` 가 거부, 관리자 발급 미구현, `kind='runner'` 를 만드는 insert 0건). 러너는 완료 보고가 필수이므로 남는 선택지가 둘뿐인데 둘 다 나쁘다 — `agent_runners` SQL 직삽입(만료 상한·이름 규칙·스코프 화이트리스트 전량 우회) 또는 `AGENT_API_SECRET`(스코프·프로젝트 한정·멤버십을 전부 우회하고 본문 `user_email` 이 그대로 신원이 된다).

**즉 이 덩어리를 건너뛰면 나머지 P0 를 구현해도 돌려볼 방법이 없다.**

## 사전 확인

- [ ] **기준 커밋 확인**

Run: `git log --oneline -1`
Expected: `77b3325` 이상 (설계 문서가 들어와 있어야 한다)

- [ ] **현재 테스트가 초록인지 확인**

Run: `npm run test -- --run tests/agent tests/actions/agent-tokens.test.ts tests/actions/agent-work-actions.test.ts`
Expected: 전부 PASS. 여기서 빨간 것이 있으면 이 계획을 시작하지 않는다.

- [ ] **`kind='runner'` 잔존 행 확인** (Task 2 의 제약이 기존 행을 깨는지)

운영·스테이징 각각에서 Supabase SQL 로 확인:
```sql
select id, name, owner_user_id, project_id from public.agent_runners where kind = 'runner';
```
Expected: 0행. 행이 있고 `project_id` 가 null 이면 Task 2 마이그레이션이 실패하므로, 먼저 그 행에 프로젝트를 채우거나 폐기한다.

---

## File Structure

| 파일 | 책임 | 신규/수정 |
|---|---|---|
| `supabase/migrations/0087_agent_runner_project_required.sql` | `kind='runner'` 는 `project_id` 필수 — SQL 직삽입도 같은 규칙을 받게 하는 DB 층 방어선 | 신규 |
| `supabase/migrations/0087_agent_runner_project_required_rollback.sql` | 위 제약 제거 | 신규 |
| `src/lib/agent/externalApi.ts` | ① `isAgentProjectMember` 에 `allowSuperuser` 옵션 ② `principalIsProjectMember` 신설 ③ `legacyAgentApiEnabled` 신설 + 리졸버 배선 | 수정 |
| `src/lib/agent/routeShared.ts` | PAT 멤버 판정을 `principalIsProjectMember` 로 교체 | 수정 |
| `src/app/api/v1/agent/work/route.ts` 외 3개 | 같은 교체 | 수정 |
| `src/app/actions/agentTokens.ts` | `createRunnerToken` 신설 · `createAgentToken` 발급 가드 강화 | 수정 |
| `src/app/actions/agentWork.ts` | `approveAgentCompletion` 에 자기승인 방지 | 수정 |
| `src/components/agent/RunnerTokenSection.tsx` | 러너 토큰 발급 UI(관제탑 안) | 신규 |
| `src/app/(app)/agent-ops/page.tsx` | 위 섹션 배치 | 수정 |
| `src/components/account/MyTokensSection.tsx` | 프로젝트 지정 필수화 | 수정 |
| `docs/agent/claude-skill/dflow-work/references/api-contract.md` · `README.md` | 자격증명 3종 계약·설치 절차 | 수정 |
| `tests/agent/member-gate.test.ts` | `allowSuperuser` 분기 + `principalIsProjectMember` 단위 | 신규 |
| `tests/agent/runner-scope.test.ts` | 러너 토큰의 전역 등급 미상속(라우트 층) | 신규 |
| `tests/agent/legacy-off.test.ts` | 레거시 기본 차단 | 신규 |
| `tests/actions/runner-tokens.test.ts` | `createRunnerToken` 가드 전수 | 신규 |
| `tests/actions/agent-tokens.test.ts` · `agent-work-actions.test.ts` | 자율 발급 가드 · 자기승인 방지 | 수정 |
| `tests/agent/*.ts` (13개) | `AGENT_API_LEGACY='true'` 추가 | 수정 |

`agentTokens.ts` 는 `'use server'` 파일이라 export 가 전부 async 서버 액션이어야 한다 — 상수·순수 헬퍼를 여기에 새로 export 하지 않는다.

---

## Task 1: 멤버 판정에 `allowSuperuser` 축을 만든다

무인 러너 토큰이 전역 등급(`is_superuser`)을 상속하면 **프로젝트를 지정해도 등록된 모든 프로젝트에서 통과**한다. `isAgentProjectMember` 가 `is_superuser` 로 단락하기 때문이다. 판정에 축을 하나 넣되 **기본값은 현행 유지**라 이 태스크만으로는 동작이 변하지 않는다.

**Files:**
- Modify: `src/lib/agent/externalApi.ts:56-75` (`isAgentProjectMember`)
- Modify: `src/lib/agent/externalApi.ts` (파일 끝에 `principalIsProjectMember` 추가)
- Test: `tests/agent/member-gate.test.ts`

- [ ] **Step 1: 실패하는 테스트를 쓴다**

Create `tests/agent/member-gate.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest'

type Resp = { data?: unknown; error?: { message: string } | null }

/** 테이블별 응답을 큐로 준다 — 호출되지 않은 테이블은 큐가 줄지 않는 것으로 검증한다. */
function adminWith(queues: Record<string, Resp[]>) {
  const hits: string[] = []
  return {
    hits,
    admin: {
      from: (table: string) => {
        hits.push(table)
        const resp = (queues[table] ?? []).shift() ?? { data: null, error: null }
        const b: Record<string, unknown> = {}
        for (const k of ['select', 'eq', 'limit']) b[k] = () => b
        b.maybeSingle = async () => ({ data: resp.data ?? null, error: resp.error ?? null })
        b.then = (r: (v: unknown) => unknown) =>
          Promise.resolve({ data: resp.data ?? null, error: resp.error ?? null }).then(r)
        return b
      },
    },
  }
}

const PID = '11111111-1111-4111-8111-111111111111'

beforeEach(() => { vi.clearAllMocks() })

describe('isAgentProjectMember', () => {
  it('기본값은 종전대로 — 슈퍼유저면 project_roles 를 보지 않고 통과', async () => {
    const { isAgentProjectMember } = await import('@/lib/agent/externalApi')
    const { admin, hits } = adminWith({ memberships: [{ data: { is_superuser: true } }] })
    expect(await isAgentProjectMember(admin as never, 'u-1', PID)).toBe(true)
    expect(hits).toEqual(['memberships'])
  })

  it('allowSuperuser:false 면 memberships 를 아예 조회하지 않고 project_roles 만 본다', async () => {
    const { isAgentProjectMember } = await import('@/lib/agent/externalApi')
    const { admin, hits } = adminWith({ project_roles: [{ data: [] }] })
    expect(await isAgentProjectMember(admin as never, 'u-1', PID, { allowSuperuser: false })).toBe(false)
    expect(hits).toEqual(['project_roles'])
  })

  it('allowSuperuser:false 여도 실제 프로젝트 역할이 있으면 통과', async () => {
    const { isAgentProjectMember } = await import('@/lib/agent/externalApi')
    const { admin } = adminWith({ project_roles: [{ data: [{ role: 'member' }] }] })
    expect(await isAgentProjectMember(admin as never, 'u-1', PID, { allowSuperuser: false })).toBe(true)
  })

  it('조회 실패는 fail-closed(false)', async () => {
    const { isAgentProjectMember } = await import('@/lib/agent/externalApi')
    const { admin } = adminWith({ memberships: [{ error: { message: 'boom' } }] })
    expect(await isAgentProjectMember(admin as never, 'u-1', PID)).toBe(false)
  })
})

describe('principalIsProjectMember', () => {
  const patBase = {
    kind: 'pat' as const, runnerId: 'r-1', userId: 'u-1', userEmail: 'a@b.c',
    scopes: [], projectId: null, tokenExpiresAt: '2099-01-01T00:00:00Z',
  }

  it("runnerKind='runner' 는 전역 등급을 상속하지 않는다", async () => {
    const { principalIsProjectMember } = await import('@/lib/agent/externalApi')
    const { admin, hits } = adminWith({ project_roles: [{ data: [] }] })
    const p = { ...patBase, runnerKind: 'runner' as const }
    expect(await principalIsProjectMember(admin as never, p, 'u-1', PID)).toBe(false)
    expect(hits).toEqual(['project_roles'])
  })

  it("runnerKind='user_pat' 은 종전대로 슈퍼유저 단락", async () => {
    const { principalIsProjectMember } = await import('@/lib/agent/externalApi')
    const { admin } = adminWith({ memberships: [{ data: { is_superuser: true } }] })
    const p = { ...patBase, runnerKind: 'user_pat' as const }
    expect(await principalIsProjectMember(admin as never, p, 'u-1', PID)).toBe(true)
  })

  it('legacy principal 은 종전대로 슈퍼유저 단락', async () => {
    const { principalIsProjectMember } = await import('@/lib/agent/externalApi')
    const { admin } = adminWith({ memberships: [{ data: { is_superuser: true } }] })
    expect(await principalIsProjectMember(admin as never, { kind: 'legacy' }, 'u-1', PID)).toBe(true)
  })
})
```

- [ ] **Step 2: 실패를 확인한다**

Run: `npm run test -- --run tests/agent/member-gate.test.ts`
Expected: FAIL — `principalIsProjectMember is not a function`, 그리고 `allowSuperuser:false` 케이스에서 `hits` 가 `['memberships','project_roles']` 로 어긋난다.

- [ ] **Step 3: `isAgentProjectMember` 에 옵션을 넣는다**

`src/lib/agent/externalApi.ts` 의 `isAgentProjectMember` 를 통째로 교체한다:

```ts
/**
 * user_email 계정이 해당 프로젝트 멤버 이상인지 — 기존 3단 권한 축 그대로(스펙 §3.1).
 * 보안 가드이므로 조회 실패는 false(fail-closed). memberships.role 은 deprecated(0054) — 읽지 않는다.
 *
 * allowSuperuser:false 는 전역 등급 단락을 끈다 — 무인 러너 토큰이 프로젝트를 지정하고도
 * 소유자의 is_superuser 를 타고 등록된 전 프로젝트로 번지는 것을 막는 축이다(P0-6).
 * 기본값 true 는 사람 PAT·레거시의 현행 동작을 그대로 둔다.
 */
export async function isAgentProjectMember(
  admin: AdminClient, userId: string, projectId: string,
  opts: { allowSuperuser?: boolean } = {},
): Promise<boolean> {
  if (opts.allowSuperuser !== false) {
    const { data: mem, error: memErr } = await admin
      .from('memberships').select('is_superuser').eq('user_id', userId).maybeSingle()
    if (memErr) {
      console.error('[agent-api] 등급 조회 실패(거절):', memErr.message)
      return false
    }
    if ((mem as { is_superuser?: boolean } | null)?.is_superuser) return true
  }
  const { data: roles, error: roleErr } = await admin
    .from('project_roles').select('role').eq('user_id', userId).eq('project_id', projectId).limit(1)
  if (roleErr || !roles) {
    console.error('[agent-api] 프로젝트 역할 조회 실패(거절):', roleErr?.message)
    return false
  }
  return roles.length > 0
}
```

- [ ] **Step 4: `principalIsProjectMember` 를 파일 끝에 추가한다**

`AgentPrincipal` 타입 선언 뒤여야 하므로 **파일 맨 끝**(`patProjectAllowed` 아래)에 붙인다:

```ts
/**
 * principal 종류를 반영한 프로젝트 멤버 판정 — PAT 멤버십 검사의 단일 출처.
 * kind='runner' 자격증명만 전역 등급을 상속하지 않는다. 사람 PAT(user_pat)과 legacy 는 현행 유지 —
 * 사람이 슈퍼유저로서 자기 PAT 을 쓰는 것은 기존 계약이고, 여기서 좁히면 운영 중인 온보딩이 깨진다.
 */
export async function principalIsProjectMember(
  admin: AdminClient, p: AgentPrincipal, userId: string, projectId: string,
): Promise<boolean> {
  const allowSuperuser = p.kind !== 'pat' || p.runnerKind !== 'runner'
  return isAgentProjectMember(admin, userId, projectId, { allowSuperuser })
}
```

- [ ] **Step 5: 테스트 통과를 확인한다**

Run: `npm run test -- --run tests/agent/member-gate.test.ts`
Expected: PASS (8 tests)

- [ ] **Step 6: 기존 테스트가 안 깨졌는지 확인한다**

Run: `npm run test -- --run tests/agent`
Expected: 전부 PASS — 기본값이 현행 유지이므로 아무것도 변하지 않아야 한다.

- [ ] **Step 7: 커밋**

```bash
git add src/lib/agent/externalApi.ts tests/agent/member-gate.test.ts
git commit -m "feat(agent): 멤버 판정에 전역 등급 단락 스위치 — 무인 러너가 슈퍼유저를 상속하지 않게 할 자리

기본값은 현행 유지라 이 커밋만으로는 동작이 변하지 않는다. 배선은 다음 커밋.

Preview-checked: n/a — 서버 로직만"
```

---

## Task 2: 0087 마이그레이션 — 러너 자격증명은 프로젝트 필수

앱 층에서 `project_id` 를 강제해도 `agent_runners` 직접 INSERT 는 그 규칙을 우회한다. DB 제약을 같이 걸어 SQL 직삽입도 같은 규칙을 받게 한다.

**Files:**
- Create: `supabase/migrations/0087_agent_runner_project_required.sql`
- Create: `supabase/migrations/0087_agent_runner_project_required_rollback.sql`

- [ ] **Step 1: 마이그레이션을 쓴다**

Create `supabase/migrations/0087_agent_runner_project_required.sql`:

```sql
-- 0087: kind='runner' 자격증명은 project_id 필수.
-- 0078 주석이 "슈퍼유저 PAT 는 발급 규칙으로 지정 강제"라고 적었으나 코드에 그 규칙이 없었고,
-- 무인 러너 토큰은 발급 경로 자체가 없어 SQL 직삽입으로만 만들어졌다(설계 P0-6).
-- 앱 가드(createRunnerToken)와 짝을 이루는 DB 층 방어선이다 — 직삽입도 이 규칙을 받는다.
-- user_pat 은 종전대로 null(전 프로젝트) 허용 — 사람 PAT 의 현행 계약을 건드리지 않는다.
-- 멱등: 제약이 이미 있으면 건너뛴다(0057 관례).

begin;

set search_path = public, extensions;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.agent_runners'::regclass
      and conname = 'agent_runners_runner_project_required'
  ) then
    alter table public.agent_runners
      add constraint agent_runners_runner_project_required
      check (kind <> 'runner' or project_id is not null);
  end if;
end $$;

reset search_path;

commit;
```

- [ ] **Step 2: 롤백을 쓴다**

Create `supabase/migrations/0087_agent_runner_project_required_rollback.sql`:

```sql
-- 0087 롤백 — 제약만 제거한다. 데이터는 건드리지 않는다.

begin;

set search_path = public, extensions;

alter table public.agent_runners
  drop constraint if exists agent_runners_runner_project_required;

reset search_path;

commit;
```

- [ ] **Step 3: 스테이징에 적용한다**

```bash
npm run staging:sync
npm run db:apply -- --target staging
```
Expected: 0087 적용 성공. 실패하면 사전 확인의 "잔존 행" 문제이므로 되돌아가 그 행부터 정리한다.

- [ ] **Step 4: 스테이징에서 제약이 실제로 무는지 확인한다**

스테이징 Supabase SQL 에서:
```sql
insert into public.agent_runners (name, kind, owner_user_id, token_prefix, token_hash, expires_at)
values ('제약검증', 'runner', (select id from auth.users limit 1), 'zz_probe_0087', 'x', now() + interval '1 day');
```
Expected: `new row for relation "agent_runners" violates check constraint "agent_runners_runner_project_required"` — 즉 **실패해야 통과**다. 성공했다면 제약이 안 걸린 것이므로 롤백하고 다시 적용한다. (성공한 경우 `delete from public.agent_runners where token_prefix = 'zz_probe_0087';` 로 정리.)

- [ ] **Step 5: 커밋** — 마이그레이션은 코드와 섞지 않는다(G1 훅)

```bash
git add supabase/migrations/0087_agent_runner_project_required.sql \
        supabase/migrations/0087_agent_runner_project_required_rollback.sql
git commit -m "db(agent): 러너 자격증명은 프로젝트 지정 필수 — 직삽입도 같은 규칙을 받게

앱 가드만으로는 agent_runners 직접 INSERT 가 만료 상한·스코프 화이트리스트와 함께
프로젝트 한정까지 통째로 우회한다. 0078 주석이 규칙이라 적어 둔 것을 제약으로 옮긴다.

Staging-verified: 0087 스테이징 적용 후 project_id 없는 runner INSERT 가 거부됨을 확인

Preview-checked: n/a — 마이그레이션만"
```

---

## Task 3: `createRunnerToken` — 관리자 대리 발급 (P0-6 앞단)

무인 러너 자격증명을 만드는 **유일한 합법 경로**를 만든다. 자율 발급과 분리하는 이유는 `work:report` 가 권한 상승이기 때문이다 — 에이전트 채널의 WBS 쓰기는 웹보다 넓다(담당팀 검사가 없다).

**Files:**
- Modify: `src/app/actions/agentTokens.ts`
- Test: `tests/actions/runner-tokens.test.ts`

- [ ] **Step 1: 실패하는 테스트를 쓴다**

Create `tests/actions/runner-tokens.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  createAdminClient: vi.fn(),
  requireProjectAdmin: vi.fn(),
  resolveUserByEmail: vi.fn(),
  isAgentProjectMember: vi.fn(),
}))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: mocks.createAdminClient }))
vi.mock('@/lib/supabase/server', () => ({ createServerClient: vi.fn() }))
vi.mock('@/lib/authz', () => ({ requireProjectAdmin: mocks.requireProjectAdmin }))
vi.mock('@/lib/minutes/externalApi', () => ({ resolveUserByEmail: mocks.resolveUserByEmail }))
vi.mock('@/lib/agent/externalApi', async (orig) => {
  const m = await orig() as Record<string, unknown>
  return { ...m, isAgentProjectMember: mocks.isAgentProjectMember }
})
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

const PID = '11111111-1111-4111-8111-111111111111'
const OLD = { ...process.env }
beforeEach(() => { process.env.AGENT_API_ENABLED = 'true'; vi.clearAllMocks() })
afterEach(() => { process.env = { ...OLD } })

function useAdmin(insertResult: { data?: unknown; error?: { message: string } | null }) {
  const inserted: unknown[] = []
  const b: Record<string, unknown> = {}
  for (const k of ['select', 'eq', 'update', 'order', 'is', 'limit']) b[k] = () => b
  b.insert = (row: unknown) => { inserted.push(row); return b }
  b.maybeSingle = async () => ({ data: insertResult.data ?? null, error: insertResult.error ?? null })
  b.then = (r: (v: unknown) => unknown) =>
    Promise.resolve({ data: insertResult.data ?? null, error: insertResult.error ?? null }).then(r)
  mocks.createAdminClient.mockReturnValue({ from: () => b })
  return inserted
}

function happyPath() {
  mocks.requireProjectAdmin.mockResolvedValue({ ok: true, actor: { userId: 'admin-1' } })
  mocks.resolveUserByEmail.mockResolvedValue({ id: 'runner-user-1' })
  mocks.isAgentProjectMember.mockResolvedValue(true)
}

const OK_INPUT = {
  name: 'mes-runner', projectId: PID, ownerEmail: 'runner@dongkuk.com',
  scopes: ['work:read', 'work:claim', 'work:report'], expiresDays: 30,
}

describe('createRunnerToken', () => {
  it("발급 성공 — kind='runner', project_id 고정, created_by 는 발급 관리자", async () => {
    happyPath()
    const inserted = useAdmin({ data: [{ id: 'r-1' }] })
    const { createRunnerToken } = await import('@/app/actions/agentTokens')
    const r = await createRunnerToken(OK_INPUT)
    expect(r.ok).toBe(true)
    const row = inserted[0] as Record<string, unknown>
    expect(row.kind).toBe('runner')
    expect(row.project_id).toBe(PID)
    expect(row.owner_user_id).toBe('runner-user-1')
    expect(row.created_by).toBe('admin-1')
    expect(row.token_hash).toMatch(/^[0-9a-f]{64}$/)
    if (r.ok) expect(JSON.stringify(row)).not.toContain(r.token)
  })

  it('프로젝트 관리자가 아니면 거부 — admin 클라이언트를 만들기 전에 막힌다', async () => {
    mocks.requireProjectAdmin.mockResolvedValue({ ok: false, error: '권한이 없습니다.' })
    useAdmin({})
    const { createRunnerToken } = await import('@/app/actions/agentTokens')
    const r = await createRunnerToken(OK_INPUT)
    expect(r).toEqual({ ok: false, error: '권한이 없습니다.' })
    expect(mocks.resolveUserByEmail).not.toHaveBeenCalled()
  })

  it('AGENT_API_ENABLED 미설정이면 발급 거부', async () => {
    delete process.env.AGENT_API_ENABLED
    happyPath(); useAdmin({})
    const { createRunnerToken } = await import('@/app/actions/agentTokens')
    expect((await createRunnerToken(OK_INPUT)).ok).toBe(false)
    expect(mocks.requireProjectAdmin).not.toHaveBeenCalled()
  })

  it('projectId 가 uuid 형식이 아니면 거부', async () => {
    happyPath(); useAdmin({})
    const { createRunnerToken } = await import('@/app/actions/agentTokens')
    expect((await createRunnerToken({ ...OK_INPUT, projectId: 'nope' })).ok).toBe(false)
  })

  it('화이트리스트 밖 스코프는 거부', async () => {
    happyPath(); useAdmin({})
    const { createRunnerToken } = await import('@/app/actions/agentTokens')
    const r = await createRunnerToken({ ...OK_INPUT, scopes: ['work:read', 'wbs:admin'] })
    expect(r.ok).toBe(false)
  })

  it('만료 상한은 30일 — 31일은 거부, 30일은 통과', async () => {
    happyPath(); useAdmin({ data: [{ id: 'r-1' }] })
    const { createRunnerToken } = await import('@/app/actions/agentTokens')
    expect((await createRunnerToken({ ...OK_INPUT, expiresDays: 31 })).ok).toBe(false)
    expect((await createRunnerToken({ ...OK_INPUT, expiresDays: 30 })).ok).toBe(true)
  })

  it('소유자 이메일이 실재하지 않으면 거부', async () => {
    happyPath()
    mocks.resolveUserByEmail.mockResolvedValue(null)
    useAdmin({})
    const { createRunnerToken } = await import('@/app/actions/agentTokens')
    expect((await createRunnerToken(OK_INPUT)).ok).toBe(false)
  })

  it('소유자가 그 프로젝트 멤버가 아니면 거부 — 전역 등급은 인정하지 않는다', async () => {
    happyPath()
    mocks.isAgentProjectMember.mockResolvedValue(false)
    useAdmin({})
    const { createRunnerToken } = await import('@/app/actions/agentTokens')
    expect((await createRunnerToken(OK_INPUT)).ok).toBe(false)
    expect(mocks.isAgentProjectMember).toHaveBeenCalledWith(
      expect.anything(), 'runner-user-1', PID, { allowSuperuser: false },
    )
  })

  it('DB 오류 메시지를 위장하지 않는다', async () => {
    happyPath()
    useAdmin({ error: { message: 'duplicate key value violates unique constraint' } })
    const { createRunnerToken } = await import('@/app/actions/agentTokens')
    const r = await createRunnerToken(OK_INPUT)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toContain('duplicate key')
  })
})
```

- [ ] **Step 2: 실패를 확인한다**

Run: `npm run test -- --run tests/actions/runner-tokens.test.ts`
Expected: FAIL — `createRunnerToken is not a function`

- [ ] **Step 3: import 를 추가한다**

`src/app/actions/agentTokens.ts` 상단 import 블록을 다음으로 교체한다:

```ts
'use server'

import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import { createServerClient } from '@/lib/supabase/server'
import { requireProjectAdmin } from '@/lib/authz'
import { resolveUserByEmail } from '@/lib/minutes/externalApi'
import { agentApiEnabled, isAgentProjectMember } from '@/lib/agent/externalApi'
import { generateAgentToken } from '@/lib/agent/token'
import { isUuidLike } from '@/lib/domain/agentWork'
```

- [ ] **Step 4: 상수를 추가한다**

기존 `const SELF_ISSUE_SCOPES = ...` 줄 **아래**에 붙인다:

```ts
/**
 * 러너 토큰 전용 화이트리스트 — work:report 를 포함한다. 자율 발급과 분리하는 이유는
 * work:report 가 권한 상승이기 때문이다: 에이전트 채널의 WBS 쓰기는 웹보다 넓다(담당팀 검사 없음).
 * 만료를 사람 PAT(180일)보다 짧게 잡는 것도 같은 이유 — 무인 자격증명은 회수 창이 짧아야 한다.
 */
const RUNNER_ISSUE_SCOPES = new Set(['work:read', 'work:claim', 'work:report'])
const MAX_RUNNER_EXPIRES_DAYS = 30
```

- [ ] **Step 5: 액션을 추가한다**

`createAgentToken` 함수 **아래**에 붙인다:

```ts
/**
 * 관리자 대리 발급 — 무인 러너 자격증명을 만드는 유일한 합법 경로(설계 P0-6).
 * 자율 발급(createAgentToken)과 다른 점 넷: 프로젝트 관리자 가드 · kind='runner' ·
 * project_id 필수 · work:report 허용 + 만료 30일. 소유자는 그 프로젝트의 실제 역할
 * 보유자여야 한다 — 전역 등급(is_superuser)으로는 통과시키지 않는다.
 */
export async function createRunnerToken(input: {
  name: string; projectId: string; ownerEmail: string; scopes: string[]; expiresDays: number
}): Promise<{ ok: true; token: string; prefix: string } | { ok: false; error: string }> {
  if (!agentApiEnabled()) return { ok: false, error: '에이전트 API가 꺼져 있어 발급할 수 없습니다.' }
  if (!isUuidLike(input.projectId)) return { ok: false, error: '잘못된 프로젝트입니다.' }
  const g = await requireProjectAdmin(input.projectId)
  if (!g.ok) return { ok: false, error: g.error }

  const name = input.name.trim()
  if (!NAME_RE.test(name)) return { ok: false, error: '이름 형식이 올바르지 않습니다(64자 이내).' }
  if (input.scopes.length === 0) return { ok: false, error: '스코프를 1개 이상 선택하세요.' }
  for (const s of input.scopes) {
    if (!RUNNER_ISSUE_SCOPES.has(s)) return { ok: false, error: `${s} 는 러너 토큰에 발급할 수 없는 스코프입니다.` }
  }
  const days = Math.trunc(input.expiresDays)
  if (!Number.isInteger(days) || days < 1 || days > MAX_RUNNER_EXPIRES_DAYS) {
    return { ok: false, error: `러너 토큰 만료는 1~${MAX_RUNNER_EXPIRES_DAYS}일입니다.` }
  }

  const admin = createAdminClient()
  const owner = await resolveUserByEmail(admin, input.ownerEmail.trim())
  if (!owner) return { ok: false, error: "해당 이메일의 D'Flow 사용자가 없습니다." }
  if (!(await isAgentProjectMember(admin, owner.id, input.projectId, { allowSuperuser: false }))) {
    return { ok: false, error: '소유자가 그 프로젝트의 멤버가 아닙니다(전역 등급은 인정하지 않습니다).' }
  }

  const { token, prefix, hash } = generateAgentToken()
  const { data, error } = await admin.from('agent_runners').insert({
    name, kind: 'runner', owner_user_id: owner.id, token_prefix: prefix, token_hash: hash,
    project_id: input.projectId, scopes: input.scopes,
    expires_at: new Date(Date.now() + days * 86400_000).toISOString(), created_by: g.actor.userId,
  }).select('id')
  if (error) return { ok: false, error: `발급 실패: ${error.message}` }
  if (!data || data.length === 0) return { ok: false, error: '발급 실패(0행)' }
  revalidatePath('/agent-ops')
  return { ok: true, token, prefix } // 평문은 이 응답이 유일하다 — 저장·로깅 금지.
}
```

- [ ] **Step 6: 테스트 통과를 확인한다**

Run: `npm run test -- --run tests/actions/runner-tokens.test.ts tests/actions/agent-tokens.test.ts`
Expected: 전부 PASS

- [ ] **Step 7: 타입·린트 확인**

Run: `npx tsc --noEmit && npm run lint`
Expected: 오류 0

- [ ] **Step 8: 커밋**

```bash
git add src/app/actions/agentTokens.ts tests/actions/runner-tokens.test.ts
git commit -m "feat(agent): 러너 토큰 관리자 대리 발급 — SQL 직삽입 말고 갈 길을 낸다

work:report 를 발급할 합법 경로가 없어 무인 러너 자격증명이 agent_runners 직접 INSERT
아니면 마스터 시크릿으로만 만들어졌다. 자율 발급과 분리하는 이유는 work:report 가 권한
상승이기 때문이다 — 에이전트 채널의 WBS 쓰기에는 담당팀 검사가 없다.

소유자는 그 프로젝트의 실제 역할 보유자여야 한다. 전역 등급으로 통과시키면 프로젝트를
지정한 의미가 사라진다.

Preview-checked: n/a — 서버 액션만"
```

---

## Task 4: 자율 발급 가드 강화 (P0-6 뒷단)

`createAgentToken` 은 `sessionUserId()` 만 확인한다. `projectId=null`(전 프로젝트)을 막지 않고 — UI 기본값이 바로 null 이다 — 발급자가 그 프로젝트 멤버인지도 보지 않는다. 그렇게 나온 토큰은 `patProjectAllowed` 가 true 이고 `isAgentProjectMember` 가 `is_superuser` 로 단락돼 **등록된 모든 프로젝트에서 통과**한다.

**Files:**
- Modify: `src/app/actions/agentTokens.ts` (`createAgentToken`)
- Test: `tests/actions/agent-tokens.test.ts`

- [ ] **Step 1: 실패하는 테스트를 추가한다**

`tests/actions/agent-tokens.test.ts` 의 `describe('createAgentToken', ...)` 블록 안, 마지막 `it` 뒤에 붙인다:

```ts
  it('projectId=null(전 프로젝트) 발급 거부 — 토큰 하나가 전 프로젝트로 번지는 경로', async () => {
    useSession({ id: 'u-1' })
    useAdmin({ data: [{ id: 'r-1' }] })
    const { createAgentToken } = await import('@/app/actions/agentTokens')
    const r = await createAgentToken({ name: 'x', projectId: null, scopes: ['work:read'], expiresDays: 90 })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toContain('프로젝트')
  })

  it('발급자가 그 프로젝트 멤버가 아니면 거부', async () => {
    useSession({ id: 'u-1' })
    // project_roles 0행 + memberships 슈퍼유저 아님 → isAgentProjectMember false
    useAdmin({ data: [] })
    const { createAgentToken } = await import('@/app/actions/agentTokens')
    const r = await createAgentToken({
      name: 'x', projectId: '11111111-1111-4111-8111-111111111111',
      scopes: ['work:read'], expiresDays: 90,
    })
    expect(r.ok).toBe(false)
  })
```

기존 `it('발급 성공 …')` 과 `it('work:report 자율 발급 거부 …')`, `it('비로그인 거부')` 의 `projectId: null` 을 전부 `projectId: '11111111-1111-4111-8111-111111111111'` 로 바꾼다 — 그러지 않으면 새 가드에 먼저 걸려 원래 검증하려던 지점에 도달하지 못한다. `it('발급 성공 …')` 과 `it('AGENT_API_ENABLED …')` 의 `useAdmin` 호출도 멤버십 조회를 통과하도록 `useAdmin({ data: [{ id: 'r-1' }] })` 로 맞춘다(`project_roles` 조회가 1행을 받아 멤버 판정이 true 가 된다).

- [ ] **Step 2: 실패를 확인한다**

Run: `npm run test -- --run tests/actions/agent-tokens.test.ts`
Expected: FAIL — `projectId=null` 케이스가 `ok:true` 로 통과한다.

- [ ] **Step 3: 가드를 넣는다**

`createAgentToken` 안, `if (input.projectId !== null && !isUuidLike(input.projectId)) ...` 줄을 다음으로 교체한다:

```ts
  // 전 프로젝트 토큰은 발급하지 않는다 — patProjectAllowed 가 무조건 true 라 프로젝트 한정이
  // 사라지고, 소유자가 슈퍼유저면 멤버십 게이트까지 단락돼 등록된 전 프로젝트가 열린다(P0-6).
  if (input.projectId === null) {
    return { ok: false, error: '프로젝트를 지정해야 합니다. 전 프로젝트 토큰은 발급하지 않습니다.' }
  }
  if (!isUuidLike(input.projectId)) return { ok: false, error: '잘못된 프로젝트입니다.' }
```

그리고 `const { token, prefix, hash } = generateAgentToken()` **앞**에 발급자 멤버십 검사를 넣는다:

```ts
  const admin = createAdminClient()
  // 발급자가 그 프로젝트와 무관한데 토큰만 찍어내는 경로를 막는다.
  if (!(await isAgentProjectMember(admin, uid, input.projectId))) {
    return { ok: false, error: '그 프로젝트의 멤버만 토큰을 발급할 수 있습니다.' }
  }

  const { token, prefix, hash } = generateAgentToken()
```

기존 본문에 있던 `const admin = createAdminClient()` 한 줄(insert 직전)은 **삭제한다** — 위에서 이미 만들었다.

- [ ] **Step 4: 테스트 통과를 확인한다**

Run: `npm run test -- --run tests/actions/agent-tokens.test.ts tests/actions/runner-tokens.test.ts`
Expected: 전부 PASS

- [ ] **Step 5: 커밋**

```bash
git add src/app/actions/agentTokens.ts tests/actions/agent-tokens.test.ts
git commit -m "fix(agent): 자율 PAT 발급에 프로젝트 지정·발급자 멤버십 강제

UI 기본값이 '전 프로젝트'였고 발급자가 그 프로젝트 사람인지도 보지 않았다. 그렇게 나온
토큰은 프로젝트 한정이 없는 데다 소유자가 슈퍼유저면 멤버십 게이트까지 단락돼 등록된
모든 프로젝트에서 통과한다. 0078 주석이 규칙이라 적어 둔 것을 코드로 옮긴다.

Preview-checked: n/a — 서버 액션만"
```

---

## Task 5: 러너 principal 을 멤버 판정에 배선한다

Task 1 이 만든 축을 실제 경로에 연결한다. 이 태스크부터 **동작이 변한다** — `kind='runner'` 토큰은 소유자가 슈퍼유저여도 그 프로젝트의 역할이 없으면 거부된다.

**Files:**
- Modify: `src/lib/agent/routeShared.ts` (`loadGatedOrderForUser`)
- Modify: `src/app/api/v1/agent/work/route.ts` · `work/[id]/route.ts` · `work/mine/route.ts` · `src/app/api/v1/wbs/import/route.ts`
- Test: `tests/agent/runner-scope.test.ts`

- [ ] **Step 1: 실패하는 라우트 테스트를 쓴다**

Create `tests/agent/runner-scope.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { generateAgentToken } from '@/lib/agent/token'

const mocks = vi.hoisted(() => ({ createAdminClient: vi.fn() }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: mocks.createAdminClient }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('next/server', async (orig) => {
  const m = await orig() as Record<string, unknown>
  return { ...m, after: (fn: () => unknown) => { void fn() } }
})

import { POST as claimPOST } from '@/app/api/v1/agent/work/[id]/claim/route'

const P1 = '11111111-1111-4111-8111-111111111111'
const O1 = '22222222-2222-4222-8222-222222222222'
type Resp = { data?: unknown; error?: { message: string } | null }

const PAT = generateAgentToken()
function runnerRow(kind: 'runner' | 'user_pat') {
  return {
    id: 'r-1', kind, owner_user_id: 'u-super', token_prefix: PAT.prefix, token_hash: PAT.hash,
    project_id: P1, scopes: ['work:read', 'work:claim'], enabled: true,
    revoked_at: null, expires_at: '2099-01-01T00:00:00Z',
  }
}

function useAdmin(queues: Record<string, Resp[]>) {
  const hits: string[] = []
  mocks.createAdminClient.mockReturnValue({
    from: (table: string) => {
      hits.push(table)
      const resp = (queues[table] ?? []).shift() ?? { data: null, error: null }
      const b: Record<string, unknown> = {}
      for (const k of ['select', 'insert', 'update', 'eq', 'in', 'limit', 'order']) b[k] = () => b
      b.maybeSingle = async () => ({ data: resp.data ?? null, error: resp.error ?? null })
      b.then = (r: (v: unknown) => unknown) =>
        Promise.resolve({ data: resp.data ?? null, error: resp.error ?? null }).then(r)
      return b
    },
    auth: { admin: { getUserById: async () => ({ data: { user: { email: 'runner@x.test' } }, error: null }) } },
  })
  return hits
}

function req() {
  return new Request(`https://x.test/api/v1/agent/work/${O1}/claim`, {
    method: 'POST',
    headers: { authorization: `Bearer ${PAT.token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ agent: 'runner-1' }),
  })
}
const ctx = { params: Promise.resolve({ id: O1 }) }

const OLD = { ...process.env }
beforeEach(() => { process.env.AGENT_API_ENABLED = 'true'; vi.clearAllMocks() })
afterEach(() => { process.env = { ...OLD } })

describe('러너 토큰의 전역 등급 미상속 (라우트)', () => {
  it("kind='runner' — 소유자가 슈퍼유저여도 프로젝트 역할이 없으면 403", async () => {
    const hits = useAdmin({
      agent_runners: [{ data: runnerRow('runner') }],
      agent_work_orders: [{ data: { id: O1, project_id: P1, status: 'ready', claimed_by: null, claimed_by_user_id: null, wbs_item_id: null } }],
      agent_projects: [{ data: { enabled: true } }],
      memberships: [{ data: { is_superuser: true } }],
      project_roles: [{ data: [] }],
    })
    const res = await claimPOST(req() as never, ctx)
    expect(res.status).toBe(403)
    expect((await res.json()).code).toBe('forbidden_role')
    // memberships 를 아예 조회하지 않았어야 한다
    expect(hits).not.toContain('memberships')
  })

  it("kind='user_pat' — 소유자가 슈퍼유저면 종전대로 통과한다(현행 유지)", async () => {
    useAdmin({
      agent_runners: [{ data: runnerRow('user_pat') }],
      agent_work_orders: [{ data: { id: O1, project_id: P1, status: 'ready', claimed_by: null, claimed_by_user_id: null, wbs_item_id: null } }],
      agent_projects: [{ data: { enabled: true } }],
      memberships: [{ data: { is_superuser: true } }],
    })
    const res = await claimPOST(req() as never, ctx)
    expect(res.status).not.toBe(403)
  })
})
```

- [ ] **Step 2: 실패를 확인한다**

Run: `npm run test -- --run tests/agent/runner-scope.test.ts`
Expected: FAIL — 첫 케이스가 403 이 아니라 통과한다(`memberships` 가 조회되고 슈퍼유저로 단락된다).

- [ ] **Step 3: 배선 대상을 전수 확인한다**

Run: `grep -rn "isAgentProjectMember" src/`
Expected: 정의 1건(`externalApi.ts`) + `principalIsProjectMember` 내부 1건 + 호출부 5건(`routeShared.ts`, `work/route.ts`, `work/[id]/route.ts`, `work/mine/route.ts`, `wbs/import/route.ts`). 목록이 다르면 아래 교체를 그 목록에 맞춰 확장한다.

- [ ] **Step 4: `routeShared.ts` 를 교체한다**

import 에 `principalIsProjectMember` 를 추가하고 `isAgentProjectMember` 는 남긴다(레거시 경로가 계속 쓴다). `loadGatedOrderForUser` 안의 멤버 판정 줄을 교체한다:

```ts
  if (!(await principalIsProjectMember(admin, principal, userId, row.project_id))) {
    console.error(`[agent-api] PAT 멤버십 거절: user=${userEmail} project=${row.project_id}`)
    return { ok: false, res: apiFail(403, 'forbidden_role', '그 프로젝트의 멤버 이상만 실행할 수 있습니다.') }
  }
```

- [ ] **Step 5: 나머지 4개 라우트를 교체한다**

각 라우트에서 PAT principal 로 하는 멤버 판정을 바꾼다. 패턴은 동일하다:

```ts
// before
if (!(await isAgentProjectMember(admin, principal.userId, projectId))) return apiNotFound()
// after
if (!(await principalIsProjectMember(admin, principal, principal.userId, projectId))) return apiNotFound()
```

`wbs/import/route.ts` 는 404 대신 그 파일의 기존 응답(`apiNotFound()`)을 그대로 유지한다 — 존재 은닉 규칙을 바꾸지 않는다. import 에 붙은 `isAgentProjectAdmin` 호출은 **건드리지 않는다**(관리자 판정은 이 태스크 범위 밖이고, 러너는 어차피 import 를 하지 않는다).

- [ ] **Step 6: 라우트 회귀 테스트를 돌린다**

Run: `npm run test -- --run tests/agent`
Expected: 전부 PASS — Step 1 의 신규 테스트 2건 포함. 기존 테스트의 PAT 은 전부 `kind:'user_pat'` 이므로 동작이 그대로여야 한다. 여기서 빨간 것이 나오면 **mock 큐 소비 순서**가 어긋난 것이다(`allowSuperuser:false` 는 `memberships` 조회를 건너뛴다) — 그 테스트가 runner 를 쓰는지 확인하고, 아니라면 배선이 잘못된 것이다.

- [ ] **Step 7: 커밋**

```bash
git add src/lib/agent/routeShared.ts src/app/api/v1/agent/work src/app/api/v1/wbs/import/route.ts \
        tests/agent/runner-scope.test.ts
git commit -m "feat(agent): 러너 토큰은 전역 등급을 상속하지 않는다

kind='runner' 자격증명의 소유자가 슈퍼유저면 프로젝트를 지정하고도 등록된 전 프로젝트에서
통과했다. 무인 토큰 하나의 유출 반경이 계정 등급만큼 넓어지는 것을 막는다.
사람 PAT(user_pat)과 레거시는 현행 유지 — 거기까지 좁히면 운영 중인 온보딩이 깨진다.

Preview-checked: n/a — 서버 로직만"
```

---

## Task 6: 레거시 시크릿 경로를 기본 차단 (P0-5)

`AGENT_API_SECRET` 이면 `requireScope` 가 null(전 스코프), `patProjectAllowed` 가 true(전 프로젝트), 멤버십 검사는 PAT 에만 걸리고, 쓰기는 본문 `user_email` 을 그대로 신원으로 해석한다. 러너 PC 의 env 를 읽은 프로세스가 슈퍼유저로 보고하면 `change_logs.user_id` 까지 그 사람 이름으로 남는다.

리졸버 한 줄에 스위치를 달아 **기본을 off** 로 만든다. 켠 상태로만 살아 있던 것을 끄는 것이라 과도기 우회는 env 하나로 남는다.

**Files:**
- Modify: `src/lib/agent/externalApi.ts` (`resolveAgentPrincipal`)
- Modify: `tests/agent/*.ts` 중 `AGENT_API_SECRET` 를 쓰는 13개
- Test: `tests/agent/legacy-off.test.ts`

- [ ] **Step 1: 실패하는 테스트를 쓴다**

Create `tests/agent/legacy-off.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

function req(auth: string) {
  return new Request('https://x.test/api/v1/agent/work', { headers: { authorization: auth } })
}
function adminWith(row: unknown) {
  const b: Record<string, unknown> = {}
  for (const k of ['select', 'eq', 'update', 'limit']) b[k] = () => b
  b.maybeSingle = async () => ({ data: row, error: null })
  b.then = (r: (v: unknown) => unknown) => Promise.resolve({ data: row, error: null }).then(r)
  return { from: () => b }
}

const OLD = { ...process.env }
beforeEach(() => { vi.resetModules() })
afterEach(() => { process.env = { ...OLD } })

describe('레거시 시크릿 경로 (P0-5)', () => {
  it('AGENT_API_LEGACY 미설정이면 올바른 시크릿도 401 — legacy principal 이 나오지 않는다', async () => {
    process.env.AGENT_API_ENABLED = 'true'
    process.env.AGENT_API_SECRET = 's3cret'
    delete process.env.AGENT_API_LEGACY
    const { resolveAgentPrincipal } = await import('@/lib/agent/externalApi')
    const r = await resolveAgentPrincipal(req('Bearer s3cret'), adminWith(null) as never)
    expect(r).not.toEqual({ kind: 'legacy' })
    expect((r as Response).status).toBe(401)
  })

  it("AGENT_API_LEGACY='true' 면 종전대로 legacy principal", async () => {
    process.env.AGENT_API_ENABLED = 'true'
    process.env.AGENT_API_SECRET = 's3cret'
    process.env.AGENT_API_LEGACY = 'true'
    const { resolveAgentPrincipal } = await import('@/lib/agent/externalApi')
    expect(await resolveAgentPrincipal(req('Bearer s3cret'), adminWith(null) as never))
      .toEqual({ kind: 'legacy' })
  })

  it("AGENT_API_LEGACY='1' 같은 오타는 켜진 것으로 보지 않는다(fail-closed)", async () => {
    process.env.AGENT_API_ENABLED = 'true'
    process.env.AGENT_API_SECRET = 's3cret'
    process.env.AGENT_API_LEGACY = '1'
    const { resolveAgentPrincipal } = await import('@/lib/agent/externalApi')
    const r = await resolveAgentPrincipal(req('Bearer s3cret'), adminWith(null) as never)
    expect((r as Response).status).toBe(401)
  })
})
```

- [ ] **Step 2: 실패를 확인한다**

Run: `npm run test -- --run tests/agent/legacy-off.test.ts`
Expected: FAIL — 첫 번째 케이스가 `{ kind: 'legacy' }` 를 받는다.

- [ ] **Step 3: 스위치를 만든다**

`src/lib/agent/externalApi.ts` 의 `agentApiEnabled` 바로 아래에 붙인다:

```ts
/**
 * 레거시 시크릿 경로 — 기본 off(설계 P0-5). 켜면 스코프·프로젝트 한정·멤버십 검사가 전부
 * 우회되고 본문 user_email 이 그대로 신원이 된다. 무인 러너가 도는 PC 에 이 시크릿이 있으면
 * 그 PC 가 임의 사용자로 보고할 수 있으므로, 과도기 클라이언트를 살릴 때만 명시적으로 켠다.
 */
export function legacyAgentApiEnabled(): boolean {
  return process.env.AGENT_API_LEGACY === 'true'
}
```

- [ ] **Step 4: 리졸버에 배선한다**

`resolveAgentPrincipal` 안의 레거시 분기 두 줄을 교체한다:

```ts
  const secret = process.env.AGENT_API_SECRET
  if (secret && legacyAgentApiEnabled() && secretMatches(bearer, secret)) return { kind: 'legacy' }
```

꺼져 있으면 아래 PAT 경로로 흘러가고, 시크릿은 PAT prefix 형식이 아니므로 `parsePatPrefix` 가 null 을 돌려 401 이 된다 — 별도 분기를 만들지 않는다.

- [ ] **Step 5: 기존 테스트에 플래그를 추가한다**

```bash
node -e '
const fs = require("fs");
for (const f of process.argv.slice(1)) {
  const s = fs.readFileSync(f, "utf8");
  if (s.includes("AGENT_API_LEGACY")) continue;
  fs.writeFileSync(f, s.replace(
    /(\n(\s*)process\.env\.AGENT_API_SECRET\s*=\s*[^\n]+)/g,
    "$1\n$2process.env.AGENT_API_LEGACY = \"true\"",
  ));
}' $(grep -rl "AGENT_API_SECRET" tests/agent)
```

Run: `grep -rc "AGENT_API_LEGACY" tests/agent/*.ts | grep -v ':0'`
Expected: 13개 파일에 최소 1건씩. `legacy-off.test.ts` 는 스스로 `delete` 하므로 이 스크립트 대상이 아니다(이미 문자열을 포함해 건너뛴다).

- [ ] **Step 6: 전 테스트를 돌린다**

Run: `npm run test -- --run tests/agent`
Expected: 전부 PASS. 빨간 것이 남으면 그 테스트가 시크릿을 `beforeEach` 밖에서 설정한 경우이므로 해당 위치에 직접 `process.env.AGENT_API_LEGACY = 'true'` 를 넣는다.

- [ ] **Step 7: 운영 env 를 확인한다** — 배포 전에 반드시

Run: `npx vercel env ls production | grep -i agent`
Expected: `AGENT_API_LEGACY` 가 **없어야** 한다(= 기본 off). 현재 레거시 클라이언트가 실제로 도는지 모르는 상태에서 배포하면 그것이 조용히 멈춘다. `AGENT_API_SECRET` 을 쓰는 클라이언트가 있는지 확인하고, 있다면 PAT 로 옮긴 뒤 이 커밋을 배포한다.

- [ ] **Step 8: 커밋**

```bash
git add src/lib/agent/externalApi.ts tests/agent
git commit -m "fix(agent): 레거시 시크릿 경로를 기본 차단 — 한 줄로 임의 사용자 사칭이 됐다

시크릿이 맞으면 requireScope 가 전 스코프, patProjectAllowed 가 전 프로젝트를 내주고
쓰기는 본문 user_email 을 그대로 신원으로 읽는다. 러너가 도는 PC 의 env 를 읽은 프로세스가
슈퍼유저로 보고하면 change_logs 에 그 사람 이름이 남는다.

끄는 것이 아니라 스위치 뒤로 옮긴다 — AGENT_API_LEGACY=true 로만 살아난다.

Preview-checked: n/a — 서버 로직만"
```

---

## Task 7: 자기승인 방지 (P0-12)

`approveAgentCompletion` 은 보고자와 승인자를 비교하지 않는다. 러너 PAT 소유자와 `/agent-ops` 로그인 계정이 같은 사람이면 드라이런 단계에서 "보고 → 새로고침 → 승인"이 한 손으로 닫힌다. 자동 게이트가 붙기 전에 이 구멍부터 막아야 드라이런 데이터가 의미를 갖는다.

**Files:**
- Modify: `src/app/actions/agentWork.ts` (`approveAgentCompletion`)
- Test: `tests/actions/agent-work-actions.test.ts`

- [ ] **Step 1: 실패하는 테스트를 추가한다**

`tests/actions/agent-work-actions.test.ts` 의 승인 관련 describe 블록에 붙인다. 이 파일의 기존 mock 헬퍼 이름·시그니처를 그대로 쓰되, `agent_work_reports` 조회가 `{ actor_user_id }` 를 돌려주도록 큐를 채운다:

```ts
  it('본인이 보고한 완료는 승인할 수 없다 — WBS 를 건드리기 전에 막힌다', async () => {
    // 승인자 = u-approver, 최신 completion 보고의 actor_user_id 도 u-approver
    useAdmin({
      agent_work_orders: [{ data: { id: O1, project_id: P1, status: 'reported', wbs_item_id: W1 } }],
      agent_work_reports: [{ data: { id: 'rep-1', actor_user_id: 'u-approver' } }],
    })
    mocks.requireProjectAdmin.mockResolvedValue({ ok: true, actor: { userId: 'u-approver' } })
    const { approveAgentCompletion } = await import('@/app/actions/agentWork')
    const r = await approveAgentCompletion(O1)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toContain('본인이 보고한')
    expect(mocks.updateActual).not.toHaveBeenCalled()
  })

  it('다른 사람이 보고한 완료는 종전대로 승인된다', async () => {
    useAdmin({
      agent_work_orders: [{ data: { id: O1, project_id: P1, status: 'reported', wbs_item_id: W1 } }],
      agent_work_reports: [{ data: { id: 'rep-1', actor_user_id: 'u-reporter' } }],
    })
    mocks.requireProjectAdmin.mockResolvedValue({ ok: true, actor: { userId: 'u-approver' } })
    mocks.updateActual.mockResolvedValue({ ok: true, projectId: P1 })
    const { approveAgentCompletion } = await import('@/app/actions/agentWork')
    const r = await approveAgentCompletion(O1)
    expect(r.ok).toBe(true)
    expect(mocks.updateActual).toHaveBeenCalledWith(W1, 100)
  })

  it('완료 보고가 없으면 승인하지 않는다 — 조회 실패를 통과로 위장하지 않는다', async () => {
    useAdmin({
      agent_work_orders: [{ data: { id: O1, project_id: P1, status: 'reported', wbs_item_id: W1 } }],
      agent_work_reports: [{ data: null }],
    })
    mocks.requireProjectAdmin.mockResolvedValue({ ok: true, actor: { userId: 'u-approver' } })
    const { approveAgentCompletion } = await import('@/app/actions/agentWork')
    expect((await approveAgentCompletion(O1)).ok).toBe(false)
    expect(mocks.updateActual).not.toHaveBeenCalled()
  })
```

기존 mock 헬퍼가 테이블별 큐를 받지 않는 형태라면, `tests/agent/write-routes-pat.test.ts` 의 `useAdmin(queues)` 패턴(테이블명 키 → 응답 배열)을 이 파일로 옮겨 쓴다.

- [ ] **Step 2: 실패를 확인한다**

Run: `npm run test -- --run tests/actions/agent-work-actions.test.ts`
Expected: FAIL — 첫 케이스에서 `updateActual` 이 호출된다.

- [ ] **Step 3: 승인 앞단에 검사를 넣는다**

`approveAgentCompletion` 의 `if (!order.wbs_item_id) ...` 줄 **바로 아래**, `const applied = await updateActual(...)` **앞**에 넣는다:

```ts
  const admin = createAdminClient()
  // 자기승인 방지(P0-12) — 러너 PAT 소유자와 웹 로그인이 같은 사람이면 "보고 → 새로고침 → 승인"이
  // 한 손으로 닫힌다. WBS 를 건드리기 전에 막아야 실패해도 실적이 남지 않는다.
  const { data: latest, error: latestErr } = await admin
    .from('agent_work_reports').select('id, actor_user_id')
    .eq('work_order_id', orderId).eq('kind', 'completion')
    .order('created_at', { ascending: false }).limit(1).maybeSingle()
  if (latestErr) return { ok: false, error: `완료 보고 조회 실패: ${latestErr.message}` }
  if (!latest) return { ok: false, error: '완료 보고가 없습니다. 상태를 확인하세요.' }
  const latestReport = latest as { id: string; actor_user_id: string | null }
  if (latestReport.actor_user_id && latestReport.actor_user_id === actor.userId) {
    return { ok: false, error: '본인이 보고한 완료는 승인할 수 없습니다. 다른 관리자가 승인해야 합니다.' }
  }
```

- [ ] **Step 4: 중복된 조회와 선언을 제거한다**

같은 함수 안에서 두 곳을 고친다.

① `const applied = await updateActual(...)` 검사 뒤에 있던 `const admin = createAdminClient()` 한 줄을 **삭제한다**(Step 3 에서 위로 올렸다). 바로 뒤의 `const now = new Date().toISOString()` 은 그대로 둔다.

② CAS 성공 뒤의 최신 보고 재조회 블록을 삭제하고 Step 3 에서 이미 읽은 행을 쓴다. 아래 블록을

```ts
  const { data: latest, error: latestErr } = await admin
    .from('agent_work_reports').select('id').eq('work_order_id', orderId).eq('kind', 'completion')
    .order('created_at', { ascending: false }).limit(1).maybeSingle()
  if (latestErr || !latest) {
    console.error('[agentWork] 승인 보고 조회 실패:', latestErr?.message ?? '0행')
  } else {
    const { error: revErr } = await admin.from('agent_work_reports')
      .update({ review_action: 'approve', reviewed_by: actor.userId, reviewed_at: now })
      .eq('id', (latest as { id: string }).id).select('id')
    if (revErr) console.error('[agentWork] 승인 기록 실패:', revErr.message)
  }
```

다음으로 교체한다:

```ts
  // 최신 completion 보고는 위(자기승인 검사)에서 이미 읽었다 — 상태가 reported 로 동결돼 있어
  // 그 사이 새 보고가 들어올 수 없다(report 라우트는 claimed 만 받는다).
  {
    const { error: revErr } = await admin.from('agent_work_reports')
      .update({ review_action: 'approve', reviewed_by: actor.userId, reviewed_at: now })
      .eq('id', latestReport.id).select('id')
    if (revErr) console.error('[agentWork] 승인 기록 실패:', revErr.message)
  }
```

- [ ] **Step 5: 테스트 통과를 확인한다**

Run: `npm run test -- --run tests/actions/agent-work-actions.test.ts tests/agent/stage-lifecycle.test.ts`
Expected: 전부 PASS

- [ ] **Step 6: 타입·린트 확인**

Run: `npx tsc --noEmit && npm run lint`
Expected: 오류 0

- [ ] **Step 7: 커밋**

```bash
git add src/app/actions/agentWork.ts tests/actions/agent-work-actions.test.ts
git commit -m "fix(agent): 본인이 보고한 완료는 본인이 승인하지 못한다

러너 PAT 소유자와 웹 로그인 계정이 같은 사람이면 보고 직후 새로고침해서 자기 작업을
승인할 수 있었다. 자동 게이트를 켜기 전 드라이런 구간에서 사람 판정과 게이트 판정을
비교할 참인데, 그 사람 판정이 자기채점이면 비교 자체가 무의미해진다.

검사를 updateActual 앞에 두는 이유는 실패해도 WBS 에 100% 가 남지 않게 하기 위해서다.
승인 기록용 최신 보고 재조회는 이 검사가 이미 읽은 행을 재사용해 한 왕복 줄인다.

Preview-checked: n/a — 서버 액션만"
```

---

## Task 8: 발급 UI — 관제탑 안에 러너 토큰 섹션

액션만 있으면 사람이 부를 방법이 없다. `/agent-ops` 는 이미 관리자용 URL 직접 접근 화면이고 공유 UI 파일(`src/components/app/*`)을 건드리지 않으므로 여기에 붙인다.

**Files:**
- Create: `src/components/agent/RunnerTokenSection.tsx`
- Modify: `src/app/(app)/agent-ops/page.tsx`
- Modify: `src/components/account/MyTokensSection.tsx`

- [ ] **Step 1: 섹션 컴포넌트를 만든다**

Create `src/components/agent/RunnerTokenSection.tsx`:

```tsx
'use client'

import { useState } from 'react'
import { Check, Copy, KeyRound } from 'lucide-react'
import { createRunnerToken } from '@/app/actions/agentTokens'

const RUNNER_SCOPES = ['work:read', 'work:claim', 'work:report'] as const
const EXPIRES_OPTIONS = [7, 14, 30] as const

/**
 * 무인 러너 자격증명 발급(설계 P0-6). 사람 PAT(/account)과 분리한 이유는 work:report 가
 * 권한 상승이라 프로젝트 관리자 가드를 요구하기 때문이다. 평문은 발급 직후 1회만 표시한다.
 */
export function RunnerTokenSection({ projects }: { projects: { id: string; name: string }[] }) {
  const [name, setName] = useState('')
  const [projectId, setProjectId] = useState('')
  const [ownerEmail, setOwnerEmail] = useState('')
  const [expiresDays, setExpiresDays] = useState<number>(30)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [issued, setIssued] = useState<{ token: string; prefix: string } | null>(null)
  const [copied, setCopied] = useState(false)

  async function submit() {
    setError(null)
    if (!name.trim()) { setError('이름을 입력하세요.'); return }
    if (!projectId) { setError('프로젝트를 선택하세요.'); return }
    if (!ownerEmail.trim()) { setError('러너 계정 이메일을 입력하세요.'); return }
    setBusy(true)
    try {
      const r = await createRunnerToken({
        name: name.trim(), projectId, ownerEmail: ownerEmail.trim(),
        scopes: [...RUNNER_SCOPES], expiresDays,
      })
      if (!r.ok) { setError(r.error); return }
      setIssued({ token: r.token, prefix: r.prefix })
      setCopied(false)
      setName(''); setOwnerEmail('')
    } catch {
      setError('요청 처리 중 오류가 발생했습니다. 잠시 후 다시 시도하세요.')
    } finally {
      setBusy(false)
    }
  }

  async function copyToken() {
    if (!issued) return
    try { await navigator.clipboard.writeText(issued.token); setCopied(true) } catch { /* 클립보드 미지원 무시 */ }
  }

  return (
    <section className="rounded-lg border border-border bg-surface p-4">
      <h2 className="flex items-center gap-2 text-sm font-semibold text-fg">
        <KeyRound className="size-4" aria-hidden />
        러너 토큰 발급
      </h2>
      <p className="mt-1 text-xs text-fg-muted">
        무인 러너 전용 자격증명입니다. 프로젝트 관리자만 발급할 수 있고, 소유자는 그 프로젝트의
        멤버여야 합니다. 스코프는 조회·claim·보고 세 가지로 고정이며 만료는 최대 30일입니다.
      </p>

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <label className="text-xs text-fg-muted">
          이름
          <input
            className="mt-1 w-full rounded border border-border bg-bg px-2 py-1 text-sm text-fg"
            value={name} onChange={(e) => setName(e.target.value)} placeholder="mes-runner-01"
          />
        </label>
        <label className="text-xs text-fg-muted">
          프로젝트
          <select
            className="mt-1 w-full rounded border border-border bg-bg px-2 py-1 text-sm text-fg"
            value={projectId} onChange={(e) => setProjectId(e.target.value)}
          >
            <option value="">선택하세요</option>
            {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </label>
        <label className="text-xs text-fg-muted">
          러너 계정 이메일
          <input
            className="mt-1 w-full rounded border border-border bg-bg px-2 py-1 text-sm text-fg"
            value={ownerEmail} onChange={(e) => setOwnerEmail(e.target.value)}
            placeholder="runner@example.com"
          />
        </label>
        <label className="text-xs text-fg-muted">
          만료
          <select
            className="mt-1 w-full rounded border border-border bg-bg px-2 py-1 text-sm text-fg"
            value={expiresDays} onChange={(e) => setExpiresDays(Number(e.target.value))}
          >
            {EXPIRES_OPTIONS.map((d) => <option key={d} value={d}>{d}일</option>)}
          </select>
        </label>
      </div>

      {error ? <p className="mt-2 text-xs text-danger">{error}</p> : null}

      <button
        type="button" disabled={busy} onClick={() => { void submit() }}
        className="mt-3 rounded bg-accent px-3 py-1.5 text-sm text-accent-fg disabled:opacity-50"
      >
        {busy ? '발급 중…' : '발급'}
      </button>

      {issued ? (
        <div className="mt-3 rounded border border-warning/40 bg-warning/10 p-3">
          <p className="text-xs font-medium text-fg">
            이 값은 지금 한 번만 표시됩니다. 러너 PC 의 <code>DFLOW_PATS</code> 에 넣으세요.
          </p>
          <div className="mt-2 flex items-center gap-2">
            <code className="flex-1 break-all rounded bg-bg px-2 py-1 text-xs text-fg">{issued.token}</code>
            <button
              type="button" onClick={() => { void copyToken() }}
              className="shrink-0 rounded border border-border px-2 py-1 text-xs text-fg"
            >
              {copied ? <Check className="size-3.5" aria-label="복사됨" /> : <Copy className="size-3.5" aria-label="복사" />}
            </button>
          </div>
        </div>
      ) : null}
    </section>
  )
}
```

색 토큰 이름(`border-border`·`bg-surface`·`text-fg-muted`·`bg-accent`·`text-danger`·`bg-warning/10`)이 이 리포의 `globals.css` `@theme` 과 다르면 **지어내지 말고** 인접 컴포넌트(`src/components/account/MyTokensSection.tsx`)에서 쓰는 이름으로 맞춘다.

- [ ] **Step 2: 페이지에 배치한다**

`src/app/(app)/agent-ops/page.tsx` 의 return 을 교체한다:

```tsx
  return (
    <div className="space-y-4">
      <AgentOpsView
        projects={(projects ?? []) as { id: string; name: string }[]}
        loadError={error ? error.message : null}
      />
      <RunnerTokenSection projects={(projects ?? []) as { id: string; name: string }[]} />
    </div>
  )
```

import 를 추가한다:
```tsx
import { RunnerTokenSection } from '@/components/agent/RunnerTokenSection'
```

- [ ] **Step 3: 자율 발급 UI 의 '전체' 기본값을 없앤다**

`src/components/account/MyTokensSection.tsx` 의 `submitIssue` 안, `if (scopes.length === 0) ...` 줄 **뒤**에 넣는다:

```ts
    if (!projectId) { setIssueError('프로젝트를 선택하세요. 전 프로젝트 토큰은 발급하지 않습니다.'); return }
```

그리고 같은 함수의 `createAgentToken({ name: trimmed, projectId: projectId || null, scopes, expiresDays })` 를 `createAgentToken({ name: trimmed, projectId, scopes, expiresDays })` 로 바꾼다. 프로젝트 선택 `<select>` 의 "전체" 옵션이 있으면 라벨을 "선택하세요"(value `''`)로 바꿔 전 프로젝트를 고를 수 없게 한다.

- [ ] **Step 4: 빌드·린트 확인**

Run: `npm run build && npm run lint`
Expected: 성공. 빌드가 실패하면 대개 토큰 클래스명이 아니라 import 경로 문제다.

- [ ] **Step 5: 커밋** — UI 파일이 섞이므로 별도 커밋

```bash
git add src/components/agent/RunnerTokenSection.tsx \
        "src/app/(app)/agent-ops/page.tsx" \
        src/components/account/MyTokensSection.tsx
git commit -m "feat(agent): 관제탑에 러너 토큰 발급 섹션 — 액션을 사람이 부를 수 있게

/account 의 자율 발급과 분리한다. work:report 는 프로젝트 관리자 가드가 필요하고,
러너 토큰은 소유자가 발급자와 다른 계정이라 '내 토큰' 화면의 모델에 맞지 않는다.
같은 커밋에서 자율 발급 UI 의 '전 프로젝트' 기본값도 없앤다.

Preview-checked: n/a — 공유 UI(globals.css·layout·components/app) 무접촉, 신규 섹션만"
```

⚠️ 이 커밋은 `src/components/app/*` 를 건드리지 않으므로 G2 훅 대상이 아니지만, 화면이 실제로 그려지는지는 **스테이징에서 눈으로 확인**한다(Task 9).

---

## Task 9: 계약 문서 갱신 · 스테이징 검증 · 배포

**Files:**
- Modify: `docs/agent/claude-skill/dflow-work/references/api-contract.md`
- Modify: `docs/agent/claude-skill/dflow-work/README.md`
- Modify: `docs/superpowers/specs/2026-08-19-unattended-dev-loop-design.md` (§7 진행 표시)

- [ ] **Step 1: 계약 문서에 러너 토큰 절을 추가한다**

`references/api-contract.md` 의 인증 절에 붙인다:

```markdown
### 자격증명 종류

| 종류 | 발급 | 스코프 | 만료 | 프로젝트 |
|---|---|---|---|---|
| `user_pat` | 본인이 `/account` 에서 | `work:read`·`work:claim` | 최대 180일 | 지정 필수 |
| `runner` | 프로젝트 관리자가 `/agent-ops` 에서 대리 발급 | 위 둘 + `work:report` | 최대 30일 | 지정 필수(DB 제약) |
| 레거시 시크릿 | — | (전 스코프) | — | (전 프로젝트) |

레거시 시크릿 경로는 **기본 차단**이다. `AGENT_API_LEGACY=true` 일 때만 살아나며, 켜면
스코프·프로젝트 한정·멤버십 검사가 전부 우회된다.

`runner` 토큰은 소유자의 전역 등급(`is_superuser`)을 상속하지 않는다 — 그 프로젝트의
`project_roles` 역할이 실제로 있어야 통과한다.
```

- [ ] **Step 2: README 설치 절을 고친다**

`README.md` 의 "1단계: API 토큰 발급" 을 러너와 사람으로 나눠 적는다. 무인 러너는 `/account` 가 아니라 관리자에게 요청해야 하고, `work:report` 는 자율 발급이 안 된다는 사실을 명시한다.

- [ ] **Step 3: 설계 문서 §7 에 진행 상태를 남긴다**

`2026-08-19-unattended-dev-loop-design.md` 의 P0-5·P0-6·P0-12 제목 끝에 ` — 구현 완료(계획 2026-08-19-unattended-loop-identity-security)` 를 덧붙인다. 다음 세션이 남은 P0 를 셀 때 이미 메운 것을 다시 세지 않게 하는 것이 목적이다.

- [ ] **Step 4: 전 테스트·빌드**

Run: `npm run test && npm run build && npm run lint`
Expected: 전부 성공. 테스트 수는 착수 전보다 **늘어야** 한다(신규 4파일).

- [ ] **Step 5: 스테이징에 올려 눈으로 확인한다**

```bash
git fetch origin && git merge origin/main
git push origin HEAD:staging
```

dflow-staging.vercel.app 에서 확인할 것 넷:

1. `/agent-ops` 하단에 러너 토큰 섹션이 그려지는가
2. 프로젝트 관리자가 아닌 계정으로 발급을 누르면 권한 오류가 뜨는가
3. 프로젝트 멤버가 아닌 이메일을 넣으면 "소유자가 그 프로젝트의 멤버가 아닙니다" 가 뜨는가
4. `/account` 에서 프로젝트를 고르지 않고 발급하면 막히는가

- [ ] **Step 6: 발급한 러너 토큰으로 실제 왕복을 확인한다**

스테이징에서 발급받은 토큰으로:

```bash
DFLOW_API_BASE=https://dflow-staging.vercel.app \
DFLOW_PATS=<발급받은토큰> \
~/.claude/skills/dflow-work/scripts/dflow.sh me
```

Expected: exit 0, `kind` 가 `runner`, `scopes` 에 `work:report` 포함, 접근 가능 프로젝트가 발급 시 지정한 하나뿐.

**러너 소유자를 슈퍼유저 계정으로 만들어 두고 이 검사를 했다면 반드시 다시 확인한다** — 프로젝트 목록이 여러 개로 나오면 Task 5 배선이 빠진 것이다.

- [ ] **Step 7: 운영 마이그레이션 적용**

```bash
npm run db:apply -- --target prod
```
Expected: 0087 적용 성공.

- [ ] **Step 8: 운영 배포**

```bash
git switch main && git merge staging && git push origin main
npm run smoke:prod
```

- [ ] **Step 9: 배포 후 확인**

- `/agent-ops` 가 그려지는가
- 기존 사람 PAT 이 계속 도는가(`dflow.sh doctor` 로 본인 토큰 확인) — Task 4 가 `projectId=null` 을 막았지만 **이미 발급된 null 토큰은 그대로 동작한다**(발급 규칙만 바뀌었다). 그 토큰들을 언제 회수할지는 별도 결정이므로 이 계획에서 폐기하지 않는다.
- Run: `npm run mark:good`

- [ ] **Step 10: 문서 커밋**

```bash
git add docs/agent/claude-skill/dflow-work/references/api-contract.md \
        docs/agent/claude-skill/dflow-work/README.md \
        docs/superpowers/specs/2026-08-19-unattended-dev-loop-design.md
git commit -m "docs(agent): 자격증명 3종 계약과 러너 토큰 발급 절차

러너 토큰이 사람 PAT 과 어디가 다른지(발급자·스코프·만료·전역 등급 미상속)를 계약에
박아 둔다. 다음 세션이 P0 를 다시 셀 때 메운 것을 또 세지 않도록 설계 문서에도 표시한다.

Preview-checked: n/a — 문서만"
```

---

## 완료 기준

- [ ] `npm run test` 전량 초록, 신규 테스트 4파일(member-gate·runner-scope·legacy-off·runner-tokens)이 포함돼 있다
- [ ] 0087 이 스테이징·운영 양쪽에 적용됐고 `project_id` 없는 runner INSERT 가 거부된다
- [ ] 관리자가 `/agent-ops` 에서 러너 토큰을 발급할 수 있고, 그 토큰으로 `dflow.sh me` 가 통과한다
- [ ] 그 토큰의 접근 가능 프로젝트가 **정확히 하나**다(소유자가 슈퍼유저여도)
- [ ] `AGENT_API_LEGACY` 없이 배포된 상태에서 레거시 시크릿이 401 을 받는다
- [ ] 본인이 보고한 완료를 본인이 승인하려 하면 거부되고 `actual_pct` 가 변하지 않는다

## 이 계획이 하지 않는 것

`agent_projects` 리포 매핑 · 서버 게이트 · 승인 API(`work:approve`) · 선행 게이트 `xx` 상향 · 반려 시 stage 되돌림 · progress 단조 가드 · `weight` 시드 · `evidence.branch` 검증 · rate limit — 전부 ⓑ·ⓒ 덩어리다. **이 계획을 마쳐도 무인 루프는 돌지 않는다.** 러너가 쓸 자격증명이 생기고 그 반경이 좁아질 뿐이다.

기존에 발급된 `projectId=null` 토큰의 회수도 범위 밖이다 — 폐기 일정은 사람이 정할 일이고, 여기서 일괄 폐기하면 운영 중인 온보딩이 예고 없이 끊긴다.
