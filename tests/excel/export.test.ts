import { describe, it, expect } from 'vitest'
import { buildWbsWorkbook } from '@/lib/excel/export'
import { parseWbsWorkbook } from '@/lib/excel/parse'
import { validateAndLink } from '@/lib/excel/validate'
import { computeTree } from '@/lib/domain/rollup'
import type { WbsRow } from '@/lib/domain/types'
import { DEFAULT_TEAM_CODES, teamOrderMap } from '@/lib/domain/teams'

// 4단+ 깊이 회귀 케이스는 여기 없음 — buildWbsAoa의 flatten()이 'activity' 레벨에서 의도적으로 접기를
// 멈추는 3열 고정 양식이라(Plan B 전, export.ts:19 주석 참조) 실 4단 입력을 라운드트립시키는 케이스를
// 만들면 알려진 손실을 재확인할 뿐이다. computeTree 자체의 4단 롤업 정확성은
// tests/domain/edgecases.test.ts 'computeTree 4단+ 롤업' 참조.

const OPTS = { subActTeamOrder: teamOrderMap(DEFAULT_TEAM_CODES) }
const row = (over: Partial<WbsRow>): WbsRow => ({
  id: 'x', parentId: null, level: 'activity', code: 'x', sortOrder: 0, name: 'x',
  biz: null, deliverable: null, plannedStart: null, plannedEnd: null, weight: null, actualPct: null,
  owners: [], isOwnerSplit: false, ...over,
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
  const items = computeTree(SRC, '2026-09-15', new Set(), OPTS)
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

/* ── flatten: isOwnerSplit 기준 재귀 중단(§6.5) ── */
describe('flatten isOwnerSplit 기준 재귀', () => {
  it('sub-act(isOwnerSplit=true)는 접혀 행 출력 안 됨 — 회귀', () => {
    // 3단 D-CUBE 트리: Phase > Task > Activity > sub-activity(isOwnerSplit=true, 자식 없음)
    // 기존 동작: activity 레벨에서 재귀 중단 → 4단째(sub-act) 노드 미출력
    // 신규 동작: isOwnerSplit=true 노드에서 재귀 중단 → 동일 결과
    const srcRows: WbsRow[] = [
      row({ id: 'P', parentId: null, level: 'phase', code: '1', name: 'Phase' }),
      row({ id: 'T', parentId: 'P', level: 'task', code: '1-1', name: 'Task' }),
      row({ id: 'A', parentId: 'T', level: 'activity', code: 'a', name: 'Activity', isOwnerSplit: false }),
      row({ id: 'SA', parentId: 'A', level: 'activity', code: 'a-1', name: 'sub-act', isOwnerSplit: true }),
    ]
    const items = computeTree(srcRows, '2026-09-15', new Set(), OPTS)
    const aoa = buildWbsAoa(items)
    // header 3줄 + data rows
    const dataRows = aoa.slice(3)
    expect(dataRows.length).toBe(3) // Phase, Task, Activity만 (sub-act는 접힘)
    expect(dataRows.map(r => r[1] || r[2] || r[3])).toEqual(['Phase', 'Task', 'Activity'])
  })

  it('4단 일반 트리(isOwnerSplit 전부 false)는 4단까지 전개', () => {
    // 4단 일반 트리(isOwnerSplit=false): Phase > Task > Activity > Sub > SubSub
    // 신규 동작: isOwnerSplit=false 노드는 모두 재귀 → 4단까지 행 출력
    const srcRows: WbsRow[] = [
      row({ id: 'P', parentId: null, level: 'phase', code: '1', name: 'Phase', isOwnerSplit: false }),
      row({ id: 'T', parentId: 'P', level: 'task', code: '1-1', name: 'Task', isOwnerSplit: false }),
      row({ id: 'A', parentId: 'T', level: 'activity', code: 'a', name: 'Activity', isOwnerSplit: false }),
      row({ id: 'S', parentId: 'A', level: 'sub', code: 'a-1', name: 'SubActivity', isOwnerSplit: false }),
      row({ id: 'SS', parentId: 'S', level: 'subsub', code: 'a-1-1', name: 'SubSubActivity', isOwnerSplit: false }),
    ]
    const items = computeTree(srcRows, '2026-09-15', new Set(), OPTS)
    const aoa = buildWbsAoa(items)
    const dataRows = aoa.slice(3)
    expect(dataRows.length).toBe(5) // 모든 5개 행 출력
    expect(dataRows.map(r => r[1] || r[2] || r[3])).toEqual(['Phase', 'Task', 'Activity', 'SubActivity', 'SubSubActivity'])
  })
})

/* ── 동적 팀 열(팀 마스터 대응) ── */
import { buildWbsColumnMap } from '@/lib/excel/parse'
import { buildWbsAoa } from '@/lib/excel/export'

describe('buildWbsAoa: 계층 열은 depth로 배치, levelLabels로 헤더 커스터마이즈', () => {
  const items = computeTree(SRC, '2026-09-15', new Set(), OPTS)

  it('무인자 호출은 기존과 바이트 동일 — 헤더는 기본 Phase/Task/Activity, 데이터행은 row[1+depth]', () => {
    const aoa = buildWbsAoa(items, 'P', ['PMO', 'ERP', 'MES', '가공', 'MDM'])
    // aoa[0]=header1, aoa[1]=header2, aoa[2]=header3, aoa[3..]=데이터행
    expect(aoa[1][1]).toBe('Phase')
    expect(aoa[2][2]).toBe('Task')
    expect(aoa[2][3]).toBe('Activity')
    // 데이터행: phase명은 열1(row[3]), task명은 열2(row[4]), activity명은 열3(row[5])
    expect(aoa[3][1]).toBe('1. 준비')
    expect(aoa[4][2]).toBe('1-1. 거버넌스')
    expect(aoa[5][3]).toBe('TFT R&R 확정')
  })

  it('커스텀 levelLabels가 header2·header3 열1에 반영된다', () => {
    const aoa = buildWbsAoa(items, 'P', ['PMO'], ['단계', '기능', '작업'])
    expect(aoa[1][1]).toBe('단계') // header2
    expect(aoa[2][1]).toBe('단계') // header3
    expect(aoa[2][2]).toBe('기능')
    expect(aoa[2][3]).toBe('작업')
  })
})

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
