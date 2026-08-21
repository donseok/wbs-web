#!/bin/sh
# poll.sh — D'Flow ready 작업 감시 루프 (dflow-poll 스킬 전용).
# ready 발견 시 stdout 에 "순번<TAB>id8<TAB>이름" 을 줄 단위로 내고 종료한다.
# exit: 0 ready 발견 / 2 사용법·설정 / 3 인증 / 5 권한 / 7 기능꺼짐 (dflow.sh 코드 전파)
#       / 6 네트워크 오류 연속 한도 초과 / 8 종료 시각 도달
# 토큰은 env 확장으로만 다룬다 — echo·파일 기록·명령 문자열 보간 금지.
set -u

INTERVAL=300
UNTIL=1800        # HHMM. --until HH:MM 로 변경. 자정 넘김(예: 02:00) 미지원 — 야간 사용 금지.
EXCLUDE=""        # 쉼표 구분 id8 목록 — claim 이 선행 미충족(exit 4)으로 막힌 작업 제외용
NET_FAIL_MAX=3

usage() { echo "사용법: poll.sh [--interval 초] [--until HH:MM] [--exclude id8,id8]" >&2; exit 2; }

while [ $# -gt 0 ]; do
  case "$1" in
    --interval) INTERVAL="${2:-}"; shift 2 || usage ;;
    --until)    UNTIL=$(printf '%s' "${2:-}" | tr -d ':'); shift 2 || usage ;;
    --exclude)  EXCLUDE="${2:-}"; shift 2 || usage ;;
    *) usage ;;
  esac
done
case "$INTERVAL" in ''|*[!0-9]*) usage ;; esac
case "$UNTIL"    in ''|*[!0-9]*) usage ;; esac

ENV_FILE="${DFLOW_ENV_FILE:-$HOME/project/wbs-web/.env}"
DFLOW="${DFLOW_SH:-$HOME/project/wbs-web/.claude/skills/dflow-work/scripts/dflow.sh}"
[ -f "$ENV_FILE" ] || { echo "env 파일 없음: $ENV_FILE" >&2; exit 2; }
[ -x "$DFLOW" ]   || { echo "dflow.sh 없음: $DFLOW" >&2; exit 2; }
set -a; . "$ENV_FILE"; set +a

net_fail=0
while :; do
  # date +%H%M 는 선행 0 을 포함하지만 test(1) 는 십진수로 비교한다
  now=$(date +%H%M)
  [ "$now" -ge "$UNTIL" ] && { echo "종료 시각 도달(--until $UNTIL)" >&2; exit 8; }

  out=$("$DFLOW" list --scope assigned 2>&1); rc=$?
  case "$rc" in
    0)
      net_fail=0
      ready=$(printf '%s\n' "$out" | awk -F'\t' -v ex=",$EXCLUDE," \
        '$2=="RD" && index(ex, ","$4",")==0 {print $1"\t"$4"\t"$5}')
      [ -n "$ready" ] && { printf '%s\n' "$ready"; exit 0; }
      ;;
    3|5|7) printf '%s\n' "$out" >&2; exit "$rc" ;;
    6)
      net_fail=$((net_fail+1))
      [ "$net_fail" -ge "$NET_FAIL_MAX" ] && { echo "네트워크 오류 ${NET_FAIL_MAX}회 연속 — 중단" >&2; exit 6; }
      ;;
    *) printf '%s\n' "$out" >&2; exit "$rc" ;;
  esac
  sleep "$INTERVAL"
done
