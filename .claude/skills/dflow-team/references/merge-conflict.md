# /dflow-team 머지 충돌 해소 — 팀장 쪽 절차 (정본)

> 설계 정본: wbs-web 리포 docs/superpowers/specs/2026-09-23-parallel-merge-conflict-design.md §4~§8(킷에는 미동봉).

SKILL.md 「4-1. 머지 충돌 해소」·「5-2. 해소 spawn」 이 이 문서를 가리킨다. 컨텍스트 압축 뒤 첫 기상에서는 다른
reference 와 함께 Bash `cat` 으로 다시 읽는다. 해소 워커 쪽 규칙은 `resolve-prompt.md` 다.

## 0. 상태와 불변식

- **해소 큐**: 해소하기로 정했으나 아직 띄우지 못한 id8 이다. 메모리 캐시이며 재구성하지 않는다. 다음 스윕이 같은
  충돌을 다시 내기 때문이다.
- **충돌 목록**: 표시를 풀어야 할 id8 이다. `team.conflict` 이벤트로 남기며, id8 마다 마지막 `decision` 이 `cleared` 가
  아닌 것이다(「5」 의 jq).
- **해소 슬롯**: 워크트리 이름이 `-resolve` 로 끝나는 슬롯이다(tmux `<MAIN>/.claude/worktrees/dflow-<id8>-resolve`, Orca
  `<MAIN>/dflow-<id8>-resolve`). `spawn_kind` 로 가르지 않는 이유: 팀장을 다시 띄우면 「1. 시작」 5번이 살아 있는 슬롯을
  `spawn_kind: readopt` 로 다시 적어 `resolve` 가 사라진다. 그 줄은 `orig_kind` 에 원래 종류를 싣지만(events.md), 옛 줄에는
  없으므로 판별의 정본은 워크트리 이름이다. 이 판별을 해소 결과 처리(「4」)·차단기(「6」)·동시 해소 상한이 모두 쓴다.
- **동시 해소 상한**은 `max(1, ⌊인원/2⌋)` 이다. 세는 대상은 위 판별(워크트리 접미사 `-resolve`)로 고른 해소 슬롯이며, 답을 기다리는 `blocked` 해소 워커도 센다. 넘치는 것은 해소 큐에 남긴다.
  이유: `blocked` 해소 워커는 슬롯을 쥔다. 상한이 없으면 충돌이 많은 밤에 모든 슬롯이 사람을 기다리며 선다.
- **해소는 이 신원의 주문(`mine`)만 한다.** 같은 신원+프로젝트의 팀장은 lease 가 하나로 묶는다.
- `LEASE_LOST` 마감·잠금 상실 마감·「7. 마감」 에 들어선 뒤에는 해소를 새로 띄우지 않는다(spawn 이기 때문이다). 떠 있는
  해소 워커는 워커와 같이 끝까지 한다.
- 해소 워커는 **워커 자동 재시작(H)의 대상이 아니다.** 결과 없이 죽은 해소 워커는 `failed no-result` 로 판정하고
  `team.lost` 를 쓰지 않는다. 해소 카운터(`spawn_kind == "resolve"` 개수)가 한 번 오르며, 다음 스윕에서 충돌이 다시 나면
  「1」 로만 다시 띄운다.

## 1. 충돌 접수

「4. 승인 스윕」 보고의 `머지 실패(충돌) <파일,…>` 마다 한다.

1. **주문 확인**
   ```bash
   (.claude/skills/dflow-work/scripts/dflow.sh show '<id8>') \
     | jq -c '{order: .order.id, status: .order.status, mine: .order.mine, ref: .order.item.external_ref}'
   ```
   - show 가 실패하면 "조회 실패: <id8>" 로 보고하고 이번에는 아무것도 하지 않는다. 다음 스윕이 다시 낸다.
   - `mine` 이 `true` 가 아니면 "사람이 머지해야 함: <id8> (다른 신원의 주문) · 충돌 파일 <…>" 로 보고만 한다.
     표시도 쏘지 않는다(서버가 403 이다).
   - `status` 가 `reported`·`approved` 가 아니면 보고만 한다.
   - TSK 는 `ref` 의 마지막 `/` 뒤다.
2. **진행 중 확인**: 같은 id8 이 해소 슬롯이나 해소 큐에 있으면 건너뛴다. 스윕이 도는 동안 같은 id8 이 계속 충돌로
   보고되기 때문이다.
3. **재시도 판정**
   ```bash
   git fetch origin
   dev=$(git rev-parse origin/<개발브랜치>)
   .claude/skills/dflow-team/scripts/resolve-decide.sh ~/.dflow/events.jsonl '<신원>/<host>/lead' '<MAIN>' '<id8>' "$dev"; echo "rc=$?"
   ```
   | 출력 | 처리 |
   |---|---|
   | `RESOLVE <n>` | 해소 큐 끝에 `{id8, order, TSK, n, 충돌 파일}` 를 넣는다. 표시 note `충돌 <k>개(<첫 파일>…) · 해소 대기 <n>/3`. `team.conflict`(decision `queued`) |
   | `RUNNING` | 아무것도 하지 않는다. 2번에서 걸렀어야 하므로 "재구성 누락: <id8>" 를 한 줄 보고한다. 마지막이 `blocked` 인 해소 워커도 `RUNNING` 이다 — 그 워커가 답 없이 죽으면 이 스크립트는 알아채지 못하고, SKILL.md 「3. 결과 처리」 의 무응답 규칙이 `failed no-result` 결과를 남겨야 풀린다 |
   | `HUMAN <사유>` | "사람이 머지해야 함: <id8> (<사유>) · 충돌 파일 <…>" 로 보고한다. 표시 note `사람 머지 필요: <사유>`. `team.conflict`(decision `human`) |
   | `UNKNOWN <사유>` | 해소하지 않는다(fail-closed). "해소 판정 불가: <id8> (<사유>)" 로 보고한다. 표시 note `사람 머지 필요: 판정 불가`. `team.conflict`(decision `human`) |
4. **보고**: 스윕 보고에 충돌 파일 목록을 싣는다.

## 2. 해소 spawn

「2-3」 기상 순서 4번에서 **재개 다음, 대기 큐보다 먼저** 띄운다. 해소가 막힌 후속 전체를 풀기 때문이다. 빈 슬롯과
차단기 규칙은 새 작업과 같고, 동시 해소 상한(「0」)을 넘지 않는다. 해소 큐의 맨 앞부터 한다.

1. 슬롯 번호를 정하고(「팀장 상태」 발급 규칙) `AGENT_ID = <신원>/<host>/w<slot>` 을 만든다.
2. **작업 폴더**: 아래 출력이 `<TASKS>` 이고, `TASK_DIR = <TASKS>/<TSK>` 다. `TASKDIR_FAILED` 면 띄우지 않고
   "작업 폴더 해석 실패: <id8>" 로 보고한다(해소 큐에서 뺀다. 다음 스윕이 다시 낸다).
   ```bash
   if grep -q '^  taskdir <ref>' .claude/skills/dflow-work/scripts/dflow.sh; then
     td=$(.claude/skills/dflow-work/scripts/dflow.sh taskdir '<order>') && dirname "$td" || echo "TASKDIR_FAILED"
   else
     echo docs/tasks
   fi
   ```
3. **워크트리**: 남아 있으면 먼저 backends.md 「고아 정리 규칙」 2-1번으로 정리를 시도한다. 그래도 있으면 띄우지 않고
   "해소 워크트리 남아 있음: <경로>" 로 보고한다. `team.conflict` 는 decision `human` 이다.
   ```bash
   W='<MAIN>/.claude/worktrees/dflow-<id8>-resolve'
   [ ! -e "$W" ] || echo "RESOLVE_WT_EXISTS $W"
   ```
   - **tmux**: backends.md 「pane(tmux)」 의 spawn 블록을 그대로 한 번의 Bash 호출로 돌린다. 워크트리 생성
     (`git worktree add --detach "$WT" origin/<기본브랜치>`)도 그 블록이 한다. 바꾸는 것은 셋이다: 블록 첫머리의
     `WT="<MAIN>/.claude/worktrees/dflow-<id8>"` 를 `WT="<MAIN>/.claude/worktrees/dflow-<id8>-resolve"` 로 쓰고,
     `<포인터 한 줄>` 을 아래 4번의 해소 포인터로 쓰고, 이름표를 `w<slot> · 해소 <TSK> <id8>` 로 붙인다. 그 뒤의
     `.dflow-pane` 기록·**폴더 신뢰 확인 루프**는 같다.
   - **Orca**:
     ```
     orca worktree create --name dflow-<id8>-resolve --agent claude --no-parent \
       --base-branch origin/<개발브랜치> --prompt "<포인터 한 줄>" --json
     ```
     Orca 는 브랜치 워크트리를 만든다. 해소 워커가 부트스트랩 끝에서 `origin/<개발브랜치>` 로 detach 한다
     (`resolve-prompt.md` 「2」). create 뒤 같은 포인터를 `.dflow-prompt` 에도 쓴다.
4. **포인터 한 줄**:
   ```
   <MAIN_CHECKOUT>/.claude/skills/dflow-team/references/resolve-prompt.md 를 읽고 그 규칙대로 실행하라. TSK=<TSK> ID8=<id8> ORDER=<order 전체 UUID> AGENT_ID=<신원>/<host>/w<slot> MAIN_CHECKOUT=<팀장 체크아웃 절대경로> MODEL=<opus|sonnet|default> DEV_BRANCH=<개발브랜치> TASK_DIR=<TASK_DIR> ATTEMPT=<n> ON_REPORT=<0|1>
   ```
   `MODEL` 은 이번 실행의 인자다(해소도 같은 모델). `ON_REPORT` 는 `AUTOMERGE_ON` 이면 `1` 이다.
5. `team.spawn` 을 기록한다. 필드는 「5. 팀원 spawn」 6번과 같고 `spawn_kind` 는 `resolve` 다. 이 줄의 개수가 해소
   카운터이므로 `new` 로 적으면 상한이 동작하지 않는다. id8 은 진행 중으로 영구 제외에 넣는다.
6. 표시 note 를 `해소 중 w<slot> <n>/3` 으로 바꾼다(「3」).
7. 감시 루프(SKILL.md 「2-2」)를 새로 띄울 때 이 슬롯의 `set --` 항목은 `'<워크트리>/<TASK_DIR>/.result|<해시 또는 ->|<pane id 또는 ->'`
   다. 이 리포에서 `TASK_DIR` 은 `docs/tasks/<TSK>` 라 워커 슬롯과 모양이 같다.

## 3. 표시 heartbeat 대리 호출

해소 워커는 서버를 부르지 않으므로 팀장이 대신 쏜다. 주문 참조는 **전체 UUID** 로 한다. `reported`·`approved` 주문은
목록 캐시에 없을 수 있어 id8 해석이 실패하기 때문이다. `--agent` 는 늘 팀장 자신이다.
```bash
.claude/skills/dflow-work/scripts/dflow.sh heartbeat '<order 전체 UUID>' --agent '<신원>/<host>/lead' --phase merge_conflict --note '<note>' || echo "MC_MARK_FAILED $?"
.claude/skills/dflow-work/scripts/dflow.sh heartbeat '<order 전체 UUID>' --agent '<신원>/<host>/lead' --clear-merge-conflict || echo "MC_MARK_FAILED $?"
```
- 출력은 `MERGE_CONFLICT_SET`·`MERGE_CONFLICT_CLEARED`·`MERGE_CONFLICT_ABSENT` 중 하나다. `ABSENT` 는 오류가 아니다
  (이미 풀렸다).
- note 는 500자 이하로 쓴다. 파일은 첫 하나와 개수만 싣는다.
- `MC_MARK_FAILED` 가 나와도 팀장을 멈추지 않고 보고에 한 줄 적는다. 표시는 부가 기능이다.

| 시점 | note |
|---|---|
| 충돌 접수(해소 큐) | `충돌 <k>개(<첫 파일>…) · 해소 대기 <n>/3` |
| 해소 spawn | `해소 중 w<slot> <n>/3` |
| 해소 워커 `blocked` | `해소 결정 대기: <질문>` |
| 재시도 가능한 실패 | `해소 대기(재시도 가능): <status> <n>/3` |
| 상한 초과·재시도 불가 | `사람 머지 필요: <사유>` |
| `resolved` 조상 확인, 사람 머지 감지 | 해제(`--clear-merge-conflict`) |

## 4. 해소 결과 처리

결과 줄 찾기·해시·`team.result`·`team.blocked` 기록·tmux 회수는 SKILL.md 「3. 결과 처리」 와 같다. 해소 슬롯(「0」 의
판별 — 워크트리 이름 접미사 `-resolve`)이면 그 절의 status 표 대신 아래 표를 쓴다. `team.result` 의 `status` 는 `resolved`·`skipped`,
또는 `failed <첫 낱말>` 이다. 해소 워커의 실패에는 첫 낱말을 **늘 붙인다**(`resolve-decide.sh` 가 그 값으로 가른다).
워크트리는 backends.md 「고아 정리 규칙」 2-1번으로 정리한다. 결과 줄 branch 칸이 `-` 여도 1번(부트스트랩 실패)을
쓰지 않는다. SKILL.md 「3. 결과 처리」 에 결과 사유를 문제 기록으로 남기는 블록이 있는 판이면, `resolved` 도 `done`·
`needs-merge` 처럼 사유를 적지 않는다.

| status | 슬롯 | 표시 | 그 밖 |
|---|---|---|---|
| `resolved` | 해제 | 먼저 조상을 확인한다(아래). 참이면 해제하고 `team.conflict`(decision `cleared`)를 남긴다. 거짓이면 표시를 두고 "해소 push 확인 불가: <id8>" 로 보고하며 `team.conflict`(decision `human`)를 남긴다 | 조상이 참이면 선행 계열 일시 제외를 풀고(「4. 승인 스윕」 의 일시 제외 해제), 다음 `team.sweep` 의 `resolved` 에 1을 더하고, **곧바로 승인 스윕**을 한다. 보고는 "해소됨: <TSK> <id8> (<사유>)" 다. 주문이 `approved` 였으면 "해소 내용은 승인 범위 밖 — 머지 커밋·resolution.md 확인" 을 붙인다 |
| `skipped` | 해제 | `pred-reflected.sh '<TASKS>' '<TSK>' '<개발브랜치>'` 가 `REFLECTED` 면 해제하고 `team.conflict` `cleared` 를 남긴다. 아니면 note `해소 건너뜀: <사유>` | "해소 대상 아님: <id8> (<사유>)" 로 보고한다 |
| `blocked` | 유지 | note `해소 결정 대기: <질문>` | SKILL.md 「6. blocked」 통지·답 매칭 그대로다. 통지 문구 앞에 "(해소)" 를 붙인다 |
| `failed push-race`·`failed rate-limit`·`failed no-result` | 해제 | note `해소 대기(재시도 가능): <status> <n>/3` | 다음 스윕에서 충돌이 다시 나면 「1」 이 재시도를 판정한다 |
| 그 밖의 `failed …` | 해제 | note `사람 머지 필요: <status> <사유>` | "사람이 머지해야 함: <id8> (해소 실패 <status>)" 로 보고하고 `team.conflict`(decision `human`)를 남긴다. `failed permission` 은 거부된 명령을 권한 목록 재료로 함께 보고한다 |

`resolved` 의 조상 확인:
```bash
git fetch origin && git merge-base --is-ancestor '<결과 줄 head>' origin/<개발브랜치>; echo "anc=$?"
```
`<결과 줄 head>` 는 결과 줄 넷째 칸의 **전체 sha** 다(`resolve-prompt.md` 「결과 줄」). 짧은 값이 오면 모호할 수 있으므로
`git rev-parse --verify -q '<값>^{commit}'` 로 먼저 전체 sha 로 바꾸고, 실패하면 조상 확인 거짓과 같이 처리한다.
해제를 스윕 보고에 기대지 않는 이유가 있다. 해소 워커가 머지하면 `/dflow-merge` 뒷정리가 원격 agent 브랜치를 지운다.
그래서 다음 스윕에서 그 주문은 후보가 아니고, "머지됨" 줄을 기다리면 표시가 영영 남는다.

## 5. 사람 머지 감지

스윕을 도는 기상마다 한다. 충돌 목록 중 해소 슬롯·해소 큐에 없는 id8 마다, 사람이 손으로 머지했는지 본다.
```bash
jq -rs --arg a '<신원>/<host>/lead' --arg r '<MAIN>' '[.[] | select(.agent == $a and .repo == $r and .event == "team.conflict")] | group_by(.id8) | map(last) | .[] | select(.decision != "cleared") | [.id8, .tsk, .order] | @tsv' ~/.dflow/events.jsonl 2>/dev/null
```
줄마다 「2」 2번 블록으로 `<TASKS>` 를 구한 뒤 `pred-reflected.sh '<TASKS>' '<TSK>' '<개발브랜치>'` 를 부른다.
`REFLECTED` 면 표시를 해제하고 `team.conflict`(decision `cleared`)를 남긴 뒤 "사람 머지 확인: <id8>" 로 보고한다.
그 밖이면 아무것도 하지 않는다.

## 6. 차단기

해소 워커의 **내용 실패** `failed gate`·`failed push-race`·`failed push-hook`·`failed push-other`·`failed not-detached`·`failed dirty-dev-state` 는
`not-assignee` 처럼 **세지도 끊지도 않는다.** 이유: 의미 충돌 두 건이 연달아 `failed gate` 가 되면 차단기가 새 spawn 을
모두 멈춘다. 이 설계가 풀려던 정지를 다시 만드는 셈이다. **환경 실패**(`rate-limit`·`no-result`·`deps`·`permission`·
부트스트랩 실패 값)만 워커와 같이 센다. 실패가 아닌 결과(`resolved`·`skipped`·`blocked`)는 워커와 같이 연속 수를
0으로 되돌린다. 재구성에서 해소 워커인지는 id8 마다 마지막 `team.spawn` 의 워크트리 이름으로 가른다(「0」). `readopt`
줄이 `spawn_kind` 를 덮어도 워크트리와 `orig_kind` 가 남으므로, 팀장을 다시 띄운 뒤에도 해소 워커의 내용 실패가
차단기에 세지지 않는다. 해소 워커 id8 목록:
```bash
jq -rs --arg a '<신원>/<host>/lead' --arg r '<MAIN>' '[.[] | select(.agent == $a and .repo == $r and .event == "team.spawn")] | group_by(.id8) | map(last) | .[] | select(((.worktree // "") | test("-resolve/?$")) or .spawn_kind == "resolve" or (.orig_kind // "") == "resolve") | .id8' ~/.dflow/events.jsonl 2>/dev/null
```

## 7. 마감

해소 워커도 다른 팀원과 같이 기다린다(「7. 마감」 2번). 마감은 남은 `merge_conflict` 표시를 지우지 않는다. 사람이 보아야
하기 때문이다. 마감 보고에 충돌 목록(「5」 jq)을 함께 적는다.
