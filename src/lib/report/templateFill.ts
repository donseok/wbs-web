import JSZip from 'jszip'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  mapTableCell, extractCellSkeletons, buildCellTxBody, buildFlatCellTxBody, buildHeaderCellTxBody, subLineText, type CellSkeletons,
} from './xml'
import type { NarrativeGroup, NarrativeModel } from './narrative'
import type { SheetSectionCells } from './sheetNarrative'

/* ── 셀 용량·페이지 분할(순수). 템플릿 셀 높이가 고정 → 넘치는 내용은 잘라내지 않고
 *    slide2를 복제한 연속 슬라이드로 이어 붙인다(활동 항목 유실 없음). ── */

/** 항목 목록을 max개로 제한하고 초과분은 '외 N건' 한 줄로 요약 — 이슈/이벤트 셀 전용.
 *  시트 경로(sheetNarrative REPORT_ITEM_LIMIT)와 동일한 표시 규칙(max건 + '외 N건'). */
export function capItems(items: string[], max: number): string[] {
  if (items.length <= max) return items
  return [...items.slice(0, max), `외 ${items.length - max}건`]
}

/** 시각적 줄수 추정 — 12pt·콘텐츠 셀폭 4.67" 기준 전각(한글·CJK) 약 26자/줄, 영문·숫자는 반각(0.5). */
const FULLWIDTH_PER_LINE = 26
export function lineCost(text: string): number {
  let w = 0
  for (const ch of text) w += ch.charCodeAt(0) >= 0x2e80 ? 1 : 0.5
  return Math.max(1, Math.ceil(w / FULLWIDTH_PER_LINE))
}

/** 그룹 줄수 = 헤더 + 들여쓴 하위 항목들(줄바꿈 추정 포함) — 실제 렌더 문자열과 동일 기준. */
const groupCost = (phase: string, items: string[], fmt: (item: string) => string): number =>
  lineCost(phase) + items.reduce((s, it) => s + lineCost(fmt(it)), 0)

/** 최하위 상세 줄('.' 마커) 여부 — 담당/소제목 헤더('-'·일반 줄)와 구분(분할 시 헤더-상세 찢김 방지용). */
const isChildLine = (s: string): boolean => s.trimStart().startsWith('.')

/** 그룹들을 페이지(셀)당 budget 시각줄 이내로 분할. 그룹 사이 빈 줄 1도 예산에 포함.
 *  새 페이지에 통째로 들어가는 그룹은 쪼개지 않고 이월하고, 한 페이지를 넘는 그룹만
 *  항목 단위로 쪼개 '(계속)' 헤더로 잇는다. 빈 입력은 1페이지(빈 그룹 목록)로. */
export function paginateGroups(
  groups: NarrativeGroup[], budget: number,
  lineFormatter: (item: string) => string = subLineText,
): NarrativeGroup[][] {
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
      const total = groupCost(phase, items, lineFormatter)
      if (total <= remain || (!page.length && !items.length)) {
        page.push({ phase, num: g.num, items })  // 통째로 수용(빈 페이지의 거대 헤더는 방어적 수용)
        used += sep + total
        break
      }
      if (page.length && total <= budget) { flush(); continue }  // 새 페이지로 통째 이월
      let cost = lineCost(phase), take = 0       // 분할: 남은 공간에 들어가는 항목까지
      while (take < items.length && cost + lineCost(lineFormatter(items[take])) <= remain) {
        cost += lineCost(lineFormatter(items[take]))
        take += 1
      }
      // 상세('.') 직전의 헤더가 페이지 끝에 홀로 남지 않게 헤더부터 다음 페이지로 이월
      if (take > 0 && take < items.length && isChildLine(items[take]) && !isChildLine(items[take - 1])) take -= 1
      if (take === 0) {
        if (page.length) { flush(); continue }
        take = 1                                 // 예산보다 큰 단일 항목 — 최소 진행 보장
      }
      page.push({ phase, num: g.num, items: items.slice(0, take) })
      flush()
      const rest = items.slice(take)
      // 상세('.') 중간에서 끊겼으면 직전 헤더를 '(계속)'으로 반복해 담당 문맥 유지.
      // take=1(헤더만 실은 페이지)에는 재삽입하지 않음 — 동일 상태 반복(무한 루프) 방지.
      if (take > 1 && rest.length && isChildLine(rest[0])) {
        const hdr = items.slice(0, take).reverse().find(s => !isChildLine(s))
        if (hdr) rest.unshift(hdr.endsWith(' (계속)') ? hdr : `${hdr} (계속)`)
      }
      items = rest
      if (!items.length) break // 강제 수용(take=1)이 마지막 항목이면 빈 '(계속)' 페이지를 만들지 않는다
      phase = phase.endsWith(' (계속)') ? phase : `${g.phase} (계속)`
    }
  }
  flush()
  return pages.length ? pages : [[]]
}

/** 불릿 줄 목록을 셀 예산(시각 줄수) 단위 페이지로 분할 — 이슈/이벤트 셀 전용. 항목 유실·'외 N건' 캡 없이 전부.
 *  paginateGroups와 달리 줄 사이 빈 줄(구분자)이 없다 — 이슈/이벤트 불릿은 붙여 렌더되므로 실측 줄수와 일치.
 *  예산을 단독 초과하는 한 줄은 자기 페이지에 그대로 싣는다(잘라내지 않음). 빈 목록은 빈 1페이지. */
export function paginateLines(lines: string[], budget: number): string[][] {
  const pages: string[][] = []
  let page: string[] = []
  let used = 0
  for (const line of lines) {
    const c = lineCost(line)
    if (page.length && used + c > budget) { pages.push(page); page = []; used = 0 }
    page.push(line)
    used += c
  }
  if (page.length) pages.push(page)
  return pages.length ? pages : [[]]
}

/* ── 템플릿-필 렌더러. 원본 .pptx를 로드해 slide2 표 셀만 교체 → nodebuffer.
 *    내용이 CELL_BUDGET을 넘으면 slide2를 복제해 연속 페이지(slide3~)를 추가한다. ── */

const TEMPLATE_PATH = join(process.cwd(), 'src/lib/report/assets/weekly-template.pptx')
const CELL_BUDGET = 15   // 콘텐츠 셀(행1, 높이 3.26"·12pt) 페이지당 최대 시각 줄수
const ISSUE_BUDGET = 12  // 이슈/이벤트 셀(행2, 높이 2.67"로 확대 — 표 프레임 여백을 채움) 페이지당 최대 시각 줄수 — CELL_BUDGET×(2.67/3.26)≈12
// WBS 자동 보고 경로 전용 캡 — 이슈·주요 이벤트는 최대 5건 + '외 N건'(사용자 결정 2026-07-17,
// 시트 경로의 REPORT_ITEM_LIMIT=5와 동일 상한).
const ISSUE_CAP = 5, EVENT_CAP = 5

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

export interface FillTemplateOptions {
  labels?: { left: string; right: string }      // 행0 헤더 라벨(범위는 meta에서 합성)
  lineFormatter?: (item: string) => string      // 상세 줄 표기(렌더·줄수 추정 공용)
}

/** 한 셀의 렌더 입력 — 표시할 그룹들과, 그룹이 아무것도 못 그릴 때의 대체 문구. */
interface CellFill { groups: NarrativeGroup[]; empty: string }
/** 이슈/이벤트 셀 채움 — 줄 목록 + 빈 대체 문구. flat=true면 콘텐츠 하위 줄과 동일한 무불릿 서식(시트 경로),
 *  false면 그룹 불릿(제목 앞 점)으로 렌더(WBS 자동 보고 경로). */
interface IssueFill { lines: string[]; empty: string; flat: boolean }
/** 슬라이드 하나의 4개 콘텐츠 셀(행1 좌/우 = 실적/계획, 행2 좌/우 = 이슈/이벤트). 헤더 행0은 공통. */
interface SlideFill { contentLeft: CellFill; contentRight: CellFill; issueLeft: IssueFill; eventRight: IssueFill }

/** 기본(WBS) 슬라이드: 실적/계획을 각자 예산까지 묶어 독립 분할하고 인덱스로 정렬.
 *  이슈/이벤트는 1페이지에만 싣고 연속 페이지는 '-'(기존 동작 유지). */
function buildDefaultSlides(narr: NarrativeModel, fmt: (item: string) => string): SlideFill[] {
  const prevPages = paginateGroups(narr.prev, CELL_BUDGET, fmt)
  const currPages = paginateGroups(narr.curr, CELL_BUDGET, fmt)
  const pageCount = Math.max(prevPages.length, currPages.length)
  // 이슈 0건이면 대체 문구 없이 빈칸(사용자 요청: 특이 이슈 없으면 따로 작성 금지). 이벤트 대체 문구는 유지.
  const issues = capItems(narr.issues, ISSUE_CAP)
  const events = capItems(narr.events.length ? narr.events : ['예정된 주요 이벤트 없음'], EVENT_CAP)
  const slides: SlideFill[] = []
  for (let i = 0; i < pageCount; i += 1) {
    slides.push({
      contentLeft: { groups: prevPages[i] ?? [], empty: i ? '-' : '(해당 없음)' },
      contentRight: { groups: currPages[i] ?? [], empty: i ? '-' : '(해당 없음)' },
      // WBS 자동 보고는 기존대로 그룹 불릿 유지(flat:false) — 사용자 지시 "나머지 동일".
      issueLeft: { lines: i ? ['-'] : issues, empty: i ? '-' : '', flat: false },
      eventRight: { lines: i ? ['-'] : events, empty: '-', flat: false },
    })
  }
  return slides
}

/** 시트 슬라이드: 구분(업무영역) 하나당 한 페이지. 4셀(실적·계획·이슈·이벤트) 모두 그 구분 것으로 채운다.
 *  내용이 빈 구분도 페이지를 만든다(구분명은 콘텐츠 셀 헤더로 표기). 이슈·주요이벤트는 '외 N건'으로 줄이지
 *  않고 전부 싣되, 셀 예산(ISSUE_BUDGET)을 넘으면 그 구분의 다음 페이지로 이어 쓴다(사용자 요청). 한 구분이
 *  네 셀 중 무엇이든 예산을 넘으면 그 구분 안에서만 연속 페이지로 분할하고, 페이지 수는 네 셀 중 최댓값이다.
 *  이슈/이벤트가 없으면 대체 문구 없이 그냥 빈칸으로 둔다(사용자 요청 — '특이 이슈 없음' 등 표기 안 함). */
function buildSheetSlides(sections: SheetSectionCells[], fmt: (item: string) => string): SlideFill[] {
  const slides: SlideFill[] = []
  sections.forEach((sec, idx) => {
    // items가 비어도 그룹 헤더(구분명)는 렌더된다 → 빈 구분도 라벨이 붙은 빈 페이지가 된다.
    const prevPages = paginateGroups([{ phase: sec.section, num: idx + 1, items: sec.thisContent }], CELL_BUDGET, fmt)
    const currPages = paginateGroups([{ phase: sec.section, num: idx + 1, items: sec.nextContent }], CELL_BUDGET, fmt)
    // 이슈/이벤트도 전부 페이지네이션 — 넘치면 이어지는 페이지로. 없으면 빈칸(대체 문구 없음).
    const issuePages = paginateLines(sec.thisIssue, ISSUE_BUDGET)   // 빈 목록 → [[]] → 빈칸
    const eventPages = paginateLines(sec.nextIssue, ISSUE_BUDGET)
    const n = Math.max(prevPages.length, currPages.length, issuePages.length, eventPages.length)
    for (let i = 0; i < n; i += 1) {
      slides.push({
        contentLeft: { groups: prevPages[i] ?? [], empty: '-' },
        contentRight: { groups: currPages[i] ?? [], empty: '-' },
        // 이슈/이벤트는 콘텐츠 하위 줄과 동일 서식(flat:true — 그룹 불릿 없이 마커 들여쓰기).
        // 없는 페이지·구분은 빈칸('' → 대체 문구·불릿·'-' 없음).
        issueLeft: { lines: issuePages[i] ?? [], empty: '', flat: true },
        eventRight: { lines: eventPages[i] ?? [], empty: '', flat: true },
      })
    }
  })
  return slides.length ? slides : buildDefaultSlides({ prev: [], curr: [], issues: [], events: [] }, fmt)
}

/** 슬라이드 채움 배열 → 템플릿 디자인 그대로의 PPTX(nodebuffer). 2장 이상이면 slide2를 복제해 연속 슬라이드 추가.
 *  slides[0]는 slide2에, 이후는 slide3~에 배선된다. */
async function renderTemplate(
  slides: SlideFill[],
  meta: { prevWeekRange: string; weekRange: string },
  labels: { left: string; right: string },
  fmt: (item: string) => string,
): Promise<Buffer> {
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

  // 이슈/이벤트 셀: flat이면 콘텐츠 하위 줄과 동일한 무불릿 문단(contentSk.sub) + 셀 자체 bodyPr로,
  // 아니면 기존 그룹 불릿(issueSk.title)으로 렌더. issue 셀 템플릿엔 무불릿(buNone) 문단이 없어 contentSk.sub을 빌려온다.
  const flatIssueSk = { pPr: contentSk.sub.pPr, rPr: contentSk.sub.rPr, bodyPr: issueSk.bodyPr, lstStyle: issueSk.lstStyle }
  const renderIssue = (cell: IssueFill): string =>
    cell.flat
      ? buildFlatCellTxBody(cell.lines, flatIssueSk, cell.empty, fmt)
      : buildCellTxBody(asBulletGroups(cell.lines), issueSk, cell.empty)

  const buildPage = (i: number): string => {
    const s = slides[i]
    let x = slide2
    x = mapTableCell(x, 0, 1, buildHeaderCellTxBody(labels.left, meta.prevWeekRange, hdrSk))
    x = mapTableCell(x, 0, 2, buildHeaderCellTxBody(labels.right, meta.weekRange, hdrSk))
    x = mapTableCell(x, 1, 1, buildCellTxBody(s.contentLeft.groups, contentSk, s.contentLeft.empty, fmt))
    x = mapTableCell(x, 1, 2, buildCellTxBody(s.contentRight.groups, contentSk, s.contentRight.empty, fmt))
    x = mapTableCell(x, 2, 1, renderIssue(s.issueLeft))   // 이슈(전주 위치)
    x = mapTableCell(x, 2, 2, renderIssue(s.eventRight))  // 이벤트(금주 위치)
    return x
  }

  zip.file('ppt/slides/slide2.xml', buildPage(0))
  if (slides.length > 1) await appendContinuationSlides(zip, buildPage, slides.length)
  return (await zip.generateAsync({ type: 'nodebuffer' })) as Buffer
}

/** 주간 내러티브 → 템플릿 디자인 그대로의 PPTX(nodebuffer). 내용이 길면 페이지 자동 추가.
 *  model은 헤더 범위(meta)만 쓰므로 구조적 부분집합 허용 — 시트 경로는 최소 meta만 합성해 넘긴다. */
export async function fillWeeklyTemplate(
  narr: NarrativeModel,
  model: { meta: { prevWeekRange: string; weekRange: string } },
  opts: FillTemplateOptions = {},
): Promise<Buffer> {
  const labels = opts.labels ?? { left: '전주 주요활동', right: '금주 주요활동' }
  const fmt = opts.lineFormatter ?? subLineText
  return renderTemplate(buildDefaultSlides(narr, fmt), model.meta, labels, fmt)
}

/** 주간업무 시트 → 구분(업무영역)당 한 페이지 PPTX. 전 구분(내용 없는 구분 포함)을 페이지로 만들고,
 *  각 페이지에 그 구분의 금주실적·차주계획·이슈사항·주요이벤트를 함께 싣는다. */
export async function fillSheetTemplate(
  sections: SheetSectionCells[],
  model: { meta: { prevWeekRange: string; weekRange: string } },
  opts: FillTemplateOptions = {},
): Promise<Buffer> {
  const labels = opts.labels ?? { left: '금주실적', right: '차주계획' }
  const fmt = opts.lineFormatter ?? subLineText
  return renderTemplate(buildSheetSlides(sections, fmt), model.meta, labels, fmt)
}
