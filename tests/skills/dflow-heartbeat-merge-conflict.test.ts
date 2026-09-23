// tests/skills/dflow-heartbeat-merge-conflict.test.ts
// 팀장의 머지 충돌 표시(2026-09-23 §7.1) — dflow.sh heartbeat 가 보내는 본문과 출력. 가짜 curl 로 실제 실행한다.
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const DFLOW = join(process.cwd(), '.claude/skills/dflow-work/scripts/dflow.sh')
const TOKEN = `dflow_pat_AAAAAAAAAAAA_${'x'.repeat(24)}` // 가짜 토큰(형식만)
const ORDER = '22222222-2222-4222-8222-222222222222'

// api_raw 의 호출 꼴: -o <파일> 에 본문, stdout 에 HTTP 코드. --data 는 FAKE_DATA 파일에 남긴다.
const FAKE_CURL = `#!/bin/sh
out=''
while [ $# -gt 0 ]; do
  case "$1" in
    -o) out="$2"; shift ;;
    --data) printf '%s' "$2" > "$FAKE_DATA"; shift ;;
    -H|-w|-X) shift ;;
  esac
  shift
done
printf '%s' "$FAKE_BODY" > "$out"; printf '%s' "$FAKE_CODE"
`

let tmp: string
function run(args: string[], code: string, body: string) {
  return spawnSync('sh', [DFLOW, ...args], {
    encoding: 'utf8',
    env: {
      NODE_ENV: process.env.NODE_ENV,
      PATH: `${join(tmp, 'bin')}:${process.env.PATH ?? ''}`, HOME: join(tmp, 'home'),
      XDG_CACHE_HOME: join(tmp, 'cache'), DFLOW_ENV_FILE: join(tmp, 'no-such-env'), DFLOW_CONFIG_DIR: join(tmp, 'no-config'),
      DFLOW_API_BASE: 'https://x.test', DFLOW_PATS: TOKEN, FAKE_CODE: code, FAKE_BODY: body, FAKE_DATA: join(tmp, 'data.json'),
    },
  })
}
const sentBody = () => JSON.parse(readFileSync(join(tmp, 'data.json'), 'utf8'))

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'dflow-mc-'))
  mkdirSync(join(tmp, 'bin')); mkdirSync(join(tmp, 'home'))
  writeFileSync(join(tmp, 'bin/curl'), FAKE_CURL, { mode: 0o755 })
})
afterEach(() => rmSync(tmp, { recursive: true, force: true }))

describe('dflow.sh heartbeat — 팀장 머지 충돌 표시', () => {
  it('설정: phase·note·agent 를 싣고 MERGE_CONFLICT_SET 을 낸다', () => {
    const r = run(['heartbeat', ORDER, '--agent', 'hong/mbp/lead', '--phase', 'merge_conflict', '--note', '충돌 2개(src/a.ts…) · 해소 대기 1/3'],
      '200', '{"ok":true,"phase":"merge_conflict"}')
    expect(r.status, r.stderr).toBe(0)
    expect(r.stdout.trim()).toBe('MERGE_CONFLICT_SET')
    expect(sentBody()).toEqual({ agent: 'hong/mbp/lead', phase: 'merge_conflict', note: '충돌 2개(src/a.ts…) · 해소 대기 1/3' })
  })
  it('해제: 본문은 {agent, clear:"merge_conflict"} 이고 phase 를 싣지 않는다', () => {
    const r = run(['heartbeat', ORDER, '--agent', 'hong/mbp/lead', '--clear-merge-conflict'], '200', '{"ok":true,"phase":null,"cleared":true}')
    expect(r.status, r.stderr).toBe(0)
    expect(r.stdout.trim()).toBe('MERGE_CONFLICT_CLEARED')
    expect(sentBody()).toEqual({ agent: 'hong/mbp/lead', clear: 'merge_conflict' })
  })
  it('해제할 것이 없었으면 MERGE_CONFLICT_ABSENT(오류가 아니다)', () => {
    const r = run(['heartbeat', ORDER, '--agent', 'hong/mbp/lead', '--clear-merge-conflict'], '200', '{"ok":true,"phase":null,"cleared":false}')
    expect(r.status).toBe(0)
    expect(r.stdout.trim()).toBe('MERGE_CONFLICT_ABSENT')
  })
  it('--clear-merge-conflict 와 --phase 를 함께 주면 usage(exit 2), 서버를 부르지 않는다', () => {
    const r = run(['heartbeat', ORDER, '--agent', 'hong/mbp/lead', '--phase', 'merge_conflict', '--clear-merge-conflict'], '200', '{}')
    expect(r.status).toBe(2)
  })
  it('워커 갈래는 종전대로 last_heartbeat_at 을 낸다', () => {
    const r = run(['heartbeat', ORDER, '--agent', 'hong/mbp/w1', '--phase', 'build'], '200', '{"ok":true,"last_heartbeat_at":"2026-09-23T00:00:00Z"}')
    expect(r.stdout.trim()).toBe('2026-09-23T00:00:00Z')
  })
  it('서버 오류 코드는 종전 exit 규칙 그대로(403 → 5, 409 conflict → 4)', () => {
    expect(run(['heartbeat', ORDER, '--agent', 'hong/mbp/lead', '--clear-merge-conflict'], '403', '{"code":"not_claim_owner"}').status).toBe(5)
    expect(run(['heartbeat', ORDER, '--agent', 'hong/mbp/lead', '--phase', 'merge_conflict', '--note', 'x'], '409', '{"code":"conflict"}').status).toBe(4)
  })
  it('계약 버전은 2.7, usage 에 --clear-merge-conflict 가 있다', () => {
    const src = readFileSync(DFLOW, 'utf8')
    expect(src).toMatch(/^CONTRACT_VERSION=2\.7$/m)
    expect(src).toContain('--clear-merge-conflict')
    const doc = readFileSync(join(process.cwd(), '.claude/skills/dflow-work/references/api-contract.md'), 'utf8')
    expect(doc).toContain('# D\'Flow Agent API 계약 v2.7')
    expect(doc).toContain('## v2.7 변경점')
  })
})
