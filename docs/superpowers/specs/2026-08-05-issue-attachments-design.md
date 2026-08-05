# 이슈 첨부파일 — 설계

작성일 2026-08-05 · 상태: 설계 확정, 구현 미착수

이슈 등록·수정 시 파일을 여러 개 붙이고 내려받는 기능. 뷰어가 아니라 **보관과 전달**이 목적이므로
파일은 열지 않고 저장·다운로드만 한다. 확장자는 제한하지 않는다.

---

## 1. 결정 사항

사용자 결정 4건이 설계의 축이다.

| 결정 | 내용 |
|---|---|
| 등록 시점 첨부 | 폼에서 고른 파일을 브라우저 메모리에 담아두고, **이슈 저장이 성공한 뒤** 발급된 id 로 업로드 |
| 권한 | 첨부 추가·삭제 = **작성자 또는 프로젝트 관리자**(이슈 수정 권한과 동일). 다운로드 = 로그인 사용자 전체 |
| 상한 | 파일당 **50MB**, 이슈당 **10개** |
| 노출 | 상세 모달(읽기 전용 다운로드) · 수정 폼(추가·삭제) · 이슈 목록 행(클립 개수 배지) |

구현 형태는 **이슈 전용 버킷 + 전용 테이블**이다. 기존 `deliverables` 버킷을 재사용하거나
범용 `attachments` 테이블로 통합하는 안은 기각했다 — 전자는 버킷 단위 상한을 걸 수 없고,
후자는 운영 데이터가 얹힌 산출물·회의록 경로를 마이그레이션으로 이사시켜야 한다.

### 50MB 의 근거

Supabase 프로젝트 전역 업로드 상한이 **정확히 52,428,800 bytes = 50MB** 다
(2026-08-05 `GET /v1/projects/rglfgrwwwwdqejohdnty/config/storage` 실측: `{"fileSizeLimit":52428800}`).
즉 50MB 는 **대시보드를 건드리지 않고 쓸 수 있는 최대치**다. 이보다 크게 잡으면 버킷 설정과
무관하게 전역 상한에서 잘린다.

현재 버킷은 둘뿐이다 — `deliverables`(`file_size_limit` null → 전역 50MB 적용),
`minutes`(20,971,520 = 20MB). 새 버킷은 상한을 **명시**한다. null 로 두면 전역 설정이 바뀔 때
조용히 따라 움직인다.

---

## 2. 데이터 계층

### 마이그레이션

`0068_issue_attachments.sql` + `0068_issue_attachments_rollback.sql`.

> **번호 확인 필수.** 최신 커밋본이 `0067_wiki_job_lease_reclaim.sql` 이라 0068 이 맞지만,
> 미커밋(untracked) 설계 문서 `docs/design/agent-coding-platform/11-stage-and-failure-channel.md:65,74`
> 가 이미 0068 을 선점 주장하고 있다. 파일을 만들기 직전에 `ls supabase/migrations | tail -3` 로
> 재확인하고, 그 사이 0068 이 생겼으면 다음 빈 번호로 비켜선다(번호가 조밀할 필요는 없다 —
> 0018·0027 이 이미 결번이다).

`tests/migrations/migration-ledger.test.ts:40-65` 가 **0050 이후 모든 정방향 SQL 에 `_rollback.sql` 짝이
있는지 디렉터리를 스캔해 강제**한다. 롤백 파일을 빠뜨리면 이 테스트가 자동으로 실패한다.

파일은 `set search_path = public, extensions;` 로 열고 `reset search_path;` 로 닫는다(0062·0067 관례).

> **[교정]** 두 파일이 공유하는 것은 **search_path 뿐**이다. 트랜잭션 관례는 갈린다 —
> 0062 는 `begin;`(24)~`commit;`(605) 로 감싸지만 0067 은 감싸지 않는다. 어느 쪽을 따를지는 선택이며,
> 이 마이그레이션은 여러 객체(버킷·테이블·함수·정책)를 한 번에 만들므로 0062 쪽(트랜잭션)을 따른다.
>
> **[교정] `migration_ledger` 에 기대지 말 것.** 0050 이 원장 테이블을 도입했지만
> ① 새 마이그레이션을 원장에 넣는 관례·자동화가 리포에 **없고**(참조는 `apply-0050.mjs` 의 1회성 백필뿐),
> ② `docs/runbook-rollback.md:103` 이 "2026-07-28 현재 프로덕션 미적용이라 조회해도 0행"이라고 적어
> **원장 테이블 자체가 운영에 없을 수 있다.** 0068 적용 스크립트가 원장에 쓰려면 존재 여부를 먼저 확인하고
> 없으면 건너뛴다(원장 기록 실패가 마이그레이션 적용을 막아서는 안 된다).

### 버킷

```sql
insert into storage.buckets (id, name, public, file_size_limit)
values ('issue-attachments', 'issue-attachments', false, 52428800)
on conflict (id) do update set file_size_limit = excluded.file_size_limit,
                               public          = excluded.public;
```

`allowed_mime_types` 는 **설정하지 않는다**(null = 전 확장자 허용). 이것이 "확장자 무관" 요구의 실체다.

`do nothing` 이 아니라 `do update` 인 이유: 재적용 때 상한이 수렴하게 하려는 것이다.
0021 은 `do nothing` 을 썼는데, 그러면 잘못된 상한으로 한 번 만들어진 버킷을 마이그레이션 재실행으로
고칠 수 없다.

### 테이블

```sql
create table if not exists public.issue_attachments (
  id          uuid primary key default gen_random_uuid(),
  issue_id    uuid not null,
  project_id  uuid not null,
  file_name   text not null,          -- 원본 파일명(한글 포함). 다운로드 시 이 이름으로 복원
  file_path   text not null unique,   -- storage object 경로. '<issue_id>/<ts>-<safe>'
  size        bigint,
  mime        text,
  uploaded_by uuid references auth.users(id) on delete set null,
  created_at  timestamptz not null default now(),
  constraint issue_attachments_issue_project_fk
    foreign key (issue_id, project_id) references public.issues (id, project_id) on delete cascade
);
create index if not exists issue_attachments_issue_idx   on public.issue_attachments (issue_id, created_at desc);
create index if not exists issue_attachments_project_idx on public.issue_attachments (project_id);
```

**`project_id` 를 비정규 보관하는 것이 이 설계의 필수 조건이다.** 세 가지가 여기 걸려 있다.

1. 목록 배지 쿼리가 `.eq('project_id', projectId)` 한 방이 된다. `project_id` 가 없으면
   `.in('issue_id', ids)` 를 써야 하고, 그러면 이슈 조회 결과를 기다려야 해서
   `getIssues` 의 `Promise.all` 병렬이 깨지고 왕복이 1회 늘어난다.
2. RLS 를 서브쿼리 없이 `public.is_project_*(project_id)` 로 쓸 수 있다.
3. `issue_assignees`(0042:36-51)·`issue_links` 가 이미 같은 형태다. 복합 FK 의 전제인
   `issues_id_project_uidx`(0042:25-26)도 **이미 존재**하므로 새로 만들 필요가 없다
   (멱등 재선언은 관례상 허용).

복합 FK 는 권한 외에 **`project_id` 위조도 막는다.** `(issue_id, project_id)` 쌍이 `issues` 에
실재해야 하므로, 올바른 `issue_id` 에 남의 `project_id` 를 붙여 넣을 수 없다.

테이블 권한은 0062:131-133 형태를 따른다. 다만 0062 는 `select, insert` 만 주고 `delete` 는 주지 않는다 —
첨부는 삭제가 기능의 일부라 `delete` 를 더한다(아래 RLS 의 delete 정책과 짝).

```sql
revoke all on table public.issue_attachments from public, anon, authenticated;
grant select, insert, delete on table public.issue_attachments to authenticated;
grant all on table public.issue_attachments to service_role;
```

`update` 를 주지 않는 것은 RLS 에 update 정책을 만들지 않는 것과 짝이다(교체 = 삭제 + 재업로드).

개수 상한 10개는 DB 제약이 아니라 서버 액션이 검사한다. 첨부 추가에 경합이 생길 상황이 아니라
트리거를 얹을 값어치가 없다.

### 권한 헬퍼

> **[교정 2026-08-05]** `can_edit_issue` 는 **리포에 존재하지 않는다**(`supabase/migrations` grep 0건).
> 아래는 이 마이그레이션이 **신설**하는 함수다. 뒤의 "세 층이 같은 정의" 서술은 목표이지 현황이 아니다.

```sql
create or replace function public.can_edit_issue(iid uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.issues i
    where i.id = iid
      and (i.created_by = auth.uid() or public.is_project_admin(i.project_id))
  )
$$;
revoke all on function public.can_edit_issue(uuid) from public, anon, authenticated;
grant execute on function public.can_edit_issue(uuid) to authenticated;
```

`security definer set search_path = ''` 는 0052:34 가 명시한 `pg_temp` 가로채기 차단 패턴이다.
definer 함수 본문에서는 스키마를 전부 정규화한다.

`is_project_admin()` 은 **이미 슈퍼유저를 포함한다**(0052:43-48). `project_roles` 의 컬럼은
`user_id` 이고(`member_id` 아님), `role` 값은 `'admin' | 'member'` 둘뿐이다 — 조회 전용은
행의 부재로 표현한다.

> **`app_role()` 을 쓰지 말 것.** 프로젝트 무관 shim 이라 "A 프로젝트 멤버가 B 프로젝트 첨부를
> 쓰는" 구멍이 열린다. 0053 이 issues 정책을 프로젝트 스코프 축으로 이미 갈아끼웠다(0053:173-189).

`issues.created_by` 는 `auth.users(id)` 를 가리키므로 `auth.uid()` 와 직접 비교할 수 있다(0041:40).
담당자 축(`project_members.id`)과는 분리돼 있다. `on delete set null` 이라 계정이 삭제되면
그 이슈의 '작성자' 게이트는 영구 소멸하고 관리자만 첨부를 만질 수 있게 된다 — 권한 누수는 아니다
(`NULL = auth.uid()` 는 false).

### RLS

```sql
alter table public.issue_attachments enable row level security;

create policy read_issue_attachments on public.issue_attachments
  for select to authenticated using (true);
create policy insert_issue_attachments on public.issue_attachments
  for insert to authenticated with check (public.can_edit_issue(issue_id));
create policy delete_issue_attachments on public.issue_attachments
  for delete to authenticated using (public.can_edit_issue(issue_id));
```

`update` 정책은 만들지 않는다 — 첨부 교체는 삭제 + 재업로드다(0036 이 같은 판단을 했다).

스토리지 객체 정책은 경로 첫 세그먼트가 `issue_id` 라는 규약을 이용한다. 0036:19-29 가
`deliverables` 에 쓴 것과 같은 형태다 — 단 **insert·delete 만 같고 read 는 다르다.**
0036 의 read 는 `using (bucket_id = ... and can_attach(...))` 로 좁은데, 여기 read 는
`using (true)` 로 넓다(다운로드는 로그인 사용자 전체). 의도된 차이다.

```sql
drop policy if exists "issue-attachments read"   on storage.objects;
drop policy if exists "issue-attachments insert" on storage.objects;
drop policy if exists "issue-attachments delete" on storage.objects;

create policy "issue-attachments read" on storage.objects for select to authenticated
  using (bucket_id = 'issue-attachments');
create policy "issue-attachments insert" on storage.objects for insert to authenticated
  with check (bucket_id = 'issue-attachments'
              and public.can_edit_issue(split_part(name, '/', 1)::uuid));
create policy "issue-attachments delete" on storage.objects for delete to authenticated
  using (bucket_id = 'issue-attachments'
         and public.can_edit_issue(split_part(name, '/', 1)::uuid));
```

읽기가 넓은 것은 의도다 — 다운로드는 로그인 사용자 전체이므로.

> **read 정책을 지우면 삭제가 조용히 깨진다.** storage-js 의 `remove()` 는 objects 에
> `delete` **와 `select` 를 함께** 요구한다(`index.d.cts:1494-1498`). read 정책이 그 요구를
> 이미 충족하고 있으므로, "다운로드를 좁히자"며 read 를 지우면 브라우저 보상 삭제와
> 서버 삭제가 둘 다 실패한다 — 그것도 아래 이유로 **에러 없이** 실패한다.

**이 정책이 실제로 작동한다.** `createServerClient()` 는 anon key + 세션 쿠키로 만드는
사용자 스코프 클라이언트라 서버 액션에도 RLS 가 걸린다(`src/lib/supabase/server.ts:6-15`).
이슈 계열 액션은 전부 이 클라이언트로 쓰므로(회의록처럼 `createAdminClient()` 로 우회하지 않는다)
RLS 가 서버 액션 가드의 2차 방어선으로 살아 있다. 뒤집어 말하면 **정책을 틀리게 쓰면 기능이
그냥 막힌다** — 적용 후 실제 삽입·삭제로 확인해야 한다.

> **알려진 층위 차이(의도).** 0053 의 `member_update_issues` 는 이슈 **본문** 수정을 프로젝트 멤버
> 전원에게 열어둔다(0041 헤더가 '열 단위 요구를 행 RLS 로 표현할 수 없어 의도적 완화'라고 적어둔 그것).
> 첨부는 그보다 좁은 작성자·관리자다. 화면에서는 비대칭이 드러나지 않는다 — 수정 폼 자체가
> `canEdit`(작성자 또는 관리자)으로 게이팅되기 때문이다. 진행 필드(상태·담당·조치메모)만
> 멤버 전원이고, 그건 별도 액션(`updateIssueProgress`)이다.

---

## 3. 서버 액션 — `src/app/actions/issueAttachments.ts`

세 개다. 전부 `createServerClient()` 를 쓴다(service_role 로 우회하지 않는다).

```ts
listIssueAttachments(issueId: string): Promise<IssueAttachment[]>
recordIssueAttachment(issueId: string, file: {fileName; filePath; size; mime}): Promise<{ok; error?}>
removeIssueAttachment(id: string): Promise<{ok; error?}>
```

### 권한

> **[교정 2026-08-05]** 초안은 `src/app/actions/issues.ts` 에 `requireIssueEditable` 을 신설해
> **export** 하라고 했다. **그렇게 하면 안 된다** — 그 파일은 `'use server'` 라서 export 하는 순간
> 브라우저에서 직접 호출 가능한 서버 액션 엔드포인트가 하나 늘어난다. 권한 판정기를 공개 엔드포인트로
> 만들 이유가 없다. 아래는 실측 후 확정된 형태다.

`requireIssueEditable(issueId)` 는 **새 파일 안의 module-private 함수**로 둔다.
선례가 정확히 그것이다 — `attachments.ts:16` 의 `requireAttachPermission` 도 export 하지 않는
로컬 헬퍼다. 이러면 `issues.ts` 는 `deleteIssue` 정리 외에는 손대지 않아도 된다.

```ts
async function requireIssueEditable(issueId: string): Promise<
  | { ok: true; projectId: string; userId: string }
  | { ok: false; error: string }
>
```

**기존 `adminOrOwnerGate` 를 재사용할 수 없다.** 실측(`issues.ts:559-568`)상 그 게이트는
`isAdmin` 과 `userId` 만 돌려주고 **`created_by` 를 비교하지 않는다** — 소유자 판정은 호출부
(`deleteIssue:1067`, `updateIssue:907-909`)가 각자 한다. 내부에서 `resolveProjectId` 로 구한
`projectId` 도 반환하지 않는다. 따라서 새 헬퍼는 `issues` 를 한 번 더 읽어
`project_id, created_by` 를 가져와야 한다.

`resolveProjectId` 의 반환은 `projectId: string | null` 이다(`authz/index.ts:156`).
`attachments.ts:16` 은 이 null 을 그대로 안고 `:78` 에서 `if (g.projectId)` 로 분기하는데,
첨부 메타의 `project_id` 는 **not null 컬럼**이라 그 방식을 쓸 수 없다 — null 이면 중단한다.

`projectId` 를 함께 돌려주는 이유는 둘이다 — `recordIssueAttachment` 가 채워 넣을 값이고,
재검증 경로의 인자다. 이슈 조회가 실패하면 "권한 없음"이 아니라 **중단**한다(fail-closed).
조회 실패 문구는 이미 있는 상수를 재사용한다 — `issues.ts:557` 의
`ERR_LOOKUP = '권한을 확인할 수 없어 중단했습니다.'`.

> **`revalidateIssues(projectId)` 를 부를 수 없다.** `issues.ts:502` 에 있지만 **export 되지 않은
> 동기 함수**이고, `'use server'` 파일은 async export 만 허용하므로 export 로 열 수도 없다.
> 새 파일은 `revalidatePath('/p/{projectId}/issues')` 를 직접 부른다.

기존 `updateIssue` 는 **건드리지 않는다.** 같은 조회에서 `mega_code`·`source_type` 까지 읽고
(`issues.ts:904`) 회의록 원천 승격 시 `issue_links` 재조회까지 하므로(`927-946`) 헬퍼로 대체되지 않는다.

> **[교정]** 초안은 `deleteIssue` 도 같은 이유로 대체 불가라고 했으나 사실이 아니다 —
> `deleteIssue:1064` 는 `project_id, created_by` 만 읽고 불변 규칙 검사가 없다. 그래도 **바꾸지 않는다.**
> 대체해서 얻을 것이 없고 회귀 위험만 사기 때문이다(초안의 결론은 유지, 근거만 정정).

### `recordIssueAttachment` 의 검증 3종

1. `requireIssueEditable(issueId)`
2. **`filePath` 가 `${issueId}/` 로 시작하는지.** 이게 없으면 편집 권한이 있는 이슈 하나로
   임의 경로의 객체를 메타에 꽂을 수 있다.
3. 기존 개수 + 1 ≤ 10. 조회가 실패하면 통과시키지 않고 중단한다.

`project_id` 는 클라이언트가 보내는 값이 아니라 **서버가 이슈에서 읽어 채운다.**

### 서명 URL

```ts
sb.storage.from('issue-attachments').createSignedUrl(filePath, 3600, { download: fileName })
```

`download?: string | boolean` 는 설치본 타입에서 확인했다
(`node_modules/@supabase/storage-js/dist/index.d.cts:1202-1214`, storage-js 2.108.2).
문자열을 주면 그 이름으로 `Content-Disposition: attachment` 가 붙는다.

복수형 `createSignedUrls()` 는 **`download` 를 경로별로 다르게 줄 수 없어** 쓸 수 없다.
파일마다 원본 이름을 복원해야 하므로 건별로 호출한다(기존 `listAttachments` 도 루프다).
반환 타입이 유니온이라 `error` 분기 없이 `data.signedUrl` 에 접근하면 타입 에러가 난다.

> **[교정] `listAttachments` 의 루프를 그대로 복사하지 말 것.** 그 선례(`attachments.ts:50`)는
> `createSignedUrl` 의 `error` 를 **버리고** `signed?.signedUrl ?? null` 로 넘어간다 —
> 서명 실패가 화면에서 "다운로드 링크 없음"으로 위장된다(에러 3원칙① 위반).
> 같은 파일의 `:37-41`·`:85-91`(실패를 로깅·중단하는 쪽)을 본떠 **error 를 구조분해해 로깅**한다.
>
> **[교정] `{ download: fileName }` 은 빈 문자열 방어가 없다.** 선례 `minutes.ts:715` 는
> `{ download: (f.file_name as string) || true }` 로 falsy 폴백을 둔다. `file_name` 은 not null 이지만
> 빈 문자열은 막지 못하므로 같은 폴백을 쓴다.

### 삭제와 정리

`removeIssueAttachment` 는 **Storage 객체 제거를 메타 행 삭제보다 먼저** 한다
(`attachments.ts:95` 와 같은 순서). 반대로 하면 메타를 잃은 객체를 다시 찾을 수 없다.

> **`remove()` 의 반환으로 성공을 판정할 수 없다.** 아무것도 지우지 못해도
> `{ data: [], error: null }` 이다(`index.d.cts:1488-1506`). `if (error)` 는 전송·비2xx 실패만 잡고
> RLS 거부와 없는 키를 구분하지 못한다. 리포의 remove 호출 6곳 중 반환값을 보는 것은
> `actions/minutes.ts:650` 하나뿐이고 그마저 0건 삭제를 구분하지 못한다.
> **뒤집어 말하면 보상 삭제는 멱등이라 재실행이 안전하다** — 실패를 감지할 수 없으니
> 감지에 기대는 설계를 하지 않는다.

`deleteIssue`(`issues.ts:1059-1074`)에 정리를 추가한다. 지금은 `sb.from('issues').delete()` 한 줄뿐이라
복합 FK cascade 로 **메타 행만 사라지고 버킷 객체는 영구 잔존**한다.

```
첨부 경로 조회  →  실패하면 중단(에러 3원칙 ②: 쓰기 전 선행 조회 실패는 중단)
storage.remove →  실패하면 경고 로그 후 진행(고아 객체만 남는다)
issues.delete
```

---

## 4. UI

### 공용 컴포넌트

`src/components/issues/IssueAttachments.tsx` 하나가 세 자리를 덮는다.

| 자리 | props | 동작 |
|---|---|---|
| 등록 폼 | `issueId={null} editable` | 고른 파일을 `File[]` state 에 담기만 함. 업로드 안 함 |
| 수정 폼 | `issueId={initial.id} editable` | 고르는 즉시 업로드 → `recordIssueAttachment` |
| 상세 모달 | `issueId={issue.id}` editable 없음 | 파일명 클릭 = 다운로드 |

업로드는 **브라우저가 Storage 에 직접** 한다. 서버 액션은 메타만 기록한다.

> 파일 바이트를 서버 액션으로 넘기는 형태는 **불가능하다.** Next.js Server Action 본문 기본 상한이
> 1MB 인데 `next.config.ts` 에 `experimental.serverActions.bodySizeLimit` 설정이 없고,
> 그 위에 Vercel 서버리스 요청 본문 상한 4.5MB 가 또 있다. 리포의 기존 업로드 3곳
> (`RowDetailPanel.tsx:572-582`, `MinuteUploadModal.tsx:136,178`, `MinuteViewer.tsx:604-609`)이
> 전부 브라우저 직접 업로드 + 메타 기록 분리인 이유다.

실패 보상도 그 관례를 따른다 — `recordIssueAttachment` 가 실패하면 방금 올린 객체를
`storage.remove()` 로 지운다. 메타 없는 고아 객체를 남기지 않는다.

### 등록 흐름 — 가장 까다로운 부분

`IssueFormModal.submit()` 의 성공 분기는 `IssueModals.tsx:653` 이고, 그 안은 이렇게 돌아간다:

```
653  if (res.ok) {
654    if (!isEdit && res.id) → onCreated?.(res.id, res)   // fire-and-forget, 예외 삼킴
662    onClose()                                            // ← 모달 언마운트
663    router.refresh()
```

**업로드를 `onCreated` 에 걸면 안 된다.** 콜백이 반환되자마자 `onClose()` 가 모달을 언마운트해
파일을 담고 있던 state 가 사라진 뒤 업로드가 돈다. 업로드는 **653 과 662 사이에서 await** 해야 한다.
그동안 `startTransition` 의 `pending` 이 유지되어 닫기 버튼이 막히는데(`679-680`), 이건 오히려
원하는 동작이다 — 업로드 중 창이 닫히지 않는다.

`ok: true` + `id` 는 이슈 행이 확정 존재함을 보장한다. `createIssue` 는 담당자 저장이 실패하면
방금 만든 이슈를 되지우는 보상 롤백을 이미 갖고 있고(`issues.ts:606-616`), 그 이후에만 성공을
반환하기 때문이다. 업로드가 유령 이슈에 붙을 창이 없다.

회의록 파생 등록(`onCreate` 주입 경로, `MinuteViewer.tsx:898`)도 그대로 동작한다 —
`createIssueFromMinuteBlock` 이 같은 shape 으로 `id` 를 반환한다(`issues.ts:885-890`).
`IssueCreateHandler` 시그니처에는 파일을 넘길 자리가 없으므로, 첨부는 핸들러 밖에서 `res.id` 로 처리한다.

**업로드가 일부 실패해도 이슈 생성을 되돌리지 않는다.** 이슈는 이미 만들어졌고, 되돌리면 사용자가
입력을 통째로 잃는다. "이슈는 등록됐고 첨부 2건 중 1건이 실패했습니다"를 그대로 표시하고 모달을
닫지 않아 재시도하게 한다. 이때 `submittingRef.current` 를 직접 false 로 되돌려야 한다 —
성공 경로는 그것을 해제하지 않고, 해제는 `open` 이 바뀔 때의 `useEffect`(`508-529`)가 하기 때문이다.

수정 폼은 `updateIssue` 가 **id 를 반환하지 않으므로**(`{ok, piIssueCode}` 뿐) `initial.id` 를 쓴다.
어차피 즉시 업로드라 저장 시점과 무관하다. (654행이 `!isEdit && res.id` 로 이미 거르므로
수정 모드에서 `res.id` 는 애초에 오지 않는다.)

#### 실측으로 드러난 함정 넷 — 초안에 없던 것

**① 파일 state 는 `IssueFormModal` 로 끌어올린다.** `IssueAttachments` 내부 state 로 두면
업로드를 await 해야 하는 코드(`submit()`)에서 그 값에 닿을 수 없다. 또 `IssuesView.tsx:274` 는
`onCreate`/`onCreated` 를 아예 주입하지 않으므로(open/onClose/projectId/initial/members 뿐)
업로드 코드가 폼 안에 있어야 두 호출부(목록·회의록)를 한 번에 덮는다.

**② `seedKey` 이펙트가 고른 파일을 조용히 지운다 — 가장 위험하다.**
`useEffect(508-529)` 의 deps 는 `[open, seedKey]` 이고 `seedKey`(`:499`)는 매 렌더
`JSON.stringify(issueFormSeed(...))` 로 만들어진다. 즉 **모달이 열려 있는 중에도**
`initial`/`draft`/`sourcePreview` 가 바뀌면 이펙트가 다시 돌아 폼을 통째로 재시드한다.
파일 state 초기화를 이 이펙트의 `open` 분기(514-528)에 넣으면 사용자가 고른 파일이 사라진다.
초기화는 `!open` 분기(509-511)나 `open` 만 보는 별도 이펙트에서 한다.

이게 중요한 이유는 **마운트 수명이 호출부마다 다르기 때문**이다 —
`IssuesView.tsx:274` 는 `IssueFormModal` 을 항상 마운트해 두고 `Modal.tsx:82` 가 children 만
언마운트하므로 닫아도 폼 state 가 살아남는다(다음 open 때 508-529 가 재시드).
반면 `MinuteViewer.tsx:877` 은 `{issueBlock && (…)}` 조건부라 컴포넌트째 사라진다.
**목록 화면에서만 이전 선택이 잔존하므로 명시적 리셋이 필요하다.**

**③ `submit()` 의 정확한 삽입 좌표와 실패 처리.**

```
558      재진입 가드
559-624  순수 검증 15종 (여기까지 submittingRef 를 건드리지 않는다)
625-639  input 조립
640      submittingRef.current = true
641      startTransition
642-652  액션 호출 (throw 시 649 에서 해제)
653-663  성공 — 해제하지 않는다        ← 업로드는 653 진입 후 662 이전에 await
664-667  실패 — 해제 + setError
```

업로드가 실패하면 `submittingRef.current = false` + `setError` 후 **`return`** 해서
662(`onClose`)·663(`router.refresh`)에 도달하지 않게 한다. 성공 경로는 ref 를 해제하지 않고
해제는 `open` 이 바뀔 때의 이펙트가 하기 때문이다.

**④ 부분 실패 재시도에 중복 업로드 방지 장치가 필요하다.**
초안은 "닫지 않고 재시도"만 말했는데, 3개 중 2번째가 실패한 뒤 재시도하면 1번째가 **다시 올라간다**.
선례가 이미 해법을 갖고 있다 — `MinuteUploadModal` 은 `progressRef.current = { id, done: i + 1 }`(`:189`)를
남기고 다음 루프를 `for (let i = progressRef.current?.done ?? 0; …)`(`:175`)로 시작한다. 같은 방식을 쓴다.
세 선례 모두 `{ upsert: false }` 이므로 경로의 타임스탬프는 선택이 아니라 필수다.

### 상세 모달

삽입 위치는 **`IssueModals.tsx:419`** — 회의록 원문 섹션(385-418) 다음, 진행 편집 블록(420-447) 직전.
회의록 섹션이 이미 `조건부 렌더 + 소제목 + space-y-2 카드 목록` 패턴을 갖고 있어 그대로 따라간다.
진행 편집 블록 안에 넣으면 푸터 '진행 저장' 버튼의 대상이 흐려진다. 바깥 컨테이너가 `space-y-4` 라
마진은 직접 주지 않는다.

권한 prop 은 **추가하지 않는다.** 기존 `canEdit` 이 정확히 `작성자 || 프로젝트 관리자` 다
(`canEditIssue`, `domain/issues.ts:144-147`). 다만 상세 모달은 읽기 전용이므로 실제로는 쓰지 않는다.

상세 모달은 **로그인 사용자 누구나 연다**(행 클릭·Enter·`?focus=` 딥링크 전부 무검사).
다운로드 정책(로그인 전체)과 정확히 일치한다.

### 목록 배지

`IssuesView.tsx:221` 의 제목 셀 안에 인라인으로 붙인다. 제목 열은 28% 로 가장 넓고
`whitespace-normal break-words` 라 배지가 줄바꿈돼도 셀이 깨지지 않는다.
선례는 `MinutesExplorer.tsx:858-862` 다. `Paperclip` 을 lucide import 줄(`IssuesView.tsx:6`)에 추가한다.

> **[교정] 그 선례를 통째로 복사하지 말 것.** `MinutesExplorer` 의 배지는 카드 **푸터**(flex 컨테이너)
> 안이라 `ml-auto` 로 오른쪽 끝에 민다. 제목 `<td>` 는 flex 가 아니라 `ml-auto` 가 무의미하고,
> 제목을 flex 로 감싸면 배지가 셀 오른쪽 끝까지 날아간다. `inline-flex items-center gap-1 align-middle`
> 만 가져온다.
>
> 제목 `<td>` 에는 **이미 `title={issue.title}` 이 걸려 있다.** 배지 위에서도 제목 툴팁이 뜨므로,
> 첨부 개수를 알리려면 배지 `<span>` 에 자체 `title`/`aria-label` 을 줘서 덮어써야 한다.

**새 열은 만들지 않는다** — `colgroup` 8개 `<col>` 폭(12/10/28/7/7/17/10/9)을 전부 재배분해야 하고,
합이 100% 를 벗어나면 `table-fixed` 가 조용히 뭉갠다.

### 데이터 계층

`getIssues`(`src/lib/data/issues.ts`)의 `Promise.all` 에 5번째 쿼리를 추가한다.

```ts
sb.from('issue_attachments').select('issue_id').eq('project_id', projectId)
```

**FK 임베드(`issue_attachments(count)`)를 쓰지 않는다.** 이 파일의 주석(`11-17`)이 경고하는 그것이다 —
"관계 미탐지 시 부모 쿼리 전체가 죽는다". 담당자·회의록 링크가 이미 별도 조회 + Map 병합이다.

> **[교정]** "이 파일이 임베드를 금지한다"는 서술은 과하다 — 같은 파일 `getMinuteLinkedIssues`(`:128`)가
> 제약명을 박은 임베드(`issues!issue_links_issue_project_fk(...)`)를 실제로 쓴다. 금지가 아니라
> **`getIssues` 의 관례**이며, 그 관례를 따르는 것이 결론이다.

조회 실패는 로그를 남긴다(silent-empty 금지). `:41-45` 가 네 쿼리를 **한 줄씩 개별로** 로깅하므로
`[getIssues] 첨부 조회 실패:` 를 같은 블록에 추가한다. 조기 return 은 없고 `?? []` 로 진행하는
부분 열화 방식이다 — 첨부 조회가 죽어도 이슈 목록은 떠야 한다.

`Issue` 타입에는 **`attachmentCount?: number` 를 optional 로** 넣는다. 필수로 하면
`IssueAnalysisIssueInput = Issue & {...}`(`report/issues/model.ts:57`) 때문에 객체를 만드는
**14곳(src 2 + tests 12)이 컴파일 실패**한다(초안의 "9곳(src 1 + tests 8)"은 오산 —
`src/lib/data/issueAnalysis.ts` 가 빠져 있었다). `majorId`/`majorSeq`/`majorName` 이 같은 이유로
이미 optional 이고(`domain/issues.ts:21-28`), "데이터 계층은 항상 채운다, 소비처는 `?? 0`" 이라는
계약을 주석으로 남기는 것이 그 선례다.

**계약 문구는 `getIssues` 한정으로 좁게 쓴다.** "모든 데이터 계층이 채운다"로 넓게 쓰면
`issueAnalysis.ts` 에도 첨부 조회를 넣어야 하고, 그 조회 실패가 분석서 생성 전체를 막게 된다.
첨부 개수는 목록 배지 전용이다.

### CSS 함정 둘

- **상태 변형 display 유틸(`group-hover:inline-flex` 등)을 쓰지 않는다.** `globals.css` 끝의
  unlayered 반응형 안전망이 이겨서 조용히 동작하지 않는다. 배지도 삭제 버튼도 JSX 조건부 렌더로
  켜고 끈다. `tests/css/breakpoint-safety-net.test.ts` 가 검사한다.
- 숨김 `<input type="file" className="hidden">` 은 `Modal` 의 포커스 트랩에서 빠진다
  (`Modal.tsx:53` 이 `offsetParent !== null` 로 거른다). 라벨로 트리거하면 실사용에 문제없다.

### i18n

`src/lib/i18n/dict/issues.ts` 에 `issue.attach.*` · `issue.err.attach*` 키를 추가한다.
배치는 기존 구획을 따른다 — `issue.err.*` 는 ko `:120-136` / en `:255-271` 의 꼬리 블록에 모여 있고
그 뒤가 바로 `} as const`(`:138`) 다. 따라서 `issue.attach.*` 는 err 블록 **앞**(일반 라벨 구역),
`issue.err.attach*` 는 err 블록 **끝**(`issue.err.deleteFailed` 뒤)에 넣고 en 도 같은 순서로 맞춘다.
치환 변수는 `{n}` 형식이며 호출부가 `.replace('{n}', …)` 한다. 기존에 `issue.attach.*`·`issue.file.*` 키는 없다.
`issuesKo` 에 넣으면 `issuesEn` 에도 반드시 넣어야 한다 —
`Record<keyof typeof issuesKo, string>` 타입이 패리티를 컴파일 타임에 강제한다.
새 네임스페이스 파일을 만들지 않으므로 `dict.ts` 는 손대지 않는다.

---

## 5. 검증

### 테스트

| 대상 | 위치 | 내용 |
|---|---|---|
| 순수 함수 | `tests/domain/issue-attachments.test.ts` | 파일명 sanitize, 경로 생성, 50MB·10개 상한 판정 |
| 마이그레이션 계약 | `tests/migrations/issue-attachments.test.ts` | SQL 텍스트를 읽어 멱등성·정책·롤백 커버리지 검사 |

순수 로직은 `src/lib/domain/issueAttachments.ts` 로 뽑는다. 이 리포는 `src/` 안에 콜로케이트된
테스트가 0개이고 전부 `tests/` 아래에 있다. 이슈 계열 기존 파일이 kebab-case 라
(`issue-analysis.test.ts`, `issue-minute-source.test.ts`) 같은 형태로 맞춘다.

마이그레이션 테스트는 `readFileSync` 로 SQL 원문을 읽어 문자열·정규식으로 계약을 박는
기존 파일들의 방식을 따른다(`issue-major-processes.test.ts:1-11` 이 표준형).
**스토리지 버킷·정책을 검사하는 테스트는 리포에 선례가 없다** — 이번이 처음이다.

`migration-ledger.test.ts` 가 정방향 SQL 전체에 거는 계약은 **롤백 짝 하나뿐**이다
(나머지 검사는 0050 자체의 문자열 검사와 rollback 고아 검사다). 즉 새 마이그레이션이
자동으로 통과해야 할 관문은 `_rollback.sql` 존재 하나다.

업로드·보상 경로는 UI 테스트로도 잡을 수 있다 — `tests/ui/minute-upload-modal.test.tsx:26` 이
`createBrowserClient` 를 `{ storage: { from: () => ({ upload, remove }) } }` 로 모킹하는 선례다.
초안의 표에는 없지만 §4 ④(중복 업로드 방지)를 검증할 유일한 자동 수단이므로 추가한다.

CSS 안전망 검사(`breakpoint-safety-net.test.ts:44-55`)의 스캔 범위는 `src/` 전체 `.ts/.tsx` 라
신규 `IssueAttachments.tsx` 도 자동으로 대상이 된다. 금지 VARIANT 에 `group-*`·`peer-*`·`data-[…]:` 가
포함되므로 위 §4 의 경고는 테스트로 강제된다.

### 테스트가 잡지 못하는 것

UI 회귀는 vitest 로 안 잡힌다(2026-07-27 사고 때 2438건이 전부 통과했다).
배포 후 화면 확인 + `npm run smoke:prod` 로 마무리한다.

RLS 정책도 마찬가지다. 정책이 틀리면 타입 체크·빌드·테스트가 전부 통과한 채로 기능만 막힌다.
**마이그레이션 적용 직후 실제 업로드·다운로드·삭제를 한 번씩** 해봐야 한다.

### 배포 순서

1. 마이그레이션을 Management API 로 **먼저** 적용(`supabase db push` 금지). 테이블이 없는 상태로
   `getIssues` 가 돌면 매 요청 PGRST 오류가 로그를 오염시킨다(0027 사고 교훈).
2. 마이그레이션과 코드는 **별도 커밋**(pre-push 훅 G1).
3. 코드 배포 → `npm run smoke:prod` → 화면 확인 → `npm run mark:good`.

`src/components/app/*` 나 `globals.css` 를 건드리지 않으므로 G2 브랜치 규칙 대상이 아니다.
`git add -A` 를 쓰지 않는다(병렬 세션).

---

## 6. 하지 않는 것

- 파일 미리보기·썸네일·문서 뷰어. "뷰어가 아니라 저장"이 요구사항의 핵심이다.
- 첨부 내용의 AI 분석·RAG 인덱싱. 이슈 분석(`issueAnalysis`)은 본문만 본다.
- 드래그 앤 드롭, 업로드 진행률 바, 재개 가능(TUS) 업로드. 50MB 이하 파일에 필요 없다.
- 첨부 이력·버전 관리. 교체는 삭제 + 재업로드다.
- 주간보고·PPT 리포트에 첨부 반영.

---

## 7. 검증 이력

2026-08-05, 이 문서의 코드 인용을 11갈래로 나눠 실측 대조했다(브랜치 `feat/issue-attachments`).
주장 39 + 43건을 확인했고 위 본문의 `[교정]` 표시가 그 결과다.

**틀렸던 것** — `requireIssueEditable` 을 `'use server'` 파일에서 export 하라는 지시(엔드포인트가 늘어난다),
`adminOrOwnerGate` 가 `created_by` 를 비교한다는 전제(하지 않는다), `revalidateIssues` 호출 가능 전제
(module-private 동기 함수라 불가), `can_edit_issue` 가 이미 있다는 전제(없다 — 이 마이그레이션이 신설한다),
`deleteIssue` 가 불변 규칙을 검사한다는 근거(하지 않는다), `attachmentCount` 필수화 시 깨지는 곳 9→14,
"이 파일이 FK 임베드를 금지한다"(같은 파일에 반례가 있다), `migration_ledger` 기록 관례 존재(없다).

**맞았던 것** — §4 UI 계층의 라인 인용은 삽입 위치·colgroup 폭·`canEdit` 정의·상세 모달 개방 범위까지
전부 실측 일치했고, 업로드 선례 3곳과 storage-js 2.108.2 의 `download?: string | boolean`,
`createSignedUrls` 의 옵션 단일성, `next.config.ts` 의 `experimental` 부재도 그대로였다.

**확인할 수 없던 것** — 마이그레이션 SQL 자체(버킷·테이블·RLS·`can_edit_issue`)는 아직 적용 전이라
텍스트 계약 테스트로만 검증된다. §5 의 "적용 직후 실제 업로드·다운로드·삭제 한 번씩"이
이 구간의 유일한 검증 수단이므로 생략할 수 없다.
