# 프로젝트별 팀 + 역할 라벨 — 설계

작성: 2026-08-10. 상태: 사용자 승인(대화)·스펙 검토 대기.

## 0. 배경과 목표

현재 팀은 전역 마스터 하나(`teams`, 0044 런타임 마스터)이고 모든 프로젝트가 같은 팀
목록(PMO·ERP·MES·가공·MDM)을 공유한다. 프로젝트마다 조직이 다르므로 **각 프로젝트가
독자적인 팀 목록을 정의**하고, **명단의 각 사람에게 자유 입력 역할 라벨(표시용)** 을
부여할 수 있게 한다.

### 사용자 결정 (2026-08-10 대화)

| # | 질문 | 결정 |
|---|------|------|
| 1 | 프로젝트별 팀의 의미 | **프로젝트마다 독자 팀 목록** (전역 마스터의 부분집합 아님) |
| 2 | 역할의 성격 | **직무 라벨(표시용)** — 권한 연동 없음 |
| 3 | 프로젝트 축 없는 전역 기능(회의록·또박또박·계정·근태 계정축) | **전역 팀 유지, 이번 범위 밖** |
| 4 | 역할의 형태 | **자유 입력 텍스트** (마스터 없음) |
| 5 | 팀 코드 유니크 | **위키 FK 2건 제거 + (project_id, code) 복합 유일** — 프로젝트끼리·전역과 동명 허용 |
| 6 | 저장 구조 | **A안: `teams.project_id` + 폴백 규칙** (B안 별도 테이블·C안 jsonb 기각) |

### 설계 원칙

- **D-CUBE 회귀 0.** 팀을 정의하지 않은 프로젝트는 전역 팀으로 폴백 — 기존 데이터
  이동 0건, 기존 판정 로직은 빼지 않고 더하기만 한다.
- **전역 기능 봉쇄는 한 지점에서.** 기존 무인자 접근자(`teamsSync` 계열)가 전역 행만
  반환하도록 고정하면 회의록·또박또박·계정 등 호출처 30여 곳이 무수정으로 보호된다.

## 1. 데이터 모델

마이그레이션 1건(+`_rollback.sql`). 번호는 구현 시점 최신+1(현재 기준 0071 예상 —
리포에 0070 번호 충돌 2건이 이미 존재하며 이번 작업에서 건드리지 않는다).
코드 커밋과 분리(G1).

```sql
-- 1) 스코프 컬럼: null = 전역 팀(현행 5팀), 값 = 그 프로젝트 전용 팀
alter table teams add column project_id uuid references projects(id) on delete cascade;
create index idx_teams_project on teams(project_id);

-- 2) 코드 유니크 재편.
--    위키 FK 2건(wiki_topics/wiki_items.owner_team → teams(code), 0045)은 실질
--    무동작이다: 팀 개명 액션이 없고(on update cascade 발동 불가) 삭제 정책도
--    없다(on delete set null 발동 불가). 위키 기능·데이터는 무변경. (사용자 승인)
alter table wiki_topics drop constraint wiki_topics_owner_team_fkey;
alter table wiki_items  drop constraint wiki_items_owner_team_fkey;
alter table teams drop constraint teams_code_key;   -- ⚠️ 프로덕션 실명 확인 후 (0001 인라인 unique 자동명)
alter table teams add constraint teams_project_code_key
  unique nulls not distinct (project_id, code);      -- PG17. 전역(null)끼리도 중복 차단

-- 3) RLS: 프로젝트 팀은 프로젝트 관리자 쓰기. 전역 행은 종전대로 슈퍼유저(su_*) 전용.
--    delete 정책 없음(비활성화=삭제) 관례 유지.
create policy pa_insert_project_teams on teams for insert to authenticated
  with check (project_id is not null and public.is_project_admin(project_id));
create policy pa_update_project_teams on teams for update to authenticated
  using      (project_id is not null and public.is_project_admin(project_id))
  with check (project_id is not null and public.is_project_admin(project_id));

-- 4) 역할 라벨 (자유 입력, 표시용)
alter table project_members add column role_label text;
```

같은 마이그레이션에서 **권한 합집합**(§3)과 **임포트 RPC 팀 해석 스코프**(§5)도 함께
재정의한다(전부 DB 객체라 G1 위반 아님).

## 2. 팀 목록 해석 규칙

### 서버 — `src/lib/teams/master.ts`

- `Team` 타입에 `projectId: string | null` 추가. 캐시는 `teams` 전 행 로드(수십 행,
  단일 캐시 유지. TTL 60초·직렬화 큐·폴백 등 기존 계약 무변경).
- **기존 무인자 접근자는 전역 행만 반환**: `teamsSync()`, `activeTeamCodesSync()`,
  `isRegisteredTeamCode()`, `isActiveTeamCode()` 모두 `projectId === null` 필터.
  → 회의록·또박또박 API·계정 관리·`/admin/teams`·위키 인제스트 등 기존 호출처가
  무수정으로 현행 유지되고, 프로젝트 팀의 전역 유출이 이 한 지점에서 봉쇄된다.
- **신규 프로젝트 인식 접근자**:
  - `teamsForProjectSync(projectId)` — 그 프로젝트 행이 **하나라도 있으면(비활성 포함)**
    프로젝트 행만, 없으면 전역 행 폴백. 비활성 포함으로 판정해야 "전 팀 비활성화"가
    전역 상속으로 오해 복귀하지 않는다.
  - `activeTeamCodesForProjectSync(projectId)` / `isActiveTeamCodeForProject(code, projectId)` /
    `isRegisteredTeamCodeForProject(code, projectId)` — 동일 폴백 규칙.

### 클라이언트 — Provider 중첩

- `(app)/layout.tsx`의 전역 `TeamsProvider` 주입은 그대로.
- 기존 4줄 셸인 `src/app/(app)/p/[projectId]/layout.tsx`를 async로 바꿔
  `await params` → `teamsForProjectSync(projectId)` 활성 팀을 `TeamsProvider`로
  **중첩 주입**(React Context — 안쪽 승리).
- 검증 결과 프로젝트 스코프 소비처는 전부 `/p/` 하위에서만 렌더된다:
  WbsGanttSheet·RowDetailPanel, KanbanBoard, AttendanceView, MembersBoard,
  MemberPicker, ReportModal(dashboard·wbs 경유), ProjectInviteManager(`/p/*/settings`).
  → **컴포넌트 수정 없이** 프로젝트 팀 수신.
- 전역 화면 소비처(MinutesView·MinuteUploadModal·MinuteMetaModal·MinuteChatPanel·
  ArchiveChatPanel·AccountsManager)는 전역 Provider 값 유지.

### 서버 주입처 교체 (projectId를 아는 지점)

| 지점 | 현행 | 변경 |
|---|---|---|
| `DashboardView.tsx:87` (teamOrderMap) | `teamsSync` | `teamsForProjectSync(projectId)` |
| `TeamProgress.tsx:14` | `teamsSync` (projectId 접근 불가) | DashboardView가 teams를 **prop으로 전달** |
| `api/report/route.ts:111` | `activeTeamCodesSync` | 프로젝트 인식 |
| `api/export/route.ts:65` | `activeTeamCodesSync` | 프로젝트 인식 |
| `actions/risk.ts:40` (owner_overload) | `activeTeamCodesSync` | 프로젝트 인식 |
| `lib/data/wbs.ts:61`·`lib/repositories/supabase/wbs.ts:54`·`lib/data/snapshots.ts:68` (팀 정렬) | `teamsSync` | 프로젝트 인식 |
| `actions/wbs.ts` addSubAct 팀 해석 | teams 전역 code 조회 | 프로젝트 팀 우선 해석(§5) |

## 3. 권한 — 합집합 규칙

"내 팀이 담당(primary/support)인 리프만 실적·산출물 편집" 규칙은 유지하되, '내 팀'을
**(계정 전역 팀 `memberships.team_id`) ∪ (그 프로젝트 명단의 내 팀
`project_members.team_id`)** 로 확장한다. 기존 판정을 빼지 않으므로 D-CUBE 무회귀,
새 프로젝트는 명단 팀 배정만으로 권한이 성립한다.

적용 3곳(전부 같은 규칙):

1. **RLS `member_update_actual`** (0053:79-93 재정의) — item_owners 매치 조건에
   `or o.team_id in (select pm.team_id from project_members pm
   where pm.project_id = wbs_items.project_id and pm.user_id = auth.uid()
   and pm.team_id is not null)` 추가. using/with check 동일.
   (0019의 `(project_id, user_id)` 부분 유니크 인덱스가 이 서브쿼리를 받친다.)
2. **`can_attach()` 함수** (0053:254-270 재정의) — 동일 합집합, `w.project_id` 기준.
3. **앱 계층** — `getActor()`가 `project_members`에서 내 명단 행(프로젝트→팀 매핑)을
   추가 조립(`Actor.rosterTeams: Record<projectId, {teamId, teamCode}>`).
   `permissions.ts`의 `canEditActual`/`canEditDeliverable`는
   `o.team === actor.teamCode || o.team === actor.rosterTeams[projectId]?.teamCode`.
   서버 액션 재검증(`actions/wbs.ts` updateActual/updateDeliverable,
   `actions/attachments.ts` requireAttachPermission)도 teamId 합집합으로 동일 확장.
   조회 실패는 기존대로 fail-closed.

**팀 관리 권한**: 프로젝트 팀 CRUD 서버 액션은 `requireProjectAdmin(projectId)`.
전역 팀(`/admin/teams`)은 종전대로 `requireSuperuser`.

## 4. UI

### 프로젝트 설정 — "팀 관리" 섹션 (`/p/[projectId]/settings`)

- 관리자에게만 편집 노출. 전역 `TeamsManager` 관례 재사용(추가·활성 토글·진척표시
  토글·정렬 스왑·**삭제 없음**). 프로젝트 스코프 변형 컴포넌트(가칭 `ProjectTeamsManager`).
- **팀 미정의 상태**: "전역 팀 상속 중" 안내 + 두 진입점 —
  - "전역 팀 복사로 시작": 전역 **활성** 팀을 프로젝트 행으로 복사(sort 유지,
    회의록 시드 폴더 생성 없음). 프로젝트 팀 0개일 때만 노출.
  - "빈 목록에서 시작": 첫 팀 추가.
- **상속 종료 경고**: 첫 팀 정의 시 "이 프로젝트는 더 이상 전역 팀을 따르지 않습니다.
  기존 WBS 담당이 전역 팀에 걸려 있으면 화면에서 '목록 밖 팀'으로 처리됩니다(칸반
  미배정 흡수·엑셀 데이터 열 덧붙임 — 기존 유실 방지 동작)" 확인 모달.
- 서버 액션: `addProjectTeam`·`updateProjectTeam`·`copyGlobalTeams`
  (모두 `requireProjectAdmin` + 쓰기 후 `refreshTeams()` await — 기존 관례).
  팀명 검증은 `normalizeNewTeamCode` 재사용(예약어·20자). 중복 검사는 **동일
  프로젝트 내에서만** 거부 — 전역·타 프로젝트와의 동명은 허용(복합 유니크와 일치).

### 멤버 명단 — 역할 라벨 (`/p/[projectId]/members`)

- MembersBoard 추가/편집 폼에 "역할" 자유 입력 필드(예: PM, 개발, QA), 카드에 역할 칩
  표시. 팀 드롭다운은 Provider 중첩 덕에 자동으로 프로젝트 팀.
- `addMember`/`updateMember` 액션이 `role_label`을 읽고 쓴다. `updateMember`의
  `update_project_member_with_identity` RPC에 `p_role_label text default null`
  파라미터를 추가(§1 마이그레이션에 포함) — 기존 호출과 하위호환이며 행 수정이
  한 트랜잭션으로 유지된다.
- 기존 `role`(리더/실무)·`title`(직함)은 무변경 공존.

## 5. 결합부

- **초대 v2**: 발급(`projectInvites.ts:192`) 팀 검증·해석을 프로젝트 인식으로
  (`isActiveTeamCodeForProject` + 프로젝트 우선 id 해석). redeem의 memberships 보정
  로직(`inviteRedeem.ts`)은 **현행 유지** — 프로젝트 팀 행 id가 memberships에 들어가도
  FK 성립하고, 그 프로젝트의 WBS 권한 판정(§3 합집합의 왼쪽 항)도 그대로 동작한다.
  부작용: 계정 관리 화면의 팀 표시가 전역 목록 밖 코드일 수 있음(표시는 코드 문자열이라
  동작, 편집 시 전역 팀으로만 변경 가능) — 허용된 한계로 문서화.
- **임포트 부트스트랩** (`api/import/execute`): 미등록 팀 대조 기준을
  `teamsForProjectSync`로. 팀을 정의한 프로젝트는 **프로젝트 스코프로 등록**
  (`requireProjectAdmin`으로 완화, `addProjectTeam` 재사용 — 시드 폴더 없음).
  전역 상속 중 프로젝트(D-CUBE)는 현행 유지(슈퍼유저·전역 `addTeam`·시드 폴더 생성).
  ImportWizard 모달 문구·권한 분기 갱신.
- **임포트 RPC** (0060/0061 계열 재정의): owners 팀 코드→id 해석을
  `where code = ? and (project_id = 대상 프로젝트 or project_id is null)
  order by (project_id is not null) desc limit 1` — 프로젝트 행 우선, 전역 폴백.
  복합 유니크 도입으로 동명 2행이 가능해지므로 **필수** 수정.
- **sub-act** (`actions/wbs.ts` addSubAct): 팀 해석을 동일 스코프 규칙으로.
  이름 박제(`{ACT} ({팀} 주관/지원)`)는 현행 유지.
- **봇 도구**: wbs·kanban·attendance·members는 execute가 projectId를 이미 알므로
  team 인자 검증·정렬 주입을 프로젝트 인식으로(members는 `readTeam` 헬퍼에 코드 목록
  주입 방식으로 변경). minutes 도구는 전역 유지(회의록은 전역 축).
  `planner.ts:218`의 "PMO|ERP|MES|가공|MDM" 하드코딩 힌트는 "프로젝트에 등록된 팀
  코드(선택)" 일반 문구로 교체.
- **회의록 시드 폴더**: `addProjectTeam`은 생성하지 않는다(전역 `addTeam`만 생성).

## 6. 범위 밖 (명시적 비변경)

- 회의록 보관함·폴더 5축·자동 편철·또박또박 API 계약(meta.teams 포함) — 전역 팀.
- 계정 관리(`/admin/accounts`) 팀 선택·`memberships` 1인 1팀 구조 — 전역 팀.
- `/admin/teams` 전역 마스터 화면·액션 — 무변경.
- 위키 — FK 2건 drop 외 무접촉(기능·데이터·코드 무변경, 작업 금지 지시 준수).
- `WEEKLY_TEAM_SECTIONS`(봇 주간 매핑)·PPT/칸반/WBS 팀 배색 3곳(신규 팀=중립색 폴백은
  현행 의도) — 무변경.
- 근태·회의 화면은 Provider 중첩으로 프로젝트 팀을 **자동 수신**할 뿐 로직 무변경.

## 7. 경계 케이스

| 케이스 | 동작 |
|---|---|
| 프로젝트 팀 정의 후 기존 WBS 담당이 전역 팀 | 칸반 미배정 흡수·엑셀 데이터 열 덧붙임(기존 유실 방지 로직 재사용). §4 경고 모달로 사전 고지 |
| 전역과 동명 프로젝트 팀 (예: 프로젝트 "PMO") | 허용(복합 유니크). 회의록·또박또박은 전역 접근자만 쓰므로 혼입 없음. 임포트/sub-act 해석은 프로젝트 행 우선 |
| 전 프로젝트 팀 비활성화 | 전역 폴백으로 **복귀하지 않음**(폴백 판정은 비활성 포함). 빈 활성 목록이 그대로 노출 — 설정 화면에서 복구 |
| MinuteViewer(전역)의 IssueFormModal→MemberPicker 갈래 | 전역 Provider 팀 수신. MemberPicker의 "목록 밖 팀 뒤 보존" 로직이 명단 팀 그룹핑을 유지 — 무해 |
| redeem으로 memberships에 프로젝트 팀 유입 | §5 초대 항 참조 — 허용된 한계 |
| 캐시 TTL 60초 | 팀 쓰기 액션 후 `refreshTeams()` await(기존 관례)로 즉시 반영 |

## 8. 테스트·검증 계획

- **단위(vitest)**: 폴백 규칙(0개→전역, 비활성만 있어도 프로젝트 목록, 전역 접근자의
  프로젝트 행 배제), `permissions.ts` 합집합(전역 팀만·명단 팀만·둘 다·둘 다 없음),
  `normalizeNewTeamCode` 프로젝트 스코프 중복 검사, role_label round-trip.
- **마이그레이션 테스트**(`tests/migrations` 관례): 복합 유니크(nulls not distinct)
  동작, RLS 시뮬레이션(명단 팀만 있는 멤버의 실적 UPDATE 허용 — migration-drift-audit
  메모리의 RLS 시뮬레이션 레시피), 롤백 파일 왕복.
- **D-CUBE 회귀**: 팀 미정의(폴백) 상태에서 대시보드 팀 카드·WBS 담당 표시·엑셀 열·칸반
  컬럼이 배포 전과 동일 — 실화면 확인 + `npm run smoke:prod`.
- **신규 E2E**(전용 테스트 프로젝트, D-CUBE 무접촉): 팀 정의(복사/신규)→명단 배정+역할
  라벨→WBS 담당 지정→멤버 계정으로 실적 편집 성공/타 팀 리프 거부→임포트 부트스트랩
  프로젝트 스코프 등록.
- 배포 후 `npm run smoke:prod` → 실화면 → `npm run mark:good`.

## 9. 롤백

`_rollback.sql` 동반. 순서: **코드 롤백 선배포 → DB 롤백**(0044 관례와 동일).
- RLS 정책·`member_update_actual`·`can_attach`·임포트 RPC 원문 복원(0053/0060/0061 기준).
- `teams_project_code_key` drop → `teams_code_key(code)` 재추가 — ⚠️ **프로젝트 팀
  행이 남아 있으면 동명 충돌로 실패 가능**: 프로젝트 팀 행 삭제(또는 개명)를 선행해야
  함을 롤백 파일 헤더에 명시.
- 위키 FK 2건 재추가(owner_team 값은 전역 팀 코드만 존재하므로 안전).
- `teams.project_id`·`project_members.role_label` drop.

## 10. 전제·오픈 이슈

- `teams_code_key`·위키 FK 실명은 프로덕션에서 확인 후 drop(자동 생성명 추정 —
  supabase-mgmt-api-recipe 경유 조회).
- 리포의 0070 번호 충돌(private_projects vs project_member_email_identity)은 사전
  존재 이슈로 이번 범위 밖.
- 프로젝트 팀으로의 배색 토큰 확장, WEEKLY_TEAM_SECTIONS 일반화, 회의록 프로젝트
  스코프화는 후속 과제(이번 결정으로 배제).
