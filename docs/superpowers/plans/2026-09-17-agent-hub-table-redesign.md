# 에이전트 허브 위임·승인 표 개편 — 구현 계획

- 작성: 2026-09-17
- 상태: **구현 완료 · staging 육안 확인까지 끝남(2026-09-17). 운영(main) 반영은 지시 대기.**
- 시안(Artifact): https://claude.ai/artifact/Tz8ZdkCPp44Da6htzywFYZ
- 대상 화면: `/p/[projectId]/agents` 위임·승인 탭

---

## 1. 왜 고치나

사용자 지적: "위임·승인 페이지가 너무 허접하다. 체크 버튼도 너무 날것으로 보인다."

실제 화면을 뜯어본 결과, 눈에 거슬리는 순서는 아래와 같다. 체크박스는 네 번째 문제였다.

1. **행 높이 붕괴** — 「선행 미완료: dict/TSK-00-03 권한 가드 + 공통 레이아웃 셀(현재 as(할당됨))」이
   상태 칸에서 세 줄로 감겨 그 행만 높이가 네 배가 된다. 스크롤이 튄다.
2. **열 10개** — 프롬프트 열은 거의 비어 있고, 단계·상태·에이전트·마지막 신호가 따로 놀아
   `min-w-[960px]` 을 쓰고도 좁다.
3. **상태가 전부 회색** — `STATE_LABEL` 8종이 모두 `chip bg-surface-2` 라 훑어서 읽히지 않는다.
4. **체크박스가 튄다** — 네이티브 파란 `accent-color` 가 warm cream 바탕에서 이질적이다.
5. **「대기(미착수)」가 이유를 안 말한다** — 좌석표는 사유 4종을 이미 구분하는데 표는 흘린다(§3).
6. 에이전트 호스트명이 두 줄로 감기고, 조정 버튼 칸 폭이 행마다 달라 오른쪽이 들쭉날쭉하다.
7. 열 너비를 사용자가 조절할 수 없고, 가로 스크롤 시 어느 행인지 잃는다.

---

## 2. 범위와 변경 파일

| 파일 | 변경 |
|---|---|
| `src/components/agent-hub/DelegationTable.tsx` | 표 전면 개편(본 계획의 대부분) |
| `src/lib/domain/agentHub.ts` | `HubRow.waitReason` 추가, `buildAgentHub` 에서 `deriveWaitReason` 호출 |
| `src/components/agent-hub/labels.ts` | 상태 칩 색 매핑 추가(`STATE_TONE`) |
| `src/components/agent-hub/HubStatusBar.tsx` | 카운터에 「막힘」 1건 추가 |
| `src/app/globals.css` | **건드리지 않는다** — 새 토큰 없음 |

**라이브러리 도입 없음.** 이 리포에는 표 라이브러리가 없고(런타임 의존성: supabase / next / react /
lucide-react / mermaid / exceljs·xlsx / react-markdown 계열), 필요한 기능은 전부 CSS 와
`<col>.style.width` 로 된다. TanStack Table 을 들여도 얻는 게 없다.

---

## 3. 착수 대기 사유 — 새로 만들지 않는다

`src/lib/domain/waitReason.ts` 의 `deriveWaitReason()` 이 이미 네 가지를 판정하고, 좌석표
(`Seat.tsx` 라벨 · `DetailPanel.tsx` 전문)가 쓰고 있다. 표만 `unmetDepends` 한 축을 따로 떼어
쓰느라 나머지 셋을 흘린다. **같은 함수를 표에서도 쓴다** — 두 화면이 다른 말을 하면 안 된다.

| kind | 라벨 | 칩 색(기존 토큰) | 누가 움직여야 풀리나 |
|---|---|---|---|
| `dependency` | 선행 대기 | `delayed` / `delayed-weak` | 사람 — 선행을 끝내야 한다 |
| `agent_off` | 에이전트 꺼짐 | `accent-warning` / `pending-weak` | 사람 — 담당자가 `/dflow-team` 을 켜야 한다 |
| `agents_busy` | 에이전트 바쁨 | `progress` / `progress-weak` | 없음 — 자리 나면 자동 |
| `pickup` | 착수 대기 | `pending` / `pending-weak` | 없음 — 다음 주기에 시작 |
| (표에서 추가) | 위임 필요 | `accent-warning` / `pending-weak` | 사람 — 체크를 켜야 한다 |

색의 기준은 **"누가 손대야 풀리나"** 다. 위 둘은 눈에 띄게, 아래 둘은 조용하게.

### 서버 비용 — 없다

`AgentHubRows` 가 `deriveWaitReason` 의 재료를 이미 전부 들고 있다.

- `depends` · `external_ref` · `stage` · `actual_pct` → `items: HubItemRow[]`
- `order_approved` → `approvedItemIds`
- 담당자 로스터(`name` · `user_id`) → `members: HubMemberRow[]`
- 감시자 → `watchers: WatcherRow[]`

따라서 `buildAgentHub` 안에서 **READY 리프마다 한 번 부르면 되고 DB 왕복은 늘지 않는다.**
`seatmap.ts:197` 의 호출부가 그대로 참고가 된다(`predecessorByRef` 는 `external_ref` 색인).

```ts
// agentHub.ts — HubRow 에 한 필드
waitReason: WaitReason | null   // READY 리프만, 그 밖에는 null
```

기존 `HubRow.unmetDepends` 는 `waitReason.kind === 'dependency'` 에 흡수된다. **제거하되**
`data-hub-depends` 선택자는 남긴다(§6).

---

## 4. 표 구조 — 열 10개 → 7개 + 여유 열

```
위임 | 코드 | 작업 | 담당자 | 단계 · 상태 | 에이전트 · 신호 | 조정 | (여유)
 38    126    가변     88        182            162          176
```

- **단계 + 상태** 한 칸: 단계 `<select>` 와 사유/상태 칩을 나란히.
- **에이전트 + 마지막 신호** 한 칸: 위아래 2줄. 호스트명은 mono·중간 말줄임·`title` 에 전문.
- **프롬프트 열 삭제** → 작업 이름 옆 연필 아이콘으로 흡수. 프롬프트가 있으면 `brand` 로 채운다.
- **여유 열**(`<col data-col="slack">`)이 남는 폭을 먹는다. `table-layout: fixed` + `width: 100%`,
  `minWidth` 는 나머지 일곱 열 폭의 합(JS 가 계산).

### 행 서식

- 부모(WP) 행 = `sheet-head` 배경 띠 + 좌측 `brand` 3px.
- 리프 zebra = `--color-zebra`, hover = `brand-weak`.
- **승인 대기 행 = 좌측 `brand` 3px 띠** — 스크롤 중에도 "지금 볼 것"이 걸린다.
- 고정 열이 아래를 비추지 않도록 **모든 `td` 에 명시적 배경**을 깐다(sticky 필수 조건).

### 사유·사유 전문

상태 칩을 버튼으로 만들고, 누르면 기존 펼침 행(`data-hub-row-extra`) 자리에
좌석표 상세와 같은 전문을 연다. 선행 대기에는 「선행 항목 열기」 버튼(=`onSelect(선행 itemId)`).

---

## 5. 열 너비 조절 · 좌우 스크롤

### 너비

- `table-layout: fixed` + `<colgroup>`. **`<col>` 의 px 폭 하나만 바꾼다** — 셀 마크업 불변.
- 머리글 오른쪽 경계에 `.rsz` 버튼(9px, `cursor: col-resize`). `pointerdown` → `pointermove`.
- 더블클릭 = 그 열만 기본값. 툴바 「열 너비 초기화」 = 전부.
- 키보드: `←`·`→` 8px, `Shift` 32px, `Home` 기본값. (마우스 없이도 되게)
- 열마다 최소 폭(`조정 96` · `작업 140` · `에이전트 92` …). **fixed 라 좁히면 잘린다.**
- 저장은 `localStorage`(키 `dflow-hub-colw`), **try/catch 필수**.

### 스크롤

- `.tablebox` 를 `overflow: auto` + `max-height: clamp(320px, 62vh, 640px)`.
  **현재 코드의 sticky 머리글은 사실 동작하지 않는다** — `overflow-x: auto` 컨테이너라
  세로 스크롤 주체가 페이지이기 때문. 상자에 높이를 줘야 붙는다.
- 가로 막대를 상시 노출(`::-webkit-scrollbar` 두께 지정, `scrollbar-color` 토큰).
- `Shift` + 휠로도 가로 이동.
- **좌측 고정**: 위임 + 코드(기본), 툴바에서 작업 열까지 확장. `left` 오프셋은 CSS 변수
  (`--l-code` · `--l-name`)로 두고 너비가 바뀔 때 JS 가 갱신한다.
- 밀려 있는 동안에만 고정 구역 오른쪽에 경계 그림자.

---

## 6. 반드시 지킬 제약

1. **`hidden group-hover:flex` 류 상태 변형 display 유틸 금지.** CLAUDE.md 의 반응형 안전망
   규칙이고 `tests/css/breakpoint-safety-net.test.ts` 가 잡는다. unlayered 규칙이 named layer 를
   이기므로 조용히 동작조차 안 한다. 조정 버튼은 **상시 노출**로 간다(승인이 이 화면의 목적).
2. **`data-hub-*` 속성 전부 보존** — 테스트 선택자다.
   `data-hub-row` · `data-hub-row-extra` · `data-hub-toggle` · `data-hub-parent-toggle` ·
   `data-hub-stage` · `data-hub-stage-text` · `data-hub-op` · `data-hub-note` ·
   `data-hub-note-confirm` · `data-hub-prompt-edit` · `data-hub-prompt-save` · `data-hub-fold` ·
   `data-hub-name` · `data-hub-open` · `data-hub-depends` · `data-hub-error` · `data-hub-warning` ·
   `data-hub-notice` · `data-hub-pending` · `data-hub-pending-count` · `data-hub-filter`.
   착수 전에 `grep -rn "data-hub-" tests/ e2e/ 2>/dev/null` 로 실제 사용처를 한 번 확인할 것.
3. **체크박스는 네이티브 `<input type="checkbox">` 유지.** `accent-color: var(--color-brand)` 와
   크기만 바꾼다. 커스텀 토글로 가면 `ParentCheckbox` 의 `indeterminate` 3상태를 직접 그려야 한다.
   날것으로 보이던 원인은 형태가 아니라 파란 기본색이다.
4. **새 색 금지.** `globals.css` 의 기존 토큰만. `@theme` 에 `--breakpoint-*` 나 색을 더하지 않는다.
   그래야 `.dark` 오버라이드로 다크가 공짜로 따라온다.
5. **묶음 저장 계약 불변** — `usePendingDelegations`(1.5초 모아 `applyHubDelegations` 1건),
   `runHubProcessOp` 응답의 허브로 교체, 페이지 전체 `refresh` 금지(허브 스펙 §7).
6. **권한 경계 불변** — `canToggle` · `canManage` · `assigneeMine` · `isAdmin` 조합과
   `OPS_BY_STATUS` 의 `who` 판정은 서버 가드와 같은 축이다. 서식만 바꾸고 판정은 손대지 않는다.

---

## 7. 작업 순서

1. `waitReason` 을 도메인에 연결 — `agentHub.ts` 에 `HubRow.waitReason`,
   `buildAgentHub` 에서 READY 리프마다 `deriveWaitReason`. **단위 테스트 먼저**(TDD):
   사유 4종 + 위임 안 된 리프는 `null`.
2. `labels.ts` 에 상태·사유 색 매핑(`STATE_TONE` · `REASON_TONE`)을 표로 둔다. 컴포넌트에
   `if (state === ...)` 를 흩지 않는다.
3. 표 골격 교체 — `<colgroup>` · 7열 · `table-layout: fixed` · 셀 배경. 여기까지 기능 동일.
4. 셀 서식 — 상태/사유 칩, 단계 select 칩화, 에이전트 2줄, 프롬프트 아이콘 흡수, 부모 띠·zebra.
5. 열 너비 드래그 + `localStorage`.
6. 좌우 스크롤 + 좌측 고정 + sticky 머리글(상자 높이).
7. 밀도 토글(조밀/넉넉), 「승인 대기만」 필터, 「막힘」 카운터.

각 단계마다 `npm run test` · `npm run lint` · `npm run build`.

---

## 8. 검증

- `npm run test` — 특히 `tests/css/breakpoint-safety-net.test.ts` 와 허브 관련 테스트.
- **눈으로 봐야 한다.** 빌드·린트·타입체크로 안 잡힌다(2026-07-27 사고 때 vitest 2438건 전부 통과).
  staging(dflow-staging.vercel.app)에서 확인한다.
- 확인 항목: 라이트/다크 · 열 드래그 후 고정 열 오프셋 · 가로 스크롤 중 경계 그림자 ·
  사유 칩 5종 펼침 · 좁은 화면(태블릿) · 조정 버튼 잘림 여부.

### 브랜치·배포

`DelegationTable.tsx` 는 `src/components/app/*` 가 아니므로 **G2 훅 대상이 아니다.** 그래도
표 전면 개편이라 관례대로:

```
git switch -c ui/hub-table-redesign
# … 작업 …
git push -u origin HEAD          # Preview(이제 로그인 됨)
# staging back-merge 후 staging push → 스테이징 URL 육안 확인
# 확인되면 main
```

마이그레이션 없음 → G1·G4 무관.

---

## 9. 현재 상태 (2026-09-17 갱신)

구현을 마치고 staging(dflow-staging.vercel.app)에서 눈으로 확인했다. §7 의 일곱 단계를 전부 했다.

| 단계 | 결과 |
|---|---|
| 1 도메인 waitReason | `HubRow.unmetDepends` → `waitReason` 교체, `assembleAgentHub` 이 `deriveWaitReason` 호출 |
| 2 색 매핑 | `labels.ts` 에 `STATE_TONE`(8종)·`REASON_TONE`(4종)·`NEEDS_DELEGATION_TONE` |
| 3 표 골격 | 7열 + 여유 열, `table-layout: fixed`, 셀마다 배경 |
| 4 셀 서식 | 상태·사유 칩, 단계 select 축소, 에이전트 2줄, 프롬프트 연필 흡수, 부모 띠·zebra |
| 5 열 너비 | 드래그·키보드(←/→·Shift·Home)·더블클릭·초기화 버튼, `localStorage` |
| 6 스크롤 | 상자 높이로 sticky 머리글 발화, 좌측 2~3열 고정, 밀린 동안 경계 그림자 |
| 7 나머지 | 조밀 토글, 「승인 대기만」 필터, 「막힘」 카운터(`counters.stuck`) |

CSS 는 새 모듈 `src/components/agent-hub/delegationTable.module.css` 에 두었다 —
`globals.css` 는 한 줄도 건드리지 않았고 새 색 토큰도 없다.

### 육안 확인에서 잡힌 것

- **끌어서 바꾼 폭이 저장되지 않던 경우** — `pointerup` 이 마지막 `pointermove` 의 상태 갱신보다
  먼저 오면(빠른 드래그) 옛 폭이 저장됐다. 드래그 ref 에 확정 폭을 함께 들고 저장하도록 고쳤고
  회귀 시험을 남겼다(`끌어서 바꾼 폭이 그대로 저장된다`).
- 머리글에 `user-select: none` 을 줬다 — 손잡이를 끌 때 글자 선택이 드래그를 끊었다.

### 확인한 항목

라이트·다크 · sticky 머리글 · 좌측 고정(위임·코드 / 작업까지) · 가로 스크롤 중 경계 그림자 ·
사유 칩 펼침(전문이 펼침 행에 한 줄로) · 「승인 대기만」 · 승인 대기 행 좌측 청록 띠 ·
열 드래그 뒤 고정 열 오프셋 추종 · 조정 버튼 잘림 없음.

### 남은 일

- **운영(main) 반영은 지시 대기.** 마이그레이션이 없어 순서 제약은 없다.
- 작업 브랜치는 `ui/hub-table-redesign`, 워크트리 `/Users/jji/project/wbs-web-hub`
  (본 체크아웃에서 다른 세션이 동시에 작업 중이라 분리했다).
