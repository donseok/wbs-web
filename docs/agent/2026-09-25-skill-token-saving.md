# 에이전트 스킬 토큰 절약 작업

> `docs/idea.md` 에서 옮긴 상세(2026-09-25). 요약 한 줄은 idea.md 에 남아 있다.

## 남은 것

- 1차 작업(1\~8번·작은 항목)은 구현 완료 챕터로 옮겼다(2026-09-25 staging 9474997c). 남은 것:
  - 1번의 `tests/skills` 문자열 단언 이전·fixture 갱신 절차(부분) / heartbeat 훅은 PC 마다 `kit/install.sh <리포> --hooks` 재설치 / 실운영에서 볼 것: Build 단위 상한은 자가 계수라 강제 안 됨·나누지 않은 큰 작업은 이어 띄우기 2회 뒤 실패·`TICK_SKIPPED`·beat·STANDBY 동작·Linux 에서 heartbeat `stat` 순서 수정(미실측, `dflow.sh:190` 에 같은 패턴 남음).
  - 2차 묶음(staging 2b933b11): 첫 실제 spawn 때 팀원 대화 기록(jsonl)에서 MCP 0개 확인할 것.
- 사용자 판단 대기: 상주 서버(dmes fe-run.sh 11.6GB·ddobak 2.9GB) 때문에 capacity 가 CAPACITY\_LOW(메모리 압박 warn)라 새 팀원 spawn 이 미뤄진다.

## 완료 기록 (2026-09-25 staging 9474997c, main·킷 미반영)

- **실측(2026-09-25 조사, dmes-standard 09-23\~24 팀 실행 jsonl, 2b933b11 이전 스킬)** — 가중치 입력 1·캐시 생성 1.25·캐시 읽기 0.1·출력 5.
  - 비중: Build 서브에이전트 35% · 팀장 18% · Design 13% · Verify 11% · 팀원 메인 10% · 해소 워커 1%.
  - 스킬 텍스트 몫은 Task 누적의 약 7%, 팀장 누적의 약 14%. 한국어는 실측 1글자 ≈ 0.84토큰.
  - Build 가 큰 이유: design.md 를 10\~27회 다시 읽음(서브에이전트당 약 110K자)·소스 통째 읽기(180\~275K자). 누적은 호출 수의 제곱에 비례. 테스트 로그는 이미 tail 로 작다.
  - BE·FE 로 나누기만 해서는 안 줄었다(TSK-08-02: 단위마다 200회 넘게 호출, 누적 88\~90M).
  - ④ 빈 기상 절제는 작다: 변화 없는 기상 53건 = 팀장의 3\~6%(전체 약 1%). 캐시가 1시간 티어라 간격을 늘려도 재생성 손실은 거의 없다.
  - 동작 문제: 팀장이 compact 4회 중 4번째 뒤 6시간(69턴) 스킬을 다시 읽지 않고 폴링만 했다. 3번째 뒤에는 Skill 도구 재호출로 약 206K자가 통째로 다시 들어왔다.
  - 분석 스크립트: 09-25 세션 scratchpad `an.py`\~`an4.py`·`analyze.py`(임시).
- **진행 결과(2026-09-25 staging 9474997c, main·킷 미반영)**: 아래 1\~8번과 작은 항목 3건 완료. 스킬 테스트 908건 통과.
  - 상시 적재 크기: dflow-team SKILL.md 121K→약 82K자(목표 64K 미달, 「1. 시작」 은 남김) · dflow-dev SKILL.md 37K→25K · dev-discipline 28K→18.6K · dflow-merge SKILL.md 37K→17K · Phase 적재 Design 28K→4.5K, Build 단위 18K→6.1K, Verify 11K→4K.
  - 통합 뒤 독립 검토 결함 11건 수정(Build 재시도 단위 범위·인계 상한 트레일러 세기·회수 이름 `-c<n>`·lead-state 출력 순서/HASH 상한/깨진 줄 `bad=`/`CONFLICT_CLEARED`·재독 범위에 「참조」「인자」·tick `--pid`·STALE 증거 등).
  - 작은 항목: heartbeat 세션 절제(docs 스캔 전)·토큰 증분(44MB 기록 20초→0.5초) / poll 탈락 후보 캐시(`--tag-cache-cycles` 기본 3, 새 agent 태그 인식이 최대 3\~4주기 늦어짐)·spawn 때 docker-allow 가 poll show 재사용 / 방언 검증 `DIALECT_SKIP docs-only`(기준은 last\_pass 만).
  - 추가: 주간 사용량 90%↑ 팀원 최대 2명·95%↑ 새 spawn 중지(`capacity.sh usage`, `DFLOW_CAP_WEEKLY_*`, 덤프 없으면 막지 않음).
- **작업 순서(2026-09-25 개정, 효과가 큰 순서)** — 종전 "프롬프트 압축 먼저(dflow-team → dev → merge)" 를 뒤집었다.
  1. 선행: 테스트 밖 문자열 의존 3곳(팀장 `OLD_DFLOW_DEV` 의 `--worker` grep, 팀장 `OLD_DFLOW_MERGE` 의 `origin/agent/*` grep, worker-prompt 「3」 의 `--worker` grep)을 frontmatter 같은 명시 표식으로 바꾼다. 이 글자가 빠지면 테스트는 전부 통과하는데 운영의 모든 워커가 멈춘다. `tests/skills` 문자열 단언 약 650\~720건은 "규칙이 어느 파일에 있는지" 검사로 옮기고, `fixtures/dflow-dev.SKILL.orig.md` 갱신 절차를 정한다.
  2. Build 효율화(추정 −20\~30M/Task): dev-discipline Phase 02\~04 에 design.md 읽기 규율(전체는 한 번, 이후 절 grep) + ⑤ Build 분할 + 단위 상한(약 80회 또는 컨텍스트 250K). 셋을 같이 해야 효과가 난다. 마지막 단위가 연결 테스트를 맡는다. 고칠 곳: dflow-dev SKILL Phase 02\~05(서브에이전트 이름·TaskStop·state.json model·종료 4번 재시도), dev-discipline 「구현 단위」 신설·Phase 03 완료 조건·모델 배정·스위트 횟수 표, gate-economy·background-gate 테스트.
  3. Phase 별 reference 분리: `references/phase-{design,build,verify}.md` + 공통 Phase 프롬프트 템플릿. Design 은 dev-discipline 28K 통째, Build 는 약 18K 를 읽는데 Phase 마다 4\~7K 로 고정한다. 오케스트레이터 몫도 약 24K → 8K 토큰. dev-discipline 의 두 번째 소비자(러너 킥오프) 계약도 같이 고친다.
  4. 팀장 compact 뒤 복구 규칙: 필요한 절만 다시 읽고 Skill 도구 재호출(전체 재주입)은 금지. 토큰이자 동작 문제다.
  5. dflow-team SKILL.md 압축(121K → 약 64K자, 팀장 누적 실효 7\~8%): 근거·이력 약 25K → `references/rationale.md`, 분기 전용 절 약 22K(실패 코드 해설·키 판정·연장·마감·5-1·두 번째 팀장)는 그 분기에서만 읽기, 중복 약 7K(입장 제어 4벌·서브에이전트 금지·tmux 규칙·`find_tmux` 두 벌) 정본화, 재구성 events 조회는 요약만 내는 `lead-state.sh` 로.
  6. dflow-dev·dflow-merge 정리: 「--worker 팀원 모드」 12K → `references/worker-mode.md`, dflow-merge 「절차」 1번은 `sweep-check.sh` 출력 계약으로 대체하고 수동 `/dflow-dev` 01-가도 `SWEEP_NONE` 이면 dflow-merge 를 읽지 않는다.
  7. 해소 워커 적재 축소: resolve-prompt 「0」 이 worker-prompt 전체(15K) 대신 「0」「1」 만 읽고, dflow-merge 「해소 머지」 는 `references/resolve.md` 로. 해소 1회 −12\~25K 토큰(비중 1% 라 후순위).
  8. ④ 팀장 깨우기 절제 + 감시 루프 `scripts/tick.sh` 화: 효과는 팀장의 3\~6% 뿐이지만 루프 재작성 출력(실행당 71회·약 97K자)을 없앤다. 30분 기상에 기대는 규칙 여섯(잠금 beat 70분·STANDBY 70분·TICK 두 번 무응답·차단기 시험 spawn·마감 TICK 두 번·poll 없을 때 종료 시각)이 걸린다.
  - 작은 항목(후순위): heartbeat 훅의 60초 절제 판정을 docs 스캔 앞으로 옮기고 토큰 사용량은 증분 계산 / poll 의 태그 조회 캐시·show 결과를 docker-allow `--json` 이 재사용 / 문서만 바뀐 머지는 방언 검증을 다음 스윕으로 이월. ⑥ 게이트 sha 캐시는 제외. ⑤ 2단계(팀원 1M 컨텍스트 끄기·compact 기준)는 1번 뒤 dmes Task 1\~2건 A/B 측정 후 묻는다.
- **압축 방법(4·5·6번 공통)**
  1. 규칙과 근거 분리: "이유:" 문단·사고 이력·실측 수치는 `references/rationale.md` 로, 판단이 애매할 때만 읽는다.
  2. 중복 제거: 반복 규칙은 정본 한 곳, 나머지는 가리키기만 한다.
  3. 드문 절은 references 로 빼서 필요한 순간에만 읽는다.
  4. 출력 토큰(`SPAWN_DEFERRED_CAPACITY` 등)·명령은 글자 그대로. 셸 블록은 감시 루프·기상 블록만 스크립트로 바꾸고 나머지는 그대로 둔다.
  5. 문장 단위 조사·서술어 생략은 일괄 적용하지 않는다(2026-09-25 실측). 새로 쓰거나 옮기는 문장에만 아래 표를 적용한다.
     - 생략 가능: 역할이 분명한 `이/가`·`을/를`, 종결어미 → 명사형(`설치한다` → `설치`), 나열·설명 줄의 주제 `은/는`, 군더더기(`~라는 점`·`~하는 것이다`).
     - 반드시 유지: 보조사 `만`·`도`·`까지`·`부터`, 범위의 `에`/`에서`·대상의 `에게`, 대조의 `은/는`, 양보 `-아도`, 허용 `-해도 된다`, 조건 `-면`.
     - 기호(`X`·`→`·`OK`)는 표·목록 같은 짧은 줄에만 쓰고, LLM 이 바꾼 문장은 사람이 원문과 diff 로 검수한다.
     - 근거: 규칙 17문장·질문 20개 블라인드 해석 시험(원문 대조군 20/20). 엄격 생략본은 sonnet·opus 모두 모호 2건(`그 호출만`→`그 호출`, `같은 host 에서`→`같은 host`, `공용 파일에 … 를`→`공용 파일 …` 에서 목적어가 뒤집힘). `-아도` 탈락은 양보를 원인으로 뒤집는다(`비어 있어도`→`비어 있어`). 기호 치환본은 20/20 이었지만 압축 LLM 이 "아무것도 띄우지 않고" 를 "무출력" 으로 바꿔 뜻을 틀었고, 시험 질문이 이것을 잡지 못했다. 절감은 표본 −12%(생략)·−19%(기호), 실제 SKILL.md 구간(코드 포함) −3%·−10.5%. 스킬 텍스트가 누적의 7\~14% 라 전체 효과는 약 1% 다. 시험 자료는 09-25 세션 scratchpad `cmp/`(임시).
  - 동등성 보증: 압축 전 규칙 목록(금지·순서·조건 규칙, 출력 토큰, 명령)을 기계적으로 추출 → 압축 뒤 각 항목이 SKILL.md 또는 제때 읽히는 reference 에 남았는지 대조.
    - 보조 가드: caveman-compress 의 `scripts/validate.py`(헤딩·코드 블록·인라인 코드·경로·URL·목록 수 보존 검사)를 재사용해 백틱 문자열(`--worker` 등) 누락을 잡는다. 의미는 검사하지 않는다. 압축 규칙 자체는 영어 기준이고 원본을 덮어쓰므로 쓰지 않는다.
- **결정(권장안대로 진행)**: 언어는 한국어 유지 + 간결화 / ④ 는 (가) 빈 TICK 을 연속 한 번까지만 건너뜀 / 셸 블록은 감시 루프·기상 블록만 스크립트화.
- **2차 묶음 완료분(2026-09-24 staging 2b933b11, main 미반영)**: ① Orca 팀원을 tmux 와 같은 준비 단계 + `orca terminal create --command ./.dflow-run` 으로 띄움 ② 팀원 전용 설정(켜진 플러그인 전부 끄기·`--no-chrome --strict-mcp-config`, 실측 첫 턴 65.3K→54.2K 토큰) ③ 끝난 Orca 탭 닫기·Orca 재투입 잠금 해제·머지된 워크트리 정리 조건. 1차 묶음(A\~J)은 staging 1d2b9b87.
