// tests/skills/dflow-list-limit.test.ts
// dflow.sh 가 /work/mine 을 limit 없이 불러 서버 기본값 20건에서 목록이 잘리던 버그의 회귀 가드(2026-09-24
// dmes-standard: 배정 34건 중 20건만 보여 새로 위임한 14건을 poll·팀장이 1시간 넘게 못 봤다).
// 서버는 페이지 넘김이 없고 limit 상한이 100 이다 — 모든 호출에 limit=100 을 싣고, 한 구획이 100건으로 차면 경고한다.
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const ROOT = process.cwd()
const DFLOW = join(ROOT, '.claude/skills/dflow-work/scripts/dflow.sh')
const TOKEN = `dflow_pat_AAAAAAAAAAAA_${'x'.repeat(24)}`
const PID = '11111111-1111-4111-8111-111111111111'

let tmp: string
let repo: string

// 가짜 curl: 부른 URL 을 URL_LOG 에 적고, /work/mine 에는 assigned 를 ASSIGNED_N 건 돌려준다.
function fakeCurl() {
  return `#!/bin/sh
out=''; url=''
while [ $# -gt 0 ]; do
  case "$1" in
    -o) out="$2"; shift 2 ;;
    -X|-H|-w|--data) shift 2 ;;
    -sS) shift ;;
    *) url="$1"; shift ;;
  esac
done
printf '%s\\n' "$url" >> "$URL_LOG"
case "$url" in
  *"/agent/work/mine"*)
    body=$(jq -n --arg pid "${PID}" --argjson n "\${ASSIGNED_N:-3}" \\
      '{claimed:[], available:[], assigned:[range(0;$n) | {id:("00000000-0000-4000-8000-" + ("000000000000" + (.|tostring))[-12:]), project_id:$pid, status:"ready", priority:1, item:{name:("t" + (.|tostring))}}]}') ;;
  *) body='{}' ;;
esac
printf '%s' "$body" > "$out"; printf '200'
`
}

function run(args: string[], env: Record<string, string> = {}) {
  return spawnSync('sh', [DFLOW, ...args], {
    encoding: 'utf8', cwd: repo,
    env: {
      NODE_ENV: process.env.NODE_ENV,
      PATH: `${join(tmp, 'bin')}:${process.env.PATH ?? ''}`,
      HOME: join(tmp, 'home'), XDG_CACHE_HOME: join(tmp, 'cache'),
      DFLOW_ENV_FILE: join(tmp, 'no-such-env'), DFLOW_CONFIG_DIR: join(tmp, 'no-config'),
      DFLOW_API_BASE: 'https://x.test', DFLOW_PATS: TOKEN, DFLOW_PROJECT_ID: PID,
      URL_LOG: join(tmp, 'urls.log'),
      ...env,
    },
  })
}
const mineUrls = () => readFileSync(join(tmp, 'urls.log'), 'utf8').split('\n').filter((u) => u.includes('/work/mine'))

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'dflow-list-limit-'))
  repo = join(tmp, 'repo')
  mkdirSync(join(tmp, 'bin'), { recursive: true })
  writeFileSync(join(tmp, 'bin', 'curl'), fakeCurl(), { mode: 0o755 })
  const r = spawnSync('sh', ['-c', 'git init -q repo'], { cwd: tmp, encoding: 'utf8' })
  expect(r.status, r.stderr).toBe(0)
})
afterEach(() => { rmSync(tmp, { recursive: true, force: true }) })

describe('dflow.sh — /work/mine limit', () => {
  it('list 는 limit=100 을 싣고 34건을 모두 보인다', () => {
    const r = run(['list', '--scope', 'assigned'], { ASSIGNED_N: '34' })
    expect(r.status, r.stderr).toBe(0)
    expect(mineUrls().length).toBeGreaterThan(0)
    for (const u of mineUrls()) expect(u).toContain('limit=100')
    expect(r.stdout).toContain('t33')
    expect(r.stderr).not.toContain('LIST_TRUNCATED')
  })

  it('list --all 도 limit=100 을 싣는다', () => {
    const r = run(['list', '--all', '--scope', 'assigned'], { ASSIGNED_N: '2' })
    expect(r.status, r.stderr).toBe(0)
    for (const u of mineUrls()) expect(u).toContain('limit=100')
  })

  it('한 구획이 서버 상한(100건)으로 차면 LIST_TRUNCATED 를 stderr 로 경고한다', () => {
    const r = run(['list', '--scope', 'assigned'], { ASSIGNED_N: '100' })
    expect(r.status, r.stderr).toBe(0)
    expect(r.stderr).toContain('LIST_TRUNCATED assigned')
  })

  it('스크립트 안의 모든 /work/mine 호출이 limit=100 을 싣는다', () => {
    const src = readFileSync(DFLOW, 'utf8')
    const calls = src.split('\n').filter((l) => l.includes('/api/v1/agent/work/mine') && !l.trim().startsWith('#'))
    expect(calls.length).toBeGreaterThan(0)
    for (const l of calls) expect(l).toMatch(/limit=(100|\$MINE_LIMIT|\$\{MINE_LIMIT\})/)
  })
})
