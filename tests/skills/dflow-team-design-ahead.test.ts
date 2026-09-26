// tests/skills/dflow-team-design-ahead.test.ts
// /dflow-team 설계 선행(계약 2.9, 설계 wbs-web docs/superpowers/specs/2026-09-26-dflow-parallel-token-design.md §6.5):
// 선행 대기 작업을 빈 슬롯에만 설계 선행으로 주고, design_waiting 결과는 실패가 아니며, 설계 완료 대기 워크트리는
// 지우지도 재시작하지도 않는다. references/design-ahead.md 의 셸 블록을 그대로 꺼내 가짜 이벤트·워크트리로 돌린다.
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const ROOT = process.cwd()
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8')
const DA = read('.claude/skills/dflow-team/references/design-ahead.md')
const TEAM = read('.claude/skills/dflow-team/SKILL.md')
const flat = (s: string) => s.replace(/\s*\n\s*/g, ' ')

const AGENT = 'me/pc1/lead'
const MAIN = '/repo/main'
function blockAfter(marker: string): string {
  const at = DA.indexOf(marker)
  expect(at, marker).toBeGreaterThan(-1)
  const m = DA.slice(at).match(/```bash\n([\s\S]*?)```/)
  if (!m) throw new Error(`블록 없음: ${marker}`)
  return m[1]
}

describe('design-ahead.md — 설계 선행 블록(AHEAD·TOO_EARLY)', () => {
  const block = () => blockAfter('설계 선행 블록 — 출력 줄은').replace("'<신원>/<host>/lead'", `'${AGENT}'`).replace("'<MAIN>'", `'${MAIN}'`)
  const iso = (secAgo: number) => new Date(Date.now() - secAgo * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z')
  const ev = (o: Record<string, unknown>) => JSON.stringify({ host: 'pc1', repo: MAIN, phase: 'team', agent: AGENT, ...o })
  function run(lines: string[]): string[] {
    const home = mkdtempSync(join(tmpdir(), 'dflow-ahead-'))
    try {
      mkdirSync(join(home, '.dflow'))
      writeFileSync(join(home, '.dflow', 'events.jsonl'), lines.join('\n') + '\n')
      const out = execFileSync('bash', ['-c', block()], { env: { ...process.env, HOME: home }, encoding: 'utf8' })
      return out.split('\n').filter(Boolean).sort()
    } finally { rmSync(home, { recursive: true, force: true }) }
  }
  const start = (ago: number) => ev({ ts: iso(ago), event: 'team.start', backend: 'tmux', slots: '3', until: 'none', wp: '-' })
  const waitSkip = (id8: string, ago: number) => ev({ ts: iso(ago), event: 'team.result', tsk: 'TSK-09-09', slot: '-', id8, status: 'skipped', worktree: '-', hash: '-', reason: '선행 미충족(사전 검사: d/TSK-03-01)' })
  const spawn = (id8: string, ago: number, kind = 'new') => ev({ ts: iso(ago), event: 'team.spawn', slot: '1', id8, worktree: '/w', handle: 'tmux:%1', spawn_kind: kind })
  const early = (id8: string, ago: number, refs = 'd/TSK-03-01') => ev({ ts: iso(ago), event: 'team.result', tsk: 'TSK-09-09', slot: '1', id8, status: 'skipped', worktree: '/w', hash: '1', reason: `선행 미충족(설계 선행 불가: ${refs})` })
  const res = (tsk: string, status: string, ago: number) => ev({ ts: iso(ago), event: 'team.result', tsk, slot: '2', id8: `x${tsk.slice(-5)}`, status, worktree: '/w', hash: '1', reason: '' })

  it('선행 대기(사전 검사 skipped) 바로 뒤의 새 spawn 은 설계 선행으로 돌고 있는 것(AHEAD)이다', () => {
    expect(run([start(9000), waitSkip('aaaa1111', 600), spawn('aaaa1111', 300)])).toEqual(['AHEAD\taaaa1111'])
  })

  it('보통 spawn·재개 spawn·결과가 난 뒤는 AHEAD 가 아니다', () => {
    expect(run([start(9000), spawn('bbbb2222', 300)])).toEqual([])
    expect(run([start(9000), waitSkip('cccc3333', 600), spawn('cccc3333', 300, 'resume')])).toEqual([])
    const done = ev({ ts: iso(100), event: 'team.result', tsk: 'TSK-09-09', slot: '1', id8: 'dddd4444', status: 'design_waiting', worktree: '/w', hash: '2', reason: 'd/TSK-03-01' })
    expect(run([start(9000), waitSkip('dddd4444', 600), spawn('dddd4444', 300), done])).toEqual([])
  })

  it('너무 이른 선행 거부는 2시간 동안 TOO_EARLY — team.start 로 자르지 않는다(팀장을 다시 띄워도 이어진다)', () => {
    expect(run([early('eeee5555', 900), start(300)])).toEqual(['TOO_EARLY\teeee5555\tTSK-03-01'])
    expect(run([early('eeee5555', 7300)])).toEqual([])
  })

  it('거부 뒤 그 선행 TSK 의 done·needs-merge·resolved 결과가 오면 푼다. 다른 TSK·앞선 결과는 풀지 않는다', () => {
    for (const st of ['done', 'needs-merge', 'resolved']) expect(run([early('eeee5555', 900), res('TSK-03-01', st, 60)]), st).toEqual([])
    expect(run([res('TSK-03-01', 'done', 1200), early('eeee5555', 900), res('TSK-07-07', 'done', 60)])).toEqual(['TOO_EARLY\teeee5555\tTSK-03-01'])
  })
})

describe('design-ahead.md — 설계 완료 대기 목록(워크트리가 정본)', () => {
  let tmp: string
  beforeEach(() => { tmp = realpathSync(mkdtempSync(join(tmpdir(), 'dflow-designed-'))) })
  afterEach(() => rmSync(tmp, { recursive: true, force: true }))
  const g = (cwd: string, ...a: string[]) => execFileSync('git', a, { cwd, env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' } })

  it('이 신원·이 PC 의 워크트리 중 state.json 이 wait_pred 인 것만 DESIGNED 로 낸다', () => {
    const main = join(tmp, 'main')
    mkdirSync(main)
    g(main, 'init', '-q', '-b', 'dev'); writeFileSync(join(main, 'a'), 'a'); g(main, 'add', 'a'); g(main, 'commit', '-qm', 'i')
    mkdirSync(join(tmp, 'bin'))
    writeFileSync(join(tmp, 'bin', 'dflow.sh'), '#!/bin/sh\n[ "$1 $2" = "config tasks-dirs" ] && echo docs/tasks\n', { mode: 0o755 })
    const mk = (name: string, agent: string, phase: string) => {
      const w = join(tmp, name)
      g(main, 'worktree', 'add', '-q', '--detach', w)
      writeFileSync(join(w, '.dflow-agent'), agent + '\n')
      mkdirSync(join(w, 'docs/tasks/TSK-' + name), { recursive: true })
      writeFileSync(join(w, 'docs/tasks/TSK-' + name, 'state.json'), JSON.stringify({ tsk: 'TSK-' + name, order: `${name}0000-1111`, phase, design_first: { unmet: ['d/TSK-03-01', 'd/TSK-03-02'] } }))
      return w
    }
    const w1 = mk('aaaa', 'me/pc1/parked', 'wait_pred')
    mk('bbbb', 'me/pc1/w2', 'build')
    mk('cccc', 'you/pc1/w1', 'wait_pred')
    const b = blockAfter('## 1. 설계 완료 대기 목록').replaceAll("'<신원>/<host>/'", "'me/pc1/'")
      .replace('.claude/skills/dflow-work/scripts/dflow.sh', join(tmp, 'bin', 'dflow.sh'))
    const r = spawnSync('bash', ['-c', b], { cwd: main, encoding: 'utf8' })
    expect(r.status, r.stderr).toBe(0)
    expect(r.stdout.trim().split('\n')).toEqual([`DESIGNED\taaaa0000\tTSK-aaaa\t${w1}\td/TSK-03-01,d/TSK-03-02`])
  })
})

describe('dflow-team 문서 — 설계 선행 계약', () => {
  it('참조 표와 「2-3」 4번이 design-ahead.md 를 가리키고, 빈 슬롯이 남았을 때만 준다', () => {
    expect(TEAM).toContain('| `references/design-ahead.md` |')
    expect(flat(TEAM)).toContain('그러고도 빈 슬롯이 남으면 선행 대기 작업을 **설계 선행**으로 준다(`references/design-ahead.md` 3번, `DFLOW_DESIGN_AHEAD_MAX`)')
    const d = flat(DA)
    expect(d).toContain('`DFLOW_DESIGN_AHEAD_MAX`(팀장 세션 환경변수, 기본 2. 0 이면 끈다) 미만일 때만')
    expect(d).toContain('선행이 충족된 후보(대기 큐)가 하나라도 있으면 그것이 먼저다')
    expect(d).toContain('선행의 단계(구현 전인지)는 팀장이 판정하지 않는다')
  })

  it('design_waiting 결과는 실패가 아니고 워크트리를 지우지 않으며 제외도 없다', () => {
    expect(TEAM).toContain('| `design_waiting`(설계 완료·선행 대기, 사유는 미충족 선행 ref) | 해제 | 없음 | **지우지 않는다**.')
    expect(read('.claude/skills/dflow-team/references/backends.md')).toContain('0. **설계 완료 대기**')
    expect(read('.claude/skills/dflow-team/references/worker-prompt.md')).toContain('| `design_waiting` |')
  })

  it('재시작 경로: 고아 스캔 0번과 restart.md 4-1 이 wait_pred 워크트리를 재시작·재개 후보에서 뺀다', () => {
    expect(flat(TEAM)).toContain('0. **설계 완료 대기**: `<TASKS>/*/state.json` 이 `phase=wait_pred` 면 정리·멈춤으로 보내지 않는다')
    const r = read('.claude/skills/dflow-team/references/restart.md')
    expect(r).toContain('| 4-1 | `local_phase=wait_pred` |')
    expect(flat(r)).toContain('재투입하지 않고 「판정」 4-1·4-2 의 오른쪽 칸대로 처리한다')
    expect(flat(DA)).toContain('**재시작·재개 후보에서 뺀다**')
  })

  it('워커 서버 쓰기 범위에 build-start·heartbeat 가 자기 ID8 로만 들어간다', () => {
    const w = flat(read('.claude/skills/dflow-team/references/worker-prompt.md'))
    expect(w).toContain('`{ID8}` 외의 어떤 주문에도 claim·build-start·progress·heartbeat·release·done 을 하지 않는다')
    expect(w).toContain('`선행 미충족(설계 선행 불가: <ref…>)`')
  })
})

describe('lead-state.sh — design_waiting 은 제외하지 않고 차단기를 끊는다', () => {
  let tmp: string
  beforeEach(() => { tmp = realpathSync(mkdtempSync(join(tmpdir(), 'dflow-ls-dw-'))) })
  afterEach(() => rmSync(tmp, { recursive: true, force: true }))
  it('제외 목록에 없고, 앞선 failed 연속 수를 0 으로 되돌린다', () => {
    const A = 'hong/mbp/lead', R = '/work/repo'
    let n = 0
    const ts = () => `2026-09-26T00:00:${String(n++).padStart(2, '0')}Z`
    const l = (e: Record<string, string>) => JSON.stringify({ ts: ts(), host: 'mbp', repo: R, tsk: '-', order: '-', phase: 'team', agent: A, ...e })
    const ev = join(tmp, 'e.jsonl')
    writeFileSync(ev, [
      l({ event: 'team.start', backend: 'tmux', slots: '3', until: 'none', wp: '-' }),
      l({ event: 'team.spawn', slot: '1', id8: 'fail0001', worktree: '/w1', handle: '-', spawn_kind: 'new' }),
      l({ event: 'team.result', slot: '1', id8: 'fail0001', status: 'failed x', worktree: '/w1', hash: '1', reason: 'r' }),
      l({ event: 'team.spawn', slot: '2', id8: 'desi0002', worktree: '/w2', handle: '-', spawn_kind: 'new' }),
      l({ event: 'team.result', slot: '2', id8: 'desi0002', status: 'design_waiting', worktree: '/w2', hash: '2', reason: 'd/TSK-01-01' }),
    ].join('\n') + '\n')
    const r = spawnSync('bash', [join(ROOT, '.claude/skills/dflow-team/scripts/lead-state.sh'), '--agent', A, '--repo', R, '--events', ev], { encoding: 'utf8' })
    expect(r.status, r.stderr).toBe(0)
    const out = r.stdout.split('\n')
    expect(out).toContain('BREAKER 0')
    expect(out.find((x) => x.startsWith('EXCLUDE_PERM '))).toBe('EXCLUDE_PERM fail0001')
    expect(out).toContain('EXCLUDE_TEMP -')
  })
})
