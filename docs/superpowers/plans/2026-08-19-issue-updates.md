# 이슈 조치/해결 경과 누적 이력 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 이슈 상세 모달의 "조치/해결 경과" 단일 textarea 를 입력일·입력자·분류가 붙은 누적 이력으로 바꾸고, 취소선 보존·관리자 완전삭제·담당자/멘션 알림을 붙인다.

**Architecture:** 새 자식 테이블 `issue_updates`(0068 `issue_attachments` 패턴 복제)에 이력을 쌓고, 기존 `issues.resolution_note` 컬럼은 "최신 살아있는 note" 를 담는 읽기 전용 파생 미러로 강등해 AI RAG·분석서 소비처를 무수정으로 유지한다. 서버 액션은 기존 `issues.ts` 를 오염시키지 않도록 새 파일 `issueUpdates.ts` 로 분리하고, 순수 판정은 `src/lib/domain/issueUpdates.ts` 에 둔다. UI 는 `IssueAttachments.tsx` 의 지연 로드 구조를 복제한 `IssueUpdates.tsx` 한 컴포넌트다.

**Tech Stack:** Next.js 15 App Router (서버 액션) · Supabase Postgres + RLS · TypeScript · Tailwind v4 · vitest (UI 는 raw `react-dom/client` + `act()` — 이 리포에 @testing-library 는 없다)

**Spec:** `docs/superpowers/specs/2026-08-19-issue-updates-design.md`

## Global Constraints

이 절의 규칙은 **모든 태스크의 요구사항에 암묵적으로 포함**된다. 위반하면 그 태스크는 실패다.

- **`git add -A` 금지.** 항상 파일명을 명시해 stage 한다(병렬 세션이 같은 리포를 쓴다).
- **마이그레이션과 코드를 같은 커밋에 담지 않는다.** pre-push 훅 G1 이 막는다.
- 커밋 메시지는 한국어. "무엇"보다 "왜".
- **DB 먼저, 코드 나중.** 테이블 없이 로더가 돌면 매 요청 PGRST 오류가 로그를 오염시킨다.
- **모든 supabase 쓰기에 `.select()` + 0행 검출.** supabase-js 는 RLS 거부에도 `error === null` 이다.
- **부모 `issues` UPDATE payload 에 허용되는 키는 `updated_at` 과 `resolution_note` 둘뿐.** `major_id`·`mega_code`·`mega_seq`·`pi_issue_code` 를 실으면 0062 트리거가 `ISSUE_MAJOR_UNSET_FORBIDDEN` 으로 거부한다. **DB 가 이것을 막아주지 않는다** — 트리거는 동일값 rewrite 를 통과시킨다.
- **`'use server'` 파일의 export 는 그 자체가 브라우저 호출 가능 엔드포인트다.** 내부 게이트·헬퍼는 절대 export 하지 않는다.
- **상태 변형 display 유틸 금지**(`group-hover:flex`, `data-[state=open]:hidden` 등). `globals.css` 끝 unlayered 안전망이 모든 named layer 를 이겨 조용히 무시된다. 토글은 JSX 조건부 렌더로만. `line-through`/`opacity-*` 자체는 display 유틸이 아니라 안전하다.
- **i18n 은 `dict/issues.ts`(ko) 와 `dict/issues.en.ts`(en) 를 항상 동시 수정.** en 파일은 `import type` 만 허용한다 — 값 import 를 넣으면 EN 청크 분리가 무효가 된다.
- **`Issue` 도메인 타입에 새 필드를 추가할 때는 반드시 optional.** 필수로 넣으면 픽스처 12개 테스트 파일이 동시에 깨진다.
- 액션에 `role === '...'` 을 직접 적지 않는다. 가드는 `requireSuperuser`/`requireProjectAdmin`/`requireProjectMember` 셋뿐이다.
- 본문 상한은 **한 건당 4000자**(`ISSUE_UPDATE_BODY_MAX`).
- **트레일러 블록의 형태는 두 겹의 규칙이다** — 어느 한쪽만 지키면 파싱되지 않는다.
  (a) 블록 **앞에는 빈 줄**이 있어야 한다(본문과 분리된 마지막 문단이어야 한다).
  (b) 블록 **안에는 빈 줄이 없어야 한다** — `Staging-verified:`·`Preview-checked:` 와
  `Co-Authored-By:` 는 붙여 쓴다.
  git 은 메시지 끝의 **연속된** `Key: value` 문단만 트레일러로 인식한다. 어긋나면 G4·G2 훅이 쓰는
  `git log --no-walk --format='%(trailers:key=<키>,valueonly)'` 가 빈 문자열을 돌려주고 push 가
  막힌다. 올바른 선례는 `1633bec6`(0086). **커밋 직후 그 명령으로 값이 나오는지 확인할 것** —
  이 실수는 push 직전까지 드러나지 않는다.
- **UI 테스트는 `@testing-library` 를 쓰지 않는다.** 이 리포에 설치돼 있지 않고 기존 UI 테스트는
  전부 raw `react-dom/client` + `act()` 다(`tests/ui/issue-form-draft.test.tsx:1-40` 이 정본 골격 —
  `// @vitest-environment jsdom` 프래그마, `IS_REACT_ACT_ENVIRONMENT`, container/root 수명주기).
  의존성을 새로 넣지 않는다 — `package.json`·`package-lock.json` 은 병렬 세션이 충돌하는 공유
  파일이고 락파일 변경은 모든 PC 에 전파된다.
- **상세 모달을 렌더하는 테스트 파일은 둘이다** — `tests/ui/deep-link-params.test.tsx` 와
  `tests/ui/issue-form-draft.test.tsx:426`. 새 자식 컴포넌트가 서버 액션을 부르면 **양쪽 다**
  모킹해야 `npm run test` 가 멈추지 않는다.
- 카테고리 값은 **`action` · `discuss` · `followup` · `etc` · `null`** 다섯 가지뿐.
- kind 값은 **`note` · `status`** 둘뿐.

---

## File Structure

| 파일 | 책임 | 태스크 |
|---|---|---|
| `supabase/migrations/0087_issue_updates.sql` (신규) | 테이블·인덱스·grant·RLS | 1 |
| `supabase/migrations/0087_issue_updates_rollback.sql` (신규) | 위의 역연산 | 1 |
| `src/lib/domain/issueUpdates.ts` (신규) | 순수 판정 — 상수, 권한 판정, 상태변경 인코딩, 멘션 대조 | 2 |
| `src/app/actions/issueUpdates.ts` (신규) | 이력 CRUD 5개 액션 + 미러 재계산 헬퍼 | 3, 4, 6, 7 |
| `src/components/issues/IssueUpdates.tsx` (신규) | 이력 목록 + 등록 폼 + 멘션 입력 | 5, 7 |
| `src/lib/domain/inbox.ts` (수정) | 알림 타입 2종 추가 | 6 |
| `src/components/issues/IssueModals.tsx` (수정) | 이력 컴포넌트 배치, canWrite prop, 구 textarea 제거 | 5, 9 |
| `src/components/issues/IssuesView.tsx` (수정) | canWrite 관통, focus 동기화 | 5, 10 |
| `src/app/actions/issues.ts` (수정) | 상태 자동 기록, resolutionNote 축 제거 | 8, 9 |
| `src/lib/i18n/dict/issues.ts` · `issues.en.ts` (수정) | 문구 | 5, 7, 9 |
| `supabase/migrations/0088_issue_updates_backfill.sql` (신규) | 기존 1건 이관 | 11 |

---

## Task 1: 0087 마이그레이션 — `issue_updates` 테이블·정책

**Files:**
- Create: `supabase/migrations/0087_issue_updates.sql`
- Create: `supabase/migrations/0087_issue_updates_rollback.sql`

**Interfaces:**
- Consumes: 기존 `public.is_project_member(uuid)`(0052:50-56), `public.is_project_admin(uuid)`(0052:43-48), 유니크 인덱스 `issues_id_project_uidx`(0042:25-26)
- Produces: 테이블 `public.issue_updates` — 컬럼 `id, issue_id, project_id, kind, category, body, mentioned_member_ids, author_user_id, author_name, created_at, archived_at, archived_by, archived_by_name`. 이후 모든 태스크가 이 컬럼명을 쓴다.

- [ ] **Step 1: 마이그레이션 파일 작성**

`supabase/migrations/0087_issue_updates.sql`:

```sql
-- 이슈 조치/해결 경과 누적 이력 — issues.resolution_note 단일 컬럼을 대체한다.
--
-- 설계 정본: docs/superpowers/specs/2026-08-19-issue-updates-design.md
--
-- 핵심 계약
--   1) 0068 issue_attachments 패턴 복제 — project_id 비정규 + (issue_id, project_id) 복합 FK.
--      복합 FK 는 권한 외에 project_id 위조도 막는다. 전제 인덱스 issues_id_project_uidx 는
--      0042:25-26 이 이미 만들었다.
--   2) insert 를 컬럼 단위로 grant 한다. 브라우저가 anon key + 사용자 JWT 로 PostgREST 를
--      직접 때리는 경로가 실사용 중이라(src/lib/supabase/client.ts:3-6) 전 컬럼 grant 면
--      kind='status'(화면에 시스템 자동 기록으로 렌더된다)·author_name·created_at 을
--      브라우저가 정한다. kind='status' 쓰기는 service_role 전용이다.
--   3) update 도 컬럼 단위다 — archived_* 셋만. 본문 수정 금지(D6)를 DB 가 강제한다.
--      오타 정정은 취소선 + 재작성이다(0068:64-66 과 같은 판단).
--   4) archived_by 는 짝 CHECK 에서 뺀다. on delete set null 은 참조 행 UPDATE 로 구현되고
--      CHECK 가 그대로 평가되므로, 셋을 묶으면 계정 삭제가 23514 로 통째로 실패한다.
--   5) 이력 본문은 한 건당 4000자. 기존 20000(issues.ts:161)은 필드 전체 상한이었다.
--
-- 적용 순서: **이 마이그레이션을 먼저 적용한 뒤 코드를 배포한다**(0027 사고 교훈).
--   백필은 여기 없다 — 코드 배포 후 0088 이 한다.
-- 멱등: table/index 는 if not exists, 정책은 drop 후 재생성(create policy 에는
--   if not exists 문법이 없어 재적용 2회차가 42710 으로 죽는다).
-- 롤백: 0087_issue_updates_rollback.sql

begin;

set search_path = public, extensions;

-- ── 1) 테이블 ───────────────────────────────────────────────────────────────
create table if not exists public.issue_updates (
  id                   uuid primary key default gen_random_uuid(),
  issue_id             uuid not null,
  project_id           uuid not null,
  -- 'note' 사람이 쓴 글 / 'status' 상태 변경 자동 기록. status 본문은 'open>resolved' 형식.
  kind                 text not null default 'note',
  -- note 에만 의미. status(open/in_progress/resolved/on_hold)와 겹치지 않는 축으로 재정의했다.
  category             text,
  body                 text not null,
  -- 멘션 대상은 project_members.id(로스터 축)다. 클라이언트에 auth uuid 가 없다
  -- (src/lib/domain/types.ts:69). 배열이라 FK 를 못 걸어 서버 액션이 선행 검증한다.
  mentioned_member_ids uuid[] not null default '{}',
  -- 신원 정본. 계정이 지워져도 이력은 남는다(0068:48-50 과 같은 계약).
  author_user_id       uuid references auth.users(id) on delete set null,
  -- 표시용 스냅샷. 판정에 쓰지 않는다 — 계정 삭제 폴백 전용.
  author_name          text not null,
  created_at           timestamptz not null default now(),
  -- 취소선(소프트 삭제). 리포에 deleted_at 을 쓰는 테이블은 없다 — archived_at 이 관례
  -- (0045 minutes, 0074 notification_recipients).
  archived_at          timestamptz,
  archived_by          uuid references auth.users(id) on delete set null,
  archived_by_name     text,
  constraint issue_updates_kind_ck check (kind in ('note','status')),
  constraint issue_updates_category_ck
    check (category is null or category in ('action','discuss','followup','etc')),
  constraint issue_updates_body_len_ck check (length(body) between 1 and 4000),
  constraint issue_updates_archive_pair_ck
    check (num_nonnulls(archived_at, archived_by_name) in (0,2)),
  constraint issue_updates_issue_project_fk
    foreign key (issue_id, project_id)
    references public.issues (id, project_id)
    on delete cascade
);

create index if not exists issue_updates_issue_created_idx
  on public.issue_updates (issue_id, created_at desc);
create index if not exists issue_updates_project_idx
  on public.issue_updates (project_id);

-- ── 2) 권한 ─────────────────────────────────────────────────────────────────
revoke all on table public.issue_updates from public, anon, authenticated;
grant select on table public.issue_updates to authenticated;
grant insert (issue_id, project_id, category, body, mentioned_member_ids,
              author_user_id, author_name)
  on table public.issue_updates to authenticated;
grant update (archived_at, archived_by, archived_by_name)
  on table public.issue_updates to authenticated;
grant delete on table public.issue_updates to authenticated;
grant all on table public.issue_updates to service_role;

-- ── 3) RLS ──────────────────────────────────────────────────────────────────
-- 이슈 계열 서버 액션은 createServerClient(anon key + 세션 쿠키)로 쓰므로 여기 정책이
-- 서버 액션 가드의 2차 방어선으로 실제 작동한다. 틀리게 쓰면 기능이 그냥 막힌다.
alter table public.issue_updates enable row level security;

drop policy if exists read_issue_updates   on public.issue_updates;
drop policy if exists insert_issue_updates on public.issue_updates;
drop policy if exists update_issue_updates on public.issue_updates;
drop policy if exists delete_issue_updates on public.issue_updates;

-- 조회 개방은 의도 — 이슈 본문·첨부와 동일하다(0041:60, 0068:96).
create policy read_issue_updates on public.issue_updates
  for select to authenticated using (true);

-- 등록: '진행 저장'과 같은 등급(멤버). uuid 위조는 여기가, 표시 필드·kind·created_at
-- 위조는 컬럼 스코프 grant 가 막는다 — 둘 다 있어야 한다.
create policy insert_issue_updates on public.issue_updates
  for insert to authenticated
  with check (public.is_project_member(project_id)
              and author_user_id = auth.uid()
              and kind = 'note'
              and archived_at is null
              and archived_by is null
              and archived_by_name is null);

-- 취소선/되돌리기: 이력 작성자 본인 또는 프로젝트 관리자.
--   can_edit_issue() 를 쓰면 안 된다 — 그건 '이슈' 작성자 기준이라 남의 코멘트를 긋게 된다.
--   with check 에 using 과 같은 술어를 그대로 쓰면 항상 참이라 archived_by 를 남의 uuid 로
--   위조할 수 있다(그 컬럼이 grant 안에 있으므로).
create policy update_issue_updates on public.issue_updates
  for update to authenticated
  using (author_user_id = auth.uid() or public.is_project_admin(project_id))
  with check (
    num_nonnulls(archived_at, archived_by, archived_by_name) = 0
    or (archived_at is not null and archived_by = auth.uid())
  );

-- 완전 삭제: 프로젝트 관리자만. is_project_admin 은 0052:43-48 에서 슈퍼유저를 포함한다.
create policy delete_issue_updates on public.issue_updates
  for delete to authenticated using (public.is_project_admin(project_id));

reset search_path;

commit;
```

- [ ] **Step 2: 롤백 파일 작성**

`supabase/migrations/0087_issue_updates_rollback.sql`:

```sql
-- 0087 롤백 — issue_updates 를 통째로 제거한다.
-- 주의: 이력 데이터가 함께 사라진다. 0088 백필까지 적용한 뒤 되돌리는 경우
-- issues.resolution_note 는 원래 값 그대로 남아 있으므로(0088 은 그 컬럼을 건드리지 않는다)
-- 화면은 롤백 직후 예전 동작으로 정확히 복귀한다.

begin;

drop policy if exists read_issue_updates   on public.issue_updates;
drop policy if exists insert_issue_updates on public.issue_updates;
drop policy if exists update_issue_updates on public.issue_updates;
drop policy if exists delete_issue_updates on public.issue_updates;

drop table if exists public.issue_updates;

commit;
```

- [ ] **Step 3: 스테이징에 적용**

```bash
npm run staging:sync
npm run db:apply -- supabase/migrations/0087_issue_updates.sql --target staging
```

Expected: `대상: <스테이징 프로젝트명> (...)` 출력 후 성공.

- [ ] **Step 4: 스테이징에서 스키마 검증**

`/private/tmp/.../scratchpad/verify-0087.mjs` 로 아래 SQL 을 스테이징에 던져 결과를 확인한다
(읽기 전용). `scripts/db-apply.mjs:38-60` 의 토큰 획득 코드와 `STAGING_REF` 를 재사용한다.

```sql
-- (1) 컬럼 단위 grant 가 실제로 좁혀졌는가 — insert 에 kind/created_at 이 없어야 한다
select privilege_type, string_agg(column_name, ',' order by column_name) cols
  from information_schema.column_privileges
 where table_name = 'issue_updates' and grantee = 'authenticated'
 group by privilege_type order by privilege_type;

-- (2) 정책 4개가 있는가
select policyname, cmd from pg_policies
 where tablename = 'issue_updates' order by policyname;

-- (3) 제약 4개가 있는가
select conname from pg_constraint
 where conrelid = 'public.issue_updates'::regclass and contype = 'c' order by conname;
```

Expected:
- (1) `INSERT` 행의 cols 에 `kind` 와 `created_at` 이 **없다**. `UPDATE` 행의 cols 는 `archived_at,archived_by,archived_by_name` 정확히 셋.
- (2) `delete_issue_updates(d)` · `insert_issue_updates(a)` · `read_issue_updates(r)` · `update_issue_updates(w)` 4행.
- (3) `issue_updates_archive_pair_ck` · `issue_updates_body_len_ck` · `issue_updates_category_ck` · `issue_updates_kind_ck` 4행.

- [ ] **Step 5: 멱등성 확인 — 같은 파일을 한 번 더 적용**

```bash
npm run db:apply -- supabase/migrations/0087_issue_updates.sql --target staging
```

Expected: 오류 없이 다시 성공(42710 이 나오면 정책 drop 이 빠진 것).

- [ ] **Step 6: 커밋 (마이그레이션 단독)**

```bash
git add supabase/migrations/0087_issue_updates.sql supabase/migrations/0087_issue_updates_rollback.sql
git commit -m "$(cat <<'EOF'
feat(issues): 조치/해결 경과 누적 이력 테이블을 만든다

단일 resolution_note 컬럼은 누가 언제 썼는지 남기지 못한다. insert·update 를
컬럼 단위로 grant 해 브라우저가 kind='status' 시스템 기록과 작성자 표시명을
위조하지 못하게 하고, 본문 수정 금지도 grant 로 강제한다.

archived_by 를 짝 CHECK 에서 뺀 것은 on delete set null 이 참조 행 UPDATE 라
CHECK 를 그대로 평가하기 때문이다 — 묶으면 계정 삭제가 통째로 실패한다.

Staging-verified: 0087 스테이징 적용 + 컬럼 grant/정책/제약 실측, 재적용 멱등 확인
Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: 순수 도메인 모듈

**Files:**
- Create: `src/lib/domain/issueUpdates.ts`
- Test: `tests/domain/issue-updates.test.ts`

**Interfaces:**
- Consumes: `IssueStatus` from `@/lib/domain/issues`
- Produces:
  - `ISSUE_UPDATE_CATEGORIES: readonly ['action','discuss','followup','etc']`
  - `type IssueUpdateCategory` · `type IssueUpdateKind = 'note' | 'status'`
  - `ISSUE_UPDATE_BODY_MAX = 4000`
  - `ISSUE_UPDATE_CATEGORY_META: Record<IssueUpdateCategory, { labelKey: string }>`
  - `interface IssueUpdate { id, issueId, kind, category, body, mentionedMemberIds, authorUserId, authorName, createdAt, archivedAt, archivedByName }`
  - `isIssueUpdateCategory(v: unknown): v is IssueUpdateCategory`
  - `canArchiveUpdate(row: { authorUserId: string | null }, userId: string | null, isProjectAdmin: boolean): boolean`
  - `canPurgeUpdate(isProjectAdmin: boolean): boolean`
  - `encodeStatusChange(from: IssueStatus, to: IssueStatus): string`
  - `parseStatusChange(body: string): { from: IssueStatus; to: IssueStatus } | null`
  - `parseMentions(body: string, picked: readonly { id: string; name: string }[]): string[]`

- [ ] **Step 1: 실패하는 테스트 작성**

`tests/domain/issue-updates.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import {
  ISSUE_UPDATE_BODY_MAX,
  ISSUE_UPDATE_CATEGORIES,
  canArchiveUpdate,
  canPurgeUpdate,
  encodeStatusChange,
  isIssueUpdateCategory,
  parseMentions,
  parseStatusChange,
} from '@/lib/domain/issueUpdates'

describe('카테고리', () => {
  it('네 가지뿐이다 — 늘어나면 0087 CHECK 제약도 함께 바꿔야 한다', () => {
    expect([...ISSUE_UPDATE_CATEGORIES]).toEqual(['action', 'discuss', 'followup', 'etc'])
  })
  it('알 수 없는 값을 거른다', () => {
    expect(isIssueUpdateCategory('action')).toBe(true)
    expect(isIssueUpdateCategory('resolution')).toBe(false)
    expect(isIssueUpdateCategory(null)).toBe(false)
  })
  it('본문 상한은 한 건당 4000자다', () => {
    expect(ISSUE_UPDATE_BODY_MAX).toBe(4000)
  })
})

describe('canArchiveUpdate — 취소선은 작성자 본인 또는 프로젝트 관리자', () => {
  it('작성자 본인은 그을 수 있다', () => {
    expect(canArchiveUpdate({ authorUserId: 'me' }, 'me', false)).toBe(true)
  })
  it('남의 이력은 못 긋는다 — 이슈 작성자 여부와 무관하다', () => {
    expect(canArchiveUpdate({ authorUserId: 'other' }, 'me', false)).toBe(false)
  })
  it('프로젝트 관리자는 남의 것도 긋는다', () => {
    expect(canArchiveUpdate({ authorUserId: 'other' }, 'me', true)).toBe(true)
  })
  it('비로그인·계정 삭제된 작성자는 fail-closed', () => {
    expect(canArchiveUpdate({ authorUserId: 'other' }, null, false)).toBe(false)
    // 계정이 지워지면 author_user_id 가 null 이 된다. null === null 로 통과시키면
    // 아무나 남의 이력을 긋게 된다.
    expect(canArchiveUpdate({ authorUserId: null }, null, false)).toBe(false)
  })
})

describe('canPurgeUpdate — 완전 삭제는 관리자만', () => {
  it('관리자만 참', () => {
    expect(canPurgeUpdate(true)).toBe(true)
    expect(canPurgeUpdate(false)).toBe(false)
  })
})

describe('상태 변경 인코딩 — 본문에 한국어를 박지 않는다(i18n)', () => {
  it('왕복한다', () => {
    expect(encodeStatusChange('open', 'resolved')).toBe('open>resolved')
    expect(parseStatusChange('open>resolved')).toEqual({ from: 'open', to: 'resolved' })
  })
  it('형식이 아니거나 모르는 상태면 null — 사람이 쓴 글을 상태 줄로 오독하지 않는다', () => {
    expect(parseStatusChange('오늘 협의했습니다')).toBeNull()
    expect(parseStatusChange('open>unknown')).toBeNull()
    expect(parseStatusChange('open>resolved>closed')).toBeNull()
  })
})

describe('parseMentions — 썼다 지운 멘션은 알림을 보내지 않는다', () => {
  const picked = [{ id: 'm1', name: '김준기' }, { id: 'm2', name: '남순혁' }]

  it('본문에 남아 있는 것만 반환한다', () => {
    expect(parseMentions('@김준기 확인 부탁드립니다', picked)).toEqual(['m1'])
  })
  it('본문에서 지운 멘션은 빠진다', () => {
    expect(parseMentions('확인 부탁드립니다', picked)).toEqual([])
  })
  it('선택하지 않은 이름을 손으로 타이핑해도 알림 대상이 되지 않는다', () => {
    expect(parseMentions('@문부성 님도 봐주세요', picked)).toEqual([])
  })
  it('이름이 다른 이름의 접두사여도 오탐하지 않는다', () => {
    const p = [{ id: 'm1', name: '김준' }, { id: 'm2', name: '김준기' }]
    expect(parseMentions('@김준기 님', p)).toEqual(['m2'])
  })
  it('동명이인은 본문의 등장 횟수만큼만 매칭한다', () => {
    const p = [{ id: 'm1', name: '김철수' }, { id: 'm2', name: '김철수' }]
    expect(parseMentions('@김철수 확인', p)).toEqual(['m1'])
    expect(parseMentions('@김철수 와 @김철수', p)).toEqual(['m1', 'm2'])
  })
  it('중복 id 는 한 번만', () => {
    const p = [{ id: 'm1', name: '김준기' }, { id: 'm1', name: '김준기' }]
    expect(parseMentions('@김준기 @김준기', p)).toEqual(['m1'])
  })
  it('조사·호칭이 이름에 붙어도 잡는다 — 한국어에서 가장 흔한 표기다', () => {
    expect(parseMentions('@김준기님 확인 부탁드려요', picked)).toEqual(['m1'])
    expect(parseMentions('@김준기가 확인했습니다', picked)).toEqual(['m1'])
    expect(parseMentions('@남순혁께 전달했습니다', picked)).toEqual(['m2'])
  })
  it('접두사 충돌은 긴 이름이 먼저 자리를 잡아 해결한다 — 등록 순서와 무관하다', () => {
    const short = [{ id: 'm1', name: '김준' }, { id: 'm2', name: '김준기' }]
    const long = [{ id: 'm2', name: '김준기' }, { id: 'm1', name: '김준' }]
    expect(parseMentions('@김준기님', short)).toEqual(['m2'])
    expect(parseMentions('@김준기님', long)).toEqual(['m2'])
  })
  it('짧은 이름과 긴 이름이 본문에 다 있으면 둘 다 잡는다', () => {
    const p = [{ id: 'm1', name: '김준' }, { id: 'm2', name: '김준기' }]
    expect(parseMentions('@김준 과 @김준기 확인', p)).toEqual(['m1', 'm2'])
  })
})
```

- [ ] **Step 2: 테스트 실행해 실패 확인**

Run: `npx vitest run tests/domain/issue-updates.test.ts`
Expected: FAIL — `Failed to resolve import "@/lib/domain/issueUpdates"`

- [ ] **Step 3: 최소 구현 작성**

`src/lib/domain/issueUpdates.ts`:

```ts
// 이슈 조치/해결 경과 이력 도메인 — 순수 함수만(I/O 없음).
// 스펙: docs/superpowers/specs/2026-08-19-issue-updates-design.md
//
// 이 파일이 @/lib/domain 아래 있는 이유: 서버 액션 테스트가 @/lib/authz 와
// @/lib/supabase/* 를 통모킹하는데, 판정 로직을 그쪽에 두면 mock 팩토리에 없어
// 호출 즉시 TypeError 가 된다. 순수 판정은 항상 여기에 둔다.
import { ISSUE_STATUSES, type IssueStatus } from './issues'

export const ISSUE_UPDATE_CATEGORIES = ['action', 'discuss', 'followup', 'etc'] as const
export type IssueUpdateCategory = (typeof ISSUE_UPDATE_CATEGORIES)[number]

/** 'note' 사람이 쓴 글 / 'status' 상태 변경 자동 기록. */
export type IssueUpdateKind = 'note' | 'status'

/** 한 건당 본문 상한. 0087 의 CHECK 제약과 같은 값이어야 한다. */
export const ISSUE_UPDATE_BODY_MAX = 4000

export const ISSUE_UPDATE_CATEGORY_META: Record<IssueUpdateCategory, { labelKey: string }> = {
  action:   { labelKey: 'issue.update.cat.action' },
  discuss:  { labelKey: 'issue.update.cat.discuss' },
  followup: { labelKey: 'issue.update.cat.followup' },
  etc:      { labelKey: 'issue.update.cat.etc' },
}

/** 화면이 쓰는 읽기 모델. archivedBy(uuid)는 화면에 내리지 않는다 — 표시는 이름으로 한다. */
export interface IssueUpdate {
  id: string
  issueId: string
  kind: IssueUpdateKind
  category: IssueUpdateCategory | null
  body: string
  mentionedMemberIds: string[]
  authorUserId: string | null
  authorName: string
  createdAt: string
  archivedAt: string | null
  archivedByName: string | null
}

export function isIssueUpdateCategory(v: unknown): v is IssueUpdateCategory {
  return typeof v === 'string' && (ISSUE_UPDATE_CATEGORIES as readonly string[]).includes(v)
}

/**
 * 취소선 처리 권한 — 이력 작성자 본인 또는 프로젝트 관리자.
 * can_edit_issue(이슈 작성자 기준)를 쓰면 안 된다. 그건 남의 코멘트를 긋는 권한이 된다.
 */
export function canArchiveUpdate(
  row: { authorUserId: string | null },
  userId: string | null,
  isProjectAdmin: boolean,
): boolean {
  if (isProjectAdmin) return true
  // 계정이 삭제되면 author_user_id 가 null 이 된다. null === null 로 통과시키면
  // 비로그인 호출이 남의 이력을 긋는다 — fail-closed.
  return userId !== null && row.authorUserId !== null && row.authorUserId === userId
}

/** 완전 삭제 권한 — 프로젝트 관리자만(is_project_admin 은 슈퍼유저를 포함한다). */
export function canPurgeUpdate(isProjectAdmin: boolean): boolean {
  return isProjectAdmin
}

/**
 * 상태 변경 자동 기록의 본문 형식. 한국어 문장을 DB 에 박으면 EN 로케일에서 번역되지 않고
 * 상태 라벨이 바뀔 때 과거 기록이 거짓말이 된다 — 기계 판독 형식으로 저장하고 화면이 렌더한다.
 */
export function encodeStatusChange(from: IssueStatus, to: IssueStatus): string {
  return `${from}>${to}`
}

export function parseStatusChange(body: string): { from: IssueStatus; to: IssueStatus } | null {
  const parts = body.split('>')
  if (parts.length !== 2) return null
  const [from, to] = parts
  const known = (v: string): v is IssueStatus => (ISSUE_STATUSES as readonly string[]).includes(v)
  if (!known(from) || !known(to)) return null
  return { from, to }
}

/**
 * 한 이름이 본문에서 차지할 수 있는 자리를 세고, 그 구간을 taken 에 등록한다.
 * 겹치는 구간은 세지 않는다 — 긴 이름이 먼저 자리를 잡으므로 짧은 이름이 그 안에
 * 파고들지 못한다(@김준기 를 @김준 으로 잘못 집는 것을 이 방식으로 막는다).
 */
function claimMentionSpans(body: string, name: string, taken: Array<[number, number]>): number {
  if (name.length === 0) return 0
  const token = `@${name}`
  let n = 0
  let i = 0
  for (;;) {
    const at = body.indexOf(token, i)
    if (at === -1) return n
    const end = at + token.length
    if (!taken.some(([s, e]) => at < e && s < end)) {
      taken.push([at, end])
      n++
    }
    i = end
  }
}

/**
 * 실제 알림을 보낼 멘션 대상. 자동완성에서 고른 사람(picked) 중 본문에 `@이름` 이
 * 아직 남아 있는 사람만 남긴다 — 썼다 지운 멘션이 유령 알림을 보내지 않게.
 *
 * 문자열이 아니라 picked 기준으로 판정하는 이유는 두 가지다.
 *   (1) 손으로 타이핑한 `@아무개` 는 대상이 아니다(고른 적이 없으므로 id 를 모른다).
 *   (2) 동명이인이 있으면 이름만으로는 누구인지 정할 수 없다 — 등장 횟수만큼만 배정한다.
 *
 * 뒤 글자로 경계를 판정하지 않는다. 한국어는 조사·호칭이 이름에 붙어 나오므로
 * (@김준기님, @김준기가, @남순혁께) 뒤가 한글이라는 이유로 거르면 가장 자연스러운
 * 표기에서 알림이 조용히 사라진다. 대신 **긴 이름부터** 자리를 잡고 그 구간을 소비해
 * 접두사 충돌을 막는다. 반환 순서는 본문 등장순이 아니라 picked 순이다.
 */
export function parseMentions(
  body: string,
  picked: readonly { id: string; name: string }[],
): string[] {
  const names = [...new Set(picked.map(p => p.name))].sort((a, b) => b.length - a.length)
  const taken: Array<[number, number]> = []
  const slots = new Map<string, number>()
  for (const name of names) slots.set(name, claimMentionSpans(body, name, taken))

  const used = new Map<string, number>()
  const out: string[] = []
  for (const p of picked) {
    if (out.includes(p.id)) continue
    const seen = used.get(p.name) ?? 0
    if (seen >= (slots.get(p.name) ?? 0)) continue
    used.set(p.name, seen + 1)
    out.push(p.id)
  }
  return out
}
```

- [ ] **Step 4: 테스트 실행해 통과 확인**

Run: `npx vitest run tests/domain/issue-updates.test.ts`
Expected: PASS (모든 케이스)

- [ ] **Step 5: 커밋**

```bash
git add src/lib/domain/issueUpdates.ts tests/domain/issue-updates.test.ts
git commit -m "$(cat <<'EOF'
feat(issues): 이력 도메인 판정을 순수 모듈로 분리한다

취소선·완전삭제 권한과 멘션 대조를 서버 액션 밖에 둔다. 액션 테스트가
@/lib/authz 와 supabase 클라이언트를 통모킹하기 때문에, 판정을 그쪽에 두면
mock 팩토리에 없어 호출 즉시 TypeError 가 된다.

상태 변경 본문은 'open>resolved' 로 저장한다 — 한국어 문장을 박으면 EN 에서
번역되지 않고 라벨이 바뀔 때 과거 기록이 거짓말이 된다.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: 서버 액션 — 조회·등록 + 미러 재계산

**Files:**
- Create: `src/app/actions/issueUpdates.ts`
- Test: `tests/actions/issue-updates-gate.test.ts`

**Interfaces:**
- Consumes: Task 2 의 `IssueUpdate`, `ISSUE_UPDATE_BODY_MAX`, `isIssueUpdateCategory`. 기존 `resolveProjectId`, `requireProjectMember`, `requireProjectAdmin`, `getSession`, `displayNameFrom`, `createServerClient`, `ERR_LOOKUP`.
- Produces:
  - `type IssueUpdateListResult = { ok: true; items: IssueUpdate[] } | { ok: false; error: string }`
  - `type IssueUpdateResult = { ok: true; partial?: string } | { ok: false; error: string }`
  - `listIssueUpdates(issueId: string): Promise<IssueUpdateListResult>`
  - `addIssueUpdate(issueId: string, input: { body: string; category: IssueUpdateCategory | null; mentionedMemberIds: string[] }): Promise<IssueUpdateResult>`
  - 모듈 로컬(export 금지): `requireIssueMember(issueId)` → `{ ok: true; projectId; userId; isAdmin } | { ok: false; error }`, `syncResolutionNoteMirror(sb, issueId)` → `string | null`

- [ ] **Step 1: 실패하는 테스트 작성**

`tests/actions/issue-updates-gate.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

// 게이트 통과 전에는 DB 클라이언트가 만들어지면 안 된다(issues-gate.test.ts 와 같은 규약).
const state = vi.hoisted(() => ({ client: undefined as unknown }))
const { createServerClient } = vi.hoisted(() => ({
  createServerClient: vi.fn(async () => {
    if (state.client === undefined) throw new Error('게이트 통과 전 createServerClient 호출 금지')
    return state.client
  }),
}))
const { requireProjectMember, requireProjectAdmin, resolveProjectId } = vi.hoisted(() => ({
  requireProjectMember: vi.fn(), requireProjectAdmin: vi.fn(), resolveProjectId: vi.fn(),
}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/lib/auth', () => ({ getSession: vi.fn() }))
vi.mock('@/lib/authz', () => ({ requireProjectMember, requireProjectAdmin, resolveProjectId }))
vi.mock('@/lib/supabase/server', () => ({ createServerClient }))

import { getSession } from '@/lib/auth'
import { addIssueUpdate, listIssueUpdates } from '@/app/actions/issueUpdates'

const ACTOR = { userId: 'me', teamCode: 'PMO', teamId: 't1', isSuperuser: false, projectRoles: new Map([['p1', 'member']]) }
const USER = { id: 'me', email: 'me@x.com', user_metadata: { full_name: '나' } }

function asMember() {
  resolveProjectId.mockResolvedValue({ ok: true, projectId: 'p1' })
  requireProjectMember.mockResolvedValue({ ok: true, actor: ACTOR })
  requireProjectAdmin.mockResolvedValue({ ok: false, error: '권한 없음' })
  vi.mocked(getSession).mockResolvedValue(USER as never)
}
function asViewer() {
  resolveProjectId.mockResolvedValue({ ok: true, projectId: 'p1' })
  requireProjectMember.mockResolvedValue({ ok: false, error: '권한 없음' })
  requireProjectAdmin.mockResolvedValue({ ok: false, error: '권한 없음' })
  vi.mocked(getSession).mockResolvedValue(USER as never)
}

/** issue_updates INSERT · project_members 검증 · issues UPDATE 세 갈래를 받는 최소 스텁. */
function stubClient(over: {
  insertResult?: { data: unknown; error: unknown }
  memberIds?: string[]
  latestNote?: string | null
  issueUpdateRows?: unknown[]
} = {}) {
  const calls = { inserted: null as Record<string, unknown> | null, issuePayload: null as Record<string, unknown> | null }
  const client = {
    from(table: string) {
      if (table === 'issue_updates') {
        return {
          insert(row: Record<string, unknown>) {
            calls.inserted = row
            return { select: () => ({ maybeSingle: async () => over.insertResult ?? { data: { id: 'u1' }, error: null } }) }
          },
          select() {
            const q: Record<string, unknown> = {}
            const chain = () => q
            Object.assign(q, {
              eq: chain, is: chain, order: chain,
              limit: async () => ({ data: over.latestNote == null ? [] : [{ body: over.latestNote }], error: null }),
              then: undefined,
            })
            return q
          },
        }
      }
      if (table === 'project_members') {
        return {
          select: () => ({
            in: () => ({
              eq: async () => ({ data: (over.memberIds ?? []).map(id => ({ id })), error: null }),
            }),
          }),
        }
      }
      if (table === 'issues') {
        return {
          update(payload: Record<string, unknown>) {
            calls.issuePayload = payload
            return { eq: () => ({ select: async () => ({ data: [{ id: 'i1' }], error: null }) }) }
          },
        }
      }
      throw new Error(`예상치 못한 테이블 접근: ${table}`)
    },
  }
  return { client, calls }
}

beforeEach(() => {
  vi.clearAllMocks()
  state.client = undefined
})

describe('addIssueUpdate — 등록은 프로젝트 멤버', () => {
  it('조회 전용 사용자는 거부되고 DB 에 닿지 않는다', async () => {
    asViewer()
    const res = await addIssueUpdate('i1', { body: '내용', category: null, mentionedMemberIds: [] })
    expect(res.ok).toBe(false)
    expect(createServerClient).not.toHaveBeenCalled()
  })

  it('멤버는 등록할 수 있고 작성자는 서버가 정한다', async () => {
    asMember()
    const { client, calls } = stubClient({ latestNote: '내용' })
    state.client = client
    const res = await addIssueUpdate('i1', { body: '  내용  ', category: 'action', mentionedMemberIds: [] })
    expect(res.ok).toBe(true)
    expect(calls.inserted).toMatchObject({
      issue_id: 'i1', project_id: 'p1', body: '내용', category: 'action', author_user_id: 'me', author_name: '나',
    })
    // kind 는 클라이언트가 정하지 않는다 — 컬럼 grant 밖이라 보내면 42501 이다.
    expect(calls.inserted).not.toHaveProperty('kind')
  })

  it('빈 본문과 상한 초과를 거부한다', async () => {
    asMember()
    state.client = stubClient().client
    expect((await addIssueUpdate('i1', { body: '   ', category: null, mentionedMemberIds: [] })).ok).toBe(false)
    expect((await addIssueUpdate('i1', { body: 'x'.repeat(4001), category: null, mentionedMemberIds: [] })).ok).toBe(false)
  })

  it('알 수 없는 분류를 거부한다 — 0087 CHECK 에 걸리기 전에 잡는다', async () => {
    asMember()
    state.client = stubClient().client
    const res = await addIssueUpdate('i1', { body: '내용', category: 'resolution' as never, mentionedMemberIds: [] })
    expect(res.ok).toBe(false)
  })

  it('이 프로젝트 소속이 아닌 멘션 대상은 걸러진다', async () => {
    asMember()
    const { client, calls } = stubClient({ memberIds: ['m1'], latestNote: '내용' })
    state.client = client
    await addIssueUpdate('i1', { body: '내용', category: null, mentionedMemberIds: ['m1', 'm-남의프로젝트'] })
    expect(calls.inserted?.mentioned_member_ids).toEqual(['m1'])
  })

  it('부모 issues UPDATE 는 허용 키 두 개만 싣는다 — 0062 트리거가 막아주지 않는다', async () => {
    asMember()
    const { client, calls } = stubClient({ latestNote: '내용' })
    state.client = client
    await addIssueUpdate('i1', { body: '내용', category: null, mentionedMemberIds: [] })
    expect(Object.keys(calls.issuePayload ?? {}).sort()).toEqual(['resolution_note', 'updated_at'])
    expect(calls.issuePayload?.resolution_note).toBe('내용')
  })

  it('살아있는 이력이 없으면 미러는 빈 문자열이다 — NULL 은 NOT NULL 위반(23502)', async () => {
    asMember()
    const { client, calls } = stubClient({ latestNote: null })
    state.client = client
    await addIssueUpdate('i1', { body: '내용', category: null, mentionedMemberIds: [] })
    expect(calls.issuePayload?.resolution_note).toBe('')
  })
})

describe('listIssueUpdates — 조회 실패를 빈 목록으로 위장하지 않는다', () => {
  it('비로그인은 명시적 실패', async () => {
    vi.mocked(getSession).mockResolvedValue(null as never)
    const res = await listIssueUpdates('i1')
    expect(res.ok).toBe(false)
  })
})
```

- [ ] **Step 2: 테스트 실행해 실패 확인**

Run: `npx vitest run tests/actions/issue-updates-gate.test.ts`
Expected: FAIL — `Failed to resolve import "@/app/actions/issueUpdates"`

- [ ] **Step 3: 액션 구현**

`src/app/actions/issueUpdates.ts`:

```ts
'use server'
// 이슈 조치/해결 경과 이력 — 등록·조회·취소선·완전삭제.
//
// issues.ts 와 파일을 가르는 이유: 상세 모달·이슈 액션 테스트의 mock 표면을 늘리지 않기
// 위해서다. 저 파일에 심볼을 더하면 통모킹한 테스트들이 함께 흔들린다.
//
// 이 파일은 'use server' 다 — export 하는 순간 브라우저에서 호출 가능한 엔드포인트가 된다.
// 게이트·헬퍼는 절대 export 하지 않는다.
import { revalidatePath } from 'next/cache'
import { getSession } from '@/lib/auth'
import { requireProjectAdmin, requireProjectMember, resolveProjectId } from '@/lib/authz'
import { ERR_LOOKUP } from '@/lib/authz/errors'
import { displayNameFrom } from '@/lib/domain/display-name'
import {
  ISSUE_UPDATE_BODY_MAX,
  isIssueUpdateCategory,
  type IssueUpdate,
  type IssueUpdateCategory,
} from '@/lib/domain/issueUpdates'
import { createServerClient } from '@/lib/supabase/server'

export type IssueUpdateListResult =
  | { ok: true; items: IssueUpdate[] }
  | { ok: false; error: string }

/** partial 은 "이력은 남았지만 뒷단 일부가 실패" — 성공으로 뭉개지 않고 화면에 고지한다. */
export type IssueUpdateResult =
  | { ok: true; partial?: string }
  | { ok: false; error: string }

const NAME_FALLBACK = '(이름 없음)'

/**
 * 이력 쓰기 게이트 — 그 이슈가 속한 프로젝트의 멤버. '진행 저장'과 같은 등급이다.
 * isAdmin 을 함께 돌려주는 이유: 취소선·완전삭제 판정이 같은 왕복 안에서 끝나야
 * 액션마다 requireProjectAdmin 을 또 부르지 않는다.
 */
async function requireIssueMember(issueId: string): Promise<
  { ok: true; projectId: string; userId: string; isAdmin: boolean } | { ok: false; error: string }
> {
  const found = await resolveProjectId('issues', issueId)
  if (!found.ok) return { ok: false, error: found.error }
  // issues.project_id 는 not null 이지만 타입이 nullable 이다. null 이면 이력의 not null
  // 컬럼을 채울 수 없으므로 '권한 없음'이 아니라 중단한다(에러 3원칙 ②).
  if (!found.projectId) {
    console.error('[issueUpdates] 이슈의 프로젝트를 확정하지 못했습니다:', issueId)
    return { ok: false, error: ERR_LOOKUP }
  }
  const projectId = found.projectId
  const g = await requireProjectMember(projectId)
  if (!g.ok) return { ok: false, error: g.error }
  const admin = await requireProjectAdmin(projectId)
  return { ok: true, projectId, userId: g.actor.userId, isAdmin: admin.ok }
}

/**
 * issues.resolution_note 파생 미러 재계산 — 최신 '살아있는' note 본문을 부모에 복사한다.
 *
 * "방금 쓴 body 복사"가 아니라 재계산인 이유는 셋이다.
 *   (1) 취소선·완전삭제 뒤에도 미러가 맞아야 한다. 안 그러면 화면에서 지운 문장을
 *       AI RAG(ai/index/content.ts:290)가 계속 인용한다.
 *   (2) 동시 등록 경합을 흡수한다.
 *   (3) 이력이 0건이면 빈 문자열이어야 한다 — NULL 은 0041:38 NOT NULL 위반(23502)이다.
 *
 * updated_at 을 함께 미는 것은 필수다. issues 엔 updated_at 트리거가 없고(0041:14-15),
 * 안 밀면 0031:172-176 의 신선도 게이트가 재색인을 return 0 으로 스킵한다.
 *
 * payload 에 이 두 키 말고는 절대 넣지 않는다 — major_id 가 섞이면 0062:202
 * ISSUE_MAJOR_UNSET_FORBIDDEN 으로 터진다. 트리거는 동일값 rewrite 를 통과시키므로
 * DB 가 이 규칙을 지켜주지 않는다.
 *
 * 반환: 성공이면 null, 실패면 사유 문자열(replaceAssignees 관례).
 */
async function syncResolutionNoteMirror(
  sb: Awaited<ReturnType<typeof createServerClient>>,
  issueId: string,
): Promise<string | null> {
  const { data, error } = await sb
    .from('issue_updates')
    .select('body')
    .eq('issue_id', issueId)
    .eq('kind', 'note')
    .is('archived_at', null)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(1)
  if (error) {
    console.error('[issueUpdates] 미러 재계산용 조회 실패:', error.message)
    return error.message
  }
  const latest = (data?.[0]?.body as string | undefined) ?? ''

  const { data: updated, error: upErr } = await sb
    .from('issues')
    .update({ resolution_note: latest, updated_at: new Date().toISOString() })
    .eq('id', issueId)
    .select('id')
  if (upErr) {
    console.error('[issueUpdates] 미러 갱신 실패:', upErr.message)
    return upErr.message
  }
  if (!updated?.length) {
    console.error('[issueUpdates] 미러 갱신이 0행입니다:', issueId)
    return '이슈를 찾을 수 없습니다.'
  }
  return null
}

function mapRow(r: Record<string, unknown>): IssueUpdate {
  return {
    id: r.id as string,
    issueId: r.issue_id as string,
    kind: r.kind as IssueUpdate['kind'],
    category: (r.category as IssueUpdateCategory | null) ?? null,
    body: r.body as string,
    mentionedMemberIds: (r.mentioned_member_ids as string[] | null) ?? [],
    authorUserId: (r.author_user_id as string | null) ?? null,
    authorName: r.author_name as string,
    createdAt: r.created_at as string,
    archivedAt: (r.archived_at as string | null) ?? null,
    archivedByName: (r.archived_by_name as string | null) ?? null,
  }
}

/**
 * 이력 목록(오래된 순). 조회는 로그인 사용자 전체에 열려 있다(이슈 본문·첨부와 동일).
 *
 * 빈 배열이 아니라 에러 채널을 둔 이유: 여기서 실패를 [] 로 뭉개면 사용자는 "아무도 아무
 * 조치도 안 했다"고 읽는다. 조치 이력이 사라진 것처럼 보이는 것이 최악이다(에러 3원칙 ①).
 */
export async function listIssueUpdates(issueId: string): Promise<IssueUpdateListResult> {
  if (!(await getSession())) {
    console.error('[listIssueUpdates] 비로그인 호출')
    return { ok: false, error: '로그인 필요' }
  }
  const sb = await createServerClient()
  const { data, error } = await sb
    .from('issue_updates')
    .select('id, issue_id, kind, category, body, mentioned_member_ids, author_user_id, author_name, created_at, archived_at, archived_by_name')
    .eq('issue_id', issueId)
    .order('created_at', { ascending: true })
    .order('id', { ascending: true })
  if (error) {
    console.error('[listIssueUpdates] 이력 조회 실패:', error.message)
    return { ok: false, error: ERR_LOOKUP }
  }
  return { ok: true, items: (data ?? []).map(mapRow) }
}

/** 이력 등록 — 프로젝트 멤버. kind 는 보내지 않는다(컬럼 grant 밖이라 42501 이 된다). */
export async function addIssueUpdate(
  issueId: string,
  input: { body: string; category: IssueUpdateCategory | null; mentionedMemberIds: string[] },
): Promise<IssueUpdateResult> {
  const g = await requireIssueMember(issueId)
  if (!g.ok) return { ok: false, error: g.error }

  const body = input.body.trim()
  if (body.length === 0) return { ok: false, error: '내용을 입력하세요.' }
  if (body.length > ISSUE_UPDATE_BODY_MAX) {
    return { ok: false, error: `내용은 ${ISSUE_UPDATE_BODY_MAX}자 이하여야 합니다.` }
  }
  if (input.category !== null && !isIssueUpdateCategory(input.category)) {
    return { ok: false, error: '알 수 없는 분류입니다.' }
  }

  const user = await getSession()
  if (!user) return { ok: false, error: '로그인 필요' }

  const sb = await createServerClient()

  // 멘션 대상 선행 검증 — uuid[] 컬럼이라 FK 를 걸 수 없다(replaceAssignees 와 같은 처리).
  // 남의 프로젝트 멤버 id 를 꽂아 알림을 보내는 경로를 여기서 끊는다.
  let mentioned: string[] = []
  if (input.mentionedMemberIds.length > 0) {
    const { data, error } = await sb
      .from('project_members')
      .select('id')
      .in('id', input.mentionedMemberIds)
      .eq('project_id', g.projectId)
    if (error) {
      console.error('[addIssueUpdate] 멘션 대상 검증 실패:', error.message)
      return { ok: false, error: ERR_LOOKUP }
    }
    mentioned = (data ?? []).map((r: { id: string }) => r.id)
  }

  const { data: inserted, error } = await sb
    .from('issue_updates')
    .insert({
      issue_id: issueId,
      project_id: g.projectId,
      category: input.category,
      body,
      mentioned_member_ids: mentioned,
      author_user_id: user.id,
      author_name: displayNameFrom(user.user_metadata, user.email) ?? NAME_FALLBACK,
    })
    .select('id')
    .maybeSingle()
  if (error) return { ok: false, error: error.message }
  if (!inserted) {
    console.error('[addIssueUpdate] 이력 INSERT 가 0행입니다:', issueId)
    return { ok: false, error: '이력 저장에 실패했습니다.' }
  }

  const mirrorErr = await syncResolutionNoteMirror(sb, issueId)
  revalidatePath(`/p/${g.projectId}/issues`)
  if (mirrorErr) {
    return { ok: true, partial: `이력은 저장됐지만 요약 반영에 실패했습니다(${mirrorErr}).` }
  }
  return { ok: true }
}
```

- [ ] **Step 4: 테스트 실행해 통과 확인**

Run: `npx vitest run tests/actions/issue-updates-gate.test.ts`
Expected: PASS

- [ ] **Step 5: 커밋**

```bash
git add src/app/actions/issueUpdates.ts tests/actions/issue-updates-gate.test.ts
git commit -m "$(cat <<'EOF'
feat(issues): 이력 조회·등록 액션과 미러 재계산을 추가한다

resolution_note 는 이제 최신 '살아있는' 이력을 담는 파생 미러다. 복사가 아니라
재계산인 이유는 취소선·완전삭제 뒤에도 미러가 맞아야 하기 때문이다 — 안 그러면
화면에서 지운 문장을 챗봇이 계속 인용한다.

부모 UPDATE payload 에 허용 키를 둘로 묶는 테스트를 함께 넣었다. 0062 트리거는
동일값 rewrite 를 통과시키므로 DB 가 이 규칙을 지켜주지 않는다.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: 서버 액션 — 취소선·되돌리기·완전삭제

**Files:**
- Modify: `src/app/actions/issueUpdates.ts` (append)
- Test: `tests/actions/issue-updates-gate.test.ts` (append)

**Interfaces:**
- Consumes: Task 2 의 `canArchiveUpdate`, `canPurgeUpdate`. Task 3 의 `requireIssueMember`, `syncResolutionNoteMirror`, `IssueUpdateResult`, `NAME_FALLBACK`.
- Produces:
  - `archiveIssueUpdate(issueId: string, updateId: string): Promise<IssueUpdateResult>`
  - `unarchiveIssueUpdate(issueId: string, updateId: string): Promise<IssueUpdateResult>`
  - `purgeIssueUpdate(issueId: string, updateId: string): Promise<IssueUpdateResult>`

- [ ] **Step 1: 실패하는 테스트 추가**

`tests/actions/issue-updates-gate.test.ts` 하단에 append. 파일 상단 import 에
`archiveIssueUpdate, purgeIssueUpdate, unarchiveIssueUpdate` 를 추가한다.

```ts
/** 취소선·삭제용 스텁 — 대상 행 조회 + UPDATE/DELETE 를 받는다. */
function stubRowClient(row: { author_user_id: string | null; archived_at: string | null } | null, opts: { updatedRows?: unknown[]; deletedRows?: unknown[] } = {}) {
  const calls = { updatePayload: null as Record<string, unknown> | null, deleted: false }
  const client = {
    from(table: string) {
      if (table === 'issue_updates') {
        return {
          select() {
            const q: Record<string, unknown> = {}
            Object.assign(q, {
              eq: () => q,
              is: () => q,
              order: () => q,
              limit: async () => ({ data: [], error: null }),
              maybeSingle: async () => ({ data: row, error: null }),
            })
            return q
          },
          update(payload: Record<string, unknown>) {
            calls.updatePayload = payload
            const q: Record<string, unknown> = {}
            Object.assign(q, {
              eq: () => q,
              is: () => q,
              not: () => q,
              select: async () => ({ data: opts.updatedRows ?? [{ id: 'u1' }], error: null }),
            })
            return q
          },
          delete() {
            calls.deleted = true
            const q: Record<string, unknown> = {}
            Object.assign(q, { eq: () => q, select: async () => ({ data: opts.deletedRows ?? [{ id: 'u1' }], error: null }) })
            return q
          },
        }
      }
      if (table === 'issues') {
        return { update: () => ({ eq: () => ({ select: async () => ({ data: [{ id: 'i1' }], error: null }) }) }) }
      }
      throw new Error(`예상치 못한 테이블 접근: ${table}`)
    },
  }
  return { client, calls }
}

describe('archiveIssueUpdate — 취소선은 작성자 또는 관리자', () => {
  it('남의 이력은 멤버가 못 긋는다', async () => {
    asMember()
    state.client = stubRowClient({ author_user_id: 'other', archived_at: null }).client
    const res = await archiveIssueUpdate('i1', 'u1')
    expect(res.ok).toBe(false)
  })

  it('작성자 본인은 그을 수 있고 취소 주체가 본인으로 기록된다', async () => {
    asMember()
    const { client, calls } = stubRowClient({ author_user_id: 'me', archived_at: null })
    state.client = client
    const res = await archiveIssueUpdate('i1', 'u1')
    expect(res.ok).toBe(true)
    expect(calls.updatePayload).toMatchObject({ archived_by: 'me', archived_by_name: '나' })
    expect(calls.updatePayload?.archived_at).toEqual(expect.any(String))
  })

  it('관리자는 남의 이력도 긋는다', async () => {
    asMember()
    requireProjectAdmin.mockResolvedValue({ ok: true, actor: ACTOR })
    const { client } = stubRowClient({ author_user_id: 'other', archived_at: null })
    state.client = client
    expect((await archiveIssueUpdate('i1', 'u1')).ok).toBe(true)
  })

  it('이미 그어진 이력은 거부한다', async () => {
    asMember()
    state.client = stubRowClient({ author_user_id: 'me', archived_at: '2026-08-19T00:00:00Z' }).client
    expect((await archiveIssueUpdate('i1', 'u1')).ok).toBe(false)
  })

  it('CAS 0행은 실패다 — 경합을 성공으로 뭉개지 않는다', async () => {
    asMember()
    state.client = stubRowClient({ author_user_id: 'me', archived_at: null }, { updatedRows: [] }).client
    expect((await archiveIssueUpdate('i1', 'u1')).ok).toBe(false)
  })

  it('없는 이력은 실패다', async () => {
    asMember()
    state.client = stubRowClient(null).client
    expect((await archiveIssueUpdate('i1', 'u1')).ok).toBe(false)
  })
})

describe('unarchiveIssueUpdate — 되돌리기 경로는 반드시 있어야 한다', () => {
  it('작성자가 되돌리면 archived_* 가 전부 NULL 이 된다', async () => {
    asMember()
    const { client, calls } = stubRowClient({ author_user_id: 'me', archived_at: '2026-08-19T00:00:00Z' })
    state.client = client
    const res = await unarchiveIssueUpdate('i1', 'u1')
    expect(res.ok).toBe(true)
    expect(calls.updatePayload).toEqual({ archived_at: null, archived_by: null, archived_by_name: null })
  })

  it('그어지지 않은 이력은 되돌릴 것이 없다', async () => {
    asMember()
    state.client = stubRowClient({ author_user_id: 'me', archived_at: null }).client
    expect((await unarchiveIssueUpdate('i1', 'u1')).ok).toBe(false)
  })
})

describe('purgeIssueUpdate — 완전 삭제는 관리자만', () => {
  it('멤버는 자기 이력도 완전삭제할 수 없다', async () => {
    asMember()
    state.client = stubRowClient({ author_user_id: 'me', archived_at: null }).client
    const res = await purgeIssueUpdate('i1', 'u1')
    expect(res.ok).toBe(false)
  })

  it('관리자는 삭제하고 미러가 재계산된다', async () => {
    asMember()
    requireProjectAdmin.mockResolvedValue({ ok: true, actor: ACTOR })
    const { client, calls } = stubRowClient({ author_user_id: 'other', archived_at: null })
    state.client = client
    const res = await purgeIssueUpdate('i1', 'u1')
    expect(res.ok).toBe(true)
    expect(calls.deleted).toBe(true)
  })

  it('DELETE 0행은 실패다', async () => {
    asMember()
    requireProjectAdmin.mockResolvedValue({ ok: true, actor: ACTOR })
    state.client = stubRowClient({ author_user_id: 'other', archived_at: null }, { deletedRows: [] }).client
    expect((await purgeIssueUpdate('i1', 'u1')).ok).toBe(false)
  })
})
```

- [ ] **Step 2: 테스트 실행해 실패 확인**

Run: `npx vitest run tests/actions/issue-updates-gate.test.ts`
Expected: FAIL — `archiveIssueUpdate is not a function` (또는 import 해석 실패)

- [ ] **Step 3: 구현 추가**

`src/app/actions/issueUpdates.ts` 하단에 append. 상단 import 에
`canArchiveUpdate, canPurgeUpdate` 를 `@/lib/domain/issueUpdates` 에서 추가한다.

```ts
/** 취소선·삭제 대상 행을 읽어 권한을 판정한다. 조회 실패를 '없음'으로 위장하지 않는다. */
async function loadTargetRow(
  sb: Awaited<ReturnType<typeof createServerClient>>,
  issueId: string,
  updateId: string,
): Promise<{ ok: true; authorUserId: string | null; archivedAt: string | null } | { ok: false; error: string }> {
  // issue_id 를 함께 조건에 넣는 이유: 호출자가 남의 이슈의 이력 id 를 보내도
  // 이 이슈의 권한으로 처리되지 않게 한다(게이트는 issueId 기준으로 통과했다).
  const { data, error } = await sb
    .from('issue_updates')
    .select('id, author_user_id, archived_at')
    .eq('id', updateId)
    .eq('issue_id', issueId)
    .maybeSingle()
  if (error) {
    console.error('[issueUpdates] 대상 이력 조회 실패:', error.message)
    return { ok: false, error: ERR_LOOKUP }
  }
  if (!data) return { ok: false, error: '이력을 찾을 수 없습니다.' }
  return {
    ok: true,
    authorUserId: (data.author_user_id as string | null) ?? null,
    archivedAt: (data.archived_at as string | null) ?? null,
  }
}

/** 취소선 처리 — 내용은 남기고 지웠다는 사실만 표시한다. */
export async function archiveIssueUpdate(issueId: string, updateId: string): Promise<IssueUpdateResult> {
  const g = await requireIssueMember(issueId)
  if (!g.ok) return { ok: false, error: g.error }
  const user = await getSession()
  if (!user) return { ok: false, error: '로그인 필요' }

  const sb = await createServerClient()
  const row = await loadTargetRow(sb, issueId, updateId)
  if (!row.ok) return { ok: false, error: row.error }
  if (!canArchiveUpdate({ authorUserId: row.authorUserId }, g.userId, g.isAdmin)) {
    return { ok: false, error: '권한 없음' }
  }
  if (row.archivedAt !== null) return { ok: false, error: '이미 취소선 처리된 이력입니다.' }

  // CAS + .select() — RLS 거부·경합으로 0행이어도 supabase-js 는 error 를 주지 않는다.
  const { data: updated, error } = await sb
    .from('issue_updates')
    .update({
      archived_at: new Date().toISOString(),
      archived_by: g.userId,
      archived_by_name: displayNameFrom(user.user_metadata, user.email) ?? NAME_FALLBACK,
    })
    .eq('id', updateId)
    .is('archived_at', null)
    .select('id')
  if (error) return { ok: false, error: error.message }
  if (!updated?.length) {
    console.error('[archiveIssueUpdate] 취소선 UPDATE 가 0행입니다:', updateId)
    return { ok: false, error: '다른 사용자가 먼저 처리했습니다. 새로고침 후 다시 시도하세요.' }
  }

  const mirrorErr = await syncResolutionNoteMirror(sb, issueId)
  revalidatePath(`/p/${g.projectId}/issues`)
  if (mirrorErr) return { ok: true, partial: `취소선은 처리됐지만 요약 반영에 실패했습니다(${mirrorErr}).` }
  return { ok: true }
}

/**
 * 취소선 되돌리기. 이 경로가 없으면 클릭 한 번이 사실상 영구 삭제가 된다
 * (WikiItemActions.tsx:33-36 의 규칙).
 */
export async function unarchiveIssueUpdate(issueId: string, updateId: string): Promise<IssueUpdateResult> {
  const g = await requireIssueMember(issueId)
  if (!g.ok) return { ok: false, error: g.error }

  const sb = await createServerClient()
  const row = await loadTargetRow(sb, issueId, updateId)
  if (!row.ok) return { ok: false, error: row.error }
  if (!canArchiveUpdate({ authorUserId: row.authorUserId }, g.userId, g.isAdmin)) {
    return { ok: false, error: '권한 없음' }
  }
  if (row.archivedAt === null) return { ok: false, error: '취소선이 그어진 이력이 아닙니다.' }

  // 셋을 한꺼번에 NULL 로 — 0087 의 with check 가 "전부 NULL 이거나, 본인이 그은 것"만 통과시킨다.
  const { data: updated, error } = await sb
    .from('issue_updates')
    .update({ archived_at: null, archived_by: null, archived_by_name: null })
    .eq('id', updateId)
    .not('archived_at', 'is', null)
    .select('id')
  if (error) return { ok: false, error: error.message }
  if (!updated?.length) {
    console.error('[unarchiveIssueUpdate] 되돌리기 UPDATE 가 0행입니다:', updateId)
    return { ok: false, error: '다른 사용자가 먼저 처리했습니다. 새로고침 후 다시 시도하세요.' }
  }

  const mirrorErr = await syncResolutionNoteMirror(sb, issueId)
  revalidatePath(`/p/${g.projectId}/issues`)
  if (mirrorErr) return { ok: true, partial: `되돌렸지만 요약 반영에 실패했습니다(${mirrorErr}).` }
  return { ok: true }
}

/** 완전 삭제 — 프로젝트 관리자만. 되돌릴 수 없다. */
export async function purgeIssueUpdate(issueId: string, updateId: string): Promise<IssueUpdateResult> {
  const g = await requireIssueMember(issueId)
  if (!g.ok) return { ok: false, error: g.error }
  if (!canPurgeUpdate(g.isAdmin)) return { ok: false, error: '권한 없음' }

  const sb = await createServerClient()
  const row = await loadTargetRow(sb, issueId, updateId)
  if (!row.ok) return { ok: false, error: row.error }

  const { data: gone, error } = await sb
    .from('issue_updates')
    .delete()
    .eq('id', updateId)
    .eq('issue_id', issueId)
    .select('id')
  if (error) return { ok: false, error: error.message }
  if (!gone?.length) {
    console.error('[purgeIssueUpdate] DELETE 가 0행입니다:', updateId)
    return { ok: false, error: '삭제에 실패했습니다.' }
  }

  const mirrorErr = await syncResolutionNoteMirror(sb, issueId)
  revalidatePath(`/p/${g.projectId}/issues`)
  if (mirrorErr) return { ok: true, partial: `삭제했지만 요약 반영에 실패했습니다(${mirrorErr}).` }
  return { ok: true }
}
```

- [ ] **Step 4: 테스트 실행해 통과 확인**

Run: `npx vitest run tests/actions/issue-updates-gate.test.ts`
Expected: PASS

- [ ] **Step 5: 커밋**

```bash
git add src/app/actions/issueUpdates.ts tests/actions/issue-updates-gate.test.ts
git commit -m "$(cat <<'EOF'
feat(issues): 이력 취소선·되돌리기·완전삭제를 추가한다

취소선은 작성자 본인 또는 프로젝트 관리자, 완전삭제는 관리자만. 되돌리기를
함께 넣은 이유는 복원 경로 없는 숨김은 클릭 한 번이 영구 삭제가 되기 때문이다.

대상 행 조회에 issue_id 를 함께 건 것은, 게이트가 issueId 로 통과했는데 남의
이슈의 이력 id 를 보내면 그 권한으로 처리되기 때문이다.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: UI — 이력 목록과 등록 폼

**Files:**
- Create: `src/components/issues/IssueUpdates.tsx`
- Modify: `src/components/issues/IssueModals.tsx` (import + `canWrite` prop + 배치)
- Modify: `src/components/issues/IssuesView.tsx:359-372` (canWrite 전달)
- Modify: `src/lib/i18n/dict/issues.ts` · `src/lib/i18n/dict/issues.en.ts`
- Modify: `tests/ui/deep-link-params.test.tsx` (액션 mock 추가 — 없으면 전체 테스트가 멈춘다)
- Test: `tests/ui/issue-updates.test.tsx`

**Interfaces:**
- Consumes: Task 2 의 `IssueUpdate`·`ISSUE_UPDATE_CATEGORIES`·`ISSUE_UPDATE_CATEGORY_META`·`ISSUE_UPDATE_BODY_MAX`·`parseStatusChange`·`canArchiveUpdate`. Task 3·4 의 5개 액션.
- Produces: `<IssueUpdates issueId={string} projectMemberIds={...} canWrite={boolean} currentUserId={string | null} isProjectAdmin={boolean} />`. Task 7 이 이 컴포넌트에 멘션 입력을 덧댄다.

- [ ] **Step 1: i18n 키 추가 (ko/en 동시)**

`src/lib/i18n/dict/issues.ts` 의 `'issue.detail.note'` 줄 **앞**에 추가:

```ts
  'issue.update.section': '조치/해결 경과',
  'issue.update.empty': '아직 기록된 경과가 없습니다.',
  'issue.update.add': '경과 등록',
  'issue.update.placeholder': '조치 내용과 경과를 기록하세요',
  'issue.update.category': '분류',
  'issue.update.categoryNone': '일반',
  'issue.update.cat.action': '조치',
  'issue.update.cat.discuss': '협의/질의',
  'issue.update.cat.followup': '추가이슈',
  'issue.update.cat.etc': '기타',
  'issue.update.more': '이전 경과 {n}건 더 보기',
  'issue.update.archive': '취소선',
  'issue.update.unarchive': '되돌리기',
  'issue.update.purge': '완전 삭제',
  'issue.update.purgeConfirm': '이 경과를 완전히 삭제합니다. 되돌릴 수 없습니다.',
  'issue.update.archivedBy': '{name} 님이 취소선 처리',
  'issue.update.hideArchived': '취소선 {n}건 숨기기',
  'issue.update.showArchived': '취소선 {n}건 보기',
  'issue.update.statusChange': '{from} → {to} 로 변경',
  'issue.update.migrated': '이관됨 · 작성 시각 추정',
  'issue.err.updateLoadFailed': '경과를 불러오지 못했습니다. 새로고침 후 다시 시도하세요.',
  'issue.err.updateSaveFailed': '경과 저장에 실패했습니다.',
```

`src/lib/i18n/dict/issues.en.ts` 의 같은 위치에 추가:

```ts
  'issue.update.section': 'Progress log',
  'issue.update.empty': 'No progress recorded yet.',
  'issue.update.add': 'Add entry',
  'issue.update.placeholder': 'Record actions taken and current progress',
  'issue.update.category': 'Category',
  'issue.update.categoryNone': 'General',
  'issue.update.cat.action': 'Action',
  'issue.update.cat.discuss': 'Discussion',
  'issue.update.cat.followup': 'Follow-up issue',
  'issue.update.cat.etc': 'Other',
  'issue.update.more': 'Show {n} earlier entries',
  'issue.update.archive': 'Strike out',
  'issue.update.unarchive': 'Undo strike-out',
  'issue.update.purge': 'Delete permanently',
  'issue.update.purgeConfirm': 'This permanently deletes the entry. It cannot be undone.',
  'issue.update.archivedBy': 'Struck out by {name}',
  'issue.update.hideArchived': 'Hide {n} struck-out',
  'issue.update.showArchived': 'Show {n} struck-out',
  'issue.update.statusChange': 'Changed {from} → {to}',
  'issue.update.migrated': 'Migrated · time approximate',
  'issue.err.updateLoadFailed': 'Could not load the progress log. Refresh and try again.',
  'issue.err.updateSaveFailed': 'Could not save the entry.',
```

- [ ] **Step 2: 실패하는 UI 테스트 작성**

`tests/ui/issue-updates.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const { listIssueUpdates, addIssueUpdate, archiveIssueUpdate, unarchiveIssueUpdate, purgeIssueUpdate } = vi.hoisted(() => ({
  listIssueUpdates: vi.fn(), addIssueUpdate: vi.fn(), archiveIssueUpdate: vi.fn(),
  unarchiveIssueUpdate: vi.fn(), purgeIssueUpdate: vi.fn(),
}))
vi.mock('@/app/actions/issueUpdates', () => ({
  listIssueUpdates, addIssueUpdate, archiveIssueUpdate, unarchiveIssueUpdate, purgeIssueUpdate,
}))
vi.mock('@/components/providers/LocaleProvider', () => ({
  useLocale: () => ({ locale: 'ko', t: (k: string) => k }),
}))

import { IssueUpdates } from '@/components/issues/IssueUpdates'
import type { IssueUpdate } from '@/lib/domain/issueUpdates'

function entry(over: Partial<IssueUpdate> = {}): IssueUpdate {
  return {
    id: 'u1', issueId: 'i1', kind: 'note', category: 'action', body: '첫 조치',
    mentionedMemberIds: [], authorUserId: 'me', authorName: '나',
    createdAt: '2026-08-19T01:00:00.000Z', archivedAt: null, archivedByName: null,
    ...over,
  }
}

const BASE = { issueId: 'i1', members: [], canWrite: true, currentUserId: 'me', isProjectAdmin: false }

beforeEach(() => {
  vi.clearAllMocks()
  listIssueUpdates.mockResolvedValue({ ok: true, items: [] })
})

describe('IssueUpdates 목록', () => {
  it('비어 있으면 안내 문구를 보여준다', async () => {
    render(<IssueUpdates {...BASE} />)
    expect(await screen.findByText('issue.update.empty')).toBeInTheDocument()
  })

  it('조회 실패를 빈 목록으로 위장하지 않는다', async () => {
    listIssueUpdates.mockResolvedValue({ ok: false, error: 'boom' })
    render(<IssueUpdates {...BASE} />)
    expect(await screen.findByText('issue.err.updateLoadFailed')).toBeInTheDocument()
  })

  it('취소선 항목은 line-through 로 남고 내용이 지워지지 않는다', async () => {
    listIssueUpdates.mockResolvedValue({
      ok: true,
      items: [entry({ body: '철회된 조치', archivedAt: '2026-08-19T02:00:00.000Z', archivedByName: '나' })],
    })
    render(<IssueUpdates {...BASE} />)
    const body = await screen.findByText('철회된 조치')
    expect(body.className).toContain('line-through')
  })

  it('6건이 넘으면 최신 5건만 펴고 더보기를 준다', async () => {
    listIssueUpdates.mockResolvedValue({
      ok: true,
      items: Array.from({ length: 7 }, (_, i) => entry({ id: `u${i}`, body: `내용${i}` })),
    })
    render(<IssueUpdates {...BASE} />)
    expect(await screen.findByText('내용6')).toBeInTheDocument()
    expect(screen.queryByText('내용0')).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /issue\.update\.more/ }))
    expect(screen.getByText('내용0')).toBeInTheDocument()
  })

  it('상태 자동 기록은 본문 대신 상태 라벨로 렌더한다', async () => {
    listIssueUpdates.mockResolvedValue({
      ok: true, items: [entry({ kind: 'status', category: null, body: 'open>resolved' })],
    })
    render(<IssueUpdates {...BASE} />)
    // 원문 'open>resolved' 가 그대로 노출되면 안 된다.
    expect(await screen.findByText(/issue\.update\.statusChange/)).toBeInTheDocument()
    expect(screen.queryByText('open>resolved')).not.toBeInTheDocument()
  })
})

describe('IssueUpdates 권한 어포던스', () => {
  it('조회 전용에게는 입력창이 없다', async () => {
    render(<IssueUpdates {...BASE} canWrite={false} />)
    await screen.findByText('issue.update.empty')
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
  })

  it('멤버에게는 입력창이 있다', async () => {
    render(<IssueUpdates {...BASE} />)
    expect(await screen.findByRole('textbox')).toBeInTheDocument()
  })

  it('남의 이력에는 취소선 버튼이 없다', async () => {
    listIssueUpdates.mockResolvedValue({ ok: true, items: [entry({ authorUserId: 'other' })] })
    render(<IssueUpdates {...BASE} />)
    await screen.findByText('첫 조치')
    expect(screen.queryByRole('button', { name: 'issue.update.archive' })).not.toBeInTheDocument()
  })

  it('관리자에게는 남의 이력에도 취소선·완전삭제가 보인다', async () => {
    listIssueUpdates.mockResolvedValue({ ok: true, items: [entry({ authorUserId: 'other' })] })
    render(<IssueUpdates {...BASE} isProjectAdmin />)
    await screen.findByText('첫 조치')
    expect(screen.getByRole('button', { name: 'issue.update.archive' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'issue.update.purge' })).toBeInTheDocument()
  })

  it('멤버에게는 자기 이력에도 완전삭제가 없다', async () => {
    listIssueUpdates.mockResolvedValue({ ok: true, items: [entry()] })
    render(<IssueUpdates {...BASE} />)
    await screen.findByText('첫 조치')
    expect(screen.queryByRole('button', { name: 'issue.update.purge' })).not.toBeInTheDocument()
  })
})

describe('IssueUpdates 등록', () => {
  it('등록 성공 후 입력창을 비우고 목록을 다시 읽는다', async () => {
    addIssueUpdate.mockResolvedValue({ ok: true })
    render(<IssueUpdates {...BASE} />)
    const box = await screen.findByRole('textbox')
    await userEvent.type(box, '새 조치')
    await userEvent.click(screen.getByRole('button', { name: 'issue.update.add' }))
    await waitFor(() => expect(addIssueUpdate).toHaveBeenCalledWith('i1', {
      body: '새 조치', category: null, mentionedMemberIds: [],
    }))
    await waitFor(() => expect(box).toHaveValue(''))
    expect(listIssueUpdates).toHaveBeenCalledTimes(2)
  })

  it('부분 실패를 성공으로 뭉개지 않는다', async () => {
    addIssueUpdate.mockResolvedValue({ ok: true, partial: '요약 반영 실패' })
    render(<IssueUpdates {...BASE} />)
    await userEvent.type(await screen.findByRole('textbox'), 'x')
    await userEvent.click(screen.getByRole('button', { name: 'issue.update.add' }))
    expect(await screen.findByText('요약 반영 실패')).toBeInTheDocument()
  })

  it('빈 본문으로는 등록 버튼이 눌리지 않는다', async () => {
    render(<IssueUpdates {...BASE} />)
    await screen.findByRole('textbox')
    expect(screen.getByRole('button', { name: 'issue.update.add' })).toBeDisabled()
  })
})
```

- [ ] **Step 3: 테스트 실행해 실패 확인**

Run: `npx vitest run tests/ui/issue-updates.test.tsx`
Expected: FAIL — `Failed to resolve import "@/components/issues/IssueUpdates"`

- [ ] **Step 4: 컴포넌트 구현**

`src/components/issues/IssueUpdates.tsx`:

```tsx
'use client'
// 이슈 조치/해결 경과 이력 — 목록 + 등록 폼.
//
// 구조는 IssueAttachments.tsx 복제다: 자체 load() 로 지연 로드하고 부모를 refresh 하지
// 않는다. IssueDetailModal 은 useEffect([issue]) 로 폼을 재베이스라인하므로(:202-207)
// 여기서 router.refresh() 를 하면 옆에서 입력 중인 내용이 리셋된다.
//
// 표시 토글은 전부 JSX 조건부 렌더다. 상태 변형 display 유틸은 globals.css 끝의 unlayered
// 안전망에 져서 조용히 동작하지 않는다.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { CircleSlash, MessageSquare, RotateCcw, Trash2 } from 'lucide-react'
import { useLocale } from '@/components/providers/LocaleProvider'
import {
  addIssueUpdate, archiveIssueUpdate, listIssueUpdates, purgeIssueUpdate, unarchiveIssueUpdate,
} from '@/app/actions/issueUpdates'
import {
  ISSUE_UPDATE_BODY_MAX,
  ISSUE_UPDATE_CATEGORIES,
  ISSUE_UPDATE_CATEGORY_META,
  canArchiveUpdate,
  canPurgeUpdate,
  parseStatusChange,
  type IssueUpdate,
  type IssueUpdateCategory,
} from '@/lib/domain/issueUpdates'
import { ISSUE_STATUS_META } from '@/lib/domain/issues'
import type { ProjectMember } from '@/lib/domain/types'

/** 기본으로 펴는 건수 — 모달 본문이 max-h-[70vh] 스크롤 박스라 전량을 펴면 푸터가 밀린다. */
const VISIBLE_DEFAULT = 5

export interface IssueUpdatesProps {
  issueId: string
  /** 멘션 후보(Task 7 에서 쓴다). 지금은 길이만 참조하지 않는다. */
  members: ProjectMember[]
  /** 프로젝트 멤버 이상인가 — 입력 UI 노출 기준. canEdit(이슈 작성자 축)과 다른 축이다. */
  canWrite: boolean
  currentUserId: string | null
  isProjectAdmin: boolean
}

function fmtAt(iso: string, locale: string): string {
  const d = new Date(iso)
  return d.toLocaleString(locale === 'en' ? 'en-US' : 'ko-KR', {
    month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit',
  })
}

export function IssueUpdates({ issueId, members, canWrite, currentUserId, isProjectAdmin }: IssueUpdatesProps) {
  const { t, locale } = useLocale()
  const [list, setList] = useState<IssueUpdate[] | null>(null)
  // 실패 '여부'만 담는다 — 번역문을 state 에 넣으면 load 가 t 에 의존해 무한 루프가 된다.
  const [loadFailed, setLoadFailed] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const [showArchived, setShowArchived] = useState(true)
  const [body, setBody] = useState('')
  const [category, setCategory] = useState<IssueUpdateCategory | ''>('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const load = useCallback(() => {
    listIssueUpdates(issueId)
      .then(res => {
        if (res.ok) { setList(res.items); setLoadFailed(false); return }
        // 조회 실패를 '경과 없음'으로 위장하면 사용자는 조치 이력이 소실됐다고 읽는다.
        console.error('[IssueUpdates] 이력 조회 실패:', res.error)
        setList([]); setLoadFailed(true)
      })
      .catch((cause: unknown) => {
        console.error('[IssueUpdates] 이력 조회 호출 실패:', cause)
        setList([]); setLoadFailed(true)
      })
  }, [issueId])
  useEffect(() => { setList(null); load() }, [issueId, load])

  const all = useMemo(() => list ?? [], [list])
  const archivedCount = all.filter(u => u.archivedAt !== null).length
  const shown = showArchived ? all : all.filter(u => u.archivedAt === null)
  const hiddenCount = Math.max(0, shown.length - VISIBLE_DEFAULT)
  const visible = expanded ? shown : shown.slice(-VISIBLE_DEFAULT)

  async function run(fn: () => Promise<{ ok: boolean; error?: string; partial?: string }>) {
    setBusy(true); setErr(null); setNotice(null)
    try {
      const res = await fn()
      if (!res.ok) { setErr(res.error ?? t('issue.err.updateSaveFailed')); return false }
      if (res.partial) setNotice(res.partial)
      load()
      return true
    } finally { setBusy(false) }
  }

  async function submit() {
    const text = body.trim()
    if (text.length === 0) return
    const ok = await run(() => addIssueUpdate(issueId, {
      body: text,
      category: category === '' ? null : category,
      mentionedMemberIds: [],
    }))
    // 성공했을 때만 비운다 — 실패했는데 지우면 사용자가 쓴 글이 사라진다.
    if (ok) { setBody(''); setCategory('') }
  }

  return (
    <section className="space-y-3 rounded-2xl border border-line bg-surface-2 p-4">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-subtle">
          <MessageSquare className="h-3.5 w-3.5" aria-hidden /> {t('issue.update.section')}
        </div>
        {archivedCount > 0 && (
          <button
            type="button"
            onClick={() => setShowArchived(v => !v)}
            className="text-[11px] font-medium text-ink-subtle hover:text-ink"
          >
            {(showArchived ? t('issue.update.hideArchived') : t('issue.update.showArchived'))
              .replace('{n}', String(archivedCount))}
          </button>
        )}
      </div>

      {loadFailed && <p className="text-xs font-medium text-delayed">{t('issue.err.updateLoadFailed')}</p>}
      {err && <p className="text-xs font-medium text-delayed">{err}</p>}
      {notice && <p className="text-xs font-medium text-delayed">{notice}</p>}

      {list == null ? (
        <p className="text-sm text-ink-subtle">{t('common.loading')}</p>
      ) : shown.length === 0 ? (
        <p className="text-sm text-ink-subtle">{t('issue.update.empty')}</p>
      ) : (
        <>
          {!expanded && hiddenCount > 0 && (
            <button
              type="button"
              onClick={() => setExpanded(true)}
              className="text-[11px] font-medium text-brand hover:underline"
            >
              {t('issue.update.more').replace('{n}', String(hiddenCount))}
            </button>
          )}
          <ol className="space-y-2">
            {visible.map(u => {
              const archived = u.archivedAt !== null
              const status = u.kind === 'status' ? parseStatusChange(u.body) : null
              const mayArchive = canWrite && canArchiveUpdate(u, currentUserId, isProjectAdmin) && u.kind === 'note'
              const mayPurge = canWrite && canPurgeUpdate(isProjectAdmin)
              return (
                <li
                  key={u.id}
                  className={`rounded-lg border border-line px-2.5 py-2 ${
                    u.kind === 'status' ? 'bg-surface-1/40' : 'bg-surface-1'
                  }`}
                >
                  <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-ink-subtle">
                    <span className="font-medium text-ink-muted">{u.authorName}</span>
                    <span aria-hidden>·</span>
                    <time dateTime={u.createdAt}>{fmtAt(u.createdAt, locale)}</time>
                    {u.category && (
                      <span className="rounded bg-surface-2 px-1.5 py-0.5 text-[10px] font-medium text-ink-muted">
                        {t(ISSUE_UPDATE_CATEGORY_META[u.category].labelKey)}
                      </span>
                    )}
                    <span className="ml-auto flex items-center gap-1">
                      {mayArchive && !archived && (
                        <button
                          type="button" disabled={busy}
                          onClick={() => run(() => archiveIssueUpdate(issueId, u.id))}
                          aria-label={t('issue.update.archive')} title={t('issue.update.archive')}
                          className="rounded p-0.5 text-ink-subtle hover:text-delayed"
                        >
                          <CircleSlash className="h-3.5 w-3.5" aria-hidden />
                        </button>
                      )}
                      {mayArchive && archived && (
                        <button
                          type="button" disabled={busy}
                          onClick={() => run(() => unarchiveIssueUpdate(issueId, u.id))}
                          aria-label={t('issue.update.unarchive')} title={t('issue.update.unarchive')}
                          className="rounded p-0.5 text-ink-subtle hover:text-ink"
                        >
                          <RotateCcw className="h-3.5 w-3.5" aria-hidden />
                        </button>
                      )}
                      {mayPurge && (
                        <button
                          type="button" disabled={busy}
                          onClick={() => { if (confirmPurge()) void run(() => purgeIssueUpdate(issueId, u.id)) }}
                          aria-label={t('issue.update.purge')} title={t('issue.update.purge')}
                          className="rounded p-0.5 text-ink-subtle hover:text-delayed"
                        >
                          <Trash2 className="h-3.5 w-3.5" aria-hidden />
                        </button>
                      )}
                    </span>
                  </div>
                  {status ? (
                    <p className="mt-1 text-[13px] text-ink-muted">
                      {t('issue.update.statusChange')
                        .replace('{from}', t(ISSUE_STATUS_META[status.from].labelKey))
                        .replace('{to}', t(ISSUE_STATUS_META[status.to].labelKey))}
                    </p>
                  ) : (
                    <p
                      className={`mt-1 whitespace-pre-wrap text-[13px] leading-5 ${
                        archived ? 'text-ink-muted line-through decoration-ink-subtle/50' : 'text-ink'
                      }`}
                    >
                      {u.body}
                    </p>
                  )}
                  {archived && u.archivedByName && (
                    <p className="mt-1 text-[11px] text-ink-subtle">
                      {t('issue.update.archivedBy').replace('{name}', u.archivedByName)}
                    </p>
                  )}
                </li>
              )
            })}
          </ol>
        </>
      )}

      {canWrite && (
        <div className="space-y-2">
          <textarea
            className="app-textarea min-h-[72px] resize-y"
            value={body}
            maxLength={ISSUE_UPDATE_BODY_MAX}
            onChange={e => setBody(e.target.value)}
            placeholder={t('issue.update.placeholder')}
          />
          <div className="flex items-center gap-2">
            <label className="sr-only" htmlFor="issue-update-category">{t('issue.update.category')}</label>
            <select
              id="issue-update-category"
              className="app-input h-8 w-auto text-xs"
              value={category}
              onChange={e => setCategory(e.target.value as IssueUpdateCategory | '')}
            >
              <option value="">{t('issue.update.categoryNone')}</option>
              {ISSUE_UPDATE_CATEGORIES.map(c => (
                <option key={c} value={c}>{t(ISSUE_UPDATE_CATEGORY_META[c].labelKey)}</option>
              ))}
            </select>
            <button
              type="button"
              onClick={submit}
              disabled={busy || body.trim().length === 0}
              className="btn btn-primary ml-auto h-8 text-xs"
            >
              {t('issue.update.add')}
            </button>
          </div>
        </div>
      )}
    </section>
  )
}

/**
 * 완전 삭제 확인. window.confirm 은 Modal 의 Escape·포커스 트랩과 싸우지 않는 유일하게
 * 값싼 수단이고, 이 앱의 다른 파괴적 동작은 전용 모달을 쓰지만 그건 이슈 단위다.
 * 이력 한 건에 모달을 하나 더 띄우면 모달 안의 모달이 된다.
 */
function confirmPurge(): boolean {
  if (typeof window === 'undefined') return false
  return window.confirm('이 경과를 완전히 삭제합니다. 되돌릴 수 없습니다.')
}
```

> **주의:** `window.confirm` 은 브라우저 모달 대화상자다. 자동화 도구로 화면을 검증할 때 이
> 버튼을 누르면 세션이 멈출 수 있다. 실화면 확인은 사람이 한다.

- [ ] **Step 5: 테스트 실행 — 통과 확인**

Run: `npx vitest run tests/ui/issue-updates.test.tsx`
Expected: PASS. 실패하면 `confirmPurge` 가 jsdom 에서 `window.confirm` 미구현으로 throw 하는지
확인하고, 테스트에 `vi.spyOn(window, 'confirm').mockReturnValue(true)` 를 추가한다.

- [ ] **Step 6: 상세 모달에 배치하고 canWrite 를 관통시킨다**

`src/components/issues/IssueModals.tsx`:

1. import 에 추가: `import { IssueUpdates } from './IssueUpdates'`
2. `IssueDetailModal` 의 props 타입(:178-189)에 두 줄 추가하고 구조분해에도 넣는다.

```tsx
export function IssueDetailModal({
  issue, members, memberName, canEdit, canWrite, currentUserId, isProjectAdmin, today, onClose, onEdit, onDelete,
}: {
  issue: Issue | null
  members: ProjectMember[]
  memberName: (id: string | null) => string | null
  /** 이슈 전체 편집·삭제 게이트(작성자 또는 pmo_admin). 이력 등록 권한과는 다른 축이다. */
  canEdit: boolean
  /** 프로젝트 멤버 이상 — 이력 등록 어포던스 기준. canEdit 을 재사용하면 남이 만든 이슈에
   *  일반 멤버가 경과를 못 쓴다(컴파일 에러가 없어 리뷰 전까지 드러나지 않는다). */
  canWrite: boolean
  currentUserId: string | null
  isProjectAdmin: boolean
  today: string
  onClose: () => void
  onEdit: () => void
  onDelete: () => void
}) {
```

3. `<IssueAttachments issueId={issue.id} />`(:424) **바로 아래**에 삽입:

```tsx
          {/* 이력은 진행 편집 블록 앞에 둔다 — 첨부와 같은 이유로 푸터 '진행 저장'의
              대상이 흐려지지 않게 한다. */}
          <IssueUpdates
            issueId={issue.id}
            members={members}
            canWrite={canWrite}
            currentUserId={currentUserId}
            isProjectAdmin={isProjectAdmin}
          />
```

`src/components/issues/IssuesView.tsx`:

4. props 에 `isProjectAdmin: boolean` 을 추가한다(:30-40).

```tsx
export function IssuesView({
  issues, members, projectId, currentUserId, role, isProjectAdmin, myMemberIds, today,
}: {
  issues: Issue[]
  members: ProjectMember[]
  projectId: string
  currentUserId: string | null
  role: string | null
  /** 프로젝트 관리자 이상인가. role 은 legacy shim 이라 관리자 판정에 쓰지 않는다. */
  isProjectAdmin: boolean
  myMemberIds: string[]
  today: string
}) {
```

5. `<IssueDetailModal>`(:359-372) 호출에 세 줄 추가:

```tsx
      <IssueDetailModal
        issue={viewing}
        members={members}
        memberName={memberName}
        canEdit={viewing ? canEditIssue(viewing, currentUserId, role) : false}
        canWrite={canWrite}
        currentUserId={currentUserId}
        isProjectAdmin={isProjectAdmin}
        today={today}
```

`src/app/(app)/p/[projectId]/issues/page.tsx`:

6. `<IssuesView …>` 호출에 `isProjectAdmin={…}` 을 넘긴다. 페이지가 이미 actor 를 읽고
   `effectiveLegacyRole` 로 평탄화하고 있으므로, 평탄화 **전**의 값에서 관리자 여부를 구해
   전달한다. 정확한 표현식은 그 파일의 기존 actor 획득 코드에 맞춘다 —
   `isProjectAdmin(actor, projectId)`(`@/lib/domain/authz`) 를 쓰고, 새 가드를 만들지 않는다.

- [ ] **Step 7: 기존 딥링크 테스트에 액션 mock 추가**

`tests/ui/deep-link-params.test.tsx` 의 `vi.mock('@/app/actions/issueAttachments', …)`(:63-68)
**바로 아래**에 추가한다. 이 파일은 `IssuesView` 를 렌더해 상세 모달까지 내려가므로,
모킹하지 않으면 `listIssueUpdates` 가 실제로 실행돼 테스트가 멈춘다.

```ts
// 상세 모달이 조치 경과 이력을 조회한다(0087). 서버 액션이라 여기서 막지 않으면
// 딥링크 테스트가 멈춘다 — 위 issueAttachments 와 같은 이유다.
vi.mock('@/app/actions/issueUpdates', () => ({
  listIssueUpdates:     vi.fn(async () => ({ ok: true, items: [] })),
  addIssueUpdate:       vi.fn(async () => ({ ok: true })),
  archiveIssueUpdate:   vi.fn(async () => ({ ok: true })),
  unarchiveIssueUpdate: vi.fn(async () => ({ ok: true })),
  purgeIssueUpdate:     vi.fn(async () => ({ ok: true })),
}))
```

이 파일이 `IssuesView` 를 직접 렌더한다면 새 필수 prop `isProjectAdmin` 도 넘겨야 한다
(`isProjectAdmin={false}`).

- [ ] **Step 8: 전체 테스트·타입체크·린트**

Run: `npm run lint && npx tsc --noEmit && npm run test`
Expected: 전부 통과. `isProjectAdmin` 누락으로 타입 에러가 나는 호출부를 전부 채운다.

- [ ] **Step 9: 커밋**

```bash
git add src/components/issues/IssueUpdates.tsx src/components/issues/IssueModals.tsx \
        src/components/issues/IssuesView.tsx src/app/\(app\)/p/\[projectId\]/issues/page.tsx \
        src/lib/i18n/dict/issues.ts src/lib/i18n/dict/issues.en.ts \
        tests/ui/issue-updates.test.tsx tests/ui/deep-link-params.test.tsx
git commit -m "$(cat <<'EOF'
feat(issues): 조치 경과 이력 화면을 상세 모달에 붙인다

첨부와 같은 자리·같은 구조다 — 자체 load() 로 갱신하고 부모를 refresh 하지
않는다. 상세 모달이 useEffect([issue]) 로 폼을 재베이스라인하기 때문에
refresh 하면 옆에서 입력 중인 내용이 리셋된다.

canWrite 를 새 prop 으로 관통시킨 이유는 모달에 이미 내려오는 canEdit 이
'이슈 작성자 또는 pmo_admin' 축이라서다. 그걸 재사용하면 남이 만든 이슈에
일반 멤버가 경과를 못 쓰는데 컴파일 에러가 나지 않는다.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: 알림 — 카탈로그 2종 + 담당자 발행

**Files:**
- Modify: `src/lib/domain/inbox.ts:22-24` (카탈로그)
- Modify: `src/app/actions/issueUpdates.ts` (`addIssueUpdate` 에 발행 추가)
- Test: `tests/actions/issue-updates-gate.test.ts` (append)

**Interfaces:**
- Consumes: `emitNotification` from `@/lib/notify/emit` — 시그니처 `{ type, projectId, actorUserId?, entityType?, entityId?, payload: { title; detail?; href? }, recipientMemberIds?, recipientUserIds?, dedupeKey? }`. member→user 해석과 작성자 제외를 emit 이 한다(`emit.ts:23-37`).
- Produces: 알림 타입 `'issue.update'` · `'issue.mention'`. Task 7 이 `issue.mention` 수신자를 채운다.

- [ ] **Step 1: 실패하는 테스트 추가**

`tests/actions/issue-updates-gate.test.ts` 상단 mock 목록에 추가:

```ts
const { emitNotification } = vi.hoisted(() => ({ emitNotification: vi.fn(async () => ({ ok: true })) }))
vi.mock('@/lib/notify/emit', () => ({ emitNotification }))
```

`stubClient` 의 `from()` 에 `issue_assignees` 갈래를 추가한다:

```ts
      if (table === 'issue_assignees') {
        return { select: () => ({ eq: async () => ({ data: (over.assigneeIds ?? []).map(id => ({ member_id: id })), error: null }) }) }
      }
```
(`stubClient` 의 옵션 타입에 `assigneeIds?: string[]` 를 추가하고, `issues` 갈래의 `update` 앞에
`select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { title: '이슈 제목' }, error: null }) }) })` 를 더한다.)

테스트 추가:

```ts
describe('addIssueUpdate 알림', () => {
  it('담당자에게 issue.update 를 member 축으로 보낸다', async () => {
    asMember()
    state.client = stubClient({ latestNote: '내용', assigneeIds: ['m1', 'm2'] }).client
    await addIssueUpdate('i1', { body: '내용', category: null, mentionedMemberIds: [] })
    expect(emitNotification).toHaveBeenCalledWith(expect.objectContaining({
      type: 'issue.update',
      projectId: 'p1',
      actorUserId: 'me',
      recipientMemberIds: ['m1', 'm2'],
      dedupeKey: 'issue.update:i1:u1',
    }))
    // auth uuid 축으로 보내면 안 된다 — 클라이언트에도 서버 액션에도 그 값이 없다.
    expect(emitNotification).not.toHaveBeenCalledWith(expect.objectContaining({ recipientUserIds: expect.anything() }))
  })

  it('담당자가 없으면 알림을 보내지 않는다', async () => {
    asMember()
    state.client = stubClient({ latestNote: '내용', assigneeIds: [] }).client
    await addIssueUpdate('i1', { body: '내용', category: null, mentionedMemberIds: [] })
    expect(emitNotification).not.toHaveBeenCalled()
  })

  it('알림 실패가 이력 저장을 실패로 만들지는 않는다 — 부분 실패로 고지한다', async () => {
    asMember()
    emitNotification.mockResolvedValueOnce({ ok: false })
    state.client = stubClient({ latestNote: '내용', assigneeIds: ['m1'] }).client
    const res = await addIssueUpdate('i1', { body: '내용', category: null, mentionedMemberIds: [] })
    expect(res.ok).toBe(true)
    expect(res.ok && res.partial).toBeTruthy()
  })
})
```

- [ ] **Step 2: 테스트 실행해 실패 확인**

Run: `npx vitest run tests/actions/issue-updates-gate.test.ts`
Expected: FAIL — `emitNotification` 이 호출되지 않음

- [ ] **Step 3: 카탈로그에 두 타입 추가**

`src/lib/domain/inbox.ts` 의 `'issue.status'` 줄(:23) 바로 아래에 추가:

```ts
  // 조치 경과 이력(0087). defaultOn 을 true 로 둔 이유: prefs.notif 를 쓰는 코드가
  // 아직 없어(읽기는 actions/inbox.ts:56 한 곳, 쓰기 0건) false 로 두면 영구히 발행되지
  // 않는 죽은 타입이 된다. 소음은 설계로 억제한다 — 이력 1건당 이벤트 1건(dedupeKey),
  // kind='status' 자동 기록은 발행하지 않음, 담당자 팬아웃 이슈당 평균 2.74명(실측).
  'issue.update':        { category: 'issue',  defaultOn: true,  required: false },
  'issue.mention':       { category: 'issue',  defaultOn: true,  required: false },
```

- [ ] **Step 4: `addIssueUpdate` 에 발행 추가**

`src/app/actions/issueUpdates.ts`:

1. import 추가: `import { emitNotification } from '@/lib/notify/emit'`
2. `syncResolutionNoteMirror` 호출 **앞**(INSERT 성공 직후)에 아래를 넣는다.

```ts
  const updateId = inserted.id as string

  // 알림 — 담당자에게. member 축 그대로 넘긴다: 클라이언트에도 이 액션에도 다른 사람의
  // auth uuid 가 없고(domain/types.ts:69), emit.ts:28-36 이 project_members 조인으로
  // user_id 를 풀고 작성자 본인 제외까지 처리한다.
  let notifyErr: string | null = null
  const { data: issueRow, error: issueErr } = await sb
    .from('issues').select('title').eq('id', issueId).maybeSingle()
  if (issueErr) {
    console.error('[addIssueUpdate] 알림용 이슈 제목 조회 실패:', issueErr.message)
    notifyErr = '알림 발송에 실패했습니다.'
  }
  const { data: assignees, error: asgErr } = await sb
    .from('issue_assignees').select('member_id').eq('issue_id', issueId)
  if (asgErr) {
    console.error('[addIssueUpdate] 알림용 담당자 조회 실패:', asgErr.message)
    notifyErr = '알림 발송에 실패했습니다.'
  }
  const recipients = (assignees ?? []).map((a: { member_id: string }) => a.member_id)
  if (notifyErr === null && recipients.length > 0) {
    const emitted = await emitNotification({
      type: 'issue.update',
      projectId: g.projectId,
      actorUserId: g.userId,
      entityType: 'issue',
      entityId: issueId,
      payload: {
        title: (issueRow?.title as string | undefined) ?? '이슈',
        detail: '조치 경과가 등록되었습니다',
        href: `/p/${g.projectId}/issues?focus=${issueId}`,
      },
      recipientMemberIds: recipients,
      dedupeKey: `issue.update:${issueId}:${updateId}`,
    })
    if (!emitted.ok) notifyErr = '알림 발송에 실패했습니다.'
  }
```

3. 마지막 반환부를 두 실패를 합치도록 바꾼다:

```ts
  const mirrorErr = await syncResolutionNoteMirror(sb, issueId)
  revalidatePath(`/p/${g.projectId}/issues`)
  const partial = [
    mirrorErr ? `요약 반영에 실패했습니다(${mirrorErr})` : null,
    notifyErr,
  ].filter(Boolean).join(' ')
  if (partial) return { ok: true, partial: `이력은 저장됐습니다. ${partial}` }
  return { ok: true }
```

- [ ] **Step 5: 테스트 실행해 통과 확인**

Run: `npx vitest run tests/actions/issue-updates-gate.test.ts tests/domain/inbox.test.ts`
Expected: PASS. `inbox.test.ts` 가 깨지면 `required: true` 를 잘못 넣은 것이다.

- [ ] **Step 6: 커밋**

```bash
git add src/lib/domain/inbox.ts src/app/actions/issueUpdates.ts tests/actions/issue-updates-gate.test.ts
git commit -m "$(cat <<'EOF'
feat(issues): 경과 등록 시 담당자에게 알림을 보낸다

상대가 모르면 소통이 성립하지 않는다. 수신자는 member 축으로 넘긴다 —
클라이언트에도 이 액션에도 남의 auth uuid 가 없고, emit 이 project_members
조인으로 user_id 를 풀고 작성자 제외까지 한다.

defaultOn 을 true 로 둔 것은 알림 설정을 쓰는 코드가 아직 없어서다. false 면
영구히 발행되지 않는 죽은 타입이 된다. 소음은 dedupeKey 와 status 자동 기록
제외로 억제한다.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: 멘션 입력

**Files:**
- Modify: `src/components/issues/IssueUpdates.tsx`
- Modify: `src/app/actions/issueUpdates.ts` (`issue.mention` 발행)
- Modify: `src/lib/i18n/dict/issues.ts` · `issues.en.ts`
- Test: `tests/ui/issue-updates.test.tsx` (append), `tests/actions/issue-updates-gate.test.ts` (append)

**Interfaces:**
- Consumes: Task 2 의 `parseMentions`. `ProjectMember` 의 `id`·`name`·`hasAccount`(`src/lib/domain/types.ts`).
- Produces: `addIssueUpdate` 의 `mentionedMemberIds` 가 실제로 채워진다. 알림 타입 `issue.mention` 발행.

- [ ] **Step 1: i18n 두 키 추가 (ko/en)**

ko: `'issue.update.mentionHint': '@를 입력하면 팀원을 부를 수 있습니다',`
en: `'issue.update.mentionHint': 'Type @ to mention a teammate',`

- [ ] **Step 2: 실패하는 UI 테스트 추가**

`tests/ui/issue-updates.test.tsx` 에 append:

```tsx
const MEMBERS = [
  { id: 'm1', name: '김준기', hasAccount: true },
  { id: 'm2', name: '남순혁', hasAccount: true },
  { id: 'm3', name: '계정없음', hasAccount: false },
] as never[]

describe('멘션 입력', () => {
  it('@ 를 치면 계정이 연결된 멤버만 후보로 뜬다', async () => {
    render(<IssueUpdates {...BASE} members={MEMBERS} />)
    await userEvent.type(await screen.findByRole('textbox'), '@')
    expect(screen.getByRole('button', { name: '김준기' })).toBeInTheDocument()
    // 계정이 없으면 알림이 갈 수 없다 — 후보에서 뺀다.
    expect(screen.queryByRole('button', { name: '계정없음' })).not.toBeInTheDocument()
  })

  it('후보를 고르면 본문에 이름이 들어가고 등록 시 member id 로 전송된다', async () => {
    addIssueUpdate.mockResolvedValue({ ok: true })
    render(<IssueUpdates {...BASE} members={MEMBERS} />)
    const box = await screen.findByRole('textbox')
    await userEvent.type(box, '@김준')
    await userEvent.click(screen.getByRole('button', { name: '김준기' }))
    expect(box).toHaveValue('@김준기 ')
    await userEvent.type(box, '확인 부탁드립니다')
    await userEvent.click(screen.getByRole('button', { name: 'issue.update.add' }))
    await waitFor(() => expect(addIssueUpdate).toHaveBeenCalledWith('i1', {
      body: '@김준기 확인 부탁드립니다', category: null, mentionedMemberIds: ['m1'],
    }))
  })

  it('골랐다가 본문에서 지운 멘션은 전송되지 않는다', async () => {
    addIssueUpdate.mockResolvedValue({ ok: true })
    render(<IssueUpdates {...BASE} members={MEMBERS} />)
    const box = await screen.findByRole('textbox')
    await userEvent.type(box, '@김준')
    await userEvent.click(screen.getByRole('button', { name: '김준기' }))
    await userEvent.clear(box)
    await userEvent.type(box, '그냥 메모')
    await userEvent.click(screen.getByRole('button', { name: 'issue.update.add' }))
    await waitFor(() => expect(addIssueUpdate).toHaveBeenCalledWith('i1', {
      body: '그냥 메모', category: null, mentionedMemberIds: [],
    }))
  })
})
```

- [ ] **Step 3: 테스트 실행해 실패 확인**

Run: `npx vitest run tests/ui/issue-updates.test.tsx`
Expected: FAIL — 후보 버튼이 없음

- [ ] **Step 4: 컴포넌트에 멘션 입력 구현**

`src/components/issues/IssueUpdates.tsx`:

1. import 에 `parseMentions` 추가.
2. state 추가:

```tsx
  // 자동완성에서 실제로 고른 사람들. 문자열이 아니라 이 목록을 기준으로 대조한다 —
  // 손으로 타이핑한 @아무개 는 대상이 아니고(id 를 모른다), 동명이인은 이름으로 못 가른다.
  const [picked, setPicked] = useState<{ id: string; name: string }[]>([])
  const [mentionQuery, setMentionQuery] = useState<string | null>(null)

  // 계정이 연결되지 않은 멤버는 후보에서 뺀다 — 알림이 갈 수 없다.
  const mentionCandidates = useMemo(() => {
    if (mentionQuery === null) return []
    const q = mentionQuery.trim()
    return members
      .filter(m => m.hasAccount)
      .filter(m => q === '' || m.name.includes(q))
      .slice(0, 8)
  }, [members, mentionQuery])
```

3. textarea 의 `onChange` 를 교체해 `@` 이후 토막을 추적한다:

```tsx
  function onBodyChange(next: string) {
    setBody(next)
    // 마지막 '@' 이후에 공백·줄바꿈이 없으면 그 토막을 검색어로 본다.
    const at = next.lastIndexOf('@')
    if (at === -1) { setMentionQuery(null); return }
    const tail = next.slice(at + 1)
    setMentionQuery(/[\s\n]/.test(tail) ? null : tail)
  }

  function pick(m: { id: string; name: string }) {
    const at = body.lastIndexOf('@')
    if (at === -1) return
    setBody(`${body.slice(0, at)}@${m.name} `)
    setPicked(prev => (prev.some(p => p.id === m.id) ? prev : [...prev, m]))
    setMentionQuery(null)
  }
```

textarea 의 `onChange={e => setBody(e.target.value)}` 를 `onChange={e => onBodyChange(e.target.value)}` 로 바꾼다.

4. textarea **바로 아래**(같은 `div.space-y-2` 안, 카테고리 줄 앞)에 인라인 후보 목록을 넣는다.

```tsx
          {/* 절대배치 드롭다운을 쓰지 않는 이유 둘.
              (1) Modal 패널이 overflow-hidden, 본문이 max-h-[70vh] overflow-y-auto 라
                  abspos 목록이 스크롤 박스에 잘린다(Modal.tsx:88,96).
              (2) Modal 은 document 리스너로 Escape 를 무조건 닫기에 쓴다(Modal.tsx:59,72).
                  React 합성 stopPropagation 으로는 그 리스너를 막지 못하고, 닫히면
                  작성 중 본문이 사라진다(IssuesView.tsx:365 에 dirty 가드가 없다).
              인라인 목록이면 Escape 를 가로챌 필요가 없다. */}
          {mentionCandidates.length > 0 && (
            <ul className="flex flex-wrap gap-1 rounded-lg border border-line bg-surface-1 p-1.5">
              {mentionCandidates.map(m => (
                <li key={m.id}>
                  <button
                    type="button"
                    onClick={() => pick(m)}
                    className="rounded px-2 py-1 text-xs text-ink-muted hover:bg-surface-2 hover:text-ink"
                  >
                    {m.name}
                  </button>
                </li>
              ))}
            </ul>
          )}
          <p className="text-[11px] text-ink-subtle">{t('issue.update.mentionHint')}</p>
```

5. `submit()` 에서 멘션을 계산해 넘기고, 성공 시 `picked` 도 비운다:

```tsx
  async function submit() {
    const text = body.trim()
    if (text.length === 0) return
    const ok = await run(() => addIssueUpdate(issueId, {
      body: text,
      category: category === '' ? null : category,
      mentionedMemberIds: parseMentions(text, picked),
    }))
    if (ok) { setBody(''); setCategory(''); setPicked([]); setMentionQuery(null) }
  }
```

- [ ] **Step 5: 액션에 `issue.mention` 발행 추가**

`src/app/actions/issueUpdates.ts` 의 Task 6 알림 블록을 확장한다. 담당자 발행 앞에 넣는다:

```ts
  // 멘션이 담당자보다 우선한다 — 두 알림을 다 받으면 중복이다.
  const mentionSet = new Set(mentioned)
  const assigneeOnly = recipients.filter(id => !mentionSet.has(id))
```

그리고 `recipients` 를 쓰는 자리를 `assigneeOnly` 로 바꾼 뒤, 그 아래에 추가:

```ts
  if (notifyErr === null && mentioned.length > 0) {
    const emitted = await emitNotification({
      type: 'issue.mention',
      projectId: g.projectId,
      actorUserId: g.userId,
      entityType: 'issue',
      entityId: issueId,
      payload: {
        title: (issueRow?.title as string | undefined) ?? '이슈',
        detail: '조치 경과에서 회원님을 언급했습니다',
        href: `/p/${g.projectId}/issues?focus=${issueId}`,
      },
      recipientMemberIds: mentioned,
      dedupeKey: `issue.mention:${issueId}:${updateId}`,
    })
    if (!emitted.ok) notifyErr = '알림 발송에 실패했습니다.'
  }
```

- [ ] **Step 6: 액션 테스트 추가**

`tests/actions/issue-updates-gate.test.ts` 에 append:

```ts
describe('멘션 알림', () => {
  it('멘션된 담당자에게는 mention 만 가고 update 는 가지 않는다', async () => {
    asMember()
    state.client = stubClient({ latestNote: '내용', assigneeIds: ['m1', 'm2'], memberIds: ['m1'] }).client
    await addIssueUpdate('i1', { body: '@김 확인', category: null, mentionedMemberIds: ['m1'] })
    const types = emitNotification.mock.calls.map(c => (c[0] as { type: string; recipientMemberIds: string[] }))
    expect(types.find(x => x.type === 'issue.mention')?.recipientMemberIds).toEqual(['m1'])
    expect(types.find(x => x.type === 'issue.update')?.recipientMemberIds).toEqual(['m2'])
  })
})
```

- [ ] **Step 7: 테스트·타입체크 실행**

Run: `npx vitest run tests/ui/issue-updates.test.tsx tests/actions/issue-updates-gate.test.ts && npx tsc --noEmit`
Expected: PASS

- [ ] **Step 8: 커밋**

```bash
git add src/components/issues/IssueUpdates.tsx src/app/actions/issueUpdates.ts \
        src/lib/i18n/dict/issues.ts src/lib/i18n/dict/issues.en.ts \
        tests/ui/issue-updates.test.tsx tests/actions/issue-updates-gate.test.ts
git commit -m "$(cat <<'EOF'
feat(issues): 경과에 @멘션을 붙인다

후보 목록을 textarea 아래 인라인으로 편다. 절대배치 드롭다운은 이 호스트에서
성립하지 않는다 — Modal 패널이 overflow-hidden 이라 잘리고, Modal 이 document
리스너로 Escape 를 무조건 닫기에 쓰기 때문에 목록만 닫을 수가 없다.

전송 대상은 문자열이 아니라 실제로 고른 member id 기준으로 대조한다. 손으로
타이핑한 이름은 대상이 아니고, 동명이인은 이름만으로 가를 수 없다.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: 상태 변경 자동 기록

**Files:**
- Modify: `src/app/actions/issues.ts` (`updateIssueProgress`)
- Test: `tests/actions/issue-updates-gate.test.ts` 가 아니라 `tests/actions/issues-gate.test.ts` 에 append

**Interfaces:**
- Consumes: Task 2 의 `encodeStatusChange`. 기존 `createAdminClient` (`issues.ts:6` 에서 이미 import 중).
- Produces: status 전환 시 `issue_updates` 에 `kind='status'`, `body='<from>><to>'` 행 1건.

- [ ] **Step 1: 실패하는 테스트 추가**

`tests/actions/issues-gate.test.ts` 에 append. 파일 상단 mock 에
`vi.mock('@/lib/supabase/admin', () => ({ createAdminClient }))` 가 이미 있는지 확인하고,
없으면 `vi.hoisted` 로 추가한다.

```ts
describe('updateIssueProgress — 상태 변경 자동 기록', () => {
  it('상태가 바뀌면 kind=status 이력을 service_role 로 남긴다', async () => {
    // 이 테스트의 스텁 구성은 기존 updateIssueProgress 테스트와 같은 형태를 쓰되,
    // createAdminClient 가 반환한 클라이언트의 issue_updates.insert 호출을 캡처한다.
    // 기대: { issue_id, project_id, kind: 'status', body: 'open>resolved', author_user_id, author_name }
    // 사용자 JWT 클라이언트(createServerClient)로는 넣을 수 없다 — kind 가 컬럼 grant 밖이다.
  })

  it('상태가 그대로면 이력을 남기지 않는다', async () => {
    // 담당자만 바꾼 호출에서 issue_updates.insert 가 호출되지 않아야 한다.
  })
})
```

> 이 태스크의 테스트는 `tests/actions/issues-gate.test.ts` 의 기존 `updateIssueProgress`
> 스텁 구조를 그대로 확장해 작성한다. 구현자는 그 파일의 기존 스텁을 먼저 읽고,
> `from('issue_updates')` 갈래를 추가한 뒤 위 두 케이스의 본문을 채운다.
> 새 스텁을 발명하지 말고 그 파일의 관례를 따를 것.

- [ ] **Step 2: 테스트 실행해 실패 확인**

Run: `npx vitest run tests/actions/issues-gate.test.ts`
Expected: FAIL (자동 기록이 없어 insert 가 호출되지 않음)

- [ ] **Step 3: 구현**

`src/app/actions/issues.ts`:

1. import 추가: `import { encodeStatusChange } from '@/lib/domain/issueUpdates'`
2. `updateIssueProgress` 의 담당자 교체 블록(:1064-1072) **앞**에 삽입:

```ts
  // 상태 변경 자동 기록 — 지금 이 흔적은 어디에도 남지 않는다.
  // service_role 로 쓰는 이유: 위 sb 는 사용자 JWT 라 kind 컬럼 grant 밖이고, RLS insert
  // 정책도 kind='note' 만 허용한다. 이 자리는 requireProjectMember 를 이미 통과했으므로
  // "service_role 쓰기는 서버 액션 가드가 유일한 관문"이라는 계약을 지킨다.
  if (patch.status !== undefined && patch.expectedStatus !== patch.status) {
    const user = await getSession()
    const admin = createAdminClient()
    const { error: logErr } = await admin.from('issue_updates').insert({
      issue_id: issueId,
      project_id: cur.project_id as string,
      kind: 'status',
      body: encodeStatusChange(patch.expectedStatus as IssueStatus, patch.status),
      author_user_id: g.actor.userId,
      author_name: user ? (displayNameFrom(user.user_metadata, user.email) ?? '(이름 없음)') : '(이름 없음)',
    })
    // 기록 실패가 상태 변경을 되돌리지는 않는다 — 이미 커밋됐다. 로그만 남긴다.
    if (logErr) console.error('[updateIssueProgress] 상태 변경 이력 기록 실패:', logErr.message)
  }
```

- [ ] **Step 4: 테스트 실행해 통과 확인**

Run: `npx vitest run tests/actions/issues-gate.test.ts`
Expected: PASS

- [ ] **Step 5: 커밋**

```bash
git add src/app/actions/issues.ts tests/actions/issues-gate.test.ts
git commit -m "$(cat <<'EOF'
feat(issues): 상태 변경을 경과 이력에 자동으로 남긴다

지금 상태 전환의 흔적은 어디에도 남지 않는다. 이력에 자동 기록하면 카테고리로
'해결'을 또 고르게 만들 필요가 없어진다.

service_role 로 쓰는 이유는 사용자 JWT 클라이언트가 kind 컬럼 grant 밖이고
RLS insert 정책도 kind='note' 만 허용하기 때문이다 — 브라우저가 시스템 기록을
위조하지 못하게 하려고 일부러 그렇게 좁혔다.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 9: 쓰기 경로 단일화 — 구 textarea 제거

**Files:**
- Modify: `src/app/actions/issues.ts:72-78, 1005, 1011-1013, 1026`
- Modify: `src/components/issues/IssueModals.tsx:195, 206, 222-223, 251, 443-451`
- Modify: `src/lib/i18n/dict/issues.ts` · `issues.en.ts` (`issue.detail.note`·`notePh` 제거)
- Modify: 컴파일러가 지목하는 모든 호출부·테스트

**Interfaces:**
- Consumes: 없음
- Produces: `IssueProgressPatch` 가 `{ status?, expectedStatus?, assigneeMemberIds? }` 3필드로 축소된다.

- [ ] **Step 1: 타입에서 필드 제거 — 컴파일러가 호출부를 지목하게 한다**

`src/app/actions/issues.ts:72-78`:

```ts
export interface IssueProgressPatch {
  status?: IssueStatus
  /** status 를 보낼 때 필수 — 클라이언트가 화면에 보이는 상태(CAS 비교 기준). 서버가 방금 읽은 상태가 아니다. */
  expectedStatus?: IssueStatus
  assigneeMemberIds?: string[]
  // resolutionNote 는 0087 이후 이 경로로 쓰지 않는다. 이력(issue_updates)이 유일 관문이고
  // issues.resolution_note 는 그 파생 미러다 — 두 주체가 쓰면 서로를 덮고, 이력에 없는
  // 문장이 미러를 타고 AI RAG(ai/index/content.ts:290)로 샌다.
}
```

- [ ] **Step 2: 타입체크로 파손 지점 목록을 얻는다**

Run: `npx tsc --noEmit`
Expected: `resolutionNote` 를 쓰는 모든 위치가 에러로 나열된다. 이 목록이 Step 3~5 의 작업 범위다.

- [ ] **Step 3: 액션 본문 정리**

`src/app/actions/issues.ts`:

- `:1005` 무변경 판정을 2축으로:

```ts
  if (patch.status === undefined && patch.assigneeMemberIds === undefined) {
    return { ok: false, error: '변경할 내용이 없습니다.' }
  }
```

- `:1011-1013` 의 `resolutionNote` 길이 검증 블록을 **삭제**한다.
- `:1026` 의 `if (patch.resolutionNote !== undefined) payload.resolution_note = patch.resolutionNote` 를 **삭제**한다.
- `:998` 의 doc 주석을 `/** 진행 업데이트(상태·담당자) — 멤버 전체. 상태 변경은 전환 맵 검증 + CAS + 이력 자동 기록. */` 로 바꾼다.
- `TEXT_MAX`(:161)가 다른 곳에서도 쓰이는지 확인한다. 쓰이면 남기고, 이 상수를 쓰는 마지막
  자리였다면 함께 제거한다(`grep -n "TEXT_MAX" src/app/actions/issues.ts`).

- [ ] **Step 4: 상세 모달에서 note 축 제거**

`src/components/issues/IssueModals.tsx`:

- `:195` `const [note, setNote] = useState('')` 삭제
- `:206` `setNote(issue.resolutionNote)` 삭제
- `:222-223` dirty 계산에서 `|| note !== issue.resolutionNote` 삭제:

```tsx
  const dirty = issue !== null && (status !== issue.status || assigneesDirty)
```

- `:251` patch 구성에서 `...(note !== issue.resolutionNote ? { resolutionNote: note } : {}),` 삭제
- `:443-451` 조치메모 `<label>` 블록 전체 삭제

- [ ] **Step 5: i18n 두 키 제거**

`src/lib/i18n/dict/issues.ts` 와 `issues.en.ts` 에서 `'issue.detail.note'` 와
`'issue.detail.notePh'` 를 **양쪽 모두** 삭제한다. 한쪽만 지우면 키 패리티 타입이 깨진다.

- [ ] **Step 6: 파손된 기존 테스트 수정**

Run: `npm run test 2>&1 | tail -40`

`resolutionNote` 를 patch 로 보내던 기존 테스트는 삭제하거나 status/assignee 축으로 바꾼다.
**`Issue` 픽스처의 `resolutionNote: '...'` 필드는 그대로 둔다** — 도메인 타입에서 제거하지
않았으므로 여전히 유효하고, 미러 컬럼으로 계속 읽힌다.

- [ ] **Step 7: 전체 검증**

Run: `npm run lint && npx tsc --noEmit && npm run test`
Expected: 전부 통과

- [ ] **Step 8: 커밋**

```bash
git add src/app/actions/issues.ts src/components/issues/IssueModals.tsx \
        src/lib/i18n/dict/issues.ts src/lib/i18n/dict/issues.en.ts tests/
git commit -m "$(cat <<'EOF'
fix(issues): 조치 경과의 쓰기 주체를 이력 하나로 좁힌다

진행 블록의 조치메모 textarea 를 없앤다. 이력과 함께 두면 두 주체가 같은
컬럼을 쓰면서 서로를 덮고, 이력에 없는 문장이 미러를 타고 AI RAG 로 샌다.

타입에서 먼저 지운 것은 서버 액션이 HTTP 엔드포인트라 textarea 만 떼면 호출은
살아 있기 때문이다 — 컴파일러가 호출부를 전부 지목하게 했다.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 10: 알림 딥링크 — focus 동기화

**Files:**
- Modify: `src/components/issues/IssuesView.tsx:56` 주변
- Test: `tests/ui/deep-link-params.test.tsx` (append)

**Interfaces:**
- Consumes: 없음
- Produces: `?focus=<issueId>` 가 마운트 이후에 바뀌어도 상세 모달이 열린다.

- [ ] **Step 1: 실패하는 테스트 추가**

`tests/ui/deep-link-params.test.tsx` 에 append. 기존 focus 테스트(:315-332)의 렌더 헬퍼와
`useSearchParams` mock 방식을 그대로 재사용한다.

```tsx
it('마운트 이후 focus 가 바뀌면 해당 이슈 상세가 열린다', async () => {
  // 알림 클릭은 전체 새로고침이 아니라 같은 라우트 소프트 내비게이션이다
  // (HeaderChrome.tsx:126 router.push). 이슈 화면에 머무는 사용자가 이 알림의 주
  // 수신자인데, useState 초기화 함수만으로는 그 사람에게 모달이 열리지 않는다.
  const { rerender } = renderWithParams('')            // focus 없음
  expect(screen.queryByText('첫 번째 이슈')).not.toBeInTheDocument()
  rerender(withParams('focus=issue-1'))                // 알림 클릭으로 쿼리만 바뀜
  expect(await screen.findByText('첫 번째 이슈')).toBeInTheDocument()
})

it('모달을 닫으면 focus 파라미터가 정리돼 같은 알림이 다시 열리지 않는다', async () => {
  const { replace } = renderWithParams('focus=issue-1')
  await screen.findByText('첫 번째 이슈')
  await userEvent.click(screen.getByRole('button', { name: /닫기|close/i }))
  expect(replace).toHaveBeenCalledWith(expect.not.stringContaining('focus='), expect.anything())
})
```

> `renderWithParams`/`withParams`/`replace` 는 그 파일의 기존 헬퍼 이름에 맞춰 조정한다.
> 없으면 기존 focus 테스트가 쓰는 방식을 그대로 복제해 만든다.

- [ ] **Step 2: 테스트 실행해 실패 확인**

Run: `npx vitest run tests/ui/deep-link-params.test.tsx`
Expected: FAIL — rerender 후에도 모달이 열리지 않음

- [ ] **Step 3: 구현**

`src/components/issues/IssuesView.tsx`:

1. import 에 `useEffect`, `useRef` 를 추가하고 `useRouter`, `usePathname` 을 `next/navigation` 에서 가져온다.
2. `:56` 아래에 추가:

```tsx
  const router = useRouter()
  const pathname = usePathname()
  const focusParam = searchParams.get('focus')
  // 마지막으로 소비한 focus 값. 이게 없으면 사용자가 모달을 닫아도 같은 파라미터를 보고
  // 곧바로 다시 열어 무한 재오픈이 된다.
  const consumedFocus = useRef<string | null>(focusParam)
  useEffect(() => {
    if (focusParam === null) { consumedFocus.current = null; return }
    if (consumedFocus.current === focusParam) return
    consumedFocus.current = focusParam
    setViewingId(focusParam)
  }, [focusParam])
```

3. `onClose`(:365)를 바꿔 파라미터를 정리한다:

```tsx
        onClose={() => {
          setViewingId(null)
          // 파라미터가 남아 있으면 다음 소프트 내비게이션에서 같은 이슈가 다시 열린다.
          if (focusParam !== null) {
            const next = new URLSearchParams(searchParams.toString())
            next.delete('focus')
            const qs = next.toString()
            router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false })
          }
        }}
```

- [ ] **Step 4: 테스트 실행해 통과 확인**

Run: `npx vitest run tests/ui/deep-link-params.test.tsx`
Expected: PASS (기존 마운트 케이스 포함 전부)

- [ ] **Step 5: 커밋**

```bash
git add src/components/issues/IssuesView.tsx tests/ui/deep-link-params.test.tsx
git commit -m "$(cat <<'EOF'
fix(issues): 알림을 눌렀을 때 이슈 화면에 머물러도 상세가 열리게 한다

focus 소비가 마운트 1회짜리 useState 초기화 함수뿐이었다. 알림 클릭은 같은
라우트 소프트 내비게이션이라 쿼리만 바뀌면 그 코드가 다시 돌지 않는다 —
하필 이슈 화면에 머무는 사람이 조치 경과 알림의 주 수신자다.

모달을 닫을 때 파라미터를 지우는 것은 남겨 두면 다음 내비게이션에서 같은
이슈가 다시 열리기 때문이다.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 11: 0088 백필 + 배포

**Files:**
- Create: `supabase/migrations/0088_issue_updates_backfill.sql`
- Create: `supabase/migrations/0088_issue_updates_backfill_rollback.sql`

**Interfaces:**
- Consumes: Task 1 의 테이블
- Produces: 기존 `resolution_note` 가 채워진 이슈마다 `kind='note'` 이력 1건

- [ ] **Step 1: 백필 마이그레이션 작성**

`supabase/migrations/0088_issue_updates_backfill.sql`:

```sql
-- 0087 이후 백필 — 기존 issues.resolution_note 를 첫 이력으로 옮긴다.
--
-- **코드 배포 앞에** 적용한다. 반대로 하면 원본이 소실된다 — 새 코드가 먼저 살아 있는 상태에서
-- 기존 조치메모가 있는 이슈에 경과가 하나 달리면, 미러 재계산이 resolution_note 를 새 본문으로
-- 덮어써 원래 텍스트가 사라지고, 그 뒤 이 백필이 '새 본문'을 원본인 양 이관한다.
-- 이 순서에서는 구 코드가 textarea 로 resolution_note 를 직접 쓰는 창이 잠시 남지만, 이력 행이
-- 원본을 보존하므로 손실이 없고 새 코드의 첫 등록 때 미러가 재계산되어 수렴한다.
--
-- 실측(2026-08-19 프로덕션): 이슈 68건 중 resolution_note 가 채워진 것 1건(49자).
-- 4000자 상한을 넘는 행은 0건이므로 손실 없이 전량 이관된다. 그래도 조건을 명시하는 것은
-- 스테이징·미래의 데이터가 다를 수 있기 때문이다 — 초과분은 남겨 두고 아래 쿼리로 센다.
--
-- 작성자·작성 시각은 추정값이다. author_user_id 는 이슈 작성자, created_at 은
-- issues.updated_at 을 쓴다(담당자만 바꿔도 오르는 값이라 정확하지 않다).
-- 화면은 author_name='(이관)' 을 보고 "이관됨 · 작성 시각 추정"을 표시한다.
--
-- 멱등: 같은 이슈에 이미 '(이관)' 이력이 있으면 건너뛴다. 재적용해도 중복되지 않는다.
-- 롤백: 0088_issue_updates_backfill_rollback.sql

begin;

set search_path = public, extensions;

insert into public.issue_updates
  (issue_id, project_id, kind, category, body, author_user_id, author_name, created_at)
select i.id, i.project_id, 'note', 'action', btrim(i.resolution_note),
       i.created_by, '(이관)', i.updated_at
  from public.issues i
 where btrim(i.resolution_note) <> ''
   and length(btrim(i.resolution_note)) <= 4000
   -- 가드는 '(이관)' 이름이 아니라 **이력 행 존재 여부**로 건다. 이름으로 걸면, 배포 창에서
   -- 사람이 먼저 경과를 하나 쓴 이슈에 대해 미러가 덮어쓴 본문을 원본인 양 한 번 더 이관한다.
   and not exists (
     select 1 from public.issue_updates u where u.issue_id = i.id
   );

-- 이관하지 못한 행(4000자 초과)을 남긴다. 0건이어야 정상이다.
do $$
declare n int;
begin
  select count(*) into n from public.issues
   where btrim(resolution_note) <> '' and length(btrim(resolution_note)) > 4000;
  if n > 0 then
    raise warning '4000자를 넘어 이관하지 못한 조치메모: %건 (resolution_note 에 그대로 남아 있음)', n;
  end if;
end $$;

reset search_path;

commit;
```

- [ ] **Step 2: 롤백 파일 작성**

`supabase/migrations/0088_issue_updates_backfill_rollback.sql`:

```sql
-- 0088 롤백 — 이관 이력만 지운다. 사람이 새로 쓴 이력은 건드리지 않는다.
-- issues.resolution_note 는 0088 이 손대지 않았으므로 원래 값 그대로 남아 있다.

begin;

delete from public.issue_updates where author_name = '(이관)' and kind = 'note';

commit;
```

- [ ] **Step 3: 스테이징 리허설**

```bash
npm run db:apply -- supabase/migrations/0088_issue_updates_backfill.sql --target staging
npm run db:apply -- supabase/migrations/0088_issue_updates_backfill.sql --target staging   # 멱등 확인
```

Expected: 두 번 다 성공. 2회차에 중복 행이 생기지 않는다.

- [ ] **Step 4: 스테이징에서 결과 검증 (읽기 전용)**

```sql
select count(*) filter (where author_name = '(이관)') migrated,
       count(*)                                       total
  from issue_updates;
select count(*) mismatch from issues i
 where btrim(i.resolution_note) <> ''
   and not exists (select 1 from issue_updates u where u.issue_id = i.id);
```

Expected: `mismatch = 0`.

- [ ] **Step 5: 스테이징 화면 확인 (사람이 한다)**

`dflow-staging.vercel.app` 에서 이슈 상세를 열어 확인한다:
1. 이관된 경과가 `(이관)` 작성자로 보인다
2. 새 경과를 등록하면 목록 맨 아래에 붙고 입력창이 비워진다
3. 상태를 바꾸면 "열림 → 해결로 변경" 줄이 자동으로 생긴다
4. 자기 경과에 취소선을 긋고 되돌릴 수 있다
5. 관리자 계정에서만 완전 삭제 버튼이 보인다
6. `@` 를 치면 후보가 뜨고, 등록 후 상대 계정의 알림함 벨에 배지가 뜬다
7. 알림을 클릭하면 그 이슈 상세가 열린다 (이슈 화면에 머문 상태에서도)

- [ ] **Step 6: 커밋 (마이그레이션 단독)**

```bash
git add supabase/migrations/0088_issue_updates_backfill.sql \
        supabase/migrations/0088_issue_updates_backfill_rollback.sql
git commit -m "$(cat <<'EOF'
feat(issues): 기존 조치메모를 첫 이력으로 이관한다

실측 대상 1건이라 별도 러너를 두지 않고 마이그레이션 안에서 처리한다.
작성자·시각은 추정값이라 author_name='(이관)' 으로 표시해 화면이 그 사실을
밝히게 한다.

Staging-verified: 0088 스테이징 2회 적용(멱등 확인) + 이관 누락 0건 실측 + 실화면 7항목 확인
Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 7: 프로덕션 배포**

```bash
git push origin staging                                                     # 스테이징 먼저
# DB 를 **둘 다** 먼저 적용한다. 코드가 먼저 살면 미러가 원본을 덮어써 백필할 것이 사라진다.
npm run db:apply -- supabase/migrations/0087_issue_updates.sql --target prod
npm run db:apply -- supabase/migrations/0088_issue_updates_backfill.sql --target prod
git push origin main                                                        # 코드 배포 (Vercel 자동)
npm run smoke:prod
```

- [ ] **Step 8: 프로덕션 실화면 확인 후 known-good 태그**

Step 5 의 7항목을 프로덕션에서 다시 확인한 뒤:

```bash
npm run mark:good
```

---

## Self-Review

**1. 스펙 커버리지** — 스펙의 각 절이 어느 태스크로 구현되는지:

| 스펙 절 | 태스크 |
|---|---|
| §2 데이터 모델 (DDL·grant·RLS) | 1 |
| §3 권한 요약 | 1(RLS) · 2(순수 판정) · 3·4(서버 가드) |
| §4 서버 (액션 5개·불변식 1~3) | 3, 4 |
| §4 상태 변경 자동 기록 | 8 |
| §5 UI (배치·최신 5건·취소선·canWrite) | 5 |
| §6 알림 (카탈로그·defaultOn·dedupe) | 6 |
| §6 딥링크 + focus 동기화 | 6(href) · 10(동기화) |
| §6 멘션 입력 | 7 |
| §7-0 쓰기 경로 단일화 | 9 |
| §7 미러 계약 | 3(헬퍼) · 4(archive/purge 에서도 호출) |
| §7 백필 | 11 |
| §7-1 선행 설계 대체 | ⚠️ 아래 참조 |
| §8 테스트 | 2, 3, 4, 5, 6, 7, 8, 10 |
| §9 배포 3단 | 1(0087) · 5~10(코드) · 11(0088) |

**갭 1건 발견 — §7-1(선행 설계 대체 주석)이 어느 태스크에도 없었다.** Task 11 Step 6 앞에
아래를 추가한다:

- [ ] **Task 11 / Step 5.5: 선행 설계 문서에 대체 표시를 남긴다**

두 파일에 한 줄씩 넣고 Step 6 커밋에 함께 stage 한다.

`docs/design/dflow-issue-management-design.md` 의 §9.3 머리(`:482` 근처):
```markdown
> ⚠️ 이 절은 대체되었다 — 정본은 `docs/superpowers/specs/2026-08-19-issue-updates-design.md`.
> kind 4종(comment/progress/resolution/rejection)은 kind 2종(note/status) + category 축으로
> 재정의됐고, edited_at 은 폐기, deleted_at 은 archived_at 으로 바뀌었다.
```

`docs/superpowers/specs/2026-07-23-issues-mvp-design.md:146` 의 `issue_updates` 항목 끝:
```markdown
 → 구현됨(2026-08-19). 정본은 `docs/superpowers/specs/2026-08-19-issue-updates-design.md`.
```

Step 6 의 `git add` 에 두 파일을 추가한다. (문서 변경이므로 G1 마이그레이션 혼합 규칙에
걸린다 — **별도 커밋으로 분리**하고 마이그레이션 커밋 앞에 둔다.)

**2. 플레이스홀더 스캔** — Task 8 Step 1 의 테스트 본문이 주석으로만 되어 있다. 이는 의도적
예외다: 그 파일의 기존 `updateIssueProgress` 스텁 구조를 복제해야 하는데, 그 구조를 이 계획에
그대로 옮겨 적으면 실제 파일과 어긋날 위험이 더 크다. 구현자가 먼저 읽어야 할 대상과 기대값을
명시했으므로 "무엇을 할지 없이 하라"는 지시는 아니다. 그 외 TBD/TODO 없음.

**3. 타입 일관성 점검**

- `IssueUpdate` 필드명: Task 2 정의 → Task 3 `mapRow` → Task 5 테스트 `entry()` 전부 일치
  (`archivedByName`, `authorUserId`, `mentionedMemberIds`).
- DB 컬럼 `mentioned_member_ids` — Task 1 DDL · Task 1 grant · Task 3 insert · Task 3 mapRow 일치.
- `canArchiveUpdate(row, userId, isProjectAdmin)` 인자 순서 — Task 2 정의 · Task 4 호출 ·
  Task 5 호출 일치.
- 액션 시그니처 `(issueId, updateId)` 순서 — Task 4 정의 · Task 5 호출 일치.
- `IssueUpdateResult` 의 `partial` — Task 3 정의 · Task 4 사용 · Task 5 테스트 일치.
- `encodeStatusChange` — Task 2 정의 · Task 8 사용 일치. `parseStatusChange` — Task 2 정의 ·
  Task 5 사용 일치.
- i18n 키 `issue.update.cat.*` — Task 2 의 `ISSUE_UPDATE_CATEGORY_META` · Task 5 의 사전 일치.
- `IssueUpdates` props — Task 5 정의(`issueId, members, canWrite, currentUserId, isProjectAdmin`) ·
  Task 5 모달 호출 · Task 5 테스트 `BASE` 일치.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-08-19-issue-updates.md`.
