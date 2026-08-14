import { describe, expect, it } from 'vitest'
import { toSearchViewState } from '@/lib/domain/searchView'

const hit = {
  domain: 'minutes', entityType: 'minute', entityId: 'm1',
  title: '정례 회의', content: '계정 발급은 IT팀 경유로 한다',
  href: '/p/x/minutes/m1', occurredOn: '2026-07-14', score: 0.9, matchedBy: ['vector'],
}

describe('toSearchViewState', () => {
  it('200 이면 결과와 degraded 를 그대로 옮긴다', () => {
    const state = toSearchViewState({ ok: true, status: 200, body: { results: [hit], degraded: false } })
    expect(state).toMatchObject({ kind: 'done', degraded: false })
    if (state.kind !== 'done') throw new Error('done 이어야 한다')
    expect(state.hits[0].entityId).toBe('m1')
  })

  it('degraded 를 잃지 않는다 — 조용히 품질을 떨어뜨리면 안 된다', () => {
    const state = toSearchViewState({ ok: true, status: 200, body: { results: [hit], degraded: true } })
    expect(state).toMatchObject({ kind: 'done', degraded: true })
  })

  it('503 은 error 다 — 결과 없음으로 위장하지 않는다', () => {
    expect(toSearchViewState({ ok: false, status: 503, body: { error: 'VECTOR_SEARCH_FAILED' } }))
      .toEqual({ kind: 'error' })
  })

  it('403 도 error 다', () => {
    expect(toSearchViewState({ ok: false, status: 403, body: { error: 'PROJECT_FORBIDDEN' } }))
      .toEqual({ kind: 'error' })
  })

  it('200 인데 본문 형태가 깨졌으면 error 다 — 빈 결과로 넘기지 않는다', () => {
    expect(toSearchViewState({ ok: true, status: 200, body: null })).toEqual({ kind: 'error' })
    expect(toSearchViewState({ ok: true, status: 200, body: { results: 'nope' } })).toEqual({ kind: 'error' })
  })

  it('결과 0건은 정상 done 이다', () => {
    expect(toSearchViewState({ ok: true, status: 200, body: { results: [], degraded: false } }))
      .toEqual({ kind: 'done', hits: [], degraded: false })
  })
})
