#!/bin/sh
# /dflow-dev Phase 01 5번의 Build 모델 시험 판정 — 배정표가 opus 로 정한 Build 중 일부를 sonnet 으로 돌릴지 정한다.
# 규칙의 정본은 dflow-dev/references/dev-discipline.md 「Build 모델 시험(build_model_trial)」 이고, 이 스크립트는 그 실행체다.
# 이유·수치는 rationale.md 「advisor 호출 정책·Build 모델 시험·opus 승급(2026-09-26)」.
#
# 사용: build-trial.sh <external_ref> <build_model_base>   cwd = 리포(워크트리) 루트
#   <external_ref> 는 show 의 item.external_ref(모듈 접두 `dict/TSK-02-05` 도 된다). 비율 판정은 마지막 칸(state.json `tsk`)으로 한다.
#   <build_model_base> 는 배정표가 정한 Build 모델(opus|sonnet 또는 전체 id).
# 설정(.dflow.local, 개인 — dflow-work/scripts/dflow-config.sh): 이미 export 된 env 가 이긴다.
#   build_model_trial=sonnet          (DFLOW_BUILD_MODEL_TRIAL — 비면 꺼짐. sonnet 밖의 값은 꺼짐으로 본다: haiku Build 금지)
#   build_model_trial_rate=<0~100>    (DFLOW_BUILD_MODEL_TRIAL_RATE — 비율%. 목록이 비었을 때만 쓴다)
#   build_model_trial_tasks=<목록>    (DFLOW_BUILD_MODEL_TRIAL_TASKS — 쉼표. TSK-02-05·TSK-02(접두)·WP-02·dict/WP-02. 있으면 비율보다 우선)
# 출력 한 줄(늘 exit 0, 인자가 틀리면 exit 2):
#   BUILD_TRIAL on  model=sonnet reason=<list|rate> bucket=<n>
#   BUILD_TRIAL off reason=<disabled|unsupported|base|not-listed|rate|bad-rate> bucket=<n|->
# bucket 은 `printf %s <TSK> | cksum` 의 첫 값 mod 100 이다 — 같은 TSK 는 어느 PC·재개에서도 같은 값이다.
# 판정은 Phase 01 에서 한 번만 하고 state.json 에 적는다. 재개는 state.json 값을 쓰고 이 스크립트를 다시 부르지 않는다
# (설정을 바꿔도 진행 중인 Task 의 모델이 중간에 바뀌지 않게).
set -u

[ $# -eq 2 ] && [ -n "$1" ] && [ -n "$2" ] || { echo "사용: build-trial.sh <external_ref> <build_model_base>" >&2; exit 2; }
ref=$1; base=$2
tsk=${ref##*/}
case "$ref" in */*) mod=${ref%/*} ;; *) mod='' ;; esac

# 설정을 읽는다. 실패해도(설정 파일 없음 등) 이미 export 된 env 로 판정한다.
_here=$(cd "$(dirname "$0")" && pwd)
_lib="$_here/../../dflow-work/scripts/dflow-config.sh"
if [ -f "$_lib" ]; then . "$_lib"; dflow_config_load >/dev/null 2>&1 || :; fi

trial=$(printf '%s' "${DFLOW_BUILD_MODEL_TRIAL:-}" | tr -d ' \r')
rate=$(printf '%s' "${DFLOW_BUILD_MODEL_TRIAL_RATE:-}" | tr -d ' \r')
list=$(printf '%s' "${DFLOW_BUILD_MODEL_TRIAL_TASKS:-}" | tr -d ' \r')

bucket=$(( $(printf '%s' "$tsk" | cksum | cut -d' ' -f1) % 100 ))

[ -n "$trial" ] || { echo "BUILD_TRIAL off reason=disabled bucket=$bucket"; exit 0; }
[ "$trial" = sonnet ] || { echo "BUILD_TRIAL off reason=unsupported bucket=$bucket"; exit 0; }
case "$base" in *opus*) ;; *) echo "BUILD_TRIAL off reason=base bucket=$bucket"; exit 0 ;; esac

# 목록 판정 — poll.sh --wp 와 같은 WP 규칙(번호 앞 0 무시, 모듈 접두는 모듈까지 같아야 한다). TSK 항목은 같거나 접두(`TSK-02` → TSK-02-*).
_n0() { _v=$(printf '%s' "$1" | sed 's/^0*//'); printf '%s' "${_v:-0}"; }
if [ -n "$list" ]; then
  wpn=$(printf '%s' "$tsk" | sed -n 's/^TSK-\([0-9][0-9]*\)-.*/\1/p'); [ -z "$wpn" ] || wpn=$(_n0 "$wpn")
  for e in $(printf '%s' "$list" | tr ',' ' '); do
    case "$e" in */*) emod=${e%/*}; eid=${e##*/} ;; *) emod=''; eid=$e ;; esac
    [ -z "$emod" ] || [ "$emod" = "$mod" ] || continue
    case "$eid" in
      WP-*) en=$(printf '%s' "${eid#WP-}" | grep -E '^[0-9]+$') || continue
            [ -n "$wpn" ] && [ "$(_n0 "$en")" = "$wpn" ] && { echo "BUILD_TRIAL on model=sonnet reason=list bucket=$bucket"; exit 0; } ;;
      *)    case "$tsk" in "$eid"|"$eid"-*) echo "BUILD_TRIAL on model=sonnet reason=list bucket=$bucket"; exit 0 ;; esac ;;
    esac
  done
  echo "BUILD_TRIAL off reason=not-listed bucket=$bucket"; exit 0
fi

# 비율 판정 — 0~100 정수만. 그 밖(빈 값 포함)은 꺼짐.
printf '%s' "$rate" | grep -Eq '^[0-9]+$' && [ "$rate" -le 100 ] || { echo "BUILD_TRIAL off reason=bad-rate bucket=$bucket"; exit 0; }
if [ "$bucket" -lt "$rate" ]; then echo "BUILD_TRIAL on model=sonnet reason=rate bucket=$bucket"
else echo "BUILD_TRIAL off reason=rate bucket=$bucket"; fi
exit 0
