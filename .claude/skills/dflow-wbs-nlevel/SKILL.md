---
name: dflow-wbs-nlevel
description: N단(5~8단) 대형 프로젝트의 wbs.md 를 levels 계약(frontmatter 단계 선언·접두어 판정·진도 역할·업로드 범위)으로 생성·검증할 때 사용. PMO 골격(--skeleton)과 PL 모듈 파일 두 모드. 트리거 - "/dflow-wbs-nlevel", "N단 WBS", "8단 WBS", "골격 WBS", "PL WBS", "levels frontmatter". 3~4단 기존 흐름은 dflow-wbs(동결)를 쓴다. 사용법 - /dflow-wbs-nlevel [--skeleton 시스템목록 | 모듈경로] [--programs 경로]
---

# /dflow-wbs-nlevel — N단 WBS 생성 (levels 계약)

> **계약 정본은 `docs/superpowers/specs/2026-08-21-wbs-nlevel-md-contract.md` 다.**
> 생성 전에 반드시 Read 하고, 이 파일과 다르면 그 문서가 이긴다.
> 기존 `dflow-wbs`(3~4단 WSF)는 **동결** — 이 스킬과 규약이 다르며 서로 섞지 않는다.
>
> ⚠️ **업로드 게이트**: import 계약 v2.2(levels·attach·fold 서버 수용) 구현 전까지
> 이 스킬의 산출물은 **작성·검수 전용**이다. `POST /api/v1/wbs/import` 로 올리지 않는다.
> v2.2 랜딩 후 dflow-export 정합을 거쳐 게이트가 풀린다.

## 모드 — 인자로 판정

| 모드 | 인자 | 산출물 | 소유 |
|---|---|---|---|
| **골격** | `--skeleton {시스템목록}` | Phase·System 골격 wbs.md + 시스템 키 목록 + levels 정본 + PL 파일 템플릿(배포 킷) | PMO/PM |
| **PL** (기본) | `{모듈 디렉토리}` (예: `docs/mes/조업`) `[--programs 경로]` | 그 모듈의 wbs.md (Subsystem 이하) | 담당 PL |

PL 모드는 **골격 파일을 입력으로 요구한다** — 같은 프로젝트 루트의 골격 wbs.md 에서 levels·시스템 키를
읽어 복사하고, 없으면 에러 후 중단(골격 선행 원칙). levels 를 임의로 새로 쓰지 않는다.
예외 — 사용자가 골격 부재를 알고도 초안을 명시 요구하면: 스펙 정본 샘플의 levels 를 "임시 사본"으로
복사하고, 파일 머리와 리포트에 **골격 발행 후 대조 필수(불일치 시 골격이 이김)·대조 전 업로드 금지**를
명시한다. 임시 사본 없이 levels 를 창작하는 것은 여전히 금지.

## 계약 요약 (정본: 스펙 문서)

### 1. frontmatter — 단계는 여기서만 선언한다

```yaml
---
project: MES
module: mes-op                  # PL 모드 필수 — external_ref 네임스페이스
attach: PH-03/SYS-OP            # PL 모드 필수 — 골격의 부착점 노드
levels:                         # 골격이 정본, PL 파일은 복사본(불일치 = 업로드 거부)
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
```

- 산문 표·본문 절로 단계를 선언하지 않는다 — 기계 파싱 대상은 frontmatter 뿐이다.
- `progress` 4종: `input`(leaf 입력·발행 대상) / `rollup`(집계 전용 — leaf 면 에러) /
  `checklist`(완료 ○/× 만, 집계 불개입, leaf 전용) / `none`(마일스톤).
- `upload` 3종: `true`(기본) / `false`(파일 전용) / `fold`(부모 acceptance 로 접힘).
  **아래에서 위로만** 끌 수 있다. `input` 층은 `true` 강제. 노드 단위 skip 마커를 발명하지 않는다.

### 2. 단계 판정 — 접두어가 정본

- `TSK-` 접두 = Task. **ID 세그먼트 수·헤딩 깊이로 층을 판정하지 않는다.**
- 헤딩 깊이·리스트 들여쓰기는 **부모 판정(구조)** 에만 쓴다.
- 검증: 자식의 단계 순번 > 부모의 단계 순번 (건너뛰기 허용 — 선택층, 역행·동급 금지).
- 마크다운 헤딩 6단 한계는 **리스트 들여쓰기가 흡수**한다 — Task 이하를 `- [ ]` 리스트로 쓰면
  헤딩 캡·중복 깊이가 생기지 않는다. 같은 헤딩 깊이에 두 단계를 겹쳐 쓰지 않는다.
- ID = external_ref 매칭 키. 재번호매김 금지, 사라진 ID 재사용 금지 (dflow-wbs 와 동일 규칙).

### 3. 본문 표기 (한 줄 요약 — 전체 표는 스펙)

```markdown
## PH-03: 구축                       ← 헤딩: 상위 층
##### WP-IN-PR: 프로세스
###### ACT-IN-PR-1: 실적 관리
- [ ] TSK-IN-001: 입측 실적 수집 @홍길동 w:5 ~2026-10-17 credit:default
  - [ ] STK-IN-001-1: 중복 수신 방어   ← checklist (fold)
- [M] 분석 완료 보고회 ~2026-09-30     ← 마일스톤 (progress:none)
```

`@담당` `w:가중치(MD, 생략=1)` `~종료일` `credit:크레딧표키` `if-id:I/F대장ID`.
상태는 항상 `[ ]` — 전이 정본은 D'Flow(dflow-wbs 와 동일). 실적 % 를 파일에 쓰지 않는다.

### 4. WSF 배치 — 모드가 샌드위치를 나눠 갖는다

- `--skeleton` = **빵**: Water(PH-01 분석·PH-02 설계 골격 + 전사 아키텍처·공통 계약 Task) +
  Fall(PH-04 통합테스트·PH-05 적용 골격 + 시스템 관통·컷오버).
- PL 모드 = **속**: 모듈 Water 꼬리(모듈 요건분석·상세설계·DB(ERD)·모듈 공유 계약(계약 전용)) +
  Scrum(프로그램 Task — 1 프로그램 = 1 fullstack Task 수직 슬라이스) + 모듈 Fall(모듈 통합 시나리오).
- depends 사슬·경계 규칙("2+ 모듈 공유만 선행", 통테 결함은 defect 되돌림)은 dflow-wbs §전체 구조를
  계승한다. category 7종·수직 슬라이스·FS 전용 depends 도 동일.

### 5. 분리 업로드 전제

- 골격 먼저, PL 파일들은 무순서. module = 디렉토리 세그먼트(`docs/mes/조업` → 조업 매핑표 or 영문 코드).
- PL 파일 최상위 노드는 attach 가 가리키는 골격 노드의 자식으로 들어간다 — 골격 층(PH·SYS)을
  PL 파일 본문에 쓰면 에러.
- module 1개 = 파일 1개. ID 는 모듈 안에서만 유일하면 된다.

## 골격 정의 파일 (`skeleton.yaml`) — 골격 모드의 입력 정본

```yaml
project: MES
start_date: 2026-09-01
phases:                     # 생략 시 WSF 기본 5단계 (분석/설계/구축/통합테스트/적용)
  - { key: PH-03, name: 구축, build: true }   # build: true = 시스템 트리가 붙는 Phase
levels: default             # 'default' = 스펙 정본 7층. 커스텀이면 배열
systems:
  - { key: SYS-OP, name: 조업, module: mes-op, pl: 박PL }
```

- **파일이 있으면 무질문 생성.** 파일이 없으면 대화로 수집한다 — 질문은 셋뿐:
  ① 프로젝트명 ② 단계(WSF 기본 5단계를 제시하고 수정 여부) ③ 시스템 목록(이름을 받아 키·module 을
  제안 → 사용자 확정). 답으로 **skeleton.yaml 을 생성하고 멈춘다** — "파일 검토 후 재실행" 안내.
  즉석 골격 생성 금지: 시스템 키는 external_ref 라 불변이며, 리뷰 없이 확정하지 않는다.
- 시스템 목록을 스킬이 지어내지 않는다 — 입력(파일 또는 답변)에 없는 시스템은 만들지 않는다.
- 필수 누락(project 없음, systems 0개)은 중단. 선택 누락(pl 미정)은 기본값 + 리포트.

## 실행 플로우

1. 스펙 문서 Read (계약 로드).
2. 모드 판정 (`--skeleton` 유무).
3. **골격 모드**: skeleton.yaml 로드(없으면 위 대화 수집 → 파일 생성 후 종료) → PH + System 노드 생성 →
   levels·credits 정본 작성 → PL 템플릿(모듈별, attach·levels 채움) 생성 → 키 목록 표 출력 +
   "키는 이후 불변" 경고.
4. **PL 모드**: 골격 파일 탐색·Read (없으면 중단) → levels·키 복사 → 입력(PRD/프로그램 리스트) 분석은
   dflow-wbs 의 어댑터 규칙 준용 → 모듈 Water 꼬리 + 프로그램 Task + 모듈 Fall 생성 → attach 기입.
5. 자체 검증 (파서 스크립트 나오기 전까지 수동 체크리스트):
   - [ ] 단계 선언이 frontmatter levels 에만 있는가
   - [ ] 모든 노드 접두어가 levels 의 prefix 와 일치하는가
   - [ ] 자식 순번 > 부모 순번인가 (역행·동급 없음)
   - [ ] rollup 층 leaf 없음 / checklist 는 leaf 뿐인가
   - [ ] PL 파일에 골격 층 본문 없음, attach·module 있음
   - [ ] 상태 전부 `[ ]`, 실적 % 없음
6. 생성 리포트에 **업로드 게이트(v2.2 대기)** 를 반드시 한 줄 남긴다.

## 자주 틀리는 것 (베이스라인 실측 2026-08-21)

| 스킬 없이 나온 발명 | 교정 |
|---|---|
| ID 세그먼트 경로(`P1.OP.EN.PR.A1.T1`)로 층 판정 | 접두어 정본. ID 는 짧게, 층은 prefix |
| 산문 "계층 규약" 표 | frontmatter levels |
| Task 마다 `progress: input` 필드 | 층별 선언 — 노드에 반복 기재 금지 |
| `dflow: skip` 노드 마커 | 층별 `upload` — 노드 단위 제외는 계약에 없다 |
| 헤딩 `######` 캡으로 두 단계 겹침 | Task 이하는 리스트 — 구조 모호 금지 |
