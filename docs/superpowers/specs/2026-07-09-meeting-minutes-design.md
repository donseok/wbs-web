# 회의록 보관함 (Meeting Minutes) 설계

- 작성일: 2026-07-09
- 상태: 사용자 승인 완료 (섹션별 승인)
- 범위: 전역 회의록 보관함 — .md 업로드, 일자×담당 정리, 자체 md 뷰어, LLM 자연어 질의

## 1. 개요

일자별·담당별(PMO/ERP/MES/가공)로 회의록(.md 파일)과 첨부 파일을 저장하는 **전역 보관함**을 만든다.
앱은 보관·조회·질의 전용이며 본문 편집 에디터는 없다. 자체 마크다운 뷰어를 제공하고,
열려 있는 문서에 대한 LLM 질의(문서 모드)와 전체 회의록 횡단 검색 질의(보관함 모드)를 지원한다.

### 확정된 요구사항 (사용자 결정 로그)

| 결정 항목 | 결정 내용 |
|-----------|-----------|
| 기존 회의일정과의 관계 | 독립 보관함 + 선택적 연결 (`minutes.meeting_id` nullable FK) |
| 본문 입력 방식 | **.md 파일 업로드 전용** — 앱 내 텍스트 에디터 없음 |
| 수정 경계 | 새 .md 재업로드로 본문 교체 허용, 메타(일자·담당·제목·회의 연결) 수정 허용, 첨부 개별 추가/삭제 허용 |
| 메뉴 범위 | **전역 메뉴** (`/minutes`) — 프로젝트와 무관 |
| LLM 질의 범위 | 열려 있는 문서 + 전체 횡단 검색 **둘 다** |
| 목록 화면 | 일자별 그룹 리스트 + 월 달력 그리드 **둘 다** (토글 전환, 기본 리스트) |
| 뷰어 | 전용 페이지 `/minutes/[id]` + 우측 채팅 패널 |
| 접근안 | A안 — 하우스 패턴 조립형 (본문을 DB에도 저장) |

## 2. 아키텍처 개요

기존에 프로덕션에서 검증된 세 패턴을 조립한다:

1. **파일 첨부** — `0008_attachments.sql`의 deliverables 패턴: 비공개 Storage 버킷 + 메타 테이블,
   클라이언트 직접 업로드 → 서버 액션 메타 기록, 서명 URL(3600초) 다운로드, 실패 시 보상 삭제.
2. **회의 CRUD** — `0013_meetings.sql`의 소유권 패턴: 생성은 멤버 전원, 수정/삭제는 본인 또는 `pmo_admin`,
   서버 액션 + `getMembership()` 이중 검증, RLS는 `app_role()` 헬퍼.
3. **RAG Q&A** — DK Bot(`src/lib/ai/*`)의 pgvector(768차원) + 무료 Gemini 체인(429 3중 방어) + 정직한 폴백.

핵심 설계 결정: **업로드된 .md의 텍스트를 DB 컬럼(`minutes.body_md`)에 저장**한다.
원본 파일은 Storage에 보관(다운로드 무결성)하고, DB 본문이 뷰어 렌더·키워드 검색·임베딩 인제스트의 원천이다.
뷰어를 열 때마다 서명 URL 왕복이 없고, 횡단 검색·키워드 정확 일치가 SQL로 가능해진다.

임베딩은 DK Bot의 `wbs_embeddings`를 확장하지 않고 **별도 테이블**을 쓴다. 이유:
(a) `wbs_embeddings`는 WBS 재임포트 시 프로젝트 단위 전체 삭제+재삽입이라 회의록 임베딩이 소실될 위험,
(b) `project_id NOT NULL`이라 전역 회의록과 구조 불일치,
(c) `kind` CHECK 제약 변경 마이그레이션 불필요.

## 3. 데이터 모델 — 마이그레이션 `supabase/migrations/0020_minutes.sql`

멱등 SQL(`if not exists` / `drop policy if exists`)로 작성. 프로덕션 적용은 Supabase Management API
`POST /v1/projects/rglfgrwwwwdqejohdnty/database/query` (기존 레시피, `supabase db push` 금지).
RLS 헬퍼는 반드시 `app_role()` 사용 (`current_role()` 금지 — 프로덕션 드리프트 문서화됨).

### 3.1 `minutes` — 회의록 본체

| 컬럼 | 타입 | 제약 |
|------|------|------|
| `id` | uuid | PK, `gen_random_uuid()` |
| `minute_date` | date | NOT NULL |
| `team_code` | text | NOT NULL, CHECK IN (`'PMO'`,`'ERP'`,`'MES'`,`'가공'`) — 기존 `teams.code`·`TeamCode` 타입과 동일 값 |
| `title` | text | NOT NULL, 1~200자 (서버 검증) |
| `body_md` | text | NOT NULL DEFAULT `''`, 최대 **100,000자** (서버 검증 상수 `MINUTE_BODY_MAX`) |
| `meeting_id` | uuid | NULL, FK → `meetings(id)` ON DELETE SET NULL (선택적 연결) |
| `created_by` | uuid | FK → `auth.users` ON DELETE SET NULL |
| `created_by_name` | text | 표시용 스냅샷 (기존 meetings 패턴) |
| `created_at` / `updated_at` | timestamptz | DEFAULT now() |

- 같은 (일자, 담당)에 여러 건 허용 — unique 제약 없음.
- 인덱스: `(minute_date desc)`, `(team_code, minute_date desc)`.

RLS (0013 패턴 그대로):
- SELECT: `authenticated` 전원 `using (true)`
- INSERT: `with check (created_by = auth.uid() and app_role() is not null)`
- UPDATE/DELETE: `using (created_by = auth.uid() or app_role() = 'pmo_admin')`

### 3.2 `minute_files` — 원본 .md + 기타 첨부 메타

| 컬럼 | 타입 | 제약 |
|------|------|------|
| `id` | uuid | PK |
| `minute_id` | uuid | NOT NULL, FK → `minutes` ON DELETE CASCADE |
| `role` | text | NOT NULL, CHECK IN (`'body'`,`'attachment'`) |
| `file_name` | text | NOT NULL (원본 파일명) |
| `file_path` | text | NOT NULL (Storage 경로) |
| `size` | bigint | NOT NULL |
| `mime` | text | NOT NULL |
| `uploaded_by` | uuid | FK → `auth.users` ON DELETE SET NULL |
| `created_at` | timestamptz | DEFAULT now() |

- `role='body'`는 회의록당 1개: 부분 unique 인덱스 `unique (minute_id) where role = 'body'`.
- RLS: SELECT는 authenticated 전원; INSERT/UPDATE/DELETE는 부모 `minutes` 행 소유권을 EXISTS로 미러
  (0013의 `meeting_attendees` 패턴).

### 3.3 Storage 버킷 `minutes`

- `insert into storage.buckets (id, name, public) values ('minutes','minutes',false) on conflict do nothing`
- `storage.objects` 정책: `bucket_id = 'minutes'` 스코프로 authenticated INSERT/SELECT/DELETE (0008 패턴 미러).
- 객체 경로: `{minuteId}/{Date.now()}-{safeName}` — 파일명 sanitize는 기존 정규식 `[^\w.\-가-힣]→_` 재사용.
- 다운로드는 항상 서버에서 `createSignedUrl(path, 3600)` 재발급. 공개 URL 금지.

### 3.4 `minute_embeddings` — 횡단 검색용 벡터

| 컬럼 | 타입 | 제약 |
|------|------|------|
| `id` | uuid | PK |
| `minute_id` | uuid | NOT NULL, FK → `minutes` ON DELETE CASCADE |
| `chunk_index` | int | NOT NULL |
| `content` | text | NOT NULL (청크 원문) |
| `embedding` | vector(768) | NOT NULL — `EMBED_DIM`·gemini-embedding-001과 일치 |
| `updated_at` | timestamptz | DEFAULT now() |

- 인덱스: HNSW `vector_cosine_ops` (0010 패턴), `(minute_id)`.
- RLS: SELECT `authenticated using (true)` (사용자 세션 검색 경로 보장), 쓰기 정책 없음 — service_role 전용.

### 3.5 RPC `match_minute_documents`

```sql
match_minute_documents(
  query_embedding vector(768),
  match_count int default 8,
  p_team text default null,        -- 담당 필터
  p_date_from date default null,   -- 기간 필터
  p_date_to date default null
) returns (minute_id uuid, chunk_index int, content text,
           minute_date date, team_code text, title text, similarity float)
```

- `similarity = 1 - (embedding <=> query_embedding)`, 유사도 필터는 앱 측(기존 `DKBOT_MIN_SIMILARITY=0.35` 상수 재사용).
- `minutes` 조인으로 일자·담당·제목을 함께 반환해 출처 표시에 사용.

## 4. 업로드 흐름 · 수정 정책

### 4.1 업로드 모달 (`MinuteUploadModal`)

1. 일자 — 기본값 오늘 (Asia/Seoul, 기존 `seoulToday()` 관례)
2. 담당 — PMO/ERP/MES/가공 `SegmentedTabs` (팀 컬러 토큰)
3. 제목 — .md 파일명(확장자 제외)에서 자동 채움, 수정 가능
4. 본문 .md 파일 — 필수 1개, **1MB 이하**, 확장자 `.md`/`.markdown`
5. 기타 첨부 — 선택, 최대 10개, 각 20MB 이하, 타입 제한 없음
6. 회의 연결(선택) — 프로젝트 선택 → 해당 프로젝트 회의 목록에서 선택 (생략 가능)

### 4.2 처리 순서 (`src/app/actions/minutes.ts`)

1. 클라이언트: FileReader로 .md 텍스트 추출 → `createMinute({date, team, title, bodyMd, meetingId?})` 호출
   - 서버 검증: `getMembership()`+`getSession()` 게이트, 날짜 형식(`YYYY-MM-DD`), 담당 enum,
     제목 1~200자, `bodyMd ≤ 100,000자`, meetingId 존재 확인 → `minutes` INSERT
2. 클라이언트: 원본 .md + 첨부들을 `createBrowserClient().storage.from('minutes').upload(path, file)` 직접 업로드
   → 각 파일마다 `recordMinuteFile(minuteId, role, meta)` 호출
   - 메타 기록 실패 시 업로드된 Storage 객체 삭제 (보상 처리, `RowDetailPanel.tsx:327` 패턴)
3. 서버(액션 내부): 본문 청크 분할 → 임베딩 생성 → `minute_embeddings` INSERT (service_role)
   - **임베딩 실패는 업로드 성공에 영향 없음** — 로그만 남기고 진행 (질의 시점 self-heal)

### 4.3 청크 분할 (`src/lib/ai/chunk.ts` 신규)

- 마크다운 헤딩(`#`~`######`) 경계 우선, 넘치면 문단 경계로 분할. 청크당 **최대 1,500자**
  (임베딩 입력 한계 `MAX_EMBED_CHARS=8000` 대비 여유, 검색 정밀도 우선). 오버랩 없음.
- 100,000자 본문 기준 최대 ~67청크 — 기존 `embedDocuments()` 동시성 5로 처리 가능.

### 4.4 수정·삭제

- **본문 교체** `replaceMinuteBody`: 새 .md 업로드 → 기존 `role='body'` 파일 Storage 삭제 + 메타 교체 +
  `body_md` 갱신 + 해당 회의록 임베딩 delete-and-reinsert. 버전 이력은 보관하지 않음(비범위).
- **메타 수정** `updateMinuteMeta`: 일자·담당·제목·회의 연결 변경. 일자/담당 변경 시 임베딩 재생성 불필요
  (본문 불변; RPC가 minutes 조인으로 최신 메타 반환).
- **첨부 추가/삭제** `recordMinuteFile` / `removeMinuteFile`: 개별 처리. 삭제는 Storage 객체 → 메타 행 순.
- **회의록 삭제** `deleteMinute`: 소유권 사전 확인(본인 or pmo_admin) → Storage 객체 전부 삭제 →
  `minutes` DELETE (files·embeddings는 CASCADE).
- 모든 액션은 `{ ok, error? }` 반환 + `revalidatePath` (하우스 패턴).

## 5. UI

### 5.1 내비게이션·라우트

- 전역 사이드바에 **회의록** 메뉴 추가 (`/minutes`, 기존 '회의일정' 전역 항목 인근, lucide 아이콘).
- 라우트: `/minutes` (보관함), `/minutes/[id]` (뷰어). 서버 컴포넌트 페이지 +
  `'use client'` 뷰 컴포넌트 구성 (기존 meetings 페이지 패턴).
- i18n: `src/lib/i18n/dict/minutes.ts` 신규 (ko/en 키 패리티 `Record<keyof ko, string>`), `dict.ts`에 병합.
  네비 라벨 `nav.minutes` = '회의록' / 'Minutes'.

### 5.2 보관함 `/minutes` (`MinutesView`)

- PageHero + KPI 카드: 이번 달 건수, 담당별 건수(4팀).
- 필터 바: 담당 `SegmentedTabs`(전체/PMO/ERP/MES/가공) + 월 이동(◀ 2026-07 ▶) + 검색 입력 + **[리스트|달력] 토글**.
- **리스트 뷰(기본)**: 일자별 그룹(최신 우선), 항목 = 담당 배지(팀 컬러) · 제목 · 첨부 수 · 작성자. 클릭 → 뷰어.
- **달력 뷰**: 월 그리드(기존 `MeetingCalendar` 구조 참고, 회의록용 신규 컴포넌트 `MinutesCalendar`),
  셀에 팀 컬러 도트/카운트 칩 표시. 날짜 클릭 → 그리드 아래에 해당 일자 목록 패널 표시.
- 토글 상태는 `queueUiPref({minutesView: 'list'|'calendar'})`로 사용자 설정 동기화 (0017 `user_preferences` JSONB).
- 데이터: 기본 = 선택 월 범위 조회(`body_md` 제외한 목록 필드만). 검색어 입력 시 = 전 기간
  `title`/`body_md` ILIKE, 최대 100건, 일자 그룹으로 표시.
- 우측 하단(또는 필터 바)에 **"회의록에 질문"** 버튼 → 보관함 모드 채팅 패널(슬라이드 오버).

### 5.3 뷰어 `/minutes/[id]` (`MinuteViewer` + `MinuteChatPanel`)

```
┌────────────────────────────────────────────────┐
│ ← 목록  2026-07-09 · ●ERP · 주간 정례회의       │
│         [원본 .md ⬇] [첨부 n ⬇] [연결된 회의 ↗] │
├──────────────────────────┬─────────────────────┤
│  (md 본문 렌더)           │ 💬 이 회의록에 질문   │
│                          │  … 대화 …           │
│                          │ [입력________] [▶]  │
└──────────────────────────┴─────────────────────┘
```

- 상단 메타: 일자·담당 배지·제목·작성자, 원본/첨부 다운로드(서명 URL은 클릭 시 서버 액션으로 발급),
  연결된 회의가 있으면 해당 프로젝트 회의일정으로 링크. 소유자/pmo_admin에게는 메타 수정·본문 교체·삭제 메뉴.
- 본문: `body_md`를 `react-markdown` + `remark-gfm`으로 렌더 (표·체크리스트·취소선 지원).
  - **raw HTML 비활성** (rehype-raw 미사용 — react-markdown 기본값, XSS 원천 차단).
  - 외부 링크는 `target="_blank" rel="noopener noreferrer"`.
  - 스타일: `globals.css`에 토큰 기반 md 타이포 스타일 정의 (`.minutes-md` 스코프) — 다크 모드 자동.
- 우측 채팅 패널: 토글로 접기/펼치기. 좁은 화면에서는 본문 아래로 스택.

### 5.4 신규 의존성

- `react-markdown` + `remark-gfm` — React 19 호환 버전. 이 2개 외 추가 의존성 없음
  (코드 하이라이트 shiki 등은 비범위 — 코드블록은 `<pre>` 기본 스타일).

## 6. LLM 질의 — `/api/minutes/chat`

단일 엔드포인트, 두 모드. 요청:

```ts
POST /api/minutes/chat
{ mode: 'doc' | 'archive',
  minuteId?: string,                       // doc 모드 필수
  message: string,                          // ≤ 2,000자
  history?: {role, content}[],              // 최근 8턴, 각 ≤ 4,000자 (기존 sanitize 재사용)
  filters?: { team?: TeamCode, from?: string, to?: string } }  // archive 모드
```

- 응답: text/plain 스트리밍 (기존 `/api/chat/stream` 방식 — `X-Accel-Buffering: no`, `force-dynamic`).
- 인증: `getSession()` 게이트. 회의록 조회는 사용자 세션 클라이언트(RLS 적용).

### 6.1 doc 모드 (뷰어 채팅)

- 해당 회의록 `body_md` **전문**을 시스템 프롬프트의 `[회의록]` 블록으로 주입 (임베딩 불필요).
  본문 캡이 100,000자이므로 컨텍스트 초과 없음 (Gemini Flash 컨텍스트 대비 충분).
- 시스템 프롬프트: 한국어, 회의록 도메인 지시(요약·결정사항·액션아이템·참석자 추출 등),
  "문서에 없는 내용은 모른다고 답하라" 규칙 (기존 DK Bot SYSTEM 스타일).

### 6.2 archive 모드 (보관함 채팅)

1. 질문 임베딩(`embedTexts`, RETRIEVAL_QUERY) → `match_minute_documents(k=8, 필터)` — 현재 담당 탭·기간 필터 전달
2. 보조 경로: 질문에서 키워드 추출(기존 `extractSearchKeywords` 재사용) → `minutes.title`/`body_md` ILIKE
   정확 일치 → `[키워드 정확 일치]` 블록 (DK Bot의 "X 들어간 항목" 패턴)
3. 컨텍스트 블록: `[회의록: 2026-07-08 · ERP · 인터페이스 협의] …청크…` 형태로 라벨링
4. 답변 끝에 근거 회의록 출처 목록(일자·담당·제목 + `/minutes/[id]` 링크) — 스트림 종료 후 별도 JSON 라인이 아닌,
   본문 마지막에 텍스트로 부기하고 클라이언트가 링크 렌더

### 6.3 LLM 호출·폴백 (기존 계약 그대로)

- `src/lib/ai/llm.ts`의 `generateAnswerStream` 재사용: Gemini 무료 체인
  (gemini-3.5-flash → fallback 모델들), 429 3중 방어 (Retry-After ≤6초 대기 → 모델 체인 → 폴백).
- LLM 전면 실패/키 없음 시 **정직한 폴백**: doc 모드 = "AI 응답 불가" 안내 + 문서 내 키워드 일치 줄 발췌,
  archive 모드 = 검색된 회의록 목록만이라도 제공 + DEGRADED 안내. **API는 절대 500을 내지 않음.**
- 전역 DK Bot(`wbs_embeddings`, `/api/chat/*`)은 일절 수정하지 않는다.

### 6.4 임베딩 self-heal

- archive 질의 시 `minute_embeddings`가 비어 있는 회의록이 있으면(간단히: 전체 임베딩 0건 && minutes 존재)
  백그라운드 인제스트 시도 — 기존 `ensure-index.ts` 패턴(진행 중 dedupe + 60초 쿨다운, 절대 throw 안 함).

## 7. 에러 처리 요약

| 상황 | 처리 |
|------|------|
| Storage 업로드 성공 후 메타 기록 실패 | 클라이언트가 업로드 객체 삭제 (보상) |
| 임베딩 생성 실패 | 업로드는 성공 처리, 질의 시 self-heal |
| LLM 429/장애 | Retry-After 대기 → 모델 체인 → 정직한 폴백 (500 금지) |
| 서명 URL 만료 | 다운로드 클릭 시마다 서버 액션으로 재발급 |
| RLS 0행 업데이트 (권한 없음) | 서버 액션에서 소유권 사전 SELECT 후 명시적 에러 반환 (하우스 패턴) |
| 잘못된 파일 (.md 아님 / 크기 초과) | 클라이언트 사전 검증 + 서버 액션 재검증, 명확한 에러 메시지 |

## 8. 테스트 · 검증

- vitest 단위 테스트: 청크 분할기(헤딩/문단 경계·최대 길이·빈 문서), 서버 액션 입력 검증
  (날짜 형식·담당 enum·제목/본문 캡), 파일명 sanitize.
- 검증 관례: `npm run build` / `npm run lint` / `vitest` + curl (브라우저로 dev 서버 접근 불가 환경).
- RPC·RLS는 마이그레이션 SQL 리뷰 + 프로덕션 적용 후 curl 스모크 테스트.

## 9. 배포 순서

1. `0020_minutes.sql` 프로덕션 적용 (Management API 레시피) — **코드 배포보다 먼저** (0019 헤더 규칙)
2. 의존성 추가(`react-markdown`, `remark-gfm`) + 코드 배포 (main 푸시 → Vercel)
3. 스모크: 업로드 → 뷰어 렌더 → doc 질의 → archive 질의 → 다운로드

## 10. 비범위 (Out of Scope)

- 앱 내 md 텍스트 에디터 (사용자 명시 결정)
- 본문 교체 시 버전 이력 보관
- 코드 하이라이트(shiki 등)·수식 렌더
- 회의록 알림/구독, 팀별 비공개 권한 (읽기는 로그인 사용자 전원)
- DK Bot 전역 위젯과의 통합 (회의록 질의는 전용 패널로만)
- 회의일정 → 회의록 자동 생성

## 11. 구현 파일 맵 (신규/수정)

| 파일 | 신규/수정 | 내용 |
|------|-----------|------|
| `supabase/migrations/0020_minutes.sql` | 신규 | 테이블 3종 + 버킷 + RPC + RLS |
| `src/app/actions/minutes.ts` | 신규 | createMinute / updateMinuteMeta / replaceMinuteBody / recordMinuteFile / removeMinuteFile / deleteMinute / fetchMinuteDetail / getMinuteFileUrl |
| `src/lib/data/minutes.ts` | 신규 | getMinutesPage(월·담당·검색) / getMinuteDetail / KPI 집계 |
| `src/lib/domain/types.ts` | 수정 | Minute / MinuteFile 타입 (TeamCode 재사용) |
| `src/lib/ai/chunk.ts` | 신규 | 마크다운 청크 분할기 |
| `src/lib/ai/minutes-ingest.ts` | 신규 | 청크→임베딩→minute_embeddings (service_role) + self-heal |
| `src/lib/ai/minutes-answer.ts` | 신규 | doc/archive 프롬프트 조립 + 폴백 (llm.ts·embeddings.ts 재사용) |
| `src/app/api/minutes/chat/route.ts` | 신규 | 스트리밍 Q&A 엔드포인트 |
| `src/app/(app)/minutes/page.tsx` | 신규 | 보관함 서버 페이지 |
| `src/app/(app)/minutes/[id]/page.tsx` | 신규 | 뷰어 서버 페이지 |
| `src/components/minutes/*` | 신규 | MinutesView / MinutesCalendar / MinuteUploadModal / MinuteViewer / MinuteChatPanel / ArchiveChatPanel |
| `src/components/app/Sidebar.tsx` | 수정 | 전역 '회의록' 메뉴 |
| `src/lib/i18n/dict/minutes.ts` + `dict.ts` | 신규/수정 | ko/en 문자열 |
| `src/app/globals.css` | 수정 | `.minutes-md` 마크다운 타이포 스타일 (토큰 기반) |
| `package.json` | 수정 | react-markdown, remark-gfm |
