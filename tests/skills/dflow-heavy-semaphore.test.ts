// tests/skills/dflow-heavy-semaphore.test.ts
// 무거운 명령 줄 세우기(heavy.sh) — PC 전역 세마포어를 실제 프로세스로 병렬 실행해 확인한다.
// 슬롯 폴더는 DFLOW_HEAVY_DIR 로 임시 폴더에 둔다(사용자 홈의 ~/.dflow/locks/heavy 를 건드리지 않는다).
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
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
  return { code: r.status, out: (r.stdout || '') + (r.stderr || ''), err: r.stderr || '' }
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

  it('K 기본값은 max(1, floor(RAM_GB/8)) 이고 DFLOW_HEAVY_SLOTS 로 덮는다', () => {
    const gb = Math.round(totalmem() / 2 ** 30)
    const k = Math.max(1, Math.floor(gb / 8))
    expect(run(['status'], { DFLOW_HEAVY_SLOTS: '' }).out).toContain(`HEAVY_STATUS k=${k} ram=${gb}GB`)
    expect(run(['status'], { DFLOW_HEAVY_SLOTS: '5' }).out).toContain('HEAVY_STATUS k=5')
  })

  it('슬롯 폴더를 만들 수 없으면 줄 세우지 않고 그냥 돌린다(fail-open)', () => {
    writeFileSync(join(tmp, 'file'), 'x')
    const r = run(['echo', 'ran-anyway'], { DFLOW_HEAVY_DIR: join(tmp, 'file', 'locks') })
    expect(r.code).toBe(0)
    expect(r.out).toContain('HEAVY_UNLOCKED')
    expect(r.out).toContain('ran-anyway')
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
    const verify = DISC.slice(DISC.indexOf('## Phase 04'), DISC.indexOf('## Phase 05'))
    expect(base).toContain('「무거운 명령 줄 세우기」')
    expect(verify).toContain('「무거운 명령 줄 세우기」')
  })
})
