# 회의록 탐색기(폴더 사이드바 + 카드 그리드) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `/minutes` 트리 탭을 좌측 폴더 트리 레일 + 우측 폴더/회의록 카드 그리드 탐색기로 교체하고, 카드 요약(body_preview)·회의 유형 칩·회의록 즐겨찾기(⭐)를 추가한다.

**Architecture:** 스펙 `docs/superpowers/specs/2026-07-23-minutes-explorer-design.md`의 접근 A. 신규 `MinutesExplorer`가 선택·펼침·레이아웃 상태를 자체 관리하고, `MinutesView`는 기존 트리 상태 기계에 즐겨찾기 상태 기계(favState)만 추가한다. DB는 마이그레이션 0039 하나(생성 컬럼 + 즐겨찾기 테이블).

**Tech Stack:** Next.js App Router, Supabase(PostgREST), Tailwind v4 토큰(.card/.btn/.chip/.seg), lucide-react, vitest 4(jsdom + createRoot/act, testing-library 미사용).

## Global Constraints

- **병렬 세션 주의**: `git add`는 항상 파일 명시. `git add -A`/`git add .` 절대 금지 (다른 세션이 meeting-mail 작업 중).
- 스타일은 기존 토큰·프리미티브만: `.card` `.btn` `.chip` `.seg`, `text-ink-*`, `TEAM`/`MEETING_META` 리터럴 맵. 동적 클래스 조합 금지(Tailwind 정적 스캔).
- i18n 키는 ko/en 쌍 필수 — `minutesEn`은 `Record<keyof typeof minutesKo, string>`이라 en 누락은 컴파일 에러.
- 유지해야 할 기존 계약(테스트가 고정): 트리 1회 조회·캐시 재사용, `initialTree` 프리페치 시 재조회 0회, null→에러 카드+재시도, 팀 탭 클라이언트 프루닝, 검색 시 리스트 강제, 월 라벨 `min.tree.allPeriod`, truncated `{n}` 치환, 챗 스코프 전 기간, `min.export.all` 버튼 위치.
- 에러 3원칙: 표시=로깅, 조용한 빈 화면 위장 금지(실패 null ≠ 빈 결과 객체).
- 커밋 메시지 끝에 `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
- **배포 순서**: 코드가 `body_preview`/`minute_favorites`를 조회하므로 **프로덕션 DB에 0039를 먼저 적용한 뒤** 코드를 push/배포한다(Task 7). 로컬 dev도 프로덕션 DB를 공유하므로 런타임 확인 전에도 적용이 선행돼야 한다. 단위 테스트·빌드는 DB 무관.

---

### Task 1: 마이그레이션 0039 + 롤백 스크립트

**Files:**
- Create: `supabase/migrations/0039_minutes_explorer.sql`
- Create: `supabase/migrations/0039_minutes_explorer_rollback.sql`

**Interfaces:**
- Produces: `minutes.body_preview text`(STORED 생성 컬럼), `minute_favorites(user_id, minute_id, created_at)` 테이블 — Task 3의 쿼리가 의존.

- [ ] **Step 1: 정방향 마이그레이션 작성**

`supabase/migrations/0039_minutes_explorer.sql`:

```sql
-- 회의록 탐색기(스펙 2026-07-23-minutes-explorer-design.md) — 카드 요약 + 회의록 즐겨찾기.
-- 멱등: SQL Editor 에 여러 번 붙여넣어도 안전. 적용: Management API POST /v1/projects/<ref>/database/query (db push 금지).
--
-- 1) body_preview — STORED 생성 컬럼. 쓰기 경로(작성·본문 교체·또박또박 외부 업로드 API)를 건드리지
--    않고 항상 일관되며, 기존 행 백필도 ALTER 시 자동(테이블 수백 행 규모라 재작성 비용 무시 가능).
--    마크다운 근사 스트립: 링크/이미지→라벨, 기호 제거, 행머리 불릿 제거, 공백 접기 후 앞 240자.
--    하이픈은 날짜(2026-07-16) 훼손을 피해 행머리 불릿 위치만 제거. 표 구분선 잔해 등 경미한 노이즈 수용.
--    사용 함수(regexp_replace/left/btrim)는 모두 IMMUTABLE — 생성 컬럼 제약 충족.
alter table minutes add column if not exists body_preview text
  generated always as (
    left(
      btrim(regexp_replace(
        regexp_replace(
          regexp_replace(
            regexp_replace(body_md, '!?\[([^\]]*)\]\([^)]*\)', '\1', 'g'),
            '[#*_`~>|]+', '', 'g'),
          '(^|\n)\s*[-+]\s+', '\1', 'g'),
        '\s+', ' ', 'g')),
      240)
  ) stored;

-- 2) minute_favorites — 계정별 회의록 즐겨찾기. 0017 user_preferences 와 동일한 소유자 RLS 관례
--    (순수 auth.uid() — 프로덕션 app_role() drift 무관).
create table if not exists minute_favorites (
  user_id    uuid not null references auth.users(id) on delete cascade,
  minute_id  uuid not null references minutes(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, minute_id)
);

alter table minute_favorites enable row level security;

drop policy if exists own_minute_favorites on minute_favorites;
create policy own_minute_favorites on minute_favorites
  for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
```

- [ ] **Step 2: 롤백 스크립트 작성**

`supabase/migrations/0039_minutes_explorer_rollback.sql`:

```sql
-- 0039 롤백 — body_preview 생성 컬럼과 minute_favorites 테이블 제거.
-- 경고(데이터 소실): 모든 사용자의 즐겨찾기 별이 사라지며 복구 수단이 없다.
--   body_preview 는 생성 컬럼이라 소실 데이터 없음(재적용 시 자동 재계산).
-- 순서: 코드가 body_preview 를 조회(LIST_COLS)하는 상태에서 먼저 drop 하면 회의록 목록·트리가
--   PostgREST 42703 으로 통째로 죽는다 — 반드시 코드 롤백(이전 배포로 되돌림) 후 적용할 것.
-- 적용: Management API POST /v1/projects/<ref>/database/query (정방향과 동일 경로, db push 금지).
-- 멱등: if exists 라 반복 실행 안전.
do $$
begin
  if to_regclass('public.minute_favorites') is not null then
    execute 'drop policy if exists own_minute_favorites on minute_favorites';
  end if;
end $$;
drop table if exists minute_favorites;
alter table minutes drop column if exists body_preview;
```

- [ ] **Step 3: 커밋**

```bash
git add supabase/migrations/0039_minutes_explorer.sql supabase/migrations/0039_minutes_explorer_rollback.sql
git commit -m "chore(db): 0039 회의록 탐색기 — body_preview 생성 컬럼 + minute_favorites

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: 도메인·타입 확장 (bodyPreview·meetingCategory 패스스루, UiPrefs)

**Files:**
- Modify: `src/lib/domain/types.ts` (Minute ~179행, MinutesTreeLeaf ~195행, UiPrefs ~167행)
- Modify: `src/lib/domain/minutes.ts:105-108` (buildMinutesTree 리프 조립)
- Test: `tests/domain/minutesTree.test.ts`

**Interfaces:**
- Consumes: 없음(순수 도메인).
- Produces: `Minute.bodyPreview?: string`, `Minute.meetingCategory?: MeetingCategory | null`, `MinutesTreeLeaf.bodyPreview: string`(필수), `MinutesTreeLeaf.meetingCategory: MeetingCategory | null`(필수), `UiPrefs.minutesExplorerLayout?: 'grid' | 'list'`. Task 3~6이 의존.

- [ ] **Step 1: 실패하는 테스트 추가**

`tests/domain/minutesTree.test.ts`의 `describe('buildMinutesTree')` 블록 안에 추가:

```ts
  it('리프는 bodyPreview·meetingCategory를 패스스루하고, 없으면 기본값("", null)', () => {
    const tree = buildMinutesTree([
      { ...minute('a', '2026-07-16', 'ERP', '정산_260716'), bodyPreview: '요약 문단', meetingCategory: 'routine' },
      minute('b', '2026-07-15', 'ERP', '정산_260715'),
    ])
    const [withMeta, without] = tree[0].bodies[0].leaves
    expect(withMeta.bodyPreview).toBe('요약 문단')
    expect(withMeta.meetingCategory).toBe('routine')
    expect(without.bodyPreview).toBe('')
    expect(without.meetingCategory).toBeNull()
  })
```

같은 파일의 기존 `'리프는 fileCount·createdByName을 담고 자체 재정렬하지 않는다'` 테스트의 `toEqual`을 새 필드 포함으로 교체:

```ts
    expect(leaf).toEqual({
      id: 'a', minuteDate: '2026-07-16', title: '정산_260716',
      fileCount: 1, createdByName: '작성자a',
      bodyPreview: '', meetingCategory: null,
    })
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run tests/domain/minutesTree.test.ts`
Expected: FAIL — 새 테스트에서 `bodyPreview`가 `undefined`(타입 에러 또는 단언 실패).

- [ ] **Step 3: 타입·도메인 구현**

`src/lib/domain/types.ts` — `Minute`의 `fileCount?: number` 줄 아래 추가:

```ts
  bodyPreview?: string              // 카드 요약(0039 생성 컬럼, 목록/트리 조회 전용)
  meetingCategory?: MeetingCategory | null  // 연결 회의 유형(meetings 임베드, 미연결 null)
```

`MinutesTreeLeaf`에 추가(필수 필드):

```ts
export interface MinutesTreeLeaf {
  id: string
  minuteDate: string           // 'YYYY-MM-DD'
  title: string
  fileCount: number
  createdByName: string | null
  bodyPreview: string
  meetingCategory: MeetingCategory | null
}
```

`UiPrefs`의 `minutesView` 줄 아래 추가:

```ts
  minutesExplorerLayout?: 'grid' | 'list'  // 회의록 탐색기 우측 카드 레이아웃
```

`src/lib/domain/minutes.ts:105-108`의 `body.leaves.push({...})`를 교체:

```ts
    body.leaves.push({
      id: mi.id, minuteDate: mi.minuteDate, title: mi.title,
      fileCount: mi.fileCount ?? 0, createdByName: mi.createdByName,
      bodyPreview: mi.bodyPreview ?? '', meetingCategory: mi.meetingCategory ?? null,
    })
```

(`types.ts`에서 `MeetingCategory`가 `Minute`보다 아래 정의라면 import 순서는 무관 — 같은 파일 내 인터페이스 참조는 호이스팅됨.)

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run tests/domain/minutesTree.test.ts`
Expected: PASS (전 케이스). 이 시점에 `tests/ui/minutes-*.test.tsx`는 리프 필수 필드 누락으로 **타입 에러가 나도 무방** — vitest는 파일 단위 트랜스파일이라 해당 파일 실행 전까지 안 터지며, Task 6에서 픽스처를 갱신한다.

- [ ] **Step 5: 커밋**

```bash
git add src/lib/domain/types.ts src/lib/domain/minutes.ts tests/domain/minutesTree.test.ts
git commit -m "feat(minutes): 트리 리프에 bodyPreview·meetingCategory 패스스루 + 탐색기 레이아웃 prefs 타입

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: 데이터 계층 + 서버 액션 (즐겨찾기 CRUD, LIST_COLS 확장)

**Files:**
- Modify: `src/lib/data/minutes.ts` (LIST_COLS :37-38, mapMinute :40-55, 파일 끝에 getMinuteFavorites 추가)
- Modify: `src/app/actions/minutes.ts` (fetchMinutesTree 아래에 액션 2개 추가)
- Test: `tests/minutes/favorites-action.test.ts` (신규)

**Interfaces:**
- Consumes: Task 1의 `minute_favorites`·`body_preview`, Task 2의 `Minute.bodyPreview/meetingCategory`.
- Produces:
  - `getMinuteFavorites(): Promise<string[] | null>` (data)
  - `fetchMinuteFavorites(): Promise<string[] | null>` (action)
  - `toggleMinuteFavorite(minuteId: string, on: boolean): Promise<boolean>` (action)
  - Task 5~6의 UI가 의존.

- [ ] **Step 1: 실패하는 액션 테스트 작성**

`tests/minutes/favorites-action.test.ts` (신규 — node 환경, 프래그마 불필요):

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

// actions/minutes.ts 의 무거운 의존은 전부 목킹 — 이 테스트는 즐겨찾기 액션 2개의 배선만 본다.
const getSession = vi.fn()
vi.mock('@/lib/auth', () => ({
  getSession: (...a: unknown[]) => getSession(...(a as [])),
  getMembership: vi.fn(),
}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('next/server', () => ({ after: vi.fn() }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }))
vi.mock('@/lib/ai/minutes-ingest', () => ({ ingestMinute: vi.fn() }))
vi.mock('@/lib/ai/minutes-insights', () => ({ ensureMinuteInsights: vi.fn(), generateMinuteInsights: vi.fn() }))
vi.mock('@/lib/data/meetings', () => ({ getProjectMeetingData: vi.fn() }))

const getMinuteFavorites = vi.fn()
vi.mock('@/lib/data/minutes', () => ({
  getMinuteDetail: vi.fn(), getMinutesPage: vi.fn(), getMinutesTree: vi.fn(), searchMinutes: vi.fn(),
  getMinuteFavorites: (...a: unknown[]) => getMinuteFavorites(...(a as [])),
}))

// thenable 가짜 빌더 — await sb.from(...).upsert(...) / .delete().eq().eq() 양쪽 체인 지원
type BuilderResult = { error: { message: string } | null }
function fakeClient(result: BuilderResult) {
  const calls: { upsert: unknown[][]; delete: number; eq: unknown[][] } = { upsert: [], delete: 0, eq: [] }
  const builder = {
    upsert: (...a: unknown[]) => { calls.upsert.push(a); return builder },
    delete: () => { calls.delete += 1; return builder },
    eq: (...a: unknown[]) => { calls.eq.push(a); return builder },
    then: (resolve: (v: BuilderResult) => void) => resolve(result),
  }
  return { client: { from: vi.fn(() => builder) }, calls }
}
const createServerClient = vi.fn()
vi.mock('@/lib/supabase/server', () => ({
  createServerClient: (...a: unknown[]) => createServerClient(...(a as [])),
}))

import { fetchMinuteFavorites, toggleMinuteFavorite } from '@/app/actions/minutes'

beforeEach(() => {
  getSession.mockReset(); getMinuteFavorites.mockReset(); createServerClient.mockReset()
})

describe('fetchMinuteFavorites', () => {
  it('미로그인은 데이터 계층을 부르지 않고 null', async () => {
    getSession.mockResolvedValue(null)
    expect(await fetchMinuteFavorites()).toBeNull()
    expect(getMinuteFavorites).not.toHaveBeenCalled()
  })
  it('로그인 시 데이터 계층 결과를 그대로 반환', async () => {
    getSession.mockResolvedValue({ id: 'u1' })
    getMinuteFavorites.mockResolvedValue(['m1', 'm2'])
    expect(await fetchMinuteFavorites()).toEqual(['m1', 'm2'])
  })
})

describe('toggleMinuteFavorite', () => {
  it('미로그인은 false + 클라이언트 미생성', async () => {
    getSession.mockResolvedValue(null)
    expect(await toggleMinuteFavorite('m1', true)).toBe(false)
    expect(createServerClient).not.toHaveBeenCalled()
  })
  it('on=true 는 (user_id, minute_id) upsert(중복 무시)', async () => {
    getSession.mockResolvedValue({ id: 'u1' })
    const { client, calls } = fakeClient({ error: null })
    createServerClient.mockResolvedValue(client)
    expect(await toggleMinuteFavorite('m1', true)).toBe(true)
    expect(calls.upsert[0]).toEqual([
      { user_id: 'u1', minute_id: 'm1' },
      { onConflict: 'user_id,minute_id', ignoreDuplicates: true },
    ])
  })
  it('on=false 는 본인 행 delete', async () => {
    getSession.mockResolvedValue({ id: 'u1' })
    const { client, calls } = fakeClient({ error: null })
    createServerClient.mockResolvedValue(client)
    expect(await toggleMinuteFavorite('m1', false)).toBe(true)
    expect(calls.delete).toBe(1)
    expect(calls.eq).toEqual([[ 'user_id', 'u1' ], [ 'minute_id', 'm1' ]])
  })
  it('DB 에러는 false(호출부가 롤백+토스트)', async () => {
    getSession.mockResolvedValue({ id: 'u1' })
    const { client } = fakeClient({ error: { message: 'boom' } })
    createServerClient.mockResolvedValue(client)
    expect(await toggleMinuteFavorite('m1', true)).toBe(false)
  })
})
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run tests/minutes/favorites-action.test.ts`
Expected: FAIL — `fetchMinuteFavorites`/`toggleMinuteFavorite` export 없음.

- [ ] **Step 3: 데이터 계층 구현**

`src/lib/data/minutes.ts` 수정 3곳:

(a) `LIST_COLS` 교체 — meetings 임베드는 단일 FK(meeting_id) 단일 홉이라 getMinuteDetail의 `meetings(project_id)` 선례와 동일 리스크 수준(0027 사고의 다중 홉 임베드와 다름):

```ts
const LIST_COLS =
  'id, minute_date, team_code, title, meeting_id, created_by, created_by_name, created_at, updated_at, body_preview, minute_files(count), meetings(category)'
```

(b) `mapMinute` 리턴 객체의 `fileCount` 줄 아래 추가 (import 문의 타입 목록에 `MeetingCategory` 추가):

```ts
    bodyPreview: (r.body_preview as string | null) ?? '',
    meetingCategory: ((r.meetings as { category?: MeetingCategory } | null)?.category) ?? null,
```

(c) 파일 끝에 추가:

```ts
/** 내 즐겨찾기 회의록 id 목록(RLS 가 본인 행으로 한정). 실패 시 로깅 + null —
 *  빈 배열과 구분해 '즐겨찾기 없음'으로 위장되는 조용한 빈 화면을 방지한다.
 *  세션 없는 조회는 200+[] 로 돌아오므로(0039 RLS to authenticated) 호출측(page)이 세션 게이트를 건다. */
export const getMinuteFavorites = cache(async (): Promise<string[] | null> => {
  const sb = await createServerClient()
  const { data, error } = await sb.from('minute_favorites').select('minute_id')
  if (error) {
    console.error('[getMinuteFavorites] 조회 실패:', error.message)
    return null
  }
  return (data ?? []).map((r: Row) => r.minute_id as string)
})
```

- [ ] **Step 4: 서버 액션 구현**

`src/app/actions/minutes.ts` — import의 data 목록에 `getMinuteFavorites` 추가, `fetchMinutesTree` 함수 아래에 추가:

```ts
/** 탐색기 즐겨찾기 목록 — 미로그인/실패 null (fetchMinutesTree 관례와 동일). */
export async function fetchMinuteFavorites(): Promise<string[] | null> {
  const user = await getSession()
  if (!user) return null
  return getMinuteFavorites()
}

/** 회의록 즐겨찾기 토글 — 성공 여부만 반환(실패 시 호출부가 낙관적 갱신 롤백 + 토스트). */
export async function toggleMinuteFavorite(minuteId: string, on: boolean): Promise<boolean> {
  const user = await getSession()
  if (!user) return false
  const sb = await createServerClient()
  if (on) {
    const { error } = await sb.from('minute_favorites')
      .upsert({ user_id: user.id, minute_id: minuteId }, { onConflict: 'user_id,minute_id', ignoreDuplicates: true })
    if (error) { console.error('[toggleMinuteFavorite] 저장 실패:', error.message); return false }
  } else {
    const { error } = await sb.from('minute_favorites')
      .delete().eq('user_id', user.id).eq('minute_id', minuteId)
    if (error) { console.error('[toggleMinuteFavorite] 삭제 실패:', error.message); return false }
  }
  return true
}
```

- [ ] **Step 5: 통과 확인**

Run: `npx vitest run tests/minutes/favorites-action.test.ts`
Expected: PASS (6케이스).

- [ ] **Step 6: 커밋**

```bash
git add src/lib/data/minutes.ts src/app/actions/minutes.ts tests/minutes/favorites-action.test.ts
git commit -m "feat(minutes): 즐겨찾기 CRUD 액션 + 목록 쿼리에 body_preview·회의 유형 임베드

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: (Task 5에 통합됨 — 별도 작업 없음)

i18n 키는 탐색기 컴포넌트와 함께 Task 5에서 추가한다(테스트는 `t:(k)=>k` 목킹이라 딕셔너리와 독립).

---

### Task 5: MinutesExplorer 컴포넌트 + i18n 키

**Files:**
- Create: `src/components/minutes/MinutesExplorer.tsx`
- Modify: `src/lib/i18n/dict/minutes.ts` (`min.tree.retry` 줄 아래 ko, en 미러 동일 위치)
- Test: `tests/ui/minutes-explorer.test.tsx` (신규)

**Interfaces:**
- Consumes: Task 2의 `MinutesTreeLeaf.bodyPreview/meetingCategory`, `MEETING_META`(src/lib/domain/meetings.ts), `TEAM`(src/components/wbs/shared.tsx), `SegmentedTabs`/`EmptyState`, `queueUiPref`.
- Produces: `MinutesExplorer` — props `{ groups: MinutesTreeGroup[]; favorites: Set<string> | null; onToggleFavorite: (id: string) => void; onRetryFavorites: () => void; initialLayout?: 'grid' | 'list' }`. Task 6의 MinutesView가 의존. `export type ExplorerLayout = 'grid' | 'list'`.

- [ ] **Step 1: i18n 키 추가**

`src/lib/i18n/dict/minutes.ts` — ko 블록 `'min.tree.retry': '다시 시도',` 아래:

```ts
  // 탐색기 (스펙 2026-07-23-minutes-explorer-design.md)
  'min.exp.favorites': '즐겨찾기',
  'min.exp.all': '전체',
  'min.exp.folders': '폴더',
  'min.exp.meetingCount': '회의록 {n}건',
  'min.exp.subfolderCount': '하위 폴더 {n}개',
  'min.exp.latest': '최근 {d}',
  'min.exp.more': '더 보기 ({n})',
  'min.exp.layout.grid': '그리드',
  'min.exp.layout.list': '리스트',
  'min.exp.favEmpty': '별을 눌러 자주 보는 회의록을 모아두세요',
  'min.exp.favError': '즐겨찾기를 불러오지 못했습니다',
  'min.exp.favToggleError': '즐겨찾기 저장에 실패했습니다',
  'min.exp.starAdd': '즐겨찾기 추가',
  'min.exp.starRemove': '즐겨찾기 해제',
```

en 블록 `'min.tree.retry': 'Retry',` 아래:

```ts
  'min.exp.favorites': 'Favorites',
  'min.exp.all': 'All',
  'min.exp.folders': 'Folders',
  'min.exp.meetingCount': '{n} minutes',
  'min.exp.subfolderCount': '{n} subfolders',
  'min.exp.latest': 'Latest {d}',
  'min.exp.more': 'Show more ({n})',
  'min.exp.layout.grid': 'Grid',
  'min.exp.layout.list': 'List',
  'min.exp.favEmpty': 'Star minutes to collect them here',
  'min.exp.favError': 'Failed to load favorites',
  'min.exp.favToggleError': 'Failed to save favorite',
  'min.exp.starAdd': 'Add to favorites',
  'min.exp.starRemove': 'Remove from favorites',
```

- [ ] **Step 2: 실패하는 컴포넌트 테스트 작성**

`tests/ui/minutes-explorer.test.tsx` (신규):

```tsx
// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { MinutesTreeGroup } from '@/lib/domain/types'

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

vi.mock('@/components/providers/LocaleProvider', () => ({
  useLocale: () => ({ t: (k: string) => k, locale: 'ko' }),
}))
vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: { href: string; children: React.ReactNode }) =>
    <a href={href} {...props}>{children}</a>,
}))
const queueUiPref = vi.fn()
vi.mock('@/lib/prefs/debouncedSave', () => ({ queueUiPref: (...a: unknown[]) => queueUiPref(...(a as [])) }))

import { MinutesExplorer } from '@/components/minutes/MinutesExplorer'

const leaf = (id: string, date: string, title: string, extra: Partial<{
  bodyPreview: string; meetingCategory: 'routine' | null; fileCount: number
}> = {}) => ({
  id, minuteDate: date, title, fileCount: 0, createdByName: '홍길동',
  bodyPreview: '', meetingCategory: null as 'routine' | null, ...extra,
})

const groups = [
  {
    teamCode: 'MES', count: 3,
    bodies: [
      { name: '물류공정', count: 2, latestDate: '2026-07-16', leaves: [
        leaf('m1', '2026-07-16', '물류공정_260716', { bodyPreview: '부자재 발주 요약', meetingCategory: 'routine', fileCount: 2 }),
        leaf('m2', '2026-07-09', '물류공정_260709'),
      ] },
      { name: '공정조', count: 1, latestDate: '2026-07-15', leaves: [leaf('m3', '2026-07-15', '공정조_260715')] },
    ],
  },
  {
    teamCode: 'PMO', count: 1,
    bodies: [{ name: '정산', count: 1, latestDate: '2026-07-14', leaves: [leaf('m4', '2026-07-14', '정산_260714')] }],
  },
] as MinutesTreeGroup[]

describe('MinutesExplorer', () => {
  let container: HTMLDivElement, root: Root
  const onToggle = vi.fn(), onRetry = vi.fn()
  beforeEach(() => {
    container = document.createElement('div'); document.body.appendChild(container)
    root = createRoot(container); onToggle.mockClear(); onRetry.mockClear(); queueUiPref.mockClear()
  })
  afterEach(() => { act(() => root.unmount()); container.remove() })

  async function mount(over: Partial<Parameters<typeof MinutesExplorer>[0]> = {}) {
    await act(async () => root.render(
      <MinutesExplorer groups={groups} favorites={new Set(['m1'])}
        onToggleFavorite={onToggle} onRetryFavorites={onRetry} {...over} />,
    ))
  }
  function buttonByText(text: string): HTMLButtonElement {
    const found = [...container.querySelectorAll('button')].find(b => b.textContent?.includes(text))
    if (!found) throw new Error(`button not found: ${text}`)
    return found
  }

  it('초기 all 스코프: 사이드바 팀 펼침 + 팀 폴더 카드 + 회의록 카드(요약·유형 칩·회의체 칩)', async () => {
    await mount()
    expect(container.textContent).toContain('min.exp.all')
    expect(container.textContent).toContain('물류공정')            // 사이드바 회의체 행(기본 펼침)
    expect(container.textContent).toContain('min.exp.subfolderCount') // 팀 폴더 카드 메타
    expect(container.textContent).toContain('부자재 발주 요약')       // bodyPreview
    expect(container.textContent).toContain('meet.cat.routine')      // 유형 칩
    expect(container.querySelector('a[href="/minutes/m1"]')).toBeTruthy()
  })

  it('팀 폴더 카드 클릭 → team 스코프(회의체 폴더 카드 + 그 팀 리프만)', async () => {
    await mount()
    // 폴더 카드의 팀명 버튼(사이드바 행과 구분: 카드는 min.exp.meetingCount 메타를 포함)
    const card = [...container.querySelectorAll('button')]
      .find(b => b.textContent?.includes('MES') && b.textContent?.includes('min.exp.meetingCount'))!
    await act(async () => card.click())
    expect(container.textContent).toContain('min.exp.latest')   // 회의체 폴더 카드 메타
    expect(container.querySelector('a[href="/minutes/m4"]')).toBeNull() // PMO 리프 제외
  })

  it('회의체 선택(body 스코프) → 폴더 카드 없음 + 회의체 칩 생략', async () => {
    await mount()
    await act(async () => buttonByText('공정조').click())
    expect(container.querySelector('a[href="/minutes/m3"]')).toBeTruthy()
    expect(container.querySelector('a[href="/minutes/m1"]')).toBeNull()
    expect(container.textContent).not.toContain('min.exp.subfolderCount')
  })

  it('별 토글 클릭 → onToggleFavorite(id) 호출, aria-pressed 반영', async () => {
    await mount()
    const stars = [...container.querySelectorAll<HTMLButtonElement>('button[aria-pressed]')]
    const m1star = stars.find(b => b.closest('article')?.textContent?.includes('물류공정_260716'))!
    expect(m1star.getAttribute('aria-pressed')).toBe('true')   // m1 은 즐겨찾기
    await act(async () => m1star.click())
    expect(onToggle).toHaveBeenCalledWith('m1')
  })

  it('즐겨찾기 스코프: fav 리프만 + 카운트, 비면 favEmpty', async () => {
    await mount()
    await act(async () => buttonByText('min.exp.favorites').click())
    expect(container.querySelector('a[href="/minutes/m1"]')).toBeTruthy()
    expect(container.querySelector('a[href="/minutes/m2"]')).toBeNull()
    await mount({ favorites: new Set<string>() })
    await act(async () => buttonByText('min.exp.favorites').click())
    expect(container.textContent).toContain('min.exp.favEmpty')
  })

  it('favorites=null: 카운트 – 표시, 즐겨찾기 스코프는 에러 카드 + 재시도 콜백', async () => {
    await mount({ favorites: null })
    expect(container.textContent).toContain('–')
    await act(async () => buttonByText('min.exp.favorites').click())
    expect(container.textContent).toContain('min.exp.favError')
    await act(async () => buttonByText('min.tree.retry').click())
    expect(onRetry).toHaveBeenCalledTimes(1)
  })

  it('더 보기: 30개 초과분은 숨기고 잔여 건수를 라벨에 노출, 클릭 시 확장', async () => {
    const many = [{
      teamCode: 'MES', count: 35,
      bodies: [{ name: '대량', count: 35, latestDate: '2026-07-16',
        leaves: Array.from({ length: 35 }, (_, i) => leaf(`x${i}`, '2026-07-16', `대량_${i}`)) }],
    }] as MinutesTreeGroup[]
    await mount({ groups: many })
    expect(container.querySelectorAll('a[href^="/minutes/x"]').length).toBe(30)
    expect(container.textContent).toContain('min.exp.more')
    await act(async () => buttonByText('min.exp.more').click())
    expect(container.querySelectorAll('a[href^="/minutes/x"]').length).toBe(35)
  })

  it('레이아웃 토글 → queueUiPref({minutesExplorerLayout}) + 리스트 행 렌더', async () => {
    await mount()
    await act(async () => buttonByText('min.exp.layout.list').click())
    expect(queueUiPref).toHaveBeenCalledWith({ minutesExplorerLayout: 'list' })
    expect(container.querySelector('article')).toBeNull()   // 카드 대신 행
    expect(container.querySelector('a[href="/minutes/m1"]')).toBeTruthy()
  })

  it('팀 탭 프루닝으로 선택 노드가 사라지면 all 로 강등된다', async () => {
    await mount()
    await act(async () => buttonByText('공정조').click())
    await mount({ groups: [groups[1]] })   // MES 가 사라진 프루닝 결과로 리렌더
    expect(container.querySelector('a[href="/minutes/m4"]')).toBeTruthy() // all 폴백으로 PMO 리프 표시
  })
})
```

- [ ] **Step 3: 실패 확인**

Run: `npx vitest run tests/ui/minutes-explorer.test.tsx`
Expected: FAIL — `MinutesExplorer` 모듈 없음.

- [ ] **Step 4: 컴포넌트 구현**

`src/components/minutes/MinutesExplorer.tsx` (신규, 전체):

```tsx
'use client'
import { useMemo, useState } from 'react'
import Link from 'next/link'
import {
  ChevronDown, ChevronRight, Folder, FolderOpen, LayoutGrid, List, Paperclip, Star,
} from 'lucide-react'
import type { MeetingCategory, MinutesTreeGroup, TeamCode } from '@/lib/domain/types'
import { MEETING_META } from '@/lib/domain/meetings'
import { queueUiPref } from '@/lib/prefs/debouncedSave'
import { useLocale } from '@/components/providers/LocaleProvider'
import { SegmentedTabs } from '@/components/ui/SegmentedTabs'
import { EmptyState } from '@/components/ui/EmptyState'
import { TEAM } from '@/components/wbs/shared'

/** 팀 폴더 틴트 — MinutesTree(폐기)에서 승계. Tailwind 정적 스캔 제약으로 리터럴 맵 유지. */
const FOLDER_TINT: Record<TeamCode, string> = {
  PMO: 'fill-team-pmo-weak',
  가공: 'fill-team-dt-weak',
  ERP: 'fill-team-erp-weak',
  MES: 'fill-team-mes-weak',
  MDM: 'fill-team-mdm-weak',
}

export type ExplorerLayout = 'grid' | 'list'
type Scope =
  | { kind: 'all' }
  | { kind: 'favorites' }
  | { kind: 'team'; team: TeamCode }
  | { kind: 'body'; team: TeamCode; body: string }

/** 카드 렌더용 리프 — 소속(팀·회의체)을 부착한 행. */
interface LeafRow {
  id: string; minuteDate: string; title: string; fileCount: number
  createdByName: string | null; bodyPreview: string; meetingCategory: MeetingCategory | null
  team: TeamCode; body: string
}

const PAGE_SIZE = 30
type T = (k: string) => string

const rowCls = (active: boolean) =>
  `flex h-8 w-full min-w-0 items-center gap-2 rounded-lg px-2 text-left transition-colors duration-100 ${
    active ? 'bg-brand-weak font-semibold text-brand' : 'text-ink hover:bg-surface-2'}`

/** 탐색기 — 좌측 폴더 레일 + 우측 폴더/회의록 카드 (스펙 2026-07-23-minutes-explorer-design.md).
 *  트리 데이터·즐겨찾기 상태는 MinutesView 소유(뷰 전환 언마운트에도 생존해야 함) — 여기는
 *  선택·펼침·레이아웃·노출 개수만 관리하며 전부 비영속(v1, 레이아웃만 prefs 동기화). */
export function MinutesExplorer({
  groups, favorites, onToggleFavorite, onRetryFavorites, initialLayout = 'grid',
}: {
  groups: MinutesTreeGroup[]
  /** null = 로딩/실패 — 카운트 '–', 별 비활성, 즐겨찾기 스코프는 에러 카드+재시도 */
  favorites: Set<string> | null
  onToggleFavorite: (id: string) => void
  onRetryFavorites: () => void
  initialLayout?: ExplorerLayout
}) {
  const { t } = useLocale()
  const [scopeRaw, setScopeRaw] = useState<Scope>({ kind: 'all' })
  const [collapsedTeams, setCollapsedTeams] = useState<Set<string>>(new Set())
  const [layout, setLayout] = useState<ExplorerLayout>(initialLayout)
  const [visible, setVisible] = useState(PAGE_SIZE)
  const [mobileOpen, setMobileOpen] = useState(false)

  // 팀 탭 프루닝으로 groups 가 좁아지면 선택이 유령 노드를 가리킬 수 있다 — 조용히 all 로 강등
  const scope: Scope = useMemo(() => {
    if (scopeRaw.kind === 'team' && !groups.some(g => g.teamCode === scopeRaw.team)) return { kind: 'all' }
    if (scopeRaw.kind === 'body' &&
      !groups.some(g => g.teamCode === scopeRaw.team && g.bodies.some(b => b.name === scopeRaw.body)))
      return { kind: 'all' }
    return scopeRaw
  }, [scopeRaw, groups])

  function select(next: Scope) { setScopeRaw(next); setVisible(PAGE_SIZE) }
  function toggleTeam(tk: string) {
    setCollapsedTeams(prev => {
      const next = new Set(prev)
      if (next.has(tk)) next.delete(tk); else next.add(tk)
      return next
    })
  }
  function changeLayout(v: ExplorerLayout) { setLayout(v); queueUiPref({ minutesExplorerLayout: v }) }

  const allRows: LeafRow[] = useMemo(() =>
    groups
      .flatMap(g => g.bodies.flatMap(b => b.leaves.map(l => ({ ...l, team: g.teamCode, body: b.name }))))
      // 그룹 평탄화로 잃은 전역 날짜순 복원 — 안정 정렬이라 회의체 내부 순서(입력 순서)는 유지
      .sort((a, b) => (a.minuteDate < b.minuteDate ? 1 : a.minuteDate > b.minuteDate ? -1 : 0)),
  [groups])

  const total = groups.reduce((n, g) => n + g.count, 0)
  const favCount = favorites === null
    ? null
    : allRows.reduce((n, r) => n + (favorites.has(r.id) ? 1 : 0), 0)

  const rows: LeafRow[] = useMemo(() => {
    switch (scope.kind) {
      case 'all': return allRows
      case 'favorites': return favorites ? allRows.filter(r => favorites.has(r.id)) : []
      case 'team': return allRows.filter(r => r.team === scope.team)
      case 'body': return allRows.filter(r => r.team === scope.team && r.body === scope.body)
    }
  }, [scope, allRows, favorites])
  const shown = rows.slice(0, visible)
  const remaining = rows.length - shown.length
  const showBodyChip = scope.kind !== 'body'

  function rail(onNavigate?: () => void) {
    const go = (s: Scope) => { select(s); onNavigate?.() }
    return (
      <ul className="space-y-0.5">
        <li>
          <button onClick={() => go({ kind: 'favorites' })} className={rowCls(scope.kind === 'favorites')}>
            <Star aria-hidden className="h-4 w-4 shrink-0 fill-accent-warning text-accent-warning" />
            <span className="min-w-0 flex-1 truncate text-[13px] font-medium">{t('min.exp.favorites')}</span>
            <span className="shrink-0 text-xs tabular-nums text-ink-muted">{favCount ?? '–'}</span>
          </button>
        </li>
        <li>
          <button onClick={() => go({ kind: 'all' })} className={rowCls(scope.kind === 'all')}>
            <FolderOpen aria-hidden className="h-4 w-4 shrink-0 text-ink-subtle" />
            <span className="min-w-0 flex-1 truncate text-[13px] font-medium">{t('min.exp.all')}</span>
            <span className="shrink-0 text-xs tabular-nums text-ink-muted">{total}</span>
          </button>
          <ul className="ml-2 mt-0.5 border-l border-line pl-1.5">
            {groups.map(g => {
              const collapsed = collapsedTeams.has(g.teamCode)
              const TeamIcon = collapsed ? Folder : FolderOpen
              return (
                <li key={g.teamCode}>
                  <div className="flex items-center gap-0.5">
                    <button onClick={() => toggleTeam(g.teamCode)} aria-expanded={!collapsed} aria-label={g.teamCode}
                      className="shrink-0 rounded-md p-1 text-ink-subtle transition-colors duration-100 hover:bg-surface-2">
                      <ChevronRight aria-hidden
                        className={`h-3.5 w-3.5 transition-transform duration-150 ${collapsed ? '' : 'rotate-90'}`} />
                    </button>
                    <button onClick={() => go({ kind: 'team', team: g.teamCode })}
                      className={rowCls(scope.kind === 'team' && scope.team === g.teamCode)}>
                      {/* 미지 팀 코드(방어 케이스)는 중립 폴백 */}
                      <TeamIcon aria-hidden
                        className={`h-4 w-4 shrink-0 ${TEAM[g.teamCode]?.fg ?? 'text-ink-subtle'} ${FOLDER_TINT[g.teamCode] ?? ''}`} />
                      <span className="min-w-0 flex-1 truncate text-[13px] font-semibold">{g.teamCode}</span>
                      <span className="shrink-0 text-xs tabular-nums text-ink-muted">{g.count}</span>
                    </button>
                  </div>
                  {!collapsed && (
                    <ul className="ml-5 border-l border-line pl-1.5">
                      {g.bodies.map(b => (
                        <li key={b.name}>
                          <button onClick={() => go({ kind: 'body', team: g.teamCode, body: b.name })}
                            className={rowCls(scope.kind === 'body' && scope.team === g.teamCode && scope.body === b.name)}>
                            <Folder aria-hidden className="h-4 w-4 shrink-0 text-ink-subtle" />
                            <span className="min-w-0 flex-1 truncate text-[13px]">{b.name}</span>
                            <span className="shrink-0 text-xs tabular-nums text-ink-muted">{b.count}</span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              )
            })}
          </ul>
        </li>
      </ul>
    )
  }

  const folderCards = scope.kind === 'all' ? (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {groups.map(g => (
        <button key={g.teamCode} onClick={() => select({ kind: 'team', team: g.teamCode })}
          className="card flex flex-col gap-3 p-4 text-left transition-shadow duration-150 hover:shadow-[var(--shadow-md)]">
          <span className="flex min-w-0 items-center gap-2">
            <Folder aria-hidden className={`h-5 w-5 shrink-0 ${TEAM[g.teamCode]?.fg ?? 'text-ink-subtle'} ${FOLDER_TINT[g.teamCode] ?? ''}`} />
            <span className="truncate text-sm font-semibold text-ink">{g.teamCode}</span>
          </span>
          <span className="text-xs text-ink-muted">
            {t('min.exp.meetingCount').replace('{n}', String(g.count))}
            {' · '}
            {t('min.exp.subfolderCount').replace('{n}', String(g.bodies.length))}
          </span>
        </button>
      ))}
    </div>
  ) : scope.kind === 'team' ? (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {(groups.find(g => g.teamCode === scope.team)?.bodies ?? []).map(b => (
        <button key={b.name} onClick={() => select({ kind: 'body', team: scope.team, body: b.name })}
          className="card flex flex-col gap-3 p-4 text-left transition-shadow duration-150 hover:shadow-[var(--shadow-md)]">
          <span className="flex min-w-0 items-center gap-2">
            <Folder aria-hidden className="h-5 w-5 shrink-0 text-ink-subtle" />
            <span className="truncate text-sm font-semibold text-ink">{b.name}</span>
          </span>
          <span className="text-xs text-ink-muted">
            {t('min.exp.meetingCount').replace('{n}', String(b.count))}
            {' · '}
            {t('min.exp.latest').replace('{d}', b.latestDate)}
          </span>
        </button>
      ))}
    </div>
  ) : null

  return (
    <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
      {/* lg+: 상주 폴더 레일 */}
      <nav className="card hidden w-[240px] shrink-0 p-2 lg:block">{rail()}</nav>
      {/* lg 미만: 접이식 폴더 바 (MinuteToc 관례) */}
      <div className="card shrink-0 p-3 lg:hidden">
        <button onClick={() => setMobileOpen(o => !o)}
          className="flex w-full items-center gap-2 text-sm font-semibold text-ink">
          <Folder aria-hidden className="h-4 w-4 text-brand" />{t('min.exp.folders')}
          {mobileOpen
            ? <ChevronDown aria-hidden className="ml-auto h-4 w-4" />
            : <ChevronRight aria-hidden className="ml-auto h-4 w-4" />}
        </button>
        {mobileOpen && <div className="mt-2">{rail(() => setMobileOpen(false))}</div>}
      </div>

      {/* 우측 콘텐츠 */}
      <section className="min-w-0 flex-1 space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex min-w-0 items-center gap-1.5 text-sm">
            {scope.kind === 'favorites' ? (
              <span className="font-semibold text-ink">{t('min.exp.favorites')}</span>
            ) : (
              <>
                <button onClick={() => select({ kind: 'all' })}
                  className={scope.kind === 'all' ? 'font-semibold text-ink' : 'text-ink-muted transition-colors hover:text-ink'}>
                  {t('min.exp.all')}
                </button>
                {(scope.kind === 'team' || scope.kind === 'body') && (
                  <>
                    <ChevronRight aria-hidden className="h-3.5 w-3.5 shrink-0 text-ink-subtle" />
                    <button onClick={() => select({ kind: 'team', team: scope.team })}
                      className={scope.kind === 'team' ? 'font-semibold text-ink' : 'text-ink-muted transition-colors hover:text-ink'}>
                      {scope.team}
                    </button>
                  </>
                )}
                {scope.kind === 'body' && (
                  <>
                    <ChevronRight aria-hidden className="h-3.5 w-3.5 shrink-0 text-ink-subtle" />
                    <span className="truncate font-semibold text-ink">{scope.body}</span>
                  </>
                )}
              </>
            )}
          </div>
          <div className="ml-auto">
            <SegmentedTabs<ExplorerLayout>
              tabs={[{ key: 'grid', label: t('min.exp.layout.grid'), icon: LayoutGrid },
                     { key: 'list', label: t('min.exp.layout.list'), icon: List }]}
              value={layout} onChange={changeLayout} size="sm" />
          </div>
        </div>

        {scope.kind === 'favorites' && favorites === null ? (
          <EmptyState title={t('min.exp.favError')}
            action={<button onClick={onRetryFavorites} className="btn">{t('min.tree.retry')}</button>} />
        ) : (
          <>
            {folderCards}
            {rows.length === 0 ? (
              scope.kind === 'favorites' && <EmptyState icon={Star} title={t('min.exp.favEmpty')} />
            ) : layout === 'grid' ? (
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                {shown.map(r => (
                  <MinuteCard key={r.id} r={r} t={t} showBodyChip={showBodyChip}
                    fav={favorites?.has(r.id) ?? false} disabled={favorites === null}
                    onToggle={onToggleFavorite} />
                ))}
              </div>
            ) : (
              <div className="card p-2">
                <ul className="divide-y divide-line/70">
                  {shown.map(r => (
                    <MinuteRow key={r.id} r={r} t={t} showBodyChip={showBodyChip}
                      fav={favorites?.has(r.id) ?? false} disabled={favorites === null}
                      onToggle={onToggleFavorite} />
                  ))}
                </ul>
              </div>
            )}
            {remaining > 0 && (
              <div className="flex justify-center">
                <button onClick={() => setVisible(v => v + PAGE_SIZE)} className="btn">
                  {t('min.exp.more').replace('{n}', String(remaining))}
                </button>
              </div>
            )}
          </>
        )}
      </section>
    </div>
  )
}

function StarButton({ id, fav, disabled, onToggle, t }: {
  id: string; fav: boolean; disabled: boolean; onToggle: (id: string) => void; t: T
}) {
  return (
    <button onClick={() => onToggle(id)} disabled={disabled} aria-pressed={fav}
      aria-label={t(fav ? 'min.exp.starRemove' : 'min.exp.starAdd')}
      className="relative z-10 shrink-0 rounded-md p-1 text-ink-subtle transition-colors duration-100 hover:bg-surface-2 hover:text-ink disabled:opacity-40">
      <Star aria-hidden className={`h-4 w-4 ${fav ? 'fill-accent-warning text-accent-warning' : ''}`} />
    </button>
  )
}

function CategoryChip({ cat, t }: { cat: MeetingCategory; t: T }) {
  const meta = MEETING_META[cat]
  return <span className={`chip ${meta.chip}`}>{t(meta.labelKey)}</span>
}

function MinuteCard({ r, fav, disabled, onToggle, showBodyChip, t }: {
  r: LeafRow; fav: boolean; disabled: boolean; onToggle: (id: string) => void
  showBodyChip: boolean; t: T
}) {
  return (
    <article className="card relative flex flex-col gap-2 p-4 transition-shadow duration-150 hover:shadow-[var(--shadow-md)]">
      {/* 스트레치드 링크 — 카드 전면 클릭, 별 버튼만 z-10 으로 위에 */}
      <Link href={`/minutes/${r.id}`} aria-label={r.title} className="absolute inset-0 rounded-2xl" />
      <div className="flex items-start gap-1.5">
        <StarButton id={r.id} fav={fav} disabled={disabled} onToggle={onToggle} t={t} />
        <h4 className="min-w-0 flex-1 truncate pt-0.5 text-sm font-semibold text-ink">{r.title}</h4>
        <span className={`inline-flex shrink-0 justify-center rounded-md px-1.5 py-0.5 text-[11px] font-bold text-white ${TEAM[r.team]?.bar ?? 'bg-ink-subtle'}`}>
          {r.team}
        </span>
      </div>
      {(r.meetingCategory || showBodyChip) && (
        <div className="flex flex-wrap items-center gap-1.5">
          {r.meetingCategory && <CategoryChip cat={r.meetingCategory} t={t} />}
          {showBodyChip && (
            <span className="chip bg-surface-2 text-ink-muted">
              <Folder aria-hidden className="h-3 w-3" />{r.body}
            </span>
          )}
        </div>
      )}
      {r.bodyPreview && <p className="line-clamp-3 text-[13px] leading-5 text-ink-muted">{r.bodyPreview}</p>}
      <div className="mt-auto flex items-center gap-2 pt-1 text-xs text-ink-subtle">
        <span className="tabular-nums">{r.minuteDate}</span>
        {r.createdByName && <><span aria-hidden>·</span><span className="truncate">{r.createdByName}</span></>}
        {r.fileCount > 0 && (
          <span className="ml-auto inline-flex items-center gap-1">
            <Paperclip aria-hidden className="h-3 w-3" />{r.fileCount}
          </span>
        )}
      </div>
    </article>
  )
}

function MinuteRow({ r, fav, disabled, onToggle, showBodyChip, t }: {
  r: LeafRow; fav: boolean; disabled: boolean; onToggle: (id: string) => void
  showBodyChip: boolean; t: T
}) {
  return (
    <li className="relative">
      <Link href={`/minutes/${r.id}`} aria-label={r.title} className="absolute inset-0 rounded-lg" />
      <div className="flex items-center gap-3 rounded-lg px-2 py-2.5 transition-colors duration-100 hover:bg-surface-2">
        <StarButton id={r.id} fav={fav} disabled={disabled} onToggle={onToggle} t={t} />
        <span className={`inline-flex w-12 shrink-0 justify-center rounded-md px-1.5 py-0.5 text-[11px] font-bold text-white ${TEAM[r.team]?.bar ?? 'bg-ink-subtle'}`}>
          {r.team}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium text-ink">{r.title}</span>
          {r.bodyPreview && <span className="block truncate text-xs text-ink-subtle">{r.bodyPreview}</span>}
        </span>
        {r.meetingCategory && <span className="hidden shrink-0 sm:inline-flex"><CategoryChip cat={r.meetingCategory} t={t} /></span>}
        {showBodyChip && (
          <span className="chip hidden shrink-0 bg-surface-2 text-ink-muted md:inline-flex">
            <Folder aria-hidden className="h-3 w-3" />{r.body}
          </span>
        )}
        <span className="w-20 shrink-0 text-right text-xs tabular-nums text-ink-subtle">{r.minuteDate}</span>
      </div>
    </li>
  )
}
```

- [ ] **Step 5: 통과 확인**

Run: `npx vitest run tests/ui/minutes-explorer.test.tsx`
Expected: PASS (9케이스).

- [ ] **Step 6: 커밋**

```bash
git add src/components/minutes/MinutesExplorer.tsx src/lib/i18n/dict/minutes.ts tests/ui/minutes-explorer.test.tsx
git commit -m "feat(minutes): 탐색기 컴포넌트 — 폴더 레일 + 폴더/회의록 카드 + 즐겨찾기 별

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 6: MinutesView·page 통합 + 구 트리 폐기 + 기존 테스트 갱신

**Files:**
- Modify: `src/components/minutes/MinutesView.tsx`
- Modify: `src/app/(app)/minutes/page.tsx`
- Delete: `src/components/minutes/MinutesTree.tsx`, `tests/ui/minutes-tree.test.tsx`
- Test(수정): `tests/ui/minutes-view-initial-tree.test.tsx`, `tests/ui/minutes-view-tree-toggle.test.tsx`, `tests/ui/minutes-export-download.test.tsx`

**Interfaces:**
- Consumes: Task 3의 `fetchMinuteFavorites`/`toggleMinuteFavorite`/`getMinuteFavorites`, Task 5의 `MinutesExplorer`(+`ExplorerLayout`).
- Produces: `MinutesView` 신규 props `initialFavorites?: string[] | null`, `explorerLayout?: 'grid' | 'list'` (모두 옵션 — 하위 호환).

- [ ] **Step 1: 기존 UI 테스트 3개에 실패하는 계약 추가 + 목·픽스처 갱신**

**(a) `tests/ui/minutes-view-initial-tree.test.tsx`:**

액션 목을 교체(23-28행):

```ts
const fetchMinutesTree = vi.fn()
const fetchMinuteFavorites = vi.fn()
vi.mock('@/app/actions/minutes', () => ({
  fetchMinutesRange: vi.fn(async () => []),
  fetchMinutesSearch: vi.fn(async () => []),
  fetchMinutesTree: (...a: unknown[]) => fetchMinutesTree(...(a as [])),
  fetchMinuteFavorites: (...a: unknown[]) => fetchMinuteFavorites(...(a as [])),
  toggleMinuteFavorite: vi.fn(async () => true),
}))
```

리프 픽스처(36행)에 필수 필드 추가:

```ts
    leaves: [{ id: 'm1', minuteDate: '2026-07-16', title: '물류공정_260716', fileCount: 0, createdByName: null, bodyPreview: '', meetingCategory: null }],
```

`beforeEach`에 `fetchMinuteFavorites.mockReset(); fetchMinuteFavorites.mockResolvedValue([])` 추가. `mount` 시그니처에 `initialFavorites: string[] | null = []` 3번째 파라미터를 추가하고 `<MinutesView ... initialFavorites={initialFavorites} />`로 전달. describe 끝에 신규 계약 2개:

```ts
  it('initialFavorites 프리페치 시 즐겨찾기 재조회 0회', async () => {
    await mount('tree', serverTree, ['m1'])
    expect(fetchMinuteFavorites).not.toHaveBeenCalled()
  })

  it('initialFavorites 가 null(실패/미로그인)이면 트리 뷰에서 1회 폴백 조회한다', async () => {
    await mount('tree', serverTree, null)
    expect(fetchMinuteFavorites).toHaveBeenCalledTimes(1)
  })
```

**(b) `tests/ui/minutes-view-tree-toggle.test.tsx`:** 액션 목(34-38행)에 (a)와 동일하게 `fetchMinuteFavorites`(async () => []) 스텁·`toggleMinuteFavorite` 추가, 리프 픽스처(29행)에 `bodyPreview: '', meetingCategory: null` 추가. 기존 9개 단언은 그대로 두고 수정하지 않는다(탐색기 DOM에서도 성립: '물류공정'은 레일 회의체 행, PMO 프루닝 시 빈 트리 → EmptyState).

**(c) `tests/ui/minutes-export-download.test.tsx`:** 액션 목(23-27행)에 `fetchMinuteFavorites: vi.fn(async () => [])`, `toggleMinuteFavorite: vi.fn(async () => true)` 추가.

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run tests/ui/minutes-view-initial-tree.test.tsx`
Expected: FAIL — `initialFavorites` prop 부재/신규 계약 2개 실패 (기존 계약은 통과 유지).

- [ ] **Step 3: MinutesView 수정**

`src/components/minutes/MinutesView.tsx`:

(a) import 교체/추가:

```ts
import { fetchMinutesRange, fetchMinutesSearch, fetchMinutesTree, fetchMinuteFavorites, toggleMinuteFavorite } from '@/app/actions/minutes'
import { MinutesExplorer, type ExplorerLayout } from './MinutesExplorer'
```

(`import { MinutesTree } from './MinutesTree'` 삭제.)

(b) props에 추가(둘 다 옵션 — 하위 호환):

```ts
  initialFavorites?: string[] | null
  explorerLayout?: ExplorerLayout
```

구조 분해에 `initialFavorites = null, explorerLayout = 'grid'` 추가.

(c) `treeReqRef` 선언 아래에 즐겨찾기 상태 기계 추가:

```ts
  // 즐겨찾기 — 뷰 전환 언마운트에도 살아야 하므로 탐색기가 아닌 여기 소유. initialTree 계약과 대칭:
  // 서버 프리페치가 있으면 재조회 없음, null(실패/미로그인)이면 'idle' → 트리 뷰 진입 시 1회 폴백.
  const [favState, setFavState] = useState<'idle' | 'loading' | 'error' | Set<string>>(
    initialFavorites ? new Set(initialFavorites) : 'idle')
  const favReqRef = useRef(0)

  async function loadFavorites() {
    const gen = ++favReqRef.current
    setFavState('loading')
    const res = await fetchMinuteFavorites()
    if (favReqRef.current !== gen) return
    setFavState(res ? new Set(res) : 'error')
  }

  async function toggleFav(id: string) {
    if (!(favState instanceof Set)) return
    const on = !favState.has(id)
    setFavState(cur => {
      if (!(cur instanceof Set)) return cur
      const next = new Set(cur); if (on) next.add(id); else next.delete(id); return next
    })
    const ok = await toggleMinuteFavorite(id, on)
    if (!ok) {
      // 해당 id 만 외과적으로 되돌린다 — 연타 시 다른 토글 결과를 덮지 않도록 전체 스냅숏 복원 금지
      setFavState(cur => {
        if (!(cur instanceof Set)) return cur
        const next = new Set(cur); if (on) next.delete(id); else next.add(id); return next
      })
      toast({ title: t('min.exp.favToggleError'), variant: 'error' })
    }
  }
```

주의: `initialFavorites`가 `[]`(로그인 + 즐겨찾기 0건)이면 truthy가 아니다 — `new Set([])`이 되도록 조건은 `initialFavorites ? ...`가 아니라 다음으로 쓴다:

```ts
  const [favState, setFavState] = useState<'idle' | 'loading' | 'error' | Set<string>>(
    initialFavorites != null ? new Set(initialFavorites) : 'idle')
```

(d) 기존 마운트 effect(158-161행)에 즐겨찾기 폴백 추가:

```ts
  useEffect(() => {
    if (view === 'tree' && treeState === 'idle') void loadTree()
    if (view === 'tree' && favState === 'idle') void loadFavorites()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view])
```

그리고 `changeView`에도 대칭 추가(트리 최초 진입 폴백):

```ts
  function changeView(v: ViewKey) {
    setView(v)
    queueUiPref({ minutesView: v })
    if (v === 'tree' && typeof treeState !== 'object' && treeState !== 'loading') void loadTree()
    if (v === 'tree' && favState === 'idle') void loadFavorites()
  }
```

(e) 트리 뷰 렌더(333행) 교체:

```tsx
            <MinutesExplorer groups={treeGroups}
              favorites={favState instanceof Set ? favState : null}
              onToggleFavorite={id => void toggleFav(id)}
              onRetryFavorites={() => void loadFavorites()}
              initialLayout={explorerLayout} />
```

- [ ] **Step 4: page.tsx 수정**

`src/app/(app)/minutes/page.tsx`:

```ts
import { getMinuteFavorites, getMinutesPage, getMinutesTree } from '@/lib/data/minutes'
```

`Promise.all`에 `getMinuteFavorites()`를 `getMinutesTree()` 다음에 추가하고 구조 분해를 `[minutes, tree, favs, m, user, prefs, projects, locale]`로 갱신. `MinutesView` 렌더에 props 추가(세션 게이트는 initialTree와 동일 이유 — RLS `to authenticated`는 무세션 조회를 에러가 아닌 200+[]로 돌려준다):

```tsx
      <MinutesView initialMinutes={minutes} initialTree={user ? tree : null} todayIso={today}
        initialFavorites={user ? favs : null}
        explorerLayout={prefs.minutesExplorerLayout === 'list' ? 'list' : 'grid'}
        initialView={initialView} projects={projects} defaultTeam={m?.teamCode ?? null}
        currentUserId={user?.id ?? null} role={m?.role ?? null} />
```

- [ ] **Step 5: 구 트리 폐기**

```bash
git rm src/components/minutes/MinutesTree.tsx tests/ui/minutes-tree.test.tsx
```

- [ ] **Step 6: 관련 테스트 통과 확인**

Run: `npx vitest run tests/ui tests/domain/minutesTree.test.ts tests/minutes`
Expected: PASS 전부 — 특히 initial-tree(기존 5 + 신규 2), tree-toggle(9), export-download, explorer(9).

- [ ] **Step 7: 전체 검증**

```bash
npm test        # 전체 스위트
npm run lint
npm run build
```
Expected: 전부 그린. 실패 시 이 태스크 안에서 수정(다른 세션 파일 `src/components/meetings/MeetingFormModal.tsx`·`src/lib/domain/meetings.ts`·`src/lib/i18n/dict/meetings.ts`·`src/lib/domain/meeting-mail.ts`는 절대 건드리지 않는다 — 해당 파일 기인 실패는 보고만).

- [ ] **Step 8: 커밋**

```bash
git add src/components/minutes/MinutesView.tsx "src/app/(app)/minutes/page.tsx" tests/ui/minutes-view-initial-tree.test.tsx tests/ui/minutes-view-tree-toggle.test.tsx tests/ui/minutes-export-download.test.tsx
git commit -m "feat(minutes): 트리 탭을 탐색기로 교체 — 즐겨찾기 상태 기계 + 프리페치 배선

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

(`git rm`한 두 파일은 스테이징에 이미 반영되어 함께 커밋된다.)

---

### Task 7: 프로덕션 적용 + 배포 (사용자 확인 게이트)

**Files:** 없음(운영 절차).

- [ ] **Step 1: 사용자에게 적용 승인 확인** — 프로덕션 DB 변경이므로 반드시 명시적 승인 후 진행.
- [ ] **Step 2: 0039를 Management API 레시피로 적용** — 키체인 "Supabase CLI" 토큰을 go-keyring-base64 디코드 → `POST /v1/projects/rglfgrwwwwdqejohdnty/database/query`에 `0039_minutes_explorer.sql` 본문 전송(`db push` 금지, memory: supabase-mgmt-api-recipe). 적용 후 검증 쿼리: `select body_preview from minutes limit 1;` / `select count(*) from minute_favorites;`
- [ ] **Step 3: 코드 push + Vercel 배포 확인** — deploy 스킬 사용(커밋은 Task 1~6에서 완료). **순서 필수: DB 먼저, 코드 나중** — 역순이면 배포 코드의 `body_preview` 조회가 42703으로 목록·트리를 죽인다.
- [ ] **Step 4: 스모크** — verify 스킬 절차(curl): `/minutes` 200 확인, 로그인 세션으로 트리 데이터에 `bodyPreview` 포함 확인, 즐겨찾기 토글 1회 왕복.

---

## Self-Review 결과 (작성 시 반영 완료)

- 스펙 커버리지: 마이그레이션(Task 1)·도메인(2)·데이터/액션(3)·i18n+컴포넌트(5)·통합/테스트 갱신/폐기(6)·적용 순서(7) — 스펙 전 섹션 대응. 스펙의 "액션 테스트(가짜 빌더)"는 Task 3 Step 1, "탐색기 UI 테스트"는 Task 5 Step 2, "기존 계약 유지"는 Task 6 Step 1~2.
- 타입 일관성: `MinutesExplorer` props(groups/favorites/onToggleFavorite/onRetryFavorites/initialLayout)와 Task 6 (e)의 호출부 일치. `toggleMinuteFavorite(minuteId, on)` 시그니처가 Task 3 구현·테스트·Task 6 `toggleFav` 모두 동일. `ExplorerLayout` export 사용처 일치.
- 함정 명시: `initialFavorites=[]` truthiness(Task 6 (c) 주의 블록), 낙관적 롤백의 외과적 되돌림, 프루닝 시 스코프 강등, 배포 순서(DB 먼저).
