#!/usr/bin/env bash
# /dflow-team 입장 제어 — 새 팀원을 띄우기 직전에 PC 여유 자원을 본다. 절차 정본: ../SKILL.md 「5-3. 입장 제어」,
# 집행 자리: ../references/backends.md 「입장 제어」(모든 spawn 블록의 첫 단계).
#
# 2026-09-24 dmes-standard: 10코어·16GB PC 에서 팀원 6명이 동시에 무거운 검증을 돌려 load 52, 스왑 17GB/18GB,
# 압축 메모리 약 45GB 까지 올라 PC 전체가 멈추다시피 했다. 이미 모자란 PC 에 팀원을 더 얹지 않는다.
# 이미 떠 있는 팀원은 건드리지 않는다. 팀원 spawn 을 막는 것은 보안 가드가 아니라 성능 보호이므로, 판정할 수 없는 OS
# 나 명령 실패는 막지 않고 통과시키되(fail-open) 판정 불가라는 사실을 출력한다.
#
# 사용법
#   capacity.sh [--state <파일>]   입장 판정. 출력 한 줄(stdout):
#     CAPACITY_OK      free=64% swap=87% load=0.9 heavy_wait=0/2 pressure=normal os=darwin limits=…   exit 0
#     CAPACITY_LOW     <사유…> | free=… swap=… load=… heavy_wait=… …                                  exit 1  (이번에는 띄우지 않는다)
#     CAPACITY_UNKNOWN <사유> | …                                                                     exit 0  (막지 않는다)
#   capacity.sh max                팀 인원 상한. 출력 한 줄: TEAM_MAX <n> k=<K> ram=<GB>GB source=<default|DFLOW_TEAM_MAX> …
#
# 측정하지 못한 항목은 `?` 로 적고 `unknown=<항목,…>` 을 붙인다. 판정은 읽은 항목만으로 한다. 자원 항목(free·swap·load)
# 을 하나도 못 읽고 막을 사유도 없으면 CAPACITY_UNKNOWN 이다.
# --state 를 주면 지난 판정(첫 낱말)과 비교해 끝에 notify=1(바뀜) / notify=0(같음) 을 붙이고 이번 줄을 그 파일에
# 적는다. 파일이 없으면 지난 판정을 CAPACITY_OK 로 본다. 팀장은 notify=1 일 때만 사람에게 한 줄 알린다(TICK 마다
# 같은 알림을 되풀이하지 않는다).
#
# 판정 기준(한 곳에서 정의, 환경변수로 덮는다). 하나라도 걸리면 CAPACITY_LOW 다.
#   pressure = macOS 커널 판정(kern.memorystatus_vm_pressure_level 1 normal · 2 warn · 4 critical). warn 이상이면 막는다.
#   free     = 여유 메모리 비율. macOS 는 memory_pressure 의 "System-wide memory free percentage"(없으면 sysctl
#              kern.memorystatus_level), Linux 는 MemAvailable / MemTotal. 30% 미만이면 막는다.
#   load     = 5분 load average ÷ 논리 코어 수. 2.0 을 넘으면 막는다.
#   heavy_wait = 무거운 명령 슬롯(../../dflow-dev/scripts/heavy.sh)을 기다리는 수 / 슬롯 수. 기다리는 수가 슬롯 수
#              이상이면 막는다. 팀원을 더 얹어도 슬롯 앞 줄만 길어지고, 줄 선 팀원은 대기 중에도 턴을 태운다(16GB PC
#              는 슬롯 2개인데 팀원 6명이 줄을 섰다). heavy.sh status 첫 줄 `HEAVY_STATUS slots=<K> held=<N> waiting=<M>`
#              을 읽으며, 명령이 없거나 실패하거나 형식이 다르면 이 항목은 판정하지 않는다(fail-open).
#   swap     = 스왑 사용량 ÷ 물리 RAM × 100. **극단 안전망**으로만 둔다(150% 이상이면 막는다). macOS 스왑은 압박이
#              풀린 뒤에도 몇 시간씩 남아(실측: 압박 normal·스왑 12GB=76% 에서도 여유는 충분했다) 평상시 기준으로 쓸 수
#              없다. 압박은 pressure·free 가 본다.
MIN_FREE_PCT="${DFLOW_CAP_MIN_FREE_PCT:-30}"            # free 가 이보다 작으면 막는다
MAX_LOAD_PER_CPU="${DFLOW_CAP_MAX_LOAD_PER_CPU:-2.0}"   # load 가 이보다 크면 막는다
MAX_SWAP_PCT="${DFLOW_CAP_MAX_SWAP_PCT:-150}"           # swap 이 이 이상이면 막는다(극단 안전망)
TEAM_HARD_MAX=6                                          # 인원 상한의 천장(비용). DFLOW_TEAM_MAX 도 넘지 못한다
# 인원 상한(max): 기본 min(6, K+2). K 는 heavy.sh 와 같은 계산 — DFLOW_HEAVY_SLOTS, 없으면 max(1, ⌊RAM_GB/8⌋),
#   RAM 을 못 읽으면 2. 16GB 면 K=2 → 4명. 줄 설 슬롯보다 팀원이 둘 넘게 많으면 대기만 늘기 때문이다.
#   사람이 팀장 세션의 환경변수 DFLOW_TEAM_MAX(1~6)로 덮는다.
# 시험용 주입: DFLOW_CAP_OS(uname -s 대신), DFLOW_CAP_PROC(/proc 대신), DFLOW_CAP_NCPU(코어 수),
#   DFLOW_HEAVY_BIN(heavy.sh 경로)
set -u

MODE=check
STATE=
while [ $# -gt 0 ]; do
  case "$1" in
    --state) STATE="${2:-}"; shift 2 ;;
    max) MODE=max; shift ;;
    *) echo "사용법: capacity.sh [--state <파일>] | capacity.sh max" >&2; exit 2 ;;
  esac
done

OS="${DFLOW_CAP_OS:-$(uname -s 2>/dev/null)}"
PROC="${DFLOW_CAP_PROC:-/proc}"

isnum() { case "${1:-}" in ''|*[!0-9.]*) return 1 ;; *) return 0 ;; esac; }
isint() { case "${1:-}" in ''|*[!0-9]*) return 1 ;; *) return 0 ;; esac; }
pct() { awk -v a="$1" -v b="$2" 'BEGIN { if (b <= 0) exit 1; printf "%d", (a * 100 / b) + 0.5 }'; }
ncpu() {
  local n="${DFLOW_CAP_NCPU:-}"
  [ -n "$n" ] || n=$(getconf _NPROCESSORS_ONLN 2>/dev/null) || n=
  [ -n "$n" ] || n=$(sysctl -n hw.ncpu 2>/dev/null) || n=
  [ -n "$n" ] || n=$(nproc 2>/dev/null) || n=
  isnum "$n" && [ "$n" -gt 0 ] 2>/dev/null && echo "$n"
}
# heavy.sh 의 ram_gb 와 같은 반올림(GB)
ram_gb() {
  local b kb
  b=$(sysctl -n hw.memsize 2>/dev/null) || b=
  isint "$b" && { echo $(( (b + 536870912) / 1073741824 )); return 0; }
  kb=$(awk '/^MemTotal:/{print $2; exit}' "$PROC/meminfo" 2>/dev/null) || kb=
  isint "$kb" && { echo $(( (kb + 524288) / 1048576 )); return 0; }
  return 1
}

if [ "$MODE" = max ]; then
  g=$(ram_gb) || g=
  k="${DFLOW_HEAVY_SLOTS:-}"
  case "$k" in
    ''|*[!0-9]*|0) if [ -n "$g" ]; then k=$(( g / 8 )); [ "$k" -ge 1 ] || k=1; else k=2; fi ;;
  esac
  n=$(( k + 2 )); [ "$n" -le "$TEAM_HARD_MAX" ] || n=$TEAM_HARD_MAX
  src=default; extra=
  o="${DFLOW_TEAM_MAX:-}"
  if [ -n "$o" ]; then
    if isint "$o" && [ "$o" -ge 1 ]; then
      src=DFLOW_TEAM_MAX; n=$o
      [ "$n" -le "$TEAM_HARD_MAX" ] || { extra=" clamped=$o"; n=$TEAM_HARD_MAX; }
    else
      extra=" ignored=DFLOW_TEAM_MAX:$o"
    fi
  fi
  echo "TEAM_MAX $n k=$k ram=${g:-?}GB source=$src$extra"
  exit 0
fi

free=; swap=; load=; pressure=; unknown=; hslots=; hwait=

case "$OS" in
  Darwin|darwin)
    os=darwin
    f=$(memory_pressure -Q 2>/dev/null | sed -n 's/.*free percentage: *\([0-9][0-9]*\)%.*/\1/p' | head -n 1)
    [ -n "$f" ] || f=$(sysctl -n kern.memorystatus_level 2>/dev/null)
    isnum "$f" && free="$f"
    ram=$(sysctl -n hw.memsize 2>/dev/null)
    su=$(sysctl -n vm.swapusage 2>/dev/null | sed -n 's/.*used = *\([0-9.][0-9.]*\)\([MG]\).*/\1 \2/p')
    if isnum "$ram" && [ -n "$su" ]; then
      set -- $su
      mb="$1"; [ "$2" = G ] && mb=$(awk -v g="$1" 'BEGIN { print g * 1024 }')
      swap=$(pct "$mb" "$(awk -v b="$ram" 'BEGIN { print b / 1048576 }')") || swap=
    fi
    la=$(sysctl -n vm.loadavg 2>/dev/null | tr -d '{}' | awk '{ print $2 }')
    lv=$(sysctl -n kern.memorystatus_vm_pressure_level 2>/dev/null)
    case "$lv" in 1) pressure=normal ;; 2) pressure=warn ;; 4) pressure=critical ;; esac
    ;;
  Linux|linux)
    os=linux
    mi="$PROC/meminfo"
    if [ -r "$mi" ]; then
      mt=$(awk '/^MemTotal:/{print $2; exit}' "$mi"); ma=$(awk '/^MemAvailable:/{print $2; exit}' "$mi")
      st=$(awk '/^SwapTotal:/{print $2; exit}' "$mi"); sf=$(awk '/^SwapFree:/{print $2; exit}' "$mi")
      isnum "$mt" && isnum "$ma" && free=$(pct "$ma" "$mt")
      isnum "$mt" && isnum "$st" && isnum "$sf" && swap=$(pct "$((st - sf))" "$mt")
    fi
    la=$(awk '{ print $2; exit }' "$PROC/loadavg" 2>/dev/null)
    ;;
  *)
    os="${OS:-unknown}"
    ;;
esac

n=$(ncpu) || n=
if [ -n "${la:-}" ] && isnum "$la" && [ -n "$n" ]; then
  load=$(awk -v l="$la" -v c="$n" 'BEGIN { printf "%.1f", l / c }')
fi

# heavy.sh 를 찾는다. 스킬 묶음은 리포에 심링크로 설치되므로(스킬 폴더째 또는 스킬마다) 먼저 논리 경로(설치된
# 자리의 형제 스킬), 없으면 물리 경로(심링크가 가리키는 킷의 형제)를 본다.
heavy_bin() {
  local d c
  if [ -n "${DFLOW_HEAVY_BIN:-}" ]; then echo "$DFLOW_HEAVY_BIN"; return 0; fi
  d=$(dirname "$0")
  for c in "$(cd "$d/../.." 2>/dev/null && pwd)" "$(cd -P "$d/../.." 2>/dev/null && pwd)"; do
    [ -n "$c" ] && [ -f "$c/dflow-dev/scripts/heavy.sh" ] && { echo "$c/dflow-dev/scripts/heavy.sh"; return 0; }
  done
  return 1
}
if hb=$(heavy_bin) && [ -f "$hb" ]; then
  hs=$(bash "$hb" status 2>/dev/null | awk 'NR == 1 {
    if ($1 == "HEAVY_STATUS" && $2 ~ /^slots=[0-9]+$/ && $3 ~ /^held=[0-9]+$/ && $4 ~ /^waiting=[0-9]+$/) {
      sub(/^slots=/, "", $2); sub(/^waiting=/, "", $4); print $2, $4
    }
    exit }')
  if [ -n "$hs" ]; then
    set -- $hs
    [ "$1" -gt 0 ] 2>/dev/null && { hslots="$1"; hwait="$2"; }
  fi
fi

[ -n "$free" ] || unknown="${unknown}${unknown:+,}free"
[ -n "$swap" ] || unknown="${unknown}${unknown:+,}swap"
[ -n "$load" ] || unknown="${unknown}${unknown:+,}load"
[ -n "$hslots" ] || unknown="${unknown}${unknown:+,}heavy"

if [ -n "$hslots" ]; then hw="$hwait/$hslots"; else hw='?'; fi
metrics="free=${free:-?}% swap=${swap:-?}% load=${load:-?} heavy_wait=$hw"
[ -z "$pressure" ] || metrics="$metrics pressure=$pressure"
metrics="$metrics os=$os limits=free>=${MIN_FREE_PCT}%,load<=${MAX_LOAD_PER_CPU},heavy_wait<slots,swap<${MAX_SWAP_PCT}%"
[ -z "$unknown" ] || metrics="$metrics unknown=$unknown"

reasons=
[ -z "$free" ] || [ "$free" -ge "$MIN_FREE_PCT" ] || reasons="$reasons 여유메모리${free}%<${MIN_FREE_PCT}%"
[ -z "$swap" ] || [ "$swap" -lt "$MAX_SWAP_PCT" ] || reasons="$reasons 스왑${swap}%>=${MAX_SWAP_PCT}%"
if [ -n "$load" ] && awk -v l="$load" -v m="$MAX_LOAD_PER_CPU" 'BEGIN { exit !(l > m) }'; then
  reasons="$reasons load${load}/코어>${MAX_LOAD_PER_CPU}"
fi
case "$pressure" in warn|critical) reasons="$reasons 메모리압박=$pressure" ;; esac
[ -z "$hslots" ] || [ "$hwait" -lt "$hslots" ] || reasons="$reasons heavy대기${hwait}>=슬롯${hslots}"

if [ -n "$reasons" ]; then
  line="CAPACITY_LOW${reasons} | $metrics"; rc=1
elif [ -z "$free" ] && [ -z "$swap" ] && [ -z "$load" ]; then
  line="CAPACITY_UNKNOWN 판정 불가(os=$os) — 막지 않는다 | $metrics"; rc=0
else
  line="CAPACITY_OK $metrics"; rc=0
fi

if [ -n "$STATE" ]; then
  prev=$(sed -n '1s/^[0-9]* \([A-Z_]*\).*/\1/p' "$STATE" 2>/dev/null)
  cur=${line%% *}
  if [ "${prev:-CAPACITY_OK}" = "$cur" ]; then line="$line notify=0"; else line="$line notify=1"; fi
  printf '%s %s\n' "$(date +%s)" "$line" > "$STATE" 2>/dev/null || line="$line state_write_failed"
fi

echo "$line"
exit "$rc"
