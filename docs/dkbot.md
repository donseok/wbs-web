# DK Bot — AI 챗봇 (pgvector RAG)

prj-manager의 "DK Bot"과 동일한 우하단 챗봇 위젯. 프로젝트/작업(WBS) 데이터에 대해
한국어로 질의응답하며, **제공자 비종속(provider-agnostic)** 구조라 무료로 동작하고
필요하면 다른 LLM으로 환경변수 한 줄만 바꿔 교체할 수 있습니다.

## 동작 방식

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
| `POST` | `/api/chat/reindex` | 의미검색 색인 재생성 `{ projectId }` | pmo_admin |
| `GET`  | `/api/chat/health` | 진단 — 키 설정/마이그레이션 적용 상태 | pmo_admin |

답변은 기본적으로 `/api/chat/stream` 으로 **토큰 스트리밍**됩니다(타이핑되듯 출력). LLM 키가 없으면
결정형 답변이 단일 청크로 전송됩니다. `/api/chat`(JSON)은 비스트리밍 폴백/외부 호출용으로 유지됩니다.

## 주요 파일

- UI: `src/components/chat/DkBot.tsx`(스트리밍), `BearMascot.tsx` (`(app)/layout.tsx` 에 마운트)
- 설정 색인 버튼: `src/components/settings/ReindexButton.tsx`
- 분석(순수): `src/lib/ai/analytics.ts` · 의도분류: `src/lib/ai/intent.ts`
- 어댑터: `src/lib/ai/{provider,llm,embeddings}.ts` (`llm.ts` = 비스트리밍 + 스트리밍)
- RAG: `src/lib/ai/{knowledge,ingest,retrieve,answer}.ts` (`answer.ts` = `answerQuestion` + `streamAnswer`)
- 라우트: `src/app/api/chat/{route,stream,context,reindex,health}/route.ts`
- 헬스/색인 신선도: `src/lib/ai/health.ts` (설정 화면 배지 + `/api/chat/health`)
- 마이그레이션: `supabase/migrations/0010_dkbot_pgvector.sql` · 적용 스크립트: `scripts/apply-dkbot-migration.{sh,mjs}` (`mjs` 는 `SUPABASE_DB_URL` + `npm i --no-save pg` 필요)

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
