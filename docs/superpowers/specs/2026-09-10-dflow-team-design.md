# /dflow-team — 팀장 스킬 설계 (2026-09-10, 개정 3판)

D'Flow 에서 내게 배정되고 에이전트 위임(`tags:agent`) 된 ready 작업을 상시 감시하다가, 발견되는
대로 팀원에게 나눠 주어 동시에 개발시키는 팀장 스킬이다. 팀원은 **별도 프로세스로 뜨는 진짜 메인
에이전트**이며(서브에이전트가 아니다) 각자 자기 워크트리에서 작업 한 건을 맡아 `/dflow-dev` 를 돌린다.
팀원은 끝나면 WBS 처리(`done --auto-links`)와 보고를 하고, 그 슬롯에 다음 작업이 들어간다. 담당자마다
자기 PC 에서 띄우면 각자 배정분이 병렬로 진행된다. 진행 중인 팀원과 작업은 D'Flow 에이전트
좌석표(가상 오피스)에 그대로 나타나야 한다.

상태: 설계 승인 대기(2026-09-10 개정 3판). 구현 착수는 별도 지시를 기다린다.

> **개정 3판이 개정 2판을 뒤집은 이유** — 개정 2판은 팀원을 Agent 도구 `isolation: worktree`
> 서브에이전트로 띄웠다. 실측에서 (1) `cd` 가 Bash 호출 사이에 유지되지 않아 in-process 팀원은
> 각자 워크트리 cwd 를 못 가지며, (2) 사용자가 "팀장이 서브에이전트로 팀원을 불러 Task 를 구현하면
> 안 되고, pane 을 새로 열거나 새 메인 에이전트를 띄워야 한다" 고 못 박았다. 그래서 팀원은 별도
> 프로세스의 진짜 메인 에이전트가 되고, 실행 백엔드는 환경별로 갈린다(§3-5). 팀원이 진짜 대화형
> 세션이라 개정 2판의 blocked→RESULT 중계·재spawn 구조가 사라지고, 보고는 파일 계약(§5-보고)으로,
> 질문은 그 팀원 탭에서 사람이 답하는 방식(§7)으로 단순해졌다.

---

## 1. 목표와 비목표

**목표**
- `/dflow-poll` 이 한 번에 1건만 착수하던 것을 슬롯 N개 동시 착수 + 상시 보충으로 넓힌다. 팬아웃
  재료는 이미 있다 — `poll.sh` 는 exit 0 에서 ready 작업을 여러 줄 내보내는데 현행 `/dflow-poll` 은
  첫 줄만 쓴다.
- 팀원은 완료 시 WBS 처리와 보고를 하고, 팀장은 그 슬롯에 다음 작업을 배정한다.
- 여러 담당자(신원)가 각자 PC 에서, 또는 한 PC 에 여러 신원이 각자 띄워도 서로의 작업을 건드리지
  않는다(§8). 신원은 PC 당 하나가 아니다.
- **Orca·진짜 tmux·일반 터미널** 어디서 팀장을 띄워도 그 환경에 맞는 백엔드로 동작한다(§3-5, §4-0).
  일반 터미널은 병렬 메인 에이전트를 못 띄우므로 `/dflow-poll` 로 안내하고 종료한다(비목표 참고).
- 팀원·팀장의 활동이 좌석표 설계(`2026-09-10-agent-seatmap-monitoring-design.md`)의 데이터 경로에
  실린다. 이 문서는 **연동 계약**만 정하고, heartbeat API·화면 구현은 좌석표 설계의 S1·S2 가 한다.
- 기존 스킬은 **순수 가산(additive)** 으로만 손댄다 — `/dflow-dev` 에 `--worker` 플래그를 더하고
  `/dflow-merge` 후보 식별을 넓히되, **플래그·인자 없는 기본 동작은 한 줄도 바꾸지 않는다**(§3-14).

**비목표**
- 좌석표 화면·heartbeat 서버 경로 자체의 구현(좌석표 설계 S1·S2·S4).
- **`/dflow-poll` 수정.** 4사이클 실적이 있는 검증된 경로다. 팀 스킬은 poll.sh 를 그대로 재사용만
  하고 dflow-poll SKILL.md 는 손대지 않는다 — 상시 보충은 팀장 이벤트 루프가 하지 dflow-poll 을
  고쳐서 하지 않는다.
- **일반 터미널에서의 병렬 실행.** 일반 터미널은 독립된 대화형 메인 에이전트를 여러 개 띄울 수단이
  없다(§3-5). 이 환경에서 `/dflow-team` 은 병렬을 흉내 내는 두 번째 구현을 만들지 않고, `/dflow-poll`
  을 쓰라고 안내하고 종료한다. 직렬 1건 처리는 이미 `/dflow-poll` 이 하는 일이다.
- `poll.sh` 출력에 전체 UUID 추가. 팀원이 `list` 를 안 부르고 `known-ids.txt` 폴백이 있어 잔여
  위험이 얇다(§12). 지금 손대면 계약 표면만 넓어진다.
- 팀원별 PAT 분리. 한 신원(PAT)이 자기 배정분을 슬롯 N개로 처리한다. 서버 claim 이 잠금이다(§8).
- 완전 무인 실행. 담당자가 자리에 있는 시간대의 supervised 루프다. 자율 러너 설계(2026-08-20)가
  무인용으로 기각한 "상주 세션(B안)" 을 슬롯 N개로 늘린 것이므로 그 기각 사유(세션 사망 시 재시작
  주체 부재)는 그대로 남는다. 담당자가 자리를 비우면 판단이 필요한 작업만 멈추고 나머지는 계속 간다.

## 2. 사용자 결정 기록

| 결정 | 내용 |
|---|---|
| 팀원 정체 | **별도 프로세스로 뜨는 진짜 메인 에이전트**(teammate/독립 세션). 팀장이 서브에이전트로 팀원을 부르지 않는다. 팀원 내부에서만 `/dflow-dev` 가 phase 를 서브에이전트로 분할한다 |
| 백엔드 | **환경 적응형**: Orca → `orca worktree create --agent claude --prompt`, 진짜 tmux → dev-plugin `/team-mode`(로드 실패 수정 후 재사용), 일반 터미널 → `/dflow-poll` 로 안내 후 종료 |
| 워크트리 | 팀장(신원)당 상주 1개 + **팀원마다 임시 워크트리**. 병렬 `/dflow-dev` 가 브랜치를 switch/commit/push 하므로 워크트리를 공유하면 훼손된다(한 워크트리 = HEAD·인덱스 하나). `git worktree add` 는 오브젝트 저장소를 공유해 가볍고, Orca 는 이를 자동으로 만든다 |
| 신원 | **PC 당 하나가 아니다.** 공용 개발 PC 에 여러 신원·여러 팀장이 있을 수 있다. 좌석표 식별은 `AGENT_ID = <신원>/w<slot>`(§9-1) |
| 보고 | 팀장→팀원 메시지 채널을 만들지 않는다. 팀원이 자기 워크트리에 `docs/tasks/<TSK>/.result` 한 줄을 쓰고, 팀장이 그 파일 + 서버(poll.sh·`list --scope claimed`)를 읽는다(§5-보고, §4-2) |
| 질문(AskUserQuestion) | **자동/수동 판별로 가른다.** 팀장이 붙이는 `--worker`(자동) 면 AskUserQuestion 을 쓰지 않고, 사람이 직접 `/dflow-dev` 를 호출한 수동이면 그대로 쓴다([[no-questions-in-auto-loops]]). blocked 는 그 팀원 탭에서 사람이 답한다(§7) |
| 기존 스킬 | 순수 가산 수정. `/dflow-dev` 에 `--worker`, `/dflow-merge` 에 원격 후보 식별. 기본 동작 불변. `/dflow-poll` 은 손대지 않는다 |
| 정본 위치 | `wbs-web/.claude/skills/dflow-team/` — 다른 dflow-* 와 같이 dflow-kit 으로 배포 |
| 운영 형태 | 상시 폴링·자동 분배·완료 시 보충, 신원별로 각자 실행 |
| 관제 | 작업 중인 팀원·작업이 좌석표(가상 오피스)에 표현돼야 한다 |

## 3. 전제와 제약 (조사·실측 결과)

1. **`cd` 는 Bash 호출 사이에 유지되지 않는다**(2026-09-10 실측, 메인 체크아웃·워크트리 모두). 매
   Bash 호출은 세션 고정 cwd 로 리셋된다. 따라서 한 세션(팀장이든 in-process 팀원이든)은 자기 고정
   cwd 에서만 작업할 수 있고, 여러 in-process 팀원이 각자 다른 워크트리 cwd 를 가질 방법이 없다.
   병렬 격리는 **별도 OS 프로세스를 각자 워크트리를 cwd 로 삼아 띄우는 것**으로만 가능하다.
2. **팀원은 별도 프로세스의 진짜 메인 에이전트다.** 서브에이전트가 아니라 독립 대화형 세션이며,
   그래서 AskUserQuestion·Skill·Bash 를 온전히 쓴다. 팀원 내부의 phase 분할(design/build/verify/
   refactor)만 서브에이전트로 이뤄진다(`/dflow-dev` 가 이미 그렇게 한다).
3. **워크트리는 팀장(신원)당 상주 1개 + 팀원마다 임시 1개다.** 워크트리 하나에는 체크아웃된 브랜치가
   하나뿐이라, 팀원 둘이 한 워크트리에서 각자 `git switch -c agent/...` 하면 공유된 작업 디렉터리가
   서로의 브랜치로 끌려가 훼손된다. `git worktree add` 는 리포를 복제하지 않고 `.git` 오브젝트 저장소를
   공유하므로(작업 디렉터리·HEAD 만 별도) 가볍다. 팀원 워크트리는 작업 완료·마감 때 정리한다.
4. **신원은 PC 당 하나가 아니다.** 한 공용 PC 에 여러 신원의 세션이 있고 팀장도 여럿일 수 있다.
   dflow.sh 의 서버 에이전트 라벨은 `claude-<hostname>` 고정이라 같은 PC 의 팀원을 서버가 구분하지
   못한다(§10-라벨 한계). 좌석표용 식별은 라벨이 아니라 §9-1 의 `AGENT_ID = <신원>/w<slot>` 으로
   한다. 신원은 `dflow.sh me` 가 돌려주는 담당자 식별로 잡는다.
5. **실행 백엔드는 환경별로 갈린다.**
   - **Orca**: `orca worktree create --name <n> --agent claude --prompt "<worker-prompt>" --json`
     가 새 워크트리를 만들고 그 안에서 claude 메인 에이전트를 띄우며 **프롬프트를 첫 입력으로 자동
     제출한다**(2026-09-10 실측: 프롬프트대로 즉시 착수, cwd 는 그 워크트리, `--dangerously-skip-
     permissions` 로 뜸, 기본 모델 Fable 5.1 — 팀원 모델은 프롬프트의 `/dflow-dev --model` 로 명시).
     팀장은 결과 JSON 의 `result.worktree.path` 와 `result.agentTerminalHandle` 을 슬롯 표에 저장한다.
     정리는 `orca worktree rm --worktree "<id>"`(실측: `removed: true`, 워크트리·브랜치·디렉터리 삭제).
   - **진짜 tmux**: dev-plugin(`dev@dev-tools`, `~/project/dev-plugin`)의 `/team-mode` 가
     send-keys·시그널·pane 재활용·bracketed-paste 를 이미 해결해 두었다. 팀 스킬은 이를 새로 만들지
     않고 재사용한다. **선행 조건**: 현재 `hooks/hooks.json` 로드 실패(§12)를 고쳐야 `/team-mode` 가
     뜬다. 워크트리·pane 생성은 team-mode 의 기존 메커니즘에 위임한다.
   - **일반 터미널**: 독립 대화형 메인 에이전트를 여러 개 띄울 수단이 없다. `/dflow-team` 은
     `/dflow-poll` 을 쓰라고 안내하고 종료한다(비목표).
   - **Orca 의 tmux shim 함정**: Orca 는 `claude --teammate-mode auto` 로 띄우고 PATH 앞에 tmux
     shim 을 끼워 `display-message`·`list-panes -F`·`capture-pane` 등을 거부한다. 그래서 Orca 에서는
     tmux 백엔드가 아니라 `orca worktree create` 를 쓴다(§4-0 이 `$TERM_PROGRAM=Orca` 로 먼저 가른다).
6. **팀원의 판단·질문은 자동/수동으로 갈린다.** 팀장이 붙이는 `--worker` 가 곧 "자동" 신호다.
   자동이면 팀원은 AskUserQuestion 을 쓰지 않고 명백한 기본값으로 진행하며(결정을 커밋·design.md 에
   한 줄 남긴다), 기본값이 없어 사람 결정이 꼭 필요할 때만 `blocked` 로 멈춘다(§5, §7). 사람이 직접
   `/dflow-dev <id8>`(플래그 없음) 를 호출한 수동 실행은 지금처럼 AskUserQuestion 을 쓴다.
7. **보고는 파일 계약이다.** 팀원은 별도 세션이라 팀장이 그 마지막 응답을 읽을 수 없다. 팀원은 자기
   워크트리의 `docs/tasks/<TSK>/.result` 에 한 줄(§5-보고)을 쓰고, 팀장은 알고 있는 그 워크트리 경로에서
   그 파일을 읽는다. 이 파일은 커밋하지 않는다. 서버(claim·done)와 원격 agent 브랜치가 상태 정본이며,
   `.result` 는 팀장이 슬롯을 회수·집계하기 위한 로컬 신호다.
8. **`/dflow-dev` 의 머지 세 곳은 팀원 워크트리에서 돌 수 없다.** Phase 0-가 승인 스윕, Phase 0-2 의
   "선행 main 미반영이면 직접 머지", "approved 면 즉시 머지" 는 기본 브랜치를 `git switch` 하는데
   기본 브랜치는 팀장 체크아웃이 잡고 있어 "already checked out" 으로 실패한다. `--worker` 가 세 곳을
   대체한다(§5-A).
9. **`/dflow-merge` 는 로컬 `docs/tasks/*/state.json` 으로 후보를 찾는다.** 팀원 워크트리에서 마감한
   작업은 그 파일이 각 agent 브랜치·워크트리에만 있어 팀장 체크아웃에서는 후보가 0건일 수 있다.
   팀장의 승인 스윕(§6)이 후보를 원격 브랜치 tip 에서도 찾는다.
10. **서버 라벨·캐시는 신원/머신 단위다.** 에이전트 라벨 `claude-<hostname>` 과
    `~/.cache/dflow/last-list.json` 을 같은 머신의 모든 프로세스가 공유한다. 팀원은 자기 id8 외에 어떤
    서버 쓰기도 하지 않고(claim/progress/release/done 은 자기 것만), `list` 를 부르지 않는다. id8 접두
    해석은 `known-ids.txt` 누적 맵이 폴백이며 팀장의 `list` 가 배치의 id 를 전부 맵에 넣는다.
11. **poll.sh 는 감시 루프이며 ready 를 찾으면 종료한다.** `/dflow-poll` 과 같이 백그라운드로 띄우고
    exit code 로 분기한다. 팀장이 이벤트를 처리한 뒤 **매번 다시 띄운다.**
12. **좌석표의 heartbeat 는 아직 서버에 없다.** 좌석표 설계 §5-1 의 `POST .../heartbeat` 와
    `dflow.sh heartbeat`, PostToolUse 훅은 S1 산출물이다. 이 문서는 그 계약이 생겼을 때 팀원·팀장이
    무엇을 보낼지를 정하고, 생기기 전에는 로컬 `~/.dflow/events.jsonl` 만 쓴다.
13. **대화형 세션 전용.** `-p` 비대화형은 쓰지 않는다(사용자 결정). 상태 정본은 서버와 원격 agent
    브랜치다. 팀장 세션이 죽으면 §7 재기동 절차로 서버에서 복원한다.
14. **`/dflow-dev` 수정은 버전 게이트 없이 즉시 모든 리포에 적용된다.** mes-runlog 등 대상 리포의
    `.claude/skills/*` 는 wbs-web 정본을 가리키는 심링크다(2026-09-10 실측). 그래서 `--worker` 는
    **순수 가산**이어야 한다 — 플래그가 없으면 인자 파싱·Phase 0-가·Phase 0-2·Phase 5·AskUserQuestion
    사용이 지금 문구 그대로 돈다. 플래그가 있을 때만 동작이 갈린다(§5-A). 계약 테스트가 지킨다(계획 Task 1).

## 4. 팀장 절차

명령: `/dflow-team [--team-size N] [--until HH:MM] [--interval SEC] [--model opus|sonnet] [--exclude id8,...]`
- `--team-size` 기본 3. 동시 팀원 슬롯 수.
- `--until` 필수(`/dflow-poll` 과 같은 규칙). 새 배정을 멈추는 시각. 진행 중 팀원은 끝까지 간다.
- `--interval` 은 `poll.sh --interval` 로 전달(기본 300).
- `--model` 은 팀원 프롬프트의 `/dflow-dev --model` 로 전달한다.
- `--exclude` 는 영구 제외 목록의 초기값. 팀장이 진행 중·건너뜀·반려 id8 을 여기에 계속 더한다.

팀장은 현재 세션이며 **대상 리포 루트**(자기 상주 워크트리/체크아웃)에서 실행한다. 팀장이 유지하는
상태는 넷 — 슬롯 표(슬롯, `AGENT_ID`, TSK, id8, 워크트리 경로/터미널 핸들, 시작 시각), 대기 큐(ready
인데 슬롯이 없어 못 준 id8), 제외 목록, 감지된 백엔드. 모두 세션 메모리이며 파일로 쓰지 않는다. 세션이
죽으면 §7 재기동 절차로 서버에서 복원한다.

### 4-0. 환경 감지 (시작 맨 처음)

1. `$TERM_PROGRAM = Orca` 또는 `$ORCA_WORKTREE_ID` 존재 → **Orca 백엔드**.
2. 아니고 `$TMUX` 존재(Orca shim 이 아닌 진짜 tmux) → **tmux 백엔드**. `/team-mode` 로드 여부를
   확인하고, 로드 실패면 dev-plugin 수정 안내(§12) 후 중단한다.
3. 그 외 → **일반 터미널**. "이 환경은 병렬 메인 에이전트를 못 띄운다. `/dflow-poll --until <시각>`
   으로 1건씩 처리하라" 고 안내하고 종료한다.

### 4-1. 시작 (Orca·tmux 공통)

1. **전제 검사** — 하나라도 실패하면 아무것도 띄우지 않고 중단한다.
   - `.env` 존재, `set -a; . ./.env; set +a` 후 `dflow.sh doctor` exit 0. `DFLOW_PATS` 첫 토큰이
     **이 신원의** PAT 여야 한다(`dflow.sh me` 로 이름을 출력해 확인).
   - `git status --porcelain` 이 비어 있다(팀장 체크아웃이 더러우면 승인 스윕이 위험하다).
   - `.claude/skills/dflow-dev`·`dflow-work`·`dflow-poll` 이 cwd 에서 해석된다(심링크 포함).
   - `--until` 이 있고 미래 시각이다.
   - 백엔드별: Orca 면 `orca worktree create --help` 가 `--agent`·`--prompt` 를 지원한다. tmux 면
     `/team-mode` 가 로드돼 있다.
2. **승인 스윕 1회** — §6. 결과(머지됨/대기/반려/건너뜀)를 한 줄씩 보고한다.
3. **감시 시작** — 팀장을 깨우는 신호는 **둘**이며 둘 다 띄운다. 팀장은 절대 포그라운드로 기다리지 않는다.
   - **poll.sh**(새 작업 감지): `poll.sh --require-tag agent --until <HH:MM> --interval <SEC>
     --exclude <제외목록>` 을 Bash `run_in_background` 로 띄운다.
   - **`.result` 감시**(팀원 완료 감지): 진행 중 슬롯이 하나라도 있으면 `Monitor` 를 until-loop 로
     걸어 그 슬롯들의 워크트리 경로에서 `docs/tasks/<TSK>/.result` 파일이 생기는지 감시한다. 팀원은
     별도 프로세스라 완료를 자동으로 알려 오지 않으므로(개정 2판의 서브에이전트 완료 알림이 없다),
     이 감시가 없으면 poll.sh 가 몇 시간 안 끝나는 사이 완료된 슬롯이 보충되지 않는다. 슬롯이 새로
     생기거나 회수될 때마다 감시 대상 경로를 갱신한다.
   - 시작 이벤트를 events.jsonl 에 남긴다(§9-3).

### 4-2. 이벤트 루프

팀장은 아래 이벤트가 올 때만 움직인다. 처리 후 poll.sh 가 종료돼 있으면 3번 명령으로 **다시 띄운다**
(제외 목록에 진행 중 id8 을 포함시켜 같은 작업을 다시 잡지 않게 한다). 모든 처리는 events.jsonl 에
한 줄 남긴다(§9-3).

| 이벤트 | 처리 |
|---|---|
| poll exit 0 (ready N줄) | 순번은 버리고 id8 만 쓴다. 후보별 `dflow.sh show <id8>` 로 `item.spec` 이 비면 제외 목록에 넣는다(사유 보고). 남은 것을 빈 슬롯 수만큼 spawn(§4-3), 나머지는 대기 큐. poll 재시작 |
| poll exit 9 (승인 감지) | 승인 스윕(§6). poll 재시작 |
| poll exit 10 (반려 감지) | 재작업은 기존 agent 브랜치 위에서 이뤄져야 하므로 자동 배정하지 않는다. "수동 `/dflow-dev <id8>` 대상" 으로 보고하고 제외 목록에 넣는다. poll 재시작 |
| poll exit 8 (시한) | 새 배정 중단. 대기 큐를 비우고(보고만) 진행 중 팀원의 `.result` 를 모두 받은 뒤 §4-4 |
| poll exit 2·3·5·6·7 | 중단 사유를 보고하고 진행 중 팀원의 `.result` 만 받은 뒤 §4-4 |
| 팀원 `.result` 도착(§5-보고) | 슬롯 표·집계 갱신, 슬롯 해제. `blocked` 면 §7. 대기 큐가 비어 있지 않으면 즉시 그 슬롯에 spawn. 비어 있으면 poll 이 다음 것을 잡는다 |
| 팀원 무응답 | §7 |

**`.result` 기상·폴링**: 팀원 완료는 `.result` 감시 Monitor(§4-1 3번)가 팀장을 깨워 알린다. 깨어나면
그 슬롯의 `docs/tasks/<TSK>/.result` 한 줄을 파싱한다(위 표의 "`.result` 도착" 행). 보조로 30분 이상
진행 슬롯의 신호가 없으면 `dflow.sh list --scope claimed` 로 서버 상태를 슬롯 표에 갱신한다(팀원은
`list` 를 안 부르므로 캐시 경쟁은 팀장 자신뿐). Orca 에서는 `orca terminal read --screen --terminal
<handle>` 로 팀원 화면을 직접 볼 수도 있으나, 슬롯 회수 판정은 `.result` 파일을 정본으로 한다.

### 4-3. 팀원 spawn (백엔드별)

공통: 슬롯 번호를 정하고 `AGENT_ID = <신원>/w<slot>`(§9-1)을 만든다. `{MAIN_CHECKOUT}` 은 팀장의
상주 체크아웃 절대경로다. **`--prompt` 에는 전체 워커 프롬프트를 넣지 않는다** — 백틱·따옴표·여러 줄이
섞여 쉘 인자에서 깨진다(실측한 자동 제출은 한 줄짜리였다). 대신 짧은 포인터만 넣고, 워커가
`references/worker-prompt.md`(§5) 를 읽어 그 규칙대로 실행한다. 포인터는 치환 변수만 전달한다:
```
.claude/skills/dflow-team/references/worker-prompt.md 의 규칙대로 실행하라.
TSK=<TSK> ID8=<id8> AGENT_ID=<신원>/w<slot> MAIN_CHECKOUT=<팀장 체크아웃 절대경로> MODEL_FLAG=<--model ...|공백>
```

- **Orca**:
  ```
  orca worktree create --name dflow-<id8> --agent claude --no-parent \
    --base-branch <기점> --prompt "<위 포인터 한 문단>" --json
  ```
  `<기점>` 은 agent 브랜치가 결국 머지될 곳인 `origin/main` 으로 명시한다(생략하면 리포 기본 base 로
  가지만, 팀장의 현재 브랜치가 staging 등일 때 의도와 어긋나므로 명시한다). 결과 JSON 의
  `result.worktree.path`(팀원 cwd)와 `result.agentTerminalHandle` 을 슬롯 표에 저장한다. 포인터가
  자동 제출되어 팀원이 즉시 착수한다(§3-5 실측).
- **tmux**: `/team-mode` 의 메커니즘으로 새 pane/window + 워크트리를 만들고 그 pane 에서 claude 에
  워커 프롬프트를 제출한다. 워크트리 경로를 슬롯 표에 저장한다. (구체 명령은 team-mode 로드 후
  그 인터페이스에 맞춰 SKILL.md 에 확정한다 — dev-plugin 수정이 선행.)

같은 작업을 다시 띄우는 일은 없다(수동 재개는 사람 몫, §7). 슬롯 표에 기록한다.

### 4-4. 마감

집계 표(TSK, id8, 브랜치, head, done exit, status, 사유)를 보고한다. 팀원 워크트리를 백엔드별로
정리한다 — Orca 는 `orca worktree rm --worktree "<id>"`, tmux 는 team-mode 정리 + `git worktree remove`.
**agent 브랜치는 남긴다.** 승인은 사람이 D'Flow 웹에서 하고, 승인 뒤 머지는 다음 `/dflow-team` 의
스윕 또는 `/dflow-merge` 가 한다. 종료 이벤트를 events.jsonl 에 남긴다.

## 5. 팀원 계약 (`references/worker-prompt.md`)

팀원은 진짜 메인 에이전트다. 백엔드가 첫 입력으로 자동 제출하는 것은 이 파일 전체가 아니라 짧은
포인터 한 문단(§4-3)이다 — 팀원은 그 문단의 `KEY=VALUE` 로 아래 변수를 받고, 이 파일을 읽어 규칙대로
실행한다. 이렇게 나눈 이유는 쉘 인자 인용 문제를 피하기 위해서다(§4-3).

변수: `{TSK}`, `{ID8}`, `{AGENT_ID}`, `{MAIN_CHECKOUT}`, `{MODEL_FLAG}`(포인터 문단으로 전달).

**격리 확인 (첫 행동)**
```bash
case "$(git rev-parse --show-toplevel)" in
  "{MAIN_CHECKOUT}") echo "NOT_ISOLATED"; exit 1;;
  *) : ;;   # 자기 워크트리여야 한다
esac
```
자기 cwd 가 팀장의 상주 체크아웃과 같으면(격리 실패) 아무것도 하지 않고 `.result` 에
`{TSK} {ID8} - - - failed not-isolated` 를 쓰고 끝낸다.

**워크트리 부트스트랩** — `.env` 는 gitignore 라 새 워크트리에 없다. 메인 체크아웃에서 심링크한다.
`.claude/skills` 는 커밋된 리포(wbs-web)면 이미 있고, 대상 리포가 심링크 배포면 그대로 따라온다.
```bash
[ -e .env ] || ln -s {MAIN_CHECKOUT}/.env .env
set -a; . ./.env; set +a; .claude/skills/dflow-work/scripts/dflow.sh doctor
```
dflow.sh 를 부를 때마다 `set -a; . ./.env; set +a` 를 앞에 붙인다(env 는 Bash 호출 사이에 남지 않는다).

**좌석 식별 (부트스트랩 직후, claim 전)**: `docs/tasks/{TSK}/.agent` 에 `{AGENT_ID}` 한 줄을 쓴다(§9-1).
이 파일은 커밋하지 않는다.

**실행**: Skill 도구로 `/dflow-dev {ID8} --worker {MODEL_FLAG}` 를 실행한다. 참조는 id8 만 쓴다. 순번 금지.

**서버 쓰기 범위**: `{ID8}` 외의 어떤 주문에도 claim·progress·release·done 을 하지 않는다.
`list` 는 호출하지 않는다. 필요한 조회는 `show {ID8}` 뿐이다.

**판단 규칙(자동 모드)**: `--worker` 이므로 AskUserQuestion 을 쓰지 않는다. 명백한 기본값이 있으면
그것을 택하고 결정 내용을 design.md 또는 커밋 메시지에 한 줄 남긴 뒤 진행한다. 기본값이 없어 담당자
결정이 꼭 필요할 때만 멈춘다 — 그때는 **현재 산출물을 커밋·push 한 뒤** `.result` 에 `blocked`(질문과
선택지를 사유 자리에)를 쓰고, 그 질문을 화면에 출력한 채로 그 세션을 멈춘다. 팀원 탭은 열려 있으므로
사람이 그 탭에서 답하거나 수동 `/dflow-dev {ID8}` 로 이어받는다(§7).

**보고(`.result` 파일 계약)**: 작업을 끝내거나 멈출 때 `docs/tasks/{TSK}/.result` 에 아래 한 줄을 쓴다.
팀장은 이 파일만 파싱한다.
```
{TSK} {ID8} <branch|-> <head_sha|-> <done_exit|-> <status> <한 줄 사유 또는 질문>
```
`status` ∈ `done` / `skipped`(claim exit 4·spec 부재·착수 불가) / `needs-merge` / `blocked` / `failed`.
`.result` 는 커밋하지 않는다. 마지막 응답에도 같은 줄을 출력한다(Orca `terminal read` 폴백·좌석표용).

## 5-A. `/dflow-dev --worker` 계약 (기존 스킬 순수 가산 수정)

`--worker` 는 "이 세션은 자동 실행되는 팀원이며, 기본 브랜치를 잡고 있는 상위 체크아웃이 따로 있다"
는 뜻이다. 플래그가 있을 때만 아래가 갈리고, **없으면 지금 문구 그대로**다(§3-14 불변성).

| # | 위치(현행) | 기본(플래그 없음) | `--worker` |
|---|---|---|---|
| A | Phase 0-가 승인 스윕(SKILL.md 54~82) | claim 앞에서 매번 스윕 실행 | **건너뛴다.** 스윕은 팀장 몫이다. 이유를 한 줄 남긴다 |
| B | Phase 0-2 선행이 approved 인데 main 미반영 → "지금 직접 머지"(119~121) | 직접 머지 | **머지하지 않는다.** 기점을 그 `head_sha` 로 잡아 스택 브랜치를 만들고 state.json 에 `branch_base` 와 `risk: "선행 main 미반영(팀장 머지 대기)"` 기록 후 진행 |
| C | Phase 0 재개 판정 approved 갈래(88) | 지금 즉시 머지 후 종료 | **머지하지 않고** `.result` 를 `{TSK} {ID8} <branch> <head_sha> - needs-merge approved` 로 쓰고 종료 |
| D | 사람 판단이 필요한 분기(AskUserQuestion·`--only` 확인) | AskUserQuestion 등 그대로 사용 | **AskUserQuestion 을 쓰지 않는다.** 기본값이 있으면 택해 한 줄 남기고 진행, 없으면 `blocked`(§5 판단 규칙). `--only` 확인은 팀장이 `--only` 를 넘기지 않으므로 워커 경로에 없다 |

- 이 넷 말고 **기본 브랜치를 switch/pull/merge/push 하는 지점은 없다.** agent 브랜치를 만들고
  (`git switch -c agent/...`) 그 위에 push 하는 Phase 5 는 워커에서도 그대로 필요하므로 유지한다.
- **새로 만드는 "사람에게 묻기" 지점은 없다.** dflow-dev 의 판단 실패는 이미 전부 "중단·보고"
  (push 훅 거부, Verify 재시도 소진, 빨간 기준선)라 워커에선 `.result` 의 `failed <사유>` 로 떨어진다.
  설계 재량 분기만 판단 규칙(`blocked`)이 받는다.
- **인자 파싱과 위 네 분기만 손댄다.** 게이트·Phase 정의·커밋 규칙·모델 배정(dev-discipline.md)은
  건드리지 않는다.
- 계약 테스트(계획 Task 1)가 "`--worker` 문자열이 SKILL.md 에 있다" 와 "플래그 없는 Phase 0-가·
  AskUserQuestion 서술이 그대로다" 를 함께 단언해 가산성을 지킨다.

## 6. 승인 스윕 (팀장, `/dflow-merge` 원격 후보 식별)

`/dflow-merge` 를 후보 식별에서 순수 가산으로 넓힌다(§6-A). 팀장은 인자 없이 `/dflow-merge` 를
실행하며, 판정·순서·머지·뒷정리는 종전과 같다.

- **후보 식별(넓힘)**: 로컬 `docs/tasks/*/state.json` 의 `reported` 에 더해, `git fetch origin` 후
  `git branch -r --list 'origin/agent/*'` 각 tip 의 `git show origin/<branch>:docs/tasks/<TSK>/state.json`
  을 후보로 본다. 팀원 워크트리에서 마감한 작업은 `reported` 갱신이 팀장 체크아웃에 없을 수 있고,
  다른 PC·다른 신원의 브랜치도 이 팀장이 머지할 수 있어야 하기 때문이다. 브랜치 tip 의 phase 는
  신뢰하지 않고 판정은 서버 `show` 로만 한다.
- **판정·순서·머지·뒷정리(불변)**: `status=approved` 만, 반려는 대기와 갈라 집계, 조상 먼저,
  `--no-ff`, 훅 거부 시 우회 금지, `phase=merged` 커밋, 머지된 agent 브랜치 삭제.
- **다중 경합**: 두 팀장의 스윕이 같은 브랜치를 머지하려 하면 나중 쪽 `git push` 가
  non-fast-forward 로 거부된다 — `git pull --ff-only` 후 후보를 다시 식별한다(이미 머지된 것은 빠진다).

### 6-A. `/dflow-merge` 순수 가산 수정

- **인자 없는 기존 동작 불변**: 로컬 `phase=reported` 후보 식별은 그대로 둔다.
- **원격 후보를 더한다**: 위 원격 브랜치 스캔을 후보 집합에 합집합으로 추가. 중복(로컬·원격이 같은
  TSK)은 order UUID 로 dedup 한다.
- 판정·순서·머지·뒷정리 로직은 한 줄도 바꾸지 않는다. 계약 테스트가 "원격 스캔 문구가 있다" 와
  "approved 만 머지·조상 먼저 서술이 그대로다" 를 함께 단언한다.

## 7. 실패·질문·재기동

| 상황 | 팀원 | 팀장 |
|---|---|---|
| claim exit 4(선점·선행 미충족) | `.result` 에 `skipped`, 종료 | 집계, 제외 목록 추가 |
| spec 부재 | exit 0 처리에서 걸러짐. 새어 오면 `skipped` | 집계, 제외 목록 추가 |
| `blocked`(담당자 결정 필요) | 커밋·push, 질문을 화면에 출력, `.result` 에 `blocked` 쓰고 그 세션에서 멈춤(탭 유지) | AskUserQuestion 을 쓰지 않는다(자동 루프). "결정 필요: <질문> — 그 팀원 탭에서 답하라" 고 알린다. **그 슬롯은 blocked 팀원이 계속 잡는다 — 다른 작업에 재배정하지 않는다.** 재배정하면 살아 있는 프로세스 둘이 같은 `AGENT_ID`(§9-1, 슬롯에 붙음)로 heartbeat 를 보내 좌석표가 한 인물을 두 책상에 그리고 손 든 상태가 새 active 에 덮인다. 사람이 그 탭에서 답을 주면 팀원이 같은 워크트리·브랜치에서 이어 간다(재spawn·재claim 없음). 그동안 가용 슬롯은 하나 줄어든다 |
| `needs-merge` | `.result` 쓰고 종료 | 승인 스윕(§6) 즉시 실행 |
| `failed`(push 훅 거부·게이트 실패 등) | dflow-dev 규칙대로 중단, `.result` 에 `failed` | 집계, 제외 목록 추가, 사유 보고. 자동 재시도 없음 |
| 팀원 무응답(2시간 이상 신호 없음) | — | `show <id8>`: claimed 면 워크트리를 정리(Orca `worktree rm`)하고 "재개 필요" 로 보고. 다음 수동 `/dflow-dev <id8>` 이 브랜치 재개 규칙으로 이어받음 |
| 팀장 세션 소실 | 각 팀원은 자기 탭에서 계속 돌 수 있다(별도 프로세스) | 재기동 시 `dflow.sh list --scope claimed` 와 `git branch -r --list 'origin/agent/*'`, 살아 있는 팀원 탭(Orca `worktree list`)을 대조한다. claimed 인데 팀원 탭도 없는 id8 은 "재개 필요" 로 보고하고 제외 목록에 넣는다(자동 재착수 없음). 그 뒤 §4-1 로 정상 시작 |

> **개정 3판의 blocked 모델(확정)** — blocked 팀원은 세션을 멈추고 **그 슬롯을 계속 잡은 채** 사람이
> 그 탭에서 답할 때까지 기다린다. 답을 주면 같은 워크트리·브랜치에서 이어 간다(재spawn·재claim 없음).
> 이는 취향이 아니라 정합성 문제다 — 슬롯을 재배정하면 살아 있는 프로세스 둘이 같은 `AGENT_ID` 로
> heartbeat 를 보내 좌석표가 깨진다(위 표 참고). 좌석표의 "책상에 손 든 채 남아 있음"(§9-4)과 §1 의
> "판단이 필요한 작업만 멈추고 나머지는 계속 간다"(멈추는 것은 그 슬롯 하나뿐)가 모두 이쪽을 가리킨다.
> 비용은 blocked 동안 실효 병렬도가 그만큼 준다는 것이다(§1·§12).

동시에 도는 작업은 poll.sh 가 ready 로 걸러 준 독립 작업이라 서로 스택하지 않는다. 미승인 선행 위
스택은 `/dflow-dev` 기존 규칙(선행 산출물 실재 확인 후 스택 + risk 기록)대로 각 팀원이 한다.

## 8. 다중 신원·다중 PC 운영

- **분할 키는 D'Flow 배정이다.** `poll.sh` 는 `list --scope assigned`(내게 배정된 작업)만 본다.
  신원마다 그 담당자의 PAT 를 `.env` `DFLOW_PATS` 첫 토큰으로 두면 각 팀장은 자기 배정분만 잡는다.
- **한 PC 에 여러 신원**: 각 신원이 자기 `.env`(자기 PAT)로 팀장을 띄운다. 서버 claim 이 잠금이라
  겹치지 않고, 좌석표는 `AGENT_ID = <신원>/w<slot>` 으로 구역을 나눈다.
- **같은 신원이 두 곳에서 띄워도** 서버 claim 이 잠금이다. 늦은 쪽은 exit 4 로 `skipped`.
- **로컬 상태를 공유하지 않는다.** 슬롯 표·대기 큐·제외 목록·`~/.cache/dflow`·`~/.dflow/events.jsonl`·
  팀원 워크트리는 로컬이다. 공유되는 것은 서버 상태와 원격 `agent/*` 브랜치뿐이며, 승인 스윕이 원격
  기준으로 후보를 보는 이유가 이것이다(§6).
- **준비물**: 대상 리포 클론, `.env`(해당 담당자 PAT·`DFLOW_API_BASE`·`DFLOW_PROJECT_MAP`),
  `.claude/skills/dflow-*` 설치(dflow-kit), 대화형 세션, 백엔드(Orca 또는 진짜 tmux+수정된 dev-plugin).
  이 목록은 SKILL.md 의 전제 검사와 일치해야 한다.

## 9. 가상 오피스(좌석표) 연동 계약

좌석표의 모델은 층=프로젝트, 구역=WP, 책상=작업 주문, 의자의 사람=그 주문을 잡은 에이전트다. 팀
스킬은 "사람이 책상을 옮겨 다니는" 모습이 되어야 하므로 아래를 계약으로 둔다. 서버·화면 쪽 구현은
좌석표 설계가 맡고, 이 절은 팀 스킬이 **무엇을 어디에 남기는지**만 정한다.

### 9-1. 팀원 식별자 `AGENT_ID`

- 형식: `<신원>/w<slot>` (예: `hong/w2`). `<신원>` 은 `dflow.sh me` 가 돌려주는 담당자 식별을
  안전한 슬러그로 바꾼 값이다. **작업이 아니라 슬롯에 붙는다.** 같은 슬롯이 다음 작업을 받으면 같은
  식별자로 다음 책상에 앉는다. 좌석표는 이 문자열의 해시로 캐릭터(머리·셔츠)를 정하므로 슬롯마다
  일관된 인물이 된다. 신원이 PC 당 하나가 아니므로 hostname 이 아니라 신원을 앞에 둔다(§3-4).
- 팀장 자신은 `<신원>/lead`.
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
| Phase 진행 | 훅 heartbeat(60초 절제) + dflow-dev 의 progress 25/60/85 | dflow-dev·훅이 기록 |
| `blocked` 직전 | `dflow.sh heartbeat <id8> --phase blocked --note "<질문>"` 1회 | `event: blocked`, `note` |
| 완료·실패 | `done`/`failed` 보고(기존) + `.result` 파일 | `event: result`, `status` |

`blocked` 는 좌석표 상태 모델(active/stale/wait/rejected/ready/done/offline)에 없는 상태다. 팀원이
멈춰 대기하면 heartbeat 도 멈추므로, 마지막 `heartbeat_phase = blocked` 가 유지되어야 "손 든 사람"
으로 남는다. **좌석표에 `blocked`(담당자 결정 대기) 상태를 추가해 달라는 요청 사항이다.** 사람이
답을 주어 팀원이 다음 heartbeat 를 보내면 active 로 돌아간다.

### 9-3. 팀장이 남기는 신호

- `~/.dflow/events.jsonl` 에 좌석표 §5-2 와 같은 스키마 `{ts, host, repo, tsk, order, phase, event, agent}`
  로 append 한다. `agent` 는 `<신원>/lead`. 이벤트: `team.start`(slots, until), `team.spawn`(slot,
  tsk, order), `team.result`(status), `team.blocked`(tsk), `team.sweep`(merged, waiting, rejected),
  `team.stop`. 기록은 `printf '%s\n' '<json>' >> ~/.dflow/events.jsonl` 한 줄이며 실패해도 진행을
  막지 않는다.
- 좌석표의 STANDBY(감시 중) 표시는 poll.sh 존재를 서버에 알리는 계약이 아직 없다(좌석표 §7 미결).
  그 계약이 생기면 팀장이 4-1 시작·4-2 매 poll 재시작·4-4 종료 시점에 `{host, agent: lead, slots,
  busy, until}` 을 보내는 자리를 SKILL.md 에 표시해 둔다. 계약 전에는 events.jsonl 의 `team.start`
  /`team.stop` 이 대체 근거다.

### 9-4. 좌석표에서 기대하는 모습

- 배정 순간 빈 책상(ready)에 슬롯 캐릭터가 앉아 active 가 된다.
- 완료하면 그 책상은 승인 대기(wait)로 바뀌고 캐릭터는 다음 책상으로 옮겨 간다.
- `blocked` 면 캐릭터가 손을 든 채 책상에 남아 있고 "확인 필요" 띠에 질문이 뜬다.
- 팀장은 층 헤더의 감시 표시(STANDBY)로 나타난다. 다른 신원의 팀장은 `<신원>` 이 다른 별개 표시다.

## 10. 파일 구성

```
.claude/skills/dflow-team/
├── SKILL.md                    # §4 절차. frontmatter 트리거: "/dflow-team", "팀으로 개발", "팀장 시작", "N건 동시 착수"
└── references/
    ├── worker-prompt.md        # §5 팀원 프롬프트 정본(치환 변수 포함)
    ├── backends.md             # §3-5·§4-3 백엔드별(Orca·tmux) spawn·정리 명령 정본
    └── events.md               # §9-3 events.jsonl 이벤트 이름·필드 표(좌석표 설계 §5-2 와 동일 스키마)
```
스크립트는 새로 두지 않는다. `poll.sh`·`dflow.sh`·`orca` CLI·`/team-mode` 를 재사용한다. 배포는
dflow-kit 의 기존 `kit-build.sh` 대상 목록에 `dflow-team` 을 추가한다(별도 커밋).

## 11. 검증 (리허설)

스킬 문서는 vitest 대상이 아니다. 스테이징 D'Flow 를 향한 mes-base 리허설로 검증한다. 1차는 Orca
백엔드(자동 제출·워크트리 격리가 실측된 경로)로 한다.

- 준비: mes-base 에 `agent` 태그가 붙은 독립 ready 작업 3건(그중 1건은 spec 에 담당자 결정이 필요한
  분기를 일부러 남긴다), `.env` 는 스테이징.
- 실행(Orca): `/dflow-team --team-size 2 --until <2시간 뒤>`.
- 합격 기준:
  1. 첫 poll 에서 2건이 각자 `orca worktree create --agent claude` 로 spawn 되고 3번째는 대기 큐에
     들어갔다가, 먼저 끝난 슬롯에 자동 배정된다.
  2. 각 팀원이 자기 워크트리에서 `agent/<id8>-<slug>` 브랜치를 만들고 push 했다.
  3. 팀장의 상주 체크아웃의 현재 브랜치와 작업트리가 실행 전후로 같다.
  4. 서버에 `done` 이 각자 id8 로 기록됐고(`show`) 다른 주문은 건드리지 않았다.
  5. 결정 분기 작업이 `blocked` 로 그 팀원 탭에서 멈추고, 그 탭에서 사람이 답을 주면 같은 워크트리·
     브랜치에서 이어 가 `done` 했다.
  6. 마감 뒤 팀원 워크트리는 `orca worktree rm` 으로 정리됐고 agent 브랜치 3개는 남아 있다. 특히
     워크트리가 `agent/<id8>-<slug>` 로 switch 된 상태에서 `orca worktree rm` 이 깨끗이 도는지
     확인한다(§3-5 프로브는 브랜치를 바꾸지 않았으므로 이 조합은 리허설에서 처음 검증된다).
  7. 이어서 `/dflow-team` 을 다시 돌리면 승인 스윕이 원격 브랜치 3개를 후보로 잡는다(승인 전이면 "대기").
  8. `~/.dflow/events.jsonl` 에 `team.start` → `team.spawn`×2 → `team.result` → `team.spawn`(3번째)
     → `team.blocked` → … → `team.stop` 순서가 남고, 각 워크트리의 `docs/tasks/<TSK>/.agent` 가
     슬롯 식별자(`<신원>/w1`, `<신원>/w2`)였다. 3번째 작업의 `.agent` 는 먼저 빈 슬롯의 값과 같다.
  9. 각 팀원 워크트리에 `docs/tasks/<TSK>/.result` 한 줄이 남고 status 가 서버·브랜치 상태와 맞는다.
- 좌석표 화면 확인(S1·S2 이후): 슬롯 캐릭터가 책상을 옮겨 가는 것, `blocked` 가 손 든 상태로 보이는 것.
- 다중 신원은 같은 PC 에서 세션 두 개를 같은 PAT 로 띄워 exit 4 분기만 확인한다(2차 리허설에서 실제
  두 신원·두 PC). tmux 백엔드는 dev-plugin 수정 후 별도 리허설로 확인한다.
- 실패 시: 팀원 transcript(Orca `terminal read`)와 `dflow.sh show` 로 원인 확정 후 프롬프트를 고친다.
  서버 쓰기 오류가 있으면 스테이징에서 주문을 release 해 되돌린다.

## 12. 잔여 위험

- **캐시 공유**: 팀원의 `show` 가 id8 을 접두 해석하는 순간 팀장의 `list` 가 `last-list.json` 을 덮을
  수 있다. `known-ids.txt` 누적 맵이 폴백이고 팀원은 `list` 를 부르지 않으며 팀장도 보조 신호에서만
  부른다. 접두 해석이 실패하면 팀원은 `failed` 로 끝나고 사람이 재개한다. poll.sh 출력에 전체 UUID 를
  추가하면 근본 해결이지만 기존 스킬 무수정 원칙에 따라 이번엔 보류한다.
- **`/dflow-dev` 수정이 심링크로 모든 리포에 즉시 적용된다**(§3-14). 방어선은 **순수 가산성** 하나뿐
  이다 — 플래그 없는 경로가 한 줄도 안 바뀌어야 하고, 계약 테스트(Task 1)가 지킨다. 워커가 옛
  버전(플래그 미인식)을 만나면 스윕이 기본 브랜치 `git switch` 로 죽지 않도록, 팀원 프롬프트가
  `/dflow-dev` 의 `--worker` 지원을 먼저 확인하고 못 받으면 `.result` 에 `failed no-worker-flag` 로
  끝낸다.
- **tmux 백엔드는 dev-plugin 수정에 걸려 있다.** `hooks/hooks.json` 이 `PreToolUse`/`PostToolUse` 를
  최상위에 두어 플러그인이 "failed to load" 다. `{"hooks": {...}}` 로 감싸고 버전 올려 `/plugin update`
  해야 `/team-mode` 가 뜬다. 그때까지 tmux 백엔드는 검증되지 않으며 `/dflow-team` 은 tmux 에서
  안내 후 중단한다(§4-0).
- **Orca 워크트리 누수**: 팀원이 커밋 전에 죽으면 변경 있는 워크트리가 남는다. 마감·재기동 때
  `orca worktree list` 로 확인하고 `orca worktree rm` 한다(미커밋분은 잃는다 — 커밋 후 `blocked`
  규칙이 이를 최소화한다).
- **좌석표 의존**: `.agent` 규칙과 `blocked` 상태는 좌석표 S1·S2 가 받아 줘야 화면에 나온다. 받기
  전까지 팀 스킬은 events.jsonl·`.result` 로만 검증되며, 화면에는 팀원이 Phase 서브에이전트 이름으로
  보인다.
- **토큰 비용**: 슬롯 N개 × 각자 독립 메인 에이전트 + 그 내부의 Phase 서브에이전트. 별도 프로세스라
  개정 2판(서브에이전트 팀원)보다 무겁다. `--team-size` 기본 3 을 넘길 때는 사용자가 명시한다.
- **blocked 가 슬롯을 잡는 비용**: blocked 팀원은 답을 받을 때까지 슬롯을 점유하므로 그만큼 실효
  병렬도가 준다(팀원 3에 blocked 2면 실효 1). AGENT_ID 정합성(§9-1)을 지키기 위한 불가피한 대가이며,
  담당자가 자리를 비운 시간대에는 blocked 가 쌓여 루프가 사실상 멈출 수 있다 — 그때는 사람이 돌아와
  탭들을 처리해야 한다.
