// tests/skills/dflow-heavy-pools.test.ts
// heavy.sh 의 E2E 풀·독점 실행(--exclusive)·분리 실행(--detach / wait) — 설계 docs/superpowers/specs/2026-09-26-dflow-perf-audit-kit-design.md ①②④.
// 실제 스크립트를 임시 DFLOW_HEAVY_DIR·DFLOW_HEAVY_JOBS 로 돌린다(사용자 홈의 ~/.dflow 를 건드리지 않는다).
//
// 신원 주의: DFLOW_HEAVY_OWNER 가 비면 owner 는 PPID(= 이 vitest 프로세스)라 기본 호출은 모두 같은 세션이다.
// 다른 세션이 필요하면 OWNER 를 따로 준다. kill -0 1 은 권한 때문에 실패하므로 '1' 은 기다리는 쪽에만 쓰고,
// 보유자·표식의 주인은 process.pid 나 따로 띄운 sleep 자식으로 한다.
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const ROOT = process.cwd()
const HEAVY = join(ROOT, '.claude/skills/dflow-dev/scripts/heavy.sh')

let tmp: string, dir: string, jobs: string
const kids: ChildProcess[] = []
const nowS = () => Math.floor(Date.now() / 1000)

function env(extra: Record<string, string> = {}) {
  return {
    ...process.env,
    DFLOW_HEAVY_DIR: dir, DFLOW_HEAVY_JOBS: jobs, DFLOW_HEAVY_SLOTS: '1', DFLOW_HEAVY_WAIT: '10', DFLOW_HEAVY_POLL: '0.2',
    DFLOW_HEAVY_OWNER: '', CLAUDE_PID: '', DFLOW_HEAVY_E2E_SLOTS: '', DFLOW_HEAVY_EXCL_TTL: '', DFLOW_HEAVY_DETACH_WAIT: '',
    // 이 PC 의 실제 부하가 슬롯 배정을 흔들지 않게 부하 검사를 끈다(부하 검사는 dflow-heavy-load.test.ts 가 본다)
    DFLOW_HEAVY_LOAD_MAX: '0',
    ...extra,
  }
}
function run(args: string[], extra: Record<string, string> = {}, cwd = ROOT) {
  const r = spawnSync('bash', [HEAVY, ...args], { encoding: 'utf8', env: env(extra), timeout: 30000, cwd })
  return { code: r.status, out: (r.stdout || '') + (r.stderr || ''), err: r.stderr || '', stdout: r.stdout || '' }
}
function start(args: string[], extra: Record<string, string> = {}) {
  const p = spawn('bash', [HEAVY, ...args], { env: env(extra), stdio: ['ignore', 'pipe', 'pipe'] })
  let out = ''
  p.stdout!.on('data', (b) => { out += b })
  p.stderr!.on('data', (b) => { out += b })
  const done = new Promise<{ code: number | null; out: string }>((res) => p.on('close', (code) => res({ code, out })))
  kids.push(p)
  return { p, done, out: () => out }
}
/** 다른 세션 흉내 — 살아 있는 PID 하나 */
function sleeper() {
  const p = spawn('sleep', ['60'], { stdio: 'ignore' })
  kids.push(p)
  return p.pid!
}
async function until(pred: () => boolean, ms = 10000) {
  const t0 = Date.now()
  while (!pred()) {
    if (Date.now() - t0 > ms) throw new Error('timeout waiting for condition')
    await new Promise((r) => setTimeout(r, 50))
  }
}
const owner = (name: string) => readFileSync(join(dir, name, 'owner'), 'utf8')
const liveSlot = (name: string, pid: number, kind = 'run', cmd = 'live') => {
  mkdirSync(join(dir, name), { recursive: true })
  writeFileSync(join(dir, name, 'owner'), `pid=${pid}\nkind=${kind}\nstart=${nowS()}\npstart=-\ncwd=/x\ncmd=${cmd}\n`)
}
/** 독점 표식. hpid 를 주지 않으면 hpid 필드가 없는 옛 형식(excl-<pid>), 주면 새 형식(excl-<pid>-<hpid|n>) — '-' 는 재호출 대기(gap) */
const exclMark = (pid: number | string, o: { start?: number; seen?: number; cmd?: string; hpid?: number | string } = {}) => {
  mkdirSync(dir, { recursive: true })
  const name = o.hpid === undefined ? `excl-${pid}` : `excl-${pid}-${o.hpid === '-' ? 9999999 : o.hpid}`
  const hp = o.hpid === undefined ? '' : `hpid=${o.hpid}\nhpstart=-\n`
  writeFileSync(join(dir, name),
    `pid=${pid}\npstart=-\n${hp}start=${o.start ?? nowS()}\nseen=${o.seen ?? nowS()}\ncwd=/x\ncmd=${o.cmd ?? 'perf'}\n`)
  return join(dir, name)
}
/** 이 세션(소유 PID)의 독점 표식 파일 이름들 — 표식은 호출마다 excl-<소유 PID>-<heavy.sh PID> 다 */
const exclFiles = (pid: number | string) => existsSync(dir) ? readdirSync(dir).filter((n) => n.startsWith(`excl-${pid}-`)) : []
const alive = (pid: number) => { try { process.kill(pid, 0); return true } catch { return false } }
const DEAD = () => Number(spawnSync('sh', ['-c', 'echo $$']).stdout.toString().trim())

beforeEach(() => {
  tmp = realpathSync(mkdtempSync(join(tmpdir(), 'dflow-heavy-pools-')))
  dir = join(tmp, 'locks')
  jobs = join(tmp, 'jobs')
})
afterEach(() => {
  for (const k of kids.splice(0)) { try { k.kill('SIGKILL') } catch { /* 이미 끝남 */ } }
  // 분리 실행 잡은 자기 프로세스 그룹에 뜬다 — 그룹째 거둔다
  if (existsSync(jobs)) {
    for (const id of readdirSync(jobs)) {
      const pf = join(jobs, id, 'pid')
      if (!existsSync(pf)) continue
      const pid = Number(readFileSync(pf, 'utf8').trim())
      try { process.kill(-pid, 'SIGKILL') } catch { try { process.kill(pid, 'SIGKILL') } catch { /* 이미 끝남 */ } }
    }
  }
  rmSync(tmp, { recursive: true, force: true })
})

describe('heavy.sh — E2E 풀(acquire 가 e2e-<i> 를 잡는다)', { timeout: 30000 }, () => {
  const me = () => ({ DFLOW_HEAVY_OWNER: String(process.pid) })

  it('acquire 는 일반 슬롯이 아니라 e2e-1 을 잡고, 다른 세션의 게이트는 굶지 않는다(K=1)', () => {
    const a = run(['acquire', 'e2e-TSK-01'], me())
    expect(a.code).toBe(0)
    expect(a.err).toContain(`HEAVY_ACQUIRED e2e-1 owner=${process.pid} e2e=1`)
    expect(owner('e2e-1')).toContain('kind=hold')
    expect(owner('e2e-1')).toContain('cmd=hold e2e-TSK-01')
    expect(existsSync(join(dir, 'slot-1'))).toBe(false)
    // 다른 세션(OWNER=1 — 기다리는 쪽이라 살아 있을 필요가 없다)의 게이트는 일반 슬롯에서 곧바로 돈다
    const gate = run(['sh', '-c', 'echo "gate held=$DFLOW_HEAVY_HELD"'], { DFLOW_HEAVY_OWNER: '1', DFLOW_HEAVY_WAIT: '0' })
    expect(gate.code).toBe(0)
    expect(gate.out).toContain('HEAVY_SLOT slot-1 k=1')
    expect(gate.out).toContain(`gate held=${join(dir, 'slot-1')}`)
    // 다시 acquire 해도 새 슬롯을 잡지 않는다
    expect(run(['acquire', 'x'], me()).err).toContain('HEAVY_ACQUIRED e2e-1 (이미 보유)')
  })

  it('E2E hold 안의 heavy.sh <명령> 은 그 hold 를 다시 쓰고(REUSE), --pool docker 는 도커 슬롯만 더 잡는다', () => {
    expect(run(['acquire', 'srv'], me()).code).toBe(0)
    liveSlot('slot-1', process.pid, 'run', 'other-gate') // 일반 슬롯이 차 있어도 기다리지 않는다
    const r = run(['sh', '-c', 'echo "held=$DFLOW_HEAVY_HELD"'], { ...me(), DFLOW_HEAVY_WAIT: '0' })
    expect(r.code).toBe(0)
    expect(r.err).toContain('HEAVY_REUSE e2e-1')
    expect(r.out).toContain(`held=${join(dir, 'e2e-1')}`)
    const d = run(['--pool', 'docker', 'echo', 'docker-ran'], { ...me(), DFLOW_HEAVY_WAIT: '0' })
    expect(d.code).toBe(0)
    expect(d.err).toContain('HEAVY_REUSE e2e-1')
    expect(d.err).toContain('HEAVY_DOCKER_SLOT docker-1 docker=1')
    expect(d.err).not.toContain('+ slot-')
    expect(d.out).toContain('docker-ran')
  })

  it('release 는 E2E 풀 슬롯을 푼다', () => {
    expect(run(['acquire', 'srv'], me()).code).toBe(0)
    const rel = run(['release'], me())
    expect(rel.err).toContain(`HEAVY_RELEASED e2e-1 owner=${process.pid}`)
    expect(existsSync(join(dir, 'e2e-1'))).toBe(false)
    expect(run(['release'], me()).err).toContain('HEAVY_RELEASED none')
  })

  it('E2E 풀이 차 있으면 다른 세션의 acquire 는 HEAVY_BUSY e2e=1 과 exit 75', () => {
    expect(run(['acquire', 'srv-A'], me()).code).toBe(0)
    const b = run(['acquire', 'srv-B'], { DFLOW_HEAVY_OWNER: '1', DFLOW_HEAVY_WAIT: '0' })
    expect(b.code).toBe(75)
    expect(b.err).toMatch(/^HEAVY_BUSY e2e=1 wait=0s 보유: \[e2e-1 pid=\d+ \d+분 hold\] hold srv-A$/m)
  })

  it('죽은 소유자·TTL 이 지난 E2E hold 는 기존 hold 규칙대로 회수한다', () => {
    const dead = DEAD()
    expect(run(['acquire', 'srv'], { DFLOW_HEAVY_OWNER: String(dead) }).code).toBe(0)
    let r = run(['acquire', 'srv2'], { DFLOW_HEAVY_OWNER: '1', DFLOW_HEAVY_WAIT: '2' })
    expect(r.code).toBe(0)
    expect(r.err).toContain(`HEAVY_RECLAIM e2e-1 pid=${dead} kind=hold`)
    rmSync(join(dir, 'e2e-1'), { recursive: true, force: true })
    expect(run(['acquire', 'srv'], me()).code).toBe(0)
    writeFileSync(join(dir, 'e2e-1', 'owner'), owner('e2e-1').replace(/^start=\d+$/m, 'start=1'))
    r = run(['acquire', 'srv2'], { DFLOW_HEAVY_OWNER: '1', DFLOW_HEAVY_WAIT: '2' })
    expect(r.code).toBe(0)
    expect(r.err).toContain('HEAVY_RECLAIM e2e-1')
  })

  it('status 의 held 는 일반 풀만 세고, E2E 풀은 stderr 의 HEAVY_E2E 줄에 보인다', () => {
    expect(run(['acquire', 'srv'], me()).code).toBe(0)
    const s = run(['status'])
    expect(s.stdout).toBe('HEAVY_STATUS slots=1 held=0 waiting=0\n')
    expect(s.err).toMatch(/^HEAVY_E2E e2e=1 held=1 waiting=0 \[e2e-1 pid=\d+ \d+분 hold\] hold srv$/m)
    expect(run(['status'], { DFLOW_HEAVY_E2E_SLOTS: '0' }).err).toContain('HEAVY_E2E e2e=0')
  })

  it('DFLOW_HEAVY_E2E_SLOTS=0 이면 옛 동작 — acquire 가 일반 슬롯을 잡는다', () => {
    const a = run(['acquire', 'srv'], { ...me(), DFLOW_HEAVY_E2E_SLOTS: '0' })
    expect(a.err).toContain(`HEAVY_ACQUIRED slot-1 owner=${process.pid} k=1`)
    expect(existsSync(join(dir, 'e2e-1'))).toBe(false)
    expect(run(['status'], { DFLOW_HEAVY_E2E_SLOTS: '0' }).stdout).toBe('HEAVY_STATUS slots=1 held=1 waiting=0\n')
    // 개수를 바꿔도 이미 잡힌 hold 는 찾는다 — 기본값(E2E 풀 켬)으로 부른 release 도 slot-1 을 푼다
    expect(run(['release'], me()).err).toContain('HEAVY_RELEASED slot-1')
  })
})

describe('heavy.sh --exclusive — 독점 실행', { timeout: 30000 }, () => {
  const me = () => ({ DFLOW_HEAVY_OWNER: String(process.pid) })
  const K2 = { DFLOW_HEAVY_SLOTS: '2' }

  it('일반 슬롯 K개를 모두 잡고 돈다 — 안에서 본 status 는 held=K, snapshot 은 RUN run general 한 줄. 끝나면 슬롯·표식을 푼다', () => {
    const r = run(['--exclusive', 'sh', '-c',
      `echo "held=$DFLOW_HEAVY_HELD"; bash '${HEAVY}' status; bash '${HEAVY}' snapshot; ls '${dir}'; exit 5`], { ...K2, ...me() })
    expect(r.code).toBe(5)
    expect(r.err).toContain('HEAVY_EXCL k=2')
    expect(r.out).toContain(`held=${join(dir, 'slot-1')}`)
    expect(r.stdout).toContain('HEAVY_STATUS slots=2 held=2 waiting=0')
    const runs = r.stdout.split('\n').filter((l) => l.startsWith('RUN\t')).map((l) => l.split('\t'))
    expect(runs).toHaveLength(1)
    expect(runs[0].slice(2, 4)).toEqual(['run', 'general'])
    expect(r.stdout).toMatch(/^PC\t2\t2\t0\t/m)
    expect(r.stdout).toMatch(new RegExp(`^excl-${process.pid}-\\d+$`, 'm')) // 도는 동안 표식이 있다
    expect(readdirSync(dir).filter((n) => /^(slot-|excl-|wait-)/.test(n))).toEqual([])
  })

  it('전부 아니면 없음 — 하나라도 못 잡으면 잡은 것을 쥐고 기다리지 않고, 상한이 지나면 HEAVY_BUSY(exit 75)·표식은 남긴다', async () => {
    const other = sleeper()
    liveSlot('slot-2', other, 'run', 'other-gate')
    const marker = join(tmp, 'ran')
    const x = start(['--exclusive', 'sh', '-c', `touch '${marker}'`], { ...K2, ...me(), DFLOW_HEAVY_WAIT: '2' })
    await until(() => x.out().includes('HEAVY_EXCL_WAIT'))
    // 기다리는 동안 slot-1 은 비어 있다(부분 보유 없음). 폴링 사이의 순간 보유를 피하려고 여러 번 본다
    let heldSeen = 0
    for (let i = 0; i < 10; i++) {
      if (existsSync(join(dir, 'slot-1', 'owner')) && owner('slot-1').includes(`pid=${x.p.pid}`)) heldSeen++
      await new Promise((r) => setTimeout(r, 60))
    }
    expect(heldSeen).toBeLessThanOrEqual(2)
    const r = await x.done
    expect(r.code).toBe(75)
    expect(r.out).toMatch(/^HEAVY_BUSY k=2 wait=2s 독점 대기\(순번 1\/1, 표식은 남긴다\) 보유: .*\[slot-2 pid=\d+ \d+분 run\] other-gate$/m)
    expect(existsSync(marker)).toBe(false)
    expect(existsSync(join(dir, 'slot-1'))).toBe(false)
    // 표식은 재호출 대기(gap — hpid=-)로 남는다
    expect(exclFiles(process.pid)).toHaveLength(1)
    expect(readFileSync(join(dir, exclFiles(process.pid)[0]), 'utf8')).toMatch(/^hpid=-$/m)
    expect(readdirSync(dir).filter((n) => n.startsWith('wait-'))).toEqual([])
  })

  it('재호출하면 표식의 start 는 지키고 seen 만 새로 쓴다', () => {
    liveSlot('slot-1', sleeper())
    expect(run(['--exclusive', 'true'], { ...me(), DFLOW_HEAVY_WAIT: '0' }).code).toBe(75)
    const f = join(dir, exclFiles(process.pid)[0])
    writeFileSync(f, readFileSync(f, 'utf8').replace(/^start=\d+$/m, `start=${nowS() - 100}`).replace(/^seen=\d+$/m, `seen=${nowS() - 50}`))
    const before = readFileSync(f, 'utf8')
    expect(run(['--exclusive', 'true'], { ...me(), DFLOW_HEAVY_WAIT: '0' }).code).toBe(75)
    // 새 호출은 이 세션의 재호출 대기 표식을 이어받는다(이름은 새 호출의 것, 표식은 하나)
    expect(exclFiles(process.pid)).toHaveLength(1)
    expect(existsSync(f)).toBe(false)
    const after = readFileSync(join(dir, exclFiles(process.pid)[0]), 'utf8')
    expect(after.match(/^start=(\d+)$/m)![1]).toBe(before.match(/^start=(\d+)$/m)![1])
    expect(Number(after.match(/^seen=(\d+)$/m)![1])).toBeGreaterThan(Number(before.match(/^seen=(\d+)$/m)![1]))
  })

  it('기다리는 동안 seen 을 새로 써서 TTL 보다 오래 기다려도(분리 실행) 표식을 잃지 않는다', async () => {
    liveSlot('slot-1', sleeper())
    const x = start(['--exclusive', 'true'], { ...me(), DFLOW_HEAVY_WAIT: '5', DFLOW_HEAVY_EXCL_TTL: '1' })
    await until(() => x.out().includes('HEAVY_EXCL_WAIT'))
    await new Promise((r) => setTimeout(r, 2500))
    // 다른 세션의 호출이 excl_live 로 죽은 표식을 거둔다 — 기다리는 쪽의 표식은 살아 있어야 한다
    expect(run(['status'], { DFLOW_HEAVY_OWNER: '1', DFLOW_HEAVY_EXCL_TTL: '1' }).err).toContain('HEAVY_EXCL [excl pid=')
    expect(exclFiles(process.pid)).toHaveLength(1)
    const r = await x.done
    expect(r.code).toBe(75)
  })

  it('다른 세션의 살아 있는 독점 표식이 있으면 일반 take 는 빈 슬롯도 잡지 않고 양보한다. 자기 세션의 표식에는 양보하지 않는다', () => {
    const other = sleeper()
    exclMark(other, { cmd: 'perf-bench' })
    const r = run(['echo', 'gate'], { DFLOW_HEAVY_OWNER: '1', DFLOW_HEAVY_WAIT: '1' })
    expect(r.code).toBe(75)
    expect(r.err).toMatch(/^HEAVY_BUSY k=1 wait=1s 보유:  독점 대기: \[excl pid=\d+ \d+분\] perf-bench$/m)
    expect(r.out).not.toContain('gate\n')
    // 도커 풀의 일반 슬롯도 양보한다
    expect(run(['--pool', 'docker', 'true'], { DFLOW_HEAVY_OWNER: '1', DFLOW_HEAVY_WAIT: '1' }).code).toBe(75)
    // E2E 풀을 끈 acquire 도 일반 take 라 양보한다. E2E 풀 acquire 는 막지 않는다
    expect(run(['acquire', 'srv'], { DFLOW_HEAVY_OWNER: '1', DFLOW_HEAVY_WAIT: '1', DFLOW_HEAVY_E2E_SLOTS: '0' }).code).toBe(75)
    const e = run(['acquire', 'srv'], { DFLOW_HEAVY_OWNER: String(process.pid), DFLOW_HEAVY_WAIT: '0' })
    expect(e.err).toContain('HEAVY_ACQUIRED e2e-1')
    expect(run(['release'], me()).code).toBe(0)
    // 표식의 주인 세션 자신은 막히지 않는다
    const mine = run(['echo', 'own-gate'], { DFLOW_HEAVY_OWNER: String(other), DFLOW_HEAVY_WAIT: '0' })
    expect(mine.code).toBe(0)
    expect(mine.out).toContain('own-gate')
    expect(run(['status']).err).toMatch(/^HEAVY_EXCL \[excl pid=\d+ \d+분\] perf-bench$/m)
  })

  it('주인이 죽었거나 TTL(seen 기준)이 지난 표식은 무시하고 회수한다', () => {
    const dead = DEAD()
    exclMark(dead)
    let r = run(['echo', 'after-dead'], { DFLOW_HEAVY_WAIT: '0' })
    expect(r.code).toBe(0)
    expect(existsSync(join(dir, `excl-${dead}`))).toBe(false)
    const other = sleeper()
    exclMark(other, { start: 1, seen: nowS() - 100 })
    r = run(['echo', 'after-ttl'], { DFLOW_HEAVY_WAIT: '0', DFLOW_HEAVY_EXCL_TTL: '60' })
    expect(r.code).toBe(0)
    expect(r.out).toContain('after-ttl')
    expect(existsSync(join(dir, `excl-${other}`))).toBe(false)
  })

  it('표식이 여럿이면 가장 오래된 것만 진행한다 — 뒤의 독점은 슬롯이 비어도 기다린다', () => {
    const first = sleeper()
    exclMark(first, { start: nowS() - 100 })
    const r = run(['--exclusive', 'echo', 'second'], { ...me(), DFLOW_HEAVY_WAIT: '1' })
    expect(r.code).toBe(75)
    expect(r.err).toContain('독점 대기(순번 2/2')
    expect(r.out).not.toContain('second\n')
    rmSync(join(dir, `excl-${first}`))
    const r2 = run(['--exclusive', 'echo', 'second'], { ...me(), DFLOW_HEAVY_WAIT: '2' })
    expect(r2.code).toBe(0)
    expect(r2.out).toContain('second')
    expect(exclFiles(process.pid)).toEqual([])
  })

  it('이미 슬롯을 쥔 세션(감싼 실행 안·acquire)에서 부르면 HEAVY_EXCL_NESTED 와 exit 2', () => {
    const inner = run(['sh', '-c', `bash '${HEAVY}' --exclusive echo x`], { DFLOW_HEAVY_WAIT: '0' })
    expect(inner.code).toBe(2)
    expect(inner.err).toContain('HEAVY_EXCL_NESTED 감싼 실행 안(slot-1)')
    expect(run(['acquire', 'srv'], me()).code).toBe(0)
    const held = run(['--exclusive', 'echo', 'x'], { ...me(), DFLOW_HEAVY_WAIT: '0' })
    expect(held.code).toBe(2)
    expect(held.err).toContain('HEAVY_EXCL_NESTED')
    expect(held.err).toContain('e2e-1')
    expect(exclFiles(process.pid)).toEqual([])
  })

  it('기다리다 신호로 끝나면 표식과 대기 표식을 지운다', async () => {
    liveSlot('slot-1', sleeper())
    const x = start(['--exclusive', 'true'], { ...me(), DFLOW_HEAVY_WAIT: '20' })
    await until(() => existsSync(join(dir, `wait-${x.p.pid}`)))
    expect(exclFiles(process.pid)).toHaveLength(1)
    x.p.kill('SIGTERM')
    expect((await x.done).code).toBe(143)
    expect(readdirSync(dir).filter((n) => /^(excl-|wait-)/.test(n))).toEqual([])
  })

  it('--pool docker 와 함께 쓰거나 하위 명령에 붙이면 exit 2', () => {
    expect(run(['--exclusive', '--pool', 'docker', 'true']).code).toBe(2)
    for (const a of [['status'], ['acquire', 'x'], []]) expect(run(['--exclusive', ...a]).code).toBe(2)
  })
})

describe('heavy.sh --detach / wait — 분리 실행과 폴링', { timeout: 60000 }, () => {
  const detach = (args: string[], extra: Record<string, string> = {}) => {
    const t0 = Date.now()
    const r = run(['--detach', ...args], extra)
    const m = r.stdout.match(/^HEAVY_DETACHED id=(\S+) pid=(\d+) log=(\S+)$/m)
    return { ...r, took: Date.now() - t0, id: m?.[1] ?? '', pid: Number(m?.[2]), log: m?.[3] ?? '' }
  }

  it('곧바로 HEAVY_DETACHED 로 돌아오고(자식이 출력 파이프를 물지 않는다), 슬롯 소유자는 분리된 자식이다. wait 가 로그 끝과 rc 를 돌려준다', async () => {
    const d = detach(['sh', '-c', 'echo job-start; sleep 1.5; echo job-end; exit 3'])
    expect(d.code).toBe(0)
    expect(d.took).toBeLessThan(3000)
    expect(d.id).toMatch(/^[0-9]{8}-[0-9]{6}-\d+/)
    expect(d.log).toBe(join(jobs, d.id, 'log'))
    const jd = join(jobs, d.id)
    for (const f of ['cmd', 'cwd', 'start', 'pid', 'log']) expect(existsSync(join(jd, f))).toBe(true)
    expect(readFileSync(join(jd, 'cmd'), 'utf8').trim()).toBe('sh -c echo job-start; sleep 1.5; echo job-end; exit 3')
    await until(() => existsSync(join(dir, 'slot-1', 'owner')))
    const slotPid = Number(owner('slot-1').match(/^pid=(\d+)$/m)![1])
    expect(alive(slotPid)).toBe(true) // 부른 셸(spawnSync)은 이미 끝났다
    // 아직이면 RUNNING 과 exit 76
    const w0 = run(['wait', d.id, '--max', '0'])
    expect(w0.code).toBe(76)
    expect(w0.stdout).toMatch(new RegExp(`^HEAVY_JOB_RUNNING id=${d.id} elapsed=\\d+s$`, 'm'))
    const w = run(['wait', d.id, '--max', '20'])
    expect(w.code).toBe(3)
    const lines = w.stdout.trim().split('\n')
    expect(lines[lines.length - 1]).toBe(`HEAVY_JOB_DONE id=${d.id} rc=3`)
    expect(w.stdout).toContain('HEAVY_SLOT slot-1 k=1')
    expect(w.stdout).toContain('job-end')
    expect(readFileSync(join(jd, 'rc'), 'utf8').trim()).toBe('3')
    expect(readdirSync(jd).filter((n) => n.startsWith('rc.tmp'))).toEqual([])
    expect(existsSync(join(dir, 'slot-1'))).toBe(false)
    // 끝난 잡을 다시 불러도 같은 결과(폴링은 멱등)
    expect(run(['wait', d.id]).code).toBe(3)
  })

  it('슬롯이 차 있으면 분리된 자식이 긴 상한으로 기다리다 돈다(부른 쪽은 기다리지 않는다)', async () => {
    const holder = start(['sh', '-c', 'sleep 1.5'])
    await until(() => existsSync(join(dir, 'slot-1', 'owner')))
    const d = detach(['echo', 'late-run'], { DFLOW_HEAVY_WAIT: '0' })
    expect(d.code).toBe(0)
    expect(d.took).toBeLessThan(3000)
    await holder.done
    const w = run(['wait', d.id, '--max', '20'])
    expect(w.code).toBe(0)
    expect(w.stdout).toContain('late-run')
    expect(w.stdout).toContain('HEAVY_WAIT k=1')
  })

  it('--detach --exclusive 는 자식이 독점으로 돈다', () => {
    const d = detach(['--exclusive', 'sh', '-c', 'echo "held=$DFLOW_HEAVY_HELD"'], { DFLOW_HEAVY_SLOTS: '2', DFLOW_HEAVY_OWNER: String(process.pid) })
    expect(d.code).toBe(0)
    const w = run(['wait', d.id, '--max', '20'], { DFLOW_HEAVY_SLOTS: '2' })
    expect(w.code).toBe(0)
    expect(w.stdout).toContain('HEAVY_EXCL k=2')
  })

  it('rc 없이 자식이 사라지면(SIGKILL) HEAVY_JOB_LOST 와 exit 1', async () => {
    const d = detach(['sleep', '30'])
    await until(() => existsSync(join(dir, 'slot-1', 'owner')))
    process.kill(-d.pid, 'SIGKILL')
    await until(() => !alive(d.pid), 5000)
    const w = run(['wait', d.id, '--max', '5'])
    expect(w.code).toBe(1)
    expect(w.stdout).toMatch(new RegExp(`^HEAVY_JOB_LOST id=${d.id} pid=${d.pid} `, 'm'))
  })

  it('모르는 id·잘못된 --max 는 exit 2, --max 는 240 을 넘지 않는다', () => {
    expect(run(['wait', 'nope']).code).toBe(2)
    expect(run(['wait', 'nope']).err).toContain('HEAVY_JOB_UNKNOWN id=nope')
    expect(run(['wait', '../etc']).code).toBe(2)
    expect(run(['wait']).code).toBe(2)
    mkdirSync(join(jobs, 'j1'), { recursive: true })
    writeFileSync(join(jobs, 'j1', 'rc'), '0\n')
    writeFileSync(join(jobs, 'j1', 'log'), 'x\n')
    expect(run(['wait', 'j1', '--max', 'abc']).code).toBe(2)
    expect(run(['wait', 'j1', '--max', '999']).code).toBe(0)
    expect(run(['--detach']).code).toBe(2)
    expect(run(['--detach', 'status']).code).toBe(2)
  })
})

// 공통 제약 1: 옛 heavy.sh 가 같은 잠금 폴더를 함께 써도 새 파일(e2e-*·excl-*)을 지우거나 수를 틀리게 세지 않는다.
describe('옛 heavy.sh 와의 공존', { timeout: 30000 }, () => {
  const OLD_REV = 'd99a9d9a2a74707ef202aac6f5fa582266c6d60d' // E2E 풀·독점·분리 실행 이전의 마지막 heavy.sh
  const old = spawnSync('git', ['show', `${OLD_REV}:.claude/skills/dflow-dev/scripts/heavy.sh`], { cwd: ROOT, encoding: 'utf8' })
  it.skipIf(old.status !== 0)('옛 status·snapshot·실행은 e2e-*·excl-* 를 모른 채 무시한다', () => {
    const oldSh = join(tmp, 'old-heavy.sh')
    writeFileSync(oldSh, old.stdout, { mode: 0o755 })
    const holder = sleeper()
    expect(run(['acquire', 'srv'], { DFLOW_HEAVY_OWNER: String(holder) }).code).toBe(0)
    exclMark(holder)
    const o = (args: string[]) => spawnSync('bash', [oldSh, ...args], { encoding: 'utf8', env: env({ DFLOW_HEAVY_OWNER: '1' }), timeout: 30000 })
    expect(o(['status']).stdout).toBe('HEAVY_STATUS slots=1 held=0 waiting=0\n')
    expect(o(['snapshot']).stdout.split('\n').filter((l) => l.startsWith('RUN'))).toEqual([])
    const r = o(['echo', 'old-run'])
    expect(r.status).toBe(0) // 옛 코드는 표식에 양보하지 않는다(전환기) — 깨지지는 않는다
    expect(existsSync(join(dir, 'e2e-1', 'owner'))).toBe(true)
    expect(existsSync(join(dir, `excl-${holder}`))).toBe(true)
  })
})

// 2026-09-26 리뷰 지적 회귀 — 독점 양보 표식의 수명·일반 hold·표식 이름(①②⑦⑧)
describe('heavy.sh --exclusive — 표식 수명과 일반 hold(리뷰 회귀)', { timeout: 30000 }, () => {
  const me = () => ({ DFLOW_HEAVY_OWNER: String(process.pid) })
  const K2 = { DFLOW_HEAVY_SLOTS: '2' }
  const OTHER = { DFLOW_HEAVY_OWNER: '1', DFLOW_HEAVY_WAIT: '0' }

  it('리뷰 재현: BUSY 로 남긴 표식은 같은 세션이 acquire 하면 지워져, 다른 세션의 게이트가 빈 슬롯을 곧바로 잡는다', () => {
    liveSlot('slot-2', sleeper())
    expect(run(['--exclusive', 'true'], { ...K2, ...me(), DFLOW_HEAVY_WAIT: '0' }).code).toBe(75)
    expect(exclFiles(process.pid)).toHaveLength(1)
    // 재호출 사이(gap)에는 다른 세션이 양보한다(드레인)
    expect(run(['echo', 'gate'], { ...K2, ...OTHER }).code).toBe(75)
    expect(run(['acquire', 'srv'], { ...K2, ...me() }).code).toBe(0)
    expect(exclFiles(process.pid)).toEqual([])
    const nested = run(['--exclusive', 'true'], { ...K2, ...me(), DFLOW_HEAVY_WAIT: '0' })
    expect(nested.code).toBe(2)
    expect(nested.err).toContain('HEAVY_EXCL_NESTED')
    const g = run(['echo', 'gate-ran'], { ...K2, ...OTHER })
    expect(g.code).toBe(0)
    expect(g.out).toContain('gate-ran')
    expect(g.err).not.toContain('독점 대기')
  })

  it('NESTED 로 거부할 때도 이 세션의 재호출 대기 표식을 지운다(감싼 실행 안)', () => {
    liveSlot('slot-2', sleeper())
    expect(run(['--exclusive', 'true'], { ...K2, ...me(), DFLOW_HEAVY_WAIT: '0' }).code).toBe(75)
    expect(exclFiles(process.pid)).toHaveLength(1)
    // 자기 세션의 표식에는 양보하지 않으므로 바깥 게이트는 slot-1 을 잡고, 안쪽 독점은 NESTED 로 거부된다
    const inner = run(['sh', '-c', `bash '${HEAVY}' --exclusive echo x`], { ...K2, ...me(), DFLOW_HEAVY_WAIT: '0' })
    expect(inner.code).toBe(2)
    expect(inner.err).toContain('HEAVY_EXCL_NESTED 감싼 실행 안(slot-1)')
    expect(exclFiles(process.pid)).toEqual([])
  })

  it('재호출 대기(gap) 표식은 기본 TTL 180초 안이면 양보를 지키고, 지나면 무시·회수한다(1800초가 아니다)', () => {
    const other = sleeper()
    const f = exclMark(other, { hpid: '-', seen: nowS() - 60, cmd: 'bench' })
    const y = run(['echo', 'gate'], { ...OTHER })
    expect(y.code).toBe(75)
    expect(y.err).toMatch(/독점 대기: \[excl pid=\d+ \d+분 재호출 대기\] bench$/m)
    writeFileSync(f, readFileSync(f, 'utf8').replace(/^seen=\d+$/m, `seen=${nowS() - 200}`))
    const r = run(['echo', 'after-ttl'], { ...OTHER })
    expect(r.code).toBe(0)
    expect(r.out).toContain('after-ttl')
    expect(existsSync(f)).toBe(false)
    // 회수는 .xdel.* 로 옮긴 뒤 지운다 — 찌꺼기를 남기지 않는다
    expect(readdirSync(dir).filter((n) => n.startsWith('.xdel.'))).toEqual([])
  })

  it('기다리던 독점 heavy.sh 가 SIGKILL 로 죽으면 표식은 TTL 을 기다리지 않고 곧바로 무시된다', async () => {
    const holder = sleeper()
    liveSlot('slot-1', holder)
    const x = start(['--exclusive', 'true'], { ...me(), DFLOW_HEAVY_WAIT: '20' })
    await until(() => x.out().includes('HEAVY_EXCL_WAIT'))
    expect(exclFiles(process.pid)).toHaveLength(1)
    x.p.kill('SIGKILL')
    await x.done
    rmSync(join(dir, 'slot-1'), { recursive: true })
    const r = run(['echo', 'after-kill'], { ...OTHER })
    expect(r.code).toBe(0)
    expect(r.out).toContain('after-kill')
    expect(exclFiles(process.pid)).toEqual([])
  })

  it('앞선 표식이 재호출 대기(gap)면 뒤의 독점은 앞지르고, 기다리는 중(active)이면 기다린다', () => {
    const lead = sleeper()
    const gap = exclMark(lead, { hpid: '-', start: nowS() - 100, seen: nowS() - 20 })
    const r = run(['--exclusive', 'echo', 'overtook'], { ...K2, ...me(), DFLOW_HEAVY_WAIT: '2' })
    expect(r.code).toBe(0)
    expect(r.out).toContain('overtook')
    rmSync(gap)
    // 살아 있는 heavy.sh(hpid)가 기다리는 앞선 표식은 기다린다
    const waiter = sleeper()
    exclMark(lead, { hpid: waiter, start: nowS() - 100 })
    const r2 = run(['--exclusive', 'echo', 'second'], { ...K2, ...me(), DFLOW_HEAVY_WAIT: '1' })
    expect(r2.code).toBe(75)
    expect(r2.err).toContain('독점 대기(순번 2/2')
    expect(r2.out).not.toContain('second\n')
  })

  it('살아 있는 일반 slot hold 가 있으면 표식 없이 곧바로 HEAVY_BUSY … 독점 불가: E2E hold 보유 중(exit 75) — 다른 게이트를 멈추지 않는다', () => {
    liveSlot('slot-1', sleeper(), 'hold', 'hold e2e-x')
    // 이 세션이 앞서 남긴 재호출 대기 표식도 지운다
    exclMark(process.pid, { hpid: '-', seen: nowS() - 5 })
    const t0 = Date.now()
    const r = run(['--exclusive', 'echo', 'never'], { ...K2, ...me(), DFLOW_HEAVY_WAIT: '10' })
    expect(Date.now() - t0).toBeLessThan(5000)
    expect(r.code).toBe(75)
    expect(r.err).toMatch(/^HEAVY_BUSY k=2 wait=\d+s 독점 불가: E2E hold 보유 중 \[slot-1 pid=\d+ \d+분 hold\] hold e2e-x /m)
    expect(r.out).not.toContain('never\n')
    expect(readdirSync(dir).filter((n) => /^(excl-|wait-)/.test(n))).toEqual([])
    const g = run(['echo', 'gate-ran'], { ...K2, ...OTHER })
    expect(g.code).toBe(0)
    expect(g.err).toContain('HEAVY_SLOT slot-2')
  })

  it('죽은 소유자의 일반 hold 는 독점을 막지 않는다(회수 대상)', () => {
    liveSlot('slot-1', DEAD(), 'hold', 'hold e2e-x')
    const r = run(['--exclusive', 'echo', 'excl-ran'], { ...K2, ...me(), DFLOW_HEAVY_WAIT: '2' })
    expect(r.code).toBe(0)
    expect(r.out).toContain('excl-ran')
  })

  it('같은 세션의 독점 둘은 표식을 따로 쓰고, 하나가 끝나도 다른 하나의 표식은 남는다', async () => {
    liveSlot('slot-1', sleeper())
    const a = start(['--exclusive', 'true'], { ...me(), DFLOW_HEAVY_WAIT: '20' })
    const b = start(['--exclusive', 'true'], { ...me(), DFLOW_HEAVY_WAIT: '20' })
    await until(() => exclFiles(process.pid).length === 2)
    expect(exclFiles(process.pid).sort()).toEqual([`excl-${process.pid}-${a.p.pid}`, `excl-${process.pid}-${b.p.pid}`].sort())
    a.p.kill('SIGTERM')
    expect((await a.done).code).toBe(143)
    expect(exclFiles(process.pid)).toEqual([`excl-${process.pid}-${b.p.pid}`])
    b.p.kill('SIGTERM')
    await b.done
  })
})

// 2026-09-26 리뷰 지적 회귀 — 분리 실행(④⑤⑥)
describe('heavy.sh --detach / wait — 리뷰 회귀', { timeout: 60000 }, () => {
  const detach = (args: string[], extra: Record<string, string> = {}) => {
    const r = run(['--detach', ...args], extra)
    const m = r.stdout.match(/^HEAVY_DETACHED id=(\S+) pid=(\d+) log=(\S+)$/m)
    return { ...r, id: m?.[1] ?? '', pid: Number(m?.[2]) }
  }

  it('잡 rc 75(자식이 슬롯을 못 얻음)는 HEAVY_JOB_BUSY 와 exit 77 — wait 자신의 BUSY(75)와 겹치지 않는다', async () => {
    liveSlot('slot-1', sleeper())
    const d = detach(['echo', 'never'], { DFLOW_HEAVY_DETACH_WAIT: '0' })
    expect(d.code).toBe(0)
    const w = run(['wait', d.id, '--max', '20'])
    expect(w.code).toBe(77)
    expect(w.stdout).toContain(`HEAVY_JOB_DONE id=${d.id} rc=75`)
    expect(w.stdout).toMatch(new RegExp(`^HEAVY_JOB_BUSY id=${d.id} rc=75 .*다시 --detach`, 'm'))
    expect(w.stdout).toContain('HEAVY_BUSY k=1')
  })

  it('잡 rc 76 은 HEAVY_JOB_FAILED 와 exit 78 — RUNNING(76)과 겹치지 않는다', () => {
    const d = detach(['sh', '-c', 'exit 76'])
    const w = run(['wait', d.id, '--max', '20'])
    expect(w.code).toBe(78)
    expect(w.stdout).toContain(`HEAVY_JOB_DONE id=${d.id} rc=76`)
    expect(w.stdout).toMatch(new RegExp(`^HEAVY_JOB_FAILED id=${d.id} rc=76 `, 'm'))
    expect(w.stdout).not.toMatch(/^HEAVY_JOB_RUNNING /m)
  })

  it('분리된 자식은 세션의 E2E hold 를 다시 쓰지 않고(REUSE 끔) 자기 슬롯을 잡는다', () => {
    const me = { DFLOW_HEAVY_OWNER: String(process.pid) }
    expect(run(['acquire', 'srv'], me).code).toBe(0)
    // 같은 세션의 전경 호출은 REUSE 다
    expect(run(['true'], me).err).toContain('HEAVY_REUSE e2e-1')
    const d = detach(['sh', '-c', 'echo "held=$DFLOW_HEAVY_HELD injob=${DFLOW_HEAVY_IN_JOB:-none}"'], me)
    const w = run(['wait', d.id, '--max', '20'], me)
    expect(w.code).toBe(0)
    expect(w.stdout).not.toContain('HEAVY_REUSE')
    expect(w.stdout).toContain('HEAVY_SLOT slot-1 k=1')
    expect(w.stdout).toContain(`held=${join(dir, 'slot-1')} injob=none`)
    expect(existsSync(join(dir, 'e2e-1', 'owner'))).toBe(true)
  })

  it('--detach --exclusive: 세션의 E2E 풀 hold 는 막지 않고(잡은 따로 돈다), 세션의 일반 슬롯 hold 는 NESTED(exit 2)로 거부한다', () => {
    const me = { DFLOW_HEAVY_OWNER: String(process.pid), DFLOW_HEAVY_SLOTS: '2' }
    expect(run(['acquire', 'srv'], me).code).toBe(0)
    // 전경 독점은 E2E hold 를 쥔 세션에서 NESTED 다(예전 그대로)
    expect(run(['--exclusive', 'true'], me).code).toBe(2)
    const d = detach(['--exclusive', 'echo', 'excl-job-ran'], me)
    const w = run(['wait', d.id, '--max', '20'], me)
    expect(w.code).toBe(0)
    expect(w.stdout).toContain('HEAVY_EXCL k=2')
    expect(w.stdout).toContain('excl-job-ran')
    expect(run(['release'], me).code).toBe(0)
    // E2E 풀을 끈 acquire(일반 슬롯 hold) — 잡도 NESTED 로 거부해 「다시 --detach」 헛돌기를 막는다
    const off = { ...me, DFLOW_HEAVY_E2E_SLOTS: '0' }
    expect(run(['acquire', 'srv'], off).err).toContain('HEAVY_ACQUIRED slot-1')
    const d2 = detach(['--exclusive', 'echo', 'never'], off)
    const w2 = run(['wait', d2.id, '--max', '20'], off)
    expect(w2.code).toBe(2)
    expect(w2.stdout).toContain('HEAVY_EXCL_NESTED 이 세션')
    expect(w2.stdout).toContain(`HEAVY_JOB_DONE id=${d2.id} rc=2`)
    expect(w2.stdout).not.toContain('never\n')
  })

  it('잡 pid 만 강제 종료되고 명령을 돌리는 손자 heavy.sh 가 살아 있으면 RUNNING(76), 손자까지 사라지면 LOST', async () => {
    const d = detach(['sleep', '30'])
    const jd = join(jobs, d.id)
    await until(() => existsSync(join(jd, 'runpid')) && existsSync(join(dir, 'slot-1', 'owner')))
    const rp = Number(readFileSync(join(jd, 'runpid'), 'utf8').trim())
    expect(alive(rp)).toBe(true)
    process.kill(d.pid, 'SIGKILL')
    await until(() => !alive(d.pid), 5000)
    const w = run(['wait', d.id, '--max', '1'])
    expect(w.code).toBe(76)
    expect(w.stdout).toMatch(new RegExp(`^HEAVY_JOB_RUNNING id=${d.id} elapsed=\\d+s$`, 'm'))
    expect(existsSync(join(dir, 'slot-1', 'owner'))).toBe(true) // 슬롯은 손자가 쥐고 있다
    process.kill(-d.pid, 'SIGKILL')
    await until(() => !alive(rp), 5000)
    const w2 = run(['wait', d.id, '--max', '5'])
    expect(w2.code).toBe(1)
    expect(w2.stdout).toMatch(new RegExp(`^HEAVY_JOB_LOST id=${d.id} pid=${d.pid} `, 'm'))
  })
})
