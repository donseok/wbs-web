#!/bin/sh
# 머지 충돌 해소 재시도 판정 — /dflow-team 팀장이 스윕의 "머지 실패(충돌)" id8 마다 부른다
# (references/merge-conflict.md 「1. 충돌 접수」, 설계 2026-09-23 §5.6).
# 사용: resolve-decide.sh <EVENTS> <LEAD_AGENT> <REPO> <id8> <DEV_SHA>
#   EVENTS     ~/.dflow/events.jsonl
#   LEAD_AGENT <신원>/<host>/lead      REPO 팀장 체크아웃 절대경로
#   DEV_SHA    지금 origin/<개발브랜치> 의 전체 sha(결과 사유 base=<짧은 sha> 와 접두로 비교한다)
# 출력: RESOLVE <다음 시도 번호>(exit 0) · HUMAN <사유>(exit 1) · UNKNOWN <사유>(exit 2) · RUNNING(exit 3)
# 카운터 = spawn_kind "resolve" 인 team.spawn 개수. 초기화하지 않는다(재개 카운터와 다르다 — 해소 워커는 시도마다
# .result 를 쓰므로 team.result 로 되돌리면 상한에 영영 닿지 않는다). 워커 자동 재시작(H)의 카운터와도 나눈다.
set -u
MAX=3
[ $# -eq 5 ] && [ -n "$4" ] && [ -n "$5" ] || { echo "UNKNOWN usage"; exit 2; }
ev=$1; lead=$2; repo=$3; id8=$4; dev=$5
command -v jq >/dev/null 2>&1 || { echo "UNKNOWN no-jq"; exit 2; }
[ -f "$ev" ] || { echo "RESOLVE 1"; exit 0; }

# 이 팀장·리포·id8 의 해소 관련 줄만 순서대로: S(해소 spawn) · R<TAB>status<TAB>reason · B(blocked). 다른 spawn 은 버린다.
lines=$(jq -r --arg a "$lead" --arg r "$repo" --arg i "$id8" '
  select(.agent == $a and .repo == $r and (.id8 // "") == $i)
  | if .event == "team.spawn" then (if (.spawn_kind // "new") == "resolve" then "S" else empty end)
    elif .event == "team.result" then "R\t\(.status // "")\t\(.reason // "")"
    elif .event == "team.blocked" then "B"
    else empty end' "$ev" 2>/dev/null) || { echo "UNKNOWN bad-events"; exit 2; }

n=$(printf '%s\n' "$lines" | grep -c '^S$')
[ "$n" -gt 0 ] || { echo "RESOLVE 1"; exit 0; }
# 마지막 해소 spawn 뒤의 마지막 판정 줄
last=$(printf '%s\n' "$lines" | awk '/^S$/{l=""; next} NF{l=$0} END{print l}')
case "$last" in
  ''|B) echo "RUNNING"; exit 3 ;;
esac
[ "$n" -lt "$MAX" ] || { echo "HUMAN 해소 상한($n/$MAX)"; exit 1; }
status=$(printf '%s' "$last" | cut -f2)
reason=$(printf '%s' "$last" | cut -f3)
next=$((n + 1))
case "$status" in
  resolved)
    base=$(printf '%s' "$reason" | sed -n 's/.*base=\([0-9a-f][0-9a-f]*\).*/\1/p')
    [ -n "$base" ] || { echo "HUMAN 해소 기준 불명"; exit 1; }
    case "$dev" in "$base"*) echo "HUMAN 같은 기준 재충돌(base=$base)"; exit 1 ;; esac
    echo "RESOLVE $next"; exit 0 ;;
  'failed push-race'|'failed rate-limit'|'failed no-result'|skipped)
    echo "RESOLVE $next"; exit 0 ;;
  *)
    echo "HUMAN 재시도 불가($status)"; exit 1 ;;
esac
