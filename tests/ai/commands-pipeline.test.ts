import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/ai/llm', () => ({ generateAnswer: vi.fn() }))

import { generateAnswer } from '@/lib/ai/llm'
import { runCommandPipeline } from '@/lib/ai/commands/pipeline'
import type { ComputedItem } from '@/lib/domain/types'

const mGen = vi.mocked(generateAnswer)

const leaf = (over: Partial<ComputedItem>): ComputedItem =>
  ({
    id: 'x', parentId: null, level: 'activity', code: '', sortOrder: 0,
    name: '', biz: null, deliverable: null, plannedStart: null, plannedEnd: null,
    weight: null, actualPct: 40, owners: [], plannedPct: 50, rolledActualPct: 40,
    achievement: null, status: 'in_progress', children: [], ...over,
  }) as ComputedItem

const items = [leaf({ id: 'a', name: 'ERP 인터페이스 설계' })]

describe('runCommandPipeline — 큐→파싱→매칭→제안', () => {
  beforeEach(() => vi.clearAllMocks())
  it('조회 문장은 not_command (LLM 미호출)', async () => {
    const r = await runCommandPipeline('지연된 작업이 뭐야?', items)
    expect(r.kind).toBe('not_command')
    expect(mGen).not.toHaveBeenCalled()
  })
  it('결정형 명령 → proposal (LLM 미호출)', async () => {
    const r = await runCommandPipeline('ERP 인터페이스 설계 실적 80으로 올려줘', items)
    expect(r.kind).toBe('proposal')
    expect(mGen).not.toHaveBeenCalled()
  })
  it('targetId 지정 시 매칭을 건너뛰고 해당 항목으로 제안 (되묻기 후속)', async () => {
    const r = await runCommandPipeline('ERP 인터페이스 설계 실적 80으로 올려줘', items, 'a')
    expect(r.kind).toBe('proposal')
    if (r.kind === 'proposal') expect(r.target.id).toBe('a')
  })
  it('파싱 불능(LLM null) → error 안내', async () => {
    mGen.mockResolvedValue(null)
    const r = await runCommandPipeline('기준정보 종료일 미뤄줘', items)
    expect(r.kind).toBe('error')
    if (r.kind === 'error') expect(r.message).toContain('명령을 이해하지 못했어요')
  })
})
