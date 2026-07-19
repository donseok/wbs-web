# DK Bot v2 Phase 2 후속 구현 계획 (도구 6종·플래너·색인 워커·딥링크·골든셋)

> **상태: 전 태스크 구현 완료(2026-07-19).** 최종 검증: 137파일/1,458테스트 그린(골든 118 포함),
> tsc·eslint·next build·git diff --check 클린. 유보 항목: 운영 쓰기 경로 enqueue 배선·cron 연결·
> 0031/0032/0033 프로덕션 적용(배포 순서 문서 참조), 신규 UI 문구 dict.ts i18n 키 승격(현재
> 인라인 ko/en 분기 — 기존 i18n 전면 번역 유보 상태와 일관).

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 2026-07-19 설계 문서(§9, §7.3, §10.4, §11.1, §17.1)의 미구현 Phase 2/3 항목 — 공지·회의록·칸반·대시보드·멤버·설정 읽기 도구, 제한된 2단계 플래너, 증분 색인 워커, 상세 딥링크 계약, 골든 질문셋 100+ — 를 기존 v2 아키텍처 관례 그대로 완성한다.

**Architecture:** 모든 신규 조회는 strict Repository(`RepositoryResult`) → 읽기 도구(`ReadOnlyBotTool`) → 결정형 라우터/제한된 플래너 → Evidence Pack 경로를 따른다. 워커는 순수 정책 + DI 어댑터로 구현하고 실제 실행은 보호 라우트 + 환경변수 이중 게이트 뒤에 둔다(cron 연결은 배포 결정). 클라이언트 딥링크는 각 View의 searchParams 소비로 구현한다.

**Tech Stack:** Next.js App Router, Supabase(요청 스코프 클라이언트 + RLS), TypeScript strict, Vitest. LLM은 provider-agnostic(`generateAnswer`), 기본 비활성 플래그.

## Global Constraints

- v2 도구는 전부 읽기 전용. capability는 `^[a-z][a-z0-9_-]*:read$`만 허용(오케스트레이터가 강제).
- PII 제외: 멤버 이메일, 근태 메모, Storage 경로(`file_path`)·signed URL, 계정/환경변수/키. Repository 계약 타입에서 필드 자체를 제거한다.
- 정상 0건 ≠ 조회 실패: 모든 신규 Repository는 `RepositoryResult`를 반환, 에러 삼킴 금지.
- 서버가 프로젝트 범위 재검증: 도구는 `checkProjectAccess`, 결과는 `repositoryScopeViolation` 검사.
- 신규 플래그는 전부 기본 OFF: `CHAT_V2_PLANNER_ENABLED`, `CHAT_V2_INDEX_WORKER_ENABLED`(+`CHAT_V2_INDEX_CRON_SECRET`), `CHAT_V2_INDEX_ENQUEUE_ENABLED`, `CHAT_V2_SHADOW_SEARCH_ENABLED`.
- **DB 실적용 금지**: 로컬 dev도 프로덕션 Supabase를 공유한다. 마이그레이션은 파일 작성 + 정적 감사까지만.
- 기존 파일 관례 유지: 한국어 주석·에러 메시지, `readRequiredString`/`readLimit` 등 tools/common.ts 재사용, 테스트는 tests/ai·tests/repositories 패턴.
- 공유 파일(`src/lib/repositories/types.ts`, `src/lib/ai/tools/{types,index}.ts`, `src/lib/ai/chat/{router,default-registry,access-scope,orchestrator}.ts`)은 **오케스트레이터(메인 세션)만 수정**한다. 병렬 서브에이전트는 자기 신규 파일만 만든다.

---

### Task 0: 리뷰 발견 반영 (2026-07-19 종합 리뷰 완료)

4관점 병렬 감사 + Critical/High 적대적 검증 결과: **Critical 0 / High 0 / Medium 10 / Low 10** (`_workspace/final_review.md`). 크래시·데이터 손실·권한 우회 없음. 반영 계획:

**오케스트레이터 직접 수행(선행 완료):**
- [x] M-1 protocol.ts `BOT_DOMAINS`/`BOT_ENTITY_TYPES` as const SSOT 도입
- [x] M-4 서버 측 — `PageContextV1.selectedProjectId` typed 필드 + sanitize + router/access-scope 전환(테스트 3건 갱신)
- [x] M-5 route.ts Content-Length 256KB 413 게이트 + `sanitizeHistory` 스캔 창 캡
- [x] L-1 AccessScopeResolver → `src/lib/authz/accessScope.ts` 이동(chat 접두 제거)
- [x] L-6 router no-op `.replace('가공','가공')` 제거
- [x] L-7 wbs 저장소 과잉 조건부 반환 타입 정리

**웨이브 1 에이전트에 할당:**
- [ ] M-2·M-8·L-2·L-5·L-8·L-9 + M-1(verifier) → fix:verifier-evidence
- [ ] M-9·M-1(pgvector)·L-3·D-1 → fix:pgvector-0031 (0031은 미적용 파일이므로 직접 수정)
- [ ] M-10·M-4(클라)·L-10 → fix:client-context

**Task 3(통합)에 흡수:** M-3(V2_DOMAINS 단일화·capability SSOT), M-7(AbortSignal 전파)

**의도적 유보(근거):**
- M-6 합성 토큰 스트리밍 — 스트리밍-후-검증은 "검증 전 표시 금지" 불변식과 충돌. 합성은 실험 opt-in이므로 버퍼링 유지 + 문서에 TTFT 한계 명시
- L-4 WBS 부분 로더 — 현 규모 경미, 대형 프로젝트 필요 시
- D-2/D-3 — 현행 정책 보존 결정(설계 §6.3.1)·전 앱 공통 posture, 챗봇 범위 밖
- D-4/D-5 — Phase 2 색인 활성 전 실측 항목으로 문서화

---

### Task 1: 공유 계약 확장 (오케스트레이터 직접 수행)

**Files:**
- Modify: `src/lib/repositories/types.ts` — 6개 신규 Repository 인터페이스 + 에러 코드
- Modify: `src/lib/ai/tools/types.ts` — capability 6종 + 도구 이름 9종
- Test: 기존 스위트 그린 유지(`npx vitest run tests/ai/tools-core.test.ts`)

**Produces (이후 모든 Task가 소비하는 정본 계약):**

```ts
// repositories/types.ts 추가 — 에러 코드
| 'ANNOUNCEMENTS_READ_FAILED'
| 'MINUTES_READ_FAILED'
| 'MINUTE_DETAIL_READ_FAILED'
| 'MINUTE_INSIGHTS_READ_FAILED'
| 'MINUTE_FILES_READ_FAILED'
| 'MEMBERS_READ_FAILED'
| 'PROJECT_SETTINGS_READ_FAILED'
| 'PROJECT_HOLIDAYS_READ_FAILED'

// 공지 — body 포함(장문 검색 대상), 읽음 처리 절대 금지(SELECT only)
export interface AnnouncementRepositoryRecord {
  id: string; projectId: string; title: string; body: string
  category: AnnouncementCategory; isPinned: boolean
  publishFrom: string | null; publishTo: string | null
  createdAt: string; updatedAt: string | null
}
export interface AnnouncementRepository {
  listAnnouncements(projectId: string, limit: number): Promise<RepositoryResult<{
    records: AnnouncementRepositoryRecord[]; truncated: boolean
  }>>
}

// 회의록 — file_path/서명URL 없음. 프로젝트 범위는 meeting 역참조(nullable).
export interface MinuteRepositoryRecord {
  id: string; minuteDate: string; teamCode: TeamCode; title: string
  meetingId: string | null; meetingProjectId: string | null
  createdByName: string | null; createdAt: string; updatedAt: string | null
}
export interface MinuteSearchSnapshot { records: MinuteRepositoryRecord[]; truncated: boolean }
export interface MinuteFileMetadataRecord {
  fileName: string; size: number | null; mime: string | null; createdAt: string
}
export interface MinuteInsightRecord { kind: string; label: string; blockIndex: number }
export interface MinuteDetailSnapshot {
  minute: MinuteRepositoryRecord & { bodyMd: string }
  insights: MinuteInsightRecord[]
  files: MinuteFileMetadataRecord[]
}
export interface MinutesRepository {
  searchMinutes(input: {
    query: string | null; team: TeamCode | null; projectId: string | null
    from: string | null; to: string | null; limit: number
  }): Promise<RepositoryResult<MinuteSearchSnapshot>>
  getMinuteDetail(minuteId: string): Promise<RepositoryResult<MinuteDetailSnapshot | null>>
}

// 멤버 — email 필드 자체가 없음
export interface MemberRepositoryRecord {
  id: string; projectId: string; name: string; teamCode: TeamCode | null
  role: ProjectMemberRole; title: string | null; hasAccount: boolean; createdAt: string
}
export interface MemberRepository {
  listMembers(projectId: string): Promise<RepositoryResult<MemberRepositoryRecord[]>>
}

// 설정 — 프로젝트 운영 정보만. 키/계정/환경변수 금지.
export interface ProjectSettingsSnapshot {
  projectId: string; name: string
  startDate: string | null; endDate: string | null; baseDate: string | null
  holidays: string[]; wbsItemCount: number; memberCount: number
  updatedAt: string | null
}
export interface ProjectSettingsRepository {
  getSafeSettings(projectId: string): Promise<RepositoryResult<ProjectSettingsSnapshot | null>>
}

// CoreBotRepositories 확장
export interface CoreBotRepositories {
  wbs: WbsBotRepository; weekly: WeeklyRepository
  meetings: MeetingBotRepository; attendance: AttendanceRepository
  announcements: AnnouncementRepository; minutes: MinutesRepository
  members: MemberRepository; settings: ProjectSettingsRepository
}
```

```ts
// tools/types.ts 추가
export const BOT_READ_CAPABILITIES = [
  'wbs:read', 'weekly:read', 'meetings:read', 'attendance:read',
  'announcements:read', 'minutes:read', 'kanban:read', 'dashboard:read',
  'members:read', 'settings:read',
] as const

export type CoreBotToolName =
  | /* 기존 11종 유지 */
  | 'list_announcements' | 'search_announcements'
  | 'search_minutes' | 'get_minute_detail'
  | 'get_kanban_view' | 'get_project_dashboard'
  | 'list_members' | 'get_member_workload'
  | 'get_safe_project_settings'
```

**Steps:**
- [ ] types 확장 두 파일 편집 → `npx tsc --noEmit` 통과 확인(기존 코드 영향 0)
- [ ] `npx vitest run tests/ai tests/repositories` 그린 확인

---

### Task 2A~2F: 신규 Repository + 도구 6종 (병렬 서브에이전트, 신규 파일만)

공통 규칙(모든 서브태스크):
- 구현 패턴 정본: `src/lib/repositories/supabase/attendance.ts`(단순) · `meetings.ts`(조인) / 도구는 `src/lib/ai/tools/attendance.ts` · `weekly.ts`.
- 도구는 `isRecord/readRequiredString/readOptionalString/readLimit/isIsoDate/validDateRange/checkProjectAccess/invalidArgument/repositoryFailure/repositoryScopeViolation/internalProjectHref/shortExcerpt`를 재사용한다.
- `facts` 키는 오케스트레이터 `DISPLAY_LABELS`에 이미 있는 키를 우선 재사용(`totalMatched`, `returned`, `rangeFrom`, `rangeTo`, `memberCount` 등). 신규 키는 Task 3에서 라벨 등록.
- 테스트: 성공/0건/조회실패/인자검증/범위위반(`ACCESS_DENIED`)/스코프위반/PII 부재(직렬화에 `email`·`note`·`file_path`·`signed` 미포함) 각 1개 이상.

#### Task 2A: 공지 (`announcements`)

**Files:**
- Create: `src/lib/repositories/supabase/announcements.ts`
- Create: `src/lib/ai/tools/announcements.ts`
- Test: `tests/repositories/announcements-read.test.ts`, `tests/ai/tools-announcements.test.ts`

**Interfaces:** Task 1의 `AnnouncementRepository` 소비. Produces:
```ts
export function createSupabaseAnnouncementRepository(client: SupabaseServerClient): AnnouncementRepository
export function createListAnnouncementsTool(repository: AnnouncementRepository): ReadOnlyBotTool<AnnouncementToolRecord>
export function createSearchAnnouncementsTool(repository: AnnouncementRepository): ReadOnlyBotTool<AnnouncementToolRecord>
```
- Repository: `announcements` 테이블 `select('id, project_id, title, body, category, is_pinned, publish_from, publish_to, created_at, updated_at').eq('project_id', ...).order(is_pinned desc).order(created_at desc).limit(limit + 1)` → limit+1 초과 시 truncated. 읽음 워터마크(`announcement_seen`) 접근 금지.
- `list_announcements` args: `{ projectId, pinnedOnly?, category?('general'|'schedule'|'policy'|'etc' — src/lib/domain/types.ts의 AnnouncementCategory 실제 유니언 사용), activeOn?(ISO date), limit? }` — activeOn은 publishFrom/publishTo 게시창 필터(도구 계층에서 적용).
- `search_announcements` args: `{ projectId, query(필수, 1..200), category?, limit? }` — title/body 부분일치(소문자 비교), 매치 발췌 `shortExcerpt`.
- record: body 전문 대신 `bodyExcerpt`(300자)만 노출. facts: `totalMatched, returned, pinnedCount, activeCount`. source: `{ id: 'announcement:'+id, domain:'announcements', entityType:'announcement', href: internalProjectHref(projectId,'announcements') + '?focus=' + id, updatedAt }`.

#### Task 2B: 회의록 (`minutes`)

**Files:**
- Create: `src/lib/repositories/supabase/minutes.ts`
- Create: `src/lib/ai/tools/minutes.ts`
- Test: `tests/repositories/minutes-read.test.ts`, `tests/ai/tools-minutes.test.ts`

**Interfaces:** Task 1의 `MinutesRepository` 소비. Produces `createSupabaseMinutesRepository`, `createSearchMinutesTool`, `createGetMinuteDetailTool`.
- Repository search: `minutes` LIST 컬럼(`src/lib/data/minutes.ts`의 LIST_COLS에서 minute_files(count) 제외 가능) + `meetings(project_id)` 조인, `ilikeOrPattern`(`src/lib/domain/minutes.ts`) 재사용해 title/body_md OR 검색, team/기간 필터, projectId 지정 시 `meetings.project_id` eq — **projectId 필터는 meetingId 없는 회의록을 제외함을 명시**.
- detail: body_md 포함 + `minute_insights`(kind/label/block_index; `INSIGHT_COLS` 관례 — 임베드 금지 원칙 유지, 실패 시 `MINUTE_INSIGHTS_READ_FAILED`), `minute_files`는 **file_path 제외** 메타만(실패 시 `MINUTE_FILES_READ_FAILED`).
- `search_minutes` args: `{ query?, team?, projectId?, from?, to?, limit? }` — query 없으면 기간 목록 조회(기간 필수). projectId 인자가 있으면 `checkProjectAccess`, 없으면 전역(현행 보관함 권한과 동일)이며 capability `minutes:read`만 검사.
- `get_minute_detail` args: `{ minuteId }` — meetingProjectId가 있고 allowlist 밖이면 `ACCESS_DENIED`(fail-closed), null이면 전역 회의록으로 허용.
- record: bodyMd는 record에 4,000자 캡(`bodyTruncated` fact), insights 상위 12개. source: `{ domain:'minutes', entityType:'minute', href: '/minutes/' + id, projectId: meetingProjectId }`.

#### Task 2C: 멤버 (`members`)

**Files:**
- Create: `src/lib/repositories/supabase/members.ts`
- Create: `src/lib/ai/tools/members.ts`
- Test: `tests/repositories/members-read.test.ts`, `tests/ai/tools-members.test.ts`

**Interfaces:** `MemberRepository` + (워크로드용) 기존 `WbsRepository` 소비. Produces `createSupabaseMemberRepository`, `createListMembersTool(members)`, `createGetMemberWorkloadTool(members, wbs)`.
- Repository: `project_members` `select('id, project_id, name, role, title, user_id, created_at, teams(code)')` — **email 컬럼을 select 자체에서 제외**. `nestedOne` 재사용.
- `list_members` args: `{ projectId, team?, role?, limit? }`. facts: `memberCount`, 팀별 카운트. source: 멤버 메뉴(`?team=` 딥링크는 Task 6 계약).
- `get_member_workload` args: `{ projectId, team? }` — WBS snapshot의 leaf owners(primary) 팀 단위 집계: `{ teamCode, memberNames[], taskCount, doneCount, delayedCount, inProgressCount, avgActualPct(round1) }`. **개인 담당 관계를 추론하지 않는다** — warnings에 '개인 담당 데이터가 등록되지 않아 팀 단위로 집계했습니다.' 고정 문구. WBS 상태/트리 계산은 `find_wbs_items` 도구가 쓰는 것과 동일한 도메인 헬퍼(`src/lib/ai/tools/wbs.ts` 참조) 재사용.

#### Task 2D: 칸반 (`kanban`)

**Files:**
- Create: `src/lib/ai/tools/kanban.ts` (신규 Repository 없음 — `WbsRepository` 재사용)
- Test: `tests/ai/tools-kanban.test.ts`

**Interfaces:** `WbsRepository.getProjectSnapshot` 소비, `src/lib/domain/kanban.ts`의 `groupByPhase/groupByOwner/groupByStatus` 재사용. Produces `createGetKanbanViewTool(repository: WbsBotRepository)`.
- args: `{ projectId, view?('phase'|'owner'|'status', 기본 'status'), team?, status?, cardLimit?(컬럼당, 기본 5, 최대 10) }`.
- 컬럼별 record: `{ columnKey, columnTitle, count, cards: [{ id, code, name, status, team(primary 첫번째), plannedEnd, actualPct }] }` — cards는 cardLimit 캡, 초과 시 truncated.
- facts: 컬럼별 `count`(예: `col_not_started` 대신 DISPLAY 가능한 `notStartedCount, inProgressCount, delayedCount, doneCount` — view=status 기준) + `totalCards`.
- source: 카드당 `{ entityType:'wbs_item', href: internalProjectHref(projectId,'wbs') + '?focus=' + id }`(기존 WBS focus 계약 재사용) + 칸반 메뉴 루트 1건.

#### Task 2E: 대시보드 (`dashboard`)

**Files:**
- Create: `src/lib/ai/tools/dashboard.ts` (신규 Repository 없음 — wbs+meetings 재사용)
- Test: `tests/ai/tools-dashboard.test.ts`

**Interfaces:** `WbsBotRepository` + `MeetingBotRepository` 소비, `src/lib/domain/dashboard.ts`의 `scheduleModel/detectMilestones/progressSignal`, `src/lib/domain/rollup.ts`의 `overallProgress` 재사용. Produces `createGetProjectDashboardTool(wbs, meetings)`.
- args: `{ projectId }`.
- facts(정수/round1 관례 준수 — pct-precision-convention): `plannedPct(round1)`, `actualPct(round1)`, `variance(round1)`, `progressSignal`, `projectedEnd`, `slipDays`, `elapsedPct`, `milestoneName`, `milestoneDate`, `milestoneDday`, `todayMeetings`, `upcoming7dMeetings`, `wbsItemCount`, `delayedCount`.
- 회의 수는 `listProjectMeetings(today, today+7)` 반복 전개 없이 시리즈 단위 카운트면 정직하게 `warnings`에 명시하거나, 기존 `list_meetings` 도구가 쓰는 전개 헬퍼(`src/lib/domain/meetings.ts`)를 재사용해 실제 회차 기준으로 계산한다(후자 우선).
- 부분 실패 허용: meetings 실패 시 WBS facts만으로 `status:'partial'` + warnings(스펙 §14 단일 도구 실패 패턴을 도구 내부 소스 결합에 적용).
- source: 대시보드 메뉴 루트 + 마일스톤 WBS 항목 `?focus=`.

#### Task 2F: 설정 (`settings`)

**Files:**
- Create: `src/lib/repositories/supabase/settings.ts`
- Create: `src/lib/ai/tools/settings.ts`
- Test: `tests/repositories/settings-read.test.ts`, `tests/ai/tools-settings.test.ts`

**Interfaces:** `ProjectSettingsRepository` 소비. Produces `createSupabaseProjectSettingsRepository`, `createGetSafeProjectSettingsTool(repository, indexStatus?)`.
- Repository: `projects`(id, name, start_date, end_date, base_date, updated_at) + `project_holidays`(date) + `wbs_items` head count + `project_members` head count. 각 실패는 구분된 에러 코드.
- 도구 두 번째 인자 `indexStatus?: (projectId: string) => Promise<{ freshness: string; indexed: number } | null>` — 주입 없으면 색인 facts 생략. default-registry에서 `dkbotIndexStatus`(src/lib/ai/health.ts)를 `.catch(() => null)`로 감싸 주입.
- facts: `projectName→name, startDate→plannedStart 재사용 대신 명시 키`: `name, startDate, endDate, baseDate, holidayCount, wbsItemCount, memberCount, indexFreshness, indexedDocuments`. **환경변수·키·계정 정보 절대 미포함.**

---

### Task 3: 라우터·레지스트리·오케스트레이터 통합 (오케스트레이터 직접 수행, Task 2 완료 후)

**Files:**
- Modify: `src/lib/ai/chat/router.ts`
- Modify: `src/lib/ai/chat/default-registry.ts`, `src/lib/ai/tools/index.ts`, `src/lib/repositories/supabase/index.ts`
- Modify: `src/lib/ai/chat/orchestrator.ts` (DISPLAY_LABELS/ENUMS 추가만)
- Modify: `src/lib/ai/chat/access-scope.ts` (BOT_READ_CAPABILITIES 자동 확장 확인 — 코드 변경 불필요하면 무변경)
- Test: `tests/ai/chat-v2-router.test.ts` 확장(신규 도메인 케이스), 기존 케이스 그린 유지

**핵심 편집 내용:**
- `DOMAIN_TERMS` 추가(우선순위: 명시 명사 우선 원칙 유지):
```ts
{ domain: 'minutes',       pattern: /회의록|의사록/ },                       // meetings의 (?!록)과 상보
{ domain: 'announcements', pattern: /공지/ },
{ domain: 'members',       pattern: /멤버|구성원|인원\s*구성|직책|워크로드|업무량|팀\s*구성/ },
{ domain: 'kanban',        pattern: /칸반/ },
{ domain: 'dashboard',     pattern: /대시보드|공정\s*현황|프로젝트\s*현황|예상\s*완료|마일스톤|SPI/i },
{ domain: 'settings',      pattern: /프로젝트\s*설정|기준일|공휴일|색인\s*상태/ },
```
- 레거시 게이트 조정: `memberBreakdownIntent`는 members 도구가 흡수(레거시 조건에서 제거하고 members 도메인 라우팅). `legacyIntent === 'overview'`는 dashboard 명시어가 있으면 dashboard가 우선. 포트폴리오(`전사|모든 프로젝트`)·`weekly_summary`(주간 명시어 없음)는 기존대로 레거시.
- `usefulContextDomain`: 신규 도메인 6종 추가(kanban은 이제 kanban 유지, dashboard도 유지).
- `normalizedReadDomain`: 지원 도메인 10종으로 확장.
- `entityDomain`: `announcement→announcements`, `minute|minute_block→minutes`, `member|team→members`.
- 도메인별 call 빌더: `announcementsCall`(검색어 있으면 search_, 없으면 list_; `/고정|필독/→pinnedOnly`), `minutesCall`(selectedEntity(minute)+상세어→detail; 아니면 search, 기간 cue 없으면 최근 90일 기본), `membersCall`(`워크로드|업무량|팀별` → get_member_workload), `kanbanCall`(view: pageContext.view ?? 상태어), `dashboardCall`, `settingsCall`.
- `statusFor` 라벨 6종 추가. `PHASE_ONE_TOOL_CAPABILITY`에 9개 도구 매핑 추가.
- clarify 규칙 추가: minutes 상세어인데 대상 회의록 미선택 → clarify(기존 meetings 패턴 준용).
- orchestrator `DISPLAY_LABELS` 추가 키: `pinnedCount: '고정 공지'`, `activeCount: '게시 중'`, `bodyExcerpt: '본문 요약'`, `columnTitle: '컬럼'`, `totalCards: '전체 카드'`, `plannedPct: '계획율'`, `variance: '편차'`, `projectedEnd: '예상 완료일'`, `slipDays: '예상 지연'`, `elapsedPct: '경과율'`, `milestoneName: '다음 마일스톤'`, `milestoneDate: '마일스톤 일자'`, `milestoneDday: 'D-Day'`, `holidayCount: '공휴일 수'`, `indexFreshness: '색인 상태'`, `indexedDocuments: '색인 문서 수'`, `taskCount: '작업 수'`, `doneCount: '완료 수'`, `delayedCount: '지연 수'`, `inProgressCount: '진행 중 수'`, `avgActualPct: '평균 실적률'`, `memberNames: '팀 멤버'`, `insightCount: '인사이트 수'`, `fileCount: '파일 수'`, `minuteDate: '회의록 일자'` 등 신규 facts/record 키 전부.
- default-registry: 9개 도구 + 신규 repository 배선, settings 도구에 `dkbotIndexStatus` 주입.
- docs/dkbot.md의 "후속 Phase 2 대상 폴백" 문단 갱신은 Task 9에서.

**Steps:**
- [ ] 라우터 신규 도메인 유닛 테스트 먼저 추가(각 도메인 최소: 명시어 라우팅, 페이지 문맥 폴백, 프로젝트 없음 clarify) → 실패 확인
- [ ] 구현 → 라우터/레지스트리/오케스트레이터 테스트 그린
- [ ] `npx vitest run tests/ai` 전체 그린 + `npx tsc --noEmit`

---

### Task 4: 제한된 2단계 플래너 + 결과 binding

**Files:**
- Create: `src/lib/ai/chat/planner.ts`
- Modify: `src/lib/ai/chat/orchestrator.ts` (플래너 훅 + 2단계 실행)
- Modify: `src/app/api/chat/v2/stream/route.ts` (플래너 활성 조건 전달 — 필요 시)
- Modify: `.env.local.example` (`CHAT_V2_PLANNER_ENABLED`)
- Test: `tests/ai/chat-v2-planner.test.ts`

**Interfaces:**
```ts
// planner.ts — 스펙 §7.3 계약의 런타임 구현
export interface ToolPlanBinding { fromCall: string; resultPath: string }
export interface ToolPlanCall {
  id: string; tool: CoreBotToolName
  args: Record<string, unknown>
  bindings?: Record<string, ToolPlanBinding>
}
export interface ToolPlan {
  reason: string
  stages: Array<{ calls: ToolPlanCall[] }>
  needsClarification: boolean
  clarification?: string
}
export type PlanValidationResult =
  | { ok: true; plan: ToolPlan }
  | { ok: false; code: 'PLAN_PARSE_FAILED' | 'PLAN_SCHEMA_INVALID' | 'PLAN_TOOL_NOT_ALLOWED'
      | 'PLAN_LIMITS_EXCEEDED' | 'PLAN_BINDING_INVALID' | 'PLAN_SCOPE_INVALID' }
export function validateToolPlan(raw: unknown, options: {
  allowedTools: readonly string[]
  allowedProjectIds: readonly string[]
}): PlanValidationResult
export function parseToolPlanJson(text: string): unknown | null       // ```json 펜스/잡음 제거
export function resolveBindings(call: ToolPlanCall, evidence: SuccessfulToolEvidence[]):
  | { ok: true; args: Record<string, unknown> }
  | { ok: false; code: 'BINDING_SOURCE_MISSING' | 'BINDING_PATH_INVALID' | 'BINDING_VALUE_INVALID' }
export function shouldAttemptPlan(route: DeterministicRoute, input: ChatRequestV2): boolean
export async function planWithConfiguredLlm(input: ChatRequestV2, context: {
  allowedTools: readonly string[]; pageContext: PageContextV1 | null; now: string
}): Promise<unknown | null>   // generateAnswer JSON-only 프롬프트, 실패 시 null
```

**하드 제약(validateToolPlan이 강제):**
- stages ≤ 2, 전체 calls ≤ 4(기본 3 초과 시 4번째는 드랍이 아니라 `PLAN_LIMITS_EXCEEDED` — 임의 절단 금지), stage 2에서만 bindings 허용.
- `resultPath` 문법: `^records\[(\*|0)\]\.[A-Za-z][A-Za-z0-9]{0,40}$` 만 허용. 해석 결과는 문자열 배열로 정규화하고 각 값은 `^[A-Za-z0-9_-]{1,64}$`(ID) 또는 ISO date만 통과, 최대 20개.
- 단일값 인자(`itemId`, `meetingId`, `minuteId`, `memberId`)에는 첫 값만 바인딩. 값이 0개면 해당 call은 실행하지 않고 `TOOL_FAILED`가 아닌 '결과 없음' 처리(stage1 결과만으로 부분 답변).
- args의 `projectId`는 allowedProjectIds 교집합 검사(스펙 §6.3), 알 수 없는 인자 키는 즉시 `PLAN_SCHEMA_INVALID`(도구별 허용 키 화이트리스트를 planner.ts 안에 선언).
- `needsClarification=true`면 실행 없이 clarify 경로.

**오케스트레이터 훅(§7.1 순서 유지):**
```ts
// route.kind === 'legacy' && CHAT_V2_PLANNER_ENABLED === 'true' && shouldAttemptPlan(...)
//   → planWithConfiguredLlm → validateToolPlan → 성공 시 stage별 실행(stage1 Promise.all →
//     resolveBindings → stage2 Promise.all) → 이후 기존 Evidence 경로 재사용
//   → 어떤 실패든 기존 legacy 폴백 이벤트 그대로(추가 오류 노출 없음, reason만 로그)
// shouldAttemptPlan: 명시 도메인 ≥ 2 || (도메인 0개 && 페이지 도메인이 지원 10종)
```
- 플래너 경로도 `executeCall` 재사용 → capability/스코프/결과 검증 동일 적용.

**Steps:**
- [ ] validateToolPlan/resolveBindings 순수 함수 TDD(정상 2단계, 한도 초과, 경로 문법 위반, 값 형식 위반, 교차 프로젝트, clarify)
- [ ] 오케스트레이터 훅 테스트: 플래그 OFF → 기존 legacy 동일, ON+LLM 실패 → legacy 폴백, ON+유효 플랜 → 2단계 실행·binding 반영
- [ ] `.env.local.example` 갱신 + 전체 그린

---

### Task 5: 증분 색인 워커 (claim/lease·generation CAS·tombstone·정합성·백필·shadow)

**Files:**
- Create: `supabase/migrations/0033_ai_index_worker.sql` + `0033_ai_index_worker_rollback.sql`
- Create: `src/lib/ai/index/worker.ts`, `src/lib/ai/index/consistency.ts`, `src/lib/ai/index/backfill.ts`, `src/lib/ai/index/shadow.ts`, `src/lib/ai/index/content.ts`
- Modify: `src/lib/ai/index/types.ts`(claim 계약), `src/lib/ai/index/pgvector.ts`(큐 어댑터 확장)
- Create: `src/app/api/chat/index/worker/route.ts`
- Modify: `.env.local.example`
- Test: `tests/ai/index-worker.test.ts`, `tests/ai/index-consistency.test.ts`, `tests/ai/index-shadow.test.ts`

**0033 핵심(전부 service_role 전용, RLS 유지):**
```sql
alter table public.ai_index_jobs add column if not exists generation bigint not null default 0;

-- 새 변경 enqueue: 같은 job_key면 pending 복귀 + generation+1 (CAS 기준점)
create or replace function public.upsert_ai_index_jobs(p_jobs jsonb) returns integer ...
  on conflict (job_key) do update set operation=excluded.operation, payload=excluded.payload,
    status='pending', attempts=0, run_after=now(), locked_at=null, last_error=null,
    generation=public.ai_index_jobs.generation+1, updated_at=now();

-- 원자적 claim + 만료 lease 회수(FOR UPDATE SKIP LOCKED)
create or replace function public.claim_ai_index_jobs(p_limit int, p_lease_seconds int)
returns setof public.ai_index_jobs ...
  where (status='pending' and run_after<=now())
     or (status='running' and locked_at < now() - make_interval(secs => p_lease_seconds))
  order by run_after, id limit greatest(1, least(p_limit, 50)) for update skip locked
  → update set status='running', locked_at=now(), updated_at=now() returning *;

-- 완료 CAS: 처리 중 새 generation이 끼어들었으면 done 대신 pending 복귀(재처리)
create or replace function public.complete_ai_index_job(p_id bigint, p_generation bigint)
returns boolean ...
  update set status=case when generation=p_generation then 'done' else 'pending' end,
    locked_at=null, updated_at=now()
  where id=p_id and status='running'
  returning (generation = p_generation);
```
- 실패 경로는 기존 `planIndexJobFailure` 재사용하되 generation 불일치면 attempts를 올리지 않고 pending 복귀(정책 함수에 `currentGeneration/claimedGeneration` 인자 추가).
- delete 작업: `KnowledgeIndex.delete`(전체 청크) 실행 → CAS 완료. **tombstone 규칙**: delete가 최신 generation이면 이후 도착한 구세대 upsert 작업은 CAS 실패로 재실행되고, 재실행 시 콘텐츠 로더가 원본 부재를 확인해 다시 delete를 수행한다(로더 null → delete 규약). RPC `replace_ai_document_chunks`의 타임스탬프 가드와 함께 이중 방어임을 주석으로 명시.

**worker.ts (순수 오케스트레이션, 전부 DI):**
```ts
export interface ClaimedIndexJob extends IndexJob { generation: number }
export interface IndexJobWorkerQueue extends IndexJobQueue {
  claim(limit: number, leaseSeconds: number): Promise<KnowledgeIndexResult<ClaimedIndexJob[]>>
  complete(job: Pick<ClaimedIndexJob, 'id' | 'generation'>): Promise<KnowledgeIndexResult<{ applied: boolean }>>
}
export type IndexContentLoader = (job: ClaimedIndexJob) => Promise<RepositoryResult<{
  documents: KnowledgeDocumentInput[]; sourceUpdatedAt: string | null
} | null>>   // null = 원본 삭제됨 → delete 수행
export interface IndexWorkerRunSummary {
  claimed: number; upserted: number; deleted: number; failed: number; requeued: number
}
export async function runIndexWorkerOnce(deps: {
  queue: IndexJobWorkerQueue; index: KnowledgeIndex; loadContent: IndexContentLoader
  batchSize?: number; leaseSeconds?: number; now?: Date
}): Promise<IndexWorkerRunSummary>
```
- content.ts: 도메인별 로더(wbs_item·weekly_report·meeting·announcement·minute) — service-role 클라이언트 기반 원문 로드 + `chunk.ts` 청킹 + `embeddings.ts` 임베딩(키 없으면 embedding null 저장, 스펙 §14 키워드 폴백 유지). 각 로더는 `contentHash`를 `similarity.ts`/기존 해시 관례로 계산.
- consistency.ts: `checkIndexConsistency({ sources, indexed, enqueue, limit })` — 원본 최신 updated_at/hash vs `ai_documents` 비교(`assessKnowledgeFreshness` 재사용) → 불일치 엔티티를 enqueue. 순수 함수 + Supabase 어댑터 분리.
- backfill.ts: 도메인·프로젝트별 엔티티 열거 → `upsert_ai_index_jobs` 일괄 enqueue(배치 200, dry-run 모드 지원).
- shadow.ts: `compareShadowSearch({ legacy, next, query })` → `{ overlap@10, legacyOnly, nextOnly, latencyMs }` 반환. **답변 경로에 영향 없음** — 로그만.
- route.ts: `POST /api/chat/index/worker` — ① `CHAT_V2_INDEX_WORKER_ENABLED==='true'` ② `x-cron-secret === CHAT_V2_INDEX_CRON_SECRET`(미설정 시 무조건 404) 이중 게이트, body `{ mode: 'worker'|'consistency'|'backfill', domain?, projectId?, dryRun? }`. service-role 클라이언트 사용, 요약 JSON 반환. **cron 등록은 하지 않는다(배포 결정).**
- enqueue 배선: `src/lib/ai/index/enqueue.ts`의 `enqueueIndexMutationBestEffort(mutations)` — `CHAT_V2_INDEX_ENQUEUE_ENABLED !== 'true'`면 no-op. 이번 단계에서는 **호출부 배선 없이** 헬퍼+테스트까지만(운영 쓰기 경로 수정은 별도 승인).

**Steps:**
- [ ] jobs 정책 확장(TDD: generation 불일치 시 attempts 비증가) → worker 순수 로직 TDD(fake queue/index/loader: 정상 upsert, 원본 부재→delete, 실패→백오프, CAS 불일치→requeue, lease 만료 회수)
- [ ] pgvector.ts 어댑터에 claim/complete RPC 배선 + 테스트(기존 knowledge-index-pgvector.test.ts 패턴)
- [ ] consistency/backfill/shadow TDD → 라우트 게이트 테스트(플래그 OFF→404, 시크릿 불일치→403)
- [ ] 0033 정적 감사(파싱·권한·rollback 대칭) — DB 적용 금지

---

### Task 6: 상세 query parameter 딥링크 계약

**Files:**
- Modify: `src/components/meetings/MeetingsView.tsx`, `src/components/meetings/MyMeetingsView.tsx` (`?focus={meetingId}&date=YYYY-MM-DD` 소비 → 상세 열기)
- Modify: `src/components/attendance/AttendanceView.tsx` (`?from&to&team&type` 초기 필터)
- Modify: `src/components/announcements/AnnouncementsView.tsx` (`?focus={announcementId}` 스크롤+강조)
- Modify: `src/components/members/MembersBoard.tsx` (`?team=` 초기 필터)
- Modify: `src/components/kanban/KanbanBoard.tsx` (`?view=&team=` 초기 모드)
- Modify: 해당 도구들의 href 생성(Task 2 산출물 — 계약 상수로 공유)
- Create: `src/lib/ai/chat/deep-links.ts` (경로 빌더 단일 정본: `announcementHref(projectId,id)`, `meetingHref(projectId,id,occurrenceDate?)`, `myMeetingHref(id,occurrenceDate?)`, `attendanceHref(projectId,{from,to,team,type})`, `membersHref(projectId,team?)`, `kanbanHref(projectId,{view,team})`, `settingsHref(projectId)`, `minuteHref(id)`, `wbsItemHref(projectId,itemId)`, `weeklyHref(projectId,weekStart)`)
- Test: `tests/ui/deep-link-params.test.tsx`(View별 소비), `tests/ai/deep-links.test.ts`(빌더 인코딩·허용 파라미터만)

**규칙:** 파라미터는 화면이 실제 소비하는 것만 계약에 넣는다(§11.1 — 소비 구현과 동시 수용). 알 수 없는 값은 조용히 무시(기존 화면 동작 보존). URL 파라미터는 `encodeURIComponent` 필수. verifier의 내부 경로 검증(`verifyBotSources`)이 신규 경로·쿼리를 통과시키는지 테스트로 고정.

**Steps:**
- [ ] deep-links.ts 빌더 TDD → 도구 href를 빌더로 교체
- [ ] View별 searchParams 소비 TDD(tests/ui 기존 패턴: bot-page-context.test.tsx 참조) → 구현
- [ ] verifier 통과 회귀 테스트

---

### Task 7: 골든 질문셋 100+

**Files:**
- Create: `tests/ai/golden/fixtures.ts` (2개 가상 프로젝트 + 전 도메인 결정형 픽스처, 실명·운영 데이터 금지)
- Create: `tests/ai/golden/fake-repositories.ts` (전 Repository 인터페이스 in-memory 구현 — 실패 주입 스위치 포함)
- Create: `tests/ai/golden/cases.ts` (케이스 배열 — 스펙 §17.1 유형별)
- Create: `tests/ai/golden/golden-questions.test.ts` (데이터 주도 실행기)
- Test: 자기 자신

**케이스 계약:**
```ts
export interface GoldenCase {
  name: string
  menu: BotDomain | 'cross' | 'fallback'
  request: ChatRequestV2                      // pageContext/conversationState 포함
  expect: {
    routeKind: 'tools' | 'clarify' | 'legacy' | 'command'
    tools?: string[]                          // done 이벤트의 tools와 정확 일치
    argsSubset?: Record<string, Record<string, unknown>>  // 도구별 인자 부분 일치
    deltaIncludes?: string[]                  // 결정형 답변 포함 문자열(수치·상태)
    deltaExcludes?: string[]                  // PII·타 프로젝트 문자열 부재
    sourceHrefPrefixes?: string[]             // 출처 내부 경로 검증
    errorCode?: string                        // 장애 주입 케이스의 terminal error
  }
  inject?: { failRepository?: RepositoryErrorCode[] }     // 조회 실패 주입
}
```
- 분포(합계 ≥ 110): wbs 15, weekly 12, meetings 12, attendance 10, announcements 10, minutes 10, kanban 8, dashboard 8, members 8, settings 6, 교차/후속(conversationState) 6, 폴백·장애(레포 실패→오류, 0건→'0건' 명시, 쓰기 명령→command, 미지원→legacy, 교차 프로젝트→차단) 8, 프롬프트 인젝션(본문에 지시문 포함 픽스처가 delta에 실행되지 않음) 3.
- 실행기: `routeChatRequest` + `orchestrateChatV2`(LLM 없이 결정형) 이벤트 수집 → expect 검증. LLM 합성·플래너는 기본 OFF 그대로(합성 경로는 기존 verifier 테스트가 커버).
- 수치 검증은 pct-precision-convention 준수(round1/정수 표기)를 픽스처 기대값에 반영.

**Steps:**
- [ ] fixtures + fake-repositories TDD(레포 실패 주입 포함) → cases 40개(핵심 4 메뉴) → 실행기 그린
- [ ] 신규 6 메뉴 + 교차 + 장애 케이스 확장 → 110+ 그린
- [ ] `npx vitest run tests/ai/golden` 단독 5초 이내 확인(전체 스위트 부담 관리)

---

### Task 8: (승인 후) 배포 순서 문서 반영 — 코드 없음

0032 적용(불일치 조회→VALIDATE), 0031/0033 적용, 워커 cron 연결, 점진 플래그 해제는 **사용자 승인 후** 별도 세션에서 Supabase Mgmt API 레시피(supabase-mgmt-api-recipe)로 진행. 이 계획에서는 문서화만.

### Task 9: 최종 검증·문서 갱신 (오케스트레이터 직접 수행)

**Files:**
- Modify: `docs/dkbot.md` (지원 도메인 확대, 폴백 문단 갱신, 새 플래그 표, 워커 운영 절차)
- Modify: `docs/superpowers/plans/2026-07-19-dkbot-menu-aware-copilot-implementation.md` (체크박스·검증 수치 갱신)
- Modify: `.env.local.example` 최종 정리

**Steps:**
- [ ] `npx vitest run` 전체 그린(회귀 0) → `npx tsc --noEmit` → `npm run lint` → `npx next build`
- [ ] 문서 갱신 → `git diff --check`
- [ ] 커밋은 사용자 확인 후(병렬 세션 주의 — 파일 명시 add, `git add -A` 금지)

## Self-Review 결과

- 스펙 §9 표의 `list_project_summaries`(프로젝트 목록 메뉴)는 이번 범위 밖(계획 문서 미체크 항목에 없음) — 포트폴리오 질문은 기존 레거시 유지로 일관.
- §17.2 수용 기준 중 성능 p95·운영 지표는 런타임 계측 항목이라 코드 범위에서 제외(계획 문서 Phase 3 잔여로 유지).
- 타입 일관성: Task 1 계약을 모든 Task가 소비하도록 명시. 도구 이름·capability는 Task 1에서만 선언.
