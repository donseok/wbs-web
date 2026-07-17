# 회의일정 → 공지 원클릭 등록 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 회의 상세 팝업에서 PMO가 "공지로 등록"을 한 번 눌러 그 회의를 바탕으로 공지사항 1건을 즉시 생성한다(회의는 유지).

**Architecture:** 공지 본문 조합은 순수 함수 `composeAnnouncementFromMeeting`(도메인 레이어)로 뽑아 단위 테스트한다. 서버 액션 `createAnnouncementFromMeeting`은 pmo_admin 게이트 → 회의 재조회 → `expandMeetings`로 회차 검증 → 순수 함수로 조합 → `announcements` insert만 오케스트레이션한다. UI는 `MeetingDetailModal` 푸터에 버튼과 posting/posted 상태를 추가한다.

**Tech Stack:** Next.js App Router(Server Actions), Supabase, TypeScript, vitest.

## Global Constraints

- 공지 생성 권한은 `pmo_admin` 전용 — 버튼 노출과 서버 액션 양쪽에서 강제.
- 회의는 삭제/이전하지 않음 — 파생 공지 1건만 생성.
- 공지 본문은 DB에 평문 1벌 저장(뷰어 언어 재번역 없음) → body 라벨은 한글 고정.
- 날짜는 `'YYYY-MM-DD'` (Asia/Seoul). 사전식 비교 = 시간순.
- 게시기간: `publishFrom = 오늘`, `publishTo = max(오늘, 회의 회차일)`.
- `git add -A` 금지(병렬 세션) — 항상 변경 파일을 명시적으로 add.
- 커밋 메시지 말미에 `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.

---

### Task 1: 공지 본문 조합 순수 함수

**Files:**
- Modify: `src/lib/domain/announcements.ts` (파일 끝에 추가)
- Test: `tests/lib/announcement-from-meeting.test.ts` (신규)

**Interfaces:**
- Consumes: `AnnouncementCategory` (이미 `@/lib/domain/types`에서 announcements.ts가 import 중)
- Produces:
  ```ts
  export interface MeetingAnnouncementSource {
    title: string
    occurrenceDate: string   // 'YYYY-MM-DD'
    startTime: string | null // 'HH:MM' | null(종일)
    endTime: string | null   // 'HH:MM' | null
    location: string | null
    body: string
  }
  export function composeAnnouncementFromMeeting(
    src: MeetingAnnouncementSource,
    todayIso: string,        // 'YYYY-MM-DD' (Asia/Seoul)
  ): {
    title: string
    body: string
    category: AnnouncementCategory
    isPinned: boolean
    publishFrom: string
    publishTo: string
  }
  ```

- [ ] **Step 1: Write the failing test**

Create `tests/lib/announcement-from-meeting.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { composeAnnouncementFromMeeting } from '@/lib/domain/announcements'

const base = {
  title: '주간 동기화',
  occurrenceDate: '2026-07-20',
  startTime: '14:00',
  endTime: '15:00',
  location: '3F 회의실',
  body: '안건: 릴리스 점검',
}

describe('composeAnnouncementFromMeeting', () => {
  it('시간 범위·장소·본문이 모두 있으면 라벨 줄 + 본문을 조합한다', () => {
    const r = composeAnnouncementFromMeeting(base, '2026-07-17')
    expect(r.title).toBe('주간 동기화')
    expect(r.body).toBe('일시: 2026-07-20 14:00–15:00\n장소: 3F 회의실\n\n안건: 릴리스 점검')
    expect(r.category).toBe('general')
    expect(r.isPinned).toBe(false)
    expect(r.publishFrom).toBe('2026-07-17')
    expect(r.publishTo).toBe('2026-07-20') // max(오늘, 회차일)
  })

  it('종일 회의는 시간 대신 (종일)로 표기', () => {
    const r = composeAnnouncementFromMeeting({ ...base, startTime: null, endTime: null }, '2026-07-17')
    expect(r.body.startsWith('일시: 2026-07-20 (종일)')).toBe(true)
  })

  it('시작만 있고 종료 없으면 시작 시각만', () => {
    const r = composeAnnouncementFromMeeting({ ...base, endTime: null }, '2026-07-17')
    expect(r.body.startsWith('일시: 2026-07-20 14:00\n')).toBe(true)
  })

  it('장소 없으면 장소 줄 생략', () => {
    const r = composeAnnouncementFromMeeting({ ...base, location: null }, '2026-07-17')
    expect(r.body).toBe('일시: 2026-07-20 14:00–15:00\n\n안건: 릴리스 점검')
  })

  it('본문 없으면 라벨 줄만 남기고 뒤 공백 없음', () => {
    const r = composeAnnouncementFromMeeting({ ...base, body: '   ' }, '2026-07-17')
    expect(r.body).toBe('일시: 2026-07-20 14:00–15:00\n장소: 3F 회의실')
  })

  it('회차일이 과거면 publishTo는 오늘로 클램프', () => {
    const r = composeAnnouncementFromMeeting({ ...base, occurrenceDate: '2026-07-10' }, '2026-07-17')
    expect(r.publishFrom).toBe('2026-07-17')
    expect(r.publishTo).toBe('2026-07-17')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/lib/announcement-from-meeting.test.ts`
Expected: FAIL — `composeAnnouncementFromMeeting is not a function` / import 에러.

- [ ] **Step 3: Write minimal implementation**

`src/lib/domain/announcements.ts` 파일 끝에 추가(엔대시는 U+2013 `–`):

```ts
export interface MeetingAnnouncementSource {
  title: string
  occurrenceDate: string
  startTime: string | null
  endTime: string | null
  location: string | null
  body: string
}

/**
 * 회의 1회차를 공지 입력으로 변환(원클릭 등록용). 본문은 평문으로 조합해 DB에
 * 그대로 저장한다(뷰어 언어 재번역 없음 → 한글 라벨 고정). 게시기간은
 * 오늘~max(오늘, 회차일)로, 과거 회차도 publishFrom>publishTo 위반이 나지 않게 한다.
 */
export function composeAnnouncementFromMeeting(
  src: MeetingAnnouncementSource,
  todayIso: string,
): { title: string; body: string; category: AnnouncementCategory; isPinned: boolean; publishFrom: string; publishTo: string } {
  const timePart = src.startTime === null
    ? '(종일)'
    : src.endTime
      ? `${src.startTime}–${src.endTime}`
      : src.startTime
  const lines = [`일시: ${src.occurrenceDate} ${timePart}`]
  if (src.location && src.location.trim()) lines.push(`장소: ${src.location.trim()}`)
  const head = lines.join('\n')
  const note = src.body.trim()
  const body = note ? `${head}\n\n${note}` : head
  return {
    title: src.title,
    body,
    category: 'general',
    isPinned: false,
    publishFrom: todayIso,
    // 'YYYY-MM-DD'는 사전식 비교가 시간순과 일치 — 더 늦은 날짜가 max
    publishTo: src.occurrenceDate > todayIso ? src.occurrenceDate : todayIso,
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/lib/announcement-from-meeting.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/domain/announcements.ts tests/lib/announcement-from-meeting.test.ts
git commit -m "feat(announcements): 회의→공지 본문 조합 순수 함수

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: 서버 액션 createAnnouncementFromMeeting

**Files:**
- Modify: `src/app/actions/announcements.ts`
- Test: `tests/actions/announcement-from-meeting-gate.test.ts` (신규)

**Interfaces:**
- Consumes: `composeAnnouncementFromMeeting`, `MeetingAnnouncementSource` (Task 1); 기존 `seoulToday`, `advanceSeenWatermark`, `revalidateAnnouncements`, `AnnouncementActionResult` (같은 파일); `expandMeetings` (`@/lib/domain/meetings`); `MeetingCategory`, `MeetingRecurrence` (`@/lib/domain/types`).
- Produces:
  ```ts
  export async function createAnnouncementFromMeeting(
    meetingId: string,
    occurrenceDate: string,
  ): Promise<AnnouncementActionResult>
  ```

- [ ] **Step 1: Write the failing test (권한 게이트)**

Create `tests/actions/announcement-from-meeting-gate.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

// createServerClient 는 게이트 통과 전에 호출되면 안 된다.
const { createServerClient } = vi.hoisted(() => ({
  createServerClient: vi.fn(() => {
    throw new Error('게이트 통과 전 createServerClient 호출 금지')
  }),
}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/lib/auth', () => ({ getMembership: vi.fn(), getSession: vi.fn() }))
vi.mock('@/lib/supabase/server', () => ({ createServerClient }))
vi.mock('@/lib/data/announcements', () => ({ getTopAnnouncements: vi.fn() }))

import { getMembership } from '@/lib/auth'
import { createAnnouncementFromMeeting } from '@/app/actions/announcements'

const NON_ADMIN = [null, { role: 'team_editor', teamCode: 'PMO', teamId: 't1' }] as const

describe('createAnnouncementFromMeeting 권한 게이트', () => {
  beforeEach(() => { createServerClient.mockClear() })

  it.each(NON_ADMIN)('비-pmo_admin(%o)은 거부하고 DB에 손대지 않는다', async (membership) => {
    vi.mocked(getMembership).mockResolvedValue(membership as never)
    const res = await createAnnouncementFromMeeting('m1', '2026-07-20')
    expect(res.ok).toBe(false)
    expect(res.error).toBe('권한 없음')
    expect(createServerClient).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/actions/announcement-from-meeting-gate.test.ts`
Expected: FAIL — `createAnnouncementFromMeeting` export 없음.

- [ ] **Step 3: Write minimal implementation**

`src/app/actions/announcements.ts` 상단 import에 추가:

```ts
import { expandMeetings } from '@/lib/domain/meetings'
import { composeAnnouncementFromMeeting } from '@/lib/domain/announcements'
import type { MeetingCategory, MeetingRecurrence } from '@/lib/domain/types'
```

파일 끝(다른 export 뒤)에 액션 추가:

```ts
/**
 * 회의 1회차를 바탕으로 공지사항 1건을 생성한다(원클릭 등록). 회의는 그대로 둔다.
 * pmo_admin 전용. occurrenceDate 가 실제 규칙상 회차인지 서버에서 재검증하고
 * (클라이언트 값 불신), 본문은 composeAnnouncementFromMeeting 으로 조합한다.
 */
export async function createAnnouncementFromMeeting(
  meetingId: string,
  occurrenceDate: string,
): Promise<AnnouncementActionResult> {
  const m = await getMembership()
  if (!m) return { ok: false, error: '로그인 필요' }
  if (m.role !== 'pmo_admin') return { ok: false, error: '권한 없음' }
  if (!DATE_RE.test(occurrenceDate)) return { ok: false, error: '잘못된 날짜입니다.' }

  const user = await getSession()
  const sb = await createServerClient()
  const { data: r } = await sb
    .from('meetings')
    .select('project_id, title, body, meeting_date, start_time, end_time, location, category, recurrence, recurrence_until')
    .eq('id', meetingId)
    .maybeSingle()
  if (!r) return { ok: false, error: '회의를 찾을 수 없습니다.' }

  // 회차 검증 — 비반복/반복 모두 expandMeetings 로 동일하게 처리(해당 날짜만 전개).
  const meeting = {
    id: meetingId, projectId: r.project_id as string, title: r.title as string,
    meetingDate: r.meeting_date as string, startTime: (r.start_time as string | null) ?? null,
    endTime: (r.end_time as string | null) ?? null, location: (r.location as string | null) ?? null,
    category: r.category as MeetingCategory, body: '', recurrence: r.recurrence as MeetingRecurrence,
    recurrenceUntil: (r.recurrence_until as string | null) ?? null, createdBy: null,
    createdByName: null, createdAt: '', updatedAt: '', attendeeIds: [],
  }
  const occ = expandMeetings([meeting], [], occurrenceDate, occurrenceDate)
  if (!occ.some(o => o.occurrenceDate === occurrenceDate)) {
    return { ok: false, error: '해당 날짜는 이 회의의 회차가 아닙니다.' }
  }

  const input = composeAnnouncementFromMeeting({
    title: r.title as string,
    occurrenceDate,
    startTime: (r.start_time as string | null) ?? null,
    endTime: (r.end_time as string | null) ?? null,
    location: (r.location as string | null) ?? null,
    body: (r.body as string | null) ?? '',
  }, seoulToday())

  const projectId = r.project_id as string
  const { data, error } = await sb
    .from('announcements')
    .insert({
      project_id: projectId,
      title: input.title,
      body: input.body,
      category: input.category,
      is_pinned: input.isPinned,
      publish_from: input.publishFrom,
      publish_to: input.publishTo,
      created_by: user?.id ?? null,
    })
    .select('created_at')
    .single()
  if (error) return { ok: false, error: error.message }
  if (user && data?.created_at) {
    await advanceSeenWatermark(projectId, user.id, data.created_at as string)
  }
  revalidateAnnouncements(projectId)
  return { ok: true }
}
```

- [ ] **Step 4: Run gate test to verify it passes**

Run: `npx vitest run tests/actions/announcement-from-meeting-gate.test.ts`
Expected: PASS (2 cases).

- [ ] **Step 5: Typecheck the action file compiles**

Run: `npx tsc --noEmit`
Expected: 에러 없음(이 파일 관련). (기존 무관 에러가 있으면 이 파일에서 새로 생긴 것만 없으면 OK.)

- [ ] **Step 6: Commit**

```bash
git add src/app/actions/announcements.ts tests/actions/announcement-from-meeting-gate.test.ts
git commit -m "feat(announcements): 회의 회차→공지 생성 서버 액션(pmo_admin, 회차 재검증)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: MeetingDetailModal 버튼 + i18n

**Files:**
- Modify: `src/lib/i18n/dict/meetings.ts` (meetingsKo + meetingsEn)
- Modify: `src/components/meetings/MeetingDetailModal.tsx`

**Interfaces:**
- Consumes: `createAnnouncementFromMeeting` (Task 2); 신규 dict 키.
- Produces: UI만(다른 태스크가 참조하지 않음).

- [ ] **Step 1: i18n 키 추가 (ko)**

`src/lib/i18n/dict/meetings.ts`의 `meetingsKo` 객체에서 `'meet.detail.deleteSeries': '삭제',` 줄 **다음**에 추가:

```ts
  'meet.detail.postAsAnnouncement': '공지로 등록',
  'meet.detail.postedAsAnnouncement': '공지 등록됨',
  'meet.detail.posting': '등록 중…',
  'meet.detail.postFailed': '공지 등록에 실패했습니다.',
```

- [ ] **Step 2: i18n 키 추가 (en)**

같은 파일 `meetingsEn` 객체에서 `'meet.detail.deleteSeries': 'Delete',` 줄 **다음**에 추가:

```ts
  'meet.detail.postAsAnnouncement': 'Post as announcement',
  'meet.detail.postedAsAnnouncement': 'Posted',
  'meet.detail.posting': 'Posting…',
  'meet.detail.postFailed': 'Failed to post announcement.',
```

- [ ] **Step 3: 모달에 액션 import + 상태 추가**

`src/components/meetings/MeetingDetailModal.tsx`:

import 라인(라인 12)에 `createAnnouncementFromMeeting`를 추가:

```ts
import { fetchMeetingDetail, cancelOccurrence, deleteMeeting } from '@/app/actions/meetings'
import { createAnnouncementFromMeeting } from '@/app/actions/announcements'
```

lucide import(라인 5)에 `Megaphone`, `Check` 추가:

```ts
import { CalendarDays, Clock4, MapPin, Repeat, Trash2, Pencil, Ban, User, AlertTriangle, NotebookText, Megaphone, Check } from 'lucide-react'
```

상태 선언부(라인 35 `const [pending, startTransition] = useTransition()` 아래)에 추가:

```ts
  const [posting, startPost] = useTransition()
  const [posted, setPosted] = useState(false)
```

- [ ] **Step 4: 리셋 로직에 posted 추가**

같은 파일 useEffect 초기화 분기(라인 38-39)에서 `setError(null); return` 앞에 `setPosted(false);`를 끼운다:

```ts
    if (!open || !occurrence) {
      setDetail(null); setMinutes([]); setConfirmDelete(false); setConfirmCancel(false); setPosted(false); setError(null); return
    }
```

- [ ] **Step 5: 등록 핸들러 추가**

`runDelete` 정의(라인 65-69) 아래에 추가:

```ts
  const runPost = () => startPost(async () => {
    setError(null)
    const res = await createAnnouncementFromMeeting(occurrence.seriesId, occurrence.occurrenceDate)
    if (res.ok) setPosted(true)
    else setError(res.error ?? t('meet.detail.postFailed'))
  })
```

- [ ] **Step 6: 푸터에 버튼 추가**

같은 파일 푸터의 `canEdit ? (...)` 분기 안, 여는 `<>` 바로 다음(라인 80 `{occurrence.isRecurring && (` **앞**)에 공지 버튼을 넣고, cancelOccurrence 버튼의 `mr-auto`를 조건부로 바꾼다:

```tsx
        footer={canEdit ? (
          <>
            {role === 'pmo_admin' && (
              posted ? (
                <span className="btn btn-ghost mr-auto pointer-events-none text-progress"><Check className="h-4 w-4" />{t('meet.detail.postedAsAnnouncement')}</span>
              ) : (
                <button onClick={runPost} disabled={posting || pending} className="btn btn-ghost mr-auto text-brand hover:bg-brand-weak">
                  <Megaphone className="h-4 w-4" />{posting ? t('meet.detail.posting') : t('meet.detail.postAsAnnouncement')}
                </button>
              )
            )}
            {occurrence.isRecurring && (
              <button onClick={() => setConfirmCancel(true)} disabled={pending} className={`btn btn-ghost text-pending hover:bg-pending-weak ${role === 'pmo_admin' ? '' : 'mr-auto'}`}>
                <Ban className="h-4 w-4" />{t('meet.detail.cancelOccurrence')}
              </button>
            )}
            <button onClick={() => setConfirmDelete(true)} disabled={pending} className="btn btn-ghost text-delayed hover:bg-delayed-weak"><Trash2 className="h-4 w-4" />{t('meet.detail.deleteSeries')}</button>
            <button onClick={() => detail && onEditSeries(detail.meeting)} disabled={pending || !detail} className="btn btn-primary"><Pencil className="h-4 w-4" />{t('meet.detail.editSeries')}</button>
          </>
        ) : (
          <button onClick={onClose} className="btn btn-ghost">{t('common.close')}</button>
        )}
```

(원래 라인 81의 cancelOccurrence 버튼에 있던 `mr-auto`를 위처럼 조건부로 바꾸는 것이 핵심 — 공지 버튼이 없을 때는 취소 버튼이 좌측을 유지.)

- [ ] **Step 7: Lint**

Run: `npm run lint`
Expected: 이 두 파일 관련 신규 에러 없음.

- [ ] **Step 8: Build**

Run: `npm run build`
Expected: 성공(브라우저 검증 불가 환경 — 빌드가 타입/컴파일 게이트).

- [ ] **Step 9: Full test suite**

Run: `npx vitest run`
Expected: 신규 테스트 포함 전부 PASS.

- [ ] **Step 10: Commit**

```bash
git add src/lib/i18n/dict/meetings.ts src/components/meetings/MeetingDetailModal.tsx
git commit -m "feat(meetings): 회의 상세에서 '공지로 등록' 원클릭(PMO 전용)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## 검증 관점 요약 (verify 스킬)

이 샌드박스는 브라우저로 localhost 접근 불가 → 런타임 검증은 **build + lint + vitest**로 대체.
- 순수 함수: body 조합 6케이스(Task 1).
- 서버 액션: pmo_admin 게이트(Task 2). 회차 검증·insert는 build 타입체크 + 로직 리뷰로 커버(Supabase 통합 테스트는 프로덕션 DB 공유라 지양 — D-CUBE 데이터 보호 규칙).
- UI: build로 타입/JSX 게이트.

## Self-Review 결과

- **스펙 커버리지:** 배치(Task 3) / 원클릭 동작(Task 2+3) / body 형식(Task 1) / 게시기간(Task 1) / 권한(Task 2 게이트 + Task 3 버튼 노출) / i18n(Task 3) — 전부 매핑됨.
- **플레이스홀더:** 없음(모든 코드 블록 완전).
- **타입 일관성:** `composeAnnouncementFromMeeting`·`MeetingAnnouncementSource` 시그니처가 Task 1 정의 = Task 2 사용 일치. `createAnnouncementFromMeeting(meetingId, occurrenceDate)` 시그니처가 Task 2 정의 = Task 3 호출 일치. 반환 `AnnouncementActionResult`({ok,error}) 사용처 일치.
