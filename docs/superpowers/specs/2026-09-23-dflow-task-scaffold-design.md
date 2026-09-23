# 팀장이 내 담당 작업 폴더를 미리 만든다(task scaffold) — 설계

- 날짜: 2026-09-23
- 출처: `docs/idea.md` 「WBS 넣을때 tasks의 폴더를 미리 다 생성하자. state.json 을 생성해 놓으면 된다.」
- 선행: [2026-09-23 `.dflow` 설정 설계](2026-09-23-dflow-config-design.md) — `project_map`·`project_id`·`dev_branch` 해석을 그대로 쓴다.

## 1. 목적

1. 작업 리포에 **내가 담당한 작업의 폴더 `<DOCS_DIR>/tasks/<TSK>/` 와 `state.json` 을 미리 만든다.** 사람이 리포만 보고도
   어느 작업이 내게 와 있는지 알 수 있고, 에이전트는 claim 전에 작업 폴더 자리를 안다.
2. 작업 폴더 위치를 **`project_map` 에 적은 DOCS_DIR 아래**로 통일한다. 지금은 두 경로가 섞여 있다.
   - `dflow-wbs`·`dflow-export`(`wbs-parse.py:725`)는 `<DOCS_DIR>/tasks/<TSK>/state.json` 을 읽는다.
   - `dflow-dev`·`dflow-merge`·`dflow-team`·`dflow.sh write_spec_cache` 는 `docs/tasks/<TSK>/` 로 고정돼 있다.
   서브시스템마다 WBS 가 따로 있으면 Task ID(`TSK-01-01`)가 겹쳐 `docs/tasks/` 한곳에서는 폴더가 충돌한다.

## 2. 결정 사항(2026-09-23 사용자 확인)

| 항목 | 결정 |
|---|---|
| 만드는 주체·시점 | import 시점이 아니라 **팀장이 시작할 때**(`dflow.sh scaffold`). 혼자 쓰는 사람은 같은 명령을 직접 실행한다 |
| 대상 | **내게 배정된 작업만**(`/work/mine?scope=assigned`) ∩ 이 리포 바인딩. 남의 작업 폴더를 만들지 않아 사람 사이 커밋 충돌이 없다 |
| 위치 | `<DOCS_DIR>/tasks/<TSK>/`. DOCS_DIR 은 주문의 `project_id` 를 `project_map` 에서 역으로 찾는다. 매핑이 없고 `.dflow` 의 `project_id` 와 같으면 `docs` |
| 커밋 | 새로 만든 파일이 있을 때만 파일명을 명시해 개발 브랜치에 커밋·push |
| 초기 state.json | `{ "tsk", "order", "api_base", "phase": "ready" }` |

import 시점을 버린 이유: import 응답에는 주문 UUID 가 없어 `order` 를 채울 수 없고, 웹 화면으로 import 하면 로컬 스크립트가
돌지 않는다. 팀장은 시작할 때 주문 목록을 받으므로 두 문제가 없고, 재업로드로 Task 가 늘어도 다음 시작 때 채워진다.

## 3. 역매핑 해석기

`dflow-config.sh` 에 둔다(설정 해석을 한곳에 모은 선행 설계 §6 원칙). 인터페이스:

```bash
dflow.sh config docs-dir <project_uuid>   # DOCS_DIR 한 줄(예 docs/mdm, docs)
```

| 순서 | 조건 | 결과 |
|---|---|---|
| 1 | `project_map` 에 값이 그 UUID 인 키가 하나 | 그 키 |
| 2 | 같은 UUID 가 `project_map` 에 둘 이상 | exit 2 `AMBIGUOUS_DOCS_DIR` — 추측하지 않는다 |
| 3 | 매핑 없음, `.dflow`(또는 env) 의 `project_id` 와 같음 | `docs` |
| 4 | 그 밖 | exit 2 `PROJECT_MISMATCH` |

- 키 끝의 `/` 는 떼고 돌려준다. 작업 폴더는 `<결과>/tasks/<TSK>` 다.
- 레거시(`.env`) 경로도 같은 규칙이다(`DFLOW_PROJECT_MAP`·`DFLOW_PROJECT_ID`).

## 4. `dflow.sh scaffold`

1. `GET /api/v1/agent/work/mine?scope=assigned&limit=100` → `[.assigned[]]` → 기존 `filter_projects` 로 바인딩 밖을 거른다.
   바인딩이 없으면 exit 2 `PROJECT_MISMATCH`(자동 경로는 바인딩 없이 돌지 않는다 — `cmd_list` 주석과 같은 원칙).
2. 응답이 정확히 100건이면 `⚠ 목록이 100건에서 잘렸을 수 있습니다` 한 줄.
3. 주문마다:
   - TSK = `item.external_ref` 의 마지막 `/` 뒤. 비어 있으면(웹에서 직접 만든 항목, 또는 서버 미배포) `no_ref` 로 세고 건너뛴다.
   - DOCS_DIR = `config docs-dir <project_id>`. 실패하면 그 주문만 `skipped(사유)` 로 세고 계속한다.
   - `<DOCS_DIR>/tasks/<TSK>/` 가 **이미 있으면 건너뛴다.** 안의 내용은 보지도 고치지도 않는다.
   - 없으면 만들고 state.json 을 쓴다(임시 파일 → `mv` 원자 교체):
     `{"tsk":"<TSK>","order":"<전체 UUID 36자>","api_base":"<끝 / 제거한 base>","phase":"ready"}`
4. 커밋:
   - 새 파일이 0건이면 커밋하지 않는다.
   - 현재 브랜치가 `dflow.sh branch dev` 가 아니면 파일만 남기고 `not on dev branch — 커밋하지 않음` 을 알린다.
   - 맞으면 새 state.json 들을 **파일명을 명시해** `git add` 하고 `chore(dflow): 담당 작업 폴더 N건 생성` 으로 커밋, `git push origin <dev>`.
   - push 실패는 로컬 커밋만 남기고 exit 0 + 경고. 팀장 시작을 막지 않는다.
5. 출력 한 줄: `scaffold created=N skipped=N no_ref=N`. `no_ref` 가 전량이면 "서버에 external_ref 응답이 없습니다 — D'Flow 업데이트 필요" 를 덧붙인다.

## 5. 서버 변경

`src/app/api/v1/agent/work/mine/route.ts` 의 `wbs_items` select 에 `external_ref` 를 더한다. 필드 추가뿐이라 기존 클라이언트에
영향이 없다. `dflow-work/references/api-contract.md` 의 mine 응답 예시에 `external_ref` 를 적는다. 주문마다 `show` 를
부르는 대안(N회 호출)은 쓰지 않는다.

## 6. 기존 스킬의 작업 폴더 경로

- `docs/tasks/` 를 고정으로 쓰는 곳은 스킬 전체 약 57곳(17개 파일)이다. 각 스킬 문서에서 **"작업 폴더 `<TASKS>` =
  `dflow.sh config docs-dir <그 주문의 project_id>` + `/tasks`"** 를 한 번 정의하고, 본문은 `<TASKS>/<TSK>/` 로 바꾼다.
  (선행 설계 §7.1 이 `<기본브랜치>` 를 다룬 방식과 같다.)
- 주문의 `project_id` 는 claim·show 경로에서 이미 `check_project` 가 `/work/mine` 으로 얻는다. 해석 결과를 호출부가 넘겨받는다.
- `write_spec_cache`(`dflow.sh`)는 해석기 결과 아래에 spec.md 를 쓴다.
- 여러 작업 폴더를 훑는 곳(`dflow-merge` 후보 식별, `dflow-dev` Phase 01-가 스윕, `poll.sh` 승인 감지, 팀장 `LEGACY_REPORTED`
  검사)은 바인딩된 DOCS_DIR 전부의 `tasks/*/state.json` 을 본다. `git diff --name-only … -- '<glob>'` 의 pathspec 은
  `'*tasks/*/state.json'` 로 넓힌다.
- `.gitignore` 에 넣는 `docs/tasks/*/.result`·`.issues` 패턴과 `backends.md` 의 미추적 파일 grep 을 `**/tasks/*/…` 로 넓힌다.
- 워커에게는 팀장이 해석한 작업 폴더를 프롬프트에 명시해 넘긴다(선행 설계 §7.1 의 `DEV_BRANCH` 와 같은 이유).
- `dflow-wbs`·`dflow-export` 는 이미 `<DOCS_DIR>/tasks` 라 고치지 않는다.

## 7. `dflow-dev` 재claim 격리 예외

지금 규칙: 신규 claim 에서 `docs/tasks/<TSK>/` 가 있으면 `.prev-<날짜>/` 로 옮긴다. 여기에 예외를 더한다.

- 폴더 안에 **`state.json` 하나만 있고 `phase=ready`** 이면 잔재가 아니다. 옮기지 않고 `order`·`api_base` 를 이번 claim
  값으로 덮어쓴 뒤 진행한다. 담당이 바뀌어 남이 만든 ready 파일도 같은 규칙으로 이어 쓴다.
- 다른 파일이 하나라도 있거나 `phase` 가 `ready` 가 아니면 종전대로 격리한다.
- `ready` 는 진행 중 phase 가 아니다. 스윕·머지·재개 판정은 `reported` 등 기존 값만 보므로 영향이 없다.
  `dflow-dev` 상태 모델의 `phase` 값 목록에 `ready`(scaffold 가 만든 초기값)를 추가한다.

## 8. 팀장 연결

`dflow-team` 시작 절차의 전제 검사 직후, 팀장 체크아웃(개발 브랜치)에서 `dflow.sh scaffold` 를 한 번 부르고 출력 한 줄을
보고에 싣는다. 실패(exit≠0)는 경고만 하고 팀장 시작을 계속한다 — scaffold 는 편의 기능이지 게이트가 아니다.

## 9. 오류 처리

| 상황 | 동작 |
|---|---|
| 바인딩 없음 | exit 2 `PROJECT_MISMATCH` |
| 한 주문의 DOCS_DIR 해석 실패 | 그 주문만 skipped, 계속 |
| `external_ref` 없음 | `no_ref` 집계, 건너뜀 |
| 폴더 이미 있음 | 건너뜀(내용 불변) |
| 목록 100건 | 경고 한 줄 |
| 개발 브랜치 아님 | 파일만 생성, 커밋 안 함, 안내 |
| push 실패 | 로컬 커밋 유지, exit 0 + 경고 |
| API 오류 | `dflow.sh` 기존 exit 코드 그대로 |

## 10. 테스트

`tests/skills/` vitest(기존 fixture·가짜 API 방식)를 확장한다.

- 해석기: map 키 조회 · 끝 `/` 제거 · `project_id` 폴백(`docs`) · 매핑 없음 `PROJECT_MISMATCH` · UUID 중복 `AMBIGUOUS_DOCS_DIR` · 레거시 `.env`
- scaffold: 바인딩 밖 제외 · 기존 폴더 건너뜀(내용 불변) · `no_ref` 집계 · `order` 전체 UUID · `api_base` 끝 `/` 제거 ·
  개발 브랜치가 아니면 미커밋 · 새 파일 0건이면 미커밋 · 커밋에 새 state.json 만 포함 · 100건 경고
- `write_spec_cache` 가 `<DOCS_DIR>/tasks/<TSK>/spec.md` 에 쓴다
- 격리 예외: ready 단일 파일은 격리 안 함 / 다른 산출물이 있으면 격리
- mine route: `item.external_ref` 포함
- 회귀: `tests/skills` 전체와 `shell-syntax` 통과

## 11. 범위 밖

- 배정되지 않은 작업·남의 작업 폴더 생성.
- 담당이 빠진 작업 폴더의 정리(삭제). 남은 ready 파일은 새 담당자가 §7 로 이어 쓴다.
- 기존 `docs/tasks/` 폴더를 `<DOCS_DIR>/tasks/` 로 옮기는 마이그레이션. project_map 을 쓰는 리포가 아직 없거나 진행 중 작업이
  없는 상태에서 적용한다. 진행 중 작업이 있으면 사람이 옮긴다.
- import(`dflow-export --push`) 직후 자동 실행.

## 12. 진행

공유 스킬 파일을 건드리므로 별도 워크트리(`feat/dflow-task-scaffold`, 기점 staging)에서 구현한다. 반영은 staging 까지다.
서버 변경(§5)이 staging 에 배포돼야 scaffold 가 폴더를 만든다.
