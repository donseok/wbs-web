# /dflow-team 이벤트: `~/.dflow/events.jsonl`

좌석표 설계와 같은 스키마 `{ts, host, repo, tsk, order, phase, event, agent}` 에 이벤트별 추가 필드를 더해
한 줄씩 append 한다. 팀장이 쓰며 `agent` 는 `<신원>/<host>/lead`, `phase` 는 `team` 이다. 기록 실패는 진행을
막지 않는다. 재구성(SKILL.md 「팀장 상태」)이 `team.start` 이후의 `team.spawn`·`team.result`·`team.blocked`·
`team.answer` 를 보조 정본으로 읽는다. 자동 재시작(`references/restart.md`)은 `team.lost` 를 `team.start` 로 자르지 않고 읽는다.

## 이벤트

| 이벤트 | 시점(SKILL.md) | 추가 필드 |
|---|---|---|
| `team.start` | 「1. 시작」 4번 | `backend`, `slots`, `until`, `wp` |
| `team.spawn` | 「5. 팀원 spawn」 6번, 「5-1. 재개 spawn」 7번, 「1. 시작」 4번(이어받은 슬롯 재기록) | `slot`, `id8`, `worktree`, `handle`, `spawn_kind` |
| `team.result` | 「3. 결과 처리」, 「1. 시작」 4번(이어받은 해시 재기록) | `slot`, `id8`, `status`, `worktree`, `hash`, `reason` |
| `team.blocked` | 「3. 결과 처리」·「6. blocked」, 「1. 시작」 4번(이어받은 해시·답 대기 재기록) | `slot`, `id8`, `worktree`, `hash`, `reason` |
| `team.answer` | 「6. blocked」 답 매칭, 「1. 시작」 4번(대기 중인 답 재기록) | `id8`, `answer` |
| `team.sweep` | 「4. 승인 스윕」 | `merged`, `waiting`, `rejected`, `resolved` |
| `team.conflict` | 「4-1. 머지 충돌 해소」(merge-conflict.md 「1」「4」「5」) | `id8`, `decision`, `files` |
| `team.extend` | 「인자」 실행 중 연장 | `until`, `until_label` |
| `team.lost` | 「3. 결과 처리」 재시작 판정(`references/restart.md`) | `slot`, `id8`, `worktree`, `cause`, `next`, `restart_at` |
| `team.stop` | 「7. 마감」 | 없음 |

- `team.start`: `backend` 는 `tmux` 또는 `orca`, `slots` 는 숫자, `until` 은 `HH:MM`·`YYYY-MM-DD HH:MM`·`none`(종료 요청 전까지) 중 하나, `wp` 는 WP 범위를 쉼표로 이은
  문자열(예: `WP-2,dict/WP-3`)이며 전체면 `-` 다. 재구성이 이 값으로 poll 의 `--wp` 를 복원한다.
- `team.extend`: `until` 은 `team.start` 의 `until` 과 같은 형식이고, `until_label` 은 좌석표에 싣는 표시 문자열이다.
  재구성은 마지막 `team.extend` 를 `team.start` 의 `until` 보다 우선한다(SKILL.md 「팀장 상태」).
- `team.spawn`: `worktree` 는 팀원 워크트리 절대경로이며 모르면 `-`. `handle` 은 tmux 백엔드의
  `tmux:<pane_id>`(예: `tmux:%3`) 또는 Orca 터미널 핸들이며, 핸들이 없으면 `-`. 기본 필드 `tsk`·`order` 도
  채운다. `blocked` 는 재spawn 하지 않으므로 그 자리에 `team.spawn` 이 다시 오지 않는다.
  `spawn_kind` 는 네 값 중 하나인 문자열이다. `resolve` 는 「5-2. 해소 spawn」 의 해소 워커이며, 그 개수가 해소 카운터다(초기화하지 않는다, `scripts/resolve-decide.sh`). 재개 재시도 계산은 `resolve` 줄을 세지 않는다. `new` 는 「5. 팀원 spawn」 의 새 작업, `resume` 은
  「5-1. 재개 spawn」, `readopt` 는 「1. 시작」 4번이 이어받은 슬롯을 다시 기록한 줄이다. `readopt` 줄은 원래 종류
  (`new`·`resume`·`resolve`)를 `orig_kind` 필드에 함께 싣는다(가드가 요구한다, 2026-09-23 머지 충돌). 해소 워커가 재기록
  뒤에도 해소 워커로 남게 하기 위해서다. 판별의 정본은 워크트리 이름 접미사 `-resolve` 다(merge-conflict.md 「0」). 재구성은 마지막
  `team.result` 이후의 **`resume` 줄 개수**로 재개 재시도 상한을 잰다(SKILL.md 「팀장 상태」 고아 스캔 2번).
  세 값을 가르는 이유: 팀장을 다시 띄울 때마다 4번이 살아 있는 슬롯을 `team.spawn` 으로 재기록하므로, 종류를
  가르지 않으면 멀쩡히 돌고 있는 팀원의 재기록이 재시도 횟수로 세어져 상한에 금방 닿는다. 이 필드가 없는 옛
  줄은 `new` 로 읽는다(`.spawn_kind // "new"`).
- `team.result`·`team.blocked`: `blocked` 는 `team.blocked`, 나머지 status 는 `team.result` 로 쓴다. `hash` 는
  결과 줄의 cksum 첫 필드, `reason` 은 결과 줄 7번째 칸부터(사유 또는 질문)다. `worktree` 와 기본 필드 `tsk`
  로 `.result` 경로(`<worktree>/docs/tasks/<tsk>/.result`)가 정해지므로, 재구성이 경로별 마지막 처리 해시를
  유도한다. `status` 는 `.result` 의 status 칸이며, `failed` 이고 사유 첫 낱말이 팀장이 구분하는 값이면
  `failed rate-limit`·`failed not-isolated`·`failed no-worker-flag`·`failed deps`·`failed permission`·`failed project` 처럼 붙인다.
  결과 줄 없이 판정한 것(pane 이 죽었는데 `.result` 도 pane 화면의 결과 줄도 없음)은 `failed no-result`(hash `-`)다.
  해소 워커(`spawn_kind: resolve`)의 `status` 는 `resolved`·`skipped`·`failed <첫 낱말>`(첫 낱말을 늘 붙인다)이다.
  재구성이 이 값으로 제외 목록과 차단기를 복원한다. spec·TSK 부재로 걸러 spawn 하지 않은 작업은
  `slot`·`worktree`·`hash` 를 `-`, `status` 를 `skipped` 로 남긴다.
- `team.lost`: 결과 줄 없이 멈춘 팀원을 자동 재시작 판정(`references/restart.md`)이 처리한 기록이다. **이 손실에는
  `team.result` 를 쓰지 않는다.** 재시도 수가 마지막 `team.result` 에서 0 으로 돌아가므로(SKILL.md 「팀장 상태」 고아
  스캔 2번), `team.result` 를 쓰면 상한 3 이 영영 닿지 않는다.
  `cause` 는 `no-response` · `pane-dead` · `rate-limit` 중 하나다. `next` 는 `restart` · `wait` · `park` 중 하나이며
  `restart` 는 같은 기상에 곧바로 재투입, `wait` 는 차단기·rate-limit 대기로 미룸, `park` 는 멈춤이다.
  `restart_at` 은 재투입을 다시 볼 시각(epoch 초 문자열)이고 정해지지 않았으면 `-` 다. `restart`·`park` 는 늘 `-` 다.
  `evidence` 는 선택 필드이며 rate-limit 감지 때의 생존 증거 요약(restart.md 「rate-limit 대기」)이다. 없으면 `-`.
  기본 필드 `tsk`·`order` 도 채운다.
- `team.answer`: `answer` 는 사람이 준 답 한 줄이다. 팀장이 그 답을 팀원 화면에 넣은 **뒤에** 기록한다. 같은
  id8 의 `team.blocked` 뒤에 `team.answer` 가 없으면 아직 답을 기다리는 질문이다. 이 기록이 없으면 컨텍스트
  압축 뒤 재구성이 이미 답한 질문을 사람에게 다시 통지한다.
- 제외 목록은 id8 마다 마지막 `team.spawn`·`team.blocked`·`team.result`·`team.lost` 로 정한다. 마지막이 `team.spawn` 이나
  `team.blocked` 면 진행 중(영구 제외), `team.result` 면 그 `status` 의 제외 칸(SKILL.md 「3. 결과 처리」), `team.lost` 면
  진행 중(영구 제외, restart.md 「이벤트로 본 상태」)이다. `team.answer` 는 제외를 바꾸지 않는다.
- `team.sweep`: 네 필드 모두 개수(숫자)다. `resolved` 는 직전 스윕 뒤 해소 머지가 조상 확인까지 통과한 수다.
- `team.conflict`: `decision` 은 `queued`(해소 큐에 넣음)·`human`(사람 몫)·`cleared`(표시 해제) 중 하나, `files` 는 충돌 파일 목록(쉼표로 이음, 모르면 `-`)이다. id8 마다 마지막 `decision` 이 `cleared` 가 아니면 충돌 목록에 남는다(merge-conflict.md 「5」).

## 기록 명령

결과 줄에서 해시와 사유를 뽑는다(`team.result`·`team.blocked`).
```bash
l=$(head -n 1 '<.result 경로>')
hash=$(printf '%s\n' "$l" | cksum | cut -d' ' -f1)
reason=$(printf '%s\n' "$l" | cut -d' ' -f7-)
```
한 줄을 jq 로 만들어 붙인다. 사유·답에 따옴표가 들어가도 JSON 이 깨지지 않게, 문자열은 모두 `--arg` 로 넘기고
숫자만 `--argjson` 으로 넘긴다. 아래는 `team.result` 예이며, 다른 이벤트는 첫 `jq` 의 마지막 두 줄(인자와 추가
객체)만 위 표의 필드로 바꾼다.
```bash
mkdir -p ~/.dflow && line=$(jq -nc \
  --arg ts "$(date -u +%Y-%m-%dT%H:%M:%SZ)" --arg host "$(hostname | cut -d. -f1)" --arg repo '<MAIN_CHECKOUT>' \
  --arg tsk '<TSK 또는 ->' --arg order '<주문 전체 UUID 또는 ->' --arg event 'team.result' --arg agent '<신원>/<host>/lead' \
  --arg slot '<slot 또는 ->' --arg id8 '<id8>' --arg status '<status>' --arg worktree '<워크트리 또는 ->' --arg hash "$hash" --arg reason "$reason" \
  '{ts:$ts,host:$host,repo:$repo,tsk:$tsk,order:$order,phase:"team",event:$event,agent:$agent} + {slot:$slot,id8:$id8,status:$status,worktree:$worktree,hash:$hash,reason:$reason}') \
  && printf '%s\n' "$line" | jq -c --arg h "$(hostname | cut -d. -f1)" '{"team.start":["backend","slots","until","wp"],"team.spawn":["slot","id8","worktree","handle","spawn_kind"],"team.result":["slot","id8","status","worktree","hash","reason"],"team.blocked":["slot","id8","worktree","hash","reason"],"team.answer":["id8","answer"],"team.sweep":["merged","waiting","rejected","resolved"],"team.conflict":["id8","decision","files"],"team.extend":["until","until_label"],"team.lost":["slot","id8","worktree","cause","next","restart_at"],"team.stop":[]} as $req
      | if ([.ts,.host,.repo,.event,.agent] | all(. != null and . != "")) and .phase == "team" and .host == $h and $req[.event] != null
           and ([$req[.event][] as $k | has($k) and .[$k] != null and ($k == "reason" or .[$k] != "")] | all)
           and (.event != "team.spawn" or .spawn_kind != "readopt" or ((.orig_kind // "") != "")) then . else error("EVENT_ARGS_MISSING") end' \
  >> ~/.dflow/events.jsonl || echo EVENT_ARGS_MISSING
```
`team.spawn` 의 `readopt` 재기록은 추가 인자 줄에 `--arg orig_kind '<그 슬롯의 원래 spawn_kind>'` 를 더하고 객체에
`orig_kind:$orig_kind` 를 더한다. 원래 종류는 이어받은 슬롯의 마지막 `team.spawn` 의 `orig_kind // spawn_kind` 다.
`team.lost` 는 위 블록의 `--arg event` 를 `'team.lost'` 로 쓰고, 넷째·다섯째 줄(추가 인자 줄과 객체 줄)을 아래 두 줄로
바꾼다. `cause`·`next`·`restart_at` 의 값은 restart.md 가 정한다.
```text
  --arg slot '<slot 또는 ->' --arg id8 '<id8>' --arg worktree '<워크트리 또는 ->' --arg cause '<no-response|pane-dead|rate-limit>' --arg next '<restart|wait|park>' --arg restart_at '<epoch 초 또는 ->' --arg evidence '<생존 증거 요약 또는 ->' \
  '{ts:$ts,host:$host,repo:$repo,tsk:$tsk,order:$order,phase:"team",event:$event,agent:$agent} + {slot:$slot,id8:$id8,worktree:$worktree,cause:$cause,next:$next,restart_at:$restart_at,evidence:$evidence}') \
```
- 첫 `jq` 는 줄을 만들고 둘째 `jq` 는 가드다. 둘은 `&&` 로 잇는다. 이유: 파이프로 이으면 첫 `jq` 가 컴파일
  오류(`--arg` 하나를 빠뜨리고 필터에 `$slot` 이 남은 경우)로 죽어도 가드가 빈 입력을 받아 0 으로 끝나
  `EVENT_ARGS_MISSING` 이 나오지 않는다. `&&` 이면 첫 `jq` 의 실패가 곧바로 `|| echo` 로 간다.
- 가드는 공통 다섯 필드(`ts`·`host`·`repo`·`event`·`agent`) 가운데 하나라도 비거나, `phase` 가 `team` 이
  아니거나, `host` 가 이 PC 의 호스트 이름(`hostname` 의 첫 점 앞부분) 과 다르거나, 위 표의 이벤트별 추가 필드
  가운데 하나라도 없거나 비면(`reason` 은 비어도 된다. `done` 결과 줄에는 사유가 없을 수 있다) 줄을 붙이지
  않고 `EVENT_ARGS_MISSING` 을 낸다. 모르는 값은 `""` 가 아니라 `-` 로 쓴다. 이유: 압축 뒤 기억으로 재구성한
  명령은 인자가 비거나 추가 필드를 빠뜨리고 `host` 를 슬러그로 쓰며, 그런 줄로는 재구성이 슬롯·해시·제외
  목록을 복원하지 못한다. 이 출력이 보이면 이 문서의 명령 블록을 다시 띄워(SKILL.md 「2-3」 의 마지막 명령)
  그대로 다시 실행한다. 기록 실패는 팀장 절차를 멈추지 않는다.
- `repo` 는 팀장 체크아웃의 절대경로다. 재구성이 이 값으로 이 리포의 줄만 거른다. 이름만 쓰면 같은 이름의
  클론 둘이 섞인다.
- `<주문 전체 UUID>` 는 show 응답의 `.order.id` 다. 모르면 `-`.
- `slot` 은 문자열(`2` 또는 `-`)로 쓴다. `team.start` 의 `slots` 와 `team.sweep` 의 네 필드는 `--argjson` 숫자이고,
  `team.spawn` 의 `spawn_kind` 는 `--arg` 문자열이며 `new`·`resume`·`readopt`·`resolve` 밖의 값을 쓰지 않는다. 다른 값을
  쓰면 가드는 통과하지만 재시도 계산이 그 줄을 세지 않는다.
