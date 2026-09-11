---
name: dflow-team
description: D'Flow 에서 내게 배정되고 에이전트 위임(tags:agent)된 ready 작업을 상시 감시해 슬롯 N개의 팀원에게 나눠 동시에 개발시키는 팀장 스킬. 팀원은 자기 서브에이전트를 띄울 수 있는 독립 세션(Orca pane 또는 에이전트 팀 isolation:worktree)이며 각자 워크트리에서 /dflow-dev 를 돌린다. 낮 시간 supervised 전용. 트리거 - "/dflow-team", "팀으로 개발", "팀장 시작", "N건 동시 착수". 사용법 - /dflow-team [인원] <종료시각> [모델]
---

# /dflow-team: 팀장 (슬롯 N개 동시 개발)

인자: `$ARGUMENTS`

> **위치 선언**: 설계 정본은 wbs-web 리포 docs/superpowers/specs/2026-09-10-dflow-team-design.md(킷에는
> 미동봉). `/dflow-poll` 이 한 번에 1건만 착수하던 것을 슬롯 N개 동시 착수와 상시 보충으로 넓힌다. 담당자가
> 자리에 있는 낮 시간 supervised 루프다. 서버 통신은 dflow.sh 로 하고 exit code 로 분기하며, dflow-work
> 금지사항을 상속한다.
>
> **제1 제약: 팀원을 단순 서브에이전트로 띄우지 않는다.** 팀원은 `/dflow-dev` 를 실행하고 `/dflow-dev` 는
> Phase 1~4 를 서브에이전트로 쪼갠다. 단순 서브에이전트는 다시 서브에이전트를 띄우지 못하므로, 팀원은 pane
> 의 별도 프로세스(Orca) 또는 에이전트 팀 팀원(Agent 도구 + `name` + `isolation: "worktree"`)이어야 한다.

참조: `references/backends.md`(백엔드별 spawn·정리 명령, 차이표, 고아 정리 규칙), `references/worker-prompt.md`
(팀원 규칙. 팀장은 포인터로 넘기기만 한다), `references/events.md`(events.jsonl 이벤트 표·기록 명령).

이 문서의 `dflow.sh` 는 `.claude/skills/dflow-work/scripts/dflow.sh` 이며, 부를 때마다 `set -a; . ./.env; set +a`
를 앞에 붙인다. `<기본브랜치>` 는 「1. 시작」 전제 검사가 구한 이름이다(`origin/HEAD` 에서 `origin/` 을 뗀 값, 그 ref
가 없으면 `git ls-remote --symref origin HEAD` 의 값).
`<MAIN>`·`<MAIN_CHECKOUT>` 은 팀장 체크아웃의 절대경로, `<신원>`·`<host>` 는 「1. 시작」 전제 검사가 만든
슬러그다.

## 인자

`/dflow-team [인원] <종료시각> [모델]`. 예: `/dflow-team 18:00`, `/dflow-team 4명 18시까지 opus`.

- 인자는 자연어로 해석한다. 플래그 문법을 강제하지 않는다.
- **종료 시각은 유일한 필수 인자다.** 없으면 아래 사용법을 출력하고 종료한다. 무인 야간 실행을 막는
  규칙이며 `/dflow-poll` 과 같다.
  ```
  사용법: /dflow-team [인원] <종료시각> [모델]   예) /dflow-team 18:00 · /dflow-team 4명 18시까지 opus
         종료시각은 당일 시각만(자정 넘김 불가)
  ```
  종료 시각은 새 배정을 멈추는 시각이다. 진행 중인 팀원은 대기 상한까지 기다리고, 그 뒤에 남은 것은
  목록으로 보고한다(「7. 마감」). 이미 지난 시각이나 자정을 넘기는 시각은 받지 않는다(poll.sh 가 자정 넘김을
  지원하지 않는다). 늦은 밤에 새벽 시각을 주면 `UNTIL_PAST` 로 거부되므로, 사용법과 거부 안내 모두에 당일
  시각만 받는다는 것을 적는다.
- 인원은 동시 팀원 슬롯 수다. **기본 3, 하드 상한 4.** 4 를 넘기면 4 로 자르고 그 사실을 한 줄 알린다.
  슬롯마다 독립 메인 에이전트가 떠서 비용과 사용량 한도 소모가 빠르게 늘기 때문이다.
- 모델은 선택이다(`opus`|`sonnet`). 없으면 포인터에 `MODEL=default` 를 넘겨 기본 모델을 쓴다. 값은 팀원이
  `/dflow-dev --model` 로 넘긴다.
- 감시 주기는 300초로 고정한다.
- 작업을 빼는 인자는 없다. 특정 작업을 잡지 않게 하려면 D'Flow 에서 그 작업의 `agent` 태그를 끈다. 팀장
  내부의 제외 목록은 그대로 있다.

## 팀장 상태: 메모리는 캐시다

팀장이 다루는 상태는 슬롯 표(슬롯 번호, `AGENT_ID`, TSK, id8, 워크트리 경로, 터미널 핸들 또는 에이전트
이름, 시작 시각, suspect 표시와 직전 생존 증거), 대기 큐(ready 인데 슬롯이 없어 아직 못 준 id8), 영구 제외
목록(failed·반려·진행 중), 일시 제외 목록(선행·spec 사유), 답을 받았으나 아직 재spawn 하지 못한 `blocked`
작업, 답을 기다리는 에이전트 팀 `blocked` 작업, 결과 줄 경로별 마지막 처리 해시, 차단기 상태, 감지된 백엔드다.
세션 메모리의 이 값들은 캐시일 뿐이며, 팀장은 **깨어날 때마다** 아래 정본에서 다시 만든다. 이유: 몇 시간 도는 세션은 컨텍스트 압축을 겪고, 요약에서
슬롯이 빠지면 `.result` 가 와도 처리되지 않는다.

이 절의 접두는 모두 `<신원>/<host>/` 로 시작한다. 이유: 같은 신원이 다른 PC 에서 띄운 팀장의 워크트리를 이
팀장이 자기 것으로 읽지 않게 한다.

**정본**: 이 신원·이 PC 의 팀원 워크트리와 그 결과.
```bash
git worktree list --porcelain | sed -n 's/^worktree //p' | while IFS= read -r w; do
  [ -f "$w/.dflow-agent" ] || continue
  a=$(head -n 1 "$w/.dflow-agent")
  case "$a" in "<신원>/<host>/"*) ;; *) continue ;; esac
  rf=$(find "$w/docs/tasks" -mindepth 2 -maxdepth 2 -name .result 2>/dev/null | head -n 1)
  r=$([ -n "$rf" ] && head -n 1 "$rf")
  printf '%s\t%s\t%s\t%s\n' "$a" "$w" "$(git -C "$w" branch --show-current)" "${r:--}"
done
```
- 루트 `.dflow-agent` 값이 `<신원>/<host>/w` 로 시작하는 워크트리가 팀원 워크트리이고, 값의 슬롯 번호가 그
  워크트리의 슬롯이다. 값이 `<신원>/<host>/parked` 인 워크트리는 슬롯이 아니며 고아 스캔만 본다.
- 그 워크트리 안의 `docs/tasks/*/.result` 가 팀원의 결과다.
- 그 워크트리의 브랜치 이름 `agent/<id8>-…`(있으면)과 Orca 워크트리 이름 `dflow-<id8>` 이 작업을 알려 준다.

**보조**: `~/.dflow/events.jsonl` 에서 마지막 `team.start` 이후이고 `agent` 가 `<신원>/<host>/lead`, `repo` 가
이 리포(`<MAIN>`)인 줄.
```bash
jq -c --arg a '<신원>/<host>/lead' --arg r '<MAIN>' 'select(.agent == $a and .repo == $r)' ~/.dflow/events.jsonl 2>/dev/null \
  | awk '/"event":"team.start"/{buf=""} {buf=buf $0 "\n"} END{printf "%s", buf}'
```
- `team.spawn` 의 `slot`·`id8`·`worktree`·`handle` 로 슬롯과 작업을 잇는다. 아직 브랜치를 만들지 않은 Phase 0
  의 팀원도 이것으로 id8 을 안다.
- `team.result`·`team.blocked` 로 이미 판정한 작업, 제외 목록(`skipped` 는 일시, `failed`·`failed no-result`·
  `failed not-isolated`·`failed no-worker-flag`·`failed deps`·`blocked` 는 영구, `failed rate-limit` 은 제외
  없음), 차단기 상태(끝에서부터 연속한 `failed…` 수), 결과 줄 경로별 마지막 처리 해시(경로는
  `<worktree>/docs/tasks/<tsk>/.result`)를 복원한다.
- 제외 목록은 id8 마다 마지막 `team.spawn`·`team.blocked`·`team.result` 로 정한다. 마지막이 `team.spawn` 이나
  `team.blocked` 면 진행 중(영구 제외)이고, `team.result` 면 위 status 별 제외다. `team.answer` 는 제외를 바꾸지
  않는다. 이유: 일시 제외가 풀려 다시 띄운 작업이 옛 `skipped` 로 다시 일시 제외되거나, 결과가 난 작업이 진행
  중으로 남지 않게 한다.
- 에이전트 팀의 `team.blocked` 중 그 뒤에 같은 id8 의 `team.answer` 가 없는 것이 답을 기다리는 질문이다.
- `team.answer` 중 그 뒤에 같은 id8 의 `team.spawn` 이 없는 것이 아직 재spawn 하지 못한 답이다.

**재구성 규칙**
- 살아 있는 팀원의 워크트리는 그 `.dflow-agent` 슬롯 번호로 슬롯 표에 흡수한다. 그 안에 `.result` 가 있으면
  처리 여부를 해시로 가린 뒤 처리한다(「3. 결과 처리」).
- 새로 줄 슬롯 번호는 흡수한 번호를 뺀 1..N 중 가장 작은 것이다. 이유: 살아 있는 팀원과 같은 `AGENT_ID` 를
  다시 발급하면 좌석표가 한 인물을 두 책상에 그린다.
- "살아 있는 팀원" 은 spawn 했고 아직 최종 판정(`done`·`needs-merge`·`skipped`·`failed`)을 받지 않은 팀원이다.
  터미널이 떠 있는지로 판단하지 않는다. pane 이면 `.dflow-agent` 가 `w<slot>` 인 워크트리 중 최종 status 의
  `.result` 가 없는 것이며, `blocked` 는 최종 판정이 아니므로 그 팀원은 살아 있다. 실제로 죽은 pane 팀원은
  무응답 규칙(「3. 결과 처리」)이 가려낸다. 에이전트 팀은 같은 세션에서 spawn 했고 결과를 처리하지 않은
  팀원만 해당하며, `blocked` 로 끝난 팀원은 살아 있지 않다. 팀장 세션이 새로 뜬 경우에는 에이전트 팀 팀원이
  하나도 살아 있지 않다고 본다. 팀원은 팀장과 함께 죽기 때문이다.
- 대기 큐는 재구성하지 않는다. 비어 있어도 다음 poll 이 같은 ready 를 다시 찾는다. 예외는 답을 받은
  `blocked` 작업이다. 이 작업은 진행 중으로 영구 제외돼 poll 이 다시 찾지 않으므로 `team.answer` 에서 복원해 대기 큐 맨 앞에 둔다.
- **결과 중복 방지**: 결과 줄은 그 줄의 해시로 식별한다. `.result` 경로마다 events.jsonl 의 `team.result`·
  `team.blocked` 에서 마지막으로 처리한 해시(경로별 마지막 처리 해시)를 유도하고, 현재 줄의 해시와 비교해
  해시가 다를 때만 처리한다. 이유: 보존된 `blocked` 워크트리의 같은 질문이 재구성마다 다시 통지되거나 같은
  결과가 두 번 처리되지 않게 하고, 답을 받은 pane 팀원이 새 질문으로 다시 `blocked` 가 되면 그것은 놓치지
  않게 한다. 집계는 order 로 중복을 없앤다. 줄과 해시는 한 번의 Bash 호출로 함께 읽는다.
  ```bash
  l=$(head -n 1 '<경로>'); printf '%s\n' "$l"; printf '%s\n' "$l" | cksum | cut -d' ' -f1
  ```
- **고아 스캔**: 값이 `<신원>/<host>/` 로 시작하는 `.dflow-agent` 워크트리(`parked` 포함) 중 살아 있는 팀원이
  없는 것은 backends.md 「고아 정리 규칙」 대로 깨끗하고(미커밋 변경 없음) HEAD 가 `origin/<그 브랜치>` 와 같은
  것만 정리한다. 나머지는 경로와 미커밋 목록을 "재개 필요" 보고에 붙이고 자동으로 지우지 않는다.
- **부트스트랩 실패 정리**: `.result` 의 branch 가 `-`(브랜치를 만들기 전에 끝남)이면 backends.md
  「고아 정리 규칙」 1번대로, 알려진 부산물만 있을 때만 `--force` 로 정리하고 그 밖의 변경이 있으면 보존하고
  보고한다. 이유: 브랜치가 없어도 워커가 무언가를 고쳤다면 그것은 사람이 판단할 산출물이다.
- state.json 미러 같은 새 저장소는 만들지 않는다. 정본(서버·원격 agent 브랜치·워크트리)과 따로 도는 저장소는
  동기화 규칙을 계속 맞춰야 하기 때문이다.

## 0. 환경 감지 (시작 맨 처음)

```bash
printf 'TERM_PROGRAM=%s ORCA_WORKTREE_ID=%s TMUX=%s\n' "${TERM_PROGRAM-}" "${ORCA_WORKTREE_ID-}" "${TMUX-}"
```
1. `TERM_PROGRAM` 이 `Orca` 이거나 `ORCA_WORKTREE_ID` 가 비어 있지 않으면 **pane 백엔드(Orca)** 다.
2. 그 밖(진짜 tmux·일반 터미널)은 **에이전트 팀 백엔드** 다. `TMUX` 가 있으면
   "v1 은 tmux pane 을 지원하지 않아 에이전트 팀으로 돈다" 를 한 줄 알린다. 에이전트 팀이면
   "blocked 질문은 이 세션으로 모이고 팀원 화면은 보이지 않는다" 도 한 줄 알린다.

어느 갈래에서도 병렬 불가로 종료하지 않는다. 백엔드 이름은 시작 보고와 `team.start` 에 남긴다.

## 1. 시작

1. **전제 검사**: 아래 블록 하나를 한 번의 Bash 호출로 돌린다. 블록은 실패한 항목을 모두 `FAIL …` 로 출력한 뒤
   0 이 아닌 값으로 끝나고, **exit 가 0 이 아니면 아무것도 띄우지 않고 중단·보고한다.** 이유: 실패를 출력만 하는
   검사는 읽고 넘어가면 그대로 진행된다. `<HHMM>` 은 종료 시각을 네 자리로 쓴 값이다.
   ```bash
   fail=0; bad() { echo "FAIL $*"; fail=1; }
   MAIN=$(git rev-parse --show-toplevel); [ "$MAIN" = "$(pwd -P)" ] || bad NOT_REPO_ROOT
   case "$MAIN" in *' '*) bad SPACE_IN_PATH ;; esac
   base=$(git symbolic-ref --short refs/remotes/origin/HEAD 2>/dev/null); base=${base#origin/}
   [ -n "$base" ] || base=$(git ls-remote --symref origin HEAD 2>/dev/null | sed -n 's|^ref: refs/heads/\([^[:space:]]*\)[[:space:]]*HEAD$|\1|p')
   [ -n "$base" ] || bad NO_DEFAULT_BRANCH
   [ -n "$base" ] && [ "$(git branch --show-current)" != "$base" ] && bad "NOT_DEFAULT_BRANCH $base"
   for s in dflow-dev dflow-work dflow-poll dflow-merge dflow-team; do [ -e ".claude/skills/$s/SKILL.md" ] || bad "NO_SKILL $s"; done
   grep -q -- '--worker' .claude/skills/dflow-dev/SKILL.md || bad OLD_DFLOW_DEV
   grep -q 'origin/agent/\*' .claude/skills/dflow-merge/SKILL.md || bad OLD_DFLOW_MERGE
   test -f .env || bad NO_ENV
   (set -a; . ./.env; set +a; .claude/skills/dflow-work/scripts/dflow.sh doctor)   # 진단 출력용. 종료 코드로 판정하지 않는다
   email=$(set -a; . ./.env; set +a; .claude/skills/dflow-work/scripts/dflow.sh me | jq -r '.user_email // empty')
   [ -n "$email" ] || bad AUTH
   who=$(printf '%s' "$email" | cut -d@ -f1 | tr 'A-Z' 'a-z' | sed 's/[^a-z0-9-]/-/g')
   host=$(hostname -s | tr 'A-Z' 'a-z' | sed 's/[^a-z0-9-]/-/g')
   echo "user_email=$email lead=$who/$host/lead"
   legacy=$(find docs/tasks -mindepth 2 -maxdepth 2 -name state.json 2>/dev/null | while IFS= read -r f; do
     jq -e '.phase == "reported" and ((.api_base // "") == "")' "$f" >/dev/null 2>&1 && printf '%s ' "$f"
   done)
   [ -z "$legacy" ] || bad "LEGACY_REPORTED $legacy"
   mkdir -p ~/.dflow
   ex=$(git rev-parse --git-path info/exclude); mkdir -p "$(dirname "$ex")"; touch "$ex"
   for p in '**/.claude/worktrees/' '/.dflow-agent' 'docs/tasks/*/.result'; do
     grep -qxF "$p" "$ex" || printf '%s\n' "$p" >> "$ex"
   done
   tracked=$(git ls-files .claude/skills | head -n 1)   # 비어 있지 않으면 킷 복사형(스킬이 git 추적됨)
   [ -n "$tracked" ] || { grep -qxF '/.claude/skills' "$ex" || printf '%s\n' '/.claude/skills' >> "$ex"; }
   if [ -n "$tracked" ] && [ -n "$base" ]; then
     if git fetch -q origin; then
       git show "origin/$base:.claude/skills/dflow-dev/SKILL.md" 2>/dev/null | grep -q -- '--worker' || bad "KIT_NOT_PUSHED dflow-dev"
       git show "origin/$base:.claude/skills/dflow-merge/SKILL.md" 2>/dev/null | grep -q 'origin/agent/\*' || bad "KIT_NOT_PUSHED dflow-merge"
     else
       bad "KIT_NOT_PUSHED fetch 실패"
     fi
   fi
   [ -z "$(git status --porcelain)" ] || bad DIRTY
   [ "$(date +%H%M)" -lt <HHMM> ] || bad "UNTIL_PAST 종료 시각은 당일 시각만(자정 넘김 불가)"
   if [ "${TERM_PROGRAM-}" = Orca ] || [ -n "${ORCA_WORKTREE_ID-}" ]; then
     { orca worktree create --help | grep -q -- '--agent' && orca worktree create --help | grep -q -- '--prompt'; } || bad ORCA_OLD
   fi
   [ "$fail" = 0 ] || exit 1
   # 팀장 잠금: 나머지 검사가 모두 통과한 뒤 마지막에 원자 획득한다
   LOCK=$(git rev-parse --git-path dflow-team.lock)
   stale() {   # $1: 잠금 디렉터리. beat 있으면 70분, 없으면 디렉터리 수정 시각 10분으로 죽음을 본다
     b=$(cat "$1/beat" 2>/dev/null || true)
     if [ -n "$b" ]; then [ $(( $(date +%s) - b )) -ge 4200 ]
     else [ -n "$(find "$1" -maxdepth 0 -mmin +10 2>/dev/null)" ]; fi
   }
   if ! mkdir "$LOCK" 2>/dev/null; then
     stale "$LOCK" || { echo "LOCKED $LOCK owner=$(cat "$LOCK/owner" 2>/dev/null) beat=$(cat "$LOCK/beat" 2>/dev/null || echo 없음)"; exit 1; }
     T="$LOCK.stale.$$"
     mv "$LOCK" "$T" 2>/dev/null || { echo "LOCKED $LOCK"; exit 1; }
     stale "$T" || { echo "LOCKED $LOCK 옮긴 잠금이 새롭다. 다른 팀장이 방금 가져간 것이므로 $T 를 $LOCK 로 되돌려라"; exit 1; }
     rm -rf "$T"
     mkdir "$LOCK" 2>/dev/null || { echo "LOCKED $LOCK"; exit 1; }
     echo "STALE_LOCK_TAKEN"
   fi
   # owner = <신원>/<host>/lead <시작 epoch> <팀장 세션 PID>. 방금 만든 잠금이라 쓰기에 실패하면 지우고 끝낸다
   { printf '%s %s %s\n' "$who/$host/lead" "$(date +%s)" "$PPID" > "$LOCK/owner" && date +%s > "$LOCK/beat"; } \
     || { rm -rf "$LOCK"; echo "FAIL LOCK_WRITE $LOCK"; exit 1; }
   echo "PRECHECK_OK lead_pid=$PPID"
   ```
   - **팀장 잠금**: 잠금은 디렉터리이며 `mkdir` 로 얻는다. `mkdir` 는 원자적이라 동시에 시작한 팀장 둘 중 하나만
     성공한다. 실패한 검사가 잠금을 남기지 않도록 블록의 마지막에 둔다. 안에 `owner` 한 줄
     `<신원>/<host>/lead <시작 epoch 초> <PID>` 와 `beat`(epoch 초)를 쓴다. PID 는 Bash 도구 셸의 `$PPID`, 곧 팀장
     세션 프로세스이며 Bash 호출마다, 컨텍스트 압축 뒤에도 같다. **소유 판정**은 "`owner` 의 신원이 자기
     `<신원>/<host>/lead` 이고 PID 가 현재 `$PPID` 와 같다" 이다. 이유: 잠금은 체크아웃마다 하나라서 잠금을 가져간
     다른 팀장도 신원·host·리포가 같고, 신원만으로는 누구의 잠금인지 가려내지 못한다. 시작 시각은 `LOCKED` 안내에서
     사람이 그 팀장을 알아보게 하려고 둔다. 팀장은 매 기상 소유를 확인한 뒤에만 `beat` 를 갱신한다(「2-3」).
     `owner`·`beat` 쓰기가 실패하면 방금 만든 잠금 디렉터리를 지우고 `FAIL LOCK_WRITE` 로 끝낸다. 이유: `beat`
     없는 잠금은 만들어진 지 10분 안에는 다른 팀장의 시작을 막는데(아래), 그대로 두면 그 10분 동안 아무도
     시작하지 못한다. 방금 `mkdir` 로 만든 잠금은 다른 팀장이 건드리지 않으므로 지워도 남의 잠금이 아니다.
     기존 잠금의 `beat` 가 있고 70분(4200초)보다 새로우면 거부한다. `beat` 가 없으면 잠금 디렉터리 자체의
     수정 시각을 본다(`find "$LOCK" -maxdepth 0 -mmin +10` 가 경로를 출력하면 10분보다 오래된 것이다;
     macOS·Linux 모두에서 도는 방법이다). 10분 이내면 `mkdir` 와 `owner`·`beat` 쓰기 사이의 그 짧은 틈에 있는,
     방금 만들어지는 중인 잠금으로 보고 지금처럼 거부한다. `beat` 가 있고 70분보다 오래됐거나, `beat` 가
     없고 잠금 디렉터리가 10분보다 오래됐으면 죽은 것으로 보고 가져온다. 가져올 때는 잠금 디렉터리를 `mv`
     로 이 팀장만 아는 이름 `$LOCK.stale.$$` 로 옮기고, 옮긴 디렉터리를 같은 기준(옮기기 전 본 것이 `beat`
     였으면 `beat` 를, 잠금 디렉터리 수정 시각이었으면 옮긴 디렉터리의 수정 시각을)으로 다시 재어 여전히
     오래됐을 때만 지운 뒤 `mkdir` 로 다시 얻는다. 옮긴 잠금이 새로우면 그사이 다른
     팀장이 가져간 것이므로 옮긴 경로를 알리며 거부하고 사람이 되돌리게 한다. `mv` 나 다시 하는 `mkdir` 가
     실패해도 다른 팀장이 먼저 가져간 것이므로 거부한다. 이유: 다시 잰 시각이 여전히 오래됐음을 확인한 뒤
     지우기 전에 다른 팀장이 먼저 가져가면 그 잠금까지 지우게 되는데, 옮긴 디렉터리는 이 팀장만 보므로 확인과
     삭제 사이에 끼어들 틈이 없다. `LOCKED` 로 거부할 때는 잠금 경로·
     `owner`·`beat` 시각과 함께 "그 팀장이 끝난 것이 확실하면 잠금 디렉터리를 지우고 다시 시작하라" 를 안내한다.
     세션이 죽은 직후 재기동하면 `beat` 가 아직 새롭기 때문이다. 이유: 한 체크아웃의 팀장 둘은 슬롯 번호·세대
     파일·승인 스윕을 서로 덮어쓴다. 생존(가져와도 되는지)은 PID 가 아니라 `beat`(없으면 잠금 디렉터리 수정
     시각)로 본다. 이유: 세션 프로세스가
     살아 있어도 권한 확인 등에 멈춘 팀장은 기상하지 않아 제 몫을 못 하는데, `beat` 는 그 멈춤까지 드러낸다.
     살아 있는 팀장은 늦어도 `TICK`(30분)마다 깨어 `beat` 를 갱신하므로, 70분이면 두 `TICK` 을 연속으로 놓친 것이다.
   - `KIT_NOT_PUSHED`: `.claude/skills` 가 git 추적되는 킷 복사형 리포면 `git fetch origin` 뒤
     `origin/<기본브랜치>` 의 `dflow-dev` SKILL.md 에 `--worker` 가, `dflow-merge` SKILL.md 에 원격 후보 지원
     (`origin/agent/*`)이 있어야 한다. fetch 가 실패하면 검사할 수 없으므로 실패로 친다. 이유: 팀원 워크트리는
     `origin/<기본브랜치>` 에서 만들어지거나 그리로 detach 해서 그 커밋의 스킬을 쓴다. 킷을 설치·커밋만 하고
     push 하지 않으면 작업트리 검사(`OLD_DFLOW_DEV`)는 통과하고 팀원은 전원 `failed no-worker-flag` 로 끝난다.
     안내에 "킷 커밋을 기본 브랜치에 push 한 뒤 다시 시작하라" 를 넣는다. 심링크 배포 리포는 워커가 메인
     체크아웃의 스킬을 링크하므로 이 검사를 하지 않는다.
   - `SPACE_IN_PATH`: 메인 체크아웃 절대경로에 공백이 있으면 시작을 거부한다. 이유: 포인터 한 줄 형식과
     워커 부트스트랩의 `ln -s` 링크가 공백을 다루지 않는다.
   - `NO_DEFAULT_BRANCH`·`NOT_DEFAULT_BRANCH`: 기본 브랜치는 `origin/HEAD` 에서 구하고, 그 ref 가 없으면
     `git ls-remote --symref origin HEAD` 에서 구한다(`origin/HEAD` 는 clone 할 때만 생긴다). 팀장 체크아웃의
     현재 브랜치가 그 기본 브랜치여야 한다. 이유: 승인 스윕이 기본 브랜치로 switch 하므로, 다른 브랜치에서
     시작하면 병렬 세션이 쓰는 체크아웃과 심링크가 가리키는 스킬 버전을 흔든다.
   - `OLD_DFLOW_DEV`·`OLD_DFLOW_MERGE`: 수정된 기존 스킬이 적용되지 않았다. 옛 `/dflow-dev` 면 팀원이 기본
     브랜치 switch 에서 죽고, 옛 `/dflow-merge` 면 스윕이 팀원 작업을 영영 보지 못한다.
   - `AUTH`: 인증은 `dflow.sh me` 의 성공(`user_email` 이 나옴)으로 판정한다. doctor 는 진단 출력용이며 종료
     코드로 판정하지 않는다. 이유: doctor 는 토큰 인증이 실패해도 그 줄만 출력하고 0 으로 끝난다. 출력한
     `user_email` 로 `DFLOW_PATS` 첫 토큰이 이 신원의 PAT 인지 보여 주고, 그 값으로 `<신원>` 슬러그를,
     `hostname -s` 로 `<host>` 슬러그를 만든다. 팀원은 `<신원>/<host>/w<slot>`, 팀장은 `<신원>/<host>/lead` 다.
   - `LEGACY_REPORTED`: `api_base` 가 없는 `phase=reported` 로컬 state.json 이 있으면 시작을 거부하고
     "수동 `/dflow-merge` 로 먼저 정리하라" 고 안내한다. 이유: 스테이징 D'Flow DB 는 운영을 복제하므로 출처를 모르는
     로컬 후보를 자동 스윕이 머지할 수 있다. 같은 작업의 원격 사본에 값이 있으면 `/dflow-merge` 가 출처를
     가려내지만(1번 로컬·원격 중복), 사본이 없거나 사본에도 값이 없으면 그 후보를 수동 규칙대로 판정하므로, 사람이
     보지 않는 루프에 그 판정을 맡기지 않는다. 이 검사는 로컬 파일만 보므로 원격 사본에 값이 있는 경우도
     거부하며, 이는 안전한 쪽으로 기운 것이다.
   - `mkdir -p ~/.dflow`: 이벤트 기록이 디렉터리 부재로 조용히 실패하지 않게 한다.
   - 공유 `info/exclude` 에 워커 부산물 패턴을 없을 때만 넣는다. 커밋하지 않는 로컬 설정이며 링크드
     워크트리가 모두 공유한다. `**/.claude/worktrees/` 는 에이전트 팀 격리 워크트리, `/.dflow-agent`·
     `docs/tasks/*/.result` 는 워커가 쓰는 미추적 파일, `/.claude/skills`(끝 슬래시 없음)는 워커가 만드는 스킬
     심링크다. 끝 슬래시가 붙은 패턴은 디렉터리에만 걸려 심링크를 가리지 못한다. 이 패턴은 **`.claude/skills`
     가 추적되지 않는 리포에서만** 넣는다. 스킬이 커밋된 리포에 넣으면 새로 추가하는 스킬 파일이 무시돼
     `git add` 가 거부되기 때문이다. 이유: 부산물이 `/dflow-dev` Phase 5 의 "미커밋 잔여물 커밋" 에 섞이면,
     브랜치마다 다른 `.dflow-agent` 가 스윕 머지를 충돌시키고 절대경로 심링크가 main 에 들어간다.
   - `DIRTY`: exclude 를 넣은 뒤 `git status --porcelain` 이 비어 있어야 한다. 팀장 체크아웃이 더러우면 승인
     스윕이 위험하다. 실패 안내에 "미커밋 `docs/tasks/*/state.json` 은 파일명을 명시해 먼저 커밋하라(수동
     `/dflow-dev` 가 남긴 것일 수 있다)" 를 넣는다.
   - `UNTIL_PAST`: 종료 시각이 오늘 안의 미래여야 한다. 당일 시각만 받고 자정 넘김은 받지 않으므로(poll.sh 가
     지원하지 않는다) 거부 안내에 그 사실을 적는다. 늦은 밤에 새벽 시각을 준 사람이 이유를 알게 하기 위해서다.
   - `LEGACY_REPORTED` 검사와 이 블록 전체는 bash 와 zsh 모두에서 돈다. state.json 은 glob 대신 `find` 로 찾고,
     결과를 변수로 받아 루프 밖에서 `bad` 를 부른다. 이유: zsh 는 매치 없는 glob 에서 블록 전체를 `FAIL` 줄 없이
     죽이고, bash 는 파이프 안의 `while` 을 서브셸에서 돌려 그 안에서 바꾼 `fail` 이 밖으로 나오지 않는다.
   - `ORCA_OLD`: pane(Orca)이면 `orca worktree create` 가 `--agent`·`--prompt` 를 지원해야 한다.
2. **재구성**: 새 `team.start` 를 쓰기 **전에** 「팀장 상태」 의 재구성과 고아 스캔을 한다. 이유: "마지막
   `team.start` 이후" 필터가 이전 세션의 이벤트를 가리지 않게 한다. 이 단계가 곧 재기동 절차다. 이어서
   서버에 claimed 인데 흡수한 슬롯·고아 워크트리·답을 기다리는 `blocked`·대기 중인 답 어디에도 없는 id8 을
   "재개 필요: 수동 `/dflow-dev <id8>`" 로 보고하고 영구 제외에 넣는다(자동 재착수 없음, 수동 세션이 진행 중인
   작업일 수도 있다). 답을 기다리거나 답을 받은 에이전트 팀 `blocked` 를 빼는 이유: 그 작업은 슬롯을 해제해
   흡수되지 않지만 claimed 로 남아 있고, 4번이 이어받아 답 매칭과 재spawn 을 계속한다.
   ```bash
   (set -a; . ./.env; set +a; .claude/skills/dflow-work/scripts/dflow.sh list --scope claimed) | awk -F'\t' 'NF>=4 {print $4}'
   ```
3. **권한 모드 안내 한 줄**: 에이전트 팀이면
   "팀원은 이 세션의 권한 모드를 물려받으며, 권한 확인이 뜨면 알림 없이 멈춘다" 를,
   pane 이면 "팀원은 권한 확인 생략 모드로 뜬다" 를 출력한다.
4. `team.start`(backend, slots, until)를 기록한다. 2번에서 이어받은 것은 `team.start` 바로 뒤에 같은 필드로
   다시 기록한다: 흡수한 슬롯마다 `team.spawn`, 답을 기다리는 에이전트 팀 `blocked` 마다 `team.blocked`, 아직
   재spawn 하지 못한 답마다 `team.answer`, 흡수한 슬롯의 마지막 처리 해시마다 `team.result` 또는 `team.blocked`.
   이유: 이후 기상의 재구성은 새 `team.start` 이후만 읽으므로, 다시 기록하지 않으면
   이어받은 팀원이 살아 있지 않은 것으로 보이고 같은 결과가 다시 처리된다. 답을 기다리던 질문도 대기 목록에서 사라져 사람이 준 `<id8> <답>`
   이 매칭되지 않고, "기다리는 질문이 하나면 id8 없이 답해도 된다" 가 깨진다.
   그 다음 **승인 스윕**(「4. 승인 스윕」)을 한 번 돌고 결과(머지됨·대기·반려·건너뜀)를 한 줄씩 보고한다.
5. **감시 시작**: 다음 TICK 예정 시각을 지금+1800초로 정하고 「2-2」 대로 감시 루프를 띄운다. 재기동 조건이
   맞으면 poll.sh 도 띄운다(「2-1」). 둘 다 Bash `run_in_background` 로 띄운다. 셸 `&` 는 쓰지 않는다. 종료
   알림이 세션에 오지 않아 루프가 소리 없이 끊기기 때문이다.

## 2. 기상과 감시

팀장은 포그라운드로 기다리지 않는다. 팀장을 깨우는 것은 넷이다: poll.sh 종료(새 작업·시한·오류), 감시 루프
종료(팀원 결과·`TICK`·`STALE`), 에이전트 팀 팀원 완료 알림, 사람이 이 세션에 주는 답.

### 2-1. poll

`docs/tasks/` 가 없는 빈 디렉터리를 cwd 로 두고 띄운다.
```bash
mkdir -p "$(git rev-parse --git-path dflow-team-poll)"
POLL_DIR=$(cd "$(git rev-parse --git-path dflow-team-poll)" && pwd)
( cd "$POLL_DIR" && DFLOW_ENV_FILE="<MAIN>/.env" \
    "<MAIN>/.claude/skills/dflow-poll/scripts/poll.sh" --require-tag agent --until <HH:MM> --interval 300 \
    [--exclude <id8,id8>] [--exclude-temp <id8,id8>] )
```
대괄호는 선택 플래그 표기이며 실제 명령에는 쓰지 않는다. `<MAIN>` 경로는 따옴표로 감싼다. 경로에 공백이 있으면
`DFLOW_ENV_FILE` 값이 끊기고 poll.sh 를 찾지 못해 poll 이 곧바로 죽기 때문이다.
- 빈 디렉터리를 cwd 로 두는 이유: 그러면 승인·반려 감지 재료가 없어 poll exit 9·10 이 팀장에게 절대 오지
  않는다. 9·10 감지는 `--exclude` 를 보지 않으므로, 팀장 체크아웃에 수동 마감한 state.json 이 있으면
  재기동마다 즉시 다시 울려 공회전한다. 팀장은 기상마다 승인 스윕을 하므로 9·10 이 필요 없다.
- `DFLOW_ENV_FILE` 을 주는 이유: poll.sh 는 `.env` 를 `$PWD/.env` 에서 찾는다. dflow.sh 경로는 poll.sh 가 자기
  위치로 풀므로 따로 주지 않는다. `git rev-parse --git-path` 는 상대경로를 돌려줄 수 있어 `cd … && pwd` 로
  절대경로를 만든다.
- `--exclude` 에는 **영구 제외 ∪ 현재 슬롯의 id8** 을 넣는다. 슬롯의 id8 은 재구성으로 복원된다. 이유: 팀원이
  claim 하기 전까지 그 작업은 ready 라서, 넣지 않으면 poll 이 즉시 다시 찾아 짧은 간격으로 서버를 친다.
  `--exclude-temp` 에는 일시 제외 목록을 넣는다.
- 목록은 공백 없는 쉼표 구분이다. **목록이 비면 그 플래그 자체를 생략한다.** 빈 값을 넘기면 poll.sh 가 다음
  플래그를 값으로 삼켜 사용법 오류로 끝난다.
- 대기 큐는 `--exclude` 에 넣지 않는다. 메모리에만 있는 값이 떠 있는 poll 프로세스 안에 숨으면, 컨텍스트
  압축으로 대기 큐를 잃었을 때 그 작업들이 보이지 않는 제외에 갇히기 때문이다.

**재기동 조건**: 빈 슬롯이 있고, 대기 큐가 비었고, 차단기가 풀려 있을 때만 띄운다. poll 은 기동 즉시 첫
조회를 하므로, 슬롯이 찬 채로 띄우면 곧바로 다시 끝나 공회전하고, 대기 큐가 남아 있거나 차단기가 걸려 있으면
찾아도 줄 수가 없다. 예외는 하나다: 차단기가 걸린 `TICK` 에 대기 큐가 비어 시험 spawn 할 후보가 없으면 poll 을
한 번 띄우고, 그 poll exit 0 에서는 1건만 시험 spawn 하고 나머지는 대기 큐에 넣는다. poll 이 떠 있지 않은
구간이 있으므로, 팀장은 기상마다 스스로 시각을 보고 종료 시각이 지났으면 poll exit 8 과 같이 처리한다.

일시 제외는 poll.sh 가 6주기 뒤 스스로 풀어 재발견을 유도하므로, 팀장은 해제 시각을 따로 관리하지 않는다.
풀린 id8 이 다시 발견되면 착수 판정을 다시 하고, 여전히 막히면 다시 일시 제외에 넣는다. 그래서 poll exit 0 의
재대조는 일시 제외 목록을 보지 않는다(「2-3」 표). 팀장이 자기 일시 제외 목록으로 다시 버리면, 같은 목록을 다시
`--exclude-temp` 로 넘겨 그 작업이 그 세션에서 끝내 뜨지 않기 때문이다. poll 을 다른 이유로
재기동하면 6주기 계산이 처음부터 다시 시작된다(poll.sh 프로세스 안에서 세기 때문이다). 재검사가 늦어질 뿐
틀린 착수는 생기지 않는다.

### 2-2. 감시 루프

루프 교체는 TaskStop 이 아니라 세대 파일 `$(git rev-parse --git-path dflow-team.gen)` 로 한다. 파일은 한 줄
`<세대> <다음 TICK epoch 초>` 이다. 이유: 컨텍스트 압축으로 태스크 id 를 잃어도 루프가 겹쳐 같은 결과를 두 번
처리하지 않는다.

루프를 새로 띄울 때마다 팀장은 먼저 세대를 올린다.
```bash
GEN_FILE=$(git rev-parse --git-path dflow-team.gen); case "$GEN_FILE" in /*) ;; *) GEN_FILE="$PWD/$GEN_FILE" ;; esac
old=$(cut -d' ' -f1 "$GEN_FILE" 2>/dev/null); gen=$(( ${old:-0} + 1 ))
printf '%s %s\n' "$gen" '<다음 TICK epoch 초>' > "$GEN_FILE"; echo "GEN_FILE=$GEN_FILE gen=$gen"
```
다음 TICK 예정 시각은 시작과 `TICK` 기상 때만 지금+1800초로 새로 정하고, 그 밖의 교체에서는 세대 파일 둘째
칸 값을 그대로 쓴다. 이유: 루프를 자주 바꿔도 TICK 이 밀리지 않게 하고, 컨텍스트 압축 뒤에도 그 값을 되찾는다.

그리고 아래 루프를 `run_in_background` 로 띄운다. `set --` 에는 pane 의 진행 중 슬롯(`blocked` 포함)마다
`'<워크트리>/docs/tasks/<TSK>/.result|<그 경로의 마지막 처리 해시 또는 ->'` 를 작은따옴표로 넣는다. 에이전트
팀이거나 진행 중 pane 슬롯이 없으면 `set --` 를 비운다(에이전트 팀은 완료 알림이 따로 온다). 경로에 공백이나
작은따옴표가 든 워크트리는 지원하지 않는다.
```bash
GEN_FILE='<세대 파일 절대경로>'; MY_GEN=<세대>; TICK_AT=<다음 TICK epoch 초>
set -- '<워크트리1>/docs/tasks/<TSK1>/.result|<해시1>' '<워크트리2>/docs/tasks/<TSK2>/.result|-'
while :; do
  [ "$(cut -d' ' -f1 "$GEN_FILE" 2>/dev/null)" = "$MY_GEN" ] || { echo STALE; exit 0; }
  hit=''
  for s in "$@"; do
    f=${s%%|*}; prev=${s#*|}
    [ -f "$f" ] || continue
    cur=$(head -n 1 "$f"); sum=$(printf '%s\n' "$cur" | cksum | cut -d' ' -f1)
    [ "$sum" = "$prev" ] || hit="$hit $f"
  done
  [ -n "$hit" ] && { echo "RESULT_READY$hit"; exit 0; }
  [ "$(date +%s)" -ge "$TICK_AT" ] && { echo TICK; exit 0; }
  sleep 20
done
```
- **줄 전체를 비교한다.** status 만 비교하면 답을 받은 팀원이 다시 `blocked` 가 됐을 때 status 가 같아 깨어나지
  않는다. 줄에 따옴표가 든 질문이 올 수 있어 줄 대신 그 해시를 넘긴다.
- 루프는 기동 즉시 넘겨받은 전체 경로를 한 번 전수 검사한 뒤 20초 간격으로 감시한다. 루프를 바꾸는 사이에
  도착한 `.result` 를 놓치지 않기 위해서다.
- 두 백엔드 모두 `TICK_AT` 이 지나면 `TICK` 을 출력하고 끝난다. 한가한 구간에도 30분마다 승인 스윕과 suspect·
  무응답 점검을 하기 위해서다.
- 교체 시점: pane 은 진행 중 슬롯의 경로 집합이나 처리 해시가 바뀔 때와 루프가 끝나 있을 때, 에이전트 팀은
  루프가 끝나 있을 때 새로 띄운다. 컨텍스트 압축 뒤 루프가 떠 있는지 모르면 새로 띄운다. 옛 루프는 `STALE` 로
  끝난다.

### 2-3. 기상마다 하는 일

모든 기상은 먼저 잠금 소유를 확인하고, 소유가 맞을 때만 `beat` 를 갱신한다. `STALE` 은 그것만 하고 넘긴다.
이유: 살아 있는 팀장의 잠금이 70분 뒤 죽은 것으로 보이지 않게 하되, 잠금을 잃은 팀장이 새 팀장의 잠금을 계속
살아 있게 만들지 않는다(「1. 시작」 팀장 잠금).
```bash
LOCK=$(git rev-parse --git-path dflow-team.lock); o_who=; o_ts=; o_pid=
{ read -r o_who o_ts o_pid < "$LOCK/owner"; } 2>/dev/null || true
if [ "$o_who" = '<신원>/<host>/lead' ] && [ "$o_pid" = "$PPID" ]; then
  date +%s > "$LOCK/beat" && echo LOCK_OK || echo "LOCK_LOST beat 쓰기 실패"
else
  echo "LOCK_LOST owner=$o_who $o_ts $o_pid 내 PID=$PPID"
fi
```
`LOCK_LOST` 면 **잠금 상실**이다. "잠금 상실" 로 보고하고 새 spawn 을 멈추며, 잠금을 지우지 않은 채 「7. 마감」 의
잠금 상실 마감으로 간다. 이유: 이 팀장이 `beat` 를 70분 넘게 놓친 사이 다른 팀장이 잠금을 가져갔다면 두 팀장이
같은 체크아웃에서 스윕·spawn 을 하고 같은 슬롯 번호를 낸다. `beat` 를 쓰지 못한 경우도 곧 다른 팀장이 가져갈 수
있어 소유를 장담할 수 없다.

`STALE` 을 뺀 모든 기상에서는 `LOCK_OK` 뒤에 이어서 이 순서로 한다.
1. 재구성(「팀장 상태」).
2. 아래 표의 처리.
3. 승인 스윕(「4. 승인 스윕」). 스윕을 도는 기상은 시작, 결과 도착(`.result` 또는 완료 알림), `TICK`, poll
   재기동 직전, 마감이다. 이유: 팀장의 poll 에는 exit 9·10 이 오지 않는다. 대가로 승인 반영은 사람이 승인한 뒤
   다음 기상까지 늦어지며, `TICK` 이 있어 최대 30분이다. 이 지연 동안 승인됐으나 main 미반영인 선행은 워커가
   그 `head_sha` 를 스택 기점으로 받고(`/dflow-dev` 「--worker」 B), 승인 대기인 선행의 후속은 `skipped` 로 일시
   제외됐다가 승인·머지 뒤 재검사에서 풀린다(「--worker」 G).
4. 빈 슬롯이 있고 차단기가 허락하면 대기 큐 맨 앞부터 spawn 한다(「5. 팀원 spawn」).
5. 끝나 있는 감시 루프를 다시 띄우고, 재기동 조건(「2-1」)을 만족하면 poll.sh 를 다시 띄운다. 컨텍스트 압축 뒤
   poll 이 떠 있는지 모르면 재기동 조건에 따라 새로 띄운다. poll 이 겹쳐 떠도 poll exit 0 처리의 대조와 spawn 전
   확인(「5. 팀원 spawn」 1번)이 같은 작업을 두 번 띄우지 않게 막는다.

| 기상 | 처리 |
|---|---|
| poll exit 0 (ready N줄) | 각 줄 `순번<TAB>id8<TAB>이름` 에서 순번은 버리고 id8 만 쓴다. 먼저 후보를 영구 제외 목록과 슬롯 표에만 한 번 더 대조해 걸리는 것을 버린다. 이유: 겹쳐 뜬 옛 poll 은 옛 제외 목록으로 돌고 있을 수 있다. 일시 제외는 대조하지 않는다. poll.sh 가 6주기 뒤 풀어 돌려준 것을 그대로 다시 판정해야 하기 때문이며(「2-1」), 대가로 겹쳐 뜬 옛 poll 이 막 일시 제외한 작업을 돌려주면 한 번 더 띄워 `skipped` 로 끝난다. 남은 후보마다 아래 show 필터로 `.order.item.spec` 이 비었는지만 본다(spec 본문을 컨텍스트에 싣지 않는다). 비었거나 `ref` 가 비면 일시 제외에 넣고 사유(spec 부재·TSK 없음)를 보고하며 `team.result`(slot `-`, status `skipped`)를 남긴다. 남은 것을 빈 슬롯 수만큼 spawn 하고 나머지는 대기 큐 끝에 넣는다. 차단기가 걸려 있으면 spawn 하지 않고 대기 큐에 넣는다(시험 spawn 예외는 「2-1」 재기동 조건). 대기 큐를 잃어도 그 작업들은 아직 ready 이므로 다음 poll 이 다시 찾는다 |
| poll exit 8 (시한) | 새 배정을 멈춘다. 대기 큐를 비우고(보고만 한다) 「7. 마감」 으로 간다 |
| poll exit 2·3·5·6·7 | 중단 사유(stderr)를 보고하고 「7. 마감」 으로 간다 |
| `RESULT_READY <경로…>` (pane) | 경로마다 「3. 결과 처리」 |
| 에이전트 팀 완료 알림 | 「3. 결과 처리」 |
| 사람의 답 | 「6. blocked」 의 답 매칭 |
| `TICK` | 다음 TICK 예정 시각을 지금+1800초로 새로 정한다. suspect 슬롯과 무응답 슬롯의 생존 증거를 잰다(「3. 결과 처리」). 차단기가 걸려 있으면 시험 spawn 1건을 허용한다 |
| `STALE` | 잠금 소유 확인과 `beat` 갱신만 하고 나머지는 넘긴다 |

poll exit 0 의 show 필터:
```bash
(set -a; . ./.env; set +a; .claude/skills/dflow-work/scripts/dflow.sh show <id8>) \
  | jq -c '{order: .order.id, ref: .order.item.external_ref, spec_empty: ((.order.item.spec // "") | length == 0)}'
```

## 3. 결과 처리

**결과 줄 찾기**
- pane: 감시 루프가 알린 경로의 `.result` 한 줄이다.
- 에이전트 팀: 완료 알림의 이름 `w<slot>-<id8>` 에서 **id8 로** 슬롯 표를 찾는다. 슬롯 번호로 찾지 않는 이유는
  이미 판정한 옛 팀원의 늦은 알림이 같은 슬롯의 새 작업을 오판하게 만들기 때문이다. 표에 없는 id8(이미 판정한
  것)의 알림은 집계만 갱신하고 슬롯을 건드리지 않는다. 표에 있으면 그 워크트리의 `docs/tasks/<TSK>/.result` 를
  읽고, 워크트리가 이미 정리돼 파일이 없으면 알림에 담긴 마지막 응답에서 `<TSK> <id8> ` 로 시작하는 줄을 찾는다.
- 에이전트 팀에서 두 곳 모두 결과 줄이 없으면 `failed` 가 아니라 **`suspect`** 로 표시하고 슬롯을 유지한다.
  팀원이 손자 서브에이전트를 기다리며 턴을 끝낸 것일 수 있기 때문이다. 그 뒤 매 `TICK` 에 생존 증거를 재고,
  **두 TICK 연속으로 변하지 않을 때만** `failed no-result` 로 판정한다.
  판정할 때는 먼저 `TaskStop(w<slot>-<id8>)` 으로 팀원을 멈춘 뒤 슬롯을 해제한다. 이유: 멈추지 않으면 살아 있던
  팀원과 그 슬롯에 새로 뜬 팀원이 같은 `AGENT_ID` 로 돈다. 그 사이에 `.result` 가 생기거나 알림이 다시 오면 정상 처리한다.
- 줄 형식은 `<TSK> <id8> <branch|-> <head|-> <done_exit|-> <status> <사유…>` 다. 줄과 해시는 「팀장 상태」 의 한
  줄 명령으로 함께 읽고, 해시가 그 경로의 마지막 처리 해시와 같으면 처리하지 않는다.

**생존 증거**: 아래 중 하나라도 직전 `TICK` 과 달라지면 살아 있는 것이다. 슬롯의 첫 `TICK` 은 기록만 한다.
```bash
git -C <워크트리> log -1 --format=%ct                                        # 1. 워크트리가 있으면 HEAD 커밋 시각
git fetch origin && git log -1 --format=%ct 'origin/agent/<id8>-<slug>'   # 1. 워크트리가 없으면 원격 tip 커밋 시각
(set -a; . ./.env; set +a; .claude/skills/dflow-work/scripts/dflow.sh show <id8>) | jq -r '[.reports[]?] | last | .created_at // empty'   # 2. 서버 최신 progress
git -C <워크트리> status --porcelain | cksum                                 # 3. 미커밋 변경 목록
```
**화면은 생존 증거로 쓰지 않는다.** Orca 화면(`orca terminal read`)은 보고용으로만 읽는다. 스피너 때문에 화면이
매번 달라져 멈춘 팀원도 살아 있는 것처럼 보이기 때문이다. 터미널 핸들이 없는 옛 런타임에서는 화면을 읽지 않고
위 셋만 쓴다.

**status 별 처리**: 결과 줄은 경로별 마지막 처리 해시와 다를 때만 처리하며, `blocked` 는 `team.blocked`,
나머지는 `team.result` 로 해시·사유와 함께 기록한다(events.md). 모든 결과는 집계에 넣는다. 결과를 처리할 때는
그 id8 을 먼저 진행 중 영구 제외에서 빼고, 아래 표의 제외 칸대로 일시·영구 제외를 새로 정한다. 이유: 「5. 팀원
spawn」 6번이 넣은 진행 중 제외가 남으면 `skipped`(일시 제외)와 `failed rate-limit`(제외 없음)의 재시도가 영영
막힌다.

| status | 슬롯 | 제외 | 워크트리 | 그 밖 |
|---|---|---|---|---|
| `done` | 해제 | 없음 | HEAD 가 `origin/<agent 브랜치>` 와 같으면 그 자리에서 정리한다. 다르면 경로를 보고하고 남긴다 | 대기 큐가 있으면 그 슬롯에 spawn 한다. 비어 있으면 poll 재기동 조건(「2-1」)을 따른다 |
| `needs-merge` | 해제 | 없음 | `done` 과 같다 | 승인 스윕을 곧바로 한다 |
| `skipped`(선행 미충족·선행 미승인·선행 승인 대기·claim exit 4·공통 기점 없음·spec 부재) | 해제 | 일시 제외 | branch 가 `-` 면 부트스트랩 실패 정리 규칙, 아니면 `done` 과 같다 | 사유 보고 |
| `blocked` | pane 은 유지, 에이전트 팀은 해제 | 진행 중으로 영구 제외에 남긴다 | pane 은 그대로 둔다. 에이전트 팀은 HEAD 가 `origin/<agent 브랜치>` 와 같으면 그 자리에서 정리하고, 정리할 수 없으면 `.dflow-agent` 값을 `<신원>/<host>/parked` 로 바꿔 슬롯 스캔에서 빼고 고아 규칙으로 보고한다 | 통지(「6. blocked」) |
| `failed <사유>` | 해제 | 영구 제외 | 고아 정리 규칙을 따른다 | 사유 보고, 차단기 계산 |
| `failed rate-limit` | 해제 | 제외하지 않는다 | 고아 정리 규칙을 따른다 | 재시도할 수 있다. 아직 ready 면 poll 이 다시 찾고, 이미 claimed 면 "재개 필요" 로 보고한다. 차단기 계산에 넣는다 |
| `failed no-result`(suspect 판정) | 먼저 `TaskStop` 한 뒤 해제 | 영구 제외 | 고아 정리 규칙을 따른다 | 차단기 계산 |
| `failed not-isolated` | 해제 | 영구 제외 | 없음(워커가 파일을 쓰지 않았다) | 백엔드 결함이므로 새 spawn 을 멈추고 「7. 마감」 으로 간다 |
| `failed deps` | 해제 | 영구 제외 | 고아 정리 규칙을 따른다 | 사유 보고, 차단기 계산. 설치는 claim 과 브랜치 생성 뒤라서(`/dflow-dev` 「--worker」 H) 서버에 claimed 로 남으므로 "재개 필요" 로 보고한다. 대상 리포의 lockfile·패키지 관리자 문제라 사람이 고친다 |

- **그 자리에서 정리하는 이유**: git 은 다른 워크트리가 체크아웃한 브랜치를 지우지 못한다. 워크트리를 마감까지
  남기면 같은 세션에서 승인된 작업의 로컬 agent 브랜치 삭제가 실패한다. 정리 명령은 backends.md 의 백엔드별
  「정리」 와 「고아 정리 규칙」 이며, 워크트리를 지웠으면 그 규칙 5번의 생성 브랜치 정리까지 한다.
- **에이전트 팀 `blocked` 워크트리를 남기지 않는 이유**: 팀원이 커밋·push 하고 끝나므로 보통 바로 정리할 수
  있다. 보존된 워크트리의 `.dflow-agent` 가 `w<slot>` 값을 그대로 가지면, 그 슬롯에 새로 뜬 팀원과 같은 슬롯
  표시를 가져 재구성이 충돌한다. `parked` 로 바꾸면 슬롯 스캔에서 빠진다.
- **회수**: 에이전트 팀에서는 결과 줄을 처리한 직후(status 와 무관하며 `blocked` 도 포함한다)
  `TaskStop(w<slot>-<id8>)` 으로 idle 팀원을 회수한다. 이름 붙은 에이전트는 일을 마쳐도 idle 로 남기 때문이다.
  pane 팀원은 별도 프로세스라서 TaskStop 대상이 아니다.
- **차단기**: 결과가 도착한 순서로 `failed`(`no-result`·`rate-limit` 포함)가 연속 2건이면 새 spawn 을 멈추고
  보고한다. `failed` 가 아닌 결과가 오면 연속 수를 0 으로 되돌린다. 걸린 동안에는 다음 `TICK` 마다 1건만 시험
  spawn 하고(대기 큐 맨 앞에서, 큐가 비었으면 poll 을 한 번 띄워 얻는다), 그 결과가 `failed` 가 아니면 차단기를
  푼다. 이유: 사용량 한도나 환경 결함에 걸린 채 대기 큐 전체를 소진하지 않게 한다.
- **무응답**: 결과도 알림도 없는 진행 슬롯의 생존 증거가 한 `TICK` 동안 변하지 않으면 "무응답" 으로 보고만 하고 슬롯을 유지한다.
  느린 팀원을 죽이면 미커밋분을 잃고, 권한 확인에 걸려 멈춘 팀원은 사람이 보면 풀리기 때문이다. 자동 정리는
  **두 TICK 연속으로** 생존 증거가 없을 때만 한다. 에이전트 팀은 먼저 `TaskStop` 으로 팀원을 멈추고 슬롯을
  해제하며, 워크트리는 고아 정리 규칙을 따른다. pane 은 팀원 프로세스를 멈출 수단이 워크트리 삭제뿐이므로,
  깨끗하고 push 된 경우에만 `orca worktree rm --worktree path:<경로>` 로 정리하고 슬롯을 해제한다. 그렇지
  않으면 슬롯을 계속 잡고 "사람 확인 필요" 로 보고한다. 자동 정리한 작업은 영구 제외에 넣고 "재개 필요" 로
  보고한다.

## 4. 승인 스윕

Skill 도구로 `/dflow-merge` 를 **인자 없이** 실행한다. 후보가 원격 `origin/agent/*` tip 에서도 오므로 팀장
체크아웃의 state.json 유무와 무관하다. 판정은 서버 `show` 로만 하고 approved 만 머지한다. 후보는 state.json 의
`api_base` 가 팀장의 `DFLOW_API_BASE` 와 같은 것만 받는다. `api_base` 가 없는 로컬 후보는 전제 검사가 시작 전에 막는다(「1. 시작」 `LEGACY_REPORTED`).
- **반려**: 반려로 보고된 id8 은 "반려: 수동 `/dflow-dev <id8>` 대상 (<review_note>)" 로 보고하고 영구 제외에
  넣는다. 재작업은 기존 agent 브랜치 위에서 해야 하므로 자동 배정하지 않는다.
- **다중 경합**: 두 팀장의 스윕이 같은 브랜치를 머지하려 하면 나중 쪽 `git push` 가 non-fast-forward 로
  거부된다. 그러면 `/dflow-merge` 가 머지 직전 HEAD 로 `git reset --keep` 해 되돌리고 "push 실패(경합)" 로 보고한
  뒤 스윕을 멈춘다. 다음 기상의 스윕이 fetch 부터 다시 하며, 그 사이에 머지된 것은 후보에서 빠진다.
- **push 훅 거부**: `/dflow-merge` 가 `git reset --keep` 으로 되돌리고 "push 실패(훅)" 로 보고한 뒤, 그 작업과 그
  후손만 빼고 다음 후보로 간다. 팀장은 그 id8 을 "사람이 머지해야 함" 으로 보고한다. 이유: 훅이 막는 작업(예:
  스테이징 리허설 트레일러가 없는 마이그레이션) 한 건이 후보 앞쪽에 있어도 뒤의 승인분은 계속 반영돼야 하며,
  스윕을 멈추면 사람이 그 한 건을 풀 때까지 매 기상이 같은 자리에서 멈춘다.
- **머지 충돌**: `/dflow-merge` 가 `git merge --abort` 로 되돌리고 "머지 실패(충돌)" 로 보고한 뒤 다음 후보로
  간다. 팀장은 그 id8 을 "사람이 머지해야 함" 으로 보고한다. 팀장 체크아웃은 깨끗하게 남아 다음 기상의 전제가
  깨지지 않는다.
- 로컬 agent 브랜치 삭제가 브랜치 없음이나 "checked out" 오류로 실패하면 `/dflow-merge` 가 건너뛰고 보고한다.
  그 워크트리는 결과 처리나 고아 스캔이 정리한다.
- 승인 대기·건너뜀(서버 <status>·조회 실패·다른 D'Flow·승인 뒤 변경·승인 뒤 변경 확인 불가)은 보고만 한다.
- `team.sweep`(merged, waiting, rejected 개수)을 기록한다.
- 스윕은 팀장 체크아웃에서 기본 브랜치로 switch 한다. 팀장 체크아웃은 전제 검사로 이미 기본 브랜치에 있고,
  팀원은 각자 워크트리의 agent 브랜치나 detached HEAD 에 있으므로 충돌하지 않는다.

## 5. 팀원 spawn

1. 그 id8 이 재구성한 슬롯 표에 있으면 띄우지 않는다. poll 이 겹쳐 떠서 같은 ready 를 두 번 돌려줘도 한 번만
   띄우기 위해서다.
2. 슬롯 번호를 정하고(「팀장 상태」 의 발급 규칙) `AGENT_ID = <신원>/<host>/w<slot>` 을 만든다.
3. TSK 는 show 필터의 `ref`(`.order.item.external_ref`)에서 마지막 `/` 뒤, order 는 `.order.id` 다.
4. 포인터 **한 줄**을 만든다. 백엔드에는 워커 프롬프트 전문이 아니라 이 포인터를 넘기고, 워커가
   `references/worker-prompt.md` 를 읽어 그 규칙대로 실행한다. 포인터는 치환 변수만 전달한다.
   ```
   <MAIN_CHECKOUT>/.claude/skills/dflow-team/references/worker-prompt.md 를 읽고 그 규칙대로 실행하라. TSK=<TSK> ID8=<id8> AGENT_ID=<신원>/<host>/w<slot> MAIN_CHECKOUT=<팀장 체크아웃 절대경로> BACKEND=<pane|agent-team> MODEL=<opus|sonnet|default>
   ```
   - 전문을 셸 인자로 넘기면 백틱·따옴표·여러 줄이 섞여 깨진다(Orca `--prompt` 자동 제출은 한 줄에서 확인됐다).
   - 워커 프롬프트 경로를 절대경로로 주는 이유: 새 워크트리에 스킬이 없을 수 있다.
   - 모델은 공백이 든 `--model opus` 를 넘기지 않고 `MODEL=` 로 넘기며, 워커가 `{MODEL_FLAG}` 로 바꾼다
     (`default` 면 빈 값).
   - 에이전트 팀 `blocked` 재개 때만 둘째 줄에 `ANSWER=<담당자 답 한 줄>` 을 붙인다(「6. blocked」). Agent 도구는
     셸 인자가 아니라서 여러 줄이 안전하다.
5. backends.md 의 해당 절 명령 그대로 띄운다.
   - **pane(Orca)**:
     ```
     orca worktree create --name dflow-<id8> --agent claude --no-parent \
       --base-branch origin/<기본브랜치> --prompt "<포인터 한 줄>" --json
     ```
     기점은 agent 브랜치가 결국 머지될 `origin/<기본브랜치>` 로 명시한다. 생략하면 리포 기본 base 로 가는데,
     리포 기본 base 설정이 기본 브랜치와 다를 수 있기 때문이다. 결과 JSON 의 `result.worktree.path` 와
     `result.agentTerminalHandle` 을 슬롯 표에 저장한다. 핸들이 없으면(옛 런타임) 화면 읽기 없이 git·서버
     증거만 쓴다. 이후 이 워크트리를 가리킬 때는 `--worktree path:<result.worktree.path>` 선택자를 쓴다.
   - **에이전트 팀**: Agent 도구로 띄우고 같은 포인터를 넘긴다. `isolation: "worktree"` 는 **필수**다. 빠뜨리면
     팀원이 팀장 cwd 를 상속해 서로를 덮어쓴다. `name` 은 `w<slot>-<id8>`(슬롯이 앞에 있어 사람이 알아보고,
     id8 이 붙어 같은 슬롯의 다음 작업과 이름이 겹치지 않는다), `subagent_type` 은 `general-purpose`, `model` 은
     인자로 받은 모델이다. 격리 워크트리는 팀장의 현재 HEAD 에서 시작하지만, 워커 부트스트랩이
     `origin/<기본브랜치>` 로 detach 하고 스택 기점은 `/dflow-dev` Phase 0 2번이 claim 전에 맞춘다. 그래서
     팀장이 따로 기점을 정하지 않는다.
6. spawn 직후 `team.spawn` 에 `slot`·`tsk`·`order`·`id8`·`worktree`·`handle` 을 남긴다. 워크트리 경로를 아직
   모르면 `worktree` 는 `-` 로 두고, `handle` 은 Orca 터미널 핸들 또는 에이전트 이름이며 핸들이 없으면 `-` 다.
   재구성이 이 기록으로 슬롯과 작업을 잇는다. id8 을 영구 제외(진행 중)에 넣는다.

같은 작업을 다시 띄우는 것은 poll 이 그 작업을 다시 돌려준 경우(일시 제외가 풀린 `skipped`, 제외하지 않는
`failed rate-limit`)와 에이전트 팀의 `blocked` 재개뿐이다. 그 밖의 재개는 사람 몫이다. 다시 띄울 때 이름·브랜치가
부딪치지 않는 것은 backends.md 「고아 정리 규칙」 5번의 생성 브랜치 정리가 맡는다.

## 6. blocked

**공통**: 사람에게 AskUserQuestion 으로 묻지 않는다(자동 루프). 결과 처리가 `team.blocked` 를 기록한다.
PushNotification 도구가 있으면(지연 로드면 ToolSearch 로 불러) 질문 요약으로 한 번 알린다. 없으면 화면 통지만
한다. 그 id8 은 진행 중으로 영구 제외에 남긴다.

**pane**: "결정 필요 <id8>: <질문>. Orca 의 `dflow-<id8>` 탭에서 답하라" 고 알린다.
**그 슬롯은 blocked 팀원이 계속 잡으며 다른 작업에 재배정하지 않는다.** 살아 있는 프로세스 둘이 같은
`AGENT_ID` 로 heartbeat 를 보내면 좌석표가 한 인물을 두 책상에 그리고 손 든 상태가 새 active 에 덮이기
때문이다. 사람이 탭에서 답하면 팀원이 같은 워크트리·브랜치에서 이어 가고(재spawn·재claim 없음), `.result` 가
새 줄로 바뀌면 감시 루프가 알린다.

**에이전트 팀**: 결과 처리 직후 `TaskStop(w<slot>-<id8>)` 으로 회수하고 슬롯을 해제한다. 워크트리는 HEAD 가
origin tip 과 같으면 즉시 정리하고, 아니면 `.dflow-agent` 값을 `<신원>/<host>/parked` 로 바꿔 둔다
(「3. 결과 처리」). "결정 필요 <id8>: <질문>. 이 세션에 `<id8> <답>` 으로 답하라" 고 알린다. 팀원이 이미
끝났으므로 슬롯을 비워도 `AGENT_ID` 가 겹치지 않는다.

**답 매칭(에이전트 팀 `blocked`)**
- 답은 `<id8> <답>` 형식으로 받는다. 이유: 여러 팀원의 질문이 동시에 쌓일 수 있다.
- 답을 기다리는 `blocked` 가 하나뿐이면 id8 없이 온 답도 그 작업의 답으로 본다.
- 여럿인데 id8 이 없으면 어느 작업의 답인지 되묻는다. 팀장이 사람에게 묻는 곳은 여기 하나다. 답을 엉뚱한
  작업에 넣으면 그 작업이 틀린 결정으로 진행되기 때문이다.
- 받은 답은 `team.answer`(id8, answer)로 기록한다. 컨텍스트 압축 뒤에도 재구성이 되살린다.
- 빈 슬롯이 있으면 곧바로 재spawn 한다. 없으면 **대기 큐 맨 앞**에 넣고 다음 빈 슬롯에 재spawn 한다. 이유: 답을
  받은 작업은 이미 claimed 라서 새 작업보다 먼저 끝내야 한다.
- 재spawn 직전에 그 agent 브랜치를 잡고 있는 워크트리가 남아 있으면(`parked`) 재spawn 하지 않고 "사람 확인
  필요" 로 보고한다. 이유: 그 워크트리에는 push 되지 않은 변경이 있어 자동으로 지울 수 없고, 새 워커는
  `already checked out` 으로 그 브랜치로 옮기지 못한다.

**재spawn**: 포인터 끝에 줄을 바꿔 `ANSWER=<담당자 답 한 줄>` 을 붙여 「5. 팀원 spawn」 으로 새 격리 워크트리에
띄운다. 재claim 은 없다(이미 claimed 다). 워커는 detach 대신 기존 agent 브랜치로 switch 하고, 답을 design.md 에
한 줄 남긴다.

## 7. 마감

poll exit 8, poll 오류 exit, `failed not-isolated`, 기상 때 확인한 종료 시각 경과로 온다. 잠금 상실은 1~6 을 타지
않고 아래 「잠금 상실 마감」 으로 간다.
1. 새 spawn 을 멈춘다. 대기 큐는 보고만 하고 비운다.
2. **기다림의 상한**: `blocked` 슬롯과 무응답 슬롯은 기다리지 않는다. 진행 중 슬롯은 마감에 들어선 뒤
   `TICK` 두 번까지만 결과를 기다린다. 이 동안 poll 은 재기동하지 않고 감시 루프만 재기동해 결과와 `TICK` 을
   계속 받는다(「2-3」 의 일은 spawn·poll 만 빼고 그대로 한다). 그 뒤에도 남은 슬롯은 TSK·id8·워크트리 경로·
   마지막 생존 증거를 목록으로 보고한다. 이유: 사람이 자리를 비운 시간대에 답이 오지 않는 슬롯 하나가 팀장을
   무한정 붙잡지 않게 한다. pane 팀원은 팀장이 끝나도 자기 탭에서 계속 돈다.
3. 집계 표(TSK · id8 · 브랜치 · head · done exit · status · 사유)를 보고하고, 마지막 승인 스윕을 한 번 돈다.
   대기 큐·남은 슬롯·"재개 필요" 도 함께 적는다.
4. 남은 팀원 워크트리 중 살아 있는 팀원(「팀장 상태」 정의)이 없는 것만 백엔드별로 정리한다. Orca 는
   `orca worktree rm --worktree path:<경로>`, 에이전트 팀은 워크트리가 아직 있을 때만
   `git worktree remove --force <경로>` 다. 두 경우 모두 backends.md 「고아 정리 규칙」 을 따라, 깨끗하고 HEAD 가
   `origin/<agent 브랜치>` 와 같을 때만 지우고(생성 브랜치 정리 포함) 나머지는 경로를 보고한다.
   **살아 있는 팀원의 워크트리는 조건과 무관하게 지우지 않는다.** 경로만 보고에 남긴다. 이유: pane 팀원은
   팀장이 끝나도 자기 탭에서 계속 돌고, pane 의 `blocked` 팀원은 탭에서 답을 기다린다. 깨끗하고 push 된 순간에
   지우면 돌고 있는 팀원의 cwd 가 사라진다.
   에이전트 팀의 `--force` 는 미추적 부산물(`.result`·`.dflow-agent`·`.env` 링크·스킬 링크) 때문에 필요하다.
5. **agent 브랜치는 남긴다.** 승인은 사람이 D'Flow 웹에서 하고, 승인 뒤 머지는 다음 `/dflow-team` 의 스윕이나
   `/dflow-merge` 가 한다.
6. poll 이 떠 있으면 TaskStop 으로 멈추고(태스크 id 를 모르면 종료 시각에 스스로 끝난다), 세대 파일의 세대를
   올려 감시 루프를 끝낸다. `team.stop` 을 기록하고 팀장 잠금 디렉터리를 지운다. 지우기 전에 「1. 시작」 의 소유
   판정(`owner` 의 신원이 자기 `<신원>/<host>/lead` 이고 PID 가 현재 `$PPID` 와 같다)을 한 번 더 하고, 참일 때만
   지운다. 이유: 이 팀장이 `beat` 를 70분 넘게 놓쳐 다른 팀장이 잠금을 가져갔다면 그 잠금은 신원·host·리포가
   같아도 PID 가 다르며, 지우면 안 된다. events.jsonl 의 `team.start` 시각과 비교하지 않는 이유: 두 팀장의
   이벤트가 같은 `agent`·`repo` 로 섞여, 마지막 `team.start` 가 새 팀장의 것일 수 있다. `owner` 를 읽는 `read`
   는 `|| true` 로 감싼다. 이유: 파일이 없으면 `read` 가 0 이 아닌 값으로 끝나, 실패에 멈추는 셸 설정에서는
   마감의 나머지가 통째로 건너뛰어진다.
   ```bash
   LOCK=$(git rev-parse --git-path dflow-team.lock); o_who=; o_ts=; o_pid=
   { read -r o_who o_ts o_pid < "$LOCK/owner"; } 2>/dev/null || true
   if [ "$o_who" = '<신원>/<host>/lead' ] && [ "$o_pid" = "$PPID" ]; then rm -rf "$LOCK" && echo LOCK_RELEASED; else echo "LOCK_KEPT owner=$o_who $o_ts $o_pid"; fi
   ```

**잠금 상실 마감**(「2-3」 의 `LOCK_LOST`): 위 1~6 중 기다림·마지막 승인 스윕·워크트리 정리·`team.*` 기록·세대
파일 변경·잠금 삭제를 하지 않는다. 떠 있는 poll 이 있으면 TaskStop 으로 멈추고, 집계와 남은 슬롯(TSK·id8·워크트리
경로)을 "잠금 상실: 이 체크아웃은 다른 팀장이 맡았다" 와 함께 보고한 뒤 끝낸다. 이유: 체크아웃과 이 신원의
워크트리·세대 파일은 이제 새 팀장 것이고, 새 팀장의 재구성은 같은 `agent`·`repo` 의 마지막 `team.start` 이후
이벤트를 읽으므로 이 팀장이 남기는 기록이 새 팀장의 슬롯 표와 제외 목록에 섞인다.

## 좌석표 연동

- 팀원의 좌석 식별은 워커가 쓰는 워크트리 루트 `.dflow-agent`(`<신원>/<host>/w<slot>`)다. 좌석표 S1 의 훅이 이
  파일을 `heartbeat_agent` 로 읽는다. `<신원>/<host>/parked` 는 좌석이 아니며 heartbeat 를 보내지 않는다.
- 팀장 자신은 `<신원>/<host>/lead` 다. 같은 신원의 두 PC 팀장이 좌석표에서 하나로 합쳐지지 않게 한다.
- 좌석표 STANDBY 신호: 서버 계약이 생기면 팀장이 「1. 시작」 5번, poll 재기동, 「7. 마감」 에서
  `{host, agent: lead, slots, busy, until}` 을 보낸다. 그 전에는 `team.start`·`team.stop` 이 대신한다.

## 금지

- 팀원에게 AskUserQuestion 을 쓰게 하는 것. 팀장이 사람에게 묻는 곳은 답 매칭의 id8 되묻기 하나다.
- 팀장이 작업을 claim·progress·done 하는 것. 서버 쓰기는 팀원 몫이다(스윕의 머지만 팀장이 한다).
- `isolation` 없는 에이전트 팀 spawn. 팀원을 `name`·`isolation` 없는 단순 서브에이전트로 띄우는 것.
- 팀원 워크트리에서 팀장이 git 을 조작하는 것(읽기 조회, `parked` 표시, backends.md 의 정리 절차는 예외).
- 팀장 체크아웃에서 poll.sh 를 띄우는 것. 빈 디렉터리(「2-1」)에서만 띄운다.
- 순번 참조, force push, 훅 우회(SKIP_GUARD).
- 같은 작업의 재spawn. 예외는 poll 이 다시 돌려준 작업(일시 제외가 풀린 `skipped`, `failed rate-limit`)과 에이전트
  팀 `blocked` 재spawn 이다.
- 셸 `&` 백그라운드. 백그라운드는 Bash `run_in_background` 로만 띄운다.
- 인원 4 초과.
