# D'Flow 스킬 키 선택 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `.env` 에 PAT 가 둘 이상일 때 어느 키로 도는지를 사람이 알 수 있게 하고, 리포마다 쓸 키를 `DFLOW_AS=<prefix>` 로 고정한다.

**Architecture:** 서버 `/me` 가 토큰 이름·prefix 를 돌려준다(계약 2.4). `dflow.sh` 는 `--as` → `DFLOW_AS` → 첫 토큰 순으로 키를 고르고, 새 명령 `profiles` 가 토큰마다 한 줄 JSON 을 낸다. heartbeat 훅은 같은 `DFLOW_AS` 를 네트워크 없이 따른다. `/dflow-team` 은 잠금 전에 `profiles` 로 키를 판정해 모호하면 묻고 `.env` 에 굳힌다.

**Tech Stack:** Next.js 15 route handler(TypeScript), POSIX sh(`dflow.sh`·`heartbeat.sh`), jq, vitest(+ `spawnSync` 로 셸 스크립트 실제 실행).

**Spec:** `docs/superpowers/specs/2026-09-18-dflow-key-select-design.md`

## Global Constraints

- 작업 위치는 워크트리 `/Users/jji/project/wbs-web-key`, 브랜치 `feat/dflow-key-select`(기점: 로컬 `staging` `5bf6e07d`). 다른 체크아웃은 건드리지 않는다.
- `git add -A` 금지. 파일명을 명시해 stage 한다. 커밋 메시지는 한국어, "무엇"보다 "왜". 끝에 `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.
- 마이그레이션 없음. `supabase/migrations/*` 를 건드리지 않는다.
- 토큰 값은 어디에도 출력·기록하지 않는다. 테스트 토큰은 `dflow_pat_<영숫자 12>_<더미>` 꼴의 가짜 값이다.
- `DFLOW_AS` 는 **prefix 만** 받는다(토큰의 셋째 `_` 칸, 서버 `PAT_RE` 의 영숫자 12자). 이메일·이름 불가.
- 키 선택 우선순위: `--as` 플래그 → `DFLOW_AS` → 첫 토큰. `--as` 매칭은 prefix 완전 일치 → 이메일 부분 일치.
- 맞는 키가 없을 때 첫 토큰으로 물러서지 않는다(`dflow.sh` 는 exit 2, 훅은 무전송 exit 0).
- 셸 스크립트는 POSIX sh. `sh -n`·`bash -n`·`zsh -n` 을 통과해야 한다. 스킬 문서의 ```bash 블록도 같다.
- 새 단언은 `tests/skills/dflow-key-select.test.ts` 와 `tests/skills/heartbeat-hook.test.ts`, `tests/agent/*` 에만 둔다. 이미 실패 중인 `dflow-team.test.ts`·`dflow-team-backends.test.ts`·`dflow-dev-worker.test.ts` 에는 섞지 않는다.
- 완료 기준: 새 테스트 전부 통과, `tests/skills`·`tests/agent` 의 기존 실패 수가 Task 1 Step 1 에서 잰 기준선보다 늘지 않음, `npx tsc --noEmit` 의 오류 수가 기준선보다 늘지 않음.
- staging 머지·push, `~/dflow-skills` 이동, 훅 사본 갱신은 이 계획의 범위 밖이다(Task 7 뒤에 사람 확인을 받고 한다).

---

### Task 1: 서버 `/me` — 토큰 이름·prefix, 계약 2.4

**Files:**
- Modify: `src/lib/agent/externalApi.ts` (`AGENT_CONTRACT_VERSION`, `AgentPrincipal`, `RunnerRow`, `resolveAgentPrincipal`)
- Modify: `src/app/api/v1/agent/me/route.ts` (응답 객체)
- Modify: `tests/agent/me-route.test.ts`, `tests/agent/resolve-principal.test.ts`, `tests/agent/mine-route.test.ts:202-206`
- Modify: `.claude/skills/dflow-work/references/api-contract.md`

**Interfaces:**
- Produces: `GET /api/v1/agent/me` 200 응답에 `token_name: string`, `token_prefix: string`, `contract_version: "2.4"`. `AgentPrincipal`(pat) 에 `runnerName: string`, `tokenPrefix: string`.

- [ ] **Step 1: 기준선을 잰다(코드를 고치기 전)**

```bash
cd /Users/jji/project/wbs-web-key
npx vitest run tests/skills tests/agent 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | grep -E 'Test Files|Tests ' 
npx vitest run tests/skills tests/agent 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | grep -E '^ FAIL ' | sed 's/ > .*//' | sort | uniq -c
npx tsc --noEmit 2>&1 | grep -c 'error TS'
```
세 출력(실패 테스트 수, 파일별 실패 수, tsc 오류 수)을 적어 둔다. 이후 모든 비교의 기준이다.

- [ ] **Step 2: 실패하는 테스트를 쓴다**

`tests/agent/me-route.test.ts` — `RUNNER` 에 `name` 을 더하고 첫 테스트의 단언을 넓힌다.

```ts
const RUNNER = {
  id: 'r-1', kind: 'user_pat', owner_user_id: 'u-1', name: '맥북 에어', token_prefix: PAT.prefix,
  token_hash: PAT.hash, project_id: null, scopes: ['work:read'], enabled: true,
  revoked_at: null, expires_at: '2099-01-01T00:00:00Z',
}
```
```ts
    expect(body.user_email).toBe('dev@example.com')
    // 계약 2.4 — 토큰이 여럿일 때 "이 키가 무엇인지" 를 알려 주는 두 필드
    expect(body.token_name).toBe('맥북 에어')
    expect(body.token_prefix).toBe(PAT.prefix)
    expect(body.contract_version).toBe('2.4')
```

`tests/agent/resolve-principal.test.ts` — 'PAT 정상' 테스트의 `row` 에 `name: 'ci'` 를 더하고 단언을 바꾼다.

```ts
    const row = {
      id: 'r-1', kind: 'user_pat', owner_user_id: 'u-1', name: 'ci', token_prefix: prefix, token_hash: hash,
      project_id: null, scopes: ['work:read'], enabled: true, revoked_at: null,
      expires_at: '2099-01-01T00:00:00Z',
    }
    const m = await load()
    const p = await m.resolveAgentPrincipal(req(`Bearer ${token}`), adminWith(row) as never)
    expect(p).toMatchObject({
      kind: 'pat', userId: 'u-1', userEmail: 'dev@example.com', scopes: ['work:read'],
      runnerName: 'ci', tokenPrefix: prefix,
    })
```

- [ ] **Step 3: 실패를 확인한다**

Run: `npx vitest run tests/agent/me-route.test.ts tests/agent/resolve-principal.test.ts`
Expected: FAIL — `expected undefined to be '맥북 에어'`, `runnerName` 없음.

- [ ] **Step 4: 구현한다**

`src/lib/agent/externalApi.ts`:

```ts
export const AGENT_CONTRACT_VERSION = '2.4'

export type AgentPrincipal =
  | { kind: 'legacy' }
  | {
      kind: 'pat'; runnerId: string; userId: string; userEmail: string
      scopes: string[]; projectId: string | null; runnerKind: 'user_pat' | 'runner'
      tokenExpiresAt: string
      /** 발급할 때 사람이 적은 이름과 조회 키(계약 2.4). /me 가 "이 키가 무엇인지" 알려 주는 데만 쓴다. */
      runnerName: string; tokenPrefix: string
    }

type RunnerRow = {
  id: string; kind: 'user_pat' | 'runner'; owner_user_id: string; name: string
  token_prefix: string; token_hash: string; project_id: string | null
  scopes: string[]; enabled: boolean; revoked_at: string | null; expires_at: string
}
```
`resolveAgentPrincipal` 의 select 와 반환:
```ts
    .select('id, kind, owner_user_id, name, token_prefix, token_hash, project_id, scopes, enabled, revoked_at, expires_at')
```
```ts
  return {
    kind: 'pat', runnerId: row.id, userId: row.owner_user_id,
    userEmail: userData.user.email.toLowerCase(), scopes: row.scopes ?? [],
    projectId: row.project_id, runnerKind: row.kind, tokenExpiresAt: row.expires_at,
    runnerName: row.name, tokenPrefix: row.token_prefix,
  }
```

`src/app/api/v1/agent/me/route.ts` 의 응답:
```ts
    return NextResponse.json({
      ok: true, user_email: principal.userEmail,
      // 계약 2.4 — .env 에 토큰이 여럿일 때 사람이 키를 알아보게 한다. prefix 는 토큰 안에 평문으로 든 조회 키다.
      token_name: principal.runnerName, token_prefix: principal.tokenPrefix,
      scopes: principal.scopes,
      kind: principal.runnerKind, token_expires_at: principal.tokenExpiresAt,
      contract_version: AGENT_CONTRACT_VERSION, projects,
    })
```

pat principal 을 리터럴로 만드는 테스트 두 곳에 새 필드를 더한다(타입 검사용).
`tests/agent/resolve-principal.test.ts` 의 `requireScope` 테스트:
```ts
    const pat = {
      kind: 'pat', runnerId: 'r', userId: 'u', userEmail: 'e', scopes: ['work:read'],
      projectId: null, runnerKind: 'user_pat', tokenExpiresAt: '2099-01-01T00:00:00Z',
      runnerName: 'n', tokenPrefix: 'p',
    } as const
```
`tests/agent/mine-route.test.ts` 의 `patPrincipal`:
```ts
  const patPrincipal = {
    kind: 'pat' as const, runnerId: 'r-1', userId: 'u-1', userEmail: 'dev@example.com',
    scopes: ['work:read'], projectId: null, runnerKind: 'user_pat' as const,
    tokenExpiresAt: '2099-01-01T00:00:00Z', runnerName: 'n', tokenPrefix: 'p',
  }
```

- [ ] **Step 5: 통과를 확인한다**

Run: `npx vitest run tests/agent && npx tsc --noEmit 2>&1 | grep -c 'error TS'`
Expected: `tests/agent` 전부 PASS(기준선에서 실패하던 것이 있었다면 그 수 그대로). tsc 오류 수가 기준선과 같다.

- [ ] **Step 6: 계약 문서를 고친다**

`.claude/skills/dflow-work/references/api-contract.md`:
1. 첫 줄 `# D'Flow Agent API 계약 v2.3` → `# D'Flow Agent API 계약 v2.4`.
2. 셋째 줄의 `` `contract_version: "2.3"` `` → `` `contract_version: "2.4"` ``, 그 줄 끝에 ` v2.4는 `/me` 에 토큰 이름·prefix 를 더했다.` 를 붙인다.
3. `## v2.3 변경점 (2026-09-15)` **앞에** 새 절을 넣는다.
```markdown
## v2.4 변경점 (2026-09-18)

- `GET /agent/me` 응답에 `token_name`(발급할 때 적은 이름)·`token_prefix`(토큰의 셋째 `_` 칸)를 더했다. 필드 추가뿐이라
  minor 다. 이유: `.env` 에 토큰이 둘 이상이면 어느 키로 도는지 사람이 알아볼 수 없었고, 한 계정에 키가 둘이면
  이메일로도 갈리지 않는다. prefix 는 토큰 문자열 안에 평문으로 든 조회 키라 응답에 실어도 비밀이 늘지 않는다.
- 클라이언트: `dflow.sh profiles`(토큰마다 한 줄 JSON) · `.env` 의 `DFLOW_AS=<prefix>`(리포가 쓸 키 고정) ·
  `--as <prefix|email>`. 설계 정본: `docs/superpowers/specs/2026-09-18-dflow-key-select-design.md`.

```
4. `GET /agent/me` 200 예시를 바꾼다.
```json
{ "ok": true, "user_email": "a@b.c", "token_name": "맥북 에어", "token_prefix": "OxMb1D1097Qz",
  "scopes": ["work:read"], "kind": "user_pat",
  "token_expires_at": "2026-11-08T00:00:00Z", "contract_version": "2.4",
  "projects": [{ "id": "<uuid>", "name": "…", "role": "admin|member|superuser" }] }
```
5. 그 아래 문단의 `— 현재 `"2.3"`.` → `— 현재 `"2.4"`.`
6. `- 신원 해석: … `--as <이름|email>` 프로필 선택.` 줄을 바꾼다.
```markdown
- 신원 해석: 토큰별 `GET /agent/me` 1회 → `~/.cache/dflow/profiles.json` 캐시. 키 선택은 `--as <prefix|email>` →
  `.env` 의 `DFLOW_AS`(prefix 만) → 첫 토큰. prefix 일치는 `/me` 를 부르지 않는다. 목록은 `dflow.sh profiles`.
```

- [ ] **Step 7: 커밋한다**

```bash
git add src/lib/agent/externalApi.ts src/app/api/v1/agent/me/route.ts \
  tests/agent/me-route.test.ts tests/agent/resolve-principal.test.ts tests/agent/mine-route.test.ts \
  .claude/skills/dflow-work/references/api-contract.md
git commit -m "$(cat <<'EOF'
feat(agent): /me 가 토큰 이름과 prefix 를 돌려준다 — 계약 2.4

.env 에 PAT 가 둘 이상이면 어느 키로 도는지 알 길이 없었다. 한 계정에 키가 둘이면 이메일로도
갈리지 않는다. 이름은 agent_runners.name 에 이미 있어 마이그레이션 없이 응답에만 싣는다.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: `dflow.sh` 키 선택 — prefix 일치, `DFLOW_AS`, 우선순위

**Files:**
- Create: `tests/skills/dflow-key-select.test.ts`
- Modify: `.claude/skills/dflow-work/scripts/dflow.sh` (`CONTRACT_VERSION`, `usage`, CR 제거 목록, `profile_email`, `pick_token`, main)
- Modify: `tests/skills/dflow-team-kit.test.ts` (CR 제거 목록 단언 한 줄)

**Interfaces:**
- Produces: 셸 함수 `token_prefix <token>` → prefix 를 stdout. `pick_token <값> [<exact>]` → 토큰을 stdout, 없으면 exit 2. 전역 `AS`(선택 값)·`AS_EXACT`(`1` 이면 prefix 일치만). 테스트 하네스 `run(args, env)`·상수 `A`·`B`·`C`·`P1`·`P2`·`SECRET`(Task 3 이 같은 파일에서 쓴다).

- [ ] **Step 1: 하네스와 실패하는 테스트를 쓴다**

`tests/skills/dflow-key-select.test.ts`:

```ts
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
```

- [ ] **Step 2: 실패를 확인한다**

Run: `npx vitest run tests/skills/dflow-key-select.test.ts`
Expected: FAIL — 'DFLOW_AS 가 prefix 와 같으면…'(P1 이 나옴), 'DFLOW_AS 는 prefix 만…'(status 0), '…안 맞으면 exit 2'(status 0), '.env 의 DFLOW_AS…'(P1). 첫 토큰·`--as alice` 테스트는 지금도 통과한다.

- [ ] **Step 3: 구현한다**

`.claude/skills/dflow-work/scripts/dflow.sh`:

1. `CONTRACT_VERSION=2.3` → `CONTRACT_VERSION=2.4`.
2. `usage` 의 첫 두 줄:
```
사용법: dflow.sh [--as <prefix|email>] <cmd> [args]
  키 선택: --as → .env 의 DFLOW_AS(prefix 만) → 첫 토큰. 한 계정에 키가 둘이면 email 로는 갈리지 않는다
  me                     현재 프로필 신원·접근 프로젝트
```
3. CR 제거 목록에 `DFLOW_AS` 를 더한다.
```sh
for _v in DFLOW_API_BASE DFLOW_PATS DFLOW_PAT DFLOW_PROJECT_ID DFLOW_PROJECT_MAP DFLOW_AS; do
```
4. `tokens()` 바로 아래에 `token_prefix` 를 두고, `profile_email` 의 `_pfx` 를 그것으로 구한다.
```sh
# 토큰의 prefix — dflow_pat_<prefix>_<secret> 의 셋째 '_' 칸(서버 PAT_RE). 비밀이 아니라 조회 키다.
token_prefix() { printf '%s' "$1" | cut -d_ -f3; }
```
```sh
profile_email() { # $1=token → 캐시에서 email, 없으면 /me 조회 후 캐시
  _pfx=$(token_prefix "$1")
```
5. `pick_token` 을 통째로 바꾼다.
```sh
# 키 선택: --as → DFLOW_AS → 첫 토큰. ① prefix 완전 일치(네트워크 없음) ② --as 에 한해 이메일 부분 일치.
# DFLOW_AS 는 prefix 만 받는다 — heartbeat 훅이 /me 없이 같은 키를 골라야 하기 때문이다. 맞는 키가 없을 때
# 첫 토큰으로 물러서지 않는다. 다른 신원으로 조용히 도는 것이 이 선택이 막으려는 오동작이다.
pick_token() { # $1=선택 값('' 허용) $2=1 이면 prefix 일치만(DFLOW_AS)
  _want="$1"; _found=''
  for _t in $(tokens); do
    [ -z "$_want" ] && { printf '%s' "$_t"; return 0; }
    [ "$(token_prefix "$_t")" = "$_want" ] && { printf '%s' "$_t"; return 0; }
  done
  [ -z "${2:-}" ] || die 2 "DFLOW_AS=$_want 에 맞는 토큰이 없습니다 — prefix 만 받습니다(dflow.sh profiles 로 확인)."
  for _t in $(tokens); do
    _e=$(profile_email "$_t") || continue
    case "$_e" in *"$_want"*) _found="$_t"; break;; esac
  done
  [ -n "$_found" ] || die 2 "프로필을 찾지 못했습니다: $_want"
  printf '%s' "$_found"
}
```
6. main 의 `AS` 초기화와 `pick_token` 호출.
```sh
AS="${DFLOW_AS:-}"; AS_EXACT=1          # .env 의 DFLOW_AS 는 prefix 만
[ "${1:-}" = "--as" ] && { AS="$2"; AS_EXACT=''; shift 2; }
```
```sh
  *) TOK=$(pick_token "$AS" "$AS_EXACT") || exit 2
```

`tests/skills/dflow-team-kit.test.ts` 의 CR 목록 단언을 새 줄에 맞춘다.
```ts
    expect(dflow).toContain('for _v in DFLOW_API_BASE DFLOW_PATS DFLOW_PAT DFLOW_PROJECT_ID DFLOW_PROJECT_MAP DFLOW_AS; do')
```

- [ ] **Step 4: 통과를 확인한다**

Run: `npx vitest run tests/skills/dflow-key-select.test.ts tests/skills/dflow-team-kit.test.ts tests/skills/shell-syntax.test.ts`
Expected: 셋 다 PASS.

- [ ] **Step 5: 커밋한다**

```bash
git add .claude/skills/dflow-work/scripts/dflow.sh tests/skills/dflow-key-select.test.ts tests/skills/dflow-team-kit.test.ts
git commit -m "$(cat <<'EOF'
feat(dflow): 키를 prefix 로 고르고 .env 의 DFLOW_AS 로 리포마다 고정한다

--as 는 이메일 부분 일치라 한 계정의 키 둘을 가르지 못했고, 스킬·poll·훅 어디에도 --as 를
넘기는 단계가 없어 실제로는 언제나 첫 토큰이었다. DFLOW_AS 는 prefix 만 받고, 맞는 키가
없으면 첫 토큰으로 물러서지 않고 exit 2 로 끝낸다.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: `dflow.sh profiles` 와 `doctor` 의 키 표시

**Files:**
- Modify: `.claude/skills/dflow-work/scripts/dflow.sh` (`usage`, 새 `cmd_profiles`, `cmd_doctor`, main 의 case)
- Modify: `tests/skills/dflow-key-select.test.ts` (describe 둘 추가)

**Interfaces:**
- Consumes: Task 2 의 `token_prefix`·`pick_token`·`AS`·`AS_EXACT`, 테스트 하네스 `run`·`A`·`B`·`C`·`P1`·`P2`·`SECRET`.
- Produces: `dflow.sh profiles` — 토큰마다 한 줄 JSON. 성공 행 `{n, prefix, name, email, kind, expires_at, projects:[{id,name}], bound:true|false|null, selected}`, 실패 행 `{n, prefix, error:"auth"|"unreachable", selected}`. exit 0(토큰이 없으면 2). Task 5 의 스킬 문서가 이 출력을 읽는다.

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`tests/skills/dflow-key-select.test.ts` 끝에 더한다.

```ts
describe('dflow.sh profiles(스펙 §4-2)', () => {
  const rows = (r: { stdout: string }) => r.stdout.trim().split('\n').map((l) => JSON.parse(l))

  it('토큰마다 한 줄 — 이름·바인딩·선택 여부를 내고 토큰 값은 내지 않는다', () => {
    const r = run(['profiles'], { DFLOW_PROJECT_ID: P2 })
    expect(r.status).toBe(0)
    const [a, b, c] = rows(r)
    expect(a).toEqual({
      n: 1, prefix: 'AAAAAAAAAAAA', name: '노트북', email: 'alice@example.com', kind: 'user_pat',
      expires_at: '2099-01-01T00:00:00Z', projects: [{ id: P1, name: '가' }], bound: false, selected: true,
    })
    // 서버가 2.3 이면 token_name 이 없다 — 이름만 '-' 이고 나머지는 그대로다
    expect(b).toMatchObject({ n: 2, prefix: 'BBBBBBBBBBBB', name: '-', email: 'alice@example.com', bound: true, selected: false })
    expect(c).toEqual({ n: 3, prefix: 'CCCCCCCCCCCC', error: 'auth', selected: false })
    expect(r.stdout + r.stderr).not.toContain(SECRET)
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
```

- [ ] **Step 2: 실패를 확인한다**

Run: `npx vitest run tests/skills/dflow-key-select.test.ts`
Expected: FAIL — `profiles` 는 usage(exit 2), doctor 줄은 옛 형식.

- [ ] **Step 3: 구현한다**

`usage` 의 `doctor` 줄 위에 더한다.
```
  profiles               토큰마다 한 줄 JSON(n·prefix·name·email·expires_at·projects·bound·selected). 토큰 값은 내지 않는다
```

`cmd_doctor` 위에 `cmd_profiles` 를 둔다.
```sh
# 토큰마다 한 줄 JSON — /dflow-team 의 키 판정과 사람의 진단이 같은 출력을 읽는다. 토큰 값은 내지 않는다.
cmd_profiles() {
  _toks=$(tokens) || exit $?
  # 지금 설정이 고르는 키. 맞는 키가 없어도 죽지 않는다 — 진단 명령이 진단할 상황에서 죽으면 안 된다.
  _sel=$(pick_token "$AS" "$AS_EXACT" 2>/dev/null) || _sel=''
  _n=0
  printf '%s\n' "$_toks" | while IFS= read -r _t; do
    [ -n "$_t" ] || continue
    _n=$((_n+1)); _issel=false
    [ -n "$_sel" ] && [ "$_t" = "$_sel" ] && _issel=true
    _me=$(TOKEN="$_t" api_raw GET /api/v1/agent/me 2>/dev/null); _rc=$?
    if [ "$_rc" -eq 0 ]; then
      printf '%s' "$_me" | jq -c --argjson n "$_n" --arg p "$(token_prefix "$_t")" \
        --arg ps "$ALLOWED_PROJECTS" --argjson s "$_issel" '
        ($ps | split("\n") | map(select(. != ""))) as $ok
        | {n: $n, prefix: $p, name: (.token_name // "-"), email: .user_email, kind: .kind,
           expires_at: .token_expires_at, projects: [.projects[]? | {id, name}],
           bound: (if ($ok | length) == 0 then null
                   else ([.projects[]?.id] | any(. as $i | $ok | index($i) != null)) end),
           selected: $s}'
    else
      # 401(exit 3)은 키가 죽은 것이고 그 밖은 서버·네트워크다. 처방이 달라 한 단어로 뭉개지 않는다.
      _err=unreachable; [ "$_rc" -eq 3 ] && _err=auth
      jq -nc --argjson n "$_n" --arg p "$(token_prefix "$_t")" --arg e "$_err" --argjson s "$_issel" \
        '{n: $n, prefix: $p, error: $e, selected: $s}'
    fi
  done
}
```

`cmd_doctor` 를 통째로 바꾼다.
```sh
cmd_doctor() {
  need curl; need jq
  _base=$(base) || exit $?
  printf 'base: %s\n' "$_base"
  _n=0
  _toks=$(tokens) || exit $?
  _sel=$(pick_token "$AS" "$AS_EXACT" 2>/dev/null) || _sel=''
  # printf '%s' 는 개행을 안 붙인다 — POSIX read 는 구분자 없이 끝난 마지막 줄에서 0 이 아닌
  # 값을 돌려주므로 루프 본문이 그 줄에 대해 아예 실행되지 않는다. 토큰이 하나뿐이면
  # 반복이 0 회가 되고 rc 는 0 이라, doctor 가 아무것도 안 찍고 성공으로 끝났다(2026-08-27 감사).
  printf '%s\n' "$_toks" | while IFS= read -r _t; do
    [ -n "$_t" ] || continue
    _n=$((_n+1))
    _mark=''; [ -n "$_sel" ] && [ "$_t" = "$_sel" ] && _mark=' [선택됨]'
    _me=$(TOKEN="$_t" api_raw GET /api/v1/agent/me) \
      || { printf '프로필 %d: %s 인증 실패%s\n' "$_n" "$(token_prefix "$_t")" "$_mark"; continue; }
    _cv=$(printf '%s' "$_me" | jq -r '.contract_version' 2>/dev/null)
    # prefix·이름을 함께 찍는다 — 한 계정에 키가 둘이면 email 만으로는 어느 키인지 알 수 없다.
    printf '프로필 %d: %s %s %s (계약 %s, 프로젝트 %d)%s\n' "$_n" "$(token_prefix "$_t")" \
      "$(printf '%s' "$_me" | jq -r '.token_name // "-"' 2>/dev/null)" \
      "$(printf '%s' "$_me" | jq -r '.user_email' 2>/dev/null)" "$_cv" \
      "$(printf '%s' "$_me" | jq -r '.projects | length' 2>/dev/null)" "$_mark"
    # 값이 없는 것과 major 가 다른 것은 처방이 다르다 — 전자는 킷을 갱신해도 안 고쳐진다.
    if [ -z "$_cv" ] || [ "$_cv" = "null" ]; then
      printf '  ⚠ 계약 버전 확인 불가 — /me 응답에 contract_version 이 없습니다(서버 배포·응답을 확인하세요).\n'
    elif [ "${_cv%%.*}" != "${CONTRACT_VERSION%%.*}" ]; then
      printf '  ⚠ 계약 major 불일치(서버 %s / 스킬 %s) — install.sh 재실행으로 킷을 갱신하세요.\n' \
        "$_cv" "$CONTRACT_VERSION"
    fi
  done
  # 키 선택 경고 — 토큰이 여럿인데 고정하지 않았거나, 고정한 값이 어느 토큰과도 맞지 않는다.
  # pick_token 은 실패하면 exit 하므로 서브셸에서 부른다.
  _cnt=$(printf '%s\n' "$_toks" | grep -c .)
  if [ -n "${DFLOW_AS:-}" ]; then
    ( pick_token "$DFLOW_AS" 1 ) >/dev/null 2>&1 \
      || printf '⚠ DFLOW_AS=%s 에 맞는 토큰이 없습니다 — dflow.sh profiles 의 prefix 를 적으세요.\n' "$DFLOW_AS"
  elif [ "$_cnt" -ge 2 ]; then
    printf '⚠ 토큰이 %d개인데 DFLOW_AS 가 없습니다 — 첫 토큰을 씁니다(.env 에 DFLOW_AS=<prefix>).\n' "$_cnt"
  fi
}
```

main 의 case:
```sh
  doctor|profiles) "cmd_$CMD" "$@" ;;   # 전 프로필 순회라 TOK 불필요
```

- [ ] **Step 4: 통과를 확인한다**

Run: `npx vitest run tests/skills/dflow-key-select.test.ts tests/skills/dflow-team-kit.test.ts tests/skills/shell-syntax.test.ts`
Expected: 셋 다 PASS(`dflow-team-kit` 의 F1 doctor 테스트 포함).

- [ ] **Step 5: 커밋한다**

```bash
git add .claude/skills/dflow-work/scripts/dflow.sh tests/skills/dflow-key-select.test.ts
git commit -m "$(cat <<'EOF'
feat(dflow): profiles 명령과 doctor 의 키 표시

키를 고르려면 먼저 키가 무엇인지 보여야 한다. profiles 는 토큰마다 prefix·이름·email·프로젝트와
이 리포 바인딩에 속하는지(bound), 지금 설정이 고르는 키인지(selected)를 한 줄 JSON 으로 낸다.
죽은 키(auth)와 닿지 않는 서버(unreachable)는 처방이 달라 구분한다. 토큰 값은 내지 않는다.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: heartbeat 훅이 `DFLOW_AS` 를 따른다

**Files:**
- Modify: `kit/hooks/heartbeat.sh` (5번 인증 블록)
- Modify: `tests/skills/heartbeat-hook.test.ts` (테스트 다섯 추가)

**Interfaces:**
- Consumes: `.env` 의 `DFLOW_AS`(prefix), `DFLOW_PATS`·`DFLOW_PAT`.
- Produces: 훅이 보내는 `Authorization: Bearer <고른 토큰>`. 맞는 토큰이 없으면 무전송 exit 0.

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`tests/skills/heartbeat-hook.test.ts` 의 `describe` 안, 마지막 `it.skipIf` 앞에 더한다.

```ts
  // 키 선택(docs/superpowers/specs/2026-09-18-dflow-key-select-design.md §5)
  const TWO = 'DFLOW_PATS=dflow_pat_AAAAAAAAAAAA_s1,dflow_pat_BBBBBBBBBBBB_s2\n'
  it('DFLOW_AS 가 있으면 그 prefix 의 토큰으로 보낸다', () => {
    writeFileSync(join(repo, '.dflow-agent'), 'hong/mbp/w2\n')
    writeFileSync(join(repo, '.env'), `DFLOW_API_BASE=https://x.test\n${TWO}DFLOW_AS=BBBBBBBBBBBB\n`)
    run()
    expect(sent()).toHaveLength(1)
    expect(sent()[0]).toContain('Bearer dflow_pat_BBBBBBBBBBBB_s2')
  })
  it('DFLOW_AS 가 어느 토큰과도 안 맞으면 보내지 않는다 — 첫 토큰으로 물러서지 않는다', () => {
    writeFileSync(join(repo, '.dflow-agent'), 'hong/mbp/w2\n')
    writeFileSync(join(repo, '.env'), `DFLOW_API_BASE=https://x.test\n${TWO}DFLOW_AS=ZZZZZZZZZZZZ\n`)
    run(); expect(sent()).toHaveLength(0)
  })
  it('DFLOW_AS 가 없으면 지금처럼 첫 토큰으로 보낸다', () => {
    writeFileSync(join(repo, '.dflow-agent'), 'hong/mbp/w2\n')
    writeFileSync(join(repo, '.env'), `DFLOW_API_BASE=https://x.test\n${TWO}`)
    run()
    expect(sent()).toHaveLength(1)
    expect(sent()[0]).toContain('Bearer dflow_pat_AAAAAAAAAAAA_s1')
  })
  it('DFLOW_PAT 단일 토큰에도 DFLOW_AS 를 적용한다', () => {
    writeFileSync(join(repo, '.dflow-agent'), 'hong/mbp/w2\n')
    writeFileSync(join(repo, '.env'), 'DFLOW_API_BASE=https://x.test\nDFLOW_PAT=dflow_pat_AAAAAAAAAAAA_s1\nDFLOW_AS=BBBBBBBBBBBB\n')
    run(); expect(sent()).toHaveLength(0)
  })
  it('.env 가 CRLF 여도 DFLOW_AS 를 맞춘다', () => {
    writeFileSync(join(repo, '.dflow-agent'), 'hong/mbp/w2\n')
    writeFileSync(join(repo, '.env'), `DFLOW_API_BASE=https://x.test\r\n${TWO.replace('\n', '\r\n')}DFLOW_AS=BBBBBBBBBBBB\r\n`)
    run()
    expect(sent()).toHaveLength(1)
    expect(sent()[0]).toContain('Bearer dflow_pat_BBBBBBBBBBBB_s2')
  })
```

- [ ] **Step 2: 실패를 확인한다**

Run: `npx vitest run tests/skills/heartbeat-hook.test.ts`
Expected: FAIL — 첫째(A 로 보냄), 둘째(1건 보냄), 넷째(1건 보냄), 다섯째(A 로 보냄). 셋째는 지금도 통과한다.

- [ ] **Step 3: 구현한다**

`kit/hooks/heartbeat.sh` 의 5번 블록에서 `_tok=` 한 줄과 그 아래 `tr -d` 줄을 바꾼다.

```sh
# 5) 인증: 루트 .env (팀원 워크트리에는 심링크가 있다). 토큰은 env 로만 다룬다 — 출력·기록 금지.
[ -f "$_top/.env" ] || exit 0
set -a; . "$_top/.env" 2>/dev/null; set +a
_base="${DFLOW_API_BASE:-}"; [ -n "$_base" ] || exit 0
_all="${DFLOW_PATS:-}"; [ -n "$_all" ] || _all="${DFLOW_PAT:-}"; [ -n "$_all" ] || exit 0
_base=$(printf '%s' "$_base" | tr -d '\r'); _all=$(printf '%s' "$_all" | tr -d '\r')
_as=$(printf '%s' "${DFLOW_AS:-}" | tr -d '\r')
# 키 선택: DFLOW_AS(prefix = 토큰의 셋째 '_' 칸)가 있으면 그 토큰만 쓴다. dflow.sh 의 pick_token 과 같은 규칙이다.
# 맞는 토큰이 없으면 보내지 않는다 — 첫 토큰으로 물러서면 다른 신원의 좌석에 heartbeat 가 찍힌다(fail-closed).
if [ -n "$_as" ]; then
  _tok=''; _rest="$_all,"
  while [ -n "$_rest" ]; do
    _c="${_rest%%,*}"; _rest="${_rest#*,}"
    [ "$(printf '%s' "$_c" | cut -d_ -f3)" = "$_as" ] && { _tok="$_c"; break; }
  done
  [ -n "$_tok" ] || exit 0
else
  _tok="${_all%%,*}"
fi
```

- [ ] **Step 4: 통과를 확인한다**

Run: `npx vitest run tests/skills/heartbeat-hook.test.ts tests/skills/shell-syntax.test.ts`
Expected: PASS(기존 테스트 포함. dash 가 있으면 dash 테스트도).

- [ ] **Step 5: 커밋한다**

```bash
git add kit/hooks/heartbeat.sh tests/skills/heartbeat-hook.test.ts
git commit -m "$(cat <<'EOF'
feat(kit): heartbeat 훅이 DFLOW_AS 의 키로 보낸다

훅은 dflow.sh 를 거치지 않고 첫 토큰을 직접 썼다. 리포의 키를 DFLOW_AS 로 고정해도 팀원의
heartbeat 만 다른 신원으로 찍히게 된다. 맞는 토큰이 없으면 첫 토큰으로 물러서지 않고 보내지 않는다.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: `/dflow-team` 의 키 판정

**Files:**
- Modify: `.claude/skills/dflow-team/SKILL.md` (「인자」 절, 「1. 시작」 3번)
- Modify: `.claude/skills/dflow-team/references/help.md` (「시작 전 준비」)
- Modify: `tests/skills/dflow-key-select.test.ts` (describe 하나 추가)

**Interfaces:**
- Consumes: Task 3 의 `dflow.sh profiles` 출력(`n`·`prefix`·`name`·`email`·`expires_at`·`projects`·`bound`·`selected`·`error`).
- Produces: 스킬 문서의 「키 판정」 절차. 중단 코드 `KEY_NOT_FOUND`·`NO_KEY_FOR_PROJECT`.

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`tests/skills/dflow-key-select.test.ts` 의 import 에 `readFileSync` 를 더하고(`import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'`), 끝에 더한다.

```ts
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
```

- [ ] **Step 2: 실패를 확인한다**

Run: `npx vitest run tests/skills/dflow-key-select.test.ts -t '키 판정'`
Expected: FAIL 7건.

- [ ] **Step 3: SKILL.md 「인자」 절에 키 판정을 넣는다**

`- **`help`**: …` 불릿 다음, `- **종료 시각은 유일한 필수 인자다.**` 불릿 **앞**에 넣는다.

````markdown
- **키 판정**: `.env` 의 `DFLOW_PATS` 에 토큰이 둘 이상이면 어느 키로 돌지를 시작 전에 정한다. 「1. 시작」 전제 검사
  **전**, 다른 인자의 질문보다 **먼저** 한다. 이유: 잠금을 쥔 채 사람의 답을 기다리지 않아야 하고, WP 범위
  선택지를 뽑는 `list` 도 전제 검사의 `me` 도 고른 키로 돌아야 한다. 정본은 `.env` 의 `DFLOW_AS=<prefix>` 이며
  `dflow.sh`·`poll.sh`·팀원(`.env` 심링크)·heartbeat 훅이 모두 그 값을 따른다. 실행마다 골라 워커에 넘기지 않는
  이유: 훅과 `/dflow-dev` 의 하위 Phase 는 그 값을 받지 못해 팀장과 팀원의 신원이 갈라진다.
  ```bash
  (set -a; . ./.env; set +a; echo "DFLOW_AS=${DFLOW_AS:-없음}"; .claude/skills/dflow-work/scripts/dflow.sh profiles)
  ```
  토큰마다 한 줄 JSON 이 나온다(`n`·`prefix`·`name`·`email`·`expires_at`·`projects`·`bound`·`selected`, `/me` 가 실패한
  토큰은 `error`). 토큰 값은 나오지 않는다. `bound` 는 그 키의 프로젝트에 이 리포의 바인딩 프로젝트가 있다는 뜻이고,
  `selected` 는 지금 설정으로 `dflow.sh` 가 고르는 키다.

  | 상태 | 처리 |
  |---|---|
  | `DFLOW_AS` 가 있다(값이 비어 있지 않다) | 묻지 않는다. `selected` 가 `true` 인 행이 없으면 `KEY_NOT_FOUND` 로 끝낸다 |
  | 없고 토큰이 1개 | 그대로 간다 |
  | 없고 토큰이 2개 이상 | `error` 가 없고 `bound` 가 `true` 인 행이 후보다 |
  | → 후보 0개 | `NO_KEY_FOR_PROJECT` 로 끝낸다 |
  | → 후보 1개 | 그 키를 자동 선택한다 |
  | → 후보 2개 이상 | AskUserQuestion 으로 묻는다. 종료 시각도 물어야 하면 같은 호출에 모은다 |

  - `bound` 가 `null` 이면(프로젝트 바인딩 없음) 키 판정을 건너뛰고 전제 검사로 간다. `NO_PROJECT` 가 시작을 막는다.
  - 선택지는 후보마다 하나다. label 은 `<name> · <email>`, description 은 `prefix <prefix> · <프로젝트 이름들> · 만료
    <expires_at 의 날짜>` 다. 후보가 4개를 넘으면 앞의 3개를 내고 나머지는 "Other 에 prefix 를 적는다" 로 받는다.
  - **종료 시각이 인자로 주어져도 키 질문은 한다.** 인원·WP 범위는 기본값이 있어 묻지 않지만, 신원에는 안전한
    기본값이 없다.
  - 키를 묻는 호출에서는 WP 범위 선택지를 서버에서 뽑지 않고 `전체 (기본)` 과 "Other 로 직접 적는다" 만 둔다. 이유:
    그 목록은 고른 키로 조회해야 하는데, 키는 같은 호출의 답으로 정해진다.
  - 자동 선택이든 답이든, 고른 prefix 를 `.env` 끝에 더하고 한 줄 보고한다. 자동 선택한 키가 첫 토큰이어도
    더한다. 이유: 나중에 토큰을 더하거나 순서를 바꿔도 이 리포의 키가 바뀌지 않는다.
    ```bash
    printf '\nDFLOW_AS=%s\n' '<prefix>' >> .env
    ```
    보고: "키: <이름> (<email>, <prefix>). `.env` 에 `DFLOW_AS` 로 저장했습니다. 바꾸려면 그 줄을 고치십시오."
    `.env` 는 gitignore 대상이라 전제 검사의 `DIRTY` 에 걸리지 않는다.
  - `KEY_NOT_FOUND`: "`.env` 의 `DFLOW_AS` 가 어느 토큰과도 맞지 않는다. `dflow.sh profiles` 의 `prefix` 로 고쳐라" 와
    profiles 출력을 표로 내고 끝낸다. `DFLOW_AS` 는 prefix 만 받는다(이메일·이름 불가). 훅이 네트워크 없이 같은 키를
    골라야 하기 때문이다.
  - `NO_KEY_FOR_PROJECT`: "이 리포의 D'Flow 프로젝트에 속한 키가 `.env` 에 없다" 와 profiles 출력을 표로 내고 끝낸다.
    `error` 가 `auth` 인 행은 "폐기·만료된 키", `unreachable` 인 행은 "서버에 닿지 못함" 으로 적는다. 조회 실패를
    후보 없음으로 뭉개지 않기 위해서다.
  - profiles 가 0 이 아닌 값으로 끝나면 그 stderr 를 그대로 보고하고 끝낸다.
````

- [ ] **Step 4: 「1. 시작」 3번 시작 보고에 키 줄을 넣는다**

3번의 첫 문장 `3. **시작 보고**: 2번이 만든 **"멈춤" 표**(「팀장 상태」)를 먼저 내고,` 바로 **앞**이 아니라, 그 문단의 끝(`…중첩 attach 가 거부되기 때문이다.`) 뒤에 같은 들여쓰기로 한 문단을 더한다.

```markdown
   종료 시각 줄 바로 다음에 `키: <이름> (<email>, <prefix>)` 를 적는다. 토큰이 하나여도 적는다. 값은 「인자」 키 판정의
   `selected` 행이다. 이유: 어느 신원으로 도는지가 배정 목록·좌석표 신원·claim 주체를 모두 정하는데, 지금까지는
   시작 보고 어디에도 나오지 않았다.
```

- [ ] **Step 5: help.md 「시작 전 준비」 를 고친다**

`- `.env` 에 세 가지가 있어야 한다: `DFLOW_API_BASE`, `DFLOW_PATS`(첫 토큰이 팀장의 신원),` 의 괄호를 지우고(`` `DFLOW_PATS`, `` 로), 그 불릿 다음에 불릿 하나를 더한다.

```markdown
- `DFLOW_PATS` 에 토큰이 둘 이상이면 팀장이 시작할 때 이 리포가 쓸 키를 정해 `.env` 에 `DFLOW_AS=<prefix>` 로 적는다.
  이 리포의 프로젝트에 속한 키가 하나면 묻지 않고 고르고, 둘 이상이면 묻는다. 바꾸려면 그 줄을 고친다. 키 목록은
  `.claude/skills/dflow-work/scripts/dflow.sh profiles` 로 본다. 시작 보고에 `키: <이름> (<email>, <prefix>)` 가 나온다.
```

- [ ] **Step 6: 통과를 확인한다**

Run: `npx vitest run tests/skills/dflow-key-select.test.ts tests/skills/dflow-team-shell-blocks.test.ts`
Expected: 둘 다 PASS(새 ```bash 블록 둘이 sh·bash·zsh `-n` 을 통과한다).

- [ ] **Step 7: 커밋한다**

```bash
git add .claude/skills/dflow-team/SKILL.md .claude/skills/dflow-team/references/help.md tests/skills/dflow-key-select.test.ts
git commit -m "$(cat <<'EOF'
feat(dflow-team): 잠금 전에 키를 판정하고 모호하면 물어 .env 에 굳힌다

토큰이 둘인 .env 로 팀장을 띄우면 묻지도 알리지도 않고 첫 토큰으로 돌았다. 이 리포의 프로젝트에
속한 키가 하나면 고르고 둘 이상이면 묻는다. 실행마다 골라 워커에 넘기면 훅과 하위 Phase 에서
새므로, 모든 경로가 이미 읽는 .env 의 DFLOW_AS 에 적는다.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: 킷과 dflow-work 문서

**Files:**
- Modify: `kit/.env.example`, `kit/README.md`
- Modify: `.claude/skills/dflow-work/SKILL.md`, `.claude/skills/dflow-work/README.md`, `.claude/skills/dflow-work/references/troubleshooting.md`
- Modify: `tests/skills/dflow-key-select.test.ts` (describe 하나 추가)

**Interfaces:**
- Consumes: Task 2·3 의 `DFLOW_AS`·`--as <prefix|email>`·`dflow.sh profiles`·새 doctor 줄 형식.

- [ ] **Step 1: 실패하는 테스트를 쓴다**

```ts
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
```

- [ ] **Step 2: 실패를 확인한다**

Run: `npx vitest run tests/skills/dflow-key-select.test.ts -t '킷·dflow-work'`
Expected: FAIL 2건(`api-contract.md` 는 Task 1 에서 이미 고쳐 통과한다).

- [ ] **Step 3: `kit/.env.example`**

`DFLOW_PATS=` 줄 다음에 빈 줄 하나를 두고 더한다.
```
# 토큰이 둘 이상일 때 이 리포가 쓸 키의 prefix(토큰의 셋째 '_' 칸). 비우면 첫 토큰을 쓴다. 이메일·이름은 받지 않는다.
# 목록은 `.claude/skills/dflow-work/scripts/dflow.sh profiles`. /dflow-team 은 비어 있으면 시작할 때 정해서 파일 끝에 적는다.
DFLOW_AS=
```

- [ ] **Step 4: `kit/README.md`**

`2. `<리포>/.env` 에 `DFLOW_API_BASE`(스테이징/운영) · `DFLOW_PATS` · `DFLOW_PROJECT_ID` 기입` 줄 끝에 붙인다.
```
. 토큰이 둘 이상이면 `DFLOW_AS=<prefix>` 로 이 리포의 키를 고정한다(prefix 는 `dflow.sh profiles` 로 확인. `/dflow-team` 은 비어 있으면 시작할 때 묻고 적는다)
```

- [ ] **Step 5: `.claude/skills/dflow-work/SKILL.md`**

1. doctor 성공 출력 예시를 새 형식으로.
```
   base: https://d-flow.example.com
   프로필 1: OxMb1D1097Qz 맥북-에어 alice@example.com (계약 2.4, 프로젝트 3) [선택됨]
```
2. `2. 프로필이 여럿이면(…) 사용자가 지목한 사람으로 `--as <이름|email>` 옵션을 사용한다.` 를 바꾼다.
```markdown
2. 프로필이 여럿이면(`DFLOW_PATS` 에 쉼표 구분 여러 토큰) `.env` 의 `DFLOW_AS=<prefix>` 가 이 리포의 키를 고정한다.
   prefix 는 `dflow.sh profiles` 로 본다(토큰마다 한 줄 JSON: `prefix`·`name`·`email`·`projects`·`bound`·`selected`).
   `DFLOW_AS` 가 없으면 첫 토큰이며 doctor 가 그 사실을 경고한다. 한 번만 다른 키로 부르려면 `--as <prefix|email>` 을
   쓴다. 한 계정에 키가 둘이면 email 로는 갈리지 않으므로 prefix 를 쓴다. `DFLOW_AS` 는 prefix 만 받는다.
```
3. 명령 요약의 `dflow.sh [--as <이름|email>] list …` → `dflow.sh [--as <prefix|email>] list …`, 그 블록에 `dflow.sh profiles` 한 줄을 더한다.

- [ ] **Step 6: `.claude/skills/dflow-work/README.md` 와 `troubleshooting.md`**

README 의 「프로필 여럿」 절 끝에 더한다.
```markdown
리포마다 쓸 키를 고정하려면 그 리포의 `.env` 에 `DFLOW_AS=<prefix>` 를 적는다. prefix 는 `dflow.sh profiles` 로 본다.
`--as` 는 한 번만 다른 키로 부를 때 쓰며 prefix 와 email 을 모두 받는다. 한 계정에 키가 둘이면 email 로는 갈리지 않는다.
```
troubleshooting 의 「프로필 다중 관리」 절 끝에 더한다.
```markdown
**어느 키로 도는지 모르겠다**: `dflow.sh profiles` 가 토큰마다 `prefix`·`name`·`email`·`projects` 와 이 리포 바인딩에
속하는지(`bound`), 지금 설정이 고르는 키인지(`selected`)를 낸다. `.env` 의 `DFLOW_AS=<prefix>` 로 고정한다.
`DFLOW_AS=… 에 맞는 토큰이 없습니다`(exit 2)는 그 값이 어느 토큰의 prefix 와도 다르다는 뜻이다. 이메일·이름은 받지
않는다. heartbeat 훅도 같은 값을 따르며, 맞는 토큰이 없으면 아무것도 보내지 않는다.
```

- [ ] **Step 7: 통과를 확인하고 커밋한다**

Run: `npx vitest run tests/skills/dflow-key-select.test.ts tests/skills/dflow-team-kit.test.ts`
Expected: PASS.

```bash
git add kit/.env.example kit/README.md .claude/skills/dflow-work/SKILL.md .claude/skills/dflow-work/README.md \
  .claude/skills/dflow-work/references/troubleshooting.md tests/skills/dflow-key-select.test.ts
git commit -m "$(cat <<'EOF'
docs(dflow): 킷과 dflow-work 문서에 DFLOW_AS·profiles 를 적는다

문서가 "첫 토큰이 기본", "--as <이름|email>" 로 남아 있으면 키를 고정하는 길을 아무도 찾지 못한다.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: 전체 검증과 기준선 기록

**Files:**
- Modify: `docs/superpowers/specs/2026-09-18-dflow-key-select-design.md` (§8 기준선 문단, §6-2 시작 보고 줄)

- [ ] **Step 1: 전체를 돌려 기준선과 비교한다**

```bash
cd /Users/jji/project/wbs-web-key
npx vitest run tests/skills tests/agent 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | grep -E 'Test Files|Tests '
npx vitest run tests/skills tests/agent 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | grep -E '^ FAIL ' | sed 's/ > .*//' | sort | uniq -c
npx tsc --noEmit 2>&1 | grep -c 'error TS'
npx eslint src/lib/agent/externalApi.ts src/app/api/v1/agent/me/route.ts tests/skills/dflow-key-select.test.ts tests/skills/heartbeat-hook.test.ts
```
Expected: 실패 파일·건수가 Task 1 Step 1 의 기준선과 같다(새 파일 `dflow-key-select.test.ts` 는 실패 0). tsc 오류 수 동일. eslint 오류 0.

- [ ] **Step 2: 실제 `.env` 로 새 명령을 돌려 본다(읽기 전용)**

```bash
cd /Users/jji/project/mdm-dict
/Users/jji/project/wbs-web-key/.claude/skills/dflow-work/scripts/dflow.sh profiles
/Users/jji/project/wbs-web-key/.claude/skills/dflow-work/scripts/dflow.sh doctor
```
Expected: 토큰 둘이 각각 한 줄로 나온다. 서버가 아직 2.3 이므로 `name` 은 `-` 다. doctor 는 `⚠ 토큰이 2개인데 DFLOW_AS 가 없습니다` 를 낸다. 출력에 토큰 값이 없다.

- [ ] **Step 3: spec 의 두 곳을 실제에 맞춘다**

§8 의 기준선 문단을 Task 1 Step 1 에서 잰 값(기점 커밋 `5bf6e07d`, 파일별 실패 수)으로 고친다. §6-2 의 `시작 보고 첫 줄에` 를 `시작 보고에서 종료 시각 줄 바로 다음에` 로 고친다(`5bf6e07d` 가 첫 줄을 종료 시각에 썼다).

- [ ] **Step 4: 커밋한다**

```bash
git add docs/superpowers/specs/2026-09-18-dflow-key-select-design.md docs/superpowers/plans/2026-09-18-dflow-key-select.md
git commit -m "$(cat <<'EOF'
docs(dflow): 키 선택 설계의 기준선과 시작 보고 위치를 구현에 맞춘다

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
EOF
)"
```

---

## 계획 밖(사람 확인 뒤)

1. `staging` 에 머지·push → dflow-staging 배포 → 실제 `.env` 로 `profiles` 의 `name` 이 채워지는지 확인.
2. `~/dflow-skills`(라이브 스킬 워크트리)를 새 커밋으로 옮긴다. 도는 팀장이 마감한 뒤에 한다.
3. `kit/install.sh <리포> --hooks` 로 `~/.dflow/hooks/heartbeat.sh` 사본을 갱신한다.
4. main 머지는 종전 절차대로.
