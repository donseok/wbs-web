# DK Bot 메뉴 인식형 코파일럿 구현 계획 및 현황

- 기준 설계: `docs/superpowers/specs/2026-07-19-dkbot-menu-aware-copilot-design.md`
- 착수일: 2026-07-19
- 적용 원칙: 기존 읽기 챗봇과 Action Bot을 유지하고, v2를 독립 경로로 추가한다.
- 롤백: `CHAT_V2_ENABLED=true`일 때만 v2가 활성화되며, 미설정/`false`이면 클라이언트가 기존 `/api/chat/stream`으로 복귀한다.

## 확정한 1차 전제

- 프로젝트 읽기 범위는 현행 RLS와 동일하게 인증 사용자가 조회할 수 있는 프로젝트 전체다.
- 핵심 메뉴 우선순위는 WBS → 주간업무 → 회의 → 근태다.
- 쓰기 명령은 기존 제안·확인 카드 경로만 사용하며 v2 도구는 읽기 전용이다.
- 근태 메모, 참석자 이메일, Storage 경로·signed URL은 챗봇 근거에서 제외한다.
- Supabase 쿼리는 strict Repository 뒤에 두고, 상위 도구·오케스트레이터는 저장소 타입을 알지 않는다.

## 구현 단위

### Phase 1 — 핵심 메뉴 MVP

- [x] `PageContextV1`, 메뉴 등록 Provider, 선택 엔티티·기간·필터 전달
- [x] v2 NDJSON 요청/응답과 기존 스트림 폴백
- [x] 정상 0건과 조회 실패를 구분하는 strict Repository 계약
- [x] WBS 검색·상세·의존성 도구
- [x] 실제 주간업무 pure-read 도구
- [x] 프로젝트 회의 목록·반복 회차·상세 도구
- [x] 근태 기간·팀·유형 도구
- [x] 근태→멤버 프로젝트 일치 fail-closed 조회 및 신규 쓰기용 복합 FK migration
- [x] Evidence Pack, 내부 출처 검증, 수치·날짜 검증, 결정형 폴백
- [x] capability와 서버 확정 프로젝트 범위의 이중 검증
- [x] 기존 화면·Action Bot 회귀를 위한 독립 v2 경로와 kill switch

### Phase 1 상세 확장

- [x] WBS 변경 이력
- [x] WBS 첨부 metadata-only 조회
- [x] 주간업무 두 주차 비교
- [x] 전역 내 회의 조회

### Phase 2 기반

- [x] 일반 문서/증분 작업 큐 migration 코드 (`ai_documents`, `ai_index_jobs`)
- [x] KnowledgeIndex 인터페이스와 pgvector 어댑터
- [x] 하이브리드 결과 병합, stale 판정, 5회 재시도/dead-letter 순수 정책
- [x] 엔티티 재청킹 원자적 교체 RPC와 프로젝트 범위를 포함한 안정 키
- [x] 공지·회의록·칸반·대시보드·멤버·안전 설정 도구 (2026-07-19 — 신규 도구 9종, 총 20종)
- [x] 제한된 2단계 플래너와 결과 binding (2026-07-19 — `CHAT_V2_PLANNER_ENABLED` opt-in, 기본 OFF)
- [x] 증분 색인 워커·정합성 검사·백필 및 shadow 검색 (2026-07-19 — 0033 claim/lease·generation
      CAS·tombstone, 보호 라우트 `/api/chat/index/worker`, cron·enqueue 배선은 배포 결정으로 유보)
- [x] 상세 query parameter 딥링크 계약 (2026-07-19 — 회의/내 회의 `?focus=&date=`, 근태
      `?from&to&team&type`, 공지 `?focus=`, 멤버 `?team=`, 칸반 `?view=&team=`; `deep-links.ts` 단일 정본)

### Phase 3 안정화

- [x] 요청·도구 인자 상한, 교차 프로젝트·외부 링크 fail-closed 테스트
- [x] LLM 장애 시 구조화 결정형 답변
- [ ] 익명화된 운영 지표와 성능 계측
- [x] 골든 질문셋 118개 (2026-07-19 — `tests/ai/golden/`, 결정형 픽스처 기반. 10개 메뉴 +
      교차·후속·장애 폴백·프롬프트 인젝션. 운영 데이터 재생 기반 확장은 지표 수집 후 후속)
- [ ] 프로젝트/사용자 단위 점진 배포와 기능 플래그 해제 승인

## 배포 순서

1. 근태 신규 쓰기 무결성이 필요하면 `0032_attendance_member_project_integrity.sql`을 적용하고,
   기존 불일치 행을 정리한 뒤 `attendance_member_project_fk`를 `VALIDATE`한다.
2. Phase 2 검색 실험을 시작할 때만 `0031_ai_knowledge_index.sql`을 기존
   `wbs_embeddings`, `minute_embeddings`를 유지한 채 별도로 적용한다.
3. v2 코드를 배포하고 테스트 환경에서 `CHAT_V2_ENABLED=true`로 핵심 메뉴를 검증한다.
4. 미지원 도메인과 명시적 kill switch가 기존 스트림으로 복귀하는지 확인한다.
5. WBS → 주간업무 → 회의 → 근태 순으로 실제 질문을 점검한다.
6. 운영 초기에는 결정형 답변을 유지하고, 골든 질문 검증 뒤에만
   `CHAT_V2_LLM_SYNTHESIS_ENABLED=true`를 별도로 시험한다.
7. 오류율·출처 유효성·응답 시간을 확인한 뒤 운영 트래픽을 확대한다.

`0031_ai_knowledge_index.sql`은 아직 기존 답변 경로의 필수 의존성이 아니다. 실제 적용,
백필, 업무 변경 경로 enqueue, 보호된 워커/cron 연결, shadow 검색 전환은 Phase 2 배포 작업으로 남아 있다.
특히 워커는 원자적 claim/lease, 작업 generation CAS, generation-aware delete/tombstone이
구현되기 전에는 연결하지 않는다. 현재 큐 코드는 스키마·enqueue·재시도 정책 기반까지만 제공한다.

## 구현 검증

2026-07-19 Phase 2 완료 시점(종합 코드 리뷰 Critical/High 0건 + Medium/Low 20건 반영 포함):

- 전체 Vitest: 137개 파일, **1,458개 테스트 통과** (골든 질문셋 118개 포함)
- TypeScript `tsc --noEmit` 통과
- ESLint 통과
- Next.js production build 통과(`/api/chat/v2/stream`, `/api/chat/index/worker` 포함)
- `git diff --check` 통과
- 0031(리뷰 반영 수정)/0032/0033 PostgreSQL 정적 감사 통과. 실제 DB 적용은 미수행 —
  v2는 셋 다 없이 완전 동작하며, 0031→0033은 색인 실험 시작 시점에 적용(0031의
  `match_ai_documents` 확장 반환 계약이 현 벡터 검색 어댑터의 전제)

## MySQL 전환 경계

MySQL로 이전할 때 교체 대상은 인증/접근 범위 resolver, Repository 구현, KnowledgeIndex 구현이다. 다음 계약은 유지한다.

- `PageContextV1`, `ConversationStateV1`
- 도구 이름·입력·`ToolResult`
- Evidence Pack과 출처 계약
- 라우터·오케스트레이터·NDJSON 이벤트
- 클라이언트 DkBot UI와 Action Bot 확인 흐름

Supabase Auth/RLS/Storage/RPC까지 제거한다면 MySQL 테이블 변환과 별개로 세션, ACL, 파일 저장, 배치 실행 어댑터가 추가로 필요하다.
