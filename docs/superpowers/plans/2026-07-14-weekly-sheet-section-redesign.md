# 주간업무 시트 구분 재정의 + PPT 연동 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 주간업무 시트의 분류 체계를 시스템 축(공통/ERP/MES × 모듈)에서 D-CUBE 보고 양식의 업무영역 축(공통 + 9개 영역) 1단으로 바꾸고, PPT 그룹 라벨을 거기에 맞춘다.

**Architecture:** 분류 체계의 유일한 정의처는 `src/lib/domain/weeklySheet.ts`의 `WEEKLY_SECTIONS` 상수다. 이 상수를 10개 업무영역으로 교체하고, 시드(`defaultWeeklyRows`)·이월(`carryOverRows`)·PPT 라벨(`sheetNarrative`)·표 UI(`WeeklySheetView`)가 그걸 따라간다. DB는 건드리지 않는다 — `section`/`module` 모두 제약 없는 자유 텍스트라 과거 시트는 저장된 값 그대로 남고 화면에서 병기로 읽힌다.

**Tech Stack:** Next.js App Router (RSC + 서버 액션), TypeScript, Supabase, vitest, Tailwind.

## Global Constraints

- 신규 구분 목록과 순서는 **정확히** 다음과 같다(사내 양식 순서, 앞에 `공통` 추가):
  `'공통', '영업', '품질', '생산계획', '조업 및 표준화', 'Luxteel 가공', '설비 및 Level2', '물류', '관리회계', '구매'`
- **SQL 마이그레이션을 만들지 않는다.** DB 스키마·기존 행 데이터에 쓰기를 가하지 않는다(D-CUBE 운영 데이터 보호).
- `weekly_report_rows.module` 컬럼과 `WeeklySheetRow.module` 필드는 **유지한다.** 과거 시트의 `SD/LE` 같은 값을 보존하기 위함이고, 신규 행에는 빈 문자열(`''`)이 들어간다.
- 셀 편집 계층(멀티셀 선택·복사/붙여넣기·채우기·Undo/Redo·IME·Realtime·디바운스/배치 저장), 제목 편집, 주차 네비게이션, 프레즌스, PPT 렌더러(`fillWeeklyTemplate`)·페이지 분할(`paginateGroups`)·`.pptx` 템플릿은 **건드리지 않는다.**
- `git add`는 항상 **파일을 명시**해서 한다. 이 저장소는 병렬 세션이 돌기 때문에 `git add -A`/`git add .`는 금지.
- 커밋 메시지 말미에 붙일 것:
  ```
  Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01YGicnYjxa4SC5wnecRM3SA
  ```
- 각 태스크의 커밋 시점에 `npx tsc --noEmit`이 통과해야 한다. 태스크 순서는 그걸 보장하도록 짜여 있다(도메인의 구 심볼을 먼저 지우지 않고, 소비처를 정리한 뒤 Task 4에서 지운다).

## File Structure

| 파일 | 책임 | 이 계획에서 |
|---|---|---|
| `src/lib/domain/weeklySheet.ts` | 분류 체계의 단일 정의처, 시드, 레거시 매핑, 이월, 셀 화이트리스트 | **수정** (Task 1, 4) |
| `src/lib/report/sheetNarrative.ts` | 시트 행 → PPT 내러티브 변환(순수) | **수정** (Task 2) |
| `src/components/weekly/WeeklySheetView.tsx` | 시트 표 UI | **수정** (Task 3) |
| `src/app/actions/weekly.ts` | 서버 액션(쓰기 경로) | **수정** (Task 4) |
| `tests/domain/weeklySheet.test.ts` | 도메인 계약 고정 | **수정** (Task 1, 4) |
| `tests/report/sheetNarrative.test.ts` | PPT 라벨 계약 고정 | **수정** (Task 2) |
| `tests/report/templateFill.test.ts` | 렌더러 회귀 가드 | **변경 없음** — 그대로 통과해야 함 |
| `supabase/migrations/` | — | **변경 없음** |

---

### Task 1: 도메인 — 구분 상수·시드·레거시 매핑·이월

**Files:**
- Modify: `src/lib/domain/weeklySheet.ts:17-39` (상수·시드), `:60-69` (이월)
- Test: `tests/domain/weeklySheet.test.ts`

**Interfaces:**
- Consumes: 없음 (순수 도메인, 이 계획의 뿌리)
- Produces:
  - `WEEKLY_SECTIONS: readonly string[]` — 10개 업무영역
  - `mapLegacySection(section: string, module: string): string` — 레거시 행 → 신규 구분
  - `defaultWeeklyRows(): NewWeeklyRow[]` — 표준 **10행**
  - `carryOverRows(prev: WeeklySheetRow[]): NewWeeklyRow[]` — **항상 10행** 반환(계약 변경)
  - `WEEKLY_MODULES` / `moduleOptions()`는 이 태스크에서 **남겨둔다** — `WeeklySheetView`가 아직 import 하므로 지우면 `tsc`가 깨진다. Task 4에서 지운다.

- [ ] **Step 1: 실패하는 테스트 작성**

`tests/domain/weeklySheet.test.ts`의 `describe('carryOverRows')`와 `describe('defaultWeeklyRows')` 두 블록을 아래로 **교체**한다. 파일 상단 import에 `mapLegacySection`을 추가한다(`moduleOptions`, `WEEKLY_MODULES` import는 Task 4까지 그대로 둔다 — 해당 describe 블록도 아직 살아 있다).

```ts
// import 줄을 다음으로 교체
import {
  carryOverRows, applyServerRow, defaultWeeklyRows, isWeeklyCellKey, mapLegacySection, moduleOptions,
  WEEKLY_MODULES, WEEKLY_SECTIONS, type WeeklySheetRow,
} from '@/lib/domain/weeklySheet'
```

```ts
describe('mapLegacySection', () => {
  it('구 분류(공통/ERP/MES × 모듈) → 신규 구분', () => {
    expect(mapLegacySection('공통', '공통')).toBe('공통')
    expect(mapLegacySection('ERP', 'SD/LE')).toBe('영업')
    expect(mapLegacySection('ERP', 'MD/PP')).toBe('생산계획')
    expect(mapLegacySection('ERP', 'MM')).toBe('구매')
    expect(mapLegacySection('ERP', 'FI/TR')).toBe('관리회계')
    expect(mapLegacySection('ERP', 'CO')).toBe('관리회계')
    expect(mapLegacySection('MES', '품질')).toBe('품질')
    expect(mapLegacySection('MES', 'APS')).toBe('생산계획')
    expect(mapLegacySection('MES', '조업 및 표준화')).toBe('조업 및 표준화')
    expect(mapLegacySection('MES', '가공')).toBe('Luxteel 가공')
    expect(mapLegacySection('MES', '설비 Level2')).toBe('설비 및 Level2')
    expect(mapLegacySection('MES', '물류')).toBe('물류')
  })
  it('이미 신규 구분이면 항등 — 신규 행은 module이 빈 문자열', () => {
    for (const s of WEEKLY_SECTIONS) expect(mapLegacySection(s, '')).toBe(s)
  })
  it('매핑 불가(자유 입력·모듈 없는 레거시) → 공통으로 흡수', () => {
    expect(mapLegacySection('기타', '알수없음')).toBe('공통')
    expect(mapLegacySection('MES', '')).toBe('공통')
    expect(mapLegacySection('', '')).toBe('공통')
  })
})

describe('defaultWeeklyRows', () => {
  const rows = defaultWeeklyRows()
  it('업무영역 10행 — 구분 순서 보존, sortOrder 1부터 연속, module은 빈값', () => {
    expect(rows).toHaveLength(10)
    expect(rows.map(r => r.section)).toEqual([...WEEKLY_SECTIONS])
    expect(rows.map(r => r.sortOrder)).toEqual(Array.from({ length: 10 }, (_, i) => i + 1))
    expect(rows.every(r => r.module === '')).toBe(true)
  })
  it('셀 4개는 모두 빈값', () => {
    for (const r of rows) expect(r.thisContent + r.thisIssue + r.nextContent + r.nextIssue).toBe('')
  })
})

describe('carryOverRows', () => {
  it('신규 체계 시트 — 차주계획→금주실적 1:1 이월, next는 비움, 10행 유지', () => {
    const prev = [
      row({ id: 'a', sortOrder: 2, section: '영업', module: '', nextContent: '계획B', nextIssue: '이슈B' }),
      row({ id: 'b', sortOrder: 1, section: '공통', module: '', thisContent: '지난실적', nextContent: '계획A' }),
    ]
    const out = carryOverRows(prev)
    expect(out).toHaveLength(10)
    expect(out.map(r => r.section)).toEqual([...WEEKLY_SECTIONS])
    expect(out[0]).toMatchObject({ section: '공통', thisContent: '계획A', thisIssue: '', nextContent: '', nextIssue: '' })
    expect(out[1]).toMatchObject({ section: '영업', thisContent: '계획B', thisIssue: '이슈B', nextContent: '', nextIssue: '' })
    expect('id' in out[0]).toBe(false)
  })
  it('레거시 시트 — 신규 구분으로 정규화, 같은 구분에 모이면 줄바꿈으로 병합', () => {
    const prev = [
      row({ id: 'a', sortOrder: 1, section: 'ERP', module: 'FI/TR', nextContent: '자금 계획' }),
      row({ id: 'b', sortOrder: 2, section: 'ERP', module: 'CO', nextContent: '원가 계획', nextIssue: '기준 미정' }),
      row({ id: 'c', sortOrder: 3, section: 'MES', module: '가공', nextContent: 'Luxteel 라인 점검' }),
    ]
    const out = carryOverRows(prev)
    expect(out).toHaveLength(10)
    const by = (s: string) => out.find(r => r.section === s)!
    expect(by('관리회계').thisContent).toBe('자금 계획\n원가 계획')  // sortOrder 순으로 이어붙임
    expect(by('관리회계').thisIssue).toBe('기준 미정')
    expect(by('Luxteel 가공').thisContent).toBe('Luxteel 라인 점검')
    expect(by('영업').thisContent).toBe('')                          // 원본에 없던 구분은 빈 행
  })
  it('빈 입력 → 빈 표준 10행(빈 배열 아님)', () => {
    const out = carryOverRows([])
    expect(out).toHaveLength(10)
    expect(out.every(r => r.thisContent === '' && r.nextContent === '')).toBe(true)
  })
})
```

- [ ] **Step 2: 테스트 실행해서 실패 확인**

Run: `npx vitest run tests/domain/weeklySheet.test.ts`
Expected: FAIL — `mapLegacySection is not a function` (또는 import 에러), `defaultWeeklyRows` 길이 12 ≠ 10.

- [ ] **Step 3: 도메인 구현**

`src/lib/domain/weeklySheet.ts`의 17~39행(`WEEKLY_SECTIONS` 주석 ~ `defaultWeeklyRows` 끝)을 아래로 교체한다. `WEEKLY_MODULES`와 `moduleOptions`는 **그대로 남긴다**(Task 4에서 제거).

```ts
/** D-CUBE 주간보고 양식의 업무영역 구분 — 시트는 이 목록 그대로 구분당 1행. */
export const WEEKLY_SECTIONS = [
  '공통', '영업', '품질', '생산계획', '조업 및 표준화',
  'Luxteel 가공', '설비 및 Level2', '물류', '관리회계', '구매',
] as const

/** 구 분류 체계(공통/ERP/MES × 모듈) → 신규 구분. 키는 모듈명(구분명보다 구체적). */
const LEGACY_SECTION_MAP: Record<string, string> = {
  '공통': '공통',
  'SD/LE': '영업',
  'MD/PP': '생산계획',
  'APS': '생산계획',
  'MM': '구매',
  'FI/TR': '관리회계',
  'CO': '관리회계',
  '품질': '품질',
  '조업 및 표준화': '조업 및 표준화',
  '가공': 'Luxteel 가공',
  '설비 Level2': '설비 및 Level2',
  '물류': '물류',
}

const isWeeklySection = (v: string): boolean => (WEEKLY_SECTIONS as readonly string[]).includes(v)

/** 레거시 행 → 신규 구분. 이미 신규 구분이면 항등. 매핑 불가는 '공통'으로 흡수(내용 유실 방지). */
export function mapLegacySection(section: string, module: string): string {
  const sec = section.trim(), mod = module.trim()
  if (isWeeklySection(sec)) return sec
  return LEGACY_SECTION_MAP[mod] ?? LEGACY_SECTION_MAP[sec] ?? '공통'
}

/** 구 분류 체계의 모듈 목록 — Task 4에서 제거 예정(현재 WeeklySheetView가 아직 참조). */
export const WEEKLY_MODULES: Record<string, readonly string[]> = {
  공통: ['공통'],
  ERP: ['SD/LE', 'MD/PP', 'MM', 'FI/TR', 'CO'],
  MES: ['품질', 'APS', '조업 및 표준화', '가공', '설비 Level2', '물류'],
}

/** 구분별 모듈 옵션 — Task 4에서 제거 예정. */
export function moduleOptions(section: string, current?: string): string[] {
  const base = WEEKLY_MODULES[section] ?? Object.values(WEEKLY_MODULES).flat()
  return current && !base.includes(current) ? [current, ...base] : [...base]
}

/** 새 주차 기본 스켈레톤 — 업무영역 10행(구분당 1행, 셀은 빈값). module은 신규 행에서 항상 ''. */
export function defaultWeeklyRows(): NewWeeklyRow[] {
  return WEEKLY_SECTIONS.map((section, i) => ({
    section, module: '', sortOrder: i + 1,
    thisContent: '', thisIssue: '', nextContent: '', nextIssue: '',
  }))
}
```

그리고 60~69행의 `carryOverRows`를 아래로 교체한다.

```ts
/** 새 주차 이월: 결과는 **항상 표준 10행**이다. 전주 차주계획 → 금주실적, next는 비움.
 *  레거시(공통/ERP/MES) 시트는 mapLegacySection으로 신규 구분에 흡수하고, 같은 구분으로
 *  모이는 내용(FI/TR + CO → 관리회계)은 sortOrder 순서대로 줄바꿈으로 이어붙인다.
 *  이 정규화가 없으면 레거시 시트에서 이월한 새 주차가 다시 구 12행 구조로 태어난다. */
export function carryOverRows(prev: WeeklySheetRow[]): NewWeeklyRow[] {
  const out = defaultWeeklyRows()
  const bySection = new Map(out.map(r => [r.section, r]))
  const append = (cur: string, add: string) => (add.trim() ? (cur ? `${cur}\n${add}` : add) : cur)
  for (const r of [...prev].sort((a, b) => a.sortOrder - b.sortOrder)) {
    const target = bySection.get(mapLegacySection(r.section, r.module))
    if (!target) continue
    target.thisContent = append(target.thisContent, r.nextContent)
    target.thisIssue = append(target.thisIssue, r.nextIssue)
  }
  return out
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npx vitest run tests/domain/weeklySheet.test.ts`
Expected: PASS (기존 `moduleOptions`·`applyServerRow`·`isWeeklyCellKey` describe 블록 포함 전부 통과)

- [ ] **Step 5: 타입 체크 — 트리가 여전히 green인지**

Run: `npx tsc --noEmit`
Expected: 에러 없음. (`WeeklySheetView`가 아직 `moduleOptions`를 import 하지만 남겨뒀으므로 통과)

- [ ] **Step 6: 커밋**

```bash
git add src/lib/domain/weeklySheet.ts tests/domain/weeklySheet.test.ts
git commit -m "$(cat <<'EOF'
feat(weekly): 구분을 업무영역 10개로 재정의 + 레거시 이월 정규화

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01YGicnYjxa4SC5wnecRM3SA
EOF
)"
```

---

### Task 2: PPT 그룹 라벨

**Files:**
- Modify: `src/lib/report/sheetNarrative.ts:29-49`
- Test: `tests/report/sheetNarrative.test.ts`

**Interfaces:**
- Consumes: `WeeklySheetRow`(Task 1과 동일 타입, 변경 없음)
- Produces: `rowLabel(r: WeeklySheetRow): string` — 그룹 헤드라인과 이슈 접두에 **같이** 쓰이는 단일 라벨 함수. `buildSheetNarrative`의 시그니처·반환 타입은 그대로.

렌더러(`fillWeeklyTemplate`)·템플릿·페이지 분할은 손대지 않는다. `tests/report/templateFill.test.ts`가 무수정 통과해야 한다.

- [ ] **Step 1: 실패하는 테스트 작성**

`tests/report/sheetNarrative.test.ts`를 아래 내용으로 **전체 교체**한다. (`sheetLineText`·`cellLines` 블록은 기존과 동일하게 유지되고, `buildSheetNarrative` 블록만 신규 라벨 규칙으로 바뀐다.)

```ts
import { describe, it, expect } from 'vitest'
import { sheetLineText, cellLines, rowLabel, buildSheetNarrative } from '@/lib/report/sheetNarrative'
import type { WeeklySheetRow } from '@/lib/domain/weeklySheet'

const row = (over: Partial<WeeklySheetRow>): WeeklySheetRow => ({
  id: 'r1', reportId: 'rep1', section: '영업', module: '', sortOrder: 1,
  thisContent: '', thisIssue: '', nextContent: '', nextIssue: '', ...over,
})

describe('sheetLineText', () => {
  it('일반·숫자 줄은 4칸, 마커 추가 없음', () => {
    expect(sheetLineText('1. 현업 인터뷰 참석')).toBe('    1. 현업 인터뷰 참석')
    expect(sheetLineText('프로세스 분석')).toBe('    프로세스 분석')
  })
  it("'-' 줄은 8칸, '.' 줄은 12칸", () => {
    expect(sheetLineText('- 대상 : 영업팀')).toBe('        - 대상 : 영업팀')
    expect(sheetLineText('. 세부 검토')).toBe('            . 세부 검토')
  })
  it('이미 들여쓴 입력도 시작 문자로 판정', () => {
    expect(sheetLineText('  - 대상')).toBe('        - 대상')
  })
})

describe('cellLines', () => {
  it('줄 분해 + 연속 빈 줄 축약 + 앞뒤 빈 줄 제거', () => {
    expect(cellLines('1. A\n- a\n\n\n2. B\n')).toEqual(['1. A', '- a', '', '2. B'])
    expect(cellLines('\n\n1. A')).toEqual(['1. A'])
    expect(cellLines('')).toEqual([])
    expect(cellLines('   \n  ')).toEqual([])
  })
})

describe('rowLabel', () => {
  it('신규 행(module 없음) — 구분명 단독', () => {
    expect(rowLabel(row({ section: '영업', module: '' }))).toBe('영업')
    expect(rowLabel(row({ section: '설비 및 Level2', module: '' }))).toBe('설비 및 Level2')
  })
  it('레거시 행 — 구분 · 모듈 병기', () => {
    expect(rowLabel(row({ section: 'ERP', module: 'SD/LE' }))).toBe('ERP · SD/LE')
    expect(rowLabel(row({ section: '공통', module: '공통' }))).toBe('공통') // 같으면 중복 표기 안 함
  })
  it('구분 없는 행 — 모듈 폴백, 둘 다 없으면 기타', () => {
    expect(rowLabel(row({ section: '', module: '물류' }))).toBe('물류')
    expect(rowLabel(row({ section: '', module: '' }))).toBe('기타')
  })
})

describe('buildSheetNarrative', () => {
  const rows = [
    row({ id: 'a', sortOrder: 2, section: '품질', thisContent: '1. 인터뷰', nextContent: '' }),
    row({ id: 'b', sortOrder: 1, section: '영업', thisContent: '1. CheckList\n- CBO', thisIssue: '지연 위험', nextContent: '1. 계획', nextIssue: '일정 협의 필요\n추가 인력' }),
    row({ id: 'c', sortOrder: 3, section: '구매' }), // 4셀 모두 빈 행
  ]
  const n = buildSheetNarrative(rows)

  it('prev=금주실적, curr=차주계획 — 헤드라인은 구분명, sortOrder 순', () => {
    expect(n.prev.map(g => g.phase)).toEqual(['영업', '품질'])
    expect(n.prev[0].items).toEqual(['1. CheckList', '- CBO'])
    expect(n.curr.map(g => g.phase)).toEqual(['영업']) // 품질은 차주 빈 셀 → 생략
  })
  it('내용 없는 구분은 어디에도 안 나감', () => {
    expect([...n.prev, ...n.curr].some(g => g.phase.includes('구매'))).toBe(false)
  })
  it('이슈: [구분] 접두, 멀티라인은 줄마다 개별 항목', () => {
    expect(n.issues).toEqual(['[영업] 지연 위험'])
    expect(n.events).toEqual(['[영업] 일정 협의 필요', '[영업] 추가 인력'])
  })
  it('이슈 없으면 [특이 이슈 없음] 직접 채움(우측 슬롯 기존 폴백 차단)', () => {
    const empty = buildSheetNarrative([row({ thisContent: '1. 작업' })])
    expect(empty.issues).toEqual(['특이 이슈 없음'])
    expect(empty.events).toEqual(['특이 이슈 없음'])
  })
  it('레거시 시트 — 헤드라인·이슈 접두에 구분 · 모듈 병기', () => {
    const legacy = buildSheetNarrative([
      row({ section: 'ERP', module: 'SD/LE', thisContent: '1. 수주 프로세스', thisIssue: '보류 건 있음' }),
    ])
    expect(legacy.prev.map(g => g.phase)).toEqual(['ERP · SD/LE'])
    expect(legacy.issues).toEqual(['[ERP · SD/LE] 보류 건 있음'])
  })
  it('구분·모듈 빈 행(무라벨) — "[] " 미노출', () => {
    const unlabeled = buildSheetNarrative([
      row({ section: '', module: '', thisContent: '1. 통관 프로세스', thisIssue: '보세공장 이슈' }),
    ])
    expect(unlabeled.prev.map(g => g.phase)).toEqual(['기타'])
    expect(unlabeled.issues).toEqual(['[기타] 보세공장 이슈'])
  })
})
```

- [ ] **Step 2: 테스트 실행해서 실패 확인**

Run: `npx vitest run tests/report/sheetNarrative.test.ts`
Expected: FAIL — `rowLabel` export 없음, 헤드라인이 `[영업] ` 형태로 나옴.

- [ ] **Step 3: 구현**

`src/lib/report/sheetNarrative.ts`의 29~35행(`headline`, `issueLabel` 정의)을 아래로 교체한다.

```ts
/** 행 라벨 — 헤드라인과 이슈 접두가 공유한다.
 *  신규 시트는 구분명 단독('영업'), 레거시 행은 '구분 · 모듈'('ERP · SD/LE')로 병기,
 *  구분이 없으면 모듈로 폴백하고 둘 다 없으면 '기타'('[] '가 노출되지 않게). */
export const rowLabel = (r: WeeklySheetRow): string => {
  const sec = r.section.trim(), mod = r.module.trim()
  if (!sec) return mod || '기타'
  return mod && mod !== sec ? `${sec} · ${mod}` : sec
}
```

이어서 `groupsOf`(37~41행)의 `phase: headline(r)`를 `phase: rowLabel(r)`로, `issuesOf`(43~49행)의 `[${issueLabel(r)}]`를 `[${rowLabel(r)}]`로 바꾼다.

```ts
function groupsOf(rows: WeeklySheetRow[], field: 'thisContent' | 'nextContent'): NarrativeGroup[] {
  return rows
    .filter(r => r[field].trim() !== '')
    .map((r, i) => ({ phase: rowLabel(r), num: i + 1, items: cellLines(r[field]) }))
}

function issuesOf(rows: WeeklySheetRow[], field: 'thisIssue' | 'nextIssue'): string[] {
  const out = rows.flatMap(r =>
    cellLines(r[field]).filter(l => l.trim() !== '').map(l => `[${rowLabel(r)}] ${l.trim()}`),
  )
  // 빈 목록을 직접 채워 fillWeeklyTemplate 우측 슬롯의 '예정된 주요 이벤트 없음' 폴백이 노출되지 않게 한다.
  return out.length ? out : ['특이 이슈 없음']
}
```

- [ ] **Step 4: 테스트 통과 + PPT 렌더러 회귀 없음 확인**

Run: `npx vitest run tests/report/`
Expected: PASS — `sheetNarrative.test.ts`, `templateFill.test.ts`(무수정), `narrative.test.ts`, `xml.test.ts` 전부 통과.

- [ ] **Step 5: 커밋**

```bash
git add src/lib/report/sheetNarrative.ts tests/report/sheetNarrative.test.ts
git commit -m "$(cat <<'EOF'
feat(report): 주간보고 PPT 그룹 라벨을 업무영역 구분명으로 교체

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01YGicnYjxa4SC5wnecRM3SA
EOF
)"
```

---

### Task 3: 시트 표 UI — 모듈 열·구조 편집 제거

**Files:**
- Modify: `src/components/weekly/WeeklySheetView.tsx`

**Interfaces:**
- Consumes: `WeeklySheetRow`(Task 1). `WEEKLY_SECTIONS`·`moduleOptions`는 **더 이상 import 하지 않는다.** 서버 액션 `renameWeeklySection`/`renameWeeklyModule`/`addWeeklyRow`/`deleteWeeklyRow`/`moveWeeklyRow`도 import에서 제거한다(Task 4에서 액션 자체를 지운다 — 순서를 지켜야 `tsc`가 안 깨진다).
- Produces: 없음(리프 컴포넌트)

**설계 수정 사항(스펙 §4.2에서 변경):** 구분 셀의 **rowSpan 병합을 완전히 제거**한다. 레거시 시트에서 `ERP` 5행이 병합되면 병합 셀에 첫 행의 모듈(`SD/LE`)만 남고 나머지 4개 모듈명이 화면에서 사라진다. 병합을 없애면 신규 시트(구분당 1행)는 모양이 그대로이고, 레거시 시트는 행마다 자기 `구분 / 모듈`을 정직하게 보여준다.

- [ ] **Step 1: import 정리**

`src/components/weekly/WeeklySheetView.tsx` 1~32행. lucide 아이콘에서 `ChevronDown`(NameCombo 전용), `Plus`(AddRowForm 전용), `Trash2`/`ArrowUp`/`ArrowDown`(행 액션 전용)을 뺀다. 도메인 import에서 `moduleOptions`·`WEEKLY_SECTIONS`를 뺀다. 액션 import를 셀 저장·문서 생성·제목만 남긴다. `CUSTOM` 상수(NameCombo 전용)를 지운다.

```tsx
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ChevronLeft, ChevronRight, Download, FileSpreadsheet } from 'lucide-react'
import { createBrowserClient } from '@/lib/supabase/client'
import {
  applyServerRow, WEEKLY_CELL_KEYS,
  CELL_FIELD, type WeeklyCellKey, type WeeklySheetRow, type WeeklyCellEdit,
} from '@/lib/domain/weeklySheet'
import { type CellAddr } from '@/lib/domain/sheetSelection'
import { emptyUndo, pushUndo, undo as undoOp, redo as redoOp, type UndoState } from '@/lib/domain/sheetUndo'
import {
  createWeeklyReport, saveWeeklyCell, saveWeeklyCells, saveWeeklyTitle,
  type WeeklyActionResult, type WeeklyBatchResult,
} from '@/app/actions/weekly'
import { shiftWeeks } from '@/lib/report/week'
import { EmptyState } from '@/components/ui/EmptyState'
import { useToast } from '@/components/ui/Toast'
import { buildPresenceMap, onlinePeers } from '@/lib/domain/sheetPresence'
import { PresenceStrip } from '@/components/app/PresenceStrip'
import { useSheetGrid } from './useSheetGrid'
import { usePresence } from './usePresence'
import { SheetCell, type BatchChip } from './SheetCell'

type CellStatus = 'saving' | 'saved' | 'error'
const DEBOUNCE_MS = 1500
const CELL_MAX = 20000   // 셀 1개 상한(BE와 동일) — 배치 로컬 클램프용
const BATCH_MAX = 500    // 한 배치 최대 edit 수(BE와 동일) — 사전 검사용
```

- [ ] **Step 2: rename 핸들러와 spans 계산 삭제**

244~252행의 `onRenameSection`/`onRenameModule` 두 함수를 통째로 삭제한다(주석 포함). `runAction`은 EmptyState의 `createWeeklyReport` 버튼이 아직 쓰므로 **남긴다.**

478~485행의 `spans` `useMemo` 블록(주석 3줄 포함)을 통째로 삭제한다.

- [ ] **Step 3: EmptyState 안내 문구 갱신**

495행의 `description`을 교체한다.

```tsx
          description="이전 주차에서 이월하거나 기본 시트(공통·영업·품질 등 업무영역 10개 구분)로 시작하세요. 이월하면 이전 주의 차주계획이 이번 주 금주실적 초안으로 들어옵니다."
```

- [ ] **Step 4: 표 구조 교체**

544~651행(`{/* 열 비율은 … */}` 주석부터 `<AddRowForm … />` 줄까지)을 아래로 교체한다. `<div aria-live="polite" …>` 줄은 그대로 남긴다.

```tsx
          {/* 구분 1단(업무영역 10개) + 내용 4열. 모듈 열과 행 구조 편집은 없다 — 구분당 1행 고정. */}
          <table className="w-full table-fixed border-collapse bg-white text-[13px] text-black">
            <colgroup>
              <col className="w-[10%]" />    {/* 구분 */}
              <col className="w-[27%]" />    {/* 금주 내용 */}
              <col className="w-[19%]" />    {/* 금주 이슈 */}
              <col className="w-[26%]" />    {/* 차주 내용 */}
              <col className="w-[18%]" />    {/* 차주 이슈 */}
            </colgroup>
            <thead>
              <tr>
                <th rowSpan={2} className={HDR}>구분</th>
                <th colSpan={2} className={HDR}>금주실적({thisRange})</th>
                <th colSpan={2} className={HDR}>차주계획({nextRange})</th>
              </tr>
              <tr>
                <th className={HDR}>내용</th>
                <th className={HDR}>이슈 및 주요 이벤트</th>
                <th className={HDR}>내용</th>
                <th className={HDR}>이슈 및 주요 이벤트</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => {
                // 레거시 시트(구 공통/ERP/MES × 모듈)의 모듈명을 잃지 않게 구분 칸에 병기한다.
                const legacyModule = r.module.trim() && r.module.trim() !== r.section.trim() ? r.module.trim() : ''
                const rowName = legacyModule ? `${r.section} ${legacyModule}` : r.section
                return (
                <tr key={r.id}>
                  <td className="border border-neutral-500 px-1 py-1.5 text-center align-middle text-[13px] font-bold text-black">
                    <div>{r.section}</div>
                    {legacyModule && <div className="text-[11px] font-normal text-neutral-500">{legacyModule}</div>}
                  </td>
                  {COLS.map((c, j) => {
                    const addr: CellAddr = { rowId: r.id, col: c.key }
                    const active = grid.sel.active.rowId === r.id && grid.sel.active.col === c.key
                    const inRange = !!gr && i >= gr.top && i <= gr.bottom && j >= gr.left && j <= gr.right
                    const inFill = !!fp && i >= fp.top && i <= fp.bottom && j >= fp.left && j <= fp.right
                    const bg = fp && inFill && !inRange ? 'bg-[#e8f0fe]/60'
                      : isMulti && inRange && !active ? 'bg-[#e8f0fe]' : 'bg-white'
                    return (
                      // h-px: td에 명시 높이를 줘야 내부 h-full/min-h-full이 행 실제 높이로 해석된다(표 셀 스트레치 관례).
                      // 없으면 입력창이 자기 내용만큼만 높아져, 옆 셀이 큰 행에서 포커스 링이 셀 일부만 감싼다.
                      <td key={c.key} className={`h-px border border-neutral-500 p-0 align-top ${bg}`}>
                        <SheetCell
                          addr={addr}
                          value={r[CELL_FIELD[c.key]]}
                          ariaLabel={`${c.label}, ${rowName}`}
                          status={status[`${r.id}:${c.key}`]}
                          isActive={active}
                          editing={active && grid.sel.editing}
                          showBorder={isMulti && inRange}
                          edgeTop={!!gr && i === gr.top} edgeRight={!!gr && j === gr.right}
                          edgeBottom={!!gr && i === gr.bottom} edgeLeft={!!gr && j === gr.left}
                          showFillBorder={!!fp && inFill}
                          fillTop={!!fp && i === fp.top} fillRight={!!fp && j === fp.right}
                          fillBottom={!!fp && i === fp.bottom} fillLeft={!!fp && j === fp.left}
                          showFillHandle={!!gr && i === gr.bottom && j === gr.right && !grid.sel.editing && grid.dragging !== 'fill'}
                          batchActive={batchActive}
                          chip={active ? batchChip : null}
                          peers={presenceByCell.get(`${r.id}:${c.key}`) ?? null}
                          register={registerCell}
                          onChange={v => onCellChange(r.id, c.key, v)}
                          onBlur={e => { handleCellBlur(addr); grid.onCellBlurEvent(e) }}
                          onRetry={() => commit(r.id, c.key)}
                          onChipRetry={retryBatch}
                          onMouseDown={e => grid.onCellMouseDown(e, addr)}
                          onMouseEnter={() => grid.onCellMouseEnter(addr)}
                          onFocus={() => grid.onCellFocus(addr)}
                          onDoubleClick={grid.onCellDoubleClick}
                          onKeyDown={grid.onCellKeyDown}
                          onCopy={grid.onCellCopy}
                          onCut={grid.onCellCut}
                          onPaste={grid.onCellPaste}
                          onCompositionStart={grid.onCompositionStart}
                          onCompositionEnd={grid.onCompositionEnd}
                          onFillHandleMouseDown={grid.onFillHandleMouseDown}
                        />
                      </td>
                    )
                  })}
                </tr>
                )
              })}
            </tbody>
          </table>
```

- [ ] **Step 5: NameCombo·AddRowForm 컴포넌트 삭제**

757~823행의 `NameCombo` 함수와 `AddRowForm` 함수를 통째로 삭제한다(각각의 JSDoc 주석 포함). `TitleEditor`·`WeekNav`·`ExportPptButton`은 그대로 둔다.

- [ ] **Step 6: 타입·린트 확인**

Run: `npx tsc --noEmit && npm run lint`
Expected: 에러 없음. 미사용 import·미사용 변수 경고가 뜨면 남은 잔재이므로 지운다.

- [ ] **Step 7: 테스트 전체 통과 확인(회귀 가드)**

Run: `npm test`
Expected: PASS — 셀 편집 계층(`sheetSelection`·`sheetUndo`·`sheetClipboard`) 테스트가 전부 그대로 통과해야 한다. 하나라도 깨지면 편집 기능을 건드린 것이므로 되돌린다.

- [ ] **Step 8: 커밋**

```bash
git add src/components/weekly/WeeklySheetView.tsx
git commit -m "$(cat <<'EOF'
feat(weekly): 시트 표를 구분 1단으로 재구성 — 모듈 열·행 구조 편집 제거

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01YGicnYjxa4SC5wnecRM3SA
EOF
)"
```

---

### Task 4: 서버 액션·도메인 데드 코드 정리

**Files:**
- Modify: `src/app/actions/weekly.ts:23-27` (상수), `:96-129` (rename 2종), `:202-277` (add/delete/move), `:66` (주석)
- Modify: `src/lib/domain/weeklySheet.ts` (`WEEKLY_MODULES`, `moduleOptions` 제거)
- Test: `tests/domain/weeklySheet.test.ts` (`moduleOptions` describe 제거)

**Interfaces:**
- Consumes: Task 3에서 UI가 이 심볼들의 import를 이미 끊었다. 이 태스크 전에 Task 3이 끝나 있어야 `tsc`가 통과한다.
- Produces: `src/app/actions/weekly.ts`의 공개 액션은 `createWeeklyReport`, `saveWeeklyTitle`, `saveWeeklyCell`, `saveWeeklyCells` 4개만 남는다.

- [ ] **Step 1: 남은 참조가 없는지 확인**

Run:
```bash
grep -rn --include="*.ts" --include="*.tsx" -E "moduleOptions|WEEKLY_MODULES|addWeeklyRow|deleteWeeklyRow|moveWeeklyRow|renameWeeklySection|renameWeeklyModule" src tests
```
Expected: `src/app/actions/weekly.ts`, `src/lib/domain/weeklySheet.ts`, `tests/domain/weeklySheet.test.ts` 안의 **정의부와 그 테스트만** 나온다. `src/components/` 아래에 하나라도 남아 있으면 Task 3이 덜 끝난 것이므로 먼저 마무리한다.

- [ ] **Step 2: 서버 액션 삭제**

`src/app/actions/weekly.ts`에서:
- 26~27행의 `NAME_MAX`, `RENAME_MAX_ROWS` 상수 삭제
- 96~129행 `renameWeeklySection`, `renameWeeklyModule` 삭제(JSDoc 포함)
- 202~277행 `addWeeklyRow`, `deleteWeeklyRow`, `moveWeeklyRow` 삭제(JSDoc 포함)

66행의 시드 주석을 갱신한다.

```ts
  // 이월이면 이월 원본 행(신규 구분으로 정규화된 10행), 아니면 표준 스켈레톤 10행 — 행 0개 문서는 만들지 않는다.
```

`CELL_MAX`, `BATCH_MAX`, `TITLE_MAX`, `revalidateWeekly`, `errMsg`, `deleteReportIfEmpty`는 남는다.

- [ ] **Step 3: 도메인 데드 코드 삭제**

`src/lib/domain/weeklySheet.ts`에서 Task 1이 남겨둔 `WEEKLY_MODULES` 상수와 `moduleOptions` 함수를 각각의 주석과 함께 삭제한다. `LEGACY_SECTION_MAP`은 `mapLegacySection`이 쓰므로 **남긴다.**

- [ ] **Step 4: 도메인 테스트에서 moduleOptions 블록 제거**

`tests/domain/weeklySheet.test.ts`의 `describe('moduleOptions')` 블록(41~53행)을 통째로 삭제하고, import 줄에서 `moduleOptions`와 `WEEKLY_MODULES`를 뺀다.

```ts
import {
  carryOverRows, applyServerRow, defaultWeeklyRows, isWeeklyCellKey, mapLegacySection,
  WEEKLY_SECTIONS, type WeeklySheetRow,
} from '@/lib/domain/weeklySheet'
```

- [ ] **Step 5: 타입·린트·테스트 확인**

Run: `npx tsc --noEmit && npm run lint && npm test`
Expected: 전부 통과. 삭제한 심볼을 참조하는 곳이 있으면 여기서 잡힌다.

- [ ] **Step 6: 커밋**

```bash
git add src/app/actions/weekly.ts src/lib/domain/weeklySheet.ts tests/domain/weeklySheet.test.ts
git commit -m "$(cat <<'EOF'
refactor(weekly): 구조 편집 액션과 구 모듈 분류 데드 코드 제거

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01YGicnYjxa4SC5wnecRM3SA
EOF
)"
```

---

### Task 5: 전체 게이트 + 런타임 검증

**Files:**
- 없음(검증 전용). 실패가 나오면 해당 태스크로 돌아가 고친다.

**Interfaces:**
- Consumes: Task 1~4의 결과 전부
- Produces: 배포 가능 상태

- [ ] **Step 1: 전체 게이트**

Run: `npm run lint && npx tsc --noEmit && npm test && npm run build`
Expected: 4개 모두 통과. `npm test`에서 `tests/report/templateFill.test.ts`가 **무수정 통과**해야 한다(PPT 렌더러를 안 건드렸다는 증거).

- [ ] **Step 2: PPT 경로 실물 확인**

이 샌드박스에서는 브라우저로 dev 서버에 접근할 수 없다(`/verify` 스킬). PPT 경로는 순수 함수 + zip 통합 테스트로 확인한다 — 두 테스트가 신규 시트·레거시 시트·실제 `.pptx` 파트 배선을 모두 덮는다.

Run:
```bash
npx vitest run tests/report/sheetNarrative.test.ts tests/report/templateFill.test.ts --reporter=verbose
```
Expected: 모든 케이스 PASS. 특히 `'레거시 시트 — 헤드라인·이슈 접두에 구분 · 모듈 병기'`와 `templateFill`의 시트 경로 통합 테스트(zip 파트 검증)가 이름과 함께 초록으로 찍혀야 한다.

- [ ] **Step 3: 변경 요약을 사용자에게 보고**

바뀐 것: 구분 10개, 시드 10행, 모듈 열 제거, 구조 편집 제거, PPT 헤드라인 = 구분명, 레거시 시트 보존·이월 정규화.
안 바뀐 것: 셀 편집 전부, 제목, 주차 이동, PPT 템플릿·렌더러, DB 스키마.

배포는 사용자 승인 후 `/deploy` 스킬로 진행한다(이 계획은 배포를 포함하지 않는다).

---

## Self-Review

**스펙 커버리지**
- §3 카테고리 정의 → Task 1 (상수·시드) + Task 4 (구 모듈 삭제) ✓
- §4.1 표 구조 → Task 3 Step 4 ✓
- §4.2 구분 읽기 전용 + 레거시 병기 → Task 3 Step 4 ✓ (단, rowSpan 병합 유지 → **제거**로 변경. 근거는 Task 3 머리말에 명시. 스펙 §4.2를 이에 맞춰 고칠 것)
- §4.3 제거 목록 → Task 3 Step 1·2·5 (UI), Task 4 Step 2·3 (액션·상수) ✓
- §5 이월 정규화 + 매핑표 → Task 1 (`mapLegacySection`, `carryOverRows`) ✓
- §6 PPT 라벨 → Task 2 ✓
- §7 기존 데이터 무변경 → 마이그레이션 태스크 없음, Global Constraints에 명시 ✓
- §8 테스트 → Task 1·2·4 ✓ (UI 렌더 테스트는 없다 — `WeeklySheetView`는 supabase 클라이언트·서버 액션·프레즌스에 얽혀 있어 렌더 테스트 비용이 크고, 이 변경의 실제 로직은 전부 도메인·내러티브 순수 함수에 있다. UI는 `tsc`·`lint`·`build`로 가드한다.)
- §9 검증 → Task 5 ✓

**플레이스홀더 스캔:** 없음. 모든 코드 단계에 실제 코드가 들어 있다.

**타입 일관성:** `mapLegacySection(section, module) → string`(Task 1 정의, Task 1 `carryOverRows`에서 사용), `rowLabel(r) → string`(Task 2 정의, 같은 파일 `groupsOf`/`issuesOf`에서 사용), `defaultWeeklyRows() → NewWeeklyRow[]`(Task 1, `carryOverRows`와 `createWeeklyReport`가 사용). `carryOverRows`의 반환 계약이 "빈 배열 가능"에서 "항상 10행"으로 바뀌는데, 유일한 호출처인 `createWeeklyReport`의 `if (!seed.length) seed = defaultWeeklyRows()` 폴백은 이제 도달하지 않을 뿐 무해하므로 그대로 둔다.
