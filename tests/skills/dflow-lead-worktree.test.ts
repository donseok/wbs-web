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
const LIVE_LEADS = join(ROOT, '.claude/skills/dflow-team/scripts/live-leads.sh')

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
    printf 'x\\n' > a.txt && printf '.env\\n.dflow.local\\n' > .gitignore
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

  it('일반 스킬만 추적하고 dflow-* 는 심링크인 리포 — dflow-* 만 링크하고 그 패턴만 exclude 한다', () => {
    const r0 = sh(primary, `
      mkdir -p .claude/skills/mine && printf 'm\\n' > .claude/skills/mine/SKILL.md
      git add .claude/skills/mine && git commit -qm skills && git push -q origin main
      mkdir -p '${tmp}/kit/dflow-team' && printf 'x\\n' > '${tmp}/kit/dflow-team/SKILL.md'
      ln -s '${tmp}/kit/dflow-team' .claude/skills/dflow-team
    `)
    expect(r0.code, r0.out).toBe(0)
    const r = sh(primary, `bash '${LEAD_WT}' k3`)
    expect(r.code, r.out).toBe(0)
    const lw = join(primary, '.claude/worktrees/lead-k3')
    expect(lstatSync(join(lw, '.claude/skills')).isSymbolicLink()).toBe(false)
    expect(existsSync(join(lw, '.claude/skills/mine/SKILL.md'))).toBe(true)
    expect(lstatSync(join(lw, '.claude/skills/dflow-team')).isSymbolicLink()).toBe(true)
    const ex = readFileSync(join(primary, '.git/info/exclude'), 'utf8').split('\n')
    expect(ex).toContain('/.claude/skills/dflow-*')
    expect(ex).not.toContain('/.claude/skills')
    expect(sh(primary, 'git status --porcelain').out.trim()).toBe('')
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

  it('새 방식: 개발 브랜치에서 detach 하고, as 를 뺀 .dflow.local 사본(600)을 만들며 토큰을 출력하지 않는다', () => {
    const r0 = sh(primary, `git switch -q -c dev/me && printf 'z\\n' > d.txt && git add d.txt && git commit -qm dev && git push -q origin dev/me && git switch -q main`)
    expect(r0.code, r0.out).toBe(0)
    mkdirSync(join(primary, '.claude/skills/dflow-team'), { recursive: true })
    writeFileSync(join(primary, '.claude/skills/dflow-team/SKILL.md'), 'x')
    writeFileSync(join(primary, '.dflow'), 'api_base=https://x.test\n')
    writeFileSync(join(primary, '.dflow.local'), 'pats=dflow_pat_AAAAAAAAAAAA_topsecrettopsecret\nas=AAAAAAAAAAAA\ndev_branch=dev/me\n')
    const r = sh(primary, `bash '${LEAD_WT}' k3`)
    expect(r.code, r.out).toBe(0)
    expect(r.out).not.toContain('topsecret')
    const lw = join(primary, '.claude/worktrees/lead-k3')
    expect(existsSync(join(lw, 'd.txt'))).toBe(true)                       // origin/dev/me 기점
    const local = readFileSync(join(lw, '.dflow.local'), 'utf8')
    expect(local).toContain('dev_branch=dev/me'); expect(local).not.toMatch(/^as=/m)
    expect(statSync(join(lw, '.dflow.local')).mode & 0o777).toBe(0o600)
    expect(lstatSync(join(lw, '.dflow')).isSymbolicLink()).toBe(true)        // 커밋되지 않은 .dflow 는 링크
    expect(r.out).toContain('LOCAL_COPIED')
  })
  it('새 방식 설정이 깨졌으면(NO_LOCAL) 워크트리를 만들지 않고 exit 2', () => {
    writeFileSync(join(primary, '.dflow'), 'api_base=https://x.test\n')
    const r = sh(primary, `bash '${LEAD_WT}' k4`)
    expect(r.code).toBe(2); expect(r.out).toContain('NO_LOCAL')
    expect(existsSync(join(primary, '.claude/worktrees/lead-k4'))).toBe(false)
  })
})

describe('키 판정은 다른 워크트리의 살아 있는 팀장이 쓰는 신원을 가려낸다(live-leads.sh)', () => {
  const HOST = spawnSync('sh', ['-c', "hostname | cut -d. -f1 | tr 'A-Z' 'a-z' | sed 's/[^a-z0-9-]/-/g'"], { encoding: 'utf8' }).stdout.trim()
  const now = () => Math.floor(Date.now() / 1000)
  const lockOf = (cwd: string) => sh(cwd, 'git rev-parse --path-format=absolute --git-path dflow-team.lock').out.trim()
  const hold = (cwd: string, owner: string, beat: number | null) => {
    const l = lockOf(cwd)
    mkdirSync(l, { recursive: true })
    writeFileSync(join(l, 'owner'), `${owner} ${now()} 1\n`)
    if (beat !== null) writeFileSync(join(l, 'beat'), `${beat}\n`)
    return l
  }

  it('다른 워크트리의 살아 있는 잠금만 <신원><TAB><워크트리> 로 낸다 — 자기 잠금·죽은 잠금·다른 host 는 뺀다', () => {
    sh(primary, `bash '${LEAD_WT}' k2`)
    const lw = join(primary, '.claude/worktrees/lead-k2')
    expect(sh(lw, `bash '${LIVE_LEADS}'`).out).toBe('')
    const l = hold(primary, `alice/${HOST}/lead`, now())
    expect(sh(lw, `bash '${LIVE_LEADS}'`).out).toBe(`alice\t${primary}\n`)
    // 자기 워크트리의 잠금은 세지 않는다
    expect(sh(primary, `bash '${LIVE_LEADS}'`).out).toBe('')
    // beat 가 70분을 넘기면 죽은 팀장이다(SAME_IDENTITY_LEAD 와 같은 기준)
    writeFileSync(join(l, 'beat'), `${now() - 5000}\n`)
    expect(sh(lw, `bash '${LIVE_LEADS}'`).out).toBe('')
    // 다른 host 의 잠금은 SAME_IDENTITY_LEAD 가 막지 않으므로 여기서도 빼지 않는다
    hold(primary, 'alice/other-pc/lead', now())
    expect(sh(lw, `bash '${LIVE_LEADS}'`).out).toBe('')
  })

  it('--mark 는 profiles 행에 in_use 를 더하고 JSON 이 아닌 줄은 그대로 낸다', () => {
    sh(primary, `bash '${LEAD_WT}' k2`)
    const lw = join(primary, '.claude/worktrees/lead-k2')
    hold(primary, `alice/${HOST}/lead`, now())
    const input = [
      'DFLOW_AS=없음',
      '{"n":1,"prefix":"AAAAAAAAAAAA","email":"alice@example.com","who":"alice","bound":true,"selected":true}',
      '{"n":2,"prefix":"BBBBBBBBBBBB","email":"bob@example.com","who":"bob","bound":true,"selected":false}',
      '{"n":3,"prefix":"CCCCCCCCCCCC","error":"auth","selected":false}',
    ].join('\n')
    writeFileSync(join(tmp, 'in.txt'), input + '\n')
    const r = sh(lw, `bash '${LIVE_LEADS}' --mark < '${join(tmp, 'in.txt')}'`)
    expect(r.code, r.out).toBe(0)
    const lines = r.out.trim().split('\n')
    expect(lines[0]).toBe('DFLOW_AS=없음')
    expect(JSON.parse(lines[1])).toMatchObject({ prefix: 'AAAAAAAAAAAA', in_use: primary })
    expect(JSON.parse(lines[2])).toMatchObject({ prefix: 'BBBBBBBBBBBB', in_use: null })
    expect(JSON.parse(lines[3])).toMatchObject({ prefix: 'CCCCCCCCCCCC', in_use: null })
  })

  it('살아 있음의 기준이 전제 검사의 stale() 와 같다', () => {
    const t = readFileSync(LIVE_LEADS, 'utf8')
    for (const s of ['-ge 4200', '-mmin +10']) {
      expect(t, s).toContain(s)
      expect(TEAM, s).toContain(s)
    }
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

  it('문서: 행 H 는 deps.sh 를 부르고, npm 은 사람 체크아웃을 쓰지 않고 pnpm 은 복제 뒤 lockfile 로 바로잡는 이유를 적는다', () => {
    expect(DEV).toContain('.claude/skills/dflow-dev/scripts/deps.sh')
    expect(DEV).toContain('npm 은 사람 체크아웃의 `node_modules` 를 쓰지 않는다')
    expect(DEV).toContain('pnpm 은 기존 설치를 lockfile 과 대조해 다른 것만 바로잡으므로')
    const deps = readFileSync(DEPS, 'utf8')
    expect(deps).toContain('npm 은 사람 체크아웃의 node_modules 를 쓰지 않는다')
    expect(deps).toContain('--config.confirmModulesPurge=false')
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

  // 워크트리 루트뿐 아니라 하위 폴더(예 dmes-standard 의 src/frontend)의 lockfile 도 찾아 설치한다(요청 2).
  const fakePnpm = () => {
    const bin = join(tmp, 'bin-pnpm')
    mkdirSync(bin, { recursive: true })
    writeFileSync(join(bin, 'pnpm'), `#!/bin/sh
{ echo "$*"; pwd; } >> "${tmp}/pnpm.log"
mkdir -p node_modules && echo v1 > node_modules/marker
`)
    chmodSync(join(bin, 'pnpm'), 0o755)
    return bin
  }
  const pnpmLog = () => (existsSync(join(tmp, 'pnpm.log')) ? readFileSync(join(tmp, 'pnpm.log'), 'utf8') : '')

  it('루트에 package.json 이 없어도 하위 폴더의 lockfile 을 찾아 그 폴더에서 설치한다', () => {
    const bin = fakePnpm()
    const env = { PATH: `${bin}:${process.env.PATH}` }
    const w = join(primary, '.claude/worktrees', 'dflow-66666666')
    const r0 = sh(primary, `
      mkdir -p .claude/worktrees
      grep -qxF '**/.claude/worktrees/' .git/info/exclude || echo '**/.claude/worktrees/' >> .git/info/exclude
      git worktree add -q --detach "${w}" main
      mkdir -p "${w}/src/frontend"
      printf '{}\\n' > "${w}/src/frontend/package.json"
      printf 'lockfileVersion: 6\\n' > "${w}/src/frontend/pnpm-lock.yaml"`)
    expect(r0.code, r0.out).toBe(0)
    const r = sh(w, `bash '${DEPS}'`, env)
    expect(r.code, r.out).toBe(0)
    expect(r.out).toContain('DEPS_SKIP package.json 없음') // 루트
    expect(r.out).toContain('DEPS_INSTALLED pnpm src/frontend')
    expect(pnpmLog().trim().split('\n').pop()).toBe(join(w, 'src/frontend'))
    expect(existsSync(join(w, 'src/frontend/node_modules/marker'))).toBe(true)
    expect(existsSync(join(w, 'node_modules'))).toBe(false)
  })

  it('node_modules·.claude 아래의 lockfile 은 하위 폴더 스캔에서 무시한다', () => {
    const bin = fakePnpm()
    const env = { PATH: `${bin}:${process.env.PATH}` }
    const w = join(primary, '.claude/worktrees', 'dflow-77777777')
    const r0 = sh(primary, `
      mkdir -p .claude/worktrees
      grep -qxF '**/.claude/worktrees/' .git/info/exclude || echo '**/.claude/worktrees/' >> .git/info/exclude
      git worktree add -q --detach "${w}" main
      mkdir -p "${w}/node_modules/vendor" "${w}/.claude/worktrees/nested"
      printf '{}\\n' > "${w}/node_modules/vendor/package.json"
      printf 'lockfileVersion: 6\\n' > "${w}/node_modules/vendor/pnpm-lock.yaml"
      printf '{}\\n' > "${w}/.claude/worktrees/nested/package.json"
      printf 'lockfileVersion: 6\\n' > "${w}/.claude/worktrees/nested/pnpm-lock.yaml"`)
    expect(r0.code, r0.out).toBe(0)
    const r = sh(w, `bash '${DEPS}'`, env)
    expect(r.code, r.out).toBe(0)
    expect(r.out).not.toContain('vendor')
    expect(r.out).not.toContain('nested')
    expect(pnpmLog()).toBe('')
  })
})

describe('pnpm: 메인 체크아웃의 설치본을 복제하고 워커 lockfile 로 바로잡는다(2026-09-24 과제 G)', () => {
  // 메인(primary)의 src/frontend 가 pnpm 워크스페이스 루트이고 packages/a 가 워크스페이스 패키지다.
  const commitWorkspace = (lock = 'lockfileVersion: 9.0\n') => {
    mkdirSync(join(primary, 'src/frontend/packages/a'), { recursive: true })
    writeFileSync(join(primary, 'src/frontend/package.json'), '{"name":"fe","private":true}\n')
    writeFileSync(join(primary, 'src/frontend/pnpm-workspace.yaml'), 'packages:\n  - "packages/*"\n')
    writeFileSync(join(primary, 'src/frontend/pnpm-lock.yaml'), lock)
    writeFileSync(join(primary, 'src/frontend/packages/a/package.json'), '{"name":"a","private":true}\n')
    const r = sh(primary, `printf 'node_modules\\n' >> .gitignore
      git add .gitignore src && git commit -qm fe && git push -q origin main`)
    expect(r.code, r.out).toBe(0)
  }
  const worker = (name: string) => {
    const w = join(primary, '.claude/worktrees', name)
    const r = sh(primary, `
      mkdir -p .claude/worktrees
      grep -qxF '**/.claude/worktrees/' .git/info/exclude || echo '**/.claude/worktrees/' >> .git/info/exclude
      git worktree add -q --detach "${w}" main`)
    expect(r.code, r.out).toBe(0)
    return w
  }
  // 메인에 사람이 설치해 둔 것처럼 node_modules 를 만든다(셈·도구 캐시·.pnpm 안 셈 포함)
  const mainInstall = () => {
    const fe = join(primary, 'src/frontend')
    for (const d of ['node_modules/.bin', 'node_modules/.pnpm/p@1/node_modules/p/node_modules/.bin', 'node_modules/.cache', 'packages/a/node_modules/.bin'])
      mkdirSync(join(fe, d), { recursive: true })
    writeFileSync(join(fe, 'node_modules/.main-marker'), 'MAIN')
    writeFileSync(join(fe, 'node_modules/.bin/x'), `NODE_PATH=${fe}/node_modules/.pnpm`)
    writeFileSync(join(fe, 'node_modules/.pnpm/p@1/node_modules/p/node_modules/.bin/p'), 'shim')
    writeFileSync(join(fe, 'node_modules/.cache/c'), 'abs')
    writeFileSync(join(fe, 'packages/a/node_modules/.pkg-marker'), 'A')
  }
  // 가짜 pnpm: 불릴 때의 상태를 기록한다. FAKE_PNPM_FAIL_CLONED 면 복제본 위에서 불릴 때만 실패한다
  const fakePnpm = () => {
    const bin = join(tmp, 'bin-pnpm')
    mkdirSync(bin, { recursive: true })
    writeFileSync(join(bin, 'pnpm'), `#!/bin/sh
st=""
for f in node_modules/.main-marker node_modules/.bin node_modules/.pnpm/p@1/node_modules/p/node_modules/.bin node_modules/.cache packages/a/node_modules packages/a/node_modules/.bin; do
  [ -e "$f" ] && st="$st $f"
done
{ echo "ARGS $*"; echo "CWD $(pwd)"; echo "HAS$st"; } >> "${tmp}/pnpm.log"
[ -n "\${FAKE_PNPM_FAIL_CLONED:-}" ] && [ -e node_modules/.main-marker ] && exit 7
mkdir -p node_modules && echo v1 > node_modules/marker
`)
    chmodSync(join(bin, 'pnpm'), 0o755)
    return bin
  }
  const calls = () => (existsSync(join(tmp, 'pnpm.log')) ? readFileSync(join(tmp, 'pnpm.log'), 'utf8').split('ARGS ').slice(1) : [])

  it('메인 설치본을 복제하고 모든 .bin·도구 캐시를 지운 뒤 워크스페이스 루트에서 한 번만 frozen install 한다', () => {
    commitWorkspace()
    mainInstall()
    const w = worker('dflow-a1a1a1a1')
    const r = sh(w, `bash '${DEPS}'`, { PATH: `${fakePnpm()}:${process.env.PATH}` })
    expect(r.code, r.out).toBe(0)
    expect(r.out).toContain('DEPS_SYNCED pnpm 메인 복제 + frozen install src/frontend')
    const c = calls()
    expect(c.length).toBe(1)
    expect(c[0]).toContain('install --frozen-lockfile --prefer-offline --config.confirmModulesPurge=false')
    expect(c[0]).toContain(`CWD ${join(w, 'src/frontend')}`)
    // 복제본(메인 표식·패키지 node_modules)은 있고, 셈(.pnpm 안 포함)·도구 캐시는 install 전에 지워졌다
    expect(c[0]).toContain('node_modules/.main-marker')
    expect(c[0]).toContain('packages/a/node_modules')
    expect(c[0]).not.toContain('node_modules/.bin')
    expect(c[0]).not.toContain('node_modules/.cache')
    expect(readFileSync(join(w, 'src/frontend/packages/a/node_modules/.pkg-marker'), 'utf8')).toBe('A')
    // 메인은 그대로다
    expect(existsSync(join(primary, 'src/frontend/node_modules/.bin/x'))).toBe(true)
    expect(existsSync(join(primary, 'src/frontend/node_modules/.cache/c'))).toBe(true)
  })

  it('복제 뒤 install 이 실패하면 복제본을 모두 지우고 새로 설치한다', () => {
    commitWorkspace()
    mainInstall()
    const w = worker('dflow-b2b2b2b2')
    const r = sh(w, `bash '${DEPS}'`, { PATH: `${fakePnpm()}:${process.env.PATH}`, FAKE_PNPM_FAIL_CLONED: '1' })
    expect(r.code, r.out).toBe(0)
    expect(r.out).toContain('DEPS_SYNC_FAILED pnpm install exit 7')
    expect(r.out).toContain('DEPS_INSTALLED pnpm src/frontend')
    const c = calls()
    expect(c.length).toBe(2)
    expect(c[1]).toMatch(/HAS\n/) // 두 번째 호출 때는 복제본이 하나도 없다(루트·패키지 모두)
    expect(existsSync(join(w, 'src/frontend/node_modules/.main-marker'))).toBe(false)
  })

  it('DFLOW_DEPS_MAIN_CLONE=0 이면 메인 설치본이 있어도 복제하지 않고 새로 설치한다', () => {
    commitWorkspace()
    mainInstall()
    const w = worker('dflow-c9c9c9c9')
    const r = sh(w, `bash '${DEPS}'`, { PATH: `${fakePnpm()}:${process.env.PATH}`, DFLOW_DEPS_MAIN_CLONE: '0' })
    expect(r.code, r.out).toBe(0)
    expect(r.out).not.toContain('DEPS_SYNC')
    expect(r.out).toContain('DEPS_INSTALLED pnpm src/frontend')
    expect(calls()[0]).not.toContain('.main-marker')
  })

  it('메인의 node_modules 가 심링크거나 없으면 복제하지 않고 새로 설치한다', () => {
    commitWorkspace()
    const real = join(tmp, 'elsewhere-nm')
    mkdirSync(real, { recursive: true })
    writeFileSync(join(real, '.main-marker'), 'LINKED')
    sh(primary, `ln -s '${real}' src/frontend/node_modules`)
    const w = worker('dflow-c3c3c3c3')
    const r = sh(w, `bash '${DEPS}'`, { PATH: `${fakePnpm()}:${process.env.PATH}` })
    expect(r.code, r.out).toBe(0)
    expect(r.out).not.toContain('DEPS_SYNC')
    expect(r.out).toContain('DEPS_INSTALLED pnpm src/frontend')
    expect(calls()[0]).not.toContain('.main-marker')
    expect(lstatSync(join(w, 'src/frontend/node_modules')).isSymbolicLink()).toBe(false)
  })

  it('자기 lockfile 이 있는 하위 프로젝트는 워크스페이스 패키지로 복제하지 않고 따로 설치한다', () => {
    commitWorkspace()
    mainInstall()
    mkdirSync(join(primary, 'src/frontend/x/node_modules'), { recursive: true })
    writeFileSync(join(primary, 'src/frontend/x/package.json'), '{}\n')
    writeFileSync(join(primary, 'src/frontend/x/pnpm-lock.yaml'), 'lockfileVersion: 9.0\n')
    writeFileSync(join(primary, 'src/frontend/x/node_modules/.main-marker'), 'X')
    expect(sh(primary, 'git add src && git commit -qm x && git push -q origin main').code).toBe(0)
    const w = worker('dflow-d4d4d4d4')
    const r = sh(w, `bash '${DEPS}'`, { PATH: `${fakePnpm()}:${process.env.PATH}` })
    expect(r.code, r.out).toBe(0)
    expect(r.out).toContain('DEPS_SYNCED pnpm 메인 복제 + frozen install src/frontend')
    expect(r.out).toContain('DEPS_SYNCED pnpm 메인 복제 + frozen install src/frontend/x')
    expect(r.out).not.toContain('DEPS_SKIP node_modules 있음 src/frontend/x')
    expect(calls().length).toBe(2)
  })

  // ---- 실제 pnpm(이 PC 에 있을 때만). 네트워크 없이 file: 로컬 패키지만 쓴다 ----
  const hasPnpm = spawnSync('pnpm', ['--version'], { encoding: 'utf8' }).status === 0
  const psh = (cwd: string, script: string, env: Record<string, string> = {}) => {
    // 퍼지 확인 프롬프트 회귀는 실패가 아니라 무한 대기로 나타난다 — timeout 으로 실패시킨다
    const r = spawnSync('bash', ['-c', script], { cwd, encoding: 'utf8', timeout: 90_000, env: { ...GIT_ENV, CI: '', ...env } })
    return { code: r.status, out: (r.stdout || '') + (r.stderr || '') + (r.error ? String(r.error) : '') }
  }
  const realWorkspace = (store: string) => {
    const r = psh(primary, `set -e
      mkdir -p vendor/tool/bin src/frontend/packages/a
      printf '{"name":"tool","version":"1.0.0","bin":{"tool":"bin/tool.js"},"main":"index.js"}\\n' > vendor/tool/package.json
      printf '#!/usr/bin/env node\\nconsole.log("TOOL_OK")\\n' > vendor/tool/bin/tool.js
      printf 'module.exports = "tool"\\n' > vendor/tool/index.js
      mkdir -p vendor/tool2
      printf '{"name":"tool2","version":"1.0.0","main":"index.js"}\\n' > vendor/tool2/package.json
      printf 'module.exports = "tool2"\\n' > vendor/tool2/index.js
      printf '{"name":"fe","private":true,"devDependencies":{"tool":"file:../../vendor/tool"}}\\n' > src/frontend/package.json
      printf 'packages:\\n  - "packages/*"\\n' > src/frontend/pnpm-workspace.yaml
      printf '{"name":"a","private":true,"dependencies":{"tool":"file:../../../../vendor/tool"}}\\n' > src/frontend/packages/a/package.json
      printf 'node_modules\\n' >> .gitignore
      cd src/frontend && pnpm install --prefer-offline >/dev/null && cd ../..
      git add .gitignore vendor src && git commit -qm fe && git push -q origin main`, { npm_config_store_dir: store })
    expect(r.code, r.out).toBe(0)
  }
  // 워커 쪽 파일 중 메인의 설치 경로를 품은 것. 워커는 메인 아래(.claude/worktrees)에 있으므로 메인 루트가 아니라
  // 메인의 src/frontend/ 까지 붙여 찾는다(루트만 찾으면 워커 자기 경로도 걸린다).
  const leaks = (w: string) => psh(w, `grep -rl '${primary}/src/frontend/' src/frontend/node_modules src/frontend/packages/a/node_modules 2>/dev/null || true`).out.trim()

  it.skipIf(!hasPnpm)('실제 pnpm: 복제본의 .pnpm 상대 링크가 풀리고, 셈이 워커 경로로 다시 만들어진다', () => {
    const store = join(tmp, 'store')
    realWorkspace(store)
    // 전제: 메인 설치본의 셈에는 메인 경로가 박혀 있다
    expect(psh(primary, `grep -rl '${primary}/src/frontend/' src/frontend/node_modules | head -1`).out.trim()).not.toBe('')
    const w = worker('dflow-e5e5e5e5')
    const r = psh(w, `bash '${DEPS}'`, { npm_config_store_dir: store })
    expect(r.code, r.out).toBe(0)
    expect(r.out).toContain('DEPS_SYNCED pnpm 메인 복제 + frozen install src/frontend')
    const fe = join(w, 'src/frontend')
    expect(lstatSync(join(fe, 'node_modules/tool')).isSymbolicLink()).toBe(true)
    expect(realpathSync(join(fe, 'node_modules/tool')).startsWith(join(fe, 'node_modules/.pnpm/'))).toBe(true)
    expect(realpathSync(join(fe, 'packages/a/node_modules/tool')).startsWith(join(fe, 'node_modules/.pnpm/'))).toBe(true)
    expect(psh(fe, './node_modules/.bin/tool').out).toContain('TOOL_OK')
    expect(leaks(w)).toBe('')
  }, 120_000)

  it.skipIf(!hasPnpm)('실제 pnpm: 메인 설치본이 워커 lockfile 과 어긋나 있어도 install 이 lockfile 대로 바로잡는다', () => {
    const store = join(tmp, 'store')
    realWorkspace(store)
    // 워커 기점에서 packages/a 가 tool2 를 새로 쓴다. 메인 설치본은 옛 lockfile 그대로 둔다(사람이 설치를 안 한 상태)
    const r0 = psh(primary, `set -e
      printf '{"name":"a","private":true,"dependencies":{"tool":"file:../../../../vendor/tool","tool2":"file:../../../../vendor/tool2"}}\\n' > src/frontend/packages/a/package.json
      cd src/frontend && pnpm install --lockfile-only --prefer-offline >/dev/null && cd ../..
      git add src && git commit -qm tool2 && git push -q origin main`, { npm_config_store_dir: store })
    expect(r0.code, r0.out).toBe(0)
    expect(existsSync(join(primary, 'src/frontend/packages/a/node_modules/tool2'))).toBe(false)
    const w = worker('dflow-f6f6f6f6')
    const r = psh(w, `bash '${DEPS}'`, { npm_config_store_dir: store })
    expect(r.code, r.out).toBe(0)
    expect(r.out).toContain('DEPS_SYNCED')
    expect(psh(join(w, 'src/frontend/packages/a'), `node -e 'console.log(require("tool2"))'`).out).toContain('tool2')
  }, 120_000)

  it.skipIf(!hasPnpm)('실제 pnpm: store 가 달라도 확인 프롬프트에 멈추지 않고 끝난다', () => {
    realWorkspace(join(tmp, 'store'))
    const w = worker('dflow-a7a7a7a7')
    const r = psh(w, `bash '${DEPS}'`, { npm_config_store_dir: join(tmp, 'other-store') })
    expect(r.code, r.out).toBe(0)
    expect(r.out).toContain('DEPS_SYNCED')
    expect(psh(join(w, 'src/frontend'), './node_modules/.bin/tool').out).toContain('TOOL_OK')
    expect(leaks(w)).toBe('')
  }, 120_000)
})

describe('gradle-wrapper.jar 복구: 메인 체크아웃에서 복사한다(요청 3)', () => {
  const bareWorker = (name: string) => {
    const w = join(primary, '.claude/worktrees', name)
    const r = sh(primary, `
      mkdir -p .claude/worktrees
      grep -qxF '**/.claude/worktrees/' .git/info/exclude || echo '**/.claude/worktrees/' >> .git/info/exclude
      git worktree add -q --detach "${w}" main`)
    expect(r.code, r.out).toBe(0)
    return w
  }
  const commitGradlew = () => {
    const r = sh(primary, `
      mkdir -p sub
      printf '#!/bin/sh\\necho gradlew\\n' > sub/gradlew && chmod +x sub/gradlew
      git add sub/gradlew && git commit -qm 'add gradlew' && git push -q origin main`)
    expect(r.code, r.out).toBe(0)
  }

  it('없으면 메인 체크아웃에서 복사한다', () => {
    commitGradlew()
    mkdirSync(join(primary, 'sub/gradle/wrapper'), { recursive: true })
    writeFileSync(join(primary, 'sub/gradle/wrapper/gradle-wrapper.jar'), 'JARDATA')
    const w = bareWorker('dflow-88888888')
    expect(existsSync(join(w, 'sub/gradlew'))).toBe(true)
    expect(existsSync(join(w, 'sub/gradle/wrapper/gradle-wrapper.jar'))).toBe(false)
    const r = sh(w, `bash '${DEPS}'`)
    expect(r.code, r.out).toBe(0)
    expect(r.out).toContain('DEPS_GRADLE_JAR sub')
    expect(readFileSync(join(w, 'sub/gradle/wrapper/gradle-wrapper.jar'), 'utf8')).toBe('JARDATA')
  })

  it('이미 있으면 건드리지 않는다', () => {
    commitGradlew()
    mkdirSync(join(primary, 'sub/gradle/wrapper'), { recursive: true })
    writeFileSync(join(primary, 'sub/gradle/wrapper/gradle-wrapper.jar'), 'NEW')
    const w = bareWorker('dflow-99999999')
    mkdirSync(join(w, 'sub/gradle/wrapper'), { recursive: true })
    writeFileSync(join(w, 'sub/gradle/wrapper/gradle-wrapper.jar'), 'OLD')
    const r = sh(w, `bash '${DEPS}'`)
    expect(r.code, r.out).toBe(0)
    expect(r.out).not.toContain('DEPS_GRADLE_JAR')
    expect(readFileSync(join(w, 'sub/gradle/wrapper/gradle-wrapper.jar'), 'utf8')).toBe('OLD')
  })

  it('메인 체크아웃에도 없으면 DEPS_GRADLE_JAR_MISSING 을 알리고 설치는 계속한다', () => {
    commitGradlew()
    const w = bareWorker('dflow-77777777')
    const r = sh(w, `bash '${DEPS}'`)
    expect(r.code, r.out).toBe(0)
    expect(r.out).toContain('DEPS_GRADLE_JAR_MISSING sub')
    expect(existsSync(join(w, 'sub/gradle/wrapper/gradle-wrapper.jar'))).toBe(false)
  })
})

describe('gitignore 된 심링크 복제: 메인 체크아웃의 외부 링크를 워크트리에도 건다(2026-09-24 MDM팀장 요청)', () => {
  const bareWorker = (name: string) => {
    const w = join(primary, '.claude/worktrees', name)
    const r = sh(primary, `
      mkdir -p .claude/worktrees
      grep -qxF '**/.claude/worktrees/' .git/info/exclude || echo '**/.claude/worktrees/' >> .git/info/exclude
      git worktree add -q --detach "${w}" main`)
    expect(r.code, r.out).toBe(0)
    return w
  }
  const ignoreAndLink = (paths: string[]) => {
    const ext = join(tmp, 'external-design')
    mkdirSync(ext, { recursive: true })
    writeFileSync(join(ext, 'basic.md'), 'DESIGN')
    const lines = paths.map(p => `/${p}`).join('\\n')
    const r = sh(primary, `
      printf '${lines}\\n' >> .gitignore && git add .gitignore && git commit -qm ignore && git push -q origin main
      ${paths.map(p => `mkdir -p "$(dirname '${p}')" && ln -s '${ext}' '${p}'`).join('\n')}`)
    expect(r.code, r.out).toBe(0)
  }

  it('없으면 같은 상대 경로에 링크를 걸고 DEPS_LINK 로 알린다', () => {
    ignoreAndLink(['docs/mdm/design'])
    const w = bareWorker('dflow-66666666')
    expect(existsSync(join(w, 'docs/mdm/design'))).toBe(false)
    const r = sh(w, `bash '${DEPS}'`)
    expect(r.code, r.out).toBe(0)
    expect(r.out).toContain('DEPS_LINK docs/mdm/design')
    expect(lstatSync(join(w, 'docs/mdm/design')).isSymbolicLink()).toBe(true)
    expect(readFileSync(join(w, 'docs/mdm/design/basic.md'), 'utf8')).toBe('DESIGN')
  })

  it('이미 있으면 건드리지 않고, .claude·node_modules 아래 링크는 복제하지 않는다', () => {
    ignoreAndLink(['docs/design', 'node_modules/pkg', '.claude/skills/ext'])
    const w = bareWorker('dflow-55555555')
    mkdirSync(join(w, 'docs/design'), { recursive: true })
    writeFileSync(join(w, 'docs/design/mine.md'), 'MINE')
    const r = sh(w, `bash '${DEPS}'`)
    expect(r.code, r.out).toBe(0)
    expect(r.out).not.toContain('DEPS_LINK')
    expect(lstatSync(join(w, 'docs/design')).isSymbolicLink()).toBe(false)
    expect(existsSync(join(w, 'node_modules/pkg'))).toBe(false)
    expect(existsSync(join(w, '.claude/skills/ext'))).toBe(false)
  })

  it('추적되는 링크·ignore 되지 않은 미추적 링크는 복제하지 않는다', () => {
    const ext = join(tmp, 'external-design')
    mkdirSync(ext, { recursive: true })
    const r0 = sh(primary, `ln -s '${ext}' untracked-link`)
    expect(r0.code, r0.out).toBe(0)
    const w = bareWorker('dflow-44444444')
    const r = sh(w, `bash '${DEPS}'`)
    expect(r.code, r.out).toBe(0)
    expect(r.out).not.toContain('DEPS_LINK')
    expect(existsSync(join(w, 'untracked-link'))).toBe(false)
  })
})
