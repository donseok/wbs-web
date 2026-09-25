#!/usr/bin/env bash
# /dflow-team 감시 루프(SKILL.md 「2-2」). 팀장은 팀장 체크아웃 루트에서 Bash run_in_background 로 부른다(셸 & 금지).
# 사용: tick.sh [--new-tick] [--may-skip] [--until '<UNTIL>'] --tm '<TM 또는 빈 값>' \
#               --owner '<신원>/<host>/lead' --slots <N> --until-label '<UNTIL_LABEL>' [--pid <LEAD_PID>] \
#               -- ['<워크트리>/<TASKS>/<TSK>/.result|<마지막 처리 해시 또는 ->|<pane id 또는 ->' …]
#       tick.sh --retire      세대만 올려 떠 있는 루프를 STALE 로 끝낸다(「7. 마감」). 새 루프는 띄우지 않는다
#
# 기동하면 세대 파일(git-path dflow-team.gen, 한 줄 `<세대> <다음 TICK epoch> [<건너뛴 TICK 수>]`)의 세대를 올린다.
# 옛 루프는 다음 확인에서 STALE 로 끝난다. --new-tick(시작·TICK 기상)이면 다음 TICK 을 지금+DFLOW_TICK_SEC(1800)초로
# 새로 정하고 건너뛴 수를 0 으로 되돌린다. 아니면 파일의 값을 그대로 쓴다(루프를 자주 바꿔도 TICK 이 밀리지 않는다).
#
# 마지막 줄이 기상 사유다(글자 그대로, 먼저 걸린 것 하나):
#   STALE · STOP_REQUESTED · LEASE_LOST <사유> · RESULT_READY <경로…> · PANE_DEAD <경로…> · TICK
# 그 앞에 올 수 있는 줄:
#   TICK_SKIPPED at=<epoch> next=<epoch>      변화 없는 TICK 을 건너뛰었다(아래)
#   EVIDENCE <id8> ct=<…> report=<…> heartbeat=<…> phase=<…> dirty=<…> status=<…>   건너뛸 때 잰 슬롯의 생존 증거.
#                                             팀장은 다음 TICK 에서 이 값을 그 슬롯의 "직전 TICK" 증거로 쓴다(SKILL.md 「3」)
#
# 변화 없는 TICK 건너뛰기(--may-skip 일 때만, 팀장 기상 간격은 최대 2 TICK): TICK 시각에 아래가 모두 참이면 TICK 을 내지
# 않고 한 번만 건너뛴다. 건너뛴 뒤의 다음 TICK 은 반드시 낸다(건너뛴 수는 세대 파일 셋째 칸에 남아 루프를 바꿔도 이어진다).
#   - 아직 건너뛴 TICK 이 없다(--new-tick 뒤 0).
#   - 종료 시각(--until)이 지나지 않았다. 형식을 읽지 못하면 건너뛰지 않는다.
#   - 진행 중 슬롯(결과 줄이 blocked 인 것은 뺀다)마다 생존 증거가 루프 기동 때와 달라졌고 서버 status 는 같다. 증거를
#     재지 못했으면(show 실패·경로 해석 실패) 건너뛰지 않는다. 한 슬롯이라도 증거가 그대로면 무응답이므로 깨운다.
#   - 승인 후보(sweep-check.sh)와 그 서버 status 가 루프 기동 때와 같다. 판정하지 못했으면 건너뛰지 않는다.
#   - wake.sh(잠금 beat·좌석표 watch)가 LOCK_OK 를 내고, 재개 요청 조회가 성공했으며 이 리포의 요청이 없고,
#     WATCH_FAILED·HOLDER_FAILED·LEASE_KEEP_DEAD·LOCK_LOST 가 없다. 건너뛸 때도 잠금 beat 와 STANDBY 가 끊기지 않는 것은
#     이 호출 덕이다.
# 증거 공식은 references/restart.md 「rate-limit 대기」 의 evidence 와 같은 재료다(HEAD 커밋 시각, show 의 최신 보고·
# last_heartbeat_at·heartbeat_phase, git status --porcelain 의 cksum).
#
# 시험용 환경변수: DFLOW_TICK_SEC(1800) · DFLOW_TICK_POLL(20) · DFLOW_SH(dflow.sh) · DFLOW_SWEEP_CHECK(sweep-check.sh)
set -u

usage() { echo "사용: tick.sh [--new-tick] [--may-skip] [--until <UNTIL>] --tm <TM> --owner <신원>/<host>/lead --slots <N> --until-label <표시> [--pid <PID>] -- [<경로|해시|pane> …]" >&2; exit 2; }

NEW_TICK=0; MAY_SKIP=0; UNTIL=''; TM=''; TM_SET=0; OWNER=''; SLOTS=''; LABEL=''; PID_ARG=''; RETIRE=0
while [ $# -gt 0 ]; do
  case "$1" in
    --retire) RETIRE=1; shift ;;
    --new-tick) NEW_TICK=1; shift ;;
    --may-skip) MAY_SKIP=1; shift ;;
    --until) UNTIL="${2:-}"; shift 2 ;;
    --tm) TM="${2:-}"; TM_SET=1; shift 2 ;;
    --owner) OWNER="${2:-}"; shift 2 ;;
    --slots) SLOTS="${2:-}"; shift 2 ;;
    --until-label) LABEL="${2:-}"; shift 2 ;;
    --pid) PID_ARG="${2:-}"; shift 2 ;;
    --) shift; break ;;
    *) usage ;;
  esac
done
[ "$RETIRE" = 1 ] || { [ "$TM_SET" = 1 ] && [ -n "$OWNER" ] && [ -n "$SLOTS" ] && [ -n "$LABEL" ]; } || usage

HERE=$(cd "$(dirname "$0")" && pwd)
DFLOW="${DFLOW_SH:-.claude/skills/dflow-work/scripts/dflow.sh}"
SWEEP="${DFLOW_SWEEP_CHECK:-$HERE/../../dflow-merge/scripts/sweep-check.sh}"
INTERVAL="${DFLOW_TICK_SEC:-1800}"
POLL="${DFLOW_TICK_POLL:-20}"
LEAD_PID=${PID_ARG:-${CLAUDE_PID:-$(ps -o ppid= -p "$PPID" 2>/dev/null | tr -d ' ')}}

# 세 경로는 git 에 직접 묻는다(링크드 워크트리에선 .git 이 파일이라 손으로 조립하지 않는다)
GEN_FILE=$(git rev-parse --path-format=absolute --git-path dflow-team.gen) || { echo "FAIL NOT_GIT" >&2; exit 2; }
STOP_FILE=$(git rev-parse --path-format=absolute --git-path dflow-team.stop)
LEASE_FILE=$(git rev-parse --path-format=absolute --git-path dflow-team.lease-lost)

old_gen=; old_tick=; old_skip=
{ read -r old_gen old_tick old_skip < "$GEN_FILE"; } 2>/dev/null || true
case "$old_gen" in ''|*[!0-9]*) old_gen=0 ;; esac
MY_GEN=$(( old_gen + 1 ))
case "$old_tick" in ''|*[!0-9]*) NEW_TICK=1 ;; esac
case "$old_skip" in ''|*[!0-9]*) old_skip=0 ;; esac
if [ "$RETIRE" = 1 ]; then
  printf '%s %s %s\n' "$MY_GEN" "${old_tick:-0}" "$old_skip" > "$GEN_FILE"; echo "GEN_RETIRED gen=$MY_GEN"; exit 0
fi
if [ "$NEW_TICK" = 1 ]; then TICK_AT=$(( $(date +%s) + INTERVAL )); SKIPPED=0
else TICK_AT=$old_tick; SKIPPED=$old_skip; fi
printf '%s %s %s\n' "$MY_GEN" "$TICK_AT" "$SKIPPED" > "$GEN_FILE"

# 종료 시각(epoch). 전제 검사와 같은 해석(BSD date -j 먼저, 없으면 GNU date -d)
UNTIL_E=''; UNTIL_BAD=0
if [ -n "$UNTIL" ] && [ "$UNTIL" != none ]; then
  case "$UNTIL" in ??:??) u="$(date +%Y-%m-%d) $UNTIL" ;; *) u="$UNTIL" ;; esac
  UNTIL_E=$(date -j -f '%Y-%m-%d %H:%M:%S' "$u:00" +%s 2>/dev/null || date -d "$u" +%s 2>/dev/null) || UNTIL_E=''
  [ -n "$UNTIL_E" ] || UNTIL_BAD=1
fi

# 슬롯 항목의 .result 경로에서 워크트리 루트와 id8 을 뽑는다(<…>/dflow-<id8>[-resolve]/…)
slot_root() { printf '%s\n' "$1" | sed -n 's#^\(.*/dflow-[0-9a-f]\{8\}\(-resolve\)\{0,1\}\)/.*#\1#p'; }
slot_id8() { printf '%s\n' "$1" | sed -n 's#^.*/dflow-\([0-9a-f]\{8\}\)\(-resolve\)\{0,1\}/.*#\1#p'; }

# 한 슬롯의 증거 한 줄: <id8> ct=… report=… heartbeat=… phase=… dirty=… status=…  (재지 못하면 빈 출력)
evidence() {
  f=$1; w=$(slot_root "$f"); i=$(slot_id8 "$f")
  [ -n "$w" ] && [ -n "$i" ] && [ -d "$w" ] || return 1
  e1=$(git -C "$w" log -1 --format=%ct 2>/dev/null)
  e2=$( ("$DFLOW" show "$i") 2>/dev/null \
    | jq -r 'select((.order.id // "") != "") | "report=\(([.reports[]?] | last | .created_at) // "-") heartbeat=\(.order.last_heartbeat_at // "-") phase=\(.order.heartbeat_phase // "-")|\(.order.status // "-")"' 2>/dev/null )
  [ -n "$e2" ] || return 1
  e3=$(git -C "$w" status --porcelain 2>/dev/null | cksum | cut -d' ' -f1)
  printf '%s ct=%s %s dirty=%s status=%s\n' "$i" "${e1:--}" "${e2%%|*}" "$e3" "${e2##*|}"
}

# 진행 중(결과 줄이 blocked 가 아닌) 슬롯인가
active() {
  [ -f "$1" ] || return 0
  st=$(head -n 1 "$1" | cut -d' ' -f6)
  [ "$st" != blocked ]
}

# 승인 후보와 그 서버 status. 판정하지 못하면 UNKNOWN
approvals() {
  [ -x "$SWEEP" ] || { echo UNKNOWN; return; }
  out=$("$SWEEP" 2>/dev/null) || { echo UNKNOWN; return; }
  last=$(printf '%s\n' "$out" | tail -n 1)
  printf '%s\n' "$out" | grep '^SWEEP_DIALECT_PENDING' || :
  case "$last" in
    SWEEP_NONE) echo NONE ;;
    'SWEEP_CANDIDATES '*)
      for i in $(printf '%s\n' "$last" | cut -d' ' -f3-); do
        st=$( ("$DFLOW" show "$i") 2>/dev/null | jq -r '.order.status // empty' 2>/dev/null )
        [ -n "$st" ] || { echo UNKNOWN; return; }
        printf '%s %s\n' "$i" "$st"
      done ;;
    *) echo UNKNOWN ;;
  esac
}

BASE_EV=''; BASE_AP=''
if [ "$MAY_SKIP" = 1 ]; then
  for s in "$@"; do
    f=${s%%|*}
    active "$f" || continue
    BASE_EV="$BASE_EV$(evidence "$f" || echo "UNMEASURED $f")
"
  done
  BASE_AP=$(approvals)
fi

# 이번 TICK 을 건너뛸 수 있으면 0. 건너뛸 때 낼 EVIDENCE 줄을 SKIP_EV 에 담는다
may_skip_now() {
  SKIP_EV=''
  [ "$MAY_SKIP" = 1 ] || return 1
  [ "$SKIPPED" -lt 1 ] || return 1
  [ "$UNTIL_BAD" = 0 ] || return 1
  [ -z "$UNTIL_E" ] || [ "$(date +%s)" -lt "$UNTIL_E" ] || return 1
  for s in "$@"; do
    f=${s%%|*}
    active "$f" || continue
    now_ev=$(evidence "$f") || return 1
    i=${now_ev%% *}
    prev=$(printf '%s' "$BASE_EV" | grep "^$i " | head -n 1)
    [ -n "$prev" ] || return 1
    [ "${prev##* status=}" = "${now_ev##* status=}" ] || return 1          # 서버 status 가 바뀌었다(중단·보고 등)
    [ "${prev% status=*}" != "${now_ev% status=*}" ] || return 1          # 증거가 그대로다: 무응답
    SKIP_EV="${SKIP_EV}EVIDENCE $now_ev
"
  done
  case "$BASE_AP" in *UNKNOWN*) return 1 ;; esac
  now_ap=$(approvals)
  [ "$now_ap" = "$BASE_AP" ] || return 1
  wk=$("$HERE/wake.sh" --owner "$OWNER" --slots "$SLOTS" --busy "$#" --until-label "$LABEL" --pid "$LEAD_PID" --no-events 2>/dev/null)
  printf '%s\n' "$wk" | grep -qx LOCK_OK || return 1
  printf '%s\n' "$wk" | grep -qE '^(LOCK_LOST|WATCH_FAILED|HOLDER_FAILED|LEASE_KEEP_DEAD)' && return 1
  j=$(printf '%s\n' "$wk" | grep '^{' | head -n 1)
  [ -n "$j" ] || return 1
  printf '%s' "$j" | jq -e '(.n != "NULL") and ((.reqs // []) | length == 0)' >/dev/null 2>&1 || return 1
  return 0
}

while :; do
  [ "$(cut -d' ' -f1 "$GEN_FILE" 2>/dev/null)" = "$MY_GEN" ] || { echo STALE; exit 0; }
  [ -e "$STOP_FILE" ] && { echo STOP_REQUESTED; exit 0; }
  [ -e "$LEASE_FILE" ] && { echo "LEASE_LOST $(head -n 1 "$LEASE_FILE")"; exit 0; }
  hit=''; dead=''
  for s in "$@"; do
    f=${s%%|*}; rest=${s#*|}; prev=${rest%%|*}; pane=${rest#*|}
    if [ -f "$f" ]; then
      cur=$(head -n 1 "$f"); sum=$(printf '%s\n' "$cur" | cksum | cut -d' ' -f1)
      [ "$sum" = "$prev" ] || hit="$hit $f"
    fi
    if [ "$pane" != - ] && [ -n "$TM" ]; then
      d=$("$TM" -L dflow list-panes -t "$pane" -F '#{pane_dead}' 2>/dev/null | head -n 1)
      [ "$d" = 0 ] || dead="$dead $f"
    fi
  done
  [ -n "$hit" ] && { echo "RESULT_READY$hit"; exit 0; }
  [ -n "$dead" ] && { echo "PANE_DEAD$dead"; exit 0; }
  if [ "$(date +%s)" -ge "$TICK_AT" ]; then
    may_skip_now "$@" || { echo TICK; exit 0; }
    [ "$(cut -d' ' -f1 "$GEN_FILE" 2>/dev/null)" = "$MY_GEN" ] || { echo STALE; exit 0; }
    SKIPPED=$(( SKIPPED + 1 )); at=$(date +%s); TICK_AT=$(( TICK_AT + INTERVAL ))
    [ "$TICK_AT" -gt "$at" ] || TICK_AT=$(( at + INTERVAL ))
    printf '%s %s %s\n' "$MY_GEN" "$TICK_AT" "$SKIPPED" > "$GEN_FILE"
    echo "TICK_SKIPPED at=$at next=$TICK_AT"
    printf '%s' "$SKIP_EV"
  fi
  sleep "$POLL"
done
