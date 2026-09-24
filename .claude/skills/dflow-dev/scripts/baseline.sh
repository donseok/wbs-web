#!/usr/bin/env bash
# /dflow-dev Phase 01 4번: 게이트 기준선 측정을 리포 공용 캐시로 감싼다. cwd = 기준선 명령을 돌릴 폴더.
#
#   baseline.sh run --base <기점> [--task-dir <TASKS>/<TSK>] -- '<기준선 명령>'
#   baseline.sh note <key> --tests <총수> --failures <실패 수> [--failed-file <실패 이름 목록 파일>]
#   baseline.sh list --base <기점>     같은 기점에서 이미 잰 명령(재사용하려면 그 문자열·cwd 를 글자 그대로 쓴다)
#
# 왜: /dflow-team 팀원 셋이 같은 기점(origin/dev 78813e9)에서 똑같은 backend testAll·mssqlMigrationTest 기준선을
# 각자 몇 분씩 돌렸다(2026-09-24 dmes-standard). 같은 커밋에서 같은 명령의 결과는 같아야 하므로 한 번만 잰다.
#
# 키 = (기점 커밋 sha, 명령 문자열과 리포 안 cwd 의 해시). 결과는 <git-common-dir>/dflow-baseline/<sha>-<hash>.json
# (exit·총수·실패 목록·잰 시각) 과 그 출력 전체 로그다. 같은 키가 있으면 명령을 돌리지 않고 저장된 출력을 그대로
# 다시 내고 저장된 exit 로 끝난다 — 호출하는 쪽은 명령을 직접 돌렸을 때와 같은 출력·exit 를 본다.
#
# 캐시를 쓰지 않는 경우(명령은 그대로 돌리고 저장하지 않는다):
#   - DFLOW_BASELINE_CACHE=0
#   - HEAD 가 --base 와 다르다(재개한 브랜치 위 등 — 그 트리는 기점이 아니다)
#   - 작업 트리가 깨끗하지 않다(--task-dir 아래의 state.json·spec.md 등 문서 부산물은 빼고 본다)
# DFLOW_BASELINE_CACHE=refresh 면 있어도 쓰지 않고 새로 재서 덮어쓴다(오래된 결과·환경이 바뀐 결과를 갈아엎을 때).
# DFLOW_BASELINE_MAX_AGE(초, 기본 21600=6시간)보다 오래된 결과는 쓰지 않고 새로 재서 덮어쓴다. 키가 커밋이라 코드는
# 낡지 않지만 DB 상태·포트처럼 커밋 밖의 환경이 결과를 바꿀 수 있어서다.
# exit 126·127·128 이상(명령 없음·실행 불가·시그널로 죽음)은 저장하지 않는다. 설치 누락 같은 일회성 고장이 모든
# 팀원의 기준선이 되면, 그 고장에 가려 각자의 새 실패를 못 본다.
#
# 동시 측정: 같은 키를 둘이 동시에 재려 하면 mkdir 잠금을 잡은 쪽만 재고 다른 쪽은 결과를 기다렸다가 재사용한다.
# 둘 다 재면 시간을 못 줄이고, testAll·마이그레이션 시험은 같은 DB·포트를 두고 서로 부딪칠 수 있다. 잠금에는
# pid·host·시작 시각을 적고, 같은 host 에서 pid 가 죽었거나 DFLOW_BASELINE_LOCK_TTL(초, 기본 7200)을 넘기면 버려진
# 잠금으로 보고 가져간다. DFLOW_BASELINE_WAIT(초, 기본 240)를 기다려도 안 끝나면 재지 않고 BASELINE_BUSY 와 exit 75
# 로 끝난다 — 워커는 같은 명령을 다시 호출한다. 한 번의 Bash 호출로 오래 기다리면 heartbeat 가 끊겨 팀장이 무응답으로
# 오판하기 때문이다(heavy.sh 의 HEAVY_BUSY 와 같은 이유·같은 exit). 측정 명령은 같은 폴더의 heavy.sh(PC 전역 무거운 명령
# 세마포어)로 감싸 돌린다. heavy.sh 가 HEAVY_BUSY(exit 75)로 끝나면 저장하지 않고 BASELINE_BUSY 로 끝난다. 결과
# 파일은 임시 파일에 쓴 뒤 하드링크로 게시한다(원자적, 이미 있으면 먼저 쓴 쪽이 남는다). flock 은 macOS 에 없다.
#
# 출력 마지막 줄(`| tail -30` 뒤에도 남는다):
#   BASELINE_MEASURED exit=<n> key=<key> json=<경로>         새로 쟀고 저장했다
#   BASELINE_MEASURED exit=<n> cache=off(<사유>)              새로 쟀고 저장하지 않았다
#   BASELINE_REUSED exit=<n> key=<key> measured_at=<ISO> json=<경로>   다른 팀원이 잰 결과를 그대로 냈다
#   BASELINE_BUSY exit=75 <사유>                            재지 못했다 — 같은 명령을 다시 호출한다(실패가 아니다)
# 그 밖: BASELINE_WAITING(다른 측정을 기다린다) · BASELINE_LOCK_STALE · BASELINE_SUMMARY
# note 는 파싱한 총수·실패 목록을 결과에 더한다. 재사용하는 쪽은 BASELINE_SUMMARY 줄과 json 으로 같은 수를 얻는다.
set -u

MAX_AGE="${DFLOW_BASELINE_MAX_AGE:-21600}"
WAIT="${DFLOW_BASELINE_WAIT:-240}"
LOCK_TTL="${DFLOW_BASELINE_LOCK_TTL:-7200}"
POLL="${DFLOW_BASELINE_POLL:-2}"
MODE="${DFLOW_BASELINE_CACHE:-1}"

usage() {
  echo "usage: baseline.sh run --base <기점> [--task-dir <dir>] -- '<명령>'" >&2
  echo "       baseline.sh note <key> --tests <n> --failures <n> [--failed-file <file>]" >&2
  echo "       baseline.sh list --base <기점>" >&2
  exit 2
}

now() { date +%s; }
iso() { date -u -r "$1" +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || date -u -d "@$1" +%Y-%m-%dT%H:%M:%SZ; }
hash12() {
  if command -v sha256sum >/dev/null 2>&1; then sha256sum
  elif command -v shasum >/dev/null 2>&1; then shasum -a 256
  else cksum
  fi | tr -dc '0-9a-f' | cut -c1-12
}
cache_dir() { echo "$(git rev-parse --path-format=absolute --git-common-dir)/dflow-baseline"; }

# 저장된 결과가 쓸 만하면 0. 결과 json·로그가 모두 있고 MAX_AGE 안이어야 한다.
usable() {
  [ -f "$J" ] || return 1
  at=$(jq -r '.measured_epoch // empty' "$J" 2>/dev/null) || return 1
  lg=$(jq -r '.log // empty' "$J" 2>/dev/null) || return 1
  [ -n "$at" ] && [ -n "$lg" ] && [ -f "$C/$lg" ] || return 1
  [ $(( $(now) - at )) -le "$MAX_AGE" ]
}

reuse() {
  cat "$C/$lg"
  rc=$(jq -r '.exit' "$J")
  tests=$(jq -r '.tests // empty' "$J")
  if [ -n "$tests" ]; then
    jq -r '.failed[]? | "BASELINE_FAILED " + .' "$J"
    echo "BASELINE_SUMMARY tests=$tests failures=$(jq -r '.failures' "$J")"
  fi
  echo "BASELINE_REUSED exit=$rc key=$KEY measured_at=$(jq -r '.measured_at' "$J") json=$J"
  exit "$rc"
}

measure_nocache() { # $1 사유
  bash -c "$CMD"
  rc=$?
  echo "BASELINE_MEASURED exit=$rc cache=off($1)"
  exit "$rc"
}

cmd_run() {
  BASE=""; TASK_DIR=""
  while [ $# -gt 0 ]; do
    case "$1" in
      --base) BASE="${2:-}"; shift 2 ;;
      --task-dir) TASK_DIR="${2:-}"; shift 2 ;;
      --) shift; break ;;
      *) usage ;;
    esac
  done
  [ $# -eq 1 ] && [ -n "$1" ] && [ -n "$BASE" ] || usage
  CMD="$1"
  # 앞뒤 공백만 뗀다(키가 우연히 갈라지지 않게). 안쪽은 건드리지 않는다 — 다른 명령을 같은 키로 묶으면 안 된다
  CMD="${CMD#"${CMD%%[![:space:]]*}"}"; CMD="${CMD%"${CMD##*[![:space:]]}"}"
  [ -n "$CMD" ] || usage

  [ "$MODE" = 0 ] && measure_nocache "DFLOW_BASELINE_CACHE=0"
  HEAD_SHA=$(git rev-parse --verify -q HEAD) || measure_nocache "HEAD 없음"
  BASE_SHA=$(git rev-parse --verify -q "$BASE^{commit}") || measure_nocache "기점 $BASE 를 모름"
  [ "$HEAD_SHA" = "$BASE_SHA" ] || measure_nocache "HEAD 가 기점과 다름"
  if [ -n "$TASK_DIR" ]; then
    top=$(cd "$(git rev-parse --show-toplevel)" && pwd -P)
    # cwd 기준으로 찾고, 없으면 리포 최상위 기준으로 찾는다(기준선 명령을 하위 폴더에서 돌릴 때). 아직 없는 폴더면
    # 최상위 기준 경로로 본다(그 아래 파일이 없으니 빼도 그만이다)
    if td=$(cd "$TASK_DIR" 2>/dev/null && pwd -P); then :
    elif td=$(cd "$top/$TASK_DIR" 2>/dev/null && pwd -P); then :
    else td="$top/${TASK_DIR#./}"
    fi
    case "$td" in "$top"/*) td=${td#"$top"/} ;; *) td="" ;; esac
    [ -n "$td" ] || measure_nocache "task-dir $TASK_DIR 가 리포 안에 없음"
    dirty=$(git status --porcelain --untracked-files=all -- ':/' ":(top,exclude)$td")
  else
    dirty=$(git status --porcelain --untracked-files=all -- ':/')
  fi
  [ -z "$dirty" ] || measure_nocache "작업 트리가 깨끗하지 않음"

  C=$(cache_dir); mkdir -p "$C" || measure_nocache "캐시 폴더를 못 만듦"
  HASH=$(printf '%s\n%s' "$(git rev-parse --show-prefix)" "$CMD" | hash12)
  KEY="$HEAD_SHA-$HASH"; J="$C/$KEY.json"; L="$C/$KEY.lock"
  HOST=$(hostname 2>/dev/null || echo unknown)

  [ "$MODE" != refresh ] && usable && reuse

  locked=0; waited=0; deadline=$(( $(now) + WAIT ))
  while :; do
    if mkdir "$L" 2>/dev/null; then
      printf '%s %s %s\n' "$$" "$HOST" "$(now)" > "$L/owner"
      locked=1
      trap 'rm -rf "$L"' EXIT
      trap 'rm -rf "$L"; exit 130' INT
      trap 'rm -rf "$L"; exit 143' TERM
      # 잠금을 잡기 직전에 앞 측정이 게시하고 잠금을 풀었을 수 있다 — 잡은 뒤 한 번 더 본다
      [ "$MODE" != refresh ] && usable && reuse
      break
    fi
    # 잠금 대기 중에 다른 쪽이 게시했으면 그 결과를 쓴다
    [ "$MODE" != refresh ] && usable && reuse
    read -r opid ohost ostart < "$L/owner" 2>/dev/null || { opid=""; ohost=""; ostart=""; }
    stale=""
    if [ -z "$ostart" ]; then
      # mkdir 과 owner 기록 사이이거나 owner 없이 죽었다. 폴더가 2분 넘게 owner 없이 남아 있으면 버려진 것이다
      [ -n "$(find "$L" -maxdepth 0 -mmin +2 2>/dev/null)" ] && stale="owner 없음"
    elif [ "$ohost" = "$HOST" ] && ! kill -0 "$opid" 2>/dev/null; then
      stale="pid $opid 없음"
    elif [ $(( $(now) - ostart )) -gt "$LOCK_TTL" ]; then
      stale="TTL 초과"
    fi
    if [ -n "$stale" ]; then
      echo "BASELINE_LOCK_STALE $stale — 잠금을 가져간다"
      mv "$L" "$L.stale.$$" 2>/dev/null && rm -rf "$L.stale.$$"
      continue
    fi
    if [ "$waited" = 0 ]; then
      echo "BASELINE_WAITING 다른 팀원이 같은 기준선을 재는 중(pid $opid@$ohost), 결과를 기다린다"
      waited=1
    fi
    if [ "$(now)" -ge "$deadline" ]; then
      echo "BASELINE_BUSY exit=75 다른 팀원의 측정(pid $opid@$ohost)이 ${WAIT}초 안에 끝나지 않았다 — 같은 명령을 다시 호출한다"
      exit 75
    fi
    sleep "$POLL"
  done

  LOG="$KEY.$$.log"
  started=$(now)
  HEAVY="$(cd "$(dirname "$0")" && pwd)/heavy.sh"
  if [ -x "$HEAVY" ]; then
    "$HEAVY" bash -c "$CMD" 2>&1 | tee "$C/$LOG"
  else
    bash -c "$CMD" 2>&1 | tee "$C/$LOG"
  fi
  rc=${PIPESTATUS[0]}
  if [ "$rc" -eq 75 ] && grep -q '^HEAVY_BUSY' "$C/$LOG" 2>/dev/null; then
    rm -f "$C/$LOG"
    echo "BASELINE_BUSY exit=75 PC 전역 무거운 명령 슬롯이 차 있다 — 같은 명령을 다시 호출한다"
    exit 75
  fi
  if [ "$rc" -eq 126 ] || [ "$rc" -eq 127 ] || [ "$rc" -ge 128 ]; then
    rm -f "$C/$LOG"
    echo "BASELINE_MEASURED exit=$rc cache=off(exit $rc 는 저장하지 않는다)"
    exit "$rc"
  fi
  T="$C/.$KEY.json.tmp.$$"
  jq -n --arg key "$KEY" --arg sha "$HEAD_SHA" --arg cmd "$CMD" --arg prefix "$(git rev-parse --show-prefix)" \
    --arg host "$HOST" --arg log "$LOG" --arg at "$(iso "$started")" \
    --argjson exit "$rc" --argjson epoch "$started" \
    '{key:$key, sha:$sha, cmd:$cmd, cwd:$prefix, exit:$exit, tests:null, failures:null, failed:[],
      measured_at:$at, measured_epoch:$epoch, host:$host, log:$log}' > "$T" || { rm -f "$T" "$C/$LOG"; exit "$rc"; }
  if [ "$MODE" = refresh ] || { [ -f "$J" ] && ! usable; }; then
    old=$(jq -r '.log // empty' "$J" 2>/dev/null)
    mv -f "$T" "$J"
    [ -n "$old" ] && [ "$old" != "$LOG" ] && rm -f "$C/$old"
  elif ln "$T" "$J" 2>/dev/null; then
    rm -f "$T"
  else
    # 먼저 게시된 결과가 있다(refresh 가 아닌데 잠금 밖에서 게시된 경우). 먼저 쓴 쪽을 남긴다
    rm -f "$T" "$C/$LOG"
  fi
  # 정리: 7일 넘은 결과·로그·임시 파일
  find "$C" -maxdepth 1 -type f -mtime +7 -exec rm -f {} + 2>/dev/null
  echo "BASELINE_MEASURED exit=$rc key=$KEY json=$J"
  exit "$rc"
}

cmd_note() {
  KEY="${1:-}"; [ -n "$KEY" ] || usage; shift
  tests=""; failures=""; ff=""
  while [ $# -gt 0 ]; do
    case "$1" in
      --tests) tests="${2:-}"; shift 2 ;;
      --failures) failures="${2:-}"; shift 2 ;;
      --failed-file) ff="${2:-}"; shift 2 ;;
      *) usage ;;
    esac
  done
  case "$tests$failures" in ''|*[!0-9]*) usage ;; esac
  [ -n "$tests" ] && [ -n "$failures" ] || usage
  C=$(cache_dir); J="$C/$KEY.json"
  [ -f "$J" ] || { echo "BASELINE_NOTE_MISSING $KEY"; exit 1; }
  if [ -n "$ff" ]; then
    failed=$(jq -R -s 'split("\n") | map(select(length > 0))' "$ff") || exit 1
  else
    failed='[]'
  fi
  T="$C/.$KEY.json.note.$$"
  jq --argjson t "$tests" --argjson f "$failures" --argjson l "$failed" '.tests=$t | .failures=$f | .failed=$l' "$J" > "$T" &&
    mv -f "$T" "$J" || { rm -f "$T"; exit 1; }
  echo "BASELINE_NOTED key=$KEY tests=$tests failures=$failures"
}

# 같은 기점에서 이미 잰 명령을 낸다. 명령 문자열이 한 글자만 달라도 키가 달라지므로, 먼저 잰 팀원의 명령을
# 글자 그대로 쓰게 하기 위한 것이다. 줄: BASELINE_CACHED <key> exit=<n> cwd=<리포 안 경로|.> <명령>
cmd_list() {
  [ "${1:-}" = --base ] && [ -n "${2:-}" ] || usage
  sha=$(git rev-parse --verify -q "$2^{commit}") || { echo "BASELINE_LIST_NONE 기점 $2 를 모름"; exit 0; }
  C=$(cache_dir); n=0
  for J in "$C/$sha"-*.json; do
    [ -f "$J" ] || continue
    KEY=$(basename "$J" .json)
    usable || continue
    jq -r --arg k "$KEY" '"BASELINE_CACHED \($k) exit=\(.exit) cwd=\(if .cwd == "" then "." else .cwd end) \(.cmd)"' "$J"
    n=$((n + 1))
  done
  [ "$n" -gt 0 ] || echo "BASELINE_LIST_NONE"
}

case "${1:-}" in
  run) shift; cmd_run "$@" ;;
  list) shift; cmd_list "$@" ;;
  note) shift; cmd_note "$@" ;;
  *) usage ;;
esac
