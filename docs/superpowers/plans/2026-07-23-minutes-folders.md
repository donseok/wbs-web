# 회의록 폴더 디렉토리(탐색기 v2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 탐색기 레일의 파생(팀→회의체) 가상 폴더를 DB 기반 실제 디렉토리(`minute_folders` + `minutes.folder_id`, 시드 10구분, 미분류, 자유 중첩 5단, 폴더 CRUD·회의록 이동)로 교체한다.

**Architecture:** 스펙 `docs/superpowers/specs/2026-07-23-minutes-folders-design.md`. 순수 함수 `buildFolderTree`가 폴더+리프를 조립(클라이언트 — 팀 탭 필터를 리프에 먼저 적용해야 하므로), MinutesView의 treeState 기계·favState·exLayout은 유지하고 페이로드 타입만 `ExplorerData`로 교체. 폴더 CRUD는 서버 액션 + RLS(생성자/pmo_admin).

**Tech Stack:** Next.js App Router, Supabase(PostgREST), Tailwind 토큰, lucide-react, vitest 4(jsdom + createRoot/act).

## Global Constraints

- **병렬 세션 주의**: `git add`/`git rm` 항상 파일 명시. `git add -A` 절대 금지.
- 스타일은 기존 토큰·프리미티브만(`.card` `.btn` `.chip` `.seg`, `text-ink-*`, `TEAM`/`MEETING_META` 리터럴 맵). 동적 클래스 조합 금지.
- i18n ko/en 쌍 필수(en은 `Record<keyof typeof minutesKo, string>` 타입 강제). 서버 검증 에러 문구는 도메인/액션의 한국어 하드코딩(validateMinuteInput 관례).
- 유지 계약(테스트 고정): 탐색기 데이터 1회 조회·캐시 재사용, 프리페치 시 재조회 0회, null→에러 카드+재시도, 검색 시 리스트 강제, 월 라벨 `min.tree.allPeriod`, truncated `{n}` 치환, 챗 스코프 전 기간, 즐겨찾기 낙관 토글+외과적 롤백, exLayout 뷰 왕복 유지, `min.export.all` 버튼.
- `meetingBodyOf`(+노이즈 패턴)와 그 테스트는 **유지**(내보내기 ZIP 사용 — export.ts:60·122). `buildMinutesTree`·`MinutesTreeGroup/Body/Leaf`는 폐기(Task 5).
- `MinuteInput`에 folderId를 넣지 않는다 — `createMinute`의 별도 파라미터로만(메타 수정이 배정을 덮는 사고 방지). updateMinuteMeta는 folder_id 무접촉.
- 커밋 트레일러: `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
- **배포 순서**: 0040을 프로덕션 DB 선적용 후 머지-푸시(코드가 folder_id·minute_folders 조회. 로컬 dev도 프로덕션 DB 공유).
- RLS 헬퍼는 `app_role()`(0021 관례 — 프로덕션 일치 확인됨).

---

### Task 1: 마이그레이션 0040 + 롤백

**Files:**
- Create: `supabase/migrations/0040_minute_folders.sql`
- Create: `supabase/migrations/0040_minute_folders_rollback.sql`

**Interfaces:**
- Produces: `minute_folders(id, name, parent_id, sort, created_by, created_at, updated_at)` + 시드 10행, `minutes.folder_id`(FK, on delete set null). Task 3의 쿼리가 의존.

- [ ] **Step 1: 정방향 마이그레이션 작성**

`supabase/migrations/0040_minute_folders.sql`:

```sql
-- 회의록 폴더 디렉토리(스펙 2026-07-23-minutes-folders-design.md) — 실폴더 트리 + 소속.
-- 멱등: SQL Editor 반복 실행 안전. 적용: Management API POST /v1/projects/<ref>/database/query (db push 금지).
--
-- 미분류는 실제 행이 아니라 minutes.folder_id null 이다. 폴더 삭제 시 하위 폴더는 cascade,
-- 소속 회의록은 set null 로 미분류에 자동 강등된다(데이터 소실 없음).
create table if not exists minute_folders (
  id         uuid primary key default gen_random_uuid(),
  name       text not null check (length(btrim(name)) between 1 and 60),
  parent_id  uuid references minute_folders(id) on delete cascade,
  sort       int not null default 100,  -- 시드(0~9) 뒤에 정렬되도록 사용자 생성 기본값 100
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 같은 부모 안 이름 중복 금지 — 루트(parent null)와 하위를 부분 인덱스 2개로 커버
create unique index if not exists minute_folders_root_name_uniq
  on minute_folders (name) where parent_id is null;
create unique index if not exists minute_folders_child_name_uniq
  on minute_folders (parent_id, name) where parent_id is not null;

alter table minutes add column if not exists folder_id
  uuid references minute_folders(id) on delete set null;
create index if not exists minutes_folder_idx on minutes (folder_id);

-- 기본 10구분 시드(주간업무 WEEKLY_SECTIONS 순서). created_by null → RLS 상 pmo_admin 만 관리.
-- on conflict 는 부분 유니크 인덱스를 타깃하지 못하므로 not exists 로 멱등 처리.
insert into minute_folders (name, sort)
select v.name, v.sort
from (values
  ('PMO',0),('영업',1),('구매',2),('관리회계',3),('품질',4),
  ('생산계획',5),('조업및표준화',6),('물류',7),('설비및L2',8),('가공',9)
) as v(name, sort)
where not exists (
  select 1 from minute_folders f where f.parent_id is null and f.name = v.name
);

alter table minute_folders enable row level security;

-- 읽기: 전 구성원 / 생성: 본인 명의 / 수정·삭제: 생성자 or pmo_admin (0021 minutes 관례, 헬퍼 app_role())
drop policy if exists read_all_minute_folders on minute_folders;
create policy read_all_minute_folders on minute_folders
  for select to authenticated using (true);

drop policy if exists insert_own_minute_folders on minute_folders;
create policy insert_own_minute_folders on minute_folders
  for insert to authenticated
  with check (created_by = auth.uid() and app_role() is not null);

drop policy if exists update_own_minute_folders on minute_folders;
create policy update_own_minute_folders on minute_folders
  for update to authenticated
  using (created_by = auth.uid() or app_role() = 'pmo_admin')
  with check (created_by = auth.uid() or app_role() = 'pmo_admin');

drop policy if exists delete_own_minute_folders on minute_folders;
create policy delete_own_minute_folders on minute_folders
  for delete to authenticated
  using (created_by = auth.uid() or app_role() = 'pmo_admin');
```

- [ ] **Step 2: 롤백 스크립트 작성**

`supabase/migrations/0040_minute_folders_rollback.sql`:

```sql
-- 0040 롤백 — minutes.folder_id 컬럼과 minute_folders 테이블 제거.
-- 경고(데이터 소실): 모든 폴더와 회의록의 폴더 배정이 사라지며 복구 수단이 없다.
-- 순서: 코드가 folder_id·minute_folders 를 조회(LIST_COLS·탐색기)하는 상태에서 먼저 drop 하면
--   회의록 목록·트리가 PostgREST 42703/42P01 로 통째로 죽는다 — 반드시 코드 롤백 후 적용할 것.
-- 적용: Management API POST /v1/projects/<ref>/database/query. 멱등: if exists.
do $$
begin
  if to_regclass('public.minute_folders') is not null then
    execute 'drop policy if exists read_all_minute_folders on minute_folders';
    execute 'drop policy if exists insert_own_minute_folders on minute_folders';
    execute 'drop policy if exists update_own_minute_folders on minute_folders';
    execute 'drop policy if exists delete_own_minute_folders on minute_folders';
  end if;
end $$;
alter table minutes drop column if exists folder_id;
drop table if exists minute_folders;
```

- [ ] **Step 3: 커밋**

```bash
git add supabase/migrations/0040_minute_folders.sql supabase/migrations/0040_minute_folders_rollback.sql
git commit -m "chore(db): 0040 회의록 폴더 — minute_folders + minutes.folder_id + 시드 10구분

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: 도메인 — 폴더 트리 조립·검증 순수 함수

**Files:**
- Modify: `src/lib/domain/types.ts` (Minute에 folderId 추가, 신규 MinuteFolder/ExplorerLeaf/FolderNode/ExplorerData — `MinutesTreeLeaf` 인터페이스 블록 **아래에** 추가; 기존 MinutesTree* 타입은 이 태스크에서 건드리지 않는다, 삭제는 Task 5)
- Modify: `src/lib/domain/minutes.ts` (파일 끝에 추가)
- Test: `tests/domain/minutesFolders.test.ts` (신규)

**Interfaces:**
- Produces (Task 3~5가 의존):

```ts
// types.ts
export interface MinuteFolder {
  id: string; name: string; parentId: string | null; sort: number; createdBy: string | null
}
export interface ExplorerLeaf {
  id: string; minuteDate: string; teamCode: TeamCode; title: string
  fileCount: number; createdBy: string | null; createdByName: string | null
  bodyPreview: string; meetingCategory: MeetingCategory | null
  folderId: string | null
}
export interface FolderNode {
  folder: MinuteFolder
  children: FolderNode[]
  directLeaves: ExplorerLeaf[]
  totalCount: number
}
export interface ExplorerData {
  folders: MinuteFolder[]; leaves: ExplorerLeaf[]; total: number; truncated: boolean
}
// Minute 에 추가: folderId?: string | null

// domain/minutes.ts
export const MINUTE_FOLDER_NAME_MAX = 60
export const MINUTE_FOLDER_DEPTH_MAX = 5
export function validateFolderName(name: string): string | null
export function folderDepthOf(folders: MinuteFolder[], folderId: string | null): number
export function buildFolderTree(folders: MinuteFolder[], leaves: ExplorerLeaf[]):
  { roots: FolderNode[]; unfiled: ExplorerLeaf[] }
```

- [ ] **Step 1: 실패하는 테스트 작성**

`tests/domain/minutesFolders.test.ts` (신규):

```ts
import { describe, it, expect } from 'vitest'
import {
  buildFolderTree, folderDepthOf, validateFolderName,
  MINUTE_FOLDER_DEPTH_MAX, MINUTE_FOLDER_NAME_MAX,
} from '@/lib/domain/minutes'
import type { ExplorerLeaf, MinuteFolder, TeamCode } from '@/lib/domain/types'

const folder = (id: string, name: string, parentId: string | null = null, sort = 100): MinuteFolder =>
  ({ id, name, parentId, sort, createdBy: null })

const leaf = (id: string, date: string, folderId: string | null): ExplorerLeaf => ({
  id, minuteDate: date, teamCode: 'MES' as TeamCode, title: `제목${id}`,
  fileCount: 0, createdBy: null, createdByName: null,
  bodyPreview: '', meetingCategory: null, folderId,
})

describe('validateFolderName', () => {
  it('정상 이름은 null', () => expect(validateFolderName('생산계획')).toBeNull())
  it('공백만이면 에러', () => expect(validateFolderName('   ')).toBeTruthy())
  it(`${MINUTE_FOLDER_NAME_MAX}자 초과면 에러`, () =>
    expect(validateFolderName('가'.repeat(MINUTE_FOLDER_NAME_MAX + 1))).toBeTruthy())
  it('trim 후 상한 이내면 null', () =>
    expect(validateFolderName(`  ${'가'.repeat(MINUTE_FOLDER_NAME_MAX)}  `)).toBeNull())
})

describe('folderDepthOf', () => {
  const fs = [folder('a', 'A'), folder('b', 'B', 'a'), folder('c', 'C', 'b')]
  it('null(루트에 생성)은 0', () => expect(folderDepthOf(fs, null)).toBe(0))
  it('루트 폴더는 1, 체인은 조상 수+1', () => {
    expect(folderDepthOf(fs, 'a')).toBe(1)
    expect(folderDepthOf(fs, 'c')).toBe(3)
  })
  it('순환 참조는 상한 초과 취급(무한 루프 없이 DEPTH_MAX+1 이상 반환)', () => {
    const cyc = [folder('x', 'X', 'y'), folder('y', 'Y', 'x')]
    expect(folderDepthOf(cyc, 'x')).toBeGreaterThan(MINUTE_FOLDER_DEPTH_MAX)
  })
})

describe('buildFolderTree', () => {
  it('루트는 sort asc·name asc, 하위 동일 규칙, directLeaves 는 입력 순서 유지', () => {
    const fs = [
      folder('u1', '나사용자'), folder('u2', '가사용자'),        // sort 100 동률 → 이름순
      folder('s1', 'PMO', null, 0), folder('s2', '영업', null, 1), // 시드가 먼저
      folder('c1', '하위B', 's1', 100), folder('c2', '하위A', 's1', 100),
    ]
    const { roots } = buildFolderTree(fs, [leaf('m1', '2026-07-20', 's1'), leaf('m2', '2026-07-19', 's1')])
    expect(roots.map(r => r.folder.name)).toEqual(['PMO', '영업', '가사용자', '나사용자'])
    expect(roots[0].children.map(c => c.folder.name)).toEqual(['하위A', '하위B'])
    expect(roots[0].directLeaves.map(l => l.id)).toEqual(['m1', 'm2'])
  })

  it('totalCount 는 하위 포함 재귀 합계, directLeaves 는 직계만', () => {
    const fs = [folder('p', '부모', null, 0), folder('c', '자식', 'p')]
    const { roots } = buildFolderTree(fs, [
      leaf('m1', '2026-07-20', 'p'), leaf('m2', '2026-07-19', 'c'), leaf('m3', '2026-07-18', 'c'),
    ])
    expect(roots[0].totalCount).toBe(3)
    expect(roots[0].directLeaves.map(l => l.id)).toEqual(['m1'])
    expect(roots[0].children[0].totalCount).toBe(2)
  })

  it('unfiled = folder_id null + 존재하지 않는 폴더를 가리키는 리프(dangling)', () => {
    const { unfiled } = buildFolderTree([folder('a', 'A')], [
      leaf('m1', '2026-07-20', null), leaf('m2', '2026-07-19', 'ghost'), leaf('m3', '2026-07-18', 'a'),
    ])
    expect(unfiled.map(l => l.id)).toEqual(['m1', 'm2'])
  })

  it('고아 폴더(부모 미존재)는 루트로 승격, 순환은 절단해 루트로 — 조용히 버리지 않는다', () => {
    const fs = [
      folder('o', '고아', 'ghost'),
      folder('x', '순환X', 'y'), folder('y', '순환Y', 'x'),
    ]
    const { roots } = buildFolderTree(fs, [])
    expect(roots.map(r => r.folder.name).sort()).toEqual(['고아', '순환X', '순환Y'].sort())
  })
})
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run tests/domain/minutesFolders.test.ts`
Expected: FAIL — `buildFolderTree` 등 export 없음.

- [ ] **Step 3: 타입·도메인 구현**

`src/lib/domain/types.ts` — `Minute`의 `meetingCategory?` 줄 아래에 `folderId?: string | null  // 소속 폴더(0040, 목록 조회 전용 — null=미분류)` 추가. `MinutesTreeGroup` 블록 아래에 Interfaces 블록의 신규 타입 4개를 그대로 추가(주석 포함):

```ts
/* ── 탐색기 v2: 실제 폴더 디렉토리 (스펙 2026-07-23-minutes-folders-design.md) ── */

export interface MinuteFolder {
  id: string
  name: string
  parentId: string | null
  sort: number
  createdBy: string | null           // null = 시드 폴더(pmo_admin 만 관리)
}

/** 탐색기 리프 — 목록 조회 shape 에 폴더 소속 부착. */
export interface ExplorerLeaf {
  id: string
  minuteDate: string                 // 'YYYY-MM-DD'
  teamCode: TeamCode
  title: string
  fileCount: number
  createdBy: string | null           // 이동 버튼 노출 판정(작성자 or pmo_admin)
  createdByName: string | null
  bodyPreview: string
  meetingCategory: MeetingCategory | null
  folderId: string | null            // null = 미분류
}

export interface FolderNode {
  folder: MinuteFolder
  children: FolderNode[]
  directLeaves: ExplorerLeaf[]       // 직계 소속(입력 순서 = 날짜 내림차순)
  totalCount: number                 // 하위 포함 재귀 합계
}

export interface ExplorerData {
  folders: MinuteFolder[]
  leaves: ExplorerLeaf[]             // 전 기간 flat, 날짜 내림차순
  total: number
  truncated: boolean
}
```

`src/lib/domain/minutes.ts` — 파일 끝에 추가(import에 `ExplorerLeaf, FolderNode, MinuteFolder` 타입 추가):

```ts
/* ── 탐색기 v2: 폴더 디렉토리 (스펙 2026-07-23-minutes-folders-design.md) ── */

export const MINUTE_FOLDER_NAME_MAX = 60
export const MINUTE_FOLDER_DEPTH_MAX = 5

/** 폴더 이름 검증 — 에러 메시지 또는 null (validateMinuteInput 관례). */
export function validateFolderName(name: string): string | null {
  const trimmed = name.trim()
  if (!trimmed) return '폴더 이름을 입력하세요.'
  if (trimmed.length > MINUTE_FOLDER_NAME_MAX) return `폴더 이름은 ${MINUTE_FOLDER_NAME_MAX}자 이하여야 합니다.`
  return null
}

/** folderId 가 트리에서 몇 단인지(null=0, 루트=1). 순환·끊긴 체인은 상한 초과 값으로 수렴해
 *  호출부의 깊이 검증이 자연히 거부하게 한다(무한 루프 방지 가드). */
export function folderDepthOf(folders: MinuteFolder[], folderId: string | null): number {
  const byId = new Map(folders.map(f => [f.id, f]))
  let depth = 0
  let cur = folderId
  while (cur) {
    depth += 1
    if (depth > MINUTE_FOLDER_DEPTH_MAX) return depth  // 순환/과깊이 — 즉시 초과 반환
    cur = byId.get(cur)?.parentId ?? null
  }
  return depth
}

/** 폴더 + 리프 → 디렉토리 트리. 정렬은 sort asc·name asc(시드 0~9 우선), directLeaves 는 입력
 *  순서 보존(재정렬 없음). 방어: 부모가 목록에 없는 고아·순환 참조 폴더는 루트로 승격(조용히
 *  버리지 않음), 미존재 폴더를 가리키는 리프는 unfiled 로. */
export function buildFolderTree(
  folders: MinuteFolder[], leaves: ExplorerLeaf[],
): { roots: FolderNode[]; unfiled: ExplorerLeaf[] } {
  const nodeById = new Map<string, FolderNode>(
    folders.map(f => [f.id, { folder: f, children: [], directLeaves: [], totalCount: 0 }]))

  // 루트 판정: 부모 없음 / 부모 미존재(고아) / 조상 체인이 순환(자신에게 되돌아옴)
  const isRoot = (f: MinuteFolder): boolean => {
    if (f.parentId === null || !nodeById.has(f.parentId)) return true
    let cur: string | null = f.parentId
    const seen = new Set<string>([f.id])
    while (cur) {
      if (seen.has(cur)) return true  // 순환 절단
      seen.add(cur)
      cur = nodeById.get(cur)?.folder.parentId ?? null
    }
    return false
  }

  const roots: FolderNode[] = []
  for (const f of folders) {
    const node = nodeById.get(f.id)!
    if (isRoot(f)) roots.push(node)
    else nodeById.get(f.parentId!)!.children.push(node)
  }

  const bySort = (a: FolderNode, b: FolderNode) =>
    a.folder.sort - b.folder.sort || a.folder.name.localeCompare(b.folder.name, 'ko')
  const sortRec = (nodes: FolderNode[]) => {
    nodes.sort(bySort)
    for (const n of nodes) sortRec(n.children)
  }
  sortRec(roots)

  const unfiled: ExplorerLeaf[] = []
  for (const l of leaves) {
    const node = l.folderId ? nodeById.get(l.folderId) : undefined
    if (node) node.directLeaves.push(l)
    else unfiled.push(l)
  }

  const sumRec = (node: FolderNode): number => {
    node.totalCount = node.directLeaves.length + node.children.reduce((n, c) => n + sumRec(c), 0)
    return node.totalCount
  }
  for (const r of roots) sumRec(r)

  return { roots, unfiled }
}
```

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run tests/domain/minutesFolders.test.ts tests/domain/minutesTree.test.ts`
Expected: 신규 전부 PASS + 기존 트리 테스트도 여전히 PASS(이 태스크는 삭제 없음).

- [ ] **Step 5: 커밋**

```bash
git add src/lib/domain/types.ts src/lib/domain/minutes.ts tests/domain/minutesFolders.test.ts
git commit -m "feat(minutes): 폴더 트리 도메인 — buildFolderTree·깊이/이름 검증·탐색기 v2 타입

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: 데이터 계층 + 폴더 서버 액션

**Files:**
- Modify: `src/lib/data/minutes.ts` (LIST_COLS·mapMinute·getMinutesExplorer 추가 — `getMinutesTree`는 이 태스크에서 삭제하지 않음, Task 5에서)
- Modify: `src/app/actions/minutes.ts`
- Test: `tests/minutes/folders-action.test.ts` (신규)

**Interfaces:**
- Consumes: Task 1의 스키마, Task 2의 `ExplorerData/MinuteFolder/ExplorerLeaf`, `validateFolderName`, `folderDepthOf`, `MINUTE_FOLDER_DEPTH_MAX`.
- Produces (Task 4~5가 의존):
  - `getMinutesExplorer(): Promise<ExplorerData | null>` (data)
  - `fetchMinutesExplorer(): Promise<ExplorerData | null>` (action, 미로그인/실패 null)
  - `createMinuteFolder(name: string, parentId: string | null): Promise<{ ok: boolean; error?: string }>`
  - `renameMinuteFolder(id: string, name: string): Promise<{ ok: boolean; error?: string }>`
  - `deleteMinuteFolder(id: string): Promise<{ ok: boolean; error?: string }>`
  - `moveMinuteToFolder(minuteId: string, folderId: string | null): Promise<{ ok: boolean; error?: string }>`
  - `createMinute(input: MinuteInput, folderId?: string | null)` — 옵션 2번째 파라미터(기본 null)

- [ ] **Step 1: 실패하는 액션 테스트 작성**

`tests/minutes/folders-action.test.ts` (신규 — favorites-action.test.ts 와 동일한 목킹 골격):

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

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
vi.mock('@/lib/data/minutes', () => ({
  getMinuteDetail: vi.fn(), getMinutesPage: vi.fn(), getMinutesTree: vi.fn(), searchMinutes: vi.fn(),
  getMinuteFavorites: vi.fn(), getMinutesExplorer: vi.fn(),
}))

// 테이블별 결과를 주입하는 thenable 가짜 빌더 — insert/update/delete/select 체인 지원
type TableResult = { data?: unknown; error: { message: string; code?: string } | null }
function fakeClient(results: Record<string, TableResult>) {
  const calls: Record<string, { method: string; args: unknown[] }[]> = {}
  const from = vi.fn((table: string) => {
    const log = (calls[table] ??= [])
    const result = results[table] ?? { data: [], error: null }
    const builder: Record<string, unknown> = {}
    for (const m of ['select', 'insert', 'update', 'delete', 'eq', 'is', 'order', 'maybeSingle', 'single']) {
      builder[m] = vi.fn((...a: unknown[]) => { log.push({ method: m, args: a }); return builder })
    }
    ;(builder as { then: (r: (v: TableResult) => void) => void }).then = resolve => resolve(result)
    return builder
  })
  return { client: { from }, calls, from }
}
const createServerClient = vi.fn()
vi.mock('@/lib/supabase/server', () => ({
  createServerClient: (...a: unknown[]) => createServerClient(...(a as [])),
}))

import {
  createMinuteFolder, deleteMinuteFolder, moveMinuteToFolder, renameMinuteFolder,
} from '@/app/actions/minutes'

const seedFolders = [
  { id: 'f1', name: 'PMO', parent_id: null, sort: 0, created_by: null },
  { id: 'f2', name: '하위', parent_id: 'f1', sort: 100, created_by: 'u1' },
]

beforeEach(() => {
  getSession.mockReset(); createServerClient.mockReset()
  getSession.mockResolvedValue({ id: 'u1' })
})

describe('createMinuteFolder', () => {
  it('미로그인은 실패 + 클라이언트 미생성', async () => {
    getSession.mockResolvedValue(null)
    const r = await createMinuteFolder('새폴더', null)
    expect(r.ok).toBe(false)
    expect(createServerClient).not.toHaveBeenCalled()
  })
  it('이름 검증 실패(공백)는 DB 접근 없이 에러', async () => {
    const r = await createMinuteFolder('   ', null)
    expect(r.ok).toBe(false)
    expect(createServerClient).not.toHaveBeenCalled()
  })
  it('깊이 5단 초과는 거부', async () => {
    const chain = [
      { id: 'd1', name: '1', parent_id: null, sort: 0, created_by: null },
      { id: 'd2', name: '2', parent_id: 'd1', sort: 0, created_by: null },
      { id: 'd3', name: '3', parent_id: 'd2', sort: 0, created_by: null },
      { id: 'd4', name: '4', parent_id: 'd3', sort: 0, created_by: null },
      { id: 'd5', name: '5', parent_id: 'd4', sort: 0, created_by: null },
    ]
    const { client } = fakeClient({ minute_folders: { data: chain, error: null } })
    createServerClient.mockResolvedValue(client)
    const r = await createMinuteFolder('6단', 'd5')
    expect(r.ok).toBe(false)
    expect(r.error).toContain('5')
  })
  it('유니크 위반(23505)은 중복 안내 문구로 매핑', async () => {
    const { client, from } = fakeClient({ minute_folders: { data: seedFolders, error: null } })
    // 두 번째 from('minute_folders') 호출(insert)만 에러를 내도록 교체
    let call = 0
    from.mockImplementation(() => {
      call += 1
      const result = call === 1
        ? { data: seedFolders, error: null }
        : { data: null, error: { message: 'duplicate key value', code: '23505' } }
      const builder: Record<string, unknown> = {}
      for (const m of ['select', 'insert', 'update', 'delete', 'eq', 'is', 'order', 'maybeSingle', 'single']) {
        builder[m] = vi.fn(() => builder)
      }
      ;(builder as { then: (r: (v: typeof result) => void) => void }).then = resolve => resolve(result)
      return builder
    })
    createServerClient.mockResolvedValue(client)
    const r = await createMinuteFolder('PMO', null)
    expect(r.ok).toBe(false)
    expect(r.error).toContain('이미')
  })
})

describe('renameMinuteFolder / deleteMinuteFolder', () => {
  it('rename: 이름 검증 실패는 DB 접근 없이 에러', async () => {
    const r = await renameMinuteFolder('f2', '')
    expect(r.ok).toBe(false)
    expect(createServerClient).not.toHaveBeenCalled()
  })
  it('rename: 0행 갱신(권한 없음/미존재)은 실패로 판정', async () => {
    const { client } = fakeClient({ minute_folders: { data: [], error: null } })
    createServerClient.mockResolvedValue(client)
    const r = await renameMinuteFolder('f1', '새이름')
    expect(r.ok).toBe(false)
  })
  it('delete: 0행 삭제는 실패, 1행 삭제는 성공', async () => {
    const { client } = fakeClient({ minute_folders: { data: [{ id: 'f2' }], error: null } })
    createServerClient.mockResolvedValue(client)
    expect((await deleteMinuteFolder('f2')).ok).toBe(true)
    const empty = fakeClient({ minute_folders: { data: [], error: null } })
    createServerClient.mockResolvedValue(empty.client)
    expect((await deleteMinuteFolder('f2')).ok).toBe(false)
  })
})

describe('moveMinuteToFolder', () => {
  it('대상 폴더 미존재면 거부', async () => {
    const { client } = fakeClient({ minute_folders: { data: null, error: null } })
    createServerClient.mockResolvedValue(client)
    const r = await moveMinuteToFolder('m1', 'ghost')
    expect(r.ok).toBe(false)
  })
  it('folderId null(미분류)은 폴더 존재 검증 없이 진행, 0행 갱신은 권한 없음', async () => {
    const { client, calls } = fakeClient({ minutes: { data: [], error: null } })
    createServerClient.mockResolvedValue(client)
    const r = await moveMinuteToFolder('m1', null)
    expect(r.ok).toBe(false)                       // 0행 → 권한 없음
    expect(calls['minute_folders']).toBeUndefined() // 폴더 조회 안 함
  })
  it('1행 갱신이면 성공', async () => {
    const { client } = fakeClient({
      minute_folders: { data: { id: 'f1' }, error: null },
      minutes: { data: [{ id: 'm1' }], error: null },
    })
    createServerClient.mockResolvedValue(client)
    expect((await moveMinuteToFolder('m1', 'f1')).ok).toBe(true)
  })
})
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run tests/minutes/folders-action.test.ts`
Expected: FAIL — 신규 액션 export 없음.

- [ ] **Step 3: 데이터 계층 구현**

`src/lib/data/minutes.ts`:

(a) `LIST_COLS`에 `folder_id` 추가:

```ts
const LIST_COLS =
  'id, minute_date, team_code, title, meeting_id, created_by, created_by_name, created_at, updated_at, body_preview, folder_id, minute_files(count), meetings(category)'
```

(b) `mapMinute` 리턴 객체의 `meetingCategory` 줄 아래:

```ts
    folderId: (r.folder_id as string | null) ?? null,
```

(c) import 타입 목록에 `ExplorerData, ExplorerLeaf, MinuteFolder` 추가 후, `getMinutesTree` 아래에 신규 함수:

```ts
/** 탐색기 v2 — 전 기간 리프 + 폴더 전량. 실패 시 로깅 + null(빈 결과 객체와 구분 —
 *  조용한 빈 화면 방지). 트리 조립은 클라이언트(buildFolderTree) — 팀 탭 필터를 리프에
 *  먼저 적용해야 하므로 서버 조립은 성립하지 않는다. */
export const getMinutesExplorer = cache(async (): Promise<ExplorerData | null> => {
  const sb = await createServerClient()
  const [mRes, fRes] = await Promise.all([
    sb.from('minutes').select(LIST_COLS)
      .order('minute_date', { ascending: false }).order('created_at', { ascending: false })
      .limit(MINUTES_TREE_LIMIT),
    sb.from('minute_folders').select('id, name, parent_id, sort, created_by')
      .order('sort').order('name'),
  ])
  if (mRes.error || fRes.error) {
    console.error('[getMinutesExplorer] 조회 실패:', mRes.error?.message ?? fRes.error?.message)
    return null
  }
  const rows = (mRes.data ?? []).map((r: Row) => mapMinute(r))
  const leaves: ExplorerLeaf[] = rows.map(mi => ({
    id: mi.id, minuteDate: mi.minuteDate, teamCode: mi.teamCode, title: mi.title,
    fileCount: mi.fileCount ?? 0, createdBy: mi.createdBy, createdByName: mi.createdByName,
    bodyPreview: mi.bodyPreview ?? '', meetingCategory: mi.meetingCategory ?? null,
    folderId: mi.folderId ?? null,
  }))
  const folders: MinuteFolder[] = ((fRes.data ?? []) as Row[]).map(f => ({
    id: f.id as string, name: f.name as string,
    parentId: (f.parent_id as string | null) ?? null,
    sort: f.sort as number, createdBy: (f.created_by as string | null) ?? null,
  }))
  return { folders, leaves, total: rows.length, truncated: rows.length >= MINUTES_TREE_LIMIT }
})
```

- [ ] **Step 4: 서버 액션 구현**

`src/app/actions/minutes.ts`:

(a) import 갱신 — domain에서 `validateFolderName, folderDepthOf, MINUTE_FOLDER_DEPTH_MAX` 추가, data에서 `getMinutesExplorer` 추가, 타입 `ExplorerData, MinuteFolder` 추가.

(b) `fetchMinutesTree` 아래에 추가:

```ts
/** 탐색기 v2 데이터 — 미로그인/실패 null (fetchMinutesTree 계약과 동일). */
export async function fetchMinutesExplorer(): Promise<ExplorerData | null> {
  const user = await getSession()
  if (!user) return null
  return getMinutesExplorer()
}

/** 폴더 전량 로드(액션 내부용) — 깊이 검증에 사용. 실패 시 null. */
async function loadFolders(sb: Awaited<ReturnType<typeof createServerClient>>): Promise<MinuteFolder[] | null> {
  const { data, error } = await sb.from('minute_folders').select('id, name, parent_id, sort, created_by')
  if (error) { console.error('[loadFolders] 조회 실패:', error.message); return null }
  return (data ?? []).map((f: Record<string, unknown>) => ({
    id: f.id as string, name: f.name as string,
    parentId: (f.parent_id as string | null) ?? null,
    sort: f.sort as number, createdBy: (f.created_by as string | null) ?? null,
  }))
}

const FOLDER_DUP_MSG = '같은 폴더에 같은 이름이 이미 있습니다.'

export async function createMinuteFolder(
  name: string, parentId: string | null,
): Promise<{ ok: boolean; error?: string }> {
  const user = await getSession()
  if (!user) return { ok: false, error: '로그인 필요' }
  const nameErr = validateFolderName(name)
  if (nameErr) return { ok: false, error: nameErr }
  const sb = await createServerClient()
  const folders = await loadFolders(sb)
  if (!folders) return { ok: false, error: '폴더 목록을 불러오지 못했습니다.' }
  if (parentId && !folders.some(f => f.id === parentId)) return { ok: false, error: '상위 폴더를 찾을 수 없습니다.' }
  if (folderDepthOf(folders, parentId) + 1 > MINUTE_FOLDER_DEPTH_MAX)
    return { ok: false, error: `폴더는 최대 ${MINUTE_FOLDER_DEPTH_MAX}단까지 만들 수 있습니다.` }
  const { error } = await sb.from('minute_folders')
    .insert({ name: name.trim(), parent_id: parentId, created_by: user.id })
  if (error) {
    if (error.code === '23505') return { ok: false, error: FOLDER_DUP_MSG }
    console.error('[createMinuteFolder] 실패:', error.message)
    return { ok: false, error: error.message }
  }
  revalidatePath('/minutes')
  return { ok: true }
}

export async function renameMinuteFolder(
  id: string, name: string,
): Promise<{ ok: boolean; error?: string }> {
  const user = await getSession()
  if (!user) return { ok: false, error: '로그인 필요' }
  const nameErr = validateFolderName(name)
  if (nameErr) return { ok: false, error: nameErr }
  const sb = await createServerClient()
  const { data, error } = await sb.from('minute_folders')
    .update({ name: name.trim(), updated_at: new Date().toISOString() })
    .eq('id', id).select('id')
  if (error) {
    if (error.code === '23505') return { ok: false, error: FOLDER_DUP_MSG }
    console.error('[renameMinuteFolder] 실패:', error.message)
    return { ok: false, error: error.message }
  }
  // RLS 가 소유자/pmo_admin 이 아니면 0행 — 조용한 no-op 을 성공으로 위장하지 않는다
  if (!data || data.length === 0) return { ok: false, error: '권한이 없거나 폴더가 없습니다.' }
  revalidatePath('/minutes')
  return { ok: true }
}

export async function deleteMinuteFolder(id: string): Promise<{ ok: boolean; error?: string }> {
  const user = await getSession()
  if (!user) return { ok: false, error: '로그인 필요' }
  const sb = await createServerClient()
  // 하위 폴더는 FK cascade, 소속 회의록은 set null(미분류 강등)이 정리한다
  const { data, error } = await sb.from('minute_folders').delete().eq('id', id).select('id')
  if (error) { console.error('[deleteMinuteFolder] 실패:', error.message); return { ok: false, error: error.message } }
  if (!data || data.length === 0) return { ok: false, error: '권한이 없거나 폴더가 없습니다.' }
  revalidatePath('/minutes')
  return { ok: true }
}

export async function moveMinuteToFolder(
  minuteId: string, folderId: string | null,
): Promise<{ ok: boolean; error?: string }> {
  const user = await getSession()
  if (!user) return { ok: false, error: '로그인 필요' }
  const sb = await createServerClient()
  if (folderId) {
    const { data: f } = await sb.from('minute_folders').select('id').eq('id', folderId).maybeSingle()
    if (!f) return { ok: false, error: '이동할 폴더를 찾을 수 없습니다.' }
  }
  // 권한은 update_own_minutes RLS(작성자 or pmo_admin)가 담당 — 0행이면 권한 없음으로 판정
  const { data, error } = await sb.from('minutes')
    .update({ folder_id: folderId, updated_at: new Date().toISOString() })
    .eq('id', minuteId).select('id')
  if (error) { console.error('[moveMinuteToFolder] 실패:', error.message); return { ok: false, error: error.message } }
  if (!data || data.length === 0) return { ok: false, error: '권한이 없거나 회의록이 없습니다.' }
  revalidatePath('/minutes')
  return { ok: true }
}
```

(c) `createMinute` 시그니처를 `createMinute(input: MinuteInput, folderId: string | null = null)`로 확장 — insert 객체에 `folder_id: folderId` 추가, insert 직전에 폴더 존재 검증:

```ts
  if (folderId) {
    const { data: fd } = await sb.from('minute_folders').select('id').eq('id', folderId).maybeSingle()
    if (!fd) return { ok: false, error: '폴더를 찾을 수 없습니다.' }
  }
```

(기존 호출부는 파라미터 생략으로 하위 호환 — 또박또박 API 경로 무변경.)

- [ ] **Step 5: 통과 확인**

Run: `npx vitest run tests/minutes/folders-action.test.ts tests/minutes/favorites-action.test.ts`
Expected: PASS 전부 (favorites 테스트의 data 목에 `getMinutesExplorer` 스텁이 없어 깨지면 그 목 객체에 `getMinutesExplorer: vi.fn()` 한 줄 추가 — 단언 무변경).

- [ ] **Step 6: 커밋**

```bash
git add src/lib/data/minutes.ts src/app/actions/minutes.ts tests/minutes/folders-action.test.ts tests/minutes/favorites-action.test.ts
git commit -m "feat(minutes): 폴더 CRUD·이동 액션 + 탐색기 v2 데이터(getMinutesExplorer)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: MinutesExplorer v2 + 폴더 모달 2종 + i18n

**Files:**
- Rewrite: `src/components/minutes/MinutesExplorer.tsx` (전체 교체 — 아래 전문)
- Create: `src/components/minutes/FolderManageModal.tsx`
- Create: `src/components/minutes/FolderPickModal.tsx`
- Modify: `src/lib/i18n/dict/minutes.ts` (`min.exp.starRemove` 줄 아래 ko, en 미러 동일 위치)
- Test: `tests/ui/minutes-explorer.test.tsx` (전체 재작성 — 아래 전문)

**Interfaces:**
- Consumes: Task 2의 `buildFolderTree/folderDepthOf/MINUTE_FOLDER_DEPTH_MAX` + 타입, Task 3의 `createMinuteFolder/renameMinuteFolder/deleteMinuteFolder/moveMinuteToFolder`.
- Produces (Task 5가 의존): `MinutesExplorer` props:

```ts
{
  folders: MinuteFolder[]
  leaves: ExplorerLeaf[]                 // 팀 탭 필터 적용된 리프(날짜 내림차순)
  favorites: Set<string> | null
  onToggleFavorite: (id: string) => void
  onRetryFavorites: () => void
  layout: ExplorerLayout
  onLayoutChange: (v: ExplorerLayout) => void
  currentUserId: string | null
  isAdmin: boolean
  onChanged: () => void                  // 폴더 CRUD·이동 성공 후 재조회
  onFolderSelect?: (folderId: string | null) => void  // 업로드 기본 폴더용
}
```

`FolderManageModal` props: `{ open, mode: 'create' | 'rename' | 'delete', folder?: MinuteFolder, parentId: string | null, onClose: () => void, onDone: () => void }`
`FolderPickModal` props: `{ open, folders: MinuteFolder[], onClose: () => void, onPick: (folderId: string | null) => void }`

- [ ] **Step 1: i18n 키 추가**

`src/lib/i18n/dict/minutes.ts` ko 블록 `'min.exp.starRemove': '즐겨찾기 해제',` 아래:

```ts
  // 폴더 디렉토리 (스펙 2026-07-23-minutes-folders-design.md)
  'min.fold.unfiled': '미분류',
  'min.fold.new': '새 폴더',
  'min.fold.addSub': '하위 폴더 추가',
  'min.fold.rename': '이름 변경',
  'min.fold.delete': '삭제',
  'min.fold.deleteTitle': '폴더 삭제',
  'min.fold.deleteConfirm': '하위 폴더가 함께 삭제되고 소속 회의록은 미분류로 이동합니다.',
  'min.fold.name': '폴더 이름',
  'min.fold.move': '폴더 이동',
  'min.fold.pickTitle': '폴더 선택',
  'min.fold.menuAria': '폴더 메뉴',
  'min.fold.moved': '폴더로 이동했습니다',
  'min.fold.form.folder': '폴더',
```

en 블록 `'min.exp.starRemove': 'Remove from favorites',` 아래:

```ts
  'min.fold.unfiled': 'Unfiled',
  'min.fold.new': 'New folder',
  'min.fold.addSub': 'Add subfolder',
  'min.fold.rename': 'Rename',
  'min.fold.delete': 'Delete',
  'min.fold.deleteTitle': 'Delete folder',
  'min.fold.deleteConfirm': 'Subfolders are deleted together and their minutes move to Unfiled.',
  'min.fold.name': 'Folder name',
  'min.fold.move': 'Move to folder',
  'min.fold.pickTitle': 'Choose folder',
  'min.fold.menuAria': 'Folder menu',
  'min.fold.moved': 'Moved to folder',
  'min.fold.form.folder': 'Folder',
```

- [ ] **Step 2: 실패하는 탐색기 테스트 작성 (전체 재작성)**

`tests/ui/minutes-explorer.test.tsx` 전문 교체:

```tsx
// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { ExplorerLeaf, MinuteFolder } from '@/lib/domain/types'

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

vi.mock('@/components/providers/LocaleProvider', () => ({
  useLocale: () => ({ t: (k: string) => k, locale: 'ko' }),
}))
vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: { href: string; children: React.ReactNode }) =>
    <a href={href} {...props}>{children}</a>,
}))
vi.mock('@/components/ui/Toast', () => ({ useToast: () => ({ toast: vi.fn() }) }))
const moveMinuteToFolder = vi.fn(async () => ({ ok: true }))
vi.mock('@/app/actions/minutes', () => ({
  createMinuteFolder: vi.fn(async () => ({ ok: true })),
  renameMinuteFolder: vi.fn(async () => ({ ok: true })),
  deleteMinuteFolder: vi.fn(async () => ({ ok: true })),
  moveMinuteToFolder: (...a: unknown[]) => moveMinuteToFolder(...(a as [])),
}))

import { MinutesExplorer } from '@/components/minutes/MinutesExplorer'

const folder = (id: string, name: string, parentId: string | null = null, sort = 100, createdBy: string | null = null): MinuteFolder =>
  ({ id, name, parentId, sort, createdBy })
const leaf = (id: string, date: string, title: string, folderId: string | null, extra: Partial<ExplorerLeaf> = {}): ExplorerLeaf => ({
  id, minuteDate: date, teamCode: 'MES', title, fileCount: 0,
  createdBy: 'u1', createdByName: '홍길동', bodyPreview: '', meetingCategory: null,
  folderId, ...extra,
})

const folders = [
  folder('f-pmo', 'PMO', null, 0),
  folder('f-plan', '생산계획', null, 5),
  folder('f-aps', 'APS 회의', 'f-plan', 100, 'u1'),
]
const leaves = [
  leaf('m1', '2026-07-22', 'APS 인터뷰', 'f-aps', { bodyPreview: '부자재 발주 요약', meetingCategory: 'routine' }),
  leaf('m2', '2026-07-21', '생산계획 정례', 'f-plan'),
  leaf('m3', '2026-07-20', '미배정 회의록', null),
]

describe('MinutesExplorer v2 (폴더 디렉토리)', () => {
  let container: HTMLDivElement, root: Root
  const onToggle = vi.fn(), onRetry = vi.fn(), onLayout = vi.fn(), onChanged = vi.fn(), onFolderSelect = vi.fn()
  beforeEach(() => {
    container = document.createElement('div'); document.body.appendChild(container)
    root = createRoot(container)
    onToggle.mockClear(); onRetry.mockClear(); onLayout.mockClear(); onChanged.mockClear()
    onFolderSelect.mockClear(); moveMinuteToFolder.mockClear()
  })
  afterEach(() => { act(() => root.unmount()); container.remove() })

  async function mount(over: Partial<Parameters<typeof MinutesExplorer>[0]> = {}) {
    await act(async () => root.render(
      <MinutesExplorer folders={folders} leaves={leaves} favorites={new Set(['m1'])}
        onToggleFavorite={onToggle} onRetryFavorites={onRetry}
        layout="grid" onLayoutChange={onLayout}
        currentUserId="u1" isAdmin={false} onChanged={onChanged} onFolderSelect={onFolderSelect}
        {...over} />,
    ))
  }
  function buttonByText(text: string): HTMLButtonElement {
    const found = [...container.querySelectorAll('button')].find(b => b.textContent?.includes(text))
    if (!found) throw new Error(`button not found: ${text}`)
    return found
  }

  it('all 스코프: 루트 폴더 카드(재귀 카운트) + 미분류 카드 + 전체 리프 flat', async () => {
    await mount()
    expect(container.textContent).toContain('PMO')
    expect(container.textContent).toContain('min.fold.unfiled')
    // 생산계획 루트 카드의 재귀 카운트(직계 1 + APS 1 = 2)
    const planCard = [...container.querySelectorAll('button')]
      .find(b => b.textContent?.includes('생산계획') && b.textContent?.includes('min.exp.meetingCount'))!
    expect(planCard.textContent).toContain('min.exp.subfolderCount')
    // 전체 flat: 3건 모두 렌더
    expect(container.querySelectorAll('a[href^="/minutes/m"]').length).toBe(3)
  })

  it('폴더 스코프: 직계 하위 폴더 카드 + 직계 리프만, 경로 표시', async () => {
    await mount()
    await act(async () => buttonByText('생산계획').click())   // 레일 행(첫 매치)
    expect(container.querySelector('a[href="/minutes/m2"]')).toBeTruthy()   // 직계
    expect(container.querySelector('a[href="/minutes/m1"]')).toBeNull()     // 하위 폴더 소속은 미표시
    expect(container.textContent).toContain('APS 회의')                      // 하위 폴더 카드
    await act(async () => buttonByText('APS 회의').click())
    expect(container.querySelector('a[href="/minutes/m1"]')).toBeTruthy()
    expect(onFolderSelect).toHaveBeenLastCalledWith('f-aps')
  })

  it('미분류 스코프: folder_id null 리프만', async () => {
    await mount()
    await act(async () => buttonByText('min.fold.unfiled').click())
    expect(container.querySelector('a[href="/minutes/m3"]')).toBeTruthy()
    expect(container.querySelector('a[href="/minutes/m1"]')).toBeNull()
    expect(onFolderSelect).toHaveBeenLastCalledWith(null)
  })

  it('폴더 ⋯ 메뉴는 소유자/관리자에게만 — 시드 폴더는 일반 사용자에게 숨김', async () => {
    await mount()
    // 시드(createdBy null) PMO 행: 메뉴 없음 / 본인 소유 APS 회의: 메뉴 있음
    const menuBtns = [...container.querySelectorAll('button[aria-label="min.fold.menuAria"]')]
    expect(menuBtns.length).toBe(1)
    await mount({ isAdmin: true })
    expect([...container.querySelectorAll('button[aria-label="min.fold.menuAria"]')].length).toBe(3)
  })

  it('새 폴더 버튼 → 생성 모달 열림, 이동 버튼 → 픽커 열림 후 moveMinuteToFolder 호출·onChanged', async () => {
    await mount()
    await act(async () => buttonByText('min.fold.new').click())
    expect(container.textContent).toContain('min.fold.name')          // FolderManageModal
    await act(async () => buttonByText('min.form.cancel').click?.())  // 없으면 Esc 대체 — 구현의 닫기 버튼 텍스트에 맞춤
    // 이동: m1 카드의 이동 버튼(작성자 u1)
    const moveBtn = [...container.querySelectorAll('button[aria-label="min.fold.move"]')]
      .find(b => b.closest('article')?.textContent?.includes('APS 인터뷰'))!
    await act(async () => moveBtn.click())
    expect(container.textContent).toContain('min.fold.pickTitle')
    await act(async () => buttonByText('min.fold.unfiled').click())   // 픽커에서 미분류 선택
    expect(moveMinuteToFolder).toHaveBeenCalledWith('m1', null)
    expect(onChanged).toHaveBeenCalled()
  })

  it('이동 버튼은 작성자가 아니고 관리자도 아니면 없다', async () => {
    await mount({ currentUserId: 'other' })
    expect(container.querySelectorAll('button[aria-label="min.fold.move"]').length).toBe(0)
  })

  it('선택 폴더가 사라지면(재조회 후) all 강등', async () => {
    await mount()
    await act(async () => buttonByText('APS 회의').click())
    await mount({ folders: [folders[0], folders[1]], leaves })  // f-aps 삭제된 재조회 결과
    expect(container.querySelectorAll('a[href^="/minutes/m"]').length).toBe(3)  // all flat
  })

  it('즐겨찾기·팀 필터 계약 유지: favorites=null 카운트 –, 즐겨찾기 스코프 에러 카드+재시도', async () => {
    await mount({ favorites: null })
    expect(container.textContent).toContain('–')
    await act(async () => buttonByText('min.exp.favorites').click())
    expect(container.textContent).toContain('min.exp.favError')
    await act(async () => buttonByText('min.tree.retry').click())
    expect(onRetry).toHaveBeenCalledTimes(1)
  })

  it('더 보기 30개 증분과 레이아웃 콜백 유지', async () => {
    const many = Array.from({ length: 35 }, (_, i) => leaf(`x${i}`, '2026-07-01', `대량_${i}`, null))
    await mount({ leaves: many, folders: [] })
    expect(container.querySelectorAll('a[href^="/minutes/x"]').length).toBe(30)
    await act(async () => buttonByText('min.exp.more').click())
    expect(container.querySelectorAll('a[href^="/minutes/x"]').length).toBe(35)
    await act(async () => buttonByText('min.exp.layout.list').click())
    expect(onLayout).toHaveBeenCalledWith('list')
  })
})
```

주의(구현자용): 다섯 번째 테스트의 `min.form.cancel` 닫기 클릭은 FolderManageModal 구현의 실제 닫기 수단(아래 전문은 Modal의 X 버튼 — `aria-label`이 Modal 내부 관례)에 맞춰 **테스트를 구현에 맞게 조정하지 말고, 모달에 명시적 취소 버튼(`min.form.cancel` — meetings dict가 아닌 minutes dict에 이미 있는지 확인 후 없으면 `min.fold.cancel` 키 추가)을 두는 쪽으로 구현**하라. 단언 약화 금지.

- [ ] **Step 3: 실패 확인**

Run: `npx vitest run tests/ui/minutes-explorer.test.tsx`
Expected: FAIL — 신규 props/컴포넌트 미구현.

- [ ] **Step 4: FolderManageModal 구현**

`src/components/minutes/FolderManageModal.tsx` (신규 전문):

```tsx
'use client'
import { useState } from 'react'
import type { MinuteFolder } from '@/lib/domain/types'
import { createMinuteFolder, deleteMinuteFolder, renameMinuteFolder } from '@/app/actions/minutes'
import { useLocale } from '@/components/providers/LocaleProvider'
import { Modal } from '@/components/ui/Modal'

/** 폴더 생성/이름 변경/삭제 확인 공용 모달. 성공 시 onDone(재조회는 호출부 책임). */
export function FolderManageModal({
  open, mode, folder, parentId, onClose, onDone,
}: {
  open: boolean
  mode: 'create' | 'rename' | 'delete'
  folder?: MinuteFolder            // rename/delete 대상
  parentId: string | null          // create 의 부모(null=루트)
  onClose: () => void
  onDone: () => void
}) {
  const { t } = useLocale()
  const [name, setName] = useState(mode === 'rename' ? folder?.name ?? '' : '')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  async function submit() {
    setBusy(true); setErr(null)
    try {
      const res = mode === 'create'
        ? await createMinuteFolder(name, parentId)
        : mode === 'rename'
          ? await renameMinuteFolder(folder!.id, name)
          : await deleteMinuteFolder(folder!.id)
      if (!res.ok) { setErr(res.error ?? t('min.fold.error')); return }
      onDone()
    } finally { setBusy(false) }
  }

  const title = mode === 'create' ? t('min.fold.new') : mode === 'rename' ? t('min.fold.rename') : t('min.fold.deleteTitle')
  return (
    <Modal open={open} onClose={onClose} title={title} size="sm"
      footer={
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="btn">{t('min.fold.cancel')}</button>
          <button onClick={() => void submit()} disabled={busy || (mode !== 'delete' && !name.trim())}
            className={mode === 'delete' ? 'btn bg-delayed text-white hover:bg-delayed' : 'btn btn-primary'}>
            {busy ? t('min.form.saving') : mode === 'delete' ? t('min.fold.delete') : t('min.form.save')}
          </button>
        </div>
      }>
      <div className="space-y-3">
        {mode === 'delete' ? (
          <p className="text-sm text-ink">
            <span className="font-semibold">{folder?.name}</span> — {t('min.fold.deleteConfirm')}
          </p>
        ) : (
          <label className="block text-sm">
            <span className="mb-1 block font-medium">{t('min.fold.name')}</span>
            <input value={name} onChange={e => setName(e.target.value)} maxLength={60}
              autoFocus className="app-input" />
          </label>
        )}
        {err && <p className="text-sm text-delayed">{err}</p>}
      </div>
    </Modal>
  )
}
```

i18n 추가 필요 키(Step 1 목록에 **추가로** 두 쌍 더): ko `'min.fold.cancel': '취소'`, `'min.fold.error': '폴더 작업에 실패했습니다'` / en `'Cancel'`, `'Folder operation failed'`. (Step 2 테스트의 닫기 클릭은 `min.fold.cancel`을 사용하도록 테스트 코드의 `min.form.cancel`을 `min.fold.cancel`로 작성한다 — 위 전문 코드의 해당 줄을 이 키로 쓰는 것이 정본.)

- [ ] **Step 5: FolderPickModal 구현**

`src/components/minutes/FolderPickModal.tsx` (신규 전문):

```tsx
'use client'
import { Folder, FolderOpen } from 'lucide-react'
import type { FolderNode, MinuteFolder } from '@/lib/domain/types'
import { buildFolderTree } from '@/lib/domain/minutes'
import { useLocale } from '@/components/providers/LocaleProvider'
import { Modal } from '@/components/ui/Modal'

/** 이동 대상 폴더 픽커 — 트리 들여쓰기 + 미분류. 선택 즉시 onPick(닫기는 호출부). */
export function FolderPickModal({
  open, folders, onClose, onPick,
}: {
  open: boolean
  folders: MinuteFolder[]
  onClose: () => void
  onPick: (folderId: string | null) => void
}) {
  const { t } = useLocale()
  const { roots } = buildFolderTree(folders, [])

  function rows(nodes: FolderNode[], depth: number): React.ReactNode[] {
    return nodes.flatMap(n => [
      <li key={n.folder.id}>
        <button onClick={() => onPick(n.folder.id)}
          style={{ paddingLeft: `${8 + depth * 16}px` }}
          className="flex h-8 w-full min-w-0 items-center gap-2 rounded-lg pr-2 text-left transition-colors duration-100 hover:bg-surface-2">
          <Folder aria-hidden className="h-4 w-4 shrink-0 text-ink-subtle" />
          <span className="min-w-0 flex-1 truncate text-[13px] text-ink">{n.folder.name}</span>
        </button>
      </li>,
      ...rows(n.children, depth + 1),
    ])
  }

  return (
    <Modal open={open} onClose={onClose} title={t('min.fold.pickTitle')} size="sm">
      <ul className="max-h-80 space-y-0.5 overflow-y-auto">
        <li>
          <button onClick={() => onPick(null)}
            className="flex h-8 w-full min-w-0 items-center gap-2 rounded-lg px-2 text-left transition-colors duration-100 hover:bg-surface-2">
            <FolderOpen aria-hidden className="h-4 w-4 shrink-0 text-ink-subtle" />
            <span className="min-w-0 flex-1 truncate text-[13px] text-ink">{t('min.fold.unfiled')}</span>
          </button>
        </li>
        {rows(roots, 0)}
      </ul>
    </Modal>
  )
}
```

- [ ] **Step 6: MinutesExplorer v2 전면 교체**

`src/components/minutes/MinutesExplorer.tsx` 전문 교체:

```tsx
'use client'
import { useMemo, useState } from 'react'
import Link from 'next/link'
import {
  ChevronDown, ChevronRight, Folder, FolderOpen, FolderPlus, LayoutGrid, List,
  MoreHorizontal, Paperclip, Star,
} from 'lucide-react'
import type {
  ExplorerLeaf, FolderNode, MeetingCategory, MinuteFolder,
} from '@/lib/domain/types'
import { buildFolderTree, folderDepthOf, MINUTE_FOLDER_DEPTH_MAX } from '@/lib/domain/minutes'
import { MEETING_META } from '@/lib/domain/meetings'
import { moveMinuteToFolder } from '@/app/actions/minutes'
import { useLocale } from '@/components/providers/LocaleProvider'
import type { DictKey } from '@/lib/i18n/dict'
import { SegmentedTabs } from '@/components/ui/SegmentedTabs'
import { EmptyState } from '@/components/ui/EmptyState'
import { useToast } from '@/components/ui/Toast'
import { TEAM } from '@/components/wbs/shared'
import { FolderManageModal } from './FolderManageModal'
import { FolderPickModal } from './FolderPickModal'

export type ExplorerLayout = 'grid' | 'list'
type Scope =
  | { kind: 'all' }
  | { kind: 'favorites' }
  | { kind: 'unfiled' }
  | { kind: 'folder'; id: string }
type ManageState =
  | { mode: 'create'; parentId: string | null }
  | { mode: 'rename'; folder: MinuteFolder }
  | { mode: 'delete'; folder: MinuteFolder }
  | null

const PAGE_SIZE = 30
type T = (k: DictKey) => string

const rowCls = (active: boolean) =>
  `flex h-8 w-full min-w-0 items-center gap-2 rounded-lg px-2 text-left transition-colors duration-100 ${
    active ? 'bg-brand-weak font-semibold text-brand' : 'text-ink hover:bg-surface-2'}`

/** 탐색기 v2 — 실제 폴더 디렉토리(스펙 2026-07-23-minutes-folders-design.md).
 *  데이터·즐겨찾기·레이아웃 상태는 MinutesView 소유. 여기는 선택·펼침·노출 개수·모달만 관리(비영속).
 *  leaves 는 팀 탭 필터가 이미 적용된 것 — 카운트·스코프가 필터와 정합. folders 는 항상 전부. */
export function MinutesExplorer({
  folders, leaves, favorites, onToggleFavorite, onRetryFavorites,
  layout, onLayoutChange, currentUserId, isAdmin, onChanged, onFolderSelect,
}: {
  folders: MinuteFolder[]
  leaves: ExplorerLeaf[]
  favorites: Set<string> | null
  onToggleFavorite: (id: string) => void
  onRetryFavorites: () => void
  layout: ExplorerLayout
  onLayoutChange: (v: ExplorerLayout) => void
  currentUserId: string | null
  isAdmin: boolean
  onChanged: () => void
  onFolderSelect?: (folderId: string | null) => void
}) {
  const { t } = useLocale()
  const { toast } = useToast()
  const [scopeRaw, setScopeRaw] = useState<Scope>({ kind: 'all' })
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [visible, setVisible] = useState(PAGE_SIZE)
  const [mobileOpen, setMobileOpen] = useState(false)
  const [manage, setManage] = useState<ManageState>(null)
  const [menuFor, setMenuFor] = useState<string | null>(null)
  const [movingId, setMovingId] = useState<string | null>(null)   // 폴더 픽커 대상 회의록

  const { roots, unfiled } = useMemo(() => buildFolderTree(folders, leaves), [folders, leaves])
  const nodeById = useMemo(() => {
    const map = new Map<string, FolderNode>()
    const walk = (nodes: FolderNode[]) => { for (const n of nodes) { map.set(n.folder.id, n); walk(n.children) } }
    walk(roots)
    return map
  }, [roots])
  const folderById = useMemo(() => new Map(folders.map(f => [f.id, f])), [folders])

  // 재조회로 폴더가 사라지면 선택이 유령을 가리킬 수 있다 — 조용히 all 로 강등
  const scope: Scope = useMemo(() => (
    scopeRaw.kind === 'folder' && !nodeById.has(scopeRaw.id) ? { kind: 'all' } : scopeRaw
  ), [scopeRaw, nodeById])

  function select(next: Scope) {
    setScopeRaw(next); setVisible(PAGE_SIZE); setMenuFor(null)
    onFolderSelect?.(next.kind === 'folder' ? next.id : null)
  }
  function toggleExpand(id: string) {
    setExpanded(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }
  const canManageFolder = (f: MinuteFolder) => isAdmin || (f.createdBy !== null && f.createdBy === currentUserId)
  const canMoveLeaf = (l: ExplorerLeaf) => isAdmin || (l.createdBy !== null && l.createdBy === currentUserId)

  const total = leaves.length
  const favCount = favorites === null
    ? null
    : leaves.reduce((n, l) => n + (favorites.has(l.id) ? 1 : 0), 0)

  const rows: ExplorerLeaf[] = useMemo(() => {
    switch (scope.kind) {
      case 'all': return leaves
      case 'favorites': return favorites ? leaves.filter(l => favorites.has(l.id)) : []
      case 'unfiled': return unfiled
      case 'folder': return nodeById.get(scope.id)?.directLeaves ?? []
    }
  }, [scope, leaves, favorites, unfiled, nodeById])
  const shown = rows.slice(0, visible)
  const remaining = rows.length - shown.length
  const showFolderChip = scope.kind === 'all' || scope.kind === 'favorites'

  async function moveTo(folderId: string | null) {
    const id = movingId
    setMovingId(null)
    if (!id) return
    const res = await moveMinuteToFolder(id, folderId)
    if (!res.ok) { toast({ title: res.error ?? t('min.fold.error'), variant: 'error' }); return }
    toast({ title: t('min.fold.moved'), variant: 'info' })
    onChanged()
  }

  function folderRow(node: FolderNode, depth: number): React.ReactNode {
    const f = node.folder
    const hasChildren = node.children.length > 0
    const isExpanded = expanded.has(f.id)
    const active = scope.kind === 'folder' && scope.id === f.id
    const FolderIcon = active || isExpanded ? FolderOpen : Folder
    return (
      <li key={f.id}>
        <div className="group flex items-center gap-0.5" style={{ paddingLeft: `${depth * 12}px` }}>
          {hasChildren ? (
            <button onClick={() => toggleExpand(f.id)} aria-expanded={isExpanded} aria-label={f.name}
              className="shrink-0 rounded-md p-1 text-ink-subtle transition-colors duration-100 hover:bg-surface-2">
              <ChevronRight aria-hidden
                className={`h-3.5 w-3.5 transition-transform duration-150 ${isExpanded ? 'rotate-90' : ''}`} />
            </button>
          ) : <span aria-hidden className="w-[22px] shrink-0" />}
          <button onClick={() => select({ kind: 'folder', id: f.id })} className={rowCls(active)}>
            <FolderIcon aria-hidden className="h-4 w-4 shrink-0 text-ink-subtle" />
            <span className="min-w-0 flex-1 truncate text-[13px]">{f.name}</span>
            <span className="shrink-0 text-xs tabular-nums text-ink-muted">{node.totalCount}</span>
          </button>
          {canManageFolder(f) && (
            <div className="relative shrink-0">
              <button onClick={() => setMenuFor(cur => (cur === f.id ? null : f.id))}
                aria-label={t('min.fold.menuAria')} aria-expanded={menuFor === f.id}
                className="rounded-md p-1 text-ink-subtle opacity-0 transition-opacity duration-100 hover:bg-surface-2 focus-visible:opacity-100 group-hover:opacity-100">
                <MoreHorizontal aria-hidden className="h-3.5 w-3.5" />
              </button>
              {menuFor === f.id && (
                <>
                  <button aria-hidden tabIndex={-1} onClick={() => setMenuFor(null)}
                    className="fixed inset-0 z-10 cursor-default" />
                  <div className="absolute right-0 z-20 mt-1 w-36 rounded-xl border border-line bg-surface p-1 shadow-[var(--shadow-md)]">
                    <button onClick={() => { setMenuFor(null); setManage({ mode: 'rename', folder: f }) }}
                      className="block w-full rounded-lg px-2 py-1.5 text-left text-[13px] text-ink hover:bg-surface-2">
                      {t('min.fold.rename')}
                    </button>
                    {folderDepthOf(folders, f.id) < MINUTE_FOLDER_DEPTH_MAX && (
                      <button onClick={() => { setMenuFor(null); setManage({ mode: 'create', parentId: f.id }) }}
                        className="block w-full rounded-lg px-2 py-1.5 text-left text-[13px] text-ink hover:bg-surface-2">
                        {t('min.fold.addSub')}
                      </button>
                    )}
                    <button onClick={() => { setMenuFor(null); setManage({ mode: 'delete', folder: f }) }}
                      className="block w-full rounded-lg px-2 py-1.5 text-left text-[13px] text-delayed hover:bg-surface-2">
                      {t('min.fold.delete')}
                    </button>
                  </div>
                </>
              )}
            </div>
          )}
        </div>
        {hasChildren && isExpanded && <ul>{node.children.map(c => folderRow(c, depth + 1))}</ul>}
      </li>
    )
  }

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
          <div className="flex items-center gap-0.5">
            <button onClick={() => go({ kind: 'all' })} className={rowCls(scope.kind === 'all')}>
              <FolderOpen aria-hidden className="h-4 w-4 shrink-0 text-ink-subtle" />
              <span className="min-w-0 flex-1 truncate text-[13px] font-medium">{t('min.exp.all')}</span>
              <span className="shrink-0 text-xs tabular-nums text-ink-muted">{total}</span>
            </button>
            <button onClick={() => setManage({ mode: 'create', parentId: null })}
              aria-label={t('min.fold.new')} title={t('min.fold.new')}
              className="shrink-0 rounded-md p-1 text-ink-subtle transition-colors duration-100 hover:bg-surface-2 hover:text-ink">
              <FolderPlus aria-hidden className="h-4 w-4" />
            </button>
          </div>
          <ul className="ml-2 mt-0.5 border-l border-line pl-1.5">
            {roots.map(r => folderRow(r, 0))}
            <li>
              <div className="flex items-center gap-0.5">
                <span aria-hidden className="w-[22px] shrink-0" />
                <button onClick={() => go({ kind: 'unfiled' })} className={rowCls(scope.kind === 'unfiled')}>
                  <FolderOpen aria-hidden className="h-4 w-4 shrink-0 text-ink-subtle" />
                  <span className="min-w-0 flex-1 truncate text-[13px] text-ink-muted">{t('min.fold.unfiled')}</span>
                  <span className="shrink-0 text-xs tabular-nums text-ink-muted">{unfiled.length}</span>
                </button>
              </div>
            </li>
          </ul>
        </li>
      </ul>
    )
  }

  // 경로 표시 — 폴더 스코프의 조상 체인(클릭 이동)
  const crumbs: MinuteFolder[] = useMemo(() => {
    if (scope.kind !== 'folder') return []
    const chain: MinuteFolder[] = []
    let cur: string | null = scope.id
    const seen = new Set<string>()
    while (cur && !seen.has(cur)) {
      seen.add(cur)
      const f = folderById.get(cur)
      if (!f) break
      chain.unshift(f)
      cur = f.parentId
    }
    return chain
  }, [scope, folderById])

  const folderCardCls =
    'card flex flex-col gap-3 p-4 text-left transition-shadow duration-150 hover:shadow-[var(--shadow-md)]'
  const folderCards = scope.kind === 'all' ? (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {roots.map(n => (
        <button key={n.folder.id} onClick={() => select({ kind: 'folder', id: n.folder.id })} className={folderCardCls}>
          <span className="flex min-w-0 items-center gap-2">
            <Folder aria-hidden className="h-5 w-5 shrink-0 text-brand fill-brand-weak" />
            <span className="truncate text-sm font-semibold text-ink">{n.folder.name}</span>
          </span>
          <span className="text-xs text-ink-muted">
            {t('min.exp.meetingCount').replace('{n}', String(n.totalCount))}
            {n.children.length > 0 && <> {' · '}{t('min.exp.subfolderCount').replace('{n}', String(n.children.length))}</>}
          </span>
        </button>
      ))}
      <button onClick={() => select({ kind: 'unfiled' })} className={folderCardCls}>
        <span className="flex min-w-0 items-center gap-2">
          <FolderOpen aria-hidden className="h-5 w-5 shrink-0 text-ink-subtle" />
          <span className="truncate text-sm font-semibold text-ink">{t('min.fold.unfiled')}</span>
        </span>
        <span className="text-xs text-ink-muted">{t('min.exp.meetingCount').replace('{n}', String(unfiled.length))}</span>
      </button>
    </div>
  ) : scope.kind === 'folder' && (nodeById.get(scope.id)?.children.length ?? 0) > 0 ? (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {nodeById.get(scope.id)!.children.map(n => (
        <button key={n.folder.id} onClick={() => select({ kind: 'folder', id: n.folder.id })} className={folderCardCls}>
          <span className="flex min-w-0 items-center gap-2">
            <Folder aria-hidden className="h-5 w-5 shrink-0 text-ink-subtle" />
            <span className="truncate text-sm font-semibold text-ink">{n.folder.name}</span>
          </span>
          <span className="text-xs text-ink-muted">
            {t('min.exp.meetingCount').replace('{n}', String(n.totalCount))}
            {n.children.length > 0 && <> {' · '}{t('min.exp.subfolderCount').replace('{n}', String(n.children.length))}</>}
          </span>
        </button>
      ))}
    </div>
  ) : null

  return (
    <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
      <nav className="card hidden w-[250px] shrink-0 p-2 lg:block">{rail()}</nav>
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

      <section className="min-w-0 flex-1 space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex min-w-0 items-center gap-1.5 text-sm">
            {scope.kind === 'favorites' ? (
              <span className="font-semibold text-ink">{t('min.exp.favorites')}</span>
            ) : scope.kind === 'unfiled' ? (
              <>
                <button onClick={() => select({ kind: 'all' })} className="text-ink-muted transition-colors hover:text-ink">
                  {t('min.exp.all')}
                </button>
                <ChevronRight aria-hidden className="h-3.5 w-3.5 shrink-0 text-ink-subtle" />
                <span className="font-semibold text-ink">{t('min.fold.unfiled')}</span>
              </>
            ) : (
              <>
                <button onClick={() => select({ kind: 'all' })}
                  className={scope.kind === 'all' ? 'font-semibold text-ink' : 'text-ink-muted transition-colors hover:text-ink'}>
                  {t('min.exp.all')}
                </button>
                {crumbs.map((f, i) => (
                  <span key={f.id} className="flex min-w-0 items-center gap-1.5">
                    <ChevronRight aria-hidden className="h-3.5 w-3.5 shrink-0 text-ink-subtle" />
                    {i === crumbs.length - 1
                      ? <span className="truncate font-semibold text-ink">{f.name}</span>
                      : (
                        <button onClick={() => select({ kind: 'folder', id: f.id })}
                          className="truncate text-ink-muted transition-colors hover:text-ink">{f.name}</button>
                      )}
                  </span>
                ))}
              </>
            )}
          </div>
          <div className="ml-auto">
            <SegmentedTabs<ExplorerLayout>
              tabs={[{ key: 'grid', label: t('min.exp.layout.grid'), icon: LayoutGrid },
                     { key: 'list', label: t('min.exp.layout.list'), icon: List }]}
              value={layout} onChange={onLayoutChange} size="sm" />
          </div>
        </div>

        {scope.kind === 'favorites' && favorites === null ? (
          <EmptyState title={t('min.exp.favError')}
            action={<button onClick={onRetryFavorites} className="btn">{t('min.tree.retry')}</button>} />
        ) : (
          <>
            {folderCards}
            {rows.length === 0 ? (
              scope.kind === 'favorites'
                ? <EmptyState icon={Star} title={t('min.exp.favEmpty')} />
                : !folderCards && <EmptyState title={t('min.empty.title')} description={t('min.empty.desc')} />
            ) : layout === 'grid' ? (
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                {shown.map(l => (
                  <MinuteCard key={l.id} l={l} t={t} folderName={folderNameOf(l, folderById, showFolderChip)}
                    fav={favorites?.has(l.id) ?? false} favDisabled={favorites === null}
                    canMove={canMoveLeaf(l)} onMove={() => setMovingId(l.id)}
                    onToggle={onToggleFavorite} />
                ))}
              </div>
            ) : (
              <div className="card p-2">
                <ul className="divide-y divide-line/70">
                  {shown.map(l => (
                    <MinuteRow key={l.id} l={l} t={t} folderName={folderNameOf(l, folderById, showFolderChip)}
                      fav={favorites?.has(l.id) ?? false} favDisabled={favorites === null}
                      canMove={canMoveLeaf(l)} onMove={() => setMovingId(l.id)}
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

      {manage && (
        <FolderManageModal open mode={manage.mode}
          folder={manage.mode !== 'create' ? manage.folder : undefined}
          parentId={manage.mode === 'create' ? manage.parentId : null}
          onClose={() => setManage(null)}
          onDone={() => { setManage(null); onChanged() }} />
      )}
      <FolderPickModal open={movingId !== null} folders={folders}
        onClose={() => setMovingId(null)} onPick={id => void moveTo(id)} />
    </div>
  )
}

/** 폴더 칩 라벨 — all·favorites 스코프에서 소속이 있을 때만. */
function folderNameOf(
  l: ExplorerLeaf, folderById: Map<string, MinuteFolder>, show: boolean,
): string | null {
  if (!show || !l.folderId) return null
  return folderById.get(l.folderId)?.name ?? null
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

function MoveButton({ onMove, t }: { onMove: () => void; t: T }) {
  return (
    <button onClick={onMove} aria-label={t('min.fold.move')} title={t('min.fold.move')}
      className="relative z-10 shrink-0 rounded-md p-1 text-ink-subtle transition-colors duration-100 hover:bg-surface-2 hover:text-ink">
      <FolderOpen aria-hidden className="h-4 w-4" />
    </button>
  )
}

function CategoryChip({ cat, t }: { cat: MeetingCategory; t: T }) {
  const meta = MEETING_META[cat]
  return <span className={`chip ${meta.chip}`}>{t(meta.labelKey)}</span>
}

function MinuteCard({ l, fav, favDisabled, canMove, onMove, onToggle, folderName, t }: {
  l: ExplorerLeaf; fav: boolean; favDisabled: boolean
  canMove: boolean; onMove: () => void
  onToggle: (id: string) => void; folderName: string | null; t: T
}) {
  return (
    <article className="card relative flex flex-col gap-2 p-4 transition-shadow duration-150 hover:shadow-[var(--shadow-md)]">
      <Link href={`/minutes/${l.id}`} aria-label={l.title} className="absolute inset-0 rounded-2xl" />
      <div className="flex items-start gap-1.5">
        <StarButton id={l.id} fav={fav} disabled={favDisabled} onToggle={onToggle} t={t} />
        <h4 className="min-w-0 flex-1 truncate pt-0.5 text-sm font-semibold text-ink">{l.title}</h4>
        {canMove && <MoveButton onMove={onMove} t={t} />}
        <span className={`inline-flex shrink-0 justify-center rounded-md px-1.5 py-0.5 text-[11px] font-bold text-white ${TEAM[l.teamCode]?.bar ?? 'bg-ink-subtle'}`}>
          {l.teamCode}
        </span>
      </div>
      {(l.meetingCategory || folderName) && (
        <div className="flex flex-wrap items-center gap-1.5">
          {l.meetingCategory && <CategoryChip cat={l.meetingCategory} t={t} />}
          {folderName && (
            <span className="chip bg-surface-2 text-ink-muted">
              <Folder aria-hidden className="h-3 w-3" />{folderName}
            </span>
          )}
        </div>
      )}
      {l.bodyPreview && <p className="line-clamp-3 text-[13px] leading-5 text-ink-muted">{l.bodyPreview}</p>}
      <div className="mt-auto flex items-center gap-2 pt-1 text-xs text-ink-subtle">
        <span className="tabular-nums">{l.minuteDate}</span>
        {l.createdByName && <><span aria-hidden>·</span><span className="truncate">{l.createdByName}</span></>}
        {l.fileCount > 0 && (
          <span className="ml-auto inline-flex items-center gap-1">
            <Paperclip aria-hidden className="h-3 w-3" />{l.fileCount}
          </span>
        )}
      </div>
    </article>
  )
}

function MinuteRow({ l, fav, favDisabled, canMove, onMove, onToggle, folderName, t }: {
  l: ExplorerLeaf; fav: boolean; favDisabled: boolean
  canMove: boolean; onMove: () => void
  onToggle: (id: string) => void; folderName: string | null; t: T
}) {
  return (
    <li className="relative">
      <Link href={`/minutes/${l.id}`} aria-label={l.title} className="absolute inset-0 rounded-lg" />
      <div className="flex items-center gap-3 rounded-lg px-2 py-2.5 transition-colors duration-100 hover:bg-surface-2">
        <StarButton id={l.id} fav={fav} disabled={favDisabled} onToggle={onToggle} t={t} />
        <span className={`inline-flex w-12 shrink-0 justify-center rounded-md px-1.5 py-0.5 text-[11px] font-bold text-white ${TEAM[l.teamCode]?.bar ?? 'bg-ink-subtle'}`}>
          {l.teamCode}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium text-ink">{l.title}</span>
          {l.bodyPreview && <span className="block truncate text-xs text-ink-subtle">{l.bodyPreview}</span>}
        </span>
        {l.meetingCategory && <span className="hidden shrink-0 sm:inline-flex"><CategoryChip cat={l.meetingCategory} t={t} /></span>}
        {folderName && (
          <span className="chip hidden shrink-0 bg-surface-2 text-ink-muted md:inline-flex">
            <Folder aria-hidden className="h-3 w-3" />{folderName}
          </span>
        )}
        {canMove && <MoveButton onMove={onMove} t={t} />}
        <span className="w-20 shrink-0 text-right text-xs tabular-nums text-ink-subtle">{l.minuteDate}</span>
      </div>
    </li>
  )
}
```

- [ ] **Step 7: 통과 확인**

Run: `npx vitest run tests/ui/minutes-explorer.test.tsx` 후 `npx tsc --noEmit`
Expected: 테스트 9케이스 PASS·출력 깨끗. tsc는 MinutesView(아직 구 props 사용)에서 에러가 나는 것은 Task 5에서 해소 — **신규/재작성 파일의 에러만 0**이면 통과.

- [ ] **Step 8: 커밋**

```bash
git add src/components/minutes/MinutesExplorer.tsx src/components/minutes/FolderManageModal.tsx src/components/minutes/FolderPickModal.tsx src/lib/i18n/dict/minutes.ts tests/ui/minutes-explorer.test.tsx
git commit -m "feat(minutes): 탐색기 v2 — 실폴더 레일·폴더 CRUD 메뉴·이동 픽커·미분류

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: MinutesView·page·업로드 배선 + 구 파생 트리 폐기 + 전체 검증

**Files:**
- Modify: `src/components/minutes/MinutesView.tsx`
- Modify: `src/app/(app)/minutes/page.tsx`
- Modify: `src/components/minutes/MinuteUploadModal.tsx`
- Modify: `src/lib/data/minutes.ts` (getMinutesTree 삭제), `src/app/actions/minutes.ts` (fetchMinutesTree 삭제), `src/lib/domain/minutes.ts` (buildMinutesTree 삭제 — meetingBodyOf·노이즈 패턴·MINUTES_TREE_LIMIT 유지), `src/lib/domain/types.ts` (MinutesTreeGroup/Body/Leaf 삭제)
- Modify: `tests/domain/minutesTree.test.ts` (buildMinutesTree describe 블록 삭제 — meetingBodyOf 블록 유지), `tests/ui/minutes-view-initial-tree.test.tsx`, `tests/ui/minutes-view-tree-toggle.test.tsx`, `tests/ui/minutes-export-download.test.tsx`, `tests/minutes/favorites-action.test.ts`(목에서 getMinutesTree 제거)

**Interfaces:**
- Consumes: Task 3의 `fetchMinutesExplorer`/`createMinute(input, folderId)`, Task 4의 `MinutesExplorer` props 계약.
- Produces: `MinutesView`의 `initialTree` prop 타입이 `ExplorerData | null`로 변경(이름 유지 — 계약 파일들 diff 최소화). `MinuteUploadModal` props에 `folders: MinuteFolder[]`, `defaultFolderId: string | null` 추가.

- [ ] **Step 1: 기존 UI 테스트에 실패하는 계약 반영 (픽스처·목 교체)**

**(a) `tests/ui/minutes-view-initial-tree.test.tsx`** — 픽스처를 v2 페이로드로 교체:

```ts
const serverTree = {
  folders: [{ id: 'f1', name: '생산계획', parentId: null, sort: 5, createdBy: null }],
  leaves: [{
    id: 'm1', minuteDate: '2026-07-16', teamCode: 'MES', title: '물류공정_260716',
    fileCount: 0, createdBy: null, createdByName: null,
    bodyPreview: '', meetingCategory: null, folderId: 'f1',
  }],
  total: 1, truncated: false,
}
```

액션 목의 `fetchMinutesTree`를 `fetchMinutesExplorer`로 교체(변수명 포함 전부), `groups` 픽스처 삭제, 단언의 `'물류공정'`은 `'물류공정_260716'`(리프 제목이 카드로 렌더)으로 유지 가능 — `toContain('물류공정')`은 그대로 성립하므로 단언 무변경. 기존 7계약(프리페치 재조회 0회·캐시·null 폴백·빈 객체 굳음·하위 호환·favorites 2건) 전부 유지. '빈 트리 객체' 케이스의 픽스처는 `{ folders: [], leaves: [], total: 0, truncated: false }`.

**(b) `tests/ui/minutes-view-tree-toggle.test.tsx`** — treeResult를 (a)와 동일 shape로 교체, `fetchMinutesTree`→`fetchMinutesExplorer` 전면 치환. 기존 계약 단언은 전부 유지하되 한 곳만 의미 조정: `'트리 뷰에서 팀 탭 선택은 재조회 없이 클라이언트 프루닝한다'`는 v2에서 리프 필터이므로 단언을 `expect(container.querySelector('a[href="/minutes/m1"]')).toBeNull()`(MES 리프가 PMO 필터로 사라짐) + `expect(container.textContent).toContain('생산계획')`(폴더는 항상 표시)로 교체. 낙관 토글·롤백·레이아웃 2케이스는 무변경(별·레이아웃 토글은 v2에도 동일 DOM 계약).

**(c) `tests/ui/minutes-export-download.test.tsx`** — 목의 `fetchMinutesTree: vi.fn(async () => ({ groups: [], total: 0, truncated: false }))`를 `fetchMinutesExplorer: vi.fn(async () => ({ folders: [], leaves: [], total: 0, truncated: false }))`로 교체.

**(d) `tests/minutes/favorites-action.test.ts`** — data 목에서 `getMinutesTree` 항목 제거(남기면 무해하나 사라진 export를 목킹하는 죽은 줄이 된다), `getMinutesExplorer` 유지.

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run tests/ui/minutes-view-initial-tree.test.tsx`
Expected: FAIL — `fetchMinutesExplorer` 목이 소비되지 않음(MinutesView가 아직 구 액션 호출).

- [ ] **Step 3: MinutesView 수정**

`src/components/minutes/MinutesView.tsx`:

(a) import: `fetchMinutesTree` → `fetchMinutesExplorer`, 타입 `MinutesTreeGroup` → `ExplorerData, ExplorerLeaf, MinuteFolder`, `MINUTES_TREE_LIMIT` 유지.

(b) `TreeState`의 객체 팔을 `ExplorerData`로:

```ts
type TreeState = 'idle' | 'loading' | 'error' | ExplorerData
```

`initialTree` prop 타입도 `ExplorerData | null`. `loadTree`는 `fetchMinutesExplorer()` 호출로만 변경(상태 기계 무변경).

(c) 트리 요약(summary) useMemo — groups 대신 leaves 집계:

```ts
    if (typeof treeState !== 'object') return null
    const c: Record<string, number> = {}
    for (const tk of TEAM_CODES) c[tk] = 0
    for (const l of treeState.leaves) c[l.teamCode] = (c[l.teamCode] ?? 0) + 1
    return { total: treeState.total, byTeam: c }
```

(d) 팀 프루닝을 리프 필터로:

```ts
  // 팀 탭은 재조회 없이 리프만 클라이언트 필터(폴더 레일은 항상 전부 — 스펙 v2)
  const explorerLeaves: ExplorerLeaf[] = typeof treeState === 'object'
    ? (team === 'ALL' ? treeState.leaves : treeState.leaves.filter(l => l.teamCode === team))
    : []
```

(e) 트리 뷰 렌더 — 빈 게이트를 제거하고(폴더 시드가 항상 콘텐츠) 탐색기에 신규 props:

```tsx
      {view === 'tree' && !isSearch && (
        treeState === 'idle' || treeState === 'loading' ? (
          <CardSkeleton lines={8} />
        ) : treeState === 'error' ? (
          <EmptyState title={t('min.tree.error')}
            action={<button onClick={() => void loadTree()} className="btn">{t('min.tree.retry')}</button>} />
        ) : (
          <div className="space-y-2">
            {treeState.truncated && (
              <p className="text-xs text-ink-subtle">
                {t('min.tree.truncated').replace('{n}', String(MINUTES_TREE_LIMIT))}
              </p>
            )}
            <MinutesExplorer folders={treeState.folders} leaves={explorerLeaves}
              favorites={favState instanceof Set ? favState : null}
              onToggleFavorite={id => void toggleFav(id)}
              onRetryFavorites={() => void loadFavorites()}
              layout={exLayout} onLayoutChange={changeExplorerLayout}
              currentUserId={currentUserId} isAdmin={role === 'pmo_admin'}
              onChanged={() => { void loadTree(); router.refresh() }}
              onFolderSelect={id => { uploadFolderRef.current = id }} />
          </div>
        )
      )}
```

(f) 업로드 기본 폴더 ref + 모달 전달:

```ts
  const uploadFolderRef = useRef<string | null>(null)
```

업로드 모달 렌더에 `folders={typeof treeState === 'object' ? treeState.folders : []}` `defaultFolderId={uploadFolderRef.current}` 추가.

(g) 파일 하단의 `{void currentUserId} {void role} {void locale}`에서 이제 실사용되는 `currentUserId`·`role` 제거(`{void locale}`만 잔존).

- [ ] **Step 4: page.tsx·업로드 모달 수정**

`src/app/(app)/minutes/page.tsx` — `getMinutesTree` → `getMinutesExplorer`(import·Promise.all·주석의 "트리" 표현 유지 무방).

`src/components/minutes/MinuteUploadModal.tsx`:
- props에 `folders: MinuteFolder[]`, `defaultFolderId: string | null` 추가(타입 import `MinuteFolder` 추가).
- state `const [folderId, setFolderId] = useState<string>(defaultFolderId ?? '')`.
- `createMinute({...})` 호출을 `createMinute({...}, folderId || null)`로.
- 폼의 프로젝트/회의 grid 위에 폴더 셀렉트 추가:

```tsx
        <label className="block text-sm">
          <span className="mb-1 block font-medium">{t('min.fold.form.folder')}</span>
          <select value={folderId} onChange={e => setFolderId(e.target.value)} className="app-input">
            <option value="">{t('min.fold.unfiled')}</option>
            {folderOptions(folders).map(o => (
              <option key={o.id} value={o.id}>{'  '.repeat(o.depth)}{o.name}</option>
            ))}
          </select>
        </label>
```

파일 상단(컴포넌트 밖)에 헬퍼:

```ts
import { buildFolderTree } from '@/lib/domain/minutes'
import type { FolderNode } from '@/lib/domain/types'

/** 셀렉트용 평탄화 — 트리 순서 유지 + depth 들여쓰기. */
function folderOptions(folders: MinuteFolder[]): { id: string; name: string; depth: number }[] {
  const { roots } = buildFolderTree(folders, [])
  const out: { id: string; name: string; depth: number }[] = []
  const walk = (nodes: FolderNode[], depth: number) => {
    for (const n of nodes) { out.push({ id: n.folder.id, name: n.folder.name, depth }); walk(n.children, depth + 1) }
  }
  walk(roots, 0)
  return out
}
```

- [ ] **Step 5: 구 파생 트리 폐기**

- `src/lib/data/minutes.ts`: `getMinutesTree` 함수 삭제, import에서 `buildMinutesTree` 제거(`MINUTES_TREE_LIMIT`·`ilikeOrPattern` 유지).
- `src/app/actions/minutes.ts`: `fetchMinutesTree` 삭제, import에서 `getMinutesTree`·`MinutesTreeGroup` 제거.
- `src/lib/domain/minutes.ts`: `buildMinutesTree` 함수와 그 주석 블록 삭제(§"트리 뷰: 회의체 추출" 중 `meetingBodyOf`·노이즈 패턴·`MINUTES_TREE_LIMIT`은 유지 — 내보내기 ZIP·탐색기 캡이 사용).
- `src/lib/domain/types.ts`: `MinutesTreeLeaf`/`MinutesTreeBody`/`MinutesTreeGroup` 3개 인터페이스와 상단 주석 삭제.
- `tests/domain/minutesTree.test.ts`: `describe('buildMinutesTree')` 블록과 `minute()` 헬퍼·관련 import 삭제(`meetingBodyOf` describe 2개는 유지 — 파일 이름도 유지).
- 잔존 참조 검증: `grep -rn "MinutesTree\|buildMinutesTree\|fetchMinutesTree\|getMinutesTree" src tests` → 0건이어야 함(`MINUTES_TREE_LIMIT`은 제외 — 이름에 'MinutesTree'가 포함되지 않음).

- [ ] **Step 6: 관련 테스트 통과 확인**

Run: `npx vitest run tests/ui tests/domain tests/minutes`
Expected: 전부 PASS.

- [ ] **Step 7: 전체 검증**

```bash
npm test
npm run lint
npm run build
```
Expected: 전부 그린. 실패 시 이 태스크에서 수정(타 세션 파일 기인이면 보고만).

- [ ] **Step 8: 커밋**

```bash
git add src/components/minutes/MinutesView.tsx "src/app/(app)/minutes/page.tsx" src/components/minutes/MinuteUploadModal.tsx src/lib/data/minutes.ts src/app/actions/minutes.ts src/lib/domain/minutes.ts src/lib/domain/types.ts tests/domain/minutesTree.test.ts tests/ui/minutes-view-initial-tree.test.tsx tests/ui/minutes-view-tree-toggle.test.tsx tests/ui/minutes-export-download.test.tsx tests/minutes/favorites-action.test.ts
git commit -m "feat(minutes): 탐색기 v2 배선 — 폴더 페이로드·업로드 폴더 선택·파생 트리 폐기

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 6: 프로덕션 적용 + 배포 (사용자 확인 게이트)

- [ ] **Step 1: 사용자 승인 확인** — 프로덕션 DB 변경(0040).
- [ ] **Step 2: 0040 적용** — `scripts/apply-0039.mjs`를 본떠 `scripts/apply-0040.mjs` 작성(마이그레이션 파일 경로와 VERIFY만 교체: minute_folders 존재+RLS+시드 10행+`minutes.folder_id` 컬럼) 후 키체인 토큰으로 실행. 검증 쿼리: `select count(*) from minute_folders where parent_id is null` → 10.
- [ ] **Step 3: 머지-푸시** — worktree 브랜치를 main에 ff 머지 후 push(=Vercel 배포). **순서: DB 먼저.**
- [ ] **Step 4: 스모크(브라우저)** — 탐색기 레일에 10구분+미분류(기존 회의록 전부), 새 폴더 생성→하위 폴더→이름 변경, 회의록 이동(미분류→폴더) 후 카운트 반영, 업로드 모달 폴더 기본값, 삭제 시 미분류 강등. 생성한 테스트 폴더는 정리.

---

## Self-Review 결과 (작성 시 반영 완료)

- 스펙 커버리지: 0040(T1)·도메인(T2)·데이터/액션(T3)·UI+i18n(T4)·배선/폐기(T5)·배포(T6). 스펙의 "meetingBodyOf 유지"·"MinuteInput 무오염"·"삭제 다이얼로그 건수 미표기"·"시드=pmo_admin 전용(⋯ 숨김+RLS)"·"깊이 5단(액션+UI 메뉴 가드)" 전부 태스크에 대응.
- 타입 일관성: `ExplorerData/MinuteFolder/ExplorerLeaf/FolderNode`(T2 정의)를 T3 데이터·T4 props·T5 배선이 동일 시그니처로 사용. `createMinute(input, folderId?)`(T3)와 업로드 호출(T5) 일치. `fetchMinutesExplorer` 명명 전 태스크 일치.
- 함정 명시: 시드 insert는 부분 유니크라 `where not exists`(on conflict 불가), 0행 업데이트=권한 거부 판정, favorites 테스트 목의 `getMinutesExplorer` 스텁, 테스트 (b)의 프루닝 단언 의미 조정, Task 4 시점의 MinutesView tsc 에러 허용 범위.
