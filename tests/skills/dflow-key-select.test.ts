// tests/skills/dflow-key-select.test.ts
// 키 선택(docs/superpowers/specs/2026-09-18-dflow-key-select-design.md). dflow.sh 를 가짜 curl 로 실제 실행한다.
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
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
  BBBBBBBBBBBB) code=200; body='{"ok":true,"user_email":"'"\${FAKE_EMAIL_B:-alice@example.com}"'","scopes":["work:read"],"kind":"user_pat","token_expires_at":"2099-06-01T00:00:00Z","contract_version":"2.3","projects":[{"id":"${P2}","name":"나","role":"admin"}]}' ;;
  *) code=401; body='{"ok":false,"code":"unauthorized"}' ;;
esac
printf '%s' "$body" > "$out"; printf '%s' "$code"
`

let tmp: string
function run(args: string[], env: Record<string, string> = {}) {
  return spawnSync('sh', [DFLOW, ...args], {
    encoding: 'utf8',
    env: {
      // NODE_ENV 는 Next 의 ProcessEnv 타입이 필수로 요구한다(heartbeat-hook.test.ts 와 같은 이유). 스크립트는 읽지 않는다.
      NODE_ENV: process.env.NODE_ENV,
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

describe('dflow.sh profiles(스펙 §4-2)', () => {
  const rows = (r: { stdout: string }) => r.stdout.trim().split('\n').map((l) => JSON.parse(l))

  it('토큰마다 한 줄 — 이름·바인딩·선택 여부를 내고 토큰 값은 내지 않는다', () => {
    const r = run(['profiles'], { DFLOW_PROJECT_ID: P2 })
    expect(r.status).toBe(0)
    const [a, b, c] = rows(r)
    expect(a).toEqual({
      n: 1, prefix: 'AAAAAAAAAAAA', name: '노트북', email: 'alice@example.com', who: 'alice', kind: 'user_pat',
      expires_at: '2099-01-01T00:00:00Z', projects: [{ id: P1, name: '가' }], bound: false, selected: true,
    })
    // 서버가 2.3 이면 token_name 이 없다 — 이름만 '-' 이고 나머지는 그대로다
    expect(b).toMatchObject({ n: 2, prefix: 'BBBBBBBBBBBB', name: '-', email: 'alice@example.com', bound: true, selected: false })
    expect(c).toEqual({ n: 3, prefix: 'CCCCCCCCCCCC', error: 'auth', selected: false })
    expect(r.stdout + r.stderr).not.toContain(SECRET)
  })
  it('who 는 팀장 잠금 owner 와 같은 규칙의 신원 슬러그다 — 같은 계정의 키 둘은 who 가 같다', () => {
    const [a, b, c] = rows(run(['profiles']))
    expect(a.who).toBe('alice')
    expect(b.who).toBe('alice')
    expect(c.who).toBeUndefined()
    const [, b2] = rows(run(['profiles'], { FAKE_EMAIL_B: 'Bob.Kim+x@Example.com' }))
    expect(b2.who).toBe('bob-kim-x')
  })
  it('바인딩이 없으면 bound 는 null 이다', () => {
    const [a] = rows(run(['profiles'], { DFLOW_PROJECT_ID: '', DFLOW_PROJECT_MAP: '' }))
    expect(a.bound).toBeNull()
  })
  it('DFLOW_PROJECT_MAP 의 프로젝트도 바인딩으로 본다', () => {
    const [a, b] = rows(run(['profiles'], { DFLOW_PROJECT_MAP: `docs/a=${P1}` }))
    expect(a.bound).toBe(true)
    expect(b.bound).toBe(false)
  })
  it('DFLOW_AS 가 고른 키에 selected 가 붙는다', () => {
    const [a, b] = rows(run(['profiles'], { DFLOW_AS: 'BBBBBBBBBBBB' }))
    expect(a.selected).toBe(false)
    expect(b.selected).toBe(true)
  })
  it('DFLOW_AS 가 어느 토큰과도 안 맞아도 죽지 않고 전부 selected=false 다', () => {
    const r = run(['profiles'], { DFLOW_AS: 'ZZZZZZZZZZZZ' })
    expect(r.status).toBe(0)
    expect(rows(r).map((x) => x.selected)).toEqual([false, false, false])
  })
  it('서버에 닿지 못한 것은 죽은 키(auth)와 구분해 unreachable 로 낸다', () => {
    const r = run(['profiles'], { FAKE_CURL_FAIL: '1' })
    expect(r.status).toBe(0)
    expect(rows(r).map((x) => x.error)).toEqual(['unreachable', 'unreachable', 'unreachable'])
  })
  it('토큰이 하나도 없으면 exit 2', () => {
    expect(run(['profiles'], { DFLOW_PATS: '', DFLOW_PAT: '' }).status).toBe(2)
  })
})

describe('dflow.sh doctor 의 키 표시(스펙 §4-3)', () => {
  it('프로필 줄에 prefix·이름을 내고 고른 키에 [선택됨] 을 붙인다', () => {
    const r = run(['doctor'], { DFLOW_AS: 'BBBBBBBBBBBB' })
    expect(r.status).toBe(0)
    expect(r.stdout).toContain('프로필 1: AAAAAAAAAAAA 노트북 alice@example.com (계약 2.4, 프로젝트 1)\n')
    expect(r.stdout).toContain('프로필 2: BBBBBBBBBBBB - alice@example.com (계약 2.3, 프로젝트 1) [선택됨]\n')
    expect(r.stdout).toContain('프로필 3: CCCCCCCCCCCC 인증 실패\n')
    expect(r.stdout).not.toContain('⚠ 토큰이')
    expect(r.stdout + r.stderr).not.toContain(SECRET)
  })
  it('토큰이 둘 이상인데 DFLOW_AS 가 없으면 첫 토큰을 쓴다고 경고한다', () => {
    const r = run(['doctor'])
    expect(r.status).toBe(0)
    expect(r.stdout).toContain('(계약 2.4, 프로젝트 1) [선택됨]')
    expect(r.stdout).toContain('⚠ 토큰이 3개인데 DFLOW_AS 가 없습니다 — 첫 토큰을 씁니다(.env 에 DFLOW_AS=<prefix>).')
  })
  it('토큰이 하나면 경고하지 않는다', () => {
    expect(run(['doctor'], { DFLOW_PATS: A }).stdout).not.toContain('⚠ 토큰이')
  })
  it('DFLOW_AS 가 어느 토큰과도 안 맞으면 경고하고 exit 0 이다', () => {
    const r = run(['doctor'], { DFLOW_AS: 'ZZZZZZZZZZZZ' })
    expect(r.status).toBe(0)
    expect(r.stdout).toContain('⚠ DFLOW_AS=ZZZZZZZZZZZZ 에 맞는 토큰이 없습니다 — dflow.sh profiles 의 prefix 를 적으세요.')
    expect(r.stdout).not.toContain('[선택됨]')
  })
})

describe('/dflow-team 키 판정(스펙 §6)', () => {
  const sk = readFileSync(join(ROOT, '.claude/skills/dflow-team/SKILL.md'), 'utf8')
  const help = readFileSync(join(ROOT, '.claude/skills/dflow-team/references/help.md'), 'utf8')

  it('키 판정은 「인자」 절에 있고 종료 시각 질문·전제 검사보다 앞이다', () => {
    const args = sk.indexOf('\n## 인자')
    const key = sk.indexOf('- **키 판정**')
    const until = sk.indexOf('- **종료 시각은 유일한 필수 인자다.**')
    const env0 = sk.indexOf('\n## 0. 환경 감지')
    expect(args).toBeGreaterThan(-1)
    expect(key).toBeGreaterThan(args)
    expect(until).toBeGreaterThan(key)
    expect(env0).toBeGreaterThan(until)
    expect(sk).toContain('.claude/skills/dflow-work/scripts/dflow.sh profiles)')
  })
  it('DFLOW_AS 가 있으면 묻지 않고, 없으면 bound 후보로 좁혀 0·1·2개 이상을 가른다', () => {
    for (const s of ['`KEY_NOT_FOUND`', '`NO_KEY_FOR_PROJECT`', '`bound`', '`selected`', '그 키를 자동 선택한다', 'AskUserQuestion 으로 묻는다']) {
      expect(sk, s).toContain(s)
    }
  })
  it('종료 시각이 주어져도 키 질문은 하고, 키를 묻는 호출에서는 WP 선택지를 서버에서 뽑지 않는다', () => {
    expect(sk).toContain('**종료 시각이 인자로 주어져도 키 질문은 한다.**')
    expect(sk).toContain('키를 묻는 호출에서는 WP 범위 선택지를 서버에서 뽑지 않고')
  })
  it('고른 prefix 를 .env 끝에 더한다 — 첫 토큰이어도', () => {
    expect(sk).toContain(`printf '\\nDFLOW_AS=%s\\n' '<prefix>' >> .env`)
    expect(sk).toContain('자동 선택한 키가 첫 토큰이어도')
  })
  it('조회 실패를 후보 없음으로 뭉개지 않는다', () => {
    expect(sk).toContain('`auth`')
    expect(sk).toContain('`unreachable`')
  })
  it('시작 보고가 키를 알린다', () => {
    expect(sk).toContain('`키: <이름> (<email>, <prefix>)`')
  })
  it('help.md 가 첫 토큰이 아니라 DFLOW_AS 를 안내한다', () => {
    expect(help).not.toContain('첫 토큰이 팀장의 신원')
    expect(help).toContain('DFLOW_AS=<prefix>')
    expect(help).toContain('dflow.sh profiles')
  })
})

describe('킷·dflow-work 문서(스펙 §7)', () => {
  const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8')

  it('.env.example 에 빈 DFLOW_AS 와 prefix 설명이 있다', () => {
    const t = read('kit/.env.example')
    expect(t).toMatch(/^DFLOW_AS=$/m)
    expect(t).toContain('dflow.sh profiles')
  })
  it('api-contract.md 가 v2.4 와 두 필드를 적는다', () => {
    const t = read('.claude/skills/dflow-work/references/api-contract.md')
    expect(t).toContain('# D\'Flow Agent API 계약 v2.4')
    expect(t).toContain('"token_name"')
    expect(t).toContain('"token_prefix"')
  })
  it('dflow-work 문서와 kit README 가 DFLOW_AS·profiles·--as <prefix|email> 을 안내한다', () => {
    for (const rel of [
      '.claude/skills/dflow-work/SKILL.md', '.claude/skills/dflow-work/README.md',
      '.claude/skills/dflow-work/references/troubleshooting.md', 'kit/README.md',
    ]) {
      expect(read(rel), rel).toContain('DFLOW_AS')
      expect(read(rel), rel).toContain('dflow.sh profiles')
    }
    expect(read('.claude/skills/dflow-work/SKILL.md')).toContain('--as <prefix|email>')
    expect(read('.claude/skills/dflow-work/SKILL.md')).not.toContain('--as <이름|email>')
  })
})
