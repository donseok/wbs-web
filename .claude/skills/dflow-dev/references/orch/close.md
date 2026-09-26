# /dflow-dev 단계 — 마감

SKILL.md 「단계 지도」 가 가리킬 때 읽는다. 다 읽기 전에 이 단계를 시작하지 않는다. 모든 단계에 공통인 규칙(게이트 집행 원칙·상태 모델·서버 통신)은 SKILL.md 에 있다.

## Phase 06 — 마감 (오케스트레이터 본인)

1. `git branch --show-current` 재확인 — `agent/` 브랜치가 아니면 **push 금지, 중단·보고**.
2. 미커밋 잔여물 커밋(파일명 명시) → `git push origin <agent 브랜치>`.
   push 가 훅(G1~G4)에 거부되면 SKIP_GUARD 금지 — 중단하고 사람에게 보고.
   이 브랜치가 파일명이 곧 버전인 마이그레이션(Flyway `V<버전>__…` 등)을 더했으면 push 직전에 dev-discipline 「마이그레이션
   버전」 의 재확인을 먼저 한다.
3. `dflow.sh show <ref>` 로 spec 개정 여부 최종 확인(낡은 명세로 done 방지) →
   `<TASKS>/<TSK>/decisions.json` 작성 →
   `dflow.sh done <ref> "<요약>" --auto-links --decisions <TASKS>/<TSK>/decisions.json`.
   decisions.json(결정 목록의 정본)은 design.md `## 담당자 확인 필요 결정` 절을 옮긴 JSON 배열이다. 항목은 `key`(절의 번호
   `D1`…)·`question`·`options`(2~6개)·`chosen`(택한 선택지의 0부터 센 색인)·`rationale`·`on_reject`. 절이 없거나 0건이면 `[]`
   다. supervised 모드(플래그 없음)도 넘긴다 — 대화로 정한 결정은 확인이 끝났으므로 `[]` 다(서버의 `null` 은 "구 도구" 뜻만
   갖는다). 이 파일은 커밋하지 않는다. done 이 exit 0 이면 지우고, 실패하면 남겨 재시도 재료로 쓴다. `DECISIONS_INVALID …`
   (exit 2)는 파일 형식 오류다 — 고쳐 다시 부른다. stderr 경고 `DECISIONS_COUNT_MISMATCH`·`DECISIONS_SUFFIX_MISSING`(요약
   접미사와 목록 건수가 어긋남)과 `서버가 결정 목록을 모릅니다(계약 < 2.6)`(옛 서버라 요약 접미사로만 전달)는 보고는 된 것이다.
4. state.json 을 `phase=reported` 로 갱신하고, 그 파일을 파일명을 명시해 커밋한 뒤 `git push origin <agent 브랜치>` 한다.
   push 가 훅에 거부되면 우회하지 않고 보고한다. done 은 이미 보고됐으므로 되돌리지 않는다(이 push 가 실패해도
   `/dflow-merge` 의 원격 후보 조건은 phase 에 기대지 않아 승인 반영은 막히지 않는다).
   사용자에게 **"승인 대기로 보고했습니다"** 로 전달(완료 아님).
   **승인은 사람이 D'Flow 웹에서 하는 비동기 이벤트라 이 세션 안에서 못 기다린다** — main 반영은
   다음 `/dflow-dev` 호출의 Phase 01-가 스윕이나 `/dflow-merge` 가 처리하며, 둘 다 원격 agent 브랜치까지 본다.
   `/dflow-poll` 의 승인 감지(exit 9)는 현재 작업트리의 state.json 만 보므로, 다른 브랜치로 옮긴 뒤에는
   이 작업의 승인을 알리지 못한다.


**다음 단계**: 없다. 여기서 끝난다.
