// tests/skills/dflow-exit-cancelled.test.ts
// 중단(docs/superpowers/specs/2026-09-19-agent-stop-design.md §4) — 409 바디 code=cancelled 면 dflow.sh 는 exit 10.
// 다른 409 는 종전대로 exit 4. dflow.sh 를 가짜 curl 로 실제 실행한다(dflow-key-select.test.ts 와 같은 방식).
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const DFLOW = join(process.cwd(), '.claude/skills/dflow-work/scripts/dflow.sh')
const TOKEN = `dflow_pat_AAAAAAAAAAAA_${'x'.repeat(24)}` // 가짜 토큰(형식만)
const ORDER = '22222222-2222-4222-8222-222222222222'

// api_raw 의 호출 꼴: -o <파일> 에 본문, stdout 에 HTTP 코드. 응답은 env 로 정한다.
const FAKE_CURL = `#!/bin/sh
out=''
while [ $# -gt 0 ]; do
  case "$1" in
    -o) out="$2"; shift ;;
    -H|-w|-X|--data) shift ;;
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
      DFLOW_API_BASE: 'https://x.test', DFLOW_PATS: TOKEN, FAKE_CODE: code, FAKE_BODY: body,
    },
  })
}

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'dflow-cancel-'))
  mkdirSync(join(tmp, 'bin')); mkdirSync(join(tmp, 'home'))
  writeFileSync(join(tmp, 'bin/curl'), FAKE_CURL, { mode: 0o755 })
})
afterEach(() => rmSync(tmp, { recursive: true, force: true }))

describe('dflow.sh exit 10 — 사람이 중단한 주문', () => {
  const CANCELLED = '{"error":"작업이 중단되었습니다.","code":"cancelled"}'
  it('heartbeat 가 409 code=cancelled 를 받으면 exit 10, 바디는 stderr 로', () => {
    const r = run(['heartbeat', ORDER, '--agent', 'hong/mbp/w1', '--phase', 'build'], '409', CANCELLED)
    expect(r.status).toBe(10)
    expect(r.stderr).toContain('"code":"cancelled"')
  })
  it('progress 도 같은 규칙이다', () => {
    expect(run(['progress', ORDER, '60', '구현 완료'], '409', CANCELLED).status).toBe(10)
  })
  it('다른 409(conflict)·바디가 JSON 이 아닌 409 는 종전대로 exit 4', () => {
    expect(run(['heartbeat', ORDER, '--agent', 'a'], '409', '{"error":"x","code":"conflict"}').status).toBe(4)
    expect(run(['heartbeat', ORDER, '--agent', 'a'], '409', 'not json').status).toBe(4)
  })
  it('사용법·파일 머리의 exit 표에 10 이 있다', () => {
    const r = spawnSync('sh', [DFLOW], { encoding: 'utf8', env: { PATH: process.env.PATH ?? '', HOME: join(tmp, 'home'), NODE_ENV: process.env.NODE_ENV, DFLOW_CONFIG_DIR: join(tmp, 'no-config') } })
    expect(r.status).toBe(2)
    expect(r.stderr).toMatch(/exit: .*10 중단됨/)
  })
})
