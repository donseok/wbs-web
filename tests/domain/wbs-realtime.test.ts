import { describe, it, expect } from 'vitest'
import { computeTree } from '@/lib/domain/rollup'
import { parseWbsPayload, applyWbsChange, wbsChannelTopic } from '@/lib/domain/wbsRealtime'
import type { BuildTreeOpts } from '@/lib/domain/tree'
import type { ComputedItem, WbsRow } from '@/lib/domain/types'
import { DEFAULT_TEAM_CODES, teamOrderMap } from '@/lib/domain/teams'

const OPTS: BuildTreeOpts = { subActTeamOrder: teamOrderMap(DEFAULT_TEAM_CODES) }
const TODAY = '2026-09-17'
const HOLIDAYS = new Set<string>()

const row = (over: Partial<WbsRow> & Pick<WbsRow, 'id'>): WbsRow => ({
  parentId: null, code: over.id, sortOrder: 1, name: over.id,
  biz: null, deliverable: null, plannedStart: null, plannedEnd: null,
  weight: null, actualPct: null, owners: [], isOwnerSplit: false,
  ...over,
})

/** 부모 P 아래 리프 a·b. 균등 가중이라 P 의 롤업은 두 리프의 단순 평균이다. */
function tree(aPct: number, bPct: number, aUpdatedAt = '2026-09-17T00:00:00.000Z'): ComputedItem[] {
  return computeTree([
    row({ id: 'P' }),
    row({ id: 'a', parentId: 'P', actualPct: aPct, stage: 'ip', updatedAt: aUpdatedAt }),
    row({ id: 'b', parentId: 'P', actualPct: bPct, stage: 'ip', updatedAt: '2026-09-17T00:00:00.000Z' }),
  ], TODAY, HOLIDAYS, OPTS)
}

const findNode = (ns: ComputedItem[], id: string): ComputedItem => {
  for (const n of ns) {
    if (n.id === id) return n
    const hit = findNode(n.children, id)
    if (hit) return hit
  }
  return undefined as unknown as ComputedItem
}

describe('wbsChannelTopic', () => {
  it('프로젝트 채널 토픽은 project-<id>-wbs 형식이다', () => {
    expect(wbsChannelTopic('3d5ff7b0-0e57-4805-8788-1ea97394a739'))
      .toBe('project-3d5ff7b0-0e57-4805-8788-1ea97394a739-wbs')
  })
})

describe('parseWbsPayload', () => {
  it('DB 의 snake_case 페이로드를 도메인 형태로 읽는다', () => {
    expect(parseWbsPayload({
      id: 'a', project_id: 'p1', stage: 'im', actual_pct: 80, updated_at: '2026-09-17T01:00:00.000Z',
    })).toEqual({
      id: 'a', projectId: 'p1', stage: 'im', actualPct: 80, updatedAt: '2026-09-17T01:00:00.000Z',
    })
  })

  it('stage 해제(null)와 실적 없음(null)은 정상 값이다', () => {
    const p = parseWbsPayload({
      id: 'a', project_id: 'p1', stage: null, actual_pct: null, updated_at: '2026-09-17T01:00:00.000Z',
    })
    expect(p).not.toBeNull()
    expect(p!.stage).toBeNull()
    expect(p!.actualPct).toBeNull()
  })

  it('numeric 이 문자열로 실려 와도 수로 읽는다', () => {
    // 이 스택의 numeric 은 경로에 따라 '40.00' 처럼 문자열로 올라오는 것을 실측했다(스테이징 조회).
    expect(parseWbsPayload({
      id: 'a', project_id: 'p1', stage: 'ip', actual_pct: '40.00', updated_at: '2026-09-17T01:00:00.000Z',
    })!.actualPct).toBe(40)
  })

  it('id 나 updated_at 이 없으면 버린다', () => {
    expect(parseWbsPayload({ project_id: 'p1', updated_at: '2026-09-17T01:00:00.000Z' })).toBeNull()
    expect(parseWbsPayload({ id: 'a', project_id: 'p1' })).toBeNull()
    expect(parseWbsPayload(null)).toBeNull()
    expect(parseWbsPayload('a')).toBeNull()
  })
})

describe('applyWbsChange — 순서 판정', () => {
  it('보유 행보다 오래된 페이로드는 버린다', () => {
    const before = tree(40, 0, '2026-09-17T02:00:00.000Z')
    const stale = parseWbsPayload({
      id: 'a', project_id: 'p1', stage: 'as', actual_pct: 0,
      updated_at: '2026-09-17T01:00:00.000Z', // 보유 행(02:00)보다 과거
    })!
    expect(applyWbsChange(before, stale, { today: TODAY, holidays: HOLIDAYS })).toBeNull()
  })

  it('같은 updated_at 도 버린다 — 이미 반영된 값이다', () => {
    const before = tree(40, 0, '2026-09-17T02:00:00.000Z')
    const same = parseWbsPayload({
      id: 'a', project_id: 'p1', stage: 'xx', actual_pct: 100,
      updated_at: '2026-09-17T02:00:00.000Z',
    })!
    expect(applyWbsChange(before, same, { today: TODAY, holidays: HOLIDAYS })).toBeNull()
  })

  it('보유 행에 updatedAt 이 없으면 최신으로 보고 반영한다 — fail-open 이 아니라 SSR 직후의 정상 경로다', () => {
    const before = computeTree([
      row({ id: 'P' }),
      row({ id: 'a', parentId: 'P', actualPct: 0, stage: 'as' }), // updatedAt 없음
    ], TODAY, HOLIDAYS, OPTS)
    const next = applyWbsChange(before, parseWbsPayload({
      id: 'a', project_id: 'p1', stage: 'xx', actual_pct: 100, updated_at: '2026-09-17T03:00:00.000Z',
    })!, { today: TODAY, holidays: HOLIDAYS })
    expect(next).not.toBeNull()
    expect(findNode(next!, 'a').actualPct).toBe(100)
  })

  it('트리에 없는 항목이면 null 을 돌려준다', () => {
    const before = tree(40, 0)
    const other = parseWbsPayload({
      id: 'zzz', project_id: 'p1', stage: 'xx', actual_pct: 100, updated_at: '2026-09-17T09:00:00.000Z',
    })!
    expect(applyWbsChange(before, other, { today: TODAY, holidays: HOLIDAYS })).toBeNull()
  })
})

describe('applyWbsChange — 부분 패치와 롤업', () => {
  it('리프를 패치하면 조상의 롤업 실적이 함께 갱신된다', () => {
    const before = tree(0, 0)
    expect(findNode(before, 'P').rolledActualPct).toBe(0)

    const next = applyWbsChange(before, parseWbsPayload({
      id: 'a', project_id: 'p1', stage: 'xx', actual_pct: 100, updated_at: '2026-09-17T09:00:00.000Z',
    })!, { today: TODAY, holidays: HOLIDAYS })

    expect(next).not.toBeNull()
    expect(findNode(next!, 'a').actualPct).toBe(100)
    expect(findNode(next!, 'a').stage).toBe('xx')
    // 리프 둘(100, 0)의 균등 평균 — 조상이 낡은 채로 남으면 여기서 0 이 나온다.
    expect(findNode(next!, 'P').rolledActualPct).toBe(50)
  })

  it('패치된 행의 updatedAt 이 페이로드 값으로 올라간다 — 다음 순서 판정의 기준이 된다', () => {
    const next = applyWbsChange(tree(0, 0), parseWbsPayload({
      id: 'a', project_id: 'p1', stage: 'xx', actual_pct: 100, updated_at: '2026-09-17T09:00:00.000Z',
    })!, { today: TODAY, holidays: HOLIDAYS })!
    expect(findNode(next, 'a').updatedAt).toBe('2026-09-17T09:00:00.000Z')
  })

  it('원본 트리를 제자리에서 고치지 않는다', () => {
    const before = tree(0, 0)
    applyWbsChange(before, parseWbsPayload({
      id: 'a', project_id: 'p1', stage: 'xx', actual_pct: 100, updated_at: '2026-09-17T09:00:00.000Z',
    })!, { today: TODAY, holidays: HOLIDAYS })
    expect(findNode(before, 'a').actualPct).toBe(0)
    expect(findNode(before, 'P').rolledActualPct).toBe(0)
  })

  it('단계 해제(null)도 반영한다', () => {
    const next = applyWbsChange(tree(40, 0), parseWbsPayload({
      id: 'a', project_id: 'p1', stage: null, actual_pct: 40, updated_at: '2026-09-17T09:00:00.000Z',
    })!, { today: TODAY, holidays: HOLIDAYS })!
    expect(findNode(next, 'a').stage).toBeNull()
  })
})
