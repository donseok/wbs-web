# 회의록 탐색기(폴더 사이드바 + 카드 그리드) 설계 (2026-07-23)

## 배경·목표

회의록 보관함의 **트리 뷰**(구분→회의체→회의록 단일 컬럼 접힘 목록)를, 사용자가 첨부한 레퍼런스 스크린샷과 같은 **탐색기 패러다임**으로 전면 교체한다: 좌측에 폴더 트리 레일, 우측에 선택 폴더의 하위 폴더 카드 + 회의록 카드 그리드. "깔끔하고 정돈된" 인상이 목표이며, 기존 디자인 토큰·프리미티브만 사용한다.

## 확정 요구사항 (사용자 결정 이력)

| 결정 | 내용 |
|------|------|
| 적용 범위 | **트리 탭 콘텐츠만 교체** — 리스트·달력 뷰와 상단 필터 바는 유지 |
| 카드 내용 | **요약 문단 포함** — `body_preview` 생성 컬럼(마이그레이션) 신설 |
| 즐겨찾기 | **회의록 별만 v1 포함** — `minute_favorites` 테이블 + 사이드바 ⭐ 가상 폴더. 폴더(회의체) 별은 v2 |
| 구현 접근 | **접근 A** — 신규 `MinutesExplorer` 단일 컴포넌트가 선택·펼침·레이아웃 상태를 자체 관리, `MinutesTree.tsx` 폐기 |

## 아키텍처

### 1) 마이그레이션 `supabase/migrations/0039_minutes_explorer.sql` (멱등)

**(a) `minutes.body_preview` — STORED 생성 컬럼.** 앱 코드의 쓰기 경로(작성·본문 교체·또박또박 외부 업로드 API)를 전혀 건드리지 않고 항상 일관되며, 기존 행 백필도 ALTER 시 자동이다(테이블 수백 행 규모라 재작성 비용 무시 가능).

```sql
alter table minutes add column if not exists body_preview text
  generated always as (
    left(
      btrim(regexp_replace(              -- 4. 공백·개행 접기
        regexp_replace(                  -- 3. 행머리 불릿 제거
          regexp_replace(                -- 2. 마크다운 기호 제거
            regexp_replace(body_md, '!?\[([^\]]*)\]\([^)]*\)', '\1', 'g'),  -- 1. 이미지/링크 → 라벨
            '[#*_`~>|]+', '', 'g'),
          '(^|\n)\s*[-+]\s+', '\1', 'g'),
        '\s+', ' ', 'g')),
      240)
  ) stored;
```

- SQL 근사 스트립임을 수용한다(표 구분선 잔해 등 경미한 노이즈 가능). 하이픈은 날짜(`2026-07-16`) 훼손을 피하기 위해 행머리 불릿 위치만 제거.
- 사용 함수(`regexp_replace`/`left`/`btrim`)는 모두 IMMUTABLE — 생성 컬럼 제약 충족.

**(b) `minute_favorites`** — 0017 `user_preferences`와 동일한 소유자 RLS 관례(순수 `auth.uid()`, 프로덕션 `app_role()` drift 무관).

```sql
create table if not exists minute_favorites (
  user_id    uuid not null references auth.users(id) on delete cascade,
  minute_id  uuid not null references minutes(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, minute_id)
);
alter table minute_favorites enable row level security;
drop policy if exists own_minute_favorites on minute_favorites;
create policy own_minute_favorites on minute_favorites
  for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
```

프로덕션 적용: 기존 Management API 레시피(키체인 "Supabase CLI" 토큰 → `/database/query`, `db push` 금지). 롤백 스크립트 `0039_*_rollback.sql` 동반(0038 관례).

### 2) 데이터 계층 — `src/lib/data/minutes.ts`

- `LIST_COLS`에 `body_preview, meetings(category)` 추가. `mapMinute`이 `bodyPreview`(null→''), `meetingCategory`(임베드 null 허용) 매핑. meetings는 전사 열람 가능(회의 달력)이라 임베드에 RLS 문제 없음 — 임베드가 null이면 칩만 생략.
- `Minute` 타입(`types.ts`)에 `bodyPreview?: string`, `meetingCategory?: MeetingCategory | null` 추가. `MinutesTreeLeaf`에도 동일 2필드 추가 — `buildMinutesTree`가 리프 조립 시 복사.
- 신규 `getMinuteFavorites(): Promise<string[] | null>` — `minute_favorites`에서 `minute_id`만 조회(RLS가 본인 행으로 한정). 실패 시 `console.error` + `null`(빈 배열과 구분 — 조용한 빈 화면 방지 원칙).

### 3) 서버 액션 — `src/app/actions/minutes.ts`

- `fetchMinuteFavorites()` — 세션 가드 후 `getMinuteFavorites()` 위임, 미로그인/실패 `null`(트리 액션과 동일 관례).
- `toggleMinuteFavorite(minuteId: string, on: boolean): Promise<boolean>` — insert(중복이면 upsert-ignore)/delete. 성공 여부만 반환, 실패 시 서버 로깅.

### 4) 페이지 프리페치 — `src/app/(app)/minutes/page.tsx`

기존 `Promise.all(getMinutesPage, getMinutesTree)`에 `getMinuteFavorites` 추가 → `initialFavorites` prop. 세션 없으면 `null`(initialTree와 동일 계약).

## UI 상세

### `MinutesView.tsx` 통합 (변경 최소)

- `MinutesTree` import 제거 → `MinutesExplorer`. 트리 탭의 상태 기계(`treeState`·`treeReqRef`·1회 조회·캐시 재사용·에러 카드+재시도·truncated 안내·팀 탭 클라이언트 프루닝·검색 시 리스트 강제·월 라벨 '전체 기간'·챗 스코프 전 기간·전체 내려받기 버튼)는 **전부 그대로**.
- 즐겨찾기 상태는 뷰 전환 언마운트에도 살아야 하므로 MinutesView 소유: `favState: 'idle' | 'error' | Set<string>` (initialFavorites → Set, null → 'error' 아님 'idle'로 두고 트리 탭 진입 시 1회 `fetchMinuteFavorites` 폴백 — initialTree 계약과 대칭). 실패 시 'error'.
- `toggleFav(minuteId)` — 낙관적 Set 갱신 → 액션 호출 → 실패 시 롤백 + 토스트(`min.exp.favToggleError`).
- 탐색기에는 프루닝된 `groups` + `favSet(또는 'error')` + 토글 콜백 + 초기 레이아웃(prefs) 전달.

### 신규 `src/components/minutes/MinutesExplorer.tsx`

**레이아웃**: `flex flex-col gap-4 lg:flex-row`. 좌측 레일 `card w-full lg:w-[240px] shrink-0 self-start p-2`, 우측 `min-w-0 flex-1`. lg 미만에서는 레일이 아코디언으로 강등(MinuteToc 패턴 답습).

**좌측 폴더 레일** (위→아래):

1. `⭐ 즐겨찾기 N` — N은 즐겨찾기 ∩ 현재 트리 리프(삭제·1000건 캡 밖 유령 카운트 방지). favState 'error'면 N 대신 `–`, 선택 시 우측에 에러 카드+재시도.
2. `📁 전체 N` — 루트. 항상 펼침(셰브런 없음), 행 클릭 = `all` 선택.
3. 팀 폴더 행(레벨1, 기본 펼침, 셰브런으로 접기 가능) — 기존 `FOLDER_TINT` 팀 틴트 폴더 아이콘 + 팀 코드 + 건수. 펼침 시 하위에 회의체 폴더 행(레벨2, 리프가 사이드바에 없으므로 레벨2 자체의 접힘 개념 불필요).
4. 행 구조: 중첩 버튼 금지 — 셰브런 `<button>`(펼침 토글, `aria-expanded`) + 이름 `<button>`(선택)을 나란히 배치. 선택 행은 `bg-brand-weak text-brand font-semibold` 강조(스크린샷의 활성 행 대응).

**선택 스코프** 4종: `all` | `favorites` | `team(tk)` | `body(tk, name)`. 뷰 전환 시 비영속(v1, 기존 접힘 상태와 동일 정책).

**우측 콘텐츠**:

- **헤더 행**: 경로 텍스트(`전체` / `전체 · PMO` / `전체 · PMO · 물류공정` / `즐겨찾기`) + 우측 `SegmentedTabs`(grid/list, lucide `LayoutGrid`/`List`). 레이아웃 선택은 `queueUiPref({ minutesExplorerLayout })`로 계정 동기화(`UiPrefs` 타입 확장, 병합 upsert라 타입 추가만으로 동작).
- **폴더 카드 섹션**(스코프에 하위 폴더가 있을 때): `grid gap-4 sm:grid-cols-2 xl:grid-cols-3`. 루트 → 팀 폴더 카드(팀 틴트 아이콘 + 팀명 + `회의록 N건 · 하위 폴더 N개`), 팀 → 회의체 폴더 카드(`회의록 N건 · 최근 YYYY-MM-DD`). 카드 클릭 = 드릴다운(선택 변경 + 사이드바 해당 팀 펼침).
- **회의록 카드 섹션**: 스코프 내 전체 리프(트리 입력 순서 = 날짜 내림차순 유지). 폴더 카드와 동일한 `grid gap-4 sm:grid-cols-2 xl:grid-cols-3` 반응형 그리드. 그리드 모드 카드 구성:
  - 1행: ☆/⭐ 토글 버튼(`aria-pressed`, lucide `Star`, 채움 `fill-accent-warning text-accent-warning` — Pin 선례 착색) + 제목(truncate) + 우측 팀 배지(`TEAM[tk].bar`).
  - 2행 칩: 회의 유형 칩(`meetingCategory` 있을 때, meetings dict의 기존 카테고리 라벨 키 재사용) + 회의체 칩(`📁 이름` — 회의체가 섞이는 all·favorites·team 스코프에서 표시, 단일 회의체인 body 스코프에서는 생략).
  - 3행: 요약 `line-clamp-3 text-sm text-ink-muted`(bodyPreview 빈 문자열이면 문단 생략).
  - 4행 푸터: `날짜 · 작성자 · 📎 N`(첨부 0이면 클립 생략).
  - 카드 전체는 `/minutes/{id}` 링크, 별 버튼만 클릭 전파 차단.
- **리스트 모드**: 기존 리스트 뷰 행 스타일 + 별 토글 + 유형 칩 + 요약 `line-clamp-1`(ink-subtle) 1행 추가된 콤팩트 행.
- **더 보기**: 회의록 카드는 30개씩 증분 노출(스코프 변경 시 리셋) — 전 기간 최대 1000건의 DOM 폭주 방지. 남은 건수를 버튼 라벨에 표기(`더 보기 (120)` 형태), 잘림을 침묵시키지 않는다.
- **빈 스코프**: 기존 `EmptyState` 재사용. 즐겨찾기 0건은 안내 문구(`min.exp.favEmpty`).

### i18n (`src/lib/i18n/dict/minutes.ts`, ko/en 쌍 — en은 타입 강제)

| 키 | ko | en |
|----|----|----|
| `min.exp.favorites` | 즐겨찾기 | Favorites |
| `min.exp.all` | 전체 | All |
| `min.exp.folders` | 폴더 | Folders (lg 미만 접이식 레일 헤더) |
| `min.exp.meetingCount` | 회의록 {n}건 | {n} minutes |
| `min.exp.subfolderCount` | 하위 폴더 {n}개 | {n} subfolders |
| `min.exp.latest` | 최근 {d} | Latest {d} |
| `min.exp.more` | 더 보기 ({n}) | Show more ({n}) |
| `min.exp.layout.grid` | 그리드 | Grid |
| `min.exp.layout.list` | 리스트 | List |
| `min.exp.favEmpty` | 별을 눌러 자주 보는 회의록을 모아두세요 | Star minutes to collect them here |
| `min.exp.favError` | 즐겨찾기를 불러오지 못했습니다 | Failed to load favorites |
| `min.exp.favToggleError` | 즐겨찾기 저장에 실패했습니다 | Failed to save favorite |
| `min.exp.starAdd` / `min.exp.starRemove` | 즐겨찾기 추가 / 해제 | Add to favorites / Remove |

회의 유형 칩 라벨은 meetings dict 기존 카테고리 키 재사용(신규 키 없음). `min.tree.*` 중 `expandAll/collapseAll`은 탐색기에서 미사용 시 제거하지 않고 잔존(공유 키 정리는 비범위).

## 에러 처리

- 트리 로딩/에러/빈 상태: 기존 그대로(스켈레톤 / 에러 카드+재시도 / EmptyState).
- 즐겨찾기 조회 실패: 사이드바 카운트 `–` + 해당 스코프 선택 시 에러 카드+재시도(조용한 0건 위장 금지).
- 별 토글 실패: 낙관적 갱신 롤백 + 토스트. `console.error` 서버 로깅 병행.

## 테스트 (vitest, testing-library 미사용 — createRoot+act 관례)

- **재작성** `tests/ui/minutes-tree.test.tsx` → `minutes-explorer.test.tsx`: 레일 기본 상태(팀 펼침·회의체 행 노출), 선택→우측 스코프 전환, 폴더 카드 드릴다운, 즐겨찾기 토글(낙관적 갱신+실패 롤백), 더 보기 증분, grid/list 전환 시 `queueUiPref` 호출, 즐겨찾기 에러 시 `–`+에러 카드.
- **수정** `minutes-view-tree-toggle.test.tsx`: 7개 기존 계약(1회 조회·캐시·allPeriod·에러 재시도·팀 프루닝·truncated·챗 스코프) 유지, 렌더 단언만 탐색기 DOM으로 갱신.
- **수정** `minutes-view-initial-tree.test.tsx`: 기존 계약 유지 + `initialFavorites` 프리페치 시 재조회 0회 계약 추가.
- **확인** `minutes-export-download.test.tsx`: 툴바 불변이므로 통과 예상 — 실행으로 확인만.
- **도메인** `tests/domain/minutesTree.test.ts`: 리프 `bodyPreview`/`meetingCategory` 패스스루 케이스 추가.
- **액션** 신규: `toggleMinuteFavorite` 세션 가드·insert/delete 분기(가짜 빌더 관례).
- 수동 검증: `npm run build`/`lint`/`test` + verify 스킬(샌드박스 브라우저 불가 → curl 스모크).

## 비범위 (v1 제외)

- 폴더(회의체) 즐겨찾기 — 제목 파생 키의 느슨함 때문에 보류
- 스크린샷의 기간(from~to) 필터, 가져오기(.tgz), 상태 배지·#번호(대응 데이터 없음), 휴지통
- 폴더 선택·펼침 상태 영속화(계정 동기화)
- 탐색기 내 검색(기존 상단 검색 = 리스트 강제 유지)
- 기존 리스트·달력 뷰에 요약/칩/별 노출(카드 전용)
- 1000건 캡 초과 시 정확 카운트·페이지네이션(기존 트리 스펙의 비범위 항목 승계)
