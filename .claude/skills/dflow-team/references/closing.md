# /dflow-team 마감 (SKILL.md 「7. 마감」)

SKILL.md 「7. 마감」 이 가리킨다. 마감에 들어설 때(잠금 상실·lease 상실 마감 포함) Bash `cat` 으로 읽는다. 아래 번호
1~7 과 「잠금 상실 마감」·「lease 상실 마감」 이 다른 문서가 「7. 마감」 N번으로 가리키는 자리다.

poll exit 8, poll 오류 exit, `failed not-isolated`, 기상 때 확인한 종료 시각 경과, 종료 요청(`STOP_REQUESTED` 또는
사람의 말)으로 온다. 잠금 상실과 lease 상실은 1~6 을 타지
않고 아래 「잠금 상실 마감」·「lease 상실 마감」 으로 간다.
1. 새 spawn 을 멈춘다. 대기 큐는 보고만 하고 비운다.
2. **기다림의 상한**: `blocked` 슬롯과 무응답 슬롯은 기다리지 않는다. 진행 중 슬롯은 마감에 들어선 뒤
   `TICK` 두 번까지만 결과를 기다린다. 이 동안 poll 은 재기동하지 않고 감시 루프만 `--may-skip` 없이 재기동해 결과와 `TICK` 을
   계속 받는다(「2-3」 의 일은 spawn·poll 만 빼고 그대로 한다). 그 뒤에도 남은 슬롯은 TSK·id8·워크트리 경로·
   마지막 생존 증거를 목록으로 보고한다. 이유: 사람이 자리를 비운 시간대에 답이 오지 않는 슬롯 하나가 팀장을
   무한정 붙잡지 않게 한다. 팀원은 팀장이 끝나도 자기 pane 이나 탭에서 계속 돈다.
   해소 워커도 같은 규칙으로 기다린다. 마감은 남은 `merge_conflict` 표시를 지우지 않는다(사람이 보아야 한다).
3. 집계 표(TSK · id8 · 브랜치 · head · done exit · status · 사유)를 보고하고, 마지막 승인 스윕을 한 번 돈다(사전 검사 없이 — 「4-0」 의 예외).
   대기 큐·남은 슬롯과 **"멈춤" 표**(「팀장 상태」 — 재시작 명령 칸까지)도 함께 적는다. 이유: 마감 뒤에 남는
   워크트리는 사람이 이어받는 수밖에 없으므로, 이어받는 방법이 그 자리에 있어야 한다. 이번 실행에서 붙인 문제
   기록이 있으면 `문제 기록 N건 → <MAIN>/docs/dflow-team/issues.md` 를 한 줄 더 적는다(「3. 결과 처리」 문제 기록).
   워크트리는 사람이 이어받는 수밖에 없으므로, 이어받는 방법이 그 자리에 있어야 한다. 재시작 대기와 rate-limit 대기는
   `references/restart.md` 「마감·lease·잠금」 대로 사유와 재시작 명령을 적는다(마감 중에는 재시작하지 않는다).
4. 남은 팀원 워크트리 중 살아 있는 팀원(「팀장 상태」 정의)이 없는 것만 백엔드별로 정리한다. tmux 는
   워크트리가 아직 있을 때만 `git worktree remove --force <경로>`, Orca 는 backends.md 「pane(Orca)」 「정리」의
   전환 규칙(경로가 `orca worktree list --json` 에 있으면 `orca worktree rm --worktree path:<경로>`, 없으면
   `git worktree remove --force <경로>`)을 따른다. 두 경우 모두 backends.md 「고아 정리 규칙」 을 따라, 깨끗하고
   HEAD 가 `origin/<agent 브랜치>` 와 같거나 그 머지가 이미 기본 브랜치의 조상일 때만 지우고(생성 브랜치 정리
   포함) 나머지는 경로를 보고한다.
   **살아 있는 팀원의 워크트리는 조건과 무관하게 지우지 않는다.** 경로(tmux 는 pane id 도)만 보고에 남긴다.
   이유: 팀원은 팀장이 끝나도 계속 돈다. `blocked` 팀원은 pane 이나 탭에서 답을 기다린다. 깨끗하고 push 된
   순간에 지우면 돌고 있는 팀원의 cwd 가 사라진다. 살아남은 tmux 팀원은 다음 팀장의 재구성이 `.dflow-pane` 과
   `#{pane_start_path}` 로 흡수한다.
   tmux 백엔드에서는 **소켓에 pane 이 하나도 없을 때만** 서버를 거둔다(backends.md 「마감」).
   ```bash
   [ -z "$("$TM" -L dflow list-panes -a -F '#{pane_id}' 2>/dev/null)" ] && "$TM" -L dflow kill-server
   ```
   이 소켓은 **사용자 단위**이지 리포 단위가 아니다. 자기 슬롯 표만 보고 거두면 같은 PC 의 다른 체크아웃에서
   도는 팀장의 살아 있는 팀원이 미커밋 산출물을 안은 채 죽는다. 목록이 비지 않으면 서버를 남기며, 대가는
   서버 하나가 계속 도는 것뿐이고 다음 팀장의 재구성이 그 pane 들을 흡수한다.
   `--force` 는 미추적 부산물(`.result`·`.dflow-agent`·`.dflow-prompt`·`.dflow-pane`·`.dflow-run`·`.dflow.local`
   (레거시 `.env`) 링크·`.dflow` 링크·스킬 링크) 때문에 필요하다.
5. **agent 브랜치는 남긴다.** 승인은 사람이 D'Flow 웹에서 하고, 승인 뒤 머지는 다음 `/dflow-team` 의 스윕이나
   `/dflow-merge` 가 한다.
6. poll 이 떠 있으면 TaskStop 으로 멈추고(태스크 id 를 모르면 종료 시각에 스스로 끝난다), 세대 파일의 세대를
   올려 감시 루프를 끝낸다(`.claude/skills/dflow-team/scripts/tick.sh --retire`). `team.stop` 을 기록하고, 좌석표에 감시 종료를 알린 뒤 팀장 잠금 디렉터리를 지운다.
   지우기 전에 「1. 시작」 의 소유 판정(`owner` 의 신원이 자기 `<신원>/<host>/lead` 이고 PID 가 현재
   `$LEAD_PID` 와 같다)을 한 번 더 하고, 참일 때만 지운다. 이유: 이 팀장이 `beat` 를 70분 넘게 놓쳐 다른 팀장이 잠금을 가져갔다면
   그 잠금은 신원·host·리포가 같아도 PID 가 다르며, 지우면 안 된다. events.jsonl 의 `team.start` 시각과 비교하지
   않는 이유: 두 팀장의 이벤트가 같은 `agent`·`repo` 로 섞여, 마지막 `team.start` 가 새 팀장의 것일 수 있다.
   `owner` 를 읽는 `read` 는 `|| true` 로 감싼다. 이유: 파일이 없으면 `read` 가 0 이 아닌 값으로 끝나, 실패에
   멈추는 셸 설정에서는 마감의 나머지가 통째로 건너뛰어진다. 좌석표 종료 신호는 같은 소유 판정이 참일 때만,
   잠금을 지우기 전에 보낸다. 신원을 잠금 `owner` 에서 읽으므로 지운 뒤에는 보낼 수 없기 때문이다.
   ```bash
   LEAD_PID=${CLAUDE_PID:-$PPID}
   LOCK=$(git rev-parse --git-path dflow-team.lock); o_who=; o_ts=; o_pid=
   { read -r o_who o_ts o_pid < "$LOCK/owner"; } 2>/dev/null || true
   if [ "$o_who" = '<신원>/<host>/lead' ] && [ "$o_pid" = "$LEAD_PID" ]; then
     .claude/skills/dflow-work/scripts/dflow.sh watch --agent "$o_who" --stop || :
   fi
   if [ "$o_who" = '<신원>/<host>/lead' ] && [ "$o_pid" = "$LEAD_PID" ]; then
     .claude/skills/dflow-work/scripts/dflow.sh lease release || { rm -f "$(git rev-parse --git-path dflow-team.lease)" "$(git rev-parse --git-path dflow-team.lease).beat"; echo "LEASE_RELEASE_FAILED 3분 뒤 스스로 풀린다"; }
     rm -f "$(git rev-parse --git-path dflow-team.stop)"
     pkill -f "caffeinate -i -w $LEAD_PID" 2>/dev/null || :
     rm -rf "$LOCK" && echo LOCK_RELEASED
   else echo "LOCK_KEPT owner=$o_who $o_ts $o_pid"; fi
   ```
   종료 파일과 절전 방지도 여기서 거둔다. 종료 파일을 남기면 다음 팀장은 전제 검사에서 지우므로 해가 없지만,
   소유가 맞을 때만 지우는 이유는 잠금을 가져간 새 팀장에게 온 요청을 지우지 않기 위해서다.
   lease 는 잠금보다 먼저 반납한다. `dflow.sh lease release` 가 성공하면 그 명령이 스스로 상태 파일과 `.beat` 를
   지우므로, lease 갱신 프로세스는 다음 확인(최대 5초)에서 상태 파일이 없는 것을 보고 스스로 끝난다. **실패하면
   (예: 서버 호출 실패) `dflow.sh lease release` 는 상태 파일을 지우지 않은 채 끝나므로, 이 블록이 대신
   지운다.** 지우는 것이 실제로 갱신 프로세스를 멈추는 신호다 — 지우지 않으면 세션이 살아 있는 한 갱신
   프로세스가 계속 서버에 renew 를 시도해, "3분 뒤 스스로 풀린다" 는 다음 문장이 거짓이 된다(서버 쪽 lease 는
   TTL 로 풀려도 로컬 프로세스는 살아남는다). 반납이 실패해도 마감을 멈추지 않는다.
7. **남은 에이전트 확인**: ListAgents 를 다시 불러 이 세션에 `running` 인 이름 붙은 에이전트가 남아 있으면
   그 이름으로 TaskStop 하고 보고한다. 정상이면 하나도 없다. 팀원과 그 Phase 손자는 별도 프로세스라 이 세션의
   목록에 나타나지 않고, 손자는 팀원이 스스로 회수한다. poll 태스크와 감시 루프는 Bash 태스크라 이
   목록에 없다.

**잠금 상실 마감**(「2-3」 의 `LOCK_LOST`): 위 1~7 중 기다림·마지막 승인 스윕·워크트리 정리·`team.*` 기록·세대
파일 변경·잠금 삭제를 하지 않는다. 떠 있는 poll 을 TaskStop 으로 멈추고 7번을 그대로 수행한 뒤, 집계와 남은
슬롯(TSK·id8·워크트리 경로·pane id)을 "잠금 상실: 이 체크아웃은 다른 팀장이 맡았다" 와 함께 보고한 뒤
끝낸다. 팀원 pane 은 건드리지 않고 `kill-server` 도 하지 않는다. 새 팀장의 재구성이 `.dflow-pane` 으로
흡수하기 때문이다. 이유: 이 세션의 poll 을
멈추는 것은 공유 상태를 건드리지 않으며, 남겨 두면 새 팀장의 poll 과 같은 작업을 두 번 돌려준다. 체크아웃과 이
신원의 워크트리·세대 파일은 이제 새 팀장 것이고, 새 팀장의 재구성은 같은 `agent`·`repo` 의 마지막 `team.start`
이후 이벤트를 읽으므로 이 팀장이 남기는 기록이 새 팀장의 슬롯 표와 제외 목록에 섞인다.

**lease 상실 마감**(「2-3」 의 `LEASE_LOST`): 다른 곳의 같은 신원 팀장이 이 프로젝트를 넘겨받았다. 이 팀장은 즉시
손을 뗀다.
1. "팀장 lease 상실: <사유>. 이 프로젝트는 다른 곳의 팀장이 맡았다" 를 보고한다.
2. 새 claim·새 spawn·승인 스윕·머지를 하지 않는다. 대기 큐는 보고만 하고 비운다.
3. 떠 있는 poll 을 TaskStop 으로 멈추고, 세대 파일의 세대를 올려 감시 루프를 끝낸다(`tick.sh --retire`). lease 갱신 프로세스는 이미
   끝나 있다(표식을 쓰고 끝난다).
4. **떠 있는 워커는 건드리지 않는다.** 워커는 하던 작업을 끝까지 하고 agent 브랜치 push 와 done 보고를 한다. 그
   결과는 새 팀장의 승인 스윕이 서버에서 이어받는다. 팀원 pane·탭을 닫지 않고 `kill-server` 도 하지 않는다.
5. 위 6번 블록을 그대로 실행한다: 좌석표 감시 종료, `lease release`, 로컬 잠금 삭제(소유 판정이 참일 때).
   그 블록의 `lease release` 는 남의 lease 를 풀지 않는다. 서버가 holder·generation 이 맞는 행만 풀기 때문에
   빼앗긴 lease 에는 0건으로 끝나고, 서버에 닿지 못해 끝난 경우(`LEASE_UNREACHABLE`)에는 아무도 가져가지 않은 내
   lease 를 바로 풀어 준다. 이유(로컬 잠금 삭제): 같은 체크아웃에서 사람이 나중에 팀장을 다시 띄울 수 있어야 한다.
   표식 파일(`dflow-team.lease-lost`)은 다음 시작의 전제 검사가 지운다.
6. 7번(남은 에이전트 확인)을 그대로 한다.
7. 보고에 남은 슬롯(TSK·id8·워크트리 경로·pane id)과 "워커 N명은 하던 작업을 끝낸 뒤 스스로 끝난다" 를 적는다.
