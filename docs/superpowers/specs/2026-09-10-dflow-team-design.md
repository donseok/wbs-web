# /dflow-team 팀장 스킬 설계

D'Flow 에서 내게 배정되고 에이전트 위임(`tags:agent`)된 ready 작업을 상시 감시하다가, 발견되는 대로
팀원에게 나눠 주어 동시에 개발시키는 팀장 스킬이다. 팀원은 **자기 서브에이전트를 띄울 수 있는 독립
세션**이며, 각자 자기 워크트리에서 작업 한 건을 맡아 `/dflow-dev` 를 돌린다. 팀원은 끝나면 WBS 처리
(`done --auto-links`)와 보고를 하고, 그 슬롯에 다음 작업이 들어간다. 담당자마다 자기 PC 에서 띄우면
각자의 배정분이 병렬로 진행된다. 진행 중인 팀원과 작업은 D'Flow 에이전트 좌석표(가상 오피스)에
그대로 나타나야 한다.

상태: 설계 확정. 구현 착수는 별도 지시를 기다린다.
구현계획: `docs/superpowers/plans/2026-09-10-dflow-team.md`

> **제1 제약: 팀원은 자기 서브에이전트를 띄울 수 있어야 한다.** 팀원은 `/dflow-dev` 를 실행하고,
> `/dflow-dev` 는 Phase 1~4(설계·구현·검증·리팩터)를 서브에이전트로 쪼갠다(dev-discipline.md).
> 단순 서브에이전트는 다시 서브에이전트를 띄우지 못하므로, 팀원을 단순 서브에이전트로 부르면 그 안에서
> `/dflow-dev` 가 깨진다. 이 조건을 만족하는 형태는 둘이다. 하나는 pane 의 별도 프로세스(Orca)이고,
> 다른 하나는 `name` 과 `isolation: "worktree"` 를 준 에이전트 팀 팀원이다(§3-1).

---

## 1. 목표와 비목표

**목표**
- `/dflow-poll` 이 한 번에 1건만 착수하던 것을 슬롯 N개 동시 착수와 상시 보충으로 넓힌다. `poll.sh` 는
  exit 0 에서 ready 작업을 여러 줄 내보내므로 팬아웃 재료는 이미 있다.
- 팀원은 완료 시 WBS 처리와 보고를 하고, 팀장은 그 슬롯에 다음 작업을 배정한다.
- 여러 담당자(신원)가 각자 PC 에서, 또는 한 PC 에 여러 신원이 각자 띄워도 서로의 작업을 건드리지
  않는다(§8).
- Orca·tmux·일반 터미널 어디서나 병렬로 동작한다. Orca 는 pane 백엔드를, 그 밖은 에이전트 팀
  백엔드를 쓴다(§4-3). 어느 환경에서도 "병렬 포기" 분기는 없다.
- 팀원·팀장의 활동이 좌석표 설계(`2026-09-10-agent-seatmap-monitoring-design.md`)의 데이터 경로에
  실린다. 이 문서는 연동 계약만 정하고, heartbeat API·화면 구현은 좌석표 설계의 S1·S2 가 한다.
- 기존 스킬은 필요하면 원문도 고친다. 조건은 수동(`--worker` 없는) 동작이 퇴행하지 않는 것이다(§6-1).

**비목표**
- 좌석표 화면·heartbeat 서버 경로 자체의 구현(좌석표 설계 S1·S2·S4).
- `/dflow-poll` 수정. 팀장은 `poll.sh` 를 지금 인터페이스(`--require-tag`·`--until`·`--exclude`·
  `--exclude-temp`) 그대로 재사용하고, 상시 보충은 팀장 이벤트 루프가 한다. 고칠 필요가 없으므로
  손대지 않는다.
- 백엔드별로 다른 워커 경로. 워커 프롬프트·`.result` 계약·`/dflow-dev --worker` 는 두 백엔드가 같은
  것을 쓴다. 백엔드가 가르는 것은 spawn·기상 신호·`blocked` 이후 동작·정리뿐이다
  (`references/backends.md` 의 차이표).
- `--backend` 수동 선택. 백엔드는 §4-3 자동 감지로만 정한다.
- tmux pane 백엔드. v1 은 tmux 에서도 에이전트 팀 백엔드를 쓴다(§3-5).
- `poll.sh` 출력에 전체 UUID 추가. 팀원이 `list` 를 부르지 않고 `known-ids.txt` 폴백이 있어 잔여
  위험이 얇다(§12).
- 팀원별 PAT 분리. 한 신원(PAT)이 자기 배정분을 슬롯 N개로 처리하며, 서버 claim 이 잠금이다(§8).
- 완전 무인 실행. 담당자가 자리에 있는 시간대의 supervised 루프다. 상주 세션을 슬롯 N개로 늘린
  구조라서 세션이 죽으면 재시작할 주체가 없기 때문이다. 담당자가 자리를 비우면 판단이 필요한 작업만
  멈추고 나머지는 계속 간다.

## 2. 결정 요약

| 항목 | 결정 | 이유 |
|---|---|---|
| 팀원 정체 | 자기 서브에이전트를 띄울 수 있는 독립 세션. pane 의 별도 프로세스(Orca) 또는 에이전트 팀 팀원(`name` + `isolation: "worktree"`) | `/dflow-dev` 가 Phase 를 서브에이전트로 쪼갠다(머리말의 제1 제약) |
| 백엔드 | 자동 감지만 한다. Orca 면 pane(`orca worktree create --agent claude --prompt`), 그 밖(tmux 포함)은 에이전트 팀이다. `--backend` 플래그는 없다 | 환경만으로 정해지는 선택을 사람에게 넘기지 않는다 |
| pane 을 선호하는 이유 | 팀원 화면이 사람에게 보이고, `blocked` 질문에 그 탭에서 사람이 직접 답하며, 팀장 세션이 죽어도 팀원이 살아남는다 | 에이전트 팀은 이 셋을 잃는 대신 어느 환경에서나 뜬다 |
| 워크트리 | 팀장(신원)당 상주 체크아웃 1개와 팀원마다 임시 워크트리 1개를 쓴다 | 한 워크트리에는 HEAD·인덱스가 하나라서, 병렬 `/dflow-dev` 가 공유하면 서로를 훼손한다 |
| 신원 | PC 당 하나가 아니다. 좌석표 식별은 `AGENT_ID = <신원>/w<slot>` 으로 한다(§9-1) | 공용 개발 PC 에 여러 신원·여러 팀장이 있을 수 있다 |
| 보고 | 팀장→팀원 메시지 채널을 두지 않는다. 팀원은 자기 워크트리에 `docs/tasks/<TSK>/.result` 한 줄을 쓰고, 팀장은 그 파일과 서버를 읽는다 | 백엔드와 무관한 계약 하나로 완료·질문·중단을 나른다 |
| 질문 | 팀장이 붙이는 `--worker` 면 AskUserQuestion 을 쓰지 않고, 사람이 직접 호출한 `/dflow-dev` 는 지금처럼 쓴다 | 자동 루프에서 명백한 기본값이 있으면 묻지 않는다([[no-questions-in-auto-loops]]) |
| 기존 스킬 수정 | 필요하면 원문도 고친다. 조건은 수동 동작 비퇴행이다. `/dflow-dev` 는 Phase 0-2·Phase 5 원문과 `--worker` 블록을, `/dflow-merge` 는 후보 식별·보고·뒷정리를 고친다. `/dflow-poll` 은 고치지 않는다(§6) | 스킬은 심링크로 모든 리포에 즉시 적용되므로 수동 회귀가 곧 운영 사고다. 반대로 가산만 고집하면 수동 경로에도 있는 결함을 워커용 우회로 덮게 된다 |
| `--worker` 노출 | 플래그는 두되 사람용 사용법 줄(description)에 넣지 않는다. `.dflow-agent` 로 워커 모드를 자동 감지하지 않는다 | 남은 워크트리에서 사람의 질문이 조용히 꺼지는 사고를 막는다 |
| 명령 형태 | `/dflow-team [인원] <종료시각> [모델]` 을 자연어로 해석한다(§4-1) | 사람이 실제로 바꾸는 값은 셋뿐이다 |
| 인원 | 기본 3, 하드 상한 4 | 슬롯마다 독립 메인 에이전트가 떠서 비용과 사용량 한도 소모가 빠르게 는다 |
| 팀장 상태 | 메모리는 캐시다. 매 기상마다 워크트리·`.result`·events.jsonl 에서 재구성한다(§4-2) | 몇 시간 도는 세션은 컨텍스트 압축으로 슬롯 정보를 잃는다 |
| git 호출 | 워커와 그 Phase 서브에이전트는 두 백엔드 모두 `command -v git` 이 돌려주는 절대경로로 git 을 부른다. rtk 훅은 고치지 않는다 | 에이전트 팀에서는 rtk 가 재작성한 git 이 격리 가드에 막힌다(§3-6). 백엔드별 분기를 없앤다 |
| 권한 모드 | 에이전트 팀 팀원은 팀장 세션의 권한 모드를 물려받는다는 전제로 준비한다(§8) | 앞에 사람이 없는 팀원이 권한 확인에 걸리면 알림 없이 멈춘다 |
| `blocked` 통지 | 팀장은 `blocked` 를 받으면 PushNotification 도구가 있을 때 한 번 알린다. 없으면 화면 통지만 한다 | 사람이 터미널을 보고 있지 않을 수 있다 |
| 정본 위치 | `wbs-web/.claude/skills/dflow-team/`. 다른 dflow-* 와 같이 dflow-kit 으로 배포한다 | 기존 배포 경로를 그대로 쓴다 |
| 관제 | 작업 중인 팀원·작업이 좌석표(가상 오피스)에 나타나야 한다(§9) | 여러 팀원이 동시에 돌 때 사람이 한눈에 봐야 한다 |

## 3. 전제 사실

실측과 원본 코드에서 확인한 사실이다. 결정의 근거이므로, 바뀌면 그에 기댄 결정을 다시 본다.

1. **`isolation: "worktree"` 는 팀원의 고정 cwd 를 전용 링크드 워크트리로 준다.** Bash 호출마다 cwd 가
   세션 고정 cwd 로 리셋되지만, 그 고정 cwd 자체가 팀원 워크트리라서 팀원은 항상 자기 워크트리에 있다.
   팀원 둘을 동시에 띄운 실측 결과는 다음과 같다.

   | 확인 항목 | 팀원 1 | 팀원 2 |
   |---|---|---|
   | 자기 워크트리 | `.claude/worktrees/agent-af3ca30a…` | `.claude/worktrees/agent-a5a6cb90…`(서로 다름) |
   | cwd 가 별개 Bash 호출 2회에서 유지 | 유지됨 | 유지됨 |
   | `git-dir` ≠ `git-common-dir`(진짜 링크드 워크트리) | 예 | 예 |
   | `git switch -c agent/probe-N` | 성공 | 성공(`already checked out` 없음) |
   | 격리 상태에서 손자 서브에이전트 | 성공 | 성공 |
   | 팀장 체크아웃 영향 | 브랜치 유지, 워킹트리 깨끗 | 동일 |

   `isolation` 을 주지 않은 에이전트는 팀장의 cwd 를 그대로 상속한다.
2. **pane 팀원과 에이전트 팀 팀원은 모두 AskUserQuestion·Skill·Bash·Agent 를 갖는다.** 팀원 안의 Phase
   분할은 `/dflow-dev` 가 이미 서브에이전트로 한다.
3. **`git worktree add` 는 리포를 복제하지 않는다.** `.git` 오브젝트 저장소를 공유하고 작업 디렉터리와
   HEAD 만 따로 두므로 가볍다. 또한 git 은 다른 워크트리가 체크아웃한 브랜치를 삭제하거나 그 브랜치로
   switch 하는 것을 거부한다.
4. **서버 라벨과 캐시는 머신 단위다.** dflow.sh 의 에이전트 라벨은 `claude-<hostname>` 고정이라
   (`dflow.sh` 227행) 같은 PC 의 팀원을 서버가 구분하지 못한다. `~/.cache/dflow/last-list.json` 과
   `known-ids.txt` 도 같은 머신의 모든 프로세스가 공유한다. 그래서 좌석표 식별은 라벨이 아니라 §9-1 의
   `AGENT_ID` 로 하고, 신원은 `dflow.sh me` 가 돌려주는 담당자 식별로 잡는다.
5. **백엔드별 동작.**
   - Orca: `orca worktree create --name <n> --agent claude --prompt "<한 줄>" --json` 은 새 워크트리를
     만들고 그 안에서 claude 메인 에이전트를 띄우며, 프롬프트를 첫 입력으로 자동 제출한다. 팀원은 그
     워크트리를 cwd 로 삼고 권한 확인 생략 모드(`--dangerously-skip-permissions`)로 뜬다. 결과 JSON 의
     `result.worktree.path` 와 `result.agentTerminalHandle` 은 확인됐다. 정리 명령
     `orca worktree rm --worktree "<id>"` 는 워크트리·브랜치·디렉터리를 지운다. 워크트리 id 가 결과
     JSON 의 어느 경로에 있는지는 아직 확인하지 않았다(§11-4 확인 항목).
   - Orca 의 tmux shim: Orca 는 PATH 앞에 tmux shim 을 끼워 `display-message`·`list-panes -F`·
     `capture-pane` 등을 거부한다. 그래서 Orca 에서는 tmux 경로를 쓸 수 없다.
   - tmux: pane 을 다룰 후보인 dev-plugin 의 `/team-mode` 는 플러그인이 `hooks/hooks.json` 로드 실패로
     뜨지 않는다. 그래서 v1 은 tmux pane 백엔드를 지원하지 않는다.
   - 에이전트 팀: Agent 도구에 `isolation: "worktree"` 를 주면 팀원이 대상 리포 안 `.claude/worktrees/`
     에 생긴 전용 워크트리에서 돈다. 이 파라미터가 없으면 팀원이 팀장 체크아웃에서 `git switch -c` 를
     쳐서 서로를 덮어쓰며, 이 실패는 조용하다. 워크트리는 팀원이 변경 없이 끝나면 자동 정리되고,
     변경이나 미추적 파일이 남으면 보존될 수 있다. `--base-branch` 에 해당하는 인자가 없어서 워크트리는
     팀장의 현재 HEAD 에서 시작한다. 팀장 세션이 죽으면 팀원도 함께 죽는다.
6. **에이전트 팀 백엔드에서는 rtk 훅이 일부 git 명령을 막는다.** 워크트리 격리 에이전트 안에서
   `git status`·`git branch` 처럼 rtk 가 재작성하는 서브커맨드는 "a worktree-isolated agent's git
   operations must target its own worktree" 로 거부되고, `git switch`·`git rev-parse` 처럼 재작성하지
   않는 서브커맨드는 통과한다. 절대경로(`/usr/bin/git`)로 부르면 rtk 를 거치지 않아 통과한다. pane
   백엔드와 rtk 가 없는 PC 에는 해당하지 않는다. `/usr/bin/git` 을 상수로 박지 않고 `command -v git` 을
   쓰는 이유는 킷이 macOS 가 아닌 PC 로도 배포되기 때문이다.
7. **에이전트 팀 팀원은 팀장 세션의 권한 모드를 물려받는다.** Agent 도구의 `mode` 인자는 무시된다.
   팀원이 권한 확인에서 멈추면 완료 알림도 오지 않는다. 또한 git 을 절대경로로 부르므로
   `Bash(git *)` 같은 허용 규칙은 `/usr/bin/git …` 호출에 걸리지 않는다. Orca pane 팀원은 권한 확인
   생략 모드로 뜨므로 해당하지 않는다.
8. **이름 붙은 에이전트는 일을 마쳐도 idle 로 남는다.** `/dflow-dev` 가 Phase 에이전트를 `TaskStop` 으로
   회수하는 이유가 이것이다(`dflow-dev/SKILL.md` 165~173행). 에이전트 팀 팀원의 "턴 종료" 가
   "작업 완료" 와 같은지는 실측하지 않았다. 팀원이 손자 서브에이전트를 기다리며 턴을 끝내면 팀장에게
   결과 줄 없는 완료 알림이 갈 수 있다. 그래서 설계는 이를 방어적으로 다루고(§4-6), 리허설 첫 항목
   A0 에서 실측한다(§11-3).
9. **claim 의 선행 도달 검사는 현재 HEAD 를 본다.** `dflow.sh` 의 `cmd_claim` 은 claim 요청 전에
   `check_depends_local` 을 불러, 선행의 `head_sha` 가 로컬에 없거나 HEAD 의 조상이 아니면 exit 4 로
   막는다(`dflow.sh` 186~199행, 222~226행). `/dflow-dev` 원문은 claim(Phase 0-2)을 브랜치 생성
   (Phase 0-3)보다 먼저 하므로, 기점이 `origin/<기본브랜치>` 가 아닌 경우(스택, 선행 머지 대기)에는
   claim 이 시작 HEAD 탓에 막힌다. 수동과 워커에 공통인 결함이다.
10. **`/dflow-dev` 원문 Phase 5 는 `reported` 를 커밋하지 않는다.** push(2번) → done 보고(3번) →
    state.json `phase=reported` 갱신(4번) 순서이고, 갱신 뒤 커밋·push 가 없다(180~190행). 그래서 원격
    agent 브랜치 tip 의 phase 는 `verify` 에 머문다(mes-base 의 원격 agent 브랜치 네 개 tip 이 모두
    `verify` 였다). 수동 경로에서도 이 미커밋 수정이 다음 브랜치 전환을 막는다. 수정한 파일이 대상
    브랜치에 없으면 git 은 "Your local changes to the following files would be overwritten by
    checkout" 으로 switch 를 거부한다(재현 확인).
11. **`/dflow-dev` 의 머지 세 곳은 팀원 워크트리에서 돌 수 없다.** Phase 0-가 승인 스윕, Phase 0-2 의
    "선행 main 미반영이면 직접 머지", Phase 0 재개 판정의 "approved 면 즉시 머지" 는 기본 브랜치를
    `git switch` 하는데, 기본 브랜치는 팀장 체크아웃이 잡고 있어 실패한다. `--worker` 가 세 곳을
    대체한다(§6-3).
12. **`/dflow-merge` 원문은 로컬 `docs/tasks/*/state.json` 의 `reported` 로만 후보를 찾는다**(17~18행).
    팀원이 마감한 작업의 state.json 은 각 agent 브랜치에만 있어서 팀장 체크아웃에서는 후보가 0건이다.
    또한 원문은 approved 가 아닌 후보를 전부 "승인 대기" 로 보고해 반려를 가려내지 못한다. 반려 갈래는
    `/dflow-dev` Phase 0-가 에만 있다.
13. **poll.sh 는 감시 루프이며 무언가를 찾으면 종료한다.** exit 0(ready 줄들)·8(시한)·9(승인)·10(반려)·
    2/3/5/6/7(설정·인증·네트워크·권한·꺼짐)로 끝난다. 첫 조회는 기동 즉시 하므로, 제외하지 않은 ready
    가 남아 있으면 곧바로 다시 종료한다. `--exclude-temp` 로 받은 id8 은 `--recheck-cycles`(기본 6)
    주기 뒤 스스로 풀리며, 이 주기 수는 poll.sh 프로세스 안에서 센다(22·29·58~61행). 주기 300초면
    30분으로 감시 루프 `TICK` 간격과 같다.
14. **팀장 체크아웃에서는 poll exit 9·10 이 팀원 작업에 대해 울리지 않는다.** poll.sh 는 승인·반려
    감지에 `$PWD/docs/tasks/*/state.json` 을 쓰는데(43행), 팀원이 만든 state.json 은 agent 브랜치와
    팀원 워크트리에만 있다.
15. **새 워크트리에 스킬이 없을 수 있다.** wbs-web 과 킷 설치 리포는 `.claude/skills/` 가 커밋돼 있어
    새 워크트리에도 따라온다. mes-runlog 는 `.claude/skills/dflow-*` 가 wbs-web 정본을 가리키는
    심링크이고 `.gitignore` 39행이 `.claude/skills/` 를 무시한다. `git worktree add`(Orca 와
    `isolation: worktree` 모두)는 무시된 파일을 가져오지 않으므로 새 워크트리에는 스킬이 없다. 또한 끝에
    슬래시가 붙은 무시 패턴은 디렉터리일 때만 걸린다. 그래서 워커가 만드는 `.claude/skills` 심링크는
    이 패턴에 걸리지 않고 미추적 파일로 보인다.
16. **스킬 수정은 버전 게이트 없이 즉시 모든 리포에 적용된다.** 대상 리포의 `.claude/skills/*` 가
    wbs-web 정본 체크아웃을 가리키는 심링크이기 때문이다. 적용되는 내용은 그 체크아웃의 현재 브랜치가
    정한다.
17. **좌석표의 heartbeat 는 아직 서버에 없다.** `POST .../heartbeat`·`dflow.sh heartbeat`·PostToolUse
    훅은 좌석표 S1 산출물이다. 그 전에는 로컬 `~/.dflow/events.jsonl` 만 쓴다.
18. **대화형 세션 전용이다.** `-p` 비대화형은 쓰지 않는다. 상태 정본은 서버와 원격 agent 브랜치다.

## 4. 팀장 절차

팀장은 현재 세션이며 대상 리포 루트(자기 상주 체크아웃)에서 실행한다. 팀장은 포그라운드로 기다리지
않고, 백그라운드 태스크의 종료나 팀원 완료 알림으로만 깨어난다.

### 4-1. 명령과 인자

```
/dflow-team [인원] <종료시각> [모델]
```
예: `/dflow-team 18:00`, `/dflow-team 4명 18시까지 opus`.

- 인자는 LLM 이 자연어로 해석한다. 플래그 문법을 강제하지 않는다.
- **종료 시각은 유일한 필수 인자다.** 없으면 사용법을 출력하고 종료한다. 무인 야간 실행을 막는
  규칙이며 `/dflow-poll` 과 같다. 종료 시각은 새 배정을 멈추는 시각이고 진행 중인 팀원은 끝까지 간다.
  poll.sh 가 자정 넘김을 지원하지 않으므로 그런 시각은 받지 않는다.
- 인원은 동시 팀원 슬롯 수다. 기본 3, 하드 상한 4 다. 4 를 넘기면 4 로 자르고 그 사실을 한 줄 알린다.
- 모델은 선택이다(`opus|sonnet`). 없으면 기본 모델을 쓰며, 값은 팀원이 `/dflow-dev --model` 로 넘긴다.
- 감시 주기는 300초로 고정하고 인자로 받지 않는다.
- 작업을 빼는 인자는 없다. 특정 작업을 팀장이 잡지 않게 하려면 D'Flow 에서 그 작업의 agent 태그를
  끈다. 팀장 내부의 제외 목록(§4-2)은 그대로 있다.

### 4-2. 팀장 상태: 메모리는 캐시다

팀장이 다루는 상태는 슬롯 표(슬롯 번호, `AGENT_ID`, TSK, id8, 워크트리 경로, 터미널 핸들 또는 에이전트
이름, 시작 시각, suspect 표시와 직전 생존 증거), 대기 큐(ready 인데 슬롯이 없어 아직 못 준 id8),
영구 제외 목록(failed·반려·진행 중), 일시 제외 목록(선행·spec 사유), 차단기 상태, 감지된 백엔드다.
세션 메모리의 이 값들은 캐시일 뿐이며, 팀장은 **깨어날 때마다** 아래 정본에서 다시 만든다. 이유: 몇
시간 도는 세션은 컨텍스트 압축을 겪고, 요약에서 슬롯이 빠지면 `.result` 가 와도 처리되지 않는다.

**정본**
- `git worktree list --porcelain` 의 워크트리 중 루트에 `.dflow-agent` 가 있고 그 값이 `<신원>/w` 로
  시작하는 것이 팀원 워크트리다. 값의 슬롯 번호가 그 워크트리의 슬롯이다.
- 그 워크트리 안의 `docs/tasks/*/.result` 가 팀원의 결과다.
- 그 워크트리의 브랜치 이름 `agent/<id8>-…`(있으면)과 Orca 워크트리 이름 `dflow-<id8>` 이 작업을
  알려 준다.

**보조**: `~/.dflow/events.jsonl` 에서 마지막 `team.start` 이후이고 `agent = <신원>/lead`, `repo = 이
리포` 인 줄을 읽는다. `team.spawn` 의 `slot`·`id8`·`worktree`·`handle` 로 슬롯과 작업을 잇는다(아직 브랜치를
만들지 않은 Phase 0 의 팀원도 이것으로 id8 을 안다). `team.result` 로 이미 판정한 작업과 제외 목록,
차단기 상태를 복원한다.

**재구성 규칙**
- 살아 있는 팀원의 워크트리는 그 `.dflow-agent` 슬롯 번호로 슬롯 표에 흡수한다. 그 안에 `.result` 가
  있으면 즉시 처리한다(§4-6).
- 새로 줄 슬롯 번호는 흡수한 번호를 뺀 1..N 중 가장 작은 것이다. 이유: 살아 있는 팀원과 같은
  `AGENT_ID` 를 다시 발급하면 좌석표가 한 인물을 두 책상에 그린다(§9-1).
- "살아 있는 팀원" 은 pane 이면 Orca 워크트리 목록에 그 워크트리가 있고 터미널이 살아 있는 것이다.
  에이전트 팀이면 같은 세션에서 spawn 했고 아직 결과를 처리하지 않은 것이다. 팀장 세션이 새로 뜬
  경우에는 에이전트 팀 팀원이 하나도 살아 있지 않다고 본다(§3-5).
- 대기 큐는 재구성하지 않는다. 비어 있어도 다음 poll 이 같은 ready 를 다시 찾는다.
- 결과 처리는 반복해도 안전해야 하며, 집계는 order 로 중복을 없앤다. done·needs-merge 는 처리하면서
  워크트리를 정리하므로 다시 처리될 일이 없고, 보존된 `blocked` 워크트리가 재구성 뒤 한 번 더 통지되는
  것은 감수한다.
- **고아 스캔**: 이 신원의 `.dflow-agent` 워크트리 중 살아 있는 팀원이 없는 것은 깨끗하고(미커밋
  변경 없음) HEAD 가 `origin/<그 브랜치>` 와 같은 것만 정리한다. 나머지는 경로와 미커밋 목록을 "재개
  필요" 보고에 붙이고 자동으로 지우지 않는다. `.result` 의 branch 가 `-`(브랜치를 만들기 전에 끝남)면
  비교 없이 `--force` 로 정리한다.
- state.json 미러 같은 새 저장소는 만들지 않는다. 정본(서버·원격 agent 브랜치·워크트리)과 따로 도는
  저장소는 동기화 규칙을 계속 맞춰야 하기 때문이다.

### 4-3. 환경 감지 (시작 맨 처음)

1. `$TERM_PROGRAM = Orca` 이거나 `$ORCA_WORKTREE_ID` 가 있으면 **pane 백엔드(Orca)** 다.
2. 그 밖(진짜 tmux·일반 터미널)은 **에이전트 팀 백엔드** 다. tmux 에서는 "v1 은 tmux pane 을 지원하지
   않아 에이전트 팀으로 돈다" 를 한 줄 알린다. 에이전트 팀이면 `blocked` 응답 경로와 가시성이 pane 과
   다르다는 점(§7)도 한 줄 알린다.

어느 갈래에서도 "병렬 불가" 로 종료하지 않는다. 백엔드 이름은 시작 보고와 `team.start` 에 남긴다.

### 4-4. 시작

1. **전제 검사**: 하나라도 실패하면 아무것도 띄우지 않고 중단한다.
   - `.env` 가 있고, `set -a; . ./.env; set +a` 뒤 `dflow.sh doctor` 가 exit 0 이다. `DFLOW_PATS` 첫
     토큰이 이 신원의 PAT 인지 `dflow.sh me` 로 이름을 출력해 확인한다.
   - 공유 `info/exclude`(`git rev-parse --git-path info/exclude`)에 워커 부산물 패턴을 없을 때만 넣는다.
     커밋하지 않는 로컬 설정이며 링크드 워크트리가 모두 공유한다.
     - `**/.claude/worktrees/`: 에이전트 팀 격리 워크트리가 대상 리포 안에 생긴다.
     - `/.dflow-agent`, `docs/tasks/*/.result`: 워커가 쓰는 미추적 파일이다.
     - `/.claude/skills`(끝 슬래시 없음): 워커가 만드는 스킬 심링크다(§3-15). **`.claude/skills` 가
       추적되지 않는 리포에서만 넣는다.** 스킬이 커밋된 리포에 넣으면 새로 추가하는 스킬 파일이 무시돼
       `git add` 가 거부된다.

     이유: 부산물이 `/dflow-dev` Phase 5 의 "미커밋 잔여물 커밋" 에 섞이면, 브랜치마다 다른
     `.dflow-agent` 가 스윕 머지를 충돌시키고 절대경로 심링크가 main 에 들어간다.
   - 그 뒤 `git status --porcelain` 이 비어 있다. 팀장 체크아웃이 더러우면 승인 스윕이 위험하다. 실패
     안내에는 "미커밋 `docs/tasks/*/state.json` 은 파일명을 명시해 먼저 커밋하라" 를 넣는다. 수동
     `/dflow-dev` 가 남긴 것일 수 있기 때문이다.
   - `.claude/skills/` 의 `dflow-dev`·`dflow-work`·`dflow-poll`·`dflow-merge`·`dflow-team` 이 cwd 에서
     해석된다(심링크 포함).
   - 종료 시각이 미래다.
   - 수정된 기존 스킬이 적용돼 있다: `grep -q -- '--worker' .claude/skills/dflow-dev/SKILL.md` 와
     `grep -q 'origin/agent/\*' .claude/skills/dflow-merge/SKILL.md`. 이유: 옛 버전을 만나면 팀원이
     기본 브랜치 switch 에서 죽고, 스윕이 팀원 작업을 영영 보지 못한다.
   - pane(Orca)이면 `orca worktree create --help` 가 `--agent`·`--prompt` 를 지원한다.
2. **재구성**: 새 `team.start` 를 쓰기 **전에** §4-2 재구성과 고아 스캔을 한다. 이유: "마지막
   `team.start` 이후" 필터가 이전 세션의 이벤트를 가리지 않게 하려는 것이다. 이 단계가 곧 재기동
   절차다(§7).
3. **권한 모드 안내 한 줄**: 에이전트 팀이면 "팀원은 이 세션의 권한 모드를 물려받으며, 권한 확인이
   뜨면 알림 없이 멈춘다" 를, pane 이면 "팀원은 권한 확인 생략 모드로 뜬다" 를 출력한다(§3-7, §8).
4. **`team.start` 기록**과 **승인 스윕 1회**(§4-7). 스윕 결과(머지됨·대기·반려·건너뜀)를 한 줄씩
   보고한다.
5. **감시 시작**: poll.sh 와 감시 루프를 Bash `run_in_background` 로 띄운다(§4-5). 셸 `&` 는 쓰지
   않는다. 종료 알림이 세션에 오지 않기 때문이다.

### 4-5. 기상과 감시

팀장을 깨우는 것은 셋이다.

- **poll.sh**(새 작업·시한·오류):
  ```
  poll.sh --require-tag agent --until <HH:MM> --interval 300 \
    --exclude <영구 제외 목록> --exclude-temp <일시 제외 목록>
  ```
  **빈 슬롯이 없으면 poll 을 재기동하지 않고, 슬롯이 비면 재기동한다.** poll 은 기동 즉시 첫 조회를
  하므로(§3-13), 슬롯이 찬 채로 띄우면 같은 ready 로 곧바로 다시 끝나 공회전한다. 대기 큐는 `--exclude`
  에 넣지 않는다. 메모리에만 있는 값이 떠 있는 poll 프로세스 안에 숨으면, 컨텍스트 압축으로 대기 큐를
  잃었을 때 그 작업들이 보이지 않는 제외에 갇히기 때문이다. 슬롯이 찬 동안에는 poll 이 떠 있지 않을 수
  있으므로, 팀장은 기상마다 스스로 시각을 보고 종료 시각이 지났으면 poll exit 8 과 같이 처리한다.
  일시 제외는 poll.sh 가 6주기 뒤 스스로 풀어 재발견을 유도하므로, 팀장은 해제 시각을 따로 관리하지
  않는다. 풀린 id8 이 다시 발견되면 착수 판정을 다시 하고, 여전히 막히면 다시 일시 제외에 넣는다.
  poll 을 다른 이유로 재기동하면 6주기 계산이 처음부터 다시 시작된다(poll.sh 프로세스 안에서 세기
  때문이다). 재검사가 늦어질 뿐 틀린 착수는 생기지 않는다.
- **감시 루프**(팀원 결과·`TICK`): SKILL.md 에 적힌 셸 루프 하나가 백엔드에 따라 다르게 돈다.
  - pane: 진행 중 슬롯들의 워크트리에서 `docs/tasks/<TSK>/.result` 를 20초마다 보고, 파일이 생기거나
    **줄 전체가** 직전 값과 달라지면 그 줄을 출력하고 끝난다. status 만 비교하지 않는 이유는 답을 받은
    팀원이 다시 `blocked` 가 되면 status 가 같아 깨어나지 않기 때문이다. 루프는 기동 즉시 현재 전체
    슬롯 경로를 한 번 전수 검사한 뒤 감시에 들어간다. 루프를 바꾸는 사이에 도착한 `.result` 를
    놓치지 않기 위해서다.
  - 에이전트 팀: `.result` 를 감시하지 않는다. 팀원 완료 알림이 팀장을 깨운다.
  - 두 백엔드 모두 30분이 지나면 `TICK` 을 출력하고 끝난다. 한가한 구간에도 30분마다 승인 스윕과
    suspect·무응답 점검을 하기 위해서다. TICK 시각은 루프 기동 시각이 아니라 팀장이 넘기는 다음 TICK
    예정 시각으로 정한다. 루프를 자주 바꿔도 TICK 이 밀리지 않게 하기 위해서다.
  - **세대 파일**: 루프 교체는 TaskStop 이 아니라 세대 파일
    `$(git rev-parse --git-path dflow-team.gen)` 로 한다. 팀장은 루프를 새로 띄울 때 파일의 세대 값을
    올리고 그 값을 루프에 넘긴다. 루프는 매 패스마다 파일을 읽어 자기 세대와 다르면 `STALE` 을
    출력하고 스스로 끝난다. 이유: 컨텍스트 압축으로 태스크 id 를 잃어도 루프가 겹쳐 같은 결과를 두 번
    처리하지 않게 한다.
- **에이전트 팀 완료 알림**: 이름이 `w<slot>-<id8>` 인 팀원이 끝나면 온다.

**기상마다 하는 일**: 재구성(§4-2) → 아래 표의 처리 → 승인 스윕(§4-7) → 빈 슬롯이 있고 차단기가
허락하면 대기 큐에서 spawn(§4-8) → 끝나 있는 감시 루프 재기동, 빈 슬롯이 남아 있으면 poll.sh 재기동.
단 `STALE` 기상은 아무것도 하지 않고 넘긴다. 컨텍스트 압축 뒤 poll 이 떠 있는지 모르면 새로 띄운다.
poll 이 겹쳐 떠도 spawn 전 확인(§4-8)이 같은 작업을 두 번 띄우지 않게 막는다.

승인 스윕을 도는 기상은 시작, 결과 도착(`.result` 또는 완료 알림), `TICK`, poll 재기동 직전, 마감이다.
이유: 팀장 체크아웃에서는 poll exit 9 가 팀원 작업에 울리지 않는다(§3-14). 대가로 승인 반영은 사람이
승인한 뒤 다음 기상까지 늦어지며, `TICK` 이 있어 최대 30분이다. 이 지연은 후속 작업의 착수를 막지
않는다. 서버 claim 게이트는 선행의 승인과 stage 로 판정하고, main 미반영 선행은 워커가 스택 기점으로
받는다(§6-2, §6-3 행 B).

| 기상 | 처리 |
|---|---|
| poll exit 0 (ready N줄) | 순번은 버리고 id8 만 쓴다. 후보마다 `dflow.sh show <id8>` 를 jq 로 걸러 `item.spec` 이 비었는지만 본다(spec 본문을 컨텍스트에 싣지 않는다). 비었으면 일시 제외에 넣고 사유를 보고한다. 남은 것을 빈 슬롯 수만큼 spawn 하고 나머지는 대기 큐에 넣는다. 차단기가 걸려 있으면 spawn 하지 않고 대기 큐에 넣는다. 대기 큐를 잃어도 그 작업들은 아직 ready 이므로 다음 poll 이 다시 찾는다 |
| poll exit 9 (승인 감지) | 승인 스윕. 팀장 체크아웃에 state.json 이 있는 작업(사람이 수동으로 마감한 것)에만 온다 |
| poll exit 10 (반려 감지) | "수동 `/dflow-dev <id8>` 대상" 으로 보고하고 영구 제외에 넣는다. 재작업은 기존 agent 브랜치 위에서 해야 하므로 자동 배정하지 않는다. 팀원 작업의 반려는 승인 스윕의 반려 갈래가 잡아 똑같이 처리한다 |
| poll exit 8 (시한) | 새 배정을 멈춘다. 대기 큐를 비우고(보고만 한다) 진행 중 팀원의 결과를 모두 받은 뒤 마감(§4-9) |
| poll exit 2·3·5·6·7 | 중단 사유를 보고하고, 진행 중 팀원의 결과만 받은 뒤 마감 |
| 결과 도착 | §4-6 |
| `TICK` | suspect 슬롯과 무응답 슬롯의 생존 증거를 잰다(§4-6). 차단기가 걸려 있으면 시험 spawn 1건을 허용한다 |
| `STALE` | 무시한다 |

### 4-6. 결과 처리

**결과 줄 찾기**
- pane: 감시 루프가 출력한 워크트리의 `.result` 한 줄이다.
- 에이전트 팀: 완료 알림의 이름 `w<slot>-<id8>` 에서 **id8 로** 슬롯 표를 찾는다. 슬롯 번호로 찾지
  않는 이유는 이미 판정한 옛 팀원의 늦은 알림이 같은 슬롯의 새 작업을 오판하게 만들기 때문이다. 표에
  없는 id8(이미 판정한 것)의 알림은 집계만 갱신하고 슬롯을 건드리지 않는다. 표에 있으면 그 워크트리의
  `.result` 를 읽고, 워크트리가 이미 정리돼 파일이 없으면 알림에 담긴 마지막 응답에서 같은 형식의 줄을
  찾는다.
- 에이전트 팀에서 두 곳 모두 결과 줄이 없으면 `failed` 가 아니라 **`suspect`** 로 표시하고 슬롯을
  유지한다. 팀원이 손자 서브에이전트를 기다리며 턴을 끝낸 것일 수 있기 때문이다(§3-8). 그 뒤 매
  `TICK` 에 생존 증거를 재고, **두 TICK 연속으로 변하지 않을 때만** `failed no-result` 로 판정한다.
  그 사이에 `.result` 가 생기거나 알림이 다시 오면 정상 처리한다.

**생존 증거**: 아래 중 하나라도 직전 `TICK` 과 달라지면 살아 있는 것이다.
1. 브랜치 tip 커밋 시각. 워크트리가 있으면 그 워크트리 HEAD 의 커밋 시각
   (`git -C <워크트리> log -1 --format=%ct`)을, 없으면 `git fetch origin` 뒤
   `origin/agent/<id8>-…` 의 커밋 시각을 본다.
2. 서버 최신 progress. `dflow.sh show <id8>` 를 jq 로 걸러 마지막 리포트의 시각만 본다.
3. 워크트리가 있으면 그 미커밋 변경 목록(`git -C <워크트리> status --porcelain`). pane 이면 Orca
   화면(`orca terminal read --screen`)의 변화도 증거로 본다.

**status 별 처리**: 모든 결과는 `team.result` 로 기록한다.

| status | 슬롯 | 제외 | 워크트리 | 그 밖 |
|---|---|---|---|---|
| `done` | 해제 | 없음 | HEAD 가 `origin/<agent 브랜치>` 와 같으면 그 자리에서 정리한다. 다르면 경로를 보고하고 남긴다 | 대기 큐가 있으면 그 슬롯에 spawn 한다. 비어 있으면 poll 재기동 규칙(§4-5)을 따른다 |
| `needs-merge` | 해제 | 없음 | done 과 같다 | 승인 스윕을 곧바로 한다 |
| `skipped`(선행 미충족·claim exit 4·공통 기점 없음·spec 부재) | 해제 | 일시 제외 | branch 가 `-` 면 비교 없이 `--force` 정리 | 사유 보고 |
| `blocked` | pane 은 유지, 에이전트 팀은 해제 | 진행 중으로 영구 제외에 남긴다 | pane 은 그대로 둔다. 에이전트 팀은 재spawn 직전에 정리한다(§7) | 통지(§7) |
| `failed <사유>` | 해제 | 영구 제외 | 고아 정리 규칙(§4-2)을 따른다 | 사유 보고, 차단기 계산 |
| `failed rate-limit` | 해제 | 제외하지 않는다 | 고아 정리 규칙을 따른다 | 재시도할 수 있다. 아직 ready 면 poll 이 다시 찾고, 이미 claimed 면 "재개 필요" 로 보고한다. 차단기 계산에 넣는다 |
| `failed no-result`(suspect 판정) | 해제 | 영구 제외 | 고아 정리 규칙을 따른다 | 차단기 계산 |
| `failed not-isolated` | 해제 | 영구 제외 | 없음(워커가 파일을 쓰지 않았다) | 백엔드 결함이므로 새 spawn 을 멈추고 마감으로 간다 |

- **그 자리에서 정리하는 이유**: git 은 다른 워크트리가 체크아웃한 브랜치를 지우지 못한다(§3-3).
  워크트리를 마감까지 남기면 같은 세션에서 승인된 작업의 로컬 agent 브랜치 삭제가 실패한다.
- **회수**: 에이전트 팀에서는 결과 줄을 처리한 직후(status 와 무관하며 `blocked` 도 포함한다)
  `TaskStop(w<slot>-<id8>)` 으로 idle 팀원을 회수한다(§3-8). pane 팀원은 별도 프로세스라서 TaskStop
  대상이 아니다.
- **차단기**: 결과가 도착한 순서로 `failed`(`no-result`·`rate-limit` 포함)가 연속 2건이면 새 spawn 을
  멈추고 보고한다. `failed` 가 아닌 결과가 오면 연속 수를 0 으로 되돌린다. 걸린 동안에는 다음 `TICK`
  마다 1건만 시험 spawn 하고, 그 결과가 `failed` 가 아니면 차단기를 푼다. 이유: 사용량 한도나 환경
  결함에 걸린 채 대기 큐 전체를 소진하지 않게 한다.
- **무응답**: 결과도 알림도 없는 진행 슬롯의 생존 증거가 한 `TICK` 동안 변하지 않으면 "무응답" 으로
  보고만 하고 슬롯을 유지한다. 느린 팀원을 죽이면 미커밋분을 잃고, 권한 확인에 걸려 멈춘 팀원(§3-7)은
  사람이 보면 풀리기 때문이다. 자동 정리는 **두 TICK 연속으로** 생존 증거가 없을 때만 한다. 에이전트
  팀은 먼저 `TaskStop` 으로 팀원을 멈추고 슬롯을 해제하며, 워크트리는 고아 정리 규칙을 따른다. pane 은
  팀원 프로세스를 멈출 수단이 워크트리 삭제뿐이므로, 깨끗하고 push 된 경우에만 `orca worktree rm`
  으로 정리하고 슬롯을 해제한다. 그렇지 않으면 슬롯을 계속 잡고 "사람 확인 필요" 로 보고한다.
  자동 정리한 작업은 영구 제외에 넣고 "재개 필요" 로 보고한다.

### 4-7. 승인 스윕

팀장은 인자 없이 `/dflow-merge` 를 실행한다(§6-4 의 수정본). 후보가 원격 `origin/agent/*` tip 에서도
오므로 팀장 체크아웃의 state.json 유무와 무관하다. 판정은 서버 `show` 로만 하고 approved 만 머지한다.

- 반려 갈래로 보고된 id8 은 poll exit 10 행과 똑같이 처리한다.
- 다중 경합: 두 팀장의 스윕이 같은 브랜치를 머지하려 하면 나중 쪽 `git push` 가 non-fast-forward 로
  거부된다. 그러면 `git pull --ff-only` 뒤 후보를 다시 식별한다. 이미 머지된 것은 빠진다.
- 로컬 agent 브랜치 삭제가 "checked out" 오류로 실패하면 `/dflow-merge` 가 건너뛰고 보고한다. 그
  워크트리는 결과 처리나 고아 스캔이 정리한다.

### 4-8. 팀원 spawn

공통: spawn 전에 그 id8 이 재구성한 슬롯 표에 있으면 띄우지 않는다. poll 이 겹쳐 떠서 같은 ready 를
두 번 돌려줘도 한 번만 띄우기 위해서다. 그 다음 슬롯 번호를 정하고(§4-2) `AGENT_ID = <신원>/w<slot>` 을
만든다. `{MAIN_CHECKOUT}` 은 팀장의 상주 체크아웃 절대경로다. 백엔드에는 워커 프롬프트 전문이 아니라 짧은 포인터 한 줄을 넘기고, 워커가
`references/worker-prompt.md`(§5)를 읽어 그 규칙대로 실행한다. 전문을 쉘 인자로 넘기면 백틱·따옴표·
여러 줄이 섞여 깨지기 때문이다(Orca `--prompt` 자동 제출은 한 줄에서 확인됐다). 포인터는 치환 변수만
전달한다.
```
<MAIN_CHECKOUT>/.claude/skills/dflow-team/references/worker-prompt.md 를 읽고 그 규칙대로 실행하라. TSK=<TSK> ID8=<id8> AGENT_ID=<신원>/w<slot> MAIN_CHECKOUT=<팀장 체크아웃 절대경로> BACKEND=<pane|agent-team> MODEL=<opus|sonnet|default>
```
- 워커 프롬프트 경로를 절대경로로 주는 이유는 새 워크트리에 스킬이 없을 수 있기 때문이다(§3-15).
- 모델은 공백이 든 `--model opus` 를 넘기지 않고 `MODEL=` 로 넘기며, 워커가 `{MODEL_FLAG}` 로 바꾼다
  (`default` 면 빈 값).
- 에이전트 팀 `blocked` 재개 때만 둘째 줄에 `ANSWER=<담당자 답 한 줄>` 을 붙인다. Agent 도구는 쉘
  인자가 아니라서 여러 줄이 안전하다.
- spawn 직후 `team.spawn` 에 `slot`·`tsk`·`order`·`id8`·`worktree`·`handle` 을 남긴다. 워크트리 경로를
  아직 모르면 `worktree` 는 `-` 로 두고, `handle` 은 Orca 터미널 핸들 또는 에이전트 이름이다. 재구성이
  이 기록으로 슬롯과 작업을 잇는다(§4-2).

백엔드별:
- **pane(Orca)**:
  ```
  orca worktree create --name dflow-<id8> --agent claude --no-parent \
    --base-branch origin/<기본브랜치> --prompt "<포인터 한 줄>" --json
  ```
  기점은 agent 브랜치가 결국 머지될 `origin/<기본브랜치>` 로 명시한다. 생략하면 리포 기본 base 로
  가는데, 팀장의 현재 브랜치가 staging 등일 때 의도와 어긋나기 때문이다. 결과 JSON 의
  `result.worktree.path` 와 `result.agentTerminalHandle` 을 슬롯 표에 저장한다.
- **에이전트 팀**: Agent 도구로 띄운다. 다른 백엔드와 문구를 맞추기 위해 같은 포인터를 넘긴다.
  - `isolation: "worktree"` 는 **필수**다. 빠뜨리면 팀원이 팀장 cwd 를 상속해 서로를 덮어쓴다(§3-5).
  - `name` 은 `w<slot>-<id8>` 이다. 슬롯이 앞에 있어 사람이 알아보고, id8 이 붙어 같은 슬롯의 다음
    작업과 이름이 겹치지 않는다. 결과 매칭(§4-6)과 `TaskStop` 회수가 이 이름을 쓴다. 좌석표 식별은
    이름이 아니라 포인터의 `AGENT_ID=` 가 정한다.
  - `subagent_type` 은 모든 도구(Skill·Agent·Bash 포함)를 가진 범용 타입(`general-purpose`)이다.
  - `model` 은 인자로 받은 모델을 전달한다.
  - 격리 워크트리는 팀장의 현재 HEAD 에서 시작하지만, 워커 부트스트랩이 끝에서
    `origin/<기본브랜치>` 로 detach 하고(§5), 스택 기점은 `/dflow-dev` Phase 0-2 가 claim 전에 맞춘다
    (§6-2). 그래서 팀장이 따로 기점을 정하지 않는다.

같은 작업을 다시 띄우는 일은 없다. 예외는 에이전트 팀의 `blocked` 재개(§7) 하나이며, 그 밖의 재개는
사람 몫이다.

### 4-9. 마감

집계 표(TSK, id8, 브랜치, head, done exit, status, 사유)를 보고하고, 마지막 승인 스윕을 한 번 돈다.
남은 팀원 워크트리는 백엔드별로 정리한다. Orca 는 `orca worktree rm --worktree "<id>"`, 에이전트 팀은
워크트리가 아직 있을 때만 `git worktree remove --force <path>` 다. 두 경우 모두 고아 정리 규칙(§4-2)을
따라, 깨끗하고 HEAD 가 `origin/<agent 브랜치>` 와 같을 때만 지우고 나머지는 경로를 보고한다. 단 pane
의 `blocked` 워크트리는 팀원이 탭에서 답을 기다리고 있으므로 조건과 무관하게 지우지 않고 보고에 남긴다.
에이전트 팀의 `--force` 는 미추적 부산물(`.result`·`.dflow-agent`·`.env` 링크·스킬 링크) 때문에
필요하다. **agent 브랜치는 남긴다.** 승인은 사람이 D'Flow 웹에서 하고, 승인 뒤 머지는 다음
`/dflow-team` 의 스윕이나 `/dflow-merge` 가 한다. 종료 이벤트 `team.stop` 을 남긴다.

## 5. 팀원 계약 (`references/worker-prompt.md`)

팀원은 진짜 메인 에이전트다. 백엔드가 첫 입력으로 넘기는 것은 이 파일 전체가 아니라 포인터 한 줄
(§4-8)이며, 팀원은 그 줄의 `KEY=VALUE` 로 변수를 받고 이 파일을 읽어 규칙대로 실행한다.

변수: `{TSK}`, `{ID8}`, `{AGENT_ID}`, `{MAIN_CHECKOUT}`, `{MODEL_FLAG}`, `{BACKEND}`. `{BACKEND}` 는
`pane` 또는 `agent-team` 이며 `blocked` 이후 동작을 가른다. 선택 변수 `{ANSWER}` 는 에이전트 팀에서
`blocked` 뒤 재spawn 할 때만 붙는다(§7). 있으면 워커는 그것을 직전 질문에 대한 담당자 결정으로 보고
design.md 에 한 줄 남긴 뒤 이어 간다.

**git 호출 규칙(두 백엔드 공통)**: 워커는 부트스트랩에서 `command -v git` 으로 git 절대경로를 확인하고,
이후 모든 git 호출에 그 절대경로를 쓴다(bare `git` 금지). 에이전트 팀에서 rtk 가 재작성한 git 이 격리
가드에 막히기 때문이다(§3-6). pane 에서는 필요 없지만 무해하며, 백엔드별 분기를 두지 않으려고
공통으로 적용한다. 아래 예시의 `git` 도 그 절대경로로 읽는다.

**격리 확인 (첫 행동)**
```bash
case "$(git rev-parse --show-toplevel)" in
  "{MAIN_CHECKOUT}") echo "NOT_ISOLATED"; exit 1;;
  *) : ;;   # 자기 워크트리여야 한다
esac
```
자기 cwd 가 팀장의 상주 체크아웃과 같으면(격리 실패) **아무 파일도 쓰지 않고** 마지막 응답으로
`{TSK} {ID8} - - - failed not-isolated` 한 줄만 출력하고 끝낸다. `.result` 를 쓰면 그 파일이 팀장
체크아웃을 더럽혀 전제 검사가 깨지기 때문이다. 팀장은 완료 알림(에이전트 팀)이나 무응답 규칙(pane)으로
이를 알게 된다.

**워크트리 부트스트랩**: `.env` 는 gitignore 대상이라 새 워크트리에 없으므로 메인 체크아웃에서
심링크한다. `.claude/skills` 는 커밋된 리포면 이미 있고, gitignore 된 심링크로 배포한 리포면 없으므로
(§3-15) 없을 때 메인 체크아웃의 것을 심링크한다. 끝으로 기점을 `origin/<기본브랜치>` 로 맞춘다.
```bash
[ -e .env ] || ln -s {MAIN_CHECKOUT}/.env .env
[ -e .claude/skills/dflow-dev/SKILL.md ] || { mkdir -p .claude && ln -s {MAIN_CHECKOUT}/.claude/skills .claude/skills; }
set -a; . ./.env; set +a; .claude/skills/dflow-work/scripts/dflow.sh doctor
git fetch origin && git switch --detach origin/<기본브랜치>
```
- 마지막 줄은 두 백엔드 공통이다. 이유: 워크트리의 시작 HEAD 는 팀장의 현재 브랜치(staging 등)이거나
  뒤처진 기본 브랜치일 수 있고, claim 의 선행 도달 검사는 HEAD 를 본다(§3-9).
- `{ANSWER}` 가 있는 재spawn(§7)이면 마지막 줄 대신 기존 agent 브랜치로 옮긴다
  (`git branch -r --list 'origin/agent/{ID8}-*'` 로 이름을 찾아 `git switch <agent/{ID8}-…>`). 이미
  claimed 인 작업을 그 브랜치 위에서 이어 가야 하기 때문이다.
- dflow.sh 를 부를 때마다 `set -a; . ./.env; set +a` 를 앞에 붙인다. env 는 Bash 호출 사이에 남지 않는다.
- 심링크와 `.dflow-agent`·`.result` 는 커밋하지 않는다. 팀장이 공유 `info/exclude` 에 넣어 두고
  (§4-4), `/dflow-dev` 는 파일명을 명시해 stage 한다.
- `/dflow-dev` SKILL.md 에 `--worker` 가 없으면(옛 버전) 실행하지 않고 `.result` 에
  `failed no-worker-flag` 를 쓰고 끝낸다. 옛 버전은 기본 브랜치 switch 에서 죽기 때문이다.

**좌석 식별 (부트스트랩 직후, claim 전)**: 워크트리 루트의 `.dflow-agent` 에 `{AGENT_ID}` 한 줄을
쓴다(§9-1). `docs/tasks/{TSK}/` 안에 두지 않는 이유는, `/dflow-dev` 가 claim 하려는 작업의
`docs/tasks/<TSK>/` 가 이미 있으면 이전 시도의 잔재로 보고 `.prev-<날짜>` 로 옮기기 때문이다(dflow-dev
상태 모델의 "재claim 시 이전 시도의 잔재 격리"). 워크트리 하나가 작업 하나라서 루트 파일로도 모호하지
않다.

**실행**: Skill 도구로 `/dflow-dev {ID8} --worker {MODEL_FLAG}` 를 실행한다. 참조는 id8 만 쓰고 순번은
쓰지 않는다. Skill 도구가 `dflow-dev` 를 모르면(스킬 없는 워크트리에서 세션이 시작돼 등록되지 않은
경우) `.claude/skills/dflow-dev/SKILL.md` 를 Read 해서 `$ARGUMENTS` 를 `{ID8} --worker {MODEL_FLAG}` 로
놓고 그 절차를 그대로 따른다. 스킬 hot-reload 를 기다리지 않는다.

**서버 쓰기 범위**: `{ID8}` 외의 어떤 주문에도 claim·progress·release·done 을 하지 않는다. `list` 는
호출하지 않는다. 필요한 조회는 `show {ID8}` 뿐이다(§3-4 의 캐시 공유 때문이다).

**판단 규칙(자동 모드)**: `--worker` 이므로 AskUserQuestion 을 쓰지 않는다. 명백한 기본값이 있으면
그것을 택하고 결정 내용을 design.md 나 커밋 메시지에 한 줄 남긴 뒤 진행한다. 기본값이 없어 담당자
결정이 꼭 필요할 때만 멈추며, 그때는 **현재 산출물을 커밋·push 한 뒤** `.result` 에 `blocked`(질문과
선택지를 사유 자리에)를 쓴다. 그 다음 동작은 백엔드에 따라 갈린다.

| 백엔드 | `blocked` 이후 |
|---|---|
| pane | 질문을 화면에 출력한 채 세션을 멈춘다. 탭이 열려 있으므로 사람이 그 탭에서 답하거나 수동 `/dflow-dev {ID8}` 로 이어받는다. 슬롯은 계속 점유한다 |
| 에이전트 팀 | 탭이 없어 멈춰 있어도 아무도 못 보므로, 질문을 `.result` 에 남기고 **세션을 끝낸다.** 팀장이 알림으로 받아 사람에게 전달하고, 답이 오면 팀장이 기존 브랜치로 워커를 다시 띄운다(§7) |

에이전트 팀 팀원도 AskUserQuestion 도구를 갖고 있지만 쓰지 않는다. 슬롯 N개가 각자 질문을 띄우면 사람이
어느 팀원의 질문인지 모른 채 창 N개를 받으므로 질문을 팀장 한 곳으로 모은다. 억제 계약은 두 백엔드에서
같다.

**보고(`.result` 파일 계약)**: 작업을 끝내거나 멈출 때 `docs/tasks/{TSK}/.result` 에 아래 한 줄을
쓴다. 팀장은 이 파일만 파싱한다.
```
{TSK} {ID8} <branch|-> <head_sha|-> <done_exit|-> <status> <한 줄 사유 또는 질문>
```
- `status` ∈ `done` / `skipped` / `needs-merge` / `blocked` / `failed`.
- `skipped` 는 착수 전에 멈춘 것이다: claim exit 4, 선행 미충족, 선행을 모두 조상으로 갖는 기점 없음,
  spec 부재. 팀장은 이를 일시 제외로 다룬다.
- `failed` 의 사유는 자유 문구이되 팀장이 구분하는 값이 셋 있다: `rate-limit`(사용량 한도·rate limit
  오류로 멈춤, 재시도 가능), `not-isolated`(격리 실패), `no-worker-flag`(옛 `/dflow-dev`).
- `.result` 는 커밋하지 않는다. 마지막 응답에도 같은 줄을 출력한다. 에이전트 팀에서 워크트리가 이미
  정리됐을 때의 폴백이자 Orca `terminal read` 용이다.

## 6. 기존 스킬 수정 계약

### 6-1. 원칙과 테스트

- **원칙**: 필요하면 기존 스킬 원문도 고친다. 조건은 수동(`--worker` 없는) 동작이 퇴행하지 않는
  것이며, 수동 경로의 결함을 고치는 수정은 환영한다. 이유: 스킬은 심링크로 모든 리포에 즉시
  적용되므로(§3-16) 수동 동작 회귀가 곧 운영 사고다. 반대로 가산만 고집하면 수동 경로에도 있는 결함
  (§3-9, §3-10)을 워커용 우회로 덮게 된다.
- **수정 목록**(이 목록 밖의 원문은 바꾸지 않는다)
  - `/dflow-dev`: Phase 0-2 의 claim 전 기점 이동(§6-2), Phase 0-3 의 기점 문구, Phase 5 4번의
    `reported` 커밋·push(§6-2), `--worker` 블록 추가와 인자 파싱(§6-3). description(3행)의 사용법 줄은
    바꾸지 않는다.
  - `/dflow-merge`: 인자 설명(8행), 후보 식별(1번), 판정 보고(2번·6번), 뒷정리의 로컬 브랜치
    삭제(5번)(§6-4).
  - `/dflow-poll`·`poll.sh`: 고치지 않는다.
- **보존 테스트**: "의도한 수정 목록에 없는 원문 줄은 보존된다" 를 단언한다. fixture 에서 의도적으로
  바꾸거나 지우는 줄을 테스트 파일에 명시 목록으로 두고, 나머지 줄은 같은 순서로 남아 있어야 한다.
  fixture 는 실행 시점에 원문을 `cp` 해서 만들고, 머지 직전에 대상 브랜치의 원문에서 다시 떠서
  재실행한다. 이유: 머지 충돌을 한쪽으로 풀다가 다른 세션의 수정을 잃어도 옛 fixture 로는 초록이기
  때문이다.
- **표지 주석**: `/dflow-dev` 의 `--worker` 삽입 블록은 `<!-- worker:begin -->` / `<!-- worker:end -->`
  로 감싼다. 테스트가 "현재 파일에서 표지 블록을 뺀 것" 을 원문과 비교할 수 있게 한다.

### 6-2. `/dflow-dev` 원문 수정 (수동·워커 공통)

**Phase 0-2 착수 가능 판정과 claim (현행 104~134행)**
- 기점 결정을 claim 앞으로 당긴다. 기점 규칙 자체는 현행 Phase 0-3(135~142행)과 같다. 기본은
  `origin/<기본브랜치>` 이고, 선행이 main 미반영이거나 미승인 스택이면 선행 산출물이 있는 agent
  브랜치(또는 그 `head_sha`)다.
- 기점이 `origin/<기본브랜치>` 가 아니면 claim 직전에 `git switch --detach <기점>` 으로 옮긴 뒤 claim
  한다. Phase 0-3 은 그 기점에서 `git switch -c agent/<주문id8>-<slug> <기점>` 한다.
- 선행이 여럿이고 모두를 조상으로 갖는 기점이 없으면(`git merge-base --is-ancestor` 로 판정) 착수
  불가로 스킵하고 사유를 보고한다. 워커는 `.result` 에 `skipped` 를 쓴다.
- claim 이 실패하면 detach 전 브랜치로 돌아간다(`git switch -`). 수동 사용자를 detached HEAD 에 남기는
  것은 수동 동작의 퇴행이기 때문이다.
- 이유: claim 의 선행 도달 검사가 시작 HEAD 를 본다(§3-9).
- 수동 동작의 변화(개선): 스택 기점이나 선행 머지 대기가 있을 때 시작 HEAD 탓에 claim 이 exit 4 로
  막히던 결함이 없어진다. 끝 상태는 전과 같이 새 agent 브랜치다.

**Phase 5 4번 (현행 187~190행)**
- state.json 을 `phase=reported` 로 갱신한 뒤 그 파일을 파일명을 명시해 커밋하고
  `git push origin <agent 브랜치>` 한다. push 가 훅에 거부되면 우회하지 않고 보고한다. done 은 이미
  보고됐으므로 되돌리지 않는다. 이 push 가 실패해도 `/dflow-merge` 의 원격 후보 조건이 phase 에 기대지
  않으므로 승인 반영은 막히지 않는다(§6-4).
- 이유: 원문대로면 원격 tip 의 phase 가 `verify` 에 머물고, 미커밋 state.json 이 다음 브랜치 전환을
  막는다(§3-10).
- 수동 동작의 변화(개선): 다음 `/dflow-dev` 가 새 브랜치를 딸 때 "local changes would be overwritten"
  으로 멈추던 결함이 없어진다. 그 대신 다른 브랜치로 옮긴 뒤에는 그 작업의 state.json 이 작업트리에서
  빠지므로, 로컬 state.json 만 보는 감지(poll exit 9, `/dflow-dev` Phase 0-가)는 그 작업을 보지
  못한다. 그 작업의 승인 반영은 원격 후보를 보는 `/dflow-merge` 가 잡는다.

`/dflow-dev` Phase 0-가 의 후보 식별(60행)은 바꾸지 않는다.

### 6-3. `/dflow-dev --worker` (팀장 전용)

`--worker` 는 "이 세션은 자동 실행되는 팀원이며, 기본 브랜치를 잡고 있는 상위 체크아웃이 따로 있다"
는 뜻이다. 절 머리에 **"팀장 전용, 사람이 직접 쓰지 않는다"** 를 적는다. description 의 사용법 줄에는
노출하지 않고, `.dflow-agent` 가 있다고 워커 모드로 자동 전환하지 않는다. 남은 워크트리에서 사람의
질문이 조용히 꺼지는 사고를 막기 위해서다. 블록은 표지 주석으로 감싼다(§6-1).

| # | 위치(현행 줄) | 플래그 없음 | `--worker` |
|---|---|---|---|
| A | Phase 0-가 승인 스윕(54~82) | claim 앞에서 매번 스윕한다 | **건너뛴다.** 스윕은 팀장 몫이며, 이유를 한 줄 남긴다 |
| B | Phase 0-2 선행이 approved 인데 main 미반영이면 직접 머지(118~122) | 직접 머지한다 | **머지하지 않는다.** 기점을 그 `head_sha` 로 잡고, §6-2 공통 규칙대로 claim 전에 그 기점으로 detach 한 뒤 claim 하고 스택 브랜치를 만든다. state.json 에 `branch_base` 와 `risk: "선행 main 미반영(팀장 머지 대기)"` 를 기록한다 |
| C | Phase 0 재개 판정의 approved 갈래(88~89) | 즉시 머지하고 종료한다 | **머지하지 않고** `.result` 를 `{TSK} {ID8} <branch> <head_sha> - needs-merge approved` 로 쓰고 종료한다 |
| D | 사람 판단이 필요한 분기(AskUserQuestion, `--only` 확인 194~196) | 지금처럼 묻는다 | **AskUserQuestion 을 쓰지 않는다.** 기본값이 있으면 택해 한 줄 남기고 진행하고, 없으면 `blocked`(§5 판단 규칙). 팀장은 `--only` 를 넘기지 않으므로 `--only` 확인은 워커 경로에 없다 |
| E | Phase 1~4 공통 프롬프트(156~159) | 지금 문구 그대로 | 공통 프롬프트에 "git 은 `command -v git` 이 돌려주는 절대경로로 호출한다(bare `git` 금지)" 한 줄을 덧붙인다. 오케스트레이터 자신도 같은 규칙을 따른다. 손자 서브에이전트까지 rtk 격리 가드 차단(§3-6)을 피하게 하기 위해서다 |

- 이 다섯 말고 기본 브랜치를 switch·pull·merge·push 하는 지점은 없다. agent 브랜치를 만들고 그 위에
  push 하는 Phase 0-3 과 Phase 5(`reported` 커밋 포함)는 워커에서도 그대로 돈다.
- 새로 만드는 "사람에게 묻기" 지점은 없다. dflow-dev 의 판단 실패는 이미 전부 "중단·보고"(push 훅
  거부, Verify 재시도 소진, 빨간 기준선)라서 워커에서는 `.result` 의 `failed <사유>` 로 떨어진다. 설계
  재량 분기만 판단 규칙(`blocked`)이 받는다.
- 인자 파싱과 위 다섯 분기만 워커용으로 갈린다. 게이트·Phase 정의·커밋 규칙·모델 배정
  (dev-discipline.md)은 워커에서도 같다.

### 6-4. `/dflow-merge` 수정

- **후보 식별(1번)**: 로컬 `docs/tasks/*/state.json` 의 `phase=reported`(현행 그대로)에 더해,
  `git fetch origin` 뒤 `git branch -r --list 'origin/agent/*'` 의 각 tip 에서 브랜치 이름의 id8 과
  `order` 가 일치하는 `docs/tasks/*/state.json` 을 읽어 **`phase` 가 `merged` 가 아니면 전부 후보**로
  본다. 로컬과 원격에 같은 작업이 있으면 order UUID 로 중복을 없앤다. 원격에만 있는 후보의 머지 대상은
  `origin/agent/<id8>-<slug>` 다. 이유: tip 의 phase 는 `reported` 커밋이 실패하면 `verify` 에 머물 수
  있으므로 기대지 않는다(§6-2). 판정은 서버 `show` 로만 하므로 넓게 잡아도 안전하다.
- **show 출력(1번·2번)**: jq 로 `.order.status` 와 마지막 `kind=completion` 리포트의 `review_action`·
  `review_note` 만 뽑는다. 스윕마다 spec 본문을 컨텍스트에 싣지 않기 위해서다. 조회가 실패한 후보(다른
  D'Flow 인스턴스의 주문 등)는 "건너뜀(조회 실패)" 로 보고하고, 승인 대기나 데이터 없음으로 뭉개지
  않는다.
- **반려 갈래(2번·6번)**: approved 가 아닌 후보 중 마지막 completion 리포트가 `review_action=reject`
  인 것은 "승인 대기" 가 아니라 "반려: 재작업 필요 (<review_note>)" 로 갈라 보고한다. dflow-dev
  Phase 0-가 2번과 같은 판정이다. 원격 후보는 state.json 이 agent 브랜치에만 있으므로 `phase=rejected`
  를 기록하지 않고 보고만 한다. 머지 대상 선정에는 영향이 없다.
- **판정·순서·머지(2~4번, 불변)**: `status=approved` 만, 조상 먼저, `--no-ff`, 훅 거부 시 우회 금지.
- **뒷정리(5번)**: `phase=merged` 커밋과 원격 agent 브랜치 삭제는 그대로 한다. 로컬 agent 브랜치 삭제가
  "checked out" 오류면 건너뛰고 보고한다. 다른 워크트리가 그 브랜치를 잡고 있을 수 있기 때문이다
  (§3-3).
- **수동 동작의 변화(개선)**:
  - 인자 없는 실행의 후보가 원격 `origin/agent/*` 까지 넓어진다. 다른 PC·세션·신원이 push 한 approved
    작업도 반영되며, approved 만 머지하므로 미승인 커밋은 섞이지 않는다. 이 확대는 의도한 결정이며
    가이드(`dflow-skills-guide.md`)에 한 줄 공지한다.
  - 반려가 "승인 대기" 에 묻히지 않는다.
  - 다른 워크트리가 잡은 브랜치 때문에 뒷정리가 중단되지 않는다.

## 7. 실패·질문·재기동

| 상황 | 팀원 | 팀장 |
|---|---|---|
| 선행 미충족·claim exit 4·공통 기점 없음 | `.result` 에 `skipped`, 종료 | 집계, 일시 제외 |
| spec 부재 | poll exit 0 처리에서 걸러진다. 새어 오면 `skipped` | 집계, 일시 제외 |
| `blocked`, pane | 커밋·push, 질문을 화면에 출력, `.result` 에 `blocked` 를 쓰고 그 세션에서 멈춘다(탭 유지) | 사람에게 묻지 않는다(자동 루프). "결정 필요: <질문>, 그 팀원 탭에서 답하라" 고 알린다(PushNotification 이 있으면 한 번). **그 슬롯은 blocked 팀원이 계속 잡으며 다른 작업에 재배정하지 않는다.** 사람이 탭에서 답하면 팀원이 같은 워크트리·브랜치에서 이어 간다(재spawn·재claim 없음) |
| `blocked`, 에이전트 팀 | 커밋·push, `.result` 에 `blocked`(질문·선택지 포함)를 쓰고 세션을 끝낸다 | 결과 처리 직후 `TaskStop` 으로 회수하고 슬롯을 해제한다. 질문을 사람에게 전달한다(PushNotification 이 있으면 한 번). 답이 오면 옛 워크트리를 먼저 정리한 뒤(고아 정리 규칙, 그 브랜치를 잡고 있으면 `already checked out` 이 나기 때문이다) 새 격리 워크트리로 워커를 다시 띄워 기존 agent 브랜치로 switch 하게 한다. 재claim 은 없다(이미 claimed 다). 사람의 답은 포인터 둘째 줄 `ANSWER=<한 줄>` 로 넘기고, 워커는 그것을 design.md 에 한 줄 남긴다 |
| `needs-merge` | `.result` 를 쓰고 종료 | 승인 스윕을 곧바로 한다 |
| `failed`(push 훅 거부·게이트 실패 등) | dflow-dev 규칙대로 중단, `.result` 에 `failed` | 집계, 영구 제외, 사유 보고, 차단기 계산. 자동 재시도는 없다 |
| `failed rate-limit` | `.result` 에 `failed rate-limit` | 제외하지 않는다. 차단기 계산에 넣는다(§4-6) |
| 결과 줄 없는 완료 알림(에이전트 팀) | 알 수 없음 | `suspect` 로 슬롯 유지. 두 TICK 연속 생존 증거가 변하지 않으면 `failed no-result`(§4-6) |
| 무응답(결과도 알림도 없음) | 알 수 없음 | 보고만 하고 슬롯을 유지한다. 두 TICK 연속 생존 증거가 없을 때만 자동 정리(§4-6) |
| 팀장 세션 소실, pane | 각 팀원은 자기 탭에서 계속 돈다 | 재기동하면 §4-4 2번 재구성이 살아 있는 팀원을 원래 슬롯 번호로 흡수하고, 있는 `.result` 를 처리한다. 살아 있는 팀원이 없는 워크트리는 고아 스캔을 거친다. 서버에 claimed 인데 워크트리도 팀원도 없는 id8 은 "재개 필요" 로 보고하고 영구 제외에 넣는다(자동 재착수 없음) |
| 팀장 세션 소실, 에이전트 팀 | 팀원이 팀장과 함께 죽는다. 진행 중이던 작업은 마지막 커밋·push 까지만 남는다 | 재기동 재구성은 살아 있는 팀원이 없다고 전제한다. 워크트리는 모두 고아 스캔을 거치고, claimed 작업은 "재개 필요" 로 보고해 영구 제외에 넣는다. 미커밋분 손실을 줄이는 것은 `/dflow-dev` 의 잦은 커밋 규칙과 `blocked` 전 커밋 규칙이다 |
| 컨텍스트 압축 | 영향 없음 | 매 기상 재구성(§4-2)이 슬롯 표를 되살리고, 세대 파일(§4-5)이 감시 루프 중복을 막는다 |

> **blocked 가 슬롯을 잡는지는 백엔드가 가른다.** 판정 기준은 하나다: 살아 있는 프로세스 둘이 같은
> `AGENT_ID` 로 heartbeat 를 보내면 안 된다(§9-1). 그러면 좌석표가 한 인물을 두 책상에 그리고 손 든
> 상태가 새 active 에 덮인다.
> - pane: blocked 팀원이 탭에 살아 있다. 슬롯을 재배정하면 위 충돌이 나므로 슬롯을 계속 잡는다. 비용은
>   blocked 동안 실효 병렬도가 주는 것이다(팀원 3에 blocked 2면 실효 1).
> - 에이전트 팀: blocked 팀원이 끝나고 팀장이 회수한다. 살아 있는 프로세스가 없어 충돌이 성립하지 않으므로
>   슬롯을 회수해도 안전하다. 좌석표에서는 좌석이 비고 질문이 팀장에게 쌓이는 모습이 된다.

동시에 도는 작업은 poll.sh 가 ready 로 걸러 준 독립 작업이라 서로 스택하지 않는다. 미승인 선행 위의
스택은 `/dflow-dev` 기존 규칙(선행 산출물 실재 확인 후 스택, risk 기록)대로 각 팀원이 한다.

## 8. 다중 신원·다중 PC 운영과 준비물

- **분할 키는 D'Flow 배정이다.** `poll.sh` 는 `list --scope assigned`(내게 배정된 작업)만 본다. 신원마다
  그 담당자의 PAT 를 `.env` `DFLOW_PATS` 첫 토큰으로 두면 각 팀장은 자기 배정분만 잡는다.
- **한 PC 에 여러 신원**: 각 신원이 자기 `.env`(자기 PAT)로 팀장을 띄운다. 서버 claim 이 잠금이라
  겹치지 않고, 좌석표는 `AGENT_ID = <신원>/w<slot>` 으로 구역을 나눈다.
- **같은 신원이 두 곳에서 띄워도** 서버 claim 이 잠금이다. 늦은 쪽은 exit 4 로 `skipped` 가 된다.
- **로컬 상태를 공유하지 않는다.** 슬롯 표·대기 큐·제외 목록·`~/.cache/dflow`·`~/.dflow/events.jsonl`·
  팀원 워크트리는 로컬이다. 공유되는 것은 서버 상태와 원격 `agent/*` 브랜치뿐이며, 승인 스윕이 원격
  기준으로 후보를 보는 이유가 이것이다(§6-4).
- **준비물**: 대상 리포 클론, `.env`(해당 담당자 PAT·`DFLOW_API_BASE`·`DFLOW_PROJECT_MAP`),
  `.claude/skills/dflow-*` 설치(dflow-kit 복사·커밋 또는 wbs-web 정본 심링크. 후자는 새 워크트리에 따라
  오지 않지만 워커 부트스트랩이 메운다, §3-15), 대화형 세션. 백엔드는 따로 준비하지 않는다. 이 목록은
  SKILL.md 의 전제 검사와 일치해야 한다.
- **권한 준비(에이전트 팀)**: 팀원은 팀장 세션의 권한 모드를 물려받는다(§3-7). 다음 순서로 대응한다.
  1. 리허설에서 사용자 기본 모드(auto)로 먼저 돌려, 거부되거나 확인 프롬프트가 뜬 명령을 기록한다.
  2. 킷 설치 때 대상 리포 `.claude/settings.json` 에 그 기록에 맞춘 정확한 allow 목록을 넣는다. git 은
     절대경로 형태(예 `Bash(/usr/bin/git *)`)로 적는다. 워커가 git 을 절대경로로 부르기 때문이다.
  3. 그래도 멈추면 팀장을 권한 확인 생략 모드로 띄운다. 팀원·Phase 서브에이전트까지 모든 명령을
     확인 없이 실행한다는 보안 결정이며, Orca pane 팀원은 원래 이 조건으로 뜬다.

  팀장 자신의 `git push`·`git worktree remove --force` 도 같은 영향을 받는다.

## 9. 가상 오피스(좌석표) 연동 계약

좌석표의 모델은 층=프로젝트, 구역=WP, 책상=작업 주문, 의자의 사람=그 주문을 잡은 에이전트다. 팀
스킬은 "사람이 책상을 옮겨 다니는" 모습이 되어야 하므로 아래를 계약으로 둔다. 서버·화면 쪽 구현은
좌석표 설계가 맡고, 이 절은 팀 스킬이 무엇을 어디에 남기는지만 정한다.

### 9-1. 팀원 식별자 `AGENT_ID`

- 형식: `<신원>/w<slot>`(예: `hong/w2`). `<신원>` 은 `dflow.sh me` 가 돌려주는 담당자 식별을 안전한
  슬러그로 바꾼 값이다. **작업이 아니라 슬롯에 붙는다.** 같은 슬롯이 다음 작업을 받으면 같은 식별자로
  다음 책상에 앉는다. 좌석표는 이 문자열의 해시로 캐릭터(머리·셔츠)를 정하므로 슬롯마다 일관된 인물이
  된다. 신원이 PC 당 하나가 아니므로 hostname 이 아니라 신원을 앞에 둔다.
- 팀장 자신은 `<신원>/lead`.
- 불변식: 살아 있는 팀원 둘이 같은 `AGENT_ID` 를 갖지 않는다. 슬롯 번호 발급(§4-2)과 blocked 슬롯
  점유(§7)가 이를 지킨다.
- 전달 경로: 팀원이 **워크트리 루트의 `.dflow-agent`** 에 한 줄로 쓴다(§5). 좌석표 S1 의 PostToolUse
  훅은 현재 브랜치 → state.json → order id 를 읽을 때 `git rev-parse --show-toplevel` 의 `.dflow-agent`
  가 있으면 그 값을 `heartbeat_agent` 로, 없으면 지금처럼 Phase 서브에이전트 이름을 보낸다. **이 파일
  규칙은 좌석표 S1 구현에 반영해 달라는 요청 사항이다.**
- `.dflow-agent` 는 워크트리 안에 있고 커밋하지 않는다. 훅은 팀원 프로세스의 cwd(워크트리)에서
  실행되므로 `.env` 심링크(§5)만 있으면 서버 heartbeat 경로가 그대로 동작한다.

### 9-2. 팀원이 남기는 신호

| 시점 | S1 이후(서버) |
|---|---|
| 착수(claim 직후) | 훅이 첫 도구 호출에서 heartbeat |
| Phase 진행 | 훅 heartbeat(60초 절제)와 dflow-dev 의 progress 25/60/85 |
| `blocked` 직전 | `dflow.sh heartbeat <id8> --phase blocked --note "<질문>"` 1회 |
| 완료·실패 | `done`/`failed` 보고(기존)와 `.result` 파일 |

팀원의 로컬 events.jsonl 기록(claim·blocked·result)은 좌석표 S1 이후로 미룬다. v1 에서 팀원이 남기는
신호는 `.result` 와 서버 보고뿐이고, 로컬 이벤트는 팀장의 `team.*`(§9-3)가 대신한다.

`blocked` 는 좌석표 상태 모델(active/stale/wait/rejected/ready/done/offline)에 없는 상태다. pane 팀원이
멈춰 대기하면 heartbeat 도 멈추므로, 마지막 `heartbeat_phase = blocked` 가 유지되어야 "손 든 사람" 으로
남는다. **좌석표에 `blocked`(담당자 결정 대기) 상태를 추가해 달라는 요청 사항이다.** 사람이 답을 주어
팀원이 다음 heartbeat 를 보내면 active 로 돌아간다.

### 9-3. 팀장이 남기는 신호

- `~/.dflow/events.jsonl` 에 좌석표 설계 §5-2 와 같은 스키마 `{ts, host, repo, tsk, order, phase, event,
  agent}` 로 append 한다. `agent` 는 `<신원>/lead` 다. 이벤트와 추가 필드는 다음과 같다.

  | 이벤트 | 추가 필드 |
  |---|---|
  | `team.start` | `backend`, `slots`, `until` |
  | `team.spawn` | `slot`, `id8`, `worktree`, `handle` |
  | `team.result` | `slot`, `id8`, `status` |
  | `team.blocked` | `slot`, `id8` |
  | `team.sweep` | `merged`, `waiting`, `rejected` |
  | `team.stop` | 없음 |

  기록은 `printf '%s\n' '<json>' >> ~/.dflow/events.jsonl` 한 줄이며 실패해도 진행을 막지 않는다.
  재구성(§4-2)이 `team.spawn`·`team.result` 를 보조 정본으로 읽는다.
- 좌석표의 STANDBY(감시 중) 표시는 poll.sh 존재를 서버에 알리는 계약이 아직 없다(좌석표 설계 §7 미결).
  그 계약이 생기면 팀장이 시작·poll 재기동·마감 시점에 `{host, agent: lead, slots, busy, until}` 을
  보내는 자리를 SKILL.md 에 표시해 둔다. 계약 전에는 `team.start`/`team.stop` 이 대체 근거다.

### 9-4. 좌석표에서 기대하는 모습

- 배정 순간 빈 책상(ready)에 슬롯 캐릭터가 앉아 active 가 된다.
- 완료하면 그 책상은 승인 대기(wait)로 바뀌고 캐릭터는 다음 책상으로 옮겨 간다.
- pane 의 `blocked` 는 캐릭터가 손을 든 채 책상에 남아 있고 "확인 필요" 띠에 질문이 뜬다. 에이전트
  팀의 `blocked` 는 좌석이 비고 질문이 팀장에게 모인다.
- 팀장은 층 헤더의 감시 표시(STANDBY)로 나타난다. 다른 신원의 팀장은 `<신원>` 이 다른 별개 표시다.

## 10. 파일 구성

```
.claude/skills/dflow-team/
├── SKILL.md                    # §4 절차. frontmatter 트리거: "/dflow-team", "팀으로 개발", "팀장 시작", "N건 동시 착수"
└── references/
    ├── worker-prompt.md        # §5 팀원 프롬프트 정본(치환 변수 포함)
    ├── backends.md             # 백엔드별(Orca·에이전트 팀) spawn·정리 명령 정본과 차이표(기상 신호·blocked·슬롯 점유·회수·git 호출). tmux 는 "v1 미지원" 한 줄만 둔다
    └── events.md               # §9-3 이벤트 이름·필드 표(좌석표 설계 §5-2 와 같은 스키마)
```
스크립트 파일은 새로 두지 않는다. `poll.sh`·`dflow.sh`·`orca` CLI 를 재사용하고, 감시 루프는 SKILL.md
에 적힌 셸 루프다. 킷 밖 경로(다른 리포·개인 디렉터리)는 references 에도 적지 않는다. 배포는
dflow-kit 의 `kit-build.sh` 대상 목록에 `dflow-team` 을 추가한다(별도 커밋).

## 11. 검증 (리허설)

스킬 문서는 vitest 대상이 아니다(보존 테스트와 문구 계약 테스트만 vitest 로 돈다). 동작은 스테이징
D'Flow 를 향한 리허설로 검증한다.

### 11-1. 적용 좌표와 순서

- **리허설은 머지 전에 한다.** 리허설 리포의 `.claude/skills/<s>` 심링크는 `feat/dflow-team` 워크트리의
  `.claude/skills/<s>` 를 가리킨다. 이유: 머지하는 순간 수정이 심링크로 모든 리포에 적용되므로(§3-16)
  리허설로 확인한 뒤에 퍼뜨린다.
- 순서: 에이전트 팀 A0 단독 실측(§11-3) → Orca 리허설(§11-4) → 에이전트 팀 리허설(§11-5) → 머지.
  A0 는 에이전트 팀 리허설의 첫 항목이며 팀장 루프를 돌리기 전에 단독으로 한다. Orca 와 무관하므로
  가장 먼저 해도 된다.
- **머지는 main 과 staging 둘 다 한다.** 머지 뒤 wbs-web 메인 체크아웃 작업트리에서
  `grep -- --worker .claude/skills/dflow-dev/SKILL.md` 로 반영을 확인한다. 이유: 대상 리포의 심링크가
  가리키는 메인 체크아웃이 어느 브랜치에 있든 같은 스킬이 적용되게 한다. 머지 직전에 보존 테스트의
  fixture 를 대상 브랜치에서 다시 떠서 돌린다(§6-1).
- 머지 때 인자 없는 `/dflow-merge` 후보 확대를 가이드에 한 줄 공지한다(§6-4).

### 11-2. 리허설 리포와 준비

- 사용 중인 mes-base 대신 **mes-base 새 클론**(예 `~/project/mes-base-rehearsal`)과 **스테이징 D'Flow
  프로젝트**를 쓴다. 전제 조건은 기본 브랜치 체크아웃과 clean 작업트리다. 이유: 사용 중인 체크아웃에는
  심사 중인 브랜치와 미커밋 state.json 이 있어 전제 검사와 합격 판정이 섞인다.
- 스킬은 `.claude/skills/<s>` 심링크로 설치하고(§11-1 좌표) `.gitignore` 는 고치지 않는다. 팀장 전제
  검사가 공유 `info/exclude` 에 `/.claude/skills` 를 넣는다(§4-4). 이 배포 형태는 mes-runlog 와 같아서
  "새 워크트리에 스킬이 없다" 경로를 리허설이 그대로 밟는다. `.env` 는 스테이징 값으로 채운다.
- 클론의 origin 은 실제 mes-base 원격이다. 그래서 리허설 작업은 승인하지 않고, 끝나면 리허설 agent
  브랜치를 원격에서 지운다. 승인하면 스윕이 리허설 코드를 실제 main 에 머지하기 때문이다. 원격에 이미
  있는 agent 브랜치(운영 D'Flow 주문)는 스윕 후보에 잡히지만 스테이징 PAT 로는 조회되지 않아 "건너뜀
  (조회 실패)" 로 보고된다. 스윕 관련 합격 기준은 리허설 작업 3건으로 판정한다.
- 스테이징 D'Flow 에 `agent` 태그가 붙고 담당자가 배정된 독립 ready 작업 3건을 만든다. 그중 1건의 spec
  에는 담당자 결정이 필요한 분기를 일부러 남긴다. 에이전트 팀 리허설에는 새로 3건을 만든다.
- 첫 실행은 사용자 기본 권한 모드(auto)로 하고, 거부되거나 프롬프트가 뜬 명령을 기록한다(§8 권한 준비).

### 11-3. A0: 에이전트 팀 완료 알림 실측 (단독, 가장 먼저)

팀장 루프 없이, 이름과 `isolation: "worktree"` 를 준 에이전트 팀 팀원 하나로 확인한다.
- (a) 팀원이 손자 서브에이전트를 실행하는 동안 팀장에게 완료 알림이 오는가. 오면 결과 줄 없는 알림이
  실제로 생기는 것이므로 `suspect` 방어(§4-6)가 필수임을 기록한다.
- (b) `blocked` 로 끝난 팀원이 idle 로 남는가. 남으면 `TaskStop` 회수(§4-6)가 필요함을 확인한다.
- (c) idle 팀원에게 SendMessage 로 답을 주면 같은 워크트리에서 이어 가는가. 되면 "blocked 재개를
  SendMessage 로 단순화" 를 후속 후보로 기록한다. v1 은 `ANSWER=` 재spawn 을 유지한다.

### 11-4. Orca 리허설 합격 기준

실행: Orca 에서 리허설 리포를 열고 `/dflow-team 2명 <2시간 뒤>`.

1. 첫 poll 에서 2건이 각자 `orca worktree create --agent claude` 로 spawn 되고, 3번째는 대기 큐에
   들어갔다가 먼저 빈 슬롯에 자동 배정된다.
2. 각 팀원이 자기 워크트리에서 `agent/<id8>-<slug>` 브랜치를 만들고 push 했으며, 원격 tip 의
   state.json 이 `reported` 다.
3. 팀장의 상주 체크아웃의 현재 브랜치와 작업트리가 실행 전후로 같다.
4. 서버에 각자 id8 로 `done` 이 기록됐고(`show`), 다른 주문은 건드리지 않았다.
5. 결정 분기 작업이 `blocked` 로 그 팀원 탭에서 멈추고, 사람이 그 탭에서 답을 주면 같은 워크트리·
   브랜치에서 이어 가 `done` 한다. 그동안 그 슬롯은 재배정되지 않는다.
6. done 처리 때 팀원 워크트리가 그 자리에서 `orca worktree rm` 으로 정리되고, agent 브랜치 3개는 원격에
   남는다. 특히 워크트리가 `agent/<id8>-<slug>` 로 switch 된 상태에서 `orca worktree rm` 이 깨끗이
   도는지 확인한다.
7. `/dflow-team` 을 다시 돌리면 승인 스윕이 리허설 원격 브랜치 3개를 후보로 잡는다(승인 전이므로
   "대기").
8. `~/.dflow/events.jsonl` 에 `team.start` → `team.spawn`×2 → `team.result` → `team.spawn`(3번째) →
   `team.blocked` → … → `team.stop` 순서가 남고, `team.spawn` 에 `id8`·`worktree`·`handle` 이 있다. 각
   워크트리 루트의 `.dflow-agent` 가 슬롯 식별자(`<신원>/w1`, `<신원>/w2`)이고, 3번째 작업의
   `.dflow-agent` 는 먼저 빈 슬롯의 값과 같다.
9. 각 팀원 워크트리의 `docs/tasks/<TSK>/.result` 한 줄의 status 가 서버·브랜치 상태와 맞는다.
10. 확인 항목: `orca worktree create --json` 결과에서 워크트리 id 의 JSON 경로, 워커가 `/dflow-dev` 를
    Skill 도구로 불렀는지 SKILL.md 직접 읽기 폴백을 탔는지.
11. 팀장 세션에서 컨텍스트 압축(`/compact`)을 한 번 일으킨 뒤에도 다음 기상에서 슬롯 표가 재구성되고,
    결과가 한 번만 처리된다.

### 11-5. 에이전트 팀 리허설 추가 기준

일반 터미널에서 새 작업 3건으로 `/dflow-team 2명 <2시간 뒤>` 를 돌린다. 시작 보고의 백엔드가
"에이전트 팀" 인지 본다. 합격 기준은 §11-4 와 같되 6번은 "done 처리 때 에이전트 팀 워크트리가 그
자리에서 정리된다" 로 읽는다. 추가로 확인할 것은 다음과 같다.

1. 팀원 둘이 서로 다른 링크드 워크트리를 받았고 팀장 체크아웃의 브랜치·워킹트리가 불변이다.
2. 워커와 Phase 서브에이전트가 `command -v git` 절대경로로 `/dflow-dev` 를 완주한다. rtk 차단 메시지가
   한 번이라도 나오면 그 지점을 기록하고, 워커 프롬프트와 행 E 의 경로를 리터럴 `/usr/bin/git` 으로
   바꿔 다시 돌린다. 그래도 막히면 rtk 훅 수정을 사람에게 보고한다.
3. `blocked` 작업에서 팀원이 끝나고, `TaskStop` 으로 회수되고, 슬롯이 해제돼 다음 작업이 들어간다.
4. `blocked` 에 답한 뒤 재spawn 된 워커가 `ANSWER` 를 design.md 에 남기고 같은 agent 브랜치 위에서
   이어 간다.
5. 팀원 종료 뒤 워크트리가 자동 정리됐는지 보존됐는지, `.result` 를 파일과 마지막 응답 중 어디서
   읽었는지 기록한다.
6. 팀장 세션을 의도적으로 끝내면 팀원도 멈추고, 재기동 시 고아 스캔과 "재개 필요" 보고가 나온다.
7. 권한: auto 모드에서 거부·프롬프트가 난 명령 목록을 기록한다(§8 권한 준비 1번).

- 다중 신원은 같은 PC 에서 세션 두 개를 같은 PAT 로 띄워 exit 4 분기만 확인한다. 실제 두 신원·두 PC 는
  2차 리허설에서 한다.
- 실패 시: 팀원 transcript(Orca `terminal read`)와 `dflow.sh show` 로 원인을 확정하고 프롬프트를 고친다.
  서버 쓰기 오류가 있으면 스테이징에서 주문을 release 해 되돌린다.

## 12. 잔여 위험과 후속

- **캐시 공유**: 팀원의 `show` 가 id8 을 접두 해석하는 순간 팀장의 `list` 가 `last-list.json` 을 덮을 수
  있다. `known-ids.txt` 누적 맵이 폴백이고, 팀원은 `list` 를 부르지 않는다. 접두 해석이 실패하면 팀원은
  `failed` 로 끝나고 사람이 재개한다. poll.sh 출력에 전체 UUID 를 넣으면 근본 해결이지만 필요성이 낮아
  보류한다.
- **스킬 수정이 심링크로 모든 리포에 즉시 적용된다**(§3-16). 방어선은 수동 비퇴행 원칙과 보존 테스트
  (§6-1), 머지 전 리허설(§11-1)이다. 옛 버전은 팀장 전제 검사(§4-4)와 워커의 `failed no-worker-flag`
  (§5)가 막는다.
- **적용 좌표가 메인 체크아웃의 현재 브랜치다**(§3-16). 실행 중에 다른 세션이 메인 체크아웃을 switch
  하면 포인터의 절대경로 `worker-prompt.md` 가 바뀌거나 사라질 수 있다. 후속: 심링크 좌표를
  `origin/main` 을 추적하는 전용 고정 워크트리로 옮기는 방안을 검토한다.
- **에이전트 팀의 권한 대기는 조용하다**(§3-7). 무응답 보고(§4-6)가 사람을 부르지만 30분 단위다. §8 의
  권한 준비가 1차 방어선이다.
- **에이전트 팀의 "턴 종료 = 완료" 는 미실측이다**(§3-8). `suspect` 방어가 오판을 막지만, 알림이
  자주 오면 TICK 마다 생존 증거를 재는 비용이 든다. A0(§11-3)에서 확인한다.
- **rtk 가 일부 git 을 막는다**(§3-6). `/dflow-dev` 본문에 박힌 bare `git` 예시를 LLM 이 매번
  절대경로로 바꿔 부르는지는 리허설에서 확인한다(§11-5 2번). 근본 해결은 rtk 훅 수정이다.
- **승인 반영 지연**: 팀장 체크아웃에서는 poll exit 9·10 이 팀원 작업에 울리지 않으므로(§3-14) 승인
  반영이 최대 30분 늦을 수 있다. 팀원 작업의 반려는 `/dflow-merge` 의 반려 갈래(§6-4)가 잡는다.
- **수동 경로의 로컬 감지 한계**: `reported` 가 커밋되면(§6-2) 다른 브랜치로 옮긴 뒤 poll exit 9 와
  `/dflow-dev` Phase 0-가 는 그 작업을 보지 못한다. 그 작업은 원격 후보를 보는 `/dflow-merge` 로
  반영한다.
- **일시 제외 재검사 비용**: 선행 사유로 일시 제외된 작업은 30분마다 다시 발견되고, 여전히 막혀 있으면
  팀원 하나를 띄워 claim 단계에서 `skipped` 로 끝난다. 착수 판정을 팀장이 미리 하지 않으므로 그만큼의
  spawn 비용이 든다.
- **새 워크트리의 스킬 부재**(§3-15): 부트스트랩의 심링크와 SKILL.md 직접 읽기 폴백으로 메우지만,
  폴백 경로에서는 스킬 로딩에 딸린 부가 동작(있다면)이 빠진다. 리허설이 폴백 경로를 한 번 밟는다.
- **에이전트 팀 팀원은 팀장과 운명을 같이한다.** 팀장 세션이 죽으면 팀원도 죽어 미커밋분을 잃는다.
  잦은 커밋과 `blocked` 전 커밋 규칙이 손실을 줄이지만 없애지는 못한다. 장시간 운전에는 pane 백엔드가
  더 안전하다.
- **Orca 워크트리 누수**: 팀원이 커밋 전에 죽으면 변경 있는 워크트리가 남는다. 고아 스캔(§4-2)이 경로와
  미커밋 목록을 보고하며, 자동으로 지우지 않는다.
- **좌석표 의존**: `.dflow-agent` 규칙과 `blocked` 상태는 좌석표 S1·S2 가 받아 줘야 화면에 나온다. 그
  전까지 팀 스킬은 events.jsonl 과 `.result` 로만 검증되며, 화면에는 팀원이 Phase 서브에이전트 이름으로
  보인다.
- **토큰 비용**: 슬롯 N개마다 독립 메인 에이전트와 그 안의 Phase 서브에이전트가 돈다. 하드 상한 4 와
  차단기(§4-6)가 소모를 묶는다.
- **blocked 가 슬롯을 잡는 비용(pane 한정)**: blocked 팀원이 답을 받을 때까지 슬롯을 점유하므로 그만큼
  실효 병렬도가 준다. 담당자가 자리를 비운 시간대에는 blocked 가 쌓여 루프가 사실상 멈출 수 있다.
  에이전트 팀은 이 비용이 없는 대신 질문이 팀장에게 쌓이고 그 작업만 진척되지 않는다.
- **blocked 를 사람에게 알리는 경로는 PushNotification 하나다.** 이 도구가 없는 하네스에서는
  events.jsonl 과 화면 통지뿐이라, 터미널을 보고 있지 않으면 팀 전체가 조용히 멈춘 것을 모른다.
  "N분간 진척 없음" 통지는 v1 에 넣지 않는다.
- **후속**: tmux pane 백엔드(dev-plugin 로드 실패 수정 뒤), 심링크 고정 워크트리(위), SendMessage 기반
  blocked 재개(A0 (c) 결과에 따라), 실제 두 신원·두 PC 리허설.
