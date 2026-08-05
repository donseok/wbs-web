# 0068 이슈 첨부 — 적용 절차

작성 2026-08-05 · 브랜치 `feat/issue-attachments`

## ⚠️ 순서를 지킬 것 — 어기면 이슈 삭제가 막힌다

마이그레이션이 코드보다 **먼저**다. 테이블이 없는 상태로 코드가 배포되면 두 가지가 일어난다.

1. 이슈 목록을 열 때마다 `getIssues` 의 첨부 조회가 PGRST 오류를 낸다 —
   목록 자체는 뜨지만 로그가 오염된다(0027 사고 교훈).
2. **`deleteIssue` 가 모든 이슈에 대해 실패한다.** 첨부 경로 조회가 실패하면 중단하도록
   만들었기 때문이다(`issues.ts:1074`). 지울 대상을 모르는 채 이슈를 지우면 버킷 객체를
   영원히 찾을 수 없으므로 fail-closed 가 맞지만(에러 3원칙 ②), 코드는 "테이블 없음"과
   "조회 실패"를 구분하지 못한다. **순서를 어기면 그 사이 이슈 삭제가 전부 막힌다.**

반대 순서(마이그레이션만 적용, 코드는 구 버전)는 **무해하다** — 아무도 쓰지 않는 빈 테이블일 뿐이다.
그래서 마이그레이션을 먼저 적용하고 확인한 뒤 코드를 배포한다.

---

## 1단계 — 마이그레이션 적용

Supabase 대시보드 → SQL Editor → 새 쿼리에
**`supabase/migrations/0068_issue_attachments.sql` 전문을 그대로 붙여넣고 Run.**

프로젝트: `rglfgrwwwwdqejohdnty` (ap-northeast-2)

전체가 `begin; … commit;` 한 트랜잭션이라 중간에 실패하면 **전량 롤백된다.**
즉 "절반만 적용된 상태"가 남지 않으므로, 실패하면 원인을 고치고 처음부터 다시 붙여넣으면 된다.

만드는 것은 다섯 가지이고 **기존 객체는 아무것도 건드리지 않는다**:

| | |
|---|---|
| 버킷 | `issue-attachments` (비공개, 파일당 50MB) |
| 테이블 | `public.issue_attachments` |
| 함수 | `public.can_edit_issue(uuid)` |
| 테이블 RLS | select(전체) · insert/delete(작성자·관리자) |
| 스토리지 정책 | 같은 규칙을 객체에도 |

## 2단계 — 적용 확인

같은 SQL 에디터에 붙여넣어 실행한다. **6행 모두 `ok` 여야 한다.**

```sql
select '버킷' as 항목,
       case when exists (
         select 1 from storage.buckets
         where id = 'issue-attachments' and public = false and file_size_limit = 52428800
       ) then 'ok' else 'FAIL' end as 상태
union all
select '테이블',
       case when exists (
         select 1 from information_schema.tables
         where table_schema = 'public' and table_name = 'issue_attachments'
       ) then 'ok' else 'FAIL' end
union all
select '복합 FK',
       case when exists (
         select 1 from pg_constraint
         where conname = 'issue_attachments_issue_project_fk'
       ) then 'ok' else 'FAIL' end
union all
select '편집 게이트 함수',
       case when exists (
         select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public' and p.proname = 'can_edit_issue'
       ) then 'ok' else 'FAIL' end
union all
select '메타 RLS 정책 3개',
       case when (
         select count(*) from pg_policies
         where schemaname = 'public' and tablename = 'issue_attachments'
       ) = 3 then 'ok' else 'FAIL' end
union all
select '스토리지 정책 3개',
       case when (
         select count(*) from pg_policies
         where schemaname = 'storage' and tablename = 'objects'
           and policyname like 'issue-attachments%'
       ) = 3 then 'ok' else 'FAIL' end;
```

`update` 정책이 없는 것이 정상이다 — 첨부 교체는 삭제 + 재업로드다.

## 3단계 — 코드 배포

```bash
git switch main && git merge feat/issue-attachments && git push origin main
```

Vercel 이 자동 배포한다. `vercel --prod` 를 따로 실행하지 않는다.

## 4단계 — 실제로 해볼 것 (생략 불가)

**RLS 는 테스트로 잡히지 않는다.** 정책이 틀리면 타입체크·빌드·vitest 3725건이 전부 통과한 채
기능만 조용히 막힌다. 배포 후 다음을 한 번씩 직접 해봐야 한다.

1. 이슈 **등록** 폼에서 파일 2개를 붙여 저장 → 목록에 클립 배지 `2` 가 뜨는가
2. 이슈 **상세**를 열어 파일명을 클릭 → **원본 파일명 그대로** 내려받아지는가 (한글 이름 포함해서 볼 것)
3. 이슈 **수정** 폼에서 파일 추가 → 즉시 올라가는가
4. 수정 폼에서 파일 **삭제** → 목록에서 사라지는가
5. **다른 사람이 만든 이슈**로 위를 반복 → 관리자가 아니면 추가·삭제 버튼이 막히는가
6. 마지막으로 `npm run smoke:prod` → `npm run mark:good`

## 문제가 생기면

증상별로 원인이 갈린다.

| 증상 | 원인 후보 |
|---|---|
| 업로드가 403 | 스토리지 insert 정책 또는 `can_edit_issue` 판정 |
| 업로드는 되는데 목록에 안 뜸 | 메타 insert 정책(테이블 RLS) |
| 다운로드 링크가 없음 | 서명 URL 생성 실패 — 서버 로그에 `[listIssueAttachments] 서명 URL 생성 실패` 가 남는다 |
| 삭제가 아무 반응 없음 | 스토리지 delete 정책. `remove()` 는 실패해도 에러를 내지 않는다 |
| 목록 배지가 안 뜸 | `getIssues` 첨부 조회 실패 — 로그에 `[getIssues] 첨부 조회 실패` |

되돌리려면 `supabase/migrations/0068_issue_attachments_rollback.sql` 을 같은 방식으로 실행한다.
**롤백은 업로드된 파일을 지우지 않는다** — 되돌릴 수 없는 사용자 데이터라 버킷과 객체는 남긴다.
파일까지 지우려면 그 파일 주석의 명령을 의도적으로 실행해야 한다.

## 원장(`migration_ledger`)에 대하여

0050 이 원장 테이블을 도입했지만 **여기에 기록하지 않는다.** 이유는 둘이다 —
새 마이그레이션을 원장에 넣는 관례·자동화가 리포에 없고(참조는 `apply-0050.mjs` 의 1회성 백필뿐),
`docs/runbook-rollback.md:103` 에 따르면 **원장 테이블 자체가 프로덕션에 없을 수 있다.**
0051~0067 열일곱 건도 모두 원장 insert 없이 적용됐다.
