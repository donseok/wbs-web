# /dflow-team 백엔드: spawn·정리 명령 정본

SKILL.md 「0. 환경 감지」 가 백엔드를 고른다. 워커 프롬프트·`.result` 계약·`/dflow-dev --worker` 는 두
백엔드가 같다. 백엔드가 가르는 것은 아래 차이표의 항목뿐이다.

백엔드는 둘이다. 팀장이 Orca 안에 있으면 **pane(Orca)** 를 쓰고, Orca 밖이면 **pane(tmux)** 를 쓴다.

## 차이표

| 항목 | pane(tmux) | pane(Orca) |
|---|---|---|
| 팀원 정체 | 팀장이 tmux pane 에 띄운 대화형 claude 메인 에이전트(권한 확인 생략 모드) | Orca 탭의 claude 메인 에이전트(권한 확인 생략 모드) |
| 워크트리 | 팀장이 `git worktree add --detach` 로 `<MAIN>/.claude/worktrees/dflow-<id8>` 를 `origin/<기본브랜치>` 기점으로 만든다. 브랜치를 만들지 않는다 | **같다**(2026-09-24 실측 이후 — 「팀원 워크트리 준비」가 두 백엔드 공통). 옛 방식(`orca worktree create`)이 리포 루트 바로 아래 `<MAIN>/dflow-<id8>` 에 만들고 브랜치 `<사용자>/dflow-<id8>` 도 만든 워크트리가 아직 남아 있을 수 있으며, 그 구분은 「고아 정리 규칙」 전환 규칙이 가른다. 전제 검사의 exclude `/dflow-*/` 는 그 옛 워크트리를 가리기 위해 남긴다 |
| 기상 신호 | 감시 루프의 `RESULT_READY`·`PANE_DEAD` | 감시 루프의 `RESULT_READY` |
| `blocked` 이후 | 팀원은 pane 에서 멈춰 기다린다 | 팀원은 탭에서 멈춰 기다린다 |
| 슬롯 점유 | `blocked` 동안 슬롯을 계속 잡는다 | 같다 |
| 사람의 답 | 그 pane 에 직접 치거나, 팀장이 `send-keys` 로 넣는다 | 그 팀원 탭에 직접 준다 |
| 회수 | 결과 줄 처리 뒤 `kill-pane -t <pane>` | 결과 줄 처리 뒤 `orca terminal close --terminal <handle> --tab --json`(핸들이 `-` 면 건너뜀. 2026-09-24부터 — 예전에는 회수하지 않았다) |
| 팀장 세션이 죽으면 | 팀원은 살아남는다(tmux 서버가 따로 돈다). 새 팀장이 재구성에서 `.dflow-pane` 과 `#{pane_start_path}` 로 흡수한다 | 팀원은 살아남는다 |
| 정리 | `git worktree remove --force <경로>` | 새 방식(git worktree add)이면 tmux 와 같다. 옛 방식(`orca worktree create`, 리포 루트 워크트리)만 `orca worktree rm --worktree path:<경로>`(「pane(Orca)」 「정리」의 전환 규칙) |
| 팀원 화면 | `capture-pane -p -t <pane>`(보고용), `-J -S -`(결과 줄 폴백) | `orca terminal read`(보고용). 신뢰 확인 판별에도 쓴다(「pane(Orca)」) |
| git 호출 | `command -v git` 절대경로 | 같다(두 백엔드 공통) |

## 입장 제어

**모든 spawn 의 첫 단계다**(두 백엔드 공통). 새 작업·재개·재투입·해소·차단기의 시험 spawn 모두 여기를 지난다. 판정
기준과 알림 규칙의 정본은 SKILL.md 「5-3. 입장 제어」 이고, 집행은 이 블록 한 곳이다. 팀장 체크아웃에서 돈다.
```bash
CAP=$(.claude/skills/dflow-team/scripts/capacity.sh --state "$(git rev-parse --git-path dflow-team.capacity)"); echo "$CAP"
case "$CAP" in CAPACITY_LOW*) echo SPAWN_DEFERRED_CAPACITY; exit 0 ;; esac
```
- `SPAWN_DEFERRED_CAPACITY` 가 나오면 **이번 기상에는 아무것도 띄우지 않는다.** 블록은 그 자리에서 끝나 워크트리·pane·
  포인터를 하나도 만들지 않는다. 후보는 원래 줄(대기 큐·재개 목록·해소 큐·재시작 대기)에 그대로 두고 `team.spawn`·
  `team.result` 를 쓰지 않는다. 한 후보가 막히면 같은 기상의 나머지 후보도 띄우지 않는다(자원은 후보마다 다르지 않다).
- `CAPACITY_OK`·`CAPACITY_UNKNOWN` 이면 이어서 띄운다. 출력 줄 끝이 `notify=1` 이면 SKILL.md 「5-3」 의 한 줄 알림을 낸다.
- 새 작업·해소의 spawn 블록(아래 「팀원 워크트리 준비」, 두 백엔드 공통)은 이 두 줄로 시작하므로 따로 부르지 않는다.
  merge-conflict.md 「2」 의 해소 spawn 도 그 블록을 그대로 돌리므로 여기에 걸린다(tmux·Orca 모두). 블록을 통째로
  돌지 않는 자리 — 재개(SKILL.md 「5-1」 0항)와 재투입(restart.md 「재투입」) — 는 이 블록을 먼저 따로 돈다. 이유:
  그 둘은 워크트리를 새로 만들지 않고 있는 것을 이어 쓰므로, 준비 블록 전체를 다시 돌 필요가 없다(2026-09-24 이전에는
  Orca 의 `orca worktree create` 를 결과 JSON 과 한 호출로 묶으면 이 두 줄의 출력이 JSON 앞에 섞여 `jq` 해석이
  깨진다는 이유로 Orca spawn 도 따로 돌았으나, 이제 Orca spawn 도 `orca terminal create` 의 JSON 을 변수로 받아
  그 변수만 `jq` 하므로 — 「pane(Orca)」 — 이 문제가 없다).

## pane(tmux)

팀원은 팀장이 전용 tmux 소켓(`-L dflow`)의 pane 에 띄운 **대화형** claude 메인 에이전트다. Agent 도구
서브에이전트로 띄우지 않는다. 이유: 서브에이전트는 자기 턴이 끝나면 하네스가 완료로 보고, 그 뒤에 끝난 Phase
손자의 완료가 서브에이전트를 깨우지 못해 Phase 손자를 기다리다 멈춘다(리허설 실측). 별도 프로세스의 메인
에이전트는 손자 완료 알림으로 다시 깨어나고(실측), 팀장 세션이 죽어도 살아남는다.

### 진짜 tmux 찾기

Orca 는 PATH 앞에 tmux shim 을 끼운다. 그 shim 은 `orca agent-teams-tmux` 로 위임하는 셸 스크립트이며,
Claude Code 자체 에이전트 팀이 쓰는 부분집합만 처리하고 나머지를 `unsupported command` 로 거부한다.
**`tmux -V` 는 거짓 버전을 답하므로** 버전으로는 가릴 수 없다(실측: shim 이 `3.4`, 실제 바이너리가 `3.7c`).

```bash
find_tmux() {
  for c in /opt/homebrew/bin/tmux /usr/local/bin/tmux /usr/bin/tmux "$(command -v tmux 2>/dev/null)"; do
    [ -n "$c" ] && [ -x "$c" ] || continue
    grep -q 'agent-teams-tmux' "$c" 2>/dev/null && continue
    "$c" -L "dflowprobe$$" has-session -t __probe__ 2>&1 | grep -qi 'unsupported command' && continue
    printf '%s\n' "$c"; return 0
  done
  return 1
}
```

두 겹으로 거른다. 스크립트 내용에서 `agent-teams-tmux` 를 찾는 것이 첫째이고, 실제로 명령을 던져
`unsupported command` 가 돌아오는지 보는 것이 둘째다. probe 소켓 이름에 `$$` 를 붙이는 이유는 운영 소켓
`dflow` 를 건드리지 않기 위해서다. 찾은 절대경로는 `TM` 에 담아 이후 모든 호출에 쓴다. 팀장이 Orca 안에
있어도 절대경로로 부르면 shim 을 그냥 지나친다(실측).

**spawn**: 워크트리 준비는 팀장 체크아웃에서 한 번의 Bash 호출로 돌린다. **이 블록은 `chmod +x
"$WT/.dflow-run"` 줄까지 두 백엔드가 글자 그대로 같다** — Orca(「pane(Orca)」)는 같은 블록을 여기까지 그대로
돌린 뒤 그 아래만 `orca terminal create` 로 다르게 잇는다(2026-09-24 실측 이후. 옛 문서는 Orca 가 `orca worktree
create --agent claude` 로 띄워 이 블록을 쓰지 않았다). `<모델 플래그>` 는 `MODEL` 이
`opus`·`sonnet` 이면 `--model opus`·`--model sonnet`, `default` 면 빈 값이다. `<EFFORT>` 는 SKILL.md 「인자」
가 정한 추론 강도다(기본 `high`). 팀장 세션의 `CLAUDE_EFFORT` 는 아래에서 벗기므로 팀원은 이 플래그가 없으면 그
PC 의 `effortLevel` 설정을 따른다(Orca 도 이제 같다 — `.dflow-run` 의 `claude` 호출에 같은 플래그가 붙으므로,
Orca 가 그 PC 의 `effortLevel` 만 따르던 옛 제약은 없어졌다). PC 마다 값이 달라 기본값도 명시한다. 첫 두 줄은
「입장 제어」 블록 그대로이며 빼지 않는다. `SPAWN_DEFERRED_CAPACITY` 로 끝나면 워크트리도 pane 도(Orca 는 탭도)
만들지 않은 것이다.

```bash
CAP=$(.claude/skills/dflow-team/scripts/capacity.sh --state "$(git rev-parse --git-path dflow-team.capacity)"); echo "$CAP"
case "$CAP" in CAPACITY_LOW*) echo SPAWN_DEFERRED_CAPACITY; exit 0 ;; esac
TM=$(find_tmux)
WT="<MAIN>/.claude/worktrees/dflow-<id8>"
git fetch -q origin && git worktree prune && git worktree add --detach "$WT" origin/<기본브랜치> || echo SPAWN_FAILED_WORKTREE
[ -e "$WT/.dflow.local" ] || [ ! -e "<MAIN>/.dflow.local" ] || ln -s "<MAIN>/.dflow.local" "$WT/.dflow.local"
[ -e "$WT/.dflow" ] || [ ! -e "<MAIN>/.dflow" ] || ln -s "<MAIN>/.dflow" "$WT/.dflow"
[ ! -e "<MAIN>/.env" ] || [ -e "$WT/.env" ] || ln -s "<MAIN>/.env" "$WT/.env"
if [ ! -e "$WT/.claude/skills/dflow-dev/SKILL.md" ]; then
  if [ -d "$WT/.claude/skills" ] && [ ! -L "$WT/.claude/skills" ]; then
    for s in dflow-dev dflow-work; do [ -e "$WT/.claude/skills/$s" ] || ln -s "<MAIN>/.claude/skills/$s" "$WT/.claude/skills/$s"; done
  else
    mkdir -p "$WT/.claude" && ln -s "<MAIN>/.claude/skills" "$WT/.claude/skills"
  fi
fi
printf '%s\n' '<포인터 한 줄>' > "$WT/.dflow-prompt"
cat > "$WT/.dflow-run" <<'RUNEOF'
#!/bin/sh
# 팀장 세션의 흔적을 벗긴다. 근거는 아래 「팀원 환경을 벗기는 이유」.
for v in $(env | sed -n 's/^\(CLAUDE[A-Z0-9_]*\)=.*/\1/p'); do
  case "$v" in CLAUDE_CONFIG_DIR) continue ;; esac
  unset "$v"
done
if [ -n "${ORCA_AGENT_TEAMS_TEAM_ID-}" ]; then
  for v in $(env | sed -n 's/^\(ORCA_[A-Z0-9_]*\)=.*/\1/p'); do unset "$v"; done
  unset TMUX TMUX_PANE
  PATH=$(printf '%s' "$PATH" | tr ':' '\n' | grep -v 'claude-agent-teams-bin' | paste -sd: -)
  export PATH
fi
RUNEOF
if [ "${DFLOW_WORKER_PLUGINS-}" = keep ]; then
  P='{}'
else
  P='{}'
  for f in "$HOME/.claude/settings.json" "<MAIN>/.claude/settings.json" "<MAIN>/.claude/settings.local.json"; do
    [ -f "$f" ] || continue
    q=$(jq -c --argjson p "$P" \
      '$p + ((.enabledPlugins // {}) | if type == "object" then with_entries(select(.value == true) | .value = false) else {} end)' \
      "$f" 2>/dev/null) && P="$q"
  done
fi
LIM="$HOME/.dflow/limits"; mkdir -p "$LIM"
jq -n --arg f "$LIM/<id8>.json" --argjson plugins "$P" \
  '{statusLine: {type: "command", command: ("jq -c \"{at: (now | floor), rate_limits: (.rate_limits // null)}\" > \"" + $f + ".tmp\" && mv -f \"" + $f + ".tmp\" \"" + $f + "\"; printf dflow")}}
   + (if ($plugins | length) > 0 then {enabledPlugins: $plugins} else {} end)' \
  > "$LIM/<id8>.settings.json"
cat >> "$WT/.dflow-run" <<'RUNEOF'
S="$HOME/.dflow/limits/<id8>.settings.json"
if [ "${DFLOW_WORKER_MCP-}" = keep ]; then set --; else set -- --no-chrome --strict-mcp-config; fi
[ -f "$S" ] && exec claude --dangerously-skip-permissions --settings "$S" "$@" --effort <EFFORT> <모델 플래그> "$(cat .dflow-prompt)"
exec claude --dangerously-skip-permissions "$@" --effort <EFFORT> <모델 플래그> "$(cat .dflow-prompt)"
RUNEOF
chmod +x "$WT/.dflow-run"
if "$TM" -L dflow has-session -t dflow 2>/dev/null; then
  PANE=$("$TM" -L dflow split-window -t dflow -c "$WT" -P -F '#{pane_id}' './.dflow-run')
else
  "$TM" -L dflow new-session -d -s dflow -n dflow -x 200 -y 60 -c "$WT" './.dflow-run'
  "$TM" -L dflow set-option -t dflow remain-on-exit on
  "$TM" -L dflow set-option -w -t dflow pane-border-status top
  "$TM" -L dflow set-option -w -t dflow pane-border-format ' #{pane_title} '
  PANE=$("$TM" -L dflow list-panes -t dflow -F '#{pane_id}' | head -1)
fi
"$TM" -L dflow set-option -p -t "$PANE" allow-set-title off
"$TM" -L dflow select-pane -t "$PANE" -T 'w<slot> · <TSK> <id8> · <작업 이름>'
"$TM" -L dflow select-layout -t dflow tiled
printf '%s\n' "$PANE" > "$WT/.dflow-pane"
cat "$WT/.dflow-pane"
```
`<id8>`·`<모델 플래그>` 는 팀장이 글자 그대로 바꿔 쓴다(heredoc 은 따옴표로 막아 `$S`·`$HOME` 이 팀원 실행 시점에 풀린다).
설정 파일 경로를 실행 시점에 다시 만들고 없으면 `--settings` 없이 띄우는 이유: Claude Code 2.1.280 은 없는 설정 파일을
받으면 `Settings file not found` 로 곧바로 끝난다. 팀장의 Bash 호출은 변수를 이어받지 않으므로 「5-1」 이 `.dflow-run` 을
다시 쓸 때 `LIM` 줄을 빠뜨리면 경로가 비고, 그러면 재시작한 팀원이 전부 첫 화면에서 죽어 상한 3 에서 멈춘다.

- **팀원 전용 설정(플러그인·MCP 끄기, 2026-09-24)**: spawn 시점에 `~/.claude/settings.json`·
  `<MAIN>/.claude/settings.json`·`<MAIN>/.claude/settings.local.json` 중 있는 파일의 `enabledPlugins` 에서 값이
  `true` 인 키를 모아 전부 `false` 로 덮어 `<id8>.settings.json` 에 합친다. 목록을 하드코딩하지 않는 이유: 이 문서는
  킷으로 다른 PC 에 배포되며 PC 마다 켜 둔 플러그인이 다르다 — 특정 플러그인 이름을 이 문서에 적지 않는다.
  파일이 없거나 jq 가 읽지 못하면 그 파일만 건너뛴다 — 하나가 깨졌다고 statusLine 설정 자체가 안 만들어지면 안 된다.
  `.dflow-run` 의 두 `exec` 줄 모두 `--no-chrome --strict-mcp-config` 를 붙여 MCP 서버를 끈다(claude.ai 커넥터 포함).
  `--mcp-config` 는 쓰지 않는다 — 가변 인자라 바로 뒤의 프롬프트까지 설정 파일 경로로 먹어 `MCP config file not found`
  로 곧바로 끝난다(실측). `claude-in-chrome` 은 `--strict-mcp-config` 로는 안 빠지고 `--no-chrome` 으로 빠진다.
  실측(2026-09-24, sonnet 동일 조건 A/B): 첫 턴 프롬프트 65.3K → 54.2K 토큰(약 17%↓), SessionStart 훅 5 → 1, MCP 서버
  9종 → 0, 스킬 134 → 49. 전역 `~/.claude/settings.json` 의 훅(`PreToolUse` `rtk hook claude`, `PostToolUse` heartbeat)은
  `--settings` 로 덮지 않으므로 그대로 돈다 — **`--setting-sources` 는 쓰지 않는다.** 쓰면 user 설정의 heartbeat 훅이
  함께 빠져 좌석표가 이 팀원의 진척을 보지 못한다. 전역 `~/.claude/settings.json` 자체는 읽기만 하고 건드리지 않는다.
  사람이 끄고 싶지 않으면 `DFLOW_WORKER_PLUGINS=keep`(플러그인은 그대로 두고, 팀장 세션 환경에서 읽는다)·
  `DFLOW_WORKER_MCP=keep`(MCP·`claude-in-chrome` 도 그대로 두고, 팀원 실행 시점에 `.dflow-run` 이 읽는다)으로 각각
  되돌린다. 후자는 tmux pane 이면 팀장 환경을 물려받지만 Orca 새 탭은 로그인 셸 환경이므로 셸 프로필에 export 해야 한다. 이 블록(플러그인·MCP 끄기)을
  쓰는 곳은 tmux spawn(이 블록), Orca spawn(「pane(Orca)」), 「5-1. 재개 spawn」, `references/restart.md` 「재투입」
  넷이며, 모두 같은 「팀원 워크트리 준비」 블록을 그대로 돌려 얻는다.
- **statusLine 덤프**: `--settings` 로 붙인 statusLine 이 입력 JSON 의 `.rate_limits`(구독자일 때 `five_hour`·`seven_day`
  마다 `used_percentage`·`resets_at`)를 `~/.dflow/limits/<id8>.json` 에 쓴다. 팀장은 이것으로 한도와 해제 시각을
  정한다(`references/restart.md` 「한도 판정」). 워크트리 밖(`~/.dflow/limits`)에 쓰는 이유: 워크트리 안에 쓰면
  `git status --porcelain` 이 더러워져 `DIRTY` 검사와 「고아 정리 규칙」 2번이 깨진다. 임시 파일에 쓰고 옮기는 이유: 깨진
  입력이 반쯤 쓴 파일을 남기지 않게 한다. 팀원 pane 에서는 사람의 statusLine 설정이 이것으로 덮인다(표시는 `dflow`).
  「5-1. 재개 spawn」 도 `.dflow-run` 을 이 블록대로 새로 쓰므로 재개·재시작 팀원도 덤프를 남긴다. 파일은 지우지 않는다
  (작고, 같은 id8 을 다시 띄우면 덮어쓴다). **Orca 팀원도 이제 같은 블록을 쓰므로 덤프를 남긴다**(2026-09-24 이전에는
  Orca 가 `.dflow-run` 을 쓰지 않아 덤프가 없었다 — `references/restart.md` 「한도 판정」의 옛 문장은 이 전제로
  틀렸으므로 고친다).
- **전용 소켓 `-L dflow`** 라 팀장이 tmux 안이든 밖이든 코드 경로가 하나다. 사람의 기존 tmux 세션도 건드리지
  않는다. 서버가 없으면 `new-session`, 있으면 `split-window` 로 갈리는 분기 한 줄이 전부다.
- `-x 200 -y 60` 은 detached 동안의 가상 크기다. 사람이 붙으면 클라이언트 크기를 따른다. 팀장이
  `capture-pane` 으로 읽을 때 이 크기가 쓰이므로 좁게 두지 않는다.
- **pane 이름표**: `select-pane -T` 로 각 pane 에 `w<slot> · <TSK> <id8> · <작업 이름>` 을 붙이고,
  `pane-border-status top` 과 `pane-border-format` 으로 테두리에 그 제목을 띄운다. 두 `set-option` 은 window
  옵션이라 `-w` 가 필요하며 세션을 만들 때 한 번만 걸면 그 창의 모든 pane 에 적용된다. 이유: 이름표가 없으면
  `attach` 로 붙은 사람이 화면 N개를 받고도 어느 pane 이 어느 슬롯의 무슨 작업인지 알 수 없다. pane id
  (`%0`·`%2`)는 팀장의 장부에만 있고 화면에는 뜨지 않으며, 작업 이름은 스크롤아웃되면 사라진다. 슬롯 번호를
  앞에 두는 이유는 팀장의 보고·`events.jsonl` 의 `slot` 과 같은 축으로 읽히게 하기 위해서다.
- **`allow-set-title off` 를 `select-pane -T` 보다 먼저 건다.** 이것이 없으면 이름표가 붙자마자 지워진다.
  claude 는 터미널 제목 이스케이프 시퀀스로 자기 진행 상황을 pane 제목에 계속 쓰기 때문이다(실측: 붙여 둔
  이름표가 `◑ Worker-prompt 규칙 실행` 으로 덮였다). 이 옵션은 pane 옵션이라 `-p` 와 pane id 가 필요하고,
  세션이 아니라 **pane 마다** 걸어야 하므로 `split-window` 로 늘린 pane 에도 매번 건다. tmux 3.3 이상에서
  쓸 수 있다(이 주행의 실측 판본은 3.7c). 대가로 claude 가 제목에 싣던 진행 표시가 테두리에서 사라지지만,
  진행 상황은 pane 본문에 그대로 보이므로 슬롯 식별을 택한다.
- `remain-on-exit on` 은 죽은 pane 을 남긴다. 팀원이 무슨 말을 남기고 끝났는지 읽을 수 있고, 종료 코드도
  `#{pane_dead_status}` 로 얻는다.
- `exec` 로 셸을 claude 로 대체해 `pane_pid` 가 곧 claude 가 된다.
- **`exec` 줄만 heredoc 밖에서 `printf` 로 붙이는 이유**: `<모델 플래그>` 를 heredoc 안에 두고 치환을
  빠뜨리면 그 자리가 **입력 리다이렉션**이 되어(`< 모델`) 아무 오류 없이 엉뚱한 파일을 읽는다. `printf` 의
  인자로 넘기면 `default` 일 때 빈 문자열이 되어 그런 자리가 생기지 않는다.
- 팀원을 띄우는 명령을 `.dflow-run` 파일에 써 두는 이유: 셸 인용을 한 겹 줄이고, 사람이 pane 에서 무엇이
  돌고 있는지 읽을 수 있다. 프롬프트도 `.dflow-prompt` 파일 경유라 따옴표·백틱을 걱정하지 않는다.
- `claude "<프롬프트>"` 는 대화형 세션을 띄우면서 그 문자열을 첫 턴으로 제출한다(실측). `-p` 를 쓰지 않으므로
  세션은 대화형으로 남고, 사람이 화면을 보며 끼어들 수 있다.
- `.dflow.local`(레거시 `.env`)·`.dflow`·스킬 링크를 팀장이 먼저 만드는 이유: claude 는 시작할 때 cwd 의 `.claude/skills` 를 읽으므로, 링크가
  먼저 있어야 팀원의 Skill 도구가 `dflow-dev` 를 안다. 워커 부트스트랩(worker-prompt.md 「3」)의 같은 명령은
  이미 있으면 건너뛴다. 스킬 폴더가 실제 폴더로 있는데 `dflow-dev` 가 없으면 폴더째 링크하지 않고 워커가 쓰는
  스킬만 하나씩 링크한다(있는 폴더에 폴더째 링크를 걸면 `.claude/skills/skills` 가 생긴다).
- 그 밖에 메인 체크아웃에서 gitignore 된 심링크(예 리포 밖 설계 문서를 가리키는 `docs/mdm/design`)는 팀장이 걸지
  않는다. 워커의 `deps.sh`(dflow-dev 행 H)가 설계 Phase 전에 같은 상대 경로로 링크하고 `DEPS_LINK <경로>` 로
  알린다. spawn·재spawn·resolve 가 모두 `deps.sh` 를 지나므로 한 곳에서 맡는다.
- `.env` 도 메인 체크아웃에 있으면 함께 링크한다 — 이 PC 에 예전에 설치된 좌석표 heartbeat 훅
  (`~/.dflow/hooks/heartbeat.sh`)이 아직 구버전이면 `.dflow`·`.dflow.local` 을 모르고 `$_top/.env` 만 읽기
  때문이다. `dflow.sh`·`dflow-config.sh` 는 `.dflow`·`.dflow.local` 이 있으면 `.env` 를 읽지 않으므로 새
  스크립트 동작에는 영향이 없다.
- Windows(Git Bash) 에서는 `ln -s` 가 링크 대신 복사본을 만든다. 복사본으로도 동작한다: `.dflow.local`(레거시
  `.env`)은 정적이고
  스킬은 읽기 전용이며, 두 경로 모두 `info/exclude`·`.gitignore` 로 가려진다. 대가로 팀장이 스킬을 고쳐도 이미
  뜬 팀원의 복사본에는 반영되지 않고, 워크트리마다 `.dflow.local`(레거시 `.env`) 사본이 생기므로 정리 규칙이 워크트리를 지울 때 함께
  지워진다.
- `git worktree add` 가 실패하면(`SPAWN_FAILED_WORKTREE`, 대개 같은 경로가 남아 있음) 띄우지 않고 경로를
  보고한다. 같은 id8 의 옛 워크트리는 결과 처리가 지웠거나 `parked` 로 남아 있다. `parked` 면 「6. blocked」 대로
  "사람 확인 필요" 다.
- `team.spawn` 의 `worktree` 는 `$WT`, `handle` 은 `tmux:<pane_id>` 다(예: `tmux:%3`).
- 팀원 프로세스는 팀장 세션 안에 나타나지 않는다. ListAgents 에 팀원도 손자도 없다. 손자 Phase 서브에이전트는
  팀원의 서브에이전트이므로 팀원이 스스로 회수한다.

**폴더 신뢰 확인**: 대화형 claude 는 처음 보는 디렉터리에서 신뢰 확인을 띄운다.

```
Quick safety check: Is this a project you created or one you trust?
❯ No, exit
  Yes, I trust this folder
```

**`--dangerously-skip-permissions` 로 넘어가지 않는다.** `claude --help` 가 이유를 밝힌다. 그 대화상자는 `-p`
를 쓰거나 stdout 이 TTY 가 아닐 때만 건너뛴다. 팀원 워크트리는 매번 새 경로(`dflow-<id8>`)이므로 **매번** 뜬다.
아무도 답하지 않으면 팀원이 그대로 멈춘다. spawn 직후 팀장이 화면을 읽어 확인이 보이면 답을 보낸다.

```bash
for i in 1 2 3 4 5 6 7 8 9 10; do
  scr=$("$TM" -L dflow capture-pane -p -t "$PANE" 2>/dev/null)
  case "$scr" in
    *"I trust this folder"*) "$TM" -L dflow send-keys -t "$PANE" Down; \
                             "$TM" -L dflow send-keys -t "$PANE" Enter; break ;;
    *"bypass permissions on"*) break ;;
  esac
  sleep 1
done
```

이 규칙은 **화면 문자열에 기댄다.** Claude Code 판본이 문구를 바꾸면 깨진다. 깨지면 팀원이 신뢰 확인 화면에서
멈춘 채 살아 있으므로 무응답 자동 정리(SKILL.md 「3. 결과 처리」)가 가려낸다. 확인한 판본은 v2.1.273 이다.
`~/.claude.json` 의 `hasTrustDialogAccepted` 를 미리 넣는 길은 택하지 않았다. 그 파일은 212KB 이고 여러 세션이
동시에 쓰기 때문에, 읽고 고쳐 쓰는 사이에 남의 변경을 잃는다.

**팀원 환경을 벗기는 이유**: 팀원 pane 은 팀장의 환경을 통째로 물려받는다. 실측에서 `ORCA_AGENT_TEAMS_*`
다섯 개와 `CLAUDE_CODE_*` 아홉 개가 넘어갔고 PATH 에도 shim 디렉터리가 남았다.

| 남는 것 | 깨지는 것 |
|---|---|
| `CLAUDE_CODE_CHILD_SESSION` | **팀원의 대화 기록이 저장되지 않는다.** 화면에 `Transcript saving is off` 가 뜬다. 팀원이 무엇을 했는지 나중에 볼 수 없다 |
| `CLAUDE_CODE_MESSAGING_SOCKET`·`TOKEN` | 팀원이 팀장의 메시징 채널에 붙는다 |
| `CLAUDE_CODE_SESSION_ID`·`BRIDGE_SESSION_ID` | 팀원이 팀장의 세션 ID 를 자기 것으로 쓴다 |
| `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS` | 팀원이 자기 팀을 만들려 든다 |
| `CLAUDE_PID` | 팀원이 팀장 세션의 PID 를 자기 세션의 것으로 본다 |
| `ORCA_AGENT_TEAMS_TEAM_ID`·`TOKEN`·`LEADER_PANE` | 팀원이 자기를 Orca 팀 리더의 pane 으로 오인할 여지가 있다 |
| PATH 의 `claude-agent-teams-bin` | 팀원이 tmux 를 부르면 Orca shim 이 잡는다 |

**`ORCA_*`·`TMUX`·`TMUX_PANE` 벗기기와 PATH 의 shim 제거는 `ORCA_AGENT_TEAMS_TEAM_ID` 가 있을 때만 한다**
(2026-09-24부터. `CLAUDE*` 벗기기는 조건 없이 늘 한다). 이유: 이 값들이 남는 경우는 팀장이 Orca 안에서 tmux
백엔드(pane(tmux))로 팀원을 띄울 때뿐이다 — tmux pane 은 팀장의 환경을 통째로 물려받으므로 팀장이 Orca 의
tmux shim 을 통해 물려받은 `ORCA_AGENT_TEAMS_*`·`TMUX`·`TMUX_PANE` 이 pane 에도 샌다(위 표의 실측). 반대로
`orca terminal create` 로 새로 뜨는 Orca 탭은 그 탭 자신의 `ORCA_PANE_KEY`·`ORCA_TERMINAL_HANDLE`·
`ORCA_AGENT_HOOK_*` 만 가지고 `ORCA_AGENT_TEAMS_*`·`TMUX`·`CLAUDE*` 는 아예 없다(2026-09-24 실측) — 이 값들을
지우면 Orca 자신의 에이전트 상태 훅(`ORCA_AGENT_HOOK_*`)까지 함께 빠져 그 탭이 오피스 화면에 나타나지 않는다.
`ORCA_AGENT_TEAMS_TEAM_ID` 를 판별 기준으로 쓰는 이유는 tmux-in-Orca 누수 상황에서는 이 변수가 반드시 있기
때문이다(위 표: 팀 리더 pane 오인 방지 대상). 조건은 `if [ -n "${ORCA_AGENT_TEAMS_TEAM_ID-}" ]; then <벗기기
전부>; fi` 한 블록으로 묶는다 — 조건을 줄마다 따로 걸면(`[ ... ] &&`) `ORCA_*` 를 먼저 지우는 줄이 판별에 쓴
변수 자체를 지워, 그 뒤 줄(`unset TMUX TMUX_PANE`·PATH 정리)이 조용히 걸리지 않는다.

접두째 벗기는 쪽을 택한 이유는 목록을 손으로 관리하면 새 변수가 생길 때 놓치기 때문이다. `CLAUDE` 와
`ORCA_` 로 시작하는 것을 전부 지우고, `TMUX`·`TMUX_PANE` 을 따로 지운다(조건은 위 문단대로). **`CLAUDE_CODE_` 가 아니라
`CLAUDE` 로 자르는 이유**: 실측에서 `CLAUDECODE`(밑줄 없음)·`CLAUDE_PID`·`CLAUDE_EFFORT`·
`CLAUDE_PLUGIN_DATA` 넷이 `CLAUDE_CODE_` 접두를 벗어나 있었다. `CLAUDE_CONFIG_DIR` 만 예외로 남긴다.
사람이 설정하는 값이라 벗기면 팀원이 다른 설정 디렉터리를 쓴다. 팀원에게 필요한 설정은 모두
`~/.claude/settings.json` 과 워크트리의 `.dflow`·`.dflow.local`(레거시 `.env`)에서 오므로 잃는 것이 없다. PATH 에서 shim 디렉터리를 빼도
`claude` 해석은 안전하다(실측: 그 디렉터리에는 `tmux` 하나뿐이고 `claude` 는 다른 곳에 있다).

**생존·화면·답·회수**

| 항목 | 명령 |
|---|---|
| 생존 | `"$TM" -L dflow list-panes -t <pane> -F '#{pane_dead}' 2>/dev/null` — 빈 출력이면 pane 이 없고, `1` 이면 죽었으며, `0` 이면 살아 있다 |
| 종료 코드 | `"$TM" -L dflow list-panes -t <pane> -F '#{pane_dead_status}' 2>/dev/null` |
| 화면(보고용) | `"$TM" -L dflow capture-pane -p -t <pane>` |
| 결과 줄 폴백 | `"$TM" -L dflow capture-pane -p -J -S - -t <pane>` |
| `blocked` 답 | `"$TM" -L dflow send-keys -t <pane> -l -- "$ans"` 뒤에 `"$TM" -L dflow send-keys -t <pane> Enter` |
| 회수 | `"$TM" -L dflow kill-pane -t <pane>` 뒤에 `"$TM" -L dflow select-layout -t dflow tiled` |
| 워크트리 대응 | `#{pane_start_path}` |

- **화면은 생존 증거로 쓰지 않는다.** 스피너 때문에 화면이 매번 달라져 멈춘 팀원도 살아 있는 것처럼 보이기
  때문이다. 생존 증거는 SKILL.md 「3. 결과 처리」 의 셋(브랜치 tip 커밋 시각·서버 progress·미커밋 변경 목록)이다.
  화면은 사람에게 보여 줄 보고용과 신뢰 확인 판별에만 쓴다.
- 빈 출력과 `1` 을 함께 죽음으로 보는 이유: `remain-on-exit` 를 놓친 pane 은 흔적 없이 사라지는데, 그 팀원도
  끝난 것이다.
- 답을 `-l --` 로 넣는 이유: `-l` 이 없으면 tmux 가 답을 **키 이름으로 먼저 해석한다.** 실측에서 답이
  `Up` 이면 위쪽 화살표가 눌려 답이 통째로 전달되지 않았고, `Space` 면 공백 하나만 들어가 빈 답이 됐다.
  `;` 나 따옴표가 든 답은 한 인자로 넘기면 그대로 전달되므로 문제가 아니다. 신뢰 확인의 `Down`·`Enter` 는
  키 이름이 맞으므로 `-l` 없이 보낸다.
- 회수 뒤 `select-layout tiled` 를 다시 도는 이유: 남은 pane 이 빈자리를 메우게 한다.
- 팀장과 사람이 같은 pane 에 동시에 입력하면 섞인다. 팀장이 답을 넣을 때는 그 사실을 한 줄 알린다.

**결과 줄과 죽은 pane 폴백**: 결과는 `<워크트리>/<TASK_DIR>/.result` 다. pane 이 죽었는데 파일이 없으면
죽은 pane 의 화면 전체에서 `<TSK> <id8> ` 로 시작하는 마지막 줄을 찾는다(워커는 같은 줄을 마지막 응답으로도
출력한다). 그것도 없으면 `failed no-result` 다(SKILL.md 「3. 결과 처리」).

```bash
"$TM" -L dflow capture-pane -p -J -S - -t <pane> 2>/dev/null | grep -E '^<TSK> <id8> ' | tail -n 1
```

`-J` 는 줄바꿈된 줄을 잇고 `-S -` 는 스크롤백 전체를 읽는다. 기본 캡처는 보이는 영역뿐이라 결과 줄이
스크롤아웃되면 못 찾고, 200열에서 줄바꿈된 결과 줄은 앞부분만 잡혀 사유가 잘린다. `failed not-isolated` 는
워커가 파일을 쓰지 않으므로 이 폴백으로만 온다.

**재구성**: 팀장이 컨텍스트를 잃어도 아래 한 줄로 살아 있는 팀원을 흡수한다.
```bash
"$TM" -L dflow list-panes -a -F '#{pane_id} #{pane_dead} #{pane_start_path}' 2>/dev/null
```
`pane_start_path` 가 워크트리 경로이므로 pane 과 작업을 다시 맞출 수 있다. 워크트리 루트의 `.dflow-agent` 와
`.dflow-pane` 이 교차 확인에 쓰인다.

**마감**: **소켓에 pane 이 하나도 없을 때만** 서버를 거둔다.

```bash
[ -z "$("$TM" -L dflow list-panes -a -F '#{pane_id}' 2>/dev/null)" ] && "$TM" -L dflow kill-server
```

이 소켓은 **사용자 단위**이지 리포 단위가 아니다. 한 PC 에서 리포 둘에 팀장 둘이 도는 것은 정상이며(잠금은
체크아웃마다 따로다), 자기 슬롯 표만 보고 `kill-server` 를 하면 **다른 체크아웃의 살아 있는 팀원이 미커밋
산출물을 안은 채 죽는다.** 종전 프로세스 백엔드에는 이 위험이 없었다. `kill <PID>` 는 자기 프로세스만
건드렸기 때문이다. 결과 처리가 끝난 pane 을 `kill-pane` 으로 거두므로, 이 팀장의 팀원이 모두 끝났고 다른
팀장도 없으면 목록이 비어 서버가 거둬진다. 하나라도 남으면 서버를 남긴다. 대가는 tmux 서버 하나가 계속 도는
것뿐이고, 다음 팀장의 재구성이 `list-panes -a` 로 그 pane 들을 그대로 흡수한다.
`.dflow-agent` 가 없는 워크트리를 가리키는 pane 은 고아이므로 전제 검사가 찾아 보고한다.

**정리**: 워크트리가 아직 있을 때만 팀장 체크아웃에서 한다.
```bash
git worktree remove --force "$WT"
```
`--force` 는 미추적 부산물(`.result`·`.dflow-agent`·`.dflow-prompt`·`.dflow-pane`·`.dflow-run`·`.dflow.local`
(레거시 `.env`) 링크·`.dflow` 링크·스킬 링크) 때문에 필요하다. 먼저 「고아 정리 규칙」 을 따른다. 살아 있는 팀원의 워크트리는 지우지 않는다.

## pane(Orca)

Orca 안에서 띄운 팀장은 이 백엔드를 먼저 고른다(SKILL.md 「0. 환경 감지」). 2026-09-24 리허설(Orca 1.4.210,
Claude Code 2.1.281)로 관문 셋을 확인했다: `git worktree add --detach` 로 만든 순수 git 워크트리를
`orca terminal create --worktree path:<WT> --command ./.dflow-run --json` 이 받아들인다(핸들은
`.result.terminal.handle`), 새 탭의 claude 는 권한 확인 생략 모드로 돌고 포인터(`$(cat .dflow-prompt)`)가
첫 입력으로 들어가 바로 착수한다, `orca terminal close --terminal <핸들> --tab --json` 이 `ptyKilled:false`
로 답해도 claude 프로세스는 실제로 끝난다(`lsof` 확인). 이 관문을 통과했으므로 Orca 도 이제 tmux 와 같은
방식으로 spawn·회수·재투입한다(`references/restart.md` 「Orca」 — 예전에는 "관문 전" 이라 재투입하지
않았다).

**spawn**: 「pane(tmux)」 스폰 블록의 처음부터 `chmod +x "$WT/.dflow-run"` 줄까지를 **그대로, 한 번의 Bash
호출 안에서** 돈다(입장 제어 두 줄 포함이므로 따로 부르지 않는다 — `SPAWN_DEFERRED_CAPACITY` 로 끝나면 아래를
부르지 않는다). `WT` 는 tmux 와 같은 자리 `<MAIN>/.claude/worktrees/dflow-<id8>` 다 — 옛 리포 루트 위치
(`<MAIN>/dflow-<id8>`)는 새로 쓰지 않는다. 그 블록 뒤, tmux 의 `if "$TM" -L dflow has-session ...` 대신 같은
호출 안에서 아래로 잇는다. 블록 안의 `TM=$(find_tmux)` 는 이 호출 안에서만 쓰이고 버려진다 — Orca 팀장이 다른
블록(SKILL.md·restart.md)의 `TM` 자리표를 채울 때는 tmux 가 설치돼 있어도 **빈 값**이다.
```bash
R=$(orca terminal create --worktree "path:$WT" --title 'w<slot> · <TSK> <id8> · <작업 이름>' --command ./.dflow-run --json)
printf '%s\n' "$R"
H=$(printf '%s' "$R" | jq -r '.result.terminal.handle // .result.agentTerminalHandle // "-"')
printf '%s\n' "$H" > "$WT/.dflow-pane"
```
- `<기본브랜치>`(워크트리 준비 블록의 `git worktree add` 기점)는 SKILL.md 「1. 시작」 전제 검사가 구한 이름이다
  (`origin/HEAD`, 없으면 `git ls-remote --symref`). agent 브랜치가 결국 머지될 곳이고, 생략하면 리포 기본 base 로
  가는데 그 설정이 기본 브랜치와 다를 수 있다.
- 포인터는 SKILL.md 「5. 팀원 spawn」 의 한 줄 그대로이며 준비 블록이 이미 `$WT/.dflow-prompt` 에 썼다. 포인터에는
  큰따옴표·`$`·백틱이 없다. 포인터가 첫 입력으로 자동 제출되어 팀원이 바로 착수한다.
- `--title` 로 tmux 의 `select-pane -T` 와 같은 이름표(`w<slot> · <TSK> <id8> · <작업 이름>`)를 붙인다.
- 핸들 필드는 `result.terminal.handle` 을 먼저 본다(2026-09-24 실측 필드명). 옛 런타임은 이 필드 대신
  `result.agentTerminalHandle` 만 주거나(`result.startupTerminal.handle` 만 주는 더 옛 런타임도 있다) 아무것도
  주지 않는다. 셋 다 없으면 `handle` 을 `-` 로 두고, 화면 읽기 없이 git·서버 증거만 쓴다.
- **`$WT/.dflow-pane` 에 핸들을 쓴다**(tmux 가 pane id 를 쓰는 자리와 같게). 이유: 재개(「5-1」)·재투입
  (`references/restart.md`)·회수(결과 처리)가 백엔드를 가리지 않고 같은 파일에서 대상을 찾는다.
- `team.spawn` 의 `handle` 표기는 events.md 가 이미 정한 형식(raw "Orca 터미널 핸들", `orca:` 접두 없음)을
  그대로 쓴다.
- 이후 이 워크트리를 가리킬 때는 `--worktree "path:$WT"` 선택자를 쓴다. 워크트리를 경로로 지정하므로 다른
  식별자는 필요 없다.
- 팀원 화면 보기(사람에게 보여 줄 보고용): `orca terminal read --terminal <handle>`. **화면은 생존 증거로 쓰지
  않는다.** 스피너 때문에 화면이 매번 달라져 멈춘 팀원도 살아 있는 것처럼 보이기 때문이다. 생존 증거는
  SKILL.md 「3. 결과 처리」 의 셋(브랜치 tip 커밋 시각·서버 progress·미커밋 변경 목록)이다.

**폴더 신뢰 확인**: tmux 처럼 spawn 직후 화면을 최대 10 회(1초 간격) 읽어 가려낸다. **키를 보내는 방법은
실측하지 않았으므로 보내지 않는다.**
```bash
for i in 1 2 3 4 5 6 7 8 9 10; do
  scr=$(orca terminal read --terminal "$H" 2>/dev/null)
  case "$scr" in
    *"I trust this folder"*) echo "TRUST_NEEDS_HUMAN $H"; break ;;
    *"bypass permissions on"*) break ;;
  esac
  sleep 1
done
```
`I trust this folder` 가 보이면 "사람 확인 필요" 로 보고하고 넘어간다 — 그 탭에서 사람이 직접 답해야 한다.
이유: `orca terminal send` 로 방향키를 보내 신뢰 확인을 넘기는 방법은 실측하지 않았다(위 배경). 2026-09-24
리허설에서는 워크트리가 이미 신뢰된 리포(`<MAIN>`) 아래라 이 화면이 뜨지 않았다 — 그래도 이 루프는 남긴다.
다른 부모 경로에서는 뜰 수 있다. `bypass permissions on` 이 보이면 통과다. 이 규칙은 화면 문자열에 기댄다
(pane(tmux) 「폴더 신뢰 확인」과 같은 한계 — Claude Code 판본이 문구를 바꾸면 깨진다).

**정리**: 전환 규칙을 먼저 본다.
```bash
if orca worktree list --json 2>/dev/null | jq -e --arg p "<경로>" '[.result.worktrees[]?.path] | index($p) != null' >/dev/null; then
  orca worktree rm --worktree path:<경로>
else
  git worktree remove --force "<경로>"
fi
orca worktree list        # 누수 확인. 옛 방식 워크트리(dflow-<id8>, 리포 루트)가 남아 있으면 위 첫 갈래로 지운다
```
옛 방식(`orca worktree create`)으로 뜬 워크트리만 `orca worktree list --json` 에 나타난다 — 그 경로면
`orca worktree rm`(체크아웃된 로컬 브랜치만 삭제를 시도하고, 머지됐음을 입증하지 못하는 브랜치와 워크트리보다
먼저 있던 브랜치는 보존한다), 아니면(새 방식, `git worktree add`) tmux 와 같은 `git worktree remove --force`
다(`--force` 이유는 tmux 「정리」 와 같다: 미추적 부산물). 미커밋분을 잃으므로 먼저 「고아 정리 규칙」 을 따른다.
옛 방식의 `orca worktree rm` 에는 `--force` 를 「고아 정리 규칙」 1번(부트스트랩 실패)에서만 붙인다. 두 갈래 모두
브랜치 삭제는 강제하지 않는다. `orca worktree list --json` 의 모양은 `{result:{worktrees:[{path,…}]}}` 다(2026-09-24 실측).

## 고아 정리 규칙

두 백엔드 공통이다. 대상은 루트 `.dflow-agent` 값이 `<신원>/<host>/` 로 시작하는 워크트리(`parked` 포함)다.
결과 처리(done·needs-merge·skipped·failed·cancelled), 고아 스캔, 무응답 자동 정리, 마감이 이 규칙으로 팀원 워크트리를
지운다. **아래에서 "Orca 정리 명령"은 「pane(Orca)」 「정리」의 전환 규칙(경로가 `orca worktree list --json` 에
있으면 `orca worktree rm --worktree path:<경로>`, 없으면(새 방식) `git worktree remove --force <경로>`)을
가리키는 줄임말이다.**
1. **부트스트랩 실패**(`.result` 의 branch 칸이 `-`, 브랜치를 만들기 전에 끝남): 미커밋 목록이 알려진
   부산물(`.dflow-agent`, `.dflow-prompt`, `.dflow-pane`, `.dflow-run`, `.result`, `.issues`, `<TASK_DIR>/spec.md`
   캐시, `.dflow.local`(레거시 `.env`) 링크, `.dflow` 링크, 스킬 링크(`.claude/skills` 또는 그 안의 `dflow-dev`·`dflow-work`))뿐일 때만 정리한다
   (tmux 는 `git worktree remove --force`, Orca 는 Orca 정리 명령에 `--force` 를 붙인다). 두 백엔드
   모두 `--force` 를 쓰는 이유: 알려진 부산물 중 `spec.md` 캐시와 스킬 폴더 안의 개별 링크는 공유 `info/exclude` 가
   가리지 않는 미추적 파일이라 `--force` 없이는 제거가 거부될 수 있다. Orca 의 `--force` 는 워크트리 강제 제거만
   하고 브랜치 삭제는 강제하지 않는다.
   ```bash
   git -C <워크트리> status --porcelain --untracked-files=all \
     | grep -v -E '^\?\? (\.dflow-(agent|prompt|pane|run)|\.env|\.dflow|\.dflow\.local|\.claude/skills(/dflow-(dev|work)(/.*)?)?|<TASK_DIR>/(spec\.md|\.result|\.issues))$'
   ```
   출력이 비어 있어야 한다. 그 밖의 변경이 있으면 보존하고 경로와 목록을 보고한다. 이유: 브랜치가 없어도
   워커가 무언가를 고쳤다면 그것은 사람이 판단할 산출물이다.
2. **그 밖**: 미커밋 변경이 없어야 하고(첫 줄), 그 다음 둘 중 하나가 참이면 정리한다.
   ```bash
   git -C <워크트리> status --porcelain       # 비어 있어야 한다. 부산물은 info/exclude 로 가려져 있다
   git fetch origin
   if git -C <워크트리> rev-parse -q --verify "origin/<agent 브랜치>" >/dev/null; then
     test "$(git -C <워크트리> rev-parse HEAD)" = "$(git -C <워크트리> rev-parse origin/<agent 브랜치>)"
   else
     git -C <워크트리> merge-base --is-ancestor HEAD "origin/<기본브랜치>"
   fi
   ```
   **대안 조건**(둘째 갈래, 2026-09-24 추가): agent 브랜치가 이미 머지되고 원격에서 지워진 뒤에는 첫 갈래(HEAD
   비교)를 확인할 원격 ref 자체가 없다. `/dflow-merge` 는 `--no-ff` 고정이라 머지된 작업의 HEAD 는 기본
   브랜치의 조상이 되므로, 그 조건으로 대신 판정한다. 이 대안이 없으면 머지 뒤 원격 agent 브랜치를 지운
   워크트리가 영영 정리되지 않고 쌓인다.
2-1. **해소 워크트리**(이름 `dflow-<id8>-resolve`, detached, SKILL.md 「5-2. 해소 spawn」): 1·2번 대신 아래 둘이 모두
   참일 때 정리한다. 결과 줄 branch 칸이 늘 `-` 여도 1번(부트스트랩 실패)을 쓰지 않는다.
   ```bash
   git -C <워크트리> status --porcelain --untracked-files=all \
     | grep -v -E '^\?\? (\.dflow-(agent|prompt|pane|run)|\.env|\.dflow|\.dflow\.local|\.claude/skills(/dflow-(dev|work|merge|team)(/.*)?)?|<TASK_DIR>/\.result)$'
   git fetch origin
   git -C <워크트리> merge-base --is-ancestor HEAD origin/<개발브랜치>
   ```
   첫 명령 출력이 비고 둘째가 0 이면 지운다(push 했거나 `reset --keep` 으로 버렸다. 잃을 것이 없다). tmux 는
   `git worktree remove --force <경로>`, Orca 는 Orca 정리 명령에 `--force` 를 붙인다. 아니면 3번으로
   간다. 해소 워크트리는 "재개 가능" 이 아니므로 `parked` 로 바꾸고 "멈춤" 표에 넣는다. 사유는 결과 줄 status
   (`blocked` 해소 중 멈춤 등)다. 살아 있는 해소 워커(`blocked` 포함)의 워크트리는 4번대로 지우지 않는다.

3. 하나라도 거짓이면 지우지 않는다. 그 다음 SKILL.md 「팀장 상태」 고아 스캔의 **"재개 가능"** 조건을 보고
   가른다. 재개 가능이면 `.dflow-agent` 를 **건드리지 않고** 그대로 두어 「5-1. 재개 spawn」 이 이어받게 한다
   (그 절차가 슬롯 값을 다시 쓴다). 재개 가능이 아니면 경로와 미커밋 목록
   (`git -C <워크트리> status --porcelain` 출력)을 **"멈춤" 표**에 붙이며, 살아 있는 팀원의 워크트리(4번)가
   아니면 `.dflow-agent` 값을 `parked` 로 바꿔 정규 슬롯 스캔에서 뺀다. 이유: 느린 팀원이나 커밋 전에 멈춘 팀원의 산출물을 잃지 않는다. 보존된 워크트리의
   `.dflow-agent` 가 `w<slot>` 값을 그대로 가지면, 그 슬롯에 새로 뜬 팀원과 같은 슬롯 표시를 가져 재구성이
   충돌한다.
   ```bash
   printf '%s\n' '<신원>/<host>/parked' > <워크트리>/.dflow-agent
   ```
4. 살아 있는 팀원(SKILL.md 「팀장 상태」 정의)의 워크트리는 조건과 무관하게 지우지 않는다. 두 백엔드의
   `blocked` 워크트리가 모두 여기에 든다(팀원이 pane 이나 탭에서 답을 기다린다). 예외는 무응답 자동 정리
   (SKILL.md 「3. 결과 처리」) 하나다.
5. **생성 브랜치 정리**: 워크트리를 지웠으면 그 워크트리를 만들 때 생긴 브랜치를 지운다. 새 방식(`git worktree
   add --detach`)은 두 백엔드 모두 생성 브랜치가 없으므로 이 항목은 **옛 방식**(`orca worktree create`)이
   남긴, 이름에 `dflow-<id8>` 이 든 브랜치에만 해당한다. `agent/` 로 시작하는 브랜치는 지우지 않는다(작업
   산출물이다).
   ```bash
   git fetch origin
   git branch --format='%(refname:short)' --list '*dflow-<id8>*' | while IFS= read -r br; do
     case "$br" in agent/*) continue ;; esac
     git merge-base --is-ancestor "$br" origin/<기본브랜치> && git branch -D "$br"
   done
   ```
   `git branch -D` 는 다른 워크트리가 체크아웃한 브랜치를 거부하므로 그런 브랜치는 남는다. 이유: 워커가 곧바로
   detach 하므로 생성 브랜치는 체크아웃되지 않은 채 남아 Orca 정리도 지우지 않고, 같은 id8 을 다시 띄우면
   이름이 부딪치며 작업마다 쌓인다. `origin/<기본브랜치>` 의 조상인 것만 지우는 이유는 이름만 맞는 브랜치의
   고유 커밋을 잃지 않기 위해서다. Orca 가 만드는 실제 이름은 리허설이 확인한다.
   id8 을 모르면(컨텍스트 압축으로 이름을 잃은 경우) 위 루프의 첫 줄만
   `git branch --format='%(refname:short)' --list '*dflow-[0-9a-f]*'` 로 바꿔 돌린다. 앞의 `*` 는 Orca 가 이름 앞에
   다른 접두를 붙일 수 있어서이고, `dflow-` 뒤를 16진수로 한정하는 이유는 `worktree-dflow-team` 같은 개발 브랜치를
   후보에서 빼기 위해서다. 세 안전 조건(`agent/` 아님, 체크아웃 안 됨, `origin/<기본브랜치>` 의 조상)은 루프가
   그대로 지킨다. 이유: 이름을 채우지 못해 정리를 건너뛰면 생성 브랜치가 쌓이고, 세 조건이 이름만 맞는 남의
   브랜치를 보호한다.

## 플랫폼 차이

두 백엔드의 셸 블록은 macOS·Linux 와 Windows(Git Bash, MSYS) 에서 같은 절차로 돌며, 아래 항목만 블록 안에서
`uname -s` 로 가른다(`MINGW*|MSYS*|CYGWIN*`). WSL 은 Linux 다. 경로는 항상 git 출력(`rev-parse`·`worktree list`)에서
얻고 `pwd` 와 문자열로 비교하지 않는다. Windows 에서 git 은 `C:/…` 형으로 돌려주고 bash 는 `/c/…` 형으로 보여
같은 위치가 다른 문자열이 되기 때문이다.

| 항목 | macOS·Linux | Windows(Git Bash) |
|---|---|---|
| tmux | 대개 설치되어 있거나 패키지 관리자로 깐다 | **MSYS2 로 따로 깔아야 한다. 미검증** |
| 호스트 이름 | `hostname` 의 첫 점 앞부분(`hostname \| cut -d. -f1`) | 같다. Windows 의 hostname.exe 에는 `-s` 가 없다 |
| 팀장 세션 PID | `CLAUDE_PID`(= `$PPID`) | `CLAUDE_PID`(필수. 없으면 전제 검사가 `NO_CLAUDE_PID` 로 중단). `$PPID` 는 부모가 Cygwin 프로세스가 아니면 1 이다 |
| `.dflow.local`(레거시 `.env`)·스킬 링크 | 심링크 | `ln -s` 가 복사본을 만든다. 복사본으로 동작한다(「pane(tmux)」 spawn) |
| 필요한 명령 | bash·coreutils·tmux·git·jq·curl | Git for Windows 의 bash·coreutils 와 MSYS2 tmux·git·jq·curl |

- **Windows tmux 미검증**: MSYS2 tmux 가 Git Bash 에서 실제로 도는지 확인한 적이 없다. Git for Windows 기본
  구성이 아니고, tmux 자체의 Windows 제약도 알려져 있다. 검증 전까지 Windows 는 「돌 수도 있다」 로 둔다.
  WSL 은 Linux 로 취급되므로 그대로 돈다.
- **`ln -s`**: 복사본을 만든다(파일·폴더 모두). `MSYS=winsymlinks:nativestrict` 를 주면 진짜 심링크가
  되지만 설계는 복사본을 전제로 한다.
- **줄끝**: Windows 기본 `core.autocrlf=true` 클론은 스크립트를 CRLF 로 바꾼다. 킷과 설치 대상의
  `.gitattributes`(install.sh 가 넣는다)가 LF 로 고정하고, `dflow.sh`·heartbeat 훅이 `.dflow`·`.dflow.local`
  (레거시 `.env`) 값의 `\r`
  을 걷어낸다.
- **미확인**: 실제 Windows Claude Code 세션의 Bash 도구가 `CLAUDE_PID` 를 내보내는지는 러너에서 잴 수
  없었다(세션이 없다). 그래서 전제 검사가 `NO_CLAUDE_PID` 로 막는다(SKILL.md 「1. 시작」 전제 검사).
