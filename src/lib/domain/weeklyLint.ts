/* ── 주간보고 점검(순수) — 중복·체번·공백 규칙과 수정 편집 생성. I/O 없음. ── */

import {
  CELL_FIELD, WEEKLY_CELL_KEYS, WEEKLY_CELL_LABEL,
  type WeeklyCellEdit, type WeeklyCellKey, type WeeklySheetRow,
} from './weeklySheet'

export type LintKind = 'duplicate' | 'numbering' | 'format'

export interface LintFinding {
  /** 안정 키(React list). 같은 지적이면 재계산해도 같은 값이어야 한다. */
  id: string
  kind: LintKind
  /** 클릭 시 이동할 대표 셀. 중복은 '삭제 대상' 중 sortOrder가 가장 작은 행. */
  rowId: string
  cellKey: WeeklyCellKey
  /** 목록 제목 — 예: `PMO · 금주실적 내용` */
  title: string
  /** 무엇이 문제이고 적용하면 어떻게 되는지 */
  detail: string
  /** 적용할 편집. 기존 배치 편집 단위를 그대로 쓴다. */
  edits: WeeklyCellEdit[]
}

/** 인정하는 글머리 기호. 배열 순서 = 다수결 동수 시 우선순위(- 우선). */
export const BULLETS = ['-', '·', '*', '●'] as const

/** 선두 줄 번호: 숫자 + (. 또는 )) + 뒤따르는 공백(없을 수도). */
const NUM_PREFIX = /^(\d+)([.)])( *)/
/** 글머리 기호로 인정하는 형태 — 기호 뒤에 공백이 반드시 온다.
 *  `-5%` 같은 본문을 기호로 오인해 고쳐 쓰지 않기 위한 보수적 판정. */
const BULLET_PREFIX = /^([-·*●])( +)(?=\S)/

/** 비교 전용 정규화 — 저장 값에는 영향이 없다. 기호·번호를 떼고 공백을 접어,
 *  `- 설계 리뷰 완료`와 `1. 설계  리뷰 완료`를 같은 줄로 보게 한다. */
export function normalizeForCompare(line: string): string {
  let s = line.replace(/　/g, ' ').trim()
  // 기호와 번호가 겹쳐 붙은 경우(`- 1. 항목`)까지 커버하되, 무한 반복은 막는다.
  for (let i = 0; i < 2; i++) {
    const next = s.replace(NUM_PREFIX, '').replace(/^[-·*●] */, '').trimStart()
    if (next === s) break
    s = next
  }
  return s.replace(/\s+/g, ' ').trim()
}

/** 화면 표시 순서(구분 순) 사본. 지적 목록의 정렬 근거이자 중복 규칙의 '남길 행' 기준. */
const byOrder = (rows: WeeklySheetRow[]): WeeklySheetRow[] =>
  [...rows].sort((a, b) => a.sortOrder - b.sortOrder)

/** 셀 값을 줄 배열로. 빈 문자열은 빈 배열(빈 줄 1개가 아니라). */
const toLines = (content: string): string[] => (content === '' ? [] : content.split('\n'))

/** 지정 인덱스의 줄을 지운 결과. 전부 공백만 남으면 빈 셀로 만든다. */
function removeLines(content: string, drop: ReadonlySet<number>): string {
  const kept = toLines(content).filter((_, i) => !drop.has(i))
  const joined = kept.join('\n')
  return joined.trim() === '' ? '' : joined
}

/** 규칙 ① — 같은 열에서 구분 행을 가로지르는 동일 줄. 같은 셀 안 중복은 대상이 아니다. */
export function lintDuplicates(rows: WeeklySheetRow[]): LintFinding[] {
  const ordered = byOrder(rows)
  const byId = new Map(ordered.map(r => [r.id, r]))
  const out: LintFinding[] = []

  for (const cellKey of WEEKLY_CELL_KEYS) {
    // 정규화 줄 → 등장 위치들. ordered 순회라 배열 앞쪽이 곧 sortOrder가 작은 쪽이다.
    const groups = new Map<string, { rowId: string; line: number }[]>()
    for (const row of ordered) {
      toLines(row[CELL_FIELD[cellKey]]).forEach((raw, line) => {
        const norm = normalizeForCompare(raw)
        if (!norm) return
        const hits = groups.get(norm)
        if (hits) hits.push({ rowId: row.id, line })
        else groups.set(norm, [{ rowId: row.id, line }])
      })
    }

    for (const [norm, hits] of groups) {
      const keepRowId = hits[0].rowId
      const victims = hits.filter(h => h.rowId !== keepRowId)
      if (victims.length === 0) continue // 한 구분 안에서만 반복 — 대상 아님

      // 행별로 지울 줄 번호를 모아 셀당 편집 1개로. victims는 ordered 순서를 물려받는다.
      const dropByRow = new Map<string, Set<number>>()
      for (const v of victims) {
        const s = dropByRow.get(v.rowId)
        if (s) s.add(v.line)
        else dropByRow.set(v.rowId, new Set([v.line]))
      }
      const edits: WeeklyCellEdit[] = [...dropByRow].map(([rowId, drop]) => ({
        rowId, cellKey, content: removeLines(byId.get(rowId)![CELL_FIELD[cellKey]], drop),
      }))

      const keepSection = byId.get(keepRowId)!.section
      const victimSections = [...dropByRow.keys()].map(id => byId.get(id)!.section)
      out.push({
        id: `duplicate:${cellKey}:${norm}`,
        kind: 'duplicate',
        rowId: edits[0].rowId,
        cellKey,
        title: WEEKLY_CELL_LABEL[cellKey],
        detail: `${[keepSection, ...victimSections].join(' · ')}에 같은 줄이 있습니다: "${norm}" — ${victimSections.join(' · ')}에서 이 줄을 지웁니다.`,
        edits,
      })
    }
  }
  return out
}

/** 규칙 ② — 셀 안 줄 번호. 번호 줄이 2개 이상일 때만 검사하고, 1부터 1씩 증가하지 않으면 지적. */
export function lintNumbering(rows: WeeklySheetRow[]): LintFinding[] {
  const ordered = byOrder(rows)
  const out: LintFinding[] = []
  for (const cellKey of WEEKLY_CELL_KEYS) {
    for (const row of ordered) {
      const content = row[CELL_FIELD[cellKey]]
      const lines = toLines(content)
      const numbered = lines
        .map((line, i) => ({ i, m: NUM_PREFIX.exec(line.trimStart()) }))
        .filter((x): x is { i: number; m: RegExpExecArray } => x.m !== null)
      if (numbered.length < 2) continue

      const nums = numbered.map(x => Number(x.m[1]))
      if (nums.every((n, k) => n === k + 1)) continue

      // 첫 번호 줄의 표기(구분자, 구분자 뒤 공백)를 나머지에 그대로 적용한다.
      const sep = numbered[0].m[2]
      const gap = numbered[0].m[3]
      const next = [...lines]
      numbered.forEach((x, k) => {
        const line = lines[x.i]
        const indent = line.slice(0, line.length - line.trimStart().length)
        const rest = line.trimStart().slice(x.m[0].length)
        next[x.i] = `${indent}${k + 1}${sep}${gap}${rest}`
      })

      out.push({
        id: `numbering:${row.id}:${cellKey}`,
        kind: 'numbering',
        rowId: row.id,
        cellKey,
        title: `${row.section} · ${WEEKLY_CELL_LABEL[cellKey]}`,
        detail: `줄 번호가 ${nums.join(', ')} 입니다 → ${nums.map((_, k) => k + 1).join(', ')}`,
        edits: [{ rowId: row.id, cellKey, content: next.join('\n') }],
      })
    }
  }
  return out
}

/** 시트 전체에서 가장 많이 쓰인 글머리 기호. 종류가 하나뿐이면 통일할 것이 없으므로 null. */
function dominantBullet(rows: WeeklySheetRow[]): string | null {
  const count = new Map<string, number>()
  for (const row of rows) {
    for (const cellKey of WEEKLY_CELL_KEYS) {
      for (const line of toLines(row[CELL_FIELD[cellKey]])) {
        const m = BULLET_PREFIX.exec(line.replace(/　/g, ' ').trimStart())
        if (m) count.set(m[1], (count.get(m[1]) ?? 0) + 1)
      }
    }
  }
  if (count.size < 2) return null
  // BULLETS 순서로 훑으며 최대값 — 동수면 먼저 나온 기호(-)가 이긴다.
  let best: string = BULLETS[0]
  let bestN = -1
  for (const b of BULLETS) {
    const n = count.get(b) ?? 0
    if (n > bestN) { best = b; bestN = n }
  }
  return best
}

interface FormatResult { next: string; notes: string[] }

/** 셀 1개의 공백·빈줄·기호 정리. 바뀐 것이 없으면 notes가 빈 배열. */
function formatCell(content: string, bullet: string | null): FormatResult {
  let fullwidth = 0, trailing = 0, multiSpace = 0, bulletFixed = 0, blank = 0

  const cleaned = toLines(content).map(line => {
    let s = line
    if (s.includes('　')) { fullwidth++; s = s.replace(/　/g, ' ') }
    if (/\s+$/.test(s)) { trailing++; s = s.replace(/\s+$/, '') }
    // 들여쓰기(줄 맨 앞 공백)는 보존하려고 앞에 \S를 요구한다.
    const collapsed = s.replace(/(\S) {2,}/g, '$1 ')
    if (collapsed !== s) { multiSpace++; s = collapsed }
    if (bullet) {
      const head = s.trimStart()
      const m = BULLET_PREFIX.exec(head)
      if (m && m[1] !== bullet) {
        bulletFixed++
        s = s.slice(0, s.length - head.length) + bullet + head.slice(1)
      }
    }
    return s
  })

  // 선두/연속 빈 줄 정리 후, 남은 후행 빈 줄 제거.
  const out: string[] = []
  for (const line of cleaned) {
    if (line.trim() === '') {
      if (out.length === 0 || out[out.length - 1].trim() === '') { blank++; continue }
      out.push('')
      continue
    }
    out.push(line)
  }
  while (out.length > 0 && out[out.length - 1].trim() === '') { out.pop(); blank++ }

  const notes: string[] = []
  if (trailing > 0) notes.push(`줄 끝 공백 ${trailing}곳`)
  if (multiSpace > 0) notes.push(`연속 공백 ${multiSpace}곳`)
  if (fullwidth > 0) notes.push(`전각 공백 ${fullwidth}곳`)
  if (blank > 0) notes.push(`빈 줄 ${blank}곳`)
  if (bulletFixed > 0) notes.push(`글머리 기호 → ${bullet}`)

  return { next: out.join('\n'), notes }
}

/** 규칙 ③ — 공백·빈줄·글머리 기호. 셀당 지적 1건. */
export function lintFormat(rows: WeeklySheetRow[]): LintFinding[] {
  const bullet = dominantBullet(rows)
  const ordered = byOrder(rows)
  const out: LintFinding[] = []
  for (const cellKey of WEEKLY_CELL_KEYS) {
    for (const row of ordered) {
      const content = row[CELL_FIELD[cellKey]]
      const { next, notes } = formatCell(content, bullet)
      if (next === content || notes.length === 0) continue
      out.push({
        id: `format:${row.id}:${cellKey}`,
        kind: 'format',
        rowId: row.id,
        cellKey,
        title: `${row.section} · ${WEEKLY_CELL_LABEL[cellKey]}`,
        detail: notes.join(', '),
        edits: [{ rowId: row.id, cellKey, content: next }],
      })
    }
  }
  return out
}

/** 점검 진입점. 세 규칙의 결과를 부류 순서로 이어붙인다.
 *  각 규칙이 이미 열 바깥/행(sortOrder) 안쪽으로 순회하므로 부류 안 정렬은 그대로 유지된다. */
export function lintWeeklySheet(rows: WeeklySheetRow[]): LintFinding[] {
  return [...lintDuplicates(rows), ...lintNumbering(rows), ...lintFormat(rows)]
}
