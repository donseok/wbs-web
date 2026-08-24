# mes-runlog 리허설 런북 — D'Flow 개발 루프 실전 검증

> 작성 2026-08-24 (개정 2 — 다른 PC 전제). 목적: 문서 작업으로만 검증된 dflow 루프
> (wbs 생성 → 웹 업로드 → poll → dev → 승인 → merge)를 **코드 작업**으로 처음부터 끝까지 밟는다.
> **전제: wbs-web 리포가 없는 PC 에서 한다.** 스킬은 dflow-kit 으로 받고, 세션은 mes-runlog 리포에서 연다.
> 이 Mac 에서 하더라도 세션 중 wbs-web 경로를 읽으면 그 자체가 결함 기록 대상이다.
> 스킬 설명은 wbs-web `docs/agent/claude-skill/dflow-skills-guide.md`, 여기는 "무엇을 어디서 어떤 말로" 만 적는다.

## 0. 고정 결정

| 항목 | 결정 |
|---|---|
| 프로젝트 | **설비 가동 이력(Equipment Run Log)** — 설비 마스터 → 가동/정지 이벤트 → 일별 가동률 → 화면 2장 |
| 스택 | **Next.js 15 풀스택 + SQLite(better-sqlite3 + Drizzle) + vitest + Playwright** — 외부 DB·Docker 없음. ADR 스택(Spring Boot)은 이번 대상 아님 |
| 코드 리포 | `~/project/mes-runlog` 신규 (GitHub private `jongik-sv/mes-runlog`) |
| 스킬 | **dflow-kit** (`github.com/jongik-sv/dflow-kit`, private) → `install.sh` 로 리포에 심음. wbs-web 참조 0 |
| WBS 문서 | `~/project/mes-runlog/docs/runlog/` (prd.md · programs.md · wbs.md) — 리포에 커밋, 업로드 후 wbs.md 은퇴 |
| D'Flow | **스테이징(dflow-staging.vercel.app)** 신규 프로젝트 `설비가동이력(리허설)`. 운영 안 씀 |
| 에이전트 신원 | 이 리허설용으로 **새로 발급한 PAT**(기존 wbs-web `.env` 토큰 재사용 안 함). 배정도 본인 email |
| Claude 세션 | **cwd = `~/project/mes-runlog`** — 스킬이 프로젝트 스코프(`.claude/skills/`)라 리포 루트여야 한다 |

표기: **[터미널]** = 직접 셸, **[웹]** = 스테이징 브라우저, **[Claude]** = mes-runlog 에서 연 Claude Code 세션에 입력할 프롬프트(회색 상자 그대로 복사).

선행 완료(2026-08-24, wbs-web 있는 PC 에서 1회): 스킬 정본 경로 정비 + dflow-kit 빌드·push. 이후 킷 갱신은
wbs-web `scripts/kit-build.sh ~/dflow-kit` → dflow-kit 커밋·push.

---

## 1. 사전 점검 (10분) — 환경 문제와 루프 문제를 분리하기 위해

| 확인 | 왜 | 방법 |
|---|---|---|
| 스테이징 웹 로그인 | 프로젝트 생성·승인은 웹에서 | dflow-staging.vercel.app 슈퍼유저 계정 |
| **PAT 발급** | 에이전트 신원. 없으면 모든 호출 exit 3 | `/account` "내 토큰" → 발급 → 복사(§2-2 에서 `.env` 에 넣음) |
| `gh auth status` | 리포 생성, `done --auto-links` 의 push·PR URL 수집 | [터미널] |
| `jq` `curl` `python3` `git` | dflow.sh·poll.sh·nlevel 스크립트 의존 | `install.sh` 가 검사하고 없으면 exit 2 |
| 위임 토글 배포됨 | §3-4 검증 대상 | 아무 프로젝트 WBS → 작업 행 → 명세 패널에 "에이전트 위임" 체크박스 (없으면 staging `9cb06c2` 배포 확인) |

- [ ] 전부 통과

---

## 2. P0 — 준비 (반나절)

### 2-1. D'Flow 프로젝트 생성 [웹]

1. `/projects` → 새 프로젝트: 이름 `설비가동이력(리허설)`, 기간 오늘~+3주
2. 생성 후 URL `/p/<UUID>/…` 에서 **UUID 복사**
3. `/p/<UUID>/members` — 본인이 관리자인지 확인
4. ~~agent-ops 등록~~ — **불필요(2026-08-24 개정)**. task 가 있는 wbs.md 업로드·위임 체크가 프로젝트를 자동 활성하고, 늦게 활성돼도 백필이 주문을 채운다

- [ ] UUID: `________________________________`
- [ ] (등록 단계 없음 — 설정 › 에이전트 카드가 "아직 위임 없음" 이면 정상)

### 2-2. 리포 + 킷 설치 [터미널] — Claude 세션을 열기 **전에**

```
mkdir -p ~/project/mes-runlog && cd ~/project/mes-runlog && git init -b main
git clone git@github.com:jongik-sv/dflow-kit.git ~/dflow-kit      # 이미 있으면 git -C ~/dflow-kit pull
~/dflow-kit/install.sh ~/project/mes-runlog
```

`.env` 를 열어 3키 기입 (값은 어디에도 붙여넣지 말 것):
```
DFLOW_API_BASE=https://dflow-staging.vercel.app
DFLOW_PATS=<§1 에서 발급한 PAT>
DFLOW_PROJECT_ID=<2-1 UUID>
```

```
cd ~/project/mes-runlog && (set -a; . ./.env; set +a; .claude/skills/dflow-work/scripts/dflow.sh doctor)
```

- [ ] `doctor`: `base: https://dflow-staging.vercel.app`, exit 0 (운영 URL 이 찍히면 즉시 중단·`.env` 수정)
- [ ] `.gitignore` 에 `.env` 있음, `.claude/skills/` 에 dflow-* 6개
- [ ] 여기서부터 **Claude Code 를 `~/project/mes-runlog` 에서 연다**

### 2-3. 리포 초기 커밋 [Claude]

```
[Claude]
이 리포를 초기화해줘: README.md(설비 가동 이력 서비스 한 줄 소개)와 .gitignore(node·sqlite data/ 포함) 만 만들고,
.claude/skills/ 킷과 함께 main 첫 커밋, GitHub private jongik-sv/mes-runlog 로 push.
스캐폴드는 WBS 작업으로 할 거니까 코드는 넣지 마. .env 는 절대 커밋하지 마.
```

- [ ] github.com/jongik-sv/mes-runlog 에 main 1커밋, `.claude/skills/` 포함, `.env` 미포함

### 2-4. PRD·프로그램 목록 [Claude → 나 검토]

```
[Claude]
docs/runlog/prd.md 와 docs/runlog/programs.md 를 만들어줘.
도메인은 설비 가동 이력: 설비 마스터(코드·이름·라인·상태), 가동/정지 이벤트 등록(설비·시각·구분·사유),
일별 가동률 집계(설비별·기간), 화면은 설비 목록과 가동 이력/가동률 두 장.
스택은 Next.js 15 App Router + SQLite(better-sqlite3) + Drizzle + vitest + Playwright, 단일 리포.
DB 파일은 data/ 에 두고 git 제외, 마이그레이션은 drizzle-kit.
PRD 는 2쪽 이내, 프로그램 목록은 6건(스캐폴드·DB 스키마·설비 CRUD API·이벤트 등록 API·가동률 집계 API·화면 2장 중
목록 화면과 이력 화면)으로 dflow-wbs-nlevel 의 --programs 입력 형식에 맞춰줘.
```

- [ ] prd.md 검토 — 가동률 정의(기간 경계·계획정지 처리)는 **일부러 애매하게 남긴다** (S1 반려 재료)
- [ ] programs.md 6건 확인

---

## 3. P1 — WBS 생성·업로드 (1시간)

### 3-1. wbs.md 생성 [Claude]

```
[Claude]
/dflow-wbs-nlevel docs/runlog --programs docs/runlog/programs.md --start-date <다음 월요일>
골격이 없는 소형 프로젝트라 골격 파일 없이 단일 wbs.md 로 만들어줘. levels 는 Phase/WP/Task 3층(임시 사본 규칙 적용),
module 은 runlog, 모든 Task 의 assignee 는 jjinie73@gmail.com.
Task 8건: TSK-00-01 스캐폴드(infra) · TSK-00-02 DB 스키마(design, ←00-01) · TSK-01-01 설비 CRUD API(dev, ←00-02)
· TSK-01-02 이벤트 등록 API(dev, ←01-01) · TSK-01-03 일별 가동률 집계 API(dev, ←01-02) · TSK-02-01 설비 목록 화면(dev, ←01-01)
· TSK-02-02 가동 이력·가동률 화면(dev, ←01-03,02-01) · TSK-03-01 E2E 통합테스트(itest, ←전부).
tags 는 TSK-00-01 과 TSK-00-02 에만 agent 를 미리 넣어줘 (나머지는 웹에서 내가 켠다).
```

- [ ] `docs/runlog/wbs.md` 생성, frontmatter 에 `module: runlog` + `levels:` 3층
- [ ] Task 8건 각각 `category/depends/requirements/acceptance` 채워짐 (spec 비면 착수 불가 판정 난다)
- 스킬이 "골격 선행" 을 이유로 거부하면 → **결함 기록(소형 프로젝트 경로 부재)** 후 "그럼 네가 계약대로 손으로 써줘" 로 폴백

### 3-2. 로컬 사전 검증 [Claude]

```
[Claude]
방금 만든 docs/runlog/wbs.md 를 nlevel 검증 스크립트(wbs-nlevel-parse.py validate)로 검증하고
노드 수·Task 수·경고를 보여줘. 업로드는 하지 마 — 내가 웹에서 한다.
```

- [ ] 검증 통과. 노드 수 `___` / Task `8` 기록 (웹 미리보기와 대조용)

### 3-3. 웹 업로드 [웹] ← **리허설 검증 대상**

1. `/p/<UUID>/import` → 모드 "WBS 마크다운 업로드 (wbs.md)"
2. 파일 선택 `~/project/mes-runlog/docs/runlog/wbs.md` → **미리보기**
3. 미리보기: 종류=골격(PMO), module=runlog, levels=seed, 신규 N, 에러 0
4. **적용** → upserted N, 주문 생성 **8**, unmatched 0

- [ ] 미리보기 신규 수 == 3-2 노드 수
- [ ] 주문 생성 8 (0 이면 결과 카드에 원인 경고가 뜬다 — "에이전트 중지" 상태면 설정 › 에이전트 › 재개)
- [ ] unmatched 0 (있으면 email 오타 → WBS 화면에서 배정)
- [ ] `/p/<UUID>/wbs` 에 8건, 명세 패널에 spec 본문 있음

### 3-4. 위임 플래그 [웹] ← **토글 검증**

`/p/<UUID>/wbs` → 행 클릭 → 명세 패널:
- TSK-00-01, 00-02: 이미 체크돼 있어야 함 (wbs.md tags 로 들어옴)
- TSK-01-01, 01-03, 02-01, 03-01: **"에이전트 위임" 체크**
- TSK-01-02, 02-02: **체크 안 함** (수동 경로)

- [ ] 체크 후 태그 배지에 `agent`, 새로고침해도 유지

### 3-5. 서버 반영 확인 [Claude]

```
[Claude]
내 D'Flow 할당 작업 목록 보여줘. 설비가동이력 프로젝트 8건만 골라서 각 작업의 tags 도 show 로 확인해줘.
```
기대: RD 1건(TSK-00-01 만 ready), agent 태그 6건. (목록에 다른 프로젝트 작업이 섞여 나옴 — PAT 가 사용자 단위. 필터 없음은 기록)

---

## 4. P2 — 실행 루프 (1.5~2일, 승인 대기 포함)

**원칙**: 세션은 한 번에 사이클 하나. 폴링은 감시만 하고 사이클을 시작시킨다. **수동 `/dflow-dev` 는 자동 사이클이
돌고 있지 않을 때** 친다 — 같은 워킹트리라 두 브랜치를 동시에 못 만진다.

### 4-1. 폴링 시작 [Claude]

```
[Claude]
/dflow-poll --interval 120 --until 18:00
```
기대: "감시 시작(agent 태그만)" → TSK-00-01 감지 → `/dflow-dev` 자동 착수 → 설계→TDD→검증→push→**"승인 대기로 보고했습니다"**.
사이클마다 §6 기록표에 적는다. ready 가 태그 없는 것뿐이면 "수동 대기 N건" 통지 — 정상.

### 4-2. 승인 → 머지 → 후속 (TSK-00-01, 00-02) [웹 → Claude]

reported 되면:
1. [웹] 사이드바 **승인 대기함**(`/agent-ops`) → "승인 대기" 컬럼 → 보고 링크(브랜치·SHA) 확인 → **승인**
2. [Claude]
```
[Claude]
TSK-00-01 승인했어. 머지해.
```
기대: `/dflow-merge` 가 approved 확인 → `--no-ff` 머지 → push → 브랜치 정리 → 폴링이 TSK-00-02 감지·착수.

- [ ] mes-runlog main 에 머지 커밋, agent 브랜치 삭제
- [ ] 후속 착수 시 Phase 0 에 "선행 evidence ancestor 확인" 판정 보임

TSK-00-02 도 같은 방식. **TSK-01-01 은 reported 가 되어도 승인하지 않고 둔다** (다음 단계 재료).

### 4-3. 스택 브랜치 — TSK-02-01 (S2)

TSK-01-01 reported 상태에서 TSK-02-01(←01-01) 이 ready 로 뜨면 폴링이 착수 시도:
- 기대: Phase 0 "선행 미승인·로컬 산출물 실재 → 스택 브랜치", `agent/<01-01>` 위에 브랜치, state.json 에 `branch_base`·`risk`
- [ ] 판정 문구 기록
- [ ] TSK-02-01 reported 까지 진행

### 4-4. 조상 순서 머지 + 수동 경로 (S2 후반, S5)

1. [웹] TSK-01-01 **승인** (02-01 은 아직 미승인)
2. [Claude]
```
[Claude]
TSK-01-01 승인했어. 머지해.
```
- [ ] 01-01 만 머지, 02-01 은 "미승인" 으로 대기하는지
3. TSK-01-02(←01-01) 가 ready → 태그 없으니 폴링은 "수동 대기 1건" 만 알림. 자동 사이클이 없는 걸 확인하고:
```
[Claude]
/dflow-dev TSK-01-02
```
- [ ] 태그 없어도 착수됨(수동은 태그 무관), reported 까지
4. [웹] TSK-02-01 승인 → "TSK-02-01 승인했어. 머지해."
- [ ] 조상(01-01)이 이미 main 이라 02-01 이 깨끗이 머지되는지

### 4-5. 반려 재작업 — TSK-01-03 (S1)

TSK-01-02 승인·머지 후 TSK-01-03(가동률 집계, agent) 이 자동 착수 → reported 되면:
1. [웹] 승인 대기함 → **반려**, 사유: `가동률 분모가 24h 고정. 자정 걸친 가동과 계획정지 제외 규칙이 PRD 와 다름`
2. [웹] 명세 패널 spec 에 규칙 추가 (예: "계획정지(PM)는 분모에서 제외, 자정 걸친 이벤트는 일별 분할")
3. [Claude]
```
[Claude]
TSK-01-03 반려했어. 사유는 D'Flow 에 적었고 spec 보강했어. 같은 브랜치에서 재작업해서 다시 보고해줘.
```
- [ ] 반려 상태를 스킬이 인지하는가 / 못 하면 **결함 기록**(러너 개정 근거: 반려 무전이)
- [ ] 재보고 → 승인 → 머지

### 4-6. 선행 미머지 차단 — exit 4 (S3)

TSK-02-02 는 01-03·02-01 둘 다 필요. 01-03 이 **머지 전(reported)** 인 시점에:
```
[Claude]
/dflow-dev TSK-02-02
```
- [ ] claim exit 4(서버) 인지, Phase 0 판정(로컬)으로 스킵인지 — **어느 쪽이 막았는지** 기록
- [ ] 폴링 `--exclude` 일시 제외 안내가 나오는지
- 01-03 머지 후 재시도 → 착수

### 4-7. 세션 단절 재개 — TSK-02-02 도중 (S4)

빌드 도중(테스트 통과 전) 세션을 끊는다: `/clear` 또는 터미널 종료. **mes-runlog 에서** 새 세션:
```
[Claude]
진행 중이던 D'Flow 작업 보여줘. 이어서 해.
```
- [ ] `list --scope claimed` 로 복원 → 커밋·state.json 으로 phase 판정 → 이어서 빌드
- [ ] 폴링은 죽었으므로 재개 후 `/dflow-poll --interval 120` 다시

### 4-8. 통합테스트 — TSK-03-01 (P4)

전부 머지되면 ready → 폴링이 착수(agent).
- [ ] itest category 게이트(Playwright E2E)가 적용되는지 — dev-discipline 특례 표에 itest 가 없으면 결함 기록
- [ ] 승인 → 머지 → **8건 전부 main**

---

## 5. 종료 조건

- [ ] mes-runlog main 에 머지 커밋 8개, package.json 의 test·e2e 스크립트 초록
- [ ] D'Flow 8건 approved, 활성 주문 0
- [ ] S1~S5 관찰 결과 기록 (S6 CI 실패는 자연 발생 시만)
- [ ] 세션 중 wbs-web 경로 참조 0건 (있었으면 킷 결함)

---

## 6. 기록표 (사이클마다)

| TSK | 경로 | claim 시각 | reported 시각 | Design 모델 | 게이트(테스트 수/커버리지) | 사람 개입 지점 | 재작업 | 비고 |
|---|---|---|---|---|---|---|---|---|
| 00-01 | 자동 | | | | | | | |
| 00-02 | 자동 | | | | | | | |
| 01-01 | 자동 | | | | | | | 승인 보류(S2) |
| 02-01 | 자동 | | | | | | | S2 스택 |
| 01-02 | 수동 | | | | | | | S5 |
| 01-03 | 자동 | | | | | | 1 | S1 반려 |
| 02-02 | 수동 | | | | | | | S3·S4 |
| 03-01 | 자동 | | | | | | | itest |

"사람 개입 지점" = 승인·반려·spec 보강·질문 응답·오류 수습. 러너 자동화의 실제 요구 목록이 된다.

---

## 7. 막혔을 때

| 증상 | 원인 | 조치 |
|---|---|---|
| `install.sh` exit 2 "필요한 명령이 없다" | jq·gh 등 미설치 | `brew install jq gh` |
| `doctor` exit 3 | PAT 미기입·만료 | `/account` 재발급 → `.env` |
| `doctor` 가 운영 URL | `.env` `DFLOW_API_BASE` 오기 | 즉시 스테이징으로 수정. 운영 데이터 건드리지 않음 |
| 스킬이 안 뜸(`/dflow-dev` 미인식) | 세션 cwd 가 리포 루트 아님 | `~/project/mes-runlog` 에서 다시 열기 |
| 업로드 미리보기 "levels 가 없습니다" | frontmatter 누락 | wbs.md 에 `module`·`levels` — 3-1 재생성 |
| 적용 후 주문 생성 0 | 프로젝트 "에이전트 중지" 또는 재업로드(활성 주문 이미 있음) | 결과 카드 경고대로. 중지면 설정 › 에이전트 › 재개(백필) |
| "착수 불가 — spec 비어 있음" | requirements/acceptance 누락 | 웹 명세 패널에서 채우고 "채워졌어" |
| claim exit 4 | 선행 미머지(서버 판정) | 선행 승인→"머지해" 후 재시도. 폴링은 자동 재감지 |
| 폴링이 통지 없이 조용 | `&` 로 띄움 | 스킬이 run_in_background 로 띄우는지 확인, 아니면 결함 기록 |
| 18:00 폴링 종료 | 의도된 제한 | 다음날 `/dflow-poll` 재시작 |
| 머지 스킬 "approved 아님" | 웹 승인 전 | 승인 대기함 상태 확인 후 재시도. 우회 금지 |
| 스킬이 wbs-web 경로를 찾음 | 킷 결함 | 어느 스킬·어느 문구인지 기록 → wbs-web 정본 수정 → 킷 재빌드 |

---

## 8. P5 — 회고 [Claude]

```
[Claude]
docs/runlog/rehearsal-runbook.md §6 기록표와 이번 리허설 대화를 근거로 docs/retro/2026-08-xx-dflow-rehearsal.md 를 써줘.
항목: 사이클별 소요·게이트 통과율, 사람 개입 지점 전체 목록, 스킬·킷 결함(재현 절차 포함), 러너 설계 개정에 넣을 요구사항.
판단은 하지 말고 관찰 사실만 적어.
```

회고 산출물은 wbs-web 으로 가져와 러너 설계 정본 개정(사용자 직접)의 입력으로 쓴다.
(이 런북도 리허설 시작 전 `mes-runlog/docs/runlog/` 로 복사해 두면 §8 프롬프트 경로가 맞는다.)
