// tests/skills/dflow-heavy-snapshot.test.ts
// heavy.sh snapshot — 팀장 lease 갱신이 읽는 기계 출력(docs/superpowers/specs/2026-09-26-heavy-work-office-bubble-design.md §2-2).
// 슬롯 폴더는 DFLOW_HEAVY_DIR 로 임시 폴더에 둔다.
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const ROOT = process.cwd()
const HEAVY = join(ROOT, '.claude/skills/dflow-dev/scripts/heavy.sh')

let tmp: string, dir: string
const kids: ChildProcess[] = []
const env = (extra: Record<string, string> = {}) => ({
  ...process.env, DFLOW_HEAVY_DIR: dir, DFLOW_HEAVY_SLOTS: '2', DFLOW_HEAVY_WAIT: '10', DFLOW_HEAVY_POLL: '0.2',
  DFLOW_HEAVY_OWNER: '', CLAUDE_PID: '', ...extra,
})
const snap = (extra: Record<string, string> = {}) => {
  const r = spawnSync('bash', [HEAVY, 'snapshot'], { encoding: 'utf8', env: env(extra), timeout: 30000 })
  return { code: r.status, lines: (r.stdout || '').split('\n').filter(Boolean).map(l => l.split('\t')) }
}
const slot = (name: string, o: Record<string, string | number>) => {
  mkdirSync(join(dir, name), { recursive: true })
  writeFileSync(join(dir, name, 'owner'), Object.entries({ pstart: '-', host: 'h', ...o }).map(([k, v]) => `${k}=${v}`).join('\n') + '\n')
}
const WT = '/r/.claude/worktrees/dflow-abcdef12'
const DEAD = 999999

beforeEach(() => {
  tmp = realpathSync(mkdtempSync(join(tmpdir(), 'dflow-heavy-snap-')))
  dir = join(tmp, 'locks')
  mkdirSync(dir, { recursive: true })
})
afterEach(() => {
  for (const k of kids.splice(0)) { try { k.kill('SIGKILL') } catch { /* 이미 끝남 */ } }
  rmSync(tmp, { recursive: true, force: true })
})

describe('heavy.sh snapshot', { timeout: 30000 }, () => {
  it('비어 있으면 PC 줄 하나 — K·held·waiting·load·cpus, 탭 구분', () => {
    const { code, lines } = snap()
    expect(code).toBe(0)
    expect(lines).toHaveLength(1)
    const [tag, k, held, waiting, load, cpus] = lines[0]
    expect([tag, k, held, waiting]).toEqual(['PC', '2', '0', '0'])
    expect(load).toMatch(/^([0-9]+(\.[0-9]+)?|-)$/)
    expect(cpus).toMatch(/^([0-9]+|-)$/)
  })

  it('살아 있는 보유 슬롯은 RUN <start> <kind> <pool> <cwd> <cmd>, 죽은 소유자는 뺀다', () => {
    slot('slot-1', { pid: process.pid, kind: 'run', start: 1790000000, cwd: `${WT}/sub dir`, cmd: 'npm run test' })
    slot('slot-2', { pid: DEAD, kind: 'run', start: 1790000001, cwd: WT, cmd: 'dead' })
    const { lines } = snap()
    expect(lines[0].slice(0, 3)).toEqual(['PC', '2', '1'])
    expect(lines.slice(1)).toEqual([['RUN', '1790000000', 'run', 'general', `${WT}/sub dir`, 'npm run test']])
  })

  it('도커 풀 실행(도커 슬롯+일반 슬롯, 같은 pid)은 한 줄로 합치고 pool=docker, [docker] 머리는 뗀다', () => {
    slot('docker-1', { pid: process.pid, kind: 'run', start: 1790000000, cwd: WT, cmd: '[docker] ./gradlew mssqlMigrationTest' })
    slot('slot-1', { pid: process.pid, kind: 'run', start: 1790000000, cwd: WT, cmd: '[docker] ./gradlew mssqlMigrationTest' })
    const { lines } = snap()
    expect(lines.slice(1)).toEqual([['RUN', '1790000000', 'run', 'docker', WT, './gradlew mssqlMigrationTest']])
  })

  it('hold 슬롯은 kind=hold 로 낸다', () => {
    const now = Math.floor(Date.now() / 1000) // hold 는 TTL(3600초)이 지나면 버려진 것으로 본다
    slot('slot-1', { pid: process.pid, kind: 'hold', start: now, cwd: WT, cmd: 'hold e2e' })
    expect(snap().lines[1]).toEqual(['RUN', String(now), 'hold', 'general', WT, 'hold e2e'])
  })

  it('실제 대기 중인 heavy.sh 는 WAIT <start> <pool> <cwd> <cmd> 로 보이고, 끝나면 사라진다', async () => {
    const cwd = join(tmp, '.claude/worktrees/dflow-0badc0de')
    mkdirSync(cwd, { recursive: true })
    slot('slot-1', { pid: process.pid, kind: 'run', start: 1790000000, cwd: WT, cmd: 'a' })
    slot('slot-2', { pid: process.pid, kind: 'run', start: 1790000000, cwd: WT, cmd: 'b' })
    const p = spawn('bash', [HEAVY, 'sleep', '0'], { cwd, env: env(), stdio: 'ignore' })
    kids.push(p)
    const t0 = Date.now()
    while (!readdirSync(dir).some(f => f.startsWith('wait-'))) {
      if (Date.now() - t0 > 10000) throw new Error('대기 표식이 생기지 않았다')
      await new Promise(r => setTimeout(r, 50))
    }
    const w = snap().lines.filter(l => l[0] === 'WAIT')
    expect(w).toHaveLength(1)
    expect(w[0][1]).toMatch(/^[0-9]+$/)
    expect(w[0].slice(2)).toEqual(['general', cwd, 'sleep 0'])
    expect(snap().lines[0][3]).toBe('1')
    p.kill('SIGTERM')
    await new Promise(r => p.on('close', r))
    expect(snap().lines.filter(l => l[0] === 'WAIT')).toHaveLength(0)
  })

  it('주인이 죽은 대기 표식은 무시하고 지운다', () => {
    writeFileSync(join(dir, `wait-${DEAD}`), `pid=${DEAD}\npool=general\nstart=1\npstart=-\ncwd=${WT}\ncmd=x\n`)
    expect(snap().lines.filter(l => l[0] === 'WAIT')).toHaveLength(0)
    expect(existsSync(join(dir, `wait-${DEAD}`))).toBe(false)
  })

  it('명령의 탭은 공백으로 바꿔 필드가 밀리지 않는다', () => {
    slot('slot-1', { pid: process.pid, kind: 'run', start: 1, cwd: WT, cmd: 'echo\ta' })
    expect(snap().lines[1]).toHaveLength(6)
    expect(snap().lines[1][5]).toBe('echo a')
  })

  it('status 의 stdout 한 줄 형식은 그대로다(capacity.sh 가 읽는다)', () => {
    const r = spawnSync('bash', [HEAVY, 'status'], { encoding: 'utf8', env: env() })
    expect(r.stdout).toBe('HEAVY_STATUS slots=2 held=0 waiting=0\n')
  })
})
