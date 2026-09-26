# dflow 병렬성·토큰 개선 5건 설계

작성 2026-09-26. 의뢰: dmes-standard 팀장 세션(dmes-standard-87), 사용자 지시 "모두 적용하자, 다른 세션에 맡겨".
대상: `/dflow-dev`(Phase 02~04)·`/dflow-team`·D'Flow 서버 claim 관문.

## 1. 근거 데이터 (2026-09-26, dmes-standard 팀원 6건 집계)

- 대상 작업: TSK-06-05·07-02·07-04·08-04·08-06·09-01.
- 가중치(입력 1, 캐시 생성 1.25, 캐시 읽기 0.1, 출력 5) 합계 139M. Build 52.6%, Verify 19.9%, 팀원 메인 11.5%, Design 10.6%,
  조사 에이전트 5.3%.
- Build: 32개 단위가 1,060분. 도구 시간 547분(테스트 384분, 변이 검증 123분), 모델 시간 514분.
- Verify: 6건이 324분. 도구 시간 179분 중 변이 재실행 60분. Verify 한 건은 호출 166~251회, 비용 5~8.8M — 작업마다 가장 큰
  단일 에이전트다.
- `HEAVY_BUSY` 재시도로 확인된 슬롯 대기 최소 130분(기다려 얻은 경우는 출력에 남지 않아 측정 못 함).
- 단위 크기와 비용: W ≈ 0.028M × calls + 0.000024 × calls²(표본 32개, 33~195회). 거의 직선이고 제곱 항은 약 120회를 넘을
  때부터 눈에 띈다.

## 2. 개선 1 — Verify 를 병렬 읽기 전용 감사와 작성자 1명으로 나눈다

### 2.1 문제

Verify 서브에이전트 하나가 스펙 대조·코드 리뷰·테스트 품질·변이 재실행·E2E·수정을 모두 한다. 호출이 166~251회로 쌓이며
누적 컨텍스트가 커지고, 조사와 실행이 한 줄로 이어져 느리다.

### 2.2 결정

오케스트레이터가 Verify 에서 **한 메시지에 넷을 동시에 띄운다.**

| 역할 | 하는 일 | 모델 | 쓰기 |
|---|---|---|---|
| 감사자 spec | spec 수용 기준 ↔ 코드·테스트 증거 대조 | sonnet | 없음 |
| 감사자 review | 기점..Build 게이트 sha diff 코드 리뷰(정확성·불변 규칙 위반·에러 처리·보안) | sonnet | 없음 |
| 감사자 tests | 테스트 품질(새 테스트 존재·삭제/skip/기대값 완화 여부)과 「변이 검증 기록」 표의 서류 감사(불변 규칙 전부 덮음·결과 값 형식·의심 행 목록) | sonnet | 없음 |
| `<TSK>-verify`(작성자) | 린트, 변이 표본 재실행(개선 2), 화면 작업이면 E2E, 그리고 감사 지적의 판정과 수정 | sonnet | 유일 |

- **감사자는 커밋된 내용만 읽는다**: `git diff <기점>..<Build 게이트 sha>`, `git show <Build 게이트 sha>:<경로>` 로 읽고 작업
  트리 파일을 Read 하지 않는다. 같은 시각 작성자가 작업 트리에 변이를 넣고 있기 때문이다 — 작업 트리를 읽으면 변이를 결함으로
  보고한다.
- 감사자는 부모 컨텍스트를 물려받지 않는 새 general-purpose 서브에이전트(fork 금지. Explore 는 위치 찾기용이라 리뷰가 얕아진다)이고, 프롬프트 템플릿은 phase-prompt.md 「감사 템플릿」
  하나를 역할만 바꿔 쓴다. 도구 호출 상한은 약 40회다. 결과는 지적 목록(심각도·파일:줄·근거·재현 조건)으로만 돌려준다.
- 감사자에게 haiku 를 쓰지 않는다: 2026-09-24 게이트 절감에서 haiku Verify 의 54% 가 부실 PASS 였다. 감사는 판단이 핵심이라
  sonnet 으로 둔다(모델 배정표의 Verify 행과 같다).
- **작성자 흐름**: 작성자는 실행 몫(린트·변이 표본·E2E)을 먼저 끝내 보고한다. 오케스트레이터는 감사자 셋과 작성자의 보고가
  모두 오면 감사 지적을 모아 **같은 작성자에게 SendMessage 로** 넘긴다. 작성자는 지적마다 수용·기각(사유)을 판정하고 수용한
  것을 Build 규율로 고쳐 커밋한 뒤 최종 `PHASE_RESULT` 를 보고한다. 지적이 0건이면 작성자의 첫 보고가 최종이다.
  - 작성자 에이전트가 이미 회수됐으면(SendMessage 불가) 같은 모델의 새 작성자를 지적 목록과 함께 띄운다.
- 감사자는 이름 없이 띄운다. 이름을 붙인 에이전트는 실행 환경에 따라 별도 pane·프로세스로 뜨는데(16GB 팬 없는 기기에서 넷이 동시에 뜨는 부담), 감사자는 SendMessage·TaskStop 할 일이 없고 보고하면 스스로 끝난다.
- research/docs 특례 작업은 종전처럼 작성자 혼자 문서 검증 체크리스트를 순회한다(감사자를 띄우지 않는다 — 대상 코드가 없다).
- Verify 재시도 1회 규칙은 그대로다. 재시도는 작성자에게만 이어 붙이고 감사자는 다시 띄우지 않는다.

### 2.3 기대 효과

Verify 비용 약 절반, 작업당 Verify 시간 약 54분 → 25분(의뢰 목표). 감사자는 각자 좁은 범위만 읽어 누적 컨텍스트가 작고, 작성자의
실행 시간과 겹친다.

### 2.4 한계

- 감사자 셋의 프롬프트·첫 읽기(spec·design·diff)가 중복된다. 좁은 범위라 셋을 더해도 한 에이전트의 누적보다 작다고 본다.
  실측으로 확인할 항목이다.
- 감사 지적이 작성자 판단을 거치므로 오판 지적은 걸러지지만, 작성자가 타당한 지적을 기각할 위험은 남는다. 기각 사유는
  보고에 남아 사람이 본다.

## 3. 개선 2 — Verify 의 변이 재실행을 표본 감사로 바꾼다

### 3.1 문제

phase-verify.md 2번이 build-log 「변이 검증 기록」 의 행을 모두 다시 넣게 해, 6건에서 60분을 썼다. Build 가 이미 같은 변이를 돌렸다.

### 3.2 결정

작성자는 다음 행만 다시 넣는다.

1. **의심 행 전부**: 잡은 테스트 칸이 비었거나 `-`, 결과가 세 값(`잡힘`·`안 잡힘(보강함)`·`안 잡힘(보고)`) 밖, `안 잡힘(보강함)`
   (보강한 테스트가 실제로 잡는지), 잡은 테스트가 design.md 「불변 규칙」 의 대상 테스트와 다른 행.
2. **무작위 표본 2행**: 의심 행이 아닌 행 가운데 서로 다른 불변 규칙의 행 2개(행이 2개 미만이면 전부).

표본 한 행이라도 기록과 다르게 나오면(안 잡힘) 표본 감사를 버리고 **남은 행 전부를 다시 넣는다**. 서류 감사(규칙 누락·표와 결과의
모순)는 감사자 `audit-tests` 가 한다. `안 잡힘(보고)` 행은 다시 넣지 않고 보고됐는지만 본다.

### 3.3 근거

Build 가 변이 검증을 이미 한 번 돌렸고, Verify 의 역할은 재측정이 아니라 기록의 신뢰성 감사다. 표본이 기록과 맞으면 기록 전체를
믿고, 어긋나면 전수로 넘어가는 것이 감사 표본의 일반 구조다.

## 4. 개선 3 — 구현 단위 크기 기준

### 4.1 결정

- 단위 크기: 도구 호출 **약 50~100회**. 50회 미만으로 예상되는 단위는 이웃 단위와 합친다.
- **작업 전체 예상이 약 120회 이하면 단위 표를 두지 않는다**(단위 1개).
- 인계 상한: 도구 호출 **약 120회**(종전 80회)·컨텍스트 250K 추정.

### 4.2 근거

W ≈ 0.028M × calls + 0.000024 × calls² 에서 제곱 항은 120회에서 0.35M, 선형 항 3.4M 의 약 10% 다. 80회 상한은 곡선상 절감이
거의 없는데 단위마다 spec·design 을 다시 읽는 고정비(새 컨텍스트)와 인계 비용을 늘렸다. 반대로 195회까지 간 단위는 제곱 항이
0.9M 으로 커지므로 상한은 둔다.

## 5. 개선 4 — 같은 모듈 안의 단위 병렬(제외)

의뢰 뒤 사용자 결정으로 뺐다(2026-09-26 dmes-standard-87 통지). 이 PC 는 M5 10코어·16GB·팬 없는 MacBook Air 라, 워크트리마다
컴파일과 테스트 JVM 부하가 따로 생기고 부하가 오래 이어지면 열로 클럭이 떨어진다. 무거운 명령 슬롯도 2개뿐이라 테스트끼리는
결국 줄을 서서 이득이 작다. 같은 모듈 안의 단위는 종전대로 묶지 않는다(phase-design.md 「묶음」 조건 1).

## 6. 개선 5 — 설계 단계(`ds`) 신설과 선행 대기 중 설계 선행

### 6.1 문제

- 서버 claim 관문은 선행이 `reached=false` 이면 claim 을 403 `dependency_not_met` 로 거부한다(`src/app/api/v1/agent/work/[id]/claim/route.ts`).
  WBS 사슬 때문에 팀 슬롯 3개 중 2개가 논다.
- 단계는 `as → ip → im → xx` 이고 claim 하면 곧바로 `ip` 다(0103 `apply_workflow_event`). 설계와 구현이 `ip` 하나에 묶여 있어,
  "설계만 먼저 한다" 를 단계로 나타낼 수 없다. 사용자 지시(dmes-standard-87 경유): "여러 단계에서 ip 로 되어 있는 부분에서 디자인
  단계를 넣어야겠어".

### 6.2 결정 — 단계 `ds`(설계 중)

- 단계 순서: `as → ds → ip → im → xx`. 라벨 ko `설계 중`, en `Designing`.
- 크레딧 키 `ds` 를 `as` 와 `ip` 사이에 더한다. 기본값 **10**(`as 0 / ds 10 / ip 30 / rw 50 / im 80 / xx 100`). 프로젝트 설정 표에
  `ds` 가 없으면 기본값으로 채운다(기존 표를 고쳐 쓰지 않는다).
- `ds` 는 선행 충족(`reached`)이 아니다(`REACHED_STAGES` 는 `im`·`xx` 그대로). 사람의 단계 잠금 규칙도 `ip` 와 같다.
- 사람이 단계를 직접 고르는 곳(`set_stage`)과 wbs.md import 도 `ds` 를 받는다.

### 6.3 서버 계약(v2.9)

| 사건 | 조건 | 결과 |
|---|---|---|
| claim(종전, 플래그 없음) | 선행 모두 reached | 주문 claimed, 단계 `ip`, 크레딧 ip — **옛 클라이언트와 글자 그대로 같다** |
| claim + `design_first: true` | 선행 미충족이어도 된다. 단, 미충족 선행이 모두 `ip`(구현 중)여야 한다 — 미착수·`as`·`ds`(선행도 설계만 하는 중) 선행이 하나라도 있으면 403 `dependency_not_met` 에 `reason: "design_first_too_early"`. 설계 선행은 한 단계 깊이까지만이다(`im` 은 이미 reached 라 미충족 목록에 없다) | 주문 claimed, 단계 `ds`, 크레딧 ds. 응답에 `design_first: true`, `unmet:[{external_ref, stage}]` |
| build_start(신규, `POST /work/{id}/build-start`) | 점유자 본인, 주문 claimed. 선행 모두 reached(아니면 403 `dependency_not_met` + `unmet`) | 단계 `ds → ip`, 크레딧 ip. 이미 `ip` 이상이면 아무것도 바꾸지 않고 `ok`(멱등) |
| reject·rework·release·report_completion·approve | 종전 | 종전(`reject`·`rework` → `ip`, `release` → `as`) |

- 새 클라이언트는 선행이 모두 충족돼도 `design_first: true` 로 claim 하고 Design 뒤 build_start 를 부른다 — `ds` 는 "설계 중" 이라는
  뜻을 일관되게 가진다.
- RPC: `apply_workflow_event` 에 사건 `build_start` 를 더하고, `claim` 은 `p_stage='ds'` 일 때 `ds` 로 간다. 마이그레이션 0107
  (+`_rollback.sql`)이 단계 check 제약·RPC(0103 본문 전체가 기준)·기본 크레딧을 바꾼다. rollback 은 `ds` 행을 `ip` 로 옮긴 뒤
  제약을 되돌린다. 마이그레이션은 코드와 별도 커밋이다(G1).
- build-start 라우트는 claim 라우트의 후처리(실적이 바뀌면 `revalidatePath`·진척 스냅샷)를 똑같이 한다.
- 계약 버전 `AGENT_CONTRACT_VERSION` 2.8 → 2.9, `dflow.sh` `CONTRACT_VERSION` 2.9, `api-contract.md` 에 두 줄.
- **옛 서버 호환(스킬 쪽)**: 옛 서버는 `design_first` 를 무시하고 선행 미충족이면 403 을 낸다 — 스킬은 종전 "선행 대기" 로
  처리한다. 옛 서버에 build-start 를 부르면 404 다(본문이 JSON 이 아닐 수 있다) — `dflow.sh build-start` 는 본문과 무관하게
  404 면 `BUILD_START_UNSUPPORTED`(exit 0)로 알리고 넘어간다
  (옛 서버의 claim 은 이미 `ip` 로 보냈다). 그래서 스킬을 서버보다 먼저 배포해도 종전 동작으로 물러난다.

### 6.4 좌석 표시

- 선행 대기로 멈춘 주문은 claimed·단계 `ds` 인 채로 heartbeat 가 끊긴다. 서버에 자동 회수(stale sweep)는 없다(조사 확인 —
  `seatState.ts` 의 STALE·OFFLINE 은 표시만 한다). 그대로 두면 좌석이 STALE·OFFLINE 으로 보인다.
- 팀원이 멈추기 직전에 heartbeat `phase: "wait_pred"` 를 보낸다(허용 phase 에 추가). 좌석 계산은 claimed ∧ `heartbeat_phase =
  wait_pred` 이면 침묵 시간과 무관하게 `WAIT` 로 보고 대기 사유 `선행 대기`(기존 `waitReason` dependency) 를 붙인다.

### 6.5 스킬 흐름

**dflow-work `dflow.sh`**: `claim <ref> --design-first`(바디 `design_first:true`), `build-start <ref>`(403 `dependency_not_met` 은
exit 4 — claim 의 선행 대기와 같은 코드, 404 는 `BUILD_START_UNSUPPORTED` exit 0).

**dflow-dev Phase 01**: 서버 계약이 2.9 이상이면 늘 `--design-first` 로 claim 한다.
- 응답의 `unmet` 이 비어 있으면 종전 그대로다(기점은 선행 코드가 반영된 기본 브랜치 등 종전 규칙).
- `unmet` 이 있으면 **설계 선행 모드**다. 기점은 기본 브랜치 끝(선행 코드 없음)이고 state.json 에
  `design_first: {"unmet": [<ref>…]}` 를 적는다. 기준선은 종전대로 잰다(Build 전에 기점이 바뀌면 다시 잰다 — 아래).
- Design 프롬프트에 설계 선행 모드임과 선행 계약을 읽을 곳을 넣는다: 선행의 보고된 `head_sha`(evidence) → 없으면 선행 agent
  브랜치(`origin/agent/<선행>` 이 있으면) → 없으면 선행 spec 만. design.md 에 `## 선행 기준` 절을 쓴다 — 선행 ref | 읽은 곳과 sha |
  기대는 선행 계약(파일·심볼·엔드포인트).

**Design 게이트 뒤(build_start)**: 오케스트레이터가 `dflow.sh build-start <ref>` 를 부른다.
- exit 0 → Build 로 간다(종전).
- exit 4(선행 미충족) → design.md 를 커밋하고 state.json `phase` 를 `wait_pred` 로, heartbeat `wait_pred` 를 보내고 agent 브랜치를
  push 한 뒤 멈춘다. supervised 는 사용자에게 "설계 완료·선행 대기" 로 알리고, `--worker` 는 `.result` 에 `design_waiting` 을 쓴다.

**재개(state.json `phase=wait_pred`)**: `show` 로 선행이 모두 reached 인지 본다. 아니면 다시 멈춘다. 모두 reached 면:
1. 선행 코드를 한 번 들인다 — **Phase 01 의 기점 선정 로직을 그대로 다시 탄다**(`depends_evidence` 의 `head_sha`·
   `check_depends_local`·선행 미승인/머지 필요/기점 없음 세 갈래). `reached` 는 `im`(보고됨, 미머지)이나 승인 뒤 머지 전에도 참이라
   선행 코드가 기본 브랜치에 없을 수 있기 때문이다. 그렇게 정한 기점을 agent 브랜치에 한 번 머지한다(agent 브랜치에는 Task 문서
   커밋뿐이라 코드 충돌이 없다). "개발 브랜치 재머지 금지, 선행 코드가 꼭 필요할 때 한 번만" 규칙의 그 한 번이다. state.json
   `baseline` 의 기점을 바꾸고 `baseline.cmds` 를 모듈 기준선까지 모두 비운 뒤 다시 잰다.
2. **선행 계약 재확인**: design.md `## 선행 기준` 의 파일마다 `git diff --name-only <적힌 sha>..<새 기점> -- <파일>` 을 본다. 적힌
   sha 가 없거나(spec 만 읽었음) 로컬에 없으면(선행 브랜치 삭제·squash) 바뀐 것으로 본다. 바뀐 것이 있으면 Design 을 **검토 모드**로 다시 띄운다 — 종전 design.md 와
   그 파일의 diff 를 주고, 어긋난 절만 고치게 한다. Design 게이트를 다시 돈다.
3. `build-start` 를 부르고 Build 로 간다.

**dflow-team**: 빈 슬롯이 있고 선행 충족 후보가 없을 때만 선행 대기 큐의 작업을 설계 선행으로 배정한다. 조건은 설계 완료·선행
대기 상태인 작업이 `DFLOW_DESIGN_AHEAD_MAX`(기본 2) 미만일 때다. 선행 단계 조건은 스킬에서 다시 판정하지 않고 서버의
`design_first_too_early` 거부에 맡긴다(팀원은 종전 `skipped`·`선행 미충족` 으로 끝난다). 팀원이 `.result=design_waiting` 로
끝나면 좌석을 비우고 그 작업을 선행 대기 블록에 `designed` 표시와 함께 넣는다. poll 이 선행 충족을 보면 그 작업을 다시 배정한다
(재개 — 위 흐름).

**팀장 재시작 경로**: 팀장의 재시작 후보(서버 `claimed`+`mine`+이 PC, 살아 있는 팀원 없음 — dflow-team restart.md)는 `wait_pred`
주문도 해당된다. 그대로 두면 "재개 → 여전히 미충족 → 종료 → 재개" 가 끝없이 돈다. 워크트리 state.json 의 `phase` 가 `wait_pred`
이고 `show` 의 선행이 모두 reached 가 아니면 재시작 후보에서 뺀다.

**점유자 신원**: build_start 는 점유자 본인만 부를 수 있다. 재개로 새로 띄운 팀원이 처음 claim 한 agent 라벨과 같은 신원을 쓰는지
(restart 경로의 라벨 규칙) 확인하고 테스트로 고정한다.

**`.result`**: worker-prompt.md 「7」 의 status 표에 `design_waiting`(사유: 미충족 선행 ref 목록)을 더한다. 팀장은 이 값을 `failed`
로 처리하지 않고 워크트리를 남긴 채 좌석만 비운다.

**heartbeat**: 킷 heartbeat.sh 는 state.json 의 `phase` 를 그대로 보낸다. 그래서 `phase=wait_pred` 를 적은 뒤의 heartbeat 가
`wait_pred` 를 싣는다. 새 서버는 허용 phase 에 `wait_pred` 를 더하고, 옛 서버는 400 으로 거부할 뿐 작업에 영향이 없다(훅은
실패해도 세션을 막지 않는다).

### 6.6 위험과 대응

| 위험 | 대응 |
|---|---|
| 선행의 계약이 바뀌어 먼저 한 설계가 틀린다 | `## 선행 기준` 에 읽은 곳·sha·기대 계약을 적고, 재개 때 diff 로 재확인해 바뀌었으면 검토 모드 Design. 착수 전 선행(`as`)에는 설계 선행을 허용하지 않는다(서버가 막음) |
| 설계만 끝난 작업이 쌓여 재작업이 커진다 | `DFLOW_DESIGN_AHEAD_MAX`(기본 2), 선행 충족 후보 우선 |
| 멈춘 주문이 좌석을 STALE 로 보이게 한다 | heartbeat `wait_pred` → 좌석 WAIT·선행 대기 |
| 스킬이 서버보다 먼저 배포된다 | 옛 서버는 플래그를 무시·build-start 404 → 스킬이 종전 동작으로 물러난다 |
| 서버가 스킬보다 먼저 배포된다 | 플래그 없는 claim 은 종전 그대로(`ip`) |
| 설계 중 ds 크레딧이 진척을 부풀린다 | 10% 로 낮게 둔다(사용자가 설정에서 바꿀 수 있다) |

### 6.7 사용자 확인이 필요한 제품 결정(구현은 기본값으로 진행)

1. `ds` 크레딧 기본값 10.
2. 새 클라이언트는 선행이 충족된 작업도 늘 `ds` 를 거친다(모든 작업의 단계 표시가 바뀐다).
3. 선행이 `ds` 일 때는 설계 선행을 허용하지 않는다(한 단계 깊이).

### 6.8 배포 순서(사용자 확인 뒤)

스테이징 DB 0107 → staging 코드 → 검증 → 운영 DB 0107 → main. 역순이면(코드 먼저) `ds` 를 쓰는 RPC 호출이 check 제약에 걸린다.

## 7. 계약 테스트

- `tests/skills/dflow-dev-gate-economy.test.ts`: Verify 감사 문구, 단위 상한 문구 갱신.
- 새 테스트: Verify 감사 템플릿·표본 규칙·단위 크기 문구, 선행 설계 선행(개선 5)의 서버·스킬 계약.
