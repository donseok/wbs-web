# /dflow-team 백엔드: spawn·정리 명령 정본

SKILL.md 「0. 환경 감지」 가 백엔드를 고른다. 팀장이 Orca 안에 있으면 **pane(Orca)**, 밖이면 **pane(tmux)** 다. 워커
프롬프트·`.result` 계약·`/dflow-dev --worker` 는 두 백엔드가 같고, 가르는 것은 아래 차이표뿐이다. 근거·이력은
`rationale.md` 「백엔드(backends.md)」 에 있다.

**읽는 법**(필요한 절만 Bash `sed` 로 읽는다): spawn 은 「입장 제어」~「폴더 신뢰 확인」(tmux) 이고 Orca 는 거기에
「pane(Orca)」 를 더한다. 회수·답·결과 줄 폴백은 「생존·화면·답·회수」「결과 줄과 죽은 pane 폴백」, 정리는 「고아 정리 규칙」 이다.
```bash
sed -n '/^## 입장 제어/,/^### 팀원 환경을 벗기는 이유/p' .claude/skills/dflow-team/references/backends.md   # spawn(tmux·Orca 공통 준비 블록까지)
sed -n '/^## pane(Orca)/,/^## 고아 정리 규칙/p' .claude/skills/dflow-team/references/backends.md           # Orca 는 이것도
```

## 차이표

| 항목 | pane(tmux) | pane(Orca) |
|---|---|---|
| 팀원 정체 | 팀장이 tmux pane 에 띄운 대화형 claude 메인 에이전트(권한 확인 생략 모드) | Orca 탭의 claude 메인 에이전트(권한 확인 생략 모드) |
| 워크트리 | 팀장이 `git worktree add --detach` 로 `<MAIN>/.claude/worktrees/dflow-<id8>` 를 `origin/<기본브랜치>` 기점으로 만든다. 브랜치를 만들지 않는다 | **같다**(「팀원 워크트리 준비」가 두 백엔드 공통). 옛 방식(`orca worktree create`)이 리포 루트 바로 아래 `<MAIN>/dflow-<id8>` 에 만든 워크트리가 남아 있을 수 있으며, 그 구분은 「고아 정리 규칙」 전환 규칙이 가른다(전제 검사의 exclude `/dflow-*/` 가 그것을 가린다) |
| 기상 신호 | 감시 루프의 `RESULT_READY`·`PANE_DEAD` | 감시 루프의 `RESULT_READY` |
| `blocked` 이후 | 팀원은 pane 에서 멈춰 기다린다 | 팀원은 탭에서 멈춰 기다린다 |
| 슬롯 점유 | `blocked` 동안 슬롯을 계속 잡는다 | 같다 |
| 사람의 답 | 그 pane 에 직접 치거나, 팀장이 `send-keys` 로 넣는다 | 그 팀원 탭에 직접 준다 |
| 회수 | 결과 줄 처리 뒤 `kill-pane -t <pane>` | 결과 줄 처리 뒤 `orca terminal close --terminal <handle> --tab --json`(핸들이 `-` 면 건너뜀) |
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
  `team.result` 를 쓰지 않는다. 한 후보가 막히면 같은 기상의 나머지 후보도 띄우지 않는다.
- `CAPACITY_OK`·`CAPACITY_UNKNOWN` 이면 이어서 띄운다. 출력 줄 끝이 `notify=1` 이면 SKILL.md 「5-3」 의 한 줄 알림을 낸다.
- 새 작업·해소의 spawn 블록(아래 「팀원 워크트리 준비」, 두 백엔드 공통)은 이 두 줄로 시작하므로 따로 부르지 않는다.
  merge-conflict.md 「2」 의 해소 spawn 도 그 블록을 그대로 돌리므로 여기에 걸린다(tmux·Orca 모두). 블록을 통째로
  돌지 않는 자리 — 재개(`references/resume.md` 0항)와 재투입(restart.md 「재투입」) — 는 이 블록을 먼저 따로 돈다
  (있는 워크트리를 이어 쓰므로 준비 블록 전체를 다시 돌지 않는다).
- 주간 사용량(`capacity.sh usage`)은 이 블록이 아니라 새 작업 spawn(SKILL.md 「5」 0항)만 이 블록 전에 따로 본다.

## pane(tmux)

팀원은 팀장이 전용 tmux 소켓(`-L dflow`)의 pane 에 띄운 **대화형** claude 메인 에이전트다(Agent 도구 서브에이전트로
띄우지 않는다 — SKILL.md 머리말 「제1 제약」). 팀장 세션이 죽어도 살아남는다.

### 진짜 tmux 찾기

Orca 는 PATH 앞에 tmux shim(`orca agent-teams-tmux` 로 위임하는 셸 스크립트)을 끼운다. shim 은 명령 부분집합만 처리하고
나머지를 `unsupported command` 로 거부하며, **`tmux -V` 는 거짓 버전을 답하므로** 버전으로는 가릴 수 없다.

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

두 겹으로 거른다(스크립트 내용의 `agent-teams-tmux`, 실제 명령의 `unsupported command`). probe 소켓 이름에 `$$` 를 붙여
운영 소켓 `dflow` 를 건드리지 않는다. 찾은 절대경로는 `TM` 에 담아 이후 모든 호출에 쓴다(절대경로로 부르면 Orca 안에서도
shim 을 지나친다).

### 팀원 워크트리 준비

**spawn**: 워크트리 준비는 팀장 체크아웃에서 한 번의 Bash 호출로 돌린다. **이 블록은 `chmod +x
"$WT/.dflow-run"` 줄까지 두 백엔드가 글자 그대로 같다** — Orca(「pane(Orca)」)는 같은 블록을 여기까지 그대로
돌린 뒤 그 아래만 `orca terminal create` 로 다르게 잇는다. `<모델 플래그>` 는 `MODEL` 이
`opus`·`sonnet` 이면 `--model opus`·`--model sonnet`, `default` 면 빈 값이다. `<EFFORT>` 는 SKILL.md 「인자」
가 정한 추론 강도다(기본 `high`. 팀장 세션의 `CLAUDE_EFFORT` 는 아래에서 벗기므로 플래그가 없으면 팀원은 그 PC 의
`effortLevel` 을 따른다). 첫 두 줄은 「입장 제어」 블록 그대로이며 빼지 않는다. `SPAWN_DEFERRED_CAPACITY` 로 끝나면
워크트리도 pane 도(Orca 는 탭도) 만들지 않은 것이다.

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
   + {hooks: {PreToolUse: [{matcher: "Bash", hooks: [{type: "command", timeout: 5,
       command: "if [ -x \"${CLAUDE_PROJECT_DIR-}/.claude/skills/dflow-dev/scripts/timeout-guard.sh\" ]; then /bin/sh \"${CLAUDE_PROJECT_DIR-}/.claude/skills/dflow-dev/scripts/timeout-guard.sh\"; else cat >/dev/null 2>&1 || :; fi"}]}]}}
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
설정 파일 경로를 실행 시점에 다시 만들고 없으면 `--settings` 없이 띄운다(없는 설정 파일을 받으면 claude 가 곧바로 끝난다).
`.dflow-run` 을 다시 쓸 때(재개·재투입) `LIM` 줄을 빠뜨리지 않는다(경로가 비면 재시작한 팀원이 전부 첫 화면에서 죽는다).

- **팀원 전용 설정(플러그인·MCP 끄기)**: spawn 시점에 `~/.claude/settings.json`·
  `<MAIN>/.claude/settings.json`·`<MAIN>/.claude/settings.local.json` 중 있는 파일의 `enabledPlugins` 에서 값이
  `true` 인 키를 모아 전부 `false` 로 덮어 `<id8>.settings.json` 에 합친다. 목록을 하드코딩하지 않는다(PC 마다 켜 둔
  플러그인이 다르다 — 특정 플러그인 이름을 이 문서에 적지 않는다). 파일이 없거나 jq 가 읽지 못하면 그 파일만 건너뛴다.
  `.dflow-run` 의 두 `exec` 줄 모두 `--no-chrome --strict-mcp-config` 를 붙여 MCP 서버를 끈다(claude.ai 커넥터 포함.
  `claude-in-chrome` 은 `--no-chrome` 으로 빠진다). `--mcp-config` 는 쓰지 않는다(가변 인자라 뒤의 프롬프트까지 설정 파일
  경로로 먹는다). **`--setting-sources` 는 쓰지 않는다**(user 설정의 heartbeat 훅이 함께 빠져 좌석표가 진척을 못 본다).
  전역 `~/.claude/settings.json` 자체는 읽기만 하고 건드리지 않는다.
  사람이 끄고 싶지 않으면 `DFLOW_WORKER_PLUGINS=keep`(플러그인, 팀장 세션 환경에서 읽는다)·`DFLOW_WORKER_MCP=keep`(MCP·
  `claude-in-chrome`, 팀원 실행 시점에 `.dflow-run` 이 읽는다. Orca 새 탭은 로그인 셸 환경이므로 셸 프로필에 export 한다)으로
  각각 되돌린다. 이 설정은 tmux spawn·Orca spawn·재개(`references/resume.md`)·재투입(`references/restart.md` 「재투입」)이
  모두 이 블록으로 얻는다.
- **timeout 가드 훅**: 같은 설정 파일에 `hooks.PreToolUse`(matcher `Bash`, timeout 5)로
  `.claude/skills/dflow-dev/scripts/timeout-guard.sh` 를 건다. 팀원과 그 Phase 서브에이전트가 `heavy.sh`·`baseline.sh run`·
  `gradlew`·`mvn`·`playwright test` 를 timeout 없이(또는 300000 미만으로) 부르거나 `run_in_background` 로 부르면 exit 2 로
  막고 이유를 모델에게 보여 준다(E2E 서버 기동만 백그라운드 허용. `nohup` 은 예외가 아니다). 판정 규칙은 스크립트 머리말이 정본이다. 명령은
  heartbeat 훅과 같은 가드형이라 스크립트가 없는 킷에서는 stdin 을 비우고 통과한다. 전역 `~/.claude/settings.json` 에는
  넣지 않는다. 근거는 `references/rationale.md`.
- **statusLine 덤프**: `--settings` 로 붙인 statusLine 이 입력 JSON 의 `.rate_limits`(구독자일 때 `five_hour`·`seven_day`
  마다 `used_percentage`·`resets_at`)를 `~/.dflow/limits/<id8>.json` 에 쓴다. 팀장은 이것으로 한도와 해제 시각을
  정한다(`references/restart.md` 「한도 판정」). 워크트리 밖(`~/.dflow/limits`)에 쓴다(안에 쓰면 `DIRTY` 검사와 「고아 정리
  규칙」 2번이 깨진다). 임시 파일에 쓰고 옮긴다. 팀원 pane 의 statusLine 표시는 `dflow` 다. 두 백엔드·재개·재시작 팀원 모두
  덤프를 남긴다. 파일은 지우지 않는다(같은 id8 을 다시 띄우면 덮어쓴다).
- **전용 소켓 `-L dflow`** 라 팀장이 tmux 안이든 밖이든 코드 경로가 하나이고 사람의 tmux 세션을 건드리지 않는다. 서버가
  없으면 `new-session`, 있으면 `split-window` 다. `-x 200 -y 60` 은 detached 동안의 가상 크기다(`capture-pane` 이 쓴다).
- **pane 이름표**: `select-pane -T` 로 `w<slot> · <TSK> <id8> · <작업 이름>` 을 붙이고 `pane-border-status top`·
  `pane-border-format`(window 옵션이라 `-w`, 세션을 만들 때 한 번)으로 테두리에 띄운다.
- **`allow-set-title off` 를 `select-pane -T` 보다 먼저 건다**(없으면 claude 가 제목을 자기 진행 표시로 덮는다). pane 옵션이라
  `-p` 와 pane id 로 **pane 마다** 건다(tmux 3.3 이상).
- `remain-on-exit on` 은 죽은 pane 을 남겨 마지막 화면과 `#{pane_dead_status}` 를 읽게 한다. `exec` 로 셸을 claude 로
  대체해 `pane_pid` 가 곧 claude 다. 명령은 `.dflow-run`, 프롬프트는 `.dflow-prompt` 파일 경유다(인용 문제를 피한다).
  `claude "<프롬프트>"` 는 대화형 세션을 띄우며 그 문자열을 첫 턴으로 제출한다(`-p` 를 쓰지 않는다).
- `.dflow.local`(레거시 `.env`)·`.dflow`·스킬 링크는 팀장이 먼저 건다(claude 가 시작할 때 cwd 의 `.claude/skills` 를 읽는다.
  워커 부트스트랩의 같은 명령은 이미 있으면 건너뛴다). 스킬 폴더가 실제 폴더로 있는데 `dflow-dev` 가 없으면 스킬만 하나씩
  링크한다(폴더째 걸면 `.claude/skills/skills` 가 생긴다). 메인 체크아웃에 `.env` 가 있으면 함께 링크한다(구버전 heartbeat
  훅). 그 밖의 gitignore 된 심링크(예 `docs/mdm/design`)는 워커의 `deps.sh`(dflow-dev 행 H)가 건다(`DEPS_LINK <경로>`).
- Windows(Git Bash) 에서는 `ln -s` 가 링크 대신 복사본을 만든다. 복사본으로도 동작한다(대가로 이미 뜬 팀원에는 스킬 수정이
  반영되지 않는다).
- `git worktree add` 가 실패하면(`SPAWN_FAILED_WORKTREE`, 대개 같은 경로가 남아 있음) 띄우지 않고 경로를
  보고한다. 같은 id8 의 옛 워크트리는 결과 처리가 지웠거나 `parked` 로 남아 있다. `parked` 면 "사람 확인 필요" 다.
- `team.spawn` 의 `worktree` 는 `$WT`, `handle` 은 `tmux:<pane_id>` 다(예: `tmux:%3`).
- 팀원 프로세스는 팀장 세션 안에 나타나지 않는다(ListAgents 에 팀원도 손자도 없다. 손자는 팀원이 스스로 회수한다).

### 폴더 신뢰 확인

대화형 claude 는 처음 보는 디렉터리에서 신뢰 확인을 띄운다.

```
Quick safety check: Is this a project you created or one you trust?
❯ No, exit
  Yes, I trust this folder
```

**`--dangerously-skip-permissions` 로 넘어가지 않는다**(그 대화상자는 `-p` 나 비 TTY 에서만 건너뛴다). 팀원 워크트리는 매번
새 경로라 **매번** 뜬다. spawn 직후 팀장이 화면을 읽어 확인이 보이면 답을 보낸다.

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

이 규칙은 **화면 문자열에 기댄다**(확인한 판본 v2.1.273). 깨지면 팀원이 신뢰 확인 화면에서 멈춘 채 살아 있으므로
무응답 자동 정리(SKILL.md 「3. 결과 처리」)가 가려낸다. `~/.claude.json` 의 `hasTrustDialogAccepted` 는 건드리지 않는다
(여러 세션이 동시에 쓰는 파일이다).

### 팀원 환경을 벗기는 이유

팀원 pane 은 팀장의 환경을 통째로 물려받는다. `.dflow-run` 은 `CLAUDE` 로 시작하는 변수를 전부 벗긴다(`CLAUDE_CONFIG_DIR`
만 남긴다. 대화 기록 저장이 꺼지고, 팀장의 메시징 채널·세션 ID·PID·에이전트 팀 설정을 팀원이 제 것으로 쓰는 것을 막는다).
**`ORCA_*`·`TMUX`·`TMUX_PANE` 벗기기와 PATH 의 shim 제거는 `ORCA_AGENT_TEAMS_TEAM_ID` 가 있을 때만 한다**(팀장이 Orca 안에서
tmux 백엔드로 팀원을 띄울 때만 새는 값이다. Orca 가 새로 띄운 탭의 `ORCA_AGENT_HOOK_*` 를 지우면 그 탭이 오피스 화면에서
사라진다). 조건은 `if [ -n "${ORCA_AGENT_TEAMS_TEAM_ID-}" ]; then <벗기기 전부>; fi` 한 블록으로 묶는다(줄마다 걸면 먼저
지운 `ORCA_*` 가 판별 변수까지 지운다). 변수별로 무엇이 깨지는지는 rationale.md 에 있다.

### 생존·화면·답·회수

| 항목 | 명령 |
|---|---|
| 생존 | `"$TM" -L dflow list-panes -t <pane> -F '#{pane_dead}' 2>/dev/null` — 빈 출력이면 pane 이 없고, `1` 이면 죽었으며, `0` 이면 살아 있다 |
| 종료 코드 | `"$TM" -L dflow list-panes -t <pane> -F '#{pane_dead_status}' 2>/dev/null` |
| 화면(보고용) | `"$TM" -L dflow capture-pane -p -t <pane>` |
| 결과 줄 폴백 | `"$TM" -L dflow capture-pane -p -J -S - -t <pane>` |
| `blocked` 답 | `"$TM" -L dflow send-keys -t <pane> -l -- "$ans"` 뒤에 `"$TM" -L dflow send-keys -t <pane> Enter` |
| 회수 | `"$TM" -L dflow kill-pane -t <pane>` 뒤에 `"$TM" -L dflow select-layout -t dflow tiled` |
| 워크트리 대응 | `#{pane_start_path}` |

- **화면은 생존 증거로 쓰지 않는다.** 정본은 SKILL.md 「3. 결과 처리」 생존 증거(브랜치 tip 커밋 시각·서버 progress·미커밋
  변경 목록)다. 화면은 보고용과 신뢰 확인 판별에만 쓴다.
- 빈 출력과 `1` 을 함께 죽음으로 본다(`remain-on-exit` 를 놓친 pane 은 흔적 없이 사라진다).
- 답은 `-l --` 로 넣는다(없으면 tmux 가 답을 **키 이름으로 먼저 해석한다** — `Up`·`Space` 같은 답이 키로 눌린다). 신뢰
  확인의 `Down`·`Enter` 는 키 이름이 맞으므로 `-l` 없이 보낸다.
- 회수 뒤 `select-layout tiled` 를 다시 돌아 남은 pane 이 빈자리를 메우게 한다.
- 팀장과 사람이 같은 pane 에 동시에 입력하면 섞인다. 팀장이 답을 넣을 때는 그 사실을 한 줄 알린다.

### 결과 줄과 죽은 pane 폴백

결과는 `<워크트리>/<TASK_DIR>/.result` 다. pane 이 죽었는데 파일이 없으면
죽은 pane 의 화면 전체에서 `<TSK> <id8> ` 로 시작하는 마지막 줄을 찾는다(워커는 같은 줄을 마지막 응답으로도
출력한다). 그것도 없으면 `failed no-result` 다(SKILL.md 「3. 결과 처리」).

```bash
"$TM" -L dflow capture-pane -p -J -S - -t <pane> 2>/dev/null | grep -E '^<TSK> <id8> ' | tail -n 1
```

`-J` 는 줄바꿈된 줄을 잇고 `-S -` 는 스크롤백 전체를 읽는다(보이는 영역만 읽으면 스크롤아웃된 결과 줄을 놓치고 사유가
잘린다). `failed not-isolated` 는 워커가 파일을 쓰지 않으므로 이 폴백으로만 온다.

### 재구성

팀장이 컨텍스트를 잃어도 아래 한 줄로 살아 있는 팀원을 흡수한다(`pane_start_path` 가 워크트리 경로다. 워크트리 루트의
`.dflow-agent` 와 `.dflow-pane` 이 교차 확인에 쓰인다).
```bash
"$TM" -L dflow list-panes -a -F '#{pane_id} #{pane_dead} #{pane_start_path}' 2>/dev/null
```

### 마감

**소켓에 pane 이 하나도 없을 때만** 서버를 거둔다. 이 규칙의 정본은 이 절이다(`references/closing.md` 4번이 가리킨다).

```bash
[ -z "$("$TM" -L dflow list-panes -a -F '#{pane_id}' 2>/dev/null)" ] && "$TM" -L dflow kill-server
```

이 소켓은 **사용자 단위**이지 리포 단위가 아니다. 자기 슬롯 표만 보고 `kill-server` 를 하면 **다른 체크아웃의 살아 있는
팀원이 미커밋 산출물을 안은 채 죽는다.** 결과 처리가 끝난 pane 을 `kill-pane` 으로 거두므로, 팀원이 모두 끝났고 다른
팀장도 없으면 목록이 비어 서버가 거둬진다. 하나라도 남으면 서버를 남기고(대가는 서버 하나), 다음 팀장의 재구성이 그 pane
들을 흡수한다. `.dflow-agent` 가 없는 워크트리를 가리키는 pane 은 고아이므로 전제 검사가 찾아 보고한다.

### 정리

워크트리가 아직 있을 때만 팀장 체크아웃에서 한다.
```bash
git worktree remove --force "$WT"
```
`--force` 는 미추적 부산물(`.result`·`.dflow-agent`·`.dflow-prompt`·`.dflow-pane`·`.dflow-run`·`.dflow.local`
(레거시 `.env`) 링크·`.dflow` 링크·스킬 링크) 때문에 필요하다. 먼저 「고아 정리 규칙」 을 따른다. 살아 있는 팀원의 워크트리는 지우지 않는다.

## pane(Orca)

Orca 안에서 띄운 팀장은 이 백엔드를 먼저 고른다(SKILL.md 「0. 환경 감지」). `git worktree add --detach` 로 만든 순수 git
워크트리를 `orca terminal create --worktree path:<WT> --command ./.dflow-run --json` 이 받아들이고(핸들은
`.result.terminal.handle`), 새 탭의 claude 는 권한 확인 생략 모드로 포인터를 첫 입력으로 받아 착수하며, `orca terminal close
--terminal <핸들> --tab --json` 이 `ptyKilled:false` 로 답해도 claude 프로세스는 실제로 끝난다. 그래서 Orca 도 tmux 와 같은
방식으로 spawn·회수·재투입한다(`references/restart.md` 「Orca」).

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
- `<기본브랜치>`(준비 블록의 `git worktree add` 기점)는 SKILL.md 「1. 시작」 전제 검사가 구한 이름이다(agent 브랜치가 결국
  머지될 곳이다).
- 포인터는 SKILL.md 「5. 팀원 spawn」 의 한 줄 그대로이며 준비 블록이 이미 `$WT/.dflow-prompt` 에 썼다(큰따옴표·`$`·백틱이
  없다). 첫 입력으로 자동 제출되어 팀원이 바로 착수한다. `--title` 로 tmux 와 같은 이름표를 붙인다.
- 핸들 필드는 `result.terminal.handle` 을 먼저 본다. 옛 런타임은 이 필드 대신
  `result.agentTerminalHandle` 만 주거나(`result.startupTerminal.handle` 만 주는 더 옛 런타임도 있다) 아무것도
  주지 않는다. 셋 다 없으면 `handle` 을 `-` 로 두고, 화면 읽기 없이 git·서버 증거만 쓴다.
- **`$WT/.dflow-pane` 에 핸들을 쓴다**(tmux 가 pane id 를 쓰는 자리와 같게. 재개·재투입·회수가 백엔드를 가리지 않고 같은
  파일에서 대상을 찾는다).
- `team.spawn` 의 `handle` 표기는 events.md 가 이미 정한 형식(raw "Orca 터미널 핸들", `orca:` 접두 없음)을 그대로 쓴다.
- 이후 이 워크트리를 가리킬 때는 `--worktree "path:$WT"` 선택자를 쓴다.
- 팀원 화면 보기(보고용): `orca terminal read --terminal <handle>`(생존 증거로는 쓰지 않는다).

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
`I trust this folder` 가 보이면 "사람 확인 필요" 로 보고하고 넘어간다 — 그 탭에서 사람이 직접 답해야 한다. 이미 신뢰된
리포(`<MAIN>`) 아래에서는 뜨지 않지만 다른 부모 경로에서는 뜰 수 있어 루프를 남긴다. `bypass permissions on` 이 보이면
통과다. 화면 문자열에 기대는 한계는 tmux 와 같다.

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
먼저 있던 브랜치는 보존한다), 아니면(새 방식) tmux 와 같은 `git worktree remove --force` 다. 미커밋분을 잃으므로 먼저
「고아 정리 규칙」 을 따른다. 옛 방식의 `orca worktree rm` 에는 `--force` 를 「고아 정리 규칙」 1번(부트스트랩 실패)에서만
붙인다. 두 갈래 모두 브랜치 삭제는 강제하지 않는다. `orca worktree list --json` 의 모양은 `{result:{worktrees:[{path,…}]}}` 다.

## 고아 정리 규칙

두 백엔드 공통이다. 대상은 루트 `.dflow-agent` 값이 `<신원>/<host>/` 로 시작하는 워크트리(`parked` 포함)다.
결과 처리(done·needs-merge·skipped·failed·cancelled), 고아 스캔, 무응답 자동 정리, 마감이 이 규칙으로 팀원 워크트리를
지운다. **아래에서 "Orca 정리 명령"은 「pane(Orca)」 「정리」의 전환 규칙(경로가 `orca worktree list --json` 에
있으면 `orca worktree rm --worktree path:<경로>`, 없으면(새 방식) `git worktree remove --force <경로>`)을
가리키는 줄임말이다.**
0. **설계 완료 대기**(`<TASKS>/*/state.json` 이 `phase=wait_pred`, `references/design-ahead.md`): 깨끗하고 push 됐어도 **지우지 않는다**
   (결과 처리·고아 스캔·마감 모두). 선행이 끝나면 같은 워크트리로 이어 구현한다 — 지우면 재개가 의존성 설치·기준선부터 다시 한다.
   `.dflow-agent` 는 `parked` 로 둔다. 아래 1~5번을 보지 않는다.
1. **부트스트랩 실패**(`.result` 의 branch 칸이 `-`, 브랜치를 만들기 전에 끝남): 미커밋 목록이 알려진
   부산물(`.dflow-agent`, `.dflow-prompt`, `.dflow-pane`, `.dflow-run`, `.result`, `.issues`, `<TASK_DIR>/spec.md`
   캐시, `.dflow.local`(레거시 `.env`) 링크, `.dflow` 링크, 스킬 링크(`.claude/skills` 또는 그 안의 `dflow-dev`·`dflow-work`))뿐일 때만 정리한다
   (tmux 는 `git worktree remove --force`, Orca 는 Orca 정리 명령에 `--force` 를 붙인다). 두 백엔드
   모두 `--force` 를 쓴다(`spec.md` 캐시·스킬 폴더 안의 개별 링크는 `info/exclude` 가 가리지 않는다). Orca 의 `--force` 는
   워크트리 강제 제거만 하고 브랜치 삭제는 강제하지 않는다.
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
   `git branch -D` 는 다른 워크트리가 체크아웃한 브랜치를 거부하므로 그런 브랜치는 남는다.
   `origin/<기본브랜치>` 의 조상인 것만 지운다(이름만 맞는 브랜치의 고유 커밋을 잃지 않는다).
   id8 을 모르면(컨텍스트 압축으로 이름을 잃은 경우) 위 루프의 첫 줄만
   `git branch --format='%(refname:short)' --list '*dflow-[0-9a-f]*'` 로 바꿔 돌린다. 앞의 `*` 는 Orca 가 이름 앞에
   다른 접두를 붙일 수 있어서이고, `dflow-` 뒤를 16진수로 한정해 `worktree-dflow-team` 같은 개발 브랜치를
   후보에서 뺀다. 세 안전 조건(`agent/` 아님, 체크아웃 안 됨, `origin/<기본브랜치>` 의 조상)은 루프가
   그대로 지킨다.

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

