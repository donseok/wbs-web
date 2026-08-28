# WBS 자율 개발 러너 — 설계 (하이브리드)

작성 2026-08-20 · **개정 2**(2026-08-20 — 운영 시나리오·개인계정 인프라 반영 / 개정 1: 외부 리뷰 2건) · 상태 **설계 승인(사용자)** · 구현 미착수

MES 공통개발 프로젝트를 첫 대상으로, D'Flow WBS의 물량을 로컬 PC의 개발 에이전트가
**수령 → 워크트리 개발 → PR → 완료 보고 → 다음 물량** 루틴으로 계속 처리하는 자율 루프를 만든다.
서버측 루프(주문·claim/report·stage v2.1·승인 UI·알림함)는 이미 프로덕션에 있고, 이 설계는
기존 설계가 "후속 WBS, 별도 승인"으로 남겨둔 **러너(로컬 자율 실행 계층)** 를 채운다.

**개정 1 요지** — 제미나이(3.7)·코덱스 외부 리뷰를 코드 실물로 검증해 반영:
① 부트스트랩 순서 교정(agent_projects 등록이 import보다 먼저 — `import/route.ts`의
`requireAgentProject` 404가 실측 근거) ② **open PR 스태킹 폐기 → merged-only 선행 정책**
③ 선행 evidence 계약 결함 2건 봉합(approved 전용 → reported|approved, null evidence
fail-open → fail-closed) ④ "단발형이라 저널 불필요" 단정 철회 — 제어 저널 + 시작 시
reconciliation 필수 ⑤ completion 원자화(v2.2) ⑥ PAT 스코프 분리(wbs:import) ⑦ 보안 경계
강화(리포 settings는 주 방어선 아님) ⑧ 파일럿 3단 분리 ⑨ 중복 기동 락 · 최종 실패 시 release 명시.

**개정 2 요지** — 사용자 운영 시나리오(웹 '작업' 트리거 → 로컬 자동 연쇄, 2026-08-20)를 정본으로 반영:
① "1회 기동 = 최대 1건" → **drain**(기동당 처리 가능 물량이 빌 때까지 건 단위 사이클 연쇄, `--once`로 제한 가능 — run-to-completion 성질은 유지) ② 트리거 = 폴링(Vercel 서버리스는 로컬 push 불가 — launchd StartInterval **60초 권고**, 폴링은 LLM 토큰 0·HTTP 2회라 저비용, 버튼→착수 체감 ≤1분; 알림함 Realtime(0075) 구독형 즉시 트리거는 상주 리스너가 필요해 v2 백로그) ③ 웹 UI 조작은 PAT 병행 금지의 예외임을 명시 ④ 인프라 정본 명시(아래).

**관계 문서**
- API 계약 정본: `docs/agent/claude-skill/dflow-work/references/api-contract.md` (v2.1 — 이 설계가 **v2.2 개정 세트**를 추가한다, §5)
- 선행 코퍼스: `docs/design/agent-coding-platform/` (특히 12-pilot-protocol · 32-review-loop C1 · 21-multi-client-model)
- 외부 리뷰: 제미나이 리뷰(`2026-08-20-wbs-autonomous-runner-review.md` — 'owner' 역할 등 오류 6건은 본 개정에서 정정 반영) · 코덱스 리뷰(2026-08-20 대화 전달 — P0 8건 전부 코드로 확인돼 반영)
- 2026-08-10 3부작(claude-code-work-integration-review·부록·plan)은 서버측 구축의 역사 문서 — stage 어휘 등이 v2.1 이전 상태이므로 **구현 참조는 api-contract.md가 정본**이다.

---

## 1. 확정 결정 (2026-08-20 사용자)

| # | 결정 |
|---|---|
| ① | v1 러너 배치 = **사용자 본인 PC 1대 파일럿**. 다개발자 확산은 파일럿 GO 이후 |
| ② | 실행기 = **Claude Code 단일**(`claude -p`). codex/gemini는 실행기 어댑터 계약 뒤 후속 |
| ③ | 자율 종착점 = **PR 생성까지 무인, main 머지는 사람**(배치 처리 허용). 선행 코퍼스 P5 상한과 일치 |
| ④ | MES 현황 = WBS는 파일(임포트 전), 코드 리포는 존재 |
| ⑤ | 아키텍처 = **하이브리드**: 단발 실행형 러너 + 서버 최소 보강 + LLM은 예외 에스컬레이션 전용 |
| ⑥ | (개정 1) 선행 정책 = **merged-only** — open PR 스태킹은 Phase 3으로 격리(§4-2) |

**구속력 있는 선행 결정(승계)**: 구독을 제품이 다수 사용자에게 프록시하면 ToS 위반 —
러너는 각 사람의 로컬 PC에서 본인 구독으로만 돈다. 유료 LLM API 전제 금지.
운영 D-CUBE 무접촉 — `agent_projects` 미등록 404가 최강 안전망이다. 등록은 **MES와 파일럿용 일회용
프로젝트(파일럿 기간 한정, 종료 시 등록 해제)로 한정**하며 운영 D-CUBE는 절대 등록하지 않는다.

**인프라 정본(2026-08-20 사용자)**: 소스 GitHub · web/WAS Vercel · DB/스토리지 Supabase Pro ·
LLM Claude Code **Max 20배** — 전부 개인계정. 러너 PC는 **동일인의 제2 PC**로 본인 구독·본인 계정을
쓰므로 ToS 제약(구독 프록시 금지)을 충족한다. Max 20배여도 일일 호출 상한은 유지한다
(§7 — 상한의 목적은 한도 보호만이 아니라 폭주·오염 차단이다).

## 2. 검토 방법론과 기각 사유 (재제안 방지)

접근안 3개(A 결정적 스크립트 데몬 / B Claude Code 상주 세션 러너 / C 서버 구동 오케스트레이션)를
3렌즈(실행·안전장치 / 보안·계약 / 운영·비용) × 3안 적대 검토 + 완전성 비평 1로 병렬 검증했다(2026-08-20, 10 에이전트).

| | 실행·안전장치 | 보안·계약 | 운영·비용 |
|---|---|---|---|
| A 스크립트 데몬 | COND 5.5 | COND 5 | COND 6 |
| B 상주 LLM 세션 | **NO-GO 3** | COND 4 | **NO-GO 3** |
| C 서버 오케스트레이션 | **NO-GO 3** | COND 3.5 | **NO-GO 3** |

- **B 기각**: 가장 비싸고 가장 잘 죽는 컴포넌트(LLM 세션)를 감독자로 앉힌다. 세션 사망(절전·크래시·한도) 시
  재시작 주체가 없어 침묵 실패(32-review C1)에 무방비이고, 감독자·작업자가 같은 구독 한도를 공유해
  한도 소진이 복구 로직까지 함께 죽인다. → **상주 세션 러너 재제안 금지.** B의 실익은 §8 에스컬레이션으로만 수용.
- **C 기각(v1 기준)**: 재-claim 상한 없는 lease 자동 회수는 침묵 실패 루프를 자동화하고, 주기 cron은
  미확인 Vercel 요금제 전제이며, "파일럿 실측 먼저" 순서를 뒤집어 좌초 비용 최대.
  → **전면 서버 오케스트레이션 재제안 금지.** 회수 요소는 §6 최소 보강과 Phase 3 백로그로만 수용.
- **A 조건부 생존** → 완전성 비평의 **단발 실행형**으로 대체(상주 데몬의 "데몬 생존성" 실패 부류 제거).
- **(개정 1) open PR 스태킹 v1 기각**: 코드 실측 3건이 결합해 성립하지 않는다 —
  evidence가 approved 주문 전용이라 승인 전엔 스태킹 재료(sha·브랜치) 자체가 null이고(`depends.ts`),
  반려는 stage 무전이라 이미 연 후행에 반려된 코드가 잔류하며(계약 v2.1), 이를 바로잡으려면
  dependency SHA snapshot·descendant invalidation·재스태킹·재게이트·증적 버전 관리가 필요하다
  — "계약 개정 1건"이 아니라 Phase 3 수준의 스택 매니저다. → v1은 merged-only(§4-2), **스태킹 재제안은 Phase 3 요건 충족 전 금지.**

## 3. 아키텍처 개요

| 구성 요소 | 상태 | 역할 |
|---|---|---|
| D'Flow 서버 | 기존 | 주문·claim/report·stage 전이·선행 게이트·승인 UI·알림함. 변경은 §5(v2.2 — L0 전)와 §6(v2.3 — L1 전) |
| 러너 `dflow-runner.mjs` | **신규** | 단발 실행형(run-to-completion): 1회 기동 = **처리 가능 물량이 빌 때까지 건 단위 사이클 연쇄(drain)** 후 종료(`--once`로 1건 제한). launchd 주기 기동(60초 권고) + caffeinate |
| 워커 | 기존 CLI | `claude -p` 헤드리스 — **편집만 한다.** commit·push·PR·보고는 전부 러너 몫(§10). `runCoder(spec, worktree, limits) → {exit, log, callCount}` 어댑터 뒤에 격리 |
| 에스컬레이션 | 기존 | 알림함(+로컬 보조 채널 §8) — 정상 경로 토큰 0, 예외만 사람 호출 |
| MES 리포 | 기존 | 워크트리·브랜치·PR의 무대. wbs-web·D-CUBE는 런타임 무접촉 |

**사이클(개정 1)** — claim·파일시스템·Claude·git·GitHub·D'Flow는 한 트랜잭션이 아니므로
모든 단계는 저널 체크포인트를 남기고 멱등으로 설계한다:

1. **싱글턴 락**(flock — bare pid 파일 금지, 크래시 후 stale 락 방지). launchd는 같은 Label을
   중복 기동하지 않으므로 락의 실효는 **supervised 수동 실행과의 병행** 대비다.
2. **preflight**: `/agent/me` — 스코프·`contract_version >= 2.2` 강제·토큰 만료 임박·디스크·도구(gh/git/claude) 검사. 부족 시 fail-fast.
3. **reconciliation**(시작 시 필수): `mine`으로 **내 claimed 복구 → reported 대사(409 수렴 규칙 §7) → 그 다음에야 ready 신규 선택.** claim 후 크래시가 "재개"가 아니라 "새 claim 시도"가 되는 것을 막는다.
4. durable backoff 확인(환경 실패의 `not_before` 저널) → assigned·ready·eligible 선택.
5. **선행 검증(merged-only, §4-2)** → claim → 워크트리 생성 → `claude -p`(stdin 프롬프트·타임아웃·프로세스 그룹).
6. **안전 diff 검사**(§10 — 민감 경로 변경 거부) → 게이트(빌드·테스트·린트·diff 상한) → 실패 시 게이트 출력 피드백 재시도 ≤N.
7. **러너가 commit** → push 확인 → PR ensure(멱등 — 기존 PR 있으면 재사용) → `done`(evidence: repo_url·base_sha·head_sha·branch·PR URL).
8. **최종 실패 시 `release` 후 에스컬레이션** — 이 단계 없이는 주문이 claimed로 영구 잔류한다(양 리뷰가 놓쳤고 초판 스펙에도 누락됐던 단계 — 명문화). reason의 서버 전달은 v2.3(§6)에서 열린다 — **그 전에는 reason이 로컬 저널·로컬 알림(§8)에만 남는다.**
9. 워크트리 정리 → 저널 확정 → **다음 건으로 연쇄(drain — done 이 아닌 순간 종료)** → 락 해제 → 종료.

**운영 시나리오(2026-08-20 사용자 정본)** — 위 사이클이 구현해야 하는 사용자 여정:
① 개발자가 wbs-web 접속 → WBS 페이지에서 내 작업 확인 ② **"작업 시작" = 담당자 배정 + dev_workflow ON
(리프는 임포트 시 자동) 또는 수동 발행** — 이 행위가 주문을 ready 로 만든다(신규 버튼 불필요 — 기존 발행
축이 곧 트리거) ③ 러너 PC(동일인의 제2 PC)가 폴링으로 수령 — Vercel 서버리스는 로컬로 push 할 수
없으므로 폴링이 유일 채널이고, StartInterval 60초 권고로 버튼→착수 체감 지연 ≤1분(폴링 비용: LLM 토큰
0·HTTP 2회) ④ claim 응답의 spec 으로 로컬 개발·PR ⑤ done 보고 → stage `im` 자동 전이(WBS 화면 즉시
반영; **실적 100% 확정은 웹 승인 시** — 비동기 감사, progress 자기보고 %는 쓰지 않는다) ⑥ **drain 이
다음 배정 물량을 같은 기동에서 연속 처리** — "자동으로 다음 할 일 진행"의 구현.

**제어 저널(필수 필드)**: run_id · order_id · 현재 phase · not_before(백오프) · coder attempt 수 ·
일일 호출 원장 · base_sha와 선행 sha 스냅샷 · branch · worktree 경로 · Claude PGID · remote sha · PR URL.
append-only + 손상 시 fail-closed(해당 항목 release + blocked 표기, "재개" 금지).

**루프 지속성**: completion→`im` 자동 전이로 서버 stage 게이트는 사람 승인 없이 열리지만,
v1의 실질 직렬화 장치는 러너의 merged-only 검증이다(§4-2). 독립(무의존) 항목은 그동안 계속 처리한다.

**코드 정본 위치**: `docs/agent/claude-skill/dflow-work/scripts/runner/`. wbs-web 프로덕션 번들 무접촉, MES 리포에는 설치물 없음(전용 clone/워크트리 루트만, §10).

## 4. Phase 0 — 선결 (루프 착수 전 하드 블로커)

### 4-1. PAT 발급 경로와 스코프 분리 (서버 v2.2의 일부, §5)

- `createAgentToken` 확장: **슈퍼유저·프로젝트 관리자(`project_roles.role='admin'` — 'owner' 역할은 존재하지 않는다, `authz.ts:6`)에 한해** 쓰기 스코프 발급 허용.
  구현은 `SELF_ISSUE_SCOPES` Set에 추가하는 방식이 아니라(현 액션은 역할 검사가 0이라 그대로면 전 멤버에게 열린다) **호출자 역할 조건부의 별도 허용 경로**로.
- **스코프 분리**: `wbs:import`(부트스트랩 전용 — import 라우트가 이 스코프를 요구하도록 변경, 짧은 TTL, import 후 즉시 폐기) ≠ **runtime PAT**(`work:read`+`work:claim`+`work:report`, project_id=MES 고정, 30일). runtime PAT 유출이 WBS 구조·spec·depends 변경 권한까지 주는 것을 차단한다.
- 쓰기 스코프 포함 시·슈퍼유저 발급 시 **project_id 지정 필수 + 만료 상한 30일**. 기존 project_id=null 슈퍼유저 PAT는 감사·폐기.
- 발급 UI(`MyTokensSection` — 현재 read/claim 2종 하드코딩) 함께 변경. PAT는 launchd plist에 넣지 않고 **키체인에서 기동 시 읽기**(리포 관례: "DFlow Agent API").

### 4-2. 선행 정책 = merged-only (계약 v2.2 명문화)

| 선행 상태 | v1 러너 동작 |
|---|---|
| PR **MERGED**·예상 MES 리포·base에 반영 확인 | 후행 진행 |
| PR **OPEN** | **대기** — 독립 항목을 계속 처리 |
| PR **CLOSED**(미머지) | 사람 에스컬레이션 |
| 선행 주문 반려/재점유(claimed) | 대기 + 영향 PR 표시 |
| evidence 누락 · repo/base/sha 불일치 | **fail-closed(대기/에스컬레이션)** — 통과 아님 |

- 서버(§5): `depends_evidence`를 **최신 reported\|approved completion**에서 읽고
  `order_status`·`review_action`·`repo_url`·`base_sha`·`head_sha`·`branch`·`pr_url`을 반환 — 러너가 merged 판정과 반려 식별을 할 수 있는 재료.
- 클라이언트: dflow.sh `check_depends_local`의 `select(.head_sha != null)` **fail-open 제거** —
  `stage >= im`인데 evidence가 없거나 불일치면 차단(exit 4). 러너의 exit 4 처리 = 대기 목록 + 백오프(핫루프 금지).
- 사람의 머지가 의존 체인의 속도 조절기가 된다 — 종착점 결정 ③("머지는 사람, 배치 허용")과 정합.
  반려 전파의 창을 **크게 좁힌다**(머지가 사람의 명시 행위이므로) — 단, **"머지 후 반려" 창은 남는다**:
  merged+reported 선행을 후행이 통과한 뒤 D'Flow 반려(stage 무전이)가 도착할 수 있다. v1 처리 =
  아침 대사(§8)에서 "반려된 선행에 의존하는 후행" 검출 시 영향 PR 표시 + 에스컬레이션, 운영 규칙으로
  "반려 판단은 머지 전에"를 권고. 진행 조건을 merged∧approved로 강화할지는 §13-①에서 결정.

### 4-3. MES day-0 부트스트랩 (순서 교정 — 개정 1) — 완료 시점: **실 MES origin 전환(§9 3행) 전까지.** C0·L0 파일럿은 일회용 프로젝트로 §9를 따른다

1. D'Flow에 MES 공통개발 프로젝트 생성 + 권한(관리자) 구성.
2. **`agent_projects`에 MES 등록** — import API가 미등록 프로젝트를 404로 거부하므로(`import/route.ts` `requireAgentProject`) **등록이 import보다 반드시 먼저다.** 운영 D-CUBE는 미등록 404 그대로(등록 절대 금지). 파일럿 일회용 프로젝트는 기간 한정 등록 후 종료 시 해제(§1).
3. wbs.md → 계약 JSON 변환: **기존 `/dflow-export` 스킬 사용**(신규 스크립트 작성 아님 — 병렬 세션이 이미 구축).
4. `wbs:import` PAT 발급(§4-1, 단기) → `POST /api/v1/wbs/import` → **import PAT 즉시 폐기.** 재업로드는 멱등(필드 소유권: stage·assignee·actual_pct 보존).
5. 결과 검증: dev_workflow·담당자 배정·주문 자동 발행 확인.
6. **MES 리포 게이트 기준선 실측**: 빌드·테스트 명령의 존재, 현재 초록 여부, 소요 시간. 기준선이 빨간 리포에 러너를 붙이지 않는다.
7. 음성 테스트 4종(오시크릿 401·미등록 404·비배정 claim 403·선행 미충족 403) 재확인.

### 4-4. 부수 수선

- dflow.sh doctor의 `"2.0"` 하드코딩 → **사람용 doctor는 메이저 일치(2.x)**, **러너 preflight는 `>=2.2,<3` 범위 강제**(§3-2). 둘은 목적이 다르다.
- dflow.sh curl에 `--max-time` 부여.

## 5. 서버 계약 v2.2 (L0 러너 파일럿 착수 전 완료 세트)

초판의 "Phase 1까지 서버 변경은 발급 1건"은 성립하지 않는다(코덱스 리뷰 — 코드 검증으로 확정). L0 전 필수 세트:

1. **PAT 발급 확장 + wbs:import 스코프 분리** (§4-1).
2. **depends_evidence 소스 변경**: approved 전용 → **최신 reported\|approved completion** + 반환 필드 확장(§4-2). 기존 `tests/agent/depends-gate.test.ts`의 approved 전용 단언은 **계약 변경에 따른 의도된 개정**이다(회귀 아님).
3. **completion 원자화**: 현재 report insert → order CAS → stage 전이가 분리돼 있고 stage 전이 실패가 로깅만 되고 200을 반환한다(`report/route.ts` — "실패는 로깅만" 주석 실측). 주문은 reported인데 stage가 im이 아니면 **자동 회복 경로가 없어** 사람의 승인·반려 개입(승인의 xx 전이가 회복시킨다) 전까지 후행 claim이 403으로 막히고, 실패가 로그에만 남아 침묵 열화한다 → 셋을 DB RPC/트랜잭션으로 묶는다.
4. evidence **URL host allowlist** 추가(2026-08-20 오전 설계 검증에서 확인된 기존 미구현 항목의 동시 봉합). `repo_url`·`base_sha` 수용·형식 검증은 `validateEvidence`(`domain/agentWork.ts:57~`)에 **이미 구현돼 있다** — 신규 아님.

마이그레이션 번호는 **착수 시점 실측 후 부여** — 0087·0088은 이슈 이력이 선점했다(2026-08-20 운영 적용 완료, 다음 빈 번호 0089+. 병렬 세션이 있으므로 문서에 번호를 박지 않는다).

## 6. 서버 보강 v2.3 (L1 무인화 진입 조건)

- **claim 상한의 서버 강제**: `claim_count`를 claim CAS와 **하나의 RPC**에서 +1·상한 판정 — 러너의 "건너뛰기"가 아니라 서버가 초과 claim을 거부. `blocked/exhausted` 상태(또는 동등 필드) + 관리자 reset/unblock + 감사 이력.
- **카운터 분리**: claim 횟수 ≠ coder attempt ≠ 반려 재작업 횟수 ≠ 환경 서킷브레이커 — 각각 별도 상한. 반려 재작업도 상한에 포함.
- **release reason 구조화**: raw stderr가 아니라 `reason_code: gate_failed|timeout|dependency_invalid|environment|unknown` + 길이 제한·비밀 마스킹된 detail. /agent-ops 표시.
- **`work.stalled` 알림**: 현재 카탈로그(`inbox.ts`)에 **없다** — 타입 추가(수신자·필수 여부 정의) + `stalled:<orderId>:<claimedAt>` episode별 dedupe key. claimed_at 24h 초과 시 조회 시점 발행으로 시작.
- lease TTL·claim fencing(epoch)·`claimed_by_runner_id`는 **Phase 3**(다러너) — 재claim 상한 없는 lease는 루프를 자동화한다는 §2 결론 유지.

## 7. 러너 상세

- **실패 3분류**: ⑴ 작업 실패(게이트 — attempt 카운트) ⑵ **환경 실패**(구독 한도·네트워크·인증 — 카운터 미증가 + `not_before` 저널로 durable backoff) ⑶ 불명(즉시 에스컬레이션). 한도 신호는 **파일럿 전 1회 의도 재현**으로 실측해 매처에 등록.
- **타임아웃**: detached 프로세스 그룹(SIGTERM→유예→SIGKILL), PGID 저널 기록, 재시도 전 워크트리 신규 생성.
- **`done` 409 = show 재조회로 멱등 수렴**(reported/approved면 성공 확정, reported에 release 시도 금지). completion `idempotency_key`는 **보류** — 현 409 경로가 재시도 보고 행을 cleanup하고 원본 evidence를 보존함을 코드로 확인했고, 1러너에서는 reconciliation이 잔여 케이스를 덮는다. 다러너 시 재평가(Phase 3).
- **PAT 병행 사용 금지(v1 운영 규칙)**: 점유 소유 판정이 사용자 ID 기준이라 같은 사용자의 수동 dflow.sh·제2 PAT가 러너의 주문을 release/report할 수 있다 — 러너 가동 창에는 동일 사용자의 수동 개입 금지. 서버측 `claimed_by_runner_id` 검증은 Phase 3. **웹 UI 조작(배정·승인·반려·발행)은 세션 인증이라 이 금지와 무관** — 금지 대상은 동일 사용자의 수동 dflow.sh·제2 PAT 쓰기뿐이다(운영 시나리오 ①~②의 웹 조작은 러너 가동 중에도 정상).
- **상한 수치는 전부 파일럿 실측 전 완충값**(절차서 가정치 기반)이다 — 재시도 N, claim 상한, 타임아웃, 일일 호출 상한에 지금 특정 숫자를 계약으로 박지 않는다. 파일럿이 그 숫자를 검증하는 게 아니라 그 숫자에 오염되는 것을 막는다(절차서 "가정치→실측" 원칙).
- 테스트: **fake Claude/git/gh 이중화**로 러너 상태기계를 단위 검증(크래시 체크포인트 주입 포함) — 실 구독·실 리포 없이 회귀 가능해야 한다.

## 8. 관측·에스컬레이션

- 정상 경로 토큰 0. 예외(게이트 최종 실패·분류 불명·선행 CLOSED·preflight 실패)만 알림함 + release reason.
- **로컬 보조 채널**: 네트워크 단절·PAT 만료처럼 **서버에 닿을 수 없는 장애는 알림함으로 통보 불가** — macOS 로컬 알림 + launchd 로그를 보조 채널로 둔다.
- 아침 리포트 1회(로컬 저널 요약): 처리/실패/스킵, 실패 시그니처, 호출 원장, "reported인데 PR 미머지 / 머지됐는데 미승인" 대사 목록.

## 9. 자율화 사다리와 파일럿 3단 분리

| 단계 | 내용 | 게이트 |
|---|---|---|
| **C0 calibration** | 일회용 D'Flow 프로젝트(**agent_projects 기간 한정 등록**, §1) + **fork**(secret/deploy 연동 없는)에서 기존 절차서의 수동 품질 실측(Q1~Q5). 러너 없이 | — |
| **L0 runner acceptance** | 같은 안전 환경에서 `dflow-runner --once` 실행. **크래시 주입 5지점**(claim 직후 · Claude 실행 중 · push 후 · PR 생성 후 · report 응답 유실)에서 재기동 수렴 확인 | C0 GO + **v2.2 배포**(§5) |
| **실 MES origin 전환** | **별도 사용자 승인** 후 | L0 통과 |
| **L1 무인** | launchd 주기 기동 + caffeinate. 승인은 비동기 감사, 머지는 사람 | v2.3 배포 + 실측 상한 반영 |
| **L2 (Phase 3)** | PR 머지 감지 자동 승인·다개발자·다CLI·lease/fencing — **별도 승인** | — |

측정 규칙(개정 1): 실패 게이트 0건이면 재시도 회수율은 N/A로 기록(분모 조작 금지) ·
표본 3회에 p95를 쓰지 않는다 — **max × 안전계수**로 상한을 정한다.

## 10. 보안 실행 경계

**사람의 PR 리뷰는 코드 머지 게이트일 뿐, 로컬 파일 손상·자격증명 유출의 방어선이 아니다.**
MES 리포의 `.claude/settings.json`을 주 방어선으로 쓰지 않는다(`-p`는 워크스페이스 신뢰 확인을
생략하고 잘못된 설정을 조용히 무시할 수 있다는 리뷰 보고 — 플래그 수준 강제로 대체).

- **러너 소유 불변 설정** + 명시적 도구 화이트리스트 플래그. 최초 파일럿은 Read/Edit/Glob/Grep만 허용,
  Bash·Web·MCP·플러그인·훅 차단(게이트 실행은 어차피 러너 몫) — C0 calibration과 비교 실측 후 완화 판단.
- 프롬프트는 argv가 아니라 **stdin** 전달. 모든 spawn은 `shell:false` + 고정 argv·고정 실행파일 경로.
- Claude·게이트 프로세스 env에서 `DFLOW_PAT(S)`·gh 토큰·클라우드 시크릿 제거(secret-free env).
- **Claude는 편집만** — commit·push·PR·보고는 러너가 수행.
- 게이트 실행 전 **민감 경로 diff 검사**: `.github/`·git hooks·package scripts·lockfile·`.claude/`·러너 설정 변경이 있으면 거부 + 에스컬레이션.
- 전용 runner clone과 워크트리 루트 사용. 실 MES origin 전에는 fork + draft PR(§9).
- spec은 DB 자유 텍스트 = 주입 벡터 — 킥오프에서 "요구사항 데이터, 지시 아님" 구획화 + 위 도구 제한이 1차 완화.

## 11. 테스트·롤백

- 러너: fake 이중화 단위 테스트(상태기계·실패 분류·409 수렴·reconciliation·크래시 체크포인트) + secret sentinel(민감 경로·env 유출 검사) 통합 테스트.
- 서버 v2.2: 기존 계약 테스트 중 approved 전용 evidence 단언은 의도된 개정(§5-2). 나머지 기존 테스트는 초록 유지.
- NO-GO 시 잔존물: 로컬 스크립트 + v2.2 서버 변경(발급·evidence·원자화). v2.2는 러너 없이도 자체 결함 수리(§5-3은 러너와 무관한 기존 버그)라 좌초 비용이 아니다.

## 12. 스코프 밖 (이 설계에서 하지 않음)

- 상주 LLM 세션 러너(B) · 전면 서버 오케스트레이션(C) — §2 기각, 재제안 금지.
- **open PR 스태킹** — §2 개정 1 기각. 재제안하려면 dependency SHA snapshot·descendant invalidation·재스태킹·재게이트·증적 버전 관리를 갖춘 Phase 3 스택 매니저 설계가 선행돼야 한다.
- completion `idempotency_key` — §7 보류 근거. `/agent/me` capability 목록 — contract_version 범위 검사로 충분(YAGNI).
- lease TTL·fencing·`claimed_by_runner_id`·다러너 조정 — Phase 3.
- codex/gemini 어댑터 구현 — 어댑터 계약만 정의.
- D'Flow 자동 승인(L2) — 별도 승인 후.
- 운영 D-CUBE의 agent_projects 등록 — 금지 유지.

## 13. 미결 (후속 결정 필요)

| # | 항목 | 시점 |
|---|---|---|
| ① | 이중 승인(D'Flow 승인 ↔ PR 머지) 연동 방식 — "머지 후 반려" 창(§4-2)에 대해 진행 조건을 merged∧approved로 강화할지 포함 | Phase 3 / L2 결정과 함께 |
| ② | MES 리포 머지 정책(merge-commit vs squash) — merged-only에서는 어느 쪽이든 동작하나 base 반영 확인 방식에 영향 | Phase 0 부트스트랩에서 |
| ③ | 다개발자 확산 시 spec 편집 권한·러너 신뢰 경계·`claimed_by_runner_id` | 파일럿 GO 이후 |
| ④ | 파일럿 도구 제한(Read/Edit/Glob/Grep)의 품질 영향 — C0 calibration 대비 실측으로 완화 여부 | L0 종료 시 |
