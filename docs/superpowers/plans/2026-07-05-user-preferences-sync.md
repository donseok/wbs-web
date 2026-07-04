# 계정별 UI 설정 동기화 (User Preferences Sync) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 요약 접기·사이드바·테마·언어·WBS 트리 펼침상태를 로그인 계정에 저장해, 어느 기기에서 로그인해도 이전 설정이 그대로 복원되게 한다.

**Architecture:** 로컬 우선 + 서버 동기화. localStorage/쿠키는 즉시 반영되는 로컬 캐시로 유지(첫 페인트 깜빡임 없음, 로그인 전 동작 유지)하고, Supabase가 계정에 붙는 진실 원천이 된다. 앱 로드 시 서버값을 읽어 로컬 캐시를 reconcile(서버가 있으면 서버 우선, 없으면 로컬값 백필)하고, 설정 변경 시 로컬(즉시)+서버(debounce 600ms) 양쪽에 기록한다.

**Tech Stack:** Next.js App Router(서버/클라 컴포넌트 + 서버 액션), Supabase(Postgres + RLS `auth.uid()`), React 18, vitest + jsdom + react-dom/client.

## Global Constraints

- 인증은 Supabase Auth(`auth.getUser()` → `user.id`). 모든 서버 액션은 미로그인 시 **throw 금지, no-op 반환**.
- RLS는 순수 `auth.uid()`만 사용(프로덕션 RLS 헬퍼는 `app_role()`이며 리포지토리와 drift 있음 — `auth.uid()`는 drift 무관).
- 마이그레이션은 **멱등**(`if not exists` / `drop policy if exists`). 프로덕션 적용은 Supabase Management API `POST /v1/projects/<ref>/database/query` (ref: `rglfgrwwwwdqejohdnty`). `.env.local`의 `SUPABASE_DB_URL`은 비어 있어 pg 직결 스크립트 사용 금지.
- 기존 no-flash(테마/언어 첫 페인트) 동작을 깨지 않는다. 서버를 유일 저장소로 만들지 않는다.
- 서버 액션 실패는 UI를 막지 않는다(로컬 캐시가 이미 동작). 실패는 조용히 무시.
- 커밋은 잦게. `git add -A` 금지(병렬 세션) — 변경 파일만 명시적으로 add.
- 테스트: `npm test` (vitest run). 단일 파일: `npx vitest run <path>`. 빌드: `npm run build`. 린트: `npm run lint`.

## File Structure

- Create: `supabase/migrations/0017_user_prefs.sql` — 두 테이블 + RLS.
- Modify: `src/lib/domain/types.ts` — `UiPrefs` 타입 추가.
- Create: `src/app/actions/preferences.ts` — `getUiPrefs/saveUiPrefs/getWbsCollapse/saveWbsCollapse` 서버 액션.
- Create: `src/lib/prefs/sync.ts` — `computePrefsSync` 순수 함수(reconcile 결정).
- Create: `src/lib/prefs/debouncedSave.ts` — `queueUiPref/queueWbsCollapse` 클라이언트 debounce 저장기.
- Modify: `src/components/app/Sidebar.tsx` — 외부 토글 이벤트 + debounce 쓰기.
- Modify: `src/components/providers/ThemeProvider.tsx`, `LocaleProvider.tsx`, `src/components/ui/PageHero.tsx` — 변경 시 debounce 쓰기 훅.
- Create: `src/components/app/PrefsSync.tsx` — 로그인 시 서버값 reconcile(클라 컴포넌트).
- Modify: `src/app/(app)/layout.tsx` — `<PrefsSync/>` 마운트.
- Modify: `src/app/(app)/p/[projectId]/wbs/page.tsx` — `getWbsCollapse` 로드 + `initialCollapsed` 전달.
- Modify: `src/components/wbs/WbsGanttSheet.tsx` — `initialCollapsed` prop + debounce 저장.
- Create/Modify tests: `tests/lib/prefs-sync.test.ts`, `tests/lib/prefs-debounce.test.ts`, `tests/ui/sidebar-sync.test.tsx`, `tests/ui/theme-write.test.tsx`, `tests/ui/wbs-initial-collapsed.test.tsx`.

---

### Task 1: Migration 0017 — user_preferences / user_wbs_state 테이블 + RLS

**Files:**
- Create: `supabase/migrations/0017_user_prefs.sql`

**Interfaces:**
- Produces: 테이블 `user_preferences(user_id uuid PK, prefs jsonb, updated_at)`, `user_wbs_state(user_id uuid, project_id uuid, collapsed jsonb, updated_at, PK(user_id,project_id))`. 둘 다 RLS `user_id = auth.uid()`.

- [ ] **Step 1: 마이그레이션 파일 작성**

`supabase/migrations/0017_user_prefs.sql`:
```sql
-- 계정별 UI 설정 동기화 — 로컬 우선 + 서버 동기화.
-- user_preferences: 전역 설정(요약접기/사이드바/테마/언어) 사용자당 1행 JSONB.
-- user_wbs_state : WBS 트리 접힘 상태 (사용자, 프로젝트)당 1행 (announcement_seen 과 동일 형태).
-- RLS: 본인 행만. 순수 auth.uid() 사용(프로덕션 app_role() drift 무관).
-- 멱등: SQL Editor 에 여러 번 붙여넣어도 안전. 적용: Management API POST /v1/projects/<ref>/database/query.

create table if not exists user_preferences (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  prefs      jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists user_wbs_state (
  user_id    uuid not null references auth.users(id) on delete cascade,
  project_id uuid not null references projects(id) on delete cascade,
  collapsed  jsonb not null default '[]'::jsonb,  -- 접힌 노드 id 문자열 배열
  updated_at timestamptz not null default now(),
  primary key (user_id, project_id)
);

alter table user_preferences enable row level security;
alter table user_wbs_state   enable row level security;

drop policy if exists own_user_preferences on user_preferences;
create policy own_user_preferences on user_preferences
  for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists own_user_wbs_state on user_wbs_state;
create policy own_user_wbs_state on user_wbs_state
  for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
```

- [ ] **Step 2: 프로덕션 적용 (Management API)**

메모리 `rls-helper-drift`의 레시피로 위 SQL 전체를 `POST https://api.supabase.com/v1/projects/rglfgrwwwwdqejohdnty/database/query` body `{"query": "<SQL>"}` 로 실행. (토큰은 keychain.) 브라우저·pg 직결 사용 금지.

- [ ] **Step 3: 적용 검증**

같은 엔드포인트로 실행:
```sql
select to_regclass('public.user_preferences') as up, to_regclass('public.user_wbs_state') as uws;
```
Expected: 두 값 모두 non-null(`user_preferences`, `user_wbs_state`).

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/0017_user_prefs.sql
git commit -m "feat(db): 0017 계정별 UI 설정 테이블(user_preferences, user_wbs_state) + RLS"
```

---

### Task 2: UiPrefs 타입 + preferences 서버 액션

**Files:**
- Modify: `src/lib/domain/types.ts`
- Create: `src/app/actions/preferences.ts`

**Interfaces:**
- Consumes: `createServerClient` from `@/lib/supabase/server`; 테이블(Task 1).
- Produces:
  - `type UiPrefs = { heroCollapsed?: boolean; sidebarCollapsed?: boolean; theme?: 'light'|'dark'; locale?: 'ko'|'en' }`
  - `getUiPrefs(): Promise<UiPrefs>`
  - `saveUiPrefs(patch: Partial<UiPrefs>): Promise<void>` (기존 prefs에 병합)
  - `getWbsCollapse(projectId: string): Promise<string[] | null>`
  - `saveWbsCollapse(projectId: string, ids: string[]): Promise<void>`

- [ ] **Step 1: UiPrefs 타입 추가**

`src/lib/domain/types.ts` 끝에 추가:
```ts
/** 계정별로 동기화되는 전역 UI 설정. 각 키는 서버에 없을 수 있음(부분 저장). */
export interface UiPrefs {
  heroCollapsed?: boolean
  sidebarCollapsed?: boolean
  theme?: 'light' | 'dark'
  locale?: 'ko' | 'en'
}
```

- [ ] **Step 2: 서버 액션 작성**

`src/app/actions/preferences.ts`:
```ts
'use server'
import { createServerClient } from '@/lib/supabase/server'
import type { UiPrefs } from '@/lib/domain/types'

/** 현재 사용자의 전역 UI 설정(없으면 빈 객체). 미로그인 시 {}. */
export async function getUiPrefs(): Promise<UiPrefs> {
  const sb = await createServerClient()
  const { data: u } = await sb.auth.getUser()
  if (!u.user) return {}
  const { data } = await sb
    .from('user_preferences').select('prefs').eq('user_id', u.user.id).maybeSingle()
  return (data?.prefs as UiPrefs) ?? {}
}

/** 전역 설정 부분 병합 upsert. 미로그인 시 no-op. */
export async function saveUiPrefs(patch: Partial<UiPrefs>): Promise<void> {
  const sb = await createServerClient()
  const { data: u } = await sb.auth.getUser()
  if (!u.user) return
  const { data: existing } = await sb
    .from('user_preferences').select('prefs').eq('user_id', u.user.id).maybeSingle()
  const merged = { ...((existing?.prefs as UiPrefs) ?? {}), ...patch }
  await sb.from('user_preferences').upsert(
    { user_id: u.user.id, prefs: merged, updated_at: new Date().toISOString() },
    { onConflict: 'user_id' },
  )
}

/** 프로젝트의 WBS 접힘 id 배열(행 없으면 null). 미로그인 시 null. */
export async function getWbsCollapse(projectId: string): Promise<string[] | null> {
  const sb = await createServerClient()
  const { data: u } = await sb.auth.getUser()
  if (!u.user) return null
  const { data } = await sb
    .from('user_wbs_state').select('collapsed')
    .eq('user_id', u.user.id).eq('project_id', projectId).maybeSingle()
  return (data?.collapsed as string[]) ?? null
}

/** 프로젝트의 WBS 접힘 상태 upsert. 미로그인 시 no-op. */
export async function saveWbsCollapse(projectId: string, ids: string[]): Promise<void> {
  const sb = await createServerClient()
  const { data: u } = await sb.auth.getUser()
  if (!u.user) return
  await sb.from('user_wbs_state').upsert(
    { user_id: u.user.id, project_id: projectId, collapsed: ids, updated_at: new Date().toISOString() },
    { onConflict: 'user_id,project_id' },
  )
}
```

- [ ] **Step 3: 타입체크**

Run: `npm run build`
Expected: 성공(타입 에러 없음). (서버 액션은 supabase/auth 의존이라 vitest 단위 테스트 대상 아님 — 이 리포지토리 관례.)

- [ ] **Step 4: Commit**

```bash
git add src/lib/domain/types.ts src/app/actions/preferences.ts
git commit -m "feat(prefs): UiPrefs 타입 + preferences 서버 액션(get/save UiPrefs·WbsCollapse)"
```

---

### Task 3: computePrefsSync 순수 함수 (reconcile 결정)

**Files:**
- Create: `src/lib/prefs/sync.ts`
- Test: `tests/lib/prefs-sync.test.ts`

**Interfaces:**
- Consumes: `UiPrefs` (Task 2).
- Produces:
  - `type LocalPrefs = { heroCollapsed: boolean; sidebarCollapsed: boolean; theme: 'light'|'dark'; locale: 'ko'|'en' }`
  - `computePrefsSync(server: UiPrefs, local: LocalPrefs): { apply: Partial<LocalPrefs>; backfill: Partial<UiPrefs> }`
  - 규칙: 서버 키가 없으면(`undefined`/`null`) 로컬값을 `backfill`; 있고 로컬과 다르면 `apply`; 같으면 둘 다 스킵.

- [ ] **Step 1: 실패 테스트 작성**

`tests/lib/prefs-sync.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { computePrefsSync, type LocalPrefs } from '@/lib/prefs/sync'

const local: LocalPrefs = { heroCollapsed: true, sidebarCollapsed: false, theme: 'light', locale: 'ko' }

describe('computePrefsSync', () => {
  it('서버가 비어있으면 로컬 전체를 백필하고 apply 없음', () => {
    const r = computePrefsSync({}, local)
    expect(r.apply).toEqual({})
    expect(r.backfill).toEqual(local)
  })

  it('서버 값이 로컬과 다르면 apply, 같으면 무시', () => {
    const r = computePrefsSync({ theme: 'dark', locale: 'ko' }, local)
    expect(r.apply).toEqual({ theme: 'dark' })          // theme 다름 → 적용
    expect(r.backfill).toEqual({ heroCollapsed: true, sidebarCollapsed: false }) // 서버에 없는 것만
    expect('locale' in r.apply).toBe(false)              // locale 같음 → 무시
    expect('locale' in r.backfill).toBe(false)
  })

  it('서버 값이 로컬과 전부 같으면 apply·backfill 모두 비어있음', () => {
    const r = computePrefsSync({ ...local }, local)
    expect(r.apply).toEqual({})
    expect(r.backfill).toEqual({})
  })
})
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run tests/lib/prefs-sync.test.ts`
Expected: FAIL (`@/lib/prefs/sync` 모듈 없음).

- [ ] **Step 3: 구현**

`src/lib/prefs/sync.ts`:
```ts
import type { UiPrefs } from '@/lib/domain/types'

/** 로컬 캐시가 항상 채워 갖는 확정 형태(서버 UiPrefs 는 부분적일 수 있음). */
export type LocalPrefs = {
  heroCollapsed: boolean
  sidebarCollapsed: boolean
  theme: 'light' | 'dark'
  locale: 'ko' | 'en'
}

const KEYS: (keyof LocalPrefs)[] = ['heroCollapsed', 'sidebarCollapsed', 'theme', 'locale']

/**
 * 서버 값과 로컬 현재값을 비교해 UI에 적용할 것(apply)과 서버에 백필할 것(backfill)을 계산한다.
 * - 서버에 값 없음 → 로컬값 백필
 * - 서버에 값 있고 로컬과 다름 → UI에 적용
 * - 같음 → 둘 다 스킵
 */
export function computePrefsSync(
  server: UiPrefs,
  local: LocalPrefs,
): { apply: Partial<LocalPrefs>; backfill: Partial<UiPrefs> } {
  const apply: Partial<LocalPrefs> = {}
  const backfill: Partial<UiPrefs> = {}
  for (const k of KEYS) {
    const sv = server[k]
    if (sv === undefined || sv === null) {
      ;(backfill as Record<string, unknown>)[k] = local[k]
    } else if (sv !== local[k]) {
      ;(apply as Record<string, unknown>)[k] = sv
    }
  }
  return { apply, backfill }
}
```

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run tests/lib/prefs-sync.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/prefs/sync.ts tests/lib/prefs-sync.test.ts
git commit -m "feat(prefs): computePrefsSync — 서버/로컬 reconcile 순수 함수 + 테스트"
```

---

### Task 4: debouncedSave — queueUiPref / queueWbsCollapse

**Files:**
- Create: `src/lib/prefs/debouncedSave.ts`
- Test: `tests/lib/prefs-debounce.test.ts`

**Interfaces:**
- Consumes: `saveUiPrefs`, `saveWbsCollapse` (Task 2); `UiPrefs`.
- Produces:
  - `queueUiPref(patch: Partial<UiPrefs>, delay?=600): void` — 연속 호출을 병합해 1회 `saveUiPrefs` 호출.
  - `queueWbsCollapse(projectId: string, ids: string[], delay?=600): void` — 프로젝트별 최신값만 1회 `saveWbsCollapse` 호출.

- [ ] **Step 1: 실패 테스트 작성**

`tests/lib/prefs-debounce.test.ts`:
```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const saveUiPrefs = vi.fn(async () => {})
const saveWbsCollapse = vi.fn(async () => {})
vi.mock('@/app/actions/preferences', () => ({
  saveUiPrefs: (...a: unknown[]) => saveUiPrefs(...a),
  saveWbsCollapse: (...a: unknown[]) => saveWbsCollapse(...a),
}))

import { queueUiPref, queueWbsCollapse } from '@/lib/prefs/debouncedSave'

beforeEach(() => { vi.useFakeTimers(); saveUiPrefs.mockClear(); saveWbsCollapse.mockClear() })
afterEach(() => { vi.useRealTimers() })

describe('queueUiPref', () => {
  it('연속 호출을 병합해 delay 후 1회만 저장한다', () => {
    queueUiPref({ theme: 'dark' })
    queueUiPref({ locale: 'en' })
    expect(saveUiPrefs).not.toHaveBeenCalled()
    vi.advanceTimersByTime(600)
    expect(saveUiPrefs).toHaveBeenCalledTimes(1)
    expect(saveUiPrefs).toHaveBeenCalledWith({ theme: 'dark', locale: 'en' })
  })
})

describe('queueWbsCollapse', () => {
  it('프로젝트별로 최신값만 저장하고 서로 격리된다', () => {
    queueWbsCollapse('p1', ['a'])
    queueWbsCollapse('p1', ['a', 'b']) // 최신값이 이김
    queueWbsCollapse('p2', ['x'])
    vi.advanceTimersByTime(600)
    expect(saveWbsCollapse).toHaveBeenCalledTimes(2)
    expect(saveWbsCollapse).toHaveBeenCalledWith('p1', ['a', 'b'])
    expect(saveWbsCollapse).toHaveBeenCalledWith('p2', ['x'])
  })
})
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run tests/lib/prefs-debounce.test.ts`
Expected: FAIL (`@/lib/prefs/debouncedSave` 없음).

- [ ] **Step 3: 구현**

`src/lib/prefs/debouncedSave.ts`:
```ts
'use client'
import { saveUiPrefs, saveWbsCollapse } from '@/app/actions/preferences'
import type { UiPrefs } from '@/lib/domain/types'

let pendingPrefs: Partial<UiPrefs> = {}
let prefsTimer: ReturnType<typeof setTimeout> | null = null

/** 전역 설정 변경을 병합해 debounce 저장. 실패는 무시(로컬 캐시가 진실). */
export function queueUiPref(patch: Partial<UiPrefs>, delay = 600): void {
  pendingPrefs = { ...pendingPrefs, ...patch }
  if (prefsTimer) clearTimeout(prefsTimer)
  prefsTimer = setTimeout(() => {
    const p = pendingPrefs
    pendingPrefs = {}
    prefsTimer = null
    void saveUiPrefs(p).catch(() => {})
  }, delay)
}

const wbsPending = new Map<string, string[]>()
const wbsTimers = new Map<string, ReturnType<typeof setTimeout>>()

/** 프로젝트별 WBS 접힘 상태를 debounce 저장(최신값만). 실패는 무시. */
export function queueWbsCollapse(projectId: string, ids: string[], delay = 600): void {
  wbsPending.set(projectId, ids)
  const existing = wbsTimers.get(projectId)
  if (existing) clearTimeout(existing)
  wbsTimers.set(projectId, setTimeout(() => {
    const v = wbsPending.get(projectId) ?? []
    wbsPending.delete(projectId)
    wbsTimers.delete(projectId)
    void saveWbsCollapse(projectId, v).catch(() => {})
  }, delay))
}
```

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run tests/lib/prefs-debounce.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/prefs/debouncedSave.ts tests/lib/prefs-debounce.test.ts
git commit -m "feat(prefs): queueUiPref/queueWbsCollapse debounce 저장기 + 테스트"
```

---

### Task 5: Sidebar — 외부 토글 이벤트 + debounce 쓰기

**Files:**
- Modify: `src/components/app/Sidebar.tsx`
- Test: `tests/ui/sidebar-sync.test.tsx`

**Interfaces:**
- Consumes: `queueUiPref` (Task 4).
- Produces:
  - `export const SIDEBAR_STORAGE_KEY = 'dflow-sidebar'`
  - `export const SIDEBAR_TOGGLE_EVENT = 'dflow-sidebar-toggle'`
  - `export function dispatchSidebarToggle(collapsed: boolean): void` — localStorage 갱신 + CustomEvent dispatch(**서버 쓰기는 하지 않음** — reconcile 재사용 안전).
  - Sidebar는 `SIDEBAR_TOGGLE_EVENT` 수신 시 `collapsed` state 동기화. 사용자 토글(`toggleCollapse`)은 `dispatchSidebarToggle` + `queueUiPref({sidebarCollapsed})` 호출.

- [ ] **Step 1: 실패 테스트 작성**

`tests/ui/sidebar-sync.test.tsx`:
```tsx
// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

vi.mock('next/navigation', () => ({ usePathname: () => '/p/p1/wbs' }))
vi.mock('@/components/providers/LocaleProvider', () => ({ useLocale: () => ({ t: (k: string) => k }) }))
vi.mock('@/app/actions/announcements', () => ({ getUnreadAnnouncementCount: vi.fn(async () => 0) }))
const queueUiPref = vi.fn()
vi.mock('@/lib/prefs/debouncedSave', () => ({ queueUiPref: (...a: unknown[]) => queueUiPref(...a) }))

import { Sidebar, SIDEBAR_TOGGLE_EVENT, dispatchSidebarToggle } from '@/components/app/Sidebar'

describe('Sidebar 서버 동기화 배선', () => {
  let container: HTMLDivElement, root: Root
  beforeEach(() => { container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container); localStorage.clear(); queueUiPref.mockClear() })
  afterEach(() => { act(() => root.unmount()); container.remove() })

  async function mount() {
    await act(async () => root.render(<Sidebar projects={[]} />))
  }

  it('dispatchSidebarToggle 는 localStorage 를 갱신하고 서버 쓰기는 하지 않는다', async () => {
    await mount()
    act(() => dispatchSidebarToggle(true))
    expect(localStorage.getItem('dflow-sidebar')).toBe('1')
    expect(queueUiPref).not.toHaveBeenCalled() // reconcile 재사용 안전
  })

  it('외부 토글 이벤트를 받으면 접힘 클래스가 반영된다', async () => {
    await mount()
    await act(async () => { window.dispatchEvent(new CustomEvent(SIDEBAR_TOGGLE_EVENT, { detail: { collapsed: true } })) })
    // 접힌 상태의 aside 폭 클래스(w-[68px]) 존재로 확인
    expect(container.querySelector('aside')?.className ?? '').toContain('w-[68px]')
  })
})
```
> 참고: 접힘 시 폭 클래스가 다르면 실제 코드의 클래스명으로 교체(구현 Step에서 확인).

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run tests/ui/sidebar-sync.test.tsx`
Expected: FAIL (`dispatchSidebarToggle`/`SIDEBAR_TOGGLE_EVENT` export 없음).

- [ ] **Step 3: 구현**

`src/components/app/Sidebar.tsx` 상단(컴포넌트 밖)에 추가:
```ts
export const SIDEBAR_STORAGE_KEY = 'dflow-sidebar'
export const SIDEBAR_TOGGLE_EVENT = 'dflow-sidebar-toggle'

/** localStorage 갱신 + 이벤트 dispatch. 서버 쓰기는 사용자 토글 시에만(여기서 하지 않음). */
export function dispatchSidebarToggle(collapsed: boolean): void {
  try { localStorage.setItem(SIDEBAR_STORAGE_KEY, collapsed ? '1' : '0') } catch {}
  window.dispatchEvent(new CustomEvent(SIDEBAR_TOGGLE_EVENT, { detail: { collapsed } }))
}
```

컴포넌트 내부 `collapsed`/`toggleCollapse` 부분(현재 line 38~49)을 교체:
```ts
  const [collapsed, setCollapsed] = useState(false)

  useEffect(() => {
    try { setCollapsed(localStorage.getItem(SIDEBAR_STORAGE_KEY) === '1') } catch {}
  }, [])

  // 외부(PrefsSync reconcile / 헤더 등) 토글 이벤트 수신 — 마운트된 Sidebar 동기화.
  useEffect(() => {
    const onToggle = (e: Event) => setCollapsed((e as CustomEvent<{ collapsed: boolean }>).detail.collapsed)
    window.addEventListener(SIDEBAR_TOGGLE_EVENT, onToggle)
    return () => window.removeEventListener(SIDEBAR_TOGGLE_EVENT, onToggle)
  }, [])

  const toggleCollapse = () => {
    const next = !collapsed
    dispatchSidebarToggle(next)          // localStorage + 이벤트(→ setCollapsed)
    queueUiPref({ sidebarCollapsed: next }) // 사용자 액션만 서버 저장
  }
```
그리고 파일 상단 import에 추가: `import { queueUiPref } from '@/lib/prefs/debouncedSave'`.
구현 중 접힘 폭 클래스명을 확인해 Step 1 테스트의 `w-[68px]` 를 실제 값으로 맞춘다.

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run tests/ui/sidebar-sync.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/components/app/Sidebar.tsx tests/ui/sidebar-sync.test.tsx
git commit -m "feat(prefs): Sidebar 외부 토글 이벤트 + 사용자 토글 서버 저장"
```

---

### Task 6: 설정 변경 시 debounce 쓰기 훅 (Theme / Locale / Hero)

**Files:**
- Modify: `src/components/providers/ThemeProvider.tsx`
- Modify: `src/components/providers/LocaleProvider.tsx`
- Modify: `src/components/ui/PageHero.tsx`
- Test: `tests/ui/theme-write.test.tsx`

**Interfaces:**
- Consumes: `queueUiPref` (Task 4).
- Produces: 각 설정의 단일 변경 지점에서 `queueUiPref` 호출. 이 지점들은 PrefsSync reconcile 에서도 재사용되며(같은 값 재기록은 무해), 서버 쓰기는 debounce 로 병합된다.
  - `ThemeProvider.apply(next)` → `queueUiPref({ theme: next })`
  - `LocaleProvider.setLocale(next)` → `queueUiPref({ locale: next })`
  - `PageHero.dispatchHeroToggle(collapsed)` → `queueUiPref({ heroCollapsed: collapsed })`

- [ ] **Step 1: 실패 테스트 작성**

`tests/ui/theme-write.test.tsx`:
```tsx
// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true
const queueUiPref = vi.fn()
vi.mock('@/lib/prefs/debouncedSave', () => ({ queueUiPref: (...a: unknown[]) => queueUiPref(...a) }))

import { ThemeProvider, useTheme } from '@/components/providers/ThemeProvider'

function Probe() {
  const { setTheme } = useTheme()
  return <button onClick={() => setTheme('dark')}>go</button>
}

describe('ThemeProvider 서버 쓰기', () => {
  let container: HTMLDivElement, root: Root
  beforeEach(() => { container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container); queueUiPref.mockClear() })
  afterEach(() => { act(() => root.unmount()); container.remove() })

  it('테마 변경 시 queueUiPref({theme}) 를 호출한다', async () => {
    await act(async () => root.render(<ThemeProvider><Probe /></ThemeProvider>))
    await act(async () => { container.querySelector('button')!.click() })
    expect(queueUiPref).toHaveBeenCalledWith({ theme: 'dark' })
    expect(document.documentElement.classList.contains('dark')).toBe(true)
  })
})
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run tests/ui/theme-write.test.tsx`
Expected: FAIL (`queueUiPref` 미호출).

- [ ] **Step 3: 구현 — ThemeProvider**

`src/components/providers/ThemeProvider.tsx`: import 추가 `import { queueUiPref } from '@/lib/prefs/debouncedSave'`. `apply` 안 `try {...} catch {}` 다음 줄에 추가:
```ts
    queueUiPref({ theme: next })
```

- [ ] **Step 4: 구현 — LocaleProvider**

`src/components/providers/LocaleProvider.tsx`: import 추가 `import { queueUiPref } from '@/lib/prefs/debouncedSave'`. `setLocale` 안 `try {...} catch {}` 다음(그리고 `router.refresh()` 앞)에 추가:
```ts
      queueUiPref({ locale: next })
```

- [ ] **Step 5: 구현 — PageHero**

`src/components/ui/PageHero.tsx`: import 추가 `import { queueUiPref } from '@/lib/prefs/debouncedSave'`. `dispatchHeroToggle` 안 `window.dispatchEvent(...)` 다음 줄에 추가:
```ts
  queueUiPref({ heroCollapsed: collapsed })
```

- [ ] **Step 6: 통과 확인 + 회귀 확인**

Run: `npx vitest run tests/ui/theme-write.test.tsx`
Expected: PASS.
Run: `npm test`
Expected: 전체 PASS(기존 테스트 포함 — hero/wbs 등 회귀 없음).

- [ ] **Step 7: Commit**

```bash
git add src/components/providers/ThemeProvider.tsx src/components/providers/LocaleProvider.tsx src/components/ui/PageHero.tsx tests/ui/theme-write.test.tsx
git commit -m "feat(prefs): 테마/언어/요약 변경 시 계정 저장(queueUiPref) 배선"
```

---

### Task 7: PrefsSync — 로그인 시 서버값 reconcile

**Files:**
- Create: `src/components/app/PrefsSync.tsx`
- Modify: `src/app/(app)/layout.tsx`

**Interfaces:**
- Consumes: `getUiPrefs` (Task 2), `computePrefsSync`/`LocalPrefs` (Task 3), `queueUiPref` (Task 4), `useTheme` (ThemeProvider), `useLocale` (LocaleProvider), `dispatchHeroToggle`/`readHeroCollapsed` (PageHero), `dispatchSidebarToggle`/`SIDEBAR_STORAGE_KEY` (Sidebar).
- Produces: `<PrefsSync/>` — 마운트 시 1회 서버 설정을 읽어 로컬 캐시/UI를 reconcile. 렌더 출력 없음(`null`). `(app)` 레이아웃(인증 영역)에서만 마운트되며 root 레이아웃의 Theme/Locale 프로바이더 안쪽에 위치.

- [ ] **Step 1: 컴포넌트 작성**

`src/components/app/PrefsSync.tsx`:
```tsx
'use client'
import { useEffect, useRef } from 'react'
import { getUiPrefs } from '@/app/actions/preferences'
import { computePrefsSync, type LocalPrefs } from '@/lib/prefs/sync'
import { queueUiPref } from '@/lib/prefs/debouncedSave'
import { useTheme } from '@/components/providers/ThemeProvider'
import { useLocale } from '@/components/providers/LocaleProvider'
import { dispatchHeroToggle, readHeroCollapsed } from '@/components/ui/PageHero'
import { dispatchSidebarToggle, SIDEBAR_STORAGE_KEY } from '@/components/app/Sidebar'

/**
 * 현재 로컬 상태를 LocalPrefs 로 읽는다. 테마는 DOM 클래스(no-flash 스크립트가 이미 설정),
 * 언어는 쿠키에서 직접 읽는다 — context 값은 렌더 시점 초기값이라 effect 시점에 stale 하다.
 */
function readLocal(): LocalPrefs {
  let sidebarCollapsed = false
  try { sidebarCollapsed = localStorage.getItem(SIDEBAR_STORAGE_KEY) === '1' } catch {}
  const theme: 'light' | 'dark' = document.documentElement.classList.contains('dark') ? 'dark' : 'light'
  const cookieLocale = document.cookie.match(/(?:^|; )dflow-locale=([^;]+)/)?.[1]
  const locale: 'ko' | 'en' = cookieLocale === 'en' ? 'en' : 'ko'
  return { heroCollapsed: readHeroCollapsed(), sidebarCollapsed, theme, locale }
}

/**
 * 로그인 시 서버 설정을 읽어 로컬 캐시/UI 를 reconcile 한다(로컬 우선 + 서버 동기화).
 * 서버 값이 있으면 UI에 적용, 없으면 로컬값을 서버에 백필. 렌더 출력 없음.
 */
export function PrefsSync() {
  const { setTheme } = useTheme()
  const { setLocale } = useLocale()
  const done = useRef(false)

  useEffect(() => {
    if (done.current) return
    done.current = true
    let alive = true
    void getUiPrefs().then(server => {
      if (!alive) return
      const local = readLocal()
      const { apply, backfill } = computePrefsSync(server, local)
      // 적용: 각 설정의 기존 변경 경로 재사용(같은 값이면 computePrefsSync 가 이미 걸러냄).
      if (apply.theme !== undefined) setTheme(apply.theme)
      if (apply.locale !== undefined) setLocale(apply.locale)
      if (apply.heroCollapsed !== undefined) dispatchHeroToggle(apply.heroCollapsed)
      if (apply.sidebarCollapsed !== undefined) dispatchSidebarToggle(apply.sidebarCollapsed)
      // 백필: 서버에 없던 키를 현재 로컬값으로 1회 저장(debounce 병합).
      if (Object.keys(backfill).length) queueUiPref(backfill)
    }).catch(() => {})
    return () => { alive = false }
    // 마운트 1회만. setTheme/setLocale 은 안정적 콜백이고 로컬 상태는 readLocal 이 DOM/쿠키에서 직접 읽음.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return null
}
```
> 주의: `apply` 로 `setTheme`/`dispatchHeroToggle`/`dispatchSidebarToggle` 를 호출하면 Task 5·6 의 쓰기 훅이 같은 값을 재기록할 수 있으나(dispatchSidebarToggle 은 쓰기 없음), 모두 debounce·멱등이라 시작 시 1회 무해한 병합 저장에 그친다. `dispatchSidebarToggle` 은 서버 쓰기가 없어 sidebarCollapsed 재기록도 발생하지 않는다.

- [ ] **Step 2: (app) 레이아웃에 마운트**

`src/app/(app)/layout.tsx`: import 추가 `import { PrefsSync } from '@/components/app/PrefsSync'`. 최상위 `<div className="app-backdrop ...">` 바로 안(첫 자식)에 추가:
```tsx
      <PrefsSync />
```

- [ ] **Step 3: 빌드/린트/회귀 확인**

Run: `npm run build`
Expected: 성공.
Run: `npm run lint`
Expected: 에러 없음.
Run: `npm test`
Expected: 전체 PASS.

- [ ] **Step 4: Commit**

```bash
git add src/components/app/PrefsSync.tsx src/app/(app)/layout.tsx
git commit -m "feat(prefs): PrefsSync — 로그인 시 서버 설정 reconcile(로컬 우선+백필)"
```

---

### Task 8: WBS 트리 접힘 상태 계정 저장/복원

**Files:**
- Modify: `src/app/(app)/p/[projectId]/wbs/page.tsx`
- Modify: `src/components/wbs/WbsGanttSheet.tsx`
- Test: `tests/ui/wbs-initial-collapsed.test.tsx`

**Interfaces:**
- Consumes: `getWbsCollapse` (Task 2), `queueWbsCollapse` (Task 4).
- Produces: `WbsGanttSheet` 에 `initialCollapsed?: string[]` prop 추가. 있으면 초기 접힘 집합으로 사용(없으면 기존 기본값 `splitParentIds(items)`). 사용자 토글 시 `queueWbsCollapse(projectId, [...collapsed])` 로 저장(첫 커밋은 스킵).

- [ ] **Step 1: 실패 테스트 작성**

`tests/ui/wbs-initial-collapsed.test.tsx` — 기존 `tests/ui/wbs-subact-display.test.tsx` 의 fixture/헬퍼를 그대로 재사용하되, `initialCollapsed` 검증만 추가:
```tsx
// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { ComputedItem } from '@/lib/domain/types'

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true
vi.mock('@/app/actions/wbs', () => ({ updateActual: vi.fn(), updateWeight: vi.fn(), addWbsItem: vi.fn() }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }))
vi.mock('@/components/providers/LocaleProvider', () => ({ useLocale: () => ({ locale: 'ko', t: (k: string) => k }) }))
vi.mock('@/components/wbs/RowDetailPanel', () => ({ RowDetailPanel: () => null }))
const queueWbsCollapse = vi.fn()
vi.mock('@/lib/prefs/debouncedSave', () => ({ queueWbsCollapse: (...a: unknown[]) => queueWbsCollapse(...a) }))

import { WbsGanttSheet } from '@/components/wbs/WbsGanttSheet'

function item(over: Partial<ComputedItem>): ComputedItem {
  return { id: 'x', parentId: null, level: 'activity', code: '1', sortOrder: 0, name: '항목', biz: null,
    deliverable: null, plannedStart: '2026-07-01', plannedEnd: '2026-07-10', weight: null, actualPct: 0,
    owners: [], plannedPct: 0, rolledActualPct: 0, achievement: null, status: 'not_started', children: [], ...over }
}
function fixture(): ComputedItem[] {
  const subs = [
    item({ id: 's1', parentId: 'a1', name: 'CBO (가공 주관)', owners: [{ team: '가공', kind: 'primary' }] }),
    item({ id: 's2', parentId: 'a1', name: 'CBO (ERP 주관)', owners: [{ team: 'ERP', kind: 'primary' }] }),
  ]
  const multi = item({ id: 'a1', name: 'CBO', owners: [{ team: '가공', kind: 'primary' }, { team: 'ERP', kind: 'primary' }], children: subs })
  const task = item({ id: 't1', level: 'task', name: '1-1. 작업', children: [multi] })
  return [item({ id: 'p1', level: 'phase', name: '1. 준비', children: [task] })]
}
function rowCount(c: HTMLElement) { return c.querySelectorAll('.group.relative.z-10').length }

describe('WBS initialCollapsed', () => {
  let container: HTMLDivElement, root: Root
  beforeEach(() => { container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container); queueWbsCollapse.mockClear() })
  afterEach(() => { act(() => root.unmount()); container.remove() })

  it('initialCollapsed=[] 이면 기본 접힘을 무시하고 복수담당 부모가 펼쳐진 채 렌더된다', async () => {
    await act(async () => root.render(
      <WbsGanttSheet items={fixture()} holidays={[]} today="2026-07-03" membership={null} projectId="p1" readOnly initialCollapsed={[]} />,
    ))
    // 기본값이면 phase+task+act=3행(sub 숨김). initialCollapsed=[] 이면 sub 2개까지 5행.
    expect(rowCount(container)).toBe(5)
  })

  it('initialCollapsed 미지정이면 기존 기본값(복수담당 부모 접힘)을 유지한다', async () => {
    await act(async () => root.render(
      <WbsGanttSheet items={fixture()} holidays={[]} today="2026-07-03" membership={null} projectId="p1" readOnly />,
    ))
    expect(rowCount(container)).toBe(3)
  })
})
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run tests/ui/wbs-initial-collapsed.test.tsx`
Expected: FAIL (`initialCollapsed` prop 미지원 — 두 케이스 모두 3행).

- [ ] **Step 3: 구현 — WbsGanttSheet**

`src/components/wbs/WbsGanttSheet.tsx`:
- import 수정: `import { useState, useEffect, useMemo, useRef } from 'react'` (useRef 추가).
- import 추가: `import { queueWbsCollapse } from '@/lib/prefs/debouncedSave'`.
- props 구조분해에 `initialCollapsed,` 추가, 타입에 `initialCollapsed?: string[]` 추가(`readOnly?: boolean` 옆).
- `collapsed` 초기화 교체(현재 line 127):
```ts
  const [collapsed, setCollapsed] = useState<Set<string>>(
    () => (initialCollapsed ? new Set(initialCollapsed) : splitParentIds(items)),
  )
  // 사용자 토글 시 개인 뷰 상태를 계정에 저장. 첫 커밋(초기 렌더)은 스킵.
  const didInitCollapse = useRef(false)
  useEffect(() => {
    if (!didInitCollapse.current) { didInitCollapse.current = true; return }
    queueWbsCollapse(projectId, [...collapsed])
  }, [collapsed, projectId])
```

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run tests/ui/wbs-initial-collapsed.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 5: 구현 — wbs/page.tsx**

`src/app/(app)/p/[projectId]/wbs/page.tsx`:
- import 추가: `import { getWbsCollapse } from '@/app/actions/preferences'`.
- `Promise.all` 에 추가하고 prop 전달:
```ts
  const [{ items, holidays, today }, m, projects, initialCollapsed] = await Promise.all([
    getComputedWbs(projectId),
    getMembership(),
    listProjects(),
    getWbsCollapse(projectId),
  ])
```
그리고 `<WbsGanttSheet ... />` 에 `initialCollapsed={initialCollapsed ?? undefined}` 추가.

- [ ] **Step 6: 빌드/회귀 확인**

Run: `npm run build`
Expected: 성공.
Run: `npm test`
Expected: 전체 PASS(기존 wbs 테스트 포함 회귀 없음).

- [ ] **Step 7: Commit**

```bash
git add src/app/(app)/p/[projectId]/wbs/page.tsx src/components/wbs/WbsGanttSheet.tsx tests/ui/wbs-initial-collapsed.test.tsx
git commit -m "feat(prefs): WBS 트리 접힘 상태 계정 저장/복원(initialCollapsed + debounce)"
```

---

## 최종 검증 (전체)

- [ ] `npm test` — 전체 PASS
- [ ] `npm run build` — 성공
- [ ] `npm run lint` — 에러 없음
- [ ] 수동 확인(가능 시): 브라우저 A에서 테마 dark + 요약 접기 + WBS 특정 프로젝트 펼침 → 로그아웃 → 브라우저 B(또는 시크릿)에서 같은 계정 로그인 → 동일하게 복원되는지. (샌드박스 dev 서버 브라우저 접근 불가 시 build/lint/test 로 대체 — 메모리 `wbs-web-verify-env`.)
- [ ] 배포: `deploy` 스킬(커밋 → 푸시 → Vercel). 0017 마이그레이션은 Task 1 에서 프로덕션 선적용 완료 상태여야 함.

## 알려진 트레이드오프 (범위 내 수용)

- 기기 B의 no-flash 쿠키 테마와 서버 저장 테마가 다르면 로그인 직후 1회 테마 플래시 가능(reconcile 이 쿠키를 갱신하므로 다음 로드부터 정상). 수용.
- reconcile 이 `apply` 로 변경 경로를 재사용해 시작 시 같은 값 1회 재기록 가능하나 debounce·멱등이라 무해.
- WBS `initialCollapsed` 의 stale id(현재 트리에 없는 노드)는 무해(존재 id 에만 매칭), 다음 저장 시 자연 정리.

## 범위 밖 (YAGNI)

- 다중 탭 실시간 동기화(storage 이벤트 브로드캐스트), 설정 이력/버전, 관리자 대리 설정, WBS 외 화면 상태(dayPx·컬럼 표시 등) 저장.
