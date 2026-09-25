# /dflow-merge 해소 머지(`--resolve`)

`/dflow-merge --resolve <ref> --attempt <n>` 일 때만 읽는다. SKILL.md 공통부(「절차」·「트레일러 고정」·「결정 번호 매김」·
「마이그레이션 버전 관문」·「금지」)와 함께 쓴다. 아래 "1·2단계", "3단계", "4단계 N번", "5번 뒷정리" 는 SKILL.md 「절차」 의 번호다.

## 해소 머지

팀장이 띄운 해소 워커(`dflow-team/references/resolve-prompt.md`)만 이 절을 탄다. 목적은 충돌한 작업 한 건을
**개발 브랜치 위의 머지 커밋 안에서** 푸는 것이다. agent 브랜치는 건드리지 않는다. 건드리면 다음 스윕의 2단계
「승인 뒤 변경 확인」 이 그 작업을 "건너뜀(승인 뒤 변경)" 으로 내기 때문이다. rebase 도 하지 않는다. rebase 는
force push 금지와 `merge-base --is-ancestor <head_sha>` 검사에 모두 걸린다. 결과는 마지막 출력 줄 **하나**로 호출자에게
넘긴다(아래 「결과 줄」).

1. **후보·판정**: SKILL.md 「절차」 1·2단계를 그대로 하되 후보는 인자 ref 하나뿐이다. 2단계가 머지 대상이 아니라고 판정하면(승인 대기·
   반려·이미 머지됨·조회 실패 등) 해소하지 않고 `RESOLVE_SKIPPED <그 보고 문구>` 로 끝난다. 3단계의 스택 판정에서
   선행이 개발 브랜치에 없으면 `RESOLVE_SKIPPED 건너뜀(기점 미반영)` 이다. 해소 워커는 선행까지 머지하지 않는다.
2. 머지 자리는 **호출한 워크트리 자신**이다. 임시 머지 워크트리 `<ROOT>/.claude/worktrees/dflow-merge` 는 쓰지 않는다.
   팀장 스윕의 임시 워크트리와 경로가 겹치기 때문이다. 이 워크트리는 `origin/<기본브랜치>` 에 detach 돼 있어야 한다.
   ```bash
   git fetch origin
   git branch --show-current                  # 비어 있어야 한다(detached). 아니면 RESOLVE_NOT_DETACHED 로 멈춘다
   git rev-parse HEAD origin/<기본브랜치>      # 두 줄이 같아야 한다. 다르면 RESOLVE_BASE_MOVED <origin 짧은 sha> 로 멈춘다
   ```
   `RESOLVE_BASE_MOVED` 는 실패가 아니다. 호출자가 새 `origin/<기본브랜치>` 로 다시 detach 하고 기준선을 다시 잰 뒤
   이 절을 다시 부른다. 기준선과 머지 기점이 어긋나면 게이트가 개발 브랜치의 새 실패를 해소 탓으로 돌리거나, 그
   반대가 되기 때문이다. 이때 `git rev-parse HEAD` 를 **기준 HEAD** 로 기록한다.
3. **승인 뒤 변경 확인**: SKILL.md 「절차」 4단계 2번 그대로다. 걸리면 `RESOLVE_SKIPPED 건너뜀(승인 뒤 변경)` 또는
   `RESOLVE_SKIPPED 건너뜀(승인 뒤 변경 확인 불가)` 로 끝난다.
순서는 **해소·stage → 게이트 → 기록 → 커밋** 이다(4~6번). 게이트는 커밋하기 **전에** stage 한 트리에서 돌고, 그
결과(시험 총수)를 `resolution.md` 에 적어 머지 커밋에 함께 담는다. `resolve-prompt.md` 「게이트」·「기록」 도 같은 순서를
말한다. 이유: 게이트를 커밋 뒤에 돌리면 커밋에 담을 게이트 결과가 아직 없다. 2026-09-24 해소 워커 셋이 이 모순을
연달아 `skill-unclear` 로 보고하고 저마다 다르게 우회했다.

4. **머지·해소·stage**: 충돌 여부와 무관하게 늘 커밋 없이 머지한다. 그래야 `resolution.md` 와 트레일러 둘이 한 커밋에 실린다.
   rerere 는 명령줄 `-c` 로만 켠다. `git config` 로 켜지 않는 이유: 워크트리의 `git config` 는 공용 `.git/config` 에
   써져 사람 체크아웃까지 바뀐다. rerere 기록(`rr-cache`)은 공용 디렉터리에 남으므로, push 경합 뒤 재머지와 다음
   시도가 같은 해소를 다시 쓴다. 기록은 커밋 때 남으므로 `commit` 에도 `-c` 를 붙인다.
   ```bash
   git -c rerere.enabled=true merge --no-ff --no-commit <머지 대상>
   git diff --name-only --diff-filter=U        # 충돌 파일 목록. 비었으면 텍스트 충돌은 없다(files=0)
   ```
   - 텍스트 충돌과 별도로 `.claude/skills/dflow-merge/scripts/migration-check.sh --staged` 를 돈다(「마이그레이션 버전
     관문」). exit 1 이면 `resolve-prompt.md` 「해소 규약」 R9 로 이 브랜치가 추가한 마이그레이션을 재채번한다. 스윕이
     `(마이그레이션 버전)` 으로 넘긴 작업은 텍스트 충돌이 0 개일 수 있다(`files=0 rules=R9`). exit 2 면 해소하지 않고
     `git merge --abort` 뒤 `RESOLVE_SKIPPED 건너뜀(마이그레이션 검사 실패)` 로 끝난다.
   - 공용 결정 기록(`decisions.md`) 충돌은 먼저 `.claude/skills/dflow-merge/scripts/decisions.sh merge-conflicts` 로 푼다
     (「결정 번호 매김」). 번호는 손으로 매기지 않는다. `DECISIONS_LEFT` 로 남은 파일은 아래 규약으로 푼다.
   - 충돌 파일마다 `dflow-team/references/resolve-prompt.md` 「해소 규약」 의 R1~R9 로 푼다. 그 규약의 「blocked 로
     멈추는 경우」 에 걸리면 머지를 워크트리에 멈춘 채 두고 `RESOLVE_BLOCKED <질문과 선택지 한 줄>` 로 끝난다
     (`--abort` 하지 않는다. 사람이 답하면 그 자리에서 이어 간다).
   - 푼 파일(R5 로 고친 파일 포함)을 파일명으로 stage 한다. **아직 커밋하지 않는다.**
5. **게이트**: 커밋 **전에**, stage 한 트리에서 한 번 돈다. 충돌이 없었어도 돈다. 의미 충돌은 텍스트 충돌
   없이 오기 때문이다(2026-09-21 가드 Task: 텍스트 충돌 한 줄에 시험 85건이 401).
   - 돌리기 전에 작업 트리가 stage 한 트리와 같아야 한다(`git diff --quiet` 가 exit 0). 시험은 작업 트리에서 돌고
     커밋되는 것은 index 이기 때문이다. 남은 변경이 있으면 stage 하거나 되돌려 맞춘 뒤 돌린다. 게이트 뒤에도 같은
     확인을 한 번 더 한다(시험이 추적 파일을 고쳤으면 `git restore --worktree -- <파일>` 로 index 판으로 되돌린다).
   - 판정은 `dflow-team/references/resolve-prompt.md` 「게이트」 다(기준선은 호출자가 기준 HEAD·머지 대상 단독·
     merge-base 에서 잰 총수). 시험과 함께 `.claude/skills/dflow-merge/scripts/migration-check.sh --staged` 가 exit 0 이어야
     통과다 — 재채번하지 않은 채 push 하지 못하게 한다. exit 1·2 면 아래 실패와 같이 되돌리고 `RESOLVE_GATE_FAILED migration`
     으로 끝난다(해소 워커 결과 `failed gate migration`).
   - 통과하지 못하면 **`git merge --abort`** 로 머지 전 상태로 되돌린다. 되돌린 뒤 `git status --porcelain` 이 비어 있고
     `git rev-parse HEAD` 가 기준 HEAD 와 같아야 한다. 그다음 `RESOLVE_GATE_FAILED <신규 실패 수>` 로 끝난다.
     `reset --keep <기준 HEAD>` 를 쓰지 않는 이유: 커밋 전이라 되돌릴 커밋이 없고(HEAD 는 이미 기준 HEAD), 머지 도중의
     `reset --keep` 은 `Cannot do a keep reset in the middle of a merge` 로 거부돼 해소 편집과 `MERGE_HEAD` 를 그대로
     남긴다. `merge --abort` 는 stage 한 새 파일까지 치운다.
6. **기록·커밋**: 게이트 결과를 해소 기록 `<TASKS>/<TSK>/resolution.md` 의 `## 시도 <n>` 절에 덧붙인다(파일마다 적용한
   규약 번호와 판단 한 줄씩, 그리고 게이트 줄. 형식은 `resolve-prompt.md` 「기록」). `<TASKS>/<TSK>` 는 호출자가 넘긴
   작업 폴더다. `resolution.md` 를 파일명으로 stage 한 뒤 커밋한다. 둘째 `-m` 은 요약(충돌 파일 수·규약 번호)이다.
   ```bash
   git -c rerere.enabled=true commit -m "merge: <TSK> <제목> (approved) — 충돌 해소" -m "충돌 <N>개 · 규약 <R…>" \
     --trailer "DFlow-Order: <order>" --trailer "DFlow-Resolve: <n>/3"
   git rev-parse HEAD                         # 머지 커밋 sha. 결과 줄에 쓰므로 기록해 둔다
   ```
   승인 전 머지(`--on-report`)면 제목 괄호는 `(reported, 승인 전)` 이다. `<n>` 은 `--attempt` 값이다. 트레일러
   `DFlow-Order` 는 「트레일러 고정」 과 같은 이유로 빠뜨리지 않는다(행 G 증거 2). 게이트 뒤에 `resolution.md` 만 더
   stage 했으므로 게이트가 본 트리와 커밋된 트리는 그 파일 하나만 다르다.
   커밋 뒤 「결정 번호 매김」 을 한다: `.claude/skills/dflow-merge/scripts/decisions.sh renumber --tsk <TSK> --order <order>`.
   결과 처리는 SKILL.md 「절차」 4번 3-1단계와 같다(실패해도 막지 않는다). 번호 매김은 decisions.md 머리와 참조 문자열만 바꾸므로 게이트를
   다시 돌지 않는다.
7. **state.json**: SKILL.md 「절차」 4단계 4번 그대로 `phase=merged`(승인 전이면 `unapproved: true` 도) 커밋을 만든다. 이 커밋과 머지
   커밋 사이에 게이트를 다시 돌지 않는다.
8. **push**: `git push origin HEAD:<기본브랜치>`. 실패하면 먼저 `git reset --keep <기준 HEAD>` 로 되돌리고 모양으로
   가른다. 여기서는 머지·state.json 커밋이 이미 있으므로 `reset --keep` 이 되돌릴 기준이 기준 HEAD 다.
   - `non-fast-forward`·`fetch first` 면 경합이다. `git fetch origin && git switch -q --detach origin/<기본브랜치>`
     뒤 `RESOLVE_BASE_MOVED <새 origin 짧은 sha>` 로 끝난다. 호출자가 기준선을 다시 재고 이 절을 1번부터 다시 부른다.
     rerere 가 앞서 푼 덩어리를 되살린다. 기준 이동과 합친 **이 재시도는 한 세션 안에서 2회까지**이며 호출자가 센다.
     넘으면 호출자가 `failed push-race` 로 끝낸다.
   - 그런 문구 없이 1 로 끝나면 훅 거부다. 우회하지 않고 `RESOLVE_PUSH_HOOK` 으로 끝난다.
   - 그 밖의 실패는 `RESOLVE_PUSH_FAILED <exit>` 다.
9. **뒷정리**: SKILL.md 「절차」 5번 뒷정리 그대로다(원격 agent 브랜치 삭제, 로컬 브랜치의 not found·checked out 건너뛰기).
10. **결과 줄**: 성공하면
   `RESOLVE_PUSHED <머지 커밋 전체 sha> base=<기준 HEAD 짧은 sha> files=<충돌 파일 수> rules=<R번호,…|-> tests=<통과/총수> need=<하한>`.
   `총수` 는 머지 결과 총수, `하한` 은 게이트 판정의 `need`(개발 브랜치 총수 + (머지 대상 단독 총수 − merge-base 총수) − 계획 삭제 수)다.
   머지 커밋 sha 는 6번에서 기록한 `git rev-parse HEAD` 값이다. `HEAD~1` 처럼 뒤 커밋 수에 기대어 세지 않는다. 전체 sha 로
   넘기는 이유: 팀장이 이 값으로 조상 확인을 하는데, 짧은 sha 는 저장소가 커지면 모호해져 확인이 실패할 수 있다.

`--resolve` 가 쓰는 파일은 호출한 워크트리 안뿐이다. 팀장 체크아웃은 건드리지 않으므로, 해소가 `RESOLVE_BLOCKED` 로
멈춰도 팀장의 전제 검사는 깨지지 않는다.
