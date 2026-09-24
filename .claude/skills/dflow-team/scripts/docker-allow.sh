#!/usr/bin/env bash
# /dflow-team 도커 허용 판정 — 포인터의 DOCKER 값을 작업의 서버 tags 로 정한다. 절차 정본: ../SKILL.md 「인자」 의
# 「도커 허용 태그」, 규칙 정본: ../../dflow-dev/references/dev-discipline.md 「도커 사용 규칙」.
#
# 워커는 도커를 쓰지 않는 것이 기본이다(인원과 무관). D'Flow 작업의 tags 에 `docker`(대소문자 무시)가 있는 Task 의
# 워커만 허용한다. 2026-09-24 dmes-standard: 인원 기준(4명 이상 금지)만으로는 3명 이하일 때 워커마다 같은 목적(DB 방언
# 검증)으로 컨테이너를 따로 띄우는 것을 막지 못했다.
#
# 사용법
#   docker-allow.sh <id8|order UUID>   dflow.sh show 로 tags 를 읽는다(DFLOW_SH 로 dflow.sh 경로를 바꾼다 — 시험용)
#   docker-allow.sh --json             show 응답 JSON 을 stdin 으로 받는다
# 출력 한 줄(stdout), 늘 exit 0:
#   DOCKER=allow tag=docker        포인터에 DOCKER=allow 를 싣는다
#   DOCKER=ban tag=none            태그 없음(기본 금지)
#   DOCKER=ban show-failed         조회 실패 — 모르면 금지(fail-closed). 옛 포인터 값을 옮겨 쓰지 않는다
# spawn·재개·재시작·해소 포인터를 쓸 때마다 부른다. 사람이 그사이 태그를 바꿨을 수 있고, 옛 팀장이 인원 기준으로 적은
# NO_DOCKER=0 이 옛 포인터에 남아 있을 수 있기 때문이다.
set -u

json=''
case "${1:-}" in
  --json) json=$(cat) ;;
  ''|-*) echo "사용법: docker-allow.sh <id8|order> | --json" >&2; exit 2 ;;
  *)
    DFLOW="${DFLOW_SH:-$(cd "$(dirname "$0")/../../dflow-work/scripts" 2>/dev/null && pwd)/dflow.sh}"
    json=$("$DFLOW" show "$1" 2>/dev/null) || json=''
    ;;
esac

v=$(printf '%s' "$json" | jq -r 'select((.order.id // "") != "") | .order.item.tags // [] | map(ascii_downcase) | index("docker") != null' 2>/dev/null)
case "$v" in
  true) echo "DOCKER=allow tag=docker" ;;
  false) echo "DOCKER=ban tag=none" ;;
  *) echo "DOCKER=ban show-failed" ;;
esac
exit 0
