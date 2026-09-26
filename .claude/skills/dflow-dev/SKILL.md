---
name: dflow-dev
description: D'Flow 작업 1건의 전체 개발 사이클 실행 (승인 스윕→claim→설계→TDD구현→검증→완료보고). 시작 시 승인된(approved) 로컬 작업을 먼저 main 에 머지한다(/dflow-merge 흡수, 2026-08-24). 대화형 supervised 전용 — 무인 실행은 자율 러너 설계(2026-08-20)의 영역이다. 구현 규율 정본은 이 스킬의 references/dev-discipline.md. 트리거 - "/dflow-dev", "작업 구현해", "D'Flow 작업 개발". 사용법 - /dflow-dev <순번|TSK-ID> [--only design|build|verify|refactor] [--model opus|sonnet]
---
<!-- dflow-caps: worker — 팀장·워커가 이 줄로 기능 지원을 판정한다. 지우거나 바꾸지 않는다. -->

# /dflow-dev — D'Flow 작업 개발 사이클 (supervised)

인자: `$ARGUMENTS` (`<순번|TSK-ID>` + 옵션)

<!-- worker:begin -->
> `--worker` 는 `/dflow-team` 팀장 전용 플래그다(사람이 직접 쓰지 않는다). 있으면 아래 「--worker 팀원 모드」
> 절의 아홉 행(A~I)만 달라지고, 없으면 이 문서 절차 그대로다.
> `--worker` 면 **지금 `.claude/skills/dflow-dev/references/worker-mode.md` 의 머리(아홉 행 표)와 「그 밖의 워커 규칙」 을 읽는다**:
> `.claude/skills/dflow-dev/scripts/sections.sh .claude/skills/dflow-dev/references/worker-mode.md '=/dflow-dev --worker' '그 밖의 워커 규칙'`.
> 그 파일의 「행 G」·「행 H」 는 단계 파일의 표지 블록이 가리킬 때, 「설계 선행」 은 `orch/design-first.md` 를 읽을 때 같은 방법으로 읽는다.
<!-- worker:end -->

> **위치 선언**: 이 스킬은 자율 러너 설계(wbs-web 리포 docs/superpowers/specs, 킷에는 미동봉)의
> **L0(supervised)** 대화형 경로다. 무인 루프는 러너의 영역이며 이 스킬은 사람이 기동·관찰하는
> 세션에서만 쓴다. 구현 과정 규율(Phase 정의·TDD·게이트 기준선·모델 배정·공통 금지)의 정본은
> `.claude/skills/dflow-dev/references/` 의 규율 문서다(Phase 서브에이전트는 자기 Phase 파일만 읽는다). 이 파일은 규율을
> 중복 서술하지 않고 오케스트레이션(순서·게이트 집행·상태·서버 보고)만 정의한다.
>
> **규율 읽기**: 구현 과정 규율의 정본 `.claude/skills/dflow-dev/references/dev-discipline.md` 는 **통째로 읽지 않는다.** 아래
> 「단계 지도」 의 규율 열에 적힌 절은 그 단계를 시작할 때, 단계 파일이 dev-discipline 「절 이름」 을 가리키면 그 자리에서 그
> 절만 읽는다(같은 세션에서 이미 읽었고 압축이 없었으면 다시 읽지 않는다). 절은 `.claude/skills/dflow-dev/scripts/sections.sh
> .claude/skills/dflow-dev/references/dev-discipline.md '<절 제목 앞부분>' …` 로 뽑는다 — 제목 앞에 `=` 를 붙이면 딸린 절 없이
> 그 제목의 본문만 나온다. exit 3(`SECTION_MISSING`)이면 그 파일 전체를 Read 한다. Phase 서브에이전트에게 주는 문구는
> `references/phase-prompt.md` 다. 규칙의 이유·사고 이력은 `references/rationale.md` 에 있다(실행 중에는 읽지 않는다).
>
> 서버 통신은 전부 dflow.sh 로 하고 산문 파싱 금지 — exit code 로 분기한다. dflow-work 의
> 금지사항 전부 상속. **dflow.sh 경로**: 대상 리포(cwd)의 `.claude/skills/dflow-work/scripts/dflow.sh`
> (환경변수 `DFLOW_SH` 가 있으면 그것이 우선). 경로는 **대상 리포 기준**으로 쓴다 —
> 킷(install.sh)도 리포 안 `.claude/skills/` 에 설치하므로 `~/.claude/skills/...` 를 추측하지 않는다.

## 게이트 집행 원칙 (이 스킬의 존재 이유)

Phase 서브에이전트의 `PHASE_RESULT` 자기 신고는 **참고 신호일 뿐 게이트가 아니다.**
게이트 판정은 오케스트레이터(이 스킬을 실행하는 세션)가 **자기 손으로 명령을 실행**해서 한다:

- Design 게이트: `<TASKS>/<TSK>/design.md` 를 Read 하고 dev-discipline 의 최소 구조 5절
  (접근·파일 목록·테스트 전략·수용 기준 매핑·불변 규칙)이 실재하는지 확인. 없으면 실패.
- Build/Verify/Refactor 게이트: **오케스트레이터가 테스트 명령을 직접 실행**하고 exit code 와
  출력을 기준선과 차분 비교한다(신규 실패 0 + 테스트 총수 미감소). 서브에이전트가 "통과했다"고
  말해도 직접 실행 결과가 판정이다.
  게이트별 명령·범위(대응표)·재실행 생략·기록은 그 Phase 파일의 「Design 게이트」·「Build 게이트」·「Verify·Refactor 게이트」 가 정한다.
- 도커: 기준선 전에 금지 모드를 판정해 기준선·게이트·Phase 프롬프트에서 도커 명령을 빼거나, 금지가 아니면 도커 슬롯
  (`heavy.sh --pool docker`)에서만 돌린다. 도커 런타임은 켜지 않는다. 정본은 dev-discipline.md 「도커 사용 규칙」.

## 상태 모델

정본은 **산출물 실재**다. state.json 과 서버 progress 는 보조 신호다.

- 로컬 `<TASKS>/<TSK>/state.json`:
  `{ "tsk", "order", "api_base", "phase", "baseline": {"failures": N, "tests": M}, "last": {"phase","event"} }`
  선택 필드(`model`·`build_unit`·`build_model_base`·`build_model_trial`·`verify_findings`·`verify_advisor`·`design_first`·`branch_base`·
  `risk`·게이트 기록 등)의 뜻과 쓰는 때는 그 필드를 쓰는 단계 파일에 있다.
  `phase` 값: `ready`·`design`·`build`·`verify`·`refactor`·`reported`·**`rejected`**·`merged`.
  `ready` 는 `dflow.sh scaffold` 가 만든 초기값이다(주문 전 폴더 자리). 진행 중 phase 가 아니므로 스윕·재개 판정은 건너뛴다.
  `rejected` 는 서버가 반려를 통지한 상태다 — 승인 대기(reported)와 구분해야 스윕이 헛돌지 않는다.
  `wait_pred` 는 설계를 마치고 선행을 기다리며 멈춘 상태다(「설계 선행」 2). 진행 중 phase 가 아니며 heartbeat 훅도 보내지 않는다 —
  재개는 Phase 01 1번이 「설계 선행」 3 으로 보낸다.
  **`order` 는 전체 UUID(하이픈 포함 36자)로 기록한다 — id8 금지.** 주문이 approved 가 되면
  목록에서 빠져 id8 접두 해석이 죽고, poll 의 승인 감지(exit 9)와 머지 판정이 그 주문을
  영영 못 본다(2026-08-25 실증). 기존 파일이 id8 이면 발견 즉시 전체 UUID 로 고쳐 커밋한다.
  기록 순서 고정: **산출물 커밋 → state.json 갱신 → progress 보고.** progress 보고가 실패(exit≠0)해도
  state 는 유지하고 그 사실만 보고한다(성공 Phase 를 되돌리지 않는다).
  **예외는 exit 10(중단됨)이다** — 사람이 D'Flow 에서 중단했다(주문 `cancelled`, 위임 해제). progress·heartbeat·done 중
  어느 호출이든 exit 10 이면 **그 자리에서 멈춘다**(다음 Phase·재시도 없음). state.json 을 `phase=cancelled` 로 바꾸고 로컬
  커밋만 남긴다(**push 하지 않는다**, done 하지 않는다). 사용자에게는
  `"{TSK} 중단됨 — D'Flow 에서 사람이 멈췄습니다. 로컬 커밋만 남겼습니다."` 한 줄로 알린다. heartbeat 훅도 409 `cancelled` 를
  받으면 `~/.dflow/hb/<order>.cancelled` 표식을 남기고 세션을 세운다(`continue:false`, 표식이 있는 동안 도구마다). 표식은
  `/dflow-team` 팀장이 spawn 직전에 서버 status(`ready`·`claimed`)로 확인하고 지운다. 수동 `/dflow-dev` 세션은 사람이
  지운다. `cancelled` 는 진행 중 phase 가 아니다 — 스윕·재개 판정은 건너뛴다.
  **`api_base` 는 claim 한 시점의 `DFLOW_API_BASE` 에서 끝 `/` 를 뺀 값이다**(dflow.sh `base()` 와 같은 정규화). 스윕이
  이 값으로 자기 D'Flow 인스턴스의 후보만 고른다. Phase 01 에서 state.json 을 처음 쓰는 곳(3번 `prepare`·스택 기록 또는
  4번 기준선)에서 기록한다. 반려 재작업이 기존 state.json 에 `phase=rejected` 를 쓸 때 `api_base` 가 없으면 같은 규칙으로 채운다.
- 실패 시 `phase` 는 되돌리지 않고 `last.event=*.fail` 만 기록 — 재실행 시 같은 Phase 재개.
- **재개 판정은 산출물 교차 확인으로**: state.json 이 있어도 그 phase 의 선행 산출물
  (design.md·Build 커밋)이 현재 트리에 실재하는지 확인하고, 없으면 **산출물이 있는 지점까지
  후퇴해서 재시작**한다. 서버 progress 숫자는 힌트일 뿐 복원 정본이 아니다 — progress 는
  "보고가 있었다"의 증거지 "산출물이 이 트리에 있다"의 증거가 아니다(타 PC 재개·매핑 밖 값 대비).

## 단계 지도

이 문서는 모든 단계에 공통인 규칙만 담는다. 단계별 절차는 `.claude/skills/dflow-dev/references/orch/` 의 단계 파일에 있다(아래
`orch/…` 는 그 폴더 기준). **단계를 시작하기 전에 그 행의 파일을 Read 하고 규율 열의 절을 읽는다** — 읽기 전에는 그 단계를
시작하지 않는다. 같은 세션에서 이미 읽었고 그 뒤 컨텍스트 압축이 없었으면 다시 읽지 않는다. 단계 파일 끝의 「다음 단계」 가 다음에
읽을 파일을 가리킨다. 규율 열은 dev-discipline.md 의 절 제목 앞부분이다(위 「규율 읽기」 의 `sections.sh` 인자 그대로).

| 지금 | 판별 | 읽을 파일(순서대로) | 규율(dev-discipline 절) |
|---|---|---|---|
| 수동 착수 | 플래그 없음, 세션 시작 | `orch/sweep.md` → `orch/start.md` | `공통 금지` `포그라운드 실행` |
| 팀원 착수 | 팀원 모드(첫 표지 블록), 세션 시작 | `orch/start.md` | `공통 금지` `포그라운드 실행` |
| 새 claim | `orch/start.md` 의 ready 갈래 | `orch/base.md` → `orch/claim.md` | — |
| 설계 선행 모드 | claim 출력에 `DESIGN_FIRST_UNMET` | `orch/design-first.md` | — |
| 반려 재작업 | `orch/start.md` 의 반려 갈래, state.json `phase=rejected` | `orch/rework.md` | — |
| 설계 선행 재개 | `orch/start.md` 의 설계 선행 재개 갈래, state.json `phase=wait_pred` | `orch/design-first.md` → `orch/base.md` | `개발 브랜치 재머지` |
| 준비 | state.json `phase=prepare` | `orch/baseline.md` | `=게이트 기준선` `기준선 캐시` `research/docs` `도커 사용 규칙` `=무거운 명령 줄 세우기` `=모델 배정` `Build 모델 시험` |
| Design | state.json `phase=design` | `orch/phase-common.md` → `orch/design.md` | `Phase 정의` `게이트 기록` `advisor 호출` |
| Build | state.json `phase=build` | `orch/phase-common.md` → `orch/build.md` | `sonnet Build 의 opus 승급` |
| Verify | state.json `phase=verify` | `orch/phase-common.md` → `orch/verify.md` | — |
| Refactor | state.json `phase=refactor`(수동만) | `orch/phase-common.md` → `orch/refactor.md` | `Phase 05` |
| 마감 | Verify(수동은 Refactor) 게이트 뒤 | `orch/close.md` | — |
| 그 밖 | state.json 이 없음·`ready`·`reported`·`merged`·`cancelled` | `orch/start.md` | — |

- 조건이 있는 절은 단계 파일이 가리킬 때 읽는다: 리포에 `.dflow-gates` 가 있으면 `게이트 범위 대응표`, 화면 작업이면
  `화면 작업의 브라우저 E2E`, 신규 실패가 모두 타이밍·성능 테스트면 `부하 민감 테스트`, 명령이 10분을 넘을 것 같으면
  `분리 실행·독점 실행`, 결정 번호가 필요하면 `공용 결정 기록`, 마이그레이션을 더하면 `마이그레이션 버전`.
- 이전 단계에서 읽은 절은 다음 단계에서도 유효하다(예: Build 도 「준비」 에서 읽은 `기준선 캐시`·`무거운 명령` 을 따른다).

**모르면 전부 읽는다**(fail-closed): state.json 을 못 읽거나 `phase` 가 표에 없거나 어느 행인지 애매하면 `orch/` 의 파일을
sweep·start·rework·base·claim·baseline·design-first·phase-common·design·build·verify·refactor·close 순서로 모두 읽고
dev-discipline.md 도 전체를 Read 한다.

## 압축 뒤

컨텍스트 압축 요약 뒤 첫 행동은 단계 지도의 행을 다시 찾는 것이다. 이 작업의 agent 브랜치(`agent/<주문id8>-*`) 위면
`<TASKS>/<TSK>/state.json` 의 `phase` 로, agent 브랜치 전이면 「수동 착수」·「팀원 착수」 행으로 찾는다. 그 행의 파일과 규율 절,
그리고 그 앞 단계들의 규율 절을 다시 읽은 뒤 진행한다. 압축 요약의 기억으로 단계 절차를 대신하지 않는다.
<!-- worker:begin -->
`--worker` 면 `references/worker-mode.md` 의 머리 표와 「그 밖의 워커 규칙」 도 다시 읽는다.
<!-- worker:end -->

<!-- worker:begin -->
## --worker 팀원 모드 (팀장 전용)

**팀장 전용, 사람이 직접 쓰지 않는다.** 행 A~I 와 세부 규칙(행 G 기본 브랜치 반영 확인·행 H 설치·도커·`.result`)의 정본은
`.claude/skills/dflow-dev/references/worker-mode.md` 다 — 이 문서 머리의 첫 표지 블록에서 이미 읽었다. 이 문서의 「--worker」
A~I 는 그 파일의 행이다.
<!-- worker:end -->

## --only 옵션

해당 Phase 만 실행. 서버 보고·state.json 갱신 없음(부분 실행은 상태 전진이 아니다).
단, 현재 state 의 phase 와 다른 Phase 를 지정하면 산출물 덮어쓰기 위험을 경고하고
사용자 확인 후 진행한다(예: build 완료 상태에서 `--only design` 은 design.md 를 덮어쓴다).

## 대상 저장소

현재 작업 디렉터리의 repo 에서 작업한다. 올바른 폴더에서 실행하는 것은 호출자 책임
(저장소↔프로젝트 매핑 자동화는 보류된 설계 — 메모리 dflow-ops-structure 참조).
wbs-web 자신이 대상이면 G1(마이그레이션 혼합)·G2(UI 위험 파일)·G4(마이그레이션 리허설)를
사용자에게 사전 경고한다. 마이그레이션이 포함된 작업은 done 이후에도 스테이징 리허설 없이는
main 에 못 간다는 것을 done 요약에 명시한다.
