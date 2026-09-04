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

<!-- ⚠️ 샘플 (2026-08-22 스킬 생성): programs.yaml(샘플)에서 전개 — PL 확정 전 검수·수정 대상.
  작성 규칙 (계약: .claude/skills/dflow-wbs-nlevel/SKILL.md)
  - 최상위는 SUB-QA- 부터. PH-·SYS- 를 본문에 쓰면 검증 에러.
  - 요건정의·상세설계는 골격(PH-01·02) 소속 — 이 파일은 구축 구현만 담는다.
  - ID 채번: {접두}-{SYS}-{경로꼬리}-{순번} — 예: TSK-QA-JD-PR-01 (품질>판정>프로세스>1번)
  - prd-ref: program:{id} 는 programs.yaml 매칭 키 — 재생성 시 보존.
  - 상태는 항상 [ ]. 실적 % 금지. ID 재번호매김 금지. -->

## SUB-QA-QD: 품질설계

### WP-QA-QD-PR: 프로세스
- [ ] TSK-QA-QD-PR-01: 품질설계 전개 프로세스(주문→공정별 기준)   w:5  ~2026-11-21
  - prd-ref: program:QA-QD-001
- [ ] TSK-QA-QD-PR-02: 규격·기준 마스터 관리 프로세스   w:3  ~2026-11-21
  - prd-ref: program:QA-QD-002
### WP-QA-QD-UI: 화면
- [ ] TSK-QA-QD-UI-01: 품질 기준 관리 화면   w:3  ~2026-11-28
  - prd-ref: program:QA-QD-101
  - depends: TSK-QA-QD-PR-02
- [ ] TSK-QA-QD-UI-02: 주문 품질 요구 조회 화면   w:2  ~2026-11-28
  - prd-ref: program:QA-QD-102
  - depends: TSK-QA-QD-PR-01

## SUB-QA-TS: 시험검사

### WP-QA-TS-PR: 프로세스
- [ ] TSK-QA-TS-PR-01: 시험 의뢰 생성 프로세스(샘플링 룰)   w:5  ~2026-12-05
  - prd-ref: program:QA-TS-001
  - depends: TSK-QA-QD-PR-01
- [ ] TSK-QA-TS-PR-02: 시험 실적 수집 프로세스   w:5  ~2026-12-12
  - prd-ref: program:QA-TS-002
  - depends: TSK-QA-TS-PR-01
### WP-QA-TS-UI: 화면
- [ ] TSK-QA-TS-UI-01: 시험 의뢰 현황 화면   w:3  ~2026-12-12
  - prd-ref: program:QA-TS-101
  - depends: TSK-QA-TS-PR-01
- [ ] TSK-QA-TS-UI-02: 시험 실적 입력·조회 화면   w:3  ~2026-12-19
  - prd-ref: program:QA-TS-102
  - depends: TSK-QA-TS-PR-02

## SUB-QA-JD: 판정

### WP-QA-JD-PR: 프로세스
- [ ] TSK-QA-JD-PR-01: 품질 자동판정 프로세스(룰 엔진)   w:5  ~2026-12-19
  - category: dev
  - domain: backend
  - priority: critical
  - tags: qa, judge, process
  - prd-ref: program:QA-JD-001
  - depends: TSK-QA-TS-PR-02
  - requirements: 시험 실적·공정 실적을 기준(품질설계 전개 결과)과 대조해 코일 단위 합부·등급을 자동 판정하고, 판정 불가 건은 수동판정 큐로 보낸다.
  - acceptance: 판정 룰 테이블 기반(하드코딩 없음) / 판정 이력 전건 보존·조회 / 수동판정 큐 적재·처리 경로 동작
  - [ ] STK-QA-JD-PR-01-1: 판정 룰 테이블 설계 리뷰
  - [ ] STK-QA-JD-PR-01-2: 등급 하향 규칙 케이스 정리
- [ ] TSK-QA-JD-PR-02: 재판정·용도변경 처리 프로세스   w:3  ~2026-12-26
  - prd-ref: program:QA-JD-002
  - depends: TSK-QA-JD-PR-01
### WP-QA-JD-UI: 화면
- [ ] TSK-QA-JD-UI-01: 판정 현황 화면   w:3  ~2026-12-26
  - prd-ref: program:QA-JD-101
  - depends: TSK-QA-JD-PR-01
- [ ] TSK-QA-JD-UI-02: 재판정 처리 화면   w:3  ~2027-01-09
  - prd-ref: program:QA-JD-102
  - depends: TSK-QA-JD-PR-02

## SUB-QA-NC: 부적합

### WP-QA-NC-PR: 프로세스
- [ ] TSK-QA-NC-PR-01: 부적합 등록·처리 프로세스   w:3  ~2027-01-09
  - prd-ref: program:QA-NC-001
  - depends: TSK-QA-JD-PR-01
### WP-QA-NC-UI: 화면
- [ ] TSK-QA-NC-UI-01: 부적합 관리 화면   w:3  ~2027-01-16
  - prd-ref: program:QA-NC-101
  - depends: TSK-QA-NC-PR-01
- [ ] TSK-QA-NC-UI-02: 클레임 접수·처리 화면   w:3  ~2027-01-16
  - prd-ref: program:QA-NC-102
  - depends: TSK-QA-NC-PR-01

## SUB-QA-CR: 성적서

### WP-QA-CR-PR: 프로세스
- [ ] TSK-QA-CR-PR-01: 성적서(Mill Sheet) 생성 프로세스   w:5  ~2027-01-16
  - prd-ref: program:QA-CR-001
  - depends: TSK-QA-JD-PR-01
### WP-QA-CR-UI: 화면
- [ ] TSK-QA-CR-UI-01: 성적서 발행·이력 화면   w:3  ~2027-01-23
  - prd-ref: program:QA-CR-101
  - depends: TSK-QA-CR-PR-01

## SUB-QA-LABIF: 시험설비 I/F
<!-- 설비 축 Subsystem — WP = 시험설비. 키 매핑: 인장시험기=TEN, 경도계=HRD, 표면결함검사기=SDD -->

### WP-QA-LB-TEN: 인장시험기
- [ ] TSK-QA-LB-TEN-01: 시험 결과 수신 I/F   w:5  ~2026-12-19  credit:if
  - prd-ref: program:QA-LB-001
### WP-QA-LB-HRD: 경도계
- [ ] TSK-QA-LB-HRD-01: 시험 결과 수신 I/F   w:3  ~2027-01-09  credit:if
  - prd-ref: program:QA-LB-011
### WP-QA-LB-SDD: SDD
- [ ] TSK-QA-LB-SDD-01: 표면결함 판정 수신 I/F   w:5  ~2027-01-16  credit:if
  - prd-ref: program:QA-LB-021

## SUB-QA-ERPIF: ERP I/F
<!-- 업무 축 Subsystem. if-id = PMO I/F 대장 참조(쌍 연결 — ERP 측 상대 Task 와 함께 완료). -->

### WP-QA-ERP-CR: 품질성적
- [ ] TSK-QA-ERP-CR-01: 품질 성적 송신 I/F   w:5  ~2027-01-23  credit:if  if-id:IF-0041
  - prd-ref: program:QA-ER-001
  - depends: TSK-QA-CR-PR-01
### WP-QA-ERP-CL: 클레임
- [ ] TSK-QA-ERP-CL-01: 클레임 정보 수신 I/F   w:3  ~2027-01-30  credit:if  if-id:IF-0042
  - prd-ref: program:QA-ER-011
