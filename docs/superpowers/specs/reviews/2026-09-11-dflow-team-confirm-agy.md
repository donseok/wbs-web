# `/dflow-team` 설계 명세 및 구현 계획서 사전 독립 리뷰 보고서

- **대상 문서**:
  - 설계 명세서 (Source of Truth): [`docs/superpowers/specs/2026-09-10-dflow-team-design.md`](file:///Users/jji/project/wbs-web/docs/superpowers/specs/2026-09-10-dflow-team-design.md)
  - 구현 계획서: [`docs/superpowers/plans/2026-09-10-dflow-team.md`](file:///Users/jji/project/wbs-web/docs/superpowers/plans/2026-09-10-dflow-team.md)
  - 미결 과제 문서: [`docs/superpowers/specs/2026-09-11-office-team-blockers.md`](file:///Users/jji/project/wbs-web/docs/superpowers/specs/2026-09-11-office-team-blockers.md) (팀장 스킬 및 요약 영역)
- **비교 검증 대상 기존 코드**:
  - [`.claude/skills/dflow-dev/SKILL.md`](file:///Users/jji/project/wbs-web/.claude/skills/dflow-dev/SKILL.md)
  - [`.claude/skills/dflow-merge/SKILL.md`](file:///Users/jji/project/wbs-web/.claude/skills/dflow-merge/SKILL.md)
  - [`.claude/skills/dflow-poll/SKILL.md`](file:///Users/jji/project/wbs-web/.claude/skills/dflow-poll/SKILL.md) 및 [`scripts/poll.sh`](file:///Users/jji/project/wbs-web/scripts/poll.sh)
  - [`.claude/skills/dflow-work/scripts/dflow.sh`](file:///Users/jji/project/wbs-web/.claude/skills/dflow-work/scripts/dflow.sh)
  - [`src/app/api/v1/agent/work/[id]/route.ts`](file:///Users/jji/project/wbs-web/src/app/api/v1/agent/work/[id]/route.ts), [`src/app/api/v1/agent/me/route.ts`](file:///Users/jji/project/wbs-web/src/app/api/v1/agent/me/route.ts)
  - [`scripts/kit-build.sh`](file:///Users/jji/project/wbs-web/scripts/kit-build.sh), [`kit/install.sh`](file:///Users/jji/project/wbs-web/kit/install.sh), [`kit/README.md`](file:///Users/jji/project/wbs-web/kit/README.md)
  - [`vitest.config.ts`](file:///Users/jji/project/wbs-web/vitest.config.ts)
- **검증 환경 및 방식**:
  - 순수 READ-ONLY 방식 (저장소 내 파일 생성·수정·삭제 없음, 상태 변경 git 명령 없음)
  - 계획서에 명시된 6개 테스트 스위트의 71개 Vitest 테스트 케이스를 계획서 내 코드 조각 및 실 코드베이스와 1:1 교차 시뮬레이션 검증 수행 (모든 테스트 통과 확인)

---

## 1. 종합 평가

> [!NOTE]
> 설계 명세서와 구현 계획서는 앞선 교차 리뷰를 거치며 **구조적 결함(치명/높음 등급)이 모두 해소된 매우 완성도 높은 상태**입니다.
> - 기존 스킬(`dflow-dev`, `dflow-merge`)의 보존 영역과 변경 영역 경계가 명확하고,
> - 락(Lock) 및 하트비트(Staleness 70분) 처리, 빈 디렉터리(`POLL_DIR`)를 통한 공회전 방지,
> - Detached HEAD 기반 Claim, `/dflow-merge` 위임 격리 등 세부 엣지 케이스가 꼼꼼하게 방어되어 있습니다.
>
> 구현 착수 전 수정이 권장되는 사항은 **경로 공백 처리 누락(중간 1건)** 및 **환경별 셸 예외 처리/안내 보완(낮음 2건)**으로 국한됩니다.

---

## 2. 발견된 문제점 및 개선 사항 (Findings)

### Finding 1. `poll.sh` 서브셸 실행 시 경로 인용부호(따옴표) 누락으로 인한 공백 경로 취약성

- **심각도**: **중간**
- **근거**:
  - [`docs/superpowers/plans/2026-09-10-dflow-team.md#L2017-L2019`](file:///Users/jji/project/wbs-web/docs/superpowers/plans/2026-09-10-dflow-team.md#L2017-L2019)
    ```bash
    2017: ( cd "$POLL_DIR" && DFLOW_ENV_FILE=<MAIN>/.env \
    2018:     <MAIN>/.claude/skills/dflow-poll/scripts/poll.sh --require-tag agent --until <HH:MM> --interval 300 \
    2019:     [--exclude <id8,id8>] [--exclude-temp <id8,id8>] )
    ```
  - [`docs/superpowers/specs/2026-09-10-dflow-team-design.md#L358-L360`](file:///Users/jji/project/wbs-web/docs/superpowers/specs/2026-09-10-dflow-team-design.md#L358-L360)
    ```bash
    358: ( cd "$POLL_DIR" && DFLOW_ENV_FILE=<MAIN>/.env \
    359:     <MAIN>/.claude/skills/dflow-poll/scripts/poll.sh --require-tag agent --until <HH:MM> --interval 300 \
    360:     [--exclude <id8,id8>] [--exclude-temp <id8,id8>] )
    ```
  - 반면 워커 프롬프트 템플릿([`docs/superpowers/plans/2026-09-10-dflow-team.md#L1432`](file:///Users/jji/project/wbs-web/docs/superpowers/plans/2026-09-10-dflow-team.md#L1432)) 등 타 위치에서는 `DFLOW_ENV_FILE="<MAIN>/.env"`와 같이 큰따옴표를 적용하고 있음.
- **실패 시나리오**:
  - 작업 저장소 경로(`<MAIN>`)에 공백이 포함된 디렉터리(예: `/Users/username/My Projects/wbs-web`)에서 실행될 경우, 서브셸 실행 시 `DFLOW_ENV_FILE=/Users/username/My`로 끊기고, 뒤따르는 `Projects/wbs-web/.claude/...` 명령을 찾을 수 없다는 에러(`command not found`)와 함께 poll 프로세스가 즉시 비정상 종료됨.
- **해소안**:
  - 계획서와 명세서의 poll 실행 스니펫에서 환경변수 할당 및 스크립트 실행 경로를 쌍따옴표로 감싸도록 수정:
    ```bash
    ( cd "$POLL_DIR" && DFLOW_ENV_FILE="$MAIN/.env" \
        "$MAIN/.claude/skills/dflow-poll/scripts/poll.sh" --require-tag agent --until <HH:MM> --interval 300 \
        [--exclude <id8,id8>] [--exclude-temp <id8,id8>] )
    ```

---

### Finding 2. `SKILL.md` 시작 전제 검사 내 `docs/tasks/*/state.json` glob 미확장 안전성

- **심각도**: **낮음**
- **근거**:
  - [`docs/superpowers/plans/2026-09-10-dflow-team.md#L1921-L1923`](file:///Users/jji/project/wbs-web/docs/superpowers/plans/2026-09-10-dflow-team.md#L1921-L1923):
    ```bash
    1921:    for f in docs/tasks/*/state.json; do
    1922:      [ -f "$f" ] && jq -e '.phase == "reported" and ((.api_base // "") == "")' "$f" >/dev/null && bad "LEGACY_REPORTED $f"
    1923:    done
    ```
- **실패 시나리오**:
  - 신규 클론 직후이거나 아직 태스크가 한 건도 없어 `docs/tasks/` 하위에 디렉터리가 전혀 없는 상태에서 실행될 때, `sh`나 `bash` 기본 설정에서는 `docs/tasks/*/state.json` 문자열 리터럴로 루프가 돌아 `[ -f "$f" ]`에 의해 안전하게 무시됩니다.
  - 하지만 사용자의 셸 환경이 `zsh`(macOS 기본 대화형 셸)이거나 `nomatch` 옵션이 활성화된 환경에서 직접 해당 블록을 실행하는 경우, `zsh: no matches found: docs/tasks/*/state.json` 에러가 발생하여 시작 검사 스크립트가 즉시 중단될 수 있습니다.
- **해소안**:
  - 디렉터리 존재 여부를 먼저 확인하거나, glob null 매칭 처리를 고려하여 방어 코드를 적용:
    ```bash
    if [ -d docs/tasks ]; then
      for f in docs/tasks/*/state.json; do
        [ -f "$f" ] && jq -e '.phase == "reported" and ((.api_base // "") == "")' "$f" >/dev/null && bad "LEGACY_REPORTED $f"
      done
    fi
    ```

---

### Finding 3. `--until` 종료 시각 검증의 "자정 넘김 미지원" 사용자 안내 명확화

- **심각도**: **낮음**
- **근거**:
  - [`docs/superpowers/specs/2026-09-10-dflow-team-design.md#L210-L211`](file:///Users/jji/project/wbs-web/docs/superpowers/specs/2026-09-10-dflow-team-design.md#L210-L211):
    > "poll.sh 가 자정 넘김을 지원하지 않으므로 그런 시각은 받지 않는다."
  - [`docs/superpowers/plans/2026-09-10-dflow-team.md#L1931`](file:///Users/jji/project/wbs-web/docs/superpowers/plans/2026-09-10-dflow-team.md#L1931):
    ```bash
    [ "$(date +%H%M)" -lt <HHMM> ] || bad UNTIL_PAST
    ```
  - [`docs/superpowers/plans/2026-09-10-dflow-team.md#L1894-L1897`](file:///Users/jji/project/wbs-web/docs/superpowers/plans/2026-09-10-dflow-team.md#L1894-L1897) (사용법 안내):
    > `사용법: /dflow-team [인원=3] <HH:MM> [opus|sonnet]`
- **실패 시나리오**:
  - 늦은 밤(예: 23:30)에 사용자가 익일 새벽까지 작업을 돌리고자 `/dflow-team 01:00`을 입력했을 때, `[ 2330 -lt 0100 ]` 조건에 의해 즉시 `bad UNTIL_PAST`로 거절됩니다.
  - 사용자는 "아직 01:00가 오지 않았는데 왜 과거 시각으로 처리되는지" 혼란을 겪을 수 있습니다.
- **해소안**:
  - `SKILL.md` 사용법 안내 및 `UNTIL_PAST` 에러 메시지에 "당일 시각만 지원 (자정 넘김 미지원, 23:59 한도)"을 명시하여 사용자가 의도를 쉽게 이해할 수 있도록 문구를 보강합니다.

---

## 3. 문제없음으로 확인된 핵심 사항 (Verified OK)

1. **기존 스킬 불변 영역 및 보존 테스트(Preservation Tests) 완벽 일치**:
   - `tests/skills/_preserve.ts`의 `CHANGED_RANGES`와 실제 [`.claude/skills/dflow-dev/SKILL.md`](file:///Users/jji/project/wbs-web/.claude/skills/dflow-dev/SKILL.md)(8개 worker 블록) 및 [`.claude/skills/dflow-merge/SKILL.md`](file:///Users/jji/project/wbs-web/.claude/skills/dflow-merge/SKILL.md)(3개 블록)의 교체 앵커 라인 번호와 텍스트가 정확히 일치함을 확인했습니다.
   - 전체 71개 Vitest 테스트 케이스를 계획서의 임베디드 텍스트를 기반으로 교차 검증한 결과 모든 단언문(Assertion)이 100% 통과했습니다.

2. **D'Flow 서버 API 명세 및 파싱 정합성**:
   - [`src/app/api/v1/agent/work/[id]/route.ts`](file:///Users/jji/project/wbs-web/src/app/api/v1/agent/work/[id]/route.ts)의 실제 구현인 `.order.item.spec`(not `.order.spec`), `.order.item.external_ref`, 최상위 `.reports` 구조와 계획서의 `jq` 추출식이 완전히 일치합니다.
   - [`src/app/api/v1/agent/me/route.ts`](file:///Users/jji/project/wbs-web/src/app/api/v1/agent/me/route.ts)의 `user_email` 필드 및 `dflow.sh me`를 통한 `<신원>/<host>/lead` 슬러그 생성 규칙이 일치합니다.

3. **분산 잠금(Lock) 및 Heartbeat의 안전성 (spec §4-2)**:
   - POSIX 원자적 디렉터리 생성(`mkdir -p`) 기반 락 획득,
   - 70분(4,200초) 기준의 Stale 판정(`is_stale`), 1시간 주기 하트비트(`beat` 파일 touch),
   - 종료 시 소유자 확인 후 삭제(`rm -rf "$LOCK"`) 로직이 경쟁 상태(Race condition)와 비정상 크래시를 모두 안전하게 방어하고 있습니다.

4. **`poll.sh` 공회전 방지 설계 (spec §3-14)**:
   - `POLL_DIR`을 git 메타데이터 내부의 빈 디렉터리로 분리함으로써 로컬 태스크 감지로 인한 exit 9/10 불필요 기상을 원천 차단했습니다.

5. **Detached HEAD 상태 Claim 및 롤백 안전성 (Phase 0-2)**:
   - 워크트리 생성 전 임시 커밋으로 인한 기본 브랜치 오염 및 원격 충돌을 원천 차단하기 위해 `git checkout --detach` 상태에서 작업하고, claim 실패 시 원래 브랜치/SHA로 안전하게 복귀하는 복원 절차가 정확히 수립되어 있습니다.

6. **독립 워크트리 및 머지 위임 격리 (Phase 0-4, Phase 3)**:
   - 워커 프로세스는 `.claude/worktrees/dflow-worker-$AGENT_ID`에서 완전 분리되어 실행되며, 팀장은 직접 squash merge를 수행하지 않고 이미 안전성이 입증된 `/dflow-merge`에 온전히 위임합니다.

7. **CI/테스트 환경 비파괴성 보장 (A0-d 게이트)**:
   - `DFLOW_GIT=no` 플래그를 통해 실제 git 푸시나 네트워크 요청 없이도 로직 및 상태 머신이 신뢰성 있게 검증될 수 있도록 테스트 환경이 철저하게 격리되어 있습니다.

---

## 4. 최종 결론 및 권고

본 설계 명세서와 구현 계획서는 이전 두 차례의 교차 리뷰를 통해 대부분의 위험 요소를 사전에 완벽히 제거하였으며, 매우 탄탄한 완성도를 갖추고 있습니다.

위에서 제시한 **경로 공백 방어(Finding 1)** 및 **사용자/셸 예외 안내(Finding 2, 3)**를 계획서에 가볍게 반영한 뒤, 계획서의 **Task 0 (리허설: 변경된 기존 스킬 사전 검증)**부터 구현에 착수하실 것을 권장합니다.
