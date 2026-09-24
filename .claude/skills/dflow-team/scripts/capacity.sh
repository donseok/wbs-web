#!/usr/bin/env bash
# /dflow-team 입장 제어 — 새 팀원을 띄우기 직전에 PC 여유 자원을 본다. 절차 정본: ../SKILL.md 「5-3. 입장 제어」.
#
# 2026-09-24 dmes-standard: 10코어·16GB PC 에서 팀원 6명이 동시에 무거운 검증을 돌려 load 52, 스왑 17GB/18GB,
# 압축 메모리 약 45GB 까지 올라 PC 전체가 멈추다시피 했다. 이미 모자란 PC 에 팀원을 더 얹지 않는다.
# 이미 떠 있는 팀원은 건드리지 않는다. 팀원 spawn 을 막는 것은 보안 가드가 아니라 성능 보호이므로, 판정할 수 없는 OS
# 나 명령 실패는 막지 않고 통과시키되(fail-open) 판정 불가라는 사실을 출력한다.
#
# 사용법: capacity.sh [--state <파일>]
# 출력 한 줄(stdout):
#   CAPACITY_OK      free=64% swap=87% load=1.9 pressure=normal os=darwin              exit 0
#   CAPACITY_LOW     <사유…> | free=… swap=… load=… …                                   exit 1  (이번 기상에는 띄우지 않는다)
#   CAPACITY_UNKNOWN <사유> | …                                                          exit 0  (막지 않는다)
# 측정하지 못한 항목은 `?` 로 적고 `unknown=<항목,…>` 을 붙인다. 판정은 읽은 항목만으로 한다.
# --state 를 주면 지난 판정(첫 낱말)과 비교해 끝에 notify=1(바뀜) / notify=0(같음) 을 붙이고 이번 줄을 그 파일에
# 적는다. 파일이 없으면 지난 판정을 CAPACITY_OK 로 본다. 팀장은 notify=1 일 때만 사람에게 한 줄 알린다(TICK 마다
# 같은 알림을 되풀이하지 않는다).
#
# 기준값(한 곳에서 정의, 환경변수로 덮는다)
#   free  = 여유 메모리 비율. macOS 는 memory_pressure 의 "System-wide memory free percentage"(없으면 sysctl
#           kern.memorystatus_level), Linux 는 MemAvailable / MemTotal.
#   swap  = 스왑 사용량 ÷ 물리 RAM × 100. macOS 는 sysctl vm.swapusage 의 used, Linux 는 SwapTotal − SwapFree.
#           스왑 전체 크기가 아니라 RAM 에 견주는 이유: macOS 는 스왑 파일을 필요할 때 늘리므로 used/total 이 늘 높다.
#   load  = 5분 load average ÷ 논리 코어 수.
#   pressure = macOS 커널 판정(kern.memorystatus_vm_pressure_level 1 normal · 2 warn · 4 critical). warn 이상이면 막는다.
MIN_FREE_PCT="${DFLOW_CAP_MIN_FREE_PCT:-30}"      # free 가 이보다 작으면 막는다
MAX_SWAP_PCT="${DFLOW_CAP_MAX_SWAP_PCT:-100}"     # swap 이 이 이상이면 막는다
MAX_LOAD_PER_CPU="${DFLOW_CAP_MAX_LOAD_PER_CPU:-1.5}"  # load 가 이보다 크면 막는다
# 시험용 주입: DFLOW_CAP_OS(uname -s 대신), DFLOW_CAP_PROC(/proc 대신), DFLOW_CAP_NCPU(코어 수)
set -u

STATE=
while [ $# -gt 0 ]; do
  case "$1" in
    --state) STATE="${2:-}"; shift 2 ;;
    *) echo "사용법: capacity.sh [--state <파일>]" >&2; exit 2 ;;
  esac
done

OS="${DFLOW_CAP_OS:-$(uname -s 2>/dev/null)}"
PROC="${DFLOW_CAP_PROC:-/proc}"
free=; swap=; load=; pressure=; unknown=

isnum() { case "${1:-}" in ''|*[!0-9.]*) return 1 ;; *) return 0 ;; esac; }
pct() { awk -v a="$1" -v b="$2" 'BEGIN { if (b <= 0) exit 1; printf "%d", (a * 100 / b) + 0.5 }'; }
ncpu() {
  local n="${DFLOW_CAP_NCPU:-}"
  [ -n "$n" ] || n=$(getconf _NPROCESSORS_ONLN 2>/dev/null) || n=
  [ -n "$n" ] || n=$(sysctl -n hw.ncpu 2>/dev/null) || n=
  [ -n "$n" ] || n=$(nproc 2>/dev/null) || n=
  isnum "$n" && [ "$n" -gt 0 ] 2>/dev/null && echo "$n"
}

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

[ -n "$free" ] || unknown="${unknown}${unknown:+,}free"
[ -n "$swap" ] || unknown="${unknown}${unknown:+,}swap"
[ -n "$load" ] || unknown="${unknown}${unknown:+,}load"

metrics="free=${free:-?}% swap=${swap:-?}% load=${load:-?}"
[ -z "$pressure" ] || metrics="$metrics pressure=$pressure"
metrics="$metrics os=$os limits=free>=${MIN_FREE_PCT}%,swap<${MAX_SWAP_PCT}%,load<=${MAX_LOAD_PER_CPU}"
[ -z "$unknown" ] || metrics="$metrics unknown=$unknown"

reasons=
[ -z "$free" ] || [ "$free" -ge "$MIN_FREE_PCT" ] || reasons="$reasons 여유메모리${free}%<${MIN_FREE_PCT}%"
[ -z "$swap" ] || [ "$swap" -lt "$MAX_SWAP_PCT" ] || reasons="$reasons 스왑${swap}%>=${MAX_SWAP_PCT}%"
if [ -n "$load" ] && awk -v l="$load" -v m="$MAX_LOAD_PER_CPU" 'BEGIN { exit !(l > m) }'; then
  reasons="$reasons load${load}/코어>${MAX_LOAD_PER_CPU}"
fi
case "$pressure" in warn|critical) reasons="$reasons 메모리압박=$pressure" ;; esac

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
