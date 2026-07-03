import { describe, it, expect } from 'vitest'
import ExcelJS from 'exceljs'
import JSZip from 'jszip'
import { buildWeeklyReportModel } from '@/lib/report/weekly'
import { buildReportWorkbook } from '@/lib/report/excel'
import { buildReportDeck } from '@/lib/report/pptx'
import type { ComputedItem, Meeting } from '@/lib/domain/types'

async function slideXmls(buf: Buffer): Promise<{ paths: string[]; joined: string }> {
  const zip = await JSZip.loadAsync(buf)
  const paths = Object.keys(zip.files).filter(p => /^ppt\/slides\/slide\d+\.xml$/.test(p))
  const joined = (await Promise.all(paths.map(p => zip.files[p].async('string')))).join('')
  return { paths, joined }
}
const meetingFx = (over: Partial<Meeting>): Meeting => ({
  id: Math.random().toString(36).slice(2), projectId: 'p', title: '정례회의', meetingDate: '2026-07-01',
  startTime: '10:00', endTime: '11:00', location: '회의실', category: 'routine', body: '',
  recurrence: 'none', recurrenceUntil: null, createdBy: null, createdByName: null,
  createdAt: '2026-01-01', updatedAt: '2026-01-01', attendeeIds: ['m1'], ...over,
})

const node = (over: Partial<ComputedItem>): ComputedItem =>
  ({
    id: Math.random().toString(36).slice(2), parentId: null, level: 'activity', code: '1', sortOrder: 1,
    name: 'n', biz: null, deliverable: null, plannedStart: null, plannedEnd: null, weight: null, actualPct: null,
    owners: [], plannedPct: 0, rolledActualPct: 0, achievement: null, status: 'not_started', children: [],
    ...over,
  }) as ComputedItem
const phase = (name: string, children: ComputedItem[], over: Partial<ComputedItem> = {}): ComputedItem =>
  node({ level: 'phase', name, children, ...over })

const sampleItems: ComputedItem[] = [
  phase('착수', [
    node({ name: '킥오프', status: 'done', rolledActualPct: 100, owners: [{ team: 'PMO', kind: 'primary' }], plannedStart: '2026-01-20', plannedEnd: '2026-02-01' }),
  ], { weight: 1, plannedPct: 90, rolledActualPct: 100, status: 'done' }),
  phase('설계', [
    node({ name: 'TO-BE 설계', status: 'delayed', rolledActualPct: 30, owners: [{ team: '가공', kind: 'primary' }, { team: 'ERP', kind: 'support' }], plannedStart: '2026-04-01', plannedEnd: '2026-04-15' }),
    node({ name: '요구사항 정의', status: 'in_progress', rolledActualPct: 60, owners: [{ team: 'ERP', kind: 'primary' }], plannedStart: '2026-06-29', plannedEnd: '2026-07-03' }),
  ], { weight: 1, plannedPct: 50, rolledActualPct: 45, status: 'delayed' }),
]
const project = { name: 'D-CUBE PI', description: 'PI Master Plan', start_date: '2026-01-01', end_date: '2026-12-31' }
const model = buildWeeklyReportModel(sampleItems, project, '2026-06-30', { generatedAt: '2026-06-30 13:20' })
const emptyModel = buildWeeklyReportModel([], { name: '빈 프로젝트' }, '2026-06-30')

describe('buildReportWorkbook (보라 공정보고 2시트)', () => {
  it('2개 시트(공정보고/WBS) — 프로그램개발현황 제외', async () => {
    const buf = await buildReportWorkbook(model)
    const wb = new ExcelJS.Workbook()
    await wb.xlsx.load(buf)
    expect(wb.worksheets.map(w => w.name)).toEqual(['1.공정보고', '2.WBS'])
  })

  it('공정보고 제목/주차가 모델 값을 반영', async () => {
    const buf = await buildReportWorkbook(model)
    const wb = new ExcelJS.Workbook()
    await wb.xlsx.load(buf)
    const ws = wb.getWorksheet('1.공정보고')!
    expect(String(ws.getCell('A2').value)).toContain('D-CUBE PI')
    expect(String(ws.getCell('A2').value)).toContain('공정보고')
    expect(String(ws.getCell('B3').value)).toContain('6월 5주차')
  })

  it('WBS 시트에 전체 노드가 들어감(지연 항목명 포함)', async () => {
    const buf = await buildReportWorkbook(model)
    const wb = new ExcelJS.Workbook()
    await wb.xlsx.load(buf)
    const text = JSON.stringify(wb.getWorksheet('2.WBS')!.getSheetValues())
    expect(text).toContain('TO-BE 설계')
  })

  it('빈 모델도 깨지지 않고 2시트 생성', async () => {
    const buf = await buildReportWorkbook(emptyModel)
    const wb = new ExcelJS.Workbook()
    await wb.xlsx.load(buf)
    expect(wb.worksheets.length).toBe(2)
  })
})

describe('buildReportDeck (네이비 주간보고)', () => {
  it('유효한 pptx(zip) — PK 시그니처', async () => {
    const buf = await buildReportDeck(model)
    expect(buf.length).toBeGreaterThan(1000)
    expect(buf[0]).toBe(0x50)
    expect(buf[1]).toBe(0x4b)
  })

  it('빈 모델도 깨지지 않음', async () => {
    const buf = await buildReportDeck(emptyModel)
    expect(buf.length).toBeGreaterThan(1000)
    expect(buf[0]).toBe(0x50)
  })

  it('모든 슬라이드가 브랜드 배경(<p:bg>) 유지 + 주간보고/근태 슬라이드 포함', async () => {
    const buf = await buildReportDeck(model)
    const zip = await JSZip.loadAsync(buf)
    const slidePaths = Object.keys(zip.files).filter(p => /^ppt\/slides\/slide\d+\.xml$/.test(p))
    expect(slidePaths.length).toBeGreaterThanOrEqual(3) // 요약 + 상세 + 근태
    const xmls = await Promise.all(slidePaths.map(p => zip.files[p].async('string')))
    for (const [i, xml] of xmls.entries()) {
      expect(xml, `slide ${i + 1} 배경 누락`).toContain('<p:bg>')
    }
    const joined = xmls.join('')
    expect(joined).toContain('주간보고')
    expect(joined).toContain('근태현황')
  })

  it('레터헤드는 동국씨엠 (동국제강 그룹 아님)', async () => {
    const { joined } = await slideXmls(await buildReportDeck(model))
    expect(joined).toContain('동국씨엠')
    expect(joined).not.toContain('동국제강 그룹')
  })

  it('차주 계획이 많으면 상세 슬라이드가 여러 페이지로 분할(잘림 방지)', async () => {
    const many: ComputedItem[] = [
      phase('대량 단계', Array.from({ length: 12 }, (_, i) =>
        node({ name: `차주작업 ${i + 1}`, status: 'in_progress', rolledActualPct: 10, owners: [{ team: 'PMO', kind: 'primary' }], plannedStart: '2026-07-06', plannedEnd: '2026-07-10' }),
      ), { weight: 1, plannedPct: 0, rolledActualPct: 10, status: 'in_progress' }),
    ]
    const manyModel = buildWeeklyReportModel(many, project, '2026-06-30')
    const { paths, joined } = await slideXmls(await buildReportDeck(manyModel))
    // 표지+요약+상세(12/5=3)+근태 = 6 이상
    expect(paths.length).toBeGreaterThanOrEqual(6)
    expect(joined).toContain('(3/3)')
  })

  it('회의가 있으면 회의일정 슬라이드 추가, 없으면 생략', async () => {
    const withMeet = buildWeeklyReportModel(sampleItems, project, '2026-06-30', {
      generatedAt: '2026-06-30 13:20', meetings: [meetingFx({ meetingDate: '2026-07-01' })],
    })
    expect((await slideXmls(await buildReportDeck(withMeet))).joined).toContain('회의일정')
    // 회의 없는 기본 모델엔 없음
    expect((await slideXmls(await buildReportDeck(model))).joined).not.toContain('회의일정')
  })
})
