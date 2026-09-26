# /dflow-dev 단계 — 설계 선행

SKILL.md 「단계 지도」 가 가리킬 때 읽는다. 다 읽기 전에 이 단계를 시작하지 않는다. 모든 단계에 공통인 규칙(게이트 집행 원칙·상태 모델·서버 통신)은 SKILL.md 에 있다.

## 설계 선행 (계약 2.9)

선행이 구현 중(`ip`)인 동안 후속의 Design 을 먼저 해 두고, 선행이 끝나면 선행 코드를 한 번 들여 Build 로 간다. 서버 단계는
claim 때 `ds`(설계 중), `build-start` 뒤 `ip` 다. 설계 정본은 wbs-web 리포 docs/superpowers/specs/2026-09-26-dflow-parallel-token-design.md
§6(킷에는 미동봉)이고, 이유는 rationale.md 「설계 선행」 이다.

1. **claim 과 모드**(Phase 01 2번 「claim 명령」): `DESIGN_FIRST_UNMET <JSON>` 줄이 없으면 종전 그대로다. 있으면 **설계 선행 모드**다.
   - state.json 에 `design_first: {"unmet": [<그 JSON 의 external_ref>…]}` 를 적는다(Phase 01 3번의 `prepare` 쓰기와 같은 자리).
  `design_first`(선택)는 설계 선행 모드의 표식 `{"unmet": ["<선행 external_ref>", …]}` 이다(「설계 선행」). 재개한 뒤에도 기록으로 남긴다.
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
2. **설계 완료·선행 대기 멈춤**: `orch/design.md` 「Design 게이트」 의 `build-start` 가 exit 4 일 때 한다.

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
   6. `orch/design.md` 「Design 게이트」 의 표대로 `build-start` 를 다시 부른다. exit 0 이면 그 절의 모듈 기준선부터 이어 Build 로 간다.


**다음 단계**: 1 을 마치면 `orch/claim.md` 의 다음 단계(`orch/baseline.md`)로. 2 의 멈춤이면 끝. 3 재개는 2 에서 `orch/base.md`, 4 에서 `orch/baseline.md` 절차로 다시 재고, 5 가 검토 모드면 `orch/phase-common.md` → `orch/design.md`, 6 뒤 Build 는 `orch/phase-common.md` → `orch/build.md`.
