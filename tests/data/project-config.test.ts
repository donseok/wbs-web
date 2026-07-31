import { describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ createServerClient: vi.fn() }))
vi.mock('@/lib/supabase/server', () => ({ createServerClient: mocks.createServerClient }))
import { getProjectConfig, DEFAULT_PROJECT_CONFIG } from '@/lib/data/projectConfig'

function client(data: unknown, error: { message: string } | null = null) {
  const b: Record<string, unknown> = {}
  for (const k of ['from', 'select', 'eq']) b[k] = () => b
  b.maybeSingle = async () => ({ data, error })
  return b
}

describe('getProjectConfig', () => {
  it('행 없음 = 기본값 (정상 — fail-safe 계약)', async () => {
    mocks.createServerClient.mockResolvedValue(client(null) as never)
    const c = await getProjectConfig('11111111-1111-4111-8111-111111111111')
    expect(c).toEqual(DEFAULT_PROJECT_CONFIG)
  })
  it('조회 실패 = throw (기본값으로 위장 금지 — 3원칙)', async () => {
    mocks.createServerClient.mockResolvedValue(client(null, { message: 'db down' }) as never)
    await expect(getProjectConfig('11111111-1111-4111-8111-111111111111')).rejects.toThrow('db down')
  })
  it('키워드 소문자 정규화', async () => {
    mocks.createServerClient.mockResolvedValue(client({
      level_labels: ['A', 'B'], max_depth: 5, extra_axis_label: null,
      milestone_keywords: ['Kick-Off', 'BMT'], excel_profile: {},
    }) as never)
    const c = await getProjectConfig('11111111-1111-4111-8111-111111111111')
    expect(c.milestoneKeywords).toEqual(['kick-off', 'bmt'])
    expect(c.levelLabels).toEqual(['A', 'B'])
  })
})
