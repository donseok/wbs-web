#!/usr/bin/env node
/**
 * WBS 초안 → 임포트 마법사가 그대로 받는 xlsx.
 *
 * 왜 필요한가:
 *   새 프로젝트의 WBS 를 손으로 만들면 수백 행을 엑셀에서 직접 치게 된다. 그보다
 *   구조화된 JSON 으로 만들어 여기서 변환하는 편이 검증 가능하다. 2026-08-04 동국씨엠
 *   Track3 초안(847 항목)을 이 경로로 만들었다.
 *
 * 형식 결정 근거 — src/lib/excel/detect.ts 를 읽고 맞춘 것이다:
 *   · 시트명 'WBS' → pickSheets 가 우선 선택. 'Holiday' 시트는 이름이 같으면 자동 인식.
 *   · 계층은 아웃라인 코드(1 / 1.1 / 1.1.1). 0열이 OUTLINE_RE 를 100% 만족해
 *     detectOutlineHierarchy 가 잡는다. detectColumnHierarchy 가 먼저 도는데,
 *     '업무영역'과 '산출물'을 전 행에 채워 두면 exactlyOneRatio 가 0 에 수렴해 오탐하지 않는다.
 *   · 헤더 라벨은 전부 LOGICAL_ALIASES 의 완전일치 항목이라 confidence.logical = 1.0 이 된다.
 *     즉 마법사 2단계에서 사람이 손볼 게 없다.
 *
 * ⚠️ 날짜는 반드시 엑셀 날짜 셀이어야 한다.
 *   parseWithProfile.toIso 는 number|Date 만 받는다. "2026-08-03" 같은 문자열을 쓰면
 *   조용히 null 이 되어 **일정이 통째로 사라진 채 임포트가 성공한다.** 가장 비싼 함정이라
 *   여기서 로컬 정오 Date 로 만들어 막는다(정오인 이유는 시리얼 변환 시 타임존 때문에
 *   하루 밀리는 것을 피하기 위함).
 *
 * 입력 JSON 형태:
 *   { areas: [ { key, l1, l2, l2Deliverable, children: [ L3 ] } ] }
 *   L3 = { name, deliverable, start, end, weight, children: [ L4 ] }
 *   L4 = { name, deliverable, start, end, weight }
 *
 * 사용:
 *   node scripts/wbs/build-xlsx.mjs <areas.json> <out.xlsx>
 */
import * as XLSX from 'xlsx'

export const HEADER = ['코드', '업무명', '업무영역', '산출물', '시작일', '종료일', '가중치', '실적%', '담당']

/** 음력 기반 공휴일(설·추석·부처님오신날)은 넣지 않는다 — 틀린 날짜를 넣으면 계획%가 조용히 어긋난다. */
export const FIXED_HOLIDAYS_2026 = [
  ['2026-08-15', '광복절'],
  ['2026-10-03', '개천절'],
  ['2026-10-09', '한글날'],
  ['2026-12-25', '성탄절'],
]

/** 로컬 정오 Date. 위 ⚠️ 참조. */
export function toCell(iso) {
  if (!iso) return null
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso).trim())
  if (!m) throw new Error(`날짜 형식이 YYYY-MM-DD 가 아님: ${iso}`)
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12, 0, 0)
}

/** 형제 가중치를 합 1.0 으로. 합이 0 이면 균등 배분(임포터의 '형제 균등'과 같은 뜻). */
function normalize(nodes) {
  const sum = nodes.reduce((s, n) => s + (Number(n.weight) || 0), 0)
  if (sum <= 0) return nodes.map(() => Number((1 / nodes.length).toFixed(6)))
  return nodes.map(n => Number(((Number(n.weight) || 0) / sum).toFixed(6)))
}

/** 자식 날짜 범위로 부모 기간을 덮는다 — 상위 행이 비면 간트가 빈 줄로 보인다. */
function span(children) {
  const ss = children.map(c => c.start).filter(Boolean).sort()
  const ee = children.map(c => c.end).filter(Boolean).sort()
  return { start: ss[0] ?? null, end: ee[ee.length - 1] ?? null }
}

/**
 * areas → 시트 행(AOA). 1단은 l1(구분) 단위로 자동 생성한다.
 * 반환: { rows, problems } — problems 는 날짜 결손·역전 등 사람이 봐야 할 것들.
 */
export function buildRows(areas) {
  const problems = []
  const rows = [HEADER]

  const order = []
  const byL1 = new Map()
  for (const a of areas) {
    if (!byL1.has(a.l1)) { byL1.set(a.l1, []); order.push(a.l1) }
    byL1.get(a.l1).push(a)
  }

  let n1 = 0
  for (const l1 of order) {
    n1++
    const group = byL1.get(l1)
    const l2spans = group.map(a => span(a.children))
    const l1span = span(l2spans)
    const l2weights = normalize(group.map(() => ({ weight: 1 })))

    rows.push([String(n1), l1, l1, `${l1} 산출물 일체`,
      toCell(l1span.start), toCell(l1span.end), 1 / order.length, '', ''])

    group.forEach((a, i2) => {
      const code2 = `${n1}.${i2 + 1}`
      rows.push([code2, a.l2, l1, a.l2Deliverable || `${a.l2} 산출물`,
        toCell(l2spans[i2].start), toCell(l2spans[i2].end), l2weights[i2], '', ''])

      const w3 = normalize(a.children)
      a.children.forEach((c3, i3) => {
        const code3 = `${code2}.${i3 + 1}`
        const kids = c3.children ?? []
        const s3 = kids.length ? span(kids) : { start: c3.start, end: c3.end }
        rows.push([code3, c3.name, l1, c3.deliverable || '',
          toCell(s3.start), toCell(s3.end), w3[i3], '', ''])

        const w4 = normalize(kids)
        kids.forEach((c4, i4) => {
          const code4 = `${code3}.${i4 + 1}`
          if (!c4.start || !c4.end) problems.push(`${code4} ${c4.name}: 날짜 누락`)
          else if (c4.start > c4.end) problems.push(`${code4} ${c4.name}: 시작>종료`)
          rows.push([code4, c4.name, l1, c4.deliverable || '',
            toCell(c4.start), toCell(c4.end), w4[i4], '', ''])
        })
      })
    })
  }
  return { rows, problems }
}

/** 워크북 조립. 날짜 셀에 표시 서식만 입힌다(값은 시리얼 그대로). */
export function buildWorkbook(areas, holidays = FIXED_HOLIDAYS_2026) {
  const { rows, problems } = buildRows(areas)

  const ws = XLSX.utils.aoa_to_sheet(rows, { cellDates: true })
  ws['!cols'] = [{ wch: 11 }, { wch: 56 }, { wch: 22 }, { wch: 40 },
    { wch: 12 }, { wch: 12 }, { wch: 10 }, { wch: 8 }, { wch: 14 }]
  for (const ref of Object.keys(ws)) {
    if (!ref.startsWith('!') && ws[ref].t === 'd') ws[ref].z = 'yyyy-mm-dd'
  }

  const hs = XLSX.utils.aoa_to_sheet(holidays.map(([iso, name]) => [toCell(iso), name]), { cellDates: true })
  hs['!cols'] = [{ wch: 12 }, { wch: 16 }]
  for (const ref of Object.keys(hs)) {
    if (!ref.startsWith('!') && hs[ref].t === 'd') hs[ref].z = 'yyyy-mm-dd'
  }

  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'WBS')
  XLSX.utils.book_append_sheet(wb, hs, 'Holiday')
  return { wb, rows, problems }
}

// ── CLI ─────────────────────────────────────────────────────────────────────
if (import.meta.url === `file://${process.argv[1]}`) {
  const [src, out] = process.argv.slice(2)
  if (!src || !out) {
    console.error('사용법: node scripts/wbs/build-xlsx.mjs <areas.json> <out.xlsx>')
    process.exit(1)
  }
  const fs = await import('node:fs')

  const { areas } = JSON.parse(fs.readFileSync(src, 'utf8'))
  const { wb, rows, problems } = buildWorkbook(areas)
  // XLSX.writeFile 은 쓰지 않는다 — 네임스페이스 임포트에서는 set_fs 가 노출되지 않아
  // "cannot save file" 로 죽는다. 버퍼로 받아 node:fs 로 직접 쓴다.
  fs.writeFileSync(out, XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }))

  const depth = {}
  for (const r of rows.slice(1)) {
    const d = String(r[0]).split('.').length
    depth[d] = (depth[d] ?? 0) + 1
  }
  console.log(`저장: ${out}`)
  console.log(`행 ${rows.length - 1} — ` +
    Object.keys(depth).sort().map(d => `${d}단 ${depth[d]}`).join(' · '))
  if (problems.length) {
    console.log(`\n경고 ${problems.length}건:`)
    problems.slice(0, 40).forEach(p => console.log('  · ' + p))
    if (problems.length > 40) console.log(`  ... 외 ${problems.length - 40}건`)
    process.exit(1)
  }
  console.log('경고 없음')
}
