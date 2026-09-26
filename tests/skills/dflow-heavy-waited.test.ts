// tests/skills/dflow-heavy-waited.test.ts
// heavy.sh 가 슬롯을 **얻었을 때도** 기다린 초를 남긴다 — HEAVY_SLOT·HEAVY_DOCKER_SLOT·HEAVY_ACQUIRED·HEAVY_EXCL 줄 끝의
// `waited=<초>s`. 포기(HEAVY_BUSY … wait=Ns)만 시간이 남으면 기다려 얻은 대기를 잴 수 없었다(2026-09-26 dmes-standard 7건 분석).
// 기계가 읽는 HEAVY_STATUS 형식은 그대로다. 슬롯 폴더는 임시 DFLOW_HEAVY_DIR 이다(사용자 홈의 ~/.dflow 를 건드리지 않는다).
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const ROOT = process.cwd()
const HEAVY = join(ROOT, '.claude/skills/dflow-dev/scripts/heavy.sh')

let tmp: string, dir: string
const kids: ChildProcess[] = []

function env(extra: Record<string, string> = {}) {
  return {
    ...process.env,
    DFLOW_HEAVY_DIR: dir, DFLOW_HEAVY_JOBS: join(tmp, 'jobs'), DFLOW_HEAVY_SLOTS: '1', DFLOW_HEAVY_WAIT: '20', DFLOW_HEAVY_POLL: '0.2',
    DFLOW_HEAVY_OWNER: '', CLAUDE_PID: '', DFLOW_HEAVY_HELD: '', DFLOW_HEAVY_DOCKER_HELD: '',
    DFLOW_HEAVY_E2E_SLOTS: '', DFLOW_HEAVY_DOCKER_SLOTS: '', DFLOW_HEAVY_LOAD_MAX: '0', DFLOW_HEAVY_LOADAVG: '', DFLOW_HEAVY_CPUS: '',
    ...extra,
  }
}
function run(args: string[], extra: Record<string, string> = {}) {
  const r = spawnSync('bash', [HEAVY, ...args], { encoding: 'utf8', env: env(extra), timeout: 30000 })
  return { code: r.status, err: r.stderr || '', stdout: r.stdout || '' }
}
function start(args: string[], extra: Record<string, string> = {}) {
  const p = spawn('bash', [HEAVY, ...args], { env: env(extra), stdio: ['ignore', 'pipe', 'pipe'] })
  let err = ''
  p.stderr!.on('data', (b) => { err += b })
  const done = new Promise<{ code: number | null; err: string }>((res) => p.on('close', (code) => res({ code, err })))
  kids.push(p)
  return { done }
}
async function until(pred: () => boolean, ms = 10000) {
  const t0 = Date.now()
  while (!pred()) {
    if (Date.now() - t0 > ms) throw new Error('timeout waiting for condition')
    await new Promise((r) => setTimeout(r, 50))
  }
}
const waitedOf = (line: string) => Number(line.match(/ waited=(\d+)s$/m)![1])

beforeEach(() => {
  tmp = realpathSync(mkdtempSync(join(tmpdir(), 'dflow-heavy-waited-')))
  dir = join(tmp, 'locks')
  mkdirSync(dir, { recursive: true })
})
afterEach(() => {
  for (const k of kids.splice(0)) { try { k.kill('SIGKILL') } catch { /* 이미 끝남 */ } }
  rmSync(tmp, { recursive: true, force: true })
})

describe('heavy.sh 가 얻은 슬롯에 기다린 초를 붙인다', { timeout: 30000 }, () => {
  it('곧바로 얻으면 HEAVY_SLOT … k=<K> waited=0s(앞부분 형식은 그대로)', () => {
    const r = run(['echo', 'ran'])
    expect(r.code).toBe(0)
    expect(r.err).toMatch(/^HEAVY_SLOT slot-1 k=1 waited=\d+s$/m)
    expect(waitedOf(r.err.split('\n').find((l) => l.startsWith('HEAVY_SLOT'))!)).toBeLessThanOrEqual(1)
  })

  it('기다려 얻으면 기다린 초가 남는다', async () => {
    const first = start(['sleep', '2.5'])
    await until(() => existsSync(join(dir, 'slot-1', 'owner')))
    const r = run(['echo', 'ran'])
    expect(r.code).toBe(0)
    expect(r.err).toContain('HEAVY_WAIT k=1')
    const line = r.err.split('\n').find((l) => l.startsWith('HEAVY_SLOT'))!
    expect(line).toMatch(/^HEAVY_SLOT slot-1 k=1 waited=\d+s$/)
    expect(waitedOf(line)).toBeGreaterThanOrEqual(1)
    await first.done
  })

  it('acquire(E2E 풀·일반 풀), 도커 풀, 독점도 같은 꼬리를 붙인다', () => {
    const me = { DFLOW_HEAVY_OWNER: String(process.pid) }
    const e2e = run(['acquire', 'srv'], { ...me, DFLOW_HEAVY_E2E_SLOTS: '1' })
    expect(e2e.err).toMatch(new RegExp(`^HEAVY_ACQUIRED e2e-1 owner=${process.pid} e2e=1 waited=\\d+s$`, 'm'))
    expect(run(['release'], me).code).toBe(0)
    const gen = run(['acquire', 'srv'], { ...me, DFLOW_HEAVY_E2E_SLOTS: '0' })
    expect(gen.err).toMatch(new RegExp(`^HEAVY_ACQUIRED slot-1 owner=${process.pid} k=1 waited=\\d+s$`, 'm'))
    expect(run(['release'], me).code).toBe(0)
    const d = run(['--pool', 'docker', 'echo', 'ran'], { DFLOW_HEAVY_DOCKER_SLOTS: '1' })
    expect(d.err).toMatch(/^HEAVY_DOCKER_SLOT docker-1 docker=1 \+ slot-1 k=1 waited=\d+s$/m)
    const x = run(['--exclusive', 'echo', 'ran'], { DFLOW_HEAVY_SLOTS: '2' })
    expect(x.err).toMatch(/^HEAVY_EXCL k=2 일반 슬롯 2개를 모두 잡았다 waited=\d+s$/m)
  })

  it('분리 실행(--detach)의 자식도 잡 로그에 같은 줄을 남긴다', () => {
    const d = run(['--detach', 'echo', 'job'])
    const id = d.stdout.match(/^HEAVY_DETACHED id=(\S+)/m)![1]
    const w = run(['wait', id, '--max', '20'])
    expect(w.code).toBe(0)
    expect(w.stdout).toMatch(/^HEAVY_SLOT slot-1 k=1 waited=\d+s$/m)
  })

  it('기계가 읽는 HEAVY_STATUS 줄은 바뀌지 않는다', () => {
    expect(run(['status']).stdout).toBe('HEAVY_STATUS slots=1 held=0 waiting=0\n')
  })
})
