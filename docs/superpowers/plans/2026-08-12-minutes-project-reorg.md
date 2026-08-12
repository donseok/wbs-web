# 회의록 프로젝트 재편(B안) 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 회의록 폴더를 프로젝트 소속으로 재편(트리 최상위 = 프로젝트 + 미지정)하고, 나의 회의 달력에 프로젝트 필터 칩·색상을 추가한다.

**Architecture:** `minute_folders.project_id`(null=미지정) 추가 + 프로젝트별 팀 루트 시드(유효 팀 마스터 기준). 경로 해석(`resolveFolderPath`)·스냅샷에 projectId 차원을 넣고 루트는 지연 보장(lazy ensure). 데이터 백필은 vitest 구동 TS 러너로 라이브 `resolveFolderPath`를 재사용. 스펙: `docs/superpowers/specs/2026-08-12-minutes-project-reorg-design.md`.

**Tech Stack:** Next.js 15 App Router, Supabase(Postgres 17, Management API 적용), Tailwind v4, vitest.

## Global Constraints

- **`git add -A` 금지** — 항상 파일명 명시 스테이징.
- **마이그레이션 SQL과 코드는 같은 커밋에 담지 않는다**(G1). `supabase/migrations/*` 는 SQL 파일만으로 별도 커밋.
- **0076은 G4 대상(훅 기준 0072+)** — 스테이징 리허설 + `Staging-verified:` 트레일러 없이 main push 불가. 적용은 `npm run db:apply`(Management API), `supabase db push` 금지. push 는 Task 10 에서 일괄.
- **위키 로직 무접촉** — `rebuildProjectWikiFromActiveMinutes` 호출·위키 RPC 는 현행 그대로 둔다(위키는 작업 금지 대상이지만 기존 호출 삭제도 금지).
- **또박또박 외부 API 계약(v2.x folder_path §3.x) 무변경** — 요청/응답 스키마·3값 규약·정규화 규칙 유지. 바뀌는 것은 경로 해석의 기준 트리(프로젝트 스코프)뿐.
- **운영 D-CUBE 데이터 훼손 금지** — 쓰기 검증은 스테이징에서만. 로컬 dev 기본 DB는 스테이징.
- 에러 3원칙: 조회 실패를 빈 결과로 위장 금지 / 쓰기 전 선행 조회 실패 시 중단 / 가드 fail-closed.
- 커밋 메시지는 한국어, "왜" 중심.
- 테스트: `npm run test -- tests/<파일>` (vitest). 로컬 `npm run build`는 `_workspace` 스크래치 때문에 실패할 수 있다(Vercel 무관) — 검증은 lint+test 로.

---

### Task 1: 마이그레이션 0076 + 롤백 + 계약 테스트

**Files:**
- Create: `supabase/migrations/0076_minute_folders_project.sql`
- Create: `supabase/migrations/0076_minute_folders_project_rollback.sql`
- Test: `tests/migrations/minute-folders-project.test.ts`

**Interfaces:**
- Produces: `minute_folders.project_id uuid null` 컬럼(null=미지정), 루트 유니크 부분 인덱스 2개(`minute_folders_root_name_null_proj_uniq`, `minute_folders_root_name_proj_uniq`), 프로젝트별 시드 루트(`created_by null` + `project_id` 설정). 이후 모든 Task 가 이 스키마를 전제.

- [ ] **Step 1: 계약 테스트 작성 (0069 전례 — SQL 텍스트 계약 테스트)**

```ts
// tests/migrations/minute-folders-project.test.ts
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(
  new URL('../../supabase/migrations/0076_minute_folders_project.sql', import.meta.url), 'utf8')
const rollback = readFileSync(
  new URL('../../supabase/migrations/0076_minute_folders_project_rollback.sql', import.meta.url), 'utf8')

describe('0076 minute_folders 프로젝트 소속 migration 계약', () => {
  it('project_id 컬럼과 스코프별 루트 유니크 인덱스를 만든다', () => {
    expect(migration).toContain('add column if not exists project_id uuid')
    expect(migration).toContain('references projects(id) on delete cascade')
    // 기존 전역 루트 유니크는 시드 삽입 전에 반드시 해체돼야 한다(프로젝트 루트가 전역 루트와 동명)
    expect(migration.indexOf('drop index if exists minute_folders_root_name_uniq'))
      .toBeLessThan(migration.indexOf('insert into minute_folders'))
    expect(migration).toContain('minute_folders_root_name_null_proj_uniq')
    expect(migration).toContain('minute_folders_root_name_proj_uniq')
  })

  it('시드는 유효 팀 마스터(프로젝트 팀 있으면 그것, 없으면 전역 활성 팀)를 따른다', () => {
    expect(migration).toMatch(/where\s+active\s+and\s+project_id\s*=\s*p\.id/)
    expect(migration).toMatch(/where\s+active\s+and\s+project_id\s+is\s+null/)
    expect(migration).toContain('not exists (select 1 from teams t2 where t2.project_id = p.id')
    // 시드 표식: created_by 미지정(null) — 0043 스쿼팅 방어 관례
    expect(migration).not.toMatch(/insert into minute_folders[^;]*created_by/s)
  })

  it('롤백은 프로젝트 루트 삭제 → 인덱스 원복 → 컬럼 drop 순서다(동명 충돌 방지)', () => {
    const delAt = rollback.indexOf('delete from minute_folders where project_id is not null')
    const uniqAt = rollback.indexOf('create unique index if not exists minute_folders_root_name_uniq')
    const dropColAt = rollback.indexOf('drop column if exists project_id')
    expect(delAt).toBeGreaterThan(-1)
    expect(uniqAt).toBeGreaterThan(delAt)
    expect(dropColAt).toBeGreaterThan(uniqAt)
  })
})
```

- [ ] **Step 2: 테스트 실행 — 실패 확인**

Run: `npm run test -- tests/migrations/minute-folders-project.test.ts`
Expected: FAIL (파일 없음 ENOENT)

- [ ] **Step 3: 마이그레이션 SQL 작성**

```sql
-- 0076: minute_folders 프로젝트 소속 재편
-- 스펙: docs/superpowers/specs/2026-08-12-minutes-project-reorg-design.md
-- 회의록 보관함 트리 최상위를 프로젝트로 나누기 위해 폴더에 project_id 를 부여한다.
-- null = 미지정 영역(기존 전역 트리가 이동 없이 그대로 미지정 트리가 된다).
-- 멱등: 반복 실행 안전. 적용: npm run db:apply (Management API, db push 금지).
-- 데이터 재편철(folder_id 백필)은 SQL 이 아니라 scripts/backfill-0076.vitest.ts —
-- 라이브 resolveFolderPath 를 재사용해 두 번째 경로 해석 구현이 생기지 않게 한다.

alter table minute_folders add column if not exists project_id uuid
  references projects(id) on delete cascade;

create index if not exists minute_folders_project_idx on minute_folders (project_id);

-- 루트 이름 유니크 재편 — 시드 삽입 **전에** 전역 유니크를 해체해야 한다.
-- 프로젝트 루트(PMO 등)가 기존 전역 루트와 동명이라 순서를 바꾸면 시드가 23505 로 전멸한다.
drop index if exists minute_folders_root_name_uniq;
create unique index if not exists minute_folders_root_name_null_proj_uniq
  on minute_folders (name) where parent_id is null and project_id is null;
create unique index if not exists minute_folders_root_name_proj_uniq
  on minute_folders (project_id, name) where parent_id is null and project_id is not null;

-- 시드: 회의록이 있는 각 프로젝트에 유효 팀 마스터의 활성 팀코드 루트 생성.
-- 유효 팀 마스터 = 프로젝트 팀 행이 있으면 그것, 없으면 전역 폴백(teamsForProjectSync 규칙과 동일).
-- created_by 는 넣지 않는다(null = 시드 표식, 0043 관례 — isTeamRootFolder 판정·스쿼팅 방어).
insert into minute_folders (name, sort, project_id)
select t.code, t.sort_order, p.id
from (select distinct project_id as id from minutes where project_id is not null) p
cross join lateral (
  select code, sort_order from teams
  where active and project_id = p.id
  union all
  select code, sort_order from teams
  where active and project_id is null
    and not exists (select 1 from teams t2 where t2.project_id = p.id)
) t
where not exists (
  select 1 from minute_folders f
  where f.parent_id is null and f.project_id = p.id and f.name = t.code
);
```

- [ ] **Step 4: 롤백 SQL 작성**

```sql
-- 0076 롤백 — 프로젝트 소속 폴더 재편 원복.
-- 순서가 중요하다: ① 프로젝트 루트 삭제(cascade 로 하위 폴더 전부 삭제,
-- minutes.folder_id 는 on delete set null 로 미분류 강등 — 본문 데이터 소실 없음)
-- ② 그 다음에야 전역 루트 유니크를 복원할 수 있다(동명 프로젝트 루트가 남아 있으면 실패)
-- ③ 컬럼 drop. 편철 위치 복원은 outputs/ 의 백필 스냅샷으로 별도 스크립트 실행.
delete from minute_folders where project_id is not null and parent_id is null;

drop index if exists minute_folders_root_name_proj_uniq;
drop index if exists minute_folders_root_name_null_proj_uniq;
create unique index if not exists minute_folders_root_name_uniq
  on minute_folders (name) where parent_id is null;

drop index if exists minute_folders_project_idx;
alter table minute_folders drop column if exists project_id;
```

- [ ] **Step 5: 테스트 실행 — 통과 확인**

Run: `npm run test -- tests/migrations/minute-folders-project.test.ts`
Expected: PASS (3건)

- [ ] **Step 6: 커밋 — SQL 만 (G1: 코드·테스트 혼합 금지)**

```bash
git add supabase/migrations/0076_minute_folders_project.sql supabase/migrations/0076_minute_folders_project_rollback.sql
git commit -m "0076: minute_folders 프로젝트 소속 — 보관함 트리를 프로젝트 축으로 나누기 위한 스키마"
```

- [ ] **Step 7: 커밋 — 계약 테스트**

```bash
git add tests/migrations/minute-folders-project.test.ts
git commit -m "0076 마이그레이션 계약 테스트 — 인덱스 해체 순서·시드 폴백 규칙 고정"
```

**주의: 이 시점에 DB 적용은 하지 않는다.** 적용은 Task 10(스테이징 리허설)에서.

---

### Task 2: 폴더 스냅샷·경로 해석 프로젝트 스코프 (`src/lib/minutes/folders.ts`)

**Files:**
- Modify: `src/lib/minutes/folders.ts`
- Test: `tests/minutes/folder-path.test.ts` (기존 파일 확장)

**Interfaces:**
- Consumes: Task 1 스키마(`minute_folders.project_id`).
- Produces (이후 Task 3~6·9 가 사용):
  - `FolderRow` 에 `projectId: string | null` 추가
  - `rootKey(projectId: string | null, name: string): string` (내부 헬퍼, `${projectId ?? '-'} ${name}`)
  - `FolderSnapshot.seedRoots` 키가 `rootKey(...)` 로 변경
  - `resolveTeamRootFolderId(sb, teamCode, projectId: string | null)` — 시그니처에 projectId 추가
  - `ensureProjectTeamRoot(sb: DbClient, projectId: string, teamCode: TeamCode): Promise<string | null>` — 신규 export. **admin(service_role) 클라이언트 필수**(created_by null 삽입은 RLS insert 정책 위반)
  - `resolveFolderPath(sb, teamCode, path, opts)` 의 `opts` 에 `projectId: string | null` **필수 필드** 추가 (컴파일 타임에 전 호출부 갱신 강제)
  - `folderPathOfSnapshot`·`ancestorIdsOf`·`normalizeFolderPath` 시그니처 무변경

- [ ] **Step 1: 실패 테스트 작성 — `tests/minutes/folder-path.test.ts` 에 describe 블록 추가**

기존 테스트의 스냅샷 픽스처 헬퍼를 확인하고(파일 상단), `projectId` 필드를 픽스처 행에 추가한 뒤 아래 케이스를 추가한다. 기존 케이스는 `projectId: null`(미지정 스코프)로 통과해야 한다.

```ts
describe('프로젝트 스코프 경로 해석 (0076)', () => {
  const P1 = 'aaaaaaaa-0000-0000-0000-000000000001'
  const rows = [
    { id: 'g-pmo', name: 'PMO', parentId: null, createdBy: null, projectId: null },
    { id: 'p1-pmo', name: 'PMO', parentId: null, createdBy: null, projectId: P1 },
    { id: 'p1-sub', name: '주간회의', parentId: 'p1-pmo', createdBy: 'u1', projectId: P1 },
  ]

  it('seedRoots 는 (projectId, 팀코드) 로 분리된다 — 동명 루트가 프로젝트별로 공존', () => {
    const snap = buildFolderSnapshot(rows)
    expect(snap.seedRoots.get(`${P1} PMO`)).toBe('p1-pmo')
    expect(snap.seedRoots.get('- PMO')).toBe('g-pmo')
  })

  it('resolveFolderPath 는 opts.projectId 트리의 루트를 쓴다', async () => {
    const snap = buildFolderSnapshot(rows)
    const res = await resolveFolderPath(fakeSb(), 'PMO', ['PMO', '주간회의'], {
      actorId: 'u1', activeTeamCodes: ['PMO'], snapshot: snap, create: false, projectId: P1,
    })
    expect(res.ok && res.folderId).toBe('p1-sub')
  })

  it('미지정(projectId null) 해석은 전역 루트를 쓴다 — 기존 동작 유지', async () => {
    const snap = buildFolderSnapshot(rows)
    const res = await resolveFolderPath(fakeSb(), 'PMO', [], {
      actorId: 'u1', activeTeamCodes: ['PMO'], snapshot: snap, create: false, projectId: null,
    })
    expect(res.ok && res.folderId).toBe('g-pmo')
  })

  it('프로젝트 루트 부재 + create 시 ensureProjectTeamRoot 로 지연 생성한다', async () => {
    // fakeSb: insert(...).select('id').single() 이 { data: { id: 'new-root' } } 를 돌려주는 스텁
    const snap = buildFolderSnapshot([rows[0]])
    const res = await resolveFolderPath(fakeSbInsertReturning('new-root'), 'PMO', ['PMO'], {
      actorId: 'u1', activeTeamCodes: ['PMO'], snapshot: snap, projectId: P1,
    })
    expect(res.ok && res.folderId).toBe('new-root')
    expect(snap.seedRoots.get(`${P1} PMO`)).toBe('new-root')  // 스냅샷에도 반영
  })

  it('프로젝트 루트 부재 + create:false 는 no_team_root — 생성하지 않는다', async () => {
    const snap = buildFolderSnapshot([rows[0]])
    const res = await resolveFolderPath(fakeSb(), 'PMO', ['PMO'], {
      actorId: 'u1', activeTeamCodes: ['PMO'], snapshot: snap, create: false, projectId: P1,
    })
    expect(!res.ok && res.kind).toBe('no_team_root')
  })
})
```

- [ ] **Step 2: 테스트 실행 — 실패 확인**

Run: `npm run test -- tests/minutes/folder-path.test.ts`
Expected: FAIL (projectId 필드 타입 에러 또는 undefined 키)

- [ ] **Step 3: 구현**

`src/lib/minutes/folders.ts` 수정 요점(전량 코드가 아니라 기존 함수에의 정확한 삽입점):

```ts
export interface FolderRow {
  id: string
  name: string
  parentId: string | null
  createdBy: string | null
  projectId: string | null   // 0076: null = 미지정 영역
}

/** seedRoots 키 — projectId 는 uuid(공백 없음), 미지정은 '-'. */
const rootKey = (projectId: string | null, name: string) => `${projectId ?? '-'} ${name}`

// addToFolderSnapshot 내부:
if (row.parentId === null) {
  if (row.createdBy === null) snap.seedRoots.set(rootKey(row.projectId, row.name), row.id)
}

// loadFolderSnapshot: select 에 project_id 추가 + 매핑
//   .select('id, name, parent_id, created_by, project_id')
//   projectId: (r.project_id as string | null) ?? null,

export async function resolveTeamRootFolderId(
  sb: DbClient, teamCode: TeamCode, projectId: string | null,
): Promise<string | null> {
  let q = sb.from('minute_folders')
    .select('id').is('parent_id', null).is('created_by', null).eq('name', teamCode)
  q = projectId ? q.eq('project_id', projectId) : q.is('project_id', null)
  const { data, error } = await q.maybeSingle()
  // 에러 처리 기존 그대로(미분류 폴백 + 로그)
}

/** 프로젝트 팀 루트 지연 보장 — 시드(created_by null) 삽입이라 **admin 클라이언트 필수**
 *  (0040 RLS insert 정책은 created_by = auth.uid() 를 요구한다). 23505 는 동시 생성 경합 —
 *  createChildFolder 와 같은 재조회 우회. 실패는 null(호출부 미분류 폴백). */
export async function ensureProjectTeamRoot(
  sb: DbClient, projectId: string, teamCode: TeamCode,
): Promise<string | null> {
  const { data, error } = await sb.from('minute_folders')
    .insert({ name: teamCode, parent_id: null, created_by: null, project_id: projectId })
    .select('id').single()
  if (!error && data) return (data as { id: string }).id
  if (error?.code === '23505') {
    const { data: raced, error: reErr } = await sb.from('minute_folders')
      .select('id').is('parent_id', null).is('created_by', null)
      .eq('name', teamCode).eq('project_id', projectId).maybeSingle()
    if (!reErr && raced) return (raced as { id: string }).id
  }
  console.error(`[minutes] 프로젝트 팀 루트 생성 실패(${teamCode}):`, error?.message ?? 'no row')
  return null
}

// createChildFolder: projectId 파라미터 추가, insert 에 project_id 포함
//   (부모와 같은 프로젝트 — 자식 project_id = 부모 project_id 불변식)
async function createChildFolder(
  sb: DbClient, parentId: string, name: string, actorId: string, projectId: string | null,
): Promise<string | null> {
  // insert({ name, parent_id: parentId, created_by: actorId, project_id: projectId })
  // 나머지 기존 그대로(23505 재조회 우회)
}

// resolveFolderPath: opts 에 projectId: string | null (필수)
//   const rootId0 = snap?.seedRoots.get(rootKey(opts.projectId, teamCode)) ?? null
//   let rootId = rootId0
//   if (!rootId && opts.projectId && opts.create !== false
//       && opts.activeTeamCodes.includes(teamCode)) {
//     rootId = await ensureProjectTeamRoot(sb, opts.projectId, teamCode)
//     if (rootId) addToFolderSnapshot(snap!, {
//       id: rootId, name: teamCode, parentId: null, createdBy: null, projectId: opts.projectId })
//   }
//   if (!rootId) return { ok: false, kind: 'no_team_root', ... }  // 기존 메시지 유지
//   루프의 createChildFolder 호출에 opts.projectId 전달
//   addToFolderSnapshot(snap!, { ..., projectId: opts.projectId })

// folderPathOf(단건 역해석)는 무변경 — 경로는 프로젝트 무관하게 id 체인으로 걷는다.
```

컴파일 에러가 나는 호출부(외부 API 라우트 2곳 등)는 **이 Task 에서는 임시로 `projectId: null` 을 명시**해 기존 동작(전역 트리)을 유지시킨다 — 실제 프로젝트 전달은 Task 6.

- [ ] **Step 4: 테스트 실행 — 전체 통과 확인**

Run: `npm run test -- tests/minutes/folder-path.test.ts tests/minutes/folder-batch.test.ts tests/minutes/external-api.test.ts`
Expected: PASS (기존 케이스는 projectId null 로 통과)

- [ ] **Step 5: 커밋**

```bash
git add src/lib/minutes/folders.ts tests/minutes/folder-path.test.ts src/app/api/v1/minutes/route.ts src/app/api/v1/minutes/folder/route.ts
git commit -m "폴더 스냅샷·경로 해석에 프로젝트 차원 추가 — 루트는 (프로젝트, 팀코드) 키 + 지연 생성"
```
(임시 `projectId: null` 을 넣은 파일이 더 있으면 파일명을 명시해 함께 스테이징)

---

### Task 3: 데이터 계층·도메인 — 폴더 project_id 노출 + 프로젝트 그룹핑

**Files:**
- Modify: `src/lib/domain/types.ts` (`MinuteFolder` 에 `projectId: string | null`)
- Modify: `src/lib/data/minutes.ts` (`getMinutesExplorer` 폴더 select + 숨김 프로젝트 폴더 필터)
- Modify: `src/app/actions/minutes.ts` 의 `loadFolders` (같은 select 확장 — 파일 내 폴더 로드 헬퍼)
- Modify: `src/lib/domain/minutes.ts` (`groupExplorerByProject` 신규)
- Test: `tests/minutes/explorer-project-groups.test.ts` (신규)

**Interfaces:**
- Consumes: `MinuteFolder`(projectId 추가), `ExplorerLeaf.projectId`(기존), `buildFolderTree`(무변경).
- Produces:
```ts
export interface ExplorerProjectGroup {
  projectId: string | null              // null = 미지정
  projectName: string | null            // 미지정이면 null — 라벨은 표시측 i18n
  folders: MinuteFolder[]
  leaves: ExplorerLeaf[]
}
export function groupExplorerByProject(
  folders: MinuteFolder[], leaves: ExplorerLeaf[],
  projects: readonly { id: string; name: string }[],
): ExplorerProjectGroup[]
```

- [ ] **Step 1: 실패 테스트 작성**

```ts
// tests/minutes/explorer-project-groups.test.ts
import { describe, expect, it } from 'vitest'
import { groupExplorerByProject } from '@/lib/domain/minutes'
import type { ExplorerLeaf, MinuteFolder } from '@/lib/domain/types'

const P1 = 'aaaaaaaa-0000-0000-0000-000000000001'
const P2 = 'aaaaaaaa-0000-0000-0000-000000000002'
const folder = (id: string, projectId: string | null, parentId: string | null = null): MinuteFolder =>
  ({ id, name: id, parentId, sort: 100, createdBy: null, projectId })
const leaf = (id: string, projectId: string | null, folderId: string | null): ExplorerLeaf =>
  ({ id, minuteDate: '2026-08-12', teamCode: 'PMO', title: id, fileCount: 0, createdBy: null,
     createdByName: null, bodyPreview: '', meetingCategory: null, folderId, projectId })

describe('groupExplorerByProject', () => {
  it('projects 인자 순서대로 그룹을 만들고 미지정을 마지막에 둔다', () => {
    const groups = groupExplorerByProject(
      [folder('f1', P1), folder('f2', P2), folder('g1', null)],
      [leaf('m1', P1, 'f1'), leaf('m0', null, 'g1')],
      [{ id: P2, name: '둘' }, { id: P1, name: '하나' }],
    )
    expect(groups.map(g => g.projectId)).toEqual([P2, P1, null])
    expect(groups[2].leaves.map(l => l.id)).toEqual(['m0'])
  })

  it('폴더도 리프도 없는 프로젝트는 그룹을 만들지 않는다', () => {
    const groups = groupExplorerByProject([], [leaf('m1', P1, null)],
      [{ id: P1, name: '하나' }, { id: P2, name: '둘' }])
    expect(groups.map(g => g.projectId)).toEqual([P1])   // P2·미지정 없음
  })

  it('projects 목록에 없는 projectId 리프(숨김 아님·명단 밖)는 미지정이 아니라 자기 그룹으로 남긴다', () => {
    // listProjects 실패·부분 응답 시 남의 그룹에 섞이는 것 방지 — 이름 없이 id 그룹 유지
    const groups = groupExplorerByProject([], [leaf('m1', P1, null)], [])
    expect(groups[0].projectId).toBe(P1)
    expect(groups[0].projectName).toBeNull()
  })

  it('리프의 폴더가 다른 그룹 소속이면 그 그룹 folders 에 없다 — buildFolderTree 가 unfiled 로 수용', () => {
    const groups = groupExplorerByProject([folder('f1', P1)], [leaf('m1', P2, 'f1')],
      [{ id: P1, name: '하나' }, { id: P2, name: '둘' }])
    const g2 = groups.find(g => g.projectId === P2)!
    expect(g2.folders).toEqual([])
    expect(g2.leaves.map(l => l.id)).toEqual(['m1'])
  })
})
```

- [ ] **Step 2: 테스트 실행 — 실패 확인**

Run: `npm run test -- tests/minutes/explorer-project-groups.test.ts`
Expected: FAIL (groupExplorerByProject not exported)

- [ ] **Step 3: 구현**

`src/lib/domain/types.ts` — `MinuteFolder` 에 `projectId: string | null` 추가.

`src/lib/domain/minutes.ts` — `buildFolderTree` 바로 아래에:

```ts
/** 탐색기 최상위 프로젝트 그룹핑(0076). projects 순서 유지(호출부가 내 프로젝트 우선으로
 *  정렬해 넘긴다) → 명단 밖 projectId 그룹(이름 미상 — listProjects 실패·부분 응답 방어,
 *  남의 그룹에 섞지 않는다) → 미지정(null) 마지막. 폴더도 리프도 없는 그룹은 내지 않는다. */
export function groupExplorerByProject(
  folders: MinuteFolder[], leaves: ExplorerLeaf[],
  projects: readonly { id: string; name: string }[],
): ExplorerProjectGroup[] {
  const byProject = new Map<string | null, ExplorerProjectGroup>()
  const ensure = (projectId: string | null, projectName: string | null) => {
    let g = byProject.get(projectId)
    if (!g) { g = { projectId, projectName, folders: [], leaves: [] }; byProject.set(projectId, g) }
    return g
  }
  for (const f of folders) ensure(f.projectId, null).folders.push(f)
  for (const l of leaves) ensure(l.projectId ?? null, null).leaves.push(l)
  const known = new Map(projects.map(p => [p.id, p.name]))
  const ordered: ExplorerProjectGroup[] = []
  for (const p of projects) {
    const g = byProject.get(p.id)
    if (g) { g.projectName = p.name; ordered.push(g); byProject.delete(p.id) }
  }
  for (const [pid, g] of byProject) {
    if (pid === null) continue
    g.projectName = known.get(pid) ?? null
    ordered.push(g)
  }
  const unassigned = byProject.get(null)
  if (unassigned) ordered.push(unassigned)
  return ordered
}
```

`src/lib/data/minutes.ts` `getMinutesExplorer` —
- 폴더 select 에 `project_id` 추가, 매핑에 `projectId` 추가.
- **숨김 프로젝트의 폴더 제거**: `folders.filter(f => f.projectId === null || !hidden.has(f.projectId))` — 리프는 이미 `dropHidden` 이 거른다. 폴더만 남기면 비공개 프로젝트 이름이 폴더 트리로 노출된다.

`src/app/actions/minutes.ts` `loadFolders` — select 에 `project_id` 추가 + 매핑(그렇지 않으면 `MinuteFolder.projectId` 가 undefined 로 흘러 가드가 오판한다).

- [ ] **Step 4: 테스트 실행 — 통과 + 회귀 확인**

Run: `npm run test -- tests/minutes/ && npm run lint`
Expected: PASS (MinuteFolder 픽스처를 쓰는 기존 테스트에 `projectId: null` 추가 필요할 수 있음 — 기계적 수정)

- [ ] **Step 5: 커밋**

```bash
git add src/lib/domain/types.ts src/lib/domain/minutes.ts src/lib/data/minutes.ts src/app/actions/minutes.ts tests/minutes/explorer-project-groups.test.ts
git commit -m "탐색기 프로젝트 그룹핑 — 폴더 project_id 노출 + 숨김 프로젝트 폴더 차단"
```
(픽스처 수정한 테스트 파일이 있으면 함께 명시 스테이징)

---

### Task 4: 폴더 CRUD 액션 — 프로젝트 전파·멤버 가드·교차 이동 차단

**Files:**
- Modify: `src/app/actions/minutes.ts` (`createMinuteFolder`, `renameMinuteFolder`, `deleteMinuteFolder`, `moveMinuteFolder`, `moveMinuteToFolder`)
- Modify: `src/lib/domain/minutes-drop.ts` (`resolveFolderDrop` 에 교차 프로젝트 거부)
- Test: `tests/minutes/folders-action.test.ts` (기존 확장)

**Interfaces:**
- Consumes: `MinuteFolder.projectId`(Task 3), `isProjectMember`(기존 `@/lib/domain/authz`).
- Produces: 서버 액션 시그니처 무변경(폴더의 프로젝트는 부모/대상에서 파생 — 클라이언트가 프로젝트를 보내지 않는다, 위조 불가). `resolveFolderDrop` 거부 사유에 `'cross-project'` 추가.

- [ ] **Step 1: 실패 테스트 작성 — 기존 folders-action.test.ts 의 모킹 관례를 따라 추가**

검증할 규칙(각각 1케이스):
1. `createMinuteFolder`: 프로젝트 폴더(부모.projectId ≠ null) 아래 생성 시 비멤버는 `'권한 없음'`, 멤버는 insert payload 에 `project_id = 부모.projectId` 포함.
2. `renameMinuteFolder`/`deleteMinuteFolder`: 대상이 프로젝트 폴더면 비멤버 거부(미지정 폴더는 기존 규칙 그대로 통과).
3. `moveMinuteFolder`: 프로젝트가 다른 부모로 이동 시 `'다른 프로젝트 폴더로는 이동할 수 없습니다.'` 거부.
4. `moveMinuteToFolder`: 회의록 project_id 와 대상 폴더 projectId 불일치 시 같은 문구로 거부(미분류 회의록 → 미지정 폴더만, 프로젝트 회의록 → 그 프로젝트 폴더만).

```ts
// resolveFolderDrop 단위 케이스 (minutes-drop 테스트가 별도 파일이면 그쪽에)
it('교차 프로젝트 드롭은 cross-project 로 거부한다', () => {
  const target = { id: 'f1', name: 'a', parentId: 'p1-root', sort: 100, createdBy: 'u1', projectId: P1 }
  const newParent = { id: 'g-root', name: 'PMO', parentId: null, sort: 0, createdBy: null, projectId: null }
  const verdict = resolveFolderDrop(target, 'g-root', [target, newParent], ['PMO'])
  expect(verdict).toEqual({ kind: 'reject', reason: 'cross-project' })
})
```

- [ ] **Step 2: 테스트 실행 — 실패 확인**

Run: `npm run test -- tests/minutes/folders-action.test.ts`
Expected: FAIL

- [ ] **Step 3: 구현**

- `createMinuteFolder`: `parentId` 는 이미 필수(W18 — 루트 생성 금지라 프로젝트 루트 신설 경로 없음). 부모 조회 후:
  ```ts
  const parent = folders.find(f => f.id === parentId)   // 기존 존재 확인을 find 로 바꿔 재사용
  if (parent?.projectId && !isProjectMember(g.actor, parent.projectId)) {
    return { ok: false, error: '권한 없음' }
  }
  // insert 에 project_id: parent?.projectId ?? null 추가 — 자식=부모 프로젝트 불변식
  ```
- `renameMinuteFolder`·`deleteMinuteFolder`: `target.projectId && !isProjectMember(g.actor, target.projectId)` 면 거부. rename 은 현재 `getSession` 만 쓰므로 `requireActor` 로 바꿔 actor 를 얻는다(기존 RLS 0행 검사도 유지 — 이중 방어).
- `moveMinuteFolder`: `resolveFolderDrop` 호출 전 단계는 그대로 두고, `minutes-drop.ts` 의 `resolveFolderDrop` 에 규칙 추가:
  ```ts
  // 새 부모(null=루트는 target 유지 스코프)와 프로젝트가 다르면 거부 — 폴더 서브트리가
  // 통째로 남의 프로젝트 트리에 붙는 것을 막는다. 프로젝트 간 이동은 회의록 단위로만.
  const parentProject = newParentId === null
    ? target.projectId    // 루트로의 이동은 자기 스코프 루트 — 프로젝트 불변
    : (folders.find(f => f.id === newParentId)?.projectId ?? null)
  if (parentProject !== target.projectId) return { kind: 'reject', reason: 'cross-project' }
  ```
  `MinuteDropReject` 유니언에 `'cross-project'` 추가, `FOLDER_MOVE_REJECT_MSG`(actions)와 클라이언트 토스트 사전(`MinutesExplorer.tsx` 의 사유→문구 맵, 58행 부근)에 `'cross-project': '다른 프로젝트 폴더로는 이동할 수 없습니다.'`(i18n 키 추가) 등록.
- `moveMinuteToFolder`: 대상 폴더가 있을 때 회의록 조회에 `project_id` 를 포함시키고:
  ```ts
  if ((folder.projectId ?? null) !== (minute.project_id ?? null)) {
    return { ok: false, error: '다른 프로젝트 폴더로는 이동할 수 없습니다.' }
  }
  ```

- [ ] **Step 4: 테스트 실행 — 통과 확인**

Run: `npm run test -- tests/minutes/folders-action.test.ts tests/minutes/`
Expected: PASS

- [ ] **Step 5: 커밋**

```bash
git add src/app/actions/minutes.ts src/lib/domain/minutes-drop.ts src/components/minutes/MinutesExplorer.tsx tests/minutes/folders-action.test.ts
git commit -m "폴더 CRUD 프로젝트 가드 — 자식=부모 프로젝트 불변식 + 교차 프로젝트 이동 차단"
```

---

### Task 5: 프로젝트 변경 시 자동 재편철

**Files:**
- Modify: `src/lib/minutes/folders.ts` (`refileMinuteAfterProjectChange` 신규)
- Modify: `src/app/actions/minutes.ts` (`updateMinuteMeta`, `assignMinutesProject` 통합)
- Test: `tests/minutes/refile-on-project-change.test.ts` (신규)

**Interfaces:**
- Consumes: Task 2 의 `resolveFolderPath`(projectId), `folderPathOfSnapshot`, `loadFolderSnapshot`.
- Produces:
```ts
/** 프로젝트 이동 후 폴더 추종 — 같은 경로를 새 프로젝트 트리에 확보해 folder_id 만 바꾼다.
 *  실패해도 프로젝트 이동 자체를 되돌리지 않는다(편철은 등록·이동을 막지 않는다). */
export async function refileMinuteAfterProjectChange(
  admin: DbClient,
  args: {
    minuteId: string
    teamCode: TeamCode
    oldFolderId: string | null
    newProjectId: string | null
    actorId: string
    activeTeamCodes: readonly string[]
  },
): Promise<void>
```

- [ ] **Step 1: 실패 테스트 작성**

```ts
// tests/minutes/refile-on-project-change.test.ts — folder-path.test.ts 의 스텁 관례 재사용
describe('refileMinuteAfterProjectChange', () => {
  it('기존 경로를 새 프로젝트 트리에 만들어 folder_id 를 옮긴다', async () => {
    // 스냅샷: 전역 PMO/주간회의 + P1 PMO 루트. old = 전역 주간회의.
    // 기대: P1 트리에 주간회의 생성(insert) 후 minutes.update({ folder_id: 생성된 id })
  })
  it('미분류(oldFolderId null)는 재편철하지 않는다 — 미분류 유지', async () => {
    // 기대: minutes.update 호출 0회
  })
  it('경로 확보 실패(no_team_root — 비활성 팀 등)면 미분류로 강등하고 로그만 남긴다', async () => {
    // 기대: minutes.update({ folder_id: null })
  })
})
```

- [ ] **Step 2: 테스트 실행 — 실패 확인**

Run: `npm run test -- tests/minutes/refile-on-project-change.test.ts`
Expected: FAIL

- [ ] **Step 3: 구현**

```ts
export async function refileMinuteAfterProjectChange(
  admin: DbClient, args: { /* 위 시그니처 */ },
): Promise<void> {
  if (!args.oldFolderId) return                       // 미분류는 미분류로 남긴다(추측 금지)
  const snap = await loadFolderSnapshot(admin)
  if (!snap) return                                    // 실패 로그는 loadFolderSnapshot 이 남김
  const oldPath = folderPathOfSnapshot(snap, args.oldFolderId)
  if (!oldPath) return                                 // 끊긴 체인 — 건드리지 않는다
  const res = await resolveFolderPath(admin, args.teamCode, oldPath, {
    actorId: args.actorId, activeTeamCodes: args.activeTeamCodes,
    snapshot: snap, projectId: args.newProjectId,
  })
  const folderId = res.ok ? res.folderId : null        // no_team_root → 미분류 강등
  // updated_at 무접촉 — 편철 정리가 외부 연동 GET 에 '방금 수정됨'으로 비치면 안 된다(0043 규칙)
  const { error } = await admin.from('minutes').update({ folder_id: folderId }).eq('id', args.minuteId)
  if (error) console.error('[minutes] 프로젝트 이동 재편철 실패:', args.minuteId, error.message)
}
```

`updateMinuteMeta` 통합 — RPC 성공 후 `projectChanged` 분기에서(위키 rebuild `after()` 앞에, 동기로):
```ts
if (projectChanged) {
  // folderId 명시 이동(사용자가 폴더를 직접 골랐다)이면 그 선택이 우선 — 재편철하지 않는다
  if (folderId === undefined) {
    const { data: cur } = await admin.from('minutes').select('folder_id').eq('id', id).maybeSingle()
    await refileMinuteAfterProjectChange(admin, {
      minuteId: id, teamCode: effectiveTeam,
      oldFolderId: (cur?.folder_id as string | null) ?? null,
      newProjectId: updateResult.new_project_id,
      actorId: g.actor.userId,
      activeTeamCodes: updateResult.new_project_id
        ? activeTeamCodesForProjectSync(updateResult.new_project_id)
        : activeTeamCodesSync(),
    })
  }
}
```
주의: RPC 는 folder_id 를 바꾸지 않았으므로(무접촉 케이스) 현재 folder_id = 기존 folder_id 다. `activeTeamCodesForProjectSync` 는 `@/lib/teams/master` 에서 import(이 파일은 이미 `activeTeamCodesSync` 를 쓴다 — 캐시 워밍 동일).

`assignMinutesProject` 통합 — 건별 RPC 성공 직후:
```ts
await refileMinuteAfterProjectChange(admin, {
  minuteId: id, teamCode: /* 선행조회 rows 에 team_code 추가해 확보 */,
  oldFolderId: /* 선행조회 rows 에 folder_id 추가해 확보 */,
  newProjectId: projectId, actorId: g.actor.userId,
  activeTeamCodes: projectId ? activeTeamCodesForProjectSync(projectId) : activeTeamCodesSync(),
})
```
선행조회 select 를 `'id, created_by, archived_at, project_id, meeting_id, team_code, folder_id'` 로 확장. 스냅샷을 건별로 다시 읽지 않도록 `loadFolderSnapshot` 1회 후 `refileMinuteAfterProjectChange` 에 snapshot 을 넘기는 오버로드(옵션 `snapshot?: FolderSnapshot`)를 추가해도 좋다 — 200건 상한이라 필수는 아니고, 하면 인자에 추가.

- [ ] **Step 4: 테스트 실행 — 통과 + 관련 회귀**

Run: `npm run test -- tests/minutes/refile-on-project-change.test.ts tests/minutes/assign-project.test.ts`
Expected: PASS (assign-project 기존 케이스는 refile 호출 모킹 추가 필요할 수 있음)

- [ ] **Step 5: 커밋**

```bash
git add src/lib/minutes/folders.ts src/app/actions/minutes.ts tests/minutes/refile-on-project-change.test.ts tests/minutes/assign-project.test.ts
git commit -m "프로젝트 이동 시 폴더 자동 재편철 — 같은 경로를 새 트리에 확보, 실패는 미분류 강등"
```

---

### Task 6: 또박또박 외부 API — 경로 해석을 프로젝트 트리로

**Files:**
- Modify: `src/app/api/v1/minutes/route.ts`
- Modify: `src/app/api/v1/minutes/folder/route.ts`
- Test: `tests/minutes/external-api.test.ts`, `tests/minutes/folder-batch.test.ts` (기존 확장)

**Interfaces:**
- Consumes: Task 2 시그니처(`resolveFolderPath` opts.projectId, `resolveTeamRootFolderId(sb, team, projectId)`), Task 5 의 `refileMinuteAfterProjectChange`.
- Produces: 외부 계약 무변경. 내부적으로 편철 기준 트리만 프로젝트 스코프.

- [ ] **Step 1: 실패 테스트 작성 (기존 두 테스트 파일의 모킹 관례로)**

케이스:
1. POST /minutes 신규 등록 + meetingId 연결(프로젝트 P): `resolveFolderPath` 가 `projectId: P` 로 불린다.
2. POST /minutes 신규 등록 + 회의 미연결: `projectId: null`(미지정 트리 편철 — 기존 동작).
3. folder_path 미전송 폴백 루트: `resolveTeamRootFolderId(admin, team, P)` 로 프로젝트 루트.
4. 재전송(external_id 기존)으로 **회의 연결이 바뀌어 프로젝트가 바뀌는** 경우: `refileMinuteAfterProjectChange` 호출(기존 `teamMovedFolderId` 로직과의 관계는 Step 3 참조).
5. 배치 재편철(folder/route.ts): 항목별 회의록의 project_id 스코프로 해석 — P1 회의록의 folder_path 는 P1 트리에서 dry-run/적용.

- [ ] **Step 2: 테스트 실행 — 실패 확인**

Run: `npm run test -- tests/minutes/external-api.test.ts tests/minutes/folder-batch.test.ts`
Expected: FAIL

- [ ] **Step 3: 구현**

`route.ts` (POST 등록/재전송):
- 등록·재전송 흐름에서 **프로젝트 확정(meetingProjectId 판별, 371~401행 부근)을 편철 해석보다 앞으로** 옮기거나, 편철 해석을 프로젝트 확정 후로 미룬다. 그 확정값을 `targetProjectId` 로:
  - 96행 `resolveFolderPath(admin, p.teamCode, p.folderPath, { actorId, activeTeamCodes: ..., projectId: targetProjectId })`
  - 166행(팀 변경 시 팀 루트 폴백)·274행(folder_path 미전송 폴백): `resolveTeamRootFolderId(admin, p.teamCode, targetProjectId)`
  - `activeTeamCodes`: `targetProjectId ? activeTeamCodesForProjectSync(targetProjectId) : activeTeamCodesSync()`
- 재전송으로 `projectChanged` 인데 folder_path 를 이번에 안 보낸 경우: 기존 위치 유지 로직 대신 `refileMinuteAfterProjectChange` 로 새 트리에 추종(147행 부근 "folder_id 키를 넣지 않는다" 주석 블록과 충돌하지 않게 — RPC 무접촉은 유지하고 커밋 후 재편철).
- 프로젝트 루트 지연 생성은 admin 클라이언트라 그대로 동작(Task 2 의 ensureProjectTeamRoot).

`folder/route.ts` (배치):
- 항목 대상 회의록 조회에 `project_id` 포함(이미 MINUTE_SELECT 에 있다면 재사용).
- 177행(dry-run)·216행(적용) `resolveFolderPath` 에 `projectId: 그 회의록의 project_id`, `activeTeamCodes` 도 항목 프로젝트 스코프로.
- 스냅샷은 배치 전체 1회 로드 그대로(seedRoots 키가 프로젝트 차원을 갖게 됐으므로 공유 가능).

- [ ] **Step 4: 테스트 실행 — 통과 확인**

Run: `npm run test -- tests/minutes/external-api.test.ts tests/minutes/folder-batch.test.ts tests/minutes/folder-path.test.ts`
Expected: PASS

- [ ] **Step 5: 커밋**

```bash
git add src/app/api/v1/minutes/route.ts src/app/api/v1/minutes/folder/route.ts tests/minutes/external-api.test.ts tests/minutes/folder-batch.test.ts
git commit -m "또박또박 편철을 프로젝트 트리 기준으로 — 계약 무변경, 해석 기준만 회의록 프로젝트"
```

---

### Task 7: 탐색기 UI — 프로젝트 최상위 노드 + 모달 프로젝트 스코프

**Files:**
- Modify: `src/components/minutes/MinutesExplorer.tsx`
- Modify: `src/components/minutes/MinutesView.tsx` (그룹핑 호출·props 전달)
- Modify: `src/components/minutes/FolderPickModal.tsx`, `src/components/minutes/FolderManageModal.tsx`, `src/components/minutes/MinuteUploadModal.tsx`, `src/components/minutes/MinuteMetaModal.tsx` (폴더 목록을 프로젝트 스코프로 필터)
- Modify: `src/lib/i18n/dict.ts` (신규 라벨: 미지정 그룹, cross-project 거부 문구)
- Test: `tests/minutes/explorer-project-groups.test.ts` (Task 3 에서 작성 — UI 는 수동 검증 항목)

**Interfaces:**
- Consumes: `groupExplorerByProject`(Task 3), `buildFolderTree`(무변경), `sortMyProjectsFirst`(기존 `@/lib/domain/projectPick`).

- [ ] **Step 1: MinutesExplorer 트리 렌더 재구성**

`MinutesExplorer.tsx` 134행 부근의 단일 `buildFolderTree` 호출을 그룹 기반으로:

```tsx
const orderedProjects = useMemo(
  () => sortMyProjectsFirst(projects, myProjectIds), [projects, myProjectIds])
const groups = useMemo(
  () => groupExplorerByProject(folders, leaves, orderedProjects),
  [folders, leaves, orderedProjects])
const trees = useMemo(
  () => groups.map(g => ({ group: g, ...buildFolderTree(g.folders, g.leaves) })),
  [groups])
```

렌더(478행 부근 `{roots.map(...)}` 자리):
```tsx
{trees.map(({ group, roots, unfiled }) => (
  <div key={group.projectId ?? 'unassigned'}>
    {/* 프로젝트 헤더 행 — 기존 폴더 행과 같은 row 스타일, 아이콘만 구분(FolderKanban 등) */}
    {/* 라벨: group.projectName ?? (group.projectId ? t('min.grp.unknownProject') : t('min.grp.unassigned')) */}
    {/* 접기 상태는 프로젝트 id 키로 기존 접기 상태 관리에 합류 */}
    {roots.map(r => folderRow(r, 1))}
    {/* 그룹 내 unfiled 리프는 기존 '미분류' 섹션 UI 를 그룹 하위에 재사용 */}
  </div>
))}
```
기존 전역 '미분류(unfiled)' 표시는 그룹별 unfiled 로 대체된다. 접기 기본값: 내 프로젝트 그룹 펼침, 그 외 접힘.

- [ ] **Step 2: 모달 프로젝트 스코프**

- `FolderPickModal`·`FolderManageModal`: props 에 `scopeProjectId: string | null` 추가, 내부에서 `folders.filter(f => (f.projectId ?? null) === scopeProjectId)` 후 기존 로직(teamRootFolderIdOf 등은 필터된 목록 위에서 그대로 동작).
- `MinuteUploadModal`·`MinuteMetaModal`: 선택된 프로젝트(projectId 셀렉트 값)를 `scopeProjectId` 로 전달 — 프로젝트를 바꾸면 폴더 선택이 그 프로젝트 트리로 바뀐다. 선택 폴더가 스코프 밖이 되면 선택 해제(미분류).
- 챗 폴더 칩(`ArchiveChatPanel` 계열)이 쓰는 폴더 픽커에는 그룹 라벨(프로젝트명)만 추가 — 동작(folder_id 필터)은 무변경.

- [ ] **Step 3: 검증 — lint + 전체 테스트 + 로컬 화면**

Run: `npm run lint && npm run test`
Expected: PASS

Run: `npm run dev` (스테이징 DB — 0076 미적용 상태면 폴더 projectId 가 전부 null 로 내려와 미지정 그룹 하나만 보이는 것이 정상. UI 스모크는 Task 10 스테이징 적용 후 재확인)
Expected: 콘솔 에러 없음, 트리 렌더 정상

- [ ] **Step 4: 커밋**

```bash
git add src/components/minutes/MinutesExplorer.tsx src/components/minutes/MinutesView.tsx src/components/minutes/FolderPickModal.tsx src/components/minutes/FolderManageModal.tsx src/components/minutes/MinuteUploadModal.tsx src/components/minutes/MinuteMetaModal.tsx src/lib/i18n/dict.ts
git commit -m "탐색기 최상위를 프로젝트 노드로 — 그룹별 트리 + 모달 폴더 프로젝트 스코프"
```

---

### Task 8: 나의 회의 — 프로젝트 필터 칩 + 색상

**Files:**
- Create: `src/lib/domain/projectColors.ts`
- Modify: `src/components/meetings/MyMeetingsView.tsx`
- Modify: `src/components/meetings/MeetingCalendar.tsx` (회차 pill 에 프로젝트 색점)
- Test: `tests/lib/project-colors.test.ts` (신규)

**Interfaces:**
- Produces:
```ts
/** 프로젝트 id → 결정적 색 클래스. 정렬된 프로젝트 id 목록 기준 인덱스 순환 —
 *  같은 데이터면 세션·리렌더와 무관하게 같은 색. */
export const PROJECT_DOT_CLASSES = [
  'bg-sky-500', 'bg-violet-500', 'bg-emerald-500', 'bg-amber-500', 'bg-rose-500', 'bg-cyan-500',
] as const
export function projectColorClass(projectIds: readonly string[], projectId: string): string
```

- [ ] **Step 1: 실패 테스트 작성**

```ts
// tests/lib/project-colors.test.ts
import { describe, expect, it } from 'vitest'
import { PROJECT_DOT_CLASSES, projectColorClass } from '@/lib/domain/projectColors'

describe('projectColorClass', () => {
  const ids = ['b', 'a', 'c']
  it('정렬 기준 인덱스로 결정적이다 — 입력 순서와 무관', () => {
    expect(projectColorClass(ids, 'a')).toBe(PROJECT_DOT_CLASSES[0])
    expect(projectColorClass(['a', 'b', 'c'], 'a')).toBe(PROJECT_DOT_CLASSES[0])
    expect(projectColorClass(ids, 'b')).toBe(PROJECT_DOT_CLASSES[1])
  })
  it('팔레트 초과는 순환한다', () => {
    const many = Array.from({ length: 8 }, (_, i) => `p${i}`)
    expect(projectColorClass(many, 'p6')).toBe(PROJECT_DOT_CLASSES[6 % PROJECT_DOT_CLASSES.length])
  })
  it('목록 밖 id 는 첫 색으로 폴백한다(크래시 금지)', () => {
    expect(projectColorClass(ids, 'zzz')).toBe(PROJECT_DOT_CLASSES[0])
  })
})
```

- [ ] **Step 2: 테스트 실행 — 실패 확인**

Run: `npm run test -- tests/lib/project-colors.test.ts`
Expected: FAIL

- [ ] **Step 3: 구현**

```ts
// src/lib/domain/projectColors.ts
export function projectColorClass(projectIds: readonly string[], projectId: string): string {
  const sorted = [...projectIds].sort()
  const idx = sorted.indexOf(projectId)
  return PROJECT_DOT_CLASSES[(idx < 0 ? 0 : idx) % PROJECT_DOT_CLASSES.length]
}
```

`MyMeetingsView.tsx`:
- 파생값: `const projectOptions = useMemo(() => { /* data.meetings 에서 (projectId, projectName) 유니크, 이름 ko 정렬 */ }, [data.meetings])`
- 상태: `const [projectFilter, setProjectFilter] = useState<string | null>(null)` (저장 안 함 — 스펙 §5)
- 필터 적용: `expandMeetings(...)` 에 넣는 meetings 를 `projectFilter ? ms.filter(m => m.projectId === projectFilter) : ms` 로 감싼다(달력·리스트 뷰 공통 경로에서 한 번).
- 칩 UI: 기존 SegmentedTabs 가 아니라 가로 스크롤 칩 행(챗 폴더 칩과 같은 관용구) — `전체` + 프로젝트별. 각 칩 앞에 `<span className={"inline-block size-2 rounded-full " + projectColorClass(allIds, p.id)} />`.
- 프로젝트가 1개 이하면 칩 행을 렌더하지 않는다(노이즈 금지).

`MeetingCalendar.tsx` 25행 부근 pill 렌더: `projectDotClass?: (projectId: string) => string | null` optional prop 추가 — 내 회의 뷰에서만 내려주고, 있으면 pill 제목 앞에 색점 렌더. 프로젝트별 달력(`/p/[id]/meetings`)은 prop 미전달로 무변경.

- [ ] **Step 4: 테스트 실행 + lint**

Run: `npm run test -- tests/lib/project-colors.test.ts && npm run lint`
Expected: PASS

- [ ] **Step 5: 커밋**

```bash
git add src/lib/domain/projectColors.ts src/components/meetings/MyMeetingsView.tsx src/components/meetings/MeetingCalendar.tsx tests/lib/project-colors.test.ts
git commit -m "나의 회의 프로젝트 필터 칩 + 결정적 프로젝트 색점 — 달력 하나 유지"
```

---

### Task 9: 백필 러너 — 기존 편철을 프로젝트 트리로 이식

**Files:**
- Create: `scripts/backfill-0076.vitest.ts` (wiki-rebuild.vitest.ts 전례 — vitest 로 구동하는 TS 러너, 라이브 `resolveFolderPath` 재사용)
- Modify: `package.json` (스크립트 등록)

**Interfaces:**
- Consumes: Task 2 의 `resolveFolderPath`·`loadFolderSnapshot`·`folderPathOfSnapshot`·`buildFolderSnapshot`.
- Produces: `outputs/0076-folder-backfill-<target>.json` — `[{ minuteId, oldFolderId, newFolderId }]` (롤백 복원용 스냅샷).

- [ ] **Step 1: 러너 작성**

```ts
// scripts/backfill-0076.vitest.ts
// 실행(dry-run):  BACKFILL_TARGET=staging npx vitest run scripts/backfill-0076.vitest.ts --reporter=verbose
// 실행(적용):     BACKFILL_TARGET=staging BACKFILL_APPLY=1 npx vitest run scripts/backfill-0076.vitest.ts --reporter=verbose
// TARGET=prod 는 스테이징 검증 완료 후에만. 환경키는 .env.local.<target> 에서 읽는다.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
import { describe, expect, it } from 'vitest'
import {
  folderPathOfSnapshot, loadFolderSnapshot, resolveFolderPath,
} from '@/lib/minutes/folders'

function envOf(target: string): { url: string; key: string } {
  const raw = readFileSync(new URL(`../.env.local.${target}`, import.meta.url), 'utf8')
  const pick = (k: string) => raw.match(new RegExp(`^${k}=(.+)$`, 'm'))?.[1]?.trim()
  const url = pick('NEXT_PUBLIC_SUPABASE_URL'); const key = pick('SUPABASE_SERVICE_ROLE_KEY') ?? pick('SUPABASE_SERVICE_ROLE')
  if (!url || !key) throw new Error(`.env.local.${target} 에서 URL/서비스키를 찾지 못했습니다`)
  return { url, key }
}

describe('0076 폴더 백필', () => {
  it('프로젝트 있는 회의록의 편철을 프로젝트 트리로 이식한다', async () => {
    const target = process.env.BACKFILL_TARGET
    if (!target) { console.log('BACKFILL_TARGET 미지정 — skip'); return }
    const apply = process.env.BACKFILL_APPLY === '1'
    const { url, key } = envOf(target)
    const admin = createClient(url, key, { auth: { persistSession: false } })

    // 유효 팀 마스터 — teamsForProjectSync 와 같은 규칙을 이 자리에서 계산(서버 캐시 밖이므로)
    const { data: teamRows, error: tErr } = await admin.from('teams')
      .select('code, project_id, active').eq('active', true)
    expect(tErr).toBeNull()
    const activeCodesFor = (pid: string): string[] => {
      const own = (teamRows ?? []).filter(t => t.project_id === pid).map(t => t.code as string)
      return own.length > 0 ? own
        : (teamRows ?? []).filter(t => t.project_id === null).map(t => t.code as string)
    }

    const snap = await loadFolderSnapshot(admin as never)
    expect(snap).not.toBeNull()
    const { data: minutes, error: mErr } = await admin.from('minutes')
      .select('id, team_code, project_id, folder_id')
      .not('project_id', 'is', null)
    expect(mErr).toBeNull()

    const log: { minuteId: string; oldFolderId: string | null; newFolderId: string | null }[] = []
    let moved = 0, unfiled = 0, kept = 0
    for (const m of minutes ?? []) {
      const oldFolderId = (m.folder_id as string | null) ?? null
      if (!oldFolderId) { kept += 1; continue }                    // 미분류는 미분류 유지
      const oldRow = snap!.byId.get(oldFolderId)
      if (oldRow && oldRow.projectId === m.project_id) { kept += 1; continue }  // 이미 이식됨(재실행 멱등)
      const path = folderPathOfSnapshot(snap!, oldFolderId)
      let newFolderId: string | null = null
      if (path) {
        const res = await resolveFolderPath(admin as never, m.team_code as never, path, {
          actorId: 'backfill-0076', activeTeamCodes: activeCodesFor(m.project_id as string),
          snapshot: snap!, projectId: m.project_id as string, create: apply,
        })
        newFolderId = res.ok && (apply ? true : res.complete) ? res.folderId : null
      }
      log.push({ minuteId: m.id as string, oldFolderId, newFolderId })
      if (newFolderId === null) unfiled += 1; else moved += 1
      if (apply) {
        const { error } = await admin.from('minutes')
          .update({ folder_id: newFolderId }).eq('id', m.id)
        expect(error).toBeNull()
      }
    }
    mkdirSync(new URL('../outputs', import.meta.url), { recursive: true })
    writeFileSync(new URL(`../outputs/0076-folder-backfill-${target}.json`, import.meta.url),
      JSON.stringify({ apply, movedCount: moved, unfiledCount: unfiled, keptCount: kept, log }, null, 2))
    console.log(`[0076 backfill] target=${target} apply=${apply} moved=${moved} unfiled=${unfiled} kept=${kept}`)

    if (apply) {
      // VERIFY: 프로젝트 있는 회의록의 폴더는 같은 프로젝트 소속이어야 한다(불변식)
      const snap2 = await loadFolderSnapshot(admin as never)
      const { data: after } = await admin.from('minutes')
        .select('id, project_id, folder_id').not('project_id', 'is', null)
      const violations = (after ?? []).filter(m =>
        m.folder_id && snap2!.byId.get(m.folder_id as string)?.projectId !== m.project_id)
      expect(violations).toEqual([])
    }
  }, 120_000)
})
```

주의:
- `actorId: 'backfill-0076'` 는 uuid 가 아니다 — `createChildFolder` 의 `created_by` 는 `auth.users` FK 라 실패한다. **dry-run 확인 후 적용 시에는 실제 운영자 uuid 를 `BACKFILL_ACTOR` env 로 받아 쓰도록** 위 코드의 actorId 를 `process.env.BACKFILL_ACTOR ?? (() => { throw new Error('BACKFILL_ACTOR 필요') })()` 로 구현할 것 (apply 모드에서만 요구).
- vitest 설정이 `scripts/` 를 테스트 글롭에 포함하지 않으면 wiki-rebuild.vitest.ts 가 어떻게 돌고 있는지(vitest.config 의 include) 확인해 같은 방식을 따른다.
- `package.json` scripts 에 추가: `"backfill:0076": "vitest run scripts/backfill-0076.vitest.ts --reporter=verbose"`.

- [ ] **Step 2: dry-run 은 여기서 돌리지 않는다** — DB 에 0076 스키마가 필요하므로 Task 10 스테이징 적용 후 실행. 이 Task 에서는 `BACKFILL_TARGET` 미지정 skip 경로만 확인:

Run: `npx vitest run scripts/backfill-0076.vitest.ts --reporter=verbose`
Expected: PASS (skip 로그)

- [ ] **Step 3: 커밋**

```bash
git add scripts/backfill-0076.vitest.ts package.json
git commit -m "0076 백필 러너 — 라이브 resolveFolderPath 재사용, dry-run·스냅샷·VERIFY 내장"
```

---

### Task 10: 스테이징 리허설 → 프로덕션 적용·배포 (G4)

**Files:** 없음 (절차 Task). 좌표·상세 절차는 `docs/runbook-staging.md`.

- [ ] **Step 1: 스테이징 동기화 + 마이그레이션 적용**

```bash
npm run staging:sync
npm run db:apply -- --target staging   # 0076 적용 (인자 형식은 docs/runbook-staging.md 확인)
```

- [ ] **Step 2: 스테이징 백필 dry-run → 검토 → 적용**

```bash
BACKFILL_TARGET=staging npm run backfill:0076
# outputs/0076-folder-backfill-staging.json 의 moved/unfiled 건수·경로를 눈으로 검토
BACKFILL_TARGET=staging BACKFILL_APPLY=1 BACKFILL_ACTOR=<운영자 uuid> npm run backfill:0076
```
Expected: VERIFY 위반 0건, unfiled 는 비활성 팀 등 사유 있는 건만.

- [ ] **Step 3: 스테이징 화면 확인 (dflow-staging.vercel.app)**

- staging 브랜치에 main back-merge 후 push → 배포.
- 확인 목록: ① 트리 최상위 프로젝트 노드 2개 + 미지정(6건) ② 각 프로젝트 아래 팀 폴더·기존 하위 폴더 재현 ③ 폴더 생성/개명/이동이 프로젝트 안에서만 ④ 회의록 프로젝트 변경 시 폴더 추종 ⑤ 나의 회의 칩·색점 ⑥ 또박또박 스모크(스테이징 API 로 folder_path 전송 1건 — 프로젝트 트리 편철 확인) ⑦ 챗 폴더 칩 동작.

- [ ] **Step 4: 트레일러 + 프로덕션 적용 + main push**

```bash
# 0076 커밋(또는 push 범위 내 빈 커밋)에 트레일러
git commit --allow-empty -m "0076 스테이징 리허설 완료" --trailer "Staging-verified: dflow-staging 검증 2026-08-12"
npm run db:apply -- --target prod      # 0076 프로덕션 적용
git push origin main                   # Vercel 자동 배포
```

- [ ] **Step 5: 프로덕션 백필 + 스모크 + known-good**

```bash
BACKFILL_TARGET=prod npm run backfill:0076                                   # dry-run 검토
BACKFILL_TARGET=prod BACKFILL_APPLY=1 BACKFILL_ACTOR=<운영자 uuid> npm run backfill:0076
npm run smoke:prod
# 실화면 확인(Step 3 목록의 ①②⑤ 최소) 후
npm run mark:good
```

**적용 순서 주의:** 코드 배포(신 코드는 project_id 컬럼을 select 한다)보다 **0076 스키마 적용이 먼저**다 — Step 4 의 순서(db:apply → push)를 바꾸지 말 것. 구 코드 + 신 스키마는 호환(추가 컬럼은 무시된다), 신 코드 + 구 스키마는 select 42703 으로 깨진다.

---

## Self-Review 결과 (계획 작성 후 점검)

- 스펙 §2(스키마·시드·백필·롤백)=Task 1·9·10, §3(편철 규칙)=Task 2·5·6, §4(보관함 화면)=Task 3·4·7, §5(나의 회의)=Task 8, §6(권한·에러)=Task 4·각 Task 의 fail-closed 규칙, §7(검증)=각 Task 테스트+Task 10. 커버리지 공백 없음.
- 타입 일관성: `FolderRow.projectId`/`MinuteFolder.projectId`(Task 2·3), `resolveFolderPath` opts.projectId 필수(Task 2)를 Task 5·6·9 가 동일 시그니처로 소비. `ensureProjectTeamRoot` 는 admin 전용 — Task 2 주석·Task 6 경로 모두 admin 클라이언트.
- 알려진 함정 반영: 시드 삽입 전 유니크 해체 순서(Task 1), created_by null 시드의 RLS(Task 2), BACKFILL_ACTOR uuid FK(Task 9), 코드보다 스키마 먼저(Task 10), updated_at 무접촉(Task 5).
