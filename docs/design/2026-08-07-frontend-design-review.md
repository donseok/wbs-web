# D'Flow 프론트엔드 디자인 진단 보고서

**작성일** 2026-08-07 · **대상** `wbs-web` (D'Flow) 전 화면 · **성격** 읽기 전용 진단. 코드 변경 없음.
**목업** https://claude.ai/code/artifact/b2ae6832-907f-4d35-b58e-580000d47106 (Before/After 11건)

---

## 실행 상태

| | |
|---|---|
| 진단 | **완료** — 50건(감사 41 + 비평 10, 1건 폐기) |
| 구현 | **미착수** — 이 보고서는 저장만 되어 있고 코드는 한 줄도 바뀌지 않았다 |
| 착수 지점 | **Wave 0(§8)** — GAP-01 인쇄 백지. 단독 브랜치 |
| 미결 | 별건 결정 5건(§8 "별건 결정 필요") — 착수 전 사용자 확답 필요 |

### 다음 세션 시작 절차

```bash
cd /Users/jerry/wbs-web
git switch main && git pull            # 병렬 세션이 앞서 있을 수 있다
git log --oneline -5                   # 42b1a51 이후 WBS 영역이 또 바뀌었는지 확인
```

그다음 아래 표에서 착수할 Wave 를 고른다. **Wave 는 순서대로 하지 않아도 된다** —
서로 독립이며, 게이트 등급만 다르다.

| Wave | 내용 | 건수 | 게이트 | 브랜치 |
|---|---|---|---|---|
| **0** | 인쇄 백지 + unlayered 스냅샷 테스트 | 1 | ⚠ `globals.css` — **인쇄는 로그인 없이 Preview 검증 가능** | `ui/print-fix` |
| **1** | 토큰 값 (신호 대비·색 충돌) | 3 | ⚠ `globals.css` — Preview 로 로그인 화면 확인 | `ui/token-contrast` |
| **2** | WBS 시트 (P1 5건 집중) | 5 | 없음 | main 직행 |
| **3** | 표·피드백·일관성 | 9 | 없음 | main 직행 |
| **4** | 앱 셸 (사이드바·헤더) | 5 | ⚠ **Preview 검증 불가** — 배포 후 실화면 + `mark:good` | `ui/shell-nav` |
| **5** | 팀 색 마스터화 | 1 | 마이그레이션 동반 — 코드와 **별도 커밋** + `_rollback.sql` | — |

### 착수 전 반드시 확인할 함정 3개

1. **VIS-07 의 인용 좌표가 60여 줄 밀려 있다.** `src/lib/domain/issues.ts` 실제 위치는
   `:85`(open) · `:88`(on_hold dot) · `:95`(high) · `:96`(medium) · `:101-104`(isOverdue).
   그대로 구현하면 엉뚱한 줄을 고친다.
2. **IX-04 의 접기 비대칭은 커밋 `42b1a51` 이 만든 것이다.** 고치기 전에 그 커밋의 의도와
   `tests/ui/wbs-focus-jump.test.tsx:119-133` 을 먼저 읽을 것.
3. **권고안 17건이 UI 위험 파일을 건드리는데 감사자는 그 위험을 거의 고지하지 않았다.**
   §2 실행 게이트를 읽지 않고 착수하지 말 것.

### 이번 라운드에서 제외하기로 한 것

- **VIS-09** 전 화면 리스킨 — Preview 로 검증할 수 없는 가장 큰 변경
- **IA-11** `(app)/layout.tsx` 프로바이더 트리 재배치 — 같은 이유
- **IA-09** 이슈↔WBS 통합 — 마이그레이션 동반, 별도 기획 필요

되살리려면 사용자 확답을 먼저 받는다.

---

## 0. 한 장 요약

**디자인 시스템의 뼈대는 이미 좋다. 문제는 값과 계약이다.**

토큰 채택률 97%(173개 tsx 중 원시 팔레트 사용 5개), 공유 프리미티브 15종, 신호에 아이콘·텍스트를
타입 레벨로 강제, 전역 `prefers-reduced-motion` 차단 — 구조는 25년차 셋이 모두 "건드리지 말라"고
평가했다. 그런데 그 위에 얹힌 값들이 검증을 통과한 적이 없다.

네 줄로 줄이면:

0. **[P0] 이 앱은 어떤 화면을 인쇄해도 백지가 나온다.** `globals.css` 의 `@media print` 가
   `body * { visibility: hidden }` 을 걸고, 되살리는 `.print-area` 를 가진 컴포넌트는
   **리포트 모달 하나뿐**이다. 임원 보고 자료를 뽑는 것이 핵심 업무인 제품에서.
1. **이 제품이 "신호"라고 부르는 것이 시스템에서 가장 안 읽힌다.** 상태 칩 4종이 자기 배경 위에서
   3.09~3.98:1 이고, 그 칩의 글자 크기가 10~11px 다. 대시보드 판정 배지·WBS 상태·이슈 심각도가 전부
   여기에 걸린다. `globals.css` 토큰 **네 줄**이면 전 화면이 AA 를 넘는다.
2. **가장 많이 쓰는 화면(WBS 시트)의 반복 입력이 리듬을 잃었다.** Enter 를 치면 포커스가 `document.body`
   로 사라져 다음 행으로 이어갈 수 없다. 같은 리포의 주간시트는 이 문제를 이미 풀어 놨다 —
   해법이 옆 파일에 있다.
3. **"받고 버리는" 중간 상태가 네 군데 있다.** `PageHero` 는 prop 6개를 받아 전부 버리고(10개 페이지가
   서버에서 KPI 를 계산해 폐기), 다크 모드는 토큰 60개를 유지하면서 출구(토글)만 숨겼고,
   `Spinner` 프리미티브는 import 0건, `lib/report/brand.ts`(화면 브랜드색을 엑셀로 잇겠다고 만든 파일)도
   import 0건이다. 넷 다 "쓰거나 지우거나" 결정이 필요하다.

**판정: 리스킨이 아니라 정합성 복구가 우선이다.** 팔레트를 새로 짜는 것은 지금 할 일이 아니다.
아래 P0 1건 + P1 6건 + 토큰 4줄이 전체 체감의 대부분을 가져간다.

### 이 진단의 가장 중요한 발견 — unlayered 블록을 아무도 세지 않았다

CLAUDE.md 는 `globals.css` 끝의 unlayered 반응형 display 안전망을 경고한다. 그런데
**같은 성질을 갖는 unlayered 블록이 최소 셋 더 있고, 그 셋이 각각 사고를 내고 있다.**

| # | unlayered 블록 | 지배 대상 | 증상 | 발견 |
|---|---|---|---|---|
| 1 | 반응형 display 유틸 (`:550-599`) | display | 상태 변형 display 유틸이 죽는다 | *(기존 문서화)* |
| 2 | `:focus-visible` (`:223-226`) | outline 롱핸드 | 포커스 유틸이 전부 무효 | **IX-06** |
| 3 | `@media print` (`:458-470`) | visibility | **전 화면 인쇄가 백지** | **GAP-01** |
| 4 | reduced-motion (`:445-453`) | animation/transition | *(의도된 것 — 유익)* | 강점 |

`@layer components` 는 **421행에서 닫힌다**(실측). 그 뒤 178줄이 전부 unlayered 다.
`tests/css/breakpoint-safety-net.test.ts` 는 display 만 본다.

> **권고: `globals.css` 의 unlayered 블록 전량을 열거하는 스냅샷 테스트를 만들 것.**
> 이건 개별 버그 수정이 아니라 같은 계열의 4번째 사고를 미리 막는 일이다.

---

## 1. 진단 방법

경력 25년 기준의 프론트엔드 디자이너 3인을 역할 분담해 병렬 투입했다.

| | 담당 | 발견 |
|---|---|---|
| **D1** | 포털 구조 · 정보설계(IA) — 네비게이션 모델, 스코프 전환, 발견성 | 14건 |
| **D2** | 편의성 · 인터랙션 — 업무 효율, 폼·표·피드백, 상태 설계 | 13건 |
| **D3** | 비주얼 시스템 · 사용자 심리 — 토큰·타이포·밀도, 인지부하 | 14건 |
| **비평** | 완결성 — 셋 다 열지 않은 화면 + 화면을 가로지르는 일관성 | 10건 |

디자인 리뷰는 존재하지 않는 문제를 지어내기 쉬우므로, 발견 41건 전부를 **적대적 검증관**에게
넘겨 인용된 `file:line` 을 직접 열어 반증하게 했다.

| 판정 | 건수 | 의미 |
|---|---|---|
| CONFIRMED | 17 | 근거·영향 모두 실측 확인 |
| PARTIAL | 23 | 사실은 맞으나 범위·심각도·인용 좌표에 보정 필요 |
| REFUTED | 1 | 폐기 (IA-08 회의→회의록 링크 단방향 — 실제로는 양방향) |

검증 후 최종 심각도: **P1 6건 · P2 23건 · P3 11건**.

**비평가 발견 10건(GAP-*)은 검증관을 거치지 않았다.** 대신 이 보고서를 쓰면서 핵심 주장 4건을
직접 실측했다 — GAP-01·04·06·08 전부 사실이었고, GAP-06 은 오히려 **과소평가**였다
(비평가는 17곳이라 했으나 실측 31곳). 나머지 6건은 미검증 상태로 표시했다.

### 검증이 잡아낸 것 — 인용 좌표 오류

권고안을 그대로 구현하면 엉뚱한 줄을 고치는 사례가 둘 있었다. 실행 전에 반드시 확인할 것.

- **VIS-07** — `src/lib/domain/issues.ts` 인용이 60여 줄 밀려 있다. 실제 위치는
  `open`=**:85**, `on_hold` dot=**:88**, `high`=**:95**, `medium`=**:96**, `isOverdue`=**:101-104**.
- **VIS-01** — 심각도 칩은 `issues.ts:36-38` 이 아니라 `:95-96` 이다.

---

## 2. ⚠ 실행 게이트 — 이 보고서를 그대로 실행하면 안 되는 이유

검증관 셋이 공통으로 잡아낸 **메타 발견**이다. 개별 발견보다 이것이 먼저다.

권고안 41건 중 **17건이 `src/app/globals.css` 또는 `src/components/app/*` 를 건드린다.**
CLAUDE.md 가 이름까지 박아 둔 **UI 위험 파일**이고, 이 파일들은
**빌드·린트·타입체크·테스트로 깨짐이 잡히지 않는다** (2026-07-27 사고 때 vitest 2438건이 전부 통과했다).

그런데 감사자들이 위험을 스스로 고지한 것은 **41건 중 2건**(IA-14, VIS-14)뿐이었다.
나머지는 "토큰 세 줄만 고치면 됨", "배선만 하면 됨" 같은 표현으로 **위험을 정반대로 축소**했다.

추가로 Preview 의 한계가 겹친다 — 이 프로젝트의 Vercel env 는 전부 Production 대상이라
**Preview 배포는 로그인 뒤 화면을 보여주지 못한다.**

| 대상 | Preview 검증 | 실행 규칙 |
|---|---|---|
| `globals.css` 토큰 | **가능** (로그인 페이지가 CSS 전량 로드) | 브랜치 → Preview 확인 → ff 머지 |
| `components/app/*` (Sidebar·HeaderChrome) | **불가능** | 브랜치 필수 + 배포 후 실화면 확인 + `mark:good` |
| `(app)/layout.tsx` 프로바이더 순서 | **불가능** | 단독 커밋. 되돌릴 좌표를 먼저 확보 |
| 그 외 (`components/wbs`, `weekly`, `issues`, `ui`) | 해당 없음 | main 직행 가능 |

**특히 위험한 두 건**

- **IA-11** 이 `(app)/layout.tsx:72-78` 의 프로바이더 트리 재배치를 요구하면서 "배선만 하면 된다"고
  적었다. 앱 전 화면을 감싸는 트리이고 로그인 뒤에만 보이므로 **눈으로 검증할 방법이 없다.**
- **VIS-09** 의 전 화면 리스킨(`canvas`/`surface`/`surface-2`/`line`/`zebra`/`sheet-head` 6개 동시 변경)은
  "눈으로 봐야 하는데 볼 방법이 없는" 변경이다. **이번 라운드에서 제외할 것을 권고한다.**

### 용어 정정

한 감사자가 `hidden xl:flex` 를 "상태 변형 display 유틸"이라고 잘못 불렀다. 안전망이 금지하는 것은
`group-hover:flex` · `data-[state=open]:hidden` · `print:hidden` 같은 **상태 변형** display 와
컨테이너쿼리 display 혼용이다. `hidden xl:flex` 같은 **반응형** display 는 안전망이 지배하는 대상
그 자체이므로 정상 동작한다. 이 오해가 퍼지면 멀쩡한 반응형 처방까지 막힌다.

---

## 3. P0 — 지금 (1건)

### GAP-01 · 이 앱은 어떤 화면을 인쇄해도 백지가 나온다
**공수 S · 보고서 작성 중 직접 실측 확인 · ⚠ globals.css**

```css
/* globals.css:458-470 — @layer components 는 421행에서 닫힌다. 이 블록은 unlayered 다. */
@media print {
  body { background: #fff; }
  body * { visibility: hidden; }          /* ← 전부 숨긴다 */
  .print-area, .print-area * { visibility: visible; }
  .no-print { display: none !important; }
}
```

**`.print-area` 를 가진 컴포넌트는 리포 전체에서 하나다** — `ReportModal.tsx:191`.
`no-print` 도 같은 파일 하나뿐이다(실측 grep).

즉 대시보드·WBS 시트·간트·주간업무 시트·이슈 목록·근태 달력·회의록 뷰어를 Ctrl+P 하면
**빈 종이가 나온다.** unlayered 라 어떤 named layer 도 이기지 못한다.

**왜 P0 인가** — 임원 보고 자료를 뽑는 것이 PMO 의 일상 업무인 제품이다. 결과가 빈 종이면
사용자는 제품 버그로 인식하지 않고 자기 프린터·브라우저를 의심하며 5~10분을 태운 뒤
화면을 캡처해 PPT 에 붙인다. PPT/엑셀 내보내기가 없는 화면(이슈 목록·근태 달력·회의록 본문)에는
인쇄가 **유일한 종이 경로**다.

**권고** 화이트리스트를 블랙리스트로 뒤집는다.

```css
@media print {
  body { background: #fff; }
  [data-print-hide] { display: none; }     /* 사이드바·헤더·챗봇 런처·토스트 */
  .card { box-shadow: none; border-color: #ddd; }
}
```

`body * { visibility: hidden }` 를 삭제하고, 감출 크롬에만 `data-print-hide` 를 단다.
**`print:hidden` 유틸을 쓰면 안 된다** — 상태 변형 display 유틸이라 안전망에 진다(CLAUDE.md).
`ReportModal` 의 기존 동작을 깨지 않도록 `.print-area` 규칙은 남겨 둔다.

⚠ `globals.css` 이므로 브랜치 필요. 다만 **인쇄는 로그인 없이도 검증 가능한 몇 안 되는 변경**이라
Preview 에서 로그인 페이지를 Ctrl+P 해 보는 것으로 최소 회귀는 잡을 수 있다.

---

## 4. P1 — 즉시 (6건)

### VIS-01 · 상태 칩 4종이 전부 WCAG AA 미달 — 신호가 가장 안 읽힌다
**공수 S · 검증 CONFIRMED · ⚠ globals.css**

`-weak` 배경과 전경 토큰이 짝으로 정의돼 있는데 그 짝의 대비가 검증된 적이 없다.

| 조합 | 실측 대비 | 판정 |
|---|---|---|
| `done` #138a67 on `done-weak` #e3f3ec | 3.77:1 | ✗ |
| `delayed` #cb4b5f on `delayed-weak` #f8e6e9 | 3.71:1 | ✗ |
| `pending` #7a6f68 on `pending-weak` #efe7db | 3.98:1 | ✗ |
| `accent-warning` #c06f24 on `pending-weak` | **3.09:1** | ✗ ← 하필 '주의' 신호 |
| `progress` #2d6fb0 on `progress-weak` #e6eff7 | 4.50:1 | ✓ (유일) |

적용 글자 크기는 `.badge`/`.chip` 모두 **11px**(`globals.css:368-373`), 게이지 중앙 판정 배지는
**10px**(`ProgressGauge.tsx:42`). large-text 예외(3:1)에도 해당하지 않는다.
다크 모드 쪽 같은 쌍은 5.45~6.62:1 로 멀쩡하다(`globals.css:158-161`) — **라이트만 검증을 건너뛴 것이다.**

**권고** `@theme` 의 전경 토큰만 어둡게 내린다. `-weak` 배경은 그대로 둔다(건드리면 칩 톤 전체가 바뀐다).

```
--color-done:           #138a67 → #0d6b52   /* weak 위 5.64:1, 흰 글씨 위 6.48:1 */
--color-delayed:        #cb4b5f → #ab3346   /* 5.31:1 */
--color-accent-warning: #c06f24 → #9a5616   /* 4.61:1 */
--color-pending:        #7a6f68 → #6b615a   /* 4.92:1 */
```

네 줄이면 `signalStyle.ts` · `wbs/shared.tsx` · `issues.ts` · `announcements.ts` 를 한 줄도 안 고치고
전 화면이 AA 를 넘는다. **VIS-06(흰 글씨 4종 미달)도 같이 해소된다.**

> **심리** 대비가 낮은 경고는 경고로 안 읽히고 장식으로 읽힌다. 몇 번 못 읽으면 사용자는 그 요소를
> 시각적으로 스킵하도록 학습하고(banner blindness), 한 번 붙은 습관은 나중에 색을 고쳐도 돌아오지 않는다.

---

### IX-01 · WBS 삭제가 하위 트리 전체를 cascade 로 지우는데 건수도 백업도 undo 도 없다
**공수 M · 검증 CONFIRMED**

- 삭제 버튼이 ▲▼ 이동 버튼과 **같은 줄·같은 크기**로 붙어 있다 (`RowDetailPanel.tsx:437-439`,
  셋 다 `btn btn-ghost h-8 px-2.5 text-xs`, 삭제만 `text-delayed`)
- 확인 문구는 정적 한 줄 — "하위 항목·이력까지 삭제됩니다. 계속할까요?" (`dict/wbs.ts:158`). **건수가 없다.**
- `actions/wbs.ts:571` 은 단일 행 delete 이고, `0001_init.sql:27` 의
  `parent_id … on delete cascade` 가 그 아래 전 depth 를 DB 에서 함께 지운다.
- **같은 제품이 다르게 하고 있다** — 임포트 replace 모드는 `role="alert"` 박스에 실제 삭제 건수,
  `change_logs`·`holidays` 영향, 백업 다운로드까지 보여준다 (`ImportWizard.tsx:481-497`).

즉 사용자는 "이 앱은 지우기 전에 세어서 알려준다"고 이미 학습한 상태고, 그 학습이 여기서 배신당한다.

**권고**
1. 삭제 버튼을 구조 편집 줄에서 분리해 별도 줄로 내린다.
2. `item.children` 은 이미 props 로 있으므로(`:114` 에서 사용 중) 추가 조회 없이 재귀 카운트가 가능하다 —
   `src/lib/domain/wbsAffordance.ts`(실존)에 `descendantCount(item)` 를 추가하고,
   dict 에 `wbs.deleteConfirmCount` = "하위 **{n}개** 항목과 그 변경 이력까지 함께 삭제됩니다. 되돌릴 수 없습니다."
3. `n > 0` 이면 확인 버튼을 즉시 활성화하지 않는다(항목명 입력 또는 2초 지연).

> **심리** 확인 대화가 항상 같은 문장이면 3번째부터 읽지 않는다(습관화). 문장 안에 **매번 달라지는
> 숫자**가 있으면 시선이 멈춘다. 지금 문구는 습관화를 유도하는 쪽으로 쓰여 있다.

---

### IX-02 · WBS 실적 입력은 Enter 를 누르는 순간 포커스가 사라진다
**공수 M · 검증 CONFIRMED**

`commit()` 의 `finally { setBusy(false); setEdit(null); setDraft('') }` (`WbsGanttSheet.tsx:584-631`)
가 input 을 언마운트하는데 포커스를 되돌리는 코드가 없다. `activeElement` 는 `document.body` 가 된다.
다음 행을 입력하려면 Tab 으로 문서 맨 앞(스킵 링크 → 사이드바 → 헤더 → 툴바)부터 다시 걸어야 하므로
사실상 마우스밖에 방법이 없다.

**대조군이 같은 리포에 있다** — `useSheetGrid.ts:386-397` 에서 주간시트는
Enter → `moveActive(±1행)`, Tab → `advanceActive(다음 셀)` 로 이미 풀어 놨다.

*검증 보정:* `editInput` 에 `onBlur={commit}` 이 있어(`:651`) **Tab 경로는 커밋이 되고 기본 포커스 이동도
일부 살아 있다.** 문제는 가장 흔한 **Enter 경로**다.

**권고** 편집 가능 셀 DOM 맵(주간시트 `register` 패턴)을 두고 commit/cancel 후 `requestAnimationFrame` 으로
(a) Enter → 같은 열의 다음 편집 가능 행, (b) Escape → 원래 셀로 복귀.
`data-row-id` · `data-wbs-col` 이 이미 마크업에 있어(`:1030`, `:1205`) refresh 후에도 셀렉터로 다시 찾을 수 있다.
**최소 구현("커밋 후 원래 셀로 복귀"만)은 S 규모**이고 그것만으로도 Tab 흐름이 살아난다.

> 60행 입력 시 키보드↔마우스 왕복 60회. 더 큰 비용은 "입력이 귀찮다 → 몰아서 대충 넣는다"로 이어지는
> 데이터 품질 저하다.

---

### IX-03 · 실적 저장에 낙관 반영이 없다 — '저장됨' 토스트가 옛 숫자 위에 뜬다
**공수 M · 검증 CONFIRMED**

`if (res.ok) { setToast(저장됨); router.refresh() }` (`WbsGanttSheet.tsx:616-618`).
토스트는 즉시, 셀 값은 RSC 재요청이 끝난 뒤에 바뀐다. 그 사이를 메우는 로컬 반영이 없다.

왕복 비용도 크다. `updateActual` 한 번에 서버 왕복 6~7회(`actions/wbs.ts:72-117`),
`router.refresh()` 가 부르는 `getComputedWbs` 는 5개 쿼리를 다시 돈다.

**검증 중 오히려 강화된 사실** — `lib/data/wbs.ts:22` 의
`sb.from('item_owners').select('wbs_item_id, kind, teams(code)')` 에 필터가 정말 없고,
`0001_init.sql:43-48` 을 보면 `item_owners` 에는 **`project_id` 컬럼 자체가 없다.**
셀 하나 저장할 때마다 전 프로젝트의 담당 행을 통째로 다시 읽는다.
(Supabase 컴퓨트는 Micro — 공유 2 vCPU 다.)

**권고**
- 로컬 오버레이 맵(`Map<itemId, number>`)으로 셀 표시값을 즉시 바꾸고, `items` props 참조가 바뀌면 비운다.
  주간시트 `dirtyRef` + `applyServerRow`(`lib/domain/weeklySheet.ts`)와 동형.
- 롤업 부모는 서버 계산이라 즉시 못 맞추므로, 오버레이가 사는 동안 해당 행에만 '반영 중' 마이크로 상태.
- 별건(S): `item_owners` 조회를 `wbs_item_id in (...)` 로 좁힌다.

> **실패 시나리오** 숫자가 안 바뀌어 다시 입력 → 낙관적 잠금(`expectedCurrent`)에 걸려
> "다른 사용자가 먼저 수정했습니다" → 사용자는 유령 동시편집을 의심하고 PMO 에 문의한다.

---

### IX-04 · '전체 접기' 후 개별 Phase 를 다시 펼칠 수 없다
**공수 S · 검증 CONFIRMED**

접힘을 **만드는** 집합과 **푸는** 집합이 다르다.

| | 정의 | 위치 |
|---|---|---|
| 접는 집합 | `phaseIds = items.map(i => i.id)` — 루트 전체 | `:483-493` |
| 풀 수 있는 집합 | `collapsibleIds = splitParentIds(items)` — `isOwnerSplit` 자식이 있는 노드만 | `:361`, `:69-79` |

`canToggle` 이 false 인 행은 체브론 대신 **빈 여백**만 그린다(`:1067-1079`). 작업명을 눌러도 펼쳐지지 않고
우측 상세 패널이 열린다(`:1080-1097`). 우회로 없음 — `forcedOpen` 은 `focusId` 진입 전용이고
`toggleAll` 이 그것마저 비운다.

이 접힘은 계정에 저장된다(`queueWbsCollapse`, `:184`) — 실수로 누르고 나간 사용자는 **다음 로그인에도**
같은 막다른 화면을 만난다.

**⚠ 이 비대칭은 오늘자 커밋 `42b1a51`("WBS 전체 접기와 펼치기 범위를 바로잡다")이 만든 것이다.**
검증관이 diff 로 확인했다. 수정 전에 그 커밋의 의도와 `tests/ui/wbs-focus-jump.test.tsx:119-133` 을 먼저 볼 것.

**권고** `collapsibleIds` 를 '자식이 하나라도 있는 노드'로 넓혀 `phaseIds ⊆ collapsibleIds` 를 성립시킨다.
기본 접힘 대상(`:176` 의 `splitParentIds`)은 그대로 두면 첫 화면 구성은 변하지 않는다 — **두 집합의 역할을 분리하는 것이 핵심.**

---

### IX-07 · WBS 상세 패널이 `aria-modal` 을 선언해 놓고 포커스를 다루지 않는다
**공수 M · 검증 CONFIRMED**

`<div role="dialog" aria-modal="true">` (`RowDetailPanel.tsx:212`) 인데, 이 컴포넌트의 유일한 키보드 이펙트는
`if (e.key === 'Escape') onClose()` 뿐이다(`:93-97`). 초기 포커스·Tab 트랩·복원·body 스크롤 잠금이 전부 없다.

**대조군이 같은 리포에 있다** — 공용 `Modal.tsx:42-80` 은 초기 포커스(`:58`), Tab 순환(`:66-71`),
샌 포커스 회수(`:64`), 트리거 복원(`:79`)을 모두 한다.

`aria-modal="true"` 는 보조기술에 "이 밖은 없는 셈 쳐라"라고 지시하는데 포커스는 밖에 남아 있으므로,
스크린리더 사용자는 **아무것도 읽히지 않는 무음 상태**에 빠진다. DOM 순서상 패널은
`WbsGanttSheet.tsx:1411`(전 행 렌더 뒤)이라, 행 버튼에서 Tab 을 누르면 남은 전 행을 지나야 패널에 닿는다.

**권고** `Modal.tsx:42-80` 의 트랩 로직을 `useFocusTrap(ref, open)` 훅으로 `components/ui/` 에 추출해 공유한다
(우측 슬라이드 패널이라 Modal 자체로 교체하지는 않는다). 최소 3가지 — 초기 포커스 / Tab 순환 / 닫을 때 복원.
`minutes/ArchiveChatPanel.tsx:38` 계열에도 같이 적용.

> 열었다 닫으면 원래 자리로 돌아온다는 건 학습이 필요 없는 기본 기대다. 깨지면 사용자는 **상세 패널을
> 여는 것 자체를 주저**하고, 결국 담당·산출물·이력이 안 읽힌다. 정보가 없어서가 아니라 여는 비용 때문에.

---

## 5. P2 — 이번 분기 (23건, 주요 발췌)

### 5.1 색이 정보로 기능하지 못하는 문제

**VIS-03 · 토큰 값이 hex 단위로 겹친 쌍이 셋** (S · ⚠globals.css)

| 토큰 A | 토큰 B | 값 | 문제 |
|---|---|---|---|
| `--color-brand` (:52) | `--color-team-mdm` (:102) | `#0f766e` | MDM 팀 마크 = 브랜드색 |
| `--color-pending` (:70) | `--color-ink-subtle` (:49) | `#7a6f68` | '시작 전' = 흐린 보조 텍스트 |
| `--color-delayed` (:68) | `--color-today` (:106) | `#cb4b5f` | **간트 한 캔버스에서 동시 렌더** |

간트에서 PMO 가 하는 일은 '오늘 선 왼쪽에 빨간 바가 몇 개인가'다. 오늘 선 자체가 같은 빨강이면
정확히 그 판독을 방해한다.

권고: `--color-today` → `#123d64`(오늘선은 '위험'이 아니라 '기준선'), `--color-team-mdm` → `#b03060`
(PMO 인디고·DT 블루·ERP 바이올렛·MES 앰버와 색상환에서 겹치지 않는 자리), `--color-pending` 은 VIS-01 값으로.
*검증 보정:* 칸반 근거 1건(`KanbanBoard.tsx:351` 폴백)은 죽은 코드였다 — 나머지는 전부 사실.

**VIS-07 · 이슈 `open` 이 지연과 같은 빨강** (S)

빨강이 다섯 가지를 뜻한다: WBS 지연 / 이슈 미해결(**정상 상태**) / 이슈 심각도 높음 / 공지 중요 / 알림 danger.
등록하는 순간 모든 이슈가 위험으로 보이고, `open` + `high` 이면 빨강 칩이 나란히 두 개 뜬다.
진짜 지연을 판정하는 `isOverdue()` 가 이미 있는데(`issues.ts:101-104`) 대응하는 색이 없다.

권고: `open` 을 중립으로 내리고(`bg-surface-2 text-ink-muted`), 빨강은 `isOverdue()` 가 true 일 때만.
**⚠ 인용 좌표 60줄 밀림 — §1 참조.**

**VIS-11 · 사이드바 상태 점 5색이 원시 팔레트이고 앱 어휘와 어긋난다** (S · ⚠components/app)

`Sidebar.tsx:31-39` 의 `bg-amber-400` / `bg-emerald-400` / `bg-rose-400` / `bg-sky-400` / `bg-slate-400`.
같은 단어가 다른 색이다 — **'진행중'이 사이드바에선 초록, 본문에선 파랑. '완료'는 하늘색 vs 초록.**
사이드바는 하루 종일 떠 있는 유일한 상시 요소라 학습 강도가 가장 세다.

권고: 겹치는 단어는 앱 표준색을 따른다(`active→bg-progress`, `done→bg-done`, `overdue→bg-delayed`),
생애주기 고유 개념(준비/확인 불가)만 중립색. 원시 팔레트 5건이 사라지고 다크 대응이 따라온다.

**VIS-06 · 채움색 위 흰 글씨 4종 AA 미달** (S · ⚠globals.css) — 안읽음 배지 `accent-secondary` 위 흰 글씨
3.63:1 에 글자 9~10px(`Sidebar.tsx:260`, `HeaderChrome.tsx:153,362`). '숫자를 읽어야 하는' 요소다.
`--color-accent-secondary: #cb6d37 → #ad5420`(5.16:1). `--gradient-secondary`·`.app-backdrop` 동반 조정 필요.

**VIS-04 · 주간시트 '저장 중' 표시가 2.64:1** (S) — `SheetCell.tsx:134,139` 의 `#9aa0a6` on `#ffffff`,
글자 10px. 세 상태 중 '저장 중'만 안 보인다(저장됨 5.02, 실패 4.77 은 통과).
프레즌스 8색 위 흰 이름도 최저 1.93:1. → `#5f6368`(6.4:1) + PRESENCE_COLORS 재선정.
*검증 보정:* "8색 중 6색 미달"은 과장 — 실측은 일부.

### 5.2 정보 위계와 화면 구조

**VIS-08 · 대시보드 9개 카드가 전부 같은 위계** (M · ⚠globals.css)

`DashboardView.tsx:119-162` 의 세로 스택 9개 중 8개가 같은 `SectionCard`, 제목도 전부 `h3 text-sm`.
`ExecSummary` 만 `h2 text-base`. 테두리·그림자·라운드·아이콘 색이 동일해 **'동등한 9개 블록의 목록'** 으로 읽힌다.
브랜드 teal 이 장식 아이콘 칩으로 8번 소비되어, 정작 데이터로 쓰이는 teal(추세선 stroke, 게이지 채움)이 묻힌다.

권고: 3단 위계 — `.card-lead`(상단 3px 브랜드 보더 + `shadow-md`)를 판정/리스크에만,
`SectionCard` 에 `tone?: 'lead'|'default'|'quiet'` 추가해 quiet 는 아이콘 칩을 중립화(teal 8회 → 2~3회),
`space-y-5` 균일 간격을 4그룹(판정/진척/실행/협업)으로 나눈다.
*카드를 줄이는 안(9→6)은 각 카드가 사용자 요청으로 배치된 것이라 재협상 비용이 크다 — 위계 부여가 현실적.*

**VIS-05 / IA-04 · PageHero 가 prop 6개를 받아 전부 버린다** (M)

`PageHero.tsx:3-7` 주석: "호출부 호환을 위해 받되 렌더하지 않는다".
`eyebrow`·`description`·`badge`·`actions`·`aside`·`heroKpis` 를 받고 `title` 만 그린다.
`HeroBadge` 는 12개 페이지가 import 하지만 **절대 렌더되지 않는다.**

`heroKpis` 를 넘기는 페이지는 grep 실측 **정확히 10곳** — `admin/accounts:61`, `admin/teams:26`,
`minutes:54`, `meetings:42`, `p/attendance:33`, `p/settings:128`, `p/announcements:37`, `p/kanban:39`,
`p/meetings:49`, `p/members:38`. `settings` 는 `collectLeaves(wbs.items).length` 로 **WBS 트리 전체를 순회**해서 버린다.

남은 것은 헤더 브레드크럼과 중복되는 제목 한 줄 + 클리핑된 글로우 얼룩 + 세로 58px.
1080px 노트북에서 헤더 48 + 히어로 58 = 본문 세로의 6%.

권고: **(A) 되살리거나 (B) 지우거나 — 지금처럼 받고 버리는 중간 상태가 최악이다.**
사용자 결정이 '접힘 고정'이었다면 (B)가 정답이다. 그 경우 죽은 prop 6개 + 폐기되는 KPI 계산을 함께 정리.
⚠ (A)를 고르면 `HeaderChrome.tsx` 브레드크럼 중복 해소가 따라오므로 UI 위험 파일로 격상된다.

**IX-05 · 주간시트가 기본 설정에서 항상 가로 스크롤** (S)

`min-w-[1240px]`(`WeeklySheetView.tsx:525-526`) vs 1440 모니터 가용폭 `1440−248−56−15 ≈ 1121px`.
'차주계획 이슈' 열이 화면 밖이라 금주/차주 대조가 안 되고, 프레즌스(누가 어느 칸을 쓰는지)도 무의미해진다.
*검증 보정:* "1544px 미만 항상"은 과장 — **사이드바를 접으면 ≈1291px 로 들어맞는다.** 정확히는
"사이드바 펼친 기본값에서".

권고: 회의록 진입과 같은 자동 접힘 패턴을 weekly 에도. **⚠ 이 권고는 `Sidebar.tsx` 를 건드린다** —
차선책(`min-w` 1240→1080 + colgroup 재배분)은 위험 파일 밖이다.
**금지: 상태 변형 display 유틸로 열 숨기기 — 안전망에 져서 조용히 죽는다.**

**IX-08 · 이슈 표만 가로 스크롤 안전장치가 없다** (S)

`IssuesView.tsx:186-188` — 감싼 div 에 `overflow-x-auto` 도 `min-w` 도 없고 바깥은 오히려 `overflow-hidden`.
`table-fixed` + 퍼센트 8열이라 좁아지면 스크롤 대신 **줄어들고**, `overflow-hidden whitespace-nowrap` 셀이
잘린 내용을 표시 없이 버린다. 1280px 노트북에서 담당자 열 163px, 375px 에서 26px.
**같은 앱의 회의·근태 표는 `min-w-[640px]` 하한을 갖는다.**

권고: `<div className="overflow-x-auto">` + `min-w-[900px]`. colgroup 퍼센트도 재검토(담당자 17%=153px 는 두 명이 안 들어간다).

### 5.3 피드백과 대기

**IX-10 · 에러 토스트가 3.5초 만에 사라지고, WBS 만 별도 토스트를 따로 갖고 있다** (S)

`Toast.tsx:31` 의 `AUTO_DISMISS_MS = 3500` 이 success/error/info 에 **동일 적용**된다.
WBS 는 `useToast` 를 안 쓰고 자체 state + **2600ms** 타이머 + `z-50`(공용은 `z-200`).
우하단 한 구역에 서로 모르는 세 레이어(공용 토스트 / WBS 토스트 / DkBot FAB)가 겹친다.

"일부 셀을 저장하지 못했습니다. 재시도를 눌러 주세요"(`WeeklySheetView.tsx:368`)는 **행동을 요구하는데
3.5초 뒤 사라진다.** WBS 의 "다른 사용자가 먼저 수정했습니다"는 2.6초다.

권고: `variant === 'error'` 면 자동 소멸 끄기(hover 일시정지 로직이 이미 있어 분기 한 줄).
WBS 자체 토스트를 `useToast()` 로 통합. 공용 토스트에 DkBot FAB 회피 여백.

**IX-11 · PPT 내보내기 진행 표시가 버튼 반투명뿐** (S)

`flushPendingSaves` 가 dirty 셀이 빌 때까지 100ms 간격 **최대 5초** 폴링하는데 표시가 없고
(`WeeklySheetView.tsx:215-234`), `ExportPptButton` 은 `disabled` 만 걸고 라벨도 그대로다(`:732-749`).
**대조군:** `ReportModal.tsx:159-163` 은 `<Loader2 className="animate-spin" />` + 문구.
`Spinner.tsx` 프리미티브는 **리포 전체 import 0건.**

권고: 두 단계 라벨('미저장 셀 저장 중…' → 'PPT 생성 중…') + 스피너.
**연쇄 위험:** 반응이 없으면 사용자가 새로고침 → flush 가 날아가 미저장 셀이 남은 채로 다음 내보내기 →
이 코드가 막으려던 '저장 전 스냅샷 PPT'가 만들어진다.

**IX-06 · unlayered `:focus-visible` 이 모든 포커스 유틸을 이긴다** (S)

`globals.css:223-226` 의 `:focus-visible { outline: 2px solid var(--color-brand); outline-offset: 2px }` 가
`@layer components`(231행) **밖**에 있다. 검증관이 **빌드 산출물로 확정** —
`.next/static/css/3aedeb2e259b88b2.css` 에서 이 규칙의 `@layer` 깊이는 0, 반면
`.focus\:outline-\[\#1a73e8\]:focus` 는 `@layer utilities` 안이다.

결과: 주간시트 활성 셀 외곽선이 의도한 파랑·인셋 −1px 이 아니라 **teal·바깥 +2px** 로 그려져
이웃 셀을 침범하고, 다중 선택 실선(같은 `#1a73e8`)과 색이 어긋난다.

> **이건 CLAUDE.md 가 경고하는 안전망 성질의 두 번째 사례다.** display 유틸만 문제인 줄 알았는데
> `:focus-visible` 도 같은 성질을 갖고 있고, `tests/css/breakpoint-safety-net.test.ts` 는 display 만 본다.

권고: `SheetCell.tsx` 에서 outline 을 **인라인 style 로** 지정(인라인은 unlayered 도 이긴다).
이미 `style={{ caretColor: … }}` 가 있으니 합치면 된다. **`globals.css` 는 건드리지 않는다** —
그 전역 규칙이 나머지 화면의 유일한 포커스 표시다.
부수: 죽은 `focus:outline-none` 13곳 정리 + **unlayered 규칙 목록 스냅샷 테스트 추가**.

### 5.4 네비게이션과 스코프

**IA-01 · 전역 화면에서 앱이 "어느 프로젝트인가"에 네 가지로 답한다** (M · ⚠components/app)

`/minutes` 에 있을 때 동시에:

| 요소 | 읽는 값 | 표시 |
|---|---|---|
| 사이드바 셀렉트 (`Sidebar.tsx:96`) | `routeProjectId` | "프로젝트 선택" (미선택) |
| 사이드바 메뉴 헤더 (`:218`) | `menuProjectId` | "D-CUBE 메뉴" + 메뉴 10개 |
| 헤더 브레드크럼 (`HeaderChrome.tsx:70`) | — | "워크스페이스" |
| 헤더 알림 (`:171`) | `routeProjectId` | "프로젝트를 선택하면…" |

권고: `menuProjectId` 를 단일 진실로 승격하고 세 소비처를 맞춘다.
*검증 보정:* "소비처가 제각각 고른 결과"라는 인과 서술은 과장 — 의도된 분리가 일부 있다.

**IA-02 · 프로젝트를 바꾸면 항상 대시보드로 떨어진다** (S · ⚠components/app)

`selectProject` 가 조건 없이 `router.push('/p/{id}/dashboard')` (`Sidebar.tsx:101-104`).
PMO 의 실제 작업은 '같은 화면을 프로젝트별로 비교하기'인데, A·B·C 주간시트 순회에
(셀렉트→대시보드→주간업무) × 3 = **6클릭 + 가장 무거운 페이지 3회 풀로드**(대시보드는 11개 병렬 조회).
섹션을 이어붙일 재료는 이미 컨텍스트 안에 있다(`ProjectNavigationContext.tsx:94-97`).

권고: 섹션 화이트리스트 기반 보존 + `hrefForProject(projectId)` 를 컨텍스트에 두고 두 소비처가 공유.
*검증 보정:* 대시보드 착지 자체는 업계 관례에 가까워 '결함'까지는 아니다 — 개선 기회로 읽을 것.

**IA-06 · `/usage` 가 프로젝트 메뉴 안에 놓인 함정** (M · ⚠components/app)

`if (showUsage) items.push({ href: '/usage' })` — **프로젝트 메뉴 배열의 마지막 항목으로 전역 링크가 섞여 있다**
(`Sidebar.tsx:58-61`, 주석도 "프로젝트 스코프가 아니다"라고 자인).
`isGlobalProjectBridge` 가 허용하는 건 `/meetings`·`/minutes`·`/minutes/*` **셋뿐**이라(`:41-45`),
`/usage` 를 누르면 `menuProjectId=null`·`returnHref=null` 이 되어 사이드바가 3줄로 축소되고 **돌아갈 링크도 사라진다.**

권고: (1) 즉시 — 브리지 목록에 `/usage`·`/admin/*` 추가(`safeProjectHref` 가 이미 검증하므로 보안 위험 없음).
(2) 구조 — `/usage` 를 projectMenu 에서 빼내 하단 '워크스페이스 관리' 섹션으로.

**IA-07 · 회의록만 프로젝트 축을 잃었다** (M)

앱 전체의 1차 분류축은 프로젝트인데 회의록에서만 팀 폴더로 바뀐다.
`MinutesExplorer` 의 `Scope` 는 `all | favorites | unfiled | folder` 넷뿐 — **프로젝트 스코프가 없다.**
팀은 프로젝트를 가로지르므로 팀 탭으로는 프로젝트 경계를 만들 수 없다.

*검증 보정:* **"프로젝트에서 회의록으로 가는 문이 0개"는 반증됐다** — `MinuteSignals.tsx:49` 에
`<Link href="/minutes">회의록 전체 보기</Link>` 가 있고 개별 회의록 딥링크도 있다.
감사자가 라우트 디렉터리만 grep 해서 그 라우트가 렌더하는 컴포넌트를 놓쳤다.
**남는 진짜 문제는 "보관함에 프로젝트 필터가 0개"다.**

권고: `MinutesView` 팀 세그먼트 탭 옆에 프로젝트 셀렉트 추가(`projects` prop 이 이미 내려와 있고
leaf 에 `projectId` 가 있어 `.filter()` 한 줄). **폴더 트리를 프로젝트별로 재편하지 말 것** —
0043 자동 편철 이력이 있고 되돌리기 어렵다.

**IA-03 · URL 이 상태를 담지 않는다** (L)

`router.replace|history.replaceState|window.history` grep 결과가 **로그아웃 1곳뿐**.
`?focus=`·`?view=`·`?team=` 은 **입력 전용 채널**이다 — 봇·대시보드가 딥링크를 쏘아 넣을 수는 있는데
사용자가 만든 상태는 절대 URL 로 나오지 않는다.

'지연 + 심각 + 내 담당' 필터를 건 이슈 목록을 링크로 보낼 방법이 없어 **스크린샷 우회가 굳어진다.**
더 실무적인 손실은 뒤로가기 — 이슈 3페이지에서 모달을 열고 뒤로가기를 누르면 모달이 닫히는 게 아니라
이전 페이지로 이탈하고 필터·페이지가 초기화된다.

권고: `src/lib/nav/useUrlState.ts` 훅 하나로 표준화. 적용 순서 IssuesView → KanbanBoard → MinutesView → MinutesExplorer.
`?focus=` 는 일회성 딥링크라 제외. 덤: `BotPageContextProvider` 가 쿼리키를 봇 컨텍스트로 흘리므로
봇의 상황 인식 정확도가 공짜로 오른다.

**IA-05 · 회의록 링크 한 번에 사이드바 접힘이 계정에 영구 저장된다** (S · ⚠components/app)

`<Link href="/minutes" onClick={() => { dispatchSidebarToggle(true); queueUiPref({sidebarCollapsed:true}) }}>`
(`Sidebar.tsx:200-205`). 사용자가 직접 토글할 때와 **완전히 같은 부작용**이라 시스템이 둘을 구분하지 않는다.
같은 파일 `:25` 주석("서버 쓰기는 사용자 토글 시에만")과 정면으로 모순된다.
다른 PC 에서 로그인해도 접혀 있다(`PrefsSync.tsx:44`).

*검증 보정:* "되돌리는 경로가 없다"는 반증 — 사이드바 토글 버튼으로 되돌릴 수 있다.
남는 문제는 **원인과 결과가 시간·화면 모두에서 떨어져 있어 사용자가 인과를 모른다**는 것.

권고: 최소 변경으로 `queueUiPref` 한 줄만 제거(서버 영속화가 끊긴다). 완전한 해법은 세션 한정 오버레이.

**IA-10 · 로그인하면 전사 프로젝트 갤러리에 떨어진다** (M) — '내 프로젝트'와 남의 프로젝트가 구분되지 않는다.
권고 (1)(`src/app/page.tsx`, `projects/page.tsx`)은 안전하나, 권고 (2)의 꼬리("사이드바 셀렉트도 optgroup 으로")는
`(app)/layout.tsx` + `Sidebar.tsx` 두 위험 파일을 건드린다 — **분리해서 진행할 것.**

**IA-09 · 이슈와 WBS 가 서로를 모른다** (L) — 같은 '문제'를 두 분류 체계가 따로 관리한다.
마이그레이션이 필요하다. 마이그레이션과 코드는 **별도 커밋**, `_rollback.sql` 동반(G1 훅이 막는다).

**IA-11 · 전역 검색이 없고 그 자리의 챗봇은 사이드바와 다른 프로젝트를 본다** (M)
— **⚠ 권고 (1)이 `(app)/layout.tsx` 프로바이더 트리 재배치를 요구한다. §2 참조. 이번 라운드 제외 권고.**

**VIS-02 · 다크 모드가 반쪽인 채 토글만 숨겨졌다** (M · ⚠globals.css + components/app)

`.dark` 블록이 팀 기본색 5개와 `--color-today` 를 안 덮는다(`globals.css:169-171` 은 `-weak` 5개만).
다크 팀 칩 대비 실측 2.47~3.09:1, `WbsGanttSheet.tsx:994·996` 의 하드코딩 `bg-[#f1f4f9]` 위 다크 ink 는 **1.04:1**.
동시에 토글은 `hidden`(`HeaderChrome.tsx:143`)이고, `PrefsSync.tsx:42` 가 서버에 남은 `theme='dark'` 를
**로그인할 때마다 되살린다.** 즉 과거에 다크를 켠 계정이 있다면 그 사람은 지금 나갈 문이 없다.

권고: (A) 살린다 / (B) 지운다 / **(C) 결정 전까지 최소 안전조치 — `PrefsSync` 에서 theme 을 'light' 로 고정하고
서버에 남은 dark 를 1회 정리.** (C)를 먼저 하고 (A)/(B)는 별도 결정으로.

---

## 6. 완결성 비평 — 화면을 가로지르는 발견 (GAP-02 ~ GAP-10)

세 감사자가 열지 않은 화면(근태·공지·멤버·설정·임포트·관제·사용현황·관리자·초대·공유·칸반·간트)을
전부 열어 본 결과다. 비평가의 총평이 정확하다 —
**"진짜 병목은 디자인이 부족한 화면이 아니라, 같은 개념을 여러 화면이 각자 다시 발명해 놓은 것"이다.**

### GAP-02 · 같은 날짜가 화면마다 8가지 모양 (P1 · M · 미검증)
`26.09.15` · `2026-09-15` · `2026. 9. 15.` · `2026년 9월 15일` · `25. 9. 15. 오후 3:20` …
`wbs/shared.tsx:125-128` 의 `fmtDate` 는 `d.slice(2).replace(/-/g,'.')` 라 **연도가 2자리**다 —
2026 인지 2025 인지 순간 판단이 필요하다. 한 화면 안에서 두 형식이 같이 나오는 곳도 있다.

권고: `src/lib/domain/format.ts`(퍼센트 규칙이 이미 사는 자리)에 4개만 추가 —
`formatDay`(`2026-09-15`, 표·목록) · `formatDayShort`(`09.15`, 달력·간트) ·
`formatDayLong`(보고서·PPT) · `formatStamp`(로그·버전). `EMPTY = '—'` 상수도 함께.

### GAP-03 · "권한 없음"을 알리는 방식이 7가지, 그중 4곳은 무언 리다이렉트 (P1 · M · 미검증)
`/usage` · `/admin/accounts` · `/admin/teams` · `/admin/llm-config` 가 이유 없이 `/projects` 로 보낸다.

> **실패 시나리오** 권한이 바뀐 팀장이 북마크한 `/usage` 를 연다 → 설명 없이 갤러리로 튕긴다 →
> 링크가 깨졌다고 판단해 PMO 에게 "사용현황 페이지가 사라졌다"고 신고한다.
> 더 나쁜 경우: REST 일시 장애로 `getActorForView()` 가 열화되면 **정상 관리자도** 같은 취급을 받는다.

권고: `components/ui/AccessNotice` 프리미티브 1개 + 변형 3종(page/section/inline).
**리다이렉트를 없앤다** — 사유와 필요한 등급을 화면에서 말한다.
*이건 CLAUDE.md 의 "조회 실패를 데이터 없음으로 위장하지 않는다" 원칙과 같은 계열이다.*

### GAP-04 · 온보딩이 0 (P1 · M · **직접 실측 확인**)
- `DashboardView.tsx:83` 의 빈 상태에 **`action` prop 이 없다.** 문구는 "설정에서 WBS 엑셀을 가져오면…"
- 그런데 실제 작업은 설정이 아니라 `/p/[id]/import` 마법사에서 일어나고,
  **그 마법사는 사이드바 10개 메뉴 어디에도 없다**(실측 0건)
- `KanbanBoard.tsx:235` 도 동일

대형 SI 프로그램은 프로젝트를 자주 만들지 않는다 — 신규 세팅은 '가끔 하는, 그러나 반드시 성공해야 하는'
작업이고, 대개 슈퍼유저 한 명이 한다. 그 한 명이 막히면 프로그램 전체가 시작되지 않는다.

권고(즉시·최소): 두 EmptyState 에 `action={<Link href={`/p/${projectId}/import`} className="btn btn-primary">WBS 가져오기</Link>}`
추가 + 문구의 "설정에서" 를 고친다. 권한 없는 사용자에게는 `action` 을 주지 않는다.

### GAP-05 · 팀 색이 런타임 팀 마스터를 따라가지 않는다 (P1 · L · 미검증)
`--color-team-*` 5쌍만 하드코딩되어 있어 `/admin/teams` 에서 추가한 신규 팀은 색을 못 받는다.
폴백이 파일마다 다르고, 칸반에서는 `bg-pending` 이라 **'미배정' 열·'시작 전' 상태와 픽셀 단위로 같은 점**이 된다.

> 2026-07-24 에 팀을 런타임 마스터로 옮겼는데(`0044`) **색만 코드에 남았다.** 마스터화가 반쪽이다.

권고: `teams` 테이블에 `color_key` 컬럼 + `/admin/teams` 에 색 선택 + `globals.css` 를
팀 코드 기준이 아니라 **팔레트 키 기준**(`--color-tint-*` 8종)으로 재정의.
마이그레이션 동반이므로 별도 커밋 + `_rollback.sql`.

### GAP-06 · `.btn` 베이스에 외형이 없어 맨 글자로 렌더되는 버튼이 31곳 (P2 · S · **직접 실측 확인**)
`.btn` 은 레이아웃·크기·굵기만 있고 **배경·테두리·색 선언이 없다**(`globals.css:336-340`).
외형은 전부 변형(`.btn-primary`/`.btn-accent`/`.btn-ghost`)이 담당한다.

실측 — 배경 유틸 없이 `btn` 만 쓴 곳 **31곳**(비평가는 17곳이라 했다. 과소평가였다):

| 파일 | 건수 |
|---|---|
| `MinuteViewer.tsx` | 9 |
| `AgentOpsView.tsx` | 5 |
| `MinuteShareModal.tsx` · `MinutesExplorer.tsx` | 각 4 |
| `MinutesView.tsx` · `MinuteMetaModal.tsx` | 각 3 |
| `MinuteToc.tsx` · `MinuteChatPanel.tsx` · `FolderManageModal.tsx` | 각 1 |

**회의록 계열에 집중돼 있다.** 그중 '다시 시도'(`MinutesView.tsx:380`, `MinutesExplorer.tsx:559`)는
조회 실패 EmptyState 의 **유일한 복구 경로**이고, '더 보기'(`MinutesExplorer.tsx:605`)가 안 보이면
회의록이 `PAGE_SIZE` 만큼만 있는 것으로 오인한다 — 조용한 데이터 은폐다.

권고(안전): 31곳을 `btn btn-ghost` 로 교체. 파괴적 성격이 있는 재발급만
`btn btn-ghost text-delayed hover:bg-delayed-weak`(`AttendanceView.tsx:421` 의 기존 관례).
*근본안(`.btn` 에 ghost 외형을 기본값으로)은 `globals.css` 를 건드리고 전 화면에 영향을 준다 — 비권장.*

### GAP-07 · 월 달력이 세 벌 복제, 셋 다 빈 상태를 말하지 않는다 (P2 · M · 미검증)
근태·프로젝트 회의·내 회의가 각자 달력을 갖고 있고 셀 높이도 96px vs 104px 로 다르다.
기본 뷰가 달력인데 **기록이 0건이어도 빈 격자만 그린다** — 사용자는 이걸 '기록 없음'이 아니라
'조회 실패'로 읽는다. 데이터 계층에서는 지켜지는 에러 처리 3원칙이 **렌더 계층에서 새는 지점**이다.

권고: `components/ui/MonthGrid` 프리미티브 추출(셀 높이는 104px 로 통일 — 근태 칩이 3개까지 들어간다).
빈 상태는 격자를 지우지 말고 **격자 위에 한 줄 안내를 얹는다**(달력은 날짜 자체가 정보다).

### GAP-08 · 출력물의 시각 언어가 화면과 끊겨 있다 (P2 · M · **직접 실측 확인**)
`src/lib/report/brand.ts` 파일 주석: *"Excel 출력에서 화면과 동일한 브랜드 컬러를 쓰기 위한 단일 출처."*
teal · warm cream · 상태색 4종 · 팀색 5종을 정의한다. **그런데 이 파일을 import 하는 코드가 0건이다.**
실제로 쓰이는 것은 `dkbrand.ts`(`excel.ts:5` 가 import)이고, 그 팔레트는 **보라**다 —
제품 브랜드(teal)도, 사내 CI(`002452`/`C51F2A`)도 아니다.

권고: (1) PPT 는 건드리지 않는다(사내 템플릿 준수가 맞다). (2) 엑셀 정체성을 하나로 정한다 —
PPT 가 사내 템플릿을 따르는 이상 **엑셀도 사내 CI 로 맞추는 편이 일관된다.**
(3) 결정 후 `brand.ts` 를 지우거나 실제로 쓴다. **지금은 죽은 파일이 정본인 척하고 있다.**

### GAP-09 · 데스크톱과 모바일이 같은 10개 메뉴를 다른 순서로 나열한다 (P2 · S · 미검증)
데스크톱: … kanban → **meetings → weekly → issues** → announcements → **members → attendance** …
모바일: … kanban → **issues → members → attendance** → announcements → **meetings → weekly** …
모바일에는 아이콘도 없다. 사용 환경이 '사무실 + 회의실 노트북 + 가끔 모바일'이라 기기 전환이 일상이다.

권고: `projectMenu()` 를 공유 모듈로 빼고 양쪽이 같은 함수를 호출하게 한다(렌더만 다르게).
운영 측면 이득이 더 크다 — 지금은 메뉴를 추가·삭제할 때 두 곳을 고쳐야 하고, 한 곳을 빠뜨리면 조용히 어긋난다.
⚠ `components/app/*` 두 파일 — Wave 4.

### GAP-10 · `/agent-ops` 는 완성된 기능인데 화면만 프로토타입 (P3 · M · 미검증)
`PageHero`·`ProjectPageShell` 을 쓰지 않는 몇 안 되는 라우트이고, 버튼 5개가 전부 배경 없는 맨 글자다(GAP-06).
**이 화면은 자동화가 만든 실적을 사람이 승인하는 자리다** — 승인/반려는 WBS 실적과 롤업에 직결되는
되돌리기 어려운 판단인데, '반려' 버튼이 글자로만 보인다. 판단의 무게와 화면의 무게가 어긋나 있다.

권고: 기능 변경 없이 표피만 교체 — `ProjectPageShell` + `PageHero` 로 감싸고 카드 마크업을 관례에 맞춘다.

---

## 7. P3 — 정리 대상 (11건)

| ID | 내용 | 공수 |
|---|---|---|
| IX-12 | 이슈 표에서 제목을 드래그 선택하면 상세 모달이 열려 선택이 날아간다(표 전체가 클릭 타깃) | M |
| IX-13 | 주간시트 셀 상태 배지가 본문 첫 줄 위에 절대배치로 겹쳐 글자를 가린다 | S |
| VIS-10 | 타이포 스케일이 2단으로 붕괴 — **데이터(숫자)를 위한 서체 역할이 없다** | M |
| VIS-12 | 포커스 링 색이 `brand-ring` 1.58:1 — 키보드 사용자가 위치를 잃는다 | S |
| VIS-13 | `ink-subtle` 이 자기가 얹히는 배경 절반에서 AA 미달(시트 헤더·회색 패널) | S |
| VIS-14 | 로그인 모바일 화면이 제품명을 **'DK Flow'** 로 적고 있다 | S |
| IA-12 | 사이드바 폴백에 같은 곳(`/projects`)을 가리키는 항목이 둘, '새 프로젝트'는 대부분에게 빈 약속 | S |
| IA-13 | 브레드크럼이 클릭되지 않고, 화면 이름이 사이드바와 어긋나며, 일부는 이름조차 못 찾는다 | S |
| IA-14 | 쓰이지 않는 `ProjectTabs.tsx` 가 UI 위험 디렉터리에 남아 있다 | S |
| VIS-09 | 팔레트 정체성 — WBS 시트가 depth0/1 행을 쿨 블루로 하드코딩해 warm cream 을 스스로 배신 | L |

**VIS-09 에 대한 판단:** 전 화면 리스킨은 **이번 라운드에서 제외를 권고한다.** Preview 로 검증할 수 없는
가장 큰 변경이면서, VIS-01/03/06 을 먼저 처리하면 체감 개선의 대부분이 이미 회수된다.
다만 "가장 많이 보는 화면이 쿨 블루로 하드코딩되어 있다"는 사실은 팔레트 재검토 시 출발점으로 남길 가치가 있다.

**VIS-10 은 P3 이지만 저비용·고효과다** — 숫자 정렬용 `tabular-nums` 역할이 토큰화되어 있지 않아
KPI 숫자와 표의 숫자가 다른 처리를 받는다.

---

## 8. 실행 계획

### Wave 0 — 인쇄 (단독 브랜치, 즉시)
- **GAP-01** `@media print` 화이트리스트 → 블랙리스트 전환
- 함께: **`globals.css` unlayered 블록 전량 스냅샷 테스트** 추가 (같은 계열 4번째 사고 예방)

단독으로 진행한다. 다른 변경과 섞으면 되돌릴 때 인쇄만 따로 못 뺀다.

### Wave 1 — 토큰 (브랜치 1개, Preview 검증 가능)
`globals.css` @theme 만 건드린다. **로그인 페이지가 CSS 전량을 로드하므로 Preview 로 확인 가능한 유일한 묶음.**

- VIS-01 전경 4색 · VIS-06 `accent-secondary` + gradient · VIS-03 `today`/`team-mdm` 분리

→ 이것만으로 대시보드·WBS·칸반·이슈·공지의 신호 판독이 전부 회복된다. **투자 대비 회수가 가장 크다.**

### Wave 2 — WBS 시트 (위험 파일 밖, main 직행 가능)
- IX-04 접기/펼치기 대칭 (**커밋 `42b1a51` 확인 선행**)
- IX-02 Enter 포커스 복귀 (최소 구현부터)
- IX-01 삭제 건수 표시 + 버튼 분리
- IX-07 `useFocusTrap` 추출·적용
- IX-03 낙관 반영 + `item_owners` 조회 축소

### Wave 3 — 표·피드백·일관성 (위험 파일 밖)
- IX-08 이슈 표 가로 스크롤 · IX-10 에러 토스트 영속 + WBS 토스트 통합
- IX-11 PPT 진행 표시 · IX-06 주간시트 포커스 인라인화
- VIS-07 이슈 `open` 중립화 (**좌표 재확인 선행**)
- **GAP-06** 맨 글자 버튼 31곳 → `btn btn-ghost` (회의록 계열 집중, 기계적)
- **GAP-04** 빈 상태에 '가져오기' 버튼 + 문구 정정 (온보딩 최소 조치)
- **GAP-02** `format.ts` 에 날짜 정본 4개 추가 후 점진 교체
- **GAP-03** `AccessNotice` 프리미티브 + 무언 리다이렉트 4곳 제거

### Wave 4 — 셸 (브랜치 필수, Preview 검증 불가 → 배포 후 실화면 + `mark:good`)
- VIS-11 사이드바 상태색 토큰화 · IA-06 브리지 목록 확장 · IA-02 섹션 보존 · IA-05 `queueUiPref` 제거
- **GAP-09** `projectMenu()` 공유 모듈화 (데스크톱·모바일 순서 통일)
- **GAP-04** 후속: 사이드바에 임포트 진입점 추가

### Wave 5 — 마스터화 완결 (마이그레이션 동반, 별도 커밋 + `_rollback.sql`)
- **GAP-05** 팀 색을 `teams.color_key` 로 — 2026-07-24 팀 마스터화(`0044`)의 남은 절반

### 별건 결정 필요 (구현 전 합의)
- **PageHero** — 살릴 것인가 지울 것인가 (VIS-05 / IA-04)
- **다크 모드** — 살릴 것인가 지울 것인가. 그 전에 최소 안전조치 (VIS-02)
- **대시보드 위계** — 카드를 줄일 것인가 위계를 줄 것인가 (VIS-08)
- **URL 상태** — 표준 훅 도입 여부 (IA-03, L 규모)
- **엑셀 브랜드** — 사내 CI 인가 제품 teal 인가. 지금의 보라는 어느 쪽도 아니다 (GAP-08).
  결정 후 죽은 `lib/report/brand.ts` 를 쓰거나 지운다

### 이번 라운드 제외 권고
- **VIS-09** 전 화면 리스킨 — 검증 수단이 없다
- **IA-11** 프로바이더 트리 재배치 — 검증 수단이 없다
- **IA-09** 이슈↔WBS 통합 — 마이그레이션 동반, 별도 기획

---

## 부록 A. 이미 잘 되어 있어 건드리면 안 되는 것

감사자 3인이 공통으로 지목했다.

- **신호에 색 말고 형태·문자를 타입 레벨로 강제한다** — `signalStyle.ts:5-10` 이 `Signal` 마다 `icon` 을
  필수 필드로 들고, `SignalTile.tsx:11` 이 `statusText` 를 필수 prop 으로 받는다.
  색맹 사용자가 신호를 잃지 않는 구조가 **컴파일 타임에 보장된다.** 색 값만 고치고 이 구조는 두라.
- **전역 reduced-motion 차단** — `globals.css:445-453` 이 `*, *::before, *::after` 에
  `animation/transition-duration: 0.01ms !important`. `@layer` 밖이라 login-float·animate-spin·
  animate-pulse 가 전부 자동으로 덮인다. 컴포넌트에 `motion-safe:` 를 흩뿌릴 이유가 없다.
- **`.minutes-md` 타이포가 단일 변수로 스케일한다** — 폰트는 `em`, 보더·배지는 `px` 로 나누고
  크기 전체를 `--minutes-fs` 하나로 몰았다. 뷰어에서 1px 조절해도 `MarkdownView` props 가 안 바뀌어
  10만 자 재파싱이 일어나지 않는다. **회의록 타이포는 손대지 말 것.**
- **SVG 게이지가 스크린리더에 숫자로 전달된다** — `ProgressGauge.tsx:27-31` 이
  `role="img"` + "실적 X%, 계획 Y%, 편차 Z%p, 진척 판정 …" 를 한 문장 aria-label 로 만든다.
- **토큰 채택률** — 173개 tsx 중 원시 팔레트 사용은 5개 파일(23곳)뿐. 이 규율을 유지하라.
- **`aria-*` 92개 파일 · `role=` 60개 파일** — 접근성 의식 자체는 이미 코드에 있다.
  빠진 것은 포커스 관리(11개 파일)뿐이다.

## 부록 B. 폐기된 발견

- **IA-08** "회의 → 회의록 링크가 단방향" — **REFUTED.** 실제로는 양방향이다.

---

## 부록 C. 비평가가 지목한 추가 강점

- **임포트 replace 경고** — 삭제 건수·부수 영향·백업 다운로드를 전부 보여준다. 파괴적 동작 UI 의 사내 정본으로 삼을 것.
- **명단 ↔ 권한 양방향 링크** — 두 축(`project_members` / `project_roles`)이 다르다는 사실을 화면이 인정하고 서로를 가리킨다.
- **degrade 를 '확인 불가'로 정직하게 표기** — 조회 실패를 '완료'나 '없음'으로 위장하지 않는다.
- **`ProjectNavigationContext` 의 `safeProjectHref`** — 복귀 경로를 origin·프로젝트 루트 소속으로 이중 검증해
  오픈 리다이렉트를 막고, 실패 시 조용히 대시보드로 폴백한다. **이 판정 로직은 손대지 말 것.**
- **`loading.tsx` 세그먼트 배치** — Next 의 로딩 폴백 경계가 '부모 세그먼트'라는 것과,
  `/p/x/dashboard → /p/x/wbs` 에서는 `(app)/loading.tsx` 가 재마운트되지 않는다는 것을 알고 배치했다.
  주석에 근거까지 적혀 있다. **로딩 커버리지(11/26)는 결함이 아니다.**
- **`WeeklySheetView` 의 `WeekNav`** — 주차 이동을 `useState` 가 아니라 `Link href="?week="` 로 처리한다.
  이 앱에서 URL 이 상태를 담는 **유일한 화면**이고, IA-03 의 해법 레퍼런스로 그대로 복제하면 된다.

---

## 부록 D. 실행 체크리스트

착수 시 이 표만 보면 된다. 라인 번호는 **2026-08-07 기준**이므로 파일이 바뀌었으면 먼저 재확인할 것.

### Wave 0 — 인쇄 · 브랜치 `ui/print-fix`

- [ ] **GAP-01** `src/app/globals.css:458-470` — `body * { visibility: hidden }` 삭제,
      `[data-print-hide] { display: none }` 방식으로 전환. `.print-area` 규칙은 남긴다(ReportModal 보호).
      **`print:hidden` 유틸 금지** — 상태 변형 display 라 안전망에 진다.
- [ ] 감출 크롬에 `data-print-hide` 부착 — `(app)/layout.tsx` 의 `aside`·`header`, DkBot 런처, Toast 컨테이너
- [ ] **신규** `tests/css/unlayered-rules.test.ts` — `globals.css` 의 unlayered 블록 전량 스냅샷
      (`@layer components` 는 421행에서 닫힌다. 그 뒤 178줄이 검사 대상)
- [ ] 검증: Preview 에서 로그인 페이지 Ctrl+P → 내용이 보이는지

### Wave 1 — 토큰 · 브랜치 `ui/token-contrast`
`globals.css` `@theme` 만 건드린다. 컴포넌트 변경 0.

- [ ] **VIS-01** `--color-done` `#138a67→#0d6b52` · `--color-delayed` `#cb4b5f→#ab3346` ·
      `--color-accent-warning` `#c06f24→#9a5616` · `--color-pending` `#7a6f68→#6b615a`
- [ ] **VIS-06** `--color-accent-secondary` `#cb6d37→#ad5420`
      — `--gradient-secondary`(`:119`)와 `.app-backdrop`(`:427`)도 같이 조정
- [ ] **VIS-03** `--color-today` `#cb4b5f→#123d64` · `--color-team-mdm` `#0f766e→#b03060` ·
      `--color-team-mdm-weak` `#dcf4f1→#fae7ef`
- [ ] 검증: Preview 로그인 화면 + 배포 후 대시보드·WBS·칸반·이슈 실화면

### Wave 2 — WBS 시트 · main 직행

- [ ] **IX-04** `WbsGanttSheet.tsx:361` — `collapsibleIds` 를 '자식이 있는 노드'로 확장
      (`phaseIds ⊆ collapsibleIds` 성립). `:176` 기본 접힘 대상은 그대로.
      **선행: 커밋 `42b1a51` 의도 + `tests/ui/wbs-focus-jump.test.tsx:119-133` 확인**
- [ ] **IX-02** `WbsGanttSheet.tsx:584-631` — commit/cancel 후 `requestAnimationFrame` 으로 포커스 복귀.
      셀렉터는 기존 `data-row-id`(`:1030`)·`data-wbs-col`(`:1205`). **최소 구현은 "원래 셀 복귀"만**
- [ ] **IX-01** `RowDetailPanel.tsx:437-439` 삭제 버튼 분리 + `:491-497` 확인 문구에 건수.
      `lib/domain/wbsAffordance.ts` 에 `descendantCount(item)` 추가, `dict/wbs.ts:158` 에 새 키
- [ ] **IX-07** `components/ui/useFocusTrap.ts` 신규 — `Modal.tsx:42-80` 로직 추출 →
      `RowDetailPanel.tsx:212`, `minutes/ArchiveChatPanel.tsx:38`
- [ ] **IX-03** `WbsGanttSheet.tsx:616-618` 로컬 오버레이 맵.
      별건(S): `lib/data/wbs.ts:22` `item_owners` 를 `wbs_item_id in (...)` 로 축소
      (**`item_owners` 에 `project_id` 컬럼이 없다** — `0001_init.sql:43-48`)

### Wave 3 — 표·피드백·일관성 · main 직행

- [ ] **IX-08** `IssuesView.tsx:187` — `<div className="overflow-x-auto">` + table 에 `min-w-[900px]`.
      `:189-198` colgroup 퍼센트 재검토
- [ ] **IX-10** `Toast.tsx:31` — `variant === 'error'` 면 자동 소멸 해제(hover 일시정지 로직 재사용).
      `WbsGanttSheet.tsx:216·241-245·1399-1408` 자체 토스트를 `useToast()` 로 통합
- [ ] **IX-11** `WeeklySheetView.tsx:706-749` — 2단계 라벨('미저장 셀 저장 중…' → 'PPT 생성 중…') + 스피너.
      `components/ui/Spinner.tsx`(현재 import 0건)를 여기서 쓰거나 삭제
- [ ] **IX-06** `SheetCell.tsx:78-79` — outline 을 인라인 `style` 로(기존 `caretColor` 객체에 합침).
      **`globals.css` 는 건드리지 않는다.** 죽은 `focus:outline-none` 13곳 정리
- [ ] **VIS-07** `issues.ts:85` open 중립화 + `IssuesView` 에서 `isOverdue()`(`:101-104`) 오버레이.
      `:88` `bg-slate-400` → `bg-pending`. **⚠ 좌표 재확인 필수**
- [ ] **GAP-06** `btn` 만 쓴 31곳 → `btn btn-ghost`
      (MinuteViewer 9 · AgentOpsView 5 · MinuteShareModal 4 · MinutesExplorer 4 · MinutesView 3 ·
      MinuteMetaModal 3 · MinuteToc 1 · MinuteChatPanel 1 · FolderManageModal 1)
- [ ] **GAP-04** `DashboardView.tsx:83` · `KanbanBoard.tsx:235` 에 `action` prop +
      `dict/dashboard.ts:14` · `dict/kanban.ts:25` 문구에서 "설정에서" 제거
- [ ] **GAP-02** `lib/domain/format.ts` 에 `formatDay`·`formatDayShort`·`formatDayLong`·`formatStamp`·`EMPTY` 추가 후 점진 교체
- [ ] **GAP-03** `components/ui/AccessNotice.tsx` 신규(page/section/inline 3변형) +
      `usage/page.tsx:34` · `admin/accounts:22-23,32` · `admin/teams:14` · `admin/llm-config:13` 의 무언 redirect 제거
- [ ] **VIS-04** `SheetCell.tsx:134,139` `#9aa0a6→#5f6368` · `WeeklySheetView.tsx:634` `text-neutral-400→600` ·
      `lib/domain/sheetPresence.ts:8-10` PRESENCE_COLORS 재선정
      (PresenceStrip 화면도 눈확인 대상에 포함)

### Wave 4 — 앱 셸 · 브랜치 `ui/shell-nav` · **Preview 검증 불가**

- [ ] **VIS-11** `Sidebar.tsx:31-39` STATUS_META 토큰화
      (`active→bg-progress` · `done→bg-done` · `overdue→bg-delayed` · `ready→bg-pending` · `unknown→bg-ink-subtle`)
- [ ] **IA-06** `ProjectNavigationContext.tsx:41-45` 브리지 목록에 `/usage`·`/admin/*` 추가.
      이어서 `Sidebar.tsx:58-61` 의 `/usage` 를 projectMenu 에서 분리
- [ ] **IA-02** `Sidebar.tsx:101-104` + `HeaderChrome.tsx:333-337` 섹션 보존.
      `ProjectNavigationContext` 에 `hrefForProject(projectId)` 를 두고 양쪽이 공유. **화이트리스트 + 폴백 필수**
- [ ] **IA-05** `Sidebar.tsx:204` 의 `queueUiPref({sidebarCollapsed:true})` 제거
      (같은 파일 `:25` 주석 원칙과 모순인 상태)
- [ ] **GAP-09** `projectMenu()` 를 공유 모듈로 추출 → `HeaderChrome.tsx:285-296` 이 같은 함수 사용
- [ ] 배포 후 실화면 확인 → `npm run smoke:prod` → `npm run mark:good`

### Wave 5 — 팀 색 마스터화 · 마이그레이션 동반

- [ ] **GAP-05** `teams` 테이블에 `color_key` 컬럼 (마이그레이션 + `_rollback.sql`, **코드와 별도 커밋**)
- [ ] `globals.css` 의 `--color-team-*` 를 팀 코드 기준 → **팔레트 키 기준**(`--color-tint-*` 8종)으로 재정의
- [ ] 소비처 3곳 — `wbs/shared.tsx:11-13` · `MembersBoard.tsx:27-29` · `lib/domain/kanban.ts:22-26`
- [ ] `/admin/teams` 에 색 선택 셀 추가

### 별건 결정 (착수 전 사용자 확답)

- [ ] **PageHero** — 살릴 것인가(A) 지울 것인가(B). *B 를 고르면 위험 파일 밖에서 끝난다*
- [ ] **다크 모드** — 살릴지 지울지. **그 전에 최소 안전조치(C)만 먼저 할 수도 있다**
- [ ] **대시보드 위계** — 카드를 줄일 것인가 위계를 줄 것인가. *권고는 위계 부여(카드 유지)*
- [ ] **URL 상태** — `useUrlState` 훅 도입 여부 (L 규모)
- [ ] **엑셀 브랜드** — 사내 CI 인가 제품 teal 인가. 결정 후 죽은 `lib/report/brand.ts` 처리

---

*진단: 프론트엔드 디자이너 3인(IA · 인터랙션 · 비주얼) 병렬 감사 + 적대적 근거 검증 + 완결성 비평.
감사 41건 중 40건 채택·1건 폐기, 비평 10건 추가(4건 직접 실측). **총 50건.**
모든 발견은 `file:line` 근거를 갖는다. 이 진단은 읽기 전용이며 코드는 한 줄도 변경되지 않았다.*
