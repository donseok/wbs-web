import JSZip from 'jszip'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  mapTableCell, extractCellSkeletons, buildCellTxBody, buildHeaderCellTxBody, type CellSkeletons,
} from './xml'
import type { NarrativeGroup, NarrativeModel } from './narrative'
import type { WeeklyReportModel } from './weekly'

/* ── 셀 용량·페이지 분할(순수). 템플릿 셀 높이가 고정 → 넘치는 내용은 잘라내지 않고
 *    slide2를 복제한 연속 슬라이드로 이어 붙인다(활동 항목 유실 없음). ── */

/** 항목 목록을 max개로 제한(초과분은 '외 N건'). 이슈/이벤트 행(높이 1.3") 전용. */
export function capItems(items: string[], max: number): string[] {
  if (items.length <= max) return items
  return [...items.slice(0, max - 1), `외 ${items.length - (max - 1)}건`]
}

/** 시각적 줄수 추정 — 12pt·콘텐츠 셀폭 4.67" 기준 전각(한글·CJK) 약 26자/줄, 영문·숫자는 반각(0.5). */
const FULLWIDTH_PER_LINE = 26
export function lineCost(text: string): number {
  let w = 0
  for (const ch of text) w += ch.charCodeAt(0) >= 0x2e80 ? 1 : 0.5
  return Math.max(1, Math.ceil(w / FULLWIDTH_PER_LINE))
}

/** 그룹 줄수 = 헤더 + '- ' 항목들(줄바꿈 추정 포함). */
const groupCost = (phase: string, items: string[]): number =>
  lineCost(phase) + items.reduce((s, it) => s + lineCost(`- ${it}`), 0)

/** 그룹들을 페이지(셀)당 budget 시각줄 이내로 분할. 그룹 사이 빈 줄 1도 예산에 포함.
 *  새 페이지에 통째로 들어가는 그룹은 쪼개지 않고 이월하고, 한 페이지를 넘는 그룹만
 *  항목 단위로 쪼개 '(계속)' 헤더로 잇는다. 빈 입력은 1페이지(빈 그룹 목록)로. */
export function paginateGroups(groups: NarrativeGroup[], budget: number): NarrativeGroup[][] {
  const pages: NarrativeGroup[][] = []
  let page: NarrativeGroup[] = []
  let used = 0
  const flush = () => { if (page.length) pages.push(page); page = []; used = 0 }
  for (const g of groups) {
    let phase = g.phase
    let items = g.items
    for (;;) {
      const sep = page.length ? 1 : 0            // 직전 그룹과의 빈 줄
      const remain = budget - used - sep
      const total = groupCost(phase, items)
      if (total <= remain || (!page.length && !items.length)) {
        page.push({ phase, num: g.num, items })  // 통째로 수용(빈 페이지의 거대 헤더는 방어적 수용)
        used += sep + total
        break
      }
      if (page.length && total <= budget) { flush(); continue }  // 새 페이지로 통째 이월
      let cost = lineCost(phase), take = 0       // 분할: 남은 공간에 들어가는 항목까지
      while (take < items.length && cost + lineCost(`- ${items[take]}`) <= remain) {
        cost += lineCost(`- ${items[take]}`)
        take += 1
      }
      if (take === 0) {
        if (page.length) { flush(); continue }
        take = 1                                 // 예산보다 큰 단일 항목 — 최소 진행 보장
      }
      page.push({ phase, num: g.num, items: items.slice(0, take) })
      flush()
      items = items.slice(take)
      if (!items.length) break // 강제 수용(take=1)이 마지막 항목이면 빈 '(계속)' 페이지를 만들지 않는다
      phase = phase.endsWith(' (계속)') ? phase : `${g.phase} (계속)`
    }
  }
  flush()
  return pages.length ? pages : [[]]
}

/* ── 템플릿-필 렌더러. 원본 .pptx를 로드해 slide2 표 셀만 교체 → nodebuffer.
 *    내용이 CELL_BUDGET을 넘으면 slide2를 복제해 연속 페이지(slide3~)를 추가한다. ── */

const TEMPLATE_PATH = join(process.cwd(), 'src/lib/report/assets/weekly-template.pptx')
const CELL_BUDGET = 15   // 콘텐츠 셀(행1, 높이 3.26"·12pt) 페이지당 최대 시각 줄수
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

const SLIDE_CT = 'application/vnd.openxmlformats-officedocument.presentationml.slide+xml'
const SLIDE_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide'

/** 연속 페이지(slide3~)를 OPC에 배선: slide XML·slide rels·[Content_Types]·presentation(rels).
 *  복제 슬라이드는 think-cell 태그(custDataLst)와 tags 관계를 제거해 원본과의 태그 공유를 피한다. */
async function appendContinuationSlides(zip: JSZip, buildPage: (i: number) => string, pageCount: number): Promise<void> {
  const relsTmpl = (await zip.file('ppt/slides/_rels/slide2.xml.rels')!.async('string'))
    .replace(/<Relationship\b[^>]*\/relationships\/tags"[^>]*\/>/, '')
  let ct = await zip.file('[Content_Types].xml')!.async('string')
  let presRels = await zip.file('ppt/_rels/presentation.xml.rels')!.async('string')
  let pres = await zip.file('ppt/presentation.xml')!.async('string')
  for (let i = 1; i < pageCount; i += 1) {
    const n = i + 2                              // 연속 페이지는 slide3부터
    const rid = `rIdWk${n}`                      // 기존 rId1~rId10과 충돌하지 않는 신규 ID
    zip.file(`ppt/slides/slide${n}.xml`, buildPage(i).replace(/<p:custDataLst>[\s\S]*?<\/p:custDataLst>/, ''))
    zip.file(`ppt/slides/_rels/slide${n}.xml.rels`, relsTmpl)
    ct = ct.replace('</Types>', `<Override PartName="/ppt/slides/slide${n}.xml" ContentType="${SLIDE_CT}"/></Types>`)
    presRels = presRels.replace('</Relationships>', `<Relationship Id="${rid}" Type="${SLIDE_REL}" Target="slides/slide${n}.xml"/></Relationships>`)
    pres = pres.replace('</p:sldIdLst>', `<p:sldId id="${300 + n}" r:id="${rid}"/></p:sldIdLst>`)
  }
  zip.file('[Content_Types].xml', ct)
  zip.file('ppt/_rels/presentation.xml.rels', presRels)
  zip.file('ppt/presentation.xml', pres)
}

/** 주간 내러티브 → 템플릿 디자인 그대로의 PPTX(nodebuffer). 내용이 길면 페이지 자동 추가. */
export async function fillWeeklyTemplate(narr: NarrativeModel, model: WeeklyReportModel): Promise<Buffer> {
  const zip = await JSZip.loadAsync(await readFile(TEMPLATE_PATH))
  const slide2 = await zip.file('ppt/slides/slide2.xml')!.async('string')

  // 서식 스켈레톤: 행1 콘텐츠 셀 · 행2 이슈/이벤트 셀 · 행0 헤더 셀
  const contentSk: CellSkeletons = extractCellSkeletons(cellAt(slide2, 1, 1))
  const issueSk: CellSkeletons = extractCellSkeletons(cellAt(slide2, 2, 2))
  const hdrCell = cellAt(slide2, 0, 1)
  const hdrSk = {
    pPr: hdrCell.match(/<a:pPr\b[\s\S]*?<\/a:pPr>/)?.[0] ?? '',
    rPr: hdrCell.match(/<a:rPr\b[\s\S]*?<\/a:rPr>/)?.[0] ?? '',
    bodyPr: '<a:bodyPr/>', lstStyle: '<a:lstStyle/>',
  }

  const prevPages = paginateGroups(narr.prev, CELL_BUDGET)
  const currPages = paginateGroups(narr.curr, CELL_BUDGET)
  const pageCount = Math.max(prevPages.length, currPages.length)
  const issues = capItems(narr.issues.length ? narr.issues : ['특이 이슈 없음'], ISSUE_CAP)
  const events = capItems(narr.events.length ? narr.events : ['예정된 주요 이벤트 없음'], EVENT_CAP)

  // 페이지 i의 slide XML. 이슈/이벤트 행은 1페이지에만 싣고 연속 페이지는 '-'.
  const buildPage = (i: number): string => {
    let x = slide2
    x = mapTableCell(x, 0, 1, buildHeaderCellTxBody('전주 주요활동', model.meta.prevWeekRange, hdrSk))
    x = mapTableCell(x, 0, 2, buildHeaderCellTxBody('금주 주요활동', model.meta.weekRange, hdrSk))
    x = mapTableCell(x, 1, 1, buildCellTxBody(prevPages[i] ?? [], contentSk, i ? '-' : undefined))
    x = mapTableCell(x, 1, 2, buildCellTxBody(currPages[i] ?? [], contentSk, i ? '-' : undefined))
    x = mapTableCell(x, 2, 1, buildCellTxBody(asBulletGroups(i ? ['-'] : issues), issueSk))  // 이슈(전주 위치)
    x = mapTableCell(x, 2, 2, buildCellTxBody(asBulletGroups(i ? ['-'] : events), issueSk))  // 이벤트(금주 위치)
    return x
  }

  zip.file('ppt/slides/slide2.xml', buildPage(0))
  if (pageCount > 1) await appendContinuationSlides(zip, buildPage, pageCount)
  return (await zip.generateAsync({ type: 'nodebuffer' })) as Buffer
}
