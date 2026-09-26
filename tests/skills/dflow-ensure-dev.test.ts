// 개발 브랜치가 원격에 없으면 운영 브랜치에서 만든다(2026-09-23 사용자 결정: "작업할때 없으면 만들어야지").
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { devAll } from './_dflow-dev'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const DFLOW = join(process.cwd(), '.claude/skills/dflow-work/scripts/dflow.sh')
let tmp: string; let repo: string; let bare: string

const git = (cwd: string, ...a: string[]) => execFileSync('git', a, { cwd, encoding: 'utf8' }).trim()
function run(env: Record<string, string> = {}) {
  const r = spawnSync('sh', [DFLOW, 'branch', 'ensure-dev'], {
    encoding: 'utf8', cwd: repo,
    env: {
      NODE_ENV: process.env.NODE_ENV, PATH: process.env.PATH ?? '', HOME: join(tmp, 'home'),
      DFLOW_ENV_FILE: join(tmp, 'no-env'), DFLOW_CONFIG_DIR: join(tmp, 'no-config'),
      DFLOW_DEV_BRANCH: 'dev', DFLOW_RELEASE_BRANCH: 'main',
      GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t',
      ...env,
    } as NodeJS.ProcessEnv,
  })
  return { code: r.status, out: r.stdout ?? '', err: r.stderr ?? '' }
}

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'dflow-ens-'))
  mkdirSync(join(tmp, 'home'))
  repo = join(tmp, 'repo'); mkdirSync(repo); bare = join(tmp, 'origin.git')
  git(repo, 'init', '-q', '-b', 'main'); git(repo, 'config', 'user.email', 't@t'); git(repo, 'config', 'user.name', 't')
  writeFileSync(join(repo, 'f.txt'), 'x'); git(repo, 'add', 'f.txt'); git(repo, 'commit', '-q', '-m', 'init')
  execFileSync('git', ['init', '-q', '--bare', bare])
  git(repo, 'remote', 'add', 'origin', bare); git(repo, 'push', '-q', '-u', 'origin', 'main')
})
afterEach(() => rmSync(tmp, { recursive: true, force: true }))

describe('dflow.sh branch ensure-dev', () => {
  it('원격에 개발 브랜치가 없으면 운영 브랜치에서 만들어 push 하고 이름을 낸다', () => {
    const r = run()
    expect(r.code, r.err).toBe(0)
    expect(r.out).toBe('dev\n')
    expect(r.err).toContain('개발 브랜치 dev 를 origin/main 에서 만들었다')
    expect(git(bare, 'rev-parse', 'dev')).toBe(git(bare, 'rev-parse', 'main'))
    expect(git(repo, 'rev-parse', 'origin/dev')).toBe(git(bare, 'rev-parse', 'main'))
  })
  it('이미 있으면 아무것도 바꾸지 않고 이름만 낸다', () => {
    writeFileSync(join(repo, 'g.txt'), 'y'); git(repo, 'add', 'g.txt'); git(repo, 'commit', '-q', '-m', 'dev only')
    git(repo, 'push', '-q', 'origin', 'HEAD:dev')
    const before = git(bare, 'rev-parse', 'dev')
    const r = run()
    expect(r.code, r.err).toBe(0); expect(r.out).toBe('dev\n'); expect(r.err).toBe('')
    expect(git(bare, 'rev-parse', 'dev')).toBe(before)
  })
  it('운영 브랜치도 원격에 없으면 exit 2 NO_RELEASE_BRANCH, 아무것도 만들지 않는다', () => {
    const r = run({ DFLOW_RELEASE_BRANCH: 'prod' })
    expect(r.code).toBe(2); expect(r.err).toContain('NO_RELEASE_BRANCH')
    expect(spawnSync('git', ['rev-parse', '-q', '--verify', 'refs/heads/dev'], { cwd: bare }).status).not.toBe(0)
  })
  it('push 가 실패하면 exit 6', () => {
    expect(run().code).toBe(0)   // 한 번 만든 뒤 원격에서 지우고 push 경로만 끊는다
    git(repo, 'push', '-q', 'origin', '--delete', 'dev')
    git(repo, 'remote', 'set-url', '--push', 'origin', join(tmp, 'gone.git'))
    const r2 = run()
    expect(r2.code).toBe(6); expect(r2.err).toContain('개발 브랜치 생성 push 실패')
  })
})

describe('문서', () => {
  const read = (p: string) => readFileSync(join(process.cwd(), '.claude/skills', p), 'utf8')
  it('팀장 전제 검사는 개발 브랜치가 없으면 만들고, 그래도 없을 때만 멈춘다', () => {
    expect(read('dflow-team/SKILL.md')).toContain('dflow.sh branch ensure-dev >/dev/null || bad "NO_REMOTE_DEV_BRANCH $base"')
  })
  it('dflow-dev Phase 01 은 시작 때 ensure-dev 를 부른다', () => {
    expect(devAll()).toContain('dflow.sh branch ensure-dev')
  })
})
