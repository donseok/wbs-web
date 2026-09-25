// tests/skills/dflow-sweep-check.test.ts
// 스윕 사전 검사(2026-09-24 실측: 팀장 스윕 38회 중 20회가 머지 0건인데 매번 /dflow-merge 61KB 를 문맥에 다시 실었다).
// dflow-merge/scripts/sweep-check.sh 가 후보 유무를 서버 조회 없이 판정한다. 실제 git 샌드박스(bare origin + 팀장
// 체크아웃)에서 확인하고, 후보 정의가 정본(/dflow-merge 「절차」 1번의 두 셸 블록)과 어긋나지 않는지 대조한다.
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const ROOT = process.cwd()
const SCRIPT = join(ROOT, '.claude/skills/dflow-merge/scripts/sweep-check.sh')
const MERGE = readFileSync(join(ROOT, '.claude/skills/dflow-merge/SKILL.md'), 'utf8')
const TEAM = readFileSync(join(ROOT, '.claude/skills/dflow-team/SKILL.md'), 'utf8')
const MC = readFileSync(join(ROOT, '.claude/skills/dflow-team/references/merge-conflict.md'), 'utf8')
const API = 'https://example.test'

const BASE_ENV: Record<string, string | undefined> = {
  ...process.env,
  GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t',
  GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1',
}
for (const k of Object.keys(BASE_ENV)) if (k.startsWith('DFLOW_') || k === 'CLAUDE_PID') delete BASE_ENV[k]

let tmp: string, repo: string
function sh(cwd: string, script: string, env: Record<string, string> = {}) {
  const r = spawnSync('bash', ['-c', script], { cwd, encoding: 'utf8', timeout: 60000, env: { ...BASE_ENV, S: SCRIPT, ...env } })
  return { code: r.status, out: r.stdout || '', err: r.stderr || '' }
}
const check = (env: Record<string, string> = {}) => sh(repo, 'bash "$S"', env)
const last = (out: string) => out.trim().split('\n').at(-1) ?? ''
const ok = (r: { code: number | null; err: string; out: string }) => expect(r.code, r.out + r.err).toBe(0)
const state = (tsk: string, order: string, phase: string, extra: Record<string, unknown> = {}) =>
  JSON.stringify({ tsk, order, api_base: API, phase, ...extra })

function setConfig(extra = '') {
  writeFileSync(join(repo, '.dflow'), `api_base=${API}\nproject_id=p\n${extra}`)
  writeFileSync(join(repo, '.dflow.local'), 'pats=\ndev_branch=dev\n')
}
// origin 에 agent/<id8>-x 브랜치를 올린다(개발 브랜치 끝에서 따서 그 Task 의 state.json 을 커밋)
function pushAgent(id8: string, tsk: string, json: string) {
  ok(sh(repo, `
    set -e
    git fetch -q origin && git switch -q -c agent/${id8}-x origin/dev
    mkdir -p docs/tasks/${tsk} && printf '%s\\n' '${json}' > docs/tasks/${tsk}/state.json
    git add docs && git commit -qm "${tsk}" && git push -q origin agent/${id8}-x
    git switch -q --detach origin/dev && git branch -q -D agent/${id8}-x
  `))
}
// 개발 브랜치에 state.json 을 커밋해 올린다(머지된 결과처럼). stay=false 면 팀장 체크아웃은 옛 커밋에 둔다
function pushDev(tsk: string, json: string, stay = true) {
  ok(sh(repo, `
    set -e
    git fetch -q origin && git switch -q --detach origin/dev
    mkdir -p docs/tasks/${tsk} && printf '%s\\n' '${json}' > docs/tasks/${tsk}/state.json
    git add docs && git commit -qm "merge ${tsk}" && git push -q origin HEAD:dev
    ${stay ? 'git switch -q --detach origin/dev' : 'git switch -q --detach HEAD~1'}
  `))
}

beforeEach(() => {
  tmp = realpathSync(mkdtempSync(join(tmpdir(), 'dflow-sweep-')))
  repo = join(tmp, 'repo')
  ok(sh(tmp, `
    set -e
    git init -q --bare -b dev origin.git
    git clone -q origin.git repo 2>/dev/null
    cd repo && git checkout -q -b dev
    printf '.dflow.local\\n.claude/\\n' > .gitignore && printf 'base\\n' > README.md
    git add . && git commit -qm base && git push -q origin dev
    git switch -q --detach origin/dev
  `))
  setConfig()
  // 정본 블록이 부르는 상대경로(.claude/skills/dflow-work/scripts/dflow.sh)를 살린다
  mkdirSync(join(repo, '.claude'))
  symlinkSync(join(ROOT, '.claude/skills'), join(repo, '.claude/skills'))
})
afterEach(() => { rmSync(tmp, { recursive: true, force: true }) })

describe('sweep-check.sh — 스윕 후보 사전 검사', { timeout: 60000 }, () => {
  it('bash 로 파싱되고 실행 권한이 있다', () => {
    expect(spawnSync('bash', ['-n', SCRIPT]).status).toBe(0)
    expect(spawnSync('test', ['-x', SCRIPT]).status).toBe(0)
  })

  it('후보가 없으면 SWEEP_NONE(exit 0) — 머지된·승인 반영된 state.json 은 후보가 아니다', () => {
    pushDev('TSK-01-01', state('TSK-01-01', 'aaaaaaaa-0000', 'merged'))
    pushAgent('bbbbbbbb', 'TSK-01-02', state('TSK-01-02', 'bbbbbbbb-0000', 'merged'))
    const r = check()
    ok(r)
    expect(last(r.out)).toBe('SWEEP_NONE')
  })

  it('로컬 reported 와 merged+unapproved 는 후보다', () => {
    pushDev('TSK-01-01', state('TSK-01-01', 'aaaaaaaa-0000', 'reported'))
    pushDev('TSK-01-02', state('TSK-01-02', 'cccccccc-0000', 'merged', { unapproved: true }))
    const r = check()
    ok(r)
    expect(last(r.out)).toBe('SWEEP_CANDIDATES n=2 aaaaaaaa cccccccc')
  })

  it('팀장 체크아웃이 뒤처져 있어도 origin/<dev> 의 승인 전 머지분을 후보로 낸다(해소 워커 --on-report)', () => {
    pushDev('TSK-01-01', state('TSK-01-01', 'dddddddd-0000', 'merged', { unapproved: true }), false)
    expect(sh(repo, 'test -e docs/tasks/TSK-01-01/state.json').code).not.toBe(0) // 작업 트리에는 없다
    const r = check()
    ok(r)
    expect(last(r.out)).toBe('SWEEP_CANDIDATES n=1 dddddddd')
  })

  it('원격 agent 브랜치: merged 가 아니고 api_base 가 같으면 후보, 다르거나 없거나 id8 이 어긋나면 아니다', () => {
    pushAgent('eeeeeeee', 'TSK-02-01', state('TSK-02-01', 'eeeeeeee-0000', 'verify'))
    pushAgent('ffffffff', 'TSK-02-02', JSON.stringify({ tsk: 'TSK-02-02', order: 'ffffffff-0000', api_base: 'https://other.test', phase: 'reported' }))
    pushAgent('11111111', 'TSK-02-03', JSON.stringify({ tsk: 'TSK-02-03', order: '11111111-0000', phase: 'reported' }))
    pushAgent('22222222', 'TSK-02-04', state('TSK-02-04', '99999999-0000', 'reported'))
    const r = check()
    ok(r)
    expect(last(r.out)).toBe('SWEEP_CANDIDATES n=1 eeeeeeee')
  })

  it('개발 브랜치에 이미 머지된 agent 브랜치(차분에 state.json 없음)는 후보가 아니다', () => {
    pushAgent('33333333', 'TSK-03-01', state('TSK-03-01', '33333333-0000', 'reported'))
    ok(sh(repo, `
      set -e
      git fetch -q origin && git switch -q --detach origin/dev
      git merge -q --no-ff origin/agent/33333333-x -m "merge: TSK-03-01"
      printf '%s\\n' '${state('TSK-03-01', '33333333-0000', 'merged')}' > docs/tasks/TSK-03-01/state.json
      git add docs && git commit -qm merged && git push -q origin HEAD:dev && git switch -q --detach origin/dev
    `))
    // 원격 브랜치가 남아 있어도 그 tip 의 state.json 은 dev 에 이미 들어 있어 3점 차분에 나오지 않는다
    const r = check()
    ok(r)
    expect(last(r.out)).toBe('SWEEP_NONE')
  })

  it('fetch 가 실패하면 SWEEP_UNKNOWN(exit 0) — 호출자는 스윕을 돌린다', () => {
    ok(sh(repo, 'git remote set-url origin /nonexistent/origin.git'))
    const r = check()
    ok(r)
    expect(last(r.out)).toMatch(/^SWEEP_UNKNOWN git fetch 실패/)
  })

  it('설정을 읽지 못하면(api_base 없음·dflow.sh 실패) SWEEP_UNKNOWN', () => {
    writeFileSync(join(repo, '.dflow'), 'project_id=p\n')
    expect(last(check().out)).toMatch(/^SWEEP_UNKNOWN /)
    setConfig()
    const fake = join(tmp, 'fake-dflow.sh')
    writeFileSync(fake, '#!/bin/sh\nexit 3\n', { mode: 0o755 })
    expect(last(check({ DFLOW_SH: fake }).out)).toMatch(/^SWEEP_UNKNOWN /)
  })

  it('state.json 이 깨져 읽지 못하면 SWEEP_UNKNOWN(조용히 0건으로 만들지 않는다)', () => {
    pushAgent('44444444', 'TSK-04-01', '{not json')
    const r = check()
    ok(r)
    expect(last(r.out)).toMatch(/^SWEEP_UNKNOWN state\.json 을 읽지 못했다/)
  })

  it('방언 검증이 끝 커밋을 아직 판정하지 않았으면 SWEEP_DIALECT_PENDING 을 판정 줄 앞에 낸다', () => {
    setConfig('dialect_check=true\n')
    let r = check()
    ok(r)
    const tip = sh(repo, 'git rev-parse origin/dev').out.trim()
    expect(r.out.trim().split('\n')).toEqual([`SWEEP_DIALECT_PENDING ${tip.slice(0, 12)}`, 'SWEEP_NONE'])
    const sd = join(repo, '.git/dflow-dialect')
    mkdirSync(sd, { recursive: true })
    writeFileSync(join(sd, 'dev.state'), `last_pass=${tip}\n`)
    r = check()
    expect(r.out.trim()).toBe('SWEEP_NONE')
    setConfig()
    expect(check().out.trim()).toBe('SWEEP_NONE') // 키가 없으면 방언 검증도 없다
  })
})

// 정본 대조: /dflow-merge 「절차」 1번의 원격·로컬 스캔 블록을 같은 샌드박스에서 돌려 후보를 구하고(중복 제거 → api_base
// 필터까지 정본 문장대로), sweep-check.sh 의 후보가 그것을 모두 포함하는지 본다. 뒤처진 체크아웃이 없으면 같아야 한다.
function canonBlock(marker: string) {
  const re = /^( *)```bash\n([\s\S]*?)^\1```/gm
  let m: RegExpExecArray | null
  while ((m = re.exec(MERGE))) {
    if (m[2].includes(marker)) return m[2].split('\n').map((l) => l.slice(m![1].length)).join('\n').replaceAll('<기본브랜치>', 'dev')
  }
  throw new Error(`정본 블록 없음: ${marker}`)
}
function canonCandidates(): string[] {
  const remote = sh(repo, canonBlock("git branch -r --list 'origin/agent/*'"))
  const local = sh(repo, canonBlock('select(.phase == "reported" or (.phase == "merged" and .unapproved == true))'))
  ok(remote); ok(local)
  const rows = (out: string, orderCol: number, clsCol: number) =>
    out.trim().split('\n').filter(Boolean).map((l) => { const c = l.split('\t'); return { order: c[orderCol], cls: c[clsCol] } })
  const L = rows(local.out, 2, 4), R = rows(remote.out, 2, 4)
  const out = new Set<string>()
  for (const o of new Set([...L, ...R].map((x) => x.order))) {
    const l = L.filter((x) => x.order === o), r = R.filter((x) => x.order === o)
    if (l.length) {
      const vals = [...l, ...r].map((x) => x.cls).filter((c) => c !== 'none')
      if (new Set(vals).size > 1) continue // 둘 다 값이 있는데 서로 다르면 건너뜀(다른 D'Flow)
      if (vals.length === 0 || vals[0] === 'same') out.add(o.slice(0, 8))
    } else if (r.some((x) => x.cls === 'same')) out.add(o.slice(0, 8))
  }
  return [...out].sort()
}
const sweepIds = (out: string) => {
  const l = last(out)
  return l === 'SWEEP_NONE' ? [] : l.replace(/^SWEEP_CANDIDATES n=\d+ /, '').split(' ').sort()
}

describe('sweep-check.sh 후보 = /dflow-merge 「절차」 1번 정본(드리프트 방지)', { timeout: 60000 }, () => {
  it('섞인 샌드박스에서 정본 블록과 같은 후보를 낸다', () => {
    pushDev('TSK-01-01', state('TSK-01-01', 'aaaaaaaa-0000', 'reported'))
    pushDev('TSK-01-02', state('TSK-01-02', 'cccccccc-0000', 'merged', { unapproved: true }))
    pushDev('TSK-01-03', state('TSK-01-03', '55555555-0000', 'merged'))
    pushAgent('eeeeeeee', 'TSK-02-01', state('TSK-02-01', 'eeeeeeee-0000', 'reported'))
    pushAgent('ffffffff', 'TSK-02-02', JSON.stringify({ tsk: 'TSK-02-02', order: 'ffffffff-0000', api_base: 'https://other.test', phase: 'reported' }))
    pushAgent('11111111', 'TSK-02-03', JSON.stringify({ tsk: 'TSK-02-03', order: '11111111-0000', phase: 'verify' }))
    pushAgent('66666666', 'TSK-02-05', state('TSK-02-05', '66666666-0000', 'merged'))
    const canon = canonCandidates()
    expect(canon).toEqual(['aaaaaaaa', 'cccccccc', 'eeeeeeee'])
    expect(sweepIds(check().out)).toEqual(canon)
  })

  it('빈 샌드박스에서는 둘 다 0건', () => {
    expect(canonCandidates()).toEqual([])
    expect(last(check().out)).toBe('SWEEP_NONE')
  })

  it('정본이 sweep-check.sh 를 가리키고, 팀장 스윕 규칙이 그것을 쓴다', () => {
    expect(MERGE).toContain('scripts/sweep-check.sh')
    // 정본(셸 블록)은 SKILL 에 두고, 스크립트는 출력 계약만 적는다. 호출자(dflow-team 「4-0」·dflow-dev 01-가)가 이 글자를 본다
    const s1 = MERGE.slice(MERGE.indexOf('1. **후보 식별**'), MERGE.indexOf('2. **판정'))
    expect(s1).toContain('**정본은 이 두 셸 블록이다**')
    for (const k of ['`SWEEP_CANDIDATES n=<N> <id8…>`', '`SWEEP_NONE`', '`SWEEP_UNKNOWN <사유>`', '`SWEEP_DIALECT_PENDING <sha>`'])
      expect(s1, k).toContain(k)
    expect(TEAM).toContain('.claude/skills/dflow-merge/scripts/sweep-check.sh')
    expect(TEAM).toContain('`SWEEP_NONE`')
    expect(TEAM).toContain('`SWEEP_UNKNOWN <사유>`')
    expect(TEAM).toContain('### 4-0. 스윕을 부르는 규칙')
    expect(MC).toContain('「4-0. 스윕을 부르는 규칙」')
  })
})
