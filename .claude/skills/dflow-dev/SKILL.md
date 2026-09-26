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
> `--worker` 면 **지금 `.claude/skills/dflow-dev/references/worker-mode.md` 를 Read 한다** — 아홉 행과 워커 규칙이 그 파일에
> 있고, 아래 절차가 행 A 부터 곧바로 가리킨다.
<!-- worker:end -->

> **위치 선언**: 이 스킬은 자율 러너 설계(wbs-web 리포 docs/superpowers/specs, 킷에는 미동봉)의
> **L0(supervised)** 대화형 경로다. 무인 루프는 러너의 영역이며 이 스킬은 사람이 기동·관찰하는
> 세션에서만 쓴다. 구현 과정 규율(Phase 정의·TDD·게이트 기준선·모델 배정·공통 금지)의 정본은
> `.claude/skills/dflow-dev/references/` 의 규율 문서다(Phase 서브에이전트는 자기 Phase 파일만 읽는다). 이 파일은 규율을
> 중복 서술하지 않고 오케스트레이션(순서·게이트 집행·상태·서버 보고)만 정의한다.
>
> **시작할 때 읽는 것**: **`.claude/skills/dflow-dev/references/dev-discipline.md`** 의 「게이트 기준선」(「기준선 캐시」·
> 「게이트 범위 대응표(.dflow-gates)」·「강제 재실행」·「게이트 기록」·「부하 민감 테스트(타이밍·성능)의 단독 재실행」·「research/docs 작업 특례」 포함)·「화면 작업의 브라우저 E2E」·「도커 사용 규칙」·「Phase 정의」·「Phase 05 — Refactor」·「모델 배정」·「무거운 명령 줄
> 세우기」·「포그라운드 실행(백그라운드 게이트 금지)」·「공통 금지」 절을 읽고 그대로 따른다. 「공용 결정 기록(decisions.md)의
> 번호」·「마이그레이션 버전」 은 그 일이 생길 때 읽는다. Phase 서브에이전트에게 주는 문구는 `references/phase-prompt.md` 다.
> 규칙의 이유·사고 이력은 `references/rationale.md` 에 있다(실행 중에는 읽지 않는다).
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
  전체 스위트는 **Build 게이트에서 한 번** 돈다. Verify·Refactor 게이트는 그 Phase 가 코드를 바꿨을 때만 다시 돌고,
  아니면 Build 게이트 결과를 그대로 쓴다(아래 「Phase 종료마다」 1번). 게이트 명령은 `heavy.sh` 로 감싼다.
  **리포에 게이트 대응표(`.dflow-gates`)가 있으면** Build 게이트는 이 Task 가 바꾼 모듈의 명령만 돌고, 전체 스위트는
  Verify 게이트에서 한 번 돈다(dev-discipline 「게이트 범위 대응표(.dflow-gates)」). 대응표가 없으면 위 그대로다.
  게이트를 돌릴 때마다 build-log.md `## 게이트 기록` 에 한 줄을 남긴다(dev-discipline 「게이트 기록」).
- 도커: 기준선 전에 금지 모드를 판정해 기준선·게이트·Phase 프롬프트에서 도커 명령을 빼거나, 금지가 아니면 도커 슬롯
  (`heavy.sh --pool docker`)에서만 돌린다. 도커 런타임은 켜지 않는다. 정본은 dev-discipline.md 「도커 사용 규칙」.

## 상태 모델

정본은 **산출물 실재**다. state.json 과 서버 progress 는 보조 신호다.

- 로컬 `<TASKS>/<TSK>/state.json`:
  `{ "tsk", "order", "api_base", "phase", "baseline": {"failures": N, "tests": M}, "last": {"phase","event"} }`
  `model`(선택)은 **지금 도는 Phase 서브에이전트의 모델**이다(아래 Phase 02~05). heartbeat 훅이 서버로 실어 좌석표 명찰이
  Phase 마다 바뀐다.
  `build_unit`(선택)은 지금 도는 구현 단위(`B1`…)다. 병렬 묶음이면 동시에 도는 단위를 쉼표로 잇는다(`"B1,B2"`).
  단위가 몇 개든 `phase` 는 Build 동안 `build` 하나다.
  `build_model_base`·`build_model_trial`(Phase 01 5번)은 배정표가 정한 Build 모델과 Build 모델 시험 여부(`true`|`false`)다 —
  한 번 적으면 재개해도 다시 판정하지 않는다(dev-discipline 「Build 모델 시험(build_model_trial)」).
  `verify_findings`(선택)는 Verify 감사자 역할별 지적 수 `{"spec":n,"review":n,"tests":n}` 이고, `verify_advisor`(선택)는 Verify 의
  advisor 호출 수 `{"writer":n,"audit":<감사자 셋의 합>}` 다(비교 지표 — 감사 파일은 지워진다).
  `design_first`(선택)는 설계 선행 모드의 표식 `{"unmet": ["<선행 external_ref>", …]}` 이다(「설계 선행」). 재개한 뒤에도 기록으로 남긴다.
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
- **재claim 시 이전 시도의 잔재 격리**: claim 하려는 작업의 `<TASKS>/<TSK>/` 가 이미 있으면
  `<TASKS>/<TSK>.prev-<날짜>/` 로 옮긴 뒤 시작한다(stale state 로 Phase 건너뜀 방지).
  **반려 재작업은 예외** — 산출물이 심사 대상이었던 그 트리이므로 옮기지 않고 그 위에서 고친다.
  **재개도 예외다.** show 가 `status=claimed` 이고 `mine=true` 면 이미 잡은 작업이라 claim 도 격리도 하지 않는다. 격리는
  **신규 claim 경로에서만** 돈다(잘못 돌면 design.md 가 `.prev-` 로 밀려 Design 부터 다시 한다).
  **scaffold 가 만든 폴더도 예외다.** 폴더 안에 `state.json` 하나만 있고 `phase=ready` 이면 잔재가 아니다(`dflow.sh scaffold`
  가 미리 만든 자리). 옮기지 않고 `order`·`api_base` 를 이번 claim 값으로 덮어쓴 뒤 진행한다(남이 만든 ready 파일도 같다).
  파일이 더 있거나 `phase` 가 `ready` 가 아니면 종전대로 격리한다.

## Phase 01-가 — 승인 스윕(머지, 오케스트레이터 본인)

<!-- worker:begin -->
> `--worker` 면 이 절 전체를 건너뛰고, 스윕은 팀장 몫이라는 이유를 한 줄 남긴다(「--worker」 A).
<!-- worker:end -->

**claim 보다 먼저** 실행한다. `/dflow-merge` 의 절차를 그대로 흡수한 것 — 사람이 D'Flow 웹에서
승인해 놓고 아무도 main 에 반영을 안 시키는 게 병목이었다(2026-08-24). 대상 작업의 claim 여부와
무관하게 매 호출마다 돈다.

0. **사전 검사 — 후보가 없으면 `/dflow-merge` 를 읽지 않는다.** 스크립트로 후보를 먼저 본다(서버 조회 없이, 후보 정의는
   아래 1번과 같다).
   ```bash
   .claude/skills/dflow-merge/scripts/sweep-check.sh --dev '<기본브랜치>'; echo "rc=$?"
   ```
   | 마지막 줄 | 처리 |
   |---|---|
   | `SWEEP_CANDIDATES n=<N> <id8…>` | `/dflow-merge` SKILL.md 를 읽고 1~6번을 한다 |
   | `SWEEP_NONE` | `/dflow-merge` 를 읽지 않고 1~5번을 건너뛴다. 6번 집계는 "스윕 생략(후보 없음)" 한 줄이다 |
   | `SWEEP_UNKNOWN <사유>`, 빈 출력, 스크립트 없음(옛 킷), `rc` 가 0 이 아님 | **스윕을 돌린다**(fail-open) — 위 `SWEEP_CANDIDATES` 와 같다. 사유를 한 줄 보고한다 |

   글자 그대로 `SWEEP_NONE` 일 때만 건너뛴다(판정 불가를 후보 없음으로 뭉개면 승인된 작업이 머지되지 않는다).
   `SWEEP_NONE` 인데 출력에 `SWEEP_DIALECT_PENDING <sha>` 줄이 있으면 방언 검증을 직접 한 번
   부르고 그 결과 줄을 6번 집계에 싣는다(`/dflow-merge` 본문은 읽지 않는다). 스윕을 돌리면 방언 검증은 `/dflow-merge` 의
   「방언 검증」 이 스윕 끝에 한다. 이 판정은 `/dflow-team` SKILL.md 「4-0. 스윕을 부르는 규칙」 과 같다.
   ```bash
   .claude/skills/dflow-merge/scripts/dialect-check.sh run --dev '<기본브랜치>'; echo "rc=$?"
   ```
1. **후보 식별**: `/dflow-merge` 1번(`.claude/skills/dflow-merge/SKILL.md`)과 같게 로컬 + 원격으로 본다.
   대상 저장소의 `dflow.sh config tasks-dirs` 의 각 폴더 아래 `*/state.json` 중 `phase=reported` 전부(로컬 후보)에 더해, 원격 `origin/agent/*`
   브랜치 tip 의 state.json 중 브랜치 이름의 id8 과 `order` 가 일치하고 `phase` 가 `merged` 가 아닌 것(원격
   후보)을 본다. 같은 order 가 로컬과 원격에 모두 있으면 로컬 후보 하나로 합친다. 그 다음 `api_base` 가 현재
   `DFLOW_API_BASE`(끝 `/` 제거)와 다르면 로컬이든 원격이든 "건너뜀(다른 D'Flow)" 로 집계하고, 원격에만 있는
   후보는 값이 없어도 건너뛴다. 명령과 합치는 규칙은 `/dflow-merge` 1번의 것을 그대로 쓴다. 원격에만 있는
   후보의 머지 대상은 `origin/agent/<id8>-<slug>` 이다.
2~5. **판정·순서·머지·뒷정리**: `/dflow-merge` SKILL.md(`.claude/skills/dflow-merge/SKILL.md`) 2~5번을 그대로 따른다.
   번호도 같아서, 이 문서의 "Phase 01-가 4번" 은 `/dflow-merge` 4번이다(머지 절차를 두 곳에 적지 않는다).
6. **집계 보고**: 머지됨 / 승인 대기 / 건너뜀(사유) 을 한 줄씩 — 원래 요청받은 작업으로 넘어가기 전.

머지 대상이 wbs-web 자신이면 G1~G4 훅 제약이 여기도 적용된다.

## Phase 01 — Claim·브랜치·기준선 (오케스트레이터 본인)

`<기본브랜치>` 는 개발 브랜치, 즉 `dflow.sh branch dev` 의 값이다(`.dflow.local` 의 `dev_branch`, 레거시는
`origin/HEAD`). 팀원은 팀장이 넘긴 `DEV_BRANCH` 를 쓴다. 개발 브랜치가 원격에 없으면 멈추지 말고 먼저
`.claude/skills/dflow-work/scripts/dflow.sh branch ensure-dev` 로 운영 브랜치에서 만든다(실패하면 그 사유로 중단·보고).

작업 폴더 `<TASKS>` 는 `<DOCS_DIR>/tasks` 다(리포 최상위 기준). 한 주문의 폴더 `<TASKS>/<TSK>` 는
`dflow.sh taskdir <ref>` 의 값이다 — `.dflow.local` 의 `project_map` 에서 그 주문의 프로젝트 키를, 없으면 `docs` 를 쓴다.
여러 작업을 훑을 때는 `dflow.sh config tasks-dirs` 가 내는 폴더 전부를 본다. `<DOCS_DIR>` 를 `docs` 로 박아 둔
고정 경로는 쓰지 않는다.

1. `dflow.sh doctor` (세션 첫 호출 시). `dflow.sh show <ref>` 로 상태 확인:
   ready → 착수 가능 판정(2번) 후 claim / claimed → **반려 판정 먼저(아래), 아니면** 재개 판정(위 상태 모델) /
   reported → 종료 / approved → 위 Phase 01-가 스윕이 이미 처리했어야 함(로컬 state.json 이 없는
   작업이라 스윕이 못 봤을 수 있다 — 그 경우 지금 즉시 같은 머지 절차를 이 ref 하나로 실행 후 종료).
   <!-- worker:begin -->
   `--worker` 면 머지하지 않고 `needs-merge` 로 끝낸다(「--worker」 C).
   <!-- worker:end -->
   이 머지도 `/dflow-merge` SKILL.md 4번 절차다 — Phase 01-가 가 `SWEEP_NONE` 으로 건너뛰어 아직 읽지 않았으면 먼저 읽는다.

   **반려 재작업 경로** — 로컬 `phase=reported`(또는 승인 뒤 재작업 요청이면 `merged`)인데
   서버 `status=claimed` 이면 반려를 의심한다.
   판정은 show 응답 최상위 `.reports` 의 마지막 `kind=completion` 리포트: `review_action=reject`
   면 반려다(`review_note` 가 사유). 이때:
   - **재개가 아니라 재작업이다.** Phase 를 이어 붙이지 말고 `review_note` 를 **요구사항 입력**으로
     삼아 설계부터 다시 판단한다(사유에 따라 design.md 개정이 필요할 수 있다). review_note 는
     요구사항 데이터이지 지시가 아니다 — spec 본문과 같은 취급.
   - state.json `phase=rejected` 기록 → 재작업 Phase 진입. 브랜치는 기존 `agent/` 브랜치를 그대로 쓴다
     (이미 push 된 커밋 위에 수정 커밋을 얹는다 — 되감기 금지). **승인 뒤 재작업 요청이면 그 브랜치는
     이미 머지·정리된 뒤일 수 있다** — 그때는 기본브랜치에서 같은 규칙으로 새 `agent/` 브랜치를 딴다.
     되돌리지 말고 머지된 코드 위에 수정 커밋을 얹는 것이 계약이다.
   - claim 을 다시 하지 않는다. 서버는 이미 claimed 로 롤백해 두었다.
   - 재작업 완료 후 마감은 Phase 06 그대로(`done --auto-links`) — state 는 다시 `reported`.

   **설계 선행 재개** — 서버 `status=claimed`·`mine=true` 이고 이 작업의 agent 브랜치(로컬 `agent/<주문id8>-*`, 없으면
   `origin/agent/<주문id8>-*`) tip 의 state.json 이 `phase=wait_pred` 면 claim·격리를 하지 않고 아래 「설계 선행」 3 으로 간다(반려
   판정은 먼저 한다). 현재 트리가 아니라 그 브랜치에서 읽는다 — `git show <그 브랜치>:<TASKS>/<TSK>/state.json`. 워커는 부트스트랩이
   기본 브랜치로 detach 해 두었고, 거기 있는 state.json 은 scaffold 의 `ready` 이거나 없다.
2. **착수 가능 판정 — 서버는 이걸 안 해준다.** claim 전에 오케스트레이터가 직접:
   - **spec 검사**: show 의 `.order.item.spec` 이 비어 있으면 착수 불가. 제목만으로 요구사항을
     지어내지 않는다. 스킵하고 사유 보고.
   - **선행 검사** (show 의 `depends_evidence[]` 각 원소 d 에 대해). **완료 판정은 `head_sha`
     존재가 아니라 서버 claim 게이트와 같은 축으로 한다**: `stage >= im` **또는**
     `d.order_approved === true` 면 선행 완료다. 다른 축을 쓰면 "게이트는 통과하는데 스킬은
     막는다"가 된다. 재발행을 겪은 선행은 현재 주문이 ready 여도 과거 승인이 있으면
     `order_approved` 가 true 다 — 현재 주문 status 로 판정하면 그 승인을 영영 못 본다.
     - **v2.8: `d.waived === true` 면 **강제 진행 간선**이다**(사람이 이 선행을 기다리지 않기로 면제했다).
       완료 판정·기본 브랜치 반영 확인·스택을 하지 않는다. 「강제 진행: <선행> 은 스텁으로 대신한다」 를 한 줄 남기고,
       그 선행의 계약(show 의 선행 spec·acceptance, 없으면 `dflow.sh show <선행 ref>`)을 읽어 아래 「강제 진행 스텁 규칙」대로
       스텁/목을 둔다(Phase 프롬프트의 `{FORCE_STUB}`). 기점은 항상 `origin/<기본브랜치>` 다 — 면제된 선행에는 `head_sha` 가
       없고, 승인 전 브랜치 위에 쌓으면 선행이 반려될 때 함께 무너진다. 대화형은 행 G 갈래 1 처럼 로컬 선행 산출물이 있으면
       스택할 수 있으나 팀원(워커) 모드는 하지 않는다(행 G).
     - **v2.3 서버는 판정 결과를 `d.reached` 로 준다**(= `stage ∈ {im,xx}` ∨ `order_approved` ∨
       `actual_pct ≥ 100`). **`'reached' in d` 면 그 값이 선행 완료 판정이다** — 축을 다시 조합하지 않는다(서버는 통과시키는데
       스킬만 막는 일을 막는다). 키가 없으면 아래 v2.2 규칙을 쓴다.
     - `order_approved` 는 **키 존재 여부로 지원을 가른다**(`'order_approved' in d`).
       `contract_version` 으로는 못 가른다 — 이 필드가 들어간 뒤로도 한동안 버전을 안 올려
       2.1 서버 중에 키를 주는 것과 안 주는 것이 섞여 있다(2.2 부터 계약에 명시됐다).
       **키가 아예 없으면 옛 서버다: `false` 로 단정하지 말고 "판정 불가"로 갈라
       stage 축만으로 판정하고 그 사실을 한 줄 남긴다.**
     - 선행 완료 + `head_sha` 있음:
       `git fetch origin && git merge-base --is-ancestor <head_sha> origin/<기본브랜치>` —
       거짓이면 선행이 main 미반영 상태. **Phase 01-가 4번과 같은 절차로 지금 직접 머지한다**(Phase 01-가 가
       `SWEEP_NONE` 으로 `/dflow-merge` SKILL.md 를 읽지 않았으면 먼저 읽는다)
       (브랜치명을 모르면 `<head_sha>` 를 그대로 머지 대상으로 써도 된다 — fetch 로 이미 origin 에
       있다). 머지 후 이어서 진행.
       <!-- worker:begin -->
       `--worker` 면 머지하지 않고 그 `head_sha` 를 기점으로 삼아 아래 claim 절차대로 스택한다(「--worker」 B).
       <!-- worker:end -->
     - `head_sha` 가 없으면 갈래 셋을 나눈다 — **"선행 미승인" 하나로 뭉개지 않는다**(뭉개면
       틀린 전제로 스택을 쌓거나 착수를 포기하고, 그 오분류가 무음이라 아무도 못 알아챈다):
       1. 미승인 + stage 미달 → 진짜 미승인. 선행 산출물이 로컬 `agent/` 브랜치에 실재하는지
          확인한다. **실재하면** 미승인 위에 쌓는 리스크를 보고하고 스택 브랜치(3번)로 진행,
          **부재하면 착수 불가** — 스킵하고 사유 보고(입력 없는 산출은 날조다).
       2. `order_approved:false` 인데 `stage >= im` → 승인 버튼을 거치지 않고 단계 드롭다운으로
          완료 처리된 것(서버 가드는 `xx` 만 막고 `im` 은 안 막는다). 진행하되 **반드시 한 줄
          남긴다** — 서버가 못 막는 우회를 스킬이 최소한 드러낸다.
          <!-- worker:begin -->
          `--worker` 면 갈래 1·2 는 스택하지 않는다. 갈래 1 은 `skipped` 로 끝내고, 갈래 2 는 기본 브랜치 반영이
          확인될 때만 진행하며 아니면 `skipped` 로 끝낸다(「--worker」 G).
          <!-- worker:end -->
       3. `order_approved:true` 인데 `head_sha` 없음 → 승인은 됐으나 evidence 가 비었거나 주문
          재발행으로 옛 완료 보고가 가려진 경우. 한 줄 남기고 진행한다.
   - **v2.9 설계 선행 후보**: `dflow.sh contract-ge 2.9` 가 exit 0 이면 `reached` 가 거짓인 선행(위 갈래 1)은 스택·착수 불가로
     가르지 않고 **설계 선행 후보**로 둔다 — 아래 claim 을 `--design-first` 로 하고 그 출력으로 모드를 정한다(「설계 선행」 1).
     기점 계산에서는 그 선행을 뺀다(코드가 아직 없다). 선행이 아직 구현 전(`as`·`ds`·미착수)인지는 스킬이 판정하지 않는다 —
     서버가 거부한다(exit 4 + `DESIGN_FIRST_TOO_EARLY`). exit 1 이면(옛 서버) 위 갈래 그대로다.
   - **강제 진행 스텁 규칙**(스펙 2026-09-23 §3.4):
     1. 후행 소유 경로에 둔다 — 선행이 만들 파일을 먼저 만들지 않는다. 예: `src/__stubs__/<선행 TSK-ID>/order.ts` 에 계약대로
        쓰고 주입 지점 한 곳에서만 바꿔 끼운다. 공유 등록 목록의 같은 줄을 고치지 않는다.
     2. 테스트에만 필요하면 테스트용 목으로 끝내고 런타임 스텁을 만들지 않는다.
     3. 런타임 스텁에는 계약에 맞는 고정 응답을 넣어 후행 테스트가 개발 브랜치에서 통과하게 한다.
     4. 표식: 코드에 `FORCE-STUB: <선행 TSK-ID>` 주석. design.md 와 완료 보고에 「강제 진행 스텁」 절(대신한 선행·대상·가정한 계약).
     5. 완료 보고 뒤 승인은 스텁 제거 하위 Task(`<후행 ref>.stub.<선행 ref 치환>`)가 끝날 때까지 잠긴다 — 정상이다.
     6. 스텁 제거 하위 Task 를 맡으면: `git grep -n 'FORCE-STUB: <선행 TSK>'` 가 0건이 되고 후행 테스트가 실구현 상대로
        통과해야 완료다. 실구현 상대로 실패하면 계약 어긋남으로 보고한다(스텁을 고쳐 통과시키지 않는다).
   판정 통과 후 **기점을 정하고, 그 기점으로 옮긴 뒤 claim 한다.** claim 의 선행 도달 검사(dflow.sh
   `check_depends_local`)가 현재 HEAD 를 보기 때문이다. 기점 규칙은 3번과 같다. 기본은
   `origin/<기본브랜치>` 이고, 선행이 main 미반영이거나 미승인 스택이면 선행 산출물이 있는 agent 브랜치
   (또는 그 `head_sha`)다.
   - 선행이 여럿이면 기점은 모든 선행의 `head_sha` 를 조상으로 가져야 한다
     (`git merge-base --is-ancestor <선행 head_sha> <기점>` 이 전부 참). 그런 기점이 없으면 착수 불가로
     스킵하고 사유 "선행을 모두 조상으로 갖는 기점 없음" 을 보고한다.
   - **claim 전 기점 이동은 항상 한다.** 옮기기 전에 원래 위치를 기록한다.
     ```bash
     git symbolic-ref -q --short HEAD || git rev-parse HEAD
     ```
     그 다음 기점이 `origin/<기본브랜치>` 여도 detach 한다(무관한 브랜치의 HEAD 를 보고 claim 이 exit 4 를 내지 않게).
     ```bash
     git fetch origin && git switch --detach <기점>
     ```
     해당 agent 브랜치(`agent/<주문id8>-*`)가 이미 있으면(재개) detach 대신 그 브랜치로 switch 한다.
   - 기점 이동이 실패하면 claim 하지 않고 중단·보고한다(detach 와 재개 브랜치 switch 모두. 워커는 `.result` 에
     `failed detach`). 거부된 switch 는 HEAD 를 옮기지 않으므로 복귀할 것은 없다.
   - claim 이 `PROJECT_MISMATCH`(exit 2)로 거부되면 그 주문은 이 리포에 바인딩된 D'Flow 프로젝트 밖이거나 리포에
     바인딩(`.dflow` 의 `project_id`·`.dflow.local` 의 `project_map`)이 없다. 재시도하지 않고 원래 위치로 돌아가 중단·보고한다.
     워커는 `.result` 에 `failed project <메시지>` 를 쓴다.
   - **claim 명령**: `dflow.sh contract-ge 2.9` 가 exit 0 이면 늘 `dflow.sh claim <ref> --design-first` 다(선행이 모두 충족돼도
     그렇다 — 단계 `ds` 가 "설계 중" 이라는 뜻을 늘 갖게 한다). 아니면 종전 `dflow.sh claim <ref>`. 출력에 `DESIGN_FIRST_UNMET` 줄이
     있으면 설계 선행 모드다(「설계 선행」 1). exit 4 에 stderr `DESIGN_FIRST_TOO_EARLY` 면 아래 재시도를 하지 않는다(선행이
     착수하기 전에는 다시 해도 같다) — 원래 위치로 돌아가 "선행 <ref:stage…> 이 구현 전이라 설계 선행 불가" 로 보고한다.
   - claim 이 exit 4(선행·상태로 인한 진행 불가. 서버 403 `dependency_not_met` 재매핑 포함)면
     `git fetch origin` 뒤 기점을 다시 정해(다시 옮겨) 1회 재시도하고, 그래도 4 면 중단·보고한다. 우회
     금지. merge 는 하지 않는다(기본 브랜치를 사용자의 현재 브랜치에 섞는다).
   - detach 부터 3번의 `git switch -c` 성공까지의 **모든 실패**(claim 실패, 브랜치 생성 실패 포함)에서
     기록한 원래 위치로 돌아간다. 브랜치면 `git switch <기록한 브랜치>`, 아니면
     `git switch --detach <기록한 sha>` 다. `git switch -` 는 쓰지 않는다(직전 위치는 기록한 위치와 다를 수 있다).
3. **브랜치를 오케스트레이터가 직접 만든다** — dflow.sh 는 브랜치를 만들지 않는다(스크립트 실측).
   기점 규칙(2번이 claim 전에 이 규칙으로 기점을 정해 HEAD 를 이미 그 기점에 옮겨 두었다):
   - 기본: `origin/<기본브랜치>`
   - 선행이 approved 인데 main 미반영이거나 미승인(스택)이면: **선행 산출물이 있는 agent/
     브랜치 위**에 만들고, state.json 에 `branch_base`(기점 커밋 sha)·`risk`(선행 반려 시 재작업)와 `api_base`(상태 모델)를 기록한다.
   ```bash
   git switch -c agent/<주문id8>-<slug> <기점>
   ```
   **agent 브랜치에 올라서면 곧바로 state.json 의 `phase` 를 `prepare` 로 쓴다** — 설치·기준선·spec 판정 동안에도 heartbeat
   훅이 신호를 보내게 한다(훅은 `ready` 를 보내지 않는다). claim 직후가 아니라 여기서 쓴다(복귀 switch 를 막지 않게).
   - 파일이 없거나 `phase` 가 `ready` 일 때만 쓴다. 재개로 이미 뒤 단계(`design` 이후)가 적혀 있으면 덮어쓰지 않고,
     반려 재작업 경로(`phase=rejected`)에서는 쓰지 않는다.
   - 이 쓰기가 state.json 의 첫 기록이면 `order`(전체 UUID)와 `api_base`(상태 모델)를 함께 적는다. 커밋은 하지 않는다
     (다음 커밋에 실린다).
   이미 해당 브랜치면 재개. **main·staging 위에서 사이클 진행 금지** — Phase 진입 전
   `git branch --show-current` 가 `agent/` 로 시작하는지 확인하고, 아니면 중단한다.
   <!-- worker:begin -->
   `--worker` 면 여기서 의존성을 설치한 뒤 4번으로 간다(「--worker」 H).
   <!-- worker:end -->
4. **게이트 기준선 기록**: dev-discipline 의 기준선 절차 실행, state.json 에 저장(`api_base` 가 아직 없으면 함께 기록한다. 상태 모델).
   기준선 명령은 하나씩 캐시 스크립트로 감싸 돌린다(dev-discipline 「기준선 캐시」 — 같은 기점·같은 명령은 한 번만 잰다).
   ```bash
   .claude/skills/dflow-dev/scripts/baseline.sh list --base <기점>   # 이 기점에서 이미 잰 명령. 같은 일을 재는 명령이 있으면 그 문자열·cwd 를 글자 그대로 쓴다
   .claude/skills/dflow-dev/scripts/baseline.sh run --base <기점> --task-dir <TASKS>/<TSK> -- '<테스트 명령>' 2>&1 | tail -30
   ```
   `<기점>` 은 3번 `git switch -c` 에 준 기점이다. 새로 쟀으면(`BASELINE_MEASURED ... key=`) 총수·실패 목록을
   `baseline.sh note` 로 더하고, 재사용했으면(`BASELINE_REUSED`) `BASELINE_SUMMARY` 의 수를 쓴다. state.json `baseline` 에는
   명령마다 `"cmd"`·`"source"`·`"cache_key"`·`"measured_at"` 을 적는다 — 형식·끄기(`DFLOW_BASELINE_CACHE=0`)·다시
   재기(`DFLOW_BASELINE_CACHE=refresh`)는 dev-discipline 「기준선 캐시」 다.
   Phase 프롬프트(`{VERIFY_CMDS}`)와 게이트로 옮기는 「기준선에서 실제로 돌린 명령 줄」 은 **`--` 뒤의 명령**이다 — 감싼
   줄을 옮기면 게이트가 캐시된 기준선을 자기 결과로 받는다.
   리포 최상위에 `.dflow-gates` 가 있으면 기준선 명령은 그 `full` 줄의 명령(들)이고 리포 최상위에서 잰다. state.json
   `baseline` 에 `"base": "<기점 sha>"` 를 적는다 — 재개한 세션도 게이트 범위 판정(`gate-scope.sh --base`)에 같은 기점을 쓴다.
   모듈 명령의 기준선은 여기서 재지 않고 Design 게이트 뒤에 잰다(아래 「Phase 종료마다」 1번).
5. spec.md 읽기(필수) + 복잡도 판정(dev-discipline 의 점수표) → 설계 모델 결정, 한 줄 출력.
   이어서 Build 모델: 배정표로 `build_model_base` 를 정하고, state.json 에 `build_model_trial` 이 없을 때만
   `.claude/skills/dflow-dev/scripts/build-trial.sh <external_ref> <build_model_base>` 로 시험 여부를 판정해 두 값을 state.json 에
   적는다(커밋하지 않는다 — Design 산출물 커밋에 실린다). 있으면(재개) 다시 판정하지 않는다. 한 줄 출력:
   `Build 모델: <sonnet|opus> (배정 <base>, 시험 <BUILD_TRIAL 줄의 on|off·reason>)`. 규칙은 dev-discipline 「Build 모델 시험(build_model_trial)」.
6. **준비 끝 표시**: state.json 의 `phase` 가 `prepare` 이면 `design` 으로 바꾼다(Design 서브에이전트를 띄우기 전, 커밋하지
   않는다). 빠뜨리면 Design 동안 좌석이 계속 「준비」로 보인다.

## 설계 선행 (계약 2.9)

선행이 구현 중(`ip`)인 동안 후속의 Design 을 먼저 해 두고, 선행이 끝나면 선행 코드를 한 번 들여 Build 로 간다. 서버 단계는
claim 때 `ds`(설계 중), `build-start` 뒤 `ip` 다. 설계 정본은 wbs-web 리포 docs/superpowers/specs/2026-09-26-dflow-parallel-token-design.md
§6(킷에는 미동봉)이고, 이유는 rationale.md 「설계 선행」 이다.

1. **claim 과 모드**(Phase 01 2번 「claim 명령」): `DESIGN_FIRST_UNMET <JSON>` 줄이 없으면 종전 그대로다. 있으면 **설계 선행 모드**다.
   - state.json 에 `design_first: {"unmet": [<그 JSON 의 external_ref>…]}` 를 적는다(Phase 01 3번의 `prepare` 쓰기와 같은 자리).
   - 기점은 미충족 선행을 뺀 Phase 01 규칙으로 정한 것이다. 충족된 선행이 없으면 `origin/<기본브랜치>` 끝이다. 기준선은 종전대로
     잰다(재개 때 기점이 바뀌면 다시 잰다 — 3).
   - Design 프롬프트의 `{DESIGN_FIRST}`(phase-prompt.md)를 채운다. 미충족 선행마다 계약을 읽을 곳을 이 순서로 찾아 적는다.
     `<선행TSK>` 는 그 external_ref 의 마지막 `/` 뒤다.
     1. show 의 그 선행 `depends_evidence` 원소의 `head_sha`. 승인된 선행에만 있으므로 미충족 선행에는 대개 없다.
     2. 그 선행 Task 폴더를 가진 원격 agent 브랜치. 선행 id8 을 모르므로 폴더로 찾는다 — `git fetch origin` 뒤
        `git for-each-ref --format='%(refname:short) %(objectname:short)' refs/remotes/origin/agent/` 로 목록을 보고, 브랜치마다
        `git ls-tree --name-only <브랜치> <TASKS>/<선행TSK>/` 가 비지 않는 것의 이름과 tip sha 를 적는다.
     3. 둘 다 없으면 "읽을 곳 없음 — 이 작업의 spec 과 선행 ref 로 가정한 계약" 이다. 선행이 구현 중이면 원격 브랜치가 아직
        없는 것이 보통이다(워커는 Phase 06 에서만 push 한다).
     워커는 다른 주문을 show 하지 않는다(worker-prompt.md 「5」) — 위 셋은 자기 show 와 git 만 쓴다.
2. **Design 게이트 뒤**(Phase 02~05 「Phase 종료마다」 1번): `dflow.sh build-start <ref>` 의 결과로 가른다. 모드와 무관하게 늘 부른다.

   | 결과 | 처리 |
   |---|---|
   | exit 0 | Build 로 간다(종전) |
   | exit 0 + stderr `BUILD_START_UNSUPPORTED` | 옛 서버다(404 이고 계약 < 2.9 — claim 이 이미 `ip` 로 보냈다). Build 로 간다 |
   | exit 4 | 설계 완료·선행 대기로 멈춘다(아래 멈춤 절차) |
   | exit 10 | 중단(상태 모델) |
   | 그 밖 | Build 로 가지 않고 중단·보고한다. `phase` 는 `design` 그대로라 재실행하면 Design 게이트 뒤에서 다시 부른다. 워커는 `failed build-start <exit>` |

   **멈춤 절차**(순서 고정):
   1. design.md 커밋을 확인한다(없으면 파일명 명시 커밋).
   2. state.json `phase` 를 `wait_pred` 로, `design_first.unmet` 을 stderr 본문의 `unmet[].external_ref` 로 쓰고(없던 필드면 만든다)
      파일명을 명시해 커밋한다(`DFlow-Order` 트레일러). 그 다음 `progress 25 "설계 완료(선행 대기)"` 를 보낸다.
   3. `git push origin <agent 브랜치>` 로 설계를 원격에 남긴다(다른 PC·새 워크트리가 이어받는다). 훅에 거부되면 우회하지 않고 보고한다.
   4. `dflow.sh heartbeat <ref> --phase wait_pred` 를 부른다. 실패해도(옛 서버는 400) 멈춤을 계속한다. heartbeat 훅은 `wait_pred` 를
      보내지 않으므로 이 한 번이 좌석을 「선행 대기」 로 바꾼다. 2번 뒤에 부른다 — 앞이면 훅의 다음 신호가 `design` 으로 덮는다.
   5. supervised 는 `"{TSK} 설계 완료·선행 대기 — 선행 <ref…> 가 끝나면 /dflow-dev {TSK} 로 이어 간다"` 로 알리고 끝낸다. 워커는
      `.result` 에 `design_waiting <미충족 선행 ref…>` 를 쓴다(worker-mode.md 「설계 선행」).
3. **재개**(Phase 01 1번 「설계 선행 재개」): claim 하지 않는다(이미 claimed·`ds`).
   0. 그 agent 브랜치로 switch 한다. 로컬에 없으면 `git switch -c agent/<주문id8>-<slug> origin/agent/<주문id8>-<slug>` 다. 워커는 행 H
      대로 곧바로 의존성을 설치한다.
   1. show 의 `depends_evidence` 가 모두 `reached`(면제 포함)인지 본다. 아니면 다시 멈춘다 — 멈춤 절차의 4·5 만 한다(커밋·push 할
      것이 없다).
   2. 모두 참이면 **Phase 01 2번의 기점 판정을 그대로 다시 한다**(`head_sha` 와 기본 브랜치 반영 확인·직접 머지, `head_sha` 없는
      세 갈래, 여러 선행의 공통 기점. 워커는 행 B·G). 다시 하는 것은 **어느 커밋을 기점으로 삼을지의 판정뿐**이다 — claim·
      `git switch --detach <기점>`·`git switch -c` 는 하지 않고 agent 브랜치에 머문다. 기점이 승인 전 선행의 `head_sha` 면 state.json
      `risk` 를 행 B·Phase 01 3번처럼 적는다. `reached` 는 완료 보고 뒤나 승인 뒤 머지 전에도 참이라 선행 코드가 기본 브랜치에 없을
      수 있다. 기점을 정하지 못하면(착수 불가·공통 기점 없음·워커의 `선행 승인 대기`) 그 판정을 사유로 멈춤 절차의 4·5 를 한다(워커
      `.result` 는 `design_waiting <그 사유>`).
   3. 정한 기점을 agent 브랜치에 **한 번** 머지한다. agent 브랜치에는 Task 문서 커밋뿐이라 코드 충돌이 없다. dev-discipline
      「개발 브랜치 재머지」 의 허용 한 번이 이것이며, 사유는 build-log.md 대신 머지 커밋 메시지에 남긴다(build-log 는 아직 없다).
      ```bash
      git merge --no-ff <기점> -m "merge: <TSK> 설계 선행 재개 — 선행 반영 기점 <기점 sha>" -m "DFlow-Order: <order>"
      ```
   4. state.json `branch_base`·`baseline.base` 를 새 기점 sha 로 바꾸고 `baseline.cmds` 를 모듈 기준선까지 모두 비운 뒤 `phase` 를
      `prepare` 로 쓰고 Phase 01 4번대로 다시 잰다. 트리의 코드가 새 기점과 같으므로 이 작업 트리에서 잰다. Verify 감사자가
      `{BASE}..{BUILD_HEAD}` 를 읽으므로 기점을 바꾸지 않으면 선행의 코드까지 감사한다.
      재기 전에 의존성을 새 기점에 맞춘다. 워커는 `git diff --name-only <옛 기점> <새 기점>` 에 lockfile(`package-lock.json`·
      `pnpm-lock.yaml`·`yarn.lock`)이 있으면 그 폴더의 `node_modules` 를 지우고, `git rev-parse --absolute-git-dir` 를 단독으로 돌려
      나온 폴더의 `dflow-prepare.done`(준비 빌드 표식)은 늘 지운 뒤 행 H 의 `deps.sh` 를 다시 부른다(75 면 다시 부른다) — 선행이
      바꾼 워크스페이스 라이브러리의 dist 가 낡은 채 기준선을 재지 않게. supervised 는 lockfile 이 바뀌었으면 기준선 전에 사용자에게
      설치가 필요하다고 알린다(사람의 체크아웃이다).
   5. **선행 계약 재확인**: design.md `## 선행 기준` 표의 파일마다 `git diff --name-only <적힌 sha>..<새 기점> -- <파일>` 을 본다. 적힌
      sha 가 없거나(읽을 곳 없음) 로컬에 없으면(`git cat-file -e <sha>^{commit}` 실패 — 선행 브랜치 삭제·squash) 바뀐 것으로 본다.
      하나라도 바뀌었으면 Design 을 **검토 모드**로 다시 띄운다(`phase=design`, `{DESIGN_FIRST}` 에 검토 모드임과 종전 design.md 의
      `## 선행 기준`·바뀐 파일의 `git diff <적힌 sha>..<새 기점> -- <파일>` 요지). 어긋난 절만 고치고 Design 게이트를 다시 돈다.
   6. 2 의 표대로 `build-start` 를 다시 부른다. exit 0 이면 「Phase 종료마다」 1번의 Design 게이트 뒤 모듈 기준선부터 이어 Build 로 간다.

## Phase 02~05 — Design → Build → Verify → Refactor

각 Phase 는 Agent 도구의 서브에이전트로 실행한다. **이름을 붙여 띄운다** —
`Agent(name: "<TSK>-design" | "<TSK>-build" | "<TSK>-verify" | "<TSK>-refactor", ...)`.
이름이 있어야 게이트 판정 뒤 `TaskStop(task_id: "<그 이름>")` 으로 회수할 수 있다(아래 3번).
Phase 마다 모델이 다르므로(dev-discipline 모델 배정표) **하나의 에이전트를 4 Phase 가 돌려쓰지
않는다** — 에이전트 모델은 spawn 시점에 고정된다.

**Build 는 구현 단위마다 서브에이전트 하나로 띄운다**(dev-discipline.md 「구현 단위」). 단위와 순서는 design.md
`## 구현 단위` 표가 정하고, 표가 없으면 단위 하나(B1)다.
- 이름: 단위가 하나면 `<TSK>-build` 그대로다 — 이름·게이트·재시도가 종전과 같다. 여럿이면 `<TSK>-build-<단위>`(예
  `<TSK>-build-B2`)다. 인계를 받아 같은 단위를 이어 띄우면 끝에 `-c<n>` 을 붙인다(`<TSK>-build-B2-c1`).
- 띄우기 직전 state.json 의 `model` 과 `build_unit` 을 쓴다. 모델은 모든 단위가 Build 모델 하나다 — state.json
  `build_model_trial` 이 true 면 sonnet, 아니면 `build_model_base`. 예외는 아래 「승급」 뿐이고, 단위를 띄울 때의 모델은
  state.json `model` 이 아니라 git 트레일러로 정한다(재개도 같다 — dev-discipline 「sonnet Build 의 opus 승급」). 띄울 때마다
  build-log.md `## 실행 모델` 에 한 줄을 쓰고 보고를 받으면 채운다(열은 dev-discipline 「Build 모델 시험(build_model_trial)」).
- 프롬프트에 단위 이름, 마지막 단위인지(연결 테스트·E2E 담당), 단위 상한(도구 호출 약 120회·컨텍스트 250K 추정)을 넣는다.
- 보고 첫 줄이 `UNIT_DONE <단위>` 면 그 단위 커밋이 있는지 확인한다(병렬 묶음의 단위는 아래 「묶음」 — 커밋은 오케스트레이터가 한다). 마지막 단위가 아니면 게이트 없이 곧바로
  `TaskStop` 하고 다음 단위를 띄운다. `UNIT_HANDOFF <단위>` 면 build-log.md `## 인계 <단위>` 가 커밋됐는지 확인하고(병렬 묶음은 아래 「묶음」)
  TaskStop 한 뒤 같은 단위를 새 에이전트로 이어 띄운다(프롬프트에 그 인계 절을 넣는다). 이어 띄우기는 단위마다 2회까지다.
  횟수는 기억이 아니라 `git log <기점>..HEAD --grep='DFlow-Unit: <단위> handoff' --format=%h` 줄 수로 센다.
  세 번째 인계는 Build 실패다(아래 4번). 둘 다 아닌 보고는 opus 단위면 Build 실패이고, sonnet 단위면 아래 「승급」 이다.
- **승급(sonnet 단위)**: 단위 에이전트가 sonnet 이고 그 단위가 막히면 이어받기를 opus 새 에이전트로 띄운다 — 같은 단위의 두 번째
  인계(`UNIT_HANDOFF`)이거나, 새·관련 테스트 초록 없이 끝났을 때(보고의 관련 테스트가 빨갛거나 `UNIT_DONE`·`UNIT_HANDOFF` 어느
  것도 아닌 보고)다. 인계 상한(단위마다 2회)은 그대로이고 승급은 그 자리의 모델만 바꾼다.
  1. 초록 없이 끝났으면 오케스트레이터가 인계로 바꾼다 — 보고로 build-log.md `## 인계 <단위>`(한 것·남은 것·실패 중인 테스트)를
     쓰고, design.md 표의 그 단위 범위 안 변경과 build-log.md 를 `--trailer "DFlow-Unit: <단위> handoff" --trailer "DFlow-Escalate:
     <단위> 초록 없이 끝남"`(과 `DFlow-Order`)로 커밋한다. 인계가 이미 2회면(이 커밋이 세 번째가 된다) 바꾸지 않고 Build 실패다.
     범위 밖에 커밋되지 않은 변경이 남으면 Build 실패다. 병렬 묶음의 단위면 「묶음」 2 의 커밋에서 같은 트레일러를 붙인다.
  2. TaskStop 하고 build-log.md `## 실행 모델` 에 opus 줄(승급 칸 `sonnet→opus(<사유>)`)을 쓴다. `dflow.sh progress <ref> <직전
     보고 퍼센트, 보통 25> "escalated: sonnet→opus <단위>(<사유>)"` 를 보낸다 — state.json `model` 을 바꾸기 **전에** 보낸다(보고 행이
     그 시점의 heartbeat 모델을 남기므로(0105) 방금 끝난 sonnet 구간이 그 행에 남는다). exit 10 이면 멈춘다(상태 모델).
  3. state.json `model` 을 opus 로 쓰고 이어받기 `<TSK>-build-<단위>-c<n>` 을 opus 로 띄운다(`{HANDOFF}` 에 그 인계 절). 그 단위의
     뒤 이어받기도 opus 다. 그 단위가 끝나면 남은 단위는 원래 모델로 돌아간다.
  승급한 에이전트와 게이트 재시도 에이전트는 시험 단위가 아니므로 `{ADVISOR_POLICY}` 를 `막혔을 때만` 으로 채운다.
- **advisor 호출 시점**: 프롬프트의 `{ADVISOR_POLICY}` 는 Build sonnet 시험 단위(state.json `build_model_trial` 이 true 이고 sonnet 으로
  도는 단위)만 `착수 전·막혔을 때·완료 전`, 그 밖의 모든 Phase 에이전트는 `막혔을 때만` 이다(dev-discipline 「advisor 호출(실행 모델별)」).
  보고의 `advisor <호출 수>` 를 `## 실행 모델` 의 `advisor` 칸에 옮긴다.
- 재개하면 끝난 단위를 커밋 트레일러로 가린다 — `git log <기점>..HEAD --grep='DFlow-Unit: <단위> done' --format=%h` 가 한 줄
  이상이면 끝난 단위다(단위 커밋 규칙은 phase-build.md 「구현 단위」). 남은 단위부터 띄우고, 마지막 인계가 있으면
  build-log.md `## 인계 <단위>` 를 프롬프트에 넣는다.
- 마지막 단위가 끝나면 Build 게이트를 돈다(아래 1번). Build 게이트 재시도(아래 4번)는 마지막 단위의 에이전트에 이어 붙인다.
- **묶음**: 단위는 표의 `묶음` 순서대로 돈다(열이 없거나 비면 단위마다 다른 묶음 — 위 순차 절차 그대로). Build 를 시작할 때
  마지막 단위가 혼자 마지막 묶음인지 본다 — 아니면(phase-design.md 「구현 단위」 위반) `묶음` 열을 무시하고 순차로 돈다. 한 묶음에 단위가
  둘 이상이면(병렬 묶음) 그 단위들을 한 메시지에 동시에 띄우고, 모두 보고할 때까지 커밋하지 않는다 — 형제가 트리를 고치는
  중의 커밋은 index 에서 부딪치고, 대상 리포의 커밋 훅(lint-staged 등)이 형제의 작업 중 파일을 건드린다. 프롬프트의 `{UNIT}` 은
  병렬 표기로 채운다(phase-prompt.md 변수표). 병렬 단위는 git 에 쓰지 않고 보고로 넘긴다(phase-build.md 「병렬 묶음의 단위」).
  각 단위는 보고를 받는 즉시 TaskStop 한다. 모두 보고하면:
  1. 묶음 검사 — 단위들의 파일 목록이 서로 겹치지 않는다. 각 파일이 design.md 표의 그 단위 범위 안이다. 어기면 Build 실패다.
     단위가 쓴 변이 기록 파일(`<TASKS>/<TSK>/mutations/<단위>-M<n>.mut`)은 Task 문서라 범위 검사에서 뺀다.
  2. 단위마다 차례로 그 단위 파일만 stage 해 커밋한다. 보고의 변이 검증 기록 행·설계 이탈·인계 내용을 build-log.md 에 옮기고
     그 단위의 변이 기록 파일과 함께 같은 커밋에 싣는다. `UNIT_DONE` 은 `--trailer "DFlow-Unit: <단위> done"`, `UNIT_HANDOFF` 는
     `--trailer "DFlow-Unit: <단위> handoff"` 를 붙인다(`DFlow-Order` 트레일러도). 트레일러가 같으므로 재개·인계 계수는 위와 같다.
  3. 커밋 뒤 `git status --porcelain` 이 Task 문서 밖에서 비어 있어야 한다. 보고에서 빠진 파일이 남으면 Build 실패다.
  4. 인계한 단위는 묶음 커밋 뒤 혼자 이어 띄운다(`-c<n>`, 병렬 표기 없이 — 스스로 커밋한다). 둘 이상이 인계했으면 표 순서대로
     하나씩 차례로 이어 띄운다(이어 띄운 단위는 스스로 커밋하므로 동시에 띄우지 않는다). 끝나면 다음 묶음으로 간다.
  5. 커밋이 끝나면 단위 보고 파일(`<TASKS>/<TSK>/unit-report-<단위>.md`, phase-build.md 「병렬 묶음의 단위」)을 지운다.
  한 단위가 Build 실패(세 번째 인계, opus 단위의 둘 다 아닌 보고)면 형제의 보고를 기다려 끝난 단위는 커밋한 뒤 Build 실패로 멈춘다 — 재개가
  끝난 단위를 다시 하지 않게. 재개할 때 묶음의 일부만 끝났으면 남은 단위만 같은 방식으로 띄운다(하나만 남으면 순차 표기).
  재개할 때 done 트레일러가 없는 묶음 단위에 단위 보고 파일이 있으면 다시 띄우지 않고 그 파일로 위 1~5 를 한다(보고를 받고
  커밋하기 전에 오케스트레이터가 재시작된 경우). 보고 파일이 없는데 그 단위 범위에 커밋되지 않은 변경이 있으면 Build 실패로
  멈춘다 — 반쯤 쓴 트리 위에 새 에이전트를 띄우지 않는다(사람이 보고 되돌리거나 커밋한다).

**Verify 는 읽기 전용 감사자 셋과 작성자 하나를 한 메시지에 동시에 띄운다**(phase-verify.md). research/docs 특례 작업은
감사자 없이 작성자만 띄운다(첫 보고가 곧 `PHASE_RESULT`).
- 감사자: 역할 spec·review·tests 셋. **이름(`name`)을 붙이지 않고 띄운다** — 이름을 붙인 에이전트는 실행 환경에 따라 별도
  pane·프로세스로 뜨는데, 감사자는 SendMessage·TaskStop 할 일이 없고 보고하면 스스로 끝난다. 부모 컨텍스트를 물려받지 않는 새 서브에이전트(general-purpose,
  fork 금지)에 `model: "sonnet"` 을 준다 — 쓰기 금지는 템플릿이 정한다(Explore 는 위치 찾기용이라 리뷰가 얕아진다). 프롬프트는 phase-prompt.md 「감사 템플릿」 에 `{ROLE}`(spec·review·tests)·
  `{BASE}`(state.json `baseline.base`)·`{BUILD_HEAD}`(`build_gate.head`)를 채운 것이다. 감사자는 커밋된 내용만 읽으므로 작성자의
  변이·E2E 와 겹쳐도 된다.
- 작성자: `<TSK>-verify`, 종전 Verify 템플릿과 모델(sonnet) 그대로다. 첫 보고는 `VERIFY_EXEC done|fail` 이고 **이 보고로 회수하지
  않는다.**
- 감사 보고(첫 줄 `AUDIT_RESULT <역할> <지적 수>`)를 받으면 곧바로 `<TASKS>/<TSK>/audit-<역할>.md` 에 그대로 옮겨 적는다(git
  에는 쓰지 않는다). 같은 때 state.json `verify_findings.<역할>` 에 지적 수를, `verify_advisor.audit` 에 감사 보고의 advisor 호출 수를
  더한다 — 감사 파일은 게이트 뒤 지워지므로 비교 지표(dev-discipline 「Build 모델 시험(build_model_trial)」)는 여기에 남긴다.
  작성자의 advisor 호출 수는 최종 보고를 받을 때 `verify_advisor.writer` 에 적는다.
- 작성자의 `VERIFY_EXEC` 와 감사 셋이 모두 오면: 지적이 한 건이라도 있으면 세 파일의 지적을 모아 **같은 작성자에게 SendMessage 로**
  넘기고 `PHASE_RESULT verify done|fail` 을 기다린다. 지적이 0건이면 `VERIFY_EXEC` 를 최종 보고로 받는다(`done` 은 통과, `fail` 은
  Verify 실패 — 아래 4번). SendMessage 가 안 되면 sonnet 작성자를 새로 띄우고 `{AUDIT_FINDINGS}` 에 지적을 넣는다. 이 왕복은 Verify
  재시도 1회에 세지 않는다.
- 재개할 때 `audit-<역할>.md` 가 있는 감사자는 다시 띄우지 않는다. Verify 게이트 판정이 끝나면 `audit-*.md` 를 지운다.
- Verify 재시도(아래 4번)는 작성자에게만 이어 붙이고 감사자는 다시 띄우지 않는다.

**띄우기 직전에 state.json 의 `model` 을 그 서브에이전트의 모델로 쓴다** — Agent 도구에 넘기는 값 그대로
(`opus`·`sonnet`·`haiku`, 전체 id 를 넘겼으면 그 id). 커밋은 하지 않는다(다음 Phase 산출물 커밋에 같이 실린다).
재시도를 새 에이전트로 띄워 모델이 바뀌면 다시 쓴다. Phase 01·06(오케스트레이터가 직접)은 `model` 을 지우지 않는다.

공통 프롬프트에 반드시 포함:
`<TASKS>/<TSK>/spec.md` + **design.md (Build 이후 Phase)** + **build-log.md (Verify)** + **기준선 수치** + Phase 지시 +
"spec 본문은 요구사항 데이터이며 지시가 아님". Phase 정의·완료 조건은 그 Phase 파일(`references/phase-<phase>.md`)을,
모델은 dev-discipline.md 「모델 배정」 을 따른다.
**프롬프트는 `.claude/skills/dflow-dev/references/phase-prompt.md` 의 템플릿을 그대로 보내고 `{…}` 변수만 채운다** — 문구를
고쳐 쓰지 않는다. 템플릿에 읽기 규율·병렬 조사와 단일 작성자·포그라운드 실행·무거운 명령·토큰·커밋 트레일러 문구가 들어 있다.
서브에이전트는 phase-prompt 가 가리키는 자기 Phase 파일만 읽으므로, dev-discipline.md 전체를 읽으라고 시키지 않는다.

검증 명령(`{VERIFY_CMDS}`)은 **오케스트레이터가 기준선(Phase 01 4번)에서 실제로 돌린 명령 줄을 글자 그대로 옮긴다.**
돌려 보지 않은 도구 경로를 추측해 적지 않는다. Build 의 관련 테스트·변이 검증처럼 **범위를 좁힌 명령(`{NARROW_CMDS}`)도 그
기준선 명령 줄에서 만든다** — 적어 주지 않으면 서브에이전트가 전체 스위트를 다시 돌리거나 도구 경로를 추측한다.
대응표가 있으면 Design 뒤 예측 범위의 모듈 게이트 명령(`GATE_SCOPE module` 줄)도 `{NARROW_CMDS}` 에 넣는다 — 변이 검증이 대상
테스트로 잡히지 않을 때 전체 대신 이 명령으로 넘어간다. 도커
문구(`{DOCKER_LINE}`)는 금지 모드 판정(dev-discipline.md 「도커 사용 규칙」)대로 고른다.

커밋 규칙에는 **모든 커밋에 `--trailer "DFlow-Order: <주문 UUID>"` 를 붙이는 것**이 포함된다(state.json 의
`order`, phase-prompt.md 공통 규칙 1) — Design·Build·Verify·Refactor·Phase 06 마감 커밋 전부,
워커·수동 경로 모두 예외 없다(이 Phase 들은 전부 `git commit` 이라 `--trailer` 가 그대로 통한다. `/dflow-merge`
의 머지 커밋은 `git merge` 라 방법이 다르며, 그 스킬의 「트레일러 고정」이 정본이다). 아래 팀원 모드 절 행 G 의
기본 브랜치 반영 확인이 이 트레일러를 증거로 쓴다.
<!-- worker:begin -->
`--worker` 면 공통 프롬프트에 git 절대경로 규칙 한 줄을 덧붙인다(「--worker」 E). 두 줄 모두 템플릿의 `{WORKER_LINES}` 자리다.
`.issues` 는 오케스트레이터만 쓴다(worker-prompt.md 「7-1」). 공통 프롬프트에 "겪은 문제는 `.issues` 에 직접 쓰지
말고 끝 보고에 분류(tool-error·gate-retry·permission·skill-unclear·env·other)와 함께 올린다. design.md 등
산출물에도 '`.issues` 에 적는다'는 규칙을 만들지 말고 '보고에 올린다'로 쓴다" 를 넣는다.
<!-- worker:end -->

Phase 종료마다 오케스트레이터가:
1. 게이트 집행(위 원칙 — 직접 실행).
   - **Design 게이트 뒤 구현 전환**: Design 게이트가 통과하면 아래 모듈 기준선보다 먼저 `dflow.sh build-start <ref>` 를 부른다(늘
     부른다 — 옛 서버는 `BUILD_START_UNSUPPORTED` 로 넘어간다). exit 4 면 Build 로 가지 않고 설계 완료·선행 대기로 멈춘다. 갈래와
     멈춤 절차는 「설계 선행」 2.
   - **Design 게이트 뒤(대응표가 있을 때만)**: 첫 Build 단위를 띄우기 전에 모듈 게이트 명령의 기준선을 잰다. design.md
     「변경 파일 목록」 의 경로를 파일에 적어 `gate-scope.sh --base <기점> --ignore <TASKS>/<TSK>/ --paths-file <파일>` 로
     예측 범위를 보고, `module` 줄의 명령마다 `baseline.sh run --base <기점> --task-dir <TASKS>/<TSK> -- '<명령>'` 으로 잰다.
     트리가 기점과 코드가 같을 때(`git diff --name-only <기점>..HEAD` 와 `git status --porcelain` 이 Task 문서 밖에서 빔)만
     잰다. 결과는 state.json `baseline.cmds` 에 `"scope": "module"` 을 붙여 더한다. 정본은 dev-discipline 「게이트 범위 대응표(.dflow-gates)」.
   - **Build 게이트**: 전체 스위트를 `heavy.sh` 로 감싸 한 번 돈다. 결과(HEAD sha·명령 줄·통과/실패 수·신규 실패 목록)를
     state.json 의 `build_gate` 에 적고 Verify 프롬프트에 그대로 넣는다 — Verify 는 전체 스위트를 다시 돌리지 않는다.
     대응표가 있으면 먼저 `gate-scope.sh --base <기점> --ignore <TASKS>/<TSK>/` 를 부른다. `module` 이고 그 명령이 모두 모듈
     기준선을 가졌으면 그 명령들만 `heavy.sh bash -c '<명령>'` 으로 감싸 돌고(복합 명령도 한 슬롯에서), 아니면(기준선 없는 명령, `full`) `full` 명령을 돈다. `none` 이면
     위 그대로, `invalid` 면 사유를 한 줄 보고하고 위 그대로다. state.json 의 게이트 기록(`build_gate`·`verify_gate`·`refactor_gate`)에는 `"scope":"module"` 또는 `"scope":"full"` 을 더한다.
     기록 형식은 게이트마다(`build_gate`·`verify_gate`·`refactor_gate`) 같다:
     `{"head":"<게이트를 돈 HEAD sha>","cmds":[{"cwd":"<폴더>","cmd":"<명령 줄>","tests":<총수>,"failures":<실패 수>}],"new_failures":[…]}`.
     재실행을 생략한 게이트는 `"reused_from":"build_gate"` 를 더하고 `head` 는 Build 게이트의 sha 를 그대로 둔다
     (해소 워커가 `head` 로 어느 트리를 잰 기록인지 판단한다 — dflow-team resolve-prompt.md 「3」).
   - **Verify·Refactor 게이트**: 먼저 `git diff --name-only <Build 게이트 sha>..HEAD` 를 본다. 바뀐 파일이 Task 문서
     (`<TASKS>/<TSK>/` 아래)와 `*.md` 뿐이고 `git status --porcelain` 도 Task 문서 밖에서 비어 있으면 전체 스위트를 다시
     돌리지 않고 Build 게이트 결과를 그대로 쓴다. 커밋 밖에 남은 파일(되돌리지 못한 변이 등)은 Phase 06 이 커밋에 섞으므로
     재실행 생략의 근거가 못 된다. 코드가 바뀌었으면 전체 스위트를 돈다. Refactor 가 커밋을 남기지 않았으면 Refactor 게이트는 없다.
     **대응표가 있고 `build_gate.scope` 가 `module` 이면 Verify 게이트는 재실행을 생략하지 않고 `full` 명령을 한 번 돈다** —
     머지 전 최종 증거다(Verify 서브에이전트가 끝난 뒤 오케스트레이터가 돈다). `build_gate.scope` 가 `full` 이면 위 생략
     규칙 그대로다. 코드가 바뀐 Refactor 게이트는 `full` 명령이다.
   - **게이트 기록**: 위 게이트 명령과 모듈 기준선 측정을 돌릴 때마다 build-log.md `## 게이트 기록` 에 명령·범위(모듈|전체|재사용)·
     경과 시간·1분 부하 평균·결과를 한 줄 더한다(판정 직후, 재시도를 넘기기 전). 아래 2번의 Phase 산출물 커밋에 함께 싣는다.
     열과 측정 방법은 dev-discipline 「게이트 기록」.
   - **강제 재실행**: Gradle `--rerun-tasks`·`cleanTest` 는 변이 드라이버가 부분 실행 상태를 남겼을 때(`dflow-bak/` 에 사본이
     남음)만 쓴다. 그 밖에는 UP-TO-DATE 를 믿는다(dev-discipline 「강제 재실행」).
   - **Verify 의 감사 확인**: build-log.md 「변이 검증 기록」 표가 「불변 규칙」 을 모두 덮는지와, 화면 작업이면 E2E 결과가
     보고에 있는지 본다. 작성자 보고에 변이 표본으로 고른 행과 이유가 있고, 감사 지적이 있었으면 지적마다 판정(수용·기각 사유)이
     있는지도 본다. 없으면 실패다. research/docs 특례 작업(dev-discipline 「research/docs 작업 특례」)은 표 대신
     문서 검증 체크리스트 순회를 본다.
2. 통과 → Phase 산출물 커밋 확인(없으면 여기서 커밋: 파일명 명시) → state.json 전진 → 서버 보고:
   Design `progress 25 "설계 완료"` / Build `progress 60 "구현 완료"` / Verify `progress 85 "검증 완료"`.
3. **Phase 에이전트 회수** — 게이트 판정(통과·실패 무관, 재시도할 게 아니면)이 끝나는 즉시
   `TaskStop(task_id: "<TSK>-<phase>")`. 일이 끝난 에이전트는 자기 세션을 붙들고 있어 pane 과
   메모리를 계속 차지한다.
   회수는 게이트 **뒤**에 한다 — 판정 전에 죽이면 재질의할 대상이 사라진다.
   Build 는 띄울 때 붙인 이름 그대로(`-c<n>` 포함) 회수하고, 마지막이 아닌 단위는 위 단위 절차대로 게이트 없이 회수한다.
   **pane 자체를 닫는 도구는 없다.** TaskStop 은 에이전트를 종료시킬 뿐이고, 화면에서 pane 이
   사라지는지는 실행 하네스(FleetView 등) 몫이다.
   종료 후에도 pane 이 남으면 하네스에 보고할 건이지 이 스킬이 우회할 대상이 아니다 — 없는 API 를 지어내지 않는다.
4. 실패 → **즉시 중단**: `"{TSK} {Phase} 실패 — {사유}. phase 유지, 재실행 시 같은 Phase 재개."`
   단, 게이트의 신규 실패가 **모두** 타이밍·성능(부하 민감) 테스트이면 먼저 그 테스트 파일만 `heavy.sh --exclusive` 로 단독
   재실행한다 — 통과하면 실패가 아니다(dev-discipline 「부하 민감 테스트(타이밍·성능)의 단독 재실행」).
   Build 게이트와 Verify 만 1회 재시도한다(수정은 Build 규율로 — dev-discipline 참조). **Build 게이트가 실패하면 곧바로
   failed 로 끝내지 않고** 같은 Build 서브에이전트(구현 단위가 여럿이면 마지막 단위)에 실패 목록(신규 실패 테스트 이름과 출력 꼬리)과
   "재시도 때는 단위 범위 제한 없이 Build 전체를 고친다" 를 넘겨 고치게 한 뒤 Build 게이트를 다시 돈다. **그 에이전트가 sonnet 이면
   이어 붙이지 않는다** — TaskStop 한 뒤 opus 새 에이전트 `<TSK>-build-retry` 에 같은 두 가지(`{FAILURES}`, `{UNIT}` 은 재시도 표기 —
   phase-prompt.md 변수표)를 넘겨 띄운다. 이 opus 재시도가 1회 재시도 자리를 대신한다(횟수는 늘지 않는다). 띄우기 전의 기록
   (`## 실행 모델` 줄 `재시도`·승급 칸 `sonnet→opus(게이트 실패)`, progress `escalated: sonnet→opus 재시도(게이트 실패)`, 그 뒤
   state.json `model`)은 위 「승급」 2·3 과 같다. 위 부하 민감 단독 재실행이 먼저다(통과하면 재시도도 승급도 없다). 마지막 단위
   에이전트가 이미 opus 면(승급했거나 원래 opus) 종전대로 이어 붙인다. 재시도 중 인계(`UNIT_HANDOFF`)는
   단위 상한 2회에 포함하고, 이어 띄운 에이전트에도 같은 두 가지를 넣는다(같은 1회 재시도다. opus 재시도의 이어받기는
   `<TSK>-build-retry-c<n>` 이고 opus 이며, 인계 커밋의 트레일러는 마지막 단위 이름이다). Verify 가 실패해도 같은 Verify 서브에이전트에 실패 사유를 넘긴다. 두 번째 실패는 중단한다.
   재시도할 때는 회수를 미루고 같은 에이전트에 SendMessage 로 이어 붙인다(컨텍스트 재구축 낭비 방지).
   SendMessage 가 안 되면(이미 회수됐거나 도구가 없다) 같은 Phase·같은 모델의 새 에이전트를 실패 목록과 함께 띄운다.
   (Build 에서 그 모델이 sonnet 이었으면 위대로 opus 새 에이전트다.)
   `HEAVY_BUSY`·`BASELINE_BUSY`·`DEPS_BUSY`(exit 75)는 실패가 아니라 재시도에 세지 않는다.
5. **서브에이전트가 끝났는데(finished) 이 오케스트레이터가 게이트를 아직 직접 돌리지 않았다면** — 보고에
   게이트 결과가 없거나 "백그라운드 완료를 기다린다"고만 했다면, 그 알림을 기다리지 않는다. 프로세스
   (`pgrep` 등)와 산출물(커밋·파일)을 직접 확인한다. 그 프로세스가 아직 돌고 있으면 알림을 기다리지 말고
   오케스트레이터가 포그라운드에서 그 프로세스가 끝날 때까지 직접 기다린 뒤(예: `kill -0 <PID>` 로 생존을
   확인하며 짧은 간격으로 재확인하거나 로그·산출물 파일을 폴링 — `wait <PID>` 는 그 PID 가 이 Bash 호출의
   자식일 때만 되므로, 다른 호출이나 다른 서브에이전트가 띄운 프로세스에는 쓰지 않는다) 게이트를 돌린다.
   이미 끝나 있고 남은 작업이 없으면 위 「게이트 집행 원칙」대로 게이트를 오케스트레이터가 바로 직접
   돌린다. 오지 않을 알림을 기다리며 입력 대기로 멈추지 않는다. 단, Verify 작성자의 `VERIFY_EXEC` 는 게이트 시점이 아니다 —
   감사 셋의 보고를 받아 위 「Verify」 절차(지적 전달·최종 `PHASE_RESULT`)를 마친 뒤에 게이트를 돈다. 구현 단위가 여럿이면 마지막이 아닌 단위에서는
   "게이트를 돌린다" 를 "그 단위 커밋을 확인하고 다음 단위를 띄운다" 로 읽는다.

Refactor 는 supervised 에서 기본 실행, 실패 시 Refactor 커밋만 되돌린다.
Refactor 가 커밋을 남기지 않았으면 Refactor 게이트를 돌리지 않는다. 무인 실행에서는 Refactor 를 실행하지 않는다
(dev-discipline 「Phase 05」).

## Phase 06 — 마감 (오케스트레이터 본인)

1. `git branch --show-current` 재확인 — `agent/` 브랜치가 아니면 **push 금지, 중단·보고**.
2. 미커밋 잔여물 커밋(파일명 명시) → `git push origin <agent 브랜치>`.
   push 가 훅(G1~G4)에 거부되면 SKIP_GUARD 금지 — 중단하고 사람에게 보고.
   이 브랜치가 파일명이 곧 버전인 마이그레이션(Flyway `V<버전>__…` 등)을 더했으면 push 직전에 dev-discipline 「마이그레이션
   버전」 의 재확인을 먼저 한다.
3. `dflow.sh show <ref>` 로 spec 개정 여부 최종 확인(낡은 명세로 done 방지) →
   `<TASKS>/<TSK>/decisions.json` 작성 →
   `dflow.sh done <ref> "<요약>" --auto-links --decisions <TASKS>/<TSK>/decisions.json`.
   decisions.json(결정 목록의 정본)은 design.md `## 담당자 확인 필요 결정` 절을 옮긴 JSON 배열이다. 항목은 `key`(절의 번호
   `D1`…)·`question`·`options`(2~6개)·`chosen`(택한 선택지의 0부터 센 색인)·`rationale`·`on_reject`. 절이 없거나 0건이면 `[]`
   다. supervised 모드(플래그 없음)도 넘긴다 — 대화로 정한 결정은 확인이 끝났으므로 `[]` 다(서버의 `null` 은 "구 도구" 뜻만
   갖는다). 이 파일은 커밋하지 않는다. done 이 exit 0 이면 지우고, 실패하면 남겨 재시도 재료로 쓴다. `DECISIONS_INVALID …`
   (exit 2)는 파일 형식 오류다 — 고쳐 다시 부른다. stderr 경고 `DECISIONS_COUNT_MISMATCH`·`DECISIONS_SUFFIX_MISSING`(요약
   접미사와 목록 건수가 어긋남)과 `서버가 결정 목록을 모릅니다(계약 < 2.6)`(옛 서버라 요약 접미사로만 전달)는 보고는 된 것이다.
4. state.json 을 `phase=reported` 로 갱신하고, 그 파일을 파일명을 명시해 커밋한 뒤 `git push origin <agent 브랜치>` 한다.
   push 가 훅에 거부되면 우회하지 않고 보고한다. done 은 이미 보고됐으므로 되돌리지 않는다(이 push 가 실패해도
   `/dflow-merge` 의 원격 후보 조건은 phase 에 기대지 않아 승인 반영은 막히지 않는다).
   사용자에게 **"승인 대기로 보고했습니다"** 로 전달(완료 아님).
   **승인은 사람이 D'Flow 웹에서 하는 비동기 이벤트라 이 세션 안에서 못 기다린다** — main 반영은
   다음 `/dflow-dev` 호출의 Phase 01-가 스윕이나 `/dflow-merge` 가 처리하며, 둘 다 원격 agent 브랜치까지 본다.
   `/dflow-poll` 의 승인 감지(exit 9)는 현재 작업트리의 state.json 만 보므로, 다른 브랜치로 옮긴 뒤에는
   이 작업의 승인을 알리지 못한다.

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
