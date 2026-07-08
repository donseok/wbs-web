import { describe, it, expect } from 'vitest'
import JSZip from 'jszip'
import { readFile } from 'node:fs/promises'
import { capItems, capGroupsToBudget, fillWeeklyTemplate } from '@/lib/report/templateFill'
import type { NarrativeModel } from '@/lib/report/narrative'
import type { WeeklyReportModel } from '@/lib/report/weekly'

describe('capItems', () => {
  it('max 이하는 그대로', () => expect(capItems(['a', 'b'], 3)).toEqual(['a', 'b']))
  it('초과분은 마지막을 "외 N건"으로', () =>
    expect(capItems(['a', 'b', 'c', 'd'], 3)).toEqual(['a', 'b', '외 2건']))
})

describe('capGroupsToBudget', () => {
  it('총 줄수(헤더1+항목)가 예산 이내가 되도록 그룹별 항목 캡', () => {
    const groups = [
      { phase: 'P1', num: 1, items: ['a', 'b', 'c', 'd', 'e'] },
      { phase: 'P2', num: 2, items: ['x', 'y', 'z'] },
    ]
    const out = capGroupsToBudget(groups, 8)
    const lines = out.reduce((s, g) => s + 1 + g.items.length, 0)
    expect(lines).toBeLessThanOrEqual(8)
    expect(out).toHaveLength(2)
  })
  it('예산이 헤더 수 이하면 항목 0', () => {
    const groups = [{ phase: 'P1', num: 1, items: ['a', 'b'] }, { phase: 'P2', num: 2, items: ['c'] }]
    const out = capGroupsToBudget(groups, 2)
    expect(out.every(g => g.items.length === 0)).toBe(true)
  })
})

const narr: NarrativeModel = {
  prev: [{ phase: '설계', num: 1, items: ['R&R 확정'] }],
  curr: [{ phase: '구축', num: 1, items: ['MDM 표준화'] }],
  issues: ['샘플 이슈'], events: ['Kick-Off (7/10)'],
}
const model = { meta: { prevWeekRange: '6/29~7/3', weekRange: '7/6~7/10' } } as unknown as WeeklyReportModel

describe('fillWeeklyTemplate (통합)', () => {
  it('산출 zip의 slide2에 주차 내용 반영 + 표 외 파트는 원본과 동일', async () => {
    const buf = await fillWeeklyTemplate(narr, model)
    const zip = await JSZip.loadAsync(buf)
    const slide2 = await zip.file('ppt/slides/slide2.xml')!.async('string')
    expect(slide2).toContain('7/6~7/10')       // 금주 날짜 헤더
    expect(slide2).toContain('MDM 표준화')       // 금주 내용
    expect(slide2).toContain('R&amp;R 확정')     // 전주 내용(이스케이프)
    expect(slide2).toContain('Kick-Off (7/10)') // 이벤트
    // 표 외 파트 불변: slide1·theme1이 원본과 바이트 동일
    const tmpl = await JSZip.loadAsync(await readFile('src/lib/report/assets/weekly-template.pptx'))
    for (const p of ['ppt/slides/slide1.xml', 'ppt/theme/theme1.xml']) {
      expect(await zip.file(p)!.async('string')).toBe(await tmpl.file(p)!.async('string'))
    }
  })
})
