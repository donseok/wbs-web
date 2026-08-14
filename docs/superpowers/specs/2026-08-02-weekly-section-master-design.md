# 주간보고 구분 마스터 (P4) 설계

> **상태: 설계 확정 · 구현 미착수(defer).** 브레인스토밍으로 설계·결정까지 완료했고, 사용자 요청으로 여기서 중단해 기록만 남긴다. 이어받을 때는 이 문서를 정본으로 `superpowers:writing-plans`로 계획을 짜면 된다.

**목표:** 주간보고의 "구분"(업무영역)을 하드코딩 상수 `WEEKLY_SECTIONS`(고정 10개)에서 **프로젝트별 마스터**(`project_settings.weekly_sections`)로 전환하고, 설정 페이지에 편집 UI + 데이터 안전 가드를 추가한다. 운영 중인 D-CUBE(PI) 프로젝트는 **회귀 0**(1행도 안 바뀜).

**정본 근거:** 범용화 설계 `docs/design/dflow-generic-wbs-design-2026-07-29.md` §7.5·§10.2, 로드맵 P4. Plan A(코어)/B(임포트)/C(N단 UI)/D(level 컬럼 제거) 위의 다음 조각.

---

## 1. 리스크 검토 결과 (착수 전 프로덕션 실측 — 회귀 0의 근거)

> **2026-08-14 정정 — 아래 표의 수치는 2026-08-02 시점 실측이며 지금은 낡았다.**
> 그날 이후 '조업및표준화' 구분이 '조업'+'표준화'로 갈렸다(코드 `3357aef`). 결과:
> ① 구분은 **10개가 아니라 11개**이고 `조업및표준화`는 더 이상 없다.
> ② `weekly_report_rows`는 40행이 아니라 **7주차 × 11구분 = 77행**이다.
> ③ 0058 시드는 그때 함께 갱신했으므로 **마스터==상수 일치는 유지된다**(이관 러너
>    `npm run split:weekly-ops`가 `project_settings.weekly_sections`도 11개로 고쳤다).
> ④ **§10.2 위험이 실제로 한 번 발동했다** — "구분을 실제로 바꿀 때만"이라는 아래 결론의
>    전제가 현실이 된 사례다. 그때의 대응은 (a) `LEGACY_SECTION_MAP`에 폐지 구분명 키를 추가해
>    이월이 폴백(PMO)으로 새지 않게 하고 (b) 표시 순서를 `sortWeeklyRows`(구분 이름 기준)로 옮겨
>    과거 행의 `sort_order`를 고쳐 쓰지 않아도 되게 한 것이다. P4 편집 UI의 가드는 이 둘을
>    RPC 안에서 해내야 한다.
> 착수 전 §1을 **다시 실측**할 것. 아래 표는 이력으로만 읽는다.

사용자 게이트: "운영 D-CUBE에 영향·데이터 유실 없어야 한다." 프로덕션 읽기 전용 실측으로 확정:

| 확인 | 결과 |
|---|---|
| 마스터 시드 존재 | 0058이 D-CUBE `project_settings.weekly_sections`에 **현 코드 상수와 바이트 동일**한 10개 시드(`PMO·영업·구매·관리회계·품질·생산계획·조업및표준화·물류·설비및L2·가공`), `preset_applied='legacy-dcube'` |
| 코드가 읽는가 | **안 읽음** — `getProjectConfig` select 목록에 `weekly_sections` 없음(설계대로 "자리만"). P4 = 이 배선 연결 |
| 저장 실데이터 레거시 잔존 | **0건** — `weekly_report_rows.section` 40행 전부 현 10개 구분만 사용(`공통/ERP/MES` 등 미매핑 0) |

**결론:** 마스터==상수==저장데이터가 셋 다 실측 일치 → 코드를 마스터 기반으로 바꿔도 D-CUBE는 모든 판정이 바이트 동일. **§10.2 위험("구분을 갈아끼우면 기존 시트가 첫 구분으로 흡수")은 "구분을 실제로 바꿀 때"만 발동** → 편집 UI의 가드로 방어(아래 §4).

---

## 2. 결정 사항 (사용자 확정)

1. **편집 UI 포함** — 프로젝트 설정 페이지에 per-project "주간보고 구분" 편집 섹션 신설(구분은 프로젝트별 값이라 전역 /admin 아님).
2. **안전 가드** — 이름변경 시 기존 행 `section` 동반 백필(트랜잭션), 데이터 있는 구분 삭제 차단.
3. **§10.1(PPT 브랜드 유출)은 P4에서 분리** — 데이터 유실 무관·성격상 P5(브랜드). 별도 처리.

---

## 3. A. 읽기 배선 (Plan A/C/D와 동일한 주입 패턴 — 회귀 0)

`WEEKLY_SECTIONS`를 읽는 **순수 도메인 함수에 `sections: string[]` 인자 추가**(전역 캐시 아님, 주입):

- `src/lib/domain/weeklySheet.ts`:
  - `defaultWeeklyRows(sections)` · `carryOverRows(prev, sections)` · `mapLegacySection(section, module, sections)` · `isWeeklySection(v, sections)` · `sectionKeyOf(row, sections)`. 폴백 = `sections[0]`.
  - 상수 `WEEKLY_SECTIONS`는 **`DEFAULT_WEEKLY_SECTIONS`(현 10개)로 유지** — `getProjectConfig` 기본값 + 회귀 fixture.
  - `LEGACY_SECTION_MAP`은 D-CUBE 레거시(공통/ERP/MES 모듈명) 안전망으로 **유지**(범용 프로젝트엔 무해 — 키가 안 맞으면 폴백).
- `src/lib/data/projectConfig.ts`: `ProjectConfig`에 `weeklySections: string[]` 추가, `DEFAULT_PROJECT_CONFIG`에 기본값, select에 `weekly_sections` 추가, `null → DEFAULT_WEEKLY_SECTIONS` 매핑. **조회 실패는 기본값 위장 금지 → throw**(CLAUDE.md 에러 3원칙).
- 소비처가 `getProjectConfig(projectId).weeklySections`를 주입:
  - `src/lib/data/weeklySheet.ts` — `ensureStandardRows`(빠진 행 INSERT) 및 주차 생성/이월 경로.
  - `src/lib/report/sheetNarrative.ts` — `sectionOrder`·PPT 페이지 합성(`buildSheetSections`).
  - 주간 페이지 서버 컴포넌트 + `/api/report` 라우트 — 이미 프로젝트 로드하는 `Promise.all`에 합류.
- **회귀 0**: `getProjectConfig(D-CUBE).weeklySections == DEFAULT_WEEKLY_SECTIONS` → 전 함수 동일. 착수 시 도메인 함수의 모든 호출부를 tsc로 전수 노출해 인자 주입(누락 = 컴파일 실패로 강제).

## 4. B. 편집 + 가드 (단일 reconcile RPC로 원자성)

설정 페이지에 관리자 전용 "주간보고 구분" 편집 섹션: 순서 리스트 + 추가·이름변경·삭제·순서변경. 저장은 **하나의 트랜잭션 RPC**(마이그레이션 0065)로 마스터 배열과 기존 행을 원자적으로 정합.

편집기는 **"원하는 최종 배열 + 이름변경 맵(old→new)"** 을 한 번 전송 → RPC `reconcile_weekly_sections(p_project_id, p_sections text[], p_renames jsonb)`가 한 트랜잭션에서:

| 단계 | 처리 | 가드 |
|---|---|---|
| 검증 | 이름 비어있음·중복 거부 | RAISE |
| 이름변경 | 각 (old→new)에 대해 이 프로젝트의 `weekly_report_rows.section` old→new UPDATE | 배열·행 함께 이동(반쪽 불가) |
| 삭제 검사 | old에 있고 new에 없으며 rename source도 아닌 구분이 이 프로젝트에 행을 가지면 RAISE | "저장된 내용이 있어 삭제 불가" |
| 순서 재동기 | new_sections에 있는 구분의 기존 행 `sort_order`를 배열 위치로 재설정(내용 무접촉) | — |
| 마스터 반영 | `project_settings.weekly_sections = p_sections` | — |

- 서버 액션이 `requireProjectAdmin(projectId)`로 게이트(액션이 유일 관문). RPC는 그 뒤 호출(import_wbs 패턴과 동일).
- "이 프로젝트의 행" = `weekly_report_rows` → `weekly_reports.report_id` → `project_id` 조인(0023 스키마 확인 필요).
- `on delete cascade`·RLS: `weekly_report_rows`는 0023에서 authenticated 전권 RLS 보유 → RPC는 security invoker로 충분(액션 게이트가 권한 관문).

## 5. 검증 · 마이그레이션 · D-CUBE 안전

- **테스트**:
  - 도메인: 커스텀 sections로 `defaultWeeklyRows`/`carryOverRows`/`mapLegacySection`/`sectionKeyOf`; **D-CUBE 10개 주입 시 현행 재현 회귀 fixture**(sub-act 없음, 문자열/순서 동일).
  - RPC 계약(0065): 이름변경 백필·사용중 삭제 차단(RAISE)·재정렬 sort_order·트랜잭션 원자성·롤백.
  - 액션 가드: `requireProjectAdmin`.
  - getProjectConfig: `weekly_sections` null→기본값, 조회 실패→throw.
- **마이그레이션**: **0065 = reconcile RPC + `_rollback`뿐**(코드와 분리 커밋, G1). 착수 시 번호는 `ls supabase/migrations | tail`로 재확인(병렬 세션 선점 대비). **배포 시 `weekly_report_rows`를 건드리는 마이그레이션 없음** — RPC는 관리자 편집 때만 실행.
- **D-CUBE 유실 0**: 배포는 코드만 변경(마스터==상수→동일 동작). 실데이터는 관리자가 편집할 때만 변하고, 그마저 이름변경=백필·사용중삭제=차단으로 보호. 배포 후 회귀 판정 = 주간 시트·PPT·점검 산출물 D-CUBE 동일 + smoke.

## 6. 의도적 비범위 (YAGNI)

- **§10.1 PPT 브랜드 템플릿** — P5(브랜드)로 분리(데이터 무관).
- **신규 프로젝트 구분 프리셋** — 생성 시 기본값은 현 프리셋(pi=10)을 그대로 두고, 구축 프로젝트는 편집 UI로 자기 구분 정의. 구축용 프리셋 추가는 P3(프리셋/모드)로.
- **회의록 하위 구분·폴더 트리와의 결합** — 주간보고 구분과 별개 축(team-master 설계 §74 명시). 이번 범위 아님.
