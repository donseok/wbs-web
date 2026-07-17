/* ── 주간 시트 양식 통일(순수) — 마커·번호·빈 줄만 표준화, 내용 불변. I/O 없음.
 *    스펙: docs/superpowers/specs/2026-07-17-weekly-format-unify-design.md ── */

import { WEEKLY_CELL_KEYS, CELL_FIELD, type WeeklyCellKey, type WeeklySheetRow } from './weeklySheet'

// 상위(1단계): '1.' '1)' '(1)' '①~⑳'. 숫자 1~3자리 제한 + 마커 뒤 숫자 금지 —
// 연도('2026.')와 소수('12.5%')로 시작하는 일반 줄을 항목으로 오인하지 않게.
const TOP_RE = /^\s*(?:\((\d{1,3})\)|(\d{1,3})[.)](?!\d)|([①-⑳]))\s*(.*)$/
// 하위(2단계): '-' '-.' '·' '•' '▪' '*' '→' '▶'. 대시 뒤 숫자 금지 — '-15%' 같은 음수 보호.
const SUB_RE = /^\s*(?:-\.?(?!\d)|[·•▪*→▶])\s*(.*)$/
// 3단계: '.' + 공백 필수 — '.내용'(공백 없음)은 마커로 보지 않고 일반 줄로 보존.
const THIRD_RE = /^\s*\.\s+(.*)$/

type LineKind = 'top' | 'sub' | 'third' | 'plain' | 'blank'

function classify(line: string): { kind: LineKind; text: string } {
  if (line.trim() === '') return { kind: 'blank', text: '' }
  const top = line.match(TOP_RE)
  if (top) return { kind: 'top', text: top[4] }
  const sub = line.match(SUB_RE)
  if (sub) return { kind: 'sub', text: sub[1] }
  const third = line.match(THIRD_RE)
  if (third) return { kind: 'third', text: third[1] }
  return { kind: 'plain', text: line }
}

/** 셀 텍스트 정규화 — 스펙 규칙 1~7. 멱등(f(f(x)) === f(x)). */
export function normalizeCellText(text: string): string {
  const lines = text.split('\n').map(l => classify(l.replace(/\s+$/, '')))
  const hasTop = lines.some(l => l.kind === 'top')
  const out: string[] = []
  let n = 0
  for (const l of lines) {
    if (l.kind === 'blank') {
      // 상위 항목이 있으면 빈 줄은 전부 걷어내고 상위 항목 앞에서만 재삽입(아래).
      // 상위 항목이 없는 셀은 재배치 없이 공백 규칙만 — 연속 빈 줄을 1개로.
      if (!hasTop && out.length && out[out.length - 1] !== '') out.push('')
      continue
    }
    if (l.kind === 'top') {
      n += 1
      if (out.length) out.push('')
      out.push(l.text ? `${n}. ${l.text}` : `${n}.`)
    } else if (l.kind === 'sub') {
      out.push(l.text ? `  -. ${l.text}` : '  -.')
    } else if (l.kind === 'third') {
      out.push(l.text ? `    . ${l.text}` : '    .')
    } else {
      out.push(l.text)
    }
  }
  while (out.length && out[out.length - 1] === '') out.pop()
  return out.join('\n')
}

/** 미리보기·적용이 공유하는 변경 단위 — 적용은 after만 저장, before는 미리보기 표시용. */
export interface WeeklyFormatEdit {
  rowId: string
  cellKey: WeeklyCellKey
  section: string // 미리보기 행 라벨 — 구분, 없으면 모듈, 둘 다 없으면 '기타'(sheetNarrative.rowLabel과 동일 폴백)
  before: string
  after: string
}

/** 4개 내용 열 전부 정규화해 실제로 바뀌는 셀만 반환(변경 없으면 빈 배열). */
export function unifySheetRows(rows: WeeklySheetRow[]): WeeklyFormatEdit[] {
  const out: WeeklyFormatEdit[] = []
  for (const r of rows) {
    const label = r.section.trim() || r.module.trim() || '기타'
    for (const cellKey of WEEKLY_CELL_KEYS) {
      const before = r[CELL_FIELD[cellKey]]
      const after = normalizeCellText(before)
      if (after !== before) out.push({ rowId: r.id, cellKey, section: label, before, after })
    }
  }
  return out
}
