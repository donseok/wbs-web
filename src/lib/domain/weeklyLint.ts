/* ── 주간보고 점검(순수) — 중복·체번·공백 규칙과 수정 편집 생성. I/O 없음.
 *  모든 규칙은 **구분 안에서만** 본다. PMO의 줄과 영업의 줄을 견주는 일은 없다 —
 *  구분마다 담당이 다르고, 같은 문구가 두 구분에 있는 것은 보고서상 정상이기 때문이다.
 *  (예외: 글머리 기호 통일만 보고서 겉모습 문제라 시트 전체 다수결을 따른다.) ── */

import {
  CELL_FIELD, sectionKeyOf, WEEKLY_CELL_KEYS, WEEKLY_CELL_LABEL,
  type WeeklyCellEdit, type WeeklyCellKey, type WeeklySheetRow,
} from './weeklySheet'

export type LintKind = 'duplicate' | 'numbering' | 'format'

export interface LintFinding {
  /** 안정 키(React list). 같은 지적이면 재계산해도 같은 값이어야 한다. */
  id: string
  kind: LintKind
  /** 지적이 속한 구분. 점검 단위이자 패널의 묶음 기준 — 이 값을 넘나드는 지적은 없다. */
  section: string
  /** 클릭 시 이동할 대표 셀. 중복은 '삭제 대상' 중 sortOrder가 가장 작은 행. */
  rowId: string
  cellKey: WeeklyCellKey
  /** 목록 제목 — 열 이름만. 구분은 section이 따로 들고 패널이 머리글로 보여준다. */
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

/** 점검의 유일한 단위 — 구분별 묶음. 화면 표시 순서(sortOrder)를 그대로 물려받으므로
 *  묶음 순서 = 구분 순서, 묶음 안 행 순서 = 화면 순서(중복 규칙의 '남길 행' 기준)다.
 *  묶음 키는 PPT 페이지 단위와 같은 sectionKeyOf다 — 레거시 시트에서 section이 ERP 하나로
 *  뭉뚱그려진 영업·구매·관리회계를 서로 견주지 않으려면 모듈까지 봐야 하고, 반대로 PPT가 한 장에
 *  싣는 행들은 점검도 한 묶음으로 봐야 '점검 통과한 시트가 PPT에서 중복'인 상태가 생기지 않는다.
 *  표준 시트는 구분당 1행이지만, 한 구분에 행이 여럿이면(옛 시트·백업 백필) 그 행들이 한 묶음이 된다.
 *  이월(carryOverRows)이 합치는 단위(mapLegacySection: FI/TR+CO → 관리회계)와는 다르다 —
 *  옛 시트에서 갈라 본 두 모듈이 이월 뒤 한 셀로 합쳐지면, 그때 새 시트에서 중복으로 잡힌다.
 *  같은 구분 행이 떨어져 있어도 하나로 모은다 — 인접 여부가 아니라 이름이 기준이다. */
interface SectionGroup { section: string; rows: WeeklySheetRow[] }

function bySection(rows: WeeklySheetRow[]): SectionGroup[] {
  const out: SectionGroup[] = []
  const at = new Map<string, number>()
  for (const row of [...rows].sort((a, b) => a.sortOrder - b.sortOrder)) {
    const section = sectionKeyOf(row)
    const i = at.get(section)
    if (i === undefined) { at.set(section, out.length); out.push({ section, rows: [row] }) }
    else out[i].rows.push(row)
  }
  return out
}

/** 셀 값을 줄 배열로. 빈 문자열은 빈 배열(빈 줄 1개가 아니라). */
const toLines = (content: string): string[] => (content === '' ? [] : content.split('\n'))

/** 선두·연속·후행 빈 줄 정리. 문단을 가르는 빈 줄 1개는 남긴다(정리 규칙의 정책 그대로). */
function tidyBlankLines(lines: readonly string[]): { kept: string[]; removed: number } {
  const kept: string[] = []
  let removed = 0
  for (const line of lines) {
    if (line.trim() === '') {
      if (kept.length === 0 || kept[kept.length - 1].trim() === '') { removed++; continue }
      kept.push('')
      continue
    }
    kept.push(line)
  }
  while (kept.length > 0 && kept[kept.length - 1].trim() === '') { kept.pop(); removed++ }
  return { kept, removed }
}

/** 지정 인덱스의 줄을 지운 결과. 지운 자리에 남는 빈 줄까지 함께 정리한다 —
 *  그러지 않으면 중복을 고치자마자 그 빈 줄이 '정리' 지적으로 되돌아와 두 번 눌러야 한다. */
function removeLines(content: string, drop: ReadonlySet<number>): string {
  return tidyBlankLines(toLines(content).filter((_, i) => !drop.has(i))).kept.join('\n')
}

/** 지울 자리 표기 — 한 행 안이면 몇 번째 줄인지까지, 여러 행에 걸치면 행 수까지만. */
function victimsWhere(victims: readonly { rowId: string; line: number }[]): string {
  const rows = new Set(victims.map(v => v.rowId))
  if (rows.size > 1) return `${rows.size}개 행에서 ${victims.length}줄`
  return `${victims.map(v => v.line + 1).join('·')}번째 줄`
}

/** 줄 앞 공백 길이(들여쓰기 깊이). 전각 공백·탭도 공백으로 센다. */
const indentOf = (line: string): number => line.length - line.trimStart().length

/** 그 셀에서 '항목' 줄로 볼 깊이 = 내용 있는 줄의 최소 들여쓰기. 셀 전체를 들여 쓴 사람도 있으므로
 *  0이 아니라 최소값을 기준으로 삼는다. 내용이 없으면 아무 줄도 대상이 아니다. */
function topLevelIndent(lines: readonly string[]): number {
  let min = Infinity
  for (const line of lines) {
    if (line.trim() === '') continue
    const d = indentOf(line)
    if (d < min) min = d
  }
  return min
}

/** 규칙 ① — **한 구분·한 열 안에서** 되풀이되는 줄. 같은 셀 안 반복도, 그 구분에 행이 여럿일 때
 *  행을 가로지르는 반복도 대상이다. 구분이 다르면 글자가 같아도 서로 남남이다.
 *
 *  단, **들여쓴 줄은 검사에서 뺀다.** 비교는 글머리·번호를 떼고 하기 때문에, 항목마다 달아 둔
 *  `- 완료` 같은 상태줄이 서로 '같은 줄'로 보여 뒤쪽 항목의 상태줄이 통째로 지워진다.
 *  들여쓴 줄은 바로 위 항목에 딸린 것이라 문맥이 다르다 — 같은 글자여도 중복이 아니다. */
export function lintDuplicates(rows: WeeklySheetRow[]): LintFinding[] {
  const out: LintFinding[] = []

  for (const { section, rows: group } of bySection(rows)) {
    const byId = new Map(group.map(r => [r.id, r]))

    for (const cellKey of WEEKLY_CELL_KEYS) {
      // 정규화 줄 → 등장 위치들. 묶음이 sortOrder 순이라 배열 앞쪽이 곧 화면에서 위쪽이다.
      const groups = new Map<string, { rowId: string; line: number }[]>()
      for (const row of group) {
        const lines = toLines(row[CELL_FIELD[cellKey]])
        const top = topLevelIndent(lines)
        lines.forEach((raw, line) => {
          if (indentOf(raw) > top) return // 상위 항목에 딸린 줄 — 아래 주석 참조
          const norm = normalizeForCompare(raw)
          if (!norm) return
          const hits = groups.get(norm)
          if (hits) hits.push({ rowId: row.id, line })
          else groups.set(norm, [{ rowId: row.id, line }])
        })
      }

      for (const [norm, hits] of groups) {
        if (hits.length < 2) continue
        const victims = hits.slice(1) // 맨 처음 등장만 남긴다

        // 행별로 지울 줄 번호를 모아 셀당 편집 1개로. victims는 묶음 순서를 물려받는다.
        const dropByRow = new Map<string, Set<number>>()
        for (const v of victims) {
          const s = dropByRow.get(v.rowId)
          if (s) s.add(v.line)
          else dropByRow.set(v.rowId, new Set([v.line]))
        }
        const edits: WeeklyCellEdit[] = [...dropByRow].map(([rowId, drop]) => ({
          rowId, cellKey, content: removeLines(byId.get(rowId)![CELL_FIELD[cellKey]], drop),
        }))

        out.push({
          // 구분이 키에 들어가야 두 구분에서 같은 줄이 반복돼도 지적 id가 부딪히지 않는다.
          id: `duplicate:${section}:${cellKey}:${norm}`,
          kind: 'duplicate',
          section,
          rowId: edits[0].rowId,
          cellKey,
          title: WEEKLY_CELL_LABEL[cellKey],
          // 어느 줄이 사라지는지 적용 '전에' 보이게 한다 — 셀 안 반복까지 잡게 된 뒤로는
          // 지울 줄을 눈으로 고르지 못하면 사용자가 되돌릴 수 없는 삭제에 동의하는 셈이 된다.
          detail: `같은 줄이 ${hits.length}번 있습니다: "${norm}" — ${victimsWhere(victims)}을 지웁니다(남는 빈 줄도 함께 정리).`,
          edits,
        })
      }
    }
  }
  return out
}

/** 규칙 ② — 셀 안 줄 번호. 번호 줄이 2개 이상일 때만 검사하고, 1부터 1씩 증가하지 않으면 지적.
 *  셀 하나가 검사 범위라 애초에 구분을 넘지 않는다. 순회만 구분 순으로 맞춰 목록 순서를 통일한다. */
export function lintNumbering(rows: WeeklySheetRow[]): LintFinding[] {
  const out: LintFinding[] = []
  for (const { section, rows: group } of bySection(rows)) {
    for (const row of group) {
      for (const cellKey of WEEKLY_CELL_KEYS) {
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
          section,
          rowId: row.id,
          cellKey,
          title: WEEKLY_CELL_LABEL[cellKey],
          detail: `줄 번호가 ${nums.join(', ')} 입니다 → ${nums.map((_, k) => k + 1).join(', ')}`,
          edits: [{ rowId: row.id, cellKey, content: next.join('\n') }],
        })
      }
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

  const { kept: out, removed } = tidyBlankLines(cleaned)
  blank += removed

  const notes: string[] = []
  if (trailing > 0) notes.push(`줄 끝 공백 ${trailing}곳`)
  if (multiSpace > 0) notes.push(`연속 공백 ${multiSpace}곳`)
  if (fullwidth > 0) notes.push(`전각 공백 ${fullwidth}곳`)
  if (blank > 0) notes.push(`빈 줄 ${blank}곳`)
  // '시트 전체 기준'을 밝혀 둔다 — 자기 구분 안에서는 기호가 일관된 셀도 여기서 지적되기 때문에,
  // 근거를 적지 않으면 "우리 구분엔 ·밖에 없는데 왜?"가 되고 지적이 버그로 읽힌다.
  if (bulletFixed > 0) notes.push(`글머리 기호 → ${bullet} (시트 전체 기준)`)

  return { next: out.join('\n'), notes }
}

/** 규칙 ③ — 공백·빈줄·글머리 기호. 셀당 지적 1건.
 *  공백·빈줄은 셀 안 문제라 구분과 무관하고, 글머리 기호만 보고서 겉모습을 맞추려고
 *  시트 전체 다수결을 기준으로 삼는다(구분별 다수결이 아니다 — 의도된 유일한 예외). */
export function lintFormat(rows: WeeklySheetRow[]): LintFinding[] {
  const bullet = dominantBullet(rows)
  const out: LintFinding[] = []
  for (const { section, rows: group } of bySection(rows)) {
    for (const row of group) {
      for (const cellKey of WEEKLY_CELL_KEYS) {
        const content = row[CELL_FIELD[cellKey]]
        const { next, notes } = formatCell(content, bullet)
        if (next === content || notes.length === 0) continue
        out.push({
          id: `format:${row.id}:${cellKey}`,
          kind: 'format',
          section,
          rowId: row.id,
          cellKey,
          title: WEEKLY_CELL_LABEL[cellKey],
          detail: notes.join(', '),
          edits: [{ rowId: row.id, cellKey, content: next }],
        })
      }
    }
  }
  return out
}

/** 목록 안 정렬 우선순위 — 같은 구분 안에서 중대한 것(중복)부터. */
const KIND_ORDER: Record<LintKind, number> = { duplicate: 0, numbering: 1, format: 2 }

/** 점검 진입점. 목록 순서는 **구분 → 부류 → 행 → 열**이다.
 *  부류를 바깥에 두고 이어붙이기만 하면, 위쪽 구분에 정리 지적만 있고 아래쪽 구분에 중복 지적이
 *  있을 때 아래 구분이 목록 맨 앞으로 올라와 화면(시트) 순서와 어긋난다. 행·열까지 정렬 키에 넣는
 *  것은 중복 규칙만 열 바깥으로 도는 탓 — 한 구분에 행이 여럿이면 그 부류만 순서가 튄다. */
export function lintWeeklySheet(rows: WeeklySheetRow[]): LintFinding[] {
  const sectionRank = new Map(bySection(rows).map((g, i) => [g.section, i]))
  const rowRank = new Map(rows.map(r => [r.id, r.sortOrder]))
  const cellRank = new Map(WEEKLY_CELL_KEYS.map((k, i) => [k, i]))
  const at = (f: LintFinding) => sectionRank.get(f.section) ?? sectionRank.size
  return [...lintDuplicates(rows), ...lintNumbering(rows), ...lintFormat(rows)]
    .sort((a, b) =>
      at(a) - at(b)
      || KIND_ORDER[a.kind] - KIND_ORDER[b.kind]
      || (rowRank.get(a.rowId) ?? 0) - (rowRank.get(b.rowId) ?? 0)
      || cellRank.get(a.cellKey)! - cellRank.get(b.cellKey)!)
}
