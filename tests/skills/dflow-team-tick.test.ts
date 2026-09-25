// tests/skills/dflow-team-tick.test.ts
// 팀장 감시 루프(scripts/tick.sh)와 기상 블록(scripts/wake.sh). 2026-09-25: 팀장이 「2-2」 루프를 71번 다시 쓰고(약 97K자),
// 변화 없는 TICK 기상이 53건이던 것을 스크립트 한 줄 호출과 "변화 없는 TICK 은 연속 한 번까지만 건너뛴다"로 줄였다.
// 가짜 dflow.sh·sweep-check·tmux 로 실제 git 샌드박스에서 돌린다. 시간은 DFLOW_TICK_SEC·DFLOW_TICK_POLL 로 줄인다.
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { spawn, spawnSync } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const ROOT = process.cwd()
const TICK = join(ROOT, '.claude/skills/dflow-team/scripts/tick.sh')
const WAKE = join(ROOT, '.claude/skills/dflow-team/scripts/wake.sh')
const OWNER = 'hong/mbp/lead'
const PID = '4242'

const BASE_ENV: Record<string, string | undefined> = {
  ...process.env,
  GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t',
  GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1',
}
for (const k of Object.keys(BASE_ENV)) if (k.startsWith('DFLOW_') || k === 'CLAUDE_PID') delete BASE_ENV[k]

// 가짜 dflow.sh — 응답은 $FAKE/ 아래 파일로 정한다. 호출은 $FAKE/calls 에 한 줄씩 남긴다.
const FAKE_DFLOW = `#!/bin/sh
printf '%s\\n' "$*" >> "$FAKE/calls"
case "$1" in
  lease) [ -f "$FAKE/holder-fail" ] && exit 1; echo h1 ;;
  watch) [ -f "$FAKE/watch-fail" ] && exit 1; cat "$FAKE/watch.json" 2>/dev/null || echo '{"resume_requests":[]}' ;;
  config) echo p1 ;;
  show) f="$FAKE/show-$2.json"; [ -f "$f" ] || exit 7; cat "$f"; printf 'done %s\\n' "$*" >> "$FAKE/calls" ;;
  *) exit 2 ;;
esac
`
const FAKE_SWEEP = `#!/bin/sh
echo sweep >> "$FAKE/calls"
cat "$FAKE/sweep.out" 2>/dev/null || echo SWEEP_NONE
`
// 가짜 tmux — list-panes 의 pane_dead 를 $FAKE/pane-<id> 파일 값으로 낸다(없으면 빈 출력 = 사라진 pane)
const FAKE_TMUX = `#!/bin/sh
p=''; while [ $# -gt 0 ]; do [ "$1" = -t ] && p="$2"; shift; done
cat "$FAKE/pane-$p" 2>/dev/null || :
`

let tmp: string, repo: string, fake: string, wt: string, result: string
const ID8 = 'abcd1234'

function sh(cwd: string, script: string) {
  const r = spawnSync('bash', ['-c', script], { cwd, encoding: 'utf8', env: BASE_ENV as NodeJS.ProcessEnv })
  if (r.status !== 0) throw new Error(script + '\n' + r.stderr)
  return r.stdout
}
function envFor(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  return {
    ...BASE_ENV, FAKE: fake, DFLOW_SH: join(fake, 'dflow.sh'), DFLOW_SWEEP_CHECK: join(fake, 'sweep.sh'),
    DFLOW_TICK_SEC: '1', DFLOW_TICK_POLL: '0.1', ...extra,
  } as NodeJS.ProcessEnv
}
const baseArgs = (tm = '') => ['--tm', tm, '--owner', OWNER, '--slots', '3', '--until-label', '18:00', '--pid', PID]

// 루프를 띄우고 끝날 때까지 기다린다. during 은 띄운 뒤 ms 뒤에 한 번 돈다.
function tick(args: string[], opt: { env?: Record<string, string>; during?: () => void; after?: string; at?: number; timeout?: number } = {}): Promise<{ code: number | null; out: string; err: string }> {
  return new Promise((resolve, reject) => {
    const p = spawn('bash', [TICK, ...args], { cwd: repo, env: envFor(opt.env) })
    let out = '', err = ''
    p.stdout.on('data', (d) => { out += d })
    p.stderr.on('data', (d) => { err += d })
    const kill = setTimeout(() => { p.kill('SIGKILL'); reject(new Error('시간 초과\n' + out + err)) }, opt.timeout ?? 30000)
    // during 은 루프가 기준 지문을 잰 뒤(가짜 dflow.sh 호출 기록이 생긴 뒤)에 돈다. 기록이 없는 경우를 위해 at 뒤에는 무조건 돈다
    if (opt.during) {
      const t0 = Date.now()
      const iv = setInterval(() => {
        const ready = existsSync(join(fake, 'calls')) && readFileSync(join(fake, 'calls'), 'utf8').includes(opt.after ?? '\u0000')
        if (ready || Date.now() - t0 > (opt.at ?? 300)) { clearInterval(iv); opt.during!() }
      }, 20)
    }
    p.on('close', (code) => { clearTimeout(kill); resolve({ code, out, err }) })
  })
}
const lastLine = (out: string) => out.trim().split('\n').at(-1) ?? ''
const gen = () => readFileSync(join(repo, '.git', 'dflow-team.gen'), 'utf8').trim().split(' ')
const cksum = (line: string) => sh(repo, `printf '%s\\n' '${line}' | cksum | cut -d' ' -f1`).trim()
const entry = (hash = '-', pane = '-') => `${result}|${hash}|${pane}`
const show = (status: string, hb: string, id8 = ID8) =>
  writeFileSync(join(fake, `show-${id8}.json`), JSON.stringify({ order: { id: `${id8}-0000`, status, last_heartbeat_at: hb, heartbeat_phase: 'build' }, reports: [] }))
function lockOwner(pid = PID, who = OWNER) {
  mkdirSync(join(repo, '.git', 'dflow-team.lock'), { recursive: true })
  writeFileSync(join(repo, '.git', 'dflow-team.lock', 'owner'), `${who} 1 ${pid}\n`)
  writeFileSync(join(repo, '.git', 'dflow-team.lock', 'beat'), '1\n')
  writeFileSync(join(repo, '.git', 'dflow-team.lease.beat'), `${Math.floor(Date.now() / 1000)}\n`)
}

beforeEach(() => {
  tmp = realpathSync(mkdtempSync(join(tmpdir(), 'dflow-tick-')))
  repo = join(tmp, 'lead'); fake = join(tmp, 'fake')
  mkdirSync(repo); mkdirSync(fake)
  sh(repo, 'git init -q && git commit -q --allow-empty -m init')
  for (const [n, body] of [['dflow.sh', FAKE_DFLOW], ['sweep.sh', FAKE_SWEEP], ['tmux', FAKE_TMUX]] as const) {
    writeFileSync(join(fake, n), body); chmodSync(join(fake, n), 0o755)
  }
  wt = join(repo, '.claude', 'worktrees', `dflow-${ID8}`)
  mkdirSync(join(wt, 'docs', 'tasks', 'TSK-01-01'), { recursive: true })
  sh(wt, 'git init -q && git commit -q --allow-empty -m w')
  result = join(wt, 'docs', 'tasks', 'TSK-01-01', '.result')
  lockOwner()
  show('claimed', 't1')
})
afterEach(() => { rmSync(tmp, { recursive: true, force: true }) })

describe('tick.sh — 감시 루프의 종료 조건과 출력 토큰(「2-2」 그대로)', { timeout: 30000 }, () => {
  it('bash 로 파싱되고 실행 권한이 있다', () => {
    for (const f of [TICK, WAKE]) {
      expect(spawnSync('bash', ['-n', f]).status, f).toBe(0)
      expect(spawnSync('test', ['-x', f]).status, f).toBe(0)
    }
  })

  it('기동하면 세대를 올리고, --retire 로 세대를 올리면 옛 루프는 STALE 로 끝난다', async () => {
    writeFileSync(join(repo, '.git', 'dflow-team.gen'), '7 9999999999\n') // 옛 두 칸 형식도 읽는다
    const r = await tick([...baseArgs(), '--'], {
      env: { DFLOW_TICK_SEC: '60' },
      during: () => { spawnSync('bash', [TICK, '--retire'], { cwd: repo, env: envFor() }) },
    })
    expect(r.out.trim()).toBe('STALE')
    expect(gen()[0]).toBe('9')
  })

  it('종료 요청이 lease 상실·결과보다 먼저다', async () => {
    writeFileSync(join(repo, '.git', 'dflow-team.stop'), '')
    writeFileSync(join(repo, '.git', 'dflow-team.lease-lost'), 'LEASE_UNREACHABLE\n')
    writeFileSync(result, 'TSK-01-01 abcd1234 agent/x 1a2b 0 done ok\n')
    expect((await tick([...baseArgs(), '--', entry()])).out.trim()).toBe('STOP_REQUESTED')
  })

  it('lease 상실 표식이 있으면 결과보다 먼저 LEASE_LOST <사유> 로 끝난다', async () => {
    writeFileSync(join(repo, '.git', 'dflow-team.lease-lost'), 'LEASE_LOST p1\n')
    writeFileSync(result, 'TSK-01-01 abcd1234 agent/x 1a2b 0 done ok\n')
    expect((await tick([...baseArgs(), '--', entry()])).out.trim()).toBe('LEASE_LOST LEASE_LOST p1')
  })

  it('결과 줄 해시가 넘겨받은 해시와 다를 때만 RESULT_READY 다', async () => {
    const line = 'TSK-01-01 abcd1234 agent/x 1a2b 0 done ok'
    writeFileSync(result, line + '\n')
    expect((await tick([...baseArgs(), '--', entry()])).out.trim()).toBe(`RESULT_READY ${result}`)
    const same = await tick([...baseArgs(), '--', entry(cksum(line))])
    expect(same.out.trim()).toBe('TICK')
  })

  it('tmux pane 이 죽었거나 사라지면 PANE_DEAD, 살아 있으면 아니다. 결과 줄이 있으면 RESULT_READY 가 먼저다', async () => {
    const tm = join(fake, 'tmux')
    writeFileSync(join(fake, 'pane-%3'), '1\n')
    expect((await tick([...baseArgs(tm), '--', entry('-', '%3')])).out.trim()).toBe(`PANE_DEAD ${result}`)
    expect((await tick([...baseArgs(tm), '--', entry('-', '%9')])).out.trim()).toBe(`PANE_DEAD ${result}`) // 사라진 pane
    writeFileSync(join(fake, 'pane-%3'), '0\n')
    expect((await tick([...baseArgs(tm), '--', entry('-', '%3')])).out.trim()).toBe('TICK')
    writeFileSync(join(fake, 'pane-%3'), '1\n')
    writeFileSync(result, 'TSK-01-01 abcd1234 - - - failed x\n')
    expect((await tick([...baseArgs(tm), '--', entry('-', '%3')])).out.trim()).toBe(`RESULT_READY ${result}`)
  })

  it('--may-skip 이 없으면 TICK 을 건너뛰지 않는다(종전 동작). --new-tick 은 다음 TICK 을 새로 정하고 건너뛴 수를 0 으로 둔다', async () => {
    writeFileSync(join(repo, '.git', 'dflow-team.gen'), '3 1 1\n')
    const r = await tick(['--new-tick', ...baseArgs(), '--'])
    expect(r.out.trim()).toBe('TICK')
    const [g, at, sk] = gen()
    expect(g).toBe('4'); expect(Number(at)).toBeGreaterThan(1); expect(sk).toBe('0')
  })

  it('--new-tick 이 없으면 세대 파일의 다음 TICK 시각을 그대로 쓴다', async () => {
    writeFileSync(join(repo, '.git', 'dflow-team.gen'), `3 ${Math.floor(Date.now() / 1000) - 5} 0\n`)
    const t0 = Date.now()
    expect((await tick([...baseArgs(), '--'], { env: { DFLOW_TICK_SEC: '60' } })).out.trim()).toBe('TICK')
    expect(Date.now() - t0).toBeLessThan(5000)
  })
})

describe('tick.sh — 변화 없는 TICK 은 연속 한 번까지만 건너뛴다((가) 방식)', { timeout: 60000 }, () => {
  it('한가한 팀(진행 슬롯 없음·승인 후보 변화 없음): 첫 TICK 을 건너뛰며 beat·watch 를 보내고, 둘째 TICK 은 반드시 낸다', async () => {
    const r = await tick(['--new-tick', '--may-skip', ...baseArgs(), '--'])
    const lines = r.out.trim().split('\n')
    expect(lines[0]).toMatch(/^TICK_SKIPPED at=\d+ next=\d+$/)
    expect(lastLine(r.out)).toBe('TICK')
    expect(lines.filter((l) => l === 'TICK')).toHaveLength(1)
    expect(gen()[2]).toBe('1')
    // 건너뛸 때 잠금 beat 를 갱신하고 좌석표 watch 를 보냈다(STANDBY 70분이 끊기지 않게)
    expect(Number(readFileSync(join(repo, '.git', 'dflow-team.lock', 'beat'), 'utf8'))).toBeGreaterThan(1)
    const calls = readFileSync(join(fake, 'calls'), 'utf8')
    expect(calls).toMatch(/^watch --agent hong\/mbp\/lead --slots 3 --busy 0 --until 18:00 --json --holder h1$/m)
  })

  it('건너뛴 뒤 루프를 바꿔도(--new-tick 없이) 건너뛴 수가 이어져 다음 TICK 은 곧바로 낸다', async () => {
    writeFileSync(join(repo, '.git', 'dflow-team.gen'), `5 ${Math.floor(Date.now() / 1000)} 1\n`)
    const r = await tick(['--may-skip', ...baseArgs(), '--'])
    expect(r.out.trim()).toBe('TICK')
  })

  it('진행 슬롯의 생존 증거가 그대로면(무응답 30분) 건너뛰지 않는다', async () => {
    const r = await tick(['--new-tick', '--may-skip', ...baseArgs(), '--', entry()])
    expect(r.out.trim()).toBe('TICK')
  })

  it('진행 슬롯이 움직였으면 건너뛰고, 그때의 증거를 EVIDENCE 줄로 남긴다', async () => {
    const r = await tick(['--new-tick', '--may-skip', ...baseArgs(), '--', entry()], {
      during: () => { writeFileSync(join(wt, 'new.txt'), 'x'); show('claimed', 't2') }, after: 'sweep', at: 10000, env: { DFLOW_TICK_SEC: '6' },
    })
    const lines = r.out.trim().split('\n')
    expect(lines[0]).toMatch(/^TICK_SKIPPED /)
    expect(lines[1]).toMatch(new RegExp(`^EVIDENCE ${ID8} ct=\\d+ report=- heartbeat=t2 phase=build dirty=\\d+ status=claimed$`))
    expect(lastLine(r.out)).toBe('TICK')
  })

  it('답을 기다리는 blocked 슬롯은 무응답으로 세지 않는다', async () => {
    const line = 'TSK-01-01 abcd1234 agent/x 1a2b - blocked 질문?'
    writeFileSync(result, line + '\n')
    const r = await tick(['--new-tick', '--may-skip', ...baseArgs(), '--', entry(cksum(line))])
    expect(r.out.trim().split('\n')[0]).toMatch(/^TICK_SKIPPED /)
  })

  it('서버 status 가 바뀌었거나(중단 등) show 가 실패하면 건너뛰지 않는다', async () => {
    const changed = await tick(['--new-tick', '--may-skip', ...baseArgs(), '--', entry()], {
      during: () => { writeFileSync(join(wt, 'new.txt'), 'x'); show('cancelled', 't2') }, after: 'sweep', at: 10000, env: { DFLOW_TICK_SEC: '6' },
    })
    expect(changed.out.trim()).toBe('TICK')
    rmSync(join(fake, `show-${ID8}.json`))
    expect((await tick(['--new-tick', '--may-skip', ...baseArgs(), '--', entry()])).out.trim()).toBe('TICK')
  })

  it('승인 후보의 서버 status 가 바뀌면(사람이 승인) 건너뛰지 않는다. 판정 불가도 건너뛰지 않는다', async () => {
    writeFileSync(join(fake, 'sweep.out'), 'SWEEP_CANDIDATES n=1 feed0001\n')
    show('reported', '-', 'feed0001')
    const approved = await tick(['--new-tick', '--may-skip', ...baseArgs(), '--'], { during: () => show('approved', '-', 'feed0001'), after: 'done show feed0001', at: 10000, env: { DFLOW_TICK_SEC: '6' } })
    expect(approved.out.trim()).toBe('TICK')
    // 후보가 그대로면 건너뛴다
    const same = await tick(['--new-tick', '--may-skip', ...baseArgs(), '--'])
    expect(same.out.trim().split('\n')[0]).toMatch(/^TICK_SKIPPED /)
    writeFileSync(join(fake, 'sweep.out'), 'SWEEP_UNKNOWN fetch\n')
    expect((await tick(['--new-tick', '--may-skip', ...baseArgs(), '--'])).out.trim()).toBe('TICK')
  })

  it('종료 시각이 지났거나 읽을 수 없으면 건너뛰지 않는다(poll 이 없을 때의 종료 시각 확인)', async () => {
    expect((await tick(['--new-tick', '--may-skip', '--until', '2000-01-01 00:00', ...baseArgs(), '--'])).out.trim()).toBe('TICK')
    expect((await tick(['--new-tick', '--may-skip', '--until', 'nonsense', ...baseArgs(), '--'])).out.trim()).toBe('TICK')
    const later = await tick(['--new-tick', '--may-skip', '--until', 'none', ...baseArgs(), '--'])
    expect(later.out.trim().split('\n')[0]).toMatch(/^TICK_SKIPPED /)
  })

  it('잠금 소유가 아니거나 lease 갱신이 죽었거나 이 리포의 재개 요청이 있으면 건너뛰지 않는다', async () => {
    lockOwner('999')
    expect((await tick(['--new-tick', '--may-skip', ...baseArgs(), '--'])).out.trim()).toBe('TICK')
    lockOwner()
    writeFileSync(join(repo, '.git', 'dflow-team.lease.beat'), '1\n')
    expect((await tick(['--new-tick', '--may-skip', ...baseArgs(), '--'])).out.trim()).toBe('TICK')
    lockOwner()
    writeFileSync(join(fake, 'watch.json'), JSON.stringify({ resume_requests: [{ id8: 'x', project_id: 'p1', host: 'mbp' }] }))
    expect((await tick(['--new-tick', '--may-skip', ...baseArgs(), '--'])).out.trim()).toBe('TICK')
    writeFileSync(join(fake, 'watch.json'), JSON.stringify({ resume_requests: null, resume_requests_error: 'db' }))
    expect((await tick(['--new-tick', '--may-skip', ...baseArgs(), '--'])).out.trim()).toBe('TICK')
  })
})

describe('wake.sh — 기상 블록(「2-3」)', () => {
  const wake = (args: string[], env: Record<string, string> = {}) =>
    spawnSync('bash', [WAKE, '--owner', OWNER, '--slots', '4', '--busy', '2', '--until-label', '09-21 06:00', ...args], { cwd: repo, encoding: 'utf8', env: envFor(env) })

  it('소유가 맞으면 beat 를 갱신하고 LOCK_OK, 재개 요청을 이 리포 바인딩으로 거르고, events.md 기록 명령을 띄운다', () => {
    writeFileSync(join(fake, 'watch.json'), JSON.stringify({ resume_requests: [
      { id8: 'aaaa0001', code: 'c', host: 'mbp', requested_at: 't', project_id: 'p1' },
      { id8: 'bbbb0002', project_id: 'p9' },
    ] }))
    const r = wake(['--pid', PID])
    const lines = r.stdout.split('\n')
    expect(lines[0]).toBe('LOCK_OK')
    expect(JSON.parse(lines[1])).toEqual({ n: 2, err: '-', reqs: [{ id8: 'aaaa0001', code: 'c', host: 'mbp', requested_at: 't' }], other_project: ['bbbb0002'] })
    expect(Number(readFileSync(join(repo, '.git', 'dflow-team.lock', 'beat'), 'utf8'))).toBeGreaterThan(1)
    expect(r.stdout).toContain('## 기록 명령')
    expect(readFileSync(join(fake, 'calls'), 'utf8')).toContain("watch --agent hong/mbp/lead --slots 4 --busy 2 --until 09-21 06:00 --json --holder h1")
    expect(wake(['--pid', PID, '--no-events']).stdout).not.toContain('## 기록 명령')
  })

  it('팀장 세션 PID 는 --pid, 없으면 CLAUDE_PID 다(스크립트 안의 $PPID 는 팀장이 아니다)', () => {
    expect(wake([], { CLAUDE_PID: PID }).stdout.split('\n')[0]).toBe('LOCK_OK')
    expect(wake([], { CLAUDE_PID: '1' }).stdout.split('\n')[0]).toBe(`LOCK_LOST owner=${OWNER} 1 ${PID} 내 PID=1`)
  })

  it('소유가 아니면 beat 를 건드리지 않고 LOCK_LOST 다', () => {
    lockOwner('999')
    const r = wake(['--pid', PID])
    expect(r.stdout.split('\n')[0]).toBe(`LOCK_LOST owner=${OWNER} 1 999 내 PID=${PID}`)
    expect(readFileSync(join(repo, '.git', 'dflow-team.lock', 'beat'), 'utf8').trim()).toBe('1')
    expect(existsSync(join(fake, 'calls')) && readFileSync(join(fake, 'calls'), 'utf8').includes('watch')).toBe(false)
  })

  it('holder 조회가 실패하면 watch 를 부르지 않고 HOLDER_FAILED, watch 가 실패하면 WATCH_FAILED', () => {
    writeFileSync(join(fake, 'holder-fail'), '')
    expect(wake(['--pid', PID]).stdout.split('\n').slice(0, 2)).toEqual(['LOCK_OK', 'HOLDER_FAILED'])
    expect(existsSync(join(fake, 'calls')) && readFileSync(join(fake, 'calls'), 'utf8').includes('watch')).toBe(false)
    rmSync(join(fake, 'holder-fail')); writeFileSync(join(fake, 'watch-fail'), '')
    expect(wake(['--pid', PID]).stdout.split('\n').slice(0, 2)).toEqual(['LOCK_OK', 'WATCH_FAILED'])
  })

  it('lease 갱신 beat 가 3분보다 오래되면 LEASE_KEEP_DEAD 를 낸다', () => {
    writeFileSync(join(repo, '.git', 'dflow-team.lease.beat'), '100\n')
    expect(wake(['--pid', PID, '--no-events']).stdout).toMatch(/^LEASE_KEEP_DEAD 마지막 갱신 100$/m)
  })
})
