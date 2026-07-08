import { describe, it, expect } from 'vitest'
import { buildActionRows, compareActionRows, type ActionRow } from '@/lib/domain/attention'
import { computeTree } from '@/lib/domain/rollup'
import type { WbsRow } from '@/lib/domain/types'

const H = new Set<string>()
const TODAY = '2026-07-09'
const r = (o: Partial<WbsRow> & { id: string }): WbsRow => ({
  parentId: null, level: 'activity', code: o.id, sortOrder: 0, name: o.id,
  biz: null, deliverable: null, plannedStart: null, plannedEnd: null,
  weight: null, actualPct: null, owners: [], ...o,
})

const rows: WbsRow[] = [
  r({ id: 'P', level: 'phase', plannedStart: '2026-07-01', plannedEnd: '2026-08-31' }),
  // 초과 2일, 격차 100
  r({ id: 'over2', parentId: 'P', plannedStart: '2026-07-01', plannedEnd: '2026-07-07', sortOrder: 0 }),
  // 초과 6일, 격차 100  → 더 위
  r({ id: 'over6', parentId: 'P', plannedStart: '2026-07-01', plannedEnd: '2026-07-03', sortOrder: 1 }),
  // 초과 0, 격차 67 (지연이지만 마감 전) — dueSoon과도 겹친다
  r({ id: 'gap67', parentId: 'P', plannedStart: '2026-07-06', plannedEnd: '2026-07-13', sortOrder: 2 }),
  // 순수 dueSoon: 07-06..07-10 업무일 5, 07-09까지 4일 → planned 80. actual 80 → in_progress.
  r({ id: 'due', parentId: 'P', plannedStart: '2026-07-06', plannedEnd: '2026-07-10', actualPct: 80, sortOrder: 3 }),
  // 무관
  r({ id: 'far', parentId: 'P', plannedStart: '2026-08-20', plannedEnd: '2026-08-31', sortOrder: 4 }),
]
const tree = computeTree(rows, TODAY, H)

describe('buildActionRows', () => {
  const out = buildActionRows(tree, TODAY)

  it('지연 ∪ 마감임박 고유 집합만 담는다', () => {
    expect(out.map(x => x.item.id).sort()).toEqual(['due', 'gap67', 'over2', 'over6'])
  })

  it('정렬 결과의 id 전체 시퀀스 — 초과일 → 격차 → 가중치 → sortOrder', () => {
    expect(out.map(x => x.item.id)).toEqual(['over6', 'over2', 'gap67', 'due'])
  })

  it('delayed가 dueSoon보다 항상 앞이다 (gap67은 양쪽이지만 delayed로 태깅)', () => {
    expect(out.find(x => x.item.id === 'gap67')!.kind).toBe('delayed')
    expect(out.find(x => x.item.id === 'due')!.kind).toBe('dueSoon')
  })

  it('overdueDays / dday / gapPp', () => {
    const o6 = out.find(x => x.item.id === 'over6')!
    expect(o6.overdueDays).toBe(6)      // 07-03 → 07-09
    expect(o6.dday).toBe(-6)
    expect(o6.gapPp).toBe(100)

    const d = out.find(x => x.item.id === 'due')!
    expect(d.overdueDays).toBe(0)
    expect(d.dday).toBe(1)              // 07-10
    expect(d.gapPp).toBe(0)             // 계획 미달 아님 → clamp 0
  })

  it('weightShare 각 값은 0..1', () => {
    out.forEach(x => { expect(x.weightShare).toBeGreaterThan(0); expect(x.weightShare).toBeLessThanOrEqual(1) })
  })

  it('빈 입력 → []', () => {
    expect(buildActionRows([], TODAY)).toEqual([])
  })
})

describe('compareActionRows — 전순서', () => {
  const rowsOut = buildActionRows(tree, TODAY)

  // sign 합이 0 ⇔ sign(a,b) === -sign(b,a) (값이 -1|0|1이므로 동치).
  // 뺄셈/부호반전으로 쓰지 말 것: a===b일 때 Math.sign은 +0, -Math.sign은 -0을 주고
  // toBe는 Object.is라 +0과 -0을 다르게 본다. 덧셈은 0 + -0 === +0 이라 안전하다.
  it('반대칭: compare(a,b) === -compare(b,a)', () => {
    for (const a of rowsOut) for (const b of rowsOut) {
      const sum = Math.sign(compareActionRows(a, b)) + Math.sign(compareActionRows(b, a))
      expect(sum, `${a.item.id} vs ${b.item.id}`).toBe(0)
    }
  })

  it('반사성: compare(a,a) === 0', () => {
    rowsOut.forEach(a => expect(compareActionRows(a, a)).toBe(0))
  })

  it('추이성: 뒤섞어 다시 정렬해도 같다', () => {
    const shuffled = [...rowsOut].reverse().sort(compareActionRows)
    expect(shuffled.map(x => x.item.id)).toEqual(rowsOut.map(x => x.item.id))
  })
})

describe('날짜 없는 리프', () => {
  const nullRows: WbsRow[] = [
    r({ id: 'P', level: 'phase', plannedStart: '2026-07-01', plannedEnd: '2026-08-31' }),
    // 날짜 없음 → plannedPct 0 → 'actual < planned'가 성립할 수 없다 → 결코 delayed가 아니다.
    // plannedEnd null → dueSoon도 아니다. 즉 조치 목록에 원리적으로 들어올 수 없다.
    r({ id: 'nodate', parentId: 'P', plannedStart: null, plannedEnd: null, actualPct: 50 }),
    r({ id: 'x', parentId: 'P', plannedStart: '2026-07-01', plannedEnd: '2026-07-07', sortOrder: 1 }),
  ]
  const out = buildActionRows(computeTree(nullRows, TODAY, H), TODAY)

  it('조치 목록에 들어오지 않는다', () => {
    expect(out.map(x => x.item.id)).toEqual(['x'])
  })

  it('남은 행에 NaN이 없다', () => {
    out.forEach((x: ActionRow) => {
      expect(Number.isNaN(x.overdueDays)).toBe(false)
      expect(Number.isNaN(x.gapPp)).toBe(false)
      expect(x.dday === null || Number.isFinite(x.dday)).toBe(true)
    })
  })
})
