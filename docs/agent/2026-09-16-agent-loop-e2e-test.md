# 에이전트 개발 루프 전체 시험 절차서 (신규 프로젝트 1세트)

작성 2026-09-16 · 대상 서버는 **스테이징**(`https://dflow-staging.vercel.app`) 하나뿐이다.
이 문서는 D'Flow 스킬 7종을 신규 프로젝트에서 처음부터 끝까지 한 번 통과시키면서, 어디가 깨지는지를
기록으로 남기기 위한 시험 절차서다. 설계 정본이 아니라 **주행 기록지**다.

시험의 관심사는 만들어지는 앱이 아니라 **에이전트 루프 자체**다. 따라서 앱의 기술 스택은 의도적으로 얇게 잡는다.

---

## 0. 전제

| 항목 | 값 | 근거 |
|---|---|---|
| D'Flow 서버 | `https://dflow-staging.vercel.app` | 프로젝트 생성·WBS 업로드·작업 보고가 전부 쓰기 작업이므로 운영을 쓰지 않는다 (CLAUDE.md 「데이터」) |
| 스킬 출처 | `~/dflow-kit`(tmux 백엔드 반영본) = wbs-web `origin/main` | tmux pane 백엔드를 main 에 머지하고 킷을 재빌드한 뒤 주행한다. 재빌드 전에 주행하면 옛 스킬(프로세스 백엔드)을 시험하게 되어 17단계 하나를 통째로 버린다 |
| WBS 입력 | `/Users/jji/project/mdm/docs/design/basic/02-term-domain-column.md` (1,058줄) | 용어·도메인·컬럼 3계층, 테이블 8개 |
| 작업 리포 | 새로 만드는 `~/project/mdm-dict` (GitHub 원격 필수) | `mdm` 폴더는 git 리포가 아니고, 팀원 워크트리는 `origin` 의 스킬을 쓴다 |
| 팀 백엔드 | **pane(tmux)** 를 시험한다 | 2026-09-16 에 tmux pane 백엔드를 구현하고 프로세스 백엔드(`nohup claude -p`)는 없앴다. pane(Orca) 는 tmux 가 없는 환경 전용으로 내려가, tmux 가 깔린 이 PC 에서는 그 갈래로 떨어지지 않는다(단계 16) |
| 실행 신원 | **두 개**: `jongik.jang@dongkuk.com`(슈퍼유저), `yoo7032@gmail.com`(일반 사용자) | 권한 경계가 실제로 닫혀 있는지를 한 신원으로는 확인할 수 없다 |

### 파라미터

주행 전에 아래 값을 채우고, 문서 안의 `<...>` 를 이 값으로 읽는다.

| 이름 | 값 |
|---|---|
| `<REPO>` | `~/project/mdm-dict` |
| `<GH>` | `jongik-sv/mdm-dict` |
| `<PROJECT_ID>` | (단계 3 에서 확보) |
| `<MODULE>` | `dict` |
| `<SU>` | `jongik.jang@dongkuk.com` (슈퍼유저) |
| `<MEM>` | `yoo7032@gmail.com` (일반 사용자) |
| `<PAT_SU>` · `<PAT_MEM>` | (단계 3 에서 각 계정이 자기 것을 발급, 어디에도 붙여넣지 않는다) |
| `<종료시각>` | 당일 18:00 |

### 신원 두 개를 쓰는 방식

`dflow.sh` 는 `DFLOW_PATS` 에 쉼표로 토큰을 여러 개 받는다. 토큰을 고르는 규칙은 두 가지뿐이고, 이 규칙이 주행 설계 전체를 좌우한다.

| 상황 | 고르는 토큰 | 근거 |
|---|---|---|
| `--as` 를 주지 않음 | **첫 토큰** | `pick_token()` 이 `--as` 가 비면 즉시 첫 토큰을 돌려준다 |
| `--as <문자열>` | 각 토큰의 `/me` 이메일을 조회해 **부분 일치**하는 첫 토큰 | 못 찾으면 종료 코드 2 로 중단한다 |

여기에서 따라오는 제약이 셋이다.

1. **`/dflow-poll` 과 `/dflow-team` 은 `--as` 를 지원하지 않는다.** 둘 다 첫 토큰의 신원으로만 돈다. `/dflow-team` 은 첫 토큰의 `user_email` 로 좌석 식별자(`<신원>/<host>/w<슬롯>`)까지 만든다. 즉 **자동 루프의 신원을 바꾸는 방법은 `.env` 의 토큰 순서를 바꾸는 것뿐이다.**
2. **`/dflow-export` 도 첫 토큰을 쓴다.** WBS 업로드는 프로젝트 관리자 권한을 요구하므로, 업로드 시점에는 슈퍼유저 토큰이 앞에 있어야 한다.
3. `--as` 는 부분 일치이므로 **전체 이메일을 적는다.** 짧은 문자열은 두 계정에 모두 걸릴 수 있고, 그때는 앞 토큰이 조용히 이긴다.

전 토큰을 순회하는 명령은 `list --all` 과 `doctor` 둘뿐이다. 나머지는 실행 1회 전체가 한 신원으로 고정된다.

주의할 점이 둘 더 있다.

- **목록 캐시는 신원과 무관하게 공유된다.** `~/.cache/dflow/last-list.json` 과 `known-ids.txt` 가 신원별로 나뉘어 있지 않다. 그래서 `<SU>` 로 `list` 한 직후 `--as <MEM>` 으로 순번을 그대로 쓰면, **앞 신원의 목록에서 순번을 풀어 엉뚱한 주문에 claim 이 나갈 수 있다.** 신원을 바꾼 직후에는 순번 대신 UUID 앞 8자를 쓰거나, 그 신원으로 `list` 를 한 번 다시 실행한다.
- **팀이 도는 중에 `.env` 를 건드리지 않는다.** 팀원 워크트리의 `.env` 는 팀장 체크아웃을 가리키는 **심링크**라서, 내용을 바꾸면 이미 떠 있는 팀원도 다음 호출부터 새 신원으로 넘어간다. 팀장 잠금의 소유자 판정에도 신원 문자열이 들어가므로 상태 정합성이 깨진다. 단계 14 에서 순서를 뒤집는 것은 팀이 아직 돌기 전이라 안전하다.

따라서 기본 순서는 슈퍼유저를 앞에 둔다.

```
DFLOW_PATS=<PAT_SU>,<PAT_MEM>
```

그리고 단계 14 에서 **한 번만 순서를 뒤집어** 자동 루프를 일반 사용자 신원으로 돌린다. 이것이 두 신원을 형식적으로 나열하는 데 그치지 않고 실제로 쓰는 자리다.

역할 분담은 다음과 같다.

| 일 | 신원 | 이유 |
|---|---|---|
| 프로젝트 생성, 에이전트 켜기, 멤버 등록 | `<SU>` | `requireSuperuser()` 또는 프로젝트 관리자 권한이 필요하다 |
| WBS 업로드 | `<SU>` | import 게이트가 프로젝트 관리자를 요구한다 |
| 승인 | `<SU>` | **승인은 관리자 또는 서브트리 관리자만 할 수 있다. 리프 담당자 본인은 자기 작업을 승인하지 못한다**(설계상 그렇다). 게다가 PAT API 에는 승인 엔드포인트 자체가 없다 |
| 반려·재작업 요청 | `<SU>` 또는 `<MEM>` | 반려는 담당자 본인도 할 수 있다(2026-09-14 결정). 단계 15 에서 이 차이를 시험한다 |
| 수동 개발 1건 | `<SU>` | 루프의 각 단계를 먼저 확인한다 |
| 반자동·병렬 개발 | `<MEM>` | 실제 운영에 가까운 형태다. 권한이 모자라면 그 자체가 발견이다 |
| 권한 경계 시험 | `<MEM>` | 일반 사용자 토큰으로 업로드를 시도해 거부되는지 본다 |

### 대상 앱의 기술 스택

| 층 | 선택 | 이유 |
|---|---|---|
| 런타임 | Node.js 26 (ESM) | 빌드 단계가 없다 |
| 서버 | Express 5 | 라우트 파일 하나로 시작할 수 있다 |
| 저장소 | SQLite (`better-sqlite3`) | 설계서의 DDL 을 거의 그대로 옮길 수 있고 별도 설치가 필요 없다 |
| 화면 | 정적 HTML 과 순수 JavaScript | 번들러와 프레임워크가 없다 |
| 테스트 | vitest | `/dflow-dev` 의 Build·Verify 단계가 테스트 러너를 요구한다 |

TypeScript, Next.js, ORM 을 모두 뺀 구성이다.

### 수동 실행과 자동 루프를 섞는 방식

한 번의 주행 안에서 세 가지 실행 방식을 모두 통과시킨다. 순서는 위험이 낮은 쪽부터다.

1. **수동 1건** (`/dflow-dev <번호>`): 루프의 각 단계를 눈으로 확인한다. 여기서 막히면 뒤는 의미가 없다.
2. **반자동 1건** (`/dflow-poll`): 감시와 자동 착수, 그리고 승인 감지를 확인한다.
3. **병렬 2건** (`/dflow-team 2명 <종료시각>`): 슬롯 동시 착수와 팀장의 승인 스윕을 확인한다. tmux pane 백엔드로 한 번 돌린다.

여기에 **권한 경계 시험 1건**(단계 10)과 **반려 재작업 1건**(단계 15)을 끼워 넣는다. 앞의 것은 일반 사용자 토큰으로 업로드를 시도해 거부되는지 보는 자리이고, 뒤의 것은 이미 알려진 결함이 몰려 있는 구간이다(§3 의 C, E, R3).

수동 개발은 `<SU>` 신원으로, 반자동과 병렬은 `<MEM>` 신원으로 돌린다. 신원이 바뀌는 자리는 단계 14 한 곳뿐이고, 거기서 `.env` 의 토큰 순서를 뒤집는다.

---

## 1. 단계별 절차

각 단계는 다음 다섯 칸으로 기록한다. **기대**는 반드시 관찰 가능한 대상으로 적혀 있다.

---

### 단계 1. 작업 리포 생성과 원격 push

**실행**
```bash
mkdir -p ~/project/mdm-dict && cd ~/project/mdm-dict
git init -b main
npm init -y
npm pkg set type=module scripts.test=vitest
npm i express better-sqlite3
npm i -D vitest
mkdir -p docs src public tests
printf 'node_modules/\n' > .gitignore
git add package.json package-lock.json .gitignore
git commit -m "chore: 프로젝트 초기화 (Node + Express + SQLite + vitest)"
gh repo create <GH> --private --source=. --remote=origin --push
```

**기대**: `gh repo create` 가 원격 URL 을 출력하고, `git ls-remote origin` 이 `refs/heads/main` 을 돌려준다.

**확인**
```bash
cd <REPO> && git ls-remote --symref origin HEAD && npx vitest --run --passWithNoTests
```

**실패 시**: 즉시 중단한다. 원격이 없으면 `/dflow-team` 의 전제 검사가 `KIT_NOT_PUSHED` 로 막고, 팀원 전원이 시작하지 못한다.

**결과**: [ ] 통과  [ ] 실패  비고:

---

### 단계 2. 스킬 킷 설치

**실행**
```bash
cd ~/dflow-kit && git pull
~/dflow-kit/install.sh <REPO>
```

**기대**: `<REPO>/.claude/skills/dflow-*` 7종이 생기고, `.env` 초안과 `.gitignore` 의 `.env` 항목, `.gitattributes` 의 줄끝 고정 항목, 그리고 `.claude/settings.json` 의 워커 허용 목록이 추가된다.

**이어서 곧바로 커밋하고 push 한다.** 스킬은 리포에 들어가야 하는 자산이다. `/dflow-team` 의 팀원 워크트리는 `origin` 의 스킬을 쓰기 때문에, 원격에 올라가 있지 않으면 전제 검사가 `KIT_NOT_PUSHED` 로 막고 팀원 전원이 시작하지 못한다.

```bash
cd <REPO>
git add .claude/skills .claude/settings.json .gitattributes .gitignore
git commit -m "chore: dflow 에이전트 스킬 킷 반영"
git push origin main
```

**확인**
```bash
ls <REPO>/.claude/skills && grep -n '^\.env$' <REPO>/.gitignore && cat ~/dflow-kit/VERSION
cd <REPO> && git ls-tree -r --name-only origin/main | grep -c '^\.claude/skills/'
```
마지막 명령의 출력이 0 이면 스킬이 원격에 올라가지 않은 것이다.

**실패 시**: `install.sh` 가 보고하는 누락 명령(`git curl jq gh python3`)을 먼저 설치하고 다시 실행한다.

**주의**: `.claude/settings.json` 의 워커 허용 규칙에는 이 PC 의 `git` 절대경로가 들어간다. 다른 PC 에서 같은 리포로 시험할 때는 그 PC 에서 `install.sh` 를 다시 실행해 규칙을 갱신해야 한다.

**결과**: [ ] 통과  [ ] 실패  비고:

---

### 단계 3. D'Flow 신규 프로젝트 생성, 멤버 등록, PAT 발급 (웹 화면, 사람이 직접)

프로젝트 생성에는 API 경로가 없다. `createProject` 서버 액션이 유일한 경로이고 `requireSuperuser()` 가드가 걸려 있다.

**실행 3-가** (`<SU>` 로 스테이징 웹에 로그인한 뒤 순서대로)

1. `/projects` 에서 새 프로젝트를 만든다. 이름은 `MDM 사전`, 식별하기 쉬운 이름이면 된다.
2. 주소창의 `/p/<UUID>/` 에서 `<PROJECT_ID>` 를 복사한다.
3. 프로젝트 설정 화면에서 **에이전트 켜기**를 켠다.
4. `/p/<PROJECT_ID>/members` 에서 `<MEM>` 을 **멤버로 등록한다.** 이 단계를 빠뜨리면 `<MEM>` 의 PAT 로 보내는 모든 호출이 **404** 로 떨어진다. 서버가 프로젝트의 존재 자체를 숨기기 때문에, 권한 부족이 아니라 「없는 프로젝트」처럼 보인다.
5. `/account` 의 「내 토큰」에서 `<PAT_SU>` 를 발급한다. 스코프는 `work:read` 와 `work:claim`, 대상 프로젝트는 방금 만든 프로젝트로 한정한다.

**실행 3-나** (`<MEM>` 으로 로그인해서)

6. `/account` 의 「내 토큰」에서 `<PAT_MEM>` 을 발급한다. PAT 는 자기 것만 발급할 수 있으므로, 이 계정으로 직접 로그인해야 한다. 스코프와 대상 프로젝트는 5번과 같게 맞춘다.

**기대**: 3번을 켜면 `agent_projects.enabled=true` 행이 생긴다. 이 행이 없으면 이후 import 호출이 **원인 구분 없이 404** 로 떨어진다. 4번을 하면 `<MEM>` 이 프로젝트 멤버가 되지만, **관리자는 아니다.** 이 차이를 단계 10 에서 시험한다.

**확인**: 단계 4 의 `dflow.sh me` 를 두 신원으로 각각 실행해, 둘 다 `<PROJECT_ID>` 를 접근 가능한 프로젝트로 돌려주는지 본다.

**실패 시**: 즉시 중단한다. 404 는 세 가지 원인(에이전트 미활성, PAT 프로젝트 범위 불일치, 서버 전역 스위치 `AGENT_API_ENABLED` 꺼짐)을 의도적으로 뭉뚱그리므로, 셋을 각각 눈으로 확인해야 한다.

**결과**: [ ] 통과  [ ] 실패  비고:

---

### 단계 4. `.env` 기입과 연결 확인

**실행**: `<REPO>/.env` 를 편집기로 열어 세 값을 채운다. PAT 값은 명령줄에 쓰지 않고 편집기로만 넣는다. **토큰 순서가 곧 자동 루프의 신원이므로 슈퍼유저를 앞에 둔다.**

```
DFLOW_API_BASE=https://dflow-staging.vercel.app
DFLOW_PATS=<PAT_SU>,<PAT_MEM>
DFLOW_PROJECT_ID=<PROJECT_ID>
```

```bash
cd <REPO>
(set -a; . ./.env; set +a; .claude/skills/dflow-work/scripts/dflow.sh doctor)
(set -a; . ./.env; set +a; .claude/skills/dflow-work/scripts/dflow.sh me)
(set -a; . ./.env; set +a; .claude/skills/dflow-work/scripts/dflow.sh --as yoo7032@gmail.com me)
```

세 번째 명령이 두 신원 구성의 핵심 확인이다. `--as` 는 **반드시 서브커맨드 앞**에 둔다. 뒤에 붙이면 오류 없이 첫 토큰의 신원으로 실행되고, 그 사실이 화면에 드러나지 않는다.

리포 하나에 프로젝트 하나를 붙이는 형태이므로 `DFLOW_PROJECT_ID` 를 쓴다. 리포 여러 개를 한 `.env` 로 다루는 `DFLOW_PROJECT_MAP` 형식도 있지만(wbs-web 의 `.env` 가 그 형식이다), 이번 주행은 단일 프로젝트 형식을 의도적으로 택한다. `dflow.sh watch --project` 는 `DFLOW_PROJECT_ID` 만 기본값으로 읽으므로, 지도 형식만 채워 두면 단계 16 의 좌석표 신호가 엉뚱한 프로젝트로 간다.

**기대**: 두 번째 명령이 `<SU>` 를, 세 번째 명령이 `<MEM>` 을 돌려주고, 둘 다 접근 가능한 프로젝트에 `<PROJECT_ID>` 가 들어 있다.

이때 `~/.cache/dflow/profiles.json` 에 `{prefix, email}` 두 쌍이 쌓인다. 평문 토큰은 저장되지 않고 토큰 접두만 저장된다. **PAT 를 재발급하면 이 캐시가 옛 대응을 들고 있어 `--as` 가 엉뚱하게 풀릴 수 있으므로, 재발급했으면 캐시를 지운다.**

```bash
rm -f ~/.cache/dflow/profiles.json    # PAT 를 재발급했을 때만
```

**확인**: `doctor` 의 **종료 코드로 판정하지 않는다.** 토큰이 1개일 때 검사 루프가 0회 실행되고도 0 으로 끝나는 것이 이미 확인된 결함이다(§3 의 R5). 출력 본문을 눈으로 읽는다.

**실패 시**: 종료 코드 3 은 인증 실패이므로 PAT 를 다시 발급한다. 6 은 네트워크나 서버 문제이므로 스테이징 배포 상태를 먼저 본다. 세 번째 명령이 「프로필을 찾지 못했습니다」(종료 코드 2) 로 끝나면 `<PAT_MEM>` 이 `.env` 에 들어가지 않았거나 이메일을 잘못 적은 것이다.

**결과**: [ ] 통과  [ ] 실패  비고:

---

### 단계 5. WBS 입력 자료 준비

`/dflow-wbs` 의 기본 모드는 `docs/PRD.md` 와 `docs/TRD.md` 를 둘 다 요구한다. 설계서 한 편으로 시작하므로, 설계서에서 두 문서를 파생시키고 프로그램 목록도 함께 만든다.

**실행**: 이 단계는 사람이 Claude 에게 말로 시킨다.

> `/Users/jji/project/mdm/docs/design/basic/02-term-domain-column.md` 를 읽고 `<REPO>/docs/PRD.md` 와 `<REPO>/docs/TRD.md` 를 만들어라. 범위는 용어·도메인·컬럼 3계층과 테이블 8개(MD_SYSTEM, MD_UNIT, MD_TERM, MD_DOMAIN, MD_COLUMN, MD_COLUMN_SYSTEM, MD_DICT_SEQ, MD_DICT_SYSTEM)로 한정하고, 배포와 결재는 범위 밖으로 명시해라. 이어서 `<REPO>/docs/programs.csv` 를 만들되 열은 `module,program_id,program_name` 세 개로 하고, 화면과 API 를 프로그램 단위로 8건에서 12건 사이로 뽑아라. 마지막으로 다음 단계에서 만들 `wbs.md` 의 모든 Task 에 담당자를 넣어야 한다는 것을 기억해라. 선행 공정과 통합테스트는 `jongik.jang@dongkuk.com`, 기능 Task 는 `yoo7032@gmail.com` 으로 나눈다.

`programs.csv` 의 필수 열 세 개에는 담당자가 없다. 즉 **담당자는 WBS 생성 단계에서 따로 채워 넣지 않으면 비어 있는 채로 올라간다.** 이것이 단계 6 의 차단 관문이 존재하는 이유다.

담당자를 두 신원으로 나누는 것은 형식이 아니라 시험 항목이다. 자동 루프는 `list --scope assigned`, 곧 **자기에게 배정된 것만** 본다. 따라서 `<MEM>` 신원으로 도는 루프는 `<SU>` 에게 배정된 선행 공정을 보지 못해야 정상이다. 이것이 단계 14 의 관찰 지점이다.

**기대**: 세 파일이 생기고, `programs.csv` 의 `program_id` 에 중복이 없으며 빈 칸이 없다.

**확인**
```bash
cd <REPO> && head -3 docs/programs.csv && awk -F, 'NR>1{print $2}' docs/programs.csv | sort | uniq -d
```
중복 출력이 없어야 한다.

**실패 시**: 헤더 인식 실패, ID 중복, 필수 칸 누락은 `/dflow-wbs` 가 중단한다. csv 를 고치고 다시 한다.

**결과**: [ ] 통과  [ ] 실패  비고:

---

### 단계 6. WBS 생성

**실행** (Claude Code 를 `<REPO>` 루트에서 연 상태로)
```
/dflow-wbs --programs docs/programs.csv --start-date 2026-09-17
```

**기대**: `<REPO>/docs/wbs.md` 가 생기고, 프로그램 1건이 Task 1건(수직 슬라이스)으로 대응되며, 앞에 초기화·기본설계 공정이, 뒤에 통합테스트가 붙는다. 모든 상태는 `[ ]` 다.

**확인 (차단 관문)**: 담당자가 비어 있으면 그 작업은 자동 루프에 영원히 잡히지 않고, 화면에도 아무 표시가 뜨지 않는다(§3 의 R1). 따라서 다음을 먼저 센다.

```bash
cd <REPO>
grep -c 'assignee' docs/wbs.md                  # Task 수와 같아야 한다
grep -n 'assignee' docs/wbs.md | grep -v '@'    # 출력이 없어야 한다(값이 빈 줄)
grep -o 'jongik.jang@dongkuk.com\|yoo7032@gmail.com' docs/wbs.md | sort | uniq -c
```

마지막 명령은 두 이메일이 각각 몇 건씩 배정되었는지 센다. 한쪽이 0 이면 나눈 것이 아니다.

이어서 `wbs.md` 를 직접 열어 두 가지를 더 본다.
- 각 Task 의 `spec_sections` 본문이 비어 있지 않은가. 빈 spec 은 `/dflow-dev` 가 착수를 거부한다.
- 선행 관계(`depends`)가 초기화 공정을 가리키는가.

**실패 시**: 담당자가 비어 있으면 **여기서 멈추고 `wbs.md` 를 직접 고친다.** 업로드 이후에는 D'Flow 가 정본이 되므로 이것이 마지막 기회다. spec 과 선행 관계의 결함은 기록하고 계속해도 된다.

**결과**: [ ] 통과  [ ] 실패  비고:

---

### 단계 7. WBS 검증

**실행**
```bash
cd <REPO>
python3 .claude/skills/dflow-export/scripts/wbs-validate.py validate --wbs docs/wbs.md
```

**기대**: `ok: true` 이면서 `task_count` 가 `wbs.md` 의 실제 Task 수와 일치한다.

**확인**: `task_count` 가 0 인데 `ok: true` 이면 **검증기가 아무것도 읽지 않은 것이다**(§3 의 R4). 이때는 아래로 직접 센다.
```bash
python3 .claude/skills/dflow-export/scripts/wbs-parse.py --tasks-all --wbs docs/wbs.md | head -20
```
`dflow-wbs` 에 동봉된 검증기는 3단계 헤딩만 인식하므로, 반드시 `dflow-export` 쪽 검증기를 쓴다.

**실패 시**: 즉시 중단한다. 잘못된 구조를 업로드하면 D'Flow 쪽 정리가 수작업이 된다.

**결과**: [ ] 통과  [ ] 실패  비고:

---

### 단계 8. export 시험 실행 (dry-run)

**실행**
```
/dflow-export --project-id <PROJECT_ID> --module dict
```

**기대**: 스크래치패드에 `wbs-export-dict.json` 과 `wbs-import-dict.json` 두 파일이 생기고, 전송은 일어나지 않는다. 보고에 생성 예정 노드 수와 주문 수가 나온다.

**확인**: `wbs-import-dict.json` 의 최상위에 `project_id` 와 `module` 두 필드가 있고 `nodes` 길이가 단계 7 의 `task_count` 와 정합한지 본다.

**실패 시**: 기록하고 계속한다. dry-run 이므로 서버에 아무 영향이 없다.

**결과**: [ ] 통과  [ ] 실패  비고:

---

### 단계 9. WBS 업로드

**실행**
```
/dflow-export --project-id <PROJECT_ID> --module dict --push
```

이 명령은 `.env` 의 **첫 토큰**, 곧 `<PAT_SU>` 로 나간다. 업로드가 프로젝트 관리자 권한을 요구하므로 순서가 지켜져 있어야 한다.

**기대**: 응답이 `{ok: true, upserted: N, orders_created: M, unmatched_assignees: []}` 형태로 오고, `unmatched_assignees` 가 **빈 배열**이다. 두 이메일이 모두 D'Flow 계정과 대응되었다는 뜻이다.

**확인**: 웹의 `/p/<PROJECT_ID>/wbs` 화면에서 트리가 보이고, 리프 Task 의 담당자가 `<SU>` 와 `<MEM>` 으로 나뉘어 표시된다.

**실패 시**
- 404: 단계 3 의 세 가지 원인을 각각 확인한다.
- 403 `forbidden_role`: 프로젝트 관리자 권한이 필요하다. 슈퍼유저라면 나오지 않아야 하는 응답이므로, 나오면 기록한다. `.env` 의 토큰 순서가 뒤집혀 있지 않은지 먼저 본다.
- `unmatched_assignees` 에 `<MEM>` 이 들어 있으면 단계 3 의 멤버 등록이 빠진 것이다. 등록하고 다시 올린다.

**결과**: [ ] 통과  [ ] 실패  비고:

---

### 단계 10. 권한 경계 시험 (일반 사용자 토큰으로 업로드 시도)

fail-closed 가 실제로 닫혀 있는지 확인하는 유일한 자리다. **통과란 거부되는 것이다.**

**실행**
```bash
cd <REPO>
(set -a; . ./.env; set +a
 PAT=$(printf '%s' "$DFLOW_PATS" | cut -d, -f2)
 curl -sS -o /tmp/dflow-403.json -w '%{http_code}\n' \
   -X POST "$DFLOW_API_BASE/api/v1/wbs/import" \
   -H "Authorization: Bearer $PAT" -H 'Content-Type: application/json' \
   -d @"$(ls -t /private/tmp/claude-*/**/wbs-import-dict.json 2>/dev/null | head -1)")
jq . /tmp/dflow-403.json
```

payload 경로를 찾기 어려우면 단계 8 이 보고한 경로를 그대로 적는다.

**기대**: HTTP **403** 과 `{"code": "forbidden_role", "error": "프로젝트 관리자만 업로드할 수 있습니다."}`. `<MEM>` 은 프로젝트 멤버이지만 관리자가 아니므로 업로드가 막혀야 한다.

게이트 순서를 알아 두면 응답을 읽기 쉽다. **비멤버는 404**(프로젝트의 존재 자체를 숨긴다), **멤버지만 관리자가 아니면 403** 이다. 관리자 판정보다 멤버 판정이 먼저 오는 이유가 여기에 있다.

**확인**: 200 이 돌아오면 **권한 경계가 열려 있는 것이다.** 이것은 기지 결함이 아니라 신규 발견이므로 즉시 기록하고, 스테이징에 올라간 중복 노드를 확인한다(import 는 멱등이므로 같은 payload 라면 `upserted: 0` 이어야 한다).

**실패 시**: 404 가 나오면 권한 문제가 아니라 멤버 등록이 빠진 것이다. 단계 3 의 4번으로 돌아간다.

**결과**: [ ] 통과(403 확인)  [ ] 실패  비고:

---

### 단계 11. 위임 준비 (웹 화면)

자동 착수의 전제는 다섯 가지가 전부 갖추어지는 것이다: **리프이고, `dev_workflow` 가 켜져 있고, `tags` 에 `agent` 가 있고, spec 본문이 있고, 담당자가 배정되어 있다.**

**실행**: 웹 WBS 화면에서 다음과 같이 나눈다. 담당자는 단계 6 에서 이미 나누어 두었다.

| 작업 | 담당자 | 위임 태그 | 용도 |
|---|---|---|---|
| 초기화·스캐폴드 1건 | `<SU>` | **끄기** | 단계 12 의 수동 실행 대상 |
| 기능 Task 1건 | `<MEM>` | 켜기 | 단계 14 의 반자동 실행 대상 |
| 기능 Task 2건 | `<MEM>` | 켜기 | 단계 16 의 병렬 실행 대상 |
| 나머지 | 그대로 | 끄기 | 시험 범위 밖 |

**기대**: 태그를 켠 작업은 `list --scope assigned` 에 뜨고, `show` 응답의 `tags` 에 `agent` 가 보인다. 그리고 **두 신원의 목록이 서로 다르다.**

**확인**
```bash
cd <REPO>
D=.claude/skills/dflow-work/scripts/dflow.sh
(set -a; . ./.env; set +a; $D list --scope assigned)                        # <SU> 의 목록
(set -a; . ./.env; set +a; $D --as yoo7032@gmail.com list --scope assigned) # <MEM> 의 목록
```

`<SU>` 의 목록에 선행 공정이, `<MEM>` 의 목록에 기능 Task 가 보여야 한다. 두 목록이 똑같이 나오면 담당자가 한쪽으로 몰린 것이다.

**실패 시**: 목록에 아무것도 안 뜨면 담당자 배정을 먼저 의심한다. 담당자가 없으면 **화면에도 아무 표시가 뜨지 않는다**(§3 의 R1).

**결과**: [ ] 통과  [ ] 실패  비고:

---

### 단계 12. 수동 실행 1건 (`/dflow-dev`)

**실행**
```
/dflow-dev 1
```

**기대**: 다음이 순서대로 관찰된다.
1. Phase 0 에서 claim 이 성공하고 서버 stage 가 `ip` 로 바뀐다.
2. `agent/<주문id8>-<slug>` 브랜치가 생긴다.
3. `docs/tasks/<TSK>/design.md` 가 생기고 필수 5절(접근방식, 변경 파일 목록, 테스트 전략, 수용 기준 매핑, 불변 규칙)을 갖춘다.
4. Build 단계에서 테스트가 먼저 실패하고 그다음 통과한다.
5. Verify 단계에서 전체 테스트가 기준선 대비 악화되지 않는다.
6. push 후 `done --auto-links` 가 성공하고 stage 가 `im`(승인 대기) 로 바뀐다.

**확인**
```bash
cd <REPO>
git log --oneline -5
cat docs/tasks/*/state.json
(set -a; . ./.env; set +a; .claude/skills/dflow-work/scripts/dflow.sh show 1)
```
`state.json` 의 `order` 가 **36자 UUID** 인지 반드시 본다. 8자로 기록되면 승인 이후 스윕이 그 주문을 영영 찾지 못한다(§3 의 R6).

**실패 시**: 그 단계에서 중단하고 사유를 기록한다. 같은 명령으로 재실행하면 이어서 진행한다. 테스트를 지우거나 건너뛰어 초록으로 만드는 대응은 금지다.

**결과**: [ ] 통과  [ ] 실패  비고:

**이 단계가 남기는 것**: `agent/*` 브랜치 1개, `docs/tasks/<TSK>/` 1벌, 서버 상태 `reported`.

---

### 단계 13. 승인과 머지

**실행**: 웹에서 `<SU>` 로 로그인해 단계 12 의 작업을 승인한다. 그다음 Claude 에게 말한다.

> 승인했다. 머지해라.

또는 직접 `/dflow-merge` 를 부른다.

**기대**: 서버 조회에서 `status=approved` 를 확인한 뒤에만 머지가 일어나고, `git merge --no-ff` 로 합쳐지며, `state.json` 이 `phase=merged` 로 바뀐 커밋이 따라붙고, `main` 이 push 된다.

**확인**
```bash
cd <REPO> && git log --oneline --merges -3 && git branch -a | grep agent/
```

**실패 시**
- 「승인 대기」로만 보고되면 웹의 승인이 실제로 저장되지 않은 것이다.
- 「건너뜀(다른 D'Flow)」가 나오면 `state.json` 의 `api_base` 와 현재 `.env` 의 `DFLOW_API_BASE` 가 어긋난 것이다(§3 의 R7).

**결과**: [ ] 통과  [ ] 실패  비고:

---

### 단계 14. 반자동 실행 1건, 신원을 일반 사용자로 바꿔서 (`/dflow-poll`)

여기부터 자동 루프는 `<MEM>` 신원으로 돈다. `/dflow-poll` 은 `--as` 를 받지 않으므로, 신원을 바꾸는 방법은 **토큰 순서를 뒤집는 것뿐이다.**

**실행 14-가**: `<REPO>/.env` 의 토큰 순서를 뒤집는다. 편집기로 고친다.

```
DFLOW_PATS=<PAT_MEM>,<PAT_SU>
```

바꾼 뒤 기본 신원이 실제로 바뀌었는지 확인한다. 이 확인을 건너뛰면, 남은 단계 전체가 의도와 다른 신원으로 돌아간 것을 마지막에야 알게 된다.

```bash
cd <REPO> && (set -a; . ./.env; set +a; .claude/skills/dflow-work/scripts/dflow.sh me)
```

출력이 `<MEM>` 이어야 한다.

**실행 14-나**
```
/dflow-poll --interval 300 --until <종료시각>
```

**기대**
1. 시작 직후 「폴링 시작」 통지가 뜨고, 태그 없는 작업은 「수동 대기 N건」으로만 알린다.
2. **`<SU>` 에게 배정된 선행 공정은 목록에 아예 뜨지 않는다.** 폴링은 `list --scope assigned`, 곧 자기에게 배정된 것만 보기 때문이다.
3. 태그가 켜진 `<MEM>` 의 작업 1건을 자동으로 잡아 `/dflow-dev` 사이클을 돈다.
4. 사이클이 끝나면 승인 대기로 보고하고 감시로 돌아간다.
5. `<SU>` 로 웹에서 승인을 누르면, 다음 감시 주기에 승인을 감지하고(종료 코드 9) 머지 스윕을 돈 뒤 재개한다.

**확인**: 두 가지를 본다.
- **승인 감지가 자동으로 일어나는가.** 5분을 기다려도 반응이 없으면 「승인했어」라고 직접 알려 주고, 그 사실을 기록한다.
- **일반 사용자 권한으로 claim·진행 보고·완료 보고가 전부 통과하는가.** 여기서 403 이 나오면 일반 사용자는 에이전트 루프를 돌 수 없다는 뜻이고, 그것은 신규 발견이므로 응답 본문을 그대로 기록한다.

**실패 시**: 기록하고 계속한다. 3번까지 됐으면 이 단계의 목적은 절반 이상 달성한 것이다.

**결과**: [ ] 통과  [ ] 실패  비고:

---

### 단계 15. 반려 재작업 1건

이미 알려진 결함이 가장 많이 몰려 있는 구간이다. 통과를 기대하지 말고 **무엇이 어떻게 깨지는지를 기록하는 것**이 목적이다.

**실행**
0. 단계 14 의 폴링이 아직 돌고 있으면, 반려를 누르기 **전에** 상태를 하나 확인하고 넘어간다. 폴링을 그대로 둔 채 반려하면 폴링의 반려 감지(종료 코드 10)와 사람의 수동 재실행이 같은 작업을 놓고 경합한다. 순서는 다음과 같다. 먼저 반려를 누르고 **한 주기(5분)를 기다려** 폴링이 스스로 반려를 감지하는지 본다. 감지 여부를 기록한 뒤에 「중지」로 폴링을 멈추고, 그다음에 수동 재실행으로 넘어간다. 이 관찰이 R3 의 실제 시험이다.
1. 단계 14 에서 승인 대기 상태가 된 작업을 **`<MEM>` 으로 로그인해 직접 반려한다.** 반려는 담당자 본인도 할 수 있는 것이 설계다. 버튼이 보이지 않으면 그것이 발견이므로 기록하고, `<SU>` 로 바꿔 반려한다.
2. 반려 사유에 수용 기준을 하나 추가로 적는다(예: 「용어 중복 검사에 대소문자 무시 규칙을 추가할 것」).
3. 같은 화면에서 **`<MEM>` 에게 승인 버튼이 보이는지도 함께 본다.** 리프 담당자 본인은 자기 작업을 승인하지 못하는 것이 설계이므로, 승인 버튼이 보이면 신규 발견이다.
4. Claude 에게 재작업을 시킨다: `/dflow-dev <그 작업 번호>`

**기대(설계상)**: 반려가 감지되어 같은 `agent/` 브랜치 위에서 재작업이 이어지고, 추가된 수용 기준이 반영된다.

**확인**: 다음 셋을 각각 본다.
- 서버 stage 가 `ip` 로 되돌아갔는가. **되돌아가지 않는 것이 기지 결함이다**(§3 의 C).
- 재작업 사이클이 반려 사유에 적은 **새 수용 기준을 읽었는가.** spec 캐시는 claim 시점 1회 스냅샷이라 개정이 반영되지 않는 경로가 있다(§3 의 E).
- `state.json` 의 `phase` 가 `rejected` 로 바뀐 뒤에도 폴링이 그 작업을 다시 잡는가(§3 의 R3).

**실패 시**: 기록하고 계속한다. 재작업이 막히면 그 작업은 사람이 직접 마무리하고 다음 단계로 넘어간다.

**결과**: [ ] 통과  [ ] 실패  비고:

---

### 단계 16. 병렬 실행 2건 (`/dflow-team`, pane(tmux) 백엔드)

**사전 조건**: 작업트리가 깨끗하고, 현재 브랜치가 기본 브랜치여야 한다. 스킬 push 는 단계 2 에서 이미 끝났으므로 여기서는 확인만 한다. 이 단계는 `<MEM>` 신원으로 돈다(단계 14 에서 토큰 순서를 뒤집었고, `/dflow-team` 역시 첫 토큰만 쓴다).

```bash
cd <REPO>
git status --porcelain                       # 출력이 없어야 한다
git rev-parse --abbrev-ref HEAD              # main 이어야 한다
git ls-tree -r --name-only origin/main | grep -c '^\.claude/skills/'   # 0 이 아니어야 한다
```

#### 백엔드 둘 중 하나만 실제로 시험된다

이 스킬이 구분하는 백엔드는 **pane(tmux)** 와 **pane(Orca)** 둘이다. 감지가 tmux 를 먼저 보므로, tmux 가 깔린 PC 에서는 Orca 안에서 띄워도 tmux 로 떨어진다.

| 실행 환경 | 감지 결과 | 이번 주행 |
|---|---|---|
| 일반 터미널·tmux·Orca (tmux 가 깔림) | **pane(tmux)** | **시험한다** |
| Orca (tmux 없음) | pane(Orca) | 이 PC 에서 재현할 수 없다. 건너뛰고 기록한다(R15) |
| tmux 도 Orca 도 없음 | `FAIL NO_TMUX` 로 시작 거부 | 별도로 한 번 확인한다(아래 16-다) |

2026-09-16 에 `nohup claude -p` 프로세스 백엔드를 없앴다. 기능이 모자라서가 아니라 **사람이 끼어들 자리가 없었기 때문**이다. 권한 확인 프롬프트를 띄울 수 없고, 팀원 화면이 없으며, `blocked` 답이 재spawn 이라 팀원이 쌓아 둔 맥락을 잃고, 사람이 팀원 자리에 앉아 이어받을 수도 없었다. tmux pane 팀원은 넷 모두 해당하지 않는다.

**tmux 로 옮기면서 새로 생긴 위험 둘이 이 단계의 주된 관찰 지점이다.** 둘 다 대화형으로 바꿨기 때문에 생기며, 종전 프로세스 백엔드에는 없던 것이다.

1. **폴더 신뢰 확인**이 `--dangerously-skip-permissions` 로 넘어가지 않는다. 팀장이 화면을 읽어 `send-keys` 로 통과시키는데, 이 판정이 화면 문자열에 기대므로 Claude Code 판본이 문구를 바꾸면 깨진다. 깨지면 팀원이 첫 화면에서 멈춘 채 살아 있어 슬롯 하나가 통째로 논다.
2. **팀장 환경 상속**. `CLAUDE_CODE_CHILD_SESSION` 이 넘어가면 팀원의 대화 기록이 저장되지 않는다. `.dflow-run` 이 `CLAUDE_CODE_*`·`ORCA_*` 를 접두째 벗기는데, 그것이 실제로 들었는지는 팀원 화면에 `Transcript saving is off` 가 **없는지**로 본다.

**실행 전 환경 확인**
```bash
printf 'TERM_PROGRAM=%s ORCA_WORKTREE_ID=%s TMUX=%s\n' "${TERM_PROGRAM-}" "${ORCA_WORKTREE_ID-}" "${TMUX-}"
command -v tmux; /opt/homebrew/bin/tmux -V 2>/dev/null
/opt/homebrew/bin/tmux -L dflow has-session -t dflow 2>/dev/null && echo "이미 세션 있음 — 먼저 정리한다" || echo "소켓 비어 있음"
```

`command -v tmux` 가 `~/.orca/claude-agent-teams-bin/tmux` 를 가리키면 그것은 **Orca 의 shim** 이다. 스킬은 절대경로 후보를 훑어 진짜 tmux 를 찾으므로 정상이지만, 사람이 손으로 확인할 때는 절대경로를 써야 한다.

#### 16-가. pane(tmux) 주행

**실행**
```
/dflow-team 2명 <종료시각>
```

**기대**
1. 전제 검사가 `PRECHECK_OK lead_pid=… BACKEND=tmux TM=/opt/homebrew/bin/tmux` 로 통과한다. `TM` 이 shim 경로(`claude-agent-teams-bin`)가 아니어야 한다.
2. 시작 보고에 "팀원은 권한 확인 생략 모드로 돕니다" 와 `TMUX= tmux -L dflow attach` 두 줄이 나온다.
3. 팀장 잠금(`dflow-team.lock`)이 잡힌다.
4. 워크트리 `dflow-<id8>` 두 개가 `origin/main` 기점으로 생기고, 각 워크트리에 `.dflow-prompt`·`.dflow-run`·`.dflow-pane` 이 있다.
5. tmux 소켓 `dflow` 에 pane 두 개가 `tiled` 로 나뉜다.
6. **폴더 신뢰 확인이 자동으로 통과된다.** 팀원이 그 화면에서 멈춰 있지 않다.
7. 팀원 화면에 `Transcript saving is off` 가 **없다**.
8. 각 팀원이 자기 워크트리에서 `agent/<id8>-<slug>` 브랜치를 만든다.
9. D'Flow 좌석표(`/agents`)에 슬롯이 표시된다.
10. 팀원이 끝나면 `.result` 가 남고, 팀장이 그것을 한 번만 처리한 뒤 `kill-pane` 으로 거둔다.
11. 팀장이 기상할 때마다 승인 스윕(`/dflow-merge`)을 직접 돈다.

**확인**
```bash
TM=/opt/homebrew/bin/tmux
"$TM" -L dflow list-panes -a -F '#{pane_id} #{pane_dead} #{pane_start_path}'
cd <REPO> && git worktree list && ls -a .claude/worktrees/*/ 2>/dev/null | grep dflow
"$TM" -L dflow capture-pane -p -t <pane> | tail -30      # 팀원 화면을 눈으로 본다
```

**사람이 붙어서 보기**: `TMUX= tmux -L dflow attach`. `Ctrl-b z` 로 pane 하나를 확대한다. `Ctrl-b d` 로 뗀다.

**`blocked` 답 시험**: 팀원이 `blocked` 로 멈추면 팀장에게 `<id8> <답>` 으로 답해 본다. 팀장이 `send-keys -l --` 로 그 pane 에 넣고, 팀원이 **맥락을 유지한 채** 이어 가는지 본다(재spawn 이 아니다). 답이 오지 않으면 직접 pane 에 쳐도 되는지도 함께 본다.

**실패 시**
- `NO_TMUX`: tmux 가 없거나 후보 경로 밖에 있다. `find_tmux` 의 후보는 `/opt/homebrew/bin`·`/usr/local/bin`·`/usr/bin`·`command -v` 넷이다.
- `NO_CLAUDE_CLI`: `claude` 가 PATH 에 없다. pane 이 뜨자마자 죽고 `#{pane_dead_status}` 가 `127` 이면 같은 원인이다.
- `KIT_NOT_PUSHED`: 위 사전 조건의 push 를 빠뜨린 것이다.
- **팀원이 첫 화면에서 멈춰 있으면** 폴더 신뢰 확인 판정이 깨진 것이다. 그 화면의 실제 문구를 기록한다. 판정이 기대하는 문자열은 `I trust this folder` 와 `bypass permissions on` 둘이다. 이것이 이 단계의 가장 값진 소득이 될 수 있다.
- **팀원 화면에 `Transcript saving is off` 가 뜨면** `.dflow-run` 의 환경 벗기기가 듣지 않은 것이다. 그 pane 에서 `env | grep CLAUDE_CODE_` 를 쳐서 무엇이 남았는지 기록한다.
- 감지가 `BACKEND=orca` 로 떨어지면 `find_tmux` 가 진짜 tmux 를 놓친 것이다. 그 자리에서 멈추고 `command -v tmux` 와 후보 경로들의 실제 내용을 기록한다.

**결과**: [ ] 통과  [ ] 실패  비고:

#### 16-나. pane(Orca) — 이번 주행에서는 건너뛴다

tmux 가 깔린 PC 에서는 이 갈래로 떨어지지 않는다. 시험하려면 `find_tmux` 후보 경로 넷에서 tmux 를 모두 치워야 하는데, 그것은 이 PC 의 다른 작업을 망가뜨린다. **건너뛰고 R15 에 기록한다.**

#### 16-다. `NO_TMUX` 거부 확인 (30초)

시작을 거부하는 갈래는 팀을 띄우지 않으므로 안전하게 확인할 수 있다. 빈 `PATH` 로 전제 검사의 감지 부분만 돌려 본다.

```bash
env -i PATH=/nonexistent HOME="$HOME" sh -c '
  for c in /opt/homebrew/bin/tmux /usr/local/bin/tmux /usr/bin/tmux; do
    [ -x "$c" ] && echo "후보 살아 있음: $c"
  done'
```

후보 절대경로가 실재하는 PC 에서는 이 갈래가 재현되지 않는다. tmux 가 없는 PC 에서 별도로 확인하고, 그때까지는 **미확인**으로 남긴다.

**결과**: [ ] 통과  [ ] 실패  비고:

**이 단계가 남기는 것**: 워크트리 2개, `agent/*` 브랜치, 좌석표 항목, `dflow-team.lock`, tmux 소켓 `dflow`(마감이 `kill-server` 로 거둔다).

---

### 단계 17. 마감

**실행**: 종료 시각이 지나면 팀장이 스스로 새 배정을 멈춘다. 남은 것을 확인한다.

```
승인했다. 머지해라.
```

**기대**: 승인된 작업이 조상 순서대로 `main` 에 합쳐지고, 남은 승인 대기 작업은 목록으로 보고된다. 살아 있는 팀원의 워크트리는 지워지지 않는다.

**확인**
```bash
cd <REPO> && git log --oneline --graph -15 && npx vitest --run
```

**결과**: [ ] 통과  [ ] 실패  비고:

---

## 2. 정리 (teardown)

2회차 주행이 더러운 상태에서 시작하지 않도록 **역순으로** 치운다.

```bash
# 1) tmux 소켓 — 살아 있는 팀원이 없는지 먼저 보고 서버째 거둔다
TM=/opt/homebrew/bin/tmux
"$TM" -L dflow list-panes -a -F '#{pane_id} #{pane_dead} #{pane_start_path}'
"$TM" -L dflow kill-server 2>/dev/null

# 2) 팀원 워크트리
cd <REPO>
git worktree remove --force .claude/worktrees/dflow-*   # 있을 때만

# 3) 팀장 잠금과 부산물
rm -rf dflow-team.lock .dflow-prompt .dflow-pane .dflow-run .dflow-agent 2>/dev/null
git worktree prune

# 4) 머지된 agent 브랜치
git branch --merged main | grep '^  agent/' | xargs -r git branch -d
git push origin --delete <남은 원격 agent 브랜치>   # 있을 때만

# 5) 캐시 — 목록 캐시와 신원 캐시 둘 다
rm -f ~/.cache/dflow/last-list.json ~/.cache/dflow/profiles.json
```

5번에서 신원 캐시까지 지우는 이유가 있다. 이 캐시는 토큰 접두와 이메일의 대응을 들고 있어서, 다음 주행에서 PAT 를 새로 발급하면 옛 대응이 남아 `--as` 가 엉뚱하게 풀린다.

웹 화면에서 할 일:

1. `/account` 에서 시험용 PAT 를 폐기한다. **두 계정 각각으로 로그인해서 각자 폐기해야 한다.**
2. 프로젝트 설정에서 「에이전트 끄기」로 되돌린다. `<MEM>` 의 프로젝트 멤버 등록도 함께 정리한다.
3. 프로젝트 자체는 남겨 두어도 된다. 2회차 주행을 같은 프로젝트에서 하려면 WBS 를 지우고 다시 올려야 하므로, **새 프로젝트를 만드는 편이 깨끗하다.**

로컬 리포(`<REPO>`)와 GitHub 원격은 시험 기록이므로 바로 지우지 않는다. 지울 때는 `gh repo delete <GH>` 를 사람이 직접 실행한다.

---

## 3. 기지 결함 목록

주행 중에 아래가 발생하면 **신규 결함이 아니다.** 발생 여부만 표시하고 넘어간다. 여기에 없는 실패가 신규 발견이다.

| 코드 | 내용 | 나타나는 단계 | 발생 |
|---|---|---|---|
| R1 | 담당자가 배정되지 않은 작업은 폴링이 영원히 보지 못하고, 화면에도 아무 표시가 뜨지 않는다 | 11, 14 | [ ] |
| R2 | 자동 착수 전제 다섯 가지(리프·`dev_workflow`·`agent` 태그·spec·담당자) 중 하나만 빠져도 무음으로 제외된다 | 11 | [ ] |
| R3 | `state.json` 의 `phase` 가 `rejected` 가 되는 순간 이후 폴링에 잡히지 않는 사각지대가 있다 | 15 | [ ] |
| R4 | `dflow-wbs` 동봉 검증기는 3단계 헤딩만 읽어서, 4단계 WBS 에서 `task_count 0` 인데 `ok:true` 로 통과처럼 보인다 | 7 | [ ] |
| R5 | `dflow.sh doctor` 는 토큰이 1개일 때 검사 루프를 0회 돌고도 종료 코드 0 을 낸다 | 4 | [ ] |
| R6 | `state.json` 의 `order` 를 8자로 기록하면 승인 후 스윕이 그 주문을 못 찾는다 | 12 | [ ] |
| R7 | `api_base` 가 어긋나면 스윕이 「건너뜀(다른 D'Flow)」으로 조용히 넘어간다 | 13 | [ ] |
| R8 | `done` 에서 `--auto-links` 를 빠뜨리면 증적이 `{}` 로 영구 고정되어 후속 선행 판정이 막힌다 | 12 | [ ] |
| R9 | `--as` 를 서브커맨드 뒤에 붙이면 오류 없이 첫 토큰의 신원으로 실행된다 | 4, 11 | [ ] |
| R10 | `--as` 는 이메일 부분 일치라서, 짧은 문자열이 두 계정에 걸리면 앞 토큰이 조용히 이긴다 | 4, 11 | [ ] |
| R11 | 프로필 캐시(`~/.cache/dflow/profiles.json`)는 토큰 접두와 이메일의 대응을 들고 있어서, PAT 를 재발급하면 `--as` 가 옛 대응으로 풀릴 수 있다. 만료 기한이 없다 | 4 | [ ] |
| R12 | 목록 캐시가 신원과 무관하게 공유되어, 신원을 바꾼 직후 순번을 쓰면 앞 신원의 목록에서 풀린다 | 11, 14 | [ ] |
| R13 | 팀이 도는 중에 `.env` 를 바꾸면 심링크를 통해 이미 떠 있는 팀원의 신원까지 즉시 바뀐다 | 14, 16 | [ ] |
| R14 | `--as` 매칭 실패와 그 토큰의 인증 깨짐이 같은 메시지(「프로필을 찾지 못했습니다」)로 보인다 | 4 | [ ] |
| R15 | tmux 가 깔린 PC 에서는 감지가 언제나 tmux 로 떨어져 pane(Orca) 갈래를 주행에서 시험할 수 없다. 그 코드 경로는 tmux 없는 Orca 환경 전용인데, 그런 조합이 실제로 있는지도 확인된 바 없다 | 16 | [ ] |
| C | 반려가 stage 를 되돌리지 않아, 반려된 코드 위에서 후행 체인이 계속 자란다 | 15 | [ ] |
| E | spec 캐시는 claim 시점 1회 스냅샷이고 해시가 없어서, 반려 후 개정된 수용 기준이 반영되지 않는 경로가 있다 | 15 | [ ] |
| F | 진행률 25·60·85 는 근거 없는 관례 수치인데 그대로 실적(`actual_pct`)이 된다 | 12, 14 | [ ] |
| D | 사이클 도중 에이전트가 사람에게 질문할 정식 채널이 없다(`heartbeat --phase blocked` 로 우회) | 12, 16 | [ ] |
| A | 검사 도구가 「0건 읽음」과 「문제 없음」을 구분하지 못하고 둘 다 0 으로 끝난다 | 7 | [ ] |

R9 부터 R14 까지 여섯은 다중 신원 구성에서만 나타난다. 이 계열의 성격을 한 줄로 정리하면 이렇다. **쓰기 계열(claim·progress·done·release)과 폴링·팀 오케스트레이션은 전부 「그 순간 `.env` 가 가리키는 단일 신원」을 전제로 짜여 있다.** 동시에 여러 신원을 다루는 것은 `list --all` 과 `doctor` 만 지원한다. 그래서 이 계열의 사고는 거의 전부 「지금 어느 토큰이 첫 번째인지 사람이 착각」하는 형태로 나타나고, 스크립트 쪽 안전장치는 서버의 `not_assignee` 검사 하나뿐이다.

### 권한 경계에서 함께 볼 지점 (선택)

단계 10 이 주된 시험이고, 여유가 있으면 아래도 같이 확인한다. 전부 **거부되는 것이 정상**이다.

| 확인 | 기대 |
|---|---|
| `<MEM>` 이 자기에게 배정되지 않은 작업을 claim | 403 `not_assignee` (종료 코드 5) |
| `<MEM>` 이 `/p/<PROJECT_ID>/members` 에서 권한 편집 | 편집 UI 자체가 보이지 않는다 |
| 프로젝트의 「에이전트 끄기」 상태에서 `<SU>` 가 API 호출 | 관리자여도 404 (킬 스위치) |
| `<SU>` 가 `<MEM>` 을 관리자로 승격 | 성공한다. 관리자 부여는 슈퍼유저만 할 수 있다 |

근거: `docs/agent/2026-08-26-agent-dev-review.md`. 작성일이 2026-08-26 이고 `/dflow-team` 설계는 09-10 이므로, 일부 항목은 이미 고쳐졌을 수 있다. **이번 주행이 그 확인을 겸한다.**

---

## 4. 주행 요약 기록지

주행을 마치면 아래를 채운다. 이것이 다음 개선 작업의 입력이다.

| 항목 | 값 |
|---|---|
| 주행 일자 | |
| 단계 통과 수 | / 17 |
| 사람이 개입한 횟수 | |
| 신원을 잘못 써서 생긴 실패 | |
| 일반 사용자 권한으로 막힌 지점 | |
| 개입 사유 (계획에 없던 것만) | |
| 신규 발견 결함 | |
| 재현된 기지 결함 | |
| 총 소요 시간 | |
| 에이전트 실제 실행 시간의 비율 | |
| 최종 테스트 수·통과 수 (단계 17 의 `npx vitest --run`) | |

마지막 줄이 중요하다. 이 루프에서 에이전트가 스스로 쓰지 않은 외부 증거는 **테스트 통과 여부와 사람의 승인 클릭 둘뿐**이다. 설계 문서, 상태 파일, 커밋 메시지, 진행률은 전부 에이전트 자신이 쓴 것이다.

비교 기준: mes-runlog 8작업 주행에서는 완주율이 8/8 이었지만 **사람 개입 없이 끝난 사이클은 0건**이었고, 계획에 없던 개입이 6/8, 에이전트 실제 실행 시간은 활동 구간의 48% 였다.

---

## 5. 명령 모음

`<REPO>` 루트에서 실행한다. `dflow.sh` 는 항상 `.env` 를 앞에 붙여 부른다.

```bash
D=.claude/skills/dflow-work/scripts/dflow.sh
E='set -a; . ./.env; set +a'
SU=jongik.jang@dongkuk.com
MEM=yoo7032@gmail.com

(eval "$E"; $D me)                          # 첫 토큰의 신원·접근 프로젝트
(eval "$E"; $D --as "$MEM" me)              # 다른 신원으로 같은 조회
(eval "$E"; $D --as "$SU" list --scope assigned)
(eval "$E"; $D --as "$MEM" list --scope assigned)
(eval "$E"; $D show 1)                      # 상세(선행 증적 포함)
(eval "$E"; $D claim 1)                     # 착수
(eval "$E"; $D progress 1 50 "중간 보고")     # 진행 보고
(eval "$E"; $D done 1 "요약" --auto-links)   # 완료 보고(push 선행 필수)
(eval "$E"; $D release 1)                   # 착수 취소
```

종료 코드: 0 성공, 2 사용법·설정·push 미완료, 3 인증 실패, 4 선행·상태로 진행 불가, 5 권한 부족, 6 네트워크·서버, 7 기능 꺼짐.

`--as` 에 관한 세 가지를 기억한다.

1. **반드시 서브커맨드 앞**에 둔다. 뒤에 붙이면 오류 없이 첫 토큰의 신원으로 실행된다.
2. 값은 **전체 이메일**로 적는다. 부분 일치라서 짧은 문자열은 두 계정에 걸릴 수 있다.
3. `/dflow-poll`·`/dflow-team`·`/dflow-export` 는 `--as` 를 받지 않는다. 그 셋의 신원을 바꾸려면 `.env` 의 `DFLOW_PATS` 순서를 바꾼다.
