import { describe, it, expect } from 'vitest'
import { splitLeafOwners, type ImportItem } from '@/lib/excel/validate'
import { buildWbsAoa } from '@/lib/excel/export'
import type { ComputedItem } from '@/lib/domain/types'

function imp(over: Partial<ImportItem>): ImportItem {
  return {
    tempId: 't0',
    parentTempId: null,
    level: 'activity',
    code: '1',
    sortOrder: 0,
    name: '항목',
    biz: null,
    deliverable: null,
    plannedStart: '2026-07-01',
    plannedEnd: '2026-07-10',
    weight: 0.05,
    actualPct: null,
    owners: [],
    ...over,
  }
}

describe('splitLeafOwners — 복수 담당 말단 분리', () => {
  it('복수 담당 말단 activity 아래에 팀당 1개 sub-act를 생성하고 원본 행은 그대로 둔다', () => {
    const src = [
      imp({ tempId: 't0', level: 'phase', name: '1. 준비', owners: [{ team: 'PMO', kind: 'primary' }] }),
      imp({ tempId: 't1', parentTempId: 't0', level: 'task', name: '1-1. 작업' }),
      imp({
        tempId: 't2', parentTempId: 't1', name: '데이터 플랫폼 요건 정의', biz: '가공', deliverable: '요건정의서',
        owners: [
          { team: '가공', kind: 'primary' },
          { team: 'ERP', kind: 'primary' },
          { team: 'MES', kind: 'support' },
        ],
      }),
    ]
    const out = splitLeafOwners(src)
    expect(out).toHaveLength(6)

    const parent = out.find(i => i.tempId === 't2')!
    // 원본 행 무손상: 이름·일정·가중치·담당 표기 유지
    expect(parent.name).toBe('데이터 플랫폼 요건 정의')
    expect(parent.plannedStart).toBe('2026-07-01')
    expect(parent.weight).toBe(0.05)
    expect(parent.owners).toHaveLength(3)

    const subs = out.filter(i => i.parentTempId === 't2')
    // 이름에 부모 작업명 포함 — 리프 이름만 소비하는 하류(검색·보고·알림)에서 식별 가능해야 함
    expect(subs.map(s => s.name)).toEqual([
      '데이터 플랫폼 요건 정의 (가공 주관)',
      '데이터 플랫폼 요건 정의 (ERP 주관)',
      '데이터 플랫폼 요건 정의 (MES 지원)',
    ])
    for (const s of subs) {
      expect(s.level).toBe('activity')
      expect(s.owners).toHaveLength(1)
      expect(s.plannedStart).toBe(parent.plannedStart) // 일정 승계
      expect(s.plannedEnd).toBe(parent.plannedEnd)
      expect(s.weight).toBeNull() // 형제 균등
      expect(s.biz).toBe('가공') // biz·산출물 승계
      expect(s.deliverable).toBe('요건정의서')
    }
    // sub-act 는 부모 바로 뒤, 문서 순서 재번호
    expect(out.map(i => i.sortOrder)).toEqual([0, 1, 2, 3, 4, 5])
    expect(out.map(i => i.tempId)).toEqual(['t0', 't1', 't2', 't2s0', 't2s1', 't2s2'])
  })

  it('단일 담당·무담당 말단, 자식 있는 복수 담당 상위, 말단 phase 는 분리하지 않는다', () => {
    const src = [
      imp({ tempId: 't0', level: 'phase', name: '1. 준비' }),
      // 자식(t2)이 있는 task 는 복수 담당이어도 그대로
      imp({
        tempId: 't1', parentTempId: 't0', level: 'task', name: '1-1. 작업',
        owners: [{ team: '가공', kind: 'primary' }, { team: 'ERP', kind: 'support' }],
      }),
      imp({ tempId: 't2', parentTempId: 't1', name: '단일 담당', owners: [{ team: '가공', kind: 'primary' }] }),
      imp({ tempId: 't3', parentTempId: 't1', name: '무담당', owners: [] }),
      // 말단 phase: 분리하면 phase 직속 activity 가 생겨 엑셀 3단 형식 라운드트립이 깨짐
      imp({
        tempId: 't4', level: 'phase', name: '2. 마일스톤',
        owners: [{ team: 'PMO', kind: 'primary' }, { team: '가공', kind: 'support' }],
      }),
    ]
    const out = splitLeafOwners(src)
    expect(out).toHaveLength(5)
    expect(out.map(i => i.tempId)).toEqual(['t0', 't1', 't2', 't3', 't4'])
  })

  it('자식 없는 복수 담당 task 도 담당별 activity 로 분리된다', () => {
    const src = [
      imp({ tempId: 't0', level: 'phase', name: '1. 준비' }),
      imp({
        tempId: 't1', parentTempId: 't0', level: 'task', name: '1-1. 중간보고', actualPct: 30,
        owners: [{ team: 'PMO', kind: 'primary' }, { team: '가공', kind: 'support' }],
      }),
    ]
    const out = splitLeafOwners(src)
    expect(out).toHaveLength(4)
    const subs = out.filter(i => i.parentTempId === 't1')
    expect(subs.map(s => s.name)).toEqual(['1-1. 중간보고 (PMO 주관)', '1-1. 중간보고 (가공 지원)'])
    // 실적 승계 → 롤업 결과가 원본 실적과 동일
    expect(subs.map(s => s.actualPct)).toEqual([30, 30])
  })
})

function comp(over: Partial<ComputedItem>): ComputedItem {
  return {
    id: 'x',
    parentId: null,
    level: 'activity',
    code: '1',
    sortOrder: 0,
    name: '항목',
    biz: null,
    deliverable: null,
    plannedStart: '2026-07-01',
    plannedEnd: '2026-07-10',
    weight: null,
    actualPct: null,
    owners: [],
    plannedPct: 50,
    rolledActualPct: 0,
    achievement: null,
    status: 'in_progress',
    children: [],
    ...over,
  }
}

describe('buildWbsAoa — sub-act 접기(라운드트립 보호)', () => {
  it('activity 하위 sub-act 는 행으로 내보내지 않고 부모 실적%에 롤업값을 싣는다', () => {
    const sub = (id: string, team: '가공' | 'ERP', pct: number) =>
      comp({ id, parentId: 'a1', name: `${team} 주관`, owners: [{ team, kind: 'primary' }], actualPct: pct, rolledActualPct: pct })
    const parent = comp({
      id: 'a1', name: '복수 담당 작업', rolledActualPct: 40,
      owners: [{ team: '가공', kind: 'primary' }, { team: 'ERP', kind: 'primary' }],
      children: [sub('s1', '가공', 50), sub('s2', 'ERP', 30)],
    })
    const task = comp({ id: 't1', level: 'task', name: '1-1. 작업', children: [parent], rolledActualPct: 40 })
    const aoa = buildWbsAoa([comp({ id: 'p1', level: 'phase', name: '1. 준비', children: [task], rolledActualPct: 40 })])

    const bodies = aoa.slice(3) as unknown[][]
    // phase + task + 접힌 activity = 3행 (sub-act 2행은 미출력)
    expect(bodies).toHaveLength(3)
    const actRow = bodies[2]
    expect(actRow[3]).toBe('복수 담당 작업')
    expect(actRow[6 + 1]).toBe('●') // 가공 담당 표기 보존(G6~J9 중 H7)
    expect(actRow[16]).toBe(40) // Q열 = 롤업 실적
  })

  it('task 하위 일반 activity 는 기존대로 모두 내보낸다', () => {
    const acts = [comp({ id: 'a1', name: 'A', actualPct: 10 }), comp({ id: 'a2', name: 'B', actualPct: 20 })]
    const task = comp({ id: 't1', level: 'task', name: '1-1. 작업', children: acts })
    const aoa = buildWbsAoa([comp({ id: 'p1', level: 'phase', name: '1. 준비', children: [task] })])
    expect(aoa.slice(3)).toHaveLength(4)
  })
})
