import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('@/lib/supabase/server', () => ({ createServerClient: vi.fn() }))

import { createServerClient } from '@/lib/supabase/server'
import { getProjectAiBriefs, briefFrom } from '@/lib/data/aiBriefs'

type Reply = { data: unknown[] | null; error: { message: string } | null }

function makeSb(reply: Reply) {
  const tables: string[] = []
  const chain = () => {
    const o: Record<string, unknown> = {}
    for (const k of ['eq', 'order', 'limit']) o[k] = () => o
    o.then = (res: unknown, rej: unknown) => Promise.resolve(reply).then(res as never, rej as never)
    return o
  }
  const sb = {
    from: (table: string) => { tables.push(table); return { select: () => chain() } },
  }
  ;(createServerClient as unknown as { mockResolvedValue: (v: unknown) => void })
    .mockResolvedValue(sb)
  return { tables }
}

const row = (kind: string, cacheKey: string, headline: string) => ({
  kind, cache_key: cacheKey, headline, body_md: `# ${headline}`, items: [],
  status: 'ready', input_hash: 'h1', model: 'gemini', updated_at: '2026-07-20T00:00:00Z',
})

beforeEach(() => { vi.spyOn(console, 'error').mockImplementation(() => {}) })
afterEach(() => { vi.restoreAllMocks() })

describe('getProjectAiBriefs — risk·weekly 를 한 왕복으로', () => {
  it('kind:cache_key 로 색인하고 briefFrom 이 정확히 꺼낸다', async () => {
    const { tables } = makeSb({
      data: [
        row('risk', '', '위험 해설'),
        row('weekly', '2026-07-20', '주간 브리핑'),
      ],
      error: null,
    })
    const briefs = await getProjectAiBriefs('p-both')
    expect(briefFrom(briefs, 'risk', '')?.headline).toBe('위험 해설')
    expect(briefFrom(briefs, 'weekly', '2026-07-20')?.headline).toBe('주간 브리핑')
    // 왕복 1회 — 예전의 "배치 + 후속 weekly 조회" 직렬 2단을 없앤 것이 이 수정의 목적.
    expect(tables).toEqual(['project_ai_briefs'])
  })

  it('기준일이 다르면 매치되지 않는다 — cache_key 는 base_date 라 날짜가 곧 신선도', async () => {
    makeSb({ data: [row('weekly', '2026-07-20', '어제 것')], error: null })
    const briefs = await getProjectAiBriefs('p-staledate')
    expect(briefFrom(briefs, 'weekly', '2026-07-21')).toBeNull()
    expect(briefFrom(briefs, 'weekly', '2026-07-20')?.headline).toBe('어제 것')
  })

  it("kind 가 다르면 섞이지 않는다 — risk 의 cache_key 는 ''로 고정", async () => {
    makeSb({ data: [row('risk', '', '위험')], error: null })
    const briefs = await getProjectAiBriefs('p-kind')
    expect(briefFrom(briefs, 'weekly', '')).toBeNull()
    expect(briefFrom(briefs, 'risk', '')?.headline).toBe('위험')
  })

  it('행이 없으면 briefFrom 이 null — getAiBrief 의 "행 없음" 계약과 동일', async () => {
    makeSb({ data: [], error: null })
    const briefs = await getProjectAiBriefs('p-empty')
    expect(briefFrom(briefs, 'risk', '')).toBeNull()
    expect(briefFrom(briefs, 'weekly', '2026-07-20')).toBeNull()
  })

  it('조회 실패는 빈 Map + 로그 — null 반환하던 기존 getAiBrief 와 호출부 계약이 같다', async () => {
    makeSb({ data: null, error: { message: 'permission denied' } })
    const briefs = await getProjectAiBriefs('p-err')
    expect(briefs.size).toBe(0)
    expect(briefFrom(briefs, 'risk', '')).toBeNull()
    expect(console.error).toHaveBeenCalledOnce()
  })

  it('행 필드를 AiBriefRow 형태로 그대로 옮긴다', async () => {
    makeSb({ data: [row('risk', '', '헤드라인')], error: null })
    const b = briefFrom(await getProjectAiBriefs('p-shape'), 'risk', '')
    expect(b).toEqual({
      headline: '헤드라인', bodyMd: '# 헤드라인', items: [], status: 'ready',
      inputHash: 'h1', model: 'gemini', updatedAt: '2026-07-20T00:00:00Z',
    })
  })
})
