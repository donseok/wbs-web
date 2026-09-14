**심각한 결함(치명·높음)은 남아 있지 않으며, 지난 라운드에서 반영된 9개 핵심 개선 사항이 스펙과 구현계획서 전반에 걸쳐 정확하고 일관되게 정착되었음을 확인했습니다.**

검토 대상 문서(`docs/superpowers/specs/2026-09-10-dflow-team-design.md`, `docs/superpowers/plans/2026-09-10-dflow-team.md`, `docs/superpowers/specs/2026-09-11-office-team-blockers.md`)와 실제 코드(`dflow.sh`, `poll.sh`, agent API 라우트, `kit-build.sh`, `install.sh`, `vitest.config.ts` 등)를 대조 검토한 결과를 보고합니다.

---

### [참고·낮음] 고아 브랜치 정리 fallback 패턴 `*dflow-*`의 매칭 범위

- **심각도**: 낮음 (실제 데이터 손실 없음, 3중 안전 장치로 보호됨)
- **근거**:
  - 스펙: `docs/superpowers/specs/2026-09-10-dflow-team-design.md:302`
    > `git branch --format='%(refname:short)' --list 'worktree-agent-*' '*dflow-*' 로 찾고, 위 세 조건을 통과한 것만 지운다.`
  - 계획서: `docs/superpowers/plans/2026-09-10-dflow-team.md:1611`
    > `git branch --format='%(refname:short)' --list 'worktree-agent-*' '*dflow-*' 로 바꿔 돌린다. dflow-* 가 아니라 *dflow-* 인 이유는 Orca 가 이름 앞에 다른 접두를 붙일 수 있어서다.`
  - 실제 저장소 브랜치 조회 결과:
    > 현재 워크스페이스에 `worktree-dflow-team` 브랜치가 실재하며, `*dflow-*` glob에 매칭됨
- **상황 및 영향**:
  에이전트 팀 워크트리가 자동 정리되어 워크트리 디렉터리 이름이나 id8을 특정할 수 없을 때 실행되는 fallback 정리 루프에서, `*dflow-*` 패턴은 작업 브랜치 외에 `worktree-dflow-team` 같은 개발 브랜치 이름도 리스트에 포함합니다.
  다만, 뒤이어 실행되는 3중 안전 조건(① `agent/*` 제외, ② `origin/<기본브랜치>`의 조상 여부 `git merge-base --is-ancestor`, ③ 현재 어느 워크트리에도 체크아웃되지 않음) 덕분에 미머지 고유 커밋이 있는 브랜치는 `git branch -D`가 실행되지 않거나 거부되므로 데이터 손실은 발생하지 않습니다.
- **해소안 (선택 사항)**:
  현재대로 두어도 3중 안전 조건으로 보호되므로 기능상 안전합니다. 만약 더 엄격하게 한정하려면 리허설(Task 8)에서 Orca가 실제 생성하는 브랜치명 접두·접미 규칙을 확인한 뒤 패턴을 `*dflow-[0-9a-f]*` 또는 확인된 특정 접두 패턴으로 좁힐 수 있습니다.

---

### 지난 라운드 9개 변경 항목 집중 점검 결과 (모두 정상 확인)

1. **잠금 소유 판정 및 세션 PID 관리**
   - **스펙**: `docs/superpowers/specs/2026-09-10-dflow-team-design.md:329-332, 661-663`
   - **계획서**: `docs/superpowers/plans/2026-09-10-dflow-team.md:1761, 1798, 1954, 2174, 2368-2374, 2605-2607`
   - **확인 내용**:
     - `owner` 기록: `printf '%s %s %s\n' "$who/$host/lead" "$(date +%s)" "$PPID" > "$LOCK/owner"`
     - 기상 시 검사: `{ read -r o_who o_ts o_pid < "$LOCK/owner"; }` 후 `[ "$o_who" = '<신원>/<host>/lead' ] && [ "$o_pid" = "$PPID" ]`가 참일 때만 `beat` 갱신. 불일치 시 `LOCK_LOST`를 출력하고 새 spawn 중단 및 잠금을 지우지 않은 채 마감으로 진입.
     - 마감 시 검사: 동일한 신원 및 `$PPID` 일치 판정을 거친 뒤에만 `rm -rf "$LOCK"` 실행. 잠금을 탈취당한 이전 세션이 새 세션의 잠금을 삭제하지 못하도록 완벽히 차단됨.
     - Bash 도구의 `$PPID`가 Claude Code 세션 프로세스이며 컨텍스트 압축 후에도 유지된다는 전제 사실(스펙 §3-22)과 일치.

2. **beat 없는 잠금의 10분 mtime 기반 stale 판정**
   - **스펙**: `docs/superpowers/specs/2026-09-10-dflow-team-design.md:341-346`
   - **계획서**: `docs/superpowers/plans/2026-09-10-dflow-team.md:2159-2163`
   - **확인 내용**:
     `stale()` 함수에서 `b=$(cat "$1/beat" 2>/dev/null || true)` 후, `beat`가 있으면 70분(4200초), 없으면 `find "$1" -maxdepth 0 -mmin +10`로 디렉터리 mtime 10분 경과를 판정. macOS(BSD find)와 Linux(GNU find) 모두에서 `find <dir> -maxdepth 0 -mmin +10` 문법이 정상 작동함을 실측 검증함.

3. **push 실패 갈래 분리 (경합 vs 훅 거부)**
   - **스펙**: `docs/superpowers/specs/2026-09-10-dflow-team-design.md:1050-1060`
   - **계획서**: `docs/superpowers/plans/2026-09-10-dflow-team.md:961-972`
   - **확인 내용**:
     `git push` 실패 시 항상 `git reset --keep <기록한 HEAD>`로 병합 및 merged 커밋을 롤백하여 작업트리를 깨끗이 복구. 출력에 `non-fast-forward`나 `fetch first`가 있으면 "push 실패(경합)"로 스윕 즉시 중단. 훅 거부(출력 없이 exit 1)인 경우 "push 실패(훅)"로 해당 작업 및 후손만 스택 관계에서 제외하고 다음 후보 처리를 계속함. 수동 사용자의 미push 커밋 보호를 위해 `origin` 강제 리셋을 배제함.

4. **킷 복사형 리포 사전 검증 (`KIT_NOT_PUSHED`)**
   - **스펙**: `docs/superpowers/specs/2026-09-10-dflow-team-design.md:397-404`
   - **계획서**: `docs/superpowers/plans/2026-09-10-dflow-team.md:2141-2150`
   - **확인 내용**:
     `git ls-files .claude/skills`로 킷 복사형(추적 리포)인지 먼저 판별. 추적 리포인 경우 `git fetch origin` 후 `git show "origin/$base:.claude/skills/dflow-dev/SKILL.md"`에 `--worker`가 있는지, `dflow-merge`에 `origin/agent/*`가 있는지 검사하여 누락 시 `KIT_NOT_PUSHED`로 즉시 시작을 차단. 팀원 워크트리가 detach 후 구버전 스킬을 참조하여 발생하는 `failed no-worker-flag` 집단 실패를 사전 방지함.

5. **로컬·원격 중복 후보 단일화 및 api_base/머지 대상 규칙**
   - **스펙**: `docs/superpowers/specs/2026-09-10-dflow-team-design.md:982-998`
   - **계획서**: `docs/superpowers/plans/2026-09-10-dflow-team.md:868-876, 884-888`
   - **확인 내용**:
     동일 `order`가 로컬과 원격에 모두 존재할 경우 로컬 후보 하나로 합친 뒤 중복 제거 → `api_base` 필터 순서로 판정. `api_base`는 값이 있는 쪽을 취하고, 둘 다 있는데 상이하면 "건너뜀(다른 D'Flow)" 처리. 머지 대상 브랜치는 `evidence.head_sha`를 포함하는 쪽을 우선 선택하여, 승인 후 추가 커밋이나 미반영 브랜치로 인한 오류를 방지함.

6. **fail-closed 승인 뒤 변경 확인**
   - **스펙**: `docs/superpowers/specs/2026-09-10-dflow-team-design.md:1035-1044`
   - **계획서**: `docs/superpowers/plans/2026-09-10-dflow-team.md:945-955`
   - **확인 내용**:
     `git merge-base --is-ancestor <증적 head_sha> <머지 대상>` 및 `git diff --name-only <증적 head_sha>..<머지 대상>` 검사. 변경 파일이 해당 작업의 `state.json` 뿐이거나 비어 있을 때만 머지 진행. diff 오류나 커밋 부재 등으로 확인 불가 시 "건너뜀(승인 뒤 변경 확인 불가)"로 건너뛰어 미확인 머지를 원천 차단. `head_sha`가 아예 없는 구버전 완료 증적에 대해서만 수동 호환성을 위해 머지 허용 및 안내 문구 부착.

7. **diff 상 타 작업 state.json을 통한 스택 백스톱**
   - **스펙**: `docs/superpowers/specs/2026-09-10-dflow-team-design.md:1021-1028`
   - **계획서**: `docs/superpowers/plans/2026-09-10-dflow-team.md:1021-1027`
   - **확인 내용**:
     `git diff --name-only origin/<기본브랜치>...<머지 대상> -- 'docs/tasks/*/state.json'`을 확인하여, 타 작업의 `state.json`이 차분에 잡히면 `branch_base` 누락 여부와 상관없이 선행 작업으로 인식. 선행 작업이 이번 스윕에서 머지되지 않았으면 후손 머지를 방지하고 "건너뜀(기점 미반영)" 처리. 3-dot(`...`) diff 연산으로 머지베이스 이후의 고유 차분만 정확히 분리함을 확인함.

8. **Orca 부트스트랩 실패 정리 시 `--force` 적용**
   - **스펙**: `docs/superpowers/specs/2026-09-10-dflow-team-design.md:286-293`
   - **계획서**: `docs/superpowers/plans/2026-09-10-dflow-team.md:1573-1578`
   - **확인 내용**:
     부트스트랩 단계 실패(branch `-`) 정리 시 미추적 부산물(`.result`, `.dflow-agent`, `spec.md` 캐시 등)로 인한 삭제 거부를 방지하기 위해 에이전트 팀(`git worktree remove --force`)과 Orca(`orca worktree rm --worktree path:<경로> --force`) 모두 `--force` 플래그를 사용. 정상 완료/진행 중 워크트리 정리에는 `--force`를 붙이지 않아 미커밋 작업 유실을 방지함.

9. **생성 브랜치 정리 패턴 `*dflow-*`**
   - **스펙**: `docs/superpowers/specs/2026-09-10-dflow-team-design.md:301-304`
   - **계획서**: `docs/superpowers/plans/2026-09-10-dflow-team.md:1430, 1600, 1611`
   - **확인 내용**:
     id8 식별이 가능할 때는 `'worktree-<디렉터리>' '*dflow-<id8>*'`, 워크트리명을 분실한 fallback 시에는 `'worktree-agent-*' '*dflow-*'`를 사용. Orca가 접두어를 붙이는 경우까지 포괄하며, 3가지 안전 가드로 작업 산출물 보호.

---

### 기존 코드 및 계약 대조 결과 (이상 없음)

1. **`dflow.sh`와의 정합성**:
   - `resolve_ref` 및 `check_depends_local`(`.claude/skills/dflow-work/scripts/dflow.sh:194-198`): claim 전 기점 detach로 `merge-base --is-ancestor "$_sha" HEAD` 게이트 통과 설계가 정확히 일치함.
   - `cmd_show`: 404 반환 시 exit 7 (`dflow.sh:99`). 스펙 및 계획서의 "404(dflow.sh exit 7) 조회 실패" 분기와 일치.
   - `cmd_done` (`dflow.sh:248-251`): 로컬 HEAD와 원격 브랜치 tip 일치 여부 검사(`git ls-remote`). 워커가 push 완료 후 done을 부르는 순서와 정확히 부합.
2. **`poll.sh`와의 정합성**:
   - 빈 폴더(`$(git rev-parse --git-path dflow-team-poll)`)를 cwd로 실행하여 `docs/tasks` 미존재로 exit 9/10을 구조적으로 차단(`poll.sh:43, 68`).
   - `poll exit` 코드 매핑(`0, 8, 2, 3, 5, 6, 7`)이 `poll.sh` 헤더 문서와 100% 일치.
3. **API 응답 스키마 (`src/app/api/v1/agent/work/[id]/route.ts`)**:
   - `.order.item.spec`: `wbs_items`의 spec 컬럼이 `.order.item.spec`에 위치함을 확인(`work/[id]/route.ts:101-105`). `/dflow-dev`의 `show 의 .order.item.spec` 수정 내용과 일치.
   - `reports[].evidence.head_sha`: 완료 리포트의 evidence 객체 경로와 정확히 일치.
4. **테스트 계획 및 단언문 무결성**:
   - Task 1: 13 tests (원문 보존 4 + 원문 수정 5 + worker 표지 4)
   - Task 2: 9 tests (보존 3 + 원격 머지 6)
   - Task 3: 11 tests (워커 프롬프트 계약)
   - Task 4: 8 tests (backends & events 계약)
   - Task 5: 25 tests (팀장 SKILL.md 계약)
   - Task 6: 5 tests (배포·가이드 계약)
   - 총 71개 테스트 카운트와 점진적 FAIL/PASS 예측 수치가 계획서 전체에 걸쳐 완벽히 일치함.
5. **수동 경로 회귀 없음 (`/dflow-dev`, `/dflow-merge`)**:
   - `/dflow-dev`의 `--worker` 블록은 주석 표지 및 플래그 검사로 완전 격리되어 수동 사용자 대화형 흐름에 영향 없음.
   - Phase 0-가 머지 및 Phase 5 `state.json` 커밋은 원격 브랜치 동기화에 필수적인 정상 개선임.
6. **개정 이력/히스토리성 문구 잔재**:
   - 스펙 및 계획서 전체에서 '개정', '이력', '히스토리' 등의 단어가 0건으로 최종 결정 내용만 간결하게 기술됨.

---

### 결론 및 착수 권고

스펙(`2026-09-10-dflow-team-design.md`)과 구현계획서(`2026-09-10-dflow-team.md`)는 기술적 정밀도와 안전성 가드가 매우 견고하게 구성되어 있으며, 상호 모순이나 코드베이스와의 괴리가 없습니다. 남은 미검증 항목들은 리허설 환경(Task 7~9)에서 실측하도록 계획에 잘 격리되어 있으므로, **추가 문서 수정 없이 구현(Task 1)에 즉시 착수할 것을 권고합니다.**
