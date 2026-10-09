// tests/skills/dflow-design-state-cli.test.ts — 설계 상태(계약 2.11)의 CLI 계약. dflow.sh 를 가짜 curl 로 실제 실행한다
// (dflow-design-first.test.ts 와 같은 방식). exit 11·12, 범위 인자, 새 동사, list 의 action·mine 열, 옛 서버 폴백을 고정한다.
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CURL_SHIM_OPTS } from './_curl-shim'

const ROOT = process.cwd()
const DFLOW = join(ROOT, '.claude/skills/dflow-work/scripts/dflow.mjs')
const TOKEN = `dflow_pat_AAAAAAAAAAAA_${'x'.repeat(24)}`
const PID = '11111111-1111-4111-8111-111111111111'
const WORK_ID = '99999999-9999-4999-8999-999999999999'

// 가짜 curl — POST 본문은 BODY_FILE, 요청 URL 은 URL_FILE 에 한 줄씩 적는다. 응답은 FAKE_* 로 고른다.
function fakeCurlScript() {
  return `#!/bin/sh
out=''; data=''; url=''
while [ $# -gt 0 ]; do
  case "$1" in
    -o) out="$2"; shift 2 ;;
    -X|-H|-w) shift 2 ;;
    --data) data="$2"; shift 2 ;;
    -sS) shift ;;
    *) url="$1"; shift ;;
  esac
done
[ -n "$data" ] && printf '%s\\n' "$data" >> "$BODY_FILE"
printf '%s\\n' "$url" >> "$URL_FILE"
case "$url" in
  *"/agent/me") code=200; body="{\\"contract_version\\":\\"\${FAKE_ME:-2.11}\\"}" ;;
  *"/agent/work/mine"*)
    case "\${FAKE_LIST:-new}" in
      new) code=200; body='{"claimed":[],"assigned":[],"available":[{"id":"${WORK_ID}","project_id":"${PID}","status":"ready","priority":1,"item":{"name":"t"},"action":"design","mine":true}]}' ;;
      old) code=200; body='{"claimed":[],"assigned":[],"available":[{"id":"${WORK_ID}","project_id":"${PID}","status":"ready","priority":1,"item":{"name":"t"}}]}' ;;
    esac ;;
  *"/agent/work/${WORK_ID}/claim")
    case "\${FAKE_CLAIM:-ok}" in
      ok) code=200; body='{"ok":true,"status":"claimed","item":{},"depends_evidence":[],"claim_scope":"design"}' ;;
      nocs) code=200; body='{"ok":true,"status":"claimed","item":{},"depends_evidence":[]}' ;;
      gate) code=409; body='{"error":"x","code":"design_gate"}' ;;
      na) code=409; body='{"error":"x","code":"design_not_accepted"}' ;;
    esac ;;
  *"/agent/work/${WORK_ID}/build-start")
    case "\${FAKE_BS:-ok}" in
      ok) code=200; body='{"ok":true,"stage":"ip","runner":"hong/mbp/w1"}' ;;
      changed) code=409; body='{"error":"x","code":"design_gate","reason":"order_changed"}' ;;
      runner) code=409; body='{"error":"x","code":"runner_active","runner":"kim/pc2/w1"}' ;;
      runner_missing) code=409; body='{"error":"x","code":"runner_active"}' ;;
      runner_null) code=409; body='{"error":"x","code":"runner_active","runner":null}' ;;
      conflict) code=409; body='{"error":"x","code":"conflict"}' ;;
    esac ;;
  *"/agent/work/${WORK_ID}/design-done")
    case "\${FAKE_DD:-ok}" in
      ok) code=200; body='{"ok":true,"status":"claimed","stage":"dd","design_state":"review"}' ;;
      auto) code=200; body='{"ok":true,"status":"claimed","stage":"dd","design_state":null}' ;;
      old) code=404; body='<html><body>이것은 Next.js 404 페이지 전체를 흉내낸 긴 본문이다 DESIGN_STATE_UNSUPPORTED_TRAP</body></html>' ;;
    esac ;;
  *"/agent/work/${WORK_ID}/design-reopen")
    case "\${FAKE_DR:-ok}" in
      ok) code=200; body='{"ok":true,"status":"ready","stage":"as","design_state":null}' ;;
      old) code=404; body='<html><body>이것은 Next.js 404 페이지 전체를 흉내낸 긴 본문이다 DESIGN_STATE_UNSUPPORTED_TRAP</body></html>' ;;
    esac ;;
  *"/agent/work/${WORK_ID}/heartbeat") code=409; body='{"error":"x","code":"runner_active","runner":"kim/pc2/w1"}' ;;
  *"/agent/work/${WORK_ID}"*) code=200; body='{"order":{"id":"${WORK_ID}","item":{}},"depends_evidence":[]}' ;;
  *"/agent/watch") code=200; body='{"ok":true,"expires_at":"x","resume_requests":[],"build_ready":[]}' ;;
  *) code=200; body='{}' ;;
esac
printf '%s' "$body" > "$out"; printf '%s' "$code"
`
}

let tmp: string, repo: string, bodies: string, urls: string
function run(args: string[], env: Record<string, string> = {}) {
  return spawnSync('node', [DFLOW, ...args], {
    encoding: 'utf8', cwd: repo,
    env: {
      NODE_ENV: process.env.NODE_ENV, NODE_OPTIONS: CURL_SHIM_OPTS, PATH: `${join(tmp, 'bin')}:${process.env.PATH ?? ''}`,
      HOME: join(tmp, 'home'), XDG_CACHE_HOME: join(tmp, 'cache'),
      DFLOW_ENV_FILE: join(tmp, 'no-such-env'), DFLOW_CONFIG_DIR: join(tmp, 'no-config'),
      DFLOW_API_BASE: 'https://x.test', DFLOW_PATS: TOKEN, DFLOW_PROJECT_ID: PID,
      BODY_FILE: bodies, URL_FILE: urls, ...env,
    },
  })
}
const sent = () => (existsSync(bodies) ? readFileSync(bodies, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [])
const urlsSent = () => (existsSync(urls) ? readFileSync(urls, 'utf8').trim().split('\n') : [])

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'dflow-ds-'))
  mkdirSync(join(tmp, 'bin')); mkdirSync(join(tmp, 'home'))
  writeFileSync(join(tmp, 'bin/curl'), fakeCurlScript(), { mode: 0o755 })
  bodies = join(tmp, 'bodies.jsonl'); urls = join(tmp, 'urls.log')
  repo = join(tmp, 'repo'); mkdirSync(repo)
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: repo })
  writeFileSync(join(repo, '.dflow-agent'), 'hong/mbp/w1\n')
})
afterEach(() => rmSync(tmp, { recursive: true, force: true }))

describe('exit 11·12(계약 2.11)', () => {
  it('claim 이 409 design_gate·design_not_accepted 면 exit 11, stderr 끝줄 DESIGN_GATE <code>', () => {
    const a = run(['claim', WORK_ID, '--scope', 'full'], { FAKE_CLAIM: 'gate' })
    expect(a.status).toBe(11)
    expect(a.stderr.trim().split('\n').pop()).toBe('DESIGN_GATE design_gate')
    const b = run(['claim', WORK_ID, '--scope', 'build'], { FAKE_CLAIM: 'na' })
    expect(b.status).toBe(11)
    expect(b.stderr).toContain('DESIGN_GATE design_not_accepted')
  })
  it('build-start 의 order_changed 는 reason 까지 싣는다(Y7)', () => {
    const r = run(['build-start', WORK_ID, '--scope', 'build'], { FAKE_BS: 'changed' })
    expect(r.status).toBe(11)
    expect(r.stderr.trim().split('\n').pop()).toBe('DESIGN_GATE design_gate order_changed')
  })
  it('runner_active 는 exit 12, stderr 끝줄 RUNNER_ACTIVE <runner> — heartbeat 도 같다', () => {
    const r = run(['build-start', WORK_ID, '--scope', 'full'], { FAKE_BS: 'runner' })
    expect(r.status).toBe(12)
    expect(r.stderr.trim().split('\n').pop()).toBe('RUNNER_ACTIVE kim/pc2/w1')
    const hb = run(['heartbeat', WORK_ID, '--phase', 'build'])
    expect(hb.status).toBe(12)
    expect(hb.stderr.trim().split('\n').pop()).toBe('RUNNER_ACTIVE kim/pc2/w1')
  })
  it('runner 칸이 없거나 null 이면 stderr 끝줄 RUNNER_ACTIVE -', () => {
    expect(run(['build-start', WORK_ID], { FAKE_BS: 'runner_missing' }).stderr.trim().split('\n').pop()).toBe('RUNNER_ACTIVE -')
    expect(run(['build-start', WORK_ID], { FAKE_BS: 'runner_null' }).stderr.trim().split('\n').pop()).toBe('RUNNER_ACTIVE -')
  })
  it('다른 409(conflict)는 종전대로 exit 4', () => {
    expect(run(['build-start', WORK_ID], { FAKE_BS: 'conflict' }).status).toBe(4)
  })
  it('사용법·파일 머리의 exit 표에 11·12 가 있다', () => {
    const r = spawnSync('node', [DFLOW], { encoding: 'utf8', env: { PATH: process.env.PATH ?? '', HOME: join(tmp, 'home'), NODE_ENV: process.env.NODE_ENV, DFLOW_CONFIG_DIR: join(tmp, 'no-config') } })
    expect(r.stderr).toMatch(/11 = 설계 관문/)
    expect(r.stderr).toMatch(/12 = 다른 PC 가 이 작업을 돌리는 중/)
    expect(readFileSync(DFLOW, 'utf8').split('\n')[5]).toContain('11 설계 관문')
  })
})

describe('claim·build-start 범위(D21)', () => {
  it('claim --scope design 은 본문에 scope, 성공 출력에 서버 범위 CLAIM_SCOPE', () => {
    const r = run(['claim', WORK_ID, '--scope', 'design'])
    expect(r.status).toBe(0)
    expect(sent().at(-1)).toEqual({ agent: 'hong/mbp/w1', scope: 'design' })
    expect(r.stdout).toContain('CLAIM_SCOPE design')
  })
  it('CLAIM_SCOPE 는 요청값이 아니라 서버 응답값이다(D21) — --scope full 을 보내도 서버가 design 이라 하면 그걸 찍는다', () => {
    const r = run(['claim', WORK_ID, '--scope', 'full'])
    expect(r.status).toBe(0)
    expect(sent().at(-1)).toEqual({ agent: 'hong/mbp/w1', scope: 'full' })
    expect(r.stdout).toContain('CLAIM_SCOPE design')
  })
  it('응답에 claim_scope 가 없으면 CLAIM_SCOPE 줄도 없다(옛 서버·레거시 응답)', () => {
    const r = run(['claim', WORK_ID], { FAKE_CLAIM: 'nocs' })
    expect(r.status).toBe(0)
    expect(r.stdout).not.toContain('CLAIM_SCOPE')
  })
  it('claim 은 --design-first 와 --scope 를 순서와 무관하게 받는다', () => {
    expect(run(['claim', WORK_ID, '--design-first', '--scope', 'full']).status).toBe(0)
    expect(sent().at(-1)).toEqual({ agent: 'hong/mbp/w1', scope: 'full', design_first: true })
  })
  it('모르는 범위는 사용법(exit 2)', () => {
    expect(run(['claim', WORK_ID, '--scope', 'weird']).status).toBe(2)
    expect(run(['build-start', WORK_ID, '--scope', 'design']).status).toBe(2)
  })
  it('build-start --scope rework 는 본문에 scope', () => {
    expect(run(['build-start', WORK_ID, '--scope', 'rework']).status).toBe(0)
    expect(sent().at(-1)).toEqual({ agent: 'hong/mbp/w1', scope: 'rework' })
  })
  it('build-start 에 --scope 가 없으면 본문에 scope 키가 없다', () => {
    const r = run(['build-start', WORK_ID])
    expect(r.status).toBe(0)
    expect(sent().at(-1)).toEqual({ agent: 'hong/mbp/w1' })
  })
})

describe('design-done·design-reopen', () => {
  it('design-done 은 설계 상태를 한 줄로 낸다', () => {
    const r = run(['design-done', WORK_ID])
    expect(r.status).toBe(0)
    expect(r.stdout.trim()).toBe('design-done 99999999 review')
    expect(run(['design-done', WORK_ID], { FAKE_DD: 'auto' }).stdout.trim()).toBe('design-done 99999999 none')
  })
  it('옛 서버(404, 계약 < 2.11)면 DESIGN_STATE_UNSUPPORTED 에 exit 7 — 404 본문(HTML 일 수 있다)은 stderr 에 쏟지 않는다', () => {
    const r = run(['design-done', WORK_ID], { FAKE_DD: 'old', FAKE_ME: '2.9' })
    expect(r.status).toBe(7)
    expect(r.stderr).toContain('DESIGN_STATE_UNSUPPORTED')
    expect(r.stderr).not.toContain('DESIGN_STATE_UNSUPPORTED_TRAP')
  })
  it('design-reopen 은 --reason 이 없으면 exit 2, 있으면 본문에 reason', () => {
    expect(run(['design-reopen', WORK_ID]).status).toBe(2)
    const r = run(['design-reopen', WORK_ID, '--reason', '테스트 계획 절 없음'])
    expect(r.status).toBe(0)
    expect(sent().at(-1)).toEqual({ agent: 'hong/mbp/w1', reason: '테스트 계획 절 없음' })
    expect(r.stdout.trim()).toBe('design-reopened 99999999 ready none')
  })
  it('design-reopen 도 옛 서버(404, 계약 < 2.11)면 DESIGN_STATE_UNSUPPORTED 에 exit 7 — 404 본문은 쏟지 않는다', () => {
    const r = run(['design-reopen', WORK_ID, '--reason', '사유'], { FAKE_DR: 'old', FAKE_ME: '2.9' })
    expect(r.status).toBe(7)
    expect(r.stderr).toContain('DESIGN_STATE_UNSUPPORTED')
    expect(r.stderr).not.toContain('DESIGN_STATE_UNSUPPORTED_TRAP')
  })
})

describe('list·watch(Y4·D22)', () => {
  it('list 는 agent·거르기 쿼리를 싣고, 끝에 action·mine 열을 낸다', () => {
    const r = run(['list', '--scope', 'assigned', '--require-tag', 'agent', '--wp', 'WP-02', '--lead'])
    expect(r.status).toBe(0)
    const u = urlsSent().find(x => x.includes('/work/mine')) ?? ''
    expect(u).toContain('agent=hong%2Fmbp%2Fw1')
    expect(u).toContain('require_tag=agent')
    expect(u).toContain('wp=WP-02')
    expect(u).toContain('lead=1')
    expect(r.stdout.trim().split('\t')).toEqual(['1', 'RD', '1', '99999999', 't', 'design', '1'])
  })
  it('옛 서버 목록은 두 열이 빈 값 — 열 번호는 그대로', () => {
    const r = run(['list'], { FAKE_LIST: 'old' })
    expect(r.stdout.replace(/\n$/, '').split('\t')).toEqual(['1', 'RD', '1', '99999999', 't', '', ''])
  })
  it('watch 는 거르기를 본문에 싣는다', () => {
    expect(run(['watch', '--agent', 'hong/mbp/lead', '--require-tag', 'agent', '--wp', 'WP-02,dict/WP-3', '--json']).status).toBe(0)
    expect(sent().at(-1)).toMatchObject({ agent: 'hong/mbp/lead', require_tag: 'agent', wp: 'WP-02,dict/WP-3' })
  })
  it('show 는 요청 라벨(agent)을 싣는다 — 상세 응답의 mine 이 이 PC 로 계산된다', () => {
    expect(run(['show', WORK_ID]).status).toBe(0)
    expect(urlsSent().find(x => x.includes(`/agent/work/${WORK_ID}`)) ?? '').toContain(`/agent/work/${WORK_ID}?agent=hong%2Fmbp%2Fw1`)
  })
})
