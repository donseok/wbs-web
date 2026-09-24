// tests/skills/dflow-team-capacity.test.ts
// 팀장 입장 제어(capacity.sh) — 가짜 memory_pressure·sysctl(macOS)과 가짜 /proc(Linux)로 판정을 실제로 돌려 본다.
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { spawnSync } from 'node:child_process'
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const ROOT = process.cwd()
const CAP = join(ROOT, '.claude/skills/dflow-team/scripts/capacity.sh')
const TEAM = readFileSync(join(ROOT, '.claude/skills/dflow-team/SKILL.md'), 'utf8')

let tmp: string

beforeEach(() => { tmp = realpathSync(mkdtempSync(join(tmpdir(), 'dflow-cap-'))) })
afterEach(() => { rmSync(tmp, { recursive: true, force: true }) })

// 실제 heavy.sh(이 PC 의 ~/.dflow/locks/heavy)를 읽지 않도록 기본은 없는 경로를 준다. 사람 환경의 덮기 값도 벗긴다.
function baseEnv() {
  const e: Record<string, string | undefined> = { ...process.env }
  for (const k of Object.keys(e)) if (k.startsWith('DFLOW_CAP_') || k === 'DFLOW_TEAM_MAX' || k === 'DFLOW_HEAVY_SLOTS') delete e[k]
  return { ...e, DFLOW_CAP_NCPU: '10', DFLOW_HEAVY_BIN: join(tmp, 'no-heavy.sh') }
}
function cap(args: string[], env: Record<string, string>) {
  const r = spawnSync('bash', [CAP, ...args], { encoding: 'utf8', env: { ...baseEnv(), ...env } })
  return { code: r.status, out: (r.stdout || '').trim() }
}

// heavy.sh status 흉내: 첫 줄을 그대로 내고 rc 로 끝난다
function fakeHeavy(firstLine: string, rc = 0) {
  const f = join(tmp, `heavy-${Math.random().toString(36).slice(2)}.sh`)
  writeFileSync(f, `#!/bin/sh\n[ "$1" = status ] || exit 2\necho '${firstLine}'\necho '[slot-1 pid=1 3분 run] ./gradlew test'\nexit ${rc}\n`)
  return { DFLOW_HEAVY_BIN: f }
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
    const r = cap([], { ...fakeDarwin({ free: 64, swapUsedM: '8192.00M', load5: 9, level: 1 }), ...fakeHeavy('HEAVY_STATUS slots=2 held=1 waiting=0 ram=16GB') })
    expect(r.code).toBe(0)
    expect(r.out).toBe('CAPACITY_OK free=64% swap=50% load=0.9 heavy_wait=0/2 pressure=normal os=darwin limits=free>=30%,load<=2.0,heavy_wait<slots,swap<150%')
  })

  it('macOS: 2026-09-24 사고 수준(스왑 17GB/RAM 16GB·load 52·warn·heavy 줄 4명)이면 CAPACITY_LOW·exit 1 과 사유 전부', () => {
    const r = cap([], { ...fakeDarwin({ free: 20, swapUsedM: '17408.00M', load5: 52, level: 2 }), ...fakeHeavy('HEAVY_STATUS slots=2 held=2 waiting=4') })
    expect(r.code).toBe(1)
    expect(r.out).toMatch(/^CAPACITY_LOW 여유메모리20%<30% load5\.2\/코어>2\.0 메모리압박=warn heavy대기4>=슬롯2 \| free=20% swap=106% load=5\.2 heavy_wait=4\/2 /)
  })

  it('macOS: 압박이 풀린 뒤 남은 스왑(RAM 을 넘어도)만으로는 막지 않는다 — 스왑은 극단 안전망(150%)뿐', () => {
    // 2026-09-24 실측: 스왑 12GB(76%) 는 이전 기준에서도 통과했고, 사고 직후 남은 17GB(106%)도 압박 normal 이면 여유가 있다
    for (const used of ['12451.84M', '17408.00M']) {
      const r = cap([], fakeDarwin({ free: 56, swapUsedM: used, load5: 10, level: 1 }))
      expect(r.code, r.out).toBe(0)
      expect(r.out).toMatch(/^CAPACITY_OK /)
    }
    const r = cap([], fakeDarwin({ free: 56, swapUsedM: '25600.00M', load5: 10, level: 1 }))
    expect(r.code).toBe(1)
    expect(r.out).toMatch(/^CAPACITY_LOW 스왑156%>=150% \|/)
  })

  it('load 기준은 코어당 2.0 초과다(10코어에 5분 load 20 은 통과, 21 은 막음)', () => {
    expect(cap([], fakeDarwin({ free: 60, load5: 20, level: 1 })).code).toBe(0)
    const r = cap([], fakeDarwin({ free: 60, load5: 21, level: 1 }))
    expect(r.code).toBe(1)
    expect(r.out).toMatch(/^CAPACITY_LOW load2\.1\/코어>2\.0 \|/)
  })

  it('macOS 메모리 압박 warn·critical 은 다른 값이 넉넉해도 막는다', () => {
    for (const [level, name] of [[2, 'warn'], [4, 'critical']] as const) {
      const r = cap([], fakeDarwin({ free: 60, load5: 1, level }))
      expect(r.code).toBe(1)
      expect(r.out.startsWith(`CAPACITY_LOW 메모리압박=${name} |`), r.out).toBe(true)
    }
  })

  it('heavy 대기자가 슬롯 수 이상이면 막고, 슬롯보다 적으면 통과한다', () => {
    const env = fakeDarwin({ free: 60, load5: 1, level: 1 })
    expect(cap([], { ...env, ...fakeHeavy('HEAVY_STATUS slots=2 held=2 waiting=1') }).code).toBe(0)
    const r = cap([], { ...env, ...fakeHeavy('HEAVY_STATUS slots=2 held=2 waiting=2 ram=16GB dir=/x wait=240s') })
    expect(r.code).toBe(1)
    expect(r.out).toMatch(/^CAPACITY_LOW heavy대기2>=슬롯2 \| .*heavy_wait=2\/2 /)
  })

  it('heavy.sh 가 없거나 옛 형식이거나 값이 이상하면 그 항목은 판정하지 않는다(fail-open)', () => {
    const env = fakeDarwin({ free: 60, load5: 1, level: 1 })
    const cases: Record<string, string>[] = [
      {},                                                            // 기본: 없는 경로
      fakeHeavy('HEAVY_STATUS k=2 ram=16GB dir=/x wait=240s'),       // 지금 heavy.sh 의 옛 형식
      fakeHeavy('HEAVY_STATUS slots=x held=2 waiting=9'),
      fakeHeavy('HEAVY_STATUS slots=0 held=0 waiting=9'),
      fakeHeavy('HEAVY_BUSY slots=2 held=2 waiting=9', 75),
    ]
    for (const h of cases) {
      const r = cap([], { ...env, ...h })
      expect(r.code, r.out).toBe(0)
      expect(r.out).toContain('heavy_wait=?')
      expect(r.out).toMatch(/unknown=heavy$/)
    }
  })

  it('heavy.sh 는 capacity.sh 기준 상대 경로(형제 스킬 dflow-dev)에서 찾는다 — 스킬 폴더가 심링크여도', () => {
    const skills = join(tmp, 'kit', 'skills')
    mkdirSync(join(skills, 'dflow-team', 'scripts'), { recursive: true })
    mkdirSync(join(skills, 'dflow-dev', 'scripts'), { recursive: true })
    writeFileSync(join(skills, 'dflow-team', 'scripts', 'capacity.sh'), readFileSync(CAP, 'utf8'))
    writeFileSync(join(skills, 'dflow-dev', 'scripts', 'heavy.sh'), '#!/bin/sh\necho "HEAVY_STATUS slots=1 held=1 waiting=1"\n')
    const repo = join(tmp, 'repo', '.claude')
    mkdirSync(repo, { recursive: true })
    symlinkSync(skills, join(repo, 'skills'))
    const env: Record<string, string | undefined> = { ...baseEnv(), ...fakeDarwin({ free: 60, load5: 1, level: 1 }) }
    delete env.DFLOW_HEAVY_BIN
    const r = spawnSync('bash', [join(repo, 'skills', 'dflow-team', 'scripts', 'capacity.sh')], { encoding: 'utf8', env })
    expect(r.status, r.stdout).toBe(1)
    expect(r.stdout).toMatch(/^CAPACITY_LOW heavy대기1>=슬롯1 /)
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
    const s = cap([], { ...fakeDarwin({ free: 60, swapUsedM: '12451.84M', load5: 1, level: 1 }), DFLOW_CAP_MAX_SWAP_PCT: '50' })
    expect(s.out).toMatch(/^CAPACITY_LOW 스왑76%>=50% \|/)
  })

  it('명령이 모두 실패하면 막지 않고 CAPACITY_UNKNOWN 을 낸다(fail-open)', () => {
    const r = cap([], { ...fakeDarwin({ mpFails: true, sysctlFails: true }), DFLOW_CAP_NCPU: '' })
    expect(r.code).toBe(0)
    expect(r.out).toMatch(/^CAPACITY_UNKNOWN 판정 불가\(os=darwin\) — 막지 않는다 \| free=\?% swap=\?% load=\?/)
    expect(r.out).toContain('unknown=free,swap,load,heavy')
  })

  it('일부만 읽히면 읽은 항목으로 판정하고 못 읽은 항목을 알린다', () => {
    const r = cap([], fakeLinux('MemTotal: 16000000 kB\nMemAvailable: 8000000 kB\n', ''))
    expect(r.code).toBe(0)
    expect(r.out).toContain('free=50% swap=?% load=?')
    expect(r.out).toContain('unknown=swap,load,heavy')
  })

  it('판정할 수 없는 OS 는 막지 않는다', () => {
    const r = cap([], { DFLOW_CAP_OS: 'MINGW64_NT-10.0', DFLOW_CAP_NCPU: '' })
    expect(r.code).toBe(0)
    expect(r.out).toMatch(/^CAPACITY_UNKNOWN 판정 불가\(os=MINGW64_NT-10\.0\)/)
    // 자원을 못 읽는 OS 라도 heavy 줄은 읽히면 판정한다(Windows 셸에서도 heavy.sh 는 돈다)
    const h = cap([], { DFLOW_CAP_OS: 'MINGW64_NT-10.0', DFLOW_CAP_NCPU: '', ...fakeHeavy('HEAVY_STATUS slots=2 held=2 waiting=3') })
    expect(h.code).toBe(1)
    expect(h.out).toMatch(/^CAPACITY_LOW heavy대기3>=슬롯2 \|/)
  })

  it('max: 기본 인원 상한은 min(6, K+2) — K 는 heavy.sh 와 같은 계산(16GB→2→4명)', () => {
    const dar = (gb: number) => {
      const e = fakeDarwin({ free: 60 })
      writeFileSync(join(tmp, 'bin', 'sysctl'), `#!/bin/sh\n[ "$*" = "-n hw.memsize" ] && echo ${gb * 1073741824} && exit 0\nexit 1\n`)
      return e
    }
    expect(cap(['max'], dar(16)).out).toBe('TEAM_MAX 4 k=2 ram=16GB source=default')
    expect(cap(['max'], dar(8)).out).toBe('TEAM_MAX 3 k=1 ram=8GB source=default')
    expect(cap(['max'], dar(4)).out).toBe('TEAM_MAX 3 k=1 ram=4GB source=default')
    expect(cap(['max'], dar(32)).out).toBe('TEAM_MAX 6 k=4 ram=32GB source=default')
    expect(cap(['max'], dar(128)).out).toBe('TEAM_MAX 6 k=16 ram=128GB source=default')
    // heavy.sh 와 같은 덮기: DFLOW_HEAVY_SLOTS
    expect(cap(['max'], { ...dar(16), DFLOW_HEAVY_SLOTS: '3' }).out).toBe('TEAM_MAX 5 k=3 ram=16GB source=default')
    expect(cap(['max'], dar(16)).code).toBe(0)
  })

  it('max: RAM 을 못 읽으면 K=2(heavy.sh 와 같다), Linux 는 /proc/meminfo 로 읽는다', () => {
    const bin = join(tmp, 'bin'); mkdirSync(bin, { recursive: true })
    writeFileSync(join(bin, 'sysctl'), '#!/bin/sh\nexit 1\n'); chmodSync(join(bin, 'sysctl'), 0o755)
    const noSysctl = { PATH: `${bin}:${process.env.PATH}` }
    expect(cap(['max'], { ...noSysctl, DFLOW_CAP_PROC: join(tmp, 'none') }).out).toBe('TEAM_MAX 4 k=2 ram=?GB source=default')
    const lin = fakeLinux('MemTotal: 16303244 kB\nMemAvailable: 1 kB\n')   // 16GB 장비의 실제 MemTotal(커널 예약분만큼 작다)
    expect(cap(['max'], { ...noSysctl, ...lin }).out).toBe('TEAM_MAX 4 k=2 ram=16GB source=default')
  })

  it('max: DFLOW_TEAM_MAX 로 덮되 천장 6 은 넘지 못하고, 이상한 값은 무시한다', () => {
    const e = fakeDarwin({ free: 60 })
    expect(cap(['max'], { ...e, DFLOW_TEAM_MAX: '2' }).out).toBe('TEAM_MAX 2 k=2 ram=16GB source=DFLOW_TEAM_MAX')
    expect(cap(['max'], { ...e, DFLOW_TEAM_MAX: '6' }).out).toBe('TEAM_MAX 6 k=2 ram=16GB source=DFLOW_TEAM_MAX')
    expect(cap(['max'], { ...e, DFLOW_TEAM_MAX: '9' }).out).toBe('TEAM_MAX 6 k=2 ram=16GB source=DFLOW_TEAM_MAX clamped=9')
    expect(cap(['max'], { ...e, DFLOW_TEAM_MAX: '0' }).out).toBe('TEAM_MAX 4 k=2 ram=16GB source=default ignored=DFLOW_TEAM_MAX:0')
    expect(cap(['max'], { ...e, DFLOW_TEAM_MAX: 'x' }).out).toBe('TEAM_MAX 4 k=2 ram=16GB source=default ignored=DFLOW_TEAM_MAX:x')
  })

  it('Linux: MemAvailable·SwapFree·/proc/loadavg 로 판정한다', () => {
    const ok = cap([], fakeLinux('MemTotal: 16000000 kB\nMemAvailable: 9600000 kB\nSwapTotal: 8000000 kB\nSwapFree: 8000000 kB\n'))
    expect(ok.code).toBe(0)
    expect(ok.out).toBe('CAPACITY_OK free=60% swap=0% load=0.2 heavy_wait=? os=linux limits=free>=30%,load<=2.0,heavy_wait<slots,swap<150% unknown=heavy')
    const low = cap([], fakeLinux('MemTotal: 16000000 kB\nMemAvailable: 1600000 kB\nSwapTotal: 8000000 kB\nSwapFree: 1000000 kB\n', '40.0 20.0 20.0 1/1 1\n'))
    expect(low.code).toBe(1)
    expect(low.out).toMatch(/^CAPACITY_LOW 여유메모리10%<30% \| free=10% swap=44%/)
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

  // 2026-09-24: 입장 제어가 SKILL.md 한 줄과 "5-1·5-2 도 같다" 로만 이어져 해소·재투입·spawn 블록에 호출이 없었다.
  it('집행은 backends.md spawn 블록 한 곳이다 — tmux 블록 첫 두 줄, Orca·재개·재투입은 「입장 제어」 블록을 먼저', () => {
    const B = readFileSync(join(ROOT, '.claude/skills/dflow-team/references/backends.md'), 'utf8')
    const R = readFileSync(join(ROOT, '.claude/skills/dflow-team/references/restart.md'), 'utf8')
    const gate = 'CAP=$(.claude/skills/dflow-team/scripts/capacity.sh --state "$(git rev-parse --git-path dflow-team.capacity)"); echo "$CAP"\n'
      + 'case "$CAP" in CAPACITY_LOW*) echo SPAWN_DEFERRED_CAPACITY; exit 0 ;; esac\n'
    expect(B).toContain('## 입장 제어')
    // tmux spawn 블록은 입장 제어 두 줄로 시작하고 그 뒤에 tmux 를 찾는다
    expect(B).toContain('```bash\n' + gate + 'TM=$(find_tmux)\nWT="<MAIN>/.claude/worktrees/dflow-<id8>"')
    expect(B).toMatch(/\*\*spawn\*\*: 먼저 「입장 제어」 블록을 따로 돈다/)
    expect(R.slice(R.indexOf('## 재투입'))).toMatch(/\*\*입장 제어\*\*: `REINJECT_OK` 뒤[^\n]*backends\.md 「입장 제어」/)
    const five = TEAM.slice(TEAM.indexOf('## 5. 팀원 spawn'), TEAM.indexOf('### 5-1. 재개 spawn'))
    expect(five).toContain('**입장 제어는 spawn 블록이 집행한다**')
    const resume = TEAM.slice(TEAM.indexOf('### 5-1. 재개 spawn'), TEAM.indexOf('### 5-2. 해소 spawn'))
    expect(resume.indexOf('0. **입장 제어**')).toBeLessThan(resume.indexOf('1. **손실 보고 한 줄을 먼저 낸다.**'))
    expect(sec).toContain('**집행은 spawn 블록 한 곳이다.**')
    expect(sec).toContain('SPAWN_DEFERRED_CAPACITY')
    // 압축 뒤 재독 목록에 입장 제어가 든다
    expect(TEAM).toMatch(/「5-3\. 입장 제어」「6\. blocked」/)
    expect(TEAM).toContain('「입장 제어」「고아 정리 규칙」 을 Bash `cat` 으로 다시 읽고')
  })

  it('기준값 설명이 capacity.sh 와 맞는다(load 2.0·heavy 대기·스왑 150% 안전망)', () => {
    expect(sec).toContain('코어당\n  2.0 초과')
    expect(sec).toContain('`heavy_wait=<대기>/<슬롯>`')
    expect(sec).toContain('RAM 의 150% 이상일 때만 막는 극단 안전망')
  })
})
