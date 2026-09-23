// 작업 폴더 scaffold·taskdir·spec 캐시 경로(docs/superpowers/specs/2026-09-23-dflow-task-scaffold-design.md).
// dflow.sh 를 가짜 curl 로 실제 실행한다. 응답 본문은 env(MINE_BODY·SHOW_BODY)로 주입한다.
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
  *"/claim") printf '%s' "$SHOW_BODY" > "$out" ;;
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
  const SHOW = JSON.stringify({ id: O2, item: { external_ref: 'MDM/TSK-01-02', name: 't' }, depends_evidence: [] })
  it('taskdir 는 project_map 의 DOCS_DIR 아래 작업 폴더를 낸다', () => {
    const r = run(['taskdir', O2], { MINE_BODY: MINE, SHOW_BODY: SHOW })
    expect(r.status, r.stderr).toBe(0); expect(r.stdout).toBe('docs/mdm/tasks/TSK-01-02\n')
  })
  it('claim 은 spec.md 를 리포 최상위 기준 DOCS_DIR 아래에 쓴다(하위 디렉터리에서 실행해도)', () => {
    mkdirSync(join(repo, 'sub'))
    const r = run(['claim', O2], { MINE_BODY: MINE, SHOW_BODY: SHOW }, join(repo, 'sub'))
    expect(r.status, r.stderr).toBe(0)
    expect(existsSync(join(repo, 'docs/mdm/tasks/TSK-01-02/spec.md'))).toBe(true)
    expect(existsSync(join(repo, 'docs/tasks'))).toBe(false)
    expect(r.stdout).toContain('spec 캐시: docs/mdm/tasks/TSK-01-02/spec.md')
  })
  it('external_ref 가 없으면 taskdir 는 exit 6 NO_REF', () => {
    const r = run(['taskdir', O2], { MINE_BODY: MINE, SHOW_BODY: JSON.stringify({ id: O2, item: {} }) })
    expect(r.status).toBe(6); expect(r.stderr).toContain('NO_REF')
  })
  // external_ref 마지막 칸이 '.'·'..' 이면 작업 폴더가 <DOCS_DIR>/tasks 밖으로 나간다(최종 리뷰 #2).
  const bad = (ref: string) => JSON.stringify({ id: O2, item: { external_ref: ref, name: 't' }, depends_evidence: [] })
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
    const r = run(['claim', O1], { MINE_BODY: mine1, SHOW_BODY: JSON.stringify({ id: O1, item: { external_ref: 'X/.' }, depends_evidence: [] }), CURL_LOG: log })
    expect(r.status).toBe(6); expect(r.stderr).toContain('BAD_REF')
    expect(readFileSync(log, 'utf8')).not.toContain('/claim')
    expect(existsSync(join(repo, 'docs/tasks/spec.md'))).toBe(false)
    expect(existsSync(join(repo, 'docs/spec.md'))).toBe(false)
  })
})
