import { describe, it, expect, vi } from 'vitest'
import {
  LIVE_SCAN_CAP,
  LIVE_SCAN_PAGE,
  loadWikiSaturation,
} from '@/lib/ai/wiki-saturation'

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

/**
 * from() 호출 한 번 = 페이지 요청 한 번. 페이지 큐를 순서대로 소비한다 —
 * 서버 max_rows 캡 때문에 전량 조회가 페이지 순회로 바뀌었기 때문이다.
 */
function admin(pages: Array<{ data: Row[] | null; error?: { code: string } | null }>) {
  let call = 0
  const make = () => {
    const resp = pages[Math.min(call, pages.length - 1)]
    call += 1
    const chain: Record<string, unknown> = {}
    for (const k of ['select', 'eq', 'in', 'order', 'range', 'limit']) {
      chain[k] = () => chain
    }
    chain.then = (res: unknown, rej: unknown) =>
      Promise.resolve({ data: resp?.data ?? null, error: resp?.error ?? null })
        .then(res as never, rej as never)
    return chain
  }
  return { from: make } as never
}

describe('loadWikiSaturation', () => {
  it('주제별 살아있는 항목 수를 세고 포화를 판정한다', async () => {
    const rows = Array.from({ length: 15 }, (_, i) => row({
      knowledge_key: `데이터 관리:decision:f-${i}`,
    }))
    const snap = await loadWikiSaturation(admin([{ data: rows }]), 'p1')
    expect(snap.complete).toBe(true)
    expect(snap.topics).toHaveLength(1)
    expect(snap.topics[0].liveCount).toBe(15)
    expect(snap.saturatedNormalizedTitles.has('데이터 관리')).toBe(true)
  })

  it('상한 미만 주제는 포화가 아니다', async () => {
    const rows = Array.from({ length: 14 }, (_, i) => row({
      knowledge_key: `데이터 관리:decision:f-${i}`,
    }))
    const snap = await loadWikiSaturation(admin([{ data: rows }]), 'p1')
    expect(snap.saturatedNormalizedTitles.size).toBe(0)
    expect(snap.keyOwner.size).toBe(0)
  })

  it('포화 주제의 (kind, facet) 소유자를 기록한다 — 코드 구제의 근거', async () => {
    const rows = Array.from({ length: 15 }, (_, i) => row({
      knowledge_key: `데이터 관리:decision:f-${i}`,
    }))
    const snap = await loadWikiSaturation(admin([{ data: rows }]), 'p1')
    expect(snap.keyOwner.get('decision:f-0')).toEqual({
      id: 't1', normalizedTitle: '데이터 관리',
    })
    expect(snap.keyOwner.has('fact:f-0')).toBe(false)   // kind 가 다르면 다른 대상
  })

  it('같은 (kind, facet)이 다른 주제에도 살아 있으면 소유가 모호해 구제 근거에서 뺀다', async () => {
    // 포화 주제 '데이터 관리'(15건)와 비포화 주제 '야드 관리'가 decision:공유-대상 을
    // 동시에 갖는다. facet 은 주제 안에서만 유일하므로 전역 (kind,facet) 일치는 소유
    // 증명이 아니다 — 모호한 키로 구제하면 야드 관리 항목이 포화 주제로 납치된다.
    const rows = [
      ...Array.from({ length: 14 }, (_, i) => row({
        knowledge_key: `데이터 관리:decision:f-${i}`,
      })),
      row({ knowledge_key: '데이터 관리:decision:공유-대상' }),
      row({
        topic_id: 'yard',
        knowledge_key: '야드 관리:decision:공유-대상',
        wiki_topics: {
          id: 'yard', title: '야드 관리', normalized_title: '야드 관리',
          last_changed_at: '2026-07-30T00:00:00Z',
        },
      }),
    ]
    const snap = await loadWikiSaturation(admin([{ data: rows }]), 'p1')
    expect(snap.saturatedNormalizedTitles.has('데이터 관리')).toBe(true)
    expect(snap.keyOwner.has('decision:공유-대상')).toBe(false)   // 모호 — 구제 안 함
    expect(snap.keyOwner.has('decision:f-0')).toBe(true)          // 단독 소유는 유지
  })

  it('서버 페이지 캡(1000행)을 넘는 전량을 페이지 순회로 이어 받는다', async () => {
    // PostgREST max_rows=1000은 명시 limit도 깎는다(2026-07-30 프로덕션 실측).
    // 한 번의 limit(2000) 요청은 성립하지 않으므로 range 페이지 순회여야 한다.
    const page1 = Array.from({ length: LIVE_SCAN_PAGE }, (_, i) => row({
      knowledge_key: `데이터 관리:decision:p1-${i}`,
    }))
    const page2 = Array.from({ length: 5 }, (_, i) => row({
      knowledge_key: `데이터 관리:decision:p2-${i}`,
    }))
    const snap = await loadWikiSaturation(admin([{ data: page1 }, { data: page2 }]), 'p1')
    expect(snap.complete).toBe(true)
    expect(snap.topics[0].liveCount).toBe(LIVE_SCAN_PAGE + 5)
  })

  it('스캔 상한에 닿으면 불완전으로 표시하고 경고한다 (fail-closed)', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    // 앞 15건은 한 주제('핫 주제')에 몰아 — 게이팅이 켜졌다면 반드시 포화로 잡혔을
    // 입력이다. 그래도 cap 에 닿았기 때문에 포화 집계 자체가 비어야 한다(fail-closed).
    const hotRows = Array.from({ length: 15 }, (_, i) => row({
      topic_id: 'hot',
      knowledge_key: `핫 주제:decision:f-${i}`,
      wiki_topics: {
        id: 'hot', title: '핫 주제', normalized_title: '핫 주제',
        last_changed_at: '2026-07-30T00:00:00Z',
      },
    }))
    const fillerRows = Array.from({ length: LIVE_SCAN_CAP - hotRows.length }, (_, i) => row({
      topic_id: `t${i}`,
      knowledge_key: `주제${i}:decision:f`,
      wiki_topics: {
        id: `t${i}`, title: `주제${i}`, normalized_title: `주제${i}`,
        last_changed_at: '2026-07-30T00:00:00Z',
      },
    }))
    const rows = [...hotRows, ...fillerRows]
    expect(rows).toHaveLength(LIVE_SCAN_CAP)
    const pages = []
    for (let i = 0; i < rows.length; i += LIVE_SCAN_PAGE) {
      pages.push({ data: rows.slice(i, i + LIVE_SCAN_PAGE) })
    }
    const snap = await loadWikiSaturation(admin(pages), 'p1')
    expect(snap.complete).toBe(false)
    expect(snap.saturatedNormalizedTitles.size).toBe(0)
    expect(snap.keyOwner.size).toBe(0)
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })

  it('조회가 실패하면 빈 스냅샷을 돌려주고 불완전으로 표시한다 — 추출은 계속한다', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    const snap = await loadWikiSaturation(
      admin([{ data: null, error: { code: '42P01' } }]),
      'p1',
    )
    expect(snap.complete).toBe(false)
    expect(snap.topics).toHaveLength(0)
    expect(snap.saturatedNormalizedTitles.size).toBe(0)
    expect(snap.keyOwner.size).toBe(0)
    expect(err).toHaveBeenCalled()
    err.mockRestore()
  })

  it('두 번째 페이지가 실패해도 빈 스냅샷으로 떨어진다 — 반쪽 데이터로 판정하지 않는다', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    const page1 = Array.from({ length: LIVE_SCAN_PAGE }, (_, i) => row({
      knowledge_key: `데이터 관리:decision:p1-${i}`,
    }))
    const snap = await loadWikiSaturation(
      admin([{ data: page1 }, { data: null, error: { code: '57014' } }]),
      'p1',
    )
    expect(snap.complete).toBe(false)
    expect(snap.topics).toHaveLength(0)
    expect(snap.keyOwner.size).toBe(0)
    err.mockRestore()
  })
})
