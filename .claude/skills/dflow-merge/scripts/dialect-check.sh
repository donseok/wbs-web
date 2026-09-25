#!/usr/bin/env bash
# 방언 검증 — 승인 스윕이 개발 브랜치에 머지를 마친 뒤, 스윕 한 번에 한 번만 개발 브랜치 끝 커밋에서 대상 리포의 도커
# 검증(DB 방언 등)을 돌린다. 절차 정본: ../SKILL.md 「방언 검증」, 규칙 정본: ../../dflow-dev/references/dev-discipline.md
# 「도커 사용 규칙」.
#
# 왜: 2026-09-24 dmes-standard 에서 워커마다 기준선·게이트에서 Testcontainers MSSQL 을 각자 띄워 16GB PC 가 load 52 까지
# 밀렸다. 같은 목적(방언 검증)의 컨테이너를 워커마다 띄우지 않고, 머지된 결과에서 한 곳(팀장 스윕)이 한 번 돌린다.
#
# 사용법(호출한 체크아웃의 최상위에서)
#   dialect-check.sh run --dev <개발 브랜치> [--sweep-base <스윕 전 origin/<dev> sha>]
#   dialect-check.sh status --dev <개발 브랜치>     마지막으로 기록한 결과 한 줄(컨텍스트 압축·백그라운드 전환 뒤 확인용)
#
# 명령은 dflow.sh config dialect_check 값이다(.dflow 리포 공통, .dflow.local PC 별로 덮음, export 된
# DFLOW_DIALECT_CHECK 가 둘 다 덮는다). 값은 깨끗한 임시 워크트리(origin/<dev> 끝 커밋에 detach)의 최상위에서
# `bash -c` 로 돈다 — `cd <폴더> && VAR=값 <명령>` 같은 셸 문법을 그대로 받는다. PC 전역 도커 슬롯
# (../../dflow-dev/scripts/heavy.sh --pool docker)을 잡은 동안에만 돈다. 호출한 체크아웃은 건드리지 않는다.
#
# 도커 런타임이 꺼져 있으면 켜지 않는다(DFLOW_DOCKER_PROBE, 기본 `docker info` 로만 본다). 보류로 기록하고 다음
# 스윕에서 같은 커밋을 다시 시도한다. 자동으로 되돌리거나 Task 를 재오픈하지 않는다.
#
# 상태: <git-common-dir>/dflow-dialect/<브랜치>.state (last_pass·last_fail·deferred·docs_only·last_result), 로그 <브랜치>.log.
# 결과는 출력하기 전에 상태 파일에 먼저 기록한다(임시 파일 → mv). 10분을 넘겨 호출이 백그라운드로 옮겨져도 결과를
# `status` 로 다시 읽을 수 있다.
#
# 출력(stdout, 마지막 줄이 결과):
#   DIALECT_NONE                                             키가 없다 — 이 단계는 없다         exit 0
#   DIALECT_SKIP passed|failed <sha>                         그 커밋은 이미 판정했다(다시 돌리지 않는다) exit 0
#   DIALECT_SKIP docs-only <sha> since=<sha>                 직전 통과 이후 문서만 바뀌었다 — 이월(상태 docs_only) exit 0
#   DIALECT_RUNNING <sha> pid=<pid>                          같은 브랜치의 검증이 아직 돈다       exit 0
#   DIALECT_DEFERRED docker-off <sha> notify=<0|1>           도커 꺼짐 — 보류(다음 스윕에 다시)   exit 3
#   DIALECT_BUSY <sha>                                       도커 슬롯이 차 있다 — 다음 스윕에 다시 exit 75
#   DIALECT_UNVERIFIED <TSK> 생략=<n> 미확인=<m> <파일>        (결과 줄 앞) 워커가 도커 금지로 확인하지 못한 항목을 남긴 Task
#   DIALECT_PASS <sha> since=<sha|-> tasks=<TSK,…|-> unverified=<TSK,…|->                 exit 0
#   DIALECT_FAIL <sha> exit=<n> since=<sha|-> tasks=<TSK,…|-> unverified=<TSK,…|-> log=<경로> exit 1
#   DIALECT_ERROR <사유>                                                                  exit 2
#   DIALECT_ERROR exit=<126|127|128+> <sha> notify=<0|1> log=<경로>   명령을 못 돌렸거나 시그널로 죽었다 — 판정으로
#                                                            기록하지 않고 다음 스윕에 다시(notify=1 은 그 커밋의 첫 오류) exit 2
# since 는 직전 통과 커밋(없으면 --sweep-base), tasks 는 그 뒤 개발 브랜치에 머지된 Task(머지 커밋 제목 `merge: <TSK> …`).
set -u

usage() { echo "사용법: dialect-check.sh run --dev <브랜치> [--sweep-base <sha>] | status --dev <브랜치>" >&2; exit 2; }
err() { echo "DIALECT_ERROR $*"; exit 2; }

MODE="${1:-}"; [ -n "$MODE" ] && shift
DEV=''; SWEEP_BASE=''
while [ $# -gt 0 ]; do
  case "$1" in
    --dev) DEV="${2:-}"; shift 2 ;;
    --sweep-base) SWEEP_BASE="${2:-}"; shift 2 ;;
    *) usage ;;
  esac
done
case "$MODE" in run|status) ;; *) usage ;; esac
[ -n "$DEV" ] || usage

HERE=$(cd "$(dirname "$0")" && pwd)
DFLOW="${DFLOW_SH:-$HERE/../../dflow-work/scripts/dflow.sh}"
HEAVY="$HERE/../../dflow-dev/scripts/heavy.sh"

ROOT=$(git rev-parse --show-toplevel 2>/dev/null) || err "git 체크아웃이 아니다"
CD=$(cd "$(git rev-parse --git-common-dir)" && pwd) || err "git-common-dir 를 모른다"
SD="$CD/dflow-dialect"; mkdir -p "$SD" || err "상태 폴더를 만들 수 없다: $SD"
KEY=$(printf '%s' "$DEV" | tr '/ ' '__')
ST="$SD/$KEY.state"; LOG="$SD/$KEY.log"; LK="$SD/$KEY.lock"

get() { sed -n "s/^$1=//p" "$ST" 2>/dev/null | head -n 1; }
# $1 키 $2 값 — 한 줄을 바꿔 원자적으로 다시 쓴다
put() {
  local t="$ST.tmp.$$"
  { grep -v "^$1=" "$ST" 2>/dev/null; printf '%s=%s\n' "$1" "$2"; } > "$t" && mv -f "$t" "$ST"
}
short() { printf '%s' "$1" | cut -c1-12; }

if [ "$MODE" = status ]; then
  r=$(get last_result); d=$(get deferred)
  [ -n "$d" ] && echo "DIALECT_PENDING deferred $(short "$d")"
  echo "${r:-DIALECT_STATUS none}"
  exit 0
fi

CMD=$("$DFLOW" config dialect_check 2>/dev/null) || err "설정을 읽지 못했다(dflow.sh config dialect_check)"
[ -n "$CMD" ] || { echo "DIALECT_NONE"; exit 0; }

git fetch -q origin "$DEV" 2>/dev/null || err "fetch 실패: origin $DEV"
SHA=$(git rev-parse -q --verify "refs/remotes/origin/$DEV^{commit}") || err "origin/$DEV 가 없다"

# 같은 브랜치의 검증을 둘이 동시에 돌리지 않는다(스윕이 겹치거나, 백그라운드로 옮겨진 앞 호출이 아직 돈다)
if ! mkdir "$LK" 2>/dev/null; then
  op=$(sed -n 's/^pid=//p' "$LK/owner" 2>/dev/null | head -n 1)
  if [ -n "$op" ] && kill -0 "$op" 2>/dev/null; then echo "DIALECT_RUNNING $(short "$SHA") pid=$op"; exit 0; fi
  rm -rf "$LK"; mkdir "$LK" 2>/dev/null || { echo "DIALECT_RUNNING $(short "$SHA") pid=?"; exit 0; }
fi
echo "pid=$$" > "$LK/owner"
# 죽은 앞 호출이 남긴 임시 워크트리(dflow-dialect-<pid>, pid 가 없음)를 치운다. 살아 있는 pid 의 것은 다른 브랜치의
# 검증일 수 있어 건드리지 않는다. 팀장의 고아 정리는 .dflow-agent 가 있는 워크트리만 보므로 이것을 줍지 않는다.
for old in "$ROOT"/.claude/worktrees/dflow-dialect-*; do
  [ -d "$old" ] || continue
  op=${old##*-}
  case "$op" in ''|*[!0-9]*) continue ;; esac
  kill -0 "$op" 2>/dev/null && continue
  git worktree remove --force "$old" >/dev/null 2>&1 || rm -rf "$old"
done
git worktree prune >/dev/null 2>&1
W=''
cleanup() {
  [ -n "$W" ] && { git worktree remove --force "$W" >/dev/null 2>&1 || rm -rf "$W"; git worktree prune >/dev/null 2>&1; }
  rm -rf "$LK"
}
trap cleanup EXIT
trap 'exit 130' INT; trap 'exit 143' TERM; trap 'exit 129' HUP

LAST_PASS=$(get last_pass); LAST_FAIL=$(get last_fail)
[ "$SHA" = "$LAST_PASS" ] && { echo "DIALECT_SKIP passed $(short "$SHA")"; exit 0; }
[ "$SHA" = "$LAST_FAIL" ] && { echo "DIALECT_SKIP failed $(short "$SHA")"; exit 0; }

# 문서뿐 이월 — 직전 통과 커밋과 끝 커밋의 트리 차이가 문서뿐이면 끝 커밋의 코드는 이미 통과한 트리와 같다. 돌리지 않고
# 다음 스윕으로 넘긴다(도커 확인보다 앞 — 꺼져 있어도 보류가 아니다). 기준은 last_pass 만 쓴다. --sweep-base 는 판정받은 적 없는
# 트리라(앞 스윕의 보류·BUSY·오류로 남은 코드일 수 있다) 문서뿐 판정에 쓰지 않는다. diff 를 못 구하면 돌린다(fail-closed).
# last_pass·last_result 는 옮기지 않는다 — 다음 실제 검증의 since·tasks 가 이월분을 포함하고, status 는 마지막 실제 판정을 낸다.
# DIALECT_UNVERIFIED(도커 금지로 확인하지 못한 항목)가 있어도 돌리지 않는다: 코드가 통과한 트리와 같아 다시 돌려도 얻을 것이
# 없고, 그런 표시를 남긴 Task 는 보통 코드도 바꿔 이 판정에 걸리지 않는다. 문서만 바꾼 Task 가 남긴 표시는 since 가 그대로라
# 다음 실제 검증의 DIALECT_UNVERIFIED·unverified= 에 실린다.
# 문서: *.md, docs/**, 작업 폴더(dflow.sh config tasks-dirs 의 <폴더>/<TSK>/)의 state.json·decisions.json·.issues·.result.
# --no-renames: 코드를 문서 폴더로 옮긴 것을 새 경로만 보고 문서뿐으로 보지 않게 옛 경로도 낸다.
# core.quotePath=false: 한글 파일명(docs/설계.md)이 "\354…" 로 따옴표 쳐져 문서 규칙에 안 걸리는 것을 막는다.
docs_only() {
  local f d td
  td=$("$DFLOW" config tasks-dirs 2>/dev/null) || td=''   # 못 읽으면 작업 폴더 규칙만 빠진다(더 엄격해질 뿐이다)
  while IFS= read -r f; do
    [ -n "$f" ] || continue
    case "$f" in *.md|docs/*) continue ;; esac
    while IFS= read -r d; do
      [ -n "$d" ] || continue
      case "${f#"$d"/}" in
        "$f") ;;
        */*/*) ;;
        */state.json|*/decisions.json|*/.issues|*/.result) continue 2 ;;
      esac
    done <<EOF
$td
EOF
    return 1
  done
  return 0
}
if [ -n "$LAST_PASS" ] && git cat-file -e "$LAST_PASS^{commit}" 2>/dev/null &&
   CHANGED=$(git -c core.quotePath=false diff --no-renames --name-only "$LAST_PASS" "$SHA" 2>/dev/null) &&
   printf '%s\n' "$CHANGED" | docs_only; then
  put docs_only "$SHA"; put deferred ''
  echo "DIALECT_SKIP docs-only $(short "$SHA") since=$(short "$LAST_PASS")"
  exit 0
fi

# 도커 런타임 확인 — 켜지 않는다. 켜는 것은 사람이 한다
if ! bash -c "${DFLOW_DOCKER_PROBE:-docker info}" >/dev/null 2>&1; then
  n=1; [ "$(get deferred)" = "$SHA" ] && n=0
  put deferred "$SHA"
  echo "DIALECT_DEFERRED docker-off $(short "$SHA") notify=$n"
  exit 3
fi

# 직전 통과 이후 머지된 Task, 그리고 도커 금지로 확인하지 못한 항목을 남긴 Task
SINCE="${LAST_PASS:-$SWEEP_BASE}"
TASKS='-'; UNV='-'; UNV_LINES=''
if [ -n "$SINCE" ] && [ "$SINCE" != "$SHA" ]; then
  if lg=$(git log --first-parent --reverse --format=%s "$SINCE..$SHA" 2>/dev/null); then
    t=$(printf '%s\n' "$lg" | sed -n 's/^merge: \([^ ][^ ]*\) .*/\1/p' | awk '!s[$0]++' | paste -sd, -)
    TASKS=${t:--}
    u=''
    while IFS= read -r p; do
      [ -n "$p" ] || continue
      body=$(git show "$SHA:$p" 2>/dev/null) || continue
      n1=$(printf '%s\n' "$body" | grep -c '도커 금지로 생략:')
      n2=$(printf '%s\n' "$body" | grep -c '확인하지 못한 수용 기준:')
      [ $((n1 + n2)) -gt 0 ] || continue
      tsk=$(basename "$(dirname "$p")")
      UNV_LINES="$UNV_LINES${UNV_LINES:+
}DIALECT_UNVERIFIED $tsk 생략=$n1 미확인=$n2 $p"
      case ",$u," in *",$tsk,"*) ;; *) u="$u${u:+,}$tsk" ;; esac
    done <<EOF
$(git diff --name-only "$SINCE" "$SHA" -- '*design.md' '*resolution.md' 2>/dev/null)
EOF
    UNV=${u:--}
  else
    TASKS='?'; UNV='?'
  fi
fi

# 깨끗한 임시 워크트리에서 돌린다 — 호출한 체크아웃(팀장)을 더럽히지 않는다
ex=$(git rev-parse --git-path info/exclude); mkdir -p "$(dirname "$ex")"; touch "$ex"
grep -qxF '**/.claude/worktrees/' "$ex" || printf '%s\n' '**/.claude/worktrees/' >> "$ex"
W="$ROOT/.claude/worktrees/dflow-dialect-$$"
git worktree add -q --detach "$W" "$SHA" >/dev/null 2>&1 || { W=''; err "임시 워크트리를 만들지 못했다"; }

if [ -x "$HEAVY" ]; then
  (cd "$W" && "$HEAVY" --pool docker bash -c "$CMD") > "$LOG" 2>&1
else
  (cd "$W" && bash -c "$CMD") > "$LOG" 2>&1
fi
rc=$?

if [ "$rc" -eq 75 ] && grep -qE '^HEAVY_(DOCKER_)?BUSY' "$LOG" 2>/dev/null; then
  echo "DIALECT_BUSY $(short "$SHA")"
  exit 75
fi
# 126·127·128 이상(실행 불가·명령 없음·시그널로 죽음 — 잘못된 JAVA_HOME·OOM kill 등)은 코드 판정이 아니다. 실패로
# 기록하면 그 커밋이 영영 다시 돌지 않고 머지된 Task 가 누명을 쓴다. 기록하지 않고 다음 스윕이 다시 시도한다
# (baseline.sh 가 같은 exit 를 저장하지 않는 것과 같은 규칙).
if [ "$rc" -eq 126 ] || [ "$rc" -eq 127 ] || [ "$rc" -ge 128 ]; then
  n=1; [ "$(get errored)" = "$SHA" ] && n=0
  put errored "$SHA"
  tail -n 20 "$LOG" >&2
  echo "DIALECT_ERROR exit=$rc $(short "$SHA") notify=$n log=$LOG"
  exit 2
fi

S=$( [ -n "$SINCE" ] && short "$SINCE" || echo - )
if [ "$rc" -eq 0 ]; then
  res="DIALECT_PASS $(short "$SHA") since=$S tasks=$TASKS unverified=$UNV"
  put last_pass "$SHA"; put deferred ''; put errored ''; put last_result "$res"
  [ -z "$UNV_LINES" ] || printf '%s\n' "$UNV_LINES"
  echo "$res"
  exit 0
fi
res="DIALECT_FAIL $(short "$SHA") exit=$rc since=$S tasks=$TASKS unverified=$UNV log=$LOG"
put last_fail "$SHA"; put deferred ''; put errored ''; put last_result "$res"
tail -n 20 "$LOG" >&2
[ -z "$UNV_LINES" ] || printf '%s\n' "$UNV_LINES"
echo "$res"
exit 1
