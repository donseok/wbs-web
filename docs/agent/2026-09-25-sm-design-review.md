# SM 처리를 위한 WBS — 요약과 설계 검토

> `docs/idea.md` 에서 옮긴 상세(2026-09-25). 요약 한 줄은 idea.md 에 남아 있다.

설계 정본: [2026-09-21 SM 운영 설계](../superpowers/specs/2026-09-21-sm-operations-design.md)

- 정보처리의뢰서 → 이슈(`sourceType: request`) → Task N건(이슈 1 : Task N, `issue_tasks`) → 기존 에이전트 루프. 루프 자체는 고치지 않는다.
- 이슈 → Task 분할은 **AI 자동 분할 + 결정적 관문 + 사후 교정**(2026-09-23 개정, 설계 §5.3). 초판의 "쪼개는 일은 사람이 한다" 를 뒤집었다.
  - LLM 이 후보마다 제목·근거 인용·대상 시스템·Mega/Major·위임 여부를 낸다. 선례 `minute-issue-draft.ts`, 실행 기록은 0056 패턴(`issue_split_runs`).
  - 관문은 모델 신뢰도가 아니라 규칙이다(매핑표 존재·분류 유효·담당자 유효·인용 실재·중복). 걸린 후보만 「확인 필요」 로 사람에게 간다.
  - APS·MES 구분은 WBS 계층이 아니라 **대상 시스템 → 기본 담당 멤버 매핑표**가 정한다. 에이전트가 `assignee_member_id` 로 집으므로 팀이 아니라 멤버여야 하고, 슈퍼유저는 넣을 수 없다.
  - `wbs_items` 쓰기 RLS 가 관리자 전용이라 service\_role 로 우회하지 않는다. 멤버가 등록한 의뢰서는 「관리자 반영 대기」 로 남는다. 위임 태그는 `applyDelegation` 경유.
- 사람 개입은 관문에 걸린 후보와 이슈 `resolved` 확정 두 곳뿐이다. 연결된 Task 가 전부 완료돼야 해결 후보로 올린다(단방향 동기화).
- 미착수. 마이그레이션 대상 넷(`request` 값·`issue_tasks`·`issue_split_runs`·매핑표)은 스테이징 리허설 필요.
- **설계 검토 결과(2026-09-25, 설계 개정 대기)** — 리포 쪽(작업 폴더·설정)을 설계가 다루지 않아 생긴 구멍들.
  1. 치명: §5.2 는 Task 를 `addWbsItem` 으로 만드는데 이 경로는 `external_ref` 를 쓰지 않는다(쓰는 곳은 `wbsImport.ts:161` 뿐). claim 은 통과하고 `dflow.sh taskdir` 가 `NO_REF` 로 멈춘다 → "루프는 고치지 않는다" 전제가 깨진다. 변환 동작이 ref 를 발급해야 한다.
  2. 운영 프로젝트는 한 폴더가 수년간 자라므로 ref 는 프로젝트 안에서 유일해야 한다(작업 폴더·브랜치 슬러그·`decision-log.py` 라벨이 모두 ref 마지막 칸). 후보: `SM-<접수분기>-<일련>`(예 `SM-2027Q1-0017`) — 분기를 ID 에 넣으면 WBS 에서 Task 를 옮겨도 폴더가 안 움직인다. 분기(Q1·Q2…)는 SM 프로젝트의 Phase 로 만든다.
  3. 운영 프로젝트 하나가 여러 시스템을 담으면 `project_map`(UUID 하나에 키 하나)으로는 시스템별 폴더를 못 가른다 → 사용자 선택은 ③ `targetSystem` 으로 분기: `.dflow` 에 `ops_map=mdm=docs/mdm/ops,aps=docs/aps/ops,…`, `taskdir`·`claim`·`scaffold`·`tasks-dirs` 수정(poll·sweep·방언 검증은 `tasks-dirs` 만 돌아 무수정), 표에 없는 시스템은 `NO_OPS_DIR` 로 멈춤. 원칙은 "루프의 폴더 해석 한 곳만 고친다" 로 좁혀 개정.
  4. §6.7 인계 5번대로 `.dflow` 의 `project_id` 만 바꾸면 `docs/tasks` 로 폴백된다(`dflow-config.sh:178`). §8.5 는 09-23 `.dflow`/`.dflow.local` 분리 이전 서술.
  5. 프로젝트 한정 PAT(§8.3) + 리포당 키 하나(`as=`) → 인계 뒤 남은 개발 Task 는 404. 주문 프로젝트별 키 선택 코드는 찾지 못함. 인계 전 정리 또는 전환기 전체 PAT 규칙 필요.
  6. §5.3.1 후보 스키마에 명세 본문이 없어 claim 한 `spec.md` 가 제목뿐 → `excerpt` + 이슈 링크로 채운다.
  7. 사소: 줄 번호 낡음(`addWbsItem` 255·`addSubAct` 311), §6.4 노드 자동 생성 vs §10 "1차는 사람이" 불일치.
