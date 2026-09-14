# /dflow-team 리허설 판정

스펙 §11 합격 기준의 판정표다. 확인된 사실은 스펙 §3·§8·§12 에 사실로 옮기고, 이 파일에는 판정과 관찰만 둔다.
리허설 리포: `~/project/mes-base-rehearsal`(mes-base 새 클론), 원격: `~/project/mes-base-rehearsal.git`(버리는 bare),
D'Flow: 스테이징 리허설 프로젝트(전용 PAT), 스킬: `feat/dflow-team` 워크트리 심링크.

## A0: 에이전트 팀 실측 (스펙 §11-3)

| 항목 | 판정 | 관찰 |
|---|---|---|
| (a) 손자 실행 중 팀장에게 완료 알림이 오는가 | 확인됨 | 팀원이 손자 서브에이전트를 띄우면 손자가 도는 동안 팀장에게 결과 줄 없는 `completed` 알림이 온다. Agent 도구는 백그라운드 전용이라 팀원이 손자를 동기로 기다릴 수 없고, 기다리려면 턴을 끝내야 한다. 그 순간 팀원의 격리 워크트리가 깨끗하면 하네스가 워크트리를 지운다. suspect 방어(§4-6) 필수 |
| (b) blocked 로 끝난 팀원이 idle 로 남는가 | 확인됨 | 끝난 팀원은 ListAgents 에 `completed` 로 남고, 그 이름으로 TaskStop 하면 `Task <이름> is not running (status: completed)` 또는 `No task found with ID: <이름>. Running named agents: …` 오류가 온다. 둘 다 "이미 회수됨" 이다. `blocked` 로 끝난 팀원도 같다 |
| (c) idle 팀원에게 SendMessage 로 답하면 같은 워크트리에서 이어 가는가 | 부정 | 끝난 팀원에게 SendMessage 로 답하면 "Resuming agent" 로 이어지지만, 격리 워크트리가 이미 지워져 cwd 가 리포 루트로 돌아간 채 이어진다. 같은 워크트리에서 이어 가지 않는다. 채택하지 않음, `ANSWER=` 재spawn 유지 |
| (d) 팀원 안에서 `dflow.sh done --auto-links` 가 성공하는가 | 통과 | 팀원 안에서 `dflow.sh claim`·`done --auto-links`·`list` 가 성공한다. dflow.sh 내부의 git 호출은 Bash 명령 문자열이 아니라 rtk 훅과 격리 가드를 거치지 않는다. 소싱 접두는 가드가 거부. dflow.sh 자동 로드로 해결. `DFLOW_GIT` 불필요 |
| (e) 팀원을 TaskStop 하면 손자 서브에이전트까지 거둬지는가 | 확인됨(손자는 거둬지지 않는다) | 팀원이 띄운 서브에이전트는 팀원이 끝나거나 TaskStop 돼도 살아남아, 팀장의 ListAgents 에 자기 이름으로 `running` 상태로 나타난다. 팀장이 그 이름으로 TaskStop 하면 멈추고 그 안에서 돌던 Bash 자식 프로세스도 죽는다. 회수·마감은 팀원을 멈춘 뒤 ListAgents 를 다시 봐야 한다 |
| (f) 사용량 한도에 걸린 팀원이 무엇을 남기는가 | 미관찰 | 사용량 한도 상황은 관찰되지 않았다 |

### A0 실행 조건

헤드리스 `claude -p … --permission-mode bypassPermissions --model sonnet` 로 여섯 번(A0-1·2·3b·4·5, 3 은
무효) 돌렸다. 자동 승인이라 권한 확인 동작(스펙 §3-7)은 확인되지 않았으며 Task 9 에서 본다. 리허설 리포는
`~/project/mes-base-rehearsal`, 스테이징 프로젝트를 썼고, 주문 `eccb75b2` 가 reported 로 끝났다. 실측일
2026-09-14.

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
