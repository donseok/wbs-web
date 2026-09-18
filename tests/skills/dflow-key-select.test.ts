// tests/skills/dflow-key-select.test.ts
// 키 선택(docs/superpowers/specs/2026-09-18-dflow-key-select-design.md). dflow.sh 를 가짜 curl 로 실제 실행한다.
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const ROOT = process.cwd()
const DFLOW = join(ROOT, '.claude/skills/dflow-work/scripts/dflow.sh')

// 가짜 토큰. 형식만 서버 PAT_RE(dflow_pat_<영숫자 12>_<20자 이상>)를 따른다. 실제 키가 아니다.
const SECRET = 'x'.repeat(24)
const A = `dflow_pat_AAAAAAAAAAAA_${SECRET}` // alice · 프로젝트 P1 · 이름 있음(서버 2.4)
const B = `dflow_pat_BBBBBBBBBBBB_${SECRET}` // alice 의 둘째 키 · 프로젝트 P2 · token_name 없음(서버 2.3)
const C = `dflow_pat_CCCCCCCCCCCC_${SECRET}` // 폐기된 키 → 401
const P1 = '11111111-1111-4111-8111-111111111111'
const P2 = '22222222-2222-4222-8222-222222222222'

// dflow.sh api_raw 의 호출 꼴만 흉내 낸다: -o <파일> 에 본문, stdout 에 HTTP 코드. Authorization 의 prefix 로 가른다.
const FAKE_CURL = `#!/bin/sh
[ -n "\${FAKE_CURL_FAIL:-}" ] && exit 7
out=''; auth=''
while [ $# -gt 0 ]; do
  case "$1" in
    -o) out="$2"; shift ;;
    -H) case "$2" in Authorization:*) auth="$2" ;; esac; shift ;;
    -w|-X|--data) shift ;;
  esac
  shift
done
case "$(printf '%s' "$auth" | cut -d_ -f3)" in
  AAAAAAAAAAAA) code=200; body='{"ok":true,"user_email":"alice@example.com","token_name":"노트북","token_prefix":"AAAAAAAAAAAA","scopes":["work:read"],"kind":"user_pat","token_expires_at":"2099-01-01T00:00:00Z","contract_version":"2.4","projects":[{"id":"${P1}","name":"가","role":"member"}]}' ;;
  BBBBBBBBBBBB) code=200; body='{"ok":true,"user_email":"alice@example.com","scopes":["work:read"],"kind":"user_pat","token_expires_at":"2099-06-01T00:00:00Z","contract_version":"2.3","projects":[{"id":"${P2}","name":"나","role":"admin"}]}' ;;
  *) code=401; body='{"ok":false,"code":"unauthorized"}' ;;
esac
printf '%s' "$body" > "$out"; printf '%s' "$code"
`

let tmp: string
function run(args: string[], env: Record<string, string> = {}) {
  return spawnSync('sh', [DFLOW, ...args], {
    encoding: 'utf8',
    env: {
      PATH: `${join(tmp, 'bin')}:${process.env.PATH ?? ''}`, HOME: join(tmp, 'home'),
      XDG_CACHE_HOME: join(tmp, 'cache'), // 프로필 캐시가 실제 ~/.cache/dflow 를 건드리지 않게 한다
      DFLOW_ENV_FILE: join(tmp, 'no-such-env'),
      DFLOW_API_BASE: 'https://x.test', DFLOW_PATS: `${A},${B},${C}`, ...env,
    },
  })
}
// 어느 키로 불렀는지: A 는 P1, B 는 P2 를 돌려준다(B 의 서버는 token_prefix 를 주지 않는다).
const usedProject = (r: { stdout: string }) => JSON.parse(r.stdout).projects[0].id as string

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'dflow-key-'))
  mkdirSync(join(tmp, 'bin')); mkdirSync(join(tmp, 'home'))
  writeFileSync(join(tmp, 'bin/curl'), FAKE_CURL, { mode: 0o755 })
})
afterEach(() => rmSync(tmp, { recursive: true, force: true }))

describe('dflow.sh 키 선택(스펙 §4-1)', () => {
  it('DFLOW_AS 도 --as 도 없으면 첫 토큰을 쓴다', () => {
    const r = run(['me'])
    expect(r.status).toBe(0)
    expect(usedProject(r)).toBe(P1)
  })
  it('DFLOW_AS 가 prefix 와 같으면 그 토큰을 쓴다 — 같은 계정의 둘째 키를 고를 수 있다', () => {
    const r = run(['me'], { DFLOW_AS: 'BBBBBBBBBBBB' })
    expect(r.status).toBe(0)
    expect(usedProject(r)).toBe(P2)
  })
  it('--as 가 DFLOW_AS 를 이긴다', () => {
    const r = run(['--as', 'AAAAAAAAAAAA', 'me'], { DFLOW_AS: 'BBBBBBBBBBBB' })
    expect(r.status).toBe(0)
    expect(usedProject(r)).toBe(P1)
  })
  it('--as 는 이메일 부분 일치도 받는다(기존 동작) — 같은 계정이면 앞의 키다', () => {
    const r = run(['--as', 'alice', 'me'], { DFLOW_AS: 'BBBBBBBBBBBB' })
    expect(r.status).toBe(0)
    expect(usedProject(r)).toBe(P1)
  })
  it('DFLOW_AS 는 prefix 만 받는다 — 이메일을 적으면 exit 2', () => {
    const r = run(['me'], { DFLOW_AS: 'alice' })
    expect(r.status).toBe(2)
    expect(r.stdout).toBe('')
    expect(r.stderr).toContain('DFLOW_AS=alice')
  })
  it('DFLOW_AS 가 어느 토큰과도 안 맞으면 exit 2 — 첫 토큰으로 물러서지 않는다', () => {
    const r = run(['me'], { DFLOW_AS: 'ZZZZZZZZZZZZ' })
    expect(r.status).toBe(2)
    expect(r.stdout).toBe('')
  })
  it('.env 의 DFLOW_AS 를 자동 로드하고 CR 을 떼어 낸다', () => {
    const envFile = join(tmp, 'env-crlf')
    writeFileSync(envFile, `DFLOW_API_BASE=https://x.test\r\nDFLOW_PATS=${A},${B}\r\nDFLOW_AS=BBBBBBBBBBBB\r\n`)
    const r = run(['me'], { DFLOW_ENV_FILE: envFile, DFLOW_PATS: '', DFLOW_API_BASE: '' })
    expect(r.status).toBe(0)
    expect(usedProject(r)).toBe(P2)
  })
  it('어떤 경우에도 토큰 값을 출력하지 않는다', () => {
    for (const r of [run(['me']), run(['me'], { DFLOW_AS: 'alice' }), run(['me'], { DFLOW_AS: 'ZZZZZZZZZZZZ' })]) {
      expect(r.stdout + r.stderr).not.toContain(SECRET)
    }
  })
})
