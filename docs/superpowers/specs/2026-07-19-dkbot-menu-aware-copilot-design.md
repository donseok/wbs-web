# DK Bot 메뉴 인식형 운영 코파일럿 고도화 설계

- 작성일: 2026-07-19
- 상태: 설계 확정 — Phase 1 및 Phase 2 검색 기반 구현 완료(2026-07-19), 후속 메뉴 확장 대기
- 대상: 전역 DK Bot, 프로젝트 메뉴별 조회, 회의록 검색 연계
- 목적: WBS 중심 챗봇을 현재 화면과 프로젝트 운영 데이터 전체를 이해하는 읽기형 코파일럿으로 확장
- 현행 운영 기준: [DK Bot — AI 챗봇](../../dkbot.md)
- 관련 설계:
  - [회의록 보관함 설계](./2026-07-09-meeting-minutes-design.md)
  - [회의록 채팅 범위 전환](./2026-07-10-minutes-chat-scope-toggle-design.md)
  - [Action Bot 구현 계획](../plans/2026-07-11-week1-2-action-bot-hygiene-status.md)

> **기존 회의록 설계와의 관계:** 2026-07-09 회의록 설계의 “전역 DK Bot 수정·통합 제외”는 당시 구현 범위를 보호하기 위한 결정이었다. 본 설계는 그 제한 중 **전역 DK Bot이 회의록 읽기 서비스를 호출하지 않는다는 범위만 의식적으로 확장**한다. 회의록 전용 채팅 UI, 권한, 원본 데이터와 색인 계약은 유지하고 공용 읽기 서비스만 추출해 공유한다.

## 1. 결론

DK Bot의 상세 답변 품질은 모델 교체만으로 획기적으로 좋아지기 어렵다. 현재 병목은 모델이 아니라 **챗봇이 현재 메뉴와 선택 항목을 모르고, 실제 메뉴 데이터를 조회할 수 없는 구조**다.

목표 구조는 다음과 같다.

```text
질문 + 현재 페이지 문맥
        ↓
권한·프로젝트 범위 확정
        ↓
결정형 라우터 / 제한된 AI 질의 계획
        ↓
메뉴별 읽기 도구 병렬 실행
        ↓
실시간 구조화 사실 + 관련 장문 검색
        ↓
근거 기반 답변 생성·수치 검증
        ↓
답변 + 출처 링크 + 기준 시각 스트리밍
```

핵심은 AI에게 범용 SQL 권한을 주는 것이 아니다. AI는 서버가 허용한 읽기 도구와 인자만 선택하고, 조회·필터·집계·권한 검증은 TypeScript 도메인 코드와 데이터 어댑터가 담당한다.

이 구조를 적용하면 다음과 같은 질문을 처리할 수 있다.

- “현재 주차 ERP 이슈와 다음 주 계획을 정리해줘.”
- “이 작업의 선행 작업, 예상 지연, 최근 변경 이력과 첨부파일을 알려줘.”
- “내일 회의 참석자 중 휴가자가 있나?”
- “최근 회의록 결정사항이 주간업무에 반영됐는지 확인해줘.”
- “이번 주 ERP 리스크를 WBS·주간업무·회의록 근거로 설명해줘.”

## 2. 배경과 현행 진단

### 2.1 DK Bot이 현재 보는 범위

| 영역 | 현행 동작 | 영향 |
|---|---|---|
| 클라이언트 문맥 | `DkBot.tsx`가 URL에서 `projectId`만 추출 | 메뉴, 선택 행·카드·회의, 주차, 날짜, 검색어, 필터를 알 수 없음 |
| 요청 계약 | `projectId`, `message`, `history`만 전송 | “이 작업”, “현재 주차”, “지금 보이는 카드”를 해석할 근거가 없음 |
| 의도 분류 | `src/lib/ai/intent.ts`의 WBS 중심 의도 9종 | 메뉴 단어보다 “현황”, “이번 주”, “완료” 같은 일반어가 질문을 가로챔 |
| 구조화 지식 | `src/lib/ai/knowledge.ts`가 WBS·프로젝트 멤버·프로젝트명 중심으로 로드 | 근태·공지·회의·실제 주간시트·회의록·변경 이력 등을 읽지 못함 |
| 자유 질문 팩트 | WBS 말단 작업 최대 160개, 업무·산출물 문자열 절단 | 중간 Task 경로, 코드, 의존성, 긴 상세가 누락될 수 있음 |
| 의미검색 | 프로젝트·WBS 말단·멤버 문서, 벡터 top-K 중심 | 메뉴 장문 데이터가 색인되지 않고 정확 문자열·필터 결합이 약함 |
| 색인 신선도 | 일반 WBS 편집 후 자동 재색인하지 않음 | 오래된 임베딩이 상세 답변에 사용될 수 있음 |
| 스트리밍 | `text/plain` 토큰만 전달 | 출처, 도구, 기준 시각, 잘림 여부를 UI에 전달하기 어려움 |
| 후속 질문 | 문자열 대화 이력만 유지 | “그 회의”, “두 번째 항목”의 엔티티 ID를 안정적으로 이어갈 수 없음 |

### 2.2 대표 오동작

- “이번 주 회의는?” → `this_week`로 분류되어 이번 주 WBS 작업을 답할 수 있다.
- “근태 현황은?” → `project_status`로 분류되어 WBS 공정 현황을 답할 수 있다.
- “완료된 공지는?” → `completed`로 분류되어 완료 WBS를 답할 수 있다.
- “주간 시트 요약” → 실제 `weekly_report_rows`가 아닌 WBS 기반 자동 주간요약을 답한다.
- `/meetings`, `/minutes`처럼 프로젝트 ID가 URL에 없는 화면에서는 메뉴 데이터가 아니라 전사 WBS 요약으로 흐를 수 있다.

### 2.3 모델만 교체해서 해결되지 않는 이유

모델은 전달받지 못한 DB 레코드를 알 수 없다. 더 큰 모델을 사용하면 문장 표현과 모호한 질문 해석은 나아질 수 있지만, 다음 문제는 그대로 남는다.

- 실제 메뉴 데이터 부재
- 최신 상태·숫자·날짜 부재
- 프로젝트와 레코드 권한 판단 부재
- 현재 선택 항목 부재
- 잘못된 의도 분류
- 오래된 검색 색인

모델 업그레이드는 데이터 접근 구조와 평가 체계를 만든 뒤 적용하는 마지막 최적화 수단으로 둔다.

## 3. 목표와 비목표

### 3.1 목표

1. 현재 메뉴, 선택 엔티티, 주차·날짜·필터를 질문 문맥으로 전달한다.
2. 메뉴별 기존 데이터 로더와 순수 도메인 함수를 권한 검증된 읽기 도구로 제공한다.
3. 숫자·상태·날짜는 실시간 구조화 조회를 정답 원천으로 사용한다.
4. 회의록·공지 본문·주간 이슈처럼 긴 텍스트만 혼합 검색을 사용한다.
5. 답변의 사실에 클릭 가능한 출처와 기준 시각을 제공한다.
6. 여러 메뉴를 결합한 질문을 최대 3개 도구의 병렬 조회로 처리한다.
7. LLM·임베딩 장애 시에도 핵심 구조화 질문은 결정형 답변으로 강등한다.
8. Supabase 종속성을 데이터 어댑터 뒤로 격리해 향후 MySQL 전환 범위를 줄인다.

### 3.2 비목표

- AI가 생성한 임의 SQL 실행
- 사용자의 확인 없는 생성·수정·삭제
- 기존 Action Bot의 제안 → 확인 → 서버 액션 계약 변경
- 회의록 전용 채팅 UI 제거 또는 대체
- 모든 화면 데이터를 한 번에 프롬프트에 주입
- 1차 범위에서 개인별 WBS 담당 관계를 추론으로 생성
- 계정·환경변수·서비스 키 같은 관리자 비밀정보 답변
- 음성 입력, 자동 주간보고 작성, 외부 검색

## 4. 확정 설계 원칙

| 항목 | 결정 |
|---|---|
| 기본 성격 | 읽기형 운영 코파일럿. 쓰기는 기존 Action Bot 경로로 완전 분리 |
| 문맥 | 클라이언트 문맥은 조회 힌트일 뿐이며 서버가 프로젝트·엔티티·권한을 재검증 |
| 라우팅 | 명확한 질문은 결정형 라우터, 모호하거나 교차 메뉴 질문만 AI 도구 플래너 사용 |
| 도구 수 | 기본 최대 3개, 하드 한도 4개. 독립 도구는 병렬 실행 |
| 정답 원천 | 숫자·상태·날짜·담당·건수는 DB 직접 조회, 장문 의미는 검색 인덱스 |
| 검색 | 키워드 + 벡터 + 메타데이터 필터. 검색 결과 ID의 최신 필드는 DB에서 재조회 |
| 쓰기 부작용 | 챗봇 읽기 도구 호출 전후 업무 데이터 변경 0건 보장 |
| 출처 | 사실을 포함한 답변은 내부 경로와 기준 시각을 가진 출처를 제공 |
| 스트리밍 | 기존 API를 유지하고 v2에서 NDJSON 이벤트 스트림 도입 |
| 후속 문맥 | 1차는 현재 탭에 구조화 엔티티 상태를 보관하며 프로젝트 전환·초기화 시 폐기 |
| 저장소 독립성 | 도구는 Repository·AccessScopeResolver 인터페이스에 의존하고 Supabase/MySQL은 어댑터로 격리 |
| 배포 | 기능 플래그·shadow mode·메뉴별 점진 적용·기존 DK Bot 즉시 폴백 지원 |

## 5. 목표 아키텍처

```text
┌─────────────────────────────────────────────────────────────┐
│ DkBot UI                                                    │
│ 질문 + PageContext + ConversationState                     │
└───────────────────────────┬─────────────────────────────────┘
                            │ POST /api/chat/v2/stream
                            ▼
┌─────────────────────────────────────────────────────────────┐
│ Chat Orchestrator                                           │
│ 1. 인증/허용 프로젝트 확정                                 │
│ 2. v2는 조회 질문만 수신                                    │
│ 3. Domain Router → 필요 시 Tool Planner                     │
│ 4. Tool Registry 실행                                       │
│ 5. Evidence Pack 조립                                       │
│ 6. LLM 합성 → 수치/출처 검증                               │
└──────────────┬──────────────────────────┬───────────────────┘
               │                          │
               ▼                          ▼
┌──────────────────────────┐  ┌───────────────────────────────┐
│ Read-only Domain Tools   │  │ Knowledge Search              │
│ WBS/주간/회의/근태/...   │  │ 키워드 + 벡터 + 필터          │
└──────────────┬───────────┘  └──────────────┬────────────────┘
               │                             │
               ▼                             ▼
┌──────────────────────────┐  ┌───────────────────────────────┐
│ Repository + Access      │  │ KnowledgeIndex Interface      │
│ Supabase / MySQL Adapter │  │ pgvector / 대체 검색 저장소   │
└──────────────────────────┘  └───────────────────────────────┘
```

### 5.1 오케스트레이터 책임

- 사용자 세션과 접근 가능한 프로젝트 목록 확정
- `PageContext` 정규화 및 신뢰 경계 적용
- 질문 도메인·기간·대상 엔티티 해석
- 도구 계획 스키마 검증과 조회 범위 상한 적용
- 독립 조회 병렬 실행, 부분 실패 격리
- 도구 결과를 공통 Evidence Pack으로 변환
- LLM 합성 또는 결정형 폴백 선택
- 숫자·출처·내부 링크 검증
- 클라이언트에 상태·답변·출처·후속 엔티티 상태 전달

## 6. 페이지 문맥 계약

### 6.1 요청 타입

아래는 논리 계약이며 구현 시 런타임 스키마 검증을 추가한다.

```ts
type BotDomain =
  | 'projects'
  | 'dashboard'
  | 'wbs'
  | 'kanban'
  | 'members'
  | 'attendance'
  | 'announcements'
  | 'meetings'
  | 'weekly'
  | 'minutes'
  | 'settings'
  | 'unknown'

type BotEntityType =
  | 'project'
  | 'wbs_item'
  | 'attachment'
  | 'team'
  | 'member'
  | 'meeting'
  | 'meeting_occurrence'
  | 'minute'
  | 'minute_block'
  | 'announcement'
  | 'weekly_report'
  | 'weekly_row'
  | 'attendance_record'

interface BotEntityRef {
  type: BotEntityType
  id: string
  qualifier?: {
    occurrenceDate?: string // 반복 회의의 특정 회차
    anchor?: string         // 회의록 블록 등 문서 내부 위치
  }
}

interface PageContextV1 {
  contextVersion: 1
  pathname: string
  domain: BotDomain
  projectId: string | null
  selectedEntity?: BotEntityRef | null
  view?: string | null
  date?: string | null
  weekStart?: string | null
  range?: { from: string | null; to: string | null } | null
  filters?: Record<string, string | string[] | number | boolean | null>
  search?: string | null
  timezone: 'Asia/Seoul'
}

interface ConversationStateV1 {
  version: 1
  lastEntities: Array<BotEntityRef & {
    ref: string       // 예: "첫 번째", "S2"
    projectId: string | null
    title: string
  }>
  lastDomains: BotDomain[]
}

interface ChatRequestV2 {
  projectId: string | null // 하위 호환 힌트. 최종 범위는 서버가 확정
  message: string
  history: Array<{ role: 'user' | 'assistant'; content: string }>
  pageContext?: PageContextV1
  conversationState?: ConversationStateV1
}
```

### 6.2 UI 문맥 등록

URL로 표현 가능한 값은 `pathname`과 search params에서 자동 수집한다. URL에 없는 모달·카드·행 선택은 `BotPageContextProvider`와 등록 훅으로 전달한다.

```ts
useBotPageContext({
  domain: 'wbs',
  projectId,
  selectedEntity: selectedId ? { type: 'wbs_item', id: selectedId } : null,
  filters: { team, status },
  search,
})
```

등록값은 ID와 필터만 포함하고 화면의 전체 레코드나 민감 필드는 보내지 않는다. 서버 도구가 ID를 사용해 원본 데이터를 다시 조회한다.

### 6.3 신뢰 경계

- 클라이언트가 보낸 `projectId`와 엔티티 ID를 권한 근거로 사용하지 않는다.
- 서버가 세션으로 접근 가능한 프로젝트를 확정한 뒤 모든 도구 인자와 교집합을 구한다.
- 선택 엔티티가 다른 프로젝트에 속하면 무시하고 보안 오류를 일반적인 “접근할 수 없음”으로 반환한다.
- 날짜·기간은 KST로 정규화하고 최대 조회 기간을 도구별로 제한한다.
- 알려지지 않은 필터 키는 버린다.

#### 6.3.1 현행 프로젝트 접근 정책

현행 Supabase RLS는 프로젝트·WBS·멤버·근태·회의·회의록 읽기에 대체로 `authenticated using (true)`를 사용한다. `project_members`는 화면에 표시하는 프로젝트 인력 명단이지 프로젝트 접근 ACL이 아니다.

따라서 별도 ACL을 도입하기 전 `allowedProjectIds`는 “현재 세션이 현행 RLS로 읽을 수 있는 전체 프로젝트”를 뜻하며, 프로젝트별 격리를 새로 만들어 내지 않는다. 본 고도화의 기본 범위는 현행 접근 정책을 보존하는 것이다.

프로젝트별 비공개가 필요하면 별도 `project_access` 관계, 초대·회수 흐름, 프로젝트 하위 테이블 RLS, 관리자 우회 정책을 먼저 설계해야 한다. 이는 챗봇만의 변경이 아니므로 본 문서의 일정에는 포함하지 않고 §21에서 착수 전 결정한다.

### 6.4 전역 화면의 범위

- `/projects`: 접근 가능한 프로젝트만 대상으로 포트폴리오 요약을 제공한다.
- `/meetings`: 로그인 사용자의 회의를 기본 범위로 하며, 선택된 회의의 프로젝트를 서버에서 역참조한다.
- `/minutes`: 기존 회의록 보관함 권한과 필터를 그대로 사용한다. 프로젝트 질문은 연결된 `meeting_id`로 프로젝트를 역참조하는 것을 1차 규칙으로 한다.
- 프로젝트를 특정할 수 없는 교차 질문은 추측하지 않고 프로젝트 선택을 요청한다.

## 7. 질의 라우팅과 도구 계획

### 7.1 처리 순서

1. 클라이언트의 기존 `isCommandUtterance` 선분기를 유지한다. 쓰기 명령 후보는 `/api/chat/command`의 제안 → 확인 경로로 보내고 v2는 조회 질문만 수신한다.
2. v2가 쓰기 문장을 받더라도 실행하거나 계획하지 않고 기존 확인형 명령 경로를 사용하라고 안내한다.
3. 현재 메뉴와 명확한 도메인 단어를 사용해 결정형 라우터가 1차 분류한다.
4. 대상이 모호하거나 둘 이상의 도메인을 결합해야 할 때만 LLM 플래너를 호출한다.
5. 플래너 결과는 허용 목록, 인자 스키마, 프로젝트 범위, 날짜 범위, 결과 상한을 검증한다.
6. 같은 단계의 독립 도구는 병렬 실행하고, 이전 결과 ID가 필요한 호출은 다음 단계에서 실행한다.
7. 일부 도구가 실패하면 성공한 근거만으로 답하고 누락된 범위를 명시한다.

### 7.2 결정형 라우터 우선 예시

| 질문 | 우선 도메인/도구 |
|---|---|
| “오늘 연차인 사람” | attendance / `get_attendance` |
| “ERP 금주 이슈” | weekly / `get_weekly_sheet` |
| “내일 회의” | meetings / `list_meetings` |
| “이 작업 선행작업” | wbs / `get_wbs_dependencies` |
| “고정 공지” | announcements / `list_announcements` |

현재의 `현황`, `상태`, `완료`, `이번 주` 같은 일반어는 메뉴·명사보다 우선하지 않는다. 예를 들어 “근태 현황”은 `project_status`가 아니라 근태 도메인이다.

### 7.3 플래너 출력 계약

```ts
interface ToolPlan {
  reason: string
  stages: Array<{
    calls: Array<{
      id: string
      tool: BotToolName
      args: Record<string, unknown>
      bindings?: Record<string, {
        fromCall: string
        resultPath: string
      }>
    }>
  }>
  needsClarification: boolean
  clarification?: string
}
```

제약:

- 기본 최대 3개, 하드 한도 4개 도구
- 최대 2단계이며 같은 단계의 호출만 병렬 실행
- 범용 SQL·스토리지·외부 URL 도구 없음
- 도구가 반환한 ID만 다음 단계 상세 조회에 사용 가능
- `bindings`는 앞 단계 결과의 허용된 ID·날짜 배열만 참조하며 임의 객체 경로는 스키마 검증
- 모호한 동명이인·동일 작업은 임의 선택하지 않고 후보를 제시
- 플래너 오류 시 현재 페이지 기반 단일 도구 또는 기존 결정형 답변으로 폴백

## 8. 읽기 도구 공통 계약

### 8.1 도구 인터페이스

```ts
interface ToolExecutionContext {
  userId: string
  role: string | null
  teamId: string | null
  capabilities: string[]
  allowedProjectIds: string[]
  pageContext: PageContextV1 | null
  now: string
  timezone: 'Asia/Seoul'
}

interface BotSource {
  id: string
  domain: BotDomain
  entityType: BotEntityType
  entityId: string
  projectId: string | null
  title: string
  href: string
  updatedAt: string | null
  qualifier?: BotEntityRef['qualifier']
  excerpt?: string
}

interface ToolResult<T> {
  status: 'ok' | 'partial'
  facts: Record<string, string | number | boolean | null>
  records: T[]
  sources: BotSource[]
  asOf: string
  truncated: boolean
  warnings: string[]
}

type RepositoryResult<T> =
  | { ok: true; data: T }
  | { ok: false; errorCode: string; retryable: boolean }
```

### 8.2 공통 규칙

- 모든 도구는 서버 전용이며 읽기 전용이다.
- 결과에는 원본 레코드 전체가 아니라 답변에 허용된 필드만 포함한다.
- 챗봇용 Repository는 `RepositoryResult`를 사용해 **정상 0건**과 **조회 실패**를 구분한다.
- 오류를 로그만 남기고 `[]` 또는 `null`로 바꾸는 현행 화면용 로더는 그대로 감싸서 사용하지 않는다. 오류를 보존하는 strict 조회 구현을 별도로 둔다.
- 기본 목록 상한은 50건, 상세 원문은 필요한 엔티티만 조회한다.
- `truncated=true`면 답변에서 일부 결과임을 표시한다.
- 서로 다른 기준 시각의 결과는 출처별 `updatedAt`과 전체 `asOf`를 표시한다.
- 원본에 갱신 시각 컬럼이 없으면 `updatedAt=null`을 유지하고 조회 기준 시각 `asOf`만 표시한다. 생성 시각을 갱신 시각으로 위장하지 않는다.
- 도구 실행 로그에는 원문 전체보다 도구명·인자 해시·건수·소요시간·오류 코드를 남긴다.

## 9. 메뉴별 도구 레지스트리

| 메뉴 | 1차 도구 | 제공 범위 | 재사용할 현행 코드 / 주의점 |
|---|---|---|---|
| 프로젝트 목록 | `list_project_summaries` | 접근 가능한 프로젝트, 기간, 공정, 지연 요약 | `src/app/actions/project.ts`; 프로젝트별 WBS 집계 |
| 대시보드 | `get_project_dashboard` | 공정, SPI, 추세, 예상 완료, 위험, 마일스톤, 회의·회의록 신호 | `src/lib/ai/projectFacts.ts`, `brief.ts`, `src/lib/domain/dashboard.ts` |
| WBS·간트 | `find_wbs_items`, `get_wbs_item_detail` | 전체 경로, 코드, 상태, 기간, 공정, 팀, 산출물 | `src/lib/data/wbs.ts`; 말단만이 아니라 조상 경로 포함 |
| WBS·간트 | `get_wbs_dependencies` | 선후행, lag, 예상 일정, 크리티컬 경로·지연 원인 | `src/lib/domain/dependencySchedule.ts` |
| WBS·간트 | `get_wbs_change_log` | 최근 변경 필드·시각·행위자 표시명 | `src/app/actions/wbs.ts`; 허용 필드만 노출 |
| WBS·간트 | `list_wbs_attachments` | 파일명, 크기, 등록시각 등 메타데이터 | 현행 `listAttachments`는 signed URL을 생성하므로 **재사용 금지**. Storage 호출 없는 metadata-only Repository 신설 |
| 칸반 | `get_kanban_view` | Phase·담당팀·상태별 카드와 집계 | `src/lib/domain/kanban.ts`; 화면 모드·필터 반영 |
| 멤버 | `list_members`, `get_member_workload` | 팀 구성, 직책, 역할, 팀 단위 업무량 | `src/lib/data/members.ts`; 이메일은 기본 제외 |
| 근태 | `get_attendance` | 기간·멤버·유형별 휴가/출장/재택과 집계 | `src/lib/data/attendance.ts`, `src/lib/domain/attendance.ts`; 메모는 기본 제외 |
| 공지 | `list_announcements`, `search_announcements` | 게시 중·고정·카테고리·기간·본문 검색 | `src/lib/data/announcements.ts`; 챗봇 조회로 읽음 처리 금지 |
| 프로젝트 회의 | `list_meetings`, `get_meeting_detail` | 반복 전개, 취소 예외, 장소, 참석자, 허용된 본문 | `src/lib/data/meetings.ts`, `src/lib/domain/meetings.ts` |
| 내 회의 | `list_my_meetings` | 로그인 사용자 기준 월·기간별 회의 | `getMyMeetings`; 프로젝트 범위 역참조 |
| 주간업무 | `get_weekly_sheet`, `compare_weekly_sheets` | 구분·모듈별 금주 업무/이슈, 차주 업무/이슈 | `src/lib/data/weeklySheet.ts`; **조회 중 행을 생성하지 않는 순수 읽기 로더 신설 필요** |
| 회의록 | `search_minutes`, `get_minute_detail` | 문서/보관함 검색, 결정·액션·위험, 본문 근거 | `src/lib/ai/minutes-answer.ts`, `src/lib/data/minutes.ts`; 기존 전용 UI 유지, 조회 서비스만 공유 |
| 설정 | `get_safe_project_settings` | 프로젝트 기간, 기준일, 공휴일, WBS 수, 색인 상태 | 프로젝트·WBS·`src/lib/ai/health.ts`; 키·계정 비밀 제외 |

### 9.1 개인별 업무의 데이터 한계

현행 WBS 담당은 개인보다 팀 중심이다. `answerByTeam`이 팀 작업 집계와 팀 멤버 이름을 함께 표시하더라도 특정 멤버가 실제 해당 작업을 맡았다는 관계는 아니다.

따라서 1차 버전은 개인별 업무 질문에 다음처럼 정직하게 답한다.

- 팀 단위 업무와 팀 멤버 목록은 제공
- 개인 담당 관계가 없는 경우 “개인 담당 데이터가 등록되지 않음” 표시
- 추론으로 담당자를 연결하지 않음

정확한 개인별 업무가 필요하면 후속 스키마로 `wbs_item_assignees(wbs_item_id, project_member_id, kind)` 관계를 추가한다.

## 10. 구조화 조회와 혼합 검색의 경계

### 10.1 DB 직접 조회 대상

- 작업 상태·진행률·계획/실적 날짜
- 의존성·lag·예상 일정
- 담당팀·멤버·참석자
- 근태 유형·기간·건수
- 공지 게시 여부·게시 기간
- 회의 일시·장소·취소 여부
- 주차·행·모듈 구조
- 프로젝트 설정·색인 신선도

이 값들은 임베딩 문서의 숫자를 정답으로 사용하지 않는다. 검색으로 엔티티를 찾았더라도 최신값을 DB에서 재조회한다.

### 10.2 혼합 검색 대상

- WBS 업무 상세·산출물 설명
- 주간업무 금주/차주 내용과 이슈
- 회의 본문
- 회의록 본문·결정·액션·위험
- 공지 본문

검색 순서:

1. 질문에서 코드·고유명·사람명·인용 문자열을 추출해 정확/부분 일치 검색
2. 도메인·프로젝트·팀·기간·엔티티 유형 필터 적용
3. 벡터 유사도 검색
4. 후보를 합쳐 중복 제거하고 필요 시 재순위화
5. 상위 후보의 최신 구조화 필드를 DB에서 재조회
6. 답변에 사용할 5~8개 근거만 Evidence Pack에 포함

### 10.3 일반화된 검색 문서

현행 `wbs_embeddings`를 즉시 제거하지 않는다. 신규 구조는 저장소 독립적인 `KnowledgeIndex` 인터페이스를 우선 정의하고, 구현 어댑터에서 기존 색인과 신규 일반화 색인을 감싼다.

논리 문서 스키마:

```ts
interface KnowledgeDocument {
  id: string
  projectId: string | null
  domain: BotDomain
  entityType: BotEntityType
  entityId: string
  chunkNo: number
  title: string
  content: string
  contentHash: string
  embeddingModel: string
  embeddingDimensions: number
  chunkerVersion: string
  indexVersion: number
  team?: string | null
  occurredOn?: string | null
  updatedAt: string
  href: string
}
```

Supabase에서는 pgvector 어댑터를 사용할 수 있다. MySQL 전환 시에는 동일 인터페이스 뒤에서 MySQL의 적합한 검색 기능 또는 별도 벡터 저장소를 선택한다. 챗봇 오케스트레이터와 도구 계약은 변경하지 않는다.

Phase 2의 기본 물리안은 일반 문서 테이블 `ai_documents`와 작업 큐 `ai_index_jobs`다. 현행 `wbs_embeddings`·`minute_embeddings`는 신규 색인 백필과 shadow 검색 검증이 끝날 때까지 병행하고, 검증 후 읽기 경로를 전환한다. 즉시 삭제하거나 한 번에 마이그레이션하지 않는다.

### 10.4 색인 신선도

- 안정 키는 `(projectId ?? global, domain, entityType, entityId, chunkNo, indexVersion)`로 둔다. `contentHash`는 변경 감지 값이지 행 식별자가 아니다.
- 재청킹으로 청크 수가 줄면 같은 엔티티·색인 버전의 남은 구형 청크를 삭제하거나 tombstone 처리한다.
- 메뉴 데이터 변경 경로가 `ai_index_jobs`에 upsert/delete 작업을 남기고, 보호된 워커가 비동기로 처리한다. 원본 변경과 같은 트랜잭션을 만들 수 없는 경로는 best-effort enqueue 후 정합성 검사로 보완한다.
- 워커는 지수 백오프로 최대 5회 재시도하고 이후 dead-letter 상태로 남긴다. 관리자 복구 경로에서 재실행할 수 있어야 한다.
- 워커 실행 위치는 배포 환경의 보호된 예약 작업(Vercel Cron 또는 동등 수단)으로 하며 운영 응답 프로세스와 분리한다.
- 이벤트 누락을 대비해 주기적 정합성 검사로 원본 해시와 색인 해시를 비교한다.
- 색인 실패는 업무 데이터 변경을 롤백하지 않으며 재시도 대상으로 기록한다.
- 답변 파이프라인은 stale 상태를 감지하면 구조화 DB 조회를 우선하고 오래된 장문 근거임을 표시하거나 제외한다.
- 전체 삭제 후 재색인은 초기 백필·관리자 복구에만 사용한다.

## 11. 답변, 출처, 스트리밍

### 11.1 출처 규칙

각 도구는 `BotSource`를 반환하고 합성기는 근거 ID만 인용한다.

- WBS: `/p/{projectId}/wbs?focus={itemId}`
- 주간업무: `/p/{projectId}/weekly?week={weekStart}`
- 회의: 1차는 프로젝트 또는 내 회의 메뉴 루트. 상세 선택 query parameter를 화면이 지원한 뒤 단건 딥링크 제공
- 회의록: `/minutes/{minuteId}`
- 근태·공지·멤버·설정: 1차는 해당 메뉴 루트. 화면별 query parameter 계약 추가 후 필터·선택 상태까지 복원

허용되지 않은 외부 URL은 링크화하지 않는다. 존재하지 않는 출처 ID, 접근 불가능한 경로, 다른 프로젝트 엔티티는 응답 후처리에서 제거한다.

현행에서 실제로 선택 상태까지 복원 가능한 링크는 WBS `?focus=`, 주간업무 `?week=`, 회의록 `/minutes/{id}`다. 다른 메뉴의 상세 딥링크는 해당 페이지가 query parameter를 소비하도록 구현된 뒤 수용 기준에 포함한다.

### 11.2 v2 NDJSON 이벤트

기존 `/api/chat`과 `/api/chat/stream`은 안정화 전까지 유지한다. 신규 UI는 `POST /api/chat/v2/stream`을 사용한다.

```json
{"v":1,"requestId":"req_...","type":"status","message":"주간업무와 회의록을 확인하고 있습니다."}
{"v":1,"requestId":"req_...","type":"delta","text":"이번 주 ERP의 주요 이슈는 "}
{"v":1,"requestId":"req_...","type":"sources","items":[{"id":"S1","title":"ERP 주간업무","href":"/p/.../weekly?..."}]}
{"v":1,"requestId":"req_...","type":"state","conversationState":{"version":1,"lastEntities":[],"lastDomains":["weekly"]}}
{"v":1,"requestId":"req_...","type":"done","asOf":"2026-07-19T10:30:00+09:00","tools":["get_weekly_sheet"],"truncated":false}
{"v":1,"requestId":"req_...","type":"error","code":"TOOL_TIMEOUT","message":"일부 데이터를 확인하지 못했습니다.","retryable":true}
```

마지막 `error` 행은 `done`의 대체 예시이며 같은 스트림에서 연속 전송하지 않는다.

규칙:

- 응답 Content-Type은 `application/x-ndjson; charset=utf-8`이다.
- 스트림은 성공 시 `done`, 실패 시 `error` 중 정확히 하나의 terminal 이벤트로 끝난다. 부분 텍스트 전송 후 치명적 오류가 발생해도 `error`로 종료하고 `done`을 추가하지 않는다.
- 인증·요청 스키마 검증처럼 스트림 시작 전 오류는 적절한 HTTP 상태를 사용한다. 시작 후 오류만 구조화 `error` 이벤트로 보낸다.
- `sources`는 `id` 기준으로 병합하고 같은 ID는 마지막 이벤트가 갱신한다. `state`는 마지막 유효 이벤트를 저장한다.
- 클라이언트 취소·프로젝트 전환은 `AbortSignal`을 서버 도구와 LLM 호출에 가능한 범위까지 전파하고 이후 이벤트를 폐기한다.
- 알 수 없는 이벤트 타입은 같은 major protocol 안에서 무시하되 지원하지 않는 `v`는 요청을 실패시킨다.

### 11.3 수치 검증

`src/lib/ai/brief.ts`의 숫자 화이트리스트는 아이디어를 재사용하되 그대로 확장하지 않는다. 현행 검증기는 `%`, `%p`, `건` 중심이며 날짜·시간·기간 전체를 검증하지 못한다.

일반 챗봇은 합성 전에 숫자 주장을 구조화한다.

```ts
interface GroundedClaim {
  text: string
  kind: 'count' | 'percent' | 'date' | 'time' | 'duration' | 'ordinal'
  value: string | number
  unit?: string
  sourceFactIds: string[]
}
```

- 모든 수치·날짜 주장은 Evidence Pack의 fact ID에 결속한다.
- 합계와 부분합이 다르면 도구 결과를 정답으로 사용한다.
- 서로 다른 기준일의 값은 한 숫자로 합치지 않고 기준일을 병기한다.
- 주장 검증이 실패하면 문장 일부만 삭제해 의미를 왜곡하지 않고 해당 구간을 결정형 표·목록으로 다시 렌더링한다.

## 12. 구조화 대화 상태

문자열 `history`는 표현 문맥에 사용하고, 엔티티 참조는 별도 `ConversationStateV1`으로 관리한다.

- 각 답변에서 사용한 상위 엔티티 최대 10개 저장
- “그 회의”, “두 번째 작업”, “S2”를 실제 ID로 해석
- 현재 탭의 메모리 또는 `sessionStorage`에 저장
- 프로젝트 전환, 대화 초기화, 로그아웃 시 폐기
- 서버는 전달받은 엔티티 ID의 권한과 프로젝트를 매번 재검증
- 1차에서는 서버 DB에 대화 내용을 영구 저장하지 않음

## 13. 권한·개인정보·프롬프트 인젝션

### 13.1 권한

- 모든 읽기 도구는 먼저 `AccessScopeResolver`로 사용자와 허용 프로젝트 범위를 확정한다.
- 현행 Supabase 어댑터는 사용자 세션 기반 서버 클라이언트와 RLS를 방어선으로 함께 사용한다.
- MySQL 어댑터는 RLS가 없다는 전제에서 모든 Repository 쿼리에 허용 범위를 fail-closed로 적용한다.
- service role은 색인 백필·비동기 색인 작업처럼 분리된 관리 경로에서만 사용한다.
- 전사 질문도 `AccessScopeResolver`가 현행 정책 또는 향후 ACL로 허용한 프로젝트만 집계한다.
- 도구별 필드 허용 목록을 정의한다.
- 관리자 전용 데이터는 챗봇 일반 도구에서 제외한다.

### 13.2 민감정보 기본 정책

| 데이터 | 기본 정책 |
|---|---|
| 멤버 이메일·계정 연결 정보 | 일반 답변에서 제외 |
| 근태 메모 | 집계와 유형 답변에서 제외. 별도 권한·명시 질문이 있어도 1차는 미지원 |
| 첨부파일 | 파일명·크기·등록시각만 제공. signed URL 자동 생성 금지 |
| 설정 | 프로젝트 운영 설정만 제공. 환경변수·API 키·서비스 계정 정보 금지 |
| 변경 이력 | 허용된 표시명·변경 필드만 제공. 내부 감사 메타데이터 제외 |

### 13.3 프롬프트 인젝션 방어

사용자 질문뿐 아니라 회의록·공지·주간업무 본문도 신뢰하지 않는 데이터로 취급한다.

- 도구 결과를 역할이 분리된 구조화 JSON으로 전달
- 문서 안의 명령문을 실행 지시가 아닌 인용 데이터로 표시
- 플래너가 문서 본문을 보고 새 도구나 권한을 만들 수 없도록 허용 목록 검증
- 도구 인자는 런타임 스키마 검증 후 실행
- 내부 시스템 프롬프트·키·권한 정보를 답변 데이터에 포함하지 않음

## 14. 실패·폴백·비용 정책

| 상황 | 처리 |
|---|---|
| LLM 미설정·429·타임아웃 | 현재 provider 폴백 체인 후 결정형 답변 |
| 벡터 검색 실패 | 키워드 검색 + 구조화 조회만 사용 |
| 단일 도구 실패 | 성공한 도구 근거로 부분 답변하고 누락 범위 명시 |
| 모든 도구 실패 | 데이터를 확인하지 못했다고 정직하게 답하고 재시도 안내 |
| 대상 모호 | 후보 최대 5개 제시 후 선택 요청 |
| 검색 결과 0건 | 유사 항목을 지어내지 않고 0건 명시 |
| 결과 과다 | 도구 상한 적용, `truncated`와 적용 필터 표시 |
| stale 색인 | 최신 DB 필드 우선, 장문 근거 제외 또는 신선도 경고 |

비용과 지연을 줄이기 위해 결정형 라우터 → 구조화 도구 → 필요 시 플래너/LLM 순서를 유지한다. 1차에서는 개인화된 도구 결과와 최종 답변을 공유 캐시하지 않는다. 캐시가 필요한 순수 집계에 한해 `userId`, capability 해시, 프로젝트, 도구 인자, 페이지 문맥, 원본 데이터 해시, 도구·프롬프트·모델·색인 버전을 키에 포함하고 짧게 유지한다. 대화 `history`나 `conversationState`에 의존하는 최종 답변은 캐시 대상에서 제외한다.

## 15. 데이터 접근 계층과 MySQL 전환 대응

메뉴 도구가 Supabase 쿼리를 직접 갖지 않도록 다음 경계를 둔다.

```ts
interface WbsRepository { /* 검색·상세·의존성·변경 이력 */ }
interface WeeklyRepository { /* 주차별 순수 읽기 */ }
interface MeetingRepository { /* 프로젝트/내 회의 */ }
interface MinutesRepository { /* 검색·상세 */ }
interface AttendanceRepository { /* 기간·멤버별 조회 */ }
interface AnnouncementRepository { /* 게시·검색 */ }
interface AttachmentMetadataRepository { /* signed URL 없는 메타데이터 */ }
interface ProjectRepository { /* 프로젝트·안전한 설정 */ }
interface KnowledgeIndex { /* upsert/delete/search/health */ }
interface AccessScopeResolver { /* 세션 사용자·역할·허용 프로젝트 확정 */ }
```

1차 구현은 기존 Supabase 쿼리와 세션/RLS 권한 판정을 Repository 구현으로 추출한다. 내부에서 `createServerClient()`를 직접 만들거나 `React.cache`에 묶인 기존 로더를 바깥에서 한 겹 감싸는 것만으로는 저장소 독립성이 생기지 않는다. Repository factory가 요청별 DB client·actor context를 주입받고, 상위 도메인·도구 계층은 Supabase 타입과 오류 코드를 알지 못하게 한다.

향후 MySQL 전환 시 Repository, KnowledgeIndex, 인증·`AccessScopeResolver` 어댑터를 교체하고 다음 DK Bot 상위 계약은 유지한다. 데이터 어댑터 분리는 챗봇 이전 범위를 줄일 뿐, 프로젝트 전체의 Supabase 종속성을 없애 주지는 않는다. Supabase Auth와 RLS를 제거하면 ACL·세션, Storage를 제거하면 파일 저장·signed URL, RPC/service role을 제거하면 배치·관리 작업을 별도로 재구현해야 한다.

- `PageContextV1`
- 도구 이름·입력·`ToolResult`
- Evidence Pack과 `BotSource`
- 라우터·플래너·합성기
- NDJSON 스트림과 UI
- 골든 질문 평가셋

pgvector는 MySQL 스키마에 직접 복제해야 하는 챗봇 계약이 아니다. MySQL의 적합한 벡터 기능 또는 별도 검색 저장소를 `KnowledgeIndex`로 연결한다.

## 16. 목표 메뉴 지원 범위

| 메뉴 | 목표 지원 | 후속·별도 승인 범위 |
|---|---|---|
| 대시보드 | 공정·지연·위험·마일스톤·회의 신호 | 시계열 비교 심화 |
| WBS·간트 | 검색·상세·계층·의존성·변경 이력·첨부 메타 | 개인 담당 관계 |
| 칸반 | 현재 모드·필터 기준 카드와 집계 | 카드 간 복합 비교 |
| 멤버 | 팀 구성·역할·팀 업무량 | 개인 담당 업무(스키마 필요) |
| 근태 | 기간·멤버·유형별 조회와 집계 | 민감 메모(별도 승인 필요) |
| 공지 | 게시·고정·카테고리·본문 검색 | 읽음 사용자 분석 |
| 회의 | 일정·반복·취소·장소·참석자·상세 | 회의 생성·변경 |
| 주간업무 | 실제 시트 내용·이슈·차주 계획·주차 비교 | AI 초안 작성 |
| 회의록 | 기존 문서/보관함 검색·결정·액션·위험 연계 | 프로젝트 직접 연결 강화 |
| 설정 | 안전한 프로젝트 운영 정보·색인 상태 | 계정·비밀 설정 |

## 17. 평가 체계와 수용 기준

### 17.1 골든 질문셋

주요 메뉴마다 다음 유형을 10~15개 이상 만들고 전체 100개 이상을 유지한다.

- 정확 항목 조회
- 기간·팀·상태 필터
- 집계와 비교
- 현재 화면·선택 항목 참조
- 후속 질문
- 두세 메뉴 결합
- 데이터 없음·모호함
- 접근 불가·민감 필드
- LLM·벡터 검색 장애 폴백

답변 문장 전체를 고정하지 않고 다음을 코드로 검증한다.

- 선택한 도구와 인자
- 반환한 엔티티 ID
- 날짜·건수·진행률
- 출처 ID와 내부 경로
- 권한 밖 데이터 부재
- 모름·재질문 판단

### 17.2 출시 수용 기준

- 골든셋 도구 라우팅 정확도 95% 이상
- 날짜·건수·진행률 등 구조화 수치 정확도 100%
- 검증 가능한 사실 주장마다 유효한 클릭 가능 출처 최소 1개 제공(100%). 인사말·재질문·“데이터 없음” 안내는 제외
- 현행 접근 정책 또는 향후 프로젝트 ACL이 허용하지 않은 프로젝트·필드 노출 0건
- “현재 주차”, “이 작업”, “그 회의” 문맥 질문 정상 해석
- 반복 회의의 “이 회의”는 시리즈와 특정 회차 날짜를 구분
- 데이터가 없거나 대상이 모호하면 추측하지 않음
- 조회 장애를 정상 0건으로 답하는 사례 0건
- LLM·벡터 검색 중단 시 핵심 구조화 질문 응답 가능
- 챗봇 질문 전후 업무 데이터 변경 0건
- 기존 DK Bot 구조화 답변과 Action Bot 회귀 테스트 통과
- 목표 성능: 첫 상태 이벤트 p95 1초 이내, 첫 답변 토큰 p95 3초 이내, 전체 응답 p95 10초 이내. 실제 기준선 측정 후 조정 가능

### 17.3 관측 지표

- 도메인·도구 선택 빈도와 실패율
- 무근거 답변률, 0건 응답률, 재질문률
- 출처 유효성·커버리지
- 검색 recall@10과 재순위화 효과
- DB·검색·LLM 단계별 지연
- 질문당 토큰·모델 호출 수
- stale 색인 수·증분 색인 지연
- 기존 DK Bot 폴백 비율

질문 원문은 운영 정책에 맞춰 익명화·보존 기간을 정한 뒤 수집한다. 민감한 본문과 도구 원본 결과를 기본 로그에 남기지 않는다.

## 18. 단계별 적용 계획

### Phase 0 — 기준선과 안전장치 (2~3일)

- 메뉴별 골든 질문 초안과 현재 실패율 측정
- 익명화된 라우팅·지연 로그
- v2 기능 플래그와 기존 DK Bot 폴백 스위치
- 신규 라우터·도구 계획을 실제 답변에 반영하지 않는 shadow mode. 우선 익명화 로그 오프라인 재생으로 운영하고, 라이브 실행은 최대 5% 샘플·별도 일일 RPM/비용 상한을 적용하며 현행 답변을 지연시키지 않음

완료 조건: 현행 품질 기준선과 롤백 경로가 확인됨.

### Phase 1 — 핵심 메뉴 MVP (7~10일)

- `PageContextV1`과 `BotPageContextProvider`
- 인증·프로젝트 범위 확정 계층
- WBS 상세·의존성, 실제 주간업무, 회의, 근태 읽기 도구
- 결정형 도메인 라우터
- Evidence Pack, 출처 링크, v2 NDJSON 스트림
- WBS·주간업무·회의록은 단건 딥링크, 나머지 메뉴는 안전한 메뉴 루트 출처
- 메뉴별 대표 질문 자동 테스트

완료 조건: 현재 화면 지시형 질문과 핵심 단일 메뉴 질문이 출처와 함께 정확히 응답함.

### Phase 2 — 교차 메뉴와 장문 검색 (7~12일)

- 제한된 AI 도구 플래너와 병렬 실행
- 공지·회의록·칸반·대시보드·멤버·안전한 설정 도구
- 일반화된 KnowledgeIndex, 키워드+벡터 혼합 검색
- 증분 색인과 정합성 복구
- 구조화 대화 상태
- 회의·근태·공지·멤버·설정 페이지의 선택·필터 query parameter 계약과 상세 딥링크

완료 조건: 2~3개 메뉴를 결합한 질문과 후속 질문이 유효한 근거를 제공함.

### Phase 3 — 안정화 (4~6일)

- 권한·개인정보·프롬프트 인젝션 테스트
- 수치·출처 검증기
- 성능·토큰 최적화와 캐시
- 프로젝트 또는 사용자 단위 점진 배포
- 운영 지표와 오류 대시보드

완료 조건: §17 수용 기준 충족 및 기능 플래그 해제 승인.

숙련 개발자 1명 기준 핵심 MVP는 약 1.5~2주, 전체 고도화는 약 3~5주의 초기 추정치다. 이 수치는 **현행 인증 사용자 전체 읽기 정책 유지**, 기존 배포 환경에서 워커 실행 가능, 신규 프로젝트 ACL 미포함을 전제로 한다. ACL 신설 여부, 일반 색인 물리 구조와 워커 인프라를 §21에서 확정한 뒤 일정을 다시 산정한다.

## 19. 예상 코드 변경 지도

구현 시 파일명은 세부 계획 단계에서 확정하되 책임 경계는 다음처럼 둔다.

```text
src/components/chat/
  DkBot.tsx                    # v2 요청·NDJSON·출처·상태 소비
  BotPageContextProvider.tsx  # 메뉴 문맥 등록

src/app/api/chat/v2/stream/
  route.ts                    # 인증·검증·이벤트 스트림

src/lib/ai/chat/
  orchestrator.ts             # 전체 흐름
  router.ts                   # 결정형 도메인 라우터
  planner.ts                  # 제한된 도구 계획
  evidence.ts                 # 공통 근거 조립
  verifier.ts                 # 숫자·출처 검증
  protocol.ts                 # 요청·NDJSON 타입

src/lib/ai/tools/
  registry.ts
  wbs.ts
  weekly.ts
  meetings.ts
  attendance.ts
  announcements.ts
  minutes.ts
  dashboard.ts
  members.ts
  settings.ts

src/lib/repositories/
  types.ts                    # 저장소 독립 인터페이스
  supabase/*                  # 1차 어댑터

src/lib/authz/
  accessScope.ts              # 세션·역할·허용 프로젝트 범위

src/lib/ai/index/
  types.ts                    # KnowledgeIndex
  pgvector.ts                 # 현행 Supabase 어댑터

src/app/(app)/*/page.tsx
src/app/(app)/p/[projectId]/* # Phase 2 상세 출처용 query parameter 소비
```

현행 `src/lib/ai/answer.ts`, `knowledge.ts`, `intent.ts`와 `/api/chat/*`는 v2 안정화 전까지 유지한다. 한 번에 교체하지 않고 기능 플래그로 트래픽을 이동한다.

## 20. 배포와 롤백

1. 선택적 `pageContext`를 받아도 기존 요청이 동작하도록 하위 호환 유지
2. shadow mode로 라우팅·도구 계획과 현행 답변을 비교
3. WBS·주간업무·회의부터 기능 플래그로 시범 적용
4. 근태·공지·회의록·칸반·설정 순으로 확대
5. 장문 검색 인덱스를 백필하고 누락률·신선도 확인
6. 사용자 또는 프로젝트 단위로 점진 배포
7. 안정화 이후에만 기존 의도 분류와 WBS 전용 색인의 제거 여부 결정

문제 발생 시 v2 플래그를 끄고 기존 `/api/chat/stream`으로 즉시 복귀한다. 업무 테이블과 기존 Action Bot 계약은 변경하지 않으므로 롤백이 챗봇 계층에 한정되어야 한다.

## 21. 구현 착수 결정 사항

| 항목 | 권장안 | 결정 주체 | 시점 |
|---|---|---|---|
| 1차 시범 메뉴 | WBS → 주간업무 → 회의 → 근태 | 사용자/제품 | 구현 착수 전 |
| 프로젝트 읽기 정책 | 1차는 현행 인증 사용자 전체 읽기 유지. 프로젝트별 비공개가 필요하면 챗봇과 분리한 ACL 선행 프로젝트로 진행 | 사용자/보안 | 구현 착수 전 |
| 회의록 프로젝트 범위 | 1차는 연결된 `meeting_id` 역참조, 필요 시 `project_id` 추가 | 사용자/기술 | Phase 2 전 |
| 개인 담당자 스키마 | 1차 제외, 실제 요구가 확인되면 `wbs_item_assignees` 추가 | 사용자/제품 | Phase 2 전 |
| 근태 메모 노출 | 1차 미지원 | 사용자/보안 | 확대 적용 전 |
| 일반 색인 물리안 | `ai_documents` + `ai_index_jobs`, 기존 두 색인과 병행 후 전환 | 기술 | Phase 2 전 |
| 검색 저장소 | 현행 Supabase는 pgvector 유지, MySQL 이전 시 `KnowledgeIndex` 어댑터 재결정 | 기술 | DB 이전 설계 시 |
| 상세 딥링크 | Phase 1은 메뉴 루트 허용, Phase 2에 화면별 query parameter 계약 추가 | 사용자/제품 | Phase 2 전 |
| 성능 목표 | §17 임시 목표로 계측 후 조정 | 기술/운영 | Phase 0 종료 시 |

구현 착수 시 위 권장안을 적용했다. 1차 읽기 범위는 현행 RLS와 동일하게 유지하고,
WBS → 주간업무 → 회의 → 근태를 v2 시범 메뉴로 확정했다. 근태 메모, 참석자 이메일,
Storage 경로·signed URL은 근거에서 제외했다. 회의록 통합 범위, 개인 담당자 스키마,
상세 딥링크와 운영 성능 기준은 Phase 2/3의 별도 승인 항목으로 남긴다.

## 22. 구현 착수 체크리스트

- [x] 본 설계의 1차 시범 메뉴와 범위를 사용자 확인
- [x] 현행 전체 읽기 유지 또는 프로젝트별 ACL 선행 여부 결정
- [ ] 현행 질문 로그의 수집·익명화 정책 확인
- [ ] 메뉴별 골든 질문 100개 이상 작성
- [ ] 권한별 테스트 계정과 프로젝트 경계 데이터 준비
- [x] `getWeeklySheet`와 조회 중 쓰기가 발생하는 다른 로더 분리 목록 확정
- [x] 정상 0건과 조회 실패를 구분하는 strict Repository 계약 테스트
- [ ] 회의록의 프로젝트 범위 규칙 확정
- [x] 기능 플래그와 기존 스트림 롤백 방법 확정
- [ ] shadow mode 운영 비교
- [x] Supabase 현행 구현과 향후 MySQL 어댑터 경계 검토
- [x] 세부 구현 계획 문서를 별도로 작성한 뒤 코드 작업 시작

---

이 문서는 메뉴 인식형 DK Bot 고도화 설계의 정본이다. 구현 범위와 남은 단계는
[구현 계획 및 현황](../plans/2026-07-19-dkbot-menu-aware-copilot-implementation.md), 설치·기능 플래그·모델·기존 WBS RAG 운영 방법은
[현행 운영 문서](../../dkbot.md)를 따른다.
