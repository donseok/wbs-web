# dflow-lease.sh — 팀장 lease(wbs-web docs/superpowers/specs/2026-09-23-dflow-lead-lease-design.md §6). dflow.sh 가 source 한다.
# dflow.sh 의 api_raw·die·slug·host_short·profile_email·ALLOWED_PROJECTS·TOK 을 쓴다. 토큰은 env 로만 넘긴다.

# PC ID — hostname 은 겹칠 수 있어 쓰지 않는다. 처음 쓸 때 /dev/urandom 으로 만든다(uuidgen 이 없는 Git Bash 대비).
lease_machine_id() {
  _mf="${DFLOW_MACHINE_ID_FILE:-$HOME/.dflow/machine-id}"
  if [ ! -s "$_mf" ]; then
    mkdir -p "$(dirname "$_mf")" && chmod 700 "$(dirname "$_mf")" || return 1
    _hex=$(od -An -N16 -tx1 /dev/urandom | tr -d ' \n') || return 1
    [ "${#_hex}" -eq 32 ] || return 1
    ( umask 077
      printf '%s-%s-4%s-8%s-%s\n' "$(printf '%s' "$_hex" | cut -c1-8)" "$(printf '%s' "$_hex" | cut -c9-12)" \
        "$(printf '%s' "$_hex" | cut -c14-16)" "$(printf '%s' "$_hex" | cut -c18-20)" "$(printf '%s' "$_hex" | cut -c21-32)" \
        > "$_mf" ) || return 1
    chmod 600 "$_mf"
  fi
  head -n 1 "$_mf" | tr -d '\r'
}
# holder = <PC ID>:<리포 경로 cksum>. 홈 경로를 서버에 보내지 않으려고 경로는 해시로만 싣는다.
lease_holder() {
  _mid=$(lease_machine_id) || return 1
  _top=$(${DFLOW_GIT:-git} rev-parse --show-toplevel 2>/dev/null) || return 1
  printf '%s:%s\n' "$_mid" "$(printf '%s' "$_top" | cksum | cut -d' ' -f1)"
}
lease_state_file() { ${DFLOW_GIT:-git} rev-parse --path-format=absolute --git-path dflow-team.lease 2>/dev/null; }
# PID 생존 확인. Windows(Git Bash/MSYS)는 CLAUDE_PID 가 네이티브 Windows PID 라 MSYS 의 kill -0 이
# 못 알아본다(항상 죽은 걸로 본다) — 팀장이 멀쩡한데 lease_keep 첫 검사에서 바로 반납하는 사고가 난다.
# kill -0 이 실패하면 MSYS/MinGW/Cygwin 한정으로 `ps -W`(WINPID 열)에서 한 번 더 찾는다.
lease_pid_alive() {
  kill -0 "$1" 2>/dev/null && return 0
  case "$(uname -s 2>/dev/null)" in
    MINGW*|MSYS*|CYGWIN*)
      ps -W 2>/dev/null | awk -v pid="$1" '
        NR==1 { for (i=1;i<=NF;i++) if ($i=="WINPID") c=i; next }
        c && $c==pid { found=1 }
        END { exit !found }' ;;
    *) return 1 ;;
  esac
}
# 상태 파일 → [{project_id, generation}]
lease_refs_json() { jq -Rnc '[inputs | select(. != "") | split(" ") | {project_id: .[0], generation: (.[1] | tonumber)}]' < "$1"; }

lease_acquire() {
  _take=false
  case "${1:-}" in --takeover) _take=true ;; '') ;; *) usage ;; esac
  [ -n "$ALLOWED_PROJECTS" ] || die 2 "NO_PROJECT .dflow 의 project_id 또는 .dflow.local 의 project_map 을 넣어라"
  _h=$(lease_holder) || die 6 "LEASE_HOLDER PC ID 나 리포 경로를 정하지 못했다"
  _sf=$(lease_state_file) || die 2 "LEASE_STATE git 리포 안에서 실행하라"
  _em=$(profile_email "$TOK") || die 3 "신원 확인 실패(/me)"
  _hs=$(slug "$(host_short)")
  _json=$(printf '%s\n' "$ALLOWED_PROJECTS" | jq -Rnc --arg h "$_h" --arg hs "$_hs" \
    --arg a "$(slug "${_em%%@*}")/$_hs/lead" --argjson t "$_take" \
    '{op:"acquire", projects:[inputs | select(. != "")], holder:$h, host:$hs, agent:$a, takeover:$t}')
  mkdir -p "$CACHE_DIR"; _ef="$CACHE_DIR/lease_err.$$"
  _body=$( (TOKEN="$TOK" api_raw POST /api/v1/agent/lead/lease "$_json") 2>"$_ef" ); _rc=$?
  if [ "$_rc" = 4 ] && jq -e '.code == "lead_lease_held"' "$_ef" >/dev/null 2>&1; then
    jq -r '.held[] | "LEAD_LEASE_HELD \(.project_id) \(.host // "-") \(.agent // "-") \(.expires_at // "-")"' "$_ef"
    rm -f "$_ef"; exit 4
  fi
  [ "$_rc" = 0 ] || { cat "$_ef" >&2; rm -f "$_ef"; exit "$_rc"; }
  rm -f "$_ef"
  ( umask 077; printf '%s' "$_body" | jq -r '.leases[] | "\(.project_id) \(.generation)"' > "$_sf" ) \
    || die 6 "LEASE_STATE 상태 파일을 쓰지 못했다"
  date +%s > "$_sf.beat"   # 첫 기상의 LEASE_KEEP_DEAD 오경보를 막는다(keep 이 첫 갱신을 하기 전)
  printf 'LEASE_OK %s\n' "$(grep -c . "$_sf")"
}

# 무거운 작업 표시(wbs-web docs/superpowers/specs/2026-09-26-heavy-work-office-bubble-design.md §2) — heavy.sh snapshot 을
# renew 의 heavy({pc, orders})로 바꾼다. 팀원 워크트리(.claude/worktrees/dflow-<id8>[-resolve]) 의 슬롯만 주문에 싣고,
# 명령의 워크트리 경로는 ".", 홈은 "~", *TOKEN*·*SECRET*·*KEY*·*PASS*·*PAT* 값은 "***" 로 가린다(홈 경로를 서버에 보내지 않는다).
# 무엇이 실패해도 빈 출력이다 — heavy 쪽 실패가 renew 를 실패시키면 lease_keep 이 3회 만에 팀장을 멈춘다.
lease_heavy_json() {
  _hv="${DFLOW_HEAVY_SH:-$(dirname "$0")/../../dflow-dev/scripts/heavy.sh}"
  [ -f "$_hv" ] || return 0
  _snap=$(bash "$_hv" snapshot 2>/dev/null) || return 0
  printf '%s\n' "$_snap" | jq -Rnc --arg home "${HOME:-}" '
    def num: if . == null or . == "-" then null else (tonumber? // null) end;
    def wt: (capture("^(?<wt>.*/\\.claude/worktrees/dflow-(?<id8>[0-9a-f]{8})(-resolve)?)(/|$)") // null);
    def clean($w): (if $w then split($w) | join(".") else . end)
      | (if $home != "" then split($home) | join("~") else . end)
      | gsub("(?<k>[A-Za-z0-9_]*(TOKEN|SECRET|KEY|PASS|PAT)[A-Za-z0-9_]*)=[^ ]*"; "\(.k)=***"; "i")
      | .[0:200];
    [inputs | select(. != "") | split("\t")] as $rows
    | ([$rows[] | select(.[0] == "PC")] | first) as $pc
    | if $pc == null then empty else
      ([$rows[] | select(.[0] == "WAIT" and .[2] == "general") | .[1] | num | select(. != null)]) as $ws
      | { pc: {k: ($pc[1] | num), held: ($pc[2] | num), waiting: ($pc[3] | num), load: ($pc[4] | num), cpus: ($pc[5] | num)},
          orders: ([ $rows[]
            | if .[0] == "RUN" then {state: "run", since: (.[1] | num), kind: .[2], pool: .[3], cwd: .[4], cmd: .[5]}
              elif .[0] == "WAIT" then {state: "wait", since: (.[1] | num), kind: "run", pool: .[2], cwd: .[3], cmd: .[4]}
              else empty end
            | (.cwd // "" | wt) as $m | select($m != null)
            | . as $o
            | $o + {id8: $m.id8, cmd: ($o.cmd // "" | clean($m.wt)),
                    pos: (if $o.state == "wait" and $o.pool == "general" and $o.since != null
                          then ([$ws[] | select(. < $o.since)] | length) + 1 else null end)}
            | del(.cwd) ]
            | group_by(.id8)
            | map((sort_by((if .state == "run" then 0 else 1 end), (.since // 0)) | .[0]) + {n: length})
            | .[0:50]) }
      end' 2>/dev/null || true
}

lease_renew() {
  _sf=$(lease_state_file) || die 2 "LEASE_STATE git 리포 안에서 실행하라"
  [ -s "$_sf" ] || { printf 'LEASE_NONE\n'; exit 2; }
  _h=$(lease_holder) || die 6 "LEASE_HOLDER PC ID 나 리포 경로를 정하지 못했다"
  _hj=$(lease_heavy_json)
  _json=$(jq -nc --arg h "$_h" --argjson l "$(lease_refs_json "$_sf")" --arg hv "$_hj" \
    '{op:"renew", holder:$h, leases:$l}
     + (($hv | try fromjson catch null) as $x | if ($x | type) == "object" then {heavy: $x} else {} end)')
  _body=$(TOKEN="$TOK" api_raw POST /api/v1/agent/lead/lease "$_json") || exit $?
  _lost=$(printf '%s' "$_body" | jq -r '.lost | join(" ")')
  [ -z "$_lost" ] || { printf 'LEASE_LOST %s\n' "$_lost"; exit 4; }
  date +%s > "$_sf.beat"
  printf 'LEASE_OK\n'
}

lease_release() {
  _sf=$(lease_state_file) || die 2 "LEASE_STATE git 리포 안에서 실행하라"
  [ -s "$_sf" ] || { rm -f "$_sf" "$_sf.beat"; printf 'LEASE_NONE\n'; return 0; }
  _h=$(lease_holder) || die 6 "LEASE_HOLDER PC ID 나 리포 경로를 정하지 못했다"
  _json=$(jq -nc --arg h "$_h" --argjson l "$(lease_refs_json "$_sf")" '{op:"release", holder:$h, leases:$l}')
  _body=$(TOKEN="$TOK" api_raw POST /api/v1/agent/lead/lease "$_json") || exit $?
  rm -f "$_sf" "$_sf.beat"
  printf 'LEASE_RELEASED %s\n' "$(printf '%s' "$_body" | jq -r '.released')"
}

# 팀장 PID 에 묶인 갱신 루프. run_in_background 로 띄운다.
lease_keep() {
  _pid=''; _lf=''
  while [ $# -gt 0 ]; do
    case "$1" in
      --pid) _pid="${2:-}"; shift 2 || usage ;;
      --lost-file) _lf="${2:-}"; shift 2 || usage ;;
      *) usage ;;
    esac
  done
  [ -n "$_pid" ] && [ -n "$_lf" ] || usage
  _iv="${DFLOW_LEASE_INTERVAL:-60}"; _st="${DFLOW_LEASE_STEP:-5}"; _fails=0
  _sf=$(lease_state_file) || die 2 "LEASE_STATE git 리포 안에서 실행하라"
  # 세션이 끝나며 백그라운드 태스크를 신호로 거두면 kill -0 분기에 닿지 못한다. 그때도 바로 반납한다.
  trap '(lease_release) >/dev/null 2>&1; exit 0' TERM HUP INT
  while :; do
    # 팀장이 죽었으면 바로 반납한다 — TTL 을 기다리면 같은 신원이 다른 곳에서 3분간 시작하지 못한다.
    lease_pid_alive "$_pid" || { (lease_release) >/dev/null 2>&1; exit 0; }
    # 정상 마감이 release 로 상태 파일을 지웠다.
    [ -s "$_sf" ] || exit 0
    _out=$( (lease_renew) 2>/dev/null ); _rc=$?
    case "$_rc" in
      0) _fails=0 ;;
      4) printf '%s\n' "${_out:-LEASE_LOST rc=4}" > "$_lf"; exit 4 ;;
      *) [ -s "$_sf" ] || exit 0
         _fails=$((_fails + 1))
         # 3분 넘게 서버에 닿지 못하면 이미 만료돼 다른 곳이 가져갔을 수 있다. 소유를 장담할 수 없으니 잃은 것으로 다룬다.
         [ "$_fails" -lt 3 ] || { printf 'LEASE_UNREACHABLE rc=%s\n' "$_rc" > "$_lf"; exit 6; } ;;
    esac
    _t=0
    while [ "$_t" -lt "$_iv" ]; do
      sleep "$_st"; _t=$((_t + _st))
      lease_pid_alive "$_pid" || break
      [ -s "$_sf" ] || break
    done
  done
}

cmd_lease() {
  _sub="${1:-}"; [ $# -gt 0 ] && shift
  case "$_sub" in
    holder) lease_holder || die 6 "LEASE_HOLDER PC ID 나 리포 경로를 정하지 못했다" ;;
    acquire) lease_acquire "$@" ;;
    renew) lease_renew ;;
    release) lease_release ;;
    keep) lease_keep "$@" ;;
    *) usage ;;
  esac
}
