# WBS - 합성 샘플 (4단)

> version: 1.0
> depth: 4
> start-date: 2026-11-02 / target-date: 2026-12-31 / updated: 2026-10-19

---

## Dev Config

### Domains
| domain | description | unit-test | e2e-test | e2e-server | e2e-url |
|--------|-------------|-----------|----------|------------|---------|
| backend | 서버 | `npm run test` | - | - | - |

## WP-01: 기준정보
- schedule: 2026-11-02 ~ 2026-12-11
- description: 품목·거래처 기준정보

### ACT-01-01: 품목 관리

#### TSK-01-01-01: 품목 등록 화면
- category: dev
- domain: fullstack
- model: sonnet
- status: [ ]
- priority: high
- assignee: -
- schedule: 2026-11-02 ~ 2026-11-06
- tags: master
- depends: -
- entry-point: 기준정보 > 품목

##### PRD 요구사항
- prd-ref: program:MD-001
- requirements:
  - 품목 코드는 유일하다
- acceptance:
  - 중복 코드는 저장되지 않는다
- constraints:
  - 코드 길이는 20자 이하
- test-criteria:
  - 단위 시험 3건

##### 기술 스펙 (TRD)
- api-spec:
  - POST /api/items
- data-model:
  - Item(code, name)
  - ItemHistory(item_code, changed_at)

#### TSK-01-01-02: 품목 일괄 업로드
- category: dev
- domain: backend
- status: [ts]
- priority: medium
- schedule: 2026-11-09 ~ 2026-11-13
- depends: TSK-01-01-01

### ACT-01-02: 거래처 관리

#### TSK-01-02-01: 거래처 등록
- category: dev
- domain: fullstack
- status: [dd!]
- priority: critical
- schedule: 2026-11-16 ~ 2026-11-20
- depends:
  - TSK-01-01-01
- entry-point: 기준정보 > 거래처

## WP-02: 생산
- schedule: 2026-12-14 ~ 2026-12-31

### ACT-02-01: 작업지시

#### TSK-02-01-01: 작업지시 발행
- category: dev
- domain: backend
- status: [as]
- priority: high
- assignee: dev2@example.com
- schedule: 2026-12-14 ~ 2026-12-18
- depends: TSK-01-02-01

#### TSK-02-01-02: 작업지시 취소 (명세 헤딩 깊이 실수)
- category: dev
- domain: backend
- status: [ ]
- priority: medium
- schedule: 2026-12-21 ~ 2026-12-24

#### PRD 요구사항
- requirements:
  - TSK 와 같은 깊이 헤딩이라 블록이 여기서 끝나 이 요구사항은 잡히지 않는다
