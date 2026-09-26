#!/bin/sh
# worker-trim.sh — 팀원 전용 설정(<id8>.settings.json)에 합칠 "첫 턴 컨텍스트 줄이기" 조각을 만든다.
# 부르는 곳: ../references/backends.md 「팀원 워크트리 준비」 블록(tmux·Orca·재개·재투입 공통). 근거: ../references/rationale.md
# 「팀원 첫 턴 컨텍스트 줄이기」.
#
# 모든 줄이기는 PC별 opt-in 이다. .dflow.local(개인 설정)에 아래 키가 없으면 {} 를 내 지금과 똑같이 동작한다(켜진
# 플러그인을 전부 false 로 덮는 종전 규칙은 부르는 블록에 그대로 있다).
#   worker_keep_skills=<쉼표 목록>   사용자 스킬(~/.claude/skills) 가운데 남길 것. 나머지 사용자 스킬은 끄고, claude.ai
#                                    동기화 스킬도 숨긴다. 남길 것이 없으면 none.
#   worker_skills_off=<쉼표 목록>    그 밖에 끌 스킬 이름(예: Claude Code 내장 스킬). 이름으로만 끈다.
#   worker_keep_plugins=<쉼표 목록>  켜 둘 플러그인(<이름>@<마켓>). 나머지는 종전대로 끄고, claude.ai 동기화 플러그인도
#                                    숨긴다. 남길 것이 없으면 none.
#   worker_output_style=<값>         팀원의 출력 스타일(예: default).
# 킷이 아는 스킬 이름은 dflow-* 뿐이다. dflow-* 와 대상 리포의 프로젝트 스킬(<MAIN>/.claude/skills)은 어떤 목록에 적혀도
# 끄지 않는다(끄는 키가 이름이라 같은 이름의 프로젝트 스킬까지 꺼지기 때문이다).
# 설정이 가리키는 스킬·플러그인·스타일이 이 PC 에 없으면 경고 한 줄(stderr)만 내고 진행한다.
#
# 사용법: worker-trim.sh <MAIN> [<끌 플러그인 JSON — 종전 규칙이 만든 {"a@b": false, …}>]
# 출력(stdout): 부르는 쪽이 종전 설정 위에 덮어 합칠 조각 JSON 한 줄. 늘 exit 0. 무엇이 실패하든 {} 를 내 종전 동작으로
# 떨어진다. worker_keep_plugins 가 있으면 enabledPlugins 를 켜 둘 것을 뺀 맵으로 통째로 바꿔 낸다(빈 맵일 수 있다).
set -u
MAIN=${1:-.}
P=${2:-'{}'}
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

# 경고 — 가리키는 대상이 이 PC 에 없다. 줄이기는 그대로 진행한다.
if [ -n "$KS" ]; then
  printf '%s\n' "$KS" | while IFS= read -r s; do
    case "$s" in none|dflow-*) continue ;; esac
    printf '%s\n%s\n' "$UN" "$PN" | grep -qxF -- "$s" || echo "WORKER_SKILL_NOT_FOUND $s — worker_keep_skills 의 스킬이 이 PC 에 없다(무시하고 진행)" >&2
  done
fi
if [ -n "$KP" ] && [ "${DFLOW_WORKER_PLUGINS-}" != keep ]; then
  printf '%s\n' "$KP" | while IFS= read -r s; do
    [ "$s" = none ] && continue
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
