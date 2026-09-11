# /dflow-team 팀장 스킬 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** D'Flow 에서 내게 배정되고 에이전트 위임(`tags:agent`)된 ready 작업을 상시 감시해 슬롯 N개의 팀원에게 나눠 동시에 개발시키고, 끝난 슬롯에 다음 작업을 채우는 팀장 스킬 `/dflow-team` 을 만든다.

**Architecture:** 팀장은 현재 세션이며 `poll.sh` 와 감시 루프를 Bash `run_in_background` 로 띄워 종료 알림으로 깨어나고, 깨어날 때마다 워크트리·`.result`·events.jsonl 에서 슬롯 표를 다시 만든다. 팀원은 자기 서브에이전트를 띄울 수 있는 독립 세션이다. Orca 에서는 `orca worktree create --agent claude` 로 뜨는 pane 프로세스, 그 밖(일반 터미널·tmux)에서는 `name` 과 `isolation: "worktree"` 를 준 에이전트 팀 팀원이다. 팀원은 포인터 한 줄로 `references/worker-prompt.md` 를 읽고 `/dflow-dev --worker` 를 돌린 뒤 `docs/tasks/<TSK>/.result` 한 줄로 보고한다. 기존 스킬은 수동 동작이 퇴행하지 않는 범위에서 원문도 고친다: `/dflow-dev` 는 claim 전 기점 이동·`reported` 커밋·`--worker` 블록, `/dflow-merge` 는 원격 후보·반려 갈래·뒷정리.

**Tech Stack:** Markdown 스킬(Claude Code `.claude/skills`), 기존 셸 스크립트 재사용(`poll.sh`·`dflow.sh`), `orca` CLI, vitest(스킬 문서 보존·계약 테스트), git worktree.

**Spec:** `docs/superpowers/specs/2026-09-10-dflow-team-design.md`

## Global Constraints

- **팀원은 단순 서브에이전트가 아니다.** pane 의 별도 프로세스(Orca) 또는 에이전트 팀 팀원(Agent 도구 + `name` + `isolation: "worktree"`)만 허용한다. 이유: `/dflow-dev` 가 Phase 1~4 를 서브에이전트로 쪼갠다(스펙 머리말, §2).
- **기존 스킬 수정 원칙(스펙 §6-1)**: 필요하면 기존 스킬 원문도 고친다. 조건은 수동(`--worker` 없는) 동작이 퇴행하지 않는 것이다. 수정은 스펙 §6-1 수정 목록 안에서만 하고, `/dflow-poll`(poll.sh 포함)은 고치지 않는다. 이유: 스킬은 심링크로 모든 리포에 즉시 적용되므로 수동 회귀가 곧 운영 사고다.
- **보존 테스트**: fixture 는 수정 직전 원문을 `cp`(또는 `git show`)로 뜬 사본이다. 테스트 파일의 `CHANGED` 목록에 없는 원문 줄은 현재 파일(표지 블록을 뺀 본문)에 같은 순서로 남아 있어야 한다. `/dflow-dev` 의 `--worker` 전용 삽입은 `<!-- worker:begin -->` / `<!-- worker:end -->` 표지 주석으로 감싼다. 머지 직전에는 대상 브랜치의 머지 전 원문으로 fixture 를 다시 떠서 재실행한다(Task 10). 이유: 머지 충돌을 한쪽으로 풀다 다른 세션의 수정을 잃어도 옛 fixture 로는 초록이다.
- **머지는 리허설 뒤에 한다.** 리허설(Task 7~9)은 리허설 리포의 스킬 심링크가 `feat/dflow-team` 워크트리를 가리키게 해서 머지 전에 한다. 머지는 main 과 staging 둘 다 한다(Task 10). 이유: 머지하는 순간 수정이 심링크로 모든 리포에 퍼진다.
- **브랜치 기점과 문서 위치**: `feat/dflow-team` 은 `origin/main` 에서 딴다(main 머지 때 staging 전용 커밋이 딸려 가지 않게 한다). 스펙과 이 계획서는 staging 에만 있으므로 읽기는 메인 체크아웃 절대경로(`/Users/jji/project/wbs-web/docs/superpowers/…`)로 하고, 리허설 판정 기록과 스펙 사실 갱신은 메인 체크아웃의 staging 에 커밋한다. **staging 문서 커밋은 만든 즉시 push 한다**(아래 「staging 문서 push」). 이유: Task 10 이 staging 을 임시 워크트리에서 `origin/staging` 기준으로 머지하므로, 로컬에만 남은 커밋이 있으면 메인 체크아웃의 fast-forward 가 깨진다.
- **staging 문서 push** (Task 7~9 의 문서 커밋 직후, 메인 체크아웃에서):
  ```bash
  cd /Users/jji/project/wbs-web
  [ "$(git branch --show-current)" = staging ] || echo NOT_STAGING
  git fetch origin && git merge --no-edit origin/main     # staging push 전 origin/main back-merge(프로젝트 규칙)
  git push origin staging
  ```
  `NOT_STAGING` 이면 커밋하기 전에 멈추고 사람에게 알린다(다른 세션의 체크아웃을 switch 하지 않는다). push 가 non-fast-forward 로 거부되면 `git pull --no-rebase origin staging` 뒤 다시 push 한다. force push 는 쓰지 않는다.
- 정본 위치 `.claude/skills/dflow-team/`: `SKILL.md`, `references/worker-prompt.md`, `references/backends.md`, `references/events.md` 넷. 새 스크립트를 만들지 않는다. 킷 밖 경로(`~/project/…`, 다른 리포)는 references 에도 적지 않는다(스펙 §10).
- **기본브랜치**: `git symbolic-ref --short refs/remotes/origin/HEAD` 가 돌려주는 값(예 `origin/main`)이다. 문서에는 `origin/<기본브랜치>` 로 적고 리터럴 `origin/main` 을 박지 않는다. 이유: 대상 리포마다 기본 브랜치가 다를 수 있다.
- **명령 형태**: `/dflow-team [인원] <종료시각> [모델]`(자연어 해석, 인원 기본 3·하드 상한 4, 종료 시각 필수, 모델 `opus|sonnet` 선택). `--team-size`·`--until`·`--interval`·`--exclude` 같은 팀장 옵션은 없다(스펙 §4-1). `poll.sh` 호출의 `--until`·`--interval`·`--exclude`·`--exclude-temp` 는 poll.sh 자체 인터페이스라서 쓴다.
- 포인터 한 줄 형식: `<MAIN_CHECKOUT>/.claude/skills/dflow-team/references/worker-prompt.md 를 읽고 그 규칙대로 실행하라. TSK=<TSK> ID8=<id8> AGENT_ID=<신원>/w<slot> MAIN_CHECKOUT=<MAIN_CHECKOUT> BACKEND=<pane|agent-team> MODEL=<opus|sonnet|default>`. 에이전트 팀 `blocked` 재spawn 때만 둘째 줄 `ANSWER=<답 한 줄>`(스펙 §4-8).
- 워커 프롬프트 치환 변수: `{TSK}` `{ID8}` `{AGENT_ID}` `{MAIN_CHECKOUT}` `{BACKEND}` `{MODEL_FLAG}`, 선택 `{ANSWER}`(스펙 §5).
- `.result` 한 줄: `{TSK} {ID8} <branch|-> <head_sha|-> <done_exit|-> <status> <한 줄 사유 또는 질문>`. status ∈ `done` `skipped` `needs-merge` `blocked` `failed`. `failed` 에서 팀장이 구분하는 사유는 `rate-limit`·`not-isolated`·`no-worker-flag` 셋이다. 경로는 워커 워크트리의 `docs/tasks/{TSK}/.result`, 커밋하지 않고, 같은 줄을 마지막 응답으로도 출력한다(스펙 §5).
- 좌석 식별 파일은 워크트리 루트 `.dflow-agent`(내용 `{AGENT_ID}` 한 줄)이다. `docs/tasks/<TSK>/` 안에 두지 않는다. 이유: claim 전에 그 디렉터리가 있으면 `/dflow-dev` 잔재 격리 규칙이 `.prev-<날짜>` 로 옮긴다(스펙 §5, §9-1).
- `AGENT_ID` 는 `<신원>/w<slot>`, 팀장은 `<신원>/lead`. `<신원>` 은 `dflow.sh me` 의 `user_email` 에서 `@` 앞부분을 소문자로 바꾸고 `[a-z0-9-]` 밖 문자를 `-` 로 바꾼 값이다(스펙 §9-1).
- 에이전트 팀 `name` = `w<slot>-<id8>`, `subagent_type` = `general-purpose`, `isolation: "worktree"` 필수(스펙 §4-8).
- **git 호출 규칙(두 백엔드 공통)**: 워커와 Phase 서브에이전트는 `command -v git` 이 돌려주는 절대경로로 git 을 부른다(bare `git` 금지). 리허설에서 절대경로도 rtk 에 막히면 리터럴 `/usr/bin/git` 으로 바꾼다(스펙 §3-6, §11-5).
- 백엔드는 자동 감지만 한다(`--backend` 없음). tmux 는 v1 에서 에이전트 팀으로 돈다(스펙 §4-3).
- **팀장 상태는 캐시다.** 매 기상마다 `git worktree list --porcelain` + `.dflow-agent` + `.result`(정본)와 `~/.dflow/events.jsonl`(보조)에서 재구성한다. 감시 루프 교체는 TaskStop 이 아니라 세대 파일 `$(git rev-parse --git-path dflow-team.gen)` 로 한다(스펙 §4-2, §4-5).
- events.jsonl: `~/.dflow/events.jsonl`, 스키마 `{ts, host, repo, tsk, order, phase, event, agent}` + 이벤트별 추가 필드(스펙 §9-3).
- 참조는 id8 만 쓴다. 순번 금지. 팀원은 `dflow.sh list` 를 부르지 않는다(스펙 §3-4, §5).
- 팀장·팀원 모두 AskUserQuestion 을 쓰지 않는다. `blocked` 는 PushNotification 이 있으면 한 번 알린다(스펙 §2).
- dflow.sh `show` 응답은 `{ok, order: {id, status, item, …}, reports, depends_evidence}` 모양이다. 항목 필드는 `.order.item.*`(예 `.order.item.spec`·`.order.item.external_ref`), 주문 id 는 `.order.id`, 상태는 `.order.status`, 리포트는 최상위 `.reports[]`(각 `kind`·`review_action`·`review_note`·`created_at`)다(`src/app/api/v1/agent/work/[id]/route.ts`, poll.sh 118행). 주문 status 값은 `ready`·`claimed`·`reported`·`approved`·`cancelled` 다(`src/lib/domain/agentWork.ts`).
- 테스트는 `process.cwd()` 를 리포 루트로 쓴다(기존 `tests/` 관례). `__dirname` 을 쓰지 않는다. vitest 는 `tests/**/*.test.{ts,tsx}` 만 테스트로 잡으므로 헬퍼 `tests/skills/_preserve.ts` 는 테스트로 돌지 않는다.
- 커밋 메시지는 한국어, "무엇"보다 "왜". `git add -A` 금지, 파일명을 명시한다(프로젝트 CLAUDE.md). 각 Task 의 커밋 명령은 제목·본문만 적었다. 실행하는 세션은 메시지 끝에 **그 세션의** attribution 트레일러(`Co-Authored-By:`·`Claude-Session:` 등, 하네스가 알려 주는 것)를 붙인다.
- 새로 쓰는 스킬 본문의 문체는 한국어 평서문이며 엠대시를 줄인다. 원문 인용 줄(테스트의 `CHANGED`·표지 위치)은 바이트 그대로 둔다.

## 실행 준비 (Task 1 전에 한 번)

- [ ] **브랜치·워크트리**: superpowers:using-git-worktrees 로 `origin/main` 기점의 `feat/dflow-team` 브랜치 워크트리를 만든다. 메인 체크아웃(`/Users/jji/project/wbs-web`)에서 직접 고치지 않는다. 이유: 메인 체크아웃은 다른 리포의 스킬 심링크가 가리키는 곳이라 고치는 즉시 퍼진다. 이하 `<FEAT_WT>` 는 이 워크트리의 절대경로다(`git worktree list` 로 확인).
- [ ] **의존 설치**: `<FEAT_WT>` 에서 `npm install`(vitest 와 pre-push 훅 `core.hooksPath` 설정).
- [ ] **격리 에이전트 안에서 실행한다면**: 이 세션의 git 호출도 `command -v git` 절대경로로 한다(rtk 격리 가드, 스펙 §3-6).
- [ ] **원문 일치 확인**: 아래 명령이 아무것도 출력하지 않아야 한다. 이 계획서의 원문 줄 번호·문구는 이 파일들 기준이다.
  ```bash
  git diff --stat origin/main -- .claude/skills/dflow-dev/SKILL.md .claude/skills/dflow-merge/SKILL.md scripts/kit-build.sh kit/install.sh kit/README.md docs/agent/claude-skill/dflow-skills-guide.md
  ```
  출력이 있으면 그 사이 다른 세션이 원문을 고친 것이다. Task 1·2 의 줄 인용을 현재 파일로 다시 확인한 뒤 진행한다.
- [ ] **스펙·계획서가 원격 staging 에 있는지 확인**: 메인 체크아웃에서 `git fetch origin && git rev-list --count origin/staging..staging` 이 0 이어야 한다. 0 이 아니면 스펙·계획서를 포함한 로컬 staging 커밋이 아직 push 되지 않은 것이다. 사람에게 push 를 요청하고 기다린다(남의 커밋을 대신 push 하지 않는다). 이유: 이후 staging 문서 커밋과 Task 10 의 staging 머지가 이 상태를 전제로 한다.
- [ ] **기준선**: `npx vitest run tests/skills` 는 폴더가 없어 "No test files found" 로 끝나는 것이 정상이다.

## 파일 구조

| 파일 | 책임 | Task |
|---|---|---|
| `tests/skills/_preserve.ts` (신규) | 보존 판정(`firstLostLine`)·표지 블록(`workerBlocks`·`stripWorkerBlocks`) 헬퍼 | 1 |
| `tests/skills/fixtures/dflow-dev.SKILL.orig.md` (신규) | 수정 직전 dflow-dev SKILL.md 원문 사본 | 1, 10(대상 브랜치 원문으로 다시 뜸) |
| `tests/skills/dflow-dev-worker.test.ts` (신규) | dflow-dev 보존·§6-2 공통 수정·§6-3 표지 블록 계약 | 1, 9(조건부) |
| `.claude/skills/dflow-dev/SKILL.md` (수정) | Phase 0 2번 claim 전 기점 이동, 3번 기점 문구, Phase 5 4번 `reported` 커밋·push, `--worker` 표지 블록 여섯 | 1, 9(조건부) |
| `tests/skills/fixtures/dflow-merge.SKILL.orig.md` (신규) | 수정 직전 dflow-merge SKILL.md 원문 사본 | 2, 10 |
| `tests/skills/dflow-merge-remote.test.ts` (신규) | dflow-merge 보존·원격 후보·반려 갈래·뒷정리 계약 | 2 |
| `.claude/skills/dflow-merge/SKILL.md` (수정) | 인자 설명, 후보 식별(원격 후보·show jq 축약), 판정 보고(반려·조회 실패), 로컬 브랜치 삭제 건너뛰기, 보고 표 | 2 |
| `.claude/skills/dflow-team/references/worker-prompt.md` (신규) | 팀원 규칙 정본 | 3, 9(조건부) |
| `tests/skills/dflow-team.test.ts` (신규, Task 3~6·9 에서 확장) | dflow-team 문서 계약·배포·권한 준비 | 3~6, 9 |
| `.claude/skills/dflow-team/references/backends.md` (신규) | 백엔드별 spawn·정리 명령, 차이표, 고아 정리 규칙 | 4 |
| `.claude/skills/dflow-team/references/events.md` (신규) | events.jsonl 기록 명령·이벤트 표 | 4 |
| `.claude/skills/dflow-team/SKILL.md` (신규) | 팀장 절차 | 5 |
| `scripts/kit-build.sh` (수정, 12행·22행 뒤) | 킷 목록에 `dflow-team`, 권한 목록 파일 복사 | 6, 9 |
| `kit/install.sh` (수정, 41행 뒤·48행) | 권한 목록 병합, 설치 완료 문구 | 6, 9 |
| `kit/README.md` (수정, 4행·16~17행·표) | 스킬 목록·설치 설명·표 | 6, 9 |
| `kit/agent-team-allow.json` (신규) | 에이전트 팀 권한 허용 목록(리허설 기록) | 9 |
| `docs/agent/claude-skill/dflow-skills-guide.md` (수정) | 한눈에 보기 행, dflow-merge 후보 확대 공지, dflow-team 절 | 6 |
| `docs/superpowers/plans/2026-09-10-dflow-team-rehearsal.md` (신규, staging) | 리허설 판정표 | 7~9 |
| `docs/superpowers/specs/2026-09-10-dflow-team-design.md` (수정, staging) | 리허설로 확인한 사실(§3-5 id 경로, §3-8 A0, §8 권한 목록) | 7~9 |

---

### Task 1: `/dflow-dev` 원문 수정과 `--worker` 블록

**Files:**
- Create: `tests/skills/_preserve.ts`
- Create: `tests/skills/fixtures/dflow-dev.SKILL.orig.md`
- Create: `tests/skills/dflow-dev-worker.test.ts`
- Modify: `.claude/skills/dflow-dev/SKILL.md` (133·134·136·187행 교체, 190행 뒤 한 줄 삽입, 8·55·89·122·159행 뒤와 192행 앞에 표지 블록 삽입)

**Interfaces:**
- Consumes: 없음(첫 Task).
- Produces: `firstLostLine(orig: string, next: string, changed: readonly string[]): string | null`, `workerBlocks(text: string): { prev: string; next: string; body: string }[]`, `stripWorkerBlocks(text: string): string` (Task 2 가 `firstLostLine` 을 재사용한다). `/dflow-dev` 의 `--worker` 플래그와 「--worker 팀원 모드」 절(Task 3 워커가 `/dflow-dev {ID8} --worker {MODEL_FLAG}` 로 부르고, Task 5 전제 검사가 `grep -q -- '--worker'` 로 지원 여부를 본다). Phase 5 의 `reported` 커밋·push(Task 2 원격 후보가 기대지 않지만 Task 8 합격 기준 2번이 확인한다).

- [ ] **Step 1: fixture 를 만든다 (반드시 SKILL.md 를 고치기 전에)**

```bash
mkdir -p tests/skills/fixtures
cp .claude/skills/dflow-dev/SKILL.md tests/skills/fixtures/dflow-dev.SKILL.orig.md
wc -l tests/skills/fixtures/dflow-dev.SKILL.orig.md
```
Expected: `204`. 다르면 다른 세션이 원문을 고친 것이다. 아래 `CHANGED` 네 줄과 표지 위치 여섯 곳의 문구가 fixture 에 그대로 있는지 확인하고 진행한다.

- [ ] **Step 2: 헬퍼 작성**

```ts
// tests/skills/_preserve.ts
const BEGIN = /^\s*<!-- worker:begin -->\s*$/
const END = /^\s*<!-- worker:end -->\s*$/

export type WorkerBlock = { prev: string; next: string; body: string }

/**
 * 표지 블록을 순서대로 돌려준다. prev 는 begin 표지 앞의 마지막 비어 있지 않은 줄,
 * next 는 end 표지 뒤의 첫 비어 있지 않은 줄, body 는 두 표지 사이다.
 * 표지가 겹치거나 짝이 맞지 않으면 throw 한다.
 */
export function workerBlocks(text: string): WorkerBlock[] {
  const lines = text.split('\n')
  const out: WorkerBlock[] = []
  let start = -1
  lines.forEach((line, i) => {
    if (BEGIN.test(line)) {
      if (start !== -1) throw new Error(`표지 겹침: ${i + 1}행`)
      start = i
    } else if (END.test(line)) {
      if (start === -1) throw new Error(`짝 없는 end 표지: ${i + 1}행`)
      const prev = lines.slice(0, start).reverse().find((l) => l.trim() !== '') ?? ''
      const next = lines.slice(i + 1).find((l) => l.trim() !== '') ?? ''
      out.push({ prev, next, body: lines.slice(start + 1, i).join('\n') })
      start = -1
    }
  })
  if (start !== -1) throw new Error('닫히지 않은 begin 표지')
  return out
}

/** 표지 블록(표지 줄 포함)을 뺀 본문. 수동 경로가 읽는 문서다. */
export function stripWorkerBlocks(text: string): string {
  const out: string[] = []
  let inside = false
  for (const line of text.split('\n')) {
    if (BEGIN.test(line)) { inside = true; continue }
    if (END.test(line)) { inside = false; continue }
    if (!inside) out.push(line)
  }
  return out.join('\n')
}

/**
 * orig 의 줄 중 changed 에 없는 줄이 next 에 같은 순서로 모두 남아 있는지 본다.
 * changed 에 든 원문 줄은 바뀌거나 지워져도 된다. next 에 새 줄이 끼어드는 것은 허용한다.
 * 반환: 찾지 못한 첫 원문 줄(보존 위반). 모두 찾으면 null.
 */
export function firstLostLine(orig: string, next: string, changed: readonly string[]): string | null {
  const skip = new Set(changed)
  const b = next.split('\n')
  let j = 0
  for (const line of orig.split('\n')) {
    if (skip.has(line)) continue
    while (j < b.length && b[j] !== line) j++
    if (j === b.length) return line
    j++
  }
  return null
}
```

- [ ] **Step 3: 실패하는 테스트 작성**

```ts
// tests/skills/dflow-dev-worker.test.ts
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { firstLostLine, stripWorkerBlocks, workerBlocks } from './_preserve'

// fixture 갱신 규칙
// 1. fixture 는 스펙 §6-2·§6-3 수정 직전의 원문이다. 손으로 쓰지 않고 cp 또는 git show 로만 만든다.
// 2. 머지 직전(계획서 Task 10)에는 대상 브랜치의 머지 전 원문(git show ORIG_HEAD:<경로>)으로 다시 떠서
//    이 테스트를 돌린다. 옛 fixture 로는 머지 충돌을 한쪽으로 풀다 잃은 다른 세션의 수정을 잡지 못한다.
// 3. 머지 뒤 SKILL.md 의 표지 블록과 CHANGED 줄 밖을 고치는 커밋은 같은 수정을 fixture 에도 적용한다.
// 4. CHANGED 는 스펙 §6-1 수정 목록이 바뀔 때만 고친다.

const ROOT = process.cwd() // vitest 는 리포 루트에서 돈다(기존 tests/ 관례)
const skill = readFileSync(join(ROOT, '.claude/skills/dflow-dev/SKILL.md'), 'utf8')
const orig = readFileSync(join(ROOT, 'tests/skills/fixtures/dflow-dev.SKILL.orig.md'), 'utf8')
const manual = stripWorkerBlocks(skill)
const between = (text: string, start: string, end: string) => text.split(start)[1]?.split(end)[0] ?? ''

/** 스펙 §6-2 로 의도적으로 바꾸는 원문 줄. 이 밖의 원문 줄은 같은 순서로 남아야 한다. */
const CHANGED = [
  // Phase 0 2번: 기점 결정과 detach 를 claim 앞으로 당긴다
  '   판정 통과 후 claim. exit 4(선행·상태로 인한 진행 불가 — 서버 403 `dependency_not_met`',
  '   재매핑 포함)면 fetch/merge 후 1회 재시도, 그래도 4 면 중단·보고. 우회 금지.',
  // Phase 0 3번: 2번이 정한 기점을 쓴다
  '   기점 규칙:',
  // Phase 5 4번: reported state.json 을 커밋·push 한다
  '4. state.json `phase=reported`. 사용자에게 **"승인 대기로 보고했습니다"** 로 전달(완료 아님).',
] as const

describe('/dflow-dev 원문 보존(스펙 §6-1)', () => {
  it('CHANGED 밖의 원문 줄은 표지 블록을 뺀 본문에 같은 순서로 남아 있다', () => {
    expect(firstLostLine(orig, manual, CHANGED)).toBeNull()
  })

  it('CHANGED 줄은 fixture 에 정확히 한 번씩 있다(fixture 가 낡지 않았다)', () => {
    const lines = orig.split('\n')
    for (const l of CHANGED) expect(lines.filter((x) => x === l).length, l).toBe(1)
  })

  it('CHANGED 줄은 현재 파일에 남아 있지 않다(목록이 실제 수정과 일치한다)', () => {
    const lines = skill.split('\n')
    for (const l of CHANGED) expect(lines, l).not.toContain(l)
  })

  it('description 사용법과 표지 블록 밖에는 --worker 가 없다', () => {
    const fm = skill.match(/^---\n([\s\S]*?)\n---/)?.[1] ?? ''
    expect(fm).not.toContain('--worker')
    expect(manual).not.toContain('--worker')
  })
})

describe('/dflow-dev 원문 수정(스펙 §6-2, 수동·워커 공통)', () => {
  it('Phase 0 2번: 기점을 claim 앞에서 정해 detach 한 뒤 claim 하고, 끝내 실패하면 돌아간다', () => {
    const p02 = between(manual, '2. **착수 가능 판정', '3. **브랜치를 오케스트레이터가 직접 만든다**')
    expect(p02).toContain('git switch --detach <기점>')
    expect(p02).toContain('git merge-base --is-ancestor <선행 head_sha> <기점>')
    expect(p02).toContain('선행을 모두 조상으로 갖는 기점 없음')
    expect(p02).toContain('detach 전 브랜치로 돌아간다')
  })

  it('Phase 5 4번: reported state.json 을 커밋하고 agent 브랜치에 push 한다', () => {
    const p5 = between(manual, '## Phase 5', '## --only 옵션')
    expect(p5).toContain('그 파일을 파일명을 명시해 커밋한 뒤 `git push origin <agent 브랜치>` 한다')
    expect(p5).toContain('"승인 대기로 보고했습니다"')
    expect(p5).toContain('인자 없는 `/dflow-merge` 가 반영한다')
  })
})

describe('/dflow-dev --worker 표지 블록(스펙 §6-3)', () => {
  const EXPECTED: { prev?: string; next?: string; tag: string }[] = [
    { prev: '인자: `$ARGUMENTS` (`<순번|TSK-ID>` + 옵션)', tag: '팀장 전용' },
    { prev: '## Phase 0-가 — 승인 스윕(머지, 오케스트레이터 본인)', tag: '「--worker」 A' },
    { prev: '   작업이라 스윕이 못 봤을 수 있다 — 그 경우 지금 즉시 같은 머지 절차를 이 ref 하나로 실행 후 종료).', tag: '「--worker」 C' },
    { prev: '       있다). 머지 후 이어서 진행.', tag: '「--worker」 B' },
    { prev: 'dev-discipline.md 를 따른다.', tag: '「--worker」 E' },
    { next: '## --only 옵션', tag: '## --worker 팀원 모드 (팀장 전용)' },
  ]
  const section = () => workerBlocks(skill).at(-1)?.body ?? ''

  it('표지는 짝이 맞고 여섯 블록이 정한 자리에 정한 순서로 있다', () => {
    const blocks = workerBlocks(skill)
    expect(blocks).toHaveLength(EXPECTED.length)
    EXPECTED.forEach((e, i) => {
      if (e.prev) expect(blocks[i].prev, e.tag).toBe(e.prev)
      if (e.next) expect(blocks[i].next, e.tag).toBe(e.next)
      expect(blocks[i].body, e.tag).toContain(e.tag)
    })
  })

  it('--worker 절이 행 A~E 와 핵심 규칙을 담는다', () => {
    const sec = section()
    for (const row of ['| A |', '| B |', '| C |', '| D |', '| E |']) expect(sec, row).toContain(row)
    expect(sec).toContain('**팀장 전용, 사람이 직접 쓰지 않는다.**')
    expect(sec).toContain('branch_base')
    expect(sec).toContain('git switch --detach <head_sha>')
    expect(sec).toContain('needs-merge approved')
    expect(sec).toContain('AskUserQuestion 을 쓰지 않는다')
    expect(sec).toContain('command -v git')
    expect(sec).toContain('.claude/skills/dflow-team/references/worker-prompt.md')
  })

  it('--worker 절은 기본 브랜치를 switch 하지 않는다', () => {
    const sec = section()
    expect(sec).not.toBe('')
    expect(sec).not.toMatch(/git switch (<기본브랜치>|main)(\s|$)/m)
  })
})
```

- [ ] **Step 4: 실패 확인**

Run: `npx vitest run tests/skills/dflow-dev-worker.test.ts`
Expected: 9건 중 FAIL 6, PASS 3. PASS 는 "CHANGED 밖 원문 보존"·"CHANGED 줄이 fixture 에 한 번씩"·"표지 밖 --worker 없음" 셋이다. 수정 전에는 fixture 와 현재 파일이 같으므로 보존 테스트가 통과하는 것이 정상이다. FAIL 은 "CHANGED 줄이 현재 파일에 없다"(아직 있음)·Phase 0 2번·Phase 5·표지 여섯 블록(`toHaveLength` 0≠6)·A~E 행·"절이 비어 있지 않다" 여섯이다.

- [ ] **Step 5: 스펙 §6-2 공통 수정 (표지 없이, 수동·워커 모두 읽는다)**

(1) 133~134행 두 줄

```markdown
   판정 통과 후 claim. exit 4(선행·상태로 인한 진행 불가 — 서버 403 `dependency_not_met`
   재매핑 포함)면 fetch/merge 후 1회 재시도, 그래도 4 면 중단·보고. 우회 금지.
```
을 아래로 바꾼다.
````markdown
   판정 통과 후 **기점을 정하고 그 기점에서 claim 한다.** claim 의 선행 도달 검사(dflow.sh
   `check_depends_local`)가 현재 HEAD 를 보기 때문이다. 기점 규칙은 3번과 같다: 기본은
   `origin/<기본브랜치>`, 선행이 main 미반영이거나 미승인 스택이면 선행 산출물이 있는 agent 브랜치 또는 그
   `head_sha`.
   - 선행이 여럿이면 기점은 모든 선행의 `head_sha` 를 조상으로 가져야 한다
     (`git merge-base --is-ancestor <선행 head_sha> <기점>` 이 전부 참). 그런 기점이 없으면 착수 불가로
     스킵하고 사유 "선행을 모두 조상으로 갖는 기점 없음" 을 보고한다.
   - 기점이 `origin/<기본브랜치>` 가 아니면 claim 직전에 그 기점으로 옮긴다. 옮기기 전에
     `git branch --show-current` 값을 기억해 둔다.
     ```bash
     git fetch origin && git switch --detach <기점>
     ```
   - claim 이 exit 4(선행·상태로 인한 진행 불가, 서버 403 `dependency_not_met` 재매핑 포함)면
     `git fetch origin` 뒤 기점을 다시 정해 1회 재시도하고, 그래도 4 면 중단·보고한다. 우회 금지.
   - claim 이 끝내 실패하면 detach 전 브랜치로 돌아간다(`git switch <기억한 브랜치>`, 한 번만 옮겼으면
     `git switch -` 와 같다). 기억한 값이 비어 있으면(처음부터 detached 였으면) 그대로 둔다. 사용자를
     detached HEAD 에 남기는 것은 수동 동작의 퇴행이기 때문이다.
````

(2) 136행 `   기점 규칙:` 을 아래 한 줄로 바꾼다.
```markdown
   기점 규칙(2번이 claim 전에 이 규칙으로 정한 기점을 그대로 쓴다. 기본이 아니면 HEAD 가 이미 그 기점에 있다):
```

(3) 187행
```markdown
4. state.json `phase=reported`. 사용자에게 **"승인 대기로 보고했습니다"** 로 전달(완료 아님).
```
을 아래로 바꾼다.
```markdown
4. state.json 을 `phase=reported` 로 갱신하고, 그 파일을 파일명을 명시해 커밋한 뒤 `git push origin <agent 브랜치>` 한다.
   원격 agent 브랜치 tip 에도 `reported` 가 남고, 미커밋 state.json 이 다음 브랜치 전환을 막지 않게 하기
   위해서다. push 가 훅에 거부되면 우회하지 않고 보고한다(done 은 이미 보고됐으므로 되돌리지 않는다).
   사용자에게 **"승인 대기로 보고했습니다"** 로 전달(완료 아님).
```

(4) 190행 `   싶으면 \`/dflow-merge\` 를 여전히 따로 쓸 수 있다).` 바로 뒤에 한 줄을 넣는다.
```markdown
   다만 다른 브랜치로 옮긴 뒤에는 이 작업의 state.json 이 작업트리에서 빠져 위 Phase 0-가 스윕이 보지 못한다. 그때는 원격 agent 브랜치를 후보로 보는 인자 없는 `/dflow-merge` 가 반영한다.
```

- [ ] **Step 6: 스펙 §6-3 `--worker` 표지 블록 여섯 개를 넣는다 (모두 기존 줄 사이 삽입)**

(W1) 8행 `인자: \`$ARGUMENTS\` (\`<순번|TSK-ID>\` + 옵션)` 뒤에(표지 앞뒤 빈 줄 포함):
```markdown

<!-- worker:begin -->
> `--worker` 는 `/dflow-team` 팀장 전용 플래그다(사람이 직접 쓰지 않는다). 있으면 아래 「--worker 팀원 모드」
> 절의 다섯 분기(A~E)만 달라지고, 없으면 이 문서 절차 그대로다.
<!-- worker:end -->
```

(W2) 54행 `## Phase 0-가 — 승인 스윕(머지, 오케스트레이터 본인)` 과 그 뒤 빈 줄(55행) 다음에:
```markdown
<!-- worker:begin -->
> `--worker` 면 이 절 전체를 건너뛴다(「--worker」 A). 스윕은 팀장 몫이다.
<!-- worker:end -->

```

(W3) 89행 `   작업이라 스윕이 못 봤을 수 있다 — 그 경우 지금 즉시 같은 머지 절차를 이 ref 하나로 실행 후 종료).` 바로 뒤에:
```markdown
   <!-- worker:begin -->
   `--worker` 면 머지하지 않고 `needs-merge` 로 끝낸다(「--worker」 C).
   <!-- worker:end -->
```

(W4) 122행 `       있다). 머지 후 이어서 진행.` 바로 뒤에:
```markdown
       <!-- worker:begin -->
       `--worker` 면 머지하지 않고 그 `head_sha` 를 기점으로 삼아 아래 claim 절차대로 스택한다(「--worker」 B).
       <!-- worker:end -->
```

(W5) 159행 `dev-discipline.md 를 따른다.` 바로 뒤에:
```markdown
<!-- worker:begin -->
`--worker` 면 공통 프롬프트에 git 절대경로 규칙 한 줄을 덧붙인다(「--worker」 E).
<!-- worker:end -->
```

(W6) `## --only 옵션` 줄 바로 앞에(블록 뒤 빈 줄 포함):
```markdown
<!-- worker:begin -->
## --worker 팀원 모드 (팀장 전용)

**팀장 전용, 사람이 직접 쓰지 않는다.** `/dflow-team` 팀장이 띄운 팀원만 이 플래그를 붙인다. "이 세션은
자동 실행되는 팀원이고, 기본 브랜치를 잡고 있는 상위 체크아웃(팀장)이 따로 있다" 는 뜻이다. 사용법 줄
(description)에는 넣지 않고, 워크트리에 `.dflow-agent` 가 있다고 이 모드로 바꾸지 않는다. 남은
워크트리에서 사람의 질문이 조용히 꺼지는 사고를 막기 위해서다.

| # | 위치 | 플래그 없음 | `--worker` |
|---|---|---|---|
| A | Phase 0-가 승인 스윕 | claim 앞에서 매번 스윕한다 | **건너뛴다.** 스윕은 팀장 몫이다. 기본 브랜치는 팀장 체크아웃이 잡고 있어 여기서 switch 하면 실패한다. 건너뛴 사실을 한 줄 남긴다 |
| B | Phase 0 2번, 선행이 approved 인데 main 미반영이면 직접 머지 | 직접 머지한다 | **머지하지 않는다.** 그 `head_sha` 를 기점으로 삼아 2번의 claim 절차대로 claim 직전에 `git switch --detach <head_sha>` 하고 claim 한 뒤, 3번에서 그 기점 위에 스택 브랜치를 만든다. state.json 에 `branch_base` 와 `risk: "선행 main 미반영(팀장 머지 대기)"` 를 기록한다 |
| C | Phase 0 1번, 재개 판정이 approved | 즉시 머지하고 종료한다 | **머지하지 않고** `.result` 를 `{TSK} {ID8} <branch> <head_sha> - needs-merge approved` 로 쓰고 끝낸다 |
| D | 사람 판단이 필요한 분기(AskUserQuestion) | 지금처럼 묻는다 | **AskUserQuestion 을 쓰지 않는다.** 명백한 기본값이 있으면 택해 design.md 또는 커밋 메시지에 한 줄 남기고 진행한다. 없으면 산출물을 커밋·push 한 뒤 `.result` 에 `blocked`(사유 자리에 질문과 선택지)를 쓰고 멈춘다. 팀장은 `--only` 를 넘기지 않으므로 `--only` 확인은 이 경로에 없다 |
| E | Phase 1~4 공통 프롬프트 | 지금 문구 그대로 | 공통 프롬프트에 "git 은 `command -v git` 이 돌려주는 절대경로로 호출한다(bare `git` 금지)" 한 줄을 덧붙인다. 오케스트레이터 자신도 같은 규칙을 따른다. 에이전트 팀 백엔드에서는 rtk 가 재작성한 git 을 워크트리 격리 가드가 거부하기 때문이다 |

- 인자 파싱: `$ARGUMENTS` 에 `--worker` 가 있으면 이 모드다. 참조는 id8 으로만 온다.
- `.result` 형식과 status 뜻은 `.claude/skills/dflow-team/references/worker-prompt.md` 가 정본이다. 끝날 때
  status·agent 브랜치·head·`done` exit·한 줄 사유를 마지막에 요약해 워커가 `.result` 로 옮기게 한다.
- 이 다섯 말고 기본 브랜치를 switch·pull·merge·push 하는 지점은 없다. agent 브랜치를 만들고 그 위에
  push 하는 Phase 0 3번과 Phase 5(`reported` 커밋 포함)는 워커에서도 그대로 돈다.
- 새로 만드는 "사람에게 묻기" 지점은 없다. 기존의 중단·보고(push 훅 거부, Verify 재시도 소진, 빨간
  기준선)는 워커에서 `.result` 의 `failed <사유>` 가 된다. 설계 재량 분기만 D 행(`blocked`)이 받는다.
- 게이트·Phase 정의·커밋 규칙·모델 배정(dev-discipline.md)은 워커에서도 같다.
<!-- worker:end -->

```

- [ ] **Step 7: 통과 확인**

Run: `npx vitest run tests/skills/dflow-dev-worker.test.ts`
Expected: PASS 9건. 보존 테스트가 실패하면 메시지의 "찾지 못한 원문 줄" 을 되살린다(편집이 `CHANGED` 밖 줄을 건드린 것이다). 표지 위치 테스트가 실패하면 블록 앞뒤 빈 줄과 들여쓰기를 Step 6 대로 맞춘다.

- [ ] **Step 8: 커밋**

```bash
git add tests/skills/_preserve.ts tests/skills/fixtures/dflow-dev.SKILL.orig.md tests/skills/dflow-dev-worker.test.ts .claude/skills/dflow-dev/SKILL.md
git commit -m "feat(dflow-dev): claim 전 기점 이동·reported 커밋과 --worker 팀원 모드

claim 의 선행 도달 검사가 시작 HEAD 를 봐서 스택 기점에서 claim 이 막히고, reported 를
커밋하지 않아 원격 tip 이 verify 에 머물며 다음 브랜치 전환도 막혔다. 둘은 수동에도 있는
결함이라 원문을 고친다. /dflow-team 팀원용 분기(A~E)는 표지 블록으로 감싸 수동 경로와 떼어
두고, 심링크로 즉시 퍼지므로 수정 목록 밖 원문 줄의 보존을 테스트로 고정한다."
```

---

### Task 2: `/dflow-merge` 원격 후보·반려 갈래·뒷정리

**Files:**
- Create: `tests/skills/fixtures/dflow-merge.SKILL.orig.md`
- Create: `tests/skills/dflow-merge-remote.test.ts`
- Modify: `.claude/skills/dflow-merge/SKILL.md` (8·18·19·35·37행 교체)

**Interfaces:**
- Consumes: `firstLostLine` (Task 1, `tests/skills/_preserve.ts`).
- Produces: 인자 없는 `/dflow-merge` 가 원격 `origin/agent/*` tip 에서 `phase` 가 `merged` 가 아닌 작업을 후보로 보고, 보고에 **반려 목록**(id8)과 "건너뜀(조회 실패)" 를 따로 둔다. Task 5 팀장 SKILL.md 「4. 승인 스윕」 이 반려 목록 id8 을 영구 제외에 넣고, 전제 검사가 `grep -q 'origin/agent/\*'` 로 지원 여부를 본다.

- [ ] **Step 1: fixture 를 만든다 (SKILL.md 를 고치기 전에)**

```bash
cp .claude/skills/dflow-merge/SKILL.md tests/skills/fixtures/dflow-merge.SKILL.orig.md
wc -l tests/skills/fixtures/dflow-merge.SKILL.orig.md
```
Expected: `44`.

- [ ] **Step 2: 실패하는 테스트 작성**

```ts
// tests/skills/dflow-merge-remote.test.ts
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { firstLostLine } from './_preserve'

// fixture 갱신 규칙
// 1. fixture 는 스펙 §6-4 수정 직전의 원문이다. 손으로 쓰지 않고 cp 또는 git show 로만 만든다.
// 2. 머지 직전(계획서 Task 10)에는 대상 브랜치의 머지 전 원문(git show ORIG_HEAD:<경로>)으로 다시 떠서
//    이 테스트를 돌린다. 옛 fixture 로는 머지 충돌을 한쪽으로 풀다 잃은 다른 세션의 수정을 잡지 못한다.
// 3. 머지 뒤 CHANGED 줄 밖을 고치는 커밋은 같은 수정을 fixture 에도 적용한다.
// 4. CHANGED 는 스펙 §6-1 수정 목록이 바뀔 때만 고친다.

const ROOT = process.cwd() // vitest 는 리포 루트에서 돈다(기존 tests/ 관례)
const skill = readFileSync(join(ROOT, '.claude/skills/dflow-merge/SKILL.md'), 'utf8')
const orig = readFileSync(join(ROOT, 'tests/skills/fixtures/dflow-merge.SKILL.orig.md'), 'utf8')

/** 스펙 §6-4 로 의도적으로 바꾸는 원문 줄. 이 밖의 원문 줄은 같은 순서로 남아야 한다. */
const CHANGED = [
  // 인자 설명: 원격 후보를 포함한다
  '인자: `$ARGUMENTS` (선택 — ref 목록. 없으면 로컬 reported 전체가 후보)',
  // 1번 후보 식별: 원격 후보와 show jq 축약
  '   인 작업 전부. 각각 `dflow.sh show <ref>` 로 서버 상태 확인.',
  // 2번 판정 보고: 반려·승인 대기·건너뜀 갈래
  '2. **판정 — approved 만 진행**: `status=approved` 가 아니면 건너뛰고 "승인 대기"로 보고.',
  // 5번 뒷정리: 로컬 브랜치 삭제의 checked out 오류 건너뛰기
  '   - 머지된 `agent/` 브랜치 삭제(로컬 + 원격). 아직 미승인 후손 스택 브랜치는 **삭제·rebase',
  // 6번 보고: 반려 목록
  '6. **보고**: 머지된 목록 / 승인 대기로 남은 목록 / 건너뛴 목록(사유)을 표로.',
] as const

describe('/dflow-merge 원문 보존(스펙 §6-1)', () => {
  it('CHANGED 밖의 원문 줄은 같은 순서로 남아 있다', () => {
    expect(firstLostLine(orig, skill, CHANGED)).toBeNull()
  })

  it('CHANGED 줄은 fixture 에 정확히 한 번씩 있다(fixture 가 낡지 않았다)', () => {
    const lines = orig.split('\n')
    for (const l of CHANGED) expect(lines.filter((x) => x === l).length, l).toBe(1)
  })

  it('CHANGED 줄은 현재 파일에 남아 있지 않다(목록이 실제 수정과 일치한다)', () => {
    const lines = skill.split('\n')
    for (const l of CHANGED) expect(lines, l).not.toContain(l)
  })
})

describe('/dflow-merge 수정(스펙 §6-4)', () => {
  it('원격 origin/agent/* tip 에서 id8 이 일치하고 merged 가 아닌 state.json 을 후보로 본다', () => {
    expect(skill).toContain("git branch -r --list 'origin/agent/*'") // 팀장 전제 검사가 grep 하는 바이트열 포함
    expect(skill).toContain('**`phase` 가 `merged` 가 아니면 전부** 후보다')
    expect(skill).toContain('startswith($id8)')
    expect(skill).toContain('`origin/agent/<id8>-<slug>`')
  })

  it('show 는 jq 로 status 와 마지막 completion 리포트만 뽑고 조회 실패를 따로 보고한다', () => {
    expect(skill).toContain('.order.status')
    expect(skill).toContain('select(.kind == "completion")')
    expect(skill).toContain('건너뜀(조회 실패)')
  })

  it('반려는 승인 대기와 갈라 보고하고 state.json 은 고치지 않는다', () => {
    expect(skill).toContain('반려: 재작업 필요 (<review_note>)')
    expect(skill).toContain('review_action=reject')
    expect(skill).toContain('state.json 은 고치지 않는다')
  })

  it('로컬 브랜치 삭제가 다른 워크트리에 잡혀 실패하면 건너뛰고 보고한다', () => {
    expect(skill).toContain('`checked out at`')
    expect(skill).toContain('건너뛰고 보고에 남긴다')
  })
})
```

- [ ] **Step 3: 실패 확인**

Run: `npx vitest run tests/skills/dflow-merge-remote.test.ts`
Expected: 7건 중 FAIL 5, PASS 2. PASS 는 보존 테스트와 "CHANGED 줄이 fixture 에 한 번씩" 이다(수정 전이라 fixture 와 같다). FAIL 은 "CHANGED 줄이 현재 파일에 없다" 와 §6-4 네 건이다.

- [ ] **Step 4: SKILL.md 다섯 줄을 교체한다**

(1) 8행을 아래 한 줄로 바꾼다.
```markdown
인자: `$ARGUMENTS` (선택: ref 목록. 없으면 로컬 `phase=reported` 작업과 원격 `origin/agent/*` 브랜치 중 `phase` 가 `merged` 가 아닌 것 전체가 후보)
```

(2) 18행 `   인 작업 전부. 각각 \`dflow.sh show <ref>\` 로 서버 상태 확인.` 을 아래로 바꾼다(17행은 그대로 둔다).
````markdown
   인 작업 전부(로컬 후보). 여기에 원격 후보를 더한다. 원격 agent 브랜치 tip 의 state.json 중 브랜치
   이름의 id8 과 `order` 가 일치하는 것을 읽어 **`phase` 가 `merged` 가 아니면 전부** 후보다. tip 의 phase 는
   `reported` 커밋이 빠지면 `verify` 에 머물 수 있어 기대지 않는다. 판정은 2번의 show 로만 하므로 넓게 잡아도
   안전하다.
   ```bash
   git fetch origin
   for b in $(git branch -r --list 'origin/agent/*'); do
     id8=$(printf '%s' "${b#origin/agent/}" | cut -c1-8)
     git ls-tree -r --name-only "$b" -- docs/tasks | grep '/state\.json$' | while IFS= read -r f; do
       git show "$b:$f" | jq -r --arg b "$b" --arg id8 "$id8" \
         'select((.order // "") | startswith($id8)) | [$b, .tsk, .order, .phase] | @tsv'
     done
   done
   ```
   - 일치하는 state.json 이 없는 브랜치는 후보가 아니다(아직 state.json 을 커밋하기 전이다).
   - 로컬 후보와 `order`(전체 UUID)가 같으면 하나로 합친다. 원격에만 있는 후보는 4번 머지 대상을
     `origin/agent/<id8>-<slug>` 로 쓴다.
   - 서버 조회는 후보마다 `show` 한 번이며, jq 로 필요한 필드만 뽑는다. spec 본문을 컨텍스트에 싣지 않기
     위해서다. ref 는 state.json 의 `order`(전체 UUID)다. 승인된 주문은 목록에서 빠져 id8 접두 해석이 죽는다.
     ```bash
     (set -a; . ./.env; set +a; .claude/skills/dflow-work/scripts/dflow.sh show <order>) \
       | jq -c '{status: .order.status, last: ([.reports[]? | select(.kind == "completion")] | last | {review_action, review_note})}'
     ```
     출력이 없거나 `status` 가 null 이면 "건너뜀(조회 실패)" 로 보고한다. 다른 D'Flow 인스턴스의 주문일 수
     있고, 승인 대기나 데이터 없음으로 뭉개면 원인이 가려진다.
````

(3) 19행 `2. **판정 — approved 만 진행**: \`status=approved\` 가 아니면 건너뛰고 "승인 대기"로 보고.` 를 아래로 바꾼다(20행은 그대로 둔다).
```markdown
2. **판정 — approved 만 진행**: `status=approved` 가 아니면 건너뛰고, 아래처럼 갈라 보고한다.
   - 마지막 completion 리포트가 `review_action=reject` 면 "반려: 재작업 필요 (<review_note>)". 반려는
     order.status 를 claimed 로 롤백할 뿐이라 status 로는 가려지지 않는다(dflow-dev Phase 0-가 2번과 같은 판정).
     state.json 은 고치지 않는다(로컬·원격 모두). `phase=rejected` 기록은 `/dflow-dev` 몫이며, 여기서 로컬
     state.json 을 고치면 `/dflow-poll` 의 반려 감지(exit 10)가 그 작업을 보지 못한다.
   - `status=reported` 면 "승인 대기".
   - 그 밖(claimed 로 진행 중인 원격 브랜치 등)이면 "건너뜀(서버 <status>)".
```

(4) 35행 `   - 머지된 \`agent/\` 브랜치 삭제(로컬 + 원격). 아직 미승인 후손 스택 브랜치는 **삭제·rebase` 를 아래로 바꾼다(36행 `     하지 않는다** — …` 는 그대로 이어진다).
```markdown
   - 머지된 `agent/` 브랜치를 지운다. 원격은 `git push origin --delete agent/<id8>-<slug>`, 로컬은 그 브랜치가
     있을 때만 `git branch -d agent/<id8>-<slug>` 다. 로컬 삭제가 다른 워크트리에 잡혀 있다는 오류
     (`checked out at`, `used by worktree at`)로 실패하면 건너뛰고 보고에 남긴다. 그 워크트리를 정리하는 쪽이
     따로 있다(`/dflow-team` 의 결과 처리·고아 스캔 또는 사람). 아직 미승인 후손 스택 브랜치는 **삭제·rebase
```

(5) 37행 `6. **보고**: 머지된 목록 / 승인 대기로 남은 목록 / 건너뛴 목록(사유)을 표로.` 를 아래로 바꾼다.
```markdown
6. **보고**: 머지됨 / 승인 대기 / 반려: 재작업 필요 (<review_note>) / 건너뜀(사유: 조회 실패·서버 상태·조상
   미승인·로컬 브랜치 삭제 건너뜀)을 표로. 반려 목록은 id8 과 함께 따로 둔다. `/dflow-team` 팀장이 이 목록의
   id8 을 제외 목록에 넣는다.
```

- [ ] **Step 5: 통과 확인**

Run: `npx vitest run tests/skills`
Expected: PASS 16건(Task 1 9 + Task 2 7).

- [ ] **Step 6: 커밋**

```bash
git add tests/skills/fixtures/dflow-merge.SKILL.orig.md tests/skills/dflow-merge-remote.test.ts .claude/skills/dflow-merge/SKILL.md
git commit -m "feat(dflow-merge): 원격 agent 브랜치 후보·반려 갈래·checked out 뒷정리

팀원 워크트리나 다른 PC 에서 마감한 작업은 state.json 이 agent 브랜치에만 있어 로컬 후보에
안 잡힌다. 원격 tip 을 후보로 넓히되 tip 의 phase 는 reported 커밋이 빠지면 verify 에 머물 수
있어 merged 만 뺀다. 판정은 여전히 show 의 approved 뿐이라 미승인 커밋은 섞이지 않는다. 반려가
승인 대기에 묻히지 않게 가르고, 다른 워크트리가 잡은 브랜치 때문에 뒷정리가 멈추지 않게 한다."
```

---

### Task 3: 팀원 프롬프트 정본 `references/worker-prompt.md`

**Files:**
- Create: `.claude/skills/dflow-team/references/worker-prompt.md`
- Create: `tests/skills/dflow-team.test.ts`

**Interfaces:**
- Consumes: `/dflow-dev --worker` (Task 1). 호출 형식 `/dflow-dev {ID8} --worker {MODEL_FLAG}`, 끝의 요약(status·브랜치·head·done exit·사유), 행 C 의 `needs-merge approved`.
- Produces: 포인터 키 `TSK` `ID8` `AGENT_ID` `MAIN_CHECKOUT` `BACKEND` `MODEL` `ANSWER` 를 읽는 규칙, `.result` 한 줄 형식과 사유 값, 워크트리 루트 `.dflow-agent`. Task 4 backends.md 와 Task 5 SKILL.md 가 이 이름·형식을 그대로 쓴다.

- [ ] **Step 1: 실패하는 테스트 작성**

```ts
// tests/skills/dflow-team.test.ts
import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = process.cwd() // vitest 는 리포 루트에서 돈다(기존 tests/ 관례)
const SKILL_DIR = join(ROOT, '.claude', 'skills', 'dflow-team')
const read = (rel: string) => readFileSync(join(SKILL_DIR, rel), 'utf8')

const PLACEHOLDERS = ['{TSK}', '{ID8}', '{AGENT_ID}', '{MAIN_CHECKOUT}', '{BACKEND}', '{MODEL_FLAG}', '{ANSWER}']

describe('dflow-team worker-prompt.md 계약(스펙 §5)', () => {
  const p = () => read('references/worker-prompt.md')

  it('치환 변수 일곱 개와 포인터 키를 표로 설명한다', () => {
    expect(existsSync(join(SKILL_DIR, 'references/worker-prompt.md'))).toBe(true)
    for (const v of PLACEHOLDERS) expect(p(), v).toContain('`' + v + '`')
    for (const k of ['TSK', 'ID8', 'AGENT_ID', 'MAIN_CHECKOUT', 'BACKEND', 'MODEL', 'ANSWER']) {
      expect(p(), k).toContain('| `' + k + '` |')
    }
  })

  it('git 은 절대경로로 부르고, 격리 실패면 아무 파일도 쓰지 않는다', () => {
    expect(p()).toContain('command -v git')
    expect(p()).toContain('bare `git` 금지')
    expect(p()).toContain('NOT_ISOLATED')
    expect(p()).toContain('{TSK} {ID8} - - - failed not-isolated')
    expect(p()).toContain('**아무 파일도 쓰지 않고**')
  })

  it('부트스트랩은 .env·스킬을 링크하고 --worker·doctor 를 확인한 뒤 origin/<기본브랜치> 로 detach 한다', () => {
    expect(p()).toContain('ln -s {MAIN_CHECKOUT}/.env .env')
    expect(p()).toContain('ln -s {MAIN_CHECKOUT}/.claude/skills .claude/skills')
    expect(p()).toContain('SKILLS_PARTIAL')
    expect(p()).toContain("grep -q -- '--worker' .claude/skills/dflow-dev/SKILL.md || echo NO_WORKER_FLAG")
    expect(p()).toContain('dflow.sh doctor')
    expect(p()).toContain('symbolic-ref --short refs/remotes/origin/HEAD')
    expect(p()).toContain('fetch origin && <git 절대경로> switch --detach "$base"')
  })

  it('ANSWER 재spawn 은 detach 대신 기존 agent 브랜치로 옮기고 결정을 design.md 에 남긴다', () => {
    expect(p()).toContain("branch -r --list 'origin/agent/{ID8}-*'")
    expect(p()).toContain('- 담당자 결정(blocked 응답): {ANSWER}')
  })

  it('좌석 식별은 워크트리 루트 .dflow-agent 이고 docs/tasks 안에 두지 않는다', () => {
    expect(p()).toContain("printf '%s\\n' '{AGENT_ID}' > .dflow-agent")
    expect(p()).not.toMatch(/docs\/tasks\/\{TSK\}\/\.dflow-agent/)
  })

  it('/dflow-dev --worker 로 실행하고 Skill 미등록이면 SKILL.md 를 직접 따른다', () => {
    expect(p()).toContain('/dflow-dev {ID8} --worker {MODEL_FLAG}')
    expect(p()).toContain('`.claude/skills/dflow-dev/SKILL.md` 를 Read 하고')
  })

  it('서버 쓰기는 {ID8} 하나뿐이고 list 를 부르지 않는다', () => {
    expect(p()).toContain('`list` 는 호출하지 않는다')
    expect(p()).toContain('`show {ID8}` 뿐이다')
  })

  it('.result 한 줄 형식, status 다섯, skipped·failed 사유를 담는다', () => {
    expect(p()).toMatch(/^\{TSK\} \{ID8\} <branch\|-> <head_sha\|-> <done_exit\|-> <status> <한 줄 사유 또는 질문>$/m)
    for (const s of ['done', 'skipped', 'needs-merge', 'blocked', 'failed']) expect(p(), s).toContain('| `' + s + '` |')
    for (const r of ['선행을 모두 조상으로 갖는 기점 없음', 'spec 부재', '`rate-limit`', '`not-isolated`', '`no-worker-flag`']) {
      expect(p(), r).toContain(r)
    }
    expect(p()).toContain('docs/tasks/{TSK}/.result')
  })

  it('blocked 는 커밋·push 뒤 쓰고 이후 동작을 BACKEND 두 값으로 가른다', () => {
    expect(p()).toContain('AskUserQuestion 을 쓰지 않는다')
    expect(p()).toContain('현재 산출물을 커밋(파일명 명시)하고 agent 브랜치를 push 한다')
    expect(p()).toMatch(/^\| `pane` \|/m)
    expect(p()).toMatch(/^\| `agent-team` \|/m)
  })

  it('기본 브랜치로 switch 하지 않는다(detach 만 한다)', () => {
    expect(p()).not.toMatch(/switch (main|<기본브랜치>|origin\/main)(\s|$)/m)
  })
})
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run tests/skills/dflow-team.test.ts`
Expected: FAIL 10건. 파일이 없어 `ENOENT` 또는 `existsSync` 의 `toBe(true)` 실패다.

- [ ] **Step 3: 파일 작성**

````markdown
# /dflow-team 워커 프롬프트 (정본)

> 설계 정본: wbs-web 리포 docs/superpowers/specs/2026-09-10-dflow-team-design.md §5(킷에는 미동봉).

너는 `/dflow-team` 팀장이 띄운 **팀원**이다. 자기 서브에이전트를 띄울 수 있는 독립 세션이며, 작업 한 건을
`/dflow-dev --worker` 로 끝까지 처리하고 `.result` 한 줄로 보고한다. 팀장이 보낸 포인터 줄의 `KEY=VALUE` 가
아래 변수를 채운다. 이 문서의 규칙이 `/dflow-dev` 본문보다 우선한다.

| 변수 | 포인터 키 | 뜻 |
|---|---|---|
| `{TSK}` | `TSK` | 작업 TSK-ID |
| `{ID8}` | `ID8` | 주문 id8. 모든 참조는 이것으로만 한다(순번 금지) |
| `{AGENT_ID}` | `AGENT_ID` | 좌석표 식별자 `<신원>/w<slot>` |
| `{MAIN_CHECKOUT}` | `MAIN_CHECKOUT` | 팀장의 상주 체크아웃 절대경로 |
| `{BACKEND}` | `BACKEND` | `pane` 또는 `agent-team`. `blocked` 이후 동작을 가른다 |
| `{MODEL_FLAG}` | `MODEL` | `opus` 면 `--model opus`, `sonnet` 이면 `--model sonnet`, `default` 면 빈 값 |
| `{ANSWER}` | `ANSWER` | 선택. 에이전트 팀 `blocked` 재spawn 때만 포인터 둘째 줄로 온다. 직전 질문에 대한 담당자 결정 |

## 0. git 호출 규칙 (모든 단계)

첫 Bash 호출에서 `command -v git` 을 실행해 나온 절대경로(예 `/usr/bin/git`)를 이 세션의 git 으로 기억한다.
이후 모든 git 호출은 그 절대경로로 한다(bare `git` 금지). 이 문서와 `/dflow-dev` 본문의 `git …` 예시도 그
절대경로로 바꿔 실행한다. 이유: 에이전트 팀 백엔드에서는 rtk 가 재작성한 git 을 워크트리 격리 가드가
거부한다. pane 에서는 필요 없지만 무해하고, 백엔드별 분기를 두지 않으려고 공통으로 적용한다.

## 1. 격리 확인 (첫 행동)

```bash
case "$(<git 절대경로> rev-parse --show-toplevel)" in
  "{MAIN_CHECKOUT}") echo NOT_ISOLATED ;;
  *) echo ISOLATED ;;
esac
```
`NOT_ISOLATED` 면 격리 실패다. **아무 파일도 쓰지 않고** 마지막 응답으로
`{TSK} {ID8} - - - failed not-isolated` 한 줄만 출력하고 끝낸다. 이유: `.result` 를 쓰면 그 파일이 팀장
체크아웃을 더럽혀 다음 시작의 전제 검사가 깨진다.

## 2. 워크트리 부트스트랩

```bash
[ -e .env ] || ln -s {MAIN_CHECKOUT}/.env .env
if [ ! -e .claude/skills/dflow-dev/SKILL.md ]; then
  if [ -e .claude/skills ]; then echo SKILLS_PARTIAL; else mkdir -p .claude && ln -s {MAIN_CHECKOUT}/.claude/skills .claude/skills; fi
fi
grep -q -- '--worker' .claude/skills/dflow-dev/SKILL.md || echo NO_WORKER_FLAG
set -a; . ./.env; set +a; .claude/skills/dflow-work/scripts/dflow.sh doctor; echo "doctor=$?"
```
- `.env` 는 gitignore 대상이라 새 워크트리에 없다. `.claude/skills` 는 커밋된 리포면 이미 있고, gitignore 된
  심링크로 배포한 리포면 없어서 여기서 링크한다.
- `SKILLS_PARTIAL` 이면 `.result` 에 `{TSK} {ID8} - - - failed skills-partial` 를 쓰고 끝낸다. 스킬 폴더가
  있는데 `dflow-dev` 가 없으면 링크를 걸 자리가 없다.
- `NO_WORKER_FLAG` 이면 `{TSK} {ID8} - - - failed no-worker-flag` 를 쓰고 끝낸다. 옛 `/dflow-dev` 는 기본
  브랜치 switch 에서 죽는다.
- `doctor` 가 0 이 아니면 `{TSK} {ID8} - - - failed doctor-<exit>` 를 쓰고 끝낸다.

이어서 기점을 맞춘다. 두 백엔드 공통이다.
```bash
base=$(<git 절대경로> symbolic-ref --short refs/remotes/origin/HEAD)   # origin/<기본브랜치>
<git 절대경로> fetch origin && <git 절대경로> switch --detach "$base"
```
이유: 워크트리의 시작 HEAD 는 팀장의 현재 브랜치(staging 등)이거나 뒤처진 기본 브랜치일 수 있고, claim 의
선행 도달 검사는 HEAD 를 본다. 스택 기점은 `/dflow-dev` Phase 0 2번이 claim 전에 다시 맞춘다.

**`{ANSWER}` 가 있으면(재spawn)** 위 detach 대신 기존 agent 브랜치로 옮긴다. 이미 claimed 인 작업을 그
브랜치 위에서 이어 가야 하기 때문이다.
```bash
<git 절대경로> fetch origin
<git 절대경로> branch -r --list 'origin/agent/{ID8}-*'
<git 절대경로> switch <위 출력에서 origin/ 을 뗀 이름>
```
그 다음 `docs/tasks/{TSK}/design.md` 에 `- 담당자 결정(blocked 응답): {ANSWER}` 한 줄을 남기고(커밋은
`/dflow-dev` 커밋 규칙을 따른다) 설계 판단에 쓴다.

dflow.sh 를 부를 때마다 `set -a; . ./.env; set +a` 를 앞에 붙인다. env 는 Bash 호출 사이에 남지 않는다.
링크한 `.env`·`.claude/skills` 와 `.dflow-agent`·`.result` 는 커밋하지 않는다. 팀장이 공유 `info/exclude` 에
넣어 두며, `/dflow-dev` 는 파일명을 명시해 stage 한다.

## 3. 좌석 식별 (claim 전)

```bash
printf '%s\n' '{AGENT_ID}' > .dflow-agent
```
워크트리 루트에 쓴다. `docs/tasks/{TSK}/` 안에 두지 않는 이유: claim 하려는 작업의 `docs/tasks/<TSK>/` 가
이미 있으면 `/dflow-dev` 가 이전 시도의 잔재로 보고 `.prev-<날짜>` 로 옮긴다. 워크트리 하나가 작업 하나라서
루트 파일로도 모호하지 않다.

## 4. 실행

Skill 도구로 `/dflow-dev {ID8} --worker {MODEL_FLAG}` 를 실행한다. Skill 도구가 `dflow-dev` 를 모르면(스킬
없는 워크트리에서 세션이 시작돼 등록되지 않은 경우) `.claude/skills/dflow-dev/SKILL.md` 를 Read 하고
`$ARGUMENTS` 를 `{ID8} --worker {MODEL_FLAG}` 로 놓고 그 절차를 그대로 따른다. 스킬 등록을 기다리지 않는다.
`{ANSWER}` 재spawn 이면 `/dflow-dev` 가 claimed 재개 판정으로 이어받는다.

## 5. 서버 쓰기 범위

`{ID8}` 외의 어떤 주문에도 claim·progress·release·done 을 하지 않는다. `list` 는 호출하지 않는다. 필요한
조회는 `show {ID8}` 뿐이다. 이유: `~/.cache/dflow` 의 목록 캐시를 같은 머신의 팀장·팀원이 공유한다.

## 6. 판단 규칙 (자동 모드)

AskUserQuestion 을 쓰지 않는다. 명백한 기본값이 있으면 택하고, 결정을 design.md 또는 커밋 메시지에 한 줄
남긴 뒤 진행한다. 기본값이 없어 담당자 결정이 꼭 필요할 때만 멈춘다.
1. 현재 산출물을 커밋(파일명 명시)하고 agent 브랜치를 push 한다.
2. `.result` 에 `blocked` 줄을 쓴다. 사유 자리에 질문과 선택지를 한 줄로 쓴다(예 `질문? (A) … / (B) …`).
3. 그 다음은 `{BACKEND}` 로 갈린다.

| `{BACKEND}` | `blocked` 이후 |
|---|---|
| `pane` | 질문을 화면에 출력한 채 멈춘다(세션 유지). 사람이 이 탭에서 답하면 같은 워크트리·브랜치에서 이어 가고, 끝나면 `.result` 를 새 결과로 덮어쓴다 |
| `agent-team` | 같은 줄을 마지막 응답으로 출력하고 **세션을 끝낸다.** 탭이 없어 멈춰 있어도 아무도 못 보기 때문이다. 팀장이 사람의 답을 받아 `ANSWER=` 를 붙여 새로 띄운다 |

에이전트 팀 팀원도 AskUserQuestion 도구를 갖고 있지만 쓰지 않는다. 슬롯 N개가 각자 질문을 띄우면 사람이
어느 팀원의 질문인지 모르므로 질문을 팀장 한 곳으로 모은다.

## 7. 보고: `.result` 파일 계약

작업을 끝내거나 멈출 때 `docs/tasks/{TSK}/.result` 에 한 줄을 쓰고(디렉터리가 없으면 만든다), **같은 줄을
마지막 응답으로도 출력한다.** 에이전트 팀에서 워크트리가 이미 정리됐을 때의 폴백이자 Orca `terminal read`
용이다. 팀장은 이 줄만 파싱한다. 커밋하지 않고, 사유에 줄바꿈을 넣지 않는다.

```
{TSK} {ID8} <branch|-> <head_sha|-> <done_exit|-> <status> <한 줄 사유 또는 질문>
```

| status | 언제 | 사유 |
|---|---|---|
| `done` | Phase 5 까지 마치고 `done --auto-links` 가 exit 0 | 한 줄 요약 |
| `skipped` | 착수 전에 멈춤 | `claim-exit-4`, `선행 미충족`, `선행을 모두 조상으로 갖는 기점 없음`, `spec 부재` 중 하나 |
| `needs-merge` | 재개 판정이 approved(`/dflow-dev` 「--worker」 C) | `approved` |
| `blocked` | 6번 판단 규칙 | 질문과 선택지 |
| `failed` | 그 밖의 중단(push 훅 거부, 게이트 실패, Verify 재시도 소진, 부트스트랩 실패) | 자유 문구. 팀장이 구분하는 값은 첫 낱말로 쓴다: `rate-limit`(사용량 한도·rate limit 오류로 멈춤, 재시도 가능), `not-isolated`(격리 실패), `no-worker-flag`(옛 `/dflow-dev`) |

- `<branch>` 는 agent 브랜치 이름이고, 브랜치를 만들기 전에 끝났으면 `-` 다. 팀장은 `-` 인 워크트리를
  비교 없이 정리한다.
- `<head_sha>` 는 push 한 agent 브랜치 tip 의 짧은 sha(`<git 절대경로> rev-parse --short HEAD`), `<done_exit>` 는
  `dflow.sh done` 의 exit code 다. 해당 없는 칸은 `-`.
````

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run tests/skills`
Expected: PASS 26건(Task 1 9 + Task 2 7 + worker-prompt 10).

- [ ] **Step 5: 커밋**

```bash
git add .claude/skills/dflow-team/references/worker-prompt.md tests/skills/dflow-team.test.ts
git commit -m "feat(dflow-team): 팀원 프롬프트 정본: 격리 확인·부트스트랩 detach·.dflow-agent·.result 계약

팀원은 포인터 한 줄로 이 파일을 읽는다. 새 워크트리는 팀장 HEAD 에서 시작하므로 claim 의
선행 도달 검사가 엉뚱한 HEAD 를 보지 않게 origin 기본 브랜치로 detach 하고, gitignore 된
심링크 배포 리포는 스킬이 없어 메인 체크아웃에서 링크한다. 팀장이 가르는 실패 사유
(rate-limit·not-isolated·no-worker-flag)를 고정한다."
```

---

### Task 4: 백엔드·이벤트 참조 `references/backends.md`, `references/events.md`

**Files:**
- Create: `.claude/skills/dflow-team/references/backends.md`
- Create: `.claude/skills/dflow-team/references/events.md`
- Modify: `tests/skills/dflow-team.test.ts` (describe 블록 추가)

**Interfaces:**
- Consumes: 포인터 형식·`.result` 경로·branch `-` 규칙·`.dflow-agent` (Task 3).
- Produces: backends.md 의 절 이름 「pane(Orca)」「에이전트 팀」「고아 정리 규칙」, events.md 의 이벤트 `team.start` `team.spawn` `team.result` `team.blocked` `team.sweep` `team.stop` 과 필드. Task 5 SKILL.md 가 이 이름으로 참조하고, 재구성이 `team.spawn`·`team.result` 필드를 읽는다.

- [ ] **Step 1: 테스트 추가** (`tests/skills/dflow-team.test.ts` 끝에)

```ts
describe('dflow-team backends.md·events.md 계약(스펙 §4-8·§4-9·§9-3·§10)', () => {
  const b = () => read('references/backends.md')
  const e = () => read('references/events.md')

  it('에이전트 팀 spawn 은 isolation worktree 가 필수이고 이름은 w<slot>-<id8>, 회수는 TaskStop 이다', () => {
    expect(b()).toContain('| `isolation` | `"worktree"`. **필수.**')
    expect(b()).toContain('| `name` | `w<slot>-<id8>` |')
    expect(b()).toContain('`general-purpose`')
    expect(b()).toContain('TaskStop(w<slot>-<id8>)')
  })

  it('Orca spawn 은 origin/<기본브랜치> 기점이고 리터럴 origin/main 을 쓰지 않으며 id 경로는 리허설에서 정한다', () => {
    expect(b()).toContain('--base-branch origin/<기본브랜치> --prompt')
    expect(b()).not.toContain('origin/main')
    expect(b()).toContain('orca worktree rm --worktree')
    expect(b()).toContain('워크트리 id 의 JSON 경로는 리허설에서 확정한다')
  })

  it('고아 정리 규칙: branch - 는 비교 없이, 그 밖은 깨끗하고 push 된 것만 지운다', () => {
    expect(b()).toContain('## 고아 정리 규칙')
    expect(b()).toContain('git worktree remove --force')
    expect(b()).toContain('비교 없이 정리한다')
    expect(b()).toContain('git -C <워크트리> status --porcelain')
    expect(b()).toMatch(/rev-parse HEAD[\s\S]*rev-parse origin\/<agent 브랜치>/)
  })

  it('차이표가 기상·blocked·슬롯·회수·정리·git 호출을 백엔드별로 가른다', () => {
    for (const row of ['| 기상 신호 |', '| `blocked` 이후 |', '| 슬롯 점유 |', '| 회수 |', '| 정리 |', '| git 호출 |']) {
      expect(b(), row).toContain(row)
    }
  })

  it('tmux 는 v1 미지원 한 줄만 두고 킷 밖 경로를 적지 않는다', () => {
    expect(b()).toContain('tmux pane 백엔드는 v1 미지원이다')
    expect(b()).not.toContain('~/project/')
    expect(b()).not.toContain('dev-plugin')
  })

  it('events.md 는 여섯 이벤트와 스펙 §9-3 추가 필드를 표로 담는다', () => {
    for (const row of [
      '| `team.start` | 「1. 시작」 4번 | `backend`, `slots`, `until` |',
      '| `team.spawn` | 「5. 팀원 spawn」 6번, 「1. 시작」 4번(흡수한 슬롯) | `slot`, `id8`, `worktree`, `handle` |',
      '| `team.result` | 「3. 결과 처리」 | `slot`, `id8`, `status` |',
      '| `team.blocked` | 「6. blocked」 | `slot`, `id8` |',
      '| `team.sweep` | 「4. 승인 스윕」 | `merged`, `waiting`, `rejected` |',
      '| `team.stop` | 「7. 마감」 | 없음 |',
    ]) expect(e(), row).toContain(row)
  })

  it('기록은 한 줄 append 이고 실패해도 막지 않으며 status 에 구분 사유를 붙인다', () => {
    expect(e()).toContain('>> ~/.dflow/events.jsonl || true')
    expect(e()).toContain('phase:"team"')
    expect(e()).toContain('`failed rate-limit`')
  })
})
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run tests/skills/dflow-team.test.ts`
Expected: 새 describe 7건 FAIL(`ENOENT`), 기존 10건 PASS.

- [ ] **Step 3: `references/backends.md` 작성**

````markdown
# /dflow-team 백엔드: spawn·정리 명령 정본

SKILL.md 「0. 환경 감지」 가 백엔드를 고른다. 워커 프롬프트·`.result` 계약·`/dflow-dev --worker` 는 두
백엔드가 같다. 백엔드가 가르는 것은 아래 차이표의 항목뿐이다.

tmux pane 백엔드는 v1 미지원이다(tmux 에서도 에이전트 팀으로 돈다).

## 차이표

| 항목 | pane(Orca) | 에이전트 팀 |
|---|---|---|
| 팀원 정체 | 별도 프로세스의 claude 메인 에이전트(권한 확인 생략 모드) | Agent 도구 팀원(`name` + `isolation: "worktree"`). 팀장 세션의 권한 모드를 물려받는다 |
| 워크트리 | `orca worktree create` 가 `origin/<기본브랜치>` 기점으로 만든다 | 격리가 팀장의 현재 HEAD 에서 만든다. 워커 부트스트랩이 `origin/<기본브랜치>` 로 detach 한다 |
| 기상 신호 | 감시 루프의 `RESULT_READY` | 팀원 완료 알림 |
| `blocked` 이후 | 팀원은 탭에서 멈춰 기다린다 | 팀원은 세션을 끝낸다 |
| 슬롯 점유 | `blocked` 동안 슬롯을 계속 잡는다 | 결과 처리 직후 슬롯을 해제한다 |
| 사람의 답 | 그 팀원 탭에 직접 준다 | 팀장 세션에 준다. 팀장이 `ANSWER=` 를 붙여 재spawn 한다 |
| 회수 | 없음(별도 프로세스) | 결과 줄 처리 직후 `TaskStop(w<slot>-<id8>)` |
| 팀장 세션이 죽으면 | 팀원은 살아남는다 | 팀원도 함께 죽는다(마지막 push 까지만 남는다) |
| 정리 | `orca worktree rm --worktree "<id>"` | `git worktree remove --force <경로>` |
| git 호출 | `command -v git` 절대경로 | 같다(두 백엔드 공통) |

## pane(Orca)

**spawn**
```bash
orca worktree create --name dflow-<id8> --agent claude --no-parent \
  --base-branch origin/<기본브랜치> --prompt '<포인터 한 줄>' --json
```
- `<기본브랜치>` 는 `git symbolic-ref --short refs/remotes/origin/HEAD` 에서 `origin/` 을 뗀 이름이다. 기점을
  명시하는 이유: 생략하면 리포 기본 base 로 가는데, 팀장의 현재 브랜치가 staging 등일 때 의도와 어긋난다.
- 포인터는 SKILL.md 「5. 팀원 spawn」 의 한 줄 그대로다. 작은따옴표로 감싼다(포인터에는 작은따옴표가 없다).
- 결과 JSON 의 `result.worktree.path`(팀원 cwd)와 `result.agentTerminalHandle` 을 슬롯 표와 `team.spawn` 에
  적는다. 워크트리 id 의 JSON 경로는 리허설에서 확정한다. 확정 전에는 결과 JSON 을 그대로 보고 id 로 보이는
  값을 적고, 정리 때 `orca worktree list --json` 에서 워크트리 경로로 다시 찾는다.
- 포인터가 첫 입력으로 자동 제출되어 팀원이 바로 착수한다.
- 팀원 화면 보기(생존 증거·`blocked` 확인): `orca terminal read --screen --terminal <handle>`.

**정리**
```bash
orca worktree rm --worktree "<워크트리 id>"
orca worktree list        # 누수 확인. dflow-<id8> 가 남아 있으면 같은 명령으로 지운다
```
워크트리·브랜치·디렉터리를 지운다. 미커밋분을 잃으므로 먼저 「고아 정리 규칙」 을 따른다.

## 에이전트 팀

**spawn**: Agent 도구로 띄운다.

| 파라미터 | 값 |
|---|---|
| `subagent_type` | `general-purpose`(Skill·Agent·Bash 를 포함한 모든 도구) |
| `name` | `w<slot>-<id8>` |
| `isolation` | `"worktree"`. **필수.** 빠뜨리면 팀원이 팀장 체크아웃을 상속해 서로의 브랜치를 덮어쓰며, 이 실패는 조용하다 |
| `model` | 인자로 받은 모델(`opus`/`sonnet`). 없으면 생략 |
| `description` | `w<slot> <TSK>` |
| `prompt` | 포인터 한 줄. `blocked` 재spawn 이면 둘째 줄에 `ANSWER=<답 한 줄>` |

- 팀원은 백그라운드로 돈다. 끝나면 완료 알림이 오고, 변경이 남았으면 워크트리 경로·브랜치가 함께 온다.
- 이름에 id8 을 붙이는 이유: 결과 매칭과 회수가 이 이름을 쓰며, 같은 슬롯의 다음 작업과 이름이 겹치지
  않는다. 좌석표 식별은 이름이 아니라 포인터의 `AGENT_ID=` 가 정한다.
- 회수: 결과 줄을 처리한 직후(status 와 무관하며 `blocked` 도 포함한다) `TaskStop(w<slot>-<id8>)`. 이름 붙은
  에이전트는 일을 마쳐도 idle 로 남는다.

**정리**: 워크트리가 아직 있을 때만 팀장 체크아웃에서 한다.
```bash
git worktree remove --force <워크트리 경로>
```
`--force` 는 미추적 부산물(`.result`·`.dflow-agent`·`.env` 링크·스킬 링크) 때문에 필요하다. 먼저
「고아 정리 규칙」 을 따른다.

## 고아 정리 규칙

두 백엔드 공통이다. done·needs-merge 결과 처리, 고아 스캔, 무응답 자동 정리, 마감, 에이전트 팀 `blocked`
재spawn 직전이 이 규칙으로 팀원 워크트리를 지운다.
1. `.result` 의 branch 칸이 `-` 면(브랜치를 만들기 전에 끝남) 비교 없이 정리한다(에이전트 팀은 `--force`).
2. 그 밖에는 아래 두 조건이 모두 참일 때만 정리한다.
   ```bash
   git -C <워크트리> status --porcelain       # 비어 있어야 한다. 부산물은 info/exclude 로 가려져 있다
   git fetch origin
   test "$(git -C <워크트리> rev-parse HEAD)" = "$(git -C <워크트리> rev-parse origin/<agent 브랜치>)"
   ```
3. 하나라도 거짓이면 지우지 않고, 경로와 미커밋 목록(`git -C <워크트리> status --porcelain` 출력)을
   "재개 필요" 보고에 붙인다. 이유: 느린 팀원이나 커밋 전에 멈춘 팀원의 산출물을 잃지 않는다.
4. pane 의 `blocked` 워크트리는 팀원이 탭에서 답을 기다리므로 조건과 무관하게 지우지 않는다.
````

- [ ] **Step 4: `references/events.md` 작성**

````markdown
# /dflow-team 이벤트: `~/.dflow/events.jsonl`

좌석표 설계와 같은 스키마 `{ts, host, repo, tsk, order, phase, event, agent}` 에 이벤트별 추가 필드를 더해
한 줄씩 append 한다. 팀장이 쓰며 `agent` 는 `<신원>/lead`, `phase` 는 `team` 이다. 기록 실패는 진행을
막지 않는다. 재구성(SKILL.md 「팀장 상태」)이 `team.start`·`team.spawn`·`team.result` 를 보조 정본으로 읽는다.

## 기록 명령

```bash
mkdir -p ~/.dflow && jq -nc \
  --arg ts "$(date -u +%Y-%m-%dT%H:%M:%SZ)" --arg host "$(hostname -s)" \
  --arg repo "$(git rev-parse --show-toplevel)" \
  --arg tsk "<TSK 또는 ->" --arg order "<주문 전체 UUID 또는 ->" --arg event "<이벤트>" --arg agent "<신원>/lead" \
  --argjson extra '<추가 필드 JSON 객체>' \
  '{ts:$ts,host:$host,repo:$repo,tsk:$tsk,order:$order,phase:"team",event:$event,agent:$agent} + $extra' \
  >> ~/.dflow/events.jsonl || true
```
- `repo` 는 팀장 체크아웃의 절대경로다. 재구성이 이 값으로 이 리포의 줄만 거른다. 이름만 쓰면 같은 이름의
  클론 둘이 섞인다.
- `<주문 전체 UUID>` 는 show 응답의 `.order.id` 다. 모르면 `-`.
- 추가 필드 예: `team.spawn` 이면 `'{"slot":2,"id8":"ab12cd34","worktree":"-","handle":"w2-ab12cd34"}'`.

## 이벤트

| 이벤트 | 시점(SKILL.md) | 추가 필드 |
|---|---|---|
| `team.start` | 「1. 시작」 4번 | `backend`, `slots`, `until` |
| `team.spawn` | 「5. 팀원 spawn」 6번, 「1. 시작」 4번(흡수한 슬롯) | `slot`, `id8`, `worktree`, `handle` |
| `team.result` | 「3. 결과 처리」 | `slot`, `id8`, `status` |
| `team.blocked` | 「6. blocked」 | `slot`, `id8` |
| `team.sweep` | 「4. 승인 스윕」 | `merged`, `waiting`, `rejected` |
| `team.stop` | 「7. 마감」 | 없음 |

- `team.start`: `backend` 는 `pane` 또는 `agent-team`, `slots` 는 숫자, `until` 은 `HH:MM`.
- `team.spawn`: 워크트리 경로를 아직 모르면 `worktree` 는 `-`. `handle` 은 Orca 터미널 핸들 또는 에이전트
  이름 `w<slot>-<id8>`. 기본 필드 `tsk`·`order` 도 채운다.
- `team.result`: `status` 는 `.result` 의 status 칸이다. `failed` 이고 사유 첫 낱말이 팀장이 구분하는 값이면
  `failed rate-limit`·`failed not-isolated`·`failed no-worker-flag` 처럼 붙이고, suspect 판정이면
  `failed no-result` 로 쓴다. 재구성이 이 값으로 제외 목록과 차단기를 복원하기 때문이다. spec·TSK 부재로
  걸러 spawn 하지 않은 작업은 `slot` 을 `-`, `status` 를 `skipped` 로 남긴다.
- `team.sweep`: 세 필드 모두 개수(숫자)다.
````

- [ ] **Step 5: 통과 확인**

Run: `npx vitest run tests/skills`
Expected: PASS 33건(Task 1 9 + Task 2 7 + dflow-team 17).

- [ ] **Step 6: 커밋**

```bash
git add .claude/skills/dflow-team/references/backends.md .claude/skills/dflow-team/references/events.md tests/skills/dflow-team.test.ts
git commit -m "feat(dflow-team): 백엔드별 spawn·정리 정본, 고아 정리 규칙, 이벤트 표

Orca pane 과 에이전트 팀은 기상 신호·blocked 이후·슬롯 점유·회수·정리만 다르다. 차이를 한 표에
모으고, 에이전트 팀은 isolation 을 빠뜨리면 조용히 깨지므로 필수로 못박는다. 팀원 워크트리는
깨끗하고 push 된 것만 지워 산출물 손실을 막고, 재구성이 읽을 team.spawn·team.result 필드를 정한다."
```

---

### Task 5: 팀장 절차 `SKILL.md`

**Files:**
- Create: `.claude/skills/dflow-team/SKILL.md`
- Modify: `tests/skills/dflow-team.test.ts` (describe 블록 추가)

**Interfaces:**
- Consumes: 포인터·`.result`·`ANSWER`·사유 값(Task 3), backends.md 절 이름과 고아 정리 규칙·events.md 이벤트와 필드(Task 4), `/dflow-merge` 의 반려 목록·"건너뜀(조회 실패)"(Task 2), `/dflow-dev` 의 `--worker`(Task 1), `poll.sh` exit code(머리말 3~8행: 0 2 3 5 6 7 8 9 10)와 인자 `--require-tag`·`--until`·`--interval`·`--exclude`·`--exclude-temp`.
- Produces: 사용자가 부르는 `/dflow-team [인원] <종료시각> [모델]`. Task 6 배포 목록과 Task 7~9 리허설이 쓴다.

- [ ] **Step 1: 테스트 추가** (`tests/skills/dflow-team.test.ts` 끝에)

```ts
describe('dflow-team SKILL.md 계약(스펙 §4)', () => {
  const s = () => read('SKILL.md')

  it('파일 넷이 정본 위치에 있고 킷 밖 경로를 적지 않는다', () => {
    for (const rel of ['SKILL.md', 'references/worker-prompt.md', 'references/backends.md', 'references/events.md']) {
      expect(existsSync(join(SKILL_DIR, rel)), rel).toBe(true)
      expect(read(rel), rel).not.toContain('~/project/')
    }
  })

  it('프론트매터는 새 명령 형태만 쓰고 옛 옵션이 없다', () => {
    const fm = s().match(/^---\n([\s\S]*?)\n---/)?.[1] ?? ''
    expect(fm).toMatch(/^name: dflow-team$/m)
    expect(fm).toContain('"/dflow-team"')
    expect(fm).toContain('사용법 - /dflow-team [인원] <종료시각> [모델]')
    expect(fm).not.toContain('--worker')
    for (const old of ['--team-size', '--interval SEC', '--exclude id8', '--until HH:MM']) expect(s(), old).not.toContain(old)
  })

  it('인자: 기본 3·상한 4, 종료 시각이 유일한 필수, 300초 고정, 작업 빼기는 agent 태그', () => {
    expect(s()).toContain('**기본 3, 하드 상한 4.**')
    expect(s()).toContain('**종료 시각은 유일한 필수 인자다.** 없으면 아래 사용법을 출력하고 종료한다.')
    expect(s()).toContain('감시 주기는 300초로 고정한다')
    expect(s()).toContain('`agent` 태그를 끈다')
  })

  it('환경 감지는 Orca 면 pane, 그 밖은 에이전트 팀이며 병렬 포기 분기가 없다', () => {
    expect(s()).toContain('ORCA_WORKTREE_ID')
    expect(s()).toContain('v1 은 tmux pane 을 지원하지 않아 에이전트 팀으로 돈다')
    expect(s()).toContain('어느 갈래에서도 병렬 불가로 종료하지 않는다')
  })

  it('전제 검사: 부산물 exclude, 추적 안 된 리포에서만 스킬 패턴, state.json 안내, 수정된 스킬 grep', () => {
    for (const p of ["'**/.claude/worktrees/'", "'/.dflow-agent'", "'docs/tasks/*/.result'", "'/.claude/skills'"]) {
      expect(s(), p).toContain(p)
    }
    expect(s()).toContain('git rev-parse --git-path info/exclude')
    expect(s()).toContain('git ls-files .claude/skills')
    expect(s()).toContain('파일명을 명시해 먼저 커밋하라')
    expect(s()).toContain("grep -q -- '--worker' .claude/skills/dflow-dev/SKILL.md")
    expect(s()).toContain("grep -q 'origin/agent/\\*' .claude/skills/dflow-merge/SKILL.md")
  })

  it('매 기상 재구성: 정본은 worktree list·.dflow-agent·.result, 보조는 마지막 team.start 이후 이벤트', () => {
    expect(s()).toContain('git worktree list --porcelain')
    expect(s()).toContain('**깨어날 때마다**')
    expect(s()).toContain('마지막 `team.start` 이후')
    expect(s()).toContain('흡수한 번호와 쓰는 중인 번호를 뺀 1..N 중 가장 작은 것')
    expect(s()).toContain('**고아 스캔**')
  })

  it('권한 모드 안내 한 줄을 백엔드별로 출력한다', () => {
    expect(s()).toContain('팀원은 이 세션의 권한 모드를 물려받으며, 권한 확인이 뜨면 알림 없이 멈춘다')
    expect(s()).toContain('팀원은 권한 확인 생략 모드로 뜬다')
  })

  it('감시 루프: 세대 파일로 교체하고 줄 전체(체크섬)를 비교하며 TICK 은 예정 시각으로 낸다', () => {
    expect(s()).toContain('git rev-parse --git-path dflow-team.gen')
    expect(s()).toContain('echo STALE')
    expect(s()).toContain('RESULT_READY')
    expect(s()).toContain('echo TICK')
    expect(s()).toContain('[ "$(date +%s)" -ge "$TICK_AT" ]')
    expect(s()).toContain("printf '%s\\n' \"$cur\" | cksum")
    expect(s()).toContain('**줄 전체를 비교한다.**')
    expect(s()).toContain('run_in_background')
  })

  it('poll 은 재기동 조건이 맞을 때만 띄우고 일시 제외는 --exclude-temp, 대기 큐는 --exclude 에 넣지 않는다', () => {
    expect(s()).toContain('poll.sh --require-tag agent --until <HH:MM> --interval 300')
    expect(s()).toContain('--exclude-temp <일시 제외 id8 쉼표 목록>')
    expect(s()).toContain('**대기 큐는 `--exclude` 에 넣지 않는다.**')
    expect(s()).toContain('**재기동 조건**')
  })

  it('SKILL.md 가 쓰는 team.* 이벤트는 events.md 에 전부 정의돼 있다', () => {
    const used = new Set(s().match(/(?<![\w-])team\.[a-z]+/g) ?? [])
    expect(used.size).toBeGreaterThanOrEqual(6)
    for (const ev of used) expect(read('references/events.md'), ev).toContain('`' + ev + '`')
  })

  it('SKILL.md 가 분기하는 poll exit code 는 poll.sh 머리말이 문서화한 것뿐이다', () => {
    const header = readFileSync(join(ROOT, '.claude/skills/dflow-poll/scripts/poll.sh'), 'utf8')
      .split('\n')
      .slice(0, 12)
      .join(' ')
    const documented = new Set(header.match(/\b\d{1,2}\b/g) ?? [])
    const used = [...s().matchAll(/poll exit (\d{1,2})/g)].map((m) => m[1])
    expect(used.length).toBeGreaterThan(0)
    for (const c of used) expect(documented.has(c), `exit ${c}`).toBe(true)
  })

  it('show 는 jq 로 .order.item 경로의 필요한 필드만 뽑는다', () => {
    expect(s()).toContain('.order.item.external_ref')
    expect(s()).toContain('.order.item.spec')
    expect(s()).not.toMatch(/`\.item\.(spec|external_ref)`/)
  })

  it('결과 처리: id8 매칭, suspect 와 두 TICK, TaskStop 회수, 차단기, rate-limit, 즉시 정리', () => {
    expect(s()).toContain('**id8 로** 슬롯 표를 찾는다')
    expect(s()).toContain('**`suspect`**')
    expect(s()).toContain('**두 TICK 연속으로 변하지 않을 때만** `failed no-result`')
    expect(s()).toContain('TaskStop(w<slot>-<id8>)')
    expect(s()).toContain('연속 2건')
    expect(s()).toContain('| `failed rate-limit` |')
    expect(s()).toContain('그 자리에서 정리한다')
  })

  it('무응답은 보고만 하고 슬롯을 유지하며, 자동 정리는 두 TICK 연속일 때만 한다', () => {
    expect(s()).toContain('"무응답" 으로 보고만 하고 슬롯을 유지한다')
    expect(s()).toContain('**두 TICK 연속으로** 생존 증거가 없을 때만')
  })

  it('blocked: pane 은 슬롯 유지, 에이전트 팀은 회수 뒤 ANSWER 재spawn, 알림은 한 번', () => {
    expect(s()).toContain('**그 슬롯은 blocked 팀원이 계속 잡으며 다른 작업에 재배정하지 않는다.**')
    expect(s()).toContain('ANSWER=<답 한 줄>')
    expect(s()).toContain('`already checked out`')
    expect(s()).toContain('PushNotification')
    expect(s()).toContain('AskUserQuestion')
  })

  it('spawn: 포인터 한 줄, 중복 확인, isolation 필수, team.spawn 필드, 기점 명시', () => {
    expect(s()).toContain(
      '<MAIN_CHECKOUT>/.claude/skills/dflow-team/references/worker-prompt.md 를 읽고 그 규칙대로 실행하라. TSK=<TSK> ID8=<id8> AGENT_ID=<신원>/w<slot> MAIN_CHECKOUT=<MAIN_CHECKOUT> BACKEND=<pane|agent-team> MODEL=<opus|sonnet|default>',
    )
    expect(s()).toContain('그 id8 이 재구성한 슬롯 표에 있으면 띄우지 않는다')
    expect(s()).toContain('`isolation: "worktree"` **필수**')
    expect(s()).toContain('`team.spawn`(slot, id8, worktree, handle')
    expect(s()).toContain('--base-branch origin/<기본브랜치>')
  })

  it('마감: 마지막 스윕, pane blocked 워크트리 보존, agent 브랜치 남김, team.stop', () => {
    expect(s()).toContain('마지막 승인 스윕')
    expect(s()).toContain('**pane 의 `blocked` 워크트리는 조건과 무관하게 지우지 않는다.**')
    expect(s()).toContain('**agent 브랜치는 남긴다.**')
    expect(s()).toContain('`team.stop`')
  })
})
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run tests/skills/dflow-team.test.ts`
Expected: 새 describe 17건 FAIL(SKILL.md 가 없어 `ENOENT`·`existsSync` 실패), 기존 17건 PASS.

- [ ] **Step 3: `SKILL.md` 작성**

````markdown
---
name: dflow-team
description: D'Flow 에서 내게 배정되고 에이전트 위임(tags:agent)된 ready 작업을 상시 감시해 슬롯 N개의 팀원에게 나눠 동시에 개발시키는 팀장 스킬. 팀원은 자기 서브에이전트를 띄울 수 있는 독립 세션(Orca pane 또는 에이전트 팀 isolation:worktree)이며 각자 워크트리에서 /dflow-dev 를 돌린다. 낮 시간 supervised 전용. 트리거 - "/dflow-team", "팀으로 개발", "팀장 시작", "N건 동시 착수". 사용법 - /dflow-team [인원] <종료시각> [모델]
---

# /dflow-team: 팀장 (슬롯 N개 동시 개발)

인자: `$ARGUMENTS`

> **위치 선언**: 설계 정본은 wbs-web 리포 docs/superpowers/specs/2026-09-10-dflow-team-design.md(킷에는
> 미동봉). `/dflow-poll` 이 한 번에 1건만 착수하던 것을 슬롯 N개 동시 착수와 상시 보충으로 넓힌다. 담당자가
> 자리에 있는 낮 시간 supervised 루프다. 서버 통신은 dflow.sh 로 하고 exit code 로 분기하며, dflow-work
> 금지사항을 상속한다.
>
> **제1 제약: 팀원을 단순 서브에이전트로 띄우지 않는다.** 팀원은 `/dflow-dev` 를 실행하고 `/dflow-dev` 는
> Phase 1~4 를 서브에이전트로 쪼갠다. 단순 서브에이전트는 다시 서브에이전트를 띄우지 못하므로, 팀원은 pane
> 의 별도 프로세스(Orca) 또는 에이전트 팀 팀원(Agent 도구 + `name` + `isolation: "worktree"`)이어야 한다.

참조: `references/backends.md`(백엔드별 spawn·정리 명령, 차이표, 고아 정리 규칙), `references/worker-prompt.md`
(팀원 규칙. 팀장은 포인터로 넘기기만 한다), `references/events.md`(events.jsonl 기록 명령·이벤트 표).

이 문서의 `dflow.sh` 는 `.claude/skills/dflow-work/scripts/dflow.sh` 이며, 부를 때마다 `set -a; . ./.env; set +a`
를 앞에 붙인다. `<기본브랜치>` 는 `git symbolic-ref --short refs/remotes/origin/HEAD` 에서 `origin/` 을 뗀 이름이다.

## 인자

`/dflow-team [인원] <종료시각> [모델]`. 예: `/dflow-team 18:00`, `/dflow-team 4명 18시까지 opus`.

- 인자는 자연어로 해석한다. 플래그 문법을 강제하지 않는다.
- **종료 시각은 유일한 필수 인자다.** 없으면 아래 사용법을 출력하고 종료한다. 무인 야간 실행을 막는
  규칙이며 `/dflow-poll` 과 같다.
  ```
  사용법: /dflow-team [인원] <종료시각> [모델]   예) /dflow-team 18:00 · /dflow-team 4명 18시까지 opus
  ```
  종료 시각은 새 배정을 멈추는 시각이고 진행 중인 팀원은 끝까지 간다. 이미 지난 시각이거나 자정을 넘기는
  시각은 받지 않는다(poll.sh 가 자정 넘김을 지원하지 않는다).
- 인원은 동시 팀원 슬롯 수다. **기본 3, 하드 상한 4.** 4 를 넘기면 4 로 자르고 그 사실을 한 줄 알린다.
  슬롯마다 독립 메인 에이전트가 떠서 비용과 사용량 한도 소모가 빠르게 늘기 때문이다.
- 모델은 선택이다(`opus`|`sonnet`). 없으면 포인터에 `MODEL=default` 를 넘겨 기본 모델을 쓴다.
- 감시 주기는 300초로 고정한다.
- 작업을 빼는 인자는 없다. 특정 작업을 잡지 않게 하려면 D'Flow 에서 그 작업의 `agent` 태그를 끈다.

## 팀장 상태: 메모리는 캐시다

팀장이 다루는 상태는 슬롯 표(슬롯 번호, `AGENT_ID`, TSK, id8, 워크트리 경로, 터미널 핸들 또는 에이전트
이름, 시작 시각, 처리한 `.result` 줄의 체크섬, suspect 표시와 직전 생존 증거), 대기 큐(ready 인데 슬롯이
없어 아직 못 준 id8), 영구 제외 목록(failed·반려·진행 중), 일시 제외 목록(선행·spec 사유), 차단기 상태
(연속 failed 수), 백엔드, 신원 슬러그, `MAIN_CHECKOUT`, 집계다. 세션 메모리의 이 값들은 캐시일 뿐이며,
팀장은 **깨어날 때마다** 아래 정본에서 다시 만든다. 이유: 몇 시간 도는 세션은 컨텍스트 압축을 겪고,
요약에서 슬롯이 빠지면 `.result` 가 와도 처리되지 않는다.

**정본**: 이 신원의 팀원 워크트리와 그 결과.
```bash
git worktree list --porcelain | sed -n 's/^worktree //p' | while IFS= read -r w; do
  [ -f "$w/.dflow-agent" ] || continue
  a=$(head -n 1 "$w/.dflow-agent")
  case "$a" in "<신원>/w"*) ;; *) continue ;; esac
  r=$(cat "$w"/docs/tasks/*/.result 2>/dev/null | head -n 1)
  printf '%s\t%s\t%s\t%s\n' "$a" "$w" "$(git -C "$w" branch --show-current)" "${r:--}"
done
```
- 루트 `.dflow-agent` 가 `<신원>/w` 로 시작하는 워크트리가 이 신원의 팀원 워크트리이고, 값의 슬롯 번호가 그
  워크트리의 슬롯이다.
- 그 워크트리 안의 `docs/tasks/*/.result` 가 팀원의 결과다.
- 브랜치 이름 `agent/<id8>-…`(있으면)과 Orca 워크트리 이름 `dflow-<id8>` 이 작업을 알려 준다.

**보조**: `~/.dflow/events.jsonl` 에서 마지막 `team.start` 이후이고 `agent` 가 `<신원>/lead`, `repo` 가
`MAIN_CHECKOUT` 인 줄.
```bash
jq -c --arg a '<신원>/lead' --arg r '<MAIN_CHECKOUT>' 'select(.agent == $a and .repo == $r)' ~/.dflow/events.jsonl 2>/dev/null \
  | awk '/"event":"team.start"/{buf=""} {buf=buf $0 "\n"} END{printf "%s", buf}'
```
- `team.spawn` 의 `slot`·`id8`·`worktree`·`handle` 로 슬롯과 작업을 잇는다. 아직 `.dflow-agent` 를 쓰지 않았거나
  브랜치를 만들지 않은 Phase 0 의 팀원도 이것으로 id8 을 안다.
- `team.result` 로 이미 판정한 작업, 제외 목록(`skipped` 는 일시, `failed`·`failed no-result`·
  `failed not-isolated`·`failed no-worker-flag`·`blocked` 는 영구, `failed rate-limit` 은 제외 없음), 차단기(끝에서부터
  연속한 `failed…` 수)를 복원한다.

**재구성 규칙**
- 살아 있는 팀원의 워크트리는 그 `.dflow-agent` 슬롯 번호로 슬롯 표에 흡수한다. 그 안에 `.result` 가 있고
  아직 처리하지 않았으면 즉시 결과 처리를 한다(「3. 결과 처리」).
- "살아 있는 팀원": pane 이면 `orca worktree list` 에 그 워크트리가 있고
  `orca terminal read --screen --terminal <handle>` 이 성공한다. 에이전트 팀이면 이 세션의 `team.start` 이후
  `team.spawn` 이 있고 그 id8 의 `team.result` 가 아직 없다. 팀장 세션이 새로 뜬 경우(「1. 시작」 2번)에는
  에이전트 팀 팀원이 하나도 살아 있지 않다고 본다. 팀원은 팀장과 함께 죽기 때문이다.
- 새로 줄 슬롯 번호는 흡수한 번호와 쓰는 중인 번호를 뺀 1..N 중 가장 작은 것이다. 이유: 살아 있는 팀원과
  같은 `AGENT_ID` 를 다시 발급하면 좌석표가 한 인물을 두 책상에 그린다.
- 대기 큐는 재구성하지 않는다. 비어 있어도 다음 poll 이 같은 ready 를 다시 찾는다.
- 반려 때문에 poll 을 멈춰 둔 상태(「2-3」 poll exit 10 행)도 재구성하지 않는다. 압축 뒤에는 poll 을 다시 띄우고,
  같은 exit 10 이 다시 연달아 오면 그때 다시 멈춘다. 보고가 한 번 더 나올 뿐 틀린 착수는 생기지 않는다.
- 결과 처리는 반복해도 안전하게 하며 집계는 order 로 중복을 없앤다. 처리 여부는 슬롯 표의 체크섬으로
  가르고, 체크섬을 모르면(압축 뒤) 같은 id8·같은 status 의 `team.result` 가 있으면 처리한 것으로 본다.
- **고아 스캔**: 이 신원의 `.dflow-agent` 워크트리 중 살아 있는 팀원이 없는 것은 backends.md
  「고아 정리 규칙」 대로만 정리한다(깨끗하고 HEAD 가 `origin/<그 브랜치>` 와 같은 것만, `.result` 의 branch 가
  `-` 면 비교 없이 `--force`). 나머지는 경로와 미커밋 목록을 "재개 필요" 보고에 붙이고 자동으로 지우지 않는다.
- state.json 미러 같은 새 저장소는 만들지 않는다. 정본(서버·원격 agent 브랜치·워크트리)과 따로 도는
  저장소는 동기화 규칙을 계속 맞춰야 하기 때문이다.

## 0. 환경 감지 (시작 맨 처음)

```bash
printf 'TERM_PROGRAM=%s ORCA_WORKTREE_ID=%s TMUX=%s\n' "${TERM_PROGRAM-}" "${ORCA_WORKTREE_ID-}" "${TMUX-}"
```
1. `TERM_PROGRAM` 이 `Orca` 이거나 `ORCA_WORKTREE_ID` 가 비어 있지 않으면 **pane 백엔드(Orca)** 다.
2. 그 밖(진짜 tmux·일반 터미널)은 **에이전트 팀 백엔드** 다. `TMUX` 가 있으면
   "v1 은 tmux pane 을 지원하지 않아 에이전트 팀으로 돈다" 를 한 줄 알린다. 에이전트 팀이면
   "blocked 질문은 이 세션으로 모이고 팀원 화면은 보이지 않는다" 도 한 줄 알린다.

어느 갈래에서도 병렬 불가로 종료하지 않는다. 백엔드 이름은 시작 보고와 `team.start` 에 남긴다.

## 1. 시작

1. **전제 검사**: 하나라도 실패하면 아무것도 띄우지 않고 중단·보고한다.
   ```bash
   MAIN_CHECKOUT=$(git rev-parse --show-toplevel); [ "$MAIN_CHECKOUT" = "$(pwd -P)" ] || echo NOT_REPO_ROOT
   for s in dflow-dev dflow-work dflow-poll dflow-merge dflow-team; do [ -e ".claude/skills/$s/SKILL.md" ] || echo "NO_SKILL $s"; done
   grep -q -- '--worker' .claude/skills/dflow-dev/SKILL.md || echo OLD_DFLOW_DEV
   grep -q 'origin/agent/\*' .claude/skills/dflow-merge/SKILL.md || echo OLD_DFLOW_MERGE
   test -f .env || echo NO_ENV
   (set -a; . ./.env; set +a; .claude/skills/dflow-work/scripts/dflow.sh doctor) >/dev/null; echo "doctor=$?"
   (set -a; . ./.env; set +a; .claude/skills/dflow-work/scripts/dflow.sh me) | jq -r '.user_email'
   ```
   - `OLD_DFLOW_DEV`·`OLD_DFLOW_MERGE` 는 수정된 기존 스킬이 적용되지 않았다는 뜻이다. 옛 `/dflow-dev` 면
     팀원이 기본 브랜치 switch 에서 죽고, 옛 `/dflow-merge` 면 스윕이 팀원 작업을 영영 보지 못한다.
   - `user_email` 을 출력해 보여 준다. `DFLOW_PATS` 첫 토큰이 이 신원의 PAT 여야 한다. 신원 슬러그는
     `@` 앞부분을 소문자로 바꾸고 `[a-z0-9-]` 밖 문자를 `-` 로 바꾼 값이다. 팀원은 `<신원>/w<slot>`, 팀장은
     `<신원>/lead` 다.
     ```bash
     printf '%s' '<user_email>' | cut -d@ -f1 | tr 'A-Z' 'a-z' | sed 's/[^a-z0-9-]/-/g'
     ```
   - 공유 `info/exclude` 에 워커 부산물 패턴을 없을 때만 넣는다. 커밋하지 않는 로컬 설정이며 링크드
     워크트리가 모두 공유한다.
     ```bash
     ex=$(git rev-parse --git-path info/exclude); mkdir -p "$(dirname "$ex")"; touch "$ex"
     for p in '**/.claude/worktrees/' '/.dflow-agent' 'docs/tasks/*/.result'; do
       grep -qxF "$p" "$ex" || printf '%s\n' "$p" >> "$ex"
     done
     [ -n "$(git ls-files .claude/skills | head -n 1)" ] || { grep -qxF '/.claude/skills' "$ex" || printf '%s\n' '/.claude/skills' >> "$ex"; }
     ```
     `**/.claude/worktrees/` 는 에이전트 팀 격리 워크트리, `/.dflow-agent`·`docs/tasks/*/.result` 는 워커가 쓰는
     미추적 파일, `/.claude/skills`(끝 슬래시 없음)는 워커가 만드는 스킬 심링크다. 끝 슬래시가 붙은 패턴은
     디렉터리에만 걸려 심링크를 가리지 못한다. 마지막 줄은 **`.claude/skills` 가 추적되지 않는 리포에서만**
     넣는다. 스킬이 커밋된 리포에 넣으면 새로 추가하는 스킬 파일이 무시돼 `git add` 가 거부되기 때문이다.
     이유: 부산물이 `/dflow-dev` Phase 5 의 "미커밋 잔여물 커밋" 에 섞이면, 브랜치마다 다른 `.dflow-agent` 가
     스윕 머지를 충돌시키고 절대경로 심링크가 main 에 들어간다.
   - 그 뒤 `git status --porcelain` 이 비어 있어야 한다. 팀장 체크아웃이 더러우면 승인 스윕이 위험하다.
     실패 안내에 "미커밋 `docs/tasks/*/state.json` 은 파일명을 명시해 먼저 커밋하라(수동 `/dflow-dev` 가
     남긴 것일 수 있다)" 를 넣는다.
   - pane(Orca)이면 `orca worktree create` 가 `--agent`·`--prompt` 를 지원해야 한다.
     ```bash
     orca worktree create --help | grep -q -- '--agent' && orca worktree create --help | grep -q -- '--prompt' || echo ORCA_OLD
     ```
2. **재구성**: 새 `team.start` 를 쓰기 **전에** 「팀장 상태」 의 재구성과 고아 스캔을 한다. 이유: "마지막
   `team.start` 이후" 필터가 이전 세션의 이벤트를 가리지 않게 한다. 이 단계가 곧 재기동 절차다. 이어서
   서버에 claimed 인데 흡수한 슬롯에도 고아 워크트리에도 없는 id8 을 "재개 필요: 수동 `/dflow-dev <id8>`"
   로 보고하고 영구 제외에 넣는다(자동 재착수 없음, 수동 세션이 진행 중인 작업일 수도 있다).
   ```bash
   (set -a; . ./.env; set +a; .claude/skills/dflow-work/scripts/dflow.sh list --scope claimed) | awk -F'\t' 'NF>=4 {print $4}'
   ```
3. **권한 모드 안내 한 줄**: 에이전트 팀이면
   "팀원은 이 세션의 권한 모드를 물려받으며, 권한 확인이 뜨면 알림 없이 멈춘다" 를,
   pane 이면 "팀원은 권한 확인 생략 모드로 뜬다" 를 출력한다.
4. `team.start`(backend, slots, until)를 기록한다. 흡수한 슬롯마다 `team.spawn`(같은 slot·id8·worktree·handle)을
   다시 기록한다. 이유: 다음 기상부터 재구성은 새 `team.start` 이후만 읽는다. 그 다음 **승인 스윕**
   (「4. 승인 스윕」)을 한 번 돌고 결과(머지됨·대기·반려·건너뜀)를 한 줄씩 보고한다.
5. **감시 시작**: 다음 TICK 예정 시각을 지금+1800초로 정하고 「2. 기상과 감시」 대로 감시 루프를 띄운다.
   재기동 조건이 맞으면 poll.sh 도 띄운다. 둘 다 Bash `run_in_background` 로 띄운다. 셸 `&` 는 쓰지 않는다.
   종료 알림이 세션에 오지 않아 루프가 소리 없이 끊기기 때문이다.

## 2. 기상과 감시

팀장은 포그라운드로 기다리지 않는다. 깨우는 것은 poll.sh 종료, 감시 루프 종료, 에이전트 팀 팀원 완료
알림이다. 사람이 이 세션에 답을 주는 것도 기상이다.

### 2-1. poll

```bash
.claude/skills/dflow-poll/scripts/poll.sh --require-tag agent --until <HH:MM> --interval 300 \
  --exclude <영구 제외 id8 쉼표 목록> --exclude-temp <일시 제외 id8 쉼표 목록>
```
- 목록이 비면 그 옵션을 뺀다. 영구 제외에는 진행 중 슬롯의 id8 도 넣는다.
- **대기 큐는 `--exclude` 에 넣지 않는다.** 메모리에만 있는 값이 떠 있는 poll 프로세스 안에 숨으면, 컨텍스트
  압축으로 대기 큐를 잃었을 때 그 작업들이 보이지 않는 제외에 갇히기 때문이다.
- **재기동 조건**: 빈 슬롯이 있고, 대기 큐가 비었고, 차단기가 풀려 있고, 종료 시각 전이고, 반려 때문에
  멈춰 두지 않았을 때만 띄운다. poll 은 기동 즉시 첫 조회를 하므로, spawn 할 수 없는 채로 띄우면 같은
  ready 로 곧바로 다시 끝나 공회전한다. 컨텍스트 압축 뒤 poll 이 떠 있는지 모르면 새로 띄운다. 겹쳐 떠도
  spawn 전 확인(「5. 팀원 spawn」 1번)이 같은 작업을 두 번 띄우지 않는다.
- 슬롯이 찬 동안에는 poll 이 떠 있지 않을 수 있으므로, 기상마다 시각을 보고 종료 시각이 지났으면
  poll exit 8 과 같이 처리한다.
- 일시 제외는 poll.sh 가 6주기(30분) 뒤 스스로 풀어 재발견을 유도한다. 팀장은 해제 시각을 따로 관리하지
  않는다. 풀린 id8 이 다시 발견되면 착수 판정을 다시 하고, 여전히 막히면 다시 일시 제외에 넣는다. poll 을
  다른 이유로 재기동하면 6주기 계산이 처음부터 다시 시작된다. 재검사가 늦어질 뿐 틀린 착수는 생기지 않는다.

### 2-2. 감시 루프

루프 교체는 TaskStop 이 아니라 세대 파일 `$(git rev-parse --git-path dflow-team.gen)` 로 한다. 파일은 한 줄
`<세대> <다음 TICK epoch 초>` 이다. 이유: 컨텍스트 압축으로 태스크 id 를 잃어도 루프가 겹쳐 같은 결과를 두 번
처리하지 않는다.

루프를 새로 띄울 때마다 팀장은 먼저 세대를 올린다.
```bash
GEN_FILE=$(git rev-parse --git-path dflow-team.gen); case "$GEN_FILE" in /*) ;; *) GEN_FILE="$PWD/$GEN_FILE" ;; esac
old=$(cut -d' ' -f1 "$GEN_FILE" 2>/dev/null); gen=$(( ${old:-0} + 1 ))
printf '%s %s\n' "$gen" '<다음 TICK epoch 초>' > "$GEN_FILE"; echo "GEN_FILE=$GEN_FILE gen=$gen"
```
다음 TICK 예정 시각은 시작과 `TICK` 기상 때만 지금+1800초로 새로 정하고, 그 밖의 교체에서는 세대 파일 둘째
칸 값을 그대로 쓴다. 이유: 루프를 자주 바꿔도 TICK 이 밀리지 않게 하고, 컨텍스트 압축 뒤에도 그 값을 되찾는다.

그리고 아래 루프를 `run_in_background` 로 띄운다. `set --` 에는 pane 의 진행 중 슬롯(`blocked` 포함)마다
`'<워크트리>/docs/tasks/<TSK>/.result|<처리한 체크섬 또는 ->'` 를 작은따옴표로 넣는다. 에이전트 팀이거나 진행
중 pane 슬롯이 없으면 `set --` 를 비운다(에이전트 팀은 완료 알림이 따로 온다). 경로에 공백이나 작은따옴표가
든 워크트리는 지원하지 않는다.
```bash
GEN_FILE='<세대 파일 절대경로>'; MY_GEN=<세대>; TICK_AT=<다음 TICK epoch 초>
set -- '<워크트리1>/docs/tasks/<TSK1>/.result|<체크섬1>' '<워크트리2>/docs/tasks/<TSK2>/.result|-'
while :; do
  [ "$(cut -d' ' -f1 "$GEN_FILE" 2>/dev/null)" = "$MY_GEN" ] || { echo STALE; exit 0; }
  hit=''
  for s in "$@"; do
    f=${s%%|*}; prev=${s#*|}
    [ -f "$f" ] || continue
    cur=$(head -n 1 "$f"); sum=$(printf '%s\n' "$cur" | cksum)
    [ "$sum" = "$prev" ] || hit="$hit $f"
  done
  [ -n "$hit" ] && { echo "RESULT_READY$hit"; exit 0; }
  [ "$(date +%s)" -ge "$TICK_AT" ] && { echo TICK; exit 0; }
  sleep 20
done
```
- **줄 전체를 비교한다.** status 만 비교하면 답을 받은 팀원이 다시 `blocked` 가 됐을 때 status 가 같아 깨어나지
  않는다. 줄에 따옴표가 든 질문이 올 수 있어 줄 대신 그 체크섬을 넘긴다.
- 팀장도 같은 방식으로 체크섬을 얻는다. 결과 줄을 읽을 때 한 번의 Bash 호출로 줄과 체크섬을 함께 얻고,
  처리한 줄의 체크섬을 슬롯 표에 적는다.
  ```bash
  l=$(head -n 1 '<경로>'); printf '%s\n' "$l"; printf '%s\n' "$l" | cksum
  ```
- 루프는 기동 즉시 넘겨받은 전체 경로를 한 번 전수 검사한 뒤 20초 간격으로 감시한다. 루프를 바꾸는 사이에
  도착한 `.result` 를 놓치지 않기 위해서다.
- 교체 시점: pane 은 진행 중 슬롯의 경로 집합이 바뀔 때와 루프가 끝나 있을 때, 에이전트 팀은 루프가 끝나
  있을 때 새로 띄운다. 컨텍스트 압축 뒤 루프가 떠 있는지 모르면 새로 띄운다. 옛 루프는 `STALE` 로 끝난다.

### 2-3. 기상마다 하는 일

`STALE` 을 뺀 모든 기상에서 이 순서로 한다. `STALE` 은 아무것도 하지 않고 넘긴다.
1. 재구성(「팀장 상태」).
2. 아래 표의 처리.
3. 승인 스윕(「4. 승인 스윕」). 이유: 팀장 체크아웃에는 팀원 작업의 state.json 이 없어 poll exit 9 가 팀원
   작업에 울리지 않는다. 승인 반영은 최대 30분(TICK) 늦어지지만 후속 착수를 막지 않는다. 서버 claim 게이트는
   선행의 승인과 stage 로 판정하고, main 미반영 선행은 워커가 스택 기점으로 받는다.
4. 빈 슬롯이 있고 차단기가 허락하면 대기 큐 앞에서 spawn 한다(「5. 팀원 spawn」).
5. 끝나 있는 감시 루프를 다시 띄우고, 재기동 조건이 맞으면 poll.sh 를 다시 띄운다.

| 기상 | 처리 |
|---|---|
| poll exit 0 (ready N줄) | 각 줄 `순번<TAB>id8<TAB>이름` 에서 id8 만 쓴다(순번 금지). 슬롯 표·영구 제외·일시 제외에 없는 id8 마다 아래 show 필터로 필요한 필드만 본다. `spec_empty` 가 참이거나 `ref` 가 비면 일시 제외에 넣고 사유(spec 부재·TSK 없음)를 보고하며 `team.result`(slot `-`, status `skipped`)를 남긴다. 남은 것은 대기 큐 끝에 넣는다. 대기 큐를 잃어도 그 작업들은 아직 ready 이므로 다음 poll 이 다시 찾는다 |
| poll exit 9 (승인 감지) | 따로 할 일이 없다. 3번 승인 스윕이 반영한다. 팀장 체크아웃에 state.json 이 있는 작업(사람이 수동으로 마감한 것)에만 온다 |
| poll exit 10 (반려 감지) | stdout `TSK<TAB>order-id<TAB>review_note` 마다 id8(order-id 앞 8자)을 "반려: 수동 `/dflow-dev <id8>` 대상 (<review_note>)" 로 보고하고 영구 제외에 넣는다. 재작업은 기존 agent 브랜치 위에서 해야 하므로 자동 배정하지 않는다. 같은 order 집합으로 exit 10 이 연달아 두 번 오면 poll 을 더 재기동하지 않고 "로컬 state.json 에 반려가 서 있어 poll 이 곧바로 exit 10 으로 끝난다. 새 ready 감시가 멈췄다. 푸는 법: 그 작업을 수동 `/dflow-dev <id8>` 로 재작업하거나 그 state.json 을 `phase=rejected` 로 고쳐 커밋한다" 를 한 번 보고한다. 그 뒤로는 `TICK` 마다 poll 을 한 번 재기동해 풀렸는지 본다. 이유: poll.sh 의 반려 감지는 `--exclude` 를 보지 않는다 |
| poll exit 8 (시한) | 새 배정을 멈추고 「7. 마감」 으로 간다 |
| poll exit 2·3·5·6·7 | 중단 사유(stderr)를 보고하고 「7. 마감」 으로 간다 |
| `RESULT_READY <경로…>` (pane) | 경로마다 「3. 결과 처리」 |
| 에이전트 팀 완료 알림 | 「3. 결과 처리」 |
| `TICK` | 다음 TICK 예정 시각을 지금+1800초로 새로 정한다. suspect 슬롯과 진행 슬롯의 생존 증거를 잰다(「3. 결과 처리」). 차단기가 걸려 있으면 시험 spawn 1건을 허용한다. 반려 때문에 poll 을 멈춰 두었으면 poll 을 한 번 재기동한다 |
| `STALE` | 무시한다 |
| 사람이 이 세션에 `blocked` 답을 줌 | 「6. blocked」 의 재spawn |

poll exit 0 의 show 필터(spec 본문을 컨텍스트에 싣지 않는다):
```bash
(set -a; . ./.env; set +a; .claude/skills/dflow-work/scripts/dflow.sh show <id8>) \
  | jq -c '{order: .order.id, ref: .order.item.external_ref, spec_empty: ((.order.item.spec // "") | length == 0)}'
```

## 3. 결과 처리

**결과 줄 찾기**
- pane: 감시 루프가 알린 경로의 `.result` 첫 줄이다.
- 에이전트 팀: 완료 알림의 이름 `w<slot>-<id8>` 에서 **id8 로** 슬롯 표를 찾는다. 슬롯 번호로 찾지 않는 이유:
  이미 판정한 옛 팀원의 늦은 알림이 같은 슬롯의 새 작업을 오판하게 만든다. 표에 없는 id8(이미 판정한 것)의
  알림은 집계만 갱신하고 슬롯을 건드리지 않는다. 표에 있으면 그 워크트리의 `docs/tasks/<TSK>/.result` 를
  읽는다(워크트리 경로는 재구성의 `.dflow-agent` 나 알림에서 얻는다). 워크트리가 이미 정리돼 파일이 없으면
  알림에 담긴 마지막 응답에서 `<TSK> <id8> ` 로 시작하는 줄을 찾는다.
- 에이전트 팀에서 두 곳 모두 결과 줄이 없으면 `failed` 가 아니라 **`suspect`** 로 표시하고 슬롯을 유지한다.
  팀원이 손자 서브에이전트를 기다리며 턴을 끝낸 것일 수 있기 때문이다. 그 뒤 매 `TICK` 에 생존 증거를 재고,
  **두 TICK 연속으로 변하지 않을 때만** `failed no-result` 로 판정한다. 그 사이에 `.result` 가 생기거나 알림이
  다시 오면 정상 처리한다.
- 줄 형식은 `<TSK> <id8> <branch|-> <head|-> <done_exit|-> <status> <사유…>` 다. 줄과 체크섬은 「2-2」 의 한
  줄 명령으로 함께 읽는다.

**생존 증거**: 아래 중 하나라도 직전 `TICK` 과 달라지면 살아 있는 것이다. 슬롯의 첫 `TICK` 은 기록만 한다.
```bash
git -C <워크트리> log -1 --format=%ct                                        # 워크트리가 있으면 HEAD 커밋 시각
git fetch origin && git log -1 --format=%ct 'origin/agent/<id8>-<slug>'   # 워크트리가 없으면 원격 tip 커밋 시각
(set -a; . ./.env; set +a; .claude/skills/dflow-work/scripts/dflow.sh show <id8>) | jq -r '[.reports[]?] | last | .created_at // empty'
git -C <워크트리> status --porcelain | cksum                                 # 미커밋 변경 목록
orca terminal read --screen --terminal <handle> | cksum                     # pane 이면 화면
```

**status 별 처리**: 모든 결과를 `team.result`(slot, id8, status)로 기록하고 집계에 넣는다. status 는 구분
사유가 있으면 `failed rate-limit` 처럼 붙인다(events.md).

| status | 슬롯 | 제외 | 워크트리 | 그 밖 |
|---|---|---|---|---|
| `done` | 해제 | 없음 | 「고아 정리 규칙」 을 맞추면(깨끗하고 HEAD 가 `origin/<agent 브랜치>` 와 같으면) 그 자리에서 정리한다. 아니면 경로를 보고하고 남긴다 | 대기 큐가 있으면 그 슬롯에 spawn 한다. 비어 있으면 poll 재기동 조건을 따른다 |
| `needs-merge` | 해제 | 없음 | `done` 과 같다 | 이번 기상의 승인 스윕이 곧바로 반영한다 |
| `skipped` | 해제 | 일시 제외 | branch 가 `-` 면 비교 없이 정리한다(에이전트 팀은 `--force`). 아니면 「고아 정리 규칙」 | 사유 보고 |
| `blocked` | pane 은 유지, 에이전트 팀은 해제 | 진행 중으로 영구 제외 | pane 은 그대로 둔다. 에이전트 팀은 재spawn 직전에 정리한다 | 「6. blocked」 |
| `failed <사유>` | 해제 | 영구 제외 | 「고아 정리 규칙」 | 사유 보고, 차단기 계산 |
| `failed rate-limit` | 해제 | 제외하지 않는다 | 「고아 정리 규칙」 | 재시도할 수 있다. 아직 ready 면 poll 이 다시 찾고, 이미 claimed 면 "재개 필요" 로 보고한다. 차단기 계산에 넣는다 |
| `failed no-result`(suspect 판정) | 해제 | 영구 제외 | 「고아 정리 규칙」 | 차단기 계산 |
| `failed not-isolated` | 해제 | 영구 제외 | 없음(워커가 파일을 쓰지 않았다) | 백엔드 결함이므로 새 spawn 을 멈추고 「7. 마감」 으로 간다 |

- **그 자리에서 정리하는 이유**: git 은 다른 워크트리가 체크아웃한 브랜치를 지우지 못한다. 워크트리를 마감까지
  남기면 같은 세션에서 승인된 작업의 로컬 agent 브랜치 삭제가 실패한다.
- **회수**: 에이전트 팀에서는 결과 줄을 처리한 직후(status 와 무관하며 `blocked` 도 포함한다)
  `TaskStop(w<slot>-<id8>)` 으로 idle 팀원을 회수한다. 이름 붙은 에이전트는 일을 마쳐도 idle 로 남기 때문이다.
  pane 팀원은 별도 프로세스라서 TaskStop 대상이 아니다.
- **차단기**: 결과가 도착한 순서로 `failed`(`no-result`·`rate-limit` 포함)가 연속 2건이면 새 spawn 을 멈추고
  보고한다. `failed` 가 아닌 결과가 오면 연속 수를 0 으로 되돌린다. 걸린 동안에는 poll 을 재기동하지 않고
  `TICK` 마다 1건만 시험 spawn 한다. 시험 대상은 대기 큐 맨 앞이며, 큐가 비었으면 poll 을 한 번 띄워 그
  결과에서 1건만 고른다. 시험 결과가 `failed` 가 아니면 차단기를 푼다. 이유: 사용량 한도나 환경 결함에 걸린
  채 대기 큐 전체를 소진하지 않게 한다.
- **무응답**: 결과도 알림도 없는 진행 슬롯(`blocked` 제외)의 생존 증거가 한 `TICK` 동안 변하지 않으면
  "무응답" 으로 보고만 하고 슬롯을 유지한다. 느린 팀원을 죽이면 미커밋분을 잃고, 권한 확인에 걸려 멈춘
  팀원은 사람이 보면 풀리기 때문이다. 자동 정리는 **두 TICK 연속으로** 생존 증거가 없을 때만 한다. 에이전트
  팀은 먼저 `TaskStop` 으로 팀원을 멈추고 슬롯을 해제하며, 워크트리는 「고아 정리 규칙」 을 따른다. pane 은
  팀원 프로세스를 멈출 수단이 워크트리 삭제뿐이므로, 깨끗하고 push 된 경우에만 `orca worktree rm` 으로
  정리하고 슬롯을 해제한다. 그렇지 않으면 슬롯을 계속 잡고 "사람 확인 필요" 로 보고한다. 자동 정리한 작업은
  영구 제외에 넣고 "재개 필요" 로 보고한다.

## 4. 승인 스윕

Skill 도구로 `/dflow-merge` 를 **인자 없이** 실행한다. 후보가 원격 `origin/agent/*` tip 에서도 오므로 팀장
체크아웃의 state.json 유무와 무관하게 팀원 작업을 잡는다. 판정은 서버 `show` 로만 하고 approved 만 조상 먼저
`--no-ff` 로 머지한다.
- 보고의 반려 목록 id8 은 poll exit 10 행과 똑같이 처리한다(보고, 영구 제외).
- "건너뜀(조회 실패)" 는 다른 D'Flow 인스턴스의 주문일 수 있으므로 보고만 한다.
- 다중 경합: 두 팀장의 스윕이 같은 브랜치를 머지하려 하면 나중 쪽 `git push` 가 non-fast-forward 로 거부된다.
  그러면 `git pull --ff-only` 뒤 후보를 다시 식별한다. 이미 머지된 것은 빠진다.
- 로컬 agent 브랜치 삭제가 다른 워크트리에 잡혀 실패하면 `/dflow-merge` 가 건너뛰고 보고한다. 그 워크트리는
  결과 처리나 고아 스캔이 정리한다.
- `team.sweep`(merged, waiting, rejected 개수)을 기록한다.
- 스윕은 팀장 체크아웃을 기본 브랜치로 switch 한다. 팀원은 각자 워크트리의 agent 브랜치나 detached HEAD 에
  있으므로 충돌하지 않는다.

## 5. 팀원 spawn

1. 그 id8 이 재구성한 슬롯 표에 있으면 띄우지 않는다. poll 이 겹쳐 떠서 같은 ready 를 두 번 돌려줘도 한 번만
   띄우기 위해서다.
2. 슬롯 번호를 정하고(「팀장 상태」 의 발급 규칙) `AGENT_ID=<신원>/w<slot>` 을 만든다.
3. TSK 는 show 필터의 `ref`(`.order.item.external_ref`)에서 마지막 `/` 뒤, order 는 `.order.id` 다.
4. 포인터 **한 줄**을 만든다. `{MAIN_CHECKOUT}` 은 팀장 체크아웃 절대경로다.
   ```
   <MAIN_CHECKOUT>/.claude/skills/dflow-team/references/worker-prompt.md 를 읽고 그 규칙대로 실행하라. TSK=<TSK> ID8=<id8> AGENT_ID=<신원>/w<slot> MAIN_CHECKOUT=<MAIN_CHECKOUT> BACKEND=<pane|agent-team> MODEL=<opus|sonnet|default>
   ```
   - 워커 프롬프트 전문이 아니라 포인터를 넘기는 이유: 전문을 셸 인자로 넘기면 백틱·따옴표·여러 줄이 섞여
     깨진다.
   - 경로를 절대경로로 주는 이유: 새 워크트리에 스킬이 없을 수 있다.
   - 모델은 공백이 든 `--model opus` 가 아니라 `MODEL=` 로 넘기고, 워커가 `{MODEL_FLAG}` 로 바꾼다.
   - 에이전트 팀 `blocked` 재spawn 때만 둘째 줄에 `ANSWER=<답 한 줄>` 을 붙인다(「6. blocked」).
5. backends.md 의 해당 절 명령 그대로 띄운다.
   - pane(Orca): `orca worktree create --name dflow-<id8> --agent claude --no-parent --base-branch origin/<기본브랜치> --prompt '<포인터 한 줄>' --json`.
     결과 JSON 의 `result.worktree.path`·`result.agentTerminalHandle`·워크트리 id 를 슬롯 표에 적는다.
   - 에이전트 팀: Agent 도구, `isolation: "worktree"` **필수**, `name` 은 `w<slot>-<id8>`, `subagent_type` 은
     `general-purpose`, `model` 은 인자로 받은 모델. 팀장이 따로 기점을 정하지 않는다. 워커 부트스트랩이
     `origin/<기본브랜치>` 로 detach 하고, 스택 기점은 `/dflow-dev` Phase 0 2번이 claim 전에 맞춘다.
6. spawn 직후 `team.spawn`(slot, id8, worktree, handle, 기본 필드 tsk·order)을 기록한다. 워크트리 경로를 아직
   모르면 `worktree` 는 `-` 이고, `handle` 은 Orca 터미널 핸들 또는 에이전트 이름이다. id8 을 영구 제외(진행
   중)에 넣는다.

같은 작업을 다시 띄우는 일은 없다. 예외는 에이전트 팀의 `blocked` 재spawn 하나이며, 그 밖의 재개는 사람 몫이다.

## 6. blocked

**공통**: 사람에게 AskUserQuestion 으로 묻지 않는다(자동 루프). `team.result`(status `blocked`)와
`team.blocked`(slot, id8)를 기록한다. PushNotification 도구가 있으면(지연 로드면 ToolSearch 로 불러) 질문
요약으로 한 번 알린다. 없으면 화면 통지만 한다. 그 id8 은 진행 중으로 영구 제외에 남긴다.

**pane**: "결정 필요 <id8>: <질문>. Orca 의 `dflow-<id8>` 탭에서 답하라" 고 알린다.
**그 슬롯은 blocked 팀원이 계속 잡으며 다른 작업에 재배정하지 않는다.** 살아 있는 프로세스 둘이 같은
`AGENT_ID` 를 쓰면 좌석표가 한 인물을 두 책상에 그리기 때문이다. 사람이 탭에서 답하면 팀원이 같은 워크트리·브랜치에서 이어 가고, `.result`
가 새 줄로 바뀌면 감시 루프가 알린다.

**에이전트 팀**: 결과 처리 직후 `TaskStop(w<slot>-<id8>)` 으로 회수하고 슬롯을 해제한다. "결정 필요 <id8>:
<질문>. 이 세션에 답을 달라" 고 알린다. 팀원이 이미 끝났으므로 슬롯을 비워도 `AGENT_ID` 가 겹치지 않는다.

**재spawn(에이전트 팀)**: 사람이 이 세션에서 답을 주면 아래를 한다.
1. 옛 워크트리가 아직 있으면 backends.md 「고아 정리 규칙」 대로 먼저 정리한다. 그 워크트리가 agent 브랜치를
   잡고 있으면 새 워크트리의 switch 가 `already checked out` 으로 실패하기 때문이다. 정리 조건을 못 맞추면
   재spawn 하지 않고 경로를 보고한다.
2. 포인터 끝에 줄을 바꿔 `ANSWER=<답 한 줄>` 을 붙여 「5. 팀원 spawn」 으로 띄운다. 재claim 은 없다(이미
   claimed 다). 워커는 detach 대신 기존 agent 브랜치로 switch 한다. 빈 슬롯이 없으면 대기 큐 맨 앞에 두고,
   대기 큐는 재구성하지 않으므로 답을 받아 두었다는 사실을 보고에 남긴다.

## 7. 마감

poll exit 8, poll 오류 exit, `failed not-isolated`, 기상 때 확인한 종료 시각 경과로 온다.
1. 새 spawn 을 멈춘다. 대기 큐는 보고만 하고 비운다. 진행 중 팀원(pane `blocked` 슬롯 제외)의 결과를 모두
   받는다. pane `blocked` 는 사람의 답을 언제 받을지 모르므로 기다리지 않는다. 기다리는 동안에도 「2-3」 의
   일은 spawn 만 빼고 그대로 한다.
2. 마지막 승인 스윕을 한 번 돈다.
3. 집계 표(TSK · id8 · 브랜치 · head · done exit · status · 사유)를 보고한다. 대기 큐·pane `blocked` 슬롯·
   "재개 필요" 도 함께 적는다.
4. 남은 팀원 워크트리를 backends.md 대로 정리한다. Orca 는 `orca worktree rm --worktree "<id>"`, 에이전트 팀은
   워크트리가 아직 있을 때만 `git worktree remove --force <경로>` 다. 두 경우 모두 「고아 정리 규칙」 을 따라
   깨끗하고 HEAD 가 `origin/<agent 브랜치>` 와 같을 때만 지우고 나머지는 경로를 보고한다.
   **pane 의 `blocked` 워크트리는 조건과 무관하게 지우지 않는다.** 팀원이 탭에서 답을 기다리고 있기 때문이다.
5. **agent 브랜치는 남긴다.** 승인은 사람이 D'Flow 웹에서 하고, 승인 뒤 머지는 다음 `/dflow-team` 의 스윕이나
   `/dflow-merge` 가 한다.
6. poll 이 떠 있으면 TaskStop 으로 멈추고(태스크 id 를 모르면 종료 시각에 스스로 끝난다), 세대 파일의 세대를
   올려 감시 루프를 끝낸다. `team.stop` 을 기록한다.

## 좌석표 연동

- 팀원의 좌석 식별은 워커가 쓰는 워크트리 루트 `.dflow-agent`(`<신원>/w<slot>`)다. 좌석표 S1 의 훅이 이 파일을
  `heartbeat_agent` 로 읽는다.
- 좌석표 STANDBY 신호: 서버 계약이 생기면 팀장이 「1. 시작」 5번, poll 재기동, 「7. 마감」 에서
  `{host, agent: lead, slots, busy, until}` 을 보낸다. 그 전에는 `team.start`·`team.stop` 이 대신한다.

## 금지

- AskUserQuestion. 판단이 필요하면 보고하고 사람의 답을 기다린다.
- 팀장이 작업을 claim·progress·done 하는 것. 서버 쓰기는 팀원 몫이다(스윕의 머지만 팀장이 한다).
- `isolation` 없는 에이전트 팀 spawn. 팀원을 `name`·`isolation` 없는 단순 서브에이전트로 띄우는 것.
- 팀원 워크트리에서 팀장이 git 을 조작하는 것(읽기 조회와 backends.md 의 정리 절차는 예외).
- 순번 참조, force push, 훅 우회(SKIP_GUARD).
- 같은 작업의 재spawn. 예외는 에이전트 팀 `blocked` 재spawn 하나다.
- 셸 `&` 백그라운드. 백그라운드는 Bash `run_in_background` 로만 띄운다.
- 인원 4 초과.
````

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run tests/skills`
Expected: PASS 50건(Task 1 9 + Task 2 7 + dflow-team 34).

- [ ] **Step 5: 커밋**

```bash
git add .claude/skills/dflow-team/SKILL.md tests/skills/dflow-team.test.ts
git commit -m "feat(dflow-team): 팀장 절차: 매 기상 재구성·세대 파일 감시 루프·슬롯 보충·blocked 백엔드별 처리

몇 시간 도는 팀장은 컨텍스트 압축으로 슬롯 표를 잃으므로 메모리를 캐시로 보고 매 기상마다
워크트리·.result·events.jsonl 에서 다시 만든다. 팀원 작업은 팀장 체크아웃에 state.json 이 없어
poll exit 9 가 울리지 않으므로 기상마다 스윕하고 30분 TICK 으로 한가한 구간도 깨운다. 결과 줄 없는
완료 알림은 suspect 로 두고, 연속 실패는 차단기로 막아 사용량 한도에서 대기 큐를 소진하지 않는다."
```

---

### Task 6: 킷 배포 목록·설치 안내·가이드 (머지 없음)

**Files:**
- Modify: `scripts/kit-build.sh:12`
- Modify: `kit/install.sh:48`
- Modify: `kit/README.md` (4행, 스킬 표)
- Modify: `docs/agent/claude-skill/dflow-skills-guide.md` (3행, 한눈에 보기 표, dflow-merge 「알아둘 것」, `## 자주 겪는 상황` 앞)
- Modify: `tests/skills/dflow-team.test.ts`

**Interfaces:**
- Consumes: 완성된 `.claude/skills/dflow-team/`(Task 3~5), `/dflow-merge` 후보 확대(Task 2).
- Produces: dflow-kit 빌드에 dflow-team 포함, 가이드의 사용 안내와 인자 없는 `/dflow-merge` 후보 확대 공지(스펙 §6-4). 이 Task 는 머지하지 않는다. 머지는 리허설 뒤 Task 10 이다.

- [ ] **Step 1: 테스트 추가** (`tests/skills/dflow-team.test.ts` 끝에)

```ts
describe('dflow-team 배포(스펙 §10)와 가이드', () => {
  it('kit-build.sh 배포 목록에 dflow-team 이 있다', () => {
    const kit = readFileSync(join(ROOT, 'scripts/kit-build.sh'), 'utf8')
    expect(kit).toMatch(/^SKILLS=".*\bdflow-team\b.*"$/m)
  })

  it('install.sh 안내와 킷 README 표에 dflow-team 이 있다', () => {
    expect(readFileSync(join(ROOT, 'kit/install.sh'), 'utf8')).toMatch(/설치 완료: .*dflow-team/)
    expect(readFileSync(join(ROOT, 'kit/README.md'), 'utf8')).toMatch(/^\| dflow-team \|/m)
  })

  it('가이드에 dflow-team 절과 인자 없는 /dflow-merge 후보 확대 공지가 있다', () => {
    const g = readFileSync(join(ROOT, 'docs/agent/claude-skill/dflow-skills-guide.md'), 'utf8')
    expect(g).toContain('## dflow-team: 위임한 작업 여러 건을 동시에')
    expect(g).toContain('인자 없이 부르면 원격 `origin/agent/*` 브랜치까지 후보로 본다')
    expect(g).not.toContain('--team-size')
  })
})
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run tests/skills/dflow-team.test.ts`
Expected: 새 describe 3건 FAIL, 기존 34건 PASS.

- [ ] **Step 3: 네 파일 수정**

(1) `scripts/kit-build.sh` 12행을 아래로 바꾼다.
```sh
SKILLS="dflow-work dflow-dev dflow-poll dflow-merge dflow-team dflow-export dflow-wbs-nlevel"
```

(2) `kit/install.sh` 48행을 아래로 바꾼다.
```sh
설치 완료: $TARGET/.claude/skills/ (dflow-work · dflow-dev · dflow-poll · dflow-merge · dflow-team · dflow-export · dflow-wbs-nlevel)
```

(3) `kit/README.md`
- 4행의 스킬 나열 `` `/dflow-dev`, `/dflow-poll`, `/dflow-merge`, `` 뒤에 `` `/dflow-team`, `` 을 넣는다.
- 스킬 표의 `| dflow-merge |` 행 뒤에 한 행을 넣는다.
```markdown
| dflow-team | 팀장. 에이전트 위임 작업을 슬롯 N개 팀원(Orca pane 또는 에이전트 팀)에게 나눠 동시에 개발시킨다. 낮 시간 supervised |
```

(4) `docs/agent/claude-skill/dflow-skills-guide.md`
- 3행 `스킬 7종의 사용자 안내서` 를 `스킬 8종의 사용자 안내서` 로 바꾼다.
- 「한눈에 보기」 표의 `| 위임해 둔 작업들을 알아서 처리하게 두고 싶다 |` 행 뒤에 한 행을 넣는다.
```markdown
| 위임한 작업 여러 건을 동시에 돌리고 싶다 | "/dflow-team 18:00" | dflow-team |
```
- dflow-merge 절 「알아둘 것」 의 마지막 항목(`선행이 미승인이면 후행도 그 차례엔 안 합친다.`) 뒤에 한 항목을 넣는다.
```markdown
- 인자 없이 부르면 원격 `origin/agent/*` 브랜치까지 후보로 본다. 다른 PC·세션·팀원이 push 한 작업도
  서버에서 approved 면 반영되고, 승인 대기·반려·조회 실패는 보고만 한다.
```
- `## 자주 겪는 상황` 줄 바로 앞에 아래 블록을 넣는다(끝의 `---` 포함).
````markdown
## dflow-team: 위임한 작업 여러 건을 동시에

**무엇**: `/dflow-poll` 과 같은 감시를 하면서, ready 가 된 위임 작업을 슬롯 N개의 팀원에게 나눠 동시에
개발시키고 끝난 슬롯에 다음 작업을 채운다. 팀원은 각자 워크트리에서 `/dflow-dev` 를 돈다.

**언제**: 자리에 있는 낮 시간에 위임 작업이 여러 건 쌓였을 때. 종료 시각이 필수라서 무인 야간 실행은 안 된다.

**사용 예**

> **나**: /dflow-team 2명 18:00
> **Claude**: 백엔드 Orca, 신원 hong, 팀원은 권한 확인 생략 모드로 뜬다. 승인 스윕: 머지 0, 대기 1. 감시 시작.
> **Claude**: ab12cd34 로그인 화면 → w1 착수, 9f8e7d6c 설비 목록 → w2 착수.
> **Claude**: w1 done(승인 대기로 보고). 대기 중이던 5a4b3c2d → w1 착수.
> **Claude**: 결정 필요 5a4b3c2d: "권한 없는 사용자에게 버튼을 숨길까요, 비활성으로 둘까요?" dflow-5a4b3c2d 탭에서 답하세요.

**알아둘 것**
- 인원은 기본 3, 최대 4 다. 모델을 붙이면(`/dflow-team 18:00 opus`) 팀원이 그 모델로 돈다.
- Orca 에서 띄우면 팀원마다 탭이 생긴다. 일반 터미널·tmux 에서는 에이전트 팀으로 뜨고, 질문은 팀장 세션으로
  모인다. "5a4b3c2d 는 숨김으로" 처럼 답하면 된다.
- 팀장 세션을 닫으면 에이전트 팀 팀원도 함께 멈춘다(push 한 곳까지는 남는다). 오래 돌릴 때는 Orca 가 안전하다.
- 특정 작업을 빼려면 D'Flow 에서 그 작업의 `agent` 태그를 끈다.
- 승인은 여전히 D'Flow 웹에서 사람이 한다. 팀장은 깨어날 때마다(최대 30분 간격) 승인된 작업을 main 에 반영한다.

---

````

- [ ] **Step 4: 통과 확인과 킷 빌드 검증**

Run: `npx vitest run tests/skills && sh scripts/kit-build.sh "$(mktemp -d)"`
Expected: vitest PASS 53건. kit-build 는 `빌드 완료:` 와 `skills: … dflow-team …` 를 출력한다. "킷 밖 참조가 남아 있다" 가 나오면 SKILL.md 의 설계 정본 문구가 허용 표현 `wbs-web 리포 docs/superpowers` 를 벗어난 것이다.

- [ ] **Step 5: 커밋**

```bash
git add scripts/kit-build.sh kit/install.sh kit/README.md docs/agent/claude-skill/dflow-skills-guide.md tests/skills/dflow-team.test.ts
git commit -m "chore(kit): dflow-team 을 킷 배포 목록·설치 안내·가이드에 추가

다른 dflow-* 와 같이 dflow-kit 으로 배포한다. 가이드에는 백엔드별로 질문이 어디로 오는지와
에이전트 팀은 팀장과 함께 멈춘다는 점을 적고, 인자 없는 /dflow-merge 의 후보가 원격 agent
브랜치까지 넓어졌다는 것을 공지한다(approved 만 머지하므로 미승인 커밋은 섞이지 않는다)."
```

---

### Task 7: 리허설 준비와 A0 단독 실측 (사람이 대화형 세션에서 수행)

**Files:**
- Create (staging, 메인 체크아웃): `docs/superpowers/plans/2026-09-10-dflow-team-rehearsal.md`
- Modify (staging, 메인 체크아웃): `docs/superpowers/specs/2026-09-10-dflow-team-design.md` (§3-8 사실)
- 리허설 리포(커밋하지 않음): `~/project/mes-base-rehearsal`

**Interfaces:**
- Consumes: `<FEAT_WT>` 의 `.claude/skills/dflow-*`(Task 1~6, 머지 전).
- Produces: 리허설 리포(Task 8·9 가 쓴다), A0 (a)(b)(c) 판정. (a) 에서 결과 줄 없는 알림이 실제로 생기면 `suspect` 방어가 필수임이 확정되고, (c) 가 되면 후속 "SendMessage 기반 blocked 재개" 의 근거가 된다.

- [ ] **Step 1: 리허설 리포 준비** (스펙 §11-2). 사용 중인 mes-base 대신 새 클론과 스테이징 D'Flow 를 쓴다. 이유: 사용 중인 체크아웃에는 심사 중인 브랜치와 미커밋 state.json 이 있어 전제 검사와 합격 판정이 섞인다.

```bash
git clone "$(git -C ~/project/mes-base remote get-url origin)" ~/project/mes-base-rehearsal
cd ~/project/mes-base-rehearsal
git symbolic-ref --short refs/remotes/origin/HEAD        # 기본 브랜치 확인(예: origin/main)
git branch --show-current && git status --porcelain      # 기본 브랜치이고 출력이 비어 있어야 한다
mkdir -p .claude/skills
for s in dflow-work dflow-dev dflow-poll dflow-merge dflow-team; do ln -s "<FEAT_WT>/.claude/skills/$s" ".claude/skills/$s"; done
cp "<FEAT_WT>/kit/.env.example" .env                     # 값은 사람이 스테이징 PAT·API·프로젝트로 채운다
git check-ignore -q .env || printf '/.env\n' >> "$(git rev-parse --git-path info/exclude)"
(set -a; . ./.env; set +a; .claude/skills/dflow-work/scripts/dflow.sh doctor && .claude/skills/dflow-work/scripts/dflow.sh me)
```
- 심링크는 `feat/dflow-team` 워크트리의 스킬을 가리킨다. 머지 전 수정본으로 리허설하기 위해서다.
- `.gitignore` 는 고치지 않는다. 팀장 전제 검사가 공유 `info/exclude` 에 `/.claude/skills` 를 넣는다. 이 배포
  형태는 mes-runlog 와 같아서 "새 워크트리에 스킬이 없다" 경로를 리허설이 그대로 밟는다.
- 클론의 origin 은 실제 mes-base 원격이다. 리허설 작업은 **승인하지 않는다.** 승인하면 스윕이 리허설 코드를
  실제 main 에 머지한다.

- [ ] **Step 2: 판정 파일을 만든다** (메인 체크아웃 `/Users/jji/project/wbs-web`, staging)

````markdown
# /dflow-team 리허설 판정

스펙 §11 합격 기준의 판정표다. 확인된 사실은 스펙 §3·§8 에 사실로 옮기고, 이 파일에는 판정과 관찰만 둔다.
리허설 리포: `~/project/mes-base-rehearsal`(mes-base 새 클론), D'Flow: 스테이징, 스킬: `feat/dflow-team` 워크트리 심링크.

## A0: 에이전트 팀 완료 알림 (스펙 §11-3)

| 항목 | 판정 | 관찰 |
|---|---|---|
| (a) 손자 실행 중 팀장에게 완료 알림이 오는가 | | |
| (b) blocked 로 끝난 팀원이 idle 로 남는가 | | |
| (c) idle 팀원에게 SendMessage 로 답하면 같은 워크트리에서 이어 가는가 | | |
````

- [ ] **Step 3: A0 실행** (스펙 §11-3). 팀장 루프 없이, 일반 터미널에서 리허설 리포 루트에 `claude` 를 띄우고(기본 권한 모드) 세션에 아래를 지시한다.

```
Agent 도구로 name "a0-probe", isolation "worktree", subagent_type "general-purpose" 인 팀원 하나를 띄워라. 팀원 프롬프트:
1) command -v git 으로 git 절대경로를 얻고, 그 경로로 rev-parse --show-toplevel 을 출력한다.
2) Agent 도구로 name "a0-child" 인 손자를 띄워 Bash 로 sleep 180 을 실행한 뒤 CHILD_DONE 을 출력하게 하고, 그 결과를 받는다.
3) 결과를 받은 뒤 마지막 응답으로 "A0 blocked 질문: (A) 또는 (B)?" 한 줄만 출력하고 끝낸다.
완료 알림이 오면 도착 시각과 알림 본문을 그대로 보여 줘라.
```
- (a): 팀원을 띄운 시각과 첫 완료 알림 시각을 적는다. 180초가 지나기 전에, 또는 `CHILD_DONE` 없이 알림이
  오면 "결과 줄 없는 알림이 생긴다" 로 판정한다.
- (b): 알림 뒤 `TaskStop` 을 부르기 전에 `a0-probe` 가 에이전트 목록에 남아 있는지 본다.
- (c): `SendMessage(to: "a0-probe")` 로 "답: A. rev-parse --show-toplevel 을 다시 출력하라" 를 보내고, 1) 과
  같은 경로가 나오는지 본다.
- 끝나면 `TaskStop("a0-probe")`, 격리 워크트리가 남았으면 `git worktree remove --force <경로>`.

- [ ] **Step 4: 기록과 커밋** (메인 체크아웃, staging). 판정표를 채우고, 스펙 §3-8 의 "실측하지 않았다" 문장을
  A0 결과 사실로 바꾼다(날짜·경위 없이, 예: "팀원이 손자를 기다리며 턴을 끝내면 결과 줄 없는 완료 알림이 온다").
  (c) 가 되면 스펙 §12 후속의 "SendMessage 기반 blocked 재개" 에 근거 한 줄을 붙인다.

```bash
cd /Users/jji/project/wbs-web
git add docs/superpowers/plans/2026-09-10-dflow-team-rehearsal.md docs/superpowers/specs/2026-09-10-dflow-team-design.md
git commit -m "docs(dflow-team): A0 실측: 에이전트 팀 완료 알림·idle·SendMessage 재개 판정

suspect 방어와 TaskStop 회수가 실제로 필요한지를 팀장 루프 전에 단독으로 확인했다."
```
이어서 Global Constraints 「staging 문서 push」 를 한다. Step 2 의 판정 파일 생성도 이 커밋에 함께 담는다.

---

### Task 8: Orca 백엔드 리허설 (사람이 대화형 세션에서 수행)

**Files:**
- Modify (staging, 메인 체크아웃): `docs/superpowers/plans/2026-09-10-dflow-team-rehearsal.md` (Orca 절), `docs/superpowers/specs/2026-09-10-dflow-team-design.md` (§3-5 id 경로 사실)
- 조건부 Modify (feat 워크트리): 실패 원인이 스킬 문서에 있을 때 해당 파일과 대응 테스트

**Interfaces:**
- Consumes: Task 7 의 리허설 리포, Task 1~6 의 스킬.
- Produces: 스펙 §11-4 합격 기준 11항 판정, `orca worktree create --json` 의 워크트리 id JSON 경로(backends.md 에 반영).

- [ ] **Step 1: 작업 준비**: 스테이징 D'Flow 의 리허설 프로젝트에 `agent` 태그가 붙고 나에게 배정된 독립 ready 작업 3건을 만든다. 그중 1건의 spec 에는 담당자 결정이 필요한 분기를 일부러 남긴다(예: "권한 없는 사용자에게 버튼을 숨길지 비활성화할지는 정하지 않았다").

- [ ] **Step 2: 실행**: Orca 에서 리허설 리포를 열고 그 터미널의 Claude 세션에서 `/dflow-team 2명 <지금부터 2시간 뒤 HH:MM>`. 시작 보고의 백엔드가 "pane(Orca)" 이고 권한 안내가 "팀원은 권한 확인 생략 모드로 뜬다" 인지 본다.

- [ ] **Step 3: 합격 기준 11항 판정과 추가 관찰 1항** (스펙 §11-4). 각 항목을 실제 명령으로 확인한다.
  1. 첫 poll 에서 2건이 각자 `orca worktree create --agent claude` 로 spawn 되고, 3번째는 대기 큐에 들어갔다가 먼저 빈 슬롯에 자동 배정된다(팀장 보고와 `~/.dflow/events.jsonl`).
  2. `git -C ~/project/mes-base-rehearsal branch -r --list 'origin/agent/*'` 에 리허설 브랜치 3개가 있고, 각 tip 의 state.json 이 `reported` 다(`git show origin/agent/<id8>-<slug>:docs/tasks/<TSK>/state.json | jq -r .phase`).
  3. 실행 전후 `git -C ~/project/mes-base-rehearsal branch --show-current` 와 `git status --porcelain` 이 같다(스윕으로 기본 브랜치가 된 것은 정상).
  4. `dflow.sh show <id8>` 3건이 각자 reported(`done` 기록)이고, 다른 주문은 바뀌지 않았다.
  5. 결정 분기 작업이 `blocked` 로 그 팀원 탭에서 멈추고, 사람이 그 탭에서 답하면 같은 워크트리·브랜치에서 이어 가 `done` 한다. 그동안 그 슬롯은 재배정되지 않는다.
  6. done 처리 때 팀원 워크트리가 그 자리에서 `orca worktree rm` 으로 정리되고 agent 브랜치 3개는 원격에 남는다. 특히 워크트리가 `agent/<id8>-<slug>` 로 switch 된 상태에서 `orca worktree rm` 이 깨끗이 도는지 확인한다.
  7. `/dflow-team` 을 다시 돌리면 승인 스윕이 리허설 원격 브랜치 3개를 후보로 잡는다(승인 전이므로 "승인 대기"). 원격에 이미 있던 운영 주문의 agent 브랜치는 스테이징 PAT 로 조회되지 않아 "건너뜀(조회 실패)" 로 보고된다.
  8. `~/.dflow/events.jsonl` 에 `team.start` → `team.spawn`×2 → `team.result` → `team.spawn`(3번째) → `team.blocked` → … → `team.stop` 순서가 남고, `team.spawn` 에 `id8`·`worktree`·`handle` 이 있다. 각 워크트리 루트 `.dflow-agent` 가 `<신원>/w1`·`<신원>/w2` 이고, 3번째 작업의 `.dflow-agent` 는 먼저 빈 슬롯의 값과 같다.
  9. 각 팀원 워크트리의 `docs/tasks/<TSK>/.result` 한 줄의 status 가 서버·브랜치 상태와 맞는다.
  10. 확인 항목: `orca worktree create --json` 결과에서 워크트리 id 의 JSON 경로, 워커가 `/dflow-dev` 를 Skill 도구로 불렀는지 SKILL.md 직접 읽기 폴백을 탔는지.
  11. 팀원이 도는 동안 팀장 세션에서 `/compact` 를 한 번 실행한 뒤에도 다음 기상에서 슬롯 표가 재구성되고(팀장 보고의 슬롯 목록), 같은 결과가 한 번만 처리된다(`team.result` 가 id8 마다 한 번).
  12. 추가 관찰: `orca terminal read --screen --terminal <handle> | cksum` 이 팀원이 멈춰 있어도 매 읽기마다 달라지는지(스피너·시계 갱신) 본다. 달라지면 화면은 생존 증거로 쓸 수 없으므로, SKILL.md 「3. 결과 처리」 의 생존 증거에서 화면 줄을 빼고(pane 무응답 판정은 브랜치 tip·서버 progress·미커밋 목록으로만 한다) 판정 파일에 사실로 적는다. 이 수정은 Step 4 의 절차(파일 수정·테스트·커밋)를 따른다.

- [ ] **Step 4: 실패 시**: 팀원 transcript(`orca terminal read --screen --terminal <handle>`)와 `dflow.sh show` 로 원인을 확정한다. 원인이 스킬 문서에 있으면 `<FEAT_WT>` 에서 해당 파일을 고치고, 그 동작을 잡는 단언을 해당 테스트에 더한 뒤 `npx vitest run tests/skills` 가 초록인지 보고 커밋한다(파일명 명시). 서버 쓰기 오류가 있었으면 스테이징에서 그 주문을 release 해 되돌린다. 고친 뒤 실패 항목을 다시 판정한다.

- [ ] **Step 5: id 경로 반영** (feat 워크트리): 10번에서 확인한 워크트리 id 의 JSON 경로(예 `result.worktree.id`)로 backends.md 「pane(Orca)」 의 "워크트리 id 의 JSON 경로는 리허설에서 확정한다. 확정 전에는 … 다시 찾는다." 두 문장을 "워크트리 id 는 결과 JSON 의 `<확인한 경로>` 다." 한 문장으로 바꾼다. Task 4 테스트의 `expect(b()).toContain('워크트리 id 의 JSON 경로는 리허설에서 확정한다')` 를 `expect(b()).toContain('워크트리 id 는 결과 JSON 의 `<확인한 경로>` 다')` 로 바꾼다.

```bash
npx vitest run tests/skills
git add .claude/skills/dflow-team/references/backends.md tests/skills/dflow-team.test.ts
git commit -m "docs(dflow-team): Orca 워크트리 id 의 JSON 경로를 리허설 실측값으로 고정"
```

- [ ] **Step 6: 기록과 정리**: 판정 파일에 `## Orca (스펙 §11-4)` 표(항목 1~12 · 판정 · 관찰)를 더하고, 스펙 §3-5 의 "워크트리 id 가 결과 JSON 의 어느 경로에 있는지는 아직 확인하지 않았다" 를 확인한 경로 사실로 바꾼다. 리허설 agent 브랜치 3개를 원격에서 지운다(승인하지 않았으므로 스윕 대상이 아니다).

```bash
git -C ~/project/mes-base-rehearsal push origin --delete agent/<id8-1>-<slug-1> agent/<id8-2>-<slug-2> agent/<id8-3>-<slug-3>
cd /Users/jji/project/wbs-web
git add docs/superpowers/plans/2026-09-10-dflow-team-rehearsal.md docs/superpowers/specs/2026-09-10-dflow-team-design.md
git commit -m "docs(dflow-team): Orca 리허설 판정: 합격 기준 11항, 워크트리 id 경로 사실 반영"
```
이어서 Global Constraints 「staging 문서 push」 를 한다.

---

### Task 9: 에이전트 팀 백엔드 리허설과 권한 준비 (사람이 대화형 세션에서 수행)

**Files:**
- Modify (staging, 메인 체크아웃): `docs/superpowers/plans/2026-09-10-dflow-team-rehearsal.md` (에이전트 팀 절), `docs/superpowers/specs/2026-09-10-dflow-team-design.md` (§3-6·§3-7·§8 사실)
- Create (feat): `kit/agent-team-allow.json`
- Modify (feat): `kit/install.sh` (41행 뒤), `scripts/kit-build.sh` (22행 뒤), `kit/README.md` (16~17행), `tests/skills/dflow-team.test.ts`
- 조건부 Modify (feat, rtk 예비책): `.claude/skills/dflow-team/references/worker-prompt.md`, `.claude/skills/dflow-dev/SKILL.md`(W6 표지 블록의 E 행), `tests/skills/dflow-dev-worker.test.ts`, `tests/skills/dflow-team.test.ts`

**Interfaces:**
- Consumes: Task 7 의 리허설 리포, Task 1~6 의 스킬.
- Produces: 스펙 §11-4(6번은 에이전트 팀 정리로 읽는다)와 §11-5 추가 7항 판정, auto 모드에서 막힌 명령 목록, 킷의 에이전트 팀 허용 목록(스펙 §8 권한 준비 2번).

- [ ] **Step 1: 작업 준비**: 스테이징 D'Flow 에 `agent` 태그·나에게 배정된 독립 ready 작업 3건을 **새로** 만든다(1건은 담당자 결정 분기 포함). Task 8 의 작업은 재사용하지 않는다.

- [ ] **Step 2: auto 모드로 먼저 실행** (스펙 §8 권한 준비 1번): Orca 가 아닌 일반 터미널에서 리허설 리포 루트에 `claude` 를 사용자 기본 권한 모드(auto)로 띄우고 `/dflow-team 2명 <지금부터 2시간 뒤 HH:MM>`. 시작 보고의 백엔드가 "에이전트 팀" 이고 권한 안내가 "팀원은 이 세션의 권한 모드를 물려받으며, 권한 확인이 뜨면 알림 없이 멈춘다" 인지 본다. 도는 동안 거부되거나 권한 확인이 뜬 명령을 전부 적는다(명령 문자열 그대로).

- [ ] **Step 3: allow 목록으로 다시 실행** (스펙 §8 권한 준비 2번): Step 2 에서 막힌 명령이 있으면 리허설 리포의 `.claude/settings.local.json` 에 그 명령마다 허용 규칙을 넣는다. git 은 절대경로 형태로 적는다(예 `Bash(/usr/bin/git *)`, 경로는 `command -v git` 값). 워커가 git 을 절대경로로 부르기 때문이다. 이 파일은 미추적이라 팀장 전제 검사의 깨끗함 검사를 깨므로 로컬 exclude 에 넣는다.
  ```bash
  cd ~/project/mes-base-rehearsal
  printf '/.claude/settings.local.json\n' >> "$(git rev-parse --git-path info/exclude)"
  jq -n --arg git "Bash($(command -v git) *)" '{permissions: {allow: [$git, "<기록한 명령마다 한 항목>"]}}' > .claude/settings.local.json
  ```
  `"<기록한 명령마다 한 항목>"` 자리는 Step 2 기록을 `Bash(<명령 접두> *)` 형태로 옮긴 값들이다. 팀장 세션을 새로 띄워 같은 방식(새 작업 또는 남은 작업)으로 다시 돌리고, 여전히 막히는 명령을 적는다.

- [ ] **Step 4: 그래도 멈추면 권한 확인 생략 모드** (스펙 §8 권한 준비 3번): `claude --dangerously-skip-permissions` 로 팀장을 띄워 나머지 기준을 판정한다. 팀원·Phase 서브에이전트까지 모든 명령을 확인 없이 실행한다는 보안 결정이므로, 이 단계로 갔다는 사실과 이유를 판정 파일에 적는다.

- [ ] **Step 5: 합격 기준 판정**: 스펙 §11-4 의 1~11항(6번은 "done 처리 때 에이전트 팀 워크트리가 그 자리에서 `git worktree remove --force` 로 정리된다" 로 읽고, 10번의 Orca id 경로는 해당 없음)과 스펙 §11-5 추가 항목:
  1. 팀원 둘이 서로 다른 링크드 워크트리(`.claude/worktrees/agent-*`)를 받았고 팀장 체크아웃의 브랜치·워킹트리가 불변이다.
  2. 워커와 Phase 서브에이전트가 `command -v git` 절대경로로 `/dflow-dev` 를 완주한다. rtk 차단 메시지 "a worktree-isolated agent's git operations must target its own worktree" 가 한 번이라도 나오면 그 지점을 적고 Step 6 으로 간다.
  3. `blocked` 작업에서 팀원이 끝나고, `TaskStop` 으로 회수되고, 슬롯이 해제돼 다음 작업이 들어간다.
  4. `blocked` 에 답한 뒤 재spawn 된 워커가 `ANSWER` 를 design.md 에 남기고 같은 agent 브랜치 위에서 이어 간다.
  5. 팀원 종료 뒤 워크트리가 자동 정리됐는지 보존됐는지, `.result` 를 파일과 마지막 응답 중 어디서 읽었는지 적는다.
  6. 팀장 세션을 의도적으로 끝내면 팀원도 멈추고, 재기동 시 고아 스캔과 "재개 필요" 보고가 나온다.
  7. 권한: Step 2~4 에서 적은 명령 목록과 최종적으로 필요했던 단계(auto·allow·생략)를 적는다.
  - 다중 신원: `~/project/mes-base-rehearsal2` 로 두 번째 클론을 Task 7 Step 1 과 같이 준비하고(같은 `.env`), 두 리포에서 `/dflow-team 1명 <HH:MM>` 을 동시에 띄워 같은 ready 1건을 두고 경쟁시킨다. 늦은 쪽 팀원이 claim exit 4 로 `skipped` 가 되는지만 본다. 실제 두 신원·두 PC 는 후속 2차 리허설이다.

- [ ] **Step 6: rtk 예비책 (5번 기준 2에서 차단이 나온 경우에만)**: git 경로를 리터럴 `/usr/bin/git` 으로 바꾼다(스펙 §11-5 2번). `<FEAT_WT>` 에서:
  1. `worker-prompt.md` 「0. git 호출 규칙」 첫 문장을 "모든 git 호출은 절대경로 `/usr/bin/git` 으로 한다(bare `git` 금지)." 로 바꾸고 `command -v git` 언급을 지운다. 「1. 격리 확인」·「2. 워크트리 부트스트랩」 의 `<git 절대경로>` 를 `/usr/bin/git` 으로 바꾼다.
  2. `/dflow-dev` SKILL.md W6 블록 E 행의 따옴표 안 문구를 "git 은 절대경로 `/usr/bin/git` 으로 호출한다(bare `git` 금지)" 로 바꾼다. 이 행은 표지 블록 안이라 보존 테스트에 영향이 없다.
  3. 테스트 단언을 바꾼다: `tests/skills/dflow-dev-worker.test.ts` 의 `expect(sec).toContain('command -v git')` → `expect(sec).toContain('/usr/bin/git')`, `tests/skills/dflow-team.test.ts` 의 `expect(p()).toContain('command -v git')` → `expect(p()).toContain('/usr/bin/git')`, 같은 파일의 `expect(p()).toContain('fetch origin && <git 절대경로> switch --detach "$base"')` → `expect(p()).toContain('fetch origin && /usr/bin/git switch --detach "$base"')`.
  4. `npx vitest run tests/skills` PASS 를 확인하고 커밋한다.
     ```bash
     git add .claude/skills/dflow-team/references/worker-prompt.md .claude/skills/dflow-dev/SKILL.md tests/skills/dflow-dev-worker.test.ts tests/skills/dflow-team.test.ts
     git commit -m "fix(dflow-team): git 경로를 /usr/bin/git 리터럴로: 리허설에서 command -v 절대경로도 rtk 에 막힘"
     ```
  5. 에이전트 팀 리허설을 다시 돌려 기준 2를 재판정한다. 그래도 막히면 rtk 훅 수정(근본 해결)을 사람에게 보고하고 멈춘다.

- [ ] **Step 7: 권한 목록을 킷에 반영하는 테스트 추가** (`<FEAT_WT>` 의 `tests/skills/dflow-team.test.ts` 끝에)

```ts
describe('에이전트 팀 권한 준비(스펙 §8)', () => {
  it('agent-team-allow.json 은 권한 규칙 문자열 배열이고 kit-build 가 킷에 싣는다', () => {
    const j = JSON.parse(readFileSync(join(ROOT, 'kit/agent-team-allow.json'), 'utf8'))
    expect(Array.isArray(j.allow)).toBe(true)
    for (const r of j.allow) expect(r).toMatch(/^[A-Za-z]+\(.+\)$/)
    expect(readFileSync(join(ROOT, 'scripts/kit-build.sh'), 'utf8')).toContain(
      'cp "$ROOT/kit/agent-team-allow.json" "$OUT/agent-team-allow.json"',
    )
  })

  it('install.sh 가 git 절대경로 규칙과 목록을 settings.json permissions.allow 에 합친다', () => {
    const sh = readFileSync(join(ROOT, 'kit/install.sh'), 'utf8')
    expect(sh).toContain('GIT_ABS=$(command -v git)')
    expect(sh).toContain('--slurpfile add "$KIT_DIR/agent-team-allow.json"')
    expect(sh).toContain('.permissions.allow = (((.permissions.allow // []) + [$git] + $add[0].allow) | unique)')
  })
})
```
Run: `npx vitest run tests/skills/dflow-team.test.ts`
Expected: 새 describe 2건 FAIL(파일 없음·문구 없음), 기존 37건 PASS.

- [ ] **Step 8: 킷 반영 구현**

(1) `kit/agent-team-allow.json` 을 만든다. 형식은 `{"allow": [ … ]}` 이고, 배열에는 Step 2~3 에서 기록한 명령을 `Bash(<명령 접두> *)` 형태로 옮긴 문자열만 넣는다(형식 예: `{"allow": ["Bash(.claude/skills/dflow-work/scripts/dflow.sh *)"]}`). git 은 install.sh 가 설치하는 PC 의 절대경로로 따로 넣으므로 이 파일에 넣지 않는다. 기록이 없으면 `{"allow": []}` 다.

(2) `kit/install.sh` 41행(`grep -qx '\.env' …`) 뒤, `# 4) 버전 표식` 앞에 넣는다.
```sh

# 3-2) 에이전트 팀 권한 준비: dflow-team 의 에이전트 팀 팀원은 팀장 세션의 권한 모드를 물려받는다.
#      워커는 git 을 절대경로로 부르므로 허용 규칙도 절대경로 형태로 넣는다. settings.json 의 다른 키는 보존한다.
GIT_ABS=$(command -v git)
SETTINGS="$TARGET/.claude/settings.json"
[ -f "$SETTINGS" ] || printf '{}\n' > "$SETTINGS"
jq --arg git "Bash($GIT_ABS *)" --slurpfile add "$KIT_DIR/agent-team-allow.json" \
  '.permissions.allow = (((.permissions.allow // []) + [$git] + $add[0].allow) | unique)' \
  "$SETTINGS" > "$SETTINGS.tmp" && mv "$SETTINGS.tmp" "$SETTINGS"
echo "권한 준비: $SETTINGS 의 permissions.allow 에 에이전트 팀 허용 목록을 합쳤다"
```

(3) `scripts/kit-build.sh` 22행(`cp "$ROOT/kit/.env.example" "$OUT/.env.example"`) 뒤에 넣는다.
```sh
cp "$ROOT/kit/agent-team-allow.json" "$OUT/agent-team-allow.json"
```

(4) `kit/README.md` 16~17행의 install.sh 설명 끝 `→ 다음 단계 안내.` 앞에 `→ \`.claude/settings.json\` 에 에이전트 팀 허용 목록 병합(git 은 이 PC 의 절대경로)` 을 넣는다.

- [ ] **Step 9: 통과 확인과 설치 실측**

```bash
npx vitest run tests/skills
out=$(mktemp -d); t=$(mktemp -d); git -C "$t" init -q
sh scripts/kit-build.sh "$out" && sh "$out/install.sh" "$t" && jq '.permissions.allow' "$t/.claude/settings.json"
```
Expected: vitest PASS 55건. 마지막 출력에 `Bash(<이 PC 의 git 절대경로> *)` 와 `kit/agent-team-allow.json` 의 항목이 모두 있다.

- [ ] **Step 10: 커밋** (feat)

```bash
git add kit/agent-team-allow.json kit/install.sh scripts/kit-build.sh kit/README.md tests/skills/dflow-team.test.ts
git commit -m "feat(kit): 에이전트 팀 권한 허용 목록을 설치 때 settings.json 에 병합

에이전트 팀 팀원은 팀장 세션의 권한 모드를 물려받아, 권한 확인에 걸리면 알림 없이 멈춘다.
리허설의 auto 모드에서 막힌 명령을 목록으로 두고, 워커가 절대경로로 부르는 git 은 설치하는
PC 의 경로로 넣는다."
```

- [ ] **Step 11: 기록과 정리**: 판정 파일에 `## 에이전트 팀 (스펙 §11-4·§11-5)` 표를 더한다. 스펙 §3-7 과 §8 권한 준비에 "auto 모드에서 막힌 명령" 과 최종 필요 단계를 사실로 적고, Step 6 을 탔으면 §3-6 에 "`command -v git` 절대경로도 막혀 리터럴 `/usr/bin/git` 을 쓴다" 를 사실로 적는다. 리허설 agent 브랜치를 원격에서 지우고 두 번째 클론을 지운다.

```bash
git -C ~/project/mes-base-rehearsal push origin --delete agent/<id8-1>-<slug-1> agent/<id8-2>-<slug-2> agent/<id8-3>-<slug-3>
git -C ~/project/mes-base-rehearsal branch -r --list 'origin/agent/*'    # 리허설 id8 이 남지 않았는지 확인
rm -rf ~/project/mes-base-rehearsal2
cd /Users/jji/project/wbs-web
git add docs/superpowers/plans/2026-09-10-dflow-team-rehearsal.md docs/superpowers/specs/2026-09-10-dflow-team-design.md
git commit -m "docs(dflow-team): 에이전트 팀 리허설 판정: 격리·rtk·동반 종료·권한 모드 사실 반영"
```
이어서 Global Constraints 「staging 문서 push」 를 한다.

---

### Task 10: main·staging 머지와 적용 확인

**Files:**
- Modify (머지 커밋 안에서만, 조건부): `tests/skills/fixtures/dflow-dev.SKILL.orig.md`, `tests/skills/fixtures/dflow-merge.SKILL.orig.md`
- 임시 워크트리: `/Users/jji/project/wbs-web-merge-main`, `/Users/jji/project/wbs-web-merge-staging`

**Interfaces:**
- Consumes: 리허설을 통과한 `feat/dflow-team`(Task 1~9).
- Produces: `origin/main`·`origin/staging` 에 반영된 스킬. 메인 체크아웃 작업트리의 `/dflow-dev` 에 `--worker` 가 있어 모든 대상 리포의 심링크가 수정본을 가리킨다.

- [ ] **Step 1: 최종 확인과 머지 지시**: `<FEAT_WT>` 에서 `npx vitest run tests/skills` 가 PASS 55건인지 보고, 사람에게 "feat/dflow-team 을 머지하면 `/dflow-dev`·`/dflow-merge` 변경이 심링크로 모든 리포에 즉시 적용된다. 리허설 판정은 `docs/superpowers/plans/2026-09-10-dflow-team-rehearsal.md`" 를 알린 뒤 명시 지시를 받는다. 변경 파일은 UI 위험 파일(`src/app/globals.css`·`src/app/layout.tsx`·`src/app/(app)/layout.tsx`·`src/components/app/*`)이 아니므로 pre-push G2 가 해당하지 않는다. `SKIP_GUARD` 는 쓰지 않는다.

- [ ] **Step 2: main 머지 (임시 워크트리에서)**: 메인 체크아웃은 여러 세션이 쓰므로 switch 하지 않는다.

```bash
cd /Users/jji/project/wbs-web
git fetch origin
git worktree add --detach /Users/jji/project/wbs-web-merge-main origin/main
cd /Users/jji/project/wbs-web-merge-main
ln -s /Users/jji/project/wbs-web/node_modules node_modules    # /node_modules 는 gitignore 대상이라 추적되지 않는다
git merge --no-ff feat/dflow-team -m "merge: feat/dflow-team → main: /dflow-team 팀장 스킬

리허설(Orca·에이전트 팀)을 통과한 뒤 반영한다. /dflow-dev 의 claim 전 기점 이동·reported 커밋과
/dflow-merge 의 원격 후보는 수동 경로에도 적용되는 수정이다."
```
충돌이 나면 양쪽 수정을 모두 살려 푼다(한쪽을 버리지 않는다).

- [ ] **Step 3: fixture 를 대상 브랜치 원문으로 다시 떠서 보존 테스트를 돌린다** (스펙 §6-1)

```bash
git show ORIG_HEAD:.claude/skills/dflow-dev/SKILL.md > tests/skills/fixtures/dflow-dev.SKILL.orig.md
git show ORIG_HEAD:.claude/skills/dflow-merge/SKILL.md > tests/skills/fixtures/dflow-merge.SKILL.orig.md
npx vitest run tests/skills
git status --porcelain tests/skills/fixtures
```
- `ORIG_HEAD` 는 머지 전 `origin/main` tip 이다. 그 사이 다른 세션이 원문을 고쳤다면 fixture 가 그 수정을 담고,
  보존 테스트가 머지 결과에서 그 줄이 사라지지 않았는지 본다.
- 보존 테스트가 실패하면 메시지의 원문 줄을 머지 결과에 되살린다. "CHANGED 줄이 fixture 에 한 번씩" 이 실패하면
  다른 세션이 의도 수정 대상 줄을 고친 것이다. 멈추고 사람에게 보고한다.
- fixture 가 바뀌었으면 머지 커밋에 담는다.
  ```bash
  git add tests/skills/fixtures/dflow-dev.SKILL.orig.md tests/skills/fixtures/dflow-merge.SKILL.orig.md
  git commit --amend --no-edit
  ```

- [ ] **Step 4: main push**

```bash
git push origin HEAD:main
```
non-fast-forward 로 거부되면 `rm node_modules && cd /Users/jji/project/wbs-web && git worktree remove /Users/jji/project/wbs-web-merge-main` 뒤 Step 2 부터 다시 한다. Vercel 배포가 끝나면 `npm run smoke:prod` 를 돌린다.

- [ ] **Step 5: staging 반영 (origin/main back-merge)**: 프로젝트 규칙대로 staging 은 `origin/main` 을 back-merge 해서 같은 커밋을 받는다. 먼저 메인 체크아웃의 staging 에 push 되지 않은 커밋이 있는지 본다.

```bash
git -C /Users/jji/project/wbs-web fetch origin
git -C /Users/jji/project/wbs-web rev-list --count origin/staging..staging
```
이 계획의 문서 커밋은 Task 7~9 에서 이미 push 했으므로 정상이면 0 이다. 0 이 아니면 다른 세션의 staging 커밋이 로컬에만 있는 것이다. 이대로 원격 staging 을 앞으로 보내면 메인 체크아웃의 staging 이 갈라져 Step 6 의 fast-forward 가 실패하므로, 멈추고 사람에게 그 커밋의 push 를 요청한다. 남의 커밋을 대신 push 하지 않는다. 0 이면:

```bash
cd /Users/jji/project/wbs-web
git worktree add --detach /Users/jji/project/wbs-web-merge-staging origin/staging
cd /Users/jji/project/wbs-web-merge-staging
ln -s /Users/jji/project/wbs-web/node_modules node_modules
git merge --no-ff origin/main -m "merge: origin/main → staging: /dflow-team 반영 back-merge"
git show ORIG_HEAD:.claude/skills/dflow-dev/SKILL.md > tests/skills/fixtures/dflow-dev.SKILL.orig.md
git show ORIG_HEAD:.claude/skills/dflow-merge/SKILL.md > tests/skills/fixtures/dflow-merge.SKILL.orig.md
npx vitest run tests/skills
git status --porcelain tests/skills/fixtures
```
fixture 가 바뀌었으면 Step 3 과 같이 머지 커밋에 담는다(`git add` 두 파일 → `git commit --amend --no-edit`). 보존 테스트 실패 처리도 Step 3 과 같다. 그 뒤 `git push origin HEAD:staging`.

- [ ] **Step 6: 메인 체크아웃에 적용 확인**: 대상 리포의 심링크는 메인 체크아웃 작업트리를 가리키므로, 그 작업트리가 수정본이어야 한다.

```bash
b=$(git -C /Users/jji/project/wbs-web branch --show-current); echo "$b"
case "$b" in main|staging) git -C /Users/jji/project/wbs-web pull --ff-only origin "$b" ;; *) echo OTHER_BRANCH ;; esac
cd /Users/jji/project/wbs-web && grep -- --worker .claude/skills/dflow-dev/SKILL.md
```
`grep` 이 표지 블록 줄을 출력해야 한다. `OTHER_BRANCH` 이거나 pull 이 fast-forward 되지 않으면 멈추고 사람에게 보고한다. fast-forward 실패의 원인은 둘 중 하나다: Step 5 확인 뒤 다른 세션이 로컬 staging 에 커밋을 더했거나, 작업트리의 미커밋 변경이 들어오는 파일과 겹친다. 어느 쪽이든 다른 세션의 체크아웃을 stash·switch·reset 하지 않는다.

- [ ] **Step 7: 정리**

```bash
rm /Users/jji/project/wbs-web-merge-main/node_modules /Users/jji/project/wbs-web-merge-staging/node_modules
cd /Users/jji/project/wbs-web
git worktree remove /Users/jji/project/wbs-web-merge-main
git worktree remove /Users/jji/project/wbs-web-merge-staging
```
`feat/dflow-team` 워크트리와 브랜치는 superpowers:finishing-a-development-branch 로 정리한다. 리허설 리포의 스킬 심링크는 feat 워크트리를 가리키므로, 리허설 리포를 계속 쓸 거라면 심링크를 메인 체크아웃(`/Users/jji/project/wbs-web/.claude/skills/<s>`)으로 다시 건다.

---

## 후속 (스펙 §12)

- tmux pane 백엔드: dev-plugin 의 `hooks/hooks.json` 로드 실패를 고친 뒤 검토한다. 그 전까지 tmux 는 에이전트 팀으로 돈다.
- 심링크 고정 워크트리: 대상 리포의 스킬 심링크 좌표를 메인 체크아웃 대신 `origin/main` 을 추적하는 전용 고정 워크트리로 옮기는 방안. 실행 중 다른 세션이 메인 체크아웃을 switch 해도 포인터 경로가 흔들리지 않게 한다.
- SendMessage 기반 `blocked` 재개: A0 (c)(Task 7) 결과가 "된다" 면, 에이전트 팀 `blocked` 를 재spawn 대신 idle 팀원에게 답을 보내는 방식으로 단순화한다.
- 실제 두 신원·두 PC 리허설(2차).

## 자체 검토

**1. 스펙 절 대응표**

| 스펙 절 | 반영 위치 |
|---|---|
| 머리말 제1 제약 | Global Constraints, Task 4 backends.md, Task 5 SKILL.md 위치 선언·금지 |
| §1 목표·비목표 | Global Constraints(poll 무수정, `--backend` 없음, tmux v1 미지원, PAT 분리 없음, supervised), 후속 |
| §2 결정 요약 | 각 Task 의 규칙과 이유 한 줄 |
| §3 전제 사실 | 근거·제약으로 반영. §3-5 id 경로는 Task 8, §3-8 은 Task 7, §3-6·§3-7 은 Task 9 가 확인한 뒤 스펙에 사실로 적는다 |
| §4-1 명령과 인자 | Task 5 「인자」 |
| §4-2 팀장 상태·재구성·고아 스캔 | Task 5 「팀장 상태」, Task 4 「고아 정리 규칙」, Task 4 events.md 필드 |
| §4-3 환경 감지 | Task 5 「0. 환경 감지」 |
| §4-4 시작(전제 검사·재구성·권한 안내·team.start·감시) | Task 5 「1. 시작」 |
| §4-5 기상과 감시(poll·감시 루프·세대 파일·TICK·처리 표) | Task 5 「2. 기상과 감시」 |
| §4-6 결과 처리(매칭·suspect·생존 증거·status 표·회수·차단기·무응답) | Task 5 「3. 결과 처리」, Task 4 backends.md |
| §4-7 승인 스윕 | Task 5 「4. 승인 스윕」, Task 2 |
| §4-8 팀원 spawn | Task 5 「5. 팀원 spawn」, Task 4 backends.md |
| §4-9 마감 | Task 5 「7. 마감」, Task 4 「고아 정리 규칙」 |
| §5 팀원 계약 | Task 3 worker-prompt.md |
| §6-1 원칙과 테스트 | Global Constraints, Task 1·2 보존 테스트, Task 10 Step 3·5 fixture 재생성 |
| §6-2 `/dflow-dev` 원문 수정 | Task 1 Step 5 |
| §6-3 `/dflow-dev --worker` | Task 1 Step 6 |
| §6-4 `/dflow-merge` 수정 | Task 2, Task 6 가이드 공지 |
| §7 실패·질문·재기동 | Task 5 「3. 결과 처리」·「6. blocked」·「1. 시작」 2번, Task 1 행 D |
| §8 다중 신원·준비물·권한 준비 | Task 5 전제 검사·권한 안내, Task 9 Step 2~4·7~10, Task 9 다중 신원 확인 |
| §9-1 `AGENT_ID`·`.dflow-agent` | Task 3 「3. 좌석 식별」, Task 5 「좌석표 연동」 |
| §9-2 팀원 신호 | v1 신호는 `.result` 와 서버 보고(Task 3). 팀원 로컬 이벤트와 heartbeat 는 스펙이 좌석표 S1 이후로 미뤘다 |
| §9-3 팀장 신호 | Task 4 events.md, Task 5(각 기록 시점, STANDBY 자리) |
| §9-4 좌석표 모습 | 화면은 좌석표 S1·S2 몫이다. 이 계획은 신호만 만든다 |
| §10 파일 구성 | 파일 구조 표, Task 3~6 |
| §11-1 적용 좌표와 순서 | Global Constraints, Task 7~10 순서, Task 10 |
| §11-2 리허설 리포와 준비 | Task 7 Step 1, Task 8·9 Step 1 |
| §11-3 A0 | Task 7 Step 3 |
| §11-4 Orca 합격 기준 | Task 8 Step 3 |
| §11-5 에이전트 팀 추가 기준 | Task 9 Step 5·6 |
| §12 잔여 위험과 후속 | 후속 절, Task 8·9 확인 항목 |

**2. 테스트 수**

| 테스트 파일 | Task | 건수 | 누적(`tests/skills`) |
|---|---|---|---|
| `dflow-dev-worker.test.ts` | 1 | 9 | 9 |
| `dflow-merge-remote.test.ts` | 2 | 7 | 16 |
| `dflow-team.test.ts` worker-prompt | 3 | 10 | 26 |
| `dflow-team.test.ts` backends·events | 4 | 7 | 33 |
| `dflow-team.test.ts` SKILL.md | 5 | 17 | 50 |
| `dflow-team.test.ts` 배포·가이드 | 6 | 3 | 53 |
| `dflow-team.test.ts` 권한 준비 | 9 | 2 | 55 |

실패 확인 단계의 기대치: Task 1 FAIL 6·PASS 3(보존 계열 3건은 수정 전 fixture 와 원문이 같아 통과한다), Task 2 FAIL 5·PASS 2(같은 이유), Task 3 FAIL 10, Task 4 새 7건 FAIL, Task 5 새 17건 FAIL, Task 6 새 3건 FAIL, Task 9 새 2건 FAIL.

**3. 자리표시자 점검**: 파일 내용·테스트 코드·명령은 전부 본문에 있다. `<id8>`·`<TSK>`·`<FEAT_WT>`·`<워크트리1>` 같은 꺾쇠는 실행 때 값으로 채우는 절차상의 변수다. Task 7~9 의 판정표 칸, Task 8 Step 5 의 `<확인한 경로>`, Task 9 의 `agent-team-allow.json` 항목은 리허설이 만들어 내는 데이터이며 미리 정할 수 없다.

**4. 이름 일관성**: 포인터 키 `TSK ID8 AGENT_ID MAIN_CHECKOUT BACKEND MODEL ANSWER`, 변수 `{MODEL_FLAG}`, 좌석 파일 `.dflow-agent`, 감시 출력 `RESULT_READY`·`TICK`·`STALE`, 세대 파일 `dflow-team.gen`, 에이전트 이름 `w<slot>-<id8>`, 이벤트 여섯, backends.md 절 「pane(Orca)」「에이전트 팀」「고아 정리 규칙」, SKILL.md 절 「1. 시작」~「7. 마감」, fixture 이름 `dflow-dev.SKILL.orig.md`·`dflow-merge.SKILL.orig.md`(파일 구조 표·Task 1·2 Step 1·테스트·Task 10 Step 3·5)가 모든 Task 와 테스트에서 같은 철자다. `/dflow-dev` 표지 태그 「--worker」 A·B·C·E 와 절 제목 `## --worker 팀원 모드 (팀장 전용)` 은 Task 1 테스트와 Task 9 예비책이 같은 문자열을 쓴다. 팀장 전제 검사가 grep 하는 바이트열(`--worker`, `origin/agent/*`)은 Task 1·2 테스트가 그대로 단언한다.
