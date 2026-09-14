#!/bin/sh
# heartbeat.sh — Claude Code PostToolUse 훅. 진행 중인 D'Flow 작업의 "살아 있음"을 서버에 남긴다.
# 설치: ~/.dflow/hooks/heartbeat.sh (kit/install.sh --hooks). 등록: ~/.claude/settings.json hooks.PostToolUse.
# 규칙(좌석표 v1 스펙 §4-2): 조건이 하나라도 안 맞으면 조용히 exit 0. 출력 없음. 실패 무시. 60초에 1회.
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
  _agent="claude-$(hostname -s 2>/dev/null | tr '[:upper:]' '[:lower:]' | sed 's/[^a-z0-9-]/-/g')"
fi

# 3) 대상 작업: 진행 중 phase 의 state.json 중 최신. 브랜치 이름에서 TSK 를 뽑지 않는다.
_state=''
for _f in $(ls -t "$_top"/docs/tasks/*/state.json 2>/dev/null); do
  _ph=$("$JQ" -r '.phase // empty' "$_f" 2>/dev/null || :)
  case "$_ph" in design|build|verify|refactor|rejected) _state="$_f"; break ;; esac
done
[ -n "$_state" ] || exit 0
_order=$("$JQ" -r '.order // empty' "$_state" 2>/dev/null || :)
_phase=$("$JQ" -r '.phase // empty' "$_state" 2>/dev/null || :)
case "$_order" in ????????-????-????-????-????????????) ;; *) exit 0 ;; esac

# 4) 절제: ~/.dflow/hb/<order> mtime 이 60초 안이면 종료.
_hbdir="${HOME:-/tmp}/.dflow/hb"; mkdir -p "$_hbdir" 2>/dev/null || exit 0
_stamp="$_hbdir/$_order"
if [ -f "$_stamp" ]; then
  _now=$(date +%s); _mt=$(stat -f %m "$_stamp" 2>/dev/null || stat -c %Y "$_stamp" 2>/dev/null || echo 0)
  [ $((_now - _mt)) -ge 60 ] || exit 0
fi
: > "$_stamp"

# 5) 인증: 루트 .env (팀원 워크트리에는 심링크가 있다). 토큰은 env 로만 다룬다 — 출력·기록 금지.
[ -f "$_top/.env" ] || exit 0
set -a; . "$_top/.env" 2>/dev/null; set +a
_base="${DFLOW_API_BASE:-}"; [ -n "$_base" ] || exit 0
_tok="${DFLOW_PATS:-}"; _tok="${_tok%%,*}"; [ -n "$_tok" ] || _tok="${DFLOW_PAT:-}"; [ -n "$_tok" ] || exit 0

# 6) fire-and-forget. 응답·실패는 보지 않는다.
_json=$("$JQ" -nc --arg a "$_agent" --arg p "$_phase" '{agent:$a, phase:$p}')
"$CURL" -s -o /dev/null --max-time 1.5 -X POST \
  -H "Authorization: Bearer $_tok" -H 'Content-Type: application/json' \
  --data "$_json" "${_base%/}/api/v1/agent/work/$_order/heartbeat" >/dev/null 2>&1 &
exit 0
