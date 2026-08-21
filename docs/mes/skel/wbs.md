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

<!-- 이 파일이 정의하는 것: Phase 5개(WSF), 구축 하위 System 5개, 전사 횡단 작업(WSF 의 빵).
     System 아래(SUB 이하)는 각 PL 파일이 attach 로 채운다 — 이 파일에 쓰지 않는다.
     선행·후행 Phase 의 전사 WP 는 System·Subsystem 층을 건너뛴다(시스템 횡단 작업의
     구조적 특성 — 계약 스펙 "얕은 비대칭 트리" 허용 조항. 검증기 경고는 의도된 것). -->

## PH-01: 분석

### WP-SK-AN: 전사 분석 총괄
- [ ] TSK-SK-001: 마스터플랜·표준 수립 (WBS 코드·산출물 표준)   w:5  ~2026-09-12  credit:doc
- [ ] TSK-SK-002: 마스터데이터 거버넌스 정의 (품목·BOM·공정 소유권)  w:5  ~2026-09-26  credit:doc
- [ ] TSK-SK-003: 전사 I/F 대장 개설 (ERP·L2 연계 목록 초판)    w:3  ~2026-09-26  credit:doc
- [M] 분석 완료 보고회   ~2026-09-30

## PH-02: 설계

### WP-SK-AR: 전사 아키텍처·공통 계약
- [ ] TSK-SK-011: 전사 아키텍처 설계 (기술 스택·연계 표준·보안)  w:10  ~2026-10-24  credit:doc
- [ ] TSK-SK-012: 전사 공유 계약 (공통코드·조직·권한 — 계약 전용)  w:5  ~2026-10-31  credit:doc
- [M] 설계 완료 보고회   ~2026-10-31

## PH-03: 구축

### SYS-CM: 공통
<!-- PL 파일 attach: PH-03/SYS-CM (module: mes-cm) -->

### SYS-QA: 품질
<!-- PL 파일 attach: PH-03/SYS-QA (module: mes-qa) -->

### SYS-PP: 생산계획
<!-- PL 파일 attach: PH-03/SYS-PP (module: mes-pp) -->

### SYS-OP: 조업
<!-- PL 파일 attach: PH-03/SYS-OP (module: mes-op) -->

### SYS-LG: 물류
<!-- PL 파일 attach: PH-03/SYS-LG (module: mes-lg) -->

## PH-04: 통합테스트

### WP-SK-IT: 전사 통합테스트 총괄
- [ ] TSK-SK-021: 전사 통합 시나리오 설계 (시스템 관통)   w:5  ~2027-02-06  credit:doc
- [ ] TSK-SK-022: ERP 연동 테스트 총괄 (I/F 대장 기준 쌍 검증)  w:5  ~2027-02-20  credit:if
- [M] 전사 통합테스트 완료   ~2027-02-28

## PH-05: 적용

### WP-SK-GO: 이행·오픈
- [ ] TSK-SK-031: 컷오버 계획·리허설   w:5  ~2027-03-07  credit:doc
- [ ] TSK-SK-032: 오픈·하이퍼케어 운영   w:5  ~2027-03-31
- [M] 가동 개시   ~2027-03-16
