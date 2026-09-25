// tests/skills/dflow-dialect-check.test.ts
// 방언 검증(2026-09-24 dmes-standard: 워커마다 Testcontainers MSSQL 을 각자 띄워 16GB PC 가 load 52). 같은 목적의 도커
// 검증은 워커가 아니라 /dflow-merge 스윕 끝에서 한 번, 개발 브랜치 끝 커밋에서 돈다(dflow-merge/scripts/dialect-check.sh).
// 실제 git 샌드박스(bare origin + 호출 체크아웃)와 가짜 docker 로 확인한다. 도커 슬롯은 DFLOW_HEAVY_DIR 임시 폴더를 쓴다.
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const ROOT = process.cwd()
const SCRIPT = join(ROOT, '.claude/skills/dflow-merge/scripts/dialect-check.sh')
const MERGE = readFileSync(join(ROOT, '.claude/skills/dflow-merge/SKILL.md'), 'utf8')
// 방언 검증의 명령·결과 줄 상세는 스윕 보고 직전에만 읽는 references/dialect.md 로 옮겼다(2026-09-25)
const DIALECT = readFileSync(join(ROOT, '.claude/skills/dflow-merge/references/dialect.md'), 'utf8')
const TEAM = readFileSync(join(ROOT, '.claude/skills/dflow-team/SKILL.md'), 'utf8')
const EXAMPLE = readFileSync(join(ROOT, '.claude/skills/dflow-work/dflow.example'), 'utf8')
const LOCAL_EXAMPLE = readFileSync(join(ROOT, '.claude/skills/dflow-work/dflow.local.example'), 'utf8')

const BASE_ENV: Record<string, string | undefined> = {
  ...process.env,
  GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t',
  GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1',
}
for (const k of Object.keys(BASE_ENV)) if (k.startsWith('DFLOW_') || k === 'CLAUDE_PID') delete BASE_ENV[k]

let tmp: string, repo: string, bin: string, heavyDir: string, marks: string
function sh(cwd: string, script: string, env: Record<string, string> = {}) {
  const r = spawnSync('bash', ['-c', script], {
    cwd, encoding: 'utf8', timeout: 60000,
    env: { ...BASE_ENV, S: SCRIPT, PATH: `${bin}:${process.env.PATH}`, DFLOW_HEAVY_DIR: heavyDir,
      DFLOW_HEAVY_SLOTS: '1', DFLOW_HEAVY_WAIT: '2', DFLOW_HEAVY_POLL: '0.2', DFLOW_HEAVY_OWNER: '', ...env },
  })
  return { code: r.status, out: r.stdout || '', err: r.stderr || '' }
}
const run = (env: Record<string, string> = {}, extra = '') => sh(repo, `bash "$S" run --dev dev ${extra}`, env)
const last = (out: string) => out.trim().split('\n').at(-1) ?? ''
const count = () => (existsSync(join(marks, 'runs')) ? readFileSync(join(marks, 'runs'), 'utf8').trim().split('\n').length : 0)
function setConfig(cmd: string, local = '') {
  writeFileSync(join(repo, '.dflow'), `api_base=https://example.test\nproject_id=p\ndialect_check=${cmd}\n`)
  writeFileSync(join(repo, '.dflow.local'), `pats=\ndev_branch=dev\n${local}`)
}
// 개발 브랜치에 Task 하나를 --no-ff 머지로 올린다(/dflow-merge 와 같은 제목 `merge: <TSK> …`).
// 기본은 코드(src/)도 바꾼다. docsOnly 면 작업 폴더 문서만 바꾼다(files 로 리포 최상위 기준 경로의 파일을 더 쓴다).
function mergeTask(tsk: string, design = '', opt: { docsOnly?: boolean; files?: Record<string, string> } = {}) {
  const files = { ...(opt.docsOnly ? {} : { [`src/${tsk}.txt`]: tsk }), ...(opt.files ?? {}) }
  const writes = Object.entries(files).map(([f, c]) => `mkdir -p "$(dirname '${f}')" && printf '%s\\n' '${c}' > '${f}'`).join('\n')
  const r = sh(repo, `
    set -e
    git fetch -q origin && git switch -q dev && git reset -q --hard origin/dev
    git switch -q -c agent/${tsk.toLowerCase()}
    mkdir -p docs/tasks/${tsk} && printf '%s\\n' '{"phase":"merged"}' > docs/tasks/${tsk}/state.json
    ${design ? `printf '%b' '${design}' > docs/tasks/${tsk}/design.md` : ':'}
    ${writes || ':'}
    git add docs ${Object.keys(files).map((f) => `'${f}'`).join(' ')} && git commit -qm "${tsk} 구현"
    git switch -q dev && git merge -q --no-ff agent/${tsk.toLowerCase()} -m "merge: ${tsk} 제목 (approved)" -m "DFlow-Order: o-${tsk}"
    git push -q origin dev && git switch -q --detach origin/dev
  `)
  expect(r.code, r.err).toBe(0)
  return sh(repo, 'git rev-parse origin/dev').out.trim()
}

beforeEach(() => {
  tmp = realpathSync(mkdtempSync(join(tmpdir(), 'dflow-dialect-')))
  repo = join(tmp, 'repo'); bin = join(tmp, 'bin'); heavyDir = join(tmp, 'heavy'); marks = join(tmp, 'marks')
  mkdirSync(bin); mkdirSync(marks)
  // 가짜 docker: DOCKER_UP 파일이 있으면 켜진 것. 켜는 명령(start 등)이 불리면 기록해 둔다(불리면 안 된다)
  writeFileSync(join(bin, 'docker'), `#!/bin/sh\necho "$*" >> '${marks}/docker-calls'\n[ "$1" = info ] && [ -f '${marks}/DOCKER_UP' ]\n`, { mode: 0o755 })
  writeFileSync(join(marks, 'DOCKER_UP'), '')
  const r = sh(tmp, `
    set -e
    git init -q --bare -b dev origin.git
    git clone -q origin.git repo 2>/dev/null
    cd repo && git checkout -q -b dev
    mkdir -p src/backend/mdm && printf 'x\\n' > src/backend/mdm/.keep && printf '#!/bin/sh\\necho "gradlew $* JAVA_HOME=$JAVA_HOME pwd=$(pwd)"\\n' > src/backend/gradlew && chmod +x src/backend/gradlew
    printf 'base\\n' > README.md && git add . && git commit -qm base && git push -q origin dev
    git switch -q --detach origin/dev
  `)
  expect(r.code, r.err).toBe(0)
})
afterEach(() => { rmSync(tmp, { recursive: true, force: true }) })

// 명령: 워크트리 경로·HEAD·도커 슬롯 보유를 기록하고, FAIL 파일이 있으면 실패한다
const CMD = `echo "$(pwd) $(git rev-parse HEAD) held=$DFLOW_HEAVY_DOCKER_HELD" >> '__M__/runs'; [ ! -f '__M__/FAIL' ]`

describe('dialect-check.sh — 스윕 끝 방언 검증', { timeout: 60000 }, () => {
  it('bash 로 파싱되고 실행 권한이 있다', () => {
    expect(spawnSync('bash', ['-n', SCRIPT]).status).toBe(0)
    expect(spawnSync('test', ['-x', SCRIPT]).status).toBe(0)
  })

  it('dialect_check 키가 없으면 이 단계는 없다(DIALECT_NONE, 도커도 보지 않는다)', () => {
    setConfig('')
    const r = run()
    expect(r.code, r.err).toBe(0)
    expect(last(r.out)).toBe('DIALECT_NONE')
    expect(existsSync(join(marks, 'docker-calls'))).toBe(false)
  })

  it('끝 커밋을 깨끗한 임시 워크트리에서 도커 슬롯을 잡고 한 번 돌리고, 같은 커밋은 다시 돌리지 않는다', () => {
    setConfig(CMD.replaceAll('__M__', marks))
    const tip = mergeTask('TSK-01-01')
    const r = run()
    expect(r.code, r.out + r.err).toBe(0)
    expect(last(r.out)).toMatch(new RegExp(`^DIALECT_PASS ${tip.slice(0, 12)} since=- tasks=- unverified=-$`))
    const line = readFileSync(join(marks, 'runs'), 'utf8').trim()
    const [wt, head, held] = line.split(' ')
    expect(head).toBe(tip)
    expect(wt).toContain(join(repo, '.claude/worktrees/dflow-dialect-'))
    expect(held).toBe(`held=${join(heavyDir, 'docker-1')}`)
    expect(existsSync(wt)).toBe(false) // 임시 워크트리는 지운다
    expect(existsSync(join(heavyDir, 'docker-1'))).toBe(false) // 슬롯도 푼다
    // 호출한 체크아웃은 그대로다(HEAD 는 mergeTask 가 옮긴 origin/dev, 추적 파일 변경 없음)
    expect(sh(repo, 'git status --porcelain --untracked-files=no').out).toBe('')
    expect(sh(repo, 'git worktree list').out.trim().split('\n')).toHaveLength(1)
    // 두 번째 스윕: 같은 커밋이면 돌리지 않는다
    const r2 = run()
    expect(last(r2.out)).toBe(`DIALECT_SKIP passed ${tip.slice(0, 12)}`)
    expect(count()).toBe(1)
    expect(last(sh(repo, 'bash "$S" status --dev dev').out)).toMatch(/^DIALECT_PASS /)
  })

  it('실패하면 직전 통과 이후 머지된 Task 와 도커 금지로 확인하지 못한 Task 를 적고 기록한다. 되돌리지 않는다', () => {
    setConfig(CMD.replaceAll('__M__', marks))
    const passed = mergeTask('TSK-01-01')
    expect(run().code).toBe(0)
    mergeTask('TSK-02-01', '## 도커 금지로 생략한 검증\\n- 금지 모드 출처: 워커 기본\\n- 도커 금지로 생략: ./gradlew mssqlMigrationTest\\n- 확인하지 못한 수용 기준: MSSQL 방언 — ./gradlew mssqlMigrationTest\\n')
    const tip = mergeTask('TSK-02-02')
    writeFileSync(join(marks, 'FAIL'), '')
    const r = run()
    expect(r.code).toBe(1)
    const lines = r.out.trim().split('\n')
    expect(lines).toContain('DIALECT_UNVERIFIED TSK-02-01 생략=1 미확인=1 docs/tasks/TSK-02-01/design.md')
    expect(last(r.out)).toMatch(new RegExp(
      `^DIALECT_FAIL ${tip.slice(0, 12)} exit=1 since=${passed.slice(0, 12)} tasks=TSK-02-01,TSK-02-02 unverified=TSK-02-01 log=.+/dflow-dialect/dev\\.log$`))
    // 개발 브랜치는 그대로(자동 되돌리기 없음)
    expect(sh(repo, 'git rev-parse origin/dev').out.trim()).toBe(tip)
    // 같은 실패 커밋은 다음 스윕에서 다시 돌리지 않는다(이미 보고했다)
    const r2 = run()
    expect(last(r2.out)).toBe(`DIALECT_SKIP failed ${tip.slice(0, 12)}`)
    expect(count()).toBe(2)
    expect(last(sh(repo, 'bash "$S" status --dev dev').out)).toMatch(/^DIALECT_FAIL /)
    // 고친 뒤 새 머지가 오면 다시 돌고, since 는 여전히 마지막 통과 커밋이다
    rmSync(join(marks, 'FAIL'))
    const fixed = mergeTask('TSK-02-03')
    const r3 = run()
    expect(last(r3.out)).toMatch(new RegExp(`^DIALECT_PASS ${fixed.slice(0, 12)} since=${passed.slice(0, 12)} tasks=TSK-02-01,TSK-02-02,TSK-02-03 unverified=TSK-02-01$`))
  })

  it('처음 도는 스윕은 --sweep-base 이후 머지된 Task 를 적는다', () => {
    setConfig(CMD.replaceAll('__M__', marks))
    const base = sh(repo, 'git rev-parse origin/dev').out.trim()
    mergeTask('TSK-03-01')
    const r = run({}, `--sweep-base ${base}`)
    expect(last(r.out)).toMatch(new RegExp(`since=${base.slice(0, 12)} tasks=TSK-03-01 unverified=-$`))
  })

  // 문서뿐 이월 — 직전 통과 이후 바뀐 파일이 문서뿐이면 끝 커밋의 코드는 이미 통과한 트리와 같다. 돌리지 않고 다음 스윕으로
  // 넘긴다. last_pass 는 옮기지 않아 다음 실제 검증의 since·tasks·unverified 가 이월분을 포함한다.
  const UNV = '## 도커 금지로 생략한 검증\\n- 도커 금지로 생략: ./gradlew mssqlMigrationTest\\n'
  it('직전 통과 이후 문서만 바뀌었으면 돌리지 않고 이월한다(DIALECT_SKIP docs-only, last_pass 는 그대로)', () => {
    setConfig(CMD.replaceAll('__M__', marks), `project_map=mod/docs=u-1\n`)
    const passed = mergeTask('TSK-11-01')
    expect(run().code).toBe(0)
    // *.md · docs/** · 작업 폴더(tasks-dirs 의 <폴더>/<TSK>/) 의 state.json 등은 문서로 본다
    const tip = mergeTask('TSK-11-02', UNV, { docsOnly: true, files: {
      'README.md': 'x', 'mod/guide.md': 'x', 'docs/설계 메모.txt': 'x', '안내.md': 'x', 'mod/docs/tasks/TSK-11-02/state.json': '{}', 'mod/docs/tasks/TSK-11-02/decisions.json': '[]' } })
    const r = run()
    expect(r.code, r.out + r.err).toBe(0)
    expect(r.out.trim()).toBe(`DIALECT_SKIP docs-only ${tip.slice(0, 12)} since=${passed.slice(0, 12)}`)
    expect(count()).toBe(1)
    expect(existsSync(join(marks, 'docker-calls')) && readFileSync(join(marks, 'docker-calls'), 'utf8').trim().split('\n').length).toBe(1)
    const gd = sh(repo, 'cd "$(git rev-parse --git-common-dir)" && pwd').out.trim()
    const st = readFileSync(join(gd, 'dflow-dialect', 'dev.state'), 'utf8')
    expect(st).toContain(`last_pass=${passed}\n`)
    expect(st).toContain(`docs_only=${tip}\n`)
    // 상태 조회는 마지막 실제 판정을 그대로 낸다(이월 줄로 덮지 않는다)
    expect(last(sh(repo, 'bash "$S" status --dev dev').out)).toMatch(new RegExp(`^DIALECT_PASS ${passed.slice(0, 12)} `))
  })

  it('작업 폴더라도 목록 밖 파일(스크립트 등)이나 문서 폴더 밖 코드가 바뀌었으면 돌린다', () => {
    setConfig(CMD.replaceAll('__M__', marks), `project_map=mod/docs=u-1\n`)
    mergeTask('TSK-12-01')
    expect(run().code).toBe(0)
    mergeTask('TSK-12-02', '', { docsOnly: true, files: { 'mod/docs/tasks/TSK-12-02/fix.sql': 'select 1' } })
    expect(last(run().out)).toMatch(/^DIALECT_PASS /)
    mergeTask('TSK-12-03', UNV) // 문서와 코드(src/)가 함께 바뀐 Task
    expect(last(run().out)).toMatch(/^DIALECT_PASS /)
    expect(count()).toBe(3)
  })

  it('이월한 뒤 코드가 바뀌면 since 는 이월 전 통과 커밋이고 tasks·unverified 에 이월분이 쌓인다', () => {
    setConfig(CMD.replaceAll('__M__', marks))
    const passed = mergeTask('TSK-13-01')
    expect(run().code).toBe(0)
    mergeTask('TSK-13-02', UNV, { docsOnly: true })
    expect(last(run().out)).toMatch(/^DIALECT_SKIP docs-only /)
    const tip = mergeTask('TSK-13-03')
    const r = run()
    expect(r.code, r.out + r.err).toBe(0)
    expect(r.out.trim().split('\n')).toContain('DIALECT_UNVERIFIED TSK-13-02 생략=1 미확인=0 docs/tasks/TSK-13-02/design.md')
    expect(last(r.out)).toBe(
      `DIALECT_PASS ${tip.slice(0, 12)} since=${passed.slice(0, 12)} tasks=TSK-13-02,TSK-13-03 unverified=TSK-13-02`)
    expect(count()).toBe(2)
  })

  it('기준을 못 믿거나 diff 를 못 구하면 문서뿐으로 보지 않고 돌린다(fail-closed)', () => {
    setConfig(CMD.replaceAll('__M__', marks))
    // 통과 기록이 없으면 since 는 --sweep-base 다. 그 트리는 판정받은 적이 없으므로(보류·BUSY·오류로 남은 코드일 수 있다) 돌린다
    const base = sh(repo, 'git rev-parse origin/dev').out.trim()
    mergeTask('TSK-14-01', '', { docsOnly: true })
    expect(last(run({}, `--sweep-base ${base}`).out)).toMatch(new RegExp(`^DIALECT_PASS [0-9a-f]{12} since=${base.slice(0, 12)} `))
    // 통과 커밋이 이 리포에 없어 diff 를 못 구한다
    const gd = sh(repo, 'cd "$(git rev-parse --git-common-dir)" && pwd').out.trim()
    writeFileSync(join(gd, 'dflow-dialect', 'dev.state'), `last_pass=${'d'.repeat(40)}\n`)
    mergeTask('TSK-14-02', '', { docsOnly: true })
    expect(last(run().out)).toMatch(/^DIALECT_PASS [0-9a-f]{12} since=dddddddddddd tasks=\? unverified=\?$/)
    expect(count()).toBe(2)
  })

  it('코드 파일을 문서 폴더로 옮긴 것은 문서뿐이 아니다(이름 바뀜을 옛 경로까지 본다)', () => {
    setConfig(CMD.replaceAll('__M__', marks))
    mergeTask('TSK-15-01')
    expect(run().code).toBe(0)
    const r = sh(repo, `
      set -e
      git switch -q dev && git reset -q --hard origin/dev
      mkdir -p docs/old && git mv src/TSK-15-01.txt docs/old/TSK-15-01.txt && git commit -qm "옮김"
      git push -q origin dev && git switch -q --detach origin/dev
    `)
    expect(r.code, r.err).toBe(0)
    expect(last(run().out)).toMatch(/^DIALECT_PASS /)
    expect(count()).toBe(2)
  })

  it('도커가 꺼져 있으면 켜지 않고 보류로 기록한다. 알림은 처음 한 번, 켜지면 다음 스윕이 같은 커밋을 돌린다', () => {
    setConfig(CMD.replaceAll('__M__', marks))
    const tip = mergeTask('TSK-04-01')
    rmSync(join(marks, 'DOCKER_UP'))
    const r = run()
    expect(r.code).toBe(3)
    expect(last(r.out)).toBe(`DIALECT_DEFERRED docker-off ${tip.slice(0, 12)} notify=1`)
    expect(last(run().out)).toBe(`DIALECT_DEFERRED docker-off ${tip.slice(0, 12)} notify=0`)
    expect(count()).toBe(0)
    // docker 는 info 로만 불렸다(start 류 없음)
    expect(readFileSync(join(marks, 'docker-calls'), 'utf8').trim().split('\n').every((l) => l === 'info')).toBe(true)
    expect(sh(repo, 'bash "$S" status --dev dev').out).toContain(`DIALECT_PENDING deferred ${tip.slice(0, 12)}`)
    writeFileSync(join(marks, 'DOCKER_UP'), '')
    const r2 = run()
    expect(last(r2.out)).toMatch(new RegExp(`^DIALECT_PASS ${tip.slice(0, 12)} `))
    expect(count()).toBe(1)
  })

  it('도커 슬롯이 차 있으면 돌리지 않고 DIALECT_BUSY(exit 75)로 끝내며 판정으로 기록하지 않는다', () => {
    setConfig(CMD.replaceAll('__M__', marks))
    const tip = mergeTask('TSK-05-01')
    mkdirSync(join(heavyDir, 'docker-1'), { recursive: true })
    writeFileSync(join(heavyDir, 'docker-1', 'owner'), `pid=${process.pid}\nkind=run\nstart=1\npstart=-\ncmd=other\n`)
    const r = run({ DFLOW_HEAVY_WAIT: '0' })
    expect(r.code).toBe(75)
    expect(last(r.out)).toBe(`DIALECT_BUSY ${tip.slice(0, 12)}`)
    expect(count()).toBe(0)
    rmSync(join(heavyDir, 'docker-1'), { recursive: true })
    expect(last(run().out)).toMatch(/^DIALECT_PASS /)
  })

  it('cd 와 환경변수 대입이 든 명령(PC 전용 JAVA_HOME)을 .dflow.local 이 .dflow 를 덮어 그대로 bash -c 로 돌린다', () => {
    setConfig('./gradlew mssqlMigrationTest',
      `dialect_check=cd src/backend/mdm && JAVA_HOME=/opt/jdk21 ../gradlew :api:mssqlMigrationTest --no-daemon --console=plain > '${marks}/gradle.out'\n`)
    mergeTask('TSK-06-01')
    const r = run()
    expect(r.code, r.out + r.err).toBe(0)
    const out = readFileSync(join(marks, 'gradle.out'), 'utf8')
    expect(out).toMatch(/^gradlew :api:mssqlMigrationTest --no-daemon --console=plain JAVA_HOME=\/opt\/jdk21 pwd=.+\/\.claude\/worktrees\/dflow-dialect-\d+\/src\/backend\/mdm$/m)
  })

  it('명령 없음(127)·시그널로 죽음(137)은 실패로 기록하지 않고(DIALECT_ERROR) 다음 스윕이 같은 커밋을 다시 돌린다', () => {
    const tip = mergeTask('TSK-08-01')
    for (const [cmd, rc] of [['no-such-gradlew mssqlMigrationTest', 127], ['kill -9 $$', 137]] as const) {
      setConfig(cmd)
      const r = run()
      expect(r.code, r.out + r.err).toBe(2)
      expect(last(r.out)).toMatch(new RegExp(`^DIALECT_ERROR exit=${rc} ${tip.slice(0, 12)} notify=[01] log=.+/dflow-dialect/dev\\.log$`))
    }
    // 같은 커밋의 두 번째 오류는 알리지 않는다
    expect(last(run().out)).toMatch(/notify=0 /)
    // 명령을 고치면 같은 커밋을 돌린다(실패로 기록되지 않았으므로 SKIP 이 아니다)
    setConfig(CMD.replaceAll('__M__', marks))
    expect(last(run().out)).toMatch(new RegExp(`^DIALECT_PASS ${tip.slice(0, 12)} `))
  })

  it('죽은 앞 호출이 남긴 임시 워크트리를 치운다', () => {
    setConfig(CMD.replaceAll('__M__', marks))
    const dead = spawnSync('sh', ['-c', 'echo $$']).stdout.toString().trim()
    const left = join(repo, '.claude/worktrees', `dflow-dialect-${dead}`)
    expect(sh(repo, `git worktree add -q --detach '${left}' origin/dev`).code).toBe(0)
    mergeTask('TSK-09-01')
    expect(last(run().out)).toMatch(/^DIALECT_PASS /)
    expect(existsSync(left)).toBe(false)
    expect(sh(repo, 'git worktree list').out.trim().split('\n')).toHaveLength(1)
  })

  it('같은 브랜치의 검증이 아직 돌고 있으면 두 번째 호출은 돌리지 않는다', () => {
    setConfig(CMD.replaceAll('__M__', marks))
    mergeTask('TSK-07-01')
    const gd = sh(repo, 'cd "$(git rev-parse --git-common-dir)" && pwd').out.trim()
    mkdirSync(join(gd, 'dflow-dialect', 'dev.lock'), { recursive: true })
    writeFileSync(join(gd, 'dflow-dialect', 'dev.lock', 'owner'), `pid=${process.pid}\n`)
    expect(last(run().out)).toMatch(new RegExp(`^DIALECT_RUNNING [0-9a-f]{12} pid=${process.pid}$`))
    expect(count()).toBe(0)
  })
})

describe('방언 검증 문서 계약', () => {
  it('/dflow-merge 에 「방언 검증」 절이 있고 스윕 끝에 한 번만, --resolve 는 제외다', () => {
    const sec = MERGE.slice(MERGE.indexOf('## 방언 검증'), MERGE.indexOf('## 결정 번호 매김'))
    expect(MERGE).toContain('## 방언 검증')
    expect(sec).toContain('`references/dialect.md` 를 읽고')
    expect(DIALECT).toContain('.claude/skills/dflow-merge/scripts/dialect-check.sh run --dev <기본브랜치> --sweep-base <스윕 전 sha>')
    expect(sec).toContain('머지마다 돌리지 않는다')
    expect(sec).toContain('`--resolve` 는 이 절을 타지 않는다')
    expect(sec).toContain('도커 런타임을 켜지 않는다')
    expect(MERGE).toContain('「방언 검증」 을 한 번 돈다')
  })
  it('팀장 승인 스윕이 실패·보류를 issues.md 와 team.issue(decision 은 pending 아님)로 기록하고 사람에게 알린다', () => {
    const sweep = TEAM.slice(TEAM.indexOf('## 4. 승인 스윕'), TEAM.indexOf('### 4-1. 머지 충돌 해소'))
    expect(sweep).toContain('**방언 검증**')
    expect(sweep).toContain('`DIALECT_FAIL`')
    expect(sweep).toContain('`DIALECT_DEFERRED docker-off … notify=1`')
    expect(sweep).toContain('팀장은 도커 런타임을 켜지 않는다')
    expect(sweep).toContain('`docs/dflow-team/issues.md`')
    expect(sweep).toContain("id8 는 `dialect`")
    expect(sweep).toContain('`pending` 으로 쓰지 않는다')
    expect(sweep).toContain('자동으로 되돌리거나 Task 를 재오픈하지 않는다')
    expect(sweep).toContain('`DIALECT_ERROR`')
    const events = readFileSync(join(ROOT, '.claude/skills/dflow-team/references/events.md'), 'utf8')
    expect(events).toContain('id8 가 `dialect` 인 줄은 팀원 이슈가 아니라 방언 검증 기록이다')
  })
  it('문서뿐 이월(DIALECT_SKIP docs-only)은 보고에 싣지 않는 줄이다(merge 보고·팀장 처리 모두)', () => {
    expect(DIALECT).toContain('`DIALECT_SKIP docs-only <sha> since=<직전 통과>`')
    expect(MERGE).toContain('결과 줄(`DIALECT_*`, `DIALECT_SKIP` 제외)과 `DIALECT_UNVERIFIED` 줄을 표 아래에 그대로 싣는다')
    expect(TEAM).toMatch(/`DIALECT_BUSY`·`DIALECT_RUNNING`·`DIALECT_SKIP`·`DIALECT_NONE`: 보고하지 않는다/)
  })
  it('/dflow-merge 는 실행 불가·시그널 exit 를 실패로 기록하지 않는다고 적는다', () => {
    expect(DIALECT).toContain('exit 126·127·128 이상')
    expect(DIALECT).toContain('`DIALECT_ERROR exit=<n> <sha> notify=<0|1> log=<로그>`')
  })
  it('예시 설정에 dialect_check 가 있고, PC 전용 값은 .dflow.local 에 두라고 안내한다', () => {
    expect(EXAMPLE).toContain('# dialect_check=')
    expect(LOCAL_EXAMPLE).toContain('# dialect_check=')
    expect(LOCAL_EXAMPLE).toContain('PC 전용 값(JAVA_HOME 등)이 든 명령은 .dflow.local 에 둔다')
  })
})
