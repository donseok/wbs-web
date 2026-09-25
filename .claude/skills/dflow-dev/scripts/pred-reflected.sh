#!/bin/sh
# /dflow-dev 「--worker」 행 G 의 기본 브랜치 반영 확인 — 워커와 /dflow-team 팀장(선행 반영 사전 검사)이 함께 쓴다.
# 판정 = state.json phase=merged AND (증거 1 head_sha 조상 | 증거 2 DFlow-Order 트레일러 | 증거 3 머지 커밋 제목).
# 규칙의 정본은 dflow-dev/references/worker-mode.md 「행 G — 기본 브랜치 반영 확인」 이고, 이 스크립트는 그 실행체다.
# 판정 이력:
# - 종전에는 phase=merged 에 트레일러(증거 2) 하나를 AND 로 요구했다. 트레일러를 붙이라는 지시가 없어 부착이 우연에
#   맡겨졌고(작업마다 0건·13건), 2026-09-22 mdm-dict-v2 실측에서 선행 4건 TSK-03-07·03-09·03-11·03-12 가 origin/main 에
#   머지됐는데 트레일러가 0건이라 후속 3건 TSK-03-10·03-13·04-01 이 모두 막혔다. 지금은 커밋 규칙과 /dflow-merge 가
#   트레일러를 못 박지만 과거 커밋에는 없을 수 있고 훅으로 강제하지도 않아 증거를 셋으로 넓혔다.
# - state.json 정본 스키마에는 아직 head_sha 가 없다(같은 실측: 막혔던 선행 4건 모두 없음). 그래서 증거 1 은 거의 늘 판정
#   불가로 건너뛰고 증거 3(머지 커밋 제목)이 실제 사례를 푼다(네 건 모두 증거 3 은 있었다). 그래도 증거 1 을 첫 자리에
#   두는 이유: 커밋 메시지·state.json 값 없이도 성립하는 유일한 구조적 증거라, 스키마가 head_sha 를 갖게 되면 곧바로
#   가장 강한 증거가 된다.
# - 트레일러 패턴의 콜론 뒤 공백: 2026-09-17 실측에서 공백 없는 패턴 0 건, 공백 있는 패턴 2 건이었다.
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
