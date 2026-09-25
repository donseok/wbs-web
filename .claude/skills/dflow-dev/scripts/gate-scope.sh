#!/bin/sh
# /dflow-dev 게이트 범위 판정: 이 Task 가 바꾼 경로를 리포의 게이트 대응표(.dflow-gates)에 대 보고, 돌릴 게이트 명령을 낸다.
#
#   gate-scope.sh --base <기점> [--map <파일>] [--ignore <경로 접두>]... [--paths-file <파일>]
#
# 왜: 한 모듈만 바꾼 Task 도 Build 게이트·변이 검증·재실행마다 전체 스위트를 돌아 Task 하나의 게이트·검증 구간이 40~80분이
# 됐다(2026-09-26 성능 감사 — 실제 테스트 시간 합은 약 70초, 전체 한 번은 약 3분). 게이트는 바꾼 모듈(과 그 모듈에
# 의존하는 모듈)의 테스트만 돌고, 전체는 Verify 에서 한 번 돈다. 판정이 모호하면 전체다(안전한 쪽).
#
# 대응표: 리포 최상위의 .dflow-gates(리포에 커밋한다). 기본은 기점 커밋의 것(git show <기점>:.dflow-gates)을 읽는다 —
# Task 도중 대응표를 고쳐도 게이트 명령이 바뀌지 않게(기준선과 게이트는 같은 명령이다). --map 은 시험·수동 확인용이다.
#   한 줄에 <경로 접두 또는 glob><TAB><명령>. 빈 줄과 # 로 시작하는 줄은 건너뛴다. 줄 끝 CR 은 뗀다.
#   full<TAB><명령>     전체 게이트 명령(예약어, 한 줄 이상 필수). 여러 줄이면 모두 돈다(백엔드·프런트 등)
#   prepare<TAB><명령>  새 워크트리의 의존성 설치 직후 한 번 돌릴 준비 빌드(예약어, deps.sh 가 읽는다). 여기서는 무시한다
#   <경로><TAB>-        이 경로는 테스트 대상이 아니다(문서 등). 범위에서 뺀다
#   경로에 * ? [ 가 있으면 셸 case 패턴(glob — * 가 / 도 넘는다), 없으면 접두다. 폴더는 / 로 끝나게 쓴다
#   (backend/core 는 backend/core2/ 도 맞는다). 한 경로에 여러 줄이 맞으면 **먼저 나온 줄**이 이긴다.
#   이름이 full·prepare 인 폴더는 full/·prepare/ 로 쓴다(예약어와 구분).
#   모듈 명령은 그 모듈에 의존하는 모듈의 테스트까지 스스로 포함한다(예: Gradle `:core:test :api:test`,
#   pnpm `pnpm --filter "...<패키지>" test`). 의존 관계를 따로 적는 문법은 없다.
#
# 바뀐 경로: 기점 대비 작업 트리 전체(커밋된 것 + 커밋 안 된 것 + 추적 안 된 새 파일). 이름 변경은 옛 경로와 새 경로를 모두
# 본다(--no-renames — 모듈을 건너 옮긴 파일은 두 모듈 모두 영향). --ignore 접두로 시작하는 경로(Task 문서 폴더
# <TASKS>/<TSK>/)는 뺀다. --paths-file 을 주면 git 대신 그 파일의 경로(한 줄에 하나)를 쓴다 — Design 직후 design.md 의
# 변경 파일 목록으로 범위를 미리 볼 때다.
#
# 전체로 가는 경우(판정이 모호하면 전체):
#   - 대응표에 맞는 줄이 없는 경로가 하나라도 있다
#   - 공용 빌드·설정 파일이 바뀌었다: 이름이 settings.gradle(.kts)·gradle.properties·gradle-wrapper.properties·
#     libs.versions.toml·pnpm-lock.yaml·pnpm-workspace.yaml·package-lock.json·npm-shrinkwrap.json·yarn.lock 인 파일(어느
#     깊이든), 최상위의 build.gradle(.kts)·package.json·pom.xml·tsconfig.json·tsconfig.base.json, 최상위 buildSrc/·gradle/
#     아래, .dflow-gates 자신
#   - 범위에 남은 경로가 없다(바뀐 코드가 없다고 단정하지 않는다)
#
# 출력(stdout, 마지막 줄들). 판정 사유는 stderr 의 GATE_SCOPE_REASON 한 줄이다.
#   GATE_SCOPE none                  대응표가 없다 — 지금 동작 그대로(게이트는 기준선 명령 전체)
#   GATE_SCOPE module <명령>          (한 줄 이상) 이 명령들만 돈다. 같은 명령은 한 번만, 대응표 순서대로
#   GATE_SCOPE full <명령>            (한 줄 이상) full 줄의 명령을 모두 돈다
#   GATE_SCOPE invalid <사유>         exit 2 — 대응표 형식 오류·full 줄 없음·기점을 모름. 대응표가 없는 것처럼 한다
# POSIX sh 다(macOS·Linux·Git Bash). 배열·[[·PIPESTATUS 를 쓰지 않는다.
set -u

TAB=$(printf '\t')
BASE=""; MAP=""; PATHS_FILE=""; IGNORES=""
usage() {
  echo "usage: gate-scope.sh --base <기점> [--map <파일>] [--ignore <경로 접두>]... [--paths-file <파일>]" >&2
  exit 2
}
abspath() { # 상대 경로면 지금 cwd 기준 절대경로로
  case "$1" in /*) printf '%s\n' "$1" ;; *) printf '%s/%s\n' "$(pwd)" "$1" ;; esac
}
while [ $# -gt 0 ]; do
  case "$1" in
    --base) [ $# -ge 2 ] || usage; BASE="$2"; shift 2 ;;
    --map) [ $# -ge 2 ] || usage; MAP=$(abspath "$2"); shift 2 ;;
    --ignore) [ $# -ge 2 ] || usage; IGNORES="$IGNORES${2#./}
"; shift 2 ;;
    --paths-file) [ $# -ge 2 ] || usage; PATHS_FILE=$(abspath "$2"); shift 2 ;;
    *) usage ;;
  esac
done
[ -n "$BASE" ] || usage

invalid() { echo "GATE_SCOPE_REASON $1" >&2; echo "GATE_SCOPE invalid $1"; exit 2; }
TOP=$(git rev-parse --show-toplevel 2>/dev/null) || invalid "git 리포가 아님"
cd "$TOP" || invalid "리포 최상위로 못 감"
git rev-parse --verify -q "$BASE^{commit}" >/dev/null 2>&1 || invalid "기점 $BASE 를 모름"

W=$(mktemp -d "${TMPDIR:-/tmp}/dflow-gate-scope.XXXXXX") || invalid "임시 폴더를 못 만듦"
trap 'rm -rf "$W"' EXIT
trap 'exit 130' INT TERM

# 1) 대응표 읽기
if [ -n "$MAP" ]; then
  [ -f "$MAP" ] || { echo "GATE_SCOPE_REASON 대응표 $MAP 없음" >&2; echo "GATE_SCOPE none"; exit 0; }
  cp "$MAP" "$W/map" || invalid "대응표를 못 읽음"
elif ! git show "$BASE:.dflow-gates" > "$W/map" 2>/dev/null; then
  echo "GATE_SCOPE_REASON 기점에 .dflow-gates 없음" >&2; echo "GATE_SCOPE none"; exit 0
fi

: > "$W/rules"; : > "$W/full"; n=0
while IFS= read -r line || [ -n "$line" ]; do
  n=$((n + 1))
  line=$(printf '%s' "$line" | tr -d '\r')
  case "$line" in ''|'#'*) continue ;; esac
  trimmed=$(printf '%s' "$line" | sed 's/^[[:space:]]*//')
  case "$trimmed" in ''|'#'*) continue ;; esac
  case "$line" in *"$TAB"*) ;; *) invalid "대응표 ${n}행에 TAB 이 없음" ;; esac
  key=${line%%"$TAB"*}
  cmd=$(printf '%s' "${line#*"$TAB"}" | sed 's/^[[:space:]]*//; s/[[:space:]]*$//')
  [ -n "$key" ] && [ -n "$cmd" ] || invalid "대응표 ${n}행의 경로나 명령이 비었음"
  case "$key" in
    full) printf '%s\n' "$cmd" >> "$W/full" ;;
    prepare) ;;
    *) printf '%s\t%s\n' "$key" "$cmd" >> "$W/rules" ;;
  esac
done < "$W/map"
[ -s "$W/full" ] || invalid "대응표에 full 줄이 없음"

full() {
  echo "GATE_SCOPE_REASON $1" >&2
  while IFS= read -r c; do echo "GATE_SCOPE full $c"; done < "$W/full"
  exit 0
}

# 2) 바뀐 경로
if [ -n "$PATHS_FILE" ]; then
  [ -f "$PATHS_FILE" ] || invalid "경로 파일 $PATHS_FILE 없음"
  tr -d '\r' < "$PATHS_FILE" > "$W/paths"
else
  git -c core.quotePath=off diff --name-only --no-renames "$BASE" -- > "$W/paths" 2>/dev/null || invalid "git diff 실패"
  git -c core.quotePath=off ls-files --others --exclude-standard >> "$W/paths" 2>/dev/null || invalid "git ls-files 실패"
fi

matches() { # $1 경로 $2 대응표의 경로 칸
  case "$2" in
    *'*'*|*'?'*|*'['*) case "$1" in $2) return 0 ;; esac ;;
    *) case "$1" in "$2"*) return 0 ;; esac ;;
  esac
  return 1
}
# --ignore 가 절대경로면 리포 최상위 기준으로 바꾼다(macOS 의 /tmp→/private/tmp 처럼 두 표기가 있을 수 있다)
TOP_P=$(pwd -P)
printf '%s' "$IGNORES" | while IFS= read -r ig; do
  case "$ig" in
    "$TOP"/*) ig=${ig#"$TOP"/} ;;
    "$TOP_P"/*) ig=${ig#"$TOP_P"/} ;;
  esac
  printf '%s\n' "$ig"
done > "$W/ign"
ignored() {
  while IFS= read -r ig; do
    [ -n "$ig" ] || continue
    case "$1" in "$ig"*) return 0 ;; esac
  done < "$W/ign"
  return 1
}
shared_build_file() {
  case "$1" in
    .dflow-gates|build.gradle|build.gradle.kts|package.json|pom.xml|tsconfig.json|tsconfig.base.json|buildSrc/*|gradle/*) return 0 ;;
  esac
  case "${1##*/}" in
    settings.gradle|settings.gradle.kts|gradle.properties|gradle-wrapper.properties|libs.versions.toml|\
    pnpm-lock.yaml|pnpm-workspace.yaml|package-lock.json|npm-shrinkwrap.json|yarn.lock) return 0 ;;
  esac
  return 1
}

# 3) 경로마다 먼저 맞는 줄을 찾는다
: > "$W/hit"; left=0
while IFS= read -r p; do
  p=${p#./}
  [ -n "$p" ] || continue
  ignored "$p" && continue
  shared_build_file "$p" && full "공용 빌드·설정 파일 변경: $p"
  i=0; found=""
  while IFS="$TAB" read -r pat cmd; do
    i=$((i + 1))
    if matches "$p" "$pat"; then found=$i; break; fi
  done < "$W/rules"
  [ -n "$found" ] || full "대응표에 없는 경로: $p"
  echo "$found" >> "$W/hit"
  left=1
done < "$W/paths"

# 4) 맞은 줄의 명령을 대응표 순서대로, 같은 명령은 한 번만
: > "$W/out"; i=0
while IFS="$TAB" read -r pat cmd; do
  i=$((i + 1))
  grep -qx "$i" "$W/hit" || continue
  [ "$cmd" = "-" ] && continue
  grep -qxF -- "$cmd" "$W/out" || printf '%s\n' "$cmd" >> "$W/out"
done < "$W/rules"
[ "$left" = 1 ] && [ -s "$W/out" ] || full "범위에 남은 코드 경로가 없음"
echo "GATE_SCOPE_REASON 모듈 범위" >&2
while IFS= read -r c; do echo "GATE_SCOPE module $c"; done < "$W/out"
exit 0
