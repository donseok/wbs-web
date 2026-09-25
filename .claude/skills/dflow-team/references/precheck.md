# /dflow-team 전제 검사 결과별 처리 (SKILL.md 「1. 시작」 1번)

SKILL.md 「1. 시작」 1번 전제 검사 블록이 `PRECHECK_OK` 없이 끝났을 때(`FAIL …`·`LOCKED`·lease 거부) Bash `cat` 으로 읽고
그 코드의 처리대로 보고한다. 잠금·lease 규칙의 자세한 설명도 여기 있다.

- `WARN GRADLE_TUNING <빌드 루트> <빠진 키 또는 "(gradle.properties 없음)">`: `FAIL` 이 아니라 `PRECHECK_OK` 와 함께
  나올 수 있는 **경고**다 — 시작을 막지 않는다. `gradle-check.sh`(아래)가 그 리포를 Gradle 리포로 보는데
  빌드 루트의 `gradle.properties` 에 권장 3키(`org.gradle.caching`·`org.gradle.workers.max`·
  `org.gradle.daemon.idletimeout`) 가 없거나 파일 자체가 없을 때 낸다. 시작 보고에 한 줄로 안내하고
  "dflow-kit 의 `install.sh <리포>` 를 다시 돌리면 새 파일은 만들고 기존 파일은 붙일 줄만 안내한다" 를 덧붙인다.
  판정 로직은 `.claude/skills/dflow-team/scripts/gradle-check.sh` 하나뿐이고 `install.sh` 도 같은 스크립트를
  부른다(중복 방지). 이 스크립트는 탐색·판정만 하고 파일을 고치지 않는다.

- **팀장 잠금**: 잠금은 디렉터리이며 `mkdir` 로 얻는다. `mkdir` 는 원자적이라 동시에 시작한 팀장 둘 중 하나만
  성공한다. 실패한 검사가 잠금을 남기지 않도록 블록의 마지막에 둔다. 안에 `owner` 한 줄
  `<신원>/<host>/lead <시작 epoch 초> <PID>` 와 `beat`(epoch 초)를 쓴다. PID 는 팀장 세션 프로세스의 PID 로,
  Bash 도구가 환경 변수 `CLAUDE_PID` 로 내보내는 값(없으면 `$PPID`)이며 Bash 호출마다, 컨텍스트 압축 뒤에도
  같다. `$PPID` 만 쓰지 않는 이유: Windows 의 Git Bash 는 부모가 Cygwin 프로세스가 아니면 `$PPID` 를 1 로
  보고해 모든 팀장이 같은 PID 를 갖는다. Windows 에서 `CLAUDE_PID` 가 비어 있으면 `NO_CLAUDE_PID` 로
  중단한다. 이유: `$PPID` 가 1 이면 잠금 소유 판정이 모든 팀장을 같은 프로세스로 보고, 권한 확인 생략
  감지도 `Get-CimInstance` 가 PID 1 을 찾지 못해 항상 0 이 된다(러너 실측). **소유 판정**은 "`owner` 의 신원이 자기
  `<신원>/<host>/lead` 이고 PID 가 현재 `$LEAD_PID` 와 같다" 이다. 이유: 잠금은 체크아웃마다 하나라서 잠금을 가져간
  다른 팀장도 신원·host·리포가 같고, 신원만으로는 누구의 잠금인지 가려내지 못한다. 시작 시각은 `LOCKED` 안내에서
  사람이 그 팀장을 알아보게 하려고 둔다. 팀장은 매 기상 소유를 확인한 뒤에만 `beat` 를 갱신한다(「2-3」).
  `owner`·`beat` 쓰기가 실패하면 방금 만든 잠금 디렉터리를 지우고 `FAIL LOCK_WRITE` 로 끝낸다. 이유: `beat`
  없는 잠금은 만들어진 지 10분 안에는 다른 팀장의 시작을 막는데(아래), 그대로 두면 그 10분 동안 아무도
  시작하지 못한다. 방금 `mkdir` 로 만든 잠금은 다른 팀장이 건드리지 않으므로 지워도 남의 잠금이 아니다.
  기존 잠금의 `beat` 가 있고 70분(4200초)보다 새로우면 거부한다. `beat` 가 없으면 잠금 디렉터리 자체의
  수정 시각을 본다(`find "$LOCK" -maxdepth 0 -mmin +10` 가 경로를 출력하면 10분보다 오래된 것이다;
  macOS·Linux 모두에서 도는 방법이다). 10분 이내면 `mkdir` 와 `owner`·`beat` 쓰기 사이의 그 짧은 틈에 있는,
  방금 만들어지는 중인 잠금으로 보고 지금처럼 거부한다. `beat` 가 있고 70분보다 오래됐거나, `beat` 가
  없고 잠금 디렉터리가 10분보다 오래됐으면 죽은 것으로 보고 가져온다. 가져올 때는 잠금 디렉터리를 `mv`
  로 이 팀장만 아는 이름 `$LOCK.stale.$$` 로 옮기고, 옮긴 디렉터리를 같은 기준(옮기기 전 본 것이 `beat`
  였으면 `beat` 를, 잠금 디렉터리 수정 시각이었으면 옮긴 디렉터리의 수정 시각을)으로 다시 재어 여전히
  오래됐을 때만 지운 뒤 `mkdir` 로 다시 얻는다. 옮긴 잠금이 새로우면 그사이 다른
  팀장이 가져간 것이므로 옮긴 경로를 알리며 거부하고 사람이 되돌리게 한다. `mv` 나 다시 하는 `mkdir` 가
  실패해도 다른 팀장이 먼저 가져간 것이므로 거부한다. 이유: 다시 잰 시각이 여전히 오래됐음을 확인한 뒤
  지우기 전에 다른 팀장이 먼저 가져가면 그 잠금까지 지우게 되는데, 옮긴 디렉터리는 이 팀장만 보므로 확인과
  삭제 사이에 끼어들 틈이 없다. `LOCKED` 로 거부할 때는 잠금 경로·
  `owner`·`beat` 시각과 함께 "그 팀장이 끝난 것이 확실하면 잠금 디렉터리를 지우고 다시 시작하라" 를 안내한다.
  질문하지 않고 중단한다(AskUserQuestion 을 쓰지 않는다).
  세션이 죽은 직후 재기동하면 `beat` 가 아직 새롭기 때문이다. 이유: 한 체크아웃의 팀장 둘은 슬롯 번호·세대
  파일·승인 스윕을 서로 덮어쓴다. 생존(가져와도 되는지)은 PID 가 아니라 `beat`(없으면 잠금 디렉터리 수정
  시각)로 본다. 이유: 세션 프로세스가
  살아 있어도 권한 확인 등에 멈춘 팀장은 기상하지 않아 제 몫을 못 하는데, `beat` 는 그 멈춤까지 드러낸다.
  살아 있는 팀장은 늦어도 `TICK`(30분)마다 `beat` 를 갱신하므로(변화가 없어 건너뛴 TICK 은 감시 루프가 `wake.sh` 로
  갱신한다, 「2-2」), 70분이면 두 `TICK` 을 연속으로 놓친 것이다.
- **팀장 lease**: 로컬 잠금은 같은 리포의 워크트리끼리만 본다. 같은 신원이 **다른 clone·다른 PC** 에서 같은
  프로젝트의 팀장을 띄우는 것은 서버 lease 가 막는다(스펙 wbs-web docs/superpowers/specs/2026-09-23-dflow-lead-lease-design.md).
  로컬 잠금을 잡은 **뒤** 얻는다. 이유: 같은 리포의 두 팀장이 동시에 서버에 가서 같은 holder 로 서로를
  밀어내지 않게, 로컬 경합을 먼저 끝낸다. 결과별 처리:
  - `LEASE_OK <n>`: 계속한다.
  - `LEAD_LEASE_HELD <project_id> <host> <agent> <만료 시각>` 줄(exit 4): 잠금을 지우고 멈춘다. 줄마다 "이 프로젝트는
    `<host>` 의 `<agent>` 가 쥐고 있다(만료 `<시각>`)" 로 보고하고, "그 팀장이 이미 죽었다면 최대 3분 뒤 풀린다.
    지금 넘겨받으려면 `/dflow-team … --takeover` 또는 오피스 화면의 「팀장 해제」" 를 덧붙인다.
  - 그 밖(exit 2·3·5·6·7): 잠금을 지우고 사유를 보고하고 멈춘다. 서버에 lease 가 없는 구버전(exit 7, 404)도 여기다.
    lease 를 확인하지 못한 채 시작하지 않는다(fail-closed).
  `holder` 는 `~/.dflow/machine-id`(처음 쓸 때 만든다)와 이 체크아웃 경로로 정해진다. 같은 자리에서 다시 시작하면
  즉시 넘겨받는다.
- `KIT_NOT_PUSHED`: `.claude/skills/dflow-dev` 가 git 추적되는 킷 복사형 리포면 `git fetch origin` 뒤
  `origin/<기본브랜치>` 의 `dflow-dev` SKILL.md 에 `--worker` 가, `dflow-merge` SKILL.md 에 원격 후보 지원
  (`origin/agent/*`)이 있어야 한다. fetch 가 실패하면 검사할 수 없으므로 실패로 친다. 이유: 팀원 워크트리는
  `origin/<기본브랜치>` 에서 만들어지거나 그리로 detach 해서 그 커밋의 스킬을 쓴다. 킷을 설치·커밋만 하고
  push 하지 않으면 작업트리 검사(`OLD_DFLOW_DEV`)는 통과하고 팀원은 전원 `failed no-worker-flag` 로 끝난다.
  안내에 "킷 커밋을 기본 브랜치에 push 한 뒤 다시 시작하라" 를 넣는다. 심링크 배포 리포는 워커가 메인
  체크아웃의 스킬을 링크하므로 이 검사를 하지 않는다. 판정 대상을 `.claude/skills` 전체가 아니라
  `dflow-dev` 로 좁히는 이유: 일반 스킬만 커밋하고 `dflow-*` 는 심링크로 둔 리포가 있다. 그런 리포를
  킷 복사형으로 읽으면 원격에 없는 `dflow-dev` 를 찾다가 `KIT_NOT_PUSHED` 로 오탐한다(2026-09-23 dmes-standard).
- `NO_PROJECT`: `.dflow` 의 `project_id` 또는 `.dflow.local` 의 `project_map`(레거시 `.env` 의
  `DFLOW_PROJECT_ID`·`DFLOW_PROJECT_MAP`)에 리포 ↔ D'Flow 프로젝트 바인딩이 없으면
  시작을 거부한다. 이유: 서버의 작업 목록(`/work/mine`)은 PAT 주인이 속한 **모든 프로젝트**의 주문을 돌려준다.
  `dflow.sh list` 가 바인딩으로 거르고(poll·"멈춤" 재구성 모두 이 목록을 쓴다) `dflow.sh claim` 이 바인딩 밖
  주문을 `PROJECT_MISMATCH` 로 거부하는데, 바인딩이 없으면 거를 기준이 없어 다른 프로젝트의 작업을 이 리포에서
  개발하게 된다. 같은 모듈 이름·같은 TSK 번호 체계를 쓰는 프로젝트끼리는 겉으로 드러나지도 않는다.
- `CONFIG`: `dflow.sh config --source` 가 실패하면(`.dflow`·`.dflow.local`·레거시 `.env` 어느 것도 읽지 못했거나
  설정에 문제가 있으면) 시작을 거부한다. `dflow.sh` 가 stderr 에 낸 사유 코드(`NO_LOCAL`·`NO_DFLOW`·
  `NO_DEV_BRANCH`·`PERSONAL_KEY_IN_DFLOW`)대로 파일을 고친 뒤 다시 시작한다.
- `SPACE_IN_PATH`: 메인 체크아웃 절대경로에 공백이 있으면 시작을 거부한다. 이유: 포인터 한 줄 형식과
  워커 부트스트랩의 `ln -s` 링크가 공백을 다루지 않는다.
- `NO_DEFAULT_BRANCH`·`NOT_DEFAULT_BRANCH`: 개발 브랜치는 `dflow.sh branch dev` 로 구한다(`.dflow.local` 의
  `dev_branch`, 레거시는 `origin/HEAD`, 그 ref 가 없으면 `git ls-remote --symref origin HEAD`). 팀장 체크아웃은
  그 개발 브랜치 위에 있거나 **detached HEAD** 여야 한다. 다른 이름 있는 브랜치면 거부한다. 이유: 개발 브랜치
  위의 팀장은 그 체크아웃에서 머지하고, detached HEAD 인 팀장은 `/dflow-merge` 가 임시 머지 워크트리에서
  머지해 `HEAD:<기본브랜치>` 로 push 한다(「4. 승인 스윕」). 이름 있는 다른 브랜치를 허용하지 않는 이유는 그
  브랜치가 사람의 작업 브랜치일 수 있어, 스윕 뒤 최신으로 다시 detach 하는 일이 그 작업을 흔들기 때문이다.
  detached HEAD 를 허용하는 이유: 개발 브랜치는 워크트리 하나만 체크아웃할 수 있으므로, 같은 리포에서 두 번째
  팀장을 링크드 워크트리로 띄우려면 개발 브랜치를 잡지 않아야 한다(「두 번째 팀장」).
- `NO_REMOTE_DEV_BRANCH`: 개발 브랜치가 원격에 없으면 먼저 `dflow.sh branch ensure-dev` 가 운영 브랜치에서 만들어
  push 한다. 그것마저 실패했을 때(운영 브랜치도 없음·push 권한 없음)만 이 항목으로 멈춘다. 이유: 팀원
  워크트리와 「4. 승인 스윕」 의 머지는 `origin/<기본브랜치>` 를 기점으로 삼으므로, 로컬에만 있는 개발
  브랜치로는 그 어느 쪽도 동작하지 않는다.
- `SAME_IDENTITY_LEAD`: 같은 리포의 다른 워크트리에 잠금 `owner` 가 같은 `<신원>/<host>/lead` 이고 `beat` 가
  살아 있는 팀장이 있으면 거부한다. 잠금은 워크트리마다 따로 생기므로 잠금만으로는 이 경우를 막지 못한다.
  이유: 팀원 재구성과 고아 스캔은 `git worktree list` 로 리포의 모든 워크트리를 보고 `<신원>/<host>/` 접두로
  자기 팀원을 가려낸다. 같은 신원의 팀장이 둘이면 서로의 팀원을 자기 슬롯으로 흡수하고, 같은 `w<slot>` 을
  발급해 좌석표가 한 인물을 두 책상에 그리며, 「이어서 시작」 요청을 둘 다 받아 한 작업에 워커를 둘 띄운다.
  같은 신원으로 일을 나눠 돌리고 싶으면 팀장 하나에 인원과 WP 범위를 주면 된다. 두 팀장이 동시에 시작하는
  아주 짧은 틈은 막지 못한다.
- `OLD_DFLOW_DEV`·`OLD_DFLOW_MERGE`: 수정된 기존 스킬이 적용되지 않았다. 옛 `/dflow-dev` 면 팀원이 기본
  브랜치 switch 에서 죽고, 옛 `/dflow-merge` 면 스윕이 팀원 작업을 영영 보지 못한다. 판정은 각 SKILL.md 의
  `<!-- dflow-caps: … -->` 표식 줄로 한다(본문 문구를 grep 하면 문서를 고칠 때 소리 없이 깨진다).
  `KIT_NOT_PUSHED` 는 표식 도입 전에 push 된 킷도 받도록 옛 문구(`--worker`·`origin/agent/*`)를 함께 인정한다.
- `AUTH`: 인증은 `dflow.sh me` 의 성공(`user_email` 이 나옴)으로 판정한다. doctor 는 진단 출력용이며 종료
  코드로 판정하지 않는다. 이유: doctor 는 토큰 인증이 실패해도 그 줄만 출력하고 0 으로 끝난다. 출력한
  `user_email` 로 `DFLOW_PATS` 첫 토큰이 이 신원의 PAT 인지 보여 주고, 그 값으로 `<신원>` 슬러그를,
  `hostname` 의 첫 점 앞부분으로 `<host>` 슬러그를 만든다(`hostname -s` 는 Windows 의 hostname.exe 에 없다).
  팀원은 `<신원>/<host>/w<slot>`, 팀장은 `<신원>/<host>/lead` 다.
- `LEGACY_REPORTED`: `api_base` 가 없는 `phase=reported` 로컬 state.json 이 있으면 시작을 거부하고
  "수동 `/dflow-merge` 로 먼저 정리하라" 고 안내한다. 이유: 스테이징 D'Flow DB 는 운영을 복제하므로 출처를 모르는
  로컬 후보를 자동 스윕이 머지할 수 있다. 같은 작업의 원격 사본에 값이 있으면 `/dflow-merge` 가 출처를
  가려내지만(1번 로컬·원격 중복), 사본이 없거나 사본에도 값이 없으면 그 후보를 수동 규칙대로 판정하므로, 사람이
  보지 않는 루프에 그 판정을 맡기지 않는다. 이 검사는 로컬 파일만 보므로 원격 사본에 값이 있는 경우도
  거부하며, 이는 안전한 쪽으로 기운 것이다.
- `mkdir -p ~/.dflow`: 이벤트 기록이 디렉터리 부재로 조용히 실패하지 않게 한다.
- 공유 `info/exclude` 에 워커 부산물 패턴을 없을 때만 넣는다. 커밋하지 않는 로컬 설정이며 링크드
  워크트리가 모두 공유한다. `**/.claude/worktrees/` 는 두 백엔드의 팀원 워크트리다(`dflow-<id8>` —
  2026-09-24부터 Orca 도 `git worktree add` 로 이 자리에 만든다). `/dflow-*/` 는 **옛 방식**(`orca worktree
  create --name dflow-<id8>`)이 `.claude/worktrees/` 가 아니라 리포 루트 바로 아래에 만든 Orca 팀원 워크트리를
  가린다(2026-09-19 mdm-dict-v2 실측. 빼면 재기동 때 `DIRTY` 에 걸린다) — 새 방식에는 해당하지 않지만, 전환기에
  남은 옛 워크트리를 위해 패턴을 남긴다. `.vitest/` 는 워커가 vitest 를 돌리면 남기는 결과
  파일(`.vitest/json/output.json`)이다(빼면 done 뒤 워크트리가 깨끗하지 않아 「고아 정리 규칙」 과 정리 명령이
  실패한다. 2026-09-19 mdm-dict-v2 실측), `/.dflow-agent`·
  `**/tasks/*/.result`·`**/tasks/*/.issues`·`**/tasks/*/decisions.json` 은 워커가 쓰는 미추적 파일(decisions.json 은
  `done --decisions` 의 전송용으로, 커밋하지 않는다. 어느 `<TASKS>` 아래든 잡도록
  `docs/` 접두를 고정하지 않는다), `/docs/dflow-team/` 은 팀장이 쓰는
  문제 기록(「3. 결과 처리」 문제 기록) 폴더, `/.dflow-prompt`·`/.dflow-pane`·`/.dflow-run` 은
  팀장이 spawn 때 쓰는 미추적 파일, `/.dflow.local` 은 워크트리 부트스트랩이 거는 심링크다. `.gitignore` 가
  `.dflow.local` 을 가리기 전에도 DIRTY 를 트립하지 않게 여기 둔다. `.dflow` 는 **넣지 않는다** — 스펙 §3.1 대로
  커밋 대상이며, exclude 에 넣으면 아직 커밋되지 않은 `.dflow` 가 `git status`·`git add -A` 에서 조용히
  사라져 사람이 커밋을 잊고 다른 PC 가 `NO_DFLOW` 로 막힌다. `/.claude/skills`(끝 슬래시 없음)는 스킬 심링크다. 끝 슬래시가 붙은 패턴은 디렉터리에만 걸려 심링크를 가리지 못한다. 이 패턴은 **`.claude/skills`
  가 추적되지 않는 리포에서만** 넣는다. 스킬이 커밋된 리포에 넣으면 새로 추가하는 스킬 파일이 무시돼
  `git add` 가 거부되기 때문이다. 일반 스킬은 커밋하고 `dflow-*` 만 심링크인 리포에는 `/.claude/skills/dflow-*`
  를 넣는다. 이유: 부산물이 `/dflow-dev` Phase 06 의 "미커밋 잔여물 커밋" 에 섞이면,
  브랜치마다 다른 `.dflow-agent` 가 스윕 머지를 충돌시키고 절대경로 심링크가 main 에 들어간다.
- `DIRTY`: exclude 를 넣은 뒤 `git status --porcelain` 이 비어 있어야 한다. 팀장 체크아웃이 더러우면 승인
  스윕이 위험하다. 실패 안내에 "미커밋 `<TASKS>/*/state.json` 은 파일명을 명시해 먼저 커밋하라(수동
  `/dflow-dev` 가 남긴 것일 수 있다)" 를 넣는다.
- `UNTIL_BAD`·`UNTIL_PAST`·`UNTIL_TOO_FAR`: 종료 시각은 에포크 초로 비교한다(BSD `date -j` 먼저, 없으면 GNU
  `date -d`. macOS·Linux 서버 모두에서 돈다). 형식이 틀리거나, 이미 지났거나, 7일을 넘으면 거부한다. `none` 은
  검사하지 않는다. 「인자」 가 전제 검사 전에 이미 걸렀으므로 이 검사는 두 번째 방어선이다.
- 종료 파일(`dflow-team.stop`)은 잠금을 얻은 뒤 지운다. 이유: 지난 실행에서 마감 전에 죽은 팀장이 남긴 요청이
  새 팀장을 곧바로 멈추지 않게 한다. 잠금을 얻기 전에 지우면 돌고 있는 다른 팀장에게 보낸 요청을 지우게 된다.
- `LEGACY_REPORTED` 검사와 이 블록 전체는 bash 와 zsh 모두에서 돈다. state.json 은 glob 대신 `find` 로 찾고,
  결과를 변수로 받아 루프 밖에서 `bad` 를 부른다. 이유: zsh 는 매치 없는 glob 에서 블록 전체를 `FAIL` 줄 없이
  죽이고, bash 는 파이프 안의 `while` 을 서브셸에서 돌려 그 안에서 바꾼 `fail` 이 밖으로 나오지 않는다.
- `ORCA_OLD`: pane(Orca)이면 `orca terminal create` 가 `--worktree`·`--command` 를 지원해야 한다(2026-09-24부터
  — `git worktree add` + `orca terminal create` 조합을 쓰므로 이 확인으로 바꿨다. 옛 확인은 `orca worktree
  create` 의 `--agent`·`--prompt` 였다). tmux 를 찾지 못한 Orca 환경에서만 이 갈래로 온다.
- `NO_CLAUDE_CLI`: 두 백엔드 모두 팀원을 `.dflow-run` 의 `exec claude` 로 띄우므로 `claude` 가 PATH 에 있어야
  한다. 없으면 pane(Orca 는 탭)이 즉시 죽고 종료 코드 127 만 남아, 무엇이 없어서 죽었는지 화면에 남지 않는다.
- `NO_TMUX`: tmux 도 Orca 도 없으면 시작하지 않는다. 팀원을 대화형으로 띄울 수단이 없기 때문이다. 안내에
  설치 명령을 적는다(macOS `brew install tmux`, Debian·Ubuntu `apt install tmux`, Windows 는 MSYS2 또는
  WSL). 종전의 비대화형 프로세스 백엔드(`nohup claude -p`)는 2026-09-16 에 없앴다. 사람이 권한 확인에
  답하거나 화면을 보거나 `blocked` 를 맥락을 지킨 채 풀 자리가 없었기 때문이다.
- `find_tmux` 가 절대경로 후보를 훑는 이유: Orca 는 PATH 앞에 tmux shim 을 끼우는데, 그 shim 은 명령
  부분집합만 처리하고 `tmux -V` 에 거짓 버전을 답한다. 판별 방법은 backends.md 「진짜 tmux 찾기」 다.
