# `.dflow` 설정 파일과 개발 브랜치 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 에이전트 스킬의 설정을 `.env` 에서 `.dflow`(프로젝트 공통, 커밋)·`.dflow.local`(개인)로 옮기고, 머지·스택·반영 확인의 기준을 `origin/HEAD` 대신 개인 설정의 개발 브랜치로 바꾼다.

**Architecture:** 설정 해석을 POSIX sh 라이브러리 `dflow-config.sh` 하나에 모은다. `dflow.sh`·`poll.sh`·`lead-worktree.sh`·heartbeat 훅이 이것을 source 하고, 스킬 문서의 셸 블록은 `dflow.sh config <key>`·`dflow.sh branch dev|release` 로만 값을 얻는다. 두 파일이 모두 없으면 종전 `.env` 경로로 동작한다(레거시).

**Tech Stack:** POSIX sh(`#!/bin/sh`, bash·zsh·dash 호환), awk, git, vitest(`tests/skills/*.test.ts` 가 스크립트를 실제로 실행한다).

**Spec:** `docs/superpowers/specs/2026-09-23-dflow-config-design.md`

## Global Constraints

- 공통 키(`.dflow`): `api_base`·`project_id`·`release_branch`. 개인 키(`.dflow.local`): `pats`·`pat`·`as`·`dev_branch`·`automerge`·`project_map`.
- 우선순위: export 된 env > 파일 > 레거시 `.env`. 이미 export 된(비어 있지 않은) 키는 덮지 않는다.
- **어느 설정 파일도 `source` 하지 않는다**(레거시 `.env` 만 종전대로 source). 값은 `eval "$NAME=\$_v"` 꼴로만 대입한다.
- `.dflow` 에 개인 키 → `PERSONAL_KEY_IN_DFLOW` exit 2. `.dflow.local` 에 공통 키 → `COMMON_KEY_IN_LOCAL` 경고 후 무시.
- `.dflow` 만 → `NO_LOCAL` exit 2. `.dflow.local` 만 → `NO_DFLOW` exit 2. 새 방식인데 `dev_branch` 없음 → `NO_DEV_BRANCH` exit 2.
- `.dflow` 찾는 순서: `<top>/.dflow` → `git show origin/<dev_branch>:.dflow` → `git show origin/HEAD:.dflow`. `<top>` 은 `DFLOW_CONFIG_DIR` 가 있으면 그것, 없으면 `git rev-parse --show-toplevel`. cwd 는 보지 않는다. `.dflow.local` 은 `<top>` 에서만 찾는다.
- 토큰 값은 출력·로그·파일 기록 금지. `dflow.sh config pats|pat` 은 거부한다.
- 스킬 문서의 ```bash 블록은 sh·bash·zsh `-n` 파싱을 통과해야 한다(`tests/skills/dflow-team-shell-blocks.test.ts`).
- 반영은 staging 까지다. main·킷 재빌드는 하지 않는다.
- 커밋은 파일명을 명시해 stage 한다(`git add -A` 금지). 커밋 메시지는 한국어.

## Review Focus

1. **`.dflow` 가 없는 detached 옛 커밋에서 워커가 개발 브랜치를 잘못 잡는 것** — 워커는 팀장이 넘긴 `DEV_BRANCH=` 만 쓴다. Task 1 테스트(옛 커밋 → `origin/<dev>:.dflow`)와 Task 5 문서 테스트(`{DEV_BRANCH}` 치환)가 고정한다.
2. **이 PC 의 병렬 세션이 `.dflow` 커밋을 받은 순간 `NO_LOCAL` 로 모두 멈추는 것** — Task 8 은 `.dflow.local` 을 먼저 만들고 나서 `.dflow` 를 커밋한다. 순서를 바꾸지 않는다.
3. **기존 테스트가 리포 루트(`process.cwd()`)에서 dflow.sh 를 돌리므로 wbs-web 의 `.dflow` 를 집어 `NO_LOCAL` 로 깨지는 것** — Task 2 가 기존 테스트에 `DFLOW_CONFIG_DIR`(빈 임시 디렉터리)를 넣는다.
4. **값에 셸 코드(`$(touch x)`)·공백·`=`·`#` 가 들어 있는 경우** — Task 1 테스트가 실행되지 않음과 값 보존(`a=b=c`)을 고정한다.
5. **비밀 유출** — `dflow.sh config pats` 거부, 오류 메시지에 값 미포함, `lead-worktree.sh` 출력에 토큰 미포함. Task 1·2·4 테스트가 고정한다.

---

## 파일 구조

| 파일 | 책임 |
|---|---|
| `.claude/skills/dflow-work/scripts/dflow-config.sh` (신규) | 설정 해석 라이브러리: `dflow_config_load`·`dflow_config_branch`·`dflow_config_projects`·`_dfc_env` |
| `.claude/skills/dflow-work/dflow.example`, `dflow.local.example` (신규) | 두 파일의 주석 달린 템플릿. 킷에 그대로 실린다 |
| `.claude/skills/dflow-work/scripts/dflow.sh` | 라이브러리 source, `config`·`branch` 명령 |
| `.claude/skills/dflow-poll/scripts/poll.sh` | `.env` 직접 읽기 → 라이브러리 |
| `kit/hooks/heartbeat.sh` | 인증 로드 → 라이브러리(없으면 레거시) |
| `.claude/skills/dflow-team/scripts/lead-worktree.sh` | 기점 브랜치 → 라이브러리, `.dflow.local` 사본 |
| 스킬 문서(dflow-team·dflow-dev·dflow-merge·dflow-work·dflow-poll·dflow-wbs·dflow-export) | `. ./.env` 접두 제거, 기본 브랜치 정의, 바인딩·키 저장 안내 |
| `kit/install.sh`, `kit/README.md`, `scripts/kit-build.sh`, `kit/.env.example`(삭제) | 새 설정 파일 설치 |
| `tests/skills/dflow-config.test.ts` (신규), `tests/skills/dflow-config-docs.test.ts` (신규) | 라이브러리·문서 계약 |
| `.gitignore`, `.dflow`(신규) | wbs-web 적용 |

---

### Task 1: 설정 해석 라이브러리 `dflow-config.sh`

**Files:**
- Create: `.claude/skills/dflow-work/scripts/dflow-config.sh`
- Test: `tests/skills/dflow-config.test.ts`

**Interfaces:**
- Produces (source 후 쓰는 함수·변수):
  - `dflow_config_load` → 0 성공 / 2 실패(사유 코드 한 줄을 stderr). 성공 시 `DFLOW_*` env export, `DFLOW_CONFIG_MODE=new|legacy`, `DFLOW_CONFIG_DOT`(`<경로>` 또는 `origin/<ref>:.dflow`, 없으면 빈 값), `DFLOW_CONFIG_LOCAL`(경로 또는 빈 값), `DFLOW_CONFIG_TOP` export.
  - `dflow_config_branch dev|release` → stdout 에 `origin/` 없는 브랜치 이름, 실패 시 return 2 와 `NO_DEFAULT_BRANCH`.
  - `dflow_config_projects` → 바인딩 UUID 를 한 줄에 하나(정렬·중복 제거).
  - `_dfc_env <key>` → 키에 대응하는 env 이름, 모르는 키면 return 1.

- [ ] **Step 1: 실패하는 테스트 작성**

```ts
// tests/skills/dflow-config.test.ts
// .dflow·.dflow.local 해석(docs/superpowers/specs/2026-09-23-dflow-config-design.md). 라이브러리를 실제 git 샌드박스에서 source 해 확인한다.
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const LIB = join(process.cwd(), '.claude/skills/dflow-work/scripts/dflow-config.sh')
const GIT_ENV = {
  PATH: process.env.PATH ?? '', HOME: '/nonexistent', NODE_ENV: process.env.NODE_ENV,
  GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t',
  GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1',
}
let tmp: string; let repo: string

function sh(cwd: string, script: string, env: Record<string, string> = {}) {
  const r = spawnSync('sh', ['-c', script], { cwd, encoding: 'utf8', env: { ...GIT_ENV, ...env } as NodeJS.ProcessEnv })
  return { code: r.status, out: r.stdout ?? '', err: r.stderr ?? '' }
}
// 라이브러리를 source 하고 load 한 뒤 원하는 변수를 찍는다.
function load(cwd: string, show: string, env: Record<string, string> = {}) {
  return sh(cwd, `. '${LIB}'; dflow_config_load || exit $?; ${show}`, env)
}
const DOT = 'api_base=https://p.test\nproject_id=11111111-1111-4111-8111-111111111111\nrelease_branch=main\n'
const LOCAL = 'pats=dflow_pat_AAAAAAAAAAAA_secretsecretsecret\ndev_branch=dev/me\nautomerge=1\nproject_map=docs/c10=22222222-2222-4222-8222-222222222222\n'

beforeEach(() => {
  tmp = realpathSync(mkdtempSync(join(tmpdir(), 'dflow-cfg-')))
  repo = join(tmp, 'repo')
  const r = sh(tmp, `
    git init -q --bare -b main origin.git
    git clone -q origin.git repo 2>/dev/null && cd repo && git checkout -q -b main
    printf 'x\\n' > a.txt && git add a.txt && git commit -qm init && git push -q origin main
    git remote set-head origin main`)
  expect(r.code, r.err).toBe(0)
})
afterEach(() => rmSync(tmp, { recursive: true, force: true }))

describe('dflow_config_load — 판정(스펙 §5)', () => {
  it('두 파일이 있으면 new, 공통·개인 값을 env 로 낸다', () => {
    writeFileSync(join(repo, '.dflow'), DOT); writeFileSync(join(repo, '.dflow.local'), LOCAL)
    const r = load(repo, 'echo "$DFLOW_CONFIG_MODE|$DFLOW_API_BASE|$DFLOW_DEV_BRANCH|$DFLOW_AUTOMERGE|$DFLOW_RELEASE_BRANCH"')
    expect(r.code, r.err).toBe(0)
    expect(r.out.trim()).toBe('new|https://p.test|dev/me|1|main')
  })
  it('하위 디렉터리에서 실행해도 워크트리 최상위 파일을 찾는다(cwd 를 보지 않는다)', () => {
    writeFileSync(join(repo, '.dflow'), DOT); writeFileSync(join(repo, '.dflow.local'), LOCAL)
    mkdirSync(join(repo, 'sub')); writeFileSync(join(repo, 'sub/.dflow.local'), 'dev_branch=wrong\n')
    const r = load(join(repo, 'sub'), 'echo "$DFLOW_DEV_BRANCH"')
    expect(r.out.trim()).toBe('dev/me')
  })
  it('.dflow 만 있으면 NO_LOCAL 로 exit 2', () => {
    writeFileSync(join(repo, '.dflow'), DOT)
    const r = load(repo, 'echo ok')
    expect(r.code).toBe(2); expect(r.err).toContain('NO_LOCAL')
  })
  it('.dflow.local 만 있으면 NO_DFLOW 로 exit 2', () => {
    writeFileSync(join(repo, '.dflow.local'), LOCAL)
    const r = load(repo, 'echo ok')
    expect(r.code).toBe(2); expect(r.err).toContain('NO_DFLOW')
  })
  it('새 방식인데 dev_branch 가 없으면 NO_DEV_BRANCH 로 exit 2', () => {
    writeFileSync(join(repo, '.dflow'), DOT); writeFileSync(join(repo, '.dflow.local'), 'pats=x\n')
    const r = load(repo, 'echo ok')
    expect(r.code).toBe(2); expect(r.err).toContain('NO_DEV_BRANCH')
  })
  it('둘 다 없으면 legacy: DFLOW_ENV_FILE 을 읽고 LEGACY_ENV 를 알린다', () => {
    const env = join(tmp, 'legacy.env'); writeFileSync(env, 'DFLOW_PATS=p\nDFLOW_API_BASE=https://l.test\n')
    const r = load(repo, 'echo "$DFLOW_CONFIG_MODE|$DFLOW_API_BASE"', { DFLOW_ENV_FILE: env })
    expect(r.code, r.err).toBe(0)
    expect(r.out.trim()).toBe('legacy|https://l.test'); expect(r.err).toContain('LEGACY_ENV')
  })
  it('legacy 는 PAT 가 이미 export 돼 있으면 .env 를 읽지 않는다(종전 동작)', () => {
    const env = join(tmp, 'legacy.env'); writeFileSync(env, 'DFLOW_API_BASE=https://l.test\n')
    const r = load(repo, 'echo "$DFLOW_API_BASE"', { DFLOW_ENV_FILE: env, DFLOW_PATS: 'p' })
    expect(r.out.trim()).toBe('')
  })
  it('DFLOW_CONFIG_DIR 가 있으면 그 디렉터리에서만 찾는다', () => {
    writeFileSync(join(repo, '.dflow'), DOT); writeFileSync(join(repo, '.dflow.local'), LOCAL)
    const cfg = join(tmp, 'cfg'); mkdirSync(cfg)
    const r = load(repo, 'echo "$DFLOW_CONFIG_MODE"', { DFLOW_CONFIG_DIR: cfg, DFLOW_ENV_FILE: join(tmp, 'none') })
    expect(r.out.trim()).toBe('legacy')
  })
})

describe('dflow_config_load — 우선순위·키 범위(스펙 §3·§4)', () => {
  beforeEach(() => { writeFileSync(join(repo, '.dflow'), DOT); writeFileSync(join(repo, '.dflow.local'), LOCAL) })
  it('export 된 env 가 파일을 이긴다 — PAT 가 export 돼 있어도 dev_branch 는 파일에서 읽는다', () => {
    const r = load(repo, 'echo "$DFLOW_API_BASE|$DFLOW_PATS|$DFLOW_DEV_BRANCH"', { DFLOW_API_BASE: 'https://s.test', DFLOW_PATS: 'envpat' })
    expect(r.out.trim()).toBe('https://s.test|envpat|dev/me')
  })
  it('.dflow 에 개인 키가 있으면 PERSONAL_KEY_IN_DFLOW 로 exit 2, 값은 출력하지 않는다', () => {
    writeFileSync(join(repo, '.dflow'), DOT + 'pats=dflow_pat_ZZZZZZZZZZZZ_leakleakleakleak\n')
    const r = load(repo, 'echo ok')
    expect(r.code).toBe(2); expect(r.err).toContain('PERSONAL_KEY_IN_DFLOW pats')
    expect(r.err + r.out).not.toContain('leakleak')
  })
  it('.dflow.local 의 공통 키는 경고하고 무시한다', () => {
    writeFileSync(join(repo, '.dflow.local'), LOCAL + 'api_base=https://other.test\n')
    const r = load(repo, 'echo "$DFLOW_API_BASE"')
    expect(r.code).toBe(0); expect(r.out.trim()).toBe('https://p.test')
    expect(r.err).toContain('COMMON_KEY_IN_LOCAL api_base')
  })
  it('모르는 키는 경고하고 계속한다', () => {
    writeFileSync(join(repo, '.dflow'), DOT + 'colour=red\n')
    const r = load(repo, 'echo ok')
    expect(r.code).toBe(0); expect(r.err).toContain('UNKNOWN_KEY')
  })
  it('값을 실행하지 않고, =·주석·CR·공백을 규칙대로 다룬다', () => {
    writeFileSync(join(repo, '.dflow.local'),
      `# 주석\r\n  dev_branch = $(touch ${join(tmp, 'pwned')}) \r\nautomerge=a=b=c   # 꼬리 주석\r\n`)
    const r = load(repo, 'printf "%s|%s" "$DFLOW_DEV_BRANCH" "$DFLOW_AUTOMERGE"')
    expect(existsSync(join(tmp, 'pwned'))).toBe(false)
    expect(r.out).toBe(`$(touch ${join(tmp, 'pwned')})|a=b=c`)
  })
})

describe('.dflow 위치 폴백과 브랜치(스펙 §5-2·§6)', () => {
  it('워크트리에 .dflow 가 없으면 origin/<dev_branch>:.dflow 를 읽는다', () => {
    const r0 = sh(repo, `git switch -q -c dev/me && printf '${DOT.replace(/\n/g, '\\n')}' > .dflow && git add .dflow && git commit -qm dflow && git push -q origin dev/me && git switch -q main`)
    expect(r0.code, r0.err).toBe(0)
    writeFileSync(join(repo, '.dflow.local'), LOCAL)
    const r = load(repo, 'echo "$DFLOW_CONFIG_DOT|$DFLOW_API_BASE"')
    expect(r.code, r.err).toBe(0); expect(r.out.trim()).toBe('origin/dev/me:.dflow|https://p.test')
  })
  it('그다음 origin/HEAD:.dflow 를 읽는다', () => {
    const r0 = sh(repo, `printf '${DOT.replace(/\n/g, '\\n')}' > .dflow && git add .dflow && git commit -qm dflow && git push -q origin main && git rm -q .dflow && git commit -qm rm`)
    expect(r0.code, r0.err).toBe(0)
    writeFileSync(join(repo, '.dflow.local'), LOCAL)
    const r = load(repo, 'echo "$DFLOW_CONFIG_DOT"')
    expect(r.out.trim()).toBe('origin/HEAD:.dflow')
  })
  it('branch dev 는 dev_branch, release 는 release_branch. legacy 는 origin/HEAD', () => {
    writeFileSync(join(repo, '.dflow'), DOT); writeFileSync(join(repo, '.dflow.local'), LOCAL)
    expect(load(repo, 'dflow_config_branch dev; dflow_config_branch release').out).toBe('dev/me\nmain\n')
    rmSync(join(repo, '.dflow')); rmSync(join(repo, '.dflow.local'))
    expect(load(repo, 'dflow_config_branch dev', { DFLOW_ENV_FILE: join(tmp, 'none') }).out).toBe('main\n')
  })
  it('release_branch 를 생략하면 origin/HEAD', () => {
    writeFileSync(join(repo, '.dflow'), 'api_base=https://p.test\n'); writeFileSync(join(repo, '.dflow.local'), LOCAL)
    expect(load(repo, 'dflow_config_branch release').out).toBe('main\n')
  })
  it('projects 는 project_id 와 project_map 값의 합집합', () => {
    writeFileSync(join(repo, '.dflow'), DOT); writeFileSync(join(repo, '.dflow.local'), LOCAL)
    expect(load(repo, 'dflow_config_projects').out).toBe(
      '11111111-1111-4111-8111-111111111111\n22222222-2222-4222-8222-222222222222\n')
  })
})
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run tests/skills/dflow-config.test.ts`
Expected: FAIL — `sh: .../dflow-config.sh: No such file or directory`.

- [ ] **Step 3: 라이브러리 구현**

```sh
#!/bin/sh
# dflow-config.sh — D'Flow 에이전트 설정 해석. source 해서 쓴다(단독 실행하지 않는다).
# .dflow(프로젝트 공통, 커밋)·.dflow.local(개인, gitignore)을 읽어 DFLOW_* env 로 export 한다.
# 우선순위: 이미 export 된 env > 파일 > 레거시 .env. 설정 파일은 source 하지 않는다 — 값을 실행하지 않는다.
# 실패하면 사유 코드 한 줄을 stderr 에 내고 return 2. 값은 메시지에 넣지 않는다(토큰이 섞일 수 있다).

_dfc_env() {
  case "$1" in
    api_base) echo DFLOW_API_BASE ;; project_id) echo DFLOW_PROJECT_ID ;; release_branch) echo DFLOW_RELEASE_BRANCH ;;
    pats) echo DFLOW_PATS ;; pat) echo DFLOW_PAT ;; as) echo DFLOW_AS ;; dev_branch) echo DFLOW_DEV_BRANCH ;;
    automerge) echo DFLOW_AUTOMERGE ;; project_map) echo DFLOW_PROJECT_MAP ;;
    *) return 1 ;;
  esac
}
_dfc_scope() {
  case "$1" in
    api_base|project_id|release_branch) echo common ;;
    pats|pat|as|dev_branch|automerge|project_map) echo personal ;;
    *) echo unknown ;;
  esac
}
# stdin 의 key=value 를 정규화해 key=value 줄로 낸다. 주석·빈 줄·CR·앞뒤 공백·값 뒤 " #…" 를 버린다.
_dfc_parse() {
  awk '{ sub(/\r$/, ""); sub(/^[ \t]+/, "")
         if ($0 == "" || substr($0, 1, 1) == "#") next
         i = index($0, "="); if (i < 2) { print "BAD_LINE " NR > "/dev/stderr"; next }
         k = substr($0, 1, i - 1); v = substr($0, i + 1)
         sub(/[ \t]+$/, "", k); sub(/^[ \t]+/, "", v); sub(/[ \t]+#.*$/, "", v); sub(/[ \t]+$/, "", v)
         print k "=" v }'
}
# $1=이 파일이 받을 범위(common|personal) $2=표시명. stdin=_dfc_parse 출력. 파이프 없이 here-doc 으로 받아야
# export 가 호출자 셸에 남는다.
_dfc_apply() {
  _dfc_rc=0
  while IFS= read -r _dfc_l; do
    [ -n "$_dfc_l" ] || continue
    _dfc_k=${_dfc_l%%=*}; _dfc_v=${_dfc_l#*=}
    _dfc_s=$(_dfc_scope "$_dfc_k")
    if [ "$_dfc_s" = unknown ]; then echo "UNKNOWN_KEY $2: $_dfc_k (무시)" >&2; continue; fi
    if [ "$_dfc_s" != "$1" ]; then
      if [ "$1" = common ]; then
        echo "PERSONAL_KEY_IN_DFLOW $_dfc_k 는 개인 설정이다. .dflow.local 로 옮겨라" >&2; _dfc_rc=2
      else
        echo "COMMON_KEY_IN_LOCAL $_dfc_k 는 프로젝트 공통 설정이다. .dflow.local 의 값은 무시한다" >&2
      fi
      continue
    fi
    _dfc_n=$(_dfc_env "$_dfc_k")
    eval "_dfc_cur=\${$_dfc_n:-}"
    [ -n "$_dfc_cur" ] || { eval "$_dfc_n=\$_dfc_v"; export "$_dfc_n"; }
  done
  return $_dfc_rc
}

dflow_config_load() {
  DFLOW_CONFIG_MODE=''; DFLOW_CONFIG_DOT=''; DFLOW_CONFIG_LOCAL=''
  if [ -n "${DFLOW_CONFIG_DIR:-}" ]; then DFLOW_CONFIG_TOP=$DFLOW_CONFIG_DIR
  else DFLOW_CONFIG_TOP=$(git rev-parse --show-toplevel 2>/dev/null) || DFLOW_CONFIG_TOP=''; fi
  _dfc_local=''; _dfc_dot=''
  if [ -n "$DFLOW_CONFIG_TOP" ] && [ -f "$DFLOW_CONFIG_TOP/.dflow.local" ]; then
    _dfc_local=$(cat "$DFLOW_CONFIG_TOP/.dflow.local"); DFLOW_CONFIG_LOCAL="$DFLOW_CONFIG_TOP/.dflow.local"
  fi
  if [ -n "$DFLOW_CONFIG_TOP" ] && [ -f "$DFLOW_CONFIG_TOP/.dflow" ]; then
    _dfc_dot=$(cat "$DFLOW_CONFIG_TOP/.dflow"); DFLOW_CONFIG_DOT="$DFLOW_CONFIG_TOP/.dflow"
  elif [ -n "$DFLOW_CONFIG_TOP" ] && git -C "$DFLOW_CONFIG_TOP" rev-parse --git-dir >/dev/null 2>&1; then
    # detach 된 옛 커밋에는 .dflow 가 없을 수 있다. 개발 브랜치는 개인 파일에서 이미 알므로 순환이 없다.
    _dfc_dev=${DFLOW_DEV_BRANCH:-$(printf '%s\n' "$_dfc_local" | _dfc_parse 2>/dev/null | sed -n 's/^dev_branch=//p' | tail -n 1)}
    for _dfc_ref in ${_dfc_dev:+"origin/$_dfc_dev"} origin/HEAD; do
      if _dfc_dot=$(git -C "$DFLOW_CONFIG_TOP" show "$_dfc_ref:.dflow" 2>/dev/null); then
        DFLOW_CONFIG_DOT="$_dfc_ref:.dflow"; break
      fi
      _dfc_dot=''
    done
  fi

  if [ -n "$DFLOW_CONFIG_DOT" ] && [ -n "$DFLOW_CONFIG_LOCAL" ]; then
    DFLOW_CONFIG_MODE=new
    _dfc_apply common "$DFLOW_CONFIG_DOT" <<EOF || return 2
$(printf '%s\n' "$_dfc_dot" | _dfc_parse)
EOF
    _dfc_apply personal .dflow.local <<EOF || return 2
$(printf '%s\n' "$_dfc_local" | _dfc_parse)
EOF
    [ -n "${DFLOW_DEV_BRANCH:-}" ] || {
      echo "NO_DEV_BRANCH .dflow.local 에 dev_branch=<내 개발 브랜치> 를 적어라(운영 브랜치에서 직접 개발하면 그 이름을 적는다)" >&2
      return 2; }
  elif [ -n "$DFLOW_CONFIG_DOT" ]; then
    echo "NO_LOCAL $DFLOW_CONFIG_TOP/.dflow.local 이 없다. 개인 설정(pats·dev_branch 등)을 만들어라(예시: .claude/skills/dflow-work/dflow.local.example)" >&2
    return 2
  elif [ -n "$DFLOW_CONFIG_LOCAL" ]; then
    echo "NO_DFLOW .dflow.local 은 있는데 .dflow 를 찾지 못했다(워크트리·origin/<dev_branch>·origin/HEAD). 프로젝트 공통 설정을 커밋하라" >&2
    return 2
  else
    DFLOW_CONFIG_MODE=legacy
    # 종전 dflow.sh 와 같다: 환경에 PAT 가 없을 때만, 파일이 있을 때만 읽는다.
    if [ -z "${DFLOW_PATS:-}${DFLOW_PAT:-}" ]; then
      _dfc_envf=${DFLOW_ENV_FILE:-${DFLOW_CONFIG_DIR:+$DFLOW_CONFIG_DIR/.env}}; _dfc_envf=${_dfc_envf:-./.env}
      if [ -f "$_dfc_envf" ]; then
        echo "LEGACY_ENV $_dfc_envf 를 읽었다. .dflow·.dflow.local 로 옮겨라" >&2
        set -a; . "$_dfc_envf"; set +a
      fi
    fi
  fi
  export DFLOW_CONFIG_MODE DFLOW_CONFIG_DOT DFLOW_CONFIG_LOCAL DFLOW_CONFIG_TOP
  return 0
}

_dfc_origin_head() {
  _dfc_b=$(git -C "${DFLOW_CONFIG_TOP:-.}" symbolic-ref --short refs/remotes/origin/HEAD 2>/dev/null); _dfc_b=${_dfc_b#origin/}
  [ -n "$_dfc_b" ] || _dfc_b=$(git -C "${DFLOW_CONFIG_TOP:-.}" ls-remote --symref origin HEAD 2>/dev/null \
    | sed -n 's|^ref: refs/heads/\([^[:space:]]*\)[[:space:]]*HEAD$|\1|p')
  [ -n "$_dfc_b" ] && printf '%s\n' "$_dfc_b"
}
# $1=dev|release → origin/ 없는 브랜치 이름. 새 방식의 dev 는 load 가 이미 필수로 확인했다.
dflow_config_branch() {
  case "$1" in
    dev) [ -n "${DFLOW_DEV_BRANCH:-}" ] && { printf '%s\n' "$DFLOW_DEV_BRANCH"; return 0; } ;;
    release) [ -n "${DFLOW_RELEASE_BRANCH:-}" ] && { printf '%s\n' "$DFLOW_RELEASE_BRANCH"; return 0; } ;;
    *) echo "사용: dflow_config_branch dev|release" >&2; return 2 ;;
  esac
  _dfc_origin_head || { echo "NO_DEFAULT_BRANCH origin/HEAD 를 알 수 없다" >&2; return 2; }
}
# 리포 ↔ D'Flow 프로젝트 바인딩: project_id 와 project_map(docs/x=<uuid>,…) 값의 합집합.
dflow_config_projects() {
  { printf '%s\n' "${DFLOW_PROJECT_ID:-}"
    printf '%s' "${DFLOW_PROJECT_MAP:-}" | tr ',' '\n' | sed -n 's/^[^=]*=//p'
  } | tr -d ' \r' | grep -v '^$' | sort -u
}
```

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run tests/skills/dflow-config.test.ts`
Expected: PASS(18건). `sh -n`·`bash -n`·`zsh -n` 도 확인: `for s in sh bash zsh; do $s -n .claude/skills/dflow-work/scripts/dflow-config.sh || echo FAIL $s; done` → 출력 없음.

- [ ] **Step 5: 커밋**

```bash
git add .claude/skills/dflow-work/scripts/dflow-config.sh tests/skills/dflow-config.test.ts
git commit -m "feat(dflow-work): .dflow·.dflow.local 설정 해석 라이브러리를 둔다"
```

---

### Task 2: `dflow.sh` 가 라이브러리를 쓰고 `config`·`branch` 명령을 낸다

**Files:**
- Modify: `.claude/skills/dflow-work/scripts/dflow.sh:21-38`(usage), `:55-78`(로드·바인딩), `:~497`(doctor 경고 문구), `:505-524`(main)
- Modify(격리): `tests/skills/dflow-key-select.test.ts`, `tests/skills/dflow-claim-identity.test.ts`, `tests/skills/dflow-exit-cancelled.test.ts`, `tests/skills/dflow-team-kit.test.ts`
- Test: `tests/skills/dflow-config.test.ts`(describe 추가)

**Interfaces:**
- Consumes: Task 1 의 `dflow_config_load`·`dflow_config_branch`·`dflow_config_projects`·`_dfc_env`.
- Produces: `dflow.sh config <key>`(값 한 줄, 없으면 빈 줄), `dflow.sh config projects`(UUID 줄들), `dflow.sh config --source`(`mode=…`·`dflow=…`·`local=…` 세 줄), `dflow.sh branch dev|release`. `config pats|pat` 은 exit 2 `SECRET`. 이 두 명령은 curl·jq·토큰 없이 돈다.

- [ ] **Step 1: 기존 테스트 격리** — 리포 루트에서 도는 기존 테스트가 wbs-web 의 `.dflow`(Task 8)를 집지 않게 한다. 네 파일의 `spawnSync` env 에 다음 한 줄을 더한다(각 파일의 `tmp` 변수 이름을 그대로 쓴다).
  - `dflow-key-select.test.ts:49` 옆, `dflow-claim-identity.test.ts:74` 옆, `dflow-exit-cancelled.test.ts:34` 옆: `DFLOW_CONFIG_DIR: join(tmp, 'no-config'),`
  - `dflow-exit-cancelled.test.ts:62` 의 인라인 env 에도 `DFLOW_CONFIG_DIR: join(tmp, 'no-config')` 를 더한다.
  - `dflow-team-kit.test.ts:77` env 에 `DFLOW_CONFIG_DIR: '/nonexistent-dflow-config'` 를 더한다.
  - 레거시 경로는 `DFLOW_CONFIG_DIR/.env` 를 기본으로 보지만, 이 테스트들은 `DFLOW_ENV_FILE` 을 이미 주므로 동작이 같다.

- [ ] **Step 2: 실패하는 테스트 추가** — `tests/skills/dflow-config.test.ts` 끝에:

```ts
const DFLOW = join(process.cwd(), '.claude/skills/dflow-work/scripts/dflow.sh')
describe('dflow.sh config·branch(스펙 §6)', () => {
  beforeEach(() => { writeFileSync(join(repo, '.dflow'), DOT); writeFileSync(join(repo, '.dflow.local'), LOCAL) })
  const run = (args: string, env: Record<string, string> = {}) => sh(repo, `sh '${DFLOW}' ${args}`, env)
  it('config <key> 는 값을, branch 는 브랜치를 낸다 — 토큰·네트워크 없이', () => {
    expect(run('config api_base').out).toBe('https://p.test\n')
    expect(run('config automerge').out).toBe('1\n')
    expect(run('branch dev').out).toBe('dev/me\n')
    expect(run('branch release').out).toBe('main\n')
  })
  it('config projects 는 바인딩 합집합', () => {
    expect(run('config projects').out.trim().split('\n')).toHaveLength(2)
  })
  it('config --source 는 판정을 낸다', () => {
    expect(run('config --source').out).toContain('mode=new')
  })
  it('config pats 는 거부하고 값을 내지 않는다', () => {
    const r = run('config pats')
    expect(r.code).toBe(2); expect(r.out + r.err).not.toContain('secretsecret')
  })
  it('설정 오류는 exit 2 로 전파된다', () => {
    rmSync(join(repo, '.dflow.local'))
    const r = run('config api_base')
    expect(r.code).toBe(2); expect(r.err).toContain('NO_LOCAL')
  })
})
```

Run: `npx vitest run tests/skills/dflow-config.test.ts`
Expected: FAIL — `사용법:` 출력과 exit 2(`config` 를 모르는 명령으로 본다).

- [ ] **Step 3: `dflow.sh` 수정**

  (a) `:55-59` 의 `.env` 자동 로드 블록(주석 한 줄 포함)을 다음으로 바꾼다.

```sh
# 설정 로드: .dflow(프로젝트 공통)·.dflow.local(개인) → 없으면 레거시 .env. 규칙은 dflow-config.sh 머리말.
. "$(dirname "$0")/dflow-config.sh"
dflow_config_load || exit 2
```

  (b) CR 제거 루프(`:62`)의 변수 목록에 `DFLOW_DEV_BRANCH DFLOW_RELEASE_BRANCH DFLOW_AUTOMERGE` 를 더한다.

  (c) `allowed_projects()` 함수 정의(`:66-71`)를 지우고 `ALLOWED_PROJECTS=$(allowed_projects)` 를 `ALLOWED_PROJECTS=$(dflow_config_projects)` 로 바꾼다. 위 주석 세 줄(2026-09-18 발견)은 남긴다.

  (d) `# ---- main` 바로 위에 두 함수를 더한다.

```sh
# 설정 조회 — 토큰·네트워크가 필요 없다. 비밀(pats·pat)은 내지 않는다.
cmd_config() {
  case "${1:-}" in
    --source) printf 'mode=%s\ndflow=%s\nlocal=%s\n' "$DFLOW_CONFIG_MODE" "${DFLOW_CONFIG_DOT:--}" "${DFLOW_CONFIG_LOCAL:--}" ;;
    projects) dflow_config_projects ;;
    pats|pat) die 2 "SECRET 비밀 값은 출력하지 않는다" ;;
    '') usage ;;
    *) _n=$(_dfc_env "$1") || die 2 "UNKNOWN_KEY $1"; eval "printf '%s\n' \"\${$_n:-}\"" ;;
  esac
}
cmd_branch() {
  case "${1:-}" in dev|release) dflow_config_branch "$1" || exit 2 ;; *) usage ;; esac
}
```

  (e) `need curl; need jq` 바로 앞에 넣는다.

```sh
case "${1:-}" in
  config) shift; cmd_config "$@"; exit $? ;;
  branch) shift; cmd_branch "$@"; exit $? ;;
esac
```

  (f) usage 의 둘째 줄을 `  키 선택: --as → .dflow.local 의 as(레거시 .env 의 DFLOW_AS, prefix 만) → 첫 토큰. 한 계정에 키가 둘이면 email 로는 갈리지 않는다` 로 바꾸고, `list` 설명의 `(DFLOW_PROJECT_ID·DFLOW_PROJECT_MAP)` 을 `(.dflow 의 project_id·.dflow.local 의 project_map)` 으로, 끝에 두 줄을 더한다.

```
  config <key>|projects|--source   설정 값·바인딩·판정 출처(비밀 키는 거부)
  branch dev|release               개발 브랜치(.dflow.local dev_branch)·운영 브랜치(.dflow release_branch)
```

  (g) doctor 경고(`:~497`) 문구의 `(.env 에 DFLOW_AS=<prefix>)` 를 `(.dflow.local 에 as=<prefix>, 레거시는 .env 에 DFLOW_AS=<prefix>)` 로 바꾸고, `tests/skills/dflow-key-select.test.ts:177` 의 기대 문자열도 같게 고친다.

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run tests/skills/`
Expected: PASS 전부. 특히 `dflow-key-select`·`dflow-claim-identity`·`dflow-exit-cancelled`·`dflow-team-kit` 가 격리 후에도 그대로 통과한다.

- [ ] **Step 5: 커밋**

```bash
git add .claude/skills/dflow-work/scripts/dflow.sh tests/skills/dflow-config.test.ts tests/skills/dflow-key-select.test.ts tests/skills/dflow-claim-identity.test.ts tests/skills/dflow-exit-cancelled.test.ts tests/skills/dflow-team-kit.test.ts
git commit -m "feat(dflow-work): dflow.sh 가 .dflow 설정을 읽고 config·branch 명령을 낸다"
```

---

### Task 3: `poll.sh` 와 heartbeat 훅이 라이브러리를 쓴다

**Files:**
- Modify: `.claude/skills/dflow-poll/scripts/poll.sh:74-85`
- Modify: `kit/hooks/heartbeat.sh:80-82`
- Test: `tests/skills/heartbeat-hook.test.ts`(케이스 추가), `tests/skills/dflow-config.test.ts`(poll 케이스 추가)

**Interfaces:**
- Consumes: `dflow_config_load`, `dflow_config_projects`.
- Produces: poll 은 `DFLOW_CONFIG_DIR` 로 설정 위치를 받는다(팀장이 `.git/dflow-team-poll` 같은 git 밖 cwd 에서 띄우므로). `DFLOW_ENV_FILE` 은 레거시에서만 뜻이 있다.

- [ ] **Step 1: 실패하는 테스트 작성**

  `tests/skills/dflow-config.test.ts` 끝에:

```ts
const POLL = join(process.cwd(), '.claude/skills/dflow-poll/scripts/poll.sh')
describe('poll.sh 설정 로드', () => {
  it('바인딩이 없으면 새 안내로 exit 2', () => {
    writeFileSync(join(repo, '.dflow'), 'api_base=https://p.test\n')
    writeFileSync(join(repo, '.dflow.local'), 'pats=x\ndev_branch=dev/me\n')
    const cwd = join(tmp, 'pollcwd'); mkdirSync(cwd)
    const r = sh(cwd, `sh '${POLL}' --interval 60 --until none`, { DFLOW_CONFIG_DIR: repo, DFLOW_WATCH: '0' })
    expect(r.code).toBe(2); expect(r.err).toContain('프로젝트 바인딩 없음')
  })
  it('설정 오류(NO_LOCAL)는 exit 2 로 멈춘다', () => {
    writeFileSync(join(repo, '.dflow'), DOT)
    const r = sh(repo, `sh '${POLL}' --interval 60 --until none`, { DFLOW_WATCH: '0' })
    expect(r.code).toBe(2); expect(r.err).toContain('NO_LOCAL')
  })
})
```

  `tests/skills/heartbeat-hook.test.ts` 의 `describe('heartbeat.sh — 스펙 §4-2', …)` 안에(같은 파일의 `run`·`sent`·`repo` 헬퍼를 쓴다). import 에 `copyFileSync` 를 더한다.

```ts
const installLib = () => {
  const d = join(repo, '.claude/skills/dflow-work/scripts'); mkdirSync(d, { recursive: true })
  copyFileSync(join(process.cwd(), '.claude/skills/dflow-work/scripts/dflow-config.sh'), join(d, 'dflow-config.sh'))
}
it('새 방식: 리포에 dflow-config.sh 가 있으면 .dflow·.dflow.local 로 인증한다(.env 는 읽지 않는다)', () => {
  installLib()
  writeFileSync(join(repo, '.dflow-agent'), 'hong/mbp/w2\n')
  writeFileSync(join(repo, '.dflow'), 'api_base=https://new.test\n')
  writeFileSync(join(repo, '.dflow.local'), 'pat=dflow_pat_NNNNNNNNNNNN_s9\ndev_branch=main\n')
  run()
  expect(sent()).toHaveLength(1)
  expect(sent()[0]).toContain('https://new.test/api/v1/agent/work/22222222-2222-4222-8222-222222222222/heartbeat')
  expect(sent()[0]).toContain('Bearer dflow_pat_NNNNNNNNNNNN_s9')
})
it('새 방식 설정이 깨졌으면(.dflow.local 없음) 보내지 않고 조용히 끝낸다', () => {
  installLib()
  writeFileSync(join(repo, '.dflow-agent'), 'hong/mbp/w2\n')
  writeFileSync(join(repo, '.dflow'), 'api_base=https://new.test\n')
  run()                                   // execFileSync 는 exit 0 이 아니면 던진다
  expect(sent()).toHaveLength(0)
})
```

Run: `npx vitest run tests/skills/dflow-config.test.ts tests/skills/heartbeat-hook.test.ts`
Expected: FAIL — poll 은 `env 파일 없음`, 훅 새 방식 케이스는 curl 0회.

- [ ] **Step 2: `poll.sh` 수정** — `:76`(`ENV_FILE=…`), `:79`(`[ -f "$ENV_FILE" ] …`), `:81`(`set -a; . "$ENV_FILE"; set +a`), `:84-85`(바인딩 검사)를 다음으로 바꾼다. `DFLOW=`·`STATE_GLOB=`·`[ -x "$DFLOW" ]` 줄은 그대로 둔다.

```sh
# 설정: .dflow·.dflow.local(DFLOW_CONFIG_DIR 또는 git 최상위) → 없으면 레거시 .env(DFLOW_ENV_FILE 또는 ./.env).
. "$SKILLS_DIR/dflow-work/scripts/dflow-config.sh"
dflow_config_load || exit 2
```
```sh
[ -n "$(dflow_config_projects)" ] \
  || { echo "프로젝트 바인딩 없음: .dflow 의 project_id 또는 .dflow.local 의 project_map(레거시는 .env 의 DFLOW_PROJECT_ID·DFLOW_PROJECT_MAP)을 넣으세요" >&2; exit 2; }
```

- [ ] **Step 3: 훅 수정** — `kit/hooks/heartbeat.sh:80-82` 를 다음으로 바꾼다.

```sh
# 5) 인증: 새 방식은 리포의 dflow-config.sh 로 .dflow·.dflow.local 을 읽는다(팀원 워크트리에는 링크가 있다).
#    라이브러리가 없는 리포는 종전대로 루트 .env. 설정이 깨졌으면 조용히 끝낸다. 토큰은 env 로만 다룬다.
_lib="$_top/.claude/skills/dflow-work/scripts/dflow-config.sh"
if [ -f "$_lib" ]; then
  . "$_lib"; DFLOW_CONFIG_DIR="$_top"; export DFLOW_CONFIG_DIR
  dflow_config_load 2>/dev/null || exit 0
else
  [ -f "$_top/.env" ] || exit 0
  set -a; . "$_top/.env" 2>/dev/null; set +a
fi
```

  주의: 새 방식이지만 두 파일이 모두 없는 리포(라이브러리만 설치)는 load 가 legacy 로 `$_top/.env` 를 읽으므로 종전과 같다.

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run tests/skills/`
Expected: PASS 전부.

- [ ] **Step 5: 커밋**

```bash
git add .claude/skills/dflow-poll/scripts/poll.sh kit/hooks/heartbeat.sh tests/skills/dflow-config.test.ts tests/skills/heartbeat-hook.test.ts
git commit -m "feat(dflow-poll): poll·heartbeat 훅이 .dflow 설정을 읽는다"
```

---

### Task 4: `lead-worktree.sh` — 개발 브랜치 기점과 `.dflow.local` 사본

**Files:**
- Modify: `.claude/skills/dflow-team/scripts/lead-worktree.sh`
- Test: `tests/skills/dflow-lead-worktree.test.ts`

**Interfaces:**
- Consumes: `dflow_config_load`, `dflow_config_branch dev`.
- Produces: 출력 줄 `LOCAL_COPIED <경로> (as 는 뺐다)` / `LOCAL_KEPT <경로>` / `DFLOW_LINKED <경로>`(새 방식), 레거시는 종전 `ENV_*` 줄. 기점은 `origin/<개발브랜치>`.

- [ ] **Step 1: 실패하는 테스트 추가** — `dflow-lead-worktree.test.ts` 의 「두 번째 팀장」 describe 에:

```ts
it('새 방식: 개발 브랜치에서 detach 하고, as 를 뺀 .dflow.local 사본(600)을 만들며 토큰을 출력하지 않는다', () => {
  const r0 = sh(primary, `git switch -q -c dev/me && printf 'z\\n' > d.txt && git add d.txt && git commit -qm dev && git push -q origin dev/me && git switch -q main`)
  expect(r0.code, r0.out).toBe(0)
  mkdirSync(join(primary, '.claude/skills/dflow-team'), { recursive: true })
  writeFileSync(join(primary, '.claude/skills/dflow-team/SKILL.md'), 'x')
  writeFileSync(join(primary, '.dflow'), 'api_base=https://x.test\n')
  writeFileSync(join(primary, '.dflow.local'), 'pats=dflow_pat_AAAAAAAAAAAA_topsecrettopsecret\nas=AAAAAAAAAAAA\ndev_branch=dev/me\n')
  const r = sh(primary, `bash '${LEAD_WT}' k3`)
  expect(r.code, r.out).toBe(0)
  expect(r.out).not.toContain('topsecret')
  const lw = join(primary, '.claude/worktrees/lead-k3')
  expect(existsSync(join(lw, 'd.txt'))).toBe(true)                       // origin/dev/me 기점
  const local = readFileSync(join(lw, '.dflow.local'), 'utf8')
  expect(local).toContain('dev_branch=dev/me'); expect(local).not.toMatch(/^as=/m)
  expect(statSync(join(lw, '.dflow.local')).mode & 0o777).toBe(0o600)
  expect(lstatSync(join(lw, '.dflow')).isSymbolicLink()).toBe(true)        // 커밋되지 않은 .dflow 는 링크
  expect(r.out).toContain('LOCAL_COPIED')
})
it('새 방식 설정이 깨졌으면(NO_LOCAL) 워크트리를 만들지 않고 exit 2', () => {
  writeFileSync(join(primary, '.dflow'), 'api_base=https://x.test\n')
  const r = sh(primary, `bash '${LEAD_WT}' k4`)
  expect(r.code).toBe(2); expect(r.out).toContain('NO_LOCAL')
  expect(existsSync(join(primary, '.claude/worktrees/lead-k4'))).toBe(false)
})
```

  (기존 케이스의 `.gitignore` 초기화 `printf '.env\\n'` 에 `.dflow.local` 을 더해 `printf '.env\\n.dflow.local\\n'` 로 바꾼다.)

Run: `npx vitest run tests/skills/dflow-lead-worktree.test.ts`
Expected: FAIL — 기점이 main 이라 `d.txt` 가 없다.

- [ ] **Step 2: 스크립트 수정**

  (a) 머리말 둘째 주석 줄의 `origin/<기본브랜치>` 를 `origin/<개발브랜치>` 로, `.env 복사본(DFLOW_AS 줄은 뺀다…)` 을 `.dflow.local 복사본(as 줄은 뺀다. 레거시는 .env 에서 DFLOW_AS 를 뺀다. 값은 출력하지 않는다)` 로 바꾼다.

  (b) `base=…` 세 줄(`:15-17`)을 다음으로 바꾼다.

```sh
. "$(dirname "$0")/../../dflow-work/scripts/dflow-config.sh"
DFLOW_CONFIG_DIR=$PRIMARY; export DFLOW_CONFIG_DIR
dflow_config_load || exit 2
base=$(dflow_config_branch dev) || { echo "FAIL NO_DEFAULT_BRANCH" >&2; exit 2; }
```

  (c) `grep -qxF '**/.claude/worktrees/' …` 다음 줄에 `grep -qxF '.dflow.local' "$ex" || printf '%s\n' '.dflow.local' >> "$ex"` 를 더한다.

  (d) `.env` 처리 블록(`if [ -e "$LW/.env" ] … fi`) 전체를 다음으로 감싼다.

```sh
if [ "$DFLOW_CONFIG_MODE" = new ]; then
  # .dflow 가 커밋돼 있으면 워크트리에 이미 있다. 주 체크아웃에만 있는 것은 링크한다.
  if [ ! -e "$LW/.dflow" ] && [ -f "$PRIMARY/.dflow" ]; then ln -s "$PRIMARY/.dflow" "$LW/.dflow"; echo "DFLOW_LINKED $LW/.dflow"; fi
  if [ -e "$LW/.dflow.local" ]; then
    echo "LOCAL_KEPT $LW/.dflow.local"
  else
    # as 는 주 체크아웃 팀장의 키다. 따라가면 SAME_IDENTITY_LEAD 로 거부되므로 그 줄만 빼고 복사한다.
    ( umask 077; grep -v -E '^[[:space:]]*as[[:space:]]*=' "$PRIMARY/.dflow.local" > "$LW/.dflow.local" || [ $? = 1 ] )
    chmod 600 "$LW/.dflow.local"
    echo "LOCAL_COPIED $LW/.dflow.local (as 는 뺐다)"
  fi
else
  # (기존 .env 블록 그대로)
fi
```

  (e) 마지막 `NEXT 1)` 줄의 `$LW/.env 에 DFLOW_AS=<prefix>` 를 `$LW/.dflow.local 에 as=<prefix>(레거시는 .env 에 DFLOW_AS=<prefix>)` 로 바꾼다.

- [ ] **Step 3: 통과 확인**

Run: `npx vitest run tests/skills/dflow-lead-worktree.test.ts tests/skills/dflow-config.test.ts`
Expected: PASS. 기존 레거시 케이스(`.env` 복사본)도 그대로 통과한다.

- [ ] **Step 4: 커밋**

```bash
git add .claude/skills/dflow-team/scripts/lead-worktree.sh tests/skills/dflow-lead-worktree.test.ts
git commit -m "feat(dflow-team): 두 번째 팀장 워크트리를 개발 브랜치에서 따고 .dflow.local 을 복사한다"
```

---

### Task 5: 팀장·워커 문서(dflow-team)

**Files:**
- Modify: `.claude/skills/dflow-team/SKILL.md`, `references/worker-prompt.md`, `references/backends.md`, `references/help.md`
- Test: `tests/skills/dflow-config-docs.test.ts`(신규), `tests/skills/dflow-key-select.test.ts:214-237`(기대 문자열), `tests/skills/dflow-team-shell-blocks.test.ts`(기존, 파싱)

**Interfaces:**
- Consumes: `dflow.sh config <key>|projects|--source`, `dflow.sh branch dev`.
- Produces: 워커 프롬프트 인자 `DEV_BRANCH=<개발브랜치>` 와 치환자 `{DEV_BRANCH}`.

- [ ] **Step 1: 실패하는 문서 계약 테스트 작성**

```ts
// tests/skills/dflow-config-docs.test.ts
// .dflow 전환 뒤 스킬 문서가 지켜야 할 계약(docs/superpowers/specs/2026-09-23-dflow-config-design.md §7).
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8')
const TEAM = read('.claude/skills/dflow-team/SKILL.md')
const WORKER = read('.claude/skills/dflow-team/references/worker-prompt.md')
const BACKENDS = read('.claude/skills/dflow-team/references/backends.md')

describe('dflow-team 문서', () => {
  it('어느 셸 블록도 .env 를 source 하지 않는다 — dflow.sh 가 스스로 읽는다', () => {
    for (const [n, t] of [['TEAM', TEAM], ['WORKER', WORKER], ['BACKENDS', BACKENDS]]) {
      expect(t, n).not.toMatch(/\.\s+\.\/\.env/)
      expect(t, n).not.toContain('DFLOW_ENV_FILE="<MAIN>/.env"')
    }
  })
  it('전제 검사는 개발 브랜치를 dflow.sh branch dev 로 얻고 원격 존재를 확인한다', () => {
    expect(TEAM).toContain('base=$(.claude/skills/dflow-work/scripts/dflow.sh branch dev)')
    expect(TEAM).toContain('bad "NO_REMOTE_DEV_BRANCH $base"')
    expect(TEAM).not.toContain('base=$(git symbolic-ref --short refs/remotes/origin/HEAD')
  })
  it('poll 은 DFLOW_CONFIG_DIR 로 설정 위치를 받는다', () => {
    expect(TEAM).toContain('DFLOW_CONFIG_DIR="<MAIN>" DFLOW_WATCH=0')
  })
  it('자동 머지는 dflow.sh config automerge 로 읽는다', () => {
    expect(TEAM).toContain('[ "$(.claude/skills/dflow-work/scripts/dflow.sh config automerge)" = 1 ]')
  })
  it('워커에 개발 브랜치를 명시해서 넘기고, 워커는 다시 해석하지 않는다', () => {
    expect(TEAM).toContain('DEV_BRANCH=<개발브랜치>')
    expect(WORKER).toContain('| `{DEV_BRANCH}` | `DEV_BRANCH` |')
    expect(WORKER).toContain('`<기본브랜치>` 는 팀장이 넘긴 `{DEV_BRANCH}` 다')
    expect(WORKER).not.toContain('git symbolic-ref --short refs/remotes/origin/HEAD')
  })
  it('워크트리에는 .dflow.local 을 링크하고(레거시는 .env), 정리 규칙이 그 링크를 부산물로 본다', () => {
    expect(BACKENDS).toContain('ln -s "<MAIN>/.dflow.local" "$WT/.dflow.local"')
    expect(WORKER).toContain('ln -s {MAIN_CHECKOUT}/.dflow.local .dflow.local')
    expect(BACKENDS).toMatch(/\\\.dflow\\\.local/)
  })
  it('키 저장은 새 방식이면 .dflow.local 의 as', () => {
    expect(TEAM).toContain(`printf '\\nas=%s\\n' '<prefix>' >> .dflow.local`)
  })
})
```

Run: `npx vitest run tests/skills/dflow-config-docs.test.ts`
Expected: FAIL 7건.

- [ ] **Step 2: `dflow-team/SKILL.md` 수정**

  1. `:23` 「부를 때마다 `set -a; . ./.env; set +a` …」 문장을 「dflow.sh 는 `.dflow`·`.dflow.local`(레거시는 `.env`)을 스스로 읽으므로 접두를 붙이지 않는다」 로 바꾼다.
  2. `:39-47` 키 판정 절: `.env` 의 `DFLOW_PATS`/`DFLOW_AS=<prefix>` → `.dflow.local` 의 `pats`/`as=<prefix>`(레거시 `.env` 의 `DFLOW_AS`). `:47` 블록의 `(set -a; . ./.env; set +a; echo "DFLOW_AS=${DFLOW_AS:-없음}"; …)` 를 `(echo "as=$(.claude/skills/dflow-work/scripts/dflow.sh config as)"; .claude/skills/dflow-work/scripts/dflow.sh profiles)` 로.
  3. `:75-92` 키 저장: 블록을 다음으로 바꾸고, 보고·오류 문구의 `.env`·`DFLOW_AS` 를 같은 규칙으로 고친다(「`.dflow.local` 은 gitignore 대상이라 `DIRTY` 에 걸리지 않는다」).

```bash
if [ "$(.claude/skills/dflow-work/scripts/dflow.sh config --source | sed -n 's/^mode=//p')" = new ]; then
  printf '\nas=%s\n' '<prefix>' >> .dflow.local
else
  printf '\nDFLOW_AS=%s\n' '<prefix>' >> .env
fi
```

  4. `:175-183` 자동 머지: 「`DFLOW_AUTOMERGE=1`(`.env`, 기본 꺼짐)」 → 「`automerge=1`(`.dflow.local`, 개인 설정, 기본 0. 레거시는 `.env` 의 `DFLOW_AUTOMERGE=1`)」. 이유 문장의 「리포마다 정하는」 → 「사람마다 정하는」. 블록을 `[ "$(.claude/skills/dflow-work/scripts/dflow.sh config automerge)" = 1 ] && echo AUTOMERGE_ON || echo AUTOMERGE_OFF` 로.
  5. `:303`·`:625`·`:655`·`:800`·`:873`·`:914`·`:1236` 의 `set -a; . ./.env; set +a;` 접두(괄호 서브셸 포함)를 지운다. `:802` 의 `ps=$(set -a; . ./.env; set +a; { printf '%s\n' "${DFLOW_PROJECT_ID:-}" …)` 는 `ps=$(.claude/skills/dflow-work/scripts/dflow.sh config projects …)` 로 — 원래 파이프 뒷부분(`| tr -d ' ' | sed '/^$/d'`)은 `config projects` 가 이미 하므로 지운다. 줄을 고친 뒤 블록이 여전히 한 명령으로 이어지는지(역슬래시·괄호) 확인한다.
  6. `:356-371` 두 번째 팀장 절: `.env` 복사 설명을 「새 방식이면 `.dflow.local` 을 `as` 줄을 빼고 복사하고, 커밋되지 않은 `.dflow` 는 링크한다. 레거시는 `.env` 를 `DFLOW_AS` 줄을 빼고 복사한다」 로. 링크하지 않고 복사하는 이유 문단은 파일 이름만 바꿔 유지한다.
  7. `:404-406` 전제 검사의 `base=…` 두 줄과 `[ -n "$base" ] || bad NO_DEFAULT_BRANCH` 를 다음으로 바꾼다.

```bash
   base=$(.claude/skills/dflow-work/scripts/dflow.sh branch dev) || bad CONFIG
   [ -n "$base" ] || bad NO_DEFAULT_BRANCH
   [ -z "$base" ] || git rev-parse -q --verify "refs/remotes/origin/$base" >/dev/null || bad "NO_REMOTE_DEV_BRANCH $base"
```

     `NOT_DEFAULT_BRANCH` 문구는 「개발 브랜치 `$base` 또는 detached HEAD 여야 한다」 로 바꾸되 `bad "NOT_DEFAULT_BRANCH $base 또는 detached HEAD 여야 한다"` 문자열은 유지한다(`dflow-lead-worktree.test.ts:52` 가 단정한다).
  8. `:412-415` 를 다음으로 바꾼다.

```bash
   .claude/skills/dflow-work/scripts/dflow.sh config --source >/dev/null || bad "CONFIG .dflow·.dflow.local 을 확인하라(위 사유 코드)"
   [ -n "$(.claude/skills/dflow-work/scripts/dflow.sh config projects)" ] || bad "NO_PROJECT .dflow 의 project_id 또는 .dflow.local 의 project_map 을 넣어라"
   .claude/skills/dflow-work/scripts/dflow.sh doctor   # 진단 출력용. 종료 코드로 판정하지 않는다
   email=$(.claude/skills/dflow-work/scripts/dflow.sh me | jq -r '.user_email // empty')
```

     실패 처방 표(`:544` `NO_PROJECT`)에 `CONFIG`·`NO_REMOTE_DEV_BRANCH` 두 줄을 더한다: `CONFIG` 는 출력된 사유 코드(`NO_LOCAL`·`NO_DFLOW`·`NO_DEV_BRANCH`·`PERSONAL_KEY_IN_DFLOW`)대로 파일을 고친 뒤 다시 시작, `NO_REMOTE_DEV_BRANCH` 는 「개발 브랜치를 원격에 먼저 push 하라(`git push -u origin <브랜치>`)」.
  9. `:686-695` poll 블록의 `DFLOW_ENV_FILE="<MAIN>/.env"` → `DFLOW_CONFIG_DIR="<MAIN>"`, 설명 불릿을 「`DFLOW_CONFIG_DIR` 을 주는 이유: poll 의 cwd 는 git 작업 트리 밖(`.git/…`)이라 설정 위치를 스스로 찾지 못한다. 레거시 리포는 `<MAIN>/.env` 를 읽는다」 로.
  10. `:669` 「`.env` 에서 export 된 `DFLOW_PROJECT_ID`」 → 「설정에서 읽은 `project_id`」. `:939`·`:973` 의 `.env` → `.dflow`·`.dflow.local`.
  11. `:1028` 워커 프롬프트 인자 줄 끝에 ` DEV_BRANCH=<개발브랜치>` 를 더하고, 바로 아래 불릿에 「`DEV_BRANCH` 는 전제 검사의 `base` 다. 워커가 detach 된 옛 커밋에서 다른 값을 읽지 않도록 팀장이 넘긴다」 를 더한다.
  12. `:1039`·`:1116`·`:1218` 의 「`.env`·스킬 링크」·「`.env` 링크」 → 「`.dflow.local`(레거시 `.env`)·스킬 링크」.
  13. `origin/<기본브랜치>` 가 처음 나오는 절 앞(「1. 시작」 첫머리)에 한 문장: 「이 문서의 `<기본브랜치>` 는 개발 브랜치, 즉 `dflow.sh branch dev` 의 값이다(`.dflow.local` 의 `dev_branch`, 레거시는 `origin/HEAD`).」

- [ ] **Step 3: `worker-prompt.md` 수정**
  1. 치환 표(`:12-17`)에 행을 더한다: ``| `{DEV_BRANCH}` | `DEV_BRANCH` | 개발 브랜치 이름(`origin/` 없음). 팀장이 `dflow.sh branch dev` 로 해석해 넘긴다 |``
  2. `:19-21` 문단을 다음으로 바꾼다: 「`<기본브랜치>` 는 팀장이 넘긴 `{DEV_BRANCH}` 다. 워커는 이 값을 다시 해석하지 않는다. detach 된 옛 커밋에는 `.dflow` 가 없어 다른 값이 나올 수 있기 때문이다. `DEV_BRANCH` 인자가 비어 있으면 `.result` 에 `{TSK} {ID8} - - - failed no-dev-branch` 를 쓰고 끝낸다.」
  3. `:61-67` 부트스트랩: 문단의 「`.env` 는 gitignore 대상이라…」 를 「`.dflow.local`(레거시 `.env`)은 gitignore 대상이라 새 워크트리에 없으므로 메인 체크아웃에서 심링크한다. `.dflow` 는 커밋돼 있으면 이미 있고, 없으면 링크한다」 로. 블록 첫 줄을 다음 세 줄로 바꾼다.

```bash
[ -e .dflow.local ] || [ ! -e {MAIN_CHECKOUT}/.dflow.local ] || ln -s {MAIN_CHECKOUT}/.dflow.local .dflow.local
[ -e .dflow ] || [ ! -e {MAIN_CHECKOUT}/.dflow ] || ln -s {MAIN_CHECKOUT}/.dflow .dflow
[ -e .dflow.local ] || [ -e .env ] || ln -s {MAIN_CHECKOUT}/.env .env
```

  4. `:105-106` 「현재 디렉터리의 `.env`(부트스트랩에서 만든 심링크)를 스스로 읽는다」 → 「워크트리 루트의 `.dflow`·`.dflow.local`(레거시 `.env`, 모두 부트스트랩의 링크)을 스스로 읽는다」.

- [ ] **Step 4: `backends.md` 수정**
  1. `:61` 을 다음 세 줄로 바꾼다.

```bash
[ -e "$WT/.dflow.local" ] || [ ! -e "<MAIN>/.dflow.local" ] || ln -s "<MAIN>/.dflow.local" "$WT/.dflow.local"
[ -e "$WT/.dflow" ] || [ ! -e "<MAIN>/.dflow" ] || ln -s "<MAIN>/.dflow" "$WT/.dflow"
[ -e "$WT/.dflow.local" ] || [ -e "$WT/.env" ] || ln -s "<MAIN>/.env" "$WT/.env"
```

  2. `:311` 정리 규칙 정규식의 `\.env` 를 `\.env|\.dflow|\.dflow\.local` 로. `:252`·`:304` 의 부산물 목록에 `.dflow`·`.dflow.local` 링크를 더한다. `:126`·`:130-132`·`:188`·`:367`·`:376` 의 `.env` 를 「`.dflow.local`(레거시 `.env`)」 로.
  3. 워크트리 생성 줄의 `origin/<기본브랜치>` 는 그대로 둔다(팀장의 `base`).

- [ ] **Step 5: `help.md` 수정** — `:57-60` 준비물을 「`.dflow`(커밋, `api_base`·`project_id`) 와 `.dflow.local`(개인, `pats`·`dev_branch` 필수, `as`·`automerge`·`project_map` 선택). 예시는 `.claude/skills/dflow-work/dflow.example`·`dflow.local.example`. 두 파일이 없으면 종전 `.env` 로 동작한다」 로. `:68-69` 두 번째 팀장의 `.env` → `.dflow.local`(`as` 제외 복사). `:93` 자동 머지 → `.dflow.local` 의 `automerge=1`, 「main 에 머지」 → 「개발 브랜치에 머지」.

- [ ] **Step 6: 기존 문서 테스트 기대 갱신** — `tests/skills/dflow-key-select.test.ts:214-215` 의 기대를 `printf '\\nas=%s\\n' '<prefix>' >> .dflow.local` 로 바꾼다(레거시 줄도 문서에 남으므로 기존 단정을 지우지 말고 새 단정을 더해도 된다). `:235-237` 의 부정 단정은 그대로 둔다.

- [ ] **Step 7: 통과 확인**

Run: `npx vitest run tests/skills/`
Expected: PASS 전부. `dflow-team-shell-blocks` 가 바꾼 블록을 sh·bash·zsh 로 파싱한다.

- [ ] **Step 8: 커밋**

```bash
git add .claude/skills/dflow-team/SKILL.md .claude/skills/dflow-team/references/worker-prompt.md .claude/skills/dflow-team/references/backends.md .claude/skills/dflow-team/references/help.md tests/skills/dflow-config-docs.test.ts tests/skills/dflow-key-select.test.ts
git commit -m "docs(dflow-team): 팀장·워커가 .dflow 설정과 개발 브랜치를 쓴다"
```

---

### Task 6: 나머지 스킬 문서

**Files:**
- Modify: `.claude/skills/dflow-dev/SKILL.md`, `.claude/skills/dflow-merge/SKILL.md`, `.claude/skills/dflow-work/SKILL.md`, `.claude/skills/dflow-work/references/troubleshooting.md`, `.claude/skills/dflow-work/references/api-contract.md`, `.claude/skills/dflow-poll/SKILL.md`, `.claude/skills/dflow-wbs/SKILL.md`, `.claude/skills/dflow-export/SKILL.md`
- Test: `tests/skills/dflow-config-docs.test.ts`(describe 추가)

- [ ] **Step 1: 실패하는 테스트 추가**

```ts
const DEV = read('.claude/skills/dflow-dev/SKILL.md')
const MERGE = read('.claude/skills/dflow-merge/SKILL.md')
describe('나머지 스킬 문서', () => {
  it('dflow-dev·dflow-merge 가 <기본브랜치> 를 개발 브랜치로 정의한다', () => {
    for (const t of [DEV, MERGE]) expect(t).toContain('`<기본브랜치>` 는 개발 브랜치, 즉 `dflow.sh branch dev` 의 값이다')
    expect(MERGE).not.toContain('기본브랜치(main)')
  })
  it('dflow-merge 는 api_base 를 dflow.sh config 로 얻는다', () => {
    expect(MERGE).toContain('api=$(.claude/skills/dflow-work/scripts/dflow.sh config api_base)')
    expect(MERGE).not.toMatch(/\.\s+\.\/\.env/)
  })
  it('바인딩 안내가 .dflow·.dflow.local 을 가리킨다', () => {
    for (const p of ['dflow-dev/SKILL.md', 'dflow-wbs/SKILL.md', 'dflow-export/SKILL.md', 'dflow-work/SKILL.md'])
      expect(read(`.claude/skills/${p}`), p).toContain('project_map')
  })
})
```

Run: `npx vitest run tests/skills/dflow-config-docs.test.ts`
Expected: FAIL 3건.

- [ ] **Step 2: 문서 수정**
  - **dflow-dev**: 「Phase 01」 제목 바로 아래(또는 `origin/<기본브랜치>` 가 처음 나오는 절 앞)에 문장 `` `<기본브랜치>` 는 개발 브랜치, 즉 `dflow.sh branch dev` 의 값이다(`.dflow.local` 의 `dev_branch`, 레거시는 `origin/HEAD`). 팀원(`--worker`)은 팀장이 넘긴 `DEV_BRANCH` 를 쓴다. `` 를 넣는다. `:189` 「`.env` 의 `DFLOW_PROJECT_ID`·`DFLOW_PROJECT_MAP`」 → 「`.dflow` 의 `project_id`·`.dflow.local` 의 `project_map`」. `:325` 「`DFLOW_AUTOMERGE=1`」 → 「`automerge=1`」.
  - **dflow-merge**: `:3` description 의 「기본브랜치(main)에 반영」 → 「개발 브랜치(`.dflow.local` 의 `dev_branch`)에 반영」. 첫 절에 dflow-dev 와 같은 정의 문장. `:30` `set -a; . ./.env; set +a; api=${DFLOW_API_BASE%/}` → `api=$(.claude/skills/dflow-work/scripts/dflow.sh config api_base); api=${api%/}`. `:72` 「스테이징 `.env`」 → 「스테이징 `api_base`(export 된 `DFLOW_API_BASE`)」. `:81` 의 `set -a; . ./.env; set +a;` 접두 제거.
  - **dflow-work SKILL**: `:16-18` 0번 항목을 「설정 — dflow.sh 는 워크트리 최상위의 `.dflow`(프로젝트 공통: `api_base`·`project_id`·`release_branch`)와 `.dflow.local`(개인: `pats`·`as`·`dev_branch`·`automerge`·`project_map`)을 스스로 읽는다. 이미 export 된 env 가 이긴다. 두 파일이 모두 없으면 종전대로 현재 디렉터리의 `.env`(`DFLOW_ENV_FILE`)를 읽는다. 값 확인은 `dflow.sh config <key>`(비밀 제외)·`dflow.sh branch dev`」 로. `:35`·`:66`·`:134` 의 `.env` 키 이름을 새 키로(레거시 병기).
  - **troubleshooting.md:182**, **api-contract.md:8-10·:239**: `.env` 의 `DFLOW_AS=<prefix>` → `.dflow.local` 의 `as=<prefix>`(레거시 `.env` 의 `DFLOW_AS`).
  - **dflow-poll SKILL**: `:35`·`:47` 「`.env` 소싱」 → 「설정 로드(`.dflow`·`.dflow.local`, 레거시 `.env`)」, 기본값 문장 「설정은 cwd 의 git 최상위, `DFLOW_CONFIG_DIR` 로 오버라이드. 레거시 `.env` 는 `DFLOW_ENV_FILE`」.
  - **dflow-wbs**: `:192` 제목 「wbs.md 가 아니라 작업 리포의 `.dflow`·`.dflow.local`」. `:194-217` 바인딩 해석 순서를 「1. `.dflow.local` 의 `project_map` 에 현재 `DOCS_DIR` 키가 있으면 그 값 2. `.dflow` 의 `project_id` 3. 둘 다 없으면 업로드하지 않는다」 로(값 확인은 `dflow.sh config project_map`·`config project_id`, 레거시 `.env` 병기). 예시 블록(`:202` 근처)의 `DFLOW_PROJECT_MAP=…` 를 `project_map=docs/c10=<uuid>,docs/m30=<uuid>   # .dflow.local` 로. 「`.env` 는 존재·키 유무만」 불릿은 「설정 파일 값은 출력하지 않는다(`.dflow.local` 에 PAT 가 있다)」 로. `:566-576` 도 같게.
  - **dflow-export**: `:25-31` 을 dflow-wbs 와 같은 순서·문구로.

- [ ] **Step 3: 통과 확인**

Run: `npx vitest run tests/skills/`
Expected: PASS 전부.

- [ ] **Step 4: 남은 언급 점검** — `grep -rn '\.env\b' .claude/skills | grep -v '\.env\.local' | grep -v '레거시'` 결과를 한 줄씩 보고, 레거시 설명이 아닌 것을 고친다. `grep -rn 'symbolic-ref --short refs/remotes/origin/HEAD' .claude/skills` 는 `dflow-config.sh` 한 곳만 남아야 한다.

- [ ] **Step 5: 커밋**

```bash
git add .claude/skills/dflow-dev/SKILL.md .claude/skills/dflow-merge/SKILL.md .claude/skills/dflow-work/SKILL.md .claude/skills/dflow-work/references/troubleshooting.md .claude/skills/dflow-work/references/api-contract.md .claude/skills/dflow-poll/SKILL.md .claude/skills/dflow-wbs/SKILL.md .claude/skills/dflow-export/SKILL.md tests/skills/dflow-config-docs.test.ts
git commit -m "docs(dflow-*): 기본 브랜치를 개발 브랜치로 정의하고 바인딩 안내를 .dflow 로 옮긴다"
```

---

### Task 7: 예시 파일과 킷 설치

**Files:**
- Create: `.claude/skills/dflow-work/dflow.example`, `.claude/skills/dflow-work/dflow.local.example`
- Modify: `kit/install.sh`, `kit/README.md`, `scripts/kit-build.sh`
- Delete: `kit/.env.example`
- Test: `tests/skills/dflow-key-select.test.ts:252-253`, `tests/skills/dflow-team-kit.test.ts`

- [ ] **Step 1: 실패하는 테스트로 기대 교체** — `dflow-key-select.test.ts:252` 의 케이스를 다음으로 바꾼다.

```ts
it('dflow.local.example 에 빈 as 와 prefix 설명이 있고, dflow.example 에는 개인 키가 없다', () => {
  const l = read('.claude/skills/dflow-work/dflow.local.example')
  expect(l).toMatch(/^as=$/m); expect(l).toMatch(/^dev_branch=/m); expect(l).toContain('prefix')
  const d = read('.claude/skills/dflow-work/dflow.example')
  expect(d).toMatch(/^api_base=/m)
  expect(d).not.toMatch(/^(pats|pat|as|dev_branch|automerge|project_map)=/m)
})
```

  `dflow-team-kit.test.ts` 에 케이스를 더한다.

```ts
it('install.sh 는 .dflow·.dflow.local 초안을 만들고 .dflow.local 을 gitignore 에 넣는다', () => {
  const t = readFileSync(join(ROOT, 'kit/install.sh'), 'utf8')
  expect(t).toContain('.dflow.local')
  expect(t).toContain('dflow.local.example')
  expect(t).not.toContain('.env.example')
  expect(readFileSync(join(ROOT, 'scripts/kit-build.sh'), 'utf8')).not.toContain('.env.example')
})
```

  (`ROOT`·`readFileSync`·`join` 은 그 파일에 이미 있다. 없으면 import 에 더한다.)

Run: `npx vitest run tests/skills/dflow-key-select.test.ts tests/skills/dflow-team-kit.test.ts`
Expected: FAIL — 예시 파일이 없다.

- [ ] **Step 2: 예시 파일 작성**

`.claude/skills/dflow-work/dflow.example`:
```ini
# .dflow — D'Flow 에이전트 프로젝트 공통 설정. 리포에 커밋한다(비밀을 넣지 않는다).
# 같은 프로젝트를 하는 사람은 모두 같은 값을 쓴다. 개인 값(토큰·개발 브랜치)은 .dflow.local 에 둔다.

# D'Flow 서버. 스테이징 시험은 파일을 고치지 말고 그 세션에만 DFLOW_API_BASE 를 export 한다.
api_base=https://wbs-web.vercel.app

# 이 리포가 속한 D'Flow 프로젝트 UUID(프로젝트 URL /p/<UUID>/). 서브시스템마다 프로젝트가 다르면 비우고
# 각자 .dflow.local 의 project_map 에 맡은 것만 적는다.
project_id=

# 운영 브랜치 — 개발 브랜치를 승격해서만 들어간다. 비우면 원격 기본 브랜치(origin/HEAD).
release_branch=main
```

`.claude/skills/dflow-work/dflow.local.example`:
```ini
# .dflow.local — D'Flow 에이전트 개인 설정. git 에 올리지 않는다(.gitignore). 값은 어디에도 출력·붙여넣지 않는다.

# 개인 액세스 토큰 — D'Flow 웹 /account "내 토큰" 에서 발급. 쉼표로 여러 개(첫 토큰이 기본). 하나면 pat= 도 된다.
pats=

# 토큰이 둘 이상일 때 이 리포가 쓸 키의 prefix(토큰의 셋째 '_' 칸). 비우면 첫 토큰. 목록은 dflow.sh profiles.
# /dflow-team 은 비어 있으면 시작할 때 정해서 파일 끝에 적는다.
as=

# 내 개발 브랜치(필수). 에이전트 머지·스택 기점·반영 확인의 기준이다. 동료와 같은 이름을 쓰면 그 브랜치를 공유한다.
# 운영 브랜치에서 직접 개발하면 그 이름(예 main)을 적는다. 원격에 먼저 push 돼 있어야 한다.
dev_branch=

# 1 이면 팀장이 완료 보고된 작업을 승인 전에 개발 브랜치로 머지한다. 기본 0.
automerge=0

# 내가 맡은 서브시스템의 DOCS_DIR=프로젝트 UUID(쉼표 구분). 리포 전체가 한 프로젝트면 비운다.
# project_map=docs/c10=<uuid>
```

- [ ] **Step 3: install.sh·kit-build·README 수정**
  - `kit/install.sh:4-5` 머리말의 `.env 초안` → `.dflow·.dflow.local 초안`. `:36-44` 블록을 다음으로 바꾼다.

```sh
# 3) 설정 초안 + .gitignore — .dflow 는 커밋 대상, .dflow.local 은 개인 파일
EX="$TARGET/.claude/skills/dflow-work"
if [ ! -f "$TARGET/.dflow" ]; then cp "$EX/dflow.example" "$TARGET/.dflow"; echo ".dflow 초안 생성 — 값을 채워 커밋하라: $TARGET/.dflow"
else echo ".dflow 이미 있음"; fi
if [ ! -f "$TARGET/.dflow.local" ]; then
  ( umask 077; cp "$EX/dflow.local.example" "$TARGET/.dflow.local" ); echo ".dflow.local 초안 생성 — pats·dev_branch 를 채워라: $TARGET/.dflow.local"
else echo ".dflow.local 이미 있음 — pats·dev_branch 가 있는지 확인할 것"; fi
[ -f "$TARGET/.env" ] && grep -q '^DFLOW_' "$TARGET/.env" && echo "⚠ .env 의 DFLOW_* 는 .dflow·.dflow.local 로 옮겨라(두 파일이 있으면 .env 는 읽지 않는다)"
touch "$TARGET/.gitignore"
grep -qx '\.dflow\.local' "$TARGET/.gitignore" || printf '\n# dflow-kit — 개인 설정(토큰)\n.dflow.local\n' >> "$TARGET/.gitignore"
```

  - `kit/install.sh:77-78` 다음 단계 안내: `2. $TARGET/.dflow 에 api_base·project_id, $TARGET/.dflow.local 에 pats·dev_branch 기입(값은 어디에도 붙여넣지 말 것). .dflow 는 커밋한다` / `3. cd $TARGET && .claude/skills/dflow-work/scripts/dflow.sh doctor`.
  - `scripts/kit-build.sh:22` 의 `cp "$ROOT/kit/.env.example" …` 줄을 지운다(예시는 `skills/dflow-work/` 에 실려 간다). 머리말 `:4` 의 `.env.example` 도 지운다.
  - `git rm kit/.env.example`.
  - `kit/README.md` 에서 `.env` 설정 절을 두 파일 설명으로 바꾼다(`grep -n '\.env' kit/README.md` 의 줄마다).

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run tests/skills/` 그리고 `bash scripts/kit-build.sh "$(mktemp -d)"` → exit 0, 출력 디렉터리에 `skills/dflow-work/dflow.local.example` 이 있고 `.dflow`·`.dflow.local`·`.env.example` 은 없다.

- [ ] **Step 5: 커밋**

```bash
git add .claude/skills/dflow-work/dflow.example .claude/skills/dflow-work/dflow.local.example kit/install.sh kit/README.md scripts/kit-build.sh tests/skills/dflow-key-select.test.ts tests/skills/dflow-team-kit.test.ts
git rm -q kit/.env.example
git commit -m "feat(kit): 설치가 .dflow·.dflow.local 초안을 만들고 .env 예시를 걷어낸다"
```

---

### Task 8: wbs-web 적용과 staging 반영

**Files:**
- Modify: `.gitignore`
- Create: `.dflow`(커밋), 메인 체크아웃의 `.dflow.local`(커밋하지 않음)

**순서가 중요하다.** 메인 체크아웃(`/Users/jji/project/wbs-web`)은 병렬 세션이 함께 쓴다. `.dflow` 가 staging 에 올라가 메인 체크아웃이 그것을 받는 순간, `.dflow.local` 이 없으면 이 PC 의 모든 dflow.sh 호출이 `NO_LOCAL` 로 멈춘다. 그래서 `.dflow.local` 을 먼저 만든다.

- [ ] **Step 1: 메인 체크아웃에 `.dflow.local` 생성(값 출력 금지)**

```bash
cd /Users/jji/project/wbs-web
[ -e .dflow.local ] && echo EXISTS || (
  umask 077
  { echo '# .dflow.local — 개인 설정. 커밋하지 않는다.'
    sed -n -e 's/^[[:space:]]*\(export[[:space:]]\{1,\}\)\{0,1\}DFLOW_PATS=/pats=/p' \
           -e 's/^[[:space:]]*\(export[[:space:]]\{1,\}\)\{0,1\}DFLOW_PAT=/pat=/p' \
           -e 's/^[[:space:]]*\(export[[:space:]]\{1,\}\)\{0,1\}DFLOW_AS=/as=/p' \
           -e 's/^[[:space:]]*\(export[[:space:]]\{1,\}\)\{0,1\}DFLOW_PROJECT_MAP=/project_map=/p' \
           -e 's/^[[:space:]]*\(export[[:space:]]\{1,\}\)\{0,1\}DFLOW_AUTOMERGE=/automerge=/p' .env
    echo 'dev_branch=staging'
  } > .dflow.local )
chmod 600 .dflow.local; grep -c '' .dflow.local; cut -d= -f1 .dflow.local
```

Expected: 키 이름만 보인다(`pats`·`project_map`·`dev_branch` 등). 값은 출력하지 않는다.

- [ ] **Step 2: `.gitignore` 와 `.dflow` 작성(구현 워크트리에서)** — `.gitignore` 의 `.env*` 줄 아래에 `.dflow.local` 을 더한다. `.dflow` 는 메인 체크아웃 `.env` 의 `DFLOW_API_BASE` 값을 그대로 옮긴다(URL 이라 비밀이 아니지만 파일에서 파일로만 옮긴다).

```bash
MAIN=/Users/jji/project/wbs-web
{ echo "# .dflow — D'Flow 에이전트 프로젝트 공통 설정(커밋). 개인 값은 .dflow.local."
  sed -n 's/^[[:space:]]*\(export[[:space:]]\{1,\}\)\{0,1\}DFLOW_API_BASE=/api_base=/p' "$MAIN/.env" | tail -n 1
  echo 'release_branch=main'
} > .dflow
cut -d= -f1 .dflow
```

  wbs-web 은 `DFLOW_PROJECT_MAP` 만 쓰므로 `project_id` 는 두지 않는다(바인딩은 각자의 `.dflow.local` 의 `project_map`).

- [ ] **Step 3: 메인 체크아웃에서 새 설정 확인(커밋 전)** — 메인 체크아웃에 아직 `.dflow` 가 없으므로, 구현 워크트리의 스크립트와 `.dflow` 로 해석해 본다.

```bash
D=$(mktemp -d); cp .dflow "$D/.dflow"; cp "$MAIN/.dflow.local" "$D/.dflow.local"
DFLOW_CONFIG_DIR="$D" sh .claude/skills/dflow-work/scripts/dflow.sh config --source
DFLOW_CONFIG_DIR="$D" sh .claude/skills/dflow-work/scripts/dflow.sh branch dev
DFLOW_CONFIG_DIR="$D" sh .claude/skills/dflow-work/scripts/dflow.sh me | jq -r '.user_email'
rm -rf "$D"
```

Expected: `mode=new`, `staging`, 사용자 이메일 한 줄.

- [ ] **Step 4: 전체 검사**

Run: `npx vitest run tests/skills/` 그리고 `npm run lint` 그리고 `npm run test`
Expected: 모두 통과. 실패하면 출력 그대로 보고하고 멈춘다.

- [ ] **Step 5: 커밋**

```bash
git add .gitignore .dflow
git commit -m "chore: wbs-web 에 .dflow 프로젝트 설정을 커밋하고 .dflow.local 을 무시한다"
```

- [ ] **Step 6: staging 반영** — 구현 브랜치를 staging 에 머지한다(`origin/main` back-merge 는 CLAUDE.md 규칙대로). push 전에 메인 체크아웃의 `.dflow.local` 이 있는지 한 번 더 확인한다(`test -f /Users/jji/project/wbs-web/.dflow.local`). push 뒤 메인 체크아웃에서 `.claude/skills/dflow-work/scripts/dflow.sh config --source` 가 `mode=new` 를 내는지 확인한다.

- [ ] **Step 7: 보고** — 다른 PC 의 wbs-web 체크아웃은 staging 을 받으면 `NO_LOCAL` 로 멈춘다는 사실과 처방(Step 1 과 같은 방식으로 `.dflow.local` 을 만든다)을 사용자에게 알린다. main·킷 반영은 제안하지 않는다.
