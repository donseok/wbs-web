import type { NarrativeGroup } from './narrative'

/* ── slide2 표 XML 조작(순수). 제너릭 XML 파서 없이 OOXML 네임스페이스/순서 보존. ── */

/** OOXML 텍스트 노드용 이스케이프. &는 반드시 먼저. */
export function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

const TR_RE = /<a:tr\b[^>]*>[\s\S]*?<\/a:tr>/g
const TC_RE = /<a:tc(?:\s[^>]*)?>[\s\S]*?<\/a:tc>/g
const TXBODY_RE = /<a:txBody>[\s\S]*?<\/a:txBody>/

/** slide2 표에서 [rowIdx][colIdx] 셀의 <a:txBody>를 newTxBody로 교체. tcPr·다른 셀·행은 보존.
 *  인덱스 콜백으로 정확히 해당 위치만 교체(동일 내용 셀 충돌 방지). 인덱스 벗어나면 원본 반환. */
export function mapTableCell(xml: string, rowIdx: number, colIdx: number, newTxBody: string): string {
  const rows = xml.match(TR_RE)
  if (!rows || rowIdx >= rows.length) return xml
  const cells = rows[rowIdx].match(TC_RE)
  if (!cells || colIdx >= cells.length) return xml
  let ri = -1
  return xml.replace(TR_RE, row => {
    ri += 1
    if (ri !== rowIdx) return row
    let ci = -1
    return row.replace(TC_RE, cell => {
      ci += 1
      // 함수 치환 — newTxBody의 $&·$'·$` 가 치환 패턴으로 해석돼 XML이 파손되는 것을 방지
      return ci === colIdx ? cell.replace(TXBODY_RE, () => newTxBody) : cell
    })
  })
}

export interface ParaSkeleton { pPr: string; rPr: string }
export interface CellSkeletons { title: ParaSkeleton; sub: ParaSkeleton; bodyPr: string; lstStyle: string }

const P_RE = /<a:p(?:\s[^>]*)?>([\s\S]*?)<\/a:p>/g
const PPR_RE = /<a:pPr\b[\s\S]*?<\/a:pPr>|<a:pPr\b[^>]*\/>/
const RPR_RE = /<a:rPr\b[\s\S]*?<\/a:rPr>|<a:rPr\b[^>]*\/>/

function paraSkeleton(paraInner: string): ParaSkeleton {
  return { pPr: paraInner.match(PPR_RE)?.[0] ?? '', rPr: paraInner.match(RPR_RE)?.[0] ?? '' }
}

/** 콘텐츠 셀 XML에서 제목(불릿)·상세(불릿없음) 문단 스켈레톤 + bodyPr/lstStyle 추출. */
export function extractCellSkeletons(cellXml: string): CellSkeletons {
  const paras = [...cellXml.matchAll(P_RE)].map(m => m[1])
  const titleInner = paras.find(p => p.includes('<a:buChar')) ?? paras[0] ?? ''
  const subInner = paras.find(p => p.includes('<a:buNone')) ?? paras[1] ?? titleInner
  const bodyPr = cellXml.match(/<a:bodyPr\b[^>]*\/>|<a:bodyPr\b[\s\S]*?<\/a:bodyPr>/)?.[0] ?? '<a:bodyPr/>'
  const lstStyle = cellXml.match(/<a:lstStyle\b[^>]*\/>|<a:lstStyle\b[\s\S]*?<\/a:lstStyle>/)?.[0] ?? '<a:lstStyle/>'
  return { title: paraSkeleton(titleInner), sub: paraSkeleton(subInner), bodyPr, lstStyle }
}

const para = (pPr: string, rPr: string, text: string) =>
  `<a:p>${pPr}<a:r>${rPr}<a:t>${escapeXml(text)}</a:t></a:r></a:p>`

/** rPr → endParaRPr 개명(빈 문단이 본문과 같은 줄 높이를 갖도록). */
const asEndParaRPr = (rPr: string) =>
  rPr.replace(/^<a:rPr/, '<a:endParaRPr').replace(/<\/a:rPr>$/, '</a:endParaRPr>')

/** 하위 항목 한 줄 표기 — 레퍼런스 PPT 줄 맞춤(marL=0, 텍스트 선행 공백).
 *  기본은 '    - 항목'. 항목이 '-'로 시작하면 4칸, '.'로 시작하면 8칸 들여쓰기만 붙인다. */
export function subLineText(item: string): string {
  const t = item.trimStart()
  if (t.startsWith('.')) return `        ${t}`
  if (t.startsWith('-')) return `    ${t}`
  return `    - ${item}`
}

/** Phase 그룹들 → 콘텐츠 셀 <a:txBody>. title=불릿+볼드 헤드라인, sub=들여쓴 상세 줄.
 *  상세 줄 표기는 lineFormatter로 주입(기본 subLineText — WBS 주간보고 '    - ' 규칙).
 *  상세 항목이 있는 그룹(주제 블록)이 끝나면 빈 문단 1줄로 다음 그룹과 구분(시인성).
 *  항목 없는 한 줄짜리 그룹(이슈/이벤트 불릿) 사이에는 빈 줄을 넣지 않는다. */
export function buildCellTxBody(
  groups: NarrativeGroup[], sk: CellSkeletons, emptyText = '(해당 없음)',
  lineFormatter: (item: string) => string = subLineText,
): string {
  const body: string[] = []
  if (!groups.length) {
    body.push(para(sk.sub.pPr, sk.sub.rPr, emptyText))
  } else {
    groups.forEach((g, gi) => {
      if (gi > 0 && groups[gi - 1].items.length > 0) {
        body.push(`<a:p>${sk.sub.pPr}${asEndParaRPr(sk.sub.rPr)}</a:p>`)
      }
      body.push(para(sk.title.pPr, sk.title.rPr, g.phase))
      for (const it of g.items) body.push(para(sk.sub.pPr, sk.sub.rPr, lineFormatter(it)))
    })
  }
  return `<a:txBody>${sk.bodyPr}${sk.lstStyle}${body.join('')}</a:txBody>`
}

/** 이슈/이벤트 셀을 콘텐츠 하위 줄과 동일 서식으로 — 줄마다 그룹 불릿(제목 앞 점) 없이 sub 스타일 +
 *  lineFormatter 들여쓰기만. (작성자 요청: 점은 그룹 표시에만, 제목·하위 줄엔 붙이지 않는다.)
 *  pPr/rPr는 무불릿(buNone) 문단 스켈레톤을, bodyPr/lstStyle은 해당 셀의 것을 넘긴다. 빈 목록은 emptyText 1줄. */
export function buildFlatCellTxBody(
  lines: string[],
  sk: { pPr: string; rPr: string; bodyPr: string; lstStyle: string },
  emptyText = '',
  lineFormatter: (item: string) => string = subLineText,
): string {
  const body = lines.length
    ? lines.map(l => para(sk.pPr, sk.rPr, lineFormatter(l)))
    : [para(sk.pPr, sk.rPr, emptyText)]
  return `<a:txBody>${sk.bodyPr}${sk.lstStyle}${body.join('')}</a:txBody>`
}

/** 헤더 셀 <a:txBody> — '라벨 (범위)' 단일 런. */
export function buildHeaderCellTxBody(
  label: string, range: string,
  sk: { pPr: string; rPr: string; bodyPr: string; lstStyle: string },
): string {
  return `<a:txBody>${sk.bodyPr}${sk.lstStyle}${para(sk.pPr, sk.rPr, `${label} (${range})`)}</a:txBody>`
}
