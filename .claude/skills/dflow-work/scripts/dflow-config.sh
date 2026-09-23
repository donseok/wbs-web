#!/bin/sh
# dflow-config.sh — D'Flow 에이전트 설정 해석. source 해서 쓴다(단독 실행하지 않는다).
# .dflow(프로젝트 공통, 커밋)·.dflow.local(개인, gitignore)을 읽어 DFLOW_* env 로 export 한다.
# 우선순위: 이미 export 된 env > 파일 > 레거시 .env. 설정 파일은 source 하지 않는다 — 값을 실행하지 않는다.
# 실패하면 사유 코드 한 줄을 stderr 에 내고 return 2. 값은 메시지에 넣지 않는다(토큰이 섞일 수 있다).

_dfc_env() {
  case "$1" in
    api_base) echo DFLOW_API_BASE ;; project_id) echo DFLOW_PROJECT_ID ;; release_branch) echo DFLOW_RELEASE_BRANCH ;;
    pats) echo DFLOW_PATS ;; pat) echo DFLOW_PAT ;; as) echo DFLOW_AS ;; dev_branch) echo DFLOW_DEV_BRANCH ;;
    automerge) echo DFLOW_AUTOMERGE ;; project_map) echo DFLOW_PROJECT_MAP ;;
    *) return 1 ;;
  esac
}
_dfc_scope() {
  case "$1" in
    api_base|project_id|release_branch) echo common ;;
    pats|pat|as|dev_branch|automerge|project_map) echo personal ;;
    *) echo unknown ;;
  esac
}
# stdin 의 key=value 를 정규화해 key=value 줄로 낸다. 주석·빈 줄·CR·앞뒤 공백·값 뒤 " #…" 를 버린다.
_dfc_parse() {
  awk '{ sub(/\r$/, ""); sub(/^[ \t]+/, "")
         if ($0 == "" || substr($0, 1, 1) == "#") next
         i = index($0, "="); if (i < 2) { print "BAD_LINE " NR > "/dev/stderr"; next }
         k = substr($0, 1, i - 1); v = substr($0, i + 1)
         sub(/[ \t]+$/, "", k); sub(/^[ \t]+/, "", v); sub(/[ \t]+#.*$/, "", v); sub(/[ \t]+$/, "", v)
         print k "=" v }'
}
# $1=이 파일이 받을 범위(common|personal) $2=표시명. stdin=_dfc_parse 출력. 파이프 없이 here-doc 으로 받아야
# export 가 호출자 셸에 남는다.
_dfc_apply() {
  _dfc_rc=0
  while IFS= read -r _dfc_l; do
    [ -n "$_dfc_l" ] || continue
    _dfc_k=${_dfc_l%%=*}; _dfc_v=${_dfc_l#*=}
    _dfc_s=$(_dfc_scope "$_dfc_k")
    if [ "$_dfc_s" = unknown ]; then echo "UNKNOWN_KEY $2: $_dfc_k (무시)" >&2; continue; fi
    if [ "$_dfc_s" != "$1" ]; then
      if [ "$1" = common ]; then
        echo "PERSONAL_KEY_IN_DFLOW $_dfc_k 는 개인 설정이다. .dflow.local 로 옮겨라" >&2; _dfc_rc=2
      else
        echo "COMMON_KEY_IN_LOCAL $_dfc_k 는 프로젝트 공통 설정이다. .dflow.local 의 값은 무시한다" >&2
      fi
      continue
    fi
    _dfc_n=$(_dfc_env "$_dfc_k")
    eval "_dfc_cur=\${$_dfc_n:-}"
    [ -n "$_dfc_cur" ] || { eval "$_dfc_n=\$_dfc_v"; export "$_dfc_n"; }
  done
  return $_dfc_rc
}

dflow_config_load() {
  DFLOW_CONFIG_MODE=''; DFLOW_CONFIG_DOT=''; DFLOW_CONFIG_LOCAL=''
  if [ -n "${DFLOW_CONFIG_DIR:-}" ]; then DFLOW_CONFIG_TOP=$DFLOW_CONFIG_DIR
  else DFLOW_CONFIG_TOP=$(git rev-parse --show-toplevel 2>/dev/null) || DFLOW_CONFIG_TOP=''; fi
  _dfc_local=''; _dfc_dot=''
  if [ -n "$DFLOW_CONFIG_TOP" ] && [ -f "$DFLOW_CONFIG_TOP/.dflow.local" ]; then
    _dfc_local=$(cat "$DFLOW_CONFIG_TOP/.dflow.local"); DFLOW_CONFIG_LOCAL="$DFLOW_CONFIG_TOP/.dflow.local"
  fi
  if [ -n "$DFLOW_CONFIG_TOP" ] && [ -f "$DFLOW_CONFIG_TOP/.dflow" ]; then
    _dfc_dot=$(cat "$DFLOW_CONFIG_TOP/.dflow"); DFLOW_CONFIG_DOT="$DFLOW_CONFIG_TOP/.dflow"
  elif [ -n "$DFLOW_CONFIG_TOP" ] && git -C "$DFLOW_CONFIG_TOP" rev-parse --git-dir >/dev/null 2>&1; then
    # detach 된 옛 커밋에는 .dflow 가 없을 수 있다. 개발 브랜치는 개인 파일에서 이미 알므로 순환이 없다.
    # _dfc_apply 는 중복 키 중 첫 값을 쓴다(50행) — 이 폴백도 같은 규칙이어야 한다. tail 이면 값이 갈린다.
    _dfc_dev=${DFLOW_DEV_BRANCH:-$(printf '%s\n' "$_dfc_local" | _dfc_parse 2>/dev/null | sed -n 's/^dev_branch=//p' | head -n 1)}
    for _dfc_ref in ${_dfc_dev:+"origin/$_dfc_dev"} origin/HEAD; do
      if _dfc_dot=$(git -C "$DFLOW_CONFIG_TOP" show "$_dfc_ref:.dflow" 2>/dev/null); then
        DFLOW_CONFIG_DOT="$_dfc_ref:.dflow"; break
      fi
      _dfc_dot=''
    done
  fi

  if [ -n "$DFLOW_CONFIG_DOT" ] && [ -n "$DFLOW_CONFIG_LOCAL" ]; then
    DFLOW_CONFIG_MODE=new
    _dfc_apply common "$DFLOW_CONFIG_DOT" <<EOF || return 2
$(printf '%s\n' "$_dfc_dot" | _dfc_parse)
EOF
    _dfc_apply personal .dflow.local <<EOF || return 2
$(printf '%s\n' "$_dfc_local" | _dfc_parse)
EOF
    [ -n "${DFLOW_DEV_BRANCH:-}" ] || {
      echo "NO_DEV_BRANCH .dflow.local 에 dev_branch=<내 개발 브랜치> 를 적어라(운영 브랜치에서 직접 개발하면 그 이름을 적는다)" >&2
      return 2; }
  elif [ -n "$DFLOW_CONFIG_DOT" ]; then
    echo "NO_LOCAL $DFLOW_CONFIG_TOP/.dflow.local 이 없다. 개인 설정(pats·dev_branch 등)을 만들어라(예시: .claude/skills/dflow-work/dflow.local.example)" >&2
    return 2
  elif [ -n "$DFLOW_CONFIG_LOCAL" ]; then
    echo "NO_DFLOW .dflow.local 은 있는데 .dflow 를 찾지 못했다(워크트리·origin/<dev_branch>·origin/HEAD). 프로젝트 공통 설정을 커밋하라" >&2
    return 2
  else
    DFLOW_CONFIG_MODE=legacy
    # 종전 dflow.sh 와 같다: 환경에 PAT 가 없을 때만, 파일이 있을 때만 읽는다.
    if [ -z "${DFLOW_PATS:-}${DFLOW_PAT:-}" ]; then
      _dfc_envf=${DFLOW_ENV_FILE:-${DFLOW_CONFIG_DIR:+$DFLOW_CONFIG_DIR/.env}}; _dfc_envf=${_dfc_envf:-./.env}
      if [ -f "$_dfc_envf" ]; then
        echo "LEGACY_ENV $_dfc_envf 를 읽었다. .dflow·.dflow.local 로 옮겨라" >&2
        set -a; . "$_dfc_envf"; set +a
      fi
    fi
  fi
  export DFLOW_CONFIG_MODE DFLOW_CONFIG_DOT DFLOW_CONFIG_LOCAL DFLOW_CONFIG_TOP
  return 0
}

_dfc_origin_head() {
  _dfc_b=$(git -C "${DFLOW_CONFIG_TOP:-.}" symbolic-ref --short refs/remotes/origin/HEAD 2>/dev/null); _dfc_b=${_dfc_b#origin/}
  [ -n "$_dfc_b" ] || _dfc_b=$(git -C "${DFLOW_CONFIG_TOP:-.}" ls-remote --symref origin HEAD 2>/dev/null \
    | sed -n 's|^ref: refs/heads/\([^[:space:]]*\)[[:space:]]*HEAD$|\1|p')
  [ -n "$_dfc_b" ] && printf '%s\n' "$_dfc_b"
}
# $1=dev|release → origin/ 없는 브랜치 이름. 새 방식의 dev 는 load 가 이미 필수로 확인했다.
dflow_config_branch() {
  case "$1" in
    dev) [ -n "${DFLOW_DEV_BRANCH:-}" ] && { printf '%s\n' "$DFLOW_DEV_BRANCH"; return 0; } ;;
    release) [ -n "${DFLOW_RELEASE_BRANCH:-}" ] && { printf '%s\n' "$DFLOW_RELEASE_BRANCH"; return 0; } ;;
    *) echo "사용: dflow_config_branch dev|release" >&2; return 2 ;;
  esac
  _dfc_origin_head || { echo "NO_DEFAULT_BRANCH origin/HEAD 를 알 수 없다" >&2; return 2; }
}
# 리포 ↔ D'Flow 프로젝트 바인딩: project_id 와 project_map(docs/x=<uuid>,…) 값의 합집합.
dflow_config_projects() {
  { printf '%s\n' "${DFLOW_PROJECT_ID:-}"
    printf '%s' "${DFLOW_PROJECT_MAP:-}" | tr ',' '\n' | sed -n 's/^[^=]*=//p'
  } | tr -d ' \r' | grep -v '^$' | sort -u
}

# 작업 폴더 역매핑: $1=프로젝트 UUID → DOCS_DIR 한 줄(끝 / 제거). 작업 폴더는 <DOCS_DIR>/tasks/<TSK>.
# project_map 의 키가 먼저, 없고 project_id 와 같으면 docs. 추측하지 않는다(스펙 2026-09-23-dflow-task-scaffold §3).
dflow_config_docs_dir() {
  _dfc_u=$(printf '%s' "${1:-}" | tr -d ' \r')
  [ -n "$_dfc_u" ] || { echo "사용: dflow_config_docs_dir <project_uuid>" >&2; return 2; }
  _dfc_keys=$(printf '%s' "${DFLOW_PROJECT_MAP:-}" | tr ',' '\n' | tr -d ' \r' \
    | awk -F= -v u="$_dfc_u" 'NF == 2 && $2 == u { sub(/\/+$/, "", $1); if ($1 != "") print $1 }' | sort -u)
  _dfc_n=$(printf '%s' "$_dfc_keys" | grep -c .)
  if [ "$_dfc_n" -gt 1 ]; then
    echo "AMBIGUOUS_DOCS_DIR 프로젝트 ${_dfc_u%%-*} 가 project_map 에 여러 키로 있다" >&2; return 2
  fi
  [ "$_dfc_n" -eq 1 ] && { printf '%s\n' "$_dfc_keys"; return 0; }
  [ "$(printf '%s' "${DFLOW_PROJECT_ID:-}" | tr -d ' \r')" = "$_dfc_u" ] && { echo docs; return 0; }
  echo "PROJECT_MISMATCH 프로젝트 ${_dfc_u%%-*} 는 이 리포 바인딩(project_id·project_map) 밖이다" >&2; return 2
}

# 바인딩된 작업 폴더 목록(리포 최상위 기준 상대경로). 여러 작업을 훑는 스윕·감지가 쓴다.
dflow_config_tasks_dirs() {
  { [ -n "$(printf '%s' "${DFLOW_PROJECT_ID:-}" | tr -d ' \r')" ] && echo docs
    printf '%s' "${DFLOW_PROJECT_MAP:-}" | tr ',' '\n' | tr -d ' \r' \
      | awk -F= 'NF == 2 && $2 != "" { sub(/\/+$/, "", $1); if ($1 != "") print $1 }'
  } | sed 's|$|/tasks|' | sort -u
}
