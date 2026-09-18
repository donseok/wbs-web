#!/usr/bin/env bash
# 같은 리포의 다른 워크트리에서 살아 있는 /dflow-team 팀장을 찾는다. /dflow-team 「인자」 키 판정이 쓴다.
# 사용: live-leads.sh          한 줄에 하나: <신원 슬러그><TAB><워크트리 경로>
#       live-leads.sh --mark   stdin 의 `dflow.sh profiles` 행(JSON)에 in_use 를 더해 낸다. JSON 이 아닌 줄은 그대로 낸다.
#                              in_use 는 그 키의 신원(who)을 쓰는 팀장의 워크트리 경로이며, 없으면 null 이다.
# 살아 있음의 기준은 SKILL.md 「1. 시작」 의 SAME_IDENTITY_LEAD 와 같다: 다른 워크트리의 dflow-team.lock 의 owner
# 첫 칸이 <신원>/<이 PC 의 host>/lead 이고, beat 가 70분 안(beat 가 없으면 잠금 디렉터리 수정 시각이 10분 안)이다.
# 두 기준이 어긋나면 키 판정이 고른 키를 전제 검사가 거부하거나, 거부될 키를 키 판정이 후보로 낸다.
set -u
MAIN=$(git rev-parse --show-toplevel 2>/dev/null) || { echo "FAIL NOT_GIT" >&2; exit 2; }
host=$(hostname | cut -d. -f1 | tr 'A-Z' 'a-z' | sed 's/[^a-z0-9-]/-/g')

stale() {   # $1: 잠금 디렉터리
  b=$(cat "$1/beat" 2>/dev/null || true)
  if [ -n "$b" ]; then [ $(( $(date +%s) - b )) -ge 4200 ]
  else [ -n "$(find "$1" -maxdepth 0 -mmin +10 2>/dev/null)" ]; fi
}

leads() {
  git worktree list --porcelain | sed -n 's/^worktree //p' | while IFS= read -r w; do
    [ "$w" = "$MAIN" ] && continue
    l=$(git -C "$w" rev-parse --path-format=absolute --git-path dflow-team.lock 2>/dev/null) || continue
    [ -d "$l" ] || continue
    o=$(cut -d' ' -f1 "$l/owner" 2>/dev/null)
    case "$o" in */"$host"/lead) ;; *) continue ;; esac
    stale "$l" && continue
    printf '%s\t%s\n' "${o%%/*}" "$w"
  done
}

case "${1:-}" in
  '') leads ;;
  --mark)
    L=$(leads)
    while IFS= read -r line || [ -n "$line" ]; do
      case "$line" in
        '{'*)
          printf '%s\n' "$line" | jq -c --arg l "$L" '
            ($l | split("\n") | map(select(. != "") | split("\t") | {key: .[0], value: .[1]}) | from_entries) as $m
            | . + {in_use: (if (.who // "") == "" then null else ($m[.who] // null) end)}' 2>/dev/null \
            || printf '%s\n' "$line" ;;
        *) printf '%s\n' "$line" ;;
      esac
    done ;;
  *) echo "사용: live-leads.sh [--mark]" >&2; exit 2 ;;
esac
