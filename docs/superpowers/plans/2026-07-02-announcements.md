# 공지사항 (Announcements) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 프로젝트별 공지사항 — pmo_admin이 작성·고정하고, 모든 인증 사용자가 열람하며, 사이드바 안읽음 배지·대시보드 카드로 노출되는 기능을 빌드한다.

**Architecture:** attendance/members 수직 슬라이스를 1:1로 복제한다: 마이그레이션(0012, RLS 포함) → 도메인 순수 함수(`lib/domain`) → 캐시 리더(`lib/data`) → 서버 액션(`app/actions`) → 서버 페이지 + 클라이언트 보드 → 네비 3곳 등록 + 사이드바 배지 + 대시보드 SectionCard. 읽음 추적은 사용자·프로젝트당 1행 워터마크(`announcement_seen`).

**Tech Stack:** Next.js 15 App Router(서버 컴포넌트 + 서버 액션), Supabase(Postgres + RLS), Tailwind v4 토큰, vitest(도메인만).

**Spec:** `docs/superpowers/specs/2026-07-02-announcements-design.md`

## Global Constraints

- 절대 `git add -A` 금지 — 병렬 세션. 항상 경로를 명시해 스테이징.
- 색상·스타일은 토큰 클래스만 사용 (`bg-brand-weak text-brand`, `bg-delayed-weak text-delayed` 등). hex 하드코딩 금지.
- 모든 사용자 노출 문자열은 i18n dict 경유. en은 `Record<keyof typeof ko, string>`으로 ko↔en 키 패리티 컴파일 강제 — en 누락 시 빌드 실패.
- 페이지 `params`는 `Promise<{ projectId: string }>` — 반드시 await.
- 서버 액션: `getMembership()` 게이트(null='로그인 필요', 비admin='권한 없음'), `{ ok: boolean; error?: string }` 반환, throw 금지, 성공 시 `revalidatePath`.
- Supabase는 `createServerClient()`(RLS 적용)만 사용. `createAdminClient` 금지.
- RLS 헬퍼: 프로덕션 실배포 함수는 `public.app_role()` (레포 0002/0004 파일의 `current_role()`은 PG 예약어라 실제로는 적용 불가 — 드리프트). 0012는 `app_role() = 'pmo_admin'` 사용.
- 검증은 `npm run build` / `npm run lint` / `npm test` (브라우저로 dev 서버 접근 불가).
- 테스트는 순수 도메인 함수만 (vitest node env, jsdom 없음 — 컴포넌트 테스트 금지).
- Modal z-[150], 토스트 z-[200] — 새 z-index 레이어 도입 금지.
- 커밋 메시지: `feat(announcements): <한국어 요약>` + 빈 줄 + `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.

---

### Task 1: 도메인 계층 (타입 + 순수 함수 + 테스트, TDD)

**Files:**
- Modify: `src/lib/domain/types.ts` (파일 끝에 섹션 추가)
- Create: `src/lib/domain/announcements.ts`
- Test: `tests/domain/announcements.test.ts`

**Interfaces:**
- Consumes: 없음 (독립)
- Produces: `Announcement`, `AnnouncementCategory` 타입; `ANNOUNCEMENT_META: Record<AnnouncementCategory, { labelKey: DictKey형 문자열; chip: string; dot: string }>`; `ANNOUNCEMENT_CATEGORIES: AnnouncementCategory[]`; `sortAnnouncements(items: Announcement[]): Announcement[]`; `isUnread(a: Announcement, lastSeenAt: string | null): boolean`; `countUnread(items: Announcement[], lastSeenAt: string | null): number`; `summarizeAnnouncements(items: Announcement[], todayIso: string): { total: number; pinned: number; recent7d: number }`

- [ ] **Step 1: 타입 추가** — `src/lib/domain/types.ts` 파일 끝(AttendanceRecord 섹션 뒤)에 추가:

```ts
/* ── 공지사항 ── */
export type AnnouncementCategory = 'general' | 'important' | 'event'
export interface Announcement {
  id: string
  projectId: string
  title: string
  body: string
  category: AnnouncementCategory
  isPinned: boolean
  createdAt: string          // ISO timestamptz
  updatedAt: string
}
```

- [ ] **Step 2: 실패하는 테스트 작성** — `tests/domain/announcements.test.ts` 생성 (attendance.test.ts의 factory 관례):

```ts
import { describe, it, expect } from 'vitest'
import {
  ANNOUNCEMENT_META, ANNOUNCEMENT_CATEGORIES,
  sortAnnouncements, isUnread, countUnread, summarizeAnnouncements,
} from '@/lib/domain/announcements'
import type { Announcement, AnnouncementCategory } from '@/lib/domain/types'

function ann(id: string, createdAt: string, opts: Partial<Announcement> = {}): Announcement {
  return {
    id,
    projectId: 'p1',
    title: `공지 ${id}`,
    body: '',
    category: 'general',
    isPinned: false,
    createdAt,
    updatedAt: createdAt,
    ...opts,
  }
}

describe('sortAnnouncements', () => {
  it('고정 공지가 먼저, 그다음 최신순', () => {
    const items = [
      ann('a', '2026-07-01T00:00:00+00:00'),
      ann('b', '2026-07-02T00:00:00+00:00', { isPinned: true }),
      ann('c', '2026-07-03T00:00:00+00:00'),
      ann('d', '2026-06-01T00:00:00+00:00', { isPinned: true }),
    ]
    expect(sortAnnouncements(items).map(x => x.id)).toEqual(['b', 'd', 'c', 'a'])
  })

  it('원본 배열을 변형하지 않는다', () => {
    const items = [ann('a', '2026-07-01T00:00:00+00:00'), ann('b', '2026-07-02T00:00:00+00:00')]
    sortAnnouncements(items)
    expect(items.map(x => x.id)).toEqual(['a', 'b'])
  })

  it('빈 배열은 빈 배열', () => {
    expect(sortAnnouncements([])).toEqual([])
  })
})

describe('isUnread / countUnread', () => {
  const items = [
    ann('a', '2026-07-01T09:00:00+00:00'),
    ann('b', '2026-07-02T09:00:00+00:00'),
    ann('c', '2026-07-03T09:00:00+00:00'),
  ]

  it('워터마크가 null이면 전부 안읽음', () => {
    expect(isUnread(items[0], null)).toBe(true)
    expect(countUnread(items, null)).toBe(3)
  })

  it('워터마크 이후 생성된 공지만 안읽음', () => {
    expect(countUnread(items, '2026-07-02T09:00:00+00:00')).toBe(1)
  })

  it('경계: 워터마크와 같은 시각은 읽음 처리', () => {
    expect(isUnread(items[1], '2026-07-02T09:00:00+00:00')).toBe(false)
  })

  it('빈 배열은 0', () => {
    expect(countUnread([], null)).toBe(0)
  })
})

describe('summarizeAnnouncements', () => {
  it('total / pinned / recent7d 집계', () => {
    const items = [
      ann('a', '2026-07-01T00:00:00+00:00', { isPinned: true }),
      ann('b', '2026-06-26T00:00:00+00:00'),          // 7일 창 경계 안 (today-6)
      ann('c', '2026-06-25T23:59:59+00:00'),          // 창 밖
      ann('d', '2026-07-02T00:00:00+00:00'),
    ]
    expect(summarizeAnnouncements(items, '2026-07-02')).toEqual({ total: 4, pinned: 1, recent7d: 3 })
  })

  it('빈 배열은 전부 0', () => {
    expect(summarizeAnnouncements([], '2026-07-02')).toEqual({ total: 0, pinned: 0, recent7d: 0 })
  })
})

describe('ANNOUNCEMENT_META', () => {
  it('모든 카테고리에 labelKey/chip/dot이 있다', () => {
    const cats: AnnouncementCategory[] = ['general', 'important', 'event']
    expect(ANNOUNCEMENT_CATEGORIES).toEqual(cats)
    for (const c of cats) {
      expect(ANNOUNCEMENT_META[c].labelKey).toBe(`ann.cat.${c}`)
      expect(ANNOUNCEMENT_META[c].chip).toBeTruthy()
      expect(ANNOUNCEMENT_META[c].dot).toBeTruthy()
    }
  })
})
```

- [ ] **Step 3: 테스트 실패 확인**

Run: `npm test -- tests/domain/announcements.test.ts`
Expected: FAIL — `Cannot find module '@/lib/domain/announcements'` (또는 유사한 resolve 에러)

- [ ] **Step 4: 구현** — `src/lib/domain/announcements.ts` 생성:

```ts
import type { Announcement, AnnouncementCategory } from '@/lib/domain/types'

/**
 * 카테고리 메타 — 라벨은 dict 키(표시 지점에서 t()로 해석), 색상은 상태 팔레트
 * 재사용으로 라이트·다크 자동 대응. (ATTENDANCE_META/roleMeta 관례)
 */
export const ANNOUNCEMENT_META: Record<
  AnnouncementCategory,
  { labelKey: `ann.cat.${AnnouncementCategory}`; chip: string; dot: string }
> = {
  general:   { labelKey: 'ann.cat.general',   chip: 'bg-brand-weak text-brand',       dot: 'bg-brand' },
  important: { labelKey: 'ann.cat.important', chip: 'bg-delayed-weak text-delayed',   dot: 'bg-delayed' },
  event:     { labelKey: 'ann.cat.event',     chip: 'bg-progress-weak text-progress', dot: 'bg-progress' },
}

/** 카테고리 표시 순서 (필터 탭/폼 셀렉트용) */
export const ANNOUNCEMENT_CATEGORIES: AnnouncementCategory[] = ['general', 'important', 'event']

/** 고정 우선 → 최신순. 원본을 변형하지 않는다. */
export function sortAnnouncements(items: Announcement[]): Announcement[] {
  return [...items].sort((a, b) => {
    if (a.isPinned !== b.isPinned) return a.isPinned ? -1 : 1
    return Date.parse(b.createdAt) - Date.parse(a.createdAt)
  })
}

/** 워터마크(마지막으로 목록을 본 시각) 이후 생성된 공지인가. null 워터마크 = 전부 안읽음. */
export function isUnread(a: Announcement, lastSeenAt: string | null): boolean {
  if (lastSeenAt === null) return true
  return Date.parse(a.createdAt) > Date.parse(lastSeenAt)
}

export function countUnread(items: Announcement[], lastSeenAt: string | null): number {
  return items.filter((a) => isUnread(a, lastSeenAt)).length
}

const DAY = 86_400_000

/** KPI 집계 — recent7d는 todayIso('YYYY-MM-DD') 포함 직전 7일(UTC 자정 기준). */
export function summarizeAnnouncements(
  items: Announcement[],
  todayIso: string,
): { total: number; pinned: number; recent7d: number } {
  const cutoff = Date.parse(`${todayIso}T00:00:00Z`) - 6 * DAY
  let pinned = 0
  let recent7d = 0
  for (const a of items) {
    if (a.isPinned) pinned++
    if (Date.parse(a.createdAt) >= cutoff) recent7d++
  }
  return { total: items.length, pinned, recent7d }
}
```

- [ ] **Step 5: 테스트 통과 확인**

Run: `npm test -- tests/domain/announcements.test.ts`
Expected: PASS (5 describe / 10 it 전부)

- [ ] **Step 6: 커밋**

```bash
git add src/lib/domain/types.ts src/lib/domain/announcements.ts tests/domain/announcements.test.ts
git commit -m "feat(announcements): 공지 도메인 타입·순수 함수·테스트 추가

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: DB 마이그레이션 0012 + 적용 스크립트

**Files:**
- Create: `supabase/migrations/0012_announcements.sql`
- Create: `scripts/apply-announcements-migration.mjs`

**Interfaces:**
- Consumes: 0002_rls.sql의 `current_role()` 헬퍼(이미 프로덕션 배포됨)
- Produces: `announcements` 테이블(id, project_id, title, body, category, is_pinned, created_by, created_at, updated_at), `announcement_seen` 테이블(user_id, project_id, last_seen_at; PK (user_id, project_id))

- [ ] **Step 1: 마이그레이션 SQL 작성** — `supabase/migrations/0012_announcements.sql`:

```sql
-- 공지사항 (프로젝트 스코프) + 읽음 워터마크
-- 쓰기: pmo_admin 전용 (RLS + 서버 액션 이중 강제) / 읽기: 인증 사용자 전체(게스트 포함)
-- 멱등: SQL Editor 에 여러 번 붙여넣어도 안전 (if not exists / drop policy if exists)

create table if not exists announcements (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  title text not null,
  body text not null default '',
  category text not null default 'general'
    check (category in ('general', 'important', 'event')),
  is_pinned boolean not null default false,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists announcements_project_idx
  on announcements(project_id, created_at desc);

-- 읽음 워터마크: 사용자·프로젝트당 1행 ("마지막으로 공지 목록을 본 시각").
-- 공지별 read 행 대신 워터마크 1행 — 안읽음 수 = created_at > last_seen_at 인 공지 수.
create table if not exists announcement_seen (
  user_id uuid not null references auth.users(id) on delete cascade,
  project_id uuid not null references projects(id) on delete cascade,
  last_seen_at timestamptz not null default now(),
  primary key (user_id, project_id)
);

alter table announcements enable row level security;
alter table announcement_seen enable row level security;

-- 읽기: 로그인 사용자 전체 (0004 관례)
drop policy if exists read_all_announcements on announcements;
create policy read_all_announcements on announcements
  for select to authenticated using (true);

-- 쓰기: PMO admin 전체 (0002 의 current_role() 헬퍼 재사용)
drop policy if exists pmo_write_announcements on announcements;
create policy pmo_write_announcements on announcements
  for all to authenticated
  using (current_role() = 'pmo_admin') with check (current_role() = 'pmo_admin');

-- 워터마크: 본인 행만 읽고 쓴다 (게스트 포함 모든 인증 사용자)
drop policy if exists own_seen_announcements on announcement_seen;
create policy own_seen_announcements on announcement_seen
  for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
```

- [ ] **Step 2: 적용 스크립트 작성** — `scripts/apply-announcements-migration.mjs` (apply-dkbot-migration.mjs 클론, 대상 파일·검증만 교체):

```js
// ---------------------------------------------------------------------------
// 공지사항 마이그레이션(0012) 적용기 (node + pg). psql 없이도 동작.
// SUPABASE_DB_URL 을 .env.local(또는 환경변수)에서 읽어 적용·검증한다.
//
// 사용:
//   npm i --no-save pg && node scripts/apply-announcements-migration.mjs
// ---------------------------------------------------------------------------
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

function readEnvLocal(key) {
  try {
    const txt = readFileSync(join(root, '.env.local'), 'utf8')
    for (const line of txt.split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
      if (m && m[1] === key) return m[2].replace(/^['"]|['"]$/g, '').trim()
    }
  } catch {
    /* no .env.local */
  }
  return ''
}

const dbUrl = process.env.SUPABASE_DB_URL || readEnvLocal('SUPABASE_DB_URL')
if (!dbUrl) {
  console.error('✗ SUPABASE_DB_URL 이 .env.local 또는 환경변수에 없습니다.')
  console.error('  Dashboard > Project Settings > Database > Connection string > URI 를 .env.local 에 넣으세요.')
  process.exit(1)
}

let pg
try {
  pg = await import('pg')
} catch {
  console.error('✗ pg 모듈이 없습니다. 먼저 실행: npm i --no-save pg')
  process.exit(1)
}

const sql = readFileSync(join(root, 'supabase/migrations/0012_announcements.sql'), 'utf8')
const client = new pg.default.Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } })

await client.connect()
try {
  await client.query(sql) // 멱등(create … if not exists / drop policy if exists)
  const tbl = await client.query("select to_regclass('public.announcements') as t")
  const seen = await client.query("select to_regclass('public.announcement_seen') as t")
  const pol = await client.query(
    "select count(*)::int as n from pg_policies where tablename in ('announcements', 'announcement_seen')",
  )
  console.log('✓ 적용 완료')
  console.log('  - announcements 테이블:', tbl.rows[0].t ?? '없음')
  console.log('  - announcement_seen 테이블:', seen.rows[0].t ?? '없음')
  console.log('  - RLS 정책 수:', pol.rows[0].n, '(기대: 3)')
} catch (e) {
  console.error('✗ 적용 실패:', e.message)
  process.exitCode = 1
} finally {
  await client.end()
}
```

- [ ] **Step 3: 프로덕션 적용 + 검증**

Run: `npm i --no-save pg && node scripts/apply-announcements-migration.mjs`
Expected: `✓ 적용 완료` + 두 테이블 이름 + `RLS 정책 수: 3`

`SUPABASE_DB_URL`이 없으면: 과거 0011은 Supabase Management API(키체인 토큰)로 적용했다(프로젝트 ref `rglfgrwwwwdqejohdnty`). 같은 경로로 SQL을 실행하거나, 사용자에게 SQL Editor 붙여넣기를 안내하고 이 Step을 보류로 표시한 뒤 진행한다(코드는 DB 없이도 빌드·테스트 가능).

- [ ] **Step 4: 커밋**

```bash
git add supabase/migrations/0012_announcements.sql scripts/apply-announcements-migration.mjs
git commit -m "feat(announcements): 공지·읽음 워터마크 테이블 + RLS 마이그레이션(0012)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: 데이터 리더 + 서버 액션

**Files:**
- Create: `src/lib/data/announcements.ts`
- Create: `src/app/actions/announcements.ts`

**Interfaces:**
- Consumes: Task 1의 `Announcement`, `AnnouncementCategory`; Task 2의 테이블; `createServerClient`(`@/lib/supabase/server`), `getMembership`/`getSession`(`@/lib/auth`)
- Produces:
  - `getAnnouncements(projectId: string): Promise<Announcement[]>` (고정 우선 → 최신순 정렬 완료 상태로 반환)
  - `getAnnouncementSeenAt(projectId: string): Promise<string | null>`
  - `createAnnouncement(projectId: string, input: AnnouncementInput): Promise<AnnouncementActionResult>`
  - `updateAnnouncement(id: string, input: AnnouncementInput): Promise<AnnouncementActionResult>`
  - `deleteAnnouncement(id: string): Promise<AnnouncementActionResult>`
  - `markAnnouncementsSeen(projectId: string): Promise<AnnouncementActionResult>`
  - `getUnreadAnnouncementCount(projectId: string): Promise<number>`
  - `AnnouncementInput = { title: string; body: string; category: AnnouncementCategory; isPinned: boolean }`, `AnnouncementActionResult = { ok: boolean; error?: string }`

- [ ] **Step 1: 리더 작성** — `src/lib/data/announcements.ts`:

```ts
import { cache } from 'react'
import { createServerClient } from '@/lib/supabase/server'
import type { Announcement, AnnouncementCategory } from '@/lib/domain/types'

/** 프로젝트 공지 목록 — 고정 우선 → 최신순. 실패 시 [] (읽기 계층 관례). */
export const getAnnouncements = cache(async (projectId: string): Promise<Announcement[]> => {
  const sb = await createServerClient()
  const { data } = await sb
    .from('announcements')
    .select('id, project_id, title, body, category, is_pinned, created_at, updated_at')
    .eq('project_id', projectId)
    .order('is_pinned', { ascending: false })
    .order('created_at', { ascending: false })

  return (data ?? []).map((r: Record<string, unknown>) => ({
    id: r.id as string,
    projectId: r.project_id as string,
    title: r.title as string,
    body: (r.body as string) ?? '',
    category: r.category as AnnouncementCategory,
    isPinned: (r.is_pinned as boolean) ?? false,
    createdAt: r.created_at as string,
    updatedAt: r.updated_at as string,
  }))
})

/** 현재 사용자의 읽음 워터마크(마지막으로 공지 목록을 본 시각). 없으면 null. */
export const getAnnouncementSeenAt = cache(async (projectId: string): Promise<string | null> => {
  const sb = await createServerClient()
  const { data: u } = await sb.auth.getUser()
  if (!u.user) return null
  const { data } = await sb
    .from('announcement_seen')
    .select('last_seen_at')
    .eq('user_id', u.user.id)
    .eq('project_id', projectId)
    .maybeSingle()
  return (data?.last_seen_at as string | undefined) ?? null
})
```

- [ ] **Step 2: 서버 액션 작성** — `src/app/actions/announcements.ts`:

```ts
'use server'
import { createServerClient } from '@/lib/supabase/server'
import { getMembership, getSession } from '@/lib/auth'
import { revalidatePath } from 'next/cache'
import type { AnnouncementCategory } from '@/lib/domain/types'

export interface AnnouncementInput {
  title: string
  body: string
  category: AnnouncementCategory
  isPinned: boolean
}

export interface AnnouncementActionResult {
  ok: boolean
  error?: string
}

const CATEGORIES: AnnouncementCategory[] = ['general', 'important', 'event']
const TITLE_MAX = 200
const BODY_MAX = 20000

function validateInput(input: AnnouncementInput): string | null {
  const title = input.title.trim()
  if (!title) return '제목을 입력하세요.'
  if (title.length > TITLE_MAX) return `제목은 ${TITLE_MAX}자 이하여야 합니다.`
  if (input.body.length > BODY_MAX) return `본문은 ${BODY_MAX}자 이하여야 합니다.`
  if (!CATEGORIES.includes(input.category)) return '잘못된 카테고리입니다.'
  return null
}

/** 공지 목록·대시보드 카드 동시 갱신 */
function revalidateAnnouncements(projectId: string) {
  revalidatePath(`/p/${projectId}/announcements`)
  revalidatePath(`/p/${projectId}/dashboard`)
}

export async function createAnnouncement(
  projectId: string,
  input: AnnouncementInput,
): Promise<AnnouncementActionResult> {
  const m = await getMembership()
  if (!m) return { ok: false, error: '로그인 필요' }
  if (m.role !== 'pmo_admin') return { ok: false, error: '권한 없음' }
  const err = validateInput(input)
  if (err) return { ok: false, error: err }

  const user = await getSession()
  const sb = await createServerClient()
  const { error } = await sb.from('announcements').insert({
    project_id: projectId,
    title: input.title.trim(),
    body: input.body,
    category: input.category,
    is_pinned: input.isPinned,
    created_by: user?.id ?? null,
  })
  if (error) return { ok: false, error: error.message }
  revalidateAnnouncements(projectId)
  return { ok: true }
}

export async function updateAnnouncement(
  id: string,
  input: AnnouncementInput,
): Promise<AnnouncementActionResult> {
  const m = await getMembership()
  if (!m) return { ok: false, error: '로그인 필요' }
  if (m.role !== 'pmo_admin') return { ok: false, error: '권한 없음' }
  const err = validateInput(input)
  if (err) return { ok: false, error: err }

  const sb = await createServerClient()
  const { data, error } = await sb
    .from('announcements')
    .update({
      title: input.title.trim(),
      body: input.body,
      category: input.category,
      is_pinned: input.isPinned,
      updated_at: new Date().toISOString(), // updated_at 트리거 없음 — 수동 갱신(wbs.ts 관례)
    })
    .eq('id', id)
    .select('project_id')
    .single()
  if (error) return { ok: false, error: error.message }
  if (data?.project_id) revalidateAnnouncements(data.project_id as string)
  return { ok: true }
}

export async function deleteAnnouncement(id: string): Promise<AnnouncementActionResult> {
  const m = await getMembership()
  if (!m) return { ok: false, error: '로그인 필요' }
  if (m.role !== 'pmo_admin') return { ok: false, error: '권한 없음' }

  const sb = await createServerClient()
  const { data, error } = await sb
    .from('announcements')
    .delete()
    .eq('id', id)
    .select('project_id')
    .single()
  if (error) return { ok: false, error: error.message }
  if (data?.project_id) revalidateAnnouncements(data.project_id as string)
  return { ok: true }
}

/** 공지 목록 확인 처리(워터마크 upsert) — 게스트 포함 모든 인증 사용자. */
export async function markAnnouncementsSeen(projectId: string): Promise<AnnouncementActionResult> {
  const user = await getSession()
  if (!user) return { ok: false, error: '로그인 필요' }
  const sb = await createServerClient()
  const { error } = await sb.from('announcement_seen').upsert(
    { user_id: user.id, project_id: projectId, last_seen_at: new Date().toISOString() },
    { onConflict: 'user_id,project_id' },
  )
  if (error) return { ok: false, error: error.message }
  return { ok: true }
}

/** 사이드바 배지용 안읽음 공지 수 — 워터마크 이후 생성된 공지 count. */
export async function getUnreadAnnouncementCount(projectId: string): Promise<number> {
  const user = await getSession()
  if (!user) return 0
  const sb = await createServerClient()
  const { data: seen } = await sb
    .from('announcement_seen')
    .select('last_seen_at')
    .eq('user_id', user.id)
    .eq('project_id', projectId)
    .maybeSingle()

  let query = sb
    .from('announcements')
    .select('id', { count: 'exact', head: true })
    .eq('project_id', projectId)
  if (seen?.last_seen_at) query = query.gt('created_at', seen.last_seen_at as string)
  const { count } = await query
  return count ?? 0
}
```

- [ ] **Step 3: 정적 검증**

Run: `npm run lint && npx tsc --noEmit`
Expected: 에러 0 (경고는 기존과 동일 수준)

- [ ] **Step 4: 커밋**

```bash
git add src/lib/data/announcements.ts src/app/actions/announcements.ts
git commit -m "feat(announcements): 공지 데이터 리더·서버 액션(CRUD/읽음 처리/배지 카운트)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: i18n 사전

**Files:**
- Create: `src/lib/i18n/dict/announcements.ts`
- Modify: `src/lib/i18n/dict/common.ts` (nav 키 1쌍 추가)
- Modify: `src/lib/i18n/dict.ts` (네임스페이스 등록)

**Interfaces:**
- Consumes: 없음
- Produces: DictKey로 사용 가능한 `ann.*` 키 전체와 `nav.announcements`. 이후 Task 5~8의 모든 문자열이 여기 정의된 키만 사용한다.

- [ ] **Step 1: 공지 네임스페이스 생성** — `src/lib/i18n/dict/announcements.ts`:

```ts
// announcements 화면 사전 — 이 파일은 announcements 영역 담당만 수정한다.
// en은 Record<keyof ko, string> 타입으로 ko와의 키 패리티를 컴파일 타임에 강제한다.
export const announcementsKo = {
  'ann.heroTitleSuffix': '공지사항',
  'ann.heroDesc': '프로젝트 공지를 한곳에서 작성하고 확인하세요. 고정 공지는 항상 맨 위에 표시됩니다.',
  'ann.projectFallback': '프로젝트',
  'ann.kpi.totalSub': '전체 공지',
  'ann.kpi.pinnedSub': '상단 고정',
  'ann.kpi.recentSub': '최근 7일 등록',
  'ann.boardEyebrow': 'Notice board',
  'ann.boardTitle': '공지 목록',
  'ann.unitCount': '건',
  'ann.write': '공지 작성',
  'ann.edit': '공지 수정',
  'ann.filter.all': '전체',
  'ann.cat.general': '일반',
  'ann.cat.important': '중요',
  'ann.cat.event': '행사',
  'ann.pinned': '고정',
  'ann.new': 'NEW',
  'ann.updatedSuffix': ' 수정됨',
  'ann.empty.title': '등록된 공지가 없습니다',
  'ann.empty.desc': '첫 공지를 작성해 팀에 소식을 전하세요.',
  'ann.empty.filtered': '이 카테고리의 공지가 없습니다.',
  'ann.form.title': '제목',
  'ann.form.titlePh': '예: 7월 정기 점검 안내',
  'ann.form.body': '본문',
  'ann.form.bodyPh': '공지 내용을 입력하세요. 줄바꿈이 그대로 표시됩니다.',
  'ann.form.category': '카테고리',
  'ann.form.pin': '상단 고정',
  'ann.saving': '저장 중…',
  'ann.deleting': '삭제 중…',
  'ann.deleteTitle': '공지 삭제',
  'ann.deleteConfirmSuffix': ' 공지를 삭제하시겠습니까? 되돌릴 수 없습니다.',
  'ann.err.titleRequired': '제목을 입력하세요.',
  'ann.err.saveFailed': '저장에 실패했습니다.',
  'ann.err.deleteFailed': '삭제에 실패했습니다.',
  'ann.dash.title': '공지사항',
  'ann.dash.empty': '등록된 공지가 없습니다.',
} as const

export const announcementsEn: Record<keyof typeof announcementsKo, string> = {
  'ann.heroTitleSuffix': 'Announcements',
  'ann.heroDesc': 'Write and read project announcements in one place. Pinned notices always stay on top.',
  'ann.projectFallback': 'Project',
  'ann.kpi.totalSub': 'All announcements',
  'ann.kpi.pinnedSub': 'Pinned on top',
  'ann.kpi.recentSub': 'Posted in last 7 days',
  'ann.boardEyebrow': 'Notice board',
  'ann.boardTitle': 'Announcements',
  'ann.unitCount': '',
  'ann.write': 'New announcement',
  'ann.edit': 'Edit announcement',
  'ann.filter.all': 'All',
  'ann.cat.general': 'General',
  'ann.cat.important': 'Important',
  'ann.cat.event': 'Event',
  'ann.pinned': 'Pinned',
  'ann.new': 'NEW',
  'ann.updatedSuffix': ' edited',
  'ann.empty.title': 'No announcements yet',
  'ann.empty.desc': 'Write the first announcement to share news with the team.',
  'ann.empty.filtered': 'No announcements in this category.',
  'ann.form.title': 'Title',
  'ann.form.titlePh': 'e.g. July maintenance notice',
  'ann.form.body': 'Body',
  'ann.form.bodyPh': 'Write the announcement. Line breaks are preserved.',
  'ann.form.category': 'Category',
  'ann.form.pin': 'Pin to top',
  'ann.saving': 'Saving…',
  'ann.deleting': 'Deleting…',
  'ann.deleteTitle': 'Delete announcement',
  'ann.deleteConfirmSuffix': ' will be deleted. This cannot be undone.',
  'ann.err.titleRequired': 'Enter a title.',
  'ann.err.saveFailed': 'Failed to save.',
  'ann.err.deleteFailed': 'Failed to delete.',
  'ann.dash.title': 'Announcements',
  'ann.dash.empty': 'No announcements yet.',
}
```

- [ ] **Step 2: nav 키 추가** — `src/lib/i18n/dict/common.ts`의 `commonKo`에서 `'nav.attendance': '근태현황',` 다음 줄에 `'nav.announcements': '공지사항',` 추가. `commonEn`에서 `'nav.attendance': 'Attendance',` 다음 줄에 `'nav.announcements': 'Announcements',` 추가.

- [ ] **Step 3: 네임스페이스 등록** — `src/lib/i18n/dict.ts`:
  - import 블록에 추가: `import { announcementsKo, announcementsEn } from './dict/announcements'` (attendance import 아래)
  - `DICT.ko`에 `...attendanceKo,` 다음 줄 `...announcementsKo,` 추가
  - `DICT.en`에 `...attendanceEn,` 다음 줄 `...announcementsEn,` 추가

- [ ] **Step 4: 정적 검증**

Run: `npx tsc --noEmit && npm run lint`
Expected: 에러 0 (ko↔en 패리티가 어긋나면 여기서 컴파일 실패)

- [ ] **Step 5: 커밋**

```bash
git add src/lib/i18n/dict/announcements.ts src/lib/i18n/dict/common.ts src/lib/i18n/dict.ts
git commit -m "feat(announcements): 공지 i18n 사전(ko/en) 추가

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: 클라이언트 보드 (AnnouncementsView)

**Files:**
- Create: `src/components/announcements/AnnouncementsView.tsx`

**Interfaces:**
- Consumes: Task 1 `ANNOUNCEMENT_META`/`ANNOUNCEMENT_CATEGORIES`/`isUnread`/`sortAnnouncements`, Task 3 액션 4종(`createAnnouncement`, `updateAnnouncement`, `deleteAnnouncement`, `markAnnouncementsSeen`), Task 4 `ann.*` 키, UI 프리미티브(Modal/EmptyState/SegmentedTabs)
- Produces: `AnnouncementsView({ announcements, lastSeenAt, canEdit, projectId }: { announcements: Announcement[]; lastSeenAt: string | null; canEdit: boolean; projectId: string })` — Task 6의 페이지가 렌더

- [ ] **Step 1: 컴포넌트 작성** — `src/components/announcements/AnnouncementsView.tsx` (MembersBoard 관례: 단일 폼 모달 + 상호 배타 삭제 모달 + useTransition + router.refresh):

```tsx
'use client'

import { useEffect, useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { AlertTriangle, Megaphone, Pencil, Pin, Plus, Trash2 } from 'lucide-react'
import { Modal } from '@/components/ui/Modal'
import { EmptyState } from '@/components/ui/EmptyState'
import { SegmentedTabs } from '@/components/ui/SegmentedTabs'
import { useLocale } from '@/components/providers/LocaleProvider'
import {
  ANNOUNCEMENT_CATEGORIES, ANNOUNCEMENT_META, isUnread, sortAnnouncements,
} from '@/lib/domain/announcements'
import {
  createAnnouncement, updateAnnouncement, deleteAnnouncement, markAnnouncementsSeen,
} from '@/app/actions/announcements'
import type { Announcement, AnnouncementCategory } from '@/lib/domain/types'

type CategoryFilter = 'all' | AnnouncementCategory

/** 'YYYY-MM-DD' (Asia/Seoul) — 앱 날짜 표기 관례 */
function fmtDate(iso: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date(iso))
}

export function AnnouncementsView({
  announcements,
  lastSeenAt,
  canEdit,
  projectId,
}: {
  announcements: Announcement[]
  lastSeenAt: string | null
  canEdit: boolean
  projectId: string
}) {
  const { t } = useLocale()
  const [filter, setFilter] = useState<CategoryFilter>('all')
  const [reading, setReading] = useState<Announcement | null>(null)
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<Announcement | null>(null)
  const [deleting, setDeleting] = useState<Announcement | null>(null)

  // 방문 = 확인 처리(워터마크 갱신). refresh 하지 않음 — NEW 칩은 이번 방문 동안
  // 유지되고, 사이드바 배지는 다음 네비게이션의 재조회에서 사라진다.
  useEffect(() => {
    markAnnouncementsSeen(projectId).catch(() => {})
  }, [projectId])

  const visible = useMemo(() => {
    const base = filter === 'all' ? announcements : announcements.filter((a) => a.category === filter)
    return sortAnnouncements(base)
  }, [announcements, filter])

  function openWrite() {
    setEditing(null)
    setFormOpen(true)
  }
  function openEdit(a: Announcement) {
    setReading(null)
    setEditing(a)
    setFormOpen(true)
  }

  const tabs: { key: CategoryFilter; label: string }[] = [
    { key: 'all', label: t('ann.filter.all') },
    ...ANNOUNCEMENT_CATEGORIES.map((c) => ({ key: c, label: t(ANNOUNCEMENT_META[c].labelKey) })),
  ]

  return (
    <div className="card overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-4 sm:px-6">
        <div>
          <div className="eyebrow">{t('ann.boardEyebrow')}</div>
          <h2 className="mt-0.5 text-sm font-semibold text-ink">
            {t('ann.boardTitle')} · {announcements.length}{t('ann.unitCount')}
          </h2>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <SegmentedTabs tabs={tabs} value={filter} onChange={setFilter} size="sm" />
          {canEdit && (
            <button onClick={openWrite} className="btn btn-primary">
              <Plus className="h-4 w-4" />
              {t('ann.write')}
            </button>
          )}
        </div>
      </div>

      <div className="p-5 sm:p-6">
        {visible.length === 0 ? (
          <EmptyState
            icon={Megaphone}
            title={filter === 'all' ? t('ann.empty.title') : t('ann.empty.filtered')}
            description={filter === 'all' ? t('ann.empty.desc') : undefined}
            action={
              canEdit && filter === 'all' ? (
                <button onClick={openWrite} className="btn btn-primary">
                  <Plus className="h-4 w-4" />
                  {t('ann.write')}
                </button>
              ) : undefined
            }
          />
        ) : (
          <ul className="space-y-3">
            {visible.map((a) => (
              <li key={a.id}>
                <AnnouncementRow
                  item={a}
                  unread={isUnread(a, lastSeenAt)}
                  canEdit={canEdit}
                  onRead={() => setReading(a)}
                  onEdit={() => openEdit(a)}
                  onDelete={() => setDeleting(a)}
                />
              </li>
            ))}
          </ul>
        )}
      </div>

      <ReadModal
        item={reading}
        canEdit={canEdit}
        onClose={() => setReading(null)}
        onEdit={() => reading && openEdit(reading)}
        onDelete={() => {
          if (!reading) return
          setDeleting(reading)
          setReading(null)
        }}
      />
      <AnnouncementFormModal
        open={formOpen}
        onClose={() => setFormOpen(false)}
        projectId={projectId}
        initial={editing}
      />
      <DeleteAnnouncementModal item={deleting} onClose={() => setDeleting(null)} />
    </div>
  )
}

function AnnouncementRow({
  item,
  unread,
  canEdit,
  onRead,
  onEdit,
  onDelete,
}: {
  item: Announcement
  unread: boolean
  canEdit: boolean
  onRead: () => void
  onEdit: () => void
  onDelete: () => void
}) {
  const { t } = useLocale()
  const meta = ANNOUNCEMENT_META[item.category]
  const edited = item.updatedAt !== item.createdAt

  return (
    <div
      className={`group flex items-start gap-3 rounded-2xl border bg-surface p-4 transition duration-200 hover:-translate-y-0.5 hover:border-line-strong hover:shadow-[var(--shadow-md)] ${item.isPinned ? 'border-brand/40 bg-brand-weak/30' : 'border-line'}`}
    >
      <button onClick={onRead} className="flex min-w-0 flex-1 items-start gap-3 text-left">
        <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${meta.dot}`} />
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-1.5">
            <span className={`chip ${meta.chip}`}>{t(meta.labelKey)}</span>
            {item.isPinned && (
              <span className="chip bg-pending-weak text-accent-warning">
                <Pin className="h-3 w-3" />
                {t('ann.pinned')}
              </span>
            )}
            {unread && <span className="chip bg-accent-secondary/15 text-accent-secondary">{t('ann.new')}</span>}
          </span>
          <span className="mt-1.5 block truncate text-[15px] font-semibold text-ink" title={item.title}>
            {item.title}
          </span>
          {item.body && (
            <span className="mt-1 line-clamp-2 block text-[13px] leading-5 text-ink-muted">{item.body}</span>
          )}
          <span className="mt-1.5 block text-[11px] tabular-nums text-ink-subtle">
            {fmtDate(item.createdAt)}
            {edited && t('ann.updatedSuffix')}
          </span>
        </span>
      </button>

      {canEdit && (
        <div className="flex shrink-0 items-center gap-1">
          <button
            onClick={onEdit}
            aria-label={`${item.title} ${t('common.edit')}`}
            className="flex h-7 w-7 items-center justify-center rounded-lg border border-line text-ink-subtle transition hover:border-line-strong hover:text-ink"
          >
            <Pencil className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={onDelete}
            aria-label={`${item.title} ${t('common.delete')}`}
            className="flex h-7 w-7 items-center justify-center rounded-lg border border-line text-ink-subtle transition hover:border-delayed hover:text-delayed"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      )}
    </div>
  )
}

function ReadModal({
  item,
  canEdit,
  onClose,
  onEdit,
  onDelete,
}: {
  item: Announcement | null
  canEdit: boolean
  onClose: () => void
  onEdit: () => void
  onDelete: () => void
}) {
  const { t } = useLocale()
  const meta = item ? ANNOUNCEMENT_META[item.category] : null

  return (
    <Modal
      open={!!item}
      onClose={onClose}
      eyebrow="Announcement"
      title={item?.title ?? ''}
      size="lg"
      footer={
        <>
          {canEdit && (
            <button
              onClick={onDelete}
              className="btn bg-delayed text-white shadow-sm transition hover:brightness-105"
            >
              <Trash2 className="h-4 w-4" />
              {t('common.delete')}
            </button>
          )}
          {canEdit && (
            <button onClick={onEdit} className="btn btn-ghost">
              <Pencil className="h-4 w-4" />
              {t('common.edit')}
            </button>
          )}
          <button onClick={onClose} className="btn btn-primary">
            {t('common.close')}
          </button>
        </>
      }
    >
      {item && meta && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className={`chip ${meta.chip}`}>{t(meta.labelKey)}</span>
            {item.isPinned && (
              <span className="chip bg-pending-weak text-accent-warning">
                <Pin className="h-3 w-3" />
                {t('ann.pinned')}
              </span>
            )}
            <span className="text-[11px] tabular-nums text-ink-subtle">
              {fmtDate(item.createdAt)}
              {item.updatedAt !== item.createdAt && t('ann.updatedSuffix')}
            </span>
          </div>
          <p className="whitespace-pre-wrap text-sm leading-6 text-ink">{item.body || '—'}</p>
        </div>
      )}
    </Modal>
  )
}

function AnnouncementFormModal({
  open,
  onClose,
  projectId,
  initial,
}: {
  open: boolean
  onClose: () => void
  projectId: string
  initial: Announcement | null
}) {
  const router = useRouter()
  const { t } = useLocale()
  const isEdit = !!initial
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [category, setCategory] = useState<AnnouncementCategory>('general')
  const [isPinned, setIsPinned] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  useEffect(() => {
    if (!open) return
    setTitle(initial?.title ?? '')
    setBody(initial?.body ?? '')
    setCategory(initial?.category ?? 'general')
    setIsPinned(initial?.isPinned ?? false)
    setError(null)
  }, [open, initial])

  function submit() {
    if (!title.trim()) {
      setError(t('ann.err.titleRequired'))
      return
    }
    const input = { title: title.trim(), body, category, isPinned }
    startTransition(async () => {
      const res = isEdit
        ? await updateAnnouncement(initial!.id, input)
        : await createAnnouncement(projectId, input)
      if (res.ok) {
        onClose()
        router.refresh()
      } else {
        setError(res.error ?? t('ann.err.saveFailed'))
      }
    })
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      eyebrow={isEdit ? 'Edit announcement' : 'New announcement'}
      title={isEdit ? t('ann.edit') : t('ann.write')}
      size="lg"
      footer={
        <>
          <button onClick={onClose} className="btn btn-ghost" disabled={pending}>
            {t('common.cancel')}
          </button>
          <button onClick={submit} className="btn btn-primary" disabled={pending}>
            {pending ? t('ann.saving') : isEdit ? t('common.save') : t('ann.write')}
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <label className="block">
          <span className="mb-1.5 block text-xs font-semibold text-ink-muted">{t('ann.form.title')}</span>
          <input
            className="app-input"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={t('ann.form.titlePh')}
            maxLength={200}
            autoFocus
          />
        </label>

        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="mb-1.5 block text-xs font-semibold text-ink-muted">{t('ann.form.category')}</span>
            <select
              className="app-input"
              value={category}
              onChange={(e) => setCategory(e.target.value as AnnouncementCategory)}
            >
              {ANNOUNCEMENT_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {t(ANNOUNCEMENT_META[c].labelKey)}
                </option>
              ))}
            </select>
          </label>

          <label className="flex items-end gap-2 pb-2.5">
            <input
              type="checkbox"
              checked={isPinned}
              onChange={(e) => setIsPinned(e.target.checked)}
              className="h-4 w-4 accent-brand"
            />
            <span className="inline-flex items-center gap-1 text-sm font-medium text-ink">
              <Pin className="h-3.5 w-3.5 text-ink-subtle" />
              {t('ann.form.pin')}
            </span>
          </label>
        </div>

        <label className="block">
          <span className="mb-1.5 block text-xs font-semibold text-ink-muted">{t('ann.form.body')}</span>
          <textarea
            className="app-textarea"
            rows={8}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder={t('ann.form.bodyPh')}
          />
        </label>

        {error && (
          <div className="flex items-center gap-2 rounded-xl border border-delayed/40 bg-delayed-weak px-3 py-2.5 text-xs font-medium text-delayed">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
            {error}
          </div>
        )}
      </div>
    </Modal>
  )
}

function DeleteAnnouncementModal({ item, onClose }: { item: Announcement | null; onClose: () => void }) {
  const router = useRouter()
  const { t } = useLocale()
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  useEffect(() => {
    if (item) setError(null)
  }, [item])

  function confirm() {
    if (!item) return
    startTransition(async () => {
      const res = await deleteAnnouncement(item.id)
      if (res.ok) {
        onClose()
        router.refresh()
      } else {
        setError(res.error ?? t('ann.err.deleteFailed'))
      }
    })
  }

  return (
    <Modal
      open={!!item}
      onClose={onClose}
      eyebrow="Delete announcement"
      title={t('ann.deleteTitle')}
      footer={
        <>
          <button onClick={onClose} className="btn btn-ghost" disabled={pending}>
            {t('common.cancel')}
          </button>
          <button
            onClick={confirm}
            disabled={pending}
            className="btn bg-delayed text-white shadow-sm transition hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {pending ? t('ann.deleting') : t('common.delete')}
          </button>
        </>
      }
    >
      <p className="text-sm leading-6 text-ink-muted">
        <strong className="text-ink">{item?.title}</strong>
        {t('ann.deleteConfirmSuffix')}
      </p>
      {error && (
        <div className="mt-4 flex items-center gap-2 rounded-xl border border-delayed/40 bg-delayed-weak px-3 py-2.5 text-xs font-medium text-delayed">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
          {error}
        </div>
      )}
    </Modal>
  )
}
```

- [ ] **Step 2: 정적 검증**

Run: `npx tsc --noEmit && npm run lint`
Expected: 에러 0

- [ ] **Step 3: 커밋**

```bash
git add src/components/announcements/AnnouncementsView.tsx
git commit -m "feat(announcements): 공지 보드 클라이언트 컴포넌트(목록/필터/읽기·작성·삭제 모달)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 6: 라우트 (서버 페이지 + 로딩 스켈레톤)

**Files:**
- Create: `src/app/(app)/p/[projectId]/announcements/page.tsx`
- Create: `src/app/(app)/p/[projectId]/announcements/loading.tsx`

**Interfaces:**
- Consumes: Task 1 `summarizeAnnouncements`, Task 3 리더 2종, Task 4 `ann.*` 키, Task 5 `AnnouncementsView`
- Produces: `/p/[projectId]/announcements` 라우트 (Task 7의 네비가 링크)

- [ ] **Step 1: 페이지 작성** — `src/app/(app)/p/[projectId]/announcements/page.tsx` (members/page.tsx 관례):

```tsx
import { Megaphone, Pin, Sparkles } from 'lucide-react'
import { t } from '@/lib/i18n/dict'
import { getServerLocale } from '@/lib/i18n/server'
import { getAnnouncements, getAnnouncementSeenAt } from '@/lib/data/announcements'
import { summarizeAnnouncements } from '@/lib/domain/announcements'
import { getMembership } from '@/lib/auth'
import { listProjects } from '@/app/actions/project'
import { PageHero, HeroBadge } from '@/components/ui/PageHero'
import { KpiCard } from '@/components/ui/KpiCard'
import { AnnouncementsView } from '@/components/announcements/AnnouncementsView'
import { ProjectPageShell } from '@/components/app/ProjectPageShell'

function seoulToday(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date())
}

export default async function AnnouncementsPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params
  const [announcements, lastSeenAt, m, projects, locale] = await Promise.all([
    getAnnouncements(projectId),
    getAnnouncementSeenAt(projectId),
    getMembership(),
    listProjects(),
    getServerLocale(),
  ])

  const project = projects.find((p) => p.id === projectId)
  const projectName = project?.name ?? t(locale, 'ann.projectFallback')
  const canEdit = m?.role === 'pmo_admin'
  const { total, pinned, recent7d } = summarizeAnnouncements(announcements, seoulToday())

  return (
    <ProjectPageShell
      hero={<PageHero
        eyebrow="NOTICE"
        badge={<HeroBadge>Announcements</HeroBadge>}
        title={`${projectName} ${t(locale, 'ann.heroTitleSuffix')}`}
        description={t(locale, 'ann.heroDesc')}
        heroKpis={
          <>
            <KpiCard variant="hero" label="TOTAL" value={total} sub={t(locale, 'ann.kpi.totalSub')} icon={Megaphone} tone="brand" />
            <KpiCard variant="hero" label="PINNED" value={pinned} sub={t(locale, 'ann.kpi.pinnedSub')} icon={Pin} tone="warning" />
            <KpiCard variant="hero" label="LAST 7 DAYS" value={recent7d} sub={t(locale, 'ann.kpi.recentSub')} icon={Sparkles} tone="success" />
          </>
        }
      />}
    >
      <AnnouncementsView
        announcements={announcements}
        lastSeenAt={lastSeenAt}
        canEdit={canEdit}
        projectId={projectId}
      />
    </ProjectPageShell>
  )
}
```

- [ ] **Step 2: 로딩 스켈레톤 작성** — `src/app/(app)/p/[projectId]/announcements/loading.tsx`:

```tsx
import { Skeleton, KpiSkeleton } from '@/components/ui/Skeleton'

export default function Loading() {
  return (
    <div className="space-y-5" role="status" aria-label="공지사항을 불러오는 중">
      {/* 히어로 + KPI 레일 */}
      <section className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(280px,340px)]">
        <Skeleton className="h-[240px] rounded-3xl" />
        <div className="grid content-start gap-3 sm:grid-cols-2 lg:grid-cols-1">
          {Array.from({ length: 3 }).map((_, i) => <KpiSkeleton key={i} />)}
        </div>
      </section>

      {/* 공지 리스트 */}
      <div className="card space-y-3 p-5 sm:p-6">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="flex items-start gap-3 rounded-2xl border border-line p-4">
            <Skeleton className="mt-1.5 h-2 w-2 rounded-full" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-5 w-24 rounded-full" />
              <Skeleton className="h-4 w-2/3 rounded" />
              <Skeleton className="h-3 w-1/2 rounded" />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
```

- [ ] **Step 3: 정적 검증**

Run: `npm run build`
Expected: 빌드 성공, 라우트 목록에 `/p/[projectId]/announcements` 표시

- [ ] **Step 4: 커밋**

```bash
git add "src/app/(app)/p/[projectId]/announcements/page.tsx" "src/app/(app)/p/[projectId]/announcements/loading.tsx"
git commit -m "feat(announcements): 공지사항 페이지 라우트 + 로딩 스켈레톤

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 7: 네비 등록 (사이드바 메뉴+배지, 모바일 메뉴, 브레드크럼)

**Files:**
- Modify: `src/components/app/Sidebar.tsx` (메뉴 항목 + 안읽음 배지)
- Modify: `src/components/app/HeaderChrome.tsx` (SECTION_LABEL + MobileMenu links)

**Interfaces:**
- Consumes: Task 3 `getUnreadAnnouncementCount(projectId): Promise<number>`, Task 4 `nav.announcements`, Task 6 라우트
- Produces: 데스크탑/모바일 네비에서 공지 페이지 진입 + 안읽음 카운트 배지

- [ ] **Step 1: Sidebar 메뉴 항목 추가** — `src/components/app/Sidebar.tsx`:
  - import에 `Megaphone` 추가 (lucide-react import 목록, 알파벳 순서 유지):

```ts
import {
  CalendarCheck, Columns3, FolderOpen, LayoutDashboard, LayoutGrid,
  ListTree, Megaphone, PanelLeft, Plus, Settings, Users, type LucideIcon,
} from 'lucide-react'
import { getUnreadAnnouncementCount } from '@/app/actions/announcements'
```

  - `projectMenu()`의 attendance 항목과 settings 항목 사이에 추가:

```ts
    { href: `${base}/announcements`, labelKey: 'nav.announcements', icon: Megaphone, match: `${base}/announcements` },
```

- [ ] **Step 2: 안읽음 배지 로직 추가** — `Sidebar` 컴포넌트 본문, `const activeId = ...` 아래에 추가 (헤더 벨과 동일한 "네비게이션당 1회 조회" 패턴 — pathname 키잉으로 공지 페이지를 다녀오면 재조회되어 배지가 사라진다):

```ts
  const [unread, setUnread] = useState(0)
  useEffect(() => {
    if (!activeId) { setUnread(0); return }
    let alive = true
    getUnreadAnnouncementCount(activeId)
      .then(n => { if (alive) setUnread(n) })
      .catch(() => {})
    return () => { alive = false }
  }, [activeId, pathname])
```

  - 메뉴 렌더 루프에서 라벨 span 뒤에 배지 렌더 — 기존:

```tsx
                    {!collapsed && <span className="flex-1">{label}</span>}
```

  를 다음으로 교체:

```tsx
                    {!collapsed && <span className="flex-1">{label}</span>}
                    {!collapsed && item.labelKey === 'nav.announcements' && unread > 0 && (
                      <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-accent-secondary px-1.5 text-[10px] font-bold tabular-nums text-white">
                        {unread > 99 ? '99+' : unread}
                      </span>
                    )}
```

- [ ] **Step 3: HeaderChrome 등록** — `src/components/app/HeaderChrome.tsx`:
  - `SECTION_LABEL` 맵의 `attendance: '근태현황',` 뒤에 `announcements: '공지사항',` 추가.
  - `MobileMenu`의 `links` 배열에서 attendance 항목과 settings 항목 사이에 추가:

```ts
        { href: `/p/${activeId}/announcements`, label: t('nav.announcements') },
```

- [ ] **Step 4: 정적 검증**

Run: `npx tsc --noEmit && npm run lint`
Expected: 에러 0

- [ ] **Step 5: 커밋**

```bash
git add src/components/app/Sidebar.tsx src/components/app/HeaderChrome.tsx
git commit -m "feat(announcements): 네비 등록(사이드바 메뉴·안읽음 배지, 모바일 메뉴, 브레드크럼)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 8: 대시보드 공지 카드

**Files:**
- Modify: `src/app/(app)/p/[projectId]/dashboard/page.tsx` (fetch 추가 + prop 전달)
- Modify: `src/components/dashboard/DashboardView.tsx` (SectionCard 추가)

**Interfaces:**
- Consumes: Task 3 `getAnnouncements`, Task 1 `ANNOUNCEMENT_META`, Task 4 `ann.dash.*` 키
- Produces: 대시보드 상단에 최근 공지 3건 카드(전체 보기 링크 포함)

- [ ] **Step 1: dashboard/page.tsx 수정**:
  - import 추가: `import { getAnnouncements } from '@/lib/data/announcements'`
  - `Promise.all`에 `getAnnouncements(projectId),` 추가하고 구조 분해에 `announcements` 추가:

```ts
  const [{ items, today }, projects, members, attendance, announcements] = await Promise.all([
    getComputedWbs(projectId),
    listProjects(),
    getProjectMembers(projectId),
    getAttendanceRecords(projectId),
    getAnnouncements(projectId),
  ])
```

  - `<DashboardView …>`에 props 2개 추가: `projectId={projectId}` 와 `announcements={announcements}`

- [ ] **Step 2: DashboardView 수정** — `src/components/dashboard/DashboardView.tsx`:
  - import 추가:

```ts
import Link from 'next/link'
import { Megaphone, Pin } from 'lucide-react'   // 기존 lucide import 목록에 병합
import { ANNOUNCEMENT_META } from '@/lib/domain/announcements'
import type { Announcement } from '@/lib/domain/types'   // 기존 타입 import에 병합
```

  - props에 추가 (기존 시그니처에 병합):

```ts
  projectId,
  announcements = [],
```

```ts
  projectId: string
  announcements?: Announcement[]
```

  - 첫 번째 SectionCard(일정 개요, `</SectionCard>` 닫힘 ~line 234)와 그다음 `<div className="grid gap-5 xl:grid-cols-2">` 사이에 공지 카드 삽입 (리더가 고정 우선 정렬로 반환하므로 slice(0,3)이 곧 고정 우선 상위 3건):

```tsx
      {/* 공지사항 — 최근/고정 상위 3건 */}
      <SectionCard
        eyebrow="NOTICE"
        title={tr('ann.dash.title')}
        icon={Megaphone}
        actions={
          <Link href={`/p/${projectId}/announcements`} className="btn btn-ghost h-8 px-3 text-xs">
            {tr('common.viewAll')}
          </Link>
        }
      >
        {announcements.length === 0 ? (
          <MiniEmpty text={tr('ann.dash.empty')} />
        ) : (
          <ul className="space-y-2">
            {announcements.slice(0, 3).map(a => (
              <li key={a.id}>
                <Link
                  href={`/p/${projectId}/announcements`}
                  className="flex items-center gap-3 rounded-xl border border-line bg-surface-2/40 px-3 py-2.5 transition hover:bg-surface-2"
                >
                  <span className={`chip shrink-0 ${ANNOUNCEMENT_META[a.category].chip}`}>
                    {tr(ANNOUNCEMENT_META[a.category].labelKey)}
                  </span>
                  {a.isPinned && <Pin className="h-3.5 w-3.5 shrink-0 text-accent-warning" />}
                  <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-ink" title={a.title}>
                    {a.title}
                  </span>
                  <span className="shrink-0 tabular-nums text-[11px] text-ink-subtle">
                    {new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date(a.createdAt))}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </SectionCard>
```

- [ ] **Step 3: 정적 검증**

Run: `npm run build`
Expected: 빌드 성공 (DashboardView 호출부의 새 필수 prop `projectId` 누락 시 여기서 실패 — dashboard/page.tsx 수정 확인)

- [ ] **Step 4: 커밋**

```bash
git add "src/app/(app)/p/[projectId]/dashboard/page.tsx" src/components/dashboard/DashboardView.tsx
git commit -m "feat(announcements): 대시보드에 최근 공지 카드 추가

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 9: 최종 검증

**Files:** 없음 (검증 전용)

**Interfaces:**
- Consumes: Task 1~8 전체
- Produces: 검증된 빌드 + 테스트 그린 상태

- [ ] **Step 1: 전체 테스트**

Run: `npm test`
Expected: 기존 테스트 + `tests/domain/announcements.test.ts` 전부 PASS

- [ ] **Step 2: 린트 + 빌드**

Run: `npm run lint && npm run build`
Expected: 에러 0, 빌드 성공, 라우트 목록에 `/p/[projectId]/announcements` 포함

- [ ] **Step 3: 마이그레이션 적용 확인** — Task 2 Step 3이 보류였다면 여기서 재시도. 적용됐다면:

Run: `node scripts/apply-announcements-migration.mjs`
Expected: `✓ 적용 완료` (멱등이므로 재실행 안전)

- [ ] **Step 4: 작업 트리 확인**

Run: `git status --short`
Expected: 이 기능 관련 미커밋 파일 없음 (docs/dkbot-process-animation.html 등 무관 파일은 그대로 둔다 — 건드리지 말 것)
