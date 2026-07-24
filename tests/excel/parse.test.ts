import { describe, it, expect } from 'vitest'
import * as XLSX from 'xlsx'
import { parseWbsWorkbook } from '@/lib/excel/parse'

function makeBook(): ArrayBuffer {
  const wbs = XLSX.utils.aoa_to_sheet([
    ['Biz.', 'Phase', 'Task', 'Activity', '', '', '담당', '', '', '', 'Status', '산출물', '계획'],
    ['', '', '', '', '', '', 'PMO', 'ERP', 'MES', '가공', '', '', 'Start', 'End'],
    ['타이틀', '', '', '', '', '', 'PMO', 'ERP', 'MES', '가공', '', '', 'Start', 'End'],
    ['PI', '1. 준비', '', '', '', '', '', '', '', '', '', '', new Date(2026,6,1), new Date(2026,6,9)],
    ['', '', '1-1. 거버넌스', '', '', '', '', '', '', '', '', '', new Date(2026,6,1), new Date(2026,6,7)],
    ['', '', '', 'TFT R&R 확정', '', '', '●', '', '', '', '', '업무분장표', new Date(2026,6,1), new Date(2026,6,7), 2, '', 50],
    ['', '', '', '현황 파악', '', '', '', '△', '△', '●', '', '', new Date(2026,6,13), new Date(2026,6,24)],
  ])
  const hol = XLSX.utils.aoa_to_sheet([
    ['Holiday'], [new Date(2026,6,17), '제헌절'],
  ])
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, wbs, 'WBS')
  XLSX.utils.book_append_sheet(wb, hol, 'Holiday')
  return XLSX.write(wb, { type: 'array', bookType: 'xlsx' })
}

describe('parseWbsWorkbook', () => {
  const parsed = parseWbsWorkbook(makeBook())

  it('Phase/Task/Activity level 판정', () => {
    const levels = parsed.rows.map(r => r.level)
    expect(levels).toEqual(['phase', 'task', 'activity', 'activity'])
  })
  it('담당 ●=primary, △=support 추출', () => {
    const tft = parsed.rows.find(r => r.name === 'TFT R&R 확정')!
    expect(tft.owners).toEqual([{ team: 'PMO', kind: 'primary' }])
    const sang = parsed.rows.find(r => r.name === '현황 파악')!
    expect(sang.owners).toEqual([
      { team: 'ERP', kind: 'support' },
      { team: 'MES', kind: 'support' },
      { team: '가공', kind: 'primary' },
    ])
  })
  it('계획 일자 ISO 변환', () => {
    const tft = parsed.rows.find(r => r.name === 'TFT R&R 확정')!
    expect(tft.plannedStart).toBe('2026-07-01')
    expect(tft.plannedEnd).toBe('2026-07-07')
  })
  it('산출물 추출', () => {
    const tft = parsed.rows.find(r => r.name === 'TFT R&R 확정')!
    expect(tft.deliverable).toBe('업무분장표')
  })
  it('가중치(O열)·실적%(Q열) 숫자 파싱', () => {
    const tft = parsed.rows.find(r => r.name === 'TFT R&R 확정')!
    expect(tft.weight).toBe(2)
    expect(tft.actualPct).toBe(50)
    // 값이 비어있는 행은 null
    const sang = parsed.rows.find(r => r.name === '현황 파악')!
    expect(sang.weight).toBeNull()
    expect(sang.actualPct).toBeNull()
  })
  it('Biz(A열) 추출', () => {
    expect(parsed.rows[0].biz).toBe('PI')
  })
  it('공휴일 시트 파싱', () => {
    expect(parsed.holidays).toContainEqual({ date: '2026-07-17', name: '제헌절' })
  })

  // 실제 xlsx 파일은 날짜를 '시리얼(정수)'로 저장한다(JS Date 아님).
  // cellDates 로컬 변환(Asia/Seoul 1899 LMT)에 의존하면 -1일 밀린다 → 시리얼을 타임존 무관하게 해석해야 한다.
  it('날짜 시리얼(정수) 셀을 타임존 무관하게 ISO 변환한다(-1일 밀림 금지)', () => {
    const num = (serial: number) => ({ t: 'n', v: serial, z: 'yyyy-mm-dd' })
    // 구조는 aoa 로 만들고, 계획 일자 칸(M/N)만 시리얼 정수 셀로 덮어쓴다.
    const ws = XLSX.utils.aoa_to_sheet([
      ['Biz.', 'Phase', 'Task', 'Activity', '', '', 'PMO', 'ERP', 'MES', '가공', 'Status', '산출물', '계획'],
      ['', '', '', '', '', '', '', '', '', '', '', '', 'Start', 'End'],
      ['타이틀', '', '', '', '', '', '', '', '', '', '', '', 'Start', 'End'],
      ['', '', '', '기준일 활동', '', '', '●', '', '', '', '', '', 0, 0],  // 데이터 행(0-base idx 3)
    ])
    ws['M4'] = num(46204)  // 2026-07-01 (idx3 → 스프레드시트 4행)
    ws['N4'] = num(46213)  // 2026-07-10
    const hol = XLSX.utils.aoa_to_sheet([['Holiday'], [0, '제헌절']])
    hol['A2'] = num(46220) // 2026-07-17
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'WBS')
    XLSX.utils.book_append_sheet(wb, hol, 'Holiday')
    const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' })
    const p = parseWbsWorkbook(buf as ArrayBuffer)
    const row = p.rows.find(r => r.name === '기준일 활동')!
    expect(row.plannedStart).toBe('2026-07-01')
    expect(row.plannedEnd).toBe('2026-07-10')
    expect(p.holidays).toContainEqual({ date: '2026-07-17', name: '제헌절' })
  })
})

/* ── 헤더 이름 기반 열 맵(팀 마스터 대응) ── */
import { buildWbsColumnMap } from '@/lib/excel/parse'

const H3 = ['Biz', 'Phase', 'Task', 'Activity', '', '', 'PMO', 'ERP', 'MES', '가공', 'MDM',
  '산출물', '시작', '종료', '가중치', '', '실적%', '계획%', '계획대비%', '상태']

describe('buildWbsColumnMap', () => {
  it('현행 5팀 헤더는 기존 고정 인덱스와 동일한 맵', () => {
    expect(buildWbsColumnMap(H3)).toEqual({
      teams: [[6, 'PMO'], [7, 'ERP'], [8, 'MES'], [9, '가공'], [10, 'MDM']],
      deliverable: 11, start: 12, end: 13, weight: 14, actualPct: 16,
    })
  })

  it('팀 열이 추가되면 팀·후속 열이 함께 밀린다', () => {
    const h6 = [...H3.slice(0, 11), '신팀', ...H3.slice(11)]
    const m = buildWbsColumnMap(h6)
    expect(m.teams).toContainEqual([11, '신팀'])
    expect(m.deliverable).toBe(12)
    expect(m.start).toBe(13)
    expect(m.actualPct).toBe(17)
  })

  it("'산출물' 헤더가 없으면 현행 고정 인덱스 폴백", () => {
    expect(buildWbsColumnMap(['A', 'B']).teams).toEqual(
      [[6, 'PMO'], [7, 'ERP'], [8, 'MES'], [9, '가공'], [10, 'MDM']])
  })

  it('헤더가 아예 없어도(빈 배열) 폴백', () => {
    expect(buildWbsColumnMap([]).deliverable).toBe(11)
  })
})
