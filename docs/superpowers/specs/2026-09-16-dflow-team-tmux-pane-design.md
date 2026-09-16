# /dflow-team tmux pane 백엔드 설계

2026-09-16. `/dflow-team` 의 팀원 실행 방식을 tmux pane 으로 바꾸고, `claude -p` 프로세스 백엔드를 없앤다.
`2026-09-10-dflow-team-design.md` 가 후속 과제로 남긴 항목(1545 행)의 정본이다.

---

## 1. 왜 바꾸는가

지금까지 Orca 밖에서는 팀원이 `nohup claude -p` 로 떴다. 기능이 모자란 것은 아니다. Phase 손자
서브에이전트의 완료 알림으로 팀원이 다시 깨어나는 것도 실측으로 확인되어 있다(`backends.md` 「프로세스」).
문제는 **사람이 끼어들 자리가 없다**는 데 있다.

1. 권한 확인 프롬프트를 띄울 수 없다. 확인이 필요한 명령은 그대로 거부되어 `failed permission` 으로 끝난다.
2. 팀원 화면이 없다. 진행 중에 볼 수 있는 것은 `.dflow-worker.log` 뿐이고, 그것도 마지막 응답 폴백 용도다.
3. `blocked` 로 멈춘 팀원에게 답을 주려면 프로세스를 다시 띄워야 한다. 팀원은 쌓아 둔 맥락을 잃는다.
4. 사람이 팀원 자리에 앉아 이어받을 수 없다.

tmux pane 팀원은 넷 모두 해당하지 않는다. 대화형 claude 이므로 화면이 보이고, 권한 확인에 답할 수 있으며,
`blocked` 면 그 pane 에 답을 넣으면 되고, 사람이 붙어서 직접 이어받을 수 있다.

원래 tmux pane 은 dev-plugin 의 `/team-mode` 에 맡길 계획이었으나 그 플러그인이 로드 실패로 뜨지 않아
미구현으로 남았다(`2026-09-10-dflow-team-design.md:111-114`). 이번에는 **tmux 를 직접 부른다.**

---

## 2. 결정 요약

| 항목 | 결정 |
|---|---|
| 백엔드 | **tmux pane** 과 **Orca 탭** 둘. 프로세스 백엔드는 제거 |
| 감지 순서 | tmux 를 먼저 보고, 없으면 Orca 를 본다. 둘 다 없으면 시작을 거부한다 |
| 소켓 | 전용 소켓 `-L dflow`. 팀장이 tmux 안인지 밖인지 묻지 않는다 |
| 배치 | window 하나(`dflow`)에 팀원마다 pane 하나. `tiled` 정렬 |
| 권한 | 팀원은 언제나 `--dangerously-skip-permissions` |
| `blocked` 답 | 팀장이 `send-keys` 로 넣는다. 붙어 있는 사람이 직접 쳐도 된다 |
| Windows | tmux 설치를 요구한다(미검증) |

`TMUX` 환경변수는 감지에서 **쓰지 않는다.** 전용 소켓을 쓰므로 팀장이 tmux 안인지가 무의미하고, Orca
안에서도 `TMUX` 가 채워져 오진의 근원이었기 때문이다.

---

## 3. 감지

`SKILL.md` 「0. 환경 감지」를 아래로 바꾼다.

| 순위 | 조건 | 백엔드 |
|---|---|---|
| 1 | `find_tmux` 가 진짜 tmux 절대경로를 돌려준다 | **pane(tmux)** |
| 2 | 못 찾았고 `TERM_PROGRAM=Orca` 이거나 `ORCA_WORKTREE_ID` 가 비어 있지 않다 | pane(Orca) |
| 3 | 그 밖 | `FAIL NO_TMUX` 로 중단하고 설치를 안내한다 |

### 진짜 tmux 찾기

Orca 는 PATH 앞에 tmux shim 을 끼운다. 그 shim 은 `orca agent-teams-tmux` 로 위임하는 셸 스크립트이며,
Claude Code 자체 에이전트 팀이 쓰는 부분집합만 처리하고 나머지는 `unsupported command` 로 거부한다.
**`tmux -V` 는 거짓말을 한다** — shim 은 `3.4` 라 답하지만 실제 바이너리는 `3.7c` 였다. 버전으로는 가릴 수 없다.

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
`unsupported command` 가 돌아오는지 보는 것이 둘째다. probe 소켓 이름에 `$$` 를 붙이는 이유는 **운영 소켓
`dflow` 를 건드리지 않기 위해서**다. `has-session` 은 서버를 만들지 않지만 운영 소켓과 이름을 섞지 않는다.

찾은 절대경로는 `TM` 에 담아 이후 모든 호출에 쓴다. 팀장이 Orca 안에 있어도 절대경로로 부르면 shim 을
그냥 지나친다(실측).

---

## 4. spawn

워크트리 준비는 종전 프로세스 백엔드와 **완전히 같다**. 달라지는 것은 띄우는 방법 하나다.

```bash
TM=$(find_tmux)
WT="<MAIN>/.claude/worktrees/dflow-<id8>"
git fetch -q origin && git worktree prune && \
  git worktree add --detach "$WT" origin/<기본브랜치> || echo SPAWN_FAILED_WORKTREE
[ -e "$WT/.env" ] || ln -s "<MAIN>/.env" "$WT/.env"
# 스킬 링크는 backends.md 「프로세스」 의 블록을 그대로 쓴다
printf '%s\n' '<포인터 한 줄>' > "$WT/.dflow-prompt"
```

팀원을 띄우는 명령은 워크트리에 `.dflow-run` 으로 써 두고 그 파일을 실행한다. 셸 인용을 한 겹 줄이고,
사람이 pane 에서 무엇이 돌고 있는지 읽을 수 있게 하기 위해서다.

```bash
cat > "$WT/.dflow-run" <<'RUNEOF'
#!/bin/sh
# 팀장 세션의 흔적을 벗긴다. 근거는 설계 문서 §5.
for v in $(env | sed -n 's/^\(CLAUDE_CODE_[A-Z0-9_]*\)=.*/\1/p'); do unset "$v"; done
for v in $(env | sed -n 's/^\(ORCA_[A-Z0-9_]*\)=.*/\1/p'); do unset "$v"; done
unset TMUX TMUX_PANE
PATH=$(printf '%s' "$PATH" | tr ':' '\n' | grep -v 'claude-agent-teams-bin' | paste -sd: -)
export PATH
exec claude --dangerously-skip-permissions "$(cat .dflow-prompt)"
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
```

- **전용 소켓 `-L dflow`** 라 팀장이 tmux 안이든 밖이든 코드 경로가 하나다. 사람의 기존 tmux 세션도 건드리지
  않는다. 서버가 없으면 `new-session`, 있으면 `split-window` 로 갈리는 분기 한 줄이 전부다.
- `-x 200 -y 60` 은 detached 동안의 가상 크기다. 사람이 붙으면 클라이언트 크기를 따른다. 팀장이
  `capture-pane` 으로 읽을 때 이 크기가 쓰이므로 좁게 두지 않는다.
- `remain-on-exit on` 은 죽은 pane 을 남긴다. 팀원이 무슨 말을 남기고 끝났는지 읽을 수 있고, 종료 코드도
  `#{pane_dead_status}` 로 얻는다. 종전의 `.dflow-worker.log` 폴백을 대신한다.
- `exec` 로 셸을 claude 로 대체해 `pane_pid` 가 곧 claude 가 된다.
- 프롬프트는 `.dflow-prompt` 파일 경유라 따옴표·백틱을 걱정하지 않는다.
- 슬롯 표의 `handle` 은 `tmux:<pane_id>` 형식이다(예: `tmux:%3`).
- `git worktree add` 가 실패하면(`SPAWN_FAILED_WORKTREE`) 띄우지 않고 경로를 보고한다. 종전과 같다.

### 첫 입력 자동 제출

`claude "<프롬프트>"` 는 대화형 세션을 띄우면서 그 문자열을 첫 턴으로 제출한다. 실측으로 확인했다(§11).
Orca 의 `--prompt` 와 같은 효과다. `-p` 를 쓰지 않으므로 세션은 대화형으로 남는다.

### 시작 보고

백엔드가 tmux 면 아래 두 줄을 알린다.

> 팀원은 tmux pane 에서 **권한 확인 생략 모드로** 돕니다. 팀장 세션의 권한 모드와 무관합니다.
> 화면은 `TMUX= tmux -L dflow attach` 로 볼 수 있습니다.

첫 줄이 중요하다. 팀장을 평소 모드로 띄운 사람도 팀원은 무제한으로 돈다는 사실이 여기서 드러나야 한다.
`TMUX=` 를 앞에 붙이는 이유는 팀장이 이미 tmux 안일 때 중첩 attach 가 거부되기 때문이다.

---

## 5. 팀원 환경을 벗기는 이유

팀원 pane 은 팀장의 환경을 통째로 물려받는다. 실측에서 `ORCA_AGENT_TEAMS_*` 다섯 개와 `CLAUDE_CODE_*`
아홉 개가 넘어갔고 PATH 에도 shim 디렉터리가 남았다. 벗기지 않으면 넷이 깨진다.

| 남는 것 | 깨지는 것 |
|---|---|
| `CLAUDE_CODE_CHILD_SESSION` | **팀원의 대화 기록이 저장되지 않는다.** 화면에 `Transcript saving is off` 가 뜬다. 팀원이 무엇을 했는지 나중에 볼 수 없다 |
| `CLAUDE_CODE_MESSAGING_SOCKET`·`TOKEN` | 팀원이 팀장의 메시징 채널에 붙는다 |
| `CLAUDE_CODE_SESSION_ID`·`BRIDGE_SESSION_ID` | 팀원이 팀장의 세션 ID 를 자기 것으로 쓴다 |
| `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS` | 팀원이 자기 팀을 만들려 든다 |
| `CLAUDE_PID` | 팀원이 팀장 세션의 PID 를 자기 것으로 본다 |
| `ORCA_AGENT_TEAMS_TEAM_ID`·`TOKEN`·`LEADER_PANE` | 팀원이 자기를 Orca 팀 리더의 pane 으로 오인할 여지가 있다 |
| PATH 의 `claude-agent-teams-bin` | 팀원이 tmux 를 부르면 Orca shim 이 잡는다 |

접두째 벗기는 쪽을 택한 이유는 목록을 손으로 관리하면 새 변수가 생길 때 놓치기 때문이다. 자르는 접두는
`CLAUDE_CODE_` 가 아니라 **`CLAUDE`** 다. 구현 단계 실측에서 `CLAUDECODE`(밑줄 없음)·`CLAUDE_PID`·
`CLAUDE_EFFORT`·`CLAUDE_PLUGIN_DATA` 넷이 `CLAUDE_CODE_` 밖에 있었다. `CLAUDE_CONFIG_DIR` 만 예외로
남기고, `ORCA_` 로 시작하는 것을 전부 지우며, `TMUX`·`TMUX_PANE` 을 따로 지운다. 팀원에게 필요한 설정은 모두
`~/.claude/settings.json` 과 워크트리의 `.env` 에서 오므로 잃는 것이 없다.

---

## 6. 폴더 신뢰 확인

대화형 claude 는 처음 보는 디렉터리에서 신뢰 확인을 띄운다.

```
Quick safety check: Is this a project you created or one you trust?
❯ No, exit
  Yes, I trust this folder
```

**`--dangerously-skip-permissions` 로 넘어가지 않는다.** `claude --help` 가 이유를 밝힌다. 신뢰 대화상자는
`-p` 를 쓰거나 stdout 이 TTY 가 아닐 때만 건너뛴다. 종전 프로세스 백엔드가 이 문제를 겪지 않았던 이유가
그것이고, 대화형으로 바꾸면 새로 생기는 문제다. 팀원 워크트리는 매번 새 경로(`dflow-<id8>`)이므로 **매번**
뜬다. detached 로 돌리면 아무도 답하지 못해 팀원이 그대로 멈춘다.

팀장이 spawn 직후 화면을 읽어 확인이 보이면 답을 보낸다.

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

`~/.claude.json` 의 `hasTrustDialogAccepted` 를 미리 넣는 길도 있으나 택하지 않았다. 그 파일은 212KB 이고
여러 세션이 동시에 쓰기 때문에, 읽고 고쳐 쓰는 사이에 남의 변경을 잃는다.

**이 규칙은 화면 문자열에 기댄다.** Claude Code 판본이 문구를 바꾸면 깨진다. 깨지면 팀원이 신뢰 확인
화면에서 멈춘 채 살아 있으므로, 무응답 자동 정리가 가려낸다. 확인한 판본은 v2.1.273 이다.

---

## 7. 생존·화면·`blocked`·회수

| 항목 | 명령 | 종전 대비 |
|---|---|---|
| 생존 | `list-panes -t <pane> -F '#{pane_dead}'` | 빈 출력이면 pane 이 없고, `1` 이면 죽었으며, `0` 이면 살아 있다. **PID 와 시작 시각을 맞춰 보던 `pstart` 규칙이 통째로 사라진다** |
| 종료 코드 | `#{pane_dead_status}` | 종전에 없던 정보다 |
| 화면 | `capture-pane -p -t <pane>` | `orca terminal read` 대응 |
| `blocked` 답 | `send-keys -t <pane> -l -- '<답>'` 뒤에 `send-keys -t <pane> Enter` | **재spawn 이 없어져 팀원이 맥락을 지킨다** |
| 회수 | `kill-pane -t <pane>` | — |
| 워크트리 대응 | `#{pane_start_path}` | `.dflow-pid` 같은 파일 없이 재구성이 된다 |

화면은 **생존 증거로 쓰지 않는다.** 스피너 때문에 멈춘 팀원도 매번 달라 보이는 문제가 Orca 와 같다. 생존
증거는 종전 셋(브랜치 tip 커밋 시각·서버 progress·미커밋 변경 목록)을 그대로 쓴다. 화면은 사람에게 보여 줄
보고용과 §6 의 신뢰 확인 판별에만 쓴다.

기상 신호는 `RESULT_READY` 와 `PANE_DEAD` 둘이다.

`blocked` 는 pane 백엔드의 성질을 따른다. 팀원이 pane 에서 기다리므로 **슬롯을 계속 잡는다.** 답은 팀장이
`send-keys` 로 넣고, 붙어 있는 사람이 직접 쳐도 된다. 둘이 동시에 치면 입력이 섞이므로, 팀장이 답을 넣을
때는 그 사실을 한 줄 알린다.

---

## 8. 정리와 재구성

- **결과 처리 뒤**: `kill-pane -t <pane>`. 워크트리는 종전 「고아 정리 규칙」을 그대로 쓴다.
- **마감**: 소켓에 pane 이 하나도 없을 때만 `kill-server` 한다. 이 소켓은 **사용자 단위**이지 리포 단위가
  아니라, 자기 슬롯 표만 보고 거두면 같은 PC 의 다른 체크아웃에서 도는 팀장의 팀원이 죽는다(구현 단계에서
  발견). 팀장 세션이 죽어도 팀원이 사는 성질은 종전 프로세스 백엔드와 같다.
- **재구성**: 아래 한 줄로 살아 있는 팀원을 흡수한다.
  ```bash
  "$TM" -L dflow list-panes -a -F '#{pane_id} #{pane_dead} #{pane_start_path}'
  ```
  `pane_start_path` 가 워크트리 경로이므로 팀장이 컨텍스트를 잃어도 pane 과 작업을 다시 맞출 수 있다.
  워크트리 루트의 `.dflow-agent` 와 `.dflow-pane` 이 교차 확인에 쓰인다.
- **고아 tmux 서버**: 마감에서 `kill-server` 를 놓치면 서버가 남는다. 전제 검사가 `-L dflow` 의 pane 중
  `.dflow-agent` 가 없는 워크트리를 가리키는 것을 찾아 보고한다.

---

## 9. 제거되는 것

프로세스 백엔드가 사라지면서 아래가 함께 없어진다.

| 대상 | 위치 |
|---|---|
| `nohup claude -p` spawn 블록 | `backends.md` 「프로세스」 |
| `pstart` 함수와 PID·시작 시각 생존 판정 | `backends.md` 「프로세스」·「플랫폼 차이」 |
| `.dflow-pid`·`.dflow-worker.log` | 부산물 목록, `info/exclude` 패턴 |
| `blocked` 재spawn 과 `ANSWER=` 둘째 줄 | `backends.md` 「프로세스」, `SKILL.md` 「6. blocked」 |
| 백엔드별 슬롯 점유 차이 | `backends.md` 차이표 |
| `NO_CLAUDE_CLI` 전제 검사 | `SKILL.md` 「1. 시작」. `NO_TMUX` 로 대체 |
| `LEAD_SKIP_PERMISSIONS` 감지 | `SKILL.md` 「1. 시작」. 팀원이 언제나 생략 모드이므로 불필요 |
| 권한 모드 안내의 두 갈래 분기 | `SKILL.md` 「1. 시작」 3번 |

새로 생기는 부산물은 `.dflow-pane`(한 줄, pane id)과 `.dflow-run`(실행 스크립트) 둘이다. 둘 다 공유
`info/exclude` 에 넣는다.

---

## 10. 플랫폼

| 항목 | macOS·Linux·WSL | Windows(Git Bash) |
|---|---|---|
| tmux | 대개 설치되어 있거나 패키지 관리자로 깐다 | **MSYS2 로 따로 깔아야 한다. 미검증** |
| 호스트 이름 | `hostname \| cut -d. -f1` | 같다 |
| 팀장 세션 PID | `CLAUDE_PID`(= `$PPID`) | `CLAUDE_PID` 필수. 없으면 `NO_CLAUDE_PID` |
| `.env`·스킬 링크 | 심링크 | `ln -s` 가 복사본을 만든다. 복사본으로 동작한다 |
| 경로 표기 | — | git 은 `C:/…`, bash 는 `/c/…`. 경로는 항상 git 출력에서 얻는다 |
| 줄끝 | — | `.gitattributes` 가 LF 로 고정한다 |

Windows 에서 MSYS2 tmux 가 실제로 도는지는 **확인한 적이 없다.** Git for Windows 기본 구성이 아니다.
tmux 자체의 Windows 제약도 알려져 있다. 검증 전까지 Windows 는 「돌 수도 있다」로 둔다. WSL 은 Linux 로
취급되므로 그대로 돈다.

종전 Windows 지원 작업 중 프로세스 번호와 시작 시각을 다루던 부분(`pstart`, WINPID 열 파싱, PowerShell
`Get-Process`)은 §9 와 함께 사라진다. 경로 표기 차이와 줄끝 처리는 그대로 유효하다.

---

## 11. 실측 근거

2026-09-16, Darwin 25.6.0, tmux 3.7c(`/opt/homebrew/bin/tmux`), Claude Code v2.1.273, Orca 1.4.190 세션 안에서 잰 것이다.

| 확인한 것 | 결과 |
|---|---|
| Orca 안에서 절대경로 tmux 가 도는가 | **돈다.** 서버 생성·분할·화면 읽기·입력 넣기·죽은 pane 판정이 모두 성공했다 |
| shim 판별 | `tmux -V` 는 `3.4`(거짓), 실제 `3.7c`. `-L … ls` 는 `unsupported command: ls` |
| detached 세션 크기 | `-x 200 -y 60` 으로 지정된다. 80×24 제약은 없다 |
| `remain-on-exit` | 죽은 pane 이 화면과 `pane_dead_status=7` 을 남긴다 |
| `send-keys` 전달 | 살아 있는 pane 에 들어간다. **`-l` 이 없으면 답을 키 이름으로 먼저 해석한다** — 답이 `Up` 이면 화살표가 눌려 답이 사라지고 `Space` 면 빈 답이 된다(구현 단계 실측). `;`·따옴표가 든 답은 한 인자로 넘기면 안전하다 |
| `claude "<프롬프트>"` | **대화형으로 뜨면서 첫 턴이 자동 제출된다.** 답까지 받았다 |
| 환경변수 상속 | `ORCA_AGENT_TEAMS_*` 다섯, `CLAUDE_CODE_*` 아홉, PATH 의 shim 디렉터리가 넘어간다 |
| 폴더 신뢰 확인 | `--dangerously-skip-permissions` 로 넘어가지 않는다. `send-keys` 로 통과시켰다 |
| 기록 저장 | `CLAUDE_CODE_CHILD_SESSION` 상속으로 꺼진다 |

`orca claude-teams` 는 숨김 명령이며, 뒤의 인자를 그대로 Claude Code 에 넘기는 래퍼다. 짝이 되는
`orca agent-teams-tmux` 가 PATH 의 shim 알맹이이며 `agentTeams.tmuxCompat` RPC 로 간다. 즉 Orca 는
**Claude Code 자체 에이전트 팀을 자기 pane 으로 그리는 호환 계층**을 갖고 있다. 이것은 `/dflow-team` 과
다른 물건이다. 그 계층이 띄우는 것은 Claude Code 의 teammate 인데, teammate 에 `isolation` 을 주면
teammate 가 아니라 서브에이전트가 되므로 팀원마다 워크트리를 주는 구조와 양립하지 않는다.

---

## 12. 미검증과 위험

| | 내용 | 완화 |
|---|---|---|
| 1 | Windows(Git Bash)에서 MSYS2 tmux 가 도는지 확인한 적이 없다 | 문서에 미검증으로 표시. WSL 을 권한다 |
| 2 | 신뢰 확인 판별이 화면 문자열에 기댄다 | 판본을 명시. 깨지면 팀원이 멈춘 채 살아 있으므로 무응답 자동 정리가 가려낸다 |
| 3 | 팀장과 사람이 같은 pane 에 동시에 입력하면 섞인다 | 팀장이 답을 넣을 때 그 사실을 알린다 |
| 4 | Orca 백엔드가 tmux 없는 Orca 환경 전용으로 내려간다 | 그 조합이 실제로 있는지는 확인된 바 없다. 코드는 남기되 이 사실을 문서에 적는다 |
| 5 | pane 이 많아지면 좁아진다 | 슬롯은 보통 2~3 이다. `Ctrl-b z` 로 확대한다 |
| 6 | 고아 tmux 서버 | 전제 검사가 찾아 보고한다 |

---

## 13. 반영 범위

| 대상 | 내용 |
|---|---|
| `.claude/skills/dflow-team/SKILL.md` | 환경 감지, 전제 검사(`NO_TMUX` 신설·`NO_CLAUDE_CLI`·`LEAD_SKIP_PERMISSIONS` 제거), 권한 안내, 팀장 상태 재구성, 결과 처리 생존 증거, 감시 루프, 「6. blocked」, 정리 |
| `.claude/skills/dflow-team/references/backends.md` | 「프로세스」 절 제거, 「pane(tmux)」 절 신설, 차이표 개정, 플랫폼 차이 개정 |
| `docs/superpowers/specs/2026-09-10-dflow-team-design.md` | 29·44·57·111-114·356·1342·1545 행 갱신 |
| `scripts/kit-build.sh` | 재빌드 후 dflow-kit push |
| `docs/agent/2026-09-16-agent-loop-e2e-test.md` | 단계 16 에 tmux pane 칸 복원 |
