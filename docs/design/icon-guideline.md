# D'Flow 아이콘 가이드라인

D'Flow 전반에서 **하나의 개념에는 하나의 아이콘**을 쓰기 위한 정본(canonical) 매핑이다.
모든 아이콘은 [`lucide-react`](https://lucide.dev) 단일 소스에서 가져온다. 새 화면/기능을 만들 때
아래 표에 있는 개념이면 반드시 같은 아이콘을 재사용하고, 표에 없을 때만 새 아이콘을 도입한다.

> 색상은 토큰(`text-brand`, `text-done`, `text-delayed`, `text-accent-warning` 등)으로만 지정한다.
> 헥스 직접 사용 금지. 라이트/다크 모두에서 검증한다.

---

## 1. 내비게이션 (Sidebar · 헤더 메뉴)

| 개념 | lucide | import | 비고 |
|------|--------|--------|------|
| 대시보드 | `LayoutDashboard` | `LayoutDashboard` | 프로젝트 진입 기본 화면 |
| WBS | `ListTree` | `ListTree` | WBS·간트 병합 시트의 대표 아이콘 |
| 간트 차트 | `GanttChartSquare` | `GanttChartSquare` | 대시보드 퀵링크 기준. ※ 현재 Sidebar 의 "간트" 항목은 `CalendarDays` 를 쓰므로 차후 `GanttChartSquare` 로 통일 권장 |
| 칸반 보드 | `Columns3` | `Columns3` | |
| 이슈관리 | `CircleAlert` | `CircleAlert` | 프로젝트 리스크/장애물. 지연·위험 "상태" 의미의 `AlertTriangle` 과 구분 |
| 멤버 | `Users` | `Users` | |
| 근태현황 | `CalendarCheck` | `CalendarCheck` | |
| 설정 | `Settings` | `Settings` | |
| 전체 프로젝트(워크스페이스) | `LayoutGrid` | `LayoutGrid` | 프로젝트 미선택 시 홈 |
| 프로젝트 항목 | `FolderOpen` | `FolderOpen` | 사이드바 프로젝트 리스트 |

## 2. 액션

| 개념 | lucide | 비고 |
|------|--------|------|
| 추가 / 새로 만들기 | `Plus` | 신규 프로젝트·항목·멤버 |
| 편집 | `Pencil` | 인라인/모달 수정 |
| 삭제 | `Trash2` | 파괴적 액션 → `text-delayed` |
| 저장 | `Save` | 폼 커밋. 즉시완료 토글은 `Check` |
| 확인 / 완료 | `Check` | 체크박스·완료 표시 |
| 검색 | `Search` | 입력 좌측 아이콘 |
| 필터 | `Filter` | |
| 내보내기 / 다운로드 | `Download` | 엑셀·CSV 내보내기 |
| 가져오기 / 업로드 | `Upload` | WBS 엑셀 임포트 |
| 인쇄 | `Printer` | 현황 보고서 |
| 펼치기 / 접기 | `ChevronRight` / `ChevronDown` | 트리·아코디언 |
| 닫기 | `X` | 모달·토스트·팝오버 |

## 3. 상태 (작업/공정)

| 상태 | lucide | 토큰색 |
|------|--------|--------|
| 완료 (done) | `CheckCircle2` | `text-done` |
| 진행중 (in-progress) | `Activity` | `text-brand` / `text-accent-warning` |
| 지연 (delayed) | `AlertTriangle` | `text-delayed` |
| 시작 전 (not-started) | `Circle` | `text-pending` |

## 4. 근태 유형

`src/lib/domain/attendance.ts` 의 8개 유형과 1:1.

| 유형 | 코드 | lucide | 토큰색 |
|------|------|--------|--------|
| 근무 | `work` | `Briefcase` | `text-ink-muted` |
| 재택 | `remote` | `Laptop` | `text-brand` |
| 연차 | `annual` | `Palmtree` | `text-progress` |
| 반차 | `half` | `Clock` | `text-progress` |
| 병가 | `sick` | `Thermometer` | `text-delayed` |
| 출장 | `trip` | `PlaneTakeoff` | `text-accent-secondary` |
| 공가 | `official` | `Stamp` | `text-pending` |
| 결근 | `absent` | `CircleSlash` | `text-delayed` |

## 5. 헤더 크롬

| 개념 | lucide | 비고 |
|------|--------|------|
| 알림 | `Bell` | 미확인 시 `bg-accent-secondary` 도트 |
| 테마(라이트/다크) | `Sun` / `Moon` | 현재 테마의 반대 아이콘 표시 |
| 언어 | `Globe` | KO/EN 토글 |
| 프로필 | `User` | |
| 로그아웃 | `LogOut` | hover 시 `text-delayed` |
| 기준일 토글 | `Hand` | 자동/수동 |
| 오늘 날짜 | `CalendarDays` | |
| 모바일 메뉴 열기 | `Menu` | |

---

## 6. 크기 · 사용 규칙

| 맥락 | 클래스 | px |
|------|--------|----|
| 기본 인라인(버튼·칩·KPI 아이콘칩 내부) | `h-4 w-4` | 16 |
| 사이드바 메뉴 · 리스트 아이템 | `h-[18px] w-[18px]` | 18 |
| 텍스트/배지 내부 보조 | `h-3.5 w-3.5` | 14 |
| 섹션/KPI 아이콘 칩 래퍼 | `h-9 w-9` (아이콘 `h-4 w-4`) | 36 |
| 히어로·빈 상태 대형 | 래퍼 `h-12 w-12` (아이콘 `h-5 w-5`) | 48 / 20 |

규칙:

- **stroke-width 는 lucide 기본값(2) 유지** — 임의 변경 금지. 자체 SVG(`Icon.tsx`)는 1.8 로 통일돼 있다.
- **아이콘-only 버튼에는 반드시 `aria-label`** 을 단다.
- **의미색은 토큰으로만** (`text-done`/`text-brand`/`text-delayed`/`text-accent-warning`/`text-pending`).
- **한 개념 = 한 아이콘.** 같은 액션에 다른 아이콘을 새로 들이지 않는다. 새 개념이면 이 문서에 먼저 추가한다.
- **브랜드 마크는 아이콘이 아니다** — 로고 자리는 `BrandMark`/`BrandGlyph`(`src/components/ui/BrandMark.tsx`)를 쓰고 lucide `Sparkles` 등으로 대체하지 않는다.

---

## 변경 이력

| 날짜 | 변경 | 사유 |
|------|------|------|
| 2026-06-29 | 최초 작성 — 내비/액션/상태/근태/크롬 정본 매핑 + 크기 규칙 | DK Flow → D'Flow 리브랜딩에 맞춰 아이콘 사용 일관성 확보 |
| 2026-07-23 | 내비게이션 정본에 이슈관리(`CircleAlert`) 등록 | 이슈관리 메뉴 신설 |
