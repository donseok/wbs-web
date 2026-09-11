# /dflow-team 팀장 스킬 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** D'Flow 에서 내게 배정되고 에이전트 위임(`tags:agent`)된 ready 작업을 상시 감시해 슬롯 N개의 팀원에게 나눠 동시에 개발시키고, 끝난 슬롯에 다음 작업을 채우는 팀장 스킬 `/dflow-team` 을 만든다.

**Architecture:** 팀장은 현재 세션이며 `poll.sh`(빈 디렉터리를 cwd 로)와 감시 루프를 Bash `run_in_background` 로 띄워 종료 알림으로 깨어나고, 깨어날 때마다 워크트리·`.result`·events.jsonl 에서 슬롯 표를 다시 만든다. 팀원은 자기 서브에이전트를 띄울 수 있는 독립 세션이다. Orca 에서는 `orca worktree create --agent claude` 로 뜨는 pane 프로세스, 그 밖(일반 터미널·tmux)에서는 `name` 과 `isolation: "worktree"` 를 준 에이전트 팀 팀원이다. 팀원은 포인터 한 줄로 `references/worker-prompt.md` 를 읽고 `/dflow-dev --worker` 를 돌린 뒤 `docs/tasks/<TSK>/.result` 한 줄로 보고한다. 기존 스킬은 수동 동작이 퇴행하지 않는 범위에서 원문도 고친다: `/dflow-dev` 는 `api_base`·Phase 0-가 원격 후보와 머지 절차의 `/dflow-merge` 위임·spec 경로·claim 전 기점 이동과 실패 복귀·exit 4 재시도·`reported` 커밋·`--worker` 블록, `/dflow-merge` 는 원격 후보·`api_base` 필터·보고 분기·충돌 되돌림·push 순서·뒷정리. `dflow.sh` 는 리허설 A0 (d) 가 실패할 때만 git 실행 경로 주입을 더한다.

**Tech Stack:** Markdown 스킬(Claude Code `.claude/skills`), 기존 셸 스크립트 재사용(`poll.sh`·`dflow.sh`), `orca` CLI, vitest(스킬 문서 보존·계약 테스트), git worktree.

**Spec:** `docs/superpowers/specs/2026-09-10-dflow-team-design.md`

## Global Constraints

- **팀원은 단순 서브에이전트가 아니다.** pane 의 별도 프로세스(Orca) 또는 에이전트 팀 팀원(Agent 도구 + `name` + `isolation: "worktree"`)만 허용한다. 이유: `/dflow-dev` 가 Phase 1~4 를 서브에이전트로 쪼갠다(스펙 머리말, §2).
- **기존 스킬 수정 원칙(스펙 §6-1)**: 필요하면 기존 스킬 원문도 고친다. 조건은 수동(`--worker` 없는) 동작이 퇴행하지 않는 것이다. 수정은 스펙 §6-1 수정 목록 안에서만 하고, `/dflow-poll`(poll.sh 포함)은 고치지 않는다. 이유: 스킬은 심링크로 모든 리포에 즉시 적용되므로 수동 회귀가 곧 운영 사고다.
- **보존 테스트(스펙 §6-1)**: fixture 는 Task 1·2 의 첫 단계에서 수정 전 원문을 `git show origin/main:<경로>` 로 떠서 **따로 커밋**한다. fixture 첫 줄은 기준 커밋 sha·원문 경로·갱신 절차 위치를 담은 머리 주석이고, 테스트는 그 줄을 떼고 비교한다. 테스트 파일의 `CHANGED` 목록에 없는 원문 줄은 현재 파일(표지 블록을 뺀 본문)에 같은 순서로 남아 있어야 한다. `/dflow-dev` 의 `--worker` 전용 삽입은 `<!-- worker:begin -->` / `<!-- worker:end -->` 표지 주석으로 감싼다. 머지 직전에 머지 대상 브랜치의 원문이 fixture 기준 sha 이후 바뀌었으면 그 원문으로 fixture 를 다시 떠서 재실행·커밋한다(Task 10). 이유: 원문 기준점이 커밋에 고정돼야 무엇을 바꿨는지가 리뷰 가능한 차이로 남고, 머지 충돌을 한쪽으로 풀다 다른 세션의 수정을 잃어도 옛 fixture 로는 초록이다.
- **머지는 리허설 뒤에 한다.** 리허설(Task 7~9)은 리허설 리포의 스킬 심링크가 `feat/dflow-team` 워크트리를 가리키게 해서 머지 전에 한다. 머지는 main 과 staging 둘 다 한다(Task 10). 이유: 머지하는 순간 수정이 심링크로 모든 리포에 퍼진다.
- **브랜치 기점과 문서 위치(스펙 §11-1)**: `feat/dflow-team` 은 `origin/main` 에서 딴다. 이유: 스킬 원문 수정의 기준점(fixture)이 머지 대상인 main 이어야 하고, main 머지 때 staging 전용 커밋이 딸려 가지 않는다. 스펙과 이 계획서는 메인 체크아웃 절대경로(`/Users/jji/project/wbs-web/docs/superpowers/…`)로 읽는다. 리허설 판정 기록 `docs/superpowers/plans/2026-09-10-dflow-team-rehearsal.md` 와 스펙 사실 갱신은 메인 체크아웃의 staging 에 커밋하고(메인 체크아웃이 staging 이 아니면 커밋하지 않고 멈춰 사람에게 알린다. 다른 세션의 체크아웃을 switch 하지 않기 위해서다), push 는 Task 10 의 staging 반영이 함께 한다. 이유: 로컬 staging 에 push 되지 않은 커밋이 있어도 이 계획이 막히지 않게 한다.
- 정본 위치 `.claude/skills/dflow-team/`: `SKILL.md`, `references/worker-prompt.md`, `references/backends.md`, `references/events.md` 넷. 새 스크립트를 만들지 않는다. 킷 밖 경로(`~/project/…`, 다른 리포)는 references 에도 적지 않는다(스펙 §10).
- **기본브랜치**: `git symbolic-ref --short refs/remotes/origin/HEAD` 가 돌려주는 값(예 `origin/main`)에서 `origin/` 을 뗀 이름이다. 이 ref 가 없으면 `git ls-remote --symref origin HEAD` 의 `ref: refs/heads/<이름>` 줄에서 구한다(스펙 §4-4). 이유: `origin/HEAD` 는 clone 할 때만 생긴다. 문서에는 `origin/<기본브랜치>` 로 적고 리터럴 `origin/main` 을 박지 않는다. 이유: 대상 리포마다 기본 브랜치가 다를 수 있다.
- **명령 형태**: `/dflow-team [인원] <종료시각> [모델]`(자연어 해석, 인원 기본 3·하드 상한 4, 종료 시각 필수, 모델 `opus|sonnet` 선택). `--team-size`·`--until`·`--interval`·`--exclude` 같은 팀장 옵션은 없다(스펙 §4-1). `poll.sh` 호출의 `--until`·`--interval`·`--exclude`·`--exclude-temp` 는 poll.sh 자체 인터페이스라서 쓴다.
- 포인터 한 줄 형식: `<MAIN_CHECKOUT>/.claude/skills/dflow-team/references/worker-prompt.md 를 읽고 그 규칙대로 실행하라. TSK=<TSK> ID8=<id8> AGENT_ID=<신원>/<host>/w<slot> MAIN_CHECKOUT=<팀장 체크아웃 절대경로> BACKEND=<pane|agent-team> MODEL=<opus|sonnet|default>`. 에이전트 팀 `blocked` 재spawn 때만 둘째 줄 `ANSWER=<담당자 답 한 줄>`(스펙 §4-8).
- 워커 프롬프트 치환 변수: `{TSK}` `{ID8}` `{AGENT_ID}` `{MAIN_CHECKOUT}` `{BACKEND}` `{MODEL_FLAG}`, 선택 `{ANSWER}`(스펙 §5).
- `.result` 한 줄: `{TSK} {ID8} <branch|-> <head_sha|-> <done_exit|-> <status> <한 줄 사유 또는 질문>`. status ∈ `done` `skipped` `needs-merge` `blocked` `failed`. `failed` 에서 팀장이 구분하는 사유는 `rate-limit`·`not-isolated`·`no-worker-flag`·`deps` 넷이다(부트스트랩의 `no-skill`·`doctor-<exit>`·`auth`·`detach` 는 일반 `failed`). 경로는 워커 워크트리의 `docs/tasks/{TSK}/.result`, 커밋하지 않고, 같은 줄을 마지막 응답으로도 출력한다(스펙 §5).
- 좌석 식별 파일은 워크트리 루트 `.dflow-agent`(내용 `{AGENT_ID}` 한 줄)이며 격리 확인 직후, 부트스트랩 전에 쓴다. `docs/tasks/<TSK>/` 안에 두지 않는다. 이유: 부트스트랩이 실패해도 팀장 재구성에 보여야 하고, claim 전에 그 디렉터리가 있으면 `/dflow-dev` 잔재 격리 규칙이 `.prev-<날짜>` 로 옮긴다(스펙 §5, §9-1).
- `AGENT_ID` 는 `<신원>/<host>/w<slot>`, 팀장은 `<신원>/<host>/lead`, 정리하지 못한 에이전트 팀 `blocked` 워크트리 표시는 `<신원>/<host>/parked` 다. `<신원>` 은 `dflow.sh me` 의 `user_email` 에서 `@` 앞부분을 소문자로 바꾸고 `[a-z0-9-]` 밖 문자를 `-` 로 바꾼 슬러그, `<host>` 는 `hostname -s` 를 같은 규칙으로 바꾼 슬러그다(스펙 §9-1). 이유: 같은 신원을 여러 PC 에서 띄워도 식별자가 겹치지 않는다.
- 에이전트 팀 `name` = `w<slot>-<id8>`, `subagent_type` = `general-purpose`, `isolation: "worktree"` 필수(스펙 §4-8).
- **git 호출 규칙(두 백엔드 공통)**: 워커와 Phase 서브에이전트는 `command -v git` 이 돌려주는 절대경로로 git 을 부른다(bare `git` 금지). 리허설에서 절대경로도 rtk 에 막히면 리터럴 `/usr/bin/git` 으로 바꾼다(스펙 §3-6, §11-5).
- 백엔드는 자동 감지만 한다(`--backend` 없음). tmux 는 v1 에서 에이전트 팀으로 돈다(스펙 §4-3).
- **팀장 상태는 캐시다.** 매 기상마다 `git worktree list --porcelain` + `.dflow-agent` + `.result`(정본)와 `~/.dflow/events.jsonl`(보조)에서 재구성한다. 결과 줄은 cksum 해시로 중복 처리를 막고, 감시 루프 교체는 TaskStop 이 아니라 세대 파일 `$(git rev-parse --git-path dflow-team.gen)` 로 한다. 한 체크아웃에 팀장은 하나이며 잠금은 디렉터리 `$(git rev-parse --git-path dflow-team.lock)` 을 `mkdir` 로 원자 획득한 것이다. 안에 `owner`(`<신원>/<host>/lead` 와 시작 epoch 초)와 매 기상 갱신하는 `beat` 를 두고, `beat` 가 70분보다 오래되면 죽은 것으로 보고 `mv` 로 옮겨 다시 확인한 뒤 가져온다. 마감의 소유 확인은 숫자 비교다(스펙 §4-2, §4-4, §4-5, §4-9).
- **팀장의 poll.sh 는 `docs/tasks/` 가 없는 빈 디렉터리를 cwd 로 두고 `DFLOW_ENV_FILE` 로 `.env` 를 지정해 띄운다.** 그래서 팀장에게 poll exit 9·10 은 오지 않고, 승인 반영과 반려 발견은 승인 스윕이 맡는다(스펙 §3-14, §4-5).
- events.jsonl: `~/.dflow/events.jsonl`, 스키마 `{ts, host, repo, tsk, order, phase, event, agent}` + 이벤트별 추가 필드(스펙 §9-3). 기록은 `jq -nc` 로 만든 한 줄을 붙인다.
- 참조는 id8 만 쓴다. 순번 금지. 팀원은 `dflow.sh list` 를 부르지 않는다(스펙 §3-4, §5).
- 팀원은 AskUserQuestion 을 쓰지 않는다. 팀장이 사람에게 묻는 곳은 에이전트 팀 `blocked` 답에 id8 이 없고 기다리는 `blocked` 가 여럿일 때 하나뿐이다. `blocked` 는 PushNotification 이 있으면 한 번 알린다(스펙 §2, §7).
- dflow.sh `show` 응답은 `{ok, order: {id, status, item, …}, reports, depends_evidence}` 모양이다. 항목 필드는 `.order.item.*`(예 `.order.item.spec`·`.order.item.external_ref`), 주문 id 는 `.order.id`, 상태는 `.order.status`, 리포트는 최상위 `.reports[]`(각 `kind`·`review_action`·`review_note`·`created_at`)다(스펙 §3-19, poll.sh 118행). 주문 status 값은 `ready`·`claimed`·`reported`·`approved`·`cancelled` 다. dflow.sh 는 404 를 exit 7 로 낸다.
- 테스트는 `process.cwd()` 를 리포 루트로 쓴다(기존 `tests/` 관례). `__dirname` 을 쓰지 않는다. vitest 는 `tests/**/*.test.{ts,tsx}` 만 테스트로 잡으므로 헬퍼 `tests/skills/_preserve.ts` 는 테스트로 돌지 않는다.
- 커밋 메시지는 한국어, "무엇"보다 "왜". `git add -A` 금지, 파일명을 명시한다(프로젝트 CLAUDE.md). 각 Task 의 커밋 명령은 제목·본문만 적었다. 실행하는 세션은 메시지 끝에 **그 세션의** attribution 트레일러(`Co-Authored-By:`·`Claude-Session:` 등, 하네스가 알려 주는 것)를 붙인다.
- **셸 블록은 bash 와 zsh 모두에서 돌아야 한다: 매치가 없을 수 있는 glob, `[ \> ]` 문자열 비교를 쓰지 않는다.** 파일을 찾는 루프는 `find docs/tasks -mindepth 2 -maxdepth 2 -name state.json 2>/dev/null | while IFS= read -r f; do …; done` 형태로, 대소 비교는 숫자(`-le`·`-lt`)로 한다. 이유: 이 PC 의 Bash 도구는 zsh 로 돌아, 매치 없는 glob 은 `no matches found` 로 명령 전체를 죽이고 `[ a \> b ]` 는 `condition expected` 로 실패한다(스펙 §3-21). Task 5 테스트가 dflow-team 파일과 `/dflow-merge` SKILL.md 에서 이 둘이 없음을 단언한다.
- 새로 쓰는 스킬 본문의 문체는 한국어 평서문이며 엠대시를 쓰지 않는다. 원문 인용 줄(테스트의 `CHANGED`·표지 위치·`between` 경계, 교체 전 원문 블록)은 바이트 그대로 둔다.

## 실행 준비 (Task 1 전에 한 번)

- [ ] **브랜치·워크트리**: superpowers:using-git-worktrees 로 `origin/main` 기점의 `feat/dflow-team` 브랜치 워크트리를 만든다. 메인 체크아웃(`/Users/jji/project/wbs-web`)에서 직접 고치지 않는다. 이유: 메인 체크아웃은 다른 리포의 스킬 심링크가 가리키는 곳이라 고치는 즉시 퍼진다. 이하 `<FEAT_WT>` 는 이 워크트리의 절대경로다(`git worktree list` 로 확인).
- [ ] **의존 설치**: `<FEAT_WT>` 에서 `npm install`(vitest 와 pre-push 훅 `core.hooksPath` 설정).
- [ ] **격리 에이전트 안에서 실행한다면**: 이 세션의 git 호출도 `command -v git` 절대경로로 한다(rtk 격리 가드, 스펙 §3-6).
- [ ] **원문 줄 수 확인**: 이 계획서의 원문 줄 번호·문구는 아래 두 값 기준이다.
  ```bash
  git fetch origin
  git show origin/main:.claude/skills/dflow-dev/SKILL.md | wc -l     # 204
  git show origin/main:.claude/skills/dflow-merge/SKILL.md | wc -l   # 44
  ```
  다르면 그 사이 다른 세션이 원문을 고친 것이다. Task 1 Step 4·Task 2 Step 3 의 "CHANGED 줄은 fixture 에 정확히 한 번씩" 이 PASS 인지 보고, 실패한 줄과 표지 위치 문구를 현재 원문으로 다시 확인한 뒤 진행한다.
- [ ] **기준선**: `npx vitest run tests/skills` 는 폴더가 없어 "No test files found" 로 끝나는 것이 정상이다.

## 파일 구조

| 파일 | 책임 | Task |
|---|---|---|
| `tests/skills/fixtures/dflow-dev.SKILL.orig.md` (신규) | 수정 전 dflow-dev SKILL.md 원문(머리 주석 한 줄 + `git show` 사본) | 1, 10(바뀌었으면 다시 뜸) |
| `tests/skills/_preserve.ts` (신규) | fixture 머리 주석 해석(`parseFixture`)·보존 판정(`firstLostLine`·`dropRanges`)·표지 블록(`workerBlocks`·`stripWorkerBlocks`) 헬퍼 | 1 |
| `tests/skills/dflow-dev-worker.test.ts` (신규) | dflow-dev 보존·§6-2 공통 수정·§6-3 표지 블록 계약 | 1, 9(조건부) |
| `.claude/skills/dflow-dev/SKILL.md` (수정) | 상태 모델 `api_base`, Phase 0-가 1번 후보와 2~5번의 `/dflow-merge` 위임, Phase 0 2번 spec 경로·claim 전 기점 이동·복귀·exit 4 재시도, 3번 기점 문구, Phase 5 4번 `reported` 커밋·안내 문구, `--worker` 표지 블록 여덟 | 1, 9(조건부) |
| `tests/skills/fixtures/dflow-merge.SKILL.orig.md` (신규) | 수정 전 dflow-merge SKILL.md 원문 | 2, 10 |
| `tests/skills/dflow-merge-remote.test.ts` (신규) | dflow-merge 보존·원격 후보·`api_base`·보고 분기·충돌·push 순서·뒷정리 계약 | 2 |
| `.claude/skills/dflow-merge/SKILL.md` (수정) | 인자 설명, 1번 후보 식별, 2번 판정 보고, 4번 머지, 5번 뒷정리, 6번 보고 | 2 |
| `.claude/skills/dflow-work/scripts/dflow.sh` (조건부 수정) | A0 (d) 가 실패할 때만: 스크립트 안 git 호출을 `${DFLOW_GIT:-git}` 로 바꿔 git 실행 경로를 주입받는다(스펙 §6-1·§11-3) | 7(조건부) |
| `.claude/skills/dflow-team/references/worker-prompt.md` (신규) | 팀원 규칙 정본 | 3, 9(조건부) |
| `tests/skills/dflow-team.test.ts` (신규, Task 3~6·9 에서 확장) | dflow-team 문서 계약·배포·권한 준비 | 3~6, 9(조건부) |
| `.claude/skills/dflow-team/references/backends.md` (신규) | 백엔드별 spawn·정리 명령, 차이표, 고아 정리 규칙 | 4 |
| `.claude/skills/dflow-team/references/events.md` (신규) | events.jsonl 기록 명령·이벤트 표 | 4 |
| `.claude/skills/dflow-team/SKILL.md` (신규) | 팀장 절차 | 5 |
| `scripts/kit-build.sh` (수정, 12행·22행 뒤) | 킷 목록에 `dflow-team`, 권한 목록 파일 복사 | 6 |
| `kit/install.sh` (수정, 41행 뒤·48행) | 권한 allow 목록 병합, 설치 완료 문구 | 6 |
| `kit/agent-team-allow.json` (신규) | 에이전트 팀 권한 허용 목록. Task 6 은 빈 목록, Task 9 가 리허설 기록으로 채운다 | 6, 9 |
| `kit/README.md` (수정, 4행·16~17행·표) | 스킬 목록·설치 설명·표 | 6 |
| `docs/agent/claude-skill/dflow-skills-guide.md` (수정) | 한눈에 보기 행, dflow-poll·dflow-merge 공지 두 줄, dflow-team 절 | 6 |
| `docs/superpowers/plans/2026-09-10-dflow-team-rehearsal.md` (신규, 메인 체크아웃 staging) | 리허설 판정표 | 7~9 |
| `docs/superpowers/specs/2026-09-10-dflow-team-design.md` (수정, 메인 체크아웃 staging) | 리허설로 확인한 사실(§3-8 A0, §3-6·§3-7·§8 권한) | 7, 9 |

---

### Task 1: `/dflow-dev` 원문 수정과 `--worker` 블록

**Files:**
- Create: `tests/skills/fixtures/dflow-dev.SKILL.orig.md`
- Create: `tests/skills/_preserve.ts`
- Create: `tests/skills/dflow-dev-worker.test.ts`
- Modify: `.claude/skills/dflow-dev/SKILL.md` (37·106·133·134·136·139·141·145·187·189·190행 교체, 60~79행을 줄 묶음으로 교체, 44행 뒤 삽입, 8·55·89·122·130·144·159행 뒤와 192행 앞에 표지 블록 삽입)

**Interfaces:**
- Consumes: 없음(첫 Task).
- Produces: `parseFixture(raw: string): { sha: string; path: string; text: string }`, `firstLostLine(orig: string, next: string, changed: readonly string[]): string | null`, `dropRanges(text: string, ranges: readonly (readonly [string, string])[]): string`, `workerBlocks(text: string): { prev: string; next: string; body: string }[]`, `stripWorkerBlocks(text: string): string` (Task 2 가 `parseFixture`·`firstLostLine` 을 재사용한다). state.json 의 `api_base`(Task 2 원격 후보 필터가 읽는다). `/dflow-dev` 의 `--worker` 플래그와 「--worker 팀원 모드」 절(Task 3 워커가 `/dflow-dev {ID8} --worker {MODEL_FLAG}` 로 부르고, Task 5 전제 검사가 `grep -q -- '--worker'` 로 지원 여부를 본다). `skipped` 사유 `선행 미승인`·`선행 승인 대기`(Task 3 `.result` 표). Phase 5 의 `reported` 커밋·push(Task 8 합격 기준 2번이 확인한다). 행 H 의 의존성 설치와 `failed deps`(Task 3 워커는 설치하지 않고, Task 8 합격 기준 12번이 확인한다).

- [ ] **Step 1: 수정 전 원문 fixture 를 떠서 따로 커밋한다 (반드시 SKILL.md 를 고치기 전에)**

```bash
mkdir -p tests/skills/fixtures
git fetch origin
sha=$(git rev-parse origin/main)
{ printf '<!-- fixture: git show %s:.claude/skills/dflow-dev/SKILL.md 수정 전 원문. 갱신 절차는 tests/skills/dflow-dev-worker.test.ts 머리 주석 -->\n' "$sha"
  git show "$sha:.claude/skills/dflow-dev/SKILL.md"; } > tests/skills/fixtures/dflow-dev.SKILL.orig.md
wc -l < tests/skills/fixtures/dflow-dev.SKILL.orig.md
tail -n +2 tests/skills/fixtures/dflow-dev.SKILL.orig.md | cmp - .claude/skills/dflow-dev/SKILL.md && echo SAME
git add tests/skills/fixtures/dflow-dev.SKILL.orig.md
git commit -m "test(dflow-dev): 수정 전 SKILL.md 원문을 보존 테스트 fixture 로 고정

원문을 고치기 전에 기준점을 커밋해 두어야 이후 수정이 리뷰 가능한 차이로 남는다. 첫 줄 머리
주석에 기준 sha 와 원문 경로를 적어 머지 직전 재생성 여부를 판단할 수 있게 한다."
```
Expected: `205`(머리 주석 1줄 + 원문 204줄)와 `SAME`. 줄 수가 다르거나 `SAME` 이 없으면 feat 워크트리가 `origin/main` 기점이 아니거나 그 사이 원문이 바뀐 것이다. 멈추고 아래 `CHANGED` 줄·`CHANGED_RANGES` 경계 줄과 표지 위치 여덟 곳의 문구가 fixture 에 그대로 있는지 확인한다(Step 4 의 "CHANGED 줄은 fixture 에 정확히 한 번씩" 이 이 확인이다).

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

/**
 * 줄 묶음 교체를 반영한다. 각 범위는 [시작 줄, 범위 뒤 첫 줄] 이며 시작 줄부터 끝 줄 앞까지를 지운다.
 * 원문을 여러 줄 통째로 바꾸는 곳에 쓴다. 그 안에 다른 곳에도 있는 줄(예 코드 펜스)이 있으면
 * CHANGED 한 줄 목록으로는 "정확히 한 번씩" 을 지킬 수 없기 때문이다.
 * 경계 줄이 없거나 두 번 이상 있으면 throw 한다.
 */
export function dropRanges(text: string, ranges: readonly (readonly [string, string])[]): string {
  let lines = text.split('\n')
  for (const [start, end] of ranges) {
    const s = lines.indexOf(start)
    if (s === -1 || lines.indexOf(start, s + 1) !== -1) throw new Error(`범위 시작 줄이 한 번이 아니다: ${start}`)
    const e = lines.indexOf(end, s + 1)
    if (e === -1 || lines.indexOf(end, e + 1) !== -1) throw new Error(`범위 끝 줄이 한 번이 아니다: ${end}`)
    lines = [...lines.slice(0, s), ...lines.slice(e)]
  }
  return lines.join('\n')
}

const FIXTURE_HEAD = /^<!-- fixture: git show ([0-9a-f]{40}):(\S+) .*-->\n/

/**
 * fixture 파일을 머리 주석(첫 줄)과 원문으로 가른다. 머리 주석은 fixture 를 뜬 커밋 sha 와 원문 경로다.
 * 머리 주석이 없으면 throw 한다(손으로 만든 fixture 를 막는다).
 */
export function parseFixture(raw: string): { sha: string; path: string; text: string } {
  const m = raw.match(FIXTURE_HEAD)
  if (!m) throw new Error('fixture 첫 줄에 "<!-- fixture: git show <sha>:<경로> …-->" 머리 주석이 없다')
  return { sha: m[1], path: m[2], text: raw.slice(m[0].length) }
}
```

- [ ] **Step 3: 실패하는 테스트 작성**

```ts
// tests/skills/dflow-dev-worker.test.ts
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { dropRanges, firstLostLine, parseFixture, stripWorkerBlocks, workerBlocks } from './_preserve'

// fixture 갱신 절차
// 1. fixture 는 `git show <sha>:<경로>` 로 뜬 수정 전 원문이며, 첫 줄 머리 주석에 그 sha 와 경로가 있다.
//    손으로 쓰거나 고치지 않는다. 뜨는 명령은 계획서 Task 1 Step 1 이다.
// 2. 머지 직전(계획서 Task 10)에는 `git log --oneline <sha>..<머지 대상 브랜치 머지 전 tip> -- <경로>` 로
//    원문이 바뀌었는지 본다. 바뀌었으면 그 tip 의 원문으로 fixture 를 다시 떠서(머리 주석 sha 도 그 tip) 이
//    테스트를 돌리고 커밋한다. 옛 fixture 로는 머지 충돌을 한쪽으로 풀다 잃은 다른 세션의 수정을 잡지 못한다.
// 3. 머지 뒤 누가 이 스킬의 표지 블록 밖 원문을 고치면 이 테스트가 빨개진다. 의도다. 고치는 사람이 그
//    원문 줄을 CHANGED 에 이유 주석과 함께 더하고 스펙 §6-1 수정 목록도 갱신해 변경을 기록한다.

const ROOT = process.cwd() // vitest 는 리포 루트에서 돈다(기존 tests/ 관례)
const skill = readFileSync(join(ROOT, '.claude/skills/dflow-dev/SKILL.md'), 'utf8')
const fixture = parseFixture(readFileSync(join(ROOT, 'tests/skills/fixtures/dflow-dev.SKILL.orig.md'), 'utf8'))
const orig = fixture.text
const manual = stripWorkerBlocks(skill)
const between = (text: string, start: string, end: string) => text.split(start)[1]?.split(end)[0] ?? ''

/** 스펙 §6-1 수정 목록으로 의도적으로 바꾸는 원문 줄. 이 밖의 원문 줄은 같은 순서로 남아야 한다. */
const CHANGED = [
  // 1. 상태 모델: state.json 스키마에 api_base
  '  `{ "tsk", "order", "phase", "baseline": {"failures": N, "tests": M}, "last": {"phase","event"} }`',
  // 2. Phase 0-가 1~5번은 CHANGED_RANGES 로 통째로 바꾼다
  // 3. Phase 0 2번 spec 검사: show 응답의 spec 경로는 .order.item.spec
  '   - **spec 검사**: show 의 `item.spec` 이 비어 있으면 착수 불가 — 제목만으로 요구사항을',
  // 4·5. Phase 0 2번: claim 전 기점 이동·실패 복귀, exit 4 재시도에서 merge 삭제
  '   판정 통과 후 claim. exit 4(선행·상태로 인한 진행 불가 — 서버 403 `dependency_not_met`',
  '   재매핑 포함)면 fetch/merge 후 1회 재시도, 그래도 4 면 중단·보고. 우회 금지.',
  // 6. Phase 0 3번 기점 문구: HEAD 가 이미 기점에 있다. 스택 기록의 branch_base 는 커밋 sha, api_base 함께 기록
  '   기점 규칙:',
  '     브랜치 위**에 만들고, state.json 에 `branch_base` 와 `risk`(선행 반려 시 재작업)를 기록한다.',
  '   git fetch origin && git switch -c agent/<주문id8>-<slug> <기점>',
  // 1·6. Phase 0 4번 기준선 기록: api_base 가 없으면 함께 기록(state.json 을 처음 쓰는 곳의 본문 지시)
  '4. **게이트 기준선 기록**: dev-discipline 의 기준선 절차 실행, state.json 에 저장.',
  // 7. Phase 5 4번: reported state.json 커밋·push 와 안내 문구
  '4. state.json `phase=reported`. 사용자에게 **"승인 대기로 보고했습니다"** 로 전달(완료 아님).',
  '   다음 `/dflow-dev` 호출의 Phase 0-가 스윕이 자동으로 처리한다(수동으로 지금 당장 머지만 하고',
  '   싶으면 `/dflow-merge` 를 여전히 따로 쓸 수 있다).',
] as const

/**
 * 스펙 §6-1 수정 목록 2번: 줄 묶음으로 바꾸는 원문. [시작 줄, 범위 뒤 첫 줄(남는 줄)].
 * Phase 0-가 1~5번(60~79행)은 코드 펜스처럼 다른 곳에도 있는 줄을 품어 CHANGED 한 줄 목록으로 적을 수 없다.
 */
const CHANGED_RANGES = [
  [
    '1. **후보 식별**: 대상 저장소의 `docs/tasks/*/state.json` 중 `phase=reported` 전부.',
    '6. **집계 보고**: 머지됨 / 승인 대기 / 건너뜀(사유) 을 한 줄씩 — 원래 요청받은 작업으로 넘어가기 전.',
  ],
] as const

describe('/dflow-dev 원문 보존(스펙 §6-1)', () => {
  it('CHANGED 와 CHANGED_RANGES 밖의 원문 줄은 표지 블록을 뺀 본문에 같은 순서로 남아 있다', () => {
    expect(firstLostLine(dropRanges(orig, CHANGED_RANGES), manual, CHANGED)).toBeNull()
  })

  it('CHANGED 줄과 범위 경계 줄은 fixture 에 정확히 한 번씩 있다(fixture 가 낡지 않았다)', () => {
    const lines = orig.split('\n')
    for (const l of [...CHANGED, ...CHANGED_RANGES.flat()]) expect(lines.filter((x) => x === l).length, l).toBe(1)
  })

  it('CHANGED 줄과 범위 시작 줄은 현재 파일에 남아 있지 않다(목록이 실제 수정과 일치한다)', () => {
    const lines = skill.split('\n')
    for (const l of [...CHANGED, ...CHANGED_RANGES.map(([start]) => start)]) expect(lines, l).not.toContain(l)
  })

  it('description 사용법과 표지 블록 밖에는 --worker 가 없다', () => {
    const fm = skill.match(/^---\n([\s\S]*?)\n---/)?.[1] ?? ''
    expect(fm).not.toContain('--worker')
    expect(manual).not.toContain('--worker')
  })
})

describe('/dflow-dev 원문 수정(스펙 §6-2, 수동·워커 공통)', () => {
  it('상태 모델: state.json 에 api_base 를 두고 처음 쓰는 곳(3번 스택 기록·4번 기준선 본문)과 반려 재작업에서 채운다', () => {
    const model = between(manual, '## 상태 모델', '## Phase 0-가')
    expect(model).toContain('"api_base"')
    expect(model).toContain('끝 `/` 를 뺀 값')
    expect(model).toContain('Phase 0 에서 state.json 을 처음 쓰는 곳')
    expect(model).toContain('반려 재작업이 기존 state.json 에 `phase=rejected` 를 쓸 때')
    const p03 = between(manual, '3. **브랜치를 오케스트레이터가 직접 만든다**', '4. **게이트 기준선 기록**')
    expect(p03).toContain('`branch_base`(기점 커밋 sha)·`risk`(선행 반려 시 재작업)와 `api_base`(상태 모델)를 기록한다')
    expect(manual).toContain('state.json 에 저장(`api_base` 가 아직 없으면 함께 기록한다. 상태 모델).')
  })

  it('Phase 0-가: 후보를 로컬 + 원격으로 넓히고 판정~뒷정리는 /dflow-merge 2~5번에 맡긴다', () => {
    const sweep = between(manual, '## Phase 0-가', '## Phase 0 — Claim·브랜치·기준선')
    expect(sweep).toContain('`origin/agent/*`')
    expect(sweep).toContain('"건너뜀(다른 D\'Flow)"')
    expect(sweep).toContain('로컬이든 원격이든')
    expect(sweep).toContain('`origin/agent/<id8>-<slug>`')
    expect(sweep).toContain('`/dflow-merge` SKILL.md(`.claude/skills/dflow-merge/SKILL.md`) 2~5번을 그대로 따른다')
    expect(sweep).not.toContain('git merge --no-ff') // 머지 절차를 두 곳에 적지 않는다
    expect(sweep).not.toContain('phase=rejected')
  })

  it('Phase 0 2번: spec 은 .order.item.spec 에서 읽고, 원래 위치를 기록하고 기점으로 옮긴 뒤 claim 하며, 실패하면 기록한 위치로 돌아간다', () => {
    const p02 = between(manual, '2. **착수 가능 판정', '3. **브랜치를 오케스트레이터가 직접 만든다**')
    expect(p02).toContain('show 의 `.order.item.spec` 이 비어 있으면')
    expect(p02).not.toContain('show 의 `item.spec`')
    expect(p02).toContain('기점 이동이 실패하면 claim 하지 않고 중단·보고한다')
    expect(p02).toContain('git symbolic-ref -q --short HEAD || git rev-parse HEAD')
    expect(p02).toContain('git switch --detach <기점>')
    expect(p02).toContain('`origin/<기본브랜치>` 여도 detach 한다')
    expect(p02).toContain('git merge-base --is-ancestor <선행 head_sha> <기점>')
    expect(p02).toContain('선행을 모두 조상으로 갖는 기점 없음')
    expect(p02).toContain('git switch <기록한 브랜치>')
    expect(p02).toContain('git switch --detach <기록한 sha>')
    expect(p02).toContain('`git switch -` 는 쓰지 않는다')
  })

  it('exit 4 재시도는 merge 없이 기점을 다시 정하고, 3번은 옮겨 둔 기점에서 브랜치를 만든다', () => {
    const p02 = between(manual, '2. **착수 가능 판정', '3. **브랜치를 오케스트레이터가 직접 만든다**')
    const p03 = between(manual, '3. **브랜치를 오케스트레이터가 직접 만든다**', '4. **게이트 기준선 기록**')
    expect(p02).toContain('`git fetch origin` 뒤 기점을 다시 정해')
    expect(p02).not.toContain('fetch/merge')
    expect(p03).toContain('git switch -c agent/<주문id8>-<slug> <기점>')
    expect(p03).not.toContain('git fetch origin && git switch -c')
  })

  it('Phase 5 4번: reported 를 커밋·push 하고 안내 문구가 실제 반영 경로와 맞는다', () => {
    const p5 = between(manual, '## Phase 5', '## --only 옵션')
    expect(p5).toContain('그 파일을 파일명을 명시해 커밋한 뒤 `git push origin <agent 브랜치>` 한다')
    expect(p5).toContain('"승인 대기로 보고했습니다"')
    expect(p5).toContain('둘 다 원격 agent 브랜치까지 본다')
    expect(p5).toContain('현재 작업트리의 state.json 만 보므로')
  })
})

describe('/dflow-dev --worker 표지 블록(스펙 §6-3)', () => {
  const EXPECTED: { prev?: string; next?: string; tag: string }[] = [
    { prev: '인자: `$ARGUMENTS` (`<순번|TSK-ID>` + 옵션)', tag: '팀장 전용' },
    { prev: '## Phase 0-가 — 승인 스윕(머지, 오케스트레이터 본인)', tag: '「--worker」 A' },
    { prev: '   작업이라 스윕이 못 봤을 수 있다 — 그 경우 지금 즉시 같은 머지 절차를 이 ref 하나로 실행 후 종료).', tag: '「--worker」 C' },
    { prev: '       있다). 머지 후 이어서 진행.', tag: '「--worker」 B' },
    { prev: '          남긴다** — 서버가 못 막는 우회를 스킬이 최소한 드러낸다.', tag: '「--worker」 G' },
    { prev: '   `git branch --show-current` 가 `agent/` 로 시작하는지 확인하고, 아니면 중단한다.', tag: '「--worker」 H' },
    { prev: 'dev-discipline.md 를 따른다.', tag: '「--worker」 E' },
    { next: '## --only 옵션', tag: '## --worker 팀원 모드 (팀장 전용)' },
  ]
  const section = () => workerBlocks(skill).at(-1)?.body ?? ''

  it('표지는 짝이 맞고 여덟 블록이 정한 자리에 정한 순서로 있다', () => {
    const blocks = workerBlocks(skill)
    expect(blocks).toHaveLength(EXPECTED.length)
    EXPECTED.forEach((e, i) => {
      if (e.prev) expect(blocks[i].prev, e.tag).toBe(e.prev)
      if (e.next) expect(blocks[i].next, e.tag).toBe(e.next)
      expect(blocks[i].body, e.tag).toContain(e.tag)
    })
  })

  it('--worker 절이 행 A~H 와 핵심 규칙을 담는다', () => {
    const sec = section()
    for (const row of ['| A |', '| B |', '| C |', '| D |', '| E |', '| F |', '| G |', '| H |']) expect(sec, row).toContain(row)
    expect(sec).toContain('**팀장 전용, 사람이 직접 쓰지 않는다.**')
    expect(sec).toContain('기점을 그 `head_sha` 로 잡고')
    expect(sec).toContain('branch_base')
    expect(sec).toContain('needs-merge approved')
    expect(sec).toContain('AskUserQuestion 을 쓰지 않는다')
    expect(sec).toContain('command -v git')
    expect(sec).toContain('`skipped 선행 미승인`')
    expect(sec).toContain('`skipped 선행 승인 대기`')
    expect(sec).toContain('행 A·B·C 뿐')
    expect(sec).toContain('위 여덟 행')
    expect(sec).toContain('.claude/skills/dflow-team/references/worker-prompt.md')
  })

  it('행 H: 생성 또는 재개로 agent 브랜치에 들어온 직후 lockfile 로 고른 관리자로 설치하고 실패하면 failed deps 다', () => {
    const sec = section()
    expect(sec).toContain('생성 또는 재개로 agent 브랜치에 들어온 직후, 4번 기준선과 Phase 1~4 게이트 전')
    expect(sec).toContain('if [ -f package.json ] && [ ! -d node_modules ]; then')
    expect(sec).toContain('npm ci')
    expect(sec).toContain('pnpm install --frozen-lockfile')
    expect(sec).toContain('yarn install --frozen-lockfile')
    expect(sec).toContain('failed deps')
    const h = workerBlocks(skill).find((b) => b.body.includes('「--worker」 H'))
    expect(h?.next).toBe('4. **게이트 기준선 기록**: dev-discipline 의 기준선 절차 실행, state.json 에 저장(`api_base` 가 아직 없으면 함께 기록한다. 상태 모델).')
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
Expected: 13건 중 FAIL 10, PASS 3. PASS 는 "CHANGED·범위 밖 원문 보존"·"CHANGED 줄과 범위 경계가 fixture 에 한 번씩"·"표지 밖 --worker 없음" 셋이다. 수정 전에는 fixture 원문과 현재 파일이 같으므로 보존 테스트가 통과하는 것이 정상이다(범위를 지운 원문은 현재 파일의 부분열이다). FAIL 은 "CHANGED 줄이 현재 파일에 없다"(아직 있음), §6-2 다섯(상태 모델·Phase 0-가·Phase 0 2번·exit 4 재시도와 3번·Phase 5), 표지 넷(`toHaveLength` 0≠8, A~H 행, 행 H 의존성 설치, "절이 비어 있지 않다")이다. "CHANGED 줄이 fixture 에 한 번씩" 이 FAIL 이면 원문이 계획서 기준과 다르다. 멈추고 실패한 줄을 현재 원문으로 다시 확인한다.

- [ ] **Step 5: 스펙 §6-2 공통 수정 (표지 없이, 수동·워커 모두 읽는다)**

(1) 상태 모델 37행
```markdown
  `{ "tsk", "order", "phase", "baseline": {"failures": N, "tests": M}, "last": {"phase","event"} }`
```
을 아래 한 줄로 바꾼다.
```markdown
  `{ "tsk", "order", "api_base", "phase", "baseline": {"failures": N, "tests": M}, "last": {"phase","event"} }`
```

(2) 44행 `  state 는 유지하고 그 사실만 보고한다(성공 Phase 를 되돌리지 않는다).` 바로 뒤에 넣는다(같은 항목의 이어지는 문단).
```markdown
  **`api_base` 는 claim 한 시점의 `DFLOW_API_BASE` 에서 끝 `/` 를 뺀 값이다**(dflow.sh `base()` 와 같은
  정규화). Phase 0 에서 state.json 을 처음 쓰는 곳에서 기록한다. 스택이면 3번의 `branch_base`·`risk` 기록,
  아니면 4번의 기준선 기록이다. 반려 재작업이 기존 state.json 에 `phase=rejected` 를 쓸 때 `api_base` 가
  없으면 같은 규칙으로 채운다. 이유: 스테이징 D'Flow DB 는 운영을 복제하므로, 스윕(Phase 0-가,
  `/dflow-merge`)이 이 값으로 로컬·원격 후보 중 자기 인스턴스의 것만 고른다. 재작업 브랜치도 다시 push 되어
  원격 후보가 되므로, 값이 없으면 같은 인스턴스의 브랜치가 "다른 D'Flow" 로 건너뛰어진다.
```

(3) Phase 0-가 1~5번(60~79행, `1. **후보 식별**` 줄부터 `6. **집계 보고**` 줄 앞까지)을 통째로 아래로 바꾼다. 80행 `6. **집계 보고**` 와 82행 `머지 대상이 wbs-web 자신이면 …` 은 그대로 남는다. 테스트의 `CHANGED_RANGES` 가 이 범위다.
```markdown
1. **후보 식별**: `/dflow-merge` 1번(`.claude/skills/dflow-merge/SKILL.md`)과 같게 로컬 + 원격으로 본다.
   대상 저장소의 `docs/tasks/*/state.json` 중 `phase=reported` 전부(로컬 후보)에 더해, 원격 `origin/agent/*`
   브랜치 tip 의 state.json 중 브랜치 이름의 id8 과 `order` 가 일치하고 `phase` 가 `merged` 가 아닌 것(원격
   후보)을 본다. `api_base` 가 현재 `DFLOW_API_BASE`(끝 `/` 제거)와 다르면 로컬이든 원격이든
   "건너뜀(다른 D'Flow)" 로 집계하고, 원격 후보는 값이 없어도 건너뛴다. 명령은 `/dflow-merge` 1번의 것을
   그대로 쓴다. 원격에만 있는 후보의 머지 대상은 `origin/agent/<id8>-<slug>` 이다. 이유: Phase 5 가
   `reported` 를 커밋하므로 다른 브랜치로 옮긴 뒤에는 작업트리에서 그 state.json 이 빠져, 로컬만 보면
   승인분을 놓친다. 스테이징 D'Flow DB 는 운영을 복제하므로 다른 인스턴스의 후보도 approved 로 보인다.
2~5. **판정·순서·머지·뒷정리**: `/dflow-merge` SKILL.md(`.claude/skills/dflow-merge/SKILL.md`) 2~5번을 그대로 따른다.
   번호도 같아서, 이 문서의 "Phase 0-가 4번" 은 `/dflow-merge` 4번이다. 이유: 같은 머지 절차를 두 곳에 적으면
   한쪽만 고쳐져, 스윕이 충돌 상태나 push 안 된 커밋을 체크아웃에 남기는 결함이 되살아난다.
```

(4) Phase 0 2번 106행
```markdown
   - **spec 검사**: show 의 `item.spec` 이 비어 있으면 착수 불가 — 제목만으로 요구사항을
```
을 아래 한 줄로 바꾼다(107행은 그대로 이어진다). show 응답에서 항목은 `.order.item` 에 있다.
```markdown
   - **spec 검사**: show 의 `.order.item.spec` 이 비어 있으면 착수 불가. 제목만으로 요구사항을
```

(5) Phase 0 2번 133~134행 두 줄
```markdown
   판정 통과 후 claim. exit 4(선행·상태로 인한 진행 불가 — 서버 403 `dependency_not_met`
   재매핑 포함)면 fetch/merge 후 1회 재시도, 그래도 4 면 중단·보고. 우회 금지.
```
을 아래로 바꾼다.
````markdown
   판정 통과 후 **기점을 정하고, 그 기점으로 옮긴 뒤 claim 한다.** claim 의 선행 도달 검사(dflow.sh
   `check_depends_local`)가 현재 HEAD 를 보기 때문이다. 기점 규칙은 3번과 같다. 기본은
   `origin/<기본브랜치>` 이고, 선행이 main 미반영이거나 미승인 스택이면 선행 산출물이 있는 agent 브랜치
   (또는 그 `head_sha`)다.
   - 선행이 여럿이면 기점은 모든 선행의 `head_sha` 를 조상으로 가져야 한다
     (`git merge-base --is-ancestor <선행 head_sha> <기점>` 이 전부 참). 그런 기점이 없으면 착수 불가로
     스킵하고 사유 "선행을 모두 조상으로 갖는 기점 없음" 을 보고한다.
   - **claim 전 기점 이동은 항상 한다.** 옮기기 전에 원래 위치를 기록한다.
     ```bash
     git symbolic-ref -q --short HEAD || git rev-parse HEAD
     ```
     그 다음 기점이 `origin/<기본브랜치>` 여도 detach 한다. 수동 사용자가 무관한 브랜치에 있으면 claim 의
     선행 도달 검사가 그 HEAD 를 보고 exit 4 를 내기 때문이다.
     ```bash
     git fetch origin && git switch --detach <기점>
     ```
     해당 agent 브랜치(`agent/<주문id8>-*`)가 이미 있으면(재개) detach 대신 그 브랜치로 switch 한다.
   - 기점 이동이 실패하면 claim 하지 않고 중단·보고한다(detach 와 재개 브랜치 switch 모두. 워커는 `.result` 에
     `failed detach`). 이유: 수동 사용자의 미커밋 변경이 기점과 부딪치면 switch 가 거부되는데, 그 상태로
     claim 하면 서버에는 claimed 가 남고 작업은 엉뚱한 HEAD 에서 시작한다. 거부된 switch 는 HEAD 를 옮기지
     않으므로 복귀할 것은 없다.
   - claim 이 exit 4(선행·상태로 인한 진행 불가. 서버 403 `dependency_not_met` 재매핑 포함)면
     `git fetch origin` 뒤 기점을 다시 정해(다시 옮겨) 1회 재시도하고, 그래도 4 면 중단·보고한다. 우회
     금지. 이유: fetch 로 바뀌는 것은 기점이며, merge 는 기본 브랜치를 사용자의 현재 브랜치나 detached
     HEAD 에 섞는다.
   - detach 부터 3번의 `git switch -c` 성공까지의 **모든 실패**(claim 실패, 브랜치 생성 실패 포함)에서
     기록한 원래 위치로 돌아간다. 브랜치면 `git switch <기록한 브랜치>`, 아니면
     `git switch --detach <기록한 sha>` 다. `git switch -` 는 쓰지 않는다. 이유: `-` 는 "직전 위치" 라서
     기록한 위치와 다를 수 있고, 수동 사용자를 엉뚱한 곳이나 detached HEAD 에 남기는 것은 수동 동작의
     퇴행이다.
````

(6) Phase 0 3번 136행 `   기점 규칙:` 을 아래 한 줄로 바꾼다.
```markdown
   기점 규칙(2번이 claim 전에 이 규칙으로 기점을 정해 HEAD 를 이미 그 기점에 옮겨 두었다):
```

(7) Phase 0 3번 141행 `   git fetch origin && git switch -c agent/<주문id8>-<slug> <기점>` 을 아래 한 줄로 바꾼다.
```markdown
   git switch -c agent/<주문id8>-<slug> <기점>
```

(8) Phase 5 187행
```markdown
4. state.json `phase=reported`. 사용자에게 **"승인 대기로 보고했습니다"** 로 전달(완료 아님).
```
을 아래로 바꾼다(188행은 그대로 이어진다).
```markdown
4. state.json 을 `phase=reported` 로 갱신하고, 그 파일을 파일명을 명시해 커밋한 뒤 `git push origin <agent 브랜치>` 한다.
   원격 agent 브랜치 tip 에도 `reported` 가 남고, 미커밋 state.json 이 다음 브랜치 전환을 막지 않게 하기
   위해서다. push 가 훅에 거부되면 우회하지 않고 보고한다. done 은 이미 보고됐으므로 되돌리지 않는다. 이
   push 가 실패해도 `/dflow-merge` 의 원격 후보 조건이 phase 에 기대지 않으므로 승인 반영은 막히지 않는다.
   사용자에게 **"승인 대기로 보고했습니다"** 로 전달(완료 아님).
```

(9) Phase 5 189~190행 두 줄
```markdown
   다음 `/dflow-dev` 호출의 Phase 0-가 스윕이 자동으로 처리한다(수동으로 지금 당장 머지만 하고
   싶으면 `/dflow-merge` 를 여전히 따로 쓸 수 있다).
```
을 아래로 바꾼다(188행 끝의 "main 반영은" 에 이어진다).
```markdown
   다음 `/dflow-dev` 호출의 Phase 0-가 스윕이나 `/dflow-merge` 가 처리하며, 둘 다 원격 agent 브랜치까지 본다.
   `/dflow-poll` 의 승인 감지(exit 9)는 현재 작업트리의 state.json 만 보므로, 다른 브랜치로 옮긴 뒤에는
   이 작업의 승인을 알리지 못한다.
```

(10) Phase 0 3번 139행
```markdown
     브랜치 위**에 만들고, state.json 에 `branch_base` 와 `risk`(선행 반려 시 재작업)를 기록한다.
```
을 아래 한 줄로 바꾼다(138행과 이어진다). 여기가 스택 작업이 state.json 을 처음 쓰는 곳이라 `api_base` 지시를 본문에 둔다. `branch_base` 를 커밋 sha 로 적는 이유는 `/dflow-merge` 3번이 이 값으로 스택을 판정하기 때문이다(브랜치 이름은 머지 뒤 지워진다).
```markdown
     브랜치 위**에 만들고, state.json 에 `branch_base`(기점 커밋 sha)·`risk`(선행 반려 시 재작업)와 `api_base`(상태 모델)를 기록한다.
```

(11) Phase 0 4번 145행
```markdown
4. **게이트 기준선 기록**: dev-discipline 의 기준선 절차 실행, state.json 에 저장.
```
을 아래 한 줄로 바꾼다. 스택이 아닌 작업은 여기가 state.json 을 처음 쓰는 곳이다. 이유: 상태 모델 절에만 두면 실제로 쓰는 단계에서 빠뜨려 원격 후보가 전부 "건너뜀(다른 D'Flow)" 가 되고, 이 실패는 조용하다.
```markdown
4. **게이트 기준선 기록**: dev-discipline 의 기준선 절차 실행, state.json 에 저장(`api_base` 가 아직 없으면 함께 기록한다. 상태 모델).
```

- [ ] **Step 6: 스펙 §6-3 `--worker` 표지 블록 여덟 개를 넣는다 (모두 기존 줄 사이 삽입)**

(W1) 8행 `인자: \`$ARGUMENTS\` (\`<순번|TSK-ID>\` + 옵션)` 뒤에(표지 앞뒤 빈 줄 포함):
```markdown

<!-- worker:begin -->
> `--worker` 는 `/dflow-team` 팀장 전용 플래그다(사람이 직접 쓰지 않는다). 있으면 아래 「--worker 팀원 모드」
> 절의 여덟 행(A~H)만 달라지고, 없으면 이 문서 절차 그대로다.
<!-- worker:end -->
```

(W2) 54행 `## Phase 0-가 — 승인 스윕(머지, 오케스트레이터 본인)` 과 그 뒤 빈 줄(55행) 다음에:
```markdown
<!-- worker:begin -->
> `--worker` 면 이 절 전체를 건너뛰고, 스윕은 팀장 몫이라는 이유를 한 줄 남긴다(「--worker」 A).
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

(W5) 130행 `          남긴다** — 서버가 못 막는 우회를 스킬이 최소한 드러낸다.` 바로 뒤에(갈래 3 앞):
```markdown
          <!-- worker:begin -->
          `--worker` 면 갈래 1·2 는 스택하지 않고 `skipped` 로 끝낸다(「--worker」 G).
          <!-- worker:end -->
```

(W-H) 144행 `` `git branch --show-current` 가 `agent/` 로 시작하는지 확인하고, 아니면 중단한다.`` 바로 뒤에(145행 `4. **게이트 기준선 기록**` 앞):
```markdown
   <!-- worker:begin -->
   `--worker` 면 여기서 의존성을 설치한 뒤 4번으로 간다(「--worker」 H).
   <!-- worker:end -->
```

(W6) 159행 `dev-discipline.md 를 따른다.` 바로 뒤에:
```markdown
<!-- worker:begin -->
`--worker` 면 공통 프롬프트에 git 절대경로 규칙 한 줄을 덧붙인다(「--worker」 E).
<!-- worker:end -->
```

(W7) `## --only 옵션` 줄 바로 앞에(블록 뒤 빈 줄 포함):
```markdown
<!-- worker:begin -->
## --worker 팀원 모드 (팀장 전용)

**팀장 전용, 사람이 직접 쓰지 않는다.** `--worker` 는 "이 세션은 자동 실행되는 팀원이며, 기본 브랜치를
잡고 있는 상위 체크아웃이 따로 있다" 는 뜻이다. `/dflow-team` 팀장이 띄운 팀원만 이 플래그를 붙인다.
description 의 사용법 줄에는 노출하지 않고, `.dflow-agent` 가 있다고 워커 모드로 자동 전환하지 않는다.
남은 워크트리에서 사람의 질문이 조용히 꺼지는 사고를 막기 위해서다.

| # | 위치 | 플래그 없음 | `--worker` |
|---|---|---|---|
| A | Phase 0-가 승인 스윕 | claim 앞에서 매번 스윕한다 | **건너뛴다.** 스윕은 팀장 몫이며, 이유를 한 줄 남긴다 |
| B | Phase 0 2번, 선행이 approved 인데 main 미반영이면 직접 머지 | 직접 머지한다 | **머지하지 않는다.** 기점을 그 `head_sha` 로 잡고, Phase 0 2번 공통 규칙대로 claim 전에 그 기점으로 detach 한 뒤 claim 하고 스택 브랜치를 만든다. state.json 에 `branch_base` 와 `risk: "선행 main 미반영(팀장 머지 대기)"` 를 기록한다 |
| C | Phase 0 1번 재개 판정의 approved 갈래 | 즉시 머지하고 종료한다 | **머지하지 않고** `.result` 를 `{TSK} {ID8} <branch> <head_sha> - needs-merge approved` 로 쓰고 종료한다 |
| D | 사람 판단이 필요한 분기(AskUserQuestion, `--only` 확인) | 지금처럼 묻는다 | **AskUserQuestion 을 쓰지 않는다.** 기본값이 있으면 택해 한 줄 남기고 진행하고, 없으면 `blocked`(worker-prompt.md 판단 규칙). 팀장은 `--only` 를 넘기지 않으므로 `--only` 확인은 워커 경로에 없다 |
| E | Phase 1~4 공통 프롬프트 | 지금 문구 그대로 | 공통 프롬프트에 "git 은 `command -v git` 이 돌려주는 절대경로로 호출한다(bare `git` 금지)" 한 줄을 덧붙인다. 오케스트레이터 자신도 같은 규칙을 따른다. 손자 서브에이전트까지 rtk 격리 가드 차단을 피하게 하기 위해서다 |
| F | Phase 0 2번 claim exit 4 재시도 | `git fetch origin` 뒤 기점을 다시 정해 1회 재시도하고, 그래도 4 면 중단·보고한다(merge 없음) | 같다. 그래도 4 면 `.result` 에 `skipped` 를 쓴다 |
| G | Phase 0 2번 `head_sha` 없는 선행의 갈래 1·2 | 갈래 1(미승인·stage 미달)은 로컬 선행 산출물이 있으면 스택하고, 갈래 2(`stage >= im`·`order_approved:false`, 완료 보고 뒤 승인 대기)는 한 줄 남기고 진행한다 | **스택하지 않는다.** 갈래 1 은 `skipped 선행 미승인`, 갈래 2 는 `skipped 선행 승인 대기` 로 끝낸다. 팀장은 일시 제외한다. 이유: 워커는 선행의 브랜치를 찾을 수단이 없어(`head_sha` 가 없다) 선행 코드 없이 개발하게 된다. 승인되면 스윕이 머지하고 재검사에서 `origin/<기본브랜치>` 기점으로 풀린다. 워커의 스택은 `head_sha` 가 있는 선행(행 B)에만 한다 |
| H | Phase 0 3번의 브랜치 생성 또는 재개 판정으로 agent 브랜치에 들어온 직후 | 설치하지 않는다. 사람의 체크아웃에는 의존성이 이미 있다 | 생성 또는 재개로 agent 브랜치에 들어온 직후, 4번 기준선과 Phase 1~4 게이트 전에 아래 블록으로 설치한다. `blocked` 답을 받아 재spawn 된 워커처럼 재개 판정으로 기존 agent 브랜치에 들어온 경우도 같다. 재개는 브랜치를 새로 만들지 않아 3번을 지나지 않는데, 새 격리 워크트리에는 `node_modules` 가 없기 때문이다. lockfile 로 관리자를 고르고, `package.json` 이 있고 `node_modules` 가 없을 때만 설치하며, lockfile 이 없으면 설치하지 않는다. 설치가 실패하면 `.result` 에 `failed deps <실패한 명령과 exit>` 를 쓰고 끝낸다. 이유: 새 워크트리에는 `node_modules` 가 없어 기준선 명령이 127 로 끝나고, 스택이면 선행 작업이 lockfile 을 바꿨을 수 있어 브랜치 기점의 lockfile 로 설치해야 한다. 고정되지 않은 설치는 기준선을 재현하지 못하고 새 lockfile 을 산출물에 섞는다 |

행 H 의 설치 블록:
```bash
if [ -f package.json ] && [ ! -d node_modules ]; then
  if   [ -f package-lock.json ]; then npm ci
  elif [ -f pnpm-lock.yaml ];    then pnpm install --frozen-lockfile
  elif [ -f yarn.lock ];         then yarn install --frozen-lockfile
  fi   # 실패하면 .result 에 failed deps
fi
```

- 인자 파싱: `$ARGUMENTS` 에 `--worker` 가 있으면 이 모드다. 참조는 id8 으로만 온다.
- `.result` 형식과 status 뜻은 `.claude/skills/dflow-team/references/worker-prompt.md` 가 정본이다. 끝날 때
  status·agent 브랜치·head·`done` exit·한 줄 사유를 마지막에 요약해 워커가 `.result` 로 옮기게 한다.
- 기본 브랜치를 switch·pull·merge·push 하는 지점은 행 A·B·C 뿐이며, 워커는 셋 다 하지 않는다. 행 F 의
  재시도는 수동·워커 모두 merge 하지 않는다. claim 전 기점 이동(`git switch --detach`, Phase 0 2번)은 기본
  브랜치를 체크아웃하지 않으므로 팀장 체크아웃과 부딪치지 않는다. agent 브랜치를 만들고 그 위에 push
  하는 Phase 0 3번과 Phase 5(`reported` 커밋 포함)는 워커에서도 그대로 돈다.
- 새로 만드는 "사람에게 묻기" 지점은 없다. dflow-dev 의 판단 실패는 이미 전부 "중단·보고"(push 훅
  거부, Verify 재시도 소진, 빨간 기준선)라서 워커에서는 `.result` 의 `failed <사유>` 로 떨어진다. 설계
  재량 분기만 판단 규칙(`blocked`)이 받는다.
- 인자 파싱과 위 여덟 행만 워커용으로 갈린다(행 F 는 수동과 같고 결과 표기만 다르다). 게이트·Phase
  정의·커밋 규칙·모델 배정(dev-discipline.md)은 워커에서도 같다.
<!-- worker:end -->

```

- [ ] **Step 7: 통과 확인**

Run: `npx vitest run tests/skills/dflow-dev-worker.test.ts`
Expected: PASS 13건. 보존 테스트가 실패하면 메시지의 "찾지 못한 원문 줄" 을 되살린다(편집이 `CHANGED`·`CHANGED_RANGES` 밖 줄을 건드린 것이다). 표지 위치 테스트가 실패하면 블록 앞뒤 빈 줄과 들여쓰기를 Step 6 대로 맞춘다.

- [ ] **Step 8: 커밋**

```bash
git add tests/skills/_preserve.ts tests/skills/dflow-dev-worker.test.ts .claude/skills/dflow-dev/SKILL.md
git commit -m "feat(dflow-dev): api_base·원격 후보와 /dflow-merge 위임·claim 전 기점 이동과 복귀·reported 커밋, --worker 팀원 모드

claim 의 선행 도달 검사가 시작 HEAD 를 봐서 무관한 브랜치나 스택 기점에서 claim 이 막히고,
exit 4 재시도의 merge 는 기본 브랜치를 현재 HEAD 에 섞었다. reported 를 커밋하지 않아 원격 tip 이
verify 에 머물고 다음 브랜치 전환도 막혔으며, 커밋하면 로컬만 보는 Phase 0-가 가 승인분을 놓친다.
Phase 0-가 의 머지는 충돌·push 실패를 되돌리지 않아 /dflow-merge 절차로 단일화하고, spec 은
.order.item.spec 에서 읽는다. 모두 수동에도 있는 결함이라 원문을 고치고, 스테이징이 운영을
복제하므로 후보는 api_base 로 자기 인스턴스만 받으며, 빠뜨리지 않게 state.json 을 처음 쓰는 3·4번
본문에서 기록한다. branch_base 는 /dflow-merge 가 스택을 판정하도록 커밋 sha 로 적는다. /dflow-team
팀원용 분기(A~H, 재개 경로의 의존성 설치 포함)는 표지 블록으로 떼어 두고, 심링크로 즉시 퍼지므로 수정 목록 밖 원문 줄의 보존을 테스트로
고정한다."
```

---

### Task 2: `/dflow-merge` 원격 후보·보고 분기·충돌 되돌림·push 순서·뒷정리

**Files:**
- Create: `tests/skills/fixtures/dflow-merge.SKILL.orig.md`
- Create: `tests/skills/dflow-merge-remote.test.ts`
- Modify: `.claude/skills/dflow-merge/SKILL.md` (8·18·19·21·28·34·35·37행 교체·삭제, 20·24·27·28·30행 뒤 삽입)

**Interfaces:**
- Consumes: `parseFixture`·`firstLostLine` (Task 1, `tests/skills/_preserve.ts`), state.json 의 `api_base`(Task 1).
- Produces: 인자 없는 `/dflow-merge` 가 로컬 `phase=reported` 와 원격 `origin/agent/*` tip 에서 `phase` 가 `merged` 가 아닌 작업을 후보로 보고(`api_base` 가 다르면 로컬이든 원격이든 건너뛰고, 원격은 값이 없어도 건너뛴다), 보고에 반려: 재작업 필요·머지 실패(충돌)·push 실패(되돌림)·건너뜀(서버 <status>·조회 실패·다른 D'Flow·기점 미반영·승인 뒤 변경)을 가른다. 스택 순서는 state.json `branch_base`(Task 1 이 커밋 sha 로 기록)로 판정하고, 머지 전에 완료 증적 head_sha 이후 변경이 그 작업의 state.json 뿐인지 본다. 충돌은 `git merge --abort`, push 실패는 `git reset --keep <기록한 HEAD>` 로 체크아웃을 깨끗하게 남긴다. Task 1 의 Phase 0-가 가 이 1번 명령과 2~5번 절차를 그대로 쓰고, Task 5 팀장 「4. 승인 스윕」 이 보고를 읽으며, 전제 검사가 `grep -q 'origin/agent/\*'` 로 지원 여부를 본다.

- [ ] **Step 1: 수정 전 원문 fixture 를 떠서 따로 커밋한다 (SKILL.md 를 고치기 전에)**

```bash
git fetch origin
sha=$(git rev-parse origin/main)
{ printf '<!-- fixture: git show %s:.claude/skills/dflow-merge/SKILL.md 수정 전 원문. 갱신 절차는 tests/skills/dflow-merge-remote.test.ts 머리 주석 -->\n' "$sha"
  git show "$sha:.claude/skills/dflow-merge/SKILL.md"; } > tests/skills/fixtures/dflow-merge.SKILL.orig.md
wc -l < tests/skills/fixtures/dflow-merge.SKILL.orig.md
tail -n +2 tests/skills/fixtures/dflow-merge.SKILL.orig.md | cmp - .claude/skills/dflow-merge/SKILL.md && echo SAME
git add tests/skills/fixtures/dflow-merge.SKILL.orig.md
git commit -m "test(dflow-merge): 수정 전 SKILL.md 원문을 보존 테스트 fixture 로 고정

원문을 고치기 전에 기준점을 커밋해 두어야 이후 수정이 리뷰 가능한 차이로 남는다."
```
Expected: `45`(머리 주석 1줄 + 원문 44줄)와 `SAME`. 다르면 Task 1 Step 1 과 같이 멈추고 확인한다.

- [ ] **Step 2: 실패하는 테스트 작성**

```ts
// tests/skills/dflow-merge-remote.test.ts
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { firstLostLine, parseFixture } from './_preserve'

// fixture 갱신 절차
// 1. fixture 는 `git show <sha>:<경로>` 로 뜬 수정 전 원문이며, 첫 줄 머리 주석에 그 sha 와 경로가 있다.
//    손으로 쓰거나 고치지 않는다. 뜨는 명령은 계획서 Task 2 Step 1 이다.
// 2. 머지 직전(계획서 Task 10)에는 `git log --oneline <sha>..<머지 대상 브랜치 머지 전 tip> -- <경로>` 로
//    원문이 바뀌었는지 본다. 바뀌었으면 그 tip 의 원문으로 fixture 를 다시 떠서(머리 주석 sha 도 그 tip) 이
//    테스트를 돌리고 커밋한다. 옛 fixture 로는 머지 충돌을 한쪽으로 풀다 잃은 다른 세션의 수정을 잡지 못한다.
// 3. 머지 뒤 누가 이 스킬 원문을 고치면 이 테스트가 빨개진다. 의도다. 고치는 사람이 그 원문 줄을
//    CHANGED 에 이유 주석과 함께 더하고 스펙 §6-1 수정 목록도 갱신해 변경을 기록한다.

const ROOT = process.cwd() // vitest 는 리포 루트에서 돈다(기존 tests/ 관례)
const skill = readFileSync(join(ROOT, '.claude/skills/dflow-merge/SKILL.md'), 'utf8')
const orig = parseFixture(readFileSync(join(ROOT, 'tests/skills/fixtures/dflow-merge.SKILL.orig.md'), 'utf8')).text

/** 스펙 §6-1 수정 목록으로 의도적으로 바꾸는 원문 줄. 이 밖의 원문 줄은 같은 순서로 남아야 한다. */
const CHANGED = [
  // 1. 인자 설명: 원격 후보를 포함한다
  '인자: `$ARGUMENTS` (선택 — ref 목록. 없으면 로컬 reported 전체가 후보)',
  // 2. 후보 식별(1번): 원격 후보·api_base 필터·전체 UUID 조회·show jq 축약
  '   인 작업 전부. 각각 `dflow.sh show <ref>` 로 서버 상태 확인.',
  // 3. 판정 보고(2번): 승인 대기·반려·건너뜀 갈래
  '2. **판정 — approved 만 진행**: `status=approved` 가 아니면 건너뛰고 "승인 대기"로 보고.',
  // 6. 순서(3번): 스택 판정을 브랜치 tip 이 아니라 state.json branch_base 로
  '3. **순서 — 스택은 조상 먼저**: 대상이 여럿이면 `git merge-base --is-ancestor A B` 로 조상',
  // 4. 머지(4번): 머지 대상, 충돌 되돌림, merged 커밋을 push 전에(5번에서 옮겨 온다), push 실패 되돌림
  '   git merge --no-ff agent/<id8>-<slug> -m "merge: <TSK> <제목> (approved)"',
  '   - state.json `phase=merged` 갱신 → 기본브랜치에 커밋(파일명 명시).',
  // 5. 뒷정리(5번): 로컬 브랜치 삭제의 not found·checked out 건너뛰기
  '   - 머지된 `agent/` 브랜치 삭제(로컬 + 원격). 아직 미승인 후손 스택 브랜치는 **삭제·rebase',
  // 3. 판정 보고(6번): 갈래별 목록
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
  it('원격 후보: origin/agent/* 의 state.json 을 git diff 로 찾아 git show 로 읽고 merged 가 아니면 후보다', () => {
    expect(skill).toContain("git branch -r --list 'origin/agent/*'") // 팀장 전제 검사가 grep 하는 바이트열 포함
    expect(skill).toContain("`git diff --name-only origin/<기본브랜치>...<ref> -- 'docs/tasks/*/state.json'`")
    expect(skill).toContain('`git show <ref>:<경로>`')
    expect(skill).toContain('`git show` 에는 glob 을 쓰지 않는다')
    expect(skill).toContain('**`phase` 가 `merged` 가 아니면\n     전부 후보**')
    expect(skill).toContain('`origin/agent/<id8>-<slug>`')
  })

  it('api_base 가 다르면 로컬이든 원격이든 건너뛰고, 원격은 값이 없어도 건너뛰며, 값 없는 로컬만 지금처럼 판정한다', () => {
    expect(skill).toContain('`api_base` 가 현재 `DFLOW_API_BASE`(끝 `/` 제거)와 다르면')
    expect(skill).toContain('로컬이든 원격이든 "건너뜀(다른 D\'Flow)" 로 보고한다')
    expect(skill).toContain('원격 후보는 값이 없어도 건너뛴다')
    expect(skill).toContain('값이 없는 로컬 후보')
    expect(skill).not.toContain('필터를 걸지 않는다')
  })

  it('show 는 전체 UUID 로 부르고 jq 로 status 와 마지막 completion 리포트(증적 head_sha 포함)만 뽑는다', () => {
    expect(skill).toContain('서버 조회는 state.json 의 전체 UUID 로 한다')
    expect(skill).toContain('.order.status')
    expect(skill).toContain('select(.kind == "completion")')
    expect(skill).toContain('head_sha: .evidence.head_sha')
  })

  it('판정 보고는 승인 대기·반려·서버 상태·조회 실패를 가르고 반려는 state.json 을 고치지 않는다', () => {
    expect(skill).toContain('"반려: 재작업 필요 (<review_note>)"')
    expect(skill).toContain('`review_action=reject`')
    expect(skill).toContain('반려는 로컬 후보도 state.json 을 고치지 않고 보고만 한다')
    expect(skill).toContain('`status=reported`: "승인 대기"')
    expect(skill).toContain('"건너뜀(서버 <status>)"')
    expect(skill).toContain('404(dflow.sh exit 7)')
    expect(skill).toContain('"건너뜀(조회 실패)"')
  })

  it('순서는 branch_base 로, 승인 뒤 변경은 건너뛰고, 충돌은 merge --abort, merged 커밋은 push 전에, push 실패는 reset --keep', () => {
    expect(skill).toContain('후보 state.json 의 `branch_base` 로 조상')
    expect(skill).toContain('`git merge-base --is-ancestor <branch_base> <그 후보의 머지 대상>`')
    expect(skill).toContain('"건너뜀(기점 미반영)"')
    expect(skill).toContain('git diff --name-only <증적 head_sha>..<머지 대상>')
    expect(skill).toContain('"건너뜀(승인 뒤 변경)"')
    expect(skill).toContain('`git merge --abort`')
    expect(skill).toContain('"머지 실패(충돌)"')
    expect(skill).toContain('이 커밋을 **push 전에**')
    expect(skill).toContain('`git reset --keep <기록한 HEAD>`')
    expect(skill).toContain('`origin` 으로 리셋하지 않는다')
    expect(skill).toMatch(/git merge --no-ff <머지 대상>[\s\S]*git add docs\/tasks\/<TSK>\/state\.json[\s\S]*\n {3}git push origin <기본브랜치>\n/)
  })

  it('뒷정리: 로컬 브랜치가 없거나 다른 워크트리가 잡고 있으면 건너뛰고 보고한다', () => {
    expect(skill).toContain('(not found)')
    expect(skill).toContain('(checked out)')
    expect(skill).toContain('건너뛰고 보고한다')
  })
})
```

- [ ] **Step 3: 실패 확인**

Run: `npx vitest run tests/skills/dflow-merge-remote.test.ts`
Expected: 9건 중 FAIL 7, PASS 2. PASS 는 보존 테스트와 "CHANGED 줄이 fixture 에 한 번씩" 이다(수정 전이라 fixture 원문과 같다). FAIL 은 "CHANGED 줄이 현재 파일에 없다" 와 §6-4 여섯 건이다.

- [ ] **Step 4: SKILL.md 를 고친다 (교체 여섯 곳, 삭제 한 곳, 삽입 다섯 곳)**

(1) 8행
```markdown
인자: `$ARGUMENTS` (선택 — ref 목록. 없으면 로컬 reported 전체가 후보)
```
을 아래 한 줄로 바꾼다.
```markdown
인자: `$ARGUMENTS` (선택: ref 목록. 없으면 로컬 `phase=reported` 작업과, 원격 `origin/agent/*` 브랜치 중 `phase` 가 `merged` 가 아닌 작업이 후보. `api_base` 가 현재 D'Flow 와 다른 후보는 건너뛴다)
```

(2) 18행 `   인 작업 전부. 각각 \`dflow.sh show <ref>\` 로 서버 상태 확인.` 을 아래로 바꾼다(17행은 그대로 둔다).
````markdown
   인 작업 전부(로컬 후보). 여기에 원격 후보를 더한다.
   - `git fetch origin` 뒤 `git branch -r --list 'origin/agent/*'` 의 각 `<ref>` 에서, state.json 경로를
     `git diff --name-only origin/<기본브랜치>...<ref> -- 'docs/tasks/*/state.json'` 로 찾고
     `git show <ref>:<경로>` 로 읽는다. `git show` 에는 glob 을 쓰지 않는다(경로를 해석하지 않는다).
     ```bash
     set -a; . ./.env; set +a; api=${DFLOW_API_BASE%/}
     git fetch origin
     for ref in $(git branch -r --list 'origin/agent/*'); do
       id8=$(printf '%s' "${ref#origin/agent/}" | cut -c1-8)
       git diff --name-only "origin/<기본브랜치>...$ref" -- 'docs/tasks/*/state.json' | while IFS= read -r p; do
         git show "$ref:$p" | jq -r --arg ref "$ref" --arg id8 "$id8" --arg api "$api" \
           'select((.order // "") | startswith($id8)) | select(.phase != "merged")
            | [$ref, .tsk, .order, .phase, (if (.api_base // "") == $api then "same" else "other" end)] | @tsv'
       done
     done
     ```
   - 브랜치 이름의 id8 과 state.json `order` 의 앞 8자가 일치해야 하고, **`phase` 가 `merged` 가 아니면
     전부 후보**로 본다. 이유: tip 의 phase 는 `reported` 커밋이 실패하면 `verify` 에 머물 수 있으므로
     기대지 않는다. 판정은 서버 `show` 로만 하므로 넓게 잡아도 안전하다. 일치하는 state.json 이 없는
     브랜치는 후보가 아니다(아직 state.json 을 커밋하기 전이다).
   - **`api_base` 필터**: 후보 state.json 의 `api_base` 가 현재 `DFLOW_API_BASE`(끝 `/` 제거)와 다르면
     로컬이든 원격이든 "건너뜀(다른 D'Flow)" 로 보고한다. 원격 후보는 값이 없어도 건너뛴다(위 출력 마지막
     칸 `other`). 값이 없는 로컬 후보(이 수정 전에 만든 state.json)는 지금처럼 판정한다. `/dflow-team`
     팀장은 그런 후보가 있으면 시작하지 않는다. 로컬 후보의 값은 아래로 본다.
     ```bash
     find docs/tasks -mindepth 2 -maxdepth 2 -name state.json 2>/dev/null | while IFS= read -r f; do
       jq -r --arg f "$f" --arg api "$api" 'select(.phase == "reported")
         | [$f, .tsk, .order, (if (.api_base // "") == "" then "none" elif .api_base == $api then "same" else "other" end)] | @tsv' "$f"
     done
     ```
     glob(`docs/tasks/*/state.json`)을 쓰지 않는 이유: zsh 에서는 매치가 없으면 `no matches found` 로 명령
     전체가 죽는다. `docs/tasks` 가 없는 리포에서도 `find` 는 조용히 아무것도 내지 않는다.
     이유: 스테이징 D'Flow DB 는 운영을 복제하므로, 스테이징 `.env` 로 실제 리포에서 스윕하면 운영에서
     승인된 작업을 로컬 후보든 원격 후보든 머지할 수 있다. 값이 없는 옛 로컬 후보는 출처를 가릴 수 없으므로
     사람이 보는 수동 경로에만 남긴다.
   - 서버 조회는 state.json 의 전체 UUID 로 한다. 로컬과 원격에 같은 작업이 있으면 order UUID 로 중복을
     없앤다. 원격에만 있는 후보의 머지 대상은 `origin/agent/<id8>-<slug>` 다.
   - show 출력은 jq 로 `.order.status` 와 마지막 `kind=completion` 리포트의 `review_action`·`review_note`·완료
     증적의 `head_sha` 만 뽑는다. 스윕마다 spec 본문을 컨텍스트에 싣지 않기 위해서다. `head_sha` 는 4번의 승인 뒤
     변경 확인에 쓴다.
     ```bash
     j=$(set -a; . ./.env; set +a; .claude/skills/dflow-work/scripts/dflow.sh show <order 전체 UUID>); echo "show=$?"
     printf '%s' "$j" | jq -c '{status: .order.status, last: ([.reports[]? | select(.kind == "completion")] | last | {review_action, review_note, head_sha: .evidence.head_sha})}'
     ```
````

(3) 19행
```markdown
2. **판정 — approved 만 진행**: `status=approved` 가 아니면 건너뛰고 "승인 대기"로 보고.
```
을 아래 한 줄로 바꾼다.
```markdown
2. **판정: approved 만 진행**: 후보마다 아래 중 하나로 보고한다. 승인 대기나 데이터 없음으로 뭉개지 않는다.
```
그리고 20행 `   **approved 확인 전 머지 절대 금지** — 로컬 state 나 기억이 아니라 show 응답이 판정이다.` 바로 뒤에 넣는다.
```markdown
   - `status=approved`: 머지 대상.
   - 마지막 completion 리포트가 `review_action=reject`: "반려: 재작업 필요 (<review_note>)". dflow-dev
     Phase 0 1번의 반려 판정과 같은 기준이다. 반려는 로컬 후보도 state.json 을 고치지 않고 보고만 한다. 이유:
     수동 `/dflow-poll` 의 반려 감지(exit 10)는 로컬 state.json 의 `reported`·`merged` 를 재료로 쓰므로,
     `rejected` 로 바꾸면 그 감지가 사라진다.
   - `status=reported`: "승인 대기".
   - 그 밖의 status: "건너뜀(서버 <status>)".
   - show 가 404(dflow.sh exit 7)이거나 그 밖의 이유로 실패: "건너뜀(조회 실패)".
```

(4) 4번 머지의 코드 블록. 27행 `   git fetch origin && git switch <기본브랜치> && git pull --ff-only origin <기본브랜치>` 바로 뒤에 두 줄을 넣고, 28행을 두 줄로 바꾼다(29행 `   git push origin <기본브랜치>` 는 그대로 남는다). 결과는 아래와 같다.
```markdown
   git fetch origin && git switch <기본브랜치> && git pull --ff-only origin <기본브랜치>
   git rev-parse HEAD                      # 머지 직전 HEAD. 값을 기록해 둔다
   git diff --name-only <증적 head_sha>..<머지 대상>   # 그 작업의 state.json 뿐이거나 비어 있어야 머지한다
   git merge --no-ff <머지 대상> -m "merge: <TSK> <제목> (approved)"   # 로컬 후보 agent/<id8>-<slug>, 원격 전용 후보 origin/agent/<id8>-<slug>
   git add docs/tasks/<TSK>/state.json && git commit -m "chore(<TSK>): phase=merged"   # state.json 을 phase=merged 로 고친 뒤, push 전에
   git push origin <기본브랜치>
```
교체 대상 28행은 아래 원문이다.
```markdown
   git merge --no-ff agent/<id8>-<slug> -m "merge: <TSK> <제목> (approved)"
```

(5) 30행(코드 블록을 닫는 `   ` + 백틱 셋) 바로 뒤, 31행 `` `--no-ff` 고정 … `` 앞에 넣는다.
```markdown
   후보마다 다음 순서로 한다.
   1. `git fetch origin && git switch <기본브랜치> && git pull --ff-only origin <기본브랜치>` 뒤 머지 직전
      HEAD 를 기록한다.
   2. **승인 뒤 변경 확인**: `git diff --name-only <증적 head_sha>..<머지 대상>` 이 그 작업의
      `docs/tasks/<TSK>/state.json` 뿐이거나 비어 있으면 머지하고, 다른 파일이 있으면 "건너뜀(승인 뒤 변경)" 으로
      보고한 뒤 다음 후보로 간다. `<증적 head_sha>` 는 1번 show 출력의 `head_sha` 다. 이유: 원격 후보를 받으므로
      승인 뒤 같은 agent 브랜치에 올라온 커밋까지 머지 대상이 되는데, 사람이 승인한 것은 증적의 head_sha
      까지다. tip 이 head_sha 와 같은지만 보면 `/dflow-dev` Phase 5 의 `reported` 커밋 때문에 늘 다르다. 증적에
      `head_sha` 가 없는 옛 완료 보고는 이 확인을 건너뛰고 지금처럼 머지하되 보고에 "승인 뒤 변경 확인 불가" 를
      붙인다. 수동 경로가 머지하던 후보를 거부하면 퇴행이기 때문이다.
   3. `git merge --no-ff <머지 대상>`. 충돌하면 `git merge --abort` 로 되돌리고 "머지 실패(충돌)" 로
      보고한 뒤 다음 후보로 간다. 이유: 충돌 상태로 남으면 체크아웃이 더러워져, 팀장이면 이후 모든
      기상이 전제 검사에서 멈추고 수동이면 사람이 그 상태를 치워야 한다.
   4. state.json 을 `phase=merged` 로 갱신해 기본 브랜치에 커밋한다(파일명 명시). 이 커밋을 **push 전에**
      만든다.
   5. `git push origin <기본브랜치>` 로 머지와 `merged` 커밋을 한 번에 올린다. 훅에 거부되든 경합으로
      거부되든 push 가 실패하면 `git reset --keep <기록한 HEAD>` 로 되돌리고 보고한 뒤 스윕을 멈춘다.
      다음 실행은 fetch 부터 다시 한다. `origin` 으로 리셋하지 않는다. 이유: 수동 사용자의 기본 브랜치에
      있던 미push 커밋을 보호한다. 훅 거부를 우회하지 않는 것은 그대로다.
```

(6) 5번 뒷정리 34행 `   - state.json \`phase=merged\` 갱신 → 기본브랜치에 커밋(파일명 명시).` 를 지운다(4번 3단계로 옮겼다).

(7) 35행
```markdown
   - 머지된 `agent/` 브랜치 삭제(로컬 + 원격). 아직 미승인 후손 스택 브랜치는 **삭제·rebase
```
를 아래로 바꾼다(36행 `     하지 않는다** — …` 는 그대로 이어진다).
```markdown
   - 머지된 `agent/` 브랜치를 지운다. 원격 agent 브랜치 삭제(`git push origin --delete agent/<id8>-<slug>`)는
     그대로 한다. 로컬 삭제(`git branch -d agent/<id8>-<slug>`)는 브랜치가 없거나(not found) 다른 워크트리가
     잡고 있으면(checked out) 건너뛰고 보고한다. 원격 전용 후보에는 로컬 브랜치가 없고, 팀원 워크트리가 그
     브랜치를 잡고 있을 수 있기 때문이다. 아직 미승인 후손 스택 브랜치는 **삭제·rebase
```

(8) 37행
```markdown
6. **보고**: 머지된 목록 / 승인 대기로 남은 목록 / 건너뛴 목록(사유)을 표로.
```
을 아래로 바꾼다.
```markdown
6. **보고**: 머지됨 / 승인 대기 / 반려: 재작업 필요 (<review_note>) / 머지 실패(충돌) / push 실패(되돌림) /
   건너뜀(서버 <status>·조회 실패·다른 D'Flow·조상 미승인·기점 미반영·승인 뒤 변경·로컬 브랜치 삭제 건너뜀)을
   표로. 반려와 머지 실패(충돌)는 id8 과 함께 따로 적는다. 호출자(`/dflow-team` 팀장 등)가 이 목록으로 후속
   처리를 한다.
```

(9) 3번 순서의 21행
```markdown
3. **순서 — 스택은 조상 먼저**: 대상이 여럿이면 `git merge-base --is-ancestor A B` 로 조상
```
을 아래 한 줄로 바꾼다(22~24행 `   관계를 판정해 조상부터 머지한다. …` 는 그대로 이어진다).
```markdown
3. **순서: 스택은 조상 먼저**: 대상이 여럿이면 브랜치 tip 이 아니라 후보 state.json 의 `branch_base` 로 조상
```
그리고 24행 `   섞인다).` 바로 뒤에 넣는다.
```markdown
   - `branch_base`(기점 커밋. `/dflow-dev` 「--worker」 B 면 선행 완료 증적의 head_sha)가 없거나
     `origin/<기본브랜치>` 의 조상이면 스택이 아니다.
   - 아니면 스택이며, 선행은 `git merge-base --is-ancestor <branch_base> <그 후보의 머지 대상>` 이 참인 다른
     후보다. 그런 선행 후보가 없으면(기점이 main 에 없는데 그 기점을 가진 후보도 없다) "건너뜀(기점 미반영)" 으로
     보고한다.
   - `branch_base` 가 커밋으로 풀리지 않으면(이 수정 전의 state.json 은 브랜치 이름을 적었을 수 있다) 그
     후보만 지금처럼 브랜치 tip 끼리 `git merge-base --is-ancestor A B` 로 판정한다. 수동 경로가 판정하던 옛
     후보를 거부하면 퇴행이기 때문이다.
   - 이유: `/dflow-dev` Phase 5 가 done 뒤 `reported` 를 커밋하므로 선행 tip 은 후속이 기점으로 삼은 커밋보다
     앞서 있어 후속의 조상이 아니다. tip 으로 판정하면 스택을 알아보지 못해, 승인이 철회된 선행 위에 쌓인
     후속만 승인됐을 때 선행의 코드가 main 에 들어간다.
```

- [ ] **Step 5: 통과 확인**

Run: `npx vitest run tests/skills`
Expected: PASS 22건(Task 1 13 + Task 2 9).

- [ ] **Step 6: 커밋**

```bash
git add tests/skills/dflow-merge-remote.test.ts .claude/skills/dflow-merge/SKILL.md
git commit -m "feat(dflow-merge): 원격 agent 브랜치 후보·api_base 필터·보고 분기·충돌과 push 실패 되돌림

팀원 워크트리나 다른 PC 에서 마감한 작업은 state.json 이 agent 브랜치에만 있어 로컬 후보에
안 잡힌다. 원격 tip 을 후보로 넓히되 tip 의 phase 는 reported 커밋이 빠지면 verify 에 머물 수
있어 merged 만 빼고, 스테이징 DB 가 운영을 복제하므로 로컬·원격 모두 api_base 가 다른 인스턴스는 건너뛴다. 반려·
조회 실패가 승인 대기에 묻히지 않게 가르고, 충돌 상태나 push 안 된 merged 커밋이 체크아웃에
남아 이후 스윕을 막지 않게 되돌린다. reported 커밋 뒤에는 tip 이 증적 head_sha 가 아니라서 스택은
branch_base 로 판정하고, 승인 뒤 브랜치에 올라온 커밋은 머지하지 않는다."
```

---

### Task 3: 팀원 프롬프트 정본 `references/worker-prompt.md`

**Files:**
- Create: `.claude/skills/dflow-team/references/worker-prompt.md`
- Create: `tests/skills/dflow-team.test.ts`

**Interfaces:**
- Consumes: `/dflow-dev --worker` (Task 1). 호출 형식 `/dflow-dev {ID8} --worker {MODEL_FLAG}`, 끝의 요약(status·브랜치·head·done exit·사유), 행 C 의 `needs-merge approved`, 행 F·G 의 `skipped`, 행 H 의 의존성 설치와 `failed deps`(워커는 부트스트랩에서 설치하지 않는다), Phase 0 2번의 `failed detach`.
- Produces: 포인터 키 `TSK` `ID8` `AGENT_ID` `MAIN_CHECKOUT` `BACKEND` `MODEL` `ANSWER` 를 읽는 규칙, `.result` 한 줄 형식과 사유 값(`failed` 구분 사유 넷), 워크트리 루트 `.dflow-agent`(격리 확인 직후 기록). Task 4 backends.md 와 Task 5 SKILL.md 가 이 이름·형식을 그대로 쓴다.

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

  it('치환 변수 일곱 개와 포인터 키를 표로 설명하고 AGENT_ID 는 신원/host/slot 이다', () => {
    expect(existsSync(join(SKILL_DIR, 'references/worker-prompt.md'))).toBe(true)
    for (const v of PLACEHOLDERS) expect(p(), v).toContain('`' + v + '`')
    for (const k of ['TSK', 'ID8', 'AGENT_ID', 'MAIN_CHECKOUT', 'BACKEND', 'MODEL', 'ANSWER']) {
      expect(p(), k).toContain('| `' + k + '` |')
    }
    expect(p()).toContain('`<신원>/<host>/w<slot>`')
  })

  it('git 은 절대경로로 부르고, 격리는 git-dir 과 git-common-dir 의 물리 경로로 확인한다', () => {
    expect(p()).toContain('command -v git')
    expect(p()).toContain('bare `git` 금지')
    expect(p()).toContain('_gd=$(cd "$(git rev-parse --git-dir)" && pwd -P)')
    expect(p()).toContain('_cd=$(cd "$(git rev-parse --git-common-dir)" && pwd -P)')
    expect(p()).toContain('[ "$_gd" != "$_cd" ] || { echo "NOT_ISOLATED"; exit 1; }')
    expect(p()).toContain('{TSK} {ID8} - - - failed not-isolated')
    expect(p()).toContain('**아무 파일도 쓰지 않고**')
    expect(p()).not.toContain('show-toplevel')
  })

  it('.dflow-agent 는 격리 확인 직후, 부트스트랩 전에 워크트리 루트에 쓴다', () => {
    const t = p()
    const iso = t.indexOf('NOT_ISOLATED')
    const seat = t.indexOf("printf '%s\\n' '{AGENT_ID}' > .dflow-agent")
    const boot = t.indexOf('ln -s {MAIN_CHECKOUT}/.env .env')
    expect(iso).toBeGreaterThan(-1)
    expect(seat).toBeGreaterThan(iso)
    expect(boot).toBeGreaterThan(seat)
    expect(t).not.toMatch(/docs\/tasks\/\{TSK\}\/\.dflow-agent/)
  })

  it('부트스트랩은 .env·스킬을 링크하고 인증 확인 뒤 origin/<기본브랜치> 로 detach 하며 --worker 를 확인한다', () => {
    expect(p()).toContain('[ -e .env ] || ln -s {MAIN_CHECKOUT}/.env .env')
    expect(p()).toContain('if [ -d .claude/skills ] && [ ! -L .claude/skills ]; then')
    expect(p()).toContain('[ -e ".claude/skills/$s" ] || ln -s "{MAIN_CHECKOUT}/.claude/skills/$s" ".claude/skills/$s"')
    expect(p()).toContain('mkdir -p .claude && ln -s {MAIN_CHECKOUT}/.claude/skills .claude/skills')
    expect(p()).toContain('set -a; . ./.env; set +a; .claude/skills/dflow-work/scripts/dflow.sh doctor; echo "doctor=$?"')
    expect(p()).toContain('git fetch origin && git switch --detach origin/<기본브랜치>')
    expect(p()).toContain('symbolic-ref --short refs/remotes/origin/HEAD')
    expect(p()).toContain('git ls-remote --symref origin HEAD')
    expect(p()).toContain("grep -q -- '--worker' .claude/skills/dflow-dev/SKILL.md || echo NO_WORKER_FLAG")
  })

  it('인증은 doctor 종료 코드가 아니라 me 로 판정하고, 의존성은 설치하지 않는다(/dflow-dev 행 H 가 한다)', () => {
    expect(p()).toContain('dflow.sh me >/dev/null || echo AUTH_FAILED')
    expect(p()).toContain('{TSK} {ID8} - - - failed auth')
    expect(p()).toContain('{TSK} {ID8} - - - failed doctor-<exit>')
    expect(p()).toContain('{TSK} {ID8} - - - failed no-skill')
    expect(p()).toContain('{TSK} {ID8} - - - failed detach')
    expect(p()).toContain('「--worker」 H')
    expect(p()).not.toContain('npm ci')
    expect(p().indexOf('AUTH_FAILED')).toBeLessThan(p().indexOf('git switch --detach origin/<기본브랜치>'))
  })

  it('ANSWER 재spawn 은 fetch 뒤 기존 agent 브랜치로 옮기고 결정을 design.md 에 남기며, 의존성은 재개 직후 행 H 가 깐다', () => {
    expect(p()).toContain('git fetch origin\n  git branch -r --list \'origin/agent/{ID8}-*\'')
    expect(p()).toContain('- 담당자 결정(blocked 응답): {ANSWER}')
    expect(p()).toContain('재개로 agent 브랜치에 들어온 직후 설치한다(「--worker」 H)')
  })

  it('/dflow-dev --worker 로 실행하고 Skill 미등록이면 SKILL.md 를 직접 따른다', () => {
    expect(p()).toContain('/dflow-dev {ID8} --worker {MODEL_FLAG}')
    expect(p()).toContain('`.claude/skills/dflow-dev/SKILL.md` 를 Read 해서')
  })

  it('서버 쓰기는 {ID8} 하나뿐이고 list 를 부르지 않는다', () => {
    expect(p()).toContain('`list` 는 호출하지 않는다')
    expect(p()).toContain('`show {ID8}` 뿐이다')
  })

  it('.result 한 줄 형식, status 다섯, skipped 사유와 failed 구분 사유 넷을 담는다', () => {
    expect(p()).toMatch(/^\{TSK\} \{ID8\} <branch\|-> <head_sha\|-> <done_exit\|-> <status> <한 줄 사유 또는 질문>$/m)
    for (const s of ['done', 'skipped', 'needs-merge', 'blocked', 'failed']) expect(p(), s).toContain('| `' + s + '` |')
    for (const r of ['`선행 미승인`', '`선행 승인 대기`', '`선행을 모두 조상으로 갖는 기점 없음`', '`spec 부재`', '`claim-exit-4`']) {
      expect(p(), r).toContain(r)
    }
    for (const r of ['`rate-limit`', '`not-isolated`', '`no-worker-flag`', '`deps`']) expect(p(), r).toContain(r)
    expect(p()).toContain('docs/tasks/{TSK}/.result')
  })

  it('blocked 는 커밋·push 뒤 쓰고 이후 동작을 BACKEND 두 값으로 가른다', () => {
    expect(p()).toContain('AskUserQuestion 을 쓰지 않는다')
    expect(p()).toContain('현재 산출물을 커밋·push 한 뒤')
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
Expected: FAIL 11건. 파일이 없어 `ENOENT` 또는 `existsSync` 의 `toBe(true)` 실패다.

- [ ] **Step 3: 파일 작성**

````markdown
# /dflow-team 워커 프롬프트 (정본)

> 설계 정본: wbs-web 리포 docs/superpowers/specs/2026-09-10-dflow-team-design.md §5(킷에는 미동봉).

너는 `/dflow-team` 팀장이 띄운 **팀원**이다. 자기 서브에이전트를 띄울 수 있는 진짜 메인 에이전트이며, 작업
한 건을 `/dflow-dev --worker` 로 끝까지 처리하고 `.result` 한 줄로 보고한다. 팀장이 첫 입력으로 보낸 것은 이
파일 전체가 아니라 포인터 한 줄이며, 그 줄의 `KEY=VALUE` 가 아래 변수를 채운다. 이 문서의 규칙이
`/dflow-dev` 본문보다 우선한다.

| 변수 | 포인터 키 | 뜻 |
|---|---|---|
| `{TSK}` | `TSK` | 작업 TSK-ID |
| `{ID8}` | `ID8` | 주문 id8. 모든 참조는 이것으로만 한다(순번 금지) |
| `{AGENT_ID}` | `AGENT_ID` | 좌석표 식별자 `<신원>/<host>/w<slot>` |
| `{MAIN_CHECKOUT}` | `MAIN_CHECKOUT` | 팀장의 상주 체크아웃 절대경로 |
| `{BACKEND}` | `BACKEND` | `pane` 또는 `agent-team`. `blocked` 이후 동작을 가른다 |
| `{MODEL_FLAG}` | `MODEL` | `opus` 면 `--model opus`, `sonnet` 이면 `--model sonnet`, `default` 면 빈 값 |
| `{ANSWER}` | `ANSWER` | 선택. 에이전트 팀에서 `blocked` 뒤 재spawn 할 때만 포인터 둘째 줄로 온다. 있으면 직전 질문에 대한 담당자 결정으로 보고 design.md 에 한 줄 남긴 뒤 이어 간다 |

`<기본브랜치>` 는 `git symbolic-ref --short refs/remotes/origin/HEAD` 가 돌려주는 값에서 `origin/` 을 뗀
이름이다. 이 ref 가 없으면 `git ls-remote --symref origin HEAD` 의 `ref: refs/heads/<이름>` 줄에서 구한다.
`origin/HEAD` 는 clone 할 때만 생기기 때문이다.

## 0. git 호출 규칙 (두 백엔드 공통, 모든 단계)

첫 Bash 호출에서 `command -v git` 을 실행해 나온 절대경로(예 `/usr/bin/git`)를 이 세션의 git 으로 기억한다.
이후 모든 git 호출은 그 절대경로로 한다(bare `git` 금지). 이 문서와 `/dflow-dev` 본문의 `git …` 예시도 그
절대경로로 읽어 실행한다. 이유: 에이전트 팀 백엔드에서는 rtk 가 재작성한 git 을 워크트리 격리 가드가
거부한다. pane 에서는 필요 없지만 무해하고, 백엔드별 분기를 두지 않으려고 공통으로 적용한다.

## 1. 격리 확인 (첫 행동)

```bash
_gd=$(cd "$(git rev-parse --git-dir)" && pwd -P)
_cd=$(cd "$(git rev-parse --git-common-dir)" && pwd -P)
[ "$_gd" != "$_cd" ] || { echo "NOT_ISOLATED"; exit 1; }
```
링크드 워크트리인지를 git 에 직접 묻는다(`git-dir` ≠ `git-common-dir`). 경로 문자열을 `{MAIN_CHECKOUT}` 와
비교하지 않는 이유는 심링크·표기 차이로 같은 체크아웃이 다른 문자열이 될 수 있고, 격리의 정의가 "링크드
워크트리" 이기 때문이다. 두 값을 `cd … && pwd -P` 로 물리 경로로 바꿔 비교하는 이유는 git 이 상대경로를
돌려줄 수 있고, `--path-format` 옵션이 없는 옛 git 에서도 같은 검사가 돌아야 하기 때문이다.

격리에 실패하면(주 워크트리이면) **아무 파일도 쓰지 않고** 마지막 응답으로
`{TSK} {ID8} - - - failed not-isolated` 한 줄만 출력하고 끝낸다. `.result` 를 쓰면 그 파일이 팀장 체크아웃을
더럽혀 전제 검사가 깨지기 때문이다. 팀장은 완료 알림(에이전트 팀)이나 무응답 규칙(pane)으로 이를 안다.

## 2. 좌석 식별 (격리 확인 직후, 부트스트랩 전)

```bash
printf '%s\n' '{AGENT_ID}' > .dflow-agent
```
워크트리 루트에 쓴다. 부트스트랩보다 먼저 쓰는 이유는, 부트스트랩이 실패해도(`failed auth` 등) 그 워크트리가
팀장의 재구성·고아 스캔에 보이게 하기 위해서다. `docs/tasks/{TSK}/` 안에 두지 않는 이유는, `/dflow-dev` 가
claim 하려는 작업의 `docs/tasks/<TSK>/` 가 이미 있으면 이전 시도의 잔재로 보고 `.prev-<날짜>` 로 옮기기
때문이다. 워크트리 하나가 작업 하나라서 루트 파일로도 모호하지 않다.

## 3. 워크트리 부트스트랩

`.env` 는 gitignore 대상이라 새 워크트리에 없으므로 메인 체크아웃에서 심링크한다. `.claude/skills` 는 커밋된
리포면 이미 있고, gitignore 된 심링크로 배포한 리포면 없으므로 없을 때 메인 체크아웃의 것을 심링크한다. 그
다음 인증을 확인하고 기점을 `origin/<기본브랜치>` 로 맞춘다. 줄마다 결과를 보며 실행한다.
```bash
[ -e .env ] || ln -s {MAIN_CHECKOUT}/.env .env
if [ ! -e .claude/skills/dflow-dev/SKILL.md ]; then
  if [ -d .claude/skills ] && [ ! -L .claude/skills ]; then
    for s in dflow-dev dflow-work; do
      [ -e ".claude/skills/$s" ] || ln -s "{MAIN_CHECKOUT}/.claude/skills/$s" ".claude/skills/$s"
    done
  else
    mkdir -p .claude && ln -s {MAIN_CHECKOUT}/.claude/skills .claude/skills
  fi
fi
test -e .claude/skills/dflow-dev/SKILL.md || echo NO_SKILL
set -a; . ./.env; set +a; .claude/skills/dflow-work/scripts/dflow.sh doctor; echo "doctor=$?"
set -a; . ./.env; set +a; .claude/skills/dflow-work/scripts/dflow.sh me >/dev/null || echo AUTH_FAILED
git fetch origin && git switch --detach origin/<기본브랜치>
```
- 스킬 폴더가 실제 폴더로 있는데 `dflow-dev` 가 없으면(스킬 일부만 커밋한 리포) 폴더째 링크하지 않고 워커가
  쓰는 스킬만 하나씩 링크한다. 이유: 있는 폴더에 폴더째 링크를 걸면 `.claude/skills/skills` 가 생겨 스킬을
  찾지 못한다. 그래도 `NO_SKILL` 이면 `{TSK} {ID8} - - - failed no-skill` 을 쓰고 끝낸다.
- doctor 는 진단 출력용이다. `doctor=` 가 0 이 아니면(도구·설정 문제) `{TSK} {ID8} - - - failed doctor-<exit>`
  를 쓰고 끝낸다. doctor 가 0 이어도 `AUTH_FAILED` 면 `{TSK} {ID8} - - - failed auth` 를 쓰고 끝낸다. 이유:
  doctor 는 토큰 인증이 실패해도 그 줄만 출력하고 0 으로 끝나므로, 인증은 `me` 의 성공으로만 판정한다. 설정·
  인증이 깨진 채 claim 하지 않는다.
- 기점 줄은 두 백엔드 공통이다. 이유: 워크트리의 시작 HEAD 는 팀장의 현재 HEAD 이거나 뒤처진 기본 브랜치일
  수 있고, claim 의 선행 도달 검사는 HEAD 를 본다. 스택 기점은 `/dflow-dev` Phase 0 2번이 claim 전에 다시
  맞춘다. 기점 이동이 실패하면 claim 하지 않고 `{TSK} {ID8} - - - failed detach` 를 쓰고 끝낸다. 아직 claim
  전이라 서버에 흔적이 없다.
- `{ANSWER}` 가 있는 재spawn 이면 기점 줄 대신 기존 agent 브랜치로 옮긴다. 이미 claimed 인 작업을 그 브랜치
  위에서 이어 가야 하기 때문이다. `git fetch origin` 뒤 브랜치 이름을 찾아 switch 한다.
  ```bash
  git fetch origin
  git branch -r --list 'origin/agent/{ID8}-*'
  git switch <위 출력에서 origin/ 을 뗀 이름>
  ```
  그 다음 `docs/tasks/{TSK}/design.md` 에 `- 담당자 결정(blocked 응답): {ANSWER}` 한 줄을 남기고(커밋은
  `/dflow-dev` 커밋 규칙을 따른다) 설계 판단에 쓴다. 이 새 워크트리에도 `node_modules` 가 없으므로 의존성은
  `/dflow-dev --worker` 가 재개로 agent 브랜치에 들어온 직후 설치한다(「--worker」 H).
- 의존성은 여기서 설치하지 않는다. `/dflow-dev --worker` 가 브랜치 생성 또는 재개로 agent 브랜치에 들어온
  직후, 기준선과 Phase 1~4 게이트 전에 설치하고 실패하면 `failed deps` 로 끝낸다(「--worker」 H). 이유: 스택이면 기점이 선행 agent 브랜치라 선행
  작업이 lockfile 을 바꿨을 수 있고, 설치할 lockfile 은 그 기점의 것이어야 한다.
- 이 절에서 끝난 실패(`no-skill`·`doctor-<exit>`·`auth`·`detach`)는 브랜치를 만들기 전이므로 branch 칸이 `-` 다.
- `/dflow-dev` SKILL.md 에 `--worker` 가 없으면(옛 버전) 실행하지 않고 `.result` 에
  `{TSK} {ID8} - - - failed no-worker-flag` 를 쓰고 끝낸다. 옛 버전은 기본 브랜치 switch 에서 죽기 때문이다.
  ```bash
  grep -q -- '--worker' .claude/skills/dflow-dev/SKILL.md || echo NO_WORKER_FLAG
  ```
- dflow.sh 를 부를 때마다 `set -a; . ./.env; set +a` 를 앞에 붙인다. env 는 Bash 호출 사이에 남지 않는다.
  리허설 A0 (d) 로 dflow.sh 가 `DFLOW_GIT` 를 받게 됐으면 `DFLOW_GIT=<0번의 git 절대경로>` 도 붙인다.
- 심링크와 `.dflow-agent`·`.result` 는 커밋하지 않는다. 팀장이 공유 `info/exclude` 에 넣어 두고,
  `/dflow-dev` 는 파일명을 명시해 stage 한다.

## 4. 실행

Skill 도구로 `/dflow-dev {ID8} --worker {MODEL_FLAG}` 를 실행한다. 참조는 id8 만 쓰고 순번은 쓰지 않는다.
Skill 도구가 `dflow-dev` 를 모르면(스킬 없는 워크트리에서 세션이 시작돼 등록되지 않은 경우)
`.claude/skills/dflow-dev/SKILL.md` 를 Read 해서 `$ARGUMENTS` 를 `{ID8} --worker {MODEL_FLAG}` 로 놓고 그 절차를
그대로 따른다. 스킬 hot-reload 를 기다리지 않는다. `{ANSWER}` 재spawn 이면 `/dflow-dev` 가 claimed 재개
판정으로 이어받는다.

## 5. 서버 쓰기 범위

`{ID8}` 외의 어떤 주문에도 claim·progress·release·done 을 하지 않는다. `list` 는 호출하지 않는다. 필요한
조회는 `show {ID8}` 뿐이다. 이유: `~/.cache/dflow` 의 목록 캐시를 같은 머신의 팀장·팀원이 공유한다.

## 6. 판단 규칙 (자동 모드)

`--worker` 이므로 AskUserQuestion 을 쓰지 않는다. 명백한 기본값이 있으면 그것을 택하고 결정 내용을 design.md
나 커밋 메시지에 한 줄 남긴 뒤 진행한다. 기본값이 없어 담당자 결정이 꼭 필요할 때만 멈추며, 그때는
**현재 산출물을 커밋·push 한 뒤** `.result` 에 `blocked`(질문과 선택지를 사유 자리에 한 줄로, 예
`질문? (A) … / (B) …`)를 쓴다. 그 다음 동작은 백엔드에 따라 갈린다.

| `{BACKEND}` | `blocked` 이후 |
|---|---|
| `pane` | 질문을 화면에 출력한 채 세션을 멈춘다. 탭이 열려 있으므로 사람이 그 탭에서 답하거나 수동 `/dflow-dev {ID8}` 로 이어받는다. 답을 받아 이어 가면 끝날 때 `.result` 를 새 결과로 덮어쓴다. 슬롯은 계속 점유한다 |
| `agent-team` | 탭이 없어 멈춰 있어도 아무도 못 보므로, 질문을 `.result` 에 남기고 같은 줄을 마지막 응답으로 출력한 뒤 **세션을 끝낸다.** 팀장이 받아 사람에게 전달하고, 답이 오면 팀장이 기존 브랜치로 워커를 다시 띄운다 |

에이전트 팀 팀원도 AskUserQuestion 도구를 갖고 있지만 쓰지 않는다. 슬롯 N개가 각자 질문을 띄우면 사람이
어느 팀원의 질문인지 모른 채 창 N개를 받으므로 질문을 팀장 한 곳으로 모은다.

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
| `skipped` | 착수 전에 멈춤. 팀장은 일시 제외로 다룬다 | `claim-exit-4`, `선행 미충족`, `선행 미승인`, `선행 승인 대기`, `선행을 모두 조상으로 갖는 기점 없음`, `spec 부재` 중 하나 |
| `needs-merge` | 재개 판정이 approved(`/dflow-dev` 「--worker」 C) | `approved` |
| `blocked` | 6번 판단 규칙 | 질문과 선택지 |
| `failed` | 그 밖의 중단(push 훅 거부, 게이트 실패, Verify 재시도 소진, 부트스트랩 실패) | 자유 문구. 팀장이 구분하는 값은 첫 낱말로 쓴다: `rate-limit`(사용량 한도·rate limit 오류로 멈춤, 재시도 가능), `not-isolated`(격리 실패, 파일로는 쓰지 않는다), `no-worker-flag`(옛 `/dflow-dev`), `deps`(의존성 설치 실패) |

- `<branch>` 는 agent 브랜치 이름이고, 브랜치를 만들기 전에 끝났으면 `-` 다.
- `<head_sha>` 는 push 한 agent 브랜치 tip 의 짧은 sha(`git rev-parse --short HEAD`), `<done_exit>` 는
  `dflow.sh done` 의 exit code 다. 해당 없는 칸은 `-`.
````

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run tests/skills`
Expected: PASS 33건(Task 1 13 + Task 2 9 + worker-prompt 11).

- [ ] **Step 5: 커밋**

```bash
git add .claude/skills/dflow-team/references/worker-prompt.md tests/skills/dflow-team.test.ts
git commit -m "feat(dflow-team): 팀원 프롬프트 정본: 격리 확인·좌석 파일·부트스트랩·인증 판정·.result 계약

팀원은 포인터 한 줄로 이 파일을 읽는다. 격리는 경로 문자열이 아니라 git-dir 과 git-common-dir
로 확인하고, 부트스트랩이 실패해도 팀장이 워크트리를 보도록 .dflow-agent 를 먼저 쓴다. doctor 는
인증 실패도 0 으로 끝나므로 인증은 me 로 판정하고, 새 워크트리는 팀장 HEAD 에서 시작하므로 origin
기본 브랜치로 detach 한다. 의존성은 스택 기점의 lockfile 로 깔아야 해서 /dflow-dev 행 H 에 맡긴다.
팀장이 가르는 실패 사유 넷을 고정한다."
```

---

### Task 4: 백엔드·이벤트 참조 `references/backends.md`, `references/events.md`

**Files:**
- Create: `.claude/skills/dflow-team/references/backends.md`
- Create: `.claude/skills/dflow-team/references/events.md`
- Modify: `tests/skills/dflow-team.test.ts` (describe 블록 추가)

**Interfaces:**
- Consumes: 포인터 형식·`.result` 경로·branch `-` 규칙·`.dflow-agent`·알려진 부산물(Task 3).
- Produces: backends.md 의 절 이름 「pane(Orca)」「에이전트 팀」「고아 정리 규칙」, 워크트리 선택자 `--worktree path:<경로>`, `parked` 표시 명령. events.md 의 이벤트 `team.start` `team.spawn` `team.result` `team.blocked` `team.answer` `team.sweep` `team.stop`, 필드, `jq -nc` 기록 명령, 결과 줄 해시·사유 추출 명령. Task 5 SKILL.md 가 이 이름으로 참조하고, 재구성이 `team.spawn`·`team.result`·`team.blocked`·`team.answer` 필드를 읽는다.

- [ ] **Step 1: 테스트 추가** (`tests/skills/dflow-team.test.ts` 끝에)

```ts
describe('dflow-team backends.md·events.md 계약(스펙 §3-5·§4-2·§4-6·§4-8·§4-9·§9-3·§10)', () => {
  const b = () => read('references/backends.md')
  const e = () => read('references/events.md')

  it('에이전트 팀 spawn 은 isolation worktree 가 필수이고 이름은 w<slot>-<id8>, 회수는 TaskStop 이다', () => {
    expect(b()).toContain('| `isolation` | `"worktree"`. **필수.**')
    expect(b()).toContain('| `name` | `w<slot>-<id8>` |')
    expect(b()).toContain('`general-purpose`')
    expect(b()).toContain('TaskStop(w<slot>-<id8>)')
  })

  it('Orca spawn 은 origin/<기본브랜치> 기점이고 터미널 핸들이 없으면 화면 없이 git·서버 증거만 쓴다', () => {
    expect(b()).toContain('--base-branch origin/<기본브랜치> --prompt "<포인터 한 줄>" --json')
    expect(b()).not.toContain('origin/main')
    expect(b()).toContain('`result.worktree.path`')
    expect(b()).toContain('`result.agentTerminalHandle`')
    expect(b()).toContain('`result.startupTerminal.handle`')
    expect(b()).toContain('화면 읽기 없이 git·서버 증거만 쓴다')
    expect(b()).not.toContain('워크트리 id')
  })

  it('Orca 정리는 path 선택자를 쓰고 브랜치 보존 규칙을 적으며, 화면은 생존 증거가 아니다', () => {
    expect(b()).toContain('orca worktree rm --worktree path:<경로>')
    expect(b()).toContain('체크아웃된 로컬 브랜치만 삭제를 시도한다')
    expect(b()).toContain('**화면은 생존 증거로 쓰지 않는다.**')
  })

  it('고아 정리 규칙: 깨끗하고 push 된 것만, 부트스트랩 실패는 알려진 부산물만일 때 --force, 못 지우면 parked, 살아 있는 팀원은 지우지 않고, 생성 브랜치를 정리한다', () => {
    expect(b()).toContain('## 고아 정리 규칙')
    expect(b()).toContain('`<신원>/<host>/`')
    expect(b()).toContain('git worktree remove --force')
    expect(b()).toContain('git -C <워크트리> status --porcelain')
    expect(b()).toMatch(/rev-parse HEAD[\s\S]*rev-parse origin\/<agent 브랜치>/)
    expect(b()).toContain('status --porcelain --untracked-files=all')
    expect(b()).toContain("printf '%s\\n' '<신원>/<host>/parked' > <워크트리>/.dflow-agent")
    expect(b()).toContain('살아 있는 팀원(SKILL.md 「팀장 상태」 정의)의 워크트리는 조건과 무관하게 지우지 않는다')
    // 생성 브랜치 정리: agent/ 가 아니고 origin/<기본브랜치> 의 조상인 생성 브랜치만 지운다
    expect(b()).toContain('**생성 브랜치 정리**')
    expect(b()).toContain("'worktree-<워크트리 디렉터리 이름>' '*dflow-<id8>*'")
    expect(b()).toContain('case "$br" in agent/*) continue ;; esac')
    expect(b()).toContain('git merge-base --is-ancestor "$br" origin/<기본브랜치> && git branch -D "$br"')
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

  it('events.md 는 일곱 이벤트와 스펙 §9-3 추가 필드를 표로 담는다', () => {
    for (const row of [
      '| `team.start` | 「1. 시작」 4번 | `backend`, `slots`, `until` |',
      '| `team.spawn` | 「5. 팀원 spawn」 6번, 「1. 시작」 4번(이어받은 슬롯 재기록) | `slot`, `id8`, `worktree`, `handle` |',
      '| `team.result` | 「3. 결과 처리」, 「1. 시작」 4번(이어받은 해시 재기록) | `slot`, `id8`, `status`, `worktree`, `hash`, `reason` |',
      '| `team.blocked` | 「3. 결과 처리」·「6. blocked」, 「1. 시작」 4번(이어받은 해시·답 대기 재기록) | `slot`, `id8`, `worktree`, `hash`, `reason` |',
      '| `team.answer` | 「6. blocked」 답 매칭, 「1. 시작」 4번(대기 중인 답 재기록) | `id8`, `answer` |',
      '| `team.sweep` | 「4. 승인 스윕」 | `merged`, `waiting`, `rejected` |',
      '| `team.stop` | 「7. 마감」 | 없음 |',
    ]) expect(e(), row).toContain(row)
  })

  it('기록은 jq -nc 한 줄 append 이고 실패해도 막지 않으며 해시·사유를 jq 인자로 넘긴다', () => {
    expect(e()).toContain('jq -nc')
    expect(e()).toContain('>> ~/.dflow/events.jsonl || true')
    expect(e()).toContain('phase:"team"')
    expect(e()).toContain("--arg agent '<신원>/<host>/lead'")
    expect(e()).toContain("cksum | cut -d' ' -f1")
    expect(e()).toContain('--arg reason "$reason"')
    expect(e()).toContain('`failed rate-limit`')
  })
})
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run tests/skills/dflow-team.test.ts`
Expected: 새 describe 8건 FAIL(`ENOENT`), 기존 11건 PASS.

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
| 사람의 답 | 그 팀원 탭에 직접 준다 | 팀장 세션에 `<id8> <답>` 으로 준다. 팀장이 `ANSWER=` 를 붙여 재spawn 한다 |
| 회수 | 없음(별도 프로세스) | 결과 줄 처리 직후 `TaskStop(w<slot>-<id8>)` |
| 팀장 세션이 죽으면 | 팀원은 살아남는다 | 팀원도 함께 죽는다(마지막 push 까지만 남는다) |
| 정리 | `orca worktree rm --worktree path:<경로>` | `git worktree remove --force <경로>` |
| git 호출 | `command -v git` 절대경로 | 같다(두 백엔드 공통) |

## pane(Orca)

**spawn**
```bash
orca worktree create --name dflow-<id8> --agent claude --no-parent \
  --base-branch origin/<기본브랜치> --prompt "<포인터 한 줄>" --json
```
- `<기본브랜치>` 는 SKILL.md 「1. 시작」 전제 검사가 구한 이름이다(`origin/HEAD`, 없으면 `git ls-remote --symref`). 기점을
  `origin/<기본브랜치>` 로 명시하는 이유: agent 브랜치가 결국 머지될 곳이고, 생략하면 리포 기본 base 로 가는데
  그 설정이 기본 브랜치와 다를 수 있다.
- 포인터는 SKILL.md 「5. 팀원 spawn」 의 한 줄 그대로다. 포인터에는 큰따옴표·`$`·백틱이 없다.
- 포인터가 첫 입력으로 자동 제출되어 팀원이 바로 착수한다.
- 결과 JSON 의 `result.worktree.path`(팀원 cwd)와 `result.agentTerminalHandle` 을 슬롯 표와 `team.spawn` 에
  적는다. 옛 런타임은 `result.agentTerminalHandle` 을 주지 않고 `result.startupTerminal.handle` 만 주거나 둘 다
  주지 않는다. `result.agentTerminalHandle` 이 없으면 `handle` 을 `-` 로 두고, 화면 읽기 없이 git·서버 증거만 쓴다.
  ```bash
  jq -r '.result.worktree.path, (.result.agentTerminalHandle // "-")'
  ```
- 이후 이 워크트리를 가리킬 때는 `--worktree path:<result.worktree.path>` 선택자를 쓴다. 워크트리를 경로로
  지정하므로 다른 식별자는 필요 없다.
- 팀원 화면 보기(사람에게 보여 줄 보고용): `orca terminal read --screen --terminal <handle>`.
  **화면은 생존 증거로 쓰지 않는다.** 스피너 때문에 화면이 매번 달라져 멈춘 팀원도 살아 있는 것처럼 보이기
  때문이다. 생존 증거는 SKILL.md 「3. 결과 처리」 의 셋(브랜치 tip 커밋 시각·서버 progress·미커밋 변경 목록)이다.

**정리**
```bash
orca worktree rm --worktree path:<경로>
orca worktree list        # 누수 확인. dflow-<id8> 가 남아 있으면 같은 명령으로 지운다
```
워크트리와 디렉터리를 지우고, 체크아웃된 로컬 브랜치만 삭제를 시도한다. 머지됐음을 입증하지 못하는 브랜치와
워크트리보다 먼저 있던 브랜치는 보존한다. 미커밋분을 잃으므로 먼저 「고아 정리 규칙」 을 따른다.

## 에이전트 팀

**spawn**: Agent 도구로 띄운다.

| 파라미터 | 값 |
|---|---|
| `subagent_type` | `general-purpose`(Skill·Agent·Bash 를 포함한 모든 도구) |
| `name` | `w<slot>-<id8>` |
| `isolation` | `"worktree"`. **필수.** 빠뜨리면 팀원이 팀장 체크아웃을 상속해 서로의 브랜치를 덮어쓰며, 이 실패는 조용하다 |
| `model` | 인자로 받은 모델(`opus`/`sonnet`). 없으면 생략 |
| `description` | `w<slot> <TSK>` |
| `prompt` | 포인터 한 줄. `blocked` 재spawn 이면 둘째 줄에 `ANSWER=<담당자 답 한 줄>` |

- 팀원은 백그라운드로 돈다. 끝나면 완료 알림이 오고, 변경이 남았으면 워크트리 경로·브랜치가 함께 온다.
- 이름에 id8 을 붙이는 이유: 결과 매칭과 회수가 이 이름을 쓰며, 같은 슬롯의 다음 작업과 이름이 겹치지
  않는다. 좌석표 식별은 이름이 아니라 포인터의 `AGENT_ID=` 가 정한다.
- 회수: 결과 줄을 처리한 직후(status 와 무관하며 `blocked` 도 포함한다) `TaskStop(w<slot>-<id8>)`. 이름 붙은
  에이전트는 일을 마쳐도 idle 로 남는다.
- `blocked` 워크트리: 팀원이 커밋·push 하고 끝나므로, 결과 처리 직후 「고아 정리 규칙」 2번을 맞추면(HEAD 가
  `origin/<agent 브랜치>` 와 같으면) 그 자리에서 정리한다. 정리할 수 없으면 `.dflow-agent` 값을 `parked` 로
  바꿔 정규 슬롯 스캔에서 빼고, 고아 규칙으로 보고한다.
  ```bash
  printf '%s\n' '<신원>/<host>/parked' > <워크트리>/.dflow-agent
  ```
  이유: 보존된 워크트리의 `.dflow-agent` 가 `w<slot>` 값을 그대로 가지면, 그 슬롯에 새로 뜬 팀원과 같은 슬롯
  표시를 가져 재구성이 충돌한다.

**정리**: 워크트리가 아직 있을 때만 팀장 체크아웃에서 한다.
```bash
git worktree remove --force <워크트리 경로>
```
`--force` 는 미추적 부산물(`.result`·`.dflow-agent`·`.env` 링크·스킬 링크) 때문에 필요하다. 먼저
「고아 정리 규칙」 을 따른다.

## 고아 정리 규칙

두 백엔드 공통이다. 대상은 루트 `.dflow-agent` 값이 `<신원>/<host>/` 로 시작하는 워크트리(`parked` 포함)다.
결과 처리(done·needs-merge·skipped·failed·에이전트 팀 `blocked`), 고아 스캔, 무응답 자동 정리, 마감이 이
규칙으로 팀원 워크트리를 지운다.
1. **부트스트랩 실패**(`.result` 의 branch 칸이 `-`, 브랜치를 만들기 전에 끝남): 미커밋 목록이 알려진
   부산물(`.dflow-agent`, `.result`, `docs/tasks/<TSK>/spec.md` 캐시, `.env` 링크, 스킬 링크(`.claude/skills` 또는
   그 안의 `dflow-dev`·`dflow-work`))뿐일 때만 정리한다(에이전트 팀은 `git worktree remove --force`, Orca 는
   `orca worktree rm --worktree path:<경로>`).
   ```bash
   git -C <워크트리> status --porcelain --untracked-files=all \
     | grep -v -E '^\?\? (\.dflow-agent|\.env|\.claude/skills(/dflow-(dev|work))?|docs/tasks/<TSK>/(spec\.md|\.result))$'
   ```
   출력이 비어 있어야 한다. 그 밖의 변경이 있으면 보존하고 경로와 목록을 보고한다. 이유: 브랜치가 없어도
   워커가 무언가를 고쳤다면 그것은 사람이 판단할 산출물이다.
2. **그 밖**: 아래 두 조건이 모두 참일 때만 정리한다.
   ```bash
   git -C <워크트리> status --porcelain       # 비어 있어야 한다. 부산물은 info/exclude 로 가려져 있다
   git fetch origin
   test "$(git -C <워크트리> rev-parse HEAD)" = "$(git -C <워크트리> rev-parse origin/<agent 브랜치>)"
   ```
3. 하나라도 거짓이면 지우지 않고, 경로와 미커밋 목록(`git -C <워크트리> status --porcelain` 출력)을
   "재개 필요" 보고에 붙인다. 이유: 느린 팀원이나 커밋 전에 멈춘 팀원의 산출물을 잃지 않는다.
4. 살아 있는 팀원(SKILL.md 「팀장 상태」 정의)의 워크트리는 조건과 무관하게 지우지 않는다. pane 의 `blocked`
   워크트리도 여기에 든다(팀원이 탭에서 답을 기다린다). 예외는 무응답 자동 정리(SKILL.md 「3. 결과 처리」) 하나다.
5. **생성 브랜치 정리**: 워크트리를 지웠으면(에이전트 팀 워크트리가 이미 자동 정리됐어도) 그 워크트리를 만들
   때 생긴 브랜치를 지운다. 에이전트 팀은 `worktree-<워크트리 디렉터리 이름>`, Orca 는 이름에 `dflow-<id8>` 이
   든 브랜치다. `agent/` 로 시작하는 브랜치는 지우지 않는다(작업 산출물이다).
   ```bash
   git fetch origin
   git branch --format='%(refname:short)' --list 'worktree-<워크트리 디렉터리 이름>' '*dflow-<id8>*' | while IFS= read -r br; do
     case "$br" in agent/*) continue ;; esac
     git merge-base --is-ancestor "$br" origin/<기본브랜치> && git branch -D "$br"
   done
   ```
   `git branch -D` 는 다른 워크트리가 체크아웃한 브랜치를 거부하므로 그런 브랜치는 남는다. 이유: 워커가 곧바로
   detach 하므로 생성 브랜치는 체크아웃되지 않은 채 남아 Orca 정리도 지우지 않고, 같은 id8 을 다시 띄우면
   이름이 부딪치며 작업마다 쌓인다. `origin/<기본브랜치>` 의 조상인 것만 지우는 이유는 이름만 맞는 브랜치의
   고유 커밋을 잃지 않기 위해서다. Orca 가 만드는 실제 이름은 리허설이 확인한다.
````

- [ ] **Step 4: `references/events.md` 작성**

````markdown
# /dflow-team 이벤트: `~/.dflow/events.jsonl`

좌석표 설계와 같은 스키마 `{ts, host, repo, tsk, order, phase, event, agent}` 에 이벤트별 추가 필드를 더해
한 줄씩 append 한다. 팀장이 쓰며 `agent` 는 `<신원>/<host>/lead`, `phase` 는 `team` 이다. 기록 실패는 진행을
막지 않는다. 재구성(SKILL.md 「팀장 상태」)이 `team.start` 이후의 `team.spawn`·`team.result`·`team.blocked`·
`team.answer` 를 보조 정본으로 읽는다.

## 이벤트

| 이벤트 | 시점(SKILL.md) | 추가 필드 |
|---|---|---|
| `team.start` | 「1. 시작」 4번 | `backend`, `slots`, `until` |
| `team.spawn` | 「5. 팀원 spawn」 6번, 「1. 시작」 4번(이어받은 슬롯 재기록) | `slot`, `id8`, `worktree`, `handle` |
| `team.result` | 「3. 결과 처리」, 「1. 시작」 4번(이어받은 해시 재기록) | `slot`, `id8`, `status`, `worktree`, `hash`, `reason` |
| `team.blocked` | 「3. 결과 처리」·「6. blocked」, 「1. 시작」 4번(이어받은 해시·답 대기 재기록) | `slot`, `id8`, `worktree`, `hash`, `reason` |
| `team.answer` | 「6. blocked」 답 매칭, 「1. 시작」 4번(대기 중인 답 재기록) | `id8`, `answer` |
| `team.sweep` | 「4. 승인 스윕」 | `merged`, `waiting`, `rejected` |
| `team.stop` | 「7. 마감」 | 없음 |

- `team.start`: `backend` 는 `pane` 또는 `agent-team`, `slots` 는 숫자, `until` 은 `HH:MM`.
- `team.spawn`: 워크트리 경로를 아직 모르면 `worktree` 는 `-`. `handle` 은 Orca 터미널 핸들 또는 에이전트 이름
  `w<slot>-<id8>` 이며 핸들이 없으면 `-`. 기본 필드 `tsk`·`order` 도 채운다.
- `team.result`·`team.blocked`: `blocked` 는 `team.blocked`, 나머지 status 는 `team.result` 로 쓴다. `hash` 는
  결과 줄의 cksum 첫 필드, `reason` 은 결과 줄 7번째 칸부터(사유 또는 질문)다. `worktree` 와 기본 필드 `tsk`
  로 `.result` 경로(`<worktree>/docs/tasks/<tsk>/.result`)가 정해지므로, 재구성이 경로별 마지막 처리 해시를
  유도한다. `status` 는 `.result` 의 status 칸이며, `failed` 이고 사유 첫 낱말이 팀장이 구분하는 값이면
  `failed rate-limit`·`failed not-isolated`·`failed no-worker-flag`·`failed deps` 처럼 붙인다. 결과 줄 없이
  판정한 suspect 는 `failed no-result`(hash `-`)다. 재구성이 이 값으로 제외 목록과 차단기를 복원한다. spec·TSK
  부재로 걸러 spawn 하지 않은 작업은 `slot`·`worktree`·`hash` 를 `-`, `status` 를 `skipped` 로 남긴다.
- `team.answer`: `answer` 는 사람이 준 답 한 줄이다. 같은 id8 의 `team.spawn` 이 그 뒤에 있으면 재spawn 을
  마친 답이다. 에이전트 팀의 `team.blocked` 뒤에 같은 id8 의 `team.answer` 가 없으면 답을 기다리는 질문이다.
- 제외 목록은 id8 마다 마지막 `team.spawn`·`team.blocked`·`team.result` 로 정한다. 마지막이 `team.spawn` 이나
  `team.blocked` 면 진행 중(영구 제외), `team.result` 면 그 `status` 의 제외 칸(SKILL.md 「3. 결과 처리」)이다.
  `team.answer` 는 제외를 바꾸지 않는다.
- `team.sweep`: 세 필드 모두 개수(숫자)다.

## 기록 명령

결과 줄에서 해시와 사유를 뽑는다(`team.result`·`team.blocked`).
```bash
l=$(head -n 1 '<.result 경로>')
hash=$(printf '%s\n' "$l" | cksum | cut -d' ' -f1)
reason=$(printf '%s\n' "$l" | cut -d' ' -f7-)
```
한 줄을 jq 로 만들어 붙인다. 사유·답에 따옴표가 들어가도 JSON 이 깨지지 않게, 문자열은 모두 `--arg` 로 넘기고
숫자만 `--argjson` 으로 넘긴다. 아래는 `team.result` 예이며, 다른 이벤트는 마지막 두 줄의 인자와 추가 객체만
위 표의 필드로 바꾼다.
```bash
mkdir -p ~/.dflow && jq -nc \
  --arg ts "$(date -u +%Y-%m-%dT%H:%M:%SZ)" --arg host "$(hostname -s)" --arg repo '<MAIN_CHECKOUT>' \
  --arg tsk '<TSK 또는 ->' --arg order '<주문 전체 UUID 또는 ->' --arg event 'team.result' --arg agent '<신원>/<host>/lead' \
  --arg slot '<slot 또는 ->' --arg id8 '<id8>' --arg status '<status>' --arg worktree '<워크트리 또는 ->' --arg hash "$hash" --arg reason "$reason" \
  '{ts:$ts,host:$host,repo:$repo,tsk:$tsk,order:$order,phase:"team",event:$event,agent:$agent} + {slot:$slot,id8:$id8,status:$status,worktree:$worktree,hash:$hash,reason:$reason}' \
  >> ~/.dflow/events.jsonl || true
```
- `repo` 는 팀장 체크아웃의 절대경로다. 재구성이 이 값으로 이 리포의 줄만 거른다. 이름만 쓰면 같은 이름의
  클론 둘이 섞인다.
- `<주문 전체 UUID>` 는 show 응답의 `.order.id` 다. 모르면 `-`.
- `slot` 은 문자열(`2` 또는 `-`)로 쓴다. `team.start` 의 `slots` 와 `team.sweep` 의 세 필드는 `--argjson` 숫자다.
````

- [ ] **Step 5: 통과 확인**

Run: `npx vitest run tests/skills`
Expected: PASS 41건(Task 1 13 + Task 2 9 + dflow-team 19).

- [ ] **Step 6: 커밋**

```bash
git add .claude/skills/dflow-team/references/backends.md .claude/skills/dflow-team/references/events.md tests/skills/dflow-team.test.ts
git commit -m "feat(dflow-team): 백엔드별 spawn·정리 정본, 고아 정리 규칙, 이벤트 표

Orca pane 과 에이전트 팀은 기상 신호·blocked 이후·슬롯 점유·회수·정리만 다르다. 차이를 한 표에
모으고, 에이전트 팀은 isolation 을 빠뜨리면 조용히 깨지므로 필수로 못박는다. 팀원 워크트리는
깨끗하고 push 된 것만 지우고, 정리 못 한 에이전트 팀 blocked 워크트리는 parked 로 슬롯 스캔에서
뺀다. 재구성이 결과를 한 번만 처리하도록 결과 줄 해시·사유를 jq 로 기록한다."
```

---

### Task 5: 팀장 절차 `SKILL.md`

**Files:**
- Create: `.claude/skills/dflow-team/SKILL.md`
- Modify: `tests/skills/dflow-team.test.ts` (describe 블록 추가)

**Interfaces:**
- Consumes: 포인터·`.result`·`ANSWER`·사유 값(Task 3), backends.md 절 이름·`--worktree path:` 선택자·`parked` 명령·고아 정리 규칙과 events.md 이벤트·필드·기록 명령(Task 4), `/dflow-merge` 의 보고 분기·충돌 되돌림·push 실패 되돌림(Task 2), `/dflow-dev` 의 `--worker`(Task 1), `poll.sh` exit code(머리말 3~8행: 0 2 3 5 6 7 8 9 10)와 인자 `--require-tag`·`--until`·`--interval`·`--exclude`·`--exclude-temp`, `DFLOW_ENV_FILE`(poll.sh 41행).
- Produces: 사용자가 부르는 `/dflow-team [인원] <종료시각> [모델]`. Task 6 배포 목록과 Task 7~9 리허설이 쓴다.

- [ ] **Step 1: 테스트 추가** (`tests/skills/dflow-team.test.ts` 끝에)

```ts
describe('dflow-team SKILL.md 계약(스펙 §4·§7)', () => {
  const s = () => read('SKILL.md')

  it('파일 넷이 정본 위치에 있고 킷 밖 경로와 zsh 에서 깨지는 셸 구문(따옴표 밖 docs/tasks glob, [ \\> ])을 적지 않는다', () => {
    const merge = readFileSync(join(ROOT, '.claude/skills/dflow-merge/SKILL.md'), 'utf8')
    for (const rel of ['SKILL.md', 'references/worker-prompt.md', 'references/backends.md', 'references/events.md']) {
      expect(existsSync(join(SKILL_DIR, rel)), rel).toBe(true)
      expect(read(rel), rel).not.toContain('~/project/')
    }
    for (const [rel, t] of [...['SKILL.md', 'references/worker-prompt.md', 'references/backends.md', 'references/events.md'].map((r) => [r, read(r)]), ['dflow-merge', merge]]) {
      expect(t, rel).not.toMatch(/[^'`]docs\/tasks\/\*/) // 매치가 없으면 zsh 가 no matches found 로 명령 전체를 죽인다
      expect(t, rel).not.toMatch(/\[ [^\]\n]*\\>/) // zsh 는 condition expected 로 실패한다
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
    expect(s()).toContain('종료시각은 당일 시각만(자정 넘김 불가)')
    expect(s()).toContain('bad "UNTIL_PAST 종료 시각은 당일 시각만(자정 넘김 불가)"')
    expect(s()).toContain('감시 주기는 300초로 고정한다')
    expect(s()).toContain('`agent` 태그를 끈다')
  })

  it('환경 감지는 Orca 면 pane, 그 밖은 에이전트 팀이며 병렬 포기 분기가 없다', () => {
    expect(s()).toContain('ORCA_WORKTREE_ID')
    expect(s()).toContain('v1 은 tmux pane 을 지원하지 않아 에이전트 팀으로 돈다')
    expect(s()).toContain('어느 갈래에서도 병렬 불가로 종료하지 않는다')
  })

  it('전제 검사: 실패하면 종료하는 블록, mkdir 원자 잠금과 beat 70분, 기본 브랜치 폴백, 신원·host 슬러그, ~/.dflow', () => {
    expect(s()).toContain('[ "$fail" = 0 ] || exit 1')
    expect(s()).toContain('LOCK=$(git rev-parse --git-path dflow-team.lock)')
    expect(s()).toContain('mkdir "$LOCK" 2>/dev/null')
    expect(s()).toContain('-lt 4200')
    expect(s()).toContain(`printf '%s %s\\n' "$who/$host/lead" "$(date +%s)" > "$LOCK/owner"`)
    expect(s()).toContain('"$LOCK/beat"')
    expect(s()).toContain('b=$(cat "$LOCK/beat" 2>/dev/null || date +%s)') // beat 없는 잠금은 막 생긴 것이다
    expect(s()).toContain('mv "$LOCK" "$T" 2>/dev/null') // 탈취는 옮긴 뒤 다시 확인한다
    expect(s()).toContain('b=$(cat "$T/beat" 2>/dev/null || date +%s)')
    expect(s()).not.toContain('kill -0')
    expect(s()).not.toContain('$PPID')
    expect(s()).toContain('NOT_DEFAULT_BRANCH')
    expect(s()).toContain('git ls-remote --symref origin HEAD')
    expect(s()).toContain("hostname -s | tr 'A-Z' 'a-z' | sed 's/[^a-z0-9-]/-/g'")
    expect(s()).toContain('mkdir -p ~/.dflow')
  })

  it('전제 검사: 인증은 me 로, api_base 없는 reported 는 거부, 부산물 exclude, 추적 안 된 리포에서만 스킬 패턴, state.json 안내, 수정된 스킬 grep', () => {
    expect(s()).toContain('bad AUTH')
    expect(s()).toContain('종료 코드로 판정하지 않는다')
    expect(s()).toContain('LEGACY_REPORTED')
    expect(s()).toContain('수동 `/dflow-merge` 로 먼저 정리하라')
    for (const p of ["'**/.claude/worktrees/'", "'/.dflow-agent'", "'docs/tasks/*/.result'", "'/.claude/skills'"]) {
      expect(s(), p).toContain(p)
    }
    expect(s()).toContain('git rev-parse --git-path info/exclude')
    expect(s()).toContain('git ls-files .claude/skills')
    expect(s()).toContain('파일명을 명시해 먼저 커밋하라')
    expect(s()).toContain("grep -q -- '--worker' .claude/skills/dflow-dev/SKILL.md")
    expect(s()).toContain("grep -q 'origin/agent/\\*' .claude/skills/dflow-merge/SKILL.md")
  })

  it('매 기상 재구성: 정본은 <신원>/<host>/ 워크트리·.result, 보조는 마지막 team.start 이후 lead 이벤트', () => {
    expect(s()).toContain('git worktree list --porcelain')
    expect(s()).toContain('**깨어날 때마다**')
    expect(s()).toContain('date +%s > "$(git rev-parse --git-path dflow-team.lock)/beat"')
    expect(s()).toContain('case "$a" in "<신원>/<host>/"*) ;; *) continue ;; esac')
    expect(s()).toContain('`<신원>/<host>/parked`')
    expect(s()).toContain('마지막 `team.start` 이후')
    expect(s()).toContain("--arg a '<신원>/<host>/lead'")
  })

  it('재구성 규칙: 슬롯 번호 발급, 살아 있는 팀원 정의, 답을 받은 blocked 는 대기 큐 맨 앞, 고아 스캔', () => {
    expect(s()).toContain('흡수한 번호를 뺀 1..N 중 가장 작은 것')
    expect(s()).toContain('"살아 있는 팀원" 은 spawn 했고 아직 최종 판정')
    expect(s()).toContain('터미널이 떠 있는지로 판단하지 않는다')
    expect(s()).toContain('`team.answer` 에서 복원해 대기 큐 맨 앞에 둔다')
    expect(s()).toContain('**고아 스캔**')
  })

  it('결과 중복 방지: 결과 줄 해시를 경로별 마지막 처리 해시와 비교한다', () => {
    expect(s()).toContain("printf '%s\\n' \"$l\" | cksum | cut -d' ' -f1")
    expect(s()).toContain('경로별 마지막 처리 해시')
    expect(s()).toContain('해시가 다를 때만 처리한다')
  })

  it('재기동 때 이어받은 것(답 대기 blocked 포함)을 team.start 바로 뒤에 다시 기록하고 그 id8 은 재개 필요로 보지 않는다', () => {
    expect(s()).toContain('`team.start` 바로 뒤에')
    expect(s()).toContain('이어받은 팀원이 살아 있지 않은 것으로 보이고 같은 결과가 다시 처리된다')
    expect(s()).toContain('답을 기다리는 에이전트 팀 `blocked` 마다 `team.blocked`')
    expect(s()).toContain('답을 기다리는 `blocked`·대기 중인 답 어디에도 없는 id8')
  })

  it('권한 모드 안내 한 줄을 백엔드별로 출력한다', () => {
    expect(s()).toContain('팀원은 이 세션의 권한 모드를 물려받으며, 권한 확인이 뜨면 알림 없이 멈춘다')
    expect(s()).toContain('팀원은 권한 확인 생략 모드로 뜬다')
  })

  it('감시 루프: 세대 파일로 교체하고 줄 전체(해시)를 비교하며 TICK 은 예정 시각으로 낸다', () => {
    expect(s()).toContain('git rev-parse --git-path dflow-team.gen')
    expect(s()).toContain('echo STALE')
    expect(s()).toContain('RESULT_READY')
    expect(s()).toContain('echo TICK')
    expect(s()).toContain('[ "$(date +%s)" -ge "$TICK_AT" ]')
    expect(s()).toContain("sum=$(printf '%s\\n' \"$cur\" | cksum | cut -d' ' -f1)")
    expect(s()).toContain('**줄 전체를 비교한다.**')
    expect(s()).toContain('run_in_background')
  })

  it('poll 은 docs/tasks 가 없는 빈 디렉터리를 cwd 로, DFLOW_ENV_FILE 로 .env 를 지정해 띄운다(스펙 §4-5 명령)', () => {
    expect(s()).toContain('mkdir -p "$(git rev-parse --git-path dflow-team-poll)"')
    expect(s()).toContain('POLL_DIR=$(cd "$(git rev-parse --git-path dflow-team-poll)" && pwd)')
    expect(s()).toContain('( cd "$POLL_DIR" && DFLOW_ENV_FILE="<MAIN>/.env" \\')
    expect(s()).toContain('"<MAIN>/.claude/skills/dflow-poll/scripts/poll.sh" --require-tag agent --until <HH:MM> --interval 300 \\')
    expect(s()).toContain('[--exclude <id8,id8>] [--exclude-temp <id8,id8>] )')
  })

  it('poll 재기동 조건과 제외 목록: 영구 ∪ 슬롯 id8, 빈 목록은 플래그 생략, 대기 큐 제외 금지, exit 9·10 분기 없음', () => {
    expect(s()).toContain('**재기동 조건**')
    expect(s()).toContain('**영구 제외 ∪ 현재 슬롯의 id8**')
    expect(s()).toContain('**목록이 비면 그 플래그 자체를 생략한다.**')
    expect(s()).toContain('대기 큐는 `--exclude` 에 넣지 않는다')
    expect(s()).not.toMatch(/^\| poll exit (9|10)/m)
  })

  it('SKILL.md 가 쓰는 team.* 이벤트는 events.md 에 전부 정의돼 있다', () => {
    const used = new Set(s().match(/(?<![\w-])team\.[a-z]+/g) ?? [])
    expect(used.size).toBeGreaterThanOrEqual(7)
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

  it('poll exit 0: 영구 제외·슬롯 표와만 다시 대조하고(일시 제외는 보지 않는다) show 는 jq 로 .order.item 경로의 필요한 필드만 뽑는다', () => {
    expect(s()).toContain('영구 제외 목록과 슬롯 표에만 한 번 더 대조해 걸리는 것을 버린다')
    expect(s()).toContain('일시 제외는 대조하지 않는다')
    expect(s()).toContain('id8 마다 마지막 `team.spawn`·`team.blocked`·`team.result` 로 정한다')
    expect(s()).toContain('.order.item.external_ref')
    expect(s()).toContain('.order.item.spec')
    expect(s()).not.toMatch(/`\.item\.(spec|external_ref)`/)
  })

  it('결과 처리: id8 매칭, suspect 와 두 TICK, TaskStop 회수, 차단기, rate-limit·deps, 즉시 정리', () => {
    expect(s()).toContain('**id8 로** 슬롯 표를 찾는다')
    expect(s()).toContain('**`suspect`**')
    expect(s()).toContain('**두 TICK 연속으로 변하지 않을 때만** `failed no-result`')
    expect(s()).toContain('판정할 때는 먼저 `TaskStop(w<slot>-<id8>)` 으로 팀원을 멈춘 뒤 슬롯을 해제한다')
    expect(s()).toContain('그 id8 을 먼저 진행 중 영구 제외에서 빼고')
    expect(s()).toContain('TaskStop(w<slot>-<id8>)')
    expect(s()).toContain('연속 2건')
    expect(s()).toContain('| `failed rate-limit` |')
    expect(s()).toContain('| `failed deps` |')
    expect(s()).toContain('그 자리에서 정리한다')
  })

  it('생존 증거는 브랜치 tip·서버 progress·미커밋 목록이고 화면은 쓰지 않는다', () => {
    expect(s()).toContain('**화면은 생존 증거로 쓰지 않는다.**')
    expect(s()).toContain('git -C <워크트리> log -1 --format=%ct')
    expect(s()).not.toMatch(/terminal read[^\n]*\| cksum/)
  })

  it('무응답은 보고만 하고 슬롯을 유지하며, 자동 정리는 두 TICK 연속일 때만 한다', () => {
    expect(s()).toContain('"무응답" 으로 보고만 하고 슬롯을 유지한다')
    expect(s()).toContain('**두 TICK 연속으로** 생존 증거가 없을 때만')
    expect(s()).toContain('orca worktree rm --worktree path:<경로>')
  })

  it('blocked: pane 은 슬롯 유지, 에이전트 팀은 회수 뒤 정리 또는 parked, 알림은 한 번', () => {
    expect(s()).toContain('**그 슬롯은 blocked 팀원이 계속 잡으며 다른 작업에 재배정하지 않는다.**')
    expect(s()).toContain('`.dflow-agent` 값을 `<신원>/<host>/parked` 로 바꿔')
    expect(s()).toContain('ANSWER=<담당자 답 한 줄>')
    expect(s()).toContain('`already checked out`')
    expect(s()).toContain('PushNotification')
  })

  it('답 매칭: <id8> <답>, 여럿인데 id8 이 없을 때만 되묻고, 대기 큐 맨 앞, parked 면 사람 확인', () => {
    expect(s()).toContain('`<id8> <답>`')
    expect(s()).toContain('어느 작업의 답인지 되묻는다')
    expect(s()).toContain('**대기 큐 맨 앞**')
    expect(s()).toContain('"사람 확인 필요"')
  })

  it('승인 스윕: 인자 없는 /dflow-merge, 반려는 수동 대상, 충돌·경합은 되돌림 뒤 보고', () => {
    expect(s()).toContain('`/dflow-merge` 를 **인자 없이** 실행한다')
    expect(s()).toContain('`api_base` 가 없는 로컬 후보는 전제 검사가 시작 전에 막는다')
    expect(s()).toContain('수동 `/dflow-dev <id8>` 대상')
    expect(s()).toContain('`git reset --keep`')
    expect(s()).toContain('"머지 실패(충돌)"')
    expect(s()).toContain('"사람이 머지해야 함"')
  })

  it('spawn: 포인터 한 줄, 중복 확인, isolation 필수, team.spawn 필드, 기점 명시, path 선택자', () => {
    expect(s()).toContain(
      '<MAIN_CHECKOUT>/.claude/skills/dflow-team/references/worker-prompt.md 를 읽고 그 규칙대로 실행하라. TSK=<TSK> ID8=<id8> AGENT_ID=<신원>/<host>/w<slot> MAIN_CHECKOUT=<팀장 체크아웃 절대경로> BACKEND=<pane|agent-team> MODEL=<opus|sonnet|default>',
    )
    expect(s()).toContain('그 id8 이 재구성한 슬롯 표에 있으면 띄우지 않는다')
    expect(s()).toContain('`isolation: "worktree"` 는 **필수**')
    expect(s()).toContain('`team.spawn` 에 `slot`·`tsk`·`order`·`id8`·`worktree`·`handle`')
    expect(s()).toContain('--base-branch origin/<기본브랜치> --prompt "<포인터 한 줄>" --json')
    expect(s()).toContain('`--worktree path:<result.worktree.path>`')
  })

  it('마감: 대기 상한 TICK 두 번, 마지막 스윕, 살아 있는 팀원 워크트리 보존, agent 브랜치 남김, team.stop, 숫자 비교로 잠금 해제', () => {
    expect(s()).toContain('`TICK` 두 번까지만')
    expect(s()).toContain('마지막 승인 스윕')
    expect(s()).toContain('**살아 있는 팀원의 워크트리는 조건과 무관하게 지우지 않는다.**')
    expect(s()).toContain('**agent 브랜치는 남긴다.**')
    expect(s()).toContain('`team.stop`')
    expect(s()).toContain('[ "${o_ts:-x}" -le "$start" ] 2>/dev/null && rm -rf "$LOCK"')
    expect(s()).toContain('fromdateiso8601')
    expect(s()).not.toContain('rm -f "$(git rev-parse --git-path dflow-team.lock)"')
  })
})
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run tests/skills/dflow-team.test.ts`
Expected: 새 describe 25건 FAIL(SKILL.md 가 없어 `ENOENT`·`existsSync` 실패), 기존 19건 PASS.

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
(팀원 규칙. 팀장은 포인터로 넘기기만 한다), `references/events.md`(events.jsonl 이벤트 표·기록 명령).

이 문서의 `dflow.sh` 는 `.claude/skills/dflow-work/scripts/dflow.sh` 이며, 부를 때마다 `set -a; . ./.env; set +a`
를 앞에 붙인다. `<기본브랜치>` 는 「1. 시작」 전제 검사가 구한 이름이다(`origin/HEAD` 에서 `origin/` 을 뗀 값, 그 ref
가 없으면 `git ls-remote --symref origin HEAD` 의 값).
`<MAIN>`·`<MAIN_CHECKOUT>` 은 팀장 체크아웃의 절대경로, `<신원>`·`<host>` 는 「1. 시작」 전제 검사가 만든
슬러그다.

## 인자

`/dflow-team [인원] <종료시각> [모델]`. 예: `/dflow-team 18:00`, `/dflow-team 4명 18시까지 opus`.

- 인자는 자연어로 해석한다. 플래그 문법을 강제하지 않는다.
- **종료 시각은 유일한 필수 인자다.** 없으면 아래 사용법을 출력하고 종료한다. 무인 야간 실행을 막는
  규칙이며 `/dflow-poll` 과 같다.
  ```
  사용법: /dflow-team [인원] <종료시각> [모델]   예) /dflow-team 18:00 · /dflow-team 4명 18시까지 opus
         종료시각은 당일 시각만(자정 넘김 불가)
  ```
  종료 시각은 새 배정을 멈추는 시각이다. 진행 중인 팀원은 대기 상한까지 기다리고, 그 뒤에 남은 것은
  목록으로 보고한다(「7. 마감」). 이미 지난 시각이나 자정을 넘기는 시각은 받지 않는다(poll.sh 가 자정 넘김을
  지원하지 않는다). 늦은 밤에 새벽 시각을 주면 `UNTIL_PAST` 로 거부되므로, 사용법과 거부 안내 모두에 당일
  시각만 받는다는 것을 적는다.
- 인원은 동시 팀원 슬롯 수다. **기본 3, 하드 상한 4.** 4 를 넘기면 4 로 자르고 그 사실을 한 줄 알린다.
  슬롯마다 독립 메인 에이전트가 떠서 비용과 사용량 한도 소모가 빠르게 늘기 때문이다.
- 모델은 선택이다(`opus`|`sonnet`). 없으면 포인터에 `MODEL=default` 를 넘겨 기본 모델을 쓴다. 값은 팀원이
  `/dflow-dev --model` 로 넘긴다.
- 감시 주기는 300초로 고정한다.
- 작업을 빼는 인자는 없다. 특정 작업을 잡지 않게 하려면 D'Flow 에서 그 작업의 `agent` 태그를 끈다. 팀장
  내부의 제외 목록은 그대로 있다.

## 팀장 상태: 메모리는 캐시다

팀장이 다루는 상태는 슬롯 표(슬롯 번호, `AGENT_ID`, TSK, id8, 워크트리 경로, 터미널 핸들 또는 에이전트
이름, 시작 시각, suspect 표시와 직전 생존 증거), 대기 큐(ready 인데 슬롯이 없어 아직 못 준 id8), 영구 제외
목록(failed·반려·진행 중), 일시 제외 목록(선행·spec 사유), 답을 받았으나 아직 재spawn 하지 못한 `blocked`
작업, 답을 기다리는 에이전트 팀 `blocked` 작업, 결과 줄 경로별 마지막 처리 해시, 차단기 상태, 감지된 백엔드다.
세션 메모리의 이 값들은 캐시일 뿐이며, 팀장은 **깨어날 때마다** 아래 정본에서 다시 만든다. 이유: 몇 시간 도는 세션은 컨텍스트 압축을 겪고, 요약에서
슬롯이 빠지면 `.result` 가 와도 처리되지 않는다.

이 절의 접두는 모두 `<신원>/<host>/` 로 시작한다. 이유: 같은 신원이 다른 PC 에서 띄운 팀장의 워크트리를 이
팀장이 자기 것으로 읽지 않게 한다.

**정본**: 이 신원·이 PC 의 팀원 워크트리와 그 결과.
```bash
git worktree list --porcelain | sed -n 's/^worktree //p' | while IFS= read -r w; do
  [ -f "$w/.dflow-agent" ] || continue
  a=$(head -n 1 "$w/.dflow-agent")
  case "$a" in "<신원>/<host>/"*) ;; *) continue ;; esac
  rf=$(find "$w/docs/tasks" -mindepth 2 -maxdepth 2 -name .result 2>/dev/null | head -n 1)
  r=$([ -n "$rf" ] && head -n 1 "$rf")
  printf '%s\t%s\t%s\t%s\n' "$a" "$w" "$(git -C "$w" branch --show-current)" "${r:--}"
done
```
- 루트 `.dflow-agent` 값이 `<신원>/<host>/w` 로 시작하는 워크트리가 팀원 워크트리이고, 값의 슬롯 번호가 그
  워크트리의 슬롯이다. 값이 `<신원>/<host>/parked` 인 워크트리는 슬롯이 아니며 고아 스캔만 본다.
- 그 워크트리 안의 `docs/tasks/*/.result` 가 팀원의 결과다.
- 그 워크트리의 브랜치 이름 `agent/<id8>-…`(있으면)과 Orca 워크트리 이름 `dflow-<id8>` 이 작업을 알려 준다.

**보조**: `~/.dflow/events.jsonl` 에서 마지막 `team.start` 이후이고 `agent` 가 `<신원>/<host>/lead`, `repo` 가
이 리포(`<MAIN>`)인 줄.
```bash
jq -c --arg a '<신원>/<host>/lead' --arg r '<MAIN>' 'select(.agent == $a and .repo == $r)' ~/.dflow/events.jsonl 2>/dev/null \
  | awk '/"event":"team.start"/{buf=""} {buf=buf $0 "\n"} END{printf "%s", buf}'
```
- `team.spawn` 의 `slot`·`id8`·`worktree`·`handle` 로 슬롯과 작업을 잇는다. 아직 브랜치를 만들지 않은 Phase 0
  의 팀원도 이것으로 id8 을 안다.
- `team.result`·`team.blocked` 로 이미 판정한 작업, 제외 목록(`skipped` 는 일시, `failed`·`failed no-result`·
  `failed not-isolated`·`failed no-worker-flag`·`failed deps`·`blocked` 는 영구, `failed rate-limit` 은 제외
  없음), 차단기 상태(끝에서부터 연속한 `failed…` 수), 결과 줄 경로별 마지막 처리 해시(경로는
  `<worktree>/docs/tasks/<tsk>/.result`)를 복원한다.
- 제외 목록은 id8 마다 마지막 `team.spawn`·`team.blocked`·`team.result` 로 정한다. 마지막이 `team.spawn` 이나
  `team.blocked` 면 진행 중(영구 제외)이고, `team.result` 면 위 status 별 제외다. `team.answer` 는 제외를 바꾸지
  않는다. 이유: 일시 제외가 풀려 다시 띄운 작업이 옛 `skipped` 로 다시 일시 제외되거나, 결과가 난 작업이 진행
  중으로 남지 않게 한다.
- 에이전트 팀의 `team.blocked` 중 그 뒤에 같은 id8 의 `team.answer` 가 없는 것이 답을 기다리는 질문이다.
- `team.answer` 중 그 뒤에 같은 id8 의 `team.spawn` 이 없는 것이 아직 재spawn 하지 못한 답이다.

**재구성 규칙**
- 살아 있는 팀원의 워크트리는 그 `.dflow-agent` 슬롯 번호로 슬롯 표에 흡수한다. 그 안에 `.result` 가 있으면
  처리 여부를 해시로 가린 뒤 처리한다(「3. 결과 처리」).
- 새로 줄 슬롯 번호는 흡수한 번호를 뺀 1..N 중 가장 작은 것이다. 이유: 살아 있는 팀원과 같은 `AGENT_ID` 를
  다시 발급하면 좌석표가 한 인물을 두 책상에 그린다.
- "살아 있는 팀원" 은 spawn 했고 아직 최종 판정(`done`·`needs-merge`·`skipped`·`failed`)을 받지 않은 팀원이다.
  터미널이 떠 있는지로 판단하지 않는다. pane 이면 `.dflow-agent` 가 `w<slot>` 인 워크트리 중 최종 status 의
  `.result` 가 없는 것이며, `blocked` 는 최종 판정이 아니므로 그 팀원은 살아 있다. 실제로 죽은 pane 팀원은
  무응답 규칙(「3. 결과 처리」)이 가려낸다. 에이전트 팀은 같은 세션에서 spawn 했고 결과를 처리하지 않은
  팀원만 해당하며, `blocked` 로 끝난 팀원은 살아 있지 않다. 팀장 세션이 새로 뜬 경우에는 에이전트 팀 팀원이
  하나도 살아 있지 않다고 본다. 팀원은 팀장과 함께 죽기 때문이다.
- 대기 큐는 재구성하지 않는다. 비어 있어도 다음 poll 이 같은 ready 를 다시 찾는다. 예외는 답을 받은
  `blocked` 작업이다. 이 작업은 진행 중으로 영구 제외돼 poll 이 다시 찾지 않으므로 `team.answer` 에서 복원해 대기 큐 맨 앞에 둔다.
- **결과 중복 방지**: 결과 줄은 그 줄의 해시로 식별한다. `.result` 경로마다 events.jsonl 의 `team.result`·
  `team.blocked` 에서 마지막으로 처리한 해시(경로별 마지막 처리 해시)를 유도하고, 현재 줄의 해시가 그와
  해시가 다를 때만 처리한다. 이유: 보존된 `blocked` 워크트리의 같은 질문이 재구성마다 다시 통지되거나 같은
  결과가 두 번 처리되지 않게 하고, 답을 받은 pane 팀원이 새 질문으로 다시 `blocked` 가 되면 그것은 놓치지
  않게 한다. 집계는 order 로 중복을 없앤다. 줄과 해시는 한 번의 Bash 호출로 함께 읽는다.
  ```bash
  l=$(head -n 1 '<경로>'); printf '%s\n' "$l"; printf '%s\n' "$l" | cksum | cut -d' ' -f1
  ```
- **고아 스캔**: 값이 `<신원>/<host>/` 로 시작하는 `.dflow-agent` 워크트리(`parked` 포함) 중 살아 있는 팀원이
  없는 것은 backends.md 「고아 정리 규칙」 대로 깨끗하고(미커밋 변경 없음) HEAD 가 `origin/<그 브랜치>` 와 같은
  것만 정리한다. 나머지는 경로와 미커밋 목록을 "재개 필요" 보고에 붙이고 자동으로 지우지 않는다.
- **부트스트랩 실패 정리**: `.result` 의 branch 가 `-`(브랜치를 만들기 전에 끝남)이면 backends.md
  「고아 정리 규칙」 1번대로, 알려진 부산물만 있을 때만 `--force` 로 정리하고 그 밖의 변경이 있으면 보존하고
  보고한다. 이유: 브랜치가 없어도 워커가 무언가를 고쳤다면 그것은 사람이 판단할 산출물이다.
- state.json 미러 같은 새 저장소는 만들지 않는다. 정본(서버·원격 agent 브랜치·워크트리)과 따로 도는 저장소는
  동기화 규칙을 계속 맞춰야 하기 때문이다.

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

1. **전제 검사**: 아래 블록 하나를 한 번의 Bash 호출로 돌린다. 블록은 실패한 항목을 모두 `FAIL …` 로 출력한 뒤
   0 이 아닌 값으로 끝나고, **exit 가 0 이 아니면 아무것도 띄우지 않고 중단·보고한다.** 이유: 실패를 출력만 하는
   검사는 읽고 넘어가면 그대로 진행된다. `<HHMM>` 은 종료 시각을 네 자리로 쓴 값이다.
   ```bash
   fail=0; bad() { echo "FAIL $*"; fail=1; }
   MAIN=$(git rev-parse --show-toplevel); [ "$MAIN" = "$(pwd -P)" ] || bad NOT_REPO_ROOT
   base=$(git symbolic-ref --short refs/remotes/origin/HEAD 2>/dev/null); base=${base#origin/}
   [ -n "$base" ] || base=$(git ls-remote --symref origin HEAD 2>/dev/null | sed -n 's|^ref: refs/heads/\([^[:space:]]*\)[[:space:]]*HEAD$|\1|p')
   [ -n "$base" ] || bad NO_DEFAULT_BRANCH
   [ -n "$base" ] && [ "$(git branch --show-current)" != "$base" ] && bad "NOT_DEFAULT_BRANCH $base"
   for s in dflow-dev dflow-work dflow-poll dflow-merge dflow-team; do [ -e ".claude/skills/$s/SKILL.md" ] || bad "NO_SKILL $s"; done
   grep -q -- '--worker' .claude/skills/dflow-dev/SKILL.md || bad OLD_DFLOW_DEV
   grep -q 'origin/agent/\*' .claude/skills/dflow-merge/SKILL.md || bad OLD_DFLOW_MERGE
   test -f .env || bad NO_ENV
   (set -a; . ./.env; set +a; .claude/skills/dflow-work/scripts/dflow.sh doctor)   # 진단 출력용. 종료 코드로 판정하지 않는다
   email=$(set -a; . ./.env; set +a; .claude/skills/dflow-work/scripts/dflow.sh me | jq -r '.user_email // empty')
   [ -n "$email" ] || bad AUTH
   who=$(printf '%s' "$email" | cut -d@ -f1 | tr 'A-Z' 'a-z' | sed 's/[^a-z0-9-]/-/g')
   host=$(hostname -s | tr 'A-Z' 'a-z' | sed 's/[^a-z0-9-]/-/g')
   echo "user_email=$email lead=$who/$host/lead"
   legacy=$(find docs/tasks -mindepth 2 -maxdepth 2 -name state.json 2>/dev/null | while IFS= read -r f; do
     jq -e '.phase == "reported" and ((.api_base // "") == "")' "$f" >/dev/null 2>&1 && printf '%s ' "$f"
   done)
   [ -z "$legacy" ] || bad "LEGACY_REPORTED $legacy"
   mkdir -p ~/.dflow
   ex=$(git rev-parse --git-path info/exclude); mkdir -p "$(dirname "$ex")"; touch "$ex"
   for p in '**/.claude/worktrees/' '/.dflow-agent' 'docs/tasks/*/.result'; do
     grep -qxF "$p" "$ex" || printf '%s\n' "$p" >> "$ex"
   done
   [ -n "$(git ls-files .claude/skills | head -n 1)" ] || { grep -qxF '/.claude/skills' "$ex" || printf '%s\n' '/.claude/skills' >> "$ex"; }
   [ -z "$(git status --porcelain)" ] || bad DIRTY
   [ "$(date +%H%M)" -lt <HHMM> ] || bad "UNTIL_PAST 종료 시각은 당일 시각만(자정 넘김 불가)"
   if [ "${TERM_PROGRAM-}" = Orca ] || [ -n "${ORCA_WORKTREE_ID-}" ]; then
     { orca worktree create --help | grep -q -- '--agent' && orca worktree create --help | grep -q -- '--prompt'; } || bad ORCA_OLD
   fi
   [ "$fail" = 0 ] || exit 1
   # 팀장 잠금: 나머지 검사가 모두 통과한 뒤 마지막에 원자 획득한다
   LOCK=$(git rev-parse --git-path dflow-team.lock)
   if ! mkdir "$LOCK" 2>/dev/null; then
     b=$(cat "$LOCK/beat" 2>/dev/null || date +%s)
     if [ $(( $(date +%s) - b )) -lt 4200 ]; then
       echo "LOCKED $LOCK owner=$(cat "$LOCK/owner" 2>/dev/null) beat=$b"; exit 1
     fi
     T="$LOCK.stale.$$"
     mv "$LOCK" "$T" 2>/dev/null || { echo "LOCKED $LOCK"; exit 1; }
     b=$(cat "$T/beat" 2>/dev/null || date +%s)
     if [ $(( $(date +%s) - b )) -lt 4200 ]; then
       echo "LOCKED $LOCK 옮긴 잠금이 새롭다. 다른 팀장이 방금 가져간 것이므로 $T 를 $LOCK 로 되돌려라"; exit 1
     fi
     rm -rf "$T"
     mkdir "$LOCK" 2>/dev/null || { echo "LOCKED $LOCK"; exit 1; }
     echo "STALE_LOCK_TAKEN"
   fi
   printf '%s %s\n' "$who/$host/lead" "$(date +%s)" > "$LOCK/owner"
   date +%s > "$LOCK/beat"
   echo PRECHECK_OK
   ```
   - **팀장 잠금**: 잠금은 디렉터리이며 `mkdir` 로 얻는다. `mkdir` 는 원자적이라 동시에 시작한 팀장 둘 중 하나만
     성공한다. 실패한 검사가 잠금을 남기지 않도록 블록의 마지막에 둔다. 안에 `owner`(`<신원>/<host>/lead` 와
     시작 epoch 초)와 `beat`(epoch 초)를 쓰고, 팀장은 매 기상 `beat` 를 갱신한다(「2-3」). 시작 시각을 epoch 초로
     두는 이유는 「7. 마감」 의 소유 확인을 숫자로 비교하기 위해서다. 기존 잠금의 `beat` 가 70분(4200초)보다
     새로우면 거부한다. `beat` 가 없으면 방금 만들어진 잠금(`mkdir` 와 `beat` 쓰기 사이)으로 보고 새로운 것으로
     친다. 더 오래됐으면 잠금 디렉터리를 `mv` 로 이 팀장만 아는 이름 `$LOCK.stale.$$` 로 옮기고, 옮긴 디렉터리의
     `beat` 를 다시 읽어 여전히 오래됐을 때만 지운 뒤 `mkdir` 로 다시 얻는다. 옮긴 잠금이 새로우면 그사이 다른
     팀장이 가져간 것이므로 옮긴 경로를 알리며 거부하고 사람이 되돌리게 한다. `mv` 나 다시 하는 `mkdir` 가
     실패해도 다른 팀장이 먼저 가져간 것이므로 거부한다. 이유: `beat` 를 다시 읽은 뒤 지우기 전에 다른 팀장이
     먼저 가져가면 그 잠금까지 지우게 되는데, 옮긴 디렉터리는 이 팀장만 보므로 확인과 삭제 사이에 끼어들 틈이
     없다. `LOCKED` 로 거부할 때는 잠금 경로·
     `owner`·`beat` 시각과 함께 "그 팀장이 끝난 것이 확실하면 잠금 디렉터리를 지우고 다시 시작하라" 를 안내한다.
     세션이 죽은 직후 재기동하면 `beat` 가 아직 새롭기 때문이다. 이유: 한 체크아웃의 팀장 둘은 슬롯 번호·세대
     파일·승인 스윕을 서로 덮어쓴다. 프로세스 PID 대신 `beat` 를 쓰는 이유는 셸 블록이 팀장 세션 프로세스의
     PID 를 믿을 만하게 얻을 수단이 없어서다. 살아 있는 팀장은 늦어도 `TICK`(30분)마다 깨어 `beat` 를 갱신하므로,
     70분이면 두 `TICK` 을 연속으로 놓친 것이다.
   - `NO_DEFAULT_BRANCH`·`NOT_DEFAULT_BRANCH`: 기본 브랜치는 `origin/HEAD` 에서 구하고, 그 ref 가 없으면
     `git ls-remote --symref origin HEAD` 에서 구한다(`origin/HEAD` 는 clone 할 때만 생긴다). 팀장 체크아웃의
     현재 브랜치가 그 기본 브랜치여야 한다. 이유: 승인 스윕이 기본 브랜치로 switch 하므로, 다른 브랜치에서
     시작하면 병렬 세션이 쓰는 체크아웃과 심링크가 가리키는 스킬 버전을 흔든다.
   - `OLD_DFLOW_DEV`·`OLD_DFLOW_MERGE`: 수정된 기존 스킬이 적용되지 않았다. 옛 `/dflow-dev` 면 팀원이 기본
     브랜치 switch 에서 죽고, 옛 `/dflow-merge` 면 스윕이 팀원 작업을 영영 보지 못한다.
   - `AUTH`: 인증은 `dflow.sh me` 의 성공(`user_email` 이 나옴)으로 판정한다. doctor 는 진단 출력용이며 종료
     코드로 판정하지 않는다. 이유: doctor 는 토큰 인증이 실패해도 그 줄만 출력하고 0 으로 끝난다. 출력한
     `user_email` 로 `DFLOW_PATS` 첫 토큰이 이 신원의 PAT 인지 보여 주고, 그 값으로 `<신원>` 슬러그를,
     `hostname -s` 로 `<host>` 슬러그를 만든다. 팀원은 `<신원>/<host>/w<slot>`, 팀장은 `<신원>/<host>/lead` 다.
   - `LEGACY_REPORTED`: `api_base` 가 없는 `phase=reported` 로컬 state.json 이 있으면 시작을 거부하고
     "수동 `/dflow-merge` 로 먼저 정리하라" 고 안내한다. 이유: 스테이징 D'Flow DB 는 운영을 복제하므로 출처를 모르는
     로컬 후보를 자동 스윕이 머지할 수 있고, `api_base` 가 없으면 `/dflow-merge` 가 그 출처를 가려내지 못한다.
   - `mkdir -p ~/.dflow`: 이벤트 기록이 디렉터리 부재로 조용히 실패하지 않게 한다.
   - 공유 `info/exclude` 에 워커 부산물 패턴을 없을 때만 넣는다. 커밋하지 않는 로컬 설정이며 링크드
     워크트리가 모두 공유한다. `**/.claude/worktrees/` 는 에이전트 팀 격리 워크트리, `/.dflow-agent`·
     `docs/tasks/*/.result` 는 워커가 쓰는 미추적 파일, `/.claude/skills`(끝 슬래시 없음)는 워커가 만드는 스킬
     심링크다. 끝 슬래시가 붙은 패턴은 디렉터리에만 걸려 심링크를 가리지 못한다. 이 패턴은 **`.claude/skills`
     가 추적되지 않는 리포에서만** 넣는다. 스킬이 커밋된 리포에 넣으면 새로 추가하는 스킬 파일이 무시돼
     `git add` 가 거부되기 때문이다. 이유: 부산물이 `/dflow-dev` Phase 5 의 "미커밋 잔여물 커밋" 에 섞이면,
     브랜치마다 다른 `.dflow-agent` 가 스윕 머지를 충돌시키고 절대경로 심링크가 main 에 들어간다.
   - `DIRTY`: exclude 를 넣은 뒤 `git status --porcelain` 이 비어 있어야 한다. 팀장 체크아웃이 더러우면 승인
     스윕이 위험하다. 실패 안내에 "미커밋 `docs/tasks/*/state.json` 은 파일명을 명시해 먼저 커밋하라(수동
     `/dflow-dev` 가 남긴 것일 수 있다)" 를 넣는다.
   - `UNTIL_PAST`: 종료 시각이 오늘 안의 미래여야 한다. 당일 시각만 받고 자정 넘김은 받지 않으므로(poll.sh 가
     지원하지 않는다) 거부 안내에 그 사실을 적는다. 늦은 밤에 새벽 시각을 준 사람이 이유를 알게 하기 위해서다.
   - `LEGACY_REPORTED` 검사와 이 블록 전체는 bash 와 zsh 모두에서 돈다. state.json 은 glob 대신 `find` 로 찾고,
     결과를 변수로 받아 루프 밖에서 `bad` 를 부른다. 이유: zsh 는 매치 없는 glob 에서 블록 전체를 `FAIL` 줄 없이
     죽이고, bash 는 파이프 안의 `while` 을 서브셸에서 돌려 그 안에서 바꾼 `fail` 이 밖으로 나오지 않는다.
   - `ORCA_OLD`: pane(Orca)이면 `orca worktree create` 가 `--agent`·`--prompt` 를 지원해야 한다.
2. **재구성**: 새 `team.start` 를 쓰기 **전에** 「팀장 상태」 의 재구성과 고아 스캔을 한다. 이유: "마지막
   `team.start` 이후" 필터가 이전 세션의 이벤트를 가리지 않게 한다. 이 단계가 곧 재기동 절차다. 이어서
   서버에 claimed 인데 흡수한 슬롯·고아 워크트리·답을 기다리는 `blocked`·대기 중인 답 어디에도 없는 id8 을
   "재개 필요: 수동 `/dflow-dev <id8>`" 로 보고하고 영구 제외에 넣는다(자동 재착수 없음, 수동 세션이 진행 중인
   작업일 수도 있다). 답을 기다리거나 답을 받은 에이전트 팀 `blocked` 를 빼는 이유: 그 작업은 슬롯을 해제해
   흡수되지 않지만 claimed 로 남아 있고, 4번이 이어받아 답 매칭과 재spawn 을 계속한다.
   ```bash
   (set -a; . ./.env; set +a; .claude/skills/dflow-work/scripts/dflow.sh list --scope claimed) | awk -F'\t' 'NF>=4 {print $4}'
   ```
3. **권한 모드 안내 한 줄**: 에이전트 팀이면
   "팀원은 이 세션의 권한 모드를 물려받으며, 권한 확인이 뜨면 알림 없이 멈춘다" 를,
   pane 이면 "팀원은 권한 확인 생략 모드로 뜬다" 를 출력한다.
4. `team.start`(backend, slots, until)를 기록한다. 2번에서 이어받은 것은 `team.start` 바로 뒤에 같은 필드로
   다시 기록한다: 흡수한 슬롯마다 `team.spawn`, 답을 기다리는 에이전트 팀 `blocked` 마다 `team.blocked`, 아직
   재spawn 하지 못한 답마다 `team.answer`, 흡수한 슬롯의 마지막 처리 해시마다 `team.result` 또는 `team.blocked`.
   이유: 이후 기상의 재구성은 새 `team.start` 이후만 읽으므로, 다시 기록하지 않으면
   이어받은 팀원이 살아 있지 않은 것으로 보이고 같은 결과가 다시 처리된다. 답을 기다리던 질문도 대기 목록에서 사라져 사람이 준 `<id8> <답>`
   이 매칭되지 않고, "기다리는 질문이 하나면 id8 없이 답해도 된다" 가 깨진다.
   그 다음 **승인 스윕**(「4. 승인 스윕」)을 한 번 돌고 결과(머지됨·대기·반려·건너뜀)를 한 줄씩 보고한다.
5. **감시 시작**: 다음 TICK 예정 시각을 지금+1800초로 정하고 「2-2」 대로 감시 루프를 띄운다. 재기동 조건이
   맞으면 poll.sh 도 띄운다(「2-1」). 둘 다 Bash `run_in_background` 로 띄운다. 셸 `&` 는 쓰지 않는다. 종료
   알림이 세션에 오지 않아 루프가 소리 없이 끊기기 때문이다.

## 2. 기상과 감시

팀장은 포그라운드로 기다리지 않는다. 팀장을 깨우는 것은 넷이다: poll.sh 종료(새 작업·시한·오류), 감시 루프
종료(팀원 결과·`TICK`·`STALE`), 에이전트 팀 팀원 완료 알림, 사람이 이 세션에 주는 답.

### 2-1. poll

`docs/tasks/` 가 없는 빈 디렉터리를 cwd 로 두고 띄운다.
```bash
mkdir -p "$(git rev-parse --git-path dflow-team-poll)"
POLL_DIR=$(cd "$(git rev-parse --git-path dflow-team-poll)" && pwd)
( cd "$POLL_DIR" && DFLOW_ENV_FILE="<MAIN>/.env" \
    "<MAIN>/.claude/skills/dflow-poll/scripts/poll.sh" --require-tag agent --until <HH:MM> --interval 300 \
    [--exclude <id8,id8>] [--exclude-temp <id8,id8>] )
```
대괄호는 선택 플래그 표기이며 실제 명령에는 쓰지 않는다. `<MAIN>` 경로는 따옴표로 감싼다. 경로에 공백이 있으면
`DFLOW_ENV_FILE` 값이 끊기고 poll.sh 를 찾지 못해 poll 이 곧바로 죽기 때문이다.
- 빈 디렉터리를 cwd 로 두는 이유: 그러면 승인·반려 감지 재료가 없어 poll exit 9·10 이 팀장에게 절대 오지
  않는다. 9·10 감지는 `--exclude` 를 보지 않으므로, 팀장 체크아웃에 수동 마감한 state.json 이 있으면
  재기동마다 즉시 다시 울려 공회전한다. 팀장은 기상마다 승인 스윕을 하므로 9·10 이 필요 없다.
- `DFLOW_ENV_FILE` 을 주는 이유: poll.sh 는 `.env` 를 `$PWD/.env` 에서 찾는다. dflow.sh 경로는 poll.sh 가 자기
  위치로 풀므로 따로 주지 않는다. `git rev-parse --git-path` 는 상대경로를 돌려줄 수 있어 `cd … && pwd` 로
  절대경로를 만든다.
- `--exclude` 에는 **영구 제외 ∪ 현재 슬롯의 id8** 을 넣는다. 슬롯의 id8 은 재구성으로 복원된다. 이유: 팀원이
  claim 하기 전까지 그 작업은 ready 라서, 넣지 않으면 poll 이 즉시 다시 찾아 짧은 간격으로 서버를 친다.
  `--exclude-temp` 에는 일시 제외 목록을 넣는다.
- 목록은 공백 없는 쉼표 구분이다. **목록이 비면 그 플래그 자체를 생략한다.** 빈 값을 넘기면 poll.sh 가 다음
  플래그를 값으로 삼켜 사용법 오류로 끝난다.
- 대기 큐는 `--exclude` 에 넣지 않는다. 메모리에만 있는 값이 떠 있는 poll 프로세스 안에 숨으면, 컨텍스트
  압축으로 대기 큐를 잃었을 때 그 작업들이 보이지 않는 제외에 갇히기 때문이다.

**재기동 조건**: 빈 슬롯이 있고, 대기 큐가 비었고, 차단기가 풀려 있을 때만 띄운다. poll 은 기동 즉시 첫
조회를 하므로, 슬롯이 찬 채로 띄우면 곧바로 다시 끝나 공회전하고, 대기 큐가 남아 있거나 차단기가 걸려 있으면
찾아도 줄 수가 없다. 예외는 하나다: 차단기가 걸린 `TICK` 에 대기 큐가 비어 시험 spawn 할 후보가 없으면 poll 을
한 번 띄우고, 그 poll exit 0 에서는 1건만 시험 spawn 하고 나머지는 대기 큐에 넣는다. poll 이 떠 있지 않은
구간이 있으므로, 팀장은 기상마다 스스로 시각을 보고 종료 시각이 지났으면 poll exit 8 과 같이 처리한다.

일시 제외는 poll.sh 가 6주기 뒤 스스로 풀어 재발견을 유도하므로, 팀장은 해제 시각을 따로 관리하지 않는다.
풀린 id8 이 다시 발견되면 착수 판정을 다시 하고, 여전히 막히면 다시 일시 제외에 넣는다. 그래서 poll exit 0 의
재대조는 일시 제외 목록을 보지 않는다(「2-3」 표). 팀장이 자기 일시 제외 목록으로 다시 버리면, 같은 목록을 다시
`--exclude-temp` 로 넘겨 그 작업이 그 세션에서 끝내 뜨지 않기 때문이다. poll 을 다른 이유로
재기동하면 6주기 계산이 처음부터 다시 시작된다(poll.sh 프로세스 안에서 세기 때문이다). 재검사가 늦어질 뿐
틀린 착수는 생기지 않는다.

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
`'<워크트리>/docs/tasks/<TSK>/.result|<그 경로의 마지막 처리 해시 또는 ->'` 를 작은따옴표로 넣는다. 에이전트
팀이거나 진행 중 pane 슬롯이 없으면 `set --` 를 비운다(에이전트 팀은 완료 알림이 따로 온다). 경로에 공백이나
작은따옴표가 든 워크트리는 지원하지 않는다.
```bash
GEN_FILE='<세대 파일 절대경로>'; MY_GEN=<세대>; TICK_AT=<다음 TICK epoch 초>
set -- '<워크트리1>/docs/tasks/<TSK1>/.result|<해시1>' '<워크트리2>/docs/tasks/<TSK2>/.result|-'
while :; do
  [ "$(cut -d' ' -f1 "$GEN_FILE" 2>/dev/null)" = "$MY_GEN" ] || { echo STALE; exit 0; }
  hit=''
  for s in "$@"; do
    f=${s%%|*}; prev=${s#*|}
    [ -f "$f" ] || continue
    cur=$(head -n 1 "$f"); sum=$(printf '%s\n' "$cur" | cksum | cut -d' ' -f1)
    [ "$sum" = "$prev" ] || hit="$hit $f"
  done
  [ -n "$hit" ] && { echo "RESULT_READY$hit"; exit 0; }
  [ "$(date +%s)" -ge "$TICK_AT" ] && { echo TICK; exit 0; }
  sleep 20
done
```
- **줄 전체를 비교한다.** status 만 비교하면 답을 받은 팀원이 다시 `blocked` 가 됐을 때 status 가 같아 깨어나지
  않는다. 줄에 따옴표가 든 질문이 올 수 있어 줄 대신 그 해시를 넘긴다.
- 루프는 기동 즉시 넘겨받은 전체 경로를 한 번 전수 검사한 뒤 20초 간격으로 감시한다. 루프를 바꾸는 사이에
  도착한 `.result` 를 놓치지 않기 위해서다.
- 두 백엔드 모두 `TICK_AT` 이 지나면 `TICK` 을 출력하고 끝난다. 한가한 구간에도 30분마다 승인 스윕과 suspect·
  무응답 점검을 하기 위해서다.
- 교체 시점: pane 은 진행 중 슬롯의 경로 집합이나 처리 해시가 바뀔 때와 루프가 끝나 있을 때, 에이전트 팀은
  루프가 끝나 있을 때 새로 띄운다. 컨텍스트 압축 뒤 루프가 떠 있는지 모르면 새로 띄운다. 옛 루프는 `STALE` 로
  끝난다.

### 2-3. 기상마다 하는 일

모든 기상은 먼저 잠금 `beat` 를 갱신한다. `STALE` 은 그것만 하고 넘긴다. 이유: 살아 있는 팀장의 잠금이 70분 뒤
죽은 것으로 보이지 않게 한다(「1. 시작」 팀장 잠금).
```bash
date +%s > "$(git rev-parse --git-path dflow-team.lock)/beat"
```
`STALE` 을 뺀 모든 기상에서는 이어서 이 순서로 한다.
1. 재구성(「팀장 상태」).
2. 아래 표의 처리.
3. 승인 스윕(「4. 승인 스윕」). 스윕을 도는 기상은 시작, 결과 도착(`.result` 또는 완료 알림), `TICK`, poll
   재기동 직전, 마감이다. 이유: 팀장의 poll 에는 exit 9·10 이 오지 않는다. 대가로 승인 반영은 사람이 승인한 뒤
   다음 기상까지 늦어지며, `TICK` 이 있어 최대 30분이다. 이 지연 동안 승인됐으나 main 미반영인 선행은 워커가
   그 `head_sha` 를 스택 기점으로 받고(`/dflow-dev` 「--worker」 B), 승인 대기인 선행의 후속은 `skipped` 로 일시
   제외됐다가 승인·머지 뒤 재검사에서 풀린다(「--worker」 G).
4. 빈 슬롯이 있고 차단기가 허락하면 대기 큐 맨 앞부터 spawn 한다(「5. 팀원 spawn」).
5. 끝나 있는 감시 루프를 다시 띄우고, 재기동 조건(「2-1」)을 만족하면 poll.sh 를 다시 띄운다. 컨텍스트 압축 뒤
   poll 이 떠 있는지 모르면 재기동 조건에 따라 새로 띄운다. poll 이 겹쳐 떠도 poll exit 0 처리의 대조와 spawn 전
   확인(「5. 팀원 spawn」 1번)이 같은 작업을 두 번 띄우지 않게 막는다.

| 기상 | 처리 |
|---|---|
| poll exit 0 (ready N줄) | 각 줄 `순번<TAB>id8<TAB>이름` 에서 순번은 버리고 id8 만 쓴다. 먼저 후보를 영구 제외 목록과 슬롯 표에만 한 번 더 대조해 걸리는 것을 버린다. 이유: 겹쳐 뜬 옛 poll 은 옛 제외 목록으로 돌고 있을 수 있다. 일시 제외는 대조하지 않는다. poll.sh 가 6주기 뒤 풀어 돌려준 것을 그대로 다시 판정해야 하기 때문이며(「2-1」), 대가로 겹쳐 뜬 옛 poll 이 막 일시 제외한 작업을 돌려주면 한 번 더 띄워 `skipped` 로 끝난다. 남은 후보마다 아래 show 필터로 `.order.item.spec` 이 비었는지만 본다(spec 본문을 컨텍스트에 싣지 않는다). 비었거나 `ref` 가 비면 일시 제외에 넣고 사유(spec 부재·TSK 없음)를 보고하며 `team.result`(slot `-`, status `skipped`)를 남긴다. 남은 것을 빈 슬롯 수만큼 spawn 하고 나머지는 대기 큐 끝에 넣는다. 차단기가 걸려 있으면 spawn 하지 않고 대기 큐에 넣는다(시험 spawn 예외는 「2-1」 재기동 조건). 대기 큐를 잃어도 그 작업들은 아직 ready 이므로 다음 poll 이 다시 찾는다 |
| poll exit 8 (시한) | 새 배정을 멈춘다. 대기 큐를 비우고(보고만 한다) 「7. 마감」 으로 간다 |
| poll exit 2·3·5·6·7 | 중단 사유(stderr)를 보고하고 「7. 마감」 으로 간다 |
| `RESULT_READY <경로…>` (pane) | 경로마다 「3. 결과 처리」 |
| 에이전트 팀 완료 알림 | 「3. 결과 처리」 |
| 사람의 답 | 「6. blocked」 의 답 매칭 |
| `TICK` | 다음 TICK 예정 시각을 지금+1800초로 새로 정한다. suspect 슬롯과 무응답 슬롯의 생존 증거를 잰다(「3. 결과 처리」). 차단기가 걸려 있으면 시험 spawn 1건을 허용한다 |
| `STALE` | 잠금 `beat` 만 갱신하고 나머지는 넘긴다 |

poll exit 0 의 show 필터:
```bash
(set -a; . ./.env; set +a; .claude/skills/dflow-work/scripts/dflow.sh show <id8>) \
  | jq -c '{order: .order.id, ref: .order.item.external_ref, spec_empty: ((.order.item.spec // "") | length == 0)}'
```

## 3. 결과 처리

**결과 줄 찾기**
- pane: 감시 루프가 알린 경로의 `.result` 한 줄이다.
- 에이전트 팀: 완료 알림의 이름 `w<slot>-<id8>` 에서 **id8 로** 슬롯 표를 찾는다. 슬롯 번호로 찾지 않는 이유는
  이미 판정한 옛 팀원의 늦은 알림이 같은 슬롯의 새 작업을 오판하게 만들기 때문이다. 표에 없는 id8(이미 판정한
  것)의 알림은 집계만 갱신하고 슬롯을 건드리지 않는다. 표에 있으면 그 워크트리의 `docs/tasks/<TSK>/.result` 를
  읽고, 워크트리가 이미 정리돼 파일이 없으면 알림에 담긴 마지막 응답에서 `<TSK> <id8> ` 로 시작하는 줄을 찾는다.
- 에이전트 팀에서 두 곳 모두 결과 줄이 없으면 `failed` 가 아니라 **`suspect`** 로 표시하고 슬롯을 유지한다.
  팀원이 손자 서브에이전트를 기다리며 턴을 끝낸 것일 수 있기 때문이다. 그 뒤 매 `TICK` 에 생존 증거를 재고,
  **두 TICK 연속으로 변하지 않을 때만** `failed no-result` 로 판정한다.
  판정할 때는 먼저 `TaskStop(w<slot>-<id8>)` 으로 팀원을 멈춘 뒤 슬롯을 해제한다. 이유: 멈추지 않으면 살아 있던
  팀원과 그 슬롯에 새로 뜬 팀원이 같은 `AGENT_ID` 로 돈다. 그 사이에 `.result` 가 생기거나 알림이 다시 오면 정상 처리한다.
- 줄 형식은 `<TSK> <id8> <branch|-> <head|-> <done_exit|-> <status> <사유…>` 다. 줄과 해시는 「팀장 상태」 의 한
  줄 명령으로 함께 읽고, 해시가 그 경로의 마지막 처리 해시와 같으면 처리하지 않는다.

**생존 증거**: 아래 중 하나라도 직전 `TICK` 과 달라지면 살아 있는 것이다. 슬롯의 첫 `TICK` 은 기록만 한다.
```bash
git -C <워크트리> log -1 --format=%ct                                        # 1. 워크트리가 있으면 HEAD 커밋 시각
git fetch origin && git log -1 --format=%ct 'origin/agent/<id8>-<slug>'   # 1. 워크트리가 없으면 원격 tip 커밋 시각
(set -a; . ./.env; set +a; .claude/skills/dflow-work/scripts/dflow.sh show <id8>) | jq -r '[.reports[]?] | last | .created_at // empty'   # 2. 서버 최신 progress
git -C <워크트리> status --porcelain | cksum                                 # 3. 미커밋 변경 목록
```
**화면은 생존 증거로 쓰지 않는다.** Orca 화면(`orca terminal read`)은 보고용으로만 읽는다. 스피너 때문에 화면이
매번 달라져 멈춘 팀원도 살아 있는 것처럼 보이기 때문이다. 터미널 핸들이 없는 옛 런타임에서는 화면을 읽지 않고
위 셋만 쓴다.

**status 별 처리**: 결과 줄은 경로별 마지막 처리 해시와 다를 때만 처리하며, `blocked` 는 `team.blocked`,
나머지는 `team.result` 로 해시·사유와 함께 기록한다(events.md). 모든 결과는 집계에 넣는다. 결과를 처리할 때는
그 id8 을 먼저 진행 중 영구 제외에서 빼고, 아래 표의 제외 칸대로 일시·영구 제외를 새로 정한다. 이유: 「5. 팀원
spawn」 6번이 넣은 진행 중 제외가 남으면 `skipped`(일시 제외)와 `failed rate-limit`(제외 없음)의 재시도가 영영
막힌다.

| status | 슬롯 | 제외 | 워크트리 | 그 밖 |
|---|---|---|---|---|
| `done` | 해제 | 없음 | HEAD 가 `origin/<agent 브랜치>` 와 같으면 그 자리에서 정리한다. 다르면 경로를 보고하고 남긴다 | 대기 큐가 있으면 그 슬롯에 spawn 한다. 비어 있으면 poll 재기동 조건(「2-1」)을 따른다 |
| `needs-merge` | 해제 | 없음 | `done` 과 같다 | 승인 스윕을 곧바로 한다 |
| `skipped`(선행 미충족·선행 미승인·선행 승인 대기·claim exit 4·공통 기점 없음·spec 부재) | 해제 | 일시 제외 | branch 가 `-` 면 부트스트랩 실패 정리 규칙, 아니면 `done` 과 같다 | 사유 보고 |
| `blocked` | pane 은 유지, 에이전트 팀은 해제 | 진행 중으로 영구 제외에 남긴다 | pane 은 그대로 둔다. 에이전트 팀은 HEAD 가 `origin/<agent 브랜치>` 와 같으면 그 자리에서 정리하고, 정리할 수 없으면 `.dflow-agent` 값을 `<신원>/<host>/parked` 로 바꿔 슬롯 스캔에서 빼고 고아 규칙으로 보고한다 | 통지(「6. blocked」) |
| `failed <사유>` | 해제 | 영구 제외 | 고아 정리 규칙을 따른다 | 사유 보고, 차단기 계산 |
| `failed rate-limit` | 해제 | 제외하지 않는다 | 고아 정리 규칙을 따른다 | 재시도할 수 있다. 아직 ready 면 poll 이 다시 찾고, 이미 claimed 면 "재개 필요" 로 보고한다. 차단기 계산에 넣는다 |
| `failed no-result`(suspect 판정) | 먼저 `TaskStop` 한 뒤 해제 | 영구 제외 | 고아 정리 규칙을 따른다 | 차단기 계산 |
| `failed not-isolated` | 해제 | 영구 제외 | 없음(워커가 파일을 쓰지 않았다) | 백엔드 결함이므로 새 spawn 을 멈추고 「7. 마감」 으로 간다 |
| `failed deps` | 해제 | 영구 제외 | 고아 정리 규칙을 따른다 | 사유 보고, 차단기 계산. 설치는 claim 과 브랜치 생성 뒤라서(`/dflow-dev` 「--worker」 H) 서버에 claimed 로 남으므로 "재개 필요" 로 보고한다. 대상 리포의 lockfile·패키지 관리자 문제라 사람이 고친다 |

- **그 자리에서 정리하는 이유**: git 은 다른 워크트리가 체크아웃한 브랜치를 지우지 못한다. 워크트리를 마감까지
  남기면 같은 세션에서 승인된 작업의 로컬 agent 브랜치 삭제가 실패한다. 정리 명령은 backends.md 의 백엔드별
  「정리」 와 「고아 정리 규칙」 이며, 워크트리를 지웠으면 그 규칙 5번의 생성 브랜치 정리까지 한다.
- **에이전트 팀 `blocked` 워크트리를 남기지 않는 이유**: 팀원이 커밋·push 하고 끝나므로 보통 바로 정리할 수
  있다. 보존된 워크트리의 `.dflow-agent` 가 `w<slot>` 값을 그대로 가지면, 그 슬롯에 새로 뜬 팀원과 같은 슬롯
  표시를 가져 재구성이 충돌한다. `parked` 로 바꾸면 슬롯 스캔에서 빠진다.
- **회수**: 에이전트 팀에서는 결과 줄을 처리한 직후(status 와 무관하며 `blocked` 도 포함한다)
  `TaskStop(w<slot>-<id8>)` 으로 idle 팀원을 회수한다. 이름 붙은 에이전트는 일을 마쳐도 idle 로 남기 때문이다.
  pane 팀원은 별도 프로세스라서 TaskStop 대상이 아니다.
- **차단기**: 결과가 도착한 순서로 `failed`(`no-result`·`rate-limit` 포함)가 연속 2건이면 새 spawn 을 멈추고
  보고한다. `failed` 가 아닌 결과가 오면 연속 수를 0 으로 되돌린다. 걸린 동안에는 다음 `TICK` 마다 1건만 시험
  spawn 하고(대기 큐 맨 앞에서, 큐가 비었으면 poll 을 한 번 띄워 얻는다), 그 결과가 `failed` 가 아니면 차단기를
  푼다. 이유: 사용량 한도나 환경 결함에 걸린 채 대기 큐 전체를 소진하지 않게 한다.
- **무응답**: 결과도 알림도 없는 진행 슬롯의 생존 증거가 한 `TICK` 동안 변하지 않으면 "무응답" 으로 보고만 하고 슬롯을 유지한다.
  느린 팀원을 죽이면 미커밋분을 잃고, 권한 확인에 걸려 멈춘 팀원은 사람이 보면 풀리기 때문이다. 자동 정리는
  **두 TICK 연속으로** 생존 증거가 없을 때만 한다. 에이전트 팀은 먼저 `TaskStop` 으로 팀원을 멈추고 슬롯을
  해제하며, 워크트리는 고아 정리 규칙을 따른다. pane 은 팀원 프로세스를 멈출 수단이 워크트리 삭제뿐이므로,
  깨끗하고 push 된 경우에만 `orca worktree rm --worktree path:<경로>` 로 정리하고 슬롯을 해제한다. 그렇지
  않으면 슬롯을 계속 잡고 "사람 확인 필요" 로 보고한다. 자동 정리한 작업은 영구 제외에 넣고 "재개 필요" 로
  보고한다.

## 4. 승인 스윕

Skill 도구로 `/dflow-merge` 를 **인자 없이** 실행한다. 후보가 원격 `origin/agent/*` tip 에서도 오므로 팀장
체크아웃의 state.json 유무와 무관하다. 판정은 서버 `show` 로만 하고 approved 만 머지한다. 후보는 state.json 의
`api_base` 가 팀장의 `DFLOW_API_BASE` 와 같은 것만 받는다. `api_base` 가 없는 로컬 후보는 전제 검사가 시작 전에 막는다(「1. 시작」 `LEGACY_REPORTED`).
- **반려**: 반려로 보고된 id8 은 "반려: 수동 `/dflow-dev <id8>` 대상 (<review_note>)" 로 보고하고 영구 제외에
  넣는다. 재작업은 기존 agent 브랜치 위에서 해야 하므로 자동 배정하지 않는다.
- **다중 경합**: 두 팀장의 스윕이 같은 브랜치를 머지하려 하면 나중 쪽 `git push` 가 non-fast-forward 로
  거부된다. 그러면 `/dflow-merge` 가 머지 직전 HEAD 로 `git reset --keep` 해 되돌리고 보고한 뒤 스윕을 멈춘다.
  다음 기상의 스윕이 fetch 부터 다시 하며, 그 사이에 머지된 것은 후보에서 빠진다.
- **머지 충돌**: `/dflow-merge` 가 `git merge --abort` 로 되돌리고 "머지 실패(충돌)" 로 보고한 뒤 다음 후보로
  간다. 팀장은 그 id8 을 "사람이 머지해야 함" 으로 보고한다. 팀장 체크아웃은 깨끗하게 남아 다음 기상의 전제가
  깨지지 않는다.
- 로컬 agent 브랜치 삭제가 브랜치 없음이나 "checked out" 오류로 실패하면 `/dflow-merge` 가 건너뛰고 보고한다.
  그 워크트리는 결과 처리나 고아 스캔이 정리한다.
- 승인 대기·건너뜀(서버 <status>·조회 실패·다른 D'Flow)은 보고만 한다.
- `team.sweep`(merged, waiting, rejected 개수)을 기록한다.
- 스윕은 팀장 체크아웃에서 기본 브랜치로 switch 한다. 팀장 체크아웃은 전제 검사로 이미 기본 브랜치에 있고,
  팀원은 각자 워크트리의 agent 브랜치나 detached HEAD 에 있으므로 충돌하지 않는다.

## 5. 팀원 spawn

1. 그 id8 이 재구성한 슬롯 표에 있으면 띄우지 않는다. poll 이 겹쳐 떠서 같은 ready 를 두 번 돌려줘도 한 번만
   띄우기 위해서다.
2. 슬롯 번호를 정하고(「팀장 상태」 의 발급 규칙) `AGENT_ID = <신원>/<host>/w<slot>` 을 만든다.
3. TSK 는 show 필터의 `ref`(`.order.item.external_ref`)에서 마지막 `/` 뒤, order 는 `.order.id` 다.
4. 포인터 **한 줄**을 만든다. 백엔드에는 워커 프롬프트 전문이 아니라 이 포인터를 넘기고, 워커가
   `references/worker-prompt.md` 를 읽어 그 규칙대로 실행한다. 포인터는 치환 변수만 전달한다.
   ```
   <MAIN_CHECKOUT>/.claude/skills/dflow-team/references/worker-prompt.md 를 읽고 그 규칙대로 실행하라. TSK=<TSK> ID8=<id8> AGENT_ID=<신원>/<host>/w<slot> MAIN_CHECKOUT=<팀장 체크아웃 절대경로> BACKEND=<pane|agent-team> MODEL=<opus|sonnet|default>
   ```
   - 전문을 셸 인자로 넘기면 백틱·따옴표·여러 줄이 섞여 깨진다(Orca `--prompt` 자동 제출은 한 줄에서 확인됐다).
   - 워커 프롬프트 경로를 절대경로로 주는 이유: 새 워크트리에 스킬이 없을 수 있다.
   - 모델은 공백이 든 `--model opus` 를 넘기지 않고 `MODEL=` 로 넘기며, 워커가 `{MODEL_FLAG}` 로 바꾼다
     (`default` 면 빈 값).
   - 에이전트 팀 `blocked` 재개 때만 둘째 줄에 `ANSWER=<담당자 답 한 줄>` 을 붙인다(「6. blocked」). Agent 도구는
     셸 인자가 아니라서 여러 줄이 안전하다.
5. backends.md 의 해당 절 명령 그대로 띄운다.
   - **pane(Orca)**:
     ```
     orca worktree create --name dflow-<id8> --agent claude --no-parent \
       --base-branch origin/<기본브랜치> --prompt "<포인터 한 줄>" --json
     ```
     기점은 agent 브랜치가 결국 머지될 `origin/<기본브랜치>` 로 명시한다. 생략하면 리포 기본 base 로 가는데,
     리포 기본 base 설정이 기본 브랜치와 다를 수 있기 때문이다. 결과 JSON 의 `result.worktree.path` 와
     `result.agentTerminalHandle` 을 슬롯 표에 저장한다. 핸들이 없으면(옛 런타임) 화면 읽기 없이 git·서버
     증거만 쓴다. 이후 이 워크트리를 가리킬 때는 `--worktree path:<result.worktree.path>` 선택자를 쓴다.
   - **에이전트 팀**: Agent 도구로 띄우고 같은 포인터를 넘긴다. `isolation: "worktree"` 는 **필수**다. 빠뜨리면
     팀원이 팀장 cwd 를 상속해 서로를 덮어쓴다. `name` 은 `w<slot>-<id8>`(슬롯이 앞에 있어 사람이 알아보고,
     id8 이 붙어 같은 슬롯의 다음 작업과 이름이 겹치지 않는다), `subagent_type` 은 `general-purpose`, `model` 은
     인자로 받은 모델이다. 격리 워크트리는 팀장의 현재 HEAD 에서 시작하지만, 워커 부트스트랩이
     `origin/<기본브랜치>` 로 detach 하고 스택 기점은 `/dflow-dev` Phase 0 2번이 claim 전에 맞춘다. 그래서
     팀장이 따로 기점을 정하지 않는다.
6. spawn 직후 `team.spawn` 에 `slot`·`tsk`·`order`·`id8`·`worktree`·`handle` 을 남긴다. 워크트리 경로를 아직
   모르면 `worktree` 는 `-` 로 두고, `handle` 은 Orca 터미널 핸들 또는 에이전트 이름이며 핸들이 없으면 `-` 다.
   재구성이 이 기록으로 슬롯과 작업을 잇는다. id8 을 영구 제외(진행 중)에 넣는다.

같은 작업을 다시 띄우는 것은 poll 이 그 작업을 다시 돌려준 경우(일시 제외가 풀린 `skipped`, 제외하지 않는
`failed rate-limit`)와 에이전트 팀의 `blocked` 재개뿐이다. 그 밖의 재개는 사람 몫이다. 다시 띄울 때 이름·브랜치가
부딪치지 않는 것은 backends.md 「고아 정리 규칙」 5번의 생성 브랜치 정리가 맡는다.

## 6. blocked

**공통**: 사람에게 AskUserQuestion 으로 묻지 않는다(자동 루프). 결과 처리가 `team.blocked` 를 기록한다.
PushNotification 도구가 있으면(지연 로드면 ToolSearch 로 불러) 질문 요약으로 한 번 알린다. 없으면 화면 통지만
한다. 그 id8 은 진행 중으로 영구 제외에 남긴다.

**pane**: "결정 필요 <id8>: <질문>. Orca 의 `dflow-<id8>` 탭에서 답하라" 고 알린다.
**그 슬롯은 blocked 팀원이 계속 잡으며 다른 작업에 재배정하지 않는다.** 살아 있는 프로세스 둘이 같은
`AGENT_ID` 로 heartbeat 를 보내면 좌석표가 한 인물을 두 책상에 그리고 손 든 상태가 새 active 에 덮이기
때문이다. 사람이 탭에서 답하면 팀원이 같은 워크트리·브랜치에서 이어 가고(재spawn·재claim 없음), `.result` 가
새 줄로 바뀌면 감시 루프가 알린다.

**에이전트 팀**: 결과 처리 직후 `TaskStop(w<slot>-<id8>)` 으로 회수하고 슬롯을 해제한다. 워크트리는 HEAD 가
origin tip 과 같으면 즉시 정리하고, 아니면 `.dflow-agent` 값을 `<신원>/<host>/parked` 로 바꿔 둔다
(「3. 결과 처리」). "결정 필요 <id8>: <질문>. 이 세션에 `<id8> <답>` 으로 답하라" 고 알린다. 팀원이 이미
끝났으므로 슬롯을 비워도 `AGENT_ID` 가 겹치지 않는다.

**답 매칭(에이전트 팀 `blocked`)**
- 답은 `<id8> <답>` 형식으로 받는다. 이유: 여러 팀원의 질문이 동시에 쌓일 수 있다.
- 답을 기다리는 `blocked` 가 하나뿐이면 id8 없이 온 답도 그 작업의 답으로 본다.
- 여럿인데 id8 이 없으면 어느 작업의 답인지 되묻는다. 팀장이 사람에게 묻는 곳은 여기 하나다. 답을 엉뚱한
  작업에 넣으면 그 작업이 틀린 결정으로 진행되기 때문이다.
- 받은 답은 `team.answer`(id8, answer)로 기록한다. 컨텍스트 압축 뒤에도 재구성이 되살린다.
- 빈 슬롯이 있으면 곧바로 재spawn 한다. 없으면 **대기 큐 맨 앞**에 넣고 다음 빈 슬롯에 재spawn 한다. 이유: 답을
  받은 작업은 이미 claimed 라서 새 작업보다 먼저 끝내야 한다.
- 재spawn 직전에 그 agent 브랜치를 잡고 있는 워크트리가 남아 있으면(`parked`) 재spawn 하지 않고 "사람 확인
  필요" 로 보고한다. 이유: 그 워크트리에는 push 되지 않은 변경이 있어 자동으로 지울 수 없고, 새 워커는
  `already checked out` 으로 그 브랜치로 옮기지 못한다.

**재spawn**: 포인터 끝에 줄을 바꿔 `ANSWER=<담당자 답 한 줄>` 을 붙여 「5. 팀원 spawn」 으로 새 격리 워크트리에
띄운다. 재claim 은 없다(이미 claimed 다). 워커는 detach 대신 기존 agent 브랜치로 switch 하고, 답을 design.md 에
한 줄 남긴다.

## 7. 마감

poll exit 8, poll 오류 exit, `failed not-isolated`, 기상 때 확인한 종료 시각 경과로 온다.
1. 새 spawn 을 멈춘다. 대기 큐는 보고만 하고 비운다.
2. **기다림의 상한**: `blocked` 슬롯과 무응답 슬롯은 기다리지 않는다. 진행 중 슬롯은 마감에 들어선 뒤
   `TICK` 두 번까지만 결과를 기다린다. 이 동안 poll 은 재기동하지 않고 감시 루프만 재기동해 결과와 `TICK` 을
   계속 받는다(「2-3」 의 일은 spawn·poll 만 빼고 그대로 한다). 그 뒤에도 남은 슬롯은 TSK·id8·워크트리 경로·
   마지막 생존 증거를 목록으로 보고한다. 이유: 사람이 자리를 비운 시간대에 답이 오지 않는 슬롯 하나가 팀장을
   무한정 붙잡지 않게 한다. pane 팀원은 팀장이 끝나도 자기 탭에서 계속 돈다.
3. 집계 표(TSK · id8 · 브랜치 · head · done exit · status · 사유)를 보고하고, 마지막 승인 스윕을 한 번 돈다.
   대기 큐·남은 슬롯·"재개 필요" 도 함께 적는다.
4. 남은 팀원 워크트리 중 살아 있는 팀원(「팀장 상태」 정의)이 없는 것만 백엔드별로 정리한다. Orca 는
   `orca worktree rm --worktree path:<경로>`, 에이전트 팀은 워크트리가 아직 있을 때만
   `git worktree remove --force <경로>` 다. 두 경우 모두 backends.md 「고아 정리 규칙」 을 따라, 깨끗하고 HEAD 가
   `origin/<agent 브랜치>` 와 같을 때만 지우고(생성 브랜치 정리 포함) 나머지는 경로를 보고한다.
   **살아 있는 팀원의 워크트리는 조건과 무관하게 지우지 않는다.** 경로만 보고에 남긴다. 이유: pane 팀원은
   팀장이 끝나도 자기 탭에서 계속 돌고, pane 의 `blocked` 팀원은 탭에서 답을 기다린다. 깨끗하고 push 된 순간에
   지우면 돌고 있는 팀원의 cwd 가 사라진다.
   에이전트 팀의 `--force` 는 미추적 부산물(`.result`·`.dflow-agent`·`.env` 링크·스킬 링크) 때문에 필요하다.
5. **agent 브랜치는 남긴다.** 승인은 사람이 D'Flow 웹에서 하고, 승인 뒤 머지는 다음 `/dflow-team` 의 스윕이나
   `/dflow-merge` 가 한다.
6. poll 이 떠 있으면 TaskStop 으로 멈추고(태스크 id 를 모르면 종료 시각에 스스로 끝난다), 세대 파일의 세대를
   올려 감시 루프를 끝낸다. `team.stop` 을 기록하고 팀장 잠금 디렉터리를 지운다. 지우기 전에 `owner` 가 자기
   `<신원>/<host>/lead` 이고 그 시작 epoch 초가 이 팀장의 마지막 `team.start` 시각(epoch 초로 바꾼 값) 이하인지
   숫자로 비교한다. 이유: 이 팀장이 `beat` 를 70분 넘게 놓쳐 다른 팀장이 잠금을 가져갔다면, 그 잠금의 시작
   시각은 이 팀장의 `team.start` 보다 늦으며 지우면 안 된다. 시각 문자열의 대소 비교는 zsh 에서
   `condition expected` 로 실패해 정상 마감 뒤에도 잠금이 남는다. 소유가 확인되지 않으면(값이 없거나 숫자가
   아니면) 지우지 않는다.
   ```bash
   LOCK=$(git rev-parse --git-path dflow-team.lock)
   start=$(jq -r --arg a '<신원>/<host>/lead' --arg r '<MAIN>' 'select(.agent == $a and .repo == $r and .event == "team.start") | .ts | fromdateiso8601' ~/.dflow/events.jsonl 2>/dev/null | tail -n 1)
   { read -r o_who o_ts < "$LOCK/owner"; } 2>/dev/null
   [ "${o_who-}" = '<신원>/<host>/lead' ] && [ -n "$start" ] && [ "${o_ts:-x}" -le "$start" ] 2>/dev/null && rm -rf "$LOCK"
   ```

## 좌석표 연동

- 팀원의 좌석 식별은 워커가 쓰는 워크트리 루트 `.dflow-agent`(`<신원>/<host>/w<slot>`)다. 좌석표 S1 의 훅이 이
  파일을 `heartbeat_agent` 로 읽는다. `<신원>/<host>/parked` 는 좌석이 아니며 heartbeat 를 보내지 않는다.
- 팀장 자신은 `<신원>/<host>/lead` 다. 같은 신원의 두 PC 팀장이 좌석표에서 하나로 합쳐지지 않게 한다.
- 좌석표 STANDBY 신호: 서버 계약이 생기면 팀장이 「1. 시작」 5번, poll 재기동, 「7. 마감」 에서
  `{host, agent: lead, slots, busy, until}` 을 보낸다. 그 전에는 `team.start`·`team.stop` 이 대신한다.

## 금지

- 팀원에게 AskUserQuestion 을 쓰게 하는 것. 팀장이 사람에게 묻는 곳은 답 매칭의 id8 되묻기 하나다.
- 팀장이 작업을 claim·progress·done 하는 것. 서버 쓰기는 팀원 몫이다(스윕의 머지만 팀장이 한다).
- `isolation` 없는 에이전트 팀 spawn. 팀원을 `name`·`isolation` 없는 단순 서브에이전트로 띄우는 것.
- 팀원 워크트리에서 팀장이 git 을 조작하는 것(읽기 조회, `parked` 표시, backends.md 의 정리 절차는 예외).
- 팀장 체크아웃에서 poll.sh 를 띄우는 것. 빈 디렉터리(「2-1」)에서만 띄운다.
- 순번 참조, force push, 훅 우회(SKIP_GUARD).
- 같은 작업의 재spawn. 예외는 poll 이 다시 돌려준 작업(일시 제외가 풀린 `skipped`, `failed rate-limit`)과 에이전트
  팀 `blocked` 재spawn 이다.
- 셸 `&` 백그라운드. 백그라운드는 Bash `run_in_background` 로만 띄운다.
- 인원 4 초과.
````

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run tests/skills`
Expected: PASS 66건(Task 1 13 + Task 2 9 + dflow-team 44).

- [ ] **Step 5: 커밋**

```bash
git add .claude/skills/dflow-team/SKILL.md tests/skills/dflow-team.test.ts
git commit -m "feat(dflow-team): 팀장 절차: 잠금·매 기상 재구성·빈 디렉터리 poll·해시 중복 방지·blocked 답 매칭

몇 시간 도는 팀장은 컨텍스트 압축으로 슬롯 표를 잃으므로 메모리를 캐시로 보고 매 기상마다
워크트리·.result·events.jsonl 에서 다시 만들고, 결과 줄 해시로 같은 결과를 두 번 처리하지 않는다.
poll 은 빈 디렉터리에서 띄워 exit 9·10 공회전을 없애고 승인 반영은 기상마다의 스윕이 맡는다.
한 체크아웃에 팀장은 하나만 뜨게 잠그고, 에이전트 팀 blocked 답은 id8 으로 매칭해 대기 큐 맨
앞에서 재spawn 한다. 결과 줄 없는 완료 알림은 suspect 로 두고 연속 실패는 차단기로 막는다."
```

---

### Task 6: 킷 배포 목록·권한 allow 병합·설치 안내·가이드 (머지 없음)

**Files:**
- Modify: `scripts/kit-build.sh` (12행 교체, 22행 뒤 삽입)
- Modify: `kit/install.sh` (41행 뒤 삽입, 48행 교체)
- Create: `kit/agent-team-allow.json`
- Modify: `kit/README.md` (4행, 16~17행, 스킬 표)
- Modify: `docs/agent/claude-skill/dflow-skills-guide.md` (3행, 한눈에 보기 표, dflow-poll·dflow-merge 「알아둘 것」, `## 자주 겪는 상황` 앞)
- Modify: `tests/skills/dflow-team.test.ts`

**Interfaces:**
- Consumes: 완성된 `.claude/skills/dflow-team/`(Task 3~5), `/dflow-merge` 후보 확대(Task 2), Phase 5 `reported` 커밋(Task 1).
- Produces: dflow-kit 빌드에 dflow-team 과 `agent-team-allow.json` 포함, install.sh 의 `permissions.allow` 병합(스펙 §8 권한 준비 2번, §10), 가이드의 사용 안내와 공지 두 줄(인자 없는 `/dflow-merge` 후보 확대, 수동 `/dflow-poll` exit 9 의 한계. 스펙 §11-1). `kit/agent-team-allow.json` 은 빈 목록으로 시작하고 Task 9 가 리허설 기록으로 채운다. 이 Task 는 머지하지 않는다. 머지는 리허설 뒤 Task 10 이다. kit-build 의 킷 밖 참조 검사는 넓히지 않는다(dflow-team 파일이 킷 밖 경로를 쓰지 않는 것으로 충분하다, 스펙 §10).

- [ ] **Step 1: 테스트 추가** (`tests/skills/dflow-team.test.ts` 끝에)

```ts
describe('dflow-team 배포·권한 준비(스펙 §8·§10)와 가이드(스펙 §11-1)', () => {
  it('kit-build.sh 배포 목록에 dflow-team 이 있고 권한 목록 파일을 킷에 싣는다', () => {
    const kit = readFileSync(join(ROOT, 'scripts/kit-build.sh'), 'utf8')
    expect(kit).toMatch(/^SKILLS=".*\bdflow-team\b.*"$/m)
    expect(kit).toContain('cp "$ROOT/kit/agent-team-allow.json" "$OUT/agent-team-allow.json"')
  })

  it('install.sh 안내와 킷 README 표에 dflow-team 이 있다', () => {
    expect(readFileSync(join(ROOT, 'kit/install.sh'), 'utf8')).toMatch(/설치 완료: .*dflow-team/)
    expect(readFileSync(join(ROOT, 'kit/README.md'), 'utf8')).toMatch(/^\| dflow-team \|/m)
  })

  it('agent-team-allow.json 은 권한 규칙 문자열 배열이고 git 규칙은 넣지 않는다', () => {
    const j = JSON.parse(readFileSync(join(ROOT, 'kit/agent-team-allow.json'), 'utf8'))
    expect(Array.isArray(j.allow)).toBe(true)
    for (const r of j.allow) {
      expect(r).toMatch(/^[A-Za-z]+\(.+\)$/)
      expect(r).not.toMatch(/git /)
    }
  })

  it('install.sh 가 git 절대경로 규칙과 목록을 settings.json permissions.allow 에 합친다', () => {
    const sh = readFileSync(join(ROOT, 'kit/install.sh'), 'utf8')
    expect(sh).toContain('GIT_ABS=$(command -v git)')
    expect(sh).toContain('--slurpfile add "$KIT_DIR/agent-team-allow.json"')
    expect(sh).toContain('.permissions.allow = (((.permissions.allow // []) + [$git] + $add[0].allow) | unique)')
  })

  it('가이드에 dflow-team 절과 공지 두 줄(원격 후보 확대, 수동 poll 승인 감지 한계)이 있다', () => {
    const g = readFileSync(join(ROOT, 'docs/agent/claude-skill/dflow-skills-guide.md'), 'utf8')
    expect(g).toContain('## dflow-team: 위임한 작업 여러 건을 동시에')
    expect(g).toContain('인자 없이 부르면 원격 `origin/agent/*` 브랜치까지 후보로 본다')
    expect(g).toContain('승인 감지는 지금 작업트리의 state.json 만 본다')
    expect(g).not.toContain('--team-size')
  })
})
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run tests/skills/dflow-team.test.ts`
Expected: 새 describe 5건 FAIL, 기존 44건 PASS.

- [ ] **Step 3: 파일 수정**

(1) `scripts/kit-build.sh` 12행을 아래로 바꾼다.
```sh
SKILLS="dflow-work dflow-dev dflow-poll dflow-merge dflow-team dflow-export dflow-wbs-nlevel"
```
22행 `cp "$ROOT/kit/.env.example" "$OUT/.env.example"` 뒤에 한 줄을 넣는다.
```sh
cp "$ROOT/kit/agent-team-allow.json" "$OUT/agent-team-allow.json"
```

(2) `kit/agent-team-allow.json` 을 만든다. 리허설(Task 9)이 기록한 명령을 채우기 전의 시작 상태다.
```json
{"allow": []}
```

(3) `kit/install.sh` 41행(`grep -qx '\.env' …`) 뒤, `# 4) 버전 표식` 앞에 넣는다.
```sh

# 3-2) 에이전트 팀 권한 준비: dflow-team 의 에이전트 팀 팀원은 팀장 세션의 권한 모드를 물려받아,
#      권한 확인에 걸리면 알림 없이 멈춘다. 워커는 git 을 절대경로로 부르므로 허용 규칙도 절대경로
#      형태로 넣는다. 이미 있는 항목과 settings.json 의 다른 키는 보존한다.
GIT_ABS=$(command -v git)
SETTINGS="$TARGET/.claude/settings.json"
[ -f "$SETTINGS" ] || printf '{}\n' > "$SETTINGS"
jq --arg git "Bash($GIT_ABS *)" --slurpfile add "$KIT_DIR/agent-team-allow.json" \
  '.permissions.allow = (((.permissions.allow // []) + [$git] + $add[0].allow) | unique)' \
  "$SETTINGS" > "$SETTINGS.tmp" && mv "$SETTINGS.tmp" "$SETTINGS"
echo "권한 준비: $SETTINGS 의 permissions.allow 에 에이전트 팀 허용 목록을 합쳤다"
```
48행을 아래로 바꾼다.
```sh
설치 완료: $TARGET/.claude/skills/ (dflow-work · dflow-dev · dflow-poll · dflow-merge · dflow-team · dflow-export · dflow-wbs-nlevel)
```

(4) `kit/README.md`
- 4행의 스킬 나열 `` `/dflow-dev`, `/dflow-poll`, `/dflow-merge`, `` 뒤에 `` `/dflow-team`, `` 을 넣는다.
- 16~17행의 install.sh 설명 끝 `→ 다음 단계 안내.` 앞에 `` `.claude/settings.json` 에 에이전트 팀 허용 목록 병합(git 은 이 PC 의 절대경로) → `` 를 넣는다.
- 스킬 표의 `| dflow-merge |` 행 뒤에 한 행을 넣는다.
```markdown
| dflow-team | 팀장. 에이전트 위임 작업을 슬롯 N개 팀원(Orca pane 또는 에이전트 팀)에게 나눠 동시에 개발시킨다. 낮 시간 supervised |
```

(5) `docs/agent/claude-skill/dflow-skills-guide.md`
- 3행 `스킬 7종의 사용자 안내서` 를 `스킬 8종의 사용자 안내서` 로 바꾼다.
- 「한눈에 보기」 표의 `| 위임해 둔 작업들을 알아서 처리하게 두고 싶다 |` 행 뒤에 한 행을 넣는다.
```markdown
| 위임한 작업 여러 건을 동시에 돌리고 싶다 | "/dflow-team 18:00" | dflow-team |
```
- dflow-poll 절 「알아둘 것」 의 마지막 항목(`- 승인을 눌렀으면 "승인했어"라고 알려주면 머지(dflow-merge)부터 하고 루프를 재개한다.`) 뒤에 한 항목을 넣는다.
```markdown
- 승인 감지는 지금 작업트리의 state.json 만 본다. 완료 보고 뒤 다른 브랜치로 옮긴 작업의 승인은 알리지
  못하므로, 그 작업은 다음 `/dflow-dev` 의 승인 스윕이나 `/dflow-merge` 가 원격 브랜치에서 찾아 반영한다.
```
- dflow-merge 절 「알아둘 것」 의 마지막 항목(`선행이 미승인이면 후행도 그 차례엔 안 합친다.`) 뒤에 한 항목을 넣는다.
```markdown
- 인자 없이 부르면 원격 `origin/agent/*` 브랜치까지 후보로 본다. 같은 D'Flow 에서 다른 PC·세션·팀원이
  push 한 작업도 서버에서 approved 면 반영되고, 승인 대기·반려·조회 실패·다른 D'Flow 는 보고만 한다.
  머지가 충돌하면 되돌리고 "머지 실패(충돌)" 로 알려 준다. 그 작업은 사람이 직접 합친다.
```
- `## 자주 겪는 상황` 줄 바로 앞에 아래 블록을 넣는다(끝의 `---` 포함).
````markdown
## dflow-team: 위임한 작업 여러 건을 동시에

**무엇**: `/dflow-poll` 과 같은 감시를 하면서, ready 가 된 위임 작업을 슬롯 N개의 팀원에게 나눠 동시에
개발시키고 끝난 슬롯에 다음 작업을 채운다. 팀원은 각자 워크트리에서 `/dflow-dev` 를 돈다.

**언제**: 자리에 있는 낮 시간에 위임 작업이 여러 건 쌓였을 때. 종료 시각이 필수라서 무인 야간 실행은 안 된다.

**사용 예**

> **나**: /dflow-team 2명 18:00
> **Claude**: 백엔드 Orca, 신원 hong/mbp, 팀원은 권한 확인 생략 모드로 뜬다. 승인 스윕: 머지 0, 대기 1. 감시 시작.
> **Claude**: ab12cd34 로그인 화면 → w1 착수, 9f8e7d6c 설비 목록 → w2 착수.
> **Claude**: w1 done(승인 대기로 보고). 대기 중이던 5a4b3c2d → w1 착수.
> **Claude**: 결정 필요 5a4b3c2d: "권한 없는 사용자에게 버튼을 숨길까요, 비활성으로 둘까요?" dflow-5a4b3c2d 탭에서 답하세요.

**알아둘 것**
- 인원은 기본 3, 최대 4 다. 모델을 붙이면(`/dflow-team 18:00 opus`) 팀원이 그 모델로 돈다.
- Orca 에서 띄우면 팀원마다 탭이 생긴다. 일반 터미널·tmux 에서는 에이전트 팀으로 뜨고, 질문은 팀장 세션으로
  모인다. "5a4b3c2d 숨김으로" 처럼 id8 을 앞에 붙여 답한다(기다리는 질문이 하나면 id8 없이도 된다).
- 팀장 세션을 닫으면 에이전트 팀 팀원도 함께 멈춘다(push 한 곳까지는 남는다). 오래 돌릴 때는 Orca 가 안전하다.
- 한 체크아웃에는 팀장 하나만 뜬다. 기본 브랜치에 있고 작업트리가 깨끗해야 시작한다.
- 특정 작업을 빼려면 D'Flow 에서 그 작업의 `agent` 태그를 끈다.
- 승인은 여전히 D'Flow 웹에서 사람이 한다. 팀장은 깨어날 때마다(최대 30분 간격) 승인된 작업을 main 에 반영한다.

---

````

- [ ] **Step 4: 통과 확인과 킷 빌드·설치 검증**

```bash
npx vitest run tests/skills
out=$(mktemp -d); t=$(mktemp -d); git -C "$t" init -q
sh scripts/kit-build.sh "$out" && sh "$out/install.sh" "$t" && jq '.permissions.allow' "$t/.claude/settings.json"
```
Expected: vitest PASS 71건. kit-build 는 `빌드 완료:` 와 `skills: … dflow-team …` 를 출력한다. "킷 밖 참조가 남아 있다" 가 나오면 SKILL.md 의 설계 정본 문구가 허용 표현 `wbs-web 리포 docs/superpowers` 를 벗어난 것이다. 마지막 출력은 `["Bash(<이 PC 의 git 절대경로> *)"]` 한 항목이다.

- [ ] **Step 5: 커밋**

```bash
git add scripts/kit-build.sh kit/install.sh kit/agent-team-allow.json kit/README.md docs/agent/claude-skill/dflow-skills-guide.md tests/skills/dflow-team.test.ts
git commit -m "chore(kit): dflow-team 배포·에이전트 팀 권한 allow 병합·가이드 공지

다른 dflow-* 와 같이 dflow-kit 으로 배포한다. 에이전트 팀 팀원은 팀장 세션의 권한 모드를 물려받아
권한 확인에 걸리면 알림 없이 멈추므로, 설치 한 번으로 allow 목록을 깐다(git 은 설치하는 PC 의 절대
경로). 가이드에는 인자 없는 /dflow-merge 가 원격 agent 브랜치까지 후보로 본다는 것과, reported 커밋
뒤 다른 브랜치로 옮긴 작업의 승인은 수동 /dflow-poll 이 알리지 못한다는 것을 공지한다."
```

---

### Task 7: 리허설 준비와 A0 단독 실측 (사람이 대화형 세션에서 수행)

**Files:**
- Create (메인 체크아웃 staging): `docs/superpowers/plans/2026-09-10-dflow-team-rehearsal.md`
- Modify (메인 체크아웃 staging): `docs/superpowers/specs/2026-09-10-dflow-team-design.md` (§3-8 사실, 필요하면 §12)
- 조건부 Modify (feat, A0 (d) 실패 시에만): `.claude/skills/dflow-work/scripts/dflow.sh`
- 리허설 원격(버리는 bare, 커밋하지 않음): `~/project/mes-base-rehearsal.git`
- 리허설 리포(커밋은 bare 에만 push): `~/project/mes-base-rehearsal`

**Interfaces:**
- Consumes: `<FEAT_WT>` 의 `.claude/skills/dflow-*`(Task 1~6, 머지 전).
- Produces: 리허설 리포와 bare 원격, 코드 작업용 `package.json`·lockfile·vitest 테스트(Task 8·9 가 쓴다), A0 (a)~(f) 판정. (a) 에서 결과 줄 없는 알림이 실제로 생기면 `suspect` 방어가 필수임이 확정되고, (c) 가 되면 후속 "SendMessage 기반 blocked 재개" 의 근거가 된다. (d)(e)(f) 는 에이전트 팀 워커의 `done` 가능 여부, 회수 범위, `failed rate-limit` 판정 주체를 정한다. **(d) 는 하드 게이트다.** 통과하기 전(실패했으면 dflow.sh 수정 뒤 재실측이 통과하기 전)에는 Task 8·9 로 가지 않는다.

- [ ] **Step 1: 버리는 bare 원격과 리허설 클론을 만든다** (스펙 §11-2). 사용 중인 mes-base 대신 새 클론과 스테이징 D'Flow 를 쓴다. 이유: 사용 중인 체크아웃에는 심사 중인 브랜치와 미커밋 state.json 이 있어 전제 검사와 합격 판정이 섞인다. 원격은 로컬 bare 다. 이유: 원격 후보를 넓게 보는 스윕과 팀원의 push 가 실제 mes-base 원격에 절대 닿지 않게 한다.

```bash
git clone --bare ~/project/mes-base ~/project/mes-base-rehearsal.git
git -C ~/project/mes-base-rehearsal.git config --get remote.origin.url || echo NO_UPSTREAM   # bare 는 실제 원격을 모른다
d=$(git -C ~/project/mes-base symbolic-ref --short refs/remotes/origin/HEAD 2>/dev/null); d=${d#origin/}
[ -n "$d" ] || d=$(git -C ~/project/mes-base ls-remote --symref origin HEAD | sed -n 's|^ref: refs/heads/\([^[:space:]]*\)[[:space:]]*HEAD$|\1|p')
echo "기본 브랜치=$d"                                     # 비어 있으면 멈춘다
git -C ~/project/mes-base-rehearsal.git fetch ~/project/mes-base "+refs/remotes/origin/$d:refs/heads/$d"
git -C ~/project/mes-base-rehearsal.git symbolic-ref HEAD "refs/heads/$d"
git clone ~/project/mes-base-rehearsal.git ~/project/mes-base-rehearsal
cd ~/project/mes-base-rehearsal
git remote get-url origin                               # ~/project/mes-base-rehearsal.git 이어야 한다
git symbolic-ref --short refs/remotes/origin/HEAD        # 기본 브랜치 확인(예: origin/main)
git branch --show-current && git status --porcelain      # 기본 브랜치이고 출력이 비어 있어야 한다
find docs/tasks -mindepth 2 -maxdepth 2 -name state.json 2>/dev/null | while IFS= read -r f; do jq -e '.phase == "reported" and ((.api_base // "") == "")' "$f" >/dev/null && echo "$f"; done   # 출력이 없어야 한다. 있으면 팀장 전제 검사가 LEGACY_REPORTED 로 멈추므로 여기서 정리한다
mkdir -p .claude/skills
for s in dflow-work dflow-dev dflow-poll dflow-merge dflow-team; do ln -s "<FEAT_WT>/.claude/skills/$s" ".claude/skills/$s"; done
cp "<FEAT_WT>/kit/.env.example" .env
git check-ignore -q .env || printf '/.env\n' >> "$(git rev-parse --git-path info/exclude)"
```
- `NO_UPSTREAM` 이 나와야 한다. `git clone --bare` 는 원격 설정을 만들지 않으므로 bare 로 들어온 push 는 어디로도
  전달되지 않는다.
- bare 는 mes-base 의 로컬 브랜치와 HEAD 를 그대로 가져온다. mes-base 체크아웃이 agent 브랜치에 있거나 로컬
  기본 브랜치가 뒤처져 있을 수 있으므로, bare 의 기본 브랜치를 mes-base 가 아는 원격 최신으로 맞추고 HEAD 를
  기본 브랜치로 둔다. 이유: 리허설 클론의 `origin/HEAD` 가 기본 브랜치를 가리켜야 워커 부트스트랩과 스윕의
  기점이 맞는다.
- 심링크는 `feat/dflow-team` 워크트리의 스킬을 가리킨다. 머지 전 수정본으로 리허설하기 위해서다.
- `.gitignore` 는 고치지 않는다. 팀장 전제 검사가 공유 `info/exclude` 에 `/.claude/skills` 를 넣는다. 이 배포
  형태는 mes-runlog 와 같아서 "새 워크트리에 스킬이 없다" 경로를 리허설이 그대로 밟는다.
- bare 에는 mes-base 의 로컬 agent 브랜치가 따라 들어온다. 스윕 후보에 잡히지만 `api_base` 가 없어 "건너뜀(다른
  D'Flow)" 로 보고된다. 스윕 관련 합격 기준은 리허설 작업으로 판정한다.

- [ ] **Step 2: 리허설 전용 PAT 와 `.env`**: 사람이 스테이징 D'Flow 에 리허설 프로젝트를 두고, 그 프로젝트로만 한정한 새 PAT 를 발급해 리허설 리포 `.env` 의 `DFLOW_PATS` 첫 토큰으로 넣는다. `DFLOW_API_BASE` 는 스테이징, `DFLOW_PROJECT_ID` 는 리허설 프로젝트다. 이유: 스테이징은 운영 데이터를 복제하므로 범위가 넓은 PAT 로는 운영에서 승인된 주문을 볼 수 있다.

```bash
cd ~/project/mes-base-rehearsal
(set -a; . ./.env; set +a; .claude/skills/dflow-work/scripts/dflow.sh doctor; .claude/skills/dflow-work/scripts/dflow.sh me)
(set -a; . ./.env; set +a; .claude/skills/dflow-work/scripts/dflow.sh list --scope all) | head
```
인증은 `me` 가 성공하는지로 본다(doctor 는 인증 실패도 0 으로 끝난다). `me` 의 접근 프로젝트가 리허설 프로젝트
하나뿐이어야 한다. 다른 프로젝트가 보이면 PAT 를 다시 발급한다.

- [ ] **Step 3: 테스트가 있는 코드 작업의 재료를 bare 에 올린다** (스펙 §11-2). mes-base 는 문서 전용이라 그대로는 기준선·Refactor 경로와 워커 의존성 설치(`/dflow-dev` 「--worker」 H)를 밟지 않는다.

```bash
cd ~/project/mes-base-rehearsal
mkdir -p rehearsal-code
cat > package.json <<'EOF'
{ "name": "mes-base-rehearsal", "private": true, "type": "module", "scripts": { "test": "vitest run" } }
EOF
cat > rehearsal-code/sum.js <<'EOF'
export function sum(a, b) { return a + b }
EOF
cat > rehearsal-code/sum.test.js <<'EOF'
import { expect, test } from 'vitest'
import { sum } from './sum.js'
test('sum', () => { expect(sum(1, 2)).toBe(3) })
EOF
npm install --save-dev vitest            # package-lock.json 생성
npx vitest run                           # 1 passed
grep -qx 'node_modules/' .gitignore 2>/dev/null || printf 'node_modules/\n' >> .gitignore
git add package.json package-lock.json rehearsal-code/sum.js rehearsal-code/sum.test.js .gitignore
git commit -m "chore: 리허설 코드 작업 재료(vitest 테스트 1건)"
git push origin "$(git branch --show-current)"
rm -rf node_modules                      # 팀원 워크트리처럼 node_modules 가 없는 상태에서 설치를 밟게 한다
git status --porcelain                   # `?? .claude/` 한 줄뿐이어야 한다(스킬 심링크. 팀장 전제 검사가 exclude 에 넣는다)
```

- [ ] **Step 4: 판정 파일을 만든다** (메인 체크아웃 `/Users/jji/project/wbs-web`, 현재 브랜치가 staging 인지 먼저 확인)

````markdown
# /dflow-team 리허설 판정

스펙 §11 합격 기준의 판정표다. 확인된 사실은 스펙 §3·§8·§12 에 사실로 옮기고, 이 파일에는 판정과 관찰만 둔다.
리허설 리포: `~/project/mes-base-rehearsal`(mes-base 새 클론), 원격: `~/project/mes-base-rehearsal.git`(버리는 bare),
D'Flow: 스테이징 리허설 프로젝트(전용 PAT), 스킬: `feat/dflow-team` 워크트리 심링크.

## A0: 에이전트 팀 실측 (스펙 §11-3)

| 항목 | 판정 | 관찰 |
|---|---|---|
| (a) 손자 실행 중 팀장에게 완료 알림이 오는가 | | |
| (b) blocked 로 끝난 팀원이 idle 로 남는가 | | |
| (c) idle 팀원에게 SendMessage 로 답하면 같은 워크트리에서 이어 가는가 | | |
| (d) 팀원 안에서 `dflow.sh done --auto-links` 가 성공하는가 | | |
| (e) 팀원을 TaskStop 하면 손자 서브에이전트까지 거둬지는가 | | |
| (f) 사용량 한도에 걸린 팀원이 무엇을 남기는가 | | |
````

- [ ] **Step 5: A0 실행** (스펙 §11-3). 팀장 루프 없이, 일반 터미널에서 리허설 리포 루트에 `claude` 를 띄우고(기본 권한 모드) 아래 세 번을 차례로 지시한다. 스테이징 리허설 프로젝트에 **`agent` 태그 없이** 나에게 배정된 ready 작업 "A0 probe" 1건을 먼저 만든다. 태그가 없어 이후 팀장 리허설의 poll 이 잡지 않는다.

A0-1 ((a)(b)(c)):
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
  같은 경로가 나오는지 본다. 끝나면 `TaskStop("a0-probe")`.

A0-2 ((d)):
```
Agent 도구로 name "a0-done", isolation "worktree", subagent_type "general-purpose" 인 팀원 하나를 띄워라. 팀원 프롬프트:
모든 git 호출은 command -v git 절대경로로 한다. .env 가 없으면 <리허설 리포 절대경로>/.env 를 심링크하고,
.claude/skills 가 없으면 <리허설 리포 절대경로>/.claude/skills 를 심링크한다. set -a; . ./.env; set +a 뒤
dflow.sh claim <A0 probe id8> → 브랜치 agent/<id8>-a0-probe 생성 → 빈 커밋 하나 → push origin → dflow.sh done <id8> "A0 probe" --auto-links 를 차례로 실행하고, 각 명령의 exit code 와 출력을 그대로 마지막 응답에 적어라.
```
- (d): `done --auto-links` 가 exit 0 이면 "성공". rtk 차단 메시지나 `git 브랜치를 확인할 수 없습니다` 로 실패하면
  그 출력을 적는다. **(d) 는 하드 게이트다.** 통과하기 전에는 Task 8·9 로 가지 않는다. 이유: `done` 이 막히면
  모든 작업이 claimed 에 머물러 두 리허설의 합격 기준을 판정할 수 없다. 실패하면 스크립트 안의 bare `git`
  호출도 막히는 것이므로, 프롬프트의 git 경로를 바꿔서는 고칠 수 없고 dflow.sh 를 고친다(스펙 §6-1·§11-3).
  1. `<FEAT_WT>` 에서 `.claude/skills/dflow-work/scripts/dflow.sh` 안의 모든 git 호출(`cmd_done` 의
     `git branch`·`git rev-parse`·`git ls-remote`·`git remote` 와 `check_depends_local` 등)을 `${DFLOW_GIT:-git}` 로
     바꾼다. 변수가 없으면 지금과 같으므로 수동 동작은 바뀌지 않는다.
     ```bash
     grep -nE '(^[[:space:]]*|[;&|(][[:space:]]*)git ' .claude/skills/dflow-work/scripts/dflow.sh   # 명령 자리의 git. 바꾼 뒤에는 출력이 없어야 한다
     sh -n .claude/skills/dflow-work/scripts/dflow.sh                  # 문법 확인
     ```
     정규식은 명령 자리(줄 머리, `$(`·`(`·`|`·`&&`·`;` 뒤)의 `git` 만 잡는다. 오류 문구 안의 "git 브랜치를…"·"git push 후…"
     는 명령이 아니므로 잡지 않는다.
  2. worker-prompt.md 「3.」 의 마지막 문장("리허설 A0 (d) 로 dflow.sh 가 `DFLOW_GIT` 를 받게 됐으면 …")이 이제 적용된다.
     그 문장의 조건부 표현을 "dflow.sh 를 부를 때 `DFLOW_GIT=<0번의 git 절대경로>` 도 붙인다" 로 바꾼다. 그리고
     `tests/skills/dflow-team.test.ts` 의 worker-prompt 부트스트랩 테스트에 수정 뒤에만 참이 되는 단언을 더한다.
     `DFLOW_GIT=` 는 조건부 문장에도 이미 있어 수정 전에도 통과하므로 쓰지 않는다.
     ```ts
     expect(p()).toContain('dflow.sh 를 부를 때 `DFLOW_GIT=<0번의 git 절대경로>` 도 붙인다')
     expect(p()).not.toContain('A0 (d) 로 dflow.sh 가')
     const sh = readFileSync(join(ROOT, '.claude/skills/dflow-work/scripts/dflow.sh'), 'utf8')
     expect(sh.split('\n').filter((l) => /(^\s*|[;&|(]\s*)git /.test(l))).toEqual([]) // 명령 자리의 bare git 이 남지 않았다
     expect(sh).toContain('${DFLOW_GIT:-git}')
     ```
  3. A0-2 를 새 주문으로, 팀원 프롬프트의 dflow.sh 호출에 `DFLOW_GIT=<git 절대경로>` 를 붙여 다시 돌린다. 통과하면
     `npx vitest run tests/skills` PASS 71건을 보고 커밋한다. 그래도 실패하면 사람에게 보고하고 멈춘다.
     ```bash
     git add .claude/skills/dflow-work/scripts/dflow.sh .claude/skills/dflow-team/references/worker-prompt.md tests/skills/dflow-team.test.ts
     git commit -m "fix(dflow-work): dflow.sh 의 git 실행 경로를 DFLOW_GIT 로 주입받는다

     에이전트 팀 워커 안에서 스크립트 내부 bare git 이 rtk 격리 가드에 막혀 done 을 보고하지 못했다.
     변수가 없으면 지금과 같아 수동 동작은 바뀌지 않는다."
     ```

A0-3 ((e)):
```
Agent 도구로 name "a0-stop", isolation "worktree", subagent_type "general-purpose" 인 팀원 하나를 띄워라. 팀원 프롬프트:
Agent 도구로 name "a0-grandchild" 인 손자를 띄워 Bash 로 sleep 600 을 실행하게 하고, 그 결과를 기다려라.
팀원을 띄우고 60초 뒤 TaskStop("a0-stop") 을 부른 다음, 에이전트 목록과 pgrep -fl 'sleep 600' 출력을 보여 줘라.
```
- (e): TaskStop 뒤 `a0-grandchild` 가 목록에 남거나 `sleep 600` 프로세스가 남으면 "손자는 따로 멈춰야 한다" 로
  판정한다.
- (f): 사용량 한도는 일부러 일으키지 않는다. Task 7~9 동안 한도에 걸린 팀원이 생기면 그 완료 알림·마지막 응답·
  `.result` 를 그대로 적는다. 끝까지 생기지 않으면 "미관찰" 로 남긴다.
- 끝나면 남은 격리 워크트리를 `git worktree remove --force <경로>` 로 지운다. 스테이징의 "A0 probe" 주문은
  reported 로 남겨 둔다(승인하지 않는다).

- [ ] **Step 6: 기록과 커밋** (메인 체크아웃, staging). 판정표를 채우고, 스펙 §3-8 의 "실측하지 않았다" 문장을 A0 결과 사실로 바꾼다(날짜·경위 없이, 예: "팀원이 손자를 기다리며 턴을 끝내면 결과 줄 없는 완료 알림이 온다"). (c) 가 되면 스펙 §12 후속의 "SendMessage 기반 blocked 재개" 에 근거 한 줄을 붙인다. (e) 가 "손자는 따로 멈춰야 한다" 면 스펙 §4-6 회수에 그 사실을 적고, 그 동작을 담는 SKILL.md 수정은 Task 8 Step 4 의 절차(파일 수정·테스트·커밋)로 한다. (f) 가 "미관찰" 이면 스펙 §12 잔여 위험에 한 줄 더한다.

```bash
cd /Users/jji/project/wbs-web
[ "$(git branch --show-current)" = staging ] || echo NOT_STAGING
git add docs/superpowers/plans/2026-09-10-dflow-team-rehearsal.md docs/superpowers/specs/2026-09-10-dflow-team-design.md
git commit -m "docs(dflow-team): A0 실측: 완료 알림·idle·SendMessage·done·TaskStop 범위 판정

suspect 방어와 TaskStop 회수가 실제로 필요한지, 에이전트 팀 워커가 done 을 할 수 있는지를 팀장
루프 전에 단독으로 확인했다."
```
`NOT_STAGING` 이면 커밋하지 않고 멈춰 사람에게 알린다. push 는 하지 않는다(Task 10 이 staging 반영과 함께 올린다).

---

### Task 8: Orca 백엔드 리허설 (사람이 대화형 세션에서 수행)

**Files:**
- Modify (메인 체크아웃 staging): `docs/superpowers/plans/2026-09-10-dflow-team-rehearsal.md` (Orca 절)
- 조건부 Modify (feat 워크트리): 실패 원인이 스킬 문서에 있을 때 해당 파일과 대응 테스트

**Interfaces:**
- Consumes: Task 7 의 리허설 리포·bare·코드 재료, Task 1~6 의 스킬.
- Produces: 스펙 §11-4 합격 기준 12항 판정.

- [ ] **Step 1: 작업 준비**: 스테이징 D'Flow 의 리허설 프로젝트에 `agent` 태그가 붙고 나에게 배정된 독립 ready 작업 3건을 만든다. 1건의 spec 에는 담당자 결정이 필요한 분기를 일부러 남긴다(예: "권한 없는 사용자에게 버튼을 숨길지 비활성화할지는 정하지 않았다"). 1건은 코드 작업이다(예: "`rehearsal-code/sum.js` 에 `mul(a, b)` 를 추가하고 테스트를 단다"). 나머지 1건은 문서 작업이다. 3건과 별도로, 그 문서 작업을 선행으로 둔 작업 1건을 더 만든다(`agent` 태그·나에게 배정). 리허설 작업은 승인하지 않으므로 이 작업은 매번 `skipped` 로 끝나 일시 제외되고 30분 뒤 다시 뜬다. 같은 id8 을 다시 띄우는 경로와 생성 브랜치 정리를 보기 위해서다(스펙 §11-2).

- [ ] **Step 2: 실행**: Orca 에서 리허설 리포를 열고 그 터미널의 Claude 세션에서 `/dflow-team 2명 <지금부터 2시간 뒤 HH:MM>`. 시작 보고의 백엔드가 "pane(Orca)" 이고 권한 안내가 "팀원은 권한 확인 생략 모드로 뜬다" 인지 본다.

- [ ] **Step 3: 합격 기준 12항 판정** (스펙 §11-4). 각 항목을 실제 명령으로 확인한다.
  1. 첫 poll 에서 2건이 각자 `orca worktree create --agent claude` 로 spawn 되고, 3번째는 대기 큐에 들어갔다가 먼저 빈 슬롯에 자동 배정된다(팀장 보고와 `~/.dflow/events.jsonl`).
  2. 각 팀원이 자기 워크트리에서 `agent/<id8>-<slug>` 브랜치를 만들고 push 했으며, 원격 tip 의 state.json 이 `reported` 다(`git -C ~/project/mes-base-rehearsal fetch origin && git -C ~/project/mes-base-rehearsal show origin/agent/<id8>-<slug>:docs/tasks/<TSK>/state.json | jq -r '.phase, .api_base'`, `api_base` 는 스테이징 주소).
  3. 팀장의 상주 체크아웃의 현재 브랜치와 작업트리가 실행 전후로 같다(`git -C ~/project/mes-base-rehearsal branch --show-current` 와 `git status --porcelain`).
  4. 서버에 각자 id8 로 `done` 이 기록됐고(`dflow.sh show <id8>` 가 reported), 다른 주문은 건드리지 않았다.
  5. 결정 분기 작업이 `blocked` 로 그 팀원 탭에서 멈추고, 사람이 그 탭에서 답을 주면 같은 워크트리·브랜치에서 이어 가 `done` 한다. 그동안 그 슬롯은 재배정되지 않는다.
  6. done 처리 때 팀원 워크트리가 그 자리에서 `orca worktree rm --worktree path:<경로>` 로 정리되고, agent 브랜치 3개는 원격(bare)에 남는다. 특히 워크트리가 `agent/<id8>-<slug>` 로 switch 된 상태에서 `orca worktree rm` 이 깨끗이 돌고, 머지되지 않은 로컬 agent 브랜치를 보존하는지 확인한다(`git -C ~/project/mes-base-rehearsal branch --list 'agent/*'`). 첫 spawn 직후 `git -C ~/project/mes-base-rehearsal branch --list` 로 워크트리를 만들 때 생긴 브랜치의 실제 이름을 적고, 정리 뒤 그 브랜치가 남지 않는지 본다(backends.md 「고아 정리 규칙」 5번). 선행이 있는 작업(Step 1)이 `skipped` 로 끝난 뒤 일시 제외가 풀려 다시 뜰 때 `orca worktree create --name dflow-<id8>` 가 이름·브랜치 충돌 없이 뜨는지도 본다(그 시간 안에 다시 뜨지 않았으면 "미관찰" 로 적는다).
  7. `/dflow-team` 을 다시 돌리면 승인 스윕이 리허설 원격 브랜치 3개를 후보로 잡는다(승인 전이므로 "대기"). bare 에 원래 있던 agent 브랜치는 "건너뜀(다른 D'Flow)" 로 보고된다.
  8. `~/.dflow/events.jsonl` 에 `team.start` → `team.spawn`×2 → `team.result` → `team.spawn`(3번째) → `team.blocked` → … → `team.stop` 순서가 남고, `team.spawn` 에 `id8`·`worktree`·`handle` 이, `team.result`·`team.blocked` 에 `hash`·`reason` 이 있다. 각 워크트리 루트의 `.dflow-agent` 가 슬롯 식별자(`<신원>/<host>/w1`, `<신원>/<host>/w2`)이고, 3번째 작업의 `.dflow-agent` 는 먼저 빈 슬롯의 값과 같다.
  9. 각 팀원 워크트리의 `docs/tasks/<TSK>/.result` 한 줄의 status 가 서버·브랜치 상태와 맞는다.
  10. 확인 항목: `orca worktree create --json` 결과에 `result.agentTerminalHandle` 이 있는지(없으면 화면 읽기 없이 도는지), 워커가 `/dflow-dev` 를 Skill 도구로 불렀는지 SKILL.md 직접 읽기 폴백을 탔는지, 팀장의 poll 이 빈 디렉터리(`$(git rev-parse --git-path dflow-team-poll)`)에서 떠 exit 9·10 을 한 번도 내지 않았는지.
  11. 팀장 세션에서 컨텍스트 압축(`/compact`)을 한 번 일으킨 뒤에도 다음 기상에서 슬롯 표가 재구성되고(팀장 보고의 슬롯 목록), 결과가 한 번만 처리된다(`team.result` 가 같은 `hash` 로 두 번 남지 않는다).
  12. 코드 작업의 워커가 Phase 0 3번 브랜치 생성 뒤, 기준선 전에 lockfile 에 맞는 설치(`npm ci`)를 하고(`/dflow-dev` 「--worker」 H), 기준선·Build·Verify·Refactor 게이트를 실제 테스트 명령(`npm test`)으로 통과한다.

- [ ] **Step 4: 실패 시**: 팀원 transcript(`orca terminal read --screen --terminal <handle>`)와 `dflow.sh show` 로 원인을 확정한다. 원인이 스킬 문서에 있으면 `<FEAT_WT>` 에서 해당 파일을 고치고, 그 동작을 잡는 단언을 해당 테스트에 더한 뒤 `npx vitest run tests/skills` 가 초록인지 보고 커밋한다(파일명 명시). 서버 쓰기 오류가 있었으면 스테이징에서 그 주문을 release 해 되돌린다. 고친 뒤 실패 항목을 다시 판정한다.

- [ ] **Step 5: 기록과 커밋**: 판정 파일에 `## Orca (스펙 §11-4)` 표(항목 1~12 · 판정 · 관찰)를 더한다. 리허설 agent 브랜치는 bare 에 그대로 둔다(버리는 원격이라 지울 필요가 없다).

```bash
cd /Users/jji/project/wbs-web
[ "$(git branch --show-current)" = staging ] || echo NOT_STAGING
git add docs/superpowers/plans/2026-09-10-dflow-team-rehearsal.md
git commit -m "docs(dflow-team): Orca 리허설 판정: 합격 기준 12항"
```
`NOT_STAGING` 이면 커밋하지 않고 멈춘다. push 는 하지 않는다.

---

### Task 9: 에이전트 팀 백엔드 리허설과 권한 목록 (사람이 대화형 세션에서 수행)

**Files:**
- Modify (메인 체크아웃 staging): `docs/superpowers/plans/2026-09-10-dflow-team-rehearsal.md` (에이전트 팀 절), `docs/superpowers/specs/2026-09-10-dflow-team-design.md` (§3-6·§3-7·§8 사실)
- Modify (feat): `kit/agent-team-allow.json`
- 조건부 Modify (feat, rtk 예비책): `.claude/skills/dflow-team/references/worker-prompt.md`, `.claude/skills/dflow-team/references/backends.md`, `.claude/skills/dflow-dev/SKILL.md`(W7 표지 블록의 E 행), `tests/skills/dflow-dev-worker.test.ts`, `tests/skills/dflow-team.test.ts`

**Interfaces:**
- Consumes: Task 7 의 리허설 리포·bare·코드 재료, Task 1~6 의 스킬, Task 6 의 install.sh 병합과 `agent-team-allow.json` 형식 테스트.
- Produces: 스펙 §11-4(6번은 에이전트 팀 정리로 읽는다)와 §11-5 추가 7항 판정, auto 모드에서 막힌 명령 목록, 킷의 에이전트 팀 허용 목록 내용(스펙 §8 권한 준비 2번).

- [ ] **Step 1: 작업 준비**: 스테이징 리허설 프로젝트에 `agent` 태그·나에게 배정된 독립 ready 작업 3건을 **새로** 만든다(1건은 담당자 결정 분기, 1건은 코드 작업 예 "`rehearsal-code/sum.js` 에 `sub(a, b)` 를 추가하고 테스트를 단다"). 담당자 결정 분기는 코드 작업에 둔다. 답 뒤 재spawn 워크트리의 의존성 설치(기준 4)를 보기 위해서다. Task 8 Step 1 과 같이 선행이 있는 작업 1건을 더 만든다. Task 8 의 작업은 재사용하지 않는다.

- [ ] **Step 2: auto 모드로 먼저 실행** (스펙 §8 권한 준비 1번): Orca 가 아닌 일반 터미널에서 리허설 리포 루트에 `claude` 를 사용자 기본 권한 모드(auto)로 띄우고 `/dflow-team 2명 <지금부터 2시간 뒤 HH:MM>`. 시작 보고의 백엔드가 "에이전트 팀" 이고 권한 안내가 "팀원은 이 세션의 권한 모드를 물려받으며, 권한 확인이 뜨면 알림 없이 멈춘다" 인지 본다. 도는 동안 거부되거나 권한 확인이 뜬 명령을 전부 적는다(명령 문자열 그대로).

- [ ] **Step 3: allow 목록으로 다시 실행** (스펙 §8 권한 준비 2번): Step 2 에서 막힌 명령이 있으면 리허설 리포의 `.claude/settings.local.json` 에 그 명령마다 허용 규칙을 넣는다. git 은 절대경로 형태로 적는다(예 `Bash(/usr/bin/git *)`, 경로는 `command -v git` 값). 워커가 git 을 절대경로로 부르기 때문이다. 이 파일은 미추적이라 팀장 전제 검사의 깨끗함 검사를 깨므로 로컬 exclude 에 넣는다.
  ```bash
  cd ~/project/mes-base-rehearsal
  printf '/.claude/settings.local.json\n' >> "$(git rev-parse --git-path info/exclude)"
  jq -n --arg git "Bash($(command -v git) *)" '{permissions: {allow: [$git, "<기록한 명령마다 한 항목>"]}}' > .claude/settings.local.json
  ```
  `"<기록한 명령마다 한 항목>"` 자리는 Step 2 기록을 `Bash(<명령 접두> *)` 형태로 옮긴 값들이다. 팀장 세션을 새로 띄워 같은 방식(새 작업 또는 남은 작업)으로 다시 돌리고, 여전히 막히는 명령을 적는다.

- [ ] **Step 4: 그래도 멈추면 권한 확인 생략 모드** (스펙 §8 권한 준비 3번): `claude --dangerously-skip-permissions` 로 팀장을 띄워 나머지 기준을 판정한다. 팀원·Phase 서브에이전트까지 모든 명령을 확인 없이 실행한다는 보안 결정이므로, 이 단계로 갔다는 사실과 이유를 판정 파일에 적는다.

- [ ] **Step 5: 합격 기준 판정**: 스펙 §11-4 의 1~12항(6번은 "done 처리 때 에이전트 팀 워크트리가 그 자리에서 `git worktree remove --force` 로 정리된다" 로 읽고, 10번은 Skill 도구·폴백과 poll exit 9·10 부재만 본다)과 스펙 §11-5 추가 항목:
  1. 팀원 둘이 서로 다른 링크드 워크트리(`.claude/worktrees/agent-*`)를 받았고 팀장 체크아웃의 브랜치·워킹트리가 불변이다.
  2. 워커와 Phase 서브에이전트가 `command -v git` 절대경로로 `/dflow-dev` 를 완주한다. rtk 차단 메시지 "a worktree-isolated agent's git operations must target its own worktree" 가 한 번이라도 나오면 그 지점을 적고 Step 6 으로 간다.
  3. `blocked` 작업에서 팀원이 끝나고, `TaskStop` 으로 회수되고, 그 워크트리가 곧바로 정리되거나 `.dflow-agent` 가 `<신원>/<host>/parked` 로 바뀌고, 슬롯이 해제돼 다음 작업이 들어간다.
  4. `<id8> <답>` 으로 답한 뒤 재spawn 된 워커가 `ANSWER` 를 design.md 에 남기고 같은 agent 브랜치 위에서 이어 간다. 빈 슬롯이 없을 때 답하면 그 작업이 대기 큐 맨 앞에서 다음 빈 슬롯을 받는다(`team.answer` 뒤 `team.spawn`). 재spawn 워크트리에 `node_modules` 가 생기고(`/dflow-dev` 「--worker」 H 의 재개 경로) 게이트가 127 로 끝나지 않는지 본다.
  5. 팀원 종료 뒤 워크트리가 자동 정리됐는지 보존됐는지, `.result` 를 파일과 마지막 응답 중 어디서 읽었는지 적는다.
  6. 팀장 세션을 의도적으로 끝내면 팀원도 멈추고, 재기동 시 고아 스캔과 "재개 필요" 보고가 나온다.
  7. 권한: Step 2~4 에서 적은 명령 목록과 최종적으로 필요했던 단계(auto·allow·생략)를 적는다.
  - 다중 신원: 같은 bare 에서 두 번째 클론 `~/project/mes-base-rehearsal2` 를 Task 7 Step 1 의 클론 이후 명령으로 준비하고(같은 `.env`), 두 클론에서 `/dflow-team 1명 <HH:MM>` 을 동시에 띄워 같은 ready 1건을 두고 경쟁시킨다. 늦은 쪽 팀원이 claim exit 4 로 `skipped` 가 되는지 본다. 이 구성은 `AGENT_ID` 가 겹칠 수 있어 운영에서는 쓰지 않지만, 좌석표가 없는 리허설의 exit 4 확인에는 지장이 없다. 이어서 첫 번째 클론에서 팀장이 도는 동안 같은 클론에 두 번째 `claude` 세션을 띄워 `/dflow-team 1명 <HH:MM>` 을 부르면 `LOCKED` 로 시작이 거부되는지 본다. 실제 두 신원·두 PC 는 후속 2차 리허설이다.

- [ ] **Step 6: rtk 예비책 (Step 5 기준 2에서 차단이 나온 경우에만)**: git 경로를 리터럴 `/usr/bin/git` 으로 바꾼다(스펙 §11-5 2번). `<FEAT_WT>` 에서:
  1. `worker-prompt.md` 「0. git 호출 규칙」 첫 문장을 "모든 git 호출은 절대경로 `/usr/bin/git` 으로 한다(bare `git` 금지)." 로 바꾸고 `command -v git` 언급을 지운다. backends.md 차이표 `git 호출` 행의 `` `command -v git` 절대경로 `` 를 `` `/usr/bin/git` `` 으로 바꾼다.
  2. `/dflow-dev` SKILL.md W7 블록 E 행의 따옴표 안 문구를 "git 은 절대경로 `/usr/bin/git` 으로 호출한다(bare `git` 금지)" 로 바꾼다. 이 행은 표지 블록 안이라 보존 테스트에 영향이 없다.
  3. 테스트 단언을 수정 뒤에만 참이 되는 것으로 바꾼다: `tests/skills/dflow-dev-worker.test.ts` 의 `expect(sec).toContain('command -v git')` → `expect(sec).toContain('git 은 절대경로 `/usr/bin/git` 으로 호출한다')` 와 `expect(sec).not.toContain('command -v git')`, `tests/skills/dflow-team.test.ts` 의 worker-prompt describe 에 있는 `expect(p()).toContain('command -v git')` → `expect(p()).toContain('모든 git 호출은 절대경로 `/usr/bin/git` 으로 한다')` 와 `expect(p()).not.toContain('command -v git')`. `toContain('/usr/bin/git')` 만으로는 worker-prompt 0절의 "(예 `/usr/bin/git`)" 때문에 수정 전에도 통과하므로 쓰지 않는다.
  4. `npx vitest run tests/skills` PASS 71건을 확인하고 커밋한다.
     ```bash
     git add .claude/skills/dflow-team/references/worker-prompt.md .claude/skills/dflow-team/references/backends.md .claude/skills/dflow-dev/SKILL.md tests/skills/dflow-dev-worker.test.ts tests/skills/dflow-team.test.ts
     git commit -m "fix(dflow-team): git 경로를 /usr/bin/git 리터럴로: command -v 절대경로도 rtk 격리 가드에 막힌다"
     ```
  5. 에이전트 팀 리허설을 다시 돌려 기준 2를 재판정한다. 그래도 막히면 rtk 훅 수정(근본 해결)을 사람에게 보고하고 멈춘다.

- [ ] **Step 7: 권한 목록을 킷에 반영한다** (`<FEAT_WT>`): Step 2~3 에서 기록한 명령을 `Bash(<명령 접두> *)` 형태로 옮겨 `kit/agent-team-allow.json` 의 `allow` 배열에 넣는다(형식 예: `{"allow": ["Bash(.claude/skills/dflow-work/scripts/dflow.sh *)"]}`). git 은 install.sh 가 설치하는 PC 의 절대경로로 따로 넣으므로 이 파일에 넣지 않는다. 기록이 없으면 빈 목록 그대로 두고 이 Step 의 커밋을 건너뛴다.

```bash
npx vitest run tests/skills
out=$(mktemp -d); t=$(mktemp -d); git -C "$t" init -q
sh scripts/kit-build.sh "$out" && sh "$out/install.sh" "$t" && jq '.permissions.allow' "$t/.claude/settings.json"
git add kit/agent-team-allow.json
git commit -m "feat(kit): 에이전트 팀 리허설에서 막힌 명령을 권한 허용 목록에 싣는다

에이전트 팀 팀원은 팀장 세션의 권한 모드를 물려받아, 권한 확인에 걸리면 알림 없이 멈춘다.
auto 모드 리허설에서 거부되거나 확인이 뜬 명령을 install.sh 가 병합할 목록으로 둔다."
```
Expected: vitest PASS 71건(Task 6 의 "권한 규칙 문자열 배열" 테스트가 새 항목의 형식을 검사한다). 마지막 출력에 `Bash(<이 PC 의 git 절대경로> *)` 와 `kit/agent-team-allow.json` 의 항목이 모두 있다.

- [ ] **Step 8: 기록과 커밋**: 판정 파일에 `## 에이전트 팀 (스펙 §11-4·§11-5)` 표를 더한다. 스펙 §3-7 과 §8 권한 준비에 "auto 모드에서 막힌 명령" 과 최종 필요 단계를 사실로 적고, Step 6 을 탔으면 §3-6 에 "`command -v git` 절대경로도 막혀 리터럴 `/usr/bin/git` 을 쓴다" 를 사실로 적는다. 두 번째 클론을 지운다.

```bash
rm -rf ~/project/mes-base-rehearsal2
cd /Users/jji/project/wbs-web
[ "$(git branch --show-current)" = staging ] || echo NOT_STAGING
git add docs/superpowers/plans/2026-09-10-dflow-team-rehearsal.md docs/superpowers/specs/2026-09-10-dflow-team-design.md
git commit -m "docs(dflow-team): 에이전트 팀 리허설 판정: 격리·rtk·잠금·동반 종료·권한 모드 사실 반영"
```
`NOT_STAGING` 이면 커밋하지 않고 멈춘다. push 는 하지 않는다.

---

### Task 10: main·staging 머지와 적용 확인

**Files:**
- Modify (머지 커밋 안에서만, 조건부): `tests/skills/fixtures/dflow-dev.SKILL.orig.md`, `tests/skills/fixtures/dflow-merge.SKILL.orig.md`
- 임시 워크트리: `/Users/jji/project/wbs-web-merge-main`, `/Users/jji/project/wbs-web-merge-staging`

**Interfaces:**
- Consumes: 리허설을 통과한 `feat/dflow-team`(Task 1~9), 메인 체크아웃 staging 의 리허설 문서 커밋(Task 7~9).
- Produces: `origin/main`·`origin/staging` 에 반영된 스킬. 메인 체크아웃 작업트리의 `/dflow-dev` 에 `--worker` 가 있어 모든 대상 리포의 심링크가 수정본을 가리킨다.

- [ ] **Step 1: 최종 확인과 머지 지시**: `<FEAT_WT>` 에서 `npx vitest run tests/skills` 가 PASS 71건인지 본다. 메인 체크아웃에서 `git fetch origin && git log --oneline origin/staging..staging` 으로 staging 반영 때 함께 올라갈 로컬 staging 커밋 목록을 뽑는다. 사람에게 "feat/dflow-team 을 머지하면 `/dflow-dev`·`/dflow-merge` 변경이 심링크로 모든 리포에 즉시 적용된다. 리허설 판정은 `docs/superpowers/plans/2026-09-10-dflow-team-rehearsal.md`. staging 반영 때 위 로컬 커밋이 함께 push 된다" 를 알린 뒤 명시 지시를 받는다. 변경 파일은 UI 위험 파일(`src/app/globals.css`·`src/app/layout.tsx`·`src/app/(app)/layout.tsx`·`src/components/app/*`)이 아니므로 pre-push G2 가 해당하지 않는다. `SKIP_GUARD` 는 쓰지 않는다.

- [ ] **Step 2: main 머지 (임시 워크트리에서)**: 메인 체크아웃은 여러 세션이 쓰므로 switch 하지 않는다.

```bash
cd /Users/jji/project/wbs-web
git fetch origin
git worktree add --detach /Users/jji/project/wbs-web-merge-main origin/main
cd /Users/jji/project/wbs-web-merge-main
ln -s /Users/jji/project/wbs-web/node_modules node_modules    # /node_modules 는 gitignore 대상이라 추적되지 않는다
git merge --no-ff feat/dflow-team -m "merge: feat/dflow-team → main: /dflow-team 팀장 스킬

리허설(Orca·에이전트 팀)을 통과한 뒤 반영한다. /dflow-dev 의 api_base·원격 후보·머지 절차 위임·claim 전 기점
이동·reported 커밋과 /dflow-merge 의 원격 후보·되돌림은 수동 경로에도 적용되는 수정이다."
```
충돌이 나면 양쪽 수정을 모두 살려 푼다(한쪽을 버리지 않는다).

- [ ] **Step 3: fixture 기준 sha 이후 원문이 바뀌었는지 보고, 바뀌었으면 다시 떠서 보존 테스트를 돌린다** (스펙 §6-1)

```bash
for f in dflow-dev dflow-merge; do
  sha=$(sed -n '1s/^<!-- fixture: git show \([0-9a-f]*\):.*/\1/p' "tests/skills/fixtures/$f.SKILL.orig.md")
  echo "== $f (기준 $sha)"; git log --oneline "$sha..ORIG_HEAD" -- ".claude/skills/$f/SKILL.md"
done
```
- `ORIG_HEAD` 는 머지 전 대상 브랜치 tip 이다. 두 파일 모두 출력이 없으면 fixture 를 그대로 두고 Step 4 로 간다.
- 출력이 있는 파일은 그 사이 다른 세션이 원문을 고친 것이다. 그 파일의 fixture 를 `ORIG_HEAD` 원문으로 다시 뜬다.
  ```bash
  new=$(git rev-parse ORIG_HEAD)
  { printf '<!-- fixture: git show %s:.claude/skills/dflow-dev/SKILL.md 수정 전 원문. 갱신 절차는 tests/skills/dflow-dev-worker.test.ts 머리 주석 -->\n' "$new"
    git show "$new:.claude/skills/dflow-dev/SKILL.md"; } > tests/skills/fixtures/dflow-dev.SKILL.orig.md
  { printf '<!-- fixture: git show %s:.claude/skills/dflow-merge/SKILL.md 수정 전 원문. 갱신 절차는 tests/skills/dflow-merge-remote.test.ts 머리 주석 -->\n' "$new"
    git show "$new:.claude/skills/dflow-merge/SKILL.md"; } > tests/skills/fixtures/dflow-merge.SKILL.orig.md
  ```
  두 줄 묶음 중 바뀐 파일의 것만 실행한다.
- 그 뒤 `npx vitest run tests/skills` 를 돌린다. 보존 테스트가 실패하면 메시지의 원문 줄을 머지 결과에 되살린다.
  "CHANGED 줄(과 범위 경계 줄)은 fixture 에 정확히 한 번씩" 이 실패하면 다른 세션이 의도 수정 대상 줄을 고친 것이다. 멈추고
  사람에게 보고한다.
- fixture 를 다시 떴으면 머지 커밋에 담는다.
  ```bash
  git add tests/skills/fixtures/dflow-dev.SKILL.orig.md tests/skills/fixtures/dflow-merge.SKILL.orig.md
  git commit --amend --no-edit
  ```

- [ ] **Step 4: main push**

```bash
git push origin HEAD:main
```
non-fast-forward 로 거부되면 `rm node_modules && cd /Users/jji/project/wbs-web && git worktree remove /Users/jji/project/wbs-web-merge-main` 뒤 Step 2 부터 다시 한다. Vercel 배포가 끝나면 `npm run smoke:prod` 를 돌린다.

- [ ] **Step 5: staging 반영 (origin/main back-merge, 임시 워크트리에서)**: 프로젝트 규칙대로 staging 은 `origin/main` 을 back-merge 해서 같은 커밋을 받는다. 임시 워크트리는 **로컬** staging 에서 시작한다. 이유: 메인 체크아웃의 staging 에 push 되지 않은 커밋(리허설 문서 등)이 있어도, 그 커밋을 포함한 채 앞으로 나아가야 메인 체크아웃이 뒤에 fast-forward 할 수 있다.

```bash
cd /Users/jji/project/wbs-web
git fetch origin
git worktree add --detach /Users/jji/project/wbs-web-merge-staging staging
cd /Users/jji/project/wbs-web-merge-staging
ln -s /Users/jji/project/wbs-web/node_modules node_modules
git merge --no-edit origin/staging        # 다른 PC 가 올린 staging 커밋(없으면 Already up to date)
git merge --no-ff origin/main -m "merge: origin/main → staging: /dflow-team 반영 back-merge"
```
그 다음 Step 3 과 같이 fixture 를 확인한다(여기서 `ORIG_HEAD` 는 back-merge 직전의 staging 이다). 다시 떴으면 Step 3 과 같이 머지 커밋에 담고, 보존 테스트 실패 처리도 Step 3 과 같다. 그 뒤 push 한다.
```bash
npx vitest run tests/skills
git push origin HEAD:staging
```
non-fast-forward 로 거부되면 `git merge --no-edit origin/staging` 를 한 번 더 하고(fetch 뒤) 다시 push 한다. force push 는 쓰지 않는다.

- [ ] **Step 6: 메인 체크아웃에 적용 확인**: 대상 리포의 심링크는 메인 체크아웃 작업트리를 가리키므로, 그 작업트리가 수정본이어야 한다.

```bash
cd /Users/jji/project/wbs-web && git fetch origin
b=$(git branch --show-current); echo "$b"
case "$b" in staging|main) git merge --ff-only "origin/$b" ;; *) echo OTHER_BRANCH ;; esac
grep -- --worker .claude/skills/dflow-dev/SKILL.md
```
`grep` 이 표지 블록 줄을 출력해야 한다. `OTHER_BRANCH` 이거나 fast-forward 가 되지 않으면 멈추고 사람에게 보고한다. fast-forward 실패의 원인은 둘 중 하나다: Step 5 사이에 다른 세션이 로컬 브랜치에 커밋을 더했거나, 작업트리의 미커밋 변경이 들어오는 파일과 겹친다. 어느 쪽이든 다른 세션의 체크아웃을 stash·switch·reset 하지 않는다.

- [ ] **Step 7: 정리**

```bash
rm /Users/jji/project/wbs-web-merge-main/node_modules /Users/jji/project/wbs-web-merge-staging/node_modules
cd /Users/jji/project/wbs-web
git worktree remove /Users/jji/project/wbs-web-merge-main
git worktree remove /Users/jji/project/wbs-web-merge-staging
```
`feat/dflow-team` 워크트리와 브랜치는 superpowers:finishing-a-development-branch 로 정리한다. 리허설 리포의 스킬 심링크는 feat 워크트리를 가리키므로, 리허설 리포를 계속 쓸 거라면 심링크를 메인 체크아웃(`/Users/jji/project/wbs-web/.claude/skills/<s>`)으로 다시 건다. 쓰지 않을 거라면 `~/project/mes-base-rehearsal` 과 `~/project/mes-base-rehearsal.git` 을 지운다.

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
| §2 결정 요약 | 각 Task 의 규칙과 이유 한 줄. 신원·잠금·poll 기동 위치는 Task 5, 기존 스킬 수정은 Task 1·2 |
| §3 전제 사실 | 근거·제약으로 반영. §3-5 Orca 핸들·`path:` 선택자는 Task 4, §3-9~§3-12 는 Task 1·2 수정, §3-13·§3-14 는 Task 5 「2-1」, §3-19 는 Task 1 행 G, §3-20 은 Task 1·2 `api_base`, §3-21(zsh)은 Global Constraints·Task 2 로컬 후보 루프·Task 5 전제 검사와 마감 잠금·Task 7 Step 1 과 Task 5 의 금지 단언. §3-8 은 Task 7, §3-6·§3-7 은 Task 9 가 확인한 뒤 스펙에 사실로 적는다 |
| §4-1 명령과 인자 | Task 5 「인자」 |
| §4-2 팀장 상태·재구성·결과 중복 방지·고아 스캔·부트스트랩 실패 정리 | Task 5 「팀장 상태」, Task 4 「고아 정리 규칙」·events.md 필드 |
| §4-3 환경 감지 | Task 5 「0. 환경 감지」 |
| §4-4 시작(잠금·기본 브랜치·신원·host·`~/.dflow`·exclude·재구성·재기록·권한 안내·감시) | Task 5 「1. 시작」 |
| §4-5 기상과 감시(빈 디렉터리 poll·재기동 조건·감시 루프·세대 파일·TICK·처리 표) | Task 5 「2. 기상과 감시」 |
| §4-6 결과 처리(매칭·suspect·생존 증거·status 표·parked·회수·차단기·무응답) | Task 5 「3. 결과 처리」, Task 4 backends.md |
| §4-7 승인 스윕 | Task 5 「4. 승인 스윕」, Task 2 |
| §4-8 팀원 spawn | Task 5 「5. 팀원 spawn」, Task 4 backends.md |
| §4-9 마감(기다림의 상한·잠금 해제) | Task 5 「7. 마감」, Task 4 「고아 정리 규칙」 |
| §5 팀원 계약 | Task 3 worker-prompt.md |
| §6-1 원칙·수정 목록·보존 테스트·표지 | Global Constraints, Task 1·2 Step 1(fixture 커밋)·보존 테스트, Task 10 Step 3·5(fixture 재생성) |
| §6-2 `/dflow-dev` 원문 수정(`api_base`·Phase 0-가 1~5번·106행 spec 경로·기점 이동과 detach 실패·exit 4·Phase 5) | Task 1 Step 5 |
| §6-3 `/dflow-dev --worker`(행 A~H) | Task 1 Step 6 |
| §6-4 `/dflow-merge` 수정 | Task 2, Task 6 가이드 공지 |
| §7 실패·질문·재기동·답 매칭 | Task 5 「3. 결과 처리」·「6. blocked」·「1. 시작」 2번, Task 1 행 D·F·G |
| §8 다중 신원·준비물·권한 준비 | Task 5 전제 검사·권한 안내, Task 6 install.sh 병합, Task 9 Step 2~4·7, Task 9 다중 신원 확인 |
| §9-1 `AGENT_ID`·`.dflow-agent`·`lead`·`parked` | Task 3 「2. 좌석 식별」, Task 4 `parked`, Task 5 「좌석표 연동」 |
| §9-2 팀원 신호 | v1 신호는 `.result` 와 서버 보고(Task 3). 팀원 로컬 이벤트와 heartbeat 는 스펙이 좌석표 S1 이후로 미뤘다 |
| §9-3 팀장 신호 | Task 4 events.md, Task 5(각 기록 시점, STANDBY 자리) |
| §9-4 좌석표 모습 | 화면은 좌석표 S1·S2 몫이다. 이 계획은 신호만 만든다 |
| §10 파일 구성·킷 | 파일 구조 표, Task 3~6 |
| §11-1 적용 좌표와 순서·가이드 공지 | Global Constraints, Task 6 가이드, Task 7~10 순서, Task 10 |
| §11-2 리허설 리포(bare 원격·전용 PAT·코드 작업) | Task 7 Step 1~3, Task 8·9 Step 1 |
| §11-3 A0 (a)~(f), (d) 하드 게이트와 dflow.sh 조건부 수정 | Task 7 Step 4~6 |
| §11-4 Orca 합격 기준 1~12 | Task 8 Step 3 |
| §11-5 에이전트 팀 추가 기준·다중 신원·잠금 | Task 9 Step 5·6 |
| §12 잔여 위험과 후속 | 후속 절, Task 7 Step 6(미관찰 항목), Task 8·9 확인 항목 |

**2. 테스트 수**

| 테스트 파일 | Task | 건수 | 누적(`tests/skills`) |
|---|---|---|---|
| `dflow-dev-worker.test.ts` | 1 | 13 | 13 |
| `dflow-merge-remote.test.ts` | 2 | 9 | 22 |
| `dflow-team.test.ts` worker-prompt | 3 | 11 | 33 |
| `dflow-team.test.ts` backends·events | 4 | 8 | 41 |
| `dflow-team.test.ts` SKILL.md | 5 | 25 | 66 |
| `dflow-team.test.ts` 배포·권한 준비·가이드 | 6 | 5 | 71 |

Task 7·9 는 새 테스트를 더하지 않는다(Task 7 의 A0 (d) 조건부 수정과 Task 9 Step 6 은 기존 테스트에 단언만 더하거나 바꾸고, Task 9 Step 7 은 Task 6 의 형식 테스트가 검사한다). 실패 확인 단계의 기대치: Task 1 FAIL 10·PASS 3(보존 계열 3건은 수정 전 fixture 원문과 현재 파일이 같아 통과한다), Task 2 FAIL 7·PASS 2(같은 이유), Task 3 FAIL 11, Task 4 새 8건 FAIL, Task 5 새 25건 FAIL, Task 6 새 5건 FAIL.

**3. 자리표시자 점검**: 파일 내용·테스트 코드·명령은 전부 본문에 있다. `<id8>`·`<TSK>`·`<FEAT_WT>`·`<MAIN>`·`<신원>`·`<host>`·`<워크트리1>` 같은 꺾쇠는 실행 때 값으로 채우는 절차상의 변수다. Task 7~9 의 판정표 칸, Task 9 의 `agent-team-allow.json` 항목과 settings.local.json 의 기록 명령은 리허설이 만들어 내는 데이터이며 미리 정할 수 없다.

**4. 이름 일관성**: 포인터 키 `TSK ID8 AGENT_ID MAIN_CHECKOUT BACKEND MODEL ANSWER`, 변수 `{MODEL_FLAG}`, 식별자 `<신원>/<host>/w<slot>`·`<신원>/<host>/lead`·`<신원>/<host>/parked`, 좌석 파일 `.dflow-agent`, 감시 출력 `RESULT_READY`·`TICK`·`STALE`, git 경로 파일 `dflow-team.gen`·`dflow-team.lock`(디렉터리, 안에 `owner`·`beat`)·`dflow-team-poll`, 에이전트 이름 `w<slot>-<id8>`, 이벤트 일곱, 결과 줄 해시 `cksum | cut -d' ' -f1`, backends.md 절 「pane(Orca)」「에이전트 팀」「고아 정리 규칙」(5번 생성 브랜치 정리), 잠금 탈취 임시 이름 `$LOCK.stale.$$`, `/dflow-merge` 건너뜀 사유 `기점 미반영`·`승인 뒤 변경`, SKILL.md 절 「1. 시작」~「7. 마감」과 「2-1」~「2-3」, fixture 이름 `dflow-dev.SKILL.orig.md`·`dflow-merge.SKILL.orig.md` 와 머리 주석 형식(파일 구조 표·Task 1·2 Step 1·`parseFixture`·Task 10 Step 3), `failed` 구분 사유 넷(`rate-limit`·`not-isolated`·`no-worker-flag`·`deps`)이 모든 Task 와 테스트에서 같은 철자다. `/dflow-dev` 표지 태그 「--worker」 A·B·C·E·G·H 와 절 제목 `## --worker 팀원 모드 (팀장 전용)` 은 Task 1 테스트와 Task 9 예비책이 같은 문자열을 쓴다. 팀장 전제 검사가 grep 하는 바이트열(`--worker`, `origin/agent/*`)은 Task 1·2 테스트가 그대로 단언한다.
