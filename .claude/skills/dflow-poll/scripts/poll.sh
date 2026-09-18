#!/bin/sh
# poll.sh — D'Flow ready 작업 감시 루프 (dflow-poll 스킬 전용).
# ready 발견 시 stdout 에 "순번<TAB>id8<TAB>이름" 을 줄 단위로 내고 종료한다.
# 승인 감지 시 stdout 에 "TSK<TAB>order-id" 를 줄 단위로 내고 exit 9 — 세션이 머지 스윕을 돌린다.
# 반려 감지 시 stdout 에 "TSK<TAB>order-id<TAB>review_note" 를 내고 exit 10 — 세션이 재작업에 들어간다.
# exit: 0 ready 발견 / 2 사용법·설정 / 3 인증 / 5 권한 / 7 기능꺼짐 (dflow.sh 코드 전파)
#       8 종료시각 / 9 승인 감지 / 10 반려 감지
#       / 6 네트워크·일시 오류 연속 한도 초과 / 8 종료 시각 도달 / 9 승인 감지(머지 대상)
# 토큰은 env 확장으로만 다룬다 — echo·파일 기록·명령 문자열 보간 금지.
# DFLOW_WATCH=0 이면 좌석표 watch 신호를 보내지 않는다(팀장 /dflow-team 아래 실행용).
set -u

INTERVAL=300
UNTIL_RAW="18:00" # --until 원문. 세 형식을 받는다:
                  #   HH:MM              오늘 그 시각(이미 지났으면 곧바로 exit 8 — 지금과 같다)
                  #   YYYY-MM-DD HH:MM   그 날짜의 그 시각(여러 날 무인 실행용)
                  #   none               종료 시각 없음. 호출자가 멈출 때까지 돈다(팀장의 "종료 요청 전까지")
UNTIL_LABEL=""    # watch 신호에 실을 종료시각 표시 문자열(서버가 16자까지 저장)
EXCLUDE=""        # 쉼표 구분 id8 — 영구성 제외(사용자 결정 대기 등). 사람이 풀기 전까지 유지.
EXCLUDE_TEMP=""   # 쉼표 구분 id8 — 일시성 제외(spec 부재·선행 대기). RECHECK_CYCLES 뒤 자동 해제
                  # → 재발견(exit 0)으로 세션이 착수 판정을 다시 하게 만든다(자율 재검사).
RECHECK_CYCLES=6  # 일시성 제외를 유지할 주기 수. 기본 6주기(interval 300s면 30분).
REQUIRE_TAG=""    # 지정 시 item.tags 에 이 태그가 있는 작업만 감지(에이전트 위임 플래그).
                  # list 응답에는 tags 가 없어 후보별 show 1회씩 조회한다.
WP=""             # 쉼표 구분 WP 목록(WP-02 또는 모듈/WP-02). 지정 시 그 WP 의 Task 만 감지.
                  # WP 는 external_ref 의 TSK 번호 첫 칸(TSK-02-05 → WP-02)으로 가린다. WBS ID 규칙상
                  # Task ID 의 첫 칸이 WP 번호다. list 응답에는 external_ref 가 없어 show 를 쓴다.
NET_FAIL_MAX=3

usage() { echo "사용법: poll.sh [--interval 초] [--until HH:MM|\"YYYY-MM-DD HH:MM\"|none] [--exclude id8,id8] [--exclude-temp id8,id8] [--recheck-cycles N] [--require-tag 태그] [--wp WP-02,모듈/WP-03]" >&2; exit 2; }

while [ $# -gt 0 ]; do
  case "$1" in
    --interval)       INTERVAL="${2:-}"; shift 2 || usage ;;
    --until)          UNTIL_RAW="${2:-}"; shift 2 || usage ;;
    --exclude)        EXCLUDE="${2:-}"; shift 2 || usage ;;
    --exclude-temp)   EXCLUDE_TEMP="${2:-}"; shift 2 || usage ;;
    --recheck-cycles) RECHECK_CYCLES="${2:-}"; shift 2 || usage ;;
    --require-tag)    REQUIRE_TAG="${2:-}"; shift 2 || usage ;;
    --wp)             WP="${2:-}"; shift 2 || usage ;;
    *) usage ;;
  esac
done
case "$INTERVAL"       in ''|*[!0-9]*) usage ;; esac
# 종료 시각을 에포크 초로 바꾼다. HHMM 숫자 비교는 자정을 넘기면 판정이 뒤집혀 여러 날 실행을 받지 못했다.
to_epoch() { # $1 = "YYYY-MM-DD HH:MM" → 에포크 초 (BSD date 먼저, 없으면 GNU date)
  date -j -f '%Y-%m-%d %H:%M:%S' "$1:00" +%s 2>/dev/null || date -d "$1" +%s 2>/dev/null
}
case "$UNTIL_RAW" in
  none)
    UNTIL_EPOCH=''; UNTIL_LABEL='종료요청까지' ;;
  [0-2][0-9]:[0-5][0-9])
    UNTIL_EPOCH=$(to_epoch "$(date +%Y-%m-%d) $UNTIL_RAW") || usage
    UNTIL_LABEL="$UNTIL_RAW" ;;
  [0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]' '[0-2][0-9]:[0-5][0-9])
    UNTIL_EPOCH=$(to_epoch "$UNTIL_RAW") || usage
    UNTIL_LABEL=$(printf '%s' "$UNTIL_RAW" | cut -c6-) ;;   # MM-DD HH:MM
  *) usage ;;
esac
[ -z "$UNTIL_RAW" ] || [ "$UNTIL_RAW" = none ] || [ -n "$UNTIL_EPOCH" ] || usage
case "$RECHECK_CYCLES" in ''|*[!0-9]*) usage ;; esac
# --wp 형식 검사와 정규화: 항목마다 WP-<숫자> 또는 <모듈>/WP-<숫자>. 오타가 조용히 "감지 0건" 이 되지 않게
# 막는다. 번호는 앞의 0 을 떼어 적는다(WP-2 와 WP-02 를 같게 보고, TSK-02-05 의 02 도 같은 방식으로 뗀다).
if [ -n "$WP" ]; then
  _norm=''
  for _w in $(printf '%s' "$WP" | tr ',' ' '); do
    printf '%s\n' "$_w" | grep -Eq '^([^/[:space:]]+/)?WP-[0-9]+$' || { echo "--wp 형식 오류: $_w (예: WP-02, dict/WP-02)" >&2; exit 2; }
    _n=$(printf '%s' "${_w##*-}" | sed 's/^0*//'); _n=${_n:-0}
    _norm="${_norm},${_w%-*}-${_n}"
  done
  WP=${_norm#,}
fi

# 기본 좌표는 자기 위치 기준 — 이 스킬 묶음(.claude/skills/)을 어느 리포에 심어도 닫힌다.
SKILLS_DIR=$(cd "$(dirname "$0")/../.." && pwd)
ENV_FILE="${DFLOW_ENV_FILE:-$PWD/.env}"
DFLOW="${DFLOW_SH:-$SKILLS_DIR/dflow-work/scripts/dflow.sh}"
STATE_GLOB="$PWD/docs/tasks"   # dflow-dev state.json 위치 — 승인 감지 재료
[ -f "$ENV_FILE" ] || { echo "env 파일 없음: $ENV_FILE" >&2; exit 2; }
[ -x "$DFLOW" ]   || { echo "dflow.sh 없음: $DFLOW" >&2; exit 2; }
set -a; . "$ENV_FILE"; set +a
# 리포 ↔ D'Flow 프로젝트 바인딩이 없으면 감시하지 않는다. /work/mine 은 PAT 주인이 속한 모든 프로젝트의 주문을
# 돌려주므로, 바인딩 없이 돌면 다른 프로젝트의 ready 를 찾아 이 리포에서 착수하게 된다. 거르는 것은 dflow.sh list 다.
[ -n "${DFLOW_PROJECT_ID:-}${DFLOW_PROJECT_MAP:-}" ] \
  || { echo "프로젝트 바인딩 없음: $ENV_FILE 에 DFLOW_PROJECT_ID 또는 DFLOW_PROJECT_MAP 을 넣으세요" >&2; exit 2; }

net_fail=0
cycle=0
while :; do
  if [ -n "$UNTIL_EPOCH" ] && [ "$(date +%s)" -ge "$UNTIL_EPOCH" ]; then
    [ "${DFLOW_WATCH:-1}" = "0" ] || "$DFLOW" watch --stop >/dev/null 2>&1 || :
    echo "종료 시각 도달(--until $UNTIL_RAW)" >&2; exit 8
  fi
  # 좌석표 STANDBY 신호 — 매 주기 1회. 팀장 아래에서는 팀장이 lead 로 보내므로 DFLOW_WATCH=0 으로 끈다.
  [ "${DFLOW_WATCH:-1}" = "0" ] || "$DFLOW" watch --until "$UNTIL_LABEL" >/dev/null 2>&1 || :

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
      # WP 필터: --wp 지정 시 그 WP 의 Task 만 남긴다. 두 필터는 같은 show 1회로 판정한다.
      # show 가 실패하면 그 후보는 이번 주기에서 빠지고 다음 주기에 다시 판정된다(기존 태그 필터와 같다).
      if [ -n "$ready" ] && { [ -n "$REQUIRE_TAG" ] || [ -n "$WP" ]; }; then
        _kept=''
        while IFS= read -r _line; do
          [ -n "$_line" ] || continue
          _id=$(printf '%s' "$_line" | cut -f2)
          _item=$("$DFLOW" show "$_id" 2>/dev/null | jq -r '.order.item | [((.tags // []) | join(",")), (.external_ref // "")] | @tsv') || _item=''
          [ -n "$_item" ] || continue
          _tags=$(printf '%s' "$_item" | cut -f1)
          _ref=$(printf '%s' "$_item" | cut -f2)
          if [ -n "$REQUIRE_TAG" ]; then
            case ",$_tags," in *",$REQUIRE_TAG,"*) ;; *) continue ;; esac
          fi
          if [ -n "$WP" ]; then
            _wpn=$(printf '%s' "${_ref##*/}" | sed -n 's/^TSK-\([0-9][0-9]*\)-.*/\1/p')
            [ -n "$_wpn" ] || continue
            _wpn=$(printf '%s' "$_wpn" | sed 's/^0*//'); _wpn=${_wpn:-0}
            case "$_ref" in */*) _mod=${_ref%/*} ;; *) _mod='' ;; esac
            case ",$WP," in
              *",WP-$_wpn,"*) ;;
              *",$_mod/WP-$_wpn,"*) [ -n "$_mod" ] || continue ;;
              *) continue ;;
            esac
          fi
          _kept="${_kept}${_line}
"
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
