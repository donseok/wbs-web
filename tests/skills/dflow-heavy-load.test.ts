// tests/skills/dflow-heavy-load.test.ts
// heavy.sh 부하 검사 — 새 일반 슬롯을 줄 때 1분 부하 평균이 코어 수 × DFLOW_HEAVY_LOAD_MAX(기본 1.5)를 넘으면 미룬다
// (dmes-standard 성능 감사 P12). 부하·코어 수는 시험용 덮어쓰기(DFLOW_HEAVY_LOADAVG·DFLOW_HEAVY_CPUS)로 흉내 낸다.
// 슬롯 폴더는 임시 DFLOW_HEAVY_DIR 이다(사용자 홈의 ~/.dflow 를 건드리지 않는다).
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const ROOT = process.cwd()
const HEAVY = join(ROOT, '.claude/skills/dflow-dev/scripts/heavy.sh')
const REF = (f: string) => readFileSync(join(ROOT, '.claude/skills/dflow-dev/references', f), 'utf8')

let tmp: string, dir: string
const kids: ChildProcess[] = []
const nowS = () => Math.floor(Date.now() / 1000)
/** 부하 30 · 10코어 → 상한 15 를 넘는다 */
const HOT = { DFLOW_HEAVY_LOADAVG: '30', DFLOW_HEAVY_CPUS: '10' }
/** 기다리는 쪽의 세션 — 살아 있을 필요가 없다 */
const OTHER = { DFLOW_HEAVY_OWNER: '1' }

function env(extra: Record<string, string> = {}) {
  return {
    ...process.env,
    DFLOW_HEAVY_DIR: dir, DFLOW_HEAVY_JOBS: join(tmp, 'jobs'), DFLOW_HEAVY_SLOTS: '2', DFLOW_HEAVY_WAIT: '1', DFLOW_HEAVY_POLL: '0.2',
    DFLOW_HEAVY_OWNER: '', CLAUDE_PID: '', DFLOW_HEAVY_HELD: '', DFLOW_HEAVY_DOCKER_HELD: '',
    DFLOW_HEAVY_E2E_SLOTS: '', DFLOW_HEAVY_LOAD_MAX: '', DFLOW_HEAVY_LOADAVG: '', DFLOW_HEAVY_CPUS: '',
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
  const done = new Promise<{ code: number | null; out: string }>((res) => p.on('close', (code) => res({ code, out })))
  kids.push(p)
  return { p, done, out: () => out }
}
/** 다른 세션의 살아 있는 보유자 */
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
const liveSlot = (name: string, pid: number, kind = 'run', cmd = 'other-gate') => {
  mkdirSync(join(dir, name), { recursive: true })
  writeFileSync(join(dir, name, 'owner'), `pid=${pid}\nkind=${kind}\nstart=${nowS()}\npstart=-\ncwd=/x\ncmd=${cmd}\n`)
}

beforeEach(() => {
  tmp = realpathSync(mkdtempSync(join(tmpdir(), 'dflow-heavy-load-')))
  dir = join(tmp, 'locks')
  mkdirSync(dir, { recursive: true })
})
afterEach(() => {
  for (const k of kids.splice(0)) { try { k.kill('SIGKILL') } catch { /* 이미 끝남 */ } }
  rmSync(tmp, { recursive: true, force: true })
})

describe('heavy.sh 부하 검사 — 새 일반 슬롯', { timeout: 30000 }, () => {
  it('보유자가 있고 부하가 상한을 넘으면 빈 슬롯이 있어도 미루고, HEAVY_BUSY·exit 75 에 부하를 적는다', () => {
    liveSlot('slot-1', sleeper())
    // 대기 상한 3초 — 병렬 시험 부하로 첫 시도가 1초를 넘겨도 대기 줄(HEAVY_LOAD_WAIT)이 나오게
    const r = run(['echo', 'ran'], { ...OTHER, ...HOT, DFLOW_HEAVY_WAIT: '3' })
    expect(r.code).toBe(75)
    expect(r.out).not.toContain('ran\n')
    expect(existsSync(join(dir, 'slot-2'))).toBe(false)
    const busy = r.err.split('\n').find((l) => l.startsWith('HEAVY_BUSY '))!
    expect(busy).toMatch(/^HEAVY_BUSY k=2 wait=3s 보유: \[slot-1 pid=\d+ 0분 run\] other-gate/)
    expect(busy.endsWith(' 부하 대기: load=30.0>cap=15.0')).toBe(true)
    // 대기 중 stderr 에도 부하 때문에 미뤘다는 줄이 나온다
    expect(r.err).toMatch(/^HEAVY_LOAD_WAIT load=30\.0>cap=15\.0 k=2 /m)
    // 기계가 읽는 HEAVY_STATUS 는 그대로다
    const s = run(['status'], HOT)
    expect(s.stdout).toBe('HEAVY_STATUS slots=2 held=1 waiting=0\n')
  })

  it('부하가 상한 이하면 슬롯을 준다(10코어 × 1.5 = 15, 부하 14.9)', () => {
    liveSlot('slot-1', sleeper())
    const r = run(['echo', 'ran'], { ...OTHER, DFLOW_HEAVY_LOADAVG: '14.9', DFLOW_HEAVY_CPUS: '10' })
    expect(r.code).toBe(0)
    expect(r.err).toContain('HEAVY_SLOT slot-2 k=2')
    expect(r.err).not.toContain('부하')
  })

  it('DFLOW_HEAVY_LOAD_MAX 로 상한을 바꾸고, 0 이면 검사를 끈다', () => {
    liveSlot('slot-1', sleeper())
    expect(run(['true'], { ...OTHER, ...HOT, DFLOW_HEAVY_LOAD_MAX: '3' }).code).toBe(0)
    expect(run(['true'], { ...OTHER, ...HOT, DFLOW_HEAVY_LOAD_MAX: '2' }).err).toContain('load=30.0>cap=20.0')
    const off = run(['echo', 'ran'], { ...OTHER, ...HOT, DFLOW_HEAVY_LOAD_MAX: '0' })
    expect(off.code).toBe(0)
    expect(off.err).toContain('HEAVY_SLOT slot-2')
  })

  it('부하나 코어 수를 못 읽으면 검사를 건너뛴다(fail-open)', () => {
    liveSlot('slot-1', sleeper())
    expect(run(['true'], { ...OTHER, DFLOW_HEAVY_LOADAVG: '-', DFLOW_HEAVY_CPUS: '10' }).code).toBe(0)
    expect(run(['true'], { ...OTHER, DFLOW_HEAVY_LOADAVG: '30', DFLOW_HEAVY_CPUS: '-' }).code).toBe(0)
  })

  it('기아 방지: 일반 풀 보유자가 0명이면 부하와 무관하게 하나는 준다', () => {
    const r = run(['echo', 'ran'], { ...OTHER, ...HOT })
    expect(r.code).toBe(0)
    expect(r.err).toContain('HEAVY_SLOT slot-1 k=2')
    expect(r.out).toContain('ran')
  })

  it('기아 방지는 실행(run) 보유자만 센다 — 살아 있는 일반 hold 만 있으면 부하가 높아도 준다(리뷰 회귀)', () => {
    // E2E 풀을 끈 acquire 의 hold 는 한 시간씩 떠 있을 수 있다. 세면 부하가 높은 동안 게이트가 hold TTL 내내 미뤄진다
    liveSlot('slot-1', sleeper(), 'hold', 'hold e2e-x')
    const r = run(['echo', 'ran'], { ...OTHER, ...HOT })
    expect(r.code).toBe(0)
    expect(r.err).toContain('HEAVY_SLOT slot-2 k=2')
    expect(r.out).toContain('ran')
    // 실행 보유자가 하나라도 있으면 예전처럼 미룬다
    liveSlot('slot-2', sleeper(), 'run', 'other-gate')
    rmSync(join(dir, 'slot-1'), { recursive: true })
    const d = run(['echo', 'ran'], { ...OTHER, ...HOT })
    expect(d.code).toBe(75)
    expect(d.err).toContain('부하 대기: load=30.0>cap=15.0')
  })

  it('부하로 미뤄 기다리던 호출은 보유자가 끝나 0명이 되면 슬롯을 얻는다', async () => {
    const holder = sleeper()
    liveSlot('slot-1', holder)
    const w = start(['echo', 'waiter-ran'], { ...OTHER, ...HOT, DFLOW_HEAVY_WAIT: '15' })
    await until(() => w.out().includes('HEAVY_LOAD_WAIT'))
    expect(existsSync(join(dir, 'slot-2'))).toBe(false)
    rmSync(join(dir, 'slot-1'), { recursive: true })
    const r = await w.done
    expect(r.code).toBe(0)
    expect(r.out).toContain('waiter-ran')
    // HEAVY_LOAD_WAIT 는 한 번만 낸다
    expect(r.out.split('HEAVY_LOAD_WAIT').length - 1).toBe(1)
  })

  it('E2E 풀을 끈 acquire(일반 슬롯 hold)도 새 일반 슬롯이라 미룬다', () => {
    liveSlot('slot-1', sleeper())
    const r = run(['acquire', 'e2e-x'], { ...OTHER, ...HOT, DFLOW_HEAVY_E2E_SLOTS: '0' })
    expect(r.code).toBe(75)
    expect(r.err).toContain('부하 대기: load=30.0>cap=15.0')
  })
})

describe('heavy.sh 부하 검사 — 적용하지 않는 곳', { timeout: 30000 }, () => {
  const me = () => ({ DFLOW_HEAVY_OWNER: String(process.pid) })

  it('E2E 풀 acquire 는 부하와 무관하게 잡고, 그 세션의 명령은 REUSE 로 돈다(쥔 슬롯은 빼앗지 않는다)', () => {
    liveSlot('slot-1', sleeper())
    const a = run(['acquire', 'e2e-x'], { ...me(), ...HOT })
    expect(a.code).toBe(0)
    expect(a.err).toContain(`HEAVY_ACQUIRED e2e-1 owner=${process.pid} e2e=1`)
    const r = run(['echo', 'reused'], { ...me(), ...HOT })
    expect(r.code).toBe(0)
    expect(r.err).toContain('HEAVY_REUSE e2e-1')
    expect(r.out).toContain('reused')
    // 도커 슬롯만 더 잡는 호출(need=0)도 검사하지 않는다
    const d = run(['--pool', 'docker', 'echo', 'docker-ran'], { ...me(), ...HOT })
    expect(d.code).toBe(0)
    expect(d.err).toContain('HEAVY_DOCKER_SLOT docker-1 docker=1')
    expect(d.err).not.toContain('+ slot-')
  })

  it('감싼 실행 안(DFLOW_HEAVY_HELD)의 안쪽 호출은 부하와 무관하게 곧바로 돈다', () => {
    liveSlot('slot-1', sleeper())
    const r = run(['sh', '-c', `bash '${HEAVY}' echo inner-ran`], { ...OTHER, ...HOT, DFLOW_HEAVY_HELD: join(dir, 'slot-1') })
    expect(r.code).toBe(0)
    expect(r.out).toContain('inner-ran')
    expect(r.err).not.toContain('HEAVY_BUSY')
  })

  it('독점 실행은 부하가 높아도 K개를 모두 잡는다(K=2)', () => {
    const r = run(['--exclusive', 'echo', 'excl-ran'], { ...OTHER, ...HOT })
    expect(r.code).toBe(0)
    expect(r.err).toContain('HEAVY_EXCL k=2 일반 슬롯 2개를 모두 잡았다')
    expect(r.out).toContain('excl-ran')
  })

  it('도커 풀(need=1)은 부하 검사를 도커 슬롯보다 먼저 해, 미룰 때 도커 슬롯을 남기지 않는다', () => {
    liveSlot('slot-1', sleeper())
    const r = run(['--pool', 'docker', 'echo', 'docker-ran'], { ...OTHER, ...HOT })
    expect(r.code).toBe(75)
    const busy = r.err.split('\n').find((l) => l.startsWith('HEAVY_DOCKER_BUSY '))!
    expect(busy.endsWith(' 부하 대기: load=30.0>cap=15.0')).toBe(true)
    expect(r.err).not.toContain('HEAVY_DOCKER_SLOT')
    expect(existsSync(join(dir, 'docker-1'))).toBe(false)
    expect(existsSync(join(dir, 'slot-2'))).toBe(false)
  })

  it('snapshot 의 PC 줄 형식은 그대로다(덮어쓴 부하·코어 수를 싣는다)', () => {
    const r = spawnSync('bash', [HEAVY, 'snapshot'], { encoding: 'utf8', env: env(HOT) })
    expect(r.status).toBe(0)
    expect(r.stdout).toBe('PC\t2\t0\t0\t30\t10\n')
  })
})

describe('부하 검사 문서', () => {
  it('heavy.sh 머리 주석·dev-discipline 정본·rationale 이 규칙과 이유를 적는다', () => {
    const src = readFileSync(HEAVY, 'utf8')
    const head = src.slice(0, src.indexOf('set -u'))
    for (const w of ['DFLOW_HEAVY_LOAD_MAX', 'DFLOW_HEAVY_LOADAVG', 'DFLOW_HEAVY_CPUS', 'HEAVY_LOAD_WAIT', '기아 방지', 'fail-open']) {
      expect(head).toContain(w)
    }
    const disc = REF('dev-discipline.md')
    const sec = disc.slice(disc.indexOf('## 무거운 명령 줄 세우기'), disc.indexOf('## 포그라운드 실행'))
    expect(sec).toContain('`DFLOW_HEAVY_LOAD_MAX`')
    expect(sec).toContain('부하 대기: load=')
    expect(REF('rationale.md').replace(/\s*\n\s*/g, ' ')).toContain('부하가 20~30(최대 62)까지 올랐고, 그 부하에서 벽시계 성능 테스트가 실패해 blocked 가 났다')
  })
})
