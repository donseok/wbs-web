import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { detectWbsFormat, parseClassicWbs } from '@/lib/wbsmd/classic'

/**
 * 기존 3~4단 wbs.md(dflow-wbs 형식) TS 파서 — 스킬 dflow-export 의 `wbs-parse.mjs --export` 와 동등해야 한다.
 * 고정 자료 *.export.json 은 mjs 출력의 nodes 다. 파서 규칙을 바꿨으면 다음으로 다시 만든다(리포 루트에서):
 *   node .claude/skills/dflow-export/scripts/wbs-parse.mjs tests/lib/fixtures/wbsmd-classic/<이름>.md --export
 * 그 출력의 nodes 만 <이름>.export.json 에 둔다(봉투의 source 는 실행 위치에 따라 바뀌어 넣지 않는다).
 * 이 폴더에 tasks/ 나 state-machine.json 을 두지 않는다 — mjs 가 읽어 stage 를 덮어쓴다(웹 경로엔 없는 입력).
 */

const DIR = join(__dirname, 'fixtures', 'wbsmd-classic')
const load = (name: string) => ({
  md: readFileSync(join(DIR, `${name}.md`), 'utf8'),
  expected: JSON.parse(readFileSync(join(DIR, `${name}.export.json`), 'utf8')) as unknown[],
})

describe('parseClassicWbs — wbs-parse.mjs --export 와 동등', () => {
  it.each(['classic-3level', 'classic-4level'])('%s: mjs 출력 nodes 와 deep-equal(17키 그대로)', (name) => {
    const { md, expected } = load(name)
    expect(parseClassicWbs(md)).toStrictEqual(expected)
  })

  it.each(['classic-3level', 'classic-4level'])('%s: CRLF 줄끝도 같은 결과(스킬은 \\r\\n 을 \\n 으로 읽는다)', (name) => {
    const { md, expected } = load(name)
    expect(parseClassicWbs(md.replace(/\n/g, '\r\n'))).toStrictEqual(expected)
  })

  it('3단 — Phase 합성·순서(Phase→WP→Task)·필드 변환이 고정 자료대로다', () => {
    const nodes = parseClassicWbs(load('classic-3level').md)
    expect(nodes.map(n => `${n.kind}:${n.id}`)).toEqual([
      'phase:착수', 'phase:구현', 'wp:WP-01', 'wp:WP-02', 'wp:WP-03',
      'task:TSK-01-01', 'task:TSK-01-02', 'task:TSK-02-01', 'task:TSK-02-02', 'task:TSK-02-03', 'task:TSK-03-01',
    ])
    const byId = new Map(nodes.map(n => [n.id, n]))
    expect(byId.get('WP-01')).toMatchObject({ parent_id: '착수', schedule: '2026-11-02 ~ 2026-11-06' })
    expect(byId.get('WP-01')!.spec_sections!.description).toBe('저장소·CI·공통 설정을 준비한다')
    // 상태 표기 → stage 코드([dd]→ip, [im]→im, [xx]→xx, [fp]→fp(코어가 ip 로 정규화))
    expect(['TSK-01-02', 'TSK-02-01', 'TSK-02-02', 'TSK-02-03'].map(id => byId.get(id)!.stage)).toEqual(['ip', 'im', 'xx', 'fp'])
    // 펜스 안 `## WP-99:` 는 WP 도 블록 경계도 아니다 — 펜스 뒤 api-spec 이 살아 있다.
    expect(byId.has('WP-99')).toBe(false)
    expect(byId.get('TSK-02-01')!.spec_sections!.api_spec).toBe('POST /api/members')
    // 4칸 이어쓰기 줄은 직전 항목에 붙는다
    expect(byId.get('TSK-01-02')!.acceptance[1]).toContain('\n    누락 키는')
  })

  it('4단 — ACT 아래 TSK, 같은 깊이 명세 헤딩은 블록을 끊는다(스킬과 같은 날카로운 모서리)', () => {
    const nodes = parseClassicWbs(load('classic-4level').md)
    const byId = new Map(nodes.map(n => [n.id, n]))
    expect(byId.get('ACT-01-02')).toMatchObject({ kind: 'act', parent_id: 'WP-01' })
    expect(byId.get('TSK-01-02-01')).toMatchObject({ parent_id: 'ACT-01-02', stage: 'todo' })
    expect(byId.get('TSK-01-01-01')!.spec_sections!.constraints).toEqual(['코드 길이는 20자 이하'])
    expect(byId.get('TSK-02-01-02')!.spec_sections!.requirements).toEqual([])
  })
})

describe('detectWbsFormat', () => {
  it('frontmatter 에 levels 가 있으면 nlevel', () => {
    expect(detectWbsFormat('---\nmodule: a\nlevels:\n  - { name: Task, prefix: TSK, progress: input }\n---\n\n## TSK-01: x\n')).toBe('nlevel')
  })
  it('levels 키가 비어 있어도 nlevel — N단 오류를 그대로 보여 준다', () => {
    expect(detectWbsFormat('---\nlevels:\n---\n\n### TSK-01-01: 기존 헤딩이 있어도\n')).toBe('nlevel')
  })
  it('frontmatter 주석 줄의 levels 는 세지 않는다', () => {
    expect(detectWbsFormat('---\n# levels: 나중에\nmodule: a\n---\n\n### TSK-01-01: 제목\n')).toBe('classic')
  })
  it('levels 없이 #{3,5} TSK 헤딩이 있으면 classic', () => {
    expect(detectWbsFormat(load('classic-3level').md)).toBe('classic')
    expect(detectWbsFormat(load('classic-4level').md)).toBe('classic')
    expect(detectWbsFormat('##### TSK-1-2-3: 5단 헤딩도 TSK\n')).toBe('classic')
  })
  it('CRLF 파일도 같게 판정한다', () => {
    expect(detectWbsFormat('---\r\nlevels:\r\n---\r\n')).toBe('nlevel')
    expect(detectWbsFormat('## WP-01: a\r\n### TSK-01-01: b\r\n')).toBe('classic')
  })
  it('둘 다 아니면 unknown — N단 접두어 ID(TSK-QA-01)·체크 항목·## TSK 는 기존 형식이 아니다', () => {
    expect(detectWbsFormat('# 제목\n\n## SUB-QA: 판정\n- [ ] TSK-QA-01: 자동판정\n')).toBe('unknown')
    expect(detectWbsFormat('### TSK-QA-01: 문자 세그먼트\n')).toBe('unknown')
    expect(detectWbsFormat('## TSK-01-01: 2단 헤딩\n')).toBe('unknown')
    expect(detectWbsFormat('')).toBe('unknown')
  })
})
