# /dflow-dev 단계 — 승인 스윕(수동 착수 첫 단계)

SKILL.md 「단계 지도」 가 가리킬 때 읽는다. 다 읽기 전에 이 단계를 시작하지 않는다. 모든 단계에 공통인 규칙(게이트 집행 원칙·상태 모델·서버 통신)은 SKILL.md 에 있다.

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


**다음 단계**: `orch/start.md`.
