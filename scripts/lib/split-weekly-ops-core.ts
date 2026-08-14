/* 주간업무 구분 '조업및표준화' → '조업' + '표준화' 이관의 순수 부분(I/O 없음).
 *
 * 왜 이 파일이 따로 있나 — 실 데이터에 돌리는 러너에서 분할 규칙을 떼어내야 fixture 로
 * 검증할 수 있다(backfill-0076-core 전례). 옮기는 대상이 사용자가 손으로 쓴 보고 원문이라,
 * 한 번 잘못 옮기면 스냅샷을 뒤져야 되돌아온다.
 *
 * 분할의 근거: 이 셀들은 구분이 하나였던 시절 작성자가 `[조업]`·`[표준화]` 머리글로 손수
 * 갈라 쓰던 곳이다(weeklyLint 가 구획 단위로 점검하는 것도 그 관행 때문). 그 경계를 그대로
 * 두 행의 경계로 승격시킨다. */

/** 줄 전체가 대괄호 한 쌍인지 — weeklyLint 의 BLOCK_HEADER 와 같은 형태 판정.
 *  전각 대괄호·【】까지 받는 이유도 같다(HWP·Word 붙여넣기가 흘리는 표기). */
const BLOCK_HEADER = /^(?:\[([^[\]]*)\]|［([^［］]*)］|【([^【】]*)】)$/

/** 경계로 인정하는 머리글 이름 → 어느 몫인지. 이 둘만 경계다 —
 *  `[완료]`·`[8/7]` 같은 주석성 대괄호 줄까지 경계로 보면 작성자의 표기를 지우게 된다. */
const BOUNDARY: Record<string, 'ops' | 'standard'> = { 조업: 'ops', 표준화: 'standard' }

const indentOf = (line: string): number => line.length - line.trimStart().length

/** 머리글이면 이름(공백 접음), 아니면 null. */
function blockHeaderName(line: string): string | null {
  const m = BLOCK_HEADER.exec(line.trim())
  if (!m) return null
  const name = (m[1] ?? m[2] ?? m[3]).replace(/\s+/g, ' ').trim()
  return name === '' ? null : name
}

/** 항목 줄로 볼 최소 들여쓰기 — 셀 전체를 들여 쓴 사람도 있으므로 0이 아니라 최소값이 기준.
 *  머리글 후보는 이 계산에서 뺀다(weeklyLint.topLevelIndent 와 같은 이유 — 빼지 않으면
 *  머리글이 기준선을 0으로 끌어내려 그 아래 항목이 전부 '딸린 줄'이 된다). */
function topLevelIndent(lines: readonly string[]): number {
  let min = Infinity
  for (const line of lines) {
    if (line.trim() === '' || blockHeaderName(line) !== null) continue
    const d = indentOf(line)
    if (d < min) min = d
  }
  return min === Infinity ? 0 : min
}

/** 앞뒤의 '빈 줄'만 걷어낸다. 줄 안의 들여쓰기는 건드리지 않는다 —
 *  통짜 trim() 은 첫 줄의 들여쓰기를 지워 작성자가 맞춘 정렬을 깨뜨린다. */
function trimBlankEdges(lines: readonly string[]): string {
  let a = 0
  let b = lines.length
  while (a < b && lines[a].trim() === '') a++
  while (b > a && lines[b - 1].trim() === '') b--
  return lines.slice(a, b).join('\n')
}

/** 셀 하나를 조업 몫과 표준화 몫으로 가른다.
 *  - 최상위 깊이의 `[조업]`·`[표준화]` 줄만 경계로 보고, 그 줄 자체는 어느 쪽에도 넣지 않는다.
 *  - 첫 경계 앞의 내용은 조업 몫이다(조업이 이 구분의 본류였다 — 내용을 버리지 않는 쪽).
 *  - 나머지 줄은 원문 그대로 지금 몫에 쌓인다. */
export function splitOpsCell(text: string): { ops: string; standard: string } {
  const lines = text.split('\n')
  const top = topLevelIndent(lines)
  const buckets: Record<'ops' | 'standard', string[]> = { ops: [], standard: [] }
  let current: 'ops' | 'standard' = 'ops'
  for (const line of lines) {
    const name = indentOf(line) <= top ? blockHeaderName(line) : null
    const boundary = name === null ? undefined : BOUNDARY[name]
    if (boundary) { current = boundary; continue }
    buckets[current].push(line)
  }
  return { ops: trimBlankEdges(buckets.ops), standard: trimBlankEdges(buckets.standard) }
}

/** DB 열 이름 그대로의 4셀 — 러너가 그대로 update/insert 에 실을 수 있게. */
export interface SplitCells {
  this_content: string
  this_issue: string
  next_content: string
  next_issue: string
}

/** 이관 대상 행(러너가 DB 에서 읽어 넘긴다). */
export interface SplitSourceRow {
  id: string
  reportId: string
  weekStart: string
  sortOrder: number
  thisContent: string
  thisIssue: string
  nextContent: string
  nextIssue: string
}

export interface SplitPlanRow {
  rowId: string
  reportId: string
  weekStart: string
  sortOrder: number
  before: SplitCells
  ops: SplitCells
  standard: SplitCells
  /** 표준화 몫이 4셀 모두 빈가 — 머리글 없이 쓰인 주차의 표시(운영 로그에서 눈으로 확인용). */
  standardIsEmpty: boolean
}

const CELLS = ['this_content', 'this_issue', 'next_content', 'next_issue'] as const

export function buildSplitPlan(rows: readonly SplitSourceRow[]): SplitPlanRow[] {
  return rows.map(row => {
    const before: SplitCells = {
      this_content: row.thisContent,
      this_issue: row.thisIssue,
      next_content: row.nextContent,
      next_issue: row.nextIssue,
    }
    const ops = {} as SplitCells
    const standard = {} as SplitCells
    for (const key of CELLS) {
      const split = splitOpsCell(before[key])
      ops[key] = split.ops
      standard[key] = split.standard
    }
    return {
      rowId: row.id,
      reportId: row.reportId,
      weekStart: row.weekStart,
      sortOrder: row.sortOrder,
      before,
      ops,
      standard,
      standardIsEmpty: CELLS.every(k => standard[k] === ''),
    }
  })
}
