#!/usr/bin/env bash
# /dflow-team 재구성의 보조 정본 요약(SKILL.md 「팀장 상태」 「보조」). events.jsonl 에서 이 팀장(agent·repo)의 마지막
# team.start 이후 줄을 읽어, 재구성에 쓰는 값만 요약해 낸다. 이벤트 줄 자체는 내지 않는다(실행 내내 쌓인 이벤트를 그대로
# 출력하면 수십만 자로 불어난다 — 2026-09-24 dmes-standard 약 133K자).
# 사용: lead-state.sh [--agent '<신원>/<host>/lead'] [--repo '<MAIN>'] [--events <경로>] [--hash '<worktree>']
#   --agent 가 없으면 이 체크아웃의 팀장 잠금 owner 첫 칸, --repo 가 없으면 git 최상위, --events 가 없으면 ~/.dflow/events.jsonl
#   --hash 를 주면 그 워크트리의 HASH 줄만 낸다(HASH_OMITTED 로 빠진 경로를 따로 읽을 때. 상한 없음)
#
# 출력(한 줄에 하나). 크기가 고정된 줄을 먼저 낸다 — 늘 내며, 출력이 길어 뒤가 잘려도 보이게 한다:
#   RUN start=<ts|-> backend=<…> slots=<…> until=<…> until_label=<…> wp=<…>
#       until·until_label 은 마지막 team.extend 가 있으면 그 값, 없으면 team.start 의 until(until_label 은 -)
#   EVENTS window=<n> total=<n> bad=<n>    읽은 줄 수(마지막 team.start 이후 / 이 팀장의 전체). bad 는 파일 전체에서
#                                          건너뛴 깨진 줄(JSON 이 아니거나 객체가 아닌 줄) 수 — 누구의 줄인지 알 수 없어 거르지 않고 센다
#   BREAKER <n>                            차단기: 끝에서부터 연속한 실패 수(규칙은 SKILL.md 「3」 차단기·merge-conflict.md 「6」)
#   CONFLICT_CLEARED resolved=<n> other=<n>  이 팀장의 마지막 team.sweep 이후(없으면 처음부터) team.conflict cleared 수.
#                                          resolved 는 같은 id8 의 team.result resolved 와 이웃한 것(다음 team.sweep 의 resolved),
#                                          other 는 해소 건너뜀(REFLECTED)·사람 머지 감지로 푼 것
#   HASH_OMITTED <n>                       상한(SLOT 이 아닌 경로 최근 50개)에 걸려 내지 않은 HASH 수
#   EXCLUDE_PERM <id8,…|->                  영구 제외(진행 중·failed…·cancelled). failed rate-limit·design_waiting(설계 완료·선행 대기 — claimed 라 poll 에 안 나온다)은 넣지 않는다
#   EXCLUDE_TEMP <id8,…|->                  일시 제외(skipped. 사유가 「선행 미충족(사전 검사:」 인 것은 선행 대기 블록 몫이라 뺀다)
# 그 뒤는 없는 항목이면 줄을 내지 않는다:
#   ISSUE_PENDING <id8> <요약>              id8 마다 마지막 team.issue 의 decision 이 pending(dialect 줄 제외)
#   WAIT_ANSWER <id8> slot=<…> <질문>       마지막 이벤트(team.answer 포함)가 team.blocked 인 id8 — 답을 기다리는 질문
#   LOST <id8> cause=<…> next=<…>          마지막이 team.lost 인 id8(영구 제외. 대기 상태는 restart.md 「이벤트로 본 상태」)
#   SLOT <slot> <id8> tsk=<…> order=<…> kind=<new|resume|resolve|readopt/<원래 종류>> state=<spawn|blocked> resolve=<0|1> worktree=<…> handle=<…>
#       id8 의 마지막 team.spawn·team.blocked·team.result·team.lost 가 spawn·blocked 인 것(진행 중). 값은 그 id8 의 마지막 team.spawn
#       resolve=1 은 해소 워커다(워크트리 이름 접미사 -resolve, 또는 spawn_kind·orig_kind 가 resolve)
#   HASH <worktree> <tsk> <hash> <status> id8=<…> slot=<…>   결과 줄 경로(<worktree>/<TASKS>/<tsk>/.result)별 마지막 처리 해시.
#       SLOT 에 오른 id8 의 것은 모두, 나머지는 최근 처리 순으로 50개까지(워크트리가 남았는지는 이 스크립트가 보지 않는다)
# jq 가 실패하면 FAIL 을 stderr 에 내고 exit 1 이다(빈 요약으로 위장하지 않는다).
set -u -o pipefail

usage() { echo "사용: lead-state.sh [--agent <신원>/<host>/lead] [--repo <MAIN>] [--events <경로>] [--hash <worktree>]" >&2; exit 2; }
AGENT=''; REPO=''; HW=''; EV="${DFLOW_EVENTS:-$HOME/.dflow/events.jsonl}"; HASH_CAP=50
while [ $# -gt 0 ]; do
  case "$1" in
    --agent) AGENT="${2:-}"; shift 2 ;;
    --repo) REPO="${2:-}"; shift 2 ;;
    --events) EV="${2:-}"; shift 2 ;;
    --hash) HW="${2:-}"; shift 2 ;;
    *) usage ;;
  esac
done
[ -n "$REPO" ] || REPO=$(git rev-parse --show-toplevel 2>/dev/null) || { echo "FAIL NOT_GIT" >&2; exit 2; }
if [ -z "$AGENT" ]; then
  AGENT=$(cut -d' ' -f1 "$(git rev-parse --git-path dflow-team.lock)/owner" 2>/dev/null)
  [ -n "$AGENT" ] || { echo "FAIL NO_AGENT --agent 를 주거나 팀장 잠금을 먼저 잡아라" >&2; exit 2; }
fi
[ -f "$EV" ] || { printf 'RUN start=- backend=- slots=- until=- until_label=- wp=-\nEVENTS window=0 total=0 bad=0\nBREAKER 0\nCONFLICT_CLEARED resolved=0 other=0\nHASH_OMITTED 0\nEXCLUDE_PERM -\nEXCLUDE_TEMP -\n'; exit 0; }

# 깨진 줄(JSON 이 아니거나 객체가 아닌 줄)은 그 줄만 건너뛰고 {"__bad":true} 로 넘겨 센다(그 뒤를 버리지 않는다)
jq -R -c --arg a "$AGENT" --arg r "$REPO" 'select(test("\\S")) | (try fromjson catch null) as $o
  | if ($o | type) == "object" then ($o | select(.agent == $a and .repo == $r)) else {"__bad": true} end' "$EV" \
| jq -rs --arg hw "$HW" --argjson cap "$HASH_CAP" '
  def ev(n): select(.event == n);
  def id: (.id8 // "");
  def resolve_content: ["failed gate", "failed push-race", "failed push-hook", "failed push-other", "failed not-detached", "failed dirty-dev-state"];
  ([.[] | select(.__bad == true)] | length) as $bad
  | [.[] | select(.__bad != true)] as $all
  | ([range($all | length) as $k | select($all[$k].event == "team.start") | $k] | last) as $si
  | (if $si == null then $all else $all[$si:] end) as $w
  | (if $si == null then null else $all[$si] end) as $st
  | ([$w[] | ev("team.extend")] | last) as $ex
  | (reduce ($w[] | select(.event == "team.spawn" or .event == "team.blocked" or .event == "team.result" or .event == "team.lost") | select(id != "" and id != "-")) as $e ({}; .[$e.id8] = $e)) as $last
  | (reduce ($w[] | select(.event == "team.spawn" or .event == "team.blocked" or .event == "team.result" or .event == "team.lost" or .event == "team.answer") | select(id != "" and id != "-")) as $e ({}; .[$e.id8] = $e)) as $lastq
  | (reduce ($w[] | ev("team.spawn") | select(id != "")) as $e ({}; .[$e.id8] = $e)) as $sp
  | ([$sp[] | select(((.worktree // "") | test("-resolve/?$")) or .spawn_kind == "resolve" or (.orig_kind // "") == "resolve") | .id8]) as $res
  | ([$last[] | select(.event == "team.spawn" or .event == "team.blocked") | .id8]) as $slots
  # 결과 줄 경로별 마지막 처리(최근 처리 순). 갱신된 키는 자리를 지키므로 순서는 이벤트 번호(_k)로 정한다
  | ([range($w | length) as $k | $w[$k] | select(.event == "team.result" or .event == "team.blocked")
       | select((.worktree // "-") != "-" and (.hash // "-") != "-") | . + {_k: $k}]
     | reduce .[] as $e ({}; .[($e.worktree) + "\t" + ($e.tsk // "-")] = $e) | [.[]] | sort_by(-._k)) as $hall
  | (if $hw != "" then [$hall[] | select(.worktree == $hw)]
     else [$hall[] | select(.id8 as $i | $slots | index($i))] + ([$hall[] | select(.id8 as $i | $slots | index($i) | not)] | .[:$cap]) end) as $hshow
  | (if $hw != "" then 0 else ([$hall[] | select(.id8 as $i | $slots | index($i) | not)] | length) - $cap | if . < 0 then 0 else . end end) as $homit
  | ([range($all | length) as $k | select($all[$k].event == "team.sweep") | $k] | last) as $swi
  # id8 마다 이웃한 resolved 결과와 cleared 를 짝짓는다(기록 순서는 어느 쪽이 먼저여도 된다). 사이에 human·queued 가 끼면 끊는다
  | (reduce (if $swi == null then $all else $all[$swi + 1:] end)[] as $e ({p: {}, r: 0, o: 0};
      ($e.id8 // "-") as $i | (.p[$i] // "") as $pv
      | if $e.event == "team.result" and ($e.status // "") == "resolved" then
          (if $pv == "C" then (.r += 1 | .o -= 1 | .p[$i] = "") else .p[$i] = "R" end)
        elif $e.event == "team.conflict" and ($e.decision // "") == "cleared" then
          (if $pv == "R" then (.r += 1 | .p[$i] = "") else (.o += 1 | .p[$i] = "C") end)
        elif $e.event == "team.conflict" then .p[$i] = ""
        else . end)) as $cc
  | def kind($s): if $s.spawn_kind == "readopt" then "readopt/" + ($s.orig_kind // "-") else ($s.spawn_kind // "new") end;
    def excl($e):
      if $e.event == "team.spawn" or $e.event == "team.blocked" or $e.event == "team.lost" then "perm"
      else ($e.status // "") as $s
        | if $s == "done" or $s == "needs-merge" or $s == "resolved" or $s == "failed rate-limit" or $s == "design_waiting" then "none"
          elif $s == "skipped" then (if (($e.reason // "") | startswith("선행 미충족(사전 검사:")) then "none" else "temp" end)
          else "perm" end
      end;
  if $hw != "" then ($hshow[] | "HASH \(.worktree) \(.tsk // "-") \(.hash) \(.status // "blocked") id8=\(.id8 // "-") slot=\(.slot // "-")") else
  ( "RUN start=\($st.ts // "-") backend=\($st.backend // "-") slots=\($st.slots // "-") until=\(if $ex then $ex.until else ($st.until // "-") end) until_label=\(if $ex then ($ex.until_label // "-") else "-" end) wp=\($st.wp // "-")" ),
  ( "EVENTS window=\($w | length) total=\($all | length) bad=\($bad)" ),
  ( "BREAKER " + (reduce ([$w[] | select(.event == "team.result" or .event == "team.blocked" or .event == "team.lost")] | reverse[]) as $e ({n: 0, stop: false};
      if .stop then .
      elif $e.event == "team.lost" then (if ($e.next // "") == "wait" then . else .n += 1 end)
      elif $e.event == "team.blocked" then .stop = true
      else ($e.status // "") as $s
        | if $s == "failed not-assignee" or $s == "cancelled" then .
          elif ($res | index($e.id8)) and (resolve_content | index($s)) then .
          elif ($s | startswith("failed")) then .n += 1
          else .stop = true end
      end) | .n | tostring) ),
  ( "CONFLICT_CLEARED resolved=\($cc.r) other=\($cc.o)" ),
  ( "HASH_OMITTED \($homit)" ),
  ( "EXCLUDE_PERM " + ([$last[] | select(excl(.) == "perm") | .id8] | if length == 0 then "-" else join(",") end) ),
  ( "EXCLUDE_TEMP " + ([$last[] | select(excl(.) == "temp") | .id8] | if length == 0 then "-" else join(",") end) ),
  ( reduce ($w[] | ev("team.issue") | select(id != "" and id != "dialect")) as $e ({}; .[$e.id8] = $e)
    | to_entries[] | .value | select(.decision == "pending") | "ISSUE_PENDING \(.id8) \(.summary // "")" ),
  ( $lastq | to_entries[] | .value | select(.event == "team.blocked") | "WAIT_ANSWER \(.id8) slot=\(.slot // "-") \(.reason // "")" ),
  ( $last | to_entries[] | .value | select(.event == "team.lost") | "LOST \(.id8) cause=\(.cause // "-") next=\(.next // "-")" ),
  ( $last | to_entries[] | .value | select(.event == "team.spawn" or .event == "team.blocked") | . as $e | ($sp[$e.id8] // $e) as $s
    | "SLOT \($s.slot // "-") \($e.id8) tsk=\($s.tsk // "-") order=\($s.order // "-") kind=\(kind($s)) state=\($e.event | ltrimstr("team.")) resolve=\(if ($res | index($e.id8)) then 1 else 0 end) worktree=\($s.worktree // "-") handle=\($s.handle // "-")" ),
  ( $hshow[] | "HASH \(.worktree) \(.tsk // "-") \(.hash) \(.status // "blocked") id8=\(.id8 // "-") slot=\(.slot // "-")" )
  end
' || { echo "FAIL JQ events.jsonl 요약 실패($EV)" >&2; exit 1; }
