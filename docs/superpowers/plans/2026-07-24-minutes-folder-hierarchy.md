# 회의록 폴더 하이어라키 재편 + 팀 자동 편철 (2026-07-24)

## 배경

0040이 시드한 회의록 폴더는 주간업무 10구분(PMO·영업·구매·관리회계·품질·생산계획·조업및표준화·물류·설비및L2·가공)의 평면 나열이었고, 회의록 등록 경로(앱 업로드·또박또박 외부 API) 어느 쪽도 폴더를 자동 지정하지 않아 전 회의록이 미분류(folder_id null)에 쌓였다(재편 시점 39건 전량).

## 결정

1. **최상위 = 팀코드 5축** (`TEAM_CODES` 순서와 동일): PMO · ERP · MES · 가공 · MDM.
   - ERP 하위: 영업 / 구매 / 관리회계
   - MES 하위: 품질 / 생산계획 / 조업및표준화 / 물류 / 설비및L2
   - PMO·가공은 단독 루트 유지. MDM 루트 신설 — 기존 '미분류 = 사실상 MDM 대기소' 상태 해소.
2. **자동 편철**: 신규 회의록은 폴더 미지정 시 담당 팀과 동명인 루트 폴더로 편철.
   - 앱 업로드(`createMinute`) — 모달의 폴더 셀렉트 기본값('')이 '자동 (담당 폴더)'.
   - 외부 API(`POST /api/v1/minutes` insert) — 또박또박 업로드가 팀 폴더로 바로 들어간다.
   - 조회 실패·루트 부재는 null(미분류) 폴백 — 편철이 등록을 막지 않는다(fail-open + 로깅).
   - replace(upsert 갱신)·메타 수정은 폴더를 건드리지 않는다 — 수동 이동을 존중.
3. **미분류는 예외 버킷으로 강등**: 폴더 삭제 시 강등분만 담는다. 탐색기 레일·전체 카드에서
   0건이면 숨김(현재 스코프가 미분류면 행 유지). 이동 픽커에서는 여전히 명시 선택 가능.
4. **백필**: 미분류 잔량을 팀코드 → 동명 시드 루트로 일괄 편철(0043). updated_at 무변경 —
   조직 백필이 외부 연동 GET의 갱신 신호로 비치면 안 됨.
5. **시드 고정 + 앵커 보호** (리뷰 워크플로 확정 발견 반영): 자동 편철·마이그레이션의 루트
   매칭은 전부 `created_by is null`(시드) 한정 — 동명 사용자 루트 폴더(스쿼팅)가 전사 편철을
   하이재킹하지 못한다. 서버 액션 가드: 루트에 팀코드 동명 폴더 생성·개명 금지(예약어),
   시드 팀 루트(5축)는 개명·삭제 금지(개명되면 편철이 조용히 끊기고, 삭제되면 cascade 소실).
   UI(탐색기 메뉴)도 동일 기준으로 개명·삭제 숨김. 근거: `isTeamRootName`/`isTeamRootFolder`
   (src/lib/domain/minutes.ts).

## 산출물

- `supabase/migrations/0043_minute_folder_hierarchy.sql` + `scripts/apply-0043.mjs` (Management API 단독 적용, db push 금지)
- `src/lib/minutes/folders.ts` `resolveTeamRootFolderId` — actions·admin 클라이언트 겸용
- `src/app/actions/minutes.ts` createMinute / `src/app/api/v1/minutes/route.ts` insertNew 편철 연결
- `MinutesExplorer` 미분류 조건부 표시 / `MinuteUploadModal` '자동' 라벨 / i18n `min.fold.autoTeam`

## 비고

- DB 스키마 무변경(0040 구조 그대로) — 데이터 재배치·백필뿐. 단 적용 순서는 **0043 → 코드 배포**
  (코드 선배포 시 시드 루트 생성 전 창구에서 팀코드 동명 루트 선점 여지가 남는다).
- 0043 재실행 주의: 구조 단계는 멱등이나 백필은 재실행 시점의 미분류 잔량도 재편철 — 1회성 전제.
- 롤백: 폴더 재배치는 parent_id/sort 원복 update, 백필은 적용 직후라면
  `update minutes set folder_id=null where ...`로 가역(시간이 지나면 신규 자동 편철분과 구분 불가).
- apply-0043.mjs 의 pg 직결 폴백은 기존 apply-00xx 템플릿과 동일하게 `rejectUnauthorized: false`
  (기본 경로는 Management API 토큰이라 실사용 없음 — 템플릿 정합 유지, 리뷰 지적 인지됨).
