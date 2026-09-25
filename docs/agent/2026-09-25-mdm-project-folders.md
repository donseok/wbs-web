# dmes-standard MDM 프로젝트별 문서 폴더 개편

> `docs/idea.md` 에서 옮긴 상세(2026-09-25). 요약 한 줄은 idea.md 에 남아 있다.

상태: 미착수, 2026-09-25 합의) — 1차 개발 뒤 개선 프로젝트를 새 D'Flow 프로젝트로 만들어 `docs/mdm` 아래 자기 폴더에서 작업한다. 코드 수정 없이 설정만으로 된다(`project_map` 은 DOCS_DIR 하나 = 프로젝트 하나, `dflow-wbs` 는 `{DOCS_DIR}/PRD.md·TRD.md·wbs.md`).

- 구조: 프로젝트 문서(PRD·TRD·wbs.md·tasks)는 `docs/mdm/<프로젝트>/`, 시스템 문서(erd·design·adr·screens·engine-contract·naming-dialect-rules·term-embedding·decisions.md)는 `docs/mdm` 루트에 공용. 개선 프로젝트 PRD·TRD 는 변경분만 쓰고 끝날 때 시스템 문서에 반영.
  ```
  docs/mdm/  (시스템 문서)
  ├── dev/    PRD·TRD·wbs.md·tasks/TSK-…   「MDM 개발」 1bf6ce9e…
  └── imp-1/  PRD·TRD·wbs.md·tasks/TSK-…   「MDM 개선 1차」(이름은 예시)
  ```
- 1단계 — 1차를 `docs/mdm/dev/` 로 이동: 착수 멈춤 → `git mv` PRD·TRD·wbs.md·tasks + 경로 치환 한 커밋(참조 파일 실측 tasks 81·wbs.md 15·PRD 9·TRD 6, `erd/*.sql` 은 주석만 바뀌었는지 확인) → 모든 사람의 `.dflow.local` `project_map` 을 `docs/mdm/dev=1bf6…` 로 동시에 변경(옛 값이면 `scaffold` 가 옛 경로를 되살림) → `config docs-dir`·`tasks-dirs`·`scaffold`(신규 0건) 확인 → dev push. 09-25 기준 진행 중 agent 브랜치 0개라 옮기기 좋은 시점.
- 2단계 — 개선 프로젝트: 웹에서 프로젝트 생성·본인 멤버 추가(슈퍼유저도 `project_members` 행 필요) → `docs/mdm/imp-1/PRD.md·TRD.md` → `/dflow-wbs mdm/imp-1` → `/dflow-export mdm/imp-1 --project-id <UUID>`(웹에서 만든 항목은 `external_ref` 가 없어 `NO_REF`) → `project_map` 에 `docs/mdm/imp-1=<UUID>` 추가.
- 주의: 공용 `decisions.md` 라벨은 TSK 이름만 써서 두 프로젝트의 `TSK-01-01` 이 섞인다 → 개선 프로젝트 WP 번호를 1차 다음부터(예 WP-10) 매긴다(권장, 코드 무수정). 개발 프로젝트가 더 생기면 `dev/` 아래 중첩하지 말고 형제 폴더로. 좌석표 감시 신호(`dflow.sh watch`)는 `.dflow` 의 `project_id` 만 본다.
- 보강 후보: 같은 키를 여러 UUID 가 쓰거나 다른 주문의 `state.json` 이 이미 있는 폴더를 막는 검사가 없다(`_dfc_map_keys`·착수 경로).
