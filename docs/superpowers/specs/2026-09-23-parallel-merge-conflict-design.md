# 병렬 Task 머지 충돌 — 예방·해소·공회전 차단·표시 (과제 E)

- 작성: 2026-09-23
- 상태: 설계 초안(착수 전). 구현은 명시 지시 뒤에.
- 상위: `docs/idea.md` 「병렬 Task 머지 충돌」(43~51행)
- 원인 분석: [2026-09-21 병렬 머지 충돌 분석](../../agent/2026-09-21-parallel-merge-conflict-analysis.md)
- 관련: [강제 진행 설계](2026-09-23-force-progress-design.md) §3.4 스텁 규칙 ·
  [팀장 lease 설계](2026-09-23-dflow-lead-lease-design.md) §8 팀장 흐름 ·
  워커 자동 재시작 설계(H, `2026-09-23-worker-auto-restart-design.md`, 병행 작성 중)
- 사용자 결정(2026-09-23): 네 갈래(① 예방 · ② 해소 워커 · ③ 공회전 필터 · ④ 화면 표시)를 이 문서 하나에 담는다.
  **마이그레이션은 없다.**
- 반영 범위: staging 까지. main·dflow-kit 반영은 별도 지시.
- 행 번호는 2026-09-23 작성 시점(dflow-team `c1b64ac5`) 기준이다. 병렬 세션이 파일을 고치면 밀리므로 절 이름(「…」)을 함께 적는다.

## 1. 배경

2026-09-21 mdm-dict-v2 에서 팀장 두 명이 WP-03 을 동시에 돌렸다. 팀원 8명이 모두 `done` 했지만 6건이 개발 브랜치와
충돌해 자동 머지(`/dflow-merge --on-report`)가 하나도 머지하지 못했다. 그 뒤 의존 사슬 전체가 멈췄다.

| 층 | 무엇이 잘못됐나 | 근거 |
|---|---|---|
| 설계 | 계약 Task(TSK-03-01)의 공유 시험이 "라우트는 비어 있다"(`router.stack` 길이 0)와 "아직 스텁인 함수 목록"(`STUBS` 배열)을 파일 하나에 단정했다. 기능 Task 는 자기 일을 하는 순간 그 줄을 고쳐야 했고, 병렬 워커 다섯이 다섯 가지 방식(`IMPLEMENTED`·`FILLED`·`REGISTERED_ROUTES`…)으로 고쳤다 | 분석 「원인」 1·2 |
| 설계 | `src/server.js` import 블록 같은 공유 진입점에 각자 한 줄씩 더했다. 계약이 지정한 공용 헬퍼(`tests/helpers/app.js`)를 계약 Task 가 만들지 않아 기능 Task 셋이 각자 만들었다(add/add) | 원인 4·5 |
| 머지 | `/dflow-merge` 는 충돌하면 `git merge --abort` 후 "머지 실패(충돌)" 로 보고하고(`.claude/skills/dflow-merge/SKILL.md:202-207`), 팀장은 그것을 "사람이 머지해야 함" 으로만 넘긴다(`.claude/skills/dflow-team/SKILL.md:1095-1097`). 무인 실행에서는 아무도 풀지 않는다 | 원인 3 |
| 스케줄 | 서버 `reached` 는 선행이 `im`(완료 보고)이면 참이다(`src/lib/domain/agentWork.ts:19-23`). 팀장 사전 필터는 `reached=false` 만 거른다(`dflow-team/SKILL.md:954-965`). 선행 코드가 개발 브랜치에 없는데도 후속을 띄우고, 워커 행 G(`.claude/skills/dflow-dev/SKILL.md:310`)가 `skipped 선행 승인 대기` 로 끝낸다. 10주기(30분)마다 되풀이됐다 | 원인 3 |
| 표시 | 좌석표·오피스에 "머지 충돌" 상태가 없다. 사람은 팀장 보고를 읽어야만 안다 | 제안 4 |
| 의미 충돌 | 가드 Task(TSK-01-03)는 텍스트 충돌이 한 줄이었지만, 머지하면 먼저 들어온 라우트 시험 85건이 `401` 로 깨졌다. git 충돌 검사로는 잡히지 않는다 | 원인 6 |

사람이 푼 방법(분석 「해소 방법」)이 이 문서 해소 규약(§5.4)의 원형이다. 먼저 들어온 쪽 규약을 따르고, 양쪽이 뺀
스텁은 모두 빼고, 공유 진입점은 양쪽을 다 남기고, add/add 헬퍼는 하나로 합치고, 한 건씩 머지한 뒤 전체 시험을 돌렸다.

## 2. 결정

| # | 결정 | 이유 |
|---|---|---|
| E1 | 계약 Task 규칙에 **"기능 Task 는 공유 파일의 같은 줄을 고치지 않는다"** 를 넣고, 그 규칙을 **생성되는 계약 Task 의 acceptance 줄로 싣는다** | 계약 Task 를 구현하는 워커는 `/dflow-wbs` 를 읽지 않는다. 규칙은 Task 본문에 있어야 워커에게 닿는다 |
| E2 | 계약 Task 의 시험은 **틀이 있다**(export·시그니처·탑재 순서)만 단정하고 **비어 있다**(빈 라우터·스텁 목록)는 단정하지 않는다 | 빈 틀 단정은 기능 Task 가 반드시 깨야 하는 시험이다. 2026-09-21 충돌의 뿌리다 |
| E3 | 충돌 해소는 **새 해소 전용 워커**가 한다. 원래 워커를 다시 띄우지 않는다 | 원래 워커 세션은 `done` 뒤 끝났고 pane·워크트리도 거둬진다(`dflow-team/SKILL.md:1033,1050-1054`). `/dflow-dev --worker` 흐름(claim→Phase→done)은 `reported`·`approved` 주문에 맞지 않는다. 해소에는 다른 규칙이 필요하다(§5.2) |
| E4 | 해소는 **개발 브랜치 위의 머지 커밋 안에서** 한다. 해소 워커는 `origin/<개발브랜치>` 에 detach 한 자기 워크트리에서 `/dflow-merge --resolve <id8>` 를 돌리고, 충돌을 `--abort` 대신 해소 규약으로 푼 뒤 전체 시험을 통과하면 `HEAD:<개발브랜치>` 로 push 한다 | agent 브랜치를 건드리면 `/dflow-merge` 2단계 「승인 뒤 변경 확인」(`dflow-merge/SKILL.md:191-199`)이 다음 스윕에서 "건너뜀(승인 뒤 변경)" 을 낸다. rebase 는 force push 금지(같은 파일 「금지」)와 `merge-base --is-ancestor <head_sha>` 검사에 모두 걸린다. 머지 커밋 안의 해소는 사람이 손으로 풀던 현행 경로(202-207행의 직접 `git commit`)와 같은 모양이다 |
| E5 | 해소 재시도는 **해소 전용 카운터**(events.jsonl 의 `spawn_kind: "resolve"` 개수, 초기화 없음)로 세고 상한은 **3**이다 | 재개 카운터는 `team.result` 마다 0 으로 돌아간다(`dflow-team/SKILL.md:327-331` 의 awk). 해소 워커는 시도마다 `.result` 를 쓰므로 그 카운터로는 상한에 영영 닿지 않는다(§5.6) |
| E6 | 공회전 필터는 팀장이 워커 행 G 의 반영 확인을 **공용 스크립트로 뽑아 함께 쓴다**. 서버 `predecessorReached` 는 바꾸지 않는다 | 반영 여부는 git 사실이라 서버가 모른다. `reached` 의미를 바꾸면 claim 게이트·대기 사유·강제 진행 F2/F6 이 함께 흔들린다(§6.4) |
| E7 | 화면은 heartbeat phase 에 **`merge_conflict`** 값을 더해 표시한다. blocked+note 규약은 쓰지 않는다 | `heartbeat_phase` 는 CHECK 없는 text 다(`supabase/migrations/0094_agent_heartbeat.sql:6`) — 마이그레이션이 없다. `blocked` 는 워커의 결정 대기이고 팀장의 답 매칭(「6. blocked」)과 얽혀 있어 뜻을 섞으면 안 된다 |
| E8 | `merge_conflict` 는 **팀장이 대리로 쏜다.** heartbeat 라우트가 `reported`·`approved` 주문에 한해, 같은 PAT 계정에 `merge_conflict` 설정·해제만 받게 고친다 | 충돌은 `reported`·`approved` 주문에서 나는데 지금 라우트는 `claimed` 가 아니면 409 다(`src/app/api/v1/agent/work/[id]/heartbeat/route.ts:52-54`). 해소 워커는 주문을 점유하지 않는다 |
| E9 | `approved` 주문도 자동 해소한다. 해소 내용은 머지 커밋 본문과 Task 폴더의 `resolution.md` 에 남기고 스윕 보고에 따로 적는다 | 막아 두면 사람이 올 때까지 사슬이 멈춘다. 해소 내용이 승인 범위 밖이라는 점은 사람 손 머지 때도 같다. 사후 재검토 강제 여부는 미결 1 |
| E10 | 해소는 **이 신원의 주문만** 한다(`show` 의 `mine=true`) | 스윕은 모든 `origin/agent/*` 를 후보로 본다(`dflow-merge/SKILL.md:8`). 두 신원의 팀장이 같은 충돌을 동시에 풀면 안 된다. 같은 신원+프로젝트의 팀장은 lease 설계가 하나로 묶는다 |

## 3. 갈래 ① — 설계 단계 예방 (`/dflow-wbs`)

### 3.1 넣을 자리

- PRD 모드 계약 관례: `.claude/skills/dflow-wbs/SKILL.md:231-235` 「계약 전용 Task 관례」 바로 아래.
- 프로그램 리스트 모드 골격: 같은 파일 384-412행(골격 표와 depends 사슬, 412행 「의존 그래프 구조 예외」) 뒤.

두 모드의 계약 Task 가 같은 규칙을 따르도록, 본문은 한 곳(`### 계약 Task 의 공유 파일 규칙`, 412행 뒤)에 두고
231-235행 관례에는 "공유 파일 규칙은 아래 절을 따른다" 한 줄로 잇는다.

### 3.2 규칙

| # | 규칙 | 2026-09-21 대응 |
|---|---|---|
| C1 | **기능 Task 는 자기 소유 파일만 고친다.** 계약 Task 는 design.md 에 `## 기능 Task 편집 지점` 표(기능 Task → 소유 파일)를 두고, 두 기능 Task 가 같은 파일을 소유하지 않게 한다. 공유 파일은 이 표에 나오지 않아야 한다 | 원인 1·4 |
| C2 | **등록은 자동 수집한다.** 라우트·핸들러·마이그레이션 같은 목록은 디렉터리 스캔(`readdirSync`·glob)이나 파일 이름 관례로 모으고, 기능 Task 가 `server.js`·`routes/index.js` 의 import 블록이나 배열에 줄을 더하지 않게 한다 | 원인 4(`src/server.js` import 인접 줄) |
| C3 | **계약 시험은 틀의 존재만 단정한다.** export 가 있다, 시그니처가 맞다, 탑재 순서가 맞다는 단정한다. "라우터가 비어 있다"·"이 함수는 아직 `not implemented` 다" 는 단정하지 않는다 | 원인 1(`routes-mount.test.js` #2·#4, `domain-contracts.test.js` `STUBS`) |
| C4 | **스텁 판정은 각 함수의 시험이 스스로 한다.** 계약 Task 는 기능 Task 마다 자기 시험 파일(`tests/routes/<name>.test.*`)을 빈 틀(`it.todo`)로 만들어 둔다. 기능 Task 는 그 파일만 채운다. 공유 목록(`STUBS`·`IMPLEMENTED`)을 두지 않는다 | 원인 1·2(다섯 가지 방식) |
| C5 | **계약 문서가 지정한 파일은 계약 Task 가 모두 만든다.** 공용 시험 헬퍼(`tests/helpers/*`)가 대표다. 계약 Task acceptance 에 "계약 문서가 지정한 파일이 모두 있다" 를 넣는다 | 원인 5(add/add 헬퍼 세 판) |
| C6 | **횡단 관심사는 계약에서 먼저 연다.** 인증 가드처럼 모든 라우트 동작을 바꾸는 Task 가 있으면 계약 Task 가 시험 헬퍼에 가드 헤더를 처음부터 싣거나, 그 Task 를 기능 Task 들의 선행으로 건다 | 원인 6(의미 충돌 85건) |
| C7 | 공유 파일을 **먼저 들어온 쪽이 새 규약으로 바꾸지 않는다.** 규약이 필요하면 계약 Task 가 처음부터 정한다 | 제안 5 |

C1·C4 는 강제 진행 설계 §3.4 1번("공유 파일(등록 목록·`STUBS` 배열)의 같은 줄을 고치지 않는다")과 같은 방향이다.
그쪽은 스텁을 둘 **자리**(후행 소유 경로)를, 이쪽은 계약 Task 가 만드는 **시험·등록 구조**를 다룬다. 두 문서가
서로를 참조한다.

### 3.3 생성 산출물에 싣는 방법

`tags: contract` Task 를 만들 때 `acceptance` 끝에 아래 네 줄을 고정으로 붙인다(PRD 모드·프로그램 리스트 모드 공통).

```
- 공유 시험은 틀의 존재·탑재 순서만 단정한다. 빈 라우터·스텁 목록(`STUBS` 등)을 단정하지 않는다
- 기능 Task 마다 자기 시험 파일과 소유 파일을 design.md `## 기능 Task 편집 지점` 에 적고, 두 Task 가 한 파일을 나눠 갖지 않는다
- 등록(라우트·핸들러 목록)은 자동 수집이며 기능 Task 가 공유 진입점에 줄을 더하지 않아도 된다
- 계약 문서가 지정한 파일(공용 시험 헬퍼 포함)이 모두 있다
```

기능 Task(`dev`)의 `requirements` 에는 한 줄을 붙인다: `- 계약 Task design.md 「기능 Task 편집 지점」 의 자기 소유 파일만 고친다`.
이 줄들이 없으면 C1~C7 은 `/dflow-wbs` 문서 안에만 있고 워커에게 닿지 않는다.

`## 의존 그래프` 챕터의 자기 리뷰 게이트에 한 항목을 더한다: 계약 Task 의 acceptance 에 위 네 줄이 있는가.

## 4. 갈래 ② 전체 흐름

```
스윕(/dflow-merge [--on-report]) ─ 충돌 ─→ "머지 실패(충돌) <파일…>"
   │
팀장: mine 인가? 해소 시도 < 3 인가? 진행 중 해소가 없는가?
   ├─ 예 → heartbeat merge_conflict("해소 중 w<slot> 1/3") → 해소 큐(재개 다음, 새 작업보다 먼저)
   └─ 아니오 → heartbeat merge_conflict("사람 머지 필요: …") → "사람이 머지해야 함" 보고
   │
해소 워커(새 세션, 워크트리 = origin/<개발브랜치> detached)
   /dflow-merge --resolve <id8> [--on-report]
   ├─ 해소 규약 적용 → 게이트(기준선 대비 신규 실패 0) → push HEAD:<개발브랜치> → resolved
   ├─ 판단 불가 → blocked (머지는 워크트리에 멈춘 채 둔다)
   └─ 시험 실패·push 경합 소진 → failed <사유>
   │
팀장 결과 처리: resolved → 머지 커밋이 origin/<개발브랜치> 의 조상인지 확인 → heartbeat 해제 → 선행 계열 일시 제외 해제 → 스윕
```

## 5. 갈래 ② — 충돌 해소 워커

### 5.1 `/dflow-merge` 변경

1. **충돌 파일 보고**: 3단계(202행) 충돌 때 `git merge --abort` **전에**
   `git diff --name-only --diff-filter=U` 를 읽어 보고 줄을 `머지 실패(충돌) <파일,…>` 로 낸다. 6단계 보고 표(286-290행)의
   따로 적는 칸에 이 파일 목록을 싣는다. 수동 사용자도 같은 보고를 받는다.
2. **`--resolve <ref>`(팀장이 띄운 해소 워커 전용)**: 새 플래그다. description 사용법에 노출하지 않는다(`--on-report` 와 같은
   취급, 10행). ref 는 정확히 하나다. 플래그가 있으면:
   - 1·2단계(후보 식별·승인 판정·승인 뒤 변경 확인)는 그대로 한다. `--on-report` 가 함께 오면 그 판정도 그대로다.
   - 4단계 **머지 자리**는 호출한 워크트리 자신이다. 이 워크트리는 `origin/<기본브랜치>` 에 detach 돼 있어야 하며 아니면
     `failed not-detached` 로 멈춘다. 임시 머지 워크트리 `<MAIN>/.claude/worktrees/dflow-merge` 는 쓰지 않는다. 팀장
     스윕의 임시 워크트리와 경로가 겹치기 때문이다. push 는 `git push origin HEAD:<기본브랜치>` 다.
   - 머지 명령은 `git -c rerere.enabled=true merge --no-ff …` 다. rerere 를 설정 파일에 켜지 않는 이유: 워크트리의
     `git config` 는 공용 `.git/config` 에 써져 사람 체크아웃까지 바뀐다. rerere 기록(`rr-cache`)은 공용 디렉터리에 남아
     push 경합 뒤 재머지와 다음 시도가 같은 해소를 다시 쓴다.
   - 3단계에서 충돌하면 `--abort` 하지 않고 해소 규약(§5.4)을 적용한다. 판단 불가면 `blocked` 로 멈춘다.
   - 충돌이 없었어도 **게이트를 돈다**(§5.5). 의미 충돌은 텍스트 충돌 없이 온다(분석 원인 6).
   - 머지 커밋 메시지는 기존 형식에 트레일러 하나를 더한다:
     `-m "merge: <TSK> <제목> (approved|reported, 승인 전) — 충돌 해소" -m "DFlow-Order: <order>" -m "DFlow-Resolve: <시도 번호>/3"`.
     해소한 머지는 충돌이 난 상태에서 `git commit` 으로 완성하므로 트레일러는 `git commit --trailer` 로 붙인다(236행
     「트레일러 고정」 의 손 머지 규칙과 같다).
   - 4단계의 state.json `phase=merged` 커밋은 그대로 한다. 머지 커밋과 이 커밋 사이에 게이트를 돌지 않는다(게이트는
     머지 커밋 직후, state.json 커밋 전에 한 번).
   - 5단계 push 가 경합(`non-fast-forward`)이면 `git reset --keep <기록한 HEAD>` 뒤 `git fetch` → 새 `origin/<기본브랜치>` 로
     detach → 1단계부터 다시 한다. rerere 가 앞서 푼 덩어리를 되살린다. **이 재시도는 한 세션 안에서 2회까지**이며,
     넘으면 `failed push-race` 다. 훅 거부는 우회하지 않고 `failed push-hook` 이다.
3. 플래그 없는 수동 사용과 팀장 스윕의 동작은 1번(파일 목록)만 바뀐다. 스윕은 여전히 `--abort` 한다.

### 5.2 해소 워커 — 새 워커로 띄운다

| 비교 | 원래 워커 재사용 | 새 해소 워커(채택) |
|---|---|---|
| 세션 | `done` 뒤 이미 끝났고 tmux pane 은 거둬졌다(`dflow-team/SKILL.md:1050-1054`). 대화 문맥을 되살릴 길이 없다 | 새로 띄운다 |
| 워크트리 | agent 브랜치 위다. 해소는 개발 브랜치 위의 머지 커밋에서 해야 한다(E4) | `origin/<개발브랜치>` detached 로 새로 만든다 |
| 프롬프트 | `worker-prompt.md` 는 `/dflow-dev --worker` 를 돌린다. claim·progress·done 이 `reported`·`approved` 주문에서 모두 실패한다 | 전용 `resolve-prompt.md` |
| 이 Task 의 설계 의도 | 브랜치의 `<TASK_DIR>/design.md` 에 있다 | 같은 파일을 읽는다. 문맥 차이가 없다 |
| 상대편 의도 | 모른다 | 충돌 파일을 먼저 바꾼 개발 브랜치 쪽 Task 의 design.md 를 `git log` 로 찾아 읽는다 |

그래서 **"원래 워커 재사용" 은 실제로는 "같은 Task 폴더를 읽는 새 세션"** 이며, 그렇다면 해소에 맞는 규칙을 가진 새
워커가 낫다.

### 5.3 해소 워커 프롬프트 — `references/resolve-prompt.md`(신규)

`worker-prompt.md` 와 같은 포인터 한 줄 방식이다. 팀장이 넘기는 키:

| 키 | 뜻 |
|---|---|
| `TSK`·`ID8`·`ORDER` | 대상 작업. `ORDER` 는 전체 UUID |
| `AGENT_ID` | `<신원>/<host>/w<slot>` |
| `MAIN_CHECKOUT`·`MODEL`·`DEV_BRANCH`·`TASK_DIR` | `worker-prompt.md` 와 같다 |
| `ATTEMPT` | 이번 시도 번호(1~3) |
| `ON_REPORT` | 팀장이 `AUTOMERGE_ON` 이면 `1`. `/dflow-merge` 에 `--on-report` 를 붙인다 |

절차:

1. **격리 확인·git 호출 규칙**: `worker-prompt.md` 「0」·「1」 을 그대로 따른다(파일을 읽어 그 절만 적용).
2. **부트스트랩**: `.claude/skills/dflow-dev/scripts/deps.sh`. 실패하면 `failed deps`.
3. **기준선**: 해소 전 `origin/<DEV_BRANCH>` 에서 dev-discipline 「게이트 기준선」 대로 전체 시험을 1회 돌려 기록하고, 그때의 sha
   `<BASE>` 를 함께 적는다. 게이트는 반드시 `<BASE>` 위에 만든 머지를 판정해야 한다.
4. **해소 머지**: `/dflow-merge --resolve {ID8}` (+ `--on-report`). 이 스킬 4단계 1번의 fetch 뒤 `origin/<DEV_BRANCH>` 가
   `<BASE>` 와 다르면 그 sha 로 다시 detach 하고 3번 기준선을 다시 잰 뒤 머지한다(기준선과 머지 기점이 어긋나면 게이트가
   개발 브랜치의 새 실패를 해소 탓으로 돌리거나 그 반대가 된다). 이 스킬이 2단계에서 건너뛰면(승인 뒤 변경·반려·이미 머지됨
   등) 해소하지 않고 `skipped <그 사유>` 로 끝낸다.
5. **서버 쓰기 없음**: claim·progress·done·heartbeat 를 하지 않는다. 조회는 `show {ID8}` 뿐이다. 특히 `worker-prompt.md` 의
   blocked 직전 `dflow.sh heartbeat --phase blocked` 를 **보내지 않는다** — 주문이 `claimed` 가 아니라 409 다. 좌석 표시는
   팀장이 `merge_conflict` 로 대신한다(§7).
6. **기록**: 해소한 파일마다 적용한 규약 번호와 판단을 `{TASK_DIR}/resolution.md` 에 시도 절(`## 시도 N`)로 덧붙이고
   머지 커밋에 함께 담는다. 머지 커밋 본문 둘째 문단에 요약(충돌 파일 수·규약 번호)을 둔다.
7. **`.issues`**: `worker-prompt.md` 「7-1」 과 같다. phase 칸은 `resolve` 다.
8. **`.result`**: §5.7 형식.

AskUserQuestion 을 쓰지 않는 것, 권한 거부 처리, 중단(exit 10 — 해소 워커는 서버를 부르지 않으므로 사실상 오지 않는다)은
`worker-prompt.md` 「6」 을 따른다.

### 5.4 해소 규약

원칙: **양쪽 기능을 모두 살린다.** 한쪽 변경을 버리는 해소는 아래 R3·R4 가 명시한 경우뿐이다. "개발 브랜치 쪽" 은
먼저 머지된 쪽(`HEAD`), "이 브랜치 쪽" 은 해소 대상 agent 브랜치(`MERGE_HEAD`)다.

| # | 충돌 모양 | 해소 |
|---|---|---|
| R1 | 등록 목록·import 블록·배열·라우트 표에 양쪽이 항목을 더함 | 양쪽 항목을 모두 남긴다. 개발 브랜치 쪽 순서를 유지하고 이 브랜치 항목을 뒤에 둔다. 중복은 하나로 |
| R2 | "아직 비어 있어야 할 것" 목록(`STUBS` 등)에서 양쪽이 서로 다른 항목을 뺌 | **어느 쪽이든 뺀 항목은 모두 뺀다.** 한쪽 줄을 남기면 이미 구현된 함수에 "스텁이어야 한다" 를 단정하게 된다(분석 「해소 방법」) |
| R3 | 같은 목적을 서로 다른 방식으로 품(`IMPLEMENTED` vs `REGISTERED_ROUTES`) | **개발 브랜치에 먼저 들어온 방식을 따른다.** 이 브랜치의 항목을 그 방식으로 다시 쓰고, 이 브랜치가 새로 만든 상수·함수는 걷어낸다 |
| R4 | 같은 경로에 양쪽이 새 파일을 만듦(add/add) | 개발 브랜치 판을 정본으로 둔다. 이 브랜치의 호출부를 그 판에 맞춘다. 이 브랜치에 꼭 필요한 기능이 정본에 없으면 **기존 호출부가 깨지지 않는 하위 호환 확장**만 한다(인자 추가·반환 필드 추가) |
| R5 | 텍스트 충돌 없이 시험이 깨짐(의미 충돌. 예: 가드가 들어와 헤더 없는 요청이 401) | 원인이 개발 브랜치 쪽 횡단 변경이면 **이 브랜치 쪽 시험·코드를 그 규약에 맞춘다.** 이미 머지된 다른 Task 의 시험이 깨지면 공용 헬퍼를 더해 호출부를 바꾸지 않고 고치는 방식(분석의 `role-fetch.js`)만 허용한다 |
| R6 | lockfile | 개발 브랜치 판을 받고 패키지 관리자로 다시 만든다(`npm install --package-lock-only` 등). 이 브랜치가 더한 의존만 다시 반영한다 |
| R7 | Task 폴더(`<TASKS>/<TSK>/*`) | 이 Task 폴더는 이 브랜치 판, 다른 Task 폴더는 개발 브랜치 판 |
| R8 | 설명 문서·주석 | 양쪽 문장을 모두 살려 합친다 |

**blocked 로 멈추는 경우**(판단 불가):
- 양쪽 기능을 모두 살리는 해소가 없다(한쪽 동작을 바꿔야만 통과).
- 다른 Task 의 공개 계약(API 모양·DB 스키마·이벤트 페이로드)을 바꿔야 한다.
- 마이그레이션 파일이 충돌하거나 번호가 겹친다(적용 이력과 얽혀 번호를 다시 매길 수 없다).
- 시험을 지우거나 `skip` 하거나 기대값을 느슨하게 해야만 통과한다(R2·R3 의 목록 정리는 예외 — 그것은 단정 대상을 바로잡는 것이다).
- 이미 머지된 다른 Task 의 소유 파일을 R5 범위를 넘어 고쳐야 한다.

**금지**: 시험 삭제·`skip`·기대값 완화로 게이트 통과, agent 브랜치 수정·force push, 훅 우회.

### 5.5 게이트

dev-discipline 「게이트 기준선」 과 같은 판정이다. 기준선은 해소 전 `origin/<DEV_BRANCH>`(3번), 판정은 해소 머지 커밋이다.
**기준선 대비 신규 실패 0 + 시험 총수가 기준선 이상**이면 통과. 실패하면 머지를 `git reset --keep` 로 버리고 `failed gate <실패 수>` 다.
빌드·린트·타입 검사는 대상 리포 기준선 명령에 들어 있으면 같이 본다.

push 경합 재시도(§5.1 2번)로 다시 머지했으면 게이트도 다시 돈다. 기준선도 새 `origin/<DEV_BRANCH>` 에서 다시 잰다.

### 5.6 재시도 상한과 루프 방지

카운터 — 팀장 체크아웃·신원·id8 로 거른 `team.spawn` 중 `spawn_kind == "resolve"` 인 줄의 개수. **초기화하지 않는다.**
```bash
jq -r --arg a '<신원>/<host>/lead' --arg r '<MAIN>' --arg i '<id8>' \
  'select(.agent == $a and .repo == $r and (.id8 // "") == $i and .event == "team.spawn" and (.spawn_kind // "new") == "resolve") | .id8' \
  ~/.dflow/events.jsonl 2>/dev/null | wc -l | tr -d ' '
```

| 규칙 | 이유 |
|---|---|
| 상한 3. 3회 뒤에는 사람 몫 | 해소가 세 번 실패하면 규약으로 풀 모양이 아니다 |
| `blocked`·`failed gate`·`failed push-hook`·`failed permission`·`failed deps` 뒤에는 재시도하지 않는다 | 같은 입력이면 같은 결과다. 사람이 원인을 고쳐야 한다 |
| `failed push-race`·`failed rate-limit`·`failed no-result` 뒤에만 다음 스윕 충돌 때 재시도한다 | 원인이 해소 내용 밖이다 |
| `resolved` 뒤 다음 스윕에서 또 충돌하면, `resolved` 사유의 `base=<sha>` 와 지금 `origin/<개발브랜치>` 가 **같을 때는 재시도하지 않는다** | 개발 브랜치가 그대로인데 또 충돌이면 해소 결과가 push 되지 않은 결함이다. 되풀이하면 무한 루프다 |
| 진행 중 해소가 있는 id8(슬롯 표)은 다시 띄우지 않는다 | 스윕이 도는 동안 같은 id8 이 계속 충돌로 보고된다 |
| **동시 해소 워커는 `max(1, ⌊인원/2⌋)` 까지**다. `blocked` 로 답을 기다리는 해소 워커도 센다. 넘치는 충돌은 해소 큐에 남긴다 | 해소가 새 작업보다 앞서고 `blocked` 해소 워커는 슬롯을 쥔다. 상한이 없으면 충돌이 많은 밤에 슬롯 전부가 사람을 기다리며 선다(2026-09-21 은 충돌 6건, 슬롯 4개) |

**재개 카운터·H 카운터와 가르는 이유**:
- 재개 카운터(`dflow-team/SKILL.md:327-331`)는 마지막 `team.result` 이후의 `resume` 줄만 센다. 해소 워커는 시도마다
  `.result` 를 쓰므로 그 방식이면 매번 0 으로 돌아가 상한이 동작하지 않는다.
- H(워커 자동 재시작)의 카운터(events.jsonl, 상한 3)는 **죽은 세션**을 겨냥한다. 해소 실패는 **내용**의 실패다. 한 카운터를
  나눠 쓰면 한쪽 실패가 다른 쪽 예산을 먹는다.
- 해소 워크트리는 고아 스캔의 "재개 가능"(`dflow-team/SKILL.md:313-320`)에 걸리지 않는다. 그 조건은 브랜치가
  `agent/<id8>-…` 이고 서버가 `status=claimed` 여야 하는데, 해소 워크트리는 detached 이고 주문은 `reported`·`approved`
  다. 그래서 H 의 재시작 경로는 해소 워커를 건드리지 않는다. 해소 워커가 결과 없이 죽으면(`failed no-result`) 해소
  카운터 한 번으로 세고, 다음 스윕 충돌 때 해소 경로로만 다시 띄운다. H 설계 문서에 이 제외를 한 줄 적어 달라고 요청한다.

두 카운터가 같은 `events.jsonl` 을 쓰는 것은 괜찮다. `spawn_kind` 값이 달라 섞이지 않는다.

### 5.7 결과 줄

형식은 `worker-prompt.md` 「7」 과 같다: `{TSK} {ID8} <branch|-> <head|-> <done_exit|-> <status> <사유>`.
해소 워커는 `branch` 칸에 `-`, `head` 칸에 push 한 개발 브랜치 머지 커밋의 짧은 sha(아니면 `-`), `done_exit` 은 `-` 를 쓴다.
`branch` 칸에 특별한 값을 넣지 않는 이유: 팀장 결과 표는 그 칸을 브랜치 이름으로 읽는다(`skipped` 행의 "branch 가 `-` 면
부트스트랩 실패 정리 규칙"). 해소 결과인지는 슬롯 표의 `spawn_kind` 로 가른다.

| status | 언제 | 사유 |
|---|---|---|
| `resolved` | 해소(또는 충돌 없이 머지) + 게이트 통과 + push 성공 | `base=<해소 기준 origin 개발브랜치 짧은 sha> files=<충돌 파일 수> rules=<R번호,…> tests=<통과/총수>`. 충돌이 없었으면 `files=0` |
| `skipped` | `/dflow-merge` 가 해소 전에 건너뜀(이미 머지됨·반려·승인 뒤 변경 등) | 그 보고 문구 |
| `blocked` | §5.4 판단 불가 | 질문과 선택지 한 줄 |
| `failed <사유>` | `gate`·`push-race`·`push-hook`·`not-detached`·`deps`·`permission`·`rate-limit` | 첫 낱말이 팀장이 구분하는 값 |

`blocked` 는 워커와 같이 세션을 세운 채 답을 기다린다(「6. blocked」 의 답 매칭 그대로). 해소 중이던 머지는 해소 워크트리에
멈춘 채 남는다. 팀장 체크아웃은 건드리지 않으므로 팀장의 전제 검사는 깨지지 않는다.

## 6. 갈래 ③ — 공회전 사전 필터

### 6.1 대상

필터가 새로 거르는 것은 **워커 행 G 갈래 2 에서 확정 skip 되는 경우 하나**다: 선행이 `reached=true` 인데
`head_sha` 가 없고(완료 보고 뒤 승인 전, 자동 머지 운영의 보통 모양) 개발 브랜치에 반영되지 않았다.

- `head_sha` 가 있는 선행(승인됨)은 **거르지 않는다.** 워커 행 B 가 그 `head_sha` 에 스택해 진행한다(`dflow-dev/SKILL.md:305`).
  거르면 진행할 수 있는 작업을 막는다.
- `state.json` 의 `phase=merged` 로 거르지 않는다는 기존 문장(`dflow-team/SKILL.md:960`)과 그 시험
  (`tests/skills/dflow-team-depends-precheck.test.ts` 마지막 it)은 그대로 둔다. 새 필터는 `phase` 하나가 아니라 행 G 의
  세 증거를 모두 보고, 대상도 `head_sha` 없는 선행으로 좁혀 있다. 위 문장 뒤에 "단, 행 G 갈래 2 의 반영 확인은 사전에
  한다(아래)" 를 잇는다.

### 6.2 공용 스크립트 — `.claude/skills/dflow-dev/scripts/pred-reflected.sh`(신규)

행 G 의 반영 확인(`dflow-dev/SKILL.md:313-357` 의 세 증거)을 스크립트로 뽑는다. 워커와 팀장이 같은 판정을 쓴다.

```
pred-reflected.sh <TASKS> <선행TSK> <DEV_BRANCH>      # cwd = 리포(워크트리) 루트. 호출 전에 git fetch origin 을 한다
```

| 출력 첫 낱말 | exit | 뜻 |
|---|---|---|
| `REFLECTED <증거 1|2|3>` | 0 | `phase=merged` AND 세 증거 중 하나 |
| `NOT_REFLECTED <사유>` | 1 | `origin/<DEV>:<TASKS>/<선행TSK>/state.json` 이 없음, `phase` 가 `merged` 아님, 증거 전부 거짓 |
| `UNKNOWN <사유>` | 2 | 인자 오류, `origin/<DEV>` 가 없음, git 실행 실패 |

- 스크립트 안에서 git 을 부르는 것은 `deps.sh` 가 이미 하는 방식이다. 워커 git 호출 규칙(명령 치환 금지)은 워커가
  직접 치는 Bash 줄에 대한 것이다.
- 워커 행 G 본문은 세 증거 설명과 이유를 남기고, 실행은 이 스크립트 한 줄로 바꾼다. `NOT_REFLECTED`·`UNKNOWN` 모두
  `skipped 선행 승인 대기` 다(지금 동작과 같다).

### 6.3 팀장 필터

1. show 필터(`dflow-team/SKILL.md:944-950`)에 한 칸을 더한다.
   ```
   deps_nohead: [.depends_evidence[]? | select(.reached == true and ((.head_sha // "") == "")) | .external_ref]
   ```
2. `deps_unmet` 이 비었고 `deps_nohead` 가 비어 있지 않으면 **여기서** `dflow.sh taskdir <order>` 로 `TASK_DIR` 을 구한다.
   지금은 5번 spawn 3번(1127행)에서 구하는데, 필터가 그보다 앞서야 한다. 구한 값은 spawn 3번이 다시 쓴다(두 번 부르지
   않는다). taskdir 실패는 지금과 같이 `작업 폴더 해석 실패(exit N)` 로 일시 제외다.
3. 기상마다 `git fetch origin` 을 한 번 하고, `deps_nohead` 의 선행마다
   `pred-reflected.sh "$(dirname <TASK_DIR>)" <선행TSK> <DEV>` 를 부른다.
   - 하나라도 `NOT_REFLECTED` → 띄우지 않는다. 사유 `선행 미반영(사전 검사: <ref…>)`, 일시 제외, `team.result`(slot `-`,
     status `skipped`). 그 선행이 해소 큐·해소 슬롯에 있으면(TSK 로 대조) 사유를 `선행 미반영(머지 충돌 해소 중: <ref>)` 로
     쓴다. 두 문구 모두 「선행」 으로 시작해 일시 제외 해제의 선행 계열에 든다.
   - `UNKNOWN` → 거르지 않고 워커에 맡긴다. 기존 사전 검사의 "판정 불가를 미충족으로 단정하지 않는다"(958-960행)와 같다.
4. 일시 제외 해제(1102-1113행)의 조건을 넓힌다: 스윕이 **"머지됨(승인 전)"·"머지됨"·해소 워커 `resolved`** 중 하나라도
   냈으면 선행 계열 일시 제외(여기에 `선행 미반영` 을 더한다)를 푼다. 지금은 자동 머지의 "머지됨(승인 전)" 만 본다.

효과: 공회전이 "30분마다 팀원 세션 하나" 에서 "30분마다 git 명령 몇 줄" 로 준다. poll 의 10주기 해제는 그대로다.

### 6.4 서버(`predecessorReached`)를 고치지 않는 이유

| 이유 | 내용 |
|---|---|
| 서버는 git 을 모른다 | 반영 여부는 대상 리포의 개발 브랜치 사실이다. 서버에 알리려면 팀장이 "반영됨" 을 보고하는 새 열·새 이벤트가 필요하다 — 마이그레이션이다 |
| `reached` 는 다섯 관문의 공통 판정이다 | claim 게이트·대기 사유·WBS 착수 판정·unblocked 알림이 같은 함수를 쓴다(`agentWork.ts:15-18` 주석). "개발 브랜치 반영" 으로 바꾸면 git 과 무관한 사람 Task 선행이 영영 풀리지 않는다 |
| 강제 진행 설계와 어긋난다 | 그 설계 F2·F6 은 "`im` 이면 이미 도달" 에 기대 후속 체인을 풀어 둔다 |
| 워커 판정이 이미 있다 | 행 G 가 git 으로 판정한다. 같은 판정을 한 발 앞(팀장)으로 옮기면 충분하다 |

## 7. 갈래 ④ — 화면 표시

### 7.1 누가 쏘는가

팀장이 대리로 쏜다. 해소 워커는 서버를 부르지 않는다(§5.3 5번).

| 시점 | 호출 |
|---|---|
| 스윕이 `머지 실패(충돌)` 을 냄 + 해소 큐에 넣음 | `dflow.sh heartbeat <id8> --phase merge_conflict --note "충돌 <파일 수>개(<첫 파일>…) · 해소 대기 1/3"` |
| 해소 워커 spawn | 같은 호출, note `해소 중 w<slot> <n>/3` |
| 해소 워커 `blocked` | note `해소 결정 대기: <질문>` |
| 상한 초과·재시도 불가 결과 | note `사람 머지 필요: <사유>` |
| 해소 워커 `resolved` 결과 처리. 먼저 `git fetch origin && git merge-base --is-ancestor <결과 줄 head> origin/<개발브랜치>` 가 참인지 본다 | `dflow.sh heartbeat <id8> --clear-merge-conflict`(아래). 거짓이면 해제하지 않고 "해소 push 확인 불가" 로 보고한다 |
| 사람이 손으로 머지함 — 다음 기상에 팀장이 충돌 목록의 id8 마다 `pred-reflected.sh` 로 그 Task 가 개발 브랜치에 반영됐는지 본다 | 반영(`REFLECTED`)이면 같은 해제 |

해제를 스윕 보고에 기대지 않는 이유: 해소 워커가 머지하면 `/dflow-merge` 5단계 뒷정리가 원격 agent 브랜치를 지워, 다음
스윕에서 그 주문은 원격 후보가 아니다. 로컬 state.json 이 `merged` 라도 자동 머지분은 "승인 대기(머지됨)", 승인분은 아예
줄이 나오지 않는다. 스윕의 "머지됨" 을 기다리면 표시가 영영 남는다.

- `--agent` 는 `<신원>/<host>/lead` 다. 실패(exit 4·6 등)해도 팀장을 멈추지 않고 보고에 한 줄 적는다. 표시는 부가 기능이다.
- `dflow.sh heartbeat` 에 `--clear-merge-conflict` 를 더한다. 본문 `{agent, phase: null, clear: "merge_conflict"}` 을 보낸다.
- 팀장 SKILL.md 「금지」 의 "팀장이 작업을 claim·progress·done 하는 것"(1418행) 뒤에 예외를 한 줄 더한다: **머지 충돌 표시
  heartbeat(`merge_conflict` 설정·해제)는 팀장이 한다.** 주문 상태를 바꾸지 않고 표시 열만 쓴다.

### 7.2 heartbeat 라우트 변경 (`src/app/api/v1/agent/work/[id]/heartbeat/route.ts`)

| 주문 status | 받는 phase | 쓰는 열 |
|---|---|---|
| `claimed` | 지금과 같다(`HEARTBEAT_PHASES`). `merge_conflict` 는 400 | 지금과 같다 |
| `reported`·`approved` | `merge_conflict`(note 필수) 또는 `clear: "merge_conflict"` 만. 그 밖은 지금처럼 409 `conflict` | `heartbeat_phase`·`heartbeat_note` **둘만**. `last_heartbeat_at`·`updated_at`·`heartbeat_agent`·`resume_requested_*` 는 건드리지 않는다 |
| `cancelled` | 지금과 같다(409 `cancelled`) | — |
| `ready` | 409 | — |

- **PAT 전용**이다. 레거시 시크릿 principal 이 `merge_conflict` 를 보내면 400 `identity_required`. 레거시 소유 판정은
  `claimed_by === agentLabel` 이라 팀장 라벨로는 통과하지 않는다.
- 소유 판정은 지금 PAT 규칙 그대로다(`claimed_by_user_id === actor.userId`). `report` 가 `claimed_by_user_id` 를 지우지 않으므로
  (0097 `apply_workflow_event` 의 else 갈래는 `status` 만 바꾼다) 같은 계정의 팀장이 통과한다.
- 해제는 현재 값이 `merge_conflict` 일 때만 null 로 바꾼다(`.eq('heartbeat_phase', 'merge_conflict')`). 다른 값을 지우지 않는다.
- `updated_at` 을 건드리지 않는 이유: 승인분 좌석은 `updated_at` 7일 창으로 고른다(`src/lib/data/agentSeatmap.ts:44`). 표시가
  창을 늘리면 안 된다. `heartbeat_agent` 를 건드리지 않는 이유: 좌석 에이전트 이름이 `heartbeat_agent ?? claimed_by` 라
  (`src/lib/domain/seatmap.ts:180`) 팀장 라벨로 바뀐다.
- `heartbeat_note` 저장 조건(route:70, 지금 `phase === 'blocked'` 만)을 `blocked`·`merge_conflict` 로 넓힌다.
- 0094 의 컬럼 comment(10-11행)는 값 목록이 낡게 되지만 comment 수정은 마이그레이션이라 하지 않는다. 정본 값 목록은
  `seatState.ts` 다.

### 7.3 도메인 (`src/lib/domain/seatState.ts`, `seatmap.ts`)

- `Phase` 타입(4행)에 `'merge_conflict'` 를 더한다. `HEARTBEAT_PHASES`(14행)에는 넣지 않고 `LEAD_PHASES = ['merge_conflict']`
  를 따로 둔다. 라우트는 status 에 따라 둘 중 하나로 검증한다. `inferPhase`(61-70행)는 두 목록 모두를 인정한다.
- `deriveSeatState` 는 바꾸지 않는다. 좌석 상태는 `WAIT`(reported)·`DONE`(approved)로 남고, 머지 충돌은 **phase 로만** 드러난다.
  새 `SeatState` 를 만들지 않는 이유: 상태 값은 레인·카운터·스프라이트·CSS 전체에 퍼져 있고, 주문의 실제 상태는
  여전히 승인 대기·승인됨이다.
- `toSeat` 의 `note`(`seatmap.ts:190`)를 `blocked`·`merge_conflict` 일 때 싣게 넓힌다.
- 확인 필요 띠(`seatmap.ts:335-344`): DONE 을 건너뛰는 검사(337행) **앞에서** `heartbeatPhase === 'merge_conflict'` 인
  좌석을 먼저 넣는다. `why` 는 `머지 충돌 · <note>`. 정렬은 BLOCKED 바로 뒤. `Attention.state` 는 그대로 좌석 상태를 싣는다.
- 후속 좌석의 대기 사유(선택, 같은 PR): `waitReason` 은 서버 재료로만 판정한다(`waitReason.ts:3`). 선행 주문의
  `heartbeat_phase` 를 선행 조회(`agentSeatmap.ts:74-87`)에 함께 읽어, 선행이 `merge_conflict` 이면 `pickup` 대신 새 kind
  `merge_conflict`(`선행 머지 충돌` · "선행 <code> 가 개발 브랜치와 충돌해 머지 대기 중입니다. 해소되면 자동으로 착수합니다")를
  낸다. claim 게이트 판정과 다른 말을 하는 것이 아니라(게이트는 통과한다) 팀장 필터가 거르는 이유를 보여 주는 것이다.

### 7.4 컴포넌트

| 파일 | 변경 |
|---|---|
| `src/components/agents/PhaseBadge.tsx` | `PHASE_LOOK` 에 `merge_conflict: { label: '머지 충돌', color: <빨강 계열과 구분되는 자홍>, icon: 갈라진 화살표 }`. `seatPhaseKey` 는 WORKING 검사(26행) **앞에서** `seat.phase === 'merge_conflict'` 면 그 키를 돌려준다 — WAIT·DONE 좌석에도 말풍선이 달린다. 네 점(단계 위치)은 달지 않는다(순서 밖 상태) |
| `src/components/agents/RosterBoard.tsx` | `PHASE_KO`(254행)에 `merge_conflict: '머지 충돌'`. 346행 `단계 …` 표시는 그대로 이 표를 쓴다 |
| `src/components/agents/DetailPanel.tsx` | `seat.state === 'BLOCKED' && seat.note` 인용(96행) 옆에 `seat.phase === 'merge_conflict' && seat.note` 인용을 더한다. 문구 앞에 "머지 충돌: " |
| `LaneBoard`·`Seat`·CSS | 바꾸지 않는다. 좌석은 승인 대기·완료 레인에 그대로 있고 말풍선만 붙는다 |

`src/components/agents/*` 는 CLAUDE.md 의 UI 위험 파일이다. 브랜치로 작업하고 staging 에서 눈으로 확인한다.

## 8. 팀장 흐름 변경점 (`dflow-team/SKILL.md`)

| 절 | 변경 |
|---|---|
| 「팀장 상태」 290·316행 최종 판정 목록 | `resolved` 를 더한다 |
| 「팀장 상태」 재구성 | `spawn_kind == "resolve"` 인 `team.spawn` 도 슬롯으로 잇는다. 해소 워크트리 경로는 `<MAIN>/.claude/worktrees/dflow-<id8>-resolve` |
| 「2-3」 기상 순서 4번 | spawn 우선순위: 재개 → **해소** → 대기 큐. 해소가 막힌 후속 전체를 풀기 때문이다 |
| 「2-3」 poll exit 0 행·show 필터·선행 사전 검사 | §6.3 |
| 「3. 결과 처리」 status 표(1031행~) | 행 추가: `resolved`(슬롯 해제·워크트리 정리·§7.1 의 조상 확인 뒤 heartbeat 해제·선행 계열 일시 제외 해제·**곧바로 승인 스윕**), 해소 워커의 `blocked`(워커 blocked 와 같되 heartbeat 는 `merge_conflict` note), 해소 워커의 `failed …`(§5.6 재시도 가능 여부로 갈라 보고), 해소 워커의 `skipped`(해소 대상 아님 보고). **차단기**: 해소 워커의 내용 실패(`failed gate`·`push-race`·`push-hook`·`not-detached`)는 `not-assignee` 처럼 세지도 끊지도 않는다. 환경 실패(`rate-limit`·`no-result`·`deps`·`permission`)만 워커와 같이 센다. 이유: 의미 충돌 두 건이 연속으로 `failed gate` 가 되면 차단기가 새 spawn 을 모두 멈춰, 이 설계가 풀려던 정지를 다시 만든다 |
| backends.md 「고아 정리 규칙」 | 해소 워크트리(`dflow-<id8>-resolve`) 규칙을 더한다: 미커밋 변경이 없고 HEAD 가 `origin/<개발브랜치>` 의 조상이면(push 했거나 `reset --keep` 으로 버렸다) 지운다. 아니면 `parked`. 지금 2번 규칙(HEAD == `origin/<agent 브랜치>`)은 detached 개발 브랜치 워크트리에 맞지 않아, 그대로 두면 모든 해소 워크트리가 「멈춤」 으로 쌓인다 |
| 「3. 결과 처리」 문제 기록 블록(1011행) | `st` 가 `resolved` 여도 결과 사유를 적지 않는다(`done`·`needs-merge` 와 같은 취급) |
| 「4. 승인 스윕」 머지 충돌(1095-1097행) | §4 흐름으로 바꾼다: `mine` 확인(E10) → 해소 카운터·재시도 가능 여부 → 해소 큐 또는 "사람이 머지해야 함" + heartbeat. 파일 목록을 보고에 싣는다 |
| 「4. 승인 스윕」 일시 제외 해제(1102행) | §6.3 4번 |
| 「4. 승인 스윕」 `team.sweep` | 필드 `resolved`(이번 스윕에서 해소 머지로 확인된 수)를 더한다 |
| 「5. 팀원 spawn」 | 「5-2. 해소 spawn」 신설: 워크트리 `git worktree add --detach <MAIN>/.claude/worktrees/dflow-<id8>-resolve origin/<개발브랜치>`, 포인터는 `resolve-prompt.md`, `team.spawn` 의 `spawn_kind` 는 `resolve`. 나머지(tmux·Orca 띄우기, 신뢰 확인 루프, 이름표 `w<slot> · 해소 <TSK> <id8>`)는 5번과 같다 |
| 1184행·「금지」 1430행 "같은 작업의 재spawn 예외는 셋" | 넷째 예외로 해소 spawn(§5.6 조건 안)을 더한다 |
| 「금지」 1418행 | 예외 둘을 더한다. (1) §7.1 의 heartbeat(`merge_conflict` 설정·해제). (2) 해소 워커의 `/dflow-merge --resolve` 가 개발 브랜치에 머지·push 하는 것. "스윕의 머지만 팀장이 한다" 는 불변식의 유일한 예외이며, 팀장이 띄운 해소 워커가 팀장 대신 한 건만 머지한다. 경합은 두 쪽 모두 non-fast-forward 거부로 드러나고 force push 는 여전히 금지다 |
| 「7. 마감」 | 해소 워커도 다른 팀원과 같이 기다린다. 마감 시 남은 `merge_conflict` 표시는 지우지 않는다(사람이 보아야 한다) |

`references/events.md`: `spawn_kind` 를 "세 값"(28행)에서 네 값으로 고치고 `resolve` 를 설명한다. `team.sweep` 추가 필드
`resolved` 를 표와 가드 jq 의 `$req` 에 넣는다. `team.result` 의 `status` 에 `resolved` 가 올 수 있다고 적는다.

`references/help.md`: 해소 동작과 상한을 한 문단 더한다(새 인자는 없다).

**lease 설계와의 관계**: 해소는 lease 를 쥔 팀장의 기상 안에서만 일어난다. `LEASE_LOST` 마감은 "새 claim·spawn·승인 스윕을
하지 않는다"(lease 설계 §8) — 해소 spawn 도 spawn 이므로 하지 않는다. 떠 있는 해소 워커는 워커와 같이 끝까지 한다. 해소
워커가 개발 브랜치에 push 하는 것은 lease 와 무관하게 non-fast-forward 규칙이 경합을 막는다. 두 문서의 SKILL.md 변경
지점은 겹치지 않는다(lease 는 「1. 시작」·「2-2」·「7. 마감」, 이 문서는 「3」·「4」·「5」 가 중심).

## 9. 테스트 전략

기존 `tests/skills/*` 방식(문서 문자열 검사 + 문서의 명령을 꺼내 실제로 돌리기 + 임시 git 저장소 fixture)을 따른다.

| 층 | 파일 | 내용 |
|---|---|---|
| ① 규칙 | `tests/skills/dflow-wbs-contract-rules.test.ts`(신규) | `dflow-wbs/SKILL.md` 에 `### 계약 Task 의 공유 파일 규칙` 과 C1~C7 이 있다. §3.3 네 줄 acceptance 고정 문구가 있다. 231-235행 관례가 그 절을 참조한다. 자기 리뷰 게이트 항목이 있다 |
| ② merge | `tests/skills/dflow-merge-resolve.test.ts`(신규) | 문자열: `--resolve` 가 description 사용법에 없다, `--diff-filter=U` 가 `--abort` 앞에 있다, 머지 자리가 호출 워크트리, `-c rerere.enabled=true`, `DFlow-Resolve:` 트레일러, push 경합 재시도 2회. 임시 git 저장소: 두 브랜치가 같은 줄을 고친 fixture 에서 충돌 파일 목록 명령이 그 파일을 낸다. 해소 머지 뒤 `/dflow-merge` 2단계 명령(`merge-base --is-ancestor <head_sha>`·`git diff --name-only <head_sha>..<대상>`)이 여전히 통과한다 — E4 의 근거를 고정한다 |
| ② merge 보존 | `tests/skills/dflow-merge-remote.test.ts` | 원문 보존 검사(`_preserve.ts`)가 202-207행 변경으로 빨개진다. 의도된 변경 줄을 `CHANGED` 에 이유와 함께 더한다 |
| ② 프롬프트 | `tests/skills/dflow-team-resolve.test.ts`(신규) | `resolve-prompt.md` 가 있고 해소 규약 R1~R8·blocked 기준·금지·결과 줄 표가 있다. heartbeat `--phase blocked` 를 **보내지 않는다** 는 문장이 있다. 팀장 SKILL.md 의 해소 카운터 jq 를 꺼내 fixture events.jsonl(`resolve` 2줄 + `team.result` 3줄 + `resume` 1줄)에 돌려 2 가 나온다(`team.result` 로 초기화되지 않음) |
| ② 팀장 문서 | `tests/skills/dflow-team.test.ts` 에 추가 | 최종 판정 목록에 `resolved`, 결과 표 행, 우선순위(재개 → 해소 → 대기 큐), 금지의 heartbeat 예외, 재spawn 예외 넷 |
| ② 이벤트 | `tests/skills/dflow-team.test.ts` 또는 기존 이벤트 가드 검사 | events.md 가드 jq 가 `spawn_kind: resolve` 와 `team.sweep.resolved` 를 받는다 |
| ③ 스크립트 | `tests/skills/dflow-pred-reflected.test.ts`(신규) | 임시 git 저장소 + bare origin: state.json 없음 → `NOT_REFLECTED`(1), `phase=reported` → 1, `phase=merged`+머지 제목 → `REFLECTED 3`(0), `head_sha` 조상 → `REFLECTED 1`, 트레일러 → `REFLECTED 2`, `TSK-03-1` 이 `TSK-03-10` 머지 제목에 걸리지 않는다, 없는 개발 브랜치 → `UNKNOWN`(2) |
| ③ 행 G | `tests/skills/dflow-row-g-evidence.test.ts` | 행 G 본문의 명령 문자열 검사가 스크립트 추출로 깨진다. 스크립트 경로 호출 문구 검사로 바꾸고, 세 증거의 동작 검사는 위 스크립트 시험이 맡는다. 세 증거 설명·이유 문장 검사는 남긴다 |
| ③ 사전 필터 | `tests/skills/dflow-team-depends-precheck.test.ts` 에 추가 | 문서의 show 필터를 꺼내 돌려 `deps_nohead` 가 `reached=true`·`head_sha` 없는 선행만 담는다. `head_sha` 있는 선행은 담지 않는다(행 B 보호). 사유 `선행 미반영(` 이 선행 계열 목록에 있다. 기존 "`phase=merged` 로 거르지 않는다" 검사는 그대로 통과한다 |
| ④ 라우트 | `tests/agent/heartbeat-route.test.ts` 에 추가 | reported·approved + `merge_conflict` → 200 이고 update 가 `heartbeat_phase`·`heartbeat_note` 만 싣는다. claimed + `merge_conflict` → 400. reported + `design` → 409. 레거시 principal → 400. 다른 계정 → 403. 해제는 `.eq('heartbeat_phase','merge_conflict')` 조건. 조회 실패 → 500 |
| ④ 도메인 | `tests/domain/seatState*.test.ts`·`seatmap*.test.ts` 에 추가 | `inferPhase` 가 `merge_conflict` 를 돌려준다, `deriveSeatState` 는 WAIT·DONE 그대로, note 가 실린다, DONE 좌석도 확인 필요 띠에 든다, 선행이 `merge_conflict` 인 ready 좌석의 대기 사유 |
| ④ 컴포넌트 | `tests/components/agents/*` 에 추가 | `seatPhaseKey` 가 WAIT·DONE 좌석의 `merge_conflict` 에 키를 돌려준다, 점을 그리지 않는다 |
| ④ CLI | `tests/skills/dflow-*.test.ts`(가짜 curl) | `dflow.sh heartbeat --clear-merge-conflict` 의 본문 모양 |
| 화면 | ego-browser, 스테이징 | 스테이징 DB 에서 reported 주문에 `merge_conflict` 를 직접 넣고 오피스·좌석표·상세·확인 필요 띠를 본다 |
| 통합 | 스테이징 수동 리허설 | 샘플 리포에서 같은 줄을 고치는 Task 두 건을 자동 머지로 돌려 해소 워커가 `resolved` 로 끝나고 후속이 착수하는지 본다 |

## 10. 범위 밖

- **스윕의 머지 뒤 시험**(분석 제안 8). 충돌 없는 머지의 의미 충돌은 여전히 잡지 않는다. 해소 워커는 자기 머지만 게이트로
  본다. 스윕마다 전체 시험을 돌리면 스윕이 수십 분이 되어 기상 구조가 바뀐다 — 별도 과제.
- **워커의 계약 산출물 누락 대응**(분석 제안 6 후반): 기능 워커가 계약 산출물 누락을 발견하면 스스로 메우지 않고
  `blocked` 로 올리는 규칙. `worker-prompt.md` 판단 규칙 변경이라 이 문서의 ①(WBS 생성 규칙)과 층이 다르다. ① 의 C5 가
  계약 Task acceptance 로 누락 자체를 줄인다.
- `push 실패(훅)` 의 자동 해소. 훅이 막는 것은 규칙 위반이지 충돌이 아니다.
- 이미 떠 있는 병렬 워커에게 먼저 머지된 규약을 알리는 경로(분석 제안 5). C7 로 규약을 계약 단계에 고정하는 것으로 갈음한다.
- 서버 `reached` 의미 변경(§6.4).
- `heartbeat_phase` CHECK 제약·0094 comment 갱신(마이그레이션).
- 수동 `/dflow-merge`(사람) 의 자동 해소. 사람은 지금처럼 보고를 받고 직접 푼다.

## 11. 미결

1. **승인된 주문의 해소 재검토**(E9): 해소 내용은 승인자가 본 `head_sha` 밖이다. 지금은 머지 커밋·`resolution.md`·스윕 보고로
   드러내기만 한다. 자동 머지 운영의 승인 전 주문은 사람이 사후에 어차피 보지만, 이미 `approved` 인 주문은 다시 볼 계기가 없다.
   서버에 "해소됨, 재확인 필요" 표식을 두려면 `heartbeat_note` 재사용(표시만) 또는 새 열(마이그레이션) 중 골라야 한다.
2. **해소 상한 값**: 3 은 H 와 맞춘 값이다. 개발 브랜치가 빠르게 움직이는 날에는 `push-race` 로 상한을 먹을 수 있다.
   `push-race` 를 카운터에서 뺄지 운영 뒤 정한다.
3. **해소 워커 모델**: 기본은 팀장 인자 모델이다. 해소는 판단 비용이 크므로 `opus` 고정이 나은지.
4. **`resolution.md` 위치**: Task 폴더 안(개발 브랜치에 남음)으로 두었다. 승인 화면에서 보이게 하려면 서버 보고가 필요한데
   해소 워커는 서버 쓰기를 하지 않는다.
5. **해소 범위 검사**: 해소가 충돌 파일·게이트 통과에 필요한 파일만 고쳤는지를 기계로 볼지(머지 커밋의 first-parent 대비
   변경 파일 ⊆ 양쪽 브랜치가 바꾼 파일 ∪ R5 공용 헬퍼). 지금은 `resolution.md` 기록에 맡긴다.
6. H 설계에 "`spawn_kind: resolve` 는 자동 재시작 대상이 아니다" 를 넣는 것 — H 작성자와 맞출 것.
7. **`blocked` 해소 워커의 슬롯**: 지금은 워커와 같이 슬롯을 쥐고 답을 기다리며, 동시 해소 상한(§5.6)이 피해를 절반으로 묶는다.
   대안은 `blocked` 해소 워커가 슬롯을 놓고 워크트리만 남겨 사람이 이어받는 것이다(답 매칭 경로를 못 쓴다). 운영 뒤 정한다.
