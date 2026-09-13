# 가상오피스·팀장 스킬 구현 착수 전 걸림돌 정리

- **작성일**: 2026-09-11
- **대상 설계 정본 두 건**:
  - 가상오피스(에이전트 좌석표·모니터링): `docs/superpowers/specs/2026-09-10-agent-seatmap-monitoring-design.md`
  - 팀장 스킬 `/dflow-team`: `docs/superpowers/specs/2026-09-10-dflow-team-design.md`
  - 팀장 스킬 구현계획: `docs/superpowers/plans/2026-09-10-dflow-team.md`
- **목적**: 착수 전에 남은 확인·결정 사항을 정리한다. 코드는 아직 작성하지 않는다.
- **근거**: 각 스펙과 관련 코드(`dflow.sh`·`dflow-dev`·`dflow-merge`·`dflow-poll` 스킬, `dev-plugin`, `src/lib/agent/*`, `src/lib/authz/*`)를 실측 대조한 결과다.

---

## 요약

남은 치명은 하나다: 가상오피스 좌석표가 Micro 컴퓨트 위에서 실시간 갱신 부하를 견디는지 검증되지 않았다.
공통 항목으로 `blocked` 상태 모델 불일치[높음]가 남아 있다. 착수 전 사용자 결정이 필요한 항목은 셋이고,
모두 가상오피스 쪽이다. 팀장 스킬은 설계가 스펙(`docs/superpowers/specs/2026-09-10-dflow-team-design.md`)과
구현계획에 확정되어 있고(잠금 소유 판정, push 훅 거부 갈래, 킷 복사형 push 검사, 로컬·원격 중복 후보 규칙
포함), 남은 것은 리허설로만 확인할 수 있는 실측 항목뿐이다(A0 의 완료 알림·회수·`done`·한도 동작, auto 권한
모드의 차단 명령, Orca 정리 경로와 생성 브랜치 이름, 캐시 경합).

심각도 집계는 남은(미해소) 항목만 센다.

| 구분 | 치명 | 높음 | 중간 | 낮음 |
|---|---|---|---|---|
| 공통·연동 | 0 | 1 (상태 모델) | 0 | 0 |
| 가상오피스 | 1 (Micro 부하) | 1 (STANDBY 신호) | 4 | 2 |
| 팀장 스킬 | 0 | 2 (리허설 실측) | 2 | 0 |

---

## heartbeat 인증(PAT) 경로

heartbeat 훅 인증은 `dflow-work` 스킬의 `dflow.sh`(`.claude/skills/dflow-work/scripts/dflow.sh`)에
`heartbeat` 서브커맨드를 신설해 기존 PAT 경로를 그대로 쓴다. `dflow.sh heartbeat <ref>` 는 기존
`progress`/`report` 와 같은 방식으로 `TOKEN="$TOK" api_raw POST /api/v1/agent/work/$_id/heartbeat` 한 줄로
처리하고, 훅은 `DFLOW_SH`·`DFLOW_ENV_FILE` 로 스크립트 위치와 `.env` 위치를 주입해 실행한다(PostToolUse 훅이
임의 cwd 에서 실행되는 문제도 이 env 주입으로 해결된다). 근거 함수: `tokens()`(`.env` 의
`DFLOW_PATS`/`DFLOW_PAT` 읽기), `profile_email()`/`pick_token()`(프로필 선택), `api_raw()`(`Authorization:
Bearer` 부착). 소유자 위장 방지는 서버의 `claimed_by` 판정(`not_claim_owner` 403)을 그대로 물려받아, 자기가
claim 한 작업에만 heartbeat 를 보낼 수 있다.

남은 잔여는 아래 가상오피스 세부의 [낮음] heartbeat 스코프 리터럴 항목을 참조한다.

---

## 공통·연동 문제

### [높음] 두 스펙의 상태 모델이 어긋난다: `blocked` 누락

- **위치**: 가상오피스 스펙 §3 상태표 vs 팀장 스펙 §7·§9-2
- **문제**: 가상오피스 상태표는 8종(ACTIVE/STALE/OFFLINE/IDLE/REJECTED/READY/DONE/STANDBY)뿐이고 `blocked` 가 없다. 팀장 스킬은 `blocked`(담당자 결정 대기·슬롯 점유)를 핵심 상태로 쓴다. 좌석 식별 파일은 워크트리 루트 `.dflow-agent` 다.
- **터지는 지점**: 가상오피스가 먼저 구현되면 heartbeat 상태 열(마이그레이션 신규 번호)에 `blocked` 를 나중에 끼워 넣는 재작업이 발생한다.
- **해소**: 두 스펙의 착수 순서를 정하고, 상태값 스키마를 지금 합쳐 확정한다.

---

## 가상오피스(좌석표·모니터링) 세부

### [치명] Micro 컴퓨트 위에서의 실시간 갱신 부하가 검증되지 않았다

- **위치**: 스펙 §5-4·§9-4, `CLAUDE.md`
- **문제**: `CLAUDE.md` 는 "2026-08-05 PostgREST 풀 고갈 사고가 바로 이 Micro 사양에서 났다" 고 명시한다. 스펙은 "30초 폴링이면 충분하다" 고만 결론 내리고, 동시 열람자 수·브라우저 클라이언트가 직접 Supabase 연결을 여는지(직접 60 / 풀러 200 한도)·서버 액션 재조회가 service_role 경유인지 사용자 세션 경유인지를 검증하지 않았다.
- **터지는 지점**: heartbeat API 자체는 `updated_at` touch 라 가볍지만, **좌석표 페이지의 폴링**이 관리자 다수 동시 접속 시 풀 고갈을 재현할 위험이 있다.
- **해소**: S2 착수 전에 동시 접속 부하 가정을 실측한다.

### [높음] STANDBY 상태의 서버 신호가 없다

- **위치**: 스펙 §5-4·§7·§9-4 (스펙이 스스로 미결로 인지)
- **문제**: `poll.sh` 는 서버에 아무 흔적도 남기지 않는다. STANDBY 를 v1 표시에서 제외할지, 아니면 `PUT /agent/watch` 류 신규 계약을 신설할지가 미결이다.
- **터지는 지점**: 방치하면 S4(애니메이션)의 STANDBY 순찰 걷기 자산까지 헛제작된다.
- **해소**: 착수 전 표시 방식을 결정한다.

### [중간] 스프라이트 조립 파이프라인이 문서와 실제 산출물이 어긋난다

- **위치**: 스펙 §4-2·§4-4, `scripts/sprites/`
- **문제**: §4-2 는 조립 스크립트를 `scripts/sprites/build.mjs`(JS)로 명시하지만, 실제 디렉터리에는 `build.mjs` 가 없고 Python 스크립트 9개만 있다(`clean.py`·`animate.py`·`props.py`·`fix_all_alignments.py`·`perfect_alignment_all.py`·`process_all_characters.py`·`generate_animations.py`·`make_static_bg_animations.py`·`review.py`). §4-4 "확장(09-10)" 절이 부분적으로 반영했으나 §4-2 규격 표는 갱신되지 않아 정본 문서 내부 모순이다.
- **해소**: 최종 파이프라인 스크립트를 하나로 정리·확정하고 §4-2 를 갱신한다.

### [중간] 스프라이트 셀 규격이 자기모순이다

- **위치**: 스펙 §4-1 vs §4-4
- **문제**: §4-1 표는 "셀 64×64px" 로 명시하지만, §4-4 는 "손·키보드가 살아서 96 으로 간다(§4-1 의 64 는 이 결과로 개정)" 라고 적어놓고 §4-1 표를 실제로 고치지 않았다. 구현자가 표만 보면 64px 로 착각한다.
- **해소**: §4-1 표를 96px 로 정정한다.

### [중간] UI 위험 파일 변경 범위를 과소평가했다

- **위치**: 스펙 §9-2, `CLAUDE.md` UI 위험 파일 규칙
- **문제**: 스펙은 "사이드바 메뉴 추가(`Sidebar.tsx`)만 브랜치+Preview 대상, 클라이언트 뷰는 `src/components/agents/*` 에 둬 위험 파일을 피한다" 고 했다. 그러나 `canViewUsage` 관례를 따르면 `/agents` 게이트를 위해 `src/app/(app)/layout.tsx` 에도 `showAgents` 류 플래그 전달이 필요할 가능성이 높다(`usage` 가 실제로 `layout.tsx:65` 에서 그렇게 되어 있다). `(app)/layout.tsx` 는 `CLAUDE.md` 가 지정한 UI 위험 파일이라 브랜치+Preview 대상인데 스펙이 언급하지 않았다.
- **해소**: 이 변경도 브랜치+Preview 절차 대상임을 스펙·계획에 명시한다.

### [중간] Gemini 생성 이미지의 라이선스·출처가 미검토다

- **위치**: 스펙 §4-4·§8
- **문제**: 캐릭터 기준 그림을 Gemini 이미지 생성으로 뽑아 파생 스프라이트를 만드는데, 생성 결과물의 상업적·재배포 라이선스 조건이 스펙에 전혀 언급되지 않았다. 내부 도구용이라 리스크는 낮으나 "확인함" 기록이 없어 추후 질의 시 근거가 없다.
- **해소**: 사용 조건을 확인하고 한 줄이라도 근거를 남긴다.

### [낮음] heartbeat 임계값·훅 절제 주기가 미검증이다

- **위치**: 스펙 §3·§7 (스펙이 스스로 미결로 인지)
- **문제**: 5분/30분/60초는 초안이며 운영하며 조정한다고 명시되어 문제는 아니나, S1 리허설 때 실측 기준을 남겨야 한다.

### [낮음] heartbeat 스코프 리터럴 결정

- **위치**: `src/lib/agent/routeShared.ts:96`
- **문제**: `resolveWriteActor` 가 `scope: 'work:claim'` 리터럴로 하드코딩되어 있어, heartbeat 라우트가 이 스코프를 재사용할지 전용 스코프를 신설할지 결정하지 않았다. heartbeat 는 claim 소유자 활동의 부분집합이므로 `work:claim` 재사용이 자연스러운 기본값이고, 구현을 막는 blocker 는 아니다.

---

## 팀장 스킬(`/dflow-team`) 세부

설계 결정 자체(백엔드 자동 감지, blocked 처리, 권한 모드 대응 순서, 상태 재구성 방식 등)는
`docs/superpowers/specs/2026-09-10-dflow-team-design.md` 가 정본이다. 아래는 리허설로만 확인할 수 있는 항목이다.

### [높음·실측] 에이전트 팀 팀원의 완료 알림·회수·한도 동작이 확인되지 않았다

- **위치**: 스펙 §3-8·§4-6·§11-3
- **확인**: 리허설 첫 항목 A0(단독 선행, 스펙 §11-3)에서 실측한다. (a) 손자 실행 중 팀장에게 알림이 오는가, (b) blocked 로 끝난 팀원이 idle 로 남는가, (c) idle 팀원에게 SendMessage 로 답을 주면 같은 워크트리·컨텍스트에서 이어 가는가, (d) 에이전트 팀 팀원 안에서 `dflow.sh done --auto-links` 가 성공하는가(스크립트 내부 bare `git` 은 rtk 훅을 거치지 않는다고 판단하나 확인한다), (e) 팀원 `TaskStop` 이 손자 서브에이전트까지 거두는가, (f) 사용량 한도에 걸린 팀원이 무엇을 남기는가.
- **결과에 따라**: 결과 줄 없는 완료 알림은 `failed` 가 아니라 `suspect` 로 두고 슬롯을 유지하며, 두 TICK 연속 생존 증거(브랜치 tip 커밋 시각·서버 최신 progress·워크트리 변경 목록)가 변하지 않을 때만 `failed no-result` 로 판정한다. 완료·blocked 처리 직후 `TaskStop(w<slot>-<id8>)` 로 idle 팀원을 회수한다. (c) 가 되면 blocked 재개의 워크트리 정리·`ANSWER=` 재spawn 을 단순화할 수 있다. (d) 는 하드 게이트다. 실패하면 `done` 이 막히므로 `dflow.sh` 에 git 실행 경로 주입(`DFLOW_GIT`)을 더하고 재실측이 통과한 뒤에 나머지 리허설로 간다. (e) 에서 손자가 남으면 회수가 손자를 따로 멈춰야 한다. (f) 는 `failed rate-limit` 을 팀원이 쓸 수 있는지, 팀장이 알림으로 판정해야 하는지를 정한다.

### [높음·실측] auto 권한 모드에서 막히는 명령 목록

- **위치**: 스펙 §8 권한 준비·§11-2
- **확인**: 사용자 기본 권한 모드(`defaultMode: "auto"`)로 리허설을 먼저 돌려, 거부·프롬프트가 난 명령을 기록한다.
- **결과에 따라**: 대상 리포 `.claude/settings.json` 에 정확한 allow 목록을 넣는 방식(git 은 절대경로 형태, 예 `Bash(/usr/bin/git *)`)을 먼저 시도하고, 그래도 막히면 팀장을 권한 확인 생략 모드로 띄운다.

### [중간] Orca 워크트리 정리 경로가 "브랜치 switch 된 상태" 에서 미실측이다

- **위치**: 스펙 §4-2 생성 브랜치 정리, §11-4 (합격 기준 6번이 스스로 인정)
- **확인**: 워크트리가 `agent/<id8>-<slug>` 로 switch 된 상태에서 `orca worktree rm --worktree path:<경로>` 가 깨끗이 돌고, 머지를 입증하지 못한 로컬 agent 브랜치를 보존하는지(`--help` 의 설명대로인지) 리허설에서 검증한다. `orca worktree create --name dflow-<id8>` 가 만드는 브랜치의 실제 이름은 `--help` 에 없으므로 첫 spawn 직후 `git branch --list` 로 적고, 생성 브랜치 정리 뒤 남지 않는지와 `skipped` 된 같은 id8 을 다시 띄울 때 이름·브랜치 충돌이 없는지 본다.
- **결과에 따라**: 이 조합이 통과하기 전까지 스펙 §4-6 의 그 자리 정리와 §4-9 마감 절차가 가정 위에 있으므로, 착수 순서상 최우선 검증 항목으로 둔다. 생성 브랜치 이름이 스펙의 `dflow-<id8>` 포함 가정과 다르면 §4-2 와 backends.md 의 이름 조건을 실제 이름으로 고친다.

### [중간] 다중 신원·공용 PC 전제와 로컬 캐시 공유가 상충한다

- **위치**: 스펙 §3-4·§12
- **문제**: `~/.cache/dflow/last-list.json` 을 같은 머신의 모든 프로세스가 공유한다. 한 PC 에서 신원 A 의 팀장과 신원 B 의 팀장이 동시에 뜨면(스펙이 명시적으로 지원하는 시나리오) 같은 캐시 파일을 놓고 경쟁한다. 완화책은 "접두 해석 실패 시 팀원은 failed 로 끝나고 사람이 재개" 뿐이다.
- **확인**: 리허설에서 경합 재현 여부를 확인하고, 재현되면 완화책이 충분한지 판단한다.

---

## 문제없음으로 확인된 사항 (참고)

- `/api/v1/agent/work/[id]/{claim,report}` 의 RLS·서버 가드 구조(0057 마이그레이션: 쓰기는 RLS 정책 없이 service_role 전용, 서버 가드가 유일 관문)를 가상오피스 스펙이 정확히 파악하고 있고, heartbeat 도 같은 패턴을 따르면 된다.
- `src/lib/authz/agentsAccess.ts` 신설 계획은 `canViewUsage` 관례를 그대로 재사용하는 설계라 authz 3단 가드(`requireSuperuser`·`requireProjectAdmin`·`requireProjectMember`) 우회가 아니다.
- heartbeat 마이그레이션이 G4(0072+ 스테이징 리허설 필수) 대상임을 가상오피스 스펙이 정확히 인지하고 있다(§9-3).
- `middleware.ts` 가 이미 png 를 인증 리다이렉트에서 제외해 스프라이트 서빙 자체는 문제없다.
- `orca worktree rm --force` 는 지원된다("Force worktree removal when supported; does not force branch
  deletion"). 팀장 스킬은 부트스트랩 실패 정리(브랜치를 만들기 전에 끝나 알려진 부산물만 남은 워크트리)에만
  `--force` 를 붙인다. 부산물 중 `spec.md` 캐시 등은 `info/exclude` 가 가리지 않아 `--force` 없이는 거부될 수
  있기 때문이다. 마감·고아 정리는 깨끗하고 push 된 워크트리만 `orca worktree rm --worktree path:<경로>` 로
  지우며 `--force` 를 붙이지 않는다.

---

## 착수 전 사용자 결정이 필요한 항목

> **2026-09-14 확정**: 1 = 지금 착수·`blocked` 는 `heartbeat_phase` 파생, 2 = `work:claim` 재사용, 3 = 스테이징 배포 뒤 실측(main 머지 전). STANDBY 는 v1 포함(TTL 70분), staging:sync 는 생략. 상세는 `2026-09-14-agent-office-v1-design.md`.

1. **두 스펙 착수 순서 + `blocked` 상태 스키마 합의** — 재작업 방지. 팀장 스킬 쪽은 좌석표 없이도
   events.jsonl·`.result` 로 동작하므로 이 결정을 기다리지 않고 착수할 수 있다. 좌석표에 요청할 좌석 식별
   경로는 `.dflow-agent`(워크트리 루트)다.
2. **heartbeat 스코프** — `work:claim` 재사용 vs 전용 스코프. PAT 조달·소유자 판정은 `dflow.sh heartbeat`
   서브커맨드 신설로 이미 해소되어 있다.
3. **가상오피스 Micro 부하 실측** — S2 착수 전 선행한다.
