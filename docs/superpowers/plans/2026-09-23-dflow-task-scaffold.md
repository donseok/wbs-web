# 담당 작업 폴더 scaffold 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 팀장이 시작할 때 내게 배정된 작업의 `<DOCS_DIR>/tasks/<TSK>/state.json`(phase=ready)을 만들고, 모든 dflow 스킬이 작업 폴더를 `project_map` 의 DOCS_DIR 아래에서 찾게 한다.

**Architecture:** 설정 해석 라이브러리 `dflow-config.sh` 에 역매핑(`project_id → DOCS_DIR`)과 작업 폴더 목록 함수를 더하고, `dflow.sh` 가 `config docs-dir`·`config tasks-dirs`·`taskdir`·`scaffold` 로 노출한다. 스크립트(`dflow.sh write_spec_cache`·`poll.sh`)와 스킬 문서는 고정 경로 `docs/tasks` 대신 이 명령만 부른다. 서버는 `/work/mine` 의 item 에 `external_ref` 를 더한다.

**Tech Stack:** POSIX sh + jq(스킬 스크립트), Next.js route(TypeScript), vitest(`npm test`).

**Spec:** `docs/superpowers/specs/2026-09-23-dflow-task-scaffold-design.md`

## Global Constraints

- 작업 폴더: `<DOCS_DIR>/tasks/<TSK>/`. DOCS_DIR 은 `project_map` 에서 값이 그 UUID 인 키(끝 `/` 제거), 매핑이 없고 `project_id` 와 같으면 `docs`.
- 해석 실패 코드: 같은 UUID 가 둘 이상 → exit 2 `AMBIGUOUS_DOCS_DIR`, 바인딩 밖 → exit 2 `PROJECT_MISMATCH`.
- scaffold 대상: `/api/v1/agent/work/mine?scope=assigned&limit=100` 의 `assigned` ∩ 바인딩. 남의 작업은 만들지 않는다.
- 초기 state.json: `{"tsk":"<TSK>","order":"<전체 UUID 36자>","api_base":"<끝 / 제거>","phase":"ready"}`.
- 이미 있는 폴더는 내용을 보지도 고치지도 않는다.
- 커밋은 새 파일이 있고 현재 브랜치가 `dflow.sh branch dev` 일 때만. 파일명을 명시한다. push 실패는 exit 0 + 경고.
- 출력 한 줄: `scaffold created=N skipped=N no_ref=N`.
- 설정 파일 값(PAT 등)은 어떤 출력에도 넣지 않는다. 설정 파일은 source 하지 않는다.
- glob 대신 `find` 를 쓴다(zsh `no matches found` 회피 — 기존 관례).
- 구현 워크트리 `feat/dflow-task-scaffold`(기점 `staging`), 반영은 staging 까지.

## Review Focus

- `project_map` 값에 공백·CR·끝 `/`(`docs/mdm/ = uuid`)가 섞인 설정 → 같은 DOCS_DIR 로 해석돼야 한다(Task 1 테스트).
- 커밋 전에 사람이 다른 파일을 stage 해 둔 상태에서 scaffold → 그 파일은 scaffold 커밋에 들어가면 안 된다(Task 4 테스트).
- 하위 디렉터리에서 `dflow.sh scaffold` 실행 → 폴더는 리포 최상위 기준으로 생겨야 한다(Task 4 테스트).
- 목록에 같은 TSK 가 두 주문으로 나오는 경우(재발행 과도기) → 폴더 하나, 첫 주문만 기록(Task 4 테스트).
- `external_ref` 가 없는 옛 서버 → 전부 `no_ref` 로 집계하고 업데이트 안내를 낸다(Task 4 테스트).

---

### Task 1: 역매핑 해석기

**Files:**
- Modify: `.claude/skills/dflow-work/scripts/dflow-config.sh`(끝에 함수 2개)
- Modify: `.claude/skills/dflow-work/scripts/dflow.sh:26-45`(usage), `:499-507`(`cmd_config`)
- Test: `tests/skills/dflow-task-dirs.test.ts`(신규)

**Interfaces:**
- Produces: `dflow_config_docs_dir <uuid>` → stdout DOCS_DIR 한 줄, 실패 시 stderr 코드 + return 2.
  `dflow_config_tasks_dirs` → 바인딩된 `<DOCS_DIR>/tasks` 를 줄마다(정렬·중복 제거).
  `dflow.sh config docs-dir <uuid>`, `dflow.sh config tasks-dirs`(토큰·네트워크 불필요).

- [ ] **Step 1: 실패하는 테스트 작성** — `tests/skills/dflow-task-dirs.test.ts`

```ts
// 작업 폴더 역매핑(docs/superpowers/specs/2026-09-23-dflow-task-scaffold-design.md §3).
import { describe, expect, it } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const LIB = join(process.cwd(), '.claude/skills/dflow-work/scripts/dflow-config.sh')
const DFLOW = join(process.cwd(), '.claude/skills/dflow-work/scripts/dflow.sh')
const A = '11111111-1111-4111-8111-111111111111'
const B = '22222222-2222-4222-8222-222222222222'
const C = '33333333-3333-4333-8333-333333333333'

function lib(script: string, env: Record<string, string>) {
  const r = spawnSync('sh', ['-c', `. '${LIB}'; ${script}`], {
    encoding: 'utf8', env: { PATH: process.env.PATH ?? '', NODE_ENV: process.env.NODE_ENV, ...env } as NodeJS.ProcessEnv,
  })
  return { code: r.status, out: r.stdout ?? '', err: r.stderr ?? '' }
}

describe('dflow_config_docs_dir', () => {
  it('project_map 의 키를 돌려준다(끝 / 와 공백 제거)', () => {
    const r = lib(`dflow_config_docs_dir ${B}`, { DFLOW_PROJECT_MAP: `docs/c10=${A}, docs/mdm/ = ${B}\r` })
    expect(r.code, r.err).toBe(0); expect(r.out).toBe('docs/mdm\n')
  })
  it('매핑이 없고 project_id 와 같으면 docs', () => {
    const r = lib(`dflow_config_docs_dir ${A}`, { DFLOW_PROJECT_ID: A })
    expect(r.code, r.err).toBe(0); expect(r.out).toBe('docs\n')
  })
  it('project_map 이 project_id 보다 우선한다', () => {
    const r = lib(`dflow_config_docs_dir ${A}`, { DFLOW_PROJECT_ID: A, DFLOW_PROJECT_MAP: `docs/c10=${A}` })
    expect(r.out).toBe('docs/c10\n')
  })
  it('바인딩 밖이면 PROJECT_MISMATCH 로 return 2', () => {
    const r = lib(`dflow_config_docs_dir ${C}`, { DFLOW_PROJECT_ID: A, DFLOW_PROJECT_MAP: `docs/c10=${B}` })
    expect(r.code).toBe(2); expect(r.err).toContain('PROJECT_MISMATCH'); expect(r.out).toBe('')
  })
  it('같은 UUID 가 다른 키로 두 번이면 AMBIGUOUS_DOCS_DIR', () => {
    const r = lib(`dflow_config_docs_dir ${B}`, { DFLOW_PROJECT_MAP: `docs/a=${B},docs/b=${B}` })
    expect(r.code).toBe(2); expect(r.err).toContain('AMBIGUOUS_DOCS_DIR')
  })
  it('같은 키·같은 UUID 중복은 하나로 본다', () => {
    const r = lib(`dflow_config_docs_dir ${B}`, { DFLOW_PROJECT_MAP: `docs/a=${B},docs/a/=${B}` })
    expect(r.code, r.err).toBe(0); expect(r.out).toBe('docs/a\n')
  })
  it('인자가 없으면 return 2', () => {
    expect(lib('dflow_config_docs_dir', { DFLOW_PROJECT_ID: A }).code).toBe(2)
  })
})

describe('dflow_config_tasks_dirs', () => {
  it('project_id 는 docs/tasks, map 키마다 <키>/tasks', () => {
    const r = lib('dflow_config_tasks_dirs', { DFLOW_PROJECT_ID: A, DFLOW_PROJECT_MAP: `docs/mdm/=${B},docs/c10=${C}` })
    expect(r.out).toBe('docs/c10/tasks\ndocs/mdm/tasks\ndocs/tasks\n')
  })
  it('바인딩이 없으면 빈 출력', () => {
    expect(lib('dflow_config_tasks_dirs', {}).out).toBe('')
  })
})

describe('dflow.sh config docs-dir|tasks-dirs', () => {
  const run = (args: string[]) => spawnSync('sh', [DFLOW, ...args], {
    encoding: 'utf8', cwd: mkdtempSync(join(tmpdir(), 'dflow-td-')),
    env: {
      PATH: process.env.PATH ?? '', NODE_ENV: process.env.NODE_ENV, HOME: '/nonexistent',
      DFLOW_ENV_FILE: '/nonexistent/.env', DFLOW_CONFIG_DIR: '/nonexistent',
      DFLOW_PROJECT_MAP: `docs/mdm=${B}`,
    } as NodeJS.ProcessEnv,
  })
  it('docs-dir 는 해석 결과를, 실패는 exit 2 를 낸다', () => {
    const ok = run(['config', 'docs-dir', B]); expect(ok.status, ok.stderr).toBe(0); expect(ok.stdout).toBe('docs/mdm\n')
    const bad = run(['config', 'docs-dir', C]); expect(bad.status).toBe(2); expect(bad.stderr).toContain('PROJECT_MISMATCH')
  })
  it('tasks-dirs 는 목록을 낸다', () => {
    const r = run(['config', 'tasks-dirs']); expect(r.stdout).toBe('docs/mdm/tasks\n')
  })
})
```

- [ ] **Step 2: 실패 확인** — Run: `npx vitest run tests/skills/dflow-task-dirs.test.ts` / Expected: FAIL(`dflow_config_docs_dir: not found`, `UNKNOWN_KEY docs-dir`).

- [ ] **Step 3: 구현** — `dflow-config.sh` 끝(`dflow_config_projects` 아래)에 추가:

```sh
# 작업 폴더 역매핑: $1=프로젝트 UUID → DOCS_DIR 한 줄(끝 / 제거). 작업 폴더는 <DOCS_DIR>/tasks/<TSK>.
# project_map 의 키가 먼저, 없고 project_id 와 같으면 docs. 추측하지 않는다(스펙 2026-09-23-dflow-task-scaffold §3).
dflow_config_docs_dir() {
  _dfc_u=$(printf '%s' "${1:-}" | tr -d ' \r')
  [ -n "$_dfc_u" ] || { echo "사용: dflow_config_docs_dir <project_uuid>" >&2; return 2; }
  _dfc_keys=$(printf '%s' "${DFLOW_PROJECT_MAP:-}" | tr ',' '\n' | tr -d ' \r' \
    | awk -F= -v u="$_dfc_u" 'NF == 2 && $2 == u { sub(/\/+$/, "", $1); if ($1 != "") print $1 }' | sort -u)
  _dfc_n=$(printf '%s' "$_dfc_keys" | grep -c .)
  if [ "$_dfc_n" -gt 1 ]; then
    echo "AMBIGUOUS_DOCS_DIR 프로젝트 ${_dfc_u%%-*} 가 project_map 에 여러 키로 있다" >&2; return 2
  fi
  [ "$_dfc_n" -eq 1 ] && { printf '%s\n' "$_dfc_keys"; return 0; }
  [ "$(printf '%s' "${DFLOW_PROJECT_ID:-}" | tr -d ' \r')" = "$_dfc_u" ] && { echo docs; return 0; }
  echo "PROJECT_MISMATCH 프로젝트 ${_dfc_u%%-*} 는 이 리포 바인딩(project_id·project_map) 밖이다" >&2; return 2
}
# 바인딩된 작업 폴더 목록(리포 최상위 기준 상대경로). 여러 작업을 훑는 스윕·감지가 쓴다.
dflow_config_tasks_dirs() {
  { [ -n "$(printf '%s' "${DFLOW_PROJECT_ID:-}" | tr -d ' \r')" ] && echo docs
    printf '%s' "${DFLOW_PROJECT_MAP:-}" | tr ',' '\n' | tr -d ' \r' \
      | awk -F= 'NF == 2 && $2 != "" { sub(/\/+$/, "", $1); if ($1 != "") print $1 }'
  } | sed 's|$|/tasks|' | sort -u
}
```

`dflow.sh` `cmd_config` 의 case 에 `projects)` 줄 아래로 추가:

```sh
    docs-dir) [ -n "${2:-}" ] || usage; dflow_config_docs_dir "$2" || exit 2 ;;
    tasks-dirs) dflow_config_tasks_dirs ;;
```

usage 의 `config <key>|projects|--source` 줄을 다음으로 바꾼다:

```
  config <key>|projects|--source|docs-dir <uuid>|tasks-dirs
                         설정 값·바인딩·판정 출처·작업 폴더 역매핑(비밀 키는 거부)
```

- [ ] **Step 4: 통과 확인** — Run: `npx vitest run tests/skills/dflow-task-dirs.test.ts tests/skills/dflow-config.test.ts tests/skills/shell-syntax.test.ts` / Expected: PASS.

- [ ] **Step 5: 커밋**

```bash
git add .claude/skills/dflow-work/scripts/dflow-config.sh .claude/skills/dflow-work/scripts/dflow.sh tests/skills/dflow-task-dirs.test.ts
git commit -m "feat(dflow-work): 프로젝트에서 작업 폴더를 찾는 역매핑 해석기를 더한다"
```

---

### Task 2: `/work/mine` 에 `external_ref` 싣기

**Files:**
- Modify: `src/app/api/v1/agent/work/mine/route.ts:112`
- Modify: `.claude/skills/dflow-work/references/api-contract.md:106`
- Test: `tests/agent/mine-route.test.ts`

**Interfaces:**
- Produces: `/work/mine` 응답 각 주문의 `item` 에 `external_ref: string|null`(Task 4 가 씀).

- [ ] **Step 1: 실패하는 테스트** — `tests/agent/mine-route.test.ts` 의 `useAdmin` 이 select 인자를 기록하게 바꾸고 케이스를 더한다.

`useAdmin` 안의 `for (const k of ['select', 'update', 'eq', 'in', 'limit', 'order']) b[k] = () => b` 를 다음으로 교체:

```ts
      for (const k of ['update', 'eq', 'in', 'limit', 'order']) b[k] = () => b
      b.select = (cols: string) => { (selects[table] ??= []).push(cols); return b }
```

`useAdmin` 첫 줄에 `const selects: Record<string, string[]> = {}` 를 두고, 반환 객체에 `selects` 를 싣는다(`return Object.assign(admin, { selects })`). `describe('GET /agent/work/mine'` 안에 추가:

```ts
  it('항목 컨텍스트에 external_ref 를 싣는다(task scaffold 스펙 §5)', async () => {
    const admin = useAdmin({
      agent_runners: [{ data: RUNNER }, { data: null }],
      agent_projects: [{ data: [{ project_id: P1 }] }],
      memberships: [{ data: { is_superuser: false } }],
      project_roles: [{ data: [{ role: 'member' }] }],
      agent_work_orders: [{ data: [
        { id: 'o-9', project_id: P1, status: 'ready', priority: 0, instructions: '', claimed_at: null, wbs_item_id: 'w-1', created_at: '2026-08-01T00:00:00Z' },
      ] }],
      wbs_items: [{ data: [{ id: 'w-1', code: '1.1', name: 't', planned_start: null, planned_end: null, external_ref: 'MDM/TSK-01-01' }] }],
    })
    const res = await mineGET(get('http://l/api/v1/agent/work/mine', PAT.token))
    const body = await res.json()
    expect(admin.selects.wbs_items.at(-1)).toContain('external_ref')
    expect(body.available[0].item.external_ref).toBe('MDM/TSK-01-01')
  })
```

- [ ] **Step 2: 실패 확인** — Run: `npx vitest run tests/agent/mine-route.test.ts` / Expected: 새 케이스만 FAIL(select 에 external_ref 없음).

- [ ] **Step 3: 구현** — `route.ts:112` 의 select 를 `'id, code, name, planned_start, planned_end, external_ref'` 로. `api-contract.md:106` 의 item 을 `"item": { "id": "…", "code": "…", "name": "…", "external_ref": "MDM/TSK-01-01|null" }` 로 바꾸고, 그 블록 아래에 한 줄: `item.external_ref 는 import 로 들어온 항목의 "<module>/<id>" 다(웹에서 직접 만든 항목은 null). dflow.sh scaffold 가 작업 폴더 이름(TSK)을 여기서 얻는다.`

- [ ] **Step 4: 통과 확인** — Run: `npx vitest run tests/agent` / Expected: PASS.

- [ ] **Step 5: 커밋**

```bash
git add src/app/api/v1/agent/work/mine/route.ts .claude/skills/dflow-work/references/api-contract.md tests/agent/mine-route.test.ts
git commit -m "feat(agent-api): /work/mine 항목에 external_ref 를 싣는다"
```

---

### Task 3: 주문의 작업 폴더 — `taskdir` 명령과 spec 캐시 경로

**Files:**
- Modify: `.claude/skills/dflow-work/scripts/dflow.sh:258-285`(`write_spec_cache`·`check_project`), `:288-303`(`cmd_claim`), 명령 분기·usage
- Test: `tests/skills/dflow-scaffold.test.ts`(신규 — Task 4 가 이어 쓴다)

**Interfaces:**
- Consumes: `dflow_config_docs_dir`(Task 1).
- Produces: `check_project <uuid>` 가 전역 `ORDER_DOCS_DIR` 를 채운다(해석 실패는 claim 전에 exit 2).
  `dflow.sh taskdir <ref>` → `<DOCS_DIR>/tasks/<TSK>` 한 줄(리포 최상위 기준). external_ref 가 없으면 exit 6 `NO_REF`.
  claim 은 spec 을 `<리포 최상위>/<DOCS_DIR>/tasks/<TSK>/spec.md` 에 쓰고 `spec 캐시: <DOCS_DIR>/tasks/<TSK>/spec.md` 를 출력한다.

- [ ] **Step 1: 실패하는 테스트** — `tests/skills/dflow-scaffold.test.ts`

```ts
// 작업 폴더 scaffold·taskdir·spec 캐시 경로(docs/superpowers/specs/2026-09-23-dflow-task-scaffold-design.md).
// dflow.sh 를 가짜 curl 로 실제 실행한다. 응답 본문은 env(MINE_BODY·SHOW_BODY)로 주입한다.
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const DFLOW = join(process.cwd(), '.claude/skills/dflow-work/scripts/dflow.sh')
const TOKEN = `dflow_pat_AAAAAAAAAAAA_${'x'.repeat(24)}`
const P1 = '11111111-1111-4111-8111-111111111111'
const P2 = '22222222-2222-4222-8222-222222222222'
const PX = '99999999-9999-4999-8999-000000000000'
const O1 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'
const O2 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2'
const O3 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3'

const FAKE_CURL = `#!/bin/sh
out=''; url=''
while [ $# -gt 0 ]; do
  case "$1" in -o) out="$2"; shift 2 ;; -X|-H|-w|--data) shift 2 ;; -sS) shift ;; *) url="$1"; shift ;; esac
done
case "$url" in
  *"/agent/work/mine"*) printf '%s' "$MINE_BODY" > "$out" ;;
  *"/claim") printf '%s' "$SHOW_BODY" > "$out" ;;
  *"/agent/work/"*) printf '%s' "$SHOW_BODY" > "$out" ;;
  *) printf '{}' > "$out" ;;
esac
printf 200
`
const order = (id: string, pid: string, ref: string | null) =>
  ({ id, project_id: pid, status: 'ready', priority: 0, item: { id: 'w', code: '1', name: 't', external_ref: ref } })

let tmp: string; let repo: string; let bare: string
function run(args: string[], env: Record<string, string> = {}, cwd = repo) {
  return spawnSync('sh', [DFLOW, ...args], {
    encoding: 'utf8', cwd,
    env: {
      NODE_ENV: process.env.NODE_ENV, PATH: `${join(tmp, 'bin')}:${process.env.PATH ?? ''}`,
      HOME: join(tmp, 'home'), XDG_CACHE_HOME: join(tmp, 'cache'),
      DFLOW_ENV_FILE: join(tmp, 'no-env'), DFLOW_CONFIG_DIR: join(tmp, 'no-config'),
      DFLOW_API_BASE: 'https://x.test/', DFLOW_PATS: TOKEN, DFLOW_DEV_BRANCH: 'main',
      DFLOW_PROJECT_ID: P1, DFLOW_PROJECT_MAP: `docs/mdm=${P2}`,
      GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t',
      ...env,
    } as NodeJS.ProcessEnv,
  })
}
const git = (...a: string[]) => execFileSync('git', a, { cwd: repo, encoding: 'utf8' })

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'dflow-scf-'))
  mkdirSync(join(tmp, 'bin')); mkdirSync(join(tmp, 'home'))
  writeFileSync(join(tmp, 'bin/curl'), FAKE_CURL, { mode: 0o755 })
  repo = join(tmp, 'repo'); mkdirSync(repo); bare = join(tmp, 'origin.git')
  git('init', '-q', '-b', 'main'); git('config', 'user.email', 't@t'); git('config', 'user.name', 't')
  writeFileSync(join(repo, 'f.txt'), 'x'); git('add', 'f.txt'); git('commit', '-q', '-m', 'init')
  execFileSync('git', ['init', '-q', '--bare', bare])
  git('remote', 'add', 'origin', bare); git('push', '-q', '-u', 'origin', 'main')
})
afterEach(() => rmSync(tmp, { recursive: true, force: true }))

describe('taskdir·claim spec 캐시', () => {
  const MINE = JSON.stringify({ claimed: [], assigned: [order(O2, P2, 'MDM/TSK-01-02')], available: [] })
  const SHOW = JSON.stringify({ id: O2, item: { external_ref: 'MDM/TSK-01-02', name: 't' }, depends_evidence: [] })
  it('taskdir 는 project_map 의 DOCS_DIR 아래 작업 폴더를 낸다', () => {
    const r = run(['taskdir', O2], { MINE_BODY: MINE, SHOW_BODY: SHOW })
    expect(r.status, r.stderr).toBe(0); expect(r.stdout).toBe('docs/mdm/tasks/TSK-01-02\n')
  })
  it('claim 은 spec.md 를 리포 최상위 기준 DOCS_DIR 아래에 쓴다(하위 디렉터리에서 실행해도)', () => {
    mkdirSync(join(repo, 'sub'))
    const r = run(['claim', O2], { MINE_BODY: MINE, SHOW_BODY: SHOW }, join(repo, 'sub'))
    expect(r.status, r.stderr).toBe(0)
    expect(existsSync(join(repo, 'docs/mdm/tasks/TSK-01-02/spec.md'))).toBe(true)
    expect(existsSync(join(repo, 'docs/tasks'))).toBe(false)
    expect(r.stdout).toContain('spec 캐시: docs/mdm/tasks/TSK-01-02/spec.md')
  })
  it('external_ref 가 없으면 taskdir 는 exit 6 NO_REF', () => {
    const r = run(['taskdir', O2], { MINE_BODY: MINE, SHOW_BODY: JSON.stringify({ id: O2, item: {} }) })
    expect(r.status).toBe(6); expect(r.stderr).toContain('NO_REF')
  })
})
```

- [ ] **Step 2: 실패 확인** — Run: `npx vitest run tests/skills/dflow-scaffold.test.ts` / Expected: FAIL(`taskdir` 는 usage exit 2, spec 은 `sub/docs/tasks` 에 생김).

- [ ] **Step 3: 구현** — `check_project` 의 마지막 `printf … | grep -qxF "$_p" || die …` 뒤에 한 줄:

```sh
  # 작업 폴더의 DOCS_DIR — claim 전에 정해 둔다. 해석 실패(AMBIGUOUS_DOCS_DIR)는 claim 하지 않는다.
  ORDER_DOCS_DIR=$(dflow_config_docs_dir "$_p") || exit 2
```

`write_spec_cache` 를 다음으로 교체(첫 두 줄의 경로 계산과 `mkdir`·`mv`·출력 경로만 바뀐다):

```sh
# spec.md 로컬 캐시(결정 A) — DB 정본의 명세를 claim 시점에 스냅샷. 위치는 <DOCS_DIR>/tasks/<TSK>(리포 최상위 기준).
write_spec_cache() { # $1=claim 응답 JSON. ORDER_DOCS_DIR 는 check_project 가 채운다.
  _tsk=$(printf '%s' "$1" | jq -r '.item.external_ref // empty' 2>/dev/null | awk -F/ '{print $NF}')
  [ -n "$_tsk" ] || return 0
  _top=$(git rev-parse --show-toplevel 2>/dev/null) || _top=.
  _rel="${ORDER_DOCS_DIR:-docs}/tasks/$_tsk"
  mkdir -p "$_top/$_rel"
  _spec_tmp="$_top/$_rel/spec.md.tmp"
  printf '%s' "$1" | jq -r '
    "# " + (.item.external_ref // "") + " " + (.item.name // "") + "\n" +
    "> stage: " + (.item.stage // "-") + " · category: " + (.item.category // "-") +
    " · domain: " + (.item.domain // "-") + " · priority: " + (.item.priority // "-") +
    " · model: " + (.item.model // "-") + "\n" +
    "> prd-ref: " + (.item.prd_ref // "-") + "\n> entry-point: " + (.item.entry_point // "-") + "\n" +
    "> depends: " + ((.item.depends // []) | join(", ")) + "\n\n" +
    (.item.spec // "(명세 없음)") + "\n\n## 수용 기준\n" +
    ((.item.acceptance // []) | map("- [ ] " + .) | join("\n"))
  ' > "$_spec_tmp" || { rm -f "$_spec_tmp"; die 6 "spec 파일 쓰기 실패"; }
  # 디스크·권한 문제다. 상태충돌(4)이 아니다 — 주문 상태는 멀쩡하고 고칠 곳이 로컬이다.
  mv "$_spec_tmp" "$_top/$_rel/spec.md" || die 6 "spec 파일 원자 이동 실패"
  printf 'spec 캐시: %s/spec.md\n' "$_rel"
}
```

`cmd_claim` 뒤에 추가:

```sh
# 주문의 작업 폴더(리포 최상위 기준 상대경로). 스킬 문서의 <TASKS>/<TSK> 가 이 값이다.
cmd_taskdir() {
  _id=$(resolve_ref "$1")
  check_project "$_id"
  _detail=$(TOKEN="$TOK" api_raw GET "/api/v1/agent/work/$_id") || exit $?
  _tsk=$(printf '%s' "$_detail" | jq -r '.item.external_ref // empty' 2>/dev/null | awk -F/ '{print $NF}')
  [ -n "$_tsk" ] || die 6 "NO_REF 주문 $(printf '%s' "$_id" | cut -c1-8) 에 external_ref 가 없다 — WBS import 로 만든 항목이 아니다"
  printf '%s/tasks/%s\n' "$ORDER_DOCS_DIR" "$_tsk"
}
```

main 의 명령 분기에 `taskdir) [ $# -ge 1 ] || usage; cmd_taskdir "$@" ;;`(`show)` 줄 아래), usage 의 `show <ref>` 아래에:

```
  taskdir <ref>          주문의 작업 폴더(<DOCS_DIR>/tasks/<TSK>, 리포 최상위 기준)
```

- [ ] **Step 4: 통과 확인** — Run: `npx vitest run tests/skills/dflow-scaffold.test.ts tests/skills/dflow-claim-identity.test.ts tests/skills/shell-syntax.test.ts` / Expected: PASS.

- [ ] **Step 5: 커밋**

```bash
git add .claude/skills/dflow-work/scripts/dflow.sh tests/skills/dflow-scaffold.test.ts
git commit -m "feat(dflow-work): 작업 폴더를 DOCS_DIR 아래로 — taskdir 명령과 spec 캐시 경로"
```

---

### Task 4: `dflow.sh scaffold`

**Files:**
- Modify: `.claude/skills/dflow-work/scripts/dflow.sh`(`cmd_scaffold` 신규, 분기·usage)
- Test: `tests/skills/dflow-scaffold.test.ts`(describe 추가)

**Interfaces:**
- Consumes: `dflow_config_docs_dir`, `dflow_config_branch dev`(Task 1·기존), `filter_projects`, `base`, `api_raw`, mine 의 `item.external_ref`(Task 2).
- Produces: `dflow.sh scaffold` → stdout `scaffold created=N skipped=N no_ref=N[ 안내]`, exit 0(바인딩 없음은 exit 2). Task 6 이 팀장 시작에서 부른다.

- [ ] **Step 1: 실패하는 테스트** — `dflow-scaffold.test.ts` 에 추가:

```ts
describe('scaffold', () => {
  const mine = (...o: unknown[]) => JSON.stringify({ assigned: o })
  const state = (rel: string) => JSON.parse(readFileSync(join(repo, rel, 'state.json'), 'utf8'))

  it('바인딩 안의 내 작업마다 state.json(ready)을 만들고 개발 브랜치에 커밋·push 한다', () => {
    const r = run(['scaffold'], { MINE_BODY: mine(
      order(O1, P1, 'MES/TSK-01-01'), order(O2, P2, 'MDM/TSK-01-02'), order(O3, PX, 'X/TSK-09-09')) })
    expect(r.status, r.stderr).toBe(0)
    expect(r.stdout.trim()).toBe('scaffold created=2 skipped=0 no_ref=0')
    expect(state('docs/tasks/TSK-01-01')).toEqual({ tsk: 'TSK-01-01', order: O1, api_base: 'https://x.test', phase: 'ready' })
    expect(state('docs/mdm/tasks/TSK-01-02').order).toBe(O2)
    expect(existsSync(join(repo, 'docs/tasks/TSK-09-09'))).toBe(false)   // 바인딩 밖(PX)
    expect(git('show', '--name-only', '--format=%s', 'HEAD').trim().split('\n'))
      .toEqual(['chore(dflow): 담당 작업 폴더 2건 생성', '', 'docs/mdm/tasks/TSK-01-02/state.json', 'docs/tasks/TSK-01-01/state.json'])
    expect(execFileSync('git', ['--git-dir', bare, 'rev-parse', 'main'], { encoding: 'utf8' })).toBe(git('rev-parse', 'HEAD'))
  })
  it('이미 있는 폴더는 건드리지 않고 skipped 로 센다', () => {
    mkdirSync(join(repo, 'docs/tasks/TSK-01-01'), { recursive: true })
    writeFileSync(join(repo, 'docs/tasks/TSK-01-01/design.md'), 'keep')
    const r = run(['scaffold'], { MINE_BODY: mine(order(O1, P1, 'MES/TSK-01-01')) })
    expect(r.stdout.trim()).toBe('scaffold created=0 skipped=1 no_ref=0')
    expect(existsSync(join(repo, 'docs/tasks/TSK-01-01/state.json'))).toBe(false)
    expect(git('log', '--oneline').trim().split('\n')).toHaveLength(1)   // 새 파일 0건 → 커밋 없음
  })
  it('external_ref 가 전부 없으면 no_ref 로 세고 서버 업데이트를 안내한다', () => {
    const r = run(['scaffold'], { MINE_BODY: mine(order(O1, P1, null)) })
    expect(r.stdout).toContain('scaffold created=0 skipped=0 no_ref=1')
    expect(r.stdout).toContain('D\'Flow 업데이트 필요')
  })
  it('같은 TSK 의 주문이 둘이면 폴더 하나, 첫 주문만 기록한다', () => {
    const r = run(['scaffold'], { MINE_BODY: mine(order(O1, P1, 'MES/TSK-01-01'), order(O3, P1, 'MES/TSK-01-01')) })
    expect(r.stdout.trim()).toBe('scaffold created=1 skipped=1 no_ref=0')
    expect(state('docs/tasks/TSK-01-01').order).toBe(O1)
  })
  it('개발 브랜치가 아니면 파일만 만들고 커밋하지 않는다', () => {
    git('checkout', '-q', '-b', 'topic')
    const r = run(['scaffold'], { MINE_BODY: mine(order(O1, P1, 'MES/TSK-01-01')) })
    expect(r.stdout).toContain('커밋하지 않음')
    expect(existsSync(join(repo, 'docs/tasks/TSK-01-01/state.json'))).toBe(true)
    expect(git('log', '--oneline').trim().split('\n')).toHaveLength(1)
  })
  it('사람이 stage 해 둔 다른 파일은 scaffold 커밋에 넣지 않는다', () => {
    writeFileSync(join(repo, 'other.txt'), 'y'); git('add', 'other.txt')
    run(['scaffold'], { MINE_BODY: mine(order(O1, P1, 'MES/TSK-01-01')) })
    expect(git('show', '--name-only', '--format=', 'HEAD').trim()).toBe('docs/tasks/TSK-01-01/state.json')
    expect(git('diff', '--cached', '--name-only').trim()).toBe('other.txt')
  })
  it('하위 디렉터리에서 실행해도 리포 최상위 기준으로 만든다', () => {
    mkdirSync(join(repo, 'sub'))
    run(['scaffold'], { MINE_BODY: mine(order(O1, P1, 'MES/TSK-01-01')) }, join(repo, 'sub'))
    expect(existsSync(join(repo, 'docs/tasks/TSK-01-01/state.json'))).toBe(true)
  })
  it('push 가 실패해도 exit 0, 로컬 커밋을 남기고 알린다', () => {
    git('remote', 'set-url', 'origin', join(tmp, 'gone.git'))
    const r = run(['scaffold'], { MINE_BODY: mine(order(O1, P1, 'MES/TSK-01-01')) })
    expect(r.status).toBe(0); expect(r.stdout).toContain('push 실패')
    expect(git('log', '--oneline').trim().split('\n')).toHaveLength(2)
  })
  it('목록이 100건이면 잘림을 경고한다', () => {
    const many = Array.from({ length: 100 }, (_, i) =>
      order(`aaaaaaaa-aaaa-4aaa-8aaa-${String(i).padStart(12, '0')}`, P1, `MES/TSK-${i}`))
    const r = run(['scaffold'], { MINE_BODY: mine(...many), DFLOW_DEV_BRANCH: 'nope' })
    expect(r.stderr).toContain('100건에서 잘렸을 수 있습니다')
  })
  it('바인딩이 없으면 exit 2 PROJECT_MISMATCH', () => {
    const r = run(['scaffold'], { MINE_BODY: mine(), DFLOW_PROJECT_ID: '', DFLOW_PROJECT_MAP: '' })
    expect(r.status).toBe(2); expect(r.stderr).toContain('PROJECT_MISMATCH')
  })
})
```

- [ ] **Step 2: 실패 확인** — Run: `npx vitest run tests/skills/dflow-scaffold.test.ts` / Expected: scaffold describe 전부 FAIL(usage exit 2).

- [ ] **Step 3: 구현** — `cmd_taskdir` 아래에 추가:

```sh
# 내게 배정된 작업의 폴더와 state.json(phase=ready)을 미리 만든다(스펙 2026-09-23-dflow-task-scaffold §4).
# 대상은 assigned ∩ 바인딩뿐 — 남의 작업 폴더를 만들면 사람 사이 커밋이 충돌한다. 있는 폴더는 건드리지 않는다.
cmd_scaffold() {
  [ -n "$ALLOWED_PROJECTS" ] || die 2 "PROJECT_MISMATCH 프로젝트 바인딩 없음 — .dflow 의 project_id 또는 .dflow.local 의 project_map 을 넣으세요."
  _top=$(git rev-parse --show-toplevel 2>/dev/null) || die 2 "NOT_REPO git 리포 안에서 실행하세요."
  _body=$(TOKEN="$TOK" api_raw GET "/api/v1/agent/work/mine?scope=assigned&limit=100") || exit $?
  _rows=$(printf '%s' "$_body" | jq -c '[.assigned[]?]' | filter_projects '') || die 6 "목록 해석 실패"
  _total=$(printf '%s' "$_body" | jq '[.assigned[]?] | length')
  [ "$_total" -lt 100 ] || printf '⚠ 목록이 100건에서 잘렸을 수 있습니다 — 남은 작업은 다음 scaffold 에서 만듭니다.\n' >&2
  _kept=$(printf '%s' "$_rows" | jq 'length')
  _api=$(base) || exit $?
  _list=$(printf '%s' "$_rows" | jq -r '.[] | [.id, .project_id, (((.item.external_ref // "") | split("/") | last) // "")] | @tsv') \
    || die 6 "목록 해석 실패"
  _created=0; _skipped=0; _noref=0; _new=''
  # here-doc 으로 받는다 — 파이프 while 은 서브셸이라 카운터가 부모에 남지 않는다.
  while IFS="$(printf '\t')" read -r _oid _pid _tsk; do
    [ -n "$_oid" ] || continue
    [ -n "$_tsk" ] || { _noref=$((_noref + 1)); continue; }
    _dd=$(dflow_config_docs_dir "$_pid" 2>/dev/null) || { _skipped=$((_skipped + 1)); continue; }
    _rel="$_dd/tasks/$_tsk"
    [ ! -e "$_top/$_rel" ] || { _skipped=$((_skipped + 1)); continue; }
    mkdir -p "$_top/$_rel" || die 6 "폴더 생성 실패: $_rel"
    jq -n --arg t "$_tsk" --arg o "$_oid" --arg a "$_api" '{tsk:$t, order:$o, api_base:$a, phase:"ready"}' \
      > "$_top/$_rel/state.json.tmp" && mv "$_top/$_rel/state.json.tmp" "$_top/$_rel/state.json" \
      || die 6 "state.json 쓰기 실패: $_rel"
    _created=$((_created + 1)); _new="$_new$_rel/state.json
"
  done <<EOF
$_list
EOF
  _note=''
  if [ "$_created" -gt 0 ]; then
    _dev=$(dflow_config_branch dev 2>/dev/null) || _dev=''
    if [ -z "$_dev" ] || [ "$(git -C "$_top" branch --show-current)" != "$_dev" ]; then
      _note=' (개발 브랜치가 아니라 커밋하지 않음)'
    else
      set --
      while IFS= read -r _f; do [ -n "$_f" ] && set -- "$@" "$_f"; done <<EOF
$_new
EOF
      # 경로를 명시한 commit(--only) — 사람이 stage 해 둔 다른 파일을 싣지 않는다.
      git -C "$_top" add -- "$@" && git -C "$_top" commit -q -m "chore(dflow): 담당 작업 폴더 ${_created}건 생성" -- "$@" \
        || die 6 "scaffold 커밋 실패"
      git -C "$_top" push -q origin "HEAD:$_dev" 2>/dev/null || _note=' (push 실패 — 로컬 커밋만 남김)'
    fi
  fi
  [ "$_noref" -eq 0 ] || [ "$_noref" -ne "$_kept" ] \
    || _note="$_note (서버에 external_ref 응답이 없습니다 — D'Flow 업데이트 필요)"
  printf 'scaffold created=%d skipped=%d no_ref=%d%s\n' "$_created" "$_skipped" "$_noref" "$_note"
}
```

분기에 `scaffold) cmd_scaffold "$@" ;;`(`release)` 줄 아래), usage 의 `release <ref>` 아래에:

```
  scaffold               내게 배정된 작업(바인딩 안)의 <DOCS_DIR>/tasks/<TSK>/state.json(phase=ready)을 만들고
                         개발 브랜치에 있으면 커밋·push. 있는 폴더는 건드리지 않는다
```

- [ ] **Step 4: 통과 확인** — Run: `npx vitest run tests/skills` / Expected: PASS(기존 포함).

- [ ] **Step 5: 커밋**

```bash
git add .claude/skills/dflow-work/scripts/dflow.sh tests/skills/dflow-scaffold.test.ts
git commit -m "feat(dflow-work): 내 담당 작업 폴더를 미리 만드는 scaffold 명령"
```

---

### Task 5: poll 승인 감지가 모든 작업 폴더를 본다

**Files:**
- Modify: `.claude/skills/dflow-poll/scripts/poll.sh:77`, `:110-111`
- Test: `tests/skills/dflow-task-dirs.test.ts`(정적 검사 추가)

**Interfaces:**
- Consumes: `dflow_config_tasks_dirs`(Task 1). poll.sh 는 이미 `dflow-config.sh` 를 source 하고 `dflow_config_load` 를 부른다.

- [ ] **Step 1: 실패하는 테스트** — `dflow-task-dirs.test.ts` 끝에:

```ts
import { readFileSync } from 'node:fs'
describe('poll.sh 승인 감지 대상', () => {
  const POLL = readFileSync(join(process.cwd(), '.claude/skills/dflow-poll/scripts/poll.sh'), 'utf8')
  it('고정 경로 docs/tasks 대신 dflow_config_tasks_dirs 를 훑는다', () => {
    expect(POLL).not.toContain('$PWD/docs/tasks')
    expect(POLL).toContain('dflow_config_tasks_dirs')
  })
})
```

- [ ] **Step 2: 실패 확인** — Run: `npx vitest run tests/skills/dflow-task-dirs.test.ts` / Expected: FAIL.

- [ ] **Step 3: 구현** — 77행을 삭제하고, `dflow_config_load || exit 2` 바인딩 검사 블록 뒤에:

```sh
# dflow-dev state.json 위치 — 승인 감지 재료. 바인딩된 <DOCS_DIR>/tasks 전부(리포 최상위 기준).
STATE_TOP=$(git rev-parse --show-toplevel 2>/dev/null) || STATE_TOP=$PWD
STATE_FILES() { dflow_config_tasks_dirs | while IFS= read -r _d; do
  [ -d "$STATE_TOP/$_d" ] && find "$STATE_TOP/$_d" -mindepth 2 -maxdepth 2 -name state.json 2>/dev/null; done; }
```

110~111행의 `if [ -d "$STATE_GLOB" ]; then` / `for _sf in "$STATE_GLOB"/*/state.json; do` 를 다음으로 바꾸고 짝이 되는 `done`·`fi` 를 `done <<EOF` / `$(STATE_FILES)` / `EOF` 로 바꾼다(`fi` 는 삭제). 루프 본문은 그대로 둔다.

```sh
  while IFS= read -r _sf; do
```

- [ ] **Step 4: 통과 확인** — Run: `npx vitest run tests/skills` / Expected: PASS(`shell-syntax` 가 poll.sh 문법을 본다).

- [ ] **Step 5: 커밋**

```bash
git add .claude/skills/dflow-poll/scripts/poll.sh tests/skills/dflow-task-dirs.test.ts
git commit -m "feat(dflow-poll): 승인 감지가 바인딩된 모든 작업 폴더를 본다"
```

---

### Task 6: 스킬 문서 — 작업 폴더 정의·ready 예외·팀장 scaffold

**Files:**
- Modify: `.claude/skills/dflow-dev/SKILL.md`(31·41·70-71·89·235·316행 부근), `dflow-dev/references/dev-discipline.md:60,72`
- Modify: `.claude/skills/dflow-merge/SKILL.md`(27·30·37·64·73-74·133·154·162·200·223행)
- Modify: `.claude/skills/dflow-team/SKILL.md`(235·248·271·440·446·613·623·713·772·781·957·967·1075·1195행, 「1. 시작」 2번 뒤)
- Modify: `.claude/skills/dflow-team/references/{worker-prompt.md,backends.md,events.md}`
- Modify: `.claude/skills/dflow-work/{SKILL.md:98,README.md:101,references/troubleshooting.md:149,references/api-contract.md:163}`
- Test: `tests/skills/dflow-task-dirs.test.ts`(문서 검사 추가)

**Interfaces:**
- Consumes: `dflow.sh taskdir <ref>`·`config tasks-dirs`·`scaffold`(Task 1·3·4).

**공통 정의 문단** — dflow-dev·dflow-merge·dflow-team SKILL.md 의 `<기본브랜치>` 정의 문단 바로 아래에 그대로 넣는다:

```markdown
작업 폴더 `<TASKS>` 는 `<DOCS_DIR>/tasks` 다(리포 최상위 기준). 한 주문의 폴더 `<TASKS>/<TSK>` 는
`dflow.sh taskdir <ref>` 의 값이다 — `.dflow.local` 의 `project_map` 에서 그 주문의 프로젝트 키를, 없으면 `docs` 를 쓴다.
여러 작업을 훑을 때는 `dflow.sh config tasks-dirs` 가 내는 폴더 전부를 본다. 고정 경로 `docs/tasks` 를 쓰지 않는다.
```

- [ ] **Step 1: 실패하는 테스트** — `dflow-task-dirs.test.ts` 끝에:

```ts
describe('스킬 문서의 작업 폴더', () => {
  const read = (p: string) => readFileSync(join(process.cwd(), '.claude/skills', p), 'utf8')
  const FILES = ['dflow-dev/SKILL.md', 'dflow-dev/references/dev-discipline.md', 'dflow-merge/SKILL.md',
    'dflow-team/SKILL.md', 'dflow-team/references/worker-prompt.md', 'dflow-team/references/backends.md',
    'dflow-team/references/events.md', 'dflow-work/SKILL.md', 'dflow-work/README.md',
    'dflow-work/references/troubleshooting.md', 'dflow-work/references/api-contract.md']
  it('고정 경로 docs/tasks 가 남아 있지 않다', () => {
    for (const f of FILES) expect(read(f), f).not.toMatch(/docs\/tasks/)
  })
  it('dflow-dev·dflow-merge·dflow-team 이 <TASKS> 를 정의한다', () => {
    for (const f of ['dflow-dev/SKILL.md', 'dflow-merge/SKILL.md', 'dflow-team/SKILL.md'])
      expect(read(f), f).toContain('작업 폴더 `<TASKS>` 는 `<DOCS_DIR>/tasks` 다')
  })
  it('dflow-dev 가 ready 단일 파일을 격리 예외로 둔다', () => {
    const t = read('dflow-dev/SKILL.md')
    expect(t).toContain('`state.json` 하나만 있고 `phase=ready`')
    expect(t).toMatch(/`phase` 값: `ready`·`design`/)
  })
  it('팀장이 시작할 때 scaffold 를 부른다', () => {
    expect(read('dflow-team/SKILL.md')).toContain('dflow.sh scaffold')
  })
  it('팀장 exclude 패턴과 backends 필터가 DOCS_DIR 을 덮는다', () => {
    expect(read('dflow-team/SKILL.md')).toContain("'**/tasks/*/.result' '**/tasks/*/.issues'")
    expect(read('dflow-team/references/backends.md')).not.toContain('docs/tasks/<TSK>/(spec')
  })
})
```

- [ ] **Step 2: 실패 확인** — Run: `npx vitest run tests/skills/dflow-task-dirs.test.ts` / Expected: 문서 describe FAIL.

- [ ] **Step 3: dflow-dev 수정**
  - 공통 정의 문단을 「Phase 01 — Claim·브랜치·기준선」 의 `<기본브랜치>` 정의 아래에 넣는다.
  - 본문의 `docs/tasks/<TSK>/…` 를 전부 `<TASKS>/<TSK>/…` 로, `docs/tasks/*/state.json` 을 "`dflow.sh config tasks-dirs` 의 각 폴더 아래 `*/state.json`" 으로 바꾼다. 316행의 `git show origin/<기본브랜치>:docs/tasks/<선행TSK>/state.json` 은 `git show origin/<기본브랜치>:<선행의 dflow.sh taskdir 값>/state.json` 으로.
  - 상태 모델의 `phase` 값 줄을 ``  `phase` 값: `ready`·`design`·`build`·`verify`·`refactor`·`reported`·**`rejected`**·`merged`. `` 로 바꾸고 바로 뒤에 한 문장: `` `ready` 는 `dflow.sh scaffold` 가 만든 초기값이다(주문 전 폴더 자리). 진행 중 phase 가 아니므로 스윕·재개 판정은 건너뛴다. ``
  - 「재claim 시 이전 시도의 잔재 격리」 항목 끝에 추가:

```markdown
  **scaffold 가 만든 폴더도 예외다.** 폴더 안에 `state.json` 하나만 있고 `phase=ready` 이면 잔재가 아니다. 옮기지 않고
  `order`·`api_base` 를 이번 claim 값으로 덮어쓴 뒤 진행한다(담당이 바뀌어 남이 만든 ready 파일도 같다). 파일이 더 있거나
  `phase` 가 `ready` 가 아니면 종전대로 격리한다. 이유: 팀장이 시작할 때 담당 작업 폴더를 미리 만들므로
  (`dflow.sh scaffold`), 이 예외가 없으면 모든 신규 claim 이 방금 만든 폴더를 `.prev-` 로 밀어낸다.
```

  - dev-discipline.md 60·72행의 `docs/tasks/<TSK>/` 를 `<TASKS>/<TSK>/` 로 바꾸고, 처음 나오는 곳에 `(\`<TASKS>/<TSK>\` = \`dflow.sh taskdir <ref>\`)` 를 붙인다.

- [ ] **Step 4: dflow-merge 수정**
  - 공통 정의 문단을 `<기본브랜치>` 정의 아래에 넣는다.
  - 1번 후보 식별의 원격 스캔 pathspec `-- 'docs/tasks/*/state.json'` 을 `-- '*/tasks/*/state.json'` 로(37·133행 포함). 로컬 스캔 블록(64행)을 다음으로 바꾼다:

```bash
     .claude/skills/dflow-work/scripts/dflow.sh config tasks-dirs | while IFS= read -r d; do
       find "$d" -mindepth 2 -maxdepth 2 -name state.json 2>/dev/null
     done | while IFS= read -r f; do
       jq -r --arg f "$f" --arg api "$api" 'select(.phase == "reported" or (.phase == "merged" and .unapproved == true))
         | [$f, .tsk, .order, .phase, (if (.api_base // "") == "" then "none" elif .api_base == $api then "same" else "other" end)] | @tsv' "$f"
     done
```

  - 73-74행 설명의 `docs/tasks/*/state.json`·`docs/tasks` 를 `<TASKS>/*/state.json`·`<TASKS>` 로. 154·162·200·223행의 `docs/tasks/<TSK>/state.json` 을 `<TASKS>/<TSK>/state.json` 으로(154행 명령은 `git add "$(dflow.sh taskdir <order>)/state.json"`).

- [ ] **Step 5: dflow-team·references 수정**
  - 공통 정의 문단을 「1. 시작」 의 `<기본브랜치>` 정의 아래에 넣는다.
  - 440행 `LEGACY_REPORTED` 의 `find docs/tasks …` 를 `.claude/skills/dflow-work/scripts/dflow.sh config tasks-dirs | while IFS= read -r d; do find "$d" -mindepth 2 -maxdepth 2 -name state.json 2>/dev/null; done | while IFS= read -r f; do` 로(뒤 본문 동일).
  - 446행 exclude 목록의 `'docs/tasks/*/.result' 'docs/tasks/*/.issues'` 를 `'**/tasks/*/.result' '**/tasks/*/.issues'` 로.
  - 「1. 시작」 전제 검사(1번) 통과 뒤 번호 항목으로 추가:

```markdown
2. **담당 작업 폴더 scaffold**: 팀장 체크아웃에서 `.claude/skills/dflow-work/scripts/dflow.sh scaffold` 를 한 번 부르고
   출력 한 줄(`scaffold created=N skipped=N no_ref=N`)을 시작 보고에 싣는다. 실패(exit≠0)는 경고만 하고 계속한다 —
   편의 기능이지 게이트가 아니다. 이유: 내게 배정된 작업의 `<TASKS>/<TSK>/state.json`(phase=ready)이 개발 브랜치에
   있으면 사람이 리포만 보고 할 일을 알고, 팀원 워크트리(`origin/<기본브랜치>` 기점)에도 같은 폴더가 보인다.
```

    뒤 항목 번호는 하나씩 민다.
  - 나머지 행(235·248·271·613·623·713·772·781·957·967·1075·1195)의 `docs/tasks/<TSK>/…`·`docs/tasks/*/…` 를 `<TASKS>/<TSK>/…`·`<TASKS>/*/…` 로. 713행 "`docs/tasks/` 가 없는 빈 디렉터리" 는 "작업 폴더가 없는 빈 디렉터리" 로.
  - worker-prompt.md: 팀장이 넘기는 값 목록에 `TASK_DIR`(= 팀장이 `dflow.sh taskdir <ref>` 로 구한 값)을 더하고, 본문의 `docs/tasks/{TSK}` 를 `{TASK_DIR}` 로. 워커는 다시 해석하지 않는다(DEV_BRANCH 와 같은 이유).
  - backends.md 222·310행의 `docs/tasks/<TSK>/…` 를 `<TASK_DIR>/…` 로. 318행 grep 의 `docs/tasks/<TSK>/(spec\.md|\.result|\.issues)` 를 `<TASK_DIR>/(spec\.md|\.result|\.issues)` 로.
  - events.md 36행의 `<worktree>/docs/tasks/<tsk>/.result` 를 `<worktree>/<TASK_DIR>/.result` 로.

- [ ] **Step 6: dflow-work 문서 수정** — SKILL.md 98·README.md 101·troubleshooting.md 149·api-contract.md 163 의 `docs/tasks/<TSK-ID>/spec.md` 를 `<DOCS_DIR>/tasks/<TSK-ID>/spec.md` 로 바꾸고, 처음 나오는 곳에 `(DOCS_DIR = project_map 의 그 프로젝트 키, 없으면 docs — \`dflow.sh taskdir <ref>\`)` 를 붙인다. SKILL.md 의 명령 목록에 `taskdir`·`scaffold` 한 줄씩(usage 문구 그대로).

- [ ] **Step 7: 통과 확인** — Run: `npx vitest run tests/skills` 와 `grep -rn "docs/tasks" .claude/skills --include='*.md' --include='*.sh' | grep -v "dflow-export\|dflow-wbs"` / Expected: 테스트 PASS, grep 출력 없음.

- [ ] **Step 8: 커밋**

```bash
git add .claude/skills/dflow-dev .claude/skills/dflow-merge/SKILL.md .claude/skills/dflow-team .claude/skills/dflow-work/SKILL.md .claude/skills/dflow-work/README.md .claude/skills/dflow-work/references/troubleshooting.md .claude/skills/dflow-work/references/api-contract.md tests/skills/dflow-task-dirs.test.ts
git commit -m "docs(dflow): 작업 폴더를 DOCS_DIR 아래로 통일하고 팀장이 scaffold 를 부른다"
```

---

### Task 7: 전체 회귀와 staging 반영

- [ ] **Step 1:** Run: `npm test` / Expected: 전체 PASS. 실패가 있으면 이 브랜치 변경 때문인지 staging 기점에서 같은 테스트를 돌려 가른다.
- [ ] **Step 2:** Run: `npx tsc --noEmit` / Expected: 오류 0.
- [ ] **Step 3:** `docs/idea.md` 의 「WBS 넣을때 tasks의 폴더를 미리 다 생성하자…」 항목을 구현 완료 절로 옮기고(`b009255c` 관례) 스펙 링크를 단다. 커밋: `docs(idea): 작업 폴더 scaffold 를 구현 완료로 옮긴다`.
- [ ] **Step 4:** staging 으로 머지는 사용자 승인 후에 한다. push 는 사용자가 지시할 때만 한다.
