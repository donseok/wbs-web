#!/usr/bin/env bash
# sections.sh — 마크다운 파일에서 제목으로 절만 출력한다. /dflow-dev 오케스트레이터가 dev-discipline.md·phase-prompt.md 를
# 통째로 읽지 않고 그 단계에 필요한 절만 읽게 한다(설계 docs/superpowers/specs/2026-09-26-dflow-dev-skill-router-design.md §5).
#
# 사용: sections.sh <파일> <제목>...
#   <제목> 은 '#' 을 뺀 제목 문구의 앞부분이다(예: '기준선 캐시', '도커 사용 규칙'). 앞부분이 같은 제목이 여럿이면 모두 낸다.
#   절은 그 제목부터 같거나 높은 단계의 다음 제목 앞까지다 — `##` 절이면 딸린 `###` 까지 나온다.
#   <제목> 앞에 `=` 를 붙이면 딸린 절 없이 그 제목의 본문만 낸다(다음 제목 앞까지, 단계 무관).
#   코드 펜스(```) 안의 `#` 줄은 제목으로 보지 않는다.
# 출력: 찾은 절을 인자 순서대로. 못 찾은 제목마다 `SECTION_MISSING <제목>` 한 줄.
# exit: 0 모두 찾음 / 3 하나라도 못 찾음(찾은 절은 이미 냈다 — 호출자는 그 파일 전체를 Read 한다) / 2 사용법 오류·파일 없음.
set -u
[ $# -ge 2 ] || { echo "사용법: sections.sh <파일> <제목>..." >&2; exit 2; }
f=$1; shift
[ -r "$f" ] || { echo "SECTION_FILE_MISSING $f"; exit 2; }
rc=0
for t in "$@"; do
  own=0
  case $t in =*) own=1; t=${t#=} ;; esac
  [ -n "$t" ] || { echo "SECTION_MISSING (빈 제목)"; rc=3; continue; }
  if out=$(awk -v t="$t" -v own="$own" '
    /^[ \t]*```/ { fence = !fence; if (on) print; next }
    !fence && /^#+ / {
      lv = index($0, " ") - 1
      title = substr($0, lv + 2)
      if (on && (own || lv <= onlv)) on = 0
      if (!on && index(title, t) == 1) { on = 1; onlv = lv; found = 1 }
    }
    on { print }
    END { exit found ? 0 : 1 }' "$f"); then
    printf '%s\n' "$out"
  else
    echo "SECTION_MISSING $t"
    rc=3
  fi
done
exit $rc
