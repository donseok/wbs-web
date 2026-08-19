# 이슈 조치/해결 경과 — 누적 이력(issue_updates) 설계

작성 2026-08-19. 상태: 설계 확정, 구현 미착수.
선행 정본 대체 관계는 §8 참조.

---

## 0. 배경

현업 건의: 이슈 상세 모달의 "조치/해결 경과"가 단일 TEXT 입력이라 누가 언제 무엇을 했는지 남지 않는다.
입력일·입력자·내용·(필요시)카테고리를 누적 관리하고, 삭제 시 취소선으로 이력을 보존하며,
완전 삭제는 관리자 승인을 거치게 하자.

### 확정된 결정

| # | 결정 | 근거 |
|---|---|---|
| D1 | 1순위 목적 = **협업 소통** | 사용자 선택. 감사 축보다 코멘트 스레드 축이 설계 중심 |
| D2 | 삭제 = **취소선 + 관리자 완전삭제**. 승인 큐 없음 | 실측(§1)상 이슈가 있는 유일 프로젝트의 역할이 관리자 47 / 멤버 4 라 요청자와 승인자가 같은 집단. 직무분리가 성립하지 않는다. 이슈 MVP 스펙이 같은 근거로 5단계 승인 흐름을 이미 기각했다(`docs/superpowers/specs/2026-07-23-issues-mvp-design.md:17` — "프로덕션 40계정 중 27명(67.5%)이 pmo_admin — 해결 요청→PMO 검증 종료 5단계는 직무분리 효과 없음") |
| D3 | 카테고리 = **선택 입력, 고정 소수**. `status` 와 겹치지 않는 축으로 재정의 | 건의문의 "해결"은 `status` 의 '해결'과, "조치"는 '진행중'과 중복. 두 곳에 같은 정보를 입력하게 된다 |
| D4 | 상태 변경을 **이력에 자동 기록** | 중복 축을 없애면서, 지금 아무 데도 남지 않는 상태 변경 흔적을 확보 |
| D5 | 알림 = **담당자 + @멘션** 둘 다 1차 포함 | D1 의 귀결. 상대가 모르면 소통이 성립하지 않는다 |
| D6 | 이력 본문 **수정 금지** | 리포 관례 — `issue_attachments` 는 UPDATE grant 없음(0068:64-66 "교체 = 삭제 + 재업로드"), `minute_highlights` 도 UPDATE 정책 없음(0025:61) |

승인 큐를 위한 컬럼은 **지금 넣지 않는다.** 나중에 필요해지면 `delete_state`/`reviewed_by`/
`reviewed_at` 을 더하는 단순 `alter table` 이고(`agent_work_reports` 0057:47-50 형태),
`archived_*` 축과 독립이라 이번 스키마가 그 길을 막지 않는다. 쓰지도 않을 컬럼을 미리 두면
NULL 의 의미가 "미요청"인지 "구버전"인지 모호해진다.

---

## 1. 운영 실측 (2026-08-19, 프로덕션 읽기 전용 SELECT)

- 이슈 **68건**, 전부 D-CUBE 프로젝트. `resolution_note` 가 채워진 것 **1건**(49자).
- `project_roles`: D-CUBE = admin **47** / member **4**. MES Post Project = admin 4 / member 13 (이슈 0건).
- `issue_assignees` 107행 / 68이슈 = 이슈당 평균 **2.74명** (알림 팬아웃 규모).

귀결: 기존 데이터 이관 비용이 사실상 0이고, 승인 큐는 실효성이 없다.

---

## 2. 데이터 모델 — `0087_issue_updates.sql`

`issue_attachments`(0068:38-57) 패턴을 복제한다 — `project_id` 비정규 보관 + `(issue_id, project_id)`
복합 FK cascade. 전제 인덱스 `issues_id_project_uidx` 는 0042:25-26 에 이미 있다.

파일 골격도 0068 을 따른다 — 맨 앞 `begin;` + `set search_path = public, extensions;`,
맨 뒤 `reset search_path;` + `commit;`, 헤더에 멱등·적용순서·롤백 계약 주석(0068:5-23 형식).

```sql
create table if not exists public.issue_updates (
  id uuid primary key default gen_random_uuid(),
  issue_id uuid not null,
  project_id uuid not null,
  kind text not null default 'note',
  category text,
  body text not null,
  mentioned_member_ids uuid[] not null default '{}',
  author_user_id uuid references auth.users(id) on delete set null,
  author_name text not null,
  created_at timestamptz not null default now(),
  archived_at timestamptz,
  archived_by uuid references auth.users(id) on delete set null,
  archived_by_name text,
  constraint issue_updates_kind_ck check (kind in ('note','status')),
  constraint issue_updates_category_ck
    check (category is null or category in ('action','discuss','followup','etc')),
  constraint issue_updates_body_len_ck check (length(body) between 1 and 4000),
  -- archived_by 는 짝 제약에서 뺀다. on delete set null 은 참조 행에 대한 UPDATE 라
  -- check 가 그대로 평가되고, 셋을 묶으면 계정 삭제가 23514 로 통째로 실패한다
  -- (0068:48-50 이 uploaded_by 에 쓴 '계정이 지워져도 남는다' 계약과 같은 이유).
  constraint issue_updates_archive_pair_ck
    check (num_nonnulls(archived_at, archived_by_name) in (0,2)),
  constraint issue_updates_issue_fk
    foreign key (issue_id, project_id) references public.issues(id, project_id) on delete cascade
);

create index if not exists issue_updates_issue_created_idx
  on public.issue_updates (issue_id, created_at desc);
create index if not exists issue_updates_project_idx
  on public.issue_updates (project_id);
```

### 컬럼 의미

| 컬럼 | 의미 |
|---|---|
| `kind` | `'note'` 사람이 쓴 글 / `'status'` 상태 변경 자동 기록(D4). `status` 행은 service_role 로만 쓴다(§4) |
| `category` | `action`(조치) · `discuss`(협의/질의) · `followup`(추가이슈) · `etc`(기타) · NULL(일반). note 에만 의미 |
| `body` | 본문. **한 건당 4000자** — 기존 20000(issues.ts:161)은 필드 전체의 상한이었고 이제는 코멘트 하나의 상한이다. 실측 최대치가 49자라 이관 손실 0 |
| `mentioned_member_ids` | 멘션 대상. 본문은 평문 `@이름`, 대상은 **`project_members.id`(로스터 축)** 스냅샷. auth uuid 는 클라이언트에 없다(`src/lib/domain/types.ts:69` "auth uuid 자체는 클라이언트로 보내지 않는다", 매퍼 `src/lib/data/members.ts:34` 가 `user_id` 를 버린다) — user_id 해석은 서버가 `emit.ts:28-36` 에서만 한다. 배열이라 FK 를 걸 수 없으므로 액션에서 `replaceAssignees` 관례(issues.ts:468-481)대로 `.in('id', ids).eq('project_id', pid)` 선행 검증을 한다 |
| `author_user_id` | 신원 정본. 서버가 `auth.uid()` 로 채운다 |
| `author_name` | 표시용 **스냅샷**(`displayNameFrom`, `src/lib/domain/display-name.ts:6-16`). 신원 판정은 언제나 `author_user_id` 로 하고(취소선 권한 술어도 그것), 표시 이름도 `author_user_id` 가 살아 있으면 서버가 조인해 만든다. 스냅샷은 계정 삭제(`on delete set null`) 폴백 전용이다 |
| `archived_*` | 취소선(소프트 삭제). 리포에 `deleted_at` 을 쓰는 테이블이 없다 — `archived_at` 이 관례(0045 minutes, 0074 notification_recipients). 계정이 삭제되면 `archived_by` 만 NULL 이 되고 `archived_at`·`archived_by_name` 은 남는다 |

### 권한 grant — insert 도 컬럼 단위다

```sql
revoke all on table public.issue_updates from public, anon, authenticated;
grant select on table public.issue_updates to authenticated;
-- insert 를 컬럼 단위로 좁히는 이유: anon key + 사용자 JWT 로 PostgREST 를 직접 때리는 경로가
-- 실사용 중이다(src/lib/supabase/client.ts:3-6, 이슈 기능 실사용 src/lib/issues/uploadIssueAttachments.ts:51).
-- anon 키는 번들에 박히므로 앱 코드와 무관하게 호출된다. 전 컬럼 grant 면 브라우저가
-- kind='status'(화면에 시스템 기록으로 렌더된다)·author_name·created_at·archived_* 를 직접 정한다.
grant insert (issue_id, project_id, category, body, mentioned_member_ids, author_user_id, author_name)
  on table public.issue_updates to authenticated;
grant update (archived_at, archived_by, archived_by_name) on table public.issue_updates to authenticated;
grant delete on table public.issue_updates to authenticated;
grant all on table public.issue_updates to service_role;
```

`grant update` 의 컬럼 스코프가 D6(본문 수정 금지)을 DB 차원에서 강제한다. 오타는 취소선을 긋고
다시 쓴다.

### RLS

```sql
alter table public.issue_updates enable row level security;

-- create policy 에는 if not exists 문법이 없다. G4 리허설 루프(적용→검증→수정→재적용)
-- 2회차가 42710 으로 죽지 않도록 drop 을 선행한다(0068:21-22 의 멱등 계약).
drop policy if exists read_issue_updates   on public.issue_updates;
drop policy if exists insert_issue_updates on public.issue_updates;
drop policy if exists update_issue_updates on public.issue_updates;
drop policy if exists delete_issue_updates on public.issue_updates;

-- 조회 개방은 의도 — 이슈 본문·첨부와 동일하다(0041:60, 0068:96).
create policy read_issue_updates on public.issue_updates
  for select to authenticated using (true);

-- 등록: '진행 저장'과 같은 등급(멤버). uuid 위조는 with check 가,
--   표시 필드(author_name)·kind·created_at 위조는 컬럼 스코프 grant 가 막는다 — 둘 다 있어야 한다.
create policy insert_issue_updates on public.issue_updates
  for insert to authenticated
  with check (public.is_project_member(project_id)
              and author_user_id = auth.uid()
              and kind = 'note'
              and archived_at is null and archived_by is null and archived_by_name is null);

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

-- 완전 삭제: 프로젝트 관리자만 (is_project_admin 은 0052:43-48 에서 슈퍼유저를 포함한다)
create policy delete_issue_updates on public.issue_updates
  for delete to authenticated using (public.is_project_admin(project_id));
```

`0087_issue_updates_rollback.sql` 동반 필수 (0074~0086 전부 쌍).

---

## 3. 권한 요약

| 행위 | 주체 | 서버 가드 | RLS 술어 |
|---|---|---|---|
| 읽기 | 로그인 사용자 전체 | 없음(이슈 상세와 동일) | `true` |
| 등록 | 프로젝트 멤버 | `requireProjectMember(pid)` | `is_project_member` + 작성자 일치 + `kind='note'` |
| 취소선 / 되돌리기 | 이력 작성자 본인 또는 프로젝트 관리자 | 액션에서 행 조회 후 판정 | 작성자 일치 or `is_project_admin` |
| 완전 삭제 | 프로젝트 관리자 | `requireProjectAdmin(pid)` | `is_project_admin` |

가드는 기존 셋(`requireSuperuser`/`requireProjectAdmin`/`requireProjectMember`)만 쓴다.
액션에 `role === '...'` 을 직접 적지 않는다(CLAUDE.md).

되돌리기(취소선 해제)를 반드시 넣는다 — 이 리포엔 "복원 경로 없는 숨김을 만들지 말라"는 명시
규칙이 있다(`WikiItemActions.tsx:33-36`).

---

## 4. 서버

새 파일 `src/app/actions/issueUpdates.ts`. 기존 `issues.ts` 는 최소 접촉 — 단 `resolution_note`
직접 쓰기 경로는 예외로 제거한다(§7-0). 새 파일로 가르는 이유는 authz 가 아니다
(`issues.ts:8` 이 이미 authz 4개 심볼을 import 하고 기존 mock 이 정확히 그 4개를 제공한다) —
상세 모달·이슈 액션 테스트의 mock 표면을 더 늘리지 않기 위해서다.

| 액션 | 가드 | 하는 일 |
|---|---|---|
| `listIssueUpdates(issueId)` | 없음(조회 개방) | 실패는 throw 가 아니라 명시적 실패 반환 — 상세 모달이 통째로 죽지 않게 |
| `addIssueUpdate(issueId, {body, category, mentionedMemberIds})` | `requireProjectMember` | INSERT + **미러 재계산** + 부모 `updated_at` + 알림 |
| `archiveIssueUpdate(issueId, updateId)` | 멤버 + 행 소유/관리자 판정 | CAS `.is('archived_at', null)` + 미러 재계산 + 부모 `updated_at` |
| `unarchiveIssueUpdate(issueId, updateId)` | 동일 | CAS `.not('archived_at','is',null)` + 미러 재계산 + 부모 `updated_at` |
| `purgeIssueUpdate(issueId, updateId)` | `requireProjectAdmin` | 실제 DELETE + 미러 재계산 + 부모 `updated_at` |

`updateIssueProgress`(issues.ts:999-1075)는 `resolutionNote` 축을 잃고 status/assignee 2축이 되며,
status 자동 기록을 추가로 수행한다(§7-0, 아래).

표시 이름은 `archived_by` 조인을 우선하고 `archived_by_name` 은 계정 삭제 폴백으로만 쓴다.

순수 판정은 `src/lib/domain/issueUpdates.ts` 에 둔다(통모킹 대상이 아니다):
`ISSUE_UPDATE_CATEGORIES` · `canArchiveUpdate(actor, row)` · `canPurgeUpdate(actor)` ·
`formatStatusChange(from, to)` · `parseMentions(body, candidates: ProjectMember[]): string[] /* member id */`.

### 불변식

**1. 모든 쓰기에 `.select()` + 0행 검출.** supabase-js 는 RLS 거부에도 `error === null` 이라,
없으면 실패가 성공으로 둔갑한다(issues.ts:1049-1050, agentWork.ts:180-199 선례).

**2. 이력이 바뀌면 부모 `issues.updated_at` 을 민다.** issues 엔 updated_at 트리거가 없어
(0041:14-15) 안 밀면 AI RAG 인덱스가 옛 값에 고착한다. add 만이 아니라 **archive/unarchive/purge
도 같은 이유로 민다** — `0031_ai_knowledge_index.sql:172-176` 의 신선도 게이트가
`v_existing_source >= p_source_updated_at → return 0` 이라, 안 밀면 재색인을 스킵해 취소선 친
문장이 RAG 스냅샷(`content.ts:290`)에 영구 잔류한다.

단 **부분 payload 로만** — `{ updated_at }`(+미러 재계산 시 `resolution_note`)만 싣는다.
**여기에 DB 방어선이 없다는 점을 분명히 한다.** 현행 트리거 함수 정본은
`public.assign_issue_analysis_code()` `0062_issue_major_processes.sql:174-249`
(0055:179 판을 `create or replace` 로 덮어썼다. 트리거 선언은 0055:248-251, `ISSUE_CODE_IMMUTABLE`
raise 는 0062:197)이고, UPDATE 분기가 `new.X is distinct from old.X` 비교라 **동일 값 전체
rewrite 는 아무 경고 없이 통과한다.** "틀리면 트리거가 막아준다"는 전제는 성립하지 않고
부분 payload 는 코드 규칙으로만 지켜진다. 특히 `major_id`·`mega_code`·`mega_seq`·`pi_issue_code`
는 payload 에 **절대 싣지 않는다** — `major_id: null` 이 섞이면 0062:202
`ISSUE_MAJOR_UNSET_FORBIDDEN` 으로 이력 추가가 통째로 실패한다.

**3. 부분 실패는 부분 실패로 고지한다**(`replaceAssignees` 관례, issues.ts:1063-1072).
미러 재계산 UPDATE 가 실패하면 이력 자체는 이미 커밋됐으므로 "이력은 저장됐으나 요약 반영에
실패했습니다"로 알린다. 알림 발행 실패도 마찬가지다.

### 상태 변경 자동 기록 (D4)

`updateIssueProgress` 가 status 를 실제로 바꾼 경우(CAS 성공 후) **`createAdminClient()`
(service_role)** 로 `kind='status'` 행을 INSERT 한다. 같은 함수가 쓰는 `createServerClient()`
(issues.ts:1019)는 사용자 JWT 라 `kind` 컬럼 grant 밖이므로 이 경로로는 쓸 수 없다.
CLAUDE.md 의 "service_role 쓰기는 서버 액션 가드가 유일한 관문" 대상이므로 이 INSERT 는
`requireProjectMember` 통과 이후 지점에만 둔다. `kind='status'` 행은 알림을 발행하지 않는다.

---

## 5. UI

`src/components/issues/IssueUpdates.tsx` (신규). `IssueAttachments.tsx:40-67` 구조를 복제한다 —
`useCallback load()` + `loadFailed` 분리(번역문을 state 에 넣지 않는 이유 주석 포함).

배치는 상세 모달 안, 진행 블록 **앞**. 모달 본문이 `max-h-[70vh]` 스크롤 박스(Modal.tsx:96)라
이력을 다 펼치면 푸터 '진행 저장' 어포던스가 밀린다 — 첨부를 진행 앞에 둔 이유와 같다.

- 기본 **최신 5건 + 더보기**.
- 항목: `작성자 · 8/19 14:30 · [조치]` + 본문. `fmtAt`/`actorLabel` 은 RowDetailPanel.tsx:43-53 복제.
- 취소선 항목: `text-ink-muted line-through decoration-ink-subtle/50`(RowDetailPanel.tsx:540 그대로).
  "취소선 N건 숨기기" 토글 제공.
- `kind='status'` 행: 다른 배경 + 옅은 글씨, "열림 → 해결로 변경".
- 토글은 전부 **JSX 조건부 렌더**. `globals.css` 끝 unlayered 안전망 때문에 상태 변형 display
  유틸(`group-hover:flex` 등)은 조용히 무시된다. `line-through`/`opacity-*` 자체는 안전하다.
- 이력 등록 후 부모를 `router.refresh()` 하지 않는다 — `useEffect([issue])` 재베이스라인
  (IssueModals.tsx:202-207)이 옆에서 입력 중인 textarea 를 리셋한다. 자체 `load()` 로만 갱신한다.
- 진행 블록의 조치메모 textarea(IssueModals.tsx:443-451)는 **제거한다.** 남겨 두면 textarea
  저장과 미러 재계산이 서로를 덮어, 이력에 없는 문장이 AI RAG(content.ts:290)에 인용된다.
- 조회 전용 사용자에게 입력 UI 를 렌더하지 않는다. 이를 위해 `canWrite`(= IssuesView.tsx:129
  `role !== null`)를 **IssuesView → IssueDetailModal → IssueUpdates 로 새 prop 으로 관통시킨다.**
  현재 모달에 내려오는 권한 값은 `canEdit`(= `canEditIssue`, `src/lib/domain/issues.ts:151-153`:
  이슈 작성자 또는 pmo_admin)뿐이고 이는 §3 의 등록 주체와 **다른 축이므로 재사용 금지**다 —
  재사용하면 남이 만든 이슈에 일반 멤버가 이력을 못 써 기능이 사실상 죽는데 컴파일 에러가 없어
  리뷰 전까지 드러나지 않는다. 취소선 버튼 노출은 또 다른 축(이력 작성자 본인 또는 관리자)이라
  별도 판정한다. (현재 '진행 저장' 버튼은 게이팅이 없는데 그 구멍을 물려받지 않는다.)

i18n 은 `src/lib/i18n/dict/issues.ts` + `issues.en.ts` **동시** 수정. en 파일은 `import type` 만
허용한다(`dict.ts:11` — 값 import 를 넣으면 EN 청크 분리가 무효).

---

## 6. 알림 · 멘션

`NOTIFICATION_CATALOG`(`src/lib/domain/inbox.ts:7-28`)에 둘을 추가한다.

| 타입 | 수신자 | category | defaultOn | required |
|---|---|---|---|---|
| `issue.update` | 해당 이슈의 담당자들 | `issue` | `true` | `false` |
| `issue.mention` | 멘션 대상 | `issue` | `true` | `false` |

`required: true` 로 넣으면 `tests/domain/inbox.test.ts:11-15` 가 즉시 깨진다.
`defaultOn` 은 **둘 다 `true`** — D5 가 목적이고, 지금 `prefs.notif` 를 **쓰는 코드가 src 전체에
0건**이라(읽기는 `src/app/actions/inbox.ts:56` 한 곳뿐) `false` 로 두면 영구히 발행되지 않는
죽은 타입이 된다.

이 기본값은 토글 UI 가 없어 되돌릴 수 없다는 전제 아래, 소음을 설계로 억제한다:
(a) 담당자 팬아웃은 이슈당 평균 2.74명(§1 실측),
(b) `issue.update` 는 `dedupeKey: 'issue.update:{issueId}:{updateId}'` 로 1이력 1이벤트를 보장,
(c) `kind='status'` 자동 기록(D4)은 알림을 발행하지 않는다 — 사람이 쓴 note 만 발행한다.

담당자·멘션 모두 member 축이므로, 두 집합의 합집합에서 담당자 겹침을 빼고 멘션된 사람에겐
`issue.mention` 1건만 보낸다. 발행은 `emitNotification({ recipientMemberIds, actorUserId })` 로 하고
member→user 해석은 `emit.ts:28-36` 에 맡긴다 — 액션·UI 는 member id 만 다룬다. 작성자 본인 제외는
emit 이 `actorUserId` 로 이미 처리한다(`emit.ts:36`).

### 딥링크

href 는 `/p/{projectId}/issues?focus={issueId}`. 기존 `issue.assigned` 발행 지점
(`src/app/actions/issues.ts:504`, `:894`)은 파라미터 없는 목록 URL 이라 그대로 복사하면
68건 목록만 뜬다.

다만 파라미터를 붙이는 것만으로는 부족하다 — `IssuesView` 의 focus 소비는 마운트 1회짜리
useState 초기화 함수뿐이고(`IssuesView.tsx:56`, 파일 내 `useEffect` 0건), 알림 클릭은 전체
새로고침이 아니라 같은 라우트 소프트 내비게이션이다(`HeaderChrome.tsx:126 router.push`).
같은 라우트에서 쿼리만 바뀌면 동일 컴포넌트가 재사용돼 초기화 함수가 다시 돌지 않는다 →
**이미 이슈 화면에서 협업 중인 사용자(= 이 알림의 주 수신자)에게는 URL 만 바뀌고 모달이 안 열린다.**

따라서 이 범위에 **IssuesView 의 focus 동기화**를 포함한다 — `searchParams.get('focus')` 변화를
보는 useEffect(마지막 소비값을 ref 에 기억해 재오픈 루프 방지, 모달을 닫을 때 `router.replace` 로
파라미터 제거)를 추가하고, `tests/ui/deep-link-params.test.tsx` 에 "마운트 이후 focus 가 바뀌면
해당 이슈 상세가 열린다" 케이스를 넣는다.

### 멘션 입력

textarea 에서 `@` 입력 시 **textarea 바로 아래 인라인 후보 목록**(`MemberPicker.tsx:92-140` 관례)을
편다. 절대배치 드롭다운을 쓰지 않는 이유는 둘이다:

1. Modal 본문이 `max-h-[70vh] overflow-y-auto`, 패널이 `overflow-hidden`(Modal.tsx:88,96)이라
   abspos 목록의 컨테이닝 블록이 스크롤 박스 안에 갇혀 잘린다.
2. Modal 은 `document` 리스너로 Escape 를 **조건 없이** 닫기에 쓴다(Modal.tsx:59,72). 하위
   컴포넌트의 React 합성 `stopPropagation` 으로는 같은 노드의 리스너를 막지 못하고, 닫히면
   `IssuesView.tsx:365 onClose` 가 dirty 가드 없이 모달을 날려 작성 중 본문이 사라진다.
   인라인 목록이면 Escape 를 가로챌 필요 자체가 없다. (그래도 Escape 로 후보만 닫고 싶다면
   `e.nativeEvent.stopImmediatePropagation()` 이 필요하다 — 구현 시 실측 확인.)

후보는 `members.filter(m => m.hasAccount)` 만 노출한다(계정 미연결 멤버는 알림이 갈 수 없다).
선택 시 본문에 `@이름` 삽입 + **member id** 를 state 에 축적하고, 제출 시 문자열이 아니라
**선택된 member id** 기준으로 본문 잔존 여부를 대조한다(동명이인 때문에 문자열 대조는 틀린다).
썼다 지운 멘션이 유령 알림을 보내지 않게 한다.

---

## 7. 기존 컬럼과 데이터

### §7-0. 쓰기 경로 단일화 (선행 작업)

`issues.resolution_note` 에 사람이 직접 쓰는 경로를 제거한다. 서버 액션은 HTTP 엔드포인트라
textarea 만 떼면 호출은 살아 있으므로 타입부터 없앤다:

- `IssueProgressPatch.resolutionNote`(issues.ts:77)를 타입에서 제거 — 컴파일러가 호출부를 잡는다.
- `updateIssueProgress` 의 무변경 판정(:1005)을 `patch.status === undefined &&
  patch.assigneeMemberIds === undefined` 2축으로 축소.
- TEXT_MAX 검증(:1011-1012)과 `payload.resolution_note` 대입(:1026) 삭제.
- UI: `IssueModals.tsx` 의 note state(:206)·dirty 항(:222-223)·patch 항(:251)과
  조치메모 textarea·라벨(:443-451) 제거.
- i18n `issue.detail.note` / `notePh` 를 ko/en 동시 정리.

조치 경과 입력은 이력 컴포넌트가 유일 관문이 된다.

### 미러 계약

`issues.resolution_note` 는 **읽기 전용 파생 미러로 강등**한다. 쓰기 주체는 동기화 헬퍼 하나뿐이다.
미러 정의는 "방금 쓴 body 복사"가 아니라 **재계산**이다 — add/archive/unarchive/purge 네 액션 모두
마지막에

```sql
select body from issue_updates
 where issue_id = ? and kind = 'note' and archived_at is null
 order by created_at desc, id desc limit 1
```

를 다시 읽어, 그 값(행이 없으면 **빈 문자열** — `0041_issues.sql:38` 이 NOT NULL 이라 NULL 은
23502)을 `issues.resolution_note` 와 `issues.updated_at` 에 **한 UPDATE 로 함께** 쓴다.
재계산이라 동시 등록 경합을 흡수한다. 액션 4곳에 흩뿌리지 말고 `syncResolutionNoteMirror(sb, issueId)`
단일 헬퍼로 모은다.

이렇게 하면 AI RAG 인덱스(`src/lib/ai/index/content.ts:290`)와 분석서 로더
(`src/lib/data/issueAnalysis.ts:201`), 목록 매퍼(`src/lib/data/issues.ts:124`)가 무수정으로
계속 동작한다. 컬럼은 `assignee_member_id`(0042:17-20)처럼 deprecated 주석과 함께 박제하고
drop 하지 않는다.

### 백필

기존 1건(§1)을 첫 이력으로 옮긴다. `category='action'`, `author_user_id = issues.created_by`,
`author_name='(이관)'`, `created_at = issues.updated_at`(추정값 — 화면에 "이관됨 · 작성 시각 추정"으로
밝힌다). 조건은 `where btrim(resolution_note) <> '' and length(resolution_note) <= 4000`,
초과분은 제외하고 목록을 로그로 남긴다(현 실측 최대 49자라 제외 0건).

마이그레이션은 Management API 가 owner 권한으로 실행하므로 RLS·컬럼 grant 의 제약을 받지 않는다.
별도 러너·롤백 자산이 필요한 규모가 아니다.

### §7-1. 선행 설계 대체

MVP 스펙 `:143`/`:146` 이 `issue_updates` 의 설계 원천으로 지목한
`docs/design/dflow-issue-management-design.md` §9.3(`:482`)을 이 문서가 대체한다.

kind 4종(comment/progress/resolution/rejection)을 **kind 2종(note/status) + category 축
(action/discuss/followup/etc)** 으로 재정의한 이유는 D3 — resolution/rejection 이 `issues.status`
의 '해결'과 축이 겹치고, progress 는 D4 의 status 자동 기록으로 흡수된다. §9.3 의 `edited_at` 은
D6(본문 수정 금지)으로 폐기하고, `deleted_at` 은 리포 관례에 맞춰 `archived_at`(+`archived_by`/
`archived_by_name`)로 대체한다.

구현 커밋에서 `dflow-issue-management-design.md` §9.3 머리와 MVP 스펙 `:146` 에
"→ 이 항목의 정본은 `docs/superpowers/specs/2026-08-19-issue-updates-design.md`" 한 줄을 남긴다.

---

## 8. 테스트

### 신규

- `tests/domain/issue-updates.test.ts` — 순수 판정(카테고리, `canArchiveUpdate`, `canPurgeUpdate`,
  `formatStatusChange`, `parseMentions` 동명이인 케이스).
- `tests/actions/issue-updates-gate.test.ts` — 권한(멤버 등록 가능 / 남의 이력 취소선 불가 /
  멤버 완전삭제 불가) + **부모 UPDATE payload 키 화이트리스트 단위 테스트**(허용 키 =
  `updated_at`, `resolution_note` 뿐). DB 가 막아주지 않으므로(§4 불변식 2) 이 테스트가 유일한
  안전망이다.
- `tests/ui/issue-updates.test.tsx` — 취소선 표시 · 더보기 · 멘션 대조 · **멤버=입력 가능 /
  조회 전용(canWrite=false)=입력창 없음 / 남의 이력에 취소선 버튼 없음**.

### 기존 테스트 갱신 (빠뜨리면 `npm run test` 가 멈춘다)

`tests/ui/deep-link-params.test.tsx` 에 아래 mock 을 추가한다. 이 파일은 `IssuesView` 를 렌더해
`IssuesView.tsx:359` → `IssueModals.tsx:424` 로 내려가고, 같은 자리에 `IssueUpdates` 가 들어가면
`listIssueUpdates` 가 모킹 없이 실행된다. 같은 이유로 `vi.mock('@/app/actions/issueAttachments', …)`
가 이미 `:63-68` 에 주석과 함께 들어 있다. 상세 모달을 여는 UI 테스트는 이 파일 하나뿐이다.

```ts
vi.mock('@/app/actions/issueUpdates', () => ({
  listIssueUpdates:      vi.fn(async () => ({ ok: true, items: [] })),
  addIssueUpdate:        vi.fn(async () => ({ ok: true })),
  archiveIssueUpdate:    vi.fn(async () => ({ ok: true })),
  unarchiveIssueUpdate:  vi.fn(async () => ({ ok: true })),
  purgeIssueUpdate:      vi.fn(async () => ({ ok: true })),
}))
```

### 픽스처

`Issue` 도메인 타입에 새 필드를 넣을 땐 **반드시 optional** — 필수로 넣으면
`grep -rl "resolutionNote" tests/` = **12개 파일**(2026-08-19 실측)이 동시에 깨진다.
`majorId`·`attachmentCount` 가 optional 인 이유가 정확히 이것이다(`domain/issues.ts:29-35`).

§7-0 으로 `IssueProgressPatch.resolutionNote` 를 제거하면 기존 이슈 액션 테스트도 함께 고쳐야 한다.

---

## 9. 배포

**DB 먼저, 코드 나중.** 테이블 없이 로더가 돌면 매 요청 PGRST 오류로 로그가 오염된다
(0027 사고 교훈이 0041:11-13, 0068:18-20 에 박제돼 있다).

3단으로 쪼갠다. **백필이 코드보다 먼저다**:

1. **0087** — 테이블·인덱스·grant·정책만. **백필 없음.**
2. **0088** — 백필 `INSERT … SELECT`.
3. **코드 배포** — 액션·UI·알림·§7-0.

⚠️ **이 순서를 뒤집으면 원본이 소실된다**(2026-08-19 Task 3 리뷰에서 드러남). 코드가 먼저 살아
있으면, 기존 조치메모가 있는 이슈에 경과가 하나 달리는 순간 미러 재계산이 `resolution_note` 를
새 본문으로 덮어쓴다. 원래 텍스트는 그때 사라지고, 뒤늦게 도는 0088 은 그 '새 본문'을 원본인 양
이관한다. 대상이 1건뿐이라 피해 범위는 작지만 복구 경로가 없다.

이 순서에서는 반대로 구 코드가 textarea 로 `resolution_note` 를 직접 쓰는 창이 잠시 남는다.
그건 무손실이다 — 이력 행이 원본을 보존하고, 새 코드의 첫 등록 때 미러가 재계산되어 수렴하며,
구 textarea 는 §7-0 이 같은 코드 배포에서 없앤다.

0088 의 멱등 가드는 `author_name = '(이관)'` 이 아니라 **이력 행 존재 여부**로 건다 — 이름으로
걸면 배포 창에서 사람이 먼저 쓴 이슈를 한 번 더 이관한다.

각 마이그레이션에 `_rollback.sql` 동반. 마이그레이션과 코드는 **별도 커밋**(G1 훅).
0072 이상이라 스테이징 리허설이 필수다 — `staging:sync` → `db:apply --target staging` → 검증 →
`Staging-verified:` 트레일러 → staging push → `db:apply --target prod` → main push (G4 훅).
상세는 `docs/runbook-staging.md`.

재적용 실패는 전부 롤백이다 — `scripts/db-apply.mjs:87` 이 파일 전문을 단일 쿼리로 보내므로
부분 적용은 없다. `begin;`/`commit;` 은 관례·명시성 목적이다.

`src/components/issues/*` 는 UI 위험 파일 목록에 없어 G2 훅에 걸리지 않지만, 신규 화면이므로
스테이징 확인 후 main 머지가 관례다.

---

## 10. 범위 밖 (의도적 제외)

- 목록 표의 이력 건수 배지 — `getIssues` 의 프로젝트 단위 일괄 조회 계약(`data/issues.ts:38-40`,
  `.in()` 금지)을 건드린다.
- PPT 분석서 노출 — `report/issues/model.ts` 스냅샷 + `ISSUE_ANALYSIS_SCHEMA_VERSION` 동반 인상 필요.
- 삭제 승인 큐 (D2).
- 이력 본문 수정 (D6).
- 프로젝트별 카테고리 마스터 (D3).
- 알림 타입 on/off 토글 UI — `saveUiPrefs`(preferences.ts:19)가 이미 임의 키를 받으므로 UI 만
  추가하면 되지만 별도 범위다.
- 기존 `issue.assigned` href 에 `?focus=` 소급 부여 — 선택 항목.

---

## 부록. 이 설계가 의존하는 실측 사실

구현 중 이 전제가 깨졌다면 설계를 다시 봐야 한다. 전부 2026-08-19 코드/DB 실측이다.

| 전제 | 근거 |
|---|---|
| 클라이언트는 남의 auth uuid 를 모른다 | `domain/types.ts:69`, `data/members.ts:34` |
| `emitNotification` 이 member→user 를 서버에서 해석하고 작성자를 제외한다 | `notify/emit.ts:23-37` |
| `NOTIFICATION_CATALOG` 항목은 `{category, defaultOn, required}` 3필드 | `domain/inbox.ts:28` |
| `prefs.notif` 쓰기 코드 0건 | `grep` 실측, 읽기는 `actions/inbox.ts:56` 뿐 |
| 브라우저가 anon key 로 PostgREST 를 직접 호출하는 경로 실재 | `lib/supabase/client.ts:3-6`, `lib/issues/uploadIssueAttachments.ts:51` |
| issues UPDATE 트리거는 하나뿐이고 동일값 rewrite 를 통과시킨다 | `0062:174-249`(선언 0055:248-251) |
| AI 재색인이 `updated_at` 신선도 게이트에 걸린다 | `0031:172-176`, `ai/index/content.ts:290,301` |
| Modal 이 document 리스너로 Escape 를 무조건 닫는다 | `ui/Modal.tsx:59,72` |
| `IssuesView` 의 focus 소비가 마운트 1회뿐 | `IssuesView.tsx:56`, 파일 내 useEffect 0건 |
| 상세 모달을 여는 UI 테스트는 `deep-link-params` 하나뿐 | `tests/ui/deep-link-params.test.tsx:63-68` |
| `resolutionNote` 픽스처 12개 파일 | `grep -rl "resolutionNote" tests/` |
| 다음 빈 마이그레이션 번호 0087 | `ls supabase/migrations` 최대 0086 |
