// tests/skills/dflow-design-first.test.ts
// 설계 선행(계약 2.9, 설계 wbs-web docs/superpowers/specs/2026-09-26-dflow-parallel-token-design.md §6)의 스킬 쪽 계약.
// dflow.sh 를 가짜 curl 로 실제 실행해 claim --design-first·build-start·contract-ge 의 요청 본문·출력·exit 를 고정하고,
// dflow-dev·dflow-team·dflow-merge 문서의 흐름 문구를 고정한다.
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { devAll } from './_dflow-dev'
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
  *"/agent/me")
    case "\${FAKE_ME:-2.9}" in
      fail) code=500; body='{"error":"x"}' ;;
      none) code=200; body='{"ok":true}' ;;
      *) code=200; body="{\\"contract_version\\":\\"\${FAKE_ME:-2.9}\\"}" ;;
    esac ;;
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

  it('옛 서버(404, 계약 < 2.9)는 본문이 HTML 이어도 읽지 않고 BUILD_START_UNSUPPORTED 로 알린 뒤 exit 0', () => {
    const r = run(['build-start', WORK_ID], { FAKE_BS: 'old', FAKE_ME: '2.8' })
    expect(r.status).toBe(0)
    expect(r.stderr).toContain('BUILD_START_UNSUPPORTED')
    expect(r.stderr).not.toContain('DOCTYPE')
    expect(r.stdout).not.toContain('build-started')
  })

  it('새 서버(계약 ≥ 2.9)의 404(프로젝트 게이트·PAT 범위)는 넘기지 않고 종전대로 exit 7 — 선행 관문을 건너뛰지 않는다', () => {
    for (const v of ['2.9', '2.10']) {
      const r = run(['build-start', WORK_ID], { FAKE_BS: 'old', FAKE_ME: v })
      expect(r.status, v).toBe(7)
      expect(r.stderr, v).not.toContain('BUILD_START_UNSUPPORTED')
    }
  })

  it('404 인데 계약 버전을 확인하지 못하면 실패로 본다(fail-closed)', () => {
    const f = run(['build-start', WORK_ID], { FAKE_BS: 'old', FAKE_ME: 'fail' })
    expect(f.status).toBe(6)
    expect(f.stderr).toContain('BUILD_START_FAILED')
    expect(f.stderr).not.toContain('BUILD_START_UNSUPPORTED')
    const n = run(['build-start', WORK_ID], { FAKE_BS: 'old', FAKE_ME: 'none' })
    expect(n.status).toBe(6)
    expect(n.stderr).not.toContain('BUILD_START_UNSUPPORTED')
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
  it('조회 실패·contract_version 없음은 0·1 이 아닌 exit 6', () => {
    expect(run(['contract-ge', '2.9'], { FAKE_ME: 'fail' }).status).toBe(6)
    expect(run(['contract-ge', '2.9'], { FAKE_ME: 'none' }).status).toBe(6)
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

describe('/dflow-dev 「설계 선행」 흐름 문구', () => {
  const flat = (s: string) => s.replace(/\s*\n\s*/g, ' ')
  const DEV = flat(devAll())
  const WM = flat(read('.claude/skills/dflow-dev/references/worker-mode.md'))
  it('계약 2.9 이상이면 늘 --design-first 로 claim 하고, 너무 이른 선행은 재시도하지 않는다', () => {
    expect(DEV).toContain('`dflow.sh contract-ge 2.9` 가 exit 0 이면 늘 `dflow.sh claim <ref> --design-first` 다')
    expect(DEV).toContain('exit 4 에 stderr `DESIGN_FIRST_TOO_EARLY` 면 아래 재시도를 하지 않는다')
  })
  it('Design 게이트 뒤 build-start: exit 4 면 멈추고, 멈춤 절차는 state.json → push → heartbeat wait_pred 순서다', () => {
    expect(DEV).toContain('Design 게이트가 통과하면 아래 모듈 기준선보다 먼저 `dflow.sh build-start <ref>` 를 부른다')
    const i = DEV.indexOf('**멈춤 절차**(순서 고정)')
    const seq = ['state.json `phase` 를 `wait_pred` 로', '`git push origin <agent 브랜치>`', '`dflow.sh heartbeat <ref> --phase wait_pred`', '`design_waiting <미충족 선행 ref…>`']
    let at = i
    for (const s of seq) { const n = DEV.indexOf(s, at); expect(n, s).toBeGreaterThan(at); at = n }
  })
  it('재개 트리거는 현재 트리가 아니라 agent 브랜치의 state.json 에서 읽는다', () => {
    expect(DEV).toContain('`git show <그 브랜치>:<TASKS>/<TSK>/state.json`')
    expect(DEV).toContain('0. 그 agent 브랜치로 switch 한다')
  })
  it('재개는 기점 판정만 다시 하고(claim·detach 없음) 한 번 머지·기점과 기준선 교체·의존성 갱신·선행 기준 재확인 순이다', () => {
    expect(DEV).toContain('다시 하는 것은 **어느 커밋을 기점으로 삼을지의 판정뿐**이다')
    expect(DEV).toContain('git merge --no-ff <기점> -m "merge: <TSK> 설계 선행 재개')
    expect(DEV).toContain('state.json `branch_base`·`baseline.base` 를 새 기점 sha 로 바꾸고 `baseline.cmds` 를 모듈 기준선까지 모두 비운 뒤')
    expect(DEV).toContain('`dflow-prepare.done`(준비 빌드 표식)은 늘 지운 뒤 행 H 의 `deps.sh` 를 다시 부른다')
    expect(DEV).toContain('`git diff --name-only <적힌 sha>..<새 기점> -- <파일>`')
    expect(DEV).toContain('적힌 sha 가 없거나(읽을 곳 없음) 로컬에 없으면')
  })
  it('설계 선행 모드의 state.json 표식·phase 값·선행 기준 절', () => {
    expect(DEV).toContain('`design_first`(선택)는 설계 선행 모드의 표식 `{"unmet": ["<선행 external_ref>", …]}` 이다')
    expect(DEV).toContain('`wait_pred` 는 설계를 마치고 선행을 기다리며 멈춘 상태다')
    const pd = flat(read('.claude/skills/dflow-dev/references/phase-design.md'))
    expect(pd).toContain('## 선행 기준')
    expect(pd).toContain('`선행 ref | 읽은 곳과 sha | 파일 | 기대하는 선행 계약`')
    expect(pd).toContain('보고된 `head_sha` → `origin/agent/…` 브랜치 tip → 없음')
    const pp = read('.claude/skills/dflow-dev/references/phase-prompt.md')
    expect(pp).toContain('| `{DESIGN_FIRST}` |')
    expect(pp).toContain('{FORCE_STUB}\n{DESIGN_FIRST}\n{DOCKER_LINE}')
  })
  it('워커: 행 G 갈래 1 을 설계 선행이 대신하고, 선행 반영 머지는 기본 브랜치 머지 금지와 부딪치지 않는다', () => {
    expect(WM).toContain('서버 계약이 2.9 이상이면 갈래 1 은 아래 「설계 선행」 이 대신한다')
    expect(WM).toContain('`{TSK} {ID8} <agent 브랜치> <push 한 head_sha> - design_waiting <미충족 선행 ref…>`')
    expect(WM).toContain('agent 브랜치 위의 머지이므로')
    expect(flat(read('.claude/skills/dflow-dev/references/dev-discipline.md'))).toContain('**설계 선행 재개**(SKILL.md 「설계 선행」 3)의 선행 반영 머지가 이 허용 한 번이다')
  })
  it('/dflow-poll 루프는 설계 선행을 하지 않는다(상한은 팀장에만 있다)', () => {
    expect(flat(read('.claude/skills/dflow-poll/SKILL.md'))).toContain('서버 계약이 2.9 여도 `reached` 가 거짓인 선행은 여기서 불가(선행 대기)로 본다')
  })
})
