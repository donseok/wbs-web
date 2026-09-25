#!/usr/bin/env bash
# /dflow-team 기상 블록(SKILL.md 「2-3」). 팀장은 매 기상 맨 처음 이 스크립트를 한 번 부른다(팀장 체크아웃 루트에서).
# 사용: wake.sh --owner '<신원>/<host>/lead' --slots <N> --busy <M> --until-label '<UNTIL_LABEL>' [--pid <LEAD_PID>] [--no-events]
#
# 하는 일(순서대로):
#   1. 잠금 소유 확인: owner 의 신원이 --owner 이고 PID 가 팀장 세션 PID 와 같을 때만 beat 를 갱신한다.
#   2. 소유가 맞으면 lease holder 를 구해 좌석표 watch(STANDBY 신호)를 보내고 resume_requests 를 이 리포 바인딩으로 거른다.
#   3. lease 갱신 프로세스의 beat 나이를 본다.
#   4. events.md 「기록 명령」 절을 출력한다(이벤트는 이 출력의 블록으로만 기록한다). --no-events 면 뺀다.
#
# 출력 줄(글자 그대로):
#   LOCK_OK                                   소유 확인·beat 갱신 성공
#   {"n":…,"err":…,"reqs":[…],"other_project":[…]}   watch 응답의 재개 요청 요약(LOCK_OK 다음 줄)
#   WATCH_FAILED                              watch 호출 실패(잠금은 유효하다)
#   HOLDER_FAILED                             lease holder 조회 실패로 watch 를 부르지 않았다(잠금은 유효하다)
#   LOCK_LOST beat 쓰기 실패 | LOCK_LOST owner=<…> 내 PID=<pid>
#   LEASE_KEEP_DEAD 마지막 갱신 <epoch>
# 늘 exit 0(사용법 오류만 2). 판정은 출력 줄로 한다.
#
# 팀장 세션 PID: --pid, 없으면 CLAUDE_PID, 없으면 이 스크립트를 부른 셸의 부모다. 스크립트 안의 $PPID 는 Bash 도구의
# 셸이지 팀장 세션이 아니므로 그대로 쓰지 않는다. Windows 는 전제 검사가 CLAUDE_PID 를 필수로 요구한다.
set -u

usage() { echo "사용: wake.sh --owner <신원>/<host>/lead --slots <N> --busy <M> --until-label <표시> [--pid <PID>] [--no-events]" >&2; exit 2; }

OWNER=''; SLOTS=''; BUSY=''; LABEL=''; PID_ARG=''; EVENTS=1
while [ $# -gt 0 ]; do
  case "$1" in
    --owner) OWNER="${2:-}"; shift 2 ;;
    --slots) SLOTS="${2:-}"; shift 2 ;;
    --busy) BUSY="${2:-}"; shift 2 ;;
    --until-label) LABEL="${2:-}"; shift 2 ;;
    --pid) PID_ARG="${2:-}"; shift 2 ;;
    --no-events) EVENTS=0; shift ;;
    *) usage ;;
  esac
done
[ -n "$OWNER" ] && [ -n "$SLOTS" ] && [ -n "$BUSY" ] && [ -n "$LABEL" ] || usage

HERE=$(cd "$(dirname "$0")" && pwd)
DFLOW="${DFLOW_SH:-.claude/skills/dflow-work/scripts/dflow.sh}"
EVENTS_MD="$HERE/../references/events.md"

LEAD_PID=${PID_ARG:-${CLAUDE_PID:-$(ps -o ppid= -p "$PPID" 2>/dev/null | tr -d ' ')}}
LOCK=$(git rev-parse --git-path dflow-team.lock); o_who=; o_ts=; o_pid=
{ read -r o_who o_ts o_pid < "$LOCK/owner"; } 2>/dev/null || true
if [ "$o_who" = "$OWNER" ] && [ -n "$LEAD_PID" ] && [ "$o_pid" = "$LEAD_PID" ]; then
  date +%s > "$LOCK/beat" && { echo LOCK_OK
    h=$("$DFLOW" lease holder) || h=''
    if [ -n "$h" ]; then
      wr=$("$DFLOW" watch --agent "$o_who" \
        --slots "$SLOTS" --busy "$BUSY" --until "$LABEL" --json \
        --holder "$h") \
        && ps=$("$DFLOW" config projects) \
        && printf '%s' "$wr" | jq -c --arg ps "$ps" '($ps | split("\n")) as $ok
             | {n: (.resume_requests | if . == null then "NULL" else length end),
             err: (.resume_requests_error // "-"),
             reqs: [(.resume_requests // [])[] | select(.project_id as $p | $ok | index($p)) | {id8, code, host, requested_at}],
             other_project: [(.resume_requests // [])[] | select(.project_id as $p | ($ok | index($p)) | not) | .id8]}' \
        || echo "WATCH_FAILED"
    else
      echo "HOLDER_FAILED"
    fi
  } || echo "LOCK_LOST beat 쓰기 실패"
else
  echo "LOCK_LOST owner=$o_who $o_ts $o_pid 내 PID=$LEAD_PID"
fi
LB=$(git rev-parse --git-path dflow-team.lease).beat
lb=$(cat "$LB" 2>/dev/null); lb=${lb:-0}
[ $(( $(date +%s) - lb )) -lt 180 ] || echo "LEASE_KEEP_DEAD 마지막 갱신 ${lb}"
if [ "$EVENTS" = 1 ]; then
  sed -n '/^## 기록 명령/,$p' "$EVENTS_MD"   # 이벤트 기록 명령의 정본. 이 출력의 블록으로만 기록한다
fi
exit 0
