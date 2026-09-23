# 워커 결정 보고 — 스스로 고른 결정을 승인자에게 드러낸다 (과제 C)

- 작성: 2026-09-23
- 상위: `docs/idea.md` 「에이전트 스킬」 판단 규칙 항목(39~42행 — "작업자에게 결정 사항을 남기는 방식")
- 선행: 워커 판단 규칙 개정 704dc2ff(2026-09-19, origin/staging 조상 확인)
- 반영 범위: staging 까지. main·dflow-kit 반영은 별도 지시.
- **근거 기준선**: `origin/staging` a8eabc6d. 로컬 `staging`(8bb61c89)과 갈라져 있다(로컬만 23커밋·원격만 18커밋).
  `dflow.sh`·`worker-prompt.md`·`dflow-dev/SKILL.md`·`seatmap.ts`·`agentSeatmap.ts`·`api-contract.md` 는 두 갈래의 줄 번호가
  달라 원격 기준으로 적는다. 그 밖에 인용한 파일(보고 라우트·허브·승인 큐·Task 사이드바·사이드바·결재 수)은 두 갈래가 같다.

## 1. 문제

704dc2ff 로 워커(`/dflow-dev --worker`)는 기본값 없는 분기에서 멈추지 않고 근거가 강한 쪽을 골라 진행한다. 고른 결정은
design.md `## 담당자 확인 필요 결정` 절에 남기고(`.claude/skills/dflow-team/references/worker-prompt.md:131-140`,
`.claude/skills/dflow-dev/SKILL.md:297`), 완료 보고 요약 끝에 `확인 필요 결정 N건: …` 을 붙인다. 이 결정이 승인자에게
닿는 길은 다음과 같이 약하다.

| | 자리 | 지금 |
|---|---|---|
| ① | 보고 경로 | `dflow.sh done`(`.claude/skills/dflow-work/scripts/dflow.sh:392-421`)은 `summary` 문자열 하나만 보낸다. 보고 라우트(`src/app/api/v1/agent/work/[id]/report/route.ts:31-99`)는 `agent_work_reports.summary text`(0057:37-52)에 넣는다. 결정은 자유 문구 끝에 묻힌다 |
| ② | design.md | 웹은 design.md 를 읽지 않는다. 결정의 근거·선택지·반려 시 방향은 git 에만 있다 |
| ③ | 승인 큐 | `src/components/agent-hub/ApprovalQueue.tsx:52` 가 요약 전문을 보여 주지만 결정은 문장 속에 섞여 있다 |
| ④ | Task 사이드바 | `src/components/wbs/WbsSpecPanel.tsx:465-480` 보고 이력도 요약 전문뿐이다 |
| ⑤ | 오피스 | 말풍선(`src/components/agents/SeatSpeech.tsx:55-66`)은 2줄 클램프라 요약 끝의 접미사가 잘리고, 10분(`REPORT_FRESH_MS`, `src/lib/domain/officeChatter.ts:20`)이 지나면 사라진다 |
| ⑥ | 결재 배지 | `src/components/app/Sidebar.tsx:121-126` 는 승인할 보고 **건수**만 보인다. 결정이 딸린 보고인지 모른다 |

오피스의 「결정 대기」(heartbeat `phase=blocked`, `src/components/agents/DetailPanel.tsx:96`)는 워커가 **멈춘** 상태를 보이는
다른 기능이다. 이 과제는 멈추지 않고 고른 뒤 끝낸 보고를 다룬다.

사용자 결정(2026-09-23): **정공법(B)** — 결정 목록을 구조화된 별도 필드로 보고에 싣는다. 마이그레이션을 쓴다. 승인 큐·Task
사이드바·오피스·결재 배지 네 곳에서 드러낸다. 결정별 수락/반려로 넓힐 토대가 되게 하되 넣을지는 비용을 보고 정한다(YAGNI).

## 2. 결정 표

| # | 결정 | 이유 |
|---|---|---|
| D1 | 저장은 `agent_work_reports` 에 **jsonb 컬럼 `decisions`** 를 더한다. 별도 테이블을 두지 않는다 | §3.1 비교. 0073 `evidence` 와 같은 모양이고, 기존 RLS·grant 가 그대로 덮는다 |
| D2 | `decisions` 는 **nullable** 이다. `null` = 제출 안 됨(구 CLI·구 서버·수동 보고), `[]` = 결정 0건을 명시 | `default '[]'` 로 두면 "0건" 과 "모름" 이 같아져 화면이 모르는 것을 0건이라고 말한다(에러 처리 원칙) |
| D3 | 생성 컬럼 `decision_count`(stored)를 같이 둔다 | 좌석표(주문 최대 2000건)·결재 배지는 수만 필요하다. jsonb 본문을 끌어오지 않는다 |
| D4 | 결정 항목은 `key`·`question`·`options`·`chosen`(정수 색인)·`rationale`·`on_reject` 여섯 필드다. `chosen` 을 문자열로 두지 않는다 | LLM 이 선택지 문구를 바꿔 적으면 문자열 일치 검증이 Phase 06 에서 400 을 낸다. 색인은 어긋날 수 없다 |
| D5 | 검증은 서버가 fail-loud 400, CLI 가 같은 규칙으로 **먼저** 검사한다 | `links`·`evidence` 와 같은 규칙. CLI 선검사로 형식 오류가 서버 왕복 전에 워커 화면에 뜬다 |
| D6 | `decisions` 는 PAT 호출의 `kind=completion` 에서만 받는다. progress·레거시(v1)에 실리면 400 | 승인자가 보는 것은 완료 보고다. v1 요청 형식은 불변(api-contract.md 머리말) |
| D7 | CLI 는 `dflow.sh done … --decisions <file>` 로 JSON 파일을 넘긴다. design.md 를 파싱하지 않는다 | §5.1 비교 |
| D8 | 요약 접미사 `확인 필요 결정 N건: …` 과 `.result` 의 `(결정 N건)` 은 **유지**한다. 화면은 요약을 파싱하지 않는다 | 구 서버는 모르는 필드를 조용히 버린다(§4.3). 그때 결정이 남는 유일한 자리이고, 팀장 집계는 `.result` 를 읽는다 |
| D9 | 서버 응답에 `decisions_recorded` 를 싣는다. 결정을 보냈는데 응답에 이 키가 없으면 CLI 는 stderr 경고, exit 0 | 구 서버에서 결정이 버려졌다는 사실을 워커가 안다. 완료 보고 자체는 이미 성공했으니 실패로 만들지 않는다 |
| D10 | 결정별 수락/반려는 **이번 범위에 넣지 않는다.** `key` 와 반려 사유 안내 문구로 토대만 둔다 | §11. 비용이 이 과제의 두 배 가까이 되고, 주문 단위 반려로 지금 필요한 일은 된다 |
| D11 | 반영 순서는 **DB 먼저, 코드 나중**이다 | 코드가 먼저 나가면 허브 조회가 없는 컬럼을 select 해 에이전트 화면 전체가 죽는다(§9) |

## 3. 데이터 모델

### 3.1 컬럼 vs 별도 테이블

| | jsonb 컬럼(`agent_work_reports.decisions`) | 별도 테이블(`agent_work_decisions`) |
|---|---|---|
| 기록 원자성 | 보고 insert 한 번에 같이 들어간다. 보고 라우트의 cleanup(`route.ts:112-115`)이 그대로 결정도 지운다 | insert 두 번. completion 전이 실패 cleanup 에 결정 행 삭제를 더해야 한다(FK cascade 로 되긴 한다) |
| 권한 | 0057 `read_agent_work_reports`(0057:69-75)와 table-level `grant select`(0057:87-89)가 새 컬럼을 그대로 덮는다 | RLS·정책·grant·rollback 을 새로 만든다 |
| 선례 | 0073 `evidence jsonb` 와 같다 | 없음 |
| 조회 | 기존 보고 select 에 컬럼 하나 추가 | 조인 1회 추가(PostgREST 임베드 또는 2차 조회) |
| 결정별 수락/반려 확장 | 판정을 별도 테이블 `(report_id, key)` 로 붙이면 된다. 결정 본문은 보고 시점의 불변 기록이라 오히려 jsonb 가 맞다 | 결정 행에 판정 컬럼을 바로 둘 수 있다 |
| 결정 단위 검색·집계 | jsonb 연산자로 가능하나 불편 | 쉽다. 다만 지금 필요 없다 |

**컬럼을 고른다.** 결정은 보고의 일부로 한 번 쓰이고 바뀌지 않는다. 확장이 필요해지면 판정만 따로 붙이면 되므로 컬럼이
확장을 막지 않는다. 별도 테이블은 권한·cleanup·rollback 표면을 늘리는 대가로 지금 쓰지 않는 검색성을 얻는다.

### 3.2 마이그레이션

번호는 **0102** 다(2026-09-23 배정. 0103 은 강제 진행). 아래
`0102` 로 적는다. 코드와 **다른 커밋**(G1), 스테이징 리허설 트레일러 `Staging-verified:`(G4).

`supabase/migrations/0102_agent_report_decisions.sql`

```sql
-- 0102: agent_work_reports.decisions — 워커가 스스로 고른 결정 목록(과제 C).
-- null = 제출 안 됨(구 CLI·구 서버), [] = 0건 명시. 항목 모양 검증은 앱(validateDecisions)이 한다(0073 evidence 와 같은 분담).
begin;
alter table public.agent_work_reports
  add column if not exists decisions jsonb;
alter table public.agent_work_reports
  drop constraint if exists agent_work_reports_decisions_shape;
alter table public.agent_work_reports
  add constraint agent_work_reports_decisions_shape check (
    decisions is null
    or (jsonb_typeof(decisions) = 'array' and jsonb_array_length(decisions) <= 20 and kind = 'completion')
  );
alter table public.agent_work_reports
  add column if not exists decision_count int
  generated always as (case when jsonb_typeof(decisions) = 'array' then jsonb_array_length(decisions) end) stored;
commit;
```

- `decisions` 가 null 이면 `decision_count` 도 null 이라 "모름" 을 그대로 잇는다.
- 생성식을 `jsonb_typeof` 로 감싼다. Postgres 는 stored 생성 컬럼을 CHECK 보다 **먼저** 계산하므로, 감싸지 않으면 배열이 아닌 값이
  CHECK(23514) 대신 `jsonb_array_length` 오류(22023)로 거부된다. 거부되는 것은 같지만 오류 모양이 달라 시험·로그가 헷갈린다.
- 기존 행은 전부 `null`(제출 안 됨)이다. 소급하지 않는다 — 옛 요약에서 결정을 파싱해 채우는 일은 하지 않는다(D8).
- stored 생성 컬럼 추가는 테이블을 다시 쓴다. `agent_work_reports` 는 작아 문제없다(리허설에서 소요 시간을 적는다).

`supabase/migrations/0102_agent_report_decisions_rollback.sql`

```sql
begin;
alter table public.agent_work_reports drop column if exists decision_count;
alter table public.agent_work_reports drop constraint if exists agent_work_reports_decisions_shape;
alter table public.agent_work_reports drop column if exists decisions;
commit;
```

### 3.3 결정 항목 스키마

```json
{
  "key": "D1",
  "question": "판정 로직을 이 Task 에서 넣는가?",
  "options": ["넣지 않는다(spec 제약 우선)", "넣는다(선행 decisions.md 배정 우선)"],
  "chosen": 0,
  "rationale": "spec 본문이 '판정 로직과 라우트는 넣지 않는다' 고 적었고, 선행은 미승인이다. 근거 순위 spec > 미승인 선행.",
  "on_reject": "판정 로직을 src/domain/verdict.ts 에 옮기고 라우트 1개를 더한다."
}
```

| 필드 | 형 | 제약 | 뜻 |
|---|---|---|---|
| `key` | string | `^D[1-9][0-9]?$`, 보고 안에서 유일 | 결정 번호. design.md 절의 번호와 같다. 반려 사유·후속 판정이 가리키는 좌표 |
| `question` | string | trim 뒤 1~300자 | 무엇을 골랐나 |
| `options` | string[] | 2~6개, 각 trim 뒤 1~200자 | 선택지 |
| `chosen` | integer | `0 ≤ chosen < options.length` | 택한 선택지의 색인 |
| `rationale` | string | trim 뒤 1~1000자 | 근거. 근거의 강약 순위(spec > 승인된 선행 > 관례 > 미승인 선행, worker-prompt.md:137)를 밝힌다 |
| `on_reject` | string | trim 뒤 1~500자 | 반려되면 재작업할 방향 |

- 배열 최대 20건. 넘으면 400. 이 상한은 DB CHECK 와 같다.
- 알 수 없는 필드는 400 이다(`validateEvidence` 의 `EVIDENCE_KEYS` 규칙과 같다, `src/lib/domain/agentWork.ts:76-86`).
- 문자열은 저장 전에 trim 한다. 형식만 검증하고 내용의 참·거짓은 서버가 판정하지 않는다(evidence §6 과 같은 입장).
  화면은 "에이전트가 적은 결정" 으로 표기한다.
- 검증 함수 `validateDecisions(raw)` 는 `src/lib/domain/agentWork.ts` 에 순수 함수로 둔다. 상한 상수
  (`AGENT_DECISIONS_MAX = 20` 등)도 같은 파일에 모은다. CLI 선검사는 이 상수를 문서로 따라간다(§5.2).

## 4. API 계약 — v2.5 → v2.6

`src/lib/agent/externalApi.ts:121` `AGENT_CONTRACT_VERSION` 을 `'2.6'` 으로, `.claude/skills/dflow-work/references/api-contract.md`
머리말과 「v2.6 변경점」 절을 더한다. 필드 추가뿐이라 마이너다.

### 4.1 `POST /api/v1/agent/work/{id}/report`

요청 본문에 선택 필드 `decisions` 를 더한다.

| 경우 | 결과 |
|---|---|
| `decisions` 없음 | 종전과 같다. 행의 `decisions` 는 null |
| PAT + `kind=completion` + 유효한 배열(0~20건) | 행에 그대로 저장. `[]` 도 저장한다(0건 명시) |
| `kind=progress` 에 `decisions` 가 있음 | 400 `decisions는 완료 보고(kind=completion)에서만 받습니다.` |
| 레거시(v1) 호출에 `decisions` 가 있음 | 400 `decisions는 PAT 호출에서만 받습니다.` |
| 형식 위반 | 400, 사유는 필드 경로를 담는다(예 `decisions[2].chosen이 options 범위를 벗어났습니다.`) |

검증 위치는 `summary`·`links`·`evidence` 검증 뒤, DB 접근 전(`route.ts:45-47` 다음)이다. 레거시 판정만 principal 을
알아야 하므로 `resolveWriteActor` 뒤(`route.ts:52` 다음)에서 한다.

응답: completion 이면 `{ ok: true, status: 'reported', decisions_recorded: <number|null> }`. `decisions` 를 보내지 않았으면
`null`, 보냈으면 저장한 건수다. progress 응답은 바뀌지 않는다.

insert(`route.ts:90-96`)에 `decisions` 를 더한다. completion 전이 실패 때의 보고 행 cleanup(`route.ts:112-115`)은 결정도 같이
지우므로 따로 할 일이 없다.

알림(`route.ts:135-143`, detail 은 138행)의 `detail` 은 결정이 1건 이상이면 `완료 보고 — 승인 대기 · 확인 필요 결정 N건` 으로 바꾼다.
관리자가 알림만 보고도 결정이 딸렸음을 안다.

### 4.2 `GET /api/v1/agent/work/{id}`

PAT 응답의 `reports[]` 에 `decisions` 를 더한다. `evidence` 와 같은 규칙이다(`src/app/api/v1/agent/work/[id]/route.ts:44-47`).
재작업하는 워커가 어느 결정이 반려 사유에 걸렸는지(`review_note` 가 `D2` 를 가리키는지) 볼 재료다. 레거시 응답은 불변.

### 4.3 호환

| 조합 | 결과 | 결정이 남는 자리 |
|---|---|---|
| 새 CLI → 새 서버 | 구조화 저장 | `decisions` + 요약 접미사 |
| 구 CLI(킷) → 새 서버 | 필드 없음 → `null`. 화면은 "결정 목록 미제출" | 요약 접미사 |
| 새 CLI → 구 서버(예: 운영이 아직 v2.5) | 구 라우트는 insert 를 명시 필드로만 만들어 `decisions` 를 조용히 버린다(`route.ts:90-96`). 응답에 `decisions_recorded` 가 없어 CLI 가 경고한다(D9) | 요약 접미사 |

마지막 줄이 요약 접미사를 유지하는 이유다(D8). `null` 인 보고의 결정 수를 요약에서 읽어 내지 않는다 — 문구는 워커가 바꿀 수
있어 파싱 결과를 사실처럼 보이면 화면이 틀린 수를 말한다.

## 5. CLI — `dflow.sh done`

### 5.1 결정 전달 방식 비교

| | design.md 절을 파싱 | 워커가 JSON 파일을 만들어 넘김 |
|---|---|---|
| 정본 | design.md 하나 | design.md(사람이 읽는 기록) + JSON(전송) |
| 구현 | POSIX sh/awk 로 여러 줄 마크다운 파싱. 워커가 목록 모양을 조금만 바꿔도 깨지거나 **조용히 덜 읽는다** | `jq` 로 검증. 형식이 틀리면 크게 실패한다 |
| 실패 모양 | 조용한 누락(최악) | 선검사 exit 2, 워커가 고쳐 재시도 |
| 문서 문법 고정 | design.md 절을 기계용 엄격 문법으로 묶어야 한다 | design.md 는 지금처럼 자유 서술 |
| 어긋남 위험 | 없음 | 절과 JSON 이 다를 수 있다 → CLI 가 요약 접미사 N 과 배열 길이를 대조해 경고(§5.2) |

**JSON 파일을 고른다.** 파서가 조용히 덜 읽는 실패는 이 과제가 없애려는 "결정이 승인자에게 안 닿는" 사고 그 자체다. LLM
워커에게 JSON 은 가장 틀리기 어려운 형식이고, 틀려도 jq 가 잡는다.

### 5.2 명령

```
dflow.sh done <ref> <요약> [--auto-links] [--decisions <file>]
```

- 지금 `cmd_done` 은 셋째 위치 인자만 `--auto-links` 로 본다(`dflow.sh:393`). 요약 뒤 인자를 순서 무관 플래그로 파싱하게 바꾼다.
  모르는 플래그는 `usage`(지금 `cmd_watch` 의 while/case 모양, `dflow.sh` 의 `cmd_watch`). 사용법 줄(`dflow.sh:36`)도 고친다.
- `--decisions <file>`: 파일은 결정 항목 배열(JSON). 순서:
  1. 파일이 없거나 JSON 이 아니면 exit 2.
  2. jq 로 §3.3 규칙을 **서버와 같은 상한**으로 검사. 위반이면 exit 2 와 필드 경로 한 줄. **push 확인·네트워크보다 먼저** 한다 —
     형식 오류로 보고가 반쯤 나가는 일이 없다.
  3. 요약에 `확인 필요 결정 N건` 이 있고 N 이 배열 길이와 다르면 stderr 경고(보고는 계속). 배열이 1건 이상인데 접미사가
     없어도 경고.
  4. 본문에 `decisions` 로 싣는다.
  5. 응답에 `decisions_recorded` 키가 없으면 stderr `서버가 결정 목록을 모릅니다(계약 < 2.6) — 요약 접미사로만 전달됐습니다.`,
     exit 0(D9).
- `--decisions` 가 없으면 본문에 `decisions` 를 넣지 않는다(= `null`, 제출 안 됨). 구 호출 `done <ref> <요약> --auto-links` 는
  그대로 동작한다.
- 상한 상수는 쉘 변수로 둔다. 서버 상수와의 일치는 시험이 대조한다(§10).

### 5.3 파일 위치

`{TASK_DIR}/decisions.json`. `.result`·`.issues` 처럼 **커밋하지 않는다** — 기록의 정본은 design.md 절과 서버의 보고 행이고,
이 파일은 전송용이다. 재작업 마감 때마다 새로 쓴다.

`.result`·`.issues` 는 `.gitignore` 가 아니라 팀장이 공유 `info/exclude` 에 넣는 패턴(`**/tasks/*/.result`·`**/tasks/*/.issues`,
`.claude/skills/dflow-team/SKILL.md` 팀장 부트스트랩 블록, origin/staging 447행 부근)으로 빠진다. 같은 목록에
`**/tasks/*/decisions.json` 을 더한다. 팀장이 없는 supervised `/dflow-dev` 에서는 이 패턴이 없을 수 있다 — 파일명 명시 stage
규칙이 커밋을 막지만 작업트리가 dirty 로 보이므로, Phase 06 이 `done` 성공 뒤 이 파일을 지운다(실패하면 남겨 재시도 재료로 쓴다).

## 6. 워커 규칙 문서 수정점

| 파일 | 자리(origin/staging) | 바꿀 것 |
|---|---|---|
| `.claude/skills/dflow-team/references/worker-prompt.md` | 「6. 판단 규칙」 131-140 | design.md 절의 결정마다 번호 `D1`… 을 붙인다. Phase 06 에서 그 절을 `{TASK_DIR}/decisions.json`(§3.3 스키마)으로 옮기고 `done --decisions` 로 넘긴다. **0건이면 `[]` 를 써서 넘긴다**(0건 명시와 미제출을 가르기 위해). 요약 접미사 `확인 필요 결정 N건: …` 은 유지 |
| 같은 파일 | 7번 결과 표 183 | `done` 행의 조건을 `done --auto-links --decisions …` 로. `(결정 N건)` 접미사 유지 |
| `.claude/skills/dflow-dev/SKILL.md` | Phase 06 3번(273) | `dflow.sh done <ref> "<요약>" --auto-links --decisions {TASK_DIR}/decisions.json`. supervised 모드도 넘긴다 — 사람과 대화로 정한 결정은 확인이 끝났으므로 `[]` 를 쓴다. 이렇게 해야 `null` 이 "구 도구" 한 가지 뜻만 갖는다 |
| 같은 파일 | 워커 모드 표 D행(297) | 결정마다 `D` 번호, Phase 06 JSON 변환을 한 줄 더한다 |
| `.claude/skills/dflow-work/SKILL.md`·`README.md`·`references/troubleshooting.md` | `done` 사용 예 | `--decisions` 추가, CLI 경고 두 가지(접미사 불일치·구 서버)의 뜻 |
| `.claude/skills/dflow-work/references/api-contract.md` | 머리말·변경점 | §4 |
| `.claude/skills/dflow-team/SKILL.md` | 팀장 부트스트랩의 `info/exclude` 패턴 목록 | `**/tasks/*/decisions.json` 추가(§5.3) |

design.md 절의 사람용 서식은 그대로 둔다(질문·선택지·택한 것·근거·반려 시 방향). 번호만 더한다.

## 7. 화면

공통 부품 `src/components/agent-hub/DecisionList.tsx`(클라이언트, 표시 전용)를 네 곳 중 셋이 쓴다. 입력은 파싱된 결정 배열 또는
상태(`null` 미제출 · 형식 오류). 결정 하나는 이렇게 보인다.

```
D2  판정 로직을 이 Task 에서 넣는가?
    택함  넣지 않는다(spec 제약 우선)          ← 굵게
    다른 선택지  넣는다(선행 decisions.md 배정 우선)   ← 흐리게
    근거  spec 본문이 … 근거 순위 spec > 미승인 선행.
    반려 시  판정 로직을 src/domain/verdict.ts 에 옮기고 라우트 1개를 더한다.
```

- 본문은 React 텍스트 노드와 `whitespace-pre-wrap` 으로만 그린다. 마크다운·HTML 해석을 하지 않는다(에이전트 입력이다).
- 머리에 "에이전트가 적은 결정" 을 표기한다(evidence 의 "에이전트 제출 주장" 과 같은 입장).
- 순수 파서 `parseDecisions(raw: unknown)` → `{ state: 'none' } | { state: 'ok', items } | { state: 'invalid' }` 를
  `src/lib/domain/agentWork.ts` 에 둔다. DB 가 CHECK 로 배열을 보장하지만 항목 모양은 앱 검증뿐이라 방어한다.

### 7.1 승인 큐 — `ApprovalQueue.tsx`

- 데이터: `REPORT_COLS`(`src/lib/data/agentHub.ts:15`)에 `decisions` 추가, `HubReportRow`·`HubQueueEntry`
  (`src/lib/domain/agentHub.ts:17-19, 51-53`)에 `decisions: unknown` → 조립(`agentHub.ts:209-222`)에서 `parseDecisions` 결과를 싣는다.
- 카드 머리(`ApprovalQueue.tsx:45-51`)의 에이전트·시각 줄 옆에 칩 `결정 N`(N ≥ 1, 주황 계열).
- 요약(52행) 아래에 `DecisionList` 를 **펼친 채로** 둔다. 승인자의 일이 이것을 읽는 것이라 접지 않는다.
- `null` 이면 한 줄 `결정 목록 미제출(구버전 보고) — 요약을 확인하세요`, 형식 오류면 `결정 목록을 읽지 못했습니다 — 요약을 확인하세요`
  + `console.error`. 0건(`[]`)이면 아무것도 그리지 않는다.
- 반려 입력(71행)의 placeholder 를 결정이 있을 때 `반려 사유 — 특정 결정이면 번호를 적어 주세요(예: D2 는 선택지 2로)` 로 바꾼다.
  결정별 반려의 토대다(§11). 가드·동작은 바꾸지 않는다.

### 7.2 Task 사이드바 — `WbsSpecPanel.tsx`

- 데이터: `getAgentOrderForItem`(`src/app/actions/agentWork.ts:350-358`)의 select 에 `decisions` 추가, `AgentOrderReport`
  (`agentWork.ts:310`)에 필드 추가. 이 조회는 세션 클라이언트라 RLS 가 2차 방어선이다(`agentWork.ts:24`).
- 보고 이력 각 항목(`WbsSpecPanel.tsx:467-478`)에서 `kind=completion` 이면 요약 아래 `DecisionList`(간결 모드).
  - 주문이 `reported` 이고 그 보고가 마지막 completion 이면 펼친다. 옛 completion(반려되고 재작업된 회차)은 `<details>` 로 접고
    머리에 `결정 N건` 만 보인다 — 회차마다 무엇이 반려됐는지(`review_note`)와 나란히 읽힌다.
  - `null`·형식 오류 표기는 §7.1 과 같다.

### 7.3 오피스 — 좌석·상세

- 데이터: 좌석표의 완료 보고 조회(`src/lib/data/agentSeatmap.ts:61`)에 `decision_count` 만 더한다. 본문은 싣지 않는다(최대
  2000주문). `ReviewRow`(`src/lib/domain/seatmap.ts:29`)에 `decision_count: number | null`, `Seat` 에
  `decisionCount: number | null` — `toSeat`(`seatmap.ts:185`)에서 주문이 `reported` 일 때만 최신 completion 의 값을 싣고 그 밖은 null.
- 좌석 카드(`src/components/agents/Seat.tsx`)와 상태 레인 「결재 대기」 카드(`LaneBoard.tsx:18`): `decisionCount ≥ 1` 이면 칩
  `결정 N`. 말풍선과 달리 승인될 때까지 계속 보인다.
- 상세 패널(`DetailPanel.tsx`): `WAIT` 좌석이고 `decisionCount ≥ 1` 이면 열릴 때 좁은 조회를 한 번 한다 — 새 서버 액션
  `getReportDecisions(orderId)`(세션 클라이언트 + `requireProjectMember`, `getAgentOrderForItem` 과 같은 방식)가 최신 completion 의
  `decisions` 를 돌려주고, 반려 사유 인용(97행) 자리 근처에 `DecisionList` 를 그린다. 조회 실패는 `결정 목록을 불러오지 못했습니다`
  와 재시도 링크(빈 목록으로 그리지 않는다).
- 말풍선(`SeatSpeech.tsx`)은 바꾸지 않는다. 요약 접미사가 이미 들어 있고, 일시적인 자리라 "안정적으로 드러낼" 곳이 아니다.

### 7.4 결재 배지 — `Sidebar.tsx`

- 수(`pending`)는 바꾸지 않는다 — 여전히 내가 승인할 수 있는 완료 보고 건수다.
- 데이터: `getPendingApprovalCount`(`src/lib/data/agentApprovals.ts:32-49`)를 `getPendingApprovals` 로 넓혀
  `{ count, decisions: number | null }` 을 돌려준다. 승인 가능 주문을 고른 뒤(`countApprovable` 을 목록 반환으로 바꿔 쓴다)
  그 주문들의 completion 보고 `work_order_id, decision_count, created_at` 을 한 번 읽어 주문마다 최신 값의 합을 낸다.
  승인 가능 주문이 0건이면 이 조회를 건너뛴다.
  최신 completion 의 `decision_count` 가 null(구 CLI 보고)인 주문이 섞이면 0 으로 세지 않는다 — 아는 수만 더하고
  `decisionsPartial: true` 를 같이 돌려 툴팁을 `확인 필요 결정 M건 이상 · 일부 구버전 보고` 로 쓴다(D2).
- 셸 응답(`src/app/api/shell/route.ts:23-37`)에 `pendingDecisions`, `ShellStateProvider.tsx` 에 `menuPendingDecisions`.
- 표시: 아는 결정 수 `pendingDecisions ≥ 1` 이면 배지 title·접힌 툴팁(`Sidebar.tsx:242-251`)을 `결재 대기 N건 · 확인 필요 결정 M건` 으로,
  배지 오른쪽 위에 작은 점(`data-nav-decision-dot`)을 단다. 결정이 딸린 결재가 있다는 신호만 준다.
- `Sidebar.tsx`·`ShellStateProvider.tsx` 는 `src/components/app/*` — **UI 위험 파일**이다. `ui/<주제>` 브랜치 + Preview 확인
  (CLAUDE.md 「브랜치」). 이 변경은 스테이징 URL 에서 눈으로 확인한다.

## 8. 권한

| 경로 | 클라이언트 | 관문 |
|---|---|---|
| 쓰기 — 보고 insert | service_role(`route.ts:50`) | 보고 라우트의 점유·소유 판정(`route.ts:59-79`). 새 쓰기 경로는 없다. `agent_work_reports` 는 쓰기 정책이 없고 service_role 만 쓴다(0057:55-56, 77-89) |
| 읽기 — 허브·승인 큐 | service_role(`agentHub.ts:1-2`) | 허브 페이지 가드(종전과 같다) |
| 읽기 — Task 사이드바 | 세션 | `requireProjectMember`(`agentWork.ts:332`) + RLS `read_agent_work_reports`(0057:69-75) |
| 읽기 — 좌석표 수 | service_role | 좌석표 조회의 기존 범위(접근 가능 프로젝트) |
| 읽기 — 상세 패널 목록(신규 액션) | 세션 | `requireProjectMember` + RLS. 새 service_role 경로를 만들지 않는다 |
| 읽기 — 결재 배지 수 | service_role | `agentApprovals.ts:32-49` 의 기존 판정(비관리자·로스터 없음은 0). 결정 수는 이미 고른 승인 가능 주문에서만 센다 — 남의 프로젝트 수를 흘리지 않는 성질을 잇는다 |
| 에이전트 API GET | service_role | PAT 에만 `decisions` 노출(`evidence` 와 같다) |

0057 의 `grant select on table public.agent_work_reports to authenticated`(0057:88)는 table-level 이라 새 컬럼도 authenticated
select 대상이 된다. 결정 본문은 같은 프로젝트 구성원이 이미 읽는 `summary` 와 같은 등급의 정보라 추가 제한을 두지 않는다.

## 9. 반영 순서

1. 마이그레이션 커밋(단독) → `staging:sync` → `db:apply --target staging` → 검증(CHECK 위반 insert 거부, 생성 컬럼, rollback 왕복).
2. 서버·화면 코드 커밋 → staging. 사이드바는 `ui/` 브랜치를 거친다.
3. CLI·스킬 문서 커밋 → staging.
4. 운영은 별도 지시. 그때도 **`db:apply --target prod` 먼저, main 머지 나중**이다. 코드가 먼저 나가면
   `fetchAgentHubRows` 의 보고 select(`agentHub.ts:42`)가 없는 컬럼 오류로 throw 하고(`must`, 17-20행) 에이전트 화면 전체가
   죽는다. 보고 라우트 insert 도 모든 completion 에서 500 이 난다.
5. dflow-kit 재빌드는 운영 반영 뒤 별도(구 서버에 새 CLI 를 붙여도 §4.3 대로 경고로 끝나지만 순서를 지킨다).

## 10. 에러 처리

- **모름을 0건으로 보이지 않는다.** `null`(미제출)·형식 오류·조회 실패는 각각 다른 문구로 보이고, 어느 것도 "결정 없음" 으로
  그리지 않는다. 0건은 `[]` 가 명시될 때만이다.
- 허브·좌석표 조회 실패는 종전처럼 throw 한다(`agentHub.ts:1-2`). 새 필드 때문에 조회를 부분 성공으로 바꾸지 않는다.
- 결재 배지의 결정 수 조회만 실패하면 건수는 보이고 `decisions: null` → 툴팁 `확인 필요 결정 수 조회 실패`, 로그. 셸 전체를
  죽이지 않는 기존 규칙(`shell/route.ts:29-33`)을 잇되 0으로 위장하지 않는다.
- 보고 라우트: 형식 오류 400(보고 안 됨), 저장 실패 500(종전 `route.ts:97-100`). 검증을 통과한 결정은 보고 행과 한 insert 라
  "보고는 됐는데 결정만 빠진" 반쪽 상태가 없다.
- CLI: 선검사 실패 exit 2(보고 안 됨 — 워커가 고쳐 재시도), 구 서버 경고는 exit 0(보고는 됐다).

## 11. 결정별 수락/반려 — 이번에 넣지 않는다

넣으려면 필요한 것: 판정 테이블 `(report_id, key, action, note, reviewed_by, reviewed_at)` + RLS·rollback, 서버 액션과 가드
(승인·반려 자격 판정을 결정 단위로), 승인 큐·사이드바의 결정별 버튼, "결정 하나라도 반려면 주문 반려" 같은 주문 판정과의 결합
규칙, 재작업 워커가 결정별 판정을 읽는 규칙(worker-prompt·dev-discipline)과 API 필드. 이 과제 전체와 맞먹는 양이고, 주문 판정과의
결합 규칙은 사용자 결정이 필요하다.

지금 필요한 일(결정을 보고 전체를 반려하면서 어느 결정 때문인지 알리기)은 `key` 와 반려 사유 안내 문구(§7.1), 재작업 워커가
읽는 `GET /work/{id}` 의 `decisions`·`review_note`(§4.2)로 된다. 결정 본문은 jsonb 에 불변으로 남으므로 판정 테이블은 나중에
`key` 로 붙이면 된다.

## 12. 시험

| 층 | 파일 | 내용 |
|---|---|---|
| 도메인 | `tests/domain/agent-work.test.ts` | `validateDecisions`: 상한 경계(20/21건, 문자열 길이, 선택지 1·2·6·7개), `chosen` 범위·정수, `key` 형식·중복, 알 수 없는 필드, trim. `parseDecisions`: null → none, 배열 → ok, 깨진 항목 → invalid |
| 라우트 | `tests/agent/report-route.test.ts` | 필드 없음 → insert 에 `decisions` 없음·응답 `decisions_recorded:null`. `[]`·N건 저장과 응답 수. progress+decisions 400, 레거시+decisions 400, 형식 오류 400 이 DB 접근 전. completion 전이 실패 cleanup 은 종전 시험 유지. 알림 detail 문구 |
| 라우트 | `tests/agent/write-routes-pat.test.ts` 또는 GET 시험 | PAT `reports[].decisions` 노출, 레거시 비노출 |
| 마이그레이션 | `tests/migrations/0102-agent-report-decisions.test.ts` | 배열 아닌 값·21건·progress 행에 decisions → CHECK(23514) 거부(생성식 오류 22023 이 아님을 단정). `decision_count` 가 null/0/N. rollback 왕복 |
| 허브 | `tests/domain/agent-hub.test.ts` | 큐 항목이 최신 completion 의 결정 상태(none/ok/invalid)를 싣는다 |
| 결재 수 | `tests/data/agent-approvals.test.ts` | 승인 가능 주문의 최신 completion 만 합산. 비관리자·타 서브트리 결정은 세지 않음. 결정 수 조회 실패 → `decisions:null`, 건수 유지 |
| 좌석표 | `tests/domain/seatmap*.test.ts` | `decisionCount` 가 `reported` 에서만, 최신 completion 값 |
| 화면 | `tests/components/` 새 `decision-list.test.tsx`, `agents-seat.test.tsx`, WbsSpecPanel 시험 | 택함 강조·다른 선택지·근거·반려 시 방향, `null`·invalid 문구, 0건은 그리지 않음, 칩 표시 조건 |
| CLI | `tests/skills/` 새 `dflow-done-decisions.test.ts`(스텁 서버 — `dflow-claim-identity.test.ts` 방식) | 플래그 순서 무관, 선검사 실패 exit 2 가 네트워크·push 확인 전, 본문에 `decisions` 실림, 응답에 `decisions_recorded` 없으면 stderr 경고·exit 0, 접미사 N 불일치 경고, `--decisions` 없으면 본문에 키 없음. 쉘 상한 상수 = `agentWork.ts` 상수 대조 |
| 문서 | `tests/skills/worker-decide-and-notify.test.ts` | worker-prompt·dflow-dev 에 `--decisions`·`decisions.json`·0건 `[]` 규칙이 있는지 |
| 쉘 문법 | `tests/skills/shell-syntax.test.ts` | 기존 그대로 통과 |
| E2E | ego-browser, 스테이징 | 스테이징 주문 하나에 결정 2건 completion → 승인 큐 카드·Task 사이드바·오피스 칩과 상세·사이드바 점과 툴팁을 눈으로 확인. 결정 없는 보고(`[]`)와 구 CLI 보고(`null`)도 한 건씩 |

## 13. 범위 밖

- 결정별 수락/반려(§11).
- 옛 보고의 요약 접미사를 파싱해 `decisions` 를 소급해 채우기.
- progress 보고의 결정, 레거시(v1) 경로의 결정.
- 오피스 말풍선 변경, 팀장(`/dflow-team`)의 결정 집계 방식 변경(`.result` 의 `(결정 N건)` 을 그대로 읽는다).
- 결정 단위 검색·통계 화면.
- main·운영 DB·dflow-kit 반영(별도 지시).

## 14. 미결

1. **알림 문구**: `work.reported` 알림 detail 에 결정 수를 싣는 것(§4.1)이 알림함에서 충분한지, 결정이 있을 때 별도 알림 유형이
   필요한지. 이 설계는 문구만 바꾼다.
2. **승인 버튼 마찰**: 결정이 딸린 보고의 승인을 한 번 더 확인시킬지(예: "결정 N건을 읽었습니다" 체크). 이 설계는 넣지 않는다 —
   펼친 목록과 칩으로 충분한지 스테이징에서 본 뒤 정한다.
3. **상한 값**: 20건·300/200/1000/500자는 704dc2ff 이후 실제 design.md 절 몇 개로 잰 값이 아니다. 착수 때 최근 워커 산출물
   design.md 에서 최대치를 재어 조정한다.
4. **supervised `[]` 규칙**: 사람과 대화로 정한 결정도 승인자(다른 사람일 수 있다)에게 보일 가치가 있는지. 이 설계는 `[]` 로 둔다.
