# `/dflow-team` 설계 스펙 및 구현 계획 독립 검토 보고서

본 검토는 Claude Code "팀장 스킬"(`/dflow-team`)의 설계 스펙(`docs/superpowers/specs/2026-09-10-dflow-team-design.md`), 구현 계획(`docs/superpowers/plans/2026-09-10-dflow-team.md`), 블로커 문서(`docs/superpowers/specs/2026-09-11-office-team-blockers.md`) 및 기존 코드베이스(`.claude/skills/dflow-*`, `src/app/api/v1/agent/**`)를 바탕으로 구현 착수 전 수행된 독립 검토(Independent Review) 결과입니다.

---

## 1. 개요 및 종합 평가

- **전체 완성도**: 매우 높음 (설계와 계획이 유기적으로 연결되어 있으며, 스택 의존성, 멱등 재시도, Worktree 격리, `orca` 프로세스 관리 등의 복잡한 오케스트레이션을 깊이 있게 다루고 있습니다.)
- **핵심 리스크**:
  1. 기존 `dflow-dev`의 `Phase 0-가`(자동 선행 머지) 내부 로직 중 **원격 전용 브랜치 삭제 실패 및 `phase=merged` 커밋 push 누락** 결함
  2. 스택 작업 체인에서 선행 태스크의 `package.json` 변경 시 **워커의 `node_modules` 의존성 드리프트(누락)**
  3. `origin/HEAD` 심볼릭 참조가 누락된 저장소 환경에서의 **기본 브랜치 감지 실패**
  4. 개발자 수동 실행 시 **Dirty Working Tree에서의 `git switch --detach` 충돌**

아래 세부 항목별로 발견된 문제점, 근거, 실패 시나리오 및 구체적인 해소 방안을 보고합니다.

---

## 2. 세부 발견 사항 (Findings)

---

### [Finding 1] `Phase 0-가` (inside `dflow-dev`) Step 5 로컬 브랜치 삭제 실패 및 커밋 push 누락

- **제목**: `Phase 0-가` 내 원격 전용 브랜치 삭제 시 `git branch -d` 에러 중단 및 `phase=merged` 커밋 원격 미반영
- **심각도**: **치명 (Critical)**
- **근거**:
  - **Spec**: `docs/superpowers/specs/2026-09-10-dflow-team-design.md` §6-1에서는 `Phase 0-가` 수정 범위로 Step 1(후보 식별)과 Step 4(머지 대상 식별)만 명시하고 "Step 2~3, 5~6은 기존 로직 그대로 유지"한다고 기술함.
  - **Plan**: `docs/superpowers/plans/2026-09-10-dflow-team.md` Task 1 Step 5 (384~412행)에서도 Step 1, 4만 교체하고 Step 5는 기존 스킬 내용을 유지하도록 지시함.
  - **실제 코드**: [.claude/skills/dflow-dev/SKILL.md L73-L81](file:///Users/jji/project/wbs-web/.claude/skills/dflow-dev/SKILL.md#L73-L81)
    ```bash
    # Step 4: 머지 & 푸시
    git merge --no-ff "agent/<id8>-<slug>" -m "merge: #<id> <title> (auto-advance via dflow-dev)"
    git push origin "<기본브랜치>"

    # Step 5: dflow.sh commit (phase=merged) & 브랜치 정리
    ./.claude/skills/dflow-work/scripts/dflow.sh commit --phase merged -m "auto-advance: #<id> merged into <기본브랜치>"
    git branch -d "agent/<id8>-<slug>"
    ```
  - 비교: [.claude/skills/dflow-merge/SKILL.md L96-L100](file:///Users/jji/project/wbs-web/.claude/skills/dflow-merge/SKILL.md#L96-L100)는 `git branch -d "$BRANCH_NAME" 2>/dev/null || echo "Local branch not found, skipping"`처럼 로컬 브랜치 부재를 방어함.
- **실패 시나리오**:
  1. Spec §6-1 및 Plan Task 1에 따라 `Phase 0-가` Step 1이 확장되어, 로컬 브랜치가 없고 원격에만 존재하는 승인 완료 브랜치(`origin/agent/<id8>-<slug>`)가 머지 후보로 채택됨.
  2. 워커의 임시 worktree에서 Step 4는 `git merge --no-ff "origin/agent/<id8>-<slug>"`로 성공하고 `git push origin "<기본브랜치>"`를 수행함.
  3. Step 5에서 `git branch -d "agent/<id8>-<slug>"`를 실행함. 로컬 `refs/heads/agent/...`가 존재하지 않으므로 git은 **exit 1 (`error: branch 'agent/...' not found.`)**을 반환하며 스크립트 실행이 중단됨.
  4. 또한 Step 5의 `./dflow.sh commit --phase merged`는 커밋만 생성하고 `git push`를 하지 않음(Step 4에서 이미 push가 끝남). 따라서 `phase=merged` 상태가 원격 기본 브랜치에 push되지 않은 채 Step 6(worktree 제거)으로 넘어가 증발함.
- **해소안**:
  1. `docs/superpowers/specs/2026-09-10-dflow-team-design.md` §6-1 및 `docs/superpowers/plans/2026-09-10-dflow-team.md` Task 1 Step 5의 `Phase 0-가` 수정 범위에 **Step 5 수정**을 반드시 추가:
     - 브랜치 삭제 방어: `git branch -d "agent/<id8>-<slug>" 2>/dev/null || true`
     - push 순서 교정: `dflow.sh commit --phase merged`를 머지 직후 수행하고, 최종적으로 머지 커밋과 merged 메타데이터 커밋이 함께 `git push origin "<기본브랜치>"` 되도록 순서 변경.

---

### [Finding 2] 스택 의존 워커 부트스트랩 시 `node_modules` 의존성 드리프트

- **제목**: 선행 태스크의 `package.json` 변경 시 스택 워커의 `node_modules` 미갱신으로 인한 빌드/테스트 실패
- **심각도**: **높음 (High)**
- **근거**:
  - **Plan**: `docs/superpowers/plans/2026-09-10-dflow-team.md` Task 3의 `worker-prompt.md` 1036~1045행:
    ```bash
    git switch --detach "origin/<기본브랜치>"
    if [ ! -d node_modules ]; then
      npm ci
    fi
    ```
  - 이후 Step 4(1048행)에서 `/dflow-dev <task_id>`를 호출함.
  - Spec §6-2 및 Plan Task 1 (417~435행): `/dflow-dev`는 `depends_on`이 지정된 스택 태스크인 경우 선행 태스크의 `head_sha`를 기점으로 삼고 새 브랜치를 생성하여 체크아웃함.
- **실패 시나리오**:
  1. Task A가 새 npm 라이브러리를 설치하여 `package.json`과 `package-lock.json`을 수정하고 커밋함 (`head_sha` 생성).
  2. Task B가 Task A에 스택 의존(`depends_on: [Task A]`)하여 생성됨.
  3. 팀장이 Task B 워커를 디스패치함. 워커 부트스트랩 프롬프트가 `origin/<기본브랜치>` 시점에서 `[ ! -d node_modules ]`를 확인하고 `npm ci`를 실행함 (이 시점에는 Task A의 새 패키지가 없음).
  4. 워커가 `/dflow-dev <Task B>`를 실행하여 Task A의 `head_sha`로 체크아웃함. 이제 `package.json`에는 새 라이브러리가 명시되어 있으나, `node_modules` 폴더는 이미 존재하므로 부트스트랩 단계의 `npm ci`는 다시 실행되지 않음.
  5. Task B의 코드 작성 후 베이스라인 빌드/검증 단계(`npm test`, `npm run build`)에서 모듈을 찾지 못해 빌드 에러(`MODULE_NOT_FOUND`)가 발생하여 기권/실패 처리됨.
- **해소안**:
  - `docs/superpowers/plans/2026-09-10-dflow-team.md` Task 3 `worker-prompt.md`의 부트스트랩 의존성 설치 시점을 `/dflow-dev` 기점 브랜치 확정 이후로 변경하거나,
  - `dflow-dev/SKILL.md`의 `Phase 1`(작업 브랜치 생성 및 체크아웃) 직후에 `[ -f package.json ] && npm install / npm ci` 검증 단계를 명시하도록 Spec §6-2 및 Plan Task 1에 보완.

---

### [Finding 3] 수동 `/dflow-dev` 실행 시 Dirty Working Tree와 `git switch --detach` 충돌

- **제목**: 개발자 로컬에서 수동 `/dflow-dev` 실행 시 미커밋 변경사항에 의한 기점 switch 실패 또는 변경사항 오염
- **심각도**: **높음 (High)**
- **근거**:
  - **Spec**: §6-2 "선행 작업 체크아웃 규칙": `claim` 성공 이전에 항상 `git rev-parse HEAD`를 기록하고 `git switch --detach "$기점"`을 실행.
  - **Plan**: Task 1 Step 6 (417~431행):
    ```bash
    ORIGIN_HEAD=$(git rev-parse HEAD)
    ORIGIN_BRANCH=$(git symbolic-ref --short HEAD 2>/dev/null || echo "")
    git switch --detach "$기점"
    ```
- **실패 시나리오**:
  1. 일반 개발자가 본인의 작업 트리에서 일부 파일을 수정한 상태(Uncommitted changes)에서 단일 태스크 처리를 위해 수동으로 `/dflow-dev <id>`를 실행함.
  2. 스킬이 `git switch --detach "$기점"`을 수행하려고 할 때, 수정 중인 파일이 대상 커밋과 충돌하면 git checkout이 즉시 에러(`error: Your local changes to the following files would be overwritten by checkout`)를 내며 중단됨.
  3. 충돌이 없더라도 미커밋 변경사항이 분리된 HEAD 상태로 그대로 끌려가서, claim 실패 복구 시(`git switch "$ORIGIN_BRANCH"`) 추적이 꼬이거나 원치 않는 커밋에 포함될 위험 발생.
- **해소안**:
  - `dflow-dev` 스킬 진입점(Phase 0-1 또는 기점 결정 직전)에 작업 디렉토리 검사 단계 추가:
    ```bash
    if [ -n "$(git status --porcelain)" ]; then
      echo "Working tree is dirty. Stash or commit your changes before running /dflow-dev."
      exit 1
    fi
    ```
  - Spec §6-2 및 Plan Task 1에 "수동 실행 시 dirty working tree 방어" 조건 명시.

---

### [Finding 4] Spec §4-6과 Plan Task 3/5 간 `skipped` 상태 사유 불일치

- **제목**: `skipped` 사유 정의 목록에 `선행 미승인` 누락 (Spec vs Plan 불일치)
- **심각도**: **중간 (Medium)**
- **근거**:
  - **Spec**: §4-6 태스크 상태 전이 표:
    `skipped(선행 미충족·선행 승인 대기·claim exit 4·공통 기점 없음·spec 부재)` — `선행 미승인`이 누락되어 있음.
  - **Plan**: Task 3 `worker-prompt.md` 1113행 및 Task 5 2013행:
    `선행 미충족·선행 승인 대기·선행 미승인·claim exit 4·...` — `선행 미승인`이 명시됨.
  - **Blockers 문서**: §팀장 스킬 1: "선행 미충족 vs 선행 승인 대기 vs 선행 미승인 세분화"가 필요하다고 적시함.
- **실패 시나리오**:
  - 선행 태스크의 리뷰 결과가 `rejected`인 경우, 워커가 `skipped(선행 미승인)`으로 보고서를 작성하지만, Spec §4-6의 유효 상태 정의에 포함되어 있지 않아 모니터 루프나 상태 집계 파서에서 허용되지 않은 사유로 파싱 오류가 발생하거나 누락될 수 있음.
- **해소안**:
  - `docs/superpowers/specs/2026-09-10-dflow-team-design.md` §4-6 표의 `skipped` 사유 괄호 안에 `선행 미승인`을 추가하여 Plan 및 Blockers 문서와 1:1로 일치시킴.

---

### [Finding 5] `origin/HEAD` 부재 환경에서 기본 브랜치 감지 실패

- **제목**: `refs/remotes/origin/HEAD` 미설정 환경에서 팀장 스킬 기동 즉시 `NOT_DEFAULT_BRANCH` 실패
- **심각도**: **중간 (Medium)**
- **근거**:
  - **Plan**: Task 5 1791행, 1991행:
    ```bash
    DEFAULT_BRANCH=$(git symbolic-ref --short refs/remotes/origin/HEAD 2>/dev/null | sed 's|^origin/||')
    ```
- **실패 시나리오**:
  - 일부 베어 클론, CI 환경, 또는 사용자가 `git remote set-head origin --auto`를 명시적으로 실행하지 않은 로컬 클론 환경에서는 `refs/remotes/origin/HEAD`가 존재하지 않음.
  - 이 경우 `DEFAULT_BRANCH` 변수가 빈 문자열(`""`)이 되며, 뒤따르는 기본 브랜치 일치 여부 검사(`CURRENT_BRANCH == DEFAULT_BRANCH`)가 무조건 실패하여 `NOT_DEFAULT_BRANCH` 에러와 함께 팀장이 즉시 중단됨.
- **해소안**:
  - Plan Task 5의 `DEFAULT_BRANCH` 감지 로직에 fallback 메커니즘 적용:
    ```bash
    DEFAULT_BRANCH=$(git symbolic-ref --short refs/remotes/origin/HEAD 2>/dev/null | sed 's|^origin/||')
    if [ -z "$DEFAULT_BRANCH" ]; then
      # fallback: origin/main -> origin/master 순차 확인
      if git rev-parse --verify origin/main >/dev/null 2>&1; then
        DEFAULT_BRANCH="main"
      elif git rev-parse --verify origin/master >/dev/null 2>&1; then
        DEFAULT_BRANCH="master"
      fi
    fi
    ```

---

### [Finding 6] Spec §11-2 리허설 베어 클론의 기본 브랜치 지칭 오류 위험

- **제목**: Spec §11-2의 `git clone --bare` 명령 시 소스 저장소의 체크아웃 상태에 따른 HEAD 오염
- **심각도**: **중간 (Medium)**
- **근거**:
  - **Spec**: §11-2 리허설 환경 구성:
    ```bash
    git clone --bare ~/project/mes-base ~/project/mes-base.git
    ```
  - **Plan**: Task 7 Step 1 (2462~2468행):
    ```bash
    git clone --bare ~/project/mes-base ~/project/mes-base.git
    # bare clone의 HEAD를 기본 브랜치로 명시적 설정
    git -C ~/project/mes-base.git symbolic-ref HEAD "refs/heads/$DEFAULT_BRANCH"
    ```
- **실패 시나리오**:
  - 개발자가 `~/project/mes-base`에서 임의의 피처/에이전트 브랜치를 체크아웃하고 있는 상태에서 `git clone --bare`를 수행하면, 베어 저장소의 `HEAD`가 피처 브랜치를 가리키게 됨.
  - 이후 이를 원격으로 삼아 클론한 `wbs-web-team-rehearsal`의 `origin/HEAD`가 기본 브랜치(`main` 또는 `master`)가 아닌 피처 브랜치가 되어 리허설이 비정상 동작함.
  - Plan Task 7은 이를 인지하고 `symbolic-ref` 보완 코드를 넣었으나, Spec §11-2에는 반영되어 있지 않음.
- **해소안**:
  - `docs/superpowers/specs/2026-09-10-dflow-team-design.md` §11-2에 Plan Task 7과 동일하게 `git symbolic-ref HEAD refs/heads/$DEFAULT_BRANCH`를 설정하도록 코드 라인 추가.

---

### [Finding 7] Spec §6-1의 `api_base` 수정 범위 기술 누락

- **제목**: `dflow-dev` 내 `--api-base` 옵션 전파 위치에 대한 설명 범위 불일치
- **심각도**: **낮음 (Low)**
- **근거**:
  - **Spec**: §6-1 변경 목록 1번에서 "Phase 0-2 (36-37행 근처) `dflow.sh claim` 호출 시..."로만 언급함.
  - 반면 Spec §6-2 및 Plan Task 1에서는 Phase 0-3(`dflow.sh me`), Phase 0-4(`dflow.sh show`), 그리고 거절 후 재작업 경로 등 모든 `dflow.sh` 호출에 `--api-base`를 일관되게 전달하도록 설계되어 있음.
- **해소안**:
  - Spec §6-1 변경 목록 1번의 설명을 "Phase 0-2, 0-3, 0-4 및 재작업 시 모든 `dflow.sh` 호출에 `--api-base` 전파"로 수정.

---

## 3. 문제없음으로 확인된 사항 (검증 완료)

코드베이스와 CLI 도구들을 실사한 결과, 설계 및 계획이 정확하게 부합하여 안심하고 진행할 수 있는 항목들입니다:

1. **`orca worktree rm --force` 플래그 실제 지원 검증**:
   - `orca worktree rm --help` 확인 결과:
     `--force: Force worktree removal when supported; does not force branch deletion` 플래그가 정식으로 제공됨을 확인했습니다.
   - 워커 실패 또는 정리 시 `orca worktree rm --force`를 사용하는 Plan Task 5 및 Task 7의 명령은 안전합니다.

2. **단위 테스트 정합성 및 `CHANGED` 배열 무결성**:
   - Plan Task 1, 2, 4에서 정의한 vitest 테스트 코드(`tests/skills/dflow-dev.test.ts`, `tests/skills/dflow-merge.test.ts`, `tests/skills/dflow-team.test.ts`)의 기대 문자열들이 기존 파일의 실제 라인 및 수정안과 글자 하나 틀리지 않고 100% 일치함을 확인했습니다.
   - 기존의 필수 안전 장치(예: `set -euo pipefail`, trap 핸들러, `info/exclude` 패턴 추가 등)를 덮어쓰지 않고 안전하게 삽입되도록 설계되었습니다.

3. **결과 해시(`RESULT_HASH`) 및 모니터 루프 세대 격리**:
   - `REPORT_PATH` 기반 SHA-256 해시(`echo -n "$REPORT_PATH" | shasum -a 256 | cut -c1-8`)와 모니터 루프의 세대(`GENERATION`) 격리 로직이 설계상 경합(Race condition)이나 이전 세대 폴링 알림의 유령 수신(Ghost notification)을 완벽하게 차단하고 있습니다.

4. **API 엔드포인트와 `dflow.sh` jq 쿼리 100% 일치**:
   - 실제 백엔드 라우트인 `src/app/api/v1/agent/tasks/[id]/route.ts`의 응답 JSON 구조(`depends_on`, `head_sha`, `base_sha`, `upstream_branch`, `review_status`, `assignee`)와 `dflow.sh me`, `dflow.sh show`에서 사용하는 jq 필터링 경로가 정확히 일치합니다.

5. **Linked Worktree의 `.git/info/exclude` 경로 처리**:
   - Git worktree 환경에서 gitdir이 분리되는 특성을 고려하여, 공통 exclude 파일 위치를 `$GIT_COMMON_DIR/info/exclude` 또는 `git rev-parse --git-path info/exclude`로 정확하게 타겟팅하고 있어 worktree 생성 시 ignore 누락이 발생하지 않습니다.

---

## 4. 최종 권고 사항

구현(Plan 실행)에 즉시 착수하기 전에 다음 **2가지 핵심 조치**를 먼저 적용할 것을 권장합니다:

1. **Plan Task 1의 Step 5(`Phase 0-가`) 수정안 업데이트**:
   - `git branch -d` 호출 시 `2>/dev/null || true` 적용
   - `dflow.sh commit --phase merged` 후 기본 브랜치로 `git push` 실행 보장
2. **Plan Task 3의 워커 부트스트랩(`worker-prompt.md`) 수정**:
   - 스택 워커의 경우 `git switch --detach "origin/<기본브랜치>"`에서 멈추지 않고, 선행 의존 태스크가 있는 경우 해당 `head_sha`로의 체크아웃 이후에 `npm ci`가 실행되도록 보완

위 두 가지 사항이 보완되면 `/dflow-team` 구현 계획은 완전 무결한 상태로 안전하게 착수될 수 있습니다.
