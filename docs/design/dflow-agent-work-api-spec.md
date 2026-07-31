# D'Flow 에이전트 작업 API 계약 v1.0

## 1. 개요

### 아키텍처

```
사람(PM)                    D'Flow (관제탑)                     외부 에이전트
  │                            │                                  │
  ├─ WBS 리프에서 작업 발행 ──→ agent_work_orders (ready)          │
  │                            │ ←──── GET ready 목록 조회 ────────┤
  │                            │ ←──── POST claim (점유, CAS) ─────┤
  │                            │            (에이전트가 리포에서 작업 수행)
  │                            │ ←──── POST report (중간 진척) ────┤
  │                            ├─ WBS 실적 자동 반영 (99%까지)      │
  │                            │ ←──── POST report (완료 요청) ────┤
  ├─ 승인/반려 (증적 확인) ──→ ├─ 승인 시 WBS 100% 반영            │
  │                            │ ←──── GET 상태 폴링 (반려 사유) ───┤
```

### 완성 인지 원칙

외부 에이전트(CLI·LLM)는 로컬 리포에서 작업을 수행하고, D'Flow 는 웹에서만 관제한다. 이 간극을 메우는 원칙:

1. **Outbound-only 통신** — 에이전트가 API를 폴링·호출할 뿐, D'Flow는 로컬로 접근하지 않는다.
2. **보고가 유일한 완성 인지 채널** — 완료는 반드시 `completion` 보고로 신호해야 한다. 침묵은 멈춤으로 본다.
3. **진실 원천은 git** — 승인자는 보고의 링크(커밋/PR)로 실물을 확인한다. 요약·자체검증은 판단 보조.
4. **다중 개발자 식별** — 각 에이전트는 `user_email`(권한 대상) + `agent`(식별 라벨)로 보고. CAS 가 중복 수행을 막는다.

---

## 2. 인증

### 게이트

- **필수 환경 변수**: `AGENT_API_ENABLED === 'true'` 및 `AGENT_API_SECRET` 모두 설정
  - 미설정 시 모든 엔드포인트 404 (존재 은닉)
- **요청 헤더**: `Authorization: Bearer <AGENT_API_SECRET>`
  - 상수시간 비교. 실패 시 401
- **요청 바디 공통 필드** (쓰기 엔드포인트)
  ```json
  {
    "user_email": "dev@example.com",
    "agent": "claude-cli-dev1"
  }
  ```
  - `user_email`: 필수. D'Flow 실제 계정 이메일. 권한 판정 대상.
  - `agent`: 필수. 에이전트 이름. 형식: 영숫자·`.`·`_`·`-` 1~64자. 식별 라벨일 뿐 권한 주체 아님.

### 권한 판정

- 기존 3단 권한 축 재사용 (슈퍼유저/관리자/멤버)
- 조건: **해당 프로젝트의 멤버 이상**일 것
- 미충족 시 403 `forbidden_role`

### 프로젝트 게이트

- 대상 프로젝트가 `agent_projects` 에 **등록되지 않음** 또는 `enabled=false` → 404
- 존재 은닉 (미등록 프로젝트의 데이터를 노출하지 않음)

---

## 3. 엔드포인트

### 3.1 GET /api/v1/agent/work?project_id=\<uuid>

ready 상태 작업 목록 조회.

**쿼리 파라미터**
| 이름 | 타입 | 필수 | 설명 |
|---|---|---|---|
| `project_id` | UUID string | ✓ | 프로젝트 ID |

**응답 200 OK**
```json
{
  "ok": true,
  "orders": [
    {
      "id": "550e8400-e29b-41d4-a716-446655440000",
      "status": "ready",
      "priority": 10,
      "instructions": "React 컴포넌트 추가. 기존 스타일 시스템 따를 것.",
      "claimed_by": null,
      "claimed_at": null,
      "wbs_item_id": "22220000-e29b-41d4-a716-446655440001",
      "item": {
        "id": "22220000-e29b-41d4-a716-446655440001",
        "code": "WBS-001",
        "name": "로그인 페이지 구현",
        "biz": "사용자 인증 플로우 확립",
        "deliverable": "로그인 폼 컴포넌트 + 테스트",
        "planned_start": "2026-07-20T00:00:00Z",
        "planned_end": "2026-07-25T23:59:59Z"
      }
    }
  ]
}
```

**에러**
| 코드 | 상태 | 원인 |
|---|---|---|
| `validation_failed` | 400 | project_id 누락 또는 형식 오류 |
| `unauthorized` | 401 | Bearer 토큰 누락/불일치 |
| (프로젝트 미등록) | 404 | — |
| (내부 오류) | 500 | DB 조회 실패 |

---

### 3.2 POST /api/v1/agent/work/{id}/claim

작업 점유 선언. 상태전이 `ready → claimed` (CAS).

**요청 바디**
```json
{
  "user_email": "dev@example.com",
  "agent": "claude-cli-dev1"
}
```

**응답 200 OK**
```json
{
  "ok": true,
  "status": "claimed"
}
```

**응답 409 Conflict** (다른 에이전트가 이미 점유했거나 상태가 ready가 아님)
```json
{
  "error": "이미 다른 에이전트가 점유했거나 점유 불가 상태입니다.",
  "code": "conflict",
  "status": "claimed"
}
```

**에러**
| 코드 | 상태 | 원인 |
|---|---|---|
| `validation_failed` | 400 | 경로 id 형식 오류 또는 요청 바디 파싱 실패 |
| `unauthorized` | 401 | Bearer 토큰 오류 |
| `unknown_user` | 403 | user_email 이 D'Flow 계정 아님 |
| `forbidden_role` | 403 | 그 프로젝트의 멤버 아님 |
| (작업 미등록 또는 프로젝트 미등록) | 404 | — |
| `conflict` | 409 | 상태 전이 불가 (이미 다른 에이전트 점유 등) |
| (내부 오류) | 500 | — |

---

### 3.3 POST /api/v1/agent/work/{id}/report

진척 보고 또는 완료 신호.

> **중요**: `progress` 보고는 호출 즉시 WBS 항목의 실적(`actual_pct`)에 반영된다(아래 "WBS 반영" 참고).
> 실패 상황에서 `percent: 0` 을 보고하면 그 즉시 기존 실적을 0 으로 덮어써 버린다 — 하네스가 실패를
> 신호하려면 `progress` 보고 없이 release 만 호출해야 한다(§5, §7 참고).

**요청 바디**
```json
{
  "user_email": "dev@example.com",
  "agent": "claude-cli-dev1",
  "kind": "progress",
  "percent": 50,
  "summary": "기본 구조 구현 완료. 스타일링 진행 중.",
  "links": [
    { "url": "https://github.com/org/repo/commit/abc123" },
    { "url": "https://github.com/org/repo/pull/99", "label": "PR #99" }
  ]
}
```

**필드**
| 이름 | 타입 | 필수 | 범위 | 설명 |
|---|---|---|---|---|
| `user_email` | string | ✓ | — | 실행 책임자 |
| `agent` | string | ✓ | 1~64자 | 에이전트 이름 |
| `kind` | string | ✓ | `progress` \| `completion` | 보고 종류 |
| `percent` | integer | ✓ | progress: 0~99, completion: 100 | 진척도 (100은 completion만) |
| `summary` | string | ✓ | 1~∞ | 수행 요약 |
| `links` | array | ✗ | [0, 20] | git 커밋/PR/배포 URL 등 |
| `links[].url` | string | ✓ | http(s) URL | 증적 링크 |
| `links[].label` | string | ✗ | — | 링크 설명 (선택) |

**응답 200 OK (progress)**
```json
{
  "ok": true,
  "status": "claimed",
  "applied_to_wbs": true
}
```

**응답 200 OK (completion)**
```json
{
  "ok": true,
  "status": "reported"
}
```

**응답 409 Conflict**
```json
{
  "error": "보고 가능한 상태가 아닙니다(현재: reported).",
  "code": "conflict"
}
```

**에러**
| 코드 | 상태 | 원인 |
|---|---|---|
| `validation_failed` | 400 | kind/percent 형식 오류, links > 20개 등 |
| `unauthorized` | 401 | Bearer 토큰 오류 |
| `unknown_user` | 403 | user_email 없음 |
| `forbidden_role` | 403 | 프로젝트 멤버 아님 |
| `not_claim_owner` | 403 | 본인이 claim 하지 않은 작업 |
| (작업 미등록 또는 프로젝트 미등록) | 404 | — |
| `conflict` | 409 | 상태 전이 불가 (claimed가 아님, 이미 reported 등) |
| `wbs_item_missing` | 409 | 참조 WBS 항목이 삭제됨 (진척만) |
| `apply_failed` | 409 | WBS 실적 반영 실패 (진척만) |
| (내부 오류) | 500 | 보고 기록 실패 |

**WBS 반영**
- **progress (0~99)**: 즉시 자동 반영
  - WBS 항목의 `actual_pct` 갱신
  - `change_logs` 기록 (변경 주체 = `user_email` 계정)
  - 스냅샷 기록 (대시보드 트렌드용)
  - `applied_to_wbs: true` 반환
- **completion (100)**: 자동 반영 없음
  - 주문 상태만 `reported` 로 전이
  - 승인 대기 줄 추가
  - 승인 후 100% 반영됨

---

### 3.4 POST /api/v1/agent/work/{id}/release

작업 점유 반납. 상태전이 `claimed → ready` (CAS).

**요청 바디**
```json
{
  "user_email": "dev@example.com",
  "agent": "claude-cli-dev1"
}
```

**응답 200 OK**
```json
{
  "ok": true,
  "status": "ready"
}
```

**응답 409 Conflict**
```json
{
  "error": "반납 가능한 상태가 아닙니다.",
  "code": "conflict"
}
```

**에러**
| 코드 | 상태 | 원인 |
|---|---|---|
| `validation_failed` | 400 | 경로 id 형식 오류 |
| `unauthorized` | 401 | Bearer 토큰 오류 |
| `unknown_user` | 403 | user_email 없음 |
| `forbidden_role` | 403 | 프로젝트 멤버 아님 |
| `not_claim_owner` | 403 | 본인이 claim 하지 않은 작업 |
| (작업 미등록 또는 프로젝트 미등록) | 404 | — |
| `conflict` | 409 | 상태 전이 불가 (claimed가 아님 등) |
| (내부 오류) | 500 | — |

---

### 3.5 GET /api/v1/agent/work/{id}

작업 상태 폴링. 승인/반려 여부, 반려 사유, 보고 이력 조회.

**응답 200 OK**
```json
{
  "ok": true,
  "order": {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "status": "reported",
    "priority": 10,
    "instructions": "React 컴포넌트 추가...",
    "claimed_by": "claude-cli-dev1",
    "claimed_at": "2026-07-31T09:30:00Z",
    "wbs_item_id": "22220000-e29b-41d4-a716-446655440001",
    "item": {
      "id": "22220000-e29b-41d4-a716-446655440001",
      "code": "WBS-001",
      "name": "로그인 페이지 구현",
      "biz": "사용자 인증 플로우 확립",
      "deliverable": "로그인 폼 컴포넌트 + 테스트",
      "planned_start": "2026-07-20T00:00:00Z",
      "planned_end": "2026-07-25T23:59:59Z"
    },
    "stale": false
  },
  "reports": [
    {
      "id": "33330000-e29b-41d4-a716-446655440002",
      "kind": "progress",
      "percent": 50,
      "summary": "기본 구조 구현 완료.",
      "links": [
        { "url": "https://github.com/org/repo/commit/abc123" }
      ],
      "agent": "claude-cli-dev1",
      "review_action": null,
      "review_note": null,
      "created_at": "2026-07-31T09:35:00Z"
    },
    {
      "id": "44440000-e29b-41d4-a716-446655440003",
      "kind": "completion",
      "percent": 100,
      "summary": "완료. 모든 테스트 통과.",
      "links": [
        { "url": "https://github.com/org/repo/pull/99", "label": "PR #99" }
      ],
      "agent": "claude-cli-dev1",
      "review_action": "reject",
      "review_note": "테스트 커버리지 미달. 재작업 바람.",
      "created_at": "2026-07-31T09:50:00Z"
    }
  ]
}
```

**필드**
| 이름 | 설명 |
|---|---|
| `order.stale` | boolean. `claimed_at` 이 24시간 경과 → `true` ("응답 없음" 표시용) |
| `reports[].review_action` | `null` \| `"approve"` \| `"reject"`. completion 보고만 값 있음. 반려 정보는 이 필드와 `review_note` 로만 표현되며, `reviewed_by`/`reviewed_at` 는 응답에 포함되지 않음 |
| `reports[].review_note` | 반려 사유 (review_action='reject' 일 때만 필수) |

**에러**
| 코드 | 상태 | 원인 |
|---|---|---|
| `validation_failed` | 400 | 경로 id 형식 오류 |
| `unauthorized` | 401 | Bearer 토큰 오류 |
| (작업 미등록) | 404 | 작업 ID 없음 또는 프로젝트 미등록 |
| (내부 오류) | 500 | 조회 실패 |

---

## 4. 에러 코드 전수표

| 에러 코드 | HTTP | 엔드포인트 | 원인 |
|---|---|---|---|
| `validation_failed` | 400 | 전수 | 요청 형식/검증 오류 (경로 id, 바디 필드, 범위 등) |
| `unauthorized` | 401 | 전수 | Bearer 토큰 누락/불일치 (게이트) |
| `unknown_user` | 403 | claim, report, release | `user_email` 이 D'Flow 계정 아님 |
| `forbidden_role` | 403 | claim, report, release | 해당 프로젝트의 멤버 아님 |
| `conflict` | 409 | claim, report, release | 상태 전이 불가 (CAS 실패, 이미 다른 상태 등) |
| `not_claim_owner` | 403 | report, release | 본인이 claim 하지 않은 작업 (claimed_by 불일치) |
| `wbs_item_missing` | 409 | report (진척만) | 참조 WBS 항목이 삭제됨 |
| `apply_failed` | 409 | report (진척만) | WBS 실적 반영 로직 실패 (항목 로크 등) |
| `internal_error` | 500 | 전수 | DB/서버 오류 |

---

## 5. 하네스 규약

### 폴링 주기

- **권장 주기**: 60초 이상
- 더 자주 폴링 시 불필요한 트래픽 발생
- 완료 보고 후 상태 확인까지는 짧은 폴링 가능

### 완료 전 자체 검증

completion 보고 전 **필수**:
1. 빌드 실행 (성공 확인)
2. 테스트 실행 (성공 확인)
3. 검증 결과를 `summary` 에 포함

예시:
```
Build: ✓ passed
Tests: ✓ 42/42 passed
Coverage: 89%

구현 완료:
- 로그인 폼 컴포넌트
- 비밀번호 검증 로직
- E2E 테스트
```

### 반려 처리

1. GET `/api/v1/agent/work/{id}` 에서 `reports[].review_note` 읽기
2. 반려 사유 파악
3. 다시 claim 하지 않음 (상태가 자동으로 `claimed` 로 복귀)
4. 지시문 수정 후 같은 작업 계속 진행 또는 포기 (release)

### 주의: 네트워크 실패 처리

레퍼런스 스크립트의 좀비 방지(release 단독)는 CLI 프로세스 실패에만 대응한다.
completion 보고 호출 자체의 네트워크 실패는 잡지 않으므로, 실전 하네스는 **보고 호출도 재시도 로직으로 감싸고,
최종 실패 시 release 로 점유를 반납**해야 한다.

**실패 시 `progress 0` 을 보고해서는 안 된다.** progress 보고는 호출 즉시 WBS 실적(`actual_pct`)에
반영되므로(§3.3), 실패를 percent:0 으로 보고하면 이미 쌓여 있던 정상 실적을 덮어써 버린다. 실패 신호는
**release 로 점유를 반납하는 것만으로** 충분하다 — 좀비 점유(침묵한 claimed 상태) 방지는 그것으로 달성된다.

---

## 6. Claude Code CLI 하네스

### 두 모드

| 모드 | 동작 | 용도 |
|---|---|---|
| **세션 모드** | 사용자가 Claude Code 세션에서 스킬 실행 → ready 조회 → claim → 그 세션에서 구현 → report | 초기 검증·중요 작업. 사람이 옆에서 본다 |
| **헤드리스 모드** | 러너 스크립트가 주기 폴링 → 주문마다 대상 리포 디렉토리에서 `claude -p "<지시서>"` 실행 → 종료 후 커밋/PR 링크·요약을 report 로 전송 | 무인 자동화. 샘플 프로젝트 검증 후 개방 |

### 지시서 → 프롬프트 변환

GET `/api/v1/agent/work?project_id=...` 응답의 항목 컨텍스트:
- WBS 코드, 이름
- 산출물, 업무내용
- 계획일(start/end)
- 발행자 지시문

이들을 프롬프트 템플릿에 주입. 리포 경로·브랜치 매핑은 하네스 로컬 설정에 둔다.

### 완료 신호 형식

CLI 실행 후 마지막 출력 줄이 **JSON 한 줄**:
```json
{"summary":"구현 완료. 테스트 10/10 통과.", "links":[{"url":"https://github.com/...","label":"PR #99"}]}
```

하네스가 이를 파싱해 `POST /api/v1/agent/work/{id}/report` 의 `summary`, `links` 로 전송.

---

## 7. 사용 예시 (헤드리스 레퍼런스 구현)

스크립트: `scripts/agent-harness-example.mjs`

```bash
AGENT_BASE=https://wbs-web.vercel.app \
AGENT_SECRET=secret_abc123... \
AGENT_EMAIL=dev@example.com \
AGENT_NAME=claude-cli-dev1 \
AGENT_PROJECT=550e8400-... \
REPO_DIR=/path/to/repo \
node scripts/agent-harness-example.mjs
```

**동작**:
1. GET `/api/v1/agent/work?project_id=...` ready 목록 조회
2. 첫 작업 claim
3. 로컬 리포에서 `claude` 커맨드 실행 (프롬프트 자동 생성)
4. 마지막 줄에서 JSON 파싱
5. POST `/api/v1/agent/work/{id}/report` 로 완료 보고
6. 완료 후 보고 명령 출력

**실패 시**:
- **progress 0 을 보고하지 않는다** — progress 보고는 즉시 WBS 실적(`actual_pct`)에 반영되므로(§3.3),
  실패를 0%로 보고하면 이미 쌓인 정상 실적을 덮어써 버린다
- **release 만으로** 점유를 반납한다 — release 호출은 자체 try/catch 로 감싸 항상 시도하고, 실패해도
  console.error 로만 남긴다(실패의 실패까지 던지면 release 시도 여부가 불명확해진다)
- 좀비 점유(침묵 상태) 방지는 release 단독으로 달성한다

---

## 참고

- 설계: `docs/superpowers/specs/2026-07-31-agent-work-loop-design.md` (§3)
- 구현: `src/app/api/v1/agent/work/*`, `src/lib/domain/agentWork.ts`, `src/lib/agent/*`
