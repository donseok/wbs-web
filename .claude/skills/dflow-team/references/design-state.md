# /dflow-team 설계 상태 (계약 2.11)

SKILL.md 「2-3」 의 poll exit 0·`build`, 「3. 결과 처리」 가 가리킬 때 Bash `cat` 으로 읽는다. 옛 서버(계약 < 2.11)에서는 읽지 않는다 —
모든 작업이 완전자동이다. 워커 쪽 정본은 `/dflow-dev` `references/orch/start.md` 「서버 판단」 과 worker-mode.md 「설계 상태의 결과 줄」 이고,
설계는 wbs-web 리포 docs/superpowers/specs/2026-09-26-design-state-dev-auto-design.md 6절·12절(킷에는 미동봉)이다.

## 1. 설계 사전 검사

poll 줄에 넷째 칸 `action` 이 있는 후보를 띄우기 전에 개발 브랜치의 설계 문서를 본다(스펙 6.2 「띄우기 전 검사」). 워커를 띄워 곧 되돌리는
낭비와, 사람 초안을 에이전트 설계가 옮기거나 덮는 일(12절 L5)을 막는다. `git fetch origin` 은 기상마다 한 번만 하고, 실패하면 이 기상에는
`action` 이 있는 후보를 하나도 띄우지 않는다(모르는 채 띄우지 않는다. 제외도 하지 않는다 — 다음 기상에 다시 본다). `<TASK_DIR>` 은 SKILL.md
「5. 팀원 spawn」 3번 블록으로 여기서 먼저 구하고, 「5」 는 그 값을 다시 쓴다.
```bash
git -C '<MAIN>' fetch -q origin || echo FETCH_FAIL
git -C '<MAIN>' show "origin/<개발브랜치>:<TASK_DIR>/design.md" 2>/dev/null | grep '^## ' || echo NO_DESIGN
```
- `action=build`(구현자동 — 사람이 「설계 확정」 했다): 제목 줄만 보고 Design 게이트의 최소 구조 5절(접근·변경 파일 목록·테스트 전략·수용
  기준 매핑·불변 규칙 — 번호와 덧붙인 말은 무시한다)이 모두 있는지 가린다. `NO_DESIGN` 이거나 절이 빠졌으면 띄우지 않고
  `.claude/skills/dflow-work/scripts/dflow.sh design-reopen <id8> --reason "<design.md 없음 | 빠진 절: …>"` 를 부른다. 서버가 사람 설계
  대기로 되돌리고 사유를 화면에 보인다(사람이 고쳐 다시 확정하면 poll 이 다시 준다). 제외는 하지 않는다. 보고 한 줄:
  `<TSK> 사람 설계를 되돌렸습니다 — <사유>`. design-reopen 이 실패하면 띄우지 않고 사유 `설계 되돌리기 실패(exit <n>)` 로 일시 제외에 넣고
  `team.result`(slot `-`, status `skipped`)를 남긴다.
- `action=design`·`full`: `NO_DESIGN` 이 아니면 사람이 쓴 설계 초안이 개발 브랜치에 있다. 띄우지 않고 「멈춤」 표에
  `사람 설계 초안 있음 — 방식을 구현자동으로 바꾸거나 초안을 지우라` 로 올리며, `team.result`(slot `-`, status `skipped`, 사유
  `사람 설계 초안 있음`)를 남겨 일시 제외한다(poll 이 30분 뒤 다시 준다, 12절 L11).
- 통과하면 그대로 spawn 한다. 포인터의 `SCOPE` 는 그 `action` 이다(SKILL.md 「5」 4번).

## 2. 「설계 승인」 된 작업(`build`)

기상 블록 요약 끝의 `build` 칸이다(옛 서버면 칸이 없다). 서버가 팀장 lease 의 프로젝트와 poll 과 같은 거르기(태그 `agent`, `wake.sh` 의
`--wp`)로 좁혀 준 "이 신원·이 PC 가 띄울 build 주문" 이다(설계 상태 스펙 D22·Y9 — WP 밖의 승인 주문은 오지 않는다).
- `"NULL"` 이면 조회 실패다. 그 기상에는 처리하지 않고 `build_err` 를 한 줄 보고한다(빈 목록과 뭉개지 않는다).
- 배열이면 `status` 가 `claimed` 인 원소(「설계 승인」 된 설계 검토 작업 — poll 에 나오지 않는다) 중 슬롯·영구 제외에 없는 것을 재개 대상에
  더한다(SKILL.md 「2-3」 4번의 순서, 「5-1」 의 **승인** 대상). 이 PC 에 워크트리가 있으면 그것을, 없으면 `references/resume.md` 3항이 원격
  agent 브랜치에서 만든다. 띄우기 전 확인은 resume.md 「서버 판단 확인」 이다.
- **fetch·push 실패의 되풀이 방지(고아 스캔과 같은 규칙, 12절 Y11)**: `build_ready` 는 claimed·accepted·dd·mine 인 주문을 계속
  싣는다 — 그래서 워커가 `skipped fetch 실패`·`skipped push 실패` 로 끝나도 주문은 그대로 이 목록에 남아, 고치지 않으면 결과가 도착한
  같은 기상에도 곧바로 다시 뜬다. `EXCLUDE_TEMP` 는 만료가 없어 그대로 가두면 다른 사유(설계 관문 등)까지 영구히 막으므로 쓰지 않는다.
  대신 `lead-state.sh` 의 id8 별 신호로 가른다: `WARN_RETRY` 면 재개 대상에 넣지 않고 「멈춤」(사유 `fetch·push 3회 연속 실패`)으로
  보낸다. `RETRY_DUE` 면 재개 대상에 더한다(고아 스캔과 같은 30분 신호). `BUILD_RETRY_DUE` 도 재개 대상에 더한다 — 사유가
  `설계 관문(…)`·`주문이 바뀜`·`다른 PC 도는 중(…)` 인 skip 뒤 30분이 지났다는 build 목록 전용 신호다. 사람이 설계를 되돌렸다가 다시
  승인했거나 다른 PC 가 물러나면 같은 주문이 이 목록에 다시 실리므로, 이것이 없으면 팀장 재시작 전까지 갇힌다(좌석은 계속 곧 시작한다고
  말한다). 이 사유들에는 3회 멈춤이 없다(`WARN_RETRY` 는 fetch·push 실패에만 뜻이 있다). 셋 다 아니고 `EXCLUDE_TEMP` 에는 있으면
  (마지막 결과가 재시도 사유의 skip 인데 아직 30분이 안 지났거나, 재시도 사유가 아닌 skip 이다) 이번 기상에는 더하지 않는다. 셋 다
  아니고 `EXCLUDE_TEMP` 에도 없으면(한 번도 실패한 적이 없거나 팀장 재시작으로 이력이 사라졌다) 그대로 더한다.
- 이 처리는 **건너뛴 TICK**(「2-2」 `--may-skip`)에서는 돌지 않는다. `tick.sh` 의 깨울지 판정은 `EXCLUDE_TEMP` 에 걸린 claimed
  원소를 깨우는 이유로 치지 않되, `RETRY_DUE`·`BUILD_RETRY_DUE` 인 것은 치므로 재시도 기한이 되면 그 TICK 은 건너뛰지 않는다.
  사람이 좌석 「이어서 시작」 을 누르면 재개 요청이 이번 기상을 곧바로 강제한다(`reqs` 가 비지 않으면 건너뛰지 않는다).
- `ready` 원소(구현자동 확정)는 poll(`action=build`)이 가져오므로 여기서 띄우지 않는다.

## 3. 결과

SKILL.md 「3. 결과 처리」 표가 가리키는 보충이다.
- **`design_review`**: 실패가 아니다. 보고 한 줄: `<TSK> 설계 검토 대기(<branch>) — 「설계 승인」을 누르면 다음 TICK 에 팀장이 구현을
  이어 간다`.
- **`design-done 미확인`**(`design_review`·`design_waiting` 의 사유): 워커가 push 까지 마쳤는데 design-done 이 네트워크로 실패했다. 워크트리를
  지우기 전에 `.claude/skills/dflow-work/scripts/dflow.sh design-done <id8>` 를 부른다(설계 멈춤 이어받기, 스펙 6.3). 실패하면 워크트리를
  지우지 않고 `parked` 로 두며 다음 기상에 다시 부르고, 「멈춤」 표에 사유 `설계 멈춤 미완료` 로 올린다.
- **`skipped fetch 실패`·`skipped push 실패`**(잡은 작업): 워크트리를 지우지 않는다(push 하지 못한 커밋이 있을 수 있다). 30분 뒤 재구성의
  `RETRY_DUE` 로 고아 스캔이 다시 띄우고, 같은 계열이 3회 연속이면 `WARN_RETRY` 로 「멈춤」 표에 `fetch·push 3회 연속 실패` 를 올린다
  (12절 Y11 — 네트워크·권한을 사람이 확인한 뒤 `--resume`). 「2」 의 `build` 목록도 같은 `RETRY_DUE`·`WARN_RETRY` 신호를 쓴다(그 밖의
  재시도 사유는 `BUILD_RETRY_DUE`). **팀장 재시작에 주의**: 「1. 시작」 5번의 재기록은 **흡수한 슬롯**(살아 있는 팀원)만 다시 쓴다. `skipped fetch·push 실패` 는 이미 슬롯을
  반납한 뒤라 재시작 뒤의 새 창에는 이 id8 의 `team.result` 가 없다 — `lead-state.sh` 가 `RETRY_DUE` 를 내지 않고, 고아 스캔은
  `.result` 의 `skipped` 를 최종 판정으로 보아 재개 가능에 넣지 않는다. 재시작 **전** 재구성이 이미 `RETRY_DUE` 로 잡아 재개를
  시작했을 때만 자동으로 이어지고, 그렇지 않으면 「멈춤」 으로 남아 사람의 `--resume` 이 있어야 다시 돈다. **`build` 목록 예외**:
  재시작 뒤 build 목록 주문은 영구 제외가 비어 있고(위 「2」 는 EXCLUDE_PERM 만 최종 차단으로 쓴다) 재구성이 재기록하지 않은 새 창에는
  `RETRY_DUE`·`WARN_RETRY`·`BUILD_RETRY_DUE` 도 없으므로(위 「2」 의 "`EXCLUDE_TEMP` 에도 없으면" 갈래) 「2」 가 다음 기상에 그대로
  다시 띄운다 — 자동으로 이어지되 30분 대기·3회 상한은 재시작 전 이력만큼은 못 지킨다.
- **`skipped 다른 PC 도는 중(<runner>)`**: 워크트리를 지우지 않고 「멈춤」 표에 올린다(다른 PC 의 세션이 이어 간다). 다른 PC 가
  물러나 그 주문이 `build` 목록에 다시 실리면 30분 뒤 `BUILD_RETRY_DUE` 로 「2」 가 다시 띄운다.
- **결과 줄 없이 `heartbeat.sh` 의 `runner_active` 훅이 세운 워커**: 팀원은 결과 줄을 쓰지 못한 채 멈춘다(hook 의 `stopReason`
  은 사람에게만 보인다). 무응답(정체)으로 잡혀 `restart.md` 「판정」 순서 3(`mine` 이 거짓)으로 떨어지고, 거두기 → 슬롯 해제 →
  「멈춤」(사유 `다른 PC claim`, `restart.md` 「판정」 3행 그대로)으로 간다 — 재시작 후보로 가지 않는다. 워크트리는 `parked` 로
  남는다. 나중에 사람이 `--resume` 해도 2.11 에서는 build-start 까지 가지 않는다 — `resume.md` 「서버 판단 확인」 의 `mine` 이
  거짓 행이 먼저 막아 사유 `다른 PC 도는 중(<runner>)` 으로 다시 「멈춤」 에 오른다(build-start exit 12 는 2.11 서버만 내며,
  `resume.md` 를 거치지 않은 수동 실행만 그것을 받아 `skipped 다른 PC 도는 중` 으로 끝난다).
- **`design_reopened`**(설계를 사람에게 되돌렸다): 실패가 아니다. 워크트리는 미커밋 변경이 있어도 지운다 — 설계 원본은 개발
  브랜치이거나 이미 push 돼 있다. `git worktree remove --force <워크트리>`(Orca 는 Orca 정리 명령에 `--force`) 뒤 backends.md
  「고아 정리 규칙」 5번의 생성 브랜치 정리. 보고 한 줄: `<TSK> 설계를 사람에게 되돌렸습니다 — <사유>. 다시 확정·승인되면 새로 띄웁니다`.
  사유가 `주문이 바뀜` 이면(구현 시작 직전에 사람이 설계를 되돌렸다) `<TSK> 사람이 설계를 되돌려 구현을 시작하지 않았습니다. 다시 확정되면
  새로 띄웁니다` 로 알린다.
