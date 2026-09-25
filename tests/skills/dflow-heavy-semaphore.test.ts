// tests/skills/dflow-heavy-semaphore.test.ts
// 무거운 명령 줄 세우기(heavy.sh) — PC 전역 세마포어를 실제 프로세스로 병렬 실행해 확인한다.
// 슬롯 폴더는 DFLOW_HEAVY_DIR 로 임시 폴더에 둔다(사용자 홈의 ~/.dflow/locks/heavy 를 건드리지 않는다).
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir, totalmem } from 'node:os'
import { join } from 'node:path'

const ROOT = process.cwd()
const HEAVY = join(ROOT, '.claude/skills/dflow-dev/scripts/heavy.sh')
const DISC = readFileSync(join(ROOT, '.claude/skills/dflow-dev/references/dev-discipline.md'), 'utf8')

let tmp: string
let dir: string
const kids: ChildProcess[] = []

function env(extra: Record<string, string> = {}) {
  return {
    ...process.env,
    DFLOW_HEAVY_DIR: dir, DFLOW_HEAVY_SLOTS: '1', DFLOW_HEAVY_WAIT: '10', DFLOW_HEAVY_POLL: '0.2',
    DFLOW_HEAVY_OWNER: '', CLAUDE_PID: '',
    ...extra,
  }
}

function run(args: string[], extra: Record<string, string> = {}) {
  const r = spawnSync('bash', [HEAVY, ...args], { encoding: 'utf8', env: env(extra), timeout: 30000 })
  return { code: r.status, out: (r.stdout || '') + (r.stderr || ''), err: r.stderr || '', stdout: r.stdout || '' }
}

function start(args: string[], extra: Record<string, string> = {}) {
  const p = spawn('bash', [HEAVY, ...args], { env: env(extra), stdio: ['ignore', 'pipe', 'pipe'] })
  let out = ''
  p.stdout!.on('data', (b) => { out += b })
  p.stderr!.on('data', (b) => { out += b })
  const done = new Promise<{ code: number | null; signal: NodeJS.Signals | null; out: string }>((res) =>
    p.on('close', (code, signal) => res({ code, signal, out })))
  kids.push(p)
  return { p, done, out: () => out }
}

async function until(pred: () => boolean, ms = 10000) {
  const t0 = Date.now()
  while (!pred()) {
    if (Date.now() - t0 > ms) throw new Error('timeout waiting for condition')
    await new Promise((r) => setTimeout(r, 50))
  }
}

const owner = (slot = 'slot-1') => readFileSync(join(dir, slot, 'owner'), 'utf8')
const alive = (pid: number) => { try { process.kill(pid, 0); return true } catch { return false } }

beforeEach(() => {
  tmp = realpathSync(mkdtempSync(join(tmpdir(), 'dflow-heavy-')))
  dir = join(tmp, 'locks')
})

afterEach(() => {
  for (const k of kids.splice(0)) { try { k.kill('SIGKILL') } catch { /* 이미 끝남 */ } }
  rmSync(tmp, { recursive: true, force: true })
})

// 실제 프로세스를 병렬로 띄우고 기다린다. PC 가 바쁠 때 기본 5초를 넘길 수 있어 넉넉히 준다.
describe('heavy.sh — PC 전역 무거운 명령 세마포어', { timeout: 30000 }, () => {
  it('bash 로 파싱되고 실행 권한이 있다', () => {
    expect(spawnSync('bash', ['-n', HEAVY]).status).toBe(0)
    expect(spawnSync('test', ['-x', HEAVY]).status).toBe(0)
  })

  it('명령의 exit 를 그대로 돌려주고 끝나면 슬롯을 푼다', () => {
    const r = run(['sh', '-c', 'echo "held=$DFLOW_HEAVY_HELD"; exit 3'])
    expect(r.code).toBe(3)
    expect(r.out).toContain('HEAVY_SLOT slot-1 k=1')
    expect(r.out).toContain(`held=${join(dir, 'slot-1')}`)
    expect(existsSync(join(dir, 'slot-1'))).toBe(false)
  })

  it('K=1 이면 두 번째 호출은 첫 번째가 끝날 때까지 기다렸다가 돈다', async () => {
    const a = start(['sh', '-c', 'sleep 1.5; echo A-done'])
    await until(() => existsSync(join(dir, 'slot-1', 'owner')))
    expect(owner()).toContain('kind=run')
    expect(owner()).toContain(`pid=${a.p.pid}`)
    expect(owner()).toContain('cmd=sh -c sleep 1.5; echo A-done')
    const t0 = Date.now()
    const b = start(['sh', '-c', 'echo B-ran'])
    const rb = await b.done
    const ra = await a.done
    expect(ra.code).toBe(0)
    expect(rb.code).toBe(0)
    expect(rb.out).toContain('HEAVY_WAIT k=1')
    expect(rb.out).toContain('B-ran')
    expect(Date.now() - t0).toBeGreaterThanOrEqual(700)
    expect(existsSync(join(dir, 'slot-1'))).toBe(false)
  })

  it('대기 상한을 넘기면 명령을 돌리지 않고 exit 75 와 HEAVY_BUSY <보유 명령> 한 줄로 끝난다', async () => {
    const a = start(['sh', '-c', 'sleep 5'])
    await until(() => existsSync(join(dir, 'slot-1', 'owner')))
    const marker = join(tmp, 'ran')
    const r = run(['sh', '-c', `touch '${marker}'`], { DFLOW_HEAVY_WAIT: '1' })
    expect(r.code).toBe(75)
    const busy = r.err.split('\n').filter((l) => l.startsWith('HEAVY_BUSY'))
    expect(busy).toHaveLength(1)
    expect(busy[0]).toMatch(/^HEAVY_BUSY k=1 wait=1s 보유: \[slot-1 pid=\d+ \d+분 run\] sh -c sleep 5$/)
    expect(existsSync(marker)).toBe(false)
    a.p.kill('SIGTERM')
    await a.done
  })

  it('K=2 면 둘이 동시에 돌고 셋째가 기다린다', async () => {
    const e = { DFLOW_HEAVY_SLOTS: '2' }
    const a = start(['sleep', '3'], e)
    const b = start(['sleep', '3'], e)
    await until(() => existsSync(join(dir, 'slot-1', 'owner')) && existsSync(join(dir, 'slot-2', 'owner')))
    const r = run(['true'], { ...e, DFLOW_HEAVY_WAIT: '0' })
    expect(r.code).toBe(75)
    expect(r.err).toMatch(/HEAVY_BUSY k=2 .*\[slot-1 .*\| \[slot-2 /)
    a.p.kill('SIGTERM'); b.p.kill('SIGTERM')
    await Promise.all([a.done, b.done])
  })

  it('소유 프로세스가 죽은 슬롯은 회수한다', () => {
    const dead = spawnSync('sh', ['-c', 'echo $$']).stdout.toString().trim()
    mkdirSync(join(dir, 'slot-1'), { recursive: true })
    writeFileSync(join(dir, 'slot-1', 'owner'), `pid=${dead}\nkind=run\nstart=1\npstart=-\ncmd=./gradlew testAll\n`)
    const r = run(['echo', 'after-reclaim'], { DFLOW_HEAVY_WAIT: '2' })
    expect(r.code).toBe(0)
    expect(r.out).toContain(`HEAVY_RECLAIM slot-1 pid=${dead} kind=run cmd=./gradlew testAll`)
    expect(r.out).toContain('after-reclaim')
  })

  it('PID 가 재사용됐으면(시작 시각이 다르면) 죽은 것으로 보고 회수한다', () => {
    mkdirSync(join(dir, 'slot-1'), { recursive: true })
    writeFileSync(join(dir, 'slot-1', 'owner'),
      `pid=${process.pid}\nkind=run\nstart=1\npstart=Thu Jan  1 00:00:00 1970\ncmd=old\n`)
    const r = run(['echo', 'ok'], { DFLOW_HEAVY_WAIT: '2' })
    expect(r.code).toBe(0)
    expect(r.out).toContain('HEAVY_RECLAIM slot-1')
  })

  it('살아 있는 소유자의 슬롯은 회수하지 않는다', () => {
    mkdirSync(join(dir, 'slot-1'), { recursive: true })
    writeFileSync(join(dir, 'slot-1', 'owner'), `pid=${process.pid}\nkind=run\nstart=1\npstart=-\ncmd=live\n`)
    const r = run(['echo', 'no'], { DFLOW_HEAVY_WAIT: '0' })
    expect(r.code).toBe(75)
    expect(r.out).not.toContain('HEAVY_RECLAIM')
    expect(owner()).toContain('cmd=live')
  })

  it('중단(TERM·INT)되면 명령을 끝내고 슬롯을 푼다', async () => {
    for (const sig of ['SIGTERM', 'SIGINT'] as const) {
      const pidFile = join(tmp, `child-${sig}`)
      const a = start(['sh', '-c', `echo $$ > '${pidFile}'; exec sleep 30`])
      await until(() => existsSync(join(dir, 'slot-1', 'owner')) && existsSync(pidFile))
      const child = Number(readFileSync(pidFile, 'utf8').trim())
      a.p.kill(sig)
      const r = await a.done
      expect(r.code).toBe(sig === 'SIGTERM' ? 143 : 130)
      expect(existsSync(join(dir, 'slot-1'))).toBe(false)
      await until(() => !alive(child), 3000)
    }
  })

  it('안쪽 호출(DFLOW_HEAVY_HELD 상속)은 두 번째 슬롯을 기다리지 않는다', () => {
    const r = run(['bash', HEAVY, 'echo', 'nested-ok'], { DFLOW_HEAVY_WAIT: '0' })
    expect(r.code).toBe(0)
    expect(r.out).toContain('nested-ok')
  })

  it('acquire 는 세션 소유 슬롯을 잡고, 같은 세션의 명령은 그 슬롯을 다시 쓰며, release 가 푼다', () => {
    const me = { DFLOW_HEAVY_OWNER: String(process.pid) }
    const a = run(['acquire', 'e2e-TSK-01'], me)
    expect(a.code).toBe(0)
    expect(a.out).toContain(`HEAVY_ACQUIRED slot-1 owner=${process.pid}`)
    expect(owner()).toContain('kind=hold')
    expect(owner()).toContain('cmd=hold e2e-TSK-01')
    // 다시 acquire 해도 새 슬롯을 잡지 않는다
    expect(run(['acquire', 'x'], me).out).toContain('(이미 보유)')
    // 같은 세션의 시험 명령은 기다리지 않고 그 슬롯에서 돈다
    const r = run(['echo', 'e2e-test'], { ...me, DFLOW_HEAVY_WAIT: '0' })
    expect(r.code).toBe(0)
    expect(r.out).toContain('HEAVY_REUSE slot-1')
    // 다른 세션은 기다린다
    const other = run(['echo', 'x'], { DFLOW_HEAVY_OWNER: '1', DFLOW_HEAVY_WAIT: '0' })
    expect(other.code).toBe(75)
    expect(other.err).toContain('hold] hold e2e-TSK-01')
    // release 뒤에는 슬롯이 없다
    const rel = run(['release'], me)
    expect(rel.out).toContain('HEAVY_RELEASED slot-1')
    expect(existsSync(join(dir, 'slot-1'))).toBe(false)
    expect(run(['release'], me).out).toContain('HEAVY_RELEASED none')
  })

  it('acquire 의 소유 세션이 죽었거나 보유 시간(TTL)을 넘기면 회수한다', () => {
    const dead = spawnSync('sh', ['-c', 'echo $$']).stdout.toString().trim()
    expect(run(['acquire', 'srv'], { DFLOW_HEAVY_OWNER: dead }).code).toBe(0)
    let r = run(['echo', 'ok'], { DFLOW_HEAVY_WAIT: '2' })
    expect(r.code).toBe(0)
    expect(r.out).toContain(`HEAVY_RECLAIM slot-1 pid=${dead} kind=hold`)
    // 소유 세션은 살아 있지만 TTL(기본 3600초)을 넘긴 hold. 확인은 다른 세션(OWNER=1)으로 한다
    const other = { DFLOW_HEAVY_OWNER: '1' }
    expect(run(['acquire', 'srv'], { DFLOW_HEAVY_OWNER: String(process.pid) }).code).toBe(0)
    expect(run(['echo', 'ok'], { ...other, DFLOW_HEAVY_WAIT: '0' }).code).toBe(75)
    writeFileSync(join(dir, 'slot-1', 'owner'), owner().replace(/^start=\d+$/m, 'start=1'))
    r = run(['echo', 'ok'], { ...other, DFLOW_HEAVY_WAIT: '2' })
    expect(r.code).toBe(0)
    expect(r.out).toContain('HEAVY_RECLAIM slot-1')
  })

  it('Windows 흉내: kill -0 이 실패해도 ps -W 의 WINPID 로 살아 있으면 hold 를 회수하지 않고, 목록에 없으면 회수한다', () => {
    const bin = join(tmp, 'bin')
    mkdirSync(bin, { recursive: true })
    writeFileSync(join(bin, 'uname'), `#!/bin/sh\nprintf 'MINGW64_NT-10.0\\n'\n`, { mode: 0o755 })
    // Git Bash 의 ps 는 -o 를 모른다. -W 일 때만 표를 낸다
    writeFileSync(join(bin, 'ps'), `#!/bin/sh
[ "$1" = -W ] || exit 1
cat <<'EOF'
      PID    PPID    PGID   WINPID   TTY        UID    STIME COMMAND
    12345   67890   12345   424242  ?        1000  10:00:00 /usr/bin/bash
EOF
`, { mode: 0o755 })
    const win = { PATH: `${bin}:${process.env.PATH}` }
    expect(run(['acquire', 'srv'], { ...win, DFLOW_HEAVY_OWNER: '424242' }).code).toBe(0)
    expect(owner()).toContain('pstart=-')
    const busy = run(['echo', 'x'], { ...win, DFLOW_HEAVY_OWNER: '1', DFLOW_HEAVY_WAIT: '0' })
    expect(busy.code).toBe(75)
    expect(busy.out).not.toContain('HEAVY_RECLAIM')
    writeFileSync(join(dir, 'slot-1', 'owner'), owner().replace('pid=424242', 'pid=999999'))
    const r = run(['echo', 'x'], { ...win, DFLOW_HEAVY_OWNER: '1', DFLOW_HEAVY_WAIT: '2' })
    expect(r.code).toBe(0)
    expect(r.out).toContain('HEAVY_RECLAIM slot-1 pid=999999 kind=hold')
  })

  it('슬롯 폴더 경로에 공백이 있어도 release 가 푼다', () => {
    const sp = { DFLOW_HEAVY_DIR: join(tmp, 'First Last', 'locks'), DFLOW_HEAVY_OWNER: String(process.pid) }
    expect(run(['acquire', 'srv'], sp).code).toBe(0)
    expect(existsSync(join(tmp, 'First Last', 'locks', 'slot-1'))).toBe(true)
    expect(run(['release'], sp).out).toContain('HEAVY_RELEASED slot-1')
    expect(existsSync(join(tmp, 'First Last', 'locks', 'slot-1'))).toBe(false)
  })

  it('K 기본값은 max(1, floor(RAM_GB/8)) 이고 DFLOW_HEAVY_SLOTS 로 덮는다', () => {
    const gb = Math.round(totalmem() / 2 ** 30)
    const k = Math.max(1, Math.floor(gb / 8))
    const s = run(['status'], { DFLOW_HEAVY_SLOTS: '' })
    expect(s.out).toContain(`HEAVY_STATUS slots=${k} held=0 waiting=0`)
    expect(s.err).toContain(`HEAVY_DETAIL k=${k} ram=${gb}GB`)
    expect(run(['status'], { DFLOW_HEAVY_SLOTS: '5' }).out).toContain('HEAVY_STATUS slots=5 ')
  })

  it('슬롯 폴더를 만들 수 없으면 줄 세우지 않고 그냥 돌린다(fail-open)', () => {
    writeFileSync(join(tmp, 'file'), 'x')
    const r = run(['echo', 'ran-anyway'], { DFLOW_HEAVY_DIR: join(tmp, 'file', 'locks') })
    expect(r.code).toBe(0)
    expect(r.out).toContain('HEAVY_UNLOCKED')
    expect(r.out).toContain('ran-anyway')
  })
})

// 도커 전용 슬롯(2026-09-24 도커 규칙 개정): 도커를 쓰는 명령은 PC 전역 도커 슬롯(기본 1개)과 일반 슬롯을 함께 잡는다.
// 교착 불변식: 도커 슬롯을 쥔 쪽은 아무것도 기다리지 않는다(도커는 마지막에 한 번에, 못 잡으면 곧바로 돌려준다).
describe('heavy.sh --pool docker — 도커 전용 슬롯', { timeout: 30000 }, () => {
  const docker = (i = 1) => join(dir, `docker-${i}`)
  const slot = (i = 1) => join(dir, `slot-${i}`)

  it('도커 슬롯과 일반 슬롯을 함께 잡고, 끝나면 둘 다 푼다. 안쪽 호출은 기다리지 않는다', () => {
    const r = run(['--pool', 'docker', 'sh', '-c',
      `echo "g=$DFLOW_HEAVY_HELD d=$DFLOW_HEAVY_DOCKER_HELD"; bash '${HEAVY}' --pool docker echo inner-d; bash '${HEAVY}' echo inner-g; exit 4`],
    { DFLOW_HEAVY_WAIT: '0' })
    expect(r.code).toBe(4)
    expect(r.out).toContain('HEAVY_DOCKER_SLOT docker-1 docker=1 + slot-1 k=1')
    expect(r.out).toContain(`g=${slot()} d=${docker()}`)
    expect(r.out).toContain('inner-d')
    expect(r.out).toContain('inner-g')
    expect(existsSync(docker())).toBe(false)
    expect(existsSync(slot())).toBe(false)
  })

  it('도커 슬롯은 PC 에 하나다 — 일반 슬롯이 남아도 두 번째 도커 명령은 기다리다 HEAVY_DOCKER_BUSY(exit 75)', async () => {
    const e = { DFLOW_HEAVY_SLOTS: '2' }
    const a = start(['--pool', 'docker', 'sleep', '3'], e)
    await until(() => existsSync(join(docker(), 'owner')))
    expect(readFileSync(join(docker(), 'owner'), 'utf8')).toContain('cmd=[docker] sleep 3')
    const marker = join(tmp, 'ran')
    const r = run(['--pool', 'docker', 'sh', '-c', `touch '${marker}'`], { ...e, DFLOW_HEAVY_WAIT: '1' })
    expect(r.code).toBe(75)
    const busy = r.err.split('\n').filter((l) => l.startsWith('HEAVY_DOCKER_BUSY'))
    expect(busy).toHaveLength(1)
    expect(busy[0]).toMatch(/^HEAVY_DOCKER_BUSY k=2 docker=1 wait=1s 도커: \[docker-1 pid=\d+ \d+분 run\] \[docker\] sleep 3 일반: /)
    expect(existsSync(marker)).toBe(false)
    // 일반 명령은 남은 일반 슬롯에서 돈다
    const g = run(['echo', 'general-ok'], { ...e, DFLOW_HEAVY_WAIT: '0' })
    expect(g.code).toBe(0)
    expect(g.out).toContain('general-ok')
    a.p.kill('SIGTERM')
    await a.done
    expect(existsSync(docker())).toBe(false)
  })

  it('도커 명령도 일반 슬롯 수(K)에 든다 — 일반 슬롯이 차 있으면 도커 슬롯을 쥔 채 기다리지 않는다', async () => {
    const a = start(['sleep', '2'])
    await until(() => existsSync(join(slot(), 'owner')))
    const b = start(['--pool', 'docker', 'echo', 'B-ran'], { DFLOW_HEAVY_WAIT: '15' })
    await until(() => b.out().includes('HEAVY_DOCKER_WAIT'))
    // B 가 기다리는 동안 도커 슬롯을 쥐고 있지 않으므로, 일반 슬롯을 이미 쥔 쪽(감싼 실행 안)은 도커 슬롯을 곧바로 얻는다
    const c = run(['--pool', 'docker', 'echo', 'C-ran'], { DFLOW_HEAVY_HELD: slot(), DFLOW_HEAVY_WAIT: '3' })
    expect(c.code).toBe(0)
    expect(c.out).toContain('C-ran')
    expect(b.out()).not.toContain('B-ran')
    const rb = await b.done
    await a.done
    expect(rb.code).toBe(0)
    expect(rb.out).toContain('B-ran')
  })

  it('교착 없음: A 가 일반 슬롯을 쥐고(acquire) B 가 도커를 기다려도, A 의 도커 명령은 곧바로 돌고 A 가 풀면 B 가 돈다', async () => {
    const A = { DFLOW_HEAVY_OWNER: String(process.pid) }
    expect(run(['acquire', 'e2e-A'], A).code).toBe(0)
    const b = start(['--pool', 'docker', 'echo', 'B-ran'], { DFLOW_HEAVY_OWNER: '1', DFLOW_HEAVY_WAIT: '15' })
    await until(() => b.out().includes('HEAVY_DOCKER_WAIT'))
    const t0 = Date.now()
    const ra = run(['--pool', 'docker', 'echo', 'A-ran'], { ...A, DFLOW_HEAVY_WAIT: '5' })
    expect(ra.code).toBe(0)
    expect(ra.out).toContain('HEAVY_REUSE slot-1')
    expect(ra.out).toContain('HEAVY_DOCKER_SLOT docker-1 docker=1')
    expect(ra.out).not.toContain('+ slot-')
    expect(ra.out).toContain('A-ran')
    expect(Date.now() - t0).toBeLessThan(4000)
    expect(b.out()).not.toContain('B-ran')
    expect(run(['release'], A).out).toContain('HEAVY_RELEASED slot-1')
    const rb = await b.done
    expect(rb.code).toBe(0)
    expect(rb.out).toContain('B-ran')
  })

  it('감싼 실행 안의 acquire 는 그 실행의 슬롯을 쓰고 두 번째 슬롯을 기다리지 않는다', () => {
    const r = run(['sh', '-c', `bash '${HEAVY}' acquire srv`], { DFLOW_HEAVY_WAIT: '0' })
    expect(r.code).toBe(0)
    expect(r.out).toContain('HEAVY_ACQUIRED slot-1 (감싼 실행의 슬롯) k=1')
  })

  it('죽은 소유자의 도커 슬롯은 회수한다', () => {
    const dead = spawnSync('sh', ['-c', 'echo $$']).stdout.toString().trim()
    mkdirSync(docker(), { recursive: true })
    writeFileSync(join(docker(), 'owner'), `pid=${dead}\nkind=run\nstart=1\npstart=-\ncmd=[docker] ./gradlew mssqlMigrationTest\n`)
    const r = run(['--pool', 'docker', 'echo', 'after'], { DFLOW_HEAVY_WAIT: '2' })
    expect(r.code).toBe(0)
    expect(r.out).toContain(`HEAVY_RECLAIM docker-1 pid=${dead} kind=run`)
    expect(r.out).toContain('after')
  })

  it('status 는 도커 슬롯을 따로 한 줄에 보이고, 도커 풀은 명령 실행만 받는다', () => {
    const s = run(['status'])
    expect(s.out.split('\n')[0]).toBe('HEAVY_STATUS slots=1 held=0 waiting=0')
    expect(s.err).toContain('HEAVY_DOCKER docker=1 held=0 waiting=0 (비어 있음)')
    for (const a of [['acquire', 'x'], ['release'], ['status'], []]) expect(run(['--pool', 'docker', ...a]).code).toBe(2)
    expect(run(['--pool', 'bogus', 'true']).code).toBe(2)
  })
})

// 대기 표식과 status(2026-09-24 P1): 기다리는 동안 <DIR>/wait-<pid> 를 두고, status 는 stdout 에 정확히 한 줄
// `HEAVY_STATUS slots=<K> held=<N> waiting=<M>` 을 낸다(dflow-team capacity.sh 가 파싱한다).
describe('heavy.sh — 대기 표식과 status 한 줄', { timeout: 30000 }, () => {
  const waitFiles = () => (existsSync(dir) ? readdirSync(dir).filter((n) => n.startsWith('wait-')) : [])
  const liveSlot = (name = 'slot-1', cmd = 'live') => {
    mkdirSync(join(dir, name), { recursive: true })
    writeFileSync(join(dir, name, 'owner'), `pid=${process.pid}\nkind=run\nstart=${Math.floor(Date.now() / 1000)}\npstart=-\ncmd=${cmd}\n`)
  }

  it('status 는 stdout 에 정확히 한 줄을 내고 exit 0 — 빈 폴더(없는 폴더)도 held=0 waiting=0', () => {
    const r = run(['status'], { DFLOW_HEAVY_SLOTS: '3' })
    expect(r.code).toBe(0)
    expect(r.stdout).toBe('HEAVY_STATUS slots=3 held=0 waiting=0\n')
  })

  it('status 는 살아 있는 보유·대기만 세고, 주인이 죽은 대기 표식은 무시하고 지운다', () => {
    const dead = spawnSync('sh', ['-c', 'echo $$']).stdout.toString().trim()
    liveSlot('slot-1')
    // 죽은 소유자의 슬롯은 보유로 세지 않는다
    mkdirSync(join(dir, 'slot-2'), { recursive: true })
    writeFileSync(join(dir, 'slot-2', 'owner'), `pid=${dead}\nkind=run\nstart=1\npstart=-\ncmd=dead\n`)
    writeFileSync(join(dir, `wait-${process.pid}`), `pid=${process.pid}\npool=general\nstart=1\npstart=-\ncmd=x\n`)
    writeFileSync(join(dir, 'wait-1000001'), `pid=${process.pid}\npool=docker\nstart=1\npstart=-\ncmd=d\n`)
    writeFileSync(join(dir, `wait-${dead}`), `pid=${dead}\npool=general\nstart=1\npstart=-\ncmd=gone\n`)
    writeFileSync(join(dir, `.wtmp.${process.pid}`), `pid=${process.pid}\npool=general\n`) // 쓰는 중인 임시 파일은 세지 않는다
    const r = run(['status'], { DFLOW_HEAVY_SLOTS: '2' })
    expect(r.code).toBe(0)
    expect(r.stdout.trim().split('\n')).toEqual(['HEAVY_STATUS slots=2 held=1 waiting=1'])
    expect(r.err).toContain('HEAVY_DOCKER docker=1 held=0 waiting=1')
    expect(existsSync(join(dir, `wait-${dead}`))).toBe(false)
    expect(waitFiles().sort()).toEqual(['wait-1000001', `wait-${process.pid}`].sort())
  })

  it('기다리는 동안 wait-<pid> 를 두고, 슬롯을 얻으면 지운다', async () => {
    const a = start(['sh', '-c', 'sleep 30'])
    await until(() => existsSync(join(dir, 'slot-1', 'owner')))
    const b = start(['echo', 'B-ran'], { DFLOW_HEAVY_WAIT: '20' })
    const mark = join(dir, `wait-${b.p.pid}`)
    await until(() => existsSync(mark))
    expect(readFileSync(mark, 'utf8')).toMatch(new RegExp(`^pid=${b.p.pid}\\npool=general\\n`))
    expect(run(['status']).stdout).toBe('HEAVY_STATUS slots=1 held=1 waiting=1\n')
    a.p.kill('SIGTERM')
    const rb = await b.done
    expect(rb.code).toBe(0)
    expect(rb.out).toContain('B-ran')
    expect(waitFiles()).toEqual([])
    expect(run(['status']).stdout).toBe('HEAVY_STATUS slots=1 held=0 waiting=0\n')
  })

  it('대기 상한을 넘겨 포기(HEAVY_BUSY)해도 표식을 지운다', () => {
    liveSlot()
    const r = run(['true'], { DFLOW_HEAVY_WAIT: '1' })
    expect(r.code).toBe(75)
    expect(r.err).toContain('HEAVY_BUSY')
    expect(waitFiles()).toEqual([])
  })

  it('기다리다 신호(TERM·INT)로 끝나도 표식을 지운다. acquire 대기도 같다', async () => {
    liveSlot()
    for (const [sig, args] of [['SIGTERM', ['true']], ['SIGINT', ['true']], ['SIGTERM', ['acquire', 'srv']]] as const) {
      const b = start([...args], { DFLOW_HEAVY_WAIT: '20', DFLOW_HEAVY_OWNER: '1' })
      await until(() => existsSync(join(dir, `wait-${b.p.pid}`)))
      b.p.kill(sig)
      const r = await b.done
      expect(r.code).toBe(sig === 'SIGTERM' ? 143 : 130)
      expect(waitFiles()).toEqual([])
    }
  })

  it('SIGKILL 로 죽어 남은 표식은 status 가 청소한다', async () => {
    liveSlot()
    const b = start(['true'], { DFLOW_HEAVY_WAIT: '20' })
    const mark = join(dir, `wait-${b.p.pid}`)
    await until(() => existsSync(mark))
    b.p.kill('SIGKILL')
    await b.done
    expect(existsSync(mark)).toBe(true)
    expect(run(['status']).stdout).toBe('HEAVY_STATUS slots=1 held=1 waiting=0\n')
    expect(existsSync(mark)).toBe(false)
  })

  it('도커 풀 대기는 pool=docker 표식으로 두고 첫 줄 waiting 이 아니라 HEAVY_DOCKER 줄에 센다', async () => {
    liveSlot('docker-1', '[docker] other')
    const b = start(['--pool', 'docker', 'true'], { DFLOW_HEAVY_WAIT: '20', DFLOW_HEAVY_SLOTS: '2' })
    const mark = join(dir, `wait-${b.p.pid}`)
    await until(() => existsSync(mark))
    expect(readFileSync(mark, 'utf8')).toContain('pool=docker')
    const s = run(['status'], { DFLOW_HEAVY_SLOTS: '2' })
    expect(s.stdout).toBe('HEAVY_STATUS slots=2 held=0 waiting=0\n')
    expect(s.err).toContain('HEAVY_DOCKER docker=1 held=1 waiting=1')
    b.p.kill('SIGTERM')
    expect((await b.done).code).toBe(143)
    expect(waitFiles()).toEqual([])
  })
})

describe('dev-discipline 「무거운 명령 줄 세우기」 정본', () => {
  const sec = DISC.slice(DISC.indexOf('## 무거운 명령 줄 세우기'))
  it('절이 있고 HEAVY_BUSY 재호출·E2E 서버 acquire/release·서버 종료를 적는다', () => {
    expect(DISC).toContain('## 무거운 명령 줄 세우기')
    expect(sec).toContain('.claude/skills/dflow-dev/scripts/heavy.sh')
    expect(sec).toContain('HEAVY_BUSY')
    expect(sec).toContain('실패가 아니다')
    expect(sec).toContain('heavy.sh acquire')
    expect(sec).toContain('heavy.sh release')
  })
  it('기준선·Verify 문단이 정본을 가리킨다', () => {
    const base = DISC.slice(DISC.indexOf('## 게이트 기준선'), DISC.indexOf('### research/docs'))
    // Verify 규율은 phase-verify.md 로 옮겼다
    const verify = readFileSync(join(ROOT, '.claude/skills/dflow-dev/references/phase-verify.md'), 'utf8')
    expect(base).toContain('「무거운 명령 줄 세우기」')
    expect(verify).toContain('「무거운 명령 줄 세우기」')
  })
  it('E2E 서버 슬롯 절차(acquire → 서버 → 종료 → release)는 e2e.md 가 정본이고 정본 절이 그곳을 가리킨다', () => {
    const e2e = readFileSync(join(ROOT, '.claude/skills/dflow-dev/references/e2e.md'), 'utf8')
    const slot = e2e.slice(e2e.indexOf('## E2E 서버 슬롯'))
    expect(slot).toContain('`.claude/skills/dflow-dev/scripts/heavy.sh acquire e2e-<TSK>`')
    expect(slot).toContain('`HEAVY_ACQUIRED`')
    expect(slot).toContain('`HEAVY_REUSE`')
    expect(slot).toContain('**E2E 가 끝나면 성공·실패·중단과 상관없이 서버를 반드시 종료한다**')
    expect(slot).toContain('`.claude/skills/dflow-dev/scripts/heavy.sh release`')
    expect(slot).toContain('`DFLOW_HEAVY_HOLD_TTL`')
    expect(sec).toContain('`references/e2e.md` 「E2E 서버 슬롯」')
  })
})
