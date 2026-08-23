import type { ImportNode, LevelDecl } from '@/lib/agent/wbsImport'

/**
 * N단 wbs.md 파서(TS) — 웹 업로드 경로(미리보기+적용)용.
 * 계약 정본: docs/superpowers/specs/2026-08-21-wbs-nlevel-md-contract.md §import 계약 v2.2.
 * 스킬 파서(.claude/skills/dflow-wbs-nlevel/scripts/wbs-nlevel-parse.py)와 동일 규칙 —
 * 접두어가 단계 정본, 헤딩/들여쓰기는 부모 판정, fold(STK)는 부모 acceptance 로 접힘.
 * 규칙을 바꿀 땐 양쪽을 같이 고치고 각자의 테스트를 갱신한다.
 */

export type RawNode = {
  id: string; title: string; level: number; parent: string | null
  checked: boolean | null; milestone: boolean
  tokens: { assignee?: string; weight?: string; end?: string; credit?: string; if_id?: string }
  fields: Record<string, string>
  stks: Array<{ checked: boolean; title: string }>
}

export type WbsDoc = {
  front: { project?: string; module?: string; attach?: string; credits: Record<string, Record<string, number>> }
  levels: LevelDecl[]
  nodes: RawNode[]
  problems: string[]
}

const FIELD_KEYS = new Set([
  'category', 'domain', 'model', 'priority', 'tags', 'depends',
  'prd-ref', 'entry-point', 'requirements', 'acceptance',
])

function parseFlowMap(inner: string): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {}
  for (const part of inner.split(',')) {
    const idx = part.indexOf(':')
    if (idx < 0) continue
    const k = part.slice(0, idx).trim()
    const raw = part.slice(idx + 1).trim()
    out[k] = raw === 'true' ? true : raw === 'false' ? false : /^-?\d+$/.test(raw) ? Number(raw) : raw
  }
  return out
}

function parseFrontmatter(lines: string[]): WbsDoc['front'] & { levels: LevelDecl[] } {
  const front: WbsDoc['front'] & { levels: LevelDecl[] } = { credits: {}, levels: [] }
  let section: 'levels' | 'credits' | null = null
  for (const raw of lines) {
    const noComment = raw.trimStart().startsWith('#') ? '' : raw.split('#', 1)[0] ? raw.replace(/#.*$/, '') : raw
    if (!noComment.trim()) continue
    const flow = /^\s*-\s*\{(.+)\}\s*$/.exec(noComment)
    if (flow && section === 'levels') {
      front.levels.push(parseFlowMap(flow[1]) as unknown as LevelDecl)
      continue
    }
    const credit = /^\s{2}(\S+):\s*\{(.+)\}\s*$/.exec(raw)
    if (credit && section === 'credits') {
      front.credits[credit[1]] = parseFlowMap(credit[2]) as Record<string, number>
      continue
    }
    const kv = /^([A-Za-z_][\w-]*):\s*(.*?)\s*$/.exec(noComment.trim())
    if (kv) {
      const [, key, val] = kv
      if ((key === 'levels' || key === 'credits') && val === '') {
        section = key
      } else {
        section = null
        if (key === 'project' || key === 'module' || key === 'attach') front[key] = val
      }
    }
  }
  return front
}

const ID_TITLE_RE = /^([A-Z][A-Z0-9]*(?:-[^\s:]+)*):\s*(.+)$/
const TOKEN_RES: Array<[keyof RawNode['tokens'], RegExp]> = [
  ['assignee', /\s+@(\S+)/],
  ['weight', /\s+w:([\d.]+)/],
  ['end', /\s+~(\d{4}-\d{2}-\d{2})/],
  ['credit', /\s+credit:(\S+)/],
  ['if_id', /\s+if-id:(\S+)/],
]

function extractTokens(text: string): { title: string; tokens: RawNode['tokens'] } {
  const tokens: RawNode['tokens'] = {}
  for (const [name, re] of TOKEN_RES) {
    const m = re.exec(text)
    if (m) {
      tokens[name] = m[1]
      text = text.replace(re, '')
    }
  }
  return { title: text.replace(/\s+/g, ' ').trim(), tokens }
}

export function parseWbsMarkdown(md: string): WbsDoc {
  const lines = md.split('\n')
  let frontLines: string[] = []
  let bodyStart = 0
  if (lines[0]?.trim() === '---') {
    for (let i = 1; i < lines.length; i++) {
      if (lines[i].trim() === '---') {
        frontLines = lines.slice(1, i)
        bodyStart = i + 1
        break
      }
    }
  }
  const { levels, ...front } = parseFrontmatter(frontLines)
  const prefixToIdx = new Map(levels.map((l, i) => [l.prefix, i] as const))

  const nodes: RawNode[] = []
  const problems: string[] = []
  const headingStack: Array<{ depth: number; node: RawNode }> = []
  let itemStack: Array<{ indent: number; node: RawNode }> = []
  let inComment = false

  const mkNode = (id: string, title: string, level: number, parent: RawNode | null,
    opts: { checked?: boolean | null; milestone?: boolean; tokens?: RawNode['tokens'] } = {}): RawNode => {
    const node: RawNode = {
      id, title, level, parent: parent?.id ?? null,
      checked: opts.checked ?? null, milestone: opts.milestone ?? false,
      tokens: opts.tokens ?? {}, fields: {}, stks: [],
    }
    nodes.push(node)
    return node
  }

  for (const raw of lines.slice(bodyStart)) {
    const line = raw.trimEnd()
    if (inComment) {
      if (line.includes('-->')) inComment = false
      continue
    }
    if (line.trimStart().startsWith('<!--')) {
      if (!line.includes('-->')) inComment = true
      continue
    }

    const hm = /^(#{1,6})\s+(.+?)\s*$/.exec(line)
    if (hm) {
      const depth = hm[1].length
      const idm = ID_TITLE_RE.exec(hm[2])
      if (!idm) continue // 문서 제목 등 ID 없는 헤딩
      const { title, tokens } = extractTokens(idm[2])
      const prefix = idm[1].split('-', 1)[0]
      while (headingStack.length && headingStack[headingStack.length - 1].depth >= depth) headingStack.pop()
      const parent = headingStack.length ? headingStack[headingStack.length - 1].node : null
      const level = prefixToIdx.get(prefix)
      if (level === undefined) {
        problems.push(`미선언 접두어: ${idm[1]} (levels 의 prefix 에 없음)`)
        continue
      }
      const node = mkNode(idm[1], title, level, parent, { tokens })
      headingStack.push({ depth, node })
      itemStack = []
      continue
    }

    const im = /^(\s*)-\s+(.+?)\s*$/.exec(line)
    if (!im) continue
    const indent = im[1].length
    const content = im[2]
    while (itemStack.length && itemStack[itemStack.length - 1].indent >= indent) itemStack.pop()
    const owner = itemStack.length ? itemStack[itemStack.length - 1].node : null

    const cb = /^\[( |x|M)\]\s+(.+)$/.exec(content)
    if (cb) {
      const [, mark, rest] = cb
      const idm = ID_TITLE_RE.exec(rest)
      if (!idm) {
        problems.push(mark === 'M'
          ? `마일스톤에 ID 필요: ${JSON.stringify(rest)} — '- [M] {접두어 ID}: 제목' 형식`
          : `체크 항목에 ID 필요: ${JSON.stringify(rest)}`)
        continue
      }
      const { title, tokens } = extractTokens(idm[2])
      const prefix = idm[1].split('-', 1)[0]
      const level = prefixToIdx.get(prefix)
      if (level === undefined) {
        problems.push(`미선언 접두어: ${idm[1]} (levels 의 prefix 에 없음)`)
        continue
      }
      const parent = owner ?? (headingStack.length ? headingStack[headingStack.length - 1].node : null)
      const node = mkNode(idm[1], title, level, parent, { checked: mark === 'x', milestone: mark === 'M', tokens })
      itemStack.push({ indent, node })
      continue
    }

    // 상세 블록 필드: "- key: value" (체크박스 없음)
    const sep = content.indexOf(':')
    if (sep > 0 && owner) {
      const key = content.slice(0, sep).trim()
      if (FIELD_KEYS.has(key)) owner.fields[key] = content.slice(sep + 1).trim()
    }
    // 그 외 리스트 줄은 무시(자유 메모)
  }

  return { front, levels, nodes, problems }
}

// ── 검증 ─────────────────────────────────────────────────────────────────

export type WbsValidation = { ok: boolean; errors: string[]; warnings: string[]; counts: Record<string, number> }

export function validateWbsDoc(doc: WbsDoc, role: 'pl' | 'skeleton'): WbsValidation {
  const errors = [...doc.problems]
  const warnings: string[] = []
  const { levels, nodes, front } = doc

  if (levels.length === 0) {
    errors.push('frontmatter levels 가 없습니다 — 단계 선언은 frontmatter 에서만 한다.')
    return { ok: false, errors, warnings, counts: {} }
  }
  if (role === 'pl') {
    if (!front.attach) errors.push('PL 파일에 attach 가 없습니다 (frontmatter attach: {골격 경로}).')
    if (!front.module) errors.push('PL 파일에 module 이 없습니다.')
  }

  const byId = new Map<string, RawNode>()
  for (const n of nodes) {
    if (byId.has(n.id)) errors.push(`ID 중복: ${n.id}`)
    byId.set(n.id, n)
  }
  const children = new Map<string, RawNode[]>()
  for (const n of nodes) {
    if (n.parent) (children.get(n.parent) ?? children.set(n.parent, []).get(n.parent)!).push(n)
  }

  let attachMinLevel = -1
  if (role === 'pl' && front.attach) {
    const last = front.attach.split('/').pop() ?? ''
    attachMinLevel = new Map(levels.map((l, i) => [l.prefix, i] as const)).get(last.split('-', 1)[0]) ?? -1
  }

  for (const n of nodes) {
    const lv = levels[n.level]
    if (role === 'pl' && (lv.upload === false || lv.owner === 'pmo')) {
      errors.push(`${n.id}: 골격 층(${lv.name})은 PL 파일 본문에 쓸 수 없다 — 골격 소유.`)
    }
    if (n.parent) {
      const p = byId.get(n.parent)
      if (p && n.level <= p.level) {
        errors.push(`${n.id}: 단계 순번 역행/동급 — 부모 ${p.id}(${p.level}) 이하가 아님(${n.level}).`)
      } else if (p) {
        for (let i = p.level + 1; i < n.level; i++) {
          if (!levels[i].optional) warnings.push(`${n.id}: 필수층 ${levels[i].name} 건너뜀 (부모 ${p.id}).`)
        }
      }
    } else if (attachMinLevel >= 0 && n.level <= attachMinLevel) {
      errors.push(`${n.id}: attach 지점(${attachMinLevel}층) 이하 층은 최상위에 올 수 없다.`)
    }
    if (n.checked && lv.progress !== 'checklist') {
      errors.push(`${n.id}: 상태는 항상 [ ] — [x] 는 checklist 층 전용(전이 정본은 D'Flow).`)
    }
    if (/\d+\s*%/.test(n.title)) errors.push(`${n.id}: 제목에 실적 % 금지 — 진도는 D'Flow 가 정본.`)
    if (lv.progress === 'checklist') {
      if (children.get(n.id)?.length) errors.push(`${n.id}: checklist 층은 leaf 전용 — 자식 금지.`)
      const p = n.parent ? byId.get(n.parent) : undefined
      if (!p || levels[p.level].progress !== 'input') errors.push(`${n.id}: checklist 의 부모는 input 층이어야 한다.`)
    }
    if (lv.progress === 'rollup' && !children.get(n.id)?.length && !n.milestone) {
      warnings.push(`${n.id}: rollup 층 leaf (파일 단위 — 분리 업로드 과도기면 정상).`)
    }
    for (const d of (n.fields.depends ?? '').split(',').map(s => s.trim()).filter(Boolean)) {
      if (!byId.has(d)) warnings.push(`${n.id}: depends 대상 없음(파일 내): ${d}`)
    }
    const credit = n.tokens.credit
    if (credit && !(credit in front.credits)) warnings.push(`${n.id}: credit 키 미정의: ${credit}`)
  }

  const counts: Record<string, number> = {}
  for (const n of nodes) counts[levels[n.level].name] = (counts[levels[n.level].name] ?? 0) + 1
  return { ok: errors.length === 0, errors, warnings, counts }
}

// ── import 노드 변환 (v2.2) ──────────────────────────────────────────────

export function toImportNodes(doc: WbsDoc): ImportNode[] {
  const { levels } = doc
  const byId = new Map(doc.nodes.map(n => [n.id, n] as const))
  const out: RawNode[] = []
  for (const n of doc.nodes) {
    const lv = levels[n.level]
    if (lv.upload === false) continue
    if (lv.upload === 'fold') {
      const p = n.parent ? byId.get(n.parent) : undefined
      if (p) p.stks.push({ checked: n.checked === true, title: n.title })
      continue
    }
    out.push(n)
  }
  return out.map(n => {
    const f = n.fields
    const t = n.tokens
    const acceptance = (f.acceptance ?? '').split(' / ').map(s => s.trim()).filter(Boolean)
    acceptance.push(...n.stks.map(s => `${s.checked ? '[x]' : '[ ]'} ${s.title}`))
    const req = (f.requirements ?? '').trim()
    const progress = levels[n.level].progress
    const weight = t.weight === undefined ? null : Number(t.weight)
    return {
      id: n.id,
      parent_id: n.parent,
      kind: (progress === 'input' ? 'task' : n.level === 0 ? 'phase' : 'wp') as ImportNode['kind'],
      title: n.title,
      stage: null,
      category: f.category ?? null,
      domain: f.domain ?? null,
      assignee: t.assignee ?? null,
      schedule: t.end ? `~ ${t.end}` : null,
      depends: (f.depends ?? '').split(',').map(s => s.trim()).filter(Boolean),
      acceptance,
      priority: f.priority ?? null,
      model: f.model ?? null,
      tags: (f.tags ?? '').split(',').map(s => s.trim()).filter(Boolean),
      prd_ref: f['prd-ref'] ?? null,
      entry_point: f['entry-point'] ?? null,
      spec_sections: req
        ? { requirements: [req], test_criteria: [], constraints: [], api_spec: null, data_model: null, description: null }
        : null,
      level: n.level,
      weight,
      milestone: n.milestone,
      credit: t.credit ?? null,
      if_id: t.if_id ?? null,
    }
  })
}
