#!/bin/sh
# dflow.sh — D'Flow Agent API 얇은 curl 래퍼. 계약 v2.x (references/api-contract.md).
# 정확한 기대 버전은 아래 CONTRACT_VERSION 하나뿐이다 — 주석과 비교문에 숫자를 따로 두면
# 둘이 따로 낡는다(2026-08-27 감사: 서버가 2.1 인데 비교문만 2.0 으로 남아 있었다).
# exit: 0 성공 / 2 사용법·설정 / 3 인증 / 4 상태충돌 / 5 권한 / 6 네트워크·서버·로컬 환경 / 7 기능꺼짐
# 토큰은 env 확장으로만 전달한다 — echo·파일 기록·명령 문자열 보간 금지.
set -u

# 이 스킬이 기대하는 계약 버전. doctor 는 major 만 본다 — 서버가 minor 를 올리는 것은
# additive 라 정상이고, 등호로 보면 상향 때마다 전 세션이 오경보를 본다.
CONTRACT_VERSION=2.2

CACHE_DIR="${XDG_CACHE_HOME:-$HOME/.cache}/dflow"
LIST_CACHE="$CACHE_DIR/last-list.json"
PROFILE_CACHE="$CACHE_DIR/profiles.json"
# id8 → 전체 UUID 영속 맵. 목록 캐시는 매 list 로 덮여서 approved 처럼 목록에서 빠진 주문의
# 접두 해석이 죽는다(2026-08-25 실증 — 감지하려는 바로 그 상태에서 show 실패). 한 번이라도
# 목록에 떴던 id 를 여기 누적해 접두 해석의 폴백으로 쓴다. UUID 목록뿐이라 비밀 아님.
IDMAP_CACHE="$CACHE_DIR/known-ids.txt"

usage() {
  cat >&2 <<'EOF'
사용법: dflow.sh [--as <이름|email>] <cmd> [args]
  me                     현재 프로필 신원·접근 프로젝트
  list [--all] [--scope available|claimed|assigned|all]
  show <ref>             ref = 목록 순번 | UUID 앞 8자 | 전체 UUID
  claim <ref>
  progress <ref> <pct 0-99> <요약>
  done <ref> <요약> [--auto-links]
  release <ref>
  doctor                 설정·의존성·계약 버전 점검
EOF
  exit 2
}

die() { printf '%s\n' "$2" >&2; exit "$1"; }

need() { command -v "$1" >/dev/null 2>&1 || die 2 "필요한 명령이 없습니다: $1"; }

# ---- 설정·프로필 ----------------------------------------------------------
base() {
  [ -n "${DFLOW_API_BASE:-}" ] || die 2 "DFLOW_API_BASE 미설정 — .env 를 확인하세요."
  printf '%s' "${DFLOW_API_BASE%/}"
}
# DFLOW_PATS(쉼표 구분) 우선, 없으면 DFLOW_PAT 단일. 토큰 문자열은 변수로만 다룬다.
tokens() {
  [ -n "${DFLOW_PATS:-}" ] || [ -n "${DFLOW_PAT:-}" ] || die 2 "DFLOW_PATS 또는 DFLOW_PAT 미설정"
  if [ -n "${DFLOW_PATS:-}" ]; then printf '%s' "$DFLOW_PATS" | tr ',' '\n'
  else printf '%s\n' "$DFLOW_PAT"; fi
}
# 프로필 캐시: [{prefix, email}] — 평문 토큰은 캐시하지 않는다(재조회 키는 prefix).
profile_email() { # $1=token → 캐시에서 email, 없으면 /me 조회 후 캐시
  _pfx=$(printf '%s' "$1" | cut -d_ -f3)
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
# --as 해석: 이름/이메일 부분 일치 프로필의 토큰 1개 선택. 미지정이면 첫 토큰.
pick_token() { # $1=--as 값('' 허용)
  _want="$1"; _found=''
  for _t in $(tokens); do
    [ -z "$_want" ] && { printf '%s' "$_t"; return 0; }
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
    409) printf '%s\n' "$_body" >&2; exit 4 ;;
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

cmd_list() {
  _scope='available'; _all=''
  while [ $# -gt 0 ]; do case "$1" in
    --all) _all=1 ;;
    --scope) _scope="$2"; shift ;;
    *) die 2 "알 수 없는 옵션: $1" ;;
  esac; shift; done
  mkdir -p "$CACHE_DIR"
  if [ -n "$_all" ]; then
    for _t in $(tokens); do
      printf '== %s ==\n' "$(profile_email "$_t" || printf '?')"
      _body=$(TOKEN="$_t" api_raw GET "/api/v1/agent/work/mine?scope=$_scope") || exit $?
      printf '%s' "$_body" | jq '[.claimed[]?, .assigned[]?, .available[]?]' | tee "$LIST_CACHE.tmp" | print_list
      remember_ids "$LIST_CACHE.tmp"
    done
  else
    _body=$(TOKEN="$TOK" api_raw GET "/api/v1/agent/work/mine?scope=$_scope") || exit $?
    printf '%s' "$_body" | jq '[.claimed[]?, .assigned[]?, .available[]?]' > "$LIST_CACHE.tmp"
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

# spec.md 로컬 캐시(결정 A) — DB 정본의 명세를 claim 시점에 스냅샷.
write_spec_cache() { # $1=claim 응답 JSON
  _tsk=$(printf '%s' "$1" | jq -r '.item.external_ref // empty' 2>/dev/null | awk -F/ '{print $NF}')
  [ -n "$_tsk" ] || return 0
  mkdir -p "docs/tasks/$_tsk"
  _spec_tmp="docs/tasks/$_tsk/spec.md.tmp"
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
  mv "$_spec_tmp" "docs/tasks/$_tsk/spec.md" || die 6 "spec 파일 원자 이동 실패"
  printf 'spec 캐시: docs/tasks/%s/spec.md\n' "$_tsk"
}

cmd_claim() {
  _id=$(resolve_ref "$1")
  # ① show 로 선행 evidence 를 먼저 받아 로컬 검사 — 통과 전에는 claim 자체를 하지 않는다(결정 C-②).
  _detail=$(TOKEN="$TOK" api_raw GET "/api/v1/agent/work/$_id") || exit $?
  check_depends_local "$(printf '%s' "$_detail" | jq -c '.depends_evidence // []')"
  _label="claude-$(hostname -s)"  # 라벨 결정론(§3) — 무작위·타임스탬프 금지
  _resp=$(TOKEN="$TOK" api_raw POST "/api/v1/agent/work/$_id/claim" \
    "$(jq -nc --arg a "$_label" '{agent:$a}')") || exit $?
  write_spec_cache "$_resp"
  printf 'claimed %s\n' "$(printf '%s' "$_id" | cut -c1-8)"
}

cmd_progress() {
  _id=$(resolve_ref "$1"); _pct="$2"; _sum="$3"
  [ "$_pct" -ge 0 ] 2>/dev/null && [ "$_pct" -le 99 ] || die 2 "pct 는 0~99 — 완료는 done 을 쓰세요."
  _body=$(TOKEN="$TOK" api_raw POST "/api/v1/agent/work/$_id/report" \
    "$(jq -nc --arg a "claude-$(hostname -s)" --argjson p "$_pct" --arg s "$_sum" \
       '{agent:$a, kind:"progress", percent:$p, summary:$s}')") || exit $?
  printf '%s' "$_body" | jq -r '.status'
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
  _body=$(TOKEN="$TOK" api_raw POST "/api/v1/agent/work/$_id/report" \
    "$(jq -nc --arg a "claude-$(hostname -s)" --arg s "$_sum" \
       --argjson l "$_links" --argjson e "$_evidence" \
       '{agent:$a, kind:"completion", percent:100, summary:$s, links:$l, evidence:$e}')") || exit $?
  printf '%s' "$_body" | jq -r '"reported(승인 대기) — PM 승인은 웹에서"'
}

cmd_release() {
  _id=$(resolve_ref "$1")
  _body=$(TOKEN="$TOK" api_raw POST "/api/v1/agent/work/$_id/release" \
    "$(jq -nc --arg a "claude-$(hostname -s)" '{agent:$a}')") || exit $?
  printf '%s' "$_body" | jq -r '.status'
}

cmd_doctor() {
  need curl; need jq
  _base=$(base) || exit $?
  printf 'base: %s\n' "$_base"
  _n=0
  _toks=$(tokens) || exit $?
  # printf '%s' 는 개행을 안 붙인다 — POSIX read 는 구분자 없이 끝난 마지막 줄에서 0 이 아닌
  # 값을 돌려주므로 루프 본문이 그 줄에 대해 아예 실행되지 않는다. 토큰이 하나뿐이면
  # 반복이 0 회가 되고 rc 는 0 이라, doctor 가 아무것도 안 찍고 성공으로 끝났다(2026-08-27 감사).
  printf '%s\n' "$_toks" | while IFS= read -r _t; do
    [ -n "$_t" ] || continue
    _n=$((_n+1))
    _me=$(TOKEN="$_t" api_raw GET /api/v1/agent/me) || { printf '프로필 %d: 인증 실패\n' "$_n"; continue; }
    _cv=$(printf '%s' "$_me" | jq -r '.contract_version' 2>/dev/null)
    printf '프로필 %d: %s (계약 %s, 프로젝트 %d)\n' "$_n" \
      "$(printf '%s' "$_me" | jq -r '.user_email' 2>/dev/null)" "$_cv" \
      "$(printf '%s' "$_me" | jq -r '.projects | length' 2>/dev/null)"
    # 값이 없는 것과 major 가 다른 것은 처방이 다르다 — 전자는 킷을 갱신해도 안 고쳐진다.
    if [ -z "$_cv" ] || [ "$_cv" = "null" ]; then
      printf '  ⚠ 계약 버전 확인 불가 — /me 응답에 contract_version 이 없습니다(서버 배포·응답을 확인하세요).\n'
    elif [ "${_cv%%.*}" != "${CONTRACT_VERSION%%.*}" ]; then
      printf '  ⚠ 계약 major 불일치(서버 %s / 스킬 %s) — install.sh 재실행으로 킷을 갱신하세요.\n' \
        "$_cv" "$CONTRACT_VERSION"
    fi
  done
}

# ---- main ----------------------------------------------------------------
need curl; need jq
AS=''
[ "${1:-}" = "--as" ] && { AS="$2"; shift 2; }
[ $# -ge 1 ] || usage
CMD="$1"; shift
case "$CMD" in
  doctor) cmd_doctor "$@" ;;   # doctor 는 전 프로필 순회라 TOK 불필요
  *) TOK=$(pick_token "$AS") || exit 2
     case "$CMD" in
       me) cmd_me "$@" ;;
       list) cmd_list "$@" ;;
       show) [ $# -ge 1 ] || usage; cmd_show "$@" ;;
       claim) [ $# -ge 1 ] || usage; cmd_claim "$@" ;;
       progress) [ $# -ge 3 ] || usage; cmd_progress "$@" ;;
       done) [ $# -ge 2 ] || usage; cmd_done "$@" ;;
       release) [ $# -ge 1 ] || usage; cmd_release "$@" ;;
       *) usage ;;
     esac ;;
esac
