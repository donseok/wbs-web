#!/bin/sh
# dflow.sh — D'Flow Agent API 얇은 curl 래퍼. 계약 v2.x (references/api-contract.md).
# 정확한 기대 버전은 아래 CONTRACT_VERSION 하나뿐이다 — 주석과 비교문에 숫자를 따로 두면
# 둘이 따로 낡는다(2026-08-27 감사: 서버가 2.1 인데 비교문만 2.0 으로 남아 있었다).
# exit: 0 성공 / 2 사용법·설정 / 3 인증 / 4 상태충돌 / 5 권한 / 6 네트워크·서버·로컬 환경 / 7 기능꺼짐 / 10 중단됨(409 code=cancelled)
# 토큰은 env 확장으로만 전달한다 — echo·파일 기록·명령 문자열 보간 금지.
set -u

# 이 스킬이 기대하는 계약 버전. doctor 는 major 만 본다 — 서버가 minor 를 올리는 것은
# additive 라 정상이고, 등호로 보면 상향 때마다 전 세션이 오경보를 본다.
CONTRACT_VERSION=2.4

CACHE_DIR="${XDG_CACHE_HOME:-$HOME/.cache}/dflow"
LIST_CACHE="$CACHE_DIR/last-list.json"
PROFILE_CACHE="$CACHE_DIR/profiles.json"
# id8 → 전체 UUID 영속 맵. 목록 캐시는 매 list 로 덮여서 approved 처럼 목록에서 빠진 주문의
# 접두 해석이 죽는다(2026-08-25 실증 — 감지하려는 바로 그 상태에서 show 실패). 한 번이라도
# 목록에 떴던 id 를 여기 누적해 접두 해석의 폴백으로 쓴다. UUID 목록뿐이라 비밀 아님.
IDMAP_CACHE="$CACHE_DIR/known-ids.txt"

usage() {
  cat >&2 <<'EOF'
사용법: dflow.sh [--as <prefix|email>] <cmd> [args]
  키 선택: --as → .dflow.local 의 as(레거시 .env 의 DFLOW_AS, prefix 만) → 첫 토큰. 한 계정에 키가 둘이면 email 로는 갈리지 않는다
  me                     현재 프로필 신원·접근 프로젝트
  list [--all] [--scope available|claimed|assigned|all] [--any-project]
                         기본은 이 리포에 바인딩된 프로젝트(.dflow 의 project_id·.dflow.local 의 project_map)의 주문만.
                         --any-project 는 필터를 끈다(진단용)
  show <ref>             ref = 목록 순번 | UUID 앞 8자 | 전체 UUID
  taskdir <ref>          주문의 작업 폴더(<DOCS_DIR>/tasks/<TSK>, 리포 최상위 기준)
  claim <ref>            주문의 프로젝트가 이 리포 바인딩 밖이면 거부(exit 2, PROJECT_MISMATCH)
  progress <ref> <pct 0-99> <요약>
  heartbeat <ref> [--phase p] [--note "<질문>"] [--agent id] [--model m]
                         진행 중 신호(보고 행 없음). --agent 기본값은 워크트리 루트 .dflow-agent 첫 줄
  watch [--agent id] [--slots n] [--busy n] [--until HH:MM] [--project id] [--json] [--stop]
                         감시자 존재 신호(좌석표 STANDBY). 기본 agent 는 <신원>/<host>/poll
  done <ref> <요약> [--auto-links]
  release <ref>
  scaffold               내게 배정된 작업(바인딩 안)의 <DOCS_DIR>/tasks/<TSK>/state.json(phase=ready)을 만들고
                         개발 브랜치에 있으면 커밋·push. 있는 폴더는 건드리지 않는다
  profiles               토큰마다 한 줄 JSON(n·prefix·name·email·expires_at·projects·bound·selected). 토큰 값은 내지 않는다
  doctor                 설정·의존성·계약 버전 점검
  config <key>|projects|--source|docs-dir <uuid>|tasks-dirs
                         설정 값·바인딩·판정 출처·작업 폴더 역매핑(비밀 키는 거부)
  branch dev|release               개발 브랜치(.dflow.local dev_branch)·운영 브랜치(.dflow release_branch)
exit: 0 성공 / 2 사용법·설정 / 3 인증 / 4 상태충돌 / 5 권한 / 6 네트워크·서버·로컬 환경 / 7 기능꺼짐 / 10 중단됨
      10 = 사람이 D'Flow 에서 작업을 중단했다(409 code=cancelled). 더 진행하지 말고 멈춘다
EOF
  exit 2
}

die() { printf '%s\n' "$2" >&2; exit "$1"; }

need() { command -v "$1" >/dev/null 2>&1 || die 2 "필요한 명령이 없습니다: $1"; }

# ---- 설정·프로필 ----------------------------------------------------------
base() {
  [ -n "${DFLOW_API_BASE:-}" ] || die 2 "DFLOW_API_BASE 미설정 — .dflow(레거시는 .env)를 확인하세요."
  printf '%s' "${DFLOW_API_BASE%/}"
}
# 설정 로드: .dflow(프로젝트 공통)·.dflow.local(개인) → 없으면 레거시 .env. 규칙은 dflow-config.sh 머리말.
. "$(dirname "$0")/dflow-config.sh"
dflow_config_load || exit 2
# Windows 편집기가 남긴 CR 제거 — 값 끝의 \r 은 URL·Authorization 헤더를 깨뜨린다. 값은 변수로만 다룬다.
_cr=$(printf '\r')
for _v in DFLOW_API_BASE DFLOW_PATS DFLOW_PAT DFLOW_PROJECT_ID DFLOW_PROJECT_MAP DFLOW_AS DFLOW_DEV_BRANCH DFLOW_RELEASE_BRANCH DFLOW_AUTOMERGE; do
  eval "_x=\${$_v:-}"
  case "$_x" in *"$_cr"*) eval "$_v=\$(printf '%s' \"\$_x\" | tr -d '\\r')" ;; esac
done
unset _x _cr
# 리포 ↔ D'Flow 프로젝트 바인딩: DFLOW_PROJECT_ID 와 DFLOW_PROJECT_MAP(docs/x=<uuid>,…) 값의 합집합.
# /work/mine 은 PAT 주인이 속한 모든 프로젝트의 주문을 돌려주므로, 거르지 않으면 한 리포의 세션이 다른
# 프로젝트의 작업을 잡아 엉뚱한 리포에서 개발한다(2026-09-18 발견: 바인딩 없는 리포가 옛 프로젝트 작업을 봄).
# 여기서는 BAD_DOCS_DIR 경고를 내지 않는다 — 모든 호출(branch·config 등)마다 같은 줄이 쌓인다. 경고는 그 값을
# 쓰는 경로(claim·taskdir 의 docs_dir, config projects|tasks-dirs|docs-dir, doctor)에서 낸다.
ALLOWED_PROJECTS=$(DFLOW_CONFIG_QUIET=1; dflow_config_projects)
# 목록 캐시는 바인딩과 고른 키(DFLOW_AS)마다 나눈다. 한 파일을 모든 리포가 쓰면 순번·접두 해석이 다른 리포가
# 마지막으로 본 목록으로 풀리고, 같은 리포의 두 팀장(워크트리마다 다른 키)도 서로의 목록을 덮어쓴다.
LIST_CACHE="$CACHE_DIR/last-list-$(printf '%s|%s' "${ALLOWED_PROJECTS:-any}" "${DFLOW_AS:-}" | cksum | cut -d' ' -f1).json"
# DFLOW_PATS(쉼표 구분) 우선, 없으면 DFLOW_PAT 단일. 토큰 문자열은 변수로만 다룬다.
tokens() {
  [ -n "${DFLOW_PATS:-}" ] || [ -n "${DFLOW_PAT:-}" ] || die 2 "DFLOW_PATS 또는 DFLOW_PAT 미설정"
  if [ -n "${DFLOW_PATS:-}" ]; then printf '%s' "$DFLOW_PATS" | tr ',' '\n'
  else printf '%s\n' "$DFLOW_PAT"; fi
}
# 토큰의 prefix — dflow_pat_<prefix>_<secret> 의 셋째 '_' 칸(서버 PAT_RE). 비밀이 아니라 조회 키다.
token_prefix() { printf '%s' "$1" | cut -d_ -f3; }
# 프로필 캐시: [{prefix, email}] — 평문 토큰은 캐시하지 않는다(재조회 키는 prefix).
profile_email() { # $1=token → 캐시에서 email, 없으면 /me 조회 후 캐시
  _pfx=$(token_prefix "$1")
  if [ -f "$PROFILE_CACHE" ]; then
    _hit=$(jq -r --arg p "$_pfx" '.[] | select(.prefix==$p) | .email' "$PROFILE_CACHE" 2>/dev/null | head -1)
    [ -n "$_hit" ] && { printf '%s' "$_hit"; return 0; }
  fi
  _body=$(TOKEN="$1" api_raw GET /api/v1/agent/me) || return 1
  _email=$(printf '%s' "$_body" | jq -r '.user_email')
  mkdir -p "$CACHE_DIR"; chmod 700 "$CACHE_DIR"
  { [ -f "$PROFILE_CACHE" ] && cat "$PROFILE_CACHE" || printf '[]'; } \
    | jq --arg p "$_pfx" --arg e "$_email" '. + [{prefix:$p, email:$e}] | unique_by(.prefix)' \
    > "$PROFILE_CACHE.tmp" && mv "$PROFILE_CACHE.tmp" "$PROFILE_CACHE"
  chmod 600 "$PROFILE_CACHE"
  printf '%s' "$_email"
}
# 키 선택: --as → DFLOW_AS → 첫 토큰. ① prefix 완전 일치(네트워크 없음) ② --as 에 한해 이메일 부분 일치.
# DFLOW_AS 는 prefix 만 받는다 — heartbeat 훅이 /me 없이 같은 키를 골라야 하기 때문이다. 맞는 키가 없을 때
# 첫 토큰으로 물러서지 않는다. 다른 신원으로 조용히 도는 것이 이 선택이 막으려는 오동작이다.
pick_token() { # $1=선택 값('' 허용) $2=1 이면 prefix 일치만(DFLOW_AS)
  _want="$1"; _found=''
  for _t in $(tokens); do
    [ -z "$_want" ] && { printf '%s' "$_t"; return 0; }
    [ "$(token_prefix "$_t")" = "$_want" ] && { printf '%s' "$_t"; return 0; }
  done
  [ -z "${2:-}" ] || die 2 "DFLOW_AS=$_want 에 맞는 토큰이 없습니다 — prefix 만 받습니다(dflow.sh profiles 로 확인)."
  for _t in $(tokens); do
    _e=$(profile_email "$_t") || continue
    case "$_e" in *"$_want"*) _found="$_t"; break;; esac
  done
  [ -n "$_found" ] || die 2 "프로필을 찾지 못했습니다: $_want"
  printf '%s' "$_found"
}

# ---- HTTP ----------------------------------------------------------------
api_raw() { # $1=METHOD $2=PATH [$3=JSON body] — TOKEN env 필요. 성공 시 body 출력.
  mkdir -p "$CACHE_DIR"
  _body_tmp="$CACHE_DIR/dflow_body.$$"
  _base=$(base) || exit $?
  _code=$(curl -sS -o "$_body_tmp" -w '%{http_code}' -X "$1" \
    -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
    ${3:+--data "$3"} "$_base$2" 2>/dev/null) || { rm -f "$_body_tmp"; die 6 "네트워크 오류"; }
  _body=$(cat "$_body_tmp"; rm -f "$_body_tmp")
  case "$_code" in
    2??) printf '%s' "$_body"; return 0 ;;
    401) printf '%s\n' "$_body" >&2; exit 3 ;;
    403)
      printf '%s\n' "$_body" >&2
      # 선행 미충족은 권한 문제가 아니라 상태 문제다 — 서버가 403 으로 내려보내지만
      # 호출부가 할 일은 "권한을 얻어라"가 아니라 "선행을 끝내고 다시 와라"이다.
      if [ "$(printf '%s' "$_body" | jq -r '.code // empty' 2>/dev/null)" = "dependency_not_met" ]; then
        exit 4
      fi
      exit 5 ;;
    404) printf '%s\n' "$_body" >&2; exit 7 ;;
    409)
      printf '%s\n' "$_body" >&2
      # 사람이 중단한 주문(2026-09-19)은 경합·상태 불일치와 처방이 다르다 — 재시도가 아니라 즉시 멈춤이다.
      if [ "$(printf '%s' "$_body" | jq -r '.code // empty' 2>/dev/null)" = "cancelled" ]; then
        exit 10
      fi
      exit 4 ;;
    4??) printf '%s\n' "$_body" >&2; exit 2 ;;
    *)   printf '%s\n' "$_body" >&2; exit 6 ;;
  esac
}

# ---- ref 해석: 순번 → 캐시, 8자 접두/전체 UUID → 그대로 --------------------
resolve_ref() {
  case "$1" in
    [0-9]|[0-9][0-9])
      [ -f "$LIST_CACHE" ] || die 2 "목록 캐시가 없습니다 — 먼저 list 를 실행하세요."
      # 캐시 TTL 30분
      _now=$(date +%s); _mt=$(stat -f %m "$LIST_CACHE" 2>/dev/null || stat -c %Y "$LIST_CACHE")
      [ $((_now - _mt)) -le 1800 ] || die 2 "목록 캐시가 오래됐습니다 — list 를 다시 실행하세요."
      _id=$(jq -r --argjson n "$1" '.[$n-1].id // empty' "$LIST_CACHE")
      [ -n "$_id" ] || die 2 "순번 $1 이 목록에 없습니다."
      printf '%s' "$_id" ;;
    ????????-*) printf '%s' "$1" ;;
    ????????)
      # 현재 목록 캐시 → 영속 idmap 순 폴백. approved 등 목록에서 빠진 주문도
      # 과거에 한 번이라도 목록에 떴으면 idmap 으로 해석된다.
      _id=''
      [ -f "$LIST_CACHE" ] && _id=$(jq -r --arg p "$1" '.[] | select(.id | startswith($p)) | .id' "$LIST_CACHE" | head -1)
      [ -z "$_id" ] && [ -f "$IDMAP_CACHE" ] && _id=$(grep "^$1" "$IDMAP_CACHE" | head -1)
      [ -n "$_id" ] || die 2 "접두 $1 해석 실패 — 목록·과거 이력(idmap)에 없습니다. 전체 UUID 로 다시 부르거나 list 를 먼저 실행하세요."
      printf '%s' "$_id" ;;
    *) die 2 "ref 형식: 순번 | UUID 8자 | 전체 UUID" ;;
  esac
}

# ---- 출력: compact 1행/건 (순번 상태 우선순위 id8 이름40) -------------------
print_list() { # stdin = 주문 배열 JSON
  jq -r 'to_entries[] | [
    (.key+1),
    ({ready:"RD",claimed:"CL",reported:"RP",approved:"AP",cancelled:"CX"}[.value.status] // "??"),
    .value.priority,
    (.value.id[0:8]),
    ((.value.item.name // .value.instructions // "-") | .[0:40])
  ] | @tsv'
}

# idmap 누적 — $1 = 주문 배열 JSON 파일. 실패해도 본 기능엔 영향 없음(폴백 캐시일 뿐).
remember_ids() {
  [ -f "$1" ] || return 0
  { jq -r '.[].id // empty' "$1" 2>/dev/null; cat "$IDMAP_CACHE" 2>/dev/null; } \
    | sort -u > "$IDMAP_CACHE.tmp" 2>/dev/null && mv "$IDMAP_CACHE.tmp" "$IDMAP_CACHE" || rm -f "$IDMAP_CACHE.tmp"
}

# ---- 커맨드 ---------------------------------------------------------------
cmd_me() {
  _body=$(TOKEN="$TOK" api_raw GET /api/v1/agent/me) || exit $?
  printf '%s' "$_body" | jq .
}

# 주문 배열(stdin)을 허용 프로젝트로 거른다. $1 이 비어 있지 않으면 거르지 않는다(--any-project).
filter_projects() {
  if [ -n "${1:-}" ] || [ -z "$ALLOWED_PROJECTS" ]; then jq '.'; return; fi
  jq --arg ps "$ALLOWED_PROJECTS" '($ps | split("\n")) as $ok | [.[] | select(.project_id as $p | $ok | index($p))]'
}

cmd_list() {
  _scope='available'; _all=''; _anyp=''
  while [ $# -gt 0 ]; do case "$1" in
    --all) _all=1 ;;
    --scope) _scope="$2"; shift ;;
    --any-project) _anyp=1 ;;
    *) die 2 "알 수 없는 옵션: $1" ;;
  esac; shift; done
  mkdir -p "$CACHE_DIR"
  # 바인딩이 없으면 거를 기준이 없다. 전 프로젝트를 보여 주되 그 사실을 알린다(목록은 사람이 보는 진단이다).
  # 자동 착수 경로(poll.sh·팀장)는 바인딩이 없으면 시작하지 않는다.
  [ -n "$ALLOWED_PROJECTS" ] || [ -n "$_anyp" ] \
    || printf '⚠ 프로젝트 바인딩 없음(DFLOW_PROJECT_ID·DFLOW_PROJECT_MAP) — 모든 프로젝트의 주문을 표시합니다.\n' >&2
  if [ -n "$_all" ]; then
    for _t in $(tokens); do
      printf '== %s ==\n' "$(profile_email "$_t" || printf '?')"
      _body=$(TOKEN="$_t" api_raw GET "/api/v1/agent/work/mine?scope=$_scope") || exit $?
      printf '%s' "$_body" | jq '[.claimed[]?, .assigned[]?, .available[]?]' | filter_projects "$_anyp" | tee "$LIST_CACHE.tmp" | print_list
      remember_ids "$LIST_CACHE.tmp"
    done
  else
    _body=$(TOKEN="$TOK" api_raw GET "/api/v1/agent/work/mine?scope=$_scope") || exit $?
    printf '%s' "$_body" | jq '[.claimed[]?, .assigned[]?, .available[]?]' | filter_projects "$_anyp" > "$LIST_CACHE.tmp" \
      || die 6 "목록 해석 실패"
    print_list < "$LIST_CACHE.tmp"
  fi
  mv "$LIST_CACHE.tmp" "$LIST_CACHE" 2>/dev/null || true
  remember_ids "$LIST_CACHE"
}

cmd_show() {
  _id=$(resolve_ref "$1")
  _body=$(TOKEN="$TOK" api_raw GET "/api/v1/agent/work/$_id") || exit $?
  printf '%s' "$_body" | jq .
}

# 선행 로컬 도달 검사(결정 C-②) — depends_evidence 의 head_sha 가 현재 리포에 없거나
# HEAD 조상이 아니면 하드 차단(exit 4). 경고+확인이 아니다.
check_depends_local() { # $1=depends_evidence JSON 배열
  # 파싱 실패는 이쪽 환경·응답이 깨진 것이지 선행이 안 끝난 게 아니다 — 상태충돌(4)로 내면
  # 호출부가 "선행을 기다린다"로 읽고 영원히 재시도한다.
  _jq_out=$(printf '%s' "$1" | jq -c '.[] | select(.head_sha != null)' 2>&1) || die 6 "의존성 정보 파싱 실패"
  [ -n "$_jq_out" ] || return 0  # 의존성 없으면 통과
  printf '%s' "$_jq_out" | while IFS= read -r _d; do
    _sha=$(printf '%s' "$_d" | jq -r '.head_sha' 2>/dev/null)
    _ref=$(printf '%s' "$_d" | jq -r '.external_ref' 2>/dev/null)
    git cat-file -e "$_sha^{commit}" 2>/dev/null \
      || die 4 "선행 $_ref 의 커밋($_sha)이 로컬에 없습니다 — git fetch/pull 후 다시 시도하세요."
    git merge-base --is-ancestor "$_sha" HEAD 2>/dev/null \
      || die 4 "선행 $_ref 의 커밋($_sha)이 현재 브랜치에 반영되지 않았습니다 — merge/rebase 후 다시 시도하세요."
  done || exit $?   # while 는 서브셸 — die 의 exit 코드를 그대로 부모로 전파(4 로 뭉개지 않는다)
}

# spec.md 로컬 캐시(결정 A) — DB 정본의 명세를 claim 시점에 스냅샷. 위치는 <DOCS_DIR>/tasks/<TSK>(리포 최상위 기준).
# external_ref 의 마지막 칸 = TSK(작업 폴더 이름). $1=item 을 담은 JSON(show·claim 응답). 없으면 빈 값.
# '.'·'..'·경로 문자는 <DOCS_DIR>/tasks 밖을 가리키므로 거부한다(exit 6). $(...) 안에서 부르므로
# die 는 서브셸만 끝낸다 — 호출부는 반드시 `|| exit $?` 로 받는다.
_tsk_from_ref() {
  _tsk=$(printf '%s' "$1" | jq -r '.item.external_ref // empty' 2>/dev/null | awk -F/ '{print $NF}')
  case "$_tsk" in .|..|*[!A-Za-z0-9._-]*) die 6 "BAD_REF external_ref 의 마지막 칸($_tsk)은 작업 폴더 이름으로 쓸 수 없다 — [A-Za-z0-9._-] 만, '.'·'..' 금지" ;; esac
  printf '%s' "$_tsk"
}

write_spec_cache() { # $1=claim 응답 JSON. ORDER_DOCS_DIR 는 check_project 가 채운다.
  _tsk=$(_tsk_from_ref "$1") || exit $?
  [ -n "$_tsk" ] || return 0
  _top=$(git rev-parse --show-toplevel 2>/dev/null) || _top=.
  _rel="${ORDER_DOCS_DIR:-docs}/tasks/$_tsk"
  mkdir -p "$_top/$_rel"
  _spec_tmp="$_top/$_rel/spec.md.tmp"
  printf '%s' "$1" | jq -r '
    "# " + (.item.external_ref // "") + " " + (.item.name // "") + "\n" +
    "> stage: " + (.item.stage // "-") + " · category: " + (.item.category // "-") +
    " · domain: " + (.item.domain // "-") + " · priority: " + (.item.priority // "-") +
    " · model: " + (.item.model // "-") + "\n" +
    "> prd-ref: " + (.item.prd_ref // "-") + "\n> entry-point: " + (.item.entry_point // "-") + "\n" +
    "> depends: " + ((.item.depends // []) | join(", ")) + "\n\n" +
    (.item.spec // "(명세 없음)") + "\n\n## 수용 기준\n" +
    ((.item.acceptance // []) | map("- [ ] " + .) | join("\n"))
  ' > "$_spec_tmp" || { rm -f "$_spec_tmp"; die 6 "spec 파일 쓰기 실패"; }
  # 디스크·권한 문제다. 상태충돌(4)이 아니다 — 주문 상태는 멀쩡하고 고칠 곳이 로컬이다.
  mv "$_spec_tmp" "$_top/$_rel/spec.md" || die 6 "spec 파일 원자 이동 실패"
  printf 'spec 캐시: %s/spec.md\n' "$_rel"
}

# 주문의 프로젝트가 이 리포 바인딩 안인지 확인한다. show 응답에는 project_id 가 없어 /work/mine 목록에서 찾는다.
check_project() { # $1=전체 UUID
  [ -n "$ALLOWED_PROJECTS" ] || die 2 "PROJECT_MISMATCH 프로젝트 바인딩 없음 — .env 에 DFLOW_PROJECT_ID 또는 DFLOW_PROJECT_MAP 을 넣으세요. 어느 프로젝트의 작업인지 가릴 수 없어 claim 하지 않습니다."
  _body=$(TOKEN="$TOK" api_raw GET "/api/v1/agent/work/mine?scope=all") || exit $?
  _p=$(printf '%s' "$_body" | jq -r --arg id "$1" '[.claimed[]?, .assigned[]?, .available[]?] | map(select(.id == $id)) | .[0].project_id // empty') \
    || die 6 "목록 해석 실패"
  [ -n "$_p" ] || die 2 "PROJECT_MISMATCH 주문 $(printf '%s' "$1" | cut -c1-8) 의 프로젝트를 목록에서 찾지 못했습니다 — claim 하지 않습니다."
  printf '%s\n' "$ALLOWED_PROJECTS" | grep -qxF "$_p" \
    || die 2 "PROJECT_MISMATCH 주문 $(printf '%s' "$1" | cut -c1-8) 은 프로젝트 $(printf '%s' "$_p" | cut -c1-8) 소속입니다 — 이 리포의 바인딩 밖이라 claim 하지 않습니다."
  # 작업 폴더의 DOCS_DIR — claim 전에 정해 둔다. 해석 실패(AMBIGUOUS_DOCS_DIR)는 claim 하지 않는다.
  ORDER_DOCS_DIR=$(dflow_config_docs_dir "$_p") || exit 2
}

cmd_claim() {
  _id=$(resolve_ref "$1")
  check_project "$_id"
  # ① show 로 선행 evidence 를 먼저 받아 로컬 검사 — 통과 전에는 claim 자체를 하지 않는다(결정 C-②).
  _detail=$(TOKEN="$TOK" api_raw GET "/api/v1/agent/work/$_id") || exit $?
  check_depends_local "$(printf '%s' "$_detail" | jq -c '.depends_evidence // []')"
  # 작업 폴더 이름도 claim 전에 검사한다 — 잡은 뒤에 거부하면 주문만 claimed 로 남는다.
  _tsk_from_ref "$_detail" >/dev/null || exit $?
  # 라벨 결정론(§3) — 무작위·타임스탬프 금지. .dflow-agent 가 있으면 그 신원, 없으면 종전과 같은
  # claude-<host> — 어느 경로든 같은 자리는 늘 같은 문자열을 낸다. heartbeat(agent_id_default)와
  # 신원을 맞춰야 좌석표가 claimed_by 와 heartbeat_agent 를 같은 에이전트로 합친다
  # (src/lib/domain/seatmap.ts:180 — 서로 다르면 신원 없는 별도 좌석으로 갈라진다).
  _label=$(agent_id_default)
  _resp=$(TOKEN="$TOK" api_raw POST "/api/v1/agent/work/$_id/claim" \
    "$(jq -nc --arg a "$_label" '{agent:$a}')") || exit $?
  write_spec_cache "$_resp"
  printf 'claimed %s\n' "$(printf '%s' "$_id" | cut -c1-8)"
}

# 주문의 작업 폴더(리포 최상위 기준 상대경로). 스킬 문서의 <TASKS>/<TSK> 가 이 값이다.
cmd_taskdir() {
  _id=$(resolve_ref "$1")
  check_project "$_id"
  _detail=$(TOKEN="$TOK" api_raw GET "/api/v1/agent/work/$_id") || exit $?
  _tsk=$(_tsk_from_ref "$_detail") || exit $?
  [ -n "$_tsk" ] || die 6 "NO_REF 주문 $(printf '%s' "$_id" | cut -c1-8) 에 external_ref 가 없다 — WBS import 로 만든 항목이 아니다"
  printf '%s/tasks/%s\n' "$ORDER_DOCS_DIR" "$_tsk"
}

# 내게 배정된 작업의 폴더와 state.json(phase=ready)을 미리 만든다(스펙 2026-09-23-dflow-task-scaffold §4).
# 대상은 assigned ∩ 바인딩뿐 — 남의 작업 폴더를 만들면 사람 사이 커밋이 충돌한다. 있는 폴더는 건드리지 않는다.
cmd_scaffold() {
  [ -n "$ALLOWED_PROJECTS" ] || die 2 "PROJECT_MISMATCH 프로젝트 바인딩 없음 — .dflow 의 project_id 또는 .dflow.local 의 project_map 을 넣으세요."
  _top=$(git rev-parse --show-toplevel 2>/dev/null) || die 2 "NOT_REPO git 리포 안에서 실행하세요."
  _body=$(TOKEN="$TOK" api_raw GET "/api/v1/agent/work/mine?scope=assigned&limit=100") || exit $?
  _rows=$(printf '%s' "$_body" | jq -c '[.assigned[]?]' | filter_projects '') || die 6 "목록 해석 실패"
  _total=$(printf '%s' "$_body" | jq '[.assigned[]?] | length')
  [ "$_total" -lt 100 ] || printf '⚠ 목록이 100건에서 잘렸을 수 있습니다 — 남은 작업은 다음 scaffold 에서 만듭니다.\n' >&2
  _kept=$(printf '%s' "$_rows" | jq 'length')
  _api=$(base) || exit $?
  _list=$(printf '%s' "$_rows" | jq -r '.[] | [.id, .project_id, (((.item.external_ref // "") | split("/") | last) // "")] | @tsv') \
    || die 6 "목록 해석 실패"
  _created=0; _skipped=0; _noref=0; _new=''
  # here-doc 으로 받는다 — 파이프 while 은 서브셸이라 카운터가 부모에 남지 않는다.
  while IFS="$(printf '\t')" read -r _oid _pid _tsk; do
    [ -n "$_oid" ] || continue
    [ -n "$_tsk" ] || { _noref=$((_noref + 1)); continue; }
    _dd=$(dflow_config_docs_dir "$_pid" 2>/dev/null) || { _skipped=$((_skipped + 1)); continue; }
    _rel="$_dd/tasks/$_tsk"
    [ ! -e "$_top/$_rel" ] || { _skipped=$((_skipped + 1)); continue; }
    mkdir -p "$_top/$_rel" || die 6 "폴더 생성 실패: $_rel"
    jq -n --arg t "$_tsk" --arg o "$_oid" --arg a "$_api" '{tsk:$t, order:$o, api_base:$a, phase:"ready"}' \
      > "$_top/$_rel/state.json.tmp" && mv "$_top/$_rel/state.json.tmp" "$_top/$_rel/state.json" \
      || die 6 "state.json 쓰기 실패: $_rel"
    _created=$((_created + 1)); _new="$_new$_rel/state.json
"
  done <<EOF
$_list
EOF
  _note=''
  if [ "$_created" -gt 0 ]; then
    _dev=$(dflow_config_branch dev 2>/dev/null) || _dev=''
    if [ -z "$_dev" ] || [ "$(git -C "$_top" branch --show-current)" != "$_dev" ]; then
      _note=' (개발 브랜치가 아니라 커밋하지 않음)'
    else
      set --
      while IFS= read -r _f; do [ -n "$_f" ] && set -- "$@" "$_f"; done <<EOF
$_new
EOF
      # 경로를 명시한 commit(--only) — 사람이 stage 해 둔 다른 파일을 싣지 않는다.
      git -C "$_top" add -- "$@" && git -C "$_top" commit -q -m "chore(dflow): 담당 작업 폴더 ${_created}건 생성" -- "$@" \
        || die 6 "scaffold 커밋 실패"
      git -C "$_top" push -q origin "HEAD:$_dev" 2>/dev/null || _note=' (push 실패 — 로컬 커밋만 남김)'
    fi
  fi
  [ "$_noref" -eq 0 ] || [ "$_noref" -ne "$_kept" ] \
    || _note="$_note (서버에 external_ref 응답이 없습니다 — D'Flow 업데이트 필요)"
  printf 'scaffold created=%d skipped=%d no_ref=%d%s\n' "$_created" "$_skipped" "$_noref" "$_note"
}

cmd_progress() {
  _id=$(resolve_ref "$1"); _pct="$2"; _sum="$3"
  [ "$_pct" -ge 0 ] 2>/dev/null && [ "$_pct" -le 99 ] || die 2 "pct 는 0~99 — 완료는 done 을 쓰세요."
  # claim 과 같은 신원 산출(agent_id_default) — heartbeat_agent 와 어긋나면 보고 행의 귀속이
  # 갈라진다. 라벨 결정론(§3) 은 이 경로에서도 유지된다(같은 자리는 늘 같은 문자열).
  _body=$(TOKEN="$TOK" api_raw POST "/api/v1/agent/work/$_id/report" \
    "$(jq -nc --arg a "$(agent_id_default)" --argjson p "$_pct" --arg s "$_sum" \
       '{agent:$a, kind:"progress", percent:$p, summary:$s}')") || exit $?
  printf '%s' "$_body" | jq -r '.status'
}

# ---- 좌석표 신호(v1 스펙 §4-1) --------------------------------------------
# 슬러그: 소문자, [a-z0-9-] 밖은 '-' (팀장 스펙 §9-1 과 같은 규칙)
slug() { printf '%s' "$1" | tr '[:upper:]' '[:lower:]' | sed 's/[^a-z0-9-]/-/g'; }
host_short() { hostname 2>/dev/null | cut -d. -f1; }   # hostname -s 는 Windows(Git Bash)의 hostname.exe 에 없다
# 기본 AGENT_ID: 워크트리 루트 .dflow-agent 첫 줄 → 없으면 claude-<host>
agent_id_default() {
  _top=$(${DFLOW_GIT:-git} rev-parse --show-toplevel 2>/dev/null || printf '%s' "$PWD")
  if [ -f "$_top/.dflow-agent" ]; then head -n 1 "$_top/.dflow-agent" | tr -d '\r'; else printf 'claude-%s' "$(slug "$(host_short)")"; fi
}
# 기본 watcher id: <신원>/<host>/poll — 신원은 /me 의 user_email 로컬 파트
watcher_id_default() {
  _email=$(profile_email "$TOK") || die 3 "신원 확인 실패(/me)"
  printf '%s/%s/poll' "$(slug "${_email%%@*}")" "$(slug "$(host_short)")"
}

cmd_heartbeat() {
  _id=$(resolve_ref "$1"); shift
  _phase=''; _note=''; _agent=''; _model=''
  while [ $# -gt 0 ]; do
    case "$1" in
      --phase) _phase="${2:-}"; shift 2 || usage ;;
      --note)  _note="${2:-}";  shift 2 || usage ;;
      --agent) _agent="${2:-}"; shift 2 || usage ;;
      --model) _model="${2:-}"; shift 2 || usage ;;
      *) usage ;;
    esac
  done
  [ -n "$_agent" ] || _agent=$(agent_id_default)
  case "$_agent" in */parked) die 2 "parked 워크트리는 heartbeat 를 보내지 않습니다." ;; esac
  _json=$(jq -nc --arg a "$_agent" --arg p "$_phase" --arg n "$_note" --arg m "$_model" \
    '{agent:$a} + (if $p != "" then {phase:$p} else {} end) + (if $n != "" then {note:$n} else {} end)
     + (if $m != "" then {model:$m} else {} end)')
  _body=$(TOKEN="$TOK" api_raw POST "/api/v1/agent/work/$_id/heartbeat" "$_json") || exit $?
  printf '%s' "$_body" | jq -r '.last_heartbeat_at'
}

cmd_watch() {
  _agent=''; _slots=''; _busy=''; _until=''; _project="${DFLOW_PROJECT_ID:-}"; _stop=''; _raw=''
  while [ $# -gt 0 ]; do
    case "$1" in
      --agent)   _agent="${2:-}";   shift 2 || usage ;;
      --slots)   _slots="${2:-}";   shift 2 || usage ;;
      --busy)    _busy="${2:-}";    shift 2 || usage ;;
      --until)   _until="${2:-}";   shift 2 || usage ;;
      --project) _project="${2:-}"; shift 2 || usage ;;
      --json)    _raw=1; shift ;;
      --stop)    _stop=1; shift ;;
      *) usage ;;
    esac
  done
  if [ -z "$_agent" ]; then _agent=$(watcher_id_default) || exit $?; fi
  [ -n "$_agent" ] || die 3 "watcher 신원을 정하지 못했다(--agent 를 주거나 /me 확인)"
  _host=$(slug "$(host_short)")
  if [ -n "$_stop" ]; then
    _json=$(jq -nc --arg a "$_agent" '{agent:$a, stop:true}')
  else
    _json=$(jq -nc --arg a "$_agent" --arg h "$_host" --arg s "$_slots" --arg b "$_busy" --arg u "$_until" --arg p "$_project" \
      '{agent:$a, host:$h}
       + (if $s != "" then {slots:($s|tonumber)} else {} end)
       + (if $b != "" then {busy:($b|tonumber)} else {} end)
       + (if $u != "" then {until:$u} else {} end)
       + (if $p != "" then {project_id:$p} else {} end)')
  fi
  _body=$(TOKEN="$TOK" api_raw POST /api/v1/agent/watch "$_json") || exit $?
  # --json 은 응답 본문 그대로. 기본 출력(expires_at 한 줄)만 두면 응답에 실려 오는 resume_requests
  # (좌석표의 「이어서 시작」 요청)가 버려져 팀장에게 닿지 않는다.
  if [ -n "$_stop" ]; then printf 'stopped\n'
  elif [ -n "$_raw" ]; then printf '%s' "$_body"
  else printf '%s' "$_body" | jq -r '.expires_at'; fi
}

cmd_done() {
  _id=$(resolve_ref "$1"); _sum="$2"; _auto="${3:-}"
  # 완료 = push 완료(결정 C-③) — 현재 브랜치 tip 이 원격에 도달했는지 확인, 미도달이면 보고 거부.
  _branch=$(git branch --show-current 2>/dev/null)
  [ -n "$_branch" ] || die 2 "git 브랜치를 확인할 수 없습니다 — 리포 안에서 실행하세요."
  _local=$(git rev-parse HEAD 2>/dev/null)
  _remote=$(git ls-remote origin "refs/heads/$_branch" 2>/dev/null | cut -f1)
  [ -n "$_remote" ] || die 2 "원격에 브랜치 $_branch 가 없습니다 — git push 후 다시 시도하세요."
  [ "$_remote" = "$_local" ] || die 2 "로컬 HEAD 가 원격에 반영되지 않았습니다 — git push 후 다시 시도하세요."
  _links='[]'; _evidence='{}'
  if [ "$_auto" = "--auto-links" ]; then
    _sha=$(git rev-parse HEAD 2>/dev/null || printf '')
    _branch=$(git branch --show-current 2>/dev/null || printf '')
    _remote=$(git remote get-url origin 2>/dev/null || printf '')
    _pr=$(command -v gh >/dev/null 2>&1 && gh pr view --json url -q .url 2>/dev/null || printf '')
    _links=$(jq -nc --arg r "$_remote" --arg p "$_pr" \
      '[ (if $r|startswith("http") then {label:"repo", url:$r} else empty end),
         (if $p != "" then {label:"pr", url:$p} else empty end) ]') || die 2 "링크 JSON 생성 실패"
    _evidence=$(jq -nc --arg b "$_branch" --arg h "$_sha" --arg r "$_remote" --arg p "$_pr" \
      '{branch:$b, head_sha:$h}
       + (if $r|startswith("http") then {repo_url:$r} else {} end)
       + (if $p != "" then {pr_url:$p} else {} end)') || die 2 "증적 JSON 생성 실패"
  fi
  # claim·progress 와 같은 신원 산출 — 완료 보고도 heartbeat_agent 와 귀속을 맞춘다.
  _body=$(TOKEN="$TOK" api_raw POST "/api/v1/agent/work/$_id/report" \
    "$(jq -nc --arg a "$(agent_id_default)" --arg s "$_sum" \
       --argjson l "$_links" --argjson e "$_evidence" \
       '{agent:$a, kind:"completion", percent:100, summary:$s, links:$l, evidence:$e}')") || exit $?
  printf '%s' "$_body" | jq -r '"reported(승인 대기) — PM 승인은 웹에서"'
}

cmd_release() {
  _id=$(resolve_ref "$1")
  # claim·progress·done 과 같은 신원 산출 — release 도 heartbeat_agent 와 귀속을 맞춘다.
  _body=$(TOKEN="$TOK" api_raw POST "/api/v1/agent/work/$_id/release" \
    "$(jq -nc --arg a "$(agent_id_default)" '{agent:$a}')") || exit $?
  printf '%s' "$_body" | jq -r '.status'
}

# 토큰마다 한 줄 JSON — /dflow-team 의 키 판정과 사람의 진단이 같은 출력을 읽는다. 토큰 값은 내지 않는다.
cmd_profiles() {
  _toks=$(tokens) || exit $?
  # 지금 설정이 고르는 키. 맞는 키가 없어도 죽지 않는다 — 진단 명령이 진단할 상황에서 죽으면 안 된다.
  _sel=$(pick_token "$AS" "$AS_EXACT" 2>/dev/null) || _sel=''
  _n=0
  printf '%s\n' "$_toks" | while IFS= read -r _t; do
    [ -n "$_t" ] || continue
    _n=$((_n+1)); _issel=false
    [ -n "$_sel" ] && [ "$_t" = "$_sel" ] && _issel=true
    _me=$(TOKEN="$_t" api_raw GET /api/v1/agent/me 2>/dev/null); _rc=$?
    if [ "$_rc" -eq 0 ]; then
      # who: 팀장 잠금 owner 의 <신원> 과 같은 슬러그. /dflow-team 키 판정이 다른 워크트리의 팀장과 신원을 대조한다.
      _em=$(printf '%s' "$_me" | jq -r '.user_email // empty')
      printf '%s' "$_me" | jq -c --argjson n "$_n" --arg p "$(token_prefix "$_t")" \
        --arg ps "$ALLOWED_PROJECTS" --argjson s "$_issel" --arg w "$(slug "${_em%%@*}")" '
        ($ps | split("\n") | map(select(. != ""))) as $ok
        | {n: $n, prefix: $p, name: (.token_name // "-"), email: .user_email, who: $w, kind: .kind,
           expires_at: .token_expires_at, projects: [.projects[]? | {id, name}],
           bound: (if ($ok | length) == 0 then null
                   else ([.projects[]?.id] | any(. as $i | $ok | index($i) != null)) end),
           selected: $s}'
    else
      # 401(exit 3)은 키가 죽은 것이고 그 밖은 서버·네트워크다. 처방이 달라 한 단어로 뭉개지 않는다.
      _err=unreachable; [ "$_rc" -eq 3 ] && _err=auth
      jq -nc --argjson n "$_n" --arg p "$(token_prefix "$_t")" --arg e "$_err" --argjson s "$_issel" \
        '{n: $n, prefix: $p, error: $e, selected: $s}'
    fi
  done
}

cmd_doctor() {
  need curl; need jq
  _base=$(base) || exit $?
  printf 'base: %s\n' "$_base"
  dflow_config_projects >/dev/null   # 잘못된 project_map 키(BAD_DOCS_DIR)를 알린다 — 시작 때는 조용히 구했다
  _n=0
  _toks=$(tokens) || exit $?
  _sel=$(pick_token "$AS" "$AS_EXACT" 2>/dev/null) || _sel=''
  # printf '%s' 는 개행을 안 붙인다 — POSIX read 는 구분자 없이 끝난 마지막 줄에서 0 이 아닌
  # 값을 돌려주므로 루프 본문이 그 줄에 대해 아예 실행되지 않는다. 토큰이 하나뿐이면
  # 반복이 0 회가 되고 rc 는 0 이라, doctor 가 아무것도 안 찍고 성공으로 끝났다(2026-08-27 감사).
  printf '%s\n' "$_toks" | while IFS= read -r _t; do
    [ -n "$_t" ] || continue
    _n=$((_n+1))
    _mark=''; [ -n "$_sel" ] && [ "$_t" = "$_sel" ] && _mark=' [선택됨]'
    _me=$(TOKEN="$_t" api_raw GET /api/v1/agent/me) \
      || { printf '프로필 %d: %s 인증 실패%s\n' "$_n" "$(token_prefix "$_t")" "$_mark"; continue; }
    _cv=$(printf '%s' "$_me" | jq -r '.contract_version' 2>/dev/null)
    # prefix·이름을 함께 찍는다 — 한 계정에 키가 둘이면 email 만으로는 어느 키인지 알 수 없다.
    printf '프로필 %d: %s %s %s (계약 %s, 프로젝트 %d)%s\n' "$_n" "$(token_prefix "$_t")" \
      "$(printf '%s' "$_me" | jq -r '.token_name // "-"' 2>/dev/null)" \
      "$(printf '%s' "$_me" | jq -r '.user_email' 2>/dev/null)" "$_cv" \
      "$(printf '%s' "$_me" | jq -r '.projects | length' 2>/dev/null)" "$_mark"
    # 값이 없는 것과 major 가 다른 것은 처방이 다르다 — 전자는 킷을 갱신해도 안 고쳐진다.
    if [ -z "$_cv" ] || [ "$_cv" = "null" ]; then
      printf '  ⚠ 계약 버전 확인 불가 — /me 응답에 contract_version 이 없습니다(서버 배포·응답을 확인하세요).\n'
    elif [ "${_cv%%.*}" != "${CONTRACT_VERSION%%.*}" ]; then
      printf '  ⚠ 계약 major 불일치(서버 %s / 스킬 %s) — install.sh 재실행으로 킷을 갱신하세요.\n' \
        "$_cv" "$CONTRACT_VERSION"
    fi
  done
  # 키 선택 경고 — 토큰이 여럿인데 고정하지 않았거나, 고정한 값이 어느 토큰과도 맞지 않는다.
  # pick_token 은 실패하면 exit 하므로 서브셸에서 부른다.
  _cnt=$(printf '%s\n' "$_toks" | grep -c .)
  if [ -n "${DFLOW_AS:-}" ]; then
    ( pick_token "$DFLOW_AS" 1 ) >/dev/null 2>&1 \
      || printf '⚠ DFLOW_AS=%s 에 맞는 토큰이 없습니다 — dflow.sh profiles 의 prefix 를 적으세요.\n' "$DFLOW_AS"
  elif [ "$_cnt" -ge 2 ]; then
    printf '⚠ 토큰이 %d개인데 DFLOW_AS 가 없습니다 — 첫 토큰을 씁니다(.dflow.local 에 as=<prefix>, 레거시는 .env 에 DFLOW_AS=<prefix>).\n' "$_cnt"
  fi
}

# 설정 조회 — 토큰·네트워크가 필요 없다. 비밀(pats·pat)은 내지 않는다.
cmd_config() {
  case "${1:-}" in
    --source) printf 'mode=%s\ndflow=%s\nlocal=%s\n' "$DFLOW_CONFIG_MODE" "${DFLOW_CONFIG_DOT:--}" "${DFLOW_CONFIG_LOCAL:--}" ;;
    projects) dflow_config_projects ;;
    docs-dir) [ -n "${2:-}" ] || usage; dflow_config_docs_dir "$2" || exit 2 ;;
    tasks-dirs) dflow_config_tasks_dirs ;;
    pats|pat) die 2 "SECRET 비밀 값은 출력하지 않는다" ;;
    '') usage ;;
    *) _n=$(_dfc_env "$1") || die 2 "UNKNOWN_KEY $1"; eval "printf '%s\n' \"\${$_n:-}\"" ;;
  esac
}
cmd_branch() {
  case "${1:-}" in dev|release) dflow_config_branch "$1" || exit 2 ;; *) usage ;; esac
}

# ---- main ----------------------------------------------------------------
case "${1:-}" in
  config) shift; cmd_config "$@"; exit $? ;;
  branch) shift; cmd_branch "$@"; exit $? ;;
esac
need curl; need jq
AS="${DFLOW_AS:-}"; AS_EXACT=1          # .dflow.local 의 as(레거시 .env 의 DFLOW_AS)는 prefix 만
[ "${1:-}" = "--as" ] && { AS="$2"; AS_EXACT=''; shift 2; }
[ $# -ge 1 ] || usage
CMD="$1"; shift
case "$CMD" in
  doctor|profiles) "cmd_$CMD" "$@" ;;   # 전 프로필 순회라 TOK 불필요
  *) TOK=$(pick_token "$AS" "$AS_EXACT") || exit 2
     case "$CMD" in
       me) cmd_me "$@" ;;
       list) cmd_list "$@" ;;
       show) [ $# -ge 1 ] || usage; cmd_show "$@" ;;
       taskdir) [ $# -ge 1 ] || usage; cmd_taskdir "$@" ;;
       claim) [ $# -ge 1 ] || usage; cmd_claim "$@" ;;
       progress) [ $# -ge 3 ] || usage; cmd_progress "$@" ;;
       heartbeat) [ $# -ge 1 ] || usage; cmd_heartbeat "$@" ;;
       watch) cmd_watch "$@" ;;
       done) [ $# -ge 2 ] || usage; cmd_done "$@" ;;
       release) [ $# -ge 1 ] || usage; cmd_release "$@" ;;
       scaffold) cmd_scaffold "$@" ;;
       *) usage ;;
     esac ;;
esac
