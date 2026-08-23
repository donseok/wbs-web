# dflow 스킬 가이드

작성 2026-08-23 · dflow 계열 스킬 7종의 목적·사용법·조합 안내.
각 스킬의 **정본은 `.claude/skills/<이름>/SKILL.md`** 이며 이 문서는 안내용 요약이다 —
어긋나면 SKILL.md 가 이긴다.

## 전체 그림 — 작업 수명주기에서 각 스킬의 자리

```
[WBS 작성]          [업로드]         [개발 루프]                    [승인 후]
dflow-wbs(동결) ─┐
                 ├→ dflow-export → D'Flow DB ← dflow-work(CLI 기반)
dflow-wbs-nlevel ┘                    │
                                      ├─ dflow-dev   : 작업 1건 사이클 (claim→설계→구현→검증→done)
                                      ├─ dflow-poll  : ready 감시 → dflow-dev 자동 착수 (반자동)
                                      └─ dflow-merge : approved 브랜치 → main 반영
```

- **정본 원칙**: WBS·작업 상태의 정본은 D'Flow(DB)다. wbs.md 는 1회용 부트스트랩,
  로컬 state.json 은 트리-로컬 캐시, 산출물의 정본은 git 커밋이다.
- **승인 원칙**: done 은 reported(승인 대기)까지다. approve 는 사람 몫(D'Flow 웹),
  approve 후 main 반영은 dflow-merge 몫이다.

---

## 1. dflow-work — 서버 통신 기반 (CLI 래퍼)

모든 dflow 스킬이 상속하는 기반. 서버 호출은 전부
`.claude/skills/dflow-work/scripts/dflow.sh` 로 하고 **산문 파싱 금지, exit code 로 분기**한다.

| exit | 의미 |
|---|---|
| 0 | 성공 |
| 2 | 사용법·설정·push 미완료 |
| 3 | 인증 실패 |
| 4 | 상태 충돌·선행 미반영 |
| 5 | 권한 부족 |
| 6 | 네트워크·서버 오류 |
| 7 | 기능 꺼짐 |

**주요 명령**

```bash
dflow.sh doctor                          # 설정·계약 버전 점검 (세션 첫 1회)
dflow.sh me                              # 신원·스코프·프로젝트
dflow.sh list [--scope available|claimed|assigned|all] [--all]
dflow.sh show <순번|uuid8|UUID>
dflow.sh claim <ref>
dflow.sh progress <ref> <0-99> "<요약>"   # 100 금지(서버 거부)
dflow.sh done <ref> "<요약>" --auto-links # push 선행 필수, --auto-links 필수 관례
dflow.sh release <ref>
```

**환경**: `DFLOW_API_BASE`·`DFLOW_PATS` 를 wbs-web 클론의 `.env` 에서 소싱(자동 로딩 없음 —
호출자가 export). 다중 프로필은 `--as <이름|email>` (반드시 서브커맨드 **앞**에).

**핵심 금지**: 토큰 echo·보간 금지 / progress 100·approve 시도 금지 / 409 를 재시도로 뚫지
않기 / 실패를 성공으로 요약하지 않기 / **dflow.sh 는 브랜치를 만들지 않는다** — 브랜치는
호출자가 직접 만든다.

**목록 출력 형식**: `순번 <TAB> 상태 <TAB> 우선순위 <TAB> id8 <TAB> 이름40자`.
상태 코드: RD=ready · CL=claimed · RP=reported · AP=approved · CX=cancelled.

---

## 2. dflow-dev — 작업 1건의 개발 사이클 (supervised)

```
/dflow-dev <순번|TSK-ID> [--only design|build|verify|refactor] [--model opus|sonnet]
```

자율 러너 설계(2026-08-20)의 **L0(대화형) 경로**. 구현 과정 규율의 정본은
`docs/agent/claude-skill/dev-discipline.md` (Phase 정의·TDD·기준선·모델 배정·공통 금지).

**Phase 흐름**

| Phase | 실행 주체 | 내용 |
|---|---|---|
| 0 | 오케스트레이터 | doctor→show→**착수 가능 판정**→claim→브랜치 직접 생성→기준선 기록→spec 읽기→복잡도 판정 |
| 1 Design | 서브에이전트 | design.md — 최소 4절(접근·파일 목록·테스트 전략·수용 기준 매핑) |
| 2 Build | 서브에이전트 | TDD 구현(테스트 먼저), Phase 경계 커밋 |
| 3 Verify | 서브에이전트 | 전체 스위트+린트, 기준선 차분 비교. 재시도 1회 |
| 4 Refactor | 서브에이전트 | 동작 변경 금지. research/docs 작업은 미실행 |
| 5 | 오케스트레이터 | 브랜치 재확인→push→spec 개정 확인→done --auto-links→"승인 대기" 보고 |

**착수 가능 판정 (Phase 0 — 서버는 안 해준다, 2026-08-22 실증)**
- spec 이 비어 있으면 착수 불가(제목만으로 요구사항 날조 금지).
- 선행 evidence 에 head_sha 있으면 `git merge-base --is-ancestor <sha> origin/main` —
  거짓이면 /dflow-merge 먼저.
- evidence null(선행 미승인)이면 로컬 산출물 실재 확인 — 실재하면 **스택 브랜치**로 진행
  (리스크 보고 + state.json 에 branch_base 기록), 부재하면 스킵.

**게이트 집행 원칙**: 서브에이전트의 자기 신고(PHASE_RESULT)는 참고일 뿐 —
오케스트레이터가 **직접 실행·직접 Read** 해서 판정한다(기준선 대비 신규 실패 0 +
테스트 총수 미감소; research 작업은 Design 의 문서 검증 체크리스트).

**상태**: `docs/tasks/<TSK>/state.json` (phase·기준선·branch_base·risk). 정본은 산출물
실재이며 state 는 캐시 — 재개 판정은 산출물 교차 확인으로.

**모델 배정**(dev-discipline): Design 은 복잡도 3점↑ opus/미만 sonnet(haiku 금지, spec 의
model 필드가 오버라이드), Build sonnet(Design opus 면 opus 권장), Verify haiku(재시도 시
sonnet), Refactor sonnet.

---

## 3. dflow-poll — ready 감시·자동 착수 (반자동 루프)

```
/dflow-poll [--interval 300] [--until HH:MM]     # 기본 5분 간격, 18:00 종료
```

**B안 구조**(깨어 있는 세션의 주기 확인) — 러너 설계가 무인용으로 기각한 구조임을 알고
**낮 시간 반자동 전용**으로 쓴다. 무인 야간은 러너(launchd)의 영역.

**동작**: 결정적 스크립트 `scripts/poll.sh` 가 백그라운드에서 감시(대기 중 LLM 토큰 0) →
ready 발견 시 exit 0 으로 세션을 깨움 → 착수 가능 판정(dflow-dev Phase 0) 통과 시
`/dflow-dev <id8>` 실행 → 사이클 끝나면 재기동.

**poll.sh exit**: 0=ready 발견(stdout: `순번·id8·이름`) / 8=종료 시각 / 3·5·7=dflow 오류
전파(즉시 중단) / 6=네트워크 연속 3회 / 2=설정.

**운영 규칙**
- 반드시 Bash `run_in_background` 로 기동 — 셸 `&` 금지(종료 알림 유실, 실증 사고).
- 한 번에 1건. claim 은 순번이 아니라 **id8 로**(순번은 캐시 기준이라 어긋날 수 있다).
- exit 4·착수 불가 작업은 `--exclude id8,id8` 로 제외(공회전 방지). exclude 는 2종:
  **영구성**(사용자 결정 대기·구조적 선행 부재)은 사용자 해소 전 유지,
  **일시성**(spec 부재·선행 산출물 대기)은 재기동 시 show 재검사로 해소.
- 매 착수·매 사이클 종료를 사용자에게 한 줄 통지. 중지는 "중지" 한 마디(TaskStop).
- 선행 approve 통지를 받으면: /dflow-merge → exclude 해제 → 재기동.

---

## 4. dflow-merge — 승인된 작업의 main 반영

```
/dflow-merge [<ref>...]        # 인자 없으면 로컬 reported 전체가 후보
```

done(reported) 후 사람이 approve 한 브랜치를 main 에 합친다. **이게 없으면 후속 작업의
선행 게이트(ancestor 검사)가 영원히 거짓이고 스택 브랜치가 무한히 깊어진다.**

**절차**: state.json 에서 후보 식별 → `show` 로 **approved 만** 진행(로컬 기억이 아니라
서버 응답이 판정) → 스택은 조상 먼저 `--no-ff` 머지 → push → state.json `merged` 커밋 →
머지된 agent 브랜치 삭제(미승인 후손 스택은 그대로 둔다 — 제 차례에 깨끗이 머지된다).

**금지**: approved 아닌 것 머지 / 후손 먼저 머지(미승인 커밋이 main 에 섞임) /
force push / 훅 우회.

---

## 5. dflow-wbs — WBS 생성 (3~4단, 동결)

```
/dflow-wbs [SUBPROJECT | wbs.md 절대경로] [--programs 경로] [--scale large|medium]
           [--start-date YYYY-MM-DD] [--estimate-only] [--export-xlsx [경로]]
```

PRD/TRD 또는 프로그램 리스트(json/yaml/csv/md/xlsx)로 **Water-Scrum-Fall 샌드위치**
구조의 wbs.md 를 생성: 선행 공정(초기화·기본설계) → 애자일 기능 Task → 후행 통합테스트.
프로그램 1개 = fullstack Task 1개(수직 슬라이스), category 7종(dev/defect/infra/feat/
design/research/itest). 생성 상태는 항상 `[ ]` — 상태 전이는 D'Flow 가 정본.

**동결 상태** — 3~4단 기존 흐름 전용. 5단 이상 신규 프로젝트는 dflow-wbs-nlevel 을 쓴다.

---

## 6. dflow-wbs-nlevel — N단(5~8단) WBS 생성·검증

```
/dflow-wbs-nlevel [--skeleton 시스템목록 | 모듈경로] [--programs 경로]
```

대형 프로젝트용. wbs.md 에 **levels 계약**(frontmatter 단계 선언·접두어 판정·진도 역할·
업로드 범위)을 싣는다. 두 모드:
- `--skeleton`: PMO 골격 — 시스템 목록으로 상위 구조 생성
- 모듈 경로: PL 모듈 파일 — 골격 아래 실무 Task 채움

트리거 예: "N단 WBS", "8단 WBS", "골격 WBS", "PL WBS".

---

## 7. dflow-export — wbs.md → D'Flow 업로드

```
/dflow-export [SUBPROJECT | wbs.md 절대경로] [--project-id UUID --module NAME] [--push]
```

로컬 wbs.md 를 검증하고 `/wbs/import` **계약 v2.1 JSON** 으로 export 한다.
`--push` 면 서버로 바로 업로드. **부트스트랩 1회 경로** — 업로드 후 wbs.md 는 은퇴하고
갱신은 D'Flow 에서만 한다(재생성 금지).

---

## 시나리오별 조합

**새 프로젝트 시작**
```
/dflow-wbs-nlevel --skeleton ...   (또는 3~4단이면 /dflow-wbs)
→ /dflow-export --push             # 1회 업로드, wbs.md 은퇴
```

**하루 작업 (반자동)**
```
/dflow-poll                        # 감시 시작
→ ready 발견 → 자동 /dflow-dev → done(승인 대기) → 재감시 (반복)
→ "중지" 또는 18:00 자동 종료
```

**작업 1건만 수동**
```
dflow.sh list --scope assigned     # 순번 확인
→ /dflow-dev <순번>
```

**승인이 났을 때**
```
(사용자: D'Flow 웹에서 approve)
→ /dflow-merge                     # approved 전부 main 반영
→ 폴링 재개 시 exclude 해제        # 후속 작업의 선행 게이트가 이제 참
```

**세션이 바뀌었을 때 (복구)**
```
dflow.sh list --scope claimed      # 서버에서 진행 중 작업 복원
→ /dflow-dev <ref>                 # state.json+산출물 교차 확인으로 재개 지점 판정
```

## 공통 주의사항

- `.env` 는 staging/prod 2블록 — 현재 활성이 어디인지 확인하고 시작(`dflow.sh doctor` 의
  base 출력). 스테이징 PAT 는 운영과 겸용(staging:sync 구조).
- 작업 대상이 wbs-web 자신이면: `git add -A` 금지, 마이그레이션·코드 분리 커밋(G1),
  UI 위험 파일 Preview(G2), 마이그레이션 스테이징 리허설(G4).
- 모든 실패는 정직하게 보고 — "완료했습니다"가 아니라 "승인 대기로 보고했습니다".
