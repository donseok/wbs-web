# /dflow-team — 팀장 스킬 설계 (2026-09-10)

D'Flow 에서 내게 배정되고 에이전트 위임(`tags:agent`) 된 ready 작업을 상시 감시하다가, 발견되는
대로 Claude Code 내장 에이전트 팀의 팀원에게 나눠 주어 동시에 개발시키는 팀장 스킬이다. 팀원 한 명이
작업 한 건을 맡아 `/dflow-dev` 를 돌리고, 끝나면 WBS 처리(`done --auto-links`)와 보고를 한 뒤 그
슬롯에 다음 작업이 들어간다. 담당자마다 자기 PC 에서 띄우면 각자 배정분이 병렬로 진행된다. 진행 중인
팀원과 작업은 D'Flow 에이전트 좌석표(가상 오피스)에 그대로 나타나야 한다.

상태: 설계 승인 대기(2026-09-10 개정 2판). 구현 착수는 별도 지시를 기다린다.

---

## 1. 목표와 비목표

**목표**
- `/dflow-poll` 이 한 번에 1건만 착수하던 것을 슬롯 N개 동시 착수 + 상시 보충으로 넓힌다. 팬아웃
  재료는 이미 있다 — `poll.sh` 는 exit 0 에서 ready 작업을 여러 줄 내보내는데 현행 `/dflow-poll` 은
  첫 줄만 쓴다.
- 팀원은 완료 시 WBS 처리와 보고를 하고, 팀장은 그 슬롯에 다음 작업을 배정한다.
- 여러 담당자가 각자 PC 에서 띄워도 서로의 작업을 건드리지 않는다.
- 일반 터미널·tmux·Orca·VS Code 어디서 팀장을 띄워도 같은 절차로 동작한다.
- 팀원·팀장의 활동이 좌석표 설계(`2026-09-10-agent-seatmap-monitoring-design.md`)의 데이터 경로에
  실린다. 이 문서는 **연동 계약**만 정하고, heartbeat API·화면 구현은 좌석표 설계의 S1·S2 가 한다.
- 기존 스킬(`dflow-dev`·`dflow-poll`·`dflow-merge`·`dflow-work`)은 **수정하지 않는다**(사용자 결정).

**비목표**
- 좌석표 화면·heartbeat 서버 경로 자체의 구현(좌석표 설계 S1·S2·S4).
- tmux·Orca pane 에 독립 claude 세션을 띄우는 백엔드. Orca 는 tmux shim 이 `display-message`·
  `list-panes -F`·`capture-pane` 을 거부해 이식성이 없다(2026-09-10 실측).
- 팀원별 PAT 분리. 한 PC 의 신원은 하나로 간다(§3-6).
- 완전 무인 실행. 담당자가 자리에 있는 시간대의 supervised 루프다. 자율 러너 설계(2026-08-20)가
  무인용으로 기각한 "상주 세션(B안)" 을 슬롯 N개로 늘린 것이므로 그 기각 사유(세션 사망 시 재시작
  주체 부재)는 그대로 남는다. 담당자가 자리를 비우면 판단이 필요한 작업만 멈추고 나머지는 계속 간다.

## 2. 사용자 결정 기록

| 결정 | 내용 |
|---|---|
| 백엔드 | Claude Code 내장 에이전트 팀(Agent 도구). 모든 터미널에서 동작하는 유일한 백엔드 |
| 서버 쓰기 | 팀원이 claim·progress·done 을 전부 수행(현행 `/dflow-dev` 그대로) |
| 기존 스킬 | 손대지 않는다. 필요한 차이는 새 스킬의 팀원 프롬프트로 흡수 |
| 정본 위치 | `wbs-web/.claude/skills/dflow-team/` — 다른 dflow-* 와 같이 dflow-kit 으로 배포 |
| 운영 형태 | 상시 폴링·자동 분배·완료 시 보충, 담당자별 PC 에서 각자 실행 |
| 관제 | 작업 중인 팀원·작업이 좌석표(가상 오피스)에 표현돼야 한다 |

## 3. 전제와 제약 (조사 결과)

1. **워크트리는 하네스가 만든다.** Agent 도구에 `isolation: worktree` 를 주면
   `<리포>/.claude/worktrees/agent-<id>` 에 워크트리를 만들고 팀원의 cwd 를 거기로 고정한다
   (브랜치 `worktree-agent-<id>`, locked). 팀원 스레드는 cwd 가 리셋되므로 팀장이 만든 경로로
   `cd` 시키는 방식은 쓰지 않는다.
2. **완료된 팀원을 재개하면 워크트리가 없다.** 턴이 끝난 뒤 변경 없는 워크트리는 자동 정리되고,
   메시지로 재개된 팀원의 cwd 는 메인 체크아웃으로 떨어진다(2026-09-10 실측). 그 상태에서 쓰기를
   하면 격리 없이 메인을 건드린다. 따라서 **작업 1건 = 팀원 spawn 1회** 로 고정하고, 팀원을 새 작업이나
   질문 답변으로 재개하지 않는다. 팀원은 시작 시 자기 cwd 가 `.claude/worktrees/` 아래인지 확인하고
   아니면 즉시 중단한다.
3. **워크트리에는 `.env` 가 없다**(gitignore). `.claude/skills` 는 커밋된 리포(wbs-web)에만 있고,
   mes-base 같은 대상 리포는 메인 체크아웃에도 없거나 wbs-web 을 가리키는 심링크다. 팀원이 첫
   행동으로 둘을 메인 체크아웃에서 심링크한다.
4. **팀원에게 AskUserQuestion 이 없다.** Skill·Agent·SendMessage 는 있다. 사람 판단은 팀원이
   `blocked` 로 끝내고 팀장이 담당자에게 물은 뒤 답을 프롬프트에 담아 같은 작업으로 새 팀원을
   띄우는 방식으로 처리한다(§5, §7). 하네스가 팀원(teammate)으로 띄우든 서브에이전트로 띄우든
   설계가 같다.
5. **`/dflow-dev` 의 머지 세 곳은 워크트리에서 돌 수 없다.** Phase 0-가 승인 스윕, Phase 0-2 의
   "선행 main 미반영이면 직접 머지", "approved 면 즉시 머지" 는 `git switch main` 을 하는데
   main 은 메인 체크아웃이 잡고 있어 "already checked out" 으로 실패한다. 팀원 프롬프트의 워커
   규칙(§5)이 세 곳을 대체한다.
6. **신원은 PC 당 하나다.** dflow.sh 의 에이전트 라벨이 `claude-<hostname>` 고정이라 서버는 같은
   PC 의 팀원을 구분하지 못한다. 러너 설계가 금지한 "같은 사용자의 제2 액터가 남의 주문을
   release·report" 를 프롬프트 규칙으로 막는다 — 팀원은 자기 id8 외에 어떤 서버 쓰기도 하지 않는다.
   좌석표용 팀원 식별은 라벨이 아니라 §9 의 `AGENT_ID` 로 한다.
7. **캐시는 머신당 하나다.** `~/.cache/dflow/last-list.json` 을 모든 프로세스가 덮어쓴다. 팀원은
   순번을 쓰지 않고 id8 만 쓰며 `list` 를 부르지 않는다. id8 접두 해석은 `known-ids.txt` 누적 맵이
   폴백이라 팀장의 `list` 가 배치의 id 를 전부 맵에 넣는다. 잔여 위험은 §12.
8. **`/dflow-merge` 는 로컬 `docs/tasks/*/state.json` 으로 후보를 찾는다.** 워크트리 방식에서는
   그 파일이 각 agent 브랜치에만 있어 팀장 체크아웃에서는 후보가 0건이다. 팀장의 승인 스윕(§6)이
   후보를 브랜치 tip 에서 찾는다.
9. **대화형 세션 전용.** `-p` 에서는 팀이 서브에이전트로 폴백된다. in-process 모드는 `/resume`
   뒤 팀원이 사라진다. 상태 정본은 서버(claim·progress·done)와 원격 agent 브랜치다.
10. **poll.sh 는 감시 루프이며 ready 를 찾으면 종료한다.** `/dflow-poll` 과 같이 백그라운드로
    띄우고 exit code 로 분기한다. 팀장이 이벤트를 처리한 뒤 **매번 다시 띄운다.**
11. **좌석표의 heartbeat 는 아직 서버에 없다.** 좌석표 설계 §5-1 의 `POST .../heartbeat` 와
    `dflow.sh heartbeat`, PostToolUse 훅은 S1 산출물이다. 이 문서는 그 계약이 생겼을 때 팀원·팀장이
    무엇을 보낼지를 정하고, 생기기 전에는 로컬 `~/.dflow/events.jsonl` 만 쓴다.

## 4. 팀장 절차

명령: `/dflow-team [--team-size N] [--until HH:MM] [--interval SEC] [--model opus|sonnet] [--exclude id8,...]`
- `--team-size` 기본 3. 동시 팀원 슬롯 수.
- `--until` 필수(`/dflow-poll` 과 같은 규칙). 새 배정을 멈추는 시각. 진행 중 팀원은 끝까지 간다.
- `--interval` 은 `poll.sh --interval` 로 전달(기본 300).
- `--model` 은 팀원 프롬프트의 `/dflow-dev --model` 로 전달한다.
- `--exclude` 는 영구 제외 목록의 초기값. 팀장이 진행 중·건너뜀·반려 id8 을 여기에 계속 더한다.

팀장은 현재 세션이며 **대상 리포 루트**에서 실행한다. 팀장이 유지하는 상태는 셋뿐이다 —
슬롯 표(슬롯, 팀원 이름, TSK, id8, 시작 시각), 대기 큐(ready 인데 슬롯이 없어 못 준 id8), 제외 목록.
셋 다 세션 메모리이며 파일로 쓰지 않는다. 세션이 죽으면 §7 의 재기동 절차로 서버에서 복원한다.

### 4-1. 시작

1. **전제 검사** — 하나라도 실패하면 아무것도 띄우지 않고 중단한다.
   - `.env` 존재, `set -a; . ./.env; set +a` 후 `dflow.sh doctor` exit 0. `DFLOW_PATS` 첫 토큰이
     **이 PC 담당자의** PAT 여야 한다(`dflow.sh me` 로 이름을 출력해 확인).
   - `git status --porcelain` 이 비어 있다(팀장 체크아웃이 더러우면 승인 스윕이 위험하다).
   - `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`. 아니면 안내 후 중단.
   - `.claude/skills/dflow-dev`·`dflow-work`·`dflow-poll` 이 cwd 에서 해석된다(심링크 포함).
   - `--until` 이 있고 미래 시각이다.
2. **승인 스윕 1회** — §6. 결과(머지됨/대기/반려/건너뜀)를 한 줄씩 보고한다.
3. **감시 시작** — `poll.sh --require-tag agent --until <HH:MM> --interval <SEC> --exclude <제외목록>` 을
   Bash `run_in_background` 로 띄운다. 팀장은 절대 포그라운드로 기다리지 않는다. 시작 이벤트를
   events.jsonl 에 남긴다(§9-3).

### 4-2. 이벤트 루프

팀장은 아래 이벤트가 올 때만 움직인다. 처리 후 poll.sh 가 종료돼 있으면 3번 명령으로 **다시 띄운다**
(제외 목록에 진행 중 id8 을 포함시켜 같은 작업을 다시 잡지 않게 한다). 모든 처리는 events.jsonl 에
한 줄 남긴다(§9-3).

| 이벤트 | 처리 |
|---|---|
| poll exit 0 (ready N줄) | 순번은 버리고 id8 만 쓴다. 후보별 `dflow.sh show <id8>` 로 `item.spec` 이 비면 제외 목록에 넣는다(사유 보고). 남은 것을 빈 슬롯 수만큼 **한 메시지에서 동시에** spawn(§4-3), 나머지는 대기 큐. poll 재시작 |
| poll exit 9 (승인 감지) | 승인 스윕(§6). poll 재시작 |
| poll exit 10 (반려 감지) | 재작업은 기존 agent 브랜치 위에서 이뤄져야 하므로 워크트리 팀원에게 맡기지 않는다. "수동 `/dflow-dev <id8>` 대상" 으로 보고하고 제외 목록에 넣는다. poll 재시작 |
| poll exit 8 (시한) | 새 배정 중단. 대기 큐를 비우고(보고만) 진행 중 팀원의 RESULT 를 모두 받은 뒤 §4-4 |
| poll exit 2·3·5·6·7 | 중단 사유를 보고하고 진행 중 팀원의 RESULT 만 받은 뒤 §4-4 |
| 팀원 RESULT (§5) | 슬롯 표·집계 갱신, 슬롯 해제. `blocked` 면 §7 질문 절차. 대기 큐가 비어 있지 않으면 즉시 그 슬롯에 spawn. 비어 있으면 poll 이 다음 것을 잡는다 |
| 팀원 실패·무응답 | §7 |

보조 신호: 팀원 이벤트가 30분 이상 없으면 `dflow.sh list --scope claimed` 로 진행 중 id8 의 서버
상태를 슬롯 표에 갱신한다(팀원은 `list` 를 안 부르므로 캐시 경쟁은 팀장 자신뿐).

### 4-3. 팀원 spawn

Agent 도구를 `subagent_type: general-purpose`, `isolation: worktree`, `name: <TSK-ID>`(같은 작업을
다시 띄우면 `<TSK-ID>-r<n>`) 로 호출한다. 프롬프트는 `references/worker-prompt.md` 를 치환한 것(§5).
`{AGENT_ID}` 는 그 슬롯의 식별자(§9-1)다. 슬롯 표에 기록한다.

### 4-4. 마감

집계 표(TSK, id8, 브랜치, head, done exit, status, 사유)를 보고한다. `git worktree prune` 후 남은
`.claude/worktrees/agent-*` 를 `git worktree remove` 로 정리하고 `worktree-agent-*` 브랜치를 삭제한다.
**agent 브랜치는 남긴다.** 승인은 사람이 D'Flow 웹에서 하고, 승인 뒤 머지는 다음 `/dflow-team` 의
스윕 또는 `/dflow-merge` 가 한다. 종료 이벤트를 events.jsonl 에 남긴다.

## 5. 팀원 계약 (`references/worker-prompt.md`)

치환 변수: `{TSK}`, `{ID8}`, `{AGENT_ID}`, `{MAIN_CHECKOUT}`, `{MODEL_FLAG}`, `{BASE_BRANCH}`,
`{ANSWERS}`(재시도 시 담당자 답변, 없으면 빈 문자열).

**격리 확인 (첫 행동)**
```bash
case "$(git rev-parse --show-toplevel)" in */.claude/worktrees/*) ;; *) echo "NOT_ISOLATED"; exit 1;; esac
```
`NOT_ISOLATED` 면 아무것도 하지 않고 `RESULT {TSK} {ID8} - - - failed not-isolated` 로 끝낸다.

**워크트리 부트스트랩**
```bash
[ -e .env ] || ln -s {MAIN_CHECKOUT}/.env .env
[ -e .claude/skills/dflow-dev ] || { mkdir -p .claude && ln -s {MAIN_CHECKOUT}/.claude/skills .claude/skills; }
set -a; . ./.env; set +a; .claude/skills/dflow-work/scripts/dflow.sh doctor
```
dflow.sh 를 부를 때마다 `set -a; . ./.env; set +a` 를 앞에 붙인다(env 는 Bash 호출 사이에 남지 않는다).

**좌석 식별 (부트스트랩 직후, claim 전)**: `docs/tasks/{TSK}/.agent` 에 `{AGENT_ID}` 한 줄을 쓴다(§9-1).
이 파일은 커밋하지 않는다.

**실행**: Skill 도구로 `/dflow-dev {ID8} {MODEL_FLAG}` 를 실행한다. 참조는 id8 만 쓴다. 순번 금지.
`{ANSWERS}` 가 있으면 그것을 담당자의 결정으로 삼아 같은 agent 브랜치에서 재개한다.

**워커 규칙 — `/dflow-dev` 절차 중 다음 세 곳은 이 프롬프트가 우선한다.**
1. Phase 0-가 승인 스윕을 **실행하지 않는다.** 팀장이 돌린다.
2. Phase 0-2 에서 선행이 완료됐는데 `head_sha` 가 `origin/{BASE_BRANCH}` 에 미반영이면 직접 머지하지
   않는다. 기점을 그 `head_sha` 로 잡아 스택 브랜치를 만들고 state.json 에 `branch_base` 와
   `risk: "선행 main 미반영(팀장 머지 대기)"` 를 기록한 뒤 진행한다.
3. `show` 결과가 `approved` 면 머지하지 않고 `RESULT ... needs-merge` 로 보고하고 종료한다.

**서버 쓰기 범위**: `{ID8}` 외의 어떤 주문에도 claim·progress·release·done 을 하지 않는다.
`list` 는 호출하지 않는다. 필요한 조회는 `show {ID8}` 뿐이다.

**판단 규칙**: 명백한 기본값이 있으면 그것을 택하고 결정 내용을 design.md 또는 커밋 메시지에 한 줄
남긴 뒤 진행한다. 기본값이 없어 담당자 결정이 필요할 때만 멈춘다 — 그때는 **현재 산출물을 커밋·push 한
뒤** `blocked` 신호(§9-2)를 남기고 `RESULT ... blocked` 로 끝내며 사유 자리에 질문과 선택지를 적는다.
답을 기다리며 대기하지 않는다.

**완료**: 마지막 응답의 마지막 줄을 아래 한 줄로 끝낸다. 팀장은 이 줄만 파싱한다.
```
RESULT {TSK} {ID8} <branch|-> <head_sha|-> <done_exit|-> <status> <한 줄 사유 또는 질문>
```
`status` ∈ `done` / `skipped`(claim exit 4·spec 부재·착수 불가) / `needs-merge` / `blocked` / `failed`.

## 6. 승인 스윕 (팀장, `/dflow-merge` 무수정)

후보 식별만 다르고 판정·머지 절차는 `dflow-merge/SKILL.md` 를 그대로 따른다.

1. **후보** = `git fetch origin` 후 `git branch -r --list 'origin/agent/*'` 각 브랜치 tip 의
   `docs/tasks/*/state.json`(`git show origin/<branch>:docs/tasks/<TSK>/state.json`) + 로컬
   `docs/tasks/*/state.json` 의 `reported`. 워크트리에서 마감한 작업은 `reported` 갱신이 커밋되지
   않은 채 정리될 수 있으므로 브랜치 tip 의 phase 를 믿지 않고 **서버 `show` 로만 판정**한다.
   원격 기준으로 보는 이유는 다른 PC 의 팀원이 만든 브랜치도 이 PC 의 스윕이 머지할 수 있어야 하기
   때문이다.
2. **판정**: `dflow.sh show <ref>` 가 `status=approved` 인 것만. 반려(`.reports` 마지막 completion 의
   `review_action=reject`)는 대기와 갈라 집계한다.
3. **순서·머지·뒷정리**: dflow-merge 그대로(조상 먼저, `--no-ff`, 훅 거부 시 우회 금지,
   `phase=merged` 커밋, 머지된 agent 브랜치 삭제). 두 PC 의 스윕이 동시에 같은 브랜치를 머지하려 하면
   나중 쪽의 `git push` 가 non-fast-forward 로 거부된다 — 그때는 `pull --ff-only` 후 후보를 다시
   식별한다(이미 머지된 것은 후보에서 빠진다).

## 7. 실패·질문·재기동

| 상황 | 팀원 | 팀장 |
|---|---|---|
| claim exit 4(다른 세션·다른 PC 선점, 선행 미충족) | `skipped` 로 즉시 종료 | 집계, 제외 목록 추가 |
| spec 부재 | exit 0 처리에서 걸러짐. 새어 오면 `skipped` | 집계, 제외 목록 추가 |
| `blocked`(담당자 결정 필요) | 커밋·push, blocked 신호 후 종료 | AskUserQuestion 으로 담당자에게 묻고, 답을 `{ANSWERS}` 에 담아 **같은 id8 로 새 팀원** spawn(이름 `<TSK>-r<n>`, 같은 `{AGENT_ID}`). 담당자가 자리에 없으면 그 작업은 대기 큐 맨 뒤로 가고 슬롯은 다른 작업에 준다 |
| `needs-merge` | 종료 | 승인 스윕(§6) 즉시 실행 |
| `failed`(push 훅 거부·게이트 실패 등) | dflow-dev 규칙대로 중단 | 집계, 제외 목록 추가, 사유 보고. 자동 재시도 없음 |
| 팀원 무응답(2시간 이상 이벤트 없음) | — | `show <id8>`: claimed 면 워크트리를 `git worktree remove --force` 로 정리하고 "재개 필요" 로 보고. 다음 `/dflow-dev <id8>` 이 브랜치 재개 규칙으로 이어받음 |
| 팀장 세션 소실 | in-process 면 함께 소실 | 재기동 시 `dflow.sh list --scope claimed` 와 `git branch -r --list 'origin/agent/*'` 를 대조한다. claimed 인데 진행 중 팀원이 없는 id8 은 "재개 필요" 로 보고하고 제외 목록에 넣는다(자동 재착수 없음 — 사람이 `/dflow-dev <id8>` 로 재개). 그 뒤 §4-1 로 정상 시작 |

동시에 도는 작업은 poll.sh 가 RD(ready) 로 걸러 준 독립 작업이라 서로 스택하지 않는다. 미승인
선행 위 스택은 `/dflow-dev` 기존 규칙(선행 산출물 실재 확인 후 스택 + risk 기록)대로 각 팀원이 한다.

## 8. 다중 PC 운영

- **분할 키는 D'Flow 배정이다.** `poll.sh` 는 `list --scope assigned`(내게 배정된 작업)만 본다.
  PC 마다 그 담당자의 PAT 를 `.env` `DFLOW_PATS` 첫 토큰으로 두면 각 팀장은 자기 배정분만 잡는다.
- **같은 담당자가 두 PC 에서 띄워도** 서버 claim 이 잠금이다. 늦은 쪽은 exit 4 로 `skipped`.
- **로컬 상태를 공유하지 않는다.** 슬롯 표·대기 큐·제외 목록·`~/.cache/dflow`·`~/.dflow/events.jsonl` 은
  PC 로컬이다. PC 간에 공유되는 것은 서버 상태와 원격 `agent/*` 브랜치뿐이며, 승인 스윕이 원격
  기준으로 후보를 보는 이유가 이것이다(§6-1).
- **PC 별 준비물**: 대상 리포 클론, `.env`(해당 담당자 PAT·`DFLOW_API_BASE`·`DFLOW_PROJECT_MAP`),
  `.claude/skills/dflow-*` 설치(dflow-kit), `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`, 대화형 세션.
  이 목록은 SKILL.md 의 전제 검사와 일치해야 한다.

## 9. 가상 오피스(좌석표) 연동 계약

좌석표의 모델은 층=프로젝트, 구역=WP, 책상=작업 주문, 의자의 사람=그 주문을 잡은 에이전트다. 팀
스킬은 "사람이 책상을 옮겨 다니는" 모습이 되어야 하므로 아래를 계약으로 둔다. 서버·화면 쪽 구현은
좌석표 설계가 맡고, 이 절은 팀 스킬이 **무엇을 어디에 남기는지**만 정한다.

### 9-1. 팀원 식별자 `AGENT_ID`

- 형식: `<hostname>/w<slot>` (예: `jji-mbp/w2`). **작업이 아니라 슬롯에 붙는다.** 같은 슬롯이 다음
  작업을 받으면 같은 식별자로 다음 책상에 앉는다. 좌석표는 이 문자열의 해시로 캐릭터(머리·셔츠)를
  정하므로 슬롯마다 일관된 인물이 된다. `blocked` 재시도(`<TSK>-r<n>`)도 같은 `AGENT_ID` 를 쓴다.
- 팀장 자신은 `<hostname>/lead`.
- 전달 경로: 팀원이 `docs/tasks/<TSK>/.agent` 에 한 줄로 쓴다(§5). 좌석표 S1 의 PostToolUse 훅은
  현재 브랜치 → state.json → order id 를 읽을 때 같은 디렉터리의 `.agent` 가 있으면 그 값을
  `heartbeat_agent` 로, 없으면 종전대로 Phase 서브에이전트 이름을 보낸다. **이 파일 규칙은 좌석표 S1
  구현에 반영해 달라는 요청 사항이다.**
- `.agent` 는 워크트리 안에 있고 커밋하지 않는다. 훅은 팀원 프로세스의 cwd(워크트리)에서 실행되므로
  `.env` 심링크(§5)만 있으면 서버 heartbeat 경로가 그대로 동작한다.

### 9-2. 팀원이 남기는 신호

| 시점 | S1 이후(서버) | 항상(로컬 events.jsonl) |
|---|---|---|
| 착수(claim 직후) | 훅이 첫 도구 호출에서 heartbeat | `event: claim` |
| Phase 진행 | 훅 heartbeat(60초 절제) + dflow-dev 의 progress 25/60/85 | dflow-dev·훅이 기록(좌석표 §5-2) |
| `blocked` 직전 | `dflow.sh heartbeat <id8> --phase blocked --note "<질문>"` 1회 | `event: blocked`, `note` |
| 완료·실패 | `done`/`failed` 보고(기존) | `event: result`, `status` |

`blocked` 는 좌석표 상태 모델(active/stale/wait/rejected/ready/done/offline)에 없는 상태다. 지금
모델로는 팀원이 종료되어 heartbeat 가 끊기므로 5분 뒤 "무응답", 30분 뒤 "오프라인" 으로 오인된다.
**좌석표에 `blocked`(담당자 결정 대기, 손 든 사람) 상태를 추가해 달라는 요청 사항이다.** 판정 근거는
`heartbeat_phase = blocked` 이며, 답을 받아 재시도 팀원이 첫 heartbeat 를 보내면 active 로 돌아간다.

### 9-3. 팀장이 남기는 신호

- `~/.dflow/events.jsonl` 에 좌석표 §5-2 와 같은 스키마 `{ts, host, repo, tsk, order, phase, event, agent}`
  로 append 한다. `agent` 는 `<hostname>/lead`. 이벤트: `team.start`(slots, until), `team.spawn`(slot,
  tsk, order), `team.result`(status), `team.question`(tsk), `team.answer`(tsk), `team.sweep`(merged,
  waiting, rejected), `team.stop`. 기록은 `printf '%s\n' '<json>' >> ~/.dflow/events.jsonl` 한 줄이며
  실패해도 진행을 막지 않는다.
- 좌석표의 STANDBY(감시 중) 표시는 poll.sh 존재를 서버에 알리는 계약이 아직 없다(좌석표 §7 미결).
  그 계약이 생기면 팀장이 4-1 시작·4-2 매 poll 재시작·4-4 종료 시점에 `{host, agent: lead, slots,
  busy, until}` 을 보내는 자리를 SKILL.md 에 표시해 둔다. 계약 전에는 events.jsonl 의 `team.start`
  /`team.stop` 이 대체 근거다.

### 9-4. 좌석표에서 기대하는 모습

- 배정 순간 빈 책상(ready)에 슬롯 캐릭터가 앉아 active 가 된다.
- 완료하면 그 책상은 승인 대기(wait)로 바뀌고 캐릭터는 다음 책상으로 옮겨 간다.
- `blocked` 면 캐릭터가 손을 든 채 책상에 남아 있고 "확인 필요" 띠에 질문이 뜬다.
- 팀장은 층 헤더의 감시 표시(STANDBY)로 나타난다. 다른 PC 의 팀장은 hostname 이 다른 별개 표시다.

## 10. 파일 구성

```
.claude/skills/dflow-team/
├── SKILL.md                    # §4 절차. frontmatter 트리거: "/dflow-team", "팀으로 개발", "팀장 시작", "N건 동시 착수"
└── references/
    ├── worker-prompt.md        # §5 팀원 프롬프트 정본(치환 변수 포함)
    └── events.md               # §9-3 events.jsonl 이벤트 이름·필드 표(좌석표 설계 §5-2 와 동일 스키마)
```
스크립트는 새로 두지 않는다. `poll.sh`·`dflow.sh` 를 재사용한다. 배포는 dflow-kit 의 기존
`kit-build.sh` 대상 목록에 `dflow-team` 을 추가한다(별도 커밋).

## 11. 검증 (리허설)

스킬 문서는 vitest 대상이 아니다. 스테이징 D'Flow 를 향한 mes-base 리허설로 검증한다.

- 준비: mes-base 에 `agent` 태그가 붙은 독립 ready 작업 3건(그중 1건은 spec 에 담당자 결정이 필요한
  분기를 일부러 남긴다), `.env` 는 스테이징.
- 실행: `/dflow-team --team-size 2 --until <2시간 뒤>`.
- 합격 기준:
  1. 첫 poll 에서 2건이 동시에 spawn 되고 3번째는 대기 큐에 들어갔다가, 먼저 끝난 슬롯에 자동 배정된다.
  2. 각 팀원이 `.claude/worktrees/agent-*` 에서 `agent/<id8>-<slug>` 브랜치를 만들고 push 했다.
  3. 메인 체크아웃의 현재 브랜치와 작업트리가 실행 전후로 같다.
  4. 서버에 `done` 이 각자 id8 로 기록됐고(`show`) 다른 주문은 건드리지 않았다.
  5. 결정 분기 작업이 `blocked` 로 끝나고, 답을 준 뒤 `<TSK>-r1` 이 같은 브랜치에서 재개해 `done` 했다.
  6. 마감 뒤 워크트리는 없고 agent 브랜치 3개는 남아 있다.
  7. 이어서 `/dflow-team` 을 다시 돌리면 승인 스윕이 원격 브랜치 3개를 후보로 잡는다(승인 전이면 "대기").
  8. `~/.dflow/events.jsonl` 에 `team.start` → `team.spawn`×2 → `team.result` → `team.spawn`(3번째)
     → `team.question`/`team.answer` → … → `team.stop` 순서가 남고, 각 워크트리의 `docs/tasks/<TSK>/.agent`
     가 슬롯 식별자(`<host>/w1`, `<host>/w2`)였다. 3번째 작업의 `.agent` 는 먼저 빈 슬롯의 값과 같다.
- 좌석표 화면 확인(S1·S2 이후): 슬롯 캐릭터가 책상을 옮겨 가는 것, `blocked` 가 손 든 상태로 보이는 것.
- 다중 PC 는 같은 PC 에서 세션 두 개를 같은 PAT 로 띄워 exit 4 분기만 확인한다(2차 리허설에서 실제
  두 PC).
- 실패 시: 팀원 transcript 와 `dflow.sh show` 로 원인 확정 후 프롬프트를 고친다. 서버 쓰기 오류가
  있으면 스테이징에서 주문을 release 해 되돌린다.

## 12. 잔여 위험

- **캐시 공유**: 팀원의 `show` 가 id8 을 접두 해석하는 순간 팀장의 `list` 가 `last-list.json` 을 덮을
  수 있다. `known-ids.txt` 누적 맵이 폴백이고 팀원은 `list` 를 부르지 않으며 팀장도 보조 신호에서만
  부른다. 접두 해석이 실패하면 팀원은 `failed` 로 끝나고 사람이 재개한다. poll.sh 출력에 전체 UUID 를
  추가하면 근본 해결이지만 기존 스킬 무수정 원칙에 따라 이번엔 보류한다.
- **워커 규칙이 프롬프트 우선순위에 의존**한다. `/dflow-dev` 는 "매 호출마다 스윕" 이라고 강하게
  쓰여 있어 팀원이 프롬프트를 무시하고 스윕을 시도할 수 있다. 시도해도 `git switch main` 이
  실패해 중단되므로 데이터 훼손은 없고, 리허설 11-3 이 이를 잡는다. 반복되면 그때 `/dflow-dev` 에
  플래그를 넣는 결정을 다시 올린다.
- **`blocked` 재시도의 워크트리 잔재**: 팀원이 커밋 전에 죽으면 변경 있는 워크트리가 남아 그 브랜치를
  잡고 있다. 같은 id8 을 다시 띄우기 전에 팀장이 `git worktree list` 로 확인하고 `remove --force`
  한다(미커밋분은 잃는다 — 커밋 후 `blocked` 규칙이 이를 최소화한다).
- **하네스가 팀원을 teammate 로 띄우는지 subagent 로 띄우는지** 문서로 확정되지 않았다. 재개를 쓰지
  않으므로 설계는 같지만, 권한 프롬프트가 팀장 화면에 뜨는 방식은 리허설에서 확인한다.
- **좌석표 의존**: `.agent` 규칙과 `blocked` 상태는 좌석표 S1·S2 가 받아 줘야 화면에 나온다. 받기
  전까지 팀 스킬은 events.jsonl 만으로 검증되며(11-8), 화면에는 팀원이 Phase 서브에이전트 이름으로
  보인다.
- **토큰 비용**: 슬롯 N개 × 각자의 Phase 서브에이전트. `--team-size` 기본 3 을 넘길 때는 사용자가
  명시한다.
