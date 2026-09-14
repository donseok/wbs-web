## 1. 스테이징 설정에서 기존 로컬 작업을 잘못 머지할 수 있음

- 심각도: 치명

- 근거: `docs/superpowers/specs/2026-09-10-dflow-team-design.md:797-800` — “로컬 후보에는 이 필터를 걸지 않는다”; `:191-193` — 스테이징 DB가 운영을 복제한다고 명시. `docs/superpowers/plans/2026-09-10-dflow-team.md:742-745`도 원격 후보만 `api_base`로 거른다. 기존 상태 파일은 `.claude/skills/dflow-dev/SKILL.md:36-43`의 현행 스키마상 `api_base`가 없다.

- 실패 시나리오: 실제 리포에서 스테이징 `.env`로 팀장을 실행하고, 로컬에 운영 작업의 `phase=reported` state.json이 남아 있다 → 복제된 스테이징 DB에서도 해당 주문이 approved로 보임 → 로컬 agent 브랜치가 현재 origin 기본 브랜치에 머지·push된다.

- 해소안: 스펙 §6-4와 Task 2를 바꿔 자동 스윕의 모든 후보에 `api_base` 일치를 요구해야 한다. `api_base` 없는 레거시 로컬 후보는 자동 머지하지 말고 “마이그레이션/수동 확인 필요”로 보고한다. 명시 ref로 직접 호출한 수동 머지만 별도 확인 후 허용하는 방식이 안전하다.

## 2. 시작 전제 검사가 실제로 중단하지 않으며 잠금도 경합 안전하지 않음

- 심각도: 치명

- 근거: 계획은 `docs/superpowers/plans/2026-09-10-dflow-team.md:1786`에서 “하나라도 실패하면 … 중단”이라지만, 실제 제시 명령은 `:1788-1798`에서 `LOCKED`, `NOT_DEFAULT_BRANCH`, `NO_SKILL` 등을 `echo`만 한다. 이어 `:1800-1805`에서 잠금을 단순 `>`로 쓴다. 검사와 쓰기 사이에 원자적 획득도 없다.

- 실패 시나리오: 같은 체크아웃에서 두 팀장이 거의 동시에 시작 → 둘 다 잠금 부재를 확인 → 둘 다 잠금 파일을 덮어쓰고 승인 스윕·세대 파일·슬롯 번호를 병행 조작한다. 또는 이미 `LOCKED`를 출력한 세션도 계속 진행한다.

- 해소안: §4-4와 Task 5 시작 절을 실행 가능한 fail-fast 절차로 바꿔야 한다. 모든 검사를 집계한 뒤 실패 시 반드시 종료하고, 잠금은 `mkdir` 같은 원자적 획득으로 만들며 종료 시에만 제거한다. `$PPID`가 실제 팀장 세션 생존 PID라는 전제(`:1802`)는 **추측**이므로, 실제 Claude 세션 재시작·종료 리허설로 검증하거나 지속 감시 프로세스의 PID를 소유자로 써야 한다.

## 3. `/dflow-dev`의 실제 API JSON 경로 오류를 보존 테스트가 고정함

- 심각도: 높음

- 근거: 현행 `/dflow-dev`는 `.claude/skills/dflow-dev/SKILL.md:106`에서 “`item.spec`”을 읽으라고 한다. 실제 API는 `src/app/api/v1/agent/work/[id]/route.ts:101-106`에서 `order: { … item }`과 최상위 `reports`를 반환한다. 계획 자체도 `docs/superpowers/plans/2026-09-10-dflow-team.md:36`에서 올바른 `.order.item.spec`을 명시하지만, Task 1의 `CHANGED` 목록(`:213-230`)에는 이 수정이 없고 보존 테스트가 기존 문구를 유지시킨다.

- 실패 시나리오: 수동 또는 worker `/dflow-dev`가 스킬 지시대로 응답을 판독 → spec이 비어 있다고 오판하거나 착수 판정을 잘못 수행한다.

- 해소안: 스펙 §6-1의 허용 수정 목록과 Task 1 `CHANGED`에 이 API 경로 교정을 추가하고, `/dflow-dev`의 `item.spec`을 `.order.item.spec`으로 바꾼다. 실제 `show` 예시를 쓰는 모든 기존 스킬도 같은 응답 계약으로 점검해야 한다.

## 4. 수동 `/dflow-dev` 승인 스윕은 여전히 충돌 상태를 남김

- 심각도: 높음

- 근거: `/dflow-merge`에는 Task 2에서 `git merge --abort`와 push 실패 시 `git reset --keep`을 추가한다(`docs/superpowers/plans/2026-09-10-dflow-team.md:791-802`). 반면 Task 1의 Phase 0-가 변경은 후보 식별과 머지 대상만 넓힌다(`:379-397`). 현행 `/dflow-dev`의 자체 스윕은 `.claude/skills/dflow-dev/SKILL.md:71-79`처럼 merge/push만 하고 abort·reset 규칙이 없다.

- 실패 시나리오: 사람이 수동 `/dflow-dev`를 실행해 승인 스윕 중 충돌 발생 → 체크아웃이 merge-in-progress로 남음 → 이후 수동 개발과 팀장 전제 검사 모두 막힌다.

- 해소안: §6-2와 Task 1에서 Phase 0-가가 `/dflow-merge`의 수정된 전체 머지 절차를 호출하거나, 동일한 충돌 abort·push 실패 reset·후보별 계속 처리 규칙을 명시하도록 바꾼다. 그에 맞게 보존 테스트 허용 범위도 넓혀야 한다.

## 5. 에이전트 팀에서 `done` 실패 시 고칠 대상이 계획에 없음

- 심각도: 높음

- 근거: `dflow.sh done`은 `.claude/skills/dflow-work/scripts/dflow.sh:243-256`에서 bare `git branch`, `git rev-parse`, `git ls-remote`를 내부 호출한다. A0은 이 경로의 성공 여부를 검증하지만, 실패하면 “멈춘다”고만 한다(`docs/superpowers/plans/2026-09-10-dflow-team.md:2493-2494`). Task 9의 조건부 수정 대상(`:2568-2572`, `:2601-2610`)에는 `dflow.sh`가 없고 프롬프트 문구만 `/usr/bin/git`으로 바꾼다.

- 실패 시나리오: rtk가 스크립트 내부 git도 격리 위반으로 차단 → worker는 push했어도 `done`을 보고하지 못함 → 서버는 claimed에 머물고 팀장은 재개 필요 작업을 쌓는다. 프롬프트의 git 경로 변경으로는 내부 호출이 바뀌지 않는다.

- 해소안: A0 실패 시 수정 권한과 대상에 `dflow-work/scripts/dflow.sh`를 포함하고, git 실행 경로를 주입 가능하게 하거나 격리 워크트리에서 통과하는 호출 방식으로 수정한다. A0의 (d)는 통과 전에는 Task 8·9로 진행하지 않는 하드 게이트로 명시하는 편이 맞다.

## 6. worker의 doctor 실패 분기가 실제로 신뢰할 수 없음

- 심각도: 중간

- 근거: worker 문서는 doctor 비정상이면 `failed doctor-<exit>`로 끝낸다고 한다(`docs/superpowers/plans/2026-09-10-dflow-team.md:1061-1062`). 그러나 `dflow.sh`의 `cmd_doctor`는 인증 실패 시 `continue`한다(`.claude/skills/dflow-work/scripts/dflow.sh:289-304`), 따라서 모든 PAT 인증이 실패해도 루프가 0으로 끝날 수 있다.

- 실패 시나리오: 만료된 PAT로 새 worker 부트스트랩 → doctor가 성공처럼 끝남 → claim/show 단계에서 뒤늦게 실패하고 원인이 `failed doctor-*`로 분류되지 않는다.

- 해소안: `cmd_doctor`가 인증 실패·계약 불일치를 비정상 종료하도록 고치거나, worker bootstrap에서 `doctor` 뒤 명시적으로 `me`를 성공 검증하고 실패 시 즉시 `.result`를 남기도록 한다.

확인했고 문제없었던 점:

- 팀장 새 작업 필터의 JSON 경로는 `.order.item.*`로 실제 API 응답과 맞습니다.
- `poll.sh`의 exit 코드, `--require-tag`/`--exclude-temp` 인터페이스, 빈 cwd 사용 논리는 실제 스크립트와 일치합니다.
- 계획의 테스트 수 산술은 Task별 누적 기준으로 맞고, fixture 기준 원문 줄 수도 현재 `dflow-dev` 204줄, `dflow-merge` 44줄과 일치합니다.
- `.result`의 6번째 status, 7번째 이후 reason 및 cksum 기반 중복 방지 계약은 events 문서와 팀장 절차에서 일관됩니다.