# `.dflow` 설정 파일과 개발 브랜치 — 설계

- 날짜: 2026-09-23
- 출처: `docs/idea.md` 「에이전트 스킬」 → 「에이전트의 설정 파일 변경」
- 후속 의존: [2026-09-23 강제 진행 설계](2026-09-23-force-progress-design.md) §4 가 이 설정을 선행 조건으로 요구한다.
  병렬 머지 충돌 과제(E)도 머지 기준 브랜치로 이 값을 쓴다.

## 1. 목적

1. 에이전트 스킬(`dflow-work`·`dflow-dev`·`dflow-merge`·`dflow-poll`·`dflow-team`·`dflow-wbs`·`dflow-export`)의 설정을
   `.env` 에서 `.dflow` 로 옮긴다. `.env` 는 앱의 환경 변수 파일이라 에이전트 설정과 비밀이 섞이고, 리포에 커밋할 수 없어
   PC·워크트리마다 손으로 맞춰야 했다.
2. **개발 브랜치**를 설정 항목으로 둔다. 지금 스킬은 기본 브랜치를 `git symbolic-ref refs/remotes/origin/HEAD`(대개 main)로
   판정하므로 에이전트 머지가 곧장 운영 브랜치로 간다. 앞으로는 에이전트 작업의 머지 대상·스택 기점·반영 확인을 모두
   개발 브랜치 기준으로 하고, 운영 브랜치는 승격으로만 들어간다.
3. **개발 브랜치는 리포당 하나**다. `.dflow` 가 커밋 파일이므로 다른 PC 에 클론된 같은 리포는 git 으로 이 값을 공유하고,
   같은 개발 브랜치를 함께 쓴다(보통의 git 사용과 같다). 서브시스템을 리포로 나눈 경우 리포마다 자기 개발 브랜치를 둔다.

## 2. 결정 사항(2026-09-23 사용자 확인)

| 항목 | 결정 |
|---|---|
| 파일 형태 | `.dflow`(커밋) + `.dflow.local`(gitignore, 비밀) 분리 |
| 하위 호환 | `.dflow`·`.dflow.local` 이 모두 없으면 종전 `.env` 를 읽고 이전 안내를 한 줄 낸다 |
| `api_base`·`project_id`·`automerge` | `.dflow` 에 운영 기본값으로 두고 `.dflow.local`·export 된 env 가 덮어쓴다. `automerge` 기본값은 0 |
| 브랜치 범위 | 리포당 개발 브랜치 하나. 다른 PC 의 같은 리포는 `.dflow` 를 git 으로 공유해 같은 브랜치를 쓴다 |

## 3. 파일 형식

### 3.1 `.dflow`(커밋)

```ini
api_base=https://<dflow-host>/api/v1
project_id=<uuid>                              # 단일 바인딩
project_map=docs/c10=<uuid-a>,docs/m30=<uuid-b>  # DOCS_DIR 마다 프로젝트가 다를 때(종전 DFLOW_PROJECT_MAP)
dev_branch=staging
release_branch=main
automerge=0
```

- 형식은 `key=value` 이고 `#` 로 시작하는 줄과 값 뒤의 ` #…` 는 주석이다. 앞뒤 공백·CR 은 버린다.
- **커밋 파일은 `source` 하지 않는다.** 전용 파서로 읽어 셸 코드가 실행되지 않게 한다.
- `release_branch` 를 생략하면 `dev_branch` 와 같은 값으로 본다(종전 운영 = 개발과 운영이 같은 브랜치).
- `dev_branch` 를 생략하면 `symbolic-ref origin/HEAD` 값으로 본다.
- 바인딩은 종전과 같이 `project_id` 와 `project_map` 값의 합집합이다(`dflow.sh` `allowed_projects`).
  `project_map` 은 바인딩만 정하고 브랜치와는 무관하다. 브랜치는 리포 전체가 `dev_branch` 하나를 쓴다.

### 3.2 `.dflow.local`(gitignore)

```ini
pats=dfp_xxx,dfp_yyy         # 종전 DFLOW_PATS. 단일이면 pat=
as=<key-id>                  # 종전 DFLOW_AS
# 덮어쓰기(스테이징 시험 등) — .dflow 의 공통 키와 같은 이름
api_base=https://<staging-host>/api/v1
```

- 비밀(`pats`·`pat`)과 PC·세션 전용 값(`as`)은 이 파일에만 둔다. `.dflow` 에 `pats`·`pat`·`as` 가 있으면 exit 2 로
  멈춘다(비밀이 커밋되는 사고를 설정 단계에서 막는다).
- 덮어쓰기는 `.dflow` 와 같은 키 이름으로 한다.
- `.gitignore` 에 `.dflow.local` 을 명시한다. 지금의 `.env*` 규칙은 이 파일을 덮지 않는다.

### 3.3 env 이름 대응

| 파일 키 | env(최우선) |
|---|---|
| `api_base` | `DFLOW_API_BASE` |
| `pats` / `pat` | `DFLOW_PATS` / `DFLOW_PAT` |
| `as` | `DFLOW_AS` |
| `project_id` | `DFLOW_PROJECT_ID` |
| `project_map` | `DFLOW_PROJECT_MAP` |
| `dev_branch` / `release_branch` | `DFLOW_DEV_BRANCH` / `DFLOW_RELEASE_BRANCH` |
| `automerge` | `DFLOW_AUTOMERGE` |

## 4. 우선순위와 로드

**export 된 env > `.dflow.local` > `.dflow` > 레거시 `.env`**

- 비밀이 아닌 값의 로드는 PAT export 여부와 분리한다. 지금 `dflow.sh:56` 은 PAT 가 환경에 없을 때만 `.env` 를 읽는다.
  같은 조건을 새 파일에 걸면 PAT 를 export 한 세션이 `dev_branch` 를 보지 못한다. 따라서 `.dflow` 는 항상 읽고,
  `.dflow.local` 도 항상 읽되 이미 export 된 키는 건드리지 않는다.

## 5. 파일 위치 해석 — 가장 위험한 부분

워커는 `origin/<개발브랜치>` 로 detach 하고, 스택 브랜치는 `.dflow` 가 생기기 전 커밋에서 갈라질 수 있다. 그런
체크아웃에는 `.dflow` 가 없다. 이때 조용히 `origin/HEAD`(main)로 떨어지면 **staging 으로 가야 할 에이전트 머지가 main
으로 간다.** 이를 막기 위해 `.dflow` 는 다음 순서로 찾는다.

1. 워크트리 최상위(`git rev-parse --show-toplevel`)의 `.dflow`. cwd 는 보지 않는다.
2. 1 이 없으면 `git show origin/HEAD:.dflow`. 개발 브랜치를 알아내려고 개발 브랜치를 읽을 수는 없으므로(순환) 원격의
   기본 브랜치에서 읽는다. 따라서 `.dflow` 는 개발 브랜치뿐 아니라 **원격 기본 브랜치(대개 운영 브랜치)에도 들어 있어야**
   한다(§7.3). 워커는 팀장이 넘긴 값을 쓰므로 이 단계에 기대지 않는다.
3. `.dflow.local` 은 워크트리 최상위에서만 찾는다(커밋되지 않으므로 git 에서 읽을 수 없다).
4. 판정:

| `.dflow`(1·2) | `.dflow.local` | 결과 |
|---|---|---|
| 있음 | 있음·없음 | 새 방식 |
| 없음 | 있음 | **exit 2 로 중단** — 새 방식으로 설정된 리포가 종전 동작으로 조용히 떨어지는 것을 막는다 |
| 없음 | 없음 | 레거시: 종전대로 `.env`(또는 `DFLOW_ENV_FILE`) 를 읽고 `symbolic-ref origin/HEAD` 로 판정한다. stderr 에 `LEGACY_ENV .dflow 로 옮기세요` 한 줄 |

- `DFLOW_ENV_FILE` 은 레거시 경로에서만 뜻이 있다. 새 방식에는 `DFLOW_CONFIG_DIR`(두 파일을 찾을 디렉터리)를 둔다.
  팀장이 poll 을 다른 cwd 에서 띄울 때 쓴다(지금 `DFLOW_ENV_FILE` 을 넘기는 자리).

## 6. 해석기 인터페이스

설정 해석은 `dflow.sh` 한 곳에 모은다. 다른 스크립트와 스킬 문서는 이것만 부른다.

```bash
dflow.sh config <key>        # 값. 없으면 빈 줄, exit 0
dflow.sh config --source     # new|legacy 와 찾은 파일 경로(진단용)
dflow.sh branch dev|release  # 개발·운영 브랜치
```

- 레거시 경로에서 `branch` 는 종전과 같은 `symbolic-ref` 값을 돌려준다.
- 브랜치 값은 `origin/` 을 붙이지 않은 이름이다.

## 7. 적용 지점

### 7.1 기본 브랜치 정의를 바꾸는 곳

약 95곳의 `origin/<기본브랜치>` 자리표시는 그대로 두고, 각 스킬에서 그 용어를 **"개발 브랜치 =
`dflow.sh branch dev` 값"** 으로 한 번 정의한다. 값을 계산하는 자리만 고친다.

- `dflow-team/scripts/lead-worktree.sh:15`, `dflow-team/SKILL.md:404` — `symbolic-ref` 대신 해석기.
- `dflow-team/references/worker-prompt.md:19` — 워커가 스스로 판정하던 문장을 없애고, **팀장이 해석한 값을 프롬프트에
  명시해서 넘긴다.** 워커는 다시 해석하지 않는다(detach 된 옛 커밋에서 다른 값을 읽는 일을 원천 차단).
- `dflow-dev/SKILL.md` — Phase 01 기점·행 G 반영 확인의 `<기본브랜치>` 정의. 수동 경로는 해석기를 직접 부른다.
- `dflow-merge/SKILL.md` — description 의 「기본브랜치(main)」 를 「개발 브랜치」 로. 머지 자리 판정(§4)도 개발 브랜치 기준이다.
- 스크립트·문서에 하드코딩된 `main` 을 찾아 고친다(구현 계획 단계에서 `grep -rn '\bmain\b' .claude/skills` 전수).

### 7.2 워크트리 배관

- `dflow-team/references/backends.md:61` — 새 방식이면 `.dflow.local` 을 심볼릭 링크로 준다. `.dflow` 는 커밋되어 있어
  따로 줄 필요가 없다. 레거시면 종전대로 `.env`.
- `lead-worktree.sh:37-43` — 새 방식이면 `as` 줄을 뺀 `.dflow.local` 사본을 만들고 `chmod 600`. 레거시면 종전대로.
- `dflow-poll/scripts/poll.sh:76` — `.env` 직접 읽기 대신 해석기로 바인딩·base 를 얻는다.
- `dflow-team/SKILL.md:413`(`NO_PROJECT` 전제 검사), `dflow-dev/SKILL.md:189`, `dflow-wbs`·`dflow-export` 의 바인딩 안내 —
  「`.env` 의 `DFLOW_PROJECT_ID`·`DFLOW_PROJECT_MAP`」 을 「`.dflow` 의 `project_id`·`project_map`」 으로.

### 7.3 킷과 wbs-web

- `scripts/kit-build.sh` 가 wbs-web 자신의 `.dflow`·`.dflow.local` 을 킷에 싣지 않는지 확인한다. 킷에는 예시 파일
  `dflow.example`(주석 포함 템플릿)을 싣는다.
- wbs-web 리포에는 `.dflow`(`dev_branch=staging`, `release_branch=main`)를 커밋하고, §5-2 때문에 main 에도 함께 올린다.
  설정 파일만 담은 커밋이므로 소액 변경으로 main 직행한다.

## 8. 오류 처리

| 상황 | 동작 |
|---|---|
| `.dflow` 에 `pats`·`pat`·`as` | exit 2 `SECRET_IN_DFLOW` |
| `.dflow.local` 만 있음 | exit 2 `NO_DFLOW` |
| 개발 브랜치가 원격에 없음(`origin/<dev>` 부재) | 해석기는 이름만 돌려준다. 쓰는 쪽(팀장 전제 검사·`/dflow-dev` Phase 01)이 `NO_DEV_BRANCH` 로 멈춘다 |
| 알 수 없는 키 | 경고 한 줄, 계속 |

## 9. 범위 밖

- 승격 가드(`FORCE-STUB` 검사 등): 강제 진행 설계(F7)의 몫이다. 여기서는 `release_branch` 값을 정의하는 데서 멈춘다.
- 한 리포 안에서 서브시스템·WBS 노드별로 개발 브랜치를 나누는 것. 리포당 하나로 충분하다(2026-09-23 사용자 결정).
- `.env` 레거시 폴백의 제거 시점.
- 이전 명령(`migrate-config`). 폴백과 안내로 충분하다고 보았다.

## 10. 테스트

`tests/skills/` 의 기존 vitest 체계(`dflow-key-select`·`dflow-lead-worktree` 등)를 확장한다.

- 우선순위 4단계(env > local > dflow > 레거시 `.env`)
- PAT 가 export 된 상태에서도 `.dflow` 의 `dev_branch` 를 읽는다
- 워크트리 하위 디렉터리에서 실행해도 최상위 `.dflow` 를 찾는다
- detach 된 옛 커밋(`.dflow` 없음)에서 `origin/HEAD:.dflow` 로 해석한다
- `.dflow.local` 만 있으면 exit 2, 둘 다 없으면 레거시 경고와 종전 판정
- `.dflow` 에 비밀 키가 있으면 exit 2
- 커밋 파일에 셸 코드(`$(...)`)가 있어도 실행되지 않는다
- `lead-worktree.sh`: `.dflow.local` 사본에서 `as` 제거, 권한 600
- `allowed_projects` 가 `.dflow` 의 `project_id`·`project_map` 합집합과 같다

## 11. 진행

공유 스킬 파일을 건드리므로 별도 워크트리(`feat/dflow-config`, 기점 staging)에서 구현한다. 반영은 staging 까지다.
