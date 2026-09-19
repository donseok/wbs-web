// tests/skills/dflow-claim-identity.test.ts
// claim · progress · done · release 가 heartbeat(agent_id_default)와 같은 신원 산출을 쓰는지 검사한다.
// 2026-09-20: claim 이 claude-<host> 를 보내면 좌석 신원이 heartbeat_agent(=agent_id_default)와
// 어긋나(src/lib/domain/seatmap.ts:180) 첫 heartbeat 전까지 「신원 없는 에이전트」로 따로 나오던
// 버그의 회귀 가드. dflow.sh 를 가짜 curl 로 실제 실행하고, POST 본문의 agent 필드를 캡처해 검사한다.
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const ROOT = process.cwd()
const DFLOW = join(ROOT, '.claude/skills/dflow-work/scripts/dflow.sh')

const SECRET = 'x'.repeat(24)
const TOKEN = `dflow_pat_AAAAAAAAAAAA_${SECRET}`
const PID = '11111111-1111-4111-8111-111111111111'
const WORK_ID = '99999999-9999-4999-8999-999999999999'

// dflow.sh 의 host_short()·slug() 와 같은 규칙 — hostname 첫 라벨을 소문자화·비[a-z0-9-]치환.
function slug(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9-]/g, '-')
}
function hostShort() {
  return execFileSync('hostname').toString().trim().split('.')[0]
}

// 가짜 curl: dflow.sh api_raw 의 호출 꼴(-o file -w fmt -X M -H ... [--data json] url)을 흉내 낸다.
// --data 가 있으면 그 안의 agent 필드를 CAPTURE_FILE 에 한 줄씩 이어 적는다.
function fakeCurlScript() {
  return `#!/bin/sh
out=''; data=''; url=''
while [ $# -gt 0 ]; do
  case "$1" in
    -o) out="$2"; shift 2 ;;
    -X) shift 2 ;;
    -H) shift 2 ;;
    -w) shift 2 ;;
    --data) data="$2"; shift 2 ;;
    -sS) shift ;;
    *) url="$1"; shift ;;
  esac
done
if [ -n "$data" ] && [ -n "\${CAPTURE_FILE:-}" ]; then
  agent=$(printf '%s' "$data" | jq -r '.agent // empty')
  [ -n "$agent" ] && printf '%s\\n' "$agent" >> "$CAPTURE_FILE"
fi
case "$url" in
  *"/agent/work/mine"*) code=200; body='{"claimed":[],"assigned":[],"available":[{"id":"${WORK_ID}","project_id":"${PID}","status":"ready","priority":1,"item":{"name":"t"}}]}' ;;
  *"/agent/work/${WORK_ID}/claim") code=200; body='{"id":"${WORK_ID}","item":{}}' ;;
  *"/agent/work/${WORK_ID}/report") code=200; body='{"status":"ok"}' ;;
  *"/agent/work/${WORK_ID}/release") code=200; body='{"status":"released"}' ;;
  *"/agent/work/${WORK_ID}") code=200; body='{"id":"${WORK_ID}","depends_evidence":[]}' ;;
  *) code=200; body='{}' ;;
esac
printf '%s' "$body" > "$out"; printf '%s' "$code"
`
}

let tmp: string
let repo: string
let capture: string

function run(args: string[], env: Record<string, string> = {}) {
  return spawnSync('sh', [DFLOW, ...args], {
    encoding: 'utf8',
    cwd: repo,
    env: {
      // NODE_ENV 는 Next 의 ProcessEnv 타입이 필수로 요구한다(다른 skills 테스트와 같은 이유).
      NODE_ENV: process.env.NODE_ENV,
      PATH: `${join(tmp, 'bin')}:${process.env.PATH ?? ''}`,
      HOME: join(tmp, 'home'),
      XDG_CACHE_HOME: join(tmp, 'cache'),
      DFLOW_ENV_FILE: join(tmp, 'no-such-env'),
      DFLOW_API_BASE: 'https://x.test',
      DFLOW_PATS: TOKEN,
      DFLOW_PROJECT_ID: PID,
      CAPTURE_FILE: capture,
      ...env,
    },
  })
}

function capturedAgents(): string[] {
  return existsSync(capture) ? readFileSync(capture, 'utf8').trim().split('\n').filter(Boolean) : []
}

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'dflow-claim-'))
  mkdirSync(join(tmp, 'bin'))
  mkdirSync(join(tmp, 'home'))
  writeFileSync(join(tmp, 'bin/curl'), fakeCurlScript(), { mode: 0o755 })
  capture = join(tmp, 'captured-agents.txt')

  // cmd_done 은 실제 git 으로 브랜치·push 도달을 확인한다 — 로컬 저장소 + 로컬 bare 원격을 만든다.
  repo = join(tmp, 'repo')
  mkdirSync(repo)
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: repo })
  execFileSync('git', ['config', 'user.email', 'test@test.local'], { cwd: repo })
  execFileSync('git', ['config', 'user.name', 'test'], { cwd: repo })
  writeFileSync(join(repo, 'f.txt'), 'x')
  execFileSync('git', ['add', 'f.txt'], { cwd: repo })
  execFileSync('git', ['commit', '-q', '-m', 'init'], { cwd: repo })
  const bare = join(tmp, 'origin.git')
  execFileSync('git', ['init', '-q', '--bare', bare])
  execFileSync('git', ['remote', 'add', 'origin', bare], { cwd: repo })
  execFileSync('git', ['push', '-q', '-u', 'origin', 'main'], { cwd: repo })
})
afterEach(() => rmSync(tmp, { recursive: true, force: true }))

describe('dflow.sh claim/progress/done/release 신원 — heartbeat(agent_id_default)와 일치', () => {
  it('.dflow-agent 가 없으면 넷 다 claude-<host> 를 보낸다(종전 동작 유지)', () => {
    const expected = `claude-${slug(hostShort())}`

    expect(run(['claim', WORK_ID]).status).toBe(0)
    expect(run(['progress', WORK_ID, '10', '진행']).status).toBe(0)
    expect(run(['done', WORK_ID, '완료']).status).toBe(0)
    expect(run(['release', WORK_ID]).status).toBe(0)

    const agents = capturedAgents()
    expect(agents).toHaveLength(4)
    for (const a of agents) expect(a).toBe(expected)
  })

  it('.dflow-agent 가 있으면 넷 다 그 신원을 보낸다 — heartbeat 와 같은 산출', () => {
    writeFileSync(join(repo, '.dflow-agent'), 'hong/mbp/w2\n')

    expect(run(['claim', WORK_ID]).status).toBe(0)
    expect(run(['progress', WORK_ID, '10', '진행']).status).toBe(0)
    expect(run(['done', WORK_ID, '완료']).status).toBe(0)
    expect(run(['release', WORK_ID]).status).toBe(0)

    const agents = capturedAgents()
    expect(agents).toHaveLength(4)
    for (const a of agents) expect(a).toBe('hong/mbp/w2')
  })
})
