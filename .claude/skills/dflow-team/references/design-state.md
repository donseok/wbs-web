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
  (12절 Y11 — 네트워크·권한을 사람이 확인한 뒤 `--resume`). 팀장을 재시작하면 연속 수는 재구성의 재기록(「1. 시작」 5번, 가장 최근
  결과 하나만 되살린다)이 새 창의 시작이 돼 다시 1부터 센다 — `WARN_RETRY` 경고가 그만큼 늦어질 뿐 재시도 자체는 막히지 않는다.
- **`skipped 다른 PC 도는 중(<runner>)`**: 워크트리를 지우지 않고 「멈춤」 표에 올린다(다른 PC 의 세션이 이어 간다).
- **`design_reopened`**(설계를 사람에게 되돌렸거나 주문이 바뀜): 실패가 아니다. 워크트리는 미커밋 변경이 있어도 지운다 — 설계 원본은 개발
  브랜치이거나 이미 push 돼 있다. `git worktree remove --force <워크트리>`(Orca 는 Orca 정리 명령에 `--force`) 뒤 backends.md
  「고아 정리 규칙」 5번의 생성 브랜치 정리. 보고 한 줄: `<TSK> 설계를 사람에게 되돌렸습니다 — <사유>. 다시 확정·승인되면 새로 띄웁니다`.
