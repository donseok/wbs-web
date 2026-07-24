# 팀 기준정보 런타임 마스터 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 팀 목록(PMO/ERP/MES/가공/MDM) 하드코딩 ~30곳을 DB `teams` 마스터 단일 기준으로 교체하고, 관리자 화면에서 코드 수정 없이 추가/비활성/정렬 가능하게 한다.

**Architecture:** 순수 도메인 모듈(`lib/domain/teams.ts`) + 서버 인메모리 캐시(`lib/teams/master.ts`, llm-override 패턴) + 클라이언트 컨텍스트(`TeamsProvider`). `TeamCode`는 `string` 별칭으로 전환. 엑셀은 3행 헤더 이름 기반 열 맵으로 전환(고정 인덱스 폴백). 스펙: `docs/superpowers/specs/2026-07-24-team-master-design.md`.

**Tech Stack:** Next.js App Router, Supabase(Postgres+RLS), vitest, xlsx.

## Global Constraints

- 운영 D-CUBE 데이터 무손실 — 삭제는 비활성화만, DB 적용은 Management API 레시피(`db push` 금지), 마이그레이션 파일은 롤백 동반.
- 팀 개명(rename)은 스코프 제외. WEEKLY_SECTIONS 10구분·TEAM_SUBGROUPS 내용 고정 유지.
- 에러 3원칙: 표시=로깅, 조용한 스킵 금지(엑셀 미등록 팀은 팀명 명시 에러), fail-closed 게이트.
- 기존 테스트 픽스처(5팀)는 기본 파라미터(DEFAULT_TEAMS)로 무변경 유지가 원칙.
- 도메인 계층(lib/domain)은 I/O 금지 — 팀 목록은 파라미터 주입(기본값 DEFAULT_TEAM_CODES).
- 커밋은 태스크 단위, `git add`는 파일 명시(병렬 세션 관례 — `git add -A` 금지).
- 검증 명령: `npm run build` / `npm run lint` / `npm test`(vitest run). 런타임 검증은 /verify 스킬 규약(브라우저 불가 → build+test+curl).

---

### Task 1: 도메인 팀 모델 (`lib/domain/teams.ts`) + `TeamCode = string`

**Files:**
- Create: `src/lib/domain/teams.ts`
- Modify: `src/lib/domain/types.ts:2`
- Test: `src/lib/domain/__tests__/teams.test.ts` (기존 도메인 테스트 위치 관례 확인 — `src/lib/domain/*.test.ts` 형태면 그쪽을 따른다)

**Interfaces:**
- Produces: `Team { id, code, sortOrder, active, progressVisible }`, `DEFAULT_TEAMS`, `DEFAULT_TEAM_CODES`, `activeCodes(teams)`, `teamOrderMap(codes)`, `normalizeNewTeamCode(input): { ok: true; code: string } | { ok: false; error: string }`, `RESERVED_TEAM_NAMES`

- [ ] **Step 1: 실패 테스트 작성**

```ts
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_TEAMS, DEFAULT_TEAM_CODES, activeCodes, normalizeNewTeamCode, teamOrderMap,
} from '@/lib/domain/teams'

describe('domain/teams', () => {
  it('DEFAULT_TEAM_CODES는 현행 5팀 순서', () => {
    expect(DEFAULT_TEAM_CODES).toEqual(['PMO', 'ERP', 'MES', '가공', 'MDM'])
  })
  it('activeCodes는 active만 sort_order→code 순 정렬', () => {
    const teams = [
      { id: '3', code: 'C', sortOrder: 2, active: false, progressVisible: true },
      { id: '2', code: 'B', sortOrder: 1, active: true, progressVisible: true },
      { id: '1', code: 'A', sortOrder: 1, active: true, progressVisible: true },
    ]
    expect(activeCodes(teams)).toEqual(['A', 'B'])
  })
  it('teamOrderMap은 코드→인덱스', () => {
    expect(teamOrderMap(['X', 'Y']).get('Y')).toBe(1)
    expect(teamOrderMap(['X']).get('없음')).toBeUndefined()
  })
  it('normalizeNewTeamCode: 공백 트림·빈값/초과/예약어 거부', () => {
    expect(normalizeNewTeamCode(' 신팀 ')).toEqual({ ok: true, code: '신팀' })
    expect(normalizeNewTeamCode('').ok).toBe(false)
    expect(normalizeNewTeamCode('a'.repeat(21)).ok).toBe(false)
    expect(normalizeNewTeamCode('산출물').ok).toBe(false) // 엑셀 헤더 예약어
    expect(normalizeNewTeamCode('Activity').ok).toBe(false)
  })
})
```

- [ ] **Step 2: 실패 확인** — `npm test -- teams` → FAIL (모듈 없음)

- [ ] **Step 3: 구현**

`src/lib/domain/types.ts:2`를 다음으로 교체:

```ts
/** 팀 코드 — 런타임 기준은 DB teams 마스터(관리자 화면에서 추가/비활성). 컴파일 타임 유니언 금지. */
export type TeamCode = string
```

`src/lib/domain/teams.ts` 생성:

```ts
// 팀 기준정보 순수 도메인 — I/O 없음. 런타임 소스는 lib/teams/master.ts(서버 캐시).
import type { TeamCode } from './types'

export interface Team {
  id: string
  /** 표시명이자 식별 코드(teams.code). teams.name은 code와 동기. */
  code: TeamCode
  sortOrder: number
  active: boolean
  /** 대시보드 '팀별 진척현황' 노출 여부(기존 MDM 제외 규칙의 데이터화). */
  progressVisible: boolean
}

/** 콜드스타트 폴백 + 테스트 기본값(2026-07 기준 5팀). 런타임 기준은 항상 DB teams. */
export const DEFAULT_TEAMS: readonly Team[] = [
  { id: 'default-pmo', code: 'PMO', sortOrder: 0, active: true, progressVisible: true },
  { id: 'default-erp', code: 'ERP', sortOrder: 1, active: true, progressVisible: true },
  { id: 'default-mes', code: 'MES', sortOrder: 2, active: true, progressVisible: true },
  { id: 'default-gagong', code: '가공', sortOrder: 3, active: true, progressVisible: true },
  { id: 'default-mdm', code: 'MDM', sortOrder: 4, active: true, progressVisible: false },
]

export const DEFAULT_TEAM_CODES: readonly TeamCode[] = DEFAULT_TEAMS.map(t => t.code)

/** 활성 팀 코드 — sort_order, 동률이면 code 순. 탭·필터·셀렉트 공용 순서. */
export function activeCodes(teams: readonly Team[]): TeamCode[] {
  return [...teams]
    .filter(t => t.active)
    .sort((a, b) => a.sortOrder - b.sortOrder || a.code.localeCompare(b.code, 'ko'))
    .map(t => t.code)
}

/** 코드→표시 순서 인덱스(담당 정렬용). */
export function teamOrderMap(codes: readonly TeamCode[]): Map<string, number> {
  return new Map(codes.map((c, i) => [c, i]))
}

/** 엑셀 헤더에서 팀 열 탐색에 쓰이는 이름들 — 팀명으로 쓰면 열 맵이 오염된다. */
export const RESERVED_TEAM_NAMES: readonly string[] = [
  'Biz', 'Phase', 'Task', 'Activity', '담당', '산출물', '계획',
  '시작', '종료', '가중치', '실적%', '계획%', '계획대비%', '상태',
]

const TEAM_CODE_MAX = 20

/** 관리 화면 팀 추가 입력 검증 — 중복 검사는 액션(DB 대조)에서. */
export function normalizeNewTeamCode(
  input: string,
): { ok: true; code: string } | { ok: false; error: string } {
  const code = input.trim()
  if (!code) return { ok: false, error: '팀 이름을 입력하세요.' }
  if (code.length > TEAM_CODE_MAX) return { ok: false, error: `팀 이름은 ${TEAM_CODE_MAX}자 이하여야 합니다.` }
  if ((RESERVED_TEAM_NAMES as readonly string[]).includes(code)) {
    return { ok: false, error: `'${code}'는 엑셀 양식 예약어라 팀 이름으로 쓸 수 없습니다.` }
  }
  return { ok: true, code }
}
```

- [ ] **Step 4: 통과 확인** — `npm test -- teams` → PASS. 이어서 `npx tsc --noEmit`로 유니언 해제 파급 확인(이 시점 오류는 `Record<TeamCode,…>` 사용처 — Task 5·9·11에서 수정하므로 오류 목록만 기록).
- [ ] **Step 5: Commit** — `git add src/lib/domain/teams.ts src/lib/domain/types.ts src/lib/domain/__tests__/teams.test.ts && git commit -m "feat(teams): 팀 도메인 모델 + TeamCode string 전환"`

> **주의:** `TeamCode = string` 전환 직후 `Record<TeamCode, X>`는 `Record<string, X>`가 되어 **컴파일은 통과하지만 조회가 undefined일 수 있다.** Task 5·9·11에서 폴백을 반드시 넣는다. tsc가 못 잡으므로 `grep -rn "Record<TeamCode" src/` 결과 전체를 체크리스트로 삼을 것.

---

### Task 2: 마이그레이션 0044 (+롤백)

**Files:**
- Create: `supabase/migrations/0044_team_master.sql`, `supabase/migrations/0044_team_master_rollback.sql`

- [ ] **Step 1: 선행 확인** — `grep -n "constraint" supabase/migrations/0014_rename_dt_to_gagong.sql supabase/migrations/0035_add_mdm_team.sql supabase/migrations/0021_minutes.sql`으로 CHECK 제약의 **실제 이름** 확인(예상: `teams_code_check`, `minutes_team_code_check`). RLS 헬퍼는 `app_role()`(운영 일치 — migration-drift-audit 메모리).

- [ ] **Step 2: 작성** — `0044_team_master.sql`:

```sql
-- 팀 런타임 마스터: 메타 컬럼 추가 + CHECK 하드코딩 철거 + pmo_admin 쓰기 정책.
-- 검증은 앱 계층(lib/teams/master 대조)으로 이동. 구코드에도 무해(추가 컬럼·제약 완화뿐).
alter table teams add column if not exists sort_order int not null default 0;
alter table teams add column if not exists active boolean not null default true;
alter table teams add column if not exists progress_visible boolean not null default true;

update teams set sort_order = v.sort
from (values ('PMO', 0), ('ERP', 1), ('MES', 2), ('가공', 3), ('MDM', 4)) as v(code, sort)
where teams.code = v.code;

-- 대시보드 '팀별 진척현황' MDM 제외 규칙(기존 PROGRESS_TEAMS 하드코딩)의 데이터화.
update teams set progress_visible = false where code = 'MDM';

alter table teams drop constraint if exists teams_code_check;
alter table minutes drop constraint if exists minutes_team_code_check;

-- 읽기는 0002 read_all_teams(authenticated) 유지. 쓰기는 PMO 관리자만(비활성화 정책 — delete 정책 없음).
create policy admin_insert_teams on teams for insert to authenticated with check (app_role() = 'pmo_admin');
create policy admin_update_teams on teams for update to authenticated
  using (app_role() = 'pmo_admin') with check (app_role() = 'pmo_admin');
```

`0044_team_master_rollback.sql`:

```sql
drop policy if exists admin_insert_teams on teams;
drop policy if exists admin_update_teams on teams;
alter table teams add constraint teams_code_check check (code in ('PMO','가공','ERP','MES','MDM'));
alter table minutes add constraint minutes_team_code_check check (team_code in ('PMO','ERP','MES','가공','MDM'));
alter table teams drop column if exists progress_visible;
alter table teams drop column if exists active;
alter table teams drop column if exists sort_order;
-- 주의: 0044 이후 신규 팀 행/회의록이 있으면 add constraint가 실패한다 — 롤백 전 데이터 정리 필요.
```

Step 1에서 확인한 실제 제약 이름·0035의 CHECK 문구와 다르면 위 SQL을 맞춰 수정.

- [ ] **Step 3: 프로덕션 적용은 이 태스크에서 하지 않는다** — 전체 코드 완성·검증 후 배포 단계(Task 13)에서 Management API 레시피로 적용(DB 먼저 → 코드).
- [ ] **Step 4: Commit** — `git add supabase/migrations/0044_team_master.sql supabase/migrations/0044_team_master_rollback.sql && git commit -m "feat(teams): 0044 팀 마스터 메타컬럼 + CHECK 철거 + 쓰기 RLS"`

---

### Task 3: 서버 캐시 `lib/teams/master.ts`

**Files:**
- Create: `src/lib/teams/master.ts`
- Test: `src/lib/teams/__tests__/master.test.ts`

**Interfaces:**
- Consumes: `Team`, `DEFAULT_TEAMS`, `activeCodes` (Task 1), `createAdminClient` (`@/lib/supabase/admin`)
- Produces: `teamsSync(): readonly Team[]`(전체, 정렬됨), `activeTeamCodesSync(): TeamCode[]`, `isRegisteredTeamCode(code): boolean`(비활성 포함), `isActiveTeamCode(code): boolean`, `refreshTeams(): Promise<boolean>`

- [ ] **Step 1: 패턴 원본 확인** — `src/lib/ai/llm-override.ts`와 그 테스트(`grep -rln "llm-override" src --include="*.test.*"`)를 읽고 큐/TTL/stale 유지/콜드스타트 폴백 구조를 그대로 축소 이식한다. TTL 60초, LOAD_TIMEOUT 3초, RETRY 10초 동일.

- [ ] **Step 2: 실패 테스트 작성** — llm-override 테스트의 모킹 방식(vi.mock `@/lib/supabase/admin`)을 따라:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest'

const rows = [
  { id: 't1', code: 'PMO', sort_order: 0, active: true, progress_visible: true },
  { id: 't2', code: '신팀', sort_order: 5, active: true, progress_visible: true },
  { id: 't3', code: '구팀', sort_order: 6, active: false, progress_visible: true },
]
const order = vi.fn()
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({ from: () => ({ select: () => ({ order: () => ({ order }) }) }) }),
}))

describe('teams/master', () => {
  beforeEach(() => { vi.resetModules(); order.mockReset() })

  it('로드 성공 시 DB 값을 반환하고 활성 코드만 추린다', async () => {
    order.mockResolvedValue({ data: rows, error: null })
    const m = await import('@/lib/teams/master')
    await m.refreshTeams()
    expect(m.teamsSync().map(t => t.code)).toEqual(['PMO', '신팀', '구팀'])
    expect(m.activeTeamCodesSync()).toEqual(['PMO', '신팀'])
    expect(m.isRegisteredTeamCode('구팀')).toBe(true)
    expect(m.isActiveTeamCode('구팀')).toBe(false)
  })

  it('콜드스타트 로드 실패 시 DEFAULT_TEAMS 폴백', async () => {
    order.mockResolvedValue({ data: null, error: { message: 'down' } })
    const m = await import('@/lib/teams/master')
    expect(m.activeTeamCodesSync()).toEqual(['PMO', 'ERP', 'MES', '가공', 'MDM'])
  })

  it('갱신 실패 시 직전 유효값 유지(stale ≠ 폴백)', async () => {
    order.mockResolvedValueOnce({ data: rows, error: null })
    const m = await import('@/lib/teams/master')
    await m.refreshTeams()
    order.mockResolvedValue({ data: null, error: { message: 'down' } })
    await m.refreshTeams()
    expect(m.teamsSync().map(t => t.code)).toContain('신팀')
  })
})
```

주의: `server-only` import는 vitest 설정에서 이미 처리 중인지 확인(`grep -rn "server-only" vitest.config.*` 및 llm-override 테스트 참고). 미처리면 동일 방식으로 alias/mock.

- [ ] **Step 3: 실패 확인** — `npm test -- master` → FAIL
- [ ] **Step 4: 구현** — llm-override 구조 이식:

```ts
import 'server-only'

// ============================================================================
// 팀 기준정보 런타임 캐시 — lib/ai/llm-override.ts 와 동일한 검증된 패턴.
// 동기 소비처(레이아웃·AI 도구·레포 매핑)가 많아 동기 접근자 + TTL 백그라운드 갱신.
// service_role 로 읽는 이유: 캐시는 프로세스 전역이라 사용자 세션 컨텍스트가 없다(읽기 전용 select).
// ============================================================================

import { activeCodes, DEFAULT_TEAMS, type Team } from '@/lib/domain/teams'
import type { TeamCode } from '@/lib/domain/types'
import { createAdminClient } from '@/lib/supabase/admin'

const TTL_MS = 60_000
const LOAD_TIMEOUT_MS = 3_000
const RETRY_MS = 10_000

let cache: readonly Team[] = DEFAULT_TEAMS
let everLoaded = false
let nextRefreshAt = 0
let queue: Promise<unknown> = Promise.resolve()
let background: Promise<unknown> | null = null

async function fetchTeams(): Promise<readonly Team[]> {
  const admin = createAdminClient()
  const { data, error } = await admin
    .from('teams')
    .select('id, code, sort_order, active, progress_visible')
    .order('sort_order')
    .order('code')
  if (error) throw new Error(error.message)
  const rows = (data ?? []) as Array<Record<string, unknown>>
  const teams = rows
    .filter(r => typeof r.code === 'string' && (r.code as string).trim() !== '')
    .map(r => ({
      id: String(r.id),
      code: (r.code as string).trim(),
      sortOrder: Number(r.sort_order ?? 0),
      active: r.active !== false,
      progressVisible: r.progress_visible !== false,
    }))
  // 빈 목록은 폴백 유지 — teams 테이블이 비는 건 정상 상태가 아니다(전 화면 팀 축 소실 방지).
  if (teams.length === 0) throw new Error('teams 테이블이 비어 있습니다')
  return teams
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const guard = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`팀 마스터 로드 ${ms}ms 초과`)), ms)
  })
  return Promise.race([promise, guard]).finally(() => { if (timer) clearTimeout(timer) })
}

async function load(): Promise<boolean> {
  try {
    cache = await withTimeout(fetchTeams(), LOAD_TIMEOUT_MS)
    everLoaded = true
    nextRefreshAt = Date.now() + TTL_MS
    return true
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    if (!everLoaded) console.error('[teams] 최초 팀 마스터 로드 실패 — 기본 5팀으로 기동:', message)
    else console.error('[teams] 팀 마스터 갱신 실패 — 직전 값을 유지합니다:', message)
    nextRefreshAt = Date.now() + RETRY_MS
    return false
  }
}

/** DB 즉시 재조회. 관리 액션 저장 후 await. 큐 직렬화 이유는 llm-override 주석 참조. */
export function refreshTeams(): Promise<boolean> {
  const next = queue.then(load, load)
  queue = next.then(() => {}, () => {})
  return next
}

/** 전체 팀(비활성 포함, 정렬됨). TTL 만료 시 백그라운드 갱신만 트리거. */
export function teamsSync(): readonly Team[] {
  if (!background && Date.now() >= nextRefreshAt) {
    background = refreshTeams().catch(() => false).finally(() => { background = null })
  }
  return cache
}

export function activeTeamCodesSync(): TeamCode[] { return activeCodes(teamsSync()) }
/** 비활성 포함 — 기존 데이터 표시·앵커 보호용. */
export function isRegisteredTeamCode(code: string): boolean {
  return teamsSync().some(t => t.code === code)
}
/** 신규 입력 검증용 — 비활성 팀으로의 새 등록은 거부. */
export function isActiveTeamCode(code: string): boolean {
  return teamsSync().some(t => t.active && t.code === code)
}

await refreshTeams() // 콜드스타트 1회 — lazy 면 첫 요청들이 폴백 5팀으로 렌더된다
```

- [ ] **Step 5: 통과 확인** — `npm test -- master` → PASS
- [ ] **Step 6: Commit** — `git add src/lib/teams/master.ts src/lib/teams/__tests__/master.test.ts && git commit -m "feat(teams): 서버 팀 마스터 캐시(TTL·stale 유지·5팀 폴백)"`

---

### Task 4: `TeamsProvider` / `useTeams` + 레이아웃 배선

**Files:**
- Create: `src/components/app/TeamsProvider.tsx`
- Modify: `src/app/(app)/layout.tsx`
- Test: `src/components/app/__tests__/TeamsProvider.test.tsx` (컴포넌트 테스트 관례 위치 확인 후 조정)

**Interfaces:**
- Produces: `TeamsProvider({ teams, children })`, `useTeams(): readonly Team[]`(활성·정렬), `useTeamCodes(): readonly TeamCode[]`

- [ ] **Step 1: 구현** — `TeamsProvider.tsx`:

```tsx
'use client'

// 활성 팀 목록 컨텍스트 — (app)/layout 서버에서 1회 주입. 미제공 시 DEFAULT_TEAMS(테스트 픽스처 호환).
import { createContext, useContext, useMemo } from 'react'
import { activeCodes, DEFAULT_TEAMS, type Team } from '@/lib/domain/teams'
import type { TeamCode } from '@/lib/domain/types'

const TeamsContext = createContext<readonly Team[]>(DEFAULT_TEAMS)

export function TeamsProvider({ teams, children }: { teams: readonly Team[]; children: React.ReactNode }) {
  return <TeamsContext.Provider value={teams}>{children}</TeamsContext.Provider>
}

/** 활성 팀(정렬됨) — 진척현황 등 팀 속성이 필요한 곳. */
export function useTeams(): readonly Team[] {
  const teams = useContext(TeamsContext)
  return useMemo(() => teams.filter(t => t.active), [teams])
}

/** 활성 팀 코드(정렬됨) — 탭·필터·셀렉트 공용. */
export function useTeamCodes(): readonly TeamCode[] {
  const teams = useContext(TeamsContext)
  return useMemo(() => activeCodes(teams), [teams])
}
```

`(app)/layout.tsx`: `import { teamsSync } from '@/lib/teams/master'`, `import { TeamsProvider } from '@/components/app/TeamsProvider'` 추가 후 `<BotPageContextProvider>` 안쪽을 `<TeamsProvider teams={teamsSync().filter(t => t.active)}>…</TeamsProvider>`로 감싼다(직렬화 가능한 plain object라 서버→클라 전달 안전).

- [ ] **Step 2: 테스트** — provider 없이 훅 사용 시 DEFAULT 5팀, provider로 커스텀 팀 주입 시 그 값 반환(testing-library renderHook, 리포 기존 컴포넌트 테스트 방식 준수).
- [ ] **Step 3: `npm test -- TeamsProvider` PASS, `npm run build` 통과 확인**
- [ ] **Step 4: Commit** — `git add src/components/app/TeamsProvider.tsx src/app/\(app\)/layout.tsx src/components/app/__tests__/TeamsProvider.test.tsx && git commit -m "feat(teams): TeamsProvider 컨텍스트 + 앱 레이아웃 주입"`

---

### Task 5: 순수 도메인 소비처 파라미터화

**Files (Modify):**
- `src/lib/domain/dashboard.ts:189-195` — `ALL_TEAMS`/`PROGRESS_TEAMS` 상수를 유지하되 `DEFAULT_TEAM_CODES` 기반으로 재정의하고, `teamProgress(leaves, teams = PROGRESS_TEAMS)`는 이미 파라미터가 있으므로 그대로. `riskSignals.ts:161`의 `ALL_TEAMS.map` → 함수 파라미터 `teams: readonly TeamCode[] = ALL_TEAMS` 추가 후 사용.
- `src/lib/domain/kanban.ts:12,51` — `buildKanban`(실제 함수명 확인)에 `teams: readonly TeamCode[] = DEFAULT_TEAM_CODES` 파라미터 추가, 내부 `TEAMS` 상수 제거.
- `src/lib/domain/subact.ts:4,22` — `SUB_ACT_TEAMS` → `DEFAULT_TEAM_CODES` 재정의, `availableSubActTeams(…, teams = DEFAULT_TEAM_CODES)` 파라미터화.
- `src/lib/domain/accounts.ts:10-14` — `TEAM_CODES` 상수 제거, `isTeamCode(v, codes: readonly string[]): boolean`로 변경(호출처는 Task 6·11에서 주입).
- `src/lib/report/weekly.ts:16,403,505` — `REPORT_TEAMS` → `DEFAULT_TEAM_CODES` 기반 유지 + 보고서 빌드 함수에 `teams` 파라미터(기본 REPORT_TEAMS) 추가, 403·505의 참조를 파라미터로.
- `src/lib/ai/analytics.ts:18,224,233` — `TEAMS` 상수 삭제, 함수 파라미터 또는 `activeTeamCodesSync()`(이 파일은 서버 전용이므로 직접 호출 가능 — import 최상단 `server-only` 여부 확인 후 결정).

**Interfaces:**
- Consumes: `DEFAULT_TEAM_CODES` (Task 1)
- Produces: 각 함수의 `teams?: readonly TeamCode[]` 마지막 파라미터 — 호출처 주입은 Task 6·11.

- [ ] **Step 1:** 각 파일 수정. 원칙: **상수는 DEFAULT 기반 폴백으로 남기고, 함수는 teams 파라미터를 받는다**(기존 테스트 무변경). 파라미터를 무시하는 내부 상수 참조가 남지 않게 파일별로 grep 확인.
- [ ] **Step 2:** `npm test` 전체 → 기존 테스트 GREEN 유지 확인.
- [ ] **Step 3: Commit** — `git add <수정 파일들> && git commit -m "refactor(teams): 도메인 팀 목록 파라미터 주입화(기본값 유지)"`

---

### Task 6: 서버 소비처 주입 (레포·액션·API·AI 도구)

**Files (Modify):**
- `src/lib/repositories/supabase/wbs.ts:36-55,68-72` — `mapOwners`: allowlist 제거(owners는 `teams(code)` FK 조인 결과라 등록 팀만 온다), 정렬은 `teamOrderMap(teamsSync().map(t => t.code))` 사용(미등록=끝). `teamCode()` 헬퍼(감사 로그용)는 `typeof value === 'string' ? value : null`로 완화.
- `src/app/actions/wbs.ts:261` 인근 — 팀→id 해석 실패 시 에러 메시지에 팀명 포함: `'등록되지 않은 팀입니다: <팀명> — /admin/teams 에서 먼저 등록하세요.'`
- 엑셀 임포트 액션(`grep -rn "parseWbsWorkbook\|import_wbs" src/app` 로 위치 확인) — 파싱 결과의 팀 코드 집합을 `isRegisteredTeamCode`로 검증, 미등록 팀명 나열 에러(조용한 스킵 금지).
- `src/app/api/v1/minutes/route.ts:173`, `src/app/api/v1/minutes/meta/route.ts:30`, `src/app/api/minutes/chat/route.ts:46`, `src/app/actions/minutes.ts`(팀 검증 지점 grep) — `TEAM_CODES` import 제거 → `activeTeamCodesSync()`/`isActiveTeamCode()`. meta 응답 `teams: activeTeamCodesSync()`.
- `src/app/actions/accounts.ts` — `isTeamCode(v)` 호출부에 `activeTeamCodesSync()` 주입.
- AI 도구: `src/lib/ai/tools/{kanban,members,wbs,attendance,minutes,weekly}.ts` — 하드코딩 배열 → `activeTeamCodesSync()`. `weekly.ts:26`의 팀→구분 Set 매핑은 `TEAM_SECTION_MAP[team] ?? new Set([team])` 폴백으로.
- 대시보드·주간보고·칸반을 **호출하는 서버 페이지/액션**(Task 5 파라미터의 주입처): `grep -rn "teamProgress(\|riskSignals(\|REPORT_TEAMS\|buildKanban(" src/app src/components`로 전수 찾아 `activeTeamCodesSync()`(서버) 또는 `useTeamCodes()`(클라, Task 11에서) 주입. 진척현황은 `teamsSync().filter(t => t.active && t.progressVisible).map(t => t.code)` 주입.

- [ ] **Step 1:** 파일별 수정. 서버/클라 경계 주의 — `lib/teams/master`는 `server-only`라 클라이언트 컴포넌트에서 import 금지(그쪽은 Task 11의 useTeams).
- [ ] **Step 2:** `npx tsc --noEmit && npm test` GREEN. `grep -rn "'PMO', 'ERP'" src/lib/ai src/app` 결과 0건 확인.
- [ ] **Step 3: Commit** — `git commit -m "feat(teams): 서버 검증·AI 도구·레포 정렬을 팀 마스터로 전환"` (파일 명시 add)

---

### Task 7: 엑셀 임포트 — 헤더 이름 기반 열 맵

**Files:**
- Modify: `src/lib/excel/parse.ts`
- Test: 기존 parse 테스트 파일(`grep -rln "parseWbsWorkbook" src --include="*.test.*"`)에 추가

**Interfaces:**
- Produces: `buildWbsColumnMap(header3: unknown[]): WbsColumnMap` (export — export.ts 라운드트립 테스트에서 사용), `WbsColumnMap { teams: [number, TeamCode][]; deliverable: number; start: number; end: number; weight: number; actualPct: number }`

- [ ] **Step 1: 실패 테스트 작성**

```ts
import { buildWbsColumnMap } from '@/lib/excel/parse'

const H = ['Biz', 'Phase', 'Task', 'Activity', '', '', 'PMO', 'ERP', 'MES', '가공', 'MDM',
  '산출물', '시작', '종료', '가중치', '', '실적%', '계획%', '계획대비%', '상태']

it('현행 5팀 헤더는 기존 고정 인덱스와 동일한 맵', () => {
  expect(buildWbsColumnMap(H)).toEqual({
    teams: [[6, 'PMO'], [7, 'ERP'], [8, 'MES'], [9, '가공'], [10, 'MDM']],
    deliverable: 11, start: 12, end: 13, weight: 14, actualPct: 16,
  })
})
it('팀 열이 추가되면 팀·후속 열이 함께 밀린다', () => {
  const h6 = [...H.slice(0, 11), '신팀', ...H.slice(11)]
  const m = buildWbsColumnMap(h6)
  expect(m.teams).toContainEqual([11, '신팀'])
  expect(m.deliverable).toBe(12)
  expect(m.actualPct).toBe(17)
})
it("'산출물' 헤더가 없으면 현행 고정 인덱스 폴백", () => {
  expect(buildWbsColumnMap(['A', 'B']).teams).toEqual([[6, 'PMO'], [7, 'ERP'], [8, 'MES'], [9, '가공'], [10, 'MDM']])
})
```

- [ ] **Step 2: 실패 확인** — `npm test -- parse` → FAIL
- [ ] **Step 3: 구현** — `parse.ts`의 `TEAM_COL` 상수를 `LEGACY_COLUMN_MAP`으로 개편:

```ts
export interface WbsColumnMap {
  teams: [number, TeamCode][]
  deliverable: number; start: number; end: number; weight: number; actualPct: number
}

/** 헤더 탐색 실패 시 폴백 — 2026-07 이전 5팀 고정 양식. */
const LEGACY_COLUMN_MAP: WbsColumnMap = {
  teams: [[6, 'PMO'], [7, 'ERP'], [8, 'MES'], [9, '가공'], [10, 'MDM']], // G..K
  deliverable: 11, start: 12, end: 13, weight: 14, actualPct: 16,        // L,M,N,O,Q
}

/** 3행 헤더(인덱스 2)에서 열 맵 구성 — 팀 열은 'Activity' 뒤 ~ '산출물' 앞의 비어있지 않은 헤더.
 *  팀 수가 바뀌면 뒤 열이 전부 밀리므로 후속 열도 이름으로 찾는다(실패 시 산출물 기준 상대 위치). */
export function buildWbsColumnMap(header3: unknown[]): WbsColumnMap {
  const labels = header3.map(v => String(v ?? '').trim())
  const act = labels.indexOf('Activity')
  const del = labels.indexOf('산출물')
  if (act < 0 || del < 0 || del <= act) return LEGACY_COLUMN_MAP
  const teams: [number, TeamCode][] = []
  for (let c = act + 1; c < del; c++) if (labels[c]) teams.push([c, labels[c]])
  if (teams.length === 0) return LEGACY_COLUMN_MAP
  const at = (name: string, fallback: number) => {
    const i = labels.indexOf(name, del + 1)
    return i > del ? i : fallback
  }
  return {
    teams,
    deliverable: del,
    start: at('시작', del + 1),
    end: at('종료', del + 2),
    weight: at('가중치', del + 3),
    actualPct: at('실적%', del + 5),
  }
}
```

`parseWbsWorkbook`: `const map = buildWbsColumnMap((aoa[2] ?? []) as unknown[])` 후 `owners(r, map.teams)`, `deliverable: String(r[map.deliverable] ?? '')…`, `plannedStart: toIso(r[map.start])` 등으로 교체. `owners(row, teamCols)`는 파라미터를 받도록 시그니처 변경.

- [ ] **Step 4: 통과 확인** — `npm test -- parse` → PASS(기존 임포트 테스트 포함 전부)
- [ ] **Step 5: Commit** — `git add src/lib/excel/parse.ts <테스트파일> && git commit -m "feat(excel): WBS 임포트 헤더 이름 기반 열 맵(고정 인덱스 폴백)"`

---

### Task 8: 엑셀 익스포트 — 동적 팀 열

**Files:**
- Modify: `src/lib/excel/export.ts` (`buildWbsAoa`, `buildWbsWorkbook`, 상단 `TEAM_COL` 상수, 열 너비 설정 있으면 함께)
- Modify: 익스포트 호출처(`grep -rn "buildWbsWorkbook\|buildWbsAoa" src --include="*.ts" --include="*.tsx" | grep -v test`) — 서버면 `activeTeamCodesSync()`, 클라면 `useTeamCodes()` 주입
- Test: 기존 export 테스트 + 라운드트립

- [ ] **Step 1: 실패 테스트** — 6팀 헤더 생성과 임포트 라운드트립:

```ts
it('teamCodes 주입 시 header3에 팀 열이 동적 생성되고 후속 열이 밀린다', () => {
  const aoa = buildWbsAoa([], 'WBS', ['PMO', 'ERP', 'MES', '가공', 'MDM', '신팀'])
  const h3 = aoa[2] as string[]
  expect(h3.slice(6, 12)).toEqual(['PMO', 'ERP', 'MES', '가공', 'MDM', '신팀'])
  expect(h3[12]).toBe('산출물')
})
it('동적 헤더는 buildWbsColumnMap과 라운드트립된다', () => {
  const aoa = buildWbsAoa([], 'WBS', ['PMO', '신팀'])
  const m = buildWbsColumnMap(aoa[2] as unknown[])
  expect(m.teams).toEqual([[6, 'PMO'], [7, '신팀']])
})
```

- [ ] **Step 2: 실패 확인 → 구현** — `buildWbsAoa(items, projectName = 'WBS', teamCodes: readonly TeamCode[] = DEFAULT_TEAM_CODES)`:

```ts
const base = 6 + teamCodes.length            // 팀 열 다음 첫 열(산출물)
const teamCol = new Map(teamCodes.map((c, i) => [c, 6 + i]))
const header2 = ['', 'Phase', 'Task', 'Activity', '', '', '담당',
  ...Array(Math.max(0, teamCodes.length - 1)).fill(''), '산출물', '계획', '']
const header3 = ['Biz', 'Phase', 'Task', 'Activity', '', '', ...teamCodes,
  '산출물', '시작', '종료', '가중치', '', '실적%', '계획%', '계획대비%', '상태']
```

행 생성부: `new Array(20)` → `new Array(base + 8)`, `row[11]`→`row[base]`, `row[12]`→`row[base+1]`, `row[13]`→`row[base+2]`, `row[14]`→`row[base+3]`, `row[16]`→`row[base+5]`, `row[17]`→`row[base+6]`, `row[18]`→`row[base+7]`, `row[19]`→`row[base+8]`(achievement 자리 — 기존 push(STATUS)와 인덱스 정합 주의: 기존 코드가 `row[19]=achievement; row.push(status)`였으므로 동적화 후에도 status는 `row[base+9]` 위치가 되도록 맞추고 라운드트립 테스트로 검증). owners 루프는 `teamCol.get(o.team)` — **미등록 팀(비활성 등) 담당은 열이 없으면 스킵하되 `console.warn` 남긴다**(조용한 유실 금지 — 익스포트에는 활성 팀만 열이 생기므로 비활성 팀 담당 표시는 유실됨을 인지). `!cols` 너비 설정이 있으면 팀 수에 맞게 동적 생성.

**호출처 주입 정책:** 익스포트 팀 열 = `활성 팀 ∪ 실제 owners에 등장하는 팀`(비활성 팀 담당 데이터 보존). 호출처에서 `const codes = [...new Set([...activeTeamCodesSync(), ...ownersTeams])]` 형태로 구성해 전달 — 구현 시 owners 수집 유틸을 export.ts에 두고 호출처는 활성 목록만 넘겨도 되게 한다.

- [ ] **Step 3: `npm test` 전체 GREEN**(기존 export/roundtrip 테스트 포함)
- [ ] **Step 4: Commit** — `git commit -m "feat(excel): WBS 익스포트 팀 열 동적 생성(비활성 담당 팀 포함)"`

---

### Task 9: 회의록 도메인·컴포넌트 전환

**Files (Modify):**
- `src/lib/domain/minutes.ts` — `TEAM_CODES` 상수는 `DEFAULT_TEAM_CODES` 재정의로 유지(deprecated 주석), `isTeamRootName(name, codes: readonly string[])`·`isTeamRootFolder(f, codes)`·`isTeamSeedFolder(folders, f, codes)` 파라미터화(**codes는 비활성 포함 전체** — 비활성 팀의 시드 폴더도 앵커 보호 유지). `TEAM_SUBGROUPS` 직접 인덱싱 전부 `subgroupsOf(team): readonly string[] { return TEAM_SUBGROUPS[team] ?? [team] }` 경유로 교체(`normalizeTeamSub`·`resolveTeamSub` 포함 — 미등록 팀은 자기 자신 1개).
- `src/lib/minutes/folders.ts` — 변경 없음(이름 매칭 그대로 — 신규 팀 시드 폴더는 Task 10 액션이 생성).
- 폴더 보호 호출처(`grep -rn "isTeamRootName\|isTeamRootFolder\|isTeamSeedFolder" src --include="*.ts" --include="*.tsx" | grep -v test`) — 서버 액션은 `teamsSync().map(t => t.code)`, 클라(MinutesExplorer 등)는 컨텍스트 전체 팀 필요 → **TeamsProvider에는 활성만 주입하므로**, 폴더 보호용으로는 별도 prop으로 전체 팀 코드를 페이지 서버 컴포넌트에서 내려보낸다(`allTeamCodes={teamsSync().map(t => t.code)}`). 페이지: `src/app/(app)/minutes/page.tsx`(정확 경로 grep).
- `src/components/minutes/MinutesView.tsx:238`, `MinuteChatPanel.tsx:167`, `MinuteUploadModal.tsx:35-36,147`, `MinuteMetaModal.tsx:106` — `TEAM_CODES` import 제거 → `useTeamCodes()`. 기본 팀 초기값 `'PMO'` → `codes[0]`. `TEAM_SUBGROUPS[…]` → `subgroupsOf(…)`.

- [ ] **Step 1:** 수정 + 기존 minutes 테스트의 시그니처 추종(파라미터에 `DEFAULT_TEAM_CODES` 기본값을 줘 테스트 무변경 우선, 프로덕션 호출처만 명시 주입).
- [ ] **Step 2:** `subgroupsOf` 폴백 단위 테스트 추가: `expect(subgroupsOf('신팀')).toEqual(['신팀'])`, `expect(subgroupsOf('MES')).toEqual(['품질','생산계획','조업및표준화','물류','설비및L2'])`.
- [ ] **Step 3:** `npx tsc --noEmit && npm test` GREEN
- [ ] **Step 4: Commit** — `git commit -m "feat(teams): 회의록 팀 탭·하위구분·앵커 보호를 팀 마스터로 전환"`

---

### Task 10: 관리 액션 + `/admin/teams` 화면

**Files:**
- Create: `src/app/actions/teams.ts`, `src/app/(app)/admin/teams/page.tsx`, `src/components/admin/TeamsManager.tsx`
- Modify: 사이드바/관리 메뉴(`grep -rn "admin/accounts\|admin/llm-config" src/components` 로 링크 위치 확인) — '팀 관리' 링크 추가
- Test: `src/app/actions/__tests__/teams.test.ts` (액션 테스트 관례 위치·모킹 방식은 accounts 액션 테스트를 따른다)

**Interfaces:**
- Produces: `addTeam(code: string)`, `updateTeam(id: string, patch: { active?: boolean; progressVisible?: boolean; sortOrder?: number })` — 반환 shape은 accounts 액션 관례(`{ ok: boolean; error?: string }` 유형) 확인 후 동일하게.

- [ ] **Step 1: 실패 테스트** — 핵심 계약:

```ts
it('pmo_admin이 아니면 거부(fail-closed)', async () => { /* getMembership 모킹 → team_editor → addTeam 거부 */ })
it('중복 코드 거부', async () => { /* teams select 모킹 기존 행 → '이미 존재' 에러 */ })
it('예약어 거부', async () => { expect((await addTeam('산출물')).ok).toBe(false) })
it('성공 시 teams insert + 시드 루트 폴더 insert + refreshTeams 호출', async () => { /* insert 스파이 2건 + refresh 모킹 확인 */ })
it('시드 폴더 생성 실패는 팀 생성을 롤백하지 않되 에러를 반환 메시지에 표시', async () => {})
```

- [ ] **Step 2: 구현** — `actions/teams.ts` (accounts.ts의 게이트·admin 클라이언트 패턴 준수):

```ts
'use server'

import { revalidatePath } from 'next/cache'
import { getMembership } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { normalizeNewTeamCode } from '@/lib/domain/teams'
import { refreshTeams } from '@/lib/teams/master'

type ActionResult = { ok: true } | { ok: false; error: string }

async function requirePmoAdmin(): Promise<ActionResult | null> {
  const m = await getMembership()
  if (m?.role !== 'pmo_admin') return { ok: false, error: 'PMO 관리자만 팀을 관리할 수 있습니다.' }
  return null
}

/** 팀 추가 — teams insert + 자동 편철용 시드 루트 폴더(created_by null) 생성 + 캐시 즉시 갱신. */
export async function addTeam(input: string): Promise<ActionResult> {
  const denied = await requirePmoAdmin()
  if (denied) return denied
  const norm = normalizeNewTeamCode(input)
  if (!norm.ok) return norm
  const admin = createAdminClient()

  const dup = await admin.from('teams').select('id').eq('code', norm.code).maybeSingle()
  if (dup.error) return { ok: false, error: `팀 조회 실패: ${dup.error.message}` }
  if (dup.data) return { ok: false, error: `'${norm.code}' 팀이 이미 존재합니다.` }

  const max = await admin.from('teams').select('sort_order').order('sort_order', { ascending: false }).limit(1).maybeSingle()
  if (max.error) return { ok: false, error: `팀 조회 실패: ${max.error.message}` }
  const sortOrder = ((max.data as { sort_order?: number } | null)?.sort_order ?? -1) + 1

  const ins = await admin.from('teams').insert({ code: norm.code, name: norm.code, sort_order: sortOrder })
  if (ins.error) return { ok: false, error: `팀 생성 실패: ${ins.error.message}` }

  // 자동 편철 앵커(0043 계약): 팀코드 동명 시드 루트 폴더. 실패해도 팀은 유지하되 관리자에게 알림
  // (편철은 fail-open 미분류 폴백이라 치명적이진 않지만 조용히 넘기지 않는다).
  const seed = await admin.from('minute_folders')
    .select('id').is('parent_id', null).is('created_by', null).eq('name', norm.code).maybeSingle()
  let seedError: string | null = seed.error ? seed.error.message : null
  if (!seed.error && !seed.data) {
    const folder = await admin.from('minute_folders')
      .insert({ name: norm.code, parent_id: null, created_by: null, sort_order: sortOrder })
    if (folder.error) seedError = folder.error.message
  }

  await refreshTeams()
  revalidatePath('/admin/teams')
  if (seedError) return { ok: false, error: `팀은 생성됐지만 회의록 기본 폴더 생성에 실패했습니다: ${seedError}` }
  return { ok: true }
}

/** 활성/진척표시/정렬 변경. 삭제는 없다(비활성화=숨김, 데이터 보존 — 사용자 결정 2026-07-24). */
export async function updateTeam(
  id: string,
  patch: { active?: boolean; progressVisible?: boolean; sortOrder?: number },
): Promise<ActionResult> {
  const denied = await requirePmoAdmin()
  if (denied) return denied
  const row: Record<string, unknown> = {}
  if (typeof patch.active === 'boolean') row.active = patch.active
  if (typeof patch.progressVisible === 'boolean') row.progress_visible = patch.progressVisible
  if (typeof patch.sortOrder === 'number' && Number.isInteger(patch.sortOrder)) row.sort_order = patch.sortOrder
  if (Object.keys(row).length === 0) return { ok: false, error: '변경할 항목이 없습니다.' }
  const admin = createAdminClient()
  const upd = await admin.from('teams').update(row).eq('id', id)
  if (upd.error) return { ok: false, error: `팀 수정 실패: ${upd.error.message}` }
  await refreshTeams()
  revalidatePath('/admin/teams')
  return { ok: true }
}
```

주의: `minute_folders`의 실제 컬럼명(`sort_order` 유무)은 0040 마이그레이션에서 확인 후 맞춘다.

- [ ] **Step 3: 화면** — `admin/teams/page.tsx`: `admin/accounts/page.tsx`의 게이트(비관리자 처리)·레이아웃 구조를 그대로 따라, admin 클라이언트로 **전체 팀(비활성 포함)** 을 fetch해 `<TeamsManager teams={…}/>` 렌더. `TeamsManager.tsx`: AccountsManager의 카드·버튼·인풋 프리미티브 재사용(디자인 토큰 준수 — dkflow-design-consistency) — 행: 코드, 활성 토글, 진척현황 토글, ▲▼ 정렬(sortOrder 스왑 2건 updateTeam), 상단 추가 폼(입력+버튼, 에러 인라인 표시). 모든 액션 결과 에러는 화면 표시(표시=로깅 원칙).
- [ ] **Step 4:** 관리 메뉴에 '팀 관리' 링크 추가(accounts·llm-config 링크와 같은 위치·스타일).
- [ ] **Step 5:** `npm test -- teams && npm run build` GREEN
- [ ] **Step 6: Commit** — `git commit -m "feat(teams): /admin/teams 팀 관리 화면 + 추가/비활성/정렬 액션"`

---

### Task 11: 클라이언트 소비처 교체

**Files (Modify):**
- `src/components/kanban/KanbanBoard.tsx:20,62` — `KANBAN_TEAM_CODES` 삭제 → `useTeamCodes()`(URL 파라미터 검증 포함), 칸반 빌드 함수에 codes 전달.
- `src/components/attendance/AttendanceView.tsx:27,50` — `FILTER_TEAMS` 삭제 → `useTeamCodes()`.
- `src/components/members/MembersBoard.tsx:23` — `TEAM_OPTIONS` 삭제 → `useTeamCodes()`.
- `src/components/wbs/WbsGanttSheet.tsx:1050` — 인라인 배열 → `useTeamCodes()`.
- `src/components/admin/AccountsManager.tsx:17,131,139,363,370` — `TEAM_CODES` import 제거 → `useTeamCodes()`, `'PMO'` 초기값 → `codes[0]`.
- `src/components/wbs/RowDetailPanel.tsx`·`subact` 소비처 — `availableSubActTeams(…, useTeamCodes())` 주입.
- `src/components/wbs/shared.tsx:4` — 팀 색상 맵: `Record<TeamCode, …>` 유지하되 조회 함수로 감싼다:

```ts
/** 미등록(신규) 팀은 중립 틴트 — 팀별 CSS 토큰은 기존 5팀만 정의돼 있다. */
const TEAM_COLOR_FALLBACK = { fg: 'text-ink-muted', bar: 'bg-ink-muted' } // 실제 중립 토큰명은 globals.css 확인 후 결정
export function teamColor(team: TeamCode): { fg: string; bar: string } {
  return TEAM_COLOR[team] ?? TEAM_COLOR_FALLBACK
}
```

직접 인덱싱(`TEAM_COLOR[t]`) 사용처 전부(`grep -rn "TEAM_COLOR" src`) `teamColor(t)` 경유로. MinutesExplorer의 팀 틴트 맵도 동일 패턴 폴백(`grep -rn "tint" src/components/minutes`).
- 대시보드 클라 소비처(`DashboardView` 등 Task 5 파라미터 주입 잔여분) — `useTeams()`에서 `progressVisible` 필터.

- [ ] **Step 1:** 파일별 교체. `useTeamCodes()`는 훅이므로 컴포넌트 최상위에서만 호출(콜백 내부 금지).
- [ ] **Step 2:** `grep -rn "'PMO', 'ERP', 'MES'" src/components src/app` → **0건** 확인(잔존 하드코딩 전수 소거의 완료 판정). `Record<TeamCode` 체크리스트(Task 1)도 전 항목 폴백 처리 확인.
- [ ] **Step 3:** `npx tsc --noEmit && npm test && npm run build` GREEN
- [ ] **Step 4: Commit** — `git commit -m "feat(teams): 클라이언트 탭·필터·셀렉트·틴트 전면 팀 마스터 전환"`

---### Task 12: 통합 검증 + 문서

- [ ] **Step 1:** `npm run lint && npx tsc --noEmit && npm test && npm run build` 전부 GREEN.
- [ ] **Step 2:** 신규 팀 시나리오 데스크 체크(코드 리딩으로 확인 — 런타임은 배포 후): ① addTeam('신팀') → teams insert + 시드 폴더 ② 탭/필터/칸반/근태/멤버/계정 셀렉트에 노출 ③ 엑셀 익스포트에 열 생성 → 재임포트 라운드트립 ④ 회의록 업로드 담당 탭 노출 + 하위 구분 '신팀' 1개 ⑤ 비활성화 → 목록에서 사라지고 기존 데이터 유지 ⑥ AI 도구 팀 검증 통과.
- [ ] **Step 3:** 스펙 문서에 결과 반영(변경된 시그니처 있으면 스펙 갱신), 메모리 파일 갱신은 세션 마무리에서.
- [ ] **Step 4: Commit** — 잔여 변경 커밋.

---

### Task 13: 배포 (사용자 확인 후)

- [ ] **Step 1:** 0044를 Management API 레시피(키체인 토큰 → `/database/query`)로 프로덕션 적용 — 적용 전 `select code, sort_order from teams order by 1` 스냅샷, 적용 후 컬럼·정책 확인 쿼리.
- [ ] **Step 2:** `/deploy` 스킬로 커밋·푸시·Vercel 상태 확인(DB 먼저 → 코드 순서 준수).
- [ ] **Step 3:** 프로덕션 스모크: /admin/teams 렌더, 테스트 팀 추가→탭 반영→비활성화→원복(운영 데이터 무손실 — 스모크 후 테스트 팀 비활성 또는 행 삭제는 시드 폴더까지 정리).

## Self-Review 결과

- 스펙 커버리지: DB(2)·캐시(3)·타입(1)·Provider(4)·도메인(5)·서버(6)·엑셀(7,8)·회의록(9)·관리화면(10)·클라(11)·검증/배포(12,13) — 스펙 전 섹션 매핑됨.
- 타입 일관성: `teamsSync`/`activeTeamCodesSync`/`isRegisteredTeamCode`/`isActiveTeamCode`(Task 3 정의)를 6·9·10·13이 동일 명칭으로 소비. `buildWbsColumnMap`(7)을 8이 소비. `useTeamCodes`(4)를 9·11이 소비.
- 알려진 리스크 명시: `Record<TeamCode,…>` 무경고 약화(Task 1 주의 박스 + 11 Step 2 체크), 비활성 팀 담당의 익스포트 유실(8에서 owners 합집합으로 해소), 시드 폴더 보호는 비활성 팀 포함(9).
