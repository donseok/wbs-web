// .dflow·.dflow.local 해석(docs/superpowers/specs/2026-09-23-dflow-config-design.md). 라이브러리를 실제 git 샌드박스에서 source 해 확인한다.
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const LIB = join(process.cwd(), '.claude/skills/dflow-work/scripts/dflow-config.sh')
const GIT_ENV = {
  PATH: process.env.PATH ?? '', HOME: '/nonexistent', NODE_ENV: process.env.NODE_ENV,
  GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t',
  GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1',
}
let tmp: string; let repo: string

function sh(cwd: string, script: string, env: Record<string, string> = {}) {
  const r = spawnSync('sh', ['-c', script], { cwd, encoding: 'utf8', env: { ...GIT_ENV, ...env } as NodeJS.ProcessEnv })
  return { code: r.status, out: r.stdout ?? '', err: r.stderr ?? '' }
}
// 라이브러리를 source 하고 load 한 뒤 원하는 변수를 찍는다.
function load(cwd: string, show: string, env: Record<string, string> = {}) {
  return sh(cwd, `. '${LIB}'; dflow_config_load || exit $?; ${show}`, env)
}
const DOT = 'api_base=https://p.test\nproject_id=11111111-1111-4111-8111-111111111111\nrelease_branch=main\n'
const LOCAL = 'pats=dflow_pat_AAAAAAAAAAAA_secretsecretsecret\ndev_branch=dev/me\nautomerge=1\nproject_map=docs/c10=22222222-2222-4222-8222-222222222222\n'

beforeEach(() => {
  tmp = realpathSync(mkdtempSync(join(tmpdir(), 'dflow-cfg-')))
  repo = join(tmp, 'repo')
  const r = sh(tmp, `
    git init -q --bare -b main origin.git
    git clone -q origin.git repo 2>/dev/null && cd repo && git checkout -q -b main
    printf 'x\\n' > a.txt && git add a.txt && git commit -qm init && git push -q origin main
    git remote set-head origin main`)
  expect(r.code, r.err).toBe(0)
})
afterEach(() => rmSync(tmp, { recursive: true, force: true }))

describe('dflow_config_load — 판정(스펙 §5)', () => {
  it('두 파일이 있으면 new, 공통·개인 값을 env 로 낸다', () => {
    writeFileSync(join(repo, '.dflow'), DOT); writeFileSync(join(repo, '.dflow.local'), LOCAL)
    const r = load(repo, 'echo "$DFLOW_CONFIG_MODE|$DFLOW_API_BASE|$DFLOW_DEV_BRANCH|$DFLOW_AUTOMERGE|$DFLOW_RELEASE_BRANCH"')
    expect(r.code, r.err).toBe(0)
    expect(r.out.trim()).toBe('new|https://p.test|dev/me|1|main')
  })
  it('하위 디렉터리에서 실행해도 워크트리 최상위 파일을 찾는다(cwd 를 보지 않는다)', () => {
    writeFileSync(join(repo, '.dflow'), DOT); writeFileSync(join(repo, '.dflow.local'), LOCAL)
    mkdirSync(join(repo, 'sub')); writeFileSync(join(repo, 'sub/.dflow.local'), 'dev_branch=wrong\n')
    const r = load(join(repo, 'sub'), 'echo "$DFLOW_DEV_BRANCH"')
    expect(r.out.trim()).toBe('dev/me')
  })
  it('.dflow 만 있으면 NO_LOCAL 로 exit 2', () => {
    writeFileSync(join(repo, '.dflow'), DOT)
    const r = load(repo, 'echo ok')
    expect(r.code).toBe(2); expect(r.err).toContain('NO_LOCAL')
  })
  it('.dflow.local 만 있으면 NO_DFLOW 로 exit 2', () => {
    writeFileSync(join(repo, '.dflow.local'), LOCAL)
    const r = load(repo, 'echo ok')
    expect(r.code).toBe(2); expect(r.err).toContain('NO_DFLOW')
  })
  it('새 방식인데 dev_branch 가 없으면 NO_DEV_BRANCH 로 exit 2', () => {
    writeFileSync(join(repo, '.dflow'), DOT); writeFileSync(join(repo, '.dflow.local'), 'pats=x\n')
    const r = load(repo, 'echo ok')
    expect(r.code).toBe(2); expect(r.err).toContain('NO_DEV_BRANCH')
  })
  it('둘 다 없으면 legacy: DFLOW_ENV_FILE 을 읽고 LEGACY_ENV 를 알린다', () => {
    const env = join(tmp, 'legacy.env'); writeFileSync(env, 'DFLOW_PATS=p\nDFLOW_API_BASE=https://l.test\n')
    const r = load(repo, 'echo "$DFLOW_CONFIG_MODE|$DFLOW_API_BASE"', { DFLOW_ENV_FILE: env })
    expect(r.code, r.err).toBe(0)
    expect(r.out.trim()).toBe('legacy|https://l.test'); expect(r.err).toContain('LEGACY_ENV')
  })
  it('legacy 는 PAT 가 이미 export 돼 있으면 .env 를 읽지 않는다(종전 동작)', () => {
    const env = join(tmp, 'legacy.env'); writeFileSync(env, 'DFLOW_API_BASE=https://l.test\n')
    const r = load(repo, 'echo "$DFLOW_API_BASE"', { DFLOW_ENV_FILE: env, DFLOW_PATS: 'p' })
    expect(r.out.trim()).toBe('')
  })
  it('DFLOW_CONFIG_DIR 가 있으면 그 디렉터리에서만 찾는다', () => {
    writeFileSync(join(repo, '.dflow'), DOT); writeFileSync(join(repo, '.dflow.local'), LOCAL)
    const cfg = join(tmp, 'cfg'); mkdirSync(cfg)
    const r = load(repo, 'echo "$DFLOW_CONFIG_MODE"', { DFLOW_CONFIG_DIR: cfg, DFLOW_ENV_FILE: join(tmp, 'none') })
    expect(r.out.trim()).toBe('legacy')
  })
})

describe('dflow_config_load — 우선순위·키 범위(스펙 §3·§4)', () => {
  beforeEach(() => { writeFileSync(join(repo, '.dflow'), DOT); writeFileSync(join(repo, '.dflow.local'), LOCAL) })
  it('export 된 env 가 파일을 이긴다 — PAT 가 export 돼 있어도 dev_branch 는 파일에서 읽는다', () => {
    const r = load(repo, 'echo "$DFLOW_API_BASE|$DFLOW_PATS|$DFLOW_DEV_BRANCH"', { DFLOW_API_BASE: 'https://s.test', DFLOW_PATS: 'envpat' })
    expect(r.out.trim()).toBe('https://s.test|envpat|dev/me')
  })
  it('.dflow 에 개인 키가 있으면 PERSONAL_KEY_IN_DFLOW 로 exit 2, 값은 출력하지 않는다', () => {
    writeFileSync(join(repo, '.dflow'), DOT + 'pats=dflow_pat_ZZZZZZZZZZZZ_leakleakleakleak\n')
    const r = load(repo, 'echo ok')
    expect(r.code).toBe(2); expect(r.err).toContain('PERSONAL_KEY_IN_DFLOW pats')
    expect(r.err + r.out).not.toContain('leakleak')
  })
  it('.dflow.local 의 공통 키는 경고하고 무시한다', () => {
    writeFileSync(join(repo, '.dflow.local'), LOCAL + 'api_base=https://other.test\n')
    const r = load(repo, 'echo "$DFLOW_API_BASE"')
    expect(r.code).toBe(0); expect(r.out.trim()).toBe('https://p.test')
    expect(r.err).toContain('COMMON_KEY_IN_LOCAL api_base')
  })
  it('모르는 키는 경고하고 계속한다', () => {
    writeFileSync(join(repo, '.dflow'), DOT + 'colour=red\n')
    const r = load(repo, 'echo ok')
    expect(r.code).toBe(0); expect(r.err).toContain('UNKNOWN_KEY')
  })
  it('값을 실행하지 않고, =·주석·CR·공백을 규칙대로 다룬다', () => {
    writeFileSync(join(repo, '.dflow.local'),
      `# 주석\r\n  dev_branch = $(touch ${join(tmp, 'pwned')}) \r\nautomerge=a=b=c   # 꼬리 주석\r\n`)
    const r = load(repo, 'printf "%s|%s" "$DFLOW_DEV_BRANCH" "$DFLOW_AUTOMERGE"')
    expect(existsSync(join(tmp, 'pwned'))).toBe(false)
    expect(r.out).toBe(`$(touch ${join(tmp, 'pwned')})|a=b=c`)
  })
})

describe('.dflow 위치 폴백과 브랜치(스펙 §5-2·§6)', () => {
  it('워크트리에 .dflow 가 없으면 origin/<dev_branch>:.dflow 를 읽는다', () => {
    const r0 = sh(repo, `git switch -q -c dev/me && printf '${DOT.replace(/\n/g, '\\n')}' > .dflow && git add .dflow && git commit -qm dflow && git push -q origin dev/me && git switch -q main`)
    expect(r0.code, r0.err).toBe(0)
    writeFileSync(join(repo, '.dflow.local'), LOCAL)
    const r = load(repo, 'echo "$DFLOW_CONFIG_DOT|$DFLOW_API_BASE"')
    expect(r.code, r.err).toBe(0); expect(r.out.trim()).toBe('origin/dev/me:.dflow|https://p.test')
  })
  it('그다음 origin/HEAD:.dflow 를 읽는다', () => {
    const r0 = sh(repo, `printf '${DOT.replace(/\n/g, '\\n')}' > .dflow && git add .dflow && git commit -qm dflow && git push -q origin main && git rm -q .dflow && git commit -qm rm`)
    expect(r0.code, r0.err).toBe(0)
    writeFileSync(join(repo, '.dflow.local'), LOCAL)
    const r = load(repo, 'echo "$DFLOW_CONFIG_DOT"')
    expect(r.out.trim()).toBe('origin/HEAD:.dflow')
  })
  it('branch dev 는 dev_branch, release 는 release_branch. legacy 는 origin/HEAD', () => {
    writeFileSync(join(repo, '.dflow'), DOT); writeFileSync(join(repo, '.dflow.local'), LOCAL)
    expect(load(repo, 'dflow_config_branch dev; dflow_config_branch release').out).toBe('dev/me\nmain\n')
    rmSync(join(repo, '.dflow')); rmSync(join(repo, '.dflow.local'))
    expect(load(repo, 'dflow_config_branch dev', { DFLOW_ENV_FILE: join(tmp, 'none') }).out).toBe('main\n')
  })
  it('release_branch 를 생략하면 origin/HEAD', () => {
    writeFileSync(join(repo, '.dflow'), 'api_base=https://p.test\n'); writeFileSync(join(repo, '.dflow.local'), LOCAL)
    expect(load(repo, 'dflow_config_branch release').out).toBe('main\n')
  })
  it('projects 는 project_id 와 project_map 값의 합집합', () => {
    writeFileSync(join(repo, '.dflow'), DOT); writeFileSync(join(repo, '.dflow.local'), LOCAL)
    expect(load(repo, 'dflow_config_projects').out).toBe(
      '11111111-1111-4111-8111-111111111111\n22222222-2222-4222-8222-222222222222\n')
  })
})

const DFLOW = join(process.cwd(), '.claude/skills/dflow-work/scripts/dflow.sh')
describe('dflow.sh config·branch(스펙 §6)', () => {
  beforeEach(() => { writeFileSync(join(repo, '.dflow'), DOT); writeFileSync(join(repo, '.dflow.local'), LOCAL) })
  const run = (args: string, env: Record<string, string> = {}) => sh(repo, `sh '${DFLOW}' ${args}`, env)
  it('config <key> 는 값을, branch 는 브랜치를 낸다 — 토큰·네트워크 없이', () => {
    expect(run('config api_base').out).toBe('https://p.test\n')
    expect(run('config automerge').out).toBe('1\n')
    expect(run('branch dev').out).toBe('dev/me\n')
    expect(run('branch release').out).toBe('main\n')
  })
  it('config projects 는 바인딩 합집합', () => {
    expect(run('config projects').out.trim().split('\n')).toHaveLength(2)
  })
  it('config --source 는 판정을 낸다', () => {
    expect(run('config --source').out).toContain('mode=new')
  })
  it('config pats 는 거부하고 값을 내지 않는다', () => {
    const r = run('config pats')
    expect(r.code).toBe(2); expect(r.out + r.err).not.toContain('secretsecret')
  })
  it('설정 오류는 exit 2 로 전파된다', () => {
    rmSync(join(repo, '.dflow.local'))
    const r = run('config api_base')
    expect(r.code).toBe(2); expect(r.err).toContain('NO_LOCAL')
  })
})
