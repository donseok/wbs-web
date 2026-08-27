#!/bin/sh
# poll.sh — D'Flow ready 작업 감시 루프 (dflow-poll 스킬 전용).
# ready 발견 시 stdout 에 "순번<TAB>id8<TAB>이름" 을 줄 단위로 내고 종료한다.
# 승인 감지 시 stdout 에 "TSK<TAB>order-id" 를 줄 단위로 내고 exit 9 — 세션이 머지 스윕을 돌린다.
# 반려 감지 시 stdout 에 "TSK<TAB>order-id<TAB>review_note" 를 내고 exit 10 — 세션이 재작업에 들어간다.
# exit: 0 ready 발견 / 2 사용법·설정 / 3 인증 / 5 권한 / 7 기능꺼짐 (dflow.sh 코드 전파)
#       8 종료시각 / 9 승인 감지 / 10 반려 감지
#       / 6 네트워크·일시 오류 연속 한도 초과 / 8 종료 시각 도달 / 9 승인 감지(머지 대상)
# 토큰은 env 확장으로만 다룬다 — echo·파일 기록·명령 문자열 보간 금지.
set -u

INTERVAL=300
UNTIL=1800        # HHMM. --until HH:MM 로 변경. 자정 넘김(예: 02:00) 미지원 — 야간 사용 금지.
EXCLUDE=""        # 쉼표 구분 id8 — 영구성 제외(사용자 결정 대기 등). 사람이 풀기 전까지 유지.
EXCLUDE_TEMP=""   # 쉼표 구분 id8 — 일시성 제외(spec 부재·선행 대기). RECHECK_CYCLES 뒤 자동 해제
                  # → 재발견(exit 0)으로 세션이 착수 판정을 다시 하게 만든다(자율 재검사).
RECHECK_CYCLES=6  # 일시성 제외를 유지할 주기 수. 기본 6주기(interval 300s면 30분).
REQUIRE_TAG=""    # 지정 시 item.tags 에 이 태그가 있는 작업만 감지(에이전트 위임 플래그).
                  # list 응답에는 tags 가 없어 후보별 show 1회씩 조회한다.
NET_FAIL_MAX=3

usage() { echo "사용법: poll.sh [--interval 초] [--until HH:MM] [--exclude id8,id8] [--exclude-temp id8,id8] [--recheck-cycles N] [--require-tag 태그]" >&2; exit 2; }

while [ $# -gt 0 ]; do
  case "$1" in
    --interval)       INTERVAL="${2:-}"; shift 2 || usage ;;
    --until)          UNTIL=$(printf '%s' "${2:-}" | tr -d ':'); shift 2 || usage ;;
    --exclude)        EXCLUDE="${2:-}"; shift 2 || usage ;;
    --exclude-temp)   EXCLUDE_TEMP="${2:-}"; shift 2 || usage ;;
    --recheck-cycles) RECHECK_CYCLES="${2:-}"; shift 2 || usage ;;
    --require-tag)    REQUIRE_TAG="${2:-}"; shift 2 || usage ;;
    *) usage ;;
  esac
done
case "$INTERVAL"       in ''|*[!0-9]*) usage ;; esac
case "$UNTIL"          in ''|*[!0-9]*) usage ;; esac
case "$RECHECK_CYCLES" in ''|*[!0-9]*) usage ;; esac

# 기본 좌표는 자기 위치 기준 — 이 스킬 묶음(.claude/skills/)을 어느 리포에 심어도 닫힌다.
SKILLS_DIR=$(cd "$(dirname "$0")/../.." && pwd)
ENV_FILE="${DFLOW_ENV_FILE:-$PWD/.env}"
DFLOW="${DFLOW_SH:-$SKILLS_DIR/dflow-work/scripts/dflow.sh}"
STATE_GLOB="$PWD/docs/tasks"   # dflow-dev state.json 위치 — 승인 감지 재료
[ -f "$ENV_FILE" ] || { echo "env 파일 없음: $ENV_FILE" >&2; exit 2; }
[ -x "$DFLOW" ]   || { echo "dflow.sh 없음: $DFLOW" >&2; exit 2; }
set -a; . "$ENV_FILE"; set +a

net_fail=0
cycle=0
while :; do
  # date +%H%M 는 선행 0 을 포함하지만 test(1) 는 십진수로 비교한다
  now=$(date +%H%M)
  [ "$now" -ge "$UNTIL" ] && { echo "종료 시각 도달(--until $UNTIL)" >&2; exit 8; }

  cycle=$((cycle+1))
  # 일시성 제외는 스스로 풀린다 — RECHECK_CYCLES 지나면 해제해 재발견을 유도하고,
  # 세션이 착수 판정을 다시 해 여전히 막혀 있으면 다시 제외로 재기동한다(사람 개입 불요).
  if [ -n "$EXCLUDE_TEMP" ] && [ "$cycle" -gt "$RECHECK_CYCLES" ]; then
    echo "일시성 제외 해제(재검사 유도): $EXCLUDE_TEMP" >&2
    EXCLUDE_TEMP=""
  fi

  # ── 승인 감지 (ready 스캔보다 먼저 — 머지가 후속 작업을 해금한다) ──────────────
  # 로컬 state.json 이 phase=reported 인 주문의 서버 status 가 approved 로 바뀌었으면
  # 그게 트리거다: 사람이 웹에서 승인해도 착수할 ready 가 없으면 아무도 못 보던 구멍(2026-08-25).
  merge_hits=''
  reject_hits=''
  if [ -d "$STATE_GLOB" ]; then
    for _sf in "$STATE_GLOB"/*/state.json; do
      [ -f "$_sf" ] || continue
      _phase=$(jq -r '.phase // empty' "$_sf" 2>/dev/null) || continue
      # merged 도 훑는다(2026-08-27) — 사람이 승인을 무르고 재작업을 요청하면 서버는
      # approved→claimed 로 롤백하는데, 그 시점 로컬은 이미 merged 다. reported 만 보면
      # 그 재작업은 영영 안 잡힌다(ready 도 아니라서 아래 ready 스캔에도 안 걸린다).
      case "$_phase" in reported|merged) ;; *) continue ;; esac
      _ord=$(jq -r '.order // empty' "$_sf" 2>/dev/null)
      [ -n "$_ord" ] || continue
      _tsk=$(jq -r '.tsk // empty' "$_sf" 2>/dev/null)
      # show 를 한 번만 부르고 status 와 마지막 완료리포트를 같은 응답에서 뽑는다(추가 호출 0회).
      _json=$("$DFLOW" show "$_ord" 2>/dev/null) || _json=''
      _st=$(printf '%s' "$_json" | jq -r '.order.status // empty' 2>/dev/null) || _st=''
      # 반려 신호는 order 에 없다 — status 는 claimed 로 롤백될 뿐이라 일반 claimed 와 구분 불가.
      # 최상위 .reports 의 마지막 completion 리포트 review_action 이 유일한 판정 근거(2026-08-25 실측).
      _rv=$(printf '%s' "$_json" | jq -r '[.reports[]? | select(.kind == "completion")] | last | .review_action // empty' 2>/dev/null) || _rv=''
      # merged + approved 는 이미 처리를 마친 주문이다 — 여기서 다시 잡으면 머지가 무한 재발한다.
      if [ "$_st" = "approved" ] && [ "$_phase" = "reported" ]; then
        merge_hits="${merge_hits}${_tsk}	${_ord}
"
      elif [ "$_rv" = "reject" ]; then
        # 사유는 한 줄로 눌러 담는다 — 출력 계약이 TAB 구분 한 줄이라 개행·탭이 섞이면 깨진다.
        _note=$(printf '%s' "$_json" | jq -r '[.reports[]? | select(.kind == "completion")] | last | .review_note // ""' 2>/dev/null | tr '\n\t' '  ' | sed 's/ *$//')
        reject_hits="${reject_hits}${_tsk}	${_ord}	${_note}
"
      elif [ -z "$_st" ]; then
        # 조용히 묻으면 "감지가 도는데 안 잡힌다"와 "조회가 깨졌다"를 구분 못 한다(2026-08-25).
        # state.json 의 order 는 전체 UUID 가 계약 — id8 이면 dflow.sh idmap 폴백에 걸리길 빌 뿐이다.
        echo "승인 조회 실패: ${_tsk} (order=${_ord}) — show 해석 불가(전체 UUID 로 기록됐는지 확인)" >&2
      fi
    done
  fi
  [ -n "$merge_hits" ] && { printf '%s' "$merge_hits"; exit 9; }
  # 반려는 승인 다음 — 머지가 후속을 해금하는 게 먼저고, 반려는 재작업이라 급하지 않다.
  [ -n "$reject_hits" ] && { printf '%s' "$reject_hits"; exit 10; }

  out=$("$DFLOW" list --scope assigned 2>&1); rc=$?
  case "$rc" in
    0)
      net_fail=0
      ready=$(printf '%s\n' "$out" | awk -F'\t' -v ex=",$EXCLUDE,$EXCLUDE_TEMP," \
        '$2=="RD" && index(ex, ","$4",")==0 {print $1"\t"$4"\t"$5}')
      # 위임 플래그 필터: --require-tag 지정 시 태그가 있는 작업만 남긴다.
      # 태그 없는 ready 는 수동 몫이므로 감지 대상이 아니다(통지는 세션이 한다).
      if [ -n "$ready" ] && [ -n "$REQUIRE_TAG" ]; then
        _kept=''
        while IFS= read -r _line; do
          [ -n "$_line" ] || continue
          _id=$(printf '%s' "$_line" | cut -f2)
          _tags=$("$DFLOW" show "$_id" 2>/dev/null | jq -r '.order.item.tags // [] | join(",")') || _tags=''
          case ",$_tags," in
            *",$REQUIRE_TAG,"*) _kept="${_kept}${_line}
" ;;
          esac
        done <<POLL_EOF
$ready
POLL_EOF
        ready=$(printf '%s' "$_kept")
      fi
      [ -n "$ready" ] && { printf '%s\n' "$ready"; exit 0; }
      ;;
    3|5|7) printf '%s\n' "$out" >&2; exit "$rc" ;;
    6|126|127)
      # 6 = 네트워크. 126/127 = dflow.sh 실행 불가·순간 부재(심링크 대상 재생성 찰나 등,
      # 2026-08-25 실증) — 한 번 못 찾았다고 하루치 감시를 버리지 않는다. 같은 연속 한도로 재시도.
      net_fail=$((net_fail+1))
      [ "$net_fail" -ge "$NET_FAIL_MAX" ] && { echo "일시 오류(rc=$rc) ${NET_FAIL_MAX}회 연속 — 중단" >&2; printf '%s\n' "$out" >&2; exit 6; }
      ;;
    *) printf '%s\n' "$out" >&2; exit "$rc" ;;
  esac
  sleep "$INTERVAL"
done
