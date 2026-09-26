# /dflow-dev 단계 — Verify — 감사와 Verify·Refactor 게이트

SKILL.md 「단계 지도」 가 가리킬 때 읽는다. 다 읽기 전에 이 단계를 시작하지 않는다. 모든 단계에 공통인 규칙(게이트 집행 원칙·상태 모델·서버 통신)은 SKILL.md 에 있다.

**Verify 는 읽기 전용 감사자 셋과 작성자 하나를 한 메시지에 동시에 띄운다**(phase-verify.md). research/docs 특례 작업은
감사자 없이 작성자만 띄운다(첫 보고가 곧 `PHASE_RESULT`).
- 감사자: 역할 spec·review·tests 셋. **이름(`name`)을 붙이지 않고 띄운다** — 이름을 붙인 에이전트는 실행 환경에 따라 별도
  pane·프로세스로 뜨는데, 감사자는 SendMessage·TaskStop 할 일이 없고 보고하면 스스로 끝난다. 부모 컨텍스트를 물려받지 않는 새 서브에이전트(general-purpose,
  fork 금지)에 `model: "sonnet"` 을 준다 — 쓰기 금지는 템플릿이 정한다(Explore 는 위치 찾기용이라 리뷰가 얕아진다). 프롬프트는 phase-prompt.md 「감사 템플릿」 에 `{ROLE}`(spec·review·tests)·
  `{BASE}`(state.json `baseline.base`)·`{BUILD_HEAD}`(`build_gate.head`)를 채운 것이다. 감사자는 커밋된 내용만 읽으므로 작성자의
  변이·E2E 와 겹쳐도 된다.
- 작성자: `<TSK>-verify`, 종전 Verify 템플릿과 모델(sonnet) 그대로다. 첫 보고는 `VERIFY_EXEC done|fail` 이고 **이 보고로 회수하지
  않는다.**
- 감사 보고(첫 줄 `AUDIT_RESULT <역할> <지적 수>`)를 받으면 곧바로 `<TASKS>/<TSK>/audit-<역할>.md` 에 그대로 옮겨 적는다(git
  에는 쓰지 않는다). 같은 때 state.json `verify_findings.<역할>` 에 지적 수를, `verify_advisor.audit` 에 감사 보고의 advisor 호출 수를
  더한다 — 감사 파일은 게이트 뒤 지워지므로 비교 지표(dev-discipline 「Build 모델 시험(build_model_trial)」)는 여기에 남긴다.
  작성자의 advisor 호출 수는 보고(`VERIFY_EXEC`·`PHASE_RESULT`·재시도 보고)를 받을 때마다 `verify_advisor.writer` 에 덮어쓴다(보고가
  누적 값이다. 작성자를 새로 띄웠으면 앞 작성자의 마지막 값에 더한다).
- 작성자의 `VERIFY_EXEC` 와 감사 셋이 모두 오면: 지적이 한 건이라도 있으면 세 파일의 지적을 모아 **같은 작성자에게 SendMessage 로**
  넘기고 `PHASE_RESULT verify done|fail` 을 기다린다. 지적이 0건이면 `VERIFY_EXEC` 를 최종 보고로 받는다(`done` 은 통과, `fail` 은
  Verify 실패 — 아래 4번). SendMessage 가 안 되면 sonnet 작성자를 새로 띄우고 `{AUDIT_FINDINGS}` 에 지적을 넣는다. 이 왕복은 Verify
  재시도 1회에 세지 않는다.
- 재개할 때 `audit-<역할>.md` 가 있는 감사자는 다시 띄우지 않는다. Verify 게이트 판정이 끝나면 `audit-*.md` 를 지운다.
- Verify 재시도(아래 4번)는 작성자에게만 이어 붙이고 감사자는 다시 띄우지 않는다.

### Verify·Refactor 게이트

   - **Verify·Refactor 게이트**: 먼저 `git diff --name-only <Build 게이트 sha>..HEAD` 를 본다. 바뀐 파일이 Task 문서
     (`<TASKS>/<TSK>/` 아래)와 `*.md` 뿐이고 `git status --porcelain` 도 Task 문서 밖에서 비어 있으면 전체 스위트를 다시
     돌리지 않고 Build 게이트 결과를 그대로 쓴다. 커밋 밖에 남은 파일(되돌리지 못한 변이 등)은 Phase 06 이 커밋에 섞으므로
     재실행 생략의 근거가 못 된다. 코드가 바뀌었으면 전체 스위트를 돈다. Refactor 가 커밋을 남기지 않았으면 Refactor 게이트는 없다.
     **대응표가 있고 `build_gate.scope` 가 `module` 이면 Verify 게이트는 재실행을 생략하지 않고 `full` 명령을 한 번 돈다** —
     머지 전 최종 증거다(Verify 서브에이전트가 끝난 뒤 오케스트레이터가 돈다). `build_gate.scope` 가 `full` 이면 위 생략
     규칙 그대로다. 코드가 바뀐 Refactor 게이트는 `full` 명령이다.
   - **Verify 의 감사 확인**: build-log.md 「변이 검증 기록」 표가 「불변 규칙」 을 모두 덮는지와, 화면 작업이면 E2E 결과가
     보고에 있는지 본다. 작성자 보고에 변이 표본으로 고른 행과 이유가 있고, 감사 지적이 있었으면 지적마다 판정(수용·기각 사유)이
     있는지도 본다. 없으면 실패다. research/docs 특례 작업(dev-discipline 「research/docs 작업 특례」)은 표 대신
     문서 검증 체크리스트 순회를 본다.

**다음 단계**: 수동은 `orch/refactor.md`, 팀원 모드는 `orch/close.md`(worker-mode.md 행 I).
