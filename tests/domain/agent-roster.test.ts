import { describe, expect, it } from 'vitest'
import { assembleRoster, modelBadge, parseAgentId, slotLabel } from '@/lib/domain/agentRoster'

const tier = (m: string) => modelBadge(m)?.tier ?? null
import type { Floor, Seat, Watcher } from '@/lib/domain/seatmap'

const seat = (orderId: string, agent: string | null, state: Seat['state']): Seat =>
  ({ orderId, agent, state, code: orderId, name: orderId } as unknown as Seat)
const watcher = (agent: string, slots: number | null, lastSeenAt = '2026-09-18T00:00:00Z'): Watcher =>
  ({ agent, host: null, slots, busy: null, untilLabel: null, lastSeenAt, projectId: null })
const floor = (seats: Seat[], watchers: Watcher[]): Floor =>
  ({ id: 'p', name: 'P', seatCount: seats.length, doneCount: 0, watchers, leads: [], zones: [{ key: 'z', code: 'Z', name: 'Z', seats, summary: { work: 0, wait: 0, ready: 0, done: 0 } }] })

describe('parseAgentId · slotLabel', () => {
  it('<신원>/<host>/<자리> 세 토막만 작업 PC 로 인정한다', () => {
    expect(parseAgentId('jji/macbook/w2')).toEqual({ owner: 'jji', host: 'macbook', slot: 'w2' })
    expect(parseAgentId('claude-macbook')).toBeNull()
    expect(parseAgentId('pat-8f3a21bc')).toBeNull()
    expect(parseAgentId('a/b')).toBeNull()
    expect(parseAgentId('a//w1')).toBeNull()
  })
  it('자리 토큰을 사람 말로 바꾼다', () => {
    expect(slotLabel('w1')).toBe('팀원 1')
    expect(slotLabel('lead')).toBe('팀장')
    expect(slotLabel('poll')).toBe('단독 감시')
  })
})

describe('assembleRoster', () => {
  it('작업 PC 로 묶고 팀장을 맨 앞, 빈자리를 좌석 수만큼 채운다', () => {
    const r = assembleRoster({ floors: [floor(
      [seat('o1', 'jji/macbook/w1', 'ACTIVE'), seat('o2', 'jji/macbook/w2', 'BLOCKED'), seat('o3', 'jji/macbook/w3', 'WAIT')],
      [watcher('jji/macbook/lead', 3)],
    )] })
    expect(r.hosts).toHaveLength(1)
    const h = r.hosts[0]
    expect(h.label).toBe('jji / macbook')
    expect(h.desks.map(d => `${d.kind}:${d.label}`)).toEqual(['lead:팀장', 'member:팀원 1', 'member:팀원 2', 'empty:팀원 3'])
    expect(r.tiles).toEqual({ working: 1, blocked: 1, stale: 0, offline: 0, empty: 1 })
    expect(r.agentCount).toBe(2)
  })
  it('규칙 밖 신원은 자기 이름 한 줄로 뒤에 둔다', () => {
    const r = assembleRoster({ floors: [floor([seat('o1', 'pat-8f3a21bc', 'STALE'), seat('o2', 'jji/win/w1', 'OFFLINE')], [])] })
    expect(r.hosts.map(h => [h.label, h.conforming])).toEqual([['jji / win', true], ['pat-8f3a21bc', false]])
    expect(r.hosts[1].desks[0].label).toBe('외부 에이전트')
    expect(r.tiles).toMatchObject({ stale: 1, offline: 1, empty: 0 })
  })
  it('여러 층에 겹쳐 실린 감시자는 한 번만 센다', () => {
    const w = watcher('jji/macbook/lead', 2)
    const r = assembleRoster({ floors: [floor([], [w]), { ...floor([], [w]), id: 'q' }] })
    expect(r.hosts[0].desks.filter(d => d.kind === 'lead')).toHaveLength(1)
    expect(r.tiles.empty).toBe(2)
  })
})

describe('modelBadge', () => {
  it('Claude 계열은 가족명과 버전을 짧게', () => {
    expect(modelBadge('claude-opus-4-8')).toMatchObject({ vendor: 'claude', label: 'Opus 4.8' })
    expect(modelBadge('sonnet')).toMatchObject({ vendor: 'claude', label: 'Sonnet' })
    expect(modelBadge('claude-sonnet-4-5-20250929')).toMatchObject({ label: 'Sonnet 4.5' })
    expect(modelBadge('claude-opus-5')).toMatchObject({ label: 'Opus 5' })
  })
  it('다른 제조사와 모르는 값', () => {
    expect(modelBadge('gpt-5-codex')).toMatchObject({ vendor: 'openai', label: 'GPT-5-codex' })
    expect(modelBadge('gemini-2.5-pro')).toMatchObject({ vendor: 'gemini' })
    expect(modelBadge('fable-5-1')).toMatchObject({ vendor: 'claude', label: 'Fable 5.1' })
    expect(modelBadge('claude-haiku-4-5-20251001')).toMatchObject({ label: 'Haiku 4.5' })
    expect(modelBadge('grok-4')).toMatchObject({ vendor: 'grok', label: 'Grok-4' })
    expect(modelBadge('llama-3.3-70b')).toMatchObject({ vendor: 'llama' })
    expect(modelBadge('devstral-medium')).toMatchObject({ vendor: 'mistral', label: 'Devstral-medium' })
    expect(modelBadge('deepseek-coder')).toMatchObject({ vendor: 'deepseek', label: 'DeepSeek-coder' })
    expect(modelBadge('qwen3-coder')).toMatchObject({ vendor: 'qwen', label: 'Qwen3-coder' })
    expect(modelBadge('local-llm')).toMatchObject({ vendor: 'other', label: 'local-llm' })
    expect(modelBadge('  ')).toBeNull()
    expect(modelBadge(null)).toBeNull()
  })
})

describe('modelBadge 등급 — 제조사 라인업 안에서 4단계', () => {
  it('Claude: Fable 1 · Opus 2 · Sonnet 3 · Haiku 4', () => {
    expect(['fable-5-1', 'claude-opus-5', 'claude-sonnet-5', 'claude-haiku-4-5-20251001'].map(tier)).toEqual([1, 2, 3, 4])
    expect(tier('claude')).toBeNull()
  })
  it('다른 제조사', () => {
    expect(['gpt-5-pro', 'gpt-5-codex', 'gpt-5-mini', 'gpt-5-nano'].map(tier)).toEqual([1, 2, 3, 4])
    expect(['gemini-ultra', 'gemini-2.5-pro', 'gemini-2.5-flash', 'gemini-2.5-flash-lite'].map(tier)).toEqual([1, 2, 3, 4])
    expect(['grok-4-heavy', 'grok-4', 'grok-4-fast', 'grok-3-mini'].map(tier)).toEqual([1, 2, 3, 4])
    expect(['mistral-large', 'devstral-medium', 'mistral-small', 'ministral-8b'].map(tier)).toEqual([1, 2, 3, 4])
    expect(['llama-3.1-405b', 'llama-3.3-70b', 'llama-3.1-8b', 'llama-3.2-3b'].map(tier)).toEqual([1, 2, 3, 4])
    expect(['deepseek-r1', 'deepseek-v3'].map(tier)).toEqual([1, 2])
    expect(['qwen-max', 'qwen3-coder', 'qwen-turbo'].map(tier)).toEqual([1, 2, 3])
    expect(tier('local-llm')).toBeNull()
  })
})

describe('assembleRoster — 내 팀을 맨 앞에(2026-09-19)', () => {
  it('내 계정의 팀장·에이전트가 있는 작업 PC 가 먼저 오고 mine 이 표시된다', () => {
    const mineSeat = { ...seat('o2', 'me/zeta/w1', 'ACTIVE'), agentMine: true } as Seat
    const r = assembleRoster({ floors: [floor(
      [seat('o1', 'hong/alpha/w1', 'ACTIVE'), mineSeat],
      [watcher('hong/alpha/lead', 1), { ...watcher('me/zeta/lead', 1), mine: true }],
    )] })
    expect(r.hosts.map(h => [h.label, h.mine])).toEqual([['me / zeta', true], ['hong / alpha', false]])
  })
  it('팀장 없이 내 에이전트만 있어도 내 팀이다 — 감시 중인 남의 PC 보다 앞선다', () => {
    const r = assembleRoster({ floors: [floor(
      [{ ...seat('o1', 'pat-8f3a21bc', 'ACTIVE'), agentMine: true } as Seat],
      [watcher('hong/alpha/lead', 1)],
    )] })
    expect(r.hosts.map(h => h.label)).toEqual(['pat-8f3a21bc', 'hong / alpha'])
  })
})
