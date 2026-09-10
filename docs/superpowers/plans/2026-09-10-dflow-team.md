# /dflow-team 팀장 스킬 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** D'Flow 의 내 배정 작업(태그 `agent`)을 상시 감시해 슬롯 N개의 워크트리 팀원에게 자동 분배하고, 완료 시 다음 작업을 보충하는 팀장 스킬 `/dflow-team` 을 만든다.

**Architecture:** 팀장은 현재 세션이며 `poll.sh` 를 백그라운드로 돌려 exit code 로 분기한다. 팀원은 Agent 도구(`isolation: worktree`)로 작업 1건당 1회 spawn 되어 `/dflow-dev <id8>` 를 실행하고 `RESULT` 한 줄로 끝난다. 기존 dflow-* 스킬은 손대지 않고, `/dflow-dev` 와의 차이(승인 스윕·직접 머지 금지)는 팀원 프롬프트의 워커 규칙으로 흡수한다. 승인 스윕은 팀장이 원격 `agent/*` 브랜치 기준으로 단독 수행한다.

**Tech Stack:** Markdown 스킬(Claude Code `.claude/skills`), 기존 셸 스크립트 재사용(`poll.sh`·`dflow.sh`), vitest(스킬 문서 계약 테스트), git worktree.

**Spec:** `docs/superpowers/specs/2026-09-10-dflow-team-design.md`

## Global Constraints

- 기존 스킬 `dflow-dev`·`dflow-poll`·`dflow-merge`·`dflow-work` 의 파일은 **한 줄도 수정하지 않는다**(스펙 §2).
- 정본 위치는 `.claude/skills/dflow-team/` 이며 파일은 `SKILL.md`, `references/worker-prompt.md`, `references/events.md` 셋뿐이다. 새 스크립트를 만들지 않는다(스펙 §10).
- 팀원 프롬프트 치환 변수는 정확히 `{TSK}` `{ID8}` `{AGENT_ID}` `{MAIN_CHECKOUT}` `{MODEL_FLAG}` `{BASE_BRANCH}` `{ANSWERS}` 7개다(스펙 §5).
- 팀원 완료 줄 형식: `RESULT {TSK} {ID8} <branch|-> <head_sha|-> <done_exit|-> <status> <한 줄 사유 또는 질문>`, status ∈ `done` `skipped` `needs-merge` `blocked` `failed`(스펙 §5).
- 팀원 식별자 `AGENT_ID` 형식은 `<hostname>/w<slot>`, 팀장은 `<hostname>/lead`(스펙 §9-1).
- 이벤트 로그는 `~/.dflow/events.jsonl`, 스키마 `{ts, host, repo, tsk, order, phase, event, agent}` + 이벤트별 추가 필드(스펙 §9-3).
- 참조는 id8 만 쓴다. 순번 금지. 팀원은 `dflow.sh list` 를 부르지 않는다(스펙 §3-7).
- 작업 1건 = 팀원 spawn 1회. 팀원을 SendMessage 로 재개하지 않는다(스펙 §3-2).
- 커밋 메시지는 한국어, "무엇"보다 "왜". `git add -A` 금지, 파일명 명시(프로젝트 CLAUDE.md).
- 이 워크트리 세션에서는 rtk 훅이 감싼 git 을 격리 가드가 거부한다. git 명령은 `/usr/bin/git` 로, 한 호출에 한 명령씩 실행한다.

---

## 파일 구조

| 파일 | 책임 |
|---|---|
| `tests/skills/dflow-team.test.ts` (신규) | 스킬 문서 셋과 배포 목록의 계약을 고정하는 vitest. 치환 변수·RESULT 형식·이벤트 이름·exit code·킷 목록 |
| `.claude/skills/dflow-team/references/worker-prompt.md` (신규) | 팀원 프롬프트 정본. 격리 확인·부트스트랩·좌석 식별·워커 규칙·판단 규칙·RESULT |
| `.claude/skills/dflow-team/references/events.md` (신규) | events.jsonl 이벤트 이름·필드 표 |
| `.claude/skills/dflow-team/SKILL.md` (신규) | 팀장 절차. 시작·이벤트 루프·spawn·승인 스윕·실패/질문·마감·이벤트 기록·안전 규칙 |
| `scripts/kit-build.sh` (수정, 12행) | 킷 배포 목록에 `dflow-team` 추가 |
| `kit/install.sh` (수정, 48행) | 설치 완료 안내 문구에 `dflow-team` 추가 |
| `docs/agent/claude-skill/dflow-skills-guide.md` (수정, 끝에 절 추가) | 대화 예시 안내 |
| `docs/superpowers/specs/2026-09-10-dflow-team-design.md` (수정, §11 아래) | 리허설 기록 |

---

### Task 1: 계약 테스트 스캐폴드

**Files:**
- Create: `tests/skills/dflow-team.test.ts`

**Interfaces:**
- Consumes: `vitest.config.ts` 의 `include: ['tests/**/*.test.{ts,tsx}']`(이미 있음), `.claude/skills/dflow-poll/scripts/poll.sh` 머리말 주석(exit code 목록), `scripts/kit-build.sh` 의 `SKILLS="..."` 줄.
- Produces: 이후 Task 2~5 가 통과시켜야 하는 테스트 6건. 테스트가 요구하는 문자열은 각 Task 의 파일 내용에 그대로 들어 있다.

- [ ] **Step 1: 테스트 파일 작성**

```ts
// tests/skills/dflow-team.test.ts
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(__dirname, '..', '..');
const SKILL_DIR = join(ROOT, '.claude', 'skills', 'dflow-team');
const read = (rel: string) => readFileSync(join(SKILL_DIR, rel), 'utf8');

const PLACEHOLDERS = [
  '{TSK}',
  '{ID8}',
  '{AGENT_ID}',
  '{MAIN_CHECKOUT}',
  '{MODEL_FLAG}',
  '{BASE_BRANCH}',
  '{ANSWERS}',
];
const STATUSES = ['done', 'skipped', 'needs-merge', 'blocked', 'failed'];

describe('dflow-team 스킬 계약', () => {
  it('파일 셋이 정본 위치에 있다', () => {
    for (const rel of ['SKILL.md', 'references/worker-prompt.md', 'references/events.md']) {
      expect(existsSync(join(SKILL_DIR, rel)), rel).toBe(true);
    }
  });

  it('SKILL.md 프론트매터에 name·트리거·사용법이 있다', () => {
    const fm = read('SKILL.md').match(/^---\n([\s\S]*?)\n---/)?.[1] ?? '';
    expect(fm).toMatch(/^name: dflow-team$/m);
    expect(fm).toContain('"/dflow-team"');
    expect(fm).toContain('사용법 - /dflow-team [--team-size N] --until HH:MM');
  });

  it('worker-prompt.md 는 치환 변수 7개·격리 확인·RESULT 형식·status 5종을 담는다', () => {
    const p = read('references/worker-prompt.md');
    for (const v of PLACEHOLDERS) expect(p, v).toContain(v);
    expect(p).toContain('*/.claude/worktrees/*');
    expect(p).toContain('NOT_ISOLATED');
    expect(p).toMatch(/^RESULT \{TSK\} \{ID8\} <branch\|-> <head_sha\|-> <done_exit\|-> <status> /m);
    for (const s of STATUSES) expect(p, s).toContain('`' + s + '`');
  });

  it('worker-prompt.md 의 워커 규칙은 dflow-dev 의 머지 세 곳을 대체하고 main 을 체크아웃하지 않는다', () => {
    const p = read('references/worker-prompt.md');
    expect(p).toContain('Phase 0-가');
    expect(p).toContain('branch_base');
    expect(p).toContain('needs-merge');
    expect(p).toContain('.agent');
    expect(p).not.toMatch(/git switch (main|<기본브랜치>|\{BASE_BRANCH\})/);
  });

  it('SKILL.md 가 쓰는 team.* 이벤트는 events.md 에 전부 정의돼 있다', () => {
    const used = new Set(read('SKILL.md').match(/team\.[a-z]+/g) ?? []);
    const events = read('references/events.md');
    expect(used.size).toBeGreaterThanOrEqual(7);
    for (const e of used) expect(events, e).toContain('`' + e + '`');
  });

  it('SKILL.md 가 분기하는 poll exit code 는 poll.sh 머리말이 문서화한 것뿐이다', () => {
    const header = readFileSync(join(ROOT, '.claude/skills/dflow-poll/scripts/poll.sh'), 'utf8')
      .split('\n')
      .slice(0, 12)
      .join(' ');
    const documented = new Set(header.match(/\b\d{1,2}\b/g) ?? []);
    const used = [...read('SKILL.md').matchAll(/poll exit (\d{1,2})/g)].map((m) => m[1]);
    expect(used.length).toBeGreaterThan(0);
    for (const c of used) expect(documented.has(c), `exit ${c}`).toBe(true);
  });

  it('kit-build.sh 배포 목록에 dflow-team 이 있다', () => {
    const kit = readFileSync(join(ROOT, 'scripts/kit-build.sh'), 'utf8');
    expect(kit).toMatch(/^SKILLS=".*\bdflow-team\b.*"$/m);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run tests/skills/dflow-team.test.ts`
Expected: FAIL — 7건 중 `kit-build.sh` 건을 포함해 전부 실패. 파일 부재 건은 `ENOENT` 또는 `toBe(true)` 실패.

- [ ] **Step 3: 커밋**

```bash
/usr/bin/git add tests/skills/dflow-team.test.ts
/usr/bin/git commit -m "test(skills): dflow-team 스킬 문서 계약 테스트 — 치환 변수·RESULT·이벤트·exit code 드리프트 방지"
```

---

### Task 2: 팀원 프롬프트 정본 `references/worker-prompt.md`

**Files:**
- Create: `.claude/skills/dflow-team/references/worker-prompt.md`
- Test: `tests/skills/dflow-team.test.ts`

**Interfaces:**
- Consumes: `/dflow-dev <id8> [--model X]`(기존 스킬, 무수정), `dflow.sh show/doctor`, `.claude/worktrees/` 경로 규칙(하네스).
- Produces: Task 4 의 SKILL.md 가 읽어 치환하는 템플릿. 치환 변수 7개, `.agent` 사이드카 규칙, `RESULT` 줄.

- [ ] **Step 1: 파일 작성**

```markdown
# 팀원 프롬프트 (dflow-team 정본 — 팀장이 치환해 Agent 도구 prompt 로 넘긴다)

치환 변수: `{TSK}` `{ID8}` `{AGENT_ID}` `{MAIN_CHECKOUT}` `{MODEL_FLAG}` `{BASE_BRANCH}` `{ANSWERS}`

---

당신은 D'Flow 작업 **{TSK}** (주문 id8 `{ID8}`) 을 맡은 팀원이다. 팀장이 이 작업 하나만 위임했다.
아래 순서를 지키고, 끝날 때 마지막 줄을 반드시 `RESULT` 형식으로 끝낸다.

## 0. 격리 확인 (첫 행동)

```bash
case "$(git rev-parse --show-toplevel)" in */.claude/worktrees/*) echo ISOLATED ;; *) echo NOT_ISOLATED ;; esac
```
`NOT_ISOLATED` 면 **아무것도 하지 말고** 아래 한 줄로 끝낸다:
`RESULT {TSK} {ID8} - - - failed not-isolated`

## 1. 워크트리 부트스트랩

```bash
[ -e .env ] || ln -s {MAIN_CHECKOUT}/.env .env
[ -e .claude/skills/dflow-dev ] || { mkdir -p .claude && ln -s {MAIN_CHECKOUT}/.claude/skills .claude/skills; }
set -a; . ./.env; set +a; .claude/skills/dflow-work/scripts/dflow.sh doctor
```
env 는 Bash 호출 사이에 남지 않는다. dflow.sh 를 부를 때마다 `set -a; . ./.env; set +a;` 를 앞에 붙인다.
doctor 가 실패하면 `RESULT {TSK} {ID8} - - - failed doctor-exit-<code>` 로 끝낸다.

## 2. 좌석 식별 (claim 전)

```bash
mkdir -p docs/tasks/{TSK} && printf '%s\n' '{AGENT_ID}' > docs/tasks/{TSK}/.agent
```
`.agent` 는 커밋하지 않는다(좌석표 heartbeat 훅이 읽는 사이드카).

## 3. 실행

Skill 도구로 `/dflow-dev {ID8} {MODEL_FLAG}` 를 실행한다.
- 참조는 **id8 만** 쓴다. 순번은 쓰지 않는다.
- `{ANSWERS}` 가 비어 있지 않으면 그 내용을 담당자의 결정으로 삼는다. 같은 agent 브랜치(이미 push 됨)에서 재개하며 되감지 않는다.

담당자 답변:
{ANSWERS}

## 4. 워커 규칙 — `/dflow-dev` 절차보다 이 규칙이 우선한다

1. **Phase 0-가 승인 스윕을 실행하지 않는다.** 팀장이 돌린다. `switch`·`pull`·`merge`·`push` 를 기본 브랜치에 하지 않는다.
2. Phase 0-2 착수 판정에서 선행이 완료됐는데 그 `head_sha` 가 `origin/{BASE_BRANCH}` 에 미반영이면 **직접 머지하지 않는다.** 기점을 그 `head_sha` 로 잡아 스택 브랜치를 만들고 state.json 에 `branch_base` 와 `risk: "선행 main 미반영(팀장 머지 대기)"` 를 기록한 뒤 진행한다.
3. `dflow.sh show {ID8}` 가 `status=approved` 면 머지하지 않는다. `RESULT {TSK} {ID8} <branch> <head_sha> - needs-merge approved` 로 끝낸다.

## 5. 서버 쓰기 범위

- `{ID8}` 외의 어떤 주문에도 claim·progress·release·done 을 하지 않는다.
- `dflow.sh list` 를 호출하지 않는다. 필요한 조회는 `dflow.sh show {ID8}` 뿐이다.

## 6. 판단 규칙

- 명백한 기본값이 있으면 그것을 택하고, 결정 내용을 `docs/tasks/{TSK}/design.md` 또는 커밋 메시지에 한 줄 남긴 뒤 진행한다.
- 기본값이 없어 담당자 결정이 필요할 때만 멈춘다. 그때는:
  1. 현재 산출물을 커밋하고 push 한다(되감기 금지).
  2. `dflow.sh heartbeat` 가 있으면(없으면 건너뜀) `set -a; . ./.env; set +a; .claude/skills/dflow-work/scripts/dflow.sh heartbeat {ID8} --phase blocked --note "<질문 한 줄>"` 1회.
  3. `RESULT {TSK} {ID8} <branch> <head_sha> - blocked <질문> | 선택지: <a> / <b>` 로 끝낸다.
  답을 기다리며 대기하지 않는다. 팀장이 답을 담아 새 팀원을 띄운다.
- 사람에게 직접 묻는 도구는 없다. 질문은 위 `blocked` 경로뿐이다.

## 7. 완료

마지막 응답의 **마지막 줄**을 아래 한 줄로 끝낸다. 팀장은 이 줄만 파싱한다.

```
RESULT {TSK} {ID8} <branch|-> <head_sha|-> <done_exit|-> <status> <한 줄 사유 또는 질문>
```

`status` 는 다음 중 하나다:
- `done` — `dflow.sh done --auto-links` 가 exit 0.
- `skipped` — claim exit 4(다른 세션이 선점·선행 미충족), spec 부재, 착수 불가 판정. 사유를 적는다.
- `needs-merge` — 위 4-3.
- `blocked` — 위 6.
- `failed` — push 훅 거부, 게이트 실패, doctor 실패, not-isolated. 사유를 적는다.
```

- [ ] **Step 2: 테스트 실행**

Run: `npx vitest run tests/skills/dflow-team.test.ts`
Expected: `worker-prompt.md` 두 건 PASS. 나머지(파일 셋·SKILL.md·events·exit·kit)는 여전히 FAIL.

- [ ] **Step 3: 커밋**

```bash
/usr/bin/git add .claude/skills/dflow-team/references/worker-prompt.md
/usr/bin/git commit -m "feat(dflow-team): 팀원 프롬프트 정본 — 격리 확인·워커 규칙으로 dflow-dev 무수정 유지"
```

---

### Task 3: 이벤트 표 `references/events.md`

**Files:**
- Create: `.claude/skills/dflow-team/references/events.md`
- Test: `tests/skills/dflow-team.test.ts`

**Interfaces:**
- Consumes: 좌석표 설계 §5-2 스키마 `{ts, host, repo, tsk, order, phase, event, agent}`.
- Produces: Task 4 의 SKILL.md 가 참조하는 이벤트 이름 8개: `team.start` `team.spawn` `team.result` `team.question` `team.answer` `team.sweep` `team.stop` `team.poll`.

- [ ] **Step 1: 파일 작성**

```markdown
# events.jsonl 이벤트 (dflow-team)

경로 `~/.dflow/events.jsonl`, 한 줄 JSON append. 공통 필드는 좌석표 설계 §5-2 와 같다:
`ts`(ISO8601) · `host`(`hostname -s`) · `repo`(리포 디렉터리명) · `tsk`(TSK 또는 `-`) · `order`(id8 또는 `-`) ·
`phase`(팀장 이벤트는 `-`) · `event` · `agent`(`<hostname>/lead`).

| event | 시점 | 추가 필드 |
|---|---|---|
| `team.start` | 1-3 감시 시작 직후 | `slots`(N), `until`(HH:MM), `interval`(초) |
| `team.poll` | poll.sh 종료 알림 수신 | `exit`(code), `lines`(stdout 줄 수) |
| `team.spawn` | 팀원 spawn | `slot`(번호), `name`(팀원 이름), `agent_id`(`<hostname>/w<slot>`), `retry`(n, 첫 시도 0) |
| `team.result` | 팀원 RESULT 수신 | `slot`, `status`, `branch`, `head_sha`, `done_exit`, `note`(사유·질문) |
| `team.question` | `blocked` 를 담당자에게 물음 | `slot`, `question` |
| `team.answer` | 답을 받아 재시도 spawn | `slot`, `answer`, `retry` |
| `team.sweep` | 승인 스윕 종료 | `merged`(TSK 목록), `waiting`(TSK 목록), `rejected`(TSK 목록), `skipped`(TSK 목록) |
| `team.stop` | 마감 | `reason`(`until`·`user`·`poll-exit-<n>`), `done`(수), `skipped`(수), `failed`(수), `blocked`(수) |

기록 명령(팀장이 그대로 쓴다 — 실패는 무시):
```bash
mkdir -p ~/.dflow && printf '%s\n' '<한 줄 JSON>' >> ~/.dflow/events.jsonl
```
```

- [ ] **Step 2: 테스트 실행**

Run: `npx vitest run tests/skills/dflow-team.test.ts`
Expected: 이벤트 건은 아직 FAIL(SKILL.md 부재). 파일 셋 건도 FAIL. 프롬프트 두 건 PASS 유지.

- [ ] **Step 3: 커밋**

```bash
/usr/bin/git add .claude/skills/dflow-team/references/events.md
/usr/bin/git commit -m "feat(dflow-team): events.jsonl 이벤트 표 — 좌석표 설계 §5-2 스키마와 동일 필드"
```

---

### Task 4: 팀장 절차 `SKILL.md`

**Files:**
- Create: `.claude/skills/dflow-team/SKILL.md`
- Test: `tests/skills/dflow-team.test.ts`

**Interfaces:**
- Consumes: `poll.sh --require-tag agent --until --interval --exclude`(exit 0/2/3/5/6/7/8/9/10, stdout `순번<TAB>id8<TAB>이름`), `dflow.sh doctor/me/show/list`, `dflow-merge/SKILL.md` 절차 3~5, Task 2 템플릿, Task 3 이벤트 이름.
- Produces: 사용자가 `/dflow-team` 으로 호출하는 스킬. 프론트매터 description 에 `"/dflow-team"` 와 `사용법 - /dflow-team [--team-size N] --until HH:MM` 문자열 포함.

- [ ] **Step 1: 파일 작성**

```markdown
---
name: dflow-team
description: D'Flow 팀장 루프 — 내게 배정되고 에이전트 위임 태그(agent)가 붙은 ready 작업을 상시 감시해 슬롯 N개의 팀원(내장 에이전트 팀, 워크트리 격리)에게 자동 분배하고, 팀원이 /dflow-dev 로 완료·보고하면 그 슬롯에 다음 작업을 준다. 승인 스윕(머지)은 팀장 단독. 낮 시간 supervised 전용(무인 야간 금지). 트리거 - "/dflow-team", "팀장 시작", "팀으로 개발", "N건 동시 착수". 사용법 - /dflow-team [--team-size N] --until HH:MM [--interval SEC] [--model opus|sonnet] [--exclude id8,...]
---

# /dflow-team — 팀장 루프 (슬롯 N개 상시 보충)

인자: `$ARGUMENTS` (`--team-size <N>` 기본 3, `--until <HH:MM>` **필수**, `--interval <초>` 기본 300,
`--model opus|sonnet` 팀원의 /dflow-dev 에 전달, `--exclude <id8,...>` 영구 제외 초기값)

설계 정본: `docs/superpowers/specs/2026-09-10-dflow-team-design.md`(wbs-web 리포, 킷에는 미동봉).

> **위치 선언**: /dflow-poll 의 "깨어 있는 세션이 서버를 확인하다 착수" 구조를 슬롯 N개로 늘린 것이다.
> 자율 러너 설계가 무인용으로 기각한 B안 구조임을 알고 쓴다 — 담당자가 근처에 있는 시간대 전용이며
> `--until` 없이 기동하지 않는다. 팀원은 Claude Code 내장 에이전트 팀(Agent 도구 `isolation: worktree`)
> 이라 일반 터미널·tmux·Orca 어디서든 같다. 서버 통신은 팀원의 /dflow-dev 와 poll.sh 가 하고, 팀장은
> dflow.sh 를 `doctor`·`me`·`show`·`list` 로만 쓴다. dflow-work 금지사항 상속, 산문 파싱 금지.

## 팀장이 유지하는 상태 (세션 메모리 — 파일로 쓰지 않는다)

- **슬롯 표**: 슬롯 번호 · 팀원 이름 · TSK · id8 · AGENT_ID · 시작 시각 · 재시도 횟수
- **대기 큐**: ready 인데 빈 슬롯이 없어 못 준 id8 (순서 유지)
- **제외 목록**: `--exclude` 초기값 + 진행 중 · skipped · failed · 반려 id8 (사유 함께)

세션이 죽으면 서버가 정본이다 — "5. 실패·질문·재기동" 의 재기동 행 참조.

## 1. 시작

1. **전제 검사** — 하나라도 실패하면 아무것도 띄우지 않고 중단·보고한다.
   ```bash
   set -a; . ./.env; set +a; .claude/skills/dflow-work/scripts/dflow.sh doctor
   set -a; . ./.env; set +a; .claude/skills/dflow-work/scripts/dflow.sh me
   git status --porcelain                                   # 비어 있어야 한다
   printf '%s\n' "${CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS:-unset}"   # 1 이어야 한다
   ls .claude/skills/dflow-dev/SKILL.md .claude/skills/dflow-poll/scripts/poll.sh .claude/skills/dflow-team/references/worker-prompt.md
   ```
   `me` 가 출력한 이름을 "팀장 신원: <이름>" 으로 한 줄 통지한다 — 이 PC 담당자가 아니면 중단한다.
   `--until` 이 없거나 이미 지난 시각이면 중단한다.
2. **승인 스윕 1회** — "4. 승인 스윕". 결과를 한 줄씩 보고한다.
3. **감시 시작** — poll.sh 를 **Bash 의 `run_in_background` 로** 띄운다(셸 `&` 금지 — 종료 알림이 오지 않는다):
   ```bash
   .claude/skills/dflow-poll/scripts/poll.sh --require-tag agent --until <HH:MM> --interval <SEC> --exclude <제외목록,쉼표>
   ```
   `team.start` 를 기록("7. 이벤트 기록")하고 "팀장 시작: 슬롯 N · until HH:MM · interval SEC" 을 통지한다.

## 2. 이벤트 루프

팀장은 아래 이벤트가 올 때만 움직인다. **포그라운드로 기다리지 않는다.** 처리 후 poll.sh 가 종료돼
있으면 1-3 의 명령으로 **다시 띄운다** — 제외 목록에 진행 중 id8 을 넣어 같은 작업을 다시 잡지 않게
한다. 처리마다 이벤트를 기록한다.

| 이벤트 | 처리 |
|---|---|
| poll exit 0 (ready N줄 `순번<TAB>id8<TAB>이름`) | `team.poll` 기록. 순번은 버린다. 후보별 `dflow.sh show <id8>` 로 `item.spec` 이 비면 제외 목록(사유 "spec 부재")에 넣고 통지. 남은 것을 빈 슬롯 수만큼 **한 메시지에서 동시에** spawn("3. 팀원 spawn"), 나머지는 대기 큐. poll 재시작 |
| poll exit 9 (승인 감지) | `team.poll` 기록. "4. 승인 스윕" 실행. poll 재시작 |
| poll exit 10 (반려 감지 `TSK<TAB>order-id<TAB>review_note`) | `team.poll` 기록. 재작업은 기존 agent 브랜치 위에서 이뤄져야 하므로 워크트리 팀원에게 맡기지 않는다. "반려 — 수동 `/dflow-dev <id8>` 대상: <review_note>" 통지, 제외 목록 추가. poll 재시작 |
| poll exit 8 (종료 시각) | 새 배정 중단. 대기 큐는 목록만 보고하고 비운다. 진행 중 팀원의 RESULT 를 모두 받은 뒤 "6. 마감" |
| poll exit 2 · poll exit 3 · poll exit 5 · poll exit 6 · poll exit 7 | dflow-poll 과 같은 뜻(설정 · 인증 · 권한 · 일시 오류 한도 · 기능 꺼짐). 사유 보고, 재시도 금지. 진행 중 팀원의 RESULT 만 받은 뒤 "6. 마감" |
| 팀원 RESULT 수신 | `team.result` 기록. 슬롯 표·집계 갱신, 슬롯 해제. status 별 처리는 "5. 실패·질문·재기동". 대기 큐가 비어 있지 않으면 즉시 그 슬롯에 spawn, 비어 있으면 poll 이 다음 것을 잡는다 |
| 팀원 무응답 2시간 | "5. 실패·질문·재기동" |

보조 신호: 팀원 이벤트가 30분 이상 없으면 `dflow.sh list --scope claimed` 로 진행 중 id8 의 서버 상태만
슬롯 표에 갱신한다. 팀원은 `list` 를 부르지 않으므로 캐시 경쟁은 팀장 자신뿐이다.

## 3. 팀원 spawn

1. 빈 슬롯 중 가장 작은 번호 s 를 고른다. `AGENT_ID = <hostname -s>/w<s>`.
2. `.claude/skills/dflow-team/references/worker-prompt.md` 를 Read 하고 치환한다:
   `{TSK}` · `{ID8}` · `{AGENT_ID}` · `{MAIN_CHECKOUT}`(`git rev-parse --show-toplevel` 절대 경로) ·
   `{MODEL_FLAG}`(`--model <X>` 또는 빈 문자열) · `{BASE_BRANCH}`(리포 기본 브랜치) ·
   `{ANSWERS}`(재시도가 아니면 빈 문자열).
3. Agent 도구 호출: `subagent_type: general-purpose` · `isolation: worktree` · `name: <TSK>`(재시도는
   `<TSK>-r<n>`) · `prompt: 치환 결과`. 여러 건이면 **한 메시지에서 동시에** 호출한다.
4. 슬롯 표 기록, `team.spawn` 기록, "w<s> ← <TSK> <이름>" 통지.

**하지 않는 것**: 팀원을 새 작업이나 답변으로 SendMessage 재개하지 않는다 — 완료된 팀원의 워크트리는
사라져 있고 cwd 가 메인 체크아웃으로 떨어진다(2026-09-10 실측). **작업 1건 = spawn 1회.**

## 4. 승인 스윕 (팀장 단독 — /dflow-merge 절차 그대로, 후보 식별만 다르다)

후보를 로컬 state.json 이 아니라 **원격 agent 브랜치 tip** 에서 찾는다(다른 PC 팀원의 브랜치도 여기서
머지된다).
```bash
git fetch origin
git branch -r --list 'origin/agent/*'
git show origin/agent/<id8>-<slug>:docs/tasks/<TSK>/state.json     # order 전체 UUID
```
여기에 로컬 `docs/tasks/*/state.json` 의 `reported` 를 더한다. 브랜치 tip 의 phase 는 믿지 않는다 —
판정은 `dflow.sh show <ref>` 의 `status=approved` 뿐이며, 반려(`.reports` 마지막 completion 의
`review_action=reject`)는 대기와 갈라 집계한다. 순서(조상 먼저) · `--no-ff` · 훅 거부 시 우회 금지 ·
`phase=merged` 커밋 · 머지된 브랜치 삭제는 `dflow-merge/SKILL.md` 절차 3~5 를 그대로 따른다.
push 가 non-fast-forward 로 거부되면(다른 PC 의 스윕과 경합) `git pull --ff-only origin <기본브랜치>`
후 후보를 다시 식별한다. 머지됨 / 승인 대기 / 반려 / 건너뜀 을 한 줄씩 보고하고 `team.sweep` 을 기록한다.

## 5. 실패·질문·재기동

| RESULT status / 상황 | 팀장 처리 |
|---|---|
| `done` | 집계. 승인은 사람이 D'Flow 웹에서 |
| `skipped` (claim exit 4 · spec 부재 · 착수 불가) | 집계, 제외 목록(사유). 재시도 없음 |
| `needs-merge` | "4. 승인 스윕" 즉시 실행 |
| `blocked` (사유 자리에 질문·선택지) | `team.question` 기록 → AskUserQuestion 으로 담당자에게 묻는다 → `git worktree list` 에 그 TSK 의 옛 워크트리가 남아 있으면 `git worktree remove --force <경로>` → 답을 `{ANSWERS}` 에 담아 **같은 id8 · 같은 AGENT_ID** 로 새 팀원 spawn(이름 `<TSK>-r<n>`) → `team.answer` 기록. 담당자가 자리에 없으면 그 id8 은 대기 큐 맨 뒤로 보내고 슬롯은 다른 작업에 준다 |
| `failed` (push 훅 거부 · 게이트 실패 · doctor 실패 · not-isolated) | 집계, 제외 목록(사유), 통지. 자동 재시도 없음 |
| 팀원 무응답 2시간(이벤트 없음) | `dflow.sh show <id8>` — `claimed` 면 워크트리 `git worktree remove --force`, "재개 필요 — 수동 `/dflow-dev <id8>`" 통지, 제외 목록 |
| 팀장 세션 소실 후 재기동 | `dflow.sh list --scope claimed` 와 `git branch -r --list 'origin/agent/*'` 를 대조. claimed 인데 진행 중 팀원이 없는 id8 은 "재개 필요" 통지 + 제외 목록(자동 재착수 없음). 그 뒤 "1. 시작" 으로 |

동시에 도는 작업은 poll.sh 가 ready(RD) 로 걸러 준 독립 작업이라 서로 스택하지 않는다. 미승인 선행 위
스택은 /dflow-dev 기존 규칙(선행 산출물 실재 확인 후 스택 + risk 기록)대로 각 팀원이 처리한다.

## 6. 마감

집계 표(TSK · id8 · 브랜치 · head · done exit · status · 사유)를 보고한다. 워크트리를 정리한다:
```bash
git worktree prune
git worktree list                       # 남은 .claude/worktrees/agent-* 를 하나씩
git worktree remove <경로>
git branch -D worktree-agent-<id>
```
**agent/* 브랜치는 남긴다.** 승인은 사람이, 승인 뒤 머지는 다음 /dflow-team 의 스윕 또는 /dflow-merge 가
한다. `team.stop` 을 기록한다. 자동 연장 금지 — 재기동은 사람이 한다.

## 7. 이벤트 기록 (`~/.dflow/events.jsonl`)

좌석표 설계 §5-2 와 같은 스키마의 한 줄 JSON 을 append 한다. 이벤트 이름과 추가 필드는
`references/events.md`. 기록 실패는 무시한다 — 진행을 막지 않는다.
```bash
mkdir -p ~/.dflow && printf '%s\n' '{"ts":"<ISO8601>","host":"<hostname -s>","repo":"<리포명>","tsk":"<TSK|->","order":"<id8|->","phase":"-","event":"team.spawn","agent":"<hostname>/lead","slot":1,"name":"<TSK>","agent_id":"<hostname>/w1","retry":0}' >> ~/.dflow/events.jsonl
```
좌석표의 STANDBY(감시 중) 서버 알림 계약은 아직 없다. 생기면 1-3 시작 · 매 poll 재시작 · 마감 시점에
`{host, agent: "<hostname>/lead", slots, busy, until}` 을 보낸다. 그 전에는 `team.start` / `team.stop` 이
대체 근거다.

## 동시성·안전 규칙

- 팀원은 자기 id8 외 어떤 주문에도 서버 쓰기를 하지 않는다(프롬프트 규칙). 팀장은 서버에 쓰지 않는다
  (머지의 `phase=merged` 는 git 커밋이다).
- 참조는 id8 만. 순번은 목록 캐시 기준이라 팀원 사이에서 남의 작업을 가리킨다.
- poll.sh 를 진행 중 id8 제외 없이 재기동하지 않는다 — 같은 작업을 재발견해 중복 spawn 한다.
- 명백한 기본값이 있으면 통지 후 진행한다. AskUserQuestion 은 `blocked` 중계와 기본값이 없는 경우뿐이다.
- 매 spawn · 매 RESULT · 매 스윕을 사용자에게 한 줄 통지한다 — 반자동의 "반"은 이 가시성이다.
- "지금은 잡을 게 없다"는 판단으로 폴링을 끄지 않는다. 정지는 사용자 "중지"(poll.sh TaskStop → 진행 중
  팀원 RESULT 대기 → "6. 마감")와 `--until` 도달뿐이다.
- 기존 스킬(dflow-dev · dflow-poll · dflow-merge · dflow-work)의 파일을 고치지 않는다. 차이는 전부
  팀원 프롬프트로 흡수한다.
```

- [ ] **Step 2: 테스트 실행**

Run: `npx vitest run tests/skills/dflow-team.test.ts`
Expected: 파일 셋 · 프론트매터 · 프롬프트 2건 · 이벤트 · exit code 건 PASS(6건). `kit-build.sh` 건만 FAIL.

- [ ] **Step 3: 커밋**

```bash
/usr/bin/git add .claude/skills/dflow-team/SKILL.md
/usr/bin/git commit -m "feat(dflow-team): 팀장 루프 스킬 — poll.sh 팬아웃·워크트리 팀원 슬롯 보충·원격 브랜치 기준 승인 스윕"
```

---

### Task 5: 배포 목록·안내 갱신

**Files:**
- Modify: `scripts/kit-build.sh:12`
- Modify: `kit/install.sh:48`
- Modify: `docs/agent/claude-skill/dflow-skills-guide.md` (파일 끝에 절 추가)
- Test: `tests/skills/dflow-team.test.ts`, 전체 `npm test`

**Interfaces:**
- Consumes: `SKILLS="dflow-work dflow-dev dflow-poll dflow-merge dflow-export dflow-wbs-nlevel"`(현재 12행).
- Produces: 킷 조립 시 `dflow-team` 이 함께 복사된다. 안내 문서에 대화 예시가 생긴다.

- [ ] **Step 1: kit-build.sh 12행 수정**

변경 전:
```bash
SKILLS="dflow-work dflow-dev dflow-poll dflow-merge dflow-export dflow-wbs-nlevel"
```
변경 후:
```bash
SKILLS="dflow-work dflow-dev dflow-poll dflow-merge dflow-team dflow-export dflow-wbs-nlevel"
```

- [ ] **Step 2: install.sh 48행 안내 문구 수정**

변경 전:
```
설치 완료: $TARGET/.claude/skills/ (dflow-work · dflow-dev · dflow-poll · dflow-merge · dflow-export · dflow-wbs-nlevel)
```
변경 후:
```
설치 완료: $TARGET/.claude/skills/ (dflow-work · dflow-dev · dflow-poll · dflow-merge · dflow-team · dflow-export · dflow-wbs-nlevel)
```

- [ ] **Step 3: dflow-skills-guide.md 끝에 절 추가**

```markdown

## /dflow-team — 팀으로 동시 개발 (2026-09-10)

`/dflow-poll` 이 한 번에 1건씩 착수하던 것을 슬롯 N개로 넓힌 팀장 스킬이다. 담당자마다 자기 PC 에서
띄우면 각자 배정분이 병렬로 진행된다. 전제는 `/dflow-poll` 과 같다 — 위임 태그 `agent` + 담당자 배정 +
낮 시간 supervised.

- "팀장 시작해, 슬롯 3개, 18시까지" → `/dflow-team --team-size 3 --until 18:00`
  → 팀장이 승인 스윕 1회 → poll.sh 감시 → ready 발견 시 팀원 3명을 워크트리에 동시에 띄움.
- 팀원이 끝나면 "w2 ← TSK-04-03 완료(done)" 한 줄 통지 후 그 슬롯에 다음 ready 배정.
- 팀원이 담당자 결정이 필요하면 팀장이 선택지를 묻는다. 답하면 같은 작업을 같은 슬롯에서 재개한다.
- "중지" → poll.sh 정지, 진행 중 팀원 완료 대기 후 집계 표 보고.
- 반려는 팀원에게 맡기지 않는다 — "수동 `/dflow-dev <id8>` 대상" 으로만 알린다.

설계 정본: `docs/superpowers/specs/2026-09-10-dflow-team-design.md`.
```

- [ ] **Step 4: 계약 테스트와 전체 테스트 실행**

Run: `npx vitest run tests/skills/dflow-team.test.ts`
Expected: 7건 전부 PASS.

Run: `npm test`
Expected: 기준선 440 파일 + 신규 1 파일 PASS, 실패 0.

- [ ] **Step 5: 커밋**

```bash
/usr/bin/git add scripts/kit-build.sh kit/install.sh docs/agent/claude-skill/dflow-skills-guide.md
/usr/bin/git commit -m "chore(kit): dflow-team 을 배포 목록·설치 안내·스킬 가이드에 추가"
```

---

### Task 6: 리허설 (스펙 §11 — 사람이 대화형 세션에서 수행)

이 Task 는 서브에이전트가 아니라 **담당자가 mes-base 리포 루트의 대화형 세션에서** 실행한다. 스테이징
D'Flow 를 향하며 운영 데이터를 건드리지 않는다.

**Files:**
- Modify: `docs/superpowers/specs/2026-09-10-dflow-team-design.md` (§11 아래에 "리허설 기록" 절 추가)

**Interfaces:**
- Consumes: Task 1~5 결과가 `kit-build.sh` 로 mes-base 에 설치된 상태(`.claude/skills/dflow-team` 포함), 스테이징 `.env`, `agent` 태그가 붙은 독립 ready 작업 3건(1건은 spec 에 담당자 결정 분기를 남김).
- Produces: 합격 기준 8항의 결과 기록.

- [ ] **Step 1: 킷 설치 확인**

Run(mes-base 루트): `ls .claude/skills/dflow-team/SKILL.md .claude/skills/dflow-team/references/worker-prompt.md`
Expected: 두 파일 존재.

Run: `set -a; . ./.env; set +a; .claude/skills/dflow-work/scripts/dflow.sh doctor`
Expected: exit 0, base 가 `https://dflow-staging.vercel.app`.

- [ ] **Step 2: 실행**

대화형 세션에서: `/dflow-team --team-size 2 --until <지금+2시간>`

- [ ] **Step 3: 합격 기준 확인 (스펙 §11 의 1~8)**

1. 첫 poll 에서 2건 동시 spawn, 3번째는 대기 큐 → 먼저 끝난 슬롯에 자동 배정.
2. `ls .claude/worktrees/` 에 `agent-*` 2개, 각 워크트리에서 `git branch --show-current` 가 `agent/<id8>-<slug>`, `git log origin/agent/<id8>-<slug> -1` 존재.
3. 메인 체크아웃: 실행 전후 `git branch --show-current` 와 `git status --porcelain` 동일.
4. `dflow.sh show <id8>` 3건이 각각 `reported`, 다른 주문은 변화 없음(`dflow.sh list --scope assigned` 대조).
5. 결정 분기 작업이 `blocked` → 답 입력 → `<TSK>-r1` 이 같은 브랜치에서 `done`.
6. 마감 뒤 `git worktree list` 에 `agent-*` 없음, `git branch --list 'agent/*'` 3개.
7. `/dflow-team` 재실행 시 승인 스윕이 원격 브랜치 3개를 후보로 잡고 "승인 대기" 로 보고.
8. `tail -n 30 ~/.dflow/events.jsonl` 에 `team.start` → `team.spawn`×2 → `team.result` → `team.spawn` → `team.question` → `team.answer` → … → `team.stop` 순서. 각 워크트리(정리 전) `docs/tasks/<TSK>/.agent` 가 `<host>/w1` 또는 `<host>/w2`.

- [ ] **Step 4: 결과 기록**

스펙 파일 §11 아래에 다음 절을 추가한다(각 항목에 실제 값과 날짜를 적는다):

```markdown
## 11-A. 리허설 기록 (YYYY-MM-DD, mes-base, 스테이징)

| 기준 | 결과 | 근거 |
|---|---|---|
| 1 동시 spawn·대기 큐 보충 | 통과/실패 | events.jsonl 줄 번호 |
| 2 워크트리별 agent 브랜치 | 통과/실패 | 브랜치명 |
| 3 메인 체크아웃 불변 | 통과/실패 | git status 출력 |
| 4 서버 done 3건 | 통과/실패 | show 응답 status |
| 5 blocked → 재시도 done | 통과/실패 | 팀원 이름 |
| 6 워크트리 정리·브랜치 잔존 | 통과/실패 | worktree list |
| 7 재실행 스윕 후보 3건 | 통과/실패 | 스윕 보고 |
| 8 events.jsonl 순서·.agent 값 | 통과/실패 | tail 출력 |

발견한 결함과 프롬프트 수정 내역:
- ...
```

- [ ] **Step 5: 커밋**

```bash
/usr/bin/git add docs/superpowers/specs/2026-09-10-dflow-team-design.md
/usr/bin/git commit -m "docs(spec): dflow-team 리허설 기록 — 합격 기준 8항 결과"
```

---

## 자체 검토

- **스펙 커버리지**: §4 시작·이벤트 루프·spawn·마감 → Task 4. §5 팀원 계약 → Task 2. §6 승인 스윕 → Task 4 의 4절. §7 실패·질문·재기동 → Task 4 의 5절. §8 다중 PC → Task 4 의 1절 신원 검사 + 4절 원격 기준 후보. §9 좌석표 연동(`AGENT_ID`·`.agent`·`blocked` heartbeat·events.jsonl) → Task 2 의 2·6절, Task 3, Task 4 의 7절. §10 파일 구성·킷 → Task 5. §11 검증 → Task 6. `.agent` 규칙과 `blocked` 상태를 좌석표 S1·S2 에 반영해 달라는 요청은 좌석표 설계 쪽 작업이라 이 계획 밖이다.
- **플레이스홀더**: 모든 파일 내용이 본문에 있다. Task 6 의 "..." 은 리허설 결과를 적는 자리이며 실행자가 채운다.
- **이름 일관성**: 이벤트 8개(`team.start` `team.poll` `team.spawn` `team.result` `team.question` `team.answer` `team.sweep` `team.stop`)는 Task 3 표와 Task 4 본문에서 같다. 치환 변수 7개는 Task 1 테스트·Task 2 템플릿·Task 4 의 3절에서 같다. status 5종은 Task 1·2·4 에서 같다.
