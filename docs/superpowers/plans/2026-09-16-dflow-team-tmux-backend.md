# /dflow-team tmux pane 백엔드 구현 계획

> **에이전트 작업자에게:** 이 계획은 `superpowers:executing-plans` 또는
> `superpowers:subagent-driven-development` 로 Task 단위로 실행한다. 단계는 체크박스(`- [ ]`)로 추적한다.

**목표:** `/dflow-team` 의 팀원 실행 방식을 tmux pane 으로 바꾸고 `claude -p` 프로세스 백엔드를 없앤다.

**접근:** 산출물은 전부 문서(에이전트가 읽고 그대로 실행하는 스킬 프롬프트)다. 실행 코드가 아니므로 단위
시험이 없고, 대신 **셸 블록 문법 검사**(`sh -n`)와 **참조 일관성 grep**(사라진 이름이 남아 있지 않은지)이
그 자리를 대신한다. `references/backends.md` 의 「pane(tmux)」 절을 먼저 확정해 명령 정본을 굳히고, 그다음
`SKILL.md` 가 그것을 참조하는 자리들을 고친다. SKILL.md 의 참조 지점이 많아 정본이 흔들리면 두 번 고치게 된다.

**대상:** `.claude/skills/dflow-team/` 의 SKILL.md·references 3종, `docs/superpowers/specs/2026-09-10-dflow-team-design.md`,
`docs/agent/2026-09-16-agent-loop-e2e-test.md`, 그리고 `scripts/kit-build.sh` 로 재빌드하는 dflow-kit.

**설계 정본:** `docs/superpowers/specs/2026-09-16-dflow-team-tmux-pane-design.md`

---

## 전역 제약

설계 문서에서 그대로 옮긴 값이다. 모든 Task 의 요구사항에 암묵적으로 포함된다.

- **전용 소켓은 `-L dflow`** 하나다. 다른 소켓 이름을 쓰지 않는다. probe 만 `-L "dflowprobe$$"` 를 쓴다.
- **세션·window 이름은 `dflow`**, 팀원마다 pane 하나, 정렬은 `tiled`.
- **팀원은 언제나 `--dangerously-skip-permissions`** 로 뜬다. 팀장 세션의 권한 모드를 보지 않는다.
- **감지 순서는 tmux 가 먼저, Orca 가 나중**이다. `TMUX` 환경변수는 감지에 쓰지 않는다.
- **백엔드 이름은 `tmux` 와 `orca`** 두 값이다(종전 `pane`·`process` 를 대체). `team.start.backend` 와
  시작 보고가 이 값을 쓴다.
- **`handle` 형식은 `tmux:<pane_id>`**(예: `tmux:%3`)와 Orca 터미널 핸들 둘이다.
- **새 부산물은 `.dflow-pane`**(한 줄, pane id)**과 `.dflow-run`**(실행 스크립트) 둘이다.
  사라지는 부산물은 `.dflow-pid`·`.dflow-worker.log` 둘이다. `.dflow-prompt` 는 그대로 쓴다.
- **확인한 판본**: Darwin 25.6.0, tmux 3.7c, Claude Code v2.1.273, Orca 1.4.190. 화면 문자열에 기대는
  판정(폴더 신뢰 확인)은 이 판본을 문서에 명시한다.
- **커밋 규칙**(CLAUDE.md): `git add -A` 금지, 파일명을 명시해 stage 한다. 마이그레이션과 코드를 섞지
  않는다(이번 작업에는 마이그레이션이 없다). 커밋 메시지는 한국어로 "왜"를 적는다.
- **작업 브랜치는 `staging`** 이다. 주행은 킷 설치 방식이므로 **main 머지와 킷 재빌드 뒤**에야 시작할 수 있다
  (Task 9·10).

### 설계 문서에 없던 보정 8건

설계 문서를 쓴 뒤 검토에서 나온 것이다. 해당 Task 에서 반영한다.

| | 보정 | 반영 Task |
|---|---|---|
| 1 | **`NO_CLAUDE_CLI` 를 지우지 않는다.** 설계 §9 의 제거 근거가 틀렸다. `.dflow-run` 이 `exec claude` 를 하므로 tmux 백엔드는 `claude` 가 PATH 에 **더** 필요하다. 지우면 실패가 `pane_dead_status=127` 로만 드러난다. tmux 갈래에 건다 | 2 |
| 2 | **`.dflow-run` 에 모델 플래그를 넣는다.** `MODEL` 은 사용자 인자(`18시까지 opus`)이고 프로세스 백엔드는 `claude -p --model` 에 붙였다. 설계 §4 의 블록에 빠져 있다 | 1 |
| 3 | **죽은 pane 폴백은 `capture-pane -p -J -S -`** 로 읽는다. 기본 캡처는 보이는 영역뿐이라 결과 줄이 스크롤아웃되면 못 찾고, 줄바꿈된 결과 줄은 잘린다. 이 폴백이 약해지면 `failed not-isolated` 가 도달 불가 status 가 된다 | 1·4 |
| 4 | **사람 답은 `send-keys -l --` 로 넣는다.** `send-keys -t <pane> '<답>' Enter` 는 답을 키 이름으로 해석한다. 답에 `;` 가 들어가면 그 자리에서 명령이 끊긴다. 신뢰 확인의 `Down`·`Enter` 는 키 이름이 맞으므로 그대로 둔다 | 1·4 |
| 5 | **감시 루프에 tmux 절대경로를 리터럴로 박는다.** 루프는 `run_in_background` 의 별도 셸이라 `find_tmux` 결과를 물려받지 않고, PATH 에 shim 이 살아 있을 수 있다 | 3 |
| 6 | **`CLAUDE_PID`·`NO_CLAUDE_PID` 는 남긴다.** 잠금 소유 판정용이며 프로세스 생존과 무관하다. `pstart`·`LEAD_SKIP_PERMISSIONS` 와 함께 쓸려 나가기 쉽다 | 2 |
| 7 | **`team.answer` 이벤트는 남긴다.** `send-keys` 로 답을 넣은 뒤 컨텍스트가 압축되면, 재구성이 `team.blocked` 만 보고 같은 질문을 사람에게 다시 통지한다 | 5 |
| 8 | **`.dflow-run` 의 PATH 스트립은 안전하다.** 실측으로 `~/.orca/claude-agent-teams-bin/` 에는 `tmux` 하나뿐이고 `claude` 는 `/opt/homebrew/bin/claude` 다. 스트립해도 claude 해석이 살아 있다 | 1 |

---

## 파일 구조

| 파일 | 책임 | 변경 성격 |
|---|---|---|
| `.claude/skills/dflow-team/references/backends.md` | 백엔드별 spawn·정리 명령의 **정본**. 차이표, 고아 정리 규칙, 플랫폼 차이 | 「프로세스」 절을 「pane(tmux)」 절로 대체. 차이표·플랫폼 표 개정 |
| `.claude/skills/dflow-team/SKILL.md` | 팀장 절차 전체. backends.md 를 참조한다 | 감지·전제 검사·재구성·감시 루프·결과 처리·spawn·blocked·마감·금지·frontmatter |
| `.claude/skills/dflow-team/references/events.md` | 이벤트 스키마와 기록 명령 | `backend`·`handle` 값 집합 |
| `.claude/skills/dflow-team/references/worker-prompt.md` | 팀원 규칙. 팀장은 포인터로만 넘긴다 | `{BACKEND}` 값 집합, `{ANSWER}` 제거, `blocked` 이후 표 |
| `docs/superpowers/specs/2026-09-10-dflow-team-design.md` | 상위 설계 정본 | tmux·프로세스 백엔드를 언급하는 7곳 |
| `docs/agent/2026-09-16-agent-loop-e2e-test.md` | 주행 기록지 | 단계 16 에 tmux 칸 복원, 파라미터 표, R15 |
| `scripts/kit-build.sh` | dflow-kit 빌드. `origin/main` 임시 워크트리에서 돈다 | 변경 없음. **실행**만 한다(Task 10) |

---

### Task 1: backends.md — 「pane(tmux)」 절 신설과 「프로세스」 절 제거

명령 정본을 먼저 굳힌다. 이후 Task 들이 이 절을 참조한다.

**파일:**
- 수정: `.claude/skills/dflow-team/references/backends.md`

**인터페이스:**
- 산출: `find_tmux()` 함수, `.dflow-run` 내용, spawn 블록, 생존·화면·답·회수 명령, 고아 정리 규칙의
  부산물 목록. Task 2~4 가 이 이름들을 그대로 참조한다.

- [ ] **단계 1: 머리말과 차이표 개정 (1-22행)**

6행 "tmux pane 백엔드는 지원하지 않는다(tmux 에서도 프로세스 백엔드로 돈다)." 를 아래로 바꾼다.

```
백엔드는 둘이다. **pane(tmux)** 가 기본이고, tmux 가 없는 Orca 환경에서만 **pane(Orca)** 를 쓴다.
```

차이표(10-22행)를 아래로 바꾼다. 종전 「프로세스」 열이 사라지고 「pane(tmux)」 열이 들어온다.

| 항목 | pane(tmux) | pane(Orca) |
|---|---|---|
| 팀원 정체 | 팀장이 tmux pane 에 띄운 대화형 claude 메인 에이전트(권한 확인 생략 모드) | Orca 탭의 claude 메인 에이전트(권한 확인 생략 모드) |
| 워크트리 | 팀장이 `git worktree add --detach` 로 `<MAIN>/.claude/worktrees/dflow-<id8>` 를 `origin/<기본브랜치>` 기점으로 만든다. 브랜치를 만들지 않는다 | `orca worktree create` 가 `origin/<기본브랜치>` 기점으로 만든다 |
| 기상 신호 | `RESULT_READY`·`PANE_DEAD` | `RESULT_READY` |
| `blocked` 이후 | 팀원은 pane 에서 멈춰 기다린다 | 팀원은 탭에서 멈춰 기다린다 |
| 슬롯 점유 | `blocked` 동안 슬롯을 계속 잡는다 | 같다 |
| 사람의 답 | 그 pane 에 직접 치거나, 팀장이 `send-keys` 로 넣는다 | 그 팀원 탭에 직접 준다 |
| 회수 | 결과 줄 처리 뒤 `kill-pane -t <pane>` | 없음(Orca 탭) |
| 팀장 세션이 죽으면 | 팀원은 살아남는다(tmux 서버가 따로 돈다). 새 팀장이 재구성에서 `#{pane_start_path}` 로 흡수한다 | 팀원은 살아남는다 |
| 정리 | `git worktree remove --force <경로>` | `orca worktree rm --worktree path:<경로>` |
| 팀원 화면 | `capture-pane -p -t <pane>`(보고용), `-J -S -`(결과 줄 폴백) | `orca terminal read`(보고용) |
| git 호출 | `command -v git` 절대경로 | 같다 |

- [ ] **단계 2: 「pane(tmux)」 절 신설 — 「pane(Orca)」 절 앞에 넣는다**

아래 내용을 그대로 쓴다.

````markdown
## pane(tmux)

팀원은 팀장이 전용 tmux 소켓(`-L dflow`)의 pane 에 띄운 **대화형** claude 메인 에이전트다. Agent 도구
서브에이전트로 띄우지 않는다. 이유: 서브에이전트는 자기 턴이 끝나면 하네스가 완료로 보고, 그 뒤에 끝난 Phase
손자의 완료가 서브에이전트를 깨우지 못해 Phase 손자를 기다리다 멈춘다(리허설 실측). 별도 프로세스의 메인
에이전트는 손자 완료 알림으로 다시 깨어나고(실측), 팀장 세션이 죽어도 살아남는다.

### 진짜 tmux 찾기

Orca 는 PATH 앞에 tmux shim 을 끼운다. 그 shim 은 `orca agent-teams-tmux` 로 위임하는 셸 스크립트이며,
Claude Code 자체 에이전트 팀이 쓰는 부분집합만 처리하고 나머지를 `unsupported command` 로 거부한다.
**`tmux -V` 는 거짓 버전을 답하므로** 버전으로는 가릴 수 없다(실측: shim `3.4`, 실제 `3.7c`).

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
for v in $(env | sed -n 's/^\(CLAUDE_CODE_[A-Z0-9_]*\)=.*/\1/p'); do unset "$v"; done
for v in $(env | sed -n 's/^\(ORCA_[A-Z0-9_]*\)=.*/\1/p'); do unset "$v"; done
unset TMUX TMUX_PANE
PATH=$(printf '%s' "$PATH" | tr ':' '\n' | grep -v 'claude-agent-teams-bin' | paste -sd: -)
export PATH
exec claude --dangerously-skip-permissions <모델 플래그> "$(cat .dflow-prompt)"
RUNEOF
chmod +x "$WT/.dflow-run"
if "$TM" -L dflow has-session -t dflow 2>/dev/null; then
  PANE=$("$TM" -L dflow split-window -t dflow -c "$WT" -P -F '#{pane_id}' './.dflow-run')
else
  "$TM" -L dflow new-session -d -s dflow -n dflow -x 200 -y 60 -c "$WT" './.dflow-run'
  "$TM" -L dflow set-option -t dflow remain-on-exit on
  PANE=$("$TM" -L dflow list-panes -t dflow -F '#{pane_id}' | head -1)
fi
"$TM" -L dflow select-layout -t dflow tiled
printf '%s\n' "$PANE" > "$WT/.dflow-pane"
cat "$WT/.dflow-pane"
```

- **전용 소켓 `-L dflow`** 라 팀장이 tmux 안이든 밖이든 코드 경로가 하나다. 사람의 기존 tmux 세션도 건드리지
  않는다. 서버가 없으면 `new-session`, 있으면 `split-window` 로 갈리는 분기 한 줄이 전부다.
- `-x 200 -y 60` 은 detached 동안의 가상 크기다. 사람이 붙으면 클라이언트 크기를 따른다. 팀장이
  `capture-pane` 으로 읽을 때 이 크기가 쓰이므로 좁게 두지 않는다.
- `remain-on-exit on` 은 죽은 pane 을 남긴다. 팀원이 무슨 말을 남기고 끝났는지 읽을 수 있고, 종료 코드도
  `#{pane_dead_status}` 로 얻는다.
- `exec` 로 셸을 claude 로 대체해 `pane_pid` 가 곧 claude 가 된다.
- 팀원을 띄우는 명령을 `.dflow-run` 파일에 써 두는 이유: 셸 인용을 한 겹 줄이고, 사람이 pane 에서 무엇이
  돌고 있는지 읽을 수 있다. 프롬프트도 `.dflow-prompt` 파일 경유라 따옴표·백틱을 걱정하지 않는다.
- `claude "<프롬프트>"` 는 대화형 세션을 띄우면서 그 문자열을 첫 턴으로 제출한다(실측). `-p` 를 쓰지 않으므로
  세션은 대화형으로 남는다.
- `.env`·스킬 링크를 팀장이 먼저 만드는 이유: claude 는 시작할 때 cwd 의 `.claude/skills` 를 읽으므로, 링크가
  먼저 있어야 팀원의 Skill 도구가 `dflow-dev` 를 안다. 스킬 폴더가 실제 폴더로 있는데 `dflow-dev` 가 없으면
  폴더째 링크하지 않고 워커가 쓰는 스킬만 하나씩 링크한다(있는 폴더에 폴더째 링크를 걸면
  `.claude/skills/skills` 가 생긴다).
- Windows(Git Bash) 에서는 `ln -s` 가 링크 대신 복사본을 만든다. 복사본으로도 동작한다: `.env` 는 정적이고
  스킬은 읽기 전용이며, 두 경로 모두 `info/exclude`·`.gitignore` 로 가려진다.
- `git worktree add` 가 실패하면(`SPAWN_FAILED_WORKTREE`, 대개 같은 경로가 남아 있음) 띄우지 않고 경로를
  보고한다. 같은 id8 의 옛 워크트리는 결과 처리가 지웠거나 `parked` 로 남아 있다.
- `team.spawn` 의 `worktree` 는 `$WT`, `handle` 은 `tmux:<pane_id>` 다(예: `tmux:%3`).
- 팀원 프로세스는 팀장 세션 안에 나타나지 않는다. ListAgents 에 팀원도 손자도 없다. 손자 Phase 서브에이전트는
  팀원의 서브에이전트이므로 팀원이 스스로 회수한다.

**폴더 신뢰 확인**: 대화형 claude 는 처음 보는 디렉터리에서 신뢰 확인을 띄운다.
**`--dangerously-skip-permissions` 로 넘어가지 않는다** — 그 대화상자는 `-p` 를 쓰거나 stdout 이 TTY 가 아닐
때만 건너뛴다(`claude --help`). 팀원 워크트리는 매번 새 경로이므로 매번 뜬다. spawn 직후 팀장이 화면을 읽어
확인이 보이면 답을 보낸다.

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
멈춘 채 살아 있으므로 무응답 자동 정리가 가려낸다. 확인한 판본은 v2.1.273 이다. `~/.claude.json` 의
`hasTrustDialogAccepted` 를 미리 넣는 길은 택하지 않았다. 그 파일은 212KB 이고 여러 세션이 동시에 쓰기 때문에,
읽고 고쳐 쓰는 사이에 남의 변경을 잃는다.

**팀원 환경을 벗기는 이유**: 팀원 pane 은 팀장의 환경을 통째로 물려받는다. 실측에서 `ORCA_AGENT_TEAMS_*`
다섯 개와 `CLAUDE_CODE_*` 아홉 개가 넘어갔고 PATH 에도 shim 디렉터리가 남았다.

| 남는 것 | 깨지는 것 |
|---|---|
| `CLAUDE_CODE_CHILD_SESSION` | **팀원의 대화 기록이 저장되지 않는다.** 화면에 `Transcript saving is off` 가 뜬다 |
| `CLAUDE_CODE_MESSAGING_SOCKET`·`TOKEN` | 팀원이 팀장의 메시징 채널에 붙는다 |
| `CLAUDE_CODE_SESSION_ID`·`BRIDGE_SESSION_ID` | 팀원이 팀장의 세션 ID 를 자기 것으로 쓴다 |
| `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS` | 팀원이 자기 팀을 만들려 든다 |
| `ORCA_AGENT_TEAMS_TEAM_ID`·`TOKEN`·`LEADER_PANE` | 팀원이 자기를 Orca 팀 리더의 pane 으로 오인할 여지가 있다 |
| PATH 의 `claude-agent-teams-bin` | 팀원이 tmux 를 부르면 Orca shim 이 잡는다 |

접두째 벗기는 이유는 목록을 손으로 관리하면 새 변수가 생길 때 놓치기 때문이다. 팀원에게 필요한 설정은 모두
`~/.claude/settings.json` 과 워크트리의 `.env` 에서 오므로 잃는 것이 없다. PATH 에서 shim 디렉터리만 빼도
`claude` 해석은 안전하다(실측: 그 디렉터리에는 `tmux` 하나뿐이다).

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

- **화면은 생존 증거로 쓰지 않는다.** 스피너 때문에 멈춘 팀원도 매번 달라 보인다. 생존 증거는 SKILL.md
  「3. 결과 처리」 의 셋(브랜치 tip 커밋 시각·서버 progress·미커밋 변경 목록)이다.
- 답을 `-l --` 로 넣는 이유: `send-keys -t <pane> '<답>' Enter` 는 답을 키 이름으로 해석한다. 답에 `;` 가
  들어가면 그 자리에서 명령이 끊기고, 한 단어 답이 우연히 키 이름이면 키로 들어간다. 신뢰 확인의
  `Down`·`Enter` 는 키 이름이 맞으므로 `-l` 없이 보낸다.
- 회수 뒤 `select-layout tiled` 를 다시 도는 이유: 남은 pane 이 빈자리를 메우게 한다.

**결과 줄과 죽은 pane 폴백**: 결과는 `<워크트리>/docs/tasks/<TSK>/.result` 다. pane 이 죽었는데 파일이 없으면
죽은 pane 의 화면 전체에서 `<TSK> <id8> ` 로 시작하는 마지막 줄을 찾는다(워커는 같은 줄을 마지막 응답으로도
출력한다). 그것도 없으면 `failed no-result` 다.

```bash
"$TM" -L dflow capture-pane -p -J -S - -t <pane> 2>/dev/null | grep -E '^<TSK> <id8> ' | tail -n 1
```

`-J` 는 줄바꿈된 줄을 잇고 `-S -` 는 스크롤백 전체를 읽는다. 기본 캡처는 보이는 영역뿐이라 결과 줄이
스크롤아웃되면 못 찾고, 200열에서 줄바꿈된 결과 줄은 앞부분만 잡혀 사유가 잘린다.

**재구성**: 팀장이 컨텍스트를 잃어도 아래 한 줄로 살아 있는 팀원을 흡수한다.
```bash
"$TM" -L dflow list-panes -a -F '#{pane_id} #{pane_dead} #{pane_start_path}' 2>/dev/null
```
`pane_start_path` 가 워크트리 경로이므로 pane 과 작업을 다시 맞출 수 있다. 워크트리 루트의 `.dflow-agent` 와
`.dflow-pane` 이 교차 확인에 쓰인다.

**마감**: 살아 있는 팀원이 없으면 `"$TM" -L dflow kill-server`. 있으면 남긴다. 팀장 세션이 죽어도 팀원이
사는 성질은 tmux 서버가 따로 돌기 때문이다.

**정리**: 워크트리가 아직 있을 때만 팀장 체크아웃에서 한다.
```bash
git worktree remove --force "$WT"
```
`--force` 는 미추적 부산물(`.result`·`.dflow-agent`·`.dflow-prompt`·`.dflow-pane`·`.dflow-run`·`.env` 링크·
스킬 링크) 때문에 필요하다. 먼저 「고아 정리 규칙」 을 따른다. 살아 있는 팀원의 워크트리는 지우지 않는다.
````

- [ ] **단계 3: 「프로세스」 절(57-139행) 통째 삭제**

이 절의 내용은 단계 2 가 대체한다. `pstart` 함수, `.dflow-pid`, `.dflow-worker.log`, `nohup … &`,
`<권한 플래그>` 와 `LEAD_SKIP_PERMISSIONS` 참조가 모두 여기서 사라진다.

- [ ] **단계 4: 고아 정리 규칙의 부산물 목록 갱신 (141-194행)**

`.dflow-pid`·`.dflow-worker.log` 를 `.dflow-pane`·`.dflow-run` 으로 바꾼다. 세 곳이다.

1번 규칙의 산문: `(.dflow-agent, .dflow-pid, .dflow-prompt, .dflow-worker.log, .result, …)` →
`(.dflow-agent, .dflow-prompt, .dflow-pane, .dflow-run, .result, …)`

1번 규칙의 grep 명령:
```bash
git -C <워크트리> status --porcelain --untracked-files=all \
  | grep -v -E '^\?\? (\.dflow-(agent|prompt|pane|run)|\.env|\.claude/skills(/dflow-(dev|work)(/.*)?)?|docs/tasks/<TSK>/(spec\.md|\.result))$'
```

1번 규칙의 정리 명령 문구: "(프로세스는 `git worktree remove --force`, Orca 는 …)" →
"(tmux 는 `git worktree remove --force`, Orca 는 …)"

5번 규칙의 "프로세스 워크트리는 `--detach` 로 만들어 생성 브랜치가 없다" → "tmux 워크트리는 …".

4번 규칙의 "pane 의 `blocked` 워크트리도 여기에 든다(팀원이 탭에서 답을 기다린다)" →
"두 백엔드의 `blocked` 워크트리가 모두 여기에 든다(팀원이 pane 이나 탭에서 답을 기다린다)".

- [ ] **단계 5: 플랫폼 차이 표 개정 (196-225행)**

`pstart` 행과 「권한 확인 생략 감지」 행을 지우고 tmux 행을 넣는다.

| 항목 | macOS·Linux | Windows(Git Bash) |
|---|---|---|
| tmux | 대개 설치되어 있거나 패키지 관리자로 깐다 | **MSYS2 로 따로 깔아야 한다. 미검증** |
| 호스트 이름 | `hostname` 의 첫 점 앞부분(`hostname \| cut -d. -f1`) | 같다. Windows 의 hostname.exe 에는 `-s` 가 없다 |
| 팀장 세션 PID | `CLAUDE_PID`(= `$PPID`) | `CLAUDE_PID`(필수. 없으면 전제 검사가 `NO_CLAUDE_PID` 로 중단) |
| `.env`·스킬 링크 | 심링크 | `ln -s` 가 복사본을 만든다. 복사본으로 동작한다 |
| 필요한 명령 | bash·coreutils·tmux·git·jq·curl | Git for Windows 의 bash·coreutils 와 MSYS2 tmux·git·jq·curl |

표 아래 산문에서 「신호 전달」·「`pstart` 비용」 항목을 지우고 아래를 넣는다.

```
- **Windows tmux 미검증**: MSYS2 tmux 가 Git Bash 에서 실제로 도는지 확인한 적이 없다. Git for Windows 기본
  구성이 아니다. 검증 전까지 Windows 는 「돌 수도 있다」 로 둔다. WSL 은 Linux 로 취급되므로 그대로 돈다.
```

`ln -s`·「줄끝」·「미확인」 항목은 그대로 둔다.

- [ ] **단계 6: 문법 검사**

```bash
cd /Users/jji/project/wbs-web
python3 - <<'PY' .claude/skills/dflow-team/references/backends.md
import re,subprocess,sys,tempfile,os
src=open(sys.argv[1]).read()
blocks=re.findall(r'```bash\n(.*?)```', src, re.S)
bad=0
for i,b in enumerate(blocks):
    if '<' in b and '>' in b: b=re.sub(r'<[^>\n]*>','PLACEHOLDER',b)
    with tempfile.NamedTemporaryFile('w',suffix='.sh',delete=False) as f:
        f.write(b); p=f.name
    r=subprocess.run(['sh','-n',p],capture_output=True,text=True)
    if r.returncode: bad+=1; print(f'--- block {i} ---\n{r.stderr}')
    os.unlink(p)
print('OK' if not bad else f'{bad} block(s) failed')
PY
```

기대: `OK`.

- [ ] **단계 7: 잔재 검사**

```bash
grep -n 'pstart\|dflow-pid\|dflow-worker\.log\|nohup\|claude -p\|LEAD_SKIP_PERMISSIONS\|PROC_DEAD' \
  .claude/skills/dflow-team/references/backends.md
```

기대: 출력 없음.

- [ ] **단계 8: 커밋**

```bash
git add .claude/skills/dflow-team/references/backends.md
git commit -m "refactor(dflow-team): backends.md 를 tmux pane 백엔드로 — 프로세스 백엔드에는 사람이 끼어들 자리가 없다"
```

---

### Task 2: SKILL.md — 감지와 전제 검사

**파일:**
- 수정: `.claude/skills/dflow-team/SKILL.md:149-164`(0. 환경 감지), `:210-214`·`:216-221`·`:242`(전제 검사),
  `:195-197`(info/exclude), `:319-324`(검사 설명), `:336-339`(권한 안내)

**인터페이스:**
- 소비: Task 1 의 `find_tmux()`
- 산출: `BACKEND` 변수(`tmux`·`orca`), `TM` 절대경로, `NO_TMUX` 실패 코드. Task 3~5 가 참조한다.

- [ ] **단계 1: 「0. 환경 감지」 전면 교체 (149-164행)**

````markdown
## 0. 환경 감지 (시작 맨 처음)

백엔드는 tmux 를 **먼저** 보고, 없으면 Orca 를 본다. `TMUX` 환경변수는 감지에 쓰지 않는다. 전용 소켓을 쓰므로
팀장이 tmux 안인지가 무의미하고, Orca 안에서도 `TMUX` 가 채워져 오진의 근원이었기 때문이다.

| 순위 | 조건 | 백엔드 |
|---|---|---|
| 1 | `find_tmux`(backends.md)가 진짜 tmux 절대경로를 돌려준다 | **pane(tmux)** |
| 2 | 못 찾았고 `TERM_PROGRAM=Orca` 이거나 `ORCA_WORKTREE_ID` 가 비어 있지 않다 | pane(Orca) |
| 3 | 그 밖 | `FAIL NO_TMUX` 로 중단하고 설치를 안내한다 |

감지는 「1. 시작」 전제 검사 블록 안에서 한 번에 한다(그 블록이 `TM` 과 `BACKEND` 를 출력한다). 백엔드 이름은
`tmux` 또는 `orca` 이며 시작 보고와 `team.start` 에 남긴다.

**플랫폼**: 이 문서의 셸 블록은 macOS·Linux 와 Windows(Git Bash) 에서 같은 절차로 돈다. Windows 에서만 다른
것(호스트 이름·팀장 세션 PID·심링크·tmux 설치)은 블록 안에서 `uname -s` 로 가르며(`MINGW*|MSYS*|CYGWIN*`),
그 차이의 목록은 backends.md 「플랫폼 차이」 다. WSL 은 Linux 다.
````

- [ ] **단계 2: 전제 검사의 백엔드 갈래 교체 (210-214행)**

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
   TM=$(find_tmux) || TM=
   if [ -n "$TM" ]; then
     BACKEND=tmux
     command -v claude >/dev/null 2>&1 || bad NO_CLAUDE_CLI
   elif [ "${TERM_PROGRAM-}" = Orca ] || [ -n "${ORCA_WORKTREE_ID-}" ]; then
     BACKEND=orca
     { orca worktree create --help | grep -q -- '--agent' && orca worktree create --help | grep -q -- '--prompt'; } || bad ORCA_OLD
   else
     BACKEND=-
     bad "NO_TMUX tmux 를 설치하라(macOS: brew install tmux · Debian/Ubuntu: apt install tmux · Windows: MSYS2 또는 WSL)"
   fi
```

- [ ] **단계 3: 권한 확인 생략 감지 제거 (217-221행)**

`skip=0` 과 그 아래 `case` 블록을 통째로 지운다. 팀원이 언제나 권한 확인 생략 모드이므로 팀장 세션의 모드를
알 필요가 없다. **215-216행의 `LEAD_PID` 와 `NO_CLAUDE_PID` 검사는 남긴다** — 잠금 소유 판정용이며 프로세스
생존과 무관하다.

- [ ] **단계 4: `PRECHECK_OK` 줄 교체 (242행)**

```bash
   echo "PRECHECK_OK lead_pid=$LEAD_PID BACKEND=$BACKEND TM=$TM"
```

- [ ] **단계 5: info/exclude 패턴 교체 (195행)**

```bash
   for p in '**/.claude/worktrees/' '/.dflow-agent' '/.dflow-prompt' '/.dflow-pane' '/.dflow-run' 'docs/tasks/*/.result'; do
```

옛 패턴(`/.dflow-pid`·`/.dflow-worker.log`)은 이미 넣어 둔 리포에 남아 있어도 무해하므로 제거 로직을 넣지
않는다.

- [ ] **단계 6: 검사 설명 문단 개정 (304-324행)**

- 307행 info/exclude 설명: "`/.dflow-pid`·`/.dflow-prompt`·`/.dflow-worker.log` 는 팀장이 spawn 때 쓰는 미추적
  파일" → "`/.dflow-prompt`·`/.dflow-pane`·`/.dflow-run` 은 팀장이 spawn 때 쓰는 미추적 파일". 같은 문장의
  "`**/.claude/worktrees/` 는 프로세스 팀원 워크트리(`dflow-<id8>`)" → "… tmux 팀원 워크트리 …".
- 320행 `NO_CLAUDE_CLI` 설명 교체:
  ```
  - `NO_CLAUDE_CLI`: tmux 백엔드는 팀원을 `.dflow-run` 의 `exec claude` 로 띄우므로 `claude` 가 PATH 에 있어야
    한다. 없으면 pane 이 즉시 죽고 종료 코드 127 만 남는다.
  ```
- 321-324행 `LEAD_SKIP_PERMISSIONS` 설명 전체를 지우고 아래로 대체한다.
  ```
  - `NO_TMUX`: tmux 도 Orca 도 없으면 시작하지 않는다. 팀원을 대화형으로 띄울 수단이 없기 때문이다.
    안내에 설치 명령을 적는다(macOS `brew install tmux`, Debian·Ubuntu `apt install tmux`, Windows 는 MSYS2
    또는 WSL). 종전의 비대화형 프로세스 백엔드는 없앴다. 이유는 설계 문서 §1 이다.
  ```
- 319행 `ORCA_OLD` 설명에 "tmux 를 찾지 못한 Orca 환경에서만 이 갈래로 온다" 를 덧붙인다.

- [ ] **단계 7: 권한 모드 안내 교체 (336-339행)**

```markdown
3. **시작 보고 두 줄**: 백엔드와 무관하게 "팀원은 **권한 확인 생략 모드로** 돕니다. 팀장 세션의 권한 모드와
   무관합니다." 를 알린다. tmux 백엔드면 "화면은 `TMUX= tmux -L dflow attach` 로 볼 수 있습니다." 를 한 줄 더
   알린다. 첫 줄이 중요하다. 팀장을 평소 모드로 띄운 사람도 팀원은 무제한으로 돈다는 사실이 여기서 드러나야
   한다. `TMUX=` 를 앞에 붙이는 이유는 팀장이 이미 tmux 안일 때 중첩 attach 가 거부되기 때문이다.
```

- [ ] **단계 8: 문법 검사와 커밋**

Task 1 단계 6 의 python 블록을 `SKILL.md` 에 대해 돌린다. 기대: `OK`.

```bash
git add .claude/skills/dflow-team/SKILL.md
git commit -m "feat(dflow-team): 환경 감지를 tmux 우선으로 — Orca 밖에서도 대화형 팀원을 띄운다"
```

---

### Task 3: SKILL.md — 재구성과 감시 루프

**파일:**
- 수정: `.claude/skills/dflow-team/SKILL.md:52-147`(팀장 상태), `:409-458`(2-2 감시 루프),
  `:502-511`(기상 표), `:362-366`(2. 머리말)

**인터페이스:**
- 소비: Task 1 의 생존 판정 명령, Task 2 의 `TM`
- 산출: `PANE_DEAD` 기상 신호, `set --` 항목 형식 `path|hash|pane_id`

- [ ] **단계 1: 「팀장 상태」 정본 블록 교체 (71-94행)**

`pstart` 함수와 `.dflow-pid` 판정을 pane 판정으로 바꾼다.

```bash
TM='<진짜 tmux 절대경로>'   # 「1. 시작」 전제 검사가 출력한 값. Orca 백엔드면 빈 값
git worktree list --porcelain | sed -n 's/^worktree //p' | while IFS= read -r w; do
  [ -f "$w/.dflow-agent" ] || continue
  a=$(head -n 1 "$w/.dflow-agent")
  case "$a" in "<신원>/<host>/"*) ;; *) continue ;; esac
  rf=$(find "$w/docs/tasks" -mindepth 2 -maxdepth 2 -name .result 2>/dev/null | head -n 1)
  r=$([ -n "$rf" ] && head -n 1 "$rf")
  b=$(git -C "$w" branch --show-current)
  p=$(head -n 1 "$w/.dflow-pane" 2>/dev/null); alive=-
  if [ -n "$p" ] && [ -n "$TM" ]; then
    d=$("$TM" -L dflow list-panes -t "$p" -F '#{pane_dead}' 2>/dev/null | head -n 1)
    case "$d" in 0) alive=alive ;; *) alive=dead ;; esac
  fi
  printf '%s\t%s\t%s\t%s\t%s\t%s\n' "$a" "$w" "${b:--}" "${r:--}" "${p:--}" "$alive"
done
```

머리말(71행)의 "`pstart` 는 backends.md 「프로세스」 의 시작 시각 함수와 같다." 를 지운다.

- [ ] **단계 2: 정본 설명 갱신 (93-94행)**

```markdown
- tmux 백엔드의 `.dflow-pane`(팀장이 spawn 때 쓴 pane id, backends.md)이 팀원 pane 의 생존을 알려 준다.
  마지막 칸이 `alive` 면 살아 있고, `dead` 면 죽었거나 pane 이 없으며, `-` 면 Orca 팀원이다. 빈 출력과 `1` 을
  함께 `dead` 로 보는 이유: `remain-on-exit` 를 놓친 pane 은 흔적 없이 사라지는데, 그 팀원도 죽은 것이다.
```

- [ ] **단계 3: 상태 목록의 백엔드 문구 교체 (54-57행)**

"터미널 핸들 또는 팀원 프로세스 PID" → "터미널 핸들 또는 pane id", "답을 기다리는 프로세스 `blocked` 작업" →
"답을 기다리는 `blocked` 작업".

- [ ] **단계 4: 재구성 규칙의 프로세스 문단 교체 (120-127행)**

```markdown
- "살아 있는 팀원" 은 spawn 했고 아직 최종 판정(`done`·`needs-merge`·`skipped`·`failed`)을 받지 않은 팀원이다.
  화면이 떠 있는지로 판단하지 않는다. Orca 는 `.dflow-agent` 가 `w<slot>` 인 워크트리 중 최종 status 의
  `.result` 가 없는 것이며, tmux 는 거기에 더해 정본 표의 생존 칸이 `alive` 여야 한다. `blocked` 는 최종
  판정이 아니므로 그 팀원은 두 백엔드 모두 살아 있다. 실제로 죽은 Orca 팀원은 무응답 규칙(「3. 결과 처리」)이
  가려낸다. tmux pane 이 죽었으면(`dead`) 살아 있지 않으며, `.result` 가 있으면 결과 처리로, 없으면 죽은 pane
  화면 폴백과 고아 스캔으로 간다(「3. 결과 처리」). 팀장 세션이 새로 떠도 살아 있는 tmux 팀원은 원래 슬롯
  번호로 흡수한다. tmux 서버가 팀장과 독립해 돌기 때문이다.
```

- [ ] **단계 5: 보조 정본의 프로세스 문구 (112행)**

"프로세스 백엔드의 `team.blocked` 중 …" → "`team.blocked` 중 그 뒤에 같은 id8 의 `team.answer` 가 없는 것이
답을 기다리는 질문이다. 두 백엔드 공통이다."

- [ ] **단계 6: 「2. 기상과 감시」 머리말 (364-366행)**

"감시 루프 종료(팀원 결과·팀원 프로세스 종료·`TICK`·`STALE`)" → "감시 루프 종료(팀원 결과·팀원 pane 종료·
`TICK`·`STALE`)".

- [ ] **단계 7: 감시 루프 교체 (424-458행)**

`set --` 설명(424-427행):

```markdown
그리고 아래 루프를 `run_in_background` 로 띄운다. `set --` 에는 진행 중 슬롯(`blocked` 포함)마다
`'<워크트리>/docs/tasks/<TSK>/.result|<그 경로의 마지막 처리 해시 또는 ->|<pane id 또는 ->'` 를 작은따옴표로
넣는다. pane id 는 tmux 팀원의 `.dflow-pane` 첫 줄이고 Orca 팀원은 `-` 다. 진행 중 슬롯이 없으면 `set --` 를
비운다. 경로에 공백이나 작은따옴표가 든 워크트리는 지원하지 않는다. `TM` 은 **리터럴 절대경로**로 박는다.
루프는 `run_in_background` 의 별도 셸이라 전제 검사의 변수를 물려받지 않고, PATH 에는 Orca shim 이 살아 있을
수 있기 때문이다.
```

루프 본문:

```bash
GEN_FILE='<세대 파일 절대경로>'; MY_GEN=<세대>; TICK_AT=<다음 TICK epoch 초>
TM='<진짜 tmux 절대경로 또는 빈 값>'
set -- '<워크트리1>/docs/tasks/<TSK1>/.result|<해시1>|<pane1>' '<워크트리2>/docs/tasks/<TSK2>/.result|-|-'
while :; do
  [ "$(cut -d' ' -f1 "$GEN_FILE" 2>/dev/null)" = "$MY_GEN" ] || { echo STALE; exit 0; }
  hit=''; dead=''
  for s in "$@"; do
    f=${s%%|*}; rest=${s#*|}; prev=${rest%%|*}; pane=${rest#*|}
    if [ -f "$f" ]; then
      cur=$(head -n 1 "$f"); sum=$(printf '%s\n' "$cur" | cksum | cut -d' ' -f1)
      [ "$sum" = "$prev" ] || hit="$hit $f"
    fi
    if [ "$pane" != - ] && [ -n "$TM" ]; then
      d=$("$TM" -L dflow list-panes -t "$pane" -F '#{pane_dead}' 2>/dev/null | head -n 1)
      [ "$d" = 0 ] || dead="$dead $f"
    fi
  done
  [ -n "$hit" ] && { echo "RESULT_READY$hit"; exit 0; }
  [ -n "$dead" ] && { echo "PANE_DEAD$dead"; exit 0; }
  [ "$(date +%s)" -ge "$TICK_AT" ] && { echo TICK; exit 0; }
  sleep 20
done
```

설명 항목(448-458행)에서 `PROC_DEAD` 항목을 아래로 바꾼다.

```markdown
- `PANE_DEAD` 는 tmux 팀원의 pane 이 새 결과 줄 없이 죽었을 때 난다. 결과 줄이 새로 있으면 `RESULT_READY` 가
  먼저다. `list-panes` 는 없는 pane 에서 stderr 로 죽으므로 `2>/dev/null` 로 삼키고, 빈 출력을 `0` 이 아닌
  값으로 보아 죽음으로 친다(pane 이 사라진 것도 팀원이 끝난 것이다).
```

455행 "두 백엔드 모두 `TICK_AT` 이 지나면" 은 그대로 둔다. 457행 "진행 중 슬롯의 경로·처리 해시·PID 집합이
바뀔 때" → "… 경로·처리 해시·pane id 집합이 바뀔 때".

- [ ] **단계 8: 기상 표의 `PROC_DEAD` 행 교체 (508행)**

```markdown
| `PANE_DEAD <경로…>` (tmux) | 경로마다 「3. 결과 처리」. `.result` 가 있으면 그 줄, 없으면 죽은 pane 화면 폴백, 그것도 없으면 `failed no-result` |
```

- [ ] **단계 9: 문법 검사와 커밋**

Task 1 단계 6 의 python 블록을 `SKILL.md` 에 대해 돌린다. 기대: `OK`.

```bash
git add .claude/skills/dflow-team/SKILL.md
git commit -m "feat(dflow-team): 생존 판정을 pane_dead 로 — PID 와 시작 시각을 맞춰 보던 규칙이 통째로 사라진다"
```

---

### Task 4: SKILL.md — 결과 처리·spawn·blocked·마감·금지·머리말

**파일:**
- 수정: `.claude/skills/dflow-team/SKILL.md:1-21`(frontmatter·위치 선언), `:522-587`(3. 결과 처리),
  `:615-655`(5. spawn), `:657-688`(6. blocked), `:690-743`(7. 마감), `:757-770`(금지)

**인터페이스:**
- 소비: Task 1 의 spawn·회수·답 명령, Task 3 의 `PANE_DEAD`

- [ ] **단계 1: frontmatter description 교체 (3행)**

"팀원은 자기 서브에이전트를 띄울 수 있는 독립 세션(Orca pane 또는 별도 claude -p 프로세스)이며" →
"팀원은 자기 서브에이전트를 띄울 수 있는 독립 세션(tmux pane 또는 Orca 탭)이며".

- [ ] **단계 2: 제1 제약 교체 (15-18행)**

마지막 문장만 바꾼다. "팀원은 별도 프로세스의 claude 메인 에이전트여야 한다: pane 의 Orca 탭 프로세스 또는
팀장이 `nohup claude -p` 로 띄운 프로세스(backends.md)." →
"팀원은 별도 프로세스의 **대화형** claude 메인 에이전트여야 한다: 팀장이 tmux pane 에 띄운 프로세스 또는
Orca 탭 프로세스(backends.md)."

- [ ] **단계 3: 「3. 결과 처리」 결과 줄 찾기 (524-533행)**

`PROC_DEAD` 항목을 아래로 바꾼다.

```markdown
- `PANE_DEAD <경로>`(tmux): 그 슬롯의 팀원 pane 이 죽었다. `.result` 가 있으면 그 줄을 처리한다. 없으면
  backends.md 「결과 줄과 죽은 pane 폴백」 대로 `capture-pane -p -J -S -` 로 죽은 pane 화면 전체를 읽어
  `<TSK> <id8> ` 로 시작하는 마지막 줄을 찾아 처리한다(`failed not-isolated` 는 워커가 파일을 쓰지 않으므로 이
  폴백으로만 온다). 그것도 없으면 **곧바로** `failed no-result` 로 판정한다(hash `-`). 기다리지 않는 이유:
  프로세스가 없으므로 더 올 결과가 없다. 종료 코드가 필요하면 `#{pane_dead_status}` 를 함께 읽어 보고에 적는다
  (`127` 이면 `claude` 를 찾지 못한 것이다).
```

- [ ] **단계 4: 생존 증거 문단 (535-547행)**

"프로세스 팀원은 먼저 「팀장 상태」 정본 표의 생존 칸(`.dflow-pid` 의 PID 와 시작 시각)을 본다. `dead` 면
증거를 재지 않고 `PROC_DEAD` 와 같이 처리한다. 살아 있는 팀원(pane 포함)은" →
"tmux 팀원은 먼저 「팀장 상태」 정본 표의 생존 칸(`.dflow-pane` 의 pane 이 `#{pane_dead}=0` 인지)을 본다.
`dead` 면 증거를 재지 않고 `PANE_DEAD` 와 같이 처리한다. 살아 있는 팀원은".

545-547행 화면 문단: "Orca 화면(`orca terminal read`)은 보고용으로만 읽는다" → "화면(tmux `capture-pane`,
Orca `orca terminal read`)은 보고용과 신뢰 확인 판별(backends.md)에만 쓴다".

- [ ] **단계 5: status 표의 `blocked` 행 (560행)**

```markdown
| `blocked` | 유지 | 진행 중으로 영구 제외에 남긴다 | 그대로 둔다(두 백엔드 공통). 팀원이 pane 이나 탭에서 답을 기다린다 | 통지(「6. blocked」) |
```

`failed no-result` 행(564행)의 "(프로세스가 죽었는데 결과 줄 없음)" → "(pane 이 죽었는데 결과 줄 없음)".

- [ ] **단계 6: 결과 처리 산문 (568-587행)**

- 571-573행 「프로세스 `blocked` 워크트리를 남기지 않는 이유」 문단을 통째로 지운다. 두 백엔드가 같아졌다.
- 574-576행 「회수」 문단 교체:
  ```markdown
  - **회수**: tmux 백엔드에서는 결과 줄을 처리한 뒤(`blocked` 는 제외한다. 그 팀원은 답을 기다리며 계속 산다)
    pane 이 아직 살아 있으면 `kill-pane -t <pane>` 으로 멈추고 `select-layout -t dflow tiled` 를 다시 돈다
    (backends.md). 워커는 `.result` 를 쓰고 곧 끝나므로 보통은 `remain-on-exit` 가 남긴 죽은 pane 이며, 그것도
    `kill-pane` 으로 치운다. Orca 팀원은 회수하지 않는다.
  ```
- 581-587행 「무응답」 문단의 마지막 부분 교체:
  ```markdown
  자동 정리는 **두 TICK 연속으로** 생존 증거가 없을 때만 한다. tmux 는 `kill-pane` 으로 팀원을 멈추고 슬롯을
  해제하며, 워크트리는 고아 정리 규칙을 따른다. Orca 는 팀원 프로세스를 멈출 수단이 워크트리 삭제뿐이므로,
  깨끗하고 push 된 경우에만 `orca worktree rm --worktree path:<경로>` 로 정리하고 슬롯을 해제한다. 그렇지
  않으면 슬롯을 계속 잡고 "사람 확인 필요" 로 보고한다. 자동 정리한 작업은 영구 제외에 넣고 "재개 필요" 로
  보고한다.
  ```

- [ ] **단계 7: 「5. 팀원 spawn」 (615-655행)**

- 624행 포인터의 `BACKEND=<pane|process>` → `BACKEND=pane`. 두 백엔드 모두 pane 성질이므로 워커가 갈래를
  타지 않는다(Task 5 가 worker-prompt.md 를 맞춘다).
- 629행 "프로세스 백엔드는 같은 값을 `claude -p --model` 에도 붙인다." → "tmux 백엔드는 같은 값을
  `.dflow-run` 의 `claude` 호출에도 붙인다(backends.md)."
- 630-631행 `ANSWER=` 항목을 통째로 지운다. 두 백엔드 모두 답을 화면에 직접 넣으므로 재spawn 이 없다.
- 632-647행 5번을 아래로 바꾼다.
  ```markdown
  5. backends.md 의 해당 절 명령 그대로 띄운다.
     - **pane(tmux)**: 팀장 체크아웃에서 워크트리를 만들고 `.env`·스킬 링크를 건 뒤, 포인터를
       `<워크트리>/.dflow-prompt` 에, 실행 스크립트를 `<워크트리>/.dflow-run` 에 쓰고
       `split-window`(첫 팀원은 `new-session`)로 pane 을 띄운다(명령 전문은 backends.md 「pane(tmux)」).
       pane id 를 `<워크트리>/.dflow-pane` 에 쓰고, 이어서 **폴더 신뢰 확인 루프를 반드시 돈다**. 그 확인을
       넘기지 않으면 팀원이 첫 화면에서 멈춘 채 살아 있다. 기점은 `origin/<기본브랜치>` 로 명시하고, 스택
       기점은 `/dflow-dev` Phase 0 2번이 claim 전에 맞춘다.
     - **pane(Orca)**:
       ```
       orca worktree create --name dflow-<id8> --agent claude --no-parent \
         --base-branch origin/<기본브랜치> --prompt "<포인터 한 줄>" --json
       ```
       기점은 agent 브랜치가 결국 머지될 `origin/<기본브랜치>` 로 명시한다. 결과 JSON 의
       `result.worktree.path` 와 `result.agentTerminalHandle` 을 슬롯 표에 저장한다. 핸들이 없으면(옛 런타임)
       화면 읽기 없이 git·서버 증거만 쓴다. 이후 이 워크트리를 가리킬 때는 `--worktree path:<경로>` 선택자를
       쓴다.
     팀원을 Agent 도구 서브에이전트로 띄우지 않는다. 서브에이전트는 턴이 끝나면 멈춰 Phase 손자를 기다리지
     못한다.
  ```
- 648-649행 6번의 `handle` 설명: "Orca 터미널 핸들 또는 `pid:<PID>`" → "Orca 터미널 핸들 또는
  `tmux:<pane_id>`".
- 653-655행 마지막 문단: "그 밖의 재개는 사람 몫이다" 앞의 "와 프로세스 백엔드의 `blocked` 재개뿐이다" 를
  지운다(재spawn 이 없어졌다).

- [ ] **단계 8: 「6. blocked」 전면 재작성 (657-688행)**

````markdown
## 6. blocked

**공통**: 사람에게 AskUserQuestion 으로 묻지 않는다(자동 루프). 결과 처리가 `team.blocked` 를 기록한다.
PushNotification 도구가 있으면(지연 로드면 ToolSearch 로 불러) 질문 요약으로 한 번 알린다. 없으면 화면 통지만
한다. 그 id8 은 진행 중으로 영구 제외에 남긴다.
**그 슬롯은 blocked 팀원이 계속 잡으며 다른 작업에 재배정하지 않는다.** 살아 있는 프로세스 둘이 같은
`AGENT_ID` 로 heartbeat 를 보내면 좌석표가 한 인물을 두 책상에 그리고 손 든 상태가 새 active 에 덮이기
때문이다. 팀원은 같은 워크트리·브랜치에서 이어 가고(재spawn·재claim 없음), `.result` 가 새 줄로 바뀌면 감시
루프가 알린다.

**tmux**: "결정 필요 <id8>: <질문>. `TMUX= tmux -L dflow attach` 로 붙어 그 pane 에서 답하거나, 이 세션에
`<id8> <답>` 으로 답하라" 고 알린다.

**Orca**: "결정 필요 <id8>: <질문>. Orca 의 `dflow-<id8>` 탭에서 답하라" 고 알린다.

**답 매칭(tmux)**
- 답은 `<id8> <답>` 형식으로 받는다. 이유: 여러 팀원의 질문이 동시에 쌓일 수 있다.
- 답을 기다리는 `blocked` 가 하나뿐이면 id8 없이 온 답도 그 작업의 답으로 본다.
- 여럿인데 id8 이 없으면 어느 작업의 답인지 되묻는다. 팀장이 사람에게 묻는 곳은 여기 하나다. 답을 엉뚱한
  작업에 넣으면 그 작업이 틀린 결정으로 진행되기 때문이다.
- 받은 답은 그 슬롯의 pane 에 넣는다. **넣기 전에 "그 pane 에 답을 넣는다" 를 한 줄 알린다.** 사람이 같은
  pane 에 동시에 치면 입력이 섞이기 때문이다.
  ```bash
  TM='<진짜 tmux 절대경로>'; PANE=$(head -n 1 '<워크트리>/.dflow-pane')
  "$TM" -L dflow send-keys -t "$PANE" -l -- '<답 한 줄>'
  "$TM" -L dflow send-keys -t "$PANE" Enter
  ```
  `-l --` 로 넣는 이유: 그냥 넣으면 tmux 가 답을 키 이름으로 해석해, 답에 `;` 가 들어가면 그 자리에서 명령이
  끊기고 한 단어 답이 우연히 키 이름이면 키로 들어간다.
- pane 이 이미 죽었으면(`#{pane_dead}` 가 `0` 이 아님) 답을 넣지 못한다. "그 팀원은 이미 끝났다. 수동
  `/dflow-dev <id8>` 대상" 으로 보고하고 영구 제외에 남긴다.
- 답을 넣은 뒤 `team.answer`(id8, answer)로 기록한다. 이유: 컨텍스트 압축 뒤 재구성이 `team.blocked` 만 보면
  이미 답한 질문을 사람에게 다시 통지한다.
- 슬롯은 그대로다. 재spawn 도 재claim 도 없다.
````

- [ ] **단계 9: 「7. 마감」 (690-743행)**

- 699행 "pane 팀원은 팀장이 끝나도 자기 탭에서 계속 돈다." → "팀원은 팀장이 끝나도 자기 pane 이나 탭에서 계속
  돈다."
- 702-711행 4번 교체:
  ```markdown
  4. 남은 팀원 워크트리 중 살아 있는 팀원(「팀장 상태」 정의)이 없는 것만 백엔드별로 정리한다. tmux 는
     워크트리가 아직 있을 때만 `git worktree remove --force <경로>`, Orca 는
     `orca worktree rm --worktree path:<경로>` 다. 두 경우 모두 backends.md 「고아 정리 규칙」 을 따라, 깨끗하고
     HEAD 가 `origin/<agent 브랜치>` 와 같을 때만 지우고(생성 브랜치 정리 포함) 나머지는 경로를 보고한다.
     **살아 있는 팀원의 워크트리는 조건과 무관하게 지우지 않는다.** 경로(tmux 는 pane id 도)만 보고에 남긴다.
     이유: 팀원은 팀장이 끝나도 계속 돈다. `blocked` 팀원은 pane 이나 탭에서 답을 기다린다. 깨끗하고 push 된
     순간에 지우면 돌고 있는 팀원의 cwd 가 사라진다. 살아남은 tmux 팀원은 다음 팀장의 재구성이 `.dflow-pane`
     과 `#{pane_start_path}` 로 흡수한다.
     tmux 백엔드에서 **살아 있는 팀원이 하나도 없으면** `"$TM" -L dflow kill-server` 로 서버까지 거둔다. 하나라도
     살아 있으면 서버를 남긴다. 이유: 서버를 남기면 다음 팀장이 그 pane 들을 그대로 흡수한다.
     `--force` 는 미추적 부산물(`.result`·`.dflow-agent`·`.dflow-prompt`·`.dflow-pane`·`.dflow-run`·`.env` 링크·
     스킬 링크) 때문에 필요하다.
  ```
- 738-743행 잠금 상실 마감: "남은 슬롯(TSK·id8·워크트리 경로·PID)" → "… 워크트리 경로·pane id)",
  "팀원 프로세스는 건드리지 않는다. 새 팀장의 재구성이 `.dflow-pid` 로 흡수하기 때문이다." →
  "팀원 pane 은 건드리지 않는다(`kill-server` 도 하지 않는다). 새 팀장의 재구성이 `.dflow-pane` 으로 흡수하기
  때문이다."

- [ ] **단계 10: 「금지」 (757-770행)**

- 761-762행: "팀원은 별도 `claude -p` 프로세스다." → "팀원은 별도 프로세스의 대화형 claude 다."
- 768-769행 교체:
  ```markdown
  - poll·감시 루프를 셸 `&` 로 띄우는 것. 둘은 Bash `run_in_background` 로만 띄운다. 팀원 spawn 은 `&` 를 쓰지
    않는다. tmux `split-window` 가 곧바로 돌아오고 pane 은 tmux 서버가 붙잡기 때문이다.
  ```
- 「tmux 를 PATH 로 부르는 것」 항목을 새로 넣는다.
  ```markdown
  - tmux 를 PATH 로 부르는 것. Orca 가 PATH 앞에 끼운 shim 이 잡는다. 언제나 전제 검사가 구한 절대경로(`TM`)로
    부른다(backends.md 「진짜 tmux 찾기」).
  ```

- [ ] **단계 11: 잔재 검사**

```bash
cd /Users/jji/project/wbs-web
grep -n 'pstart\|dflow-pid\|dflow-worker\.log\|nohup\|claude -p\|LEAD_SKIP_PERMISSIONS\|PROC_DEAD\|NO_CLAUDE_CLI 프로세스\|BACKEND=<pane|process>' \
  .claude/skills/dflow-team/SKILL.md
```

기대: 출력 없음. `claude -p` 가 남아 있으면 그 줄을 고친다.

- [ ] **단계 12: 문법 검사와 커밋**

Task 1 단계 6 의 python 블록을 `SKILL.md` 에 대해 돌린다. 기대: `OK`.

```bash
git add .claude/skills/dflow-team/SKILL.md
git commit -m "feat(dflow-team): blocked 답을 send-keys 로 — 재spawn 이 없어져 팀원이 맥락을 지킨다"
```

---

### Task 5: events.md 와 worker-prompt.md

**파일:**
- 수정: `.claude/skills/dflow-team/references/events.md`, `.claude/skills/dflow-team/references/worker-prompt.md`

- [ ] **단계 1: events.md — `backend` 값 집합**

`team.start` 설명: "`backend` 는 `pane` 또는 `process`" → "`backend` 는 `tmux` 또는 `orca`".

- [ ] **단계 2: events.md — `handle` 값 집합**

`team.spawn` 설명: "`handle` 은 Orca 터미널 핸들 또는 프로세스 백엔드의 `pid:<PID>` 이며 핸들이 없으면 `-`" →
"`handle` 은 tmux 백엔드의 `tmux:<pane_id>`(예: `tmux:%3`) 또는 Orca 터미널 핸들이며, 핸들이 없으면 `-`".

같은 문단의 "`blocked` 답 뒤 재spawn 도 같은 `team.spawn` 을 남긴다." 를 지운다. 재spawn 이 없어졌다.

- [ ] **단계 3: events.md — `team.answer` 설명 개정 (남긴다)**

```markdown
- `team.answer`: `answer` 는 사람이 준 답 한 줄이다. 팀장이 그 답을 팀원 pane 에 넣은 뒤 기록한다. 같은 id8 의
  `team.blocked` 뒤에 `team.answer` 가 없으면 아직 답을 기다리는 질문이다. 이 기록이 없으면 컨텍스트 압축 뒤
  재구성이 이미 답한 질문을 사람에게 다시 통지한다.
```

`team.result` 설명의 "결과 줄 없이 판정한 것(프로세스가 죽었는데 `.result` 도 로그의 결과 줄도 없음)" →
"결과 줄 없이 판정한 것(pane 이 죽었는데 `.result` 도 pane 화면의 결과 줄도 없음)".

이벤트 표의 `team.answer` 시점 칸: "「6. blocked」 답 매칭, 「1. 시작」 4번(대기 중인 답 재기록)" 은 그대로
둔다. 「1. 시작」 4번은 답을 받았으나 아직 넣지 못한 경우를 위해 남는다.

- [ ] **단계 4: worker-prompt.md — `{BACKEND}` 값 집합 (16행)**

```markdown
| `{BACKEND}` | `BACKEND` | 언제나 `pane`. 팀원은 tmux pane 또는 Orca 탭에서 돌며 `blocked` 이후 동작이 같다 |
```

- [ ] **단계 5: worker-prompt.md — `{ANSWER}` 행 삭제 (18행)**

두 백엔드 모두 답을 화면에 직접 넣으므로 재spawn 이 없다. 이 행과, 본문에서 `{ANSWER}` 를 다루는 문장을
지운다.

- [ ] **단계 6: worker-prompt.md — `blocked` 이후 표 (144-151행)**

`process` 행을 지우고 `pane` 행만 남긴다. 표를 산문 한 문단으로 바꾼다.

```markdown
**`blocked` 이후**: 질문을 `.result` 에 남기고 같은 줄을 마지막 응답으로 출력한 뒤, 질문을 화면에 띄운 채
세션을 멈춘다. 화면(tmux pane 또는 Orca 탭)이 열려 있으므로 사람이 거기서 답하거나, 팀장이 사람의 답을 그
화면에 넣어 준다. 답을 받아 이어 가면 끝날 때 `.result` 를 새 결과로 덮어쓴다. 슬롯은 계속 점유한다.
AskUserQuestion 도구를 갖고 있어도 쓰지 않는다. 슬롯 N개가 각자 질문을 띄우면 사람이 어느 팀원의 질문인지
모른 채 창 N개를 받으므로 질문을 팀장 한 곳으로 모은다.
```

- [ ] **단계 7: worker-prompt.md — 프로세스 언급 정리**

- 31행 "pane 백엔드에서는 필요 없지만 무해하고, 백엔드별 분기를 두지 않으려고 공통으로 적용한다." 는 그대로
  둔다(여전히 맞다).
- 47행 "팀장은 프로세스 종료와 로그의 마지막 응답(프로세스)이나 무응답 규칙(pane)으로" →
  "팀장은 pane 종료와 그 화면의 마지막 응답, 또는 무응답 규칙으로".
- 64행 "프로세스 백엔드에서는 팀장이 spawn 전에 같은 링크를 만들어 두므로" → "tmux 백엔드에서는 …".
- 153행 「권한 거부(프로세스)」 문단을 지운다. 팀원이 언제나 권한 확인 생략 모드라 이 경로가 없어졌다.
  `failed permission` status 자체는 남기되(워커가 다른 이유로 거부를 만날 수 있다) 비대화형을 근거로 든 문장만
  고친다.
- 161행 "프로세스 백엔드의 로그 파일(`.dflow-worker.log`) 폴백이자 Orca `terminal read`" →
  "죽은 pane 화면 폴백(`capture-pane -J -S -`)이자 보고용".

- [ ] **단계 8: 잔재 검사와 커밋**

```bash
cd /Users/jji/project/wbs-web
grep -n 'process\|프로세스 백엔드\|dflow-worker\|ANSWER' \
  .claude/skills/dflow-team/references/events.md .claude/skills/dflow-team/references/worker-prompt.md
```

남은 줄마다 그것이 여전히 맞는 문장인지 확인한다(예: "별도 프로세스" 는 맞고 "프로세스 백엔드" 는 틀리다).

```bash
git add .claude/skills/dflow-team/references/events.md .claude/skills/dflow-team/references/worker-prompt.md
git commit -m "refactor(dflow-team): 이벤트·워커 규칙에서 프로세스 백엔드를 걷어낸다"
```

---

### Task 6: 2026-09-10 설계 문서 갱신

**파일:**
- 수정: `docs/superpowers/specs/2026-09-10-dflow-team-design.md:29,44,57,111-114,356,1342,1545`

- [ ] **단계 1: 해당 줄을 읽고 문맥을 확인한다**

```bash
cd /Users/jji/project/wbs-web
sed -n '25,32p;42,46p;55,59p;108,118p;353,359p;1338,1346p;1541,1550p' \
  docs/superpowers/specs/2026-09-10-dflow-team-design.md
```

- [ ] **단계 2: 각 줄을 갱신한다**

tmux 를 "미지원" 으로 적은 곳은 "pane(tmux) 백엔드" 로, 프로세스 백엔드를 설명한 곳은 제거되었음과 후속
정본(`2026-09-16-dflow-team-tmux-pane-design.md`)을 가리키는 한 줄로 바꾼다. 111-114행의 "dev-plugin 의
`/team-mode` 에 맡길 계획이었으나 플러그인 로드 실패로 미구현" 은 **사실 기록이므로 지우지 않고**, 뒤에
"2026-09-16 에 tmux 를 직접 부르는 방식으로 구현했다(후속 설계 문서)" 를 덧붙인다.

1545행(후속 과제 목록)의 tmux 항목은 완료 표시와 후속 문서 링크로 바꾼다.

- [ ] **단계 3: 머리말에 후속 문서 한 줄 추가**

문서 맨 앞 위치 선언 근처에 넣는다.

```markdown
> **2026-09-16 개정**: 팀원 실행 방식이 tmux pane 으로 바뀌었고 `claude -p` 프로세스 백엔드는 없어졌다.
> 그 부분의 정본은 `2026-09-16-dflow-team-tmux-pane-design.md` 다. 이 문서의 프로세스 백엔드 서술은 당시
> 기록으로 남긴다.
```

- [ ] **단계 4: 커밋**

```bash
git add docs/superpowers/specs/2026-09-10-dflow-team-design.md
git commit -m "docs(dflow-team): 상위 설계 문서에 tmux 백엔드 전환을 반영"
```

---

### Task 7: 통합 검증

**파일:** 없음(읽기만 한다)

- [ ] **단계 1: 전 파일 셸 문법 검사**

```bash
cd /Users/jji/project/wbs-web
for f in .claude/skills/dflow-team/SKILL.md .claude/skills/dflow-team/references/*.md; do
  echo "=== $f ==="
  python3 - "$f" <<'PY'
import re,subprocess,sys,tempfile,os
src=open(sys.argv[1]).read()
blocks=re.findall(r'```bash\n(.*?)```', src, re.S)
bad=0
for i,b in enumerate(blocks):
    b=re.sub(r'<[^>\n]*>','PLACEHOLDER',b)
    with tempfile.NamedTemporaryFile('w',suffix='.sh',delete=False) as f:
        f.write(b); p=f.name
    r=subprocess.run(['sh','-n',p],capture_output=True,text=True)
    if r.returncode: bad+=1; print(f'--- block {i} ---\n{b[:200]}\n{r.stderr}')
    os.unlink(p)
print('OK' if not bad else f'{bad} block(s) failed')
PY
done
```

기대: 파일마다 `OK`.

- [ ] **단계 2: 참조 일관성 — 사라진 이름**

```bash
grep -rn 'pstart\|\.dflow-pid\|\.dflow-worker\.log\|PROC_DEAD\|LEAD_SKIP_PERMISSIONS\|nohup' \
  .claude/skills/dflow-team/
```

기대: 출력 없음.

- [ ] **단계 3: 참조 일관성 — 새 이름이 양쪽에 있는지**

```bash
for k in 'find_tmux' '.dflow-pane' '.dflow-run' 'PANE_DEAD' '-L dflow' 'NO_TMUX' 'tmux:' 'select-layout'; do
  printf '%-18s SKILL=%s backends=%s\n' "$k" \
    "$(grep -c -- "$k" .claude/skills/dflow-team/SKILL.md)" \
    "$(grep -c -- "$k" .claude/skills/dflow-team/references/backends.md)"
done
```

기대: `find_tmux`·`.dflow-pane`·`.dflow-run`·`-L dflow` 가 양쪽에서 1 이상. `PANE_DEAD` 는 SKILL.md 에서
1 이상. `NO_TMUX` 는 SKILL.md 에서 1 이상.

- [ ] **단계 4: 절 참조가 실제 절을 가리키는지**

```bash
grep -o '「[^」]*」' .claude/skills/dflow-team/SKILL.md | sort -u > /tmp/refs.txt
grep -n '^## \|^### ' .claude/skills/dflow-team/SKILL.md
cat /tmp/refs.txt
```

`backends.md 「프로세스」` 같은 죽은 참조가 없어야 한다. `「pane(tmux)」`·`「고아 정리 규칙」`·
`「결과 줄과 죽은 pane 폴백」` 이 backends.md 의 실제 제목과 맞는지 눈으로 대조한다.

- [ ] **단계 5: tmux 실측 한 바퀴 (건조 주행)**

실제 팀을 띄우지 않고 명령만 확인한다. **운영 소켓 `dflow` 에 이미 세션이 있으면 하지 않는다.**

```bash
TM=/opt/homebrew/bin/tmux
"$TM" -L dflowdry has-session -t dflow 2>/dev/null && { echo "SKIP: 세션 있음"; exit 0; }
D=$(mktemp -d)
printf '#!/bin/sh\necho HELLO_FROM_PANE\nsleep 30\n' > "$D/.dflow-run"; chmod +x "$D/.dflow-run"
"$TM" -L dflowdry new-session -d -s dflow -n dflow -x 200 -y 60 -c "$D" './.dflow-run'
"$TM" -L dflowdry set-option -t dflow remain-on-exit on
PANE=$("$TM" -L dflowdry list-panes -t dflow -F '#{pane_id}' | head -1)
echo "PANE=$PANE"
sleep 1
echo "dead=$("$TM" -L dflowdry list-panes -t "$PANE" -F '#{pane_dead}')"
echo "start_path=$("$TM" -L dflowdry list-panes -t "$PANE" -F '#{pane_start_path}')"
"$TM" -L dflowdry capture-pane -p -J -S - -t "$PANE" | grep HELLO_FROM_PANE
"$TM" -L dflowdry kill-server
rm -rf "$D"
echo DRY_RUN_OK
```

기대: `dead=0`, `start_path` 가 임시 디렉터리, `HELLO_FROM_PANE` 한 줄, `DRY_RUN_OK`.

- [ ] **단계 6: 수정 없으면 커밋 없음**

단계 1~5 에서 고친 것이 있으면 파일명을 명시해 stage 하고 커밋한다.

---

### Task 8: E2E 절차서 단계 16 에 tmux 칸 복원

**파일:**
- 수정: `docs/agent/2026-09-16-agent-loop-e2e-test.md:19`(파라미터 표), `:97`(혼합 방식), 단계 16, §3 의 R15

- [ ] **단계 1: 전제 표의 「팀 백엔드」 행 교체 (19행)**

```markdown
| 팀 백엔드 | **pane(tmux) 와 pane(Orca) 둘 다** | 2026-09-16 에 tmux pane 백엔드를 구현했고 프로세스 백엔드(`nohup claude -p`)는 없앴다. 두 백엔드 모두 대화형이라 사람이 화면을 보고 답할 수 있다 |
```

- [ ] **단계 2: 「스킬 출처」 행 갱신 (16행)**

```markdown
| 스킬 출처 | `~/dflow-kit`(tmux 백엔드 반영본) = wbs-web `origin/main` | tmux 백엔드 구현을 main 에 머지하고 킷을 재빌드한 뒤 주행한다. 재빌드 전에 주행하면 옛 스킬(프로세스 백엔드)을 시험하게 된다 |
```

- [ ] **단계 3: 혼합 방식 문단 (97행)**

"Orca 의 pane 백엔드로 한 번만 돌린다" → "tmux pane 백엔드로 한 번 돌리고, 단계 16-나 에서 Orca pane 백엔드로
한 번 더 돌린다".

- [ ] **단계 4: 단계 16 재작성**

제목을 「병렬 실행 2건 (`/dflow-team`, pane 백엔드 둘)」 로 하고 16-가·16-나 두 칸으로 나눈다.

- **16-가 pane(tmux)**: 일반 터미널(Orca 밖)에서 `/dflow-team 2명 <종료시각>` 을 띄운다. 확인 항목은
  `PRECHECK_OK` 의 `BACKEND=tmux`, `TM` 이 shim 이 아닌 절대경로, pane 이 `tiled` 로 나뉘는지,
  폴더 신뢰 확인이 자동으로 넘어가는지, 팀원 화면에 `Transcript saving is off` 가 **없는지**(환경 벗기기가
  들었는지), `blocked` 답을 `send-keys` 로 넣었을 때 팀원이 맥락을 유지한 채 이어 가는지.
- **16-나 pane(Orca)**: Orca 안에서 같은 명령을 띄운다. 확인 항목은 `BACKEND=orca` 로 떨어지는지다.
  **tmux 가 깔린 PC 에서는 이 갈래로 떨어지지 않는다.** 감지가 tmux 를 먼저 보기 때문이다. 이 칸을 시험하려면
  `find_tmux` 후보 경로에서 tmux 를 잠시 치워야 하므로, 주행에서는 **건너뛰고 그 사실을 기록**한다.

- [ ] **단계 5: §3 결함표의 R15 교체**

```markdown
| R15 | tmux 가 깔린 PC 에서는 pane(Orca) 백엔드 갈래로 떨어지지 않아 그 코드 경로를 주행에서 시험할 수 없다 | 16 | [ ] |
```

- [ ] **단계 6: 단계↔결과줄 대응 확인**

```bash
cd /Users/jji/project/wbs-web
grep -c '^### 단계 ' docs/agent/2026-09-16-agent-loop-e2e-test.md
grep -c '^\*\*결과\*\*' docs/agent/2026-09-16-agent-loop-e2e-test.md
```

두 값이 같아야 한다(17 대 17).

- [ ] **단계 7: 커밋**

```bash
git add docs/agent/2026-09-16-agent-loop-e2e-test.md
git commit -m "docs(e2e): 단계 16 에 tmux pane 칸 복원 — 프로세스 백엔드가 없어져 두 pane 백엔드만 남는다"
```

---

### Task 9: main 머지

킷은 `origin/main` 에서 빌드되므로 주행 전에 main 이 tmux 백엔드를 담고 있어야 한다.

- [ ] **단계 1: staging push 전 back-merge**

```bash
cd /Users/jji/project/wbs-web
git fetch origin
git merge origin/main
```

충돌이 나면 해결하고 커밋한다.

- [ ] **단계 2: staging push**

```bash
git push origin staging
```

- [ ] **단계 3: main 머지와 push**

이번 변경에는 UI 위험 파일(`globals.css`·`layout.tsx`·`components/app/*`)과 마이그레이션이 없으므로 G1·G2·G4
훅에 걸리지 않는다.

```bash
git switch main
git merge staging
git push origin main
git switch staging
```

`git push --force` 는 쓰지 않는다.

---

### Task 10: 킷 재빌드와 배포

- [ ] **단계 1: 재빌드**

```bash
cd /Users/jji/project/wbs-web
scripts/kit-build.sh
```

스크립트는 `origin/main` 의 임시 워크트리에서 돈다. 방금 push 한 main 을 읽어야 하므로 Task 9 뒤에 돈다.

- [ ] **단계 2: 킷 내용 확인**

```bash
grep -c 'find_tmux' ~/dflow-kit/.claude/skills/dflow-team/references/backends.md
grep -c 'nohup' ~/dflow-kit/.claude/skills/dflow-team/references/backends.md
cat ~/dflow-kit/VERSION
```

기대: `find_tmux` 가 1 이상, `nohup` 이 0.

- [ ] **단계 3: dflow-kit push**

```bash
cd ~/dflow-kit && git status --short
```

변경 파일을 **파일명을 명시해** stage 하고 커밋·push 한다.

- [ ] **단계 4: 메모리 갱신**

`memory/dflow-kit-distribution.md` 의 "현재 킷 <sha>=wbs-web <sha>" 줄을 새 값으로 고친다.

---

## 자체 검토

**설계 문서 적용 범위**: §3 감지 → Task 2. §4 spawn → Task 1·4. §5 환경 벗기기 → Task 1. §6 신뢰 확인 →
Task 1·4. §7 생존·화면·blocked·회수 → Task 1·3·4. §8 정리와 재구성 → Task 1·3·4. §9 제거 목록 → Task 1·2·4·5
(단 `NO_CLAUDE_CLI` 는 보정 1 에 따라 남긴다). §10 플랫폼 → Task 1·2. §13 반영 범위 → Task 1~5·8·10.

**빠진 것 없음 확인**: `scripts/kit-build.sh` 는 수정 대상이 아니라 실행 대상이다(Task 10). E2E 절차서는
Task 8. 메모리 갱신은 Task 10 단계 4.

**이름 일관성**: `TM`(tmux 절대경로), `PANE`/`pane`(pane id), `WT`(워크트리), `BACKEND`(`tmux`·`orca`),
`.dflow-pane`·`.dflow-run`(부산물), `PANE_DEAD`(기상 신호), `tmux:<pane_id>`(handle), `NO_TMUX`(실패 코드).
Task 1~5 가 모두 이 이름을 쓴다.
