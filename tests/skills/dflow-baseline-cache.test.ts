// tests/skills/dflow-baseline-cache.test.ts
// 게이트 기준선 캐시(.claude/skills/dflow-dev/scripts/baseline.sh). 같은 기점·같은 명령의 기준선을 팀원마다 다시 재지
// 않는다(2026-09-24 dmes-standard: 팀원 셋이 같은 testAll 기준선을 각자 몇 분씩 돌렸다). 실제 git 샌드박스에서 돌린다.
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { hostname, tmpdir } from 'node:os'
import { join } from 'node:path'

const ROOT = process.cwd()
const BASELINE = join(ROOT, '.claude/skills/dflow-dev/scripts/baseline.sh')
const DEV = readFileSync(join(ROOT, '.claude/skills/dflow-dev/SKILL.md'), 'utf8')
const DISCIPLINE = readFileSync(join(ROOT, '.claude/skills/dflow-dev/references/dev-discipline.md'), 'utf8')

const GIT_ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t',
  GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1',
  DFLOW_BASELINE_POLL: '0.2',
  // baseline.sh 는 측정을 heavy.sh(PC 전역 세마포어)로 감싼다 — 시험이 이 PC 의 실제 슬롯을 쓰지 않게 임시 폴더로 돌린다
  DFLOW_HEAVY_DIR: mkdtempSync(join(tmpdir(), 'dflow-baseline-heavy-')),
  // 시험 자체를 heavy.sh 안에서 돌려도 안쪽 호출로 여겨 슬롯을 건너뛰지 않게 한다
  DFLOW_HEAVY_HELD: '', DFLOW_HEAVY_DOCKER_HELD: '',
}

function sh(cwd: string, script: string, env: Record<string, string> = {}) {
  const r = spawnSync('bash', ['-c', script], { cwd, encoding: 'utf8', timeout: 60_000, env: { ...GIT_ENV, ...env } })
  return { code: r.status, out: (r.stdout || '') + (r.stderr || '') }
}
function shAsync(cwd: string, script: string, env: Record<string, string> = {}) {
  return new Promise<{ code: number | null; out: string }>((resolve) => {
    const p = spawn('bash', ['-c', script], { cwd, env: { ...GIT_ENV, ...env } })
    let out = ''
    p.stdout.on('data', (d) => (out += d))
    p.stderr.on('data', (d) => (out += d))
    p.on('close', (code) => resolve({ code, out }))
  })
}

let tmp: string
let repo: string
let base: string
// 기준선 명령: 불릴 때마다 카운터에 한 줄을 더하고, 빨간 기준선처럼 실패 1건을 내며 exit 1 로 끝난다
let CMD: string
const runs = () => (existsSync(join(tmp, 'counter')) ? readFileSync(join(tmp, 'counter'), 'utf8').trim().split('\n').length : 0)
const run = (cwd = repo, env: Record<string, string> = {}, cmd = CMD, extra = '--task-dir docs/tasks/TSK-01-01') =>
  sh(cwd, `bash '${BASELINE}' run --base ${base} ${extra} -- '${cmd}'`, env)
const cacheDir = () => join(repo, '.git/dflow-baseline')
const jsons = () => (existsSync(cacheDir()) ? readdirSync(cacheDir()).filter((f) => f.endsWith('.json')) : [])
const keyOf = (out: string) => out.match(/key=(\S+)/)?.[1] ?? ''

beforeEach(() => {
  tmp = realpathSync(mkdtempSync(join(tmpdir(), 'dflow-baseline-')))
  repo = join(tmp, 'repo')
  CMD = `echo run >> ${tmp}/counter; echo "Tests 10, failed 1: legacy-flaky"; exit 1`
  const r = sh(tmp, `
    git init -q -b main repo && cd repo
    mkdir -p docs/tasks/TSK-01-01 src && printf '{"phase":"ready"}\\n' > docs/tasks/TSK-01-01/state.json
    printf 'x\\n' > src/a.txt && git add . && git commit -qm init`)
  expect(r.code, r.out).toBe(0)
  base = sh(repo, 'git rev-parse HEAD').out.trim()
})

afterEach(() => { rmSync(tmp, { recursive: true, force: true }) })

describe('baseline.sh — 같은 기점·같은 명령은 한 번만 잰다', () => {
  it('처음은 재서 저장하고, 다음은 재지 않고 같은 출력·exit 를 낸다', () => {
    const r1 = run()
    expect(r1.code).toBe(1)
    expect(r1.out).toContain('Tests 10, failed 1: legacy-flaky')
    expect(r1.out).toMatch(/BASELINE_MEASURED exit=1 key=\S+ json=/)
    expect(runs()).toBe(1)
    const key = keyOf(r1.out)
    expect(key.startsWith(`${base}-`)).toBe(true)
    expect(jsons()).toEqual([`${key}.json`])
    const rec = JSON.parse(readFileSync(join(cacheDir(), `${key}.json`), 'utf8'))
    expect(rec).toMatchObject({ sha: base, exit: 1, cmd: CMD })
    const r2 = run()
    expect(r2.code).toBe(1)
    expect(r2.out).toContain('Tests 10, failed 1: legacy-flaky')
    expect(r2.out).toMatch(new RegExp(`BASELINE_REUSED exit=1 key=${key} measured_at=\\S+ json=`))
    expect(runs()).toBe(1)
    // 마지막 줄이 상태 줄이라 | tail 뒤에도 남는다
    expect(r2.out.trim().split('\n').pop()).toMatch(/^BASELINE_REUSED /)
  })

  it('note 로 더한 총수·실패 목록을 재사용하는 쪽이 BASELINE_SUMMARY 로 받는다', () => {
    const key = keyOf(run().out)
    writeFileSync(join(tmp, 'failed.txt'), 'legacy-flaky\n')
    const n = sh(repo, `bash '${BASELINE}' note ${key} --tests 10 --failures 1 --failed-file '${tmp}/failed.txt'`)
    expect(n.code, n.out).toBe(0)
    const r = run()
    expect(r.out).toContain('BASELINE_FAILED legacy-flaky')
    expect(r.out).toContain('BASELINE_SUMMARY tests=10 failures=1')
    expect(JSON.parse(readFileSync(join(cacheDir(), `${key}.json`), 'utf8'))).toMatchObject({ tests: 10, failures: 1, failed: ['legacy-flaky'] })
  })

  it('list 는 같은 기점에서 이미 잰 명령과 cwd 를 낸다(다음 팀원이 글자 그대로 쓰도록)', () => {
    expect(sh(repo, `bash '${BASELINE}' list --base ${base}`).out).toContain('BASELINE_LIST_NONE')
    const key = keyOf(run(join(repo, 'src')).out)
    const l = sh(repo, `bash '${BASELINE}' list --base ${base}`)
    expect(l.out).toContain(`BASELINE_CACHED ${key} exit=1 cwd=src/ ${CMD}`)
    // 앞뒤 공백만 다른 명령은 같은 키다
    expect(run(join(repo, 'src'), {}, `  ${CMD}  `).out).toContain(`BASELINE_REUSED exit=1 key=${key}`)
  })

  it('명령이 다르거나 리포 안 cwd 가 다르면 다른 키다', () => {
    const k1 = keyOf(run().out)
    const k2 = keyOf(run(repo, {}, `${CMD} # other`).out)
    const k3 = keyOf(run(join(repo, 'src')).out)
    expect(new Set([k1, k2, k3]).size).toBe(3)
    expect(runs()).toBe(3)
  })
})

describe('baseline.sh — 캐시를 쓰지 않는 경우(게이트는 절대 캐시를 받지 않는다)', () => {
  it('HEAD 가 기점과 다르면(기점 위에 커밋이 있으면) 캐시가 있어도 새로 잰다', () => {
    run()
    sh(repo, `printf 'y\\n' > src/b.txt && git add src/b.txt && git commit -qm feat`)
    const r = run()
    expect(r.out).toContain('BASELINE_MEASURED exit=1 cache=off(HEAD 가 기점과 다름)')
    expect(r.out).not.toContain('BASELINE_REUSED')
    expect(runs()).toBe(2)
  })

  it('기점 위에 --task-dir 아래 문서 커밋만 있으면(Design 직후) 기점 키로 캐시를 쓴다 — 게이트 범위 기준선', () => {
    const key = keyOf(run().out)
    sh(repo, `printf '# d\\n' > docs/tasks/TSK-01-01/design.md && git add docs && git commit -qm design`)
    const r = run()
    expect(r.out).toContain(`BASELINE_REUSED exit=1 key=${key}`)
    expect(runs()).toBe(1)
    // 새 명령(모듈 게이트 명령)은 그 트리에서 재되 기점 sha 로 저장한다
    const r2 = run(repo, {}, `${CMD} # module`)
    expect(keyOf(r2.out).startsWith(`${base}-`)).toBe(true)
    expect(JSON.parse(readFileSync(join(cacheDir(), `${keyOf(r2.out)}.json`), 'utf8'))).toMatchObject({ sha: base })
    // --task-dir 가 없으면 문서 커밋이어도 기점이 아니다
    expect(run(repo, {}, CMD, '').out).toContain('cache=off(HEAD 가 기점과 다름)')
  })

  it('작업 트리가 더러우면 재사용도 저장도 하지 않는다', () => {
    run()
    writeFileSync(join(repo, 'src/a.txt'), 'changed\n')
    const r1 = run()
    expect(r1.out).toContain('cache=off(작업 트리가 깨끗하지 않음)')
    sh(repo, 'git checkout -q -- src/a.txt')
    writeFileSync(join(repo, 'src/untracked.test.ts'), 'x')
    const r2 = run()
    expect(r2.out).toContain('cache=off(작업 트리가 깨끗하지 않음)')
    expect(runs()).toBe(3)
    expect(jsons().length).toBe(1)
  })

  it('--task-dir 아래의 변경(state.json·spec.md)은 더러움으로 치지 않는다', () => {
    run()
    writeFileSync(join(repo, 'docs/tasks/TSK-01-01/state.json'), '{"phase":"design","branch_base":"x"}\n')
    writeFileSync(join(repo, 'docs/tasks/TSK-01-01/spec.md'), 'spec')
    expect(run().out).toContain('BASELINE_REUSED')
    // --task-dir 없이 부르면 같은 변경도 더러움이다
    expect(run(repo, {}, CMD, '').out).toContain('cache=off(작업 트리가 깨끗하지 않음)')
    expect(runs()).toBe(2)
  })

  it('DFLOW_BASELINE_CACHE=0 이면 읽지도 쓰지도 않는다', () => {
    const r = run(repo, { DFLOW_BASELINE_CACHE: '0' })
    expect(r.out).toContain('cache=off(DFLOW_BASELINE_CACHE=0)')
    expect(jsons()).toEqual([])
    run()
    expect(run(repo, { DFLOW_BASELINE_CACHE: '0' }).out).not.toContain('BASELINE_REUSED')
    expect(runs()).toBe(3)
  })

  it('DFLOW_BASELINE_CACHE=refresh 는 새로 재서 덮어쓴다', () => {
    run()
    const r = run(repo, { DFLOW_BASELINE_CACHE: 'refresh' })
    expect(r.out).toMatch(/BASELINE_MEASURED exit=1 key=/)
    expect(runs()).toBe(2)
    expect(jsons().length).toBe(1)
    expect(readdirSync(cacheDir()).filter((f) => f.endsWith('.log')).length).toBe(1) // 옛 로그는 지운다
    expect(run().out).toContain('BASELINE_REUSED')
  })

  it('DFLOW_BASELINE_MAX_AGE 보다 오래된 결과는 쓰지 않고 새로 재서 덮어쓴다', () => {
    const key = keyOf(run().out)
    const f = join(cacheDir(), `${key}.json`)
    const rec = JSON.parse(readFileSync(f, 'utf8'))
    writeFileSync(f, JSON.stringify({ ...rec, measured_epoch: rec.measured_epoch - 100 }))
    expect(run(repo, { DFLOW_BASELINE_MAX_AGE: '50' }).out).toMatch(/BASELINE_MEASURED exit=1 key=/)
    expect(runs()).toBe(2)
    expect(run(repo, { DFLOW_BASELINE_MAX_AGE: '50' }).out).toContain('BASELINE_REUSED')
    expect(runs()).toBe(2)
  })

  it('exit 127(명령 없음)은 저장하지 않는다', () => {
    const r = run(repo, {}, 'no-such-command-xyz')
    expect(r.code).toBe(127)
    expect(r.out).toContain('BASELINE_MEASURED exit=127 cache=off(exit 127 는 저장하지 않는다)')
    expect(jsons()).toEqual([])
  })
})

describe('baseline.sh — 동시 측정', () => {
  it('둘이 동시에 같은 키를 재려 하면 한쪽만 재고 다른 쪽은 기다렸다 재사용한다', async () => {
    const slow = `echo run >> ${tmp}/counter; sleep 1; echo "Tests 10, failed 1: legacy-flaky"; exit 1`
    const cmd = `bash '${BASELINE}' run --base ${base} --task-dir docs/tasks/TSK-01-01 -- '${slow}'`
    const [a, b] = await Promise.all([shAsync(repo, cmd), shAsync(repo, cmd)])
    expect(runs()).toBe(1)
    expect([a.code, b.code]).toEqual([1, 1])
    const outs = [a.out, b.out]
    expect(outs.filter((o) => /BASELINE_MEASURED exit=1 key=/.test(o)).length).toBe(1)
    expect(outs.filter((o) => o.includes('BASELINE_REUSED exit=1')).length).toBe(1)
    expect(outs.filter((o) => o.includes('BASELINE_WAITING')).length).toBe(1)
    for (const o of outs) expect(o).toContain('Tests 10, failed 1: legacy-flaky')
    expect(existsSync(join(cacheDir(), `${keyOf(a.out)}.lock`))).toBe(false)
  }, 30_000)

  it('죽은 pid 의 잠금은 버려진 것으로 보고 가져간다', () => {
    const key = `${base}-${sh(repo, `printf '%s\\n%s' '' '${CMD}' | (sha256sum 2>/dev/null || shasum -a 256) | tr -dc '0-9a-f' | cut -c1-12`).out.trim()}`
    const lock = join(cacheDir(), `${key}.lock`)
    mkdirSync(lock, { recursive: true })
    const dead = spawnSync('bash', ['-c', 'echo $$']).stdout.toString().trim() // 이미 끝난 프로세스의 pid
    writeFileSync(join(lock, 'owner'), `${dead} ${hostname()} ${Math.floor(Date.now() / 1000)}\n`)
    const r = run()
    expect(r.out).toContain(`BASELINE_LOCK_STALE pid ${dead} 없음`)
    expect(r.out).toMatch(new RegExp(`BASELINE_MEASURED exit=1 key=${key}`))
    expect(existsSync(lock)).toBe(false)
  })

  it('기다리는 동안 측정하던 쪽이 저장하지 않고 끝나면(exit 127) 기다리던 쪽이 직접 잰다', async () => {
    // 첫째는 잠금을 잡고 1초 뒤 127 로 끝난다. 같은 명령 문자열이라 둘째는 그 잠금을 기다린다
    const flaky = `if [ ! -e ${tmp}/first ]; then touch ${tmp}/first; sleep 1; exit 127; fi; echo run >> ${tmp}/counter; exit 1`
    const cmd = `bash '${BASELINE}' run --base ${base} -- '${flaky}'`
    const a = shAsync(repo, cmd)
    await new Promise((r) => setTimeout(r, 300))
    const b = await shAsync(repo, cmd)
    const ra = await a
    expect(ra.code).toBe(127)
    expect(b.code).toBe(1)
    expect(b.out).toMatch(/BASELINE_MEASURED exit=1 key=/)
  }, 30_000)
})

describe('문서: 기준선 캐시', () => {
  it('Phase 01 4번이 baseline.sh 로 감싸 재고, 게이트·공통 프롬프트에는 -- 뒤 명령만 쓰게 한다', () => {
    const p4 = DEV.split('4. **게이트 기준선 기록**')[1]?.split('5. spec.md 읽기')[0] ?? ''
    expect(p4).toContain('.claude/skills/dflow-dev/scripts/baseline.sh run --base')
    expect(p4).toContain('`--` 뒤의 명령')
    expect(p4).toContain('"source"')
  })
  it('dev-discipline 「게이트 기준선」 이 캐시 규칙(키·끄는 법·동시 측정·재사용 기록)을 적는다', () => {
    const sec = DISCIPLINE.split('## 게이트 기준선')[1]?.split('## 화면 작업의 브라우저 E2E')[0] ?? ''
    expect(sec).toContain('baseline.sh')
    expect(sec).toContain('DFLOW_BASELINE_CACHE=0')
    expect(sec).toContain('DFLOW_BASELINE_CACHE=refresh')
    expect(sec).toContain('기점 커밋 sha')
    expect(sec).toContain('게이트')
    expect(sec).toContain('"source": "cache"')
  })
})

describe('baseline.sh — 대기 상한과 PC 전역 슬롯(2026-09-24 통합)', () => {
  it('다른 팀원의 측정이 대기 상한 안에 끝나지 않으면 재지 않고 BASELINE_BUSY·exit 75 로 끝난다', () => {
    const key = `${base}-${sh(repo, `printf '%s\\n%s' '' '${CMD}' | (sha256sum 2>/dev/null || shasum -a 256) | tr -dc '0-9a-f' | cut -c1-12`).out.trim()}`
    const lock = join(cacheDir(), `${key}.lock`)
    mkdirSync(lock, { recursive: true })
    writeFileSync(join(lock, 'owner'), `${process.pid} ${hostname()} ${Math.floor(Date.now() / 1000)}\n`)
    const r = run(repo, { DFLOW_BASELINE_WAIT: '1' })
    expect(r.code, r.out).toBe(75)
    expect(r.out).toContain('BASELINE_BUSY exit=75')
    expect(runs()).toBe(0)
    expect(jsons()).toEqual([])
  })

  it('PC 전역 무거운 명령 슬롯이 차 있으면(HEAVY_BUSY) 기준선으로 저장하지 않고 BASELINE_BUSY 로 끝난다', async () => {
    const env = { DFLOW_HEAVY_SLOTS: '1', DFLOW_HEAVY_DIR: join(tmp, 'heavy') }
    const HEAVY = join(ROOT, '.claude/skills/dflow-dev/scripts/heavy.sh')
    const holder = shAsync(repo, `bash '${HEAVY}' sleep 8`, env)
    // 쥐는 쪽이 슬롯을 실제로 잡을 때까지 기다린다(고정 대기는 부하가 높을 때 흔들린다)
    for (let i = 0; i < 100 && !(existsSync(env.DFLOW_HEAVY_DIR) && readdirSync(env.DFLOW_HEAVY_DIR).some((n) => n.startsWith('slot-'))); i++) {
      await new Promise((res) => setTimeout(res, 100))
    }
    const r = run(repo, { ...env, DFLOW_HEAVY_WAIT: '1' })
    expect(r.code, r.out).toBe(75)
    expect(r.out).toContain('BASELINE_BUSY exit=75')
    expect(runs()).toBe(0)
    expect(jsons()).toEqual([])
    await holder
    const again = run(repo, env)
    expect(again.out).toMatch(/BASELINE_MEASURED exit=1 key=/)
    expect(runs()).toBe(1)
  }, 30_000)

  // 공유 마감(2026-09-24 P1): 잠금 대기와 안쪽 heavy.sh 슬롯 대기가 한 마감을 나눠 쓴다. 전에는 잠금 WAIT 뒤에
  // heavy.sh 가 다시 DFLOW_HEAVY_WAIT(당시 기본 240초, 지금 90초)를 기다려, 이 시험은 그만큼 넘겨 시간 초과로 실패했다.
  it('잠금을 기다린 만큼 슬롯 대기가 줄어 호출 하나의 총 대기가 WAIT(+최소 5초) 안에 끝난다', async () => {
    const heavyDir = join(tmp, 'heavy')
    mkdirSync(join(heavyDir, 'slot-1'), { recursive: true })
    writeFileSync(join(heavyDir, 'slot-1', 'owner'), `pid=${process.pid}\nkind=run\nstart=${Math.floor(Date.now() / 1000)}\npstart=-\ncmd=other-testAll\n`)
    const key = `${base}-${sh(repo, `printf '%s\\n%s' '' '${CMD}' | (sha256sum 2>/dev/null || shasum -a 256) | tr -dc '0-9a-f' | cut -c1-12`).out.trim()}`
    const lock = join(cacheDir(), `${key}.lock`)
    mkdirSync(lock, { recursive: true })
    writeFileSync(join(lock, 'owner'), `${process.pid} ${hostname()} ${Math.floor(Date.now() / 1000)}\n`)
    const env = {
      ...GIT_ENV, DFLOW_HEAVY_SLOTS: '1', DFLOW_HEAVY_DIR: heavyDir, DFLOW_HEAVY_POLL: '0.2', DFLOW_HEAVY_WAIT: '',
      DFLOW_BASELINE_WAIT: '7',
    }
    const t0 = Date.now()
    const p = spawn('bash', ['-c', `bash '${BASELINE}' run --base ${base} --task-dir docs/tasks/TSK-01-01 -- '${CMD}'`],
      { cwd: repo, env, timeout: 25_000 })
    let out = ''
    p.stdout.on('data', (d) => (out += d))
    p.stderr.on('data', (d) => (out += d))
    const done = new Promise<number | null>((res) => p.on('close', (code) => res(code)))
    // 다른 팀원의 측정이 1.5초 뒤 저장 없이 끝난다(잠금만 풀린다) — 이 호출이 잠금을 얻어 슬롯을 기다린다
    for (let i = 0; i < 100 && !out.includes('BASELINE_WAITING'); i++) await new Promise((r) => setTimeout(r, 50))
    await new Promise((r) => setTimeout(r, 1500))
    rmSync(lock, { recursive: true, force: true })
    const code = await done
    const took = (Date.now() - t0) / 1000
    expect(code, out).toBe(75)
    expect(out).toContain('BASELINE_WAITING')
    expect(out).toContain('BASELINE_BUSY exit=75')
    // 안쪽 heavy.sh 가 받은 상한은 남은 시간(최소 5초)이다 — 기본값(90)이 아니다
    const hw = Number(out.match(/HEAVY_BUSY k=1 wait=(\d+)s/)?.[1])
    expect(hw).toBeGreaterThanOrEqual(5)
    expect(hw).toBeLessThanOrEqual(6)
    expect(took).toBeLessThan(10)
    expect(runs()).toBe(0)
    expect(jsons()).toEqual([])
  }, 30_000)

  it('캐시를 쓰지 않는 측정(HEAD 가 기점과 다름)도 PC 전역 슬롯을 거친다 — 차 있으면 BASELINE_BUSY', () => {
    const heavyDir = join(tmp, 'heavy')
    mkdirSync(join(heavyDir, 'slot-1'), { recursive: true })
    writeFileSync(join(heavyDir, 'slot-1', 'owner'), `pid=${process.pid}\nkind=run\nstart=${Math.floor(Date.now() / 1000)}\npstart=-\ncmd=other\n`)
    sh(repo, `printf 'y\\n' > src/b.txt && git add src/b.txt && git commit -qm feat`)
    const env = { DFLOW_HEAVY_SLOTS: '1', DFLOW_HEAVY_DIR: heavyDir, DFLOW_HEAVY_WAIT: '0' }
    const r = run(repo, env)
    expect(r.code, r.out).toBe(75)
    expect(r.out).toContain('HEAVY_BUSY')
    expect(r.out).toContain('BASELINE_BUSY exit=75')
    expect(runs()).toBe(0)
    rmSync(join(heavyDir, 'slot-1'), { recursive: true })
    const again = run(repo, env)
    expect(again.out).toContain('BASELINE_MEASURED exit=1 cache=off(HEAD 가 기점과 다름)')
    expect(again.out).toContain('HEAVY_SLOT slot-1')
    expect(runs()).toBe(1)
  })
})

describe('baseline.sh --pool docker — 도커가 허용된 워커의 기준선(2026-09-24 도커 규칙 개정)', () => {
  it('측정을 PC 전역 도커 슬롯 안에서 돌린다(캐시를 쓰든 안 쓰든)', () => {
    const env = { DFLOW_HEAVY_SLOTS: '1', DFLOW_HEAVY_DIR: join(tmp, 'heavy') }
    const cmd = `echo "held=$DFLOW_HEAVY_DOCKER_HELD" >> ${tmp}/held; echo run >> ${tmp}/counter; exit 0`
    const r = run(repo, env, cmd, '--task-dir docs/tasks/TSK-01-01 --pool docker')
    expect(r.code, r.out).toBe(0)
    expect(r.out).toMatch(/BASELINE_MEASURED exit=0 key=/)
    const r2 = run(repo, { ...env, DFLOW_BASELINE_CACHE: '0' }, cmd, '--pool docker')
    expect(r2.out).toContain('BASELINE_MEASURED exit=0 cache=off(DFLOW_BASELINE_CACHE=0)')
    const held = readFileSync(join(tmp, 'held'), 'utf8').trim().split('\n')
    expect(held).toEqual([`held=${join(tmp, 'heavy', 'docker-1')}`, `held=${join(tmp, 'heavy', 'docker-1')}`])
    expect(existsSync(join(tmp, 'heavy', 'docker-1'))).toBe(false)
  }, 30_000)
  it('도커 슬롯이 차 있으면 저장하지 않고 BASELINE_BUSY(exit 75)로 끝난다', () => {
    const env = { DFLOW_HEAVY_SLOTS: '1', DFLOW_HEAVY_DIR: join(tmp, 'heavy'), DFLOW_HEAVY_WAIT: '0' }
    mkdirSync(join(tmp, 'heavy', 'docker-1'), { recursive: true })
    writeFileSync(join(tmp, 'heavy', 'docker-1', 'owner'), `pid=${process.pid}\nkind=run\nstart=1\npstart=-\ncmd=other\n`)
    const r = run(repo, env, CMD, '--task-dir docs/tasks/TSK-01-01 --pool docker')
    expect(r.code, r.out).toBe(75)
    expect(r.out).toContain('BASELINE_BUSY exit=75')
    expect(runs()).toBe(0)
    expect(jsons()).toEqual([])
    const r2 = run(repo, { ...env, DFLOW_BASELINE_CACHE: '0' }, CMD, '--pool docker')
    expect(r2.code, r2.out).toBe(75)
    expect(r2.out).toContain('BASELINE_BUSY exit=75')
    expect(runs()).toBe(0)
  }, 30_000)
  it('모르는 풀은 사용법 오류다', () => {
    expect(run(repo, {}, CMD, '--pool bogus').code).toBe(2)
  })
})
