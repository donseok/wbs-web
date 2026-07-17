# 주간업무 「양식 통일」 버튼 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 주간업무 시트의 셀 텍스트(마커·번호·빈 줄)를 미리보기 후 일괄 표준화하는 「양식 통일」 버튼 추가.

**Architecture:** 순수 정규화 함수(`lib/domain/weeklyFormat.ts`)를 서버 액션 `previewWeeklyFormat`이 DB 저장 상태 기준으로 실행해 변경분을 반환하고, 클라이언트는 미리보기 모달 확인 후 기존 멀티셀 배치 실행기 `runBatch`(내부적으로 `saveWeeklyCells` + undo 스택 + Realtime)로 적용한다. DB 스키마 변경 없음.

**Tech Stack:** Next.js App Router(server actions), React 클라이언트 컴포넌트, Supabase(기존 경로 재사용), Vitest(+jsdom).

**Spec:** `docs/superpowers/specs/2026-07-17-weekly-format-unify-design.md` (승인 완료 — 규칙 7개·흐름·UX 전부 여기 기준)

## Global Constraints

- `git add`는 **파일명 명시**(절대 `git add -A` 금지) — 이 저장소는 병렬 세션이 돌고 있어 무관한 dirty 파일이 섞인다.
- 운영 D-CUBE 데이터에 **쓰기 검증 금지** — 검증은 vitest·build·dev 부팅으로만. (로컬 dev도 프로덕션 DB 공유)
- 표준 마커 리터럴 정확히: 하위 = 공백 2칸 + `-.` + 공백 1칸 (`"  -. "`), 상위 = `N. `(마침표+공백), 3단계 = 공백 4칸 + `. `.
- 내용 불변 원칙: 마커·들여쓰기·빈 줄 외에는 한 글자도 바꾸지 않는다(문장 내부 공백·오탈자 보존).
- 기존 디자인 토큰·공용 프리미티브(`btn btn-ghost`, `card`, `Modal`, `useToast`)만 사용, 새 스타일 시스템 금지.
- 전체 테스트 스위트에 **기존 실패 3건**(`tests/ui/minute-chat-scope.test.tsx` — 이번 작업과 무관, main에서 이미 실패)이 있다. 신규 실패만 회귀로 간주한다.
- 커밋 트레일러: `Co-Authored-By:`는 실제 작업 모델명(하네스 기본 트레일러)을 그대로 쓴다.

---

### Task 1: `normalizeCellText` — 셀 텍스트 정규화 순수 함수 (TDD)

**Files:**
- Create: `src/lib/domain/weeklyFormat.ts`
- Test: `tests/domain/weeklyFormat.test.ts`

**Interfaces:**
- Consumes: `WEEKLY_CELL_KEYS`, `CELL_FIELD`, `WeeklyCellKey`, `WeeklySheetRow` — `src/lib/domain/weeklySheet.ts`에 이미 존재.
- Produces: `normalizeCellText(text: string): string` — Task 2·3이 사용.

- [ ] **Step 1: 실패하는 테스트 작성**

`tests/domain/weeklyFormat.test.ts` 생성 (전체 내용):

```ts
import { describe, it, expect } from 'vitest'
import { normalizeCellText } from '@/lib/domain/weeklyFormat'

describe('normalizeCellText — 마커·번호·빈 줄 표준화(내용 불변)', () => {
  it('붙임 대시를 표준 하위 마커로', () => {
    expect(normalizeCellText('-CBO Program, Function, Table')).toBe('  -. CBO Program, Function, Table')
  })

  it('-. 들여쓰기 변형(0~5칸)을 2칸으로 고정', () => {
    for (const pad of ['', ' ', '   ', '     ']) {
      expect(normalizeCellText(`${pad}-. 대상 : 냉연생산`)).toBe('  -. 대상 : 냉연생산')
    }
  })

  it('상위 번호를 등장 순서대로 재부여하고 항목 사이 빈 줄 1개', () => {
    expect(normalizeCellText('1. A\n- a\n1. B\n- b')).toBe('1. A\n  -. a\n\n2. B\n  -. b')
  })

  it('1) (1) ① 마커를 N. 으로 통일', () => {
    expect(normalizeCellText('1) A\n(2) B\n③ C')).toBe('1. A\n\n2. B\n\n3. C')
  })

  it('붙여 쓴 1.내용 도 띄운다', () => {
    expect(normalizeCellText('1.내용')).toBe('1. 내용')
  })

  it('공백만 있는 줄·연속 빈 줄·앞뒤 빈 줄 정리(상위 항목 재배치와 결합)', () => {
    expect(normalizeCellText('\n1. A\n \n\n2. B\n  \n')).toBe('1. A\n\n2. B')
  })

  it('문장 내부는 한 글자도 바꾸지 않는다', () => {
    expect(normalizeCellText('-. 대상 : 냉연생산, 도금생산 ( F-MES)')).toBe('  -. 대상 : 냉연생산, 도금생산 ( F-MES)')
  })

  it('마커 없는 일반 줄은 그대로(줄 끝 공백만 제거)', () => {
    expect(normalizeCellText('검토 계속 진행 ')).toBe('검토 계속 진행')
  })

  it('빈 셀은 빈 셀', () => {
    expect(normalizeCellText('')).toBe('')
  })

  it('숫자로 시작하는 값(12.5%, -15%)을 마커로 오인하지 않는다', () => {
    expect(normalizeCellText('12.5% 달성')).toBe('12.5% 달성')
    expect(normalizeCellText('-15% 하락')).toBe('-15% 하락')
  })

  it('상위 항목이 없는 셀은 재배치 없이 연속 빈 줄만 축약', () => {
    expect(normalizeCellText('메모 A\n\n\n메모 B')).toBe('메모 A\n\n메모 B')
  })

  it('". " 3단계는 4칸 들여쓰기, 공백 없는 ".내용"은 일반 줄', () => {
    expect(normalizeCellText('. 세부')).toBe('    . 세부')
    expect(normalizeCellText('.내용')).toBe('.내용')
  })

  it('멱등성 — 실데이터 종합 픽스처: f(f(x)) === f(x)', () => {
    const messy = [
      '1. 현업 인터뷰 참석 ( 조업 )',
      '- 현 시스템 불편 및 개선 요청 사항 청취',
      ' ',
      '2. Program CheckList 점검 작업',
      '- CBO Program, Function, Table',
      '1. 현업 인터뷰 참석',
      '   -. 대상 : 냉연생산, 도금생산',
    ].join('\n')
    const once = normalizeCellText(messy)
    expect(normalizeCellText(once)).toBe(once)
    expect(once).toBe([
      '1. 현업 인터뷰 참석 ( 조업 )',
      '  -. 현 시스템 불편 및 개선 요청 사항 청취',
      '',
      '2. Program CheckList 점검 작업',
      '  -. CBO Program, Function, Table',
      '',
      '3. 현업 인터뷰 참석',
      '  -. 대상 : 냉연생산, 도금생산',
    ].join('\n'))
  })
})
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run tests/domain/weeklyFormat.test.ts`
Expected: FAIL — `Cannot find module '@/lib/domain/weeklyFormat'` (모듈 미존재)

- [ ] **Step 3: 최소 구현**

`src/lib/domain/weeklyFormat.ts` 생성 (전체 내용 — `unifySheetRows`는 Task 2에서 추가):

```ts
/* ── 주간 시트 양식 통일(순수) — 마커·번호·빈 줄만 표준화, 내용 불변. I/O 없음.
 *    스펙: docs/superpowers/specs/2026-07-17-weekly-format-unify-design.md ── */

// 상위(1단계): '1.' '1)' '(1)' '①~⑳'. 숫자 1~3자리 제한 + 마커 뒤 숫자 금지 —
// 연도('2026.')와 소수('12.5%')로 시작하는 일반 줄을 항목으로 오인하지 않게.
const TOP_RE = /^\s*(?:\((\d{1,3})\)|(\d{1,3})[.)](?!\d)|([①-⑳]))\s*(.*)$/
// 하위(2단계): '-' '-.' '·' '•' '▪' '*' '→' '▶'. 대시 뒤 숫자 금지 — '-15%' 같은 음수 보호.
const SUB_RE = /^\s*(?:-\.?(?!\d)|[·•▪*→▶])\s*(.*)$/
// 3단계: '.' + 공백 필수 — '.내용'(공백 없음)은 마커로 보지 않고 일반 줄로 보존.
const THIRD_RE = /^\s*\.\s+(.*)$/

type LineKind = 'top' | 'sub' | 'third' | 'plain' | 'blank'

function classify(line: string): { kind: LineKind; text: string } {
  if (line.trim() === '') return { kind: 'blank', text: '' }
  const top = line.match(TOP_RE)
  if (top) return { kind: 'top', text: top[4] }
  const sub = line.match(SUB_RE)
  if (sub) return { kind: 'sub', text: sub[1] }
  const third = line.match(THIRD_RE)
  if (third) return { kind: 'third', text: third[1] }
  return { kind: 'plain', text: line }
}

/** 셀 텍스트 정규화 — 스펙 규칙 1~7. 멱등(f(f(x)) === f(x)). */
export function normalizeCellText(text: string): string {
  const lines = text.split('\n').map(l => classify(l.replace(/\s+$/, '')))
  const hasTop = lines.some(l => l.kind === 'top')
  const out: string[] = []
  let n = 0
  for (const l of lines) {
    if (l.kind === 'blank') {
      // 상위 항목이 있으면 빈 줄은 전부 걷어내고 상위 항목 앞에서만 재삽입(아래).
      // 상위 항목이 없는 셀은 재배치 없이 공백 규칙만 — 연속 빈 줄을 1개로.
      if (!hasTop && out.length && out[out.length - 1] !== '') out.push('')
      continue
    }
    if (l.kind === 'top') {
      n += 1
      if (out.length) out.push('')
      out.push(l.text ? `${n}. ${l.text}` : `${n}.`)
    } else if (l.kind === 'sub') {
      out.push(l.text ? `  -. ${l.text}` : '  -.')
    } else if (l.kind === 'third') {
      out.push(l.text ? `    . ${l.text}` : '    .')
    } else {
      out.push(l.text)
    }
  }
  while (out.length && out[out.length - 1] === '') out.pop()
  return out.join('\n')
}
```

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run tests/domain/weeklyFormat.test.ts`
Expected: PASS (13 tests)

- [ ] **Step 5: 커밋**

```bash
git add src/lib/domain/weeklyFormat.ts tests/domain/weeklyFormat.test.ts
git commit -m "feat(weekly): 셀 텍스트 정규화 순수 함수 normalizeCellText

양식 통일 버튼의 핵심 규칙 — 마커(2칸+-.), 번호 재부여, 빈 줄 정책만
표준화하고 내용은 불변. 소수·음수 시작 줄 오인 방지 가드 포함. 멱등."
```

---

### Task 2: `unifySheetRows` + 열 라벨 단일 출처화

**Files:**
- Modify: `src/lib/domain/weeklyFormat.ts` (Task 1에서 생성)
- Modify: `src/lib/domain/weeklySheet.ts` (`CELL_FIELD` 정의 바로 아래에 라벨 맵 추가)
- Modify: `src/components/weekly/WeeklySheetView.tsx:32-37` (`COLS`를 라벨 맵 기반으로)
- Test: `tests/domain/weeklyFormat.test.ts` (케이스 추가)

**Interfaces:**
- Consumes: Task 1의 `normalizeCellText`.
- Produces:
  - `interface WeeklyFormatEdit { rowId: string; cellKey: WeeklyCellKey; section: string; before: string; after: string }` (weeklyFormat.ts)
  - `unifySheetRows(rows: WeeklySheetRow[]): WeeklyFormatEdit[]` (weeklyFormat.ts)
  - `WEEKLY_CELL_LABEL: Record<WeeklyCellKey, string>` (weeklySheet.ts) — Task 4의 모달이 사용.

- [ ] **Step 1: 실패하는 테스트 추가**

`tests/domain/weeklyFormat.test.ts` 상단 import를 다음으로 교체하고:

```ts
import { describe, it, expect } from 'vitest'
import { normalizeCellText, unifySheetRows } from '@/lib/domain/weeklyFormat'
import type { WeeklySheetRow } from '@/lib/domain/weeklySheet'
```

파일 끝에 describe 블록 추가:

```ts
describe('unifySheetRows — 바뀌는 셀만 edits로', () => {
  const row = (over: Partial<WeeklySheetRow>): WeeklySheetRow => ({
    id: 'a', reportId: 'r', section: 'PMO', module: '', sortOrder: 1,
    thisContent: '', thisIssue: '', nextContent: '', nextIssue: '', ...over,
  })

  it('변경 있는 셀만 before/after 쌍으로 반환하고, 이미 정상·빈 셀은 제외', () => {
    const rows = [
      row({ id: 'a', thisContent: '-메모', nextContent: '1. 계획' }), // nextContent는 이미 정상
      row({ id: 'b', section: '', module: 'SD/LE', thisIssue: '- 이슈' }), // 라벨은 모듈로 폴백
    ]
    expect(unifySheetRows(rows)).toEqual([
      { rowId: 'a', cellKey: 'this_content', section: 'PMO', before: '-메모', after: '  -. 메모' },
      { rowId: 'b', cellKey: 'this_issue', section: 'SD/LE', before: '- 이슈', after: '  -. 이슈' },
    ])
  })

  it('변경이 하나도 없으면 빈 배열', () => {
    expect(unifySheetRows([row({ thisContent: '1. 정상\n  -. 하위' })])).toEqual([])
  })
})
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run tests/domain/weeklyFormat.test.ts`
Expected: FAIL — `unifySheetRows is not a function` (미구현)

- [ ] **Step 3: 구현**

`src/lib/domain/weeklyFormat.ts` 맨 위에 import 추가:

```ts
import { WEEKLY_CELL_KEYS, CELL_FIELD, type WeeklyCellKey, type WeeklySheetRow } from './weeklySheet'
```

파일 끝에 추가:

```ts
/** 미리보기·적용이 공유하는 변경 단위 — 적용은 after만 저장, before는 미리보기 표시용. */
export interface WeeklyFormatEdit {
  rowId: string
  cellKey: WeeklyCellKey
  section: string // 미리보기 행 라벨 — 구분, 없으면 모듈, 둘 다 없으면 '기타'(sheetNarrative.rowLabel과 동일 폴백)
  before: string
  after: string
}

/** 4개 내용 열 전부 정규화해 실제로 바뀌는 셀만 반환(변경 없으면 빈 배열). */
export function unifySheetRows(rows: WeeklySheetRow[]): WeeklyFormatEdit[] {
  const out: WeeklyFormatEdit[] = []
  for (const r of rows) {
    const label = r.section.trim() || r.module.trim() || '기타'
    for (const cellKey of WEEKLY_CELL_KEYS) {
      const before = r[CELL_FIELD[cellKey]]
      const after = normalizeCellText(before)
      if (after !== before) out.push({ rowId: r.id, cellKey, section: label, before, after })
    }
  }
  return out
}
```

`src/lib/domain/weeklySheet.ts`의 `CELL_FIELD` 정의(`} as const satisfies Record<WeeklyCellKey, keyof WeeklySheetRow>` 줄) 바로 아래에 추가:

```ts
/** 열 표시 라벨 — 그리드 헤더(COLS)와 양식 통일 미리보기가 공유하는 단일 출처. */
export const WEEKLY_CELL_LABEL = {
  this_content: '금주실적 내용', this_issue: '금주 이슈·이벤트',
  next_content: '차주계획 내용', next_issue: '차주 이슈·이벤트',
} as const satisfies Record<WeeklyCellKey, string>
```

`src/components/weekly/WeeklySheetView.tsx`의 기존 `COLS` 정의를:

```ts
const COLS: { key: WeeklyCellKey; label: string }[] = [
  { key: 'this_content', label: '금주실적 내용' },
  { key: 'this_issue', label: '금주 이슈·이벤트' },
  { key: 'next_content', label: '차주계획 내용' },
  { key: 'next_issue', label: '차주 이슈·이벤트' },
]
```

다음으로 교체:

```ts
const COLS: { key: WeeklyCellKey; label: string }[] =
  WEEKLY_CELL_KEYS.map(key => ({ key, label: WEEKLY_CELL_LABEL[key] }))
```

그리고 같은 파일의 `@/lib/domain/weeklySheet` import에 `WEEKLY_CELL_LABEL`을 추가한다 (기존 import 줄에 `WEEKLY_CELL_KEYS`가 이미 있는지 확인 — `applyServerRow, WEEKLY_CELL_KEYS, WEEKLY_CELL_MAX, CELL_FIELD` 뒤에 `WEEKLY_CELL_LABEL` 추가).

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run tests/domain`
Expected: weeklyFormat PASS (15 tests) + 기존 domain 테스트 전부 통과(COLS 교체 회귀는 Task 5 build·전체 스위트에서 재확인 — 그리드 헤더 라벨은 값이 동일해 불변).

- [ ] **Step 5: 커밋**

```bash
git add src/lib/domain/weeklyFormat.ts src/lib/domain/weeklySheet.ts src/components/weekly/WeeklySheetView.tsx tests/domain/weeklyFormat.test.ts
git commit -m "feat(weekly): unifySheetRows + 열 라벨 단일 출처(WEEKLY_CELL_LABEL)

4개 내용 열을 정규화해 바뀌는 셀만 before/after edits로. 그리드 COLS와
양식 통일 미리보기가 같은 라벨 맵을 쓰게 도메인으로 승격."
```

---

### Task 3: `loadWeeklyRows` export + `previewWeeklyFormat` 서버 액션 (TDD)

**Files:**
- Modify: `src/lib/data/weeklySheet.ts:21` (`loadRows` → export `loadWeeklyRows`, 내부 호출부 2곳 갱신: 73행 `getWeeklySheet`, 90행 `findCarryOverSource`)
- Modify: `src/app/actions/weekly.ts` (파일 끝에 액션 추가 + import 2줄)
- Test: `tests/actions/weekly-format-preview.test.ts`

**Interfaces:**
- Consumes: Task 2의 `unifySheetRows`, `WeeklyFormatEdit`.
- Produces:
  - `loadWeeklyRows(reportId: string): Promise<WeeklySheetRow[]>` (data 계층 export)
  - `previewWeeklyFormat(projectId: string, reportId: string): Promise<WeeklyFormatPreviewResult>` — Task 4가 호출
  - `interface WeeklyFormatPreviewResult { ok: boolean; error?: string; edits?: WeeklyFormatEdit[] }`

- [ ] **Step 1: 실패하는 테스트 작성**

`tests/actions/weekly-format-preview.test.ts` 생성 (전체 내용). `src/app/actions/weekly.ts`는 `next/cache`·`next/headers`(supabase server 경유)를 임포트하므로 vitest에서는 전부 모킹해야 한다:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const getSession = vi.fn(async (): Promise<unknown> => ({ user: { id: 'u1' } }))
vi.mock('@/lib/auth', () => ({ getSession: (...a: unknown[]) => getSession(...(a as [])) }))
const loadWeeklyRows = vi.fn(async (): Promise<unknown[]> => [])
vi.mock('@/lib/data/weeklySheet', () => ({
  loadWeeklyRows: (...a: unknown[]) => loadWeeklyRows(...(a as [])),
  // actions/weekly.ts가 같은 모듈에서 함께 임포트하는 이름들 — 모킹 필수
  getWeeklySheet: vi.fn(),
  findCarryOverSource: vi.fn(),
}))
vi.mock('@/lib/supabase/server', () => ({ createServerClient: vi.fn() }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

import { previewWeeklyFormat } from '@/app/actions/weekly'

describe('previewWeeklyFormat — DB 저장 상태 기준 양식 검사', () => {
  beforeEach(() => {
    getSession.mockClear()
    getSession.mockResolvedValue({ user: { id: 'u1' } })
    loadWeeklyRows.mockClear()
    loadWeeklyRows.mockResolvedValue([])
  })

  it('미로그인 거부', async () => {
    getSession.mockResolvedValueOnce(null)
    expect(await previewWeeklyFormat('p1', 'r1')).toEqual({ ok: false, error: '로그인 필요' })
    expect(loadWeeklyRows).not.toHaveBeenCalled()
  })

  it('빈 시트 → 빈 edits', async () => {
    expect(await previewWeeklyFormat('p1', 'r1')).toEqual({ ok: true, edits: [] })
    expect(loadWeeklyRows).toHaveBeenCalledWith('r1')
  })

  it('변경 있는 행 → edits 반환', async () => {
    loadWeeklyRows.mockResolvedValueOnce([{
      id: 'a', reportId: 'r1', section: 'PMO', module: '', sortOrder: 1,
      thisContent: '-메모', thisIssue: '', nextContent: '', nextIssue: '',
    }])
    expect(await previewWeeklyFormat('p1', 'r1')).toEqual({
      ok: true,
      edits: [{ rowId: 'a', cellKey: 'this_content', section: 'PMO', before: '-메모', after: '  -. 메모' }],
    })
  })

  it('조회 실패 → ok:false + 사람이 읽는 에러(에러 삼킴 금지)', async () => {
    loadWeeklyRows.mockRejectedValueOnce(new Error('boom'))
    const res = await previewWeeklyFormat('p1', 'r1')
    expect(res.ok).toBe(false)
    expect(res.error).toContain('양식 검사')
  })
})
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run tests/actions/weekly-format-preview.test.ts`
Expected: FAIL — `previewWeeklyFormat`이 `@/app/actions/weekly`에 없음 (또는 `loadWeeklyRows` export 없음)

- [ ] **Step 3: 구현**

`src/lib/data/weeklySheet.ts` 21행의 비공개 함수를 export로 전환하고 이름을 바꾼다:

```ts
/** reportId의 시트 행 전부(sort_order 순). 양식 통일 미리보기 등 저장 상태 기준 검사가 공유. */
export async function loadWeeklyRows(reportId: string): Promise<WeeklySheetRow[]> {
```

(함수 본문은 그대로.) 내부 호출부 2곳을 갱신:
- 73행: `await loadRows(report.id)` → `await loadWeeklyRows(report.id)`
- 90행: `await loadRows(report.id)` → `await loadWeeklyRows(report.id)`

`src/app/actions/weekly.ts` import 갱신 — 기존:

```ts
import { findCarryOverSource, getWeeklySheet } from '@/lib/data/weeklySheet'
```

를 다음으로 교체하고, 도메인 import 한 줄을 추가:

```ts
import { findCarryOverSource, getWeeklySheet, loadWeeklyRows } from '@/lib/data/weeklySheet'
import { unifySheetRows, type WeeklyFormatEdit } from '@/lib/domain/weeklyFormat'
```

파일 끝에 추가:

```ts
export interface WeeklyFormatPreviewResult {
  ok: boolean
  error?: string
  edits?: WeeklyFormatEdit[] // ok:true일 때 항상 존재(변경 없으면 빈 배열)
}

/** 양식 통일 미리보기 — DB의 저장 상태(권위) 기준으로 정규화 변경분만 계산한다.
 *  적용 액션은 따로 없다: 클라이언트가 확인한 after를 기존 saveWeeklyCells 배치로 저장(WYSIWYG). */
export async function previewWeeklyFormat(
  projectId: string, // 시그니처 대칭·향후 로깅용(saveWeeklyCells 관례). 조회는 reportId 기준(RLS가 접근 통제)
  reportId: string,
): Promise<WeeklyFormatPreviewResult> {
  if (!(await getSession())) return { ok: false, error: '로그인 필요' }
  try {
    const rows = await loadWeeklyRows(reportId)
    return { ok: true, edits: unifySheetRows(rows) }
  } catch (e) {
    console.error('[previewWeeklyFormat] 양식 검사 실패:', errMsg(e))
    return { ok: false, error: '양식 검사에 실패했습니다. 잠시 후 다시 시도해 주세요.' }
  }
}
```

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run tests/actions/weekly-format-preview.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: 커밋**

```bash
git add src/lib/data/weeklySheet.ts src/app/actions/weekly.ts tests/actions/weekly-format-preview.test.ts
git commit -m "feat(weekly): previewWeeklyFormat 서버 액션 — DB 상태 기준 양식 검사

loadRows를 loadWeeklyRows로 export 승격. 적용 액션은 만들지 않고
클라이언트가 확인한 after를 기존 saveWeeklyCells로 저장(WYSIWYG 보장)."
```

---

### Task 4: `FormatUnifyModal` + WeekNav 버튼 + WeeklySheetView 배선 (TDD, jsdom)

**Files:**
- Create: `src/components/weekly/FormatUnifyModal.tsx`
- Modify: `src/components/weekly/WeeklySheetView.tsx` (import·상태·핸들러 2개·WeekNav props·모달 렌더)
- Test: `tests/ui/weekly-format-unify.test.tsx`

**Interfaces:**
- Consumes: Task 2 `WeeklyFormatEdit`·`WEEKLY_CELL_LABEL`, Task 3 `previewWeeklyFormat`, 기존 `runBatch`(WeeklySheetView 내부, `(edits: WeeklyCellEdit[], opts: { undoable: boolean }) => void`)·`flushPendingSaves(): Promise<boolean>`·`Modal`·`useToast`.
- Produces: `FormatUnifyModal({ open, edits, onClose, onApply })` — 사용처는 WeeklySheetView뿐.

- [ ] **Step 1: 실패하는 테스트 작성**

`tests/ui/weekly-format-unify.test.tsx` 생성 (전체 내용 — 하네스는 `tests/ui/wbs-leaf-actual.test.tsx` 패턴):

```tsx
// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { ReactNode, AnchorHTMLAttributes } from 'react'
import type { WeeklySheetRow } from '@/lib/domain/weeklySheet'

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

const saveWeeklyCells = vi.fn(async (): Promise<unknown> => ({ ok: true }))
const previewWeeklyFormat = vi.fn(async (): Promise<unknown> => ({ ok: true, edits: [] }))
vi.mock('@/app/actions/weekly', () => ({
  createWeeklyReport: vi.fn(async () => ({ ok: true })),
  saveWeeklyCell: vi.fn(async () => ({ ok: true })),
  saveWeeklyCells: (...a: unknown[]) => saveWeeklyCells(...(a as [])),
  saveWeeklyTitle: vi.fn(async () => ({ ok: true })),
  previewWeeklyFormat: (...a: unknown[]) => previewWeeklyFormat(...(a as [])),
}))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }))
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode } & AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a href={String(href)} {...rest}>{children}</a>
  ),
}))
// Modal이 useLocale을 쓴다 — 실제 LocaleProvider 대신 기존 UI 테스트 관례대로 모킹
vi.mock('@/components/providers/LocaleProvider', () => ({
  useLocale: () => ({ locale: 'ko', t: (k: string) => k }),
}))
vi.mock('@/lib/supabase/client', () => {
  const chan = {
    on: () => chan, subscribe: () => chan, presenceState: () => ({}),
    track: async () => {}, unsubscribe: async () => {},
  }
  return { createBrowserClient: () => ({ channel: () => chan, removeChannel: vi.fn() }) }
})

import { WeeklySheetView } from '@/components/weekly/WeeklySheetView'
import { ToastProvider } from '@/components/ui/Toast'

const MESSY = '1. Program Check List 점검 작업\n-CBO Program, Function, Table'
const CLEAN = '1. Program Check List 점검 작업\n  -. CBO Program, Function, Table'
const EDIT = { rowId: 'row1', cellKey: 'this_content', section: 'PMO', before: MESSY, after: CLEAN }

function row(over: Partial<WeeklySheetRow>): WeeklySheetRow {
  return {
    id: 'row1', reportId: 'r1', section: 'PMO', module: '', sortOrder: 0,
    thisContent: MESSY, thisIssue: '', nextContent: '', nextIssue: '', ...over,
  }
}

const baseProps = {
  projectId: 'p1', weekStart: '2026-07-13', weekLabel: '7월 3주차', weekTitle: '7월 3주차',
  thisRange: '7/13~7/17', nextRange: '7/20~7/24', projectName: 'D-CUBE',
  hasCarrySource: false, me: { id: 'u1', name: '제리' },
}

describe('주간업무 — 양식 통일 버튼', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    saveWeeklyCells.mockClear()
    previewWeeklyFormat.mockClear()
    previewWeeklyFormat.mockResolvedValue({ ok: true, edits: [] })
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })
  afterEach(() => {
    act(() => root.unmount())
    container.remove()
  })

  const mount = async (report: { id: string; title: string } | null, rows: WeeklySheetRow[]) =>
    act(async () =>
      root.render(
        <ToastProvider>
          <WeeklySheetView {...baseProps} report={report} initialRows={rows} />
        </ToastProvider>,
      ),
    )
  // 모달은 portal로 body에 렌더되므로 버튼 탐색은 document 전역으로
  const btn = (re: RegExp) =>
    [...document.querySelectorAll<HTMLButtonElement>('button')].find(b => re.test(b.textContent ?? ''))

  it('미리보기 → 적용: 모달에 전/후를 보여주고 after 값으로 saveWeeklyCells 호출', async () => {
    previewWeeklyFormat.mockResolvedValueOnce({ ok: true, edits: [EDIT] })
    await mount({ id: 'r1', title: '' }, [row({})])
    await act(async () => { btn(/양식 통일/)!.click() })
    expect(previewWeeklyFormat).toHaveBeenCalledWith('p1', 'r1')
    expect(document.body.textContent).toContain('양식 통일 미리보기')
    expect(document.body.textContent).toContain('PMO · 금주실적 내용')
    expect(document.body.textContent).toContain('-CBO Program')      // 전
    expect(document.body.textContent).toContain('-. CBO Program')    // 후
    await act(async () => { btn(/1개 셀 적용/)!.click() })
    expect(saveWeeklyCells).toHaveBeenCalledWith('p1', [
      { rowId: 'row1', cellKey: 'this_content', content: CLEAN },
    ])
    expect(document.body.textContent).not.toContain('양식 통일 미리보기') // 모달 닫힘
  })

  it('변경 0건이면 모달 없이 안내 토스트', async () => {
    await mount({ id: 'r1', title: '' }, [row({ thisContent: '1. 정상' })])
    await act(async () => { btn(/양식 통일/)!.click() })
    expect(document.body.textContent).toContain('이미 통일된 양식입니다')
    expect(document.body.textContent).not.toContain('양식 통일 미리보기')
    expect(saveWeeklyCells).not.toHaveBeenCalled()
  })

  it('미리보기 실패면 에러 토스트', async () => {
    previewWeeklyFormat.mockResolvedValueOnce({ ok: false, error: '서버 오류' })
    await mount({ id: 'r1', title: '' }, [row({})])
    await act(async () => { btn(/양식 통일/)!.click() })
    expect(document.body.textContent).toContain('양식 검사 실패')
  })

  it('시트가 없는 주(EmptyState)에는 양식 통일 비활성', async () => {
    await mount(null, [])
    expect(btn(/양식 통일/)!.disabled).toBe(true)
  })
})
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run tests/ui/weekly-format-unify.test.tsx`
Expected: FAIL — `양식 통일` 버튼 없음 (`btn(/양식 통일/)` undefined)

- [ ] **Step 3: `FormatUnifyModal` 구현**

`src/components/weekly/FormatUnifyModal.tsx` 생성 (전체 내용):

```tsx
'use client'

import { Modal } from '@/components/ui/Modal'
import { WEEKLY_CELL_LABEL } from '@/lib/domain/weeklySheet'
import type { WeeklyFormatEdit } from '@/lib/domain/weeklyFormat'

/** 양식 통일 미리보기 — 바뀌는 셀만 전/후 대조로 보여준다. 적용(저장·undo)은 부모의 runBatch가 수행. */
export function FormatUnifyModal({ open, edits, onClose, onApply }: {
  open: boolean
  edits: WeeklyFormatEdit[]
  onClose: () => void
  onApply: () => void
}) {
  const footer = (
    <>
      <button type="button" onClick={onClose} className="btn btn-ghost">취소</button>
      <button type="button" onClick={onApply} className="btn btn-primary">{edits.length}개 셀 적용</button>
    </>
  )
  return (
    <Modal open={open} onClose={onClose} eyebrow="Format unify" title="양식 통일 미리보기" size="lg" footer={footer}>
      <p className="mb-4 text-sm text-ink-muted">
        마커·번호·빈 줄만 표준 양식으로 정리하며 내용은 바꾸지 않습니다. 적용 후 Ctrl+Z로 되돌릴 수 있습니다.
      </p>
      <div className="space-y-4">
        {edits.map(e => (
          <div key={`${e.rowId}:${e.cellKey}`} className="card p-3">
            <div className="mb-2 text-xs font-semibold text-ink">{e.section} · {WEEKLY_CELL_LABEL[e.cellKey]}</div>
            {/* 셀 원문 대조 — 시트와 같은 이유('문서')로 다크모드에서도 밝은 고정 색상 */}
            <div className="grid grid-cols-2 gap-2 text-[12px] leading-5">
              <div>
                <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-ink-subtle">전</div>
                <pre className="whitespace-pre-wrap rounded border border-neutral-300 bg-white p-2 font-mono text-neutral-500">{e.before}</pre>
              </div>
              <div>
                <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-ink-subtle">후</div>
                <pre className="whitespace-pre-wrap rounded border border-neutral-300 bg-white p-2 font-mono text-black">{e.after}</pre>
              </div>
            </div>
          </div>
        ))}
      </div>
    </Modal>
  )
}
```

- [ ] **Step 4: WeeklySheetView 배선**

`src/components/weekly/WeeklySheetView.tsx`에 다음 변경:

(a) import 추가 — `@/app/actions/weekly` import에 `previewWeeklyFormat` 추가, 아래 두 줄 신설:

```ts
import { FormatUnifyModal } from './FormatUnifyModal'
import type { WeeklyFormatEdit } from '@/lib/domain/weeklyFormat'
```

(b) 상태 추가 — `const [batchActive, setBatchActive] = useState(false)` 줄 아래:

```ts
const [unifyEdits, setUnifyEdits] = useState<WeeklyFormatEdit[] | null>(null) // 양식 통일 미리보기(null=닫힘)
const [unifyBusy, setUnifyBusy] = useState(false)
```

(c) 핸들러 2개 — `runBatch` useCallback 정의가 끝난 지점 바로 아래(EmptyState 조기 return보다 앞):

```ts
// 양식 통일: flush(미저장 셀 커밋, PPT 내보내기와 동일 가드) → 서버 미리보기 → 모달.
// 변경 0건이면 토스트로 종료. 적용은 runBatch(undoable)라 Ctrl+Z 한 번에 전체 되돌리기.
const openUnify = async () => {
  if (!report) return
  setUnifyBusy(true)
  try {
    if (!(await flushPendingSaves())) return
    const res = await previewWeeklyFormat(projectId, report.id)
    if (!res.ok || !res.edits) {
      toast({ title: '양식 검사 실패', description: res.error ?? '잠시 후 다시 시도해 주세요.', variant: 'error' })
      return
    }
    if (res.edits.length === 0) {
      toast({ title: '이미 통일된 양식입니다', variant: 'info' })
      return
    }
    setUnifyEdits(res.edits)
  } finally {
    setUnifyBusy(false)
  }
}

const applyUnify = () => {
  if (!unifyEdits) return
  const count = unifyEdits.length
  runBatch(unifyEdits.map(e => ({ rowId: e.rowId, cellKey: e.cellKey, content: e.after })), { undoable: true })
  setUnifyEdits(null)
  toast({ title: '양식 통일 적용', variant: 'success',
    description: `${count}개 셀을 정리했습니다. Ctrl+Z로 되돌릴 수 있습니다.` })
}
```

(d) WeekNav 시그니처·버튼 — `WeekNav` 함수를 다음으로 교체 (양식 통일 버튼이 내보내기 그룹 맨 왼쪽):

```tsx
function WeekNav({ projectId, weekStart, weekLabel, exportDisabled, onBeforeExport, presence, onUnify, unifyBusy }: {
  projectId: string; weekStart: string; weekLabel: string; exportDisabled: boolean
  onBeforeExport: () => Promise<boolean>
  presence?: React.ReactNode // 온라인 사용자 스트립(프레즌스) — 내보내기 버튼 왼쪽
  onUnify?: () => void      // 미지정(시트 없는 주)이면 양식 통일 비활성
  unifyBusy?: boolean
}) {
  const base = `/p/${projectId}/weekly`
  return (
    // 근태현황·회의일정과 동일한 스크롤 상단 고정. z-40: 시트 셀 오버레이(배지/핸들 z-30)보다 위.
    <div className="sticky top-0 z-40 -mx-1 flex items-center justify-between bg-canvas/95 px-1 pb-3 pt-1 backdrop-blur-sm">
      <div className="flex items-center gap-2">
        <Link href={`${base}?week=${shiftWeeks(weekStart, -1)}`} className="btn btn-ghost px-2" aria-label="이전 주">
          <ChevronLeft className="h-4 w-4" />
        </Link>
        <span className="min-w-40 text-center text-sm font-semibold text-ink">{weekLabel}</span>
        <Link href={`${base}?week=${shiftWeeks(weekStart, 1)}`} className="btn btn-ghost px-2" aria-label="다음 주">
          <ChevronRight className="h-4 w-4" />
        </Link>
      </div>
      <div className="flex items-center gap-3">
        {presence}
        <div className="flex items-center gap-2">
          <button className="btn btn-ghost" disabled={!onUnify || unifyBusy} onClick={onUnify}
            title="셀 텍스트의 마커·번호·빈 줄을 표준 양식으로 정리합니다">
            <Wand2 className="mr-1 h-4 w-4" />양식 통일
          </button>
          <ExportSummaryPptButton projectId={projectId} />
          <ExportPptButton projectId={projectId} weekStart={weekStart} disabled={exportDisabled} onBeforeExport={onBeforeExport} />
        </div>
      </div>
    </div>
  )
}
```

lucide import 줄에 `Wand2` 추가:

```ts
import { ChevronLeft, ChevronRight, Download, FileSpreadsheet, Wand2 } from 'lucide-react'
```

(e) WeekNav 호출부 2곳 갱신 — 본문 렌더(시트 있음)는:

```tsx
<WeekNav projectId={projectId} weekStart={weekStart} weekLabel={weekLabel} exportDisabled={false}
  onBeforeExport={flushPendingSaves} presence={presenceStrip} onUnify={openUnify} unifyBusy={unifyBusy} />
```

EmptyState 쪽 WeekNav는 그대로 둔다(`onUnify` 미전달 → 버튼 비활성).

(f) 모달 렌더 — 본문 return의 최상위 `<div className="space-y-3">` 안, `<WeekNav …/>` 바로 아래:

```tsx
<FormatUnifyModal open={unifyEdits !== null} edits={unifyEdits ?? []}
  onClose={() => setUnifyEdits(null)} onApply={applyUnify} />
```

- [ ] **Step 5: 통과 확인**

Run: `npx vitest run tests/ui/weekly-format-unify.test.tsx`
Expected: PASS (4 tests)

- [ ] **Step 6: 커밋**

```bash
git add src/components/weekly/FormatUnifyModal.tsx src/components/weekly/WeeklySheetView.tsx tests/ui/weekly-format-unify.test.tsx
git commit -m "feat(weekly): 양식 통일 버튼 — 미리보기 모달 후 일괄 표준화

flush→서버 미리보기→전/후 대조 모달→runBatch(undoable) 적용. 기존
멀티셀 배치의 저장·undo·Realtime 시맨틱을 그대로 상속해 Ctrl+Z 지원."
```

---

### Task 5: 통합 검증

**Files:** 없음 (검증만)

- [ ] **Step 1: 빌드·린트**

Run: `npm run build && npm run lint`
Expected: 둘 다 성공 (타입 에러·린트 경고 없음)

- [ ] **Step 2: 전체 테스트**

Run: `npm test`
Expected: 신규 테스트 전부 포함 통과. **허용되는 실패는 `tests/ui/minute-chat-scope.test.tsx` 3건뿐**(main의 기존 실패 — Global Constraints 참고). 그 외 실패는 이번 변경의 회귀이므로 수정 후 재실행.

- [ ] **Step 3: dev 부팅 sanity**

Run:
```bash
LOG="${TMPDIR:-/tmp}/wbs-dev-boot.log"
(npm run dev > "$LOG" 2>&1 &) && sleep 8 && curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/p/test/weekly; grep -i "error" "$LOG" | head -3; pkill -f "next dev"
```
Expected: `307`(미인증 → /login 리다이렉트), dev.log에 컴파일 에러 없음.

- [ ] **Step 4: 완료 보고**

배포는 이 계획의 범위 밖 — 사용자가 `/deploy`로 트리거한다(푸시만으로 Vercel prod 자동 배포, `vercel --prod` 금지).
