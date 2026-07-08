import JSZip from 'jszip'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  mapTableCell, extractCellSkeletons, buildCellTxBody, buildHeaderCellTxBody, type CellSkeletons,
} from './xml'
import type { NarrativeGroup, NarrativeModel } from './narrative'
import type { WeeklyReportModel } from './weekly'

/* ── 셀 용량 캡(순수). 템플릿 셀 높이가 고정 → 페이지 분할 없이 한 칸에 맞게 요약. ── */

/** 항목 목록을 max개로 제한(초과분은 '외 N건'). */
export function capItems(items: string[], max: number): string[] {
  if (items.length <= max) return items
  return [...items.slice(0, max - 1), `외 ${items.length - (max - 1)}건`]
}

/** 그룹들의 총 줄수(그룹당 헤더1 + 항목수)가 budget 이내가 되도록 그룹별 항목을 균등 캡.
 *  그룹 수는 보존. 헤더만으로 예산 초과면 각 그룹 항목 0으로. */
export function capGroupsToBudget(groups: NarrativeGroup[], budget: number): NarrativeGroup[] {
  if (!groups.length) return groups
  const itemBudget = Math.max(0, budget - groups.length)
  const perGroup = Math.max(0, Math.floor(itemBudget / groups.length))
  return groups.map(g => ({ phase: g.phase, num: g.num, items: capItems(g.items, perGroup || 1).slice(0, perGroup) }))
}

/* ── 템플릿-필 렌더러. 원본 .pptx를 로드해 slide2 표 셀만 교체 → nodebuffer. ── */

const TEMPLATE_PATH = join(process.cwd(), 'src/lib/report/assets/weekly-template.pptx')
const CELL_BUDGET = 15   // 콘텐츠 셀(행1, 높이 3.26") 최대 줄수
const ISSUE_CAP = 3, EVENT_CAP = 4

/** slide2 표에서 [r][c] tc의 원본 XML(스켈레톤 추출용). */
function cellAt(slideXml: string, r: number, c: number): string {
  const rows = slideXml.match(/<a:tr\b[^>]*>[\s\S]*?<\/a:tr>/g) ?? []
  const cells = rows[r]?.match(/<a:tc(?:\s[^>]*)?>[\s\S]*?<\/a:tc>/g) ?? []
  return cells[c] ?? ''
}

/** 각 문자열을 볼드-불릿 한 줄로(이슈/이벤트 목록용). */
const asBulletGroups = (lines: string[]): NarrativeGroup[] =>
  lines.map(l => ({ phase: l, num: 0, items: [] }))

/** 주간 내러티브 → 템플릿 디자인 그대로의 PPTX(nodebuffer). */
export async function fillWeeklyTemplate(narr: NarrativeModel, model: WeeklyReportModel): Promise<Buffer> {
  const zip = await JSZip.loadAsync(await readFile(TEMPLATE_PATH))
  let slide2 = await zip.file('ppt/slides/slide2.xml')!.async('string')

  // 서식 스켈레톤: 행1 콘텐츠 셀 · 행2 이슈/이벤트 셀 · 행0 헤더 셀
  const contentSk: CellSkeletons = extractCellSkeletons(cellAt(slide2, 1, 1))
  const issueSk: CellSkeletons = extractCellSkeletons(cellAt(slide2, 2, 2))
  const hdrCell = cellAt(slide2, 0, 1)
  const hdrSk = {
    pPr: hdrCell.match(/<a:pPr\b[\s\S]*?<\/a:pPr>/)?.[0] ?? '',
    rPr: hdrCell.match(/<a:rPr\b[\s\S]*?<\/a:rPr>/)?.[0] ?? '',
    bodyPr: '<a:bodyPr/>', lstStyle: '<a:lstStyle/>',
  }

  const prev = capGroupsToBudget(narr.prev, CELL_BUDGET)
  const curr = capGroupsToBudget(narr.curr, CELL_BUDGET)
  const issues = capItems(narr.issues.length ? narr.issues : ['특이 이슈 없음'], ISSUE_CAP)
  const events = capItems(narr.events.length ? narr.events : ['예정된 주요 이벤트 없음'], EVENT_CAP)

  slide2 = mapTableCell(slide2, 0, 1, buildHeaderCellTxBody('전주 주요활동', model.meta.prevWeekRange, hdrSk))
  slide2 = mapTableCell(slide2, 0, 2, buildHeaderCellTxBody('금주 주요활동', model.meta.weekRange, hdrSk))
  slide2 = mapTableCell(slide2, 1, 1, buildCellTxBody(prev, contentSk))
  slide2 = mapTableCell(slide2, 1, 2, buildCellTxBody(curr, contentSk))
  slide2 = mapTableCell(slide2, 2, 1, buildCellTxBody(asBulletGroups(issues), issueSk))  // 이슈(전주 위치)
  slide2 = mapTableCell(slide2, 2, 2, buildCellTxBody(asBulletGroups(events), issueSk))  // 이벤트(금주 위치)

  zip.file('ppt/slides/slide2.xml', slide2)
  return (await zip.generateAsync({ type: 'nodebuffer' })) as Buffer
}
