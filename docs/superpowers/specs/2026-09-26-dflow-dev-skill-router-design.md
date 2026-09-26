# dflow-dev 스킬 문서 단계별 분할 설계

작성 2026-09-26. 사용자 요청: "한 문서 안에 너무 많은 내용이 들어 있다. 구조화해서 중복을 줄이고 각 상황에 맞는 지시만
들어가도록 스킬 문서를 나눠서 관리하자."
대상: `.claude/skills/dflow-dev/`(SKILL.md·references). 기준 커밋 staging 9ce09cce(= main aeca4762 의 스킬, 킷 cb25883).
상태: **설계안. 구현은 착수 지시 뒤.** §14 실행 범위(설계만·구현부터) 확장 포함.

## 1. 결정 요약

1. **스킬은 하나로 둔다.** 진입 명령 `/dflow-dev <id8> [--worker]` 와 팀장의 spawn·재개·재시작 계약은 바꾸지 않는다. 설계 전용·구현
   전용 스킬로 나누면 claim·브랜치·기준선·state.json·마감 같은 공통 뼈대를 두 벌 두게 된다.
2. **SKILL.md 는 안내 본문(라우터)으로 줄인다.** 모든 경로에 공통인 원칙, 상태 모델의 핵심, **단계 지도**(지금 단계 → 읽을 파일),
   압축 복구 규칙만 남긴다. 목표 8,000자 이하(현재 40,970자).
3. **오케스트레이터 절차는 단계 파일로 나눈다**(`references/orch/*.md`). 오케스트레이터는 단계에 들어갈 때 그 단계 파일만
   Read 한다. 상황(수동·팀원·재개·반려)은 한 번 정하는 경로가 아니라 **단계 전환의 연속**으로 다룬다 — 팀원 새 착수가 설계 뒤
   `wait_pred` 로 멈추고, 재개 세션이 Design 검토 모드로 되돌아가는 것처럼 세션 안에서도 단계가 바뀐다.
4. **dev-discipline.md 는 파일을 나누지 않는다.** 자율 러너 킥오프 계약과 다른 스킬이 절 이름으로 가리키기 때문이다. 대신
   SKILL.md 머리의 「시작할 때 읽는 것」(착수 때 약 3만 4천 자를 한꺼번에 읽게 함)을 없애고, **단계 파일마다 「이 단계의 규율」
   목록**을 둬서 그 절만 읽게 한다. 절 추출은 새 스크립트 `sections.sh` 로 한다(제목 기준, 줄 번호 아님).
5. **worker-mode.md 는 행별 절로 재편한다.** 팀원은 지금 착수 때 표 전체(9,265자)를 읽는다. 재편 뒤에는 공통 행(D·E·`.result`)만
   시작 때 읽고, 행 B·G·H 는 그 단계 파일의 표지 블록이 가리킬 때 읽는다. 절 이름 「행 G」·「행 H」 는 그대로 둔다.
6. **중복은 정본 한 곳 + 포인터 한 줄로 정리한다**(§6 표 13건). 근거·사고 이력 문장은 rationale.md 로 옮긴다.
7. **다시 불어나지 않게 크기 상한 테스트를 둔다.** SKILL.md 는 09-25 에 25K 자로 줄였다가 하루 만에 41K 자로 돌아왔다. 기능이
   늘면 단계 파일이 커지는 것은 괜찮지만, 모든 경로가 늘 읽는 안내 본문은 커지지 않아야 한다.

## 2. 현재 상태 (실측)

### 2.1 크기 (문자 수, `wc -m`)

| 파일 | 문자 | 언제 읽나 |
|---|---|---|
| SKILL.md | 40,970 | 스킬 호출 때 통째로(압축 뒤에도 다시 주입된다) |
| dev-discipline.md 중 「시작할 때 읽는 것」 절 | 34,574 | 착수 때 한꺼번에 |
| dev-discipline.md 나머지(결정 번호·마이그레이션 버전) | 2,097 | 그 일이 생길 때 |
| worker-mode.md | 9,265 | 팀원이면 착수 때 통째로 |
| phase-prompt.md | 9,264 | Phase 를 띄울 때(오케스트레이터가 템플릿 전체를 읽는다) |

오케스트레이터가 착수 무렵 싣는 규칙 문서는 수동 경로 약 75,500자, 팀원 경로 약 84,800자다. 09-25 실측 비율(한국어 1자 ≈
0.84 토큰)로 약 63K~71K 토큰이다.

### 2.2 구조 문제

- **두 절이 본문의 62% 다.** Phase 01(10,755자)과 Phase 02~05(14,578자) 안에 새 claim 전용·반려 재작업 전용·재개 전용·`--only`
  전용 절차가 구분 없이 섞여 있다. 「설계 선행」(4,853자)은 설계 선행 세션만 쓰는데 모든 세션이 읽는다.
- **팀원 분기가 9곳에 흩어져 있다**(SKILL.md 8곳 + dev-discipline 1곳). 사람 수동 경로도 이 분기 텍스트를 모두 읽는다.
- **같은 규칙이 여러 곳에 완결된 문장으로 반복된다**(13건, §6). 가장 심한 것은 게이트 범위 대응표 판정이 SKILL.md 다섯 곳에
  나뉘어 다시 풀어 쓰인 것과, opus 승급 절차가 SKILL.md(1,558자)와 dev-discipline(1,411자)에 거의 같은 내용으로 있는 것이다.
- **압축 뒤 규칙 유실(기존 결함).** 컨텍스트 압축 뒤 SKILL.md 본문은 다시 주입되지만 Read 로 읽은 참조 문서는 사라진다. 지금도
  착수 때 읽은 dev-discipline 절과 worker-mode.md 는 압축 뒤 남지 않고, 다시 읽으라는 규칙도 없다.

### 2.3 팀원 기록 실측

dmes-standard 팀원 세션(최근 7일, 최신 14건, 모두 새 착수. 2건은 `--design-first`) 메인 transcript 를 쟀다. 누적 입력은 턴마다
input + cache_creation + cache_read 합이고, jsonl 이 한 턴을 여러 줄로 쪼개 같은 usage 를 되풀이하므로 `message.id` 로 중복을 뺐다.
토큰 비율은 스킬이 실린 다음 턴의 cache_creation 증가분으로 세션마다 직접 재서 0.816~0.848 토큰/자(평균 0.826)였다.

가중 비용은 09-26 설계와 같은 가중치(입력 1, 캐시 생성 1.25, 캐시 읽기 0.1, 출력 5)다. 문서의 가중 비용은 (토큰 × 1.25) +
(토큰 × 0.1 × 그 문서가 실린 뒤 남은 턴 수)로 셌다.

| 지표 | 가중 비용 몫 중앙값(범위) | 가중치 없는 누적 입력 몫 중앙값(범위) |
|---|---|---|
| 스킬 문서 4종(SKILL.md·dev-discipline·worker-mode·phase-prompt) | **17.2%**(9.7~39.5%) | 21.5%(13.1~45.4%) |
| SKILL.md 본문만 | 9.7%(7.2~16.4%) | 11.7%(9.2~19.1%) |
| dev-discipline.md | — | 5.6%(0.9~18.6%) |

| 그 세션이 쓴 SKILL.md 크기 | 세션 수 | 문서 4종 가중 몫 중앙값 |
|---|---|---|
| 약 25K 자(09-25 절감 직후) | 6 | 17.7% |
| 28~34K 자 | 6 | 12.8% |
| 약 41K 자(지금 판) | 2 | **30.8%** |

- 턴 수 69~159. 문서가 일찍 실리고 매 턴 캐시로 다시 실리므로 몫이 크다.
- 표본 대부분은 SKILL.md 가 25K~34K 자이던 판으로 돌았다. 지금 판(41K 자)으로 돈 두 세션은 30.8% 로, **지금 판의 몫은 중앙값보다
  클 가능성이 높다.**
- **「시작할 때 읽는 것」 준수가 제각각이다.** 14건 중 7건은 dev-discipline 을 전부(또는 sed 로 사실상 전부) 읽었고, 7건은 약 2,200자
  한 절만 읽었다. 앞쪽은 dev-discipline 몫이 8~19%, 뒤쪽은 1% 안팎이다. 읽으라는 절을 다 읽지 않은 세션이 절반이라는 뜻이기도
  하다 — 필요한 절을 필요한 때 명령 한 줄로 읽게 하면 비용과 준수를 같이 잡는다.
- 가장 높은 45.4% 는 `--design-first` 세션이 dev-discipline 전체(약 3만 9천 자)를 읽은 경우다.
- 압축은 14건 모두 0회였다. 압축 복구 규칙(§4.3)은 긴 세션 대비책이다.
- 한계: Phase 서브에이전트 transcript 는 넣지 않았다(서브에이전트는 phase-prompt 와 자기 Phase 파일만 읽는다). 09-26 집계(같은
  가중치)로 팀원 메인 세션은 Task 전체 가중 비용의 약 11.5% 이므로, 스킬 문서 몫은 Task 전체로 보면 약 2%(지금 판 기준 약 3.5%)다.
  재개·반려 세션은 표본에 없었다.
- 측정 스크립트: 세션 c327d3d2 scratchpad `measure/`(임시).

## 3. 새 파일 구조

`references/orch/` 는 오케스트레이터 전용이다. Phase 서브에이전트 파일(`phase-*.md`)과 섞이지 않게 폴더를 나눈다. 크기는 옮길
줄 범위의 실측 문자 수에 중복 정리분을 뺀 추정이다.

| 파일 | 내용(현재 SKILL.md 줄) | 읽는 때 | 크기(추정) |
|---|---|---|---|
| `SKILL.md`(안내 본문) | frontmatter·caps 표식·위치 선언 요약·게이트 집행 원칙 핵심·상태 모델 핵심(phase 값·기록 순서·exit 10·산출물 실재)·단계 지도·압축 복구·`--only`·대상 저장소 | 늘(자동) | ~6,000 |
| `orch/sweep.md` | 「Phase 01-가 — 승인 스윕」(102-142) | 수동 착수 첫 단계 | ~1,900 |
| `orch/start.md` | Phase 01 머리·1번 show 판정(143-162, 177-180): 새 착수 / 반려 / 설계 선행 재개 / 재개 / approved 갈래 | 착수 | ~1,700 |
| `orch/rework.md` | 반려 재작업 경로(163-176) | 반려 갈래 | ~800 |
| `orch/base.md` | Phase 01 2번 착수 가능 판정·선행 검사·강제 진행 스텁·기점 규칙(181-245) | 새 착수·설계 선행 재개(기점 재판정)·반려 재작업 | ~4,000 |
| `orch/claim.md` | 기점 이동·claim 명령·exit 갈래·브랜치·`prepare` 쓰기(246-288) + 재claim 격리(93-100) | 새 착수 | ~3,200 |
| `orch/baseline.md` | Phase 01 4~6번 기준선·모델 결정·준비 끝(289-311) | `prepare` | ~1,900 |
| `orch/phase-common.md` | Phase 02~05 공통: 이름 붙여 띄우기·`model` 기록·공통 프롬프트·`{VERIFY_CMDS}`·트레일러·「Phase 종료마다」 2~5·실패 일반 | 첫 Phase 진입 | ~4,400 |
| `orch/design.md` | Design 띄우기·Design 게이트·`build-start` 호출과 결과 표(331-340)·모듈 기준선(500-509) | `design` | ~1,700 |
| `orch/design-first.md` | 「설계 선행 (계약 2.9)」 1(모드)·2(멈춤 절차)·3(재개). 2 의 `build-start` 결과 표는 design.md 로 | claim 출력에 `DESIGN_FIRST_UNMET` 이 있을 때, `build-start` exit 4, `wait_pred` 재개 | ~4,300 |
| `orch/build.md` | 구현 단위·묶음·승급·advisor·재개(388-447) + Build 게이트(510-518) + Build 재시도(548-560) | `build` | ~6,600 |
| `orch/verify.md` | 감사자·작성자(448-467) + Verify·Refactor 게이트(519-534) | `verify` | ~2,800 |
| `orch/refactor.md` | Refactor 규칙(573-575) | `refactor`(수동만) | ~300 |
| `orch/close.md` | 「Phase 06 — 마감」(577-601) | Phase 06 | ~1,600 |

절 제목은 옮겨도 그대로 쓴다(「Phase 01-가 — 승인 스윕」·「설계 선행 (계약 2.9)」·「Phase 06 — 마감」·「Phase 종료마다」). 외부
참조는 파일 경로만 바꾸면 된다(§7).

## 4. 안내 본문(SKILL.md)

### 4.1 남기는 것

1. frontmatter(name·description 그대로), `<!-- dflow-caps: worker -->` 표식, 첫 `worker:begin/end` 블록.
2. 위치 선언 요약 3줄: supervised 경로, 서버 통신은 dflow.sh exit code 로 분기, dflow.sh 경로 규칙.
3. 게이트 집행 원칙 핵심: "자기 신고는 게이트가 아니다, 오케스트레이터가 직접 실행한다". 대응표·게이트 기록·도커의 세부는
   단계 파일로 간다(지금 이 절과 「Phase 종료마다」 1번이 같은 내용을 두 번 쓴다).
4. 상태 모델 핵심: phase 값 목록과 뜻, 기록 순서(산출물 커밋 → state.json → progress), exit 10 중단 처리, `order` 전체 UUID,
   재개 판정은 산출물 교차 확인. 필드별 세부(`build_model_*`·`verify_findings`·`verify_advisor`·`build_unit`·`design_first`)는 그
   필드를 쓰는 단계 파일로 옮긴다.
5. **단계 지도**(아래 4.2).
6. **압축 복구 규칙**(아래 4.3).
7. `--only`·대상 저장소(각각 200자 남짓).
8. `--worker 팀원 모드` 절 제목과 포인터 한 줄(외부 참조 11건이 「--worker」 행을 이 제목으로 가리킨다).

### 4.2 단계 지도

오케스트레이터는 **단계를 시작하기 전에 그 행의 파일을 Read 한다.** 같은 세션에서 이미 읽었고 압축이 없었으면 다시 읽지 않는다.

| 지금 | 판별 | 읽을 파일 | 이 단계의 규율(dev-discipline 절) |
|---|---|---|---|
| 수동 착수 | 플래그 없음, 새 세션 | `orch/sweep.md` → `orch/start.md` | 공통 금지·포그라운드 실행 |
| 팀원 착수 | `--worker`, 새 세션 | worker-mode.md 「공통」 → `orch/start.md` | 공통 금지·포그라운드 실행 |
| 새 claim | start 의 ready 갈래 | `orch/base.md` → `orch/claim.md` | — |
| 반려 | start 의 반려 갈래 | `orch/rework.md` (+ `orch/base.md` 는 승인 뒤 재작업일 때) | — |
| 설계 선행 재개 | agent 브랜치 state.json `phase=wait_pred` | `orch/design-first.md` 「3」 → `orch/base.md` | 개발 브랜치 재머지 |
| `prepare` | state.json | `orch/baseline.md` | 게이트 기준선·기준선 캐시·도커 사용 규칙(판정)·research/docs 특례·모델 배정·Build 모델 시험·무거운 명령(핵심) |
| `design` | state.json | `orch/phase-common.md` → `orch/design.md` | Phase 정의·구현 단위·게이트 기록·advisor 호출·(대응표가 있으면) 게이트 범위 대응표·(화면 작업이면) 화면 작업의 브라우저 E2E |
| `build` | state.json | `orch/phase-common.md` → `orch/build.md` | sonnet Build 의 opus 승급(막힐 때)·부하 민감 재실행(실패가 타이밍일 때)·강제 재실행(`dflow-bak/` 이 남았을 때) |
| `verify` | state.json | `orch/phase-common.md` → `orch/verify.md` | (위와 같음) |
| `refactor` | state.json, 수동만 | `orch/refactor.md` | Phase 05 — Refactor |
| 마감 | Verify·Refactor 게이트 통과 | `orch/close.md` | (마이그레이션을 더했으면) 마이그레이션 버전 |
| `rejected`·`reported`·`cancelled`·`merged` | state.json | `orch/start.md` | — |

- 괄호 안 조건부 절은 그 조건이 참일 때만 읽는다. 「공용 결정 기록(decisions.md)의 번호」 는 지금처럼 그 일이 생길 때 읽는다.
- 단계 파일 끝에는 "다음 단계: <파일>" 한 줄을 둔다. 지도와 어긋나지 않는지 테스트가 본다(§8).
- 모르면 **전부 읽는다**(fail-closed): state.json 을 못 읽거나 phase 가 표에 없으면 `orch/` 파일을 지도 순서대로 모두 읽는다.

### 4.3 압축 복구

> 컨텍스트 압축 요약 뒤 첫 행동: 현재 agent 브랜치의 `<TASKS>/<TSK>/state.json` 을 읽어 단계 지도의 행을 다시 찾고, 그 행의 파일과
> 규율 절을 다시 읽은 뒤 진행한다. `--worker` 면 worker-mode.md 「공통」 도 다시 읽는다.

판별은 state.json 의 `phase` 와 인자만 쓰므로 압축 전 대화 없이 다시 계산할 수 있다. 판별 스크립트(`route.sh`)는 두지 않는다 —
판별이 표 한 번 보기로 끝나고, 스크립트를 두면 팀원 허용 목록·킷 검사까지 늘어난다. 표가 복잡해지면 그때 스크립트로 옮긴다.

## 5. 규율 절 읽기 (`sections.sh`)

```bash
.claude/skills/dflow-dev/scripts/sections.sh references/dev-discipline.md '기준선 캐시' '게이트 기록'
```

- 제목 문구로 절을 찾아, 그 제목부터 같거나 높은 단계의 다음 제목 앞까지 출력한다. `##` 절을 주면 딸린 `###` 까지 나온다.
- 찾지 못한 제목이 있으면 그 제목을 `SECTION_MISSING <제목>` 으로 알리고 exit 3 이다. 오케스트레이터는 이때 파일 전체를 Read 한다
  (fail-closed).
- phase-prompt.md 도 같은 방식으로 **띄울 Phase 의 템플릿 절만** 읽는다(지금은 9,264자 전체를 읽는다).
- 팀원 세션은 `claude -p` 허용 목록에 없는 명령에서 막힌다. `kit/worker-allow.json` 에 이 스크립트를 더하고, 킷에 들어가는지
  킷 빌드 검사에 더한다.

**「무거운 명령 줄 세우기」(7,045자)는 절 안을 나눈다.** 오케스트레이터가 늘 쓰는 것(감쌀 명령·쓰는 법·`HEAVY_BUSY`/exit 75)을
`### 핵심` 으로 두고, `--detach`·독점·E2E 풀·도커 풀은 딸린 `###` 로 둔다. 절 제목은 그대로라 해소 워커 등 다른 소비자의 참조는
깨지지 않는다.

## 6. 중복 정리

| # | 규칙 | 지금 위치 | 정본 | 나머지 |
|---|---|---|---|---|
| 1 | heavy.sh 감싸기·BUSY 재호출 | dev-discipline 「무거운 명령」·phase-prompt·SKILL.md 게이트 원칙 | dev-discipline | phase-prompt 는 서브에이전트용 축약 유지, SKILL.md 는 제거 |
| 2 | 포그라운드 실행 | dev-discipline·phase-prompt·SKILL.md 「Phase 종료마다」 5 | dev-discipline | 5번은 "오케스트레이터가 직접 기다리는 법"만 남긴다 |
| 3 | 테스트 삭제·skip·완화 금지, SKIP_GUARD 금지 | 6곳 | dev-discipline 「공통 금지」 | 서브에이전트 파일은 유지(각자 읽는 유일한 문서), 오케스트레이터 파일은 포인터 |
| 4 | advisor 호출 시점 | dev-discipline·phase-prompt·SKILL.md 417-420 | dev-discipline | build.md 는 `{ADVISOR_POLICY}` 채우는 규칙 한 줄 |
| 5 | opus 승급 절차 | dev-discipline 403-424·SKILL.md 402-419 | **build.md**(집행 시점) | dev-discipline 은 원칙·이유만 |
| 6 | design.md 최소 구조 5절 | SKILL.md 40-41·dev-discipline 표·phase-design | phase-design.md | design.md(orch)는 게이트 판정 한 줄 |
| 7 | 게이트 범위 대응표 판정 | dev-discipline 92-140·SKILL.md 다섯 곳 | dev-discipline | 각 게이트 파일은 "대응표가 있으면 「게이트 범위 대응표」 대로" 한 줄 |
| 8 | 게이트 기록 | dev-discipline·SKILL.md 49·526-528 | dev-discipline | 한 줄 포인터 |
| 9 | 부하 민감 단독 재실행 | dev-discipline·SKILL.md 546·phase-build | dev-discipline | 포인터 |
| 10 | 도커 규칙 | dev-discipline 215-308·SKILL.md 50-51·worker-mode 101-104 | dev-discipline | worker-mode 는 워커 기본값 한 줄 |
| 11 | DFlow-Order 트레일러 | dev-discipline·phase-prompt·worker-mode | phase-prompt 공통 규칙 1 | phase-common.md 는 "오케스트레이터 커밋도 같다" 한 줄 |
| 12 | 게이트 판정 기준(신규 실패 0·총수 미감소) | dev-discipline 3곳·SKILL.md 43 | dev-discipline 「게이트 기준선」 | 포인터 |
| 13 | 팀원 분기 | SKILL.md 표지 블록 6곳이 행 내용을 다시 씀 | worker-mode.md 행 | 표지 블록은 "`--worker` 면 worker-mode 「행 X」" 한 줄 |

rationale.md 로 옮길 근거 문장: 상태 모델의 `order` 전체 UUID 사고(73-75), 승인 스윕의 존재 이유(108-110), 위치 선언의 러너 구도
설명(18-22), Phase 06 의 비동기 승인 설명 절반(596-599).

## 7. 외부 참조 갱신

dflow-dev SKILL.md 의 절을 이름으로 가리키는 곳은 약 50곳이다(조사 결과, 일부는 dev-discipline 절을 가리키는 것이라 영향 없음).

| 가리키는 절 | 건수 | 처리 |
|---|---|---|
| 「--worker」 행 A~I | 11 | 안내 본문에 절 제목을 남기고 정본은 worker-mode.md — **변경 없음** |
| 「설계 선행」 | 9 | `orch/design-first.md` 「설계 선행 (계약 2.9)」 로 경로만 고친다 |
| 「Phase 01-가」 | 5 | `orch/sweep.md` |
| 「Phase 06 — 마감」 | 4 | `orch/close.md` |
| 「Phase 02~05」 | 2 | `orch/phase-common.md` |
| 「Phase 종료마다」 1번·5번 | 6 | 아래 참고 |
| 「상태 모델」·「위치 선언」 | 2 | 안내 본문에 남으므로 변경 없음 |
| SKILL.md 파일 경로만(dflow-team 의 존재 확인·caps 판정) | 6 | 변경 없음 |

「Phase 종료마다」 는 절 제목이 아니라 목록 앞의 머리 문구이고, 1번(게이트 집행)은 Design·Build·Verify 세 파일로 나뉜다. 그래서
게이트마다 제목을 둔다 — `orch/design.md` 「### Design 게이트」, `orch/build.md` 「### Build 게이트」, `orch/verify.md`
「### Verify·Refactor 게이트」, 5번은 `orch/phase-common.md` 「### 서브에이전트가 끝났는데 게이트를 안 돌렸을 때」. 가리키는 곳
6곳을 하나씩 해당 제목으로 바꾼다.

| 가리키는 곳 | 지금 | 바꿀 곳 |
|---|---|---|
| SKILL.md 46(게이트 집행 원칙) | 「Phase 종료마다」 1번(재실행 생략) | verify.md 「Verify·Refactor 게이트」 |
| SKILL.md 303(기준선 4번) | 1번(모듈 기준선) | design.md 「Design 게이트」 |
| SKILL.md 331·378(설계 선행 2·3-6) | 1번(Design 게이트 뒤) | design.md 「Design 게이트」 |
| dev-discipline.md 136 | 1번(재실행 생략) | verify.md 「Verify·Refactor 게이트」 |
| dflow-team SKILL.md 950 | 「Phase 종료마다 오케스트레이터가」 5번 | phase-common.md 「서브에이전트가 끝났는데 게이트를 안 돌렸을 때」 |

dev-discipline.md 머리의 "오케스트레이터 절 목록은 SKILL.md 「위치 선언」 이 정한다" 는 "단계 지도" 로 고친다. 자율 러너 킥오프
계약(오케스트레이터 몫으로 dev-discipline 을 싣는다)은 그대로다.

## 8. 테스트 이전

현재 tests/skills 19개 파일이 SKILL.md 를 각자 `readFileSync` 해 문구를 검사한다(공용 읽기 헬퍼 없음). 단언의 대부분(8개 파일,
100건 이상)이 Phase 02~05 에 몰려 있다.

1. **경로 텍스트 헬퍼** `tests/skills/_dflow-dev-route.ts`: `routeText('manual' | 'worker' | 'design-first-resume' | 'rework')` 가
   안내 본문과 그 경로에서 읽는 `orch/` 파일을 **읽는 순서대로 이어 붙인** 텍스트를 돌려준다. 순서는 안내 본문의 단계 지도 표를
   파싱해 얻는다(표와 헬퍼가 두 벌이 되지 않게).
   - 기존 테스트의 `readFileSync(SKILL.md)` 를 `routeText('manual')`(팀원 문구 검사는 `'worker'`)로 바꾼다. `indexOf` 순서 단언
     (gate-economy 87줄·background-gate 65줄)은 같은 파일 안 순서를 유지하므로 그대로 성립한다.
   - `between(SKILL, 시작, 끝)` 은 절 제목이 그대로라 이어 붙인 텍스트에서도 성립한다. 빈 문자열이 나오면 실패하도록 헬퍼에
     `sliceOrThrow` 를 둔다(지금은 빈 문자열에 `toContain` 이 실패하는 형태로만 드러난다).
2. **원문 보존 테스트는 이동 지도로 바꾼다.** 지금 테스트(`dflow-dev-worker.test.ts`, fixture `dflow-dev.SKILL.orig.md`)의
   `firstLostLine` 은 원문 줄이 **같은 순서로** 남았는지 본다. §3 의 이동은 순서를 바꾼다 — 재claim 격리(93-100)가 claim.md 로,
   `build-start` 결과 표(331-340)가 design.md 로 가고, 원문에서 Build·Verify(388-467)보다 뒤인 공통 프롬프트·「Phase 종료마다」
   2~5(469-571)가 먼저 읽히는 phase-common.md 로 간다. rework.md·design-first.md 는 수동 경로에 들어가지 않는다. 그래서
   `routeText` 를 이어 붙인 텍스트로는 보존을 검사할 수 없다.
   - fixture `dflow-dev.move-map.txt`: `<원문 시작줄>-<끝줄> -> <대상 파일>` 한 줄씩.
   - 검사 ① 원문(옛 SKILL.md fixture)의 모든 줄이 정확히 한 범위에 속한다. ② 각 범위의 줄이 대상 파일 안에 같은 순서로 있다
     (`firstLostLine(범위 텍스트, 대상 파일, CHANGED)`).
   - 중복 정리(§6)로 지우거나 바꾼 줄은 `CHANGED` 에 더한다 — 이 목록이 **무엇을 지웠는지의 감사 기록**이 된다.
   - `routeText` 는 "그 경로에서 그 규칙이 읽히는가" 의 도달성 검사로만 쓴다.
3. **표지 블록 검사**: 개수(지금 8)·prev/next 검사를 파일별로 나눈다. 블록이 옮겨 간 파일마다 기대값을 둔다.
4. **셸 블록 검사**(`dflow-team-shell-blocks`): `DOCS` 에 `orch/*.md` 를 더한다. "SKILL.md 에 bash 블록이 최소 1개" 조건은
   안내 본문에 남는 블록(dflow.sh 경로 예시)으로 유지하거나 조건을 `orch/` 합계로 바꾼다.
5. **새 테스트**
   - 단계 지도의 파일이 모두 있고 킷에 들어간다. 각 `orch/` 파일 끝의 "다음 단계" 가 지도와 맞는다.
   - 지도의 규율 절 이름이 dev-discipline 제목에 실재한다(`sections.sh` 가 exit 0).
   - 안내 본문 크기 상한: 8,000자 이하. 넘으면 실패하고 메시지로 "단계 파일로 옮겨라" 를 알린다.
   - 「시작할 때 읽는 것」 문구가 어디에도 없다(옛 일괄 읽기 부활 방지).
   - `sections.sh` 단위 테스트(`##`/`###` 경계, 없는 제목 exit 3, 제목 안 특수문자).

## 9. 동등성 보증

1. **이동 단계와 정리 단계를 커밋으로 나눈다.** 첫 커밋은 문구를 바꾸지 않고 옮기기만 한다(포인터·게이트 제목 추가만 허용). 이동
   지도 검사(§8-2)가 `CHANGED` 없이 통과해야 한다 — "옛 SKILL.md 의 모든 줄이 어느 단계 파일엔가 순서대로 있다" 의 기계
   검증이다. 여기에 도달성 검사(각 줄이 필요한 경로의 `routeText` 에 들어 있다)를 더하면 "필요한 경로에서 읽힌다" 까지 본다.
2. 둘째 커밋에서 중복 정리·근거 이관·표지 블록 축약을 한다. 지운 줄은 모두 `CHANGED` 에 들어가므로 리뷰어는 그 목록만 보면 된다.
3. 팀원 경로는 `routeText('worker')` 에 표지 블록 본문과 worker-mode 행이 모두 들어 있는지 따로 검사한다.
4. 09-25 방식(규칙 목록 기계 추출 → 대조)은 dev-discipline 쪽에 쓴다: 「시작할 때 읽는 것」 절 목록이 단계 지도의 규율 열
   어딘가에 모두 나타나는지 검사한다(빠진 절이 있으면 그 절은 아무 단계에서도 안 읽힌다).

## 10. 기대 효과

| 경로 | 지금 싣는 문자 | 분할 뒤(추정) | 줄어드는 몫 |
|---|---|---|---|
| A 수동 착수 → 마감 | ~75,500 | ~53,000 | 팀원 분기·설계 선행·조건부 규율 절 |
| B 팀원 착수 → 설계 뒤 `wait_pred` 멈춤 | ~84,800 | ~47,000 | Build·Verify·마감·승인 스윕, 뒤 단계 규율 |
| B' 팀원 착수 → 마감 | ~84,800 | ~61,000 | 승인 스윕·Refactor·설계 선행·조건부 규율 절 |
| C 설계 선행 재개 → 마감 | ~84,800 | ~56,000 | 승인 스윕·claim |
| D 반려 재작업(수동) | ~75,500 | ~45,000 | claim·기준선·설계 선행 |

- 추정은 §3 의 파일 크기와 §4.2 의 규율 열 합계다. 조건부 절(대응표·화면 E2E·승급 등)은 읽지 않는 경우로 셌다.
- 뒤 단계 파일은 뒤에 실리므로, 캐시 재과금(매 턴 캐시 읽기)으로 치면 줄어드는 몫이 표보다 크다.
- §2.3 실측(가중 비용)에 대입하면: 팀원 메인 세션에서 스킬 문서 몫(중앙값 17.2%, 지금 판 30.8%)이 B 경로 기준 약 45% 줄어
  **메인 세션 가중 비용의 약 8~14%** 가 준다. Task 전체 가중 비용으로는 약 1~1.5% 다. 절감 자체보다 **구조 정리(중복 13건·흩어진 분기 9곳·압축 유실·읽기 지시
  불이행)** 가 이 작업의 주목적이고, 수치는 파일 경계를 정하는 데 썼다.

## 11. 위험과 대응

| 위험 | 대응 |
|---|---|
| 오케스트레이터가 다음 단계 파일을 읽지 않고 진행 | 단계 파일 첫 줄 "이 파일을 읽기 전에 이 단계를 시작하지 않는다", 각 파일 끝 "다음 단계" 포인터, 안내 본문의 지도. 실측 리허설에서 Read 호출 순서를 확인 |
| 압축 뒤 규칙 유실 | §4.3 압축 복구 규칙(지금보다 나아진다 — 지금은 복구 규칙이 없다) |
| 병렬 세션이 같은 시기에 SKILL.md 를 고쳐 충돌 | dmes-standard 세션이 dflow-dev 를 자주 고친다. 착수 전에 dmes-standard-87 에 알리고, 이동 커밋은 짧게 끝낸다. 충돌 나면 옛 SKILL.md 의 새 줄이 어느 단계 파일로 갈지 §3 표로 정한다 |
| 팀원 `claude -p` 가 새 스크립트에서 막힘 | `kit/worker-allow.json` 에 `sections.sh` 추가, 킷 검사 |
| 옛 킷을 쓰는 PC | 스킬 폴더 통째로 교체되므로 섞이지 않는다. 서버 계약 변화 없음 |
| Read 호출 증가 | 세션당 8~10회. 무시할 만하다 |

## 12. 작업 순서와 배포

1. 워크트리·브랜치 `feat/dflow-dev-router`(본 체크아웃 직접 수정 금지).
2. 경로 텍스트 헬퍼와 테스트 이전을 먼저 한다(SKILL.md 가 그대로일 때 `routeText` 가 SKILL.md 하나를 돌려주게 해서 초록 확인).
3. 이동 커밋(§9-1) → 테스트 초록.
4. `sections.sh` + worker-allow + 단계 지도 규율 열 + 「시작할 때 읽는 것」 제거.
5. 정리 커밋(§6, §9-2) + worker-mode 행별 재편 + 외부 참조 갱신(§7).
6. 크기 상한·지도 일관성 테스트.
7. 리허설: 스테이징 D'Flow 에서 수동 `/dflow-dev` 1건, 팀원 1건(설계 선행 멈춤 → 재개 포함). transcript 에서 Read 순서와 싣는 문자
   수를 잰다.
8. staging push. main·킷 반영은 지시가 있을 때만. dmes-standard 의 스킬은 wbs-web 본 체크아웃 심볼릭 링크이므로 본 체크아웃
   pull 은 dmes-standard-87 에 팀원 미가동을 확인한 뒤 한다.

## 13. 정할 것

1. 폴더 이름 `references/orch/`(제안) — 오케스트레이터 전용임을 드러낸다.
2. 판별 스크립트 `route.sh` 를 두지 않는 것(제안). 대신 표와 fail-closed 규칙.
3. 착수 시점: dmes-standard 쪽 dflow-dev 수정이 잠잠할 때.
4. §14 실행 범위의 정할 것(§14.7).

## 14. 확장: 실행 범위(설계만·구현부터·전체)

사용자 요청(2026-09-26): 설계만 먼저 진행할 수 있어야 한다. idea.md 「에이전트 스킬」 의 완전자동·개발자동·수동을 처리하려면
설계만이 기본 부품이 된다. 새 스킬은 만들지 않고, `/dflow-dev` 에 실행 범위 플래그를 두고 팀장이 그 범위를 넘긴다. 분할(§1~§12)
뒤에 얹는다 — 분할 뒤에는 단계 지도에 시작점·멈춤점 몇 행을 더하는 일로 끝나고, 지금 구조에 먼저 넣으면 분기가 또 흩어진다.

### 14.1 모드와 범위

| 모드(idea.md) | 설계 | 구현 | `/dflow-dev` 범위 | 팀장 |
|---|---|---|---|---|
| 완전자동 | 에이전트 | 에이전트 | `--scope full`(기본, 지금 그대로) | 기본 |
| 설계만(새 부품) | 에이전트 → 사람 검토 | 사람 또는 뒤이은 개발자동 | `--scope design` | 인자 "설계만" |
| 개발자동 | 사람(또는 앞서 설계만으로 만든 설계) | 에이전트 | `--scope build` | 인자 "구현부터"·"개발자동" |
| 수동 | 사람 | 사람 | 에이전트 없음 | `tags:agent` 가 없어 팀장이 보지 않는다 |

- 흐름 예: 설계만 → 사람이 design.md 를 검토·수정 → 개발자동으로 이어 구현. 이것이 "사람 검토 관문이 있는 완전자동" 이다.
- `--only` 와 다르다. `--only` 는 서버 보고·state.json 전진이 없는 부분 실행이고, `--scope` 는 claim·단계·보고가 모두 도는 정식
  실행에서 시작점과 멈춤점만 바꾼다.
- 사람이 직접 `/dflow-dev <ref> --scope design` 으로 쓸 수도 있다(수동 모드에서 설계만 도움받기).

### 14.2 `--scope design`: 설계 뒤 멈춤

설계 선행(§3 `orch/design-first.md`)의 멈춤 절차를 **사유만 바꿔** 쓴다.

1. claim·기준선·Design·Design 게이트는 지금과 같다(claim 은 늘 `--design-first` 라 서버 단계는 `ds`).
2. Design 게이트 뒤 `build-start` 를 **부르지 않는다**(부르면 서버 단계가 `ip` 로 넘어간다).
3. 멈춤: design.md 커밋 확인 → state.json `phase=wait_review`, `scope: "design"` 기록·커밋 → `progress 25 "설계 완료(검토 대기)"` →
   agent 브랜치 push → `heartbeat --phase wait_review` → supervised 는 "설계 완료·검토 대기 — 검토 뒤 `--scope build` 로 이어 간다",
   워커는 `.result` 에 `design_review <branch> <head_sha>`.
4. 미충족 선행이 있어도 같다(`design_first.unmet` 도 함께 적는다). 이어 갈 때 선행 판정은 §14.3 이 한다.

**새 phase 값 `wait_review` 를 쓰는 이유**: 팀장의 설계 완료 대기 목록(design-ahead.md 「1」)은 로컬 state.json `phase=wait_pred`
를 골라 선행이 풀리면 **자동으로 Build 를 재개**한다. 설계만 멈춘 작업이 `wait_pred` 면 사람 검토 없이 구현이 시작된다. 다른 값을
쓰면 자동 재개 대상에서 저절로 빠진다.

### 14.3 `--scope build`: 구현부터

설계의 출처가 둘이다.

| 출처 | 판별 | 처리 |
|---|---|---|
| 앞서 설계만으로 만든 설계 | 서버 `claimed`·`mine` 이고 agent 브랜치 state.json `phase=wait_review` | 설계 선행 재개(`orch/design-first.md` 「3」)를 그대로 탄다: 브랜치로 switch → 선행 판정 → 기점 재판정·머지 → 기준선 다시 잼 → **Design 게이트를 다시 돈다**(사람이 design.md 를 고쳤을 수 있다) → `build-start` → Build |
| 사람이 쓴 설계(개발자동) | 서버 `ready`, 개발 브랜치의 `<TASKS>/<TSK>/design.md` 가 있다 | **claim 전에** `git show origin/<기본브랜치>:<TASKS>/<TSK>/design.md` 로 읽어 Design 게이트의 최소 구조 5절을 본다. 없거나 빠진 절이 있으면 claim 하지 않고 건너뛴다(워커 `.result` `skipped design_missing` 또는 `skipped design_invalid <빠진 절>`). 통과하면 claim → 브랜치 → 기준선 → Design 서브에이전트 없이 Design 게이트 → `build-start` → Build |

- 에이전트가 빠진 절을 스스로 채우지 않는다. 개발자동의 전제가 "사람이 설계한다" 이기 때문이다.
- 선행이 미충족이면 지금처럼 `build-start` exit 4 로 `wait_pred` 멈춤이 된다 — 이때부터는 선행 대기라 팀장 자동 재개가 맞다.
- 사람이 쓸 설계 형식은 phase-design.md 의 design.md 구조를 따른다. 빈 틀을 내는 명령(예: `dflow.sh design-template <ref>`)은 쓰임을
  보고 더한다.

### 14.4 팀장(`/dflow-team`)

- 인자: 자연어로 "설계만" → `design`, "구현부터"·"개발자동" → `build`, 없으면 `full`. 팀장 상태에 기록해 재시작·압축 뒤에도
  유지한다. 팀원 spawn 명령에 `--scope <값>` 을 붙인다(`full` 이면 붙이지 않아 지금 명령과 같다).
- 후보
  - `design`: 지금과 같은 ready 후보. 설계 선행 상한(`DFLOW_DESIGN_AHEAD_MAX`)은 적용하지 않는다(모든 슬롯이 설계를 한다).
  - `build`: ① 이 PC 의 `wait_review` 워크트리(design-ahead.md 「1」 목록을 `wait_review` 로도 뽑는다) → 재개 spawn, ② ready 후보 중
    개발 브랜치에 design.md 가 있는 것. 없는 것은 poll 단계에서 거른다(워커를 띄워 곧 `skipped` 로 끝내는 낭비를 막는다).
  - `full`: 지금 그대로. `wait_review` 워크트리는 재개하지 않는다.
- 결과 `design_review`: 좌석을 비우고 워크트리를 지운다(브랜치는 push 돼 있어 재개 때 `origin/agent/…` 에서 다시 만든다 —
  resume.md 3항). 설계만으로 여러 건을 돌리면 워크트리가 쌓이기 때문이다.
- 좌석표 「이어서 시작」 요청은 `wait_review` 에도 받는다 — 사람이 검토를 마친 한 건만 구현으로 넘기는 손잡이가 된다(그 요청은
  `--scope build` 로 띄운다).

### 14.5 서버·화면

- `heartbeat_phase` 에는 DB CHECK 가 없다(0107 주석) — **마이그레이션 없음.** `src/lib/domain/seatState.ts` 의 `HEARTBEAT_PHASES` 에
  `wait_review` 를 더하고, 좌석·대기 사유·허브 집계(`seatmap.ts`·`waitReason.ts`·`agentHub.ts`)에 "설계 검토 대기" 를 `wait_pred`
  와 구분해 표시한다(결재 대기 수에는 넣지 않는다).
- 서버 단계는 `ds`(설계 중)로 남는다. WBS 에서 "설계 완료·검토 대기" 로 보이게 할지는 화면 쪽 선택이다.
- 계약 버전을 올린다(2.10). 옛 서버에서는 `heartbeat --phase wait_review` 가 400 이지만 멈춤은 계속한다 — 좌석 이름표만 틀리고
  자동 재개 판정은 로컬 state.json 이 하므로 안전하다.

### 14.6 나중 단계

- **작업별 모드**: 팀장 인자는 그 팀이 처리하는 모든 작업에 같이 적용된다. 작업마다 다르게 하려면 D'Flow 태그(예: `mode:design`·
  `mode:build`)를 팀장이 읽어 인자보다 우선하게 한다.
- **설계 승인 버튼**: 지금은 사람이 검토 뒤 팀장을 `구현부터` 로 돌리거나 좌석 「이어서 시작」 을 누른다. D'Flow 에 "설계 승인"
  을 두면 팀장이 감지해 자동으로 넘길 수 있다(서버 계약 변경).
- 다른 코딩 에이전트(idea.md)는 범위 플래그와 무관하다 — 그때 스킬 경계를 다시 본다.

### 14.7 정할 것

1. 플래그 이름 `--scope design|build|full`(제안). `--until`·`--from` 은 팀장 인자의 종료 시각(`--until`)과 헷갈린다.
2. 사람이 쓴 설계를 두는 곳: 개발 브랜치의 `<TASKS>/<TSK>/design.md`(제안). D'Flow spec 첨부로 받는 안도 있지만 게이트가 파일을
   읽는 지금 구조와 맞지 않는다.
3. 설계만 멈춤의 phase 값 `wait_review`(제안)와 좌석 문구 "설계 검토 대기".

## 15. 구현 결과와 설계와 달라진 점 (2026-09-26)

브랜치 `feat/dflow-dev-router`(staging). 커밋: 이동(95dde56a) → 규율 절 읽기·정리(ba2d59ee) → 외부 참조(0b666a80) →
Verify 생략 문구(4e92b9de) → `--scope`(76f3c7b8) → 팀장 범위 인자(63e9c68d) → 문서(855eb3b2) → 검토 대기 재개 보강 →
앱 `wait_review`·계약 2.10(feat/wait-review a68c5a7e 머지).

| 항목 | 설계 | 실제 |
|---|---|---|
| 안내 본문 크기 | 8,000자 이하 | **8,926자**, 상한 테스트는 9,000자. 실행 범위 절(약 500자)과 압축 복구 규칙이 더해졌다 |
| 단계 파일 | 13개 | 13개(`references/orch/`). `build-start` 결과 표는 design.md, 재claim 격리는 claim.md 로 |
| 판별 스크립트 | 두지 않음 | 두지 않음(단계 지도 표 + fail-closed) |
| worker-mode | 행별 절로 재편 | **재편하지 않았다.** 착수 때 머리 표와 「그 밖의 워커 규칙」 만 `sections.sh` 로 읽고, 「행 G」·「행 H」·「설계 선행」 은 그 단계에서 읽는다(기존 `##` 절을 그대로 씀) |
| 중복 13건 | 정본 + 포인터 | **안내 본문 쪽만 줄였다**: 게이트 세부 5줄 삭제, 상태 모델 선택 필드 설명을 쓰는 단계 파일로 이동, 상대 참조 13곳을 파일·절 이름으로. dev-discipline·phase-prompt·phase-*.md 사이의 중복(opus 승급 절차 두 벌, 테스트 삭제 금지 6곳 등)은 **그대로다** — 서브에이전트는 자기 파일만 읽으므로 한쪽을 지우면 그 독자가 규칙을 잃는다. 정리하려면 읽는 쪽별로 따로 설계해야 한다 |
| 무거운 명령 절 | 절 안을 나눔 | 소제목 셋(분리·독점 / 슬롯·부하 / E2E·도커)을 달아 `=무거운 명령 줄 세우기` 로 핵심 2,409자만 읽는다 |
| phase-prompt | 템플릿 절만 | `변수`·`템플릿`(감사자는 `감사 템플릿`)만 읽는다 |
| 팀원 허용 목록 | `sections.sh` 추가 | `kit/worker-allow.json` 이 빈 목록이라 **바꾸지 않았다** |
| 원문 보존 | 이동 지도 | `tests/skills/fixtures/dflow-dev.move-map.txt` + `CHANGED_SPLIT`(지우거나 바꾼 옛 줄 33개, 이유별 주석) |
| 실행 범위 | §14 | 그대로. 더한 것: 검토 대기 재개 때 origin 의 사람 수정을 fast-forward 로 받고 갈라지면 멈춘다, `scope` 를 `build` 로 덮어쓴다, 승인 스윕이 `wait_review` 브랜치를 뺀다, 좌석 「설계 검토 대기」 에 「이어서 시작」 버튼 |
| 함께 고친 것 | — | dev-discipline 도커 규칙의 MSSQL 예시를 제품 중립으로(dmes MSSQL 폐지), phase-verify 재실행 생략 조건에 모듈 범위 예외(dmes TSK-09-02 .issues) |

남은 일: 스테이징 D'Flow 에서 수동 1건·팀원 1건(설계만 → 검토 → 구현부터 포함) 리허설(§12-7). 전체 테스트 실행 때만 흔들리는
테스트 4개(heartbeat-hook·lead-lease·lead-worktree·done-decisions)는 단독 실행에서 통과한다(부하 민감, 이번 변경과 무관).
