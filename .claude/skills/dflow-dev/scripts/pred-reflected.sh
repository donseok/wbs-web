#!/bin/sh
# /dflow-dev 「--worker」 행 G 의 기본 브랜치 반영 확인 — 워커와 /dflow-team 팀장(선행 반영 사전 검사)이 함께 쓴다.
# 판정 = state.json phase=merged AND (증거 1 head_sha 조상 | 증거 2 DFlow-Order 트레일러 | 증거 3 머지 커밋 제목).
# 설명·이유의 정본은 dflow-dev/SKILL.md 행 G 이고, 이 스크립트는 그 실행체다.
# 사용: pred-reflected.sh <TASKS> <선행TSK> <DEV_BRANCH>   cwd = 리포(워크트리) 루트. 부르기 전에 git fetch origin 을 한다.
#   <TASKS> 는 선행 Task 폴더의 부모(예 docs/tasks). 이 스크립트는 fetch 하지 않는다 — 한 기상에 여러 번 부르기 때문이다.
# 출력 첫 낱말: REFLECTED <1|2|3>(exit 0) · NOT_REFLECTED <사유>(exit 1) · UNKNOWN <사유>(exit 2)
# UNKNOWN 은 판정 불가다. 호출자는 그것을 "반영 안 됨" 으로 단정하지 않는다(팀장은 거르지 않고 워커에 맡긴다).
set -u

[ $# -eq 3 ] && [ -n "$1" ] && [ -n "$2" ] && [ -n "$3" ] || { echo "UNKNOWN usage"; exit 2; }
tasks=${1%/}; tsk=$2; dev=$3
command -v jq >/dev/null 2>&1 || { echo "UNKNOWN no-jq"; exit 2; }
git rev-parse --verify -q "refs/remotes/origin/$dev" >/dev/null 2>&1 || { echo "UNKNOWN no-dev-branch origin/$dev"; exit 2; }

st=$(git show "origin/$dev:$tasks/$tsk/state.json" 2>/dev/null) || { echo "NOT_REFLECTED no-state"; exit 1; }
phase=$(printf '%s' "$st" | jq -r '.phase // ""' 2>/dev/null) || { echo "UNKNOWN bad-state-json"; exit 2; }
[ "$phase" = merged ] || { echo "NOT_REFLECTED phase=${phase:-none}"; exit 1; }
order=$(printf '%s' "$st" | jq -r '.order // ""')
head=$(printf '%s' "$st" | jq -r '.head_sha // ""')

# 증거 1 — 커밋 그래프의 조상 관계. head_sha 가 없으면 판정 불가로 건너뛴다.
if [ -n "$head" ] && git merge-base --is-ancestor "$head" "origin/$dev" 2>/dev/null; then
  echo "REFLECTED 1"; exit 0
fi
# 증거 2 — 트레일러. 콜론 뒤 공백을 반드시 넣는다(실제 트레일러가 "DFlow-Order: <uuid>").
if [ -n "$order" ]; then
  hit=$(git log "origin/$dev" --grep="DFlow-Order: $order" --format=%h 2>/dev/null) || { echo "UNKNOWN git-log"; exit 2; }
  [ -z "$hit" ] || { echo "REFLECTED 2"; exit 0; }
fi
# 증거 3 — 머지 커밋 제목. TSK 뒤 공백까지 넣는다(TSK-03-1 이 TSK-03-10 을 집지 않게).
hit=$(git log "origin/$dev" --merges --grep="^merge: $tsk " --format=%h 2>/dev/null) || { echo "UNKNOWN git-log"; exit 2; }
[ -z "$hit" ] || { echo "REFLECTED 3"; exit 0; }
echo "NOT_REFLECTED no-evidence"; exit 1
