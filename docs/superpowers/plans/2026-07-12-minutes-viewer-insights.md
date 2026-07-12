# 회의록 뷰어 인사이트 (AI 마킹 + 하이라이트 공유 + 목차) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `/minutes/[id]` 뷰어에 ① AI 블록 분류(결정/액션/기한/리스크) 요약 카드 + 인라인 마킹, ② 블록 단위 하이라이트 실명 공유, ③ 헤딩 목차 내비게이션을 추가한다.

**Architecture:** 서버·클라이언트가 동일한 remark 파이프라인(`splitMinuteBlocks`)으로 mdast 루트 블록(인덱스 + FNV-1a 해시)을 얻고, remark 플러그인이 렌더 DOM에 `data-*` 속성을 스탬프한다. 하이라이트는 `minute_highlights`(RLS 본인 쓰기), AI 분류는 `minute_insights`(service_role 전용 쓰기, 업로드 after() 훅 + 열람 self-heal)에 저장. 표시 전 (인덱스, 해시) 이중 검증으로 본문 교체 시 오표시를 구조적으로 차단한다.

**Tech Stack:** Next.js 15 App Router, Supabase(RLS + service_role), react-markdown@10 + remark-gfm, unified/remark-parse/mdast-util-to-string(기설치 transitive → 명시 승격), 무료 Gemini 체인(`generateAnswer`), vitest.

**Spec:** `docs/superpowers/specs/2026-07-12-minutes-viewer-insights-design.md` (모든 태스크는 이 스펙을 따른다)

## Global Constraints

- **스탬프는 data-\* 속성 전용** — hProperties에 `className`을 넣으면 code 블록의 `language-*`가 파괴됨(mdast-util-to-hast의 applyData가 Object.assign으로 대체). CSS는 속성 선택자.
- 블록 인덱스는 **mdast 루트 children 순번** — hast 레벨에서 세지 않는다(`\n` 텍스트 노드 삽입 함정).
- BigInt 리터럴(`0x…n`) 금지 — tsconfig target ES2017. `BigInt('0x…')` 생성자 + `BigInt.asUintN(64, …)` 사용.
- LLM label·하이라이트 발췌는 **React 순수 텍스트 노드로만 렌더** (마크다운 해석·링크화·dangerouslySetInnerHTML 금지 — 프롬프트 인젝션 차단).
- RLS 헬퍼는 `app_role()` — `current_role()` 금지. 마이그레이션은 멱등(if not exists / drop policy if exists).
- 서버 액션 반환은 `{ ok, error?, ... }`, 에러 문자열은 한국어 하드코딩(기존 관례). UI 문자열은 i18n ko/en **동시** 추가(패리티 타입 강제 — ko만 추가하면 빌드 실패).
- AI 유틸(`minutes-insights.ts`)은 **절대 throw 금지** — 실패는 `console.error` 로그만.
- `git add`는 **파일 명시** (병렬 세션 — 워킹트리에 무관한 report/excel 수정 존재). `git add -A` 절대 금지.
- 검증 명령: `npx vitest run tests/minutes` / `npm run lint` / `npm run build`. 브라우저로 dev 서버 접근 불가 환경.
- 마이그레이션 프로덕션 적용은 코드 배포보다 먼저, Supabase Management API 경유(`supabase db push` 금지) — 사람(사용자)이 개입하는 단계로 Task 14에 명시.

---

### Task 1: 공유 블록 모듈 `blocks.ts` — splitMinuteBlocks + fnv1a64

**Files:**
- Modify: `package.json` (dependencies에 3개 명시)
- Create: `src/lib/minutes/blocks.ts`
- Test: `tests/minutes/blocks.test.ts`

**Interfaces:**
- Produces (이후 전 태스크가 사용):
  ```ts
  export type InsightKind = 'decision' | 'action' | 'deadline' | 'risk'
  export interface MinuteBlock { index: number; hash: string; text: string; rendered: boolean; headingDepth?: number }
  export function splitMinuteBlocks(bodyMd: string): MinuteBlock[]
  export function fnv1a64(text: string): string          // 16자리 hex
  export function isMarkableBlock(b: MinuteBlock): boolean // rendered && text !== ''
  ```

- [ ] **Step 1: package.json에 transitive 의존성 명시** (신규 설치 없음 — lockfile 정합만)

`package.json`의 dependencies에 3줄 추가 (알파벳 순서 유지):

```json
    "mdast-util-to-string": "^4.0.0",
    "mermaid": "^11.16.0",
```
`mermaid` 앞에 `mdast-util-to-string` 삽입, `react-markdown` 앞에 `remark-parse` 삽입, `remark-gfm` 뒤에 `unified` 계열 순서로:

```json
  "dependencies": {
    "@supabase/ssr": "^0.12.0",
    "@supabase/supabase-js": "^2.108.2",
    "exceljs": "^4.4.0",
    "jszip": "^3.10.1",
    "lucide-react": "^1.22.0",
    "mdast-util-to-string": "^4.0.0",
    "mermaid": "^11.16.0",
    "next": "15.5.19",
    "react": "19.1.0",
    "react-dom": "19.1.0",
    "react-markdown": "^10.1.0",
    "remark-gfm": "^4.0.1",
    "remark-parse": "^11.0.0",
    "unified": "^11.0.5",
    "xlsx": "^0.18.5"
  },
```

Run: `npm install`
Expected: lockfile만 갱신(이미 설치된 버전과 동일), `node_modules` 변화 없음에 가까움.

- [ ] **Step 2: 실패하는 테스트 작성** — `tests/minutes/blocks.test.ts`

```ts
import { describe, it, expect } from 'vitest'
import { splitMinuteBlocks, fnv1a64, isMarkableBlock } from '@/lib/minutes/blocks'

describe('fnv1a64', () => {
  it('결정적이며 16자리 hex', () => {
    expect(fnv1a64('hello')).toBe(fnv1a64('hello'))
    expect(fnv1a64('hello')).toMatch(/^[0-9a-f]{16}$/)
    expect(fnv1a64('hello')).not.toBe(fnv1a64('hello!'))
  })
  it('빈 문자열도 안정', () => {
    expect(fnv1a64('')).toMatch(/^[0-9a-f]{16}$/)
  })
})

describe('splitMinuteBlocks', () => {
  it('헤딩/문단/리스트/표/코드를 루트 블록으로 분할하고 headingDepth를 기록', () => {
    const md = [
      '# 제목',
      '',
      '첫 문단입니다.',
      '',
      '- 항목 1\n- 항목 2',
      '',
      '| a | b |\n|---|---|\n| 1 | 2 |',
      '',
      '```js\nconsole.log(1)\n```',
    ].join('\n')
    const blocks = splitMinuteBlocks(md)
    expect(blocks).toHaveLength(5)
    expect(blocks[0]).toMatchObject({ index: 0, headingDepth: 1, rendered: true })
    expect(blocks[1].headingDepth).toBeUndefined()
    expect(blocks.map(b => b.index)).toEqual([0, 1, 2, 3, 4])
    // GFM 표가 하나의 블록 (remark-gfm 미적용이면 문단 여러 개로 쪼개져 실패)
    expect(blocks[3].text).toContain('a')
    expect(blocks[3].text).toContain('2')
  })

  it('해시는 공백 변화에 안정 (정규화: trim + 연속 공백/개행 → 스페이스 1개)', () => {
    const a = splitMinuteBlocks('결정  사항\n확정')[0]
    const b = splitMinuteBlocks('결정 사항 확정')[0]
    expect(a.hash).toBe(b.hash)
    expect(a.text).toBe('결정 사항 확정')
  })

  it('구분선(---)은 빈 텍스트 → 마킹 불가', () => {
    const blocks = splitMinuteBlocks('위\n\n---\n\n아래')
    expect(blocks).toHaveLength(3)
    expect(blocks[1].text).toBe('')
    expect(isMarkableBlock(blocks[1])).toBe(false)
    expect(isMarkableBlock(blocks[0])).toBe(true)
  })

  it('raw HTML 블록은 rendered=false + 빈 텍스트(includeHtml:false) → 마킹 불가', () => {
    const blocks = splitMinuteBlocks('문단\n\n<div>raw</div>\n\n다음')
    expect(blocks).toHaveLength(3)
    expect(blocks[1].rendered).toBe(false)
    expect(blocks[1].text).toBe('')
    expect(isMarkableBlock(blocks[1])).toBe(false)
  })

  it('GFM 각주 정의·링크 정의는 rendered=false + 빈 텍스트 (제자리 렌더 안 됨)', () => {
    // rendered=false 블록은 text 도 '' 로 강등되므로 내용 검색이 아니라 개수·플래그로 검증
    const md = '본문[^1]과 [링크][ref]\n\n[^1]: 각주 내용\n\n[ref]: https://example.com'
    const blocks = splitMinuteBlocks(md)
    const nonRendered = blocks.filter(b => !b.rendered)
    expect(nonRendered.length).toBeGreaterThanOrEqual(2)  // footnoteDefinition + definition
    nonRendered.forEach(b => {
      expect(b.text).toBe('')
      expect(isMarkableBlock(b)).toBe(false)
    })
  })

  it('빈 문서 → 빈 배열', () => {
    expect(splitMinuteBlocks('')).toEqual([])
    expect(splitMinuteBlocks('   \n  ')).toEqual([])
  })
})
```

- [ ] **Step 3: 테스트가 실패하는지 확인**

Run: `npx vitest run tests/minutes/blocks.test.ts`
Expected: FAIL — `Cannot find module '@/lib/minutes/blocks'`

- [ ] **Step 4: 구현** — `src/lib/minutes/blocks.ts`

```ts
import { unified, type Plugin } from 'unified'
import remarkParse from 'remark-parse'
import remarkGfm from 'remark-gfm'
import { toString as mdastToString } from 'mdast-util-to-string'
import type { Root, RootContent } from 'mdast'

/** AI 분류 카테고리. 'none' 마커는 InsightKind 밖(도메인 타입에서 유니온). */
export type InsightKind = 'decision' | 'action' | 'deadline' | 'risk'

export interface MinuteBlock {
  index: number          // mdast 루트 children 순번 (비렌더 블록도 인덱스 차지)
  hash: string           // fnv1a64(정규화 텍스트)
  text: string           // includeHtml:false 추출 후 정규화
  rendered: boolean      // 제자리 렌더 여부 (html·footnoteDefinition·definition 은 false)
  headingDepth?: number  // heading 이면 1~6
}

// 제자리에 렌더되지 않는 mdast 루트 노드 타입 — raw HTML(rehype-raw 미사용), 각주 정의(문서 끝 이동), 링크 정의
const NON_RENDERED = new Set(['html', 'footnoteDefinition', 'definition'])

const FNV_OFFSET = BigInt('0xcbf29ce484222325')
const FNV_PRIME = BigInt('0x100000001b3')
const U64 = BigInt(64)

/** FNV-1a 64bit hex — 앵커 재매칭용 비암호 해시. BigInt 리터럴 금지(target ES2017). */
export function fnv1a64(text: string): string {
  let h = FNV_OFFSET
  for (let i = 0; i < text.length; i++) {
    h = BigInt.asUintN(64, (h ^ BigInt(text.charCodeAt(i))) * FNV_PRIME)
  }
  return h.toString(16).padStart(16, '0')
}

function normalize(raw: string): string {
  return raw.replace(/\s+/g, ' ').trim()
}

// 서버·클라이언트가 동일 파이프라인을 공유 — react-markdown 내부(remark-parse + remarkPlugins)와 같은 조합
function parseRoot(bodyMd: string): Root {
  return unified().use(remarkParse).use(remarkGfm).parse(bodyMd) as Root
}

/** 본문을 mdast 루트 블록 목록으로 분할. 렌더 스탬핑·서버 검증·AI 입력·재매칭의 단일 원천. */
export function splitMinuteBlocks(bodyMd: string): MinuteBlock[] {
  if (!bodyMd.trim()) return []
  return parseRoot(bodyMd).children.map((node: RootContent, index: number) => {
    const rendered = !NON_RENDERED.has(node.type)
    const text = rendered ? normalize(mdastToString(node, { includeHtml: false })) : ''
    return {
      index,
      hash: fnv1a64(text),
      text,
      rendered,
      ...(node.type === 'heading' ? { headingDepth: node.depth } : {}),
    }
  })
}

/** 하이라이트·AI 마킹 가능 블록 — 클라 팝오버 발동/서버 토글 허용/AI 입력 포함의 공통 기준. */
export function isMarkableBlock(b: MinuteBlock): boolean {
  return b.rendered && b.text !== ''
}

// remarkAnnotateBlocks 는 Task 4 에서 이 파일에 추가된다 (BlockMarks 포함).
export type { Plugin }
```

- [ ] **Step 5: 테스트 통과 확인**

Run: `npx vitest run tests/minutes/blocks.test.ts`
Expected: PASS (전 케이스)

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json src/lib/minutes/blocks.ts tests/minutes/blocks.test.ts
git commit -m "feat(minutes): 공유 블록 분할기 blocks.ts — mdast 루트 인덱스 + FNV-1a 해시 앵커"
```

---

### Task 2: 도메인 타입 + 표시 필터 순수 함수

**Files:**
- Modify: `src/lib/domain/types.ts` (192행 `MinuteFile` 뒤에 추가)
- Create: `src/lib/minutes/annotations.ts` (클라 표시 필터 — 순수 함수)
- Test: `tests/minutes/annotations.test.ts`

**Interfaces:**
- Consumes: `MinuteBlock`, `InsightKind`, `fnv1a64` (Task 1)
- Produces:
  ```ts
  // types.ts
  export interface MinuteHighlight { id: string; minuteId: string; blockIndex: number; blockHash: string; createdBy: string; createdByName: string | null; createdAt: string }
  export interface MinuteInsight { id: string; minuteId: string; bodyHash: string; kind: InsightKind | 'none'; label: string; blockIndex: number; blockHash: string }
  // annotations.ts
  export type InsightCardState = 'ready' | 'empty' | 'pending'   // fresh+항목 / fresh+none / stale·행0
  export function insightCardState(insights: MinuteInsight[], bodyHash: string): InsightCardState
  export function visibleInsights(insights: MinuteInsight[], blocks: MinuteBlock[], bodyHash: string): MinuteInsight[]
  export function visibleHighlights(highlights: MinuteHighlight[], blocks: MinuteBlock[]): MinuteHighlight[]
  export function topHighlightedBlocks(highlights: MinuteHighlight[], blocks: MinuteBlock[], limit?: number): { blockIndex: number; count: number; excerpt: string }[]
  export function hlTier(count: number): 1 | 2 | 3
  export const INS_PRIORITY: InsightKind[]   // ['risk','deadline','decision','action']
  ```

- [ ] **Step 1: types.ts에 도메인 타입 추가** — `MinuteFile` 인터페이스(192행) 바로 뒤:

```ts
/** AI 분류 카테고리 (블록 앵커 공유 모듈과 동일 값 — import 순환 방지 위해 여기 재선언). */
export type InsightKind = 'decision' | 'action' | 'deadline' | 'risk'

export interface MinuteHighlight {
  id: string
  minuteId: string
  blockIndex: number
  blockHash: string
  createdBy: string
  createdByName: string | null
  createdAt: string
}

export interface MinuteInsight {
  id: string
  minuteId: string
  bodyHash: string             // 생성 시점 fnv1a64(body_md) — 신선도 캐시 키
  kind: InsightKind | 'none'   // 'none' = 분석 성공·항목 없음 마커(blockIndex -1)
  label: string
  blockIndex: number
  blockHash: string
}
```

그리고 `src/lib/minutes/blocks.ts`의 `InsightKind` 선언을 types.ts에서 re-export로 교체해 정의를 하나로:

```ts
// blocks.ts 상단의 `export type InsightKind = ...` 를 제거하고 아래로 교체
export type { InsightKind } from '@/lib/domain/types'
```

- [ ] **Step 2: 실패하는 테스트 작성** — `tests/minutes/annotations.test.ts`

```ts
import { describe, it, expect } from 'vitest'
import { splitMinuteBlocks, fnv1a64 } from '@/lib/minutes/blocks'
import {
  insightCardState, visibleInsights, visibleHighlights, topHighlightedBlocks, hlTier,
} from '@/lib/minutes/annotations'
import type { MinuteHighlight, MinuteInsight } from '@/lib/domain/types'

const MD = '# 제목\n\n결정: REST 방식 확정\n\n담당자는 7/18까지 제출'
const blocks = splitMinuteBlocks(MD)
const bodyHash = fnv1a64(MD)

const ins = (over: Partial<MinuteInsight>): MinuteInsight => ({
  id: 'i1', minuteId: 'm1', bodyHash, kind: 'decision', label: 'REST 확정',
  blockIndex: 1, blockHash: blocks[1].hash, ...over,
})
const hl = (over: Partial<MinuteHighlight>): MinuteHighlight => ({
  id: 'h1', minuteId: 'm1', blockIndex: 1, blockHash: blocks[1].hash,
  createdBy: 'u1', createdByName: '김철수', createdAt: '2026-07-12T00:00:00Z', ...over,
})

describe('insightCardState', () => {
  it('행 0개 → pending (미생성/실패 — self-heal 대상)', () => {
    expect(insightCardState([], bodyHash)).toBe('pending')
  })
  it('body_hash 불일치 행이 하나라도 있으면 → pending (stale)', () => {
    expect(insightCardState([ins({ bodyHash: 'deadbeef00000000' })], bodyHash)).toBe('pending')
  })
  it('fresh + none 마커만 → empty', () => {
    expect(insightCardState([ins({ kind: 'none', blockIndex: -1, blockHash: '', label: '' })], bodyHash)).toBe('empty')
  })
  it('fresh + 항목 → ready', () => {
    expect(insightCardState([ins({})], bodyHash)).toBe('ready')
  })
})

describe('visibleInsights', () => {
  it('none 마커는 블록 표시 규칙 대상이 아님 — 목록에서 제외', () => {
    expect(visibleInsights([ins({ kind: 'none', blockIndex: -1, blockHash: '' })], blocks, bodyHash)).toEqual([])
  })
  it('해시 불일치(orphan) 항목 숨김', () => {
    expect(visibleInsights([ins({ blockHash: 'ffffffffffffffff' })], blocks, bodyHash)).toEqual([])
  })
  it('인덱스 범위 밖 숨김', () => {
    expect(visibleInsights([ins({ blockIndex: 99 })], blocks, bodyHash)).toEqual([])
  })
  it('(blockIndex, kind) 중복은 1개만 (동시 생성 경합 방어)', () => {
    const list = visibleInsights([ins({ id: 'a' }), ins({ id: 'b' })], blocks, bodyHash)
    expect(list).toHaveLength(1)
  })
  it('정합 항목은 통과', () => {
    expect(visibleInsights([ins({})], blocks, bodyHash)).toHaveLength(1)
  })
})

describe('visibleHighlights', () => {
  it('인덱스+해시 일치만 통과', () => {
    expect(visibleHighlights([hl({})], blocks)).toHaveLength(1)
    expect(visibleHighlights([hl({ blockHash: 'ffffffffffffffff' })], blocks)).toEqual([])
    expect(visibleHighlights([hl({ blockIndex: 99 })], blocks)).toEqual([])
  })
})

describe('topHighlightedBlocks', () => {
  it('distinct 사용자 수 내림차순, 동률은 블록 순, 발췌는 현재 본문 파생(100자)', () => {
    const hs = [
      hl({ id: 'a', blockIndex: 1, blockHash: blocks[1].hash, createdBy: 'u1' }),
      hl({ id: 'b', blockIndex: 1, blockHash: blocks[1].hash, createdBy: 'u2' }),
      hl({ id: 'c', blockIndex: 2, blockHash: blocks[2].hash, createdBy: 'u1' }),
    ]
    const top = topHighlightedBlocks(hs, blocks)
    expect(top[0]).toMatchObject({ blockIndex: 1, count: 2 })
    expect(top[0].excerpt).toBe(blocks[1].text.slice(0, 100))
    expect(top[1]).toMatchObject({ blockIndex: 2, count: 1 })
  })
  it('limit 기본 3', () => {
    const hs = [0, 1, 2, 3].flatMap(i =>
      i < blocks.length ? [hl({ id: `x${i}`, blockIndex: i, blockHash: blocks[i].hash })] : [])
    expect(topHighlightedBlocks(hs, blocks).length).toBeLessThanOrEqual(3)
  })
})

describe('hlTier', () => {
  it('1명=1, 2~3명=2, 4명+=3', () => {
    expect(hlTier(1)).toBe(1); expect(hlTier(2)).toBe(2)
    expect(hlTier(3)).toBe(2); expect(hlTier(4)).toBe(3); expect(hlTier(9)).toBe(3)
  })
})
```

- [ ] **Step 3: 실패 확인**

Run: `npx vitest run tests/minutes/annotations.test.ts`
Expected: FAIL — `Cannot find module '@/lib/minutes/annotations'`

- [ ] **Step 4: 구현** — `src/lib/minutes/annotations.ts`

```ts
import type { MinuteBlock } from './blocks'
import type { InsightKind, MinuteHighlight, MinuteInsight } from '@/lib/domain/types'

/** 인라인 보더에 쓸 kind 우선순위 — 복수 kind 블록은 최상위 1개만 표시(스펙 §6.3). */
export const INS_PRIORITY: InsightKind[] = ['risk', 'deadline', 'decision', 'action']

/** 요약 카드 상태 — 스펙 §3.3-1. pending 은 self-heal 대기(행 0개 또는 stale). */
export type InsightCardState = 'ready' | 'empty' | 'pending'

export function insightCardState(insights: MinuteInsight[], bodyHash: string): InsightCardState {
  if (insights.length === 0) return 'pending'
  if (insights.some(i => i.bodyHash !== bodyHash)) return 'pending'
  return insights.every(i => i.kind === 'none') ? 'empty' : 'ready'
}

/** 블록 표시 규칙(스펙 §3.3-2): 인덱스 존재 + rendered + 해시 일치. none 마커 제외, (블록,kind) dedupe. */
export function visibleInsights(
  insights: MinuteInsight[], blocks: MinuteBlock[], bodyHash: string,
): MinuteInsight[] {
  const seen = new Set<string>()
  return insights.filter(i => {
    if (i.kind === 'none' || i.bodyHash !== bodyHash) return false
    const b = blocks[i.blockIndex]
    if (!b || !b.rendered || b.hash !== i.blockHash) return false
    const key = `${i.blockIndex}:${i.kind}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

export function visibleHighlights(
  highlights: MinuteHighlight[], blocks: MinuteBlock[],
): MinuteHighlight[] {
  return highlights.filter(h => {
    const b = blocks[h.blockIndex]
    return !!b && b.rendered && b.hash === h.blockHash
  })
}

/** '많이 주목한 구간' — distinct 사용자 수 내림차순 상위 limit. 발췌는 현재 본문 파생(DB 저장 안 함). */
export function topHighlightedBlocks(
  highlights: MinuteHighlight[], blocks: MinuteBlock[], limit = 3,
): { blockIndex: number; count: number; excerpt: string }[] {
  const byBlock = new Map<number, Set<string>>()
  for (const h of visibleHighlights(highlights, blocks)) {
    if (!byBlock.has(h.blockIndex)) byBlock.set(h.blockIndex, new Set())
    byBlock.get(h.blockIndex)!.add(h.createdBy)
  }
  return [...byBlock.entries()]
    .map(([blockIndex, users]) => ({
      blockIndex, count: users.size, excerpt: blocks[blockIndex].text.slice(0, 100),
    }))
    .sort((a, b) => b.count - a.count || a.blockIndex - b.blockIndex)
    .slice(0, limit)
}

/** 하이라이트 배경 3단계 — 1명 / 2–3명 / 4명+ (스펙 §6.3). */
export function hlTier(count: number): 1 | 2 | 3 {
  return count >= 4 ? 3 : count >= 2 ? 2 : 1
}
```

- [ ] **Step 5: 통과 확인 + 전체 회귀**

Run: `npx vitest run tests/minutes`
Expected: PASS (기존 chunk/linkify/validate 포함)

- [ ] **Step 6: Commit**

```bash
git add src/lib/domain/types.ts src/lib/minutes/blocks.ts src/lib/minutes/annotations.ts tests/minutes/annotations.test.ts
git commit -m "feat(minutes): 하이라이트/인사이트 도메인 타입 + 클라 표시 필터 순수 함수"
```

---

### Task 3: 재매칭 순수 함수 `rematch.ts`

**Files:**
- Create: `src/lib/minutes/rematch.ts`
- Test: `tests/minutes/rematch.test.ts`

**Interfaces:**
- Consumes: `MinuteBlock`, `isMarkableBlock` (Task 1)
- Produces (Task 8 after() 훅이 사용):
  ```ts
  export interface HighlightRow { id: string; created_by: string; created_by_name: string | null; block_index: number; block_hash: string; created_at: string }
  export function rematchHighlights(old: HighlightRow[], newBlocks: MinuteBlock[]):
    { reinserts: HighlightRow[]; deleteIds: string[] }
  // reinserts = 인덱스가 바뀌는 행(새 block_index 반영, 나머지 컬럼 원본 보존)
  // deleteIds = orphan 행 id + reinserts 대상 행의 원 id (delete 선실행 → insert — unique 충돌 원천 차단)
  ```

- [ ] **Step 1: 실패하는 테스트 작성** — `tests/minutes/rematch.test.ts`

```ts
import { describe, it, expect } from 'vitest'
import { splitMinuteBlocks } from '@/lib/minutes/blocks'
import { rematchHighlights, type HighlightRow } from '@/lib/minutes/rematch'

const row = (over: Partial<HighlightRow>): HighlightRow => ({
  id: 'r1', created_by: 'u1', created_by_name: '김철수',
  block_index: 0, block_hash: '', created_at: '2026-07-12T00:00:00Z', ...over,
})
// 특정 본문의 블록 해시를 얻는 헬퍼
const hashesOf = (md: string) => splitMinuteBlocks(md).map(b => b.hash)

describe('rematchHighlights', () => {
  it('전체 +1 시프트(상단 문단 삽입) — 인접 하이라이트 2개가 모두 보존', () => {
    const oldMd = 'A문단\n\nB문단\n\nC문단'
    const newMd = '새 문단\n\nA문단\n\nB문단\n\nC문단'
    const oh = hashesOf(oldMd)
    const old = [
      row({ id: 'a', block_index: 0, block_hash: oh[0] }),
      row({ id: 'b', block_index: 1, block_hash: oh[1] }),
    ]
    const { reinserts, deleteIds } = rematchHighlights(old, splitMinuteBlocks(newMd))
    expect(reinserts.map(r => [r.id, r.block_index])).toEqual([['a', 1], ['b', 2]])
    expect(deleteIds.sort()).toEqual(['a', 'b'])  // 이동 대상의 원 행도 삭제 목록에 포함
  })

  it('두 블록 스왑 — delete→reinsert 방식이라 충돌 없이 교차 배정', () => {
    const oldMd = 'X내용\n\nY내용'
    const newMd = 'Y내용\n\nX내용'
    const oh = hashesOf(oldMd)
    const old = [
      row({ id: 'x', block_index: 0, block_hash: oh[0] }),
      row({ id: 'y', block_index: 1, block_hash: oh[1] }),
    ]
    const { reinserts } = rematchHighlights(old, splitMinuteBlocks(newMd))
    expect(reinserts.find(r => r.id === 'x')!.block_index).toBe(1)
    expect(reinserts.find(r => r.id === 'y')!.block_index).toBe(0)
  })

  it('중복 해시 — 같은 사용자·같은 해시 여러 행은 문서 순 1:1, 남으면 삭제', () => {
    const oldMd = '중복\n\n중복\n\n중복'
    const newMd = '중복\n\n다른 내용'
    const oh = hashesOf(oldMd)
    const old = [
      row({ id: 'a', block_index: 0, block_hash: oh[0] }),
      row({ id: 'b', block_index: 1, block_hash: oh[1] }),
      row({ id: 'c', block_index: 2, block_hash: oh[2] }),
    ]
    const { reinserts, deleteIds } = rematchHighlights(old, splitMinuteBlocks(newMd))
    // 새 본문에 '중복' 블록 1개 → a만 index 0 유지(무변경 — reinsert 불필요), b·c 삭제
    expect(reinserts).toEqual([])
    expect(deleteIds.sort()).toEqual(['b', 'c'])
  })

  it('다른 사용자는 같은 새 인덱스를 공유', () => {
    const oldMd = '공통 문단'
    const newMd = '앞 문단\n\n공통 문단'
    const oh = hashesOf(oldMd)
    const old = [
      row({ id: 'a', created_by: 'u1', block_index: 0, block_hash: oh[0] }),
      row({ id: 'b', created_by: 'u2', block_index: 0, block_hash: oh[0] }),
    ]
    const { reinserts } = rematchHighlights(old, splitMinuteBlocks(newMd))
    expect(reinserts.map(r => r.block_index)).toEqual([1, 1])
  })

  it('소실 블록의 하이라이트는 삭제(orphan 미보존)', () => {
    const old = [row({ id: 'gone', block_index: 0, block_hash: hashesOf('사라질 문단')[0] })]
    const { reinserts, deleteIds } = rematchHighlights(old, splitMinuteBlocks('완전히 다른 본문'))
    expect(reinserts).toEqual([])
    expect(deleteIds).toEqual(['gone'])
  })

  it('인덱스 무변경 행은 reinserts/deleteIds 어디에도 없음', () => {
    const md = '그대로'
    const old = [row({ id: 'same', block_index: 0, block_hash: hashesOf(md)[0] })]
    const { reinserts, deleteIds } = rematchHighlights(old, splitMinuteBlocks(md))
    expect(reinserts).toEqual([])
    expect(deleteIds).toEqual([])
  })
})
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run tests/minutes/rematch.test.ts`
Expected: FAIL — `Cannot find module '@/lib/minutes/rematch'`

- [ ] **Step 3: 구현** — `src/lib/minutes/rematch.ts`

```ts
import { isMarkableBlock, type MinuteBlock } from './blocks'

/** minute_highlights 행 스냅샷(snake_case — service_role 재삽입에 그대로 사용). */
export interface HighlightRow {
  id: string
  created_by: string
  created_by_name: string | null
  block_index: number
  block_hash: string
  created_at: string
}

/**
 * 본문 교체 시 하이라이트 재배정 — 스펙 §5.
 * 사용자별·해시별로 옛 행(옛 인덱스 순)을 같은 해시의 새 마킹 가능 블록 큐(문서 순)에 1:1 배정.
 * 적용은 delete(deleteIds ∪ reinserts 원 id) 선실행 → reinserts 일괄 insert —
 * unique (minute_id, created_by, block_index) 가 non-deferrable 이라 행별 UPDATE 는
 * 시프트/스왑에서 반드시 23505 가 나기 때문(행 단위 즉시 검사).
 */
export function rematchHighlights(
  old: HighlightRow[], newBlocks: MinuteBlock[],
): { reinserts: HighlightRow[]; deleteIds: string[] } {
  // 해시 → 새 블록 인덱스 큐 (문서 순, 마킹 가능 블록만)
  const queues = new Map<string, number[]>()
  for (const b of newBlocks) {
    if (!isMarkableBlock(b)) continue
    if (!queues.has(b.hash)) queues.set(b.hash, [])
    queues.get(b.hash)!.push(b.index)
  }

  const reinserts: HighlightRow[] = []
  const deleteIds: string[] = []

  // 사용자별 그룹 — 서로 다른 사용자는 같은 새 인덱스를 공유할 수 있음(unique 는 사용자 스코프)
  const byUser = new Map<string, HighlightRow[]>()
  for (const r of old) {
    if (!byUser.has(r.created_by)) byUser.set(r.created_by, [])
    byUser.get(r.created_by)!.push(r)
  }

  for (const rows of byUser.values()) {
    // 사용자 내 해시별 소비 위치(큐는 사용자 간 공유가 아니라 사용자별 복사 소비)
    const cursor = new Map<string, number>()
    for (const r of [...rows].sort((a, b) => a.block_index - b.block_index)) {
      const q = queues.get(r.block_hash) ?? []
      const pos = cursor.get(r.block_hash) ?? 0
      if (pos >= q.length) { deleteIds.push(r.id); continue }
      cursor.set(r.block_hash, pos + 1)
      const newIndex = q[pos]
      if (newIndex === r.block_index) continue  // 무변경
      deleteIds.push(r.id)
      reinserts.push({ ...r, block_index: newIndex })
    }
  }
  return { reinserts, deleteIds }
}
```

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run tests/minutes/rematch.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/minutes/rematch.ts tests/minutes/rematch.test.ts
git commit -m "feat(minutes): 본문 교체 하이라이트 재매칭 순수 함수 — delete→reinsert 산출"
```

---

### Task 4: remarkAnnotateBlocks 플러그인 + MarkdownView 스탬핑/호이스팅

**Files:**
- Modify: `src/lib/minutes/blocks.ts` (플러그인 추가)
- Modify: `src/components/minutes/MarkdownView.tsx`
- Test: `tests/minutes/stamp-parity.test.tsx`

**Interfaces:**
- Consumes: `splitMinuteBlocks`, `isMarkableBlock`, `InsightKind` (Task 1·2)
- Produces:
  ```ts
  // blocks.ts
  export type BlockMarks = Record<number, { ins?: InsightKind; hlTier?: 1 | 2 | 3; hlCount?: number }>
  export function remarkAnnotateBlocks(marks: BlockMarks): (tree: Root) => void
  // MarkdownView
  export function MarkdownView({ content, marks }: { content: string; marks?: BlockMarks }) // marks 생략 시 기존과 동일
  ```
- DOM 계약(이후 태스크·CSS가 의존): 마킹 가능 루트 블록에 `data-mblock="{index}"`,
  AI 마킹 시 `data-ins="{kind}"`, 하이라이트 시 `data-hl="{1|2|3}"` + `data-hl-count="{n}"`.
  코드 블록은 pre 오버라이드가 code 자식에서 위 속성을 **pre/MermaidBlock으로 호이스팅**.

- [ ] **Step 1: 실패하는 테스트 작성** — `tests/minutes/stamp-parity.test.tsx`

**가장 가치 있는 테스트** — 서버 분할기와 클라 렌더 DOM의 인덱스 파리티를 검증한다.

```tsx
// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MarkdownView } from '@/components/minutes/MarkdownView'
import { splitMinuteBlocks, type BlockMarks } from '@/lib/minutes/blocks'

function stampedIndexes(html: string): number[] {
  return [...html.matchAll(/data-mblock="(\d+)"/g)].map(m => Number(m[1])).sort((a, b) => a - b)
}

const RICH_MD = [
  '# 제목',
  '',
  '첫 문단입니다.',
  '',
  '<div>raw html — 렌더 안 됨</div>',
  '',
  '- 리스트 항목',
  '',
  '```mermaid\ngraph TD; A-->B\n```',
  '',
  '```js\nconsole.log(1)\n```',
  '',
  '| a | b |\n|---|---|\n| 1 | 2 |',
  '',
  '본문[^1]',
  '',
  '[^1]: 각주 정의',
].join('\n')

describe('stamp parity — splitMinuteBlocks ↔ MarkdownView DOM', () => {
  it('마킹 가능 블록의 인덱스 집합이 서버 분할기와 정확히 일치', () => {
    const blocks = splitMinuteBlocks(RICH_MD)
    const expected = blocks.filter(b => b.rendered && b.text !== '').map(b => b.index)
    const html = renderToStaticMarkup(<MarkdownView content={RICH_MD} />)
    expect(stampedIndexes(html)).toEqual(expected)
  })

  it('marks 부여 — data-ins/data-hl/data-hl-count 속성이 해당 블록에 스탬프', () => {
    const marks: BlockMarks = { 1: { ins: 'decision' }, 3: { hlTier: 2, hlCount: 3 } }
    const html = renderToStaticMarkup(<MarkdownView content={RICH_MD} marks={marks} />)
    expect(html).toMatch(/data-mblock="1"[^>]*data-ins="decision"|data-ins="decision"[^>]*data-mblock="1"/)
    expect(html).toContain('data-hl="2"')
    expect(html).toContain('data-hl-count="3"')
  })

  it('마킹된 mermaid 블록 — language-mermaid 클래스 보존 + 래퍼에 data-mblock 호이스팅', () => {
    const blocks = splitMinuteBlocks(RICH_MD)
    const mermaidIdx = blocks.findIndex(b => b.text.includes('graph TD'))
    const marks: BlockMarks = { [mermaidIdx]: { hlTier: 1, hlCount: 1 } }
    const html = renderToStaticMarkup(<MarkdownView content={RICH_MD} marks={marks} />)
    // SSR 은 MermaidBlock loading 경로 — 래퍼 div 에 앵커 속성이 호이스팅돼야 함
    const wrapper = html.match(/<div[^>]*minutes-mermaid-loading[^>]*>/)?.[0] ?? ''
    expect(wrapper).toContain(`data-mblock="${mermaidIdx}"`)
    expect(wrapper).toContain('data-hl="1"')
  })

  it('마킹된 일반 코드 블록 — pre 에 호이스팅 + language-js 보존', () => {
    const blocks = splitMinuteBlocks(RICH_MD)
    const codeIdx = blocks.findIndex(b => b.text.includes('console.log'))
    const marks: BlockMarks = { [codeIdx]: { ins: 'action' } }
    const html = renderToStaticMarkup(<MarkdownView content={RICH_MD} marks={marks} />)
    const pre = html.match(/<pre[^>]*>/g)?.find(p => p.includes('data-mblock')) ?? ''
    expect(pre).toContain(`data-mblock="${codeIdx}"`)
    expect(pre).toContain('data-ins="action"')
    expect(html).toContain('language-js')  // className 클로버 없음
  })

  it('raw HTML·각주 정의 블록은 DOM 에 data-mblock 없음(비렌더)', () => {
    const blocks = splitMinuteBlocks(RICH_MD)
    const nonRendered = blocks.filter(b => !b.rendered).map(b => b.index)
    const html = renderToStaticMarkup(<MarkdownView content={RICH_MD} />)
    const stamped = stampedIndexes(html)
    nonRendered.forEach(i => expect(stamped).not.toContain(i))
  })
})
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run tests/minutes/stamp-parity.test.tsx`
Expected: FAIL — `BlockMarks`/`marks` 미존재 (또는 data-mblock 미스탬프로 인덱스 불일치)

- [ ] **Step 3: blocks.ts에 플러그인 추가** — 파일 끝의 `export type { Plugin }` 줄을 삭제하고 아래로 교체:

```ts
/** 렌더러에 전달하는 표시 상태(인덱스 키) — 스펙 §2.1. ins 는 우선순위 최상위 1개. */
export type BlockMarks = Record<number, {
  ins?: InsightKind
  hlTier?: 1 | 2 | 3
  hlCount?: number
}>

/**
 * mdast 루트 블록에 data-* 앵커/마킹 속성을 스탬프하는 동기 remark 플러그인 — 스펙 §2.1.
 * 클래스는 절대 스탬프하지 않는다(hProperties.className 이 code 블록의 language-* 를
 * Object.assign 으로 대체하는 함정). 코드 블록의 속성은 <code> 에 떨어지며(§2 함정 2)
 * MarkdownView 의 pre 오버라이드가 pre/MermaidBlock 으로 호이스팅한다.
 */
export function remarkAnnotateBlocks(marks: BlockMarks) {
  return (tree: Root) => {
    tree.children.forEach((node: RootContent, index: number) => {
      const rendered = !NON_RENDERED.has(node.type)
      const text = rendered ? normalize(mdastToString(node, { includeHtml: false })) : ''
      if (!rendered || text === '') return  // 마킹 불가 블록은 스탬프 자체를 생략
      const props: Record<string, string | number> = { 'data-mblock': index }
      const m = marks[index]
      if (m?.ins) props['data-ins'] = m.ins
      if (m?.hlTier) {
        props['data-hl'] = m.hlTier
        props['data-hl-count'] = m.hlCount ?? 1
      }
      const data = (node.data ??= {}) as { hProperties?: Record<string, unknown> }
      data.hProperties = { ...data.hProperties, ...props }
    })
  }
}
```

(파일 상단 import에 `unified`의 `Plugin` 타입 import가 남아 있으면 제거 — 더 이상 안 씀.)

- [ ] **Step 4: MarkdownView 수정** — `src/components/minutes/MarkdownView.tsx` 전체를 아래로 교체:

```tsx
'use client'
import { Children, isValidElement, memo, useEffect, useMemo, useState, type ReactElement, type ReactNode } from 'react'
import ReactMarkdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { remarkAnnotateBlocks, type BlockMarks } from '@/lib/minutes/blocks'

let mermaidSeq = 0

type MermaidState =
  | { status: 'loading' }
  | { status: 'rendered'; svg: string }
  | { status: 'error' }

type CodeChildProps = { className?: string; children?: ReactNode } & Record<string, unknown>

function codeChildFrom(children: ReactNode): ReactElement<CodeChildProps> | null {
  const child = Children.toArray(children).find(isValidElement) as ReactElement<CodeChildProps> | undefined
  if (!child || child.type !== 'code') return null
  return child
}

function mermaidSourceFrom(child: ReactElement<CodeChildProps> | null): string | null {
  if (!child) return null
  if (!/\blanguage-mermaid\b/i.test(child.props.className ?? '')) return null
  return String(child.props.children ?? '').replace(/\n$/, '')
}

/** code 자식 props 에서 블록 앵커/마킹 data-* 만 추출 — pre/MermaidBlock 으로 호이스팅(스펙 §2.3). */
function anchorPropsFrom(child: ReactElement<CodeChildProps> | null): Record<string, unknown> {
  if (!child) return {}
  const out: Record<string, unknown> = {}
  for (const key of ['data-mblock', 'data-ins', 'data-hl', 'data-hl-count']) {
    const v = (child.props as Record<string, unknown>)[key]
    if (v !== undefined) out[key] = v
  }
  return out
}

function MermaidBlock({ source, anchorProps }: { source: string; anchorProps: Record<string, unknown> }) {
  const [state, setState] = useState<MermaidState>({ status: 'loading' })

  useEffect(() => {
    let cancelled = false
    async function renderDiagram() {
      setState({ status: 'loading' })
      try {
        const mermaid = (await import('mermaid')).default
        mermaid.initialize({
          startOnLoad: false,
          securityLevel: 'strict',
          htmlLabels: false,
          suppressErrorRendering: true,
          theme: 'base',
          themeVariables: {
            fontFamily: 'Pretendard Variable, Pretendard, system-ui, sans-serif',
            primaryColor: '#e3efec',
            primaryBorderColor: '#0f766e',
            primaryTextColor: '#17181d',
            lineColor: '#7a6f68',
            secondaryColor: '#fffaf4',
            tertiaryColor: '#f3ece1',
          },
        })
        const { svg } = await mermaid.render(`minute-mermaid-${++mermaidSeq}`, source)
        if (!cancelled) setState({ status: 'rendered', svg })
      } catch {
        if (!cancelled) setState({ status: 'error' })
      }
    }
    void renderDiagram()
    return () => { cancelled = true }
  }, [source])

  // 앵커 속성은 세 렌더 경로 모두에 포워딩 — SSR(loading)·성공·실패 어디서든 앵커 유지(스펙 §2.3)
  if (state.status === 'rendered') {
    return (
      <div
        {...anchorProps}
        className="minutes-mermaid"
        aria-label="Mermaid diagram"
        dangerouslySetInnerHTML={{ __html: state.svg }}
      />
    )
  }
  if (state.status === 'error') {
    return (
      <pre {...anchorProps}>
        <code className="language-mermaid">{source}</code>
      </pre>
    )
  }
  return <div {...anchorProps} className="minutes-mermaid minutes-mermaid-loading" aria-label="Mermaid diagram loading" />
}

const components: Components = {
  a: ({ node, href, children, ...rest }) => {
    void node
    const isHash = typeof href === 'string' && href.startsWith('#')
    return isHash ? (
      <a href={href} {...rest}>{children}</a>
    ) : (
      <a href={href} target="_blank" rel="noopener noreferrer" {...rest}>{children}</a>
    )
  },
  pre: ({ node, children, ...rest }) => {
    void node
    const codeChild = codeChildFrom(children)
    const anchorProps = anchorPropsFrom(codeChild)
    const source = mermaidSourceFrom(codeChild)
    if (source !== null) return <MermaidBlock source={source} anchorProps={anchorProps} />
    return <pre {...rest} {...anchorProps}>{children}</pre>
  },
}

/** 회의록 md 렌더 — raw HTML 은 렌더하지 않음(rehype-raw 미사용, XSS 차단).
 *  marks 실변경 시에만 재파싱되도록 memo — 팝오버 개폐 등이 100k 재파싱을 유발하지 않게(스펙 §2.3). */
export const MarkdownView = memo(function MarkdownView({
  content, marks,
}: { content: string; marks?: BlockMarks }) {
  const remarkPlugins = useMemo(
    () => [remarkGfm, remarkAnnotateBlocks(marks ?? {})],
    [marks],
  )
  return (
    <div className="minutes-md">
      <ReactMarkdown
        remarkPlugins={remarkPlugins}
        components={components}
      >
        {content}
      </ReactMarkdown>
    </div>
  )
})
```

- [ ] **Step 5: 통과 확인 + 전체 회귀**

Run: `npx vitest run tests/minutes && npm run lint`
Expected: PASS. (react-markdown의 remark 플러그인 타입이 안 맞으면 `remarkAnnotateBlocks(marks ?? {})`를 `as never` 대신 **플러그인 배열 타입 `PluggableList`로 명시**: `import type { PluggableList } from 'unified'` 후 `const remarkPlugins = useMemo<PluggableList>(...)`.)

- [ ] **Step 6: Commit**

```bash
git add src/lib/minutes/blocks.ts src/components/minutes/MarkdownView.tsx tests/minutes/stamp-parity.test.tsx
git commit -m "feat(minutes): remarkAnnotateBlocks data-* 스탬핑 + pre/mermaid 앵커 호이스팅 — 서버·클라 인덱스 파리티"
```

---

### Task 5: 마이그레이션 0025 — minute_highlights + minute_insights

**Files:**
- Create: `supabase/migrations/0025_minute_annotations.sql`

**Interfaces:**
- Produces: 테이블 `minute_highlights`(본인 쓰기 RLS), `minute_insights`(service_role 전용 쓰기) — Task 6~8이 사용.

- [ ] **Step 1: 마이그레이션 SQL 작성** — `supabase/migrations/0025_minute_annotations.sql`

```sql
-- 회의록 뷰어 인사이트 — 블록 하이라이트(실명 공유) + AI 분류 캐시.
-- 권한: highlights = 읽기 인증 전체 / 쓰기 본인(멤버십 보유) / 삭제 본인 또는 pmo_admin.
--       insights = 읽기 인증 전체 / 쓰기 정책 없음(service_role 이 RLS 우회로 수행).
-- 멱등: SQL Editor 반복 실행 안전(if not exists / drop policy if exists).
-- 적용: Supabase Management API — POST /v1/projects/<ref>/database/query (0021과 동일 경로).
--       .env.local 의 SUPABASE_DB_URL 은 비어 있으므로 pg 직결/db push 는 사용하지 않는다.
-- 적용 순서: 이 마이그레이션을 **먼저** 적용한 뒤 코드를 배포한다. Storage 정책은 건드리지 않는다.
-- 주의: 레포 0002/0004 의 current_role() 은 PG 예약어 드리프트 — 프로덕션 헬퍼는 public.app_role().

-- ── 블록 하이라이트 (앵커 = 루트 블록 인덱스 + 정규화 텍스트 FNV-1a 64 해시) ──
-- excerpt 컬럼은 의도적으로 없음: 표시 발췌는 클라이언트가 현재 본문에서 파생(위조·잔존 노출 표면 제거).
-- created_by CASCADE: 하이라이트는 개인 행위 — 탈퇴 시 집계에서 제거(minutes 의 SET NULL 관례와 다른 의도적 선택).
create table if not exists minute_highlights (
  id uuid primary key default gen_random_uuid(),
  minute_id uuid not null references minutes(id) on delete cascade,
  block_index int not null check (block_index >= 0),
  block_hash text not null,
  created_by uuid not null references auth.users(id) on delete cascade,
  created_by_name text,
  created_at timestamptz not null default now()
);
create index if not exists minute_highlights_minute_idx on minute_highlights (minute_id);
create unique index if not exists minute_highlights_user_block_idx
  on minute_highlights (minute_id, created_by, block_index);

-- ── AI 분류 캐시 (본문 교체 시 delete-and-reinsert, body_hash 로 신선도 판정) ──
-- 'none' 마커 1행(block_index=-1) = 분석 성공·항목 없음. 행 0개 = 미생성/실패(self-heal 대상).
create table if not exists minute_insights (
  id uuid primary key default gen_random_uuid(),
  minute_id uuid not null references minutes(id) on delete cascade,
  body_hash text not null,
  kind text not null check (kind in ('decision','action','deadline','risk','none')),
  label text not null default '',
  block_index int not null,
  block_hash text not null default '',
  created_at timestamptz not null default now()
);
create index if not exists minute_insights_minute_idx on minute_insights (minute_id);
-- 동시 재생성(서버리스 인스턴스 경합) 시 중복 행 방지 — insert 는 on conflict do nothing
create unique index if not exists minute_insights_block_kind_idx
  on minute_insights (minute_id, block_index, kind);

-- ── RLS (enable 이 전제 — 없으면 기본 GRANT 로 authenticated 쓰기가 열림) ──
alter table minute_highlights enable row level security;
alter table minute_insights   enable row level security;

drop policy if exists read_all_minute_highlights on minute_highlights;
create policy read_all_minute_highlights on minute_highlights
  for select to authenticated using (true);

drop policy if exists insert_own_minute_highlights on minute_highlights;
create policy insert_own_minute_highlights on minute_highlights
  for insert to authenticated
  with check (created_by = auth.uid() and app_role() is not null);

drop policy if exists delete_own_minute_highlights on minute_highlights;
create policy delete_own_minute_highlights on minute_highlights
  for delete to authenticated
  using (created_by = auth.uid() or app_role() = 'pmo_admin');
-- UPDATE 정책 없음 — 토글은 insert/delete 만, 재매칭은 service_role(RLS 우회).

-- 인사이트: 읽기만 인증 사용자, 쓰기 정책 없음(service_role 이 RLS 우회로 수행) — 0021 minute_embeddings 미러.
drop policy if exists minute_insights_read on minute_insights;
create policy minute_insights_read on minute_insights
  for select to authenticated using (true);
```

- [ ] **Step 2: SQL 정합 자체 점검** (실행 없이 — 로컬 dev도 프로덕션 DB 공유이므로 적용은 Task 14에서 사용자 확인 후)

체크리스트: `app_role()`만 사용 / 모든 정책이 drop-then-create / 두 테이블 모두 RLS enable /
unique 2개(`(minute_id, created_by, block_index)`, `(minute_id, block_index, kind)`) /
CHECK `block_index >= 0`은 highlights에만(insights의 none 마커는 -1 필요).

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/0025_minute_annotations.sql
git commit -m "feat(minutes): 0025 마이그레이션 — minute_highlights/minute_insights + RLS"
```

---

### Task 6: AI 인사이트 파이프라인 `minutes-insights.ts`

**Files:**
- Create: `src/lib/ai/minutes-insights.ts`
- Test: `tests/minutes/insights-parse.test.ts`

**Interfaces:**
- Consumes: `generateAnswer(system, messages): Promise<string | null>` (`@/lib/ai/llm`),
  `hasLLM()` (`@/lib/ai/provider`), `createAdminClient()` (`@/lib/supabase/admin`),
  `splitMinuteBlocks`/`isMarkableBlock`/`fnv1a64` (Task 1), `InsightKind` (`@/lib/domain/types`)
- Produces (Task 7·8이 사용):
  ```ts
  export function parseInsightItems(raw: string, blocks: MinuteBlock[]):
    { i: number; k: InsightKind; label: string }[] | null   // null = 파싱 실패
  export async function generateMinuteInsights(minuteId: string, bodyMd: string): Promise<void>  // 절대 throw 안 함
  export async function ensureMinuteInsights(minuteId: string, bodyMd: string, currentBodyHash: string):
    Promise<'ready' | 'generated' | 'unavailable'>          // 서버 액션(Task 7)이 래핑
  ```

- [ ] **Step 1: 실패하는 테스트 작성** — `tests/minutes/insights-parse.test.ts`

```ts
import { describe, it, expect } from 'vitest'
import { parseInsightItems } from '@/lib/ai/minutes-insights'
import { splitMinuteBlocks } from '@/lib/minutes/blocks'

const MD = '# 제목\n\n결정 문단\n\n<div>raw</div>\n\n기한 문단'
const blocks = splitMinuteBlocks(MD)  // 0=heading, 1=결정, 2=raw(비렌더), 3=기한

describe('parseInsightItems', () => {
  it('코드펜스·서두 문장 제거 후 파싱', () => {
    const raw = '다음과 같습니다.\n```json\n[{"i":1,"k":"decision","label":"확정"}]\n```'
    expect(parseInsightItems(raw, blocks)).toEqual([{ i: 1, k: 'decision', label: '확정' }])
  })
  it('잘못된 kind·범위 밖 인덱스·비렌더 블록 인덱스 드롭', () => {
    const raw = JSON.stringify([
      { i: 1, k: 'decision', label: 'ok' },
      { i: 2, k: 'action', label: 'raw html 블록' },   // 비렌더 → 드롭
      { i: 99, k: 'risk', label: '범위 밖' },
      { i: 3, k: 'banana', label: '엉뚱 kind' },
    ])
    expect(parseInsightItems(raw, blocks)).toEqual([{ i: 1, k: 'decision', label: 'ok' }])
  })
  it('label 120자 캡 + (블록, kind) 중복 제거 + 30개 캡', () => {
    const long = 'x'.repeat(300)
    const raw = JSON.stringify([
      { i: 1, k: 'decision', label: long },
      { i: 1, k: 'decision', label: '중복' },
      { i: 1, k: 'deadline', label: '다른 kind 는 허용' },
    ])
    const out = parseInsightItems(raw, blocks)!
    expect(out).toHaveLength(2)
    expect(out[0].label).toHaveLength(120)
  })
  it('깨진 JSON → null', () => {
    expect(parseInsightItems('죄송합니다, 분류할 수 없습니다.', blocks)).toBeNull()
    expect(parseInsightItems('[{"i":1,', blocks)).toBeNull()
  })
  it('배열 아닌 JSON → null, 빈 배열 → []', () => {
    expect(parseInsightItems('{"i":1}', blocks)).toBeNull()
    expect(parseInsightItems('[]', blocks)).toEqual([])
  })
  it('label 이 문자열 아닌 항목 드롭', () => {
    const raw = JSON.stringify([{ i: 1, k: 'risk', label: 42 }, { i: 3, k: 'risk', label: '유효' }])
    expect(parseInsightItems(raw, blocks)).toEqual([{ i: 3, k: 'risk', label: '유효' }])
  })
})
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run tests/minutes/insights-parse.test.ts`
Expected: FAIL — `Cannot find module '@/lib/ai/minutes-insights'`

- [ ] **Step 3: 구현** — `src/lib/ai/minutes-insights.ts`

```ts
import { generateAnswer } from './llm'
import { hasLLM } from './provider'
import { createAdminClient } from '@/lib/supabase/admin'
import { splitMinuteBlocks, isMarkableBlock, fnv1a64, type MinuteBlock } from '@/lib/minutes/blocks'
import type { InsightKind } from '@/lib/domain/types'

const KINDS: InsightKind[] = ['decision', 'action', 'deadline', 'risk']
const LABEL_CAP = 120
const ITEMS_CAP = 30
const BLOCK_TEXT_CAP = 800

const SYSTEM = [
  '너는 회의록 분석기다. 번호가 매겨진 블록 목록에서 아래 4종에 해당하는 블록만 골라라.',
  '- decision: 확정된 결정사항',
  '- action: 담당자가 해야 할 액션아이템',
  '- deadline: 구체적 기한/일정 약속',
  '- risk: 리스크/우려/차질 가능성',
  '규칙: 확실한 것만. 최대 20항목. label 은 60자 이내 한 문장 요약.',
  'JSON 배열만 출력한다. 형식: [{"i":블록번호,"k":"decision","label":"..."}]',
  'JSON 외 다른 텍스트를 절대 출력하지 마라.',
].join('\n')

/** LLM 응답 관용 파싱 — 코드펜스/서두 제거 → 첫 '['~마지막 ']' → 검증. 실패 시 null. */
export function parseInsightItems(
  raw: string, blocks: MinuteBlock[],
): { i: number; k: InsightKind; label: string }[] | null {
  const start = raw.indexOf('[')
  const end = raw.lastIndexOf(']')
  if (start < 0 || end <= start) return null
  let parsed: unknown
  try { parsed = JSON.parse(raw.slice(start, end + 1)) } catch { return null }
  if (!Array.isArray(parsed)) return null
  const seen = new Set<string>()
  const out: { i: number; k: InsightKind; label: string }[] = []
  for (const item of parsed) {
    if (out.length >= ITEMS_CAP) break
    if (typeof item !== 'object' || item === null) continue
    const { i, k, label } = item as { i?: unknown; k?: unknown; label?: unknown }
    if (typeof i !== 'number' || !Number.isInteger(i)) continue
    if (typeof k !== 'string' || !KINDS.includes(k as InsightKind)) continue
    if (typeof label !== 'string') continue
    const b = blocks[i]
    if (!b || !isMarkableBlock(b)) continue
    const key = `${i}:${k}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push({ i, k: k as InsightKind, label: label.slice(0, LABEL_CAP) })
  }
  return out
}

/**
 * 회의록 1건 AI 분류 — delete 후 insert(on conflict do nothing). 스펙 §4.1.
 * 실패는 로그만(행 미기록 = self-heal 재시도 신호). 절대 throw 하지 않는다.
 */
export async function generateMinuteInsights(minuteId: string, bodyMd: string): Promise<void> {
  try {
    if (!hasLLM()) return
    if (!(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY)) return
    if (!bodyMd.trim()) return
    const blocks = splitMinuteBlocks(bodyMd)
    const markable = blocks.filter(isMarkableBlock)
    if (markable.length === 0) return
    const user = markable.map(b => `[${b.index}] ${b.text.slice(0, BLOCK_TEXT_CAP)}`).join('\n')
    const raw = await generateAnswer(SYSTEM, [{ role: 'user', content: user }])
    if (raw === null) return  // LLM 실패/키 없음 — 행 미기록
    const items = parseInsightItems(raw, blocks)
    if (items === null) { console.error('[minutes] 인사이트 파싱 실패(행 미기록)'); return }

    const bodyHash = fnv1a64(bodyMd)
    const rows = items.length
      ? items.map(({ i, k, label }) => ({
          minute_id: minuteId, body_hash: bodyHash, kind: k, label,
          block_index: i, block_hash: blocks[i].hash,
        }))
      : [{ minute_id: minuteId, body_hash: bodyHash, kind: 'none', label: '', block_index: -1, block_hash: '' }]

    const admin = createAdminClient()
    const { error: delErr } = await admin.from('minute_insights').delete().eq('minute_id', minuteId)
    if (delErr) { console.error('[minutes] 인사이트 삭제 실패:', delErr.message); return }
    // 동시 재생성 경합은 unique (minute_id, block_index, kind) + ignoreDuplicates 로 중복 차단
    const { error } = await admin.from('minute_insights')
      .upsert(rows, { onConflict: 'minute_id,block_index,kind', ignoreDuplicates: true })
    if (error) console.error('[minutes] 인사이트 기록 실패:', error.message)
  } catch (e) {
    console.error('[minutes] 인사이트 생성 실패(무시):', e instanceof Error ? e.message : e)
  }
}

// ── 열람 self-heal — 회의록 단위 in-flight dedupe + 60초 쿨다운 (healMissingMinuteEmbeddings 미러) ──
const insightInFlight = new Map<string, Promise<void>>()
const insightLastAttempt = new Map<string, number>()
const INSIGHT_COOLDOWN_MS = 60_000

/**
 * 인사이트가 없거나 stale 이면 생성 시도. 호출측(서버 액션)이 신선하면 아예 부르지 않지만
 * 이중 확인한다. 반환: 'ready'(이미 신선) | 'generated'(지금 생성 성공) | 'unavailable'(실패/쿨다운).
 */
export async function ensureMinuteInsights(
  minuteId: string, bodyMd: string, currentBodyHash: string,
): Promise<'ready' | 'generated' | 'unavailable'> {
  try {
    if (!hasLLM()) return 'unavailable'
    if (!(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY)) return 'unavailable'
    if (!bodyMd.trim()) return 'ready'

    const admin = createAdminClient()
    const fresh = async (): Promise<boolean> => {
      const { data } = await admin.from('minute_insights')
        .select('body_hash').eq('minute_id', minuteId)
      return !!data && data.length > 0 && data.every(r => (r.body_hash as string) === currentBodyHash)
    }
    if (await fresh()) return 'ready'

    const inflight = insightInFlight.get(minuteId)
    if (inflight) { await inflight; return (await fresh()) ? 'generated' : 'unavailable' }
    const last = insightLastAttempt.get(minuteId) ?? 0
    if (Date.now() - last < INSIGHT_COOLDOWN_MS) return 'unavailable'

    insightLastAttempt.set(minuteId, Date.now())
    const p = generateMinuteInsights(minuteId, bodyMd).finally(() => insightInFlight.delete(minuteId))
    insightInFlight.set(minuteId, p)
    await p
    return (await fresh()) ? 'generated' : 'unavailable'
  } catch (e) {
    console.error('[minutes] 인사이트 ensure 실패(무시):', e instanceof Error ? e.message : e)
    return 'unavailable'
  }
}
```

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run tests/minutes/insights-parse.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/ai/minutes-insights.ts tests/minutes/insights-parse.test.ts
git commit -m "feat(minutes): AI 인사이트 파이프라인 — generateAnswer 재사용 + 관용 파싱 + 열람 self-heal"
```

---

### Task 7: 서버 액션 — toggleMinuteHighlight / ensureMinuteInsightsAction + 데이터 레이어

**Files:**
- Modify: `src/app/actions/minutes.ts`
- Modify: `src/lib/data/minutes.ts`
- Test: 없음(순수 로직은 Task 1~3·6에서 검증 — 액션은 게이트/조합만. 기존 `tests/actions/accounts-gate.test.ts`류의 게이트 목킹 선례가 없으므로 빌드+lint로 검증)

**Interfaces:**
- Consumes: `splitMinuteBlocks`/`isMarkableBlock`/`fnv1a64`, `ensureMinuteInsights`(Task 6), `MinuteHighlight`/`MinuteInsight`(Task 2)
- Produces (Task 9~12 클라이언트가 호출):
  ```ts
  // actions/minutes.ts
  export async function toggleMinuteHighlight(minuteId: string, blockIndex: number, blockHash: string):
    Promise<{ ok: boolean; on?: boolean; error?: string }>
  export async function ensureMinuteInsightsAction(minuteId: string):
    Promise<{ status: 'ready' | 'generated' | 'unavailable' }>
  // data/minutes.ts
  export const getMinuteAnnotations: (id: string) => Promise<{ highlights: MinuteHighlight[]; insights: MinuteInsight[] }>
  ```

- [ ] **Step 1: 데이터 레이어** — `src/lib/data/minutes.ts` 끝에 추가 + import 확장:

파일 상단 import를 다음으로 교체:
```ts
import type { InsightKind, Minute, MinuteFile, MinuteHighlight, MinuteInsight, TeamCode } from '@/lib/domain/types'
```

파일 끝에 추가:
```ts
/** 뷰어 주석 데이터 — 하이라이트 전체 + AI 인사이트. 실패 시 빈 배열(뷰어는 주석 없이 동작). */
export const getMinuteAnnotations = cache(async (
  id: string,
): Promise<{ highlights: MinuteHighlight[]; insights: MinuteInsight[] }> => {
  const sb = await createServerClient()
  const [{ data: hs }, { data: ins }] = await Promise.all([
    sb.from('minute_highlights')
      .select('id, minute_id, block_index, block_hash, created_by, created_by_name, created_at')
      .eq('minute_id', id).order('created_at', { ascending: true }),
    sb.from('minute_insights')
      .select('id, minute_id, body_hash, kind, label, block_index, block_hash')
      .eq('minute_id', id),
  ])
  return {
    highlights: (hs ?? []).map((r: Row) => ({
      id: r.id as string,
      minuteId: r.minute_id as string,
      blockIndex: r.block_index as number,
      blockHash: r.block_hash as string,
      createdBy: r.created_by as string,
      createdByName: (r.created_by_name as string | null) ?? null,
      createdAt: r.created_at as string,
    })),
    insights: (ins ?? []).map((r: Row) => ({
      id: r.id as string,
      minuteId: r.minute_id as string,
      bodyHash: r.body_hash as string,
      kind: r.kind as InsightKind | 'none',
      label: r.label as string,
      blockIndex: r.block_index as number,
      blockHash: r.block_hash as string,
    })),
  }
})
```

- [ ] **Step 2: 서버 액션 추가** — `src/app/actions/minutes.ts`

import 확장 (기존 import 블록에):
```ts
import { splitMinuteBlocks, isMarkableBlock, fnv1a64 } from '@/lib/minutes/blocks'
import { rematchHighlights, type HighlightRow } from '@/lib/minutes/rematch'
import { generateMinuteInsights, ensureMinuteInsights } from '@/lib/ai/minutes-insights'
import { createAdminClient } from '@/lib/supabase/admin'
```

파일 끝에 추가:
```ts
/** 블록 하이라이트 토글 — 스펙 §6.7. 서버가 현재 본문 기준으로 (인덱스, 해시) 재검증. */
export async function toggleMinuteHighlight(
  minuteId: string, blockIndex: number, blockHash: string,
): Promise<{ ok: boolean; on?: boolean; error?: string }> {
  const m = await getMembership()
  if (!m) return { ok: false, error: '로그인 필요' }
  const user = await getSession()
  if (!user) return { ok: false, error: '로그인 필요' }
  const sb = await createServerClient()
  const { data: minute } = await sb.from('minutes').select('body_md').eq('id', minuteId).maybeSingle()
  if (!minute) return { ok: false, error: '회의록을 찾을 수 없습니다.' }
  const blocks = splitMinuteBlocks(minute.body_md as string)
  const block = blocks[blockIndex]
  if (!block || !isMarkableBlock(block) || block.hash !== blockHash)
    return { ok: false, error: '본문이 변경되었습니다. 새로고침 해주세요.' }

  const { data: existing } = await sb.from('minute_highlights')
    .select('id, block_hash').eq('minute_id', minuteId)
    .eq('created_by', user.id).eq('block_index', blockIndex).maybeSingle()

  if (existing && (existing.block_hash as string) === blockHash) {
    // 끄기
    const { error } = await sb.from('minute_highlights').delete().eq('id', existing.id as string)
    if (error) return { ok: false, error: error.message }
    revalidatePath(`/minutes/${minuteId}`)
    return { ok: true, on: false }
  }
  if (existing) {
    // stale 행(재매칭 실패 잔존, 해시 불일치) — 지우고 새로 켠다(스펙 §6.7)
    await sb.from('minute_highlights').delete().eq('id', existing.id as string)
  }
  const { error } = await sb.from('minute_highlights').insert({
    minute_id: minuteId, block_index: blockIndex, block_hash: blockHash,
    created_by: user.id, created_by_name: displayNameFrom(user.user_metadata, user.email),
  })
  // 동시 토글 경합: unique 위반은 "이미 하이라이트됨"으로 멱등 처리
  if (error && error.code !== '23505') return { ok: false, error: error.message }
  revalidatePath(`/minutes/${minuteId}`)
  return { ok: true, on: true }
}

/** 요약 카드 self-heal 트리거 — 스펙 §4.3. 멤버십 게이트(무료 쿼터 보호). */
export async function ensureMinuteInsightsAction(
  minuteId: string,
): Promise<{ status: 'ready' | 'generated' | 'unavailable' }> {
  const m = await getMembership()
  if (!m) return { status: 'unavailable' }
  const user = await getSession()
  if (!user) return { status: 'unavailable' }
  const sb = await createServerClient()
  const { data: minute } = await sb.from('minutes').select('body_md').eq('id', minuteId).maybeSingle()
  if (!minute) return { status: 'unavailable' }
  const bodyMd = minute.body_md as string
  if (!bodyMd.trim()) return { status: 'ready' }
  const status = await ensureMinuteInsights(minuteId, bodyMd, fnv1a64(bodyMd))
  if (status === 'generated') revalidatePath(`/minutes/${minuteId}`)
  return { status }
}
```

- [ ] **Step 3: 빌드·린트 검증**

Run: `npm run lint && npx vitest run tests/minutes`
Expected: PASS (lint 에러 0)

- [ ] **Step 4: Commit**

```bash
git add src/app/actions/minutes.ts src/lib/data/minutes.ts
git commit -m "feat(minutes): 하이라이트 토글·인사이트 ensure 서버 액션 + 주석 데이터 레이어"
```

---

### Task 8: after() 훅 확장 — 업로드 분류 + 교체 시 재매칭·재분류

**Files:**
- Modify: `src/app/actions/minutes.ts` (createMinute L46 / replaceMinuteBody L106 일대)

**Interfaces:**
- Consumes: `rematchHighlights`(Task 3), `generateMinuteInsights`(Task 6), `ingestMinute`(기존)

- [ ] **Step 1: createMinute 훅 교체** — 기존 46행:

```ts
  after(() => ingestMinute(data.id as string, input.bodyMd))
```
를 아래로 교체 (순차 실행 — 임베딩·분류 동시 발사 시 무료 쿼터 RPM 20 경합 방지):

```ts
  after(async () => {
    await ingestMinute(data.id as string, input.bodyMd)
    await generateMinuteInsights(data.id as string, input.bodyMd)
  })
```

- [ ] **Step 2: replaceMinuteBody 훅 교체** — 기존 106행:

```ts
  after(() => ingestMinute(id, bodyMd))
```
를 아래로 교체:

```ts
  // ① 하이라이트 재매칭(delete→reinsert, service_role) → ② 재인제스트 → ③ 인사이트 재생성 — 스펙 §4.2
  after(async () => {
    await rematchMinuteHighlights(id, bodyMd)
    await ingestMinute(id, bodyMd)
    await generateMinuteInsights(id, bodyMd)
  })
```

- [ ] **Step 3: 재매칭 실행 헬퍼 추가** — `src/app/actions/minutes.ts`의 `checkOwner` 함수 뒤에 추가 (서버 파일 내 비-export 헬퍼):

```ts
/** 본문 교체 후 하이라이트 재배정 — 실패는 로그만(표시 규칙이 오표시를 차단). service_role. */
async function rematchMinuteHighlights(minuteId: string, newBodyMd: string): Promise<void> {
  try {
    if (!(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY)) return
    const admin = createAdminClient()
    const { data: rows } = await admin.from('minute_highlights')
      .select('id, created_by, created_by_name, block_index, block_hash, created_at')
      .eq('minute_id', minuteId)
    if (!rows || rows.length === 0) return
    const { reinserts, deleteIds } = rematchHighlights(rows as unknown as HighlightRow[], splitMinuteBlocks(newBodyMd))
    if (deleteIds.length === 0 && reinserts.length === 0) return
    // delete 선실행 → insert — unique (minute_id, created_by, block_index) 충돌 원천 차단(스펙 §5)
    if (deleteIds.length) {
      const { error } = await admin.from('minute_highlights').delete().in('id', deleteIds)
      if (error) { console.error('[minutes] 재매칭 삭제 실패:', error.message); return }
    }
    if (reinserts.length) {
      const { error } = await admin.from('minute_highlights').insert(
        reinserts.map(r => ({ ...r, minute_id: minuteId })),
      )
      if (error) console.error('[minutes] 재매칭 삽입 실패:', error.message)
    }
  } catch (e) {
    console.error('[minutes] 재매칭 실패(무시):', e instanceof Error ? e.message : e)
  }
}
```

- [ ] **Step 4: 검증 + Commit**

Run: `npm run lint && npx vitest run tests/minutes`
Expected: PASS

```bash
git add src/app/actions/minutes.ts
git commit -m "feat(minutes): 업로드/교체 after() 훅 — 재매칭→재인제스트→재분류 순차 실행"
```

---

### Task 9: i18n 키 + 마킹/하이라이트 CSS

**Files:**
- Modify: `src/lib/i18n/dict/minutes.ts` (ko/en 동시)
- Modify: `src/app/globals.css` (`.minutes-md img` 규칙 뒤, 242행 일대)

- [ ] **Step 1: i18n 키 추가** — `minutesKo` 객체 끝(`'min.meta.title': '회의록 메타 수정',` 뒤)에:

```ts
  'min.insight.title': '핵심 요약',
  'min.insight.kind.decision': '결정',
  'min.insight.kind.action': '액션',
  'min.insight.kind.deadline': '기한',
  'min.insight.kind.risk': '리스크',
  'min.insight.preparing': 'AI 요약 준비 중…',
  'min.insight.unavailable': 'AI 요약을 만들지 못했습니다',
  'min.insight.retry': '다시 시도',
  'min.insight.none': 'AI가 뽑은 핵심 항목이 없습니다',
  'min.insight.attention': '많이 주목한 구간',
  'min.insight.collapse': '접기',
  'min.insight.expand': '펼치기',
  'min.hl.add': '하이라이트',
  'min.hl.remove': '하이라이트 해제',
  'min.hl.people': '하이라이트한 사람',
  'min.hl.failed': '하이라이트를 저장하지 못했습니다',
  'min.toc.title': '목차',
```

`minutesEn` 객체 끝에 (동일 키 순서):

```ts
  'min.insight.title': 'Key takeaways',
  'min.insight.kind.decision': 'Decision',
  'min.insight.kind.action': 'Action',
  'min.insight.kind.deadline': 'Deadline',
  'min.insight.kind.risk': 'Risk',
  'min.insight.preparing': 'Preparing AI summary…',
  'min.insight.unavailable': "Couldn't generate the AI summary",
  'min.insight.retry': 'Retry',
  'min.insight.none': 'No key items found',
  'min.insight.attention': 'Most highlighted',
  'min.insight.collapse': 'Collapse',
  'min.insight.expand': 'Expand',
  'min.hl.add': 'Highlight',
  'min.hl.remove': 'Remove highlight',
  'min.hl.people': 'Highlighted by',
  'min.hl.failed': "Couldn't save the highlight",
  'min.toc.title': 'Contents',
```

- [ ] **Step 2: CSS 추가** — `globals.css`의 `.minutes-md img { @apply max-w-full; }` (242행) 바로 뒤에:

```css
  /* ── 뷰어 인사이트: 속성 선택자 전용(클래스 스탬프 금지 — language-* 클로버 함정), 토큰 기반 다크 자동 ── */
  /* 마킹 가능 블록 hover 힌트 + 점프 여유 */
  .minutes-md [data-mblock] { @apply scroll-mt-16 cursor-pointer rounded-md transition-colors duration-150; }
  .minutes-md [data-mblock]:hover { @apply outline outline-1 outline-line-strong; }

  /* AI 인라인 마킹 — 좌측 3px kind 색 보더 + 은은한 배경(opacity 스케일: -weak 토큰이 accent-warning 에 없음) */
  .minutes-md [data-ins] { @apply border-l-[3px] pl-2; }
  .minutes-md [data-ins='decision'] { @apply border-done bg-done/5; }
  .minutes-md [data-ins='action'] { @apply border-progress bg-progress/5; }
  .minutes-md [data-ins='deadline'] { @apply border-accent-warning bg-accent-warning/5; }
  .minutes-md [data-ins='risk'] { @apply border-delayed bg-delayed/5; }
  /* blockquote 특례 — 기본 border-l-4 border-line 을 kind 색으로 대체(같은 변 충돌) */
  .minutes-md blockquote[data-ins='decision'] { @apply border-done; }
  .minutes-md blockquote[data-ins='action'] { @apply border-progress; }
  .minutes-md blockquote[data-ins='deadline'] { @apply border-accent-warning; }
  .minutes-md blockquote[data-ins='risk'] { @apply border-delayed; }

  /* 하이라이트 배경 3단계 (1명/2–3명/4명+) — pre code 의 bg-transparent 보다 우선하도록 pre 레벨 적용 */
  .minutes-md [data-hl='1'] { @apply bg-accent-warning/10; }
  .minutes-md [data-hl='2'] { @apply bg-accent-warning/20; }
  .minutes-md [data-hl='3'] { @apply bg-accent-warning/30; }

  /* 인원 배지 — data-hl-count 를 CSS attr() 로 표시 */
  .minutes-md [data-hl-count] { @apply relative; }
  .minutes-md [data-hl-count]::after {
    content: '👤 ' attr(data-hl-count);
    @apply absolute -top-2 right-1 rounded-full bg-accent-warning px-1.5 py-0.5 text-[10px] font-bold leading-none text-white;
  }

  /* 점프 도착 강조 — 정적 ring(상태 기반, prefers-reduced-motion 에서도 유효) */
  .minutes-md .mblock-flash { @apply outline outline-2 outline-brand; }
```

- [ ] **Step 3: 검증 + Commit**

Run: `npm run build`
Expected: 빌드 성공 (i18n 패리티 타입 통과 + Tailwind @apply 해석 성공. `outline-line-strong`/`border-accent-warning` 등 토큰 유틸이 없다고 에러 나면 해당 색 유틸명을 globals.css `@theme`의 실제 변수명(`--color-line-strong`, `--color-accent-warning`)과 대조해 수정)

```bash
git add src/lib/i18n/dict/minutes.ts src/app/globals.css
git commit -m "feat(minutes): 인사이트/하이라이트 i18n 키 + 속성 선택자 마킹 CSS"
```

---

### Task 10: MinuteInsightCard — 요약 카드 + self-heal 트리거

**Files:**
- Create: `src/components/minutes/MinuteInsightCard.tsx`

**Interfaces:**
- Consumes: `insightCardState`/`visibleInsights`/`topHighlightedBlocks`/`INS_PRIORITY`(Task 2), `ensureMinuteInsightsAction`(Task 7), i18n 키(Task 9)
- Produces (Task 12 MinuteViewer가 사용):
  ```tsx
  export function MinuteInsightCard({ minuteId, insights, highlights, blocks, bodyHash, onJump }: {
    minuteId: string; insights: MinuteInsight[]; highlights: MinuteHighlight[]; blocks: MinuteBlock[]
    bodyHash: string; onJump: (blockIndex: number) => void
  })
  ```

- [ ] **Step 1: 구현** — `src/components/minutes/MinuteInsightCard.tsx`

```tsx
'use client'
import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ChevronDown, ChevronUp, Sparkles } from 'lucide-react'
import type { InsightKind, MinuteHighlight, MinuteInsight } from '@/lib/domain/types'
import type { MinuteBlock } from '@/lib/minutes/blocks'
import {
  INS_PRIORITY, insightCardState, topHighlightedBlocks, visibleInsights,
} from '@/lib/minutes/annotations'
import { ensureMinuteInsightsAction } from '@/app/actions/minutes'
import { useLocale } from '@/components/providers/LocaleProvider'

/** kind 칩 색 — 결정=done/액션=progress/기한=accent-warning/리스크=delayed (스펙 §6.2, StatusPill 패턴). */
const KIND_CHIP: Record<InsightKind, { chip: string; dot: string }> = {
  decision: { chip: 'bg-done-weak text-done', dot: 'bg-done' },
  action: { chip: 'bg-progress-weak text-progress', dot: 'bg-progress' },
  deadline: { chip: 'bg-accent-warning/15 text-accent-warning', dot: 'bg-accent-warning' },
  risk: { chip: 'bg-delayed-weak text-delayed', dot: 'bg-delayed' },
}

export function MinuteInsightCard({
  minuteId, insights, highlights, blocks, bodyHash, onJump,
}: {
  minuteId: string
  insights: MinuteInsight[]
  highlights: MinuteHighlight[]
  blocks: MinuteBlock[]
  bodyHash: string
  onJump: (blockIndex: number) => void
}) {
  const { t } = useLocale()
  const router = useRouter()
  const [open, setOpen] = useState(true)
  const [healState, setHealState] = useState<'idle' | 'running' | 'failed'>('idle')
  const cardState = insightCardState(insights, bodyHash)
  const items = visibleInsights(insights, blocks, bodyHash)
  const attention = topHighlightedBlocks(highlights, blocks)
  const healRan = useRef(false)

  const runHeal = useCallback(() => {
    setHealState('running')
    ensureMinuteInsightsAction(minuteId).then(({ status }) => {
      if (status === 'generated') { setHealState('idle'); router.refresh() }
      else if (status === 'ready') setHealState('idle')
      else setHealState('failed')
    }).catch(() => setHealState('failed'))
  }, [minuteId, router])

  // self-heal: stale/행0(pending)일 때만 마운트 후 1회 — fresh 면 즉시 렌더(플리커 없음, 스펙 §3.3-1)
  useEffect(() => {
    if (cardState !== 'pending' || healRan.current) return
    healRan.current = true
    runHeal()
  }, [cardState, runHeal])

  // 표시할 것이 전무하면(빈 본문 등) 카드 자체를 숨김
  if (blocks.length === 0) return null

  const counts = INS_PRIORITY.map(k => [k, items.filter(i => i.kind === k).length] as const)
    .filter(([, n]) => n > 0)

  return (
    <div className="card shrink-0 p-4">
      <div className="flex items-center gap-2">
        <Sparkles className="h-4 w-4 text-brand" />
        <span className="text-sm font-bold text-ink">{t('min.insight.title')}</span>
        <span className="flex flex-wrap items-center gap-1.5">
          {counts.map(([k, n]) => (
            <span key={k} className={`chip ${KIND_CHIP[k].chip}`}>
              <span className={`h-1.5 w-1.5 rounded-full ${KIND_CHIP[k].dot}`} />
              {t(`min.insight.kind.${k}`)} {n}
            </span>
          ))}
        </span>
        <button onClick={() => setOpen(o => !o)}
          className="ml-auto inline-flex items-center gap-1 text-xs text-ink-muted hover:text-ink">
          {open ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
          {open ? t('min.insight.collapse') : t('min.insight.expand')}
        </button>
      </div>

      {open && (
        <div className="mt-2 max-h-60 space-y-2 overflow-y-auto">
          {cardState === 'pending' && healState !== 'failed' && (
            <p className="text-sm text-ink-muted">{t('min.insight.preparing')}</p>
          )}
          {cardState === 'pending' && healState === 'failed' && (
            <p className="text-sm text-ink-muted">
              {t('min.insight.unavailable')}
              <button onClick={runHeal} className="ml-2 text-brand underline underline-offset-2">
                {t('min.insight.retry')}
              </button>
            </p>
          )}
          {cardState === 'empty' && (
            <p className="text-sm text-ink-muted">{t('min.insight.none')}</p>
          )}
          {cardState === 'ready' && (
            <ul className="space-y-1">
              {INS_PRIORITY.flatMap(k => items.filter(i => i.kind === k)).map(i => (
                <li key={i.id}>
                  <button onClick={() => onJump(i.blockIndex)}
                    className="flex w-full items-start gap-2 rounded-lg px-1.5 py-1 text-left text-sm text-ink hover:bg-surface-2">
                    <span className={`chip mt-0.5 shrink-0 ${KIND_CHIP[i.kind as InsightKind].chip}`}>
                      {t(`min.insight.kind.${i.kind}`)}
                    </span>
                    {/* 순수 텍스트 렌더 — LLM 산출물 링크화 금지(프롬프트 인젝션 차단, 스펙 §6.2) */}
                    <span className="min-w-0 flex-1">{i.label}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {attention.length > 0 && (
            <div className="border-t border-line pt-2">
              <p className="eyebrow mb-1">{t('min.insight.attention')}</p>
              <ul className="space-y-1">
                {attention.map(a => (
                  <li key={a.blockIndex}>
                    <button onClick={() => onJump(a.blockIndex)}
                      className="flex w-full items-center gap-2 rounded-lg px-1.5 py-1 text-left text-sm text-ink-muted hover:bg-surface-2">
                      <span className="min-w-0 flex-1 truncate">“{a.excerpt}”</span>
                      <span className="chip shrink-0 bg-accent-warning/15 text-accent-warning">👤 {a.count}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

```

(import 줄의 `useCallback` 포함 확인: `import { useCallback, useEffect, useRef, useState } from 'react'`.)

**인젝션 방어 검증(구현자 필수 확인):** `label`·`excerpt`가 `MarkdownView`·`linkify` 등 어떤 렌더러도 거치지 않고 React 텍스트 노드로만 출력되는지 — `grep -n "label" src/components/minutes/MinuteInsightCard.tsx`로 `{i.label}` 순수 출력만 존재해야 한다(스펙 §6.2·§8).

- [ ] **Step 2: 검증 + Commit**

Run: `npm run lint && npm run build`
Expected: PASS

```bash
git add src/components/minutes/MinuteInsightCard.tsx
git commit -m "feat(minutes): 핵심 요약 카드 — kind 칩·주목 구간·self-heal 트리거"
```

---

### Task 11: MinuteToc + MinuteBlockPopover

**Files:**
- Create: `src/components/minutes/MinuteToc.tsx`
- Create: `src/components/minutes/MinuteBlockPopover.tsx`

**Interfaces:**
- Consumes: `MinuteBlock`/`InsightKind`(Task 1·2), `visibleHighlights`(Task 2), i18n(Task 9)
- Produces (Task 12가 사용):
  ```tsx
  export function MinuteToc({ blocks, insights, highlights, onJump, activeIndex }: {
    blocks: MinuteBlock[]; insights: MinuteInsight[]; highlights: MinuteHighlight[]
    onJump: (blockIndex: number) => void; activeIndex: number | null
  })  // 헤딩 depth 1~3 없으면 null 렌더
  export interface PopoverState { blockIndex: number; rect: { top: number; bottom: number; left: number; width: number } }
  export function MinuteBlockPopover({ state, mine, names, insKinds, busy, onToggle, onClose }: {
    state: PopoverState; mine: boolean; names: string[]; insKinds: InsightKind[]
    busy: boolean; onToggle: () => void; onClose: () => void
  })
  ```

- [ ] **Step 1: MinuteToc 구현** — `src/components/minutes/MinuteToc.tsx`

```tsx
'use client'
import { useMemo, useState } from 'react'
import { ChevronDown, ChevronRight, List } from 'lucide-react'
import type { InsightKind, MinuteHighlight, MinuteInsight } from '@/lib/domain/types'
import type { MinuteBlock } from '@/lib/minutes/blocks'
import { visibleHighlights } from '@/lib/minutes/annotations'
import { useLocale } from '@/components/providers/LocaleProvider'

const KIND_DOT: Record<InsightKind, string> = {
  decision: 'bg-done', action: 'bg-progress', deadline: 'bg-accent-warning', risk: 'bg-delayed',
}

interface TocEntry {
  blockIndex: number
  depth: number
  text: string
  kinds: InsightKind[]   // 담당 구간에 존재하는 kind (중복 제거)
  hlCount: number        // 담당 구간 하이라이트 블록 수
}

/** 담당 구간 = 이 헤딩 ~ 다음 depth≤3 헤딩 직전 (h4+ 하위 구간은 상위 항목 귀속 — 스펙 §6.6). */
function buildEntries(
  blocks: MinuteBlock[], insights: MinuteInsight[], highlights: MinuteHighlight[],
): TocEntry[] {
  const heads = blocks.filter(b => b.headingDepth !== undefined && b.headingDepth <= 3)
  if (heads.length === 0) return []
  const vis = visibleHighlights(highlights, blocks)
  return heads.map((h, i) => {
    const end = i + 1 < heads.length ? heads[i + 1].index : blocks.length
    const inRange = (idx: number) => idx >= h.index && idx < end
    const kinds = [...new Set(
      insights.filter(x => x.kind !== 'none' && inRange(x.blockIndex)).map(x => x.kind as InsightKind),
    )]
    const hlCount = new Set(vis.filter(x => inRange(x.blockIndex)).map(x => x.blockIndex)).size
    return { blockIndex: h.index, depth: h.headingDepth!, text: h.text, kinds, hlCount }
  })
}

export function MinuteToc({
  blocks, insights, highlights, onJump, activeIndex,
}: {
  blocks: MinuteBlock[]
  insights: MinuteInsight[]
  highlights: MinuteHighlight[]
  onJump: (blockIndex: number) => void
  activeIndex: number | null
}) {
  const { t } = useLocale()
  const [mobileOpen, setMobileOpen] = useState(false)
  const entries = useMemo(() => buildEntries(blocks, insights, highlights), [blocks, insights, highlights])
  if (entries.length === 0) return null

  const list = (onItem?: () => void) => (
    <ul className="space-y-0.5">
      {entries.map(e => (
        <li key={e.blockIndex}>
          <button onClick={() => { onJump(e.blockIndex); onItem?.() }}
            className={`flex w-full items-center gap-1.5 rounded-lg px-2 py-1 text-left text-[13px] transition
              ${activeIndex === e.blockIndex ? 'bg-brand-weak font-semibold text-brand' : 'text-ink-muted hover:bg-surface-2 hover:text-ink'}`}
            style={{ paddingLeft: `${8 + (e.depth - 1) * 12}px` }}>
            <span className="min-w-0 flex-1 truncate">{e.text}</span>
            <span className="flex shrink-0 items-center gap-0.5">
              {e.kinds.map(k => <span key={k} className={`h-1.5 w-1.5 rounded-full ${KIND_DOT[k]}`} />)}
              {e.hlCount > 0 && <span className="h-1.5 w-1.5 rounded-full bg-accent-warning" />}
            </span>
          </button>
        </li>
      ))}
    </ul>
  )

  return (
    <>
      {/* xl: 좌측 상주 컬럼 (자체 스크롤) */}
      <nav className="card hidden w-[220px] shrink-0 self-start p-3 xl:block xl:max-h-full xl:overflow-y-auto">
        <p className="eyebrow mb-2">{t('min.toc.title')}</p>
        {list()}
      </nav>
      {/* xl 미만: 접이식 바 — 점프 후 자동 접힘, 접힘 중 스파이 비활성(activeIndex 미표시 무해) */}
      <div className="card shrink-0 p-3 xl:hidden">
        <button onClick={() => setMobileOpen(o => !o)}
          className="flex w-full items-center gap-2 text-sm font-semibold text-ink">
          <List className="h-4 w-4 text-brand" />{t('min.toc.title')}
          {mobileOpen ? <ChevronDown className="ml-auto h-4 w-4" /> : <ChevronRight className="ml-auto h-4 w-4" />}
        </button>
        {mobileOpen && <div className="mt-2">{list(() => setMobileOpen(false))}</div>}
      </div>
    </>
  )
}
```

- [ ] **Step 2: MinuteBlockPopover 구현** — `src/components/minutes/MinuteBlockPopover.tsx`

```tsx
'use client'
import { useEffect } from 'react'
import { Highlighter, Users } from 'lucide-react'
import type { InsightKind } from '@/lib/domain/types'
import { useLocale } from '@/components/providers/LocaleProvider'

const KIND_CHIP: Record<InsightKind, string> = {
  decision: 'bg-done-weak text-done',
  action: 'bg-progress-weak text-progress',
  deadline: 'bg-accent-warning/15 text-accent-warning',
  risk: 'bg-delayed-weak text-delayed',
}

export interface PopoverState {
  blockIndex: number
  rect: { top: number; bottom: number; left: number; width: number }  // getBoundingClientRect 스냅샷
}

/** 블록 팝오버 — fixed 배치(블록 하단 우선·상단 플립·좌우 클램프), 스크롤/리사이즈/외부 클릭 시 닫힘. 스펙 §6.4. */
export function MinuteBlockPopover({
  state, mine, names, insKinds, busy, onToggle, onClose,
}: {
  state: PopoverState
  mine: boolean
  names: string[]
  insKinds: InsightKind[]
  busy: boolean
  onToggle: () => void
  onClose: () => void
}) {
  const { t } = useLocale()

  useEffect(() => {
    const close = () => onClose()
    window.addEventListener('scroll', close, true)  // capture — 본문 카드 내부 스크롤도 감지
    window.addEventListener('resize', close)
    return () => {
      window.removeEventListener('scroll', close, true)
      window.removeEventListener('resize', close)
    }
  }, [onClose])

  const W = 260
  const left = Math.min(Math.max(8, state.rect.left), window.innerWidth - W - 8)
  const below = state.rect.bottom + 180 < window.innerHeight
  const pos = below
    ? { top: state.rect.bottom + 6, left }
    : { top: Math.max(8, state.rect.top - 6 - 180), left }

  return (
    <>
      <button className="fixed inset-0 z-[90] cursor-default" aria-label="닫기" onClick={onClose} />
      <div style={{ position: 'fixed', width: W, ...pos }}
        className="z-[95] overflow-hidden rounded-2xl border border-line bg-surface p-3 shadow-[var(--shadow-lg)]">
        {insKinds.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-1">
            {insKinds.map(k => (
              <span key={k} className={`chip ${KIND_CHIP[k]}`}>{t(`min.insight.kind.${k}`)}</span>
            ))}
          </div>
        )}
        <button onClick={onToggle} disabled={busy}
          className={`btn h-9 w-full ${mine ? 'bg-accent-warning/15 text-accent-warning' : 'btn-ghost'}`}>
          <Highlighter className="h-4 w-4" />
          {mine ? t('min.hl.remove') : t('min.hl.add')}
        </button>
        {names.length > 0 && (
          <div className="mt-2 border-t border-line pt-2">
            <p className="mb-1 inline-flex items-center gap-1 text-[11px] font-semibold text-ink-subtle">
              <Users className="h-3 w-3" />{t('min.hl.people')}
            </p>
            <p className="text-xs leading-relaxed text-ink-muted">{names.join(', ')}</p>
          </div>
        )}
      </div>
    </>
  )
}
```

- [ ] **Step 3: 검증 + Commit**

Run: `npm run lint && npm run build`
Expected: PASS

```bash
git add src/components/minutes/MinuteToc.tsx src/components/minutes/MinuteBlockPopover.tsx
git commit -m "feat(minutes): 목차(도트·스파이) + 블록 팝오버(fixed 배치·명단·토글) 컴포넌트"
```

---

### Task 12: MinuteViewer 통합 — 레이아웃 + 낙관적 토글 + 점프/스파이

**Files:**
- Modify: `src/components/minutes/MinuteViewer.tsx`
- Modify: `src/app/(app)/minutes/[id]/page.tsx`

**Interfaces:**
- Consumes: 전부(Task 1~11). `MinuteViewer` props에 `annotations: { highlights: MinuteHighlight[]; insights: MinuteInsight[] }`, `userId: string | null` 추가.

- [ ] **Step 1: 페이지 수정** — `src/app/(app)/minutes/[id]/page.tsx` 전체 교체:

```tsx
import { notFound } from 'next/navigation'
import { getMinuteDetail, getMinuteAnnotations } from '@/lib/data/minutes'
import { getMembership, getSession } from '@/lib/auth'
import { MinuteViewer } from '@/components/minutes/MinuteViewer'

export default async function MinuteDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const [detail, annotations, m, user] = await Promise.all([
    getMinuteDetail(id), getMinuteAnnotations(id), getMembership(), getSession(),
  ])
  if (!detail) notFound()
  const canManage = !!user && (detail.minute.createdBy === user.id || m?.role === 'pmo_admin')
  return (
    <MinuteViewer
      minute={detail.minute} files={detail.files} canManage={canManage}
      annotations={annotations} userId={user?.id ?? null}
    />
  )
}
```

- [ ] **Step 2: MinuteViewer 수정** — 변경 요지: props 확장, 파생 상태(블록·marks), 본문 카드에 이벤트 위임 + ref, 요약 카드/TOC 배치, 팝오버 상태, 낙관적 토글.

`src/components/minutes/MinuteViewer.tsx`에서:

**(a) import 추가** (기존 import 뒤):

```tsx
import { useCallback, useMemo, useRef } from 'react'   // 기존 useState import 줄에 병합
import { fnv1a64, isMarkableBlock, splitMinuteBlocks, type BlockMarks } from '@/lib/minutes/blocks'
import { INS_PRIORITY, hlTier, visibleHighlights, visibleInsights } from '@/lib/minutes/annotations'
import { toggleMinuteHighlight } from '@/app/actions/minutes'
import type { InsightKind, MinuteHighlight, MinuteInsight } from '@/lib/domain/types'
import { MinuteInsightCard } from './MinuteInsightCard'
import { MinuteToc } from './MinuteToc'
import { MinuteBlockPopover, type PopoverState } from './MinuteBlockPopover'
import { useToast } from '@/components/ui/Toast'
```

**(b) 컴포넌트 시그니처 교체**:

```tsx
export function MinuteViewer({
  minute, files, canManage, annotations, userId,
}: {
  minute: Minute
  files: MinuteFile[]
  canManage: boolean
  annotations: { highlights: MinuteHighlight[]; insights: MinuteInsight[] }
  userId: string | null
}) {
```

**(c) 기존 state 선언들 뒤에 파생 상태·핸들러 추가**:

```tsx
  const { toast } = useToast()
  const bodyRef = useRef<HTMLDivElement>(null)
  const [popover, setPopover] = useState<PopoverState | null>(null)
  const [hlBusy, setHlBusy] = useState(false)
  const [activeToc, setActiveToc] = useState<number | null>(null)

  const blocks = useMemo(() => splitMinuteBlocks(minute.bodyMd), [minute.bodyMd])
  const bodyHash = useMemo(() => fnv1a64(minute.bodyMd), [minute.bodyMd])

  // 낙관적 병합 계약(스펙 §6.4): 내 하이라이트는 로컬 단독 소유(서버 prop 은 초기값),
  // 타인 하이라이트는 항상 서버 prop 파생 — revalidate 가 와도 이중 계산/역전 없음.
  const [myIndexes, setMyIndexes] = useState<Set<number>>(() => new Set(
    visibleHighlights(annotations.highlights, blocks)
      .filter(h => h.createdBy === userId).map(h => h.blockIndex),
  ))
  const others = useMemo(
    () => visibleHighlights(annotations.highlights, blocks).filter(h => h.createdBy !== userId),
    [annotations.highlights, blocks, userId],
  )
  const insights = useMemo(
    () => visibleInsights(annotations.insights, blocks, bodyHash),
    [annotations.insights, blocks, bodyHash],
  )

  const marks = useMemo<BlockMarks>(() => {
    const m: BlockMarks = {}
    for (const i of insights) {
      const k = i.kind as InsightKind
      const cur = m[i.blockIndex]?.ins
      // 복수 kind 는 우선순위 최상위 1개만 인라인 표시(스펙 §6.3)
      if (!cur || INS_PRIORITY.indexOf(k) < INS_PRIORITY.indexOf(cur)) {
        m[i.blockIndex] = { ...m[i.blockIndex], ins: k }
      }
    }
    const counts = new Map<number, Set<string>>()
    for (const h of others) {
      if (!counts.has(h.blockIndex)) counts.set(h.blockIndex, new Set())
      counts.get(h.blockIndex)!.add(h.createdBy)
    }
    for (const idx of myIndexes) {
      if (!counts.has(idx)) counts.set(idx, new Set())
      counts.get(idx)!.add('me')
    }
    for (const [idx, users] of counts) {
      m[idx] = { ...m[idx], hlTier: hlTier(users.size), hlCount: users.size }
    }
    return m
  }, [insights, others, myIndexes])

  // 점프 — 스크롤 컨테이너(xl=본문 카드/미만=main) 차이는 scrollIntoView 가 자동 처리
  const jumpTo = useCallback((blockIndex: number) => {
    const el = bodyRef.current?.querySelector<HTMLElement>(`[data-mblock="${blockIndex}"]`)
    if (!el) return  // 비렌더 블록 — 조용히 무시(스펙 §6.5)
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    el.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' })
    el.classList.add('mblock-flash')
    setTimeout(() => el.classList.remove('mblock-flash'), 2000)
  }, [])

  // 블록 클릭 → 팝오버 (이벤트 위임 — 링크/버튼/드래그 선택 제외, 스펙 §6.4)
  const onBodyClick = useCallback((e: React.MouseEvent) => {
    const target = e.target as HTMLElement
    if (target.closest('a, button')) return
    if (window.getSelection()?.toString()) return
    const blockEl = target.closest<HTMLElement>('[data-mblock]')
    if (!blockEl) return
    const idx = Number(blockEl.dataset.mblock)
    if (!blocks[idx] || !isMarkableBlock(blocks[idx])) return
    const r = blockEl.getBoundingClientRect()
    setPopover({ blockIndex: idx, rect: { top: r.top, bottom: r.bottom, left: r.left, width: r.width } })
  }, [blocks])

  async function onToggleHighlight() {
    if (!popover) return
    const idx = popover.blockIndex
    const wasOn = myIndexes.has(idx)
    // 낙관적 업데이트 → 실패 시 롤백 + 토스트
    setMyIndexes(prev => { const s = new Set(prev); if (wasOn) s.delete(idx); else s.add(idx); return s })
    setHlBusy(true)
    const res = await toggleMinuteHighlight(minute.id, idx, blocks[idx].hash)
    setHlBusy(false)
    setPopover(null)
    if (!res.ok) {
      setMyIndexes(prev => { const s = new Set(prev); if (wasOn) s.add(idx); else s.delete(idx); return s })
      toast({ title: t('min.hl.failed'), description: res.error, variant: 'error' })
    }
  }

  // TOC 스크롤 스파이 — 교차 중 최상단 헤딩(없으면 마지막 통과 헤딩), root null 로 두 레이아웃 공통
  const headingIndexes = useMemo(
    () => blocks.filter(b => b.headingDepth !== undefined && b.headingDepth <= 3).map(b => b.index),
    [blocks],
  )
  useEffect(() => {
    if (headingIndexes.length === 0 || !bodyRef.current) return
    const els = headingIndexes
      .map(i => bodyRef.current!.querySelector<HTMLElement>(`[data-mblock="${i}"]`))
      .filter((el): el is HTMLElement => !!el)
    if (els.length === 0) return
    const io = new IntersectionObserver(entries => {
      const visible = entries.filter(en => en.isIntersecting)
        .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)
      if (visible.length > 0) {
        const idx = Number((visible[0].target as HTMLElement).dataset.mblock)
        setActiveToc(idx)
      }
    }, { root: null, rootMargin: '0px 0px -70% 0px' })
    els.forEach(el => io.observe(el))
    return () => io.disconnect()
  }, [headingIndexes])
```

(`useEffect`를 쓰므로 react import에 `useEffect` 포함 확인.)

**(d) 팝오버에 넘길 파생값** — return 직전에:

```tsx
  const popNames = popover
    ? [...new Set(others.filter(h => h.blockIndex === popover.blockIndex)
        .map(h => h.createdByName ?? '이름 없음'))]
    : []
  const popKinds = popover
    ? [...new Set(insights.filter(i => i.blockIndex === popover.blockIndex).map(i => i.kind as InsightKind))]
    : []
```

**(e) JSX 배치 교체** — 기존 "메타 헤더" 카드 뒤, "본문 + 채팅" 행을 아래로 교체:

```tsx
      {/* 핵심 요약 카드 — shrink-0 유지(xl 높이 체인) */}
      <MinuteInsightCard
        minuteId={minute.id} insights={annotations.insights} highlights={annotations.highlights}
        blocks={blocks} bodyHash={bodyHash} onJump={jumpTo}
      />

      {/* xl 미만 목차 아코디언은 MinuteToc 내부에서 분기 렌더 */}
      {/* 목차 + 본문 + 채팅 */}
      <div className="flex flex-col gap-4 xl:min-h-0 xl:flex-1 xl:flex-row">
        <MinuteToc
          blocks={blocks} insights={insights} highlights={annotations.highlights}
          onJump={jumpTo} activeIndex={activeToc}
        />
        <div ref={bodyRef} onClick={onBodyClick} className="card min-w-0 flex-1 p-5 xl:overflow-y-auto">
          <MarkdownView content={minute.bodyMd} marks={marks} />
        </div>
        <MinuteChatPanel minuteId={minute.id} />
      </div>

      {popover && (
        <MinuteBlockPopover
          state={popover} mine={myIndexes.has(popover.blockIndex)}
          names={popNames} insKinds={popKinds} busy={hlBusy}
          onToggle={() => void onToggleHighlight()} onClose={() => setPopover(null)}
        />
      )}
```

**모바일 스택 순서 확인:** 부모 행이 `flex flex-col … xl:flex-row`이므로 `MinuteToc`가 행의 첫 자식인 위 JSX만으로 xl 미만 스택 순서가 "메타 → 요약 → 목차 아코디언 → 본문 → 채팅"이 된다(스펙 §6.1). MinuteToc 내부에서 xl 컬럼(`hidden xl:block`)과 아코디언(`xl:hidden`)을 분기 렌더하므로 별도 배치 분리는 불필요.

- [ ] **Step 3: 검증**

Run: `npm run lint && npm run build && npx vitest run tests/minutes`
Expected: 전부 PASS

- [ ] **Step 4: Commit**

```bash
git add src/components/minutes/MinuteViewer.tsx "src/app/(app)/minutes/[id]/page.tsx"
git commit -m "feat(minutes): 뷰어 통합 — 요약 카드·목차·인라인 마킹·낙관적 하이라이트 토글"
```

---

### Task 13: 전체 게이트 — 회귀 + 빌드

- [ ] **Step 1: 전체 테스트**

Run: `npx vitest run`
Expected: 전체 PASS (기존 report/ai/domain 테스트 포함 — 워킹트리의 무관한 병렬 세션 변경이 실패하면 그 실패가 이 작업 이전부터인지 `git stash` 없이 파일 목록으로 판별하고, 이 작업 파일과 무관하면 그대로 보고만)

- [ ] **Step 2: 린트 + 빌드**

Run: `npm run lint && npm run build`
Expected: PASS

- [ ] **Step 3: Commit (잔여 변경이 있으면)**

```bash
git status --short   # 이 작업의 파일만 스테이징돼 있는지 확인 (report/excel 등 무관 파일 제외)
```

---

### Task 14: 배포 (사용자 개입 게이트)

- [ ] **Step 1: 마이그레이션 프로덕션 적용** — **코드 배포보다 먼저**. Supabase Management API 레시피(키체인 토큰 → `POST /v1/projects/rglfgrwwwwdqejohdnty/database/query`)로 `0025_minute_annotations.sql` 실행. **사용자 확인 후 진행** (프로덕션 DB — 로컬 dev도 공유).

- [ ] **Step 2: main 푸시 → Vercel 배포 확인** (`/deploy` 스킬 관례).

- [ ] **Step 3: 스모크 (전용 테스트 프로젝트 회의록에서만 — 운영 D-CUBE 데이터 불가침)**
  1. 테스트 회의록 업로드 → 요약 카드 생성 확인 (after() 훅)
  2. 블록 클릭 → 하이라이트 토글 → 인원 배지·팝오버 명단 확인
  3. 본문 교체(.md 재업로드) → 하이라이트 재매칭·인사이트 재생성 확인
  4. 배포 이전 업로드된 기존 회의록 열람 → self-heal 로 요약 생성 확인
  5. 목차 점프·플래시, 모바일(좁은 창) 스택 순서 확인
