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
3. 설정을 **프로젝트 공통**과 **개인**으로 나눈다. 여러 사람이 한 프로젝트를 구현할 때 사람마다 자기 개발 브랜치를 쓰고,
   맡은 서브시스템(예: 어떤 사람은 C10, 어떤 사람은 M30)도 다르기 때문이다.

## 2. 결정 사항(2026-09-23 사용자 확인)

| 항목 | 결정 |
|---|---|
| 파일 형태 | `.dflow`(커밋, 프로젝트 공통) + `.dflow.local`(gitignore, 개인) |
| 하위 호환 | `.dflow`·`.dflow.local` 이 모두 없으면 종전 `.env` 를 읽고 이전 안내를 한 줄 낸다 |
| 프로젝트 공통(`.dflow`) | `api_base`·`project_id`·`release_branch`. 같은 프로젝트면 누구나 같은 값이어야 한다 |
| 개인(`.dflow.local`) | `pats`·`as`·`dev_branch`·`automerge`·`project_map` |
| 개발 브랜치 | 사람마다 자기 것을 둘 수 있다. 같은 값을 쓰면 보통의 git 처럼 한 브랜치를 공유한다 |

## 3. 파일 형식

두 파일 모두 `key=value` 이고, `#` 로 시작하는 줄과 값 뒤의 ` #…` 는 주석이다. 앞뒤 공백·CR 은 버린다.
**어느 파일도 `source` 하지 않는다.** 전용 파서로 읽어 셸 코드가 실행되지 않게 한다.

### 3.1 `.dflow`(커밋, 프로젝트 공통)

```ini
api_base=https://<dflow-host>/api/v1
project_id=<uuid>          # 리포 전체의 바인딩(단일 프로젝트 리포)
release_branch=main        # 운영 브랜치. 승격 대상
```

- 이 파일의 키는 프로젝트 공통이다. `.dflow.local` 에 같은 키가 있으면 **무시하고 경고**한다. 한 프로젝트에서
  사람마다 다른 서버·다른 운영 브랜치를 보는 일을 막는다.
- 개인 키(`pats`·`pat`·`as`·`dev_branch`·`automerge`·`project_map`)가 이 파일에 있으면 exit 2 로 멈춘다. 비밀이
  커밋되거나 한 사람의 브랜치가 모두에게 강제되는 사고를 설정 단계에서 막는다.
- `release_branch` 를 생략하면 `symbolic-ref origin/HEAD` 값으로 본다.

### 3.2 `.dflow.local`(gitignore, 개인)

```ini
pats=dfp_xxx,dfp_yyy       # 종전 DFLOW_PATS. 단일이면 pat=
as=<key-id>                # 종전 DFLOW_AS
dev_branch=dev/jji         # 내 개발 브랜치. 동료와 같은 값을 쓰면 브랜치를 공유한다
automerge=0                # 종전 DFLOW_AUTOMERGE. 기본 0
project_map=docs/c10=<uuid-a>   # 내가 맡은 서브시스템만. 종전 DFLOW_PROJECT_MAP
```

- **`dev_branch` 는 새 방식에서 필수다.** 없으면 exit 2 `NO_DEV_BRANCH` 로 멈춘다. 종전처럼 origin/HEAD(운영)로 떨어지면
  에이전트 머지가 운영 브랜치로 가기 때문이다. 운영 브랜치에서 직접 개발하려면 `dev_branch=main` 처럼 명시한다.
- 바인딩(`allowed_projects`)은 `.dflow` 의 `project_id` 와 내 `project_map` 값의 합집합이다. 서브시스템마다 D'Flow
  프로젝트가 다른 리포는 `.dflow` 에 `project_id` 를 두지 않고 각자 `project_map` 에 맡은 것만 적는다. 그러면 내 팀장은
  내가 맡은 서브시스템의 작업만 받는다.
- `.gitignore` 에 `.dflow.local` 을 명시한다. 지금의 `.env*` 규칙은 이 파일을 덮지 않는다.

### 3.3 env 이름 대응

| 파일 키 | 파일 | env(최우선) |
|---|---|---|
| `api_base` | `.dflow` | `DFLOW_API_BASE` |
| `project_id` | `.dflow` | `DFLOW_PROJECT_ID` |
| `release_branch` | `.dflow` | `DFLOW_RELEASE_BRANCH` |
| `pats` / `pat` | `.dflow.local` | `DFLOW_PATS` / `DFLOW_PAT` |
| `as` | `.dflow.local` | `DFLOW_AS` |
| `dev_branch` | `.dflow.local` | `DFLOW_DEV_BRANCH` |
| `automerge` | `.dflow.local` | `DFLOW_AUTOMERGE` |
| `project_map` | `.dflow.local` | `DFLOW_PROJECT_MAP` |

export 된 env 는 공통 키도 덮는다. 스테이징 D'Flow 로 시험할 때 `DFLOW_API_BASE` 를 한 세션에만 주는 용도다. 파일로는
덮지 못하게 한 것(§3.1)과 달리 env 는 그 세션에만 영향을 주므로 허용한다.

## 4. 우선순위와 로드

**export 된 env > `.dflow.local`(개인 키) / `.dflow`(공통 키) > 레거시 `.env`**

- 두 파일은 키가 겹치지 않으므로 서로 덮지 않는다. 겹치면 §3.1 규칙대로 경고하거나 멈춘다.
- 비밀이 아닌 값의 로드는 PAT export 여부와 분리한다. 지금 `dflow.sh:56` 은 PAT 가 환경에 없을 때만 `.env` 를 읽는다.
  같은 조건을 새 파일에 걸면 PAT 를 export 한 세션이 `dev_branch` 를 보지 못한다. 따라서 두 파일은 항상 읽고, 이미
  export 된 키만 건드리지 않는다.

## 5. 파일 위치 해석

1. `.dflow.local` 은 워크트리 최상위(`git rev-parse --show-toplevel`)에서만 찾는다. cwd 는 보지 않는다. 커밋되지 않으므로
   워커·팀장 워크트리에는 심볼릭 링크나 사본으로 준다(§7.2).
2. `.dflow` 는 워크트리 최상위에서 먼저 찾는다. 워커는 `origin/<개발브랜치>` 로 detach 하고, 스택 브랜치는 `.dflow` 가
   생기기 전 커밋에서 갈라질 수 있어 그 체크아웃에는 `.dflow` 가 없을 수 있다. 그때는 `git show origin/<dev_branch>:.dflow`,
   그다음 `git show origin/HEAD:.dflow` 순서로 읽는다. `dev_branch` 는 개인 파일에서 이미 알고 있으므로 순환이 없다.
3. 판정:

| `.dflow`(2) | `.dflow.local` | 결과 |
|---|---|---|
| 있음 | 있음 | 새 방식 |
| 있음 | 없음 | exit 2 `NO_LOCAL` — 개인 설정(PAT·개발 브랜치) 없이는 동작하지 않는다 |
| 없음 | 있음 | exit 2 `NO_DFLOW` — 새 방식으로 설정된 리포가 종전 동작으로 조용히 떨어지는 것을 막는다 |
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
- `automerge` 를 읽는 자리(팀장의 승인 전 머지)는 env 대신 해석기로 읽는다.
- 스크립트·문서에 하드코딩된 `main` 을 찾아 고친다(구현 계획 단계에서 `grep -rn '\bmain\b' .claude/skills` 전수).

### 7.2 사람마다 개발 브랜치가 다를 때

선행 작업을 동료가 자기 개발 브랜치에 머지했다면 내 개발 브랜치에는 그 코드가 없다. 행 G 반영 확인은 내 개발 브랜치
(`origin/<내 dev_branch>`)만 보므로 후속은 `skipped 선행 승인 대기` 로 끝난다. 이것은 의도된 동작이다. 사람 사이의 통합은
git 의 보통 방식(동료 브랜치를 머지하거나 운영 브랜치 승격 뒤 back-merge)으로 사람이 한다. 기다릴 수 없으면 강제 진행
설계의 스텁 규칙을 쓴다. 팀장은 이런 선행을 사전 검사에서 걸러 공회전을 막는다(과제 E 의 「공회전 막기」 와 같은 검사).

### 7.3 워크트리 배관

- `dflow-team/references/backends.md:61` — 새 방식이면 `.dflow.local` 을 심볼릭 링크로 준다. `.dflow` 는 커밋되어 있어
  따로 줄 필요가 없다. 레거시면 종전대로 `.env`.
- `lead-worktree.sh:37-43` — 새 방식이면 `as` 줄을 뺀 `.dflow.local` 사본을 만들고 `chmod 600`. 레거시면 종전대로.
  워커는 팀장의 `.dflow.local` 을 링크로 받으므로 개발 브랜치·`automerge`·`project_map` 이 팀장과 같다.
- `dflow-poll/scripts/poll.sh:76` — `.env` 직접 읽기 대신 해석기로 바인딩·base 를 얻는다.
- `dflow-team/SKILL.md:413`(`NO_PROJECT` 전제 검사), `dflow-dev/SKILL.md:189`, `dflow-wbs`·`dflow-export` 의 바인딩 안내 —
  「`.env` 의 `DFLOW_PROJECT_ID`·`DFLOW_PROJECT_MAP`」 을 「`.dflow` 의 `project_id` 또는 `.dflow.local` 의 `project_map`」 으로.

### 7.4 킷과 wbs-web

- `scripts/kit-build.sh` 가 wbs-web 자신의 `.dflow`·`.dflow.local` 을 킷에 싣지 않는지 확인한다. 킷에는 예시 파일
  `dflow.example`(주석 포함 템플릿)을 싣는다.
- wbs-web 리포에는 `.dflow`(`api_base`·`project_id`·`release_branch=main`)를 커밋한다. 이 PC 의 `.dflow.local` 은
  `dev_branch=staging` 으로 만든다. `.dflow` 가 개발 브랜치에만 있어도 §5-2 가 `origin/<dev_branch>` 에서 읽으므로
  main 에 따로 올릴 필요는 없다.
- 킷 설치 안내에 두 파일의 역할(공통은 커밋, 개인은 각자 작성)을 적고, `dflow.local.example` 도 싣는다.

## 8. 오류 처리

| 상황 | 동작 |
|---|---|
| `.dflow` 에 개인 키(`pats`·`pat`·`as`·`dev_branch`·`automerge`·`project_map`) | exit 2 `PERSONAL_KEY_IN_DFLOW` |
| `.dflow.local` 에 공통 키(`api_base`·`project_id`·`release_branch`) | 무시하고 경고 한 줄 |
| `.dflow.local` 만 있음 | exit 2 `NO_DFLOW` |
| `.dflow` 만 있음 | exit 2 `NO_LOCAL` |
| 새 방식인데 `dev_branch` 없음 | exit 2 `NO_DEV_BRANCH` |
| 개발 브랜치가 원격에 없음(`origin/<dev>` 부재) | 해석기는 이름만 돌려준다. 쓰는 쪽(팀장 전제 검사·`/dflow-dev` Phase 01)이 `NO_REMOTE_DEV_BRANCH` 로 멈춘다 |
| 알 수 없는 키 | 경고 한 줄, 계속 |

## 9. 범위 밖

- 승격 가드(`FORCE-STUB` 검사 등): 강제 진행 설계(F7)의 몫이다. 여기서는 `release_branch` 값을 정의하는 데서 멈춘다.
- 한 사람이 서브시스템마다 다른 개발 브랜치를 쓰는 것. 개발 브랜치는 사람당 하나다.
- 사람 사이 개발 브랜치의 통합 자동화(§7.2). 사람이 git 으로 한다.
- `.env` 레거시 폴백의 제거 시점.
- 이전 명령(`migrate-config`). 폴백과 안내로 충분하다고 보았다.

## 10. 테스트

`tests/skills/` 의 기존 vitest 체계(`dflow-key-select`·`dflow-lead-worktree` 등)를 확장한다.

- 우선순위(env > 파일 > 레거시 `.env`)와 공통·개인 키 분리: `.dflow` 에 개인 키면 exit 2, `.dflow.local` 에 공통 키면 경고 후 무시
- `dev_branch` 가 없으면 exit 2, `.dflow` 만 있으면 exit 2
- PAT 가 export 된 상태에서도 `.dflow` 의 `dev_branch` 를 읽는다
- 워크트리 하위 디렉터리에서 실행해도 최상위 `.dflow` 를 찾는다
- detach 된 옛 커밋(`.dflow` 없음)에서 `origin/<dev_branch>:.dflow`, 그다음 `origin/HEAD:.dflow` 로 해석한다
- `.dflow.local` 만 있으면 exit 2, 둘 다 없으면 레거시 경고와 종전 판정
- `.dflow` 에 비밀 키가 있으면 exit 2
- 커밋 파일에 셸 코드(`$(...)`)가 있어도 실행되지 않는다
- `lead-worktree.sh`: `.dflow.local` 사본에서 `as` 제거, 권한 600
- `allowed_projects` 가 `.dflow` 의 `project_id` 와 `.dflow.local` 의 `project_map` 합집합과 같다

## 11. 진행

공유 스킬 파일을 건드리므로 별도 워크트리(`feat/dflow-config`, 기점 staging)에서 구현한다. 반영은 staging 까지다.
