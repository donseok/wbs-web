# WBS 진척·단계·실적 크레딧 설계

작성 2026-09-15 · 개정 2026-09-15(D9 단계 컬럼, RPC 시그니처 확정) · 상태 **구현 완료(staging) · 운영 적용 대기** · 목업 https://claude.ai/code/artifact/2f1a7669-a6c1-42f5-b8d2-db890c77e6f8

> 개발 Task 의 실적%를 단계 전이 사건에서 크레딧 표로 지정하고, 사람이 그 값을 덮어쓸 수 있게 하며,
> 전이를 한 트랜잭션으로 묶어 "승인은 됐는데 단계가 안 넘어간" 반쪽 상태를 없앤다.
> WBS 「상태」 컬럼은 「진척」으로 이름을 바꿔 「단계」와 구분한다.

---

## 1. 배경과 문제

작업 1건에 상태 어휘가 여섯 벌 있다(2026-09-15 실측).

| 축 | 값 | 저장 여부 | 보이는 곳 |
|---|---|---|---|
| WBS 상태(파생) | 시작전·진행중·지연·완료 | `actual_pct`·계획%에서 파생(`statusOf`) | WBS 표·엑셀·칸반·대시보드 |
| `wbs_items.stage` | as·fp·ip·im·xx | 저장, `dev_workflow=true` 항목만 자동 전이 | 작업명 칸 칩·상세 패널·허브 드롭다운 |
| `agent_work_orders.status` | ready·claimed·reported·approved·cancelled | 저장 | 상세 패널 「에이전트 진행 상황」·허브 |
| 허브·좌석 상태 | READY·ACTIVE·STALE·OFFLINE·BLOCKED·WAIT·REJECTED·DONE | 주문과 heartbeat 에서 파생 | 허브 표·좌석표 |
| 좌석 Phase | design·build·verify·refactor 등 | heartbeat 에서 파생 | 좌석표 |
| 스킬 state-machine.json | [ ]·dd·im·ts·xx | 로컬 wbs.md 전용 | dflow-export 스크립트 |

문제는 셋이다.

1. **stage 는 주문 상태의 복사본인데 7곳에서 따로 동기화한다.** 배정·cascade·위임(as), claim(ip), 완료 보고(im), 승인(xx), 승인 취소(im) 가 각각 `transitionStage` 를 부른다. 승인은 성공했는데 stage 만 뒤처진 반쪽 상태가 세 번 재발했다(`agentWork.ts` 주석, 러너 설계 §167). 드롭다운 우회를 막는 `REACHED_STAGES` 게이트와 승인 취소가 `change_logs` 를 뒤져 실적을 복원하는 코드가 그 부산물이다.
2. **같은 stage 코드에 한글 라벨이 두 벌이다.** i18n 사전은 as=할당됨·fp=강제 진행·ip=진행 중, `waitReason.STAGE_LABEL` 은 as=분석·fp=기능 계획·ip=구현 계획. fp 는 자동 경로가 0건이다.
3. **WBS 「상태」 컬럼 이름이 단계와 헷갈린다.** DB 는 0077 때 이미 `status` 대신 `stage` 로 지어 충돌을 피했는데 화면 헤더만 「상태」로 남았다. D-CUBE 는 실적% 수기 입력만 쓰므로 이 축은 그대로 두어야 한다.

## 2. 결정 (2026-09-15, 사용자)

| # | 결정 | 이유 |
|---|---|---|
| D1 | 「상태」와 「단계」는 둘 다 둔다. 상태는 실적 대비 계획으로 파생하고, 단계는 에이전트나 사람이 지정한다 | 사람이 직접 개발하는 Task 도 단계가 필요하다. 주문에서 파생하는 안(안 A)은 이 경우를 담지 못한다 |
| D2 | 단계가 지정되면 실적%를 크레딧 표의 값으로 지정한다 | 에이전트가 찍는 임의의 % 대신 정해진 값 |
| D3 | 사람이 실적%를 직접 고칠 수 있다. claim 상태에서 50 을 넣으면 50 이다 | 현장 판단을 막지 않는다 |
| D4 | 반려·재작업 사건에 별도 크레딧(RW)을 둔다. 기본 50 | 작업은 했으므로 claim 값(30)보다 높아야 한다 |
| D5 | 크레딧 숫자는 프로젝트 설정에서 슬라이더 하나(핸들 다섯)로 지정한다 | G-Hub DPI 단계 슬라이더 방식 |
| D6 | WBS 「상태」 컬럼 헤더를 「진척」으로 바꾼다. 칩 값 4개는 그대로 | 「진척 돋보기」·「계획 대비 차이」와 같은 어휘 축. 「진도」는 %값 자체와, 「진행」은 칩·단계 라벨과 충돌 |
| D7 | 에이전트 관할 Task(§3.5 잠금 조건)의 수기 입력은 99 까지. 100 은 승인으로만 | 에이전트 API 가 progress 를 99 로 막아 완료를 승인 경로로 강제하는 규칙과 같다. 2026-08-25 드롭다운 우회 사고의 재발 방지 |
| D8 | 전이는 항상 표 값으로 덮어쓴다(큰 쪽 유지 규칙 없음) | 규칙 하나로 예측 가능 |
| D9 | WBS 표에 「단계」 컬럼을 「진척」 옆에 두되, 프로젝트에 에이전트 위임(`agent` 태그) 항목이 1건 이상일 때만 보인다. 작업명 칸 우단의 단계 칩은 이 컬럼으로 옮긴다 | 담당자 컬럼(`hasAssignee`)과 같은 규칙 — 위임이 없는 D-CUBE 는 표가 그대로다. 칩과 컬럼을 둘 다 두면 같은 값이 두 번 보인다 |

## 3. 모델

### 3.1 세 축

- **진척**(status): `statusOf(actual, planned)` 파생. 규칙 불변. 화면 이름만 「진척」.
- **단계**(stage): `wbs_items.stage` ∈ {as, ip, im, xx} ∪ {null}. `dev_workflow=true` 리프에만 뜻이 있다. `dev_workflow=false` 항목(D-CUBE 전부)은 단계 UI 를 보이지 않고 실적% 수기 입력만 쓴다. WBS 표의 「단계」 컬럼은 프로젝트 단위로 켜진다(D9 — 위임 1건 이상).
- **실적%**(actual_pct): 저장값. 세 경로로 바뀐다. ① 전이 사건이 크레딧 표 값으로 지정 ② 사람이 셀에서 수기 입력 ③ 롤업(부모, 파생).

### 3.2 단계 라벨 (한 벌만)

| 코드 | 한글 | 영문 | 들어가는 사건 |
|---|---|---|---|
| null | 미착수 | Not started | 배정 해제 |
| as | 할당됨 | Assigned | 배정·위임 |
| ip | 작업 중 | In progress | claim, 반려·재작업, 사람 지정 |
| im | 검수 대기 | Awaiting review | 완료 보고, 승인 취소, 사람 지정 |
| xx | 완료 | Done | 승인, 사람 지정(주문 없는 Task) |

`fp` 는 제거한다. 기존 fp 행은 ip 로 이관한다(강제 진행 = 작업 중). `waitReason.STAGE_LABEL`(분석·기능 계획·구현 계획·구현) 사전은 삭제하고 i18n 사전 하나로 통일한다. `StageChip` 은 코드 대문자 표기를 유지한다.

### 3.3 크레딧 표

프로젝트 설정 `project_settings.stage_credits` (jsonb, null 허용). null 이면 코드 기본값.

```jsonc
{
  "default": { "as": 0, "ip": 30, "rw": 50, "im": 80, "xx": 100 },
  "if":      { "as": 0, "ip": 20, "rw": 30, "im": 50, "xx": 100 },   // 선택 — credit_key='if' 항목
  "doc":     { "as": 0, "ip": 20, "rw": 30, "im": 50, "xx": 100 }    // 선택 — credit_key='doc' 항목
}
```

- 키는 `default` 필수, `if`·`doc` 선택. 항목의 `credit_key`(0089) 가 표에 없으면 `default` 를 쓴다.
- `rw` 는 단계가 아니라 **반려·재작업 사건**의 크레딧이다. 결과 단계는 ip.
- 검증(순수 함수 `validateStageCredits`): 정수, 5 단위, `as < ip < rw < im < xx`, 인접 간격 ≥ 10, `xx === 100`. 위반은 저장 거부.
- 저장은 소급하지 않는다. 이미 기록된 `actual_pct` 는 그대로이고 다음 전이부터 새 값이 적용된다.

### 3.4 사건 표 (정본)

| 사건 | 주문 status | 단계 | 실적% | 누가 |
|---|---|---|---|---|
| 배정·위임 체크 ON | ready(발행 조건은 현행 유지) | null→as (stage 가 null 일 때만) | 표.as | 사람·cascade |
| 위임 체크 OFF | ready→cancelled(미착수 주문만) | 불변 | 불변 | 사람 (RPC 밖 — 단계·실적을 안 건드린다) |
| 배정 해제 | 불변(활성 주문 자동 취소 없음, §2.8) | as→null (stage 가 as 일 때만) | 불변 | 사람 |
| claim | ready→claimed | →ip | 표.ip | 에이전트 |
| progress 보고 | 불변 | 불변 | **불변**(보고 행만 기록) | 에이전트 |
| 완료 보고 | claimed→reported | →im | 표.im | 에이전트 |
| 승인 | reported→approved | →xx | 100 | 사람 |
| 승인 취소 | approved→reported | →im | 표.im | 사람 |
| 반려 | reported→claimed | →ip | 표.rw | 사람 |
| 재작업 요청 | approved→claimed | →ip | 표.rw | 사람 |
| 회수(release) | claimed→ready | →as | 표.as | 사람 |
| 사람이 단계 지정 | 잠금이 아닐 때만(§3.5) | 지정값 | 표.<지정값> | 사람 |
| 사람이 실적% 입력 | 불변 | 불변 | 입력값(D7 상한) | 사람 |

단계 전이 사건은 `dev_workflow=true` 항목에서만 단계·실적을 쓴다. `dev_workflow=false` 항목에 주문이 있을 수 없으므로(발행 조건) 충돌은 없다.

### 3.5 사람의 단계 지정 규칙

- 드롭다운은 `dev_workflow=true` 리프에만 보인다.
- **잠금 조건** = 위임됨(`tags ∋ 'agent'`) ∨ 주문 status ∈ {claimed, reported}. 잠기면 드롭다운은 비활성이고 안내문을 띄운다: "에이전트에 위임된 작업입니다. 단계는 승인·반려로 바뀝니다. 직접 바꾸려면 위임을 끄세요."
  - ready 는 넣지 않는다. `ensureOrderForWorkflowLeaf` 가 dev_workflow 리프마다 배정과 무관하게 ready 주문을 만들어 두므로, ready 를 넣으면 사람이 직접 하는 Task 의 단계 지정이 영구히 막힌다(D1 무력화).
  - 대신 위임을 넣는다. 위임된 ready 주문은 `/dflow-poll` 이 자동 claim 하므로, 잠그지 않으면 사람이 찍은 완료가 claim 사건(D8 덮어쓰기)으로 ip·표.ip 로 되돌아간다.
  - 정의는 `agentWork.stageLockedForHuman` 하나다. RPC 는 같은 조건을 SQL 로 복제하고 테스트가 대조한다. 허브는 서버가 행에 실어 보내는 `stageLocked` 만 읽는다.
- 잠금이 아니면 어느 단계로든 바꿀 수 있고, 실적%는 그 단계의 크레딧으로 지정된다. xx 는 100 이다.
- 현행 `setWbsStage` 의 리프 게이트(하위 항목 있으면 거부)와 서브트리 관리자 권한은 유지한다. `REACHED_STAGES` 우회 방어는 삭제한다(잠금 규칙이 대체).

### 3.6 수기 실적 입력 규칙 (`updateActual`)

- `dev_workflow=false`: 0~100, 지금과 같다.
- `dev_workflow=true` 이고 잠금(§3.5): 0~99. 100 을 넣으면 "완료는 승인 버튼으로 처리합니다" 로 거부.
- `dev_workflow=true` 이고 잠금 아님: 0~100. 100 을 넣어도 단계는 바꾸지 않는다(단계는 드롭다운의 몫). 진척은 「완료」가 된다.
- change_logs 는 지금처럼 `actual_pct` 1건.

### 3.7 선행 충족 판정

선행 충족 = `stage ∈ {im, xx}` ∨ `order_approved` ∨ `actual_pct ≥ 100`.

세 번째 축을 더하는 이유: 위임하지 않은 사람 Task 가 선행이면 지금은 stage 가 null 이라 후행이 영원히 막히고 드롭다운으로 im 을 찍어야 풀렸다. 실적 100 이 곧 충족이면 드롭다운 없이 풀린다. claim 게이트(`claim/route.ts`), `waitReason.unmetDepends`, `depends.ts`, WBS 착수 가능 판정 `dependencyReadiness.evaluateStartReadiness`(spec 축), `stageTransition.allPredecessorsReached`(알림 게이트) 다섯 곳이 같은 함수(`predecessorReached`, 순수, `src/lib/domain/agentWork.ts`)를 쓴다. `stageAtLeast`·`STAGE_ORDER` 의 fp 는 지운다. `evaluateStartReadiness` 는 주문 정보가 없어 `stage ∨ actual_pct` 두 축만 본다(승인이 RPC 로 xx·100 을 함께 쓰므로 결과는 같다). API 응답 `depends_evidence[]` 에 `reached: boolean` 을 추가한다(계약 v2.3). `stage` 필드는 유지한다.

## 4. 원자 전이 RPC

### 4.1 이유

지금은 주문 CAS → stage 전이 → 실적 갱신 → change_logs 가 앱 층에서 분리돼 있고 뒤쪽 실패는 로깅만 한다. 반쪽 상태의 원인이다. 사건 하나를 DB 트랜잭션 하나로 만든다.

### 4.2 `apply_workflow_event`

```sql
apply_workflow_event(
  p_event         text,                 -- assign|unassign|claim|report_completion|approve|unapprove|reject|rework|release|set_stage
  p_actor         uuid,                 -- change_logs.user_id
  p_item_id       uuid default null,    -- assign|unassign|set_stage 필수. 주문 사건은 선택(주면 주문의 항목과 일치해야 한다)
  p_order_id      uuid default null,    -- 주문 사건 필수. CAS 대상(기대 status 는 사건이 정한다)
  p_stage         text default null,    -- set_stage 전용
  p_agent         text default null,    -- 행위 에이전트 라벨: claim 은 기록, report_completion·release 는 점유자 일치 조건
  p_agent_user_id uuid default null     -- 행위 에이전트 계정(PAT): 위와 같다
) returns jsonb  -- { ok, conflict, reason, order_status, stage, actual_pct, stage_changed, actual_changed, reached_first, skipped }
```

트랜잭션 안에서 순서대로 한다.

1. `wbs_items` 를 `for update` 로 읽는다. 없으면 `{ok:false, reason:'item_not_found'}`.
2. 주문 사건이면 `agent_work_orders` 를 `for update` 로 읽고 사건이 정한 기대 status(claim=ready, report_completion·release=claimed, approve·reject=reported, unapprove·rework=approved)와 점유자 조건(`p_agent_user_id`/`p_agent` 가 주어지면 `claimed_by_user_id`/`claimed_by` 일치)을 확인한다. 어긋나면 `{ok:false, conflict:true, order_status}` 로 끝낸다(지금의 409 의미).
3. 주문 갱신(사건 표대로). claim 은 `claimed_by·claimed_by_user_id·claimed_at` 을 쓰고, release 는 점유·heartbeat 흔적을 지운다(`releaseOrderByAdmin` 과 같은 컬럼).
4. 단계·실적 갱신. **주문 사건**은 주문의 존재 자체가 워크플로 증거이므로 `dev_workflow` 를 보지 않고 리프이면 쓴다(구 `force` 플래그의 일반화 — 승인만 넘기던 게이트를 주문 사건 전부로 넓힌다). 리프가 아니면 `skipped='parent'`. **assign** 은 `dev_workflow=true`·리프·`stage is null` 일 때만 as 로, **unassign** 은 `dev_workflow=true`·`stage='as'` 일 때만 null 로(실적 불변). **set_stage** 는 잠금(§3.5)이면 해제(null)까지 `{ok:false, reason:'locked'}`. 잠금이 아니면 null 은 워크플로·리프와 무관하게 허용(잘못 찍힌 값 정리, 실적 불변)이고, 값은 `dev_workflow=true`·리프일 때만 쓴다(아니면 `not_workflow`·`parent`). 실적은 `project_settings.stage_credits`(없으면 기본값)에서 항목 `credit_key`(없으면 default) 표의 사건 크레딧으로 쓴다. 승인은 100 고정.
5. change_logs 를 `stage`·`actual_pct` 필드로 각 1건 남긴다(값이 바뀐 것만, `user_id=p_actor`).
6. 결과를 반환한다. `reached_first` 는 이번 전이로 stage 가 im·xx 에 처음 들어갔는지다.

앱 층은 `src/lib/agent/workflowEvent.ts` 의 `applyWorkflowEvent(admin, args)`(RPC 호출 + jsonb 파싱) 하나로 부르고, 반환값으로 화면 문구를 정하며, `actual_changed` 면 `recordProgressSnapshot` 을, `reached_first` 면 `notifySuccessorsOnReached` 를 부른다(둘 다 실패는 로깅만 — 기존 3종 세트 관례). 보고 검토 기록(`agent_work_reports.review_*`)·승인/반려 알림은 지금처럼 앱 층에서 RPC 성공 뒤에 한다.

### 4.3 지워지는 것

- `src/lib/agent/stageTransition.ts` 의 `transitionStage` 와 호출부 8곳(`setWbsAssignee`·`setWbsAssigneeCascade`·`setWbsDevWorkflow`·`delegation.applyDelegation`·claim·완료 보고·승인·승인 되감기)과 `agentWork.STAGE_SKIP_WARN`. `notifySuccessorsOnReached` 는 남기고 `REACHED_STAGES` 는 도메인(`agentWork.ts`)으로 옮긴다. 반려(`rejectAgentCompletion`)와 회수(허브 `releaseOrderByAdmin`·API `release` 라우트)도 RPC 로 간다(지금은 단계를 안 건드린다).
- `src/lib/agent/applyProgress.ts` 전체(progress 보고의 실적 반영).
- `agentWork.ts` 의 `applyApprovedActualPct` 와 승인 취소의 change_logs 복원 코드.
- `wbsAssign.ts` `setWbsStage` 의 `REACHED_STAGES` 우회 방어.
- `waitReason.STAGE_LABEL`, i18n `wbs.stageFp`, `labels.STAGE_CODES` 의 fp, `agentWork.stageAtLeast`. 라벨 정본은 `src/lib/domain/stageLabels.ts`(코드 4개 + 한글 라벨) 하나이고 i18n ko 사전은 이 값과 같아야 한다(테스트로 고정). 허브 표·대기 사유 문구는 이 모듈을 쓴다.

## 5. 화면

### 5.1 프로젝트 설정 › 에이전트 › 개발 워크플로 크레딧

목업(위 링크)대로. 트랙 하나에 AS·IP·RW·IM 핸들과 100 에 잠긴 XX 핸들. 핸들 위 숫자는 클릭해 직접 입력, 드래그·키보드(±5, Home/End) 지원, 순서·간격 제약을 클라이언트와 서버(`validateStageCredits`) 양쪽에서 검사. 아래 미리보기 표는 사건 표를 현재 값으로 보여 주고, 행을 누르면 그 값이 슬라이더 위 현재 위치(◆)로 표시된다. 카테고리별 표(IF·DOC)는 추가·제거할 수 있다. 저장 안내: "저장해도 이미 기록된 실적%는 바뀌지 않습니다."

컴포넌트: `src/components/settings/StageCreditSlider.tsx`(순수 UI) + `src/app/actions/project.ts` 에 `updateStageCredits(projectId, credits)`(관리자 가드, `updateLevelSettings` 와 같은 관례). 위치는 설정 페이지 「에이전트」 카드 안, 허브 링크 아래(킬스위치 `AgentProjectToggle` 은 2026-09-14 에 허브 상태 바로 옮겨졌다). 관리자가 아니면 읽기 전용으로 그린다. 값은 `getProjectConfig` 가 `stageCredits` 로 함께 읽는다.

### 5.2 WBS 표

- 헤더 `wbs.colStatus` ko 「진척」· en "Progress". `RowDetailPanel` 의 같은 키 행도 함께 바뀐다.
- 엑셀 export 3행 헤더의 「상태」→「진척」(`src/lib/excel/export.ts`). import 파서는 이 헤더를 읽지 않는다(2026-09-15 확인).
- 실적% 셀 편집은 3.6 규칙. 활성 주문 항목에서 100 을 넣으면 서버 거부 사유를 토스트로 보인다.
- **「단계」 컬럼(D9)**: `PLAN_COLS` 에 `stage`(폭 84) 를 `status` 바로 뒤에 둔다. 헤더 `wbs.colStage` ko 「단계」· en "Stage". 표시 조건은 `hasAnyDelegation(items)` — `WbsRow.agentDelegated`(`tags` 에 `agent` 포함, `src/lib/data/wbs.ts` 가 채운다) 가 트리 어디든 하나라도 true. 담당자 컬럼의 `hasAssignee` 와 같은 자리에서 걸러 낸다. 타임라인 집중 모드에서도 보이고(`TIMELINE_COLS`), 계획 열 숨김의 대상이다(`HIDEABLE_PLAN_COLS`).
- 셀은 3.2 라벨 칩(`data-wbs-stage=코드`, 색은 지금 `STAGE_META`). null 은 `-`. 모르는 코드는 코드 그대로 중립색으로 그린다(표시 = 로깅). 작업명 칸 우단의 칩은 지운다.
- 엑셀 export 에 단계 열은 넣지 않는다(범위 밖).

### 5.3 상세 패널 「담당·단계」

- 단계 드롭다운: 3.5 규칙(잠금이면 비활성 + 안내문, `dev_workflow=false` 면 숨김). 패널은 담당·단계를 읽는 같은 select 의 `tags` 로 위임 여부만 본다 — 주문 조회를 더하면 이미 느린 상세 패널 액션 체인에 왕복이 늘어난다. 위임 없이 reported 주문만 남은 드문 경우는 RPC 의 `locked` 거부 문구로 드러낸다.
- 「에이전트 진행 상황」의 승인·반려·승인 취소·재작업·회수 버튼은 그대로이고, 툴팁의 실적 문구를 표 값으로 바꾼다("실적 100%, 단계 완료(xx)" → "단계 완료(xx)·실적 100" 등 사건 표와 일치).

### 5.4 허브 표

단계 select 는 서버가 허브 행에 실어 보내는 `stageLocked` 만 읽는다(8상태에서 재파생하지 않는다 — READY·BLOCKED·OFFLINE 의 대응이 갈라진다). 상태 열(8상태)은 불변.

## 6. API 계약 v2.3 (`dflow-work/references/api-contract.md`)

| # | 항목 | v2.2 | v2.3 |
|---|---|---|---|
| 1 | stage enum | `as\|fp\|ip\|im\|xx\|null` | `as\|ip\|im\|xx\|null`. 서버는 입력 `fp` 를 `ip` 로 정규화(과도기) |
| 2 | progress 보고 | `actual_pct` 즉시 반영 | 보고 행만 기록. `actual_pct` 불변. 응답은 200 그대로 |
| 3 | completion 보고 | 주문 reported + stage im (분리 실행) | RPC 한 트랜잭션. 실적은 표.im |
| 4 | depends_evidence | `{external_ref, stage, branch, head_sha, order_approved}` | `reached: boolean` 추가. 판정 = 3.7 |
| 5 | claim 게이트 | stage ≥ im ∨ order_approved | 3.7 과 동일(= `reached`) |

스킬 쪽 수정: `/dflow-dev` Phase 0 의 선행 판정 문구 2곳은 `reached` 를 우선 보고 없으면 종전 판정으로 폴백. `dflow-work/references/troubleshooting.md` 한 줄. 로컬 state-machine.json([dd]·[ts])은 부트스트랩 전용이라 손대지 않는다.

## 7. 마이그레이션 (0096, 스테이징 리허설 필수 — G4)

한 파일에 셋을 담고 `_rollback.sql` 을 같이 만든다.

1. `project_settings.stage_credits jsonb null`.
2. `wbs_items`: `update … set stage='ip' where stage='fp'` 후 CHECK 를 `('as','ip','im','xx')` 로 재정의. `import_wbs_upsert` RPC 의 stage 정규화 식에 `'fp'→'ip'` 추가(0089 본문 기준으로 그 줄만).
3. `apply_workflow_event` 함수(security invoker, service_role 호출 전용 — 라우트 가드가 관문, 회의록·위키와 같은 원칙).

롤백: 함수 drop, CHECK 를 fp 포함으로 되돌림(이관된 행은 되돌리지 않는다 — 데이터 손실 없음), 컬럼 drop.

사전 확인 쿼리를 마이그레이션 머리에 주석으로 둔다(0077 관례): `select count(*) from wbs_items where stage='fp'`.

## 8. 테스트

- 순수 함수: `validateStageCredits`(순서·간격·xx=100·5단위), `creditFor(event, credits, creditKey)` 사건 표 전수, `predecessorReached` 세 축, `statusOf` 불변 확인.
- RPC: `tests/migrations/` 관례로 SQL 본문 검사 + 스테이징 실측 스크립트(승인 → 실적 100·stage xx 가 한 번에, 반려 → ip·표.rw, 주문 CAS 불일치 → conflict).
- 액션: `updateActual` 상한 3분기, `setWbsStage` 활성 주문 비활성, `updateStageCredits` 관리자 가드·검증 거부.
- 라우트: claim·report 가 RPC 를 통해 단계·실적을 쓰는지, progress 보고가 `actual_pct` 를 안 건드리는지, `depends_evidence.reached`.
- 화면: 슬라이더 제약(드래그 경계·직접 입력 클램프·XX 잠금), 헤더 「진척」, 드롭다운 비활성 안내문, 「단계」 컬럼(위임 0건이면 없음·1건이면 헤더와 셀·깊은 자손 위임도 인정·작업명 칸 칩 없음).
- 회귀: fp 를 참조하던 기존 테스트 15개 파일(2026-09-15 grep) 갱신.

## 9. 범위 밖

- 크레딧 소급 재계산.
- 허브 8상태·좌석 Phase·heartbeat 어휘.
- 스킬 로컬 state-machine.json 어휘 통일.
- 크레딧 표의 프로젝트 간 복사·프리셋.

## 10. 구현 순서 (계획서에서 Task 로 쪼갠다)

1. 「진척」 헤더·엑셀 헤더 (독립, 먼저 머지 가능).
2. 순수 함수(크레딧 검증·사건 표·선행 판정·라벨 정본) + 테스트. fp 제거.
3. 마이그레이션 0096 + 롤백 + 스테이징 리허설.
4. RPC 호출부 교체(claim·report·승인·반려·재작업·승인 취소·회수·배정·위임·단계 지정) + 삭제 목록 정리.
5. `updateActual` 상한, 드롭다운 UI(상세 패널·허브), 라벨 통일.
6. WBS 「단계」 컬럼(D9).
7. 설정 슬라이더 + 저장 액션.
8. API 계약 v2.3 문서, 스킬 문구.
