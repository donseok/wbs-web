# 가상 오피스 착수 대기 사유 · 구역 접기 — 설계

작성 2026-09-14. 오피스 분리 스펙(`2026-09-14-agent-office-split-design.md`) 위에 얹는다. 마이그레이션 없음.
브랜치 `feat/office-blockers`(origin/staging d05fcfd9 기반). 머지는 마지막에 한 번.

## 0. 배경·결정

- 위임은 됐는데 좌석이 "빈자리"로만 남고 **왜 안 시작되는지** 화면이 말해주지 않는다. 층 카드의 "감시 없음"과
  빈자리가 따로 놀아 사용자가 잇지 못한다(2026-09-14 스테이징 실측: `ready` 6건, 감시자 0).
- 서버가 판정할 수 있는 사유만 보여준다. 러너가 스스로 건너뛴 사유는 러너가 서버에 남기지 않아 범위 밖.
- 사유는 **하나만**, 순서는 "고쳐도 소용없는 것"부터. 문구는 자세하게(무엇이 막는지 + 누가 무엇을 하면 풀리는지).
- "에이전트 없음"과 "담당자 에이전트 꺼짐"은 한 사유로 합친다 — 차이는 누구의 에이전트냐뿐이라 주어만 바꾼다.
- 가상 오피스는 **상세 패널**에 전문을, 책상 메타 줄에는 짧은 라벨만. 위임·승인 표에는 **선행 미완료만** 표시.
- 구역 접기: 접으면 상세 선택을 푼다(선택된 좌석이 든 구역이 안 접히던 버그의 해법). 층마다 "모두 펼치기/접기".

## 1. 판정(순수, `src/lib/domain/seatmap.ts`)

`Seat.waitReason: WaitReason | null` — `state === 'READY'` 일 때만 값, 나머지는 null.

```ts
export type WaitReasonKind = 'dependency' | 'agent_off' | 'agents_busy' | 'pickup'
export interface WaitReason { kind: WaitReasonKind; label: string; text: string }
```

순서(첫 일치 하나):

1. `dependency` — 항목 `depends`(external_ref[]) 중 미충족이 하나라도. 미충족 = 선행 항목이 프로젝트에 없음, 또는
   `!stageAtLeast(stage,'im') && !order_approved`(클레임 API `dependency_not_met` 와 같은 축).
   - label `선행 대기`
   - text `선행 작업이 아직 끝나지 않았습니다: {목록}. 선행이 im(구현) 단계 이상이 되거나 그 주문이 승인돼야 이 작업을 집어갈 수 있습니다.`
     목록 원소: `{code} {name}(현재 {stage}({라벨}))` / 단계 없음 `(단계 없음)` / 프로젝트에 없음 `{ref}(프로젝트에 없는 항목)`.
2. `agent_off` — 집어갈 자격이 있는 살아 있는 감시자가 0. 자격: 담당자 있으면 담당자 로스터 행의 `user_id` 와 같은 감시자,
   없으면 이 층을 보는 감시자 전부(`project_id null` 또는 = 층).
   - label `에이전트 꺼짐`
   - 담당자 있음: `담당자 {이름} 의 에이전트가 켜져 있지 않습니다. 이 작업은 담당자가 지정돼 있어 {이름} 의 에이전트만 집어갈 수 있습니다. {이름} 이(가) 자기 PC 에서 /dflow-team 또는 /dflow-poll 을 켜야 시작됩니다.`
     + 다른 감시자가 있으면 ` 지금 켜진 에이전트 {n}개({agent 목록})는 다른 사람 것이라 이 작업을 집어갈 수 없습니다.`
     + 담당자 로스터 행에 `user_id` 가 없으면 ` (담당자 계정이 로스터에 연결돼 있지 않아 어느 에이전트도 집어갈 수 없습니다. 멤버 화면에서 계정을 연결하세요.)`
   - 담당자 없음: `이 프로젝트를 보는 에이전트가 하나도 없습니다. 위임은 됐지만 집어갈 주체가 없어 대기 중입니다. 프로젝트 멤버 누구든 자기 PC 에서 /dflow-team 또는 /dflow-poll 을 켜면 시작됩니다.`
3. `agents_busy` — 자격 있는 감시자가 전부 `slots != null && (busy ?? 0) >= slots`.
   - label `에이전트 바쁨`
   - text `에이전트 {n}개가 켜져 있지만 모두 다른 작업 중입니다({agent busy/slots ~until, ...}). 자리가 비면 다음 확인 주기에 자동으로 집어갑니다.`
4. `pickup` — 위 셋에 안 걸림(자격 있고 여유 있는 감시자가 있음).
   - label `착수 대기`
   - text `집어갈 수 있는 에이전트가 있습니다({agent 목록}). 다음 확인 주기에 착수합니다. 이 상태가 오래 가면 그 에이전트의 로그를 확인하세요.`

단계 라벨 `STAGE_LABEL`(도메인 상수): todo 미착수 · as 분석 · fp 기능 계획 · ip 구현 계획 · im 구현 · xx 완료.

## 2. 데이터(`src/lib/data/agentSeatmap.ts`)

`SeatmapRows` 에 추가:
- `ItemRow.depends: string[] | null` (`ITEM_COLS` 에 `depends`).
- `members: MemberRow[]` = `project_members(id, project_id, user_id, name)` in 층 프로젝트.
- `predecessors: PredecessorRow[]` = `{ id, project_id, external_ref, code, name, stage, order_approved }`.
  ready 주문 항목 중 `depends` 가 있는 것의 ref 를 모아 `wbs_items(id, project_id, external_ref, code, name, stage)`
  `.in('project_id', projIds).in('external_ref', refs)` 1회, 그 id 들로 `agent_work_orders(wbs_item_id).in(...).eq('status','approved')` 1회.
  ref 가 없으면 두 조회 모두 생략. 조회 실패는 throw(위장 금지).

## 3. 허브(`src/lib/domain/agentHub.ts`, `src/lib/data/agentHub.ts`)

- `HUB_ITEM_COLS` 에 `external_ref, depends`. 선행 항목은 이미 읽는 프로젝트 전체 항목에서 in-memory 매칭.
- 승인 여부는 허브 주문 조회가 7일 창이라 별도: 선행 항목 id 로 `agent_work_orders(wbs_item_id).eq('status','approved')` 1회
  (`AgentHubRows.approvedItemIds: string[]`). 선행이 없으면 생략.
- `HubRow.unmetDepends: string | null` — 리프 && 위임 && (주문 없음 || READY) 일 때 미충족 목록 문구(§1-1 목록과 같은 형식), 아니면 null.
- 표: 상태 칸 아래 `<small data-hub-depends>선행 미완료: {목록}</small>`(경고색), title 에 전문.

## 4. 오피스 화면

- `Seat.tsx` `seatMetaLine`: READY 는 `waitReason?.label ?? '미착수'`.
- `DetailPanel.tsx`: READY 이고 waitReason 있으면 상태 배지 아래 `<p data-wait-reason={kind} className={css.waitReason}>{text}</p>`.
- `FloorCard.tsx`: `onSelect: (id: string | null) => void`. 접기(구역 접기·모두 접기)는 선택 좌석이 그 구역/층에 있으면 `onSelect(null)`.
  머리에 `모두 펼치기` / `모두 접기` 버튼(`data-floor-expand-all` / `data-floor-fold-all`).
  모두 펼치기 = folded 비움 + 빈 구역 전부 opened. 모두 접기 = 전 구역 folded(빈 구역은 opened 에서 제거).
- CSS: `.waitReason`, `.floorTools`.

## 5. 테스트

- `tests/domain/seatmap.test.ts`: 사유 4종·우선순위·non-READY null·담당자 user_id 없음·감시자 project_id null 포함.
- `tests/data/agent-seatmap.test.ts`: members·predecessors 조회(ref 있음 2회/없음 0회), 컬럼에 depends.
- `tests/domain/agent-hub.test.ts`: unmetDepends(미충족·승인으로 충족·im 으로 충족·주문 claimed 면 null).
- `tests/components/agents-seat.test.tsx`: 메타 라벨, 접기→onSelect(null), 모두 펼치기/접기.
- `tests/components/agents-detail-panel.test.tsx`: 사유 문단.
- `tests/components/agent-hub-table.test.tsx`: 선행 미완료 small.

## 6. 롤아웃

브랜치 push → Preview → staging 머지 → dflow-staging 확인(빈자리 상세에 사유, 허브 표 선행 표시, 접기 동작) → 브랜치 정리.
