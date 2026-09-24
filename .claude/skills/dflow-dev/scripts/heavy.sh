#!/usr/bin/env bash
# 무거운 명령 줄 세우기 — PC 전역 세마포어. 규칙 정본: ../references/dev-discipline.md 「무거운 명령 줄 세우기」.
#
# 전체 테스트·빌드·E2E 서버처럼 메모리를 크게 쓰는 명령을 PC 전체에서 동시에 K개까지만 돌린다. 리포가 달라도
# 같은 PC 면 같은 슬롯을 나눠 쓴다(2026-09-24 dmes-standard: 팀원 6명이 testAll·Testcontainers·E2E 서버를 동시에
# 돌려 load 52, 스왑 17GB/18GB). flock 은 macOS 에 없으므로 mkdir 의 원자성으로 슬롯을 잡는다(Git Bash 도 같다).
#
# 사용법
#   heavy.sh <명령> [인자…]   슬롯을 얻어 명령을 돌린다. 끝나거나 중단(INT·TERM·HUP)되면 슬롯을 푼다. exit 는 명령의 것.
#   heavy.sh acquire <이름>   세션이 슬롯 하나를 붙잡는다(E2E 서버를 띄우기 직전). 소유자는 이 세션(아래 OWNER).
#                             같은 세션의 이후 `heavy.sh <명령>` 은 이 슬롯을 다시 쓴다(두 번째 슬롯을 기다리지 않는다).
#   heavy.sh release          이 세션이 붙잡은 슬롯을 푼다(서버를 끈 직후).
#   heavy.sh status           K 와 슬롯 현황(도커 슬롯 포함).
#   heavy.sh --pool docker <명령> [인자…]
#                             도커를 쓰는 명령(Testcontainers·docker compose·방언 검증). PC 전역 **도커 슬롯**(기본 1개)과
#                             일반 슬롯 하나를 **함께** 잡는다. 도커 명령도 무거운 명령이라 일반 슬롯 수(K)에 들어가야
#                             PC 전체 동시 실행이 K 를 넘지 않는다. 이 세션이 이미 일반 슬롯을 쥐고 있으면(acquire·감싼
#                             실행 안) 도커 슬롯만 잡는다.
#
# 교착을 피하는 규칙(불변식): **도커 슬롯을 쥔 쪽은 아무것도 기다리지 않는다.** 도커 슬롯은 늘 마지막에, 필요한
# 슬롯을 한 번에 모두 잡는다 — 도커 슬롯을 잡았는데 일반 슬롯이 없으면 그 자리에서 도커 슬롯을 돌려주고 다음 시도로
# 간다(쥐고 기다리지 않는다). 그래서 "일반 슬롯을 쥐고 도커를 기다리는 쪽" 과 "도커를 쥐고 일반을 기다리는 쪽" 이 서로를
# 막는 순환이 생기지 않는다. 일반 슬롯을 쥔 채 도커 슬롯을 기다리는 쪽은 있을 수 있지만, 도커 슬롯 보유자는 이미 필요한
# 것을 다 가진 채 돌고 있으므로 끝나면 풀린다. 감싼 실행 안의 acquire 도 새 슬롯을 기다리지 않는다(아래 cmd_acquire).
#
# 슬롯을 DFLOW_HEAVY_WAIT 초(기본 240) 안에 못 얻으면 명령을 돌리지 않고 stderr 에
#   HEAVY_BUSY k=<K> wait=<초>s 보유: [slot-1 pid=… 12분 run] <명령> | …
# 한 줄을 내고 exit 75(EX_TEMPFAIL)로 끝난다. 실패가 아니다 — 같은 명령을 다시 호출한다. 대기 상한이 있는 이유:
# 워커의 heartbeat 는 도구 호출 때 훅이 보내므로 Bash 한 번으로 오래 기다리면 팀장이 무응답(약 5분)으로 오판한다.
# 슬롯을 얻은 뒤의 명령 실행 시간에는 상한이 없다.
#
# 환경변수
#   DFLOW_HEAVY_SLOTS    K. 기본 max(1, floor(RAM_GB/8)) — 16GB 면 2. RAM 을 못 읽으면 2.
#   DFLOW_HEAVY_DOCKER_SLOTS  도커 슬롯 수. 기본 1(같은 목적의 컨테이너를 PC 에서 하나만 띄운다).
#   DFLOW_HEAVY_DIR      슬롯 폴더. 기본 ~/.dflow/locks/heavy (시험은 임시 폴더로 바꾼다)
#   DFLOW_HEAVY_WAIT     슬롯 대기 상한(초). 기본 240
#   DFLOW_HEAVY_POLL     재시도 간격(초). 기본 2
#   DFLOW_HEAVY_HOLD_TTL acquire 슬롯의 최대 보유(초). 기본 3600. 넘으면 버려진 것으로 보고 회수한다
#                        (release 를 잊은 세션이 몇 시간씩 슬롯을 막지 않게).
#   DFLOW_HEAVY_OWNER    acquire·release 의 소유 PID. 기본 CLAUDE_PID, 없으면 PPID.
#
# 슬롯 = <DIR>/slot-<i> 폴더(1..K), 도커 슬롯 = <DIR>/docker-<i> 폴더. 안의 owner 파일에 pid·kind(run|hold)·start(epoch)·pstart(ps lstart)·host·cwd·cmd.
# 소유 PID 가 죽었거나(kill -0 실패, 또는 lstart 가 달라 PID 가 재사용됨) hold 의 TTL 이 지났으면 회수한다.
# 회수는 <DIR>/slot-<i>.reclaim mkdir 뮤텍스 안에서 owner 를 다시 읽고 확인한 뒤에만 지운다.
#
# 출력(stderr): HEAVY_WAIT · HEAVY_SLOT · HEAVY_REUSE · HEAVY_RECLAIM · HEAVY_BUSY · HEAVY_ACQUIRED · HEAVY_RELEASED
#   도커 풀은 HEAVY_DOCKER_WAIT · HEAVY_DOCKER_SLOT · HEAVY_DOCKER_BUSY(exit 75, 일반 풀의 HEAVY_BUSY 와 같은 규약)
# 도커 풀 실행은 DFLOW_HEAVY_DOCKER_HELD 에 도커 슬롯 경로를 export 한다(안쪽 --pool docker 호출은 기다리지 않는다).
set -u

DIR="${DFLOW_HEAVY_DIR:-$HOME/.dflow/locks/heavy}"
WAIT="${DFLOW_HEAVY_WAIT:-240}"
POLL="${DFLOW_HEAVY_POLL:-2}"
HOLD_TTL="${DFLOW_HEAVY_HOLD_TTL:-3600}"
BUSY_RC=75

ram_gb() {
  local b kb
  b=$(sysctl -n hw.memsize 2>/dev/null) || b=
  case "$b" in ''|*[!0-9]*) ;; *) echo $(( (b + 536870912) / 1073741824 )); return 0 ;; esac
  kb=$(awk '/^MemTotal:/{print $2; exit}' /proc/meminfo 2>/dev/null) || kb=
  case "$kb" in ''|*[!0-9]*) ;; *) echo $(( (kb + 524288) / 1048576 )); return 0 ;; esac
  return 1
}

slots() {
  local k="${DFLOW_HEAVY_SLOTS:-}" g
  case "$k" in
    ''|*[!0-9]*|0) if g=$(ram_gb); then k=$(( g / 8 )); [ "$k" -ge 1 ] || k=1; else k=2; fi ;;
  esac
  echo "$k"
}

K=$(slots)
KD="${DFLOW_HEAVY_DOCKER_SLOTS:-1}"
case "$KD" in ''|*[!0-9]*|0) KD=1 ;; esac
now() { date +%s; }
# 시작 시각은 로캘을 고정해 읽는다. 세션마다 LANG·LC_TIME 이 달라도 같은 문자열이 나와야 살아 있는 소유자를
# PID 재사용으로 오판하지 않는다. Git Bash 의 ps 는 -o 를 모르므로 빈 값(= 확인 생략)이 된다.
pstart() { LC_ALL=C ps -o lstart= -p "$1" 2>/dev/null | sed 's/^ *//;s/ *$//'; }
# PID 생존 확인. Windows(Git Bash/MSYS)는 CLAUDE_PID 가 네이티브 Windows PID 라 kill -0 이 못 알아본다 —
# 살아 있는 hold 를 죽은 것으로 보고 회수하지 않도록 `ps -W` 의 WINPID 열에서 한 번 더 찾는다(dflow-lease.sh 와 같은 방식).
alive() {
  kill -0 "$1" 2>/dev/null && return 0
  case "$(uname -s 2>/dev/null)" in
    MINGW*|MSYS*|CYGWIN*)
      ps -W 2>/dev/null | awk -v pid="$1" '
        NR==1 { for (i=1;i<=NF;i++) if ($i=="WINPID") c=i; next }
        c && $c==pid { found=1 }
        END { exit !found }' ;;
    *) return 1 ;;
  esac
}
field() { sed -n "s/^$2=//p" "$1/owner" 2>/dev/null | head -n 1; }
owner_pid() { echo "${DFLOW_HEAVY_OWNER:-${CLAUDE_PID:-$PPID}}"; }

# 죽은 소유자·만료된 hold·주인 없이 1분 넘은 폴더면 0(회수 대상)
stale() {
  local d="$1" pid ps0 ps1 kind st
  [ -d "$d" ] || return 1
  if [ ! -f "$d/owner" ]; then
    # mkdir 직후 owner 를 쓰기 전일 수 있다. 1분 넘게 비어 있을 때만 버려진 것으로 본다.
    [ -n "$(find "$d" -maxdepth 0 -mmin +1 2>/dev/null)" ]
    return
  fi
  pid=$(field "$d" pid); kind=$(field "$d" kind); st=$(field "$d" start)
  case "$pid" in ''|*[!0-9]*) return 0 ;; esac
  alive "$pid" || return 0
  ps0=$(field "$d" pstart)
  if [ -n "$ps0" ] && [ "$ps0" != "-" ]; then
    ps1=$(pstart "$pid")
    [ -z "$ps1" ] || [ "$ps1" = "$ps0" ] || return 0   # PID 재사용
  fi
  if [ "$kind" = hold ]; then
    case "$st" in ''|*[!0-9]*) ;; *) [ $(( $(now) - st )) -le "$HOLD_TTL" ] || return 0 ;; esac
  fi
  return 1
}

reclaim() {
  local d="$1" m="$1.reclaim" who
  if ! mkdir "$m" 2>/dev/null; then
    # 회수하던 프로세스가 뮤텍스를 쥔 채 죽었으면 1분 뒤 뮤텍스를 치운다
    [ -z "$(find "$m" -maxdepth 0 -mmin +1 2>/dev/null)" ] || rmdir "$m" 2>/dev/null
    return 1
  fi
  if stale "$d"; then
    who="pid=$(field "$d" pid) kind=$(field "$d" kind) cmd=$(field "$d" cmd)"
    rm -rf "$d" && echo "HEAVY_RECLAIM $(basename "$d") $who" >&2
  fi
  rmdir "$m" 2>/dev/null
  return 0
}

# $1 kind  $2 pid  $3 cmd  [$4 접두(slot|docker) $5 개수] — 빈 슬롯을 잡으면 SLOT(도커면 DSLOT)에 경로를 넣고 0
take() {
  local i d t p c pre="${4:-slot}" n="${5:-$K}"
  p=$(pstart "$2"); c=$(printf '%s' "$3" | tr '\n' ' ')
  for i in $(seq 1 "$n"); do
    d="$DIR/$pre-$i"
    if mkdir "$d" 2>/dev/null; then
      t="$d/owner.tmp.$$"
      {
        echo "pid=$2"
        echo "kind=$1"
        echo "start=$(now)"
        echo "pstart=${p:--}"
        echo "host=$(hostname 2>/dev/null || uname -n)"
        echo "cwd=$PWD"
        echo "cmd=$c"
      } > "$t" && mv "$t" "$d/owner" || { rm -rf "$d"; continue; }
      if [ "$pre" = docker ]; then DSLOT="$d"; else SLOT="$d"; fi
      return 0
    fi
  done
  return 1
}

holders() { # [$1 접두(slot|docker) $2 개수]
  local i d out="" age pre="${1:-slot}" n="${2:-$K}"
  for i in $(seq 1 "$n"); do
    d="$DIR/$pre-$i"
    [ -d "$d" ] || continue
    age=$(field "$d" start); case "$age" in ''|*[!0-9]*) age='?' ;; *) age=$(( ($(now) - age) / 60 )) ;; esac
    out="$out${out:+ | }[$pre-$i pid=$(field "$d" pid) ${age}분 $(field "$d" kind)] $(field "$d" cmd)"
  done
  echo "$out"
}

# 대기 상한 안에 슬롯을 잡는다. 못 잡으면 HEAVY_BUSY 를 내고 1
wait_slot() {
  local kind="$1" pid="$2" cmd="$3" deadline announced=0 i
  # 슬롯 폴더를 못 만들면 줄 세우기를 포기하고 그냥 돌린다(성능 보호이지 보안 가드가 아니다 — fail-open)
  mkdir -p "$DIR" 2>/dev/null || { echo "HEAVY_UNLOCKED 슬롯 폴더를 만들 수 없음: $DIR" >&2; return 2; }
  deadline=$(( $(now) + WAIT ))
  while :; do
    take "$kind" "$pid" "$cmd" && return 0
    for i in $(seq 1 "$K"); do stale "$DIR/slot-$i" && reclaim "$DIR/slot-$i"; done
    take "$kind" "$pid" "$cmd" && return 0
    if [ "$(now)" -ge "$deadline" ]; then
      echo "HEAVY_BUSY k=$K wait=${WAIT}s 보유: $(holders)" >&2
      return 1
    fi
    [ "$announced" = 1 ] || { echo "HEAVY_WAIT k=$K 보유: $(holders)" >&2; announced=1; }
    sleep "$POLL"
  done
}

# 도커 풀: 대기 상한 안에 도커 슬롯(+ need_general=1 이면 일반 슬롯)을 **한 번에** 잡는다. 도커 슬롯을 잡았는데
# 일반 슬롯이 없으면 도커 슬롯을 곧바로 돌려준다 — 도커 슬롯을 쥔 채 기다리지 않는다(머리의 교착 불변식).
# 못 잡으면 HEAVY_DOCKER_BUSY 를 내고 1
wait_docker() {
  local pid="$1" cmd="$2" need="$3" deadline announced=0 i
  mkdir -p "$DIR" 2>/dev/null || { echo "HEAVY_UNLOCKED 슬롯 폴더를 만들 수 없음: $DIR" >&2; return 2; }
  deadline=$(( $(now) + WAIT ))
  while :; do
    DSLOT=; SLOT=
    if take run "$pid" "[docker] $cmd" docker "$KD"; then
      if [ "$need" = 0 ] || take run "$pid" "[docker] $cmd" slot "$K"; then return 0; fi
      rm -rf "$DSLOT"; DSLOT=
    fi
    for i in $(seq 1 "$KD"); do stale "$DIR/docker-$i" && reclaim "$DIR/docker-$i"; done
    for i in $(seq 1 "$K"); do stale "$DIR/slot-$i" && reclaim "$DIR/slot-$i"; done
    if [ "$(now)" -ge "$deadline" ]; then
      echo "HEAVY_DOCKER_BUSY k=$K docker=$KD wait=${WAIT}s 도커: $(holders docker "$KD") 일반: $(holders)" >&2
      return 1
    fi
    [ "$announced" = 1 ] || { echo "HEAVY_DOCKER_WAIT k=$K docker=$KD 도커: $(holders docker "$KD") 일반: $(holders)" >&2; announced=1; }
    sleep "$POLL"
  done
}

# 이 세션(OWNER)이 acquire 로 붙잡은 슬롯 경로들
held_by() {
  local i d
  for i in $(seq 1 "$K"); do
    d="$DIR/slot-$i"
    [ "$(field "$d" kind)" = hold ] && [ "$(field "$d" pid)" = "$1" ] && echo "$d"
  done
  return 0
}

mine_release() { # 내 것일 때만 지운다(회수된 뒤 남이 잡은 슬롯을 지우지 않게)
  [ -n "${SLOT:-}" ] && [ "$(field "$SLOT" pid)" = "$MYPID" ] && rm -rf "$SLOT"
  [ -n "${DSLOT:-}" ] && [ "$(field "$DSLOT" pid)" = "$MYPID" ] && rm -rf "$DSLOT"
  SLOT=; DSLOT=
}

cmd_run() {
  local rc h
  [ $# -ge 1 ] || { echo "사용법: heavy.sh <명령> [인자…]" >&2; exit 2; }
  # 안쪽 호출(무거운 명령이 또 heavy.sh 를 부름)이거나 이 세션이 acquire 로 붙잡은 슬롯이 있으면 새 슬롯을 기다리지 않는다
  if [ -n "${DFLOW_HEAVY_HELD:-}" ] && [ -d "$DFLOW_HEAVY_HELD" ]; then exec "$@"; fi
  h=$(held_by "$(owner_pid)" | head -n 1)
  if [ -n "$h" ]; then
    echo "HEAVY_REUSE $(basename "$h")" >&2
    DFLOW_HEAVY_HELD="$h" exec "$@"
  fi

  MYPID=$$; SLOT=; child=
  on_sig() {
    [ -n "$child" ] && { command -v pkill >/dev/null 2>&1 && pkill -TERM -P "$child" 2>/dev/null; kill -TERM "$child" 2>/dev/null; wait "$child" 2>/dev/null; }
    mine_release; exit "$1"
  }
  trap 'on_sig 130' INT; trap 'on_sig 143' TERM; trap 'on_sig 129' HUP
  trap 'mine_release' EXIT
  wait_slot run "$MYPID" "$*"; rc=$?
  [ "$rc" -ne 1 ] || exit "$BUSY_RC"
  if [ "$rc" -eq 0 ]; then
    echo "HEAVY_SLOT $(basename "$SLOT") k=$K" >&2
    export DFLOW_HEAVY_HELD="$SLOT"
  fi
  "$@" &
  child=$!
  wait "$child"; rc=$?
  child=
  exit "$rc"
}

cmd_run_docker() {
  local rc h need=1
  [ $# -ge 1 ] || { echo "사용법: heavy.sh --pool docker <명령> [인자…]" >&2; exit 2; }
  # 안쪽 도커 호출(도커 슬롯을 쥔 실행이 또 --pool docker 를 부름)은 기다리지 않는다
  if [ -n "${DFLOW_HEAVY_DOCKER_HELD:-}" ] && [ -d "$DFLOW_HEAVY_DOCKER_HELD" ]; then exec "$@"; fi
  # 이미 일반 슬롯을 쥐고 있으면(감싼 실행 안, 또는 이 세션의 acquire) 도커 슬롯만 잡는다
  if [ -n "${DFLOW_HEAVY_HELD:-}" ] && [ -d "$DFLOW_HEAVY_HELD" ]; then
    need=0
  else
    h=$(held_by "$(owner_pid)" | head -n 1)
    if [ -n "$h" ]; then
      echo "HEAVY_REUSE $(basename "$h")" >&2
      export DFLOW_HEAVY_HELD="$h"; need=0
    fi
  fi

  MYPID=$$; SLOT=; DSLOT=; child=
  on_sig() {
    [ -n "$child" ] && { command -v pkill >/dev/null 2>&1 && pkill -TERM -P "$child" 2>/dev/null; kill -TERM "$child" 2>/dev/null; wait "$child" 2>/dev/null; }
    mine_release; exit "$1"
  }
  trap 'on_sig 130' INT; trap 'on_sig 143' TERM; trap 'on_sig 129' HUP
  trap 'mine_release' EXIT
  wait_docker "$MYPID" "$*" "$need"; rc=$?
  [ "$rc" -ne 1 ] || exit "$BUSY_RC"
  if [ "$rc" -eq 0 ]; then
    echo "HEAVY_DOCKER_SLOT $(basename "$DSLOT") docker=$KD${SLOT:+ + $(basename "$SLOT") k=$K}" >&2
    export DFLOW_HEAVY_DOCKER_HELD="$DSLOT"
    [ -z "$SLOT" ] || export DFLOW_HEAVY_HELD="$SLOT"
  fi
  "$@" &
  child=$!
  wait "$child"; rc=$?
  child=
  exit "$rc"
}

cmd_acquire() {
  local o h rc
  # 감싼 실행 안에서 부르면 그 실행의 슬롯을 쓴다 — 쥔 슬롯 위에서 두 번째 슬롯을 기다리지 않는다(교착 불변식).
  # 그 슬롯은 감싼 실행이 끝나면 풀리므로, 서버는 그 실행 안에서 끄고 끝낸다.
  if [ -n "${DFLOW_HEAVY_HELD:-}" ] && [ -d "$DFLOW_HEAVY_HELD" ]; then
    echo "HEAVY_ACQUIRED $(basename "$DFLOW_HEAVY_HELD") (감싼 실행의 슬롯) k=$K" >&2; exit 0
  fi
  o=$(owner_pid)
  h=$(held_by "$o" | head -n 1)
  if [ -n "$h" ]; then echo "HEAVY_ACQUIRED $(basename "$h") (이미 보유) owner=$o" >&2; exit 0; fi
  MYPID="$o"; SLOT=
  trap 'mine_release; exit 130' INT; trap 'mine_release; exit 143' TERM; trap 'mine_release; exit 129' HUP
  wait_slot hold "$o" "hold ${1:-e2e}"; rc=$?
  [ "$rc" -ne 1 ] || exit "$BUSY_RC"
  [ "$rc" -eq 0 ] || exit 0   # HEAVY_UNLOCKED: 붙잡지 못했지만 막지 않는다
  echo "HEAVY_ACQUIRED $(basename "$SLOT") owner=$o k=$K" >&2
  exit 0
}

cmd_release() {
  local o list
  o=$(owner_pid)
  list=$(held_by "$o")
  [ -n "$list" ] || { echo "HEAVY_RELEASED none owner=$o" >&2; exit 0; }
  # 경로에 공백이 있을 수 있다(Windows 사용자 폴더) — 줄 단위로 읽는다
  printf '%s\n' "$list" | while IFS= read -r d; do
    rm -rf "$d" && echo "HEAVY_RELEASED $(basename "$d") owner=$o" >&2
  done
  exit 0
}

cmd_status() {
  local g
  g=$(ram_gb) || g='?'
  echo "HEAVY_STATUS k=$K ram=${g}GB dir=$DIR wait=${WAIT}s"
  local h; h=$(holders); echo "${h:-(비어 있음)}"
  h=$(holders docker "$KD"); echo "HEAVY_DOCKER docker=$KD ${h:-(비어 있음)}"
}

POOL=general
case "${1:-}" in
  --pool) POOL="${2:-}"; shift 2 2>/dev/null || shift $# ;;
  --pool=*) POOL="${1#--pool=}"; shift ;;
esac
case "$POOL" in
  general) ;;
  docker)
    case "${1:-}" in
      acquire|release|status|'') echo "사용법: heavy.sh --pool docker <명령> [인자…] (도커 풀은 명령 실행만 받는다)" >&2; exit 2 ;;
      --) shift ;;
    esac
    cmd_run_docker "$@" ;;
  *) echo "사용법: heavy.sh --pool general|docker … (모르는 풀: $POOL)" >&2; exit 2 ;;
esac

case "${1:-}" in
  acquire) shift; cmd_acquire "$@" ;;
  release) shift; cmd_release ;;
  status)  cmd_status ;;
  --)      shift; cmd_run "$@" ;;
  '')      echo "사용법: heavy.sh [--pool docker] <명령> [인자…] | acquire <이름> | release | status" >&2; exit 2 ;;
  *)       cmd_run "$@" ;;
esac
