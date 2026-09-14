# /dflow-team 2차 확인 검토 (Claude) — 진행 중 누적 기록

(작업 중 발견을 순서대로 추가한다. 최종 정리는 맨 아래.)

## 진행 메모 1 (문서·원본 코드 전부 읽음)
- 반영 확인 OK: zsh 안전(glob 루프·[ \> ] 없음, plan 전체 grep), poll exit 0 재대조(영구+슬롯만), SPACE_IN_PATH, poll 경로 따옴표, 당일 종료 시각, 행 H 재개 경로, 생성 브랜치 정리, api_base 3·4번 본문, TaskStop 선행, 제외 우선순위, 마감 시 살아 있는 팀원 보존, 부트스트랩 실패 정리 백엔드별, 리허설 3명.
- Task 1~6 테스트 단언 대부분 대조 완료(13/9/11/8/25/5). 이상 없음(세부 재확인 중).
- 후보 결함(검증 중):
  A. 마감 잠금 삭제의 소유 확인이 같은 체크아웃 탈취(항상 같은 신원·host·repo)에서 무력. 좀비 팀장 감지 없음. (중간)
  B. /dflow-merge 4번 승인 뒤 변경 확인이 head_sha 가 로컬에 없을 때 fail-open 가능 (낮음)
  C. pane blocked 슬롯이 무응답 자동 정리에 걸릴 수 있는 문구 모호 (낮음)
  D. W-H "설치 뒤 4번으로 간다" 가 재개 경로에서 기준선 재기록으로 읽힘 (낮음)
  E. 수동 Phase 0-2 의 head_sha 직접 머지 뒤 reported 커밋이 남아 매 스윕 충돌 후보 (낮음~중간)
  F. branch_base 누락 시 스택을 비스택으로 판정(구조적 폴백 없음) (검증 중)
  G. SKILL.md "현재 줄의 해시가 그와 해시가 다를 때만" 문구 중복 (낮음)

## 진행 메모 2 (검증 결과)
- CHANGED/범위/표지 앵커: chk.mjs 재실행 — dev CHANGED 11·RANGES 2·merge CHANGED 8·앵커 8 모두 원문에 정확히 1회. 원문 = origin/main (cmp SAME).
- 테스트 71건 단언을 계획 본문과 줄 단위 대조: 통과 판단. 실패 단계 기대치(10/3, 7/2, 11, 8, 25, 5)도 맞음.
- zsh 실측(스크래치): ${s%%|*}, [ 0930 -lt 1800 ], for r in $(...), read -r o_who o_ts, 비숫자 -le → 모두 기대대로.
- 실데이터: mes-base 작업트리가 agent/a0d9af7c 에서 미커밋 reported state.json 4건(api_base 없음, branch_base=브랜치 이름) + 같은 order 의 원격 agent 브랜치 4개(api_base null). mes-runlog origin/main state.json 은 전부 merged.
- 확정 후보:
  A(중간) 잠금 탈취 뒤 마감 소유 확인 무력 + 좀비 팀장(beat 갱신이 소유 확인 안 함)
  H(중간) 로컬·원격 중복 제거와 api_base 규칙 충돌 — mes-base 레거시 4건이 정확히 이 상태
  I(중간) push 훅 거부 시 스윕 정지 → 원문 Phase 0-가 "이 작업만 건너뛰고 계속" 대비 수동 퇴행 + 팀장 매 기상 기아
  J(중간) 킷 복사형 리포: 전제 검사는 작업트리 스킬만 봄, 팀원은 origin 기본 브랜치 스킬로 detach → 미push 시 전원 no-worker-flag
  B(낮음) 승인 뒤 변경 확인 fail-open(head_sha 부재/비조상)
  F(낮음·추측) branch_base 누락 시 비스택 판정, 구조적 백스톱 없음
  K(낮음) 팀장 되묻기를 AskUserQuestion 으로 하면 루프 전체 정지
  G(낮음) 문서 정합: plan 1993 "그와 해시가", plan 932 "4번 3단계"(실제 4단계), spec 963 번호 3 중복, blockers 요약 문구

---
# 최종 보고 (advisor 시간 초과, 자체 검증으로 확정)

결론: 치명·높음 없음. 이번 라운드 반영 18항은 스펙·계획이 서로 맞고, 계획에 박힌 테스트 71건은 계획 본문 기준으로 통과한다(실패 단계 기대치 포함). 남은 실결함은 중간 4건, 낮음 4건이며 모두 문서 수정으로 해소된다.

## 1. 잠금을 빼앗긴 뒤의 소유 확인이 작동하지 않는다(좀비 팀장)
- 심각도: 중간
- 근거: 스펙:610-613 "owner 가 자기 <신원>/<host>/lead 이고 그 시작 시각이 이 팀장의 마지막 team.start 시각 이하인지"; plan:2469 `start=$(jq ... 'select(.agent == $a and .repo == $r and .event == "team.start") | .ts | fromdateiso8601' ... | tail -n 1)`; plan:2247 `date +%s > "$(git rev-parse --git-path dflow-team.lock)/beat"`(소유 확인 없음).
- 실패 시나리오: 잠금은 체크아웃마다 하나라 탈취한 팀장 B 는 반드시 같은 .env·같은 host·같은 경로다. 즉 agent·repo 가 A 와 똑같다. A 가 권한 확인 등에 70분 넘게 멈춘 사이 B 가 잠금을 가져가면, A 의 마감에서 "마지막 team.start" 는 B 의 것이 되고 B 의 owner epoch 는 그보다 작으므로 A 가 B 의 잠금을 지운다. 그 전에도 A 는 매 기상 B 의 잠금 beat 를 갱신하며 계속 돈다. 둘이 같은 체크아웃에서 스윕·spawn 을 하고 같은 슬롯 번호(AGENT_ID)를 낼 수 있다.
- 해소안: 스펙 §4-4·§4-9, 계획 「1. 시작」·「2-3」·「7. 마감」. 전제 검사 끝에 `LOCK_TOKEN=<owner epoch>` 를 출력하고 team.start 에 `lock` 필드로 남기며 팀장 상태 목록에 넣는다. 매 기상 beat 갱신 전에 owner 의 epoch 가 내 토큰과 같은지 보고, 다르면 spawn 을 멈추고 잠금을 지우지 않은 채 마감한다. 마감의 삭제 조건은 "≤ 마지막 team.start" 대신 "owner epoch = 내 토큰" 으로 한다. owner·beat 쓰기 실패도 검사한다(현재는 실패해도 PRECHECK_OK).

## 2. push 훅 거부 한 건이 스윕 전체를 멈춘다(수동 Phase 0-가 퇴행, 팀장 기아)
- 심각도: 중간
- 근거: 원문 .claude/skills/dflow-dev/SKILL.md:77 "push 가 훅에 거부되면 우회 금지, 중단·보고(이 작업만 건너뛰고 나머지 스윕은 계속)". 스펙:965-966·plan:926-927 "훅에 거부되든 경합으로 거부되든 push 가 실패하면 git reset --keep … 보고한 뒤 스윕을 멈춘다". 스펙 §6-1 수정 목록 2 는 이 변화를 수동 개선으로만 적는다.
- 실패 시나리오: wbs-web 은 pre-push G4 가 범위 `--not refs/remotes/origin/main`(.githooks/pre-push:85)로 보므로, 이미 agent 브랜치로 올라간 커밋이라도 0072+ 마이그레이션이 Staging-verified 트레일러 없이 main 으로 가면 막는다. 이런 approved 작업이 후보 앞쪽에 오면, 매 /dflow-dev 와 팀장의 매 기상이 그 후보에서 머지→push 거부→되돌림→정지를 반복한다. 뒤의 다른 approved 작업은 사람이 그 한 건을 풀 때까지 영영 반영되지 않는다. 원문 Phase 0-가 는 건너뛰고 계속했다.
- 해소안: 스펙 §6-4 머지 4·5단계, 계획 Task 2 (5), SKILL 「4. 승인 스윕」. non-fast-forward(경합)는 지금처럼 멈추고, 훅 거부는 reset --keep 뒤 "push 실패(훅)" 로 보고하고 그 후손만 빼고 다음 후보로 간다. 테스트에 두 갈래 문구를 단언한다.

## 3. 킷 복사형 리포에서 갱신한 스킬이 origin 기본 브랜치에 없으면 팀원이 전부 실패한다
- 심각도: 중간
- 근거: plan:2035 `grep -q -- '--worker' .claude/skills/dflow-dev/SKILL.md || bad OLD_DFLOW_DEV`(팀장 작업트리만 봄). plan:1205 워커는 `git switch --detach origin/<기본브랜치>` 한 뒤 plan:1235 같은 경로를 grep 한다. Orca 는 `--base-branch origin/<기본브랜치>`. kit/install.sh 는 스킬을 대상 리포에 복사하고 README 는 커밋을 안내할 뿐 push 는 요구하지 않는다.
- 실패 시나리오: 다른 PC 담당자가 새 킷을 설치·커밋만 하고 push 하지 않은 채 /dflow-team 을 띄운다. 전제 검사는 통과(작업트리는 새 버전, 커밋돼 깨끗함). 팀원 워크트리는 origin 기본 브랜치의 옛 스킬로 detach 되어 전원 `failed no-worker-flag`, 두 건째에 차단기가 걸린다. 리허설은 심링크 배포라 이 경로를 밟지 않는다.
- 해소안: 스펙 §4-4 전제 검사·§8 준비물, 계획 「1. 시작」. `.claude/skills` 가 추적되는 리포면 `git fetch origin` 뒤 `git show "origin/$base:.claude/skills/dflow-dev/SKILL.md" | grep -q -- '--worker' || bad SKILLS_NOT_ON_ORIGIN`(dflow-merge 도 같게). 준비물에 "킷 복사형은 커밋·push" 를 적는다.

## 4. 로컬·원격 중복 제거와 api_base 규칙이 부딪친다(레거시 후보)
- 심각도: 중간(추측: 해석에 따라 갈림)
- 근거: 스펙:918-925·plan:849-865 "원격 후보는 값이 없어도 건너뛴다. 값이 없는 로컬 후보는 지금처럼 판정" + "로컬과 원격에 같은 작업이 있으면 order UUID 로 중복을 없앤다". 어느 쪽을 남기는지, 필터와 중복 제거의 순서가 없다. 실측: ~/project/mes-base 는 agent/a0d9af7c 에서 미커밋 reported state.json 4건(api_base 없음)이 있고, 같은 order 의 origin/agent/* 4개 tip 도 api_base 가 null 이다.
- 실패 시나리오: 머지 뒤 심링크로 즉시 적용된 /dflow-merge 가 이 4건을 원격 사본 기준으로 남기면 "건너뜀(다른 D'Flow)" 로 끝나 승인돼도 반영되지 않는다(원문은 로컬 후보로 머지했다 → 수동 퇴행). 필터를 먼저 걸면 같은 작업이 "건너뜀(다른 D'Flow)" 와 "머지됨" 으로 두 번 보고된다.
- 해소안: 스펙 §6-4 후보 식별, 계획 Task 2 (2). "같은 order 가 로컬·원격 모두에 있으면 로컬 후보 하나로 합쳐 로컬 규칙으로 판정한다(api_base 는 값이 있는 쪽을 쓴다). 머지 대상은 증적 head_sha 를 포함하는 쪽(보통 원격)" 처럼 순서와 승자를 적는다.

## 낮음
- B. 승인 뒤 변경 확인이 fail-open 일 수 있다: plan:914-920 은 head_sha 가 없을 때만 다룬다. head_sha 가 로컬에 없거나 머지 대상의 조상이 아니면 `git diff` 가 오류로 빈 출력을 내고 "비어 있으면 머지" 로 읽힐 수 있다. `git merge-base --is-ancestor <head_sha> <머지 대상>` 이 거짓이거나 diff 가 실패하면 "건너뜀(승인 뒤 변경 확인 불가)" 로 한다.
- F. 스택 판정이 LLM 이 적는 branch_base 하나에 기댄다(추측: 누락 빈도): plan:968-969 "branch_base 가 없거나 … 스택이 아니다". 누락되면 미승인 선행 커밋이 main 에 들어간다. 원격 후보 스캔이 이미 계산하는 `origin/<기본브랜치>...<ref>` 차분에 다른 작업의 state.json 이 있으면 그 작업을 선행으로 보는 구조적 백스톱을 더한다(mes-base 레거시 체인에서 이 차분이 선행 state.json 을 그대로 보여 준다).
- G. 문서 정합: plan:1993-1994 "현재 줄의 해시가 그와 해시가 다를 때만"(스펙:270 은 정상, 테스트 문자열 '해시가 다를 때만 처리한다' 를 지키며 고칠 것). plan:932 "(4번 3단계로 옮겼다)" 인데 삽입본에서는 4단계. 스펙:960·963 번호 3 중복. blockers:17-19 "남은 것은 리허설로만 확인할 수 있는 실측 항목뿐" 은 위 1~4 와 맞지 않는다.
- Orca 부트스트랩 실패 정리(추측): 허용 부산물에 `docs/tasks/<TSK>/spec.md` 가 있으나 info/exclude 대상이 아니다. claim 뒤 브랜치 생성 전에 실패한 드문 경우 `orca worktree rm`(비 --force)이 미추적 파일로 거부될 수 있다. 리허설 6번에서 함께 본다.

## 확인했고 문제없음
- 이번 반영 18항: zsh 안전 셸(계획 전체에 glob 루프·`[ \> ]` 없음, 스크래치 zsh 로 `${s%%|*}`·`[ 0930 -lt 1800 ]`·`for r in $(...)`·`read -r o_who o_ts`·비숫자 `-le` 실측), poll exit 0 재대조(영구+슬롯만, 스펙:454=plan:2264), epoch owner·mv 탈취(단 1번 참고), 행 H 재개 경로, 재기동 시 답 대기 blocked 재기록, 생성 브랜치 정리(agent/ 제외·origin 조상만), /dflow-merge branch_base 순서, head_sha..tip 검사, api_base 3·4번 본문, 무의미 단언 교체(dflow.sh 정규식이 오류 문구 "— git push" 를 잡지 않고 치환 뒤 `-git}` 도 잡지 않음 확인), 제외 우선순위, 마감 시 살아 있는 팀원 보존, TaskStop 선행, poll 경로 따옴표, 당일 종료 시각, SPACE_IN_PATH, 백엔드별 부트스트랩 실패 정리, 리허설 기본 3명.
- 원본 대조: dflow-dev·dflow-merge 가 origin/main 과 동일(204·44행). CHANGED dev 11·범위 경계 2·merge 8·표지 앵커 8 이 원문에 정확히 1회. poll.sh 머리말 exit(0·2·3·5·6·7·8·9·10), 41행 DFLOW_ENV_FILE, 43·68행 빈 cwd 감지 재료 없음, 26-31행 빈 값 삼킴. dflow.sh 227행 라벨, 186-199·222-226행 선행 도달 검사, 404→7·dependency_not_met→4, doctor 인증 실패도 0, done 의 evidence.head_sha = done 시점 HEAD. mes-runlog .gitignore 39행.
- 테스트 71건(13/9/11/8/25/5)과 실패 단계 기대치(10·3, 7·2, 11, 8, 25, 5)는 계획 본문 기준으로 맞다.
- 수동 비퇴행: detach 가 claim 앞으로 와서 옛 "claim 뒤 switch 실패" 보다 낫다. 반려 state.json 을 안 고쳐도 재작업 경로가 rejected 를 쓰므로 poll exit 10 이 반복되지 않는다. api_base 없는 원격 브랜치는 건너뛰므로 기존 리포의 옛 agent 브랜치를 건드리지 않는다(단 4번 참고).
- 수정 이력 문구 없음.
