import { describe, it, expect } from 'vitest'
import {
  escapeXml, mapTableCell, extractCellSkeletons,
  buildCellTxBody, buildHeaderCellTxBody, subLineText, type CellSkeletons,
} from '@/lib/report/xml'

describe('escapeXml', () => {
  it('앰퍼샌드·꺾쇠·따옴표 이스케이프', () => {
    expect(escapeXml('R&R < > "a"')).toBe('R&amp;R &lt; &gt; &quot;a&quot;')
  })
  it('한글·일반 텍스트는 그대로', () => {
    expect(escapeXml('워크샵 실시 (7/2)')).toBe('워크샵 실시 (7/2)')
  })
})

const TBL =
  '<a:tbl><a:tblPr/><a:tblGrid><a:gridCol w="1"/></a:tblGrid>' +
  '<a:tr h="1"><a:tc><a:txBody><a:p>A</a:p></a:txBody><a:tcPr/></a:tc>' +
  '<a:tc><a:txBody><a:p>B</a:p></a:txBody><a:tcPr x="1"/></a:tc></a:tr>' +
  '<a:tr h="2"><a:tc><a:txBody><a:p>C</a:p></a:txBody><a:tcPr/></a:tc></a:tr></a:tbl>'

describe('mapTableCell', () => {
  it('[0][1] 셀의 txBody만 교체하고 tcPr·다른 셀은 보존', () => {
    const out = mapTableCell(TBL, 0, 1, '<a:txBody><a:p>NEW</a:p></a:txBody>')
    expect(out).toContain('<a:tc><a:txBody><a:p>NEW</a:p></a:txBody><a:tcPr x="1"/></a:tc>')
    expect(out).toContain('<a:p>A</a:p>') // [0][0] 불변
    expect(out).toContain('<a:p>C</a:p>') // [1][0] 불변
    expect(out).not.toContain('<a:p>B</a:p>') // 교체됨
  })
  it('동일 내용 셀이 있어도 지정 인덱스만 교체', () => {
    const dup =
      '<a:tr h="1"><a:tc><a:txBody><a:p>X</a:p></a:txBody></a:tc>' +
      '<a:tc><a:txBody><a:p>X</a:p></a:txBody></a:tc></a:tr>'
    const out = mapTableCell(dup, 0, 1, '<a:txBody><a:p>Y</a:p></a:txBody>')
    expect(out).toBe(
      '<a:tr h="1"><a:tc><a:txBody><a:p>X</a:p></a:txBody></a:tc>' +
      '<a:tc><a:txBody><a:p>Y</a:p></a:txBody></a:tc></a:tr>',
    )
  })
  it('속성 있는 tc(병합셀)도 매칭', () => {
    const merged = '<a:tr h="1"><a:tc gridSpan="2"><a:txBody><a:p>M</a:p></a:txBody></a:tc></a:tr>'
    const out = mapTableCell(merged, 0, 0, '<a:txBody><a:p>Z</a:p></a:txBody>')
    expect(out).toContain('<a:tc gridSpan="2"><a:txBody><a:p>Z</a:p></a:txBody></a:tc>')
  })
  it('행/열 인덱스 벗어나면 원본 그대로', () => {
    expect(mapTableCell(TBL, 9, 0, '<a:txBody/>')).toBe(TBL)
  })
  it("텍스트의 $&·$'·$` 가 치환 패턴으로 해석되지 않고 그대로 들어감", () => {
    const tx = "<a:txBody><a:p>US$'000 $&amp; $` 예산</a:p></a:txBody>"
    const out = mapTableCell(TBL, 0, 1, tx)
    expect(out).toContain(tx)
  })
})

const CONTENT_CELL =
  '<a:tc><a:txBody><a:bodyPr/><a:lstStyle/>' +
  '<a:p><a:pPr marL="85725" indent="-85725"><a:buChar char="•"/></a:pPr>' +
  '<a:r><a:rPr sz="1200" b="1"><a:latin typeface="+mn-ea"/></a:rPr><a:t>제목</a:t></a:r></a:p>' +
  '<a:p><a:pPr marL="0" indent="0"><a:buNone/></a:pPr>' +
  '<a:r><a:rPr sz="1200" b="0"><a:latin typeface="+mn-ea"/></a:rPr><a:t>    - 상세</a:t></a:r></a:p>' +
  '</a:txBody><a:tcPr/></a:tc>'

describe('extractCellSkeletons', () => {
  it('제목(불릿)·상세(불릿없음) 문단의 pPr·rPr을 분리 추출', () => {
    const sk = extractCellSkeletons(CONTENT_CELL)
    expect(sk.title.pPr).toContain('<a:buChar char="•"/>')
    expect(sk.title.rPr).toContain('b="1"')
    expect(sk.sub.pPr).toContain('<a:buNone/>')
    expect(sk.sub.rPr).toContain('b="0"')
    expect(sk.bodyPr).toBe('<a:bodyPr/>')
    expect(sk.lstStyle).toBe('<a:lstStyle/>')
  })
})

const SK: CellSkeletons = {
  title: { pPr: '<a:pPr><a:buChar char="•"/></a:pPr>', rPr: '<a:rPr sz="1200" b="1"/>' },
  sub: { pPr: '<a:pPr><a:buNone/></a:pPr>', rPr: '<a:rPr sz="1200" b="0"/>' },
  bodyPr: '<a:bodyPr/>', lstStyle: '<a:lstStyle/>',
}

describe('subLineText', () => {
  it("기본 항목은 레퍼런스 줄 맞춤대로 '    - ' 접두", () => {
    expect(subLineText('참석자 : TF 팀원')).toBe('    - 참석자 : TF 팀원')
  })
  it("'-'로 시작하는 항목은 대시 중복 없이 4칸 들여쓰기", () => {
    expect(subLineText('- 회의 내용')).toBe('    - 회의 내용')
  })
  it("'.'로 시작하는 항목은 8칸 들여쓰기(레퍼런스 하위 단계)", () => {
    expect(subLineText('. 프로젝트 목적 공유')).toBe('        . 프로젝트 목적 공유')
  })
})

describe('buildCellTxBody', () => {
  it('그룹→제목 문단 + 항목→상세 문단(4칸 들여쓰기), 이스케이프 적용', () => {
    const xml = buildCellTxBody([{ phase: '설계 & 계획', num: 1, items: ['R&R 확정', '일정 공유'] }], SK)
    expect(xml.startsWith('<a:txBody><a:bodyPr/><a:lstStyle/>')).toBe(true)
    expect(xml).toContain('<a:buChar char="•"/>')
    expect(xml).toContain('<a:t>설계 &amp; 계획</a:t>')
    expect(xml).toContain('<a:buNone/>')
    expect(xml).toContain('<a:t>    - R&amp;R 확정</a:t>')
    expect(xml.endsWith('</a:txBody>')).toBe(true)
  })
  it('빈 그룹 → (해당 없음) 한 줄, emptyText로 대체 가능', () => {
    expect(buildCellTxBody([], SK)).toContain('<a:t>(해당 없음)</a:t>')
    expect(buildCellTxBody([], SK, '-')).toContain('<a:t>-</a:t>')
  })

  // 런(<a:r>) 없는 빈 문단 — 주제 블록 구분용 개행
  const blankParas = (xml: string) =>
    (xml.match(/<a:p><a:pPr><a:buNone\/><\/a:pPr><a:endParaRPr[^>]*\/><\/a:p>/g) ?? []).length

  it('항목 있는 그룹(주제 블록) 사이마다 빈 문단 1줄', () => {
    const gs = ['P1', 'P2', 'P3'].map((p, i) => ({ phase: p, num: i + 1, items: [`${p} 항목`] }))
    const xml = buildCellTxBody(gs, SK)
    expect(blankParas(xml)).toBe(2)                             // 그룹 3개 → 사이 2곳
    const blankAt = xml.indexOf('<a:endParaRPr')
    expect(blankAt).toBeGreaterThan(xml.indexOf('P1 항목'))     // 첫 블록 끝난 뒤
    expect(blankAt).toBeLessThan(xml.indexOf('<a:t>P2</a:t>')) // 다음 헤더 앞
  })
  it('그룹 1개면 빈 문단 없음', () => {
    expect(blankParas(buildCellTxBody([{ phase: 'P1', num: 1, items: ['a', 'b'] }], SK))).toBe(0)
  })
  it('항목 없는 한 줄 그룹(이슈/이벤트 불릿) 사이에는 빈 문단 없음', () => {
    const gs = ['이슈1', '이슈2', '이슈3'].map(p => ({ phase: p, num: 0, items: [] }))
    expect(blankParas(buildCellTxBody(gs, SK))).toBe(0)
  })
})

describe('buildHeaderCellTxBody', () => {
  it('라벨 + 날짜범위 단일 런', () => {
    const xml = buildHeaderCellTxBody('전주 주요활동', '6/29~7/3', {
      pPr: '<a:pPr algn="ctr"/>', rPr: '<a:rPr sz="1400"/>', bodyPr: '<a:bodyPr/>', lstStyle: '<a:lstStyle/>',
    })
    expect(xml).toContain('<a:t>전주 주요활동 (6/29~7/3)</a:t>')
    expect(xml).toContain('algn="ctr"')
  })
})
