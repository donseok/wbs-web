# Claude Code × D'Flow 작업 연동 — 요건 검토

작성 2026-08-10 · 상태 **구현 승인 (착수 게이트 ⓪①② 결정 완료 2026-08-10)**

Jira 이슈를 Claude Code로 처리하듯, D'Flow의 작업을 Claude Code가
**조회 → 착수 → 진행보고 → 완료**하기 위한 요건 검토. 이 파일은 요약본이며,
구현 명세·근거 전문은 [상세 부록](2026-08-10-claude-code-work-integration-review-appendix.md)에 있다.

---

## 한 줄 결론

**절반은 이미 있다.** v1 agent work API(claim/report/release)가 구현돼 있으므로,
새로 필요한 것은 ① 사용자 귀속 토큰(PAT) ② "내 작업" 조회 API ③ Claude Code 스킬 — 셋이 축이다.
**MCP 서버·독립 npm 패키지는 만들지 않는다.**

목표 경험:

> 개발자가 (MES 리포에서) "내 D'Flow 작업 보여줘" → 목록 → "3번 착수" →
> 브랜치 생성·구현 → 진행 보고 → 완료 시 `reported`(승인 대기) → PM이 웹에서 승인

## 만드는 것

| 축 | 내용 | 규모 |
|---|---|---|
| DB | `0069_agent_runners`(PAT 테이블, 훗날 러너 credential과 겸용) · `0071` 점유 소유자 · `0072` evidence · `0073` WBS 담당자·단계·`external_ref` + **명세 컬럼**(category/domain/priority/model · tags·depends 배열 · prd_ref·entry_point · acceptance jsonb · spec text) (0070은 이미 선점됨 — 사용 금지) | 마이그레이션 4 |
| WBS 변경 | **전 계층(Task·WP·ACT) 개인 담당자 — 로스터 축**(`assignee_member_id`, 이슈 담당자 관례·외부 인력 포함) + **Task 단계 `stage`(6상태: todo/as/fp/ip/im/xx)** + **Task 명세도 DB 보관·뷰어에서 렌더·편집**. 담당팀(`item_owners`)과 공존(팀=조직 책임, 담당자=개인 실행 책임). 단계가 미결 ③(진척 상태 파생)의 기반 | 부록 §2.5 |
| WBS 파이프라인 | **정본: D'Flow DB(중앙관리)** — 로컬 wbs.md를 각자 읽으면 다인·다PC 충돌이라 import 후 `/dev` 계열은 DB를 읽는다(claim 시 명세를 `docs/tasks/{TSK}/spec.md`로 캐시). **wbs.md는 최초 작성·검수·import 부트스트랩 전용**(작성 표면은 md 유지, YAML·xlsx 전환 안 함) · 입력: 프로그램 리스트 **json/md/csv/엑셀/yaml** 아무거나 · 교환: dev 플러그인 신설 `--export` JSON **v2**(명세 포함) · 보고: xlsx(D'Flow export). **프로그램 1개 = fullstack Task 1개**(수직 슬라이스) → **모듈별 upsert 업로드**(`external_ref` 매칭, 삭제 없음 — 기존 임포트 RPC는 재사용 불가). 설계서·분석서 실물은 로컬 git — DB엔 `prd_ref`·`entry_point` 참조만 | 부록 §2.6·§7 |
| 자동 발행 | **담당자 배정된 리프 Task는 주문 자동 생성** — import·웹 배정 두 트리거, 멱등(활성 주문 부분 유니크), `agent_projects` 게이트·리프 검사 유지. 주문 수용 기준 = `acceptance` jsonb 그대로 | 부록 §2.8 |
| 선행 차단 | **하드 차단 2겹** — 서버: claim 시 `depends` 선행 stage 게이트(403 `dependency_not_met`) · 클라이언트: 선행 head_sha 로컬 미도달 시 메시지 출력 후 실행 거부, `done`은 push 미도달 시 보고 거부. **완료 = push 완료** | 부록 §2.9 |
| 서버 | 인증 게이트를 PAT 리졸버로 확장 + 신규 API 3개: `GET /agent/me`(진단), `GET /agent/work/mine`(내 작업), `POST /wbs/import`(모듈별 WBS 업로드) + **`/account` 페이지 신설**(비밀번호 변경 통합 + PAT 발급·복사·폐기) | 기존 5개 계약 불변 |
| 클라이언트 | 스킬 `docs/agent/claude-skill/dflow-work/`(리포 정본, `ln -s`로 설치) + `dflow.sh`(curl 래퍼 — exit code 계약·압축 출력·git 증적 자동 첨부·claim 시 명세 캐시·선행 도달 검사). **다중 프로필 `DFLOW_PATS`** — 한 PC에 1~N명 PAT 등록, 신원은 `/agent/me`로 해석 | 부록 §2.7·§3 |

안 만드는 것과 이유: **MCP 서버**(도구 7개에 상시 컨텍스트 비용 부적합, 로컬 git 접근 불가) ·
**npm 패키지**(배포 단위·버전 스큐 증가) · **`/approve` REST**(완료 승인은 사람 몫 유지).

"내 작업" = **내게 배정된 항목 ∪ 내가 점유한 주문 ∪ ready 풀.** 신원 정본은 PAT(서버 검증),
`.env`의 `DFLOW_USER_EMAIL`은 과도기 필터 편의(자기신고 — 서버가 신뢰하지 않음). 담당자 있는 항목의
주문은 그 사람만 claim 가능(403 `not_assignee`), 없는 항목은 종전대로 선착순.

## 외부 의존 — dev-workflow 쪽 선행 작업 (부록 §7)

실측 결과 dev 플러그인 툴체인은 **5상태만 실행**하고(6상태는 문서·로컬 스킬에만 존재),
목록 JSON이 6필드뿐이며, 4단계(ACT) WBS에서 검증·병합이 조용히 무력화된다. 분담:

| ID | 작업 (dev-workflow 리포) | 이 로드맵과의 관계 |
|---|---|---|
| DEV-01 | ~~6상태 상태머신 로컬 구현~~ → **스코프 아웃** — WBS 중앙관리 결정으로 상태 전이는 D'Flow `stage`(API)에서 일어난다. 로컬 6상태 실행 불필요 | 부트스트랩 1회 파일→DB만, 역방향 없음 |
| DEV-02 | `wbs-parse.py --export` 신설 — **계약 v2**(전 계층 + 명세 `spec_sections` 포함) | **WP-07 업로드의 선행 의존**(과도기 우회 있음). 계획의 중심 |
| DEV-03 | 4단계(ACT) WBS 정규식 수정 | MES가 첫 대상이라 필수(부트스트랩 검증) |
| DEV-04 | 프로그램 리스트 입력 어댑터 | WBS 생성 확장 |

## 착수 게이트 결정 (2026-08-10 확정 — 게이트 해제)

| # | 결정 |
|---|---|
| ⓪ | **해석 2 번복 승인** — 사람도 PAT로 서버 접속·claim·보고. 코퍼스(`21-multi-client-model.md`)에 번복 기록 |
| ① | 발급 권한 = **자율+대리** — `user_pat` 본인 자율 발급(읽기 스코프 한정) + 관리자 대리 발급(`created_by` 기록) · `work:report`는 관리자 승인 발급만 · `runner`는 슈퍼유저 전용. 배정 조회는 PAT 신원(user)–배정의 로스터 다리 매칭(부록 §2.5-④) |
| ② | 토큰 테이블 = **`agent_runners` 단일 + `kind` 컬럼** (러너 합류가 공짜) |

남은 선행: TSK-00-02(테스트 환경 실측) · TSK-01-01(계약 동결).

결정 완료(부록에 반영됨): 단계 6상태 · 담당자 로스터 축 · 참조 문서 혼합(git+위키) · 배정 기반 자동 발행 · 다중 프로필 ·
**WBS 중앙관리(DB 정본, import 후 wbs.md 은퇴)** · **0073 명세 컬럼 확장** · **선행 하드 차단(완료=push 완료)** ·
**`/account` 페이지 신설(PAT UI)** · **export/import 계약 v2**.

그 외 미결(전문은 부록 §미결 사항): ③ progress 반영 — 권고: **stage 파생 환산(0/0/0/20/60/100)으로 전환, 자기보고 %는 telemetry 격하** ·
④ 레거시 시크릿 폐기 일정 · ⑤ 운영 D-CUBE `agent_projects` 등록 시점(통합 검증 전 금지 권고) ·
⑥ 8/26 일정에서의 우선순위 · ⑦ `item_owners` 권한 상승 봉합 방식 · ⑧⑨ 클라이언트/배포 형태 · ⑩ 문서 정본 정리 ·
⑪ 잔여 소항목: claim 시 `as`→`ip` 자동 전이 여부 · ⑬ 잔여: 에이전트용 위키 읽기 API 범위.

## 로드맵 (WSF 구조)

`~/project/dev-workflow/docs/wbs-workflow.md` 워크플로우 중 디플로우에 필요한 것만 적용:
**선행(결정·계약 동결) → 기능(병렬) → 후행(통합 검증)** 샌드위치 + 진척율 파생 원칙.

| 구간 | WP | 내용 | 게이트 |
|---|---|---|---|
| PH-1 선행 | WP-00 결정·실측 | 미결 ⓪①② 결정(TSK-00-01) · 테스트 환경 실측(00-02, 병렬) | — (시작점) |
| PH-1 선행 | WP-01 공유 계약 | contract-only — DDL·리졸버 반환 구조·API shape·export JSON 스키마·에러코드 동결 | 00-01 완료 |
| PH-2 기능 | WP-02 신원축 서버 | 0069 마이그레이션 → 리졸버·멤버십 게이트·`/me`·`/mine` → **`/account` 페이지**(발급 UI) | 계약 `[im]` |
| PH-2 기능 | WP-03 쓰기 루프 | 0071·0072 → claim/report/release PAT 소유 판정·스코프 강제 | WP-02 + 테스트 DB |
| PH-2 기능 | WP-04 클라이언트 | `dflow.sh`(명세 캐시·선행 도달 검사·push 확인) → SKILL.md — **계약만으로 서버와 병렬 진행** | 계약 `[im]` |
| PH-2 기능 | WP-05 운용성 | 토큰 만료·감사(usage)·heartbeat·rate limit | WP-03 |
| PH-2 기능 | WP-07 WBS 축 | 0073(명세 컬럼 포함) → 배정·단계 UI·**뷰어 명세 패널** → `scope=assigned`·claim 배정 제한·**선행 게이트** → `/wbs/import` → **배정 기반 자동 발행** — 서버와 병렬 | 계약 `[im]` (+DEV-02) |
| PH-3 후행 | WP-06 통합 검증 | 업로드→배정→자동발행→수직 E2E · 보안 매트릭스 · 온보딩 10분 실측 (`itest` — force 금지) | WP-02·03·04·07 |

에이전트측 발행·코퍼스 러너 합류는 **스코프 밖** — 후속 WBS, 별도 승인.

## 핵심 위험

1. **보안 순서** — 멤버십 게이트가 PAT 발급보다 늦으면 토큰 하나로 전 프로젝트가 샌다. 같은 배포 필수.
2. **레거시 경로 잔존** — 레거시 시크릿 GET엔 신원이 없어 멤버십 검사 불가. 살아있는 동안 무스코프 열람 유지 → 폐기 일정(④)이 실질 보안 결정.
3. **`work:report` = 권한 상승** — 에이전트 채널의 WBS 쓰기는 웹보다 넓다(담당팀 검사 없음). 이 스코프는 관리자 승인 발급만.
4. **운영 D-CUBE** — `agent_projects` 미등록 404가 최강 안전망. 등록은 이 설계에서 가장 위험한 단일 동작.
5. **LLM 추정 퍼센트가 WBS 실적 오염** — progress 즉시 반영은 v1 동작 유지(미결 ③), 완화는 스코프 opt-in뿐.
6. **툴체인 갈라짐** — export(v2)·4단계 지원이 dev 플러그인에 아직 없다(DEV-02·03). 완료 전 업로드는 과도기 우회뿐. 로컬 6상태(DEV-01)는 중앙관리 결정으로 스코프 아웃 — 파일→DB는 부트스트랩 1회, 역방향은 열지 않는다.

**다음 세션이 구현할 때 읽는 정본은 [부록](2026-08-10-claude-code-work-integration-review-appendix.md)이다** — 리졸버 의사코드, 마이그레이션 스펙, WP별 체크리스트·수용 기준, dev-workflow 계약(§7) 전부 거기 있다.
