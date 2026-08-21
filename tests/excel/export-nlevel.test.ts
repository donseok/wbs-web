import { describe, it, expect } from 'vitest'
import { buildWbsAoa } from '@/lib/excel/export'
import { buildAoaWithProfile } from '@/lib/excel/exportWithProfile'
import { computeTree } from '@/lib/domain/rollup'
import type { WbsRow } from '@/lib/domain/types'
import type { ExcelProfile } from '@/lib/excel/profile'
import { DEFAULT_TEAM_CODES, teamOrderMap } from '@/lib/domain/teams'

// N단 프로젝트의 엑셀 export — 계층 열 수 = levelLabels.length.
// 3라벨 호출의 바이트 불변(D-CUBE 회귀 기준)은 tests/excel/export.test.ts 가 잠근다.

const OPTS = { subActTeamOrder: teamOrderMap(DEFAULT_TEAM_CODES) }
const row = (over: Partial<WbsRow>): WbsRow => ({
  id: 'x', parentId: null, code: 'x', sortOrder: 0, name: 'x',
  biz: null, deliverable: null, plannedStart: null, plannedEnd: null, weight: null, actualPct: null,
  owners: [], isOwnerSplit: false, ...over,
})

/** 6단 체인: Phase > System > Subsystem > WP > Activity > Task */
const SRC6: WbsRow[] = [
  row({ id: 'p', code: '1', name: '구축' }),
  row({ id: 's', parentId: 'p', code: '1.1', name: '조업' }),
  row({ id: 'b', parentId: 's', code: '1.1.1', name: '입측' }),
  row({ id: 'w', parentId: 'b', code: '1.1.1.1', name: '프로세스' }),
  row({ id: 'a', parentId: 'w', code: '1.1.1.1.1', name: '실적 관리' }),
  row({
    id: 't', parentId: 'a', code: '1.1.1.1.1.1', name: '입측 실적 수집',
    actualPct: 50, owners: [{ team: 'PMO', kind: 'primary' }],
  }),
]

const LABELS6 = ['Phase', 'System', 'Subsystem', 'WP', 'Activity', 'Task'] as const

describe('buildWbsAoa — N단 라벨이면 계층 열이 라벨 수만큼 늘어난다', () => {
  const items = computeTree(SRC6, '2026-09-15', new Set(), OPTS)
  const aoa = buildWbsAoa(items, 'MES', ['PMO', 'ERP'], LABELS6)

  it('header3: Biz + 계층 6열 + 스페이서 2 + 팀 열', () => {
    const h3 = aoa[2] as string[]
    expect(h3.slice(0, 7)).toEqual(['Biz', ...LABELS6])
    expect(h3.slice(7, 9)).toEqual(['', ''])
    expect(h3.slice(9, 11)).toEqual(['PMO', 'ERP'])
    expect(h3[11]).toBe('산출물')
    expect(h3[h3.length - 1]).toBe('상태')
  })

  it('header2 에도 계층 라벨이 같은 자리에 실린다', () => {
    const h2 = aoa[1] as string[]
    expect(h2.slice(1, 7)).toEqual([...LABELS6])
    expect(h2[9]).toBe('담당')
  })

  it('데이터행: depth d 의 이름이 열 1+d 에 실린다 — 접기 없음', () => {
    const data = aoa.slice(3)
    expect(data.map((r, i) => r[1 + i])).toEqual(['구축', '조업', '입측', '프로세스', '실적 관리', '입측 실적 수집'])
  })

  it('라벨 수를 넘는 깊이는 마지막 계층 열로 접힌다 (기존 3열 접기 규칙의 일반화)', () => {
    const deep: WbsRow[] = [
      ...SRC6,
      row({ id: 'x1', parentId: 't', code: 'x1', name: '초과 깊이' }),
    ]
    const items7 = computeTree(deep, '2026-09-15', new Set(), OPTS)
    const aoa7 = buildWbsAoa(items7, 'MES', ['PMO'], LABELS6)
    const last = aoa7[aoa7.length - 1]
    expect(last[6]).toBe('초과 깊이') // 열 1+min(6, 5)=6
  })

  it('팀 표기·산출물 열이 계층 확장만큼 뒤로 밀려도 값은 유지된다', () => {
    const taskRow = aoa[8] // header 3 + depth0..5 중 마지막
    expect(taskRow[9]).toBe('●') // PMO primary — 팀 첫 열(9)
  })
})

/** 4열 columns 프로파일 — 레거시(3열) 아님 → 라벨 주입 대상 */
const PROFILE4: ExcelProfile = {
  version: 1, sheetName: 'WBS', holidaySheetName: null, headerRow: 2,
  hierarchy: { kind: 'columns', columns: [1, 2, 3, 4] },
  logical: { extraAxis: 0, code: null, name: null, deliverable: 5, start: 6, end: 7, weight: 8, actualPct: 9 },
  teamColumns: [], ownerMarks: { '●': 'primary', '△': 'support' },
}

describe('buildAoaWithProfile — levelLabels 주입 시 Level{N} 대신 프로젝트 라벨', () => {
  const items = computeTree(SRC6.slice(0, 4), '2026-09-15', new Set(), OPTS) // 4단만

  it('주입하면 header3 계층 라벨이 프로젝트 라벨이 된다', () => {
    const r = buildAoaWithProfile(items, PROFILE4, { expandSubActs: false, levelLabels: ['Phase', 'System', 'Subsystem', 'WP'] })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const h3 = r.aoa[2] as string[]
    expect(h3.slice(1, 5)).toEqual(['Phase', 'System', 'Subsystem', 'WP'])
  })

  it('주입한 라벨보다 계층 열이 많으면 남는 열은 Level{N} 폴백', () => {
    const r = buildAoaWithProfile(items, PROFILE4, { expandSubActs: false, levelLabels: ['Phase', 'System'] })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const h3 = r.aoa[2] as string[]
    expect(h3.slice(1, 5)).toEqual(['Phase', 'System', 'Level3', 'Level4'])
  })

  it('주입하지 않으면 기존 동작 그대로 — Level1..N (바이트 불변)', () => {
    const r = buildAoaWithProfile(items, PROFILE4, { expandSubActs: false })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const h3 = r.aoa[2] as string[]
    expect(h3.slice(1, 5)).toEqual(['Level1', 'Level2', 'Level3', 'Level4'])
  })
})
