#!/bin/sh
# heartbeat.sh — Claude Code PostToolUse 훅. 진행 중인 D'Flow 작업의 "살아 있음"을 서버에 남긴다.
# 설치: ~/.dflow/hooks/heartbeat.sh (kit/install.sh --hooks). 등록: ~/.claude/settings.json hooks.PostToolUse.
# 규칙(좌석표 v1 스펙 §4-2): 조건이 하나라도 안 맞으면 조용히 exit 0. 출력 없음. 실패 무시. 60초에 1회.
# 예외 하나(2026-09-19 중단 설계 §3): 사람이 D'Flow 에서 작업을 중단하면(서버 409 code=cancelled) 표식 파일
# ~/.dflow/hb/<order>.cancelled 를 남기고 {"continue":false,"stopReason":…} 를 출력해 세션을 세운다. 표식이 있는 동안은
# 절제와 무관하게 매 호출 다시 세운다 — 서브에이전트 안의 continue:false 가 부모 세션까지 멈춘다는 보장이 없어서다.
# 그 밖의 결과(네트워크 실패·다른 409·5xx)는 지금처럼 무시한다(fail-open). 확실한 중단 신호일 때만 세운다.
# dflow.sh 를 거치지 않는 이유: api_raw 는 타임아웃이 없고 비-2xx 마다 exit 하며 임시파일을 쓴다.
set -u
GIT=$(command -v git 2>/dev/null) || exit 0
CURL="${CURL:-$(command -v curl 2>/dev/null)}"; [ -n "$CURL" ] || exit 0
JQ=$(command -v jq 2>/dev/null) || exit 0

# 1) cwd: 훅 입력 JSON 의 cwd, 없으면 $PWD. stdin 은 반드시 배수한다.
_in=$(cat 2>/dev/null || :)
_cwd=$(printf '%s' "$_in" | "$JQ" -r '.cwd // empty' 2>/dev/null || :)
[ -n "$_cwd" ] && [ -d "$_cwd" ] || _cwd="$PWD"
_top=$("$GIT" -C "$_cwd" rev-parse --show-toplevel 2>/dev/null) || exit 0

# 2) AGENT_ID: .dflow-agent 첫 줄. parked 면 침묵. 없으면 agent/ 브랜치일 때만 claude-<host>.
if [ -f "$_top/.dflow-agent" ]; then
  _agent=$(head -n 1 "$_top/.dflow-agent" 2>/dev/null | tr -d '\r')
  [ -n "$_agent" ] || exit 0
  case "$_agent" in */parked) exit 0 ;; esac
else
  _branch=$("$GIT" -C "$_top" rev-parse --abbrev-ref HEAD 2>/dev/null) || exit 0
  case "$_branch" in agent/*) ;; *) exit 0 ;; esac
  _agent="claude-$(hostname 2>/dev/null | cut -d. -f1 | tr '[:upper:]' '[:lower:]' | sed 's/[^a-z0-9-]/-/g')"   # hostname -s 는 Windows 에 없다
fi

# 3) 대상 작업: 진행 중 phase 의 state.json 중 최신. 브랜치 이름에서 TSK 를 뽑지 않는다.
#    중단 표식 검사(_mark)는 cancelled 도 포함한 최신 state.json 으로 한다 — 이미 cancelled 로 바꾼 작업도
#    표식이 남아 있으면 부모 세션이 다음 도구를 부르는 즉시 다시 세워야 하기 때문이다.
#    작업 폴더는 docs/tasks/<TSK> 와 project_map 리포의 <DOCS_DIR>/tasks/<TSK>(docs/<x>/tasks/<TSK>) 둘 다 본다.
#    설정(project_map)을 읽지 않고 모양으로 찾는다 — 인증보다 먼저 도는 단계이고, 절제 전에는 싸야 한다.
#    glob 대신 find 로 목록을 만든다: zsh 로 돌리면 매치 없는 glob 하나가 명령 전체를 죽인다(no matches found).
#    -L 로 심볼릭 링크를 따라간다(glob 과 같다) — docs/<x> 를 다른 프로젝트로 링크해 두는 체크아웃이 있다.
#    먼저 tasks 폴더(깊이 1~2 의 디렉터리)만 찾고 그 안을 훑는다 — 매 도구 호출마다 도는 곳이라 docs 전체를 stat 하지 않는다.
_state=''; _mark=''
_list=$(find -L "$_top/docs" -mindepth 1 -maxdepth 2 -type d -name tasks 2>/dev/null | while IFS= read -r _td; do
  find -L "$_td" -mindepth 2 -maxdepth 2 -name state.json 2>/dev/null; done)
for _f in $([ -n "$_list" ] && printf '%s\n' "$_list" | xargs ls -t 2>/dev/null); do
  _ph=$("$JQ" -r '.phase // empty' "$_f" 2>/dev/null || :)
  case "$_ph" in
    design|build|verify|refactor|rejected) [ -n "$_mark" ] || _mark="$_f"; _state="$_f"; break ;;
    cancelled) [ -n "$_mark" ] || _mark="$_f" ;;
  esac
done
_hbdir="${HOME:-/tmp}/.dflow/hb"

# 중단: state.json 을 phase=cancelled 로 바꾸고(이미면 그대로) 세우는 JSON 을 쓴 뒤 끝낸다. $1=state.json $2=order
stop_now() {
  _sp=$("$JQ" -r '.phase // empty' "$1" 2>/dev/null || :)
  if [ "$_sp" != cancelled ]; then
    _tmp="$1.tmp.$$"
    if "$JQ" '.phase = "cancelled"' "$1" > "$_tmp" 2>/dev/null; then mv -f "$_tmp" "$1" 2>/dev/null || rm -f "$_tmp"; else rm -f "$_tmp"; fi
  fi
  _id8=$(printf '%s' "$2" | cut -c1-8)
  "$JQ" -nc --arg r "D'Flow 에서 이 작업이 중단되었습니다($_id8). 더 진행하지 말고 멈추세요." '{continue:false, stopReason:$r}'
  exit 0
}

# 사용 토큰(0104) 계산 — 백그라운드 전용. $1=transcript $2=session $3=since(빈 값이면 전부) $4=캐시 파일.
# 부모 세션 기록과 <세션>/subagents/*.jsonl 을 합쳐 message.id 마다 마지막 줄만 센다(같은 id 가 스트리밍으로
# 여러 줄 남고 output_tokens 는 뒤 줄이 크다). cat 대신 awk 1 로 이어 붙인다 — 쓰는 중인 파일의 끝 줄에 줄바꿈이
# 없으면 다음 파일 첫 줄과 붙어 둘 다 깨진다. 깨진 줄은 fromjson? 이 건너뛴다. 모델명이 영숫자로 시작하지 않는
# 줄(<synthetic> 등)은 뺀다. LLM 은 부르지 않는다.
tokens_compute() {
  _sd="${1%.jsonl}/subagents"
  { awk 1 "$1"; [ -d "$_sd" ] && find "$_sd" -maxdepth 1 -type f -name '*.jsonl' -exec awk 1 {} +; } 2>/dev/null \
  | grep '"usage"' \
  | "$JQ" -c -n -R --arg sid "$2" --arg since "$3" '
      reduce (inputs | fromjson? | select(type == "object" and .type == "assistant" and ((.message.usage // null) | type) == "object")
              | select($since == "" or ((.timestamp // "") >= $since))
              | select((.message.model // "") | test("^[A-Za-z0-9]"))) as $l
        ({}; .[($l.message.id // $l.uuid // "") | tostring] = {m: $l.message.model, u: $l.message.usage})
      | [.[]] | group_by(.m)
      | map({model: .[0].m,
             input: (map(.u.input_tokens // 0) | add), output: (map(.u.output_tokens // 0) | add),
             cache_creation: (map(.u.cache_creation_input_tokens // 0) | add), cache_read: (map(.u.cache_read_input_tokens // 0) | add)})
      | {session: $sid, models: .[:20]}' > "$4.tmp.$$" 2>/dev/null && mv -f "$4.tmp.$$" "$4" 2>/dev/null
  rm -f "$4.tmp.$$" 2>/dev/null
  return 0
}

# 3-b) 중단 표식: 절제 판정 전에 본다. 표식은 order UUID 로 찾는다.
if [ -n "$_mark" ]; then
  _mo=$("$JQ" -r '.order // empty' "$_mark" 2>/dev/null || :)
  case "$_mo" in
    ????????-????-????-????-????????????) [ -f "$_hbdir/$_mo.cancelled" ] && stop_now "$_mark" "$_mo" ;;
  esac
fi
[ -n "$_state" ] || exit 0
_order=$("$JQ" -r '.order // empty' "$_state" 2>/dev/null || :)
_phase=$("$JQ" -r '.phase // empty' "$_state" 2>/dev/null || :)
# 실행 모델(0100) — dflow-dev 가 Phase 서브에이전트를 띄울 때 state.json 에 적는다. 없으면 싣지 않는다.
_model=$("$JQ" -r '.model // empty' "$_state" 2>/dev/null | tr -d '\r' || :)
case "$_order" in ????????-????-????-????-????????????) ;; *) exit 0 ;; esac

# 4) 절제: ~/.dflow/hb/<order> mtime 이 60초 안이면 종료.
mkdir -p "$_hbdir" 2>/dev/null || exit 0
_stamp="$_hbdir/$_order"
if [ -f "$_stamp" ]; then
  _now=$(date +%s); _mt=$(stat -f %m "$_stamp" 2>/dev/null || stat -c %Y "$_stamp" 2>/dev/null || echo 0)
  [ $((_now - _mt)) -ge 60 ] || exit 0
fi
: > "$_stamp"

# 4-b) 사용 토큰(0104): 훅 입력의 transcript_path 는 서브에이전트 안의 도구 호출에서도 부모 세션 파일이다(실측
#      2026-09-24, agent_id 만 더 붙는다). 계산은 백그라운드로 돌려 캐시에 쓰고, 이번 전송에는 직전 캐시를 싣는다 —
#      대화 기록이 수십 MB 라 훅 제한 시간(5초) 안에서 동기로 읽지 않는다. 절제(60초) 뒤라 계산도 60초에 한 번이다.
#      자식은 세 표준 스트림을 모두 끊는다. 물려받은 stdout 이 훅 파이프를 붙잡으면 Claude Code 가 제한 시간을 다 기다린다.
_tkj=''
_tp=$(printf '%s' "$_in" | "$JQ" -r '.transcript_path // empty' 2>/dev/null || :)
_sid=$(printf '%s' "$_in" | "$JQ" -r '.session_id // empty' 2>/dev/null || :)
case "$_sid" in ''|*[!A-Za-z0-9-]*) _sid='' ;; esac
if [ -n "$_sid" ] && [ -f "$_tp" ]; then
  _tc="$_hbdir/$_order.tok.$_sid"
  _tkj=$("$JQ" -c 'select(type == "object" and (.models | type) == "array")' "$_tc" 2>/dev/null || :)
  # 수동 /dflow-dev 세션은 여러 주문을 거칠 수 있어 이 주문을 처음 본 뒤의 줄만 센다. 팀원 워크트리(.dflow-agent)는
  # 주문 하나 전용 세션이라 처음부터 센다.
  _since=''
  if [ ! -f "$_top/.dflow-agent" ]; then
    [ -f "$_tc.since" ] || date -u +%Y-%m-%dT%H:%M:%SZ > "$_tc.since" 2>/dev/null || :
    _since=$(cat "$_tc.since" 2>/dev/null || :)
  fi
  _lock="$_tc.lock"
  # 잠금이 10분 넘게 남아 있으면 죽은 계산의 흔적이다.
  if [ -d "$_lock" ]; then
    _lm=$(stat -f %m "$_lock" 2>/dev/null || stat -c %Y "$_lock" 2>/dev/null || echo 0)
    [ $(( $(date +%s) - _lm )) -lt 600 ] || rmdir "$_lock" 2>/dev/null || :
  fi
  if mkdir "$_lock" 2>/dev/null; then
    ( tokens_compute "$_tp" "$_sid" "$_since" "$_tc"; rmdir "$_lock" 2>/dev/null ) </dev/null >/dev/null 2>&1 &
  fi
fi

# 5) 인증: 새 방식은 리포의 dflow-config.sh 로 .dflow·.dflow.local 을 읽는다(팀원 워크트리에는 링크가 있다).
#    라이브러리가 없는 리포는 종전대로 루트 .env. 설정이 깨졌으면 조용히 끝낸다. 토큰은 env 로만 다룬다.
_lib="$_top/.claude/skills/dflow-work/scripts/dflow-config.sh"
if [ -f "$_lib" ]; then
  . "$_lib"; DFLOW_CONFIG_DIR="$_top"; export DFLOW_CONFIG_DIR
  dflow_config_load 2>/dev/null || exit 0
else
  [ -f "$_top/.env" ] || exit 0
  set -a; . "$_top/.env" 2>/dev/null; set +a
fi
_base="${DFLOW_API_BASE:-}"; [ -n "$_base" ] || exit 0
_all="${DFLOW_PATS:-}"; [ -n "$_all" ] || _all="${DFLOW_PAT:-}"; [ -n "$_all" ] || exit 0
_base=$(printf '%s' "$_base" | tr -d '\r'); _all=$(printf '%s' "$_all" | tr -d '\r')
_as=$(printf '%s' "${DFLOW_AS:-}" | tr -d '\r')
# 키 선택: DFLOW_AS(prefix = 토큰의 셋째 '_' 칸)가 있으면 그 토큰만 쓴다. dflow.sh 의 pick_token 과 같은 규칙이다.
# 맞는 토큰이 없으면 보내지 않는다 — 첫 토큰으로 물러서면 다른 신원의 좌석에 heartbeat 가 찍힌다(fail-closed).
if [ -n "$_as" ]; then
  _tok=''; _rest="$_all,"
  while [ -n "$_rest" ]; do
    _c="${_rest%%,*}"; _rest="${_rest#*,}"
    [ "$(printf '%s' "$_c" | cut -d_ -f3)" = "$_as" ] && { _tok="$_c"; break; }
  done
  [ -n "$_tok" ] || exit 0
else
  _tok="${_all%%,*}"
fi

# 6) 동기 전송(--max-time 1.5, 훅 timeout 5초 안). 응답은 중단 신호만 본다 — 409 이고 바디 code 가 cancelled 일 때만.
#    본문과 코드를 한 번에 받는다(-w 로 끝 줄에 코드). 임시파일을 쓰지 않는다. 그 밖의 결과·실패는 무시(fail-open).
_json=$("$JQ" -nc --arg a "$_agent" --arg p "$_phase" --arg m "$_model" --argjson t "${_tkj:-null}" \
  '{agent:$a, phase:$p} + (if $m == "" then {} else {model:$m} end) + (if $t == null then {} else {tokens:$t} end)')
_out=$("$CURL" -s --max-time 1.5 -w '\n%{http_code}' -X POST \
  -H "Authorization: Bearer $_tok" -H 'Content-Type: application/json' \
  --data "$_json" "${_base%/}/api/v1/agent/work/$_order/heartbeat" 2>/dev/null) || exit 0
_code=$(printf '%s\n' "$_out" | tail -n 1 | tr -d '\r')
[ "$_code" = 409 ] || exit 0
_code=$(printf '%s\n' "$_out" | sed '$d' | "$JQ" -r '.code // empty' 2>/dev/null || :)
[ "$_code" = cancelled ] || exit 0
: > "$_hbdir/$_order.cancelled" 2>/dev/null || :
stop_now "$_state" "$_order"
