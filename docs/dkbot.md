# DK Bot — AI 챗봇 (메뉴 인식형 v2 + 기존 pgvector RAG)

우하단 DK Bot 위젯은 두 경로를 사용합니다. 메뉴 인식형 v2는 현재 화면·선택 항목·필터를
바탕으로 WBS·주간업무·회의·근태·공지·회의록·칸반·대시보드·멤버·설정 10개 도메인을 읽고
출처와 기준 시각을 함께 표시합니다. 미지원 질문(전사 포트폴리오·팀별 진척 등)과 v2 비활성
상태는 기존 WBS 중심 pgvector RAG로 자동 복귀합니다.
LLM 계층은 **제공자 비종속(provider-agnostic)** 구조입니다.

## 동작 방식

### 메뉴 인식형 v2

```
질문 + PageContextV1 → 인증/허용 프로젝트 확정 → 결정형 라우터
  → 메뉴별 strict Repository/읽기 도구(최대 4개 병렬)
  → Evidence Pack → 결정형 근거 답변(기본) / LLM 합성·검증(실험적 opt-in)
  → NDJSON 답변 + 출처 + 기준 시각 + 후속 대화 상태
```

- 지원 도구 20종: WBS 검색·상세·의존성·변경 이력·첨부 metadata(5), 주간 시트·주차 비교(2),
  프로젝트 회의·상세·전역 내 회의(3), 근태 기간·팀·유형(1), 공지 목록·본문 검색(2),
  회의록 검색·상세(2), 칸반 뷰 집계(1), 대시보드 요약(1), 멤버 목록·팀 워크로드(2),
  안전한 프로젝트 설정(1).
- 쓰기 명령은 기존 Action Bot 확인 카드만 사용합니다. v2 도구는 모두 `*:read` capability입니다.
- 근태 메모, 참석자 이메일, Storage 경로·signed URL, 환경변수·키는 조회 계약에서 제외합니다.
- 정상 0건과 DB 실패를 구분하며, 도구/LLM 실패 시 조회된 근거만 결정형으로 표시합니다.
- 멤버 워크로드는 개인 담당 스키마가 없어 **팀 단위 집계**로만 답하고 그 사실을 항상 명시합니다.
- 전사 포트폴리오·팀별 진척 같은 나머지 질문은 기존 `/api/chat/stream`으로 폴백합니다.

**출처 딥링크 계약** — 답변 출처 클릭 시 해당 화면이 선택·필터 상태를 복원합니다:
WBS `?focus={itemId}` · 주간 `?week=` · 회의/내 회의 `?focus={meetingId}&date=YYYY-MM-DD` ·
근태 `?from&to&team&type`(단일 type만) · 공지 `?focus={id}` · 멤버 `?team=` ·
칸반 `?view=phase|owner|status&team=` · 회의록 `/minutes/{id}`.

활성화는 서버 환경변수로 명시합니다. 기본값은 안전하게 비활성입니다.

```env
CHAT_V2_ENABLED=true
# 선택적 실험 기능. 미설정/false이면 아래 LLM 합성을 호출하지 않습니다.
# CHAT_V2_LLM_SYNTHESIS_ENABLED=true
# 선택적 실험 기능. 모호하거나 교차 메뉴 질문에 제한된 2단계 도구 플래너(LLM)를 시도합니다.
# CHAT_V2_PLANNER_ENABLED=true
```

즉시 롤백하려면 값을 `false`로 바꾸거나 제거합니다. UI가 v2의 `501` 응답을 확인해 기존
스트림을 다시 호출합니다.

v2 답변의 운영 기본값은 조회된 Evidence Pack을 그대로 인용하는 **검증 가능한 결정형 답변**입니다.
`CHAT_V2_LLM_SYNTHESIS_ENABLED=true`는 표현을 자연스럽게 다듬는 **실험적 선택사항**이며,
활성화해도 존재하지 않는 출처나 근거 없는 숫자·날짜가 감지되면 결과를 폐기하고 결정형 답변으로
돌아갑니다. 합성은 검증 후 전송(버퍼링)이라 첫 토큰 지연이 합성 시간만큼 늘어납니다 —
"첫 토큰 p95 3초" 목표는 합성 비활성(결정형) 기준입니다. 이 플래그는 기존
`/api/chat`·`/api/chat/stream`의 LLM 동작에는 영향을 주지 않습니다.

`CHAT_V2_PLANNER_ENABLED=true`는 결정형 라우터가 레거시로 넘기려는 질문 중 교차 메뉴
결합(명시 도메인 2개 이상) 또는 미지원 페이지 문맥일 때만 §7.3 계약의 **제한된 2단계
플래너**(도구 ≤4, 단계 ≤2, binding은 앞 단계 결과 ID·날짜만)를 한 번 시도합니다. 계획
생성·검증에 실패하면 추가 오류 노출 없이 기존 501 폴백으로 수렴합니다.

### 기존 WBS RAG

```
사용자 질문 → /api/chat (인증) → 의도 분류
   ├─ 구조화 질의 (정확한 숫자): WBS 롤업/주간모델 재사용 → 작업수·공정률·지연·완료·팀별
   ├─ 의미검색 (pgvector): 질문 임베딩 → match_wbs_documents → 관련 작업 top-K
   └─ 답변 생성: LLM(Gemini)이 위 [데이터]만 근거로 작성 / 키 없으면 결정형 템플릿
```

- **숫자는 구조화 질의에서** 나오므로 LLM이 수치를 지어내지 않습니다(환각 방지).
- **임베딩/LLM 키가 없어도** 봇은 결정형 답변으로 끊김 없이 동작합니다.

## 설정 (3단계)

### 1) 마이그레이션 적용 (pgvector)

`supabase/migrations/0010_dkbot_pgvector.sql` 를 적용합니다(`vector` 확장, `wbs_embeddings`
테이블, HNSW 인덱스, `match_wbs_documents` RPC 생성). 셋 중 하나:

- **대시보드(가장 빠름):** SQL Editor 에 위 파일 내용을 붙여넣고 Run.
- **Supabase CLI:** `supabase link --project-ref rglfgrwwwwdqejohdnty` (DB 비밀번호 입력) → `supabase db push`.
- **psql 스크립트:** `SUPABASE_DB_URL='postgresql://…' bash scripts/apply-dkbot-migration.sh`.

> 적용은 추가(additive)·멱등적입니다(`create … if not exists`, `create or replace`) — 기존
> 테이블/데이터는 건드리지 않습니다. service_role 키로는 DDL 을 실행할 수 없어 위 경로가 필요합니다.

### 2) 환경변수

`.env.local` 에 Google AI Studio 무료 키 추가 (`.env.local.example` 참고):

```
GEMINI_API_KEY=...
```

> 이 키 하나가 **서버에만** 저장되어, 웹에 접속하는 모든 사용자의 질의가 이 키로 처리됩니다.
> 사용자는 별도 키가 필요 없습니다. 무료 티어 한도 초과 시 자동으로 결정형 답변으로 폴백합니다.

### 3) 임베딩 색인 생성

- WBS 엑셀을 **가져오면 자동 색인**됩니다(`/api/import` 후 best-effort).
- 수동 재색인: **설정 화면 → "DK Bot 의미검색 색인" → `AI 색인 재생성` 버튼**(pmo_admin),
  또는 `POST /api/chat/reindex { "projectId": "..." }` / 서버 액션 `reindexProjectAction(projectId)`.
- **색인 신선도**: 화면에서 WBS를 편집하면 색인이 자동 갱신되지 않습니다(무료 임베딩 쿼터 보호). 대신
  설정 카드의 배지가 마지막 색인 이후 WBS 변경을 감지해 **재색인 필요**를 표시하며, 버튼 한 번으로 갱신합니다.

## API

| 메서드 | 경로 | 설명 | 권한 |
|--------|------|------|------|
| `GET`  | `/api/chat/context?projectId=` | 환영/프로액티브 인사이트 부트스트랩 | 인증 |
| `POST` | `/api/chat` | 질의응답(JSON, 비스트리밍) `{ projectId, message, history }` | 인증 |
| `POST` | `/api/chat/stream` | 질의응답(text 토큰 스트리밍) — UI 기본 | 인증 |
| `POST` | `/api/chat/v2/stream` | 메뉴 문맥 기반 NDJSON 스트림. `CHAT_V2_ENABLED=true` 필요 | 인증 |
| `POST` | `/api/chat/reindex` | 의미검색 색인 재생성 `{ projectId }` | pmo_admin |
| `GET`  | `/api/chat/health` | 진단 — 키 설정/마이그레이션 적용 상태 | pmo_admin |
| `POST` | `/api/chat/index/worker` | Phase 2 증분 색인 워커/정합성/백필 실행 | 이중 게이트* |

\* `CHAT_V2_INDEX_WORKER_ENABLED=true` + `x-cron-secret` 헤더가 `CHAT_V2_INDEX_CRON_SECRET`과
일치해야 하며, 둘 중 하나라도 미설정이면 라우트가 404입니다. body는
`{ mode: 'worker'|'consistency'|'backfill', domain?, projectId?, dryRun?, batchSize? }`.
**cron 연결·0031/0033 적용 전에는 호출할 일이 없습니다.**

답변은 기본적으로 `/api/chat/stream` 으로 **토큰 스트리밍**됩니다(타이핑되듯 출력). LLM 키가 없으면
결정형 답변이 단일 청크로 전송됩니다. `/api/chat`(JSON)은 비스트리밍 폴백/외부 호출용으로 유지됩니다.

## 주요 파일

- UI: `src/components/chat/DkBot.tsx`(스트리밍), `BearMascot.tsx` (`(app)/layout.tsx` 에 마운트)
- 설정 색인 버튼: `src/components/settings/ReindexButton.tsx`
- 분석(순수): `src/lib/ai/analytics.ts` · 의도분류: `src/lib/ai/intent.ts`
- 어댑터: `src/lib/ai/{provider,llm,embeddings}.ts` (`llm.ts` = 비스트리밍 + 스트리밍)
- RAG: `src/lib/ai/{knowledge,ingest,retrieve,answer}.ts` (`answer.ts` = `answerQuestion` + `streamAnswer`)
- 라우트: `src/app/api/chat/{route,stream,context,reindex,health}/route.ts`
- v2 문맥/UI: `src/components/chat/BotPageContextProvider.tsx`, `DkBot.tsx`, `chatStream.ts`
- v2 서버: `src/app/api/chat/v2/stream/route.ts`, `src/lib/ai/chat/*`
  (`planner.ts`=제한된 2단계 플래너, `deep-links.ts`=출처 딥링크 단일 정본)
- 접근 범위: `src/lib/authz/accessScope.ts` (세션→허용 프로젝트 확정, MySQL 전환 교체 단위)
- 읽기 경계: `src/lib/ai/tools/*`, `src/lib/repositories/*`
- 차세대 검색 경계: `src/lib/ai/index/*` (`worker/consistency/backfill/shadow/content/enqueue`
  포함 — 답변 경로 미연결, 보호 라우트 `/api/chat/index/worker`에서만 소비)
- 헬스/색인 신선도: `src/lib/ai/health.ts` (설정 화면 배지 + `/api/chat/health`)
- 마이그레이션: `0010_dkbot_pgvector.sql`(기존 RAG), `0031_ai_knowledge_index.sql`(Phase 2 검색 기반),
  `0032_attendance_member_project_integrity.sql`(근태 프로젝트 무결성),
  `0033_ai_index_worker.sql`(워커 claim/lease·generation CAS RPC — 0031 이후 적용) · 적용 스크립트:
  `scripts/apply-dkbot-migration.{sh,mjs}` (`mjs`는 0010 전용이며 `SUPABASE_DB_URL` + `npm i --no-save pg` 필요)

> `supabase/migrations/0031_ai_knowledge_index.sql`·`0033_ai_index_worker.sql`은 Phase 2의
> 일반 문서·증분 색인 워커 기반입니다. 현재 v2 메뉴는 전부 실시간 구조화 조회로 동작하므로
> **둘 다 적용하지 않아도 v2가 완전히 동작합니다**. 워커·cron·백필·shadow 검색을 시작할 때만
> 0031 → 0033 순으로 적용하세요(벡터 검색 어댑터는 0031의 확장된 `match_ai_documents` 반환
> 계약을 요구합니다). 그 전에는 기존 `wbs_embeddings`·`minute_embeddings`를 삭제하지 마세요.
>
> 워커 운영: 워커는 `claim_ai_index_jobs`(FOR UPDATE SKIP LOCKED + lease 만료 회수)로 작업을
> 원자 선점하고, 처리 중 같은 엔티티의 새 변경이 들어오면 `generation` CAS가 완료를 거부해
> 자동 재처리합니다(구세대 upsert가 최신 delete를 되살리지 못하는 tombstone 규칙 포함).
> 실패는 지수 백오프 최대 5회 후 `dead_letter`로 남습니다 — 복구는 같은 엔티티를 다시
> enqueue(`upsert_ai_index_jobs`)하면 pending 복귀+generation 증가로 재실행됩니다.
> 업무 쓰기 경로 enqueue 배선(`enqueueIndexMutationBestEffort`)은 헬퍼만 존재하며
> `CHAT_V2_INDEX_ENQUEUE_ENABLED` 기본 OFF입니다.

근태 데이터는 `supabase/migrations/0032_attendance_member_project_integrity.sql`을 적용하면
신규 쓰기부터 멤버와 근태 행의 프로젝트 일치를 DB가 강제합니다. 제약은 기존 데이터를 막지 않도록
`NOT VALID`로 추가되므로, 아래 조회 결과를 먼저 정리한 뒤 제약을 검증합니다.

```sql
select ar.id, ar.project_id as attendance_project_id, pm.project_id as member_project_id
from public.attendance_records ar
join public.project_members pm on pm.id = ar.member_id
where ar.project_id <> pm.project_id;

alter table public.attendance_records
  validate constraint attendance_member_project_fk;
```

챗봇 Repository는 0032 적용 여부와 무관하게 근태와 멤버를 프로젝트 조건으로 각각 읽고,
불일치·누락이 있으면 해당 조회 전체를 차단합니다.

## 모델

- LLM: `gemini-3.5-flash`(기본, `GEMINI_MODEL`로 변경). 스트리밍 지원. 2.x 세대는
  `thinkingBudget:0`, 3.x 세대는 `thinkingLevel:'low'`로 thinking 을 억제한다(세대별 자동 분기).
  ⚠ `gemini-2.5-flash` 는 2026-10-16 셧다운, `gemini-2.0-flash` 는 이미 종료, Pro 계열은
  무료 쿼터 0(429) — `GEMINI_MODEL` 오버라이드로도 지정하지 말 것.
- **429 내성(3중 방어)**: 무료 티어 분당 한도(3.5-flash RPM 20)에 걸리면 ① 서버가 알려준
  지연(≤6초)만큼 기다렸다 1회 재시도 → ② 폴백 모델 체인
  `gemini-3.1-flash-lite → gemini-2.5-flash-lite`(모델별 쿼터 버킷이 분리돼 있어 주 모델이
  막혀도 통과, `GEMINI_FALLBACK_MODELS`로 변경) → ③ 그래도 실패하면 결정형 답변 + 원인 안내.
- **키워드 정확 일치 검색**: "tft 단어가 들어간 항목", "'기준정보' 포함된 작업" 류 질문은
  임베딩 의미검색이 정확 문자열 일치를 보장하지 못하므로, 질문에서 키워드를 추출해
  팩트시트를 직접 필터한 `[키워드 정확 일치]` 블록을 LLM 근거로 제공한다(0건도 명시 →
  환각 방지). LLM 이 죽어도 결정형 답변이 이 목록으로 완전한 답을 준다.
- 임베딩: `gemini-embedding-001`(기본). 기본 3072차원을 `outputDimensionality=768`로 축소해
  `vector(768)` 컬럼에 맞춤(pgvector HNSW 인덱스는 2000차원 이하만 지원). `embedContent`(단건)
  을 제한 동시성으로 호출(이 모델은 동기 `batchEmbedContents` 미지원).
- 키의 프로젝트에서 사용 가능한 모델은 `GET /v1beta/models` 로 확인. `generateContent` 가
  429(쿼터)면 봇은 자동으로 결정형 답변으로 폴백한다(임베딩은 별도 쿼터).

## 제공자 교체

`AI_PROVIDER=openai` + `LLM_BASE_URL`/`LLM_API_KEY`/`LLM_MODEL` 로 OpenAI 호환
엔드포인트(Groq·OpenRouter·사내 LLM)로 전환. 임베딩 차원을 바꾸면 마이그레이션의
`vector(768)` 차원도 함께 맞춰야 합니다.

## AI PM Assistant — 주간 브리핑 · 위험 신호 AI 해설 (Phase 2)

대시보드 "AI 브리핑 & 위험 신호" 통합 카드와 주간보고 PPT의 AI 코멘트 슬라이드.
LLM 호출은 전부 `generateAnswer`(llm.ts) 단일 진입점 경유 — 429 삼중 방어를 상속한다.

| 표면 | 트리거 | LLM 콜 | 캐시 키 |
|---|---|---|---|
| 주간 브리핑(카드 상단) | **버튼 온디맨드 전용** — 열람 자동 생성 절대 금지(쿼터 보호 핵심) | 캐시 미스 시 1 | `project_ai_briefs` kind=`weekly`, cache_key=base_date, input_hash=팩트 해시 |
| 위험 신호 목록(카드 중단) | 항상(결정형) | **0** | — (라이브 계산, riskSignals.ts) |
| 신호별 AI 해설(카드 하단) | 열람 시 **지문 stale일 때만** self-heal(D2) | 지문 변경당 1 | kind=`risk`, cache_key=`''`, input_hash=신호 지문(정수 화이트리스트) |
| PPT `ai=1` / 모달 신선도 조회 | 다운로드/모달 열림 | **0** (캐시 읽기, 미스·stale=409) | weekly 행 재사용 |

- 파이프라인: `projectFacts.ts`(공용 로더) → `brief.ts`(팩트 조립·프롬프트·파싱·**수치 검증기**) /
  `risk-brief.ts`(signalId 검증 파싱) → `ensure.ts` 게이트(쿨다운 60s + in-flight dedupe + never-throw)
  → service_role upsert(`onConflict project_id,kind,cache_key`).
- 수치 검증기(verifyBriefNumbers): 산출 텍스트의 %/%p/건 토큰을 팩트 화이트리스트와 대조해
  불일치 줄 제거+로깅. 제거 로그(`[brief] 수치 검증 제거`)가 잦으면 프롬프트 보강 검토.
- 신선도 판정: weekly=팩트 해시(같은 날 WBS 편집 시 stale), risk=신호 지문(fingerprint —
  정수화 지표만이라 단순 날짜 경과로는 불변). 'none' 행 = 분석됨·서술 없음(행 없음=미생성/실패).
- PPT: `/api/report?format=pptx&ai=1` — 신선한 weekly 캐시 필수, 아니면 **409**(조용한 구식
  코멘트 금지). 렌더는 `aiComment.ts`(briefToExtraSlide) → `templateFill` `opts.extra`
  (미지정 시 기존 출력 바이트 불변).
- 마이그레이션: 0030 `project_ai_briefs`(kind 판별자 통합 테이블) — 프로덕션 적용 2026-07-18,
  health(`dkbotHealth.briefs`)가 스키마 부재를 진단.
- 실패 정책: 절대 throw 금지, 로그+행 미기록(재시도 신호), UI는 정직한 강등 문구 —
  결정형 신호 목록은 LLM 실패와 무관하게 항상 유효.
