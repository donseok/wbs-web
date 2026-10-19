import type { ImportNode, SpecSections } from '@/lib/agent/wbsImport'

/**
 * 기존 3~4단 wbs.md(dflow-wbs 형식) 파서(TS) — 웹 업로드 경로(미리보기+적용)용.
 * `## WP-01:` 아래 `### TSK-01-01:`(3단) 또는 `### ACT-01-01:` 아래 `#### TSK-01-01-01:`(4단) 헤딩과
 * 그 아래 `- field: value` 필드 줄을 import 계약 v2.1 노드(ImportNode 17키)로 바꾼다.
 *
 * 스킬 dflow-export 의 `wbs-parse.mjs --export`(parse_nodes)와 같은 규칙이다 — 규칙을 바꿀 때는 양쪽을 같이
 * 고치고, 동등성 시험의 고정 자료(tests/lib/fixtures/wbsmd-classic/*.export.json = mjs 출력)를 다시 만든다.
 * 런타임에 .mjs 를 import 하지 않는 이유: 스킬 폴더는 다른 리포를 가리키는 심볼릭 링크라 Vercel 에 없다.
 * python 판의 의미(str.splitlines·str.strip 공백 집합·유니코드 \d·펜스 판정)를 mjs 가 옮긴 그대로 다시 옮겼다.
 *
 * 스킬 경로와 다른 점(의도)
 *  - state.json(<docs>/tasks/<TSK>/state.json) 덮어쓰기를 하지 않는다 — 업로드는 파일 한 장뿐이다.
 *    stage 는 파일의 `- status:` 줄만 쓴다(dflow-wbs 가 만드는 파일은 늘 `[ ]` 이라 null).
 *  - 파서는 스킬처럼 앞 BOM 을 지우지 않지만, 브라우저 File.text() 가 UTF-8 BOM 을 미리 지운다.
 *  - 이 파일은 `import type` 말고는 아무것도 가져오지 않는다 — node 로 직접 돌려 스킬 출력과 대조할 수 있게.
 */

// ── python 의미 도구(_pystr.mjs · _shared/node/pytext.mjs · _wbs_md.mjs 와 같은 동작) ──────────

/** python `\s`·`str.strip()` 의 공백 집합(JS 의 \s·trim 과 다르다 — \x1c-\x1f·\x85 포함, BOM 제외). */
const PY_SPACE_CLASS =
  '\\t\\n\\v\\f\\r\\x1c-\\x1f \\x85\\xa0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000'
const S = `[${PY_SPACE_CLASS}]`
const D = '\\p{Nd}' // python `\d`(유니코드 숫자)
const LEFT_SPACE = new RegExp(`^[${PY_SPACE_CLASS}]+`)
const ONE_SPACE = new RegExp(`[${PY_SPACE_CLASS}]`)

function pyRstrip(s: string): string {
  let end = s.length
  while (end > 0 && ONE_SPACE.test(s[end - 1])) end -= 1
  return end === s.length ? s : s.slice(0, end)
}

function pyStrip(s: string): string {
  return pyRstrip(s.replace(LEFT_SPACE, ''))
}

/** python `str.splitlines(keepends)` — \n \r \r\n \v \f \x1c \x1d \x1e \x85 \u2028 \u2029 에서 자른다. */
const LINE_BREAK = /\r\n|[\n\r\x0b\x0c\x1c\x1d\x1e\x85\u2028\u2029]/g

function splitlinesPy(text: string, keepends = false): string[] {
  const out: string[] = []
  let start = 0
  for (const m of text.matchAll(LINE_BREAK)) {
    const stop = m.index + m[0].length
    out.push(text.slice(start, keepends ? stop : m.index))
    start = stop
  }
  if (start < text.length) out.push(text.slice(start))
  return out
}

/** 펜스 코드 줄(``` 또는 ~~~, 앞 공백 3칸까지). 짝 없는 마지막 펜스는 구간으로 만들지 않는다(과소 탐지 방지). */
const FENCE_RE = /(?<![^\n])[ ]{0,3}(?:`{3,}|~{3,})/g

function fencedRanges(content: string): Array<[number, number]> {
  const positions = [...content.matchAll(FENCE_RE)].map(m => m.index)
  const ranges: Array<[number, number]> = []
  for (let i = 0; i + 1 < positions.length; i += 2) ranges.push([positions[i], positions[i + 1]])
  return ranges
}

function inRanges(pos: number, ranges: ReadonlyArray<[number, number]>): boolean {
  return ranges.some(([start, end]) => start <= pos && pos < end)
}

function lineStartOffsets(content: string): number[] {
  const offsets: number[] = []
  let pos = 0
  for (const line of splitlinesPy(content, true)) {
    offsets.push(pos)
    pos += line.length
  }
  return offsets
}

// ── 헤딩·필드 ────────────────────────────────────────────────────────────

const WP_HEADING_RE = new RegExp(`^##${S}+(WP-${D}+):${S}*([^\\n]*)$`, 'u')
const ACT_HEADING_RE = new RegExp(`^###${S}+(ACT-${D}+(?:-${D}+)+):${S}*([^\\n]*)$`, 'u')
/** 3~5단계 헤딩 모두 TSK — 3단(### TSK-XX-YY)·4단(#### TSK-XX-YY-ZZ) 겸용. 펜스 필터를 적용하지 않는다(과다 탐지가 안전). */
const TSK_HEADING_RE = new RegExp(`^#{3,5}${S}+(TSK-${D}+(?:-${D}+)+):${S}*([^\\n]*)$`, 'u')

/** 파일 표기 → D'Flow stage 코드(_wbs_status.mjs STAGE_CODE). 모르는 표기는 null — 지어내지 않는다.
 *  'todo'·'fp' 는 import 코어(toRpcNode)가 각각 null·'ip' 로 정규화한다. */
const STAGE_CODE: ReadonlyMap<string, string | null> = new Map<string, string | null>([
  ['[ ]', null], ['[as]', 'as'], ['[fp]', 'fp'],
  ['[ip]', 'ip'], ['[im]', 'im'], ['[xx]', 'xx'],
  ['[dd]', 'ip'], ['[ts]', 'ip'], ['[dd!]', 'todo'], ['[im!]', 'ip'],
])

function stageCode(status: string): string | null {
  const key = pyStrip(status || '')
  return STAGE_CODE.has(key) ? (STAGE_CODE.get(key) ?? null) : null
}

type Doc = { text: string; lines: string[]; offsets: number[]; fences: Array<[number, number]> }

/**
 * Task 블록 — 문서 전체에서 `{id}:` 를 품은 첫 헤딩(## 이상)부터, 같거나 얕은 헤딩 직전까지.
 * 끝 경계는 펜스 안의 WP/ACT 헤딩을 무시하지만 TSK 헤딩은 펜스와 무관하게 항상 닫는다.
 */
function extractTaskBlock(doc: Doc, tskId: string): string {
  const result: string[] = []
  let found = false
  let level = 0
  const needle = `${tskId}:`
  for (let idx = 0; idx < doc.lines.length; idx++) {
    const line = doc.lines[idx]
    let hl = 0
    for (const ch of line) {
      if (ch === '#') hl++
      else break
    }
    if (!found && hl >= 2 && line.includes(needle)) {
      found = true
      level = hl
      result.push(line)
      continue
    }
    const isTaskHeading = TSK_HEADING_RE.test(line)
    if (found && hl >= 2 && hl <= level && !line.includes(needle)
        && (isTaskHeading || !inRanges(doc.offsets[idx], doc.fences))) {
      break
    }
    if (found) result.push(line)
  }
  return result.join('\n')
}

/** 열 0 의 `- field: value` 한 줄 값. 없으면 "". */
function getField(block: string, name: string): string {
  const pattern = `- ${name}:`
  for (const line of splitlinesPy(block)) {
    if (line.startsWith(pattern)) return pyStrip(line.slice(pattern.length))
  }
  return ''
}

/**
 * 리스트 필드 — `- f: -` → [], `- f: a, b` → [a, b], `- f:` + `  - item` 줄들 → [item…].
 * 다음 `- name:` 필드·빈 줄·`#` 줄에서 끝난다. 4칸 이상 들여쓴 줄은 직전 항목 뒤에 개행으로 붙는다.
 */
function parseListField(block: string, name: string): string[] {
  const pattern = `- ${name}:`
  const items: string[] = []
  let capturing = false
  for (const line of splitlinesPy(block)) {
    if (!capturing) {
      if (line.startsWith(pattern)) {
        const inline = pyStrip(line.slice(pattern.length))
        if (inline && inline !== '-') return inline.split(',').map(s => pyStrip(s)).filter(s => s)
        if (inline === '-') return []
        capturing = true
      }
      continue
    }
    const stripped = pyStrip(line)
    if (/^- [a-zA-Z][a-zA-Z0-9_-]*:/.test(line)) break
    if (!stripped || stripped.startsWith('#')) break
    if (line.startsWith('  - ')) {
      items.push(pyRstrip(line.slice(4)))
      continue
    }
    if (line.startsWith('    -') && items.length) {
      items[items.length - 1] = `${items[items.length - 1]}\n${pyRstrip(line)}`
      continue
    }
    if (line.startsWith('    ') && items.length) {
      items[items.length - 1] = `${items[items.length - 1]}\n${pyRstrip(line)}`
      continue
    }
  }
  return items
}

/** '-' 와 빈 문자열은 값 없음(null). */
function nullify(value: string): string | null {
  const v = pyStrip(value || '')
  return !v || v === '-' ? null : v
}

/** 쉼표 구분 한 줄 필드(tags). '-' 는 []. */
function csvField(block: string, name: string): string[] {
  const raw = nullify(getField(block, name))
  if (raw === null) return []
  return raw.split(',').map(s => pyStrip(s)).filter(s => s)
}

function joinOrNone(items: string[]): string | null {
  return items.length ? items.join('\n') : null
}

function blankSpecSections(): SpecSections {
  return { requirements: [], test_criteria: [], constraints: [], api_spec: null, data_model: null, description: null }
}

/** 계약 v2.1 의 17키를 전부 가진 빈 노드 — 모든 kind 가 같은 shape. v2.2 키(level 등)는 싣지 않는다. */
function blankNode(id: string, kind: ImportNode['kind'], title: string, parentId: string | null):
  ImportNode & { spec_sections: SpecSections } {
  return {
    id,
    parent_id: parentId,
    kind,
    title: pyStrip(title),
    stage: null,
    category: null,
    domain: null,
    model: null,
    assignee: null,
    schedule: null,
    priority: null,
    tags: [],
    depends: [],
    prd_ref: null,
    entry_point: null,
    acceptance: [],
    spec_sections: blankSpecSections(),
  }
}

/**
 * 기존 형식 wbs.md → import 노드 배열(계약 v2.1). 순서는 Phase → WP → ACT → Task(종류별 등장 순)이며
 * import 코어가 이 순서를 sort_order 로 쓴다. Phase 노드는 WP 의 `- phase:` 값에서 처음 나온 순서로
 * 합성한다(title = id). WP/ACT 헤딩은 펜스 안 줄을 무시하고, TSK 헤딩은 펜스와 무관하게 잡는다.
 */
export function parseClassicWbs(md: string): ImportNode[] {
  // python open(..., encoding="utf-8") 처럼 줄끝만 정규화한다(readPyText). 펜스 오프셋이 \n 기준이다.
  const text = md.replace(/\r\n?/g, '\n')
  const doc: Doc = { text, lines: splitlinesPy(text), offsets: lineStartOffsets(text), fences: fencedRanges(text) }
  const { lines } = doc
  const phases: string[] = []
  const wps: ImportNode[] = []
  const acts: ImportNode[] = []
  const tasks: ImportNode[] = []
  let currentWp: string | null = null
  let currentAct: string | null = null

  for (let idx = 0; idx < lines.length; idx++) {
    const line = lines[idx]
    const inFence = inRanges(doc.offsets[idx], doc.fences)

    if (!inFence) {
      const wm = WP_HEADING_RE.exec(line)
      if (wm) {
        const metaLines: string[] = []
        for (let k = idx + 1; k < lines.length; k++) {
          if (lines[k].startsWith('#')) break
          metaLines.push(lines[k])
        }
        const meta = metaLines.join('\n')
        const phaseId = nullify(getField(meta, 'phase'))
        if (phaseId && !phases.includes(phaseId)) phases.push(phaseId)
        const node = blankNode(wm[1], 'wp', wm[2], phaseId)
        node.schedule = nullify(getField(meta, 'schedule'))
        node.spec_sections.description = nullify(getField(meta, 'description'))
        wps.push(node)
        currentWp = wm[1]
        currentAct = null
        continue
      }

      const am = ACT_HEADING_RE.exec(line)
      if (am) {
        acts.push(blankNode(am[1], 'act', am[2], currentWp))
        currentAct = am[1]
        continue
      }
    }

    const tm = TSK_HEADING_RE.exec(line)
    if (tm) {
      const tskId = tm[1]
      const block = extractTaskBlock(doc, tskId)
      const status = getField(block, 'status') || '[ ]'
      const node = blankNode(tskId, 'task', tm[2], currentAct || currentWp)
      node.stage = stageCode(status)
      node.category = nullify(getField(block, 'category'))
      node.domain = nullify(getField(block, 'domain'))
      node.model = nullify(getField(block, 'model'))
      node.assignee = nullify(getField(block, 'assignee'))
      node.schedule = nullify(getField(block, 'schedule'))
      node.priority = nullify(getField(block, 'priority'))
      node.tags = csvField(block, 'tags')
      node.depends = parseListField(block, 'depends')
      node.prd_ref = nullify(getField(block, 'prd-ref'))
      node.entry_point = nullify(getField(block, 'entry-point'))
      node.acceptance = parseListField(block, 'acceptance')
      node.spec_sections = {
        requirements: parseListField(block, 'requirements'),
        test_criteria: parseListField(block, 'test-criteria'),
        constraints: parseListField(block, 'constraints'),
        api_spec: joinOrNone(parseListField(block, 'api-spec')),
        data_model: joinOrNone(parseListField(block, 'data-model')),
        description: nullify(getField(block, 'description')),
      }
      tasks.push(node)
    }
  }

  const phaseNodes = phases.map(p => blankNode(p, 'phase', p, null))
  return [...phaseNodes, ...wps, ...acts, ...tasks]
}

// ── 형식 판정 ─────────────────────────────────────────────────────────────

/** 업로드 파일 형식 — nlevel(levels 계약) | classic(dflow-wbs 기존 3~4단) | unknown(어느 쪽도 아님). */
export type WbsFormat = 'nlevel' | 'classic' | 'unknown'

/**
 * frontmatter 에 `levels:` 키가 있으면 nlevel 이다 — 선언이 비었거나 깨졌어도 N단 오류를 그대로 보여 주려고
 * 키 존재만 본다(frontmatter 경계는 parse.ts 와 같다: 첫 줄 `---` ~ 다음 `---`, `#` 주석 줄 제외).
 * levels 가 없고 TSK 헤딩(파서와 같은 정규식)이 하나라도 있으면 classic, 둘 다 아니면 unknown.
 */
export function detectWbsFormat(md: string): WbsFormat {
  const text = md.replace(/\r\n?/g, '\n')
  const raw = text.split('\n')
  if (raw[0]?.trim() === '---') {
    for (let i = 1; i < raw.length; i++) {
      if (raw[i].trim() !== '---') continue
      const front = raw.slice(1, i)
      if (front.some(l => !l.trimStart().startsWith('#') && /^\s*levels:/.test(l))) return 'nlevel'
      break
    }
  }
  return splitlinesPy(text).some(l => TSK_HEADING_RE.test(l)) ? 'classic' : 'unknown'
}
