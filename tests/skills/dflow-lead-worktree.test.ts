// tests/skills/dflow-lead-worktree.test.ts
// 링크드 워크트리 팀장(같은 리포에서 다른 신원의 두 번째 /dflow-team)과 팀원 의존성 캐시.
// 문서 계약만이 아니라 실제 git 샌드박스(가짜 origin)에서 명령을 돌려 동작을 확인한다.
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { spawnSync } from 'node:child_process'
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const ROOT = process.cwd()
const TEAM = readFileSync(join(ROOT, '.claude/skills/dflow-team/SKILL.md'), 'utf8')
const MERGE = readFileSync(join(ROOT, '.claude/skills/dflow-merge/SKILL.md'), 'utf8')
const DEV = readFileSync(join(ROOT, '.claude/skills/dflow-dev/SKILL.md'), 'utf8')
const LEAD_WT = join(ROOT, '.claude/skills/dflow-team/scripts/lead-worktree.sh')
const DEPS = join(ROOT, '.claude/skills/dflow-dev/scripts/deps.sh')

const GIT_ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t',
  GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1',
}

function sh(cwd: string, script: string, env: Record<string, string> = {}) {
  const r = spawnSync('bash', ['-c', script], { cwd, encoding: 'utf8', env: { ...GIT_ENV, ...env } })
  return { code: r.status, out: (r.stdout || '') + (r.stderr || '') }
}

let tmp: string
let origin: string
let primary: string

beforeEach(() => {
  tmp = realpathSync(mkdtempSync(join(tmpdir(), 'dflow-leadwt-')))
  origin = join(tmp, 'origin.git')
  primary = join(tmp, 'repo')
  const r = sh(tmp, `
    git init -q --bare -b main origin.git
    git clone -q origin.git repo 2>/dev/null
    cd repo && git checkout -q -b main
    mkdir -p docs/tasks/TSK-01-01 && printf '{"phase":"reported"}\\n' > docs/tasks/TSK-01-01/state.json
    printf 'x\\n' > a.txt && printf '.env\\n' > .gitignore
    git add a.txt .gitignore docs && git commit -qm init && git push -q origin main
    git remote set-head origin main
    git switch -q -c agent/aaaaaaaa-x && printf 'y\\n' > b.txt && git add b.txt && git commit -qm feat && git push -q origin agent/aaaaaaaa-x
    git switch -q main
  `)
  expect(r.code, r.out).toBe(0)
})

afterEach(() => { rmSync(tmp, { recursive: true, force: true }) })

describe('두 번째 팀장은 링크드 워크트리에서 돈다', () => {
  it('전제 검사는 기본 브랜치나 detached HEAD 를 받고, 같은 신원의 다른 워크트리 팀장을 거부한다', () => {
    expect(TEAM).toContain('bad "NOT_DEFAULT_BRANCH $base 또는 detached HEAD 여야 한다"')
    expect(TEAM).toContain('bad "SAME_IDENTITY_LEAD $dup"')
    expect(TEAM).toContain('## 두 번째 팀장 (링크드 워크트리)')
    // stale() 는 SAME_IDENTITY_LEAD 검사보다 앞에서 정의된다
    expect(TEAM.indexOf('stale() {')).toBeLessThan(TEAM.indexOf('SAME_IDENTITY_LEAD $dup'))
  })

  it('lead-worktree.sh 는 detached 워크트리·스킬 링크·.env 복사본을 만들고, 주 체크아웃은 그대로 둔다', () => {
    mkdirSync(join(primary, '.claude/skills/dflow-team'), { recursive: true })
    writeFileSync(join(primary, '.claude/skills/dflow-team/SKILL.md'), 'x')
    writeFileSync(join(primary, '.env'), 'DFLOW_PATS=secret\n')
    chmodSync(join(primary, '.env'), 0o600)
    const r = sh(primary, `bash '${LEAD_WT}' k2`)
    expect(r.code, r.out).toBe(0)
    expect(r.out).not.toContain('secret')
    const lw = join(primary, '.claude/worktrees/lead-k2')
    expect(sh(lw, 'git branch --show-current').out.trim()).toBe('')
    expect(lstatSync(join(lw, '.claude/skills')).isSymbolicLink()).toBe(true)
    expect(lstatSync(join(lw, '.env')).isSymbolicLink()).toBe(false)
    expect(readFileSync(join(lw, '.env'), 'utf8')).toBe('DFLOW_PATS=secret\n')
    expect(statSync(join(lw, '.env')).mode & 0o777).toBe(0o600)
    expect(sh(primary, 'git branch --show-current').out.trim()).toBe('main')
    expect(sh(primary, 'git status --porcelain').out.trim()).toBe('')
    // 두 번 돌려도 깨지지 않고 .env 를 덮어쓰지 않는다
    writeFileSync(join(lw, '.env'), 'DFLOW_AS=other\n')
    const r2 = sh(primary, `bash '${LEAD_WT}' k2`)
    expect(r2.code, r2.out).toBe(0)
    expect(readFileSync(join(lw, '.env'), 'utf8')).toBe('DFLOW_AS=other\n')
  })

  it('lead-worktree.sh 는 복사본에서 DFLOW_AS 줄만 빼고 나머지는 그대로 둔다', () => {
    writeFileSync(join(primary, '.env'), 'DFLOW_API_BASE=https://x\nDFLOW_AS=AAAAAAAAAAAA\nDFLOW_PATS=secret\n  export DFLOW_AS=BBBBBBBBBBBB\nDFLOW_ASK=keep\n')
    chmodSync(join(primary, '.env'), 0o644)
    const r = sh(primary, `bash '${LEAD_WT}' k2`)
    expect(r.code, r.out).toBe(0)
    expect(r.out).not.toContain('secret')
    expect(r.out).not.toContain('AAAAAAAAAAAA')
    expect(r.out).toContain('ENV_COPIED')
    expect(r.out).toContain('DFLOW_AS 는 뺐다')
    const lw = join(primary, '.claude/worktrees/lead-k2')
    expect(readFileSync(join(lw, '.env'), 'utf8')).toBe('DFLOW_API_BASE=https://x\nDFLOW_PATS=secret\nDFLOW_ASK=keep\n')
    expect(statSync(join(lw, '.env')).mode & 0o777).toBe(0o600)
    // 주 체크아웃의 .env 는 건드리지 않는다
    expect(readFileSync(join(primary, '.env'), 'utf8')).toContain('DFLOW_AS=AAAAAAAAAAAA')
  })

  it('lead-worktree.sh 는 .env 가 DFLOW_AS 줄뿐이어도 죽지 않는다', () => {
    writeFileSync(join(primary, '.env'), 'DFLOW_AS=AAAAAAAAAAAA\n')
    const r = sh(primary, `bash '${LEAD_WT}' k2`)
    expect(r.code, r.out).toBe(0)
    expect(readFileSync(join(primary, '.claude/worktrees/lead-k2/.env'), 'utf8')).toBe('')
  })

  it('lead-worktree.sh 는 링크드 워크트리에서 부르면 거부한다', () => {
    sh(primary, `bash '${LEAD_WT}' k2`)
    const r = sh(join(primary, '.claude/worktrees/lead-k2'), `bash '${LEAD_WT}' k3`)
    expect(r.code).toBe(2)
    expect(r.out).toContain('NOT_PRIMARY')
  })

  it('잠금·종료 파일·poll 디렉터리는 워크트리마다 따로 풀린다', () => {
    sh(primary, `bash '${LEAD_WT}' k2`)
    const lw = join(primary, '.claude/worktrees/lead-k2')
    const paths = (cwd: string) => sh(cwd, 'git rev-parse --path-format=absolute --git-path dflow-team.lock --git-path dflow-team.stop --git-path dflow-team-poll').out.trim().split('\n')
    const a = paths(primary)
    const b = paths(lw)
    for (let i = 0; i < 3; i++) expect(a[i]).not.toBe(b[i])
  })

  it('SAME_IDENTITY_LEAD: 다른 워크트리에 살아 있는 같은 신원의 잠금만 잡는다', () => {
    sh(primary, `bash '${LEAD_WT}' k2`)
    const lw = join(primary, '.claude/worktrees/lead-k2')
    const start = TEAM.indexOf('   stale() {')
    const end = TEAM.indexOf('   [ -z "$dup" ] || bad "SAME_IDENTITY_LEAD $dup"')
    const block = TEAM.slice(start, end).split('\n').map((l) => l.replace(/^ {3}/, '')).join('\n')
    const run = () => sh(lw, `MAIN=$(git rev-parse --show-toplevel); who=alice; host=pc\n${block}\necho "DUP=[$dup]"`)
    const lock = sh(primary, 'git rev-parse --path-format=absolute --git-path dflow-team.lock').out.trim()
    expect(run().out).toContain('DUP=[]')
    mkdirSync(lock)
    const now = Math.floor(Date.now() / 1000)
    writeFileSync(join(lock, 'owner'), `alice/pc/lead ${now} 1\n`)
    writeFileSync(join(lock, 'beat'), `${now}\n`)
    expect(run().out).toContain(`DUP=[${primary} ]`)
    writeFileSync(join(lock, 'owner'), `bob/pc/lead ${now} 1\n`)
    expect(run().out).toContain('DUP=[]')
    writeFileSync(join(lock, 'owner'), `alice/pc/lead ${now} 1\n`)
    writeFileSync(join(lock, 'beat'), `${now - 5000}\n`)
    expect(run().out).toContain('DUP=[]')
  })
})

describe('기본 브랜치에 있지 않은 체크아웃은 임시 머지 워크트리에서 머지한다', () => {
  it('문서: 머지 자리 선택, HEAD:<기본브랜치> push, reset --hard, 스윕 뒤 팀장 체크아웃 갱신', () => {
    expect(MERGE).toContain('**임시 머지 워크트리**')
    expect(MERGE).toContain('git -C "$W" push origin HEAD:<기본브랜치>')
    expect(MERGE).toContain('git -C "$W" reset --hard <기록한 HEAD>')
    expect(MERGE).toContain('git worktree remove --force "$W"')
    expect(TEAM).toContain('git switch -q --detach origin/<기본브랜치>')
  })

  it('main 을 주 체크아웃이 잡고 있어도, detached 팀장 워크트리에서 문서의 명령으로 머지·push 된다', () => {
    sh(primary, `bash '${LEAD_WT}' k2`)
    const lw = join(primary, '.claude/worktrees/lead-k2')
    // 이 상황이 문제의 출발점이다: 링크드 워크트리는 main 으로 switch 하지 못한다
    const sw = sh(lw, 'git switch main')
    expect(sw.code).not.toBe(0)
    expect(sw.out).toMatch(/already used by worktree|already checked out/)
    // 문서의 임시 머지 워크트리 블록(플레이스홀더만 치환)
    const m = MERGE.match(/ {3}```bash\n( {3}W="<ROOT>\/\.claude\/worktrees\/dflow-merge"[\s\S]*?) {3}```/)
    expect(m).not.toBeNull()
    const setup = m![1].split('\n').map((l) => l.replace(/^ {3}/, '')).join('\n')
      .replaceAll('<ROOT>', lw).replaceAll('<기본브랜치>', 'main')
    const r = sh(lw, `${setup}
      git -C "$W" fetch -q origin && git -C "$W" switch -q --detach origin/main
      pre=$(git -C "$W" rev-parse HEAD)
      git -C "$W" merge -q --no-ff agent/aaaaaaaa-x -m "merge: TSK-01-01 x (approved)" 2>/dev/null || git -C "$W" merge -q --no-ff origin/agent/aaaaaaaa-x -m "merge: TSK-01-01 x (approved)"
      printf '{"phase":"merged"}\\n' > "$W/docs/tasks/TSK-01-01/state.json"
      git -C "$W" add docs/tasks/TSK-01-01/state.json && git -C "$W" commit -qm "chore(TSK-01-01): phase=merged"
      git -C "$W" push -q origin HEAD:main
      git worktree remove --force "$W"
      [ -z "$(git branch --show-current)" ] && [ -z "$(git status --porcelain)" ] && git fetch -q origin && git switch -q --detach origin/main
      echo DONE`)
    expect(r.code, r.out).toBe(0)
    expect(r.out).toContain('DONE')
    expect(existsSync(join(lw, '.claude/worktrees/dflow-merge'))).toBe(false)
    const log = sh(origin, 'git log --format=%s main').out
    expect(log).toContain('merge: TSK-01-01 x (approved)')
    expect(log).toContain('chore(TSK-01-01): phase=merged')
    // 팀장 워크트리는 최신으로 옮겨졌고, 주 체크아웃은 main 에 그대로다
    expect(readFileSync(join(lw, 'docs/tasks/TSK-01-01/state.json'), 'utf8')).toContain('merged')
    expect(sh(primary, 'git branch --show-current').out.trim()).toBe('main')
  })

  it('push 가 경합으로 거부되면 non-fast-forward 문구가 나오고 reset --hard 로 되돌릴 수 있다', () => {
    sh(primary, `bash '${LEAD_WT}' k2`)
    const lw = join(primary, '.claude/worktrees/lead-k2')
    const r = sh(lw, `
      W="${lw}/.claude/worktrees/dflow-merge"
      git fetch -q origin && git worktree add -q --detach "$W" origin/main
      pre=$(git -C "$W" rev-parse HEAD)
      git -C "$W" merge -q --no-ff origin/agent/aaaaaaaa-x -m m
      # 그사이 다른 팀장이 main 을 올렸다
      git -C "${primary}" commit -q --allow-empty -m other && git -C "${primary}" push -q origin main
      out=$(git -C "$W" push origin HEAD:main 2>&1); rc=$?
      echo "rc=$rc"; echo "$out" | grep -Eq 'non-fast-forward|fetch first' && echo CONTENDED
      git -C "$W" reset -q --hard "$pre" && [ "$(git -C "$W" rev-parse HEAD)" = "$pre" ] && echo RESET_OK
      git worktree remove --force "$W"`)
    expect(r.out).toContain('rc=1')
    expect(r.out).toContain('CONTENDED')
    expect(r.out).toContain('RESET_OK')
  })
})

describe('팀원 의존성: 리포 공용 캐시에서 복제한다(/dflow-dev 행 H)', () => {
  const fakeBin = () => {
    const bin = join(tmp, 'bin')
    mkdirSync(bin, { recursive: true })
    // 가짜 npm: 호출을 기록하고 node_modules 를 만든다. FAKE_NPM_FAIL 이면 실패한다
    writeFileSync(join(bin, 'npm'), `#!/bin/sh
echo "$*" >> "${tmp}/npm.log"
[ -n "\${FAKE_NPM_FAIL:-}" ] && exit 9
mkdir -p node_modules/.bin node_modules/pkg && echo v1 > node_modules/pkg/index.js
ln -s ../pkg/index.js node_modules/.bin/pkg
mkdir -p node_modules/.cache && echo abs > node_modules/.cache/x
`)
    chmodSync(join(bin, 'npm'), 0o755)
    return bin
  }
  const worker = (name: string) => {
    const w = join(primary, '.claude/worktrees', name)
    const r = sh(primary, `
      mkdir -p .claude/worktrees
      grep -qxF '**/.claude/worktrees/' .git/info/exclude || echo '**/.claude/worktrees/' >> .git/info/exclude   # 팀장 전제 검사가 넣는 패턴
      git worktree add -q --detach "${w}" main
      printf '{}\\n' > "${w}/package.json"; printf '{"lockfileVersion":3}\\n' > "${w}/package-lock.json"`)
    expect(r.code, r.out).toBe(0)
    return w
  }
  const npmCalls = () => (existsSync(join(tmp, 'npm.log')) ? readFileSync(join(tmp, 'npm.log'), 'utf8').trim().split('\n').length : 0)

  it('문서: 행 H 는 deps.sh 를 부르고, 사람 체크아웃의 node_modules 를 쓰지 않는 이유를 적는다', () => {
    expect(DEV).toContain('.claude/skills/dflow-dev/scripts/deps.sh')
    expect(DEV).toContain('사람 체크아웃의 `node_modules` 는 쓰지 않는다')
  })

  it('첫 팀원은 npm ci 하고 캐시를 채우며, 다음 팀원은 npm 없이 복제한다', () => {
    const bin = fakeBin()
    const env = { PATH: `${bin}:${process.env.PATH}` }
    const w1 = worker('dflow-11111111')
    const r1 = sh(w1, `bash '${DEPS}'`, env)
    expect(r1.code, r1.out).toBe(0)
    expect(r1.out).toContain('DEPS_INSTALLED npm ci')
    expect(r1.out).toContain('DEPS_CACHED')
    expect(npmCalls()).toBe(1)
    const w2 = worker('dflow-22222222')
    const r2 = sh(w2, `bash '${DEPS}'`, env)
    expect(r2.code, r2.out).toBe(0)
    expect(r2.out).toContain('DEPS_CLONED')
    expect(npmCalls()).toBe(1)
    expect(readFileSync(join(w2, 'node_modules/pkg/index.js'), 'utf8')).toBe('v1\n')
    // .bin 의 상대 링크가 복제 뒤에도 풀린다
    expect(lstatSync(join(w2, 'node_modules/.bin/pkg')).isSymbolicLink()).toBe(true)
    expect(readFileSync(join(w2, 'node_modules/.bin/pkg'), 'utf8')).toBe('v1\n')
    // 도구 캐시는 복제되지 않는다
    expect(existsSync(join(w2, 'node_modules/.cache'))).toBe(false)
    // 캐시는 공용 git 디렉터리 아래에 있고 작업 트리를 더럽히지 않는다
    expect(existsSync(join(primary, '.git/dflow-deps'))).toBe(true)
    expect(sh(primary, 'git status --porcelain').out.trim()).toBe('')
  })

  it('lockfile 이 다르면 캐시를 쓰지 않고 npm ci 한다', () => {
    const bin = fakeBin()
    const env = { PATH: `${bin}:${process.env.PATH}` }
    sh(worker('dflow-11111111'), `bash '${DEPS}'`, env)
    const w2 = worker('dflow-22222222')
    writeFileSync(join(w2, 'package-lock.json'), '{"lockfileVersion":3,"x":1}\n')
    const r = sh(w2, `bash '${DEPS}'`, env)
    expect(r.out).toContain('DEPS_INSTALLED npm ci')
    expect(npmCalls()).toBe(2)
  })

  it('npm ci 가 실패하면 DEPS_FAILED 와 그 exit 로 끝나고 캐시를 남기지 않는다', () => {
    const bin = fakeBin()
    const r = sh(worker('dflow-11111111'), `bash '${DEPS}'`, { PATH: `${bin}:${process.env.PATH}`, FAKE_NPM_FAIL: '1' })
    expect(r.code).toBe(9)
    expect(r.out).toContain('DEPS_FAILED npm ci exit 9')
    expect(sh(primary, 'ls .git/dflow-deps 2>/dev/null | wc -l').out.trim()).toBe('0')
  })

  it('node_modules 가 이미 있거나 package.json 이 없으면 아무것도 하지 않는다', () => {
    const bin = fakeBin()
    const env = { PATH: `${bin}:${process.env.PATH}` }
    const w = worker('dflow-11111111')
    mkdirSync(join(w, 'node_modules'))
    expect(sh(w, `bash '${DEPS}'`, env).out).toContain('DEPS_SKIP')
    rmSync(join(w, 'package.json'))
    rmSync(join(w, 'node_modules'), { recursive: true })
    expect(sh(w, `bash '${DEPS}'`, env).out).toContain('DEPS_SKIP')
    expect(npmCalls()).toBe(0)
  })
})
