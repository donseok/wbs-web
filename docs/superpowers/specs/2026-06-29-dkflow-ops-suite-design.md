# DK Flow 벤치마킹 — 운영 스위트 + 디자인 리스킨 설계

**날짜:** 2026-06-29
**대상 레포:** wbs-web (Next.js 15 App Router, React 19, Tailwind v4, Supabase, Vitest)
**벤치마크:** https://prj-manager.vercel.app/ ("DK Flow")

## 목표

1. **디자인·메뉴 구조를 DK Flow와 동일하게** 리스킨 (warm cream + teal 팔레트, 다크모드, Pretendard, lucide 아이콘, 둥근 pill 헤더, 다크 사이드바 + 컨텍스트 메뉴).
2. **기존 기능 100% 유지** (WBS·간트 통합 시트, 엑셀 임포트, 진척 도메인 순수함수, Supabase Auth+RLS, 데모 모드).
3. **분석한 추가 기능 구현**: 칸반 보드, 멤버 관리, 근태현황, 현황 보고서. + 워크스페이스 홈/대시보드 리치화.

## 핵심 전략 — 토큰 리매핑

기존 앱은 이미 `globals.css`의 Tailwind v4 `@theme` 토큰 기반이다. **토큰 이름은 유지하고 값만 DK Flow 팔레트로 교체**하면 기존 컴포넌트가 코드 수정 없이 재스킨된다. 다크모드는 `.dark`에서 같은 토큰을 오버라이드.

라우트는 기존 `/p/[projectId]/...`를 유지(벤치마크의 `/projects/[id]`로 바꾸지 않음 — 기존 링크·미들웨어 보존). 메뉴 **표시 구조**만 DK Flow와 동일하게 한다.

---

## 디자인 토큰 (DK Flow에서 추출, 실측)

폰트: `"Pretendard Variable", Pretendard, system-ui, sans-serif` (CDN @import).
아이콘: `lucide-react`.

### Light (`:root`)
```
--bg-primary:#f5efe6  --bg-secondary:#fffaf4bd  --bg-secondary-solid:#fffaf4
--bg-tertiary:#ece2d4d6  --bg-elevated:#ffffff94  --bg-inverse:#15181d
--text-primary:#17181d  --text-secondary:#4a4440  --text-muted:#7a6f68
--border-color:#3125162e  --border-strong:#11172024
--accent-primary:#0f766e  --accent-primary-strong:#155e75  --accent-secondary:#cb6d37
--accent-ink:#123d64  --accent-success:#138a67  --accent-warning:#c06f24  --accent-danger:#cb4b5f
--gradient-primary:linear-gradient(135deg,#0f766e 0%,#155e75 48%,#173a63 100%)
--gradient-secondary:linear-gradient(135deg,#f2be83 0%,#cb6d37 100%)
--gradient-surface:linear-gradient(180deg,#ffffffd1,#fff8f19e)
--gradient-dark:linear-gradient(165deg,#1b1e26fa,#111319f0)
--shadow-sm:0 10px 24px -18px #12182538  --shadow-md:0 24px 44px -26px #12182538
--shadow-lg:0 36px 80px -42px #11182757  --shadow-xl:0 52px 120px -52px #11182761
--shadow-glow:0 28px 64px -30px #0f766e73  --ring-soft:0 0 0 1px #ffffff2e inset
--surface-soft:#ffffffc2  --field-surface:#ffffffd6  --field-surface-strong:#fffffff5
--menu-surface:#fffaf4  --menu-text:#17181d  --menu-muted:#5c544d  --wbs-sticky-bg-level1:#ede4d7
```
### Dark (`.dark`)
```
--bg-primary:#0f1217  --bg-secondary:#161b22e0  --bg-secondary-solid:#1a2029
--bg-tertiary:#2a303af5  --bg-elevated:#ffffff1a  --bg-inverse:#faf5ed
--text-primary:#f5efe7  --text-secondary:#d8cec4  --text-muted:#b6aa9e
--border-color:#ffffff24  --border-strong:#ffffff33
--accent-primary:#32b6ab  --accent-primary-strong:#66d6c6  --accent-secondary:#f0a167
--accent-ink:#6dc2ff  --accent-success:#34c997  --accent-warning:#f2aa4c  --accent-danger:#ff738a
--gradient-primary:linear-gradient(135deg,#18a79b 0%,#2d8ac8 50%,#475df1 100%)
--gradient-dark:linear-gradient(165deg,#11141afa,#0a0c10f0)
--shadow-glow:0 28px 72px -28px #2bbfb266  --surface-soft:#141a22d1  --field-surface:#141a22eb
--wbs-sticky-bg-level1:#292f39  (그 외 다크 그림자/필드 값은 추출표 참조)
```

### 기존 토큰 → DK 매핑 (globals.css `@theme` 값 교체)
- `--color-canvas`→`#f5efe6`, `--color-surface`→`#fffaf4`, `--color-surface-2`→`#f3ece1`
- `--color-line`→`#e6dccd`, `--color-line-strong`→`#d8ccba`
- `--color-ink`→`#17181d`, `--color-ink-muted`→`#4a4440`, `--color-ink-subtle`→`#7a6f68`
- `--color-brand`→`#0f766e`, `--color-brand-hover`→`#155e75`, `--color-brand-weak`→`#e2efe c`(teal tint), `--color-brand-ring`→`#9fd4cd`
- `--color-done`→`#138a67`/weak `#e3f3ec`, `--color-progress`→`#2d6fb0`/weak `#e6eff7`, `--color-delayed`→`#cb4b5f`/weak `#f8e6e9`, `--color-pending`→`#7a6f68`/weak `#efe7db`
- 사이드바: `--color-sidebar`→`#13161c`, `-2`→`#191d25`, `-3`→`#222732`, `-line`→`#ffffff1f`, ink `#f5efe7`/muted `#b6aa9e`/subtle `#8b8076`
- 히어로: from `#1b1e26` via `#141a2b` to `#0f766e`(teal 끝단), ink `#f5efe7`
- 팀색은 유지(가독성). 신규 토큰(gradient/shadow/glow)은 `@theme`에 추가.

> 빌드 에이전트는 위 값을 정확히 사용하되, 시각적으로 DK Flow와 동일하면 미세 조정 허용. **토큰 이름 삭제 금지**(기존 컴포넌트 깨짐 방지).

---

## 메뉴 / 라우트 구조

### 사이드바 (다크) — DK Flow 동일 구조
1. 상단 collapse 버튼
2. **WORKSPACE** 카드: "Planning cockpit" + 설명 + `PROJECTS`/`ACTIVE` stat 타일 2개
3. **프로젝트** 섹션: 프로젝트 리스트(folder-open 아이콘 + 상태 점) + "전체 보기" 링크
4. **메뉴** 섹션(프로젝트 진입 시 컨텍스트):
   - 대시보드 `layout-dashboard` → `/p/:id/dashboard`
   - WBS `list-tree` → `/p/:id/wbs`
   - 간트 차트 `calendar` → `/p/:id/wbs` (간트는 WBS 통합 뷰, 동일 라우트)
   - 칸반 보드 `columns` → `/p/:id/kanban` ★신규
   - 멤버 `users` → `/p/:id/members` ★신규
   - 근태현황 `calendar-check` → `/p/:id/attendance` ★신규
   - 설정 `settings` → `/p/:id/settings`
   - 프로젝트 밖(`/projects`)에서는 홈 `layout-grid`·전체 프로젝트만 표시

### 헤더 (둥근 pill, light/dark)
로고("DK Flow / 일하는 방식이 바뀌다") · 브레드크럼(프로젝트명) · 날짜칩(`6월 29일(월)`, calendar) · 수동/자동 토글(`hand`, 시각적; 기본 today) · 언어 KO/EN(`globe`) · 다크모드(`moon`/`sun`) · 알림(`bell`+배지) · 프로필(role/name, `user`) · 로그아웃(`log-out`).

### 라우트 맵 (기존 + 신규)
```
/                         → /projects 리다이렉트(기존 유지)
/login                    (기존)
/projects                 워크스페이스 홈 (리치 리뉴얼)
/p/:id/dashboard          대시보드 (리치 리뉴얼)
/p/:id/wbs                WBS·간트 통합 시트 (기존 유지, 헤더 히어로만 추가)
/p/:id/kanban             칸반 보드 ★신규
/p/:id/members            멤버 관리 ★신규
/p/:id/attendance         근태현황 ★신규
/p/:id/settings           설정 (DK 스타일 리뉴얼)
not-found.tsx             404 페이지 (DK 스타일)
```

---

## Foundation Contract (빌드 에이전트가 따를 공용 API)

> Foundation 단계에서 아래를 **정확한 경로·이름**으로 생성한다. Feature 단계 에이전트는 이를 import해 재사용하며, **foundation 파일은 수정하지 않는다**(각자 자기 파일만 생성/교체).

### Providers / 컨텍스트
- `src/components/providers/ThemeProvider.tsx` — `'use client'`. `useTheme()` → `{ theme:'light'|'dark', toggle() }`. localStorage `dkflow-theme` + 쿠키 동기화, `<html class="dark">` 토글. 루트 레이아웃에 no-flash 인라인 스크립트.
- `src/components/providers/LocaleProvider.tsx` — `'use client'`. `useLocale()` → `{ locale:'ko'|'en', setLocale(), t(key) }`. 사전 `src/lib/i18n/dict.ts`(ko/en) — 크롬·페이지 타이틀·공통 라벨 최소 범위. 기본 ko.

### 공용 UI (`src/components/ui/`)
- `PageHero.tsx` — props `{ eyebrow?:string; title:string; description?:string; badge?:ReactNode; actions?:ReactNode; aside?:ReactNode }`. 다크 그라데이션(`--gradient-dark`) 히어로 카드 + 우측 `aside`(KPI 레일) 2-col. (각 페이지가 자기 히어로 렌더)
- `KpiCard.tsx` — props `{ label:string; value:ReactNode; sub?:string; icon?:LucideIcon; tone?:'default'|'brand'|'success'|'warning'|'danger' }`. 우측 레일/그리드용 밝은 카드.
- `SectionCard.tsx` — props `{ eyebrow?:string; title:string; icon?:LucideIcon; actions?:ReactNode; children }`. 카드 + eyebrow/타이틀 헤더.
- `StatusPill.tsx` — props `{ status: Status }`(types의 Status). 칩(완료=success/진행중=progress/지연=danger/시작전=muted). (기존 `shared.tsx`의 StatusChip와 별개로 둬도 됨; 우선 shared 재사용 가능)
- `ProgressBar.tsx` — props `{ value:number; planned?:number; tone? }`. 트랙 + fill + 선택적 계획 마커.
- `Modal.tsx` — props `{ open:boolean; onClose():void; title?:string; eyebrow?:string; children; footer? }`. 백드롭 + 카드. **alert()/confirm() 금지**, 자체 모달만.
- `SegmentedTabs.tsx` — props `{ tabs:{key,label,icon?}[]; value; onChange }`. 칸반 필터/뷰 토글용.
- `EmptyState.tsx` — props `{ icon?; title; description?; action? }`.
- lucide 아이콘은 `lucide-react`에서 직접 import. 기존 `@/components/ui/Icon`는 그대로 둔다(기존 컴포넌트 호환).

### 타입 (`src/lib/domain/types.ts` 추가)
```ts
export type ProjectMemberRole = 'admin' | 'contributor'
export interface ProjectMember {
  id: string; projectId: string; name: string; email: string | null;
  teamCode: TeamCode | null; role: ProjectMemberRole; title: string | null; createdAt: string;
}
export type AttendanceType = 'work'|'remote'|'annual'|'half'|'sick'|'trip'|'official'|'absent'
export interface AttendanceRecord {
  id: string; projectId: string; memberId: string; date: string; // YYYY-MM-DD
  type: AttendanceType; note: string | null;
}
```

### 데이터 계층 (`src/lib/data/`)
- `members.ts` — `getProjectMembers(projectId): Promise<ProjectMember[]>` (React `cache`, DEMO 분기 → `DEMO_MEMBERS`).
- `attendance.ts` — `getAttendanceRecords(projectId, opts?:{from?,to?}): Promise<AttendanceRecord[]>` (DEMO 분기 → `DEMO_ATTENDANCE`).

### 서버 액션 (각 feature가 자기 파일 생성)
- `actions/members.ts` — `addMember/updateMember/removeMember` (PMO 권한, RLS 재검증, `revalidatePath`).
- `actions/attendance.ts` — `upsertAttendance/removeAttendance`.
- `actions/kanban.ts` — 드래그→`updateActual` 재사용 래퍼(또는 wbs.ts의 updateActual 직접 사용).

### DB 마이그레이션 (foundation이 작성)
`supabase/migrations/0003_ops.sql`:
```sql
alter table projects add column if not exists description text;
create table if not exists project_members (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  name text not null, email text, team_id uuid references teams(id) on delete set null,
  role text not null default 'contributor' check (role in ('admin','contributor')),
  title text, created_at timestamptz not null default now()
);
create index if not exists project_members_project_idx on project_members(project_id);
create table if not exists attendance_records (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  member_id uuid not null references project_members(id) on delete cascade,
  date date not null,
  type text not null check (type in ('work','remote','annual','half','sick','trip','official','absent')),
  note text, created_at timestamptz not null default now(),
  unique (member_id, date)
);
create index if not exists attendance_project_date_idx on attendance_records(project_id, date);
```
`supabase/migrations/0004_ops_rls.sql`: 두 테이블 `enable row level security`; select = 인증 사용자, insert/update/delete = `pmo_admin`(memberships 기준). `seed.sql`·`demo.ts`에 샘플 멤버/근태 추가.

### 도메인 순수함수 (feature가 작성, Vitest 동반)
- `domain/kanban.ts` — `groupByPhase/groupByOwner/groupByStatus(items): KanbanColumn[]`. + `kanban.test.ts`.
- `domain/attendance.ts` — `summarize(records): {total,leave,trip,remote}`, `byMemberAndDate(...)`, 월 그리드 헬퍼. + `attendance.test.ts`.

---

## 신규 기능 명세

### 1. 칸반 보드 `/p/:id/kanban`
- `getComputedWbs()` 재사용. task·activity 레벨 카드. 컬럼 그룹: **Phase별 / 담당자별 / 상태별** (`SegmentedTabs`). 필터(전체/진행중/완료) + 작업명·담당자 검색.
- 카드: 작업명, 기간(plannedStart~End), `ProgressBar`(실적%), `StatusPill`, 담당팀 배지.
- 드래그: **상태별 그룹에서만** 활성 — `done` 드롭→actual 100, `not_started` 드롭→0 (`updateActual`). Phase/담당자 그룹은 읽기 전용. status는 계산값이므로 직접 저장하지 않음.
- 헤더 요약: 전체 작업/진행중/전체 진척률.

### 2. 멤버 관리 `/p/:id/members`
- `PageHero`("…팀 구성", aside: TEAM SIZE / ADMINS / CONTRIBUTORS). MEMBER BOARD 카드 그리드(아바타·이름·역할·팀·직함).
- 멤버 추가/편집/삭제 모달(`Modal`) + `actions/members.ts`. DEMO는 읽기 전용.

### 3. 근태현황 `/p/:id/attendance`
- `PageHero`("근태현황", aside: TOTAL RECORDS / LEAVE DAYS / BUSINESS TRIP). 월 네비게이션 + 캘린더/리스트 토글(`SegmentedTabs`) + 멤버 필터.
- 캘린더: 월 그리드, 날짜별 근태 타입 점·배지. 리스트: 멤버×기간 표.
- 근태 등록 모달 + `actions/attendance.ts`. 타입별 색상 매핑. Asia/Seoul 기준. 순수함수 집계 Vitest.

### 4. 현황 보고서 (대시보드 액션 버튼)
- 라우트 아님 — 대시보드 히어로의 "현황 보고서" 버튼이 `ReportModal`(`components/report/`) 오픈. 보고서 본문: 프로젝트 개요/생성일, 전체 KPI, Phase별 진척, 지연 목록, 팀별 진척.
- "인쇄/PDF" 버튼 → `window.print()`; `@media print`로 보고서만 출력(헤더/사이드바 숨김). 외부 전송·공유는 범위 외.

### 5. 대시보드 리뉴얼 `/p/:id/dashboard`
- `PageHero`("…운영 현황", actions: WBS 보기/간트/칸반/현황 보고서, aside: ACTUAL PROGRESS·계획공정율·진행중·완료·지연 KPI 레일).
- 섹션: 상태 분포(Status Mix), 담당자별 작업량(Team Load), 지연 작업(N일 지연), 이번 주/다음 주 작업, Phase별 진척(계획vs실적), 프로젝트 일정(Timeline: 경과/잔여/총일수), 가중치 분포, 최근 완료, 금주 근태 요약. 기존 도메인·`collectLeaves` 재사용.

### 6. 워크스페이스 홈 `/projects` + 404
- DK Flow 홈: 히어로("한눈에 보이는 프로젝트 운영", 통계칩 TASKS/DONE/%), 전체/진행중/최근 KPI, QUICK ACCESS, 프로젝트 라이브러리 카드, 최근 프로젝트 카드.
- "새 프로젝트" = `Modal`(프로젝트명·설명·시작/종료; 복제 옵션은 보류). `createProject` 시그니처에 description 추가.
- `src/app/not-found.tsx` — 404 디자인.

### 7. 설정 리뉴얼 + WBS 히어로
- 설정: `PageHero`("…설정", aside: TASKS/BASE DATE/SCHEDULE) + 기본정보/엑셀 임포트(기존 폼 유지)/일정·공휴일/상태 정책 카드.
- WBS 페이지: 상단에 간단한 `PageHero`("WBS·간트") 추가, `WbsGanttSheet`는 **변경 없이** 그대로 렌더.

---

## 빌드 단계

- **Phase A — Foundation (직접, 검증):** 토큰/테마/Pretendard/lucide, providers, 공용 UI, 사이드바·헤더 재구성, 프로젝트 레이아웃에서 공유 히어로/탭 제거, DB 마이그레이션·seed·demo·타입·데이터 계층. `npm run build` 통과 확인(기존 페이지가 히어로 없이도 컴파일).
- **Phase B — Features (Workflow 병렬):** 칸반/멤버/근태/보고서/대시보드/홈/설정·WBS 히어로 — 각자 자기 파일만 생성/교체.
- **Phase C — 통합 검증(직접):** `npm install && npm run build && npm run lint && npm run test`. 파서·진척·롤업 기존 테스트 + 신규 도메인 테스트 그린. 불일치 수정 후 커밋.

## 비범위 (YAGNI)
AI 챗봇, 실시간 알림 백엔드(벨은 시각적 placeholder), 프로젝트 복제, 멤버 초대 메일, 근태 승인 워크플로, 보고서 외부 공유.
