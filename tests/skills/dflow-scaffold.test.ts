// 작업 폴더 scaffold·taskdir·spec 캐시 경로(docs/superpowers/specs/2026-09-23-dflow-task-scaffold-design.md).
// dflow.sh 를 가짜 curl 로 실제 실행한다. 응답 본문은 env(MINE_BODY·SHOW_BODY·CLAIM_BODY)로 주입한다.
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const DFLOW = join(process.cwd(), '.claude/skills/dflow-work/scripts/dflow.sh')
const TOKEN = `dflow_pat_AAAAAAAAAAAA_${'x'.repeat(24)}`
const P1 = '11111111-1111-4111-8111-111111111111'
const P2 = '22222222-2222-4222-8222-222222222222'
const PX = '99999999-9999-4999-8999-000000000000'
const O1 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'
const O2 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2'
const O3 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3'

const FAKE_CURL = `#!/bin/sh
out=''; url=''
while [ $# -gt 0 ]; do
  case "$1" in -o) out="$2"; shift 2 ;; -X|-H|-w|--data) shift 2 ;; -sS) shift ;; *) url="$1"; shift ;; esac
done
[ -n "\${CURL_LOG:-}" ] && printf '%s\n' "$url" >> "$CURL_LOG"
case "$url" in
  *"/agent/work/mine"*) printf '%s' "$MINE_BODY" > "$out" ;;
  *"/claim") printf '%s' "$CLAIM_BODY" > "$out" ;;
  *"/agent/work/"*) printf '%s' "$SHOW_BODY" > "$out" ;;
  *) printf '{}' > "$out" ;;
esac
printf 200
`
const order = (id: string, pid: string, ref: string | null) =>
  ({ id, project_id: pid, status: 'ready', priority: 0, item: { id: 'w', code: '1', name: 't', external_ref: ref } })

let tmp: string; let repo: string; let bare: string
function run(args: string[], env: Record<string, string> = {}, cwd = repo) {
  return spawnSync('sh', [DFLOW, ...args], {
    encoding: 'utf8', cwd,
    env: {
      NODE_ENV: process.env.NODE_ENV, PATH: `${join(tmp, 'bin')}:${process.env.PATH ?? ''}`,
      HOME: join(tmp, 'home'), XDG_CACHE_HOME: join(tmp, 'cache'),
      DFLOW_ENV_FILE: join(tmp, 'no-env'), DFLOW_CONFIG_DIR: join(tmp, 'no-config'),
      DFLOW_API_BASE: 'https://x.test/', DFLOW_PATS: TOKEN, DFLOW_DEV_BRANCH: 'main',
      DFLOW_PROJECT_ID: P1, DFLOW_PROJECT_MAP: `docs/mdm=${P2}`,
      GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t',
      ...env,
    } as NodeJS.ProcessEnv,
  })
}
const git = (...a: string[]) => execFileSync('git', a, { cwd: repo, encoding: 'utf8' })

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'dflow-scf-'))
  mkdirSync(join(tmp, 'bin')); mkdirSync(join(tmp, 'home'))
  writeFileSync(join(tmp, 'bin/curl'), FAKE_CURL, { mode: 0o755 })
  repo = join(tmp, 'repo'); mkdirSync(repo); bare = join(tmp, 'origin.git')
  git('init', '-q', '-b', 'main'); git('config', 'user.email', 't@t'); git('config', 'user.name', 't')
  writeFileSync(join(repo, 'f.txt'), 'x'); git('add', 'f.txt'); git('commit', '-q', '-m', 'init')
  execFileSync('git', ['init', '-q', '--bare', bare])
  git('remote', 'add', 'origin', bare); git('push', '-q', '-u', 'origin', 'main')
})
afterEach(() => rmSync(tmp, { recursive: true, force: true }))

describe('taskdir·claim spec 캐시', () => {
  const MINE = JSON.stringify({ claimed: [], assigned: [order(O2, P2, 'MDM/TSK-01-02')], available: [] })
  // 실제 응답 모양 — show 는 item 을 .order 안에, claim 은 최상위에 둔다(src/app/api/v1/agent/work/[id]/route.ts·claim/route.ts).
  // 2026-09-23 전에는 두 fixture 가 모두 최상위 item 이라 show 를 읽는 taskdir 의 NO_REF 오탐을 못 잡았다.
  const show = (id: string, item: object) => JSON.stringify({ ok: true, order: { id, status: 'ready', item }, reports: [], depends_evidence: [] })
  const claimBody = (item: object) => JSON.stringify({ ok: true, status: 'claimed', item, depends_evidence: [] })
  const ITEM = { external_ref: 'MDM/TSK-01-02', name: 't' }
  const SHOW = show(O2, ITEM)
  const CLAIM = claimBody(ITEM)
  it('taskdir 는 project_map 의 DOCS_DIR 아래 작업 폴더를 낸다', () => {
    const r = run(['taskdir', O2], { MINE_BODY: MINE, SHOW_BODY: SHOW })
    expect(r.status, r.stderr).toBe(0); expect(r.stdout).toBe('docs/mdm/tasks/TSK-01-02\n')
  })
  it('claim 은 spec.md 를 리포 최상위 기준 DOCS_DIR 아래에 쓴다(하위 디렉터리에서 실행해도)', () => {
    mkdirSync(join(repo, 'sub'))
    const r = run(['claim', O2], { MINE_BODY: MINE, SHOW_BODY: SHOW, CLAIM_BODY: CLAIM }, join(repo, 'sub'))
    expect(r.status, r.stderr).toBe(0)
    expect(existsSync(join(repo, 'docs/mdm/tasks/TSK-01-02/spec.md'))).toBe(true)
    expect(existsSync(join(repo, 'docs/tasks'))).toBe(false)
    expect(r.stdout).toContain('spec 캐시: docs/mdm/tasks/TSK-01-02/spec.md')
  })
  it('external_ref 가 없으면 taskdir 는 exit 6 NO_REF', () => {
    const r = run(['taskdir', O2], { MINE_BODY: MINE, SHOW_BODY: show(O2, {}) })
    expect(r.status).toBe(6); expect(r.stderr).toContain('NO_REF')
  })
  // external_ref 마지막 칸이 '.'·'..' 이면 작업 폴더가 <DOCS_DIR>/tasks 밖으로 나간다(최종 리뷰 #2).
  const bad = (ref: string) => show(O2, { external_ref: ref, name: 't' })
  for (const ref of ['X/..', 'X/.']) {
    it(`taskdir '${ref}' 는 exit 6 BAD_REF`, () => {
      const r = run(['taskdir', O2], { MINE_BODY: MINE, SHOW_BODY: bad(ref) })
      expect(r.status).toBe(6); expect(r.stderr).toContain('BAD_REF'); expect(r.stdout).toBe('')
    })
  }
  it("claim 'X/..' 는 claim POST 전에 exit 6 — 주문도 잡지 않고 spec.md 도 쓰지 않는다", () => {
    const log = join(tmp, 'curl.log')
    const r = run(['claim', O2], { MINE_BODY: MINE, SHOW_BODY: bad('X/..'), CURL_LOG: log })
    expect(r.status).toBe(6); expect(r.stderr).toContain('BAD_REF')
    const urls = existsSync(log) ? readFileSync(log, 'utf8') : ''
    expect(urls).toContain(`/agent/work/${O2}`)          // show 는 불렀다
    expect(urls).not.toContain('/claim')                  // claim POST 는 없다
    for (const p of ['docs/spec.md', 'docs/mdm/spec.md', 'docs/mdm/tasks/spec.md', 'docs/tasks/spec.md'])
      expect(existsSync(join(repo, p)), p).toBe(false)
  })
  it("claim 'X/.' 도 claim POST 전에 exit 6 (project_id → docs)", () => {
    const log = join(tmp, 'curl.log')
    const mine1 = JSON.stringify({ claimed: [], assigned: [order(O1, P1, 'X/.')], available: [] })
    const r = run(['claim', O1], { MINE_BODY: mine1, SHOW_BODY: show(O1, { external_ref: 'X/.' }), CURL_LOG: log })
    expect(r.status).toBe(6); expect(r.stderr).toContain('BAD_REF')
    expect(readFileSync(log, 'utf8')).not.toContain('/claim')
    expect(existsSync(join(repo, 'docs/tasks/spec.md'))).toBe(false)
    expect(existsSync(join(repo, 'docs/spec.md'))).toBe(false)
  })
})

describe('scaffold', () => {
  const mine = (...o: unknown[]) => JSON.stringify({ assigned: o })
  const state = (rel: string) => JSON.parse(readFileSync(join(repo, rel, 'state.json'), 'utf8'))

  it('바인딩 안의 내 작업마다 state.json(ready)을 만들고 개발 브랜치에 커밋·push 한다', () => {
    const r = run(['scaffold'], { MINE_BODY: mine(
      order(O1, P1, 'MES/TSK-01-01'), order(O2, P2, 'MDM/TSK-01-02'), order(O3, PX, 'X/TSK-09-09')) })
    expect(r.status, r.stderr).toBe(0)
    expect(r.stdout.trim()).toBe('scaffold created=2 skipped=0 no_ref=0')
    expect(state('docs/tasks/TSK-01-01')).toEqual({ tsk: 'TSK-01-01', order: O1, api_base: 'https://x.test', phase: 'ready' })
    expect(state('docs/mdm/tasks/TSK-01-02').order).toBe(O2)
    expect(existsSync(join(repo, 'docs/tasks/TSK-09-09'))).toBe(false)   // 바인딩 밖(PX)
    expect(git('show', '--name-only', '--format=%s', 'HEAD').trim().split('\n'))
      .toEqual(['chore(dflow): 담당 작업 폴더 2건 생성', '', 'docs/mdm/tasks/TSK-01-02/state.json', 'docs/tasks/TSK-01-01/state.json'])
    expect(execFileSync('git', ['--git-dir', bare, 'rev-parse', 'main'], { encoding: 'utf8' })).toBe(git('rev-parse', 'HEAD'))
  })
  it('claimed 주문은 무시한다 — ready 만 폴더를 만든다', () => {
    const r = run(['scaffold'], { MINE_BODY: mine(
      order(O1, P1, 'MES/TSK-01-01'), { ...order(O2, P1, 'MES/TSK-01-02'), status: 'claimed' }) })
    expect(r.status, r.stderr).toBe(0)
    expect(r.stdout.trim()).toBe('scaffold created=1 skipped=0 no_ref=0')
    expect(existsSync(join(repo, 'docs/tasks/TSK-01-02'))).toBe(false)
  })
  it('이미 있는 폴더는 건드리지 않고 skipped 로 센다', () => {
    mkdirSync(join(repo, 'docs/tasks/TSK-01-01'), { recursive: true })
    writeFileSync(join(repo, 'docs/tasks/TSK-01-01/design.md'), 'keep')
    const r = run(['scaffold'], { MINE_BODY: mine(order(O1, P1, 'MES/TSK-01-01')) })
    expect(r.stdout.trim()).toBe('scaffold created=0 skipped=1 no_ref=0')
    expect(existsSync(join(repo, 'docs/tasks/TSK-01-01/state.json'))).toBe(false)
    expect(git('log', '--oneline').trim().split('\n')).toHaveLength(1)   // 새 파일 0건 → 커밋 없음
  })
  it('external_ref 가 전부 없으면 no_ref 로 세고 서버 업데이트를 안내한다', () => {
    const r = run(['scaffold'], { MINE_BODY: mine(order(O1, P1, null)) })
    expect(r.stdout).toContain('scaffold created=0 skipped=0 no_ref=1')
    expect(r.stdout).toContain('D\'Flow 업데이트 필요')
  })
  it('같은 TSK 의 주문이 둘이면 폴더 하나, 첫 주문만 기록한다', () => {
    const r = run(['scaffold'], { MINE_BODY: mine(order(O1, P1, 'MES/TSK-01-01'), order(O3, P1, 'MES/TSK-01-01')) })
    expect(r.stdout.trim()).toBe('scaffold created=1 skipped=1 no_ref=0')
    expect(state('docs/tasks/TSK-01-01').order).toBe(O1)
  })
  it('개발 브랜치가 아니면 파일만 만들고 커밋하지 않는다', () => {
    git('checkout', '-q', '-b', 'topic')
    const r = run(['scaffold'], { MINE_BODY: mine(order(O1, P1, 'MES/TSK-01-01')) })
    expect(r.stdout).toContain('커밋하지 않음')
    expect(existsSync(join(repo, 'docs/tasks/TSK-01-01/state.json'))).toBe(true)
    expect(git('log', '--oneline').trim().split('\n')).toHaveLength(1)
  })
  it('사람이 stage 해 둔 다른 파일은 scaffold 커밋에 넣지 않는다', () => {
    writeFileSync(join(repo, 'other.txt'), 'y'); git('add', 'other.txt')
    run(['scaffold'], { MINE_BODY: mine(order(O1, P1, 'MES/TSK-01-01')) })
    expect(git('show', '--name-only', '--format=', 'HEAD').trim()).toBe('docs/tasks/TSK-01-01/state.json')
    expect(git('diff', '--cached', '--name-only').trim()).toBe('other.txt')
  })
  it('하위 디렉터리에서 실행해도 리포 최상위 기준으로 만든다', () => {
    mkdirSync(join(repo, 'sub'))
    run(['scaffold'], { MINE_BODY: mine(order(O1, P1, 'MES/TSK-01-01')) }, join(repo, 'sub'))
    expect(existsSync(join(repo, 'docs/tasks/TSK-01-01/state.json'))).toBe(true)
  })
  it('push 가 실패해도 exit 0, 로컬 커밋을 남기고 알린다', () => {
    git('remote', 'set-url', 'origin', join(tmp, 'gone.git'))
    const r = run(['scaffold'], { MINE_BODY: mine(order(O1, P1, 'MES/TSK-01-01')) })
    expect(r.status).toBe(0); expect(r.stdout).toContain('push 실패')
    expect(git('log', '--oneline').trim().split('\n')).toHaveLength(2)
  })
  it('목록이 100건이면 잘림을 경고한다', () => {
    const many = Array.from({ length: 100 }, (_, i) =>
      order(`aaaaaaaa-aaaa-4aaa-8aaa-${String(i).padStart(12, '0')}`, P1, `MES/TSK-${i}`))
    const r = run(['scaffold'], { MINE_BODY: mine(...many), DFLOW_DEV_BRANCH: 'nope' })
    expect(r.stderr).toContain('100건에서 잘렸을 수 있습니다')
  }, 30_000)   // 폴더 100개를 실제로 만든다 — 전체 스위트 부하에서 기본 5초를 넘는다
  it('바인딩이 없으면 exit 2 PROJECT_MISMATCH', () => {
    const r = run(['scaffold'], { MINE_BODY: mine(), DFLOW_PROJECT_ID: '', DFLOW_PROJECT_MAP: '' })
    expect(r.status).toBe(2); expect(r.stderr).toContain('PROJECT_MISMATCH')
    expect(r.stderr).toContain('프로젝트 바인딩 없음')
  })
  it('external_ref 마지막 조각이 .. 또는 . 이면 작업 폴더 밖으로 쓰지 않고 skipped 로 센다', () => {
    const r = run(['scaffold'], { MINE_BODY: mine(order(O1, P1, 'MES/..'), order(O2, P1, 'MES/.')) })
    expect(r.stdout.trim()).toBe('scaffold created=0 skipped=2 no_ref=0')
    expect(existsSync(join(repo, 'docs/state.json'))).toBe(false)
    expect(existsSync(join(repo, 'docs/tasks/state.json'))).toBe(false)
    expect(git('log', '--oneline').trim().split('\n')).toHaveLength(1)   // 새 파일 0건 → 커밋 없음
  })
  it('/work/mine 응답이 JSON 이 아니면 exit 6', () => {
    const r = run(['scaffold'], { MINE_BODY: 'not json' })
    expect(r.status).toBe(6); expect(r.stderr).toContain('목록 해석 실패')
  })
})
