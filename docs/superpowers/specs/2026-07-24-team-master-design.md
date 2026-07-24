# 팀 기준정보 런타임 마스터 — 설계 (2026-07-24, 승인됨)

## 배경 / 문제

팀 목록(PMO/ERP/MES/가공/MDM)이 단일 기준 없이 코드 전체에 하드코딩되어 있다:

- `src/lib/domain/types.ts` — `type TeamCode = 'PMO' | 'ERP' | 'MES' | '가공' | 'MDM'` (컴파일 타임 유니언)
- 동일 배열이 약 25개 파일에 중복: 회의록 탭(`lib/domain/minutes.ts` TEAM_CODES), 칸반(`lib/domain/kanban.ts`, `components/kanban/KanbanBoard.tsx`), 근태(`AttendanceView.tsx` FILTER_TEAMS), 멤버(`MembersBoard.tsx`), 대시보드(`lib/domain/dashboard.ts` ALL_TEAMS/PROGRESS_TEAMS), 주간보고(`lib/report/weekly.ts` REPORT_TEAMS), 계정(`lib/domain/accounts.ts` TEAM_CODES), WBS(`lib/domain/subact.ts`, `lib/repositories/supabase/wbs.ts` mapOwners/teamCode/order), AI 도구 10곳(`lib/ai/tools/*`, `lib/ai/analytics.ts`), 엑셀(`lib/excel/parse.ts` TEAM_COL 열 고정, `lib/excel/export.ts` 헤더)
- DB CHECK 제약: `teams.code`, `minutes.team_code`
- 과거 팀 변경(0014 DT→가공, 0035 MDM 추가)마다 마이그레이션 + 수십 파일 수정이 필요했다.

DB에는 이미 `teams` 마스터 테이블(id/code/name)이 있고 `item_owners`·`memberships`는 `team_id` FK다. `minutes.team_code`만 문자열 저장.

## 사용자 결정 (2026-07-24)

1. **런타임 팀 마스터** — DB `teams`를 단일 기준으로, 관리자 화면에서 코드 수정 없이 추가/비활성/정렬.
2. **엑셀 임포트 헤더 이름 기반 전환** — 새 팀은 엑셀에 열만 추가하면 임포트.
3. **삭제 = 비활성화(숨김)** — 데이터 보존, 복구 가능.

## 설계

### 1. DB — 마이그레이션 0044

- `teams` 컬럼 추가: `sort_order int not null default 0`, `active boolean not null default true`, `progress_visible boolean not null default true`.
- 시드: 기존 5팀 sort_order = PMO 0, ERP 1, MES 2, 가공 3, MDM 4. `progress_visible`: MDM만 false(대시보드 '팀별 진척현황' MDM 제외 규칙의 데이터화).
- CHECK 제약 제거: `teams.code`(0035 버전), `minutes.team_code`(0035 버전). 검증은 앱 계층이 마스터 대조로 수행.
- RLS: `teams` 읽기 authenticated 전체, 쓰기(insert/update) `pmo_admin` 전용. delete 정책 없음(비활성화만).
- 롤백 스크립트 동반. 배포 순서: **DB 먼저**(제약 제거·컬럼 추가는 구코드에 무해) → 코드. 운영 적용은 Supabase Management API 레시피.

### 2. 단일 소스 + 캐시 — `src/lib/teams/master.ts` (server-only)

`lib/ai/llm-override.ts`의 검증된 패턴 축소판:

- `Team = { id, code, sortOrder, active, progressVisible }` (표시명 = code. `teams.name`은 code와 동기 유지)
- 인메모리 캐시 + TTL 60초 + 로드 직렬화 큐, 실패 시 직전 유효값 유지(stale ≠ fail-open), 콜드스타트 실패 시에만 현행 5팀 하드코딩 폴백(`DEFAULT_TEAMS`) — 가용성 우선, 현재 동작과 동일.
- `getTeams(opts?)` → active만(기본) 또는 전체, `refreshTeams()`(관리 액션 저장 후 await), `isActiveTeamCode(code)`.

### 3. 타입 전환

- `TeamCode`를 `string` 별칭으로 전환(타입명 유지 → 30곳 컴파일 유지).
- `Record<TeamCode, …>` 사용처는 미등록 팀 폴백 추가: mapOwners 정렬 order, `TEAM_SUBGROUPS`(미등록 팀 = `[자기 자신]`), `ai/tools/weekly.ts` 팀→구분 매핑.

### 4. 클라이언트 전달 — `TeamsProvider` / `useTeams()`

- `(app)/layout.tsx` 서버에서 활성 팀 목록 1회 fetch → React context. 클라이언트 컴포넌트의 하드코딩 배열 전부 교체(회의록 탭·업로드/수정 모달·챗 필터, 칸반, 근태 필터, 멤버 보드, WBS 시트, 계정 관리 팀 셀렉트).
- URL 파라미터 기반 팀 필터 검증(attendance, kanban)도 이 목록 대조.

### 5. 서버 소비처

- 서버 액션·API(`api/v1/minutes` 등)·AI 챗봇 도구 10곳의 팀 검증 → `getTeams()` 대조.
- `lib/report/weekly.ts` REPORT_TEAMS, `lib/domain/dashboard.ts` ALL_TEAMS/PROGRESS_TEAMS(→ `progress_visible` 필터), `lib/ai/analytics.ts` TEAMS → 호출측에서 팀 목록 주입(순수 함수는 파라미터로 받음 — 도메인 계층 I/O 금지 원칙 유지).

### 6. 엑셀 — 헤더 이름 기반

- **임포트**(`lib/excel/parse.ts`): 3행 헤더(row index 2)에서 열 맵 구성. 팀 열 = 'Activity' 열 이후 ~ '산출물' 열 이전의 비어있지 않은 헤더. '산출물'·'시작'·'종료'·'가중치'·'실적%'도 헤더 이름으로 탐색(팀 수가 변하면 뒤 열이 전부 밀리므로). 헤더 탐색 실패 시 현행 고정 인덱스 폴백(기존 파일 호환).
- **미등록 팀 헤더 = 임포트 에러**로 팀명 명시 안내(팀 마스터 등록 선행). 마스터가 소스 오브 트루스.
- **익스포트**(`lib/excel/export.ts`): 활성 팀으로 헤더·데이터 열 동적 생성.

### 7. 회의록 연동

- 팀 추가 관리 액션이 **자동 편철용 시드 루트 폴더**(`created_by null`, 팀코드 동명)를 함께 생성 — 0043 앵커 계약 유지.
- `isTeamRootName`/`isTeamRootFolder`/`isTeamSeedFolder`는 팀 목록을 파라미터로 받도록 변경(순수 함수 유지).
- 비활성 팀: 새 회의록 등록 탭에서 숨김, 기존 회의록 표시는 유지(team_code 문자열이라 무손실).

### 8. 관리 화면 — `/admin/teams`

- `/admin/accounts`·`/admin/llm-config` 패턴, `pmo_admin` 전용 게이트.
- 기능: 팀 추가(코드=표시명 단일 입력, 중복·예약어 검증), 정렬 변경, 활성 토글, 진척현황 표시 토글. 삭제 버튼 없음(비활성화가 삭제).
- 저장 액션은 `refreshTeams()` await 후 revalidate.

## 스코프 제외 (명시)

- **팀 개명(rename) v1 제외** — `minutes.team_code` 일괄 치환 + 회의록 시드 폴더명 변경 + 편철 앵커 연쇄가 필요한 별도 작업. 후속 분리.
- **주간보고 10구분(WEEKLY_SECTIONS)·ERP/MES 하위 구분(TEAM_SUBGROUPS 내용) 고정 유지** — 팀 축이 아닌 업무영역 축이며 확정된 PPT 양식·시드 폴더 트리와 결합. 별도 기준정보화는 후속.
- 신규 팀의 주간보고 구분·회의록 하위 구분은 '자기 자신' 1개 기본.

## 에러 처리

- 팀 마스터 로드 실패: 직전 유효 캐시 유지, 없으면 DEFAULT_TEAMS 폴백 + `console.error`(에러 삼킴 금지 원칙).
- 관리 액션: 쓰기 전 중복/예약어 재검증(CAS 불필요 — 단순 insert/update), 실패는 사용자에게 표시.
- 엑셀 미등록 팀: 조용한 스킵 금지 — 팀명을 담은 명시적 에러.

## 테스트

- 기존 픽스처(5팀)는 DEFAULT_TEAMS 폴백·파라미터 기본값으로 대부분 무변경.
- 신규: 헤더 열 맵 파싱(정상/열 추가/미등록 팀/폴백), 팀 마스터 캐시(TTL·실패 유지·refresh), 관리 액션(권한·중복·예약어), 팀 추가 시 시드 폴더 생성, TEAM_SUBGROUPS 미등록 폴백.
