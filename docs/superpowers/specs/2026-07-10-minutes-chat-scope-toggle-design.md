# 뷰어 채팅 범위 전환 (이 문서 ↔ 전체 회의록) — 설계

- 날짜: 2026-07-10
- 상태: 승인됨 (접근 방식 A)
- 관련: `src/components/minutes/MinuteChatPanel.tsx`, `src/components/minutes/ArchiveChatPanel.tsx`

## 배경

회의록 뷰어(`/minutes/[id]`)의 우측 채팅 패널은 현재 열려 있는 회의록 한 건(doc 모드)만 근거로 답한다.
사용자는 뷰어를 벗어나지 않고 전체 회의록(보관함 전체)에 대해서도 질문하고 싶다.

백엔드(`POST /api/minutes/chat`)는 이미 `mode: 'archive'` + 필터 null 조합으로 전체 검색을
지원하므로(벡터 RAG + 키워드 정확 일치 + 출처 부기), 이 건은 **프론트엔드 전용 변경**이다.

## 결정 사항

| 항목 | 결정 |
|------|------|
| 요청 범위 | 뷰어 채팅에 범위 전환 추가 (보관함 채팅의 월 제한은 범위 외) |
| 대화 이력 | 범위별 대화 분리 — 각 범위가 독립 스레드, 전환해도 보존 |
| 전체 범위 필터 | 없음 (`team/from/to = null`) — 진짜 전체 회의록 대상 |
| 백엔드 | 변경 없음 |

## UI

`MinuteChatPanel.tsx` 수정:

- 패널 헤더 영역에 `SegmentedTabs<'doc' | 'archive'>` 토글 — `이 문서 | 전체 회의록` (size sm).
- 범위별로 `useMinutesChat` 인스턴스를 2개 유지한다. 토글은 표시할 스레드만 바꾼다.
  - doc 스레드: `{ mode: 'doc', minuteId, message, history }` (기존 그대로)
  - archive 스레드: `{ mode: 'archive', message, history, filters: { team: null, from: null, to: null } }`
- reset(대화 초기화) 버튼은 현재 보이는 스레드만 초기화한다.
- archive 답변에는 출처로 `/minutes/<uuid>` 경로가 붙으므로 `linkifyMinutePaths`를 적용해
  다른 회의록으로 바로 이동할 수 있게 한다.

## 컴포넌트 변경

- `linkifyMinutePaths`를 `ArchiveChatPanel.tsx`에서 공용 위치로 이동
  (예: `MinuteChatPanel.tsx` 또는 `minutes` 공용 모듈) — `ArchiveChatPanel`과
  `MinuteChatPanel`(archive 범위)이 공유. 동작 변경 없음: 내부 `/minutes/<uuid>` 경로만
  링크화, 외부 URL은 텍스트 유지(피싱 표면 차단).

## 데이터 흐름

변경 없음. 인증 게이트, RLS, 스트리밍, 429 폴백, self-heal 모두 기존 파이프라인 그대로.

## i18n

`src/lib/i18n/dict/minutes.ts`에 키 2개 추가 (ko/en):

- `min.chat.scope.doc`: `이 문서` / `This doc`
- `min.chat.scope.all`: `전체 회의록` / `All minutes`

## 에러 처리

기존 `useMinutesChat`의 에러/빈 응답/스트림 중단 처리 그대로. 신규 에러 경로 없음.

## 테스트·검증

- `linkifyMinutePaths` 이동 시 기존 테스트가 있으면 함께 이동, 없으면 이동만.
- `npm run build` + lint 통과.
- UI 토글 동작은 배포 후 사용자 수기 검증 (샌드박스에서 브라우저 검증 불가 —
  build/lint/curl 로 대체하는 기존 관례 따름).

## 범위 외

- 보관함 채팅(리스트 페이지)의 현재 월 필터 제한 해제 — 별도 건.
- 하이브리드 모드(문서 우선 + 보관함 보강) — YAGNI.
