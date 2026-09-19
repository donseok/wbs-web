# /dflow-team 백엔드: spawn·정리 명령 정본

SKILL.md 「0. 환경 감지」 가 백엔드를 고른다. 워커 프롬프트·`.result` 계약·`/dflow-dev --worker` 는 두
백엔드가 같다. 백엔드가 가르는 것은 아래 차이표의 항목뿐이다.

백엔드는 둘이다. 팀장이 Orca 안에 있으면 **pane(Orca)** 를 쓰고, Orca 밖이면 **pane(tmux)** 를 쓴다.

## 차이표

| 항목 | pane(tmux) | pane(Orca) |
|---|---|---|
| 팀원 정체 | 팀장이 tmux pane 에 띄운 대화형 claude 메인 에이전트(권한 확인 생략 모드) | Orca 탭의 claude 메인 에이전트(권한 확인 생략 모드) |
| 워크트리 | 팀장이 `git worktree add --detach` 로 `<MAIN>/.claude/worktrees/dflow-<id8>` 를 `origin/<기본브랜치>` 기점으로 만든다. 브랜치를 만들지 않는다 | `orca worktree create` 가 `origin/<기본브랜치>` 기점으로 `<MAIN>/dflow-<id8>`(리포 루트 바로 아래)에 만들고 브랜치 `<사용자>/dflow-<id8>` 도 만든다. 전제 검사의 exclude `/dflow-*/` 가 이 폴더를 가린다 |
| 기상 신호 | 감시 루프의 `RESULT_READY`·`PANE_DEAD` | 감시 루프의 `RESULT_READY` |
| `blocked` 이후 | 팀원은 pane 에서 멈춰 기다린다 | 팀원은 탭에서 멈춰 기다린다 |
| 슬롯 점유 | `blocked` 동안 슬롯을 계속 잡는다 | 같다 |
| 사람의 답 | 그 pane 에 직접 치거나, 팀장이 `send-keys` 로 넣는다 | 그 팀원 탭에 직접 준다 |
| 회수 | 결과 줄 처리 뒤 `kill-pane -t <pane>` | 없음(Orca 탭) |
| 팀장 세션이 죽으면 | 팀원은 살아남는다(tmux 서버가 따로 돈다). 새 팀장이 재구성에서 `.dflow-pane` 과 `#{pane_start_path}` 로 흡수한다 | 팀원은 살아남는다 |
| 정리 | `git worktree remove --force <경로>` | `orca worktree rm --worktree path:<경로>` |
| 팀원 화면 | `capture-pane -p -t <pane>`(보고용), `-J -S -`(결과 줄 폴백) | `orca terminal read`(보고용) |
| git 호출 | `command -v git` 절대경로 | 같다(두 백엔드 공통) |

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

**spawn**: 워크트리 준비는 팀장 체크아웃에서 한 번의 Bash 호출로 돌린다. `<모델 플래그>` 는 `MODEL` 이
`opus`·`sonnet` 이면 `--model opus`·`--model sonnet`, `default` 면 빈 값이다.

```bash
TM=$(find_tmux)
WT="<MAIN>/.claude/worktrees/dflow-<id8>"
git fetch -q origin && git worktree prune && git worktree add --detach "$WT" origin/<기본브랜치> || echo SPAWN_FAILED_WORKTREE
[ -e "$WT/.env" ] || ln -s "<MAIN>/.env" "$WT/.env"
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
for v in $(env | sed -n 's/^\(ORCA_[A-Z0-9_]*\)=.*/\1/p'); do unset "$v"; done
unset TMUX TMUX_PANE
PATH=$(printf '%s' "$PATH" | tr ':' '\n' | grep -v 'claude-agent-teams-bin' | paste -sd: -)
export PATH
RUNEOF
printf 'exec claude --dangerously-skip-permissions %s "$(cat .dflow-prompt)"\n' '<모델 플래그>' >> "$WT/.dflow-run"
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
- `.env`·스킬 링크를 팀장이 먼저 만드는 이유: claude 는 시작할 때 cwd 의 `.claude/skills` 를 읽으므로, 링크가
  먼저 있어야 팀원의 Skill 도구가 `dflow-dev` 를 안다. 워커 부트스트랩(worker-prompt.md 「3」)의 같은 명령은
  이미 있으면 건너뛴다. 스킬 폴더가 실제 폴더로 있는데 `dflow-dev` 가 없으면 폴더째 링크하지 않고 워커가 쓰는
  스킬만 하나씩 링크한다(있는 폴더에 폴더째 링크를 걸면 `.claude/skills/skills` 가 생긴다).
- Windows(Git Bash) 에서는 `ln -s` 가 링크 대신 복사본을 만든다. 복사본으로도 동작한다: `.env` 는 정적이고
  스킬은 읽기 전용이며, 두 경로 모두 `info/exclude`·`.gitignore` 로 가려진다. 대가로 팀장이 스킬을 고쳐도 이미
  뜬 팀원의 복사본에는 반영되지 않고, 워크트리마다 `.env` 사본이 생기므로 정리 규칙이 워크트리를 지울 때 함께
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

접두째 벗기는 쪽을 택한 이유는 목록을 손으로 관리하면 새 변수가 생길 때 놓치기 때문이다. `CLAUDE` 와
`ORCA_` 로 시작하는 것을 전부 지우고, `TMUX`·`TMUX_PANE` 을 따로 지운다. **`CLAUDE_CODE_` 가 아니라
`CLAUDE` 로 자르는 이유**: 실측에서 `CLAUDECODE`(밑줄 없음)·`CLAUDE_PID`·`CLAUDE_EFFORT`·
`CLAUDE_PLUGIN_DATA` 넷이 `CLAUDE_CODE_` 접두를 벗어나 있었다. `CLAUDE_CONFIG_DIR` 만 예외로 남긴다.
사람이 설정하는 값이라 벗기면 팀원이 다른 설정 디렉터리를 쓴다. 팀원에게 필요한 설정은 모두
`~/.claude/settings.json` 과 워크트리의 `.env` 에서 오므로 잃는 것이 없다. PATH 에서 shim 디렉터리를 빼도
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

**결과 줄과 죽은 pane 폴백**: 결과는 `<워크트리>/docs/tasks/<TSK>/.result` 다. pane 이 죽었는데 파일이 없으면
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
`--force` 는 미추적 부산물(`.result`·`.dflow-agent`·`.dflow-prompt`·`.dflow-pane`·`.dflow-run`·`.env` 링크·
스킬 링크) 때문에 필요하다. 먼저 「고아 정리 규칙」 을 따른다. 살아 있는 팀원의 워크트리는 지우지 않는다.

## pane(Orca)

tmux 를 찾지 못한 Orca 환경에서만 이 백엔드로 온다. 그런 조합이 실제로 있는지는 확인된 바 없다.

**spawn**
```bash
orca worktree create --name dflow-<id8> --agent claude --no-parent \
  --base-branch origin/<기본브랜치> --prompt "<포인터 한 줄>" --json
```
- `<기본브랜치>` 는 SKILL.md 「1. 시작」 전제 검사가 구한 이름이다(`origin/HEAD`, 없으면 `git ls-remote --symref`). 기점을
  `origin/<기본브랜치>` 로 명시하는 이유: agent 브랜치가 결국 머지될 곳이고, 생략하면 리포 기본 base 로 가는데
  그 설정이 기본 브랜치와 다를 수 있다.
- 포인터는 SKILL.md 「5. 팀원 spawn」 의 한 줄 그대로다. 포인터에는 큰따옴표·`$`·백틱이 없다.
- 포인터가 첫 입력으로 자동 제출되어 팀원이 바로 착수한다.
- 결과 JSON 의 `result.worktree.path`(팀원 cwd)와 `result.agentTerminalHandle` 을 슬롯 표와 `team.spawn` 에
  적는다. 옛 런타임은 `result.agentTerminalHandle` 을 주지 않고 `result.startupTerminal.handle` 만 주거나 둘 다
  주지 않는다. `result.agentTerminalHandle` 이 없으면 `handle` 을 `-` 로 두고, 화면 읽기 없이 git·서버 증거만 쓴다.
  ```bash
  jq -r '.result.worktree.path, (.result.agentTerminalHandle // "-")'
  ```
- 이후 이 워크트리를 가리킬 때는 `--worktree path:<result.worktree.path>` 선택자를 쓴다. 워크트리를 경로로
  지정하므로 다른 식별자는 필요 없다.
- **create 가 끝나면 같은 포인터 한 줄을 `<result.worktree.path>/.dflow-prompt` 에도 쓴다.** `--prompt` 로
  넘긴 것과 같은 줄이며 팀원은 이 파일을 읽지 않는다. 이 파일이 필요한 곳은 재개다. 고아 정리 규칙 3번이
  `.dflow-agent` 를 `parked` 로 덮으면 슬롯 번호가 그 파일에서 사라지는데, 「5-1. 재개 spawn」 은 그 번호를
  `.dflow-prompt` 의 `AGENT_ID=` 에서 되찾는다. tmux 백엔드는 spawn 절차가 이미 이 파일을 쓴다.
  ```bash
  printf '%s\n' '<포인터 한 줄>' > '<result.worktree.path>/.dflow-prompt'
  ```
- 팀원 화면 보기(사람에게 보여 줄 보고용): `orca terminal read --screen --terminal <handle>`.
  **화면은 생존 증거로 쓰지 않는다.** 스피너 때문에 화면이 매번 달라져 멈춘 팀원도 살아 있는 것처럼 보이기
  때문이다. 생존 증거는 SKILL.md 「3. 결과 처리」 의 셋(브랜치 tip 커밋 시각·서버 progress·미커밋 변경 목록)이다.

**정리**
```bash
orca worktree rm --worktree path:<경로>
orca worktree list        # 누수 확인. dflow-<id8> 가 남아 있으면 같은 명령으로 지운다
```
워크트리와 디렉터리를 지우고, 체크아웃된 로컬 브랜치만 삭제를 시도한다. 머지됐음을 입증하지 못하는 브랜치와
워크트리보다 먼저 있던 브랜치는 보존한다. 미커밋분을 잃으므로 먼저 「고아 정리 규칙」 을 따른다. `--force` 는
「고아 정리 규칙」 1번(부트스트랩 실패)에서만 붙인다. 워크트리 강제 제거만 하고 브랜치 삭제는 강제하지 않는다.

## 고아 정리 규칙

두 백엔드 공통이다. 대상은 루트 `.dflow-agent` 값이 `<신원>/<host>/` 로 시작하는 워크트리(`parked` 포함)다.
결과 처리(done·needs-merge·skipped·failed·cancelled), 고아 스캔, 무응답 자동 정리, 마감이 이 규칙으로 팀원 워크트리를
지운다.
1. **부트스트랩 실패**(`.result` 의 branch 칸이 `-`, 브랜치를 만들기 전에 끝남): 미커밋 목록이 알려진
   부산물(`.dflow-agent`, `.dflow-prompt`, `.dflow-pane`, `.dflow-run`, `.result`, `docs/tasks/<TSK>/spec.md`
   캐시, `.env` 링크, 스킬 링크(`.claude/skills` 또는 그 안의 `dflow-dev`·`dflow-work`))뿐일 때만 정리한다
   (tmux 는 `git worktree remove --force`, Orca 는 `orca worktree rm --worktree path:<경로> --force`). 두 백엔드
   모두 `--force` 를 쓰는 이유: 알려진 부산물 중 `spec.md` 캐시와 스킬 폴더 안의 개별 링크는 공유 `info/exclude` 가
   가리지 않는 미추적 파일이라 `--force` 없이는 제거가 거부될 수 있다. Orca 의 `--force` 는 워크트리 강제 제거만
   하고 브랜치 삭제는 강제하지 않는다.
   ```bash
   git -C <워크트리> status --porcelain --untracked-files=all \
     | grep -v -E '^\?\? (\.dflow-(agent|prompt|pane|run)|\.env|\.claude/skills(/dflow-(dev|work)(/.*)?)?|docs/tasks/<TSK>/(spec\.md|\.result))$'
   ```
   출력이 비어 있어야 한다. 그 밖의 변경이 있으면 보존하고 경로와 목록을 보고한다. 이유: 브랜치가 없어도
   워커가 무언가를 고쳤다면 그것은 사람이 판단할 산출물이다.
2. **그 밖**: 아래 두 조건이 모두 참일 때만 정리한다.
   ```bash
   git -C <워크트리> status --porcelain       # 비어 있어야 한다. 부산물은 info/exclude 로 가려져 있다
   git fetch origin
   test "$(git -C <워크트리> rev-parse HEAD)" = "$(git -C <워크트리> rev-parse origin/<agent 브랜치>)"
   ```
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
5. **생성 브랜치 정리**: 워크트리를 지웠으면 그 워크트리를 만들 때 생긴 브랜치를 지운다. Orca 는 이름에
   `dflow-<id8>` 이 든 브랜치다. tmux 워크트리는 `--detach` 로 만들어 생성 브랜치가 없다. `agent/` 로 시작하는
   브랜치는 지우지 않는다(작업 산출물이다).
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
| `.env`·스킬 링크 | 심링크 | `ln -s` 가 복사본을 만든다. 복사본으로 동작한다(「pane(tmux)」 spawn) |
| 필요한 명령 | bash·coreutils·tmux·git·jq·curl | Git for Windows 의 bash·coreutils 와 MSYS2 tmux·git·jq·curl |

- **Windows tmux 미검증**: MSYS2 tmux 가 Git Bash 에서 실제로 도는지 확인한 적이 없다. Git for Windows 기본
  구성이 아니고, tmux 자체의 Windows 제약도 알려져 있다. 검증 전까지 Windows 는 「돌 수도 있다」 로 둔다.
  WSL 은 Linux 로 취급되므로 그대로 돈다.
- **`ln -s`**: 복사본을 만든다(파일·폴더 모두). `MSYS=winsymlinks:nativestrict` 를 주면 진짜 심링크가
  되지만 설계는 복사본을 전제로 한다.
- **줄끝**: Windows 기본 `core.autocrlf=true` 클론은 스크립트를 CRLF 로 바꾼다. 킷과 설치 대상의
  `.gitattributes`(install.sh 가 넣는다)가 LF 로 고정하고, `dflow.sh`·heartbeat 훅이 `.env` 값의 `\r`
  을 걷어낸다.
- **미확인**: 실제 Windows Claude Code 세션의 Bash 도구가 `CLAUDE_PID` 를 내보내는지는 러너에서 잴 수
  없었다(세션이 없다). 그래서 전제 검사가 `NO_CLAUDE_PID` 로 막는다(SKILL.md 「1. 시작」 전제 검사).
