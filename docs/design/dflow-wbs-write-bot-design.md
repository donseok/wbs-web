# D'Flow 챗봇 WBS 쓰기 확장 — 생성·수정·삭제 설계 초안

> **상태:** 설계 초안 (구현 미착수)
> **작성일:** 2026-07-29
> **대상 저장소:** `wbs-web`
> **대상 기능:** DK Bot 명령 파이프라인(`src/lib/ai/commands/`) 확장
> **선행 기능:** ACTION BOT v1 (2026-07-12, 배포 커밋 `180e320`) — 실적·일정·완료 3종 쓰기 명령
> **목적:** DK Bot이 WBS 항목을 신규 등록·수정·삭제할 수 있게 하는 확장의 타당성 검토 결과와 설계 결정을 보존한다. 코드는 한 줄도 쓰지 않았다.

---

## 0. 문서의 결정 상태

이 문서는 구현 계약이 확정된 최종 스펙이 아니다. 브레인스토밍(2026-07-29)에서 사용자가 직접 고른 항목만 **확정**이고, 나머지는 검토자가 제안한 **권장**이다.

| 구분 | 내용 |
|---|---|
| 확정 | 챗봇 WBS 쓰기는 **PMO(`pmo_admin`) 전용**으로 한다. 담당팀 확장은 RLS 변경이 필요해 채택하지 않는다. |
| 확정 | 생성 시 부모 지정은 **자연어 우선, 모호하면 기존 되묻기 칩(`disambiguate`) 재사용**으로 한다. |
| 확정 | 삭제는 **하위가 없는 항목만** 허용한다. 하위가 있으면 거부하고 WBS 화면으로 안내한다. |
| 확정 | 수정 대상에 **이름·산출물/업무내용·가중치·담당팀** 네 가지를 모두 추가한다. |
| 확정 | 실제 쓰기 검증은 **프로덕션 Supabase 안의 샘플 프로젝트**에서 수행한다. |
| 권장 | 쓰기를 챗봇 v2 도구 레지스트리에 넣지 않고 기존 명령 경로로만 흘린다(§2). |
| 권장 | 삭제 사실을 **부모 항목의 `change_logs`** 에 기록하고, 그 대가로 루트 Phase 삭제를 금지한다(§6.3). |
| 권장 | `/api/chat/command`의 프로젝트 접근 권한 검사 누락을 이번 작업에서 함께 메운다(§8.2). |
| 권장 | SUB-ACT의 담당팀 변경은 챗봇에서 거부한다(§7.3). |
| 권장 | 확인 카드에 TTL 3분을 두고, 삭제만 적용 직전 서버 재검증을 한다(§9). |
| 추후 결정 | §6.3의 "부모에 삭제 기록 + 루트 Phase 금지" 거래를 받아들일지 |
| 추후 결정 | §8.2의 접근 권한 구멍 수정을 이번 범위에 포함할지 |
| 추후 결정 | 구현 착수 여부 자체 |

> 마지막 두 항목은 검토자가 사용자에게 질의했으나 답을 받기 전에 세션이 종료됐다. 재개 시 여기서부터 시작한다.

---

## 1. 배경

### 1.1 요청

> "챗봇으로 WBS를 신규등록하거나 수정 삭제하는 기능을 만들고 싶은데 지금 프로젝트 구조로 가능한지 검토해줘"

### 1.2 결론

**가능하다. 그리고 절반은 이미 깔려 있다.**

새로 작성해야 하는 백엔드는 담당팀 편집 서버 액션(`setItemOwners`) **하나뿐**이다. 나머지는 전부 존재하는 서버 액션에 배선만 하면 된다.

### 1.3 이미 있는 자산

DK Bot에는 **쓰기 명령 파이프라인이 이미 프로덕션에 있다**(ACTION BOT v1). 조회용 v2 도구 레지스트리와는 완전히 별개 경로다.

```
사용자 발화
  → isCommandUtterance()          cue.ts:10       보수적 게이트(조회 어휘면 무조건 false)
  → parseCommand()                parse.ts:68     정규식 우선 → 실패 시에만 LLM 1콜
  → collectCandidates/match       match.ts:7,32   WBS 트리에서 대상 찾기(모호하면 후보 칩)
  → buildProposal()               propose.ts:6    변경 전/후 diff 생성
  → [사용자가 확인 카드에서 '적용' 클릭]
  → 서버 액션 직접 호출            DkBot.tsx:405   updateActual / updateWbsFields
```

즉 **인증·확인 UX·낙관적 잠금·변경이력 기록·되묻기 흐름**이 전부 이미 동작한다. 지원 액션만 세 개(`types.ts:2`)로 좁을 뿐이다.

서버 액션도 대부분 존재한다(`src/app/actions/wbs.ts`).

| 함수 | 줄 | 권한 |
|---|---|---|
| `updateActual` | 64 | PMO 또는 담당팀 |
| `updateWeight` | 118 | PMO |
| `addWbsItem` | 202 | PMO |
| `addSubAct` | 239 | PMO |
| `updateWbsFields` | 319 | PMO |
| `updateDeliverable` | 507 | PMO 또는 담당팀 |
| `deleteWbsItem` | 535 | PMO |
| `moveWbsItem` | 550 | PMO |

---

## 2. 아키텍처 원칙 — 읽기와 쓰기의 분리를 깨지 않는다

**핵심 불변식:** 쓰기는 **절대** 챗봇 v2 도구 레지스트리에 넣지 않는다.

`orchestrator.ts:394`가 모든 도구 실행 직전에 `/^[a-z][a-z0-9_-]*:read$/`로 capability를 검사한다. 이 가드가 "봇이 조회하다가 실수로 무언가를 쓸 일은 없다"를 구조적으로 보장한다. 이 성질은 프롬프트 인젝션 방어의 마지막 방어선이기도 하다 — EVIDENCE JSON 안에 명령문이 섞여 들어와도 실행 가능한 쓰기 도구가 애초에 존재하지 않는다.

따라서 확장은 전적으로 **명령 경로 안에서만** 일어난다.

```
                      ┌─ 조회 ─→ /api/chat/v2/stream ─→ 20개 read 도구 (쓰기 불가, 하드 가드)
사용자 발화 ─ cue 게이트 ┤
                      └─ 명령 ─→ /api/chat/command ─→ 제안(읽기만) ─→ [확인 클릭] ─→ 서버 액션
```

**AI는 어떤 경로로도 스스로 쓰기를 실행하지 않는다.** 제안 생성까지가 AI의 역할이고, 실제 쓰기는 사용자의 클릭이 기존 서버 액션을 호출하는 것뿐이다. 이 성질은 ACTION BOT v1에서 이미 확립됐으며 확장에서도 유지한다.

---

## 3. 액션 매핑

`propose.ts:6`은 이미 의도를 파라미터로 번역하는 층이다(`complete` → `actualPct: 100`). 그 층을 그대로 확장한다.

| 의도 (`CommandAction`) | 서버 액션 | 상태 |
|---|---|---|
| `set_actual` / `complete` | `updateActual` | 기존 |
| `set_dates` | `updateWbsFields` | 기존 |
| **`rename`** | `updateWbsFields` | 배선만 |
| **`set_text`** (산출물·업무내용) | `updateWbsFields` | 배선만 |
| **`set_weight`** | `updateWeight` | 배선만 |
| **`create_item`** | `addWbsItem` | 배선만 |
| **`create_subact`** | `addSubAct` | 배선만 |
| **`delete_item`** | `deleteWbsItem` | 배선 + 게이트(§6) |
| **`set_owners`** | `setItemOwners` | **신규 작성**(§7.3) |

---

## 4. 후보 수집 스코프 — 기존 동작을 깨지 않는 지점

`collectCandidates`(`match.ts:7`)는 현재 **말단(자식 없는 노드)만** 수집한다. 이름 변경·삭제·생성의 부모는 Phase/Task도 대상이라 범위를 넓혀야 하지만, `set_actual`은 말단 전용을 유지해야 한다 — 롤업 부모에 실적%를 직접 넣으면 화면에도 엑셀에도 나오지 않는 유령 값이 남는다(`wbs.ts:77-81`의 불변식).

```ts
collectCandidates(items: ComputedItem[], scope: 'leaf' | 'all' = 'leaf'): CommandCandidate[]
```

**기본값을 `'leaf'`로 두는 것이 핵심이다.** 기존 호출부(`pipeline.ts`)와 기존 테스트(`tests/ai/commands-match.test.ts`)를 수정하지 않아도 그대로 통과한다.

`CommandCandidate`에 두 필드를 추가한다.

| 필드 | 용도 |
|---|---|
| `level: Level` | 생성 시 자식 레벨 추론(§5.1) |
| `childCount: number` | 삭제 게이트(§6.1), 롤업 부모 판정 |

---

## 5. 생성

### 5.1 레벨은 부모에서 결정론적으로 나온다

레벨 매핑 상수 `CHILD_LEVEL`이 현재 `RowDetailPanel.tsx:27`에 **클라이언트 컴포넌트 내부 상수**로 박혀 있다.

```ts
const CHILD_LEVEL: Record<Level, Level | null> = { phase: 'task', task: 'activity', activity: null }
```

이것을 `src/lib/domain/wbsLevel.ts`로 올려 화면과 봇이 같은 규칙을 공유하게 한다. 그러지 않으면 봇이 만든 트리와 화면이 만든 트리가 갈라진다.

| 부모 | 생성될 레벨 |
|---|---|
| 없음(루트) | `phase` |
| `phase` | `task` |
| `task` | `activity` |
| `activity` | 자식 불가 → "SUB-ACT를 추가할까요?"로 유도(`create_subact`) |

### 5.2 부모 지정

**자연어 우선, 모호하면 되묻기.** 기존 `disambiguate` 후보 칩을 그대로 재사용하므로 신규 UI 코드가 거의 없고, WBS 화면이 아닌 곳에서도 동작한다.

```
사용자: "설계 밑에 API 설계 추가해줘"

봇: 어느 항목 밑에 추가할까요?
  [ 2. 설계 단계 (Phase) ]
  [ 2.3 상세설계 (Task) ]
       ↓ 클릭
봇: 다음을 추가합니다
  부모: 2. 설계 단계
  이름: API 설계
  단계: Task
  [적용] [취소]
```

`pageContext.selectedEntity`(WBS 시트가 `WbsGanttSheet.tsx:211`에서 이미 전송 중)는 **후보 정렬 힌트로만** 쓴다. 자동 선택은 하지 않는다 — 잘못된 부모 밑에 조용히 생기는 것보다 한 번 묻는 편이 낫다.

단, `/api/chat/command`가 현재 `pageContext`를 받지 않으므로(요청 본문이 `projectId`/`message`/`targetId`뿐) 전달 배선이 필요하다.

### 5.3 `code` 필드 주의

`addWbsItem`은 `code`를 이름의 첫 토큰에서 뽑는다(`wbs.ts:216`).

```ts
const code = name.trim().split(/[.\s]/)[0] || level
```

WBS 번호 체계를 따르지 않는 임시 로직이므로, 챗봇 생성 시에도 동일하게 동작한다는 사실을 확인 카드에 드러내거나 별도 규칙을 정해야 한다.

---

## 6. 삭제

### 6.1 3중 게이트

1. **하위가 있으면 거부.** `childCount > 0` → "하위 N개를 먼저 정리하세요" + 항목 링크
2. **루트 Phase 거부.** 사유는 §6.3
3. **cascade 영향 실측 표시.** 새 읽기 함수 `countCascadeImpact(itemId)`로 첨부·이력·의존성 건수를 세어 확인 카드에 노출

```
사용자: "API 설계 삭제해줘"

봇: 삭제합니다 — 되돌릴 수 없습니다
  항목: 2.3.1 API 설계
  담당: SI 주관 · 실적 40%
  함께 삭제: 첨부 2건, 변경이력 7건
  [삭제] [취소]

---
사용자: "설계 단계 삭제해줘"

봇: 2. 설계 단계는 하위 12개를 가지고 있어 챗봇으로 지울 수 없습니다.
    WBS 화면에서 삭제해 주세요. → [항목 열기]
```

### 6.2 cascade 범위

`wbs_items` 한 행을 지우면 다음이 함께 사라진다.

| 테이블 | FK 선언 | 결과 |
|---|---|---|
| `wbs_items` (자식) | `0001_init.sql:27` | 하위 트리 전체 |
| `item_owners` | `0001_init.sql:44` | 담당 배정 |
| `change_logs` | `0001_init.sql:60` | **그 항목의 변경 이력 전부** |
| `attachments` | `0008_attachments.sql:18` | 첨부 행(스토리지 파일은 고아로 남음) |
| `task_dependencies` | `0029_task_dependencies.sql:24,26` | 연결된 선후행 관계 |

### 6.3 감사 추적이 구조적으로 불가능하다는 문제

`change_logs.wbs_item_id`가 `on delete cascade`이므로 **항목에 삭제 이력을 남기면 그 이력도 함께 지워진다.** `deleteWbsItem`이 `change_logs`를 남기지 않는 것은 실수가 아니라 구조상 불가능해서다. 되돌리기도 없다.

**권장 우회안:** 삭제 사실을 **부모 항목의 `change_logs`** 에 기록한다.

```
field:     'child_deleted'
old_value: '<코드> <이름>'
new_value: null
```

부모는 살아남으므로 흔적이 남는다. **루트 Phase 삭제를 금지하는 이유가 바로 이것이다** — 기록할 부모가 없다.

> 이 거래(감사 추적을 얻고 루트 Phase 삭제를 포기)를 받아들일지는 §0의 추후 결정 항목이다.

### 6.4 적용 직전 재검증

확인 카드가 떠 있는 동안 다른 사용자가 하위 항목을 추가했을 수 있다. 삭제 적용 직전에 서버에서 `childCount`와 이름을 재조회해 다시 검증한다.

---

## 7. 수정

### 7.1 배선만 하면 되는 것

| 대상 | 서버 액션 | 비고 |
|---|---|---|
| 이름 | `updateWbsFields` | 이름을 바꿔도 `code`는 그대로다(생성 시에만 이름에서 도출). 주간보고·PPT가 이름을 참조한다. |
| 산출물·업무내용 | `updateWbsFields` / `updateDeliverable` | 롤업·진척률에 영향이 없어 가장 안전하다. |
| 가중치 | `updateWeight` | §7.2 참조 |

### 7.2 가중치의 파급

가중치를 바꾸면 해당 항목뿐 아니라 **상위 전체와 대시보드 진척률이 조용히 재계산된다.** 확인 카드에 영향받는 상위 진척률의 전/후를 함께 보여주지 않으면 사용자가 파급을 인지하지 못한 채 승인하게 된다.

### 7.3 담당팀 변경 — 신규 서버 액션

`item_owners`를 편집하는 서버 액션이 **존재하지 않는다.** 담당을 만드는 코드는 `addSubAct`가 SUB-ACT를 생성할 때 넣는 것뿐이다. 따라서 새로 작성한다.

```ts
setItemOwners(
  itemId: string,
  owners: { team: TeamCode; kind: OwnerKind }[],
): Promise<{ ok: boolean; error?: string }>
```

- PMO 전용(`0002_rls.sql`의 `pmo_write_owners`가 `for all`로 이미 커버 — **마이그레이션 불필요**)
- 팀은 런타임 팀 마스터(`teams` 테이블, 0044)에서 해석한다. `TeamCode`는 `string`이므로 하드코딩 금지
- `change_logs`에 `field: 'owners'`로 전/후를 기록
- 담당 변경은 **해당 팀의 실적 입력 권한과 주간보고 귀속을 함께 옮긴다** — 확인 카드에 그 사실을 명시

**SUB-ACT는 담당 변경을 거부한다.** SUB-ACT 이름이 `{ACT명} ({팀} 주관/지원)` 규칙(`src/lib/domain/subact.ts`의 `subActName`)에 묶여 있어, 담당만 바꾸면 이름과 실제 담당이 어긋나고 엑셀 내보내기 → 재임포트 라운드트립에서 깨진다. 챗봇에서는 거부하고 화면으로 안내한다.

---

## 8. 권한

### 8.1 3중 방어

| 선 | 위치 | 내용 |
|---|---|---|
| 1선 (신규) | `/api/chat/command` | `getMembership()`으로 `pmo_admin` 확인. 아니면 제안 카드를 **아예 만들지 않는다** |
| 2선 (기존) | 서버 액션 | 각 액션 첫머리의 role 체크 |
| 3선 (기존) | RLS | `pmo_write_items` / `pmo_write_owners` (`0002_rls.sql:29`) |

1선이 필요한 이유는 UX다. 지금 구조로 확장하면 비PMO 사용자가 "삭제해줘"라고 했을 때 확인 카드까지 띄운 뒤 "권한 없음"을 뱉는다. 게이트를 앞으로 당겨 애초에 카드를 만들지 않는다. 물론 1선은 편의일 뿐이고 실제 보안 경계는 2·3선이다 — 챗봇은 서버 액션을 우회할 수 없다.

### 8.2 발견된 기존 구멍

`/api/chat/command`는 `getSession()`만 확인하고 **요청된 `projectId`에 접근 권한이 있는지 검사하지 않는다.** `getComputedWbs(projectId)`를 그대로 호출하며 RLS에만 의존하는데, `read_all_items` 정책이 `using (true)`(`0002_rls.sql:21`)라 인증 사용자는 모든 프로젝트를 읽을 수 있다.

챗봇 v2 경로는 `validateChatProjectScope`로 `allowedProjectIds` 교집합을 검사한다(`src/lib/ai/chat/access-scope.ts`). 명령 경로에도 같은 검사를 넣어야 한다.

> 현재는 명령 경로가 조회 전용(제안 생성)이라 영향이 제한적이다. 그러나 **쓰기 확장은 이 구멍 위에 얹히는 셈**이므로 함께 메우기를 권장한다. 범위 포함 여부는 §0의 추후 결정 항목이다.
>
> 참고: 전 프로젝트 읽기 허용은 이 제품의 의도된 정책이므로(모든 인증 사용자가 모든 프로젝트를 본다), 이 항목은 "제품 정책 변경"이 아니라 "챗봇 두 경로의 일관성 확보"다.

---

## 9. 확인 카드 만료

`updateActual`만 낙관적 잠금(`expectedCurrent`)을 갖고 있고 나머지 필드에는 없다. 전 필드에 낙관적 잠금을 도입하는 것은 범위가 과하므로 다음으로 갈음한다.

- 제안에 **TTL 3분.** 만료되면 "다시 말씀해 주세요"
- **삭제만** 적용 직전 서버 재검증(§6.4)

---

## 10. 파일별 변경 목록

### 신규

| 경로 | 내용 |
|---|---|
| `src/lib/domain/wbsLevel.ts` | `CHILD_LEVEL` 이동(화면·봇 공유) |
| `src/app/actions/wbsOwners.ts` | `setItemOwners` |

### 수정

| 경로 | 내용 |
|---|---|
| `src/lib/ai/commands/types.ts` | `CommandAction` 확장, `CommandCandidate`에 `level`·`childCount` |
| `src/lib/ai/commands/cue.ts` | 쓰기 동사 확장(추가/등록/삭제/이름/담당/가중치), 조회 오탐 방지 유지 |
| `src/lib/ai/commands/parse.ts` | 신규 의도 파싱. 결정형 정규식 우선 유지 |
| `src/lib/ai/commands/match.ts` | `scope` 인자 추가(기본 `'leaf'`) |
| `src/lib/ai/commands/propose.ts` | 신규 의도 → 파라미터 번역, 삭제 게이트 |
| `src/lib/ai/commands/pipeline.ts` | 의도별 스코프 선택 |
| `src/app/api/chat/command/route.ts` | 권한 1선, 프로젝트 스코프 검사, `pageContext` 수신 |
| `src/components/chat/DkBot.tsx` | 적용 스위치 확장, 확인 카드(cascade 영향·TTL) |
| `src/components/wbs/RowDetailPanel.tsx` | `CHILD_LEVEL` 이동에 따른 import 변경 |

**마이그레이션 없음.**

---

## 11. 테스트 전략

파이프라인이 전부 순수 함수라 대부분 vitest로 덮인다.

| 대상 | 내용 |
|---|---|
| `cue` | 신규 동사 추가 후 **조회 오탐 회귀**가 핵심. 기존 `tests/ai/commands-cue.test.ts` 확장 |
| `parse` | 생성·삭제·이름·담당 파싱. 결정형 우선 유지(Gemini 무료 티어 RPM 20 — [dkbot.md](../dkbot.md) 참조) |
| `match` | `scope` 기본값 `'leaf'` 회귀, `'all'` 동작 |
| 레벨 추론 | `CHILD_LEVEL` 전 경로 |
| 삭제 게이트 | 하위 있음·루트 Phase·cascade 카운트 |
| `propose` | 신규 의도별 확인 카드 내용 |
| 권한 게이트 | 라우트 레벨(비PMO는 제안 미생성) |

**실제 쓰기 검증:** 프로덕션 Supabase 안에 버림용 샘플 프로젝트를 하나 만들고 거기서만 생성 → 수정 → 삭제 라운드트립 스모크를 돌린다. 운영 D-CUBE 데이터는 손대지 않는다(`CLAUDE.md` 데이터 규칙). 로컬 dev도 프로덕션 Supabase를 공유하므로 이 격리가 유일한 안전장치다.

---

## 12. 비범위 (YAGNI 합의)

- 다건 일괄 처리("설계 단계 전부 완료처리")
- 순서 이동(`moveWbsItem`)
- 의존성 추가·삭제(`addTaskDependency` / `removeTaskDependency`)
- 하위가 있는 항목의 삭제
- 루트 Phase 삭제
- 되돌리기(undo)

---

## 13. 재개 시 확인할 것

1. §0의 추후 결정 3건
2. 이 문서의 `file:line` 인용은 2026-07-29 기준이다. 병렬 세션이 많은 저장소이므로 착수 전 현재 코드와 대조할 것
3. `docs/superpowers/specs/`에 MVP 스펙을 따로 쓸지, 이 문서를 정본으로 삼을지
