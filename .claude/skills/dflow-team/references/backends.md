# /dflow-team 백엔드: spawn·정리 명령 정본

SKILL.md 「0. 환경 감지」 가 백엔드를 고른다. 워커 프롬프트·`.result` 계약·`/dflow-dev --worker` 는 두
백엔드가 같다. 백엔드가 가르는 것은 아래 차이표의 항목뿐이다.

tmux pane 백엔드는 v1 미지원이다(tmux 에서도 에이전트 팀으로 돈다).

## 차이표

| 항목 | pane(Orca) | 에이전트 팀 |
|---|---|---|
| 팀원 정체 | 별도 프로세스의 claude 메인 에이전트(권한 확인 생략 모드) | Agent 도구 팀원(`name` + `isolation: "worktree"`). 팀장 세션의 권한 모드를 물려받는다 |
| 워크트리 | `orca worktree create` 가 `origin/<기본브랜치>` 기점으로 만든다 | 격리가 팀장의 현재 HEAD 에서 만든다. 워커 부트스트랩이 `origin/<기본브랜치>` 로 detach 한다 |
| 기상 신호 | 감시 루프의 `RESULT_READY` | 팀원 완료 알림 |
| `blocked` 이후 | 팀원은 탭에서 멈춰 기다린다 | 팀원은 세션을 끝낸다 |
| 슬롯 점유 | `blocked` 동안 슬롯을 계속 잡는다 | 결과 처리 직후 슬롯을 해제한다 |
| 사람의 답 | 그 팀원 탭에 직접 준다 | 팀장 세션에 `<id8> <답>` 으로 준다. 팀장이 `ANSWER=` 를 붙여 재spawn 한다 |
| 회수 | 없음(별도 프로세스) | 결과 줄 처리 직후 `TaskStop(w<slot>-<id8>)` |
| 팀장 세션이 죽으면 | 팀원은 살아남는다 | 팀원도 함께 죽는다(마지막 push 까지만 남는다) |
| 정리 | `orca worktree rm --worktree path:<경로>` | `git worktree remove --force <경로>` |
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

## 에이전트 팀

**spawn**: Agent 도구로 띄운다.

| 파라미터 | 값 |
|---|---|
| `subagent_type` | `general-purpose`(Skill·Agent·Bash 를 포함한 모든 도구) |
| `name` | `w<slot>-<id8>` |
| `isolation` | `"worktree"`. **필수.** 빠뜨리면 팀원이 팀장 체크아웃을 상속해 서로의 브랜치를 덮어쓰며, 이 실패는 조용하다 |
| `model` | 인자로 받은 모델(`opus`/`sonnet`). 없으면 생략 |
| `description` | `w<slot> <TSK>` |
| `prompt` | 포인터 한 줄. `blocked` 재spawn 이면 둘째 줄에 `ANSWER=<담당자 답 한 줄>` |

- 팀원은 백그라운드로 돈다. 끝나면 완료 알림이 오고, 변경이 남았으면 워크트리 경로·브랜치가 함께 온다.
- 이름에 id8 을 붙이는 이유: 결과 매칭과 회수가 이 이름을 쓰며, 같은 슬롯의 다음 작업과 이름이 겹치지
  않는다. 좌석표 식별은 이름이 아니라 포인터의 `AGENT_ID=` 가 정한다.
- 회수: 결과 줄을 처리한 직후(status 와 무관하며 `blocked` 도 포함한다) `TaskStop(w<slot>-<id8>)`. 이름 붙은
  에이전트는 일을 마쳐도 idle 로 남는다.
- `blocked` 워크트리: 팀원이 커밋·push 하고 끝나므로, 결과 처리 직후 「고아 정리 규칙」 2번을 맞추면(HEAD 가
  `origin/<agent 브랜치>` 와 같으면) 그 자리에서 정리한다. 정리할 수 없으면 `.dflow-agent` 값을 `parked` 로
  바꿔 정규 슬롯 스캔에서 빼고, 고아 규칙으로 보고한다.
  ```bash
  printf '%s\n' '<신원>/<host>/parked' > <워크트리>/.dflow-agent
  ```
  이유: 보존된 워크트리의 `.dflow-agent` 가 `w<slot>` 값을 그대로 가지면, 그 슬롯에 새로 뜬 팀원과 같은 슬롯
  표시를 가져 재구성이 충돌한다.

**정리**: 워크트리가 아직 있을 때만 팀장 체크아웃에서 한다.
```bash
git worktree remove --force <워크트리 경로>
```
`--force` 는 미추적 부산물(`.result`·`.dflow-agent`·`.env` 링크·스킬 링크) 때문에 필요하다. 먼저
「고아 정리 규칙」 을 따른다.

## 고아 정리 규칙

두 백엔드 공통이다. 대상은 루트 `.dflow-agent` 값이 `<신원>/<host>/` 로 시작하는 워크트리(`parked` 포함)다.
결과 처리(done·needs-merge·skipped·failed·에이전트 팀 `blocked`), 고아 스캔, 무응답 자동 정리, 마감이 이
규칙으로 팀원 워크트리를 지운다.
1. **부트스트랩 실패**(`.result` 의 branch 칸이 `-`, 브랜치를 만들기 전에 끝남): 미커밋 목록이 알려진
   부산물(`.dflow-agent`, `.result`, `docs/tasks/<TSK>/spec.md` 캐시, `.env` 링크, 스킬 링크(`.claude/skills` 또는
   그 안의 `dflow-dev`·`dflow-work`))뿐일 때만 정리한다(에이전트 팀은 `git worktree remove --force`, Orca 는
   `orca worktree rm --worktree path:<경로> --force`). 두 백엔드 모두 `--force` 를 쓰는 이유: 알려진 부산물 중
   `spec.md` 캐시와 스킬 폴더 안의 개별 링크는 공유 `info/exclude` 가 가리지 않는 미추적 파일이라 `--force`
   없이는 제거가 거부될 수 있다. Orca 의 `--force` 는 워크트리 강제 제거만 하고 브랜치 삭제는 강제하지 않는다.
   ```bash
   git -C <워크트리> status --porcelain --untracked-files=all \
     | grep -v -E '^\?\? (\.dflow-agent|\.env|\.claude/skills(/dflow-(dev|work))?|docs/tasks/<TSK>/(spec\.md|\.result))$'
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
   "재개 필요" 보고에 붙인다. 이유: 느린 팀원이나 커밋 전에 멈춘 팀원의 산출물을 잃지 않는다.
4. 살아 있는 팀원(SKILL.md 「팀장 상태」 정의)의 워크트리는 조건과 무관하게 지우지 않는다. pane 의 `blocked`
   워크트리도 여기에 든다(팀원이 탭에서 답을 기다린다). 예외는 무응답 자동 정리(SKILL.md 「3. 결과 처리」) 하나다.
5. **생성 브랜치 정리**: 워크트리를 지웠으면(에이전트 팀 워크트리가 이미 자동 정리됐어도) 그 워크트리를 만들
   때 생긴 브랜치를 지운다. 에이전트 팀은 `worktree-<워크트리 디렉터리 이름>`, Orca 는 이름에 `dflow-<id8>` 이
   든 브랜치다. `agent/` 로 시작하는 브랜치는 지우지 않는다(작업 산출물이다).
   ```bash
   git fetch origin
   git branch --format='%(refname:short)' --list 'worktree-<워크트리 디렉터리 이름>' '*dflow-<id8>*' | while IFS= read -r br; do
     case "$br" in agent/*) continue ;; esac
     git merge-base --is-ancestor "$br" origin/<기본브랜치> && git branch -D "$br"
   done
   ```
   `git branch -D` 는 다른 워크트리가 체크아웃한 브랜치를 거부하므로 그런 브랜치는 남는다. 이유: 워커가 곧바로
   detach 하므로 생성 브랜치는 체크아웃되지 않은 채 남아 Orca 정리도 지우지 않고, 같은 id8 을 다시 띄우면
   이름이 부딪치며 작업마다 쌓인다. `origin/<기본브랜치>` 의 조상인 것만 지우는 이유는 이름만 맞는 브랜치의
   고유 커밋을 잃지 않기 위해서다. Orca 가 만드는 실제 이름은 리허설이 확인한다.
   워크트리 디렉터리 이름을 모르면(에이전트 팀 워크트리가 이미 자동 정리됐고 `team.spawn` 의 `worktree` 가 `-`
   이거나 컨텍스트 압축으로 이름을 잃은 경우) 위 루프의 첫 줄만
   `git branch --format='%(refname:short)' --list 'worktree-agent-*' '*dflow-[0-9a-f]*'` 로 바꿔 돌린다. 앞의 `*` 는
   Orca 가 이름 앞에 다른 접두를 붙일 수 있어서이고, `dflow-` 뒤를 16진수로 한정하는 이유는 `worktree-dflow-team`
   같은 개발 브랜치를 후보에서 빼기 위해서다.
   세 안전 조건(`agent/` 아님, 체크아웃 안 됨, `origin/<기본브랜치>` 의 조상)은 루프가 그대로 지킨다. 이유:
   이름을 채우지 못해 정리를 건너뛰면 생성 브랜치가 쌓이고, 세 조건이 이름만 맞는 남의 브랜치를 보호한다.
