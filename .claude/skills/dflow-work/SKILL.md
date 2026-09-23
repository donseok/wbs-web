---
name: dflow-work
description: D'Flow 작업(내 작업 조회·착수·진행 보고·완료 보고)을 처리할 때 사용. "내 D'Flow 작업", "디플로우 작업", "작업 착수", "진행 보고", "작업 완료" 같은 요청에서 트리거.
---

# D'Flow 작업 처리

모든 호출은 대상 리포의 `.claude/skills/dflow-work/scripts/dflow.sh` 로 한다(리포 루트가 cwd. `DFLOW_SH` env 가 있으면 그것). 산문 파싱 금지 —
**exit code 로 분기한다**: 0 성공 / 2 사용법·설정·push 미완료 / 3 인증 실패 /
4 선행·상태로 인한 진행 불가 — 409 충돌·로컬 선행 차단·선행 미충족(403 바디 `code=dependency_not_met` 재매핑) /
5 권한 부족(그 밖의 403) / 6 네트워크·서버·로컬 환경 실패(응답 파싱·파일 쓰기 포함) / 7 기능 꺼짐 /
10 중단됨 — 사람이 D'Flow 에서 작업을 중단했다(409 바디 `code=cancelled`). 재시도하지 말고 즉시 멈춘다.

## 시작 절차 (매 세션 1회)

0. 설정 — dflow.sh 는 워크트리 최상위의 `.dflow`(프로젝트 공통: `api_base`·`project_id`·`release_branch`)와
   `.dflow.local`(개인: `pats`·`as`·`dev_branch`·`automerge`·`project_map`)을 스스로 읽는다. 이미 export 된
   env 가 이긴다. 두 파일이 모두 없으면 종전대로 현재 디렉터리의 `.env`(`DFLOW_ENV_FILE`)를 읽는다. 값 확인은
   `dflow.sh config <key>`(비밀 제외)·`dflow.sh branch dev` 로.
1. `dflow.sh doctor` 실행 — 모든 프로필 확인, 계약 버전 검증.
   ```bash
   dflow.sh doctor
   ```
   성공(exit 0) 출력:
   ```
   base: https://d-flow.example.com
   프로필 1: OxMb1D1097Qz 맥북-에어 alice@example.com (계약 2.4, 프로젝트 3) [선택됨]
   ```
   계약 버전은 **major 가 다를 때만** 문제다 — "계약 major 불일치" 경고가 뜨면 dflow-kit
   (스킬 배포 킷)을 최신으로 갱신하라고 사용자에게 안내한다. minor 차이(서버의 additive 확장)는
   정상이라 경고가 안 뜨고, 경고가 뜰 때만 그 메시지에 서버·스킬 양쪽 값이 함께 찍힌다
   (정상 출력에는 서버 값만 나온다). **"계약 버전 확인 불가" 경고는 처방이 다르다** —
   서버 응답에 contract_version 이 없는 것이므로 킷을 갱신해도 안 고쳐진다. 서버 배포·응답을
   확인해야 한다.

2. 프로필이 여럿이면(`DFLOW_PATS` 에 쉼표 구분 여러 토큰) `.dflow.local` 의 `as=<prefix>`(레거시 `.env` 의
   `DFLOW_AS`) 가 이 리포의 키를 고정한다.
   prefix 는 `dflow.sh profiles` 로 본다(토큰마다 한 줄 JSON: `prefix`·`name`·`email`·`who`·`projects`·`bound`·`selected`. `who` 는 그 키의 신원 슬러그다).
   `DFLOW_AS` 가 없으면 첫 토큰이며 doctor 가 그 사실을 경고한다. 한 번만 다른 키로 부르려면 `--as <prefix|email>` 을
   쓴다. 한 계정에 키가 둘이면 email 로는 갈리지 않으므로 prefix 를 쓴다. `DFLOW_AS` 는 prefix 만 받는다.

## 워크플로우

### 내 신원 확인

```bash
dflow.sh me
```

현재 사용자 신원, 스코프, 접근 가능 프로젝트 출력. 토큰 설정 후 첫 확인용.

### 목록 조회

```bash
dflow.sh [--as <prefix|email>] list [--scope available|claimed|assigned|all] [--all]
```

기본값: `--scope available` (새 작업).

작업 목록 출력. 순번(1~N)을 사용자에게 그대로 보여준다.

**옵션**:
- `--all`: 모든 프로필의 작업을 동시 조회 (다중 계정 설정 시)
- `--scope`: available(기본), claimed, assigned, all
- `--any-project`: 프로젝트 필터를 끈다(진단용)

**프로젝트 필터**: 서버의 목록은 PAT 주인이 속한 모든 프로젝트의 주문을 돌려준다. `list` 는 그중 이 리포에
바인딩된 프로젝트(`.dflow` 의 `project_id` 와 `.dflow.local` 의 `project_map` 값, 레거시 `.env` 의
`DFLOW_PROJECT_ID`·`DFLOW_PROJECT_MAP`)의 주문만 보여 준다. 바인딩이 없으면
경고와 함께 전부 보여 주지만, `claim` 은 바인딩 밖 주문이나 바인딩 없는 리포에서 `PROJECT_MISMATCH`(exit 2)로
거부한다. 이유: 한 사람이 여러 프로젝트에 속하면 다른 프로젝트의 작업을 이 리포에서 개발하게 된다.

**예시**:
```bash
dflow.sh list --scope all           # 모든 상태 조회
dflow.sh --as bob@example.com list  # 다른 계정 (--as는 반드시 서브커맨드 앞)
dflow.sh list --all                 # 모든 프로필 순회
```

### 상태 확인

```bash
dflow.sh show <순번>
```

특정 작업의 상세 정보 조회. JSON 형식. ref는 순번 또는 UUID 8자 접두.

### 착수

```bash
dflow.sh claim <순번>
```

선행·상태로 인한 진행 불가는 **exit 4 로 차단**된다 — 로컬 선행 차단이든 서버 거부(403
`code=dependency_not_met`)든 같은 코드다. 이 경우 fetch/merge 후 재시도한다. 우회 금지.

성공 시:
- `<DOCS_DIR>/tasks/<TSK>/spec.md`(DOCS_DIR = project_map 의 그 프로젝트 키, 없으면 docs — `dflow.sh taskdir <ref>`)
  캐시가 생성된다 — **구현 전 반드시 읽는다**
  (명세 정본은 D'Flow DB, 이 파일은 claim 시점 스냅샷. 스크립트가 끝에 `spec 캐시: <경로>` 를 출력한다).

⚠️ **브랜치는 만들어지지 않는다** — dflow.sh 는 git 브랜치를 생성하지 않는다(스크립트에 해당 코드 없음).
`agent/<주문id 8자>-<slug>` 브랜치는 **호출자가 claim 직후 직접 만든다**:
```bash
git fetch origin && git switch -c agent/<주문id8>-<slug> origin/<기본브랜치>
```
main·staging 위에서 구현을 진행하지 말 것 — done 의 push 검증은 현재 브랜치를 그대로 쓰므로
브랜치를 안 만들면 main push 사고로 이어진다.

### 작업 폴더 조회

```bash
dflow.sh taskdir <ref>
```

이 작업의 작업 폴더(`<DOCS_DIR>/tasks/<TSK>`, 리포 최상위 기준 상대경로)를 출력한다. `<DOCS_DIR>` 를
`docs` 로 박아 둔 고정 경로를 손으로 짓지 않고 이 명령으로 구한다.

### 담당 작업 폴더 scaffold

```bash
dflow.sh scaffold
```

내게 배정된(assigned) 작업 중 **`phase=ready`(아직 아무도 착수하지 않은) 것만** 골라 바인딩된 프로젝트마다
`<DOCS_DIR>/tasks/<TSK>/state.json`(`{"tsk","order","api_base","phase":"ready"}`)을 미리 만든다. 이미 있는 폴더는
내용을 보지도 고치지도 않고 건너뛴다. 출력 한 줄: `scaffold created=N skipped=N no_ref=N`(필요하면 뒤에 안내 한
마디가 더 붙는다). exit code: **exit 2** 는 바인딩 없음(`PROJECT_MISMATCH`) 또는 git 리포가 아닌 곳에서 부름
(`NOT_REPO`), **exit 6** 은 배정 목록 파싱 실패·폴더 `mkdir`·`state.json` 쓰기·커밋 실패, API/인증 오류는
`dflow.sh` 의 기존 exit code 를 그대로 쓴다. 새 파일이 있고 현재 브랜치가 `dflow.sh branch dev` 의 값이면 커밋·push 까지 하고,
아니면 파일만 남긴다. **push 실패는 로컬 커밋만 남기고 exit 0 + 경고 한 줄**이다(팀장 시작을 막지 않는다).

### 진행 보고

```bash
dflow.sh progress <순번> <0-99> "<요약>"
```

진행률은 **0~99 범위만 허용**한다(100은 서버가 400으로 거부).

출력: 현재 상태 (e.g. `claimed`).

### heartbeat

`dflow.sh heartbeat <ref> [--phase p] [--note "<질문>"] [--agent id] [--model m]` — 진행 중 신호. 보고 행을 만들지 않고
주문의 `last_heartbeat_at`·`heartbeat_phase`·`heartbeat_agent`·`heartbeat_note`(+ `--model` 이 있으면 `heartbeat_model`, 0100) 만 갱신한다. 평소에는 PostToolUse 훅
(`~/.dflow/hooks/heartbeat.sh`)이 60초에 1회 자동으로 보내므로 직접 부를 일은 두 가지뿐이다.
- 담당자 결정 대기 직전: `dflow.sh heartbeat <id8> --phase blocked --note "<질문>"`. 좌석표에 손 든 사람과 질문이 뜬다.
  답을 받은 뒤의 첫 heartbeat(훅이든 명시든, `--phase` 가 blocked 가 아닌 것)가 이 상태를 푼다.
- Phase 경계를 명시하고 싶을 때: `--phase design|build|verify|refactor|rejected|reported`.
`--model` 은 지금 도는 Phase 서브에이전트의 모델(좌석표 명찰·등급). 훅은 state.json 의 `model` 을 싣는다 — 생략하면 서버 값을 그대로 둔다.
`--agent` 기본값은 워크트리 루트 `.dflow-agent` 첫 줄, 없으면 `claude-<host>`. 값이 `*/parked` 면 보내지 않는다.
claimed 가 아니면 exit 4, 사람이 중단한 주문(`cancelled`)이면 exit 10, 소유자가 아니면 exit 5. progress·done 도 같다.

### watch

`dflow.sh watch [--agent id] [--slots n] [--busy n] [--until HH:MM] [--project id] [--stop]` — 감시자 존재 신호.
좌석표 층 헤더의 STANDBY 배지가 이 신호로 켜지고, 마지막 신호 70분 뒤 꺼진다. `--stop` 은 즉시 끈다.
- `poll.sh` 가 매 주기 자동으로 보내고 `--until` 도달 시 `--stop` 을 보낸다. 팀장(`/dflow-team`) 아래에서 poll.sh 를 띄울 때는
  `DFLOW_WATCH=0` 을 붙여 끈다 — 팀장이 `<신원>/<host>/lead` 로 직접 보내기 때문이다.
- 기본 agent 는 `<신원>/<host>/poll`, `--project` 기본값은 `.dflow` 의 `project_id`(레거시 `.env` 의
  `DFLOW_PROJECT_ID`. 없으면 전 프로젝트 = 모든 층에 표시).

### 완료 보고

**push 완료가 선행 필수** — push 없이 done 을 호출하면 exit 2 로 거부된다.

```bash
git push origin agent/<주문id 8자>-<slug>
dflow.sh done <순번> "<요약>" --auto-links
```

`--auto-links` 옵션: git 정보(브랜치, SHA, PR URL)를 자동 수집해 서버 보고.

보고 후 상태는 **reported(승인 대기)** 다. 사용자에게 "완료했습니다"가 아니라 "승인 대기로 보고했습니다"로 전달한다.

### 포기

```bash
dflow.sh release <순번>
```

claim 했던 작업을 포기. 상태 -> ready 로 돌아감.

## 금지사항 (명령형)

다음을 엄격히 금지한다:

- **옵션은 반드시 서브커맨드 앞에** — `dflow.sh --as bob@example.com list` (O), `dflow.sh list --as bob@example.com` (X). 뒤에 붙이면 에러 없이 다른 신원으로 조용히 실행되는 오동작 발생.
- **토큰을 echo·파일 기록·명령 문자열에 보간하지 않는다** — env 확장으로만 사용.
- `DFLOW_API_BASE` 기본값을 지어내지 않는다 — 미설정 시 즉시 실패.
- `--pct 100` 또는 `progress 100` 금지. approve 시도 금지(승인은 사람 몫).
- 409 충돌을 재시도로 뚫지 않는다 — 상태를 `dflow.sh show <순번>` 으로 확인하고 사용자에게 보고.
- 실패를 성공으로 요약하지 않는다 — 정직한 상태 전달.
- git author 를 D'Flow 신원으로 바꾸지 않는다 — 커밋 author 는 PC 주인 그대로.

### 작업 대상이 wbs-web 자신이면

- `git add -A` 금지 — 항상 파일명을 명시해 stage 한다.
- 마이그레이션과 코드를 같은 커밋에 담지 않는다(G1 pre-push 훅이 검사).
- `src/app/globals.css`, `src/app/layout.tsx`, `src/app/(app)/layout.tsx`, `src/components/app/*` 변경 시 'Preview 확인 필요(G2)' 를 사용자에게 경고.

## 세션 복구

로컬 상태 파일에 의존하지 않는다. 언제든:

```bash
dflow.sh list --scope claimed
```

로 서버에서 claimed 상태 작업을 복원한다.
