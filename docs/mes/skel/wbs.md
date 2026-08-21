---
project: MES
module: mes-skel                # PMO 골격 — 시스템 키·levels 의 정본
start_date: 2026-09-01

# levels 정본 — PL 파일은 이 블록을 복사한다(불일치 = 업로드 거부).
levels:
  - { name: Phase,     prefix: PH,  progress: rollup }
  - { name: System,    prefix: SYS, progress: rollup }
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

# WBS — MES 골격 (PMO 소유)

<!-- 선행(PH-01·02)·후행(PH-04·05)은 시스템 횡단이라 System·Subsystem 층을 건너뛰고
     Phase 바로 밑 WP 로 간다(계약 스펙 "얕은 비대칭 트리" 조항 — 검증기 경고는 의도된 것).
     구축(PH-03)의 System 아래는 각 PL 파일이 attach 로 채운다 — 이 파일에 쓰지 않는다.
     시스템별 요건정의·상세설계는 이 파일(PH-01·02) 소속이다 — attach 가 단일(PH-03)이라
     PL 파일이 선행 Phase 에 붙을 수 없는 현 계약의 결과(v2.2 미결 항목). 담당 PL 이
     확정되면 해당 Task 의 @담당으로 배정한다. -->

## PH-01: 분석

### WP-AN-AS: 현행(AS-IS) 분석
- [ ] TSK-AN-AS-01: 전사 현행 업무·시스템 분석서   w:10  ~2026-09-12  credit:doc

### WP-AN-RQ: 요건 정의
- [ ] TSK-AN-RQ-01: 공통 요건정의서       w:3  ~2026-09-26  credit:doc
- [ ] TSK-AN-RQ-02: 품질 요건정의서       w:5  ~2026-09-26  credit:doc
- [ ] TSK-AN-RQ-03: 생산계획 요건정의서   w:5  ~2026-09-26  credit:doc
- [ ] TSK-AN-RQ-04: 조업 요건정의서       w:5  ~2026-09-26  credit:doc
- [ ] TSK-AN-RQ-05: 물류 요건정의서       w:5  ~2026-09-26  credit:doc

### WP-AN-IF: I/F 요건 정의
- [ ] TSK-AN-IF-01: 대외 I/F 요건 목록 (ERP·L2·계측)   w:5  ~2026-09-26  credit:doc
- [M] 분석 완료 보고회   ~2026-09-30

## PH-02: 설계

### WP-DS-AR: 아키텍처 설계
- [ ] TSK-DS-AR-01: 공통 프레임워크·기술 표준 설계   w:10  ~2026-10-17  credit:doc

### WP-DS-DA: 데이터 설계
- [ ] TSK-DS-DA-01: 전사 ERD·마스터·코드 체계 설계   w:10  ~2026-10-24  credit:doc

### WP-DS-DD: 시스템별 상세설계

#### ACT-DD-CM: 공통
- [ ] TSK-DD-CM-01: 공통 상세설계서   w:5  ~2026-10-31  credit:doc
#### ACT-DD-QA: 품질
- [ ] TSK-DD-QA-01: 품질 상세설계서   w:8  ~2026-10-31  credit:doc
#### ACT-DD-PP: 생산계획
- [ ] TSK-DD-PP-01: 생산계획 상세설계서   w:8  ~2026-10-31  credit:doc
#### ACT-DD-OP: 조업
- [ ] TSK-DD-OP-01: 조업이벤트 상세설계서   w:3  ~2026-10-31  credit:doc
- [ ] TSK-DD-OP-02: 입측 상세설계서         w:3  ~2026-10-31  credit:doc
- [ ] TSK-DD-OP-03: 출측 상세설계서         w:3  ~2026-10-31  credit:doc
- [ ] TSK-DD-OP-04: 순환품 상세설계서       w:3  ~2026-10-31  credit:doc
- [ ] TSK-DD-OP-05: L2 I/F 상세설계서       w:5  ~2026-10-31  credit:doc
- [ ] TSK-DD-OP-06: ERP I/F 상세설계서      w:3  ~2026-10-31  credit:doc
#### ACT-DD-LG: 물류
- [ ] TSK-DD-LG-01: 물류 상세설계서   w:8  ~2026-10-31  credit:doc

### WP-DS-IF: I/F 상세설계
- [ ] TSK-DS-IF-01: 전문 정의서·매핑 (I/F 대장 확정판)   w:8  ~2026-10-31  credit:doc
- [M] 설계 완료 보고회   ~2026-10-31

## PH-03: 구축

### SYS-CM: 공통
<!-- PL 파일 attach: PH-03/SYS-CM (module: mes-cm) — 프레임워크·인증·공통코드·배치 WP -->

### SYS-QA: 품질
<!-- PL 파일 attach: PH-03/SYS-QA (module: mes-qa) -->

### SYS-PP: 생산계획
<!-- PL 파일 attach: PH-03/SYS-PP (module: mes-pp) -->

### SYS-OP: 조업
<!-- PL 파일 attach: PH-03/SYS-OP (module: mes-op) -->

### SYS-LG: 물류
<!-- PL 파일 attach: PH-03/SYS-LG (module: mes-lg) -->

## PH-04: 통합테스트

### WP-IT-PL: 테스트 계획·환경·데이터
- [ ] TSK-IT-PL-01: 통테 계획·환경 구성·데이터 준비   w:8  ~2027-02-06  credit:doc

### WP-IT-IN: 시스템 내 통합
- [ ] TSK-IT-IN-01: 품질↔조업↔물류 통합 시나리오 수행   w:8  ~2027-02-13

### WP-IT-L2: L2 연동 테스트
- [ ] TSK-IT-L2-01: 공정별 실통신 검증 (L2 전 공정)   w:10  ~2027-02-20  credit:if

### WP-IT-ERP: ERP 연동 테스트
- [ ] TSK-IT-ERP-01: ERP 연동 시나리오 — 전사 통테는 PMO 소유, MES 측 참여·결함조치   w:8  ~2027-02-20  credit:if

### WP-IT-RG: 결함 관리·회귀
- [ ] TSK-IT-RG-01: 결함 관리·회귀 테스트 운영   w:5  ~2027-02-27
- [M] 전사 통합테스트 완료   ~2027-02-28

## PH-05: 적용

### WP-GO-MG: 데이터 이행
- [ ] TSK-GO-MG-01: 초기 마스터·기초재고 이행   w:8  ~2027-03-07

### WP-GO-ED: 사용자 교육·매뉴얼
- [ ] TSK-GO-ED-01: 사용자 교육·매뉴얼 작성   w:5  ~2027-03-07  credit:doc

### WP-GO-CO: 컷오버·오픈
- [ ] TSK-GO-CO-01: 컷오버 리허설·오픈   w:5  ~2027-03-14
- [M] 가동 개시   ~2027-03-16

### WP-GO-ST: 안정화
- [ ] TSK-GO-ST-01: 하이퍼케어 운영   w:10  ~2027-03-31
