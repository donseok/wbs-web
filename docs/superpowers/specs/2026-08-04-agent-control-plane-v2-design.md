# D'Flow Agent Control Plane v2 설계

작성 2026-08-04 · 상태 **검증 요청 초안 — 구현 승인 아님**

> WBS를 계획·승인의 정본으로 두고, 여러 개발자의 로컬 PC에서 실행되는 코딩
> 에이전트를 D'Flow가 배정·관제·검수하는 기능 확장안이다.
>
> 기준 코드: `main@dacc831bd938`
>
> 선행 설계: `docs/superpowers/specs/2026-07-31-agent-work-loop-design.md`
>
> 기존 API 계약: `docs/design/dflow-agent-work-api-spec.md`

이 문서는 선행 설계를 폐기하지 않는다. 이미 구현된 v1 작업 원장과 API를 운영 가능한
다중 PC 체계로 확장하기 위한 **v2 제안**이다. 선행 설계와 충돌하는 항목은 §1.2에
명시하며, 사용자 승인 전에는 기존 결정을 변경하지 않는다.

---

## 0. 문서 사용법과 검증 규약

### 0.1 규범 용어

- **필수(MUST)**: 안전성·정합성·호환성을 위해 구현이 반드시 만족해야 한다.
- **권장(SHOULD)**: 특별한 반증이 없으면 따르는 기본안이다.
- **선택(MAY)**: 구현 시기와 제품 정책에 따라 생략할 수 있다.

### 0.2 검증 범위

검증 에이전트는 다음을 각각 판정해야 한다.

1. **사실성**: §2의 현재 구현 설명이 기준 커밋의 코드와 일치하는가.
2. **완결성**: 정상 흐름뿐 아니라 인증, 경합, 재시도, 오프라인, 취소, 반려가 닫혀 있는가.
3. **보안성**: 웹 지시문이 로컬 PC의 임의 명령 실행·비밀 유출 경로가 되지 않는가.
4. **정합성**: WBS, 작업 주문, 실행 시도, Git/CI, 사람 승인 사이의 진실 원천이 명확한가.
5. **호환성**: v1 API와 미등록 프로젝트, 특히 운영 D-CUBE에 미치는 영향이 차단되는가.
6. **구현 가능성**: Next.js 15 + Supabase + 로컬 Node.js Runner에서 현실적으로 구현 가능한가.
7. **검증 가능성**: 각 필수 요구사항을 자동 테스트 또는 명시적인 E2E로 입증할 수 있는가.

검증 결과 형식은 §18을 따른다. 검증자는 근거 없는 동의 대신 파일·행 또는 재현 가능한
시나리오를 제시해야 한다.

### 0.3 권한 경계

이 문서는 설계 저장과 검증만 승인한다. 코드 수정, 마이그레이션 적용, Runner 설치,
프로덕션 설정 변경, 외부 Git provider 연동이나 배포를 승인하지 않는다.

---

## 1. 결론과 설계 결정

### 1.1 핵심 결론

D'Flow는 소스 코드를 직접 실행하는 서버가 아니라 **PM용 Control Plane**으로 둔다.
각 개발자의 로컬 PC에는 **Local Runner**를 두고, Runner가 outbound HTTPS로 D'Flow에
접속해 작업을 가져간다. 실제 코딩, 테스트, Git 인증, 에이전트 로그인은 로컬에서만
수행한다. Git commit/PR/CI가 결과의 진실 원천이고, D'Flow는 작업 명세·상태·증적·승인을
관리한다.

```text
PM / WBS UI
   │ 작업 발행·승인·수정 요청
   ▼
D'Flow Control Plane (Next.js + Supabase)
   ├─ Work Order / Execution Spec
   ├─ dependency gate / scheduler
   ├─ Runner identity / lease / commands
   └─ Run events / artifacts / reviews
            ▲
            │ outbound HTTPS 또는 Realtime wake-up + HTTPS claim
      ┌─────┼──────────┐
      │     │          │
Local Runner A   Local Runner B   Local Runner C
      │ worktree + AgentAdapter + checks
      ▼
Git branch / immutable commit / PR / CI
      │ 검증된 SHA·상태
      └───────────────→ PM 승인 → WBS 100% → 후속 작업 해제
```

### 1.2 선행 v1 결정에 대한 변경 제안

아래는 아직 확정이 아니라 검증·사용자 승인이 필요한 v2 권장안이다.

| v1 결정 | v2 권장안 | 변경 이유 |
|---|---|---|
| 모든 에이전트가 `AGENT_API_SECRET` 하나 공유 | Runner별 페어링·폐기 가능한 credential | 여러 PC 중 한 대의 유출을 전체 fleet 사고로 확대하지 않기 위해 |
| 요청 body의 `user_email`이 실행 책임자 | credential에서 `owner_user_id`를 서버가 유도 | 시크릿 보유자의 사용자 가장 차단 |
| `progress` 0~99를 WBS 실적에 즉시 반영 | 실행 telemetry와 WBS 공정률 분리, 승인 시 100% | 코딩 에이전트의 주관적 퍼센트가 PM 실적을 오염시키지 않기 위해 |
| 링크+자유형 요약 중심 증적 | commit SHA·PR head SHA·구조화 check·검증 출처 | 변경된 PR이나 위조 링크 승인 방지 |
| 주문 하나에 claim/report 이력 누적 | Work Order와 Run Attempt 분리 | 실패·반려·PC 교체·재시도를 독립 기록하기 위해 |
| 24시간 `claimed_at` 기준 수동 stale | heartbeat lease + fencing, lost 기본 수동 판정 | 정상 장기 작업 오탐과 회수 후 늦은 보고 차단 |
| 의존성·자동 배정 비범위 | 기존 WBS DAG 기반 claim gate를 P2에 도입 | PM 오케스트레이션의 핵심 기능이기 때문 |

### 1.3 채택 원칙

1. 통신은 **로컬 → 서버 outbound only**다. 서버가 개발자 PC에 SSH·원격 데스크톱으로
   진입하는 기능은 만들지 않는다.
2. **Work Order(무엇)**, **Execution Spec(어떤 조건으로)**,
   **Run Attempt(한 번의 실행)**를 분리한다.
3. 서버는 로컬 절대경로, Git credential, LLM API key·로그인 토큰을 저장하지 않는다.
4. 웹은 로컬로 임의 shell 문자열을 전달하지 않는다. Runner가 미리 허용한 named profile만
   선택한다.
5. 작업마다 전용 Git worktree·branch를 사용하며 보호 브랜치를 직접 수정하지 않는다.
6. 에이전트의 완료 보고는 주장이다. 검증된 commit/PR/CI와 사람 승인이 완료의 근거다.
7. 미등록 프로젝트에는 v1과 동일하게 에이전트 기능의 존재를 숨기고 쓰기를 발생시키지 않는다.

---

## 2. 현재 구현 기준선

### 2.1 재사용 가능한 구성요소

| 구현 사실 | 코드 근거 | v2에서의 역할 |
|---|---|---|
| `agent_projects`, `agent_work_orders`, `agent_work_reports` 존재 | `supabase/migrations/0057_agent_work_loop.sql:10-53` | 프로젝트 게이트와 v1 호환 원장 |
| 주문 상태 `ready/claimed/reported/approved/cancelled` | `src/lib/domain/agentWork.ts:5-34` | 비즈니스 상태 projection |
| PM의 발행·승인·반려·회수 액션 | `src/app/actions/agentWork.ts:45-219` | v2 UI 동작의 출발점 |
| ready 조회·claim·report·release·상태 조회 API | `src/app/api/v1/agent/work/**` | v1 호환 API, v2 구현 참고 |
| claim이 조건부 UPDATE로 경합 방지 | `src/app/api/v1/agent/work/[id]/claim/route.ts:24-48` | v2 atomic claim의 최소 기준 |
| `/agent-ops` 상태 보드와 승인 UI | `src/components/agent/AgentOpsView.tsx:16-180` | 프로젝트 관제 화면의 프로토타입 |
| 로컬 Claude CLI 1회 실행 예제 | `scripts/agent-harness-example.mjs:27-69` | AgentAdapter·Runner vertical slice의 참고 |
| WBS FS/SS 의존성과 순환 차단 | `supabase/migrations/0029_task_dependencies.sql:12-108` | claim eligibility와 blocked reason |
| 의존 일정·크리티컬 패스 계산 | `src/lib/domain/dependencySchedule.ts` | 우선순위 추천과 PM 위험 표시 |
| 에이전트 progress의 WBS 반영 경로 | `src/lib/agent/applyProgress.ts:11-49` | v2 전환 시 분리·호환 정책 대상 |

### 2.2 현재 한계와 위험

#### P0 — fleet 개방 전 차단해야 하는 문제

1. **공유 시크릿과 사용자 가장**

   `src/lib/agent/externalApi.ts:10-39`는 모든 호출에 전역 시크릿 하나를 사용하고,
   `src/lib/agent/routeShared.ts:13-20`은 body의 `user_email`과 `agent`를 신뢰한다.
   시크릿을 가진 PC는 다른 구성원 문자열로 요청할 수 있다.

2. **Runner 신원·lease·heartbeat 부재**

   `claimed_by`는 권한 주체가 아닌 자유 문자열이다. `claimed_at` 24시간만으로 stale을
   판정해 정상 장기 작업과 죽은 Runner를 구분하지 못한다.

3. **로컬 Git 격리 부재**

   예제 하네스는 `REPO_DIR`에서 `execFileSync('claude', ...)`를 바로 실행한다.
   dirty tree, 기준 SHA, branch 충돌, 허용 경로, timeout, 취소가 없다.

4. **승인 증적 검증 부재**

   에이전트가 제출한 URL·요약을 저장할 뿐 commit SHA, 저장소 일치, PR head, CI, merge를
   독립 확인하지 않는다.

5. **원자성 부족**

   progress는 WBS 변경 후 report를 insert한다. 승인은 WBS 100% 반영 후 주문 CAS를 한다.
   `src/app/actions/agentWork.ts:123-138`도 반려 경합 시 WBS만 100%가 될 수 있음을 명시한다.

#### P1 — 제품화에 필요한 문제

1. 발행 UI가 WBS UUID 직접 입력 방식이다.
2. 전역 `/agent-ops`라 프로젝트 WBS 문맥과 분리돼 있다.
3. attempt가 없어 재시도·반려·PC 교체의 이력이 섞인다.
4. WBS 의존성이 ready/claim을 막지 않는다.
5. 로그 스트리밍, 실행 단계, 취소, 질문·응답, 구조화 check가 없다.
6. 실행시간·토큰·비용의 측정 출처가 없다.
7. 같은 WBS 리프에 여러 활성 주문이 생길 수 있다.
8. `agent_work_orders.project_id`와 `wbs_item_id`의 동일 프로젝트 관계가 DB FK로 강제되지 않는다.

---

## 3. 범위

### 3.1 목표

- PM이 WBS 리프에서 실행 가능한 개발 명세를 발행한다.
- 두 대 이상의 로컬 PC를 개별 등록·중지·폐기하고 대상 PC 또는 pool에 배정한다.
- Runner가 격리된 worktree에서 Codex·Claude 등의 adapter를 실행한다.
- 실행 단계·heartbeat·질문·검사·실패·취소를 D'Flow에서 관제한다.
- commit/PR/CI를 구조화 증적으로 검증하고 정확한 SHA에 대해 승인한다.
- 승인·반려·재시도·재배정의 감사 이력을 보존한다.
- WBS FS/SS 의존성과 승인 상태로 후속 작업의 실행 가능 여부를 계산한다.
- 미등록 프로젝트와 기존 운영 경로에 무영향임을 자동 테스트로 입증한다.

### 3.2 1차 비범위

- D'Flow 서버에서 LLM을 직접 장시간 실행하는 기능
- 로컬 PC로 inbound SSH·원격 데스크톱 접속
- PM이 웹에서 임의 shell command를 입력하는 기능
- 자동 merge·자동 배포·무인 프로덕션 변경
- 에이전트가 WBS 구조를 직접 생성·삭제하는 기능
- 초기 버전의 무인 WBS 자동 분해·무인 자동 승인
- 서로 신뢰하지 않는 외부 저장소를 host sandbox 없이 실행하는 기능
- 정확한 비용을 제공하지 않는 CLI의 비용을 가격표로 임의 확정하는 기능

---

## 4. 논리 도메인 모델

### 4.1 핵심 객체

#### Work Order — 무엇을 완료할 것인가

기존 `agent_work_orders`를 비즈니스 원장으로 유지한다. WBS 리프, 발행자, 우선순위,
현재 승인 상태를 연결한다. 하나의 Work Order에는 여러 Run Attempt가 생길 수 있다.

#### Execution Spec — 어떤 조건으로 실행할 것인가

발행 당시의 실행 조건을 immutable version으로 저장한다.

- 목표와 추가 지시
- 구조화된 acceptance criteria
- 논리 repository ID, base ref와 선택 시 base SHA
- 허용·금지 변경 경로
- named check profile
- 필요한 Runner capability와 AgentAdapter
- 특정 Runner 또는 pool
- timeout, 최대 attempt, 위험 등급, 승인 정책
- PM이 선택한 WBS·이슈·회의록·위키 context snapshot과 버전

Run Attempt는 반드시 정확한 spec version을 가리킨다. 작업 도중 WBS나 문서가 바뀌어도
이미 시작된 실행의 입력은 소급 변경되지 않는다.

#### Run Attempt — 한 번의 물리적 실행

Runner 한 대가 spec 한 버전을 실행한 단위다. 반려, 재시도, 재배정은 기존 행을 덮어쓰지
않고 attempt를 추가한다. 동일 에이전트 세션을 로컬에서 resume하더라도 서버 감사 단위는
새 attempt로 기록할 수 있다.

#### Runner — 한 로컬 실행 주체

PC 또는 격리 실행 환경 하나를 나타낸다. Runner credential에서 소유 사용자를 서버가
유도한다. `agent` 문자열은 adapter·표시 라벨일 뿐 권한 주체가 아니다.

#### Event / Artifact / Review / Command

- Event: heartbeat, 단계 변경, 제한된 로그, check 결과의 append-only 기록
- Artifact: commit, PR, preview, test report처럼 검토 가능한 결과
- Review: 승인 또는 수정 요청, acceptance checklist, 승인된 immutable SHA
- Command: cancel, PM 답변, 재개처럼 서버에서 Runner로 전달되는 구조화 지시

### 4.2 상태 모델

기존 Work Order 상태는 v1 호환 projection으로 유지한다.

```text
ready → claimed → reported → approved
  │         │          │
  └─────────┴──────────┴→ cancelled
            ↑          │
            └──────────┘ changes requested
```

`blocked`는 저장 상태가 아니라 의존성·계획일·Runner 가용성·정책에서 계산한 availability다.
따라서 차단 원인이 사라지면 별도 수동 전이 없이 ready가 된다.

Run Attempt 상태는 다음과 같다.

```text
leased → preparing → running ↔ awaiting_input → validating → awaiting_review
   │          │          │             │             │              ├→ accepted
   └──────────┴──────────┴─────────────┴──────────────┴──────────────┼→ failed
                                                                    ├→ cancelled
                                                                    ├→ lost
                                                                    └→ changes_requested
```

필수 규칙:

- `accepted`, `failed`, `cancelled`, `lost`, `changes_requested`는 attempt의 종료 상태다.
- 수정 요청 뒤 재작업은 새 attempt를 만든다.
- attempt가 `awaiting_review`가 될 때 Work Order는 `reported`로 projection한다.
- 정확한 SHA가 승인되면 attempt는 `accepted`, Work Order는 `approved`가 된다.
- Runner heartbeat가 끊기면 즉시 다른 PC에서 재실행하지 않고 `lost` 후보로 표시한다.
  부작용이 있는 작업의 자동 중복 실행보다 PM 확인을 기본값으로 한다.

Run 종료 뒤 Work Order projection은 다음처럼 고정한다.

| Run 상태·행위 | Work Order 상태 | 다음 행위 |
|---|---|---|
| `leased`~`validating` | `claimed` | 현재 Runner만 lease 범위에서 계속 실행 |
| `awaiting_review` | `reported` | PM 승인 또는 수정 요청 |
| `accepted` | `approved` | 종료, WBS completion policy 반영 |
| `failed` | `claimed` | PM이 retry 또는 reassign하기 전 예약 유지 |
| `lost` 후보/확정 | `claimed` | reconcile 또는 PM의 명시적 release·reassign |
| `changes_requested` | `claimed` | 같은 Runner 재시도 또는 reassign |
| Run만 중지 | `claimed` | worktree 보존 후 retry·reassign·주문 취소 선택 |
| Work Order 취소 | `cancelled` | active Run에 `cancel_run`, 후속 attempt 금지 |

retry·reassign은 종료 Run을 되살리지 않는다. PM이 retry를 선택하면 Work Order를 `ready`로
되돌리고 target Runner 정책을 적용한 뒤 새 claim이 attempt 번호를 증가시킨다. reassign은 기존
claim과 lease generation을 폐기한 다음 `ready`로 전이한다. 이 projection과 Run insert는 각각
하나의 서버 transaction/RPC로 처리해 `claimed`인데 active/terminal Run의 귀속을 알 수 없는
상태를 만들지 않는다.

---

## 5. 제안 데이터 모델

구현 시 이름은 조정할 수 있지만 아래 무결성은 유지해야 한다. core WBS 테이블에는 컬럼을
추가하지 않고, agent 전용 테이블과 sidecar를 우선한다. 모든 신규 migration은
`_rollback.sql`을 함께 제공한다.

### 5.1 신규 테이블

#### `agent_runner_enrollments`

- `id`, `code_hash`, `created_by`, `expires_at`, `used_at`, `revoked_at`
- 평문 enrollment code는 생성 응답에서 한 번만 노출한다.
- 기본 만료는 10분이며 한 번 사용하면 재사용할 수 없다.

#### `agent_runners`

- `id`, `owner_user_id`, `display_name`
- `credential_hash` 또는 공개키 기반 신원 정보
- `platform`, `runner_version`, `capabilities jsonb`
- `max_concurrency`, `last_seen_at`, `enabled`, `revoked_at`
- 로컬 절대경로와 Git/LLM credential은 저장하지 않는다.

#### `agent_runner_project_grants`

- `runner_id`, `project_id`, `enabled`, `created_by`, timestamps
- 동일 프로젝트 역할을 가진 사용자라도 Runner가 grant되지 않으면 작업을 claim하지 못한다.
- RLS와 서버 가드는 `owner_user_id`와 프로젝트 역할을 함께 검증한다.

#### `agent_runner_repositories`

- `runner_id`, `repository_id`, `enabled`, `available_check_profiles`, `last_verified_at`
- unique `(runner_id, repository_id)`
- 로컬 path 자체는 저장하지 않고, `doctor`와 heartbeat가 논리 repository mapping의 가용 여부만
  보고한다.
- project grant와 repository binding을 모두 만족해야 claim할 수 있다.

#### `agent_repositories`

- `id`, `project_id`, `slug`, `provider`, `remote_url`, `default_branch`
- `policy jsonb`: 허용 profile 이름, 보호 경로, PR 필수 여부 등
- `remote_url`은 정규화해 artifact 저장소 검증에 사용한다.
- 논리 저장소만 서버에 두고 `repository_id → local_path` 매핑은 Runner 로컬 설정에 둔다.

#### `agent_work_specs`

- `id`, `work_order_id`, `version`, `repository_id`
- `goal`, `acceptance_criteria jsonb`, `allowed_paths jsonb`
- `base_ref`, `base_sha`, `check_profile`
- `required_capabilities jsonb`, `target_runner_id`
- `timeout_seconds`, `max_attempts`, `risk_level`, `approval_policy`
- `context_snapshot jsonb`, `created_by`, `created_at`
- unique `(work_order_id, version)`; 생성 후 내용 UPDATE 금지

#### `agent_run_attempts`

- `id`, `work_order_id`, `work_spec_id`, `attempt_no`, `runner_id`
- `status`, `lease_generation`, `lease_expires_at`, `heartbeat_at`
- `adapter`, `model`, `base_sha`, `branch`, `head_sha`
- `started_at`, `finished_at`, `exit_code`, `failure_class`, `failure_summary`
- `supersedes_run_id`, usage 측정값과 측정 출처
- unique `(work_order_id, attempt_no)`

#### `agent_run_events`

- `id`, `run_id`, `client_event_id`, `seq`, `type`, `payload`, `created_at`
- unique `(run_id, client_event_id)`와 `(run_id, seq)`로 재전송을 멱등 처리한다.
- payload 크기 제한과 서버측 비밀 패턴 검사를 둔다.

#### `agent_run_artifacts`

- `id`, `run_id`, `kind`, `url`, `repository_id`, `immutable_ref`, `metadata`
- `verification_status`, `verified_by_source`, `verified_at`
- `kind`: `commit`, `pull_request`, `ci`, `preview`, `test_report` 등

#### `agent_run_reviews`

- `id`, `run_id`, `action`, `note`, `criteria_results jsonb`
- `reviewed_by`, `reviewed_at`, `approved_sha`
- `action`: `approve` 또는 `request_changes`
- approve 시 `approved_sha = run.head_sha`를 원자적으로 검증한다.

#### `agent_run_commands`

- `id`, `run_id`, `type`, `payload`, `issued_by`, `issued_at`, `acked_at`
- `type`: `cancel`, `answer`, `resume`, `pause` 중 실제 지원 항목만 순차 개방한다.
- Runner는 command ID를 멱등 ack한다.

### 5.2 필수 DB 제약

1. Work Order의 `(wbs_item_id, project_id)`가 같은 WBS 행을 가리키도록 복합 FK 또는
   동등한 DB 제약을 둔다.
2. 같은 WBS 리프에 활성 Work Order가 하나만 존재하도록 데이터 감사 후 partial unique
   index를 둔다. 활성의 정확한 범위는 `ready/claimed/reported`다.
3. Run의 Runner가 해당 project grant와 repository binding을 보유하는지 claim RPC에서
   잠금 후 재검증한다.
4. 승인 RPC는 Work Order 상태, Run 상태, approved SHA, 필수 check, reviewer 권한,
   WBS 반영을 한 트랜잭션에서 처리한다.
5. 모든 Runner 재전송 API는 idempotency key 또는 client event ID를 요구한다.
6. agent 전용 테이블의 쓰기는 service role 경유라면 모든 route/action에 서버 가드 테스트가
   있어야 한다. 조회 RLS를 빈 목록 위장 수단으로 사용하지 않는다.

---

## 6. 인증·등록·권한

### 6.1 Enrollment

1. 프로젝트 관리자 이상이 `새 PC 연결`에서 10분짜리 일회용 code를 만든다.
2. 사용자는 로컬에서 `dflow-runner enroll --url <D'Flow> --code <code>`를 실행한다.
3. Runner는 key material, 표시명, 플랫폼, 버전, capability를 제출한다.
4. 서버는 code의 hash·만료·미사용 여부를 원자적으로 확인하고 Runner를 `pending`으로 만든다.
5. 관리자가 프로젝트·repository·동시 실행 수를 승인한 뒤 `enabled`가 된다.
6. 발급 credential은 OS Keychain/자격증명 저장소에 보관하고, 서버에는 hash 또는 공개키만 둔다.

### 6.2 요청 인증

- v2 요청의 사용자 ID는 body가 아니라 Runner credential에서 유도한다.
- credential은 Runner별로 폐기할 수 있어야 한다.
- opaque credential을 쓴다면 예측 불가능한 고엔트로피 값으로 발급하고 hash만 저장하며,
  마지막 사용 시각·회전·만료 정책을 둔다. 모든 통신은 TLS를 전제로 한다.
- run mutation은 Runner credential 외에 현재 `lease_generation` 또는 run-scoped fencing
  token을 검증한다.
- revoked/disabled Runner, grant가 제거된 Runner, 프로젝트 역할을 잃은 owner는 fail-closed다.
- 프로젝트를 `agent_projects.enabled=false`로 바꾸면 신규 claim은 즉시 중지한다.
  실행 중 run의 취소 여부는 PM에게 명시적으로 표시하고 정책에 따라 처리한다.

### 6.3 v1 전환

- v1 API는 초기 전환 동안 호환용으로 유지할 수 있다.
- v2 Runner에는 전역 `AGENT_API_SECRET`을 배포하지 않는다.
- 등록된 모든 Runner가 v2로 전환되고 E2E가 끝난 뒤 v1 외부 API 비활성화를 별도 승인한다.
- v1 비활성화 전까지 보드는 v1 report와 v2 run을 구분해 표시해야 한다.

---

## 7. API v2 계약 초안

정확한 JSON schema는 구현 계획에서 별도 계약 파일로 고정한다. 이 문서는 endpoint의 책임과
원자성 경계를 정의한다.

### 7.1 Runner 관리

| Endpoint | 책임 |
|---|---|
| `POST /api/v2/agent/runners/enroll` | 일회용 code 소비, Runner credential 발급 |
| `POST /api/v2/agent/runners/heartbeat` | Runner 생존·버전·capability·가용 slot 보고 |
| `POST /api/v2/agent/runners/claim-next` | eligible Work Order claim + Run Attempt + lease를 원자 생성 |
| `GET /api/v2/agent/runners/commands?cursor=` | Runner 대상 pause·관리 command 폴링 |

`claim-next`는 v1의 `GET ready → POST claim` 두 단계를 하나의 DB RPC로 합친다. RPC는
프로젝트 grant, repository mapping, capability, target Runner/pool, max concurrency,
WBS dependency와 계획일을 같은 snapshot에서 판정한다. 동시 Runner는 `FOR UPDATE SKIP LOCKED`
또는 동등한 잠금으로 동일 주문을 중복 claim하지 못한다.

### 7.2 Run 실행

| Endpoint | 책임 |
|---|---|
| `POST /api/v2/agent/runs/{id}/heartbeat` | lease 연장과 현재 phase 보고 |
| `POST /api/v2/agent/runs/{id}/reconcile` | 만료 lease의 동일 세대·후속 Run 부재 확인 후 재개 요청 |
| `POST /api/v2/agent/runs/{id}/events:batch` | 멱등 event·제한 로그 업로드 |
| `GET /api/v2/agent/runs/{id}/commands?cursor=` | cancel·PM 답변·resume 지시 조회 |
| `POST /api/v2/agent/runs/{id}/complete` | head SHA·branch·artifact·check 결과 제출, review 대기 전이 |
| `POST /api/v2/agent/runs/{id}/fail` | 구조화 failure class와 retryability 제출 |
| `POST /api/v2/agent/runs/{id}/commands/{commandId}/ack` | command 적용 결과 멱등 확인 |

필수 공통 규칙:

- stale lease generation의 write는 `409 stale_lease`로 거절한다.
- event와 완료·실패 보고는 idempotency key를 지원한다.
- Run이 종료 상태면 후속 write는 멱등 동일 응답 또는 명시적 `409`여야 하며 조용히 덮어쓰지 않는다.
- 조회 실패를 `없음`으로 위장하지 않고 500과 서버 로그로 구분한다.
- body와 event의 크기, 빈도, URL scheme, artifact host를 제한한다.

lease 시간 초과만으로 Work Order를 자동 `ready`로 만들지 않는다. 만료 뒤 Runner는 일반 event나
completion을 제출할 수 없고 `reconcile`만 요청할 수 있다. 서버는 lease generation이 바뀌지
않았고, 더 최신 attempt·PM 취소·재배정이 없을 때만 lease를 재발급한다. PM이 lost 확정 또는
reassign하면 generation을 증가시켜 과거 Runner의 모든 write를 영구 차단한다.

### 7.3 Git provider webhook

GitHub/GitLab 연동 시 webhook은 에이전트 주장과 독립된 검증 채널이다.

- webhook 서명 검증 필수
- repository ID와 remote URL 일치 검증
- PR head SHA, CI conclusion, merge SHA 저장
- 승인 후 PR head가 바뀌면 기존 승인을 무효화
- merge 기반 완료 정책이면 merge 확인 전 WBS 100% 금지

provider 연동이 없는 MVP에서는 PM이 immutable commit을 직접 확인할 수 있어야 하며,
artifact는 `unverified`임을 숨기지 않는다.

---

## 8. Local Runner 설계

### 8.1 구현 형태

1차는 현재 TypeScript/Node 생태계를 재사용한 별도 CLI package를 권장한다. 위치 후보는
`tools/dflow-runner` 또는 독립 repository다. 제품 안정화 전까지 한 저장소에 두면 API 타입과
테스트를 공유하기 쉽고, 배포·권한 경계가 필요해지면 분리한다.

최소 명령:

```text
dflow-runner enroll
dflow-runner doctor
dflow-runner start
dflow-runner run-once      # 개발·E2E 전용
dflow-runner status
```

`doctor`는 Agent CLI 설치·로그인 여부, Git remote, repository mapping, worktree 가능 여부,
named checks, credential 저장소를 검사하되 비밀값을 출력하지 않는다.

### 8.2 로컬 설정

Runner 로컬 설정은 다음 논리 정보를 가진다.

- D'Flow server URL과 Runner ID
- 논리 `repository_id → local clone path` 매핑
- repository별 허용 base branch
- named check profile과 실제 command 매핑
- adapter별 실행 가능 여부와 동시 실행 수
- worktree root, timeout 상한, 로그 보존 정책

credential은 설정 파일과 분리해 OS credential store에 둔다. 서버가 보낸 raw command를
실행하는 설정은 제공하지 않는다.

### 8.3 AgentAdapter

Codex, Claude 등 CLI 차이는 다음 책임을 가진 adapter 뒤에 둔다.

```ts
interface AgentAdapter {
  probe(): Promise<AdapterCapabilities>
  run(input: RunInput, sink: EventSink, signal: AbortSignal): Promise<RunResult>
  resume?(input: ResumeInput, sink: EventSink, signal: AbortSignal): Promise<RunResult>
}
```

- 첫 vertical slice는 adapter 하나만 구현한다.
- 기존 예제를 가장 빨리 재사용하려면 Claude adapter가 유리하지만, 제품의 1차 대상은 사용자
  선택으로 확정한다(§17 D-01).
- adapter가 provider usage를 주지 않으면 token/cost를 `0`으로 기록하지 않고 `unknown`으로 둔다.

### 8.4 작업 디렉터리와 Git

Runner는 사용자 활성 checkout에서 코딩 에이전트를 실행하지 않는다.

```text
local clone
  └─ runner-managed worktree/<run-id>
       └─ branch: dflow/<wbs-code>/<short-run-id>
```

필수 순서:

1. repository mapping과 remote 정규화 검증
2. `git fetch`와 base ref/base SHA 확인
3. Runner 관리 worktree·고유 branch 생성
4. 고정 policy envelope + Execution Spec으로 prompt 구성
5. adapter 비동기 실행, heartbeat와 event 전송
6. 변경 경로·보호 파일·secret pattern 검사
7. 로컬 named checks 실행
8. commit 생성, 정책에 따라 push·PR 생성
9. 구조화 결과 제출
10. 승인 전 worktree 유지; 승인 후 정책에 따라 명시적으로 정리

실패·반려 worktree는 즉시 삭제하지 않는다. 재현·수정 요청에 필요하며, 보존 기간이 지난 뒤
Runner가 후보를 표시하고 명시적 정책으로 정리한다.

### 8.5 프로세스·취소·버퍼링

- 동기 `execFileSync` 대신 자식 프로세스를 비동기로 실행한다.
- timeout 또는 cancel 시 process group 전체에 종료 신호를 보내고 결과를 확인한다.
- Runner process와 Agent process를 분리해 Agent가 바빠도 heartbeat가 멈추지 않게 한다.
- 네트워크 단절 시 event를 크기 제한 로컬 spool에 보관한다.
- 서버가 불명확한 동안 새 작업은 시작하지 않는다. 실행 중 작업은 로컬 정책에 따라 안전 지점까지
  진행할 수 있지만, reconnect 후 lease reconciliation 전에는 push·completion 같은 외부 부작용을
  제한하는 것을 권장한다.
- 서버 장애로 lease가 만료됐다고 자동으로 동일 작업을 다른 Runner에 배정하지 않는다.

### 8.6 로컬 sandbox

코딩 에이전트와 repository test는 사실상 임의 코드를 실행할 수 있다. 따라서:

- MVP host 모드는 **명시적으로 신뢰된 내부 repository와 신뢰된 발행자**만 지원한다.
- sandbox 모드에서는 `.env*`, SSH key, OS credential store, 다른 project path를 mount하거나
  prompt로 제공하지 않는다.
- prompt의 금지 지시만으로 비밀 접근을 막았다고 간주하지 않는다.
- 외부·비신뢰 repository 지원 전에는 container 또는 OS sandbox, filesystem allowlist,
  network policy를 필수 선행 설계로 둔다.

중요하게, 일반 사용자 권한으로 직접 실행하는 host 모드의 deny-path 검사는 **변경·commit·업로드
검출 장치일 뿐 읽기 접근을 강제 차단하지 못한다**. 같은 OS 사용자가 읽을 수 있는 다른 파일까지
보호한다고 주장해서는 안 된다. 비밀이 존재하는 PC에서 무인 실행하거나 WBS/context 발행자를
완전히 신뢰할 수 없다면 P1에서도 sandbox 모드를 필수로 선택해야 한다.

---

## 9. 실행 명세와 Prompt 경계

### 9.1 WBS 발행 drawer

리프 항목에서 다음을 입력한다.

- 목표: WBS 이름·업무내용·산출물에서 초안 자동 채움
- acceptance criteria: 개별 체크 가능한 문장 배열
- repository와 base branch
- 변경 허용 경로
- 실행 대상: 자동 pool 또는 특정 Runner
- AgentAdapter와 named check profile
- timeout·최대 attempt·위험 등급
- 선택한 이슈·회의록·위키·첨부 context

발행 전 readiness lint는 최소한 repository, acceptance criteria 1개, 실행 가능한 Runner 또는
pool, 유효 check profile, 선행 의존성 상태를 검사한다. 차단돼도 예약 발행은 가능하되 차단 이유를
명시한다.

### 9.2 Prompt envelope

Runner가 만드는 prompt는 다음 우선순위를 고정한다.

1. Runner 보안 정책과 금지 경로
2. repository의 version-controlled agent policy
3. 검증 profile과 산출물 계약
4. Execution Spec
5. WBS·문서 context

WBS 지시와 첨부 문서는 **untrusted data**다. 문서 안의 “보안 정책을 무시하라”, “다른
디렉터리의 credential을 읽어라” 같은 내용은 상위 policy를 바꿀 수 없다. 실제 차단은 prompt
문구가 아니라 filesystem·sandbox·command allowlist로 집행한다.

### 9.3 Context snapshot

- PM이 명시적으로 선택한 source만 포함한다.
- source ID, version/update timestamp, 발췌 범위와 생성 시각을 저장한다.
- 프로젝트 권한을 잃은 Runner는 snapshot을 조회할 수 없다.
- 개인 정보와 secret pattern을 전송 전에 검사한다.
- 실행 뒤 source가 바뀌어도 과거 Run의 입력 snapshot은 감사용으로 식별 가능해야 한다.

---

## 10. Scheduler와 WBS 의존성

### 10.1 Eligibility

Work Order가 claim 가능하려면 모두 참이어야 한다.

1. 프로젝트의 agent loop가 enabled다.
2. Work Order가 `ready`이고 활성 중복 주문이 없다.
3. 현재 spec이 존재하고 readiness lint를 통과했다.
4. planned start와 프로젝트 정책이 실행을 허용한다.
5. 모든 FS predecessor가 승인 정책상 완료됐다.
6. 모든 SS predecessor가 실제 실행 시작 조건을 만족했다.
7. Runner가 project grant, repository mapping, capability, 가용 slot을 가진다.
8. target Runner가 지정됐다면 호출 Runner와 일치한다.
9. 프로젝트 예산·일시정지 정책이 신규 claim을 허용한다.

`blocked` 응답은 빈 ready 목록으로 숨기지 않고 `dependency`, `no_runner`, `planned_start`,
`policy_pause`, `budget` 등의 결정형 reason을 PM 화면에 제공한다.

### 10.2 우선순위

MVP 기본 순서는 명시 priority → 계획 시작일 → FIFO다. 크리티컬 패스, 지연 위험, Runner
부하는 P2에서 **추천 점수**로 추가할 수 있다. LLM이 claim 순서를 직접 결정하지 않고,
결정형 scheduler가 근거를 남긴다.

### 10.3 FS/SS 의미

- FS: predecessor의 승인 또는 configured completion gate 뒤 successor claim 허용
- SS: predecessor의 active Run이 `running`에 도달한 뒤 successor claim 허용
- lag: 기존 WBS 영업일 계산을 재사용하며, 실행 gate와 표시 일정의 기준 날짜를 명시한다.
- PM override는 관리자 이상만 가능하고 사유·행위자를 감사 기록으로 남긴다.

### 10.4 충돌 관리

동시에 실행할 spec의 `allowed_paths`가 겹치면 경고한다. MVP는 PM이 의존성을 추가하거나
병렬 실행을 승인하게 한다. 자동 path lock·merge queue는 P2 이후 후보이며, WBS 의존성만으로
코드 충돌이 없다고 가정하지 않는다.

---

## 11. Progress, 검증, 승인

### 11.1 실행 telemetry와 WBS 공정률 분리

Run phase, elapsed time, check 수, agent가 보고한 추정치는 실행 telemetry다. 기본 정책에서
`wbs_items.actual_pct`를 변경하지 않는다. PM이 정확한 SHA와 acceptance criteria를 승인하고
프로젝트의 completion policy가 충족될 때만 WBS 100%를 반영한다.

중간 WBS 공정률이 반드시 필요하면 agent 자유 퍼센트 대신 결정형 stage mapping을 별도 정책으로
도입한다. 예: 준비 10, 구현 완료 60, 필수 검사 통과 85, review 대기 90. 이 경우에도
기존 실적보다 낮아지지 않는 단조 증가와 `에이전트 추정` 표기가 필수다.

### 11.2 구조화 check

각 check 결과는 최소 다음을 가진다.

- profile/check ID와 표시명
- 시작·종료·duration
- exit code와 `passed/failed/skipped`
- 출력의 제한·redacted summary
- 실행한 base/head SHA
- Runner ID와 Runner version

필수 check가 실패·누락되면 `awaiting_review`로 전이하지 않는 것이 기본이다. 관리자의 override는
고위험 행위로 분류하고 사유를 남긴다.

### 11.3 승인 원자성

승인 RPC는 한 트랜잭션에서 다음을 검증·수행한다.

1. reviewer가 프로젝트 관리자 이상이다.
2. Work Order와 Run이 각각 승인 가능한 상태다.
3. `run.head_sha`가 review의 `approved_sha`와 일치한다.
4. repository·branch·필수 artifact와 check가 정책을 만족한다.
5. provider 연동 시 PR head가 동일하고 요구 CI가 통과했다.
6. review 기록, Run `accepted`, Work Order `approved`, WBS 100%, change log를 함께 반영한다.
7. progress snapshot을 같은 transaction에서 만들 수 없으면 snapshot outbox를 transaction 안에
   기록하고 재시도 worker가 처리한다. snapshot 실패를 조용히 삼키지 않는다.
8. 어느 하나라도 실패하면 전체 rollback하고 review 대기 상태를 보존한다.

승인 뒤 PR head가 변경되면 merge 전 승인을 무효화한다. merge 완료를 completion gate로 쓰는
프로젝트는 merge webhook 확인 뒤에만 WBS 100%를 반영한다.

### 11.4 수정 요청

- 사유와 실패한 acceptance criterion이 필수다.
- 기존 Run을 `changes_requested`로 종료한다.
- 같은 Runner·세션을 resume할지 다른 Runner로 재배정할지 PM이 선택한다.
- 다음 실행은 attempt 번호를 증가시키고 이전 Run과 `supersedes_run_id`로 연결한다.

---

## 12. UI/UX

### 12.1 WBS 상세

`src/components/wbs/RowDetailPanel.tsx`에 리프 전용 `개발 실행` 섹션을 추가한다.

- `개발 에이전트에 맡기기`
- 현재 availability와 차단 이유
- `PC-A · 실행 중 · 테스트 단계` 같은 최신 Run 요약
- attempt 수, 최근 활동, PR/check 상태
- `관제에서 열기`

비리프에는 직접 실행 대신 하위 리프 선택·일괄 발행 후보를 보여준다. 자동 분해는 제안만 하며
PM 승인 전 WBS를 변경하지 않는다.

### 12.2 프로젝트 Agent Ops

권장 route는 `/p/[projectId]/agent-ops`다. 기존 `/agent-ops`는 전환 기간 redirect 또는
프로젝트 선택 허브로 유지한다. 전역 사이드바 변경은 `CLAUDE.md`의 UI 브랜치·Preview 규칙을
별도로 따른다.

탭:

- **작업**: Blocked / Ready / Running / Review / Done
- **승인**: acceptance criteria와 immutable artifact 중심 검토 대기열
- **Runner**: Online / Busy / Offline / Revoked, 버전, capability, 현재 Run
- **정책**: approval, timeout, attempts, log retention, provider 연동

상단 지표:

- 연결 Runner 수와 offline 수
- 실행 중, 차단, 승인 대기, 실패·lost
- 오늘 wall time와 측정 가능한 usage
- critical path에 영향을 주는 blocked/failed 작업

### 12.3 Run 상세

- WBS breadcrumb와 원본 이동 링크
- spec version과 context source
- Runner, adapter/model, branch, base/head SHA
- phase timeline과 heartbeat
- 제한·redacted 로그
- check 목록과 실행 SHA
- commit/PR/CI/preview artifact와 검증 상태
- attempt 전환
- cancel, 답변, 재시도, 재배정, 승인, 수정 요청

외부 CLI가 비용 정보를 제공하지 않으면 `0원`이 아니라 `비용 미제공 · 실행 18분`처럼 표시한다.

### 12.4 알림

- approval 대기
- Runner offline/lost
- 필수 check 실패
- critical path 작업 차단
- 수정 요청 후 장기 미응답

알림은 기존 앱 알림 체계에 통합하되 동일 사건의 중복 알림을 idempotency key로 억제한다.

---

## 13. 실패·재시도·복구

| 상황 | 기본 동작 | 자동 재시도 |
|---|---|---|
| claim 경합 | 한 Runner만 성공, 나머지 409 후 다음 작업 조회 | 가능 |
| 일시 네트워크 오류 | event 로컬 spool, backoff 후 재전송 | 가능 |
| 서버 장기 장애 | 신규 작업 중지, 실행 Run은 reconcile 전 외부 부작용 제한 | 자동 재배정 금지 |
| Agent process crash | Run `failed`, worktree 보존, failure class 기록 | PM 정책에 따라 |
| lint/test/build 실패 | 구조화 check 실패와 요약 보고 | 기본 수동 |
| Runner heartbeat 만료 | `lost` 후보, fencing으로 늦은 write 차단 | 기본 수동 |
| PM cancel | command 전달, process group 종료 확인, `cancelled` | 불가 |
| 수정 요청 | Run 종료, 새 attempt 생성 | PM 선택 |
| Git push/PR 실패 | 로컬 commit과 worktree 보존, retryable infra failure | 제한적 가능 |
| base branch 전진·충돌 | 자동 강제 덮어쓰기 금지, rebase/merge 정책에 따라 새 attempt | 기본 수동 |
| completion 재전송 | 동일 idempotency key면 동일 결과 | 멱등 |

자동 재시도는 network timeout처럼 부작용이 없거나 멱등성이 입증된 infra failure에 한정한다.
코드 오류, 테스트 실패, lost Runner, 충돌은 중복 변경을 피하기 위해 PM 판단을 기본으로 한다.

---

## 14. 보안 위협 모델

| 위협 | 필수 통제 | 검증 방법 |
|---|---|---|
| 한 PC credential 유출 | Runner별 credential, 즉시 revoke, project grant scope | 폐기 후 모든 endpoint 401/403 |
| 다른 사용자 가장 | body의 `user_email` 미사용, credential owner 서버 유도 | 다른 이메일을 넣어도 actor 불변 |
| replay·늦은 보고 | idempotency + lease generation/fencing | 회수 전 token으로 mutation 409 |
| 교차 프로젝트 claim | Runner grant + project role + repository binding 재검증 | 다른 project/order ID 403/404 |
| 웹 command injection | raw shell 금지, named local profile만 허용 | 악성 profile 이름·payload 400 |
| WBS prompt injection | 고정 policy envelope; hard 차단은 sandbox filesystem/network policy | sandbox E2E 차단, host 모드는 잔여 위험 명시 |
| 사용자 checkout 훼손 | Runner 관리 worktree·고유 branch | dirty 활성 checkout 무변경 확인 |
| 보호 파일·비밀 유출 | deny paths, secret scan, redaction, 최소 mount | `.env`, SSH key 접근·로그 업로드 차단 |
| 에이전트의 artifact 위조 | provider webhook·remote·SHA·CI 독립 검증 | 잘못된 repo/SHA 승인 거절 |
| 승인 뒤 PR 변경 | approved SHA 고정, head 변경 시 승인 무효 | head 변경 webhook 시 review invalid |
| service role 우회 | 모든 action/route 서버 가드 + 부정 테스트 | viewer/member/admin 매트릭스 |
| 비신뢰 repository code 실행 | MVP trusted-only, 이후 sandbox/network policy | 비신뢰 repo 등록 차단 |
| 로그의 개인정보·secret 보존 | 서버 redaction, payload 제한, retention 삭제 | seed secret 미저장 검사 |

현재 앱은 service role 쓰기 경로에서 서버 가드가 유일한 관문이므로 route별 권한 부정 테스트는
선택이 아니라 필수다.

---

## 15. 관측성과 비용

### 15.1 필수 지표

- Runner online/busy/offline, 마지막 heartbeat, version 분포
- queue wait, execution wall time, review wait
- 성공·실패·lost·cancel·changes requested 비율
- attempt 수와 재작업률
- check별 실패율과 duration
- WBS critical path에서 agent 작업이 차지하는 blocked time

### 15.2 비용 표현

- CLI가 제공한 값은 `provider_reported`
- 추정식으로 계산한 값은 `estimated`와 식별 가능한 가격표 버전을 함께 저장
- 제공되지 않은 값은 `unknown`
- `unknown`을 0으로 합산하지 않는다.
- MVP hard limit은 모든 adapter에서 측정 가능한 wall-time과 max attempts를 우선 사용한다.

### 15.3 로그 보존

전체 원문 로그를 무기한 서버에 저장하지 않는다. 기본은 phase/event, 제한된 tail, 구조화 check와
artifact다. 보존 기간·최대 크기·redaction 정책은 프로젝트 설정으로 두고, 삭제 후에도 상태 전이와
감사 메타데이터는 남긴다.

---

## 16. 구현 단계와 수용 기준

### P0 — v1 사실 확인과 안전성 보강

- 0057 적용 여부를 전용 샘플 프로젝트에서 확인
- 발행→claim→completion→승인 v1 E2E 재현
- 공유 시크릿·원자성·중복 주문·교차 project 관계에 대한 실패 테스트 추가
- WBS UUID 직접 입력을 현재 선택 리프 바인딩으로 교체하는 설계 확정
- v1과 v2 migration/호환 경계 확정

수용 기준: 운영 D-CUBE 미등록 상태에서 모든 agent endpoint가 무변경·fail-closed이며, 기존
테스트가 회귀 없이 통과한다.

### P1 — 단일 Runner vertical slice

- 일회용 enrollment와 Runner별 credential
- 프로젝트 1개, repository 1개, adapter 1개
- atomic claim, heartbeat, lease/fencing
- 전용 worktree/branch, timeout, cancel
- phase/event, named check, commit artifact
- WBS 상세 발행과 Run 상세 관제
- 수정 요청 후 attempt #2

수용 기준: 로컬 PC 한 대에서 정상 완료, 테스트 실패, cancel, 네트워크 재전송, 수정 요청을
재현하고 활성 사용자 checkout이 바뀌지 않는다.

### P2 — 다중 PC fleet MVP

- PC별 project/repository grant와 revoke
- 특정 Runner와 pool 배정, max concurrency
- FS dependency gate와 blocked reason
- 재시도·재배정·lost 처리
- PR/CI 구조화 artifact와 가능한 provider 검증
- approval transaction과 WBS 100% 반영
- 프로젝트 Agent Ops·알림

수용 기준: **PC 2대 이상에서 Work Order 10건 이상**을 실행하며 claim 경합, 한 PC offline,
재배정, 반려·재작업, 승인까지 완주한다. 중복 branch·중복 WBS 완료·stale write가 없어야 한다.

### P3 — PM 오케스트레이션

- SS·lag와 batch DAG 실행
- critical path·Runner load 기반 결정형 배정 추천
- 이슈·회의록·위키 context pack
- 상위 요구를 하위 WBS로 분해하는 승인형 제안
- 개발→리뷰→QA 역할 pipeline
- capacity·비용·재작업 분석

수용 기준: 자동 제안은 근거와 변경 preview를 제공하며, PM 승인 전 WBS·실행 상태를 바꾸지 않는다.

---

## 17. 미결정 사항

아래는 구현 전에 사용자 또는 기술 검증으로 확정해야 한다.

| ID | 질문 | 권장 기본값 |
|---|---|---|
| D-01 | 첫 AgentAdapter는 무엇인가 | 기존 하네스 재사용이면 Claude, 실제 주 사용 CLI가 Codex면 Codex |
| D-02 | Runner를 이 repository package로 둘 것인가 | P1은 `tools/dflow-runner`, 안정화 뒤 독립 배포 검토 |
| D-03 | 첫 Git provider는 무엇인가 | 실제 운영 remote 기준 하나만 먼저 지원 |
| D-04 | WBS 100% 시점은 PM 승인인가 merge 확인인가 | 개발 프로젝트 기본은 검증된 merge, provider 없는 환경은 SHA 승인 |
| D-05 | wake-up transport는 무엇인가 | 5초 내외 polling으로 시작, Supabase Realtime은 최적화 |
| D-06 | lease/heartbeat 기본값은 무엇인가 | heartbeat 30초, lease 90초를 부하·장애 E2E로 검증 후 확정 |
| D-07 | 외부 repository sandbox를 언제 필수화할 것인가 | MVP trusted-only, 외부 repo 개방 전 필수 |
| D-08 | 로그 보존 기간·최대 용량은 무엇인가 | 원문 최소화, 제한 tail 7일 후보를 보안 검토 후 확정 |
| D-09 | v1 progress 자동 반영을 언제 중단할 것인가 | v2 프로젝트부터 기본 off, 기존 프로젝트는 명시적 migration |
| D-10 | 수정 요청 때 같은 세션 resume를 보장할 것인가 | adapter가 지원할 때만, 서버 attempt는 항상 새로 생성 |

---

## 18. 다른 에이전트를 위한 검증 요청문

다음 블록을 그대로 검증 에이전트에게 전달할 수 있다.

```text
대상 문서:
docs/superpowers/specs/2026-08-04-agent-control-plane-v2-design.md

기준 코드:
main@dacc831bd938

작업:
1. 문서 §2의 현재 구현 주장을 코드와 대조하라.
2. 인증, 권한, claim 경합, lease/fencing, 네트워크 단절, cancel, 반려/재시도,
   Git artifact 검증, WBS 반영 원자성에서 닫히지 않은 흐름을 찾아라.
3. 로컬 PC에서 임의 코드가 실행된다는 위협 모델이 충분한지 공격자 관점으로 검토하라.
4. 제안 스키마와 상태 모델에서 구현 불가능·중복·모순인 부분을 찾아라.
5. 기존 v1, 미등록 프로젝트, 운영 D-CUBE 무영향 주장을 반증하려 시도하라.
6. P1/P2 수용 기준이 자동 또는 재현 가능한 테스트로 판정 가능한지 검토하라.
7. 문서를 수정하지 말고 아래 형식으로 결과를 제출하라.

출력 형식:
- Verdict: ACCEPT | ACCEPT_WITH_CHANGES | REJECT
- Blockers: 안전·정합성 때문에 구현 전에 반드시 고칠 항목
- Major: 구현 비용·운영성·요구사항의 큰 결함
- Minor: 명료성·명명·후속 보완
- Fact-check: 각 현재 구현 주장에 대한 파일:행 근거
- State-machine audit: 도달 불가·탈출 불가·경합 상태
- Threat-model audit: 공격 시나리오 → 현재 통제 → 남은 위험
- Missing tests: 실패를 재현하는 Given/When/Then
- Open decisions: D-01~D-10 권고와 근거
- Minimal amendments: 문서에 필요한 최소 수정안

규칙:
- 각 Blocker/Major는 문서 절과 코드 파일:행 또는 구체적 실행 시나리오를 인용한다.
- 취향 차이와 안전·정합성 결함을 구분한다.
- 아직 구현되지 않았다는 사실 자체를 결함으로 세지 말고, 설계의 구현 가능성을 평가한다.
- 근거 없이 '좋다/안전하다'고 결론내리지 않는다.
```

### 18.1 검증 완료 조건

- 서로 독립적인 검증 1회 이상
- Blocker 0건 또는 모든 Blocker에 대한 문서 수정·사용자 결정
- §2 사실 주장에 대한 반증 없음
- 상태 머신과 승인 transaction의 경합 시나리오 합의
- D-01, D-03, D-04, D-05, D-06 확정
- P1 vertical slice의 테스트 가능성 확인

---

## 19. 기각한 접근

| 접근 | 기각 이유 |
|---|---|
| D'Flow/Vercel에서 코딩 에이전트 직접 실행 | 장시간·로컬 repo·사용자 CLI 로그인·serverless 제약과 충돌 |
| 서버가 개발자 PC로 inbound 접속 | 사내망·방화벽·보안·운영 복잡도 증가 |
| 모든 PC가 전역 시크릿 공유 | 개별 폐기·귀속·최소 권한 불가 |
| 사용자 활성 checkout에서 직접 실행 | dirty tree·동시 작업·사용자 변경 훼손 위험 |
| 웹에서 raw shell command 전달 | PM 입력·계정 탈취가 로컬 RCE로 직결 |
| 에이전트 자유 퍼센트를 WBS 공정률로 사용 | 검증 불가능한 자기보고가 PM 기준선을 오염 |
| Work Order 한 행에 모든 재시도 누적 | attempt·PC 교체·승인 대상 SHA 감사 불가 |
| heartbeat 만료 즉시 다른 PC 자동 실행 | 원 Runner가 살아 있을 때 중복 부작용·중복 PR 발생 |
| URL·요약만 보고 자동 승인 | artifact 위조·PR head 변경·CI 실패를 식별하지 못함 |

---

## 20. Definition of Done

이 설계의 구현 완료는 기능 시연만으로 선언하지 않는다. 다음이 모두 필요하다.

1. P2 수용 기준의 두 PC·10개 Work Order E2E 통과
2. Runner credential revoke, cross-project 접근, stale lease, replay 부정 테스트 통과
3. 활성 checkout 무변경과 worktree/branch 격리 증명
4. 필수 check 실패·PR head 변경·위조 SHA 승인 차단
5. 승인 transaction의 부분 반영 0건
6. offline/lost/cancel/반려/재배정의 감사 이력 보존
7. 미등록 운영 프로젝트 agent endpoint 무영향 회귀
8. Runner와 서버 버전 호환 실패의 명시적 표시
9. 로그·artifact retention과 secret redaction 검증
10. 운영 runbook: Runner 등록·폐기·업데이트·장애 복구·v1 rollback

이 조건을 만족한 뒤에만 자동 분해, 자동 승인, 자동 merge·배포 같은 자율성 확대를 별도
설계로 검토한다.
