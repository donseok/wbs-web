# 회의 일정·참석자 관리 (달력) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** D'Flow에 프로젝트별 회의 달력과 크로스 프로젝트 "내 회의" 달력을 추가한다 — 반복 회의, 참석자 관리, 소유자 기반 편집 포함.

**Architecture:** 반복은 행을 미리 만들지 않고 순수 도메인 함수(`expandMeetings`)가 화면 범위 안에서만 회차를 전개한다(읽기 시점 전개). 계층은 announcements(0012) 템플릿을 그대로 따른다: 마이그레이션 → domain(순수·테스트) → data(cache 읽기) → actions('use server' 쓰기) → 서버 페이지 → 'use client' 뷰. 근태(attendance) 캘린더의 `monthMatrix`·셀 마크업·모달 패턴을 재사용한다.

**Tech Stack:** Next.js 15.5 App Router, React 19, Supabase(SSR anon 클라이언트 + RLS), Tailwind v4(토큰), vitest(node env). 날짜 라이브러리 없음 — ISO 'YYYY-MM-DD' + `Date.UTC` 산술.

## Global Constraints

- 날짜 라이브러리 도입 금지. 날짜는 `'YYYY-MM-DD'` 문자열 + `Date.UTC` 산술, "오늘"은 `Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' })`.
- 시각은 `'HH:MM'` 24h 텍스트. 종일 = `startTime === null`. 별도 all-day 컬럼 없음.
- RLS 쓰기 게이트는 `public.app_role()` 사용(예약어 `current_role()` 금지 — 레포 0002/0004 드리프트). 새 SQL 헬퍼 함수 만들지 말고 `(created_by = auth.uid() or app_role() = 'pmo_admin')` 식을 인라인 반복.
- 마이그레이션은 멱등(`create table if not exists`, `drop policy if exists` 후 `create policy`). 적용은 Supabase Management API `POST /v1/projects/<ref>/database/query`. `supabase db push` 없음(SUPABASE_DB_URL 비어 있음).
- `updated_at` 트리거 없음 — update 액션에서 `new Date().toISOString()` 수동 갱신.
- 색상은 토큰 클래스만(`bg-brand`, `text-ink`, `bg-done-weak` 등). 하드코딩 hex·`dark:` 변형 금지.
- 사용자 표시 문자열은 전부 i18n(`t()`), `SECTION_LABEL`만 한글 고정(기존 관례).
- 서버 액션 결과는 `{ ok: boolean; error?: string }`, throw 금지, 한글 에러 문자열('로그인 필요' 등).
- 커밋 시 `git add -A` 금지(병렬 세션). 파일을 개별로 `git add`.
- 테스트는 순수 도메인 계층만(`tests/domain/`). 서버 액션·데이터 계층은 vitest에서 실행 불가('use server' + supabase) — 테스트하지 않음.
- 검증: `npm run test`, `npm run lint`, `npm run build`. 브라우저는 샌드박스 dev 서버에 못 닿음.

---

## File Structure

**Create:**
- `supabase/migrations/0013_meetings.sql` — 3 테이블 + RLS + lower(email) 인덱스
- `src/lib/domain/meetings.ts` — 순수: `expandMeetings`, `canEditMeeting`, `MEETING_META`, `MEETING_CATEGORIES`, `RECURRENCE_ORDER`, `occurrencesByDate`, `sortOccurrences`, `summarizeMeetings`
- `src/lib/data/meetings.ts` — `getProjectMeetingData`, `getMeetingDetail`, `getMyMemberIds`, `getMyMeetings`
- `src/app/actions/meetings.ts` — `createMeeting`, `updateMeeting`, `deleteMeeting`, `setMeetingAttendees`, `cancelOccurrence`, `restoreOccurrence`, `fetchMyMeetings`
- `src/lib/i18n/dict/meetings.ts` — `meet.*` ko/en
- `src/app/(app)/p/[projectId]/meetings/page.tsx` — 프로젝트 회의 페이지
- `src/app/(app)/meetings/page.tsx` — 내 회의 페이지
- `src/components/meetings/MeetingCalendar.tsx` — 월 그리드(순수 표시, 콜백 props)
- `src/components/meetings/MeetingAttendeePicker.tsx` — 팀별 체크박스 다중선택
- `src/components/meetings/MeetingFormModal.tsx` — 생성/편집 공용
- `src/components/meetings/MeetingDetailModal.tsx` — 상세(참석자·회의록·취소·편집/삭제)
- `src/components/meetings/MeetingsView.tsx` — 프로젝트 뷰(클라이언트)
- `src/components/meetings/MyMeetingsView.tsx` — 내 회의 뷰(클라이언트)
- `tests/domain/meetings.test.ts`

**Modify:**
- `src/lib/domain/types.ts` — 회의 타입 추가
- `src/lib/i18n/dict.ts` — meetings 네임스페이스 병합
- `src/lib/i18n/dict/common.ts` — `nav.meetings`, `nav.myMeetings`
- `src/components/app/Sidebar.tsx` — projectMenu에 회의, 전역 "내 회의" 링크
- `src/components/app/HeaderChrome.tsx` — `SECTION_LABEL`, MobileMenu links

---

## Task 1: 도메인 타입 정의

**Files:**
- Modify: `src/lib/domain/types.ts` (파일 끝에 추가)

**Interfaces:**
- Produces: `MeetingCategory`, `MeetingRecurrence`, `Meeting`, `MeetingException`, `MeetingOccurrence`, `MeetingAttendeeInfo` 타입. 이후 모든 태스크가 소비.

- [ ] **Step 1: 타입 추가**

`src/lib/domain/types.ts` 끝에 append:

```ts
/* ── 회의 (meetings) ── */
export type MeetingCategory = 'general' | 'routine' | 'kickoff' | 'review' | 'report' | 'external'
export type MeetingRecurrence = 'none' | 'daily' | 'weekly' | 'biweekly' | 'monthly'

export interface Meeting {
  id: string
  projectId: string
  title: string
  meetingDate: string          // 'YYYY-MM-DD' — 시리즈 앵커(첫 회차)
  startTime: string | null     // 'HH:MM' 또는 null(종일)
  endTime: string | null       // 'HH:MM' 또는 null
  location: string | null
  category: MeetingCategory
  body: string                 // 회의록/메모 (목록 조회에선 '')
  recurrence: MeetingRecurrence
  recurrenceUntil: string | null // 'YYYY-MM-DD' 포함(inclusive)
  createdBy: string | null
  createdByName: string | null
  createdAt: string
  updatedAt: string
  attendeeIds: string[]        // project_members.id (시리즈 단위)
  projectName?: string         // 내 회의 뷰 전용(크로스 프로젝트 표시)
  isMine?: boolean             // 내 회의 뷰 전용(서버 계산)
}

export interface MeetingException {
  meetingId: string
  occurrenceDate: string       // 'YYYY-MM-DD'
  kind: 'cancelled'
}

/** 달력 셀·칩이 필요로 하는 전개된 1회차. body/참석자이름은 상세 모달에서 별도 로드. */
export interface MeetingOccurrence {
  occurrenceId: string         // `${seriesId}:${occurrenceDate}` — React key & 회차 식별
  seriesId: string             // = Meeting.id
  occurrenceDate: string       // 'YYYY-MM-DD'
  projectId: string
  title: string
  startTime: string | null
  endTime: string | null
  location: string | null
  category: MeetingCategory
  isRecurring: boolean
  attendeeCount: number
  projectName?: string
  isMine?: boolean
}

/** 상세 모달용 참석자 표시 정보 */
export interface MeetingAttendeeInfo {
  id: string                   // project_members.id
  name: string
  teamCode: TeamCode | null
  email: string | null
}
```

- [ ] **Step 2: 타입체크**

Run: `cd /Users/jerry/wbs-web && npx tsc --noEmit -p tsconfig.json`
Expected: PASS (에러 0 — 새 export만 추가).

- [ ] **Step 3: Commit**

```bash
cd /Users/jerry/wbs-web
git add src/lib/domain/types.ts
git commit -m "feat(meetings): 회의 도메인 타입 추가"
```

---

## Task 2: 도메인 순수 로직 + META (TDD)

**Files:**
- Create: `src/lib/domain/meetings.ts`
- Test: `tests/domain/meetings.test.ts`

**Interfaces:**
- Consumes: Task 1 타입.
- Produces:
  - `MEETING_META: Record<MeetingCategory, { labelKey: \`meet.cat.${MeetingCategory}\`; chip: string; dot: string }>`
  - `MEETING_CATEGORIES: MeetingCategory[]`
  - `RECURRENCE_ORDER: MeetingRecurrence[]`
  - `expandMeetings(meetings: Meeting[], exceptions: MeetingException[], gridStartIso: string, gridEndIso: string): MeetingOccurrence[]`
  - `occurrencesByDate(occ: MeetingOccurrence[]): Record<string, MeetingOccurrence[]>`
  - `sortOccurrences(occ: MeetingOccurrence[]): MeetingOccurrence[]` (종일 먼저 → startTime 오름차순 → title)
  - `canEditMeeting(m: { createdBy: string | null }, userId: string | null, role: string | null): boolean`
  - `summarizeMeetings(occ: MeetingOccurrence[], todayIso: string): { today: number; upcoming7d: number; total: number }`

- [ ] **Step 1: 실패 테스트 작성**

Create `tests/domain/meetings.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import {
  expandMeetings, occurrencesByDate, sortOccurrences, canEditMeeting, summarizeMeetings,
  MEETING_CATEGORIES,
} from '@/lib/domain/meetings'
import type { Meeting, MeetingException } from '@/lib/domain/types'

function mtg(id: string, date: string, opts: Partial<Meeting> = {}): Meeting {
  return {
    id, projectId: 'p1', title: `회의 ${id}`, meetingDate: date,
    startTime: '10:00', endTime: '11:00', location: null, category: 'general',
    body: '', recurrence: 'none', recurrenceUntil: null,
    createdBy: 'u1', createdByName: '홍길동', createdAt: `${date}T00:00:00+00:00`,
    updatedAt: `${date}T00:00:00+00:00`, attendeeIds: [], ...opts,
  }
}
const G = (m: Meeting[], ex: MeetingException[], s: string, e: string) =>
  expandMeetings(m, ex, s, e).map(o => o.occurrenceDate)

describe('expandMeetings — 단일/범위', () => {
  it('비반복 회의는 범위 안이면 1건, 밖이면 0건', () => {
    expect(G([mtg('a', '2026-07-10')], [], '2026-07-01', '2026-07-31')).toEqual(['2026-07-10'])
    expect(G([mtg('a', '2026-07-10')], [], '2026-08-01', '2026-08-31')).toEqual([])
  })
  it('occurrenceId = seriesId:date', () => {
    const [o] = expandMeetings([mtg('a', '2026-07-10')], [], '2026-07-01', '2026-07-31')
    expect(o.occurrenceId).toBe('a:2026-07-10')
    expect(o.seriesId).toBe('a')
  })
})

describe('expandMeetings — 주간/격주', () => {
  it('매주: 앵커부터 7일 간격, 범위로 클램프', () => {
    const m = mtg('w', '2026-07-06', { recurrence: 'weekly', recurrenceUntil: '2026-08-31' })
    expect(G([m], [], '2026-07-01', '2026-07-31'))
      .toEqual(['2026-07-06', '2026-07-13', '2026-07-20', '2026-07-27'])
  })
  it('매주: 과거 앵커라도 이번 달만 전개(앵커가 범위 앞이어도 fast-forward)', () => {
    const m = mtg('w', '2026-01-05', { recurrence: 'weekly', recurrenceUntil: null })
    expect(G([m], [], '2026-07-06', '2026-07-12')).toEqual(['2026-07-06'])
  })
  it('격주: 14일 간격, 앵커 위상 유지', () => {
    const m = mtg('b', '2026-07-06', { recurrence: 'biweekly', recurrenceUntil: '2026-09-30' })
    expect(G([m], [], '2026-07-01', '2026-07-31')).toEqual(['2026-07-06', '2026-07-20'])
  })
  it('격주: 연 경계를 넘어도 위상 유지', () => {
    const m = mtg('b', '2025-12-22', { recurrence: 'biweekly', recurrenceUntil: '2026-02-28' })
    expect(G([m], [], '2026-01-01', '2026-01-31')).toEqual(['2026-01-05', '2026-01-19'])
  })
})

describe('expandMeetings — 매월(31일 skip 규칙)', () => {
  it('매월 31일: 31일 없는 달은 건너뜀', () => {
    const m = mtg('mo', '2026-01-31', { recurrence: 'monthly', recurrenceUntil: '2026-12-31' })
    // 2월(없음), 4·6·9·11월(30일, 없음) skip → 1,3,5,7,8,10,12월만
    expect(G([m], [], '2026-01-01', '2026-12-31'))
      .toEqual(['2026-01-31', '2026-03-31', '2026-05-31', '2026-07-31', '2026-08-31', '2026-10-31', '2026-12-31'])
  })
  it('매월 15일: 매달 존재', () => {
    const m = mtg('mo', '2026-06-15', { recurrence: 'monthly', recurrenceUntil: '2026-08-31' })
    expect(G([m], [], '2026-06-01', '2026-08-31')).toEqual(['2026-06-15', '2026-07-15', '2026-08-15'])
  })
  it('매월 29일: 윤년 2월29 포함, 평년이면 skip', () => {
    const leap = mtg('l', '2024-01-29', { recurrence: 'monthly', recurrenceUntil: '2024-03-31' })
    expect(G([leap], [], '2024-02-01', '2024-02-29')).toEqual(['2024-02-29'])
    const nonleap = mtg('n', '2026-01-29', { recurrence: 'monthly', recurrenceUntil: '2026-03-31' })
    expect(G([nonleap], [], '2026-02-01', '2026-02-28')).toEqual([])
  })
})

describe('expandMeetings — until 포함 & 예외', () => {
  it('recurrence_until는 포함(inclusive)', () => {
    const m = mtg('w', '2026-07-06', { recurrence: 'weekly', recurrenceUntil: '2026-07-20' })
    expect(G([m], [], '2026-07-01', '2026-07-31')).toEqual(['2026-07-06', '2026-07-13', '2026-07-20'])
  })
  it('취소 예외 회차는 제외', () => {
    const m = mtg('w', '2026-07-06', { recurrence: 'weekly', recurrenceUntil: '2026-07-31' })
    const ex: MeetingException[] = [{ meetingId: 'w', occurrenceDate: '2026-07-13', kind: 'cancelled' }]
    expect(G([m], ex, '2026-07-01', '2026-07-31')).toEqual(['2026-07-06', '2026-07-20', '2026-07-27'])
  })
})

describe('sortOccurrences', () => {
  it('종일(null start) 먼저 → 시각 오름차순', () => {
    const m = [
      mtg('c', '2026-07-10', { startTime: '18:00' }),
      mtg('a', '2026-07-10', { startTime: null, endTime: null }),
      mtg('b', '2026-07-10', { startTime: '09:00' }),
    ]
    const occ = expandMeetings(m, [], '2026-07-10', '2026-07-10')
    expect(sortOccurrences(occ).map(o => o.seriesId)).toEqual(['a', 'b', 'c'])
  })
})

describe('canEditMeeting', () => {
  it('작성자 본인 → true', () => expect(canEditMeeting({ createdBy: 'u1' }, 'u1', 'team_editor')).toBe(true))
  it('pmo_admin → true(남의 것도)', () => expect(canEditMeeting({ createdBy: 'u1' }, 'u2', 'pmo_admin')).toBe(true))
  it('제3자 team_editor → false', () => expect(canEditMeeting({ createdBy: 'u1' }, 'u2', 'team_editor')).toBe(false))
  it('탈퇴자(null) → pmo만', () => {
    expect(canEditMeeting({ createdBy: null }, 'u2', 'team_editor')).toBe(false)
    expect(canEditMeeting({ createdBy: null }, 'u2', 'pmo_admin')).toBe(true)
  })
  it('비로그인 → false', () => expect(canEditMeeting({ createdBy: 'u1' }, null, null)).toBe(false))
})

describe('MEETING_CATEGORIES', () => {
  it('6종', () => expect(MEETING_CATEGORIES).toHaveLength(6))
})

describe('summarizeMeetings', () => {
  it('오늘/향후7일/전체 카운트', () => {
    const occ = expandMeetings([
      mtg('a', '2026-07-03'), mtg('b', '2026-07-05'), mtg('c', '2026-07-20'),
    ], [], '2026-07-01', '2026-07-31')
    const s = summarizeMeetings(occ, '2026-07-03')
    expect(s.total).toBe(3)
    expect(s.today).toBe(1)
    expect(s.upcoming7d).toBe(2) // 07-03(포함) ~ 07-09: a,b
  })
})
```

- [ ] **Step 2: 실패 확인**

Run: `cd /Users/jerry/wbs-web && npm run test -- tests/domain/meetings.test.ts`
Expected: FAIL — "Cannot find module '@/lib/domain/meetings'".

- [ ] **Step 3: 구현**

Create `src/lib/domain/meetings.ts`:

```ts
import type { Meeting, MeetingCategory, MeetingException, MeetingOccurrence, MeetingRecurrence } from '@/lib/domain/types'

/**
 * 카테고리 메타 — 라벨은 dict 키(표시 지점에서 t()로 해석), 색상은 상태/팀 팔레트
 * 재사용으로 라이트·다크 자동 대응. (ANNOUNCEMENT_META/ATTENDANCE_META 관례)
 */
export const MEETING_META: Record<
  MeetingCategory,
  { labelKey: `meet.cat.${MeetingCategory}`; chip: string; dot: string }
> = {
  general:  { labelKey: 'meet.cat.general',  chip: 'bg-brand-weak text-brand',                dot: 'bg-brand' },
  routine:  { labelKey: 'meet.cat.routine',  chip: 'bg-progress-weak text-progress',          dot: 'bg-progress' },
  kickoff:  { labelKey: 'meet.cat.kickoff',  chip: 'bg-done-weak text-done',                  dot: 'bg-done' },
  review:   { labelKey: 'meet.cat.review',   chip: 'bg-pending-weak text-pending',            dot: 'bg-pending' },
  report:   { labelKey: 'meet.cat.report',   chip: 'bg-accent-secondary/15 text-accent-secondary', dot: 'bg-accent-secondary' },
  external: { labelKey: 'meet.cat.external', chip: 'bg-delayed-weak text-delayed',            dot: 'bg-delayed' },
}

/** 표시 순서(폼 셀렉트/범례용) */
export const MEETING_CATEGORIES: MeetingCategory[] = ['routine', 'general', 'kickoff', 'review', 'report', 'external']

/** 반복 옵션 표시 순서 */
export const RECURRENCE_ORDER: MeetingRecurrence[] = ['none', 'daily', 'weekly', 'biweekly', 'monthly']

/** 시리즈당 전개 하드캡 — recurrence_until null 이어도 무한 루프 불가(방어선). */
const MAX_OCCURRENCES = 366

function pad2(n: number): string { return String(n).padStart(2, '0') }
function iso(y: number, m0: number, d: number): string { return `${y}-${pad2(m0 + 1)}-${pad2(d)}` }
/** 'YYYY-MM-DD' → UTC epoch day 수(타임존 무관 정수 비교/산술용). */
function epochDay(dateIso: string): number {
  const [y, m, d] = dateIso.split('-').map(Number)
  return Math.floor(Date.UTC(y, m - 1, d) / 86_400_000)
}
function addDaysIso(dateIso: string, days: number): string {
  const [y, m, d] = dateIso.split('-').map(Number)
  const t = new Date(Date.UTC(y, m - 1, d + days))
  return iso(t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate())
}

/**
 * meetings 를 [gridStart, gridEnd] 안의 개별 회차로 전개한다(읽기 시점 전개).
 * - 비반복: meetingDate 가 범위 안이면 1건.
 * - daily/weekly/biweekly: epoch-day 산술로 rangeStart 로 fast-forward 후 step 간격.
 * - monthly: 월 단위로 이동하되 해당 일자가 없는 달(예: 매월 31일의 2월)은 건너뜀(RFC5545/구글 방식).
 * - recurrenceUntil 은 포함(inclusive). cancelled 예외 회차는 제외.
 * - 범위 밖 회차는 절대 방출하지 않으며 시리즈당 MAX_OCCURRENCES 로 캡.
 * 시각은 서울 벽시계 기준 표시 텍스트 — 원격 뷰어용 타임존 변환 없음(의도적 단순화).
 */
export function expandMeetings(
  meetings: Meeting[],
  exceptions: MeetingException[],
  gridStartIso: string,
  gridEndIso: string,
): MeetingOccurrence[] {
  const startDay = epochDay(gridStartIso)
  const endDay = epochDay(gridEndIso)
  const cancelled = new Set(exceptions.filter(e => e.kind === 'cancelled').map(e => `${e.meetingId}:${e.occurrenceDate}`))
  const out: MeetingOccurrence[] = []

  const emit = (m: Meeting, dateIso: string) => {
    if (cancelled.has(`${m.id}:${dateIso}`)) return
    out.push({
      occurrenceId: `${m.id}:${dateIso}`,
      seriesId: m.id,
      occurrenceDate: dateIso,
      projectId: m.projectId,
      title: m.title,
      startTime: m.startTime,
      endTime: m.endTime,
      location: m.location,
      category: m.category,
      isRecurring: m.recurrence !== 'none',
      attendeeCount: m.attendeeIds.length,
      projectName: m.projectName,
      isMine: m.isMine,
    })
  }

  for (const m of meetings) {
    const anchor = m.meetingDate
    const untilDay = m.recurrenceUntil ? epochDay(m.recurrenceUntil) : Infinity
    const hardEndDay = Math.min(endDay, untilDay)

    if (m.recurrence === 'none') {
      const d = epochDay(anchor)
      if (d >= startDay && d <= endDay) emit(m, anchor)
      continue
    }

    if (m.recurrence === 'daily' || m.recurrence === 'weekly' || m.recurrence === 'biweekly') {
      const step = m.recurrence === 'daily' ? 1 : m.recurrence === 'weekly' ? 7 : 14
      const anchorDay = epochDay(anchor)
      // rangeStart 로 fast-forward: anchor 이후 첫 회차 >= startDay
      let k = 0
      if (startDay > anchorDay) k = Math.ceil((startDay - anchorDay) / step)
      let cur = anchorDay + k * step
      let count = 0
      while (cur <= hardEndDay && count < MAX_OCCURRENCES) {
        emit(m, addDaysIso(anchor, cur - anchorDay))
        cur += step
        count++
      }
      continue
    }

    // monthly — 앵커 일자를 유지, 없는 달은 skip
    const [ay, am, ad] = anchor.split('-').map(Number)
    let count = 0
    for (let step = 0; count < MAX_OCCURRENCES; step++) {
      const t = new Date(Date.UTC(ay, am - 1 + step, ad))
      // Date.UTC 롤오버 감지: 목표 일자가 그 달에 존재하지 않으면 skip
      if (t.getUTCDate() !== ad) {
        // 이미 hardEnd 를 지났는지 판단하려면 그 달 1일 기준으로 종료 체크
        const monthStart = epochDay(iso(ay, (am - 1 + step) % 12 < 0 ? 0 : ((am - 1 + step) % 12), 1))
        if (monthStart > hardEndDay) break
        continue
      }
      const dateIso = iso(t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate())
      const d = epochDay(dateIso)
      if (d > hardEndDay) break
      if (d >= startDay) { emit(m, dateIso); count++ }
    }
  }

  return out
}

/** 날짜별 버킷팅 */
export function occurrencesByDate(occ: MeetingOccurrence[]): Record<string, MeetingOccurrence[]> {
  const out: Record<string, MeetingOccurrence[]> = {}
  for (const o of occ) (out[o.occurrenceDate] ??= []).push(o)
  return out
}

/** 종일(null start) 먼저 → startTime 오름차순 → title. 원본 불변. */
export function sortOccurrences(occ: MeetingOccurrence[]): MeetingOccurrence[] {
  return [...occ].sort((a, b) => {
    const aAll = a.startTime === null, bAll = b.startTime === null
    if (aAll !== bAll) return aAll ? -1 : 1
    if (a.startTime && b.startTime && a.startTime !== b.startTime) return a.startTime < b.startTime ? -1 : 1
    return a.title.localeCompare(b.title)
  })
}

/** 편집/삭제/회차취소 권한 — 작성자 본인 또는 pmo_admin. RLS 정책과 동일 식. */
export function canEditMeeting(m: { createdBy: string | null }, userId: string | null, role: string | null): boolean {
  if (!userId) return false
  if (role === 'pmo_admin') return true
  return m.createdBy !== null && m.createdBy === userId
}

const DAY = 86_400_000

/** hero KPI — 오늘/향후 7일(오늘 포함)/전체(현재 그리드 전개분 기준). */
export function summarizeMeetings(occ: MeetingOccurrence[], todayIso: string): { today: number; upcoming7d: number; total: number } {
  const t0 = Date.parse(`${todayIso}T00:00:00+09:00`)
  let today = 0, upcoming7d = 0
  for (const o of occ) {
    const d = Date.parse(`${o.occurrenceDate}T00:00:00+09:00`)
    if (o.occurrenceDate === todayIso) today++
    if (d >= t0 && d < t0 + 7 * DAY) upcoming7d++
  }
  return { today, upcoming7d, total: occ.length }
}
```

- [ ] **Step 4: 통과 확인**

Run: `cd /Users/jerry/wbs-web && npm run test -- tests/domain/meetings.test.ts`
Expected: PASS (전부 통과). 실패 시 monthly skip 루프의 종료 조건을 우선 점검.

- [ ] **Step 5: Commit**

```bash
cd /Users/jerry/wbs-web
git add src/lib/domain/meetings.ts tests/domain/meetings.test.ts
git commit -m "feat(meetings): expandMeetings·canEditMeeting 등 순수 도메인 로직 + 테스트"
```

---

## Task 3: 마이그레이션 SQL

**Files:**
- Create: `supabase/migrations/0013_meetings.sql`

**Interfaces:**
- Produces: `meetings`, `meeting_attendees`, `meeting_exceptions` 테이블 + RLS + `project_members_email_lower_idx`.

- [ ] **Step 1: 마이그레이션 파일 작성**

Create `supabase/migrations/0013_meetings.sql`:

```sql
-- 회의 (프로젝트 스코프) + 참석자 + 반복 예외
-- 권한: 읽기 = 인증 사용자 전체(게스트 포함) / 쓰기 = 생성은 멤버십 보유자 본인,
--       수정·삭제는 작성자(created_by) 또는 pmo_admin. 앱 최초의 사용자 생성 콘텐츠.
-- 멱등: SQL Editor 반복 실행 안전(if not exists / drop policy if exists).
-- 적용: Supabase Management API — POST /v1/projects/<ref>/database/query (0012와 동일 경로).
--       .env.local 의 SUPABASE_DB_URL 은 비어 있으므로 pg 직결/ db push 는 사용하지 않는다.
-- 주의: 레포 0002/0004 의 current_role() 은 PG 예약어 드리프트 — 프로덕션 헬퍼는 public.app_role().
--       새 헬퍼 함수를 만들지 않고 (created_by = auth.uid() or app_role() = 'pmo_admin') 식을 인라인 반복.

create or replace function public.app_role() returns text language sql stable as $$
  select role from memberships where user_id = auth.uid()
$$;

create table if not exists meetings (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  title text not null,
  meeting_date date not null,
  start_time text,
  end_time text,
  location text,
  category text not null default 'general'
    check (category in ('general','routine','kickoff','review','report','external')),
  body text not null default '',
  recurrence text not null default 'none'
    check (recurrence in ('none','daily','weekly','biweekly','monthly')),
  recurrence_until date,
  created_by uuid references auth.users(id) on delete set null,
  created_by_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint meetings_start_time_fmt check (start_time is null or start_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  constraint meetings_end_time_fmt   check (end_time  is null or end_time  ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  constraint meetings_time_order     check (end_time is null or (start_time is not null and end_time > start_time)),
  constraint meetings_recur_until    check (recurrence_until is null or recurrence_until >= meeting_date),
  constraint meetings_recur_none     check (recurrence <> 'none' or recurrence_until is null)
);
create index if not exists meetings_project_idx on meetings(project_id, meeting_date);

create table if not exists meeting_attendees (
  meeting_id uuid not null references meetings(id) on delete cascade,
  member_id  uuid not null references project_members(id) on delete cascade,
  primary key (meeting_id, member_id)
);

create table if not exists meeting_exceptions (
  meeting_id uuid not null references meetings(id) on delete cascade,
  occurrence_date date not null,
  kind text not null default 'cancelled' check (kind in ('cancelled')),
  primary key (meeting_id, occurrence_date)
);

-- email 이 표시 필드에서 '내 회의' 본인 식별 조인 키로 승격 → lower(email) 함수형 인덱스.
create index if not exists project_members_email_lower_idx on project_members (lower(email));

alter table meetings           enable row level security;
alter table meeting_attendees  enable row level security;
alter table meeting_exceptions enable row level security;

-- meetings: 읽기 전체 / 생성 본인(멤버) / 수정·삭제 작성자 또는 pmo
drop policy if exists read_all_meetings on meetings;
create policy read_all_meetings on meetings for select to authenticated using (true);

drop policy if exists insert_own_meetings on meetings;
create policy insert_own_meetings on meetings
  for insert to authenticated
  with check (created_by = auth.uid() and app_role() is not null);

drop policy if exists update_own_meetings on meetings;
create policy update_own_meetings on meetings
  for update to authenticated
  using (created_by = auth.uid() or app_role() = 'pmo_admin')
  with check (created_by = auth.uid() or app_role() = 'pmo_admin');

drop policy if exists delete_own_meetings on meetings;
create policy delete_own_meetings on meetings
  for delete to authenticated
  using (created_by = auth.uid() or app_role() = 'pmo_admin');

-- 자식 테이블: 읽기 전체 / 쓰기는 부모 회의 소유권 미러(EXISTS)
drop policy if exists read_all_meeting_attendees on meeting_attendees;
create policy read_all_meeting_attendees on meeting_attendees for select to authenticated using (true);

drop policy if exists own_write_meeting_attendees on meeting_attendees;
create policy own_write_meeting_attendees on meeting_attendees
  for all to authenticated
  using (exists (select 1 from meetings m where m.id = meeting_id
                 and (m.created_by = auth.uid() or app_role() = 'pmo_admin')))
  with check (exists (select 1 from meetings m where m.id = meeting_id
                 and (m.created_by = auth.uid() or app_role() = 'pmo_admin')));

drop policy if exists read_all_meeting_exceptions on meeting_exceptions;
create policy read_all_meeting_exceptions on meeting_exceptions for select to authenticated using (true);

drop policy if exists own_write_meeting_exceptions on meeting_exceptions;
create policy own_write_meeting_exceptions on meeting_exceptions
  for all to authenticated
  using (exists (select 1 from meetings m where m.id = meeting_id
                 and (m.created_by = auth.uid() or app_role() = 'pmo_admin')))
  with check (exists (select 1 from meetings m where m.id = meeting_id
                 and (m.created_by = auth.uid() or app_role() = 'pmo_admin')));
```

- [ ] **Step 2: SQL 문법 자체 점검(로컬)**

Run: `cd /Users/jerry/wbs-web && node -e "const s=require('fs').readFileSync('supabase/migrations/0013_meetings.sql','utf8'); if(!/create table if not exists meetings/.test(s)||!/app_role\(\)/.test(s)) throw new Error('sanity'); console.log('sql sanity ok, len', s.length)"`
Expected: `sql sanity ok, len <N>`.

- [ ] **Step 3: 적용 안내 기록(수동 적용 — 자동 배포 아님)**

이 마이그레이션은 자동 배포되지 않는다. 사용자가 Supabase Management API(`POST /v1/projects/rglfgrwwwwdqejohdnty/database/query`, 키체인 토큰)로 붙여넣어 적용한다. 구현 세션에서는 파일 생성까지만 하고, 적용 여부를 사용자에게 확인 요청한다. (메모리 `rls-helper-drift.md` 레시피 참조.)

- [ ] **Step 4: Commit**

```bash
cd /Users/jerry/wbs-web
git add supabase/migrations/0013_meetings.sql
git commit -m "feat(meetings): 0013 마이그레이션 — meetings/attendees/exceptions + RLS"
```

---

## Task 4: 데이터 계층 (읽기)

**Files:**
- Create: `src/lib/data/meetings.ts`

**Interfaces:**
- Consumes: Task 1 타입.
- Produces:
  - `getProjectMeetingData(projectId: string): Promise<{ meetings: Meeting[]; exceptions: MeetingException[] }>` — 프로젝트 전체 시리즈+예외(body 제외, attendeeIds 임베드). 근태처럼 전부 가져와 클라이언트가 월별 전개.
  - `getMeetingDetail(id: string): Promise<{ meeting: Meeting; attendees: MeetingAttendeeInfo[] } | null>` — body + 참석자 이름 포함(상세 모달).
  - `getMyMemberIds(): Promise<string[]>` — `lower(email)` 매칭 project_members.id 집합.
  - `getMyMeetings(gridStartIso: string, gridEndIso: string): Promise<{ meetings: Meeting[]; exceptions: MeetingException[] }>` — 크로스 프로젝트 범위 조회. body/location 제외, isMine·projectName 세팅.

- [ ] **Step 1: 구현**

Create `src/lib/data/meetings.ts`:

```ts
import { cache } from 'react'
import { createServerClient } from '@/lib/supabase/server'
import type {
  Meeting, MeetingAttendeeInfo, MeetingCategory, MeetingException, MeetingRecurrence, TeamCode,
} from '@/lib/domain/types'

type Row = Record<string, unknown>

function mapMeeting(r: Row, attendeeIds: string[], extra: Partial<Meeting> = {}): Meeting {
  return {
    id: r.id as string,
    projectId: r.project_id as string,
    title: r.title as string,
    meetingDate: r.meeting_date as string,
    startTime: (r.start_time as string | null) ?? null,
    endTime: (r.end_time as string | null) ?? null,
    location: (r.location as string | null) ?? null,
    category: r.category as MeetingCategory,
    body: (r.body as string) ?? '',
    recurrence: r.recurrence as MeetingRecurrence,
    recurrenceUntil: (r.recurrence_until as string | null) ?? null,
    createdBy: (r.created_by as string | null) ?? null,
    createdByName: (r.created_by_name as string | null) ?? null,
    createdAt: r.created_at as string,
    updatedAt: r.updated_at as string,
    attendeeIds,
    ...extra,
  }
}

function attendeeIdsFrom(r: Row): string[] {
  const raw = (r.meeting_attendees as { member_id: string }[] | null) ?? []
  return raw.map(a => a.member_id)
}

/** 프로젝트 전체 회의 시리즈 + 예외. body 제외(상세 모달에서 로드). 실패 시 빈 구조. */
export const getProjectMeetingData = cache(async (
  projectId: string,
): Promise<{ meetings: Meeting[]; exceptions: MeetingException[] }> => {
  const sb = await createServerClient()
  const { data: rows } = await sb
    .from('meetings')
    .select('id, project_id, title, meeting_date, start_time, end_time, location, category, recurrence, recurrence_until, created_by, created_by_name, created_at, updated_at, meeting_attendees(member_id)')
    .eq('project_id', projectId)
    .order('meeting_date', { ascending: true })

  const meetings = (rows ?? []).map((r: Row) => mapMeeting(r, attendeeIdsFrom(r)))
  const ids = meetings.map(m => m.id)
  let exceptions: MeetingException[] = []
  if (ids.length) {
    const { data: ex } = await sb
      .from('meeting_exceptions')
      .select('meeting_id, occurrence_date, kind')
      .in('meeting_id', ids)
    exceptions = (ex ?? []).map((e: Row) => ({
      meetingId: e.meeting_id as string,
      occurrenceDate: e.occurrence_date as string,
      kind: 'cancelled' as const,
    }))
  }
  return { meetings, exceptions }
})

/** 상세 모달 — body + 참석자 표시 정보. 없으면 null. */
export const getMeetingDetail = cache(async (
  id: string,
): Promise<{ meeting: Meeting; attendees: MeetingAttendeeInfo[] } | null> => {
  const sb = await createServerClient()
  const { data: r } = await sb
    .from('meetings')
    .select('id, project_id, title, meeting_date, start_time, end_time, location, category, body, recurrence, recurrence_until, created_by, created_by_name, created_at, updated_at, meeting_attendees(member_id)')
    .eq('id', id)
    .maybeSingle()
  if (!r) return null

  const attendeeIds = attendeeIdsFrom(r as Row)
  let attendees: MeetingAttendeeInfo[] = []
  if (attendeeIds.length) {
    const { data: mem } = await sb
      .from('project_members')
      .select('id, name, email, teams(code)')
      .in('id', attendeeIds)
    attendees = (mem ?? []).map((m: Row) => ({
      id: m.id as string,
      name: m.name as string,
      email: (m.email as string | null) ?? null,
      teamCode: ((m.teams as { code: TeamCode } | null)?.code) ?? null,
    }))
  }
  return { meeting: mapMeeting(r as Row, attendeeIds), attendees }
})

/** 현재 사용자 이메일과 lower 매칭되는 project_members.id 집합. 비로그인/무매칭 시 []. */
export const getMyMemberIds = cache(async (): Promise<string[]> => {
  const sb = await createServerClient()
  const { data: u } = await sb.auth.getUser()
  const email = u.user?.email
  if (!email) return []
  const { data } = await sb
    .from('project_members')
    .select('id')
    .ilike('email', email) // ilike = 대소문자 무시 동등(와일드카드 없는 값)
  return (data ?? []).map((r: Row) => r.id as string)
})

/**
 * 크로스 프로젝트 '내 회의' 범위 조회. body/location 제외(캘린더 필드만),
 * isMine(작성자==나 or 참석자에 내 member 포함) + projectName 세팅.
 * fetch 조건: 비반복은 [start,end], 반복은 meeting_date<=end AND (until IS NULL OR until>=start).
 */
export const getMyMeetings = cache(async (
  gridStartIso: string,
  gridEndIso: string,
): Promise<{ meetings: Meeting[]; exceptions: MeetingException[] }> => {
  const sb = await createServerClient()
  const { data: u } = await sb.auth.getUser()
  const uid = u.user?.id ?? null
  if (!uid) return { meetings: [], exceptions: [] }

  const myMemberIds = new Set(await getMyMemberIds())

  const orClause =
    `and(recurrence.eq.none,meeting_date.gte.${gridStartIso},meeting_date.lte.${gridEndIso}),` +
    `and(recurrence.neq.none,meeting_date.lte.${gridEndIso},or(recurrence_until.is.null,recurrence_until.gte.${gridStartIso}))`

  const { data: rows } = await sb
    .from('meetings')
    .select('id, project_id, title, meeting_date, start_time, end_time, category, recurrence, recurrence_until, created_by, created_by_name, created_at, updated_at, meeting_attendees(member_id), projects(name)')
    .or(orClause)
    .order('meeting_date', { ascending: true })

  const meetings = (rows ?? []).map((r: Row) => {
    const attendeeIds = attendeeIdsFrom(r)
    const projectName = ((r.projects as { name: string } | null)?.name) ?? null
    const isMine = (r.created_by as string | null) === uid || attendeeIds.some(id => myMemberIds.has(id))
    // 목록 payload 는 body/location 미포함(상세에서 로드)
    return mapMeeting({ ...r, body: '', location: null }, attendeeIds, {
      projectName: projectName ?? undefined,
      isMine,
    })
  })

  const ids = meetings.map(m => m.id)
  let exceptions: MeetingException[] = []
  if (ids.length) {
    const { data: ex } = await sb
      .from('meeting_exceptions')
      .select('meeting_id, occurrence_date, kind')
      .in('meeting_id', ids)
    exceptions = (ex ?? []).map((e: Row) => ({
      meetingId: e.meeting_id as string,
      occurrenceDate: e.occurrence_date as string,
      kind: 'cancelled' as const,
    }))
  }
  return { meetings, exceptions }
})
```

- [ ] **Step 2: 타입체크**

Run: `cd /Users/jerry/wbs-web && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
cd /Users/jerry/wbs-web
git add src/lib/data/meetings.ts
git commit -m "feat(meetings): 데이터 계층 — 프로젝트/내 회의/상세/본인 member 조회"
```

---

## Task 5: 서버 액션 (CRUD + 참석자 + 회차 취소)

**Files:**
- Create: `src/app/actions/meetings.ts`

**Interfaces:**
- Consumes: Task 1 타입, Task 4 `getMyMeetings`, `src/lib/domain/meetings.ts`의 검증 상수.
- Produces:
  - `createMeeting(projectId, input: MeetingInput): Promise<MeetingActionResult>`
  - `updateMeeting(id, input: MeetingInput): Promise<MeetingActionResult>`
  - `deleteMeeting(id): Promise<MeetingActionResult>`
  - `setMeetingAttendees(meetingId, memberIds: string[]): Promise<MeetingActionResult>`
  - `cancelOccurrence(meetingId, occurrenceDate): Promise<MeetingActionResult>`
  - `restoreOccurrence(meetingId, occurrenceDate): Promise<MeetingActionResult>`
  - `fetchMyMeetings(gridStartIso, gridEndIso)` — 클라이언트 호출용 얇은 래퍼.
  - `MeetingInput`, `MeetingActionResult` 타입.

- [ ] **Step 1: 구현**

Create `src/app/actions/meetings.ts`:

```ts
'use server'
import { createServerClient } from '@/lib/supabase/server'
import { getMembership, getSession } from '@/lib/auth'
import { revalidatePath } from 'next/cache'
import { getMyMeetings } from '@/lib/data/meetings'
import { expandMeetings } from '@/lib/domain/meetings'
import type { Meeting, MeetingCategory, MeetingException, MeetingRecurrence } from '@/lib/domain/types'

export interface MeetingInput {
  title: string
  meetingDate: string           // 'YYYY-MM-DD'
  startTime: string | null      // 'HH:MM' | null(종일)
  endTime: string | null
  location: string | null
  category: MeetingCategory
  body: string
  recurrence: MeetingRecurrence
  recurrenceUntil: string | null
  attendeeIds: string[]
}

export interface MeetingActionResult {
  ok: boolean
  error?: string
  id?: string
}

const CATEGORIES: MeetingCategory[] = ['general', 'routine', 'kickoff', 'review', 'report', 'external']
const RECURRENCES: MeetingRecurrence[] = ['none', 'daily', 'weekly', 'biweekly', 'monthly']
const TITLE_MAX = 200
const BODY_MAX = 20000
const LOCATION_MAX = 200
const TIME_RE = /^([01][0-9]|2[0-3]):[0-5][0-9]$/
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

function validate(input: MeetingInput): string | null {
  const title = input.title.trim()
  if (!title) return '제목을 입력하세요.'
  if (title.length > TITLE_MAX) return `제목은 ${TITLE_MAX}자 이하여야 합니다.`
  if (!DATE_RE.test(input.meetingDate)) return '날짜 형식이 올바르지 않습니다.'
  if (input.startTime !== null && !TIME_RE.test(input.startTime)) return '시작 시각 형식이 올바르지 않습니다.'
  if (input.endTime !== null && !TIME_RE.test(input.endTime)) return '종료 시각 형식이 올바르지 않습니다.'
  if (input.endTime !== null && input.startTime === null) return '종료 시각만 입력할 수 없습니다.'
  if (input.startTime && input.endTime && input.endTime <= input.startTime) return '종료 시각은 시작 시각보다 뒤여야 합니다.'
  if (input.body.length > BODY_MAX) return `회의록은 ${BODY_MAX}자 이하여야 합니다.`
  if (input.location && input.location.length > LOCATION_MAX) return `장소는 ${LOCATION_MAX}자 이하여야 합니다.`
  if (!CATEGORIES.includes(input.category)) return '잘못된 카테고리입니다.'
  if (!RECURRENCES.includes(input.recurrence)) return '잘못된 반복 옵션입니다.'
  if (input.recurrence === 'none' && input.recurrenceUntil !== null) return '반복 없음에는 종료일을 둘 수 없습니다.'
  if (input.recurrence !== 'none') {
    if (!input.recurrenceUntil || !DATE_RE.test(input.recurrenceUntil)) return '반복 종료일을 입력하세요.'
    if (input.recurrenceUntil < input.meetingDate) return '반복 종료일은 시작일 이후여야 합니다.'
  }
  return null
}

function toRow(input: MeetingInput) {
  return {
    title: input.title.trim(),
    meeting_date: input.meetingDate,
    start_time: input.startTime,
    end_time: input.endTime,
    location: input.location?.trim() || null,
    category: input.category,
    body: input.body,
    recurrence: input.recurrence,
    recurrence_until: input.recurrence === 'none' ? null : input.recurrenceUntil,
  }
}

function revalidateMeetings(projectId: string) {
  revalidatePath(`/p/${projectId}/meetings`)
  revalidatePath('/meetings')
}

/** 참석자 전체 교체(시리즈 단위). 소유권은 부모 RLS 가 강제. */
async function replaceAttendees(sb: Awaited<ReturnType<typeof createServerClient>>, meetingId: string, projectId: string, memberIds: string[]): Promise<string | null> {
  await sb.from('meeting_attendees').delete().eq('meeting_id', meetingId)
  const unique = [...new Set(memberIds)]
  if (unique.length === 0) return null
  // 다른 프로젝트 멤버 혼입 방지 — meeting 의 project_id 에 속한 member 만 허용
  const { data: valid } = await sb
    .from('project_members')
    .select('id')
    .eq('project_id', projectId)
    .in('id', unique)
  const validIds = (valid ?? []).map((r: { id: string }) => r.id)
  if (validIds.length === 0) return null
  const { error } = await sb.from('meeting_attendees').insert(validIds.map(id => ({ meeting_id: meetingId, member_id: id })))
  return error ? error.message : null
}

export async function createMeeting(projectId: string, input: MeetingInput): Promise<MeetingActionResult> {
  const m = await getMembership()
  if (!m) return { ok: false, error: '로그인 필요' }
  const err = validate(input)
  if (err) return { ok: false, error: err }

  const user = await getSession()
  if (!user) return { ok: false, error: '로그인 필요' }
  const sb = await createServerClient()
  const { data, error } = await sb
    .from('meetings')
    .insert({
      ...toRow(input),
      project_id: projectId,
      created_by: user.id,
      created_by_name: (user.user_metadata?.name as string | undefined) ?? user.email ?? null,
    })
    .select('id')
    .single()
  if (error) return { ok: false, error: error.message }
  const meetingId = data.id as string
  const attErr = await replaceAttendees(sb, meetingId, projectId, input.attendeeIds)
  if (attErr) return { ok: false, error: attErr }
  revalidateMeetings(projectId)
  return { ok: true, id: meetingId }
}

export async function updateMeeting(id: string, input: MeetingInput): Promise<MeetingActionResult> {
  const m = await getMembership()
  if (!m) return { ok: false, error: '로그인 필요' }
  const err = validate(input)
  if (err) return { ok: false, error: err }
  const user = await getSession()
  if (!user) return { ok: false, error: '로그인 필요' }

  const sb = await createServerClient()
  // 소유권 선검증(RLS 와 동일 — 0-row 무음 성공 방지) + 규칙 변경 감지
  const { data: cur } = await sb
    .from('meetings')
    .select('project_id, created_by, meeting_date, recurrence, recurrence_until')
    .eq('id', id)
    .maybeSingle()
  if (!cur) return { ok: false, error: '회의를 찾을 수 없습니다.' }
  const isOwner = (cur.created_by as string | null) === user.id
  if (!isOwner && m.role !== 'pmo_admin') return { ok: false, error: '권한 없음' }
  const projectId = cur.project_id as string

  const { error } = await sb
    .from('meetings')
    .update({ ...toRow(input), updated_at: new Date().toISOString() }) // created_by 는 SET 하지 않음(불변)
    .eq('id', id)
    .select('id')
    .single()
  if (error) return { ok: false, error: error.message }

  // 시작일/반복규칙/종료일이 바뀌면 취소 예외가 어긋나므로 전부 삭제(정직한 v1 의미)
  const ruleChanged =
    (cur.meeting_date as string) !== input.meetingDate ||
    (cur.recurrence as string) !== input.recurrence ||
    ((cur.recurrence_until as string | null) ?? null) !== input.recurrenceUntil
  if (ruleChanged) await sb.from('meeting_exceptions').delete().eq('meeting_id', id)

  const attErr = await replaceAttendees(sb, id, projectId, input.attendeeIds)
  if (attErr) return { ok: false, error: attErr }
  revalidateMeetings(projectId)
  return { ok: true, id }
}

export async function deleteMeeting(id: string): Promise<MeetingActionResult> {
  const m = await getMembership()
  if (!m) return { ok: false, error: '로그인 필요' }
  const user = await getSession()
  if (!user) return { ok: false, error: '로그인 필요' }
  const sb = await createServerClient()
  const { data: cur } = await sb.from('meetings').select('project_id, created_by').eq('id', id).maybeSingle()
  if (!cur) return { ok: false, error: '회의를 찾을 수 없습니다.' }
  const isOwner = (cur.created_by as string | null) === user.id
  if (!isOwner && m.role !== 'pmo_admin') return { ok: false, error: '권한 없음' }

  const { error } = await sb.from('meetings').delete().eq('id', id).select('id').single()
  if (error) return { ok: false, error: error.message }
  revalidateMeetings(cur.project_id as string)
  return { ok: true }
}

export async function setMeetingAttendees(meetingId: string, memberIds: string[]): Promise<MeetingActionResult> {
  const m = await getMembership()
  if (!m) return { ok: false, error: '로그인 필요' }
  const user = await getSession()
  if (!user) return { ok: false, error: '로그인 필요' }
  const sb = await createServerClient()
  const { data: cur } = await sb.from('meetings').select('project_id, created_by').eq('id', meetingId).maybeSingle()
  if (!cur) return { ok: false, error: '회의를 찾을 수 없습니다.' }
  const isOwner = (cur.created_by as string | null) === user.id
  if (!isOwner && m.role !== 'pmo_admin') return { ok: false, error: '권한 없음' }
  const attErr = await replaceAttendees(sb, meetingId, cur.project_id as string, memberIds)
  if (attErr) return { ok: false, error: attErr }
  revalidateMeetings(cur.project_id as string)
  return { ok: true }
}

/** occurrenceDate 가 실제 규칙상 회차인지 검증 후 취소 예외행 insert. */
export async function cancelOccurrence(meetingId: string, occurrenceDate: string): Promise<MeetingActionResult> {
  const gate = await occurrenceGate(meetingId, occurrenceDate)
  if (!gate.ok) return gate
  const sb = gate.sb
  const { error } = await sb
    .from('meeting_exceptions')
    .upsert({ meeting_id: meetingId, occurrence_date: occurrenceDate, kind: 'cancelled' }, { onConflict: 'meeting_id,occurrence_date' })
  if (error) return { ok: false, error: error.message }
  revalidateMeetings(gate.projectId)
  return { ok: true }
}

export async function restoreOccurrence(meetingId: string, occurrenceDate: string): Promise<MeetingActionResult> {
  const gate = await occurrenceGate(meetingId, occurrenceDate)
  if (!gate.ok) return gate
  const { error } = await gate.sb.from('meeting_exceptions').delete().eq('meeting_id', meetingId).eq('occurrence_date', occurrenceDate)
  if (error) return { ok: false, error: error.message }
  revalidateMeetings(gate.projectId)
  return { ok: true }
}

type Gate = { ok: true; sb: Awaited<ReturnType<typeof createServerClient>>; projectId: string } | { ok: false; error: string }
async function occurrenceGate(meetingId: string, occurrenceDate: string): Promise<Gate> {
  const m = await getMembership()
  if (!m) return { ok: false, error: '로그인 필요' }
  const user = await getSession()
  if (!user) return { ok: false, error: '로그인 필요' }
  if (!DATE_RE.test(occurrenceDate)) return { ok: false, error: '잘못된 날짜입니다.' }
  const sb = await createServerClient()
  const { data: r } = await sb
    .from('meetings')
    .select('project_id, created_by, title, meeting_date, start_time, end_time, location, category, recurrence, recurrence_until, created_by_name, created_at, updated_at')
    .eq('id', meetingId)
    .maybeSingle()
  if (!r) return { ok: false, error: '회의를 찾을 수 없습니다.' }
  const isOwner = (r.created_by as string | null) === user.id
  if (!isOwner && m.role !== 'pmo_admin') return { ok: false, error: '권한 없음' }
  if (r.recurrence === 'none') return { ok: false, error: '반복 회의만 회차를 취소할 수 있습니다.' }
  // 규칙상 실제 회차인지 검증 — 해당 날짜만 전개해 매칭
  const meeting = {
    id: meetingId, projectId: r.project_id as string, title: r.title as string,
    meetingDate: r.meeting_date as string, startTime: (r.start_time as string | null) ?? null,
    endTime: (r.end_time as string | null) ?? null, location: (r.location as string | null) ?? null,
    category: r.category as MeetingCategory, body: '', recurrence: r.recurrence as MeetingRecurrence,
    recurrenceUntil: (r.recurrence_until as string | null) ?? null, createdBy: r.created_by as string | null,
    createdByName: (r.created_by_name as string | null) ?? null, createdAt: r.created_at as string,
    updatedAt: r.updated_at as string, attendeeIds: [],
  } satisfies Meeting
  const occ = expandMeetings([meeting], [], occurrenceDate, occurrenceDate)
  if (!occ.some(o => o.occurrenceDate === occurrenceDate)) return { ok: false, error: '해당 날짜는 이 회의의 회차가 아닙니다.' }
  return { ok: true, sb, projectId: r.project_id as string }
}

/** 클라이언트(내 회의 뷰)에서 월 이동 시 호출하는 얇은 래퍼. */
export async function fetchMyMeetings(
  gridStartIso: string,
  gridEndIso: string,
): Promise<{ meetings: Meeting[]; exceptions: MeetingException[] }> {
  const user = await getSession()
  if (!user) return { meetings: [], exceptions: [] }
  return getMyMeetings(gridStartIso, gridEndIso)
}
```

- [ ] **Step 2: 타입체크 + 린트**

Run: `cd /Users/jerry/wbs-web && npx tsc --noEmit && npm run lint`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
cd /Users/jerry/wbs-web
git add src/app/actions/meetings.ts
git commit -m "feat(meetings): 서버 액션 — CRUD·참석자·회차취소(소유권 이중강제)"
```

---

## Task 6: i18n 사전

**Files:**
- Create: `src/lib/i18n/dict/meetings.ts`
- Modify: `src/lib/i18n/dict.ts`, `src/lib/i18n/dict/common.ts`

**Interfaces:**
- Consumes: 기존 dict 병합 패턴.
- Produces: `meet.*` 키 전체 + `nav.meetings`/`nav.myMeetings`.

- [ ] **Step 1: meetings 네임스페이스 작성**

Create `src/lib/i18n/dict/meetings.ts`:

```ts
export const meetingsKo = {
  'meet.heroTitleSuffix': '회의',
  'meet.heroDesc': '회의 일정과 참석자를 달력으로 관리합니다.',
  'meet.myHeroTitle': '내 회의',
  'meet.myHeroDesc': '내가 주최하거나 참석하는 모든 프로젝트의 회의입니다.',
  'meet.kpi.today': '오늘',
  'meet.kpi.todaySub': '오늘 예정된 회의',
  'meet.kpi.upcoming': '향후 7일',
  'meet.kpi.upcomingSub': '이번 주 회의',
  'meet.kpi.total': '이 달',
  'meet.kpi.totalSub': '표시 중인 회의',
  'meet.view.calendar': '달력',
  'meet.view.list': '리스트',
  'meet.addMeeting': '새 회의',
  'meet.editMeeting': '회의 수정',
  'meet.today': '오늘',
  'meet.prevMonth': '이전 달',
  'meet.nextMonth': '다음 달',
  'meet.onlyMine': '내 것만',
  'meet.allProjects': '전체 프로젝트',
  'meet.moreSuffix': '건 더',
  'meet.allDay': '종일',
  'meet.recurring': '반복',
  'meet.cancelled': '취소됨',
  'meet.cat.general': '일반',
  'meet.cat.routine': '정례',
  'meet.cat.kickoff': '킥오프',
  'meet.cat.review': '리뷰',
  'meet.cat.report': '보고',
  'meet.cat.external': '외부/고객',
  'meet.recur.none': '반복 안 함',
  'meet.recur.daily': '매일',
  'meet.recur.weekly': '매주',
  'meet.recur.biweekly': '격주',
  'meet.recur.monthly': '매월',
  'meet.form.title': '제목',
  'meet.form.date': '날짜',
  'meet.form.allDay': '종일',
  'meet.form.start': '시작',
  'meet.form.end': '종료',
  'meet.form.location': '장소',
  'meet.form.category': '유형',
  'meet.form.recurrence': '반복',
  'meet.form.recurrenceUntil': '반복 종료일',
  'meet.form.attendees': '참석자',
  'meet.form.body': '회의록/메모',
  'meet.form.bodyPlaceholder': '안건, 결정사항, 메모…',
  'meet.form.titlePlaceholder': '예: 주간 정례 회의',
  'meet.form.locationPlaceholder': '예: 3층 회의실 / 화상',
  'meet.form.ruleChangeWarn': '반복 규칙이나 시작일을 바꾸면 취소했던 회차가 복원됩니다.',
  'meet.form.noEmailWarn': '이메일 없음 — 내 회의에 표시되지 않을 수 있습니다.',
  'meet.attendeeSearch': '이름·팀 검색',
  'meet.attendeeSelected': '명 선택',
  'meet.detail.attendees': '참석자',
  'meet.detail.noAttendees': '지정된 참석자가 없습니다.',
  'meet.detail.body': '회의록',
  'meet.detail.noBody': '작성된 회의록이 없습니다.',
  'meet.detail.location': '장소',
  'meet.detail.createdBy': '작성자',
  'meet.detail.cancelOccurrence': '이 회차 취소',
  'meet.detail.restoreOccurrence': '이 회차 복원',
  'meet.detail.editSeries': '수정',
  'meet.detail.deleteSeries': '삭제',
  'meet.detail.cancelledBadge': '취소된 회차',
  'meet.delete.title': '회의 삭제',
  'meet.delete.confirm': '이 회의를 삭제할까요? 반복 회의는 모든 회차가 삭제되며 되돌릴 수 없습니다.',
  'meet.cancelOcc.title': '이 회차 취소',
  'meet.cancelOcc.confirm': '이 날짜의 회차만 취소합니다. 시리즈의 다른 회차는 유지됩니다.',
  'meet.empty.title': '등록된 회의가 없습니다',
  'meet.empty.desc': '새 회의를 추가해 일정을 관리하세요.',
  'meet.empty.mineTitle': '표시할 내 회의가 없습니다',
  'meet.empty.mineDesc': '로스터 이메일이 로그인 이메일과 일치할 때 회의가 표시됩니다. "전체 프로젝트"로 모든 회의를 볼 수 있습니다.',
  'meet.col.date': '날짜',
  'meet.col.time': '시간',
  'meet.col.title': '제목',
  'meet.col.project': '프로젝트',
  'meet.col.category': '유형',
  'meet.col.attendees': '참석자',
  'meet.saving': '저장 중…',
  'meet.deleting': '삭제 중…',
  'meet.loadFailed': '불러오지 못했습니다.',
  'meet.saveFailed': '저장에 실패했습니다.',
  'meet.deleteFailed': '삭제에 실패했습니다.',
} as const

export const meetingsEn: Record<keyof typeof meetingsKo, string> = {
  'meet.heroTitleSuffix': 'Meetings',
  'meet.heroDesc': 'Manage meeting schedules and attendees on a calendar.',
  'meet.myHeroTitle': 'My Meetings',
  'meet.myHeroDesc': 'Meetings you host or attend across all projects.',
  'meet.kpi.today': 'TODAY',
  'meet.kpi.todaySub': "Today's meetings",
  'meet.kpi.upcoming': 'NEXT 7 DAYS',
  'meet.kpi.upcomingSub': 'This week',
  'meet.kpi.total': 'THIS MONTH',
  'meet.kpi.totalSub': 'Shown meetings',
  'meet.view.calendar': 'Calendar',
  'meet.view.list': 'List',
  'meet.addMeeting': 'New meeting',
  'meet.editMeeting': 'Edit meeting',
  'meet.today': 'Today',
  'meet.prevMonth': 'Previous month',
  'meet.nextMonth': 'Next month',
  'meet.onlyMine': 'Only mine',
  'meet.allProjects': 'All projects',
  'meet.moreSuffix': ' more',
  'meet.allDay': 'All day',
  'meet.recurring': 'Recurring',
  'meet.cancelled': 'Cancelled',
  'meet.cat.general': 'General',
  'meet.cat.routine': 'Routine',
  'meet.cat.kickoff': 'Kickoff',
  'meet.cat.review': 'Review',
  'meet.cat.report': 'Report',
  'meet.cat.external': 'External',
  'meet.recur.none': 'Does not repeat',
  'meet.recur.daily': 'Daily',
  'meet.recur.weekly': 'Weekly',
  'meet.recur.biweekly': 'Every 2 weeks',
  'meet.recur.monthly': 'Monthly',
  'meet.form.title': 'Title',
  'meet.form.date': 'Date',
  'meet.form.allDay': 'All day',
  'meet.form.start': 'Start',
  'meet.form.end': 'End',
  'meet.form.location': 'Location',
  'meet.form.category': 'Type',
  'meet.form.recurrence': 'Repeat',
  'meet.form.recurrenceUntil': 'Repeat until',
  'meet.form.attendees': 'Attendees',
  'meet.form.body': 'Minutes / notes',
  'meet.form.bodyPlaceholder': 'Agenda, decisions, notes…',
  'meet.form.titlePlaceholder': 'e.g. Weekly sync',
  'meet.form.locationPlaceholder': 'e.g. Room 3F / Video',
  'meet.form.ruleChangeWarn': 'Changing the repeat rule or start date restores previously cancelled occurrences.',
  'meet.form.noEmailWarn': 'No email — may not appear in My Meetings.',
  'meet.attendeeSearch': 'Search name or team',
  'meet.attendeeSelected': ' selected',
  'meet.detail.attendees': 'Attendees',
  'meet.detail.noAttendees': 'No attendees assigned.',
  'meet.detail.body': 'Minutes',
  'meet.detail.noBody': 'No minutes recorded.',
  'meet.detail.location': 'Location',
  'meet.detail.createdBy': 'Created by',
  'meet.detail.cancelOccurrence': 'Cancel this occurrence',
  'meet.detail.restoreOccurrence': 'Restore this occurrence',
  'meet.detail.editSeries': 'Edit',
  'meet.detail.deleteSeries': 'Delete',
  'meet.detail.cancelledBadge': 'Cancelled occurrence',
  'meet.delete.title': 'Delete meeting',
  'meet.delete.confirm': 'Delete this meeting? For recurring meetings all occurrences are removed. This cannot be undone.',
  'meet.cancelOcc.title': 'Cancel this occurrence',
  'meet.cancelOcc.confirm': 'Cancels only this date. Other occurrences in the series remain.',
  'meet.empty.title': 'No meetings yet',
  'meet.empty.desc': 'Add a meeting to start managing your schedule.',
  'meet.empty.mineTitle': 'No meetings to show',
  'meet.empty.mineDesc': 'Meetings appear when a roster email matches your login email. Use "All projects" to see everything.',
  'meet.col.date': 'Date',
  'meet.col.time': 'Time',
  'meet.col.title': 'Title',
  'meet.col.project': 'Project',
  'meet.col.category': 'Type',
  'meet.col.attendees': 'Attendees',
  'meet.saving': 'Saving…',
  'meet.deleting': 'Deleting…',
  'meet.loadFailed': 'Failed to load.',
  'meet.saveFailed': 'Failed to save.',
  'meet.deleteFailed': 'Failed to delete.',
}
```

- [ ] **Step 2: dict.ts 병합**

`src/lib/i18n/dict.ts`에서 import 추가(9번째 줄 announcements import 아래):

```ts
import { meetingsKo, meetingsEn } from './dict/meetings'
```

`DICT.ko`의 `...announcementsKo,` 아래에 `...meetingsKo,` 추가, `DICT.en`의 `...announcementsEn,` 아래에 `...meetingsEn,` 추가.

- [ ] **Step 3: common.ts에 nav 키 추가**

`src/lib/i18n/dict/common.ts`의 ko 객체에서 `nav.announcements` 키 옆에 추가하고, en에도 대응 추가:

```ts
// ko:
'nav.meetings': '회의',
'nav.myMeetings': '내 회의',
// en:
'nav.meetings': 'Meetings',
'nav.myMeetings': 'My Meetings',
```

(정확한 위치: `common.ts`를 열어 `'nav.announcements'`를 찾아 같은 블록에 삽입. ko/en 양쪽 필수 — 패리티 타입 강제.)

- [ ] **Step 4: 타입체크(패리티 검증)**

Run: `cd /Users/jerry/wbs-web && npx tsc --noEmit`
Expected: PASS. 실패 시 ko/en 키 누락 — 메시지의 누락 키를 채운다.

- [ ] **Step 5: Commit**

```bash
cd /Users/jerry/wbs-web
git add src/lib/i18n/dict/meetings.ts src/lib/i18n/dict.ts src/lib/i18n/dict/common.ts
git commit -m "feat(meetings): i18n 사전(meet.*) + nav 키"
```

---

## Task 7: 참석자 선택 컴포넌트

**Files:**
- Create: `src/components/meetings/MeetingAttendeePicker.tsx`

**Interfaces:**
- Consumes: `ProjectMember`(types), `useLocale`.
- Produces: `<MeetingAttendeePicker members={ProjectMember[]} selected={string[]} onChange={(ids)=>void} />`.

- [ ] **Step 1: 구현**

Create `src/components/meetings/MeetingAttendeePicker.tsx`:

```tsx
'use client'

import { useMemo, useState } from 'react'
import { Search, AlertCircle } from 'lucide-react'
import type { ProjectMember } from '@/lib/domain/types'
import { useLocale } from '@/components/providers/LocaleProvider'

export function MeetingAttendeePicker({
  members, selected, onChange,
}: {
  members: ProjectMember[]
  selected: string[]
  onChange: (ids: string[]) => void
}) {
  const { t } = useLocale()
  const [q, setQ] = useState('')
  const selectedSet = useMemo(() => new Set(selected), [selected])

  const filtered = useMemo(() => {
    const kw = q.trim().toLowerCase()
    if (!kw) return members
    return members.filter(m =>
      m.name.toLowerCase().includes(kw) || (m.teamCode ?? '').toLowerCase().includes(kw))
  }, [members, q])

  const toggle = (id: string) => {
    const next = new Set(selectedSet)
    if (next.has(id)) next.delete(id); else next.add(id)
    onChange([...next])
  }

  return (
    <div className="rounded-xl border border-line bg-surface">
      <div className="flex items-center gap-2 border-b border-line px-3 py-2">
        <Search className="h-4 w-4 shrink-0 text-ink-subtle" />
        <input
          value={q}
          onChange={e => setQ(e.target.value)}
          placeholder={t('meet.attendeeSearch')}
          className="w-full bg-transparent text-sm text-ink outline-none placeholder:text-ink-subtle"
        />
        <span className="shrink-0 text-[11px] font-medium text-ink-subtle">{selected.length}{t('meet.attendeeSelected')}</span>
      </div>
      <div className="max-h-52 overflow-y-auto p-1.5">
        {filtered.length === 0 && (
          <div className="px-2 py-6 text-center text-xs text-ink-subtle">—</div>
        )}
        {filtered.map(m => {
          const checked = selectedSet.has(m.id)
          return (
            <label key={m.id} className={`flex cursor-pointer items-center gap-2.5 rounded-lg px-2 py-1.5 transition hover:bg-surface-2 ${checked ? 'bg-brand-weak/40' : ''}`}>
              <input type="checkbox" checked={checked} onChange={() => toggle(m.id)} className="h-4 w-4 accent-[var(--color-brand)]" />
              <span className="flex min-w-0 flex-1 items-center gap-1.5">
                <span className="truncate text-sm text-ink">{m.name}</span>
                {m.teamCode && <span className="shrink-0 text-[11px] text-ink-subtle">· {m.teamCode}</span>}
              </span>
              {!m.email && (
                <span className="inline-flex shrink-0 items-center gap-1 text-[10px] font-medium text-delayed" title={t('meet.form.noEmailWarn')}>
                  <AlertCircle className="h-3 w-3" />
                </span>
              )}
            </label>
          )
        })}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: 타입체크**

Run: `cd /Users/jerry/wbs-web && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
cd /Users/jerry/wbs-web
git add src/components/meetings/MeetingAttendeePicker.tsx
git commit -m "feat(meetings): 참석자 선택 컴포넌트(팀 검색·이메일 없음 경고)"
```

---

## Task 8: 월 그리드 컴포넌트

**Files:**
- Create: `src/components/meetings/MeetingCalendar.tsx`

**Interfaces:**
- Consumes: `MeetingOccurrence`(types), `monthMatrix`/`occurrencesByDate`/`sortOccurrences`/`MEETING_META`(domain), `krSpecialDayMap`(holidays), `useLocale`.
- Produces: `<MeetingCalendar year month0 todayIso occurrences onSelectOccurrence onSelectDate colorByProject? />`.

- [ ] **Step 1: 구현**

Create `src/components/meetings/MeetingCalendar.tsx`:

```tsx
'use client'

import { useMemo } from 'react'
import type { MeetingOccurrence } from '@/lib/domain/types'
import type { DictKey } from '@/lib/i18n/dict'
import { useLocale } from '@/components/providers/LocaleProvider'
import { monthMatrix } from '@/lib/domain/attendance'
import { occurrencesByDate, sortOccurrences, MEETING_META } from '@/lib/domain/meetings'
import { krSpecialDayMap } from '@/lib/domain/holidays'

const WEEKDAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const

function dowClass(dow: number, base = 'text-ink') {
  if (dow === 0) return 'text-delayed'
  if (dow === 6) return 'text-progress'
  return base
}

export function MeetingCalendar({
  year, month0, todayIso, occurrences, onSelectOccurrence,
}: {
  year: number
  month0: number
  todayIso: string
  occurrences: MeetingOccurrence[]
  onSelectOccurrence: (o: MeetingOccurrence) => void
}) {
  const { t } = useLocale()
  const matrix = useMemo(() => monthMatrix(year, month0), [year, month0])
  const byDate = useMemo(() => occurrencesByDate(occurrences), [occurrences])
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
          const dayOcc = sortOccurrences(byDate[cell] ?? [])
          const special = specialDays.get(cell)
          const isRestDay = !!special && special.kind !== 'anniversary'
          const specialName = special ? t(`hol.${special.name}` as DictKey) : null
          return (
            <div key={cell} className={`min-h-[104px] bg-surface p-1.5 ${inMonth ? '' : 'opacity-40'}`}>
              <div className="flex items-center justify-between gap-1 px-0.5">
                <span className={`inline-flex h-6 min-w-6 shrink-0 items-center justify-center rounded-full px-1 text-xs font-semibold tabular-nums ${isToday ? 'bg-brand text-white' : isRestDay ? 'text-delayed' : dowClass(dow)}`}>
                  {dayNum}
                </span>
                {specialName && (
                  <span className={`min-w-0 truncate text-[10px] font-medium ${isRestDay ? 'text-delayed' : 'text-ink-subtle'}`} title={specialName}>
                    {specialName}
                  </span>
                )}
              </div>
              <div className="mt-1 space-y-1">
                {dayOcc.slice(0, 3).map(o => {
                  const meta = MEETING_META[o.category]
                  const timeLabel = o.startTime ?? t('meet.allDay')
                  return (
                    <button
                      key={o.occurrenceId}
                      onClick={() => onSelectOccurrence(o)}
                      className={`flex w-full items-center gap-1 rounded-md px-1.5 py-0.5 text-left text-[10.5px] font-medium ${meta.chip} cursor-pointer transition hover:ring-1 hover:ring-brand-ring focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-ring`}
                      title={`${timeLabel} · ${o.title}`}
                    >
                      <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${meta.dot}`} />
                      <span className="shrink-0 tabular-nums opacity-80">{timeLabel}</span>
                      <span className="truncate">{o.title}</span>
                    </button>
                  )
                })}
                {dayOcc.length > 3 && (
                  <div className="px-1 text-[10px] font-medium text-ink-subtle">+{dayOcc.length - 3}{t('meet.moreSuffix')}</div>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: 타입체크**

Run: `cd /Users/jerry/wbs-web && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
cd /Users/jerry/wbs-web
git add src/components/meetings/MeetingCalendar.tsx
git commit -m "feat(meetings): 월 그리드 캘린더(근태 그리드 패턴 재사용)"
```

---

## Task 9: 회의 폼 모달 (생성/편집)

**Files:**
- Create: `src/components/meetings/MeetingFormModal.tsx`

**Interfaces:**
- Consumes: `Meeting`/`ProjectMember`/카테고리·반복 타입, `MEETING_CATEGORIES`/`RECURRENCE_ORDER`(domain), `createMeeting`/`updateMeeting`(actions), `MeetingAttendeePicker`(Task 7), `Modal`, `useToast`, `useLocale`.
- Produces: `<MeetingFormModal open projectId members initial={Meeting|null} onClose onSaved />`.

- [ ] **Step 1: 구현**

Create `src/components/meetings/MeetingFormModal.tsx`:

```tsx
'use client'

import { useEffect, useState, useTransition } from 'react'
import { AlertTriangle } from 'lucide-react'
import type { DictKey } from '@/lib/i18n/dict'
import type { Meeting, MeetingCategory, MeetingRecurrence, ProjectMember } from '@/lib/domain/types'
import { useLocale } from '@/components/providers/LocaleProvider'
import { Modal } from '@/components/ui/Modal'
import { MEETING_CATEGORIES, RECURRENCE_ORDER } from '@/lib/domain/meetings'
import { MeetingAttendeePicker } from './MeetingAttendeePicker'
import { createMeeting, updateMeeting, type MeetingInput } from '@/app/actions/meetings'

type FormState = {
  title: string; meetingDate: string; allDay: boolean; startTime: string; endTime: string
  location: string; category: MeetingCategory; recurrence: MeetingRecurrence
  recurrenceUntil: string; body: string; attendeeIds: string[]
}

function initState(initial: Meeting | null, todayIso: string): FormState {
  if (!initial) return {
    title: '', meetingDate: todayIso, allDay: false, startTime: '10:00', endTime: '11:00',
    location: '', category: 'routine', recurrence: 'none', recurrenceUntil: '', body: '', attendeeIds: [],
  }
  return {
    title: initial.title,
    meetingDate: initial.meetingDate,
    allDay: initial.startTime === null,
    startTime: initial.startTime ?? '10:00',
    endTime: initial.endTime ?? '',
    location: initial.location ?? '',
    category: initial.category,
    recurrence: initial.recurrence,
    recurrenceUntil: initial.recurrenceUntil ?? '',
    body: initial.body,
    attendeeIds: initial.attendeeIds,
  }
}

export function MeetingFormModal({
  open, projectId, members, initial, todayIso, onClose, onSaved,
}: {
  open: boolean
  projectId: string
  members: ProjectMember[]
  initial: Meeting | null
  todayIso: string
  onClose: () => void
  onSaved: () => void
}) {
  const { t } = useLocale()
  const [form, setForm] = useState<FormState>(() => initState(initial, todayIso))
  const [err, setErr] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  useEffect(() => { if (open) { setForm(initState(initial, todayIso)); setErr(null) } }, [open, initial, todayIso])

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setForm(f => ({ ...f, [k]: v }))

  function submit() {
    const input: MeetingInput = {
      title: form.title,
      meetingDate: form.meetingDate,
      startTime: form.allDay ? null : form.startTime,
      endTime: form.allDay || !form.endTime ? null : form.endTime,
      location: form.location.trim() || null,
      category: form.category,
      body: form.body,
      recurrence: form.recurrence,
      recurrenceUntil: form.recurrence === 'none' ? null : (form.recurrenceUntil || null),
      attendeeIds: form.attendeeIds,
    }
    setErr(null)
    startTransition(async () => {
      const res = initial ? await updateMeeting(initial.id, input) : await createMeeting(projectId, input)
      if (!res.ok) { setErr(res.error ?? t('meet.saveFailed')); return }
      onSaved()
    })
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      eyebrow="MEETING"
      title={initial ? t('meet.editMeeting') : t('meet.addMeeting')}
      footer={
        <>
          <button onClick={onClose} className="btn btn-ghost">{t('common.cancel')}</button>
          <button onClick={submit} disabled={pending} className="btn btn-primary">{pending ? t('meet.saving') : t('common.save')}</button>
        </>
      }
    >
      <div className="space-y-4">
        <label className="block">
          <span className="mb-1.5 block text-xs font-semibold text-ink-muted">{t('meet.form.title')}</span>
          <input value={form.title} onChange={e => set('title', e.target.value)} placeholder={t('meet.form.titlePlaceholder')} className="app-input" />
        </label>

        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="mb-1.5 block text-xs font-semibold text-ink-muted">{t('meet.form.date')}</span>
            <input type="date" value={form.meetingDate} onChange={e => set('meetingDate', e.target.value)} className="app-input px-2 text-xs" />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-xs font-semibold text-ink-muted">{t('meet.form.category')}</span>
            <select value={form.category} onChange={e => set('category', e.target.value as MeetingCategory)} className="app-input">
              {MEETING_CATEGORIES.map(c => <option key={c} value={c}>{t(`meet.cat.${c}` as DictKey)}</option>)}
            </select>
          </label>
        </div>

        <div className="flex items-center gap-2">
          <input id="allday" type="checkbox" checked={form.allDay} onChange={e => set('allDay', e.target.checked)} className="h-4 w-4 accent-[var(--color-brand)]" />
          <label htmlFor="allday" className="text-xs font-semibold text-ink-muted">{t('meet.form.allDay')}</label>
        </div>
        {!form.allDay && (
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="mb-1.5 block text-xs font-semibold text-ink-muted">{t('meet.form.start')}</span>
              <input type="time" value={form.startTime} onChange={e => set('startTime', e.target.value)} className="app-input px-2 text-xs" />
            </label>
            <label className="block">
              <span className="mb-1.5 block text-xs font-semibold text-ink-muted">{t('meet.form.end')}</span>
              <input type="time" value={form.endTime} onChange={e => set('endTime', e.target.value)} className="app-input px-2 text-xs" />
            </label>
          </div>
        )}

        <label className="block">
          <span className="mb-1.5 block text-xs font-semibold text-ink-muted">{t('meet.form.location')}</span>
          <input value={form.location} onChange={e => set('location', e.target.value)} placeholder={t('meet.form.locationPlaceholder')} className="app-input" />
        </label>

        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="mb-1.5 block text-xs font-semibold text-ink-muted">{t('meet.form.recurrence')}</span>
            <select value={form.recurrence} onChange={e => set('recurrence', e.target.value as MeetingRecurrence)} className="app-input">
              {RECURRENCE_ORDER.map(r => <option key={r} value={r}>{t(`meet.recur.${r}` as DictKey)}</option>)}
            </select>
          </label>
          {form.recurrence !== 'none' && (
            <label className="block">
              <span className="mb-1.5 block text-xs font-semibold text-ink-muted">{t('meet.form.recurrenceUntil')}</span>
              <input type="date" min={form.meetingDate} value={form.recurrenceUntil} onChange={e => set('recurrenceUntil', e.target.value)} className="app-input px-2 text-xs" />
            </label>
          )}
        </div>
        {initial && initial.recurrence !== 'none' && (
          <p className="flex items-start gap-1.5 text-[11px] leading-5 text-ink-subtle">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-pending" />
            {t('meet.form.ruleChangeWarn')}
          </p>
        )}

        <div>
          <span className="mb-1.5 block text-xs font-semibold text-ink-muted">{t('meet.form.attendees')}</span>
          <MeetingAttendeePicker members={members} selected={form.attendeeIds} onChange={ids => set('attendeeIds', ids)} />
        </div>

        <label className="block">
          <span className="mb-1.5 block text-xs font-semibold text-ink-muted">{t('meet.form.body')}</span>
          <textarea value={form.body} onChange={e => set('body', e.target.value)} rows={3} placeholder={t('meet.form.bodyPlaceholder')} className="app-textarea" />
        </label>

        {err && (
          <p className="flex items-center gap-1.5 rounded-lg bg-delayed-weak px-3 py-2 text-xs font-medium text-delayed">
            <AlertTriangle className="h-4 w-4 shrink-0" />{err}
          </p>
        )}
      </div>
    </Modal>
  )
}
```

- [ ] **Step 2: 타입체크**

Run: `cd /Users/jerry/wbs-web && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
cd /Users/jerry/wbs-web
git add src/components/meetings/MeetingFormModal.tsx
git commit -m "feat(meetings): 회의 생성/편집 폼 모달(반복·종일·참석자)"
```

---

## Task 10: 회의 상세 모달

**Files:**
- Create: `src/components/meetings/MeetingDetailModal.tsx`

**Interfaces:**
- Consumes: `MeetingOccurrence`/`Meeting`/`MeetingAttendeeInfo`, `getMeetingDetail`(data — 서버 컴포넌트 전용이라 여기선 액션 경유 필요), `MEETING_META`/`canEditMeeting`(domain), `Modal`, `useToast`, `useLocale`, actions `cancelOccurrence`/`restoreOccurrence`/`deleteMeeting`.
- Produces: `<MeetingDetailModal open occurrence isCancelled currentUserId role onClose onEdit onChanged />`.

**참고:** `getMeetingDetail`는 `lib/data`(서버 전용)라 클라이언트에서 직접 못 부른다. Task 5 액션에 상세 로더 래퍼를 추가한다.

- [ ] **Step 1: 상세 로더 액션 추가**

`src/app/actions/meetings.ts` 하단에 append(그리고 상단 import에 `getMeetingDetail` 추가):

```ts
// 상단 import 에 추가:
// import { getMyMeetings, getMeetingDetail } from '@/lib/data/meetings'
// import type { Meeting, MeetingAttendeeInfo, MeetingCategory, MeetingException, MeetingRecurrence } from '@/lib/domain/types'

export async function fetchMeetingDetail(id: string): Promise<{ meeting: Meeting; attendees: MeetingAttendeeInfo[] } | null> {
  const user = await getSession()
  if (!user) return null
  return getMeetingDetail(id)
}
```

(Task 4의 `getMeetingDetail`, Task 5의 `fetchMyMeetings`와 동일 위임 패턴. import 라인은 기존 `getMyMeetings` import를 `getMyMeetings, getMeetingDetail`로 확장하고, 타입 import에 `MeetingAttendeeInfo` 추가.)

- [ ] **Step 2: 상세 모달 구현**

Create `src/components/meetings/MeetingDetailModal.tsx`:

```tsx
'use client'

import { useEffect, useState, useTransition } from 'react'
import { CalendarDays, Clock4, MapPin, Repeat, Trash2, Pencil, Ban, RotateCcw, User } from 'lucide-react'
import type { DictKey } from '@/lib/i18n/dict'
import type { Meeting, MeetingAttendeeInfo, MeetingOccurrence } from '@/lib/domain/types'
import { useLocale } from '@/components/providers/LocaleProvider'
import { Modal } from '@/components/ui/Modal'
import { fmtDate } from '@/components/wbs/shared'
import { MEETING_META, canEditMeeting } from '@/lib/domain/meetings'
import { fetchMeetingDetail, cancelOccurrence, restoreOccurrence, deleteMeeting } from '@/app/actions/meetings'

export function MeetingDetailModal({
  open, occurrence, isCancelled, currentUserId, role, onClose, onEditSeries, onChanged,
}: {
  open: boolean
  occurrence: MeetingOccurrence | null
  isCancelled: boolean
  currentUserId: string | null
  role: string | null
  onClose: () => void
  onEditSeries: (m: Meeting) => void
  onChanged: () => void
}) {
  const { t } = useLocale()
  const [detail, setDetail] = useState<{ meeting: Meeting; attendees: MeetingAttendeeInfo[] } | null>(null)
  const [loading, setLoading] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [pending, startTransition] = useTransition()

  useEffect(() => {
    if (!open || !occurrence) { setDetail(null); setConfirmDelete(false); return }
    let alive = true
    setLoading(true)
    fetchMeetingDetail(occurrence.seriesId)
      .then(d => { if (alive) setDetail(d) })
      .catch(() => {})
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [open, occurrence])

  if (!occurrence) return null
  const meta = MEETING_META[occurrence.category]
  const canEdit = detail ? canEditMeeting(detail.meeting, currentUserId, role) : false
  const timeLabel = occurrence.startTime
    ? `${occurrence.startTime}${occurrence.endTime ? `–${occurrence.endTime}` : ''}`
    : t('meet.allDay')

  const runCancel = () => startTransition(async () => {
    const res = isCancelled
      ? await restoreOccurrence(occurrence.seriesId, occurrence.occurrenceDate)
      : await cancelOccurrence(occurrence.seriesId, occurrence.occurrenceDate)
    if (res.ok) { onChanged(); onClose() }
  })
  const runDelete = () => startTransition(async () => {
    const res = await deleteMeeting(occurrence.seriesId)
    if (res.ok) { onChanged(); onClose() }
  })

  return (
    <Modal
      open={open && !confirmDelete}
      onClose={onClose}
      eyebrow={<span className={`chip ${meta.chip}`}><span className={`h-1.5 w-1.5 rounded-full ${meta.dot}`} />{t(meta.labelKey as DictKey)}</span>}
      title={occurrence.title}
      footer={canEdit ? (
        <>
          {occurrence.isRecurring && (
            <button onClick={runCancel} disabled={pending} className="btn btn-ghost mr-auto text-pending hover:bg-pending-weak">
              {isCancelled ? <><RotateCcw className="h-4 w-4" />{t('meet.detail.restoreOccurrence')}</> : <><Ban className="h-4 w-4" />{t('meet.detail.cancelOccurrence')}</>}
            </button>
          )}
          <button onClick={() => setConfirmDelete(true)} disabled={pending} className="btn btn-ghost text-delayed hover:bg-delayed-weak"><Trash2 className="h-4 w-4" />{t('meet.detail.deleteSeries')}</button>
          <button onClick={() => detail && onEditSeries(detail.meeting)} disabled={pending || !detail} className="btn btn-primary"><Pencil className="h-4 w-4" />{t('meet.detail.editSeries')}</button>
        </>
      ) : (
        <button onClick={onClose} className="btn btn-ghost">{t('common.close')}</button>
      )}
    >
      <div className="space-y-3 text-sm">
        {isCancelled && (
          <div className="rounded-lg bg-delayed-weak px-3 py-1.5 text-xs font-semibold text-delayed">{t('meet.detail.cancelledBadge')}</div>
        )}
        <div className="flex items-center gap-2 text-ink"><CalendarDays className="h-4 w-4 text-ink-subtle" />{fmtDate(occurrence.occurrenceDate)}
          {occurrence.isRecurring && <span className="inline-flex items-center gap-1 text-[11px] text-ink-subtle"><Repeat className="h-3 w-3" />{t('meet.recurring')}</span>}
        </div>
        <div className="flex items-center gap-2 text-ink"><Clock4 className="h-4 w-4 text-ink-subtle" /><span className="tabular-nums">{timeLabel}</span></div>
        {occurrence.location && <div className="flex items-center gap-2 text-ink"><MapPin className="h-4 w-4 text-ink-subtle" />{occurrence.location}</div>}
        {detail?.meeting.createdByName && <div className="flex items-center gap-2 text-ink-muted"><User className="h-4 w-4 text-ink-subtle" />{t('meet.detail.createdBy')}: {detail.meeting.createdByName}</div>}

        <div>
          <div className="mb-1.5 text-xs font-semibold text-ink-muted">{t('meet.detail.attendees')}</div>
          {loading ? <div className="text-xs text-ink-subtle">…</div>
            : (detail?.attendees.length ?? 0) === 0 ? <div className="text-xs text-ink-subtle">{t('meet.detail.noAttendees')}</div>
            : (
              <div className="flex flex-wrap gap-1.5">
                {detail!.attendees.map(a => (
                  <span key={a.id} className="chip bg-surface-2 text-ink">{a.name}{a.teamCode ? ` · ${a.teamCode}` : ''}</span>
                ))}
              </div>
            )}
        </div>

        <div>
          <div className="mb-1.5 text-xs font-semibold text-ink-muted">{t('meet.detail.body')}</div>
          {loading ? <div className="text-xs text-ink-subtle">…</div>
            : detail?.meeting.body ? <p className="whitespace-pre-wrap text-sm leading-6 text-ink-muted">{detail.meeting.body}</p>
            : <div className="text-xs text-ink-subtle">{t('meet.detail.noBody')}</div>}
        </div>
      </div>
    </Modal>
  )
}
```

**참고:** 삭제 확인은 별도 Modal이 필요하다. 위 컴포넌트의 `confirmDelete`가 true일 때 렌더되는 확인 Modal을 같은 파일에 형제로 추가한다(AttendanceView의 삭제 확인 모달 패턴 — `open={open && confirmDelete}`, 취소 시 `setConfirmDelete(false)`, 확인 시 `runDelete`). 다음 스텝에서 추가.

- [ ] **Step 3: 삭제 확인 모달 형제 추가**

`MeetingDetailModal` return의 최상위를 `<>...</>`로 감싸고, 첫 Modal 뒤에 형제로 추가:

```tsx
      <Modal
        open={open && confirmDelete}
        onClose={() => { if (!pending) setConfirmDelete(false) }}
        size="sm"
        eyebrow="Delete meeting"
        title={t('meet.delete.title')}
        footer={
          <>
            <button onClick={() => setConfirmDelete(false)} disabled={pending} className="btn btn-ghost">{t('common.cancel')}</button>
            <button onClick={runDelete} disabled={pending} className="btn bg-delayed text-white hover:brightness-105 disabled:opacity-50">{pending ? t('meet.deleting') : t('common.delete')}</button>
          </>
        }
      >
        <p className="text-sm leading-6 text-ink-muted">{t('meet.delete.confirm')}</p>
      </Modal>
```

(첫 Modal의 `open`은 `open && !confirmDelete`로 이미 되어 있어 상호배타 렌더된다.)

- [ ] **Step 4: 타입체크 + 린트**

Run: `cd /Users/jerry/wbs-web && npx tsc --noEmit && npm run lint`
Expected: PASS. (`common.close`/`common.cancel`/`common.delete`는 이미 존재 — 확인됨.)

- [ ] **Step 5: Commit**

```bash
cd /Users/jerry/wbs-web
git add src/components/meetings/MeetingDetailModal.tsx src/app/actions/meetings.ts
git commit -m "feat(meetings): 회의 상세 모달(참석자·회의록·회차취소·삭제)"
```

---

## Task 11: 프로젝트 회의 뷰 + 페이지

**Files:**
- Create: `src/components/meetings/MeetingsView.tsx`, `src/app/(app)/p/[projectId]/meetings/page.tsx`
- Optional: `src/app/(app)/p/[projectId]/meetings/loading.tsx`

**Interfaces:**
- Consumes: `getProjectMeetingData`(data), `getProjectMembers`(members data — 확인 필요), `expandMeetings`/`summarizeMeetings`(domain), Task 8·9·10 컴포넌트.
- Produces: `<MeetingsView projectId meetings exceptions members todayIso currentUserId role />`, 프로젝트 회의 페이지.

- [ ] **Step 1: members 조회 함수 확인**

Run: `cd /Users/jerry/wbs-web && grep -rn "export const getProjectMembers\|export async function getProjectMembers\|from('project_members')" src/lib/data/members.ts`
Expected: 프로젝트 멤버 조회 함수 확인. 함수명이 다르면(예: `getMembers`) 그 이름을 Step 3 페이지에서 사용.

- [ ] **Step 2: MeetingsView 구현**

Create `src/components/meetings/MeetingsView.tsx`:

```tsx
'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ChevronLeft, ChevronRight, CalendarDays, List, Plus, CalendarX2 } from 'lucide-react'
import type { Meeting, MeetingException, MeetingOccurrence, ProjectMember } from '@/lib/domain/types'
import type { DictKey } from '@/lib/i18n/dict'
import { useLocale } from '@/components/providers/LocaleProvider'
import { SegmentedTabs } from '@/components/ui/SegmentedTabs'
import { EmptyState } from '@/components/ui/EmptyState'
import { fmtDate } from '@/components/wbs/shared'
import { expandMeetings, sortOccurrences, MEETING_META } from '@/lib/domain/meetings'
import { MeetingCalendar } from './MeetingCalendar'
import { MeetingFormModal } from './MeetingFormModal'
import { MeetingDetailModal } from './MeetingDetailModal'

const MATRIX_ROWS = 6
type ViewKey = 'calendar' | 'list'

function gridRange(year: number, month0: number): [string, string] {
  const first = new Date(Date.UTC(year, month0, 1))
  const startDow = first.getUTCDay()
  const start = new Date(Date.UTC(year, month0, 1 - startDow))
  const end = new Date(Date.UTC(year, month0, 1 - startDow + MATRIX_ROWS * 7 - 1))
  const fmt = (d: Date) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`
  return [fmt(start), fmt(end)]
}

export function MeetingsView({
  projectId, meetings, exceptions, members, todayIso, currentUserId, role,
}: {
  projectId: string
  meetings: Meeting[]
  exceptions: MeetingException[]
  members: ProjectMember[]
  todayIso: string
  currentUserId: string | null
  role: string | null
}) {
  const router = useRouter()
  const { t, locale } = useLocale()
  const [initY, initM] = useMemo(() => todayIso.split('-').map(Number), [todayIso])
  const [year, setYear] = useState(initY)
  const [month0, setMonth0] = useState((initM || 1) - 1)
  const [view, setView] = useState<ViewKey>('calendar')

  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<Meeting | null>(null)
  const [detailOcc, setDetailOcc] = useState<MeetingOccurrence | null>(null)

  const [gridStart, gridEnd] = useMemo(() => gridRange(year, month0), [year, month0])
  const occurrences = useMemo(
    () => expandMeetings(meetings, exceptions, gridStart, gridEnd),
    [meetings, exceptions, gridStart, gridEnd],
  )
  const cancelledSet = useMemo(
    () => new Set(exceptions.filter(e => e.kind === 'cancelled').map(e => `${e.meetingId}:${e.occurrenceDate}`)),
    [exceptions],
  )
  const listRows = useMemo(() => sortOccurrences(occurrences).sort((a, b) => a.occurrenceDate.localeCompare(b.occurrenceDate)), [occurrences])

  function shift(delta: number) {
    const base = new Date(Date.UTC(year, month0 + delta, 1))
    setYear(base.getUTCFullYear()); setMonth0(base.getUTCMonth())
  }
  const onSaved = () => { setFormOpen(false); setEditing(null); router.refresh() }
  const openEditFromDetail = (m: Meeting) => { setDetailOcc(null); setEditing(m); setFormOpen(true) }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex items-center gap-2">
          <button onClick={() => shift(-1)} className="chrome-icon" aria-label={t('meet.prevMonth')}><ChevronLeft className="h-4 w-4" /></button>
          <div className="min-w-[116px] text-center text-base font-bold tabular-nums text-ink">
            {new Intl.DateTimeFormat(locale === 'ko' ? 'ko-KR' : 'en-US', { year: 'numeric', month: locale === 'ko' ? 'numeric' : 'long', timeZone: 'UTC' }).format(new Date(Date.UTC(year, month0, 1)))}
          </div>
          <button onClick={() => shift(1)} className="chrome-icon" aria-label={t('meet.nextMonth')}><ChevronRight className="h-4 w-4" /></button>
          <button onClick={() => { setYear(initY); setMonth0((initM || 1) - 1) }} className="btn btn-ghost h-10">{t('meet.today')}</button>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <SegmentedTabs<ViewKey>
            tabs={[{ key: 'calendar', label: t('meet.view.calendar'), icon: CalendarDays }, { key: 'list', label: t('meet.view.list'), icon: List }]}
            value={view} onChange={setView} size="sm"
          />
          <button onClick={() => { setEditing(null); setFormOpen(true) }} className="btn btn-primary"><Plus className="h-4 w-4" />{t('meet.addMeeting')}</button>
        </div>
      </div>

      {view === 'calendar' ? (
        <MeetingCalendar year={year} month0={month0} todayIso={todayIso} occurrences={occurrences} onSelectOccurrence={setDetailOcc} />
      ) : listRows.length === 0 ? (
        <EmptyState icon={CalendarX2} title={t('meet.empty.title')} description={t('meet.empty.desc')} />
      ) : (
        <div className="card overflow-hidden p-0">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] border-collapse text-sm">
              <thead>
                <tr className="border-b border-line bg-surface-2 text-left text-[11px] font-semibold uppercase tracking-[0.12em] text-ink-subtle">
                  <th className="px-4 py-3">{t('meet.col.date')}</th>
                  <th className="px-4 py-3">{t('meet.col.time')}</th>
                  <th className="px-4 py-3">{t('meet.col.title')}</th>
                  <th className="px-4 py-3">{t('meet.col.category')}</th>
                  <th className="px-4 py-3">{t('meet.col.attendees')}</th>
                </tr>
              </thead>
              <tbody>
                {listRows.map(o => {
                  const meta = MEETING_META[o.category]
                  return (
                    <tr key={o.occurrenceId} onClick={() => setDetailOcc(o)} role="button" tabIndex={0}
                      onKeyDown={e => { if (e.key === 'Enter') setDetailOcc(o) }}
                      className="cursor-pointer border-b border-line/70 last:border-0 transition hover:bg-surface-2 focus:outline-none focus-visible:bg-surface-2">
                      <td className="whitespace-nowrap px-4 py-3 font-medium tabular-nums text-ink">{fmtDate(o.occurrenceDate)}</td>
                      <td className="whitespace-nowrap px-4 py-3 tabular-nums text-ink-muted">{o.startTime ?? t('meet.allDay')}</td>
                      <td className="px-4 py-3 text-ink">{o.title}</td>
                      <td className="px-4 py-3"><span className={`chip ${meta.chip}`}><span className={`h-1.5 w-1.5 rounded-full ${meta.dot}`} />{t(meta.labelKey as DictKey)}</span></td>
                      <td className="px-4 py-3 text-ink-muted">{o.attendeeCount}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <MeetingFormModal open={formOpen} projectId={projectId} members={members} initial={editing} todayIso={todayIso}
        onClose={() => { setFormOpen(false); setEditing(null) }} onSaved={onSaved} />
      <MeetingDetailModal open={!!detailOcc} occurrence={detailOcc}
        isCancelled={detailOcc ? cancelledSet.has(detailOcc.occurrenceId) : false}
        currentUserId={currentUserId} role={role}
        onClose={() => setDetailOcc(null)} onEditSeries={openEditFromDetail} onChanged={() => router.refresh()} />
    </div>
  )
}
```

- [ ] **Step 3: 프로젝트 페이지 구현**

Create `src/app/(app)/p/[projectId]/meetings/page.tsx` (Step 1에서 확인한 members 조회 함수명 사용):

```tsx
import { CalendarClock, CalendarCheck, CalendarPlus } from 'lucide-react'
import { t } from '@/lib/i18n/dict'
import { getServerLocale } from '@/lib/i18n/server'
import { getProjectMeetingData } from '@/lib/data/meetings'
import { getProjectMembers } from '@/lib/data/members'
import { expandMeetings, summarizeMeetings } from '@/lib/domain/meetings'
import { getMembership, getSession } from '@/lib/auth'
import { listProjects } from '@/app/actions/project'
import { PageHero, HeroBadge } from '@/components/ui/PageHero'
import { KpiCard } from '@/components/ui/KpiCard'
import { ProjectPageShell } from '@/components/app/ProjectPageShell'
import { MeetingsView } from '@/components/meetings/MeetingsView'

function seoulToday(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date())
}
function monthGrid(todayIso: string): [string, string] {
  const [y, m] = todayIso.split('-').map(Number)
  const first = new Date(Date.UTC(y, m - 1, 1)); const dow = first.getUTCDay()
  const s = new Date(Date.UTC(y, m - 1, 1 - dow)); const e = new Date(Date.UTC(y, m - 1, 1 - dow + 41))
  const f = (d: Date) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`
  return [f(s), f(e)]
}

export default async function MeetingsPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params
  const today = seoulToday()
  const [{ meetings, exceptions }, members, m, user, projects, locale] = await Promise.all([
    getProjectMeetingData(projectId),
    getProjectMembers(projectId),
    getMembership(),
    getSession(),
    listProjects(),
    getServerLocale(),
  ])
  const project = projects.find(p => p.id === projectId)
  const projectName = project?.name ?? ''
  const [gs, ge] = monthGrid(today)
  const monthOcc = expandMeetings(meetings, exceptions, gs, ge)
  const { today: todayN, upcoming7d, total } = summarizeMeetings(monthOcc, today)

  return (
    <ProjectPageShell
      hero={<PageHero
        eyebrow="MEETINGS"
        badge={<HeroBadge>Meetings</HeroBadge>}
        title={`${projectName} ${t(locale, 'meet.heroTitleSuffix')}`}
        description={t(locale, 'meet.heroDesc')}
        heroKpis={
          <>
            <KpiCard variant="hero" label="TODAY" value={todayN} sub={t(locale, 'meet.kpi.todaySub')} icon={CalendarCheck} tone="brand" />
            <KpiCard variant="hero" label="NEXT 7 DAYS" value={upcoming7d} sub={t(locale, 'meet.kpi.upcomingSub')} icon={CalendarClock} tone="warning" />
            <KpiCard variant="hero" label="THIS MONTH" value={total} sub={t(locale, 'meet.kpi.totalSub')} icon={CalendarPlus} tone="success" />
          </>
        }
      />}
    >
      <MeetingsView projectId={projectId} meetings={meetings} exceptions={exceptions} members={members}
        todayIso={today} currentUserId={user?.id ?? null} role={m?.role ?? null} />
    </ProjectPageShell>
  )
}
```

- [ ] **Step 4: 타입체크 + 린트 + 빌드**

Run: `cd /Users/jerry/wbs-web && npx tsc --noEmit && npm run lint && npm run build`
Expected: PASS. (`getProjectMembers` 시그니처가 다르면 Step 1 결과에 맞춰 수정.)

- [ ] **Step 5: Commit**

```bash
cd /Users/jerry/wbs-web
git add "src/components/meetings/MeetingsView.tsx" "src/app/(app)/p/[projectId]/meetings/page.tsx"
git commit -m "feat(meetings): 프로젝트 회의 뷰 + 페이지"
```

---

## Task 12: 내 회의 뷰 + 페이지

**Files:**
- Create: `src/components/meetings/MyMeetingsView.tsx`, `src/app/(app)/meetings/page.tsx`

**Interfaces:**
- Consumes: `getMyMeetings`/`getMyMemberIds`(data), `fetchMyMeetings`(action), Task 8·10 컴포넌트, `expandMeetings`.
- Produces: 내 회의 페이지(기본 "내 것만" ON, 전체 프로젝트 토글, 월 이동 시 액션 재조회).

- [ ] **Step 1: MyMeetingsView 구현**

Create `src/components/meetings/MyMeetingsView.tsx`:

```tsx
'use client'

import { useEffect, useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { ChevronLeft, ChevronRight, CalendarDays, List, CalendarX2 } from 'lucide-react'
import type { Meeting, MeetingException, MeetingOccurrence } from '@/lib/domain/types'
import type { DictKey } from '@/lib/i18n/dict'
import { useLocale } from '@/components/providers/LocaleProvider'
import { SegmentedTabs } from '@/components/ui/SegmentedTabs'
import { EmptyState } from '@/components/ui/EmptyState'
import { fmtDate } from '@/components/wbs/shared'
import { expandMeetings, sortOccurrences, MEETING_META } from '@/lib/domain/meetings'
import { MeetingCalendar } from './MeetingCalendar'
import { MeetingDetailModal } from './MeetingDetailModal'
import { fetchMyMeetings } from '@/app/actions/meetings'

type ViewKey = 'calendar' | 'list'

function gridRange(year: number, month0: number): [string, string] {
  const first = new Date(Date.UTC(year, month0, 1)); const dow = first.getUTCDay()
  const s = new Date(Date.UTC(year, month0, 1 - dow)); const e = new Date(Date.UTC(year, month0, 1 - dow + 41))
  const f = (d: Date) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`
  return [f(s), f(e)]
}

export function MyMeetingsView({
  initialMeetings, initialExceptions, todayIso, currentUserId, role,
}: {
  initialMeetings: Meeting[]
  initialExceptions: MeetingException[]
  todayIso: string
  currentUserId: string | null
  role: string | null
}) {
  const router = useRouter()
  const { t, locale } = useLocale()
  const [initY, initM] = useMemo(() => todayIso.split('-').map(Number), [todayIso])
  const [year, setYear] = useState(initY)
  const [month0, setMonth0] = useState((initM || 1) - 1)
  const [view, setView] = useState<ViewKey>('calendar')
  const [onlyMine, setOnlyMine] = useState(true)
  const [data, setData] = useState({ meetings: initialMeetings, exceptions: initialExceptions })
  const [detailOcc, setDetailOcc] = useState<MeetingOccurrence | null>(null)
  const [pending, startTransition] = useTransition()

  const [gridStart, gridEnd] = useMemo(() => gridRange(year, month0), [year, month0])

  // 월 이동 시 서버 액션 재조회(현재 달이 아니면). 초기 달은 서버 렌더 데이터 사용.
  const isInitialMonth = year === initY && month0 === (initM || 1) - 1
  useEffect(() => {
    if (isInitialMonth) { setData({ meetings: initialMeetings, exceptions: initialExceptions }); return }
    let alive = true
    startTransition(async () => {
      const res = await fetchMyMeetings(gridStart, gridEnd)
      if (alive) setData(res)
    })
    return () => { alive = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gridStart, gridEnd])

  const filteredMeetings = useMemo(
    () => onlyMine ? data.meetings.filter(m => m.isMine) : data.meetings,
    [data.meetings, onlyMine],
  )
  const occurrences = useMemo(
    () => expandMeetings(filteredMeetings, data.exceptions, gridStart, gridEnd),
    [filteredMeetings, data.exceptions, gridStart, gridEnd],
  )
  const cancelledSet = useMemo(
    () => new Set(data.exceptions.filter(e => e.kind === 'cancelled').map(e => `${e.meetingId}:${e.occurrenceDate}`)),
    [data.exceptions],
  )
  const listRows = useMemo(() => sortOccurrences(occurrences).sort((a, b) => a.occurrenceDate.localeCompare(b.occurrenceDate)), [occurrences])

  function shift(delta: number) {
    const base = new Date(Date.UTC(year, month0 + delta, 1))
    setYear(base.getUTCFullYear()); setMonth0(base.getUTCMonth())
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex items-center gap-2">
          <button onClick={() => shift(-1)} className="chrome-icon" aria-label={t('meet.prevMonth')}><ChevronLeft className="h-4 w-4" /></button>
          <div className="min-w-[116px] text-center text-base font-bold tabular-nums text-ink">
            {new Intl.DateTimeFormat(locale === 'ko' ? 'ko-KR' : 'en-US', { year: 'numeric', month: locale === 'ko' ? 'numeric' : 'long', timeZone: 'UTC' }).format(new Date(Date.UTC(year, month0, 1)))}
          </div>
          <button onClick={() => shift(1)} className="chrome-icon" aria-label={t('meet.nextMonth')}><ChevronRight className="h-4 w-4" /></button>
          <button onClick={() => { setYear(initY); setMonth0((initM || 1) - 1) }} className="btn btn-ghost h-10">{t('meet.today')}</button>
          {pending && <span className="text-xs text-ink-subtle">…</span>}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <SegmentedTabs<'mine' | 'all'>
            tabs={[{ key: 'mine', label: t('meet.onlyMine') }, { key: 'all', label: t('meet.allProjects') }]}
            value={onlyMine ? 'mine' : 'all'} onChange={k => setOnlyMine(k === 'mine')} size="sm"
          />
          <SegmentedTabs<ViewKey>
            tabs={[{ key: 'calendar', label: t('meet.view.calendar'), icon: CalendarDays }, { key: 'list', label: t('meet.view.list'), icon: List }]}
            value={view} onChange={setView} size="sm"
          />
        </div>
      </div>

      {view === 'calendar' ? (
        <MeetingCalendar year={year} month0={month0} todayIso={todayIso} occurrences={occurrences} onSelectOccurrence={setDetailOcc} />
      ) : listRows.length === 0 ? (
        <EmptyState icon={CalendarX2}
          title={onlyMine ? t('meet.empty.mineTitle') : t('meet.empty.title')}
          description={onlyMine ? t('meet.empty.mineDesc') : t('meet.empty.desc')} />
      ) : (
        <div className="card overflow-hidden p-0">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] border-collapse text-sm">
              <thead>
                <tr className="border-b border-line bg-surface-2 text-left text-[11px] font-semibold uppercase tracking-[0.12em] text-ink-subtle">
                  <th className="px-4 py-3">{t('meet.col.date')}</th>
                  <th className="px-4 py-3">{t('meet.col.time')}</th>
                  <th className="px-4 py-3">{t('meet.col.title')}</th>
                  <th className="px-4 py-3">{t('meet.col.project')}</th>
                  <th className="px-4 py-3">{t('meet.col.category')}</th>
                </tr>
              </thead>
              <tbody>
                {listRows.map(o => {
                  const meta = MEETING_META[o.category]
                  return (
                    <tr key={o.occurrenceId} onClick={() => setDetailOcc(o)} role="button" tabIndex={0}
                      onKeyDown={e => { if (e.key === 'Enter') setDetailOcc(o) }}
                      className="cursor-pointer border-b border-line/70 last:border-0 transition hover:bg-surface-2 focus:outline-none focus-visible:bg-surface-2">
                      <td className="whitespace-nowrap px-4 py-3 font-medium tabular-nums text-ink">{fmtDate(o.occurrenceDate)}</td>
                      <td className="whitespace-nowrap px-4 py-3 tabular-nums text-ink-muted">{o.startTime ?? t('meet.allDay')}</td>
                      <td className="px-4 py-3 text-ink">{o.title}</td>
                      <td className="px-4 py-3 text-ink-muted">{o.projectName ?? '-'}</td>
                      <td className="px-4 py-3"><span className={`chip ${meta.chip}`}><span className={`h-1.5 w-1.5 rounded-full ${meta.dot}`} />{t(meta.labelKey as DictKey)}</span></td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <MeetingDetailModal open={!!detailOcc} occurrence={detailOcc}
        isCancelled={detailOcc ? cancelledSet.has(detailOcc.occurrenceId) : false}
        currentUserId={currentUserId} role={role}
        onClose={() => setDetailOcc(null)} onEditSeries={() => { /* 내 회의에서는 편집 시 프로젝트로 이동 유도 */ }}
        onChanged={() => router.refresh()} />
    </div>
  )
}
```

**참고:** 내 회의 뷰에서 상세 모달의 "수정"은 프로젝트 컨텍스트가 필요하다. v1에서는 `onEditSeries`를 no-op으로 두되, 상세 모달의 편집 버튼은 프로젝트 회의 페이지에서만 완전 동작한다. (회차 취소/삭제는 여기서도 동작.) 개선 여지는 §11 열린 결정.

- [ ] **Step 2: 내 회의 페이지 구현**

Create `src/app/(app)/meetings/page.tsx`:

```tsx
import { CalendarClock, CalendarCheck, CalendarRange } from 'lucide-react'
import { t } from '@/lib/i18n/dict'
import { getServerLocale } from '@/lib/i18n/server'
import { getMyMeetings } from '@/lib/data/meetings'
import { expandMeetings, summarizeMeetings } from '@/lib/domain/meetings'
import { getMembership, getSession } from '@/lib/auth'
import { PageHero, HeroBadge } from '@/components/ui/PageHero'
import { KpiCard } from '@/components/ui/KpiCard'
import { ProjectPageShell } from '@/components/app/ProjectPageShell'
import { MyMeetingsView } from '@/components/meetings/MyMeetingsView'

function seoulToday(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date())
}
function monthGrid(todayIso: string): [string, string] {
  const [y, m] = todayIso.split('-').map(Number)
  const first = new Date(Date.UTC(y, m - 1, 1)); const dow = first.getUTCDay()
  const s = new Date(Date.UTC(y, m - 1, 1 - dow)); const e = new Date(Date.UTC(y, m - 1, 1 - dow + 41))
  const f = (d: Date) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`
  return [f(s), f(e)]
}

export default async function MyMeetingsPage() {
  const today = seoulToday()
  const [gs, ge] = monthGrid(today)
  const [{ meetings, exceptions }, m, user, locale] = await Promise.all([
    getMyMeetings(gs, ge),
    getMembership(),
    getSession(),
    getServerLocale(),
  ])
  const mineOcc = expandMeetings(meetings.filter(x => x.isMine), exceptions, gs, ge)
  const { today: todayN, upcoming7d, total } = summarizeMeetings(mineOcc, today)

  return (
    <ProjectPageShell
      hero={<PageHero
        eyebrow="MY MEETINGS"
        badge={<HeroBadge>My Meetings</HeroBadge>}
        title={t(locale, 'meet.myHeroTitle')}
        description={t(locale, 'meet.myHeroDesc')}
        heroKpis={
          <>
            <KpiCard variant="hero" label="TODAY" value={todayN} sub={t(locale, 'meet.kpi.todaySub')} icon={CalendarCheck} tone="brand" />
            <KpiCard variant="hero" label="NEXT 7 DAYS" value={upcoming7d} sub={t(locale, 'meet.kpi.upcomingSub')} icon={CalendarClock} tone="warning" />
            <KpiCard variant="hero" label="THIS MONTH" value={total} sub={t(locale, 'meet.kpi.totalSub')} icon={CalendarRange} tone="success" />
          </>
        }
      />}
    >
      <MyMeetingsView initialMeetings={meetings} initialExceptions={exceptions}
        todayIso={today} currentUserId={user?.id ?? null} role={m?.role ?? null} />
    </ProjectPageShell>
  )
}
```

- [ ] **Step 3: 타입체크 + 린트 + 빌드**

Run: `cd /Users/jerry/wbs-web && npx tsc --noEmit && npm run lint && npm run build`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
cd /Users/jerry/wbs-web
git add "src/components/meetings/MyMeetingsView.tsx" "src/app/(app)/meetings/page.tsx"
git commit -m "feat(meetings): 내 회의 통합 뷰 + 페이지(내 것만 기본·월 이동 재조회)"
```

---

## Task 13: 내비게이션 등록 (3곳 동기화)

**Files:**
- Modify: `src/components/app/Sidebar.tsx`, `src/components/app/HeaderChrome.tsx`

**Interfaces:**
- Consumes: Task 6의 `nav.meetings`/`nav.myMeetings`.
- Produces: 사이드바 프로젝트 메뉴에 "회의", 전역 "내 회의" 링크, 헤더 브레드크럼 라벨, 모바일 메뉴 항목.

- [ ] **Step 1: Sidebar projectMenu에 회의 추가**

`src/components/app/Sidebar.tsx` — lucide import에 `CalendarClock`, `CalendarRange` 추가. `projectMenu()` 배열에서 `announcements` 항목 아래(또는 attendance 아래)에 삽입:

```ts
{ href: `${base}/meetings`, labelKey: 'nav.meetings', icon: CalendarClock, match: `${base}/meetings` },
```

- [ ] **Step 2: Sidebar에 전역 "내 회의" 링크 추가**

`src/components/app/Sidebar.tsx` — "메뉴 섹션" `<nav>`의 `activeId ? (...) : (...)` 중 **양쪽 브랜치 모두에서 접근 가능하도록**, WORKSPACE 카드 아래(프로젝트 리스트 위)에 항상 보이는 링크를 추가한다:

```tsx
{/* 전역: 내 회의 */}
<Link href="/meetings" title={t('nav.myMeetings')}
  className={`side-link mt-3 ${pathname === '/meetings' ? 'side-link-active' : ''} ${collapsed ? 'justify-center px-0' : ''}`}>
  <CalendarRange className="h-[18px] w-[18px] shrink-0" />
  {!collapsed && <span className="flex-1">{t('nav.myMeetings')}</span>}
</Link>
```

(WORKSPACE 카드 `{!collapsed && (...)}` 블록 직후, `{/* 프로젝트 리스트 */}` 주석 앞에 삽입.)

- [ ] **Step 3: HeaderChrome SECTION_LABEL + 모바일 메뉴**

`src/components/app/HeaderChrome.tsx`:
- `SECTION_LABEL`에 `meetings: '회의',` 추가.
- MobileMenu `links` 배열(activeId 분기)에 `announcements` 아래 추가:
```ts
{ href: `/p/${activeId}/meetings`, label: t('nav.meetings') },
```
- MobileMenu 상단 `/projects` 링크 아래에 전역 내 회의 링크 추가:
```tsx
<Link href="/meetings" onClick={onClose} className={`side-link ${pathname === '/meetings' ? 'side-link-active' : ''}`}>{t('nav.myMeetings')}</Link>
```

- [ ] **Step 4: 타입체크 + 린트 + 빌드**

Run: `cd /Users/jerry/wbs-web && npx tsc --noEmit && npm run lint && npm run build`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd /Users/jerry/wbs-web
git add src/components/app/Sidebar.tsx src/components/app/HeaderChrome.tsx
git commit -m "feat(meetings): 내비 등록 — 사이드바 회의·전역 내 회의·브레드크럼·모바일"
```

---

## Task 14: 최종 검증

**Files:** 없음(검증만).

- [ ] **Step 1: 전체 테스트**

Run: `cd /Users/jerry/wbs-web && npm run test`
Expected: 모든 테스트 PASS(기존 + `meetings.test.ts`).

- [ ] **Step 2: 린트 + 타입 + 빌드**

Run: `cd /Users/jerry/wbs-web && npm run lint && npx tsc --noEmit && npm run build`
Expected: 에러 0, 빌드 성공. `/p/[projectId]/meetings`, `/meetings` 라우트가 빌드 출력에 나타나는지 확인.

- [ ] **Step 3: 마이그레이션 적용 확인 요청**

`0013_meetings.sql`은 자동 배포되지 않는다. 사용자에게 Management API 적용을 요청하고, 적용 전에는 페이지가 빈 데이터(빈 배열)로 렌더됨을 안내한다. 적용 후 실제 CRUD 동작을 사용자 환경에서 확인.

- [ ] **Step 4: 최종 커밋(있다면)**

```bash
cd /Users/jerry/wbs-web
git status --short
# 남은 변경 없으면 종료. 있으면 개별 add 후 커밋.
```

---

## Self-Review (작성자 체크)

**Spec coverage:**
- 두 화면(프로젝트/내 회의) → Task 11, 12 ✓
- 월 그리드+리스트 토글, monthMatrix 재사용 → Task 8, 11, 12 ✓
- 3 테이블 + CHECK + RLS + lower(email) 인덱스 → Task 3 ✓
- 종일=start_time null, 시간 CHECK → Task 3, 5, 9 ✓
- 반복 expand-at-read + 31일 skip + 격주 위상 + until 포함 + 하드캡 + fast-forward → Task 2 ✓
- 규칙 변경 시 예외 삭제 + 경고 → Task 5(update), Task 9(warn) ✓
- occurrenceId 안정 키 + 회차 취소 서버 검증 → Task 2, 5, 8 ✓
- fetch 범위 조건(.or) → Task 4 ✓
- 소유자 기반 쓰기 3층 일치(canEditMeeting/action/RLS) → Task 2, 3, 5, 10 ✓
- 내 회의 서버 isMine·payload 규칙·lower(email)·N+1 회피 → Task 4 ✓
- 이메일 매칭 실패 가시화(빈 안내·경고) → Task 6(empty.mineDesc), Task 7(noEmail) ✓
- 참석자 project_id 검증 → Task 5(replaceAttendees) ✓
- i18n meet.* + nav → Task 6 ✓
- 내비 3곳 동기화 → Task 13 ✓
- 테스트 순수 도메인만 → Task 2 ✓

**Placeholder scan:** 코드 스텝은 전부 실제 코드 포함. Task 11 Step 1은 기존 함수명 확인(플레이스홀더 아님, 검증 스텝). Task 10 참고 노트는 다음 스텝에서 실제 코드로 채움. ✓

**Type consistency:** `MeetingInput`/`MeetingActionResult`(Task 5) ↔ Form(Task 9) 일치; `MeetingOccurrence.occurrenceId/seriesId/attendeeCount`(Task 1) ↔ 소비처(Task 8/10/11/12) 일치; `getMyMeetings` 반환 `{meetings,exceptions}`(Task 4) ↔ 페이지/뷰(Task 12) 일치; `canEditMeeting(m,userId,role)` 시그니처(Task 2) ↔ 상세 모달(Task 10) 일치. ✓

## 확인 완료 항목 (작성 중 검증됨)
- `getProjectMembers(projectId): Promise<ProjectMember[]>` — `src/lib/data/members.ts` 확인 ✓
- `common.close`/`common.cancel`/`common.delete`/`common.save` — `common.ts` 존재 확인 ✓
- `SegmentedTabs<T>({ tabs, value, onChange, size })`, `SegTab = { key, label, icon? }` — 확인 ✓
- `KpiCard` tone 'brand'/'warning'/'success' — announcements 페이지에서 사용 확인 ✓
- `nav.*` 키 위치: `common.ts` ko 13–15행 / en 57–59행 (`nav.meetings`/`nav.myMeetings` 삽입 지점).
