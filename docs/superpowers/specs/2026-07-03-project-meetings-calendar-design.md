# 회의 일정·참석자 관리 (달력) — 설계

- 날짜: 2026-07-03
- 대상: wbs-web (D'Flow)
- 상태: 승인됨 (구현 대기)
- 선행 검증: 3-비평가 워크플로우(반복 모델·크로스프로젝트 식별·권한/RLS) 모두 "sound-with-fixes" — 아래 결정에 반영 완료.

## 1. 목표와 범위

프로젝트 진행 중 잦은 회의의 **일정과 참석자**를 달력으로 관리한다. 기존 근태현황(attendance) 캘린더와 동일한 UX·컴포넌트 패턴을 재사용해 학습비용 없이 붙인다.

두 개의 화면:

1. **프로젝트 회의** — `/(app)/p/[projectId]/meetings`. 해당 프로젝트 회의만. Sidebar/모바일 메뉴/브레드크럼에 "회의" 섹션으로 등록.
2. **내 회의** — `/(app)/meetings`. 내가 주최했거나 참석자로 포함된 모든 프로젝트 회의를 하나의 달력에. 기본값 **"내 것만" ON**, "전체 프로젝트" 토글 제공. 프로젝트별 색상 구분.

두 화면 공통: **월간 그리드 ↔ 리스트** 토글(`SegmentedTabs`), 날짜 클릭 → 그날 회의 목록 패널, 회의 클릭 → 상세/편집 모달.

### 1.1 v1 범위 밖 (명시적 보류)

- 회차별 개별 편집/이동 (v1은 **취소만** 지원)
- 참석 수락/거절(RSVP) 응답
- `project_members.user_id` auth 링크 컬럼 (이메일 매칭이 실제로 문제될 때 도입)
- 회의록(body) DK Bot RAG 색인
- 주간 타임그리드(시간축) 뷰

## 2. 데이터 모델 — 마이그레이션 `0013_meetings.sql`

announcements(0012)의 관례를 그대로 따른다: 멱등 DDL(`create table if not exists`, `drop policy if exists` 후 `create policy`), snake_case, uuid PK, `on delete cascade`, **updated_at 트리거 없음**(서버 액션에서 수동 갱신), 소프트 삭제 없음. 적용은 Supabase Management API `POST /v1/projects/<ref>/database/query` (SUPABASE_DB_URL 비어 있음, db push 없음). 파일 헤더에 0012식 주석(app_role 드리프트 경고 + 권한 모델 요약) 포함.

### 2.1 `meetings`

```sql
create table if not exists meetings (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  title text not null,
  meeting_date date not null,                 -- 시리즈의 첫(앵커) 회차
  start_time text,                            -- 'HH:MM' 24h; NULL = 종일(all-day)
  end_time text,
  location text,
  category text not null default 'general'
    check (category in ('general','routine','kickoff','review','report','external')),
  body text not null default '',              -- 회의록/메모
  recurrence text not null default 'none'
    check (recurrence in ('none','daily','weekly','biweekly','monthly')),
  recurrence_until date,                      -- 포함(inclusive) 종료일; recurrence='none'이면 NULL
  created_by uuid references auth.users(id) on delete set null,
  created_by_name text,                       -- 작성/표시용 스냅샷(auth.users 조인 회피)
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint meetings_start_time_fmt check (start_time is null or start_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  constraint meetings_end_time_fmt   check (end_time  is null or end_time  ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  constraint meetings_time_order     check (end_time is null or (start_time is not null and end_time > start_time)),
  constraint meetings_recur_until    check (recurrence_until is null or recurrence_until >= meeting_date),
  constraint meetings_recur_none     check (recurrence <> 'none' or recurrence_until is null)
);
create index if not exists meetings_project_idx on meetings(project_id, meeting_date);
```

- **종일 회의의 단일 진실**: `start_time IS NULL`. 별도 `is_all_day` 컬럼을 두지 않는다(두 소스가 모순될 여지 제거).
- 하루 안 정렬 순서: **종일(null start) 먼저, 그다음 start_time 오름차순**. 포맷 CHECK가 있어 문자열 비교가 안전하다.
- `created_by_name`은 생성 액션에서 `getSession()`의 이메일/이름으로 채운다(다른 사용자의 auth.users는 anon 클라이언트로 조회 불가하므로 표시용 스냅샷 필요).

### 2.2 `meeting_attendees` (시리즈 단위 참석자)

```sql
create table if not exists meeting_attendees (
  meeting_id uuid not null references meetings(id) on delete cascade,
  member_id  uuid not null references project_members(id) on delete cascade,
  primary key (meeting_id, member_id)
);
```

- 참석자는 근태와 동일하게 **project_members 로스터**(auth 비연동, 외부 인력 포함)를 참조한다. `memberships`가 아니다.
- 참석자는 **시리즈 전체**에 적용(회차별 참석자 v1 미지원).

### 2.3 `meeting_exceptions` (특정 회차 취소)

```sql
create table if not exists meeting_exceptions (
  meeting_id uuid not null references meetings(id) on delete cascade,
  occurrence_date date not null,
  kind text not null default 'cancelled' check (kind in ('cancelled')),
  primary key (meeting_id, occurrence_date)
);
```

- 반복 시리즈의 **한 회차만 건너뛰기**. `(meeting_id, occurrence_date)` 자연키가 유효한 이유: 네 가지 규칙 모두 날짜당 최대 1회차이므로.
- `kind` check 컬럼은 향후 'moved'/'modified' 확장 여지를 남겨두되 v1은 'cancelled'만.

### 2.4 0011 미완 정리 동반 (email의 조인 키 승격)

이 기능에서 `project_members.email`이 **표시 필드 → 본인 식별 조인 키**로 승격되므로, 같은 마이그레이션(또는 같은 Management API 세션)에서 멱등하게:

```sql
create index if not exists project_members_email_lower_idx on project_members (lower(email));
```

(선택) 0011의 보류된 백필 — 잘못된 형식 이메일 null 처리 + 제약 validate. 프로덕션 데이터 확인 후 결정.

## 3. RLS 정책 (권한: 모두 등록 / 본인 수정)

앱 최초의 **사용자 생성 콘텐츠**. 소유자 기반 쓰기를 채택한다(pmo_admin 전용으로 두면 team_editor가 회의를 만들 수 없어 기능이 무의미). 예약어 드리프트 재발을 막기 위해 **새 SQL 헬퍼 함수를 만들지 않고** `(created_by = auth.uid() or app_role() = 'pmo_admin')` 한 식을 명시적으로 반복한다.

```sql
alter table meetings           enable row level security;
alter table meeting_attendees  enable row level security;
alter table meeting_exceptions enable row level security;

-- 읽기: 로그인 사용자 전체(게스트 포함) — 앱 전역 관례
drop policy if exists read_all_meetings on meetings;
create policy read_all_meetings on meetings for select to authenticated using (true);

-- 생성: 멤버 본인만 (게스트=app_role() NULL 은 생성 불가; 앱 전역 '읽기는 게스트, 쓰기는 멤버' 불변식)
drop policy if exists insert_own_meetings on meetings;
create policy insert_own_meetings on meetings
  for insert to authenticated
  with check (created_by = auth.uid() and app_role() is not null);

-- 수정: 작성자 또는 pmo_admin (using + with check 모두 명시 — 암묵 기본값 의존 금지)
drop policy if exists update_own_meetings on meetings;
create policy update_own_meetings on meetings
  for update to authenticated
  using (created_by = auth.uid() or app_role() = 'pmo_admin')
  with check (created_by = auth.uid() or app_role() = 'pmo_admin');

-- 삭제: 작성자 또는 pmo_admin
drop policy if exists delete_own_meetings on meetings;
create policy delete_own_meetings on meetings
  for delete to authenticated
  using (created_by = auth.uid() or app_role() = 'pmo_admin');
```

자식 테이블(참석자·예외)은 **부모 회의의 소유권을 EXISTS로 미러링**한다. (읽기는 부모와 동일하게 전체 허용; 쓰기는 부모 소유자/관리자만 — 직접 PostgREST로 남의 회의에 참석자·취소행을 주입하는 것을 차단.) `meetings`의 select 정책이 `using(true)`라 EXISTS가 항상 평가 가능.

```sql
drop policy if exists read_all_meeting_attendees on meeting_attendees;
create policy read_all_meeting_attendees on meeting_attendees for select to authenticated using (true);

drop policy if exists own_write_meeting_attendees on meeting_attendees;
create policy own_write_meeting_attendees on meeting_attendees
  for all to authenticated
  using (exists (select 1 from meetings m where m.id = meeting_id
                 and (m.created_by = auth.uid() or app_role() = 'pmo_admin')))
  with check (exists (select 1 from meetings m where m.id = meeting_id
                 and (m.created_by = auth.uid() or app_role() = 'pmo_admin')));
-- meeting_exceptions 동일 패턴(read_all_* / own_write_*)
```

- `created_by`는 insert 후 **불변**으로 취급(update 액션의 SET에 절대 포함하지 않음). NULL created_by(탈퇴자 시리즈)는 pmo_admin만 수정/삭제; insert 시 NULL은 `created_by = auth.uid()`가 거부.
- 프로젝트 간 생성(A팀 편집자가 project B 회의 생성)은 앱의 글로벌 role 모델상 제한하지 않는다(문서화된 결정). UI가 현재 프로젝트 페이지로 생성 범위를 자연히 좁힌다.

## 4. 반복 회의 — "읽기 시점 전개" (materialize 안 함)

행을 미리 만들지 않고, 순수 도메인 함수가 **화면 범위 안에서만** 회차를 전개한다. 이 앱의 규모(내부 PMO, 시리즈 수백 개 이하, 42일 창)에서 전개는 마이크로초 단위이며 모든 정합 로직이 단위 테스트되는 순수 도메인 계층에 남는다.

### 4.1 핵심 함수 (`src/lib/domain/meetings.ts`)

```
expandMeetings(meetings, exceptions, gridStartIso, gridEndIso): MeetingOccurrence[]
```

`MeetingOccurrence`는 UI가 한 번에 필요한 모든 것을 담는다:
- `occurrenceId = `${seriesId}:${occurrenceDate}`` — **React key이자 "이 회차만 취소"의 키**
- `seriesId`(= meetings.id), `occurrenceDate`('YYYY-MM-DD'), 원본 필드(title, startTime, endTime, category, recurrence, ...), `isRecurring`, `projectId`

계약(단위 테스트로 고정):
1. `[gridStart, gridEnd]` **밖의 회차는 절대 방출하지 않음**.
2. **시리즈당 하드캡**(예: 366회) — `recurrence_until` NULL이어도 무한 루프 불가.
3. rangeStart로 **산술 fast-forward**(epoch-day 계산)로 O(range), O(age) 아님.
4. **매월 31일 규칙**: 31일이 없는 달은 **건너뜀**(RFC5545/구글 캘린더 방식). `new Date(Date.UTC(y, m0+k, day))` 후 `getUTCMonth() === (m0+k)%12` 검증, 아니면 skip. Jan-31 monthly가 Feb를 건너뛰고, 윤년 Feb-29를 포함하는 케이스 테스트.
5. **격주**: 유효 회차 iff `(epochDays(occ) - epochDays(meeting_date)) % 14 === 0`. 앵커는 시작일(ISO 주차 아님). 연 경계 넘는 격주 시리즈 테스트.
6. `recurrence_until`은 **포함(inclusive)**. until이 정확히 회차에 떨어지는 테스트.
7. 취소는 `exceptions`의 `(meeting_id, occurrence_date)` 매칭으로 제외.

DST는 무관(Asia/Seoul은 1988년 이후 고정 UTC+9, DST 없음). occurrence는 순수 'YYYY-MM-DD' 달력 날짜(`monthMatrix`와 동일한 Date.UTC 연산), 'HH:MM'는 표시 텍스트. **시각은 서울 벽시계 기준, 원격 참석자용 변환 없음**(단순성을 위한 의도적 제약) — JSDoc에 명시.

### 4.2 데이터 fetch 조건 (핵심 함정)

`monthMatrix`의 첫 셀 `matrix[0][0]`과 마지막 셀 `matrix[5][6]`을 grid 범위로 사용(월 1일/말일 아님 — 앞뒤 달 넘침 셀 포함). 쿼리 조건:

- 비반복: `meeting_date` between `[gridStart, gridEnd]`
- 반복: `meeting_date <= gridEnd AND (recurrence_until IS NULL OR recurrence_until >= gridStart)`

supabase-js `.or()`:
```
and(recurrence.eq.none,meeting_date.gte.<start>,meeting_date.lte.<end>),
and(recurrence.neq.none,meeting_date.lte.<end>,or(recurrence_until.is.null,recurrence_until.gte.<start>))
```
(순진하게 `meeting_date` between으로만 필터하면 과거에 만든 주간 회의가 이번 달 뷰에서 통째로 사라지는 blocker — 반드시 위 조건.)

### 4.3 시리즈 규칙/시작일 수정 시 예외 처리

`update` 액션에서 `meeting_date`, `recurrence`, `recurrence_until` 중 하나라도 바뀌면 **같은 작업에서 해당 meeting_id의 `meeting_exceptions`를 전부 삭제**하고, 편집 모달은 "반복 규칙/시작일을 바꾸면 취소했던 회차가 복원됩니다"를 경고한다(정직한 v1 의미; 회차별 재정렬은 YAGNI).

`cancelOccurrence(meetingId, occurrenceDate)`는 서버에서 **occurrenceDate가 실제로 규칙에 떨어지는지 검증**(같은 도메인 함수) 후 예외행 insert — 오래된 클라이언트가 매칭 안 되는 유령 예외행을 넣는 것 방지.

## 5. "내 회의" 크로스 프로젝트 식별

### 5.1 본인 판정은 서버에서, boolean만 전송

로스터 이메일 목록을 페이지 payload로 방출하지 않는다(전 직원 이메일 노출 회피, payload 스케일 억제).

서버 페이지에서:
1. `getSession()` → `uid`, `email`
2. `getMyMemberIds()`: `select id from project_members where lower(email) = lower(:email)` → `Set<memberId>` (lower(email) 함수형 인덱스 사용)
3. 각 회의: `isMine = createdBy === uid || attendeeMemberIds.some(id => myMemberIds.has(id))`

`myMemberIds`는 Set으로 dedupe(중복 로스터행 대응). 참석자 표시 이름도 도메인에서 `lower(email)`로 dedupe.

### 5.2 payload 규칙 (프라이버시·크기·N+1 동시 해결)

- **크로스 프로젝트 목록 쿼리는 캘린더 필드만** select: `id, project_id, title, meeting_date, start_time, end_time, category, recurrence, recurrence_until, created_by` + `projects(name)` + 임베드 `meeting_attendees(member_id)`. **`body`·`location`은 전송하지 않음**(가장 민감한 회의록은 상세 모달 열 때 per-meeting 로드).
- **범위는 보이는 달 ±(그리드 넘침)**로 바운드(4.2 조건).
- "내 회의" 페이지 쿼리 수 = **정확히 3개**: (1) 범위+참석자+프로젝트명 임베드, project_id 필터 없음, (2) 예외 `.in('meeting_id', ids)`(또는 (1)에 임베드), (3) `getMyMemberIds()`. 참석자 표시 이름은 상세 모달에서 `.in('id', attendeeIds)` 4번째 조회로 on-demand. **project 루프 금지**(N+1 방지).

### 5.3 이메일 매칭 실패의 가시화

이메일이 null/공백/대소문자 불일치인 로스터 멤버는 매칭이 안 된다(0011 이메일 CHECK는 NOT VALID, 백필 미실행 이력). 실패 모드를 보이게:
- "내 것만"인데 0건이면 **빈 그리드 대신 안내**: "로스터 이메일이 로그인 이메일과 일치할 때 회의가 표시됩니다."
- 참석자 선택 UI에서 **이메일 없는 멤버 시각 경고**.
- 근본 해결책 `project_members.user_id uuid null references auth.users`(하위호환 링크 컬럼)는 이메일 매칭이 실측으로 문제될 때 도입 — v1 보류.

### 5.4 기본값

"내 회의"는 **"내 것만" ON**으로 시작(페이지 이름과 일치, 기본 payload 축소, 다중 프로젝트 사용자의 색상 범례 스케일 문제 회피). "전체 프로젝트" 토글로 전환.

## 6. 계층 구조 (announcements 템플릿)

```
0013_meetings.sql
  → src/lib/domain/types.ts        (Meeting, MeetingOccurrence, MeetingCategory, MeetingRecurrence, MeetingAttendee 타입 추가)
  → src/lib/domain/meetings.ts     (순수: expandMeetings, canEditMeeting, MEETING_META, 카테고리 순서, 요약(hero KPI), 정렬 — 단위 테스트 대상)
  → src/lib/data/meetings.ts       (cache() 리드: getProjectMeetings(range), getMyMeetings(range), getMeetingDetail(id), getMyMemberIds; snake→camel; 실패 시 []/null)
  → src/app/actions/meetings.ts    ('use server': createMeeting, updateMeeting, deleteMeeting, setAttendees, cancelOccurrence, restoreOccurrence)
  → src/app/(app)/p/[projectId]/meetings/page.tsx   (프로젝트 회의)
  → src/app/(app)/meetings/page.tsx                  (내 회의)
  → src/components/meetings/MeetingsView.tsx         ('use client' 프로젝트 뷰)
  → src/components/meetings/MyMeetingsView.tsx        ('use client' 내 회의 뷰 — 프로젝트 색상·내것만 토글)
  → src/components/meetings/MeetingCalendar.tsx       (월 그리드 — monthMatrix 재사용, 셀당 최대 3칩+'+N')
  → src/components/meetings/MeetingFormModal.tsx      (생성/편집 공용, initial: Meeting|null; 반복·종일·시간·참석자)
  → src/components/meetings/MeetingDetailModal.tsx    (상세 — 참석자 아바타, 회의록, 이 회차 취소, 편집/삭제 — canEditMeeting으로 버튼 게이팅)
  → src/components/meetings/MeetingAttendeePicker.tsx (팀별 체크박스 다중선택+검색, 이메일 없는 멤버 경고)
  → src/lib/i18n/dict/meetings.ts  (ko/en, 'meet.*' 네임스페이스; dict.ts에 병합)
```

내비 등록(3곳 동기화 필수):
- `src/components/app/Sidebar.tsx` `projectMenu()` 에 `{ href: base/meetings, labelKey: 'nav.meetings', icon: CalendarClock, match }` 추가 + 최상위 "내 회의" 글로벌 링크(`/meetings`) 추가.
- `src/components/app/HeaderChrome.tsx` `SECTION_LABEL`에 `meetings: '회의'`, MobileMenu `links[]`에 항목 추가.
- `src/lib/i18n/dict/common.ts` 에 `nav.meetings` (ko '회의' / en 'Meetings') + `nav.myMeetings` 추가.

## 7. 권한·정합의 3층 일치

한 식에서 세 층을 파생한다:
- **UI**: `canEditMeeting(meeting, uid, role)`로 편집/삭제/취소 버튼 노출 제어.
- **서버 액션**: update/delete는 `created_by` 선조회 후 `row.createdBy === uid || role === 'pmo_admin'` 코드 검증(0-row 무음 성공 방지) + `.select('project_id').single()` 꼬리로 잔여 RLS 필터를 에러로 표면화. create는 `getMembership()` null → '로그인 필요'.
- **RLS**: §3 정책.

참석자 액션은 추가로 **member.project_id === meeting.project_id 검증**(다른 프로젝트 멤버가 참석자로 붙어 표시 모델이 오염되는 것 방지). RLS로 표현하지 않음(2테이블 조인 필요, 보안 이득 없음).

## 8. 컴포넌트·토큰 재사용

- 캘린더 그리드: `monthMatrix`/`recordsByDate` 로직 재사용(occurrence는 `occurrencesByDate`로 버킷팅). 셀 스타일·요일 색상·오늘 원형·공휴일 빨강은 AttendanceView 패턴 그대로.
- 공통 UI: `Modal`, `SegmentedTabs`, `EmptyState`, `KpiCard`(hero), `PageHero`/`HeroBadge`, `ProjectPageShell`.
- 폼: 다중선택 컴포넌트가 없으므로 `MeetingAttendeePicker` 신규(팀별 그룹 체크박스+검색). 시간은 native `<input type="time">` + `.app-input`(라이브러리 미도입). "종일" 체크 시 시간 입력 비활성+null.
- 색상은 토큰만: `MEETING_META`가 카테고리별 `{ labelKey, dot, chip }`(status/team 팔레트 재사용, 라이트·다크 자동). 하드코딩 hex/`dark:` 금지.
- 문자열은 전부 i18n. `SECTION_LABEL`은 한글 고정(기존 관례).

## 9. 테스트 (vitest, 순수 도메인만)

`tests/domain/meetings.test.ts`:
- `expandMeetings`: 단일/매일/매주/격주/매월; 매월-31 skip; 윤년 Feb-29; 격주 연경계; recurrence_until 포함 경계; range 클램프(밖 방출 안 함); 하드캡; 취소 예외 제외; occurrenceId 안정성.
- `canEditMeeting`: 작성자/pmo_admin/제3자/탈퇴자(null created_by) 케이스.
- 정렬: 종일(null start) 먼저, 그다음 시각 오름차순; 참석자 dedupe.

컴포넌트 테스트(`tests/ui/`, 필요 시): `vi.mock('@/app/actions/meetings')` + `vi.hoisted`. 서버 액션 자체는 테스트하지 않음(announcements 관례).

## 10. 검증 (배포 전)

브라우저가 샌드박스 dev 서버에 못 닿으므로 `build` + `lint` + `test` + 필요 시 `curl`로 검증(메모리 wbs-web-verify-env). `git add -A` 금지(병렬 세션) — 파일 개별 add.

## 11. 열린 결정 (구현 중 확정)

- 카테고리 6종(general/routine/kickoff/review/report/external) 라벨·색 매핑 최종값.
- "내 회의"의 프로젝트 색상 소스(팀 색 재사용 vs 프로젝트 해시 색).
- 0011 백필 동반 실행 여부(프로덕션 이메일 데이터 확인 후).
