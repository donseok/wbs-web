---
project: MES
module: mes-op
attach: PH-03/SYS-OP            # 골격(docs/mes/skel/wbs.md)의 부착점 — 이 노드의 자식으로 업로드된다

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

# WBS — MES 조업 (담당 PL: 미정)

<!-- 작성 규칙 (계약: .claude/skills/dflow-wbs-nlevel/SKILL.md)
  - 최상위는 SUB- 부터. PH-·SYS- 를 본문에 쓰면 검증 에러.
  - 요건정의·상세설계는 골격(PH-01·02) 소속 — 이 파일은 구축 구현만 담는다.
  - Task 표기: - [ ] TSK-XX-000: 이름 @담당 w:공수 ~종료일 credit:표키 [if-id:IF-0000]
  - 상태는 항상 [ ]. 실적 % 금지. ID 재번호매김 금지.
  - ⚠️ 업로드 게이트: import v2.2 전까지 작성·검수 전용. -->

## SUB-EV: 조업이벤트

### WP-EV-PR: 프로세스
- [ ] TSK-EV-001: 조업이벤트 수집·배포 프로세스   w:5  ~2026-11-14
### WP-EV-UI: 화면
- [ ] TSK-EV-101: 조업이벤트 모니터링 화면   w:3  ~2026-11-21

## SUB-IN: 입측

### WP-IN-PR: 프로세스
- [ ] TSK-IN-001: 입측 실적 수집 프로세스   w:5  ~2026-11-14
  - category: dev
  - domain: backend
  - model: opus
  - priority: critical
  - tags: op, entry, process
  - depends: TSK-L2-221
  - prd-ref: OP-PRD §4.2 입측 조업
  - requirements: L2 인입 통보(트래킹 수신) 시 입고 실적을 생성하고 입측 재고에 반영한다. 소재-주문 매핑 불일치는 예외 큐로 보낸다.
  - acceptance: 수신→실적→재고 반영 단일 트랜잭션 / 동일 전문 중복 수신 멱등(실적 중복 0건) / 예외 큐 적재·재처리 경로 동작
  - [ ] STK-IN-001-1: 크레인 계량 연계 확인
  - [ ] STK-IN-001-2: 중복 수신 방어 로직
  - [ ] STK-IN-001-3: 실적 테이블 설계 리뷰
- [ ] TSK-IN-002: 입측 판정 프로세스       w:5  ~2026-11-21
  - category: dev
  - domain: backend
  - model: sonnet
  - priority: high
  - tags: op, entry, process
  - depends: TSK-IN-001
  - prd-ref: OP-PRD §4.3 입측 판정
  - requirements: 입고 코일의 조업 가능 판정(치수·중량·표면 등급)을 수행하고 판정 예외를 처리한다.
  - acceptance: 판정 룰 테이블 기반 자동 판정 / 예외 건 수동 판정 경로 제공 / 판정 이력 전건 조회
### WP-IN-UI: 화면
- [ ] TSK-IN-101: 입측 작업 현황 화면   w:3  ~2026-11-21
  - category: dev
  - domain: fullstack
  - model: sonnet
  - priority: high
  - tags: op, entry, ui
  - depends: TSK-IN-001
  - prd-ref: OP-PRD §4.2.3
  - entry-point: /op/entry/status (메뉴: 조업 > 입측 > 작업 현황)
  - requirements: 입측 야드~페이오프릴 구간 코일 위치·상태 실시간 조회, 입고 실적·예외 큐 건수 표시.
  - acceptance: 트래킹 이벤트 후 5초 이내 화면 반영 / 조회 전용(정정은 별도 화면)
- [ ] TSK-IN-102: 입측 실적 조회 화면   w:2  ~2026-11-28
  - category: dev
  - domain: fullstack
  - model: sonnet
  - priority: medium
  - tags: op, entry, ui
  - depends: TSK-IN-001
  - prd-ref: OP-PRD §4.2.4
  - entry-point: /op/entry/results (메뉴: 조업 > 입측 > 실적 조회)
  - requirements: 기간·공정·코일번호 조건의 입고 실적 조회와 엑셀 다운로드.
  - acceptance: 10만 건 기준 3초 이내 페이징 조회 / 다운로드 컬럼 = 화면 컬럼

## SUB-OUT: 출측

### WP-OUT-PR: 프로세스
- [ ] TSK-OUT-001: 출측 실적 수집 프로세스   w:5  ~2026-11-28
### WP-OUT-UI: 화면
- [ ] TSK-OUT-101: 출측 작업 현황 화면   w:3  ~2026-12-05

## SUB-RC: 순환품

### WP-RC-PR: 프로세스
- [ ] TSK-RC-001: 순환품 처리 프로세스   w:5  ~2026-12-05
### WP-RC-UI: 화면
- [ ] TSK-RC-101: 순환품 관리 화면   w:3  ~2026-12-12

## SUB-L2IF: L2 I/F
<!-- 공정 축 Subsystem — WP = 공정. 공정 키는 설비 표준 코드 그대로. -->

### WP-L2-PLTCM: PLTCM
- [ ] TSK-L2-201: 실적 수신 I/F       w:5  ~2026-12-12  credit:if
- [ ] TSK-L2-202: 작업지시 송신 I/F   w:3  ~2026-12-19  credit:if
### WP-L2-TM: TM
- [ ] TSK-L2-211: 실적 수신 I/F   w:3  ~2026-12-19  credit:if
### WP-L2-2CGL: 2CGL
- [ ] TSK-L2-221: 트래킹 수신 I/F     w:5  ~2026-12-19  credit:if
- [ ] TSK-L2-222: 코일 정보 송신 I/F  w:3  ~2026-12-26  credit:if
### WP-L2-3CGL: 3CGL
- [ ] TSK-L2-231: 실적 수신 I/F   w:3  ~2027-01-16  credit:if
### WP-L2-4CGL: 4CGL
- [ ] TSK-L2-241: 실적 수신 I/F   w:3  ~2027-01-16  credit:if
### WP-L2-5CGL: 5CGL
- [ ] TSK-L2-251: 실적 수신 I/F   w:3  ~2027-01-16  credit:if
### WP-L2-2CCL: 2CCL
- [ ] TSK-L2-261: 실적 수신 I/F   w:3  ~2027-01-16  credit:if
### WP-L2-3CCL: 3CCL
- [ ] TSK-L2-271: 실적 수신 I/F   w:3  ~2027-01-16  credit:if
### WP-L2-4CCL: 4CCL
- [ ] TSK-L2-281: 실적 수신 I/F   w:3  ~2027-01-16  credit:if
### WP-L2-5CCL: 5CCL
- [ ] TSK-L2-291: 실적 수신 I/F   w:3  ~2027-01-16  credit:if
### WP-L2-6CCL: 6CCL
- [ ] TSK-L2-301: 실적 수신 I/F   w:3  ~2027-01-16  credit:if
### WP-L2-7CCL: 7CCL
- [ ] TSK-L2-311: 실적 수신 I/F   w:3  ~2027-01-16  credit:if
### WP-L2-8CCL: 8CCL
- [ ] TSK-L2-321: 실적 수신 I/F   w:3  ~2027-01-16  credit:if
### WP-L2-9CCL: 9CCL
- [ ] TSK-L2-331: 실적 수신 I/F   w:3  ~2027-01-16  credit:if
### WP-L2-ACCL: ACCL
- [ ] TSK-L2-341: 실적 수신 I/F   w:3  ~2027-01-16  credit:if

## SUB-ERPIF: ERP I/F
<!-- 업무 축 Subsystem. if-id = PMO I/F 대장 참조(쌍 연결 — ERP 측 상대 Task 와 함께 완료). -->

### WP-ERP-PR: 생산실적
- [ ] TSK-ERP-301: 조업 실적 ERP 송신 I/F   w:5  ~2027-01-23  credit:if  if-id:IF-0031
- [ ] TSK-ERP-302: 실적 정정 송신 I/F       w:2  ~2027-01-23  credit:if  if-id:IF-0033
### WP-ERP-WO: 작업지시
- [ ] TSK-ERP-311: 생산오더 수신 I/F   w:3  ~2027-01-30  credit:if  if-id:IF-0032
