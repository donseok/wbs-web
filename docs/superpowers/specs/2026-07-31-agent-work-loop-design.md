# 에이전트 작업 루프(Agent Work Loop) 설계 — WBS 기반 자동화 관제탑

작성 2026-07-31 · 상태 **사용자 승인(설계 단계)** · 구현 미착수

> D'Flow 를 구축(시스템 개발) 프로젝트에서 쓰기 위한 자동화 계층.
> 외부 코딩 에이전트가 WBS 리프 항목을 가져가 작업하고, 결과를 보고하면
> D'Flow 가 실적을 반영하고 사람이 완료를 승인하는 루프를 만든다.
>
> **선행 문서와의 관계**: 범용화 코어(가변 깊이 WBS + 프로젝트 설정 계층)는
> `docs/design/dflow-generic-wbs-design-2026-07-29.md`(P1+P2) 가 정본이다.
> 이 스펙은 그것과 **독립적으로 먼저 구현**한다 — 루프는 리프 단위로만 동작하므로
> 깊이 모델과 무관하고, P1 이 나중에 들어와도 그대로 동작한다(사용자 결정 ⑥).

---

## 0. 사용자 결정 (2026-07-31 브레인스토밍)

| # | 결정 | 기각한 대안 |
|---|---|---|
| ① | 범위 = 에이전트 루프 중심. P1+P2 는 전제로 채택하고 재검토하지 않는다 | P1+P2 재검토 / 통합 신규 설계 |
| ② | 실행 위치 = **외부 에이전트 + D'Flow 관제탑**. 에이전트는 개발 PC/리포에서 돌고 D'Flow 는 API 로 계약·보고·승인만 담당 | 내장 실행기(serverless 시간 제한·무료 LLM RPM 으로 불가), 하이브리드 |
| ③ | 승인 = **이원화**. 중간 진척은 자동 반영, 완료(100%)·마일스톤은 사람 승인 | 전건 승인 / 전건 자동 |
| ④ | 배정 = **풀 + 점유(claim)**. 에이전트가 ready 목록을 조회해 점유 선언 후 착수 | 사람 지시서 발부(push 는 serverless 라 원천 불가) |
| ⑤ | 증적 = **링크 + 요약 중심**. git 커밋/PR/배포 URL + 구조화 요약. 파일 업로드 없음 | 파일 업로드(스토리지 부담) |
| ⑥ | 순서 = **루프 먼저**, 현재 3단 WBS 위에 구축. P1+P2 는 뒤에 | P1+P2 선행 / 병행 |
| ⑦ | 실행 에이전트 1차 대상 = **Claude Code CLI** (세션 모드 + 헤드리스 모드 하네스, §3.3). 계약 자체는 CLI 중립 | D'Flow 서버가 LLM 직접 호출(키·serverless 제약으로 불가) |
| 제약 | **운영 중인 D-CUBE(PI) 프로젝트에 리스크 0** — 스키마·기존 경로 무접촉으로 보장 | — |

구조 접근안은 3개 비교 후 **A. 작업 원장(Work Order) 분리형** 채택
(B. `wbs_items` 직결형은 운영 테이블 변경이라 제약 위반 소지, C. 외부 오케스트레이터는 관제 UI 부재로 목적 미달).

## 1. 아키텍처

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

### 1.1 안전 경계 3겹 (D-CUBE 리스크 0 의 근거)

1. **스키마 추가 전용** — 기존 테이블은 컬럼 하나도 바꾸지 않는다. 신규 테이블 2+1개만 CREATE.
   마이그레이션에 ALTER 가 한 줄이라도 들어가면 이 스펙 위반이다.
2. **프로젝트 등록제** — `agent_projects` 에 등록된 프로젝트만 에이전트 API 가 응답한다.
   미등록(=D-CUBE)은 404 로 존재 자체를 숨긴다(회의록 API `apiNotFound` 관례).
3. **신규 네임스페이스** — API 는 `/api/v1/agent/*`, 화면은 `/agent-ops` 신규 라우트.
   기존 화면·서버 액션·RPC 는 무접촉. WBS 실적 반영만 기존 실적 기록 경로를
   **호출자로서** 재사용한다 — 경로 자체를 고치지 않는다.

## 2. 데이터 모델 (신규 테이블)

### 2.1 `agent_projects` — 루프 활성 게이트

| 컬럼 | 타입 | 비고 |
|---|---|---|
| `project_id` | uuid PK, FK projects | 행 존재 = 루프 활성 |
| `enabled` | boolean not null default true | 일시 중지용 |
| `created_by` | uuid FK auth.users | |
| `note` | text | |
| `created_at` / `updated_at` | timestamptz | |

행이 없거나 `enabled=false` 면 그 프로젝트에 대한 모든 에이전트 기능이 닫힌다.
P2(프로젝트 설정 계층)가 들어오면 이 테이블은 그 설정으로 흡수할 수 있다.

### 2.2 `agent_work_orders` — 작업 원장

| 컬럼 | 타입 | 비고 |
|---|---|---|
| `id` | uuid PK | |
| `project_id` | uuid FK, not null | 게이트·조회용 비정규화 |
| `wbs_item_id` | uuid FK wbs_items **on delete set null** | 항목 삭제 후에도 원장은 감사 기록으로 보존 |
| `status` | text CHECK | `ready → claimed → reported → approved` / `cancelled`. **`rejected` 상태는 없다** — 반려는 보고 행의 `review_action='reject'` 로 기록되고 주문은 `claimed` 로 복귀한다 |
| `instructions` | text | 발행자 지시문(항목의 산출물·업무내용에 덧붙이는 맥락) |
| `priority` | int default 0 | 목록 정렬 힌트 |
| `claimed_by` | text | 에이전트 이름(자유 문자열) |
| `claimed_at` | timestamptz | 좀비 점유 판정 기준 |
| `created_by` | uuid | 발행자 |
| `created_at` / `updated_at` | timestamptz | |

상태 전이는 전부 **조건부 UPDATE(CAS)** — `update ... where id=? and status='ready'` 식.
동시 claim 은 한쪽이 409 를 받는다.

### 2.3 `agent_work_reports` — 보고 이력 (원장의 자식)

| 컬럼 | 타입 | 비고 |
|---|---|---|
| `id` | uuid PK | |
| `work_order_id` | uuid FK cascade | |
| `kind` | text CHECK | `progress` \| `completion` |
| `percent` | int CHECK 0~100 | `progress` 는 0~99 만 허용(100 은 400) |
| `summary` | text not null | 수행 요약 |
| `links` | jsonb | `[{label, url}]` — git 커밋/PR/배포 URL 등 |
| `agent` | text | 보고 에이전트 이름 |
| `actor_user_id` | uuid | `user_email` 로 해석된 실행 책임자 |
| `applied_to_wbs` | boolean default false | 진척 자동 반영 성공 여부 |
| `review_action` / `reviewed_by` / `reviewed_at` / `review_note` | | completion 보고의 승인/반려 기록 |
| `created_at` | timestamptz | |

### 2.4 RLS

조회 정책만 건다(프로젝트 역할 보유자). 쓰기는 서버 경유(service_role)만 —
회의록·위키 계열과 같은 구조이므로 **서버 가드가 유일한 관문**이라는 주의사항을 상속한다
(CLAUDE.md 권한 절 참조). 마이그레이션에는 `_rollback.sql` 을 함께 만든다.

## 3. 에이전트 API 계약 (`/api/v1/agent/*`)

### 3.1 게이트 (회의록 API 패턴 상속)

- `AGENT_API_ENABLED === 'true' && AGENT_API_SECRET` 둘 다 있어야 열림. 아니면 전부 404 (fail-closed + 존재 은닉).
- `Authorization: Bearer <AGENT_API_SECRET>` 상수시간 비교. 실패 401.
- 쓰기 요청 공통 필드: `user_email`(실재 D'Flow 계정, 실행 책임자) + `agent`(에이전트 이름).
  권한 판정은 **그 사용자가 해당 프로젝트의 멤버 이상**인지 — 기존 3단 권한 축을 그대로 쓰고
  에이전트용 별도 권한 체계를 만들지 않는다. 판정은 `src/lib/authz` 가드 경유.
- 대상 프로젝트가 `agent_projects` 미등록이면 404.
- 미정의 메서드도 404 (`apiNotFound` 재사용).

### 3.2 엔드포인트

| 엔드포인트 | 역할 |
|---|---|
| `GET /api/v1/agent/work?project_id=` | ready 작업 목록 + 항목 컨텍스트(WBS 경로·산출물·업무내용·계획일·지시문·priority) |
| `POST /api/v1/agent/work/{id}/claim` | 점유. CAS `ready→claimed`. 충돌 409 + 현재 상태 반환 |
| `POST /api/v1/agent/work/{id}/report` | 보고. `kind`·`percent`·`summary`·`links[]`. 본인 점유(claimed_by 일치)만 |
| `POST /api/v1/agent/work/{id}/release` | 점유 반납 `claimed→ready`. 본인 점유만 |
| `GET /api/v1/agent/work/{id}` | 상태 폴링 — 승인/반려 여부·반려 사유·보고 이력 |

건별 검증 실패는 요청 전체를 죽이지 않고 건별로 보고한다(재편철 배치 §4c 의 부분 실패 원칙).

### 3.3 레퍼런스 에이전트 = Claude Code CLI 하네스 (사용자 결정 ⑦)

실행 에이전트의 1차 대상은 **Claude Code CLI** 다. D'Flow 는 Claude 를 직접 호출하지
않는다(유료 API 키 없음 + serverless 장시간 실행 불가) — 호출 주체는 항상 사용자 소유
CLI 환경이고, LLM 비용도 그쪽 구독에서 발생한다. "WBS 에서 LLM 호출"의 실체는
**CLI 하네스가 WBS 를 폴링해 작업을 가져가는 것**이다(발행 즉시 집어가므로 체감은 push 와 같다).

하네스는 두 모드로 제공한다:

| 모드 | 동작 | 용도 |
|---|---|---|
| **세션 모드** | 사용자가 Claude Code 세션에서 스킬(가칭 `/wbs-work`)을 실행 → ready 조회 → claim → 그 세션에서 구현 → report | 초기 검증·중요 작업. 사람이 옆에서 본다 |
| **헤드리스 모드** | 러너 스크립트가 주기 폴링 → 주문마다 대상 리포 디렉토리에서 `claude -p "<지시서 프롬프트>"` 실행 → 종료 후 커밋/PR 링크·요약을 report 로 전송 | 무인 자동화. 샘플 프로젝트 검증 후 개방 |

- **지시서 → 프롬프트 변환**: `GET /work` 응답의 항목 컨텍스트(WBS 경로·산출물·업무내용·계획일·지시문)를
  프롬프트 템플릿에 주입한다. WBS 항목 ↔ 개발 리포 경로·브랜치 규칙 매핑은 하네스 설정 파일(로컬)에 둔다 —
  D'Flow 는 리포 위치를 모른다(관심사 분리).
- **완료 전 자체 검증**: 하네스는 completion 보고 전에 빌드·테스트를 돌리고 그 결과를 `summary` 에 포함한다.
  그래도 완료 반영은 사람 승인 뒤다(§4).
- 하네스 구현체(스킬 + 러너 스크립트)와 프롬프트 템플릿은 계약 문서와 함께 `docs/` 에 둔다.
  다른 에이전트(Codex 등)도 같은 API 를 쓰면 되므로 계약은 CLI 중립으로 유지한다.

### 3.4 완성 인지 원칙 — 웹(D'Flow)이 로컬 작업을 아는 방법

작업은 각 개발자의 **로컬**에서 일어나고 D'Flow 는 Vercel 의 **웹**이다. 이 간극은 다음 원칙으로 메운다:

1. **통신은 전부 로컬→서버 outbound HTTPS** (폴링·claim·report). D'Flow 가 로컬로
   들어가는 경로는 없고 필요하지도 않다. 사내망·방화벽 뒤 로컬에서도 성립한다.
2. **완성은 추론하지 않는다 — 보고(completion report)가 유일한 인지 채널이다.**
   보고가 안 오면 주문은 `claimed` 로 남고, 24h 경과 시 보드에 "응답 없음"으로
   가시화되어 사람이 회수한다. 침묵은 완성으로 오인되지 않고 멈춤으로 보인다.
3. **보고는 주장, 진실 원천은 git 이다.** 승인자는 증적 링크(커밋/PR)로 실물을 확인하고
   승인한다. 하네스의 빌드·테스트 자체 검증 결과는 판단 보조 자료다.
4. **다중 개발자**: 하네스마다 자기 `user_email`(권한 판정 대상) + `agent`(식별 라벨)로
   보고하고, claim CAS 가 같은 작업의 중복 수행을 막는다.

## 4. WBS 반영 규칙 (이원화의 구체화)

| 보고 | WBS 반영 | 귀속 |
|---|---|---|
| `progress` (0~99) | **즉시 자동 반영** — 기존 실적 기록 경로(`set_actual` 계열) 호출. `change_logs` 에 정상 기록되어 대시보드 트렌드·스냅샷이 그대로 동작 | 변경 주체 = `user_email` 계정, 노트에 `agent:{이름}` |
| `completion` | 자동 반영 없음. 주문 `reported` 로 전이, 승인 대기열에 표시 | — |
| 승인 | 그 시점에 100% 반영 + 주문 `approved` | 변경 주체 = 승인자 |
| 반려 | 사유 필수. 주문 `claimed` 복귀 — 에이전트가 폴링으로 사유를 읽고 재작업 | — |

경계 규칙:

1. **에이전트는 100% 를 직접 쓸 수 없다.** `progress` 에 100 이 오면 400. 완료는 `completion` → 사람 승인 경로뿐.
2. **루프는 실적만 만진다.** WBS 구조(항목 생성·삭제·이름·가중치·담당)는 범위 밖.
   루프가 폭주해도 WBS 구조는 무사하다. 구조 변경은 사람(또는 훗날 챗봇 쓰기 확장 — `wbs-write-bot` 설계 참조)의 몫.
3. 새 WBS 실적 쓰기 경로이므로 **스냅샷 훅 필수** 규칙(대시보드 개편 결정)을 따른다 —
   기존 실적 경로를 호출자로 재사용하면 자동으로 충족되는지 구현 시 확인할 것.

## 5. 관제 UI (`/agent-ops`)

- **발행 탭**: 등록 프로젝트의 WBS 리프 트리에서 항목 선택 → 지시문 작성 → 발행.
  항목의 산출물·업무내용·계획일이 지시서 미리보기에 자동 포함. **발행 권한은 프로젝트 관리자 이상.**
- **보드 탭**: 상태별 열(ready / claimed / 승인 대기 / 완료·반려). 카드에 점유 에이전트·최근 percent·경과 시간.
  `claimed_at` 이 24h 넘은 카드는 "응답 없음" 표시 + 사람 회수(ready 복귀) 버튼. 자동 회수는 없다.
- **승인 화면**: 보고 타임라인 + 증적 링크 + 요약, 승인/반려(사유 필수). 승인 권한은 **프로젝트 관리자 이상**.
- 프로젝트 등록/해제 UI 는 `/agent-ops` 안의 관리 영역(슈퍼유저 전용)으로 시작한다.
- 사이드바 메뉴 추가는 `src/components/app/*` 접점 → **UI 위험 파일 규칙대로 브랜치+Preview 경유**. 그 외 전부 신규 파일.
- 디자인은 기존 토큰 시스템·공용 프리미티브 재사용(디자인 일관성 메모리 준수).

## 6. 에러 처리·운영

- **3원칙**: 조회 실패는 표시=로깅(빈 목록 위장 금지) · 쓰기 선행 조회 실패는 중단 · 게이트 fail-closed.
- CAS 충돌 409, 종료 상태(approved/cancelled)에 온 보고 409.
  **`reported`(승인 대기) 상태에서도 추가 보고는 409** — 승인/반려 판정 전에는 원장을 움직이지 않는다.
  반려로 `claimed` 복귀 후 재보고한다.
- 시크릿 회전 = Vercel env 교체 1회. 에이전트별 키 분리는 하지 않는다(YAGNI — `agent` 필드로 식별만).
- 서버가 LLM 을 호출하는 지점 없음 — 무료 티어 RPM 예산에 영향 0.

## 7. 테스트·검증 전략 (리스크 0 의 증명)

1. **도메인 단위 테스트** — 상태 전이표 전수(허용/거부), percent 경계(progress 100 거부), 권한 판정.
2. **라우트 테스트** — 회의록 API 테스트 패턴 재사용: 게이트 닫힘 404 · 미등록 프로젝트 404 · CAS 경합 · 본인 점유 검증 · 부분 실패.
3. **D-CUBE 무영향 증명** — ① 마이그레이션이 CREATE 만 포함(기존 테이블 ALTER 0건) 리뷰 확정
   ② D-CUBE 미등록 상태에서 전 엔드포인트 404 테스트 ③ 기존 vitest 전량 초록 유지.
4. **런타임 E2E** — 프로덕션 Supabase 안 **전용 샘플 프로젝트**(D-CUBE 데이터 보호 결정 준수)에서
   레퍼런스 클라이언트로 발행→claim→progress→completion→승인 1루프 완주.
5. 배포 절차는 평소대로(브랜치→Preview→main→smoke, 마이그레이션은 Management API + `_rollback.sql`).

## 8. 비범위 (YAGNI 확정)

LLM 자동 검증 판정 · 작업 자동 발행 · 의존성 스케줄 연동 · 에이전트 간 협업/분배 최적화 ·
push 알림 · 에이전트의 WBS 구조 변경 · 에이전트별 API 키 · 점유 자동 회수 · 파일 업로드 증적 ·
P1 가변 깊이 연계(후행 스펙).

## 9. 미해결/후속

- P2 도입 시 `agent_projects` 를 프로젝트 설정으로 흡수할지 재검토.
- 구축 프로젝트 실전 투입 후: 작업 발행의 반자동화(주간 계획에서 일괄 발행), 승인 대기 알림.
- 챗봇 쓰기 확장(`wbs-write-bot`)과의 접점 — 루프 승인 결과를 챗봇이 요약 보고하는 정도만 후보.
