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
    const snap = await loadWikiSaturation(admin(rows), 'p1')
    expect(snap.complete).toBe(false)
    expect(snap.saturatedNormalizedTitles.size).toBe(0)
    expect(snap.keyOwner.size).toBe(0)
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })

  it('조회가 실패하면 빈 스냅샷을 돌려주고 불완전으로 표시한다 — 추출은 계속한다', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    const snap = await loadWikiSaturation(admin(null, { code: '42P01' }), 'p1')
    expect(snap.complete).toBe(false)
    expect(snap.topics).toHaveLength(0)
    expect(snap.saturatedNormalizedTitles.size).toBe(0)
    expect(snap.keyOwner.size).toBe(0)
    expect(err).toHaveBeenCalled()
    err.mockRestore()
  })
})
