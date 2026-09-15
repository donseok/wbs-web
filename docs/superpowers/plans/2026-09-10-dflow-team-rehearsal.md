# /dflow-team 리허설 판정

스펙 §11 합격 기준의 판정표다. 확인된 사실은 스펙 §3·§8·§12·§13 에 사실로 옮기고, 이 파일에는 판정과 관찰만
둔다. Orca 리허설(Task 8)과 프로세스 백엔드 리허설(Task 9)은 `~/project/mes-base-rehearsal`(mes-base 새
클론, 2단계에서는 두 번째 클론 `~/project/mes-base-rehearsal2` 도 추가)과 원격
`~/project/mes-base-rehearsal.git`(버리는 bare)를 쓴다. D'Flow 는 스테이징 리허설 프로젝트(전용 PAT),
스킬은 `feat/dflow-team` 워크트리 심링크다. Task 9 의 리드 세션은 진짜 tmux(`-L task9`) 다.

## A0: 에이전트 팀 실측 (스펙 §11-3)

| 항목 | 판정 | 관찰 |
|---|---|---|
| (a) 손자 실행 중 팀장에게 완료 알림이 오는가 | 확인됨 | 팀원이 손자 서브에이전트를 띄우면 손자가 도는 동안 팀장에게 결과 줄 없는 `completed` 알림이 온다. Agent 도구는 백그라운드 전용이라 팀원이 손자를 동기로 기다릴 수 없고, 기다리려면 턴을 끝내야 한다. 그 순간 팀원의 격리 워크트리가 깨끗하면 하네스가 워크트리를 지운다 |
| (b) blocked 로 끝난 팀원이 idle 로 남는가 | 확인됨 | 끝난 팀원은 ListAgents 에 `completed` 로 남고, 그 이름으로 TaskStop 하면 `Task <이름> is not running (status: completed)` 또는 `No task found with ID: <이름>. Running named agents: …` 오류가 온다. 둘 다 "이미 회수됨" 이다. `blocked` 로 끝난 팀원도 같다 |
| (c) idle 팀원에게 SendMessage 로 답하면 같은 워크트리에서 이어 가는가 | 부정 | 끝난 팀원에게 SendMessage 로 답하면 "Resuming agent" 로 이어지지만, 격리 워크트리가 이미 지워져 cwd 가 리포 루트로 돌아간 채 이어진다. 같은 워크트리에서 이어 가지 않는다. 채택하지 않음, `ANSWER=` 재spawn 유지 |
| (d) 팀원 안에서 `dflow.sh done --auto-links` 가 성공하는가 | 통과 | 팀원 안에서 `dflow.sh claim`·`done --auto-links`·`list` 가 성공한다. dflow.sh 내부의 git 호출은 Bash 명령 문자열이 아니라 rtk 훅과 격리 가드를 거치지 않는다. 소싱 접두는 가드가 거부. dflow.sh 자동 로드로 해결. `DFLOW_GIT` 불필요 |
| (e) 팀원을 TaskStop 하면 손자 서브에이전트까지 거둬지는가 | 확인됨(손자는 거둬지지 않는다) | 팀원이 띄운 서브에이전트는 팀원이 끝나거나 TaskStop 돼도 살아남아, 팀장의 ListAgents 에 자기 이름으로 `running` 상태로 나타난다. 팀장이 그 이름으로 TaskStop 하면 멈추고 그 안에서 돌던 Bash 자식 프로세스도 죽는다. 회수·마감은 팀원을 멈춘 뒤 ListAgents 를 다시 봐야 한다 |
| (f) 사용량 한도에 걸린 팀원이 무엇을 남기는가 | 미관찰 | 사용량 한도 상황은 관찰되지 않았다 |

이 여섯 항목 중 (a)·(e)는 Task 9 1단계(에이전트 팀 백엔드)에서 결함 C·E 로 재확인됐고, 팀원을 서브에이전트가
아닌 별도 프로세스로 띄우는 결정(§3-1)의 근거가 됐다.

### A0 실행 조건

헤드리스 `claude -p … --permission-mode bypassPermissions --model sonnet` 로 여섯 번(A0-1·2·3b·4·5, 3 은
무효) 돌렸다. 자동 승인이라 권한 확인 동작(스펙 §3-7)은 확인되지 않았으며 Task 9 에서 본다. 리허설 리포는
`~/project/mes-base-rehearsal`, 스테이징 프로젝트를 썼고, 주문 `eccb75b2` 가 reported 로 끝났다. 실측일
2026-09-14.

좌석표는 `wbs_items.tags` 에 `agent` 가 든 항목의 주문만 보여 주므로, Task 8·9 리허설에서 좌석표를
확인하려면 대상 항목의 에이전트 위임(agent 태그)을 켜 두어야 한다. A0 주문은 태그가 없어 좌석표에 보이지
않은 것이 정상이다. Task 8·9 확인 항목: claim→blocked 경로가 좌석표에 실제로 보이는지.

### 격리 가드 관찰

관찰이며, 정본 규칙은 스펙 §3-6 과 `backends.md` 에 있다.

| 형태 | 판정 |
|---|---|
| bare `git`(rtk 훅이 `rtk git` 으로 재작성한다. 어떤 서브커맨드가 재작성되는지는 rtk 버전에 달려 있어 전부 금지한다) | 거부 |
| `$(command -v git)`·`"$GIT"` 같은 치환·변수 경로 | 거부 |
| git 을 감싼 명령 치환(`x=$(… git …)`, `_gd=$(cd "$(git rev-parse --git-dir)" && pwd -P)`) | 거부 |
| `-C` 로 워크트리 밖을 가리키는 호출 | 거부 |
| `. ./.env` 소싱, `while read … export`, `env $(…)` | 거부 |
| `command -v git` 단독 실행 | 허용 |
| 글자 그대로 적은 절대경로 git(status·log·diff·rev-parse·fetch·branch·switch·commit·push·add·reset) | 허용 |
| git 이 없는 명령 치환 | 허용 |
| 접두 없는 dflow.sh 호출 | 허용 |
| 인라인 대입(`DFLOW_ENV_FILE=/abs/.env dflow.sh …`) | 허용 |
| find·mkdir·ln·printf·npm·jq·perl·`sleep` | 허용 |

## Orca 백엔드 리허설 (Task 8)

실행: Orca 에서 리허설 리포 루트의 `claude`(팀장 세션은 권한 확인 생략 모드로 떠 있었다) → `/dflow-team
15:57`(인원 생략, 기본 3). 사용자가 코드 작업 탭에서 blocked 질문에 "A" 로 답하고, 팀장 창에서 `/compact`
한 번, 14:39 에 "마감해". 이벤트 원본은 `~/.dflow/events.jsonl`(당일 `team.*` 19줄), 팀장 터미널은 Orca
`term_660451eb…`.

실행 전후: 브랜치 `main`(3ea44a8), `git status --porcelain` 빈 출력이 실행 전과 14:39 마감 뒤 모두 같다.
로컬 브랜치는 `agent/255843fc-r8-doc`·`agent/2aa67227-readme-rehearsal`·`agent/6cce7248-r8-code-mul` 3개가
늘었고, 생성 브랜치 `dflow-<id8>` 는 정리 뒤 남지 않는다. 권한 프롬프트는 팀장 세션이 권한 확인 생략
모드였던 탓에 한 번도 뜨지 않았다(기본 권한 모드 측정은 Task 9).

| 항목 | 판정 | 관찰 |
|---|---|---|
| 1. 첫 poll 이 4건, 3건 spawn, 1건 대기 후 빈 슬롯 배정 | 확인됨 | 14:00:55 `team.spawn` ×3(slot 1·2·3, worktree `<repo>/dflow-<id8>`, handle `term_…`). 14:14:36 slot 3 결과 뒤 14:14:38 e8d638b8 가 slot 3 에 spawn |
| 2. agent 브랜치 push, 원격 tip state.json reported·api_base 스테이징 | 확인됨 | bare 에 `agent/255843fc-r8-doc`(88c3e2b)·`agent/2aa67227-readme-rehearsal`(15615ec)·`agent/6cce7248-r8-code-mul`(4b3cd3f). 세 tip 의 `docs/tasks/<TSK>/state.json` 모두 phase=reported, api_base=https://dflow-staging.vercel.app |
| 3. 팀장 체크아웃 브랜치·작업트리 불변 | 확인됨 | 실행 전후 main 3ea44a8, `git status --porcelain` 빈 출력 |
| 4. 서버 show reported, 다른 주문 불변 | 확인됨 | 6cce7248·255843fc·2aa67227 reported, e8d638b8 ready(skipped 뒤 복귀), eccb75b2(A0) reported 그대로 |
| 5. blocked 로 탭에서 멈춤 → 답 뒤 같은 워크트리·브랜치에서 done, 슬롯 재배정 없음 | 확인됨 | 14:07:14 `team.blocked`(hash 940276792, 질문 원문). "A" 답변 → 설계 문서에 결정 기록 커밋(9924929) → 같은 브랜치에서 Build·Verify → 14:20 done(4b3cd3f). 그 사이 slot 1 에 spawn 없음 |
| 6. done 때 `orca worktree rm` 정리, agent 브랜치 3개 bare 보존, 생성 브랜치 정리, skipped 재등장 시 충돌 없음 | 확인됨 / 재등장은 미관찰 | 워크트리 4개(dflow-6cce7248·255843fc·2aa67227·e8d638b8) 모두 삭제, Orca 목록에 main 만 남음. 생성 브랜치 이름은 `dflow-<id8>`(`orca worktree create --name`)이며 정리 뒤 남지 않는다. 머지 안 된 로컬 `agent/*` 3개 보존. e8d638b8 은 14:17 skipped 뒤 30분 제외라 14:47 재등장 예정이었으나 14:39 마감으로 미관찰 |
| 7. 재실행 시 승인 스윕이 원격 3건 "대기", 옛 브랜치 "건너뜀(다른 D'Flow)" | 확인됨(같은 실행의 스윕으로) | 14:23·14:30·14:39(final) `team.sweep`: waiting 3(255843fc·2aa67227·6cce7248), skipped 4(4bd9acd5·6b3ea02e·a0d9af7c·da3fd3a4) skip_reason "다른 D'Flow(api_base 없음)". 별도 재실행은 하지 않았다 |
| 8. events.jsonl 순서·필드, `.dflow-agent` 슬롯값 | 확인됨(결함 A 동반) | 순서 start → sweep → spawn×3 → blocked → sweep → result(2aa67227) → spawn(e8d638b8) → sweep → result(255843fc) → sweep → result(e8d638b8 skipped) → sweep → result(6cce7248) → sweep×3 → stop. spawn 에 id8·worktree·handle·slot, result·blocked 에 hash·reason. `.dflow-agent` = `<신원>/<host>/w1·w2·w3`, e8d638b8 는 w3(먼저 빈 슬롯). `/compact` 직후 기록한 2줄(14:20 result, 14:23 sweep)이 ts·host·repo·event·agent null 로 쓰였다(결함 A) |
| 9. `.result` status 가 서버·브랜치와 일치 | 확인됨 | 6cce7248 `.result` "… 4b3cd3f 0 done …" = 서버 reported·bare tip 4b3cd3f. 255843fc·2aa67227 는 team.result(status done, hash) 와 서버·bare 가 일치 |
| 10. agentTerminalHandle 유무 / /dflow-dev 호출 방식 / poll exit 9·10 없음 | 확인됨 / 미관찰 / 확인됨 | `team.spawn` 의 handle 이 `term_…` 로 채워져 화면 읽기 가능. 워커가 Skill 도구로 불렀는지 SKILL.md 직접 읽기 폴백을 탔는지는 transcript 를 보지 않아 미관찰. poll(PID 10509)은 실행 내내 생존, approved 0, exit 9·10 없음 |
| 11. `/compact` 뒤 슬롯 표 재구성, 결과 중복 처리 없음 | 부정(부분) | 압축 뒤 14:20·14:29 기상에서 슬롯 표를 다시 만들고 6cce7248 결과를 한 번만 처리(같은 hash 두 번 없음)했으나, 압축 직후 이벤트 2줄을 null 필드로 기록해 events.md 의 명령을 그대로 쓰지 않았다(결함 A) |
| 12. 코드 워커가 `npm ci` 뒤 기준선·Build·Verify·Refactor 를 `npm test` 로 통과 | 확인됨(npm ci 는 미관찰) | 워커 보고: 기준선 테스트 1건 통과, 최종 테스트 7건 통과, 변이 검증 6종 빨강 확인. npm ci 실행 여부는 화면에서 직접 못 봄 |
| S. 좌석표에 claim→blocked 경로가 보였는가 | 미관찰 | 리허설 리포의 dflow.sh 가 feat 워크트리 것이라 `heartbeat` 서브커맨드가 없어 서버 heartbeat 필드가 전부 null. Task 10 머지 뒤 재확인 대상 |

### 결함 (feat/dflow-team `da4a1601` 로 수정)

- **A. 압축 뒤 이벤트 기록 필드 누락.** `/compact` 뒤 팀장이 `team.result`·`team.sweep` 2줄을
  ts·host·repo·event·agent = null 로 기록했다(백업 `~/.dflow/events.jsonl.bak.1789363406` 에 원문).
  events.md 의 기록 명령은 ts·host 를 그 자리에서 계산하므로, 팀장이 압축 뒤 문서를 다시 읽지 않고
  기억으로 명령을 재구성한 것이 원인이다. 조치: SKILL.md 「2-3」 기상 절차 첫머리에
  이벤트 기록은 events.md 의 명령 블록을 그 자리에서 다시 읽어 그대로 쓴다는 규칙을 넣고, events.md 기록
  명령 끝에 공통 다섯 필드(ts·host·repo·event·agent)가 비면 줄을 붙이지 않고 `EVENT_ARGS_MISSING` 을 내는
  jq 가드를 붙였다. 빈 ts·빈 event 는 거부되고 정상 값은 한 줄만 붙는 것을 직접 돌려 확인했다. 이 가드는
  Task 9 리허설에서 공통 다섯 필드 누락은 막았으나 이벤트별 추가 필드 누락은 새로 드러났다(결함 F).
- **B. 재개 필요 목록이 reported 주문을 포함.** 시작·마감의 "재개 필요" 가 `dflow.sh list --scope claimed`
  결과에서 상태 열을 보지 않고 id8 만 뽑아, 서버 reported 인 A0 주문 eccb75b2 를 "재개 필요(수동
  /dflow-dev)" 로 보고했다. `--scope claimed` 는 RP(reported) 행도 돌려준다. 조치: 재개 필요 목록을
  `awk -F'\t' 'NF>=4 && $2=="CL" {print $4}'` 로 좁히고, RP 행은 승인 대기이지 재개 대상이 아니라는 이유를
  적었다. `team.stop` 의 `resume_needed` 도 같은 계산을 쓴다.

## 프로세스 백엔드 리허설 (Task 9)

**에이전트 팀 백엔드 1단계**(인원 3, sonnet, 진짜 tmux 리드): 팀원을 Agent 도구 서브에이전트로 띄워 세
작업을 병렬 진행시켰다. 12항·추가 7항 대부분은 확인됨이었으나, 결함 C(Phase 손자를 띄운 뒤 턴을 끝낸
팀원이 손자 완료로 재개되지 않아 w1·w3 가 15:37 에서 멈춘 채 남음)와 결함 E(팀원이 자기 손자를 TaskStop
하지 못하고 "owned by main session" 으로 거부됨)가 나와, 이 백엔드를 프로세스 백엔드로 교체했다(§3-1 결정
근거). auto 모드 권한 확인 프롬프트·거부는 이 단계 동안 0건이었다. 판정표 전문은
`~/project/mes-base-rehearsal-task9-observations.md` 에 있다.

**프로세스 백엔드 재실행 1단계**(인원 3, 리드·팀원 sonnet, 손자 sonnet·haiku, tmux 리드 `task9b`):

| 항목 | 판정 | 관찰 |
|---|---|---|
| 1. 첫 poll ready 4건, 3건 spawn(프로세스, `dflow-<id8>`), 1건 대기 후 빈 슬롯 배정 | 확인됨 | 16:49:07 spawn×3(pid 15277·15689·16146), 대기 2926fc08 → 슬롯1 해제 직후 16:51:36 배정 |
| 2. 팀원마다 `agent/<id8>-<slug>` push, 원격 tip phase=reported, api_base 스테이징 | 확인됨(2/3) | r10-misc 8d12d89·r10-doc fe21239 reported. r10-code 는 네트워크 장애로 unpushed(a86442a, 원격 c54f568) |
| 3. 팀장 체크아웃 브랜치·작업트리 실행 전후 동일 | 확인됨 | main 3ea44a8 깨끗함(시작·마감) |
| 4. 서버 `show` 각 id8 reported, 다른 주문 변화 없음 | 확인됨(부분) | r10-misc·r10-doc reported, r10-after-doc ready 복귀, r10-code claimed(장애). 다른 주문 변화 없음 |
| 5. blocked → 답 → 재spawn 같은 agent 브랜치 → done, 답 전 재배정 없음 | 부분 | blocked(16:55)·답(16:56)·재spawn(16:58, 같은 브랜치) 확인, 답 전 재배정 없음. done 은 네트워크 장애로 미도달(Verify 완료 커밋까지) |
| 6. done 때 `git worktree remove --force`, 생성 브랜치 없음(`--detach`), skipped 재등장 충돌 없음 | 확인됨 | detached 워크트리, HEAD=origin tip 확인 뒤 즉시 정리, 생성 브랜치 없음. skipped 재등장은 2단계에서 확인 |
| 7. 승인 스윕: 원격 브랜치 "대기", 옛 브랜치 "건너뜀(다른 D'Flow)" | 확인됨 | 대기 6→7→8(R8·R9·R10 전부 이 스테이징), 다른 D'Flow 건너뜀 4건, merged 0 |
| 8. events.jsonl 순서·필드 | 부분(결함 F) | 압축 전: start → spawn×3 → result skipped → spawn → blocked → sweep → answer → result done → spawn(재) → sweep. spawn 에 id8·worktree·handle `pid:<PID>`, result·blocked 에 hash·reason. 압축 뒤 3건(result done·result failed·stop)은 slot·order·phase·worktree·hash 없음 |
| 9. 각 워크트리 `.result` status 가 서버·브랜치와 일치 | 확인됨 | r10-misc·r10-doc done ↔ reported ↔ 원격 phase=reported. r10-code `.result` 없음 ↔ claimed |
| 10. 워커의 /dflow-dev 호출 방식, poll exit 9·10 없음 | 확인됨 | 팀원이 Skill 도구로 `dflow-dev <id8> --worker --model sonnet` 호출(팀장이 만든 스킬 링크). poll 정상 |
| 11. `/compact` 뒤 슬롯 표 재구성, 결과 중복 없음, 이벤트 공통 필드 | 부정(부분) | 재구성·중복 없음은 확인. 압축 뒤 이벤트에 `order`·`phase`·`slot`·`worktree`·`hash` 누락(결함 F) |
| 12. r10-code 워커 `npm ci` 뒤 기준선·Build·Verify 를 `npm test` 로 통과 | 확인됨 | feat·build 완료, verify 완료(Refactor 진입 중 네트워크 장애) |
| 추가 1. 팀원 셋이 서로 다른 링크드 워크트리, 팀장 체크아웃 불변 | 확인됨 | `.claude/worktrees/dflow-<id8>` 셋(detached), 팀장 main 불변 |
| 추가 2. 워커·손자가 git 절대경로로 완주, rtk 차단 없음 | 미관찰(간접 확인) | 전용 확인은 하지 않았으나 두 작업 완주로 간접 확인 |
| 추가 3. blocked 팀원 프로세스 종료 → 워크트리 정리/parked → 슬롯 해제 → 다음 작업 | 확인됨 | `.result` 쓰고 자진 종료 → HEAD=origin tip 이라 정리 → 슬롯 해제 → 재spawn |
| 추가 4. 재spawn 워커가 ANSWER 를 design.md 에 남기고 같은 브랜치에서 이어 감, node_modules 생성, 127 없음 | 확인됨 | design.md 첫 줄에 담당자 결정 기록, switch 로 같은 브랜치, node_modules 설치, 게이트 127 없음 |
| 추가 5. 워크트리 자동 정리/보존, `.result` 읽은 곳 | 확인됨(부분) | `.result` 는 파일(`RESULT_READY`)로 읽음. done 은 정리, unpushed 는 보존했으나 parked 표시 누락(결함 F 연관) |
| 추가 6. 리드 종료 뒤 팀원 생존, 재기동 흡수 | 미관찰 | 2단계에서 확인 |
| 추가 7. auto 모드에서 거부·프롬프트 명령 목록 | 확인됨(0건) | 프롬프트 0건. API 불통 중에는 auto 모드가 Bash 판정 자체를 못 해 명령이 막혔다(네트워크 장애와 별개 현상) |
| 다중 신원 a·b | 미관찰 | 2단계에서 확인 |
| 시작 보고의 재개 필요 목록에 reported 주문 없음(결함 B 수정 확인) | 확인됨 | "재개할 작업은 없었다"(reported 8건은 승인 대기로만 보고) |
| 좌석표 claim→blocked | 미관찰 | 스테이징에 좌석표 테이블·`watch` 하위 명령이 아직 없다 |
| `PROC_DEAD` → `.result` → 로그 폴백 → `failed no-result` 즉시, 재개 필요 보고 | 확인됨 | 네트워크 장애로 팀원이 죽은 뒤 대기 없이 즉시 판정. 워크트리 보존·재개 필요 보고(parked 표시는 누락, 결함 F) |
| 마감(poll 오류 exit): `team.stop`, 잠금 해제, 루프 종료, 남은 에이전트 없음 | 확인됨 | 잠금 소유 확인 뒤 해제, 팀원 프로세스는 별도라 ListAgents 에 없음 |

**프로세스 백엔드 2단계**(다중 신원·LOCKED·리드 강제 종료, 인원 1, sonnet):

| 항목 | 판정 | 관찰 |
|---|---|---|
| 다중 신원 a. 두 클론 팀장이 같은 ready 1건을 두고 경쟁, 늦은 쪽 skipped | 확인됨(부분) | 먼저 claim 한 팀원이 완주, 나중 팀원(대기 큐에서 spawn)은 서버 확인 뒤 skipped. `claim exit 4` 경로 자체는 밟지 않았다(워커가 사전 확인으로 중단) |
| 다중 신원 b. 같은 체크아웃의 두 번째 팀장은 LOCKED | 확인됨 | 소유자 PID·beat 확인 뒤 거부, spawn 없음, 안내 출력 |
| 추가 6. 리드 종료 뒤 팀원 생존 → 재기동 LOCKED → 잠금 삭제 → 재구성 흡수 | 확인됨 | 리드 강제 종료(Ctrl+C) 뒤 팀원 프로세스 생존, 재기동이 LOCKED 확인 후 잠금 해제, 재구성이 슬롯을 흡수, 흡수한 팀원의 done 을 새 리드가 정상 처리 |
| 6. skipped 재등장 시 충돌 없음 | 확인됨 | 선행 미승인 작업이 재실행마다 skipped 로 재등장, 부트스트랩 실패 정리 규칙으로 즉시 정리, 생성 브랜치 없음 |
| 고아 스캔: 죽은 팀원 워크트리 보존·재개 필요 보고 | 확인됨(결함 G) | 네트워크 장애로 죽은 팀원의 워크트리를 세 리드 모두 보존·재개 필요 보고했으나, `.dflow-agent` 를 `parked` 로 바꾸는 규칙이 당시 backends.md 「고아 정리 규칙」 3번에 없어 값이 `w1` 그대로 남았다 |
| 마감(사람 요청) | 확인됨 | 두 리드 `team.stop`·잠금 해제·팀원 워크트리 정리·잔여 프로세스 없음 |
| 이벤트 필드(압축 없는 리드) | 확인됨 | 2단계 이벤트 전부 slot·id8·worktree·hash·reason 포함(결함 F 는 압축 뒤에만 재현) |

### 결함

**C·D·E** (수정은 프로세스 백엔드 전환에 포함, 43dd5fc4)

- **C. 서브에이전트 팀원 미재개.** 팀원이 Phase 손자를 Agent 도구로 띄운 뒤 턴을 끝내면 하네스가 팀원을
  완료로 보고, 손자 완료가 팀원을 깨우지 않는다. 자동 복구 수단이 없어 사람이 SendMessage 로 재개시키지
  않으면 무응답 자동 정리(두 TICK)까지 슬롯이 죽은 채 남는다. 근본 대책: 팀원을 서브에이전트가 아닌 독립
  프로세스로 띄운다(프로세스 백엔드).
- **D. 답 뒤 재spawn 의 `team.spawn` 누락.** ANSWER 재spawn 뒤 이벤트를 남기지 않았다(압축 뒤 자가 보충으로
  발견). 조치: 「6. blocked」 재spawn 절차에 「5. 팀원 spawn」 6번의 `team.spawn` 기록을 포함한다고 명시한다.
- **E. 손자 회수 권한.** 팀원이 자기 손자를 TaskStop 하지 못한다("owned by main session" 거부). 프로세스
  백엔드에서는 손자가 팀원 프로세스의 서브에이전트라 팀원이 직접 멈출 수 있어 사라진다.

**F·G** (수정, `e401cece`)

- **F. 압축 뒤 이벤트 필드 누락(결함 A 의 재발, 확장판).** 압축 뒤 리드가 events.md 를 다시 읽지 않고
  기억으로 jq 를 짜서 기록했다. 증상 셋: (1) `team.result`·`team.stop` 에 `slot`·`order`·`phase`·
  `worktree`·`hash`·`reason` 누락(공통 다섯 필드는 있어 결함 A 의 가드는 통과하지만 재구성의 경로별 처리
  해시·슬롯 복원 재료가 없다), (2) `failed no-result` 의 unpushed 워크트리에 `parked` 표시 누락(고아 정리
  규칙 미재독), (3) `host` 값이 대소문자 슬러그가 아니라 원문 그대로 기록됨. 조치: (1) SKILL.md 「2-3」
  기상 블록의 마지막 명령이 `sed -n '/^## 기록 명령/,$p' references/events.md` 로 기록 명령 정본을 화면에
  띄우고, 이벤트는 그 출력의 블록으로만 기록한다. (2) events.md 의 jq 가드가 공통 다섯 필드 외에
  `phase == "team"`, `host == hostname 의 첫 점 앞부분`, 이벤트별 추가 필드(`team.stop` 은 없음)까지 검사해
  하나라도 빠지면 `EVENT_ARGS_MISSING` 으로 거부한다. (3) 「팀장 상태」에 압축 뒤 첫 기상은 행동 전에
  「2. 기상과 감시」「3. 결과 처리」「6. blocked」「7. 마감」과 events.md·backends.md 「고아 정리 규칙」을
  Read 로 다시 읽고 `<host>` 도 다시 구한다는 규칙을 추가했다.
- **G. parked 표시 공백.** 죽은 팀원의 정리 불가 워크트리(`failed no-result`·일반 고아 스캔)가 `.dflow-agent`
  값을 `w<slot>` 그대로 유지해, 같은 슬롯에 새 팀원이 뜨면 재구성이 두 `w<slot>` 워크트리를 본다(생존
  검사로 걸러지지만 설계 충돌 조건 그대로다). 원인: parked 표시 문장이 backends.md 「고아 정리 규칙」의
  blocked 전용 절에만 있고 일반 3번에는 없었다. 조치: 「고아 정리 규칙」 3번이 "남기는 워크트리는 살아
  있는 팀원(4번)이 아니면 `.dflow-agent` 를 `<신원>/<host>/parked` 로 바꾼다" 를 맡는다. 프로세스 `blocked`
  절과 SKILL.md 고아 스캔은 이제 3번을 가리킨다.

### 미관찰 목록

- Task 8: skipped 재등장(항목 6, 마감 시각 도달로 미관찰), 별도 재실행 스윕(항목 7, 같은 실행의 스윕으로
  갈음), 워커의 `/dflow-dev` 호출 방식(항목 10②), `npm ci` 실행 여부(항목 12), 좌석표 claim→blocked
  경로(항목 S), 기본 권한 모드의 막힌 명령(팀장이 bypass 모드였다. Task 9 로 이월).
- Task 9: 워커·손자의 git 절대경로 완주 전용 확인(1단계 추가 2, 간접 확인만), 좌석표 claim→blocked 경로
  (스테이징에 `watch` 하위 명령이 아직 없다), 사용량 한도에 걸린 팀원이 남기는 것(A0 (f) 와 동일 사유로
  미관찰 유지).

### auto 모드 권한 프롬프트 결과

- **1단계**(에이전트 팀·프로세스 재실행 합산): 0건. 리드 화면 감시와 팀원·손자 transcript 의
  denied/permission 검색 모두 없음. 네트워크 장애 중 auto 모드가 Bash 안전성 판정을 못 해 명령이 막힌
  현상은 권한 거부가 아니라 API 불통의 부수 효과다.
- **2단계**: 클론2 첫 시작 때 "작업 디렉터리 밖 읽기" 1건. `.claude/skills` 심링크가 `feat/dflow-team`
  워크트리를 가리켜 실제 경로가 작업 디렉터리 밖이라 뜬 대화상자이며, 킷 설치본(리포 안 실파일)에는
  해당하지 않으므로 `kit/worker-allow.json` 에 반영하지 않는다.

## 최종 검토에서 발견한 결함 (`30e9af0b`)

리허설 실행이 아니라 브랜치 최종 검토에서 발견해 조치했다.

- **좌석표 신호 실패**: 최종 검토에서 발견, `30e9af0b` 로 조치. `${DFLOW_PROJECT_ID:+--project "$DFLOW_PROJECT_ID"}` 가 zsh 에서 따옴표 안까지 한 단어로 넘어가 `dflow.sh watch` 호출이 usage 오류로 끝나 좌석표 신호가 나가지 않았다. `--project` 를 넘기지 않고 `dflow.sh watch` 가 `.env` 의 `DFLOW_PROJECT_ID` 를 기본값으로 쓰도록 바꿨다.
- **이벤트 가드 무동작 경로**: 최종 검토에서 발견, `30e9af0b` 로 조치. 줄을 만드는 첫 `jq` 와 가드 `jq` 를 파이프로 이으면 첫 `jq` 의 컴파일 오류(인자 하나 누락)가 가드에 빈 입력을 주어 가드가 0 으로 끝나고 `EVENT_ARGS_MISSING` 이 나오지 않았다. 둘을 `&&` 로 잇고, 가드가 추가 필드의 빈 문자열도 거부하도록(`reason` 은 예외) 넓혔다.
- **`done` 행의 parked 표시 누락**: 최종 검토에서 발견, `30e9af0b` 로 조치. 결과 처리 표의 `done`(과 이를 상속하는 `needs-merge`·`skipped`) 행이 정리 실패 시 `parked` 표시 없이 "경로를 보고하고 남긴다" 로만 적혀 있어 결함 G 의 재발 소지가 있었다. `blocked` 행과 같은 「고아 정리 규칙」 2·3번 패턴으로 통일했다.
- **셸 블록 문법 가드 부재**: 최종 검토에서 발견, `30e9af0b` 로 조치. 스킬 문서의 bash 블록에 자동 문법 검사가 없어 zsh 에서만 갈라지는 확장 꼴이 리뷰를 통과할 수 있었다. `tests/skills/dflow-team-shell-blocks.test.ts` 를 새로 두어 SKILL.md·backends.md·events.md·worker-prompt.md·dflow.sh·heartbeat.sh 여섯 문서의 블록을 `sh`·`bash`·`zsh -n` 으로 파싱하고, `${V:+a "$V"}` 꼴과 `hostname -s` 부재를 검사한다.

## Windows 코드 검증 (GitHub Actions 러너, 2026-09-15)

GitHub Actions `windows-latest` 러너(이미지 `windows-2025-vs2026`, Windows Server 2025, Git
2.55.0.windows.5, bash 5.3.15, node v22.23.2, jq 1.8.1, PowerShell 5.1.26100.33296, `core.autocrlf`
기본값 `true`, `SHELLOPTS` 의 `igncr` 는 꺼짐)에서 SKILL.md·backends.md·events.md 의 셸 블록을 글자
그대로 실행해 관찰했다. 팀원은 실제 `claude` 대신 node 프로세스로 대역했고 토큰 인증 없이 돌렸다.
dflow-kit 리포 브랜치 `probe/windows`(`.github/workflows/windows-probe.yml`)로 5회 실행했다.

판정표:

| # | 항목 | 판정 | 관찰 |
|---|---|---|---|
| 1 | Claude Code Bash 도구의 `uname -s` 값 | 일치 | `MINGW64_NT-10.0-26100` |
| 2 | `CLAUDE_PID` 와 `$PPID` 값(부모가 Cygwin 프로세스인지에 따라 달라지는지) | 부분 | `$PPID`=1(부모가 Cygwin 프로세스가 아니면)은 일치. `CLAUDE_PID` 자체는 실제 Claude Code 세션 없이는 잴 수 없어 미측정 |
| 3 | `hostname` 출력과 `hostname \| cut -d. -f1` 의 결과 | 일치 | `runnervmvmocb`(점 없음). `hostname -s` 는 `unknown option -- s` 로 실패 |
| 4 | `nohup` 존재 여부 | 일치 | 명령 점검표(`nohup` 포함 22개)에서 실제 명령 누락 0건 |
| 5 | `nohup claude -p … &` 로 띄운 팀원이 Bash 호출 종료 뒤에도 살아남는지 | 일치 | 실제 `claude -p hi` 가 spawn·로그캡처·자연종료. `nohup … > log 2>&1 < /dev/null &` 의 `$!` 는 Bash 호출·러너 step 경계 너머 생존 |
| 6 | MSYS `ps -p` 출력에서 WINPID 열의 실제 위치(고정폭 가정이 맞는지) | 일치 | 설계는 애초에 고정폭을 가정하지 않고 머리글(`PID PPID PGID WINPID TTY UID STIME COMMAND`)에서 위치를 찾는다. 원문 awk 가 `WINPID(1701)=[4364]` 를 정확히 뽑았다 |
| 7 | PowerShell `Get-Process` 의 `StartTime` 문자열이 반복 조회에서 안정적인지 | 일치 | `pstart $$` 3회 모두 같은 타임스탬프. 호출당 `real 0m0.474s` |
| 8 | `kill -0`·`kill` 이 Cygwin 프로세스를 거쳐 네이티브 claude 자식에 전달되는지 | 일치 | MSYS pid 를 죽이면 `tasklist` 가 "No tasks are running" 을 내 네이티브 node.exe 도 함께 종료됨을 확인 |
| 9 | `ln -s` 가 실제로 복사본을 만드는지, 복사본이 정적 `.env`·읽기 전용 스킬로 동작하는지 | 일치 | `.env`→`IS_COPY`+`SAME_CONTENT`, `.claude/skills`→`IS_COPY`+`SKILL_VISIBLE` |
| 10 | `git rev-parse --show-toplevel` 등 git 출력의 경로 형태(`C:/…` 인지)와 `pwd`(`/c/…`) 의 불일치 | 일치 | `pwd`=`/d/a/dflow-kit/dflow-kit/repo6`, `show-toplevel`=`D:/a/dflow-kit/dflow-kit/repo6`. `show-prefix` 로 루트·하위 판정, 워크트리 안 `--git-dir`·`--git-common-dir` 도 설계대로 |
| 11 | npm 심(`claude`)과 네이티브 `claude.exe` 두 설치 형태 모두에서 spawn 이 되는지 | 일치 | npm 심은 `#!/bin/sh`(`exec node …`), 네이티브 설치(`irm https://claude.ai/install.ps1 \| iex`)도 `~/.local/bin/claude.exe` 로 정상 설치. 둘 다 spawn·WINPID 일치 확인 |
| 12 | `.env` 파일의 CRLF 가 `set -a; . ./.env` 소싱에 지장을 주는지 | 이 bash 빌드 한정 일치 | 디스크 원본에 `\r` 이 있음을 `od -c` 로 먼저 확인한 뒤, 소싱한 값에는 `\r` 이 남지 않았다. 방어는 이 결과와 무관하게 `dflow.sh`·heartbeat 훅이 `.env` 값의 `\r` 을 무조건 걷어내는 것이다 |
| 13 | Orca(Windows) 의 pane 백엔드 동작 | 미측정 | 러너에는 Orca 가 없다 |
| 14 | auto 모드 권한 프롬프트가 Windows 에서도 같은 형태로 뜨는지 | 미측정 | 팀원을 node 로 대역해 인증·권한 확인 자체가 발생하지 않는다 |

### 발견과 조치

1. **skip 감지·잠금 소유 판정이 `$PPID` 폴백(=1)에서 무너진다.** SKILL.md 의 `LEAD_PID=${CLAUDE_PID:-$PPID}`
   를 WINPID 변환 없이 그대로 `Get-CimInstance` 에 넣으면, `$PPID`=1 폴백에서 `Get-CimInstance` 가 에러
   없이 빈 결과를 내 확정적으로 `skip=0` 으로 오판한다. 조치: `CLAUDE_PID` 가 비어 있으면 전제 검사가
   `NO_CLAUDE_PID` 로 중단한다(F2, 오판 대신 fail-closed).
2. **`core.autocrlf=true` 클론에서 스크립트가 CRLF 로 바뀐다.** 로컬 경로 클론에서 재현되며 정확한 git
   내부 원인은 미확정이다. 조치: 킷 루트와 대상 리포 두 곳에 `.gitattributes`(`eol=lf`)를 두고, `.env`
   값의 `\r` 을 제거한다(F1). `.gitattributes` 의 효과는 이 세션의 git 2.54(Apple) 직접 재현으로
   확인했고, Git for Windows(git 2.55)에서의 독립 확인은 하지 않았다.
3. **"러너가 `SHELLOPTS=igncr` 를 심어 뒀다" 는 가설은 기각한다.** 이 러너는 애초에 igncr 가 꺼져 있고,
   `env -u SHELLOPTS` 로 명시적으로 지운 별도 bash 프로세스에서도 같은 결과였다.
4. **`skills/skills` 함정이 재현되고, 설계의 사전 존재 검사가 이를 회피한다.** 이미 있는 폴더에 폴더째
   `ln -s` 를 걸면 `skills/skills` 가 생긴다.
5. **`MSYS=winsymlinks:nativestrict` 를 주면 진짜 심링크가 가능하다.** 설계는 복사본 동작을 전제로 하며
   바꿀 이유는 없다.
6. **`pstart` 비용은 PowerShell 기동 때문에 호출당 0.4~0.5초다.** 슬롯 수 × 기상 횟수만큼 누적되지만
   허용 범위다.
7. **네이티브 설치기(`irm https://claude.ai/install.ps1 | iex`)가 PATH 경고를 낸다.** 실사용자 안내로
   참고할 만하다.

`git ls-files --eol` 의 eol 예측과 로컬 클론의 `-c core.autocrlf=` 오버라이드 이상(발견 2 의 세부 조사)은
계기가 불확실해 판정 근거로 쓰지 않는다.

### 미확인 3항

러너에서는 잴 수 없어 사람이 실제 Windows 세션에서 확인해야 한다.

1. 실제 Windows Claude Code 세션의 Bash 도구가 `CLAUDE_PID` 를 내보내는지. Windows 지원 상태의 핵심이며,
   내보내지 않으면 `/dflow-team` 은 Windows 에서 시작하지 못한다(`NO_CLAUDE_PID`). 첫 확인 명령은
   `env | grep CLAUDE_PID`.
2. auto 모드 권한 프롬프트가 Windows 에서도 같은 형태로 뜨는지.
3. Orca(Windows) pane 백엔드 동작.
