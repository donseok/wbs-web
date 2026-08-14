/* ── 주간보고 점검(순수) — 중복(완전·유사)·체번·글머리 기호 규칙과 수정 편집 생성. I/O 없음.
 *  공백·빈 줄은 점검하지 않는다(사용자 결정, 2026-07-24) — tidyBlankLines 가 남아 있는 것은
 *  검사가 아니라 중복 삭제가 남긴 빈 줄을 치우는 수정의 뒤처리이기 때문이다.
 *  모든 규칙은 **구분 안에서만** 본다. PMO의 줄과 영업의 줄을 견주는 일은 없다 —
 *  구분마다 담당이 다르고, 같은 문구가 두 구분에 있는 것은 보고서상 정상이기 때문이다.
 *  같은 이유로 **한 셀 안이라도 `[조업]`·`[표준화]` 같은 머리글로 갈린 구획은 서로 남남이다** —
 *  한 구분에 담당 영역 둘을 담은 셀이라 번호도 구획마다 1부터 다시 시작하고, 같은 문구가
 *  두 구획에 있어도 중복이 아니다(사용자 확인, 2026-08-06).
 *  (이 파일의 `[조업]`·`[표준화]` 예시는 그 관행이 실제로 있던 셀에서 왔다. 2026-08-14에 그 둘은
 *   구분 자체로 갈렸지만 — WEEKLY_SECTIONS — 구획 머리글 기능은 구분명과 무관한 일반 장치다.
 *   머리글 이름이 구분명과 같아야 하는 것은 아니다.) 구획의 정체는 **머리글 이름**이라
 *  떨어져 있는 같은 이름은 한 구획이고, 세 규칙이 이 묶음 키 하나를 공유한다(blockKeyOf).
 *  단 구획 분할은 **지적을 줄이는 쪽으로만** 쓴다 — 대괄호 한 줄이 늘 담당 영역 머리글이라는 보장이
 *  없으므로(`[완료]`·`[8/7]`), 체번은 (a) 머리글 뒤 번호가 1로 다시 시작할 때만 경계로 인정하고
 *  (numberingBlocks) (b) 셀 전체로 봐서 성한 번호는 구획을 갈랐다는 이유로 덮어쓰지 않는다.
 *  들여쓰기 취급까지 같지는 않다 — 중복은 들여쓴 줄을 '딸린 줄'로 빼지만 체번은 예전부터 평면이다.
 *  (예외: 글머리 기호·번호 표기 통일만 보고서 겉모습 문제라 시트 전체 다수결을 따른다.) ── */

import {
  CELL_FIELD, sectionKeyOf, sortWeeklyRows, WEEKLY_CELL_KEYS, WEEKLY_CELL_LABEL,
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

/** 선두 목록 번호: 숫자 1~2자리 + (. 또는 )) + 공백(반각·탭·전각·NBSP) 0개 이상.
 *  NBSP(U+00A0)를 gap 에 넣는 건 HWP/Word 붙여넣기가 번호 뒤에 NBSP 를 흘리기 때문 —
 *  gap 으로 흡수해야 '공백 1칸' 정규화가 그 자리를 일반 공백으로 갈아끼운다. */
const NUM_PREFIX = /^(\d{1,2})([.)])([ \t 　]*)/

/** 목록 번호 해석 결과. raw 는 원문 숫자 문자열(선행 0 보존용), rest 는 표기 뒤 본문. */
interface ListNum { num: number; raw: string; sep: '.' | ')'; gap: string; rest: string }

/** 들여쓰기를 뗀 줄머리에서 목록 번호 접두를 해석한다. 날짜·소수·절 번호이면 null.
 *  **구분자 뒤에 숫자가 오는 꼴은 공백 유무와 무관하게 번호로 보지 않는다** —
 *  `2026.07.24`(no gap)뿐 아니라 `7. 28(월)`·`26. 7. 24.`(gap 있는 한국식 날짜)도 지킨다.
 *  훼손 위험(날짜를 순번으로 덮어씀)이 놓침 위험(`1. 2024년…` 같은 실제 항목을 안 고침)보다
 *  크므로, 숫자로 시작하는 본문은 통째로 보수적으로 제외한다. 자리수 상한(2자리)은 이중 안전장치.
 *  본문 없는 접두(`1.` 단독)도 파싱은 낸다 — 어느 소비자가 어떻게 다룰지는 rest 로 각자 판단한다:
 *  비교(normalizeForCompare)는 떼어 빈 줄로 만들어 제외하고, 체번은 공백을 덧붙이지 않도록 건너뛴다.
 *  다수결 집계·체번 수정·중복 비교가 이 술어 하나를 공유한다 — 갈라지면
 *  "집계엔 세는데 수정에선 빠지는" 어긋남이 생긴다(글머리 기호 규칙에서 배운 것). */
function parseListNum(head: string): ListNum | null {
  const m = NUM_PREFIX.exec(head)
  if (!m) return null
  const rest = head.slice(m[0].length)
  if (/^\d/.test(rest)) return null
  return { num: Number(m[1]), raw: m[1], sep: m[2] as '.' | ')', gap: m[3], rest }
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

/** 점검의 유일한 단위 — 구분별 묶음. 화면 표시 순서(sortWeeklyRows — 구분 이름 순, 같은 구분
 *  안에서는 sortOrder 순)를 그대로 물려받으므로 묶음 순서 = 구분 순서, 묶음 안 행 순서 =
 *  화면 순서(중복 규칙의 '남길 행' 기준)다. 그리드와 같은 정렬을 써야 패널에서 짚은 행과
 *  화면에서 보이는 행이 어긋나지 않는다.
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
  for (const row of sortWeeklyRows(rows)) {
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

/** 지울 자리 표기 — 한 행 안이면 몇 번째 줄인지까지, 여러 행에 걸치면 행 수까지만. */
function victimsWhere(victims: readonly { rowId: string; line: number }[]): string {
  const rows = new Set(victims.map(v => v.rowId))
  if (rows.size > 1) return `${rows.size}개 행에서 ${victims.length}줄`
  return `${victims.map(v => v.line + 1).join('·')}번째 줄`
}

/** 줄 앞 공백 길이(들여쓰기 깊이). 전각 공백·탭도 공백으로 센다. */
const indentOf = (line: string): number => line.length - line.trimStart().length

/** 셀 안 하위 구획의 머리글 — **줄 전체가 대괄호 한 쌍**인 줄(`[조업]`). 한 구분에 담당 영역이
 *  둘 이상 섞인 셀에서 작성자가 영역을 가르는 표기다. `[참고] 확정 예정`처럼 뒤에 본문이 붙으면
 *  머리글이 아니라 본문 줄이다 — 줄 전체 일치를 요구하는 이유이자, 본문에 흔한 `[]` 표기를
 *  경계로 오인해 검사를 조용히 무력화하지 않기 위한 선이다.
 *  전각 대괄호·【】까지 받는다: HWP·Word 붙여넣기가 흘리는 표기이고, 넓게 봐서 생기는 손해(지적 누락)가
 *  좁게 봐서 생기는 손해(멀쩡한 줄을 지우거나 번호를 덮어씀)보다 훨씬 싸기 때문이다.
 *
 *  ⚠️ 이 술어는 `[완료]`·`[보류]`·`[8/7]` 같은 **주석성 표기와 담당 영역 머리글을 구별하지 못한다.**
 *  형태만 보기 때문이다. 그래서 이 판정 하나만 믿고 파괴적인 수정을 내면 안 된다 —
 *  체번(lintNumbering)에 "셀 전체로 보면 성한 번호는 건드리지 않는다"는 잠금장치가 따로 있는 이유다. */
const BLOCK_HEADER = /^(?:\[([^[\]]*)\]|［([^［］]*)］|【([^【】]*)】)$/

/** 구획 머리글이면 그 이름(괄호 안 글자, 공백 접기), 아니면 null. 이름이 비면 머리글로 보지 않는다.
 *  들여쓰기는 여기서 보지 않는다 — 형태 판정과 위치 판정은 splitCellBlocks 가 나눠 맡는다. */
function blockHeaderName(line: string): string | null {
  const m = BLOCK_HEADER.exec(line.trim())
  if (!m) return null
  const name = (m[1] ?? m[2] ?? m[3]).replace(/\s+/g, ' ').trim()
  return name === '' ? null : name
}

/** 그 셀에서 '항목' 줄로 볼 깊이 = 내용 있는 줄의 최소 들여쓰기. 셀 전체를 들여 쓴 사람도 있으므로
 *  0이 아니라 최소값을 기준으로 삼는다. 내용이 없으면 아무 줄도 대상이 아니다.
 *
 *  **머리글 후보(대괄호만인 줄)는 항목이 아니므로 이 최소값에서 뺀다.** 빼지 않으면 `[조업]` 아래로
 *  항목을 들여 쓰는 가장 자연스러운 표기에서 머리글이 기준선을 0으로 끌어내려, 그 아래 항목이 전부
 *  '딸린 줄'로 분류되고 중복 검사가 셀 전체에서 조용히 꺼진다. 머리글이 없는 셀에서는 뺄 것이 없으므로
 *  기존 동작과 한 글자도 다르지 않다. */
function topLevelIndent(lines: readonly string[]): number {
  let min = Infinity
  for (const line of lines) {
    if (line.trim() === '' || blockHeaderName(line) !== null) continue
    const d = indentOf(line)
    if (d < min) min = d
  }
  return min
}

/** 셀 안 하위 구획. name 은 머리글 이름(맨 앞 머리글 없는 구획은 null), lines 는 원문 줄 인덱스,
 *  label 은 화면에 되돌려 쓸 원문 표기(`【조업】`처럼 쓴 표기를 반각으로 바꿔 적지 않기 위함),
 *  headerLine 은 머리글 줄의 원문 인덱스(맨 앞 구획은 null).
 *  **머리글 줄 자체는 어느 구획에도 넣지 않는다** — 항목이 아니라 경계이기 때문이다.
 *  덕분에 머리글은 중복 비교에도, 체번에도 걸리지 않는다(경계가 지워져 두 구획이 합쳐지는 사고 방지). */
interface CellBlock { name: string | null; label: string | null; headerLine: number | null; lines: number[] }

/** 셀의 줄을 구획으로 가른다. 머리글이 하나도 없으면 셀 전체가 이름 없는 구획 1개 — 기존 동작 그대로다.
 *
 *  **들여쓴 대괄호 줄은 머리글로 보지 않는다.** 이 파일은 이미 "들여쓴 줄은 바로 위 항목에 딸린 것"이라
 *  못 박아 두었고(규칙 ①의 들여쓰기 제외), 그 계약을 어기면 `1. 가 / (들여쓴)[세부] / 2. 나 / 3. 다`에서
 *  부모 목록이 갈려 2·3이 1·2로 덮어써진다. 그래서 최상위 깊이에 있는 줄만 경계로 인정한다.
 *  내용이 비어 있는 구획도 버리지 않고 돌려준다 — 빈 구획 머리글을 치우는 뒤처리가 이 정보를 쓴다. */
function splitCellBlocks(lines: readonly string[]): CellBlock[] {
  const top = topLevelIndent(lines)
  const out: CellBlock[] = [{ name: null, label: null, headerLine: null, lines: [] }]
  lines.forEach((line, i) => {
    const name = indentOf(line) <= top ? blockHeaderName(line) : null
    if (name !== null) out.push({ name, label: line.trim(), headerLine: i, lines: [] })
    else out[out.length - 1].lines.push(i)
  })
  return out
}

/** 규칙들이 견주는 단위의 키 = 구분(바깥 루프) × 열 × **구획 이름**.
 *  위치가 아니라 이름으로 묶는 것은 의도이고, **중복·유사중복·체번 셋이 이 정의를 공유한다** —
 *  하나는 위치로 하나는 이름으로 가르면 "중복은 한 몸으로 보고 지우는데 체번은 남남으로 세는" 어긋남이
 *  생긴다(같은 함정을 글머리 기호 규칙에서 이미 겪었다).
 *  이름으로 묶으면 한 구분에 행이 여럿인 옛 시트에서 두 행의 `[조업]`이 같은 영역으로 견줘지고,
 *  `[조업]`과 `[표준화]`는 글자가 같아도 남남이 된다. 이름 없는 구획(null)도 자기들끼리만 묶인다 —
 *  머리글을 안 쓴 행과 쓴 행 사이의 행 간 중복은 그래서 잡히지 않는다(어느 영역인지 알 수 없으니
 *  지우지 않는 쪽을 택한다). JSON 직렬화는 이름에 흔한 구분자 문자가 키를 뭉개지 않게 하기 위함. */
const blockKeyOf = (name: string | null): string => JSON.stringify(name)

/** 주어진 줄들 중 목록 번호 줄만. 본문 없는 접두(`1.` 단독)는 항목이 아니라 뺀다 —
 *  공백을 덧붙여 `1. `로 만들지 않기 위함. */
function numberedLines(lines: readonly string[], idx: readonly number[]): { i: number; ln: ListNum }[] {
  return idx
    .map(i => ({ i, ln: parseListNum(lines[i].trimStart()) }))
    .filter((x): x is { i: number; ln: ListNum } => x.ln !== null && x.ln.rest !== '')
}

/** 체번이 쓸 구획 목록 — splitCellBlocks 의 경계 중 **믿을 만한 것만** 남긴다.
 *
 *  BLOCK_HEADER 는 `[조업]`(담당 영역)과 `[완료]`·`[8/7]`(주석·상태 표기)을 형태로 구별하지 못한다.
 *  그래서 **번호가 스스로 밝히게 한다**: 머리글 뒤 목록이 1번부터 다시 시작할 때만 새 구획으로 인정하고,
 *  이어지는 번호(3, 4 …)면 작성자가 한 목록으로 이어 쓴 것이므로 앞 구획에 도로 붙인다.
 *  이 판정이 없으면 `1. 가 / 2. 나 / [완료] / 3. 다 / 4. 라 / 6. 마` 에서 앞이 성하다는 이유로
 *  뒤만 떼어 3·4·6 → 1·2·3 으로 덮어쓴다 — 셀에 1이 둘 생겨 원문보다 더 어긋난다.
 *  (중복 규칙은 이 좁힘을 쓰지 않는다. 그쪽은 경계를 잘못 봐도 '안 지운다' 쪽으로 틀리기 때문이다.) */
function numberingBlocks(lines: readonly string[]): { label: string | null; name: string | null; lines: number[] }[] {
  const out: { label: string | null; name: string | null; lines: number[] }[] = []
  for (const b of splitCellBlocks(lines)) {
    const first = numberedLines(lines, b.lines)[0]
    if (out.length === 0 || first?.ln.num === 1) out.push({ label: b.label, name: b.name, lines: [...b.lines] })
    else out[out.length - 1].lines.push(...b.lines)
  }
  return out
}

/** 지정 인덱스의 줄을 지운 결과. 지운 자리에 남는 빈 줄까지 함께 정리한다 —
 *  그러지 않으면 중복을 고치자마자 그 빈 줄이 '정리' 지적으로 되돌아와 두 번 눌러야 한다.
 *
 *  **이 편집으로 항목을 모두 잃은 구획은 머리글도 함께 지운다.** 머리글은 어느 구획에도 속하지 않아
 *  중복 규칙이 건드리지 못하고, 어떤 규칙도 그 잔재를 지적하지 않는다 — 여기서 치우지 않으면
 *  경계만 남은 셀이 PPT까지 그대로 실려 나간다. 다만 **원래부터 비어 있던 머리글은 손대지 않는다**:
 *  사용자가 자리를 잡아 둔 것일 수 있고, 이 함수는 중복 삭제의 뒤처리이지 빈 머리글 청소기가 아니다. */
function removeLines(content: string, drop: ReadonlySet<number>): { content: string; headers: number } {
  const lines = toLines(content)
  const gone = new Set(drop)
  let headers = 0
  for (const b of splitCellBlocks(lines)) {
    if (b.headerLine === null) continue
    const had = b.lines.some(i => lines[i].trim() !== '')
    const left = b.lines.some(i => !gone.has(i) && lines[i].trim() !== '')
    if (had && !left) { gone.add(b.headerLine); headers++ }
  }
  return { content: tidyBlankLines(lines.filter((_, i) => !gone.has(i))).kept.join('\n'), headers }
}

/** 규칙 ① — **한 구분·한 열·한 구획 안에서** 되풀이되는 줄. 같은 셀 안 반복도, 그 구분에 행이 여럿일 때
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
      // (구획, 정규화 줄) → 등장 위치들. 묶음이 sortOrder 순이고 구획은 줄 순서를 나눠 가지므로
      // 배열 앞쪽이 곧 화면에서 위쪽이다(첫 등장만 남기는 규칙이 이 순서에 기댄다).
      const groups = new Map<string, { norm: string; hits: { rowId: string; line: number }[] }>()
      for (const row of group) {
        const lines = toLines(row[CELL_FIELD[cellKey]])
        // 들여쓰기 기준은 구획이 아니라 셀 전체로 잰다 — 구획별로 재면 머리글(보통 0칸)이 빠지면서
        // 그동안 제외되던 들여쓴 줄이 통째로 삭제 대상에 새로 들어온다. 이 변경의 취지는 지적을
        // 줄이는 것이지 늘리는 것이 아니다.
        const top = topLevelIndent(lines)
        for (const block of splitCellBlocks(lines)) {
          for (const line of block.lines) {
            const raw = lines[line]
            if (indentOf(raw) > top) continue // 상위 항목에 딸린 줄 — 아래 주석 참조
            const norm = normalizeForCompare(raw)
            if (!norm) continue
            const key = `${blockKeyOf(block.name)}:${norm}`
            const g = groups.get(key)
            if (g) g.hits.push({ rowId: row.id, line })
            else groups.set(key, { norm, hits: [{ rowId: row.id, line }] })
          }
        }
      }

      for (const [key, { norm, hits }] of groups) {
        if (hits.length < 2) continue
        const victims = hits.slice(1) // 맨 처음 등장만 남긴다

        // 행별로 지울 줄 번호를 모아 셀당 편집 1개로. victims는 묶음 순서를 물려받는다.
        const dropByRow = new Map<string, Set<number>>()
        for (const v of victims) {
          const s = dropByRow.get(v.rowId)
          if (s) s.add(v.line)
          else dropByRow.set(v.rowId, new Set([v.line]))
        }
        let headersGone = 0
        const edits: WeeklyCellEdit[] = [...dropByRow].map(([rowId, drop]) => {
          const { content, headers } = removeLines(byId.get(rowId)![CELL_FIELD[cellKey]], drop)
          headersGone += headers
          return { rowId, cellKey, content }
        })

        out.push({
          // 구분·구획이 키에 들어가야 두 구분(또는 한 셀의 두 구획)에서 같은 줄이 반복돼도
          // 지적 id가 부딪히지 않는다. key 는 이미 `구획:정규화줄` 이다.
          id: `duplicate:${section}:${cellKey}:${key}`,
          kind: 'duplicate',
          section,
          rowId: edits[0].rowId,
          cellKey,
          title: WEEKLY_CELL_LABEL[cellKey],
          // 어느 줄이 사라지는지 적용 '전에' 보이게 한다 — 셀 안 반복까지 잡게 된 뒤로는
          // 지울 줄을 눈으로 고르지 못하면 사용자가 되돌릴 수 없는 삭제에 동의하는 셈이 된다.
          // 머리글까지 지워지는 경우를 문구에 반드시 드러낸다 — "2번째 줄을 지웁니다"라고만 적어 놓고
          // 셀을 통째로 비우면, 사용자는 되돌릴 수 없는 삭제에 사실과 다른 설명을 보고 동의하는 셈이 된다.
          detail: `같은 줄이 ${hits.length}번 있습니다: "${norm}" — ${victimsWhere(victims)}을 지웁니다(남는 빈 줄도 함께 정리).`
            + (headersGone > 0 ? ` 항목이 모두 없어지는 구획 머리글 ${headersGone}줄도 함께 지웁니다.` : ''),
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
      // 구획별로, 정규화 줄의 첫 등장만 모은다. 같은 줄의 2번째 이후 등장은 규칙 ①이 지운다.
      // 첫 등장 판정(seen)도 구획 안에서 한다 — 시트 전체로 한 벌만 두면 `[조업]`에 먼저 나온 줄이
      // `[표준화]`의 같은 줄을 잡아먹어, 그 구획 안의 진짜 유사 쌍이 통째로 사라진다.
      const buckets = new Map<string, { firsts: { norm: string; rowId: string; line: number }[]; seen: Set<string> }>()
      for (const row of group) {
        const lines = toLines(row[CELL_FIELD[cellKey]])
        const top = topLevelIndent(lines) // 규칙 ①과 같은 기준(셀 전체)
        for (const block of splitCellBlocks(lines)) {
          const bk = blockKeyOf(block.name)
          let bucket = buckets.get(bk)
          if (!bucket) { bucket = { firsts: [], seen: new Set() }; buckets.set(bk, bucket) }
          for (const line of block.lines) {
            const raw = lines[line]
            if (indentOf(raw) > top) continue
            const norm = normalizeForCompare(raw)
            if (!norm || bucket.seen.has(norm)) continue
            bucket.seen.add(norm)
            bucket.firsts.push({ norm, rowId: row.id, line })
          }
        }
      }

      for (const [bk, { firsts }] of buckets) {
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
            // 서로 다른 두 지적이 같은 id 로 뭉갤 수 있다. 구획 키(bk)도 함께 넣어야
            // 한 셀의 두 구획에 같은 군집이 생겨도 id 가 부딪히지 않는다.
            id: `nearDuplicate:${section}:${cellKey}:${bk}:${JSON.stringify(ms.map(m => m.norm))}`,
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
        if (!ln || ln.rest === '') continue // 본문 없는 접두(`1.` 단독)는 항목이 아니다 — 다수결에 세지 않는다.
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

        const numberedAt = (idx: readonly number[]) => numberedLines(lines, idx)

        // 🔒 잠금장치 — **셀 전체로 봐서 1..n 이면 구획을 갈라 번호를 다시 매기지 않는다.**
        // 아래 numberingBlocks 의 경계 판정과 이중 안전장치다. 구획 분할은 지적을 **줄이는**
        // 장치이지 늘리는 장치가 아니라는 이 파일의 방침을 체번에도 그대로 건다.
        const cellWide = numberedAt(lines.map((_, i) => i)).map(x => x.ln.num)
        const cellWideSound = cellWide.length < 2 || cellWide.every((n, k) => n === k + 1)

        // 구분자가 바뀌는 줄은 공백도 함께 다시 쓰이므로 else if — 표기 노트가 공백 노트를 포괄한다.
        let sepFixed = 0, gapFixed = 0
        const next = [...lines]
        // 체번은 **구획마다 따로** 센다 — `[조업] 1.` 다음의 `[표준화] 1.` 은 중복 번호가 아니라
        // 새 영역의 첫 항목이다. 구획은 blockKeyOf 와 같이 **이름**으로 묶는다(떨어져 있어도 같은 이름이면
        // 한 목록). 표기(구분자·공백) 통일은 반대로 구획과 무관하게 셀 전체에 건다:
        // 순서는 영역별 의미가 있지만 겉모습은 보고서 전체가 한 벌이어야 하기 때문이다.
        const byName = new Map<string, { label: string | null; lines: number[] }>()
        for (const block of numberingBlocks(lines)) {
          const key = blockKeyOf(block.name)
          const g = byName.get(key)
          if (g) g.lines.push(...block.lines)
          else byName.set(key, { label: block.label, lines: [...block.lines] })
        }

        const renumberNotes: string[] = []
        for (const { label, lines: idx } of byName.values()) {
          const numbered = numberedAt(idx)
          if (numbered.length === 0) continue

          const nums = numbered.map(x => x.ln.num)
          const renumber = !cellWideSound && numbered.length >= 2 && !nums.every((n, k) => n === k + 1)

          numbered.forEach((x, k) => {
            const line = lines[x.i]
            const indent = line.slice(0, line.length - line.trimStart().length)
            if (x.ln.sep !== sep) sepFixed++
            else if (x.ln.gap !== ' ') gapFixed++
            // 재부여가 아니면 원문 숫자(raw)를 그대로 둔다 — 선행 0(`01.`)이 이 규칙의 명시 범위(구분자·공백)
            // 밖에서 조용히 사라지지 않도록. 재부여일 때만 k+1 로 다시 매긴다.
            next[x.i] = `${indent}${renumber ? k + 1 : x.ln.raw}${sep} ${x.ln.rest}`
          })

          // 어느 구획을 고치는지 밝힌다 — 셀에 구획이 여럿이면 번호만으로는 어디를 말하는지 알 수 없다.
          // 라벨은 원문 표기 그대로 적는다. 반각으로 바꿔 적으면 사용자가 셀에서 찾지 못한다.
          if (renumber) {
            const where = label === null ? '' : `${label} `
            renumberNotes.push(`${where}줄 번호가 ${nums.join(', ')} 입니다 → ${nums.map((_, k) => k + 1).join(', ')}`)
          }
        }
        if (renumberNotes.length === 0 && sepFixed === 0 && gapFixed === 0) continue

        const notes: string[] = [...renumberNotes]
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
 *  (구분별 다수결이 아니다 — 번호 표기 통일과 더불어 구분 단위 원칙의 의도된 예외). */
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
