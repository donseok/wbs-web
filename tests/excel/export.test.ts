import { describe, it, expect } from 'vitest'
import { buildWbsWorkbook } from '@/lib/excel/export'
import { parseWbsWorkbook } from '@/lib/excel/parse'
import { validateAndLink } from '@/lib/excel/validate'
import { computeTree } from '@/lib/domain/rollup'
import type { WbsRow } from '@/lib/domain/types'

const row = (over: Partial<WbsRow>): WbsRow => ({
  id: 'x', parentId: null, level: 'activity', code: 'x', sortOrder: 0, name: 'x',
  biz: null, deliverable: null, plannedStart: null, plannedEnd: null, weight: null, actualPct: null,
  owners: [], ...over,
})

const SRC: WbsRow[] = [
  row({ id: 'P', parentId: null, level: 'phase', code: '1', sortOrder: 0, name: '1. 준비', biz: 'PI' }),
  row({ id: 'T', parentId: 'P', level: 'task', code: '1-1', sortOrder: 1, name: '1-1. 거버넌스' }),
  row({
    id: 'A1', parentId: 'T', level: 'activity', code: 'a1', sortOrder: 2, name: 'TFT R&R 확정',
    deliverable: '업무분장표', plannedStart: '2026-07-01', plannedEnd: '2026-07-07',
    weight: 2, actualPct: 50, owners: [{ team: 'PMO', kind: 'primary' }, { team: '가공', kind: 'support' }],
  }),
  row({
    id: 'A2', parentId: 'T', level: 'activity', code: 'a2', sortOrder: 3, name: '현황 파악',
    plannedStart: '2026-07-08', plannedEnd: '2026-07-14', actualPct: 100,
    owners: [{ team: 'ERP', kind: 'primary' }],
  }),
]

describe('buildWbsWorkbook round-trip', () => {
  const items = computeTree(SRC, '2026-09-15', new Set())
  const buf = buildWbsWorkbook(items, [{ date: '2026-07-17', name: '제헌절' }], '테스트 프로젝트')
  const parsed = parseWbsWorkbook(buf)

  it('레벨 구조가 보존된다', () => {
    expect(parsed.rows.map(r => r.level)).toEqual(['phase', 'task', 'activity', 'activity'])
  })

  it('담당(●/△)이 보존된다', () => {
    const a1 = parsed.rows.find(r => r.name === 'TFT R&R 확정')!
    expect(a1.owners).toEqual([{ team: 'PMO', kind: 'primary' }, { team: '가공', kind: 'support' }])
  })

  it('산출물·가중치·실적%가 보존된다', () => {
    const a1 = parsed.rows.find(r => r.name === 'TFT R&R 확정')!
    expect(a1.deliverable).toBe('업무분장표')
    expect(a1.weight).toBe(2)
    expect(a1.actualPct).toBe(50)
  })

  it('계획 일자가 동일 날짜로 라운드트립된다 (TZ 드리프트 없음)', () => {
    const a1 = parsed.rows.find(r => r.name === 'TFT R&R 확정')!
    expect(a1.plannedStart).toBe('2026-07-01')
    expect(a1.plannedEnd).toBe('2026-07-07')
  })

  it('상위(롤업) 행의 실적%는 비워져 임포트 시 무시된다', () => {
    const phase = parsed.rows.find(r => r.level === 'phase')!
    expect(phase.actualPct).toBeNull()
  })

  it('공휴일 시트가 보존된다', () => {
    expect(parsed.holidays).toContainEqual({ date: '2026-07-17', name: '제헌절' })
  })

  it('재임포트가 검증을 통과한다', () => {
    const res = validateAndLink(parsed)
    expect(res.ok).toBe(true)
  })
})

/* ── 동적 팀 열(팀 마스터 대응) ── */
import { buildWbsColumnMap } from '@/lib/excel/parse'
import { buildWbsAoa } from '@/lib/excel/export'

describe('buildWbsAoa 동적 팀 열', () => {
  it('teamCodes 주입 시 header3에 팀 열이 생성되고 후속 열이 밀린다', () => {
    const aoa = buildWbsAoa([], 'WBS', ['PMO', 'ERP', 'MES', '가공', 'MDM', '신팀'])
    const h3 = aoa[2] as string[]
    expect(h3.slice(6, 12)).toEqual(['PMO', 'ERP', 'MES', '가공', 'MDM', '신팀'])
    expect(h3[12]).toBe('산출물')
    expect(h3[h3.length - 1]).toBe('상태')
  })

  it('동적 헤더는 buildWbsColumnMap과 라운드트립된다', () => {
    const aoa = buildWbsAoa([], 'WBS', ['PMO', '신팀'])
    const m = buildWbsColumnMap(aoa[2] as unknown[])
    expect(m.teams).toEqual([[6, 'PMO'], [7, '신팀']])
    expect(m.deliverable).toBe(8)
    expect(m.actualPct).toBe(13)
  })

  it('기본(5팀) 헤더는 기존 양식과 동일(하위 호환)', () => {
    const aoa = buildWbsAoa([])
    expect(aoa[2]).toEqual(['Biz', 'Phase', 'Task', 'Activity', '', '', 'PMO', 'ERP', 'MES', '가공', 'MDM',
      '산출물', '시작', '종료', '가중치', '', '실적%', '계획%', '계획대비%', '상태'])
  })
})
