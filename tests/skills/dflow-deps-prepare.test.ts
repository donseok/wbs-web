// tests/skills/dflow-deps-prepare.test.ts
// deps.sh 의 준비 빌드(prepare) — 설치 직후 리포 루트 `.dflow-gates` 의 `prepare<TAB><명령>` 을 워크트리마다 한 번 돌린다
// (dmes-standard 성능 감사 P9). 실제 git 샌드박스(메인 체크아웃 + 링크드 워크트리)에서 돌린다. 설치 테스트의 본체는
// dflow-lead-worktree.test.ts 「팀원 의존성」 이고, 이 파일은 같은 방식(임시 heavy 슬롯 폴더)을 따른다.
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { spawnSync } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const ROOT = process.cwd()
const DEPS = join(ROOT, '.claude/skills/dflow-dev/scripts/deps.sh')

const GIT_ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t',
  GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1',
}

let tmp: string, primary: string, locks: string

function sh(cwd: string, script: string, env: Record<string, string> = {}) {
  // 설치·준비 명령은 heavy.sh 로 감싸진다 — 이 PC 의 실제 슬롯을 쓰거나 기다리지 않게 임시 폴더로 돌린다
  const heavy = {
    DFLOW_HEAVY_DIR: locks, DFLOW_HEAVY_SLOTS: '1', DFLOW_HEAVY_OWNER: '', DFLOW_HEAVY_HELD: '', DFLOW_HEAVY_DOCKER_HELD: '',
    DFLOW_HEAVY_LOAD_MAX: '0', DFLOW_HEAVY_POLL: '0.2',
  }
  const r = spawnSync('bash', ['-c', script], { cwd, encoding: 'utf8', env: { ...GIT_ENV, ...heavy, ...env }, timeout: 60000 })
  return { code: r.status, out: (r.stdout || '') + (r.stderr || '') }
}
const deps = (cwd: string, env: Record<string, string> = {}) => sh(cwd, `bash '${DEPS}'`, env)
const worker = (name: string) => {
  const w = join(primary, '.claude/worktrees', name)
  const r = sh(primary, `mkdir -p .claude/worktrees && git worktree add -q --detach "${w}" main`)
  expect(r.code, r.out).toBe(0)
  return w
}
const gates = (w: string, body: string) => writeFileSync(join(w, '.dflow-gates'), body)
const runs = (name = 'prep.log') => (existsSync(join(tmp, name)) ? readFileSync(join(tmp, name), 'utf8').trim().split('\n').filter(Boolean) : [])
const gitDir = (w: string) => sh(w, 'git rev-parse --absolute-git-dir').out.trim()

beforeEach(() => {
  tmp = realpathSync(mkdtempSync(join(tmpdir(), 'dflow-deps-prep-')))
  primary = join(tmp, 'repo')
  locks = join(tmp, 'heavy-locks')
  mkdirSync(primary)
  const r = sh(primary, `
    git init -q -b main
    printf 'x\\n' > a.txt && printf '.claude/worktrees/\\n' > .gitignore
    git add a.txt .gitignore && git commit -qm init`)
  expect(r.code, r.out).toBe(0)
})
afterEach(() => { rmSync(tmp, { recursive: true, force: true }) })

describe('deps.sh 준비 빌드(prepare)', { timeout: 60000 }, () => {
  it('prepare 줄의 명령을 리포 루트에서 heavy.sh 로 감싸 한 번 돌리고, 다시 부르면 건너뛴다', () => {
    const w = worker('dflow-11111111')
    mkdirSync(join(w, 'sub'))
    gates(w, `# 게이트 명령\n\nfull\tpnpm test\nprepare\techo "$(pwd) held=$DFLOW_HEAVY_HELD" >> '${tmp}/prep.log'\nprepare\techo second >> '${tmp}/prep.log'\n`)
    const r1 = deps(join(w, 'sub'))
    expect(r1.code, r1.out).toBe(0)
    expect(r1.out).toContain('DEPS_PREPARE echo')
    expect(r1.out).toContain('HEAVY_SLOT slot-1')
    expect(r1.out).toContain('DEPS_PREPARED echo')
    // 첫 prepare 줄만, 리포 루트에서, 슬롯을 쥐고 돈다
    expect(runs()).toEqual([`${w} held=${join(locks, 'slot-1')}`])
    const r2 = deps(w)
    expect(r2.code, r2.out).toBe(0)
    expect(r2.out).toContain('DEPS_PREPARE_SKIP 이미 돌렸다')
    expect(runs()).toHaveLength(1)
    // 표식은 워크트리의 git 디렉터리(작업 트리 밖)에 있다
    expect(existsSync(join(gitDir(w), 'dflow-prepare.done'))).toBe(true)
    expect(sh(w, 'git status --porcelain --ignored').out).not.toContain('dflow-prepare')
  })

  it('표식은 워크트리마다 따로다 — 두 번째 워크트리도 자기 준비를 돌린다', () => {
    const w1 = worker('dflow-11111111')
    const w2 = worker('dflow-22222222')
    for (const w of [w1, w2]) gates(w, `prepare\tpwd >> '${tmp}/prep.log'\n`)
    expect(deps(w1).code).toBe(0)
    expect(deps(w2).code).toBe(0)
    expect(runs()).toEqual([w1, w2])
  })

  it('명령이 바뀌면 다시 돈다', () => {
    const w = worker('dflow-11111111')
    gates(w, `prepare\techo a >> '${tmp}/prep.log'\n`)
    deps(w)
    gates(w, `prepare\techo b >> '${tmp}/prep.log'\n`)
    const r = deps(w)
    expect(r.out).toContain('DEPS_PREPARED')
    expect(runs()).toEqual(['a', 'b'])
  })

  it('.dflow-gates 가 없거나 prepare 줄이 없으면 아무것도 하지 않는다(주석·다른 키·CRLF)', () => {
    const w = worker('dflow-11111111')
    const r0 = deps(w)
    expect(r0.code, r0.out).toBe(0)
    expect(r0.out).not.toContain('DEPS_PREPARE')
    gates(w, `# prepare\techo no >> '${tmp}/prep.log'\nfull\techo no >> '${tmp}/prep.log'\nprepared\techo no >> '${tmp}/prep.log'\nprepare\t   \n`)
    const r1 = deps(w)
    expect(r1.code, r1.out).toBe(0)
    expect(r1.out).not.toContain('DEPS_PREPARE')
    expect(runs()).toEqual([])
    // Windows 줄끝(CRLF)도 읽는다
    gates(w, `full\tx\r\nprepare\techo crlf >> '${tmp}/prep.log'\r\n`)
    expect(deps(w).out).toContain('DEPS_PREPARED')
    expect(runs()).toEqual(['crlf'])
  })

  it('실패하면 DEPS_PREPARE_FAIL 경고만 내고 exit 0, 표식을 남기지 않아 다음 호출이 다시 시도한다', () => {
    const w = worker('dflow-11111111')
    gates(w, `prepare\techo try >> '${tmp}/prep.log'; exit 3\n`)
    const r = deps(w)
    expect(r.code, r.out).toBe(0)
    expect(r.out).toMatch(/^DEPS_PREPARE_FAIL exit 3 echo try/m)
    expect(existsSync(join(gitDir(w), 'dflow-prepare.done'))).toBe(false)
    expect(deps(w).out).toContain('DEPS_PREPARE_FAIL exit 3')
    expect(runs()).toEqual(['try', 'try'])
  })

  it('슬롯이 차 있으면 DEPS_BUSY prepare·exit 75, 슬롯이 비면 다시 불러 준비만 이어서 돈다', () => {
    const w = worker('dflow-11111111')
    gates(w, `prepare\techo ran >> '${tmp}/prep.log'\n`)
    mkdirSync(join(locks, 'slot-1'), { recursive: true })
    writeFileSync(join(locks, 'slot-1', 'owner'), `pid=${process.pid}\nkind=run\nstart=${Math.floor(Date.now() / 1000)}\npstart=-\ncmd=./gradlew testAll\n`)
    const r = deps(w, { DFLOW_HEAVY_WAIT: '0' })
    expect(r.code, r.out).toBe(75)
    expect(r.out).toContain('HEAVY_BUSY')
    expect(r.out.trim().split('\n').pop()).toBe('DEPS_BUSY prepare')
    expect(runs()).toEqual([])
    rmSync(join(locks, 'slot-1'), { recursive: true })
    const again = deps(w, { DFLOW_HEAVY_WAIT: '0' })
    expect(again.code, again.out).toBe(0)
    expect(again.out).toContain('DEPS_PREPARED')
    expect(runs()).toEqual(['ran'])
  })

  it('이번 호출에서 실제로 설치했으면 준비를 미루고 DEPS_PREPARE_PENDING·exit 75 로 끝난다 — 다시 부르면 설치는 DEPS_SKIP 으로 넘기고 준비만 돈다', () => {
    const w = worker('dflow-44444444')
    const bin = join(tmp, 'bin-install-pending')
    mkdirSync(bin)
    writeFileSync(join(bin, 'npm'), '#!/bin/sh\nmkdir -p node_modules\nexit 0\n')
    chmodSync(join(bin, 'npm'), 0o755)
    writeFileSync(join(w, 'package.json'), '{}\n')
    writeFileSync(join(w, 'package-lock.json'), '{"lockfileVersion":3}\n')
    gates(w, `prepare\techo built >> '${tmp}/prep.log'\n`)
    const env = { PATH: `${bin}:${process.env.PATH}` }
    const r1 = deps(w, env)
    expect(r1.code, r1.out).toBe(75)
    expect(r1.out).toContain('DEPS_INSTALLED npm ci')
    expect(r1.out).toContain('DEPS_PREPARE_PENDING')
    expect(r1.out).not.toMatch(/^DEPS_PREPARE /m)
    expect(runs()).toEqual([]) // 준비 명령은 이번 호출에서 돌지 않았다
    const r2 = deps(w, env)
    expect(r2.code, r2.out).toBe(0)
    expect(r2.out).toContain('DEPS_SKIP node_modules 있음')
    expect(r2.out).toContain('DEPS_PREPARED echo built')
    expect(runs()).toEqual(['built'])
  })

  it('설치가 필요 없던 호출(이미 설치됨, DEPS_SKIP)은 그 호출 안에서 바로 준비를 돈다', () => {
    const w = worker('dflow-55555555')
    writeFileSync(join(w, 'package.json'), '{}\n')
    writeFileSync(join(w, 'package-lock.json'), '{"lockfileVersion":3}\n')
    mkdirSync(join(w, 'node_modules'))
    gates(w, `prepare\techo skip-case >> '${tmp}/prep.log'\n`)
    const r = deps(w)
    expect(r.code, r.out).toBe(0)
    expect(r.out).toContain('DEPS_SKIP node_modules 있음')
    expect(r.out).toContain('DEPS_PREPARE echo skip-case')
    expect(r.out).toContain('DEPS_PREPARED echo skip-case')
    expect(runs()).toEqual(['skip-case'])
  })

  it('설치가 실패하면 준비를 돌리지 않는다(exit 는 설치 명령의 것)', () => {
    const w = worker('dflow-11111111')
    const bin = join(tmp, 'bin')
    mkdirSync(bin)
    writeFileSync(join(bin, 'npm'), '#!/bin/sh\nexit 9\n')
    chmodSync(join(bin, 'npm'), 0o755)
    writeFileSync(join(w, 'package.json'), '{}\n')
    writeFileSync(join(w, 'package-lock.json'), '{"lockfileVersion":3}\n')
    gates(w, `prepare\techo ran >> '${tmp}/prep.log'\n`)
    const r = deps(w, { PATH: `${bin}:${process.env.PATH}` })
    expect(r.code).toBe(9)
    expect(r.out).toContain('DEPS_FAILED npm ci exit 9')
    expect(r.out).not.toContain('DEPS_PREPARE')
    expect(runs()).toEqual([])
  })

  it('문서: worker-mode.md 행 H 가 준비 빌드와 Bash timeout 을 적는다', () => {
    const worker = readFileSync(join(ROOT, '.claude/skills/dflow-dev/references/worker-mode.md'), 'utf8').replace(/\s*\n\s*/g, ' ')
    expect(worker).toContain('`.dflow-gates` 의 `prepare<TAB><명령>`')
    expect(worker).toContain('`DEPS_PREPARE_FAIL`')
    expect(worker).toContain('Bash 도구의 timeout 을 300000~600000 으로 준다')
  })
})
