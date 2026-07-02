# 공지사항 (Announcements) 설계 — 2026-07-02

## 1. 개요와 목표

프로젝트별 공지사항 기능을 신설한다. PMO 관리자가 프로젝트 단위로 공지를 작성·고정하고, 해당 프로젝트에 접근하는 모든 사용자(게스트 포함)가 열람한다. 사이드바 메뉴의 안읽음 배지로 새 공지가 실제로 읽히게 만든다.

**확정된 결정** (사용자 선택 + 코드베이스 분석 근거):

| 결정 | 값 | 근거 |
|---|---|---|
| 범위 | 프로젝트별 (`/p/[projectId]/announcements`) | 사용자 선택. 앱의 모든 기능 섹션이 프로젝트 스코프 |
| 기능 수준 | 표준형: 제목+본문+카테고리+고정(pin)+안읽음 배지 | 사용자 부재로 추천안 채택(위임: "알아서 해줘") |
| 작성 권한 | `pmo_admin` 전용 (수정·삭제·고정 포함) | 실권한 모델이 전역 `memberships.role` 하나뿐. 모든 기존 쓰기가 pmo_admin으로 수렴 |
| 열람 권한 | 인증된 전원 (membership 없는 게스트 포함) | 기존 read_all RLS 관례와 동일 |
| 본문 형식 | 플레인 텍스트 + `whitespace-pre-wrap` (줄바꿈 유지) | 리치텍스트 스택 부재. 무의존성 기존 관례 (DkBot Bubble과 동일) |
| 아키텍처 | 전용 페이지 + 대시보드 카드 + 사이드바 배지 (A안) | attendance/members 수직 슬라이스 1:1 복제로 관례 이탈 최소화 |

## 2. 데이터 모델 — `supabase/migrations/0012_announcements.sql`

기존 관례(0003_ops.sql)를 따른다: uuid PK `gen_random_uuid()`, `project_id` FK cascade, text CHECK 유사-enum, `created_at timestamptz default now()`, 재실행 안전 DDL.

```sql
create table if not exists announcements (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  title text not null,
  body text not null default '',
  category text not null default 'general'
    check (category in ('general', 'important', 'event')),
  is_pinned boolean not null default false,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_announcements_project
  on announcements(project_id, created_at desc);

-- 읽음 워터마크: 사용자·프로젝트당 1행. 공지별 읽음 행 대신 "마지막으로 본 시각"만 기록
create table if not exists announcement_seen (
  user_id uuid not null references auth.users(id) on delete cascade,
  project_id uuid not null references projects(id) on delete cascade,
  last_seen_at timestamptz not null default now(),
  primary key (user_id, project_id)
);
```

**RLS** (같은 파일에 포함, 0004_ops_rls.sql 패턴):

- `announcements`: SELECT는 authenticated 전원 `using (true)`; 쓰기 전체는 `app_role() = 'pmo_admin'`. (레포 0002/0004 파일에는 `current_role()`로 적혀 있으나 PG 예약어라 적용 불가 — 프로덕션 실배포 헬퍼는 `public.app_role()`, 2026-07-02 확인.)
- `announcement_seen`: 본인 행만 — `for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid())`. 이 앱 최초의 per-user RLS이지만 표준 형태.

**읽음 워터마크 선택 이유**: 공지별 read 행(N×M) 대신 워터마크 1행이면 안읽음 수 = `created_at > last_seen_at`인 공지 수로 충분. "누가 읽었나" 수신 확인이 필요해지면 그때 per-item 테이블로 확장(§9).

**적용 절차**: 마이그레이션은 수동 적용(관례). `scripts/apply-dkbot-migration.mjs` 패턴을 따라 Supabase(ref `rglfgrwwwwdqejohdnty`)에 적용하고, SQL은 SQL Editor에 붙여넣어도 안전하게 멱등으로 작성한다.

## 3. 도메인 계층 — `src/lib/domain/announcements.ts` (+ types.ts)

순수 함수만. 유일하게 단위 테스트가 붙는 계층.

- `types.ts`에 추가: `Announcement { id, projectId, title, body, category: AnnouncementCategory, isPinned, createdAt, updatedAt }` (camelCase, 날짜는 ISO 문자열). `AnnouncementCategory = 'general' | 'important' | 'event'`.
- `ANNOUNCEMENT_META: Record<AnnouncementCategory, { labelKey, chip, dot }>` — ATTENDANCE_META 패턴. 토큰 톤: general→brand, important→delayed, event→progress. 라벨은 dict 키로 표시 시점 해석.
- `sortAnnouncements(items)`: 고정 우선 → created_at 내림차순.
- `countUnread(items, lastSeenAt: string | null)`: lastSeenAt이 null이면 전부 안읽음; `createdAt > lastSeenAt` 초과 비교(경계 동일 시각은 읽음).
- `summarizeAnnouncements(items, todayIso)`: KPI용 { total, pinned, recent7d }.

## 4. 데이터 리더 — `src/lib/data/announcements.ts`

attendance.ts 클론: React `cache()` 래핑, `createServerClient()`(RLS 적용, admin 클라이언트 금지), 명시적 컬럼 select, snake→camel 수동 매핑, 실패 시 `[]`.

- `getAnnouncements(projectId): Promise<Announcement[]>` — `.order('is_pinned', desc).order('created_at', desc)`.
- `getAnnouncementSeenAt(projectId): Promise<string | null>` — 현재 세션 사용자의 워터마크 (RLS가 본인 행만 허용하므로 user 필터는 방어적 중복).

## 5. 서버 액션 — `src/app/actions/announcements.ts`

members.ts 템플릿: `'use server'`, 입력 검증 → `getMembership()` 게이트 → DB → `revalidatePath` → `{ ok, error? }` 반환(절대 throw 금지). null 멤버십('로그인 필요')과 권한 부족('권한 없음')을 구분.

- `createAnnouncement({ projectId, title, body, category, isPinned })` — pmo_admin. 검증: title 트림 후 1~200자, body ≤ 20,000자, category는 3종 중 하나. `created_by`에 세션 user id 기록.
- `updateAnnouncement(id, { title, body, category, isPinned })` — pmo_admin. `updated_at`을 수동 갱신(wbs.ts 관례; 트리거 없음).
- `deleteAnnouncement(id)` — pmo_admin. 하드 삭제(소프트 삭제 관례 없음).
- `markAnnouncementsSeen(projectId)` — 인증 사용자 누구나(게스트 포함, 멤버십 불요). `announcement_seen` upsert(onConflict `user_id,project_id`), `last_seen_at = now()`.
- `getUnreadAnnouncementCount(projectId)` — 인증 사용자 누구나. 워터마크 조회 후 `created_at > last_seen_at` count(워터마크 없으면 전체 count). 사이드바 배지가 클라이언트에서 호출.

revalidatePath: 쓰기 3종은 `/p/${projectId}/announcements`와 `/p/${projectId}/dashboard` 둘 다(대시보드 카드 반영).

## 6. UI

### 6.1 라우트 — `src/app/(app)/p/[projectId]/announcements/{page,loading}.tsx`

members/page.tsx 1:1: async 서버 컴포넌트, `params: Promise<{projectId}>` await, `Promise.all(getAnnouncements, getAnnouncementSeenAt, getMembership, getServerLocale)`, `canEdit = role === 'pmo_admin'`, `ProjectPageShell` + `PageHero`(eyebrow/제목/HeroBadge) + heroKpis(`KpiCard variant="hero"` — 전체/고정/최근 7일). loading.tsx는 Skeleton/KpiSkeleton으로 최종 레이아웃 미러링 + `role="status"`.

### 6.2 보드 — `src/components/announcements/AnnouncementsView.tsx` (client)

MembersBoard/AttendanceView 관례:

- `.card` 컨테이너, 헤더 행(eyebrow + "공지사항 · N" + canEdit 시 `.btn-primary` 새 공지 버튼).
- 필터: `SegmentedTabs` — 전체 / 일반 / 중요 / 행사. 고정 공지는 모든 필터에서 항상 최상단.
- 목록 아이템: 카테고리 chip(ANNOUNCEMENT_META) + 고정 시 Pin 아이콘 + 제목 + 본문 미리보기 `line-clamp-2` + 날짜. `createdAt > lastSeenAt`이면 NEW chip.
- 상세: 아이템 클릭 → 읽기 Modal(제목·chip·날짜·본문 `whitespace-pre-wrap`, 내부 스크롤 max-h-[70vh]). canEdit이면 footer에 수정/삭제 진입.
- 작성/수정: 단일 폼 Modal(`.app-input` 제목, `.app-textarea` 본문, 카테고리 select, 고정 체크박스). 인라인 에러(text-delayed) + 저장 중 busy 라벨 + `useTransition`. 성공 시 닫고 `router.refresh()` (성공 토스트 없음 — CRUD 관례 준수).
- 삭제: 별도 소형 확인 Modal(수정 모달과 상호 배타), 위험 버튼.
- 빈 상태: `EmptyState`(Megaphone 아이콘) + canEdit 시 작성 액션.
- **읽음 처리**: 마운트 시 `markAnnouncementsSeen(projectId)` 1회 호출하되 refresh하지 않음 — NEW chip은 이번 방문 동안 유지되고, 배지는 다음 네비게이션에 소멸.

### 6.3 네비 등록 (3곳 + dict)

1. `Sidebar.tsx` `projectMenu()`에 항목 추가 — lucide `Megaphone`, `nav.announcements`.
2. `HeaderChrome.tsx` MobileMenu links 배열에 동일 항목.
3. `HeaderChrome.tsx` `SECTION_LABEL` 맵에 breadcrumb 라벨(기존 스타일 준수).
4. `dict/common.ts`에 `nav.announcements` ko/en.

### 6.4 사이드바 안읽음 배지

Sidebar(client)에서 헤더 벨과 동일 패턴: pathname 변화에 keyed된 useEffect → 활성 projectId가 있으면 `getUnreadAnnouncementCount(activeId)` → 공지 메뉴 항목 우측에 카운트 배지(brand 톤, 99+ 캡). pathname 키잉이라 공지 페이지 방문 후 다른 페이지로 이동하면 재조회되어 배지가 사라진다. 폴링·Realtime 없음(앱 관례).

### 6.5 대시보드 카드

`dashboard/page.tsx`의 Promise.all에 `getAnnouncements` 추가 → 상위 3건(고정 우선)을 `DashboardView`에 prop으로 전달 → `SectionCard`(공지사항, Megaphone 아이콘, actions에 "전체 보기" 링크) 안에 미니 목록(chip+제목+날짜). 없으면 MiniEmpty 스타일 dashed box.

## 7. i18n — `src/lib/i18n/dict/announcements.ts`

`announcementsKo as const` + `announcementsEn: Record<keyof typeof announcementsKo, string>`(컴파일 타임 ko↔en 패리티), `dict.ts`에 등록. 키 네임스페이스 `ann.*`. 모든 사용자 노출 문자열은 dict 경유(카테고리 라벨, 버튼, 빈 상태, 에러, KPI 라벨, NEW 등). 서버는 `t(locale, key)`, 클라이언트는 `useLocale().t`.

## 8. 에러 처리·엣지 케이스

- 액션 실패: `{ ok: false, error }` → 폼 인라인 에러 표시. 리더 실패: `[]` (기존 관례).
- 게스트(멤버십 null): 열람·읽음 처리 가능, 편집 affordance는 숨김(비활성 아님).
- 워터마크 경합(빠른 중복 방문): upsert last-write-wins, 무해.
- 프로젝트 삭제: 두 테이블 모두 FK cascade로 정리.
- 긴 본문: 목록은 line-clamp-2, 상세 Modal은 내부 스크롤.
- z-index: Modal z-[150] 고정 사다리 준수, 신규 레이어 도입 없음.
- 작성자 표시는 v1 제외: `created_by`는 저장하지만 auth.users 이메일/이름을 anon 클라이언트로 조회할 수 없어 표시 생략(추후 확장 여지로 컬럼만 확보).

## 9. 명시적 제외 (v1 아웃)

파일 첨부(0008 레시피로 추후 가능), 댓글, 예약 게시, 리치텍스트/마크다운, 헤더 벨 피드 통합, 수신 확인(누가 읽었는지 — per-item read 테이블 필요), DkBot RAG 인덱싱(0010 kind 확장으로 추후 가능), 전역(워크스페이스) 공지.

## 10. 테스트·검증

- `tests/domain/announcements.test.ts` (vitest, node env — 순수 함수만): `sortAnnouncements`(고정 우선/날짜 역순/안정성), `countUnread`(null 워터마크=전부, 경계 동일 시각=읽음, 빈 배열), `summarizeAnnouncements`(recent7d 경계 포함), `ANNOUNCEMENT_META` 완전성(3개 카테고리 모두 labelKey/chip/dot 보유).
- 컴포넌트/액션은 테스트하지 않음(관례) → `npm run build` + `npm run lint` + `npm test`로 검증. 브라우저로 dev 서버 접근 불가 환경이므로 라이브 확인은 빌드·정적 검증으로 대체.
- 커밋은 스코프된 경로만 (`git add -A` 금지 — 병렬 세션).
