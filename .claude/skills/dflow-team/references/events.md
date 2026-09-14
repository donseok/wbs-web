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
  | jq -c 'if ([.ts,.host,.repo,.event,.agent] | all(. != null and . != "")) then . else error("EVENT_ARGS_MISSING") end' \
  >> ~/.dflow/events.jsonl || echo EVENT_ARGS_MISSING
```
- 마지막 `jq` 는 가드다. 공통 다섯 필드(`ts`·`host`·`repo`·`event`·`agent`) 가운데 하나라도 비면 줄을 붙이지 않고
  `EVENT_ARGS_MISSING` 을 낸다. 이유: 압축 뒤 기억으로 재구성한 명령은 인자가 비어 null 필드를 남기고, 그 줄은
  재구성이 걸러 내지 못한다. 이 출력이 보이면 이 문서의 명령 블록을 다시 읽어 그대로 다시 실행한다. 기록 실패는
  팀장 절차를 멈추지 않는다.
- `repo` 는 팀장 체크아웃의 절대경로다. 재구성이 이 값으로 이 리포의 줄만 거른다. 이름만 쓰면 같은 이름의
  클론 둘이 섞인다.
- `<주문 전체 UUID>` 는 show 응답의 `.order.id` 다. 모르면 `-`.
- `slot` 은 문자열(`2` 또는 `-`)로 쓴다. `team.start` 의 `slots` 와 `team.sweep` 의 세 필드는 `--argjson` 숫자다.
