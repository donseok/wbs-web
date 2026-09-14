# /dflow-team 확인 라운드 리뷰 (Claude, 최종)

결론: 착수를 막는 치명은 없다. 높음 2건(1은 시끄럽게 실패, 2는 조용히 실패)은 둘 다 문서만 고치면 되고 스펙·계획을 같이 고쳐야 한다.
나머지는 중간 4, 낮음 9.

## 1. 전제 검사 블록의 glob 루프가 zsh 에서 블록 전체를 죽인다
- 심각도: 높음(실패는 시끄럽지만, 첫 리허설 실행과 docs/tasks 가 없는 모든 리포에서 반드시 막힌다)
- 근거: plan:1921 `for f in docs/tasks/*/state.json; do` (Task 5 전제 검사). 같은 패턴이 plan:820 (/dflow-merge 로컬 후보 루프), plan:2555 (Task 7 Step 1)에도 있다.
  이 PC 의 Bash 도구는 `/bin/zsh`(eval)로 돈다. 빈 디렉터리에서 `for f in docs/tasks/*/state.json; do [ -f "$f" ] && echo in; done; echo after-for` 를 돌리면
  `(eval):1: no matches found: docs/tasks/*/state.json` 가 나오고 exit 1 이며, `after-for` 는 출력되지 않는다.
  mes-base origin/main 에는 docs/tasks 아래 파일이 0개다(`git ls-tree` 결과 0).
- 실패 시나리오: Task 8 Step 2 에서 `/dflow-team 2명 …` 를 돌리면 전제 검사가 `FAIL …` 줄 없이 exit 1 로 끝나고, 팀장은 "아무것도 띄우지 않고 중단" 한다. 원인으로 보이는 것은 zsh 오류 한 줄뿐이다. 킷을 새로 깐 리포도 모두 같다. 스윕의 로컬 루프도 같은 조건에서 exit 1 로 끝난다.
- 해소안: 세 곳의 루프를 `find docs/tasks -mindepth 2 -maxdepth 2 -name state.json 2>/dev/null | while IFS= read -r f; do …; done` 로 바꾸거나 `[ -d docs/tasks ] &&` 로 감싼다. 계획 Global Constraints 에 "SKILL.md 셸 블록은 zsh eval 로 돈다. 매치가 없을 수 있는 glob 과 `[ … \> … ]` 는 쓰지 않는다" 를 한 줄 넣는다.

## 2. poll exit 0 재대조가 일시 제외를 사실상 영구 제외로 만든다
- 심각도: 높음(조용히 실패)
- 근거: 스펙:418 / plan:2115 "먼저 후보를 영구 제외·일시 제외 목록과 슬롯 표에 한 번 더 대조해 걸리는 것을 버린다". 반대로 스펙:382-383 / plan:2042 는 "일시 제외는 poll.sh 가 6주기 뒤 스스로 풀어 재발견을 유도하므로 … 풀린 id8 이 다시 발견되면 착수 판정을 다시 하고" 라고 적는다. 팀장의 일시 제외 목록은 매 기상마다 `team.result skipped` 에서 다시 만든다(plan:1851).
  poll.sh:58-61 은 해제할 때 stderr 로 `일시성 제외 해제(재검사 유도): $EXCLUDE_TEMP` 를 출력한다.
- 실패 시나리오: B 가 "선행 승인 대기" 로 skipped 되어 일시 제외에 들어간다. 30분 뒤 poll 이 B 를 풀어 exit 0 으로 돌려주지만, 팀장이 자기 일시 제외 목록과 대조해 B 를 버린다. 그 다음 같은 목록을 다시 `--exclude-temp` 로 넘겨 poll 을 띄운다. 그래서 선행 A 가 승인·머지된 뒤에도 B 는 그 세션에서 끝내 뜨지 않는다. 스펙 §4-5 의 "승인·머지 뒤 재검사에서 풀린다" 가 알림 없이 깨진다.
- 해소안: 방법은 둘이다. ① 재대조는 영구 제외와 슬롯 표만 보고, 일시 제외는 poll.sh 에 맡긴다. ② poll 의 stderr `일시성 제외 해제` 줄에 실린 id8 을 팀장 일시 제외에서 먼저 뺀 뒤 대조한다. 스펙 §4-5 표와 plan 「2-3」 표를 함께 고친다.

## 3. 마감 때 잠금을 지우는 조건이 zsh 에서 늘 거짓이다
- 심각도: 중간(수작업 필요)
- 근거: plan:2310 `[ "${1-}" = '<신원>/<host>/lead' ] && [ ! "${2-}" \> '<마지막 team.start 의 ts>' ] && rm -rf "$LOCK"`.
  이 Bash 도구에서 `[ ! "${2-}" \> '2026-09-11T09:05:00Z' ] && echo RM_OK` 를 돌리면 `(eval):1: condition expected: >` 가 나오고 비0 으로 끝나 RM_OK 가 출력되지 않는다.
- 실패 시나리오: 정상 마감 뒤 70분 안에 `/dflow-team` 을 다시 부르면, 방금 끝난 자기 잠금 때문에 `LOCKED` 로 거부된다. 사람이 잠금 디렉터리를 직접 지워야 한다.
- 해소안: plan:1947 의 owner 에 epoch 초를 함께 쓰고 `[ "$3" -le <team.start epoch> ]` 같은 숫자 비교로 바꾼다. 스펙 §4-9 의 문구는 그대로 둔다.

## 4. 에이전트 팀 ANSWER 재spawn(재개 경로)에서 의존성 설치가 빠질 수 있다 (추측)
- 심각도: 중간
- 근거: plan:593 행 H 는 "Phase 0 3번 브랜치 생성 뒤, 4번 기준선 전" 에 설치한다. plan:1156 은 "의존성은 여기서 설치하지 않는다" 이다. 재spawn 워커는 새 격리 워크트리(node_modules 없음)에서 기존 agent 브랜치로 switch 하고(plan:1147-1153), `/dflow-dev` 는 claimed 를 보고 "재개 판정" 으로 간다(dflow-dev/SKILL.md:87 `claimed → **반려 판정 먼저(아래), 아니면** 재개 판정`). 브랜치를 새로 만들지 않는다.
- 실패 시나리오: package.json 이 있는 리포에서 blocked, 답, 재spawn 순으로 가면 Build 이후 게이트의 테스트 명령이 127 로 끝나 `failed` 가 된다. 리허설 리포는 루트에 package.json 을 커밋하므로(Task 7 Step 3) §11-5 4번에서 나올 가능성이 높다.
- 해소안: 행 H 조건을 "브랜치를 만들었거나 재개로 agent 브랜치에 들어온 직후, Phase 1~4 게이트 전" 으로 넓힌다. worker-prompt ANSWER 절에도 한 줄 더한다.
- 판정할 관찰: 리허설 §11-5 4번에서 재spawn 워크트리에 `node_modules` 가 생기는지 본다.

## 5. 재기동 때 에이전트 팀 blocked(답 대기)가 재기록 대상에서 빠진다
- 심각도: 중간
- 근거: 스펙:336-341 / plan:1997-2000 의 재기록 대상은 흡수한 슬롯의 `team.spawn`, 재spawn 못 한 `team.answer`, 흡수한 슬롯의 해시뿐이다. 에이전트 팀 blocked 는 슬롯을 해제하므로(스펙:459) 흡수되지 않는다. 게다가 plan:1988-1990 은 "서버에 claimed 인데 흡수한 슬롯에도 고아 워크트리에도 없는 id8 → 재개 필요, 영구 제외" 로 처리한다.
- 실패 시나리오: 답을 기다리는 동안 팀장을 다시 띄우면 그 질문이 "재개 필요(수동)" 로 바뀐다. 다음 기상부터는 재구성이 새 `team.start` 이후만 읽으므로 대기 목록에서도 사라진다. 사람이 `<id8> <답>` 을 줘도 매칭 대상이 없고, "기다리는 질문이 하나면 id8 없이 답해도 된다" 는 규칙도 깨진다.
- 해소안: 스펙 §4-4 2번과 plan 「1. 시작」 4번의 재기록 목록에 "답을 기다리는 blocked 마다 `team.blocked`" 를 더한다. claimed 미흡수 규칙에서는 그 id8 을 뺀다.

## 6. 같은 id8 을 다시 띄울 때 이름·브랜치가 충돌하고 로컬 브랜치가 쌓인다 (추측: Orca 의 브랜치 생성 방식은 확인하지 못했다)
- 심각도: 중간
- 근거: plan:1362 `orca worktree create --name dflow-<id8>` 로 만든 직후 워커가 detach 한다(plan:1134). `orca worktree rm --help` 에는 "removal also attempts to delete the checked-out local branch" 라고 되어 있어, 생성 때 만든 브랜치는 체크아웃되지 않은 채 남는다. 에이전트 팀도 같다. wbs-web 에는 스펙 §3-1 실측 때 남은 `worktree-agent-a5a6cb90cc1d2bfc5`·`worktree-agent-af3ca30adbb8a4c5a` 가 아직 있다(`git branch --list`). skipped 된 같은 id8 을 다시 띄우는 것은 설계에 들어 있다(스펙 §12 "일시 제외 재검사 비용", 2번을 고치면 실제로 일어난다).
- 실패 시나리오: 재spawn 때 `dflow-<id8>` 워크트리나 브랜치가 이미 있으면 create 가 실패하거나 다른 이름으로 만들어진다. 그러면 재구성의 "Orca 워크트리 이름 dflow-<id8>" 규칙이 어긋난다. 브랜치는 작업마다 쌓인다.
- 해소안: backends.md 정리 절에 "생성 때 만든 브랜치(Orca 결과 JSON 의 branch, isolation 의 `worktree-agent-*`)는 워크트리를 지운 뒤 `git branch -D`" 를 넣거나, 이름에 시도 번호를 붙인다. §11-4 에 "skipped 된 작업 재spawn" 항목을 더한다.
- 판정할 관찰: 첫 pane spawn 직후 `git branch --list 'dflow-*'` 를 보고, 같은 id8 을 다시 띄웠을 때 orca 가 무엇을 돌려주는지 본다.

## 7. reported 커밋 뒤에는 done 증적의 head_sha 가 브랜치 tip 이 아니다. 그래서 head_sha 위에 쌓은 스택을 /dflow-merge 가 조상 관계로 알아보지 못한다 (영향은 추측)
- 심각도: 낮음
- 근거: dflow.sh:254 `_sha=$(git rev-parse HEAD …)`(done 시점). 새 Phase 5 4번(plan:501)은 done 뒤에 state.json 을 커밋하고 push 한다. 행 B(plan:587)는 그 head_sha 를 기점으로 쌓는다. dflow-merge/SKILL.md:21 `git merge-base --is-ancestor A B` 로 보면, 선행 tip 은 후속의 조상이 아니게 된다.
- 실패 시나리오: 승인이 철회된(재작업 요청) 선행 P 위에 쌓인 후속 S 가 승인되면, 스윕은 조상 관계를 모른 채 S 를 머지한다. 이때 P 의 철회된 코드가 main 에 들어간다.
- 해소안: 스택 판정을 state.json 의 `branch_base`(행 B 가 기록한다)로 하거나, 행 B 의 기점을 head_sha 대신 선행 브랜치 tip 으로 둔다.
- 판정할 관찰: 스택 하나를 만들고 `git merge-base --is-ancestor origin/agent/<P> origin/agent/<S>` 결과를 본다.

## 8. 스윕이 승인된 커밋이 아니라 브랜치 tip 을 머지한다 (안전, 추측)
- 심각도: 낮음
- 근거: plan:862 `git merge --no-ff <머지 대상>`. 머지 대상은 `origin/agent/<id8>-<slug>` 이고 완료 증적의 head_sha 와 비교하지 않는다. 원격 후보를 넓히면서 "승인 뒤 origin/agent/* 에 올라온 push" 까지 머지 대상이 된다. 새 reported 커밋 때문에 "tip == head_sha" 라는 단순 가드는 쓸 수 없다.
- 실패 시나리오: 승인 뒤 누군가 같은 agent 브랜치에 커밋을 push 하면, 승인받지 않은 그 커밋이 main 에 들어간다.
- 해소안: 머지 전에 `git diff --name-only <evidence head_sha>..<tip>` 가 그 작업의 state.json 뿐인지 확인하고, 아니면 "건너뜀(승인 뒤 변경)" 으로 처리한다.

## 9. api_base 를 기록하라는 지시가 실제로 쓰는 지점(Phase 0 3번·4번)에 없다
- 심각도: 낮음
- 근거: plan:414-419 는 상태 모델 절에만 "Phase 0 에서 state.json 을 처음 쓰는 곳에서 기록한다" 를 둔다. 3번(branch_base·risk)과 4번(기준선) 본문은 CHANGED 대상이 아니라 그대로다.
- 실패 시나리오: 오케스트레이터가 이 필드를 빠뜨리면 원격 후보가 전부 "건너뜀(다른 D'Flow)" 가 되고, 팀장 스윕은 팀원 작업을 영영 머지하지 않는다. 실패는 조용하다. 리허설 Task 8 3번 2항의 `.api_base` 확인이 잡기는 한다.
- 해소안: 4번 줄 끝에 "state.json 에 api_base 도 쓴다" 를 두고 테스트에서 단언한다.

## 10. 아무것도 검증하지 않는 테스트 단언
- 심각도: 낮음
- 근거: plan:2666 은 A0 (d) 수정 뒤 `expect(p()).toContain('DFLOW_GIT=')` 를 더한다. 그런데 조건부 문장 plan:1166 에 이미 `DFLOW_GIT=<0번의 git 절대경로>` 가 있어 수정 전에도 통과한다. dflow.sh 치환 자체를 검사하는 회귀 테스트는 없다. plan:2785 의 `expect(p()).toContain('/usr/bin/git')` 도 worker-prompt 0절에 이미 "(예 `/usr/bin/git`)" 가 있어 수정 전에 통과한다.
- 해소안: dflow.sh 에서 `grep -nE '(^|[^{:-])git '` 결과가 0건인지 단언한다. worker-prompt 에는 `not.toContain('command -v git')` 를 더한다.

## 11. spawn 때 넣는 "영구 제외(진행 중)" 가 skipped·rate-limit 재시도와 부딪친다
- 심각도: 낮음
- 근거: plan:2247 은 "id8 을 영구 제외(진행 중)에 넣는다" 인데, plan:2163 은 skipped 를 "일시 제외", plan:2166 은 rate-limit 을 "제외하지 않는다" 로 처리한다. 결과를 처리할 때 진행 중 항목을 뺀다는 문장이 없다.
- 해소안: 「3. 결과 처리」 첫 줄에 "진행 중 영구 제외에서 뺀 뒤 표의 제외를 적용한다" 를 적는다.

## 12. 마감 정리가 살아 있는 팀원의 워크트리를 지울 수 있다
- 심각도: 낮음
- 근거: plan:2295-2297 은 남은 워크트리를 "깨끗하고 HEAD==origin" 이면 지우며 생존 여부는 조건에 없다. 반면 plan:2292 는 "pane 팀원은 팀장이 끝나도 자기 탭에서 계속 돈다" 이다.
- 해소안: 마감 정리는 최종 status 가 있는 워크트리에만 한다. 진행 중 슬롯은 보고만 한다.

## 13. 오래된 잠금 탈취에 TOCTOU 가 있고, suspect→no-result 에 TaskStop 이 없다
- 심각도: 낮음
- 근거: plan:1943-1944 `b=$(cat "$LOCK/beat" …) … && rm -rf "$LOCK" && mkdir "$LOCK"`. beat 를 다시 읽은 뒤 rm 하기 전에 다른 팀장이 먼저 가져가면 그 잠금까지 지운다. `mv "$LOCK" "$LOCK.stale.$$"` 로 원자 교체하면 안전하다.
  plan:2138-2141·2167 은 no-result 판정 때 슬롯만 해제한다. 무응답 자동 정리(plan:2186 "먼저 `TaskStop` 으로 팀원을 멈추고")처럼 TaskStop 을 먼저 해야 AGENT_ID 가 둘이 되지 않는다.

## 14. 문서 정합
- 심각도: 낮음
- blockers:15-19 요약은 "팀장 스킬은 … 남은 것은 리허설로만 확인할 수 있는 실측 항목뿐" 이라고 적지만, 위 1·2·3 은 문서 결함이다.
- blockers:146-147 은 "`orca worktree rm --force` … 팀장 스킬의 마감·고아 정리가 기대는 동작" 이라고 적지만, 스펙과 계획 어디에도 Orca `--force` 는 없다(깨끗할 때만 rm 한다).
- 스펙:309 "`me` 가 출력하는 이름으로" 는 사실과 다르다. src/app/api/v1/agent/me/route.ts 응답에는 이름이 없고 `user_email` 뿐이다.
- 수정 이력 문구: 두 문서에서 날짜·"개정"·"바꿨다" 류를 grep 했는데, 파일명 속 날짜 말고는 남은 것이 없다.

## 확인했고 문제없음
- CHANGED 줄은 실행으로 확인했다. 계획 테스트 코드에서 CHANGED(dflow-dev 9·dflow-merge 7), CHANGED_RANGES 경계 2, 표지 블록 prev/next 앵커 8, 행 H 의 next 줄을 뽑아 `git show origin/main:` 원문과 줄 단위로 대조했고, 모두 정확히 1회 나온다. 두 스킬 모두 origin/main 과 로컬이 같다(204행·44행).
- Task 1~6 테스트 71건: 단언마다 계획의 삽입 본문과 대조해 통과함을 확인했다. 실패 단계 기대치(10/3, 7/2, 11, 8, 25, 5)도 맞다.
- API·스크립트: show 의 `.order.item.spec`·`.order.item.external_ref`·`.order.status`·최상위 `.reports`·`.depends_evidence`, dflow.sh exit(404→7, 409·dependency_not_met→4), doctor 가 인증에 실패해도 0, poll.sh 의 빈 cwd 에서 9·10 재료 없음(68행), DFLOW_ENV_FILE(41행), 빈 플래그 값을 다음 플래그로 삼킴(26-31행), 머리말 exit 목록 — 모두 실제 코드와 일치한다.
- 이전 라운드 반영분(api_base 필터, mkdir 잠금+beat, `.order.item.spec`, Phase 0-가 의 /dflow-merge 2~5번 위임, detach 실패 시 claim 전 중단, 기본 브랜치 폴백, bare HEAD 보정, 행 H 위치, me 인증 판정)은 스펙과 계획이 서로 맞는다.
- rtk: 팀장(비격리) Bash 에서 `git status --porcelain`, `git worktree list --porcelain | sed`, `git branch -r --list` 는 원형 출력을 유지한다(실측).
- 수동 비퇴행: Phase 0-2 detach 는 기존 0-3 이 거부되던 조건에서 거부되며, 이제는 claim 전에 멈추므로 오히려 개선이다. 반려를 기록하지 않아도 재작업 경로(dflow-dev:98)가 rejected 를 쓰므로 poll exit 10 이 반복되지 않는다. api_base 가 없는 원격 후보는 건너뛰므로, 머지 뒤 심링크로 퍼져도 mes-base·mes-runlog 의 기존 agent 브랜치는 건드리지 않는다.
