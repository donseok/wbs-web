# 주간보고 PPTX 템플릿-필 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 주간보고 PPTX를 사내 D-Cube 템플릿과 디자인 바이트 동일로 생성 — 원본 `.pptx`를 재활용해 slide2 표 셀만 해당 주차 내용으로 교체. 내용은 WBS+회의+공지로 자동 생성.

**Architecture:** 원본 템플릿 zip을 로드 → `ppt/slides/slide2.xml`의 표에서 (a) 날짜 헤더, (b) 전주/금주 내용 셀, (c) 이슈 셀의 `<a:txBody>`만 교체 → 재압축. 셀 서식은 원본 셀에서 추출한 문단/런 스켈레톤을 클론해 원본과 동일하게 유지. 커버·마스터·테마·OLE·폰트는 손대지 않음.

**Tech Stack:** TypeScript, Next.js Route Handler(Node 런타임), jszip(zip 조작), vitest. 순수 XML 문자열 조작(제너릭 XML 파서 미사용 — OOXML 네임스페이스/순서 보존).

**Design spec:** `docs/superpowers/specs/2026-07-08-weekly-report-template-fill-design.md`

---

## File Structure

- **Create** `src/lib/report/assets/weekly-template.pptx` — 원본 템플릿 바이너리(468KB, git 커밋).
- **Create** `src/lib/report/xml.ts` — 순수 OOXML 문자열 헬퍼(`escapeXml`, `mapTableCell`, `extractCellSkeletons`, `buildCellTxBody`, `buildHeaderCellTxBody`). 한 파일 = "slide2 표 XML 조작" 단일 책임.
- **Create** `src/lib/report/templateFill.ts` — `fillWeeklyTemplate(narr, model): Promise<Buffer>` (zip 로드→치환→재압축) + 캡 헬퍼 이전본.
- **Create** `tests/report/xml.test.ts` · `tests/report/templateFill.test.ts`.
- **Modify** `src/lib/report/narrative.ts` — 회의(`body`)·공지 반영해 prev/curr/issues/events 강화.
- **Modify** `src/lib/report/weekly.ts` — 모델에 `announcements` 추가.
- **Modify** `src/app/api/report/route.ts` — 공지 페치 + pptx는 `fillWeeklyTemplate` 호출.
- **Modify** `next.config.ts` — `outputFileTracingIncludes`로 템플릿 번들 포함.
- **Modify** `package.json` — `jszip` 직접 의존성.
- **Remove(정리)** `src/lib/report/pptx.ts` — 캡 헬퍼는 `templateFill.ts`로 이전 후 제거.

## Task Overview

1. 의존성·에셋·번들 설정(jszip, 템플릿 커밋, tracing)
2. `escapeXml` (TDD)
3. `mapTableCell` — [행][열] 셀 txBody 치환 (TDD)
4. `extractCellSkeletons` — 원본 셀에서 문단/런 스켈레톤 추출 (TDD)
5. `buildCellTxBody` / `buildHeaderCellTxBody` — 내러티브→셀 XML (TDD)
6. 캡 헬퍼 이전(`capItems`/`capGroups`/`packGroups`→단일 페이지 캡) (TDD)
7. `fillWeeklyTemplate` — zip 로드→치환→재압축 (통합 TDD)
8. narrative 강화 — 회의·공지 반영 (TDD)
9. route 배선 — 공지 페치 + pptx 경로 교체
10. 구 `pptx.ts` 은퇴 + 정리
11. 최종 검증(test/lint/build + 실제 PPTX 생성·검수)

---

### Task 1: 의존성 · 템플릿 에셋 · 번들 설정

**Files:**
- Create: `src/lib/report/assets/weekly-template.pptx`
- Modify: `package.json`, `next.config.ts`

- [ ] **Step 1: jszip 직접 의존성 추가**

Run: `npm install jszip@^3.10`
Expected: `package.json` dependencies에 `jszip` 추가(이미 pptxgenjs 경유로 트리에 있어 신규 다운로드 최소).

- [ ] **Step 2: 템플릿 바이너리를 에셋으로 복사**

Run:
```bash
mkdir -p src/lib/report/assets
cp "docs/26.07.02. D-Cube 주간보고_부산운영팀_1_2026-07-07_이돈석.pptx" src/lib/report/assets/weekly-template.pptx
ls -l src/lib/report/assets/weekly-template.pptx
```
Expected: ~468KB 파일 생성. (원본은 `docs/`에 그대로 두고 사본을 에셋으로.)

- [ ] **Step 3: 번들 트레이싱 등록**

`next.config.ts`에 `/api/report` 서버 번들이 템플릿을 포함하도록 추가. 기존 `nextConfig` 객체에 병합:
```ts
const nextConfig: NextConfig = {
  // …기존 설정 유지…
  outputFileTracingIncludes: {
    '/api/report': ['./src/lib/report/assets/weekly-template.pptx'],
  },
}
```
(키가 이미 있으면 항목만 추가.)

- [ ] **Step 4: 커밋**

```bash
git add package.json package-lock.json next.config.ts src/lib/report/assets/weekly-template.pptx
git commit -m "chore(report): 주간보고 템플릿 에셋 + jszip 의존성 + 번들 트레이싱"
```

---

### Task 2: `escapeXml` (TDD)

삽입 텍스트의 `&,<,>,"`를 이스케이프. OOXML `<a:t>` 안전.

**Files:**
- Create: `src/lib/report/xml.ts`
- Test: `tests/report/xml.test.ts`

- [ ] **Step 1: 실패 테스트**

```ts
import { describe, it, expect } from 'vitest'
import { escapeXml } from '@/lib/report/xml'

describe('escapeXml', () => {
  it('앰퍼샌드·꺾쇠 이스케이프', () => {
    expect(escapeXml('R&R < > "a"')).toBe('R&amp;R &lt; &gt; &quot;a&quot;')
  })
  it('한글·일반 텍스트는 그대로', () => {
    expect(escapeXml('워크샵 실시 (7/2)')).toBe('워크샵 실시 (7/2)')
  })
})
```

- [ ] **Step 2: 실패 확인** — Run: `npx vitest run tests/report/xml.test.ts` → FAIL(모듈 없음).

- [ ] **Step 3: 구현**

```ts
// src/lib/report/xml.ts
/** OOXML 텍스트 노드용 이스케이프. &는 반드시 먼저. */
export function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}
```

- [ ] **Step 4: 통과 확인** — Run: `npx vitest run tests/report/xml.test.ts` → PASS.

- [ ] **Step 5: 커밋**

```bash
git add src/lib/report/xml.ts tests/report/xml.test.ts
git commit -m "feat(report): escapeXml (OOXML 텍스트 이스케이프, TDD)"
```

---

### Task 3: `mapTableCell` — [행][열] 셀 txBody 치환 (TDD)

slide2에는 표가 하나(`<a:tbl>`). 그 안에서 rowIdx번째 `<a:tr>` → colIdx번째 `<a:tc>`의 `<a:txBody>…</a:txBody>`만 새 값으로 교체하고, `<a:tcPr>`(셀 테두리·여백)와 나머지는 보존. `<a:tr>`·`<a:tc>`는 중첩 없음 → 비탐욕 정규식으로 안전.

**Files:**
- Modify: `src/lib/report/xml.ts`
- Test: `tests/report/xml.test.ts`

- [ ] **Step 1: 실패 테스트**

```ts
import { mapTableCell } from '@/lib/report/xml'

const TBL =
  '<a:tbl><a:tblPr/><a:tblGrid><a:gridCol w="1"/></a:tblGrid>' +
  '<a:tr h="1"><a:tc><a:txBody><a:p>A</a:p></a:txBody><a:tcPr/></a:tc>' +
  '<a:tc><a:txBody><a:p>B</a:p></a:txBody><a:tcPr x="1"/></a:tc></a:tr>' +
  '<a:tr h="2"><a:tc><a:txBody><a:p>C</a:p></a:txBody><a:tcPr/></a:tc></a:tr></a:tbl>'

describe('mapTableCell', () => {
  it('[0][1] 셀의 txBody만 교체하고 tcPr·다른 셀은 보존', () => {
    const out = mapTableCell(TBL, 0, 1, '<a:txBody><a:p>NEW</a:p></a:txBody>')
    expect(out).toContain('<a:tc><a:txBody><a:p>NEW</a:p></a:txBody><a:tcPr x="1"/></a:tc>')
    expect(out).toContain('<a:p>A</a:p>') // [0][0] 불변
    expect(out).toContain('<a:p>C</a:p>') // [1][0] 불변
    expect(out).not.toContain('<a:p>B</a:p>') // 교체됨
  })
  it('행/열 인덱스 벗어나면 원본 그대로', () => {
    expect(mapTableCell(TBL, 9, 0, '<a:txBody/>')).toBe(TBL)
  })
})
```

- [ ] **Step 2: 실패 확인** — Run: `npx vitest run tests/report/xml.test.ts` → FAIL.

- [ ] **Step 3: 구현**

```ts
// src/lib/report/xml.ts 에 추가
const TR_RE = /<a:tr\b[^>]*>[\s\S]*?<\/a:tr>/g
const TC_RE = /<a:tc>[\s\S]*?<\/a:tc>/g
const TXBODY_RE = /<a:txBody>[\s\S]*?<\/a:txBody>/

/** slide2 표에서 [rowIdx][colIdx] 셀의 <a:txBody>를 newTxBody로 교체. 없으면 원본 반환. */
export function mapTableCell(xml: string, rowIdx: number, colIdx: number, newTxBody: string): string {
  const rows = xml.match(TR_RE)
  if (!rows || rowIdx >= rows.length) return xml
  const targetRow = rows[rowIdx]
  const cells = targetRow.match(TC_RE)
  if (!cells || colIdx >= cells.length) return xml
  const newCell = cells[colIdx].replace(TXBODY_RE, newTxBody)
  const newRow = targetRow.replace(cells[colIdx], newCell)
  return xml.replace(targetRow, newRow)
}
```
(주의: `<a:tc>`가 `w=""` 등 속성을 가질 수 있으나 이 템플릿 표의 tc는 속성 없음(`<a:tc>`). 병합셀 `gridSpan/hMerge`가 있는 행2는 Task 7에서 콘텐츠 셀만 대상으로 하므로 안전. TC_RE는 `<a:tc>` 정확 일치만 매칭.)

- [ ] **Step 4: 통과 확인** — Run: `npx vitest run tests/report/xml.test.ts` → PASS.

- [ ] **Step 5: 커밋**

```bash
git add src/lib/report/xml.ts tests/report/xml.test.ts
git commit -m "feat(report): mapTableCell — 표 셀 txBody 치환 (TDD)"
```

> **참고(구현자 확인 필수):** 실제 템플릿의 `<a:tc>`가 속성을 갖는 경우(행2 병합셀 `gridSpan`/`hMerge`)를 위해 `TC_RE`는 속성 허용판 `/<a:tc(?:\s[^>]*)?>[\s\S]*?<\/a:tc>/g` 로 두고, 위 테스트도 속성 있는 tc 케이스를 1건 추가하라. 콘텐츠 셀(행1)의 tc는 속성 없음이 확인됨.

---

### Task 4: `extractCellSkeletons` — 원본 셀에서 서식 스켈레톤 추출 (TDD)

콘텐츠 셀(행1 col2)에서 **두 문단 스켈레톤**을 뽑는다: (a) 불릿+볼드 "제목" 문단(`<a:buChar char="•"/>` 포함), (b) 불릿없음 "상세" 문단(`<a:buNone/>`). 각 스켈레톤 = `{ pPr, rPr }`(첫 런의 `<a:rPr>…</a:rPr>` 통째). 헤더 셀(행0 col2)에서 헤더 스켈레톤도 추출. 원본 서식을 그대로 클론하기 위함.

**Files:**
- Modify: `src/lib/report/xml.ts`
- Test: `tests/report/xml.test.ts`

- [ ] **Step 1: 실패 테스트**

```ts
import { extractCellSkeletons } from '@/lib/report/xml'

// 실제 템플릿 콘텐츠 셀을 축약한 픽스처(제목 문단 + 상세 문단)
const CONTENT_CELL =
  '<a:tc><a:txBody><a:bodyPr/><a:lstStyle/>' +
  '<a:p><a:pPr marL="85725" indent="-85725"><a:buChar char="•"/></a:pPr>' +
  '<a:r><a:rPr sz="1200" b="1"><a:latin typeface="+mn-ea"/></a:rPr><a:t>제목</a:t></a:r></a:p>' +
  '<a:p><a:pPr marL="0" indent="0"><a:buNone/></a:pPr>' +
  '<a:r><a:rPr sz="1200" b="0"><a:latin typeface="+mn-ea"/></a:rPr><a:t>    - 상세</a:t></a:r></a:p>' +
  '</a:txBody><a:tcPr/></a:tc>'

describe('extractCellSkeletons', () => {
  it('제목(불릿)·상세(불릿없음) 문단의 pPr·rPr을 분리 추출', () => {
    const sk = extractCellSkeletons(CONTENT_CELL)
    expect(sk.title.pPr).toContain('<a:buChar char="•"/>')
    expect(sk.title.rPr).toContain('b="1"')
    expect(sk.sub.pPr).toContain('<a:buNone/>')
    expect(sk.sub.rPr).toContain('b="0"')
    expect(sk.bodyPr).toBe('<a:bodyPr/>')
    expect(sk.lstStyle).toBe('<a:lstStyle/>')
  })
})
```

- [ ] **Step 2: 실패 확인** — Run: `npx vitest run tests/report/xml.test.ts` → FAIL.

- [ ] **Step 3: 구현**

```ts
// src/lib/report/xml.ts 에 추가
export interface ParaSkeleton { pPr: string; rPr: string }
export interface CellSkeletons { title: ParaSkeleton; sub: ParaSkeleton; bodyPr: string; lstStyle: string }

const P_RE = /<a:p>([\s\S]*?)<\/a:p>/g
const PPR_RE = /<a:pPr\b[\s\S]*?<\/a:pPr>|<a:pPr\b[^>]*\/>/
const RPR_RE = /<a:rPr\b[\s\S]*?<\/a:rPr>|<a:rPr\b[^>]*\/>/

function paraSkeleton(paraInner: string): ParaSkeleton {
  return { pPr: paraInner.match(PPR_RE)?.[0] ?? '', rPr: paraInner.match(RPR_RE)?.[0] ?? '' }
}

/** 콘텐츠 셀 XML에서 제목(불릿)·상세(불릿없음) 문단 스켈레톤 + bodyPr/lstStyle 추출. */
export function extractCellSkeletons(cellXml: string): CellSkeletons {
  const paras = [...cellXml.matchAll(P_RE)].map(m => m[1])
  const titleInner = paras.find(p => p.includes('<a:buChar')) ?? paras[0] ?? ''
  const subInner = paras.find(p => p.includes('<a:buNone')) ?? paras[1] ?? titleInner
  const bodyPr = cellXml.match(/<a:bodyPr\b[^>]*\/>|<a:bodyPr\b[\s\S]*?<\/a:bodyPr>/)?.[0] ?? '<a:bodyPr/>'
  const lstStyle = cellXml.match(/<a:lstStyle\b[^>]*\/>|<a:lstStyle\b[\s\S]*?<\/a:lstStyle>/)?.[0] ?? '<a:lstStyle/>'
  return { title: paraSkeleton(titleInner), sub: paraSkeleton(subInner), bodyPr, lstStyle }
}
```

- [ ] **Step 4: 통과 확인** — Run: `npx vitest run tests/report/xml.test.ts` → PASS.

- [ ] **Step 5: 커밋**

```bash
git add src/lib/report/xml.ts tests/report/xml.test.ts
git commit -m "feat(report): extractCellSkeletons — 원본 셀 서식 스켈레톤 추출 (TDD)"
```

---

### Task 5: `buildCellTxBody` / `buildHeaderCellTxBody` — 내러티브 → 셀 XML (TDD)

Phase 그룹들을 스켈레톤으로 클론해 셀 `<a:txBody>` 생성. 그룹 `phase`(헤드라인) → 제목 문단(불릿+볼드), 각 `item` → 상세 문단(`- ` 접두). 헤더 셀은 `전주 주요활동 (범위)` 단일 런.

**Files:**
- Modify: `src/lib/report/xml.ts`
- Test: `tests/report/xml.test.ts`

- [ ] **Step 1: 실패 테스트**

```ts
import { buildCellTxBody, buildHeaderCellTxBody, type CellSkeletons } from '@/lib/report/xml'

const SK: CellSkeletons = {
  title: { pPr: '<a:pPr><a:buChar char="•"/></a:pPr>', rPr: '<a:rPr sz="1200" b="1"/>' },
  sub: { pPr: '<a:pPr><a:buNone/></a:pPr>', rPr: '<a:rPr sz="1200" b="0"/>' },
  bodyPr: '<a:bodyPr/>', lstStyle: '<a:lstStyle/>',
}

describe('buildCellTxBody', () => {
  it('그룹→제목 문단 + 항목→상세 문단, 이스케이프 적용', () => {
    const xml = buildCellTxBody([{ phase: '설계 & 계획', num: 1, items: ['R&R 확정', '일정 공유'] }], SK)
    expect(xml.startsWith('<a:txBody><a:bodyPr/><a:lstStyle/>')).toBe(true)
    expect(xml).toContain('<a:buChar char="•"/>')            // 제목 문단 서식
    expect(xml).toContain('<a:t>설계 &amp; 계획</a:t>')       // 헤드라인+이스케이프
    expect(xml).toContain('<a:buNone/>')                      // 상세 문단 서식
    expect(xml).toContain('<a:t>- R&amp;R 확정</a:t>')        // 상세 접두 '- '
    expect(xml.endsWith('</a:txBody>')).toBe(true)
  })
  it('빈 그룹 → (해당 없음) 한 줄', () => {
    const xml = buildCellTxBody([], SK)
    expect(xml).toContain('<a:t>(해당 없음)</a:t>')
  })
})

describe('buildHeaderCellTxBody', () => {
  it('라벨 + 날짜범위 단일 런', () => {
    const xml = buildHeaderCellTxBody('전주 주요활동', '6/29~7/3', {
      pPr: '<a:pPr algn="ctr"/>', rPr: '<a:rPr sz="1400"/>', bodyPr: '<a:bodyPr/>', lstStyle: '<a:lstStyle/>',
    })
    expect(xml).toContain('<a:t>전주 주요활동 (6/29~7/3)</a:t>')
    expect(xml).toContain('algn="ctr"')
  })
})
```

- [ ] **Step 2: 실패 확인** — Run: `npx vitest run tests/report/xml.test.ts` → FAIL.

- [ ] **Step 3: 구현**

```ts
// src/lib/report/xml.ts 에 추가
import type { NarrativeGroup } from './narrative'

const para = (pPr: string, rPr: string, text: string) =>
  `<a:p>${pPr}<a:r>${rPr}<a:t>${escapeXml(text)}</a:t></a:r></a:p>`

/** Phase 그룹들 → 콘텐츠 셀 <a:txBody>. title=불릿+볼드 헤드라인, sub='- '상세. */
export function buildCellTxBody(groups: NarrativeGroup[], sk: CellSkeletons): string {
  const body: string[] = []
  if (!groups.length) {
    body.push(para(sk.sub.pPr, sk.sub.rPr, '(해당 없음)'))
  } else {
    for (const g of groups) {
      body.push(para(sk.title.pPr, sk.title.rPr, g.phase))
      for (const it of g.items) body.push(para(sk.sub.pPr, sk.sub.rPr, `- ${it}`))
    }
  }
  return `<a:txBody>${sk.bodyPr}${sk.lstStyle}${body.join('')}</a:txBody>`
}

/** 헤더 셀 <a:txBody> — '라벨 (범위)' 단일 런. */
export function buildHeaderCellTxBody(
  label: string, range: string,
  sk: { pPr: string; rPr: string; bodyPr: string; lstStyle: string },
): string {
  return `<a:txBody>${sk.bodyPr}${sk.lstStyle}${para(sk.pPr, sk.rPr, `${label} (${range})`)}</a:txBody>`
}
```

- [ ] **Step 4: 통과 확인** — Run: `npx vitest run tests/report/xml.test.ts` → PASS.

- [ ] **Step 5: 커밋**

```bash
git add src/lib/report/xml.ts tests/report/xml.test.ts
git commit -m "feat(report): buildCellTxBody/buildHeaderCellTxBody — 내러티브→셀 XML (TDD)"
```

---

### Task 6: 캡 헬퍼 이전 — 단일 페이지 캡 (TDD)

셀 높이 고정이므로 페이지 분할 없이 **한 셀에 들어갈 만큼만** 캡. 구 `pptx.ts`의 `capItems`/`capGroups` 순수 로직을 `templateFill.ts`로 이전(페이지 분할 `packGroups`는 불필요 — 제외). `capGroups`로 그룹당 항목 캡 + 전체 그룹의 총 줄수를 예산으로 캡.

**Files:**
- Create: `src/lib/report/templateFill.ts`
- Test: `tests/report/templateFill.test.ts`

- [ ] **Step 1: 실패 테스트**

```ts
import { describe, it, expect } from 'vitest'
import { capItems, capGroupsToBudget } from '@/lib/report/templateFill'

describe('capItems', () => {
  it('max 이하는 그대로', () => expect(capItems(['a', 'b'], 3)).toEqual(['a', 'b']))
  it('초과분은 마지막을 "외 N건"으로', () =>
    expect(capItems(['a', 'b', 'c', 'd'], 3)).toEqual(['a', 'b', '외 2건']))
})

describe('capGroupsToBudget', () => {
  it('총 줄수(헤더1+항목)가 예산 이내가 되도록 그룹별 항목 캡', () => {
    const groups = [
      { phase: 'P1', num: 1, items: ['a', 'b', 'c', 'd', 'e'] },
      { phase: 'P2', num: 2, items: ['x', 'y', 'z'] },
    ]
    const out = capGroupsToBudget(groups, 8) // 헤더2 + 항목6 = 8줄
    const lines = out.reduce((s, g) => s + 1 + g.items.length, 0)
    expect(lines).toBeLessThanOrEqual(8)
    expect(out).toHaveLength(2) // 그룹은 보존
  })
})
```

- [ ] **Step 2: 실패 확인** — Run: `npx vitest run tests/report/templateFill.test.ts` → FAIL.

- [ ] **Step 3: 구현**

```ts
// src/lib/report/templateFill.ts
import type { NarrativeGroup } from './narrative'

/** 항목 목록을 max개로 제한(초과분은 '외 N건'). */
export function capItems(items: string[], max: number): string[] {
  if (items.length <= max) return items
  return [...items.slice(0, max - 1), `외 ${items.length - (max - 1)}건`]
}

/** 그룹들의 총 줄수(그룹당 헤더1 + 항목수)가 budget 이내가 되도록 그룹별 항목을 균등 캡.
 *  그룹 수는 보존. 헤더만으로 예산 초과면 각 그룹 항목 0으로. */
export function capGroupsToBudget(groups: NarrativeGroup[], budget: number): NarrativeGroup[] {
  if (!groups.length) return groups
  const headerLines = groups.length
  const itemBudget = Math.max(0, budget - headerLines)
  const perGroup = Math.max(0, Math.floor(itemBudget / groups.length))
  return groups.map(g => ({ phase: g.phase, num: g.num, items: capItems(g.items, perGroup || 1).slice(0, perGroup) }))
}
```

- [ ] **Step 4: 통과 확인** — Run: `npx vitest run tests/report/templateFill.test.ts` → PASS.

- [ ] **Step 5: 커밋**

```bash
git add src/lib/report/templateFill.ts tests/report/templateFill.test.ts
git commit -m "feat(report): 캡 헬퍼 이전 — 단일 페이지 셀 캡 (TDD)"
```

---

### Task 7: `fillWeeklyTemplate` — zip 로드→치환→재압축 (통합 TDD)

템플릿 zip을 로드해 slide2 표를 채우고 nodebuffer 반환. 치환 대상:
- 행0 col1(전주 헤더)·col2(금주 헤더) ← 날짜 범위
- 행1 col1(전주)·col2(금주) ← 내용
- 행2 col2(이슈)·col1?(이벤트) ← 이슈/이벤트 (실제 병합 구조는 구현자가 slide2.xml 재확인 후 col 인덱스 확정 — 아래 주석)

> **구현자 확인:** 표는 3열(구분/전주/금주). 위 "col1/col2"는 **전주=열1, 금주=열2**(0-based). 행2(이슈)의 실제 셀 병합(`gridSpan`/`hMerge`)을 slide2.xml에서 재확인해, 이슈 텍스트가 들어갈 실제 tc 인덱스를 확정하라. 병합으로 tc 수가 3 미만이면 인덱스를 보정.

**Files:**
- Modify: `src/lib/report/templateFill.ts`
- Test: `tests/report/templateFill.test.ts`

- [ ] **Step 1: 실패 테스트(통합 — 실제 템플릿 에셋 사용)**

```ts
import JSZip from 'jszip'
import { fillWeeklyTemplate } from '@/lib/report/templateFill'
import type { NarrativeModel } from '@/lib/report/narrative'
import type { WeeklyReportModel } from '@/lib/report/weekly'

const narr: NarrativeModel = {
  prev: [{ phase: '설계', num: 1, items: ['R&R 확정'] }],
  curr: [{ phase: '구축', num: 1, items: ['MDM 표준화'] }],
  issues: ['샘플 이슈'], events: ['Kick-Off (7/10)'],
}
const model = { meta: { prevWeekRange: '6/29~7/3', weekRange: '7/6~7/10' } } as WeeklyReportModel

describe('fillWeeklyTemplate (통합)', () => {
  it('산출 zip의 slide2에 주차 내용이 반영되고, 표 외 파트는 원본과 동일', async () => {
    const buf = await fillWeeklyTemplate(narr, model)
    const zip = await JSZip.loadAsync(buf)
    const slide2 = await zip.file('ppt/slides/slide2.xml')!.async('string')
    expect(slide2).toContain('7/6~7/10')          // 날짜 헤더
    expect(slide2).toContain('MDM 표준화')          // 금주 내용
    expect(slide2).toContain('R&amp;R 확정')        // 전주 내용(이스케이프)
    // 표 외 파트 불변: slide1, theme1 원본과 바이트 동일
    const tmpl = await JSZip.loadAsync(await import('node:fs/promises').then(fs =>
      fs.readFile('src/lib/report/assets/weekly-template.pptx')))
    for (const p of ['ppt/slides/slide1.xml', 'ppt/theme/theme1.xml']) {
      expect(await zip.file(p)!.async('string')).toBe(await tmpl.file(p)!.async('string'))
    }
  })
})
```

- [ ] **Step 2: 실패 확인** — Run: `npx vitest run tests/report/templateFill.test.ts` → FAIL.

- [ ] **Step 3: 구현**

```ts
// src/lib/report/templateFill.ts 에 추가
import JSZip from 'jszip'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { mapTableCell, extractCellSkeletons, buildCellTxBody, buildHeaderCellTxBody, type CellSkeletons } from './xml'
import type { NarrativeModel } from './narrative'
import type { WeeklyReportModel } from './weekly'

const TEMPLATE_PATH = join(process.cwd(), 'src/lib/report/assets/weekly-template.pptx')
const CELL_BUDGET = 15   // 콘텐츠 셀(행1) 한 칸의 최대 줄수(높이 3.26"에 맞춘 예산)
const ISSUE_CAP = 3, EVENT_CAP = 4

/** 콘텐츠 셀에서 표의 각 tr/tc를 파싱해 [행][열] 스켈레톤 원천 셀 XML을 얻는다. */
function cellAt(slideXml: string, r: number, c: number): string {
  const rows = slideXml.match(/<a:tr\b[^>]*>[\s\S]*?<\/a:tr>/g) ?? []
  const cells = rows[r]?.match(/<a:tc(?:\s[^>]*)?>[\s\S]*?<\/a:tc>/g) ?? []
  return cells[c] ?? ''
}

/** 주간 내러티브 → 템플릿 디자인 그대로의 PPTX(nodebuffer). */
export async function fillWeeklyTemplate(narr: NarrativeModel, model: WeeklyReportModel): Promise<Buffer> {
  const zip = await JSZip.loadAsync(await readFile(TEMPLATE_PATH))
  let slide2 = await zip.file('ppt/slides/slide2.xml')!.async('string')

  // 콘텐츠 셀(행1, 전주=열1) 서식 스켈레톤 추출
  const sk: CellSkeletons = extractCellSkeletons(cellAt(slide2, 1, 1))
  // 헤더 셀(행0, 전주=열1) 스켈레톤
  const hdrCell = cellAt(slide2, 0, 1)
  const hdrSk = {
    pPr: hdrCell.match(/<a:pPr\b[\s\S]*?<\/a:pPr>/)?.[0] ?? '',
    rPr: hdrCell.match(/<a:rPr\b[\s\S]*?<\/a:rPr>/)?.[0] ?? '',
    bodyPr: '<a:bodyPr/>', lstStyle: '<a:lstStyle/>',
  }

  const prev = capGroupsToBudget(narr.prev, CELL_BUDGET)
  const curr = capGroupsToBudget(narr.curr, CELL_BUDGET)
  const issues = capItems(narr.issues.length ? narr.issues : ['특이 이슈 없음'], ISSUE_CAP)
  const events = capItems(narr.events.length ? narr.events : ['예정된 주요 이벤트 없음'], EVENT_CAP)
  const issueGroups = [{ phase: '이슈', num: 1, items: issues }, { phase: '주요 이벤트', num: 2, items: events }]

  // 순서: 나중 인덱스가 앞 치환에 영향받지 않도록 각 치환은 독립(mapTableCell은 전체 xml 재매칭)
  slide2 = mapTableCell(slide2, 0, 1, buildHeaderCellTxBody('전주 주요활동', model.meta.prevWeekRange, hdrSk))
  slide2 = mapTableCell(slide2, 0, 2, buildHeaderCellTxBody('금주 주요활동', model.meta.weekRange, hdrSk))
  slide2 = mapTableCell(slide2, 1, 1, buildCellTxBody(prev, sk))
  slide2 = mapTableCell(slide2, 1, 2, buildCellTxBody(curr, sk))
  slide2 = mapTableCell(slide2, 2, 2, buildCellTxBody(issueGroups, sk)) // 이슈/이벤트 셀(구현자: 실제 인덱스 확정)

  zip.file('ppt/slides/slide2.xml', slide2)
  return (await zip.generateAsync({ type: 'nodebuffer' })) as Buffer
}
```

> **주의:** `mapTableCell`을 연속 호출할 때, 각 호출이 전체 `slide2`를 다시 매칭하므로 이전 치환이 다음 매칭의 인덱스에 영향을 주지 않는다(행/열 위치는 불변). 단 헤더 두 셀을 먼저, 그다음 내용 셀 순으로 처리해도 무방.

- [ ] **Step 4: 통과 확인** — Run: `npx vitest run tests/report/templateFill.test.ts` → PASS.

- [ ] **Step 5: 커밋**

```bash
git add src/lib/report/templateFill.ts tests/report/templateFill.test.ts
git commit -m "feat(report): fillWeeklyTemplate — 템플릿 zip 셀 치환 렌더러 (통합 TDD)"
```

---

### Task 8: narrative 강화 — 회의·공지 반영 (TDD)

`buildWeeklyNarrative(model)`가 WBS 외에 **해당 주차 회의(meetings.body)·공지**를 전주/금주 활동과 이벤트에 반영하도록 확장.

**Files:**
- Modify: `src/lib/report/weekly.ts` (모델에 `announcements` 추가), `src/lib/report/narrative.ts`
- Test: `tests/report/narrative.test.ts` (기존 파일에 케이스 추가)

- [ ] **Step 1: 현재 코드 확인** — 구현자는 `src/lib/report/narrative.ts`의 `buildWeeklyNarrative`와 `WeeklyReportModel`(weekly.ts) 구조, 회의/공지 타입(`Meeting`,`Announcement`), 주차 범위(`meta.weekStart/weekEnd` 등 내부 필드)를 읽는다. 회의는 `model.meetings`에 이미 있음(route가 페치). 공지는 이번 태스크에서 모델에 추가.

- [ ] **Step 2: 실패 테스트(추가 케이스)**

```ts
// tests/report/narrative.test.ts 에 추가 (기존 헬퍼 phase/node/project 재사용)
it('금주 회의 body가 있으면 금주 활동에 회의 그룹으로 반영', () => {
  const model = buildWeeklyReportModel(twoPhaseItems, project, '2026-07-07', {
    members: [], attendance: [], generatedAt: '2026-07-07 09:00',
    meetings: [{ /* 금주(7/6~7/12) 회의 */ id:'m1', title:'킥오프', meetingDate:'2026-07-10',
      body:'참석자: TF 팀원\n- 목적 공유\n- 일정 확정', /* …필수필드… */ } as any],
    meetingExceptions: [], announcements: [],
  })
  const n = buildWeeklyNarrative(model)
  const flat = n.curr.flatMap(g => [g.phase, ...g.items]).join(' ')
  expect(flat).toContain('킥오프')
  expect(flat).toMatch(/목적 공유|일정 확정/)
})

it('회의·공지 없으면 WBS만으로 채우고 깨지지 않음', () => {
  const model = buildWeeklyReportModel(twoPhaseItems, project, '2026-07-07', {
    members: [], attendance: [], generatedAt: '2026-07-07 09:00',
    meetings: [], meetingExceptions: [], announcements: [],
  })
  const n = buildWeeklyNarrative(model)
  expect(Array.isArray(n.prev) && Array.isArray(n.curr)).toBe(true)
})
```

- [ ] **Step 3: 실패 확인** — Run: `npx vitest run tests/report/narrative.test.ts` → FAIL(announcements 필드/회의 반영 없음).

- [ ] **Step 4: 구현**
  1. `weekly.ts`: `WeeklyReportModel`에 `announcements: Announcement[]` 추가, `buildWeeklyReportModel`의 옵션에 `announcements` 받아 채움(주차 범위로 필터한 것 or 전체—narrative에서 필터).
  2. `narrative.ts`: 주차 범위(weekStart/weekEnd, prevStart/prevEnd) 계산은 기존 로직 재사용. 새 헬퍼:
     - `meetingsToGroup(meetings, from, to)`: 범위 내 회의를 `NarrativeGroup`(phase='회의', items=[`${title} (${md})`, ...body에서 뽑은 핵심 줄])으로. `body`는 줄 단위 split→공백/불릿 정리, 상위 N줄만.
     - `announcementsToItems(anns, from, to)`: 범위 내 게시 공지 제목을 활동/이벤트에 반영.
     - `curr`/`prev`에 회의 그룹을 **WBS 그룹 뒤에 append**. `events`에 다가오는 회의(금주 이후 마일스톤/회의) 추가.
  3. 회의/공지 0건이면 기존 WBS-only 동작 유지(폴백).

- [ ] **Step 5: 통과 확인** — Run: `npx vitest run tests/report/narrative.test.ts` → PASS(신규+기존 전부).

- [ ] **Step 6: 커밋**

```bash
git add src/lib/report/narrative.ts src/lib/report/weekly.ts tests/report/narrative.test.ts
git commit -m "feat(report): narrative에 회의(body)·공지 반영 (TDD)"
```

---

### Task 9: route 배선 — 공지 페치 + pptx 경로 교체

**Files:**
- Modify: `src/app/api/report/route.ts`

- [ ] **Step 1: 공지 페치 추가 + 모델 전달 + pptx 렌더 교체**

```ts
// import 추가
import { getAnnouncements } from '@/lib/data/announcements'
import { fillWeeklyTemplate } from '@/lib/report/templateFill'
import { buildWeeklyNarrative } from '@/lib/report/narrative'
// (buildReportDeck import 제거)

// Promise.all에 공지 추가
const [{ items, today }, projects, members, attendance, meetingData, announcements] = await Promise.all([
  getComputedWbs(projectId), listProjects(), getProjectMembers(projectId), getAttendanceRecords(projectId),
  getProjectMeetingData(projectId), getAnnouncements(projectId),
])

// 모델에 announcements 전달
const model = buildWeeklyReportModel(items, project, today, {
  members, attendance, generatedAt: seoulNow(),
  meetings: meetingData.meetings, meetingExceptions: meetingData.exceptions, announcements,
})

// 렌더 분기 교체
const body = format === 'xlsx'
  ? await buildReportWorkbook(model)
  : await fillWeeklyTemplate(buildWeeklyNarrative(model), model)
```

- [ ] **Step 2: 타입·빌드 확인** — Run: `npx tsc --noEmit` → PASS.

- [ ] **Step 3: 커밋**

```bash
git add src/app/api/report/route.ts
git commit -m "feat(report): route에 공지 페치 + pptx를 템플릿-필로 교체"
```

---

### Task 10: 구 `pptx.ts` 은퇴 + 정리

**Files:**
- Remove: `src/lib/report/pptx.ts`, `tests/report/pptx-unit.test.ts`(구 생성기 대상), `src/lib/report/assets/reportImages.ts`(pptx 전용 미사용 시)
- Modify: `src/lib/report/dkbrand.ts`(pptx 전용 `PN` 미사용 시 정리)

- [ ] **Step 1: 미사용 확인** — `grep -rn "from './pptx'\|buildReportDeck\|reportImages\|\\bPN\\b" src` 로 참조 0 확인(route는 Task 9에서 교체됨). Excel 경로가 `PN`/`PX`를 쓰는지 확인 — `PX`(엑셀)는 유지, `PN`(ppt)만 미사용이면 제거.
- [ ] **Step 2: 삭제/정리** — 참조 없는 파일·export 제거. 캡 헬퍼는 이미 Task 6에서 `templateFill.ts`로 이전됨.
- [ ] **Step 3: 검증** — Run: `npx tsc --noEmit && npx vitest run` → PASS(끊긴 import 없음).
- [ ] **Step 4: 커밋**

```bash
git add -A src/lib/report tests/report
git commit -m "refactor(report): 구 pptxgenjs 생성기 은퇴 + 미사용 에셋/토큰 정리"
```

---

### Task 11: 최종 검증

**Files:** (없음 — 검증)

- [ ] **Step 1: 전체 테스트** — Run: `npx vitest run` → 전 스위트 PASS.
- [ ] **Step 2: 타입·린트·빌드** — Run: `npx tsc --noEmit && npm run lint && npm run build` → 에러 0. `/api/report`가 nodejs 런타임으로 빌드되고 템플릿이 번들에 포함(outputFileTracingIncludes)됨을 확인.
- [ ] **Step 3: 실제 PPTX 생성·검수** — 로컬 dev에서 `/api/report?projectId=<id>&format=pptx`로 내려받아 PowerPoint로 연다. 확인:
  - slide1(커버)·OLE·로고·폰트·색이 원본 템플릿과 **육안 동일**.
  - slide2 표: 날짜 헤더가 해당 주차, 전주/금주 셀에 자동 생성 내용(회의·공지 포함), 이슈 셀 반영. 서식(본고딕·불릿·색)이 원본과 동일.
  - 원본 템플릿 파일과 나란히 열어 슬라이드 마스터/여백/표 테두리 대조.
- [ ] **Step 4: 산출물 vs 템플릿 비표(非表) 파트 동일성 스크립트 확인**(선택) — 생성 zip과 템플릿 zip에서 `ppt/slides/slide1.xml`, `ppt/theme/*`, `ppt/media/*`가 바이트 동일한지 diff.

---

## 완료 기준
- `xml.ts`·`templateFill.ts` 순수 함수 전부 테스트 green(이스케이프·셀 치환·스켈레톤·캡).
- `fillWeeklyTemplate` 산출 PPTX가 slide2 표만 주차 내용으로 바뀌고 **표 외 파트는 원본과 바이트 동일**.
- 실제 PowerPoint에서 원본 템플릿과 디자인 육안 동일, 내용은 WBS+회의+공지 자동.
- tsc/lint/build 통과, 구 생성기 은퇴로 끊긴 참조 없음.
