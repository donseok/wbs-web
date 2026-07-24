/* ── 주간보고 점검(순수) — 중복(완전·유사)·체번·글머리 기호 규칙과 수정 편집 생성. I/O 없음.
 *  공백·빈 줄은 점검하지 않는다(사용자 결정, 2026-07-24) — tidyBlankLines 가 남아 있는 것은
 *  검사가 아니라 중복 삭제가 남긴 빈 줄을 치우는 수정의 뒤처리이기 때문이다.
 *  모든 규칙은 **구분 안에서만** 본다. PMO의 줄과 영업의 줄을 견주는 일은 없다 —
 *  구분마다 담당이 다르고, 같은 문구가 두 구분에 있는 것은 보고서상 정상이기 때문이다.
 *  (예외: 글머리 기호 통일만 보고서 겉모습 문제라 시트 전체 다수결을 따른다.) ── */

import {
  CELL_FIELD, sectionKeyOf, WEEKLY_CELL_KEYS, WEEKLY_CELL_LABEL,
  type WeeklyCellEdit, type WeeklyCellKey, type WeeklySheetRow,
} from './weeklySheet'

export type LintKind = 'duplicate' | 'nearDuplicate' | 'numbering' | 'format'

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

/** 선두 목록 번호: 숫자 1~2자리 + (. 또는 )) + 공백(반각·탭·전각) 0개 이상. */
const NUM_PREFIX = /^(\d{1,2})([.)])([ \t　]*)/

/** 목록 번호 해석 결과. rest는 표기 뒤 본문 — 빈 문자열이면 애초에 번호 줄이 아니다. */
interface ListNum { num: number; sep: '.' | ')'; gap: string; rest: string }

/** 들여쓰기를 뗀 줄머리에서 목록 번호를 해석한다. 번호 줄이 아니면 null.
 *  `1.` 단독(본문 없음)과 공백 없이 숫자가 이어지는 꼴(`2026.07.24` 날짜, `1.5배` 소수,
 *  `1.2 개요` 절 번호)은 번호 줄이 아니다 — 본문을 번호로 오인해 고쳐 쓰지 않기 위한
 *  보수적 판정. 자리수 상한(2자리)도 같은 목적의 이중 안전장치다.
 *  다수결 집계·체번 수정·중복 비교(normalizeForCompare)가 이 술어 하나를 공유한다 —
 *  갈라지면 "집계엔 세는데 수정에선 빠지는" 어긋남이 생긴다(글머리 기호 규칙에서 배운 것). */
function parseListNum(head: string): ListNum | null {
  const m = NUM_PREFIX.exec(head)
  if (!m) return null
  const rest = head.slice(m[0].length)
  if (rest === '') return null
  if (m[3] === '' && /^\d/.test(rest)) return null
  return { num: Number(m[1]), sep: m[2] as '.' | ')', gap: m[3], rest }
}
/** 글머리 기호로 인정하는 형태 — 기호 뒤에 공백이 반드시 온다.
 *  `-5%` 같은 본문을 기호로 오인해 고쳐 쓰지 않기 위한 보수적 판정. */
const BULLET_PREFIX = /^([-·*●])( +)(?=\S)/

/** 비교 전용 정규화 — 저장 값에는 영향이 없다. 기호·번호를 떼고 공백을 접어,
 *  `- 설계 리뷰 완료`와 `1. 설계  리뷰 완료`를 같은 줄로 보게 한다. */
export function normalizeForCompare(line: string): string {
  let s = line.replace(/　/g, ' ').trim()
  // 기호와 번호가 겹쳐 붙은 경우(`- 1. 항목`)까지 커버하되, 무한 반복은 막는다.
  for (let i = 0; i < 2; i++) {
    const ln = parseListNum(s)
    const next = (ln ? ln.rest : s).replace(/^[-·*●] */, '').trimStart()
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

/** 유사 중복 문턱. 이 값 이상이면 '90% 이상 동일'로 지적한다(완전 동일은 규칙 ①의 몫). */
export const NEAR_DUPLICATE_THRESHOLD = 0.9

function levenshtein(a: string, b: string): number {
  const la = a.length, lb = b.length
  if (la === 0) return lb
  if (lb === 0) return la
  let prev: number[] = Array.from({ length: lb + 1 }, (_, j) => j)
  let cur: number[] = new Array(lb + 1)
  for (let i = 1; i <= la; i++) {
    cur[0] = i
    const ca = a.charCodeAt(i - 1)
    for (let j = 1; j <= lb; j++) {
      const cost = ca === b.charCodeAt(j - 1) ? 0 : 1
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost)
    }
    ;[prev, cur] = [cur, prev]
  }
  return prev[lb]
}

/** 두 정규화 줄의 유사도(0~1) — 1 - 편집거리/긴쪽 길이. '90% 이상 동일'의 판정 그 자체다. */
export function lineSimilarity(a: string, b: string): number {
  if (a === b) return 1
  const max = Math.max(a.length, b.length)
  if (max === 0) return 1
  return 1 - levenshtein(a, b) / max
}

/** 규칙 ①-b — **한 구분·한 열 안에서** 90% 이상 비슷하지만 완전히 같지는 않은 줄들.
 *  범위·들여쓰기 제외는 규칙 ①과 같다. 완전 동일은 정규화 키가 같아 여기 오지 않는다
 *  (첫 등장만 견주므로).
 *
 *  지적 단위는 쌍이 아니라 **군집(연결 요소)**이다 — 비슷한 템플릿 줄 k개를 쌍마다 지적하면
 *  k(k-1)/2 건으로 불어나 목록이 잠긴다. 유사도는 추이적이지 않지만(A~B·B~C여도 A~C는
 *  아닐 수 있다) 정리할 줄들을 한 지적에 모아 보여주는 단위로는 연결 요소가 맞다.
 *
 *  **자동 수정은 없다(edits 빈 배열).** 완전 동일은 어느 줄을 지워도 결과가 같지만,
 *  유사한 두 줄은 다르다 — "진행 중 60%"와 "진행 중 70%"에서 남길 쪽은 사람만 안다.
 *  기계가 앞줄을 지우면 최신 값이, 뒷줄을 지우면 정정된 값이 사라질 수 있다.
 *  그래서 이 지적은 위치를 보여 주고 셀로 데려가는 데서 멈춘다. */
export function lintNearDuplicates(rows: WeeklySheetRow[]): LintFinding[] {
  const out: LintFinding[] = []

  for (const { section, rows: group } of bySection(rows)) {
    for (const cellKey of WEEKLY_CELL_KEYS) {
      // 정규화 줄의 첫 등장만 모은다. 같은 줄의 2번째 이후 등장은 규칙 ①이 지운다.
      const firsts: { norm: string; rowId: string; line: number }[] = []
      const seen = new Set<string>()
      for (const row of group) {
        const lines = toLines(row[CELL_FIELD[cellKey]])
        const top = topLevelIndent(lines)
        lines.forEach((raw, line) => {
          if (indentOf(raw) > top) return
          const norm = normalizeForCompare(raw)
          if (!norm || seen.has(norm)) return
          seen.add(norm)
          firsts.push({ norm, rowId: row.id, line })
        })
      }

      // 문턱을 넘는 쌍을 간선으로 모은다.
      const edges: { i: number; j: number; sim: number }[] = []
      for (let i = 0; i < firsts.length; i++) {
        for (let j = i + 1; j < firsts.length; j++) {
          const a = firsts[i].norm, b = firsts[j].norm
          const max = Math.max(a.length, b.length)
          // 길이 차이만으로 문턱 미달인 쌍은 편집거리 계산을 건너뛴다 — n² 비교의 흔한 탈락 경로.
          // 판정과 같은 산식(1 - 차이/긴쪽)으로 비교해야 한다. `차이/긴쪽 > 0.1` 꼴로 쓰면
          // 부동소수점 오차(1/10 > 1-0.9) 탓에 정확히 90%인 삽입/삭제 쌍이 경계에서 떨어져 나간다.
          if (1 - Math.abs(a.length - b.length) / max < NEAR_DUPLICATE_THRESHOLD) continue
          const sim = lineSimilarity(a, b)
          if (sim < NEAR_DUPLICATE_THRESHOLD) continue
          edges.push({ i, j, sim })
        }
      }
      if (edges.length === 0) continue

      // 연결 요소로 묶는다(경로 압축 union-find).
      const parent = firsts.map((_, i) => i)
      const find = (x: number): number => (parent[x] === x ? x : (parent[x] = find(parent[x])))
      for (const e of edges) { const a = find(e.i), b = find(e.j); if (a !== b) parent[a] = b }
      const byRoot = new Map<number, number[]>()
      firsts.forEach((_, i) => {
        const r = find(i)
        const m = byRoot.get(r)
        if (m) m.push(i)
        else byRoot.set(r, [i])
      })

      for (const members of byRoot.values()) {
        if (members.length < 2) continue // 간선 없는 홀로 줄
        const ms = members.map(i => firsts[i]) // members 는 첫 등장 순서(오름차순 인덱스)
        const rowIds = new Set(ms.map(m => m.rowId))

        let detail: string
        if (ms.length === 2) {
          const [a, b] = ms
          const sim = edges.find(e => e.i === members[0] && e.j === members[1])!.sim
          // floor 를 쓴다 — 89.6% 를 반올림해 '90% 일치'로 적으면 문턱 미달이 문턱 문구를 달게 된다.
          const where = rowIds.size > 1
            ? '2개 행에 걸쳐 있음'
            : `${a.line + 1}번째 줄과 ${b.line + 1}번째 줄`
          detail = `비슷한 줄이 있습니다(${Math.floor(sim * 100)}% 일치): "${a.norm}" ↔ "${b.norm}" — ${where}. 같은 내용이면 한쪽을 지워 정리하세요(자동 수정 없음).`
        } else {
          // 군집이 크면 쌍마다 일치율이 달라 하나로 적을 수 없다 — 문턱만 밝힌다.
          const quoted = ms.slice(0, 3).map(m => `"${m.norm}"`).join(' ↔ ')
          const more = ms.length > 3 ? ` 외 ${ms.length - 3}줄` : ''
          const where = rowIds.size > 1
            ? `${rowIds.size}개 행에 걸쳐 있음`
            : `${ms.map(m => m.line + 1).join('·')}번째 줄`
          detail = `서로 ${Math.round(NEAR_DUPLICATE_THRESHOLD * 100)}% 이상 비슷한 줄이 ${ms.length}개 있습니다: ${quoted}${more} — ${where}. 같은 내용이면 하나만 남기고 정리하세요(자동 수정 없음).`
        }

        out.push({
          // JSON 직렬화로 구분한다 — 본문에 흔한 '~'(기간 표기) 같은 문자를 구분자로 쓰면
          // 서로 다른 두 지적이 같은 id 로 뭉갤 수 있다.
          id: `nearDuplicate:${section}:${cellKey}:${JSON.stringify(ms.map(m => m.norm))}`,
          kind: 'nearDuplicate',
          section,
          // 이동 목표는 맨 뒤에 등장한 줄 — 대개 나중에 붙여 넣거나 고쳐 쓴 쪽이라 볼 확률이 높다.
          rowId: ms[ms.length - 1].rowId,
          cellKey,
          title: WEEKLY_CELL_LABEL[cellKey],
          detail,
          edits: [],
        })
      }
    }
  }
  return out
}

/** 시트 전체에서 다수결로 정한 번호 구분자. 번호 줄이 없으면 null(규칙 전체 침묵).
 *  보고서 겉모습 문제라 글머리 기호처럼 시트 전체 기준이고, 동수면 . 이 이긴다.
 *  한 종류뿐이어도 그 값을 반환한다 — 그 표기를 존중하되 공백 정규화의 기준으로 쓴다. */
function dominantNumberSep(rows: WeeklySheetRow[]): '.' | ')' | null {
  let dot = 0, paren = 0
  for (const row of rows) {
    for (const cellKey of WEEKLY_CELL_KEYS) {
      for (const line of toLines(row[CELL_FIELD[cellKey]])) {
        const ln = parseListNum(line.trimStart())
        if (!ln) continue
        if (ln.sep === '.') dot++
        else paren++
      }
    }
  }
  if (dot === 0 && paren === 0) return null
  return dot >= paren ? '.' : ')'
}

/** 규칙 ② — 셀 안 줄 번호: 체번 + 표기. 재부여는 기존대로 번호 줄 2개 이상이면서
 *  1..n 이 아닐 때만 하고, 표기(구분자 시트 다수결·번호 뒤 공백 1칸)는 번호 줄 1개부터
 *  맞춘다. 구분자만 시트 전체 기준이다(구분 단위 원칙의 의도된 예외 — 글머리 기호와 동일).
 *  순서와 표기를 한 규칙이 소유해야 같은 줄을 두 지적이 서로 다르게 고치는 충돌이 없다. */
export function lintNumbering(rows: WeeklySheetRow[]): LintFinding[] {
  const sep = dominantNumberSep(rows)
  if (sep === null) return []
  const out: LintFinding[] = []
  for (const { section, rows: group } of bySection(rows)) {
    for (const row of group) {
      for (const cellKey of WEEKLY_CELL_KEYS) {
        const content = row[CELL_FIELD[cellKey]]
        const lines = toLines(content)
        const numbered = lines
          .map((line, i) => ({ i, ln: parseListNum(line.trimStart()) }))
          .filter((x): x is { i: number; ln: ListNum } => x.ln !== null)
        if (numbered.length === 0) continue

        const nums = numbered.map(x => x.ln.num)
        const renumber = numbered.length >= 2 && !nums.every((n, k) => n === k + 1)

        // 구분자가 바뀌는 줄은 공백도 함께 다시 쓰이므로 else if — 표기 노트가 공백 노트를 포괄한다.
        let sepFixed = 0, gapFixed = 0
        const next = [...lines]
        numbered.forEach((x, k) => {
          const line = lines[x.i]
          const indent = line.slice(0, line.length - line.trimStart().length)
          if (x.ln.sep !== sep) sepFixed++
          else if (x.ln.gap !== ' ') gapFixed++
          next[x.i] = `${indent}${renumber ? k + 1 : x.ln.num}${sep} ${x.ln.rest}`
        })
        if (!renumber && sepFixed === 0 && gapFixed === 0) continue

        const notes: string[] = []
        if (renumber) notes.push(`줄 번호가 ${nums.join(', ')} 입니다 → ${nums.map((_, k) => k + 1).join(', ')}`)
        if (sepFixed > 0) notes.push(`번호 표기 → '1${sep}' (시트 전체 기준)`)
        else if (gapFixed > 0) notes.push('번호 뒤 공백 → 1칸')

        out.push({
          id: `numbering:${row.id}:${cellKey}`,
          kind: 'numbering',
          section,
          rowId: row.id,
          cellKey,
          title: WEEKLY_CELL_LABEL[cellKey],
          detail: notes.join(', '),
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

/** 셀 1개의 글머리 기호 통일. 바뀐 것이 없으면 notes가 빈 배열.
 *  줄 끝 공백·연속 공백·전각 공백·빈 줄은 더 이상 손대지 않는다(파일 머리 주석의 사용자 결정). */
function formatCell(content: string, bullet: string | null): FormatResult {
  if (!bullet) return { next: content, notes: [] }
  let bulletFixed = 0

  const out = toLines(content).map(line => {
    const head = line.trimStart()
    // 판정만 전각 공백을 반각으로 보고 한다 — dominantBullet 의 집계와 같은 눈이어야
    // '· 다(전각 공백)' 가 다수결에는 세어지고 통일에서는 빠지는 어긋남이 없다. 줄 자체는 바꾸지 않는다.
    const m = BULLET_PREFIX.exec(head.replace(/　/g, ' '))
    if (!m || m[1] === bullet) return line
    bulletFixed++
    return line.slice(0, line.length - head.length) + bullet + head.slice(1)
  })

  // '시트 전체 기준'을 밝혀 둔다 — 자기 구분 안에서는 기호가 일관된 셀도 여기서 지적되기 때문에,
  // 근거를 적지 않으면 "우리 구분엔 ·밖에 없는데 왜?"가 되고 지적이 버그로 읽힌다.
  const notes = bulletFixed > 0 ? [`글머리 기호 → ${bullet} (시트 전체 기준)`] : []
  return { next: out.join('\n'), notes }
}

/** 규칙 ③ — 글머리 기호 통일. 셀당 지적 1건.
 *  보고서 겉모습을 맞추는 검사라 시트 전체 다수결을 기준으로 삼는다
 *  (구분별 다수결이 아니다 — 구분 단위 원칙의 의도된 유일한 예외). */
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

/** 목록 안 정렬 우선순위 — 같은 구분 안에서 중대한 것(중복)부터. 유사 중복은 완전 중복 바로 뒤. */
const KIND_ORDER: Record<LintKind, number> = { duplicate: 0, nearDuplicate: 1, numbering: 2, format: 3 }

/** 점검 진입점. 목록 순서는 **구분 → 부류 → 행 → 열**이다.
 *  부류를 바깥에 두고 이어붙이기만 하면, 위쪽 구분에 정리 지적만 있고 아래쪽 구분에 중복 지적이
 *  있을 때 아래 구분이 목록 맨 앞으로 올라와 화면(시트) 순서와 어긋난다. 행·열까지 정렬 키에 넣는
 *  것은 중복 규칙만 열 바깥으로 도는 탓 — 한 구분에 행이 여럿이면 그 부류만 순서가 튄다. */
export function lintWeeklySheet(rows: WeeklySheetRow[]): LintFinding[] {
  const sectionRank = new Map(bySection(rows).map((g, i) => [g.section, i]))
  const rowRank = new Map(rows.map(r => [r.id, r.sortOrder]))
  const cellRank = new Map(WEEKLY_CELL_KEYS.map((k, i) => [k, i]))
  const at = (f: LintFinding) => sectionRank.get(f.section) ?? sectionRank.size
  return [...lintDuplicates(rows), ...lintNearDuplicates(rows), ...lintNumbering(rows), ...lintFormat(rows)]
    .sort((a, b) =>
      at(a) - at(b)
      || KIND_ORDER[a.kind] - KIND_ORDER[b.kind]
      || (rowRank.get(a.rowId) ?? 0) - (rowRank.get(b.rowId) ?? 0)
      || cellRank.get(a.cellKey)! - cellRank.get(b.cellKey)!)
}
