import { describe, it, expect } from 'vitest'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'

const ROOT = join(__dirname, '..', '..')
const team = readFileSync(join(ROOT, '.claude/skills/dflow-team/SKILL.md'), 'utf8')

// 팀장 poll exit 0 의 show 필터(jq 식)를 문서에서 그대로 꺼내 돌린다 — 문서와 동작이 어긋나지 않게.
function filterExpr(): string {
  const m = team.match(/\| jq -c '(\{order: \.order\.id[\s\S]*?\})'/)
  if (!m) throw new Error('show 필터를 찾지 못했다')
  return m[1]
}
function run(show: unknown): { spec_empty: boolean; deps_unmet: string[]; deps_nohead: string[] } {
  return JSON.parse(execFileSync('jq', ['-c', filterExpr()], { input: JSON.stringify(show) }).toString())
}
const order = (extra: Record<string, unknown>) => ({ order: { id: 'o1', item: { external_ref: 'd/TSK-03-02', spec: '본문' } }, ...extra })

describe('dflow-team — spawn 전 선행 사전 검사(2026-09-19)', () => {
  it('show 필터는 G1(중단 표식 정리)을 위해 status 를 싣는다', () => {
    const r = JSON.parse(execFileSync('jq', ['-c', filterExpr()], { input: JSON.stringify({ order: { id: 'o1', status: 'ready', item: { external_ref: 'd/TSK-03-02', spec: '본문' } } }) }).toString())
    expect(r.status).toBe('ready')
  })
  it('reached 가 거짓인 선행만 deps_unmet 에 담는다', () => {
    const r = run(order({ depends_evidence: [
      { external_ref: 'd/TSK-03-01', reached: false, head_sha: null },
      { external_ref: 'd/TSK-02-01', reached: true, head_sha: 'abc' },
    ] }))
    expect(r.deps_unmet).toEqual(['d/TSK-03-01'])
    expect(r.spec_empty).toBe(false)
  })
  it('승인 대기(reached 참, head_sha 없음)는 거르지 않고 워커 G 에 맡긴다', () => {
    expect(run(order({ depends_evidence: [{ external_ref: 'd/TSK-03-01', reached: true, head_sha: null }] })).deps_unmet).toEqual([])
  })
  it('reached 키가 없는 옛 서버·depends_evidence 없는 응답은 판정 불가로 보고 거르지 않는다', () => {
    expect(run(order({ depends_evidence: [{ external_ref: 'd/TSK-03-01', stage: 'ip' }] })).deps_unmet).toEqual([])
    expect(run(order({})).deps_unmet).toEqual([])
  })
  it('poll exit 0 행이 사전 검사로 spawn 을 막고, 사유가 선행 계열(자동 머지 뒤 해제 대상)로 시작한다', () => {
    expect(team).toContain('`deps_unmet` 이 비어 있지 않으면 띄우지 않고 사유 `선행 미충족(사전 검사: <ref…>)`')
    expect(team).toMatch(/선행 계열\(선행 미충족·/)
  })
  it('state.json merged 기준으로 거르지 않는다(워커 행 B 스택을 막지 않도록)', () => {
    expect(team).toContain('`state.json` 의 `phase=merged` 로 거르지 않는다')
  })
  it('deps_nohead 는 reached=true·head_sha 없는 선행만 담는다 — head_sha 있는 선행(행 B 스택)은 거르지 않는다(2026-09-23)', () => {
    const r = run(order({ depends_evidence: [
      { external_ref: 'd/TSK-03-01', reached: true, head_sha: null },
      { external_ref: 'd/TSK-03-02', reached: true, head_sha: 'abc' },
      { external_ref: 'd/TSK-03-03', reached: false, head_sha: null },
      { external_ref: 'd/TSK-03-04', reached: true },
    ] }))
    expect(r.deps_nohead).toEqual(['d/TSK-03-01', 'd/TSK-03-04'])
    expect(r.deps_unmet).toEqual(['d/TSK-03-03'])
  })
  it('선행 반영 사전 검사: NOT_REFLECTED 는 선행 미반영으로 일시 제외, UNKNOWN 은 거르지 않는다', () => {
    expect(team).toContain('사유 `선행 미반영(사전 검사: <ref…>)`')
    expect(team).toContain('`UNKNOWN`(rc=2) 은 거르지 않고 워커에 맡긴다')
    expect(team).toContain('.claude/skills/dflow-dev/scripts/pred-reflected.sh')
  })
})

// 선행 대기(2026-09-24): 사전 검사로 건너뛴 작업을 30분 일시 제외가 아니라 선행 대기로 붙든다. 목록은 events.jsonl
// 에서 블록이 다시 만든다 — 문서의 블록을 그대로 꺼내 가짜 이벤트로 돌린다.
describe('dflow-team — 선행 대기 블록', () => {
  const AGENT = 'me/pc1/lead'
  const MAIN = '/repo/main'
  function block(): string {
    const at = team.indexOf('선행 대기 블록 — 출력 한 줄이')
    expect(at).toBeGreaterThan(-1)
    const m = team.slice(at).match(/```bash\n([\s\S]*?)```/)
    if (!m) throw new Error('선행 대기 블록을 찾지 못했다')
    return m[1].replace("'<신원>/<host>/lead'", `'${AGENT}'`).replace("'<MAIN>'", `'${MAIN}'`)
  }
  const iso = (secAgo: number) => new Date(Date.now() - secAgo * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z')
  const ev = (o: Record<string, unknown>) => JSON.stringify({ host: 'pc1', repo: MAIN, phase: 'team', agent: AGENT, ...o })
  function run(lines: string[]): string[] {
    const home = mkdtempSync(join(tmpdir(), 'dflow-wait-'))
    try {
      mkdirSync(join(home, '.dflow'))
      writeFileSync(join(home, '.dflow', 'events.jsonl'), lines.join('\n') + '\n')
      const out = execFileSync('bash', ['-c', block()], { env: { ...process.env, HOME: home }, encoding: 'utf8' })
      return out.split('\n').filter(Boolean).sort()
    } finally { rmSync(home, { recursive: true, force: true }) }
  }
  const start = ev({ ts: iso(20000), event: 'team.start', backend: 'tmux', slots: '4', until: 'none', wp: '-' })
  const skip = (id8: string, refs: string, ago: number) =>
    ev({ ts: iso(ago), event: 'team.result', tsk: 'TSK-09-09', slot: '-', id8, status: 'skipped', worktree: '-', hash: '-', reason: `선행 미충족(사전 검사: ${refs})` })

  it('사전 검사로 건너뛴 작업은 선행 ref 와 함께 선행 대기에 든다(모듈 접두는 떼고 TSK 만)', () => {
    expect(run([start, skip('aaaa1111', 'd/TSK-03-01 d/TSK-03-02', 600)])).toEqual(['aaaa1111\tTSK-03-01,TSK-03-02'])
  })

  it('다른 사유의 skipped·다른 팀장·마지막 team.start 앞의 기록은 선행 대기가 아니다', () => {
    const other = ev({ ts: iso(600), event: 'team.result', slot: '1', id8: 'bbbb2222', status: 'skipped', worktree: '-', hash: '1', reason: '선행 미승인 TSK-03-01' })
    const foreign = JSON.stringify({ ...JSON.parse(skip('cccc3333', 'TSK-03-01', 600)), agent: 'you/pc2/lead' })
    const before = skip('dddd4444', 'TSK-03-01', 30000)
    expect(run([before, start, other, foreign])).toEqual([])
  })

  it('그 뒤에 spawn 됐으면(재검사로 선행이 풀려 띄움) 선행 대기에서 빠진다', () => {
    const spawn = ev({ ts: iso(60), event: 'team.spawn', slot: '1', id8: 'aaaa1111', worktree: '/w', handle: 'tmux:%1', spawn_kind: 'new' })
    expect(run([start, skip('aaaa1111', 'TSK-03-01', 600), spawn])).toEqual([])
  })

  it('선행 TSK 의 done·needs-merge·resolved 결과가 건너뛴 뒤에 오면 푼다. 앞선 결과나 다른 TSK 결과는 풀지 않는다', () => {
    const res = (tsk: string, status: string, ago: number) =>
      ev({ ts: iso(ago), event: 'team.result', tsk, slot: '2', id8: `x${tsk.slice(-5)}`, status, worktree: '/w', hash: '1', reason: '' })
    const s = skip('aaaa1111', 'd/TSK-03-01 d/TSK-03-02', 600)
    for (const st of ['done', 'needs-merge', 'resolved']) expect(run([start, s, res('TSK-03-02', st, 60)]), st).toEqual([])
    expect(run([start, res('TSK-03-01', 'done', 900), s])).toEqual(['aaaa1111\tTSK-03-01,TSK-03-02'])
    expect(run([start, s, res('TSK-07-07', 'done', 60), res('TSK-03-01', 'failed', 60)])).toEqual(['aaaa1111\tTSK-03-01,TSK-03-02'])
  })

  it('안전망: 기록한 지 2시간이 지난 것은 목록에서 빼 poll 이 다시 돌려주게 한다', () => {
    expect(run([start, skip('aaaa1111', 'TSK-03-01', 7300), skip('bbbb2222', 'TSK-03-01', 7000)])).toEqual(['bbbb2222\tTSK-03-01'])
  })

  it('SKILL.md: poll 은 --wait-cycles 40 과 --exclude-wait 로 띄우고, 선행 대기는 일시 제외에 넣지 않는다', () => {
    expect(team).toContain('--wait-cycles 40 [--wp <WP-02,dict/WP-03>] [--exclude <id8,id8>] [--exclude-temp <id8,id8>] [--exclude-wait <id8,id8>] )')
    expect(team).toContain('일시 제외가 아니라 **선행 대기**에 넣는다')
    expect(team).toContain('선행 대기 목록은\n  기억이 아니라')
  })
})
