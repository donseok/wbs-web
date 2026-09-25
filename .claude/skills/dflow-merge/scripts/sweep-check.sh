#!/usr/bin/env bash
# 스윕 사전 검사 — /dflow-team 팀장이 `/dflow-merge` 를 부르기 전에, 스윕할 후보가 하나라도 있는지 서버 조회 없이
# 빠르게 본다. 후보 정의의 정본은 ../SKILL.md 「절차」 1번(후보 식별)과 그 「api_base 필터」 다. 1번을 바꾸면 여기도 고친다
# (tests/skills/dflow-sweep-check.test.ts 가 정본 블록과 이 스크립트의 후보를 같은 샌드박스에서 대조한다).
#
# 왜: 2026-09-24 실측(약 17시간) — 팀장은 스윕마다 Skill 도구로 /dflow-merge(약 61KB)를 다시 불러 문맥에 실었고, 스윕
# 38회 중 20회가 머지 0건이었다(49초 간격 스윕도 있었다). 후보가 없으면 부르지 않는다.
#
# 사용법(팀장 체크아웃 안 어디서든): sweep-check.sh [--dev <개발 브랜치>]
#   --dev 가 없으면 dflow.sh branch dev 로 구한다.
#
# 후보(정본 1번의 상위 집합 — 더 많이 낼 수는 있어도 덜 내지 않는다):
#   로컬  : tasks-dirs 폴더마다 <폴더>/*/state.json 중 phase=reported, 또는 phase=merged 이고 unapproved=true.
#           작업 트리와 origin/<dev> 트리를 **둘 다** 본다. 팀장 체크아웃은 스윕 끝에만 origin/<dev> 로 다시 detach 하므로,
#           그사이 해소 워커(--on-report)가 origin/<dev> 에 올린 승인 전 머지분을 작업 트리만 보면 놓친다.
#   원격  : origin/agent/* 마다 git diff --name-only origin/<dev>...<ref> -- <폴더>/*/state.json 으로 찾은 state.json 중
#           order 가 브랜치 id8 로 시작하고 phase 가 merged 가 아닌 것.
#   api_base 필터(중복 제거 뒤): 로컬 후보는 값이 없거나 같으면, 원격 전용 후보는 값이 같을 때만 후보다. 로컬과 원격에
#           같은 order 가 있으면 로컬로 합친다(값이 서로 다르면 정본은 건너뛰지만 여기서는 후보로 남긴다 — 상위 집합).
#
# 출력(stdout, 마지막 줄이 판정. 늘 exit 0 — 사용법 오류만 exit 2):
#   SWEEP_CANDIDATES n=<N> <id8…>        후보가 있다 — /dflow-merge 를 부른다
#   SWEEP_NONE                           후보가 없다 — /dflow-merge 를 부르지 않는다
#   SWEEP_UNKNOWN <사유>                  판정하지 못했다(fetch·설정·git·jq 실패) — 호출자는 스윕을 **돌린다**(fail-open)
# 판정 줄 앞에 올 수 있는 줄:
#   SWEEP_DIALECT_PENDING <sha12|unknown> 방언 검증(dialect_check)이 개발 브랜치 끝 커밋을 아직 판정하지 않았다(보류·BUSY·
#                                        오류 포함, 문서뿐 이월 docs_only 제외). SWEEP_NONE 이어도 호출자가 dialect-check.sh 를 직접 한 번 부른다.
set -u

usage() { echo "사용법: sweep-check.sh [--dev <개발 브랜치>]" >&2; echo "SWEEP_UNKNOWN usage"; exit 2; }
unknown() { echo "SWEEP_UNKNOWN $*"; exit 0; }

DEV=''
while [ $# -gt 0 ]; do
  case "$1" in
    --dev) DEV="${2:-}"; [ -n "$DEV" ] || usage; shift 2 ;;
    *) usage ;;
  esac
done

HERE=$(cd "$(dirname "$0")" && pwd)
DFLOW="${DFLOW_SH:-$HERE/../../dflow-work/scripts/dflow.sh}"

TOP=$(git rev-parse --show-toplevel 2>/dev/null) || unknown "git 체크아웃이 아니다"
cd "$TOP" || unknown "리포 최상위로 가지 못했다"   # tasks-dirs·pathspec 은 리포 최상위 기준이다

if [ -z "$DEV" ]; then
  DEV=$("$DFLOW" branch dev 2>/dev/null) || unknown "개발 브랜치를 모른다(dflow.sh branch dev)"
  [ -n "$DEV" ] || unknown "개발 브랜치가 비었다"
fi
api=$("$DFLOW" config api_base 2>/dev/null) || unknown "api_base 조회 실패"
api=${api%/}
[ -n "$api" ] || unknown "api_base 가 비었다"
dirs=$("$DFLOW" config tasks-dirs 2>/dev/null); rc=$?
# 빈 값이면 "/*/state.json" pathspec 이 리포 밖으로 풀려 후보가 조용히 0건이 된다(정본 1번의 같은 경고)
{ [ "$rc" = 0 ] && [ -n "$dirs" ]; } || unknown "tasks-dirs 조회 실패(exit $rc)"

git fetch -q origin 2>/dev/null || unknown "git fetch 실패"
TIP=$(git rev-parse --verify -q "refs/remotes/origin/$DEV^{commit}") || unknown "origin/$DEV 가 없다"

ROWS=$(mktemp "${TMPDIR:-/tmp}/dflow-sweep.XXXXXX") || unknown "임시 파일을 만들지 못했다"
trap 'rm -f "$ROWS"' EXIT

# jq 필터 — 정본 1번과 같은 판정. 줄: <src>\t<order>\t<api 분류>
LOCAL_JQ='select(.phase == "reported" or (.phase == "merged" and .unapproved == true))
  | ["L", (.order // ""), (if (.api_base // "") == "" then "none" elif .api_base == $api then "same" else "other" end)] | @tsv'
REMOTE_JQ='select((.order // "") | startswith($id8)) | select(.phase != "merged")
  | ["R", .order, (if (.api_base // "") == "" then "none" elif .api_base == $api then "same" else "other" end)] | @tsv'

set --
while IFS= read -r d; do
  [ -n "$d" ] || continue
  set -- "$@" "$d/*/state.json"
  # 로컬(작업 트리). glob 을 쓰지 않는다 — 폴더가 없으면 find 는 조용히 아무것도 내지 않는다(정본과 같다)
  files=$(find "$d" -mindepth 2 -maxdepth 2 -name state.json 2>/dev/null)
  while IFS= read -r f; do
    [ -n "$f" ] || continue
    jq -r --arg api "$api" "$LOCAL_JQ" "$f" >> "$ROWS" 2>/dev/null || unknown "state.json 을 읽지 못했다: $f"
  done <<EOF2
$files
EOF2
  # 로컬(origin/<dev> 트리) — 팀장 체크아웃이 뒤처져 있어도 개발 브랜치의 승인 전 머지분을 본다
  paths=$(git ls-tree -r --name-only "$TIP" -- "$d" 2>/dev/null) || unknown "ls-tree 실패: origin/$DEV $d"
  while IFS= read -r p; do
    [ -n "$p" ] || continue
    case "${p#"$d"/}" in */*/*) continue ;; */state.json) ;; *) continue ;; esac
    j=$(git show "$TIP:$p" 2>/dev/null) || unknown "git show 실패: origin/$DEV:$p"
    printf '%s' "$j" | jq -r --arg api "$api" "$LOCAL_JQ" >> "$ROWS" 2>/dev/null || unknown "state.json 을 읽지 못했다: origin/$DEV:$p"
  done <<EOF2
$paths
EOF2
done <<EOF
$dirs
EOF
[ $# -gt 0 ] || unknown "tasks-dirs 가 비었다"

# 원격 — 정본 블록과 달리 git 실패를 파이프 뒤로 흘리지 않는다(흘리면 후보가 조용히 0건이 된다)
refs=$(git branch -r --list 'origin/agent/*' 2>/dev/null) || unknown "원격 브랜치 목록 실패"
for ref in $refs; do
  id8=$(printf '%s' "${ref#origin/agent/}" | cut -c1-8)
  names=$(git diff --name-only "refs/remotes/origin/$DEV...refs/remotes/$ref" -- "$@" 2>/dev/null) \
    || unknown "git diff 실패: $ref"
  while IFS= read -r p; do
    [ -n "$p" ] || continue
    j=$(git show "refs/remotes/$ref:$p" 2>/dev/null) || unknown "git show 실패: $ref:$p"
    printf '%s' "$j" | jq -r --arg id8 "$id8" --arg api "$api" "$REMOTE_JQ" >> "$ROWS" 2>/dev/null \
      || unknown "state.json 을 읽지 못했다: $ref:$p"
  done <<EOF
$names
EOF
done

# 중복 제거 → api_base 필터. 로컬이 있으면 로컬 규칙(값이 모두 other 가 아니면 후보), 원격 전용이면 same 이 있어야 후보
cands=$(awk -F'\t' '
  $2 == "" { next }
  { o = $2; seen[o] = 1
    if ($1 == "L") { loc[o] = 1; if ($3 == "same") ls[o] = 1; else if ($3 == "none") ln[o] = 1; else lo[o] = 1 }
    else           { if ($3 == "same") rs[o] = 1; else if ($3 == "other") ro[o] = 1 } }
  END {
    for (o in seen) {
      if (o in loc) { anysame = (o in ls) || (o in rs); anyother = (o in lo) || (o in ro)
                      if (anysame || !anyother) print substr(o, 1, 8) }
      else if (o in rs) print substr(o, 1, 8)
    }
  }' "$ROWS" | sort -u) || unknown "후보 집계 실패"

# 방언 검증 대기 — 정본 「방언 검증」 은 스윕 끝에 돌며 보류·BUSY·오류를 "다음 스윕" 이 다시 시도한다. 스윕을 건너뛰어도
# 그 재시도가 굶지 않게 알린다.
dc=$("$DFLOW" config dialect_check 2>/dev/null); dcrc=$?
if [ "$dcrc" != 0 ]; then
  echo "SWEEP_DIALECT_PENDING unknown"
elif [ -n "$dc" ]; then
  CD=$(cd "$(git rev-parse --git-common-dir)" 2>/dev/null && pwd) || CD=''
  ST="$CD/dflow-dialect/$(printf '%s' "$DEV" | tr '/ ' '__').state"
  lp=$(sed -n 's/^last_pass=//p' "$ST" 2>/dev/null | head -n 1)
  lf=$(sed -n 's/^last_fail=//p' "$ST" 2>/dev/null | head -n 1)
  ld=$(sed -n 's/^docs_only=//p' "$ST" 2>/dev/null | head -n 1)   # 문서뿐 이월도 판정이다(last_pass 는 옮기지 않는다)
  [ "$TIP" = "$lp" ] || [ "$TIP" = "$lf" ] || [ "$TIP" = "$ld" ] || echo "SWEEP_DIALECT_PENDING $(printf '%s' "$TIP" | cut -c1-12)"
fi

if [ -n "$cands" ]; then
  n=$(printf '%s\n' "$cands" | wc -l | tr -d ' ')
  echo "SWEEP_CANDIDATES n=$n $(printf '%s\n' "$cands" | tr '\n' ' ' | sed 's/ $//')"
else
  echo "SWEEP_NONE"
fi
exit 0
