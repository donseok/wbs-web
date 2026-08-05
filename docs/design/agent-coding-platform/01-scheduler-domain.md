# 설계자 A — 스케줄러 · 작업 도메인

작성 2026-08-05 · 킥오프 `00-kickoff.md` §5 설계자 A 항목에 대한 응답 · 상태 **초안(설계만, 코드 무접촉)**

---

## 1. 요약

1. **상태를 늘리지 않는다.** 기존 5상태(`ready/claimed/reported/approved/cancelled`, `src/lib/domain/agentWork.ts:14-20`)는 "누가 원장을 쥐고 있나"(소유권)를 나타낸다. 테스트→검증→디버깅→배포는 그 안의 "어디까지 갔나"(진행)이므로 **직교 축 `stage`** 로 넣는다. 상태를 12개로 늘리면 CAS·라우트·테스트 전부가 깨진다. 신규 상태는 `blocked` 하나뿐이다.
2. **일정 트리거는 이미 있는 자산 위에 얹는다.** `task_dependencies`(FS/SS·lag, 0029)와 `computeDependencySchedule`(CPM·임계경로·총여유·지연, `src/lib/domain/dependencySchedule.ts:111`)이 이미 프로덕션에 있다. 스케줄러는 이것을 **읽기만** 하고 새 일정 엔진을 만들지 않는다.
3. **멱등성은 `trigger_key` 유니크 한 줄로 산다.** `sched:{wbs_item_id}:{정규화된 계획시작일}` 을 유니크 제약으로 걸면 크론 중복 실행·재시도·다중 인스턴스가 전부 무해해진다. MySQL의 "유니크는 NULL을 무시한다"가 여기서 정확히 유리하게 작동한다(수동 발행은 NULL).
4. **"스스로 찾아서 수행"은 큐에서 고르는 것까지다.** 큐가 비었을 때 에이전트가 할 일을 **창작하지 않는다** — 발행 후보를 제안할 뿐이다. 기존 루프의 "루프는 실적만 만진다"(스펙 §4-2) 경계와 같은 급의 안전장치이고, 폭주 위험의 대부분이 여기서 사라진다.
5. **폭주 방지는 단일 상한이 아니라 5중이다** — 동시 점유·tick당 발행·일일 발행·항목당 재시도·항목당 총 주문. 무료 LLM 실행 엔진(설계자 B)의 실패율이 미지수라 **실패가 비용을 만드는 경로를 전부 막아야** 한다.

---

## 2. 확인한 기존 자산 (근거 실측)

킥오프 §2가 지목한 자산을 전부 열어 확인했다. 아래는 **코드로 확인한 사실만**이다.

| 확인한 것 | 근거 |
|---|---|
| 상태 전이표 5상태·`approved`/`cancelled`는 종단 | `src/lib/domain/agentWork.ts:14-24` |
| `progress`는 0~99만, 100은 400 (완료를 승인 경로로 강제) | `src/lib/domain/agentWork.ts:27-35` |
| 스테일 판정 기준 24시간, **판정만 하고 자동 회수는 없음** | `src/lib/domain/agentWork.ts:8,37-42` |
| ready 목록 정렬 = `priority desc, created_at asc` (그게 전부다) | `src/app/api/v1/agent/work/route.ts:23-24` |
| claim은 조건부 UPDATE + 영향행수 검사 = CAS | `src/app/api/v1/agent/work/[id]/claim/route.ts:24-31` |
| 보고는 `claimed` + `claimed_by` 일치일 때만 | `.../report/route.ts:54-59` |
| completion은 보고 insert 선행 → CAS 전이 → 실패 시 보고행 cleanup | `.../report/route.ts:76-110` |
| release는 본인 점유만, 남의 점유 회수는 사람 몫 | `.../release/route.ts:22-30` |
| progress의 WBS 반영: 선행조회 실패=중단, 동일값 단락, **자식 있으면 거부** | `src/lib/agent/applyProgress.ts:20-33` |
| 게이트 3겹: env(`AGENT_API_ENABLED`+시크릿)→404, 시크릿 불일치→401, 미등록 프로젝트→404 | `src/lib/agent/externalApi.ts:10-48` |
| 권한은 기존 3단 축 재사용, 조회 실패는 fail-closed | `src/lib/agent/externalApi.ts:54-71` |
| **주문 발행은 사람 전용**(`requireProjectAdmin`) + 등록 게이트 + 리프 검증 | `src/app/actions/agentWork.ts:45-85` |
| 승인 = `updateActual(100)` 먼저, 그 뒤 CAS. 반려 경합을 명시적으로 알림 | `src/app/actions/agentWork.ts:104-153` |
| 회수(`reclaimAgentOrder`)는 **사람이 누르는 버튼**이다 | `src/app/actions/agentWork.ts:188-202` |
| 원장 테이블 3종 DDL·인덱스·RLS(조회만, 쓰기 service_role) | `supabase/migrations/0057_agent_work_loop.sql:10-89` |
| `task_dependencies` 존재: FS/SS, `lag_days` 0~365, 자기참조·교차프로젝트·순환 차단 트리거, 프로젝트 advisory lock | `supabase/migrations/0029_task_dependencies.sql:12-108` |
| 의존성 쓰기 RLS는 0053에서 `is_project_admin`으로 교체됨(0029의 `memberships.role='pmo_admin'`은 대체됨 — deprecated 축 드리프트 아님) | `supabase/migrations/0053_project_scoped_rls.sql:130-133` |
| CPM 계산기 존재: `critical`·`totalFloatBusinessDays`·`delayDays`·`overdue`·`forecastEnd`·`drivenBy` | `src/lib/domain/dependencySchedule.ts:14-50,238-341` |
| 영업일·휴일 계산: `holidays(project_id, date)` + `isBusinessDay`/`shiftBusinessDays` | `supabase/migrations/0001_init.sql:50-55`, `src/lib/domain/dates.ts:19-32`, `dependencySchedule.ts:83-93` |
| '오늘'의 단일 출처는 `seoulToday()` — **Asia/Seoul 하드코딩**, 설정화는 P7 미착수 | `src/lib/domain/dates.ts:14-16` |
| `project_settings`에 `timezone`·`working_days` 컬럼은 **있으나 읽지 않는다**고 명시됨 | `supabase/migrations/0058_project_settings.sql:16-19` |
| 현재 크론은 **0건**(`crons: []`). 직전까지 위키 워커가 하루 1회 있었다 | `vercel.json`, `git show 9cf7ff5^:vercel.json` |
| 크론 인증 관례: Vercel Cron은 `Authorization: Bearer <CRON_SECRET>`, 수동은 `x-cron-secret`, 비활성은 404 은닉 | `src/app/api/wiki/worker/route.ts:27-40` |
| 롤업 부모는 저장하지 않는다 — 두 쓰기 경로 모두 자식 있는 항목을 거부한다(파생 계산) | `src/app/actions/wbs.ts:88-92`, `src/lib/agent/applyProgress.ts:29-32` |

> 킥오프 §2의 "progress 보고(WBS 실적+부모 롤업)" 표현에 대해: **부모 롤업은 저장되지 않는다.** 리프 실적만 쓰고 부모는 읽을 때 계산된다. 스케줄러가 롤업을 위해 따로 할 일은 없다.

---

## 3. 일정 트리거 모델

### 3.1 무엇을 기준으로 착수하는가

자동 발행 후보의 **전건 충족 조건**(하나라도 어긋나면 발행하지 않는다):

| # | 조건 | 근거·비고 |
|---|---|---|
| T1 | 프로젝트가 `agent_projects`에 등록·`enabled` | 기존 게이트 그대로(`externalApi.ts:43-48`) |
| T2 | 프로젝트의 **자동 발행 옵트인**이 켜짐 | 신규. 기본값 **꺼짐**(§7-1) |
| T3 | 항목이 **리프** (자식 없음) | 기존 발행 검증과 동일(`actions/agentWork.ts:68-71`). 롤업 부모에 실적을 쓸 수 없으므로 물리적으로도 강제된다 |
| T4 | `actual_pct < 100` | 이미 끝난 일을 다시 시키지 않는다 |
| T5 | `normalize(planned_start) <= today(KST)` | `planned_start`가 주말·휴일이면 `shiftBusinessDays(start, 0, holidays)`로 **다음 영업일로 정규화**한 뒤 비교 |
| T6 | 선행 의존성 충족 | FS: 모든 선행의 `actual_pct = 100` **이고** `shiftBusinessDays(선행 종료, lag+1) <= today`. SS: 모든 선행이 착수(`actual_pct > 0` 또는 해당 주문이 claimed 이상) |
| T7 | 그 항목에 **활성 주문이 없음** (`ready`/`claimed`/`reported`/`blocked`) | 중복 착수 방지 |
| T8 | `trigger_key` 미사용 | 멱등성(§3.3) |
| T9 | 항목당 총 자동 주문 수 < 상한(기본 3) | 반려 무한루프 차단(§5.4) |
| T10 | 이번 tick·오늘의 발행 상한 미초과 | 폭주 방지(§5.4) |

**의도적으로 조건에서 뺀 것**:
- `forecastEnd`·`critical` 같은 **파생 예측값은 트리거 조건에 쓰지 않는다.** 예측은 `actual_pct`의 함수인데(`dependencySchedule.ts:264-270`) 그 `actual_pct`를 에이전트가 다시 쓴다 — 트리거 조건에 넣으면 자기 출력이 자기 입력이 되는 진동 루프가 된다. **선택 순위(§5)에만 쓰고 착수 여부(§3)에는 쓰지 않는다.**
- 담당 팀(`item_owners`) 일치. 에이전트는 팀이 아니다. 대신 실행 책임자 `user_email`의 권한 판정을 기존대로 유지한다.

### 3.2 지연·휴일·타임존

**휴일** — 프로젝트 단위 `holidays`가 이미 있고, 의존성 트리거(0029:71-87)도 "계획 기간에 영업일이 없으면 연결 거부"까지 하고 있다. 스케줄러는 이 테이블을 그대로 읽는다. **주말 정의(토·일)는 `isWeekendDow` 단일 출처**(`dates.ts:10-12`)를 따르고 두 번째 정의를 만들지 않는다.

**타임존** — `seoulToday()`가 Asia/Seoul 하드코딩이고 `project_settings.timezone`은 정의만 되어 있고 읽히지 않는다(0058:19 주석). 스케줄러도 **KST 고정**으로 간다(§7-8). 크론은 UTC로 돌더라도 '오늘' 판정은 반드시 KST로 한다 — 이걸 틀리면 매일 09:00 KST 이전 tick이 어제 날짜로 판정해 하루 늦게 발행된다.

**지연(과거 계획일) = 최대 위험 지점.** 자동 발행을 켜는 순간 `planned_start`가 이미 지난 미완료 리프가 **전부** 후보가 된다. D-CUBE급 WBS라면 수십~수백 건이다. 대응:

- **lookback 창** — `today - N영업일` 보다 오래된 계획일은 자동 발행하지 않는다(기본 N=14). 대신 "밀린 후보" 목록으로 관제 화면에 띄우고 사람이 골라 수동 발행한다.
- **최초 활성화 드라이런** — 옵트인을 켠 직후 첫 tick은 **발행하지 않고 후보 목록만 기록**한다(`agent_schedule_runs.mode='dryrun'`). 사람이 목록을 보고 확인해야 실제 발행이 시작된다. 켜자마자 200건이 나가는 사고를 원천 차단한다.

### 3.3 중복 발행 방지 (멱등성)

```
trigger_key = 'sched:' || wbs_item_id || ':' || normalized_planned_start   -- 자동
trigger_key = NULL                                                        -- 수동 발행
UNIQUE KEY uq_trigger (trigger_key)
```

- 크론이 겹쳐 돌든, tick이 중간에 죽어 재시도되든, 인스턴스가 둘이든 **두 번째 INSERT는 중복키로 죽고 그걸 정상으로 취급한다**(에러가 아니라 "이미 발행됨").
- MySQL의 유니크 인덱스는 NULL을 중복으로 보지 않는다 → 수동 발행은 몇 건이든 자유. **원하는 동작이 타입 시스템으로 강제된다.**
- **계획일이 바뀌면 키가 바뀌어 재발행된다.** 이건 의도다(일정 재계획 = 새 착수). 다만 계획일을 자주 흔드는 프로젝트에서는 재발행 폭주가 되므로 T9(항목당 총 자동 주문 상한)가 2차 방어선이다.
- tick 자체의 동시 실행은 락으로 막는다: PG `pg_advisory_xact_lock`(0029:50이 이미 쓰는 패턴)의 MySQL 대응물은 **`GET_LOCK('agent_tick:'||project_id, 0)`** 이다. 커넥션 종속이라 **커넥션 풀에서 획득/해제를 같은 커넥션으로 묶어야 한다** — 풀러 뒤에서 이걸 놓치면 락이 영원히 안 풀린다.

### 3.4 tick 실행 주체

```
[스케줄러 tick]  (크론 → HTTPS, CRON_SECRET Bearer, 비활성 시 404 은닉)
   1. GET_LOCK(project)  실패 → 즉시 종료(다른 tick이 돌고 있다)
   2. 스테일 lease 회수   (§6.3)
   3. 후보 산출 T1~T10   (읽기 전용: wbs_items·task_dependencies·holidays·agent_work_orders)
   4. 발행               (INSERT … 중복키는 정상 스킵)
   5. agent_schedule_runs 에 감사 기록(후보 수·발행 수·스킵 사유별 집계)
   6. RELEASE_LOCK
```

- 인증·은닉은 위키 워커 관례를 그대로 상속한다(`api/wiki/worker/route.ts:27-40`) — 새로 발명하지 않는다.
- **tick은 절대 LLM을 부르지 않는다.** 순수하게 DB 읽고 쓰는 결정론적 함수다. 무료 티어 RPM 예산 영향 0(기존 스펙 §6의 원칙 유지).
- 주기 권고: **10분**. 계획일은 날짜 단위라 10분이면 충분하고, 스테일 회수 응답성도 확보된다.

---

## 4. 작업 상태 머신

### 4.1 왜 상태를 늘리지 않는가

킥오프 §5는 "대기→발행→claim→개발→테스트→검증→디버깅→배포→완료/반려"를 요구한다. 이걸 그대로 `status` ENUM으로 만들면 상태가 11개가 되고, 기존 CAS 5곳·API 계약·도메인 테스트가 전부 재작성 대상이 된다. 그런데 **테스트/검증/디버깅/배포는 소유권이 바뀌지 않는다** — 내내 같은 에이전트가 쥐고 있다. 소유권이 바뀌는 지점은 claim(사람→에이전트), completion(에이전트→사람), 승인/반려(사람→종료 또는 에이전트)뿐이다.

→ **`status`(소유권) × `stage`(진행)** 2축.

```
status:  ready → claimed → reported → approved
                    ↕                    ↘ (반려)
                  ready/blocked      cancelled
stage(claimed 동안만): dev → test → verify → debug → deploy → awaiting_approval
```

### 4.2 전이표

| 전이 | 주체 | 조건 | 되돌림 |
|---|---|---|---|
| (없음) → `ready` | **스케줄러 tick** (신규) 또는 사람 | T1~T10 전건 / 사람은 기존대로 관리자 | `cancelled` |
| (없음) → `ready` | 사람(관리자) | 기존 `createAgentWorkOrder` 그대로 | `cancelled` |
| `ready` → `claimed` | 에이전트 | CAS(`status='ready'`) + 자원키 배타(§6.2) + 동시 점유 상한 | `release` |
| `claimed` → `claimed` (stage 전진) | 에이전트 | 단계 게이트 통과 보고. `dev→test→verify→debug→deploy` 순방향 + `debug→test` 역방향만 | stage 되감기는 `debug→test`만 허용 |
| `claimed` → `ready` | 에이전트(release) / 사람(회수) / **tick(lease 만료)** | 본인 점유만(에이전트). tick 회수는 `reclaim_count < 상한` | 재claim |
| `claimed` → `blocked` | 에이전트(포기 선언) / tick(재시도 소진·회수 상한 초과) | `attempt_count >= 상한` 또는 명시적 포기 | 사람만 `blocked→ready` |
| `blocked` → `ready` | **사람만** | 사유 확인 후 해제. `attempt_count` 리셋 여부는 사람이 선택 | — |
| `claimed` → `reported` | 에이전트 | `stage='deploy'` 완료 + completion 보고. CAS + 보고행 선행 insert(기존 구현 그대로) | 반려 |
| `reported` → `approved` | **사람(관리자)** | WBS 100% 반영 성공이 선행 | 없음(종단) |
| `reported` → `claimed` | 사람(관리자, 반려) | 사유 필수. stage는 `debug`로 되감는다 | 재보고 |
| any(ready/claimed/reported/blocked) → `cancelled` | 사람(관리자) | — | 없음(종단) |

**변경점 요약** — 기존 전이표(`agentWork.ts:14-20`) 대비: ① `blocked` 추가 ② `ready` 진입에 tick 주체 추가 ③ `claimed→ready`에 tick 주체 추가(현재는 자동 회수 없음, 스펙 §8에서 명시적 비범위였다) ④ stage 축 신설. **기존 전이는 하나도 삭제하지 않는다.**

### 4.3 stage 게이트와 completion 정의 변경

기존 계약에서 `completion`은 "구현했다"였다(하네스가 빌드·테스트를 돌려 summary에 넣는 것은 권고 사항, API 계약 §5). 확장 파이프라인에서는 **`completion` = "배포까지 끝났다"** 로 의미가 바뀐다.

- stage 전진은 `agent_stage_events`에 **증적과 함께** 기록한다(테스트 통과 수, 로그 요약, 커밋/PR/배포 URL). 승인자가 보는 것은 이 타임라인이다.
- **중간 stage 전진은 WBS 실적을 건드리지 않는다.** 실적 반영은 지금처럼 `progress` 보고에서만 일어난다. stage와 percent를 자동 연동(예: test 통과=70%)하고 싶은 유혹이 있지만, **stage는 사실이고 percent는 주장**이다. 섞으면 진척률이 파이프라인 구현 디테일에 종속된다. 권고: 연동하지 않는다.
- `progress`의 0~99 제약과 **"실패 시 progress 0을 보고하지 않는다"** 규약(API 계약 §5, `applyProgress`가 즉시 `actual_pct`를 덮어쓴다)은 확장 파이프라인 전 구간에 그대로 상속된다. 테스트 실패·배포 실패도 **progress가 아니라 stage 이벤트 + 필요 시 release/blocked**로 표현한다.

### 4.4 되돌림(보상)이 불가능한 지점

- `approved` 이후 WBS는 100%다. 잘못된 승인의 되돌림은 사람이 실적을 직접 고치는 것뿐 — 루프에 자동 되돌림을 만들지 않는다(실적 훼손 경로를 늘리는 쪽이 더 위험하다).
- **배포는 스케줄러가 되돌리지 않는다.** 롤백 트리거는 설계자 B 영역이며, 스케줄러는 "배포 실패" 이벤트를 받아 stage를 `debug`로 되감을 뿐이다.
- 승인/반려 경합은 기존 구현이 이미 "WBS는 100%가 됐는데 주문은 반려됨"을 명시적으로 알린다(`actions/agentWork.ts:122-138`). 이 처리를 그대로 이식한다 — 새 플랫폼에서 이 분기를 빠뜨리면 침묵하는 불일치가 생긴다.

---

## 5. 자율 다음 작업 선택 정책

### 5.1 "스스로 찾는다"의 정의 — 안전 경계

| 해석 | 판정 |
|---|---|
| A. ready 큐에서 다음 것을 고른다 | **채택.** 후보는 이미 T1~T10을 통과한 것뿐이다 |
| B. 큐가 비면 WBS를 훑어 발행 후보를 **제안**한다 | **채택(제안까지만).** 발행은 tick 또는 사람 |
| C. 큐가 비면 스스로 주문을 발행한다 | **기각.** 발행 권한은 관리자 전용(`actions/agentWork.ts:49`). 에이전트에게 주면 "내가 낸 일을 내가 하고 내 실적을 올린다"가 성립한다 |
| D. WBS에 없는 작업(리팩터링·기술부채 등)을 창작한다 | **기각.** 스펙 §4-2 "루프는 실적만 만진다"의 붕괴. WBS 구조 변경은 사람의 몫이라는 경계가 무너지면 폭주 시 복구 좌표가 사라진다 |

킥오프 §7의 "완료 100%를 사람 승인 전용으로 묶어둔 것과 같은 급의 안전장치"에 대한 답이 이것이다: **발행 권한을 에이전트에게 주지 않는 것**. 승인 게이트(출구)와 발행 게이트(입구) 양쪽을 사람이 쥐고, 에이전트는 그 사이에서만 자율적이다.

### 5.2 선택 순위 — 가중합이 아니라 사전식

가중합(`score = w1·critical + w2/float + …`)은 가중치 튜닝이 필요하고 **왜 이 작업을 골랐는지 설명할 수 없다**. 폭주·오작동 진단이 사후에 불가능해진다. 권고는 **사전식 정렬**:

1. `priority` **내림차순** — 사람이 지정한 값이 항상 최우선(기존 정렬의 1순위와 동일, `work/route.ts:24`)
2. **임계경로 여부** — `criticalTaskIds.has(id)` (`dependencySchedule.ts:331-341`)
3. **총여유 오름차순** — `totalFloatBusinessDays`
4. **지연 우선** — `overdue === true` (`plannedEnd < today && actual_pct < 100`)
5. **차단 해제 효과 내림차순** — 이 항목을 끝내면 풀리는 후속 개수(`usableOutgoing` 크기)
6. `planned_start` 오름차순 → `created_at` 오름차순(기존 tie-break 유지)

**2~5는 새로 계산하지 않는다.** `computeDependencySchedule(tasks, deps, today, holidays)` 한 번 호출이면 전부 나온다. 이 함수는 계획일을 **절대 변경하지 않는다**고 명시되어 있어(`dependencySchedule.ts:107-110`) 스케줄러가 읽어도 기준선이 오염되지 않는다.

**순위 계산은 서버(GET 목록)에서 한다.** 에이전트가 정렬 정책을 구현하면 하네스마다 정책이 갈라지고, 그때부터 "왜 이걸 먼저 했는지"를 서버가 설명할 수 없다. 서버는 정렬된 목록 + **각 항목의 선정 사유(critical/overdue/float 값)** 를 함께 내려준다.

### 5.3 사람 승인이 필요한 경계

| 지점 | 승인 필요 | 근거 |
|---|---|---|
| 완료 100% 반영 | **필요**(기존 유지) | 기존 안전장치. 유일한 실적 최종 관문 |
| 자동 발행 기능 켜기 | **필요**(프로젝트별 옵트인, 기본 off) | 켜는 순간 백로그가 쏟아진다(§3.2) |
| 최초 활성화 후 첫 실제 발행 | **필요**(드라이런 확인) | 같은 이유 |
| lookback 창 밖(오래 밀린) 항목 발행 | **필요** | 자동 발행 대상에서 제외 |
| 프로덕션 배포 | **필요**(권고, §7-3) | 되돌림 비용이 비대칭 |
| 스테이징/프리뷰 배포 | 불필요 | 실패해도 사람 부담 0 |
| `blocked` 해제 | **필요** | 같은 실패의 무한 반복 차단 |
| 상한 상향 조정 | **필요**(설정 변경 = 관리자) | — |
| stage 전진(test→verify→…) | 불필요 | 이게 자동화의 본체다 |

### 5.4 폭주 방지 상한 (5중)

| 상한 | 기본값 | 무엇을 막나 |
|---|---|---|
| 프로젝트 동시 `claimed` 수 | 3 | 병렬 에이전트가 리포를 동시에 갈아엎는 것 |
| tick당 자동 발행 수 | 5 | 한 번에 쏟아지는 것 |
| 일일 자동 발행 수 | 20 | 10분 주기 × 5건 = 하루 720건이 될 수 있다 |
| 항목당 자동 재시도(`attempt_count`) | 2 | 같은 실패의 반복. 초과 시 `blocked` |
| 항목당 총 자동 주문(`trigger_key` 세대 누적) | 3 | 반려→재작업→반려 무한루프, 계획일 흔들림에 의한 재발행 폭주 |

추가로 **전역 킬 스위치 2개**: `agent_projects.enabled=false`(기존 게이트 재사용) + `AUTO_SCHEDULE_ENABLED` env. 위키 중단 때 쓴 방식(코드 게이트 + env 이중 방어, 기본값 꺼짐)을 그대로 따른다.

상한 초과는 **조용히 스킵하지 않는다** — `agent_schedule_runs`에 사유별 카운트를 남기고 관제 화면에 "상한으로 N건 보류"를 표시한다. 조회 실패를 "데이터 없음"으로 위장하지 않는다는 3원칙의 스케줄러판이다.

---

## 6. 동시성

### 6.1 claim 경합

기존 CAS를 그대로 쓴다. MySQL에서도 성립한다:

```sql
UPDATE agent_work_orders
   SET status='claimed', claimed_by=?, claimed_at=NOW(6), lease_expires_at=NOW(6)+INTERVAL ? MINUTE
 WHERE id=? AND status='ready';
-- affected_rows = 0 → 409 (다른 에이전트가 먼저 가져갔다)
```

InnoDB의 기본 격리수준(REPEATABLE READ)에서도 `UPDATE`는 최신 커밋본을 읽고 행 잠금을 잡으므로(current read) PG의 CAS와 동치다. **단 `affected_rows`를 반드시 검사해야 한다** — 이건 supabase-js에서 `.select()`를 빠뜨리면 저장 실패가 "저장됨"으로 둔갑하는 것(`actions/wbs.ts:110-112`)과 같은 종류의 함정이다.

### 6.2 자원 경합 (같은 리포·브랜치)

claim CAS는 **같은 주문**의 중복만 막는다. 서로 다른 주문 2건이 같은 리포를 동시에 건드리는 것은 못 막는다. 격리(워크트리/컨테이너)는 설계자 B 영역이지만, **스케줄러 쪽 대응**은 필요하다:

- 주문에 `resource_key`(기본값: 프로젝트 리포 식별자, 필요 시 항목별 오버라이드)를 둔다.
- claim 시 조건에 **"같은 `resource_key`로 `claimed`인 주문이 상한 미만"** 을 추가한다. 상한 1이면 완전 직렬화, N이면 워크트리 N개 병렬.
- 이 값은 D'Flow가 리포 위치를 모른다는 관심사 분리(기존 스펙 §3.3)를 깨지 않는다 — **불투명 문자열**이고 서버는 동등성만 본다.

### 6.3 스테일 회수 — 24시간은 무인 운전에 너무 길다

현재는 24시간 경과를 **표시만** 하고 회수는 사람이 버튼을 누른다(`agentWork.ts:8`, `actions/agentWork.ts:188-202`). 사람이 옆에 있는 세션 모드 전제에서는 맞지만, 무인 루프에서는 죽은 에이전트 하나가 임계경로를 하루 막는다.

**lease 방식으로 교체**:

- claim 시 `lease_expires_at = now + LEASE`(기본 30분).
- progress 보고·stage 이벤트·명시적 heartbeat가 lease를 연장한다.
- tick이 만료된 lease를 `ready`로 회수하고 `reclaim_count++`.
- `reclaim_count`가 상한(기본 2)을 넘으면 `ready`가 아니라 **`blocked`** 로 보낸다.

⚠️ **회수의 진짜 위험**: 에이전트가 살아 있는데 lease만 만료된 경우(긴 빌드·네트워크 단절) 회수하면 **두 에이전트가 같은 작업을 동시에 수행**한다. 방어:

1. lease를 넉넉히 잡고(30분), 실행 엔진이 주기적으로 연장하게 한다.
2. 회수 후 옛 에이전트의 보고는 **`claimed_by` 불일치로 403**이 되어 자동 거부된다 — 기존 소유권 검증(`report/route.ts:57-59`)이 그대로 방어선이 된다. 이건 **이미 코드에 있는 성질**이고, 그래서 lease 회수를 안전하게 도입할 수 있다.
3. `resource_key` 배타(§6.2)가 리포 레벨 충돌을 2차로 막는다.

### 6.4 tick 자체의 동시성

§3.3의 `GET_LOCK`. 추가로 tick은 **읽기 스냅샷 → 판정 → INSERT** 순서이고, 판정과 INSERT 사이의 경합은 `trigger_key` 유니크가 흡수한다. 락은 성능 최적화(중복 계산 회피)이지 정합성의 유일한 근거가 아니다 — 락이 실패해도 데이터는 안전하다.

---

## 7. MySQL 스키마 (DDL 초안)

### 7.1 Postgres → MySQL 타입 매핑

| Postgres(현행) | MySQL 8.0 | 주의 |
|---|---|---|
| `uuid` | `CHAR(36)` (또는 `BINARY(16)`) | `CHAR(36)`+`utf8mb4_0900_ai_ci` 권고 — 디버깅 가능성이 16바이트 절약보다 크다 |
| `gen_random_uuid()` | `UUID()` (8.0) | **앱에서 생성 권고** — v4 보장·이식성. MySQL `UUID()`는 v1(시간 기반)이라 인덱스 지역성은 좋지만 MAC 노출 |
| `timestamptz` | `DATETIME(6)` + **UTC 저장 강제** | `TIMESTAMP`는 2038 한계 + 세션 TZ 의존. `DATETIME`은 TZ를 안 갖는다 → **앱이 항상 UTC로 넣는다**는 규약이 유일한 방어 |
| `date` | `DATE` | 그대로 |
| `jsonb` | `JSON` | MySQL JSON은 정렬 키 보존 안 함·부분 인덱스는 생성 컬럼 경유 |
| `text[]` | `JSON` 배열 | `project_settings.level_labels` 등 |
| `boolean` | `TINYINT(1)` | `true/false` 리터럴은 동작하나 실제는 정수 |
| `check (x in (...))` | `ENUM` 또는 `CHECK` | **CHECK는 8.0.16+ 에서만 강제된다.** 그 이전은 파싱 후 무시 → 조용한 무방비. 버전 미확정이면 `ENUM` 권고 |
| partial unique index | 없음 | **생성 컬럼 + 유니크**로 대체. 다만 `trigger_key`는 NULL 무시 성질로 partial 없이 해결된다 |
| RLS 정책 | **없음** | 조회 2차 방어선 전면 상실 → 설계자 C 판정 대상. 원장 관점 영향은 §9 |
| `pg_advisory_xact_lock` | `GET_LOCK`/`RELEASE_LOCK` | 커넥션 종속. 트랜잭션 종료로 자동 해제되지 **않는다** |
| `on delete set null` | 동일 | 감사 기록 보존 의도 유지 |

### 7.2 DDL

```sql
-- ── 게이트 (기존 agent_projects + 자동화 설정) ────────────────────────────
CREATE TABLE agent_projects (
  project_id            CHAR(36)     NOT NULL PRIMARY KEY,
  enabled               TINYINT(1)   NOT NULL DEFAULT 1,
  auto_schedule_enabled TINYINT(1)   NOT NULL DEFAULT 0,   -- 신규. 기본 꺼짐
  auto_schedule_armed   TINYINT(1)   NOT NULL DEFAULT 0,   -- 드라이런 확인 완료 여부(§3.2)
  lookback_business_days INT         NOT NULL DEFAULT 14,
  max_concurrent_claims INT          NOT NULL DEFAULT 3,
  max_publish_per_tick  INT          NOT NULL DEFAULT 5,
  max_publish_per_day   INT          NOT NULL DEFAULT 20,
  max_attempts_per_item INT          NOT NULL DEFAULT 2,
  max_orders_per_item   INT          NOT NULL DEFAULT 3,
  lease_minutes         INT          NOT NULL DEFAULT 30,
  note                  TEXT,
  created_by            CHAR(36),
  created_at            DATETIME(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at            DATETIME(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP(6)
                                     ON UPDATE CURRENT_TIMESTAMP(6),
  CONSTRAINT fk_ap_project FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- ── 작업 원장 ────────────────────────────────────────────────────────────
CREATE TABLE agent_work_orders (
  id            CHAR(36) NOT NULL PRIMARY KEY,
  project_id    CHAR(36) NOT NULL,
  wbs_item_id   CHAR(36) NULL,                       -- 항목 삭제 후에도 원장 보존
  status        ENUM('ready','claimed','reported','approved','cancelled','blocked')
                NOT NULL DEFAULT 'ready',
  stage         ENUM('dev','test','verify','debug','deploy','awaiting_approval')
                NOT NULL DEFAULT 'dev',              -- 신규. status='claimed' 동안만 의미
  origin        ENUM('manual','schedule') NOT NULL DEFAULT 'manual',   -- 신규
  trigger_key   VARCHAR(128) NULL,                   -- 신규. 자동 발행 멱등키. 수동은 NULL
  instructions  TEXT     NOT NULL,
  priority      INT      NOT NULL DEFAULT 0,
  resource_key  VARCHAR(128) NULL,                   -- 신규. 리포/브랜치 배타 키(불투명)
  claimed_by    VARCHAR(64) NULL,
  claimed_at    DATETIME(6) NULL,
  lease_expires_at DATETIME(6) NULL,                 -- 신규
  attempt_count INT      NOT NULL DEFAULT 0,         -- 신규
  reclaim_count INT      NOT NULL DEFAULT 0,         -- 신규
  blocked_reason TEXT    NULL,                       -- 신규
  created_by    CHAR(36) NULL,
  created_at    DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at    DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6)
                             ON UPDATE CURRENT_TIMESTAMP(6),
  UNIQUE KEY uq_awo_trigger (trigger_key),           -- NULL 다중 허용 = 수동은 무제한
  KEY idx_awo_project_status (project_id, status),
  KEY idx_awo_item (wbs_item_id),
  KEY idx_awo_lease (status, lease_expires_at),      -- 회수 스캔용
  KEY idx_awo_resource (resource_key, status),
  CONSTRAINT fk_awo_project FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  CONSTRAINT fk_awo_item    FOREIGN KEY (wbs_item_id) REFERENCES wbs_items(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- ── 보고 이력 (기존과 동형) ───────────────────────────────────────────────
CREATE TABLE agent_work_reports (
  id             CHAR(36) NOT NULL PRIMARY KEY,
  work_order_id  CHAR(36) NOT NULL,
  kind           ENUM('progress','completion') NOT NULL,
  percent        INT NOT NULL,                       -- 앱이 0~99/100 강제(agentWork.validateReport)
  summary        TEXT NOT NULL,
  links          JSON NOT NULL,                      -- [{url,label}] 최대 20
  agent          VARCHAR(64) NOT NULL,
  actor_user_id  CHAR(36) NULL,
  applied_to_wbs TINYINT(1) NOT NULL DEFAULT 0,
  review_action  ENUM('approve','reject') NULL,
  reviewed_by    CHAR(36) NULL,
  reviewed_at    DATETIME(6) NULL,
  review_note    TEXT NULL,
  created_at     DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  KEY idx_awr_order (work_order_id, created_at),
  CONSTRAINT fk_awr_order FOREIGN KEY (work_order_id)
    REFERENCES agent_work_orders(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- ── 실행 이력: stage 전이 감사 (신규) ─────────────────────────────────────
CREATE TABLE agent_stage_events (
  id            BIGINT AUTO_INCREMENT PRIMARY KEY,
  work_order_id CHAR(36) NOT NULL,
  from_stage    VARCHAR(24) NULL,
  to_stage      VARCHAR(24) NOT NULL,
  outcome       ENUM('pass','fail','skip','abort') NOT NULL,
  detail        TEXT NULL,          -- 테스트 요약·실패 로그 발췌(길이 상한은 앱이 강제)
  agent         VARCHAR(64) NOT NULL,
  created_at    DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  KEY idx_ase_order (work_order_id, created_at),
  CONSTRAINT fk_ase_order FOREIGN KEY (work_order_id)
    REFERENCES agent_work_orders(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- ── 산출물 (신규. 링크 + 요약 중심 — 파일 업로드 없음, 기존 결정 ⑤ 유지) ──
CREATE TABLE agent_artifacts (
  id            BIGINT AUTO_INCREMENT PRIMARY KEY,
  work_order_id CHAR(36) NOT NULL,
  kind          ENUM('commit','pr','build','test_report','deployment','other') NOT NULL,
  url           VARCHAR(1024) NOT NULL,
  label         VARCHAR(255) NULL,
  created_at    DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  KEY idx_aa_order (work_order_id),
  CONSTRAINT fk_aa_order FOREIGN KEY (work_order_id)
    REFERENCES agent_work_orders(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- ── tick 감사 (신규). "왜 오늘 아무것도 발행 안 됐나"에 답하는 유일한 근거 ──
CREATE TABLE agent_schedule_runs (
  id             BIGINT AUTO_INCREMENT PRIMARY KEY,
  project_id     CHAR(36) NOT NULL,
  mode           ENUM('dryrun','live') NOT NULL,
  started_at     DATETIME(6) NOT NULL,
  finished_at    DATETIME(6) NULL,
  candidates     INT NOT NULL DEFAULT 0,
  published      INT NOT NULL DEFAULT 0,
  reclaimed      INT NOT NULL DEFAULT 0,
  skipped        JSON NOT NULL,   -- {"dep_unmet":3,"cap_daily":2,"lookback":11,...}
  error          TEXT NULL,
  KEY idx_asr_project (project_id, started_at),
  CONSTRAINT fk_asr_project FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
```

**승인은 새 테이블을 만들지 않는다** — 기존처럼 `agent_work_reports.review_action/reviewed_by/reviewed_at/review_note`에 기록한다(`0057:47-50`). 승인이 보고에 붙어 있는 것이 맞다: 승인은 "이 보고를 인정한다"이지 독립 사건이 아니다.

**기존 Postgres 스키마와의 매핑**: `agent_projects`·`agent_work_orders`·`agent_work_reports` 3종은 컬럼명·의미가 1:1 대응한다(위 DDL에서 "신규" 표시 없는 컬럼 전부). 마이그레이션이 필요하다면 3종은 값 그대로 복사 가능하고, 신규 컬럼은 기본값으로 채워진다 — 즉 **기존 데이터를 옮겨도 옛 루프의 동작이 그대로 재현된다**. 다만 실제로 옮길지는 설계자 C의 마이그레이션 경로 판정 대상이다.

**스케줄러가 읽는 기존 테이블**(전부 읽기 전용): `wbs_items`(`parent_id`·`planned_start`·`planned_end`·`actual_pct`·`code`·`name`·`biz`·`deliverable`), `task_dependencies`, `holidays`, `projects`, 권한 축(`memberships.is_superuser`·`project_roles`). **쓰기는 리프의 `actual_pct` + `change_logs` + 스냅샷 3종 세트뿐**이고, 그 경로는 기존 `applyAgentProgress`와 동일하다.

---

## 8. 기존 `agentWork` 도메인 — 재사용 / 변경

### 8.1 그대로 가져가는 것 (재검토하지 않는다)

| 항목 | 근거 |
|---|---|
| `canTransition` 전이표 구조와 종단 상태 개념 | `agentWork.ts:14-24` |
| `validateReport` — progress 0~99, completion=100, 100 직접 쓰기 금지 | `agentWork.ts:27-35`. **자율 루프의 마지막 안전장치** |
| CAS 패턴(조건부 UPDATE + 영향행수 검사) | claim/release/completion 3곳 |
| 소유권 검증(`claimed_by` 일치) → 403 `not_claim_owner` | `report/route.ts:57-59`. lease 회수를 안전하게 만드는 핵심 성질(§6.3) |
| completion의 보고 선행 insert → CAS → 실패 시 cleanup | `report/route.ts:76-110` |
| `applyProgress` 3원칙: 선행조회 실패=중단 / 동일값 단락(멱등) / 자식 있으면 거부 | `applyProgress.ts:20-33` |
| 게이트 3겹(env→404, 시크릿→401, 미등록 프로젝트→404) | `externalApi.ts:10-48` |
| 권한 fail-closed(조회 실패=거절) | `externalApi.ts:54-71` |
| "보고가 유일한 완성 인지 채널, 침묵은 멈춤" | API 계약 §1 |
| "실패 시 progress 0 금지, release만" | API 계약 §5·§7 |
| 승인/반려 경합의 명시적 통지 | `actions/agentWork.ts:122-138` |
| 발행은 리프만·프로젝트 등록 필수 | `actions/agentWork.ts:52-71` |
| 에이전트별 API 키 분리 안 함(YAGNI) | 스펙 §6 |

### 8.2 바꾸는 것

| # | 변경 | 이유 | 영향 |
|---|---|---|---|
| C1 | 발행 주체에 **스케줄러 tick** 추가 | 킥오프 §3-1 | `createAgentWorkOrder`의 `requireProjectAdmin`은 **사람 경로에 그대로 남긴다**. tick은 별도 경로 + 옵트인 게이트 |
| C2 | `stage` 축 신설 + `agent_stage_events` | 킥오프 §3-2 | API 계약에 stage 보고 엔드포인트 1개 추가. 기존 report는 무변경 |
| C3 | `blocked` 상태 추가 | 재시도 소진의 종착지가 필요. `ready`로 돌리면 같은 실패를 반복한다 | 전이표 확장(§4.2) |
| C4 | lease + 자동 회수 | 기존은 24h 표시만·수동 회수(스펙 §8에서 명시적 비범위) | `claimed_at` 유지 + `lease_expires_at`/`reclaim_count` 추가 |
| C5 | ready 목록 정렬 정책 교체 | 현재는 `priority desc, created_at asc`뿐(`work/route.ts:24`) | 사전식 6단(§5.2) + 선정 사유 동봉 |
| C6 | **의존성 스케줄 연동** | 스펙 §8에서 비범위였던 항목. 이번 설계의 핵심 | `task_dependencies` + `computeDependencySchedule` **읽기만**. 새 일정 엔진 없음 |
| C7 | `completion`의 의미 = "배포까지 완료" | 킥오프 §3-2 | 하네스 규약(API 계약 §5의 자체 검증)을 stage 게이트로 승격 |
| C8 | `resource_key` 배타 | 병렬 에이전트의 리포 충돌 | claim 조건 1개 추가 |
| C9 | RLS 조회 정책 상실 보전 | MySQL엔 RLS가 없다 | 원장 조회는 **전부 서버 경유 + 프로젝트 멤버 판정**. 클라이언트 직접 DB 접근 경로를 만들지 않는 것이 유일한 대안 → §9 리스크, 설계자 C와 접점 |

---

## 9. 결정이 필요한 사항 (권고 포함)

| # | 질문 | **권고** | 근거 |
|---|---|---|---|
| 1 | 자동 발행의 기본값은? | **프로젝트별 옵트인, 기본 꺼짐 + 최초 드라이런 필수** | 위키 중단 때와 같은 판단 — env를 못 읽는 환경에서 조용히 도는 것보다 조용히 멈춰 있는 편이 안전하다. 켜는 순간 밀린 항목 전량이 후보가 된다(§3.2) |
| 2 | "스스로 찾아서 수행"을 어디까지 허용하나? | **ready 큐에서 고르는 것 + 발행 후보 제안까지. 주문 발행·WBS 항목 창작은 금지** | 발행을 주면 "내가 낸 일을 내가 하고 내 실적을 올린다"가 된다. 승인(출구)과 발행(입구) 양쪽을 사람이 쥐는 것이 §7 안전 경계 요구에 대한 답(§5.1) |
| 3 | 배포를 어디까지 자동화하나? | **스테이징/프리뷰까지 자동, 프로덕션은 사람 승인**. 프로덕션 승인은 기존 완료 승인과 **한 번의 클릭으로 합친다** | 승인 게이트를 2개로 나누면 승인 피로가 배가 되고, 그러면 사람이 대충 누른다. 되돌림 비용의 비대칭성 때문에 프로덕션만은 사람 |
| 4 | 완료 100% 사람 승인을 유지하나? | **유지.** 자동 승인 화이트리스트는 2단계 이후 재검토 | 무료 LLM 실행 엔진의 품질이 미검증이다(설계자 B 판정 대기). 품질 데이터가 쌓이기 전에 이 게이트를 풀면 실적이 오염되고, 실적은 대시보드·주간보고·PPT로 전파된다 |
| 5 | lease·재시도 수치 | **lease 30분 / 재시도 2회 / 회수 2회** | 실행 시간 분포를 모르므로(§10) 가정값이다. 설계자 B의 실측 후 조정 전제. 설정 컬럼으로 빼 두어 코드 수정 없이 바꿀 수 있게 한다 |
| 6 | 밀린(과거 계획일) 항목 처리 | **lookback 14영업일. 초과분은 자동 발행 대상에서 제외하고 목록만 제시** | 3주 전 계획일 항목을 지금 자동 착수하는 것은 대개 계획이 죽은 것이지 일이 남은 게 아니다 |
| 7 | 발행 단위를 리프로 유지하나? | **유지** | 롤업 부모에는 실적을 쓸 수 없다(`applyProgress.ts:29-32`) — 코드가 이미 강제한다. 바꾸면 실적 모델 전체를 건드려야 한다 |
| 8 | 타임존을 프로젝트별로 여나? | **KST 고정. `project_settings.timezone`은 예약 필드로 둔다** | `seoulToday()` 단일 출처 원칙(`dates.ts:14-16`)을 깨면 '오늘' 정의가 두 벌이 된다. 다국가 프로젝트가 실제로 생길 때 P7과 함께 |
| 9 | stage와 percent를 연동하나? | **연동하지 않는다** | stage는 사실, percent는 주장이다. 섞으면 진척률이 파이프라인 구현 디테일에 종속된다(§4.3) |
| 10 | tick 주기 | **10분** | 계획일은 날짜 단위라 그 이상 조밀할 필요가 없고, lease 회수 응답성(30분 lease)에는 충분하다. 원본 리포에서 프로토타입할 경우 Vercel 크론 최소 주기 제약을 확인해야 한다(§10) |

---

## 10. 리스크 (이 설계가 실패한다면 어디서 실패하는가)

| # | 리스크 | 어떻게 터지나 | 완화 |
|---|---|---|---|
| R1 | **자동 발행 첫날 백로그 폭발** | 옵트인을 켜자마자 밀린 리프 수백 건이 ready가 된다. 상한이 있어도 "매일 20건씩 영원히"가 된다 | 드라이런 + lookback 창 + 일일 상한. **가장 먼저 검증할 것** |
| R2 | **반려 무한루프** | 무료 LLM이 같은 실패를 반복 → 반려 → 재작업 → 반려. 자동화가 사람의 일을 **늘린다** | 항목당 총 주문 상한 3 + `attempt_count` 소진 시 `blocked`. 그래도 사람이 blocked를 처리해야 한다 — 자동화의 순이익이 음수가 될 수 있다 |
| R3 | **lease 회수 중복 실행** | 살아 있는 에이전트의 lease가 만료 → 회수 → 다른 에이전트가 claim → 같은 브랜치에 두 개의 작업 | `claimed_by` 불일치 403(기존 코드)이 보고를 막고, `resource_key`가 리포를 막는다. 그래도 **커밋 자체는 이미 나갔을 수 있다** — 완전 방어 불가 |
| R4 | **실적 오염** | 어딘가에서 `progress 0`이 나가면 즉시 `actual_pct`를 덮어쓴다(`applyProgress.ts:34-40`). 자동 루프는 사람보다 훨씬 자주 실패하므로 노출이 커진다 | 규약을 코드로 승격: 실패 경로에서 progress 보고 자체가 불가능하도록 stage 이벤트와 분리 |
| R5 | **계획일 흔들림에 의한 재발행 폭주** | `trigger_key`가 계획일을 포함하므로 PM이 일정을 재조정할 때마다 새 주문이 난다 | 항목당 총 주문 상한. 다만 상한에 걸린 뒤 "왜 발행 안 되지"라는 혼란이 생긴다 → `agent_schedule_runs`의 사유별 카운트 노출 필수 |
| R6 | **예측값 순환** | `forecastEnd`는 `actual_pct`의 함수인데(`dependencySchedule.ts:264-270`) 에이전트가 `actual_pct`를 쓴다. 예측을 트리거 조건에 넣으면 자기 출력이 자기 입력 | 트리거 조건(§3.1)에서 예측값 배제. **순위(§5.2)에만 사용** |
| R7 | **MySQL CHECK 무시** | 8.0.16 미만에서 `CHECK`는 파싱만 되고 강제되지 않는다 → 상태값 제약이 조용히 사라진다 | `ENUM` 사용. 버전은 설계자 C 결정 대기 |
| R8 | **`GET_LOCK` 누수** | 커넥션 풀에서 획득/해제가 다른 커넥션이면 락이 안 풀린다. tick이 영구 정지 | 락 획득·해제를 같은 커넥션에 묶고, 타임아웃 0으로 잡아 실패 시 즉시 종료(다음 tick이 재시도). 락 실패는 정합성 사고가 아니다(§6.4) |
| R9 | **DATETIME TZ 규약 붕괴** | `DATETIME`은 TZ를 안 갖는다. 어딘가 로컬시간이 들어가면 lease 만료·트리거 판정이 9시간 틀어진다 | 앱 경계에서 UTC 강제 + 저장/조회 테스트. **KST 판정과 UTC 저장을 명시적으로 분리** |
| R10 | **RLS 2차 방어선 상실** | MySQL엔 RLS가 없다. 원장 조회 권한 판정이 서버 코드 한 겹뿐 | 기존에도 이 계열(회의록·위키·에이전트 원장)은 "서버 가드가 유일한 관문"이었다(CLAUDE.md·0057:55-56) — **새로운 위험이 아니라 그 범위가 전 테이블로 확대되는 것**. 설계자 C 판정 대상 |
| R11 | **의존성 데이터가 실제로는 비어 있을 가능성** | 트리거 조건 T6과 순위 2~5가 전부 `task_dependencies`에 의존한다. 등록된 의존성이 없으면 임계경로도 총여유도 무의미해지고 정렬은 사실상 `priority`+계획일로 퇴화한다 | 운영 DB 조회 금지라 실측 못 했다(§11). **활성화 전에 대상 프로젝트의 의존성 등록 건수를 반드시 먼저 세어야 한다** |
| R12 | **자동화가 사람 부하를 옮기기만 함** | 발행은 자동, 승인·blocked 해제·상한 조정은 사람. 실패율이 높으면 사람은 "승인 심사 공장"이 된다 | 성공률 지표를 `agent_schedule_runs`/stage 이벤트로 상시 노출. **성공률이 임계 미만이면 자동 발행을 스스로 끄는** 서킷 브레이커를 2단계 후보로 둔다 |

---

## 11. 모르는 것 / 확인하지 못한 것

추측을 사실처럼 쓰지 않기 위해 명시한다.

1. **운영 D-CUBE의 `task_dependencies` 실제 등록 건수** — 확인하지 않았다(운영 DB 무접촉 제약). R11의 전제가 여기 달려 있다. 스키마와 계산기가 존재한다는 것만 코드로 확인했다.
2. **Vercel 요금제의 크론 최소 주기** — 확인하지 않았다. 실측한 것은 `vercel.json`이 현재 `crons: []`라는 것과, 직전 위키 크론이 하루 1회(`17 18 * * *`)였다는 것뿐이다. 새 플랫폼은 자체 스케줄러를 쓰므로 이 제약은 **원본 리포에서 프로토타입할 때만** 걸린다.
3. **MySQL 버전·호스팅 형태** — 설계자 C 결정 대기. R7(CHECK 강제 여부)·`UUID()` 가용성·`GET_LOCK` 동작이 여기 종속된다. DDL은 8.0 기준으로 썼다.
4. **실행 엔진의 실패율·1건당 소요시간 분포** — 설계자 B 판정 대기. §9-5의 lease 30분·재시도 2회는 **근거 없는 가정값**이며, 설정 컬럼으로 빼 둔 이유가 그것이다.
5. **`AgentOpsView` 내부 구현** — `src/app/(app)/agent-ops/page.tsx`만 읽었고 뷰 컴포넌트 본문은 읽지 않았다. 승인/반려/회수 흐름은 서버 액션(`src/app/actions/agentWork.ts`)으로만 확인했다. 관제 UI에 stage/blocked/상한을 어떻게 얹을지는 화면 구조를 본 뒤 정해야 한다.
6. **에이전트 API의 실운영 스테일 발생 빈도** — 자동 회수가 없다는 것은 코드로 확인했으나(`actions/agentWork.ts:188-202`), 실제로 좀비 점유가 얼마나 나는지 데이터가 없다. lease 도입의 실익 크기는 미검증이다.
7. **`recordProgressSnapshot`의 내부 동작** — `report/route.ts:71`에서 `after()`로 호출된다는 것만 확인했고 함수 본문은 읽지 않았다. 자동 루프가 진척 보고 빈도를 크게 올릴 때 스냅샷 테이블이 어떻게 커지는지는 확인하지 못했다.
8. **위키** — 제외.

---

## 12. 설계자 B·C와의 접점 (겹침 보고)

내 파일에서 **결정하지 않고 넘긴 것**:

- **B에게**: stage 게이트의 실제 판정(무엇이 "테스트 통과"인가), 재시도 백오프의 구체값, 워크트리/컨테이너 격리, 배포 실행과 롤백 트리거, 무료 티어 RPM 큐. 나는 `resource_key`·`attempt_count`·`lease`라는 **훅만** 정의했다.
- **C에게**: RLS 상실 보전(R10), MySQL 버전·호스팅, 기존 원장 3종 데이터의 이관 여부, 크론/스케줄러 런타임을 무엇으로 돌릴 것인가. 나는 DDL과 타입 매핑까지만 썼다.
- **겹칠 소지**: `agent_projects`에 자동화 설정 컬럼을 넣을지, 별도 설정 테이블로 뺄지는 C의 `project_settings` 이식 방침과 충돌할 수 있다. 나는 **기존 게이트 테이블에 붙이는 쪽**으로 썼다(조인 감소·게이트 판정과 상한 판정이 같은 행에서 끝남). C가 설정 계층 통합을 택하면 그쪽을 따르겠다.
