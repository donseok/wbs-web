# 에이전트 작업 중단 — 설계 (2026-09-19)

## 배경

좌석표·위임 표의 "회수" 버튼은 주문을 `claimed → ready` 로 되돌리고 점유 흔적만 지운다. 로컬 워커는 멈추지 않는다.

- heartbeat 훅(`kit/hooks/heartbeat.sh`)은 curl 을 백그라운드로 던지고 응답을 보지 않는다.
- `dflow-dev` 는 progress 보고가 실패해도 다음 Phase 로 간다.
- 워커는 설계~검증~push 를 끝까지 돌고 마지막 completion 보고에서야 409 를 받는다.
- 게다가 주문이 `ready` 로 돌아가므로 `/dflow-team`·`/dflow-poll` 이 곧바로 다시 집어 간다 — 같은 태스크를 두 워커가 동시에 개발한다.

사용자 결정(2026-09-19):
1. "회수" 버튼을 **"중단"** 으로 바꾼다. 누르면 서버 정리와 워커 정지가 함께 일어난다.
2. 중단 뒤 작업은 **위임 해제** 상태가 된다 — 주문 `cancelled`, `tags:agent` 해제. 다시 맡기려면 사람이 체크를 켠다.

## 결정

### 1. 서버: 중단 op (마이그레이션 없음)

- 허브·좌석 op `release` 를 `stop` 으로 바꾼다(라벨 "중단"). 자격은 회수와 같다 — 관리자 또는 서브트리 관리자.
- 본체는 기존 위임 해제 경로 `applyDelegation(..., delegated:false)`(`src/lib/agent/delegation.ts`)를 재사용한다.
  태그 해제 → `ready`·`claimed` 주문을 `cancelled` 로(CAS). `cancelled` 는 종착 상태라 다시 claim 될 틈이 없다.
  (release 이벤트로 `ready` 를 거치면 그 사이에 폴러가 집어 갈 수 있으므로 쓰지 않는다.)
- **단계 되돌리기**: 위임 해제 경로가 claimed 주문을 취소했으면, 태그·주문 정리가 끝난 뒤
  `applyWorkflowEvent({ event:'set_stage', itemId, stage:'as' })` 로 단계·실적을 착수 전으로 되돌린다.
  태그 해제 뒤라 `locked` 에 걸리지 않는다. 체크 해제로 위임을 끄는 경로도 같은 함수를 타므로 두 길이 똑같이 동작한다.
  단계 되돌리기가 실패하면 중단 자체는 성공으로 두고 warning 으로 드러낸다(표시 = 로깅).
- 호출 대상 주문은 `claimed` 일 때만 받는다(`ready` 는 위임 체크 해제로 충분, `reported` 는 승인·반려로 정리).
  WBS 항목이 지워진 주문(`wbs_item_id` null)은 주문만 CAS 로 `cancelled` 로 바꾼다.
- 알림: `work.released` 타입을 그대로 쓰되 문구를 "관리자가 작업을 중단했습니다" 로 바꾼다.

### 2. 서버: heartbeat·progress 응답 코드

- heartbeat 라우트: 주문 `status === 'cancelled'` 이면 `409 code='cancelled'`(메시지 "작업이 중단되었습니다").
  그 밖의 상태 불일치는 지금처럼 `409 conflict`.
- report 라우트(progress·completion)도 같은 규칙으로 `409 code='cancelled'` 를 돌려준다.

### 3. 워커: heartbeat 훅 (`kit/hooks/heartbeat.sh`)

- **중단 표식 파일** `~/.dflow/hb/<order>.cancelled`. 훅은 매 호출 첫머리(절제 판정 전)에 이 파일을 본다.
  있으면 `state.json` 을 `phase=cancelled` 로 바꾸고(이미면 그대로) 아래 JSON 을 stdout 에 쓰고 exit 0.
  ```json
  {"continue": false, "stopReason": "D'Flow 에서 이 작업이 중단되었습니다(<id8>). 더 진행하지 말고 멈추세요."}
  ```
  표식 파일을 쓰는 이유: 서브에이전트 안에서 `continue:false` 가 부모 세션까지 멈추는지 보장되지 않는다.
  표식이 남아 있으면 부모가 다음 도구를 부르는 즉시 절제와 무관하게 다시 멈춘다.
- heartbeat 전송은 **동기**로 바꾼다(`--max-time 1.5`, 훅 timeout 5초 안). HTTP 코드와 바디를 받아
  `409` 이고 `code == "cancelled"` 일 때만 표식 파일을 만들고 위와 같이 멈춘다.
  그 밖의 결과(네트워크 실패, 다른 409, 5xx)는 지금처럼 무시한다 — fail-open. 확실한 중단 신호일 때만 세운다.
- 60초 절제는 유지한다. 반응 시간은 최대 약 60초.
- 대상 state.json 선택 규칙(진행 중 phase)에 `cancelled` 는 넣지 않는다 — 표식 파일 판정이 먼저 돈다.
  표식 파일은 order UUID 로 찾으므로, 첫머리 판정은 state.json 에서 order 를 읽은 직후·절제 전에 둔다.
  (phase 가 이미 cancelled 인 state.json 은 진행 중 목록에서 빠지므로, 표식 검사는 cancelled 도 포함한 최신 state.json 으로 한다.)

### 4. 워커 스킬

- `dflow.sh`: 409 바디의 `code` 가 `cancelled` 면 exit **10**(새 코드, "중단됨")을 낸다. 사용법·exit 표에 추가.
- `dflow-dev/SKILL.md`: progress·heartbeat·completion 호출이 exit 10 이면 즉시 중단한다 —
  `state.json` 에 `phase=cancelled`, 산출물은 로컬 커밋만(push 하지 않음), 사용자 보고 한 줄. 워커 모드는 `.result` 에 `cancelled` 를 쓴다.
- `dflow-team/SKILL.md`·`references/worker-prompt.md`: 결과 표에 `cancelled` 행 추가 — 좌석(슬롯) 해제,
  pane 은 `kill-pane` 으로 거두되 **워크트리는 지우지 않는다**(산출물 보존). 결과 줄이 없고 pane 이 멈춰 있어도
  주문이 `cancelled` 면 같은 처리. 사람 알림은 한 줄.
- 킷 재빌드는 main 반영 때 한다(이번 범위는 staging).

### 5. 화면

- 라벨 "회수" → "중단"(좌석 op 바, 위임 표, `labels.ts` 설명 문구, 도움말 문단).
- 설명: "에이전트 위임을 끄고 진행 중인 개발을 멈춥니다 — 단계는 착수 전(as)으로 돌아가고, 워커는 다음 신호(약 1분 안)에서 멈춥니다."
- 되돌리기 어려운 동작이라 한 번 확인한다(기존 확인 UI 가 있으면 그것, 없으면 op 바의 2단 클릭 — 브라우저 `confirm()` 금지).
- 아이콘은 정지 사각형 그대로.

## 범위 밖

- 중단된 워크트리 자동 정리, "재개" 버튼(= 위임 체크 다시 켜기로 대신).
- 러너 반납 라우트(`/release`)는 그대로 둔다 — 워커가 스스로 반납하는 경로다.

## 검증

- 단위: 액션(`stop` 자격·claimed 외 거부·단계 as·알림 문구), heartbeat·report 라우트의 `cancelled` 코드,
  훅 테스트(`tests/skills/heartbeat-hook.test.ts` — 409 cancelled 면 continue:false·표식 파일, 그 밖엔 무출력),
  dflow.sh exit 10, 좌석 op·위임 표 라벨.
- 스테이징 E2E: 스테이징 주문을 claim 한 가짜 워커 워크트리에서 훅을 돌려 중단 전후 출력을 확인하고,
  화면에서 "중단" → 주문 cancelled·태그 해제·단계 as 를 확인한다.
