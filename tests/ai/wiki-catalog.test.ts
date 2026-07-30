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

  // 아래 두 건은 리뷰 지적(2026-07-30) 반영: 주제 줄 절단 while 루프와 최종 초과 폴백이
  // 위 예산 테스트 두 건 모두 사다리 안에서 끝나 실행되지 않았다. f74fc5a(카탈로그 비대 →
  // LLM_OUTPUT_INVALID → 재구축 큐 정지)의 재발을 막는 마지막 두 방어선이라 직접 태운다.
  it('주제 줄이 아주 많고 길면 절단 while 루프가 실행돼 예산 안으로 들어온다', () => {
    // items를 비워 topicCount(최대 CATALOG_TOPIC_LIMIT=160개)만이 예산을 결정하게 한다.
    // 항목/포화 목록이 섞이면 어느 항이 절단을 만들었는지 구분할 수 없다.
    const filler = '가'.repeat(50)
    const topics = Array.from({ length: 400 }, (_, t) => topic({
      id: `t${t}`, title: `주제-${filler}-${t}`, normalizedTitle: `t${t}`, liveCount: 2,
    }))
    const { text, warnings } = buildWikiCatalogText({
      topics, items: [], bodyMd: '', gatingEnabled: true,
    })
    expect(text.length).toBeLessThanOrEqual(CATALOG_CHAR_BUDGET)
    expect(warnings.some((w) => w.includes('주제 줄'))).toBe(true)
    const topicLine = text.split('\n').find((l) => l.startsWith('기존 주제:')) ?? ''
    // advertised는 160개로 캡되는데, 절단이 실제로 일어났다면 그보다 적게 보여야 한다.
    expect(topicLine.split(' / ').length).toBeLessThan(160)
  })

  it('포화 주제가 아주 많으면 최종 폴백으로 예산을 넘긴 채 보내되 목록은 2개를 유지한다', () => {
    // 포화 절은 topicCount 절단의 영향을 받지 않는다(모든 포화 주제를 나열) — 포화 주제
    // 수만 충분히 늘리면 FACETS_FLOOR=2/주제로도 절대 예산 안에 들어오지 않는다.
    const topics = Array.from({ length: 600 }, (_, t) => topic({
      id: `t${t}`, title: `포화폭주${t}`, normalizedTitle: `s${t}`, liveCount: 20,
    }))
    const items = topics.flatMap((tp) => Array.from({ length: 3 }, (_, i) => item({
      topicId: tp.id, topicTitle: tp.title, facetPart: `설비이상-정지-원인-분석-${tp.id}-${i}`,
    })))
    const { text, warnings } = buildWikiCatalogText({
      topics, items, bodyMd: '', gatingEnabled: true,
    })
    expect(text.length).toBeGreaterThan(CATALOG_CHAR_BUDGET)
    const saturatedLines = text.split('\n').filter((l) => l.startsWith('포화 '))
    expect(saturatedLines.length).toBeGreaterThan(0)
    for (const line of saturatedLines) {
      expect(line.split(', ').length).toBeGreaterThanOrEqual(2)
    }
    // 경고에 초과 사실과 실제 문자수가 그대로 담겨야 한다 — text.length와 다른 값이면
    // 부분 합으로 측정했다는 뜻이라 CATALOG_CHAR_BUDGET 주석의 계약을 어긴 것이다.
    expect(warnings.some((w) => w.includes('초과') && w.includes(String(text.length)))).toBe(true)
  })
})
