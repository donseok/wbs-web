#!/usr/bin/env bash
# /dflow-team 재구성의 보조 정본 요약(SKILL.md 「팀장 상태」 「보조」). events.jsonl 에서 이 팀장(agent·repo)의 마지막
# team.start 이후 줄을 읽어, 재구성에 쓰는 값만 요약해 낸다. 이벤트 줄 자체는 내지 않는다(실행 내내 쌓인 이벤트를 그대로
# 출력하면 수십만 자로 불어난다 — 2026-09-24 dmes-standard 약 133K자).
# 사용: lead-state.sh [--agent '<신원>/<host>/lead'] [--repo '<MAIN>'] [--events <경로>]
#   --agent 가 없으면 이 체크아웃의 팀장 잠금 owner 첫 칸, --repo 가 없으면 git 최상위, --events 가 없으면 ~/.dflow/events.jsonl
#
# 출력(한 줄에 하나, 없는 항목은 줄을 내지 않는다. RUN·EXCLUDE_*·BREAKER·EVENTS 는 늘 낸다):
#   RUN start=<ts|-> backend=<…> slots=<…> until=<…> until_label=<…> wp=<…>
#       until·until_label 은 마지막 team.extend 가 있으면 그 값, 없으면 team.start 의 until(until_label 은 -)
#   SLOT <slot> <id8> tsk=<…> order=<…> kind=<new|resume|resolve|readopt/<원래 종류>> state=<spawn|blocked> resolve=<0|1> worktree=<…> handle=<…>
#       id8 의 마지막 team.spawn·team.blocked·team.result·team.lost 가 spawn·blocked 인 것(진행 중). 값은 그 id8 의 마지막 team.spawn
#       resolve=1 은 해소 워커다(워크트리 이름 접미사 -resolve, 또는 spawn_kind·orig_kind 가 resolve)
#   LOST <id8> cause=<…> next=<…>          마지막이 team.lost 인 id8(영구 제외. 대기 상태는 restart.md 「이벤트로 본 상태」)
#   WAIT_ANSWER <id8> slot=<…> <질문>       마지막 이벤트(team.answer 포함)가 team.blocked 인 id8 — 답을 기다리는 질문
#   HASH <worktree> <tsk> <hash> <status> id8=<…> slot=<…>   결과 줄 경로(<worktree>/<TASKS>/<tsk>/.result)별 마지막 처리 해시
#   EXCLUDE_PERM <id8,…|->                  영구 제외(진행 중·failed…·cancelled). failed rate-limit 은 넣지 않는다
#   EXCLUDE_TEMP <id8,…|->                  일시 제외(skipped. 사유가 「선행 미충족(사전 검사:」 인 것은 선행 대기 블록 몫이라 뺀다)
#   BREAKER <n>                            차단기: 끝에서부터 연속한 실패 수(규칙은 SKILL.md 「3」 차단기·merge-conflict.md 「6」)
#   ISSUE_PENDING <id8> <요약>              id8 마다 마지막 team.issue 의 decision 이 pending(dialect 줄 제외)
#   EVENTS window=<n> total=<n>            읽은 줄 수(마지막 team.start 이후 / 이 팀장의 전체)
set -u

usage() { echo "사용: lead-state.sh [--agent <신원>/<host>/lead] [--repo <MAIN>] [--events <경로>]" >&2; exit 2; }
AGENT=''; REPO=''; EV="${DFLOW_EVENTS:-$HOME/.dflow/events.jsonl}"
while [ $# -gt 0 ]; do
  case "$1" in
    --agent) AGENT="${2:-}"; shift 2 ;;
    --repo) REPO="${2:-}"; shift 2 ;;
    --events) EV="${2:-}"; shift 2 ;;
    *) usage ;;
  esac
done
[ -n "$REPO" ] || REPO=$(git rev-parse --show-toplevel 2>/dev/null) || { echo "FAIL NOT_GIT" >&2; exit 2; }
if [ -z "$AGENT" ]; then
  AGENT=$(cut -d' ' -f1 "$(git rev-parse --git-path dflow-team.lock)/owner" 2>/dev/null)
  [ -n "$AGENT" ] || { echo "FAIL NO_AGENT --agent 를 주거나 팀장 잠금을 먼저 잡아라" >&2; exit 2; }
fi
[ -f "$EV" ] || { printf 'RUN start=- backend=- slots=- until=- until_label=- wp=-\nEXCLUDE_PERM -\nEXCLUDE_TEMP -\nBREAKER 0\nEVENTS window=0 total=0\n'; exit 0; }

jq -c --arg a "$AGENT" --arg r "$REPO" 'select(.agent == $a and .repo == $r)' "$EV" 2>/dev/null | jq -rs '
  def ev(n): select(.event == n);
  def id: (.id8 // "");
  def resolve_content: ["failed gate", "failed push-race", "failed push-hook", "failed push-other", "failed not-detached", "failed dirty-dev-state"];
  . as $all
  | ([range(length) as $k | select($all[$k].event == "team.start") | $k] | last) as $si
  | (if $si == null then $all else $all[$si:] end) as $w
  | (if $si == null then null else $all[$si] end) as $st
  | ([$w[] | ev("team.extend")] | last) as $ex
  | (reduce ($w[] | select(.event == "team.spawn" or .event == "team.blocked" or .event == "team.result" or .event == "team.lost") | select(id != "" and id != "-")) as $e ({}; .[$e.id8] = $e)) as $last
  | (reduce ($w[] | select(.event == "team.spawn" or .event == "team.blocked" or .event == "team.result" or .event == "team.lost" or .event == "team.answer") | select(id != "" and id != "-")) as $e ({}; .[$e.id8] = $e)) as $lastq
  | (reduce ($w[] | ev("team.spawn") | select(id != "")) as $e ({}; .[$e.id8] = $e)) as $sp
  | ([$sp[] | select(((.worktree // "") | test("-resolve/?$")) or .spawn_kind == "resolve" or (.orig_kind // "") == "resolve") | .id8]) as $res
  | def kind($s): if $s.spawn_kind == "readopt" then "readopt/" + ($s.orig_kind // "-") else ($s.spawn_kind // "new") end;
    def excl($e):
      if $e.event == "team.spawn" or $e.event == "team.blocked" or $e.event == "team.lost" then "perm"
      else ($e.status // "") as $s
        | if $s == "done" or $s == "needs-merge" or $s == "resolved" or $s == "failed rate-limit" then "none"
          elif $s == "skipped" then (if (($e.reason // "") | startswith("선행 미충족(사전 검사:")) then "none" else "temp" end)
          else "perm" end
      end;
  ( "RUN start=\($st.ts // "-") backend=\($st.backend // "-") slots=\($st.slots // "-") until=\(if $ex then $ex.until else ($st.until // "-") end) until_label=\(if $ex then ($ex.until_label // "-") else "-" end) wp=\($st.wp // "-")" ),
  ( $last | to_entries[] | .value | select(.event == "team.spawn" or .event == "team.blocked") | . as $e | ($sp[$e.id8] // $e) as $s
    | "SLOT \($s.slot // "-") \($e.id8) tsk=\($s.tsk // "-") order=\($s.order // "-") kind=\(kind($s)) state=\($e.event | ltrimstr("team.")) resolve=\(if ($res | index($e.id8)) then 1 else 0 end) worktree=\($s.worktree // "-") handle=\($s.handle // "-")" ),
  ( $last | to_entries[] | .value | select(.event == "team.lost") | "LOST \(.id8) cause=\(.cause // "-") next=\(.next // "-")" ),
  ( $lastq | to_entries[] | .value | select(.event == "team.blocked") | "WAIT_ANSWER \(.id8) slot=\(.slot // "-") \(.reason // "")" ),
  ( reduce ($w[] | select(.event == "team.result" or .event == "team.blocked") | select((.worktree // "-") != "-" and (.hash // "-") != "-")) as $e ({}; .[($e.worktree) + "\t" + ($e.tsk // "-")] = $e)
    | to_entries[] | .value | "HASH \(.worktree) \(.tsk // "-") \(.hash) \(.status // "blocked") id8=\(.id8 // "-") slot=\(.slot // "-")" ),
  ( "EXCLUDE_PERM " + ([$last[] | select(excl(.) == "perm") | .id8] | if length == 0 then "-" else join(",") end) ),
  ( "EXCLUDE_TEMP " + ([$last[] | select(excl(.) == "temp") | .id8] | if length == 0 then "-" else join(",") end) ),
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
  ( reduce ($w[] | ev("team.issue") | select(id != "" and id != "dialect")) as $e ({}; .[$e.id8] = $e)
    | to_entries[] | .value | select(.decision == "pending") | "ISSUE_PENDING \(.id8) \(.summary // "")" ),
  ( "EVENTS window=\($w | length) total=\($all | length)" )
'
