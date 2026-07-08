# 회의록(Meeting Minutes) 기능 — 이어서 작업용 핸드오프

> 작성: 2026-07-09. 다른 컴퓨터에서 이어받기 위한 상태 기록. 설계 전문은
> `docs/superpowers/specs/2026-07-08-meeting-minutes-design.md`, 태스크별 계획은
> `docs/superpowers/plans/2026-07-08-meeting-minutes.md` 참고.

## 지금 어디까지 됐나

- **브랜치 `feat/meeting-minutes`** — `origin`에 푸시됨(upstream 설정 완료). main보다 42커밋 앞섬.
- **PR 미생성.** 링크: https://github.com/donseok/wbs-web/pull/new/feat/meeting-minutes
- **코드 완료.** 게이트 전부 통과(깨끗한 트리 기준):
  - `npx tsc --noEmit -p tsconfig.json` — clean
  - `npx eslint .` — clean
  - `npx vitest run` — **548 통과 / 54 파일**
  - `npm run build` — 성공
  - `git merge-tree` — main과 **충돌 없음**
- **미배포 · 미병합.** Preview조차 아직. 아래 "병합/QA 전 필수"를 먼저 해야 함.

## 이어받는 순서 (다른 컴퓨터에서)

```bash
git fetch origin
git switch feat/meeting-minutes    # 또는 git checkout
git pull
npm install                        # react-markdown@10, remark-gfm@4 가 lockfile 에 추가됨
npx vitest run                     # 548 통과 확인
npm run build                      # 성공 확인
```

## ⛔ 병합/QA 전 필수 (사람이 직접 — 자동화 불가)

### 1. 마이그레이션 `supabase/migrations/0020_meeting_minutes.sql` 수동 적용

`SUPABASE_DB_URL`이 비어 있고 `supabase login` 안 돼 있어 CLI/자동 적용 불가.
Supabase 대시보드 → SQL Editor 에 파일 전문을 붙여넣어 실행. 멱등(재실행 안전)하게 작성돼 있음.

**적용 *전에* 반드시 이 프로브를 먼저 돌린다.** 파일에 남은 **유일한** 미검증 가정
(`storage.objects.name == meeting_minutes.file_path`)을 확인하는 것:

```sql
-- attachments 에 행이 하나라도 있는지 먼저(0이면 실험 성립 안 함)
select count(*) from attachments;

-- storage.objects.name 이 upload() 에 넘긴 키(=file_path)와 같은가?
select o.name, a.file_path, (o.name = a.file_path) as matches
from storage.objects o join attachments a on a.file_path = o.name
where o.bucket_id = 'deliverables' limit 5;
```

- count가 0이 아닌데 조인이 **0행**이면 → 정책의 `EXISTS`가 절대 참이 안 됨 → **적용하지 말 것.**
  조인 키를 실제 컬럼으로 바로잡은 뒤 적용. (틀린 채 적용하면 삭제가 조용히 고아 객체를 만든다:
  `remove()`는 RLS 거부를 `200/[]/error:null`로 돌려주므로 코드가 성공으로 착각한다.)
- matches가 전부 `true`면 → 가정 확인됨 → 적용 진행.

적용 후 확인:
```sql
select count(*) from meeting_minutes;                       -- 0
select id, public, file_size_limit from storage.buckets where id='minutes';  -- minutes|false|20971520
select indexname from pg_indexes where tablename='meeting_minutes';
--   minutes_project_date_idx / minutes_meeting_idx / minutes_file_path_key
select policyname from pg_policies where tablename='objects' and policyname like 'minutes%';
--   minutes read / minutes insert / minutes delete
```

### 2. 육안 QA — `/p/{projectId}/minutes`

- 업로드: `.md` 파일(뷰어+챗 동작), 비-`.md` 파일(다운로드만, "바로보기 없음" 안내)
- 목록 팀 탭 필터(PMO/가공/ERP/MES 순) + 검색
- 뷰어: 마크다운/표 렌더, 다운로드
- 삭제: 업로더 본인 / 다른 사용자(권한 없음) / pmo_admin
- 챗 4프리셋(요약/결정/액션/리스크) + 자유 질문. `GEMINI_API_KEY` 없으면 안내 문구만.

## 되돌리면 안 되는 설계 결정 (세션 내내 다듬은 것)

1. **업로드 = 행-먼저, 객체-나중** (`MinutesUploadModal.tsx`). 삭제 = 객체-먼저, 행-나중
   (`actions/minutes.ts:deleteMinutes`). 둘 다 스토리지 삭제 정책의 `EXISTS(참조 행 존재)`가
   인가하게 하려는 것 → **고아 객체가 구조적으로 불가능**. `RowDetailPanel.tsx`(객체-먼저)와
   의도적으로 다름. 순서는 `tests/actions/minutes-gate.test.ts`가 `['remove','row-delete']`로 고정.
2. 스토리지 삭제 정책은 `owner`/`owner_id` 컬럼에 의존하지 않음(존재 여부 확인 불가라 제거).
   `exists(select 1 from meeting_minutes where file_path=storage.objects.name and (created_by=auth.uid() or app_role()='pmo_admin'))`.
3. `file_path` UNIQUE(위조 앨리어싱 차단). 읽기 RLS는 `using(true)`(레포 전 테이블 관례).
4. `MarkdownView`는 **서버 컴포넌트**(파서 클라 번들 0). **`rehype-raw` 금지**(저장형 XSS). 이미지 미렌더.
   XSS/링크 속성은 `tests/minutes/markdown-view.test.tsx`가 고정.
5. 챗 라우트는 `streamAnswer` **쓰지 않음**(RAG 인덱싱 유발) — `generateAnswerStream` 직접 호출.
   문서 본문+메타(제목 포함)를 `<document>`/`<meta>` 펜스로 감싸고 규칙을 본문 뒤에 재진술(제목 인젝션 차단).
6. 챗의 객체 삭제/서명URL은 세션 클라이언트(RLS 적용). `createAdminClient()` 금지
   — service_role 키는 **Production 에만** 있어 Preview/로컬에서 throw 한다.

## 알아두면 재발견 비용 아끼는 사실

- PostgREST `bigint` → JSON **숫자**(문자열 아님, `node-postgres`와 다름). 그래도 `size`는 경계에서 `Number()`.
- `.single()` 0행 → 서버가 실제로 보내는 코드는 `PGRST116`(메시지는 "Cannot coerce…", 흔히 인용되는
  "JSON object requested…"는 클라 합성 문구). `code`로 분기할 것, `message`로 하지 말 것.
- `createMinutes`는 `23505/23514/42501/22P02`를 사용자 메시지로 매핑, 나머지는 raw `error.message`.
- `next.config.ts`에 `serverActions.bodySizeLimit: '2mb'` 추가됨 — 한글 500k자 content_md(≈1.5MB)가
  Next 기본 1MB 한도에 잘리던 문제.
- i18n 키 prefix는 `min.*`(레포 관례: meet./ann. 등 축약형). ko/en 파리티는 `DictKey` 타입이 강제.
