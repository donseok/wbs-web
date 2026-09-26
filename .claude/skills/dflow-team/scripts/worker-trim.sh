#!/bin/sh
# worker-trim.sh — 팀원 전용 설정(<id8>.settings.json)에 합칠 "첫 턴 컨텍스트 줄이기" 조각을 만든다.
# 부르는 곳: ../references/backends.md 「팀원 워크트리 준비」 블록(tmux·Orca·재개·재투입 공통). 근거: ../references/rationale.md
# 「팀원 첫 턴 컨텍스트 줄이기」.
#
# 모든 줄이기는 PC별 opt-in 이다. .dflow.local(개인 설정)에 아래 키가 없으면 {} 를 내 지금과 똑같이 동작한다(켜진
# 플러그인을 전부 false 로 덮는 종전 규칙은 부르는 블록에 그대로 있다).
#   worker_keep_skills=<쉼표 목록>   사용자 스킬(~/.claude/skills) 가운데 남길 것. 나머지 사용자 스킬은 끄고, claude.ai
#                                    동기화 스킬도 숨긴다. 남길 것이 없으면 none. auto 를 넣으면(예 auto, auto,foo) 이 PC 의
#                                    사용자 전역 지침(~/.claude/CLAUDE.md 와 그 안의 @ 포함 파일, 5단계까지)에 이름(폴더
#                                    이름이나 머리말 name)이 나오는 사용자 스킬을 남긴다 — 브라우저 스킬처럼 PC 마다 다른 것을
#                                    킷에 이름 없이 남기려는 것이다. 남긴 이름은 stderr 에 WORKER_SKILLS_AUTO kept=<목록> 한 줄.
#                                    CLAUDE.md 가 없거나 못 읽으면 사용자 스킬을 하나도 끄지 않는다(안전한 쪽).
#   worker_skills_off=<쉼표 목록>    그 밖에 끌 스킬 이름(예: Claude Code 내장 스킬). 이름으로만 끈다.
#   worker_keep_plugins=<쉼표 목록>  켜 둘 플러그인(<이름>@<마켓>). 나머지는 종전대로 끄고, claude.ai 동기화 플러그인도
#                                    숨긴다. 남길 것이 없으면 none. auto 를 넣으면 사용자 전역 지침에 이름(<이름> 또는
#                                    <이름>@<마켓>)이 나오는 켜진 플러그인을 켜 둔다(stderr WORKER_PLUGINS_AUTO kept=<목록>).
#                                    지침을 못 읽으면 auto 로는 아무것도 더하지 않는다(종전 규칙 — 나머지는 끈다).
# auto 판정(스킬·플러그인 공통): 지침 본문을 문장(". " 뒤)으로 나누고, 부정 문장(않·금지·말고·말 것·마라·don't·do not·never·
# avoid 가 든 문장)은 뺀 뒤, 이름이 낱말로(대소문자 무시) 나오는지 본다 — "X 를 먼저 고르지 않는다" 가 X 를 켜지 않게.
# 플러그인은 더 좁다: <이름>@<마켓> 전체가 나오거나, 플러그인·plugin·MCP 가 함께 든 문장에 이름이 나올 때만 — 짧은 플러그인
# 이름이 일반 낱말(예 dev)과 겹쳐 잘못 켜지는 것을 막는다(2026-09-26 이 킷 개발 PC 실측).
# 지침 문장에 claude-in-chrome 이 나오면(부정 문장 제외) <MCP 출력 폴더>/<id8>.chrome 표지를 만들어 .dflow-run 이 --no-chrome 을
# 빼게 한다. 켜 둔 플러그인이 MCP 서버를 제공하면(<설치 폴더>/.mcp.json, 또는 .claude-plugin/plugin.json 의 mcpServers)
# 그 서버들만 담은 <id8>.mcp.json 을 만든다 — 팀원은 --strict-mcp-config 로 뜨므로 플러그인 MCP 가 죽는다(2026-09-26 실측).
# .dflow-run 이 --mcp-config 로 넘긴다(도구 이름은 mcp__<서버>__* 로 바뀐다).
#   worker_output_style=<값>         팀원의 출력 스타일(예: default).
# 킷이 아는 스킬 이름은 dflow-* 뿐이다. dflow-* 와 대상 리포의 프로젝트 스킬(<MAIN>/.claude/skills)은 어떤 목록에 적혀도
# 끄지 않는다(끄는 키가 이름이라 같은 이름의 프로젝트 스킬까지 꺼지기 때문이다).
# 설정이 가리키는 스킬·플러그인·스타일이 이 PC 에 없으면 경고 한 줄(stderr)만 내고 진행한다.
#
# 사용법: worker-trim.sh <MAIN> [<끌 플러그인 JSON — 종전 규칙이 만든 {"a@b": false, …}>] [<MCP 출력 접두 — 예 ~/.dflow/limits/<id8>>]
# 셋째 인자가 있으면 <접두>.mcp.json·<접두>.chrome 을 먼저 지우고(지난 실행의 것), 필요할 때만 다시 만든다.
# 출력(stdout): 부르는 쪽이 종전 설정 위에 덮어 합칠 조각 JSON 한 줄. 늘 exit 0. 무엇이 실패하든 {} 를 내 종전 동작으로
# 떨어진다. worker_keep_plugins 가 있으면 enabledPlugins 를 켜 둘 것을 뺀 맵으로 통째로 바꿔 낸다(빈 맵일 수 있다).
set -u
MAIN=${1:-.}
P=${2:-'{}'}
OUTP=${3:-}
[ -z "$OUTP" ] || rm -f "$OUTP.mcp.json" "$OUTP.chrome" 2>/dev/null
printf '%s' "$P" | jq -e 'type == "object"' >/dev/null 2>&1 || P='{}'
fallback() { echo '{}'; exit 0; }
command -v jq >/dev/null 2>&1 || { echo '{}'; exit 0; }

# 설정 읽기: 이미 export 된 env > .dflow.local(규칙은 dflow-config.sh 머리말). 실패하면 env 만 쓴다.
CFG="$(dirname "$0")/../../dflow-work/scripts/dflow-config.sh"
if [ -f "$CFG" ]; then
  DFLOW_CONFIG_DIR=$MAIN; export DFLOW_CONFIG_DIR
  . "$CFG" 2>/dev/null && dflow_config_load >/dev/null 2>&1 || :
fi
list() { printf '%s' "$1" | tr ',' '\n' | tr -d ' \r' | sed '/^$/d'; }
KS=$(list "${DFLOW_WORKER_KEEP_SKILLS:-}")
KO=$(list "${DFLOW_WORKER_SKILLS_OFF:-}")
KP=$(list "${DFLOW_WORKER_KEEP_PLUGINS:-}")
ST=$(printf '%s' "${DFLOW_WORKER_OUTPUT_STYLE:-}" | tr -d ' \r')

# 스킬 이름: 폴더 이름과 SKILL.md 머리말의 name 둘 다(어느 쪽으로 불려도 걸리게). 심링크 폴더도 따라간다.
names() {
  find -L "$1" -mindepth 2 -maxdepth 2 -name SKILL.md 2>/dev/null | while IFS= read -r f; do
    basename "$(dirname "$f")"
    sed -n 's/^name:[[:space:]]*//p' "$f" | head -n 1 | tr -d '\r"'\'' '
  done | sed '/^$/d'
}
PN=$(names "$MAIN/.claude/skills")
UN=''
[ -z "$KS" ] || UN=$(names "$HOME/.claude/skills")

# auto: 사용자 전역 지침에 이름이 나오는 사용자 스킬을 남길 목록에 더한다
guide_text() { # ~/.claude/CLAUDE.md 와 @ 포함 파일(상대 경로는 포함한 파일의 폴더 기준, ~/ 는 홈) 본문. 없으면 1
  _q="$HOME/.claude/CLAUDE.md"; [ -r "$_q" ] || return 1
  _seen=''; _d=0
  while [ -n "$_q" ] && [ "$_d" -le 5 ]; do
    _next=''
    for _f in $_q; do
      case " $_seen " in *" $_f "*) continue ;; esac
      _seen="$_seen $_f"; [ -r "$_f" ] || continue
      cat "$_f"; echo
      _dir=$(dirname "$_f")
      for _i in $(grep -o '\(^\|[[:space:]]\)@[^[:space:]]*' "$_f" 2>/dev/null | sed 's/^[[:space:]]*@//; s/[.,;:)]*$//'); do
        case "$_i" in '~/'*) _i="$HOME/${_i#\~/}" ;; /*) ;; *) _i="$_dir/$_i" ;; esac
        [ -r "$_i" ] && _next="$_next $_i"
      done
    done
    _q=$_next; _d=$((_d + 1))
  done
}
# 지침을 문장으로 나누고 부정 문장을 뺀 본문(auto 판정 재료). 지침이 없으면 1
guide_positive() {
  _g=$(guide_text) && [ -n "$_g" ] || return 1
  printf '%s\n' "$_g" | sed 's/\. /.\
/g' | grep -viE "않|금지|말고|말 것|마라|don't|do not|never|avoid" || :
}
GA=''; GOK=0
if printf '%s\n%s\n' "$KS" "$KP" | grep -qxF auto; then
  if GA=$(guide_positive); then GOK=1; fi
fi
if printf '%s\n' "$KS" | grep -qxF auto; then
  if [ "$GOK" = 1 ]; then G=$GA
    AK=$(find -L "$HOME/.claude/skills" -mindepth 2 -maxdepth 2 -name SKILL.md 2>/dev/null | while IFS= read -r f; do
      d=$(basename "$(dirname "$f")")
      n=$(sed -n 's/^name:[[:space:]]*//p' "$f" | head -n 1 | tr -d '\r"'\'' ')
      if printf '%s' "$G" | grep -qiwF -- "$d" || { [ -n "$n" ] && printf '%s' "$G" | grep -qiwF -- "$n"; }; then
        printf '%s\n' "$d"; [ -z "$n" ] || printf '%s\n' "$n"
      fi
    done | sort -u)
    echo "WORKER_SKILLS_AUTO kept=$(printf '%s' "$AK" | tr '\n' ',' | sed 's/,$//' | grep . || echo -)" >&2
    KS=$(printf '%s\n%s\n' "$KS" "$AK" | grep -vxF auto | sed '/^$/d')
    [ -n "$KS" ] || KS=none
  else
    # 지침을 못 읽으면 어떤 사용자 스킬도 끄지 않는다 — 사용자 스킬 줄이기 자체를 건너뛴다
    echo "WORKER_SKILLS_AUTO kept=- — ~/.claude/CLAUDE.md 를 읽지 못해 사용자 스킬을 끄지 않는다" >&2
    KS=''; UN=''
  fi
fi

# 플러그인 auto: 지침에 이름이 나오는 켜진 플러그인(종전 규칙이 끄려던 키)을 켜 둘 목록에 더한다
if printf '%s\n' "$KP" | grep -qxF auto; then
  AP=''
  if [ "$GOK" = 1 ]; then
    # 이름만으로는 일반 낱말(dev 등)에 걸린다 — <이름>@<마켓> 전체가 나오거나, 플러그인·plugin·MCP 가 함께 나오는 문장에 이름이 있을 때만
    GP=$(printf '%s\n' "$GA" | grep -iE '플러그인|plugin|mcp' || :)
    AP=$(printf '%s' "$P" | jq -r 'keys[]' 2>/dev/null | while IFS= read -r k; do
      n=${k%%@*}
      if printf '%s' "$GA" | grep -qiwF -- "$k" || printf '%s' "$GP" | grep -qiwF -- "$n"; then printf '%s\n' "$k"; fi
    done)
    echo "WORKER_PLUGINS_AUTO kept=$(printf '%s' "$AP" | tr '\n' ',' | sed 's/,$//' | grep . || echo -)" >&2
  else
    echo "WORKER_PLUGINS_AUTO kept=- — ~/.claude/CLAUDE.md 를 읽지 못해 auto 로 켜 둘 플러그인이 없다" >&2
  fi
  KP=$(printf '%s\n%s\n' "$KP" "$AP" | grep -vxF auto | sed '/^$/d')
  [ -n "$KP" ] || KP=none
fi

# MCP·chrome — 켜 둔 플러그인의 MCP 서버를 <접두>.mcp.json 으로, 지침이 요구하면 chrome 표지
if [ -n "$OUTP" ] && [ -n "$KP" ] && [ "$KP" != none ]; then
  IP="$HOME/.claude/plugins/installed_plugins.json"
  MC=$(printf '%s\n' "$KP" | while IFS= read -r k; do
    [ "$k" = none ] && continue
    d=$(jq -r --arg k "$k" '.plugins[$k][0].installPath // empty' "$IP" 2>/dev/null)
    [ -n "$d" ] && [ -d "$d" ] || continue
    for f in "$d/.mcp.json" "$d/.claude-plugin/plugin.json"; do
      [ -f "$f" ] || continue
      jq -c --arg root "$d" 'if (type == "object" and has("mcpServers")) then .mcpServers
          elif ((input_filename // "") | endswith("plugin.json")) then {} else . end
        | if type == "object" then . else {} end
        | walk(if type == "string" then gsub("\\$\\{CLAUDE_PLUGIN_ROOT\\}"; $root) else . end)' "$f" 2>/dev/null
    done
  done | jq -sc 'add // {}' 2>/dev/null)
  if [ -n "$MC" ] && [ "$MC" != '{}' ] && [ "$MC" != null ]; then
    printf '%s' "$MC" | jq '{mcpServers: .}' > "$OUTP.mcp.json" 2>/dev/null || rm -f "$OUTP.mcp.json"
  fi
fi
if [ -n "$OUTP" ] && [ "$GOK" = 1 ] && printf '%s' "$GA" | grep -qiwF -- claude-in-chrome; then
  : > "$OUTP.chrome" 2>/dev/null && echo "WORKER_CHROME_AUTO on — 지침이 claude-in-chrome 을 쓴다(--no-chrome 을 뺀다)" >&2
fi

# 경고 — 가리키는 대상이 이 PC 에 없다. 줄이기는 그대로 진행한다.
if [ -n "$KS" ]; then
  printf '%s\n' "$KS" | while IFS= read -r s; do
    case "$s" in none|auto|dflow-*) continue ;; esac
    printf '%s\n%s\n' "$UN" "$PN" | grep -qxF -- "$s" || echo "WORKER_SKILL_NOT_FOUND $s — worker_keep_skills 의 스킬이 이 PC 에 없다(무시하고 진행)" >&2
  done
fi
if [ -n "$KP" ] && [ "${DFLOW_WORKER_PLUGINS-}" != keep ]; then
  printf '%s\n' "$KP" | while IFS= read -r s; do
    case "$s" in none|auto) continue ;; esac
    printf '%s' "$P" | jq -e --arg k "$s" 'has($k)' >/dev/null 2>&1 \
      || echo "WORKER_PLUGIN_NOT_FOUND $s — worker_keep_plugins 의 플러그인이 이 PC 에서 켜져 있지 않다(무시하고 진행)" >&2
  done
fi
if [ -n "$ST" ] && [ "$ST" != default ] && [ ! -f "$HOME/.claude/output-styles/$ST.md" ] && [ ! -f "$MAIN/.claude/output-styles/$ST.md" ]; then
  echo "WORKER_OUTPUT_STYLE_NOT_FOUND $ST — 스타일 파일이 없다(내장 스타일이면 무시해도 된다. 그대로 넘긴다)" >&2
fi

OUT=$(jq -nc --argjson p "$P" --arg ks "$KS" --arg un "$UN" --arg ko "$KO" --arg kp "$KP" --arg pn "$PN" --arg st "$ST" \
  --arg pk "${DFLOW_WORKER_PLUGINS-}" '
  def lines: split("\n") | map(select(length > 0));
  def has_in($xs): . as $s | $xs | any(.[]; . == $s);
  ($pn | lines) as $proj | ($ks | lines) as $keep | ($kp | lines) as $keepP
  | ($p | with_entries(select(.key | has_in($keepP) | not))) as $plugins
  | ((if $keep | length > 0 then ($un | lines | map(select(has_in($keep) | not))) else [] end)
      + ($ko | lines)
      | map(select((startswith("dflow-") or has_in($proj)) | not)) | unique | map({key: ., value: "off"}) | from_entries) as $off
  | (if ($keepP | length) > 0 and ($p | length) > 0 then {enabledPlugins: $plugins} else {} end)
    + (if ($keepP | length) > 0 and $pk != "keep" then {syncClaudeAiPlugins: false} else {} end)
    + (if ($off | length) > 0 then {skillOverrides: $off} else {} end)
    + (if ($keep | length) > 0 then {syncClaudeAiSkills: false} else {} end)
    + (if $st != "" then {outputStyle: $st} else {} end)' 2>/dev/null) || fallback
[ -n "$OUT" ] || fallback
printf '%s\n' "$OUT"
