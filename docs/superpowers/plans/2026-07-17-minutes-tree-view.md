# 회의록 트리 뷰 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 회의록 보관함(`/minutes`)에 리스트·달력에 이은 세 번째 뷰 "트리"(구분 → 회의체 → 회의록, 전 기간)를 추가한다.

**Architecture:** 도메인 순수 함수(`meetingBodyOf` 노이즈 토큰 제거 + `buildMinutesTree` 그룹핑)를 서버 데이터 계층이 호출해 완성된 트리 JSON을 반환하고(서버 집계), 클라이언트는 렌더와 팀 프루닝만 한다. 뷰 토글은 기존 `UiPrefs.minutesView` 계정 동기화에 `'tree'` 값을 추가한다.

**Tech Stack:** Next.js App Router(서버 액션), Supabase(PostgREST), React 19, Tailwind v4 토큰, vitest.

**Spec:** `docs/superpowers/specs/2026-07-17-minutes-tree-view-design.md` — 이 계획의 모든 수치·규칙의 원천. 충돌 시 스펙이 우선.

## Global Constraints

- **`git add -A`/`git add .` 절대 금지** — 이 레포는 병렬 세션이 같은 워킹트리를 수정한다. 각 태스크에 명시된 파일만 스테이징한다.
- **병렬 세션 주의**: 실행 시점에 `git status`로 미커밋 파일을 확인하라. 특히 `src/lib/i18n/dict/minutes.ts`는 다른 세션이 수정 중일 수 있다 — 스테이징 전 `git diff src/lib/i18n/dict/minutes.ts`로 **자기 변경만 있는지** 확인하고, 남의 변경이 섞여 있으면 스테이징하지 말고 사용자에게 보고하라. 겹침이 심하면 worktree 격리(superpowers:using-git-worktrees)로 실행하라.
- **DB 무변경**: 마이그레이션·스키마 변경 없음. 운영 D-CUBE 데이터에 쓰기 검증 금지(로컬 dev도 프로덕션 DB 공유).
- **`MINUTES_TREE_LIMIT = 1000`** — PostgREST `max_rows` 하드 캡(`supabase/config.toml:18`)과 일치. 스펙은 이 상수를 데이터 계층에 뒀지만, 클라이언트 안내문에서도 필요하므로 **`src/lib/domain/minutes.ts`에 정의**한다(서버 전용 모듈을 클라이언트로 끌어오지 않기 위한 의도적 배치 변경).
- **i18n**: `src/lib/i18n/dict/minutes.ts`의 ko 블록에 키를 추가하면 en 블록은 `Record<keyof typeof minutesKo, string>` 타입이 누락을 컴파일 에러로 강제한다. `t()`는 파라미터 치환을 지원하지 않으므로 `{n}` 자리는 렌더 시 `.replace('{n}', String(MINUTES_TREE_LIMIT))`로 채운다.
- **디자인**: 기존 토큰(`.card`, `.btn`, `.seg`, `text-ink-*`)과 `src/components/ui/` 프리미티브, `TEAM` 매핑(`src/components/wbs/shared.tsx:3-7`)만 사용. 새 색상·새 CSS 금지.
- **검증**: 샌드박스에서 dev 서버 브라우저 접속 불가 — build/lint/test로 검증(verify 스킬 참조). 단일 테스트 실행: `npx vitest run tests/domain/minutesTree.test.ts`.
- **커밋 메시지 끝에**: `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`

---

### Task 1: 도메인 — 노이즈 토큰 판정 + `meetingBodyOf`

**Files:**
- Modify: `src/lib/domain/minutes.ts` (파일 끝에 추가)
- Test: `tests/domain/minutesTree.test.ts` (신규)

**Interfaces:**
- Consumes: 없음 (순수 함수)
- Produces: `meetingBodyOf(title: string): string`, `MINUTES_TREE_LIMIT: number` — Task 2·3·6이 사용

- [ ] **Step 1: 실패하는 테스트 작성**

`tests/domain/minutesTree.test.ts` 신규 생성:

```ts
import { describe, it, expect } from 'vitest'
import { meetingBodyOf } from '@/lib/domain/minutes'

describe('meetingBodyOf — 노이즈 토큰 제거', () => {
  it.each([
    // 스펙 예시 표 10케이스
    ['물류공정_260716_2026-07-16', '물류공정'],
    ['공정조_2026.07.16_2026-07-16', '공정조'],
    ['주간회의 260716', '주간회의'],
    ['주간정례_12차_260716', '주간정례'],
    ['물류공정_7.16(수)', '물류공정'],
    ['260716_주간회의', '주간회의'],
    ['PMO_260716_물류공정회의', 'PMO 물류공정회의'],
    ['물류공정_킥오프', '물류공정 킥오프'],
    ['7월 주간회의 메모', '7월 주간회의 메모'],
    ['2026-07-16', '2026-07-16'],
  ])('%s → %s', (title, expected) => {
    expect(meetingBodyOf(title)).toBe(expected)
  })

  it.each([
    // 노이즈 변형
    ['정산_2026-07-16(금)', '정산'],   // 요일 괄호 붙은 연월일
    ['정산_26.07.16', '정산'],         // 2자리 연도
    ['정산_2026/07/16', '정산'],       // 슬래시 구분
    ['정산_제3차', '정산'],            // 제N차
    ['정산_(5차)', '정산'],            // 괄호 회차
    ['정산_7.16 (수)', '정산'],        // 요일 괄호 단독 토큰
    ['정산_20260716', '정산'],         // 8자리
    ['정산_2026.07', '정산'],          // 연월만
  ])('노이즈 변형 %s → %s', (title, expected) => {
    expect(meetingBodyOf(title)).toBe(expected)
  })

  it('앞뒤 공백은 trim된다', () => {
    expect(meetingBodyOf('  물류공정_260716  ')).toBe('물류공정')
  })
  it('혼합 구분자(_와 공백)는 동일 취급', () => {
    expect(meetingBodyOf('물류 공정_260716 결과')).toBe('물류 공정 결과')
  })
  it('공백만 있는 제목은 빈 문자열', () => {
    expect(meetingBodyOf('   ')).toBe('')
  })
})
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run tests/domain/minutesTree.test.ts`
Expected: FAIL — `meetingBodyOf`가 export되지 않음 (SyntaxError/undefined)

- [ ] **Step 3: 최소 구현**

`src/lib/domain/minutes.ts` 파일 끝에 추가:

```ts
/* ── 트리 뷰: 회의체 추출 (스펙 2026-07-17-minutes-tree-view-design.md) ── */

export const MINUTES_TREE_LIMIT = 1000 // PostgREST max_rows 하드 캡(supabase/config.toml)과 일치 — 초과 값은 성립 불가

// 노이즈 토큰(전체 일치): 날짜형 4종(꼬리 요일 괄호 허용) + 회차형 + 요일 괄호 단독
const WEEKDAY_TAIL = '(?:\\((?:월|화|수|목|금|토|일)\\))?'
const NOISE_PATTERNS = [
  new RegExp(`^\\d{6}${WEEKDAY_TAIL}$`),                                    // 260716
  new RegExp(`^\\d{8}${WEEKDAY_TAIL}$`),                                    // 20260716
  new RegExp(`^\\d{4}[.\\-/]\\d{1,2}(?:[.\\-/]\\d{1,2})?${WEEKDAY_TAIL}$`), // 2026-07-16, 2026.07
  new RegExp(`^\\d{2}[.\\-/]\\d{1,2}[.\\-/]\\d{1,2}${WEEKDAY_TAIL}$`),      // 26.07.16
  new RegExp(`^\\d{1,2}[.\\-/]\\d{1,2}${WEEKDAY_TAIL}$`),                   // 7.16, 07-16
  /^\(?제?\d{1,4}차\)?$/,                                                    // 12차, 제3차, (5차)
  /^\((?:월|화|수|목|금|토|일)\)$/,                                          // (수)
]

function isNoiseToken(token: string): boolean {
  return NOISE_PATTERNS.some(re => re.test(token))
}

/** 제목에서 회의체 이름 추출 — `_`·공백 토큰화 후 노이즈(날짜·회차·요일) 제거, 공백 1칸 결합.
 *  전부 제거되어 비면 원제목(trim) 반환. 그룹 키이자 표시명. */
export function meetingBodyOf(title: string): string {
  const trimmed = title.trim()
  const kept = trimmed.split(/[_\s]+/).filter(tok => tok !== '' && !isNoiseToken(tok))
  return kept.length > 0 ? kept.join(' ') : trimmed
}
```

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run tests/domain/minutesTree.test.ts`
Expected: PASS (15 tests)

- [ ] **Step 5: 커밋**

```bash
git add src/lib/domain/minutes.ts tests/domain/minutesTree.test.ts
git commit -m "feat(minutes): 회의체 이름 추출 meetingBodyOf — 날짜·회차·요일 노이즈 토큰 제거

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: 도메인 — 트리 타입 + `buildMinutesTree`

**Files:**
- Modify: `src/lib/domain/types.ts` (`Minute` 블록 뒤, 약 180행 부근에 추가)
- Modify: `src/lib/domain/minutes.ts` (파일 끝에 추가)
- Test: `tests/domain/minutesTree.test.ts` (append)

**Interfaces:**
- Consumes: `meetingBodyOf` (Task 1), `TEAM_CODES`(기존, `src/lib/domain/minutes.ts:9`), `Minute`·`TeamCode` 타입(기존)
- Produces: `MinutesTreeLeaf`/`MinutesTreeBody`/`MinutesTreeGroup` 타입, `buildMinutesTree(minutes: Minute[]): MinutesTreeGroup[]` — Task 3·5·6이 사용

- [ ] **Step 1: 실패하는 테스트 작성**

`tests/domain/minutesTree.test.ts` 끝에 추가:

```ts
import { buildMinutesTree } from '@/lib/domain/minutes'
import type { Minute, TeamCode } from '@/lib/domain/types'

// 헬퍼 — 목록 조회 shape(bodyMd 빈 문자열). 입력은 minute_date desc 정렬로 넘긴다.
const minute = (id: string, date: string, team: TeamCode, title: string): Minute => ({
  id, minuteDate: date, teamCode: team, title, bodyMd: '',
  meetingId: null, createdBy: null, createdByName: `작성자${id}`,
  createdAt: `${date}T09:00:00Z`, updatedAt: `${date}T09:00:00Z`, fileCount: 1,
})

describe('buildMinutesTree', () => {
  it('구분→회의체→리프로 그룹핑하고 동일 이름을 병합한다', () => {
    const tree = buildMinutesTree([
      minute('a', '2026-07-16', 'MES', '물류공정_260716'),
      minute('b', '2026-07-09', 'MES', '물류공정_260709'),
      minute('c', '2026-07-15', 'MES', '공정조_260715'),
    ])
    expect(tree).toHaveLength(1)
    expect(tree[0].teamCode).toBe('MES')
    expect(tree[0].count).toBe(3)
    expect(tree[0].bodies.map(b => b.name)).toEqual(['물류공정', '공정조'])
    expect(tree[0].bodies[0].count).toBe(2)
    expect(tree[0].bodies[0].leaves.map(l => l.id)).toEqual(['a', 'b']) // 입력 순서 보존
  })

  it('팀 그룹은 TEAM_CODES 순서(PMO→ERP→MES→가공), 0건 팀은 미포함', () => {
    const tree = buildMinutesTree([
      minute('a', '2026-07-16', 'MES', 'X_260716'),
      minute('b', '2026-07-16', 'PMO', 'Y_260716'),
    ])
    expect(tree.map(g => g.teamCode)).toEqual(['PMO', 'MES'])
  })

  it('미지 팀 코드는 버리지 않고 TEAM_CODES 뒤에 등장 순으로 붙인다', () => {
    const rows = [
      { ...minute('a', '2026-07-16', 'MES', 'X_260716'), teamCode: '레거시' as TeamCode },
      minute('b', '2026-07-15', 'PMO', 'Y_260715'),
    ]
    const tree = buildMinutesTree(rows)
    expect(tree.map(g => String(g.teamCode))).toEqual(['PMO', '레거시'])
  })

  it('회의체는 latestDate desc 정렬, 동률이면 첫 등장 순', () => {
    const tree = buildMinutesTree([
      minute('a', '2026-07-16', 'MES', '나중등장동률_260716'), // 첫 등장
      minute('b', '2026-07-16', 'MES', '두번째동률_260716'),
      minute('c', '2026-07-10', 'MES', '오래된_260710'),
    ])
    expect(tree[0].bodies.map(b => b.name)).toEqual(['나중등장동률', '두번째동률', '오래된'])
    expect(tree[0].bodies[0].latestDate).toBe('2026-07-16')
  })

  it('리프는 fileCount·createdByName을 담고 자체 재정렬하지 않는다', () => {
    const tree = buildMinutesTree([minute('a', '2026-07-16', 'ERP', '정산_260716')])
    const leaf = tree[0].bodies[0].leaves[0]
    expect(leaf).toEqual({
      id: 'a', minuteDate: '2026-07-16', title: '정산_260716',
      fileCount: 1, createdByName: '작성자a',
    })
  })

  it('빈 입력은 빈 배열', () => {
    expect(buildMinutesTree([])).toEqual([])
  })
})
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run tests/domain/minutesTree.test.ts`
Expected: FAIL — `buildMinutesTree`가 export되지 않음

- [ ] **Step 3: 타입 추가**

`src/lib/domain/types.ts`의 `Minute` 인터페이스 블록 끝(`fileCount?: number` 줄 뒤의 `}` 다음, `MinuteFile` 앞)에 추가:

```ts
/** 트리 뷰(구분→회의체→회의록) — 서버 집계 결과. */
export interface MinutesTreeLeaf {
  id: string
  minuteDate: string           // 'YYYY-MM-DD'
  title: string
  fileCount: number
  createdByName: string | null
}
export interface MinutesTreeBody {
  name: string                 // meetingBodyOf 추출 결과(그룹 키이자 표시명)
  count: number
  latestDate: string           // 첫 리프(최신)의 minuteDate — 정렬 기준
  leaves: MinutesTreeLeaf[]
}
export interface MinutesTreeGroup {
  teamCode: TeamCode
  count: number
  bodies: MinutesTreeBody[]
}
```

- [ ] **Step 4: `buildMinutesTree` 구현**

`src/lib/domain/minutes.ts` 파일 끝에 추가 (import에 `MinutesTreeBody`, `MinutesTreeGroup`, `Minute` 추가 — 기존 1행 `import type { TeamCode } from './types'`를 확장):

```ts
import type { Minute, MinutesTreeBody, MinutesTreeGroup, TeamCode } from './types'
```

```ts
/** 목록 → 트리 조립. 입력이 minute_date desc, created_at desc 정렬임을 전제하며 자체 재정렬하지 않는다
 *  (리프 순서 = 입력 순서). 팀은 TEAM_CODES 순 — 미지 코드는 조용히 버리지 않고 뒤에 등장 순으로 붙인다.
 *  회의체는 latestDate desc(동률은 첫 등장 순 — 안정 정렬). 0건 팀은 그룹을 만들지 않는다. */
export function buildMinutesTree(minutes: Minute[]): MinutesTreeGroup[] {
  const byTeam = new Map<string, Map<string, MinutesTreeBody>>()
  const teamAppearance: string[] = []
  for (const mi of minutes) {
    let bodies = byTeam.get(mi.teamCode)
    if (!bodies) {
      bodies = new Map()
      byTeam.set(mi.teamCode, bodies)
      teamAppearance.push(mi.teamCode)
    }
    const name = meetingBodyOf(mi.title)
    let body = bodies.get(name)
    if (!body) {
      body = { name, count: 0, latestDate: mi.minuteDate, leaves: [] }
      bodies.set(name, body)
    }
    body.count += 1
    body.leaves.push({
      id: mi.id, minuteDate: mi.minuteDate, title: mi.title,
      fileCount: mi.fileCount ?? 0, createdByName: mi.createdByName,
    })
  }
  const known = TEAM_CODES.filter(tk => byTeam.has(tk)) as string[]
  const unknown = teamAppearance.filter(tk => !(TEAM_CODES as string[]).includes(tk))
  return [...known, ...unknown].map(tk => {
    const bodies = [...byTeam.get(tk)!.values()]
    // Array.sort는 안정 정렬 — 동률(latestDate 같음)은 Map 삽입 순서(첫 등장 순) 유지
    bodies.sort((a, b) => (a.latestDate < b.latestDate ? 1 : a.latestDate > b.latestDate ? -1 : 0))
    return {
      teamCode: tk as TeamCode,
      count: bodies.reduce((sum, b) => sum + b.count, 0),
      bodies,
    }
  })
}
```

- [ ] **Step 5: 통과 확인**

Run: `npx vitest run tests/domain/minutesTree.test.ts`
Expected: PASS (21 tests)

- [ ] **Step 6: 커밋**

```bash
git add src/lib/domain/types.ts src/lib/domain/minutes.ts tests/domain/minutesTree.test.ts
git commit -m "feat(minutes): buildMinutesTree — 구분→회의체→회의록 서버 집계용 순수 함수

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: 데이터 계층 `getMinutesTree` + 서버 액션 `fetchMinutesTree`

**Files:**
- Modify: `src/lib/data/minutes.ts` (`searchMinutes` 함수 뒤에 추가, import 확장)
- Modify: `src/app/actions/minutes.ts` (`fetchMinutesSearch` 함수 뒤(약 323행)에 추가, import 확장)

**Interfaces:**
- Consumes: `buildMinutesTree`, `MINUTES_TREE_LIMIT` (Task 1·2), 기존 `LIST_COLS`·`mapMinute`·`Row`(`src/lib/data/minutes.ts` 내부), `getSession`(기존)
- Produces: `getMinutesTree(): Promise<MinutesTreeResult | null>`, `fetchMinutesTree(): Promise<MinutesTreeResult | null>` — Task 6이 사용. 여기서 `MinutesTreeResult = { groups: MinutesTreeGroup[]; total: number; truncated: boolean }` (별칭 타입은 만들지 않고 인라인 유지 — 기존 파일 관례)

수동 검증만(외부 I/O 계층 — 기존 데이터 함수들도 단위 테스트 없음). 타입 게이트는 lint로 확인.

- [ ] **Step 1: 데이터 함수 구현**

`src/lib/data/minutes.ts` — import 확장 (4행 부근):

```ts
import { buildMinutesTree, ilikeOrPattern, MINUTES_TREE_LIMIT } from '@/lib/domain/minutes'
```

타입 import에 `MinutesTreeGroup` 추가 (3행의 `import type { ... } from '@/lib/domain/types'` 목록에 삽입).

`searchMinutes` 함수 뒤에 추가:

```ts
/** 전 기간·전 팀 트리(구분→회의체→회의록). 실패 시 로깅 + null —
 *  빈 트리 []와 구분해 '회의록 없음'으로 위장되는 조용한 빈 화면을 방지한다.
 *  MINUTES_TREE_LIMIT(1000)은 PostgREST max_rows 하드 캡과 일치 — 서버 캡이 .limit보다 우선하므로
 *  이보다 큰 값은 성립하지 않는다. total은 집계에 사용된(표시되는) 행 수이며 실제 전체 건수가 아니다. */
export const getMinutesTree = cache(async (): Promise<
  { groups: MinutesTreeGroup[]; total: number; truncated: boolean } | null
> => {
  const sb = await createServerClient()
  const { data, error } = await sb.from('minutes').select(LIST_COLS)
    .order('minute_date', { ascending: false }).order('created_at', { ascending: false })
    .limit(MINUTES_TREE_LIMIT)
  if (error) {
    console.error('[getMinutesTree] 조회 실패:', error.message)
    return null
  }
  const rows = (data ?? []).map((r: Row) => mapMinute(r))
  return {
    groups: buildMinutesTree(rows),
    total: rows.length,
    truncated: rows.length >= MINUTES_TREE_LIMIT,
  }
})
```

- [ ] **Step 2: 서버 액션 구현**

`src/app/actions/minutes.ts` — import 확장: 8행의 data import에 `getMinutesTree` 추가, 9행의 타입 import에 `MinutesTreeGroup` 추가:

```ts
import { getMinuteDetail, getMinutesPage, getMinutesTree, searchMinutes } from '@/lib/data/minutes'
import type { Minute, MinutesTreeGroup, TeamCode } from '@/lib/domain/types'
```

`fetchMinutesSearch` 함수 바로 뒤에 추가:

```ts
/** 트리 뷰 진입/재시도/업로드 후 클라이언트 호출용.
 *  기존 액션들의 [] 폴백과 달리 에러 상태를 UI까지 전달하기 위해 null을 반환한다(의도적 관례 이탈).
 *  미로그인/세션 만료도 v1에서는 구분하지 않는다 — 이 페이지는 인증 하에 있어 실사용상 만료 엣지뿐이며
 *  에러 카드+재시도로 수용(스펙 '서버 액션' 절). */
export async function fetchMinutesTree(): Promise<
  { groups: MinutesTreeGroup[]; total: number; truncated: boolean } | null
> {
  const user = await getSession()
  if (!user) return null
  return getMinutesTree()
}
```

- [ ] **Step 3: 타입 게이트**

Run: `npx tsc --noEmit`
Expected: 에러 0 (`next lint`는 타입 체크를 하지 않으므로 tsc를 쓴다)

- [ ] **Step 4: 커밋**

```bash
git add src/lib/data/minutes.ts src/app/actions/minutes.ts
git commit -m "feat(minutes): getMinutesTree 서버 집계 + fetchMinutesTree 액션 — 실패 시 null로 에러 전달

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: i18n 키 + `UiPrefs.minutesView` 타입 확장

**Files:**
- Modify: `src/lib/i18n/dict/minutes.ts` (ko·en 블록 각각 `'min.view.calendar'` 줄 뒤에 7키 추가)
- Modify: `src/lib/domain/types.ts:162` (`minutesView` union에 `'tree'`)

**Interfaces:**
- Consumes: 없음
- Produces: dict 키 `min.view.tree`, `min.tree.expandAll`, `min.tree.collapseAll`, `min.tree.allPeriod`, `min.tree.truncated`, `min.tree.error`, `min.tree.retry`; `UiPrefs.minutesView?: 'list' | 'calendar' | 'tree'` — Task 5·6이 사용

⚠ **스테이징 전 `git diff src/lib/i18n/dict/minutes.ts` 확인** — 병렬 세션 변경이 섞여 있으면 중단하고 보고 (Global Constraints).

- [ ] **Step 1: ko 블록에 키 추가**

`src/lib/i18n/dict/minutes.ts`의 `minutesKo` 안, `'min.view.calendar': '달력',` 줄 바로 아래:

```ts
  'min.view.tree': '트리',
  'min.tree.expandAll': '전체 펼치기',
  'min.tree.collapseAll': '전체 접기',
  'min.tree.allPeriod': '전체 기간',
  'min.tree.truncated': '최근 {n}건 기준으로 표시·집계됩니다',
  'min.tree.error': '트리를 불러오지 못했습니다',
  'min.tree.retry': '다시 시도',
```

- [ ] **Step 2: en 블록에 키 추가**

같은 파일 `minutesEn` 안, `'min.view.calendar': 'Calendar',` 줄 바로 아래:

```ts
  'min.view.tree': 'Tree',
  'min.tree.expandAll': 'Expand all',
  'min.tree.collapseAll': 'Collapse all',
  'min.tree.allPeriod': 'All time',
  'min.tree.truncated': 'Showing and counting the most recent {n} only',
  'min.tree.error': 'Failed to load the tree',
  'min.tree.retry': 'Retry',
```

- [ ] **Step 3: `UiPrefs` 타입 확장**

`src/lib/domain/types.ts:162`를:

```ts
  minutesView?: 'list' | 'calendar' | 'tree'   // 회의록 보관함 뷰 토글
```

(참고: `saveUiPrefs`는 화이트리스트 없는 병합 upsert(`preferences.ts:21-33`)라 이 타입 확장만으로 저장·복원 동작. `page.tsx:47`의 `prefs.minutesView ?? 'list'`도 그대로 통과.)

- [ ] **Step 4: 파리티·타입 게이트**

Run: `npx tsc --noEmit`
Expected: 에러 0 — en 블록 누락 시 `Record<keyof typeof minutesKo, string>`가 타입 에러를 냄 (`next lint`는 타입 체크를 하지 않음)

- [ ] **Step 5: 커밋**

```bash
git diff src/lib/i18n/dict/minutes.ts   # 자기 변경만인지 육안 확인 후
git add src/lib/i18n/dict/minutes.ts src/lib/domain/types.ts
git commit -m "feat(minutes): 트리 뷰 i18n 키 + UiPrefs.minutesView에 'tree' 추가

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: `MinutesTree` 컴포넌트

**Files:**
- Create: `src/components/minutes/MinutesTree.tsx`
- Test: `tests/ui/minutes-tree.test.tsx` (신규)

**Interfaces:**
- Consumes: `MinutesTreeGroup`(Task 2), dict 키(Task 4), `TEAM`(`src/components/wbs/shared.tsx:3`), `useLocale`(기존)
- Produces: `MinutesTree({ groups }: { groups: MinutesTreeGroup[] })` — Task 6이 사용

- [ ] **Step 1: 실패하는 테스트 작성**

`tests/ui/minutes-tree.test.tsx` 신규 (기존 `tests/ui/sidebar-sync.test.tsx` 관례 — jsdom + createRoot + act + vi.mock):

```tsx
// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { MinutesTreeGroup } from '@/lib/domain/types'

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

vi.mock('@/components/providers/LocaleProvider', () => ({ useLocale: () => ({ t: (k: string) => k, locale: 'ko' }) }))
vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: { href: string; children: React.ReactNode }) =>
    <a href={href} {...props}>{children}</a>,
}))

import { MinutesTree } from '@/components/minutes/MinutesTree'

const groups: MinutesTreeGroup[] = [
  {
    teamCode: 'MES', count: 2,
    bodies: [{
      name: '물류공정', count: 2, latestDate: '2026-07-16',
      leaves: [
        { id: 'm1', minuteDate: '2026-07-16', title: '물류공정_260716', fileCount: 1, createdByName: '김철수' },
        { id: 'm2', minuteDate: '2026-07-09', title: '물류공정_260709', fileCount: 0, createdByName: null },
      ],
    }],
  },
  { teamCode: 'PMO', count: 1, bodies: [{ name: '정산', count: 1, latestDate: '2026-07-10', leaves: [
    { id: 'm3', minuteDate: '2026-07-10', title: '정산_260710', fileCount: 0, createdByName: null },
  ] }] },
]

describe('MinutesTree', () => {
  let container: HTMLDivElement, root: Root
  beforeEach(() => { container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container) })
  afterEach(() => { act(() => root.unmount()); container.remove() })

  function mount(g: MinutesTreeGroup[] = groups) {
    act(() => root.render(<MinutesTree groups={g} />))
  }
  function buttonByText(text: string): HTMLButtonElement {
    const found = [...container.querySelectorAll('button')].find(b => b.textContent?.includes(text))
    if (!found) throw new Error(`button not found: ${text}`)
    return found
  }

  it('기본 상태: 레벨1 펼침(회의체 보임), 레벨2 접힘(리프 안 보임)', () => {
    mount()
    expect(container.textContent).toContain('물류공정')
    expect(container.textContent).not.toContain('물류공정_260716')
  })

  it('회의체 클릭 → 리프가 /minutes/{id} 링크로 보인다', () => {
    mount()
    act(() => buttonByText('물류공정').click())
    const link = container.querySelector('a[href="/minutes/m1"]')
    expect(link).not.toBeNull()
    expect(link!.textContent).toContain('물류공정_260716')
  })

  it('구분 클릭 → 그 팀 전체가 접힌다(aria-expanded 반영)', () => {
    mount()
    const teamBtn = buttonByText('MES')
    expect(teamBtn.getAttribute('aria-expanded')).toBe('true')
    act(() => teamBtn.click())
    expect(teamBtn.getAttribute('aria-expanded')).toBe('false')
    expect(container.textContent).not.toContain('물류공정')
  })

  it('전체 펼치기 → 모든 리프 표시, 다시 누르면(전체 접기) 레벨1까지 접힘', () => {
    mount()
    act(() => buttonByText('min.tree.expandAll').click())
    expect(container.querySelector('a[href="/minutes/m1"]')).not.toBeNull()
    expect(container.querySelector('a[href="/minutes/m3"]')).not.toBeNull()
    act(() => buttonByText('min.tree.collapseAll').click())
    expect(container.textContent).not.toContain('물류공정')  // 레벨2 이하 안 보임
    expect(container.textContent).toContain('MES')            // 레벨1 행 자체는 보임
  })
})
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run tests/ui/minutes-tree.test.tsx`
Expected: FAIL — `MinutesTree` 모듈 없음

- [ ] **Step 3: 컴포넌트 구현**

`src/components/minutes/MinutesTree.tsx` 신규:

```tsx
'use client'
import { useState } from 'react'
import Link from 'next/link'
import { ChevronDown, ChevronRight, Paperclip } from 'lucide-react'
import type { MinutesTreeGroup } from '@/lib/domain/types'
import { useLocale } from '@/components/providers/LocaleProvider'
import { TEAM } from '@/components/wbs/shared'

/** 구분→회의체→회의록 트리 (스펙 2026-07-17-minutes-tree-view-design.md).
 *  레벨1은 접힘 Set(기본 펼침), 레벨2는 펼침 Set(기본 접힘) — 시드 없이 기본 상태가 성립.
 *  재조회로 groups가 바뀌어도 두 Set은 유지(사라진 키는 무해). 접힘 상태는 비영속(v1). */
export function MinutesTree({ groups }: { groups: MinutesTreeGroup[] }) {
  const { t } = useLocale()
  const [collapsedTeams, setCollapsedTeams] = useState<Set<string>>(new Set())
  const [expandedBodies, setExpandedBodies] = useState<Set<string>>(new Set())
  // 버튼 라벨·동작은 마지막으로 누른 동작 기준(개별 노드 조작은 영향 없음). 초기 '전체 펼치기'.
  const [allExpanded, setAllExpanded] = useState(false)

  function toggleTeam(teamKey: string) {
    setCollapsedTeams(prev => {
      const next = new Set(prev)
      if (next.has(teamKey)) next.delete(teamKey); else next.add(teamKey)
      return next
    })
  }
  function toggleBody(bodyKey: string) {
    setExpandedBodies(prev => {
      const next = new Set(prev)
      if (next.has(bodyKey)) next.delete(bodyKey); else next.add(bodyKey)
      return next
    })
  }
  function toggleAll() {
    if (allExpanded) {
      // 전체 접기 — 레벨1까지 전부 접음(라벨과 일치)
      setCollapsedTeams(new Set(groups.map(g => g.teamCode)))
      setExpandedBodies(new Set())
    } else {
      setCollapsedTeams(new Set())
      setExpandedBodies(new Set(groups.flatMap(g => g.bodies.map(b => `${g.teamCode}/${b.name}`))))
    }
    setAllExpanded(v => !v)
  }

  return (
    <div className="card p-3">
      <div className="mb-1 flex justify-end">
        <button onClick={toggleAll} className="btn h-8 px-2.5 text-xs">
          {allExpanded ? t('min.tree.collapseAll') : t('min.tree.expandAll')}
        </button>
      </div>
      <ul className="space-y-0.5">
        {groups.map(g => {
          const teamCollapsed = collapsedTeams.has(g.teamCode)
          return (
            <li key={g.teamCode}>
              <button onClick={() => toggleTeam(g.teamCode)} aria-expanded={!teamCollapsed}
                className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left hover:bg-surface-2">
                {teamCollapsed
                  ? <ChevronRight className="h-4 w-4 shrink-0 text-ink-subtle" />
                  : <ChevronDown className="h-4 w-4 shrink-0 text-ink-subtle" />}
                {/* 미지 팀 코드(방어 케이스)는 회색 점 폴백 */}
                <span className={`inline-block h-2.5 w-2.5 shrink-0 rounded-full ${TEAM[g.teamCode]?.bar ?? 'bg-ink-subtle'}`} />
                <span className="text-sm font-semibold text-ink">{g.teamCode}</span>
                <span className="text-xs tabular-nums text-ink-muted">{g.count}</span>
              </button>
              {!teamCollapsed && (
                <ul className="ml-5 space-y-0.5 border-l border-line/70 pl-2">
                  {g.bodies.map(b => {
                    const bodyKey = `${g.teamCode}/${b.name}`
                    const expanded = expandedBodies.has(bodyKey)
                    return (
                      <li key={bodyKey}>
                        <button onClick={() => toggleBody(bodyKey)} aria-expanded={expanded}
                          className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-surface-2">
                          {expanded
                            ? <ChevronDown className="h-4 w-4 shrink-0 text-ink-subtle" />
                            : <ChevronRight className="h-4 w-4 shrink-0 text-ink-subtle" />}
                          <span className="truncate text-sm font-medium text-ink">{b.name}</span>
                          <span className="text-xs tabular-nums text-ink-muted">{b.count}</span>
                          <span className="ml-auto text-xs tabular-nums text-ink-subtle">{b.latestDate}</span>
                        </button>
                        {expanded && (
                          <ul className="ml-5 divide-y divide-line/70 border-l border-line/70 pl-2">
                            {b.leaves.map(leaf => (
                              <li key={leaf.id}>
                                <Link href={`/minutes/${leaf.id}`}
                                  className="flex items-center gap-3 rounded-lg px-2 py-2 hover:bg-surface-2">
                                  <span className="w-20 shrink-0 text-xs tabular-nums text-ink-subtle">{leaf.minuteDate}</span>
                                  <span className="flex-1 truncate text-sm font-medium text-ink">{leaf.title}</span>
                                  {leaf.fileCount > 0 && (
                                    <span className="inline-flex items-center gap-1 text-xs text-ink-subtle">
                                      <Paperclip className="h-3.5 w-3.5" />{leaf.fileCount}
                                    </span>
                                  )}
                                  <span className="w-24 truncate text-right text-xs text-ink-subtle">{leaf.createdByName ?? ''}</span>
                                </Link>
                              </li>
                            ))}
                          </ul>
                        )}
                      </li>
                    )
                  })}
                </ul>
              )}
            </li>
          )
        })}
      </ul>
    </div>
  )
}
```

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run tests/ui/minutes-tree.test.tsx`
Expected: PASS (4 tests)

- [ ] **Step 5: 커밋**

```bash
git add src/components/minutes/MinutesTree.tsx tests/ui/minutes-tree.test.tsx
git commit -m "feat(minutes): MinutesTree 컴포넌트 — 접힘/펼침 2레벨 Set, aria-expanded, 토큰 재사용

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 6: `MinutesView` 통합 (토글·로드 트리거·카운트·월 라벨)

**Files:**
- Modify: `src/components/minutes/MinutesView.tsx`
- Test: `tests/ui/minutes-view-tree-toggle.test.tsx` (신규)

**Interfaces:**
- Consumes: `MinutesTree`(Task 5), `fetchMinutesTree`(Task 3), `MINUTES_TREE_LIMIT`(Task 1), dict 키(Task 4), `MinutesTreeGroup`(Task 2)
- Produces: 최종 사용자 기능 (다른 태스크가 소비하지 않음)

- [ ] **Step 1: 실패하는 테스트 작성**

`tests/ui/minutes-view-tree-toggle.test.tsx` 신규:

```tsx
// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { MinutesTreeGroup } from '@/lib/domain/types'

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

vi.mock('@/components/providers/LocaleProvider', () => ({ useLocale: () => ({ t: (k: string) => k, locale: 'ko' }) }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }))
vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: { href: string; children: React.ReactNode }) =>
    <a href={href} {...props}>{children}</a>,
}))
vi.mock('@/lib/prefs/debouncedSave', () => ({ queueUiPref: vi.fn() }))
// 무거운 자식은 스텁 — 이 테스트는 MinutesView의 배선만 본다
vi.mock('@/components/minutes/MinutesCalendar', () => ({ MinutesCalendar: () => <div data-testid="cal" /> }))
vi.mock('@/components/minutes/MinuteUploadModal', () => ({ MinuteUploadModal: () => null }))
vi.mock('@/components/minutes/ArchiveChatPanel', () => ({ ArchiveChatPanel: () => null }))

const treeResult = {
  groups: [{ teamCode: 'MES', count: 1, bodies: [{ name: '물류공정', count: 1, latestDate: '2026-07-16', leaves: [
    { id: 'm1', minuteDate: '2026-07-16', title: '물류공정_260716', fileCount: 0, createdByName: null },
  ] }] }] as MinutesTreeGroup[],
  total: 1, truncated: false,
}
const fetchMinutesTree = vi.fn(async () => treeResult as typeof treeResult | null)
vi.mock('@/app/actions/minutes', () => ({
  fetchMinutesRange: vi.fn(async () => []),
  fetchMinutesSearch: vi.fn(async () => []),
  fetchMinutesTree: (...a: unknown[]) => fetchMinutesTree(...(a as [])),
}))

import { MinutesView } from '@/components/minutes/MinutesView'

describe('MinutesView 트리 뷰 배선', () => {
  let container: HTMLDivElement, root: Root
  beforeEach(() => {
    container = document.createElement('div'); document.body.appendChild(container)
    root = createRoot(container); fetchMinutesTree.mockClear()
    fetchMinutesTree.mockImplementation(async () => treeResult)
  })
  afterEach(() => { act(() => root.unmount()); container.remove() })

  async function mount(initialView: 'list' | 'calendar' | 'tree' = 'list') {
    await act(async () => root.render(
      <MinutesView initialMinutes={[]} todayIso="2026-07-17" initialView={initialView}
        projects={[]} currentUserId="u1" role="pmo_admin" defaultTeam={null} />,
    ))
  }
  function buttonByText(text: string): HTMLButtonElement {
    const found = [...container.querySelectorAll('button')].find(b => b.textContent?.includes(text))
    if (!found) throw new Error(`button not found: ${text}`)
    return found
  }

  it('트리 탭 클릭 → fetchMinutesTree 1회 호출 + 트리 렌더 + 월 라벨이 전체 기간으로', async () => {
    await mount('list')
    expect(fetchMinutesTree).not.toHaveBeenCalled()
    await act(async () => buttonByText('min.view.tree').click())
    expect(fetchMinutesTree).toHaveBeenCalledTimes(1)
    expect(container.textContent).toContain('물류공정')
    expect(container.textContent).toContain('min.tree.allPeriod')  // 월 라벨 대체
    // 주의: not.toContain('2026-07')로 검사하면 회의체 행의 latestDate('2026-07-16')와 오탐 충돌한다
    const prevBtn = container.querySelector<HTMLButtonElement>('button[aria-label="prev month"]')
    expect(prevBtn?.disabled).toBe(true)                            // 월 네비 비활성
  })

  it('로드 완료 후 리스트로 갔다 트리로 복귀해도 재조회하지 않는다(캐시 재사용)', async () => {
    await mount('list')
    await act(async () => buttonByText('min.view.tree').click())
    await act(async () => buttonByText('min.view.list').click())
    await act(async () => buttonByText('min.view.tree').click())
    expect(fetchMinutesTree).toHaveBeenCalledTimes(1)
  })

  it('initialView=tree 마운트 시 자동 조회한다', async () => {
    await mount('tree')
    expect(fetchMinutesTree).toHaveBeenCalledTimes(1)
    expect(container.textContent).toContain('물류공정')
  })

  it('null 반환 시 에러 카드 + 재시도 버튼, 재시도가 재조회한다', async () => {
    fetchMinutesTree.mockImplementationOnce(async () => null)
    await mount('tree')
    expect(container.textContent).toContain('min.tree.error')
    await act(async () => buttonByText('min.tree.retry').click())
    expect(fetchMinutesTree).toHaveBeenCalledTimes(2)
    expect(container.textContent).toContain('물류공정')
  })

  it('트리 뷰에서 팀 탭 선택은 재조회 없이 클라이언트 프루닝한다', async () => {
    await mount('tree')
    await act(async () => buttonByText('PMO').click())
    expect(fetchMinutesTree).toHaveBeenCalledTimes(1)      // 트리 재조회 없음
    expect(container.textContent).not.toContain('물류공정') // MES 그룹 숨김
  })
})
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run tests/ui/minutes-view-tree-toggle.test.tsx`
Expected: FAIL — `min.view.tree` 버튼 없음 등

- [ ] **Step 3: `MinutesView.tsx` 수정**

각 변경을 순서대로 (기존 코드는 `src/components/minutes/MinutesView.tsx` 라인 번호 기준 — 실행 시점에 어긋나 있으면 주변 코드로 위치 파악):

**(3a) import·타입** — 5행 lucide import에 `ListTree` 추가, 6행 타입 import에 `MinutesTreeGroup` 추가, 7행 domain import에 `MINUTES_TREE_LIMIT` 추가, 8행 액션 import에 `fetchMinutesTree` 추가, `MinutesTree` import 추가, 18행 ViewKey 확장:

```ts
import { Bot, CalendarDays, ChevronLeft, ChevronRight, List, ListTree, Paperclip, Plus, Search } from 'lucide-react'
import type { Minute, MinutesTreeGroup, TeamCode } from '@/lib/domain/types'
import { MINUTES_TREE_LIMIT, TEAM_CODES } from '@/lib/domain/minutes'
import { fetchMinutesRange, fetchMinutesSearch, fetchMinutesTree } from '@/app/actions/minutes'
import { MinutesTree } from './MinutesTree'
import { EmptyState } from '@/components/ui/EmptyState'   // 기존 유지
import { CardSkeleton } from '@/components/ui/Skeleton'

type ViewKey = 'list' | 'calendar' | 'tree'
type TreeState = 'idle' | 'loading' | 'error'
  | { groups: MinutesTreeGroup[]; total: number; truncated: boolean }
```

**(3b) state·로드 함수** — `reqRef` 선언(52행) 아래에 추가:

```ts
  const [treeState, setTreeState] = useState<TreeState>('idle')
  // 트리 전용 세대 카운터 — reqRef(월 목록·검색)와 분리. 공유하면 트리 로딩 중 검색·팀 변경이
  // 트리 응답을 폐기해 'loading'에 갇힌다(스펙 'MinutesView 통합' 절).
  const treeReqRef = useRef(0)

  async function loadTree() {
    const gen = ++treeReqRef.current
    setTreeState('loading')
    const res = await fetchMinutesTree()
    if (treeReqRef.current !== gen) return
    setTreeState(res ?? 'error')
  }
```

**(3c) 로드 트리거** — `changeView`(84-87행)를 다음으로 교체하고, prefs 초기 뷰가 'tree'인 마운트를 위한 effect 추가 (`useEffect`를 react import에 추가):

```ts
  function changeView(v: ViewKey) {
    setView(v)
    queueUiPref({ minutesView: v })
    if (v === 'tree' && typeof treeState !== 'object' && treeState !== 'loading') void loadTree()
  }

  // initialView가 'tree'(계정 prefs)로 마운트된 경우의 최초 조회.
  // deps를 [view]로 제한 — treeState를 넣으면 조회 실패('error') 시 effect가 재발화해 무한 재시도가 된다.
  useEffect(() => {
    if (view === 'tree' && treeState === 'idle') void loadTree()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view])
```

**(3d) 업로드 후 재조회** — `onSaved`(227-230행) 내부에 한 줄 추가:

```ts
          onSaved={() => {
            setUploadOpen(false)
            if (isSearch) void runSearch(query, team); else void loadMonth(year, month0, team)
            if (treeState !== 'idle') void loadTree()   // 트리 데이터가 있으면 최신화(idle이면 다음 진입 시 조회)
            router.refresh()
          }}
```

(`changeTeam`은 수정하지 않는다 — 기존 `loadMonth`/`runSearch` 호출을 그대로 유지해 리스트/달력 복귀 시 월 데이터가 stale하지 않게 하고, 트리는 전 팀 데이터를 이미 들고 있으므로 재조회 없이 아래 (3g) 프루닝만 한다.)

**(3e) 뷰 토글 탭** — SegmentedTabs(132-135행) tabs에 세 번째 항목:

```tsx
            <SegmentedTabs<ViewKey>
              tabs={[{ key: 'list', label: t('min.view.list'), icon: List },
                     { key: 'calendar', label: t('min.view.calendar'), icon: CalendarDays },
                     { key: 'tree', label: t('min.view.tree'), icon: ListTree }]}
              value={isSearch ? 'list' : view} onChange={changeView} size="sm" />
```

**(3f) 월 네비 비활성 + 라벨 대체** — 116-122행의 두 버튼 `disabled`와 라벨 span 교체:

```tsx
            <button onClick={() => shift(-1)} disabled={isSearch || view === 'tree'} className="chrome-icon disabled:opacity-40" aria-label="prev month">
              <ChevronLeft className="h-4 w-4" />
            </button>
            <span className="min-w-[84px] text-center text-sm font-semibold tabular-nums">
              {view === 'tree' && !isSearch ? t('min.tree.allPeriod') : ymLabel}
            </span>
            <button onClick={() => shift(1)} disabled={isSearch || view === 'tree'} className="chrome-icon disabled:opacity-40" aria-label="next month">
              <ChevronRight className="h-4 w-4" />
            </button>
```

**(3g) 카운트 요약·프루닝** — `kpiByTeam` useMemo(100-105행) 아래에 추가:

```ts
  // 트리 뷰 카운트: 전 기간·전 팀 트리 데이터 기준. 로딩·에러 중엔 null → '-' 표시(이전 월 숫자 잔존 금지).
  const isTreeDisplay = view === 'tree' && !isSearch
  const summary = useMemo(() => {
    if (!isTreeDisplay) return { total: minutes.length, byTeam: kpiByTeam }
    if (typeof treeState !== 'object') return null
    const c: Record<string, number> = {}
    for (const tk of TEAM_CODES) c[tk] = 0
    for (const g of treeState.groups) c[g.teamCode] = g.count
    return { total: treeState.total, byTeam: c }
  }, [isTreeDisplay, treeState, minutes.length, kpiByTeam])

  // 팀 탭은 재조회 없이 클라이언트 프루닝(트리는 항상 전 팀 조회 — 스펙 '구분 탭' 절)
  const treeGroups = typeof treeState === 'object'
    ? (team === 'ALL' ? treeState.groups : treeState.groups.filter(g => g.teamCode === team))
    : []
```

카운트 요약 렌더(146-154행)를 `summary` 기준으로 교체:

```tsx
        <div className="flex flex-wrap gap-3 text-xs text-ink-muted">
          <span className="font-medium text-ink">{t('min.team.all')} {summary ? summary.total : '-'}</span>
          {TEAM_CODES.map(tk => (
            <span key={tk} className="inline-flex items-center gap-1.5">
              <span className={`inline-block h-2 w-2 rounded-full ${TEAM[tk].bar}`} />
              {tk} {summary ? summary.byTeam[tk] : '-'}
            </span>
          ))}
        </div>
```

**(3h) 트리 뷰 렌더** — 달력 뷰 블록(196-221행) 뒤에 추가:

```tsx
      {/* 트리 뷰 (검색 중에는 강제 리스트) */}
      {view === 'tree' && !isSearch && (
        treeState === 'idle' || treeState === 'loading' ? (
          <CardSkeleton lines={8} />
        ) : treeState === 'error' ? (
          // 조용한 빈 화면 금지 — EmptyState('회의록 없음')로 위장하지 않고 에러를 표시한다
          <EmptyState title={t('min.tree.error')}
            action={<button onClick={() => void loadTree()} className="btn">{t('min.tree.retry')}</button>} />
        ) : treeGroups.length === 0 ? (
          <EmptyState title={t('min.empty.title')} description={t('min.empty.desc')} />
        ) : (
          <div className="space-y-2">
            {treeState.truncated && (
              <p className="text-xs text-ink-subtle">
                {t('min.tree.truncated').replace('{n}', String(MINUTES_TREE_LIMIT))}
              </p>
            )}
            <MinutesTree groups={treeGroups} />
          </div>
        )
      )}
```

**(3i) 기존 뷰 조건 확인** — 리스트 `(view === 'list' || isSearch)`(162행), 달력 `view === 'calendar' && !isSearch`(196행)는 그대로 두면 트리와 상호배타가 성립한다. `react` import에 `useEffect`, `useRef`가 포함됐는지 확인(2행: `import { useEffect, useMemo, useRef, useState } from 'react'`).

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run tests/ui/minutes-view-tree-toggle.test.tsx tests/ui/minutes-tree.test.tsx tests/domain/minutesTree.test.ts`
Expected: PASS (전부)

- [ ] **Step 5: 커밋**

```bash
git add src/components/minutes/MinutesView.tsx tests/ui/minutes-view-tree-toggle.test.tsx
git commit -m "feat(minutes): 트리 뷰 통합 — 토글 3탭, treeReqRef 분리 로드, 전체 기간 라벨, 카운트 전환

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 7: 전체 검증

**Files:** 없음 (검증 전용 — 수정 발생 시 해당 파일만 스테이징)

- [ ] **Step 1: 전체 테스트**

Run: `npm test`
Expected: 전부 PASS (기존 테스트 회귀 없음 — 특히 tests/ui/, tests/domain/ 기존 파일)

- [ ] **Step 2: 린트**

Run: `npm run lint`
Expected: 에러 0

- [ ] **Step 3: 프로덕션 빌드**

Run: `npm run build`
Expected: 빌드 성공. `/minutes` 라우트 포함 확인.

- [ ] **Step 4: 수정이 있었다면 해당 파일만 커밋**

```bash
git add <수정된 파일만 명시>
git commit -m "fix(minutes): 트리 뷰 검증 중 발견된 수정

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

- [ ] **Step 5: 사용자 보고**

배포(`/deploy`)는 이 계획 범위 밖 — 사용자 지시로만 실행. 브랜치 상태(병렬 세션)와 함께 완료 보고.
