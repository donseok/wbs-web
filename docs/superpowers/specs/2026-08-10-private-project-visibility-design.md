# 비공개 프로젝트 (UI 숨김) 설계

- 날짜: 2026-08-10
- 상태: 승인됨 (사용자 확정)
- 발단: "MES Pilot 멤버들만 이 프로젝트를 확인할 수 있으면 좋겠다"

## 결정 사항 (사용자 확정)

1. **강도 = 화면 숨김.** DB(RLS) 잠금이 아니다. URL 을 아는 사용자의 직접 접근과
   하위 테이블 PostgREST 직접 조회는 막지 않는다. 이것은 보안 경계가 아니라 노출 억제다.
2. **저장 = 프로젝트별 설정.** 하드코딩이 아니라 `projects.is_private` 플래그.
   다른 프로젝트에도 재사용 가능.
3. **토글 = 슈퍼유저 전용 UI.** 프로젝트 설정 페이지에 스위치. 프로젝트 관리자에게는
   보이지 않는다. (사용자가 "DB에서만"을 뒤집어 토글 UI 로 확정.)
4. **범위 반 발짝 확장 승인됨:** 챗봇 accessScope 와 회의록 표면(달력·검색·탐색기)도
   같은 규칙으로 거른다 — 목록에서 숨겼는데 챗봇·탐색기가 답하면 목적이 무색해지므로.

## 판정 규칙 (단일 정의)

`src/lib/domain/authz.ts` 에 순수 함수 하나:

```
canSeeProject(actor, { id, is_private }) =
  !is_private            → true   (공개 프로젝트는 기존과 동일)
  actor 없음(비로그인)    → false  (fail-closed)
  actor.isSuperuser      → true
  actor.projectRoles.has(id) → true  (admin/member 무관)
  그 외(viewer)           → false
```

기존 원칙 준수: 판정은 `domain/authz.ts`(순수) 한 곳, 액션에 `role === '...'` 직접 비교 금지.

## 스키마

`supabase/migrations/0070_private_projects.sql` (+ `_rollback.sql`, 코드와 별도 커밋 — G1):

```sql
alter table public.projects add column is_private boolean not null default false;
```

- RLS 변경 없음(화면 숨김 수준이므로).
- `fetchProjects()` 가 `select('*')` 라 컬럼이 자동으로 실려온다.
- MES Pilot 에 켜는 것은 배포 후 슈퍼유저가 토글로 직접.

## 필터 지점

| 지점 | 파일 | 방식 |
|---|---|---|
| 프로젝트 목록(길목) | `src/app/actions/project.ts` `listProjectsWithState` | `getActor()` 후 `canSeeProject` 필터. 사이드바·홈 그리드·회의록 프로젝트 필터·관리자 화면 등 20여 호출처가 자동 상속. `(app)/layout.tsx`(UI 위험 파일)는 무접촉 |
| 챗봇 스코프 | `src/lib/authz/accessScope.ts` | resolver 가 `is_private`·`project_roles`·`is_superuser` 를 함께 읽어 `allowedProjectIds` 에서 제외. RAG·도구·인덱스 검색이 전부 이 스코프를 상속 |
| 회의록 표면 | `src/lib/data/minutes.ts` `getMinutesPage`·`searchMinutes`·`getMinutesExplorer` | 숨김 프로젝트 id 집합 헬퍼로 후처리 필터. `projectId == null`(미지정)은 유지 |
| 비공개 토글 | 설정 페이지 + `setProjectPrivacy` 액션 | 슈퍼유저에게만 렌더, 액션은 `requireSuperuser()` 재검증(fail-closed) 후 admin client 로 쓰기 |

## 의도적으로 남기는 것

- **URL 직접 접근**: 허용(선택된 강도). 비멤버가 들어가면 페이지는 뜨되 히어로의
  프로젝트명은 fallback 으로 표시된다(설정 페이지 등은 이미 `project?.name ?? fallback`).
- **'내 회의' 달력**(`getMyMeetings`): 본인이 참석자인 회의만 나오므로 노출이 아니다.
- **하위 테이블 RLS**: 개방 유지. 외부 회의록 API(v1)·챗 인덱스 워커는 admin client
  경유라 영향 없음(서버 내부 용도).
- **agent-ops 드롭다운**: 슈퍼유저 화면이면 무변경(구현 중 가드 확인).

## 테스트

- `canSeeProject` 유닛(공개/비공개 × 비로그인/viewer/member/admin/superuser).
- 회의록 필터: 숨김 프로젝트 회의록 제외 + 미지정(null) 유지.
- 비멤버의 비공개 프로젝트 URL 직접 접근 시 크래시 없음(구현 중 수동 확인).

## 롤백

- 코드 revert 후 0070_rollback 적용(컬럼 drop). 순서는 코드 먼저(컬럼 참조 제거).
