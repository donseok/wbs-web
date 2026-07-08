# 회의록(Meeting Minutes) 설계

- 작성일: 2026-07-08
- 상태: 승인 대기
- 브랜치: `feat/meeting-minutes`

## 1. 목적

팀별·일자별 회의록(.md)을 올리고, 목록에서 찾고, 브라우저에서 바로 읽고, 그 문서에 대해 챗봇에게 요약·정리·분석을 시킨다. 원본 파일은 언제든 내려받을 수 있다.

## 2. 범위

**포함**
- 회의록 업로드(파일 + 팀 + 일자 + 제목), 삭제
- 팀 탭(PMO/ERP/MES/가공) + 제목·등록자 검색
- 마크다운 바로보기(전용 URL), 원본 다운로드
- 문서 1개 전용 챗봇: 프리셋 4종(요약/결정사항/액션아이템/리스크) + 자유질문

**제외 (의도적)**
- 회의록 수정. 잘못 올렸으면 지우고 다시 올린다. 파일 교체 수정은 롤백 경로가 4갈래로 늘고 고아 객체 위험이 생기는데, 그 비용을 정당화할 만큼 자주 일어나는 일이 아니다.
- 서버측 페이지네이션·전문검색. 예상 규모가 수십~수백 건이라 클라이언트 필터로 충분하다.
- 회의 일정(`meetings`)과의 링크 UI. 컬럼(`meeting_id`)만 만들어 두고 폼·표시는 넣지 않는다.
- RAG 색인. 챗봇은 열어둔 문서 전문만 본다.
- 챗 대화 저장. 새로고침하면 사라진다.

## 3. 확정된 결정

| # | 결정 | 근거 |
|---|---|---|
| 1 | 독립 테이블 `meeting_minutes`. `meetings`와는 nullable FK만 | 회의 일정을 등록하지 않고도 회의록만 올릴 수 있어야 한다 |
| 2 | 카테고리 = `teams` FK (PMO/ERP/MES/가공) | 이미 `teams.code` 체크제약에 그 4개가 있다 (`0014_rename_dt_to_gagong.sql`) |
| 3 | 파일 이중 저장: Storage 원본 + DB `content_md` | 뷰어·검색·챗봇이 DB 텍스트를 쓰면 매 요청마다 Storage를 안 때린다. 원본은 다운로드용으로 보존 |
| 4 | 읽기=인증 전체 / 생성=PMO 전체·`team_editor`는 자기 팀만 / 삭제=작성자 또는 PMO | `meetings`(0013) RLS와 동일 구조 |
| 5 | 프로젝트 스코프 `/p/[projectId]/minutes` | 스키마가 멀티-프로젝트 전제. `announcements`/`meetings`와 같은 위치 |
| 6 | 뷰어는 `react-markdown` + `remark-gfm` | 회의록은 표(결정사항/액션아이템)를 쓴다 → GFM 테이블 필수. raw HTML 미지원이 곧 XSS 방어 |
| 7 | 챗봇은 문서 1개 전용. `generateAnswerStream`을 직접 호출 | RAG 청크 유실 없이 전문을 본다 |

## 4. 데이터 모델

### 4.1 마이그레이션 번호: `0019`

`main`의 마지막은 `0017_user_prefs.sql`이지만, 미병합 브랜치 `feat/weight-100-scale-clean`(커밋 `de23254`)이 `0018_weight_100_scale.sql`을 선점했고 아직 실행되지 않았다. `0018`을 재사용하면 병합 시 파일명이 충돌한다. → **`0019_meeting_minutes.sql`**

### 4.2 `app_team()` 헬퍼를 새로 선언한다

`0002_rls.sql:13`에 `current_team()`이 정의되어 있으나, 같은 파일 `:10`의 `create or replace function current_role()`은 PG 예약어라 실행되지 않는다. `0012_announcements.sql:47-48`이 이 드리프트를 명시한다 — 프로덕션에 실제 배포된 헬퍼는 `public.app_role()`이다. 따라서 **`current_team()`이 프로덕션에 존재하는지 알 수 없다.**

`0012`/`0013`이 확립한 방어 패턴(`app_role()`을 `create or replace`로 매번 재선언)을 그대로 따라 `app_team()`을 선언한다.

- 스칼라 보장: `0001_init.sql:21` — `memberships` PK가 `(user_id)` 단독이므로 사용자당 팀은 최대 1개. 다중행 에러 불가.
- 권한 문제 없음: `0002_rls.sql:24` `read_all_memberships ... using (true)` → invoker 권한으로 읽힌다. `app_role()`이 오늘 그렇게 동작 중이다.

`0013_meetings.sql:8`은 "새 헬퍼 함수를 만들지 않고 식을 인라인 반복"을 지시하지만, 그건 `created_by = auth.uid() or app_role() = 'pmo_admin'` 같은 **불리언 식**에 대한 것이다. `app_team()`은 `app_role()`과 동급의 "memberships 컬럼 1개당 접근자 1개"이므로 정합적이다.

### 4.3 스키마

```sql
-- supabase/migrations/0019_meeting_minutes.sql
create or replace function public.app_role() returns text language sql stable as $$
  select role from memberships where user_id = auth.uid()
$$;
create or replace function public.app_team() returns uuid language sql stable as $$
  select team_id from memberships where user_id = auth.uid()
$$;

insert into storage.buckets (id, name, public)
values ('minutes', 'minutes', false)
on conflict (id) do nothing;

drop policy if exists "minutes read"   on storage.objects;
drop policy if exists "minutes insert" on storage.objects;
drop policy if exists "minutes delete" on storage.objects;
create policy "minutes read"   on storage.objects for select to authenticated using (bucket_id = 'minutes');
create policy "minutes insert" on storage.objects for insert to authenticated with check (bucket_id = 'minutes');
create policy "minutes delete" on storage.objects for delete to authenticated using (bucket_id = 'minutes');
-- 주의: 0008 관례대로 스토리지 레벨은 "인증되면 통과"다. 경로의 팀 폴더는 정리용이며
--       보안 경계가 아니다. 팀 경계는 아래 RLS + 서버 액션이 강제한다.

create table if not exists meeting_minutes (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  team_id    uuid not null references teams(id)    on delete restrict,
  meeting_id uuid          references meetings(id) on delete set null,
  minutes_date date not null,
  title text not null,
  file_path text not null,
  file_name text not null,
  size bigint,
  mime text,
  content_md text,
  -- 목록 쿼리가 본문 컬럼을 건드리지 않고 "바로보기 가능" 여부를 알 수 있게 한다(§6.1).
  has_md boolean generated always as (content_md is not null) stored,
  created_by uuid references auth.users(id) on delete set null,
  created_by_name text,
  created_at timestamptz not null default now(),
  constraint minutes_title_len check (char_length(title) between 1 and 200),
  constraint minutes_md_only  check (content_md is null or file_path ~* '\.(md|markdown)$')
);

-- 목록 쿼리(where project_id = ? order by minutes_date desc, created_at desc)를 완전히 덮는다.
create index if not exists minutes_project_date_idx on meeting_minutes(project_id, minutes_date desc, created_at desc);
-- meeting_id 는 1단계에서 항상 NULL. 부분 인덱스라 빈 상태 비용은 0이고, 2단계에 마이그레이션이 불필요해진다.
create index if not exists minutes_meeting_idx      on meeting_minutes(meeting_id) where meeting_id is not null;
-- (project_id, team_id) 인덱스는 두지 않는다 — 팀 필터는 클라이언트의 filterMinutes()가 하고,
--  DB 에는 team_id 조건이 붙는 쿼리가 없다. 읽는 사람 없는 인덱스는 쓰기 비용일 뿐이다.

alter table meeting_minutes enable row level security;

drop policy if exists read_all_minutes on meeting_minutes;
create policy read_all_minutes on meeting_minutes for select to authenticated using (true);

drop policy if exists insert_minutes on meeting_minutes;
create policy insert_minutes on meeting_minutes for insert to authenticated
  with check (
    created_by = auth.uid()
    and (app_role() = 'pmo_admin' or (app_role() = 'team_editor' and team_id = app_team()))
  );

drop policy if exists delete_minutes on meeting_minutes;
create policy delete_minutes on meeting_minutes for delete to authenticated
  using (created_by = auth.uid() or app_role() = 'pmo_admin');

-- UPDATE 정책 없음 = 수정 금지(RLS 기본 거부). 결정: "수정 없음"(§2).
```

**설계 노트**

- `updated_at` 없음. 수정 경로가 없으니 항상 `created_at`과 같은 값이 된다. `meetings`/`announcements`가 갖고 있다는 이유만으로 죽은 컬럼을 만들지 않는다.
- `minutes_md_only` 제약이 "본문은 마크다운 파일에만 있다"는 결정 3을 DB가 강제한다. `.markdown`도 허용한다 — `isMarkdownFile()`이 받아주는 확장자와 일치시켜야 insert가 실패하지 않는다.
- `teams`는 `on delete restrict`. 팀 4개는 삭제될 일이 없지만 의도를 코드로 남긴다. (`memberships.team_id`의 `cascade`를 복사하지 말 것 — 팀 행 삭제가 회의록을 지운다.)
- `meetings`는 `on delete set null`. 회의 일정을 지워도 회의록은 남는다. `cascade`면 회의 삭제가 회의록 파일까지 유실시키고, Storage 객체는 고아로 남는다(DB cascade는 Storage를 모른다).
- `project_id`는 `cascade`. 프로젝트가 사라지면 회의록도 의미가 없다. 단 Storage 객체는 남는다 — 알려진 한계(§9).

## 5. 컴포넌트 구성

각 단위는 하나의 책임을 갖고, 인터페이스로만 대화하며, 독립적으로 이해된다.

### 5.1 신규 파일

| 경로 | 단일 책임 |
|---|---|
| `supabase/migrations/0019_meeting_minutes.sql` | 테이블·인덱스·RLS·버킷·`app_team()` |
| `src/lib/domain/minutes.ts` | **순수** — 파일 판별·경로 생성·권한 판정·검증·필터·KPI 집계 |
| `src/lib/ai/minutes-chat.ts` | **순수** — system 프롬프트 조립·컨텍스트 절단·프리셋 매핑 |
| `src/lib/data/minutes.ts` | 서버 전용 읽기 — `getProjectMinutes` / `getMinutesDetail` |
| `src/lib/data/teams.ts` | 서버 전용 읽기 — `getTeams()` (레포에 팀 목록 데이터 계층이 없다) |
| `src/app/actions/minutes.ts` | 서버 액션 — 생성·삭제·서명URL·목록 재조회 |
| `src/app/api/minutes/[id]/chat/route.ts` | 문서 전용 챗 스트리밍(`text/plain`) |
| `src/app/(app)/p/[projectId]/minutes/page.tsx` | 목록 서버 컴포넌트 |
| `src/app/(app)/p/[projectId]/minutes/loading.tsx` | 목록 스켈레톤 |
| `src/app/(app)/p/[projectId]/minutes/[minutesId]/page.tsx` | 상세 서버 컴포넌트(뷰어+챗 셸) |
| `src/app/(app)/p/[projectId]/minutes/[minutesId]/loading.tsx` | 상세 스켈레톤 |
| `src/components/minutes/MinutesView.tsx` | `'use client'` — 팀 탭·검색·목록·업로드/삭제 오케스트레이션 |
| `src/components/minutes/MinutesUploadModal.tsx` | `'use client'` — 파일 선택·메타 입력·업로드 시퀀스 |
| `src/components/minutes/MinutesReader.tsx` | `'use client'` — 뷰어/챗 2단 레이아웃. `MarkdownView`를 `next/dynamic`으로 로드 |
| `src/components/minutes/MarkdownView.tsx` | `'use client'` — `react-markdown`+`remark-gfm`을 정적 import 하는 **유일한** 파일 |
| `src/components/minutes/MinutesChatPanel.tsx` | `'use client'` — 프리셋 4개 + 자유질문, 스트림 소비 |
| `src/lib/i18n/dict/minutes.ts` | 회의록 화면 문자열(ko/en) |
| `tests/domain/minutes.test.ts` | 순수 도메인 함수 |
| `tests/ai/minutes-chat.test.ts` | 프롬프트 조립·절단·프리셋 |
| `tests/actions/minutes-gate.test.ts` | 서버 액션 권한 게이트 |

### 5.2 상세는 모달이 아니라 전용 라우트다

레포 관례는 상세 모달(`MeetingDetailModal`, `AnnouncementDetailModal`)이다. 회의록만 벗어난다.

- 회의록은 수천~수만 자다. 모달에서 스크롤하며 읽는 문서가 아니다.
- 뷰어+챗 2단 레이아웃은 모달 폭에 안 들어간다.
- 회의록은 **공유되는 대상**이다. "이 회의록 봐"라고 링크를 던질 URL이 필요하다.
- 챗 응답 스트리밍 중 모달이 닫히는 사고를 구조적으로 없앤다.

업로드는 모달을 유지한다(짧은 폼 + 목록 컨텍스트 유지).

### 5.3 수정할 기존 파일

| 경로 | 무엇을 |
|---|---|
| `src/lib/domain/types.ts` | `MeetingMinutes`, `MeetingMinutesDetail` 추가 |
| `src/components/app/Sidebar.tsx` | `projectMenu()` 배열의 `meetings` 뒤·`settings` 앞에 `minutes` 삽입 + `FileText` 아이콘 import |
| `src/components/app/HeaderChrome.tsx` | 페이지 타이틀 매핑에 `minutes: '회의록'` 추가 |
| `src/lib/i18n/dict/common.ts` | `nav.minutes` ko/en 키 |
| `src/lib/i18n/dict.ts` | `minutesKo`/`minutesEn` 스프레드 등록 |
| `package.json` | `react-markdown@^10`, `remark-gfm@^4` |

### 5.4 도메인 타입

```ts
export interface MeetingMinutes {
  id: string
  projectId: string
  teamId: string
  teamCode: TeamCode          // teams 조인. 배지 표시용
  meetingId: string | null
  minutesDate: string         // 'YYYY-MM-DD'
  title: string
  filePath: string
  fileName: string
  size: number | null
  mime: string | null
  hasMd: boolean              // content_md !== null. 바로보기/챗 가능 여부
  createdBy: string | null
  createdByName: string | null
  createdAt: string
}

export interface MeetingMinutesDetail extends MeetingMinutes {
  contentMd: string | null
}
```

`hasMd`는 DB의 `has_md` 생성 컬럼(§4.3)에서 그대로 온다. 본문 자체는 목록에 싣지 않는다.

## 6. 서버 계층

### 6.1 데이터 읽기 (`src/lib/data/minutes.ts`)

`cache()` 래핑 + 실패 시 빈 값(throw 금지)이 읽기 계층 관례다(`data/announcements.ts:11`, `data/meetings.ts:36`).

```ts
/** 목록. content_md 제외. minutes_date 내림차순. 실패 시 []. */
export const getProjectMinutes = cache(async (projectId: string): Promise<MeetingMinutes[]> => …)

/** 상세. content_md 포함. 실패/없음 시 null. */
export const getMinutesDetail = cache(async (id: string): Promise<MeetingMinutesDetail | null> => …)
```

**`select('*')`를 쓰지 않는다.** `content_md`가 목록에 섞이면 수백 건 × 수만 자가 페이지 로드마다 직렬화된다. `data/meetings.ts:41`이 `body`를 제외하는 것과 같은 이유다. (`attachments.ts:listAttachments`는 `select('*')`를 쓰지만 그 테이블엔 대용량 텍스트가 없다 — 복사하지 말 것.)

목록 select 문:
```
id, project_id, team_id, meeting_id, minutes_date, title, file_path, file_name,
size, mime, has_md, created_by, created_by_name, created_at,
teams(code)
```

"바로보기 가능"을 알려면 `content_md`의 null 여부만 있으면 되는데, PostgREST에는 컬럼을 안 읽고 그 술어만 가져올 방법이 없다. 그래서 `has_md` **생성 컬럼**(§4.3)을 둔다. 저장 비용은 1바이트고, 목록 쿼리는 본문 컬럼을 아예 건드리지 않는다.

### 6.2 서버 액션 (`src/app/actions/minutes.ts`)

관례: `'use server'` → `getMembership()` 게이트(**DB 접촉 전**) → 순수 `validate()` → `createServerClient()` → 소유권 선검증 → mutate → `revalidatePath` → `{ ok, error? }` 반환. 예외를 던지지 않는다.

```ts
export interface MinutesFile { fileName: string; filePath: string; size: number; mime: string }

export interface MinutesInput {
  teamId: string
  minutesDate: string          // 'YYYY-MM-DD'
  title: string
  contentMd: string | null     // .md만. 비-md는 null
}

export interface MinutesActionResult { ok: boolean; error?: string; id?: string }

/** 클라이언트가 Storage 업로드를 끝낸 뒤 메타 기록. attachments.recordAttachment와 동일 계약. */
export async function createMinutes(projectId: string, input: MinutesInput, file: MinutesFile): Promise<MinutesActionResult>

/** Storage 객체 제거 → 메타 삭제 (attachments.removeAttachment 순서 그대로). */
export async function deleteMinutes(id: string): Promise<MinutesActionResult>

/** 다운로드용 1시간 서명 URL. 목록에서는 부르지 않는다(§9-3). */
export async function getMinutesFileUrl(id: string): Promise<{ url: string | null }>
```

목록 재조회용 래퍼는 두지 않는다. 삭제 후 갱신은 `revalidatePath` + `router.refresh()`로 끝난다.

**`Membership`에는 `userId`가 없다** (`types.ts:7` — `{ role, teamCode, teamId }`). 삭제 권한 판정에 필요한 `auth.uid()`는 `sb.auth.getUser()`로 따로 얻는다.

```ts
function revalidateMinutes(projectId: string) {
  revalidatePath(`/p/${projectId}/minutes`)
}
```

**0행 무음 성공 방지.** RLS로 차단된 DELETE는 에러가 아니라 "0행 영향"으로 조용히 성공한다. `deleteMinutes`는 (a) 삭제 전 `select('id, file_path, created_by, project_id').eq('id', id).maybeSingle()`로 소유권을 선검증하고, (b) `.delete().eq('id', id).select('id').single()`로 0행이면 에러가 나게 한다. `meetings.ts:deleteMeeting`과 동일.

### 6.3 순수 도메인 (`src/lib/domain/minutes.ts`)

```ts
export const MINUTES_MD_MAX = 500_000      // content_md 문자 상한
export const MINUTES_FILE_MAX = 20 * 1024 * 1024   // 20MB

export function isMarkdownFile(fileName: string, mime: string): boolean
export function sanitizeFileName(name: string): string
export function minutesStoragePath(projectId: string, teamId: string, fileName: string, nowMs: number): string
export function canCreateMinutes(m: Membership | null, teamId: string): boolean
export function canDeleteMinutes(row: { createdBy: string | null }, userId: string | null, role: string | null): boolean
export function validateMinutesInput(input: MinutesInput): string | null   // null = 통과
export function filterMinutes(list: MeetingMinutes[], f: { teamId: string | null; q: string }): MeetingMinutes[]
export function summarizeMinutes(list: MeetingMinutes[], todayIso: string): { total: number; thisMonth: number; viewable: number }
```

- `sanitizeFileName`: `name.replace(/[^\w.\-가-힣]+/g, '_')` — `RowDetailPanel.tsx:324`와 **같은 정규식**. 한글 보존, 슬래시 제거. 추가로 결과가 빈 문자열이거나 점(`.`)만 남으면 `'file'`로 대체한다(경로 세그먼트가 `.`/`..`가 되는 것을 막는다).
- `minutesStoragePath`: `` `${projectId}/${teamId}/${nowMs}-${sanitizeFileName(fileName)}` ``. `nowMs` 주입으로 결정적 → 유닛테스트 가능. 타임스탬프 프리픽스가 동명 충돌을 막으므로 `upsert: false`를 유지할 수 있다.
- `canCreateMinutes`: `null → false`, `pmo_admin → true`, `team_editor → m.teamId === teamId`.
- `canDeleteMinutes`: `domain/meetings.ts:144 canEditMeeting`과 동형.
- `validateMinutesInput`: 제목 1~200자, `minutesDate`가 `YYYY-MM-DD` 정규식 **그리고 실재하는 날짜**(`2026-02-30` 반려 — `announcements.ts:isValidDate` 패턴), `contentMd` 길이 ≤ `MINUTES_MD_MAX`, `teamId` 비어있지 않음.
- `summarizeMinutes`: KPI 카드 3개 — 전체 / 이번 달 / 바로보기 가능(`hasMd`).
- `filterMinutes`: `teamId` 일치 + `q`가 `title`·`createdByName`에 대소문자 무시 부분일치. **팀 필터는 `teamId`(uuid)로 한다** — `teams.code`에 비-ASCII `'가공'`이 있어 쿼리스트링에 쓰면 인코딩 문제가 생긴다.

## 7. 챗봇

### 7.1 라우트

`POST /api/minutes/[id]/chat` · `export const dynamic = 'force-dynamic'` · Node 런타임(기본값)

문서 id를 경로 세그먼트에 두어 "문서 1개 전용"을 URL로 강제한다. 바디로 문서 id를 받지 않는다.
Next 15 규약: `{ params }: { params: Promise<{ id: string }> }` → `const { id } = await params`.

```ts
type MinutesPreset = 'summary' | 'decisions' | 'actions' | 'risks'

interface MinutesChatBody {
  message?: string       // 자유질문, ≤ 2000자
  preset?: MinutesPreset
  history?: unknown      // sanitizeHistory()로 정규화
}
```

`message`와 `preset` 중 **정확히 하나**를 요구한다. 둘 다 없거나 둘 다 있으면 400.

### 7.2 `streamAnswer()`를 쓰지 않는다

이름이 맞아 보이지만 `answer.ts:124`의 `streamAnswer`는 `classifyIntent → gatherKnowledge`를 무조건 태우고, `needsSemantic(intent)`면 `ensureProjectIndexed()`로 pgvector 색인을 자가 치유한다. 결정 7("RAG 미사용")과 어긋나고, 회의록 질문 하나가 WBS 임베딩 잡을 깨울 수 있다.

**`generateAnswerStream(system, messages)`를 직접 호출한다** (`llm.ts:149`, 반환 `Promise<AsyncGenerator<string> | null>`). 모델 폴백 체인과 429 재시도가 이미 내장되어 있다. `ReadableStream` 래핑은 `answer.ts:139~157`의 `start(controller)` 블록을 복제한다.

재사용(수정 없음): `getSession()`(auth.ts), `sanitizeHistory()`(answer.ts:175), `hasLLM()`(provider.ts:70), `generateAnswerStream()`(llm.ts:149), `getMinutesDetail()`(신규).

`createServerClient()`(세션 클라이언트)를 쓴다. `createAdminClient()`를 쓰면 훗날 읽기 정책을 좁힐 때 이 라우트만 조용히 우회한다.

### 7.3 프롬프트 (`src/lib/ai/minutes-chat.ts`, 순수)

```ts
export const MINUTES_CTX_MAX_CHARS = 60_000

export function buildMinutesSystemPrompt(
  meta: { title: string; minutesDate: string; teamCode: TeamCode; projectName: string },
  contentMd: string,
  truncated: boolean,
): string

export function presetPrompt(preset: MinutesPreset): string
// summary   → '이 회의록을 핵심 위주로 요약해 줘.'
// decisions → '이 회의에서 확정된 결정사항만 불릿으로 정리해 줘.'
// actions   → '액션 아이템을 담당자·기한과 함께 표로 정리해 줘.'
// risks     → '리스크와 이슈, 미해결 안건을 정리해 줘.'

export function truncateForContext(md: string, max = MINUTES_CTX_MAX_CHARS): { text: string; truncated: boolean }
// text = head(0.6·max) + '\n\n…(중략: 원문 N자 중 M자 생략)…\n\n' + tail(0.4·max)
```

system 프롬프트는 **문서 밖 지식 사용을 금지**한다. `truncated`면 "이 문서는 일부 생략된 발췌본이다. 생략 구간에 대한 질문에는 '원문에서 확인 필요'라고 답한다."를 덧붙인다 — 모델이 없는 내용을 지어내지 않게.

### 7.4 응답

성공: 스트림. `api/chat/stream/route.ts`의 헤더를 그대로 복제 — `Content-Type: text/plain; charset=utf-8`, `Cache-Control: no-store, no-transform`, `X-Accel-Buffering: no`.

| 조건 | 응답 |
|---|---|
| 세션 없음 | 401 `{ error: '인증이 필요합니다.' }` |
| JSON 파싱 실패 | 400 `{ error: '잘못된 요청입니다.' }` |
| `message`·`preset` 둘 다 없음/둘 다 있음 | 400 `{ error: '질문을 입력하세요.' }` / `{ error: '잘못된 요청입니다.' }` |
| `message` > 2000자 | 400 `{ error: '질문이 너무 깁니다.' }` |
| 문서 없음 / RLS 차단 | 404 `{ error: '회의록을 찾을 수 없습니다.' }` |
| `contentMd === null` | 400 `{ error: '이 회의록은 텍스트 원문이 없어 질문할 수 없습니다.' }` |
| `!hasLLM()` | **200 + 안내문 단일 청크**. RAG 없는 문서 챗은 결정형 폴백 답이 존재할 수 없으므로 안내 문장 하나만 흘린다 |
| 스트림 도중 예외 | 토큰을 이미 냈으면 `'\n\n⚠ 답변이 도중에 끊겼어요. 다시 시도해 주세요.'`를 덧붙이고 close. 0개면 안내문으로 대체 |

"UX가 절대 끊기지 않는다"는 `answer.ts:17` 주석의 원칙을 따른다 — LLM 키가 없다고 5xx를 던지지 않는다.

### 7.5 클라이언트

`MinutesChatPanel.tsx`는 `DkBot.tsx:144~157`의 스트림 소비 패턴(`fetch` → `res.body.getReader()` → `TextDecoder`)을 복제한다. 엔드포인트만 `/api/minutes/${id}/chat`.

## 8. 데이터 흐름

### 8.1 업로드

`RowDetailPanel.tsx:318~340`의 `onFile()`이 레포 유일의 Storage 업로드 구현이며 "Storage 먼저 → 서버 액션 메타 기록 → 실패 시 객체 정리" 보상 트랜잭션을 확립했다. 그대로 확장한다.

```
0) 사전 검증 (클라이언트, 순수 함수)
   file 존재 · size ≤ MINUTES_FILE_MAX · title/minutesDate/teamId 채워짐
   canCreateMinutes(membership, teamId)로 업로드 버튼 자체를 비활성화
   ↓ 실패 → setErr, 중단. Storage 접촉 없음.

1) .md 판별 + 텍스트 추출  (Storage 접촉 전)
   const isMd = isMarkdownFile(file.name, file.type)
   const contentMd = isMd ? await file.text() : null
   contentMd.length > MINUTES_MD_MAX → setErr, 중단
   ↓ 여기서 실패하면 아직 아무것도 안 만들어졌다 = 롤백 불필요

2) 경로 생성 (순수)
   const path = minutesStoragePath(projectId, teamId, file.name, Date.now())

3) Storage 업로드
   const sb = createBrowserClient()
   const up = await sb.storage.from('minutes').upload(path, file, { upsert: false })
   if (up.error) → setErr, 중단.  ※ 롤백 대상 없음(객체 미생성)

4) 메타 기록
   const res = await createMinutes(projectId, { teamId, minutesDate, title, contentMd },
                                   { fileName: file.name, filePath: path,
                                     size: file.size, mime: file.type || 'application/octet-stream' })

5) 실패 롤백
   if (!res.ok) { await sb.storage.from('minutes').remove([path]); setErr(res.error); return }

6) 성공
   onClose(); router.refresh()
```

`router.refresh()`와 서버 액션의 `revalidatePath`는 **둘 다** 필요하다 — 전자는 현재 트리를, 후자는 RSC 캐시를 갱신한다(`RowDetailPanel.tsx:336`).

### 8.2 삭제

`deleteMinutes(id)` 서버 액션이 Storage 객체를 먼저 지우고(`remove([file_path])`) 그다음 행을 지운다 — `attachments.ts:removeAttachment`의 순서 그대로. 객체가 먼저 사라지고 행 삭제가 실패하면 "깨진 링크 행"이 남지만, 반대 순서는 "영구 고아 객체"를 남긴다. 레포는 전자를 택했고 유지한다.

브라우저 `confirm()`을 쓰지 않는다(`Modal.tsx:10` 주석). 확인 모달을 띄운다.

### 8.3 다운로드

목록에서는 서명 URL을 만들지 않는다. 다운로드 클릭 시 `getMinutesFileUrl(id)`로 단건 발급한다.

`attachments.ts:34`의 `listAttachments`는 행마다 `createSignedUrl`을 순차 `await`한다(첨부가 적다는 가정). 회의록 목록에서 같은 짓을 하면 100건 = 100 라운드트립이다. **그 패턴을 복사하지 않는다.**

### 8.4 바로보기

`/p/[projectId]/minutes/[minutesId]/page.tsx`(서버) → `getMinutesDetail(id)` → `contentMd`를 `MinutesReader`(클라이언트)에 prop으로 전달. `MinutesReader`가 `MarkdownView`를 `next/dynamic`으로 로드하고, 우측에 `MinutesChatPanel`을 붙인다. `contentMd === null`이면 뷰어 자리에 "이 파일은 바로보기를 지원하지 않습니다. 다운로드해 주세요."를 띄우고 챗 패널을 렌더하지 않는다.

`react-markdown`/`remark-gfm`은 **`MarkdownView.tsx`에서만** 정적 import 한다. `react-markdown`을 직접 `dynamic()`하면 `remarkPlugins={[remarkGfm]}`를 넘길 방법이 없어 `remark-gfm`이 공유 청크로 새어 들어간다.

`rehype-raw`를 넣지 않는다. 회의록은 사용자 업로드 콘텐츠다. raw HTML 허용 = 저장형 XSS. 링크 안전성은 `react-markdown`의 `urlTransform` 기본값(위험 스킴 차단)에 의존한다.

## 9. 에러 처리와 알려진 한계

1. **서버 액션은 던지지 않는다.** `{ ok, error? }`로 보고한다. 읽기 계층은 실패 시 빈 값(`[]`/`null`)을 준다.
2. **고아 Storage 객체.** 5단계 롤백 `remove()`는 브라우저에서 실행된다. 그 사이 탭을 닫거나 네트워크가 끊기면 객체가 영구히 남는다. 레포에 정리 크론이 없다. 대안(행 먼저 insert → 업로드 → confirm)은 레포 관례를 벗어나므로 **채택하지 않고 한계로 문서화한다.** 프로젝트 삭제 시 cascade도 Storage를 지우지 않는다(같은 한계).
3. **Storage 정책은 팀 경계를 강제하지 않는다.** `bucket_id = 'minutes'`만 검사하므로(0008 관례), `team_editor`가 콘솔에서 다른 팀 경로로 `upload()`를 직접 호출하면 객체는 올라간다. 막히는 건 그다음 `createMinutes`의 메타 기록뿐이다. 실제 방어선은 (a) 서버 액션 `canCreateMinutes`, (b) RLS `insert_minutes` 두 겹이다. **경로의 팀 폴더는 조직화 목적이지 보안 경계가 아니다** — 마이그레이션과 `minutesStoragePath` 주석에 명시한다.
4. **i18n 키 패리티가 타입으로 강제된다.** `dict.ts:52` `export type DictKey = keyof (typeof DICT)['ko']`, 각 네임스페이스 파일은 `en`을 `Record<keyof ko, string>`으로 강제한다. `dict/minutes.ts`의 ko/en 키가 완전히 일치해야 컴파일된다.

## 10. 테스트

레포 원칙: `tests/domain/*`는 DB·React·네트워크 없는 순수 함수만. `tests/actions/accounts-gate.test.ts`만 예외적으로 `vi.mock`으로 auth/supabase/next-cache를 막고 게이트 로직만 검증한다. `vitest.config.ts` → `environment: 'node'`.

### `tests/domain/minutes.test.ts`

| 함수 | 관점 |
|---|---|
| `isMarkdownFile` | `.md`/`.MD`/`.markdown`, `text/markdown`, `a.md.pdf` → false, 확장자 없음 |
| `sanitizeFileName` | 한글 보존, 공백·슬래시 → `_`, `..`만 남는 입력 → `'file'`, 빈 결과 방지 |
| `minutesStoragePath` | `nowMs` 주입 시 결정적 출력, 세그먼트 3개 구조 |
| `canCreateMinutes` | `null`→false, `pmo_admin`→항상 true, `team_editor`→teamId 일치할 때만 |
| `canDeleteMinutes` | `userId`/`createdBy` null 엣지, pmo_admin 우회 |
| `validateMinutesInput` | 제목 공백·201자, `2026-02-30` 반려, `contentMd` 초과, `teamId` 빈 문자열 |
| `filterMinutes` | 팀 필터 + 제목/등록자 대소문자 무시 부분일치, 정렬 안정성 |
| `summarizeMinutes` | 월 경계, 빈 목록, `hasMd` 집계 |

### `tests/ai/minutes-chat.test.ts`

| 함수 | 관점 |
|---|---|
| `truncateForContext` | 미초과 시 원문 그대로 + `truncated:false`; 초과 시 길이 ≤ max + 마커 포함 + head/tail 보존; `max` 경계값 |
| `buildMinutesSystemPrompt` | 메타 4개가 문자열에 포함, `truncated`면 발췌본 문장 포함, 문서 밖 지식 금지 규칙 포함 |
| `presetPrompt` | 4종 모두 서로 다른 비어있지 않은 문자열, 타입 exhaustive |

### `tests/actions/minutes-gate.test.ts`

`accounts-gate.test.ts` 구조를 복제한다. `getMembership() === null`이면 모든 액션이 `{ ok:false }`이고 `createServerClient`가 **호출되지 않음**을 검증. `team_editor` + 남의 `teamId` → `createMinutes`가 `{ ok:false, error:'담당 팀이 아닙니다.' }`.

### 테스트하지 않는 것

`MarkdownView.tsx`(node 환경 + ESM 조합), `src/lib/data/minutes.ts`(Supabase 의존, 레포에 데이터 계층 테스트 0건), 스트림 라우트 자체(`tests/ai/sse.test.ts`가 `drainSse` 순수 함수만 테스트하는 선례).

## 11. 검증이 필요한 가정

배포 전 실측할 것 — 스펙이 근거 없이 정한 값들이다.

- `MINUTES_CTX_MAX_CHARS = 60_000`이 Gemini 요청에서 안전한가. `llm.ts:65`는 `maxOutputTokens: 4096`만 고정하고 입력 상한은 어디에도 없다. `util.ts`의 `withTimeout(fn, 25_000)` 25초가 사실상의 제약이다.
- `MINUTES_MD_MAX = 500_000`, `MINUTES_FILE_MAX = 20MB` — 레포 선례 없는 신규 값(`announcements`/`meetings`의 `BODY_MAX = 20000`을 문서 크기에 맞게 확대).
- `next/dynamic` + ESM-only `react-markdown`이 이 레포의 Turbopack 빌드를 무설정으로 통과하는가. **레포에 `next/dynamic` 사용 선례가 0건이고 `transpilePackages` 미설정이다.** 첫 빌드에서 확인한다.
- 마이그레이션 롤백 파일이 필수 관례인가 (`0018`만 보유, `0001~0017`은 없음).
