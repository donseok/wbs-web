import { describe, it, expect } from 'vitest'
import JSZip from 'jszip'
import { readFile } from 'node:fs/promises'
import { capItems, lineCost, paginateGroups, fillWeeklyTemplate } from '@/lib/report/templateFill'
import { sheetLineText } from '@/lib/report/sheetNarrative'
import type { NarrativeGroup, NarrativeModel } from '@/lib/report/narrative'
import type { WeeklyReportModel } from '@/lib/report/weekly'

describe('capItems', () => {
  it('max 이하는 그대로', () => expect(capItems(['a', 'b'], 3)).toEqual(['a', 'b']))
  it('초과분은 마지막을 "외 N건"으로', () =>
    expect(capItems(['a', 'b', 'c', 'd'], 3)).toEqual(['a', 'b', '외 2건']))
})

describe('lineCost', () => {
  it('짧은 텍스트는 1줄', () => expect(lineCost('항목')).toBe(1))
  it('전각 26자 초과는 줄바꿈으로 2줄', () => expect(lineCost('가'.repeat(27))).toBe(2))
  it('영문·숫자는 반각(전각의 절반)으로 계산', () => expect(lineCost('a'.repeat(52))).toBe(1))
})

describe('paginateGroups', () => {
  const g = (phase: string, n: number, prefix = '항목'): NarrativeGroup =>
    ({ phase, num: 1, items: Array.from({ length: n }, (_, i) => `${prefix}${i + 1}`) })

  it('예산 이내면 1페이지에 전부', () => {
    const pages = paginateGroups([g('P1', 3), g('P2', 4)], 15)
    expect(pages).toHaveLength(1)
    expect(pages[0].map(x => x.phase)).toEqual(['P1', 'P2'])
  })
  it('그룹 사이 빈 줄 1줄도 예산에 포함', () => {
    // P1(1+7=8) + 빈줄(1) + P2(1+6=7) = 16 > 15 → 2페이지
    const pages = paginateGroups([g('P1', 7), g('P2', 6)], 15)
    expect(pages).toHaveLength(2)
    expect(pages[1][0].phase).toBe('P2')
    expect(pages[1][0].items).toHaveLength(6) // 통째 이월(분할 없음)
  })
  it('한 페이지를 넘는 그룹만 항목 단위로 쪼개고 "(계속)" 헤더로 잇는다', () => {
    const pages = paginateGroups([g('실행', 20)], 15)
    expect(pages).toHaveLength(2)
    expect(pages[0][0].items).toHaveLength(14)              // 헤더1 + 항목14 = 15줄
    expect(pages[1][0].phase).toBe('실행 (계속)')
    expect(pages[1][0].items).toHaveLength(6)
    const all = pages.flat().flatMap(x => x.items)
    expect(all).toHaveLength(20)                            // 항목 유실 없음
    expect(new Set(all).size).toBe(20)
  })
  it('줄바꿈되는 긴 항목은 2줄로 계산되어 더 일찍 분할', () => {
    const long = '현황 파악 (As-Is 프로세스, 시스템 현황, 조직 구성 등) 상세 분석' // 전각 26자 초과 → 2줄
    const pages = paginateGroups([{ phase: 'P', num: 1, items: Array.from({ length: 10 }, () => long) }], 15)
    // 헤더1 + 2줄×7 = 15 → 페이지당 7개
    expect(pages[0][0].items).toHaveLength(7)
    expect(pages).toHaveLength(2)
  })
  it('num은 분할·이월 후에도 원본 그룹 값 유지', () => {
    const pages = paginateGroups([{ ...g('실행', 20), num: 3 }], 15)
    expect(pages.flat().every(x => x.num === 3)).toBe(true)
  })
  it('빈 입력은 빈 1페이지', () => expect(paginateGroups([], 15)).toEqual([[]]))
  it('예산을 단독 초과하는 마지막 항목이 빈 "(계속)" 페이지를 남기지 않음', () => {
    const huge = '가'.repeat(390) // lineCost 15 초과
    const pages = paginateGroups([{ phase: '실행', num: 1, items: [huge] }], 15)
    expect(pages).toHaveLength(1)                       // 유령 페이지 없음
    expect(pages.flat().every(x => x.items.length > 0 || x.phase === '실행')).toBe(true)
    expect(pages.flat().filter(x => x.phase.includes('(계속)') && x.items.length === 0)).toHaveLength(0)
    // 뒤에 그룹이 이어져도 빈 '(계속)' 헤더가 끼지 않는다
    const pages2 = paginateGroups([{ phase: '실행', num: 1, items: [huge] }, g('구축', 2)], 15)
    expect(pages2.flat().filter(x => x.items.length === 0)).toHaveLength(0)
  })
  it('담당 헤더("- X")가 페이지 끝에 홀로 남지 않고 상세와 함께 다음 페이지로 이월', () => {
    // 헤더1 + 항목13 = 14줄 사용 → 15번째 줄에 '- MES' 헤더만 남는 상황
    const items = [...Array.from({ length: 13 }, (_, i) => `항목${i + 1}`), '- MES', '. 상세A', '. 상세B']
    const pages = paginateGroups([{ phase: 'P', num: 1, items }], 15)
    expect(pages).toHaveLength(2)
    expect(pages[0][0].items.at(-1)).toBe('항목13')                 // 헤더가 끝에 홀로 남지 않음
    expect(pages[1][0].items).toEqual(['- MES', '. 상세A', '. 상세B'])
  })
  it('상세(".") 중간에서 끊기면 다음 페이지에 담당 헤더를 "(계속)"으로 반복', () => {
    const items = ['- MES', ...Array.from({ length: 20 }, (_, i) => `. 상세${i + 1}`)]
    const pages = paginateGroups([{ phase: 'P', num: 1, items }], 15)
    expect(pages).toHaveLength(2)
    expect(pages[1][0].items[0]).toBe('- MES (계속)')
    // 원본 상세 20건 전부 보존
    const details = pages.flat().flatMap(x => x.items).filter(s => s.startsWith('. '))
    expect(details).toHaveLength(20)
  })

  it('시트 포매터(sheetLineText) 주입 시에도 분할 규칙이 동일하게 적용된다', () => {
    const pages = paginateGroups([g('[ERP] SD/LE', 20)], 15, sheetLineText)
    expect(pages).toHaveLength(2)
    expect(pages[0][0].items).toHaveLength(14)
    expect(pages[1][0].phase).toBe('[ERP] SD/LE (계속)')
    expect(pages[1][0].items).toHaveLength(6)
    const all = pages.flat().flatMap(x => x.items)
    expect(all).toHaveLength(20)
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
    expect(zip.file('ppt/slides/slide3.xml')).toBeNull() // 한 페이지면 슬라이드 추가 없음
    // 표 외 파트 불변: slide1·theme1이 원본과 바이트 동일
    const tmpl = await JSZip.loadAsync(await readFile('src/lib/report/assets/weekly-template.pptx'))
    for (const p of ['ppt/slides/slide1.xml', 'ppt/theme/theme1.xml']) {
      expect(await zip.file(p)!.async('string')).toBe(await tmpl.file(p)!.async('string'))
    }
  })

  it('내용이 넘치면 연속 슬라이드(slide3~)가 OPC 4개 파트에 배선되어 추가된다', async () => {
    const big: NarrativeModel = {
      ...narr,
      prev: [{ phase: '실행', num: 1, items: Array.from({ length: 20 }, (_, i) => `전주활동 ${i + 1}`) }],
    }
    const buf = await fillWeeklyTemplate(big, model)
    const zip = await JSZip.loadAsync(buf)

    const slide3 = await zip.file('ppt/slides/slide3.xml')!.async('string')
    expect(slide3).toContain('실행 (계속)')
    expect(slide3).not.toContain('<p:custDataLst>')     // think-cell 태그 제거
    const slide2 = await zip.file('ppt/slides/slide2.xml')!.async('string')
    const count = (s: string) => (s.match(/전주활동 /g) ?? []).length
    expect(count(slide2) + count(slide3)).toBe(20)      // '외 N건' 없이 전 항목 보존
    expect(slide2).not.toContain('외 ')

    const rels3 = await zip.file('ppt/slides/_rels/slide3.xml.rels')!.async('string')
    expect(rels3).toContain('slideLayout')
    expect(rels3).not.toContain('/tags')                 // tags 관계 제거
    const ct = await zip.file('[Content_Types].xml')!.async('string')
    expect(ct).toContain('/ppt/slides/slide3.xml')
    const presRels = await zip.file('ppt/_rels/presentation.xml.rels')!.async('string')
    expect(presRels).toContain('Target="slides/slide3.xml"')
    const pres = await zip.file('ppt/presentation.xml')!.async('string')
    expect((pres.match(/<p:sldId /g) ?? []).length).toBe(3)
    expect(pres.indexOf('rIdWk3')).toBeGreaterThan(pres.indexOf('rId3')) // 순서: slide2 뒤
  })

  it('연속 페이지에서 한쪽 열이 먼저 끝나면 "-", 이슈/이벤트 행도 "-"', async () => {
    const big: NarrativeModel = {
      ...narr,
      prev: [{ phase: '실행', num: 1, items: Array.from({ length: 20 }, (_, i) => `전주활동 ${i + 1}`) }],
      curr: [{ phase: '구축', num: 1, items: ['한 건'] }],
    }
    const zip = await JSZip.loadAsync(await fillWeeklyTemplate(big, model))
    const slide3 = await zip.file('ppt/slides/slide3.xml')!.async('string')
    expect(slide3).toContain('<a:t>-</a:t>')            // 금주 열·이슈·이벤트 자리
    expect(slide3).not.toContain('샘플 이슈')            // 이슈는 1페이지에만
    expect(slide3).not.toContain('Kick-Off')
  })
})

describe('fillWeeklyTemplate 옵션 (시트 경로)', () => {
  const narr = {
    prev: [{ phase: '[ERP] SD/LE', num: 1, items: ['1. 실적', '- 상세'] }],
    curr: [{ phase: '[ERP] SD/LE', num: 1, items: ['1. 계획'] }],
    issues: ['[SD/LE] 지연 위험'], events: ['특이 이슈 없음'],
  }
  const meta = { meta: { prevWeekRange: '7/6~7/10', weekRange: '7/13~7/17' } }
  const sheetFmt = (s: string) => (s.trimStart().startsWith('-') ? `        ${s.trimStart()}` : `    ${s.trimStart()}`)

  it('labels 주입 시 헤더 교체 + lineFormatter로 무마커 들여쓰기', async () => {
    const buf = await fillWeeklyTemplate(narr, meta, {
      labels: { left: '금주실적', right: '차주계획' }, lineFormatter: sheetFmt,
    })
    const zip = await JSZip.loadAsync(buf)
    const xml = await zip.file('ppt/slides/slide2.xml')!.async('string')
    expect(xml).toContain('금주실적 (7/6~7/10)')
    expect(xml).toContain('차주계획 (7/13~7/17)')
    expect(xml).toContain('<a:t>    1. 실적</a:t>')       // 마커 미추가
    expect(xml).toContain('<a:t>        - 상세</a:t>')     // '-' 8칸
    expect(xml).not.toContain('전주 주요활동')
  })
  it('옵션 없으면 기존 라벨 그대로(기본 동작 불변)', async () => {
    const buf = await fillWeeklyTemplate(narr, meta)
    const zip = await JSZip.loadAsync(buf)
    const xml = await zip.file('ppt/slides/slide2.xml')!.async('string')
    expect(xml).toContain('전주 주요활동 (7/6~7/10)')
    expect(xml).toContain('<a:t>    - 1. 실적</a:t>')      // 기존 subLineText 규칙
  })
})
