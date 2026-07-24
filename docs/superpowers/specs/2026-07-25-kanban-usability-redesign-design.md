# 칸반보드 활용성 개선 설계 — 「실행·집중 보드」

- 날짜: 2026-07-25
- 상태: 설계 확정(구현 전) — 사용자 승인 대기
- 한 줄: WBS 항목을 그대로 둔 채 **칸반의 UX만 대개조**해 실무자가 매일 여는 실행 보드로 만든다. `wbs_items.actual_pct` 외 어떤 데이터도 쓰지 않고, WBS·이슈 등 **다른 기능의 스키마·페이지·로직은 일절 건드리지 않는다.**

관련 메모: [[kanban-improvement-scope]] · [[dkflow-design-consistency]] · [[dcube-data-protection]] · [[silent-empty-screens]] · [[pct-precision-convention]]

---

## 1. 배경 & 목표

현재 칸반(`/p/[projectId]/kanban`)은 WBS 리프(말단) 항목을 보여주는 **WBS 시트의 축약 조회 화면 + 완료 토글**에 가깝다. 실사용자 활용률이 낮고, 원인은 4가지가 동시에 성립한다(사용자 확인).

1. **WBS 시트와 겹쳐 쓸 이유가 없음** — 같은 데이터의 정적 뷰
2. **상호작용이 빈약** — 상태가 파생값(진척% vs 계획%)이라 드래그가 사실상 완료(100%)/시작전(0%) 토글뿐, 그것도 `상태` 모드에서만. 기본 `단계` 뷰는 읽기 전용
3. **개인 관점 부재** — "내가 볼 것"이 안 보임(담당이 팀 단위, 개인 마감·우선순위 없음)
4. **발견성·사용법 부족** — 드래그 가능한지조차 모름

**목표:** 위 4가지를 스코프 제약(아래 §3) 안에서 최대한 해소해, 칸반을 "지금 움직여야 할 것"을 골라 보고 손대는 **실행·집중 보드**로 재정의한다.

---

## 2. 정체성 & 성공 기준

**정체성.** WBS 시트 = 전체 계획 원장(무겁고 정밀, 모든 항목). 칸반 = 실행·집중 보드(가볍고 개인적, 지금 할 것만). **같은 데이터라도 목적이 다르면 겹치지 않는다** — 이것이 겹침 문제의 근본 해법이다.

**성공 기준(정성).**
- 실무자가 "내 팀 일 / 지연 / 이번 주 마감"을 3초 안에 좁혀 본다.
- 진척을 카드 드래그·스텝퍼로 **WBS 시트를 열지 않고** 갱신한다.
- 처음 방문해도 "끌 수 있다"는 것과 "무엇을 하는 화면인지"를 즉시 안다.

**비목표.** 개인(1인) 단위 담당 배정, 우선순위/라벨, 실시간 동시편집 표시 — WBS 데이터 모델·타 기능 변경 없이는 불가하거나 과범위. §15에 남긴다.

---

## 3. 범위 & 비범위 (하드 제약)

**변경 허용 파일(칸반 자기완결 범위):**
- `src/components/kanban/*` (KanbanBoard, KanbanCard, 신규 하위 컴포넌트)
- `src/lib/domain/kanban.ts` (순수 도메인 함수)
- `src/app/(app)/p/[projectId]/kanban/page.tsx` (서버 컴포넌트 — 읽기·prop 전달만)
- `src/lib/i18n/dict/kanban.ts` (사전, ko/en 패리티 유지)
- 신규 칸반 전용 파일(예: `src/lib/domain/kanban-drop.ts` 순수 로직, 신규 UI 컴포넌트)

**절대 변경 금지:**
- WBS 스키마·마이그레이션·`wbs_items` 컬럼, `app/actions/wbs.ts`의 로직(시그니처)
- 이슈/회의/주간 등 **다른 기능의 스키마·페이지·서버 액션·도메인**
- 신규 테이블·컬럼 없음(칸반 전용 저장소도 이번 범위 밖)

**쓰기 경로:** 오직 기존 서버 액션 `updateActual(itemId, newPct, expectedCurrent?)`(=`wbs_items.actual_pct` 갱신) 재사용. 새 쓰기 경로·새 액션 없음. 이 액션은 이미 0~100 검증·리프 전용·권한 fail-closed·`change_logs` 감사·스냅샷·`expectedCurrent` 낙관적 잠금을 지원한다(현 칸반은 `expectedCurrent`를 안 넘김 → 본 설계에서 넘기도록 개선).

**읽기:** 기존 `getComputedWbs(projectId)` 그대로. 렌즈("내 팀")·필터는 이미 페이지에 있는 `ComputedItem`·`membership` 데이터로만 계산(추가 조회 없음).

**디자인:** 기존 토큰 팔레트·공용 프리미티브(`ProgressBar`·`StatusPill`·`OwnerBadges`·`SegmentedTabs`·`shared.tsx`) 재사용, 라이트/다크 자동 대응.

**롤백:** 코드 먼저(데이터 마이그레이션 없음이므로 코드 revert = 완전 롤백). 기존 라우트·URL 파라미터(`?view=`, `?team=`) 호환 유지.

---

## 4. 컬럼 & 드래그 재설계 — 진척 3단(단일축)

### 4.1 컬럼 = 진척 버킷(파생 상태가 아니라 **원시 실적%** 기준)

컬럼은 파생 `status`가 아니라 **`rolledActualPct`(리프=`actualPct`)의 버킷**으로 정의한다. 이래야 드래그가 결정적으로 동작한다(놓은 칸 = 실제로 도달하는 칸).

```
bucketOf(pct):   pct <= 0 → 'not_started'   (시작전)
                 pct >= 100 → 'done'         (완료)
                 else → 'in_progress'        (진행중, 1~99%)
```

컬럼 3개: **시작전(0%) · 진행중(1–99%) · 완료(100%)**. `actualPct`가 null이면 0으로 간주(시작전).

**지연은 컬럼이 아니라 카드 배지 + 빠른 필터로.** 지연도 결국 "진행중인 일"이므로 워크플로 단계가 아니라 **속성**이다. 기존 `상태` 모드의 4번째 '지연' 칸을 이렇게 흡수한다. (파생 `status==='delayed'`는 배지/필터/정렬 신호로 계속 활용.)

### 4.2 드롭 동작(순수 상태기계 `resolveDrop`)

권한(`canEditActual(card, membership)`)이 없는 카드는 애초에 draggable=false → 아래 로직 진입 전 차단. `cur = card.rolledActualPct`.

| 대상 컬럼 | 조건 | 결과 |
|---|---|---|
| 시작전 | `cur === 0` | `noop`(재정렬만) |
| 시작전 | `cur > 0` | `confirm-reset` → 확인창 후 `updateActual(id, 0)` |
| 완료 | `cur === 100` | `noop` |
| 완료 | `cur < 100` | `set` → `updateActual(id, 100)` |
| 진행중 | `0 < cur < 100` | `noop`(같은 칸 내 재정렬, % 무변경) |
| 진행중 | `cur === 0` | `prompt`(인라인 % 팝오버, 제안값 30) |
| 진행중 | `cur === 100` | `prompt`(재개, 제안값 90) |

- **`confirm-reset`**(진척>0 → 0%): 실수로 실적을 날리지 않도록 확인 모달("진척을 0%로 되돌립니다. 계속할까요?"). 데이터 보호 목적([[dcube-data-protection]]).
- **`prompt`**(진행중으로 새로 진입/재개): **인라인 % 팝오버**를 띄운다 — 프리셋 칩 `10 · 30 · 50 · 70 · 90` + 직접 입력(1–99). 값을 고르면 `updateActual(id, chosen)`. **취소하면 아무 것도 쓰지 않고 카드는 원위치**로 스냅백. → 임의 숫자 자동기입으로 데이터를 오염시키지 않는다.
- **`noop`**: 서버 호출 없음(향후 카드 순서는 Phase 2, 지금은 순서 저장 안 함).

`resolveDrop`는 I/O 없는 순수 함수 → 단위 테스트로 전 분기 커버(§13).

### 4.3 진행중 카드의 +/− 스텝퍼

진행중(1–99%) 카드에는 카드 위에 **`−` / `+` 스텝퍼**(step 10, 1–99로 클램프)를 둬 팝오버 없이 빠르게 미세조정. `+`로 100 도달 시 자동으로 완료 버킷, `−`로 0 도달 시 확인 후 시작전. 각 조작은 `updateActual` 1회.

### 4.4 뷰 모드 토글

기존 `Phase별/담당자별/상태별` 3-토글을 재정의한다.

- **진행(진척)** — 신규 기본값. 드래그·스텝퍼로 진척 이동 가능(위 로직).
- **단계** — 기존 `groupByPhase` 재사용, **조회 전용**(그룹 개관용).
- **담당** — 기존 `groupByOwner` 재사용, **조회 전용**.

조회 전용 뷰는 상단에 "이 뷰는 조회 전용 — 진척 이동은 '진행' 뷰에서" 힌트를 노출(발견성). `?view=` 파라미터 하위호환: `status`→`진행`으로 매핑, `phase/owner` 유지.

> 열린 결정(§15): 활용률이 오르면 조회 전용 단계/담당 뷰는 필터/스윔레인으로 흡수하며 제거 검토.

---

## 5. 카드 재설계

현재 카드(작업명 2줄 · 계획기간 · 진척바+% · StatusPill · OwnerBadges)에 다음을 더한다. 모두 **이미 `ComputedItem`에 있는 데이터**로 구성(추가 조회 없음).

- **상위 단계 breadcrumb** — 리프가 속한 최상위 phase 이름 칩(맥락). 순수 함수 `leafPaths(items)`(리프 id → 조상 이름 배열)로 계산, 카드에 `pathLabel` prop 전달.
- **D-day / 지연 배지** — `plannedEnd`·`today`(KST)·`status` 기반:
  - `status==='delayed'` 또는 `plannedEnd < today && cur<100` → **`지연 N일`**(빨강, `bg-delayed-weak text-delayed`)
  - else `plannedEnd >= today` → **`D-N`**(≤3일이면 강조)
  - `plannedEnd` 없음 → 배지 없음
  - 순수 함수 `dueSignal(plannedEnd, cur, today)` → `{ kind:'overdue', days } | { kind:'due', days } | null`
- **드래그 핸들 + 호버 엘리베이션** — "끌 수 있음"을 시각화(진행 뷰에서만). 기존 `cursor-grab`·`hover:shadow-md` 확장.
- **+/− 스텝퍼**(진행중 카드, §4.3).
- **카드 클릭 = WBS 시트 딥링크** — 해당 리프로 스크롤/포커스되는 WBS 경로로 이동(편집은 거기서). 읽기 이동이라 제약 무관. (드래그와 클릭 구분: 드래그 임계 이동 없을 때만 클릭 처리.)

카드는 계속 **리프 전용**. 진척%·색·상태 표기는 [[pct-precision-convention]] 준수(카드 %는 `Math.round`).

---

## 6. 렌즈 · 필터 · 정렬

상단 툴바(진행 뷰):

- **"내 팀 ↔ 전체" 렌즈 토글** — "내 팀" = `owners.some(o => o.team === membership.teamCode)`인 리프만. ⚠️ WBS 담당은 **팀 단위**라 진짜 개인 필터는 불가(정직하게 "내 팀"으로 명명). 기본값: `team_editor`는 **내 팀**, `pmo_admin`은 **전체**.
- **빠른 필터 칩(다중 선택)**:
  - `지연` = `status==='delayed'`
  - `이번 주 마감` = `plannedEnd`가 `[today, today+6일]`(KST) 범위
  - `진행중` = `bucketOf==='in_progress'`
  - `미착수` = `bucketOf==='not_started'`
- **정렬(칼럼 내부)** = 지연 우선 → 마감 임박 → 계획종료 오름차순 → 이름. 순수 함수 `sortCards(cards, today)`.
- **검색** 유지(이름·코드·담당팀 매칭). `?team=CODE` 딥링크 하위호환.

모든 렌즈·필터·검색·정렬은 **순수 함수 + 클라이언트 계산**(읽은 데이터만 사용, 추가 I/O 없음).

---

## 7. 상호작용 품질

- **낙관적 업데이트** — 현재는 서버 왕복 후 `router.refresh()`라 카드가 늦게 움직임. 로컬 오버라이드 맵 `{ [id]: pct }`를 서버 데이터 위에 얹어 **즉시 이동** → 액션 성공 시 refresh로 확정, **실패 시 오버라이드 제거(원위치) + 토스트**.
- **충돌 감지(CAS)** — `updateActual(id, newPct, expectedCurrent = cur)`로 호출. 다른 사용자가 먼저 바꾼 경우 액션이 충돌 반환 → "다른 사용자가 먼저 변경했어요. 새로고침 후 다시 시도하세요" 토스트 + 롤백 + refresh. (액션은 이미 `expectedCurrent` 지원 — 로직 변경 아님, 인자만 전달.)
- **드래그 중 유효 드롭 하이라이트** — 현재 카드가 이동 가능한 칸만 강조(예: 이미 완료 카드는 완료 칸 비강조).
- **키보드/접근성** 유지·강화 — 기존 `role=button`·Enter/Space·`aria-live` 유지. 진행중 진입은 키보드 시 % 팝오버 포커스로 연결. 스텝퍼는 버튼 2개로 접근.
- **저장 인디케이터** — 기존 "저장 중…" 유지하되 카드 단위 스피너로 개선.
- 오류는 표시=로깅 원칙([[silent-empty-screens]]) — 조용한 실패 금지, 실패 시 반드시 토스트+롤백.

---

## 8. 발견성 & 온보딩

- **드래그 어포던스** — 카드 호버 시 핸들·그림자·커서로 "끌 수 있음"을 명확히(진행 뷰).
- **첫 방문 코치마크** — 최초 1회 "카드를 끌어 진척을 옮겨보세요"(계정별 `UiPrefs`에 이미 있는 로컬우선 설정 흐름을 쓸 수 있으면 재사용, 아니면 localStorage 1회 플래그 — 신규 서버 스키마 없이). ⚠️ `UiPrefs` 확장이 타 기능(설정 동기화) 변경이 되면 **localStorage 로컬 플래그로 대체**(칸반 자기완결).
- **의미 있는 빈 상태** — 필터로 0건일 때 "필터를 조정하세요"(현재 카피와 구분), 데이터 자체가 없을 때 기존 import 안내.
- **뷰 설명 툴팁** — 진행/단계/담당 각 뷰가 무엇을 하는지 1줄.
- ⚠️ **타 메뉴(대시보드 등)에 진입점 추가는 범위 밖**(그 페이지를 수정해야 하므로). 발견성은 보드 내부 + 사이드바 기존 진입점으로 한정.

---

## 9. 데이터 흐름 & 영속성

```
kanban/page.tsx (server)
  └─ getComputedWbs(projectId)  ── 읽기(변경 없음)
  └─ getMembership()            ── 렌즈용(변경 없음)
  └─ <KanbanBoard items membership today .../>  (client)
         ├─ 순수 계산: leavesOf / leafPaths / bucketOf / groupByProgress
         │             / lens / quickFilters / search / sortCards / dueSignal / resolveDrop
         ├─ 낙관적 오버라이드(local state)
         └─ 쓰기: updateActual(id, pct, expectedCurrent)  ── 기존 액션 재사용
                    └─ wbs_items.actual_pct += change_logs + 스냅샷 + revalidatePath  (기존 로직 그대로)
```

신규 테이블·컬럼·마이그레이션·서버 액션 **없음**.

---

## 10. 컴포넌트 경계 (파일별 변경/신규)

| 파일 | 변경 | 책임 |
|---|---|---|
| `lib/domain/kanban.ts` | 확장 | `groupByProgress`·`leafPaths`·`bucketOf`·`lens`·`quickFilters`·`sortCards`·`dueSignal` 추가. 기존 `groupByPhase/Owner`는 조회 전용으로 유지 |
| `lib/domain/kanban-drop.ts` | **신규** | `resolveDrop(card, target)` 순수 상태기계(§4.2) — 테스트 용이하게 분리 |
| `components/kanban/KanbanBoard.tsx` | 대개조 | 뷰 토글(진행 기본)·렌즈·필터칩·검색·정렬·낙관적 업데이트·드롭 하이라이트·라이브리전·코치마크 오케스트레이션 |
| `components/kanban/KanbanCard.tsx` | 확장 | breadcrumb·D-day/지연 배지·핸들·스텝퍼·클릭 딥링크. props 확대(`pathLabel`, `dueSignal`, `onStep`, `onOpenWbs`) |
| `components/kanban/ProgressPopover.tsx` | **신규** | 진행중 진입 % 팝오버(프리셋 칩 + 입력) |
| `components/kanban/ResetConfirm.tsx` | **신규**(또는 공용 모달 재사용) | 진척>0 → 시작전 확인창 |
| `app/(app)/p/[projectId]/kanban/page.tsx` | 소폭 | prop 전달(today·membership 이미 있음). KPI 히어로 카피 소폭 조정(선택) |
| `lib/i18n/dict/kanban.ts` | 확장 | 신규 키(ko/en 패리티). 재정의된 뷰 라벨·힌트·팝오버·배지·토스트 |

각 유닛은 "무엇을 하나 / 어떻게 쓰나 / 무엇에 의존하나"가 명확해야 한다. 순수 함수는 `kanban.ts`/`kanban-drop.ts`에, JSX 의존 표현 메타는 컴포넌트에 둔다(기존 관례 유지).

---

## 11. 순수 도메인 함수 시그니처(테스트 대상)

```ts
// kanban.ts
export function bucketOf(pct: number | null): 'not_started' | 'in_progress' | 'done'
export function groupByProgress(items: ComputedItem[]): KanbanColumn[]   // 3 컬럼
export function leafPaths(items: ComputedItem[]): Map<string, string[]>  // leafId → 조상 이름[]
export function lensCards(leaves: ComputedItem[], lens: 'myTeam'|'all', myTeam: TeamCode): ComputedItem[]
export function applyQuickFilters(
  leaves: ComputedItem[],
  f: { overdue: boolean; dueThisWeek: boolean; inProgress: boolean; notStarted: boolean },
  today: string,
): ComputedItem[]
export function sortCards(cards: ComputedItem[], today: string): ComputedItem[]
export function dueSignal(plannedEnd: string | null, cur: number, today: string):
  | { kind: 'overdue'; days: number } | { kind: 'due'; days: number } | null

// kanban-drop.ts
export type DropResult =
  | { kind: 'noop' }
  | { kind: 'set'; pct: number }
  | { kind: 'confirm-reset'; pct: 0 }
  | { kind: 'prompt'; suggested: number }
export function resolveDrop(card: ComputedItem, target: 'not_started'|'in_progress'|'done'): DropResult
```

---

## 12. 에러 처리 (원칙 [[silent-empty-screens]])

- **권한** — `canEditActual` 없는 카드는 draggable=false·스텝퍼 숨김(fail-closed). 서버 액션이 재검증(UI는 노출 게이트).
- **되돌림 보호** — 진척>0 → 0% 는 확인창 필수.
- **충돌** — CAS 실패 시 토스트+롤백+refresh(조용한 last-write-win 금지).
- **네트워크/서버 실패** — 오버라이드 revert + 토스트, 콘솔 로깅.
- **빈 상태** — 필터 0건 vs 데이터 0건을 카피로 구분.

---

## 13. 테스트 계획

**단위(순수 함수 — 우선순위 최상):**
- `bucketOf`: 0/음수/1/99/100/null 경계.
- `resolveDrop`: §4.2 표의 7개 분기 전부(특히 진행중 cur=0/100 → prompt, 시작전 cur>0 → confirm-reset).
- `groupByProgress`: 3컬럼 분류·카드 유실 없음.
- `leafPaths`: 다단계 트리에서 조상 경로.
- `lensCards`/`applyQuickFilters`/`sortCards`/`dueSignal`: 경계(오늘=마감일, plannedEnd null, delayed).

**상호작용(수기/스모크 — [[wbs-web-verify-env]] 브라우저 제약이라 build/lint/test + curl 위주):**
- 진행 뷰 드래그 → 완료/시작전/진행중(팝오버) 반영, 취소 시 원위치.
- 낙관적 이동 + 실패 롤백 토스트.
- 렌즈/필터/검색 조합.
- 조회 전용 뷰에서 드래그 불가.

**회귀:** `?view=`·`?team=` 딥링크, 키보드 토글, i18n ko/en 패리티(컴파일), `updateActual` 계약 불변.

---

## 14. 롤백 & 배포

- 데이터 마이그레이션 없음 → **코드 revert = 완전 롤백**([[minutes-tree-view-feature]] "코드 먼저" 관례).
- 라우트·URL 파라미터 하위호환 유지.
- 점진 배포: 순수 함수 + `kanban-drop.ts` → 카드 → 보드 오케스트레이션 → 온보딩 순.

---

## 15. 열린 결정 / Phase 2 이후

- **개인(1인) 담당** — WBS는 팀 단위. 진짜 "내 일"은 데이터 모델 확장 없이는 불가(범위 밖으로 확정).
- **2축 스윔레인**(진척 × 단계/팀) — 사용자 결정으로 Phase 2 보류.
- **카드 순서 저장** — 지금은 noop(정렬 규칙만). 순서 영속화는 칸반 전용 저장소가 필요 → 범위 밖.
- **실시간 프레즌스/동기화** — 범위 밖(주간보고 `usePresence` 참고 가능하나 Phase 2+).
- **조회 전용 단계/담당 뷰 제거 여부** — 활용률 관찰 후.
- **대시보드 진입점("내 지연 N건" 위젯)** — 대시보드 수정이 필요해 범위 밖(제약 해제 시 재검토).
