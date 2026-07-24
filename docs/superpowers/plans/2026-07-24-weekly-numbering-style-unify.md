# 주간보고 점검 번호 표기 통일 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 주간보고 점검의 체번 규칙을 확장해 번호 표기(`1.` vs `1)`, 번호 뒤 공백)를 시트 전체 기준으로 통일하고, 날짜·소수를 목록 번호로 오인하는 잠복 버그를 공유 술어로 함께 고친다.

**Architecture:** `src/lib/domain/weeklyLint.ts` 순수 함수만 변경. 새 술어 `parseListNum`을 다수결 집계·체번 수정·`normalizeForCompare` 세 곳이 공유한다. 새 LintKind 없음 — 기존 `numbering` 지적이 순서+표기를 함께 고친다(셀당 1건, 편집 충돌 원천 차단). UI는 패널 안내 문구 1줄만.

**Tech Stack:** TypeScript, vitest (도메인 단위 테스트), Next.js (변경 없음 — 컴포넌트 문구만)

**Spec:** `docs/superpowers/specs/2026-07-24-weekly-numbering-style-unify-design.md`

## Global Constraints

- 병렬 세션 주의: 메인 저장소에서는 절대 `git add -A`/`git add .` 금지 — 파일을 명시해 add하고 `git commit -- <path>`로 범위를 못박는다. 워크트리 안에서도 파일 명시 add를 유지한다.
- 본문 공백(줄 끝·연속·전각)·빈 줄 검사는 사용자 결정으로 제외 — 이번 변경은 번호 "표기"(선두 접두)만 만진다.
- 지적 id 형식 `numbering:{rowId}:{cellKey}` 유지(안정 키).
- 커밋 메시지 끝: `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`

---

### Task 1: 공유 술어 parseListNum + normalizeForCompare 가드

**Files:**
- Modify: `src/lib/domain/weeklyLint.ts:35-52` (NUM_PREFIX·normalizeForCompare 영역)
- Test: `tests/domain/weeklyLint.test.ts` (`normalizeForCompare`·`lintDuplicates` describe에 추가)

**Interfaces:**
- Produces: `interface ListNum { num: number; sep: '.' | ')'; gap: string; rest: string }`, `function parseListNum(head: string): ListNum | null` (모듈 내부 — export 안 함. Task 2가 그대로 사용)
- `normalizeForCompare(line: string): string` 시그니처 불변, 동작만 보수화

- [ ] **Step 1: 실패하는 테스트 작성** — `tests/domain/weeklyLint.test.ts`의 `describe('normalizeForCompare')` 끝에:

```ts
  it('날짜·소수·절 번호는 목록 번호로 보지 않는다', () => {
    expect(normalizeForCompare('2026.07.24 주간 회의')).toBe('2026.07.24 주간 회의')
    expect(normalizeForCompare('1.5배 성능 개선')).toBe('1.5배 성능 개선')
    expect(normalizeForCompare('1.2 개요 정리')).toBe('1.2 개요 정리')
  })

  it('번호만 있는 줄은 떼지 않는다', () => {
    expect(normalizeForCompare('1.')).toBe('1.')
  })
```

`describe('lintDuplicates')` 끝에:

```ts
  it('소수만 다른 두 줄이 중복으로 붙어 지워지지 않는다', () => {
    const rows = [mkRow('r1', 'PMO', 1, { thisContent: '1.5배 성능 개선\n2.5배 성능 개선' })]
    expect(lintDuplicates(rows)).toEqual([])
  })
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run tests/domain/weeklyLint.test.ts`
Expected: FAIL — `'2026.07.24 주간 회의'`가 `'24 주간 회의'`로, 소수 쌍이 중복 1건으로 나옴

- [ ] **Step 3: 구현** — `weeklyLint.ts`에서 기존 `NUM_PREFIX` 상수(35-36행)를 아래로 교체:

```ts
/** 선두 목록 번호: 숫자 1~2자리 + (. 또는 )) + 공백(반각·탭·전각) 0개 이상. */
const NUM_PREFIX = /^(\d{1,2})([.)])([ \t　]*)/

/** 목록 번호 해석 결과. rest는 표기 뒤 본문 — 빈 문자열이면 애초에 번호 줄이 아니다. */
interface ListNum { num: number; sep: '.' | ')'; gap: string; rest: string }

/** 들여쓰기를 뗀 줄머리에서 목록 번호를 해석한다. 번호 줄이 아니면 null.
 *  `1.` 단독(본문 없음)과 공백 없이 숫자가 이어지는 꼴(`2026.07.24` 날짜, `1.5배` 소수,
 *  `1.2 개요` 절 번호)은 번호 줄이 아니다 — 본문을 번호로 오인해 고쳐 쓰지 않기 위한
 *  보수적 판정. 자리수 상한(2자리)도 같은 목적의 이중 안전장치다.
 *  다수결 집계·체번 수정·중복 비교(normalizeForCompare)가 이 술어 하나를 공유한다 —
 *  갈라지면 "집계엔 세는데 수정에선 빠지는" 어긋남이 생긴다(글머리 기호 규칙에서 배운 것). */
function parseListNum(head: string): ListNum | null {
  const m = NUM_PREFIX.exec(head)
  if (!m) return null
  const rest = head.slice(m[0].length)
  if (rest === '') return null
  if (m[3] === '' && /^\d/.test(rest)) return null
  return { num: Number(m[1]), sep: m[2] as '.' | ')', gap: m[3], rest }
}
```

`normalizeForCompare`(43-52행)의 루프를 술어 기반으로 교체:

```ts
export function normalizeForCompare(line: string): string {
  let s = line.replace(/　/g, ' ').trim()
  // 기호와 번호가 겹쳐 붙은 경우(`- 1. 항목`)까지 커버하되, 무한 반복은 막는다.
  for (let i = 0; i < 2; i++) {
    const ln = parseListNum(s)
    const next = (ln ? ln.rest : s).replace(/^[-·*●] */, '').trimStart()
    if (next === s) break
    s = next
  }
  return s.replace(/\s+/g, ' ').trim()
}
```

이 시점에 `lintNumbering`(329행)의 `NUM_PREFIX.exec(...)` 호출이 새 정규식과 그대로 맞물려 컴파일된다(그룹 구조 동일). 동작 차이(날짜 제외 등)는 Task 2에서 술어로 갈아끼우며 테스트로 못박는다.

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run tests/domain/weeklyLint.test.ts`
Expected: PASS (기존 케이스 포함 전부)

- [ ] **Step 5: 커밋**

```bash
git add src/lib/domain/weeklyLint.ts tests/domain/weeklyLint.test.ts
git commit -m "fix(weekly): 목록 번호 판정 보수화 — 날짜·소수 오인 제거

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>" -- src/lib/domain/weeklyLint.ts tests/domain/weeklyLint.test.ts
```

---

### Task 2: 체번 규칙 확장 — 시트 다수결 표기 + 공백 1칸

**Files:**
- Modify: `src/lib/domain/weeklyLint.ts` (`lintNumbering` 전체 교체 + `dominantNumberSep` 신설)
- Test: `tests/domain/weeklyLint.test.ts` (`describe('lintNumbering')` — 기존 1건 대체 + 신규)

**Interfaces:**
- Consumes: Task 1의 `parseListNum`
- Produces: `lintNumbering(rows: WeeklySheetRow[]): LintFinding[]` 시그니처 불변. detail 문구 3종: `줄 번호가 …`, `번호 표기 → '1.'/'1)' (시트 전체 기준)`, `번호 뒤 공백 → 1칸`

- [ ] **Step 1: 기존 테스트 1건 대체 + 실패하는 테스트 작성** — `') 스타일과 구분자 뒤 공백을 보존한다'` 테스트를 삭제하고 `describe('lintNumbering')`에 추가:

```ts
  it(') 표기가 시트에 유일하면 보존하고, 번호 뒤 공백은 1칸으로 맞춘다', () => {
    expect(one('1) 가\n3) 나')[0].edits[0].content).toBe('1) 가\n2) 나')
    expect(one('1.가\n3.나')[0].edits[0].content).toBe('1. 가\n2. 나')
  })

  it('시트 다수결 표기로 통일한다 — 소수 표기 셀을 지적', () => {
    const rows = [
      mkRow('r1', 'PMO', 1, { thisContent: '1. 가\n2. 나' }),
      mkRow('r2', '영업', 2, { thisContent: '1) 다\n2) 라' }),
      mkRow('r3', '구매', 3, { thisContent: '1. 마' }),
    ]
    const out = lintNumbering(rows)
    expect(out).toHaveLength(1)
    expect(out[0].kind).toBe('numbering')
    expect(out[0].rowId).toBe('r2')
    expect(out[0].edits).toEqual([{ rowId: 'r2', cellKey: 'this_content', content: '1. 다\n2. 라' }])
    expect(out[0].detail).toContain('시트 전체')
  })

  it('동수면 . 이 이긴다 — 번호 줄 1개짜리 셀도 표기가 어긋나면 지적한다', () => {
    const rows = [
      mkRow('r1', 'PMO', 1, { thisContent: '1) 가' }),
      mkRow('r2', '영업', 2, { thisContent: '1. 나' }),
    ]
    const out = lintNumbering(rows)
    expect(out).toHaveLength(1)
    expect(out[0].rowId).toBe('r1')
    expect(out[0].edits[0].content).toBe('1. 가')
  })

  it('시트에 한 표기뿐이면 그 표기를 존중한다', () => {
    const rows = [
      mkRow('r1', 'PMO', 1, { thisContent: '1) 가\n2) 나' }),
      mkRow('r2', '영업', 2, { thisContent: '1) 다' }),
    ]
    expect(lintNumbering(rows)).toEqual([])
  })

  it('번호 뒤 공백을 1칸으로 맞춘다 — 없음·여러 칸·전각', () => {
    const [f] = one('1.가\n2.  나\n3.　다')
    expect(f.edits[0].content).toBe('1. 가\n2. 나\n3. 다')
    expect(f.detail).toContain('공백 → 1칸')
  })

  it('날짜·소수 줄은 고치지도, 다수결에 세지도 않는다', () => {
    const rows = [
      mkRow('r1', 'PMO', 1, { thisContent: '2026.07.24 주간 회의\n1.5배 성능 개선' }),
      mkRow('r2', '영업', 2, { thisContent: '1) 다\n2) 라' }),
    ]
    expect(lintNumbering(rows)).toEqual([])
  })

  it('번호만 있는 줄은 건드리지 않는다', () => {
    expect(one('1.\n2.')).toEqual([])
  })

  it('체번과 표기 통일을 한 지적으로 함께 고친다', () => {
    const rows = [
      mkRow('r1', 'PMO', 1, { thisContent: '1. 가\n2. 나\n3. 다' }),
      mkRow('r2', '영업', 2, { thisContent: '1) 라\n3) 마' }),
    ]
    const out = lintNumbering(rows)
    expect(out).toHaveLength(1)
    expect(out[0].edits[0].content).toBe('1. 라\n2. 마')
    expect(out[0].detail).toContain('1, 3')
    expect(out[0].detail).toContain('번호 표기')
  })

  it('들여쓴 번호 줄도 표기를 맞추고 들여쓰기는 보존한다', () => {
    const rows = [
      mkRow('r1', 'PMO', 1, { thisContent: '1. 가\n2. 나' }),
      mkRow('r2', '영업', 2, { thisContent: '  1) 다' }),
    ]
    expect(lintNumbering(rows)[0].edits[0].content).toBe('  1. 다')
  })
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run tests/domain/weeklyLint.test.ts`
Expected: FAIL — 신규 케이스들(`1.가` 공백 보존 기대였던 대체 케이스 포함)이 떨어짐

- [ ] **Step 3: 구현** — `weeklyLint.ts`의 `lintNumbering`을 아래로 교체(신설 `dominantNumberSep` 포함):

```ts
/** 시트 전체에서 다수결로 정한 번호 구분자. 번호 줄이 없으면 null(규칙 전체 침묵).
 *  보고서 겉모습 문제라 글머리 기호처럼 시트 전체 기준이고, 동수면 . 이 이긴다.
 *  한 종류뿐이어도 그 값을 반환한다 — 그 표기를 존중하되 공백 정규화의 기준으로 쓴다. */
function dominantNumberSep(rows: WeeklySheetRow[]): '.' | ')' | null {
  let dot = 0, paren = 0
  for (const row of rows) {
    for (const cellKey of WEEKLY_CELL_KEYS) {
      for (const line of toLines(row[CELL_FIELD[cellKey]])) {
        const ln = parseListNum(line.trimStart())
        if (!ln) continue
        if (ln.sep === '.') dot++
        else paren++
      }
    }
  }
  if (dot === 0 && paren === 0) return null
  return dot >= paren ? '.' : ')'
}

/** 규칙 ② — 셀 안 줄 번호: 체번 + 표기. 재부여는 기존대로 번호 줄 2개 이상이면서
 *  1..n 이 아닐 때만 하고, 표기(구분자 시트 다수결·번호 뒤 공백 1칸)는 번호 줄 1개부터
 *  맞춘다. 구분자만 시트 전체 기준이다(구분 단위 원칙의 의도된 예외 — 글머리 기호와 동일).
 *  순서와 표기를 한 규칙이 소유해야 같은 줄을 두 지적이 서로 다르게 고치는 충돌이 없다. */
export function lintNumbering(rows: WeeklySheetRow[]): LintFinding[] {
  const sep = dominantNumberSep(rows)
  if (sep === null) return []
  const out: LintFinding[] = []
  for (const { section, rows: group } of bySection(rows)) {
    for (const row of group) {
      for (const cellKey of WEEKLY_CELL_KEYS) {
        const content = row[CELL_FIELD[cellKey]]
        const lines = toLines(content)
        const numbered = lines
          .map((line, i) => ({ i, ln: parseListNum(line.trimStart()) }))
          .filter((x): x is { i: number; ln: ListNum } => x.ln !== null)
        if (numbered.length === 0) continue

        const nums = numbered.map(x => x.ln.num)
        const renumber = numbered.length >= 2 && !nums.every((n, k) => n === k + 1)

        let sepFixed = 0, gapFixed = 0
        const next = [...lines]
        numbered.forEach((x, k) => {
          const line = lines[x.i]
          const indent = line.slice(0, line.length - line.trimStart().length)
          if (x.ln.sep !== sep) sepFixed++
          else if (x.ln.gap !== ' ') gapFixed++
          next[x.i] = `${indent}${renumber ? k + 1 : x.ln.num}${sep} ${x.ln.rest}`
        })
        if (!renumber && sepFixed === 0 && gapFixed === 0) continue

        const notes: string[] = []
        if (renumber) notes.push(`줄 번호가 ${nums.join(', ')} 입니다 → ${nums.map((_, k) => k + 1).join(', ')}`)
        if (sepFixed > 0) notes.push(`번호 표기 → '1${sep}' (시트 전체 기준)`)
        else if (gapFixed > 0) notes.push('번호 뒤 공백 → 1칸')

        out.push({
          id: `numbering:${row.id}:${cellKey}`,
          kind: 'numbering',
          section,
          rowId: row.id,
          cellKey,
          title: WEEKLY_CELL_LABEL[cellKey],
          detail: notes.join(', '),
          edits: [{ rowId: row.id, cellKey, content: next.join('\n') }],
        })
      }
    }
  }
  return out
}
```

주의: 구분자가 바뀌는 줄은 공백도 함께 다시 쓰이므로 `sepFixed`/`gapFixed`는 `if/else if`로 센다 — 표기 노트가 공백 노트를 포괄한다.

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run tests/domain/weeklyLint.test.ts`
Expected: PASS — lintWeeklySheet 통합 케이스(순서·id 유일성) 포함 전부

- [ ] **Step 5: 커밋**

```bash
git add src/lib/domain/weeklyLint.ts tests/domain/weeklyLint.test.ts
git commit -m "feat(weekly): 점검 체번 규칙에 번호 표기 통일 — 시트 다수결 구분자·공백 1칸

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>" -- src/lib/domain/weeklyLint.ts tests/domain/weeklyLint.test.ts
```

---

### Task 3: 안내 문구·주석 정합 + 전체 검증

**Files:**
- Modify: `src/components/weekly/WeeklyLintPanel.tsx:61` (범위 안내 문구)
- Modify: `src/lib/domain/weeklyLint.ts:6` (머리 주석의 예외 서술)

**Interfaces:**
- Consumes: 없음 (문구만)
- Produces: 없음

- [ ] **Step 1: 문구 수정** — `WeeklyLintPanel.tsx` 61행:

```tsx
            점검은 구분 안에서만 합니다 — 서로 다른 구분끼리는 견주지 않습니다. (글머리 기호·번호 표기 통일만 시트 전체 기준)
```

`weeklyLint.ts` 머리 주석 6행:

```ts
 *  (예외: 글머리 기호·번호 표기 통일만 보고서 겉모습 문제라 시트 전체 다수결을 따른다.) ── */
```

- [ ] **Step 2: 전체 검증**

Run: `npx vitest run` → Expected: 전체 스위트 PASS
Run: `npm run lint` → Expected: 에러 0
Run: `npm run build` → Expected: 빌드 성공

- [ ] **Step 3: 커밋**

```bash
git add src/components/weekly/WeeklyLintPanel.tsx src/lib/domain/weeklyLint.ts
git commit -m "docs(weekly): 점검 범위 안내에 번호 표기 예외 반영

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>" -- src/components/weekly/WeeklyLintPanel.tsx src/lib/domain/weeklyLint.ts
```
