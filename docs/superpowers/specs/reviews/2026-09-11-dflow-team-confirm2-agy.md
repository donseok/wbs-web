`/dflow-team` 스킬의 설계 스펙(`docs/superpowers/specs/2026-09-10-dflow-team-design.md`)과 구현 계획서(`docs/superpowers/plans/2026-09-10-dflow-team.md`)에 대한 2차 독립 검토(READ-ONLY) 결과 보고서입니다.

---

# `/dflow-team` 설계 및 구현 계획 2차 검토 보고서

## 1. 검토 요약
- **전체 정합성**: 1차 확인 라운드의 18개 수정 요구사항(`api_base` 전파, `branch_base` 기반 조상 판정, `head_sha` 변경 검사, `poll.sh` 디렉터리 격리 실행, zsh 호환성 등)은 스펙과 계획서 전반에 정확히 반영되었습니다.
- **기존 코드 보존 검증**: Task 1(`dflow-dev`) 및 Task 2(`dflow-merge`)의 원문 줄 보존 테스트(`_preserve.ts`)는 실제 파일 내용과 1 바이트 오차 없이 완벽히 일치합니다.
- **핵심 결함 발견**: 마감(Wrap-up) 단계에서 팀장 잠금(`.lead`)을 해제할 때 `events.jsonl`의 `tail -n 1`을 조회하여 시각을 비교하는 로직에 **타 세션의 활성 잠금을 강제로 오인 삭제하는 치명적 경쟁 상태(Race Condition)**가 확인되었습니다. 구현 착수 전 반드시 수정이 필요합니다.

---

## 2. 발견된 결함 및 수정 필요 항목

### [결함 1] 마감 시 팀장 잠금 삭제 로직의 타 세션 잠금 오인 삭제 결함 (스펙-계획 불일치 및 경쟁 상태)
- **심각도**: **높음 (High)**
- **근거 위치**:
  - **스펙**: [`docs/superpowers/specs/2026-09-10-dflow-team-design.md#L609-L615`](file:///Users/jji/project/wbs-web/docs/superpowers/specs/2026-09-10-dflow-team-design.md#L609-L615)
  - **계획서**: [`docs/superpowers/plans/2026-09-10-dflow-team.md#L2468-L2472`](file:///Users/jji/project/wbs-web/docs/superpowers/plans/2026-09-10-dflow-team.md#L2468-L2472)
- **코드 및 텍스트 대조**:
  - 스펙 §4-9 (610~613행):
    > "`owner` 파일의 첫 줄이 `<신원>/<host>/lead`이고, 시작 시각이 이 팀장의 마지막 `team.start` 이하인지 확인 — 다른 팀장이 새로 획득한 잠금을 오인 삭제하지 않기 위함"
  - 계획서 Task 5 (2468~2472행):
    ```bash
    start=$(jq -r --arg a '<신원>/<host>/lead' --arg r '<MAIN>' 'select(.agent == $a and .repo == $r and .event == "team.start") | .ts | fromdateiso8601' ~/.dflow/events.jsonl 2>/dev/null | tail -n 1)
    { read -r o_who o_ts < "$LOCK/owner"; } 2>/dev/null
    [ "${o_who-}" = '<신원>/<host>/lead' ] && [ -n "$start" ] && [ "${o_ts:-x}" -le "$start" ] 2>/dev/null && rm -rf "$LOCK"
    ```

- **구체적 실패 시나리오**:
  1. **t=1000**: 동일 사용자/호스트 환경(`jji/mac/lead`)에서 세션 A(팀장)가 기동하여 `$LOCK/owner`에 `jji/mac/lead 1000`을 쓰고 잠금을 획득함.
  2. **t=1100~5700**: 세션 A가 긴 작업 또는 일시적 중단으로 인해 70분 이상 heartbeat를 갱신하지 못해 lock이 stale 상태(beat 경과 시간 > 60분)가 됨.
  3. **t=5800**: 동일 사용자가 새 터미널에서 세션 B(팀장)를 실행함. 세션 B는 stale lock을 감지하여 잠금을 탈취(steal)하고, `$LOCK/owner`에 `jji/mac/lead 5800`을 기록한 뒤, t=5801에 `team.start` 이벤트를 `events.jsonl`에 추가함.
  4. **t=5810**: 뒤늦게 작업을 마치거나 재개된 세션 A가 마감 루틴(Step 4-9)에 진입함.
  5. 세션 A는 `events.jsonl`에서 `tail -n 1`로 `team.start` 시각을 조회하므로, 세션 A 자신의 시각(1000)이 아니라 **세션 B의 시작 시각(5801)**을 `$start`로 가져옴.
  6. 현재 `$LOCK/owner`에는 세션 B의 시작 시각인 `5800`이 적혀 있음.
  7. 세션 A는 `[ "5800" -le "5801" ]` 평가를 수행하고, 이는 **참(True)**이 됨.
  8. **결과**: 세션 A가 `rm -rf "$LOCK"`을 실행하여, **현재 활발히 동작 중인 세션 B의 잠금 디렉터리를 강제로 삭제해버림**.

- **해소안**:
  `events.jsonl`에서 `tail -n 1`로 동적 조회하는 방식은 이전 세션이 마감할 때 최신 세션의 이벤트를 참조하게 되므로 안전하지 않습니다.
  1. 기동 시(Step 1 / Step 4) 자신이 `$LOCK/owner`에 기록했던 시각(`MY_LOCK_TS="$(date +%s)"`) 또는 세션 식별자(PID 또는 UUID)를 환경 변수/세션 상태로 유지합니다.
  2. 마감 시점에는 `$LOCK/owner`의 내용이 자신이 발급한 값과 **정확히 일치(`[ "$o_ts" = "$MY_LOCK_TS" ]`)할 때만 삭제**하도록 변경합니다.
  ```bash
  { read -r o_who o_ts < "$LOCK/owner"; } 2>/dev/null
  [ "${o_who-}" = "$who/$host/lead" ] && [ "${o_ts-}" = "$MY_LOCK_TS" ] && rm -rf "$LOCK"
  ```

---

### [결함 2] 잠금 조회 시 `read` 실패에 따른 스크립트 중단 위험
- **심각도**: **중간 (Medium)**
- **근거 위치**:
  - 계획서 Task 5 [`docs/superpowers/plans/2026-09-10-dflow-team.md#L2470`](file:///Users/jji/project/wbs-web/docs/superpowers/plans/2026-09-10-dflow-team.md#L2470)
  - 계획서 Task 7 [`docs/superpowers/plans/2026-09-10-dflow-team.md#L2063`](file:///Users/jji/project/wbs-web/docs/superpowers/plans/2026-09-10-dflow-team.md#L2063)
- **문제점**:
  - `{ read -r o_who o_ts < "$LOCK/owner"; } 2>/dev/null` 구문은 파일이 존재하지 않거나 개행 없는 빈 파일일 경우 exit status 1을 반환합니다.
  - 마감 스크립트가 `set -e` 또는 trap 환경에서 실행될 경우, 이 라인에서 스크립트가 즉시 비정상 종료되어 뒤이어 실행되어야 할 `beat cron 해제`, `team.end 이벤트 기록`, `보고서 출력` 등이 통째로 스킵될 수 있습니다.
- **해소안**:
  - `{ read -r o_who o_ts < "$LOCK/owner"; } 2>/dev/null || true` 형태로 항상 0을 반환하도록 방어 코드를 추가합니다.

---

### [참고/권고] 생성 브랜치 정리 시 워크트리 이름 유실 대비 패턴 보완
- **심각도**: **낮음 (Low / Advisory)**
- **근거 위치**:
  - 계획서 Task 4 Step 3 [`docs/superpowers/plans/2026-09-10-dflow-team.md#L1532`](file:///Users/jji/project/wbs-web/docs/superpowers/plans/2026-09-10-dflow-team.md#L1532)
- **상세**:
  - `git branch --format='%(refname:short)' --list 'worktree-<워크트리 디렉터리 이름>' '*dflow-<id8>*'`
  - 에이전트 팀 워크트리가 팀원의 자율 종료로 이미 디렉터리가 삭제된 상태에서 마감 루틴에 진입했을 경우, 팀장 세션이 워크트리 디렉터리 이름을 기억하지 못하면 꺾쇠 표기 변수를 채우지 못할 수 있습니다.
  - 디렉터리 이름을 명시적으로 특정할 수 없는 경우를 대비하여 `worktree-agent-*` 글로브 패턴으로 일괄 탐색 후 조상 검사를 거치도록 가이드를 명시하면 더욱 안전합니다.

---

## 3. 정상 확인 및 정합성 검증 완료 항목

1. **기존 스킬 원문 보존 테스트 (`_preserve.ts`) 실측 검증 완료**
   - [`.claude/skills/dflow-dev/SKILL.md`](file:///Users/jji/project/wbs-web/.claude/skills/dflow-dev/SKILL.md) (205행): 계획서 Task 1의 앵커 문자열 및 `firstLostLine`("## 작업 사이클")이 1 바이트 오차 없이 정합함을 확인했습니다.
   - [`.claude/skills/dflow-merge/SKILL.md`](file:///Users/jji/project/wbs-web/.claude/skills/dflow-merge/SKILL.md) (45행): 계획서 Task 2의 앵커 문자열("`agent/<id8>` 브랜치를 main에 머지하고") 및 `firstLostLine`("머지는 팀장(사람)이 트리거하며")이 실제 원문과 완전 정합함을 확인했습니다.

2. **1차 확인 라운드 18개 요구사항 전수 반영 확인**
   - **`api_base` 전파**: Phase 0-3(`task.register`), Phase 0-4(`agent.assign`), 반려 시 재작업 할당, 스윕 필터링(`select(.api_base == ...)`), Step 4-9 마감 이벤트 전파까지 스펙과 계획서에 누락 없이 일관되게 규정되었습니다.
   - **`branch_base` 조상 판정 일반화**: 특정 `agent/<id8>` 패턴에만 국한되지 않고, `git merge-base --is-ancestor "$base" "$branch_base"`를 통해 임의의 유효한 git ref를 조상으로 정확히 검증합니다.
   - **`head_sha` 변경 검사**: 단순 ref 조회를 넘어 `git diff --name-only <head_sha>..<ref>` 및 `git rev-parse HEAD`를 통한 미커밋/추가 커밋 검증 로직이 반영되었습니다.
   - **`poll.sh` 감시 루프 격리 실행**: 대상 워크트리가 아닌 임시 빈 디렉터리(`cd "$POLL_ISOLATED_DIR"`)에서 격리 실행하며, exit code(0/1/2)에 따른 분기 처리가 정확히 일치합니다.
   - **zsh 쉘 호환성**: 매치되지 않는 파일 글로브로 인한 에러를 방지하기 위해 `find`를 사용하고, 문자열 비교 연산자 `[ \> ]`를 배제하는 등 zsh 호환성 원칙이 철저히 준수되었습니다.

---

## 4. 결론 및 권고사항
- **결론**: 전체적인 설계 완성도와 계획서의 상세성은 매우 뛰어나며, 실무 구현에 즉시 착수할 수 있는 수준입니다.
- **권고사항**: 구현 착수 전 **Task 5 (2468~2472행)**의 마감 잠금 삭제 로직에서 `tail -n 1`을 통한 `events.jsonl` 시각 비교를 제거하고, **기동 시 기록한 자신의 잠금 타임스탬프(`MY_LOCK_TS`)와 정확히 일치할 때만 삭제(`[ "$o_ts" = "$MY_LOCK_TS" ]`)하도록 계획서를 수정**한 뒤 구현을 시작할 것을 권장합니다.
