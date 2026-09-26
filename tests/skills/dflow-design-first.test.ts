// tests/skills/dflow-design-first.test.ts
// 설계 선행(계약 2.9, 설계 wbs-web docs/superpowers/specs/2026-09-26-dflow-parallel-token-design.md §6)의 스킬 쪽 계약.
// dflow.sh 를 가짜 curl 로 실제 실행해 claim --design-first·build-start·contract-ge 의 요청 본문·출력·exit 를 고정하고,
// dflow-dev·dflow-team·dflow-merge 문서의 흐름 문구를 고정한다.
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const ROOT = process.cwd()
const DFLOW = join(ROOT, '.claude/skills/dflow-work/scripts/dflow.sh')
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8')

const TOKEN = `dflow_pat_AAAAAAAAAAAA_${'x'.repeat(24)}`
const PID = '11111111-1111-4111-8111-111111111111'
const WORK_ID = '99999999-9999-4999-8999-999999999999'

// 가짜 curl: dflow.sh api_raw 의 호출 꼴(-o file -w fmt -X M -H ... [--data json] url)을 흉내 낸다.
// POST 본문은 BODY_FILE 에 한 줄씩 이어 적는다. 응답은 FAKE_CLAIM·FAKE_BS·FAKE_ME 로 고른다.
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
case "$url" in
  *"/agent/me") code=200; body="{\\"contract_version\\":\\"\${FAKE_ME:-2.9}\\"}" ;;
  *"/agent/work/mine"*) code=200; body='{"claimed":[],"assigned":[],"available":[{"id":"${WORK_ID}","project_id":"${PID}","status":"ready","priority":1,"item":{"name":"t"}}]}' ;;
  *"/agent/work/${WORK_ID}/claim")
    case "\${FAKE_CLAIM:-ok}" in
      ok) code=200; body='{"ok":true,"status":"claimed","item":{},"depends_evidence":[]}' ;;
      df) code=200; body='{"ok":true,"status":"claimed","item":{},"design_first":true,"unmet":[{"external_ref":"d/TSK-01-01","stage":"ip"}]}' ;;
      dfmet) code=200; body='{"ok":true,"status":"claimed","item":{},"design_first":true,"unmet":[]}' ;;
      early) code=403; body='{"error":"x","code":"dependency_not_met","reason":"design_first_too_early","unmet":[{"external_ref":"d/TSK-01-01","stage":"as"}]}' ;;
      dep) code=403; body='{"error":"x","code":"dependency_not_met","unmet":[{"external_ref":"d/TSK-01-01","stage":"ip"}]}' ;;
    esac ;;
  *"/agent/work/${WORK_ID}/build-start")
    case "\${FAKE_BS:-ok}" in
      ok) code=200; body='{"ok":true,"stage":"ip"}' ;;
      dep) code=403; body='{"error":"x","code":"dependency_not_met","unmet":[{"external_ref":"d/TSK-01-01","stage":"ip"}]}' ;;
      owner) code=403; body='{"error":"x","code":"not_claim_owner"}' ;;
      old) code=404; body='<!DOCTYPE html><html><body>404 not found</body></html>' ;;
      gone) code=409; body='{"error":"x","code":"cancelled"}' ;;
    esac ;;
  *"/agent/work/${WORK_ID}") code=200; body='{"order":{"id":"${WORK_ID}","item":{}},"depends_evidence":[]}' ;;
  *) code=200; body='{}' ;;
esac
printf '%s' "$body" > "$out"; printf '%s' "$code"
`
}

let tmp: string
let repo: string
let bodies: string

function run(args: string[], env: Record<string, string> = {}) {
  return spawnSync('sh', [DFLOW, ...args], {
    encoding: 'utf8',
    cwd: repo,
    env: {
      NODE_ENV: process.env.NODE_ENV,
      PATH: `${join(tmp, 'bin')}:${process.env.PATH ?? ''}`,
      HOME: join(tmp, 'home'),
      XDG_CACHE_HOME: join(tmp, 'cache'),
      DFLOW_ENV_FILE: join(tmp, 'no-such-env'), DFLOW_CONFIG_DIR: join(tmp, 'no-config'),
      DFLOW_API_BASE: 'https://x.test',
      DFLOW_PATS: TOKEN,
      DFLOW_PROJECT_ID: PID,
      BODY_FILE: bodies,
      ...env,
    },
  })
}
const sent = () => (existsSync(bodies) ? readFileSync(bodies, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [])

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'dflow-df-'))
  mkdirSync(join(tmp, 'bin'))
  mkdirSync(join(tmp, 'home'))
  writeFileSync(join(tmp, 'bin/curl'), fakeCurlScript(), { mode: 0o755 })
  bodies = join(tmp, 'bodies.jsonl')
  repo = join(tmp, 'repo')
  mkdirSync(repo)
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: repo })
  execFileSync('git', ['config', 'user.email', 't@t'], { cwd: repo })
  execFileSync('git', ['config', 'user.name', 't'], { cwd: repo })
  writeFileSync(join(repo, 'f.txt'), 'x')
  execFileSync('git', ['add', 'f.txt'], { cwd: repo })
  execFileSync('git', ['commit', '-q', '-m', 'init'], { cwd: repo })
})
afterEach(() => rmSync(tmp, { recursive: true, force: true }))

describe('dflow.sh claim --design-first', () => {
  it('플래그가 없으면 본문에 design_first 가 없고 출력도 종전과 같다', () => {
    const r = run(['claim', WORK_ID])
    expect(r.status).toBe(0)
    expect(sent()).toEqual([{ agent: expect.any(String) }])
    expect(r.stdout).toContain('claimed 99999999')
    expect(r.stdout).not.toContain('DESIGN_FIRST_UNMET')
  })

  it('플래그를 주면 본문에 design_first:true 를 싣고, 미충족 선행을 DESIGN_FIRST_UNMET 한 줄로 낸다', () => {
    const r = run(['claim', WORK_ID, '--design-first'], { FAKE_CLAIM: 'df' })
    expect(r.status).toBe(0)
    expect(sent()[0]).toMatchObject({ design_first: true })
    expect(r.stdout).toContain('claimed 99999999')
    expect(r.stdout).toContain('DESIGN_FIRST_UNMET [{"external_ref":"d/TSK-01-01","stage":"ip"}]')
  })

  it('선행이 모두 충족됐거나 옛 서버(design_first 없는 응답)면 DESIGN_FIRST_UNMET 를 내지 않는다 — 종전 흐름', () => {
    for (const c of ['dfmet', 'ok']) {
      const r = run(['claim', WORK_ID, '--design-first'], { FAKE_CLAIM: c })
      expect(r.status, c).toBe(0)
      expect(r.stdout, c).not.toContain('DESIGN_FIRST_UNMET')
    }
  })

  it('design_first_too_early 거부는 exit 4 에 DESIGN_FIRST_TOO_EARLY 표식, 다른 선행 거부는 exit 4 만', () => {
    const e = run(['claim', WORK_ID, '--design-first'], { FAKE_CLAIM: 'early' })
    expect(e.status).toBe(4)
    expect(e.stderr).toContain('design_first_too_early')
    expect(e.stderr).toContain('DESIGN_FIRST_TOO_EARLY [{"external_ref":"d/TSK-01-01","stage":"as"}]')
    const d = run(['claim', WORK_ID, '--design-first'], { FAKE_CLAIM: 'dep' })
    expect(d.status).toBe(4)
    expect(d.stderr).not.toContain('DESIGN_FIRST_TOO_EARLY')
  })

  it('모르는 둘째 인자는 사용법 오류(exit 2)이고 claim 하지 않는다', () => {
    const r = run(['claim', WORK_ID, '--design'])
    expect(r.status).toBe(2)
    expect(sent()).toEqual([])
  })
})

describe('dflow.sh build-start', () => {
  it('200 이면 exit 0 과 build-started, 본문 agent 는 claim 과 같은 신원이다', () => {
    writeFileSync(join(repo, '.dflow-agent'), 'hong/mbp/w2\n')
    expect(run(['claim', WORK_ID, '--design-first'], { FAKE_CLAIM: 'df' }).status).toBe(0)
    const r = run(['build-start', WORK_ID])
    expect(r.status).toBe(0)
    expect(r.stdout).toContain('build-started 99999999')
    expect(sent().map((b) => b.agent)).toEqual(['hong/mbp/w2', 'hong/mbp/w2'])
  })

  it('선행 미충족(403 dependency_not_met)은 claim 의 선행 대기와 같은 exit 4, 본문은 stderr', () => {
    const r = run(['build-start', WORK_ID], { FAKE_BS: 'dep' })
    expect(r.status).toBe(4)
    expect(r.stderr).toContain('"unmet"')
  })

  it('옛 서버(404)는 본문이 HTML 이어도 읽지 않고 BUILD_START_UNSUPPORTED 로 알린 뒤 exit 0', () => {
    const r = run(['build-start', WORK_ID], { FAKE_BS: 'old' })
    expect(r.status).toBe(0)
    expect(r.stderr).toContain('BUILD_START_UNSUPPORTED')
    expect(r.stderr).not.toContain('DOCTYPE')
    expect(r.stdout).not.toContain('build-started')
  })

  it('점유자가 아니면 exit 5, 사람이 중단했으면 exit 10 — 흡수하지 않는다', () => {
    expect(run(['build-start', WORK_ID], { FAKE_BS: 'owner' }).status).toBe(5)
    expect(run(['build-start', WORK_ID], { FAKE_BS: 'gone' }).status).toBe(10)
  })
})

describe('dflow.sh contract-ge — 숫자 비교', () => {
  it.each([
    ['2.9', '2.9', 0], ['2.10', '2.9', 0], ['3.0', '2.9', 0], ['2.8', '2.9', 1], ['1.12', '2.9', 1],
  ])('서버 %s ≥ %s → exit %i', (server, want, code) => {
    expect(run(['contract-ge', want], { FAKE_ME: server }).status).toBe(code)
  })
})

describe('계약 문서·usage', () => {
  it('usage 가 --design-first·build-start·contract-ge 를 안내한다', () => {
    const sh = read('.claude/skills/dflow-work/scripts/dflow.sh')
    expect(sh).toContain('claim <ref> [--design-first]')
    expect(sh).toContain('build-start <ref>')
    expect(sh).toContain('contract-ge <x.y>')
  })
  it('api-contract.md 에 v2.9 변경점(ds·design_first·build-start·wait_pred)이 있다', () => {
    const doc = read('.claude/skills/dflow-work/references/api-contract.md')
    expect(doc).toContain('## v2.9 변경점')
    for (const w of ['design_first', 'build-start', 'wait_pred', 'design_first_too_early', '`ds`']) expect(doc, w).toContain(w)
  })
})
