# /dflow-team 재개 spawn (SKILL.md 「5-1. 재개 spawn」)

SKILL.md 「5-1. 재개 spawn」 이 가리킨다. 재개 대상을 띄울 때 Bash `cat` 으로 읽는다. 「5. 팀원 spawn」·「팀장 상태」 등 절
이름은 SKILL.md 의 것이다.

중단된 작업을 이어 띄운다. 새 작업 spawn 과 두 가지가 다르다. **워크트리를 새로 만들지 않고**(남아 있으면
그대로 쓴다) **claim 하지 않는다**. 서버가 이미 `claimed` 이고, 이어받은 워커의 `/dflow-dev --worker` 가 재개
판정으로 끊긴 Phase 를 잇는다.

대상은 넷이다.
- **자동**: 고아 스캔이 "재개 가능" 으로 분류한 워크트리(「팀장 상태」). 빈 슬롯이 있고 차단기가 풀려 있으면
  대기 큐보다 **먼저** 띄운다. 이유: 그 작업은 이미 서버 claim 을 잡고 있어, 새 작업을 먼저 띄우면 점유만 늘고
  진척은 늘지 않는다.
- **요청**: 좌석표의 「이어서 시작」 버튼이 남긴 `resume_requests`(「2-3」). `host` 가 이 PC 인 것만 온다. 이미
  워크트리가 있고 자동 조건도 맞으면 자동 갈래와 같고, 워크트리가 없으면 아래 3항이 새로 만든다. 사람이 화면에서
  누른 것이므로 재시도 상한은 무시한다.
- **재시작**: `references/restart.md` 「재투입」. 결과 줄 없이 멈춘 팀원을 팀장이 그 자리에서 다시 띄운다. 이미 서버
  claim 을 잡고 있어 대기 큐보다 먼저 띄우며, 재시도 상한 3 을 자동 갈래와 나눠 쓴다. 차단기·rate-limit 보류의 통제를 받는다.
- **지목**: 「인자」 의 `--resume <id8>`. 자동 판정의 거부 사유(재시도 상한, `claimed_by` 불일치)를 무시한다.
  워크트리가 없어도 된다. 다만 **서버 status 가 `claimed` 일 때만 재개다.** 지목한 id8 이 `ready` 면 재개가
  아니라 새 작업이므로 5번의 일반 spawn 으로 보내고(claim 은 워커가 한다), `reported`·`approved` 면 개발이
  끝난 것이므로 "재개 대상 아님(서버 <status>)" 로 보고하고 띄우지 않는다. 승인 반영은 「4. 승인 스윕」 이
  한다.

절차:
0. **입장 제어**: 무엇이든 바꾸기 전에 backends.md 「입장 제어」 블록을 돈다(두 백엔드 공통). `SPAWN_DEFERRED_CAPACITY`
   면 이 재개를 이번 기상에 하지 않는다. 워크트리·`.dflow-agent`·포인터를 건드리지 않았으므로 다음 기상의 재구성이 같은
   대상으로 다시 잡는다. 이 자리에서 도는 이유: 5항이 `.dflow-agent` 를 `parked` 에서 되돌린 뒤에 막히면 팀원 없는
   워크트리가 `parked` 아닌 채 남는다. 7항의 띄우기는 이 검사를 다시 하지 않는다.
1. **손실 보고 한 줄을 먼저 낸다.** 사람이 이 줄만 보고 멈출 수 있어야 한다.
   ```
   재개 <id8> <TSK>: 워크트리 <경로|없음> · 브랜치 <agent/…@<head>|없음> · 원격 <origin/agent/…@<sha>|없음>
        · 미커밋 <N파일|없음> · claimed_by=<값>(이 PC|다른 PC) · 잃는 것: <없음|…>
   ```
   ```bash
   git ls-remote --heads origin "refs/heads/agent/<id8>-*"
   git -C <워크트리> status --porcelain | wc -l      # 워크트리가 있을 때만
   ```
   "잃는 것" 은 갈래마다 이렇다. 워크트리가 있으면 `없음`(커밋·미커밋 모두 그대로 이어 간다). 워크트리가
   없고 원격 브랜치가 있으면 `그 PC 의 미커밋 변경(마지막 push 인 <sha> 뒤의 작업)`. 워크트리도 원격 브랜치도
   없으면 `이전 시도 전부(설계 문서 포함) — 사실상 처음부터 시작한다`. 워커는 Phase 06 에서만 push 하므로
   진행 중이던 작업의 원격 브랜치는 대개 없다.
2. **다른 PC 경고**: `claimed_by` 가 이 PC 가 아니면 "그 PC 의 워커가 아직 돌고 있어도 이 팀장은 알 수 없다
   (생존 신호가 서버 DB 에는 있으나 지금 계약의 `show` 가 내주지 않는다). 겹쳐 돌면 같은 브랜치에 두 세션이
   커밋한다" 를 한 줄 더 적는다. 이 갈래는
   `--resume` 으로만 오므로 사람이 지목한 것으로 보고 진행한다.
3. **워크트리 확보**
   - 있으면 그대로 쓴다. 지우지 않는다.
   - 없으면 새로 만든다. 기점은 `origin/agent/<id8>-<slug>` 가 있으면 그것, 없으면 `origin/<기본브랜치>` 다.
     원격 agent 브랜치가 있으면 detach 하지 않고 그 브랜치로 만든다. 이어서 push 해야 하기 때문이다.
     ```bash
     git fetch origin
     git worktree add <MAIN>/.claude/worktrees/dflow-<id8> -B agent/<id8>-<slug> origin/agent/<id8>-<slug>
     ```
     `.dflow.local`(레거시 `.env`)·스킬 링크는 새 작업 spawn(5번)과 같게 건다.
4. **`TASK_DIR` 을 구한다.** 슬롯을 정하고 `.dflow-agent` 를 되돌리기(5항) **전에** 한다 — 실패하면 이 재개
   자체를 접어야 하는데, 이미 되돌린 `.dflow-agent` 는 그 워크트리를 `parked` 아닌 상태로 남겨 다음 기상의
   고아 스캔·전제 검사가 살아 있는 팀원으로 오판하게 만든다. **6·8항은 별도 Bash 호출이라 여기서 구한 값을
   못 보므로, 아래 값을 출력해 그 출력을 6·8항에 그대로 옮겨 쓴다.** 옛 `.dflow-prompt` 의 `TASK_DIR=` 토큰을
   그대로 쓴다(5항의 슬롯 추출과 같은 sed 방식):
   ```bash
   task_dir=$(sed -n 's/.*TASK_DIR=\([^ ]*\).*/\1/p' <워크트리>/.dflow-prompt 2>/dev/null | head -n 1)
   echo "task_dir=${task_dir:-없음}"
   .claude/skills/dflow-team/scripts/docker-allow.sh '<id8>'   # DOCKER=allow|ban — 6항 포인터에 옮긴다. 옛 포인터 값은 쓰지 않는다
   ```
   비어 있으면(`TASK_DIR` 이전에 만들어진 옛 포인터) 다시 구한다:
   ```bash
   id8='<id8>'
   task_dir=$(.claude/skills/dflow-work/scripts/dflow.sh taskdir "$id8"); rc=$?
   echo "task_dir=${task_dir:-없음} rc=$rc"
   ```
   `rc` 가 0 이 아니면(위 항목 1 과 같은 실패 갈래) **재개하지 않는다** — `.dflow-agent` 는 그대로 두고(아직
   건드리지 않았다), 그 id8 을 일시 제외에 넣고 사유 `작업 폴더 해석 실패(exit $rc)` 를 보고하며
   `team.result`(slot `-`, status `skipped`)를 남긴 뒤 다음 후보로 간다. 성공하면 위 출력의 작업 폴더 값을
   아래 `<4항에서 출력된 작업 폴더>` 자리에 그대로 옮겨 쓴다.
5. **슬롯을 정하고 `.dflow-agent` 를 되돌린다.** 슬롯 번호는 `.dflow-prompt` 의 `AGENT_ID=` 에 박힌 번호를
   먼저 쓰고, 그 번호가 이미 찼거나 파일이 없으면 「팀장 상태」 의 발급 규칙으로 새로 낸다.
   ```bash
   slot=$(sed -n 's/.*AGENT_ID=[^ /]*\/[^ /]*\/w\([0-9][0-9]*\).*/\1/p' <워크트리>/.dflow-prompt 2>/dev/null | head -n 1)
   echo "slot=${slot:-없음}"   # 비었거나 이미 찬 번호면 발급 규칙으로 새로 정한 뒤 아래 줄을 쓴다
   printf '%s\n' '<신원>/<host>/w<정한 슬롯>' > <워크트리>/.dflow-agent
   ```
   `slot` 이 빈 채로 두 번째 줄을 쓰지 않는다. `.../w` 로 끝나는 값은 `dflow.sh` 의 `*/parked` 가드에 걸리지
   않아 번호 없는 좌석으로 heartbeat 가 나간다. 파일이 없어 번호를 못 찾는 경우는 `.dflow-prompt` 를 쓰기 전에
   만들어진 옛 Orca 워크트리뿐이며, 그때는 새로 발급한다.
   **이 되돌리기를 워커가 뜨기 전에 한다.** `dflow.sh heartbeat` 는 값이 `*/parked` 면 exit 2 로 거부하므로,
   `parked` 인 채로 띄우면 그 팀원은 좌석표에 진척을 하나도 알리지 못한다.
6. **포인터를 다시 쓴다.** 5번 4항의 형식 그대로이며 `AGENT_ID` 는 5항에서 정한 슬롯, `TASK_DIR` 은
   `<4항에서 출력된 작업 폴더>`, `DOCKER` 는 4항 블록의 `docker-allow.sh` 출력이다. 옛 파일을 그대로 두지 않는 이유: 슬롯을 새로 발급한 경우 옛 포인터의
   `AGENT_ID` 와 어긋나 팀원이 남의 좌석으로 heartbeat 를 보낸다. `MODEL` 은 이번 실행의 인자를 쓴다.
7. **띄운다.** 먼저 `references/restart.md` 「중단 표식 정리」 블록을 돈다(`st` 는 재개 판정이 받은 show 의 `status`,
   곧 `claimed`). `CANCEL_MARK_RM_FAILED` 면 띄우지 않고 「멈춤」 표(사유 `중단 표식 삭제 실패`)에 넣는다. 백엔드별 명령은 5번 5항과 같다(입장 제어 줄과 `git worktree add` 줄은 빼고 쓴다. 입장 제어는 0항에서 했다). 두 백엔드 모두 `.dflow-run` 을 **있든 없든 새로 쓰고**(새로 만든
   워크트리에는 없고, 남아 있던 것은 옛 모델 인자를 달고 있다) 핸들을 `.dflow-pane` 에 덮어쓴다. **폴더 신뢰 확인 루프를 반드시 돈다.** 넘기면 팀원이 첫 화면에서 멈춘 채 살아 있어 슬롯 하나가
   통째로 논다. tmux 는 pane id 를, Orca 는 `orca terminal create --worktree "path:$WT" --command ./.dflow-run
   --json` 이 낸 `result.terminal.handle` 을 쓴다(backends.md 「pane(Orca)」 — 2026-09-24부터. 옛 방식은 포인터를
   `--prompt` 로 넘겨 기존 워크트리에 탭을 다시 열었다).
8. **옛 `.result` 를 지운다**(`rm -f <워크트리>/<4항에서 출력된 작업 폴더>/.result`). 이유: `failed…` 로 끝난 워크트리를
   `--resume` 으로 이어받으면 옛 결과 줄이 그대로 남아 있는데, 재개한 팀원이 결과를 쓰기 전에 pane 이 한 번
   흔들리면 `PANE_DEAD` 폴백이 그 옛 줄을 읽어 방금 띄운 작업을 다시 실패로 판정한다. 해시가 같아 중복
   처리는 막히지만, 그 슬롯이 빈 것으로 돌아가 같은 작업이 두 번 뜬다.
9. `team.spawn` 을 기록한다. 필드는 5번 6항과 같고 `spawn_kind` 는 `resume` 이다(events.md). 재시도 수를 이
   값으로 세므로, `new` 로 적으면 상한이 동작하지 않는다.

재개한 팀원이 다시 최종 판정 없이 죽으면 다음 기상의 고아 스캔이 같은 판정을 하고, 재시도가 상한(3)에 닿으면
"멈춤"(사유 `재시도 상한`)으로 내려간다. `--resume` 은 그 상한을 무시하므로 사람이 원인을 고친 뒤 다시 지목할
수 있다.
