# /dflow-dev 단계 — Design 게이트와 구현 전환

SKILL.md 「단계 지도」 가 가리킬 때 읽는다. 다 읽기 전에 이 단계를 시작하지 않는다. 모든 단계에 공통인 규칙(게이트 집행 원칙·상태 모델·서버 통신)은 SKILL.md 에 있다.

### 설계 받기 (범위 `build`, 계약 2.11)

범위가 `build` 면 Design 게이트 전에 승인·확정된 설계를 받아 온다. 먼저 `git fetch origin` 한다 — 실패하면 되돌리지 않고 그 사실을
알리고 끝낸다(다시 돌리면 이어 간다). 그다음 서버 `design_mode`(show 의 `.order.design_mode`)로 가른다.
- `review`(「설계 승인」): 사람이 검토하며 고친 설계는 원격 agent 브랜치에 있다. 로컬 agent 브랜치가 origin 의 조상이면
  `git merge --ff-only origin/<그 브랜치>` 로 맞추고, origin 이 로컬의 조상이면 그대로 둔다. 둘 다 아니면(갈라짐) 이어 가지 않고 두 끝의
  sha 를 적어 알리고 끝낸다. 원격 agent 브랜치가 없으면(승인 뒤 머지·정리됐다) 아래 `human` 처럼 개발 브랜치의 design.md 를 받는다.
- `human`(「설계 확정」): 설계 원본은 개발 브랜치다. `git show origin/<기본브랜치>:<TASKS>/<TSK>/design.md` 로 받아 워크트리의 같은 파일에
  덮어쓰고, 바뀌었으면 그 파일만 파일명을 명시해 커밋한다(`DFlow-Order` 트레일러). 같은 주문의 옛 agent 브랜치에 남은 옛 사본으로 게이트가
  되풀이해 실패하지 않게 한다. 개발 브랜치에 그 파일이 없으면 아래 게이트 불통과 같게 다룬다(빠진 것은 `design.md 없음`).

받아 온 바로 뒤, 다른 것을 커밋하기 전에 아래 Design 게이트를 돈다. 통과하면 이어 간다. 불통이면 먼저 서버 단계(`.order.item.stage`)를
본다. **이미 `ip` 이상이면**(반려 재작업이거나, build-start 가 이미 성공한 뒤 state.json 만 `design` 에 남아 재개가 여기로 들어왔다)
design-reopen 을 부르지 않는다 — 서버는 설계 상태가 `review` 이거나 `accepted`∧단계 `dd` 일 때만 그 동사를 받는다(migration
0108_design_state.sql 259~262행). 「승인된 설계 고정」 절의 `"{TSK} 설계 게이트 불통(구현 중) — 사람이 설계를 고친 뒤 --resume 하세요"`
로 알리고 끝낸다. **단계가 아직 `ds`·`dd` 면** 빠진 절을 적어 `dflow.sh design-reopen <ref> --reason "<빠진 절>"` 을 부른다. exit 0
이면 서버가 review 는 설계 검토 대기로, human 은 사람 설계 대기로 되돌린다 — 빠진 절을 사유로 알리고 끝낸다. exit 6(네트워크)이면
다시 부를 수 있는 상태로 알리고 끝낸다. 그 밖의 exit 는 서버가 거부한 것이다 — 그 코드를 적어 알리고 끝낸다. 빠진 절을 스스로 채우지
않는다(설계는 사람이 고친다).

### Design 게이트

이 절(게이트 판정·`build-start`·모듈 기준선)은 `orch/phase-common.md` 「Phase 종료마다」 1번(게이트 집행)에 속한다 — 2번(커밋 확인·
state.json 전진·`progress 25`)과 3번(회수)은 이 절을 마친 뒤 한다. `build-start` 가 exit 4 면 2번 대신 `orch/design-first.md` 「2」 의
멈춤 절차를, 범위가 `design` 이면 2번 대신 아래 「설계만 멈춤」 을 하고, 어느 쪽이든 3번 회수는 한다.

범위가 `build` 면(`orch/start.md` 「구현자동 착수」·「승인된 설계 이어 가기」·옛 서버의 두 절, `orch/rework.md`) Design 서브에이전트를
띄우지 않는다. 계약 2.11 이면 위 「설계 받기」 로 승인·확정된 설계를 받고, 옛 서버면 이미 있는 design.md 로 곧바로 Design 게이트를 돈다.
게이트가 통과하면 design.md 를 새로 커밋할 것은 없다(human 의 덮어쓰기 커밋은 「설계 받기」 가 이미 했다).

   - **Design 게이트 뒤 구현 전환**: Design 게이트가 통과하면 아래 모듈 기준선보다 먼저 `dflow.sh build-start <ref>` 를 부른다(늘
     부른다 — 옛 서버는 `BUILD_START_UNSUPPORTED` 로 넘어간다). exit 4 면 Build 로 가지 않고 설계 완료·선행 대기로 멈춘다. 갈래와
     멈춤 절차는 「설계 선행」 2.
   - **범위를 붙인다(계약 2.11)**: `dflow.sh contract-ge 2.11` 이 exit 0 이면 위 호출은 `dflow.sh build-start <ref> --scope <범위>` 다.
     범위는 state.json `scope`(`full`·`build`)이고, 반려 재작업(`orch/rework.md`)이면 방식과 무관하게 `rework` 다. 범위 `design` 은
     build-start 를 부르지 않는다(아래 「설계만 멈춤」).
   - **Design 게이트 뒤(대응표가 있을 때만)**: 첫 Build 단위를 띄우기 전에 모듈 게이트 명령의 기준선을 잰다. design.md
     「변경 파일 목록」 의 경로를 파일에 적어 `gate-scope.sh --base <기점> --ignore <TASKS>/<TSK>/ --paths-file <파일>` 로
     예측 범위를 보고, `module` 줄의 명령마다 `baseline.sh run --base <기점> --task-dir <TASKS>/<TSK> -- '<명령>'` 으로 잰다.
     트리가 기점과 코드가 같을 때(`git diff --name-only <기점>..HEAD` 와 `git status --porcelain` 이 Task 문서 밖에서 빔)만
     잰다. 결과는 state.json `baseline.cmds` 에 `"scope": "module"` 을 붙여 더한다. 정본은 dev-discipline 「게이트 범위 대응표(.dflow-gates)」.

2. **Design 게이트 뒤**(위 「Design 게이트」): `dflow.sh build-start <ref>` 의 결과로 가른다. 모드와 무관하게 늘 부른다.

   | 결과 | 처리 |
   |---|---|
   | exit 0 | Build 로 간다(종전) |
   | exit 0 + stderr `BUILD_START_UNSUPPORTED` | 옛 서버다(404 이고 계약 < 2.9 — claim 이 이미 `ip` 로 보냈다). Build 로 간다 |
   | exit 4 | 설계 완료·선행 대기로 멈춘다(아래 멈춤 절차) |
   | exit 10 | 중단(상태 모델) |
   | exit 11 + stderr 끝줄 `DESIGN_GATE design_gate order_changed` | 그 사이 사람이 설계를 되돌렸거나 주문이 바뀌었다. Build 로 가지 않고 `"{TSK} 주문이 바뀌어 구현을 시작하지 않았습니다 — 다시 확정되면 새로 시작합니다"` 로 알리고 끝낸다 |
   | 그 밖의 exit 11(`DESIGN_GATE <code>`) | 설계 관문 거부다. Build 로 가지 않고 `"{TSK} 는 설계 관문에서 거부됐습니다(<code>)."` 로 알리고 끝낸다(`phase` 는 그대로) |
   | exit 12(`RUNNER_ACTIVE <runner>`) | 다른 PC 가 이 작업을 돌리는 중이다. state.json 을 바꾸지 않고 push·done 없이 `"{TSK} 는 다른 PC(<runner>)가 돌리고 있어 멈춥니다."` 로 알리고 끝낸다 |
   | 그 밖 | Build 로 가지 않고 중단·보고한다. `phase` 는 `design` 그대로라 재실행하면 Design 게이트 뒤에서 다시 부른다. 워커는 `failed build-start <exit>` |


### 설계만 멈춤 (`--scope design`)

범위가 `design` 이면 Design 게이트가 통과한 뒤 `build-start` 를 **부르지 않는다**(부르면 서버 단계가 `ip` 로 넘어간다). 모듈 기준선도
재지 않는다. 대신 이 순서로 멈춘다.
1. design.md 커밋을 확인한다(없으면 파일명 명시 커밋).
2. state.json `phase` 를 `wait_review` 로 쓰고 파일명을 명시해 커밋한다(`DFlow-Order` 트레일러). 그 다음 `progress 25 "설계 완료(검토 대기)"`
   를 보낸다.
3. `git push origin <agent 브랜치>` 로 설계를 원격에 남긴다(사람의 검토와 이어받기가 그 브랜치를 쓴다). 훅에 거부되면 우회하지 않고
   보고한다. 그 밖의 이유로 실패하면 4 를 하지 않고 그 사실을 알리고 끝낸다 — 다시 돌리면 이어 간다(계약 2.11 은 `orch/start.md`
   「끝나지 않은 설계 멈춤 이어받기」 가 마저 한다).
4. 계약 2.11(`dflow.sh contract-ge 2.11` 이 exit 0)이면 `dflow.sh design-done <ref>` 를 부른다. 서버가 단계를 `dd`, 설계 상태를 `review`
   로 두고 도는 PC 를 비운다(좌석은 「설계 검토 대기」). exit 6(네트워크)이면 멈춤을 계속한다(다시 돌리면 이어받기가 마저 한다). exit 11
   이면 서버가 거부한 것이다 — 그 코드를 적어 보고하고 끝낸다. 그 밖의 exit 는 `failed design-done <exit>` 로 알리고 끝낸다. 옛 서버면
   `dflow.sh heartbeat <ref> --phase wait_review` 를 부른다. 실패해도
   (계약 2.10 전 서버는 400) 멈춤을 계속한다 — 좌석 이름표만 틀리고, 이어 갈지는 로컬 state.json 으로 판정한다.
5. supervised 는 계약 2.11 이면 `"{TSK} 설계 완료·검토 대기 — agent 브랜치의 design.md 를 검토·수정해 push 한 뒤 「설계 승인」을 누르면
   팀장이 이어 간다(팀장이 없으면 /dflow-dev {TSK})"`, 옛 서버면 `"{TSK} 설계 완료·검토 대기 — design.md 를 검토·수정한 뒤 /dflow-dev {TSK}
   --scope build 로 이어 간다"` 로 알리고 끝낸다.

design.md 의 `## 담당자 확인 필요 결정` 절은 이 멈춤에서 서버로 넘기지 않는다 — 사람이 검토하며 design.md 에서 바로 답하고, 이어 가
구현을 마치는 마감(`orch/close.md`)에서 `decisions.json` 으로 넘긴다. 미충족 선행이 있어도 같다(claim 이 설계 선행 모드였으면
`design_first.unmet` 이 이미 적혀 있다). 선행 판정은 이어 갈 때 `orch/design-first.md` 「3」 이 한다. `wait_pred` 를 쓰지 않는
이유: 팀장은 선행이 풀린 `wait_pred` 워크트리를 자동으로 Build 로
재개한다 — 사람이 검토하기 전에 구현이 시작되면 안 된다.
<!-- worker:begin -->
`--worker` 면 이 파일에서 알리고 끝나는 자리(「설계 받기」·「Design 게이트」 표의 exit 11·12·「설계만 멈춤」 3~5·「승인된 설계 고정」)마다
알림 대신 worker-mode.md 「설계 상태의 결과 줄」 의 줄을 `.result` 에 쓰고 끝낸다(형식 정본은 worker-prompt.md).
<!-- worker:end -->

### 승인된 설계 고정 (D24, 계약 2.11)

서버 `design_state=accepted`(「설계 승인」·「설계 확정」)이고 단계가 `ip` 이상이면 설계는 고정이다. design.md 의 설계 내용을 고치지
않는다. 게이트가 적는 기록 절(`## 담당자 확인 필요 결정`·`## 도커 금지로 생략한 검증`)만 예외다. 재개 판정(SKILL.md 상태 모델의 산출물
교차 확인)이 design.md 가 없거나 5절이 모자라 Design 으로 후퇴하려 하면 후퇴하지 않고, 「설계 받기」 자체의 게이트 불통도 같다(단계
`ip` 이상이면 design-reopen 을 부르지 않는다). `"{TSK} 설계 게이트 불통(구현 중) — 사람이 설계를
고친 뒤 --resume 하세요"` 로 알리고 끝낸다. 완전자동(설계 상태 없음)은 반려 재작업에서도 종전대로 설계부터 다시 판단한다.

**다음 단계**: 범위 `design` 이면 여기서 끝난다. 아니면 `build-start` exit 0 이면 `orch/build.md`, exit 4 면 `orch/design-first.md` 「2」.
