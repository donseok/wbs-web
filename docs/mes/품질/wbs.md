---
project: MES
module: mes-qa
attach: PH-03/SYS-QA            # 골격(docs/mes/skel/wbs.md)의 부착점 — 이 노드의 자식으로 업로드된다

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

# WBS — MES 품질 (담당 PL: 미정)

<!-- 작성 규칙 (계약: .claude/skills/dflow-wbs-nlevel/SKILL.md)
  - 최상위는 SUB- 부터. PH-·SYS- 를 본문에 쓰면 검증 에러.
  - 요건정의·상세설계는 골격(PH-01·02) 소속 — 이 파일은 구축 구현만 담는다.
  - ID 채번: {접두}-{SYS}-{경로꼬리}-{순번} — 예: TSK-QA-XX-PR-01
  - 상태는 항상 [ ]. 실적 % 금지. ID 재번호매김 금지.
  - ⚠️ 업로드 게이트: import v2.2 전까지 작성·검수 전용. -->

<!-- 업무 Subsystem 을 추가하세요 — 조업 파일(docs/mes/조업/wbs.md)이 풀 전개 예시입니다.
## SUB-QA-XX: (업무 영역)
### WP-QA-XX-PR: 프로세스
- [ ] TSK-QA-XX-PR-01: ...
### WP-QA-XX-UI: 화면
- [ ] TSK-QA-XX-UI-01: ...
## SUB-QA-L2IF: L2 I/F        ← 공정 축 (해당 시스템만)
## SUB-QA-ERPIF: ERP I/F      ← 업무 축 (if-id 로 대장 연결)
-->
