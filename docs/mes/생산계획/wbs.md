---
project: MES
module: mes-pp
attach: PH-03/SYS-PP            # 골격(docs/mes/skel/wbs.md)의 부착점 — 이 노드의 자식으로 업로드된다

# levels — 골격 정본의 복사본. 수정 금지(불일치 = 업로드 거부). 골격이 바뀌면 이 블록을 다시 복사한다.
levels:
  - { name: Phase,     prefix: PH,  progress: rollup, owner: pmo, upload: false }
  - { name: System,    prefix: SYS, progress: rollup, owner: pmo, upload: false }
  - { name: Subsystem, prefix: SUB, progress: rollup }
  - { name: WP,        prefix: WP,  progress: rollup, report: weekly }
  - { name: Activity,  prefix: ACT, progress: rollup, optional: true }
  - { name: Task,      prefix: TSK, progress: input }
  - { name: SubTask,   prefix: STK, progress: checklist, optional: true, upload: fold }

credits:
  default: { 대기: 0, 설계: 20, 구현중: 50, 구현완료: 70, 테스트완료: 90, 검수완료: 100 }
  if:      { 대기: 0, 구현중: 30, 구현완료: 50, 연동검증: 100 }
  doc:     { 미착수: 0, 작성중: 30, 제출: 50, 검수완료: 100 }
---

# WBS — MES 생산계획 (담당 PL: 미정)

<!-- 작성 규칙 (자세한 계약: .claude/skills/dflow-wbs-nlevel/SKILL.md)
  - 이 파일의 최상위는 SUB- 부터. PH-·SYS- 를 본문에 쓰면 검증 에러.
  - 구성 관례: 모듈 Water 꼬리(기본설계 WP, credit:doc) → 업무 Subsystem(프로세스/화면 WP)
               → L2 I/F(공정 축) / ERP I/F(업무 축) → 모듈 통합 시나리오 WP.
  - Task 표기: - [ ] TSK-XX-000: 이름 @담당 w:공수 ~종료일 credit:표키 [if-id:IF-0000]
  - SubTask(STK)는 Task 밑 들여쓴 체크박스 — 집계 불개입, 부모 acceptance 로 접혀 올라감(fold).
  - 상태는 항상 [ ]. 실적 % 를 쓰지 않는다. ID 재번호매김 금지.
  - ⚠️ 업로드 게이트: import v2.2 전까지 작성·검수 전용. -->

## SUB-00: 생산계획 공통

### WP-00-DS: 생산계획 기본설계
- [ ] TSK-00-001: 생산계획 요건정의서   w:5  ~2026-09-26  credit:doc
- [ ] TSK-00-002: 생산계획 DB(ERD)·모듈 공유 계약 설계   w:5  ~2026-10-24  credit:doc

<!-- 이하 업무 Subsystem 을 추가하세요. 예:
## SUB-XX: (업무 영역)
### WP-XX-PR: 프로세스
#### ACT-XX-PR-1: (그룹 — 선택)
- [ ] TSK-XX-001: ...
### WP-XX-UI: 화면
- [ ] TSK-XX-101: ...
-->
