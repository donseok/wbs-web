import { describe, it, expect } from 'vitest'
import * as XLSX from 'xlsx'
import { parseWbsWorkbook } from '@/lib/excel/parse'

const HEADER = [
  ['Biz.', 'Phase', 'Task', 'Activity', '', '', '담당', '', '', '', 'Status', '산출물', '계획'],
  ['', '', '', '', '', '', 'PMO', 'ERP', 'MES', '가공', '', '', 'Start', 'End'],
  ['타이틀', '', '', '', '', '', 'PMO', 'ERP', 'MES', '가공', '', '', 'Start', 'End'],
]

/** Phase 1 / Task 1-1 / Activity a1,a2 — leaf 2개에 가중치 부여 */
function book(phaseW: number | '', taskW: number | '', a1: number | '', a2: number | ''): ArrayBuffer {
  const blank = ['', '', '', '', '', '', '', '', '', '', '', '']
  const wbs = XLSX.utils.aoa_to_sheet([
    ...HEADER,
    ['PI', '1. 준비', '', '', '', '', '', '', '', '', '', '', '', '', phaseW],
    ['', '', '1-1. 거버넌스', '', '', '', '', '', '', '', '', '', '', '', taskW],
    [...blank.slice(0, 3), 'A1', ...blank.slice(4), '', '', a1, '', 50],
    [...blank.slice(0, 3), 'A2', ...blank.slice(4), '', '', a2, '', 0],
  ])
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, wbs, 'WBS')
  return XLSX.write(wb, { type: 'array', bookType: 'xlsx' })
}

const weights = (buf: ArrayBuffer) => parseWbsWorkbook(buf).rows.map(r => r.weight)

describe('엑셀 O열 가중치 스케일 자동 정규화', () => {
  it('고객사 원본(0~1, leaf 합≈1)은 ×100 되어 들어온다', () => {
    // leaf 합 = 0.6 + 0.4 = 1.0 → 0~1 스케일로 판정
    expect(weights(book(1, 1, 0.6, 0.4))).toEqual([100, 100, 60, 40])
  })

  it('우리 export(0~100, leaf 합≈100)는 건드리지 않는다', () => {
    expect(weights(book(100, 100, 60, 40))).toEqual([100, 100, 60, 40])
  })

  it('라운드트립 — 0~1 파일을 읽어 100 스케일로 다시 쓰면 재임포트 시 값이 보존된다', () => {
    const once = weights(book(1, 1, 0.6, 0.4))
    const twice = weights(book(100, 100, 60, 40)) // once 를 그대로 export 한 파일
    expect(twice).toEqual(once) // 이중 스케일링 없음
  })

  it('무한소수 라운드트립 — 1/22 계열이 4.5455… 로 확대된다', () => {
    const [, , a1] = weights(book('', '', 1 / 22, 21 / 22))
    expect(a1).toBeCloseTo(4.5455, 3)
  })

  it('leaf 합이 임계값(1.5) 근처여도 잔차를 흡수한다', () => {
    // 반올림 잔차로 1.02 인 0~1 파일 → 여전히 ×100
    const [, , a1, a2] = weights(book('', '', 0.62, 0.4))
    expect(a1).toBeCloseTo(62, 6)
    expect(a2).toBeCloseTo(40, 6)
  })

  it('가중치가 전혀 없으면 아무 일도 없다 (전부 null)', () => {
    expect(weights(book('', '', '', ''))).toEqual([null, null, null, null])
  })

  it('상위 행 가중치는 leaf 합 판정에 끼지 않는다 (중복 계산 방지)', () => {
    // phase 100 + task 100 을 더하면 200 이 되어 100 스케일로 오판할 수 있음.
    // leaf 만 보면 0.6+0.4=1.0 → 올바르게 ×100.
    expect(weights(book(1, 1, 0.6, 0.4))).toEqual([100, 100, 60, 40])
  })
})
