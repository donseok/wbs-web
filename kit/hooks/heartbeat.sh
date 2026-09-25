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

# 파일 mtime(초). GNU(Linux·Git Bash) 를 먼저 묻는다 — GNU stat 의 -f 는 "파일 시스템" 이라 %m 을 파일 이름으로 받고,
# 실제 파일의 파일 시스템 정보를 stdout 에 찍은 채 실패한다(뒤 대안의 값에 쓰레기가 붙는다). BSD 는 -c 를 거부하고 stdout 이 비어 있다.
mtime_of() {
  _v=$(stat -c %Y "$1" 2>/dev/null || stat -f %m "$1" 2>/dev/null || :)
  case "$_v" in ''|*[!0-9]*) echo 0 ;; *) echo "$_v" ;; esac
}

# 1) 훅 입력: cwd(없으면 $PWD)·session_id·transcript_path 를 jq 한 번으로 줄마다 뽑는다. stdin 은 반드시 배수한다.
_in=$(cat 2>/dev/null || :)
_hv=$(printf '%s' "$_in" | "$JQ" -r '(.cwd // ""), (.session_id // ""), (.transcript_path // "")' 2>/dev/null || :)
_cwd=''; _sid=''; _tp=''
{ IFS= read -r _cwd; IFS= read -r _sid; IFS= read -r _tp; } <<EOF || :
$_hv
EOF
[ -n "$_cwd" ] && [ -d "$_cwd" ] || _cwd="$PWD"
case "$_sid" in ''|*[!A-Za-z0-9-]*) _sid='' ;; esac
# 최상위와 브랜치를 git 한 번으로 받는다. 커밋이 없는 리포(HEAD 미탄생)는 브랜치를 빈 값으로 둔다.
_rp=$("$GIT" -C "$_cwd" rev-parse --show-toplevel --abbrev-ref HEAD 2>/dev/null) \
  || _rp=$("$GIT" -C "$_cwd" rev-parse --show-toplevel 2>/dev/null) || exit 0
_top=''; _branch=''
{ IFS= read -r _top; IFS= read -r _branch; } <<EOF || :
$_rp
EOF
[ -n "$_top" ] || exit 0

# 2) AGENT_ID: .dflow-agent 첫 줄. parked 면 침묵. 없으면 agent/ 브랜치일 때만 claude-<host>.
if [ -f "$_top/.dflow-agent" ]; then
  _agent=$(head -n 1 "$_top/.dflow-agent" 2>/dev/null | tr -d '\r')
  [ -n "$_agent" ] || exit 0
  case "$_agent" in */parked) exit 0 ;; esac
else
  case "$_branch" in agent/*) ;; *) exit 0 ;; esac
  _agent="claude-$(hostname 2>/dev/null | cut -d. -f1 | tr '[:upper:]' '[:lower:]' | sed 's/[^a-z0-9-]/-/g')"   # hostname -s 는 Windows 에 없다
fi

# 2-b) 세션 절제(스캔 전): 이 세션이 지난번에 고른 주문을 포인터 ~/.dflow/hb/sess.<session_id>(주문·최상위·브랜치 세 줄)에
#      적어 두고, 최상위·브랜치가 같고 그 주문의 절제 파일(4번과 같은 파일·같은 시계)이 60초 안이면 스캔 없이 끝낸다.
#      4번 절제와 결과가 같다 — 스캔이 같은 주문을 골랐다면 4번에서 어차피 끝났다. 다른 점은 둘뿐이다:
#      · 주문이 바뀐 경우: /dflow-dev 는 주문마다 agent/ 브랜치로 옮기므로 브랜치가 달라져 포인터가 무효가 된다(곧바로 보냄).
#        같은 브랜치·같은 세션에서 60초 안에 다른 주문이 진행 중이 되면 그 첫 전송만 최대 60초 늦는다.
#      · phase·model 변경: 4번도 주문 절제 파일이 살아 있는 동안은 보내지 않았으므로 달라지지 않는다.
#      중단 표식(3-b)은 매 호출 봐야 한다(2026-09-19 중단 설계 §3). 그래서 ~/.dflow/hb 에 *.cancelled 가 하나라도 있으면 이
#      단계를 건너뛰고 종전 경로(스캔 → 3-b)로 간다 — 표식이 없으면 3-b 는 어차피 세우지 않으므로 의미가 같다.
#      session_id 가 없으면 이 단계는 없다(종전 그대로).
_hbdir="${HOME:-/tmp}/.dflow/hb"
_ptr=''; _po=''; _pt=''; _pb=''
if [ -n "$_sid" ]; then
  _ptr="$_hbdir/sess.$_sid"
  if [ -f "$_ptr" ]; then
    { IFS= read -r _po; IFS= read -r _pt; IFS= read -r _pb; } < "$_ptr" 2>/dev/null || :
    case "$_po" in
      ????????-????-????-????-????????????)
        if [ "$_pt" = "$_top" ] && [ "$_pb" = "$_branch" ] && [ -f "$_hbdir/$_po" ] \
          && [ $(( $(date +%s) - $(mtime_of "$_hbdir/$_po") )) -lt 60 ] \
          && [ -z "$(find "$_hbdir" -maxdepth 1 -name '*.cancelled' 2>/dev/null)" ]; then
          exit 0
        fi ;;
    esac
  fi
fi

# 3) 대상 작업: 진행 중 phase 의 state.json 중 최신. 브랜치 이름에서 TSK 를 뽑지 않는다.
#    prepare 는 /dflow-dev Phase 01(claim 뒤 기준선까지)이다 — 그 동안에도 도구 호출 사이마다 신호가 나간다(2026-09-24).
#    PostToolUse 라 도구 호출이 끝나야 도는 점은 같다: 5분 넘는 단일 호출(기준선 testAll 등) 중에는 여전히 무응답으로 보인다.
#    ready 는 넣지 않는다: dflow.sh scaffold 가 claim 전의 모든 배정 작업에 order 를 박아 만드는 자리표라, 받으면
#    더 최근에 손댄 남의 ready 파일이 진행 중 작업을 가리고 claim 하지 않은 주문으로 신호가 간다.
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
    prepare|design|build|verify|refactor|rejected) [ -n "$_mark" ] || _mark="$_f"; _state="$_f"; break ;;
    cancelled) [ -n "$_mark" ] || _mark="$_f" ;;
  esac
done

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
# 여러 줄 남고 output_tokens 는 뒤 줄이 크다). 깨진 줄은 fromjson? 이 건너뛴다. 모델명은 서버 규칙(heartbeat 라우트의
# TOKEN_MODEL_RE)과 같은 식으로 거른다 — <synthetic> 등이 빠진다. LLM 은 부르지 않는다.
# 증분: 대화 기록이 수십 MB 라 매번 처음부터 읽지 않는다. 두 파일을 둔다.
#   <캐시>.idx — 첫 줄 "v2<TAB>since", 이어 파일마다 "읽은 바이트<TAB>지문 길이<TAB>앞머리 지문(cksum)<TAB>경로".
#                읽은 바이트는 마지막 줄바꿈까지다 — 쓰는 중인 끝 줄(줄바꿈 없음)은 다음에 처음부터 다시 읽는다.
#   <캐시>.map — message.id → {m, u}(usage 네 칸). 합계가 아니라 id 별 마지막 값을 들고 있으므로, 경계에 걸친
#                id 의 뒤 줄이 다음 회차에 와도 덮어쓸 뿐이고 모델별 합·상위 20개는 매번 이 표에서 새로 만든다.
# 파일이 줄었거나, 앞머리 지문이 다르거나(교체·compact), 전에 읽은 파일이 사라졌거나, since 가 바뀌었거나,
# 캐시가 없거나 깨졌으면 처음부터 다시 읽는다. 같은 줄을 다시 읽어도 결과가 같으므로(마지막 값 덮어쓰기)
# .map 을 먼저 옮기고 .idx 를 나중에 옮긴다 — 사이에서 죽으면 다음 회차가 같은 줄을 다시 읽을 뿐이다.
# 키(id)는 reduce 앞에서 만든다 — .[<식>] = … 안에서 계산하면 jq 가 누적 객체를 매번 복사해 줄 수의 제곱으로 느려진다.
# 바이트 셈은 LC_ALL=C awk 의 length 로 한다. 경로는 awk -v 로 넘기지 않는다(Windows 경로의 \ 를 이스케이프로 읽는다).
tokens_compute() {
  _ix="$4.idx"; _mp="$4.map"; _w="$4.w$$"
  _sd="${1%.jsonl}/subagents"
  _fl=$( { printf '%s\n' "$1"; [ -d "$_sd" ] && find "$_sd" -maxdepth 1 -type f -name '*.jsonl' | LC_ALL=C sort; } 2>/dev/null )
  _hdr="v2	$3"
  # 캐시 검증 — 하나라도 어긋나면 처음부터.
  _ok=0
  if [ -f "$_ix" ] && "$JQ" -e 'type == "object"' "$_mp" >/dev/null 2>&1; then
    _ok=1; _n=0
    while IFS='	' read -r _a _b _c _f; do
      _n=$((_n + 1))
      if [ "$_n" = 1 ]; then [ "$_a	$_b" = "$_hdr" ] || { _ok=0; break; }; continue; fi
      case "$_a$_b" in ''|*[!0-9]*) _ok=0; break ;; esac
      case "
$_fl
" in *"
$_f
"*) ;; *) _ok=0; break ;; esac
      _sz=$(wc -c < "$_f" 2>/dev/null | tr -d ' \r')
      case "$_sz" in ''|*[!0-9]*) _ok=0; break ;; esac
      [ "$_sz" -ge "$_a" ] || { _ok=0; break; }
      if [ "$_b" -gt 0 ]; then [ "$(head -c "$_b" "$_f" 2>/dev/null | cksum)" = "$_c" ] || { _ok=0; break; }; fi
    done < "$_ix"
    [ "$_n" -ge 1 ] || _ok=0
  fi
  if [ "$_ok" = 1 ]; then _pm="$_mp"; else _pm="$_w.empty"; printf '{}\n' > "$_pm"; fi
  printf '%s\n' "$_hdr" > "$_w.idx"
  # 파일마다 읽은 자리부터 끝까지 흘려 "usage" 줄만 jq 로 넘기고, 새 자리는 .idx 초안에 적는다.
  # 끝에 #EOF 줄을 붙인다: 마지막 줄이 정확히 #EOF 면 앞이 줄바꿈으로 끝났고, 아니면 그 앞부분이 쓰는 중인 줄이다.
  # awk 는 마지막 줄(#EOF 가 붙은 줄)을 세지도 넘기지도 않는다.
  printf '%s\n' "$_fl" | while IFS= read -r _f; do
    [ -f "$_f" ] || continue
    _off=0
    if [ "$_ok" = 1 ]; then
      while IFS='	' read -r _a _b _c _g; do [ "$_g" = "$_f" ] && { _off=$_a; break; }; done < "$_ix"
    fi
    rm -f "$_w.cnt" 2>/dev/null
    { tail -c +$((_off + 1)) "$_f" 2>/dev/null; printf '#EOF\n'; } \
      | CF="$_w.cnt" LC_ALL=C awk 'NR > 1 { n += length(p) + 1; if (index(p, "\"usage\"")) print p } { p = $0 } END { print n + 0 > ENVIRON["CF"] }'
    _add=$(cat "$_w.cnt" 2>/dev/null); case "$_add" in ''|*[!0-9]*) _add=0 ;; esac
    _off=$((_off + _add)); _k=$_off; [ "$_k" -le 256 ] || _k=256; _fp='-'
    [ "$_k" -gt 0 ] && _fp=$(head -c "$_k" "$_f" 2>/dev/null | cksum)
    printf '%s\t%s\t%s\t%s\n' "$_off" "$_k" "$_fp" "$_f" >> "$_w.idx"
  done | "$JQ" -c -n -R --arg since "$3" --slurpfile p "$_pm" '
      reduce (inputs | fromjson? | select(type == "object" and .type == "assistant" and ((.message.usage // null) | type) == "object")
              | select($since == "" or ((.timestamp // "") >= $since))
              | select((.message.model // "") | test("^[A-Za-z0-9][A-Za-z0-9._:/@-]{0,63}$"))
              | [((.message.id // .uuid // "") | tostring),
                 {m: .message.model, u: (.message.usage | {input_tokens, output_tokens, cache_creation_input_tokens, cache_read_input_tokens})}]) as [$k, $v]
        ($p[0]; .[$k] = $v)' > "$_w.map" 2>/dev/null \
    && mv -f "$_w.map" "$_mp" 2>/dev/null && mv -f "$_w.idx" "$_ix" 2>/dev/null \
    && "$JQ" -c --arg sid "$2" '
      [.[]] | group_by(.m)
      | map({model: .[0].m,
             input: (map(.u.input_tokens // 0) | add), output: (map(.u.output_tokens // 0) | add),
             cache_creation: (map(.u.cache_creation_input_tokens // 0) | add), cache_read: (map(.u.cache_read_input_tokens // 0) | add)})
      | {session: $sid, models: .[:20]}' "$_mp" > "$4.tmp.$$" 2>/dev/null && mv -f "$4.tmp.$$" "$4" 2>/dev/null
  rm -f "$4.tmp.$$" "$_w.empty" "$_w.idx" "$_w.map" "$_w.cnt" 2>/dev/null
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

# 4) 절제: ~/.dflow/hb/<order> mtime 이 60초 안이면 종료. 그 전에 세션 포인터(2-b)를 이번에 고른 주문으로 맞춘다 —
#    다른 세션이 방금 보낸 주문이어도 다음 호출부터 스캔 없이 끝낼 수 있게. 내용이 같으면 쓰지 않는다.
mkdir -p "$_hbdir" 2>/dev/null || exit 0
_stamp="$_hbdir/$_order"
if [ -n "$_ptr" ] && { [ "$_po" != "$_order" ] || [ "$_pt" != "$_top" ] || [ "$_pb" != "$_branch" ]; }; then
  printf '%s\n%s\n%s\n' "$_order" "$_top" "$_branch" > "$_ptr" 2>/dev/null || :
fi
if [ -f "$_stamp" ]; then
  [ $(( $(date +%s) - $(mtime_of "$_stamp") )) -ge 60 ] || exit 0
fi
: > "$_stamp"

# 4-b) 사용 토큰(0104): 훅 입력의 transcript_path 는 서브에이전트 안의 도구 호출에서도 부모 세션 파일이다(실측
#      2026-09-24, agent_id 만 더 붙는다). 계산은 백그라운드로 돌려 캐시에 쓰고, 이번 전송에는 직전 캐시를 싣는다 —
#      대화 기록이 수십 MB 라 훅 제한 시간(5초) 안에서 동기로 읽지 않는다. 절제(60초) 뒤라 계산도 60초에 한 번이다.
#      자식은 세 표준 스트림을 모두 끊는다. 물려받은 stdout 이 훅 파이프를 붙잡으면 Claude Code 가 제한 시간을 다 기다린다.
#      transcript_path·session_id 는 1번에서 뽑았다.
_tkj=''
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
    [ $(( $(date +%s) - $(mtime_of "$_lock") )) -lt 600 ] || rmdir "$_lock" 2>/dev/null || :
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
