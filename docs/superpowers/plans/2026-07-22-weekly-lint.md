# 주간보고 점검 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 주간업무 작성 화면에 `주간보고 점검` 버튼을 달아, 구분 간 중복 줄·셀 안 줄 번호 오류·공백/글머리 기호 문제를 찾아 항목별로 수정 적용할 수 있게 한다.

**Architecture:** 점검 로직은 I/O 없는 순수 함수 `lintWeeklySheet(rows) → LintFinding[]`(`src/lib/domain/weeklyLint.ts`)에 모은다. UI는 기존 `Modal`을 쓰는 별도 컴포넌트 `WeeklyLintPanel`이고, 수정 적용은 새 저장 경로를 만들지 않고 이미 있는 `runBatch(edits, { undoable: true })`에 태워 자동저장·Realtime·Ctrl+Z 되돌리기를 그대로 재사용한다.

**Tech Stack:** Next.js App Router, React 19 client components, TypeScript, Tailwind, Vitest.

**설계 문서:** `docs/superpowers/specs/2026-07-22-weekly-lint-design.md`

---

## 사전 지식 (이 저장소를 처음 보는 사람용)

- 주간업무 시트는 **업무영역 구분 10행 고정 × 내용 4열**이다. 행 추가/삭제 UI가 없다.
- 4개 열의 DB 열명(=`WeeklyCellKey`)은 `this_content`, `this_issue`, `next_content`, `next_issue`. 이 배열이 `WEEKLY_CELL_KEYS`이고 열 표시 순서와 같다.
- `WeeklySheetRow`의 대응 필드명은 camelCase(`thisContent` 등)이고, 둘 사이 매핑은 `CELL_FIELD` 상수다. 열 라벨은 `WEEKLY_CELL_LABEL`.
- 한 셀 안에서 `Alt+Enter`로 줄을 나눈다. 즉 셀 값은 `\n`이 들어간 여러 줄 문자열이다.
- 셀 수정의 최소 단위는 `WeeklyCellEdit { rowId, cellKey, content }`이고, 여러 개를 한 번에 `runBatch`에 넘기면 하나의 undo 엔트리가 된다.
- 위 타입/상수는 전부 `src/lib/domain/weeklySheet.ts`에 이미 있다. **새로 만들지 말고 import 한다.**
- 테스트는 vitest. 전체 실행은 `npm test`, 단일 파일은 `npx vitest run tests/domain/weeklyLint.test.ts`.
- 도메인 테스트 관례는 `tests/domain/sheetSelection.test.ts`를 보라 — `mkRow` 같은 작은 팩토리를 파일 상단에 두고 `describe`/`it`을 한글로 쓴다.

## 파일 구성

| 파일 | 책임 | 상태 |
|---|---|---|
| `src/lib/domain/weeklyLint.ts` | 점검 규칙 전부(순수). 타입 `LintFinding`, 진입점 `lintWeeklySheet` | 신규 |
| `tests/domain/weeklyLint.test.ts` | 규칙별 단위 테스트 | 신규 |
| `src/components/weekly/WeeklyLintPanel.tsx` | 모달 UI + 적용/이동 배선 | 신규 |
| `src/components/weekly/useSheetGrid.ts` | `focusCell(addr)` 노출 | 수정 |
| `src/components/weekly/WeeklySheetView.tsx` | 버튼·모달 렌더, `rows`/`runBatch`/`focusCell` 전달 | 수정 |

---

## Task 1: 공통 타입과 문자열 헬퍼

점검 규칙 3종이 공유하는 타입·정규식·정규화 함수를 먼저 만든다. 이 태스크만으로는 화면에 아무 변화가 없다.

**Files:**
- Create: `src/lib/domain/weeklyLint.ts`
- Create: `tests/domain/weeklyLint.test.ts`

- [ ] **Step 1: 실패하는 테스트 작성**

`tests/domain/weeklyLint.test.ts` 를 새로 만든다:

```ts
import { describe, it, expect } from 'vitest'
import { normalizeForCompare } from '@/lib/domain/weeklyLint'

describe('normalizeForCompare', () => {
  it('앞뒤 공백·연속 공백을 정리한다', () => {
    expect(normalizeForCompare('  설계  리뷰 완료  ')).toBe('설계 리뷰 완료')
  })

  it('선두 글머리 기호를 떼어낸다', () => {
    expect(normalizeForCompare('- 설계 리뷰 완료')).toBe('설계 리뷰 완료')
    expect(normalizeForCompare('· 설계 리뷰 완료')).toBe('설계 리뷰 완료')
    expect(normalizeForCompare('● 설계 리뷰 완료')).toBe('설계 리뷰 완료')
    expect(normalizeForCompare('* 설계 리뷰 완료')).toBe('설계 리뷰 완료')
  })

  it('선두 줄 번호를 떼어낸다 — . 과 ) 양식 모두', () => {
    expect(normalizeForCompare('1. 설계 리뷰 완료')).toBe('설계 리뷰 완료')
    expect(normalizeForCompare('12) 설계 리뷰 완료')).toBe('설계 리뷰 완료')
  })

  it('기호와 번호가 겹쳐 있어도 둘 다 떼어낸다', () => {
    expect(normalizeForCompare('- 1. 설계 리뷰 완료')).toBe('설계 리뷰 완료')
  })

  it('전각 공백을 반각으로 바꾼다', () => {
    expect(normalizeForCompare('설계　리뷰')).toBe('설계 리뷰')
  })

  it('빈 줄·기호만 있는 줄은 빈 문자열', () => {
    expect(normalizeForCompare('')).toBe('')
    expect(normalizeForCompare('   ')).toBe('')
    expect(normalizeForCompare('-')).toBe('')
  })
})
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run tests/domain/weeklyLint.test.ts`
Expected: FAIL — `Failed to resolve import "@/lib/domain/weeklyLint"`

- [ ] **Step 3: 최소 구현**

`src/lib/domain/weeklyLint.ts` 를 새로 만든다:

```ts
/* ── 주간보고 점검(순수) — 중복·체번·공백 규칙과 수정 편집 생성. I/O 없음. ── */

import {
  CELL_FIELD, WEEKLY_CELL_KEYS, WEEKLY_CELL_LABEL,
  type WeeklyCellEdit, type WeeklyCellKey, type WeeklySheetRow,
} from './weeklySheet'

export type LintKind = 'duplicate' | 'numbering' | 'format'

export interface LintFinding {
  /** 안정 키(React list). 같은 지적이면 재계산해도 같은 값이어야 한다. */
  id: string
  kind: LintKind
  /** 클릭 시 이동할 대표 셀. 중복은 '삭제 대상' 중 sortOrder가 가장 작은 행. */
  rowId: string
  cellKey: WeeklyCellKey
  /** 목록 제목 — 예: `PMO · 금주실적 내용` */
  title: string
  /** 무엇이 문제이고 적용하면 어떻게 되는지 */
  detail: string
  /** 적용할 편집. 기존 배치 편집 단위를 그대로 쓴다. */
  edits: WeeklyCellEdit[]
}

/** 인정하는 글머리 기호. 배열 순서 = 다수결 동수 시 우선순위(- 우선). */
export const BULLETS = ['-', '·', '*', '●'] as const

/** 선두 줄 번호: 숫자 + (. 또는 )) + 뒤따르는 공백(없을 수도). */
const NUM_PREFIX = /^(\d+)([.)])( *)/
/** 글머리 기호로 인정하는 형태 — 기호 뒤에 공백이 반드시 온다.
 *  `-5%` 같은 본문을 기호로 오인해 고쳐 쓰지 않기 위한 보수적 판정. */
const BULLET_PREFIX = /^([-·*●])( +)(?=\S)/

/** 비교 전용 정규화 — 저장 값에는 영향이 없다. 기호·번호를 떼고 공백을 접어,
 *  `- 설계 리뷰 완료`와 `1. 설계  리뷰 완료`를 같은 줄로 보게 한다. */
export function normalizeForCompare(line: string): string {
  let s = line.replace(/　/g, ' ').trim()
  // 기호와 번호가 겹쳐 붙은 경우(`- 1. 항목`)까지 커버하되, 무한 반복은 막는다.
  for (let i = 0; i < 2; i++) {
    const next = s.replace(NUM_PREFIX, '').replace(/^[-·*●] */, '').trimStart()
    if (next === s) break
    s = next
  }
  return s.replace(/\s+/g, ' ').trim()
}
```

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run tests/domain/weeklyLint.test.ts`
Expected: PASS — 6 tests

- [ ] **Step 5: 커밋**

```bash
git add src/lib/domain/weeklyLint.ts tests/domain/weeklyLint.test.ts
git commit -m "feat(weekly): 점검 기능 공통 타입과 줄 정규화"
```

---

## Task 2: 규칙 ① 같은 열, 구분 간 중복

같은 열(예: 금주실적 내용)에서 서로 다른 구분 행에 동일한 줄이 있으면 지적하고, `sortOrder`가 가장 작은 행의 줄만 남기는 편집을 만든다.

**Files:**
- Modify: `src/lib/domain/weeklyLint.ts`
- Modify: `tests/domain/weeklyLint.test.ts`

- [ ] **Step 1: 실패하는 테스트 작성**

`tests/domain/weeklyLint.test.ts` 의 import 줄을 아래로 바꾸고,

```ts
import { normalizeForCompare, lintDuplicates } from '@/lib/domain/weeklyLint'
import type { WeeklySheetRow } from '@/lib/domain/weeklySheet'
```

파일 맨 아래에 팩토리와 테스트를 추가한다:

```ts
const mkRow = (id: string, section: string, sortOrder: number, over: Partial<WeeklySheetRow> = {}): WeeklySheetRow => ({
  id, reportId: 'rep', section, module: '', sortOrder,
  thisContent: '', thisIssue: '', nextContent: '', nextIssue: '', ...over,
})

describe('lintDuplicates', () => {
  it('같은 열 두 구분에 동일 줄 — 지적 1건, 뒤 구분에서 삭제', () => {
    const rows = [
      mkRow('r1', 'PMO', 1, { thisContent: '킥오프 완료\n설계 리뷰 완료' }),
      mkRow('r2', '영업', 2, { thisContent: '견적 회신\n설계 리뷰 완료' }),
    ]
    const out = lintDuplicates(rows)
    expect(out).toHaveLength(1)
    expect(out[0].kind).toBe('duplicate')
    expect(out[0].cellKey).toBe('this_content')
    expect(out[0].rowId).toBe('r2')
    expect(out[0].edits).toEqual([{ rowId: 'r2', cellKey: 'this_content', content: '견적 회신' }])
  })

  it('글머리·번호가 달라도 같은 줄로 본다', () => {
    const rows = [
      mkRow('r1', 'PMO', 1, { thisIssue: '- 설계 리뷰 완료' }),
      mkRow('r2', '영업', 2, { thisIssue: '1. 설계  리뷰 완료' }),
    ]
    const out = lintDuplicates(rows)
    expect(out).toHaveLength(1)
    expect(out[0].edits).toEqual([{ rowId: 'r2', cellKey: 'this_issue', content: '' }])
  })

  it('다른 열의 같은 줄은 지적하지 않는다', () => {
    const rows = [
      mkRow('r1', 'PMO', 1, { thisContent: '설계 리뷰 완료' }),
      mkRow('r2', '영업', 2, { nextContent: '설계 리뷰 완료' }),
    ]
    expect(lintDuplicates(rows)).toEqual([])
  })

  it('같은 셀 안 중복은 이 규칙의 대상이 아니다', () => {
    const rows = [mkRow('r1', 'PMO', 1, { thisContent: '설계 리뷰 완료\n설계 리뷰 완료' })]
    expect(lintDuplicates(rows)).toEqual([])
  })

  it('3개 구분에 겹치면 1건으로 묶고 첫 구분만 남긴다', () => {
    const rows = [
      mkRow('r1', 'PMO', 1, { thisContent: '설계 리뷰 완료' }),
      mkRow('r2', '영업', 2, { thisContent: '설계 리뷰 완료\n견적 회신' }),
      mkRow('r3', '구매', 3, { thisContent: '설계 리뷰 완료' }),
    ]
    const out = lintDuplicates(rows)
    expect(out).toHaveLength(1)
    expect(out[0].rowId).toBe('r2')
    expect(out[0].edits).toEqual([
      { rowId: 'r2', cellKey: 'this_content', content: '견적 회신' },
      { rowId: 'r3', cellKey: 'this_content', content: '' },
    ])
  })

  it('빈 줄은 중복으로 보지 않는다', () => {
    const rows = [
      mkRow('r1', 'PMO', 1, { thisContent: '가\n\n나' }),
      mkRow('r2', '영업', 2, { thisContent: '다\n\n라' }),
    ]
    expect(lintDuplicates(rows)).toEqual([])
  })

  it('sortOrder가 뒤섞여 들어와도 가장 작은 구분을 남긴다', () => {
    const rows = [
      mkRow('r2', '영업', 2, { thisContent: '설계 리뷰 완료' }),
      mkRow('r1', 'PMO', 1, { thisContent: '설계 리뷰 완료' }),
    ]
    const out = lintDuplicates(rows)
    expect(out[0].edits).toEqual([{ rowId: 'r2', cellKey: 'this_content', content: '' }])
  })
})
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run tests/domain/weeklyLint.test.ts`
Expected: FAIL — `lintDuplicates is not a function` (또는 import 오류)

- [ ] **Step 3: 최소 구현**

`src/lib/domain/weeklyLint.ts` 맨 아래에 추가한다:

```ts
/** 셀 값을 줄 배열로. 빈 문자열은 빈 배열(빈 줄 1개가 아니라). */
const toLines = (content: string): string[] => (content === '' ? [] : content.split('\n'))

/** 지정 인덱스의 줄을 지운 결과. 전부 공백만 남으면 빈 셀로 만든다. */
function removeLines(content: string, drop: ReadonlySet<number>): string {
  const kept = toLines(content).filter((_, i) => !drop.has(i))
  const joined = kept.join('\n')
  return joined.trim() === '' ? '' : joined
}

/** 규칙 ① — 같은 열에서 구분 행을 가로지르는 동일 줄. 같은 셀 안 중복은 대상이 아니다. */
export function lintDuplicates(rows: WeeklySheetRow[]): LintFinding[] {
  const ordered = [...rows].sort((a, b) => a.sortOrder - b.sortOrder)
  const byId = new Map(ordered.map(r => [r.id, r]))
  const out: LintFinding[] = []

  for (const cellKey of WEEKLY_CELL_KEYS) {
    // 정규화 줄 → 등장 위치들. ordered 순회라 배열 앞쪽이 곧 sortOrder가 작은 쪽이다.
    const groups = new Map<string, { rowId: string; line: number; raw: string }[]>()
    for (const row of ordered) {
      toLines(row[CELL_FIELD[cellKey]]).forEach((raw, line) => {
        const norm = normalizeForCompare(raw)
        if (!norm) return
        const hits = groups.get(norm)
        if (hits) hits.push({ rowId: row.id, line, raw })
        else groups.set(norm, [{ rowId: row.id, line, raw }])
      })
    }

    for (const [norm, hits] of groups) {
      const keepRowId = hits[0].rowId
      const victims = hits.filter(h => h.rowId !== keepRowId)
      if (victims.length === 0) continue // 한 구분 안에서만 반복 — 대상 아님

      // 행별로 지울 줄 번호를 모아 셀당 편집 1개로. victims는 ordered 순서를 물려받는다.
      const dropByRow = new Map<string, Set<number>>()
      for (const v of victims) {
        const s = dropByRow.get(v.rowId)
        if (s) s.add(v.line)
        else dropByRow.set(v.rowId, new Set([v.line]))
      }
      const edits: WeeklyCellEdit[] = [...dropByRow].map(([rowId, drop]) => ({
        rowId, cellKey, content: removeLines(byId.get(rowId)![CELL_FIELD[cellKey]], drop),
      }))

      const keepSection = byId.get(keepRowId)!.section
      const victimSections = [...dropByRow.keys()].map(id => byId.get(id)!.section)
      out.push({
        id: `duplicate:${cellKey}:${norm}`,
        kind: 'duplicate',
        rowId: edits[0].rowId,
        cellKey,
        title: WEEKLY_CELL_LABEL[cellKey],
        detail: `${[keepSection, ...victimSections].join(' · ')}에 같은 줄이 있습니다: "${norm}" — ${victimSections.join(' · ')}에서 이 줄을 지웁니다.`,
        edits,
      })
    }
  }
  return out
}
```

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run tests/domain/weeklyLint.test.ts`
Expected: PASS — 13 tests

- [ ] **Step 5: 커밋**

```bash
git add src/lib/domain/weeklyLint.ts tests/domain/weeklyLint.test.ts
git commit -m "feat(weekly): 점검 규칙 - 같은 열 구분 간 중복 줄"
```

---

## Task 3: 규칙 ② 셀 안 줄 번호 체번

한 셀 안에서 번호로 시작하는 줄이 2줄 이상인데 1부터 1씩 증가하지 않으면 지적하고, 첫 번호 줄의 표기 스타일을 유지한 채 다시 매긴다.

**Files:**
- Modify: `src/lib/domain/weeklyLint.ts`
- Modify: `tests/domain/weeklyLint.test.ts`

- [ ] **Step 1: 실패하는 테스트 작성**

`tests/domain/weeklyLint.test.ts` 의 첫 import 줄을 아래로 바꾸고,

```ts
import { normalizeForCompare, lintDuplicates, lintNumbering } from '@/lib/domain/weeklyLint'
```

파일 맨 아래에 추가한다:

```ts
describe('lintNumbering', () => {
  const one = (content: string) => lintNumbering([mkRow('r1', 'PMO', 1, { thisContent: content })])

  it('건너뛴 번호(1,2,4)를 다시 매긴다', () => {
    const out = one('1. 가\n2. 나\n4. 다')
    expect(out).toHaveLength(1)
    expect(out[0].kind).toBe('numbering')
    expect(out[0].rowId).toBe('r1')
    expect(out[0].cellKey).toBe('this_content')
    expect(out[0].edits).toEqual([{ rowId: 'r1', cellKey: 'this_content', content: '1. 가\n2. 나\n3. 다' }])
    expect(out[0].detail).toContain('1, 2, 4')
    expect(out[0].detail).toContain('1, 2, 3')
  })

  it('중복 번호(1,2,2)를 다시 매긴다', () => {
    expect(one('1. 가\n2. 나\n2. 다')[0].edits[0].content).toBe('1. 가\n2. 나\n3. 다')
  })

  it('1이 아닌 시작(2,3,4)을 1부터 다시 매긴다', () => {
    expect(one('2. 가\n3. 나\n4. 다')[0].edits[0].content).toBe('1. 가\n2. 나\n3. 다')
  })

  it('역순(3,2,1)을 순서는 그대로 두고 번호만 다시 매긴다', () => {
    expect(one('3. 가\n2. 나\n1. 다')[0].edits[0].content).toBe('1. 가\n2. 나\n3. 다')
  })

  it('올바른 번호는 지적하지 않는다', () => {
    expect(one('1. 가\n2. 나\n3. 다')).toEqual([])
  })

  it('번호 줄이 1개뿐이면 지적하지 않는다', () => {
    expect(one('1. 가\n나\n다')).toEqual([])
  })

  it('번호가 없으면 지적하지 않는다', () => {
    expect(one('- 가\n- 나')).toEqual([])
  })

  it(') 스타일과 구분자 뒤 공백을 보존한다', () => {
    expect(one('1) 가\n3) 나')[0].edits[0].content).toBe('1) 가\n2) 나')
    expect(one('1.가\n3.나')[0].edits[0].content).toBe('1.가\n2.나')
  })

  it('번호 없는 줄은 순서를 유지하고 번호도 소비하지 않는다', () => {
    expect(one('1. 가\n메모\n3. 나')[0].edits[0].content).toBe('1. 가\n메모\n2. 나')
  })

  it('줄 앞 들여쓰기를 보존한다', () => {
    expect(one('  1. 가\n  3. 나')[0].edits[0].content).toBe('  1. 가\n  2. 나')
  })

  it('4개 열을 모두 검사한다', () => {
    const rows = [mkRow('r1', 'PMO', 1, { nextIssue: '1. 가\n3. 나' })]
    expect(lintNumbering(rows)[0].cellKey).toBe('next_issue')
  })
})
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run tests/domain/weeklyLint.test.ts`
Expected: FAIL — `lintNumbering is not a function`

- [ ] **Step 3: 최소 구현**

`src/lib/domain/weeklyLint.ts` 맨 아래에 추가한다:

```ts
/** 규칙 ② — 셀 안 줄 번호. 번호 줄이 2개 이상일 때만 검사하고, 1부터 1씩 증가하지 않으면 지적. */
export function lintNumbering(rows: WeeklySheetRow[]): LintFinding[] {
  const out: LintFinding[] = []
  for (const cellKey of WEEKLY_CELL_KEYS) {
    for (const row of [...rows].sort((a, b) => a.sortOrder - b.sortOrder)) {
      const content = row[CELL_FIELD[cellKey]]
      const lines = toLines(content)
      const numbered = lines
        .map((line, i) => ({ i, m: NUM_PREFIX.exec(line.trimStart()) }))
        .filter((x): x is { i: number; m: RegExpExecArray } => x.m !== null)
      if (numbered.length < 2) continue

      const nums = numbered.map(x => Number(x.m[1]))
      if (nums.every((n, k) => n === k + 1)) continue

      // 첫 번호 줄의 표기(구분자, 구분자 뒤 공백)를 나머지에 그대로 적용한다.
      const sep = numbered[0].m[2]
      const gap = numbered[0].m[3]
      const next = [...lines]
      numbered.forEach((x, k) => {
        const line = lines[x.i]
        const indent = line.slice(0, line.length - line.trimStart().length)
        const rest = line.trimStart().slice(x.m[0].length)
        next[x.i] = `${indent}${k + 1}${sep}${gap}${rest}`
      })

      out.push({
        id: `numbering:${row.id}:${cellKey}`,
        kind: 'numbering',
        rowId: row.id,
        cellKey,
        title: `${row.section} · ${WEEKLY_CELL_LABEL[cellKey]}`,
        detail: `줄 번호가 ${nums.join(', ')} 입니다 → ${nums.map((_, k) => k + 1).join(', ')}`,
        edits: [{ rowId: row.id, cellKey, content: next.join('\n') }],
      })
    }
  }
  return out
}
```

> 주의: `NUM_PREFIX`에는 `g` 플래그가 없다. `lastIndex`가 남지 않으므로 `exec`를 반복 호출해도 안전하다. 플래그를 추가하지 말 것.

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run tests/domain/weeklyLint.test.ts`
Expected: PASS — 24 tests

- [ ] **Step 5: 커밋**

```bash
git add src/lib/domain/weeklyLint.ts tests/domain/weeklyLint.test.ts
git commit -m "feat(weekly): 점검 규칙 - 셀 안 줄 번호 체번"
```

---

## Task 4: 규칙 ③ 공백·빈줄·글머리 기호 정리

셀 하나당 지적 1건으로 묶는다. 글머리 기호는 시트 전체 다수결로 통일한다.

**Files:**
- Modify: `src/lib/domain/weeklyLint.ts`
- Modify: `tests/domain/weeklyLint.test.ts`

- [ ] **Step 1: 실패하는 테스트 작성**

첫 import 줄을 아래로 바꾸고,

```ts
import { normalizeForCompare, lintDuplicates, lintNumbering, lintFormat } from '@/lib/domain/weeklyLint'
```

파일 맨 아래에 추가한다:

```ts
describe('lintFormat', () => {
  const one = (content: string) => lintFormat([mkRow('r1', 'PMO', 1, { thisContent: content })])
  const fixed = (content: string) => one(content)[0].edits[0].content

  it('줄 끝 공백을 지운다', () => {
    expect(fixed('가  \n나\t')).toBe('가\n나')
  })

  it('줄 안 연속 공백을 1칸으로 접는다', () => {
    expect(fixed('가  나')).toBe('가 나')
  })

  it('들여쓰기는 접지 않는다', () => {
    expect(one('  가')).toEqual([])
  })

  it('전각 공백을 반각으로 바꾼다', () => {
    expect(fixed('가　나')).toBe('가 나')
  })

  it('앞뒤 빈 줄을 지운다', () => {
    expect(fixed('\n\n가\n\n')).toBe('가')
  })

  it('중간 연속 빈 줄을 1줄로 줄인다', () => {
    expect(fixed('가\n\n\n\n나')).toBe('가\n\n나')
  })

  it('고칠 것이 없으면 지적하지 않는다', () => {
    expect(one('가\n\n나')).toEqual([])
  })

  it('글머리 기호를 시트 전체 다수결로 통일한다', () => {
    const rows = [
      mkRow('r1', 'PMO', 1, { thisContent: '- 가\n- 나' }),
      mkRow('r2', '영업', 2, { thisContent: '· 다' }),
    ]
    const out = lintFormat(rows)
    expect(out).toHaveLength(1)
    expect(out[0].rowId).toBe('r2')
    expect(out[0].edits[0].content).toBe('- 다')
    expect(out[0].detail).toContain('글머리 기호')
  })

  it('동수면 - 가 이긴다', () => {
    const rows = [
      mkRow('r1', 'PMO', 1, { thisContent: '· 가' }),
      mkRow('r2', '영업', 2, { thisContent: '- 나' }),
    ]
    expect(lintFormat(rows)[0].edits[0].content).toBe('- 가')
  })

  it('시트 전체에 기호가 한 종류뿐이면 기호는 건드리지 않는다', () => {
    const rows = [mkRow('r1', 'PMO', 1, { thisContent: '· 가\n· 나' })]
    expect(lintFormat(rows)).toEqual([])
  })

  it('기호 뒤에 공백이 없으면 글머리로 보지 않는다', () => {
    const rows = [
      mkRow('r1', 'PMO', 1, { thisContent: '- 가' }),
      mkRow('r2', '영업', 2, { thisContent: '·5% 감소' }),
    ]
    expect(lintFormat(rows)).toEqual([])
  })

  it('셀 하나에 문제가 여러 개여도 지적은 1건', () => {
    const out = one('가  \n\n\n나 ')
    expect(out).toHaveLength(1)
    expect(out[0].kind).toBe('format')
    expect(out[0].edits[0].content).toBe('가\n\n나')
  })
})
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run tests/domain/weeklyLint.test.ts`
Expected: FAIL — `lintFormat is not a function`

- [ ] **Step 3: 최소 구현**

`src/lib/domain/weeklyLint.ts` 맨 아래에 추가한다:

```ts
/** 시트 전체에서 가장 많이 쓰인 글머리 기호. 종류가 하나뿐이면 통일할 것이 없으므로 null. */
function dominantBullet(rows: WeeklySheetRow[]): string | null {
  const count = new Map<string, number>()
  for (const row of rows) {
    for (const cellKey of WEEKLY_CELL_KEYS) {
      for (const line of toLines(row[CELL_FIELD[cellKey]])) {
        const m = BULLET_PREFIX.exec(line.replace(/　/g, ' ').trimStart())
        if (m) count.set(m[1], (count.get(m[1]) ?? 0) + 1)
      }
    }
  }
  if (count.size < 2) return null
  // BULLETS 순서로 훑으며 최대값 — 동수면 먼저 나온 기호(-)가 이긴다.
  let best: string = BULLETS[0]
  let bestN = -1
  for (const b of BULLETS) {
    const n = count.get(b) ?? 0
    if (n > bestN) { best = b; bestN = n }
  }
  return best
}

interface FormatResult { next: string; notes: string[] }

/** 셀 1개의 공백·빈줄·기호 정리. 바뀐 것이 없으면 notes가 빈 배열. */
function formatCell(content: string, bullet: string | null): FormatResult {
  let fullwidth = 0, trailing = 0, multiSpace = 0, bulletFixed = 0, blank = 0

  const cleaned = toLines(content).map(line => {
    let s = line
    if (s.includes('　')) { fullwidth++; s = s.replace(/　/g, ' ') }
    if (/\s+$/.test(s)) { trailing++; s = s.replace(/\s+$/, '') }
    // 들여쓰기(줄 맨 앞 공백)는 보존하려고 앞에 \S를 요구한다.
    const collapsed = s.replace(/(\S) {2,}/g, '$1 ')
    if (collapsed !== s) { multiSpace++; s = collapsed }
    if (bullet) {
      const head = s.trimStart()
      const m = BULLET_PREFIX.exec(head)
      if (m && m[1] !== bullet) {
        bulletFixed++
        s = s.slice(0, s.length - head.length) + bullet + head.slice(1)
      }
    }
    return s
  })

  // 선두/연속 빈 줄 정리 후, 남은 후행 빈 줄 제거.
  const out: string[] = []
  for (const line of cleaned) {
    if (line.trim() === '') {
      if (out.length === 0 || out[out.length - 1].trim() === '') { blank++; continue }
      out.push('')
      continue
    }
    out.push(line)
  }
  while (out.length > 0 && out[out.length - 1].trim() === '') { out.pop(); blank++ }

  const notes: string[] = []
  if (trailing > 0) notes.push(`줄 끝 공백 ${trailing}곳`)
  if (multiSpace > 0) notes.push(`연속 공백 ${multiSpace}곳`)
  if (fullwidth > 0) notes.push(`전각 공백 ${fullwidth}곳`)
  if (blank > 0) notes.push(`빈 줄 ${blank}곳`)
  if (bulletFixed > 0) notes.push(`글머리 기호 → ${bullet}`)

  return { next: out.join('\n'), notes }
}

/** 규칙 ③ — 공백·빈줄·글머리 기호. 셀당 지적 1건. */
export function lintFormat(rows: WeeklySheetRow[]): LintFinding[] {
  const bullet = dominantBullet(rows)
  const out: LintFinding[] = []
  for (const cellKey of WEEKLY_CELL_KEYS) {
    for (const row of [...rows].sort((a, b) => a.sortOrder - b.sortOrder)) {
      const content = row[CELL_FIELD[cellKey]]
      const { next, notes } = formatCell(content, bullet)
      if (next === content || notes.length === 0) continue
      out.push({
        id: `format:${row.id}:${cellKey}`,
        kind: 'format',
        rowId: row.id,
        cellKey,
        title: `${row.section} · ${WEEKLY_CELL_LABEL[cellKey]}`,
        detail: notes.join(', '),
        edits: [{ rowId: row.id, cellKey, content: next }],
      })
    }
  }
  return out
}
```

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run tests/domain/weeklyLint.test.ts`
Expected: PASS — 36 tests

- [ ] **Step 5: 커밋**

```bash
git add src/lib/domain/weeklyLint.ts tests/domain/weeklyLint.test.ts
git commit -m "feat(weekly): 점검 규칙 - 공백·빈줄·글머리 기호 정리"
```

---

## Task 5: 진입점 `lintWeeklySheet`

세 규칙을 합쳐 정렬된 목록으로 내보낸다. 정렬은 `duplicate` → `numbering` → `format`, 각 부류 안에서는 열 순서 다음 행 `sortOrder` 순인데, **세 함수 모두 이미 열 바깥/행 안쪽 순서로 순회하므로 단순 이어붙이기로 충족된다.**

**Files:**
- Modify: `src/lib/domain/weeklyLint.ts`
- Modify: `tests/domain/weeklyLint.test.ts`

- [ ] **Step 1: 실패하는 테스트 작성**

첫 import 줄을 아래로 바꾸고,

```ts
import {
  normalizeForCompare, lintDuplicates, lintNumbering, lintFormat, lintWeeklySheet,
} from '@/lib/domain/weeklyLint'
```

파일 맨 아래에 추가한다:

```ts
describe('lintWeeklySheet', () => {
  it('부류 순서대로 이어붙인다 — 중복 → 체번 → 정리', () => {
    const rows = [
      mkRow('r1', 'PMO', 1, { thisContent: '설계 리뷰 완료', thisIssue: '1. 가\n3. 나' }),
      mkRow('r2', '영업', 2, { thisContent: '설계 리뷰 완료', nextContent: '다  ' }),
    ]
    expect(lintWeeklySheet(rows).map(f => f.kind)).toEqual(['duplicate', 'numbering', 'format'])
  })

  it('id가 서로 겹치지 않는다', () => {
    const rows = [
      mkRow('r1', 'PMO', 1, { thisContent: '가  \n1. 나\n3. 다' }),
      mkRow('r2', '영업', 2, { thisContent: '가' }),
    ]
    const ids = lintWeeklySheet(rows).map(f => f.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('깨끗한 시트는 빈 배열', () => {
    const rows = [
      mkRow('r1', 'PMO', 1, { thisContent: '가\n나' }),
      mkRow('r2', '영업', 2, { thisContent: '다' }),
    ]
    expect(lintWeeklySheet(rows)).toEqual([])
  })

  it('모든 지적의 edits는 비어 있지 않다', () => {
    const rows = [
      mkRow('r1', 'PMO', 1, { thisContent: '가  \n1. 나\n3. 다' }),
      mkRow('r2', '영업', 2, { thisContent: '가' }),
    ]
    for (const f of lintWeeklySheet(rows)) expect(f.edits.length).toBeGreaterThan(0)
  })
})
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run tests/domain/weeklyLint.test.ts`
Expected: FAIL — `lintWeeklySheet is not a function`

- [ ] **Step 3: 최소 구현**

`src/lib/domain/weeklyLint.ts` 맨 아래에 추가한다:

```ts
/** 점검 진입점. 세 규칙의 결과를 부류 순서로 이어붙인다.
 *  각 규칙이 이미 열 바깥/행(sortOrder) 안쪽으로 순회하므로 부류 안 정렬은 그대로 유지된다. */
export function lintWeeklySheet(rows: WeeklySheetRow[]): LintFinding[] {
  return [...lintDuplicates(rows), ...lintNumbering(rows), ...lintFormat(rows)]
}
```

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run tests/domain/weeklyLint.test.ts`
Expected: PASS — 40 tests

- [ ] **Step 5: 전체 테스트·린트 확인**

Run: `npm test && npm run lint`
Expected: 기존 테스트 전부 PASS, 린트 오류 없음

- [ ] **Step 6: 커밋**

```bash
git add src/lib/domain/weeklyLint.ts tests/domain/weeklyLint.test.ts
git commit -m "feat(weekly): 점검 진입점 lintWeeklySheet"
```

---

## Task 6: `useSheetGrid`에 `focusCell` 노출

패널에서 "이 셀로 이동"을 하려면 그리드 선택을 밖에서 옮길 수 있어야 한다. 내부에 이미 있는 `setSingle`을 감싸 노출하는 것뿐이다.

**Files:**
- Modify: `src/components/weekly/useSheetGrid.ts`

- [ ] **Step 1: 인터페이스에 선언 추가**

`SheetGridApi` 인터페이스(약 38행)의 `onFillHandleMouseDown` 선언 **아래**에 한 줄을 추가한다:

```ts
  onFillHandleMouseDown: (e: React.MouseEvent) => void
  /** 그리드 밖(점검 패널 등)에서 특정 셀로 선택·포커스를 옮긴다. 편집 모드로 들어가지는 않는다. */
  focusCell: (addr: CellAddr) => void
```

- [ ] **Step 2: 구현 추가**

`onFillHandleMouseDown`의 `useCallback` 블록(약 291~300행) **바로 아래**에 추가한다:

```ts
  // 그리드 밖에서의 셀 이동 — armed를 세워야 활성 셀 포커스 effect가 동작한다.
  // F7 가드(그리드 밖에 포커스가 있으면 훔치지 않음)를 우회하려고 여기서 직접 focus까지 한다.
  const focusCell = useCallback((addr: CellAddr) => {
    armedRef.current = true
    setSingle(addr, false)
    cellRefs.current.get(keyOf(addr))?.focus()
  }, [setSingle, cellRefs])
```

- [ ] **Step 3: 반환값에 추가**

파일 끝 `return { ... }`(약 460~464행)의 마지막 줄을 아래로 바꾼다:

```ts
    onCellCopy, onCellCut, onCellPaste, onCompositionStart, onCompositionEnd, onFillHandleMouseDown,
    focusCell,
```

- [ ] **Step 4: 타입 검사**

Run: `npx tsc --noEmit`
Expected: 오류 없음

- [ ] **Step 5: 커밋**

```bash
git add src/components/weekly/useSheetGrid.ts
git commit -m "feat(weekly): 그리드 밖에서 셀로 이동하는 focusCell 노출"
```

---

## Task 7: 점검 패널 컴포넌트

기존 `Modal`을 쓰는 표시 전용 컴포넌트. 저장·선택 이동은 전부 콜백으로 부모에 위임한다 — 이 파일은 서버 액션을 알지 못한다.

**Files:**
- Create: `src/components/weekly/WeeklyLintPanel.tsx`

- [ ] **Step 1: 컴포넌트 작성**

`src/components/weekly/WeeklyLintPanel.tsx` 를 새로 만든다:

```tsx
'use client'

import { useMemo } from 'react'
import { Modal } from '@/components/ui/Modal'
import { lintWeeklySheet, type LintFinding, type LintKind } from '@/lib/domain/weeklyLint'
import type { WeeklyCellEdit, WeeklyCellKey, WeeklySheetRow } from '@/lib/domain/weeklySheet'

const KIND_LABEL: Record<LintKind, string> = { duplicate: '중복', numbering: '체번', format: '정리' }
const KIND_TONE: Record<LintKind, string> = {
  duplicate: 'bg-amber-100 text-amber-800',
  numbering: 'bg-amber-100 text-amber-800',
  format: 'bg-sky-100 text-sky-800',
}

/** 주간보고 점검 패널 — 현재 화면의 rows로 지적을 계산해 보여주고, 항목별로 수정을 적용한다.
 *  저장은 부모가 넘긴 onApply(=runBatch)가 담당한다. 이 컴포넌트는 I/O를 하지 않는다. */
export function WeeklyLintPanel({ open, rows, onClose, onApply, onGoToCell }: {
  open: boolean
  rows: WeeklySheetRow[]
  onClose: () => void
  onApply: (edits: WeeklyCellEdit[]) => void
  onGoToCell: (rowId: string, cellKey: WeeklyCellKey) => void
}) {
  // 열려 있는 동안 rows가 바뀔 때마다 재계산 — 적용 직후에도, 타인의 Realtime 수정에도 목록이 따라간다.
  // 10행 × 4열이라 비용은 무시할 만하다. 닫혀 있으면 계산하지 않는다.
  const findings = useMemo(() => (open ? lintWeeklySheet(rows) : []), [open, rows])

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="주간보고 점검"
      eyebrow={findings.length > 0 ? `${findings.length}건` : undefined}
      size="lg"
      footer={<button type="button" className="btn btn-ghost" onClick={onClose}>닫기</button>}
    >
      {findings.length === 0 ? (
        <p className="py-6 text-center text-sm text-ink-muted">점검할 내용이 없습니다.</p>
      ) : (
        <ul className="divide-y divide-line">
          {findings.map(f => (
            <LintRow
              key={f.id}
              finding={f}
              onApply={() => onApply(f.edits)}
              onGo={() => { onClose(); onGoToCell(f.rowId, f.cellKey) }}
            />
          ))}
        </ul>
      )}
    </Modal>
  )
}

function LintRow({ finding, onApply, onGo }: {
  finding: LintFinding; onApply: () => void; onGo: () => void
}) {
  return (
    <li className="flex items-start gap-3 py-3">
      <span className={`mt-0.5 shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ${KIND_TONE[finding.kind]}`}>
        {KIND_LABEL[finding.kind]}
      </span>
      <div className="min-w-0 flex-1">
        {/* 제목 클릭 = 모달 닫고 해당 셀로 이동. 어디를 말하는지 눈으로 확인하고 직접 고칠 수 있게. */}
        <button
          type="button"
          onClick={onGo}
          className="text-left text-sm font-semibold text-ink underline-offset-2 hover:underline"
        >
          {finding.title}
        </button>
        <p className="mt-0.5 whitespace-pre-wrap break-words text-xs text-ink-muted">{finding.detail}</p>
      </div>
      <button type="button" className="btn btn-ghost shrink-0 text-xs" onClick={onApply}>적용</button>
    </li>
  )
}
```

- [ ] **Step 2: 타입 검사**

Run: `npx tsc --noEmit`
Expected: 오류 없음 (아직 아무도 import하지 않지만 컴파일은 되어야 한다)

- [ ] **Step 3: 커밋**

```bash
git add src/components/weekly/WeeklyLintPanel.tsx
git commit -m "feat(weekly): 주간보고 점검 패널 컴포넌트"
```

---

## Task 8: 화면 배선 — 버튼과 패널

**Files:**
- Modify: `src/components/weekly/WeeklySheetView.tsx`

- [ ] **Step 1: import 추가**

`import { useSheetGrid } from './useSheetGrid'`(23행) 아래에 추가한다:

```ts
import { WeeklyLintPanel } from './WeeklyLintPanel'
```

- [ ] **Step 2: 패널 열림 상태 추가**

`const [rows, setRows] = useState<WeeklySheetRow[]>(initialRows)`(64행) 아래에 추가한다:

```ts
  const [lintOpen, setLintOpen] = useState(false)
```

- [ ] **Step 3: `WeekNav` 호출에 콜백 전달**

511행의 `<WeekNav ... />` 를 아래로 바꾼다 (`onLint` 한 개 추가):

```tsx
      <WeekNav projectId={projectId} weekStart={weekStart} weekLabel={weekLabel} exportDisabled={false} onBeforeExport={flushPendingSaves} presence={presenceStrip} onLint={() => setLintOpen(true)} />
```

- [ ] **Step 4: 패널 렌더**

`return (` 블록에서 `<div className="overflow-x-auto">…</div>` 가 닫힌 **직후**, 바깥 `</div>` 앞에 추가한다 (약 623행):

```tsx
      <WeeklyLintPanel
        open={lintOpen}
        rows={rows}
        onClose={() => setLintOpen(false)}
        onApply={edits => runBatch(edits, { undoable: true })}
        onGoToCell={(rowId, col) => grid.focusCell({ rowId, col })}
      />
```

- [ ] **Step 5: `WeekNav`에 prop과 버튼 추가**

`WeekNav` 함수 시그니처(628~632행)를 아래로 바꾼다:

```tsx
function WeekNav({ projectId, weekStart, weekLabel, exportDisabled, onBeforeExport, presence, onLint }: {
  projectId: string; weekStart: string; weekLabel: string; exportDisabled: boolean
  onBeforeExport: () => Promise<boolean>
  presence?: React.ReactNode // 온라인 사용자 스트립(프레즌스) — 내보내기 버튼 왼쪽
  onLint: () => void         // 주간보고 점검 패널 열기
}) {
```

이어서 내보내기 버튼 묶음(648~651행)을 아래로 바꾼다:

```tsx
        <div className="flex items-center gap-2">
          {/* 내보내기 전에 점검하는 순서가 자연스러워 왼쪽에 둔다. */}
          <button type="button" className="btn btn-ghost" onClick={onLint}>주간보고 점검</button>
          <ExportSummaryPptButton projectId={projectId} />
          <ExportPptButton projectId={projectId} weekStart={weekStart} disabled={exportDisabled} onBeforeExport={onBeforeExport} />
        </div>
```

- [ ] **Step 6: 타입 검사·린트·전체 테스트**

Run: `npx tsc --noEmit && npm run lint && npm test`
Expected: 전부 통과

- [ ] **Step 7: 빌드 확인**

Run: `npm run build`
Expected: 빌드 성공

- [ ] **Step 8: 커밋**

```bash
git add src/components/weekly/WeeklySheetView.tsx
git commit -m "feat(weekly): 주간업무 화면에 주간보고 점검 버튼·패널 배선"
```

---

## Task 9: 실제 화면 확인

코드가 붙었다는 것과 동작한다는 것은 다르다. 실행해서 눈으로 확인한다.

**Files:** 없음(확인만)

- [ ] **Step 1: 실행 방법 확인**

이 저장소에는 런타임 확인 절차를 담은 프로젝트 스킬이 있다. 먼저 `verify` 스킬을 실행해 이 샌드박스에서 앱을 어떻게 띄우고 확인하는지 확인한 뒤 그 절차를 따른다.

- [ ] **Step 2: 시나리오 확인**

주간업무 화면에서 아래를 차례로 확인한다.

1. 상단에 `주간보고 점검` 버튼이 PPT 내보내기 왼쪽에 보인다.
2. 서로 다른 두 구분의 `금주실적 내용`에 같은 문장을 넣고 점검 → `중복` 지적이 뜬다.
3. 한 셀에 `1. 가` / `2. 나` / `4. 다` 를 넣고(Alt+Enter) 점검 → `체번` 지적이 뜨고 `1, 2, 4 → 1, 2, 3` 이 보인다.
4. 지적 제목을 클릭 → 모달이 닫히고 해당 셀이 선택된다.
5. `적용` 클릭 → 셀 값이 바뀌고, 모달은 열린 채 그 항목이 목록에서 사라진다.
6. 모달을 닫고 `Ctrl+Z`(Mac은 `⌘Z`) → 적용이 되돌려진다.
7. 지적이 없는 주차에서 점검 → `점검할 내용이 없습니다.` 가 보인다.

- [ ] **Step 3: 결과 보고**

확인한 것과 확인하지 못한 것을 사실대로 적는다. 확인하지 못한 항목이 있으면 그렇다고 말한다.

---

## 완료 조건

- `npm test` 전체 통과 (`tests/domain/weeklyLint.test.ts` 40건 포함)
- `npx tsc --noEmit`, `npm run lint`, `npm run build` 모두 통과
- Task 9의 7개 시나리오 확인 완료
