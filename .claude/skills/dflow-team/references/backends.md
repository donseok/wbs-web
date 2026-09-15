# /dflow-team 백엔드: spawn·정리 명령 정본

SKILL.md 「0. 환경 감지」 가 백엔드를 고른다. 워커 프롬프트·`.result` 계약·`/dflow-dev --worker` 는 두
백엔드가 같다. 백엔드가 가르는 것은 아래 차이표의 항목뿐이다.

tmux pane 백엔드는 지원하지 않는다(tmux 에서도 프로세스 백엔드로 돈다).

## 차이표

| 항목 | pane(Orca) | 프로세스 |
|---|---|---|
| 팀원 정체 | 별도 프로세스의 claude 메인 에이전트(권한 확인 생략 모드) | 팀장이 `nohup claude -p` 로 띄운 별도 프로세스의 claude 메인 에이전트(비대화형). 팀장과 같은 설정(권한 규칙)을 쓰고, 팀장이 권한 확인 생략 모드면 같은 플래그를 받는다 |
| 워크트리 | `orca worktree create` 가 `origin/<기본브랜치>` 기점으로 만든다 | 팀장이 `git worktree add --detach` 로 `<MAIN>/.claude/worktrees/dflow-<id8>` 를 `origin/<기본브랜치>` 기점으로 만든다. 브랜치를 만들지 않는다 |
| 기상 신호 | 감시 루프의 `RESULT_READY` | 감시 루프의 `RESULT_READY`·`PROC_DEAD` |
| `blocked` 이후 | 팀원은 탭에서 멈춰 기다린다 | 팀원은 프로세스를 끝낸다 |
| 슬롯 점유 | `blocked` 동안 슬롯을 계속 잡는다 | 결과 처리 직후 슬롯을 해제한다 |
| 사람의 답 | 그 팀원 탭에 직접 준다 | 팀장 세션에 `<id8> <답>` 으로 준다. 팀장이 `ANSWER=` 를 붙여 재spawn 한다 |
| 회수 | 없음(별도 프로세스) | 결과 줄 처리 뒤 프로세스가 아직 살아 있으면 `kill <PID>` |
| 팀장 세션이 죽으면 | 팀원은 살아남는다 | 팀원은 살아남는다(`nohup`). 새 팀장이 재구성에서 `.dflow-pid` 로 살아 있는 팀원을 흡수한다 |
| 정리 | `orca worktree rm --worktree path:<경로>` | `git worktree remove --force <경로>` |
| 팀원 화면 | `orca terminal read`(보고용) | 없음. `<워크트리>/.dflow-worker.log` 가 마지막 응답 폴백이다 |
| git 호출 | `command -v git` 절대경로 | 같다(두 백엔드 공통) |

## pane(Orca)

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

## 프로세스

팀원은 팀장이 만든 링크드 워크트리에서 도는 별도 `claude -p` 프로세스다. Agent 도구 서브에이전트로 띄우지
않는다. 이유: 서브에이전트는 자기 턴이 끝나면 하네스가 완료로 보고, 그 뒤에 끝난 손자 서브에이전트의 완료가
서브에이전트를 깨우지 못해 Phase 손자를 기다리다 멈춘다(리허설 실측). 별도 `claude -p` 프로세스의 메인 에이전트는
손자 완료 알림으로 다시 깨어나고(실측), 팀장 세션이 죽어도 살아남는다.

**spawn**: 「5. 팀원 spawn」 의 포인터 한 줄을 `<워크트리>/.dflow-prompt` 에 쓰고 그 파일 내용을 프롬프트로 넘긴다.
`blocked` 재spawn 이면 둘째 줄이 `ANSWER=<담당자 답 한 줄>` 이다. 셸 인자에 답을 직접 넣지 않는 이유: 답에 따옴표·
백틱이 들어갈 수 있다. 팀장 체크아웃에서 한 번의 Bash 호출로 돌린다.
```bash
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
printf '%s\n' '<포인터 한 줄>' > "$WT/.dflow-prompt"            # 재spawn: printf '%s\n%s\n' '<포인터 한 줄>' 'ANSWER=<답 한 줄>'
pstart() { case "$(uname -s)" in MINGW*|MSYS*|CYGWIN*) w=$(ps -p "$1" | awk 'NR==1{for(i=1;i<=NF;i++) if($i=="WINPID") c=i} NR==2{if($1 ~ /^[A-Z]$/) c++; print $c}'); [ -n "$w" ] && powershell.exe -NoProfile -Command "(Get-Process -Id $w).StartTime.ToString('o')" 2>/dev/null | tr -d '\r' ;; *) ps -o lstart= -p "$1" 2>/dev/null ;; esac; }
( cd "$WT" && nohup claude -p "$(cat .dflow-prompt)" <모델 플래그> <권한 플래그> > .dflow-worker.log 2>&1 < /dev/null &
  echo $! > .dflow-pid && pstart "$(cat .dflow-pid)" >> .dflow-pid )
cat "$WT/.dflow-pid"
```
- Windows(Git Bash) 에서는 `ln -s` 가 링크 대신 복사본을 만든다. 복사본으로도 동작한다: `.env` 는 정적이고
  스킬은 읽기 전용이며, 두 경로 모두 `info/exclude`·`.gitignore` 로 가려진다. 대가로 팀장이 스킬을 고쳐도 이미
  뜬 팀원의 복사본에는 반영되지 않고, 워크트리마다 `.env` 사본이 생기므로 정리 규칙이 워크트리를 지울 때 함께
  지워진다.
- `<모델 플래그>` 는 `MODEL` 이 `opus`·`sonnet` 이면 `--model opus`·`--model sonnet`, `default` 면 빈 값이다.
- `<권한 플래그>` 는 팀장 세션이 권한 확인 생략 모드로 떠 있으면(전제 검사의 `LEAD_SKIP_PERMISSIONS=1`)
  `--dangerously-skip-permissions`, 아니면 빈 값이다. 빈 값이면 팀원은 팀장과 같은 설정 파일의 권한 규칙
  (`permissions.defaultMode`·`allow`)을 쓴다. 비대화형이라 확인 프롬프트를 띄울 수 없으므로 확인이 필요한 명령은
  거부되고, 워커는 그것을 `failed permission <명령 앞부분>` 으로 보고한다(worker-prompt.md 「6. 판단 규칙」).
- `.env`·스킬 링크를 팀장이 먼저 만드는 이유: `claude -p` 는 시작할 때 cwd 의 `.claude/skills` 를 읽으므로,
  링크가 먼저 있어야 팀원의 Skill 도구가 `dflow-dev` 를 안다. 워커 부트스트랩(worker-prompt.md 「3」)의 같은
  명령은 이미 있으면 건너뛴다. 스킬 폴더가 실제 폴더로 있는데 `dflow-dev` 가 없으면 폴더째 링크하지 않고 워커가
  쓰는 스킬만 하나씩 링크한다(있는 폴더에 폴더째 링크를 걸면 `.claude/skills/skills` 가 생긴다).
- `git worktree add` 가 실패하면(`SPAWN_FAILED_WORKTREE`, 대개 같은 경로가 남아 있음) 띄우지 않고 경로를 보고한다.
  같은 id8 의 옛 워크트리는 결과 처리가 지웠거나 `parked` 로 남아 있다. `parked` 면 「6. blocked」 대로 "사람 확인
  필요" 다.
- `nohup … &` 로 띄우는 이유: Bash 호출이 끝나도 프로세스가 살아남아야 하고(실측: 호출이 끝난 뒤에도 계속 돈다),
  팀장 세션이 죽어도 팀원이 이어 가야 한다. `run_in_background` 로 띄우면 팀장 세션과 함께 죽는다. 팀원 spawn 은
  SKILL.md 「금지」 의 "셸 `&`" 규칙의 유일한 예외다.
- `.dflow-pid` 는 두 줄이다: PID 와 `pstart` 가 돌려준 시작 시각 문자열. 생존 확인은 둘을 함께 본다.
  ```bash
  pstart() { case "$(uname -s)" in MINGW*|MSYS*|CYGWIN*) w=$(ps -p "$1" | awk 'NR==1{for(i=1;i<=NF;i++) if($i=="WINPID") c=i} NR==2{if($1 ~ /^[A-Z]$/) c++; print $c}'); [ -n "$w" ] && powershell.exe -NoProfile -Command "(Get-Process -Id $w).StartTime.ToString('o')" 2>/dev/null | tr -d '\r' ;; *) ps -o lstart= -p "$1" 2>/dev/null ;; esac; }
  pid=$(head -n 1 "$WT/.dflow-pid"); st=$(sed -n '2p' "$WT/.dflow-pid")
  kill -0 "$pid" 2>/dev/null && [ "$(pstart "$pid")" = "$st" ] && echo ALIVE || echo DEAD
  ```
  시작 시각까지 비교하는 이유: 죽은 팀원의 PID 를 다른 프로세스가 다시 받을 수 있다. `pstart` 는 macOS·Linux 에서
  `ps -o lstart=`, Windows(Git Bash) 에서는 MSYS `ps -p` 출력의 WINPID 열(머리글에서 열 위치를 찾고, 첫 칸의 상태
  글자만큼 밀린다)로 Windows PID 를 얻은 뒤 PowerShell `Get-Process` 의 `StartTime` 을 쓴다. MSYS `ps` 에는 `-o` 가 없고, `$!` 는 Cygwin PID 라
  Windows PID 와 다를 수 있기 때문이다.
- `.dflow-pid`·`.dflow-prompt`·`.dflow-worker.log` 는 팀장이 쓰는 미추적 파일이며 전제 검사가 공유 `info/exclude`
  에 넣는다. 워커는 손대지 않는다.
- `team.spawn` 의 `worktree` 는 `$WT`, `handle` 은 `pid:<PID>` 다.
- 팀원 프로세스는 팀장 세션 안에 나타나지 않는다. ListAgents 에 팀원도 손자도 없다. 손자 Phase 서브에이전트는
  팀원 프로세스의 서브에이전트이므로 팀원이 스스로 회수한다.

**결과 줄과 마지막 응답 폴백**: 결과는 `<워크트리>/docs/tasks/<TSK>/.result` 다. 프로세스가 죽었는데 파일이
없으면 `.dflow-worker.log` 에서 `<TSK> <id8> ` 로 시작하는 마지막 줄을 찾는다(워커는 같은 줄을 마지막 응답으로도
출력한다). 그것도 없으면 `failed no-result` 다(SKILL.md 「3. 결과 처리」).
```bash
grep -E '^<TSK> <id8> ' "$WT/.dflow-worker.log" | tail -n 1
```

**회수**: 결과 줄을 처리한 뒤 프로세스가 아직 살아 있으면(위 생존 확인이 `ALIVE`) `kill "$pid"` 로 멈춘다. 워커는
`.result` 를 쓴 뒤 곧 끝나므로 보통은 이미 죽어 있다. 무응답 자동 정리(두 TICK 연속 생존 증거 없음)도 같은
`kill` 로 멈춘 뒤 워크트리를 「고아 정리 규칙」 대로 다룬다.

**`blocked` 워크트리**: 팀원이 커밋·push 하고 끝나므로, 결과 처리 직후 「고아 정리 규칙」 2번(미커밋 변경 없음,
HEAD 가 `origin/<agent 브랜치>` 와 같음)을 맞추면 그 자리에서 정리한다. 정리할 수 없으면 3번대로 `.dflow-agent` 값을 `parked`
로 바꿔 정규 슬롯 스캔에서 빼고 보고한다.

**정리**: 워크트리가 아직 있을 때만 팀장 체크아웃에서 한다.
```bash
git worktree remove --force "$WT"
```
`--force` 는 미추적 부산물(`.result`·`.dflow-agent`·`.dflow-pid`·`.dflow-prompt`·`.dflow-worker.log`·`.env` 링크·스킬
링크) 때문에 필요하다. 먼저 「고아 정리 규칙」 을 따른다. 살아 있는 팀원의 워크트리는 지우지 않는다.

## 고아 정리 규칙

두 백엔드 공통이다. 대상은 루트 `.dflow-agent` 값이 `<신원>/<host>/` 로 시작하는 워크트리(`parked` 포함)다.
결과 처리(done·needs-merge·skipped·failed·프로세스 `blocked`), 고아 스캔, 무응답 자동 정리, 마감이 이
규칙으로 팀원 워크트리를 지운다.
1. **부트스트랩 실패**(`.result` 의 branch 칸이 `-`, 브랜치를 만들기 전에 끝남): 미커밋 목록이 알려진
   부산물(`.dflow-agent`, `.dflow-pid`, `.dflow-prompt`, `.dflow-worker.log`, `.result`, `docs/tasks/<TSK>/spec.md`
   캐시, `.env` 링크, 스킬 링크(`.claude/skills` 또는 그 안의 `dflow-dev`·`dflow-work`))뿐일 때만 정리한다
   (프로세스는 `git worktree remove --force`, Orca 는 `orca worktree rm --worktree path:<경로> --force`). 두 백엔드
   모두 `--force` 를 쓰는 이유: 알려진 부산물 중 `spec.md` 캐시와 스킬 폴더 안의 개별 링크는 공유 `info/exclude` 가
   가리지 않는 미추적 파일이라 `--force` 없이는 제거가 거부될 수 있다. Orca 의 `--force` 는 워크트리 강제 제거만
   하고 브랜치 삭제는 강제하지 않는다.
   ```bash
   git -C <워크트리> status --porcelain --untracked-files=all \
     | grep -v -E '^\?\? (\.dflow-(agent|pid|prompt|worker\.log)|\.env|\.claude/skills(/dflow-(dev|work)(/.*)?)?|docs/tasks/<TSK>/(spec\.md|\.result))$'
   ```
   출력이 비어 있어야 한다. 그 밖의 변경이 있으면 보존하고 경로와 목록을 보고한다. 이유: 브랜치가 없어도
   워커가 무언가를 고쳤다면 그것은 사람이 판단할 산출물이다.
2. **그 밖**: 아래 두 조건이 모두 참일 때만 정리한다.
   ```bash
   git -C <워크트리> status --porcelain       # 비어 있어야 한다. 부산물은 info/exclude 로 가려져 있다
   git fetch origin
   test "$(git -C <워크트리> rev-parse HEAD)" = "$(git -C <워크트리> rev-parse origin/<agent 브랜치>)"
   ```
3. 하나라도 거짓이면 지우지 않고, 경로와 미커밋 목록(`git -C <워크트리> status --porcelain` 출력)을
   "재개 필요" 보고에 붙이며, 살아 있는 팀원의 워크트리(4번)가 아니면 `.dflow-agent` 값을 `parked` 로 바꿔
   정규 슬롯 스캔에서 뺀다. 이유: 느린 팀원이나 커밋 전에 멈춘 팀원의 산출물을 잃지 않는다. 보존된 워크트리의
   `.dflow-agent` 가 `w<slot>` 값을 그대로 가지면, 그 슬롯에 새로 뜬 팀원과 같은 슬롯 표시를 가져 재구성이
   충돌한다.
   ```bash
   printf '%s\n' '<신원>/<host>/parked' > <워크트리>/.dflow-agent
   ```
4. 살아 있는 팀원(SKILL.md 「팀장 상태」 정의)의 워크트리는 조건과 무관하게 지우지 않는다. pane 의 `blocked`
   워크트리도 여기에 든다(팀원이 탭에서 답을 기다린다). 예외는 무응답 자동 정리(SKILL.md 「3. 결과 처리」) 하나다.
5. **생성 브랜치 정리**: 워크트리를 지웠으면 그 워크트리를 만들 때 생긴 브랜치를 지운다. Orca 는 이름에
   `dflow-<id8>` 이 든 브랜치다. 프로세스 워크트리는 `--detach` 로 만들어 생성 브랜치가 없다. `agent/` 로 시작하는
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
| 호스트 이름 | `hostname` 의 첫 점 앞부분(`hostname \| cut -d. -f1`) | 같다. Windows 의 hostname.exe 에는 `-s` 가 없다 |
| 팀장 세션 PID | `CLAUDE_PID`(= `$PPID`) | `CLAUDE_PID`(필수. 없으면 전제 검사가 `NO_CLAUDE_PID` 로 중단). `$PPID` 는 부모가 Cygwin 프로세스가 아니면 1 이다 |
| 프로세스 시작 시각(`pstart`) | `ps -o lstart=` | MSYS `ps -p` 의 WINPID 열(머리글로 위치를 찾는다)로 Windows PID 를 얻고 PowerShell `Get-Process` 의 `StartTime`. MSYS `ps` 에는 `-o` 가 없다 |
| 권한 확인 생략 감지 | `ps -o command=` | PowerShell `Get-CimInstance Win32_Process` 의 `CommandLine` |
| `.env`·스킬 링크 | 심링크 | `ln -s` 가 복사본을 만든다. 복사본으로 동작한다(「프로세스」 spawn) |
| 필요한 명령 | bash·coreutils·ps·git·jq·curl | Git for Windows 의 bash·coreutils·ps 와 git·jq·curl·powershell.exe |

프로세스 생존 확인(`kill -0`)과 회수(`kill`)는 두 플랫폼에서 같은 명령이다.

- **신호 전달**: `$!` 에 보낸 `kill` 이 네이티브 자식(node.exe·claude)까지 끝내는 것을 GitHub Actions
  Windows 러너(Windows Server 2025, Git 2.55, bash 5.3)에서 확인했다. npm 심(`#!/bin/sh` 스크립트가
  `exec node …`)과 네이티브 `claude.exe` 모두 같다.
- **`pstart` 비용**: PowerShell 기동 때문에 호출당 0.4~0.5초 든다. 슬롯 수 × 기상 횟수만큼 누적되지만
  허용 범위다.
- **`ln -s`**: 복사본을 만든다(파일·폴더 모두). `MSYS=winsymlinks:nativestrict` 를 주면 진짜 심링크가
  되지만 설계는 복사본을 전제로 한다.
- **줄끝**: Windows 기본 `core.autocrlf=true` 클론은 스크립트를 CRLF 로 바꾼다. 킷과 설치 대상의
  `.gitattributes`(install.sh 가 넣는다)가 LF 로 고정하고, `dflow.sh`·heartbeat 훅이 `.env` 값의 `\r`
  을 걷어낸다.
- **미확인**: 실제 Windows Claude Code 세션의 Bash 도구가 `CLAUDE_PID` 를 내보내는지는 러너에서 잴 수
  없었다(세션이 없다). 그래서 전제 검사가 `NO_CLAUDE_PID` 로 막는다(SKILL.md 「1. 시작」 전제 검사).
