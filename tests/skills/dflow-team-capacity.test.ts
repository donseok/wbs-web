// tests/skills/dflow-team-capacity.test.ts
// 팀장 입장 제어(capacity.sh) — 가짜 memory_pressure·sysctl(macOS)과 가짜 /proc(Linux)로 판정을 실제로 돌려 본다.
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { spawnSync } from 'node:child_process'
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const ROOT = process.cwd()
const CAP = join(ROOT, '.claude/skills/dflow-team/scripts/capacity.sh')
const TEAM = readFileSync(join(ROOT, '.claude/skills/dflow-team/SKILL.md'), 'utf8')

let tmp: string

beforeEach(() => { tmp = realpathSync(mkdtempSync(join(tmpdir(), 'dflow-cap-'))) })
afterEach(() => { rmSync(tmp, { recursive: true, force: true }) })

function cap(args: string[], env: Record<string, string>) {
  const r = spawnSync('bash', [CAP, ...args], { encoding: 'utf8', env: { ...process.env, DFLOW_CAP_NCPU: '10', ...env } })
  return { code: r.status, out: (r.stdout || '').trim() }
}

// macOS 흉내: memory_pressure·sysctl 을 PATH 앞에 둔다
function fakeDarwin(o: { free?: number; swapUsedM?: string; load5?: number; level?: number; mpFails?: boolean; sysctlFails?: boolean }) {
  const bin = join(tmp, 'bin')
  mkdirSync(bin, { recursive: true })
  writeFileSync(join(bin, 'memory_pressure'), o.mpFails
    ? '#!/bin/sh\nexit 1\n'
    : `#!/bin/sh\necho "The system has 17179869184 (1048576 pages with a page size of 16384)."\necho "System-wide memory free percentage: ${o.free}%"\n`)
  writeFileSync(join(bin, 'sysctl'), o.sysctlFails ? '#!/bin/sh\nexit 1\n' : `#!/bin/sh
case "$*" in
  "-n hw.memsize") echo 17179869184 ;;
  "-n vm.swapusage") echo "total = 18432.00M  used = ${o.swapUsedM ?? '0.00M'}  free = 1.00M  (encrypted)" ;;
  "-n vm.loadavg") echo "{ 1.00 ${o.load5 ?? 1} 1.00 }" ;;
  "-n kern.memorystatus_vm_pressure_level") echo ${o.level ?? 1} ;;
  "-n kern.memorystatus_level") echo ${o.free ?? 50} ;;
  *) exit 1 ;;
esac
`)
  chmodSync(join(bin, 'memory_pressure'), 0o755)
  chmodSync(join(bin, 'sysctl'), 0o755)
  return { PATH: `${bin}:${process.env.PATH}`, DFLOW_CAP_OS: 'Darwin' }
}

function fakeLinux(meminfo: string, loadavg = '1.00 2.00 3.00 1/100 1\n') {
  const proc = join(tmp, 'proc')
  mkdirSync(proc, { recursive: true })
  writeFileSync(join(proc, 'meminfo'), meminfo)
  writeFileSync(join(proc, 'loadavg'), loadavg)
  return { DFLOW_CAP_OS: 'Linux', DFLOW_CAP_PROC: proc }
}

// 한 시험이 bash 를 여러 번 띄운다. PC 가 바쁠 때(바로 이 스크립트가 막으려는 상황) 기본 5초를 넘기므로 넉넉히 준다.
describe('capacity.sh — 팀원 입장 제어 판정', { timeout: 30000 }, () => {
  it('bash 로 파싱되고 실행 권한이 있다', () => {
    expect(spawnSync('bash', ['-n', CAP]).status).toBe(0)
    expect(spawnSync('test', ['-x', CAP]).status).toBe(0)
  })

  it('macOS: 여유 있으면 CAPACITY_OK·exit 0 이고 측정값을 한 줄에 싣는다', () => {
    const r = cap([], fakeDarwin({ free: 64, swapUsedM: '8192.00M', load5: 9, level: 1 }))
    expect(r.code).toBe(0)
    expect(r.out).toBe('CAPACITY_OK free=64% swap=50% load=0.9 pressure=normal os=darwin limits=free>=30%,swap<100%,load<=1.5')
  })

  it('macOS: 2026-09-24 사고 수준(스왑 17GB/RAM 16GB·load 52·warn)이면 CAPACITY_LOW·exit 1 과 사유 전부', () => {
    const r = cap([], fakeDarwin({ free: 20, swapUsedM: '17408.00M', load5: 52, level: 2 }))
    expect(r.code).toBe(1)
    expect(r.out).toMatch(/^CAPACITY_LOW 여유메모리20%<30% 스왑106%>=100% load5\.2\/코어>1\.5 메모리압박=warn \| free=20% /)
  })

  it('macOS: 스왑이 RAM 보다 적게 남아 있을 뿐이고 압박이 정상이면 막지 않는다(오래된 스왑)', () => {
    const r = cap([], fakeDarwin({ free: 64, swapUsedM: '14290.75M', load5: 5, level: 1 }))
    expect(r.code).toBe(0)
    expect(r.out).toContain('swap=87%')
  })

  it('macOS: memory_pressure 가 없으면 kern.memorystatus_level 로 여유 비율을 읽는다', () => {
    const r = cap([], fakeDarwin({ free: 12, mpFails: true, swapUsedM: '0.00M', load5: 1 }))
    expect(r.code).toBe(1)
    expect(r.out).toContain('여유메모리12%<30%')
  })

  it('기준값은 환경변수로 덮는다', () => {
    const env = fakeDarwin({ free: 40, swapUsedM: '0.00M', load5: 12, level: 1 })
    expect(cap([], env).code).toBe(0)
    const r = cap([], { ...env, DFLOW_CAP_MIN_FREE_PCT: '50', DFLOW_CAP_MAX_LOAD_PER_CPU: '1.0' })
    expect(r.code).toBe(1)
    expect(r.out).toMatch(/^CAPACITY_LOW 여유메모리40%<50% load1\.2\/코어>1\.0 \|/)
  })

  it('명령이 모두 실패하면 막지 않고 CAPACITY_UNKNOWN 을 낸다(fail-open)', () => {
    const r = cap([], { ...fakeDarwin({ mpFails: true, sysctlFails: true }), DFLOW_CAP_NCPU: '' })
    expect(r.code).toBe(0)
    expect(r.out).toMatch(/^CAPACITY_UNKNOWN 판정 불가\(os=darwin\) — 막지 않는다 \| free=\?% swap=\?% load=\?/)
    expect(r.out).toContain('unknown=free,swap,load')
  })

  it('일부만 읽히면 읽은 항목으로 판정하고 못 읽은 항목을 알린다', () => {
    const r = cap([], fakeLinux('MemTotal: 16000000 kB\nMemAvailable: 8000000 kB\n', ''))
    expect(r.code).toBe(0)
    expect(r.out).toContain('free=50% swap=?% load=?')
    expect(r.out).toContain('unknown=swap,load')
  })

  it('판정할 수 없는 OS 는 막지 않는다', () => {
    const r = cap([], { DFLOW_CAP_OS: 'MINGW64_NT-10.0', DFLOW_CAP_NCPU: '' })
    expect(r.code).toBe(0)
    expect(r.out).toMatch(/^CAPACITY_UNKNOWN 판정 불가\(os=MINGW64_NT-10\.0\)/)
  })

  it('Linux: MemAvailable·SwapFree·/proc/loadavg 로 판정한다', () => {
    const ok = cap([], fakeLinux('MemTotal: 16000000 kB\nMemAvailable: 9600000 kB\nSwapTotal: 8000000 kB\nSwapFree: 8000000 kB\n'))
    expect(ok.code).toBe(0)
    expect(ok.out).toBe('CAPACITY_OK free=60% swap=0% load=0.2 os=linux limits=free>=30%,swap<100%,load<=1.5')
    const low = cap([], fakeLinux('MemTotal: 16000000 kB\nMemAvailable: 1600000 kB\nSwapTotal: 8000000 kB\nSwapFree: 1000000 kB\n', '40.0 30.0 20.0 1/1 1\n'))
    expect(low.code).toBe(1)
    expect(low.out).toMatch(/^CAPACITY_LOW 여유메모리10%<30% load3\.0\/코어>1\.5 \| free=10% swap=44%/)
  })

  it('--state: 판정이 바뀔 때만 notify=1 — TICK 마다 같은 알림을 되풀이하지 않는다', () => {
    const st = join(tmp, 'cap.state')
    const low = fakeDarwin({ free: 10, swapUsedM: '0.00M', load5: 1, level: 1 })
    expect(cap(['--state', st], low).out).toMatch(/notify=1$/)
    expect(cap(['--state', st], low).out).toMatch(/notify=0$/)
    expect(readFileSync(st, 'utf8')).toMatch(/^\d+ CAPACITY_LOW /)
    const ok = fakeDarwin({ free: 70, swapUsedM: '0.00M', load5: 1, level: 1 })
    expect(cap(['--state', st], ok).out).toMatch(/^CAPACITY_OK .*notify=1$/)
    expect(cap(['--state', st], ok).out).toMatch(/notify=0$/)
    // 상태 파일이 없으면 지난 판정을 OK 로 본다: 처음 OK 는 알리지 않는다
    expect(cap(['--state', join(tmp, 'fresh')], ok).out).toMatch(/notify=0$/)
  })
})

describe('팀장 SKILL.md 의 입장 제어', () => {
  const sec = TEAM.slice(TEAM.indexOf('### 5-3. 입장 제어'), TEAM.indexOf('## 6. blocked'))
  it('「5. 팀원 spawn」 첫 단계가 입장 제어를 가리키고, 5-3 절이 정본이다', () => {
    const five = TEAM.slice(TEAM.indexOf('## 5. 팀원 spawn'), TEAM.indexOf('### 5-1. 재개 spawn'))
    expect(five).toContain('「5-3. 입장 제어」')
    expect(five.indexOf('「5-3. 입장 제어」')).toBeLessThan(five.indexOf('1. 그 id8 이 재구성한 슬롯 표에 있으면'))
    expect(sec).toContain('.claude/skills/dflow-team/scripts/capacity.sh --state')
    expect(sec).toContain('CAPACITY_LOW')
    expect(sec).toContain('CAPACITY_UNKNOWN')
    expect(sec).toContain('notify=1')
    expect(sec).toContain('이미 떠 있는 팀원은 건드리지 않는다')
  })
})
