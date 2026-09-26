# /dflow-team 선행 대기의 설계 선행 (SKILL.md 「2-3」 4번·「3. 결과 처리」·「팀장 상태」 고아 스캔 0번)

선행이 구현 중인 작업의 Design 을 빈 슬롯에서 먼저 해 두고, 선행이 끝나면 같은 워크트리로 이어 구현시킨다. 워커 쪽 흐름의
정본은 `/dflow-dev` SKILL.md 「설계 선행」(계약 2.9)이고, 설계 정본은 wbs-web 리포
docs/superpowers/specs/2026-09-26-dflow-parallel-token-design.md §6(킷에는 미동봉)이다. 이유는 `rationale.md` 「설계 선행」.
이 문서는 설계 선행으로 줄 때, `design_waiting` 결과를 처리할 때, 설계 완료 대기 워크트리를 재개할지 볼 때 Bash `cat` 으로 읽는다.

## 1. 설계 완료 대기 목록

정본은 이 신원·이 PC 의 워크트리다(이벤트가 아니다 — 팀장을 다시 띄워도, 압축 뒤에도 그대로 남는다). `<TASKS>/*/state.json`
이 `phase=wait_pred` 인 워크트리가 설계 완료 대기다. 출력 한 줄이 `DESIGNED<TAB><id8><TAB><TSK><TAB><워크트리><TAB><미충족 선행,…>` 이다.
```bash
dirs=$(.claude/skills/dflow-work/scripts/dflow.sh config tasks-dirs); rc=$?
{ [ "$rc" = 0 ] && [ -n "$dirs" ]; } || { echo "FAIL TASKS_DIRS rc=$rc"; exit 1; }
git worktree list --porcelain | sed -n 's/^worktree //p' | while IFS= read -r w; do
  case "$(head -n 1 "$w/.dflow-agent" 2>/dev/null)" in '<신원>/<host>/'*) ;; *) continue ;; esac
  printf '%s\n' "$dirs" | while IFS= read -r d; do
    [ -n "$d" ] || continue
    find "$w/$d" -mindepth 2 -maxdepth 2 -name state.json 2>/dev/null | while IFS= read -r f; do
      jq -r --arg w "$w" 'select(.phase == "wait_pred")
        | "DESIGNED\t\((.order // "-")[0:8])\t\(.tsk // "-")\t\($w)\t\((.design_first.unmet // []) | join(","))"' "$f" 2>/dev/null
    done
  done
done
```
- `FAIL TASKS_DIRS` 면 이 기상에는 설계 선행을 주지도 재개하지도 않는다(빈 목록으로 오판하지 않는다).
- 워크트리가 이 PC 에 없는 설계 완료 대기(다른 PC·사람이 지움)는 이 목록에 없다. 그 주문은 서버에 claimed 로 남아
  「1. 시작」 3번의 "멈춤" 표(`워크트리 없음`)로 가고, 사람이 `--resume <id8>` 으로 이어받는다(`references/resume.md` 3항이
  `origin/agent/<id8>-<slug>` 에서 워크트리를 다시 만든다 — 멈출 때 push 해 두었다).

## 2. 재개 판정

설계 완료 대기 워크트리마다, 선행이 풀렸는지 본다. 도는 때는 재구성의 고아 스캔(「팀장 상태」 0번)이다 — 매 기상이지만 대상은
이 목록뿐이고 상한(아래 `DFLOW_DESIGN_AHEAD_MAX`)이 있어 조회가 적다.
1. `dflow.sh show <id8>` 을 SKILL.md 「2-3」 의 poll exit 0 show 필터 그대로 줄인다(`deps_unmet`·`deps_nohead`). show 가 실패하면
   이번 기상에는 재개하지 않는다(조회 실패를 풀림으로 보지 않는다).
2. `deps_unmet` 이 비어 있지 않으면 아직이다. 그대로 둔다.
3. `deps_unmet` 이 비었으면 `deps_nohead` 마다 「2-3」 「선행 반영 사전 검사」 의 `pred-reflected.sh` 를 돈다. `NOT_REFLECTED` 가
   하나라도 있으면 아직이다(띄우면 워커가 `design_waiting 선행 승인 대기` 로 곧 멈춘다). `UNKNOWN` 은 워커에 맡긴다.
4. 통과하면 **재개 가능**이다. 고아 스캔 2번의 서버 조건(`claimed`·`mine`·이 PC)과 재시도 상한을 그대로 보고, `.result` 가
   `design_waiting` 인 것은 2번의 "최종 판정" 조건에 걸리지 않는 것으로 본다. 「5-1. 재개 spawn」(자동 갈래)으로 띄운다 — 워크트리가
   있으므로 claim·새 워크트리 없이 이어 간다. 재시도 수는 마지막 `team.result`(`design_waiting`) 뒤에서 다시 센다.

이 판정을 통과하지 못한 설계 완료 대기 워크트리는 **재시작·재개 후보에서 뺀다**(고아 스캔의 재개 가능, restart.md 「재투입」 의
재투입 전 확인 모두). 빼지 않으면 "재개 → 여전히 미충족 → 멈춤 → 재개" 가 기상마다 돈다. 좌석표 「이어서 시작」 요청(`resume_requests`)
은 예외로 그대로 띄운다 — 워커가 선행을 다시 보고 미충족이면 `wait_pred` heartbeat(서버가 표식을 비운다)와 `design_waiting` 으로
곧 끝나므로 한 번 누름에 한 번이다.

## 3. 설계 선행으로 주기

**언제**: 「2-3」 4번에서 재개 대상·해소 큐·대기 큐를 모두 띄운 뒤에도 빈 슬롯이 남았을 때만이다. 선행이 충족된 후보(대기 큐)가
하나라도 있으면 그것이 먼저다. 차단기·rate-limit 보류·입장 제어·주간 사용량(「5」 0항)은 새 작업과 똑같이 받는다 — 설계 선행은
새 작업이다.

**상한**: 설계 완료 대기(1번 목록의 줄 수)와 설계 선행으로 띄워 아직 돌고 있는 팀원(아래 블록의 `AHEAD` 줄 수)의 합이
`DFLOW_DESIGN_AHEAD_MAX`(팀장 세션 환경변수, 기본 2. 0 이면 끈다) 미만일 때만, 그 차이만큼까지 준다. 돌고 있는 것까지 세는
이유: 빈 슬롯이 셋이면 한 기상에 셋을 띄워 상한을 넘긴 채 설계만 쌓인다.

**후보**: 「2-3」 선행 대기 블록의 출력(`<id8><TAB><선행 TSK,…>`)에서 아래 블록의 `TOO_EARLY` id8 을 뺀 것을 위에서부터 고른다.
선행의 단계(구현 전인지)는 팀장이 판정하지 않는다 — 서버가 `design_first_too_early` 로 거부하고, 팀원이
`skipped 선행 미충족(설계 선행 불가: <ref…>)` 로 끝난다. 그 작업은 기록한 뒤 2시간 동안, 또는 그 선행 TSK 의 `done`·`needs-merge`·
`resolved` 결과가 올 때까지 다시 고르지 않는다(`TOO_EARLY`) — 안 그러면 30분 일시 제외가 풀릴 때마다 같은 거부를 되풀이한다.

**띄우기**: 「5. 팀원 spawn」 그대로다(새 워크트리, `spawn_kind` 는 `new`, 팀원이 claim 한다). show 필터 결과는 선행 대기에 넣을 때
저장한 `show-<id8>.json` 이 있으면 쓰고, 없으면 다시 부른다. 팀원은 계약 2.9 서버에서 늘 `--design-first` 로 claim 하므로 포인터에
따로 적을 것이 없다. `team.spawn` 을 남기면 그 id8 은 선행 대기 블록에서 빠지고 아래 블록의 `AHEAD` 로 세어진다.

설계 선행 블록 — 출력 줄은 `AHEAD<TAB><id8>`(설계 선행으로 띄워 아직 결과가 없다) 또는
`TOO_EARLY<TAB><id8><TAB><선행 TSK,…>`(최근 2시간 안에 너무 이른 선행으로 거부됐다)다. 이벤트는 `team.start` 로 자르지 않는다
(팀장을 다시 띄워도 거부 기록이 이어진다).
```bash
now=$(date +%s)
jq -c --arg a '<신원>/<host>/lead' --arg r '<MAIN>' 'select(.agent == $a and .repo == $r and (.id8 // "") != "")' ~/.dflow/events.jsonl 2>/dev/null \
  | jq -rs --argjson now "$now" '
      def t: (.ts // "");
      ($now - 7200 | todate) as $cut
      | [.[] | select(.event == "team.result" and (.status == "done" or .status == "needs-merge" or .status == "resolved"))
        | {tsk: (.tsk // ""), t: t}] as $done
      | [.[] | select(.event == "team.spawn" or .event == "team.blocked" or .event == "team.result" or .event == "team.lost")] as $ev
      | (reduce $ev[] as $e ({}; .[$e.id8] = (((.[$e.id8] // []) + [$e]) | .[-2:]))) as $last2
      | ( $last2 | to_entries[] | .value as $v
          | select(($v | length) == 2 and $v[1].event == "team.spawn" and (($v[1].spawn_kind // "new") == "new")
              and $v[0].event == "team.result" and $v[0].status == "skipped"
              and (($v[0].reason // "") | startswith("선행 미충족(사전 검사:")))
          | "AHEAD\t\(.key)" ),
        ( [$ev[] | select(.event == "team.result" and .status == "skipped"
              and ((.reason // "") | startswith("선행 미충족(설계 선행 불가:")) and t > $cut)]
          | group_by(.id8)[] | max_by(t) | t as $at
          | [.reason | ltrimstr("선행 미충족(설계 선행 불가:") | rtrimstr(")") | splits("[ ,]+") | select(. != "") | split("/") | last] as $refs
          | select(any($done[]; .t >= $at and (.tsk as $k | any($refs[]; . == $k))) | not)
          | "TOO_EARLY\t\(.id8)\t\($refs | join(","))" )'
```
시각은 `ts`(UTC `YYYY-MM-DDTHH:MM:SSZ`) 문자열끼리 견준다(선행 대기 블록과 같다).

## 4. `design_waiting` 결과 처리 (「3. 결과 처리」 표의 그 행)

- 실패가 아니다. 슬롯만 비우고 워크트리는 **지우지 않는다**(backends.md 「고아 정리 규칙」 0번 — 마감도 같다). `.dflow-agent` 를
  `<신원>/<host>/parked` 로 바꾼다(정규 슬롯 스캔에서 빼고, 재개할 때 「5-1」 이 되돌린다). tmux·Orca 회수는 다른 결과와 같다.
- `team.result`(status `design_waiting`, 사유는 결과 줄 7번째 칸부터 — 미충족 선행 ref)를 남긴다. 제외는 없다(주문이 claimed 라
  poll 이 돌려주지 않는다). 차단기 연속 수를 0 으로 되돌린다.
- 결과 줄 없이 끝난 팀원(멈춤 절차 3~4 사이에 죽음 등)도 워크트리 state.json 이 `wait_pred` 면 같게 다룬다 — restart.md
  「재투입」 의 재투입 전 확인이 이 문서 2번을 먼저 본다.
- 시작·마감 보고에 설계 완료 대기 목록(1번)을 `<id8> <TSK> 선행 대기: <ref…>` 로 한 줄씩 낸다. "멈춤" 표에는 넣지 않는다(사람이 할
  일이 없다).
