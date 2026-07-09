# 회의록 보관함 (Meeting Minutes) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 전역 회의록 보관함 — .md 업로드 전용, 일자×담당(PMO/ERP/MES/가공) 정리, react-markdown 뷰어, 문서/보관함 2모드 LLM 질의.

**Architecture:** 기존 3패턴 조립 — (1) deliverables 첨부 패턴(비공개 버킷+메타 테이블+클라 직접 업로드), (2) meetings 소유권 패턴(서버 액션+RLS `app_role()`), (3) DK Bot RAG 패턴(pgvector 768 + 무료 Gemini 체인). 본문 md 텍스트는 DB 컬럼 `minutes.body_md`가 원천, 원본 파일은 Storage 보관.

**Tech Stack:** Next.js 15.5 App Router, React 19, Supabase (@supabase/ssr), Tailwind v4 토큰, react-markdown + remark-gfm (신규), vitest.

**Spec:** `docs/superpowers/specs/2026-07-09-meeting-minutes-design.md` — 이 계획의 진실 원천. 충돌 시 스펙 우선.

## Global Constraints

- 마이그레이션 번호는 **0021** (`0020`은 progress_snapshots가 선점). 멱등 SQL(drop policy if exists / if not exists). 프로덕션 적용은 Supabase Management API `POST /v1/projects/rglfgrwwwwdqejohdnty/database/query` — `supabase db push` 금지.
- RLS는 `app_role()` 인라인식만 사용. **`current_role()` 절대 금지** (프로덕션 드리프트).
- 담당 enum은 정확히 `'PMO' | 'ERP' | 'MES' | '가공'` (types.ts:2 `TeamCode` 재사용). '가공'의 색 토큰은 `team-dt` (globals.css 주석 참고).
- 서버 검증 상수: 제목 1~200자, `body_md` ≤ **100,000자** (`MINUTE_BODY_MAX`), 본문 파일 1MB 안전망, 첨부 각 20MB·최대 10개.
- 모든 UI 문자열은 i18n dict(ko/en 패리티) 경유. 디자인은 토큰 유틸(bg-surface, text-ink, border-line…)만 — hex 하드코딩 금지.
- AI는 무료 Gemini 체인만(`src/lib/ai/llm.ts` 재사용), 임베딩 768차원 고정, **AI 실패로 500 금지**. DK Bot 기존 파일(`answer.ts`, `retrieve.ts`, `ingest.ts`, `/api/chat/*`)은 수정 금지.
- 날짜는 Asia/Seoul `YYYY-MM-DD` 문자열 (`seoulToday()` 관례).
- 커밋은 파일 명시(`git add <경로>`) — **`git add -A` 절대 금지** (병렬 세션).
- 검증은 `npm run build` / `npm run lint` / `npm test` + curl (브라우저로 dev 서버 접근 불가).

## File Structure

| 파일 | 역할 |
|------|------|
| `supabase/migrations/0021_minutes.sql` | minutes/minute_files/minute_embeddings + 버킷 + RPC + RLS |
| `src/lib/domain/types.ts` (수정) | Minute/MinuteFile 타입, UiPrefs.minutesView |
| `src/lib/domain/minutes.ts` (신규) | 검증 상수·validateMinuteInput·sanitizeFileName·isMinuteFilePathValid (순수 함수, vitest 대상) |
| `src/lib/data/minutes.ts` (신규) | getMinutesPage / searchMinutes / getMinuteDetail (cache()+RLS 읽기) |
| `src/app/actions/minutes.ts` (신규) | createMinute 등 8개 액션 (게이트+검증+보상) |
| `src/lib/ai/chunk.ts` (신규) | chunkMarkdown (Phase 2) |
| `src/lib/ai/minutes-ingest.ts` (신규) | ingestMinute + healMissingMinuteEmbeddings (Phase 2) |
| `src/lib/ai/minutes-answer.ts` (신규) | streamDocAnswer / streamArchiveAnswer (Phase 2) |
| `src/app/api/minutes/chat/route.ts` (신규) | 스트리밍 Q&A (Phase 2) |
| `src/app/(app)/minutes/page.tsx` + `[id]/page.tsx` (신규) | 서버 페이지 2개 |
| `src/components/minutes/*` (신규) | MinutesView / MinutesCalendar / MinuteUploadModal / MinuteViewer / MarkdownView / MinuteMetaModal / MinuteChatPanel / ArchiveChatPanel |
| `src/components/app/Sidebar.tsx` (수정) | 전역 '회의록' 메뉴 |
| `src/lib/i18n/dict/minutes.ts` (신규) + `dict.ts` (수정) | ko/en 문자열 |
| `src/app/globals.css` (수정) | `.minutes-md` 스타일 |
| `tests/minutes/*.test.ts` (신규) | 검증·청크 단위 테스트 |

---

# Phase 1 — 업로드 · 보관함 · 뷰어

### Task 1: 마이그레이션 `0021_minutes.sql`

**Files:**
- Create: `supabase/migrations/0021_minutes.sql`

**Interfaces:**
- Produces: 테이블 `minutes`(snake_case 컬럼: minute_date/team_code/title/body_md/meeting_id/created_by/created_by_name), `minute_files`(minute_id/role/file_name/file_path/size/mime/uploaded_by), `minute_embeddings`, 버킷 `minutes`, RPC `match_minute_documents(query_embedding, match_count, p_team, p_date_from, p_date_to)`.

- [ ] **Step 1: 다음 빈 번호 재확인**

Run: `ls supabase/migrations/ | tail -4`
Expected: `0020_progress_snapshots.sql`이 마지막, `0021_*` 없음. (있으면 0022로 개번하고 이 계획·스펙의 번호 참조를 모두 갱신.)

- [ ] **Step 2: 마이그레이션 파일 작성**

`supabase/migrations/0021_minutes.sql` 전체 내용:

```sql
-- 회의록 보관함 (전역) — .md 업로드 전용, 일자×담당(PMO/ERP/MES/가공) 정리 + pgvector 질의.
-- 권한: 읽기 = 인증 사용자 전체 / 생성 = 멤버십 보유자 본인 / 수정·삭제 = 작성자 또는 pmo_admin (0013 패턴).
-- 멱등: SQL Editor 반복 실행 안전(if not exists / drop policy if exists).
-- 적용: Supabase Management API — POST /v1/projects/<ref>/database/query (0013과 동일 경로).
--       .env.local 의 SUPABASE_DB_URL 은 비어 있으므로 pg 직결/db push 는 사용하지 않는다.
-- 적용 순서: 이 마이그레이션을 **먼저** 적용한 뒤 코드를 배포한다.
-- 주의: 레포 0002/0004 의 current_role() 은 PG 예약어 드리프트 — 프로덕션 헬퍼는 public.app_role().

create extension if not exists vector;

-- ── 회의록 본체 ──
create table if not exists minutes (
  id uuid primary key default gen_random_uuid(),
  minute_date date not null,
  team_code text not null check (team_code in ('PMO','ERP','MES','가공')),
  title text not null,
  body_md text not null default '',
  meeting_id uuid references meetings(id) on delete set null,
  created_by uuid references auth.users(id) on delete set null,
  created_by_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists minutes_date_idx on minutes (minute_date desc);
create index if not exists minutes_team_date_idx on minutes (team_code, minute_date desc);

-- ── 원본 .md + 첨부 메타 ──
create table if not exists minute_files (
  id uuid primary key default gen_random_uuid(),
  minute_id uuid not null references minutes(id) on delete cascade,
  role text not null check (role in ('body','attachment')),
  file_name text not null,
  file_path text not null,
  size bigint not null,
  mime text not null,
  uploaded_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists minute_files_minute_idx on minute_files (minute_id);
create unique index if not exists minute_files_one_body_idx on minute_files (minute_id) where role = 'body';

-- ── 횡단 검색용 벡터 (wbs_embeddings 와 분리 — WBS 재색인의 delete+reinsert 에 휩쓸리지 않게) ──
create table if not exists minute_embeddings (
  id uuid primary key default gen_random_uuid(),
  minute_id uuid not null references minutes(id) on delete cascade,
  chunk_index int not null,
  content text not null,
  embedding vector(768) not null,
  updated_at timestamptz not null default now()
);
create index if not exists minute_embeddings_minute_idx on minute_embeddings (minute_id);
create index if not exists minute_embeddings_vec_idx
  on minute_embeddings using hnsw (embedding vector_cosine_ops);

-- ── Storage 버킷 (비공개, 20MB 실물 강제) ──
insert into storage.buckets (id, name, public, file_size_limit)
values ('minutes', 'minutes', false, 20971520)
on conflict (id) do nothing;

drop policy if exists "minutes bucket read" on storage.objects;
create policy "minutes bucket read" on storage.objects for select to authenticated
  using (bucket_id = 'minutes');
drop policy if exists "minutes bucket insert" on storage.objects;
create policy "minutes bucket insert" on storage.objects for insert to authenticated
  with check (bucket_id = 'minutes');
drop policy if exists "minutes bucket delete" on storage.objects;
create policy "minutes bucket delete" on storage.objects for delete to authenticated
  using (bucket_id = 'minutes');

-- ── RLS ──
alter table minutes           enable row level security;
alter table minute_files      enable row level security;
alter table minute_embeddings enable row level security;

drop policy if exists read_all_minutes on minutes;
create policy read_all_minutes on minutes for select to authenticated using (true);

drop policy if exists insert_own_minutes on minutes;
create policy insert_own_minutes on minutes
  for insert to authenticated
  with check (created_by = auth.uid() and app_role() is not null);

drop policy if exists update_own_minutes on minutes;
create policy update_own_minutes on minutes
  for update to authenticated
  using (created_by = auth.uid() or app_role() = 'pmo_admin')
  with check (created_by = auth.uid() or app_role() = 'pmo_admin');

drop policy if exists delete_own_minutes on minutes;
create policy delete_own_minutes on minutes
  for delete to authenticated
  using (created_by = auth.uid() or app_role() = 'pmo_admin');

drop policy if exists read_all_minute_files on minute_files;
create policy read_all_minute_files on minute_files for select to authenticated using (true);

drop policy if exists own_write_minute_files on minute_files;
create policy own_write_minute_files on minute_files
  for all to authenticated
  using (exists (select 1 from minutes mi where mi.id = minute_id
                 and (mi.created_by = auth.uid() or app_role() = 'pmo_admin')))
  with check (exists (select 1 from minutes mi where mi.id = minute_id
                 and (mi.created_by = auth.uid() or app_role() = 'pmo_admin')));

-- 임베딩: 읽기만 인증 사용자, 쓰기 정책 없음(service_role 이 RLS 우회로 수행).
drop policy if exists minute_embeddings_read on minute_embeddings;
create policy minute_embeddings_read on minute_embeddings
  for select to authenticated using (true);

-- ── 매치 RPC (0010 match_wbs_documents 미러 + 담당/기간 필터, minutes 조인) ──
create or replace function public.match_minute_documents(
  query_embedding vector(768),
  match_count     int default 8,
  p_team          text default null,
  p_date_from     date default null,
  p_date_to       date default null
) returns table (
  minute_id   uuid,
  chunk_index int,
  content     text,
  minute_date date,
  team_code   text,
  title       text,
  similarity  float
)
language sql stable
as $$
  select
    e.minute_id, e.chunk_index, e.content,
    m.minute_date, m.team_code, m.title,
    1 - (e.embedding <=> query_embedding) as similarity
  from public.minute_embeddings e
  join public.minutes m on m.id = e.minute_id
  where (p_team is null or m.team_code = p_team)
    and (p_date_from is null or m.minute_date >= p_date_from)
    and (p_date_to   is null or m.minute_date <= p_date_to)
  order by e.embedding <=> query_embedding
  limit greatest(match_count, 1)
$$;
```

- [ ] **Step 3: 멱등성 육안 점검**

모든 `create table`/`create index`에 `if not exists`, 모든 policy에 `drop policy if exists` 선행, 버킷 insert에 `on conflict do nothing`, 함수는 `create or replace`인지 확인.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/0021_minutes.sql
git commit -m "feat(db): 회의록 보관함 스키마 — minutes/minute_files/minute_embeddings + 버킷 + match RPC (0021)"
```

### Task 2: 도메인 타입 + 검증 헬퍼 (TDD)

**Files:**
- Modify: `src/lib/domain/types.ts` (UiPrefs 인터페이스 끝 + 파일 하단에 Minute 블록 추가)
- Create: `src/lib/domain/minutes.ts`
- Test: `tests/minutes/validate.test.ts`

**Interfaces:**
- Consumes: `TeamCode` (types.ts:2)
- Produces: `Minute`, `MinuteFile`, `MinuteInput`, `UiPrefs.minutesView`, 상수 `MINUTE_TITLE_MAX=200`/`MINUTE_BODY_MAX=100000`/`MINUTE_BODY_FILE_MAX=1048576`/`MINUTE_ATTACHMENT_MAX=20971520`/`MINUTE_ATTACHMENTS_MAX_COUNT=10`, `TEAM_CODES: TeamCode[]`, `validateMinuteInput(input: MinuteInput): string | null`, `sanitizeFileName(name: string): string`, `isMinuteFilePathValid(minuteId: string, path: string): boolean`

- [ ] **Step 1: 실패하는 테스트 작성** — `tests/minutes/validate.test.ts`

```ts
import { describe, it, expect } from 'vitest'
import {
  validateMinuteInput, sanitizeFileName, isMinuteFilePathValid,
  MINUTE_BODY_MAX, type MinuteInput,
} from '@/lib/domain/minutes'

const base: MinuteInput = {
  minuteDate: '2026-07-09', teamCode: 'ERP', title: '주간 정례회의',
  bodyMd: '# 안건\n- 진행 현황', meetingId: null,
}

describe('validateMinuteInput', () => {
  it('정상 입력은 null', () => expect(validateMinuteInput(base)).toBeNull())
  it('제목 없음', () => expect(validateMinuteInput({ ...base, title: '  ' })).toMatch(/제목/))
  it('제목 200자 초과', () =>
    expect(validateMinuteInput({ ...base, title: 'a'.repeat(201) })).toMatch(/200/))
  it('날짜 형식 오류', () =>
    expect(validateMinuteInput({ ...base, minuteDate: '2026/07/09' })).toMatch(/날짜/))
  it('잘못된 담당', () =>
    expect(validateMinuteInput({ ...base, teamCode: 'QA' as never })).toMatch(/담당/))
  it('본문 캡 초과', () =>
    expect(validateMinuteInput({ ...base, bodyMd: 'a'.repeat(MINUTE_BODY_MAX + 1) })).toMatch(/100,000/))
  it('빈 본문 허용', () => expect(validateMinuteInput({ ...base, bodyMd: '' })).toBeNull())
})

describe('sanitizeFileName', () => {
  it('허용 외 문자 → _', () => expect(sanitizeFileName('주간 회의(7월).md')).toBe('주간_회의_7월_.md'))
  it('한글/영숫자/._- 보존', () => expect(sanitizeFileName('minutes-7.9_초안.md')).toBe('minutes-7.9_초안.md'))
})

describe('isMinuteFilePathValid', () => {
  const id = '11111111-2222-3333-4444-555555555555'
  it('자기 접두 경로 허용', () => expect(isMinuteFilePathValid(id, `${id}/123-a.md`)).toBe(true))
  it('타 회의록 경로 거부', () =>
    expect(isMinuteFilePathValid(id, '99999999-2222-3333-4444-555555555555/123-a.md')).toBe(false))
  it('경로 순회 거부', () => expect(isMinuteFilePathValid(id, `${id}/../etc/x`)).toBe(false))
})
```

- [ ] **Step 2: 실패 확인**

Run: `npm test -- tests/minutes/validate.test.ts`
Expected: FAIL — `Cannot find module '@/lib/domain/minutes'`

- [ ] **Step 3: types.ts 수정 + domain/minutes.ts 구현**

`src/lib/domain/types.ts` — UiPrefs에 한 줄 추가:

```ts
export interface UiPrefs {
  heroCollapsed?: boolean
  sidebarCollapsed?: boolean
  theme?: 'light' | 'dark'
  locale?: 'ko' | 'en'
  dashSections?: string[]   // 대시보드 상세 아코디언에서 펼쳐 둔 그룹 id
  minutesView?: 'list' | 'calendar'   // 회의록 보관함 뷰 토글
}
```

`src/lib/domain/types.ts` — 파일 하단(Meeting 블록 뒤)에 추가:

```ts
/* ── 회의록 (minutes) ── */
export interface Minute {
  id: string
  minuteDate: string           // 'YYYY-MM-DD'
  teamCode: TeamCode
  title: string
  bodyMd: string               // 목록 조회에선 ''
  meetingId: string | null
  createdBy: string | null
  createdByName: string | null
  createdAt: string
  updatedAt: string
  fileCount?: number           // 목록 뷰 전용(첨부 수, 서버 계산)
}

export interface MinuteFile {
  id: string
  minuteId: string
  role: 'body' | 'attachment'
  fileName: string
  filePath: string
  size: number | null
  mime: string | null
  createdAt: string
  url?: string | null          // 서명 URL(요청 시 발급)
}
```

`src/lib/domain/minutes.ts` 전체:

```ts
import type { TeamCode } from './types'

export const MINUTE_TITLE_MAX = 200
export const MINUTE_BODY_MAX = 100_000          // body_md 실효 한도(자)
export const MINUTE_BODY_FILE_MAX = 1_048_576   // 원시 .md 파일 안전망(1MB)
export const MINUTE_ATTACHMENT_MAX = 20_971_520 // 첨부 개당 20MB(버킷 file_size_limit와 일치)
export const MINUTE_ATTACHMENTS_MAX_COUNT = 10

export const TEAM_CODES: TeamCode[] = ['PMO', 'ERP', 'MES', '가공']

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

export interface MinuteInput {
  minuteDate: string     // 'YYYY-MM-DD'
  teamCode: TeamCode
  title: string
  bodyMd: string
  meetingId: string | null
}

/** 회의록 입력 검증 — 에러 메시지 또는 null. create/updateMeta/replaceBody 가 공유. */
export function validateMinuteInput(input: MinuteInput): string | null {
  const title = input.title.trim()
  if (!title) return '제목을 입력하세요.'
  if (title.length > MINUTE_TITLE_MAX) return `제목은 ${MINUTE_TITLE_MAX}자 이하여야 합니다.`
  if (!DATE_RE.test(input.minuteDate)) return '날짜 형식이 올바르지 않습니다.'
  if (!TEAM_CODES.includes(input.teamCode)) return '잘못된 담당입니다.'
  if (input.bodyMd.length > MINUTE_BODY_MAX) return '본문은 100,000자 이하여야 합니다.'
  return null
}

/** 파일명 sanitize — RowDetailPanel 업로드 흐름과 동일 규칙. */
export function sanitizeFileName(name: string): string {
  return name.replace(/[^\w.\-가-힣]+/g, '_')
}

/** Storage 경로가 해당 회의록 전용 접두({minuteId}/)인지 — 타 객체를 가리키는 메타 기록 차단. */
export function isMinuteFilePathValid(minuteId: string, path: string): boolean {
  return path.startsWith(`${minuteId}/`) && !path.includes('..')
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npm test -- tests/minutes/validate.test.ts`
Expected: PASS (11 tests)

- [ ] **Step 5: Commit**

```bash
git add src/lib/domain/types.ts src/lib/domain/minutes.ts tests/minutes/validate.test.ts
git commit -m "feat(minutes): 도메인 타입·검증 헬퍼 + 단위 테스트"
```

### Task 3: i18n 사전 + 사이드바 전역 메뉴

**Files:**
- Create: `src/lib/i18n/dict/minutes.ts`
- Modify: `src/lib/i18n/dict.ts` (import + ko/en spread 각 1줄)
- Modify: `src/components/app/Sidebar.tsx` (전역 '내 회의' Link 아래에 회의록 Link)

**Interfaces:**
- Produces: DictKey `nav.minutes` 및 `min.*` 키 전체 (아래 코드가 유일 원천 — 이후 태스크의 컴포넌트가 이 키들을 사용)

- [ ] **Step 1: 사전 파일 작성** — `src/lib/i18n/dict/minutes.ts` 전체:

```ts
export const minutesKo = {
  'nav.minutes': '회의록',
  'min.heroTitle': '회의록',
  'min.heroDesc': '일자·담당별 회의록(.md)을 보관하고 검색합니다.',
  'min.kpi.month': '이달 회의록',
  'min.kpi.monthSub': '선택 월 기준',
  'min.upload': '회의록 업로드',
  'min.team.all': '전체',
  'min.view.list': '리스트',
  'min.view.calendar': '달력',
  'min.search.placeholder': '제목·본문 검색',
  'min.search.truncated': '최근 100건만 표시합니다.',
  'min.empty.title': '회의록이 없습니다',
  'min.empty.desc': '.md 파일을 업로드해 보관함을 시작하세요.',
  'min.form.date': '일자',
  'min.form.team': '담당',
  'min.form.title': '제목',
  'min.form.bodyFile': '본문 (.md)',
  'min.form.attachments': '첨부 파일 (선택)',
  'min.form.meeting': '회의 연결 (선택)',
  'min.form.meetingNone': '연결 안 함',
  'min.form.project': '프로젝트',
  'min.form.save': '업로드',
  'min.form.saving': '업로드 중…',
  'min.err.bodyRequired': '본문 .md 파일을 선택하세요.',
  'min.err.bodyExt': '.md 또는 .markdown 파일만 가능합니다.',
  'min.err.bodyFileMax': '본문 파일은 1MB 이하여야 합니다.',
  'min.err.bodyMax': '본문이 100,000자를 넘습니다. 파일을 나눠 업로드하세요.',
  'min.err.attachMax': '첨부는 개당 20MB 이하여야 합니다.',
  'min.err.attachCount': '첨부는 최대 10개까지입니다.',
  'min.err.upload': '파일 업로드에 실패했습니다.',
  'min.err.record': '파일 기록에 실패했습니다.',
  'min.detail.download': '원본 .md',
  'min.detail.attachments': '첨부',
  'min.detail.linkedMeeting': '연결된 회의',
  'min.detail.noBodyFile': '원본 파일이 없습니다. 본문을 재업로드하세요.',
  'min.detail.edit': '메타 수정',
  'min.detail.replaceBody': '본문 교체',
  'min.detail.delete': '삭제',
  'min.detail.deleteConfirm': '이 회의록과 모든 첨부가 삭제됩니다. 계속할까요?',
  'min.detail.back': '목록',
  'min.chat.doc.title': '이 회의록에 질문',
  'min.chat.archive.title': '회의록에 질문',
  'min.chat.placeholder': '예: 결정사항만 요약해줘',
  'min.chat.send': '보내기',
  'min.chat.empty': '응답이 비어 있어요. 다시 시도해 주세요.',
  'min.chat.error': '응답 생성에 실패했어요. 잠시 후 다시 시도해 주세요.',
  'min.meta.save': '저장',
  'min.meta.title': '회의록 메타 수정',
}

export const minutesEn: Record<keyof typeof minutesKo, string> = {
  'nav.minutes': 'Minutes',
  'min.heroTitle': 'Minutes',
  'min.heroDesc': 'Archive and search meeting minutes (.md) by date and team.',
  'min.kpi.month': 'This month',
  'min.kpi.monthSub': 'selected month',
  'min.upload': 'Upload minutes',
  'min.team.all': 'All',
  'min.view.list': 'List',
  'min.view.calendar': 'Calendar',
  'min.search.placeholder': 'Search title/body',
  'min.search.truncated': 'Showing latest 100 only.',
  'min.empty.title': 'No minutes yet',
  'min.empty.desc': 'Upload a .md file to start the archive.',
  'min.form.date': 'Date',
  'min.form.team': 'Team',
  'min.form.title': 'Title',
  'min.form.bodyFile': 'Body (.md)',
  'min.form.attachments': 'Attachments (optional)',
  'min.form.meeting': 'Link meeting (optional)',
  'min.form.meetingNone': 'No link',
  'min.form.project': 'Project',
  'min.form.save': 'Upload',
  'min.form.saving': 'Uploading…',
  'min.err.bodyRequired': 'Select a body .md file.',
  'min.err.bodyExt': 'Only .md or .markdown files are allowed.',
  'min.err.bodyFileMax': 'Body file must be 1MB or less.',
  'min.err.bodyMax': 'Body exceeds 100,000 characters. Split the file.',
  'min.err.attachMax': 'Each attachment must be 20MB or less.',
  'min.err.attachCount': 'Up to 10 attachments.',
  'min.err.upload': 'File upload failed.',
  'min.err.record': 'Failed to record file.',
  'min.detail.download': 'Original .md',
  'min.detail.attachments': 'Attachments',
  'min.detail.linkedMeeting': 'Linked meeting',
  'min.detail.noBodyFile': 'Original file missing. Re-upload the body.',
  'min.detail.edit': 'Edit meta',
  'min.detail.replaceBody': 'Replace body',
  'min.detail.delete': 'Delete',
  'min.detail.deleteConfirm': 'This deletes the minutes and all attachments. Continue?',
  'min.detail.back': 'Back',
  'min.chat.doc.title': 'Ask this document',
  'min.chat.archive.title': 'Ask the minutes',
  'min.chat.placeholder': 'e.g. Summarize only the decisions',
  'min.chat.send': 'Send',
  'min.chat.empty': 'Empty response. Please retry.',
  'min.chat.error': 'Failed to generate a response. Try again shortly.',
  'min.meta.save': 'Save',
  'min.meta.title': 'Edit minutes meta',
}
```

- [ ] **Step 2: dict.ts에 병합** — `src/lib/i18n/dict.ts`의 기존 import 목록에 `import { minutesKo, minutesEn } from './dict/minutes'` 추가, ko 스프레드 블록에 `...minutesKo,`, en 블록에 `...minutesEn,` 추가.

- [ ] **Step 3: 사이드바 수정** — `src/components/app/Sidebar.tsx`: lucide import에 `NotebookText` 추가. `{/* 전역: 내 회의 */}` Link 블록 바로 아래에:

```tsx
      {/* 전역: 회의록 */}
      <Link href="/minutes" title={t('nav.minutes')}
        className={`side-link ${pathname.startsWith('/minutes') ? 'side-link-active' : ''} ${collapsed ? 'justify-center px-0' : ''}`}>
        <NotebookText className="h-[18px] w-[18px] shrink-0" />
        {!collapsed && <span className="flex-1">{t('nav.minutes')}</span>}
      </Link>
```

- [ ] **Step 4: 빌드 확인** — Run: `npm run build` / Expected: 성공. (라우트 /minutes는 아직 없어도 Link는 빌드에 문제 없음.)

- [ ] **Step 5: Commit**

```bash
git add src/lib/i18n/dict/minutes.ts src/lib/i18n/dict.ts src/components/app/Sidebar.tsx
git commit -m "feat(minutes): i18n 사전 + 사이드바 전역 메뉴"
```

### Task 4: 데이터 레이어 `src/lib/data/minutes.ts`

**Files:**
- Create: `src/lib/data/minutes.ts`

**Interfaces:**
- Consumes: `Minute`, `MinuteFile`, `TeamCode` (types.ts), `createServerClient`
- Produces: `getMinutesPage(rangeStart: string, rangeEnd: string, team: TeamCode | null): Promise<Minute[]>`, `searchMinutes(q: string, team: TeamCode | null, limit?: number): Promise<Minute[]>`, `getMinuteDetail(id: string): Promise<{ minute: Minute; files: MinuteFile[] } | null>`, `mapMinute(r: Row): Minute` (내부)

- [ ] **Step 1: 파일 작성** — `src/lib/data/minutes.ts` 전체:

```ts
import { cache } from 'react'
import { createServerClient } from '@/lib/supabase/server'
import type { Minute, MinuteFile, TeamCode } from '@/lib/domain/types'

type Row = Record<string, unknown>

const LIST_COLS =
  'id, minute_date, team_code, title, meeting_id, created_by, created_by_name, created_at, updated_at, minute_files(count)'

function mapMinute(r: Row, bodyMd = ''): Minute {
  const files = r.minute_files as { count: number }[] | undefined
  return {
    id: r.id as string,
    minuteDate: r.minute_date as string,
    teamCode: r.team_code as TeamCode,
    title: r.title as string,
    bodyMd,
    meetingId: (r.meeting_id as string | null) ?? null,
    createdBy: (r.created_by as string | null) ?? null,
    createdByName: (r.created_by_name as string | null) ?? null,
    createdAt: r.created_at as string,
    updatedAt: r.updated_at as string,
    fileCount: files?.[0]?.count ?? 0,
  }
}

/** 기간(달력 그리드) + 담당 필터 목록. body_md 제외. 실패 시 빈 배열. */
export const getMinutesPage = cache(async (
  rangeStart: string, rangeEnd: string, team: TeamCode | null,
): Promise<Minute[]> => {
  const sb = await createServerClient()
  let q = sb.from('minutes').select(LIST_COLS)
    .gte('minute_date', rangeStart).lte('minute_date', rangeEnd)
    .order('minute_date', { ascending: false }).order('created_at', { ascending: false })
  if (team) q = q.eq('team_code', team)
  const { data } = await q
  return (data ?? []).map((r: Row) => mapMinute(r))
})

/** 전 기간 제목/본문 ILIKE 검색 — minute_date desc, 최대 limit건. */
export const searchMinutes = cache(async (
  qtext: string, team: TeamCode | null, limit = 100,
): Promise<Minute[]> => {
  const needle = qtext.trim()
  if (!needle) return []
  const sb = await createServerClient()
  const esc = needle.replace(/[%_]/g, m => `\\${m}`)
  let q = sb.from('minutes').select(LIST_COLS)
    .or(`title.ilike.%${esc}%,body_md.ilike.%${esc}%`)
    .order('minute_date', { ascending: false }).limit(limit)
  if (team) q = q.eq('team_code', team)
  const { data } = await q
  return (data ?? []).map((r: Row) => mapMinute(r))
})

/** 뷰어 상세 — body_md + 파일 목록(서명 URL 없이 메타만). 없으면 null. */
export const getMinuteDetail = cache(async (
  id: string,
): Promise<{ minute: Minute; files: MinuteFile[] } | null> => {
  const sb = await createServerClient()
  const { data: r } = await sb.from('minutes')
    .select('id, minute_date, team_code, title, body_md, meeting_id, created_by, created_by_name, created_at, updated_at')
    .eq('id', id).maybeSingle()
  if (!r) return null
  const { data: fs } = await sb.from('minute_files')
    .select('id, minute_id, role, file_name, file_path, size, mime, created_at')
    .eq('minute_id', id).order('created_at', { ascending: true })
  const files: MinuteFile[] = (fs ?? []).map((f: Row) => ({
    id: f.id as string,
    minuteId: f.minute_id as string,
    role: f.role as 'body' | 'attachment',
    fileName: f.file_name as string,
    filePath: f.file_path as string,
    size: (f.size as number) ?? null,
    mime: (f.mime as string) ?? null,
    createdAt: f.created_at as string,
  }))
  return { minute: mapMinute(r as Row, (r as Row).body_md as string), files }
})
```

- [ ] **Step 2: 빌드 확인** — Run: `npm run build` / Expected: 성공

- [ ] **Step 3: Commit**

```bash
git add src/lib/data/minutes.ts
git commit -m "feat(minutes): 데이터 레이어 — 목록/검색/상세"
```

### Task 5: 서버 액션 `src/app/actions/minutes.ts`

**Files:**
- Create: `src/app/actions/minutes.ts`

**Interfaces:**
- Consumes: `validateMinuteInput`/`isMinuteFilePathValid`/상수 (domain/minutes.ts), `getMinuteDetail` (data/minutes.ts), `getMembership`/`getSession`, `displayNameFrom` (`@/lib/domain/display-name`), `getProjectMeetingData` (data/meetings.ts)
- Produces (모두 export): `MinuteActionResult { ok: boolean; error?: string; id?: string }`, `createMinute(input: MinuteInput)`, `updateMinuteMeta(id: string, patch: Omit<MinuteInput,'bodyMd'>)`, `replaceMinuteBody(id, bodyMd: string, file: {fileName,filePath,size,mime})`, `recordMinuteFile(minuteId, file: {role:'body'|'attachment',fileName,filePath,size,mime})`, `removeMinuteFile(fileId: string)`, `deleteMinute(id: string)`, `fetchMinuteDetail(id)`, `getMinuteFileUrl(fileId): Promise<{ok,url?,error?}>`, `fetchProjectMeetingsLite(projectId): Promise<{id,title,meetingDate}[]>`
- **Phase 2 연결점:** createMinute/replaceMinuteBody의 `// [P2] after(() => ingestMinute(...))` 주석 위치에 Task 13에서 인제스트가 배선됨.

- [ ] **Step 1: 파일 작성** — `src/app/actions/minutes.ts` 전체:

```ts
'use server'
import { revalidatePath } from 'next/cache'
import { createServerClient } from '@/lib/supabase/server'
import { getMembership, getSession } from '@/lib/auth'
import { displayNameFrom } from '@/lib/domain/display-name'
import { validateMinuteInput, isMinuteFilePathValid, type MinuteInput } from '@/lib/domain/minutes'
import { getMinuteDetail } from '@/lib/data/minutes'
import { getProjectMeetingData } from '@/lib/data/meetings'
import type { MinuteFile } from '@/lib/domain/types'

const BUCKET = 'minutes'

export interface MinuteActionResult { ok: boolean; error?: string; id?: string }

type Sb = Awaited<ReturnType<typeof createServerClient>>

/** 소유권 사전 확인 — RLS 0행 침묵 실패 방지. 반환: 에러 메시지 또는 null. */
async function checkOwner(sb: Sb, minuteId: string, userId: string, role: string): Promise<string | null> {
  const { data } = await sb.from('minutes').select('created_by').eq('id', minuteId).maybeSingle()
  if (!data) return '회의록을 찾을 수 없습니다.'
  if ((data.created_by as string | null) !== userId && role !== 'pmo_admin') return '권한 없음'
  return null
}

export async function createMinute(input: MinuteInput): Promise<MinuteActionResult> {
  const m = await getMembership()
  if (!m) return { ok: false, error: '로그인 필요' }
  const user = await getSession()
  if (!user) return { ok: false, error: '로그인 필요' }
  const err = validateMinuteInput(input)
  if (err) return { ok: false, error: err }
  const sb = await createServerClient()
  if (input.meetingId) {
    const { data: mt } = await sb.from('meetings').select('id').eq('id', input.meetingId).maybeSingle()
    if (!mt) return { ok: false, error: '연결할 회의를 찾을 수 없습니다.' }
  }
  const { data, error } = await sb.from('minutes').insert({
    minute_date: input.minuteDate, team_code: input.teamCode, title: input.title.trim(),
    body_md: input.bodyMd, meeting_id: input.meetingId,
    created_by: user.id, created_by_name: displayNameFrom(user.user_metadata, user.email),
  }).select('id').single()
  if (error) return { ok: false, error: error.message }
  // [P2] after(() => ingestMinute(data.id as string, input.bodyMd)) — Task 13에서 배선
  revalidatePath('/minutes')
  return { ok: true, id: data.id as string }
}

export async function updateMinuteMeta(
  id: string, patch: Omit<MinuteInput, 'bodyMd'>,
): Promise<MinuteActionResult> {
  const m = await getMembership()
  if (!m) return { ok: false, error: '로그인 필요' }
  const user = await getSession()
  if (!user) return { ok: false, error: '로그인 필요' }
  const err = validateMinuteInput({ ...patch, bodyMd: '' })
  if (err) return { ok: false, error: err }
  const sb = await createServerClient()
  const own = await checkOwner(sb, id, user.id, m.role)
  if (own) return { ok: false, error: own }
  if (patch.meetingId) {
    const { data: mt } = await sb.from('meetings').select('id').eq('id', patch.meetingId).maybeSingle()
    if (!mt) return { ok: false, error: '연결할 회의를 찾을 수 없습니다.' }
  }
  const { error } = await sb.from('minutes').update({
    minute_date: patch.minuteDate, team_code: patch.teamCode, title: patch.title.trim(),
    meeting_id: patch.meetingId, updated_at: new Date().toISOString(),
  }).eq('id', id)
  if (error) return { ok: false, error: error.message }
  revalidatePath('/minutes'); revalidatePath(`/minutes/${id}`)
  return { ok: true }
}

/** 본문 교체 — 클라이언트가 새 .md 를 Storage 업로드한 뒤 호출. 기존 body 파일 0건 허용(복구 경로). */
export async function replaceMinuteBody(
  id: string, bodyMd: string,
  file: { fileName: string; filePath: string; size: number; mime: string },
): Promise<MinuteActionResult> {
  const m = await getMembership()
  if (!m) return { ok: false, error: '로그인 필요' }
  const user = await getSession()
  if (!user) return { ok: false, error: '로그인 필요' }
  if (bodyMd.length > 100_000) return { ok: false, error: '본문은 100,000자 이하여야 합니다.' }
  if (!isMinuteFilePathValid(id, file.filePath)) return { ok: false, error: '잘못된 파일 경로입니다.' }
  if (!/\.(md|markdown)$/i.test(file.fileName)) return { ok: false, error: '.md 파일만 가능합니다.' }
  const sb = await createServerClient()
  const own = await checkOwner(sb, id, user.id, m.role)
  if (own) return { ok: false, error: own }
  // 기존 body 파일 경로는 DB에서 해석(클라이언트 신뢰 안 함) — 소유권 확인 후에만 Storage 삭제
  const { data: old } = await sb.from('minute_files')
    .select('id, file_path').eq('minute_id', id).eq('role', 'body').maybeSingle()
  if (old) {
    await sb.storage.from(BUCKET).remove([old.file_path as string])
    await sb.from('minute_files').delete().eq('id', old.id as string)
  }
  const { error: insErr } = await sb.from('minute_files').insert({
    minute_id: id, role: 'body', file_name: file.fileName, file_path: file.filePath,
    size: file.size, mime: file.mime, uploaded_by: user.id,
  })
  if (insErr) return { ok: false, error: insErr.message }
  const { error } = await sb.from('minutes')
    .update({ body_md: bodyMd, updated_at: new Date().toISOString() }).eq('id', id)
  if (error) return { ok: false, error: error.message }
  // [P2] after(() => ingestMinute(id, bodyMd)) — Task 13에서 배선
  revalidatePath('/minutes'); revalidatePath(`/minutes/${id}`)
  return { ok: true }
}

/** 클라이언트 Storage 업로드 후 메타 기록. file_path 는 {minuteId}/ 접두 강제. */
export async function recordMinuteFile(
  minuteId: string,
  file: { role: 'body' | 'attachment'; fileName: string; filePath: string; size: number; mime: string },
): Promise<MinuteActionResult> {
  const m = await getMembership()
  if (!m) return { ok: false, error: '로그인 필요' }
  const user = await getSession()
  if (!user) return { ok: false, error: '로그인 필요' }
  if (!isMinuteFilePathValid(minuteId, file.filePath)) return { ok: false, error: '잘못된 파일 경로입니다.' }
  if (file.role === 'body' && !/\.(md|markdown)$/i.test(file.fileName))
    return { ok: false, error: '.md 파일만 가능합니다.' }
  const sb = await createServerClient()
  const own = await checkOwner(sb, minuteId, user.id, m.role)
  if (own) return { ok: false, error: own }
  const { error } = await sb.from('minute_files').insert({
    minute_id: minuteId, role: file.role, file_name: file.fileName, file_path: file.filePath,
    size: file.size, mime: file.mime, uploaded_by: user.id,
  })
  if (error) return { ok: false, error: error.message }
  revalidatePath(`/minutes/${minuteId}`)
  return { ok: true }
}

/** 첨부 삭제(role='attachment' 전용 — body 는 replaceMinuteBody 로만). 경로는 DB 해석. */
export async function removeMinuteFile(fileId: string): Promise<MinuteActionResult> {
  const m = await getMembership()
  if (!m) return { ok: false, error: '로그인 필요' }
  const user = await getSession()
  if (!user) return { ok: false, error: '로그인 필요' }
  const sb = await createServerClient()
  const { data: f } = await sb.from('minute_files')
    .select('id, minute_id, role, file_path').eq('id', fileId).maybeSingle()
  if (!f) return { ok: false, error: '파일 없음' }
  if ((f.role as string) === 'body') return { ok: false, error: '본문 파일은 교체로만 변경할 수 있습니다.' }
  const own = await checkOwner(sb, f.minute_id as string, user.id, m.role)
  if (own) return { ok: false, error: own }
  await sb.storage.from(BUCKET).remove([f.file_path as string])
  const { error } = await sb.from('minute_files').delete().eq('id', fileId)
  if (error) return { ok: false, error: error.message }
  revalidatePath(`/minutes/${f.minute_id as string}`)
  return { ok: true }
}

export async function deleteMinute(id: string): Promise<MinuteActionResult> {
  const m = await getMembership()
  if (!m) return { ok: false, error: '로그인 필요' }
  const user = await getSession()
  if (!user) return { ok: false, error: '로그인 필요' }
  const sb = await createServerClient()
  const own = await checkOwner(sb, id, user.id, m.role)
  if (own) return { ok: false, error: own }
  const { data: fs } = await sb.from('minute_files').select('file_path').eq('minute_id', id)
  const paths = (fs ?? []).map(f => f.file_path as string)
  if (paths.length) await sb.storage.from(BUCKET).remove(paths)
  const { error } = await sb.from('minutes').delete().eq('id', id).select('id').single()
  if (error) return { ok: false, error: error.message }
  revalidatePath('/minutes')
  return { ok: true }
}

/** 뷰어 새로고침용 얇은 래퍼 — 세션 게이트 후 위임. */
export async function fetchMinuteDetail(id: string) {
  const user = await getSession()
  if (!user) return null
  return getMinuteDetail(id)
}

/** 다운로드 클릭 시 서명 URL 발급(3600초). */
export async function getMinuteFileUrl(fileId: string): Promise<{ ok: boolean; url?: string; error?: string }> {
  const user = await getSession()
  if (!user) return { ok: false, error: '로그인 필요' }
  const sb = await createServerClient()
  const { data: f } = await sb.from('minute_files').select('file_path').eq('id', fileId).maybeSingle()
  if (!f) return { ok: false, error: '파일 없음' }
  const { data: signed } = await sb.storage.from(BUCKET).createSignedUrl(f.file_path as string, 3600)
  if (!signed?.signedUrl) return { ok: false, error: 'URL 발급 실패' }
  return { ok: true, url: signed.signedUrl }
}

/** 업로드 모달의 회의 연결 드롭다운용 — 프로젝트 회의 목록(가벼운 필드만). */
export async function fetchProjectMeetingsLite(
  projectId: string,
): Promise<{ id: string; title: string; meetingDate: string }[]> {
  const user = await getSession()
  if (!user) return []
  const { meetings } = await getProjectMeetingData(projectId)
  return meetings.map(mt => ({ id: mt.id, title: mt.title, meetingDate: mt.meetingDate }))
}
```

`MinuteFile` import는 미사용이면 제거한다(린트).

- [ ] **Step 2: 빌드/린트 확인** — Run: `npm run build && npm run lint` / Expected: 성공

- [ ] **Step 3: Commit**

```bash
git add src/app/actions/minutes.ts
git commit -m "feat(minutes): 서버 액션 — CRUD·파일 기록·서명 URL (소유권 사전 확인)"
```

### Task 6: react-markdown + MarkdownView + `.minutes-md` 스타일

**Files:**
- Modify: `package.json` (의존성 2개)
- Create: `src/components/minutes/MarkdownView.tsx`
- Modify: `src/app/globals.css` (`@layer components` 블록에 `.minutes-md` 추가)

**Interfaces:**
- Produces: `MarkdownView({ content }: { content: string })` — raw HTML 비렌더(react-markdown 기본), 외부 링크 새 탭.

- [ ] **Step 1: 의존성 설치**

Run: `npm install react-markdown remark-gfm`
Expected: 성공, React 19 peer 경고 없음 (react-markdown v9+, remark-gfm v4).

- [ ] **Step 2: MarkdownView 작성** — `src/components/minutes/MarkdownView.tsx` 전체:

```tsx
'use client'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

/** 회의록 md 렌더 — raw HTML 은 렌더하지 않음(rehype-raw 미사용, XSS 차단). */
export function MarkdownView({ content }: { content: string }) {
  return (
    <div className="minutes-md">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ href, children }) => (
            <a href={href} target="_blank" rel="noopener noreferrer">{children}</a>
          ),
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  )
}
```

- [ ] **Step 3: 스타일 추가** — `src/app/globals.css`의 `@layer components` 블록 안(기존 `.app-input` 뒤)에:

```css
  /* 회의록 md 뷰어 타이포 — 토큰만 사용, .dark 자동 대응 */
  .minutes-md { @apply text-[14px] leading-relaxed text-ink; }
  .minutes-md h1 { @apply mt-6 mb-3 text-xl font-bold text-ink first:mt-0; }
  .minutes-md h2 { @apply mt-5 mb-2 text-lg font-bold text-ink first:mt-0; }
  .minutes-md h3 { @apply mt-4 mb-2 text-base font-semibold text-ink; }
  .minutes-md h4, .minutes-md h5, .minutes-md h6 { @apply mt-3 mb-1.5 text-sm font-semibold text-ink; }
  .minutes-md p { @apply my-2; }
  .minutes-md ul { @apply my-2 list-disc pl-5; }
  .minutes-md ol { @apply my-2 list-decimal pl-5; }
  .minutes-md li { @apply my-0.5; }
  .minutes-md blockquote { @apply my-3 border-l-4 border-line pl-3 text-ink-muted; }
  .minutes-md code { @apply rounded bg-surface-2 px-1 py-0.5 text-[13px]; }
  .minutes-md pre { @apply my-3 overflow-x-auto rounded-xl border border-line bg-surface-2 p-3; }
  .minutes-md pre code { @apply bg-transparent p-0; }
  .minutes-md table { @apply my-3 w-full border-collapse text-[13px]; }
  .minutes-md th { @apply border border-line bg-surface-2 px-2 py-1.5 text-left font-semibold; }
  .minutes-md td { @apply border border-line px-2 py-1.5 align-top; }
  .minutes-md a { @apply text-brand underline underline-offset-2 hover:text-brand-hover; }
  .minutes-md hr { @apply my-4 border-line; }
  .minutes-md img { @apply max-w-full; }
```

- [ ] **Step 4: 빌드 확인** — Run: `npm run build` / Expected: 성공

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json src/components/minutes/MarkdownView.tsx src/app/globals.css
git commit -m "feat(minutes): react-markdown 뷰어 컴포넌트 + .minutes-md 토큰 스타일"
```

### Task 7: 보관함 페이지 — 서버 페이지 + 리스트 뷰

**Files:**
- Create: `src/app/(app)/minutes/page.tsx`
- Create: `src/components/minutes/MinutesView.tsx`
- Modify: `src/app/actions/minutes.ts` (조회용 얇은 래퍼 2개 추가)

**Interfaces:**
- Consumes: `getMinutesPage`/`searchMinutes` (Task 4), `getUiPrefs` (`@/app/actions/preferences`), `SegmentedTabs`/`EmptyState`/`PageHero`/`KpiCard`/`ProjectPageShell`, `listProjects` (`@/app/actions/project`), dict `min.*`
- Produces: 액션 `fetchMinutesRange(rangeStart, rangeEnd, team): Promise<Minute[]>`, `fetchMinutesSearch(q, team): Promise<Minute[]>`; 컴포넌트 `MinutesView({ initialMinutes, todayIso, initialView, projects, currentUserId, role })`. 달력 뷰 슬롯/업로드 버튼은 Task 8·9에서 채움 — 이 태스크에서는 `view === 'calendar'`일 때 EmptyState 플레이스홀더, 업로드 버튼은 비활성 렌더.
- 팀 색: `TEAM` 맵(`@/components/wbs/shared`) 재사용 — `TEAM[teamCode].fg`/`.bar`.

- [ ] **Step 1: 조회 래퍼 추가** — `src/app/actions/minutes.ts` 하단에:

```ts
/** 월 이동 시 클라이언트 호출용. */
export async function fetchMinutesRange(
  rangeStart: string, rangeEnd: string, team: TeamCode | null,
): Promise<Minute[]> {
  const user = await getSession()
  if (!user) return []
  return getMinutesPage(rangeStart, rangeEnd, team)
}

/** 검색 입력 시 클라이언트 호출용(전 기간, 100건 캡). */
export async function fetchMinutesSearch(q: string, team: TeamCode | null): Promise<Minute[]> {
  const user = await getSession()
  if (!user) return []
  return searchMinutes(q, team, 100)
}
```

import에 `getMinutesPage, searchMinutes` (from `@/lib/data/minutes`)와 `type { Minute, TeamCode }` (from `@/lib/domain/types`)를 추가.

- [ ] **Step 2: 서버 페이지 작성** — `src/app/(app)/minutes/page.tsx` 전체:

```tsx
import { NotebookText } from 'lucide-react'
import { t } from '@/lib/i18n/dict'
import { getServerLocale } from '@/lib/i18n/server'
import { getMinutesPage } from '@/lib/data/minutes'
import { getMembership, getSession } from '@/lib/auth'
import { getUiPrefs } from '@/app/actions/preferences'
import { listProjects } from '@/app/actions/project'
import { PageHero, HeroBadge } from '@/components/ui/PageHero'
import { KpiCard } from '@/components/ui/KpiCard'
import { ProjectPageShell } from '@/components/app/ProjectPageShell'
import { MinutesView } from '@/components/minutes/MinutesView'

function seoulToday(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date())
}
/** 해당 월 1일~말일 (달력 그리드 아님 — 목록은 월 단위 조회). */
function monthRange(todayIso: string): [string, string] {
  const [y, m] = todayIso.split('-').map(Number)
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate()
  const mm = String(m).padStart(2, '0')
  return [`${y}-${mm}-01`, `${y}-${mm}-${String(last).padStart(2, '0')}`]
}

export default async function MinutesPage() {
  const today = seoulToday()
  const [rs, re] = monthRange(today)
  const [minutes, m, user, prefs, projects, locale] = await Promise.all([
    getMinutesPage(rs, re, null),
    getMembership(),
    getSession(),
    getUiPrefs(),
    listProjects(),
    getServerLocale(),
  ])
  return (
    <ProjectPageShell
      hero={<PageHero
        eyebrow="MINUTES"
        badge={<HeroBadge>Minutes</HeroBadge>}
        title={t(locale, 'min.heroTitle')}
        description={t(locale, 'min.heroDesc')}
        heroKpis={<KpiCard variant="hero" label="THIS MONTH" value={minutes.length}
          sub={t(locale, 'min.kpi.monthSub')} icon={NotebookText} tone="brand" />}
      />}
    >
      <MinutesView initialMinutes={minutes} todayIso={today}
        initialView={prefs.minutesView ?? 'list'} projects={projects}
        currentUserId={user?.id ?? null} role={m?.role ?? null} />
    </ProjectPageShell>
  )
}
```

- [ ] **Step 3: MinutesView 작성** — `src/components/minutes/MinutesView.tsx` 전체:

```tsx
'use client'
import { useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { CalendarDays, ChevronLeft, ChevronRight, List, Paperclip, Plus, Search } from 'lucide-react'
import type { Minute, Project, TeamCode } from '@/lib/domain/types'
import { TEAM_CODES } from '@/lib/domain/minutes'
import { fetchMinutesRange, fetchMinutesSearch } from '@/app/actions/minutes'
import { queueUiPref } from '@/lib/prefs/debouncedSave'
import { useLocale } from '@/components/providers/LocaleProvider'
import { SegmentedTabs } from '@/components/ui/SegmentedTabs'
import { EmptyState } from '@/components/ui/EmptyState'
import { TEAM } from '@/components/wbs/shared'

type ViewKey = 'list' | 'calendar'
type TeamKey = 'ALL' | TeamCode

function monthRangeOf(year: number, month0: number): [string, string] {
  const last = new Date(Date.UTC(year, month0 + 1, 0)).getUTCDate()
  const mm = String(month0 + 1).padStart(2, '0')
  return [`${year}-${mm}-01`, `${year}-${mm}-${String(last).padStart(2, '0')}`]
}

export function MinutesView({
  initialMinutes, todayIso, initialView, projects, currentUserId, role,
}: {
  initialMinutes: Minute[]
  todayIso: string
  initialView: ViewKey
  projects: Project[]
  currentUserId: string | null
  role: string | null
}) {
  const router = useRouter()
  const { t, locale } = useLocale()
  const [initY, initM] = useMemo(() => todayIso.split('-').map(Number), [todayIso])
  const [year, setYear] = useState(initY)
  const [month0, setMonth0] = useState((initM || 1) - 1)
  const [view, setView] = useState<ViewKey>(initialView)
  const [team, setTeam] = useState<TeamKey>('ALL')
  const [minutes, setMinutes] = useState<Minute[]>(initialMinutes)
  const [query, setQuery] = useState('')
  const [searching, setSearching] = useState(false)
  const [uploadOpen, setUploadOpen] = useState(false)
  const reqRef = useRef(0)

  const teamOrNull = team === 'ALL' ? null : team
  const isSearch = query.trim().length > 0

  async function loadMonth(y: number, m0: number, tk: TeamKey) {
    const gen = ++reqRef.current
    const [rs, re] = monthRangeOf(y, m0)
    const rows = await fetchMinutesRange(rs, re, tk === 'ALL' ? null : tk)
    if (reqRef.current === gen) setMinutes(rows)
  }
  function shift(delta: number) {
    if (isSearch) return
    const base = new Date(Date.UTC(year, month0 + delta, 1))
    const y = base.getUTCFullYear(); const m0 = base.getUTCMonth()
    setYear(y); setMonth0(m0)
    void loadMonth(y, m0, team)
  }
  function changeTeam(tk: TeamKey) {
    setTeam(tk)
    if (isSearch) void runSearch(query, tk)
    else void loadMonth(year, month0, tk)
  }
  async function runSearch(q: string, tk: TeamKey) {
    const gen = ++reqRef.current
    if (!q.trim()) { void loadMonth(year, month0, tk); return }
    setSearching(true)
    const rows = await fetchMinutesSearch(q, tk === 'ALL' ? null : tk)
    if (reqRef.current === gen) { setMinutes(rows); setSearching(false) }
  }
  function changeView(v: ViewKey) {
    setView(v)
    queueUiPref({ minutesView: v })
  }

  // 일자별 그룹(내림차순)
  const groups = useMemo(() => {
    const map = new Map<string, Minute[]>()
    for (const mi of minutes) {
      const arr = map.get(mi.minuteDate) ?? []
      arr.push(mi); map.set(mi.minuteDate, arr)
    }
    return [...map.entries()].sort((a, b) => (a[0] < b[0] ? 1 : -1))
  }, [minutes])

  const ymLabel = `${year}-${String(month0 + 1).padStart(2, '0')}`
  const kpiByTeam = useMemo(() => {
    const c: Record<string, number> = {}
    for (const tk of TEAM_CODES) c[tk] = 0
    for (const mi of minutes) c[mi.teamCode] = (c[mi.teamCode] ?? 0) + 1
    return c
  }, [minutes])

  return (
    <div className="space-y-4">
      {/* 필터 바 */}
      <div className="flex flex-wrap items-center gap-2">
        <SegmentedTabs<TeamKey>
          tabs={[{ key: 'ALL', label: t('min.team.all') }, ...TEAM_CODES.map(tk => ({ key: tk, label: tk }))]}
          value={team} onChange={changeTeam} size="sm" />
        <div className="flex items-center gap-1">
          <button onClick={() => shift(-1)} disabled={isSearch} className="chrome-icon disabled:opacity-40" aria-label="prev month">
            <ChevronLeft className="h-4 w-4" />
          </button>
          <span className="min-w-[84px] text-center text-sm font-semibold tabular-nums">{ymLabel}</span>
          <button onClick={() => shift(1)} disabled={isSearch} className="chrome-icon disabled:opacity-40" aria-label="next month">
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-subtle" />
          <input value={query}
            onChange={e => { setQuery(e.target.value); void runSearch(e.target.value, team) }}
            placeholder={t('min.search.placeholder')}
            className="app-input h-9 w-56 pl-8" />
        </div>
        <div className="ml-auto flex items-center gap-2">
          <SegmentedTabs<ViewKey>
            tabs={[{ key: 'list', label: t('min.view.list'), icon: List },
                   { key: 'calendar', label: t('min.view.calendar'), icon: CalendarDays }]}
            value={isSearch ? 'list' : view} onChange={changeView} size="sm" />
          <button onClick={() => setUploadOpen(true)} className="btn btn-primary">
            <Plus className="h-4 w-4" />{t('min.upload')}
          </button>
        </div>
      </div>

      {/* 담당별 카운트 요약 */}
      <div className="flex flex-wrap gap-3 text-xs text-ink-muted">
        {TEAM_CODES.map(tk => (
          <span key={tk} className="inline-flex items-center gap-1.5">
            <span className={`inline-block h-2 w-2 rounded-full ${TEAM[tk].bar}`} />
            {tk} {kpiByTeam[tk]}
          </span>
        ))}
      </div>

      {isSearch && minutes.length >= 100 && (
        <p className="text-xs text-ink-subtle">{t('min.search.truncated')}</p>
      )}

      {/* 리스트 뷰 (검색 중에는 강제 리스트) */}
      {(view === 'list' || isSearch) && (
        groups.length === 0 ? (
          <EmptyState title={t('min.empty.title')} description={t('min.empty.desc')} />
        ) : (
          <div className="space-y-4">
            {groups.map(([date, rows]) => (
              <section key={date} className="card p-3">
                <h3 className="mb-2 px-1 text-sm font-semibold text-ink-muted">{date}</h3>
                <ul className="divide-y divide-line/70">
                  {rows.map(mi => (
                    <li key={mi.id}>
                      <Link href={`/minutes/${mi.id}`}
                        className="flex items-center gap-3 rounded-lg px-2 py-2.5 hover:bg-surface-2">
                        <span className={`inline-flex w-12 shrink-0 justify-center rounded-md px-1.5 py-0.5 text-[11px] font-bold text-white ${TEAM[mi.teamCode].bar}`}>
                          {mi.teamCode}
                        </span>
                        <span className="flex-1 truncate text-sm font-medium text-ink">{mi.title}</span>
                        {(mi.fileCount ?? 0) > 0 && (
                          <span className="inline-flex items-center gap-1 text-xs text-ink-subtle">
                            <Paperclip className="h-3.5 w-3.5" />{mi.fileCount}
                          </span>
                        )}
                        <span className="w-24 truncate text-right text-xs text-ink-subtle">{mi.createdByName ?? ''}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        )
      )}

      {/* 달력 뷰 — Task 8에서 MinutesCalendar 로 교체 */}
      {view === 'calendar' && !isSearch && (
        <EmptyState title="달력 뷰" description="Task 8에서 구현" />
      )}

      {/* 업로드 모달 — Task 9에서 MinuteUploadModal 로 교체 */}
      {uploadOpen && <div className="hidden" aria-hidden onClick={() => setUploadOpen(false)} />}
      {void projects} {void currentUserId} {void role} {void locale} {void router}
    </div>
  )
}
```

주의: 마지막 `{void …}` 줄은 Task 8·9에서 실제 사용되기 전까지 미사용-변수 린트를 피하는 임시 조치다. Task 9 완료 시 제거된다. `chrome-icon`/`btn btn-primary` 클래스는 기존 MeetingsView가 쓰는 하우스 클래스 — globals.css에 이미 존재.

- [ ] **Step 4: 빌드 확인** — Run: `npm run build && npm run lint` / Expected: 성공. 라우트 `/minutes` 생성 확인 (빌드 출력에 표시).

- [ ] **Step 5: Commit**

```bash
git add src/app/\(app\)/minutes/page.tsx src/components/minutes/MinutesView.tsx src/app/actions/minutes.ts
git commit -m "feat(minutes): 보관함 페이지 — 리스트 뷰 + 담당/월/검색 필터"
```

### Task 8: 달력 뷰 `MinutesCalendar`

**Files:**
- Create: `src/components/minutes/MinutesCalendar.tsx`
- Modify: `src/components/minutes/MinutesView.tsx` (달력 플레이스홀더 교체)

**Interfaces:**
- Consumes: `monthMatrix(year, month0)` (`@/lib/domain/attendance` — ISO 날짜 문자열 행렬 반환), `krSpecialDayMap` (`@/lib/domain/holidays`), `TEAM` (`@/components/wbs/shared`), `Minute`
- Produces: `MinutesCalendar({ year, month0, todayIso, minutes, onSelectDate, selectedDate })` — 날짜 클릭 → 그리드 아래 해당 일자 목록 패널(MinutesView가 렌더).

- [ ] **Step 1: MinutesCalendar 작성** — `src/components/minutes/MinutesCalendar.tsx` 전체:

```tsx
'use client'
import { useMemo } from 'react'
import type { Minute } from '@/lib/domain/types'
import { monthMatrix } from '@/lib/domain/attendance'
import { krSpecialDayMap } from '@/lib/domain/holidays'
import { useLocale } from '@/components/providers/LocaleProvider'
import type { DictKey } from '@/lib/i18n/dict'
import { TEAM } from '@/components/wbs/shared'

const WEEKDAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const

function dowClass(dow: number, base = 'text-ink') {
  if (dow === 0) return 'text-delayed'
  if (dow === 6) return 'text-progress'
  return base
}

export function MinutesCalendar({
  year, month0, todayIso, minutes, onSelectDate, selectedDate,
}: {
  year: number
  month0: number
  todayIso: string
  minutes: Minute[]
  onSelectDate: (dateIso: string) => void
  selectedDate: string | null
}) {
  const { t } = useLocale()
  const matrix = useMemo(() => monthMatrix(year, month0), [year, month0])
  const byDate = useMemo(() => {
    const map = new Map<string, Minute[]>()
    for (const mi of minutes) {
      const arr = map.get(mi.minuteDate) ?? []
      arr.push(mi); map.set(mi.minuteDate, arr)
    }
    return map
  }, [minutes])
  const specialDays = useMemo(
    () => krSpecialDayMap(matrix.flat().map(cell => Number(cell.slice(0, 4)))),
    [matrix],
  )
  const ym = `${year}-${String(month0 + 1).padStart(2, '0')}`

  return (
    <div className="card overflow-hidden p-0">
      <div className="grid grid-cols-7 gap-px bg-line">
        {WEEKDAY_KEYS.map((w, i) => (
          <div key={w} className={`bg-surface-2 py-2 text-center text-[11px] font-semibold ${dowClass(i, 'text-ink-muted')}`}>
            {t(`att.weekday.${w}` as DictKey)}
          </div>
        ))}
        {matrix.flat().map((cell, idx) => {
          const dow = idx % 7
          const inMonth = cell.startsWith(ym)
          const isToday = cell === todayIso
          const dayNum = Number(cell.slice(8, 10))
          const rows = byDate.get(cell) ?? []
          const special = specialDays.get(cell)
          const isRestDay = !!special && special.kind !== 'anniversary'
          const isSelected = cell === selectedDate
          return (
            <button key={cell} type="button" onClick={() => rows.length && onSelectDate(cell)}
              className={`min-h-[92px] bg-surface p-1.5 text-left ${inMonth ? '' : 'opacity-40'} ${isSelected ? 'ring-2 ring-inset ring-brand-ring' : ''} ${rows.length ? 'cursor-pointer hover:bg-surface-2' : 'cursor-default'}`}>
              <span className={`inline-flex h-6 min-w-6 items-center justify-center rounded-full px-1 text-xs font-semibold tabular-nums ${isToday ? 'bg-brand text-white' : isRestDay ? 'text-delayed' : dowClass(dow)}`}>
                {dayNum}
              </span>
              <div className="mt-1 flex flex-wrap gap-1">
                {rows.slice(0, 4).map(mi => (
                  <span key={mi.id}
                    className={`inline-flex items-center rounded px-1 py-px text-[10px] font-bold text-white ${TEAM[mi.teamCode].bar}`}>
                    {mi.teamCode}
                  </span>
                ))}
                {rows.length > 4 && (
                  <span className="text-[10px] font-medium text-ink-subtle">+{rows.length - 4}</span>
                )}
              </div>
            </button>
          )
        })}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: MinutesView에 배선** — Task 7의 달력 플레이스홀더(`{view === 'calendar' && !isSearch && (<EmptyState …/>)}`)를 다음으로 교체하고, 상태 `const [selectedDate, setSelectedDate] = useState<string | null>(null)`를 추가:

```tsx
      {view === 'calendar' && !isSearch && (
        <div className="space-y-3">
          <MinutesCalendar year={year} month0={month0} todayIso={todayIso}
            minutes={minutes} onSelectDate={d => setSelectedDate(prev => (prev === d ? null : d))}
            selectedDate={selectedDate} />
          {selectedDate && (
            <section className="card p-3">
              <h3 className="mb-2 px-1 text-sm font-semibold text-ink-muted">{selectedDate}</h3>
              <ul className="divide-y divide-line/70">
                {minutes.filter(mi => mi.minuteDate === selectedDate).map(mi => (
                  <li key={mi.id}>
                    <Link href={`/minutes/${mi.id}`}
                      className="flex items-center gap-3 rounded-lg px-2 py-2.5 hover:bg-surface-2">
                      <span className={`inline-flex w-12 shrink-0 justify-center rounded-md px-1.5 py-0.5 text-[11px] font-bold text-white ${TEAM[mi.teamCode].bar}`}>
                        {mi.teamCode}
                      </span>
                      <span className="flex-1 truncate text-sm font-medium text-ink">{mi.title}</span>
                      <span className="w-24 truncate text-right text-xs text-ink-subtle">{mi.createdByName ?? ''}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      )}
```

`import { MinutesCalendar } from './MinutesCalendar'` 추가. 월 이동(`shift`)·담당 변경 시 `setSelectedDate(null)`도 추가.

- [ ] **Step 3: 빌드 확인** — Run: `npm run build` / Expected: 성공

- [ ] **Step 4: Commit**

```bash
git add src/components/minutes/MinutesCalendar.tsx src/components/minutes/MinutesView.tsx
git commit -m "feat(minutes): 월 달력 뷰 + 일자 상세 패널 (리스트/달력 토글 완성)"
```

### Task 9: 업로드 모달 `MinuteUploadModal`

**Files:**
- Create: `src/components/minutes/MinuteUploadModal.tsx`
- Modify: `src/components/minutes/MinutesView.tsx` (모달 배선, `{void …}` 임시 줄 제거)

**Interfaces:**
- Consumes: `createMinute`/`recordMinuteFile`/`fetchProjectMeetingsLite` (Task 5), `createBrowserClient`, `sanitizeFileName`/상수 (domain/minutes.ts), `Modal`/`SegmentedTabs`/`useToast`, `Project` 타입
- Produces: `MinuteUploadModal({ open, onClose, onSaved, todayIso, projects })` — 저장 성공 시 onSaved() → MinutesView가 모달 닫고 `router.refresh()` + 현재 뷰 재조회.

- [ ] **Step 1: 모달 작성** — `src/components/minutes/MinuteUploadModal.tsx` 전체:

```tsx
'use client'
import { useState, type ChangeEvent } from 'react'
import type { Project, TeamCode } from '@/lib/domain/types'
import {
  MINUTE_ATTACHMENTS_MAX_COUNT, MINUTE_ATTACHMENT_MAX, MINUTE_BODY_FILE_MAX,
  MINUTE_BODY_MAX, TEAM_CODES, sanitizeFileName,
} from '@/lib/domain/minutes'
import { createMinute, fetchProjectMeetingsLite, recordMinuteFile } from '@/app/actions/minutes'
import { createBrowserClient } from '@/lib/supabase/client'
import { useLocale } from '@/components/providers/LocaleProvider'
import { Modal } from '@/components/ui/Modal'
import { SegmentedTabs } from '@/components/ui/SegmentedTabs'

const BUCKET = 'minutes'

export function MinuteUploadModal({
  open, onClose, onSaved, todayIso, projects,
}: {
  open: boolean
  onClose: () => void
  onSaved: () => void
  todayIso: string
  projects: Project[]
}) {
  const { t } = useLocale()
  const [date, setDate] = useState(todayIso)
  const [team, setTeam] = useState<TeamCode>('PMO')
  const [title, setTitle] = useState('')
  const [bodyFile, setBodyFile] = useState<File | null>(null)
  const [bodyText, setBodyText] = useState('')
  const [attachments, setAttachments] = useState<File[]>([])
  const [projectId, setProjectId] = useState('')
  const [meetingId, setMeetingId] = useState('')
  const [meetings, setMeetings] = useState<{ id: string; title: string; meetingDate: string }[]>([])
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  async function onBodyFile(e: ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]
    e.target.value = ''
    if (!f) return
    setErr(null)
    if (!/\.(md|markdown)$/i.test(f.name)) { setErr(t('min.err.bodyExt')); return }
    if (f.size > MINUTE_BODY_FILE_MAX) { setErr(t('min.err.bodyFileMax')); return }
    const text = await f.text()
    if (text.length > MINUTE_BODY_MAX) { setErr(t('min.err.bodyMax')); return }
    setBodyFile(f); setBodyText(text)
    if (!title.trim()) setTitle(f.name.replace(/\.(md|markdown)$/i, ''))
  }

  function onAttach(e: ChangeEvent<HTMLInputElement>) {
    const files = [...(e.target.files ?? [])]
    e.target.value = ''
    setErr(null)
    if (attachments.length + files.length > MINUTE_ATTACHMENTS_MAX_COUNT) { setErr(t('min.err.attachCount')); return }
    if (files.some(f => f.size > MINUTE_ATTACHMENT_MAX)) { setErr(t('min.err.attachMax')); return }
    setAttachments(prev => [...prev, ...files])
  }

  async function onProject(pid: string) {
    setProjectId(pid); setMeetingId(''); setMeetings([])
    if (pid) setMeetings(await fetchProjectMeetingsLite(pid))
  }

  async function save() {
    if (!bodyFile) { setErr(t('min.err.bodyRequired')); return }
    setBusy(true); setErr(null)
    try {
      const res = await createMinute({
        minuteDate: date, teamCode: team, title: title.trim() || bodyFile.name,
        bodyMd: bodyText, meetingId: meetingId || null,
      })
      if (!res.ok || !res.id) { setErr(res.error ?? t('min.err.upload')); return }
      const minuteId = res.id
      const sb = createBrowserClient()
      const files: { role: 'body' | 'attachment'; f: File }[] = [
        { role: 'body', f: bodyFile },
        ...attachments.map(f => ({ role: 'attachment' as const, f })),
      ]
      // 파일 업로드 실패 시에도 회의록은 유지한다(body_md 가 원천 — 스펙 §7).
      // body 파일 실패면 뷰어가 '재업로드 유도' 상태를 안내하고, replaceMinuteBody 로 복구 가능.
      for (const { role, f } of files) {
        const path = `${minuteId}/${Date.now()}-${sanitizeFileName(f.name)}`
        const up = await sb.storage.from(BUCKET).upload(path, f, { upsert: false })
        if (up.error) { setErr(`${t('min.err.upload')}: ${up.error.message}`); return }
        const rec = await recordMinuteFile(minuteId, {
          role, fileName: f.name, filePath: path,
          size: f.size, mime: f.type || 'application/octet-stream',
        })
        if (!rec.ok) {
          // 메타 기록 실패 → 방금 올린 객체 정리(보상). 회의록은 유지.
          await sb.storage.from(BUCKET).remove([path])
          setErr(rec.error ?? t('min.err.record')); return
        }
      }
      onSaved()
    } finally { setBusy(false) }
  }

  return (
    <Modal open={open} onClose={onClose} title={t('min.upload')} size="md"
      footer={
        <div className="flex justify-end gap-2">
          <button onClick={save} disabled={busy || !bodyFile} className="btn btn-primary">
            {busy ? t('min.form.saving') : t('min.form.save')}
          </button>
        </div>
      }>
      <div className="space-y-3">
        <label className="block text-sm">
          <span className="mb-1 block font-medium">{t('min.form.date')}</span>
          <input type="date" value={date} onChange={e => setDate(e.target.value)} className="app-input" />
        </label>
        <div className="text-sm">
          <span className="mb-1 block font-medium">{t('min.form.team')}</span>
          <SegmentedTabs<TeamCode>
            tabs={TEAM_CODES.map(tk => ({ key: tk, label: tk }))}
            value={team} onChange={setTeam} size="sm" />
        </div>
        <label className="block text-sm">
          <span className="mb-1 block font-medium">{t('min.form.bodyFile')}</span>
          <input type="file" accept=".md,.markdown" onChange={onBodyFile} className="app-input pt-1.5" />
          {bodyFile && <span className="mt-1 block text-xs text-ink-subtle">{bodyFile.name} · {bodyText.length.toLocaleString()}자</span>}
        </label>
        <label className="block text-sm">
          <span className="mb-1 block font-medium">{t('min.form.title')}</span>
          <input value={title} onChange={e => setTitle(e.target.value)} maxLength={200} className="app-input" />
        </label>
        <label className="block text-sm">
          <span className="mb-1 block font-medium">{t('min.form.attachments')}</span>
          <input type="file" multiple onChange={onAttach} className="app-input pt-1.5" />
          {attachments.length > 0 && (
            <ul className="mt-1 space-y-0.5 text-xs text-ink-subtle">
              {attachments.map((f, i) => (
                <li key={`${f.name}-${i}`} className="flex items-center justify-between">
                  <span className="truncate">{f.name}</span>
                  <button type="button" className="text-delayed"
                    onClick={() => setAttachments(prev => prev.filter((_, j) => j !== i))}>✕</button>
                </li>
              ))}
            </ul>
          )}
        </label>
        <div className="grid grid-cols-2 gap-2 text-sm">
          <label className="block">
            <span className="mb-1 block font-medium">{t('min.form.project')}</span>
            <select value={projectId} onChange={e => void onProject(e.target.value)} className="app-input">
              <option value="">{t('min.form.meetingNone')}</option>
              {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </label>
          <label className="block">
            <span className="mb-1 block font-medium">{t('min.form.meeting')}</span>
            <select value={meetingId} onChange={e => setMeetingId(e.target.value)} disabled={!projectId} className="app-input">
              <option value="">{t('min.form.meetingNone')}</option>
              {meetings.map(mt => <option key={mt.id} value={mt.id}>{mt.meetingDate} · {mt.title}</option>)}
            </select>
          </label>
        </div>
        {err && <p className="text-sm text-delayed">{err}</p>}
      </div>
    </Modal>
  )
}
```

- [ ] **Step 2: MinutesView 배선** — Task 7의 임시 모달 줄(`{uploadOpen && <div className="hidden" …/>}`)과 `{void …}` 줄을 제거하고:

```tsx
      <MinuteUploadModal open={uploadOpen} onClose={() => setUploadOpen(false)}
        onSaved={() => {
          setUploadOpen(false)
          if (isSearch) void runSearch(query, team); else void loadMonth(year, month0, team)
          router.refresh()
        }}
        todayIso={todayIso} projects={projects} />
```

`import { MinuteUploadModal } from './MinuteUploadModal'` 추가. `currentUserId`/`role` prop은 아직 미사용이므로 시그니처에서 제거하지 말고 `void` 없이 구조분해에서 `_` 접두 없이 유지 — 사용처(Task 11 뷰어)와의 대칭 유지가 목적이나, 린트 에러가 나면 prop 자체를 제거하고 page.tsx 호출부도 함께 정리한다.

- [ ] **Step 3: 빌드/린트 확인** — Run: `npm run build && npm run lint` / Expected: 성공

- [ ] **Step 4: Commit**

```bash
git add src/components/minutes/MinuteUploadModal.tsx src/components/minutes/MinutesView.tsx src/app/\(app\)/minutes/page.tsx
git commit -m "feat(minutes): 업로드 모달 — FileReader 검증 + Storage 직접 업로드 + 보상 처리"
```

### Task 10: 뷰어 페이지 (읽기 전용) — `/minutes/[id]`

**Files:**
- Create: `src/app/(app)/minutes/[id]/page.tsx`
- Create: `src/components/minutes/MinuteViewer.tsx`

**Interfaces:**
- Consumes: `getMinuteDetail` (Task 4), `getMinuteFileUrl` (Task 5), `MarkdownView` (Task 6), `TEAM` 맵, dict `min.detail.*`
- Produces: `MinuteViewer({ minute, files, canManage })` — 관리 메뉴(수정/교체/삭제)와 채팅 패널 슬롯은 Task 11·17에서 채움. 이 태스크는 메타 헤더 + 다운로드 + md 렌더까지.

- [ ] **Step 1: 서버 페이지 작성** — `src/app/(app)/minutes/[id]/page.tsx` 전체:

```tsx
import { notFound } from 'next/navigation'
import { getMinuteDetail } from '@/lib/data/minutes'
import { getMembership, getSession } from '@/lib/auth'
import { MinuteViewer } from '@/components/minutes/MinuteViewer'

export default async function MinuteDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const [detail, m, user] = await Promise.all([getMinuteDetail(id), getMembership(), getSession()])
  if (!detail) notFound()
  const canManage = !!user && (detail.minute.createdBy === user.id || m?.role === 'pmo_admin')
  return <MinuteViewer minute={detail.minute} files={detail.files} canManage={canManage} />
}
```

- [ ] **Step 2: MinuteViewer 작성** — `src/components/minutes/MinuteViewer.tsx` 전체:

```tsx
'use client'
import { useState } from 'react'
import Link from 'next/link'
import { ArrowLeft, Download, ExternalLink, Paperclip } from 'lucide-react'
import type { Minute, MinuteFile } from '@/lib/domain/types'
import { getMinuteFileUrl } from '@/app/actions/minutes'
import { useLocale } from '@/components/providers/LocaleProvider'
import { MarkdownView } from './MarkdownView'
import { TEAM } from '@/components/wbs/shared'

export function MinuteViewer({
  minute, files, canManage,
}: {
  minute: Minute
  files: MinuteFile[]
  canManage: boolean
}) {
  const { t } = useLocale()
  const [busy, setBusy] = useState(false)
  const bodyFile = files.find(f => f.role === 'body') ?? null
  const attachments = files.filter(f => f.role === 'attachment')

  async function download(fileId: string) {
    setBusy(true)
    const res = await getMinuteFileUrl(fileId)
    setBusy(false)
    if (res.ok && res.url) window.open(res.url, '_blank', 'noopener,noreferrer')
  }

  return (
    <div className="mx-auto max-w-5xl space-y-4 p-4">
      {/* 메타 헤더 */}
      <div className="card space-y-3 p-4">
        <div className="flex flex-wrap items-center gap-3">
          <Link href="/minutes" className="inline-flex items-center gap-1 text-sm text-ink-muted hover:text-ink">
            <ArrowLeft className="h-4 w-4" />{t('min.detail.back')}
          </Link>
          <span className="text-sm tabular-nums text-ink-muted">{minute.minuteDate}</span>
          <span className={`inline-flex rounded-md px-1.5 py-0.5 text-[11px] font-bold text-white ${TEAM[minute.teamCode].bar}`}>
            {minute.teamCode}
          </span>
          <h1 className="flex-1 truncate text-lg font-bold text-ink">{minute.title}</h1>
          <span className="text-xs text-ink-subtle">{minute.createdByName ?? ''}</span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {bodyFile ? (
            <button onClick={() => void download(bodyFile.id)} disabled={busy} className="btn">
              <Download className="h-4 w-4" />{t('min.detail.download')}
            </button>
          ) : (
            <span className="text-xs text-delayed">{t('min.detail.noBodyFile')}</span>
          )}
          {attachments.map(f => (
            <button key={f.id} onClick={() => void download(f.id)} disabled={busy} className="btn">
              <Paperclip className="h-4 w-4" />{f.fileName}
            </button>
          ))}
          {minute.meetingId && (
            <span className="inline-flex items-center gap-1 text-xs text-ink-subtle">
              <ExternalLink className="h-3.5 w-3.5" />{t('min.detail.linkedMeeting')}
            </span>
          )}
          {/* 관리 메뉴(수정/교체/삭제) — Task 11에서 추가 (canManage) */}
        </div>
      </div>

      {/* 본문 + (Task 17: 우측 채팅 패널) */}
      <div className="card p-5">
        <MarkdownView content={minute.bodyMd} />
      </div>
      {void canManage}
    </div>
  )
}
```

`{void canManage}`는 Task 11에서 제거된다.

- [ ] **Step 3: 빌드 확인** — Run: `npm run build` / Expected: 성공, 라우트 `/minutes/[id]` 생성.

- [ ] **Step 4: Commit**

```bash
git add src/app/\(app\)/minutes/\[id\]/page.tsx src/components/minutes/MinuteViewer.tsx
git commit -m "feat(minutes): 뷰어 페이지 — 메타 헤더 + 서명 URL 다운로드 + md 렌더"
```

### Task 11: 뷰어 관리 액션 UI (메타 수정 · 본문 교체 · 삭제)

**Files:**
- Create: `src/components/minutes/MinuteMetaModal.tsx`
- Modify: `src/components/minutes/MinuteViewer.tsx`

**Interfaces:**
- Consumes: `updateMinuteMeta`/`replaceMinuteBody`/`deleteMinute` (Task 5), `Modal`/`SegmentedTabs`, `sanitizeFileName`/상수
- Produces: `MinuteMetaModal({ open, onClose, onSaved, minute, projects? })` — 회의 연결 수정은 생략(YAGNI: 일자·담당·제목만). 본문 교체는 뷰어 내 파일 input으로 직접 처리.

- [ ] **Step 1: MinuteMetaModal 작성** — `src/components/minutes/MinuteMetaModal.tsx` 전체:

```tsx
'use client'
import { useState } from 'react'
import type { Minute, TeamCode } from '@/lib/domain/types'
import { TEAM_CODES } from '@/lib/domain/minutes'
import { updateMinuteMeta } from '@/app/actions/minutes'
import { useLocale } from '@/components/providers/LocaleProvider'
import { Modal } from '@/components/ui/Modal'
import { SegmentedTabs } from '@/components/ui/SegmentedTabs'

export function MinuteMetaModal({
  open, onClose, onSaved, minute,
}: {
  open: boolean
  onClose: () => void
  onSaved: () => void
  minute: Minute
}) {
  const { t } = useLocale()
  const [date, setDate] = useState(minute.minuteDate)
  const [team, setTeam] = useState<TeamCode>(minute.teamCode)
  const [title, setTitle] = useState(minute.title)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  async function save() {
    setBusy(true); setErr(null)
    const res = await updateMinuteMeta(minute.id, {
      minuteDate: date, teamCode: team, title, meetingId: minute.meetingId,
    })
    setBusy(false)
    if (!res.ok) { setErr(res.error ?? 'error'); return }
    onSaved()
  }

  return (
    <Modal open={open} onClose={onClose} title={t('min.meta.title')} size="sm"
      footer={<div className="flex justify-end"><button onClick={save} disabled={busy} className="btn btn-primary">{t('min.meta.save')}</button></div>}>
      <div className="space-y-3">
        <label className="block text-sm">
          <span className="mb-1 block font-medium">{t('min.form.date')}</span>
          <input type="date" value={date} onChange={e => setDate(e.target.value)} className="app-input" />
        </label>
        <div className="text-sm">
          <span className="mb-1 block font-medium">{t('min.form.team')}</span>
          <SegmentedTabs<TeamCode> tabs={TEAM_CODES.map(tk => ({ key: tk, label: tk }))}
            value={team} onChange={setTeam} size="sm" />
        </div>
        <label className="block text-sm">
          <span className="mb-1 block font-medium">{t('min.form.title')}</span>
          <input value={title} onChange={e => setTitle(e.target.value)} maxLength={200} className="app-input" />
        </label>
        {err && <p className="text-sm text-delayed">{err}</p>}
      </div>
    </Modal>
  )
}
```

- [ ] **Step 2: MinuteViewer에 관리 메뉴 배선** — `{/* 관리 메뉴 … */}` 주석과 `{void canManage}`를 제거하고, 메타 헤더 버튼 행 끝에:

```tsx
          {canManage && (
            <span className="ml-auto flex items-center gap-2">
              <button onClick={() => setMetaOpen(true)} className="btn">{t('min.detail.edit')}</button>
              <label className="btn cursor-pointer">
                {t('min.detail.replaceBody')}
                <input type="file" accept=".md,.markdown" className="hidden" onChange={onReplaceBody} />
              </label>
              <button onClick={() => void onDelete()} className="btn text-delayed">{t('min.detail.delete')}</button>
            </span>
          )}
```

컴포넌트에 상태/핸들러 추가 (import: `useRouter`, `MinuteMetaModal`, `replaceMinuteBody`/`deleteMinute`, `createBrowserClient`, `sanitizeFileName`, `MINUTE_BODY_FILE_MAX`/`MINUTE_BODY_MAX`, `type ChangeEvent`):

```tsx
  const router = useRouter()
  const [metaOpen, setMetaOpen] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  async function onReplaceBody(e: ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]
    e.target.value = ''
    if (!f) return
    setErr(null)
    if (!/\.(md|markdown)$/i.test(f.name)) { setErr(t('min.err.bodyExt')); return }
    if (f.size > MINUTE_BODY_FILE_MAX) { setErr(t('min.err.bodyFileMax')); return }
    const text = await f.text()
    if (text.length > MINUTE_BODY_MAX) { setErr(t('min.err.bodyMax')); return }
    setBusy(true)
    try {
      const sb = createBrowserClient()
      const path = `${minute.id}/${Date.now()}-${sanitizeFileName(f.name)}`
      const up = await sb.storage.from('minutes').upload(path, f, { upsert: false })
      if (up.error) { setErr(`${t('min.err.upload')}: ${up.error.message}`); return }
      const res = await replaceMinuteBody(minute.id, text, {
        fileName: f.name, filePath: path, size: f.size, mime: f.type || 'text/markdown',
      })
      if (!res.ok) { await sb.storage.from('minutes').remove([path]); setErr(res.error ?? t('min.err.upload')); return }
      router.refresh()
    } finally { setBusy(false) }
  }

  async function onDelete() {
    if (!window.confirm(t('min.detail.deleteConfirm'))) return
    setBusy(true)
    const res = await deleteMinute(minute.id)
    setBusy(false)
    if (!res.ok) { setErr(res.error ?? 'error'); return }
    router.push('/minutes')
  }
```

메타 헤더 카드 하단에 `{err && <p className="text-sm text-delayed">{err}</p>}` 추가, 컴포넌트 마지막에 `<MinuteMetaModal open={metaOpen} onClose={() => setMetaOpen(false)} onSaved={() => { setMetaOpen(false); router.refresh() }} minute={minute} />` 추가.

참고: 기존 코드베이스는 브라우저 confirm 대신 Modal을 쓰는 관례가 있으나 삭제 확인 한 건에 별도 모달은 과함 — `window.confirm` 사용이 부담되면 Modal로 대체 가능(자유 재량).

- [ ] **Step 3: 빌드/린트 확인** — Run: `npm run build && npm run lint` / Expected: 성공

- [ ] **Step 4: Commit**

```bash
git add src/components/minutes/MinuteMetaModal.tsx src/components/minutes/MinuteViewer.tsx
git commit -m "feat(minutes): 뷰어 관리 액션 — 메타 수정·본문 교체·삭제"
```

### Task 12: Phase 1 통합 검증

- [ ] **Step 1: 전체 검증**

Run: `npm run build && npm run lint && npm test`
Expected: 모두 성공. 실패 시 해당 태스크로 돌아가 수정 후 재실행.

- [ ] **Step 2: 마이그레이션 적용 상태 확인** — 로컬 개발 DB가 프로덕션과 같으므로(단일 Supabase), **0021이 프로덕션에 아직 적용 전이면 /minutes 페이지는 빈 목록/400을 낼 수 있음**. 이 시점에 사용자에게 0021 적용 여부를 확인받는다 (적용 레시피는 Task 19).

- [ ] **Step 3: 커밋 로그 확인** — Run: `git log --oneline -8` / Expected: Task 1~11 커밋이 순서대로 존재.

---

# Phase 2 — 임베딩 인제스트 · LLM 질의

### Task 13: 마크다운 청크 분할기 (TDD)

**Files:**
- Create: `src/lib/ai/chunk.ts`
- Test: `tests/minutes/chunk.test.ts`

**Interfaces:**
- Produces: `chunkMarkdown(text: string, max?: number): string[]` — 기본 max=1500자, 헤딩 경계 우선 → 문단 경계 → 강제 절단. 빈/공백 청크 제외.

- [ ] **Step 1: 실패하는 테스트 작성** — `tests/minutes/chunk.test.ts`

```ts
import { describe, it, expect } from 'vitest'
import { chunkMarkdown } from '@/lib/ai/chunk'

describe('chunkMarkdown', () => {
  it('빈 문서 → 빈 배열', () => {
    expect(chunkMarkdown('')).toEqual([])
    expect(chunkMarkdown('   \n\n  ')).toEqual([])
  })
  it('짧은 문서는 청크 1개', () => {
    const md = '# 제목\n\n본문 한 줄'
    expect(chunkMarkdown(md)).toEqual([md.trim()])
  })
  it('헤딩 경계로 분할', () => {
    const a = `# 안건 1\n${'가'.repeat(1000)}`
    const b = `## 안건 2\n${'나'.repeat(1000)}`
    const out = chunkMarkdown(`${a}\n${b}`, 1500)
    expect(out).toHaveLength(2)
    expect(out[0].startsWith('# 안건 1')).toBe(true)
    expect(out[1].startsWith('## 안건 2')).toBe(true)
  })
  it('헤딩 없는 긴 문서는 문단 경계로 분할', () => {
    const p = '문단'.repeat(300) // 600자
    const out = chunkMarkdown([p, p, p, p].join('\n\n'), 1500)
    expect(out.length).toBeGreaterThanOrEqual(2)
    expect(out.every(c => c.length <= 1500)).toBe(true)
  })
  it('경계 없는 초장문은 강제 절단', () => {
    const out = chunkMarkdown('가'.repeat(4000), 1500)
    expect(out).toHaveLength(3)
    expect(out.every(c => c.length <= 1500)).toBe(true)
  })
})
```

- [ ] **Step 2: 실패 확인** — Run: `npm test -- tests/minutes/chunk.test.ts` / Expected: FAIL (`Cannot find module '@/lib/ai/chunk'`)

- [ ] **Step 3: 구현** — `src/lib/ai/chunk.ts` 전체:

```ts
/** 회의록 md 를 임베딩용 청크로 분할 — 헤딩 경계 우선, 넘치면 문단 경계, 최후엔 강제 절단. */
export function chunkMarkdown(text: string, max = 1500): string[] {
  const trimmed = text.trim()
  if (!trimmed) return []
  // 1) 헤딩 라인(#~######) 기준 섹션 분리
  const sections = trimmed.split(/\n(?=#{1,6}\s)/)
  const out: string[] = []
  for (const sec of sections) {
    if (sec.length <= max) { pushIf(out, sec); continue }
    // 2) 문단(빈 줄) 경계로 max 이하 누적
    let buf = ''
    for (const para of sec.split(/\n{2,}/)) {
      if (para.length > max) {
        pushIf(out, buf); buf = ''
        for (let i = 0; i < para.length; i += max) pushIf(out, para.slice(i, i + max)) // 3) 강제 절단
        continue
      }
      const joined = buf ? `${buf}\n\n${para}` : para
      if (joined.length > max) { pushIf(out, buf); buf = para } else { buf = joined }
    }
    pushIf(out, buf)
  }
  return out
}

function pushIf(arr: string[], s: string): void {
  const t = s.trim()
  if (t) arr.push(t)
}
```

- [ ] **Step 4: 통과 확인** — Run: `npm test -- tests/minutes/chunk.test.ts` / Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add src/lib/ai/chunk.ts tests/minutes/chunk.test.ts
git commit -m "feat(minutes): 마크다운 청크 분할기 + 테스트"
```

### Task 14: 인제스트 `minutes-ingest.ts` + after() 배선

**Files:**
- Create: `src/lib/ai/minutes-ingest.ts`
- Modify: `src/app/actions/minutes.ts` (`// [P2]` 주석 2곳을 실제 after() 호출로)

**Interfaces:**
- Consumes: `chunkMarkdown` (Task 13), `embedDocuments` (`@/lib/ai/embeddings`), `hasEmbeddings` (`@/lib/ai/provider`), `createAdminClient`
- Produces: `ingestMinute(minuteId: string, bodyMd: string): Promise<void>` (절대 throw 안 함), `healMissingMinuteEmbeddings(limit?: number): Promise<void>` (동일 계약, in-flight dedupe + 60초 쿨다운)

- [ ] **Step 1: 파일 작성** — `src/lib/ai/minutes-ingest.ts` 전체:

```ts
import { chunkMarkdown } from './chunk'
import { embedDocuments } from './embeddings'
import { hasEmbeddings } from './provider'
import { createAdminClient } from '@/lib/supabase/admin'

/** 회의록 1건 인제스트 — delete-and-reinsert. 실패는 로그만(업로드 성공에 영향 없음, self-heal 이 회수). */
export async function ingestMinute(minuteId: string, bodyMd: string): Promise<void> {
  try {
    if (!hasEmbeddings()) return
    if (!(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY)) return
    const chunks = chunkMarkdown(bodyMd)
    const admin = createAdminClient()
    // 본문이 비어도 기존 임베딩은 지운다(교체로 비워진 경우 스테일 방지).
    const { error: delErr } = await admin.from('minute_embeddings').delete().eq('minute_id', minuteId)
    if (delErr) { console.error('[minutes] 임베딩 삭제 실패:', delErr.message); return }
    if (chunks.length === 0) return
    const vectors = await embedDocuments(chunks, 'RETRIEVAL_DOCUMENT')
    if (!vectors) return
    const rows = chunks
      .map((content, i) => ({ content, v: vectors[i], i }))
      .filter((x): x is { content: string; v: number[]; i: number } => x.v !== null)
      .map(({ content, v, i }) => ({ minute_id: minuteId, chunk_index: i, content, embedding: v }))
    if (rows.length === 0) return
    const { error } = await admin.from('minute_embeddings').insert(rows)
    if (error) console.error('[minutes] 임베딩 기록 실패:', error.message)
  } catch (e) {
    console.error('[minutes] 인제스트 실패(무시):', e instanceof Error ? e.message : e)
  }
}

// archive 질의 시 임베딩 없는 회의록을 회의록 단위로 회수(anti-join). ensure-index 계약 미러.
let healInFlight: Promise<void> | null = null
let healLastAttempt = 0
const HEAL_COOLDOWN_MS = 60_000

export async function healMissingMinuteEmbeddings(limit = 3): Promise<void> {
  if (!hasEmbeddings()) return
  if (!(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY)) return
  if (healInFlight) return healInFlight
  if (Date.now() - healLastAttempt < HEAL_COOLDOWN_MS) return

  healInFlight = (async () => {
    try {
      healLastAttempt = Date.now()
      const admin = createAdminClient()
      // anti-join: 임베딩이 하나도 없는 회의록 id (본문 있는 것만)
      const { data: embedded } = await admin.from('minute_embeddings').select('minute_id')
      const has = new Set((embedded ?? []).map(r => r.minute_id as string))
      const { data: all } = await admin.from('minutes')
        .select('id, body_md').neq('body_md', '')
        .order('minute_date', { ascending: false }).limit(200)
      const missing = (all ?? []).filter(r => !has.has(r.id as string)).slice(0, limit)
      for (const r of missing) await ingestMinute(r.id as string, r.body_md as string)
      if (missing.length) console.warn(`[minutes] self-heal 인제스트: ${missing.length}건`)
    } catch (e) {
      console.error('[minutes] self-heal 실패(무시):', e instanceof Error ? e.message : e)
    } finally {
      healInFlight = null
    }
  })()
  return healInFlight
}
```

- [ ] **Step 2: after() 배선** — `src/app/actions/minutes.ts`: import에 `import { after } from 'next/server'`와 `import { ingestMinute } from '@/lib/ai/minutes-ingest'` 추가. `createMinute`의 `// [P2]` 주석을:

```ts
  after(() => ingestMinute(data.id as string, input.bodyMd))
```

`replaceMinuteBody`의 `// [P2]` 주석을:

```ts
  after(() => ingestMinute(id, bodyMd))
```

로 교체 (둘 다 `revalidatePath` 앞줄에 배치 — wbs.ts 선례는 revalidate 뒤였으나 순서 무관, return 전이기만 하면 됨. wbs.ts와 맞춰 revalidatePath 뒤에 두는 것을 권장).

- [ ] **Step 3: 빌드 확인** — Run: `npm run build && npm test` / Expected: 성공

- [ ] **Step 4: Commit**

```bash
git add src/lib/ai/minutes-ingest.ts src/app/actions/minutes.ts
git commit -m "feat(minutes): 임베딩 인제스트 + after() 배선 + 회의록 단위 self-heal"
```

### Task 15: 답변 파이프라인 `minutes-answer.ts`

**Files:**
- Create: `src/lib/ai/minutes-answer.ts`

**Interfaces:**
- Consumes: `generateAnswerStream`/`type ChatMessage` (`@/lib/ai/llm`), `hasLLM`/`hasEmbeddings` (`@/lib/ai/provider`), `embedTexts`, `extractSearchKeywords` (`@/lib/ai/intent`), `healMissingMinuteEmbeddings` (Task 14), `createServerClient`, `TeamCode`
- Produces: `streamDocAnswer(input: { minuteId: string; message: string; history: ChatMessage[] }): Promise<ReadableStream<Uint8Array> | null>` (null = 회의록 없음/접근 불가), `streamArchiveAnswer(input: { message: string; history: ChatMessage[]; filters: { team?: TeamCode | null; from?: string | null; to?: string | null } }): Promise<ReadableStream<Uint8Array>>`
- 출처 부기 포맷(스펙 §6.2-4 고정): `\n\n---\n출처:\n- {date} · {team} · {title} (/minutes/{id})`

- [ ] **Step 1: 파일 작성** — `src/lib/ai/minutes-answer.ts` 전체:

```ts
import { generateAnswerStream, type ChatMessage } from './llm'
import { hasLLM, hasEmbeddings } from './provider'
import { embedTexts } from './embeddings'
import { extractSearchKeywords } from './intent'
import { healMissingMinuteEmbeddings } from './minutes-ingest'
import { createServerClient } from '@/lib/supabase/server'
import type { TeamCode } from '@/lib/domain/types'

const DOC_SYSTEM = `너는 D'Flow 의 회의록 어시스턴트야. 아래 [회의록] 본문만 근거로 한국어로 간결하게 답한다.
규칙:
- [회의록]에 없는 내용은 모른다고 말한다. 임의로 지어내지 않는다.
- 요약·결정사항·액션아이템·참석자 추출 요청에는 불릿(•)으로 구조화해 답한다.
- 날짜·숫자·담당자는 본문 표기를 그대로 사용한다.
- 핵심부터, 군더더기 없이.`

const ARCHIVE_SYSTEM = `너는 D'Flow 의 회의록 보관함 어시스턴트야. 아래 [검색된 회의록]과 [키워드 정확 일치]만 근거로 한국어로 답한다.
규칙:
- 근거에 없는 내용은 모른다고 말한다.
- 어느 회의록(일자·담당·제목)에서 나온 내용인지 밝히며 답한다.
- 여러 회의록에 걸치면 회의록별로 불릿(•)으로 정리한다.`

const DEGRADED_NOTICE = '⚠ AI 응답이 잠시 원활하지 않아 검색 결과만 알려드려요. 잠시 후 다시 물어보세요.\n\n'

const MIN_SIMILARITY = (() => {
  const v = Number(process.env.DKBOT_MIN_SIMILARITY) // DK Bot 과 동일 규칙 복제(원본은 미export)
  return Number.isFinite(v) && v >= 0 && v <= 1 ? v : 0.35
})()

const trimHistory = (h: ChatMessage[]) => h.slice(-8)

interface MinuteMatch {
  minuteId: string; content: string; minuteDate: string; teamCode: string; title: string; similarity: number
}

function sourcesFooter(rows: { minuteId: string; minuteDate: string; teamCode: string; title: string }[]): string {
  if (!rows.length) return ''
  const seen = new Set<string>()
  const lines: string[] = []
  for (const r of rows) {
    if (seen.has(r.minuteId)) continue
    seen.add(r.minuteId)
    lines.push(`- ${r.minuteDate} · ${r.teamCode} · ${r.title} (/minutes/${r.minuteId})`)
  }
  return `\n\n---\n출처:\n${lines.join('\n')}`
}

function textStream(text: string): ReadableStream<Uint8Array> {
  const enc = new TextEncoder()
  return new ReadableStream({ start(c) { c.enqueue(enc.encode(text)); c.close() } })
}

/** LLM 스트림 + 폴백 + 후미(footer) 부기 — doc/archive 공용. */
function llmOrFallbackStream(
  system: string, history: ChatMessage[], message: string,
  fallbackText: string, footer: string,
): Promise<ReadableStream<Uint8Array>> {
  return (async () => {
    const enc = new TextEncoder()
    if (hasLLM()) {
      const iter = await generateAnswerStream(system, [...trimHistory(history), { role: 'user', content: message }])
      if (iter) {
        return new ReadableStream<Uint8Array>({
          async start(controller) {
            let any = false
            try {
              for await (const chunk of iter) { any = true; controller.enqueue(enc.encode(chunk)) }
            } catch (e) {
              console.error('[minutes] 스트리밍 오류:', e)
              if (any) controller.enqueue(enc.encode('\n\n⚠ 답변이 도중에 끊겼어요. 다시 시도해 주세요.'))
            }
            if (!any) controller.enqueue(enc.encode(DEGRADED_NOTICE + fallbackText))
            if (footer) controller.enqueue(enc.encode(footer))
            controller.close()
          },
        })
      }
    }
    return textStream(fallbackText + footer)
  })()
}

/** 문서 모드 — 열려 있는 회의록 전문 주입. 회의록 없음/미접근 시 null. */
export async function streamDocAnswer(input: {
  minuteId: string; message: string; history: ChatMessage[]
}): Promise<ReadableStream<Uint8Array> | null> {
  const sb = await createServerClient() // RLS 적용
  const { data: r } = await sb.from('minutes')
    .select('id, minute_date, team_code, title, body_md')
    .eq('id', input.minuteId).maybeSingle()
  if (!r) return null

  const system = `${DOC_SYSTEM}\n\n[회의록] ${r.minute_date} · ${r.team_code} · ${r.title}\n${r.body_md as string}`
  // 폴백: 문서 내 키워드 일치 줄 발췌
  const keywords = extractSearchKeywords(input.message)
  const lines = (r.body_md as string).split('\n')
  const hits = keywords.length
    ? lines.filter(l => keywords.some(k => l.toLowerCase().includes(k))).slice(0, 8)
    : []
  const fallback = hits.length
    ? `문서에서 일치하는 줄이에요:\n${hits.map(h => `• ${h.trim()}`).join('\n')}`
    : 'AI 응답을 사용할 수 없어요. 본문을 직접 확인해 주세요.'
  return llmOrFallbackStream(system, input.history, input.message, fallback, '')
}

/** 보관함 모드 — 벡터 검색 + 키워드 정확 일치, 출처 부기. */
export async function streamArchiveAnswer(input: {
  message: string; history: ChatMessage[]
  filters: { team?: TeamCode | null; from?: string | null; to?: string | null }
}): Promise<ReadableStream<Uint8Array>> {
  const sb = await createServerClient()
  await healMissingMinuteEmbeddings() // 회의록 단위 갭 회수(쿨다운·dedupe 내장, 절대 throw 안 함)

  // 1) 벡터 검색
  let matches: MinuteMatch[] = []
  if (hasEmbeddings()) {
    const vecs = await embedTexts([input.message], 'RETRIEVAL_QUERY')
    if (vecs?.[0]?.length) {
      const { data, error } = await sb.rpc('match_minute_documents', {
        query_embedding: vecs[0], match_count: 8,
        p_team: input.filters.team ?? null,
        p_date_from: input.filters.from ?? null,
        p_date_to: input.filters.to ?? null,
      })
      if (error) console.error('[minutes] match_minute_documents 실패:', error.message)
      matches = ((data as Record<string, unknown>[] | null) ?? [])
        .filter(m => (m.similarity as number) >= MIN_SIMILARITY)
        .map(m => ({
          minuteId: m.minute_id as string, content: m.content as string,
          minuteDate: m.minute_date as string, teamCode: m.team_code as string,
          title: m.title as string, similarity: m.similarity as number,
        }))
    }
  }

  // 2) 키워드 정확 일치(제목/본문 ILIKE) — "X 들어간 회의록" 대응
  const keywords = extractSearchKeywords(input.message)
  let keywordRows: { minuteId: string; minuteDate: string; teamCode: string; title: string }[] = []
  if (keywords.length) {
    const esc = keywords[0].replace(/[%_]/g, ch => `\\${ch}`)
    let q = sb.from('minutes').select('id, minute_date, team_code, title')
      .or(`title.ilike.%${esc}%,body_md.ilike.%${esc}%`)
      .order('minute_date', { ascending: false }).limit(10)
    if (input.filters.team) q = q.eq('team_code', input.filters.team)
    const { data } = await q
    keywordRows = (data ?? []).map(r => ({
      minuteId: r.id as string, minuteDate: r.minute_date as string,
      teamCode: r.team_code as string, title: r.title as string,
    }))
  }

  // 3) 컨텍스트 조립
  const blocks: string[] = []
  if (keywordRows.length) {
    blocks.push(`[키워드 정확 일치: "${keywords[0]}"]\n${keywordRows
      .map(r => `- ${r.minuteDate} · ${r.teamCode} · ${r.title}`).join('\n')}`)
  }
  if (matches.length) {
    blocks.push(`[검색된 회의록]\n${matches
      .map(m => `[회의록: ${m.minuteDate} · ${m.teamCode} · ${m.title}]\n${m.content}`).join('\n---\n')}`)
  }
  const system = `${ARCHIVE_SYSTEM}\n\n${blocks.length ? blocks.join('\n\n') : '[검색된 회의록]\n(없음)'}`

  // 4) 폴백 + 출처
  const sourceRows = [...keywordRows, ...matches]
  const footer = sourcesFooter(sourceRows)
  const fallback = sourceRows.length
    ? `관련 회의록이에요:\n${[...new Set(sourceRows.map(r => `• ${r.minuteDate} · ${r.teamCode} · ${r.title}`))].join('\n')}`
    : '관련 회의록을 찾지 못했어요. 담당·기간 필터를 넓히거나 다른 표현으로 물어보세요.'
  return llmOrFallbackStream(system, input.history, input.message, fallback, footer)
}
```

- [ ] **Step 2: 빌드 확인** — Run: `npm run build` / Expected: 성공

- [ ] **Step 3: Commit**

```bash
git add src/lib/ai/minutes-answer.ts
git commit -m "feat(minutes): doc/archive 답변 파이프라인 — RAG+키워드+출처 부기+정직한 폴백"
```

### Task 16: 채팅 API `/api/minutes/chat`

**Files:**
- Create: `src/app/api/minutes/chat/route.ts`

**Interfaces:**
- Consumes: `streamDocAnswer`/`streamArchiveAnswer` (Task 15), `sanitizeHistory` (`@/lib/ai/answer` — 12개 메시지·4,000자 캡), `getSession`, `TEAM_CODES`
- Produces: `POST { mode: 'doc'|'archive', minuteId?, message, history?, filters? }` → text/plain 스트림. AI 실패는 폴백 텍스트(500 금지); 500은 예기치 못한 서버 오류만.

- [ ] **Step 1: 라우트 작성** — `src/app/api/minutes/chat/route.ts` 전체:

```ts
import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { sanitizeHistory } from '@/lib/ai/answer'
import { streamDocAnswer, streamArchiveAnswer } from '@/lib/ai/minutes-answer'
import { TEAM_CODES } from '@/lib/domain/minutes'
import type { TeamCode } from '@/lib/domain/types'

export const dynamic = 'force-dynamic'

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

/** 회의록 Q&A 스트리밍(text/plain). mode=doc(문서 전문) | archive(RAG+키워드). */
export async function POST(req: NextRequest) {
  if (!(await getSession())) return NextResponse.json({ error: '인증이 필요합니다.' }, { status: 401 })

  let body: {
    mode?: unknown; minuteId?: unknown; message?: unknown; history?: unknown
    filters?: { team?: unknown; from?: unknown; to?: unknown }
  }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: '잘못된 요청입니다.' }, { status: 400 })
  }

  const message = typeof body.message === 'string' ? body.message.trim() : ''
  if (!message) return NextResponse.json({ error: '질문을 입력하세요.' }, { status: 400 })
  if (message.length > 2000) return NextResponse.json({ error: '질문이 너무 깁니다.' }, { status: 400 })
  const history = sanitizeHistory(body.history)
  const headers = {
    'Content-Type': 'text/plain; charset=utf-8',
    'Cache-Control': 'no-store, no-transform',
    'X-Accel-Buffering': 'no',
  }

  try {
    if (body.mode === 'doc') {
      const minuteId = typeof body.minuteId === 'string' ? body.minuteId : ''
      if (!minuteId) return NextResponse.json({ error: 'minuteId가 필요합니다.' }, { status: 400 })
      const stream = await streamDocAnswer({ minuteId, message, history })
      if (!stream) return NextResponse.json({ error: '회의록을 찾을 수 없습니다.' }, { status: 404 })
      return new Response(stream, { headers })
    }
    if (body.mode === 'archive') {
      const f = body.filters ?? {}
      const team = typeof f.team === 'string' && (TEAM_CODES as string[]).includes(f.team)
        ? (f.team as TeamCode) : null
      const from = typeof f.from === 'string' && DATE_RE.test(f.from) ? f.from : null
      const to = typeof f.to === 'string' && DATE_RE.test(f.to) ? f.to : null
      const stream = await streamArchiveAnswer({ message, history, filters: { team, from, to } })
      return new Response(stream, { headers })
    }
    return NextResponse.json({ error: 'mode 는 doc|archive 여야 합니다.' }, { status: 400 })
  } catch (e) {
    console.error('[minutes] /api/minutes/chat 오류:', e)
    return NextResponse.json({ error: '답변 생성 중 오류가 발생했습니다.' }, { status: 500 })
  }
}
```

- [ ] **Step 2: 빌드 확인** — Run: `npm run build` / Expected: 성공, 라우트 `/api/minutes/chat` 생성.

- [ ] **Step 3: curl 스모크 (미인증 401)**

Run: `npm run dev` 백그라운드 기동 후
`curl -s -o /dev/null -w '%{http_code}' -X POST localhost:3000/api/minutes/chat -H 'Content-Type: application/json' -d '{"mode":"doc","minuteId":"x","message":"hi"}'`
Expected: `401` (세션 쿠키 없음). 확인 후 dev 서버 종료.

- [ ] **Step 4: Commit**

```bash
git add src/app/api/minutes/chat/route.ts
git commit -m "feat(minutes): 채팅 API — doc/archive 모드 스트리밍"
```

### Task 17: 뷰어 채팅 패널 `MinuteChatPanel` (doc 모드)

**Files:**
- Create: `src/components/minutes/MinuteChatPanel.tsx`
- Modify: `src/components/minutes/MinuteViewer.tsx` (본문 우측 배치)

**Interfaces:**
- Consumes: `/api/minutes/chat` (Task 16), dict `min.chat.*`
- Produces: `MinuteChatPanel({ minuteId })` — DkBot 스트림 수신 패턴(getReader 누적) 재사용. 어시스턴트 말풍선은 **plain text**(whitespace-pre-wrap), 링크화 없음(doc 모드는 출처 부기 없음).

- [ ] **Step 1: 패널 작성** — `src/components/minutes/MinuteChatPanel.tsx` 전체:

```tsx
'use client'
import { useRef, useState } from 'react'
import { MessageCircle, Send, X } from 'lucide-react'
import { useLocale } from '@/components/providers/LocaleProvider'

type Msg = { id: number; role: 'user' | 'assistant'; content: string }

/** 회의록 채팅 공용 훅 — mode/필터만 다른 doc·archive 패널이 공유. */
export function useMinutesChat(buildBody: (message: string, history: Msg[]) => object) {
  const { t } = useLocale()
  const [messages, setMessages] = useState<Msg[]>([])
  const [loading, setLoading] = useState(false)
  const idRef = useRef(0)
  const nextId = () => (idRef.current += 1)

  async function send(raw: string) {
    const text = raw.trim()
    if (!text || loading) return
    const history = messages.map(m => ({ role: m.role, content: m.content }))
    setMessages(prev => [...prev, { id: nextId(), role: 'user', content: text }])
    setLoading(true)
    let asstId: number | null = null
    try {
      const res = await fetch('/api/minutes/chat', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(buildBody(text, history as Msg[])),
      })
      if (!res.ok || !res.body) {
        const data = (await res.json().catch(() => ({}))) as { error?: string }
        setMessages(prev => [...prev, { id: nextId(), role: 'assistant', content: data.error ?? t('min.chat.error') }])
        return
      }
      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let acc = ''
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        acc += decoder.decode(value, { stream: true })
        if (asstId === null) {
          const id = nextId(); asstId = id
          setMessages(prev => [...prev, { id, role: 'assistant', content: acc }])
        } else {
          const id = asstId
          setMessages(prev => prev.map(m => (m.id === id ? { ...m, content: acc } : m)))
        }
      }
      if (asstId === null) setMessages(prev => [...prev, { id: nextId(), role: 'assistant', content: t('min.chat.empty') }])
    } catch {
      setMessages(prev => [...prev, { id: nextId(), role: 'assistant', content: t('min.chat.error') }])
    } finally { setLoading(false) }
  }
  return { messages, loading, send }
}

/** 어시스턴트/사용자 말풍선 — plain text. renderContent 로 링크화 주입 가능(archive 전용). */
export function ChatBubble({ role, content, renderContent }: {
  role: 'user' | 'assistant'; content: string
  renderContent?: (content: string) => React.ReactNode
}) {
  const isUser = role === 'user'
  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div className={`max-w-[92%] whitespace-pre-wrap rounded-2xl px-3 py-2 text-[13px] leading-relaxed ${
        isUser ? 'rounded-br-md bg-brand text-white' : 'rounded-bl-md border border-brand-ring/30 bg-brand-weak/50 text-ink'
      }`}>
        {!isUser && renderContent ? renderContent(content) : content}
      </div>
    </div>
  )
}

export function ChatComposer({ onSend, loading }: { onSend: (v: string) => void; loading: boolean }) {
  const { t } = useLocale()
  const [value, setValue] = useState('')
  const composingRef = useRef(false)
  function submit() {
    if (composingRef.current) return
    onSend(value); setValue('')
  }
  return (
    <div className="flex items-center gap-1.5 border-t border-line p-2">
      <input value={value} onChange={e => setValue(e.target.value)}
        onCompositionStart={() => { composingRef.current = true }}
        onCompositionEnd={() => { composingRef.current = false }}
        onKeyDown={e => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) submit() }}
        placeholder={t('min.chat.placeholder')} className="app-input h-9 flex-1" />
      <button onClick={submit} disabled={loading} className="btn btn-primary h-9 px-2.5" aria-label={t('min.chat.send')}>
        <Send className="h-4 w-4" />
      </button>
    </div>
  )
}

/** 문서 모드 패널 — 뷰어 우측(좁은 화면에선 아래). */
export function MinuteChatPanel({ minuteId }: { minuteId: string }) {
  const { t } = useLocale()
  const [open, setOpen] = useState(true)
  const { messages, loading, send } = useMinutesChat((message, history) => ({
    mode: 'doc', minuteId, message, history,
  }))
  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="btn self-start">
        <MessageCircle className="h-4 w-4" />{t('min.chat.doc.title')}
      </button>
    )
  }
  return (
    <aside className="card flex h-[560px] w-full flex-col lg:w-[340px] lg:shrink-0">
      <div className="flex items-center justify-between border-b border-line px-3 py-2">
        <span className="inline-flex items-center gap-1.5 text-sm font-semibold">
          <MessageCircle className="h-4 w-4 text-brand" />{t('min.chat.doc.title')}
        </span>
        <button onClick={() => setOpen(false)} className="text-ink-subtle hover:text-ink" aria-label="close">
          <X className="h-4 w-4" />
        </button>
      </div>
      <div className="flex-1 space-y-2 overflow-y-auto p-3">
        {messages.map(m => <ChatBubble key={m.id} role={m.role} content={m.content} />)}
      </div>
      <ChatComposer onSend={send} loading={loading} />
    </aside>
  )
}
```

- [ ] **Step 2: 뷰어 배치** — `MinuteViewer.tsx`의 본문 카드 블록을 다음 구조로 감싸고 `import { MinuteChatPanel } from './MinuteChatPanel'` 추가:

```tsx
      <div className="flex flex-col gap-4 lg:flex-row">
        <div className="card min-w-0 flex-1 p-5">
          <MarkdownView content={minute.bodyMd} />
        </div>
        <MinuteChatPanel minuteId={minute.id} />
      </div>
```

- [ ] **Step 3: 빌드 확인** — Run: `npm run build && npm run lint` / Expected: 성공

- [ ] **Step 4: Commit**

```bash
git add src/components/minutes/MinuteChatPanel.tsx src/components/minutes/MinuteViewer.tsx
git commit -m "feat(minutes): 뷰어 우측 문서 채팅 패널 (스트리밍)"
```

### Task 18: 보관함 채팅 패널 `ArchiveChatPanel` (archive 모드 + 내부 링크화)

**Files:**
- Create: `src/components/minutes/ArchiveChatPanel.tsx`
- Modify: `src/components/minutes/MinutesView.tsx` (열기 버튼 + 패널)

**Interfaces:**
- Consumes: `useMinutesChat`/`ChatBubble`/`ChatComposer` (Task 17), 현재 담당 탭·표시 월(필터 전달)
- Produces: `ArchiveChatPanel({ open, onClose, team, from, to })` — 슬라이드 오버. **링크화 규칙(스펙 §6.2-5):** 어시스턴트 답변은 plain text로 두되, 정규식 `/\/minutes\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g`에 정확히 일치하는 내부 경로만 `<Link>`로 변환. 외부 URL·마크다운은 링크화하지 않는다.

- [ ] **Step 1: 패널 작성** — `src/components/minutes/ArchiveChatPanel.tsx` 전체:

```tsx
'use client'
import Link from 'next/link'
import { MessageCircle, X } from 'lucide-react'
import type { TeamCode } from '@/lib/domain/types'
import { useLocale } from '@/components/providers/LocaleProvider'
import { ChatBubble, ChatComposer, useMinutesChat } from './MinuteChatPanel'

const MINUTE_PATH_RE = /\/minutes\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g

/** 내부 /minutes/<uuid> 경로만 링크화 — 외부 URL·md 링크는 그대로 텍스트(피싱 표면 차단). */
function linkifyMinutePaths(content: string): React.ReactNode {
  const parts: React.ReactNode[] = []
  let last = 0
  for (const m of content.matchAll(MINUTE_PATH_RE)) {
    const i = m.index ?? 0
    if (i > last) parts.push(content.slice(last, i))
    parts.push(
      <Link key={`${i}-${m[0]}`} href={m[0]} className="font-medium text-brand underline underline-offset-2">
        {m[0]}
      </Link>,
    )
    last = i + m[0].length
  }
  if (last < content.length) parts.push(content.slice(last))
  return parts
}

export function ArchiveChatPanel({
  open, onClose, team, from, to,
}: {
  open: boolean
  onClose: () => void
  team: TeamCode | null
  from: string | null
  to: string | null
}) {
  const { t } = useLocale()
  const { messages, loading, send } = useMinutesChat((message, history) => ({
    mode: 'archive', message, history, filters: { team, from, to },
  }))
  if (!open) return null
  return (
    <div className="fixed inset-y-0 right-0 z-40 flex w-full max-w-md flex-col border-l border-line bg-surface shadow-xl">
      <div className="flex items-center justify-between border-b border-line px-4 py-3">
        <span className="inline-flex items-center gap-1.5 text-sm font-semibold">
          <MessageCircle className="h-4 w-4 text-brand" />{t('min.chat.archive.title')}
        </span>
        <button onClick={onClose} className="text-ink-subtle hover:text-ink" aria-label="close">
          <X className="h-4 w-4" />
        </button>
      </div>
      <div className="flex-1 space-y-2 overflow-y-auto p-3">
        {messages.map(m => (
          <ChatBubble key={m.id} role={m.role} content={m.content} renderContent={linkifyMinutePaths} />
        ))}
      </div>
      <ChatComposer onSend={send} loading={loading} />
    </div>
  )
}
```

- [ ] **Step 2: MinutesView 배선** — 상태 `const [chatOpen, setChatOpen] = useState(false)` 추가, 필터 바의 업로드 버튼 앞에:

```tsx
          <button onClick={() => setChatOpen(true)} className="btn">
            <MessageCircle className="h-4 w-4" />{t('min.chat.archive.title')}
          </button>
```

컴포넌트 끝에 (현재 표시 월을 필터로 전달, 검색 중엔 전 기간):

```tsx
      <ArchiveChatPanel open={chatOpen} onClose={() => setChatOpen(false)}
        team={teamOrNull}
        from={isSearch ? null : monthRangeOf(year, month0)[0]}
        to={isSearch ? null : monthRangeOf(year, month0)[1]} />
```

`import { MessageCircle } from 'lucide-react'`(기존 import에 추가), `import { ArchiveChatPanel } from './ArchiveChatPanel'` 추가.

- [ ] **Step 3: 빌드 확인** — Run: `npm run build && npm run lint` / Expected: 성공

- [ ] **Step 4: Commit**

```bash
git add src/components/minutes/ArchiveChatPanel.tsx src/components/minutes/MinutesView.tsx
git commit -m "feat(minutes): 보관함 채팅 패널 — archive RAG + 내부 경로만 링크화"
```

### Task 19: 최종 검증 · 배포

- [ ] **Step 1: 전체 검증** — Run: `npm run build && npm run lint && npm test` / Expected: 모두 성공

- [ ] **Step 2: 마이그레이션 0021 프로덕션 적용** — **사용자 확인 후 진행.** 기존 레시피(메모리 rls-helper-drift / 0013 헤더): Management API `POST /v1/projects/rglfgrwwwwdqejohdnty/database/query`에 `0021_minutes.sql` 본문을 전달 (토큰은 키체인). 적용 후 확인 쿼리: `select count(*) from minutes;` → 0.

- [ ] **Step 3: 코드 배포** — **마이그레이션 적용 후에만.** main 푸시 → Vercel 자동 배포 (또는 `/deploy` 스킬).

- [ ] **Step 4: 프로덕션 스모크** — 배포 URL에서: (1) 사이드바 '회의록' 진입 → 빈 목록, (2) .md 업로드 → 리스트/달력 표시, (3) 뷰어 렌더(표·체크리스트) + 원본 다운로드, (4) 문서 채팅 질의 응답, (5) 보관함 채팅 → 출처 링크 클릭 이동, (6) 메타 수정·본문 교체·삭제. 결과를 사용자에게 보고.

---

## Self-Review 결과 (계획 작성 후 점검)

- **스펙 커버리지:** §3 데이터 모델→Task 1, §4 업로드/수정→Task 2·5·9·11, §5 UI→Task 3·6·7·8·10, §6 LLM→Task 13~18, §7 에러→각 액션·모달 내, §8 테스트→Task 2·13·12·19, §9 배포→Task 19, minutesView 복원→Task 7(page.tsx getUiPrefs). 갭 없음.
- **플레이스홀더:** Task 7의 달력/업로드 플레이스홀더와 `{void …}` 줄은 Task 8·9가 명시적으로 제거 — 의도된 중간 상태.
- **타입 일관성:** `MinuteInput`(domain) ↔ 액션 시그니처, `Minute.fileCount?`/`MinuteFile.url?` 옵셔널, `useMinutesChat`/`ChatBubble`/`ChatComposer`는 Task 17 정의를 Task 18이 그대로 소비. RPC 반환 컬럼(minute_id/minute_date/team_code/title/similarity)은 Task 1 SQL과 Task 15 매핑 일치.

