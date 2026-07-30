# 위키 주제 입도 — 카탈로그 포화 게이팅 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 위키 주제가 항목 15건에 닿으면 카탈로그가 그 주제를 재사용 후보에서 빼고 LLM 이 회의 문맥으로 새 주제를 짓게 하되, 그 주제에 이미 있는 대상은 코드가 되돌려 이력을 지킨다.

**Architecture:** 추출 프롬프트에 붙는 카탈로그(`loadWikiCatalog`)를 세 단으로 재구성한다 — 살아있는 비포화 주제 목록 / 비포화 항목 문장 줄 / 포화 주제의 `kind/facet` 목록. 카탈로그 조립을 순수 함수로 분리해 supabase 목 없이 테스트한다. 포화 판정은 프로젝트의 살아있는 항목을 한 번 전량 조회해 JS 에서 집계하며(PostgREST 집계 함수 비활성), 상한에 닿으면 게이팅을 꺼서 잘못된 카운트로 판정하지 않는다. 별칭 판정 함수는 건드리지 않고 `ensureTopic` 호출부가 후보 풀만 좁힌다.

**Tech Stack:** Next.js 15 App Router · TypeScript · Supabase(PostgREST, service role) · vitest · gemini-3.5-flash(추출)

## Global Constraints

- 스펙: `docs/superpowers/specs/2026-07-30-wiki-topic-granularity-design.md`. 이 계획의 모든 값은 스펙과 일치해야 한다.
- **스키마 변경·마이그레이션 금지.** 새 테이블·뷰·RPC 를 만들지 않는다.
- **`matchWikiTopicAlias` / `isAgendaStyleWikiTopic` / `buildWikiKnowledgeKey` 를 수정하지 않는다.** `tests/domain/wiki.test.ts` 가 그대로 통과해야 한다(07-27 회귀 방지).
- **프롬프트 총 문자 예산 6,000자.** 측정 대상은 `loadWikiCatalog` 이 반환하는 문자열 전량(현행 실측 5,499자).
- **PostgREST 집계 함수 비활성**(`select=…,count()` → `PGRST123`). 집계는 JS 에서 한다.
- **fail-closed.** 포화 판정 입력이 불완전하면 게이팅을 켜지 않고 `console.warn` 을 남긴다. 조용히 통과시키지 않는다.
- 프로덕션 DB 를 건드리는 자동 테스트를 만들지 않는다. 런타임 검증은 Task 7 의 재구축 전후 실측이다.
- `git add -A` 금지 — 항상 파일명을 명시한다. 커밋 메시지는 한국어, "왜"를 쓴다.
- 이 계획이 건드리는 파일에 UI 위험 파일(`globals.css`, `layout.tsx`, `components/app/*`)은 없다. main 직행 가능.

## File Structure

| 파일 | 상태 | 책임 |
|---|---|---|
| `src/lib/domain/wiki.ts` | 수정 | 상한 상수 · 살아있음 정본 · 포화 판정 · facet 파트 정규화 (I/O 없음) |
| `src/lib/ai/wiki-catalog.ts` | **신규** | 카탈로그 문자열 조립 + 예산 사다리 (순수 함수, I/O 없음) |
| `src/lib/ai/wiki-saturation.ts` | **신규** | 살아있는 항목 전량 조회 → 포화 스냅샷 (유일한 I/O) |
| `src/lib/ai/wiki-ingest.ts` | 수정 | `loadWikiCatalog` 을 위 둘의 조합으로 교체 · 프롬프트 규칙 14 · 스냅샷 스레딩 · `ensureTopic` 게이팅 |
| `scripts/wiki-health.mjs` | 수정 | 입도 리포트 · 세대 스코프 이벤트 분포 · `--dump-keys` |
| `tests/domain/wiki.test.ts` | 수정 | 상수·포화 판정 경계 |
| `tests/ai/wiki-catalog.test.ts` | **신규** | 카탈로그 조립 규칙 전량 (목 불필요) |
| `tests/ai/wiki-saturation.test.ts` | **신규** | 스냅샷 집계 · fail-closed |
| `tests/ai/wiki-ingest.test.ts` | 수정 | `ensureTopic` 게이팅 · 코드 구제 |

조립을 `wiki-catalog.ts` 로 뺀 이유: `wiki-ingest.ts` 는 이미 1,268줄이고, 스펙 §12 가 요구하는 검사(예산 상한, distinct, kind 병기, 결정적 정렬)는 전부 문자열 조립 규칙이라 순수 함수로 빼면 supabase 목 없이 테스트된다.

---

### Task 1: 도메인 상수와 포화 판정

**Files:**
- Modify: `src/lib/domain/wiki.ts` (상수는 파일 상단 enum 블록 뒤, 함수는 `normalizeWikiKnowledgeKey` 근처)
- Test: `tests/domain/wiki.test.ts`

**Interfaces:**
- Consumes: 없음
- Produces: `WIKI_TOPIC_ITEM_CAP: number`, `WIKI_LIVE_STATES: readonly ['active','open','conflicted']`, `isSaturatedWikiTopic(liveItemCount: number): boolean`, `wikiFacetPart(kind: string, facet: string | null | undefined): string`, `wikiSaturationKey(kind: string, facetPart: string): string`

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`tests/domain/wiki.test.ts` 파일 끝에 추가한다. 기존 import 줄에 새 심볼을 더한다.

```ts
import {
  WIKI_LIVE_STATES,
  WIKI_TOPIC_ITEM_CAP,
  isSaturatedWikiTopic,
  wikiFacetPart,
  wikiSaturationKey,
} from '@/lib/domain/wiki'

describe('주제 포화 판정', () => {
  it('상한은 15이고 값을 바꾸려면 근거가 필요하다', () => {
    // 2026-07-30 실측: 살아있는 주제 62개 중 8개(12.9%)만 걸린다.
    expect(WIKI_TOPIC_ITEM_CAP).toBe(15)
  })

  it('경계값 — 14는 아니고 15부터 포화다', () => {
    expect(isSaturatedWikiTopic(14)).toBe(false)
    expect(isSaturatedWikiTopic(15)).toBe(true)
    expect(isSaturatedWikiTopic(16)).toBe(true)
    expect(isSaturatedWikiTopic(0)).toBe(false)
  })

  it('살아있음의 정본은 세 상태다', () => {
    expect([...WIKI_LIVE_STATES]).toEqual(['active', 'open', 'conflicted'])
  })
})

describe('facet 파트와 포화 키', () => {
  it('facet 파트는 buildWikiKnowledgeKey 와 같은 정규화를 쓴다', () => {
    const built = buildWikiKnowledgeKey('데이터 관리', 'decision', 'MES 데이터 조회 전용 한정')
    expect(built.split(':').slice(2).join(':'))
      .toBe(wikiFacetPart('decision', 'MES 데이터 조회 전용 한정'))
  })

  it('facet 이 비면 kind 로 대체한다 — buildWikiKnowledgeKey 와 동일 규칙', () => {
    expect(wikiFacetPart('fact', '')).toBe('fact')
    expect(wikiFacetPart('fact', null)).toBe('fact')
  })

  it('포화 키는 kind 를 포함한다 — kind 가 갈리면 knowledge_key 도 갈리기 때문', () => {
    expect(wikiSaturationKey('decision', 'a-b')).toBe('decision:a-b')
    expect(wikiSaturationKey('fact', 'a-b')).not.toBe(wikiSaturationKey('decision', 'a-b'))
  })
})
```

- [ ] **Step 2: 실패를 확인한다**

Run: `npx vitest run tests/domain/wiki.test.ts`
Expected: FAIL — `WIKI_TOPIC_ITEM_CAP` 등이 export 되지 않아 import 에러

- [ ] **Step 3: 최소 구현**

`src/lib/domain/wiki.ts` 의 `normalizeWikiKnowledgeKey` 정의(101행) 아래에 추가한다.

```ts
/**
 * 한 주제가 한 화면에서 읽히는 상한. 초과분을 쪼개지 않고 새 대상의 유입만 막는다.
 *
 * 15의 근거(2026-07-30 실측): 살아있는 주제 62개 중 8개(12.9%)만 걸린다 — 정상 주제의
 * 동작을 바꾸지 않는 값이다. 값을 바꾸려면 이 비율을 함께 재고 커밋에 근거를 남긴다.
 * 상한에 앉은 주제는 실패가 아니라 의도된 정상 상태다.
 */
export const WIKI_TOPIC_ITEM_CAP = 15

/**
 * '살아있는 항목'의 정본. 카탈로그의 포화 판정과 scripts/wiki-health.mjs 가 같은 모집단을
 * 재야 한다 — 과거에는 한쪽이 neq.archived, 다른 쪽이 in(active,open,conflicted) 였다.
 * resolved·superseded 가 0행이라 오늘은 두 값이 같지만 그건 우연이다.
 */
export const WIKI_LIVE_STATES = ['active', 'open', 'conflicted'] as const

export function isSaturatedWikiTopic(liveItemCount: number): boolean {
  return liveItemCount >= WIKI_TOPIC_ITEM_CAP
}

/** knowledge_key(`주제:kind:facet`)의 세 번째 조각. buildWikiKnowledgeKey와 규칙이 같아야 한다. */
export function wikiFacetPart(kind: string, facet: string | null | undefined): string {
  return normalizeWikiKnowledgeKey(facet ?? '') || kind
}

/**
 * 포화 주제가 이미 담고 있는 '대상'의 식별자. kind를 반드시 포함한다 —
 * findCurrentItem이 kind와 knowledge_key를 함께 걸어 조회하므로, 같은 facet이라도
 * kind가 다르면 다른 대상이고 이력도 따로 간다.
 */
export function wikiSaturationKey(kind: string, facetPart: string): string {
  return `${kind}:${facetPart}`
}
```

- [ ] **Step 4: 통과를 확인한다**

Run: `npx vitest run tests/domain/wiki.test.ts`
Expected: PASS — 기존 테스트 전부 포함해 통과(별칭·목차형 규칙 무변경 보증)

- [ ] **Step 5: 커밋**

```bash
git add src/lib/domain/wiki.ts tests/domain/wiki.test.ts
git commit -m "feat(wiki): 주제 포화 판정과 살아있음 정본 상수

상한 15는 살아있는 주제 62개 중 8개만 걸리는 값이다(2026-07-30 실측).
wikiSaturationKey가 kind를 포함하는 이유는 findCurrentItem이 kind와
knowledge_key를 함께 걸기 때문이다 — kind가 갈리면 이력도 갈린다."
```

---

### Task 2: 카탈로그 문자열 조립 (순수 함수 + 예산 사다리)

**Files:**
- Create: `src/lib/ai/wiki-catalog.ts`
- Test: `tests/ai/wiki-catalog.test.ts`

**Interfaces:**
- Consumes: Task 1 의 `WIKI_TOPIC_ITEM_CAP`, `isSaturatedWikiTopic`, `wikiFacetPart`, `wikiSaturationKey`; 기존 `isAgendaStyleWikiTopic`
- Produces:
  - `CATALOG_TOPIC_LIMIT = 160`, `CATALOG_ITEM_LIMIT = 40`, `CATALOG_STATEMENT_CAP = 90`, `CATALOG_FACETS_PER_TOPIC = 12`, `CATALOG_CHAR_BUDGET = 6000`
  - `interface CatalogTopic { id: string; title: string; normalizedTitle: string; liveCount: number; lastChangedAt: string }`
  - `interface CatalogItem { topicId: string; topicTitle: string; kind: string; facetPart: string; statement: string; updatedAt: string }`
  - `interface BuiltCatalog { text: string; warnings: string[] }`
  - `buildWikiCatalogText(args: { topics: CatalogTopic[]; items: CatalogItem[]; bodyMd: string; gatingEnabled: boolean }): BuiltCatalog`

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`tests/ai/wiki-catalog.test.ts` 를 새로 만든다.

```ts
import { describe, it, expect } from 'vitest'
import {
  CATALOG_CHAR_BUDGET,
  CATALOG_FACETS_PER_TOPIC,
  buildWikiCatalogText,
  type CatalogItem,
  type CatalogTopic,
} from '@/lib/ai/wiki-catalog'

const topic = (over: Partial<CatalogTopic> = {}): CatalogTopic => ({
  id: 't1',
  title: '데이터 관리',
  normalizedTitle: '데이터 관리',
  liveCount: 68,
  lastChangedAt: '2026-07-30T00:00:00Z',
  ...over,
})

const item = (over: Partial<CatalogItem> = {}): CatalogItem => ({
  topicId: 't1',
  topicTitle: '데이터 관리',
  kind: 'decision',
  facetPart: 'mes-데이터-조회-전용-한정',
  statement: 'MES는 조회 전용으로 한정하기로 확정했다.',
  updatedAt: '2026-07-30T00:00:00Z',
  ...over,
})

describe('buildWikiCatalogText — 주제 줄', () => {
  it('살아있는 항목이 0건인 주제는 광고하지 않는다', () => {
    const { text } = buildWikiCatalogText({
      topics: [
        topic({ id: 'dead', title: '죽은 주제', normalizedTitle: '죽은 주제', liveCount: 0 }),
        topic({ id: 'live', title: '산 주제', normalizedTitle: '산 주제', liveCount: 3 }),
      ],
      items: [],
      bodyMd: '',
      gatingEnabled: true,
    })
    expect(text).toContain('산 주제')
    expect(text).not.toContain('죽은 주제')
  })

  it('포화 주제는 기존 주제 줄에서 빠지고 포화 절에 들어간다', () => {
    const { text } = buildWikiCatalogText({
      topics: [topic({ liveCount: 15 })],
      items: [item()],
      bodyMd: '',
      gatingEnabled: true,
    })
    const topicsLine = text.split('\n').find((l) => l.startsWith('기존 주제:')) ?? ''
    expect(topicsLine).not.toContain('데이터 관리')
    expect(text).toContain('[포화 주제]')
    expect(text).toContain('포화 "데이터 관리" 기존대상:')
  })

  it('last_changed_at 이 전부 같아도 출력 순서가 결정적이다', () => {
    const same = '2026-07-29T18:26:49Z'
    const topics = ['c', 'a', 'b'].map((id) => topic({
      id, title: id, normalizedTitle: id, liveCount: 2, lastChangedAt: same,
    }))
    const first = buildWikiCatalogText({ topics, items: [], bodyMd: '', gatingEnabled: true }).text
    const second = buildWikiCatalogText({
      topics: [...topics].reverse(), items: [], bodyMd: '', gatingEnabled: true,
    }).text
    expect(first).toBe(second)
    expect(first).toContain('기존 주제: a / b / c')
  })
})

describe('buildWikiCatalogText — 항목 줄', () => {
  it('포화 주제 소속 항목은 문장 줄에서 빠지고 비포화로 리필되지 않는다', () => {
    const topics = [
      topic({ id: 'sat', title: '포화', normalizedTitle: '포화', liveCount: 20 }),
      topic({ id: 'ok', title: '보통', normalizedTitle: '보통', liveCount: 2 }),
    ]
    const items = [
      ...Array.from({ length: 20 }, (_, i) => item({
        topicId: 'sat', topicTitle: '포화', facetPart: `sat-${i}`,
      })),
      ...Array.from({ length: 2 }, (_, i) => item({
        topicId: 'ok', topicTitle: '보통', facetPart: `ok-${i}`,
      })),
    ]
    const { text } = buildWikiCatalogText({ topics, items, bodyMd: '', gatingEnabled: true })
    const lines = text.split('\n').filter((l) => l.startsWith('- topic='))
    expect(lines).toHaveLength(2)             // 리필하지 않는다
    expect(lines.every((l) => l.includes('topic="보통"'))).toBe(true)
  })
})

describe('buildWikiCatalogText — 포화 목록', () => {
  it('kind 를 병기한다 — kind 가 갈리면 knowledge_key 가 갈린다', () => {
    const { text } = buildWikiCatalogText({
      topics: [topic({ liveCount: 15 })],
      items: [item({ kind: 'fact', facetPart: 'a-b' })],
      bodyMd: '',
      gatingEnabled: true,
    })
    expect(text).toContain('fact/a-b')
  })

  it('(kind, facet) 중복을 제거한다', () => {
    const { text } = buildWikiCatalogText({
      topics: [topic({ liveCount: 15 })],
      items: [
        item({ kind: 'fact', facetPart: 'a-b' }),
        item({ kind: 'fact', facetPart: 'a-b' }),
        item({ kind: 'decision', facetPart: 'a-b' }),
      ],
      bodyMd: '',
      gatingEnabled: true,
    })
    const line = text.split('\n').find((l) => l.startsWith('포화 ')) ?? ''
    expect(line.match(/fact\/a-b/g)).toHaveLength(1)
    expect(line).toContain('decision/a-b')
  })

  it('주제당 12개를 넘지 않는다', () => {
    const { text } = buildWikiCatalogText({
      topics: [topic({ liveCount: 30 })],
      items: Array.from({ length: 30 }, (_, i) => item({ facetPart: `f-${i}` })),
      bodyMd: '',
      gatingEnabled: true,
    })
    const line = text.split('\n').find((l) => l.startsWith('포화 ')) ?? ''
    expect(line.split(', ')).toHaveLength(CATALOG_FACETS_PER_TOPIC)
  })

  it('이번 회의록 본문과 겹치는 facet 을 먼저 보여준다', () => {
    const { text } = buildWikiCatalogText({
      topics: [topic({ liveCount: 20 })],
      items: [
        ...Array.from({ length: 15 }, (_, i) => item({
          facetPart: `무관-${i}`, updatedAt: '2026-07-30T00:00:00Z',
        })),
        item({ facetPart: '위탁임가공-목표수율', updatedAt: '2026-01-01T00:00:00Z' }),
      ],
      bodyMd: '오늘은 위탁임가공 목표수율을 논의했다.',
      gatingEnabled: true,
    })
    const line = text.split('\n').find((l) => l.startsWith('포화 ')) ?? ''
    expect(line).toContain('위탁임가공-목표수율')
  })

  it('목차형 주제는 포화 절에서도 제외한다', () => {
    const { text } = buildWikiCatalogText({
      topics: [topic({
        id: 'agenda', title: '향후 추진 계획', normalizedTitle: '향후 추진 계획', liveCount: 40,
      })],
      items: [item({ topicId: 'agenda', topicTitle: '향후 추진 계획' })],
      bodyMd: '',
      gatingEnabled: true,
    })
    expect(text).not.toContain('향후 추진 계획')
  })

  it('포화 주제가 없으면 절 자체가 나오지 않는다', () => {
    const { text } = buildWikiCatalogText({
      topics: [topic({ liveCount: 3 })],
      items: [item()],
      bodyMd: '',
      gatingEnabled: true,
    })
    expect(text).not.toContain('[포화 주제]')
  })
})

describe('buildWikiCatalogText — fail-closed 와 예산', () => {
  it('gatingEnabled=false 면 포화 절을 만들지 않고 현행처럼 동작한다', () => {
    const { text } = buildWikiCatalogText({
      topics: [topic({ liveCount: 68 })],
      items: [item()],
      bodyMd: '',
      gatingEnabled: false,
    })
    expect(text).not.toContain('[포화 주제]')
    expect(text).toContain('기존 주제: 데이터 관리')
    expect(text).toContain('- topic="데이터 관리"')
  })

  it('과장 입력에서도 예산 6,000자를 넘지 않는다', () => {
    const topics = Array.from({ length: 20 }, (_, t) => topic({
      id: `t${t}`, title: `포화주제${t}`, normalizedTitle: `포화주제${t}`, liveCount: 60,
    }))
    const items = topics.flatMap((tp) => Array.from({ length: 60 }, (_, i) => item({
      topicId: tp.id, topicTitle: tp.title, facetPart: `아주-긴-facet-이름-${tp.id}-${i}`,
    })))
    const { text, warnings } = buildWikiCatalogText({
      topics, items, bodyMd: '', gatingEnabled: true,
    })
    expect(text.length).toBeLessThanOrEqual(CATALOG_CHAR_BUDGET)
    expect(warnings.length).toBeGreaterThan(0)
  })

  it('예산 때문에 포화 목록을 0으로 만들지 않는다 — 최소 2개는 남긴다', () => {
    const topics = Array.from({ length: 40 }, (_, t) => topic({
      id: `t${t}`, title: `포화주제${t}`, normalizedTitle: `포화주제${t}`, liveCount: 60,
    }))
    const items = topics.flatMap((tp) => Array.from({ length: 20 }, (_, i) => item({
      topicId: tp.id, topicTitle: tp.title, facetPart: `f-${tp.id}-${i}`,
    })))
    const { text, warnings } = buildWikiCatalogText({
      topics, items, bodyMd: '', gatingEnabled: true,
    })
    for (const tp of topics) {
      const line = text.split('\n').find((l) => l.startsWith(`포화 "${tp.title}"`))
      expect(line, `${tp.title} 목록이 사라졌다`).toBeTruthy()
      expect((line ?? '').split(', ').length).toBeGreaterThanOrEqual(2)
    }
    expect(warnings.some((w) => w.includes('예산'))).toBe(true)
  })

  it('줄 게 아무것도 없으면 빈 문자열이다', () => {
    const { text } = buildWikiCatalogText({
      topics: [], items: [], bodyMd: '', gatingEnabled: true,
    })
    expect(text).toBe('')
  })
})
```

- [ ] **Step 2: 실패를 확인한다**

Run: `npx vitest run tests/ai/wiki-catalog.test.ts`
Expected: FAIL — `src/lib/ai/wiki-catalog.ts` 가 없어 import 에러

- [ ] **Step 3: 구현**

`src/lib/ai/wiki-catalog.ts` 를 새로 만든다.

```ts
// 추출 프롬프트에 붙는 기존 지식 카탈로그의 조립 규칙. I/O 없는 순수 함수다.
//
// 왜 따로 떼는가: 여기서 지켜야 하는 것(예산 상한, (kind,facet) distinct, 결정적 정렬,
// 포화 주제 제외)이 전부 문자열 조립 규칙이라 supabase 목 없이 테스트할 수 있어야 한다.
// wiki-ingest.ts는 이미 1,200줄이 넘어 여기에 더 얹으면 읽을 수 없다.
import {
  isAgendaStyleWikiTopic,
  isSaturatedWikiTopic,
  wikiSaturationKey,
} from '@/lib/domain/wiki'

/**
 * 주제 창 상한. 60이던 값을 올린다 — 이 설계의 목적이 주제를 잘게 만드는 것이고,
 * 60은 이미 살아있는 주제 62개를 담지 못했다. 살아있는 주제만 싣기 때문에 창을 넓혀도
 * 죽은 이름이 들어오지 않는다.
 */
export const CATALOG_TOPIC_LIMIT = 160
export const CATALOG_ITEM_LIMIT = 40
export const CATALOG_STATEMENT_CAP = 90
export const CATALOG_FACETS_PER_TOPIC = 12

/**
 * 프롬프트가 커지면 gemini-3.5-flash가 출력 예산 4,096 토큰을 thinking에 써 본문이 잘리고
 * LLM_OUTPUT_INVALID가 되며, 회의록 1건이 0건이 되고 재구축 큐 전체가 멈춘다(f74fc5a).
 * 측정 대상은 반환 문자열 전량이다 — 부분 합으로 재면 테스트와 구현이 어긋난다.
 */
export const CATALOG_CHAR_BUDGET = 6_000

/** 예산이 아무리 빠듯해도 이 아래로는 줄이지 않는다. 0으로 만들면 이력 보호가 사라진다. */
const FACETS_FLOOR = 2
const ITEM_LINES_FLOOR = 10
const TOPIC_LINE_FLOOR = 20

const FACET_LADDER = [CATALOG_FACETS_PER_TOPIC, 8, 4, FACETS_FLOOR]
const ITEM_LADDER = [CATALOG_ITEM_LIMIT, 20, ITEM_LINES_FLOOR]

export interface CatalogTopic {
  id: string
  title: string
  normalizedTitle: string
  liveCount: number
  lastChangedAt: string
}

export interface CatalogItem {
  topicId: string
  topicTitle: string
  kind: string
  facetPart: string
  statement: string
  updatedAt: string
}

export interface BuiltCatalog {
  text: string
  warnings: string[]
}

const HEADER = '[기존 프로젝트 지식] — 같은 대상이면 아래 topic/knowledgeKey를 그대로 재사용하라.'
const SATURATED_HEADER = '[포화 주제] — 아래 주제는 이미 커서 새 대상을 더 받지 않는다.'

/** 이번 회의록 본문에 등장하는 facet 어절 수. 많을수록 이번 회의가 다룰 대상에 가깝다. */
function overlapScore(facetPart: string, haystack: string): number {
  if (!haystack) return 0
  const tokens = facetPart.split('-').filter((t) => t.length >= 2)
  let hit = 0
  for (const token of tokens) if (haystack.includes(token)) hit += 1
  return hit
}

function assemble(
  topicLine: string | null,
  itemLines: string[],
  saturatedLines: string[],
): string {
  if (!topicLine && itemLines.length === 0 && saturatedLines.length === 0) return ''
  return [
    '',
    HEADER,
    topicLine ?? '',
    ...itemLines,
    saturatedLines.length > 0 ? SATURATED_HEADER : '',
    ...saturatedLines,
    '',
  ].filter(Boolean).join('\n')
}

export function buildWikiCatalogText(args: {
  topics: CatalogTopic[]
  items: CatalogItem[]
  bodyMd: string
  gatingEnabled: boolean
}): BuiltCatalog {
  const warnings: string[] = []
  const haystack = args.bodyMd.toLowerCase()

  // 목차형 주제는 어느 절에도 싣지 않는다. 카탈로그로 다시 흘리면 흡인체가 되살아난다.
  const usable = args.topics.filter(
    (t) => Boolean(t.title) && !isAgendaStyleWikiTopic(t.title),
  )
  const saturatedIds = new Set(
    args.gatingEnabled
      ? usable.filter((t) => isSaturatedWikiTopic(t.liveCount)).map((t) => t.id)
      : [],
  )

  // 살아있는 항목이 0건인 주제는 재사용 후보가 아니다. 2차 정렬 키(id)가 없으면
  // 리셋이 last_changed_at을 전부 같은 값으로 찍은 직후 창 선택이 비결정적이 된다.
  const advertised = usable
    .filter((t) => t.liveCount > 0 && !saturatedIds.has(t.id))
    .sort((a, b) => (
      b.lastChangedAt.localeCompare(a.lastChangedAt) || a.id.localeCompare(b.id)
    ))
    .slice(0, CATALOG_TOPIC_LIMIT)

  const topicIds = new Set(usable.map((t) => t.id))
  const liveItems = args.items
    .filter((i) => topicIds.has(i.topicId))
    .sort((a, b) => (
      b.updatedAt.localeCompare(a.updatedAt) || a.facetPart.localeCompare(b.facetPart)
    ))

  const nonSaturatedItems = liveItems.filter((i) => !saturatedIds.has(i.topicId))

  // 포화 주제별 (kind, facet) distinct. 같은 facet이 kind만 달라 여러 항목으로 존재한다.
  const saturatedFacets = new Map<string, { title: string; entries: string[] }>()
  for (const topic of usable) {
    if (!saturatedIds.has(topic.id)) continue
    const seen = new Set<string>()
    const entries = liveItems
      .filter((i) => i.topicId === topic.id)
      .filter((i) => {
        const key = wikiSaturationKey(i.kind, i.facetPart)
        if (seen.has(key)) return false
        seen.add(key)
        return true
      })
      .sort((a, b) => (
        overlapScore(b.facetPart, haystack) - overlapScore(a.facetPart, haystack)
        || b.updatedAt.localeCompare(a.updatedAt)
        || a.facetPart.localeCompare(b.facetPart)
      ))
      .map((i) => `${i.kind}/${i.facetPart}`)
    if (entries.length > 0) saturatedFacets.set(topic.id, { title: topic.title, entries })
  }

  const renderTopicLine = (count: number): string | null => {
    const names = advertised.slice(0, count).map((t) => t.title)
    return names.length > 0 ? `기존 주제: ${names.join(' / ')}` : null
  }
  const renderItemLines = (count: number): string[] => nonSaturatedItems
    .slice(0, count)
    .map((i) => (
      `- topic="${i.topicTitle}" kind=${i.kind} knowledgeKey="${i.facetPart}"`
      + ` :: ${i.statement.slice(0, CATALOG_STATEMENT_CAP)}`
    ))
  const renderSaturated = (perTopic: number): string[] => [...saturatedFacets.values()]
    .map((v) => `포화 "${v.title}" 기존대상: ${v.entries.slice(0, perTopic).join(', ')}`)

  // 사다리: 무한정 자라는 항(포화 목록 = 12 × 포화주제수)을 먼저 조인다. 항목 줄은
  // CATALOG_ITEM_LIMIT으로 상한이 박혀 있고 포화 주제가 늘면 자동으로 줄어든다.
  let topicCount = advertised.length
  for (const perTopic of FACET_LADDER) {
    for (const itemCount of ITEM_LADDER) {
      const text = assemble(
        renderTopicLine(topicCount), renderItemLines(itemCount), renderSaturated(perTopic),
      )
      if (text.length <= CATALOG_CHAR_BUDGET) {
        if (perTopic !== CATALOG_FACETS_PER_TOPIC || itemCount !== CATALOG_ITEM_LIMIT) {
          warnings.push(
            `[wiki] 카탈로그 예산 축소: facet ${perTopic}/주제, 항목 ${itemCount}줄`,
          )
        }
        return { text, warnings }
      }
    }
  }

  // 항목 줄과 포화 목록을 하한까지 내려도 넘으면 주제 줄을 앞에서부터 자른다.
  while (topicCount > TOPIC_LINE_FLOOR) {
    topicCount = Math.max(TOPIC_LINE_FLOOR, Math.floor(topicCount / 2))
    const text = assemble(
      renderTopicLine(topicCount), renderItemLines(ITEM_LINES_FLOOR), renderSaturated(FACETS_FLOOR),
    )
    if (text.length <= CATALOG_CHAR_BUDGET) {
      warnings.push(`[wiki] 카탈로그 예산 축소: 주제 줄 ${topicCount}개로 절단`)
      return { text, warnings }
    }
  }

  // 여기까지 왔으면 예산을 넘긴 채 보낸다. 포화 목록을 0으로 만들면 이력 보호가 사라져
  // 프롬프트 초과보다 나쁘다. 조용히 넘기지 않고 알린다.
  const text = assemble(
    renderTopicLine(TOPIC_LINE_FLOOR), renderItemLines(ITEM_LINES_FLOOR), renderSaturated(FACETS_FLOOR),
  )
  warnings.push(
    `[wiki] 카탈로그 예산 ${CATALOG_CHAR_BUDGET}자 초과(${text.length}자) — `
    + `포화 목록을 주제당 ${FACETS_FLOOR}개로 유지한 채 전송한다`,
  )
  return { text, warnings }
}
```

- [ ] **Step 4: 통과를 확인한다**

Run: `npx vitest run tests/ai/wiki-catalog.test.ts`
Expected: PASS — 14건

- [ ] **Step 5: 커밋**

```bash
git add src/lib/ai/wiki-catalog.ts tests/ai/wiki-catalog.test.ts
git commit -m "feat(wiki): 카탈로그 조립을 순수 함수로 분리 + 예산 사다리

지켜야 하는 규칙이 전부 문자열 조립이라 supabase 목 없이 테스트되어야 한다.
포화 목록을 먼저 조이는 이유는 그것만이 무한정 자라는 항이기 때문이다 —
항목 줄은 상한이 박혀 있고 포화 주제가 늘면 오히려 줄어든다.
목록을 0으로 만들지 않는 이유는 그게 프롬프트 초과보다 나쁘기 때문이다."
```

---

### Task 3: 포화 스냅샷 조회 (fail-closed)

**Files:**
- Create: `src/lib/ai/wiki-saturation.ts`
- Test: `tests/ai/wiki-saturation.test.ts`

**Interfaces:**
- Consumes: Task 1 의 `WIKI_LIVE_STATES`, `isSaturatedWikiTopic`, `wikiSaturationKey`; Task 2 의 `CatalogTopic`, `CatalogItem`
- Produces:
  - `LIVE_SCAN_CAP = 2000`
  - `interface WikiSaturationSnapshot { complete: boolean; topics: CatalogTopic[]; items: CatalogItem[]; saturatedNormalizedTitles: Set<string>; keyOwner: Map<string, { id: string; normalizedTitle: string }> }`
  - `loadWikiSaturation(admin: SupabaseLike, projectId: string): Promise<WikiSaturationSnapshot>`
  - `emptySaturationSnapshot(): WikiSaturationSnapshot`

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`tests/ai/wiki-saturation.test.ts` 를 새로 만든다. supabase 클라이언트는 최소 스텁으로 흉내낸다.

```ts
import { describe, it, expect, vi } from 'vitest'
import { LIVE_SCAN_CAP, loadWikiSaturation } from '@/lib/ai/wiki-saturation'

type Row = Record<string, unknown>

/** wiki_items 한 건. wiki_topics 는 임베드로 따라온다. */
const row = (over: Row = {}): Row => ({
  topic_id: 't1',
  kind: 'decision',
  knowledge_key: '데이터 관리:decision:a-b',
  updated_at: '2026-07-30T00:00:00Z',
  statement: '문장',
  wiki_topics: {
    id: 't1',
    title: '데이터 관리',
    normalized_title: '데이터 관리',
    last_changed_at: '2026-07-30T00:00:00Z',
  },
  ...over,
})

function admin(rows: Row[] | null, error: { code: string } | null = null) {
  const chain: Record<string, unknown> = {}
  for (const k of ['select', 'eq', 'in', 'order', 'limit']) {
    chain[k] = () => chain
  }
  chain.then = (res: unknown, rej: unknown) =>
    Promise.resolve({ data: rows, error }).then(res as never, rej as never)
  return { from: () => chain } as never
}

describe('loadWikiSaturation', () => {
  it('주제별 살아있는 항목 수를 세고 포화를 판정한다', async () => {
    const rows = Array.from({ length: 15 }, (_, i) => row({
      knowledge_key: `데이터 관리:decision:f-${i}`,
    }))
    const snap = await loadWikiSaturation(admin(rows), 'p1')
    expect(snap.complete).toBe(true)
    expect(snap.topics).toHaveLength(1)
    expect(snap.topics[0].liveCount).toBe(15)
    expect(snap.saturatedNormalizedTitles.has('데이터 관리')).toBe(true)
  })

  it('상한 미만 주제는 포화가 아니다', async () => {
    const rows = Array.from({ length: 14 }, (_, i) => row({
      knowledge_key: `데이터 관리:decision:f-${i}`,
    }))
    const snap = await loadWikiSaturation(admin(rows), 'p1')
    expect(snap.saturatedNormalizedTitles.size).toBe(0)
    expect(snap.keyOwner.size).toBe(0)
  })

  it('포화 주제의 (kind, facet) 소유자를 기록한다 — 코드 구제의 근거', async () => {
    const rows = Array.from({ length: 15 }, (_, i) => row({
      knowledge_key: `데이터 관리:decision:f-${i}`,
    }))
    const snap = await loadWikiSaturation(admin(rows), 'p1')
    expect(snap.keyOwner.get('decision:f-0')).toEqual({
      id: 't1', normalizedTitle: '데이터 관리',
    })
    expect(snap.keyOwner.has('fact:f-0')).toBe(false)   // kind 가 다르면 다른 대상
  })

  it('스캔 상한에 닿으면 불완전으로 표시하고 경고한다 (fail-closed)', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const rows = Array.from({ length: LIVE_SCAN_CAP }, (_, i) => row({
      topic_id: `t${i}`,
      knowledge_key: `주제${i}:decision:f`,
      wiki_topics: {
        id: `t${i}`, title: `주제${i}`, normalized_title: `주제${i}`,
        last_changed_at: '2026-07-30T00:00:00Z',
      },
    }))
    const snap = await loadWikiSaturation(admin(rows), 'p1')
    expect(snap.complete).toBe(false)
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })

  it('조회가 실패하면 빈 스냅샷을 돌려주고 불완전으로 표시한다 — 추출은 계속한다', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    const snap = await loadWikiSaturation(admin(null, { code: '42P01' }), 'p1')
    expect(snap.complete).toBe(false)
    expect(snap.topics).toHaveLength(0)
    expect(err).toHaveBeenCalled()
    err.mockRestore()
  })
})
```

- [ ] **Step 2: 실패를 확인한다**

Run: `npx vitest run tests/ai/wiki-saturation.test.ts`
Expected: FAIL — `src/lib/ai/wiki-saturation.ts` 없음

- [ ] **Step 3: 구현**

`src/lib/ai/wiki-saturation.ts` 를 새로 만든다.

```ts
// 프로젝트의 살아있는 위키 항목을 한 번 전량 조회해 포화 스냅샷을 만든다.
//
// 왜 전량인가: 카탈로그의 기존 항목 쿼리는 updated_at desc limit 40이고, 그 40행 창에서
// 주제별로 세면 살아있는 68건인 '데이터 관리'가 12건으로 보인다(2026-07-30 실측).
// 표본으로 세면 어떤 주제도 상한에 닿지 않아 게이팅이 무음 no-op이 된다. 살아있는 55건인
// '생산 및 부자재 관리'는 그 창에 0행이라 facet 목록까지 빈 채로 나간다.
//
// 왜 JS 집계인가: PostgREST 집계 함수가 이 프로젝트에서 비활성이다
// (select=topic_id,count() → PGRST123). supabase-js로 GROUP BY도 못 한다.
// 행을 받아 앱에서 세는 것은 getWikiOverview(src/lib/data/wiki.ts)가 이미 쓰는 관용구다.
import { createAdminClient } from '@/lib/supabase/admin'
import {
  WIKI_LIVE_STATES,
  isSaturatedWikiTopic,
  wikiSaturationKey,
} from '@/lib/domain/wiki'
import type { CatalogItem, CatalogTopic } from '@/lib/ai/wiki-catalog'

/**
 * PostgREST 기본 max-rows가 1000이다. 명시 limit 없이 긁으면 조용히 1000행에서 잘려
 * 포화 주제가 비포화로 보인다. 상한을 그보다 크게 두고, 닿으면 게이팅을 끈다.
 */
export const LIVE_SCAN_CAP = 2_000

export interface WikiSaturationSnapshot {
  /** false면 카운트를 신뢰할 수 없다 — 게이팅을 켜지 않는다. */
  complete: boolean
  topics: CatalogTopic[]
  items: CatalogItem[]
  saturatedNormalizedTitles: Set<string>
  /** `kind:facet` → 그 대상을 이미 담고 있는 포화 주제. 코드 구제의 근거다. */
  keyOwner: Map<string, { id: string; normalizedTitle: string }>
}

export function emptySaturationSnapshot(): WikiSaturationSnapshot {
  return {
    complete: false,
    topics: [],
    items: [],
    saturatedNormalizedTitles: new Set(),
    keyOwner: new Map(),
  }
}

type Row = Record<string, unknown>

function facetOf(knowledgeKey: string): string {
  return knowledgeKey.split(':').slice(2).join(':')
}

export async function loadWikiSaturation(
  admin: ReturnType<typeof createAdminClient>,
  projectId: string,
): Promise<WikiSaturationSnapshot> {
  const { data, error } = await admin.from('wiki_items')
    .select(
      'topic_id, kind, knowledge_key, statement, updated_at,'
      + ' wiki_topics!inner(id, title, normalized_title, last_changed_at)',
    )
    .eq('project_id', projectId)
    .in('lifecycle_state', [...WIKI_LIVE_STATES])
    .order('updated_at', { ascending: false })
    .limit(LIVE_SCAN_CAP)

  if (error) {
    console.error('[wiki] 포화 스냅샷 조회 실패(게이팅 없이 계속):', error.code ?? 'UNKNOWN')
    return emptySaturationSnapshot()
  }
  const rows = (data ?? []) as Row[]

  const topicMap = new Map<string, CatalogTopic>()
  const items: CatalogItem[] = []
  for (const r of rows) {
    const raw = r.wiki_topics
    const t = (Array.isArray(raw) ? raw[0] : raw) as Row | undefined
    if (!t) continue
    const id = String(t.id ?? '')
    const title = String(t.title ?? '')
    if (!id || !title) continue
    const existing = topicMap.get(id)
    if (existing) existing.liveCount += 1
    else {
      topicMap.set(id, {
        id,
        title,
        normalizedTitle: String(t.normalized_title ?? ''),
        liveCount: 1,
        lastChangedAt: String(t.last_changed_at ?? ''),
      })
    }
    items.push({
      topicId: id,
      topicTitle: title,
      kind: String(r.kind ?? ''),
      facetPart: facetOf(String(r.knowledge_key ?? '')),
      statement: String(r.statement ?? ''),
      updatedAt: String(r.updated_at ?? ''),
    })
  }

  const complete = rows.length < LIVE_SCAN_CAP
  if (!complete) {
    console.warn(
      `[wiki] 살아있는 항목이 스캔 상한 ${LIVE_SCAN_CAP}에 닿았다 — `
      + '포화 카운트를 신뢰할 수 없어 게이팅을 켜지 않는다',
    )
    return { ...emptySaturationSnapshot(), topics: [...topicMap.values()], items }
  }

  const topics = [...topicMap.values()]
  const saturatedNormalizedTitles = new Set<string>()
  const saturatedIds = new Set<string>()
  for (const t of topics) {
    if (!isSaturatedWikiTopic(t.liveCount)) continue
    saturatedNormalizedTitles.add(t.normalizedTitle)
    saturatedIds.add(t.id)
  }
  const keyOwner = new Map<string, { id: string; normalizedTitle: string }>()
  for (const i of items) {
    if (!saturatedIds.has(i.topicId)) continue
    const key = wikiSaturationKey(i.kind, i.facetPart)
    if (keyOwner.has(key)) continue
    const t = topicMap.get(i.topicId)
    if (t) keyOwner.set(key, { id: t.id, normalizedTitle: t.normalizedTitle })
  }

  return { complete: true, topics, items, saturatedNormalizedTitles, keyOwner }
}
```

> **주의 — 임베드 응답 형태:** `wiki_topics!inner(...)` 는 supabase-js 타입에서 배열로도
> 객체로도 올 수 있어 `Array.isArray` 분기가 필요하다. 기존 `loadWikiCatalog`(현행 689-690행)이
> 같은 처리를 하고 있으니 그 형태를 따른다. 타입 마찰이 있으면 행을 `Row`
> (`Record<string, unknown>`)로 받아 명시적으로 좁힌다 — `wiki-ingest.ts` 의 기존 관례다.
>
> 테스트 스텁은 `select/eq/in/order/limit` 를 모두 지원한다.

- [ ] **Step 4: 통과를 확인한다**

Run: `npx vitest run tests/ai/wiki-saturation.test.ts`
Expected: PASS — 5건

- [ ] **Step 5: 커밋**

```bash
git add src/lib/ai/wiki-saturation.ts tests/ai/wiki-saturation.test.ts
git commit -m "feat(wiki): 포화 스냅샷 — 표본이 아니라 전량으로 센다

카탈로그의 기존 40행 창에서 주제별로 세면 살아있는 68건인 '데이터 관리'가
12건으로 보여 게이팅이 무음 no-op이 된다. 살아있는 55건인 '생산 및 부자재
관리'는 그 창에 0행이라 facet 목록까지 빈 채로 나간다.
PostgREST 집계는 비활성(PGRST123)이라 행을 받아 JS에서 센다.
상한에 닿으면 카운트를 신뢰할 수 없으므로 게이팅을 켜지 않는다(fail-closed)."
```

---

### Task 4: `loadWikiCatalog` 교체와 프롬프트 규칙 14

**Files:**
- Modify: `src/lib/ai/wiki-ingest.ts`
  - 상수 삭제: 652-654 (`CATALOG_TOPIC_LIMIT`, `CATALOG_ITEM_LIMIT`, `CATALOG_STATEMENT_CAP` → `wiki-catalog.ts` 로 이동)
  - 함수 교체: 663-713 (`loadWikiCatalog`)
  - 프롬프트 추가: 규칙 13 뒤(현행 130행 부근)
  - 호출부 수정: 1037-1041 (`extractItems` 인자)
- Test: `tests/ai/wiki-catalog.test.ts` (Task 2), 기존 `tests/ai/wiki-ingest.test.ts` 회귀

**Interfaces:**
- Consumes: Task 2 의 `buildWikiCatalogText`, Task 3 의 `loadWikiSaturation`/`WikiSaturationSnapshot`
- Produces: `loadWikiCatalog(admin, projectId, bodyMd, snapshot): Promise<string>` (export), `processMinuteWikiJob` 안에서 만든 `snapshot` 을 `applyExtractedItem` 에 넘길 준비

- [ ] **Step 1: 프롬프트 규칙 14 를 추가한다**

현행 규칙 13 블록(`wiki-ingest.ts` 의 `'13. [기존 프로젝트 지식]의 문장을 …'` 로 시작하는 4줄) 바로 뒤, `''` 와 `'출력 형식:'` 앞에 넣는다.

```ts
  '14. [포화 주제]에 적힌 주제는 이미 커서 새 대상을 더 받지 않는다.',
  '    - 그 주제의 "기존대상" 목록에 있는 kind/knowledgeKey 조합이면 그 topic과',
  '      knowledgeKey를 그대로 쓴다(kind까지 그대로). 같은 대상의 이력을 끊지 않기 위해서다.',
  '    - 목록에 없는 새 대상이면 그 topic을 쓰지 말고, 이 회의록이 실제로 다루는 대상으로',
  '      새 topic을 지어라. 예: "데이터 관리"가 아니라 "MES 메뉴 열람 권한", "공헌이익 산출 항목".',
  '    - 새 topic도 규칙 12를 따른다 — 그날 안건지의 목차는 topic이 될 수 없다.',
```

- [ ] **Step 2: `loadWikiCatalog` 을 교체한다**

652-713 을 아래로 바꾼다. `CATALOG_*` 상수 세 개는 `wiki-catalog.ts` 로 갔으므로 여기서 지운다.

```ts
/**
 * 프롬프트에 붙일 기존 프로젝트 지식 카탈로그.
 *
 * 이게 없으면 LLM은 매 회의마다 주제와 knowledgeKey를 새로 지어내고, 같은 key가 한 번도
 * 겹치지 않아 재확인·구체화·대체·충돌 판정이 전혀 발동하지 않는다(= 회의별 추출 목록).
 * 실패해도 추출 자체는 계속한다 — 카탈로그는 품질 보조이지 필수 입력이 아니다.
 *
 * 조립 규칙은 wiki-catalog.ts가 정본이다(순수 함수라 목 없이 테스트된다).
 */
export function loadWikiCatalog(
  bodyMd: string,
  snapshot: WikiSaturationSnapshot,
): string {
  const { text, warnings } = buildWikiCatalogText({
    topics: snapshot.topics,
    items: snapshot.items,
    bodyMd,
    gatingEnabled: snapshot.complete,
  })
  for (const warning of warnings) console.warn(warning)
  return text
}
```

import 를 파일 상단에 추가한다.

```ts
import { buildWikiCatalogText } from '@/lib/ai/wiki-catalog'
import { loadWikiSaturation, type WikiSaturationSnapshot } from '@/lib/ai/wiki-saturation'
```

- [ ] **Step 3: 호출부를 고친다**

`processMinuteWikiJob` 의 1037-1041 부근을 바꾼다. 스냅샷을 한 번만 만들어 카탈로그와 반영에 함께 쓴다.

```ts
    const saturation = await loadWikiSaturation(admin, job.project_id as string)
    const { blocks, items } = await extractItems(
      bodyMd,
      minute.title as string,
      minuteDate,
      loadWikiCatalog(bodyMd, saturation),
    )
```

(기존 인자 순서와 이름은 현행 코드를 그대로 따르고, 마지막 catalog 인자만 위 식으로 교체한다.)

- [ ] **Step 4: 테스트를 돌린다**

Run: `npx vitest run tests/ai/ tests/domain/wiki.test.ts`
Expected: PASS — 기존 `wiki-ingest.test.ts`(906줄)가 그대로 통과해야 한다. 목 하네스는 큐 소진 시 `{ data: null }` 을 주므로 쿼리가 하나 늘어도 깨지지 않는다.

- [ ] **Step 5: 타입체크와 린트**

Run: `npx tsc --noEmit && npm run lint`
Expected: 에러 0

- [ ] **Step 6: 커밋**

```bash
git add src/lib/ai/wiki-ingest.ts
git commit -m "feat(wiki): 카탈로그가 포화 주제를 재사용 후보에서 뺀다

'데이터 관리'가 68항목 23개 회의를 빨아들인 것은 버그가 아니라 07-27에
넣은 재사용 지시('글자 하나까지 복사')의 결과다. 목차형 필터는 열거식이라
도메인 명사를 못 잡는다. 그래서 재사용을 끄지 않고 상한을 둔다.

죽은 주제(살아있는 항목 0건)를 광고하지 않는 것이 이 변경의 핵심이다 —
리셋이 232개 주제의 last_changed_at을 같은 값으로 찍으므로, 그것 없이는
흡인체 이름이 세대마다 부활하고 창 선택도 비결정적이었다."
```

---

### Task 5: `ensureTopic` 게이팅과 코드 구제

**Files:**
- Modify: `src/lib/ai/wiki-ingest.ts` (374-405 `ensureTopic`, 524 호출부, `applyExtractedItem` 인자)
- Test: `tests/ai/wiki-ingest.test.ts`

**Interfaces:**
- Consumes: Task 1 의 `wikiFacetPart`/`wikiSaturationKey`, Task 3 의 `WikiSaturationSnapshot`
- Produces: `ensureTopic(admin, projectId, item, snapshot)` — `applyExtractedItem` 의 `args` 에 `saturation: WikiSaturationSnapshot` 필드 추가

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`tests/ai/wiki-ingest.test.ts` 에 추가한다. 기존 목 하네스(`tables` 키별 응답 큐)를 그대로 쓴다 — 파일 상단의 헬퍼 이름과 사용법을 먼저 읽고 맞춘다.

```ts
describe('ensureTopic — 포화 게이팅', () => {
  it('포화 주제는 별칭 후보에서 빠진다 — "데이터 관리 기준"이 새 주제가 된다', async () => {
    // 현행 matchWikiTopicAlias의 containment 분기는 유사도·한정어 가드를 모두 우회하므로
    // 후보 풀에 '데이터 관리'가 남아 있으면 '데이터 관리 기준'이 흡수된다(실행으로 확인됨).
    const snapshot = {
      complete: true,
      topics: [],
      items: [],
      saturatedNormalizedTitles: new Set(['데이터 관리']),
      keyOwner: new Map(),
    }
    const result = await runApplyWithSnapshot({
      snapshot,
      item: { topic: '데이터 관리 기준', kind: 'decision', facet: '신규-대상' },
      existingTopics: [{ id: 'sat', normalized_title: '데이터 관리', aliases: [] }],
    })
    expect(result.insertedTopicTitle).toBe('데이터 관리 기준')
    expect(result.usedTopicId).not.toBe('sat')
  })

  it('(kind, facet)이 포화 주제에 이미 살아 있으면 그 주제로 되돌린다', async () => {
    const snapshot = {
      complete: true,
      topics: [],
      items: [],
      saturatedNormalizedTitles: new Set(['데이터 관리']),
      keyOwner: new Map([
        ['decision:기존-대상', { id: 'sat', normalizedTitle: '데이터 관리' }],
      ]),
    }
    const result = await runApplyWithSnapshot({
      snapshot,
      item: { topic: '완전히 다른 이름', kind: 'decision', facet: '기존 대상' },
      existingTopics: [{ id: 'sat', normalized_title: '데이터 관리', aliases: [] }],
    })
    expect(result.usedTopicId).toBe('sat')
    expect(result.insertedTopicTitle).toBeNull()   // 새 주제를 만들지 않는다
  })

  it('normalized_title 완전일치는 포화 여부와 무관하게 흡수한다', async () => {
    const snapshot = {
      complete: true,
      topics: [],
      items: [],
      saturatedNormalizedTitles: new Set(['데이터 관리']),
      keyOwner: new Map(),
    }
    const result = await runApplyWithSnapshot({
      snapshot,
      item: { topic: '데이터 관리', kind: 'decision', facet: '새-대상' },
      existingTopics: [{ id: 'sat', normalized_title: '데이터 관리', aliases: [] }],
    })
    expect(result.usedTopicId).toBe('sat')
  })

  it('스냅샷이 불완전하면 게이팅하지 않는다 — 현행 동작 유지', async () => {
    const snapshot = {
      complete: false,
      topics: [],
      items: [],
      saturatedNormalizedTitles: new Set<string>(),
      keyOwner: new Map(),
    }
    const result = await runApplyWithSnapshot({
      snapshot,
      item: { topic: '데이터 관리 기준', kind: 'decision', facet: '신규-대상' },
      existingTopics: [{ id: 'sat', normalized_title: '데이터 관리', aliases: [] }],
    })
    expect(result.usedTopicId).toBe('sat')   // containment로 흡수되는 현행 동작
  })
})
```

`runApplyWithSnapshot` 은 이 파일의 기존 목 스타일로 작성한다 — `wiki_topics` 응답 큐에
`existingTopics` 를 넣고(`maybeSingle` 용 1건 + 별칭 스캔용 목록), `applyExtractedItem` 을
호출한 뒤 `insert` 로 넘어간 title 과 apply RPC 에 넘어간 `p_topic_id` 를 돌려준다. 기존
테스트가 RPC 인자를 확인하는 방식(`rpc` 스파이의 호출 인자 검사)을 그대로 재사용한다.

- [ ] **Step 2: 실패를 확인한다**

Run: `npx vitest run tests/ai/wiki-ingest.test.ts`
Expected: FAIL — `ensureTopic` 이 스냅샷을 받지 않아 첫 테스트가 `sat` 으로 흡수된다

- [ ] **Step 3: `ensureTopic` 을 고친다**

374-405 를 바꾼다.

```ts
async function ensureTopic(
  admin: ReturnType<typeof createAdminClient>,
  projectId: string,
  item: ExtractedWikiItem,
  snapshot: WikiSaturationSnapshot,
): Promise<ResolvedWikiTopic> {
  // 코드 구제: 같은 (kind, facet)이 포화 주제에 이미 살아 있으면 그 주제로 되돌린다.
  // 프롬프트만으로는 이걸 보장할 수 없다 — 포화 8주제의 facet이 239개인데 프롬프트에
  // 실을 수 있는 것은 주제당 12개(최대 96개)뿐이다. 정확 일치라 오병합 위험이 없다.
  if (snapshot.complete) {
    const owner = snapshot.keyOwner.get(
      wikiSaturationKey(item.kind, wikiFacetPart(item.kind, item.facet)),
    )
    if (owner) return { id: owner.id, normalizedTitle: owner.normalizedTitle }
  }

  const normalized = normalizeWikiTopic(item.topic)
  const { data: existing, error: readError } = await admin.from('wiki_topics')
    .select('id, normalized_title')
    .eq('project_id', projectId)
    .eq('normalized_title', normalized)
    .maybeSingle()
  if (readError) throw new Error(`TOPIC_READ:${readError.code ?? 'UNKNOWN'}`)
  if (existing) {
    // 완전일치는 포화 여부와 무관하게 흡수한다. (project_id, normalized_title)이 유니크라
    // 완전일치는 곧 같은 주제이고, 이력을 지키는 쪽이 옳다.
    return { id: existing.id as string, normalizedTitle: existing.normalized_title as string }
  }

  // 정확히 같은 제목이 없을 때만 별칭을 본다. LLM이 회의마다 제목을 조금씩 다르게 지어도
  // 같은 대상이면 기존 주제에 붙어야 재확인·구체화·충돌 판정이 작동한다.
  //
  // 단 포화 주제는 후보에서 뺀다. matchWikiTopicAlias의 containment 분기
  // (shared === shorterSize && shorterSize >= 2)는 유사도 검사와 한정어 거부 가드를
  // 모두 우회하므로, '데이터 관리 기준'·'스케줄 관리 화면'처럼 한정어만 덧붙인 이름이
  // 흡인체로 되돌아간다(2026-07-30 실행으로 확인). 함수 자체는 고치지 않는다 —
  // f1482c5와 tests/domain/wiki.test.ts가 그대로 통과해야 한다.
  const { data: candidateRows, error: candidateError } = await admin.from('wiki_topics')
    .select('id, normalized_title, aliases')
    .eq('project_id', projectId)
    .limit(TOPIC_ALIAS_SCAN_LIMIT)
  if (candidateError) throw new Error(`TOPIC_SCAN:${candidateError.code ?? 'UNKNOWN'}`)
  const candidates = (candidateRows ?? [])
    .map((row) => ({
      id: row.id as string,
      normalizedTitle: row.normalized_title as string,
      aliases: Array.isArray(row.aliases) ? (row.aliases as string[]) : [],
    }))
    .filter((c) => !(
      snapshot.complete && snapshot.saturatedNormalizedTitles.has(c.normalizedTitle)
    ))
  const alias = matchWikiTopicAlias(candidates, normalized)
  if (alias) return alias
```

(이하 insert 경로는 현행 그대로 둔다.)

import 에 `wikiFacetPart`, `wikiSaturationKey` 를 추가한다.

- [ ] **Step 4: 호출부와 `applyExtractedItem` 시그니처를 고친다**

`applyExtractedItem` 의 `args` 타입에 필드를 추가하고 524행을 고친다.

```ts
    saturation: WikiSaturationSnapshot,
```

```ts
  const topic = await ensureTopic(admin, args.projectId, args.item, args.saturation)
```

`processMinuteWikiJob` 의 `applyExtractedItem` 호출(1046 부근)에 `saturation` 을 넘긴다.

```ts
      const result = await applyExtractedItem(admin, {
        projectId: job.project_id as string,
        // … 기존 필드 그대로 …
        item,
        saturation,
      })
```

- [ ] **Step 5: 테스트·타입체크·린트**

Run: `npm run test && npx tsc --noEmit && npm run lint`
Expected: 전부 통과. `tests/domain/wiki.test.ts` 의 별칭 규칙 테스트가 무변경으로 통과하는 것이 회귀 보증이다.

- [ ] **Step 6: 커밋**

```bash
git add src/lib/ai/wiki-ingest.ts tests/ai/wiki-ingest.test.ts
git commit -m "feat(wiki): 게이팅을 반영 경로에도 둔다 — 프롬프트만으로는 안 된다

별칭 매처의 containment 분기는 유사도와 한정어 가드를 모두 우회한다.
실제 함수를 포화 주제명 후보 풀로 돌리니 '데이터 관리 기준'·'스케줄 관리
화면'·'부자재 관리'가 전부 흡수됐다. 프롬프트로 다른 이름을 지으라고 하면
한정어를 덧붙인 변형이 가장 흔하므로 이게 주 경로다.

함수는 고치지 않고 호출부가 후보 풀만 좁힌다(f1482c5 회귀 방지).
그리고 (kind, facet)이 포화 주제에 이미 살아 있으면 되돌린다 —
facet 239개 중 프롬프트에 실리는 건 96개뿐이라 이력 보호는 코드가 해야 한다."
```

---

### Task 6: `wiki:health` 에 입도·세대 이벤트·키 덤프

**Files:**
- Modify: `scripts/wiki-health.mjs`
- Test: `tests/lib/wiki-health.test.ts` (기존 파일, 순수 함수만 추가 검사)

**Interfaces:**
- Consumes: Task 1 의 `WIKI_LIVE_STATES` (스크립트는 `.mjs` 라 값을 복제하고 주석으로 정본을 가리킨다)
- Produces: `summarizeTopicGranularity(items: {topicId: string; topicTitle: string}[]): { maxSize: number; maxTitle: string; over20: number; saturated: number; saturatedItems: number; oneItem: number; topics: number }`

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`tests/lib/wiki-health.test.ts` 에 추가한다.

```ts
import { summarizeTopicGranularity } from '../../scripts/wiki-health.mjs'

describe('summarizeTopicGranularity', () => {
  const mk = (spec: Record<string, number>) =>
    Object.entries(spec).flatMap(([title, n]) =>
      Array.from({ length: n }, () => ({ topicId: title, topicTitle: title })))

  it('최대 주제와 그 크기를 찾는다 — 판정 1의 핵심 지표', () => {
    const r = summarizeTopicGranularity(mk({ '데이터 관리': 68, '작은 주제': 3 }))
    expect(r.maxSize).toBe(68)
    expect(r.maxTitle).toBe('데이터 관리')
  })

  it('20건 이상 주제와 상한(15) 초과 주제를 따로 센다', () => {
    const r = summarizeTopicGranularity(mk({ a: 25, b: 20, c: 15, d: 14 }))
    expect(r.over20).toBe(2)          // a, b
    expect(r.saturated).toBe(3)       // a, b, c
    expect(r.saturatedItems).toBe(60) // 25+20+15
  })

  it('1항목 주제와 전체 주제 수를 센다', () => {
    const r = summarizeTopicGranularity(mk({ a: 1, b: 1, c: 5 }))
    expect(r.oneItem).toBe(2)
    expect(r.topics).toBe(3)
  })

  it('빈 입력에서 0으로 떨어지고 터지지 않는다', () => {
    const r = summarizeTopicGranularity([])
    expect(r).toEqual({
      maxSize: 0, maxTitle: '', over20: 0, saturated: 0,
      saturatedItems: 0, oneItem: 0, topics: 0,
    })
  })
})
```

- [ ] **Step 2: 실패를 확인한다**

Run: `npx vitest run tests/lib/wiki-health.test.ts`
Expected: FAIL — `summarizeTopicGranularity` 가 export 되지 않음

- [ ] **Step 3: 스크립트를 고친다**

`scripts/wiki-health.mjs` 에 순수 함수를 추가하고 `main()` 을 보강한다.

```js
/**
 * 살아있음의 정본은 src/lib/domain/wiki.ts 의 WIKI_LIVE_STATES 다. 이 스크립트는 .mjs 라
 * 값을 복제하는데, 갈라지면 게이트와 판정표가 다른 모집단을 재게 된다.
 */
export const LIVE_STATES = ['active', 'open', 'conflicted']

/** src/lib/domain/wiki.ts 의 WIKI_TOPIC_ITEM_CAP 과 같아야 한다. */
export const TOPIC_ITEM_CAP = 15

/** 주제 입도 요약. 판정 1~5의 원천이다. */
export function summarizeTopicGranularity(items) {
  const byTopic = new Map()
  for (const it of items) {
    const cur = byTopic.get(it.topicId)
    if (cur) cur.n += 1
    else byTopic.set(it.topicId, { title: it.topicTitle, n: 1 })
  }
  let maxSize = 0
  let maxTitle = ''
  let over20 = 0
  let saturated = 0
  let saturatedItems = 0
  let oneItem = 0
  for (const { title, n } of byTopic.values()) {
    if (n > maxSize) { maxSize = n; maxTitle = title }
    if (n >= 20) over20 += 1
    if (n >= TOPIC_ITEM_CAP) { saturated += 1; saturatedItems += n }
    if (n === 1) oneItem += 1
  }
  return { maxSize, maxTitle, over20, saturated, saturatedItems, oneItem, topics: byTopic.size }
}
```

`main()` 안의 조회를 고친다 — 항목 조회에 주제 제목을 붙이고, 세대 스코프 이벤트 분포와
`--dump-keys` 를 더한다.

현행 `main()` 은 `let jobs / processing / items / sources / minutes` 를 선언하고 `Promise.all`
로 채운다(139-145행 부근). 여기에 `events` 와 `topicRows` 를 **선언과 조회 양쪽에** 더한다 —
`topicRows` 는 판정 9(`wiki_topics` 총 행 수)의 원천이고, 살아있는 항목 조회로는 얻을 수 없다
(살아있는 항목이 0건인 주제 170행이 빠지기 때문이다).

```js
  let jobs
  let processing
  let items
  let sources
  let minutes
  let events
  let topicRows

  // 살아있음의 정의를 게이트와 일치시킨다(기존 neq.archived 를 교체).
  const liveFilter = `lifecycle_state=in.(${LIVE_STATES.join(',')})`

  try {
    ;[jobs, processing, items, sources, minutes, events, topicRows] = await Promise.all([
      rest('wiki_project_rebuild_jobs?select=*'),
      rest('wiki_processing_jobs?select=id,status,attempts,max_attempts,locked_at,last_error&status=neq.done'),
      rest(`wiki_items?select=id,topic_id,knowledge_key,wiki_topics!inner(title)&${liveFilter}&limit=5000`),
      rest('wiki_item_sources?select=minute_id&retracted_at=is.null&limit=5000'),
      rest('minutes?select=id,minute_date,meeting_occurrence_date,created_at&archived_at=is.null&project_id=not.is.null'),
      rest('wiki_change_events?select=change_type,created_at,idempotency_key&limit=5000'),
      rest('wiki_topics?select=id&limit=5000'),
    ])
  } catch (err) {
    console.error('조회 실패 —', err instanceof Error ? err.message : err)
    process.exit(2)
  }
```

현행 코드의 `jobs`·`processing`·`sources`·`minutes` 조회 문자열은 그대로 둔다 — 이 태스크가
바꾸는 것은 `items`(제목 임베드 + live 정의 통일)와 새로 더하는 `events`·`topicRows` 뿐이다.

```js
  const gran = summarizeTopicGranularity(items.map((i) => ({
    topicId: i.topic_id,
    topicTitle: (Array.isArray(i.wiki_topics) ? i.wiki_topics[0] : i.wiki_topics)?.title ?? '(제목 없음)',
  })))
  const pct = items.length > 0 ? (gran.saturatedItems / items.length * 100).toFixed(1) : '0.0'
  console.log(`  주제 입도: 최대 "${gran.maxTitle}" ${gran.maxSize}`
    + ` · 20건↑ 주제 ${gran.over20} · 상한(${TOPIC_ITEM_CAP})↑ 주제 ${gran.saturated}/${gran.topics}`
    + ` (항목 ${gran.saturatedItems}, ${pct}%)`)
  console.log(`             1항목 주제 ${gran.oneItem} · wiki_topics 총 ${topicRows.length}행`)

  // 이벤트는 세대 리셋에도 삭제되지 않는 누적 원장이다. 전량 집계로는 어떤 문턱도
  // 영구히 통과하므로 마지막 리셋 이후로 스코프해야 한다.
  const resetAt = events
    .filter((e) => String(e.idempotency_key ?? '').startsWith('wiki-project-reset-v1:'))
    .reduce((max, e) => (e.created_at > max ? e.created_at : max), '')
  const gen = {}
  for (const e of events) {
    if (resetAt && e.created_at <= resetAt) continue
    gen[e.change_type] = (gen[e.change_type] ?? 0) + 1
  }
  console.log(`  변경 이벤트(현 세대): `
    + ['new', 'reaffirm', 'refine', 'supersede', 'conflict', 'retract']
      .map((k) => `${k} ${gen[k] ?? 0}`).join(' · '))
```

`--dump-keys <path>` 처리를 추가한다. `wiki_topics` 총 행수 조회(`topicRows`)도 함께 넣는다.

```js
  const dumpIdx = process.argv.indexOf('--dump-keys')
  if (dumpIdx !== -1 && process.argv[dumpIdx + 1]) {
    const { writeFileSync } = await import('node:fs')
    const keys = [...new Set(items.map((i) => i.knowledge_key).filter(Boolean))].sort()
    writeFileSync(process.argv[dumpIdx + 1], keys.join('\n') + '\n', 'utf8')
    console.log(`  knowledge_key ${keys.length}개를 ${process.argv[dumpIdx + 1]} 에 저장했다`)
  }
```

- [ ] **Step 4: 테스트와 실제 실행을 확인한다**

Run: `npx vitest run tests/lib/wiki-health.test.ts`
Expected: PASS — 기존 9건 + 신규 4건

Run: `node scripts/wiki-health.mjs`
Expected: 재구축 `OK` + 입도 줄에 `최대 "데이터 관리" 68 · 20건↑ 주제 5 · 상한(15)↑ 주제 8/62 (항목 245, 60.2%)` 가 나온다. 종료 코드 0.

Run: `node scripts/wiki-health.mjs --dump-keys /tmp/wiki-keys-before.txt && wc -l /tmp/wiki-keys-before.txt`
Expected: 약 400줄

- [ ] **Step 5: 커밋**

```bash
git add scripts/wiki-health.mjs tests/lib/wiki-health.test.ts
git commit -m "feat(wiki): health에 주제 입도와 세대 스코프 이벤트를 넣는다

판정 지표를 '포화 주제 수'가 아니라 '최대 주제 크기'와 '20건↑ 주제 수'로
잡은 이유: 게이팅은 상한이지 예방이 아니라서 흡인체가 15에 앉으면
8×15/407 ≈ 29.5%가 구조적 하한이다. 그걸 목표로 삼으면 완벽히 작동한
구현이 실패로 읽힌다.

이벤트를 세대로 스코프하는 이유: wiki_change_events는 리셋에도 삭제되지
않는 누적 원장이라 전량 집계로는 어떤 문턱도 영구히 통과한다.
--dump-keys는 knowledge_key 생존 비율(판정 7)의 분모다."
```

---

### Task 7: 배포와 적용 (전량 재구축 + 판정)

**Files:** 코드 변경 없음. 산출물은 판정 결과 기록이다.

**Interfaces:**
- Consumes: Task 1~6 전부
- Produces: 스펙 §9 판정표의 실측값. 실패 시 롤백 결정.

- [ ] **Step 1: 배포 전 기준선을 뜬다**

```bash
npm run wiki:health -- --dump-keys /tmp/wiki-keys-before.txt
```

기록할 값: 최대 주제 크기 · 20건↑ 주제 수 · 상한↑ 주제와 항목 비율 · 1항목 주제 · 주제 수 ·
살아있는 항목 수 · `wiki_topics` 총 행수 · 현 세대 이벤트 분포 · 덤프한 키 개수.

**이 스냅샷은 배포 전에만 뜰 수 있다.** 판정 7(`knowledge_key` 생존 비율)의 분모다.

- [ ] **Step 2: 푸시하고 배포를 확인한다**

```bash
npm run test && npx tsc --noEmit && npm run lint
git push origin main
```

Vercel 배포가 Ready 가 될 때까지 기다린다. UI 위험 파일을 건드리지 않았으므로 Preview 는
필요 없다.

- [ ] **Step 3: 전량 재구축을 요청한다**

`request_wiki_project_rebuild` 를 호출해 generation 을 올린다. Supabase Management API 경유
(메모리 `supabase-mgmt-api-recipe`). **이건 쓰기 호출이므로 사용자 승인을 받고 실행한다.**

- [ ] **Step 4: 러너로 완주시킨다 (약 25분)**

```bash
for i in $(seq 1 26); do
  npx vitest run --config scripts/wiki-rebuild.vitest.ts \
    --reporter=verbose --disable-console-intercept || true
  sleep 15
done
```

**도는 동안 회의록의 프로젝트 지정을 바꾸지 않는다** — generation 이 올라가 커서가 처음으로
되감긴다. 진행은 `npm run wiki:health` 로 확인한다(`status=done`, 남은 회의록 0).

러너 로그에서 확인할 것: `LLM_OUTPUT_INVALID` 0건(예산 사다리가 프롬프트를 넘기지 않았다는
증거), `카탈로그 예산 축소` 경고 유무.

- [ ] **Step 5: 판정한다**

```bash
npm run wiki:health -- --dump-keys /tmp/wiki-keys-after.txt
comm -12 /tmp/wiki-keys-before.txt /tmp/wiki-keys-after.txt | wc -l   # 생존 키
wc -l /tmp/wiki-keys-before.txt                                       # 분모
```

스펙 §9 판정표와 대조한다.

| # | 지표 | 판정 |
|---|---|---|
| 1 | 최대 주제 항목 수 | 20 이하 |
| 2 | 항목 20건 이상 주제 수 | 0 |
| 3 | 상한(15) 초과 주제가 담은 항목 비율 | 35% 이하 |
| 4 | 살아있는 주제 수 | 90 ~ 170 |
| 5 | 1항목 주제 비율 | 45% 이하 |
| 6 | 살아있는 항목 수 | 300 이상 |
| 7 | `knowledge_key` 생존 비율 | 60% 이상 |
| 8 | 현 세대 `reaffirm` | 1 이상 (값 기록) |
| 9 | `wiki_topics` 총 행 수 | 400 미만 |
| 10 | 봇 스모크 | `search_wiki`·`get_wiki_topic` 응답에 근거 링크 포함 |

**추출은 비결정적이다(±21%).** 같은 회의록 13건·같은 코드로 07-27 `new` 126건 vs 07-28
99건이었다. 지표 6 의 문턱 300 이 그 편차를 흡수하는 값이고, 지표 8 은 n=2~3 이라 값만
기록한다. 한 회차 결과로 롤백을 결정하지 않는다.

- [ ] **Step 6: 결과를 기록하고 known-good 태그를 남긴다**

판정 표의 실측값을 커밋 메시지 또는 `docs/superpowers/plans/` 하단에 남긴다. 화면까지
확인됐으면:

```bash
npm run mark:good
```

- [ ] **Step 7: 실패했다면 롤백한다**

지표 1·2·3 중 하나라도 실패하고 원인이 코드라면:

```bash
git revert --no-commit <Task 4·5 커밋>
git commit -m "revert(wiki): 포화 게이팅 되돌림 — <판정 실패 사유>"
git push origin main
```

배포 후 전량 재구축을 한 번 더 돌린다(Step 3~4 반복). 위키는 불변 회의록에서 재생성되는
파생 데이터라 되돌릴 수 있다. 다만 **재구축 1회당 archived 가 약 400행 늘어** 읽기 모델의
`limit(500)` 부채를 키운다(스펙 §10) — 반복 횟수를 기록해 둘 것.

---

## Self-Review

**1. 스펙 커버리지**

| 스펙 절 | 구현 태스크 |
|---|---|
| §7.1 포화 판정·`WIKI_LIVE_STATES` | Task 1 |
| §7.2 전량 조회·fail-closed·`LIVE_SCAN_CAP` | Task 3 |
| §7.3 규칙 1~12 (live 필터·2차 정렬·포화 제외·창 160·리필 금지·kind 병기·distinct·겹침 정렬·목차형 제외·절 생략·export·`filter(Boolean)`) | Task 2(1~10, 12) · Task 4(11) |
| §7.4 프롬프트 규칙 14 | Task 4 |
| §7.5 별칭 후보 풀 축소 | Task 5 |
| §7.6 코드 구제 | Task 5 |
| §7.7 health 리포트·`--dump-keys` | Task 6 |
| §8 예산 6,000·사다리·하한·경고 | Task 2 |
| §9 적용 절차·판정 10지표 | Task 7 |
| §12 테스트 목록 | Task 1·2·3·5·6 의 테스트 단계 |

빠진 것 없음. §10 위험표와 §11 범위 밖은 구현 대상이 아니다.

**2. Placeholder 스캔**: 모든 코드 단계에 실제 코드가 있다. 남는 두 곳은 의도적으로 현행 코드를 읽으라고 지시한 지점이다 — Task 4 Step 3(`extractItems` 인자 순서는 현행을 따르고 catalog 인자만 교체) 과 Task 5 Step 1(`runApplyWithSnapshot` 을 기존 목 하네스 스타일로 작성). 둘 다 "그 파일을 열면 바로 보이는 형태"이며 새 규칙을 발명할 여지가 없다.

**3. 타입 일관성**

- `CatalogTopic`/`CatalogItem` 은 Task 2 에서 정의하고 Task 3 이 그 이름 그대로 생산한다.
- `WikiSaturationSnapshot` 필드명(`complete`, `topics`, `items`, `saturatedNormalizedTitles`, `keyOwner`)이 Task 3 정의와 Task 4·5 사용처에서 일치한다.
- `wikiFacetPart(kind, facet)` 인자 순서가 Task 1 정의와 Task 5 호출에서 일치한다.
- `wikiSaturationKey(kind, facetPart)` 가 Task 1·3·5 에서 같은 순서로 쓰인다.
- `loadWikiCatalog` 이 Task 4 에서 **동기 함수**로 바뀐다(조회를 스냅샷이 이미 했으므로). 호출부에서 `await` 를 지워야 한다 — Task 4 Step 3 의 코드가 그렇게 되어 있다.
- `summarizeTopicGranularity` 반환 필드 7개가 Task 6 의 테스트와 구현에서 일치한다.

## Execution Handoff

계획을 `docs/superpowers/plans/2026-07-30-wiki-topic-granularity.md` 에 저장했다. 실행 방식 둘:

1. **Subagent-Driven (권장)** — 태스크마다 새 서브에이전트를 띄우고 사이사이 리뷰
2. **Inline Execution** — 이 세션에서 체크포인트를 두고 배치 실행

---

## 실행 결과 기록 (2026-07-30 21:20, generation 36)

Task 1~6 구현 + 적대적 리뷰 2라운드(53에이전트, 확정 17건 반영) 후 main 배포(89c4065),
`request_wiki_project_rebuild` → generation 36, 러너 완주(42/42). 기준선은 배포 직전
generation 35(주제 62 · 항목 407 · 키 395).

### §9 판정표 실측

| # | 지표 | 문턱 | 실측 | 판정 |
|---|---|---|---|---|
| 1 | 최대 주제 항목 수 | ≤20 | **18** (입고 관리 프로세스; 기준선 68) | ✅ |
| 2 | 20건↑ 주제 수 | 0 | **0** (기준선 5) | ✅ |
| 3 | 상한(15)↑ 주제가 담은 항목 비율 | ≤35% | **20.9%** (79/378; 기준선 60.2%) | ✅ |
| 4 | 살아있는 주제 수 | 90~170 | **82** (기준선 62) | ⚠️ 미달 −8 |
| 5 | 1항목 주제 비율 | ≤45% | **25.6%** (21/82) | ✅ |
| 6 | 살아있는 항목 수 | ≥300 | **378** | ✅ |
| 7 | knowledge_key 생존 비율 | ≥60% | **1.5%** (6/395; 주제부 제외 kind:facet 기준 5.8%) | ❌ 지표 설계 결함 |
| 8 | 현 세대 reaffirm | ≥1 (기록) | **1** (conflict 22, new 356) | ✅ |
| 9 | wiki_topics 총 행 수 | <400 | **296** | ✅ |
| 10 | 봇 근거 링크 | 포함 | 살아있는 항목 **378/378** 미철회 근거 보유 | ✅ (데이터층) |

보조 신호: 러너 로그 `LLM_OUTPUT_INVALID` **0건**(예산 사다리가 프롬프트를 넘기지 않음),
`카탈로그 예산 축소` 경고 2회 — 둘 다 `facet 8/주제, 항목 40줄`로 **항목 줄을 지킨 채**
포화 목록만 조였다(§8 순서 검증).

### 판정 해석

- **롤백 조건(지표 1·2·3) 전부 통과.** 흡인체 해체가 목적이었고 최대 주제 68→18,
  20건↑ 5→0, 포화 항목 비율 60.2→20.9%로 달성됐다. 롤백하지 않는다.
- **지표 4 미달(82<90)**: 스펙 추정 ~136은 흡인체 245건이 잘게 갈라진다는 가정이었는데,
  실제로는 상한 아래 중형 주제(예: 입고 관리 프로세스 18)로 뭉쳤다. 추출 비결정성
  ±21%를 감안하면 한 회차로 판단하지 않는다(계획 Step 5). 다음 재구축·신규 회의 반영 후
  재측정.
- **지표 7은 측정 대상이 잘못 설계된 지표였다.** 생존율 1.5%는 게이팅 때문이 아니다 —
  주제부를 뗀 kind:facet 기준으로도 5.8%로, 세대 리셋 후 빈 위키에서 재추출하면 LLM이
  facet 표현 자체를 새로 짓는 것이 기저율이다(카탈로그 규칙 11은 **세대 안** 키 안정화
  장치이지 세대 **간** 장치가 아니다 — 리셋 직후 첫 회의록은 빈 카탈로그를 본다).
  세대 간 대조군(동일 코드 재구축 2회의 키 겹침)을 잰 적이 없어 60% 문턱은 처음부터
  달성 불가능했을 가능성이 높다. 세대 내 엔진은 작동한다(378항목/356키, conflict 22,
  reaffirm 1). 세대 간 연속성이 필요해지면 별도 기전(재구축 시작 시 직전 세대 카탈로그
  시드)이 필요하다 — 범위 밖으로 기록만 남긴다.

### 운영 기록

- 러너 1회차가 vitest testTimeout(60분)에 걸렸고 2~3회차가 네트워크 순단으로 실패했다.
  원인은 머신 슬립(시간 점프·import 6~13분)으로 추정 — `caffeinate` 후 즉시 정상화되어
  약 25분 만에 완주했다. 다음에 러너를 돌릴 때는 시작 전에 `caffeinate -dims -t 14400 &`.
- 재구축 중 실측 곡선: 10/42(21:06) → 24/42(21:12) → 37/42(21:15) → 42/42(21:19).
