# 프로젝트 Wiki 검색 전용 전환 — 1단계 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 프로젝트 Wiki 화면을 검색 하나로 줄이고, 회의록·이슈·WBS·공지 원문을 의미+어휘 두 다리로 찾을 수 있게 만든다.

**Architecture:** 이미 설치돼 있으나 꺼져 있는 RAG 색인 인프라(`ai_documents` · `/api/chat/index/worker` · `hybrid.ts`)를 켜고, 없는 조각 넷(어휘 다리 `pg_trgm`, 이슈 로더, 문서 접기, 검색 화면)을 채운다. `wiki_items`는 98.7%가 archived라 코퍼스에서 사실상 제외하고 원천 데이터를 직접 색인한다.

**Tech Stack:** Next.js 15 App Router · Supabase(Postgres 17 + pgvector + pg_trgm) · Gemini `gemini-embedding-001`(768차원) · vitest

**Spec:** `docs/superpowers/specs/2026-08-14-wiki-search-only-design.md`

## Global Constraints

- **원천 데이터에 쓰지 않는다.** 회의록·이슈·WBS·공지는 전부 읽기 전용. 이 계획에 원천 테이블 `update`/`delete`/`insert`는 없다.
- **`git add -A` 금지.** 항상 파일명을 명시해 stage 한다(병렬 세션·`.env` 혼입 방지).
- **마이그레이션과 코드를 같은 커밋에 담지 않는다.** `supabase/migrations/*`는 별도 커밋. pre-push 훅 G1이 막는다.
- **0083은 0072+ 범위라 G4가 막는다.** 스테이징 리허설 → 검증 → `Staging-verified:` 트레일러 → staging push → prod 적용 → main push.
- **새 마이그레이션에는 `_rollback.sql`을 함께 만든다.**
- 커밋 메시지는 한국어. "무엇"보다 "왜".
- 임베딩 차원은 **768 고정**(`ai_documents.embedding_dimensions = 768` CHECK 제약).
- 청커는 기존 `md1500-v1`(1,500자)을 바꾸지 않는다. 바꾸면 기존 `content_hash` 계약이 깨진다.
- **인가가 백필보다 먼저다.** `0031:67-72`이 정한 게이트다 — "정렬 없이 백필하면 색인 사본이 원본보다 넓게 노출된다".
- 다음 빈 마이그레이션 번호는 **0083**(0081·0082는 병렬 세션이 점유 — 2026-08-14 실측).

## 착수 전 실측값 (2026-08-14 운영 DB)

| 항목 | 값 |
|---|---|
| `ai_documents` 행 | 0 |
| `ai_index_jobs` pending | 96 (minute upsert 50 + delete 46, 전부 2026-07-27) |
| `minutes` | 67 (project_id null 3건) |
| **`minutes` 스코프 skew 대상** | **47건 (70%)** — `project_id`는 있는데 `meetings.project_id`는 null |
| `issues` / `wbs_items` / `announcements` | 68 / 674 / 5 |
| `wiki_items` | 2,299 (archived 2,268 · 살아있는 31) |
| `wiki_topics.body_md` 있는 행 | 0 |

---

## File Structure

**신규**

| 파일 | 책임 |
|---|---|
| `supabase/migrations/0083_ai_documents_lexical.sql` | `pg_trgm` 확장 · GIN 인덱스 · `match_ai_documents_lexical` RPC |
| `supabase/migrations/0083_ai_documents_lexical_rollback.sql` | 위의 역연산 |
| `src/lib/domain/searchFusion.ts` | RRF 융합 + 청크→문서 접기. 순수 함수, DB·네트워크 무의존 |
| `src/lib/ai/index/lexical.ts` | 어휘 다리 어댑터 — `match_ai_documents_lexical` 호출 |
| `src/app/api/wiki/search/route.ts` | 검색 API — 인가 → 두 다리 → 융합 |
| `src/components/wiki/WikiSearch.tsx` | 검색 화면 (검색창·결과·필터 칩) |
| `scripts/index-backfill.mjs` | 로컬 백필 러너 (기존 `mode:'backfill'` 호출) |
| `scripts/search-eval.mjs` | 평가 세트 측정 |
| `tests/search/eval-set.json` | 질문·정답 쌍 |

**수정**

| 파일 | 무엇 |
|---|---|
| `src/lib/ai/chat/protocol.ts` | `BOT_DOMAINS`에 `issues`, `BOT_ENTITY_TYPES`에 `issue` |
| `src/lib/ai/index/content.ts` | `loadIssue` + `case 'issue'` |
| `src/lib/ai/index/backfill.ts` | `minutes` 스코프 skew 수정 + `issues` 소스 추가 |
| `src/app/(app)/p/[projectId]/wiki/page.tsx` | 접근 검증 추가 + `WikiSearch` 렌더로 교체 |
| `vercel.json` | 색인 워커 크론 등록 |

**손대지 않는 것** — `src/lib/ai/wiki-ingest.ts` · `wiki-catalog.ts` · `wiki-saturation.ts` · `wiki_*` 테이블 · 옛 wiki 컴포넌트 파일(2단계에서 삭제).

---

## Task 1: 착수 전 실측 (완료 — 큐 삭제는 철회)

**Files:**
- 코드 변경 없음. 실측 기록만.

**Interfaces:**
- Produces: `CHAT_V2_INDEX_*` 3종의 운영 값과 큐의 실제 상태. Task 9·11 이 이 값을 근거로 움직인다.

### 실측 결과 (2026-08-14, 운영 `rglfgrwwwwdqejohdnty`)

**Vercel 운영 env**

| 변수 | 상태 |
|---|---|
| `CRON_SECRET` | **있음** (19일 전 설정, `inbox-retention` 용) — Task 9 의 크론 어댑터가 재사용 |
| `CHAT_V2_INDEX_WORKER_ENABLED` | 없음 → 워커 라우트 404 |
| `CHAT_V2_INDEX_CRON_SECRET` | 없음 → 404 |
| `CHAT_V2_INDEX_ENQUEUE_ENABLED` | 없음 → TS enqueue 헬퍼 no-op |

**큐 상태 — 스펙·계획의 서술이 틀렸다**

스펙 §2.2 와 계획 초판은 "pending 96건, 전부 2026-07-27 생성" 이라고 적었다. 실측은 다르다:

```
생성일 분포:  07-27  07-29  07-31  08-04  08-06  08-11  08-12  08-13
              7건    53건   14건   2건    1건    10건   8건    1건
```

**큐는 2026-08-13 까지 계속 쌓이고 있다.** TS `enqueue.ts` 호출부가 0건인데도 그렇다 —
**DB 레벨 RPC 가 큐를 채우기 때문이다.** 회의록 CRUD 전 경로가 이 함수들을 탄다:

```
queue_minute_ai_index_scope_change
archive_minute_with_wiki_retraction
update_minute_metadata_with_wiki_retraction
upsert_ai_index_jobs
```

`queue_minute_ai_index_scope_change` 는 `job_key = 'v1:{project}:minutes:minute:{id}'` 로
`on conflict (job_key) do update` 하는 **멱등 upsert** 다. `CHAT_V2_INDEX_ENQUEUE_ENABLED`
플래그는 이 경로를 전혀 게이팅하지 않는다.

**잡 96건의 정체**

| 잡 | 건수 | 현재 스코프와 일치 | 원본 회의록 존재 |
|---|---|---|---|
| `upsert` | 50 | **50 / 50** | 50 |
| `delete` | 46 | **0 / 46** (전부 옛 스코프) | 46 |

### Ruling: 큐를 삭제하지 않는다 (계획 초판의 Step 3·4 철회)

초판은 "옛 스코프로 큐잉된 것이라 폐기 후 백필이 새로 큐잉한다" 고 했다. 실측이 그 전제를 뒤집었다.

- `upsert` 50건은 **옛 스코프가 아니라 전부 현재 스코프와 일치**한다. 워커를 켜면 그대로 옳게
  색인된다. 지우면 그 정보만 잃는다.
- `delete` 46건은 옛 스코프가 맞지만 **그래서 무해하다.** 백필은 현재 스코프로 쓰므로 `job_key`
  가 달라 충돌하지 않고, 지울 대상인 옛 스코프 `ai_documents` 행은 애초에 존재하지 않는다
  (`ai_documents` 는 0건이다).
- `job_key` 멱등 upsert 라 백필이 같은 잡을 **덮어쓴다** — 중복도 순서 위험도 없다.
- 워커의 tombstone 규약(`generation` + complete CAS)이 이중 방어로 남아 있다.

따라서 **파괴적 운영 작업을 하지 않는 것이 옳다.**

- [ ] **Step 1: 위 실측이 여전히 유효한지 확인한다** (착수 시점에 다시)

```sql
select operation, count(*) n,
       count(*) filter (where j.project_id is not distinct from m.project_id) 현재스코프일치
from public.ai_index_jobs j left join public.minutes m on m.id::text = j.entity_id
group by 1;
```

Expected: `upsert` 의 현재스코프일치 = 전체, `delete` 의 현재스코프일치 = 0.
**다르면 멈추고 보고한다** — 그 사이 누가 워커를 켰거나 스코프가 또 바뀐 것이다.

- [ ] **Step 2: 이 실측을 스펙에 반영한다**

`docs/superpowers/specs/2026-08-14-wiki-search-only-design.md` §2.2 의 다음 두 문장을 고친다:
- "pending 96건 … 전부 2026-07-27 생성" → 실제 분포와 "DB RPC 가 계속 채운다" 로
- "enqueue 존재하나 호출부 0건" → "TS 헬퍼는 호출부 0건이나 **DB RPC 가 회의록 경로를 이미 큐잉한다**" 로

이 정정은 Task 10 의 범위도 줄인다 — 회의록은 이미 배선돼 있으므로 TS 배선이 필요한 것은
이슈·WBS·공지 셋뿐이다.

- [ ] **Step 3: 커밋**

```bash
git add docs/superpowers/specs/2026-08-14-wiki-search-only-design.md
git commit -m "docs: 색인 큐 실측 — DB RPC 가 이미 회의록을 큐잉하고 있었다

스펙은 pending 96건이 전부 2026-07-27 에 멈춘 것이라고 적었으나 실제로는
2026-08-13 까지 계속 쌓이고 있다. TS enqueue 헬퍼 호출부는 0건이 맞지만
queue_minute_ai_index_scope_change 등 DB RPC 가 회의록 CRUD 전 경로에서
job_key 멱등 upsert 로 큐를 채운다 — 플래그와 무관하다.

그래서 큐를 폐기하지 않는다. upsert 50건은 전부 현재 스코프와 일치해
워커를 켜면 그대로 옳게 색인되고, delete 46건은 옛 스코프라 지울 대상이
없어 무해하다."
```

---

## Task 2: 검색 인가 경계

**Files:**
- Create: `src/lib/domain/searchAccess.ts`
- Test: `tests/domain/search-access.test.ts`

**Interfaces:**
- Consumes: `AccessScope`(`@/lib/authz/accessScope`)
- Produces:
  ```ts
  export type SearchAccessDecision =
    | { ok: true; projectIds: string[] }
    | { ok: false; status: 403 | 503; reason: string }

  export function decideSearchAccess(
    requestedProjectId: string,
    scope: { ok: true; scope: { allowedProjectIds: string[] } } | { ok: false },
  ): SearchAccessDecision
  ```
  Task 8의 라우트가 이 함수를 쓴다.

`ai_documents`의 RLS는 `authenticated using (true)`이고 `match_ai_documents`는 `authenticated`
실행이 허용돼 있다. **DB는 프로젝트를 막지 않는다.** 비공개 프로젝트(0070)도 앱 판정 하나뿐이라,
이 함수가 유일한 관문이다. 순수 함수로 떼어내 테스트 가능하게 만든다.

- [ ] **Step 1: 실패하는 테스트를 쓴다**

```ts
// tests/domain/search-access.test.ts
import { describe, expect, it } from 'vitest'
import { decideSearchAccess } from '@/lib/domain/searchAccess'

const A = '11111111-1111-1111-1111-111111111111'
const B = '22222222-2222-2222-2222-222222222222'

describe('decideSearchAccess', () => {
  it('허용 목록에 있으면 그 프로젝트 하나만 통과시킨다', () => {
    expect(decideSearchAccess(A, { ok: true, scope: { allowedProjectIds: [A, B] } }))
      .toEqual({ ok: true, projectIds: [A] })
  })

  it('허용 목록에 없으면 403 — 비공개 프로젝트 유출 경로를 막는다', () => {
    const r = decideSearchAccess(B, { ok: true, scope: { allowedProjectIds: [A] } })
    expect(r.ok).toBe(false)
    expect(r).toMatchObject({ status: 403 })
  })

  it('허용 목록이 비면 403 — 빈 목록을 전체 허용으로 읽지 않는다', () => {
    expect(decideSearchAccess(A, { ok: true, scope: { allowedProjectIds: [] } }))
      .toMatchObject({ ok: false, status: 403 })
  })

  it('스코프 조회 자체가 실패하면 503 — 모르면 닫는다(fail-closed)', () => {
    expect(decideSearchAccess(A, { ok: false }))
      .toMatchObject({ ok: false, status: 503 })
  })

  it('요청 projectId 가 빈 문자열이면 403', () => {
    expect(decideSearchAccess('', { ok: true, scope: { allowedProjectIds: [A] } }))
      .toMatchObject({ ok: false, status: 403 })
  })
})
```

- [ ] **Step 2: 실패를 확인한다**

Run: `npx vitest run tests/domain/search-access.test.ts`
Expected: FAIL — `Cannot find module '@/lib/domain/searchAccess'`

- [ ] **Step 3: 최소 구현**

```ts
// src/lib/domain/searchAccess.ts

/**
 * 검색 요청의 프로젝트 접근 판정 — 이 검색의 유일한 관문이다.
 *
 * ai_documents 의 RLS 는 `authenticated using (true)` 이고(0031:74-79)
 * match_ai_documents 도 authenticated 실행이 허용돼 있다. 즉 DB 는 프로젝트를
 * 막지 않는다. 비공개 프로젝트(0070)도 RLS 잠금이 아니라 앱 판정 하나뿐이라,
 * 여기서 막지 못하면 projectId 를 아는 로그인 사용자에게 회의록 본문이 샌다.
 */
export type SearchAccessDecision =
  | { ok: true; projectIds: string[] }
  | { ok: false; status: 403 | 503; reason: string }

type ScopeInput =
  | { ok: true; scope: { allowedProjectIds: string[] } }
  | { ok: false }

export function decideSearchAccess(
  requestedProjectId: string,
  scope: ScopeInput,
): SearchAccessDecision {
  // 스코프를 못 읽었으면 모르는 것이다. 모르면 닫는다.
  if (!scope.ok) return { ok: false, status: 503, reason: 'ACCESS_SCOPE_UNAVAILABLE' }

  const requested = requestedProjectId.trim()
  if (!requested) return { ok: false, status: 403, reason: 'PROJECT_REQUIRED' }

  // 빈 허용 목록은 "전체 허용" 이 아니라 "아무것도 허용 안 됨" 이다.
  if (!scope.scope.allowedProjectIds.includes(requested)) {
    return { ok: false, status: 403, reason: 'PROJECT_FORBIDDEN' }
  }

  // 요청 하나만 넘긴다. 클라이언트가 보낸 목록은 어디에도 쓰지 않는다.
  return { ok: true, projectIds: [requested] }
}
```

- [ ] **Step 4: 통과를 확인한다**

Run: `npx vitest run tests/domain/search-access.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: 커밋**

```bash
git add src/lib/domain/searchAccess.ts tests/domain/search-access.test.ts
git commit -m "feat(search): 검색 프로젝트 접근 판정을 순수 함수로 분리

ai_documents 의 RLS 는 authenticated using (true) 라 DB 가 프로젝트를 막지
않는다. 비공개 프로젝트도 앱 판정 하나뿐이라 이 함수가 유일한 관문이다.
빈 허용 목록을 전체 허용으로 읽지 않도록 테스트로 못박았다."
```

---

## Task 3: 마이그레이션 0083 — 어휘 다리

**Files:**
- Create: `supabase/migrations/0083_ai_documents_lexical.sql`
- Create: `supabase/migrations/0083_ai_documents_lexical_rollback.sql`
- Test: `tests/migrations/ai-documents-lexical.test.ts`

**Interfaces:**
- Produces: RPC `match_ai_documents_lexical(p_query text, match_count int, p_project_ids uuid[], p_include_global boolean, p_domains text[], p_entity_types text[], p_index_version int)` — `match_ai_documents`와 같은 컬럼 집합에 `similarity float`를 반환한다. Task 7이 호출한다.

스테이징 실측(2026-08-14): `similarity()`는 길이 편향이 있어 랭킹에 못 쓴다. `word_similarity()`를 쓴다.
`gin_trgm_ops` GIN이 `ILIKE`와 `<%` 양쪽을 가속한다(cost 141.74 → 35.40).

- [ ] **Step 1: 계약 테스트를 쓴다**

```ts
// tests/migrations/ai-documents-lexical.test.ts
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(
  new URL('../../supabase/migrations/0083_ai_documents_lexical.sql', import.meta.url), 'utf8')
const rollback = readFileSync(
  new URL('../../supabase/migrations/0083_ai_documents_lexical_rollback.sql', import.meta.url), 'utf8')

describe('0083 어휘 검색 마이그레이션 계약', () => {
  it('pg_trgm 을 설치한다', () => {
    expect(migration).toMatch(/create extension if not exists pg_trgm/i)
  })

  it('gin_trgm_ops GIN 인덱스를 title 과 content 에 만든다', () => {
    expect(migration).toMatch(/using gin \(title gin_trgm_ops\)/i)
    expect(migration).toMatch(/using gin \(content gin_trgm_ops\)/i)
  })

  it('랭킹에 word_similarity 를 쓴다 — similarity 는 길이 편향이 있다', () => {
    expect(migration).toMatch(/word_similarity/)
  })

  it('결과 상한을 서버에서 강제한다 — LIMIT NULL 방지', () => {
    expect(migration).toMatch(/least\(coalesce\(match_count/i)
  })

  it('anon 에게 실행 권한을 주지 않는다', () => {
    expect(migration).toMatch(/revoke all on function[\s\S]*from public, anon/i)
  })

  it('프로젝트 스코프가 NULL 일 때 전체 허용으로 새지 않는다', () => {
    expect(migration).toMatch(/p_project_ids is not null and d\.project_id = any\(p_project_ids\)/i)
  })

  it('롤백은 인덱스와 함수만 되돌리고 데이터를 지우지 않는다', () => {
    expect(rollback).toMatch(/drop function if exists public\.match_ai_documents_lexical/i)
    expect(rollback).toMatch(/drop index if exists/i)
    expect(rollback).not.toMatch(/delete from|truncate|drop table/i)
  })
})
```

- [ ] **Step 2: 실패를 확인한다**

Run: `npx vitest run tests/migrations/ai-documents-lexical.test.ts`
Expected: FAIL — `ENOENT: no such file or directory ... 0083_ai_documents_lexical.sql`

- [ ] **Step 3: 마이그레이션을 쓴다**

```sql
-- supabase/migrations/0083_ai_documents_lexical.sql
-- 어휘 검색 다리. 벡터(match_ai_documents)가 어휘 불일치를 풀고, 이쪽이
-- 고유명사·ID·약어 같은 정확 검색을 맡는다.
--
-- 왜 word_similarity 인가 (2026-08-14 스테이징 실측):
--   similarity() 는 전체 trigram 수로 나누므로 검색어를 정확히 품고 있어도
--   문장이 길면 점수가 깎인다. 실데이터에서 순위가 뒤집혔다 —
--   '발주 자동화' 를 품은 긴 문장 0.143 < 짧은 문장 0.233.
--   word_similarity 는 "검색어가 문장 안에 있는가" 를 보므로 길이에 무관하다.

begin;

create extension if not exists pg_trgm;

-- gin_trgm_ops 는 한글에서도 ILIKE '%…%' 와 <% 를 모두 가속한다
-- (실측: Seq Scan cost 141.74 → Bitmap Index Scan 35.40).
create index if not exists ai_documents_title_trgm_idx
  on public.ai_documents using gin (title gin_trgm_ops);
create index if not exists ai_documents_content_trgm_idx
  on public.ai_documents using gin (content gin_trgm_ops);

drop function if exists public.match_ai_documents_lexical(
  text, int, uuid[], boolean, text[], text[], int
);

create function public.match_ai_documents_lexical(
  p_query text,
  match_count int default 20,
  p_project_ids uuid[] default null,
  p_include_global boolean default false,
  p_domains text[] default null,
  p_entity_types text[] default null,
  p_index_version int default 1
) returns table (
  id uuid,
  project_id uuid,
  domain text,
  entity_type text,
  entity_id text,
  chunk_no integer,
  index_version integer,
  title text,
  content text,
  content_hash text,
  href text,
  team text,
  occurred_on date,
  source_updated_at timestamptz,
  embedding_model text,
  embedding_dimensions integer,
  chunker_version text,
  indexed_at timestamptz,
  similarity float
)
language sql stable security invoker
set search_path = public, extensions
as $$
  select
    d.id, d.project_id, d.domain, d.entity_type, d.entity_id, d.chunk_no,
    d.index_version, d.title, d.content, d.content_hash, d.href, d.team,
    d.occurred_on, d.source_updated_at, d.embedding_model, d.embedding_dimensions,
    d.chunker_version, d.indexed_at,
    greatest(
      word_similarity(p_query, d.title),
      word_similarity(p_query, d.content)
    )::float as similarity
  from public.ai_documents d
  where
    -- NULL/빈 스코프는 절대 "전 프로젝트" 를 뜻하지 않는다(match_ai_documents 와 동일 계약).
    (
      (p_project_ids is not null and d.project_id = any(p_project_ids))
      or (p_include_global and d.project_id is null)
    )
    and d.index_version = p_index_version
    and (p_domains is null or d.domain = any(p_domains))
    and (p_entity_types is null or d.entity_type = any(p_entity_types))
    -- <% 는 gin_trgm_ops 인덱스를 탄다. 임계값은 pg_trgm.word_similarity_threshold(기본 0.6).
    and (p_query <% d.title or p_query <% d.content)
  order by similarity desc, d.occurred_on desc nulls last, d.entity_id, d.chunk_no
  limit greatest(1, least(coalesce(match_count, 20), 100));
$$;

revoke all on function public.match_ai_documents_lexical(
  text, int, uuid[], boolean, text[], text[], int
) from public, anon;
grant execute on function public.match_ai_documents_lexical(
  text, int, uuid[], boolean, text[], text[], int
) to authenticated, service_role;

commit;
```

- [ ] **Step 4: 롤백을 쓴다**

```sql
-- supabase/migrations/0083_ai_documents_lexical_rollback.sql
-- 0083 역연산. 색인 데이터는 건드리지 않는다 — 인덱스와 함수만 되돌린다.
-- pg_trgm 확장은 남긴다(다른 곳이 쓰기 시작했을 수 있고, 드롭은 의존 객체를 깨뜨린다).

begin;

drop function if exists public.match_ai_documents_lexical(
  text, int, uuid[], boolean, text[], text[], int
);
drop index if exists public.ai_documents_content_trgm_idx;
drop index if exists public.ai_documents_title_trgm_idx;

commit;
```

- [ ] **Step 5: 통과를 확인한다**

Run: `npx vitest run tests/migrations/ai-documents-lexical.test.ts`
Expected: PASS (7 tests)

- [ ] **Step 6: 마이그레이션만 따로 커밋** (G1 — 코드와 섞지 않는다)

```bash
git add supabase/migrations/0083_ai_documents_lexical.sql \
        supabase/migrations/0083_ai_documents_lexical_rollback.sql
git commit -m "feat(db): 0083 어휘 검색 다리 — pg_trgm GIN + word_similarity RPC

벡터가 어휘 불일치를 풀고 이쪽이 정확 검색을 맡는다. 스테이징 실측에서
similarity() 는 길이 편향으로 순위가 뒤집혀(0.143 < 0.233) 랭킹에 못 쓴다 —
word_similarity 로 간다."
git add tests/migrations/ai-documents-lexical.test.ts
git commit -m "test(db): 0083 계약 테스트 — word_similarity·스코프 격리·상한"
```

- [ ] **Step 7: 스테이징 리허설** (G4 필수)

```bash
npm run staging:sync
npm run db:apply -- supabase/migrations/0083_ai_documents_lexical.sql --target staging
```

검증 SQL — 인덱스가 실제로 쓰이는지:

```sql
explain select id from public.ai_documents where '테스트' <% content;
-- Bitmap Index Scan 이 나와야 한다. Seq Scan 이면 실패.
```

- [ ] **Step 8: 리허설 결과를 트레일러로 남긴다**

```bash
git commit --allow-empty -m "chore(db): 0083 스테이징 리허설 통과

Staging-verified: 0083 적용·인덱스 사용 확인(Bitmap Index Scan)"
```

- [ ] **Step 9: 운영에 적용한다** ⚠️ 사용자 확인 필요

**이 스텝이 없으면 Task 8 의 검색 API 가 운영에서 전부 503 이 된다** —
`match_ai_documents_lexical` 이 없어 42883(function does not exist)이 난다.

```bash
npm run db:apply -- supabase/migrations/0083_ai_documents_lexical.sql --target prod
```

적용 후 운영에서 검증한다:

```sql
select proname from pg_proc where proname = 'match_ai_documents_lexical';
select indexname from pg_indexes where indexname like 'ai_documents_%_trgm_idx';
```

Expected: 함수 1건 · 인덱스 2건.

이 마이그레이션은 **인덱스와 함수만 추가하고 데이터를 건드리지 않는다.** 되돌리기는
`0083_ai_documents_lexical_rollback.sql` 하나로 끝난다.

---

## Task 4: 회의록 스코프 skew 수정

**Files:**
- Modify: `src/lib/ai/index/backfill.ts:123`
- Modify: `src/lib/ai/index/backfill.ts:148-151` (`rowProjectId` 계산)
- Test: `tests/ai/index-backfill-scope.test.ts`

**Interfaces:**
- Consumes: 없음
- Produces: 없음 (기존 동작 수정). Task 11의 백필이 이 수정에 의존한다.

**이것이 blocker인 이유** — 열거자는 `minutes.project_id`를 읽지 않고 `meetings(project_id)`만 본다.
로더(`content.ts:284`)는 `row.project_id ?? meetingProjectId`를 쓰고 `job.projectId`와 다르면
`scopeMismatch()` → `retryable: false` → `dead_letter`. **운영 실측 47/67건(70%)이 여기 걸린다.**

- [ ] **Step 1: 실패하는 테스트를 쓴다**

```ts
// tests/ai/index-backfill-scope.test.ts
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

const source = readFileSync(
  new URL('../../src/lib/ai/index/backfill.ts', import.meta.url), 'utf8')

describe('회의록 백필 스코프 — 로더와 같은 규칙을 써야 한다', () => {
  it('열거자가 minutes.project_id 를 읽는다', () => {
    const spec = source.match(/minutes:\s*\{[^}]*\}/)?.[0] ?? ''
    expect(spec).toContain('project_id')
    // meetings 역참조만 있고 자체 컬럼이 없으면 job.projectId 가 null 로 큐잉된다
    expect(spec).not.toMatch(/columns:\s*'id, updated_at, created_at, meetings\(project_id\)'/)
  })

  it('project_id 우선, 없으면 meetings 역참조로 떨어진다 — content.ts:284 와 동일', () => {
    expect(source).toMatch(/row\.project_id[\s\S]{0,80}nestedProjectId\(row\.meetings\)/)
  })
})
```

- [ ] **Step 2: 실패를 확인한다**

Run: `npx vitest run tests/ai/index-backfill-scope.test.ts`
Expected: FAIL — **두 번째 단언**에서 실패한다
(`expected '…' not to match /columns:\s*'id, updated_at, created_at, meetings\(project_id\)'/`).
첫 단언 `toContain('project_id')` 는 `meetings(project_id)` 안에 부분문자열이 이미 있어 통과한다 —
그래서 두 단언이 함께 있어야 이 결함이 잡힌다.

- [ ] **Step 3: `SOURCE_TABLES.minutes`를 고친다**

`src/lib/ai/index/backfill.ts:123`을 다음으로 바꾼다:

```ts
  // 회의록은 자체 project_id(0045)가 1차 축이고, 없으면 meetings 역참조로 떨어진다.
  // 로더(content.ts:282)가 `row.project_id ?? meetingProjectId` 를 쓰므로 열거자도
  // 같은 규칙을 써야 한다 — 다르면 job.projectId 불일치로 전부 dead_letter 가 된다.
  // (2026-08-14 운영 실측: 67건 중 47건이 이 skew 대상이었다.)
  minutes: {
    table: 'minutes',
    columns: 'id, project_id, updated_at, created_at, meetings(project_id)',
    projectColumn: null,
  },
```

- [ ] **Step 4: `rowProjectId` 계산을 로더와 일치시킨다**

`backfill.ts:147-149`의 `rowProjectId` 계산을 다음으로 바꾼다:

```ts
    // projectColumn 이 있으면 그 컬럼, 없으면 자체 project_id → meetings 역참조 순.
    const rowProjectId = spec.projectColumn
      ? (typeof row[spec.projectColumn] === 'string' ? row[spec.projectColumn] as string : null)
      : (typeof row.project_id === 'string' ? row.project_id : nestedProjectId(row.meetings))
```

- [ ] **Step 5: 통과를 확인한다**

Run: `npx vitest run tests/ai/index-backfill-scope.test.ts tests/ai/index-worker.test.ts tests/ai/index-consistency.test.ts`
Expected: PASS — 새 테스트 2건 + 기존 회귀 없음

- [ ] **Step 6: 커밋**

```bash
git add src/lib/ai/index/backfill.ts tests/ai/index-backfill-scope.test.ts
git commit -m "fix(index): 회의록 백필이 minutes.project_id 를 읽지 않아 전량 dead_letter 되던 문제

열거자는 meetings 역참조만 보고 job.projectId 를 null 로 큐잉하는데 로더는
minutes.project_id 를 우선 쓰고 불일치를 재시도 불가로 끊는다. 운영 실측
67건 중 47건(70%)이 이 경로였다 — 최우선 코퍼스가 조용히 사라진다."
```

---

## Task 5: 이슈 색인 배선

**Files:**
- Modify: `src/lib/ai/chat/protocol.ts` (`BOT_DOMAINS`, `BOT_ENTITY_TYPES`)
- Modify: `src/lib/ai/index/content.ts` (`loadIssue` + `case 'issue'`)
- Modify: `src/lib/ai/index/backfill.ts` (`INDEX_BACKFILL_DOMAINS`, `INDEX_BACKFILL_ENTITY_TYPE`, `SOURCE_TABLES`)
- **Modify: `src/lib/ai/chat/verifier.ts`** (`DOMAIN_PATH`) — 아래 blocker 참조
- Test: `tests/ai/index-issue-loader.test.ts`

**Interfaces:**
- Produces: `domain: 'issues'` · `entityType: 'issue'` 색인 행. Task 8의 검색이 출처 배지로 쓴다.

> ⚠️ **`BOT_DOMAINS` 에 `'issues'` 를 넣는 순간 `verifier.ts:41` 이 컴파일 에러가 된다.**
> 그 줄은 `} satisfies Record<BotDomain, (projectId: string | null) => string[]>` 로 닫혀 있어
> 새 도메인 키가 없으면 타입이 깨진다. **vitest 는 이걸 못 잡는다** — oxc 트랜스파일만 하고
> 타입체크를 하지 않으며, `BOT_DOMAINS` 를 열거하는 테스트가 `tests/` 전체에 0건이다.
> 그래서 이 태스크의 검증에는 반드시 `npx tsc --noEmit` 이 들어간다.

**`case 'issue'`만 추가하면 한 건도 색인되지 않는다.** `pgvector.ts:67-68`이
`BOT_DOMAINS`·`BOT_ENTITY_TYPES`로 Set을 만들어 검증하므로 `mapDocument`가 `null`을 반환하고
upsert가 거부된다. DB는 무해하다 — `0031`의 `domain`·`entity_type`에 CHECK 제약이 없다.

- [ ] **Step 1: 실패하는 테스트를 쓴다**

```ts
// tests/ai/index-issue-loader.test.ts
import { describe, expect, it } from 'vitest'
import { BOT_DOMAINS, BOT_ENTITY_TYPES } from '@/lib/ai/chat/protocol'
import { INDEX_BACKFILL_DOMAINS } from '@/lib/ai/index/backfill'
import { createSupabaseIndexContentLoader } from '@/lib/ai/index/content'

const PROJECT = '11111111-1111-1111-1111-111111111111'
const ISSUE = '33333333-3333-3333-3333-333333333333'

function client(row: Record<string, unknown> | null) {
  const builder: Record<string, unknown> = {}
  for (const m of ['select', 'eq']) builder[m] = () => builder
  builder.maybeSingle = async () => ({ data: row, error: null })
  return { from: () => builder } as never
}

const job = {
  entityType: 'issue', entityId: ISSUE, projectId: PROJECT,
  domain: 'issues', operation: 'upsert' as const,
} as never

describe('이슈 색인 배선', () => {
  it('도메인·엔티티 어휘의 단일 원천에 issues/issue 가 있다', () => {
    expect(BOT_DOMAINS).toContain('issues')
    expect(BOT_ENTITY_TYPES).toContain('issue')
  })

  it('백필 열거 도메인에 issues 가 있다', () => {
    expect(INDEX_BACKFILL_DOMAINS).toContain('issues')
  })

  it('로더가 이슈 본문을 스냅샷으로 만든다', async () => {
    const load = createSupabaseIndexContentLoader(client({
      id: ISSUE, project_id: PROJECT, issue_no: 42, title: 'MES 권한 신청 절차',
      body: '계정 발급은 IT팀 경유', status: 'open', severity: 'high',
      owner_department: '부산운영팀', created_at: '2026-07-01T00:00:00Z',
      updated_at: '2026-07-02T00:00:00Z',
    }))
    const result = await load(job)
    expect(result.ok).toBe(true)
    if (!result.ok || !result.data) throw new Error('스냅샷이 없다')
    // IndexContentSnapshot 은 { documents, sourceUpdatedAt } 이다(types.ts:198-201).
    // title·href 는 스냅샷이 아니라 documents[0] 에 있다.
    const [doc] = result.data.documents
    expect(doc.title).toContain('MES 권한 신청 절차')
    expect(doc.href).toContain(`/p/${PROJECT}/issues`)
  })

  it('다른 프로젝트의 이슈면 내용 노출 전에 끊는다', async () => {
    const load = createSupabaseIndexContentLoader(client({
      id: ISSUE, project_id: '99999999-9999-9999-9999-999999999999', title: '남의 이슈',
    }))
    const result = await load(job)
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('통과하면 안 된다')
    expect(result.errorCode).toBe('INDEX_CONTENT_SCOPE_MISMATCH')
  })
})
```

- [ ] **Step 2: 실패를 확인한다**

Run: `npx vitest run tests/ai/index-issue-loader.test.ts`
Expected: FAIL — `expected [ … ] to contain 'issues'`

- [ ] **Step 3: `protocol.ts`의 어휘를 넓힌다**

`BOT_DOMAINS` 배열에 `'issues',`를, `BOT_ENTITY_TYPES` 배열에 `'issue',`를 추가한다.
두 배열은 주석이 "단일 원천"으로 못박은 것이라 여기가 정본이다.

- [ ] **Step 4: `content.ts`에 로더를 추가한다**

`loadAnnouncement` 바로 아래에 넣는다:

```ts
async function loadIssue(client: SupabaseKnowledgeClient, job: ClaimedIndexJob): Promise<IndexContentLoadResult> {
  const { data, error } = await client.from('issues')
    .select('id, project_id, issue_no, title, body, status, severity, owner_department, sub_process, resolution_note, due_date, created_at, updated_at')
    .eq('id', job.entityId)
    .maybeSingle()
  if (error) return readError('ISSUES_READ_FAILED', error)
  if (!data) return { ok: true, data: null }
  const row = data as Row
  if (row.project_id !== job.projectId) return scopeMismatch()

  const issueNo = typeof row.issue_no === 'number' ? row.issue_no : null
  const title = str(row.title) ?? '이슈'
  const text = joinLines([
    `# 이슈 ${issueNo != null ? `#${issueNo} ` : ''}${title}`.trim(),
    str(row.status) ? `상태: ${str(row.status)}` : null,
    str(row.severity) ? `심각도: ${str(row.severity)}` : null,
    str(row.owner_department) ? `담당부서: ${str(row.owner_department)}` : null,
    str(row.sub_process) ? `하위 프로세스: ${str(row.sub_process)}` : null,
    safeDate(row.due_date) ? `기한: ${safeDate(row.due_date)}` : null,
    str(row.body),
    str(row.resolution_note) ? `조치: ${str(row.resolution_note)}` : null,
  ])
  return {
    ok: true,
    data: await toSnapshot({
      job,
      title: issueNo != null ? `#${issueNo} ${title}` : title,
      text,
      href: `/p/${encodeURIComponent(job.projectId ?? '')}/issues?focus=${encodeURIComponent(job.entityId)}`,
      team: str(row.owner_department),
      occurredOn: safeDate(row.created_at),
      sourceUpdatedAt: safeTimestamp(row.updated_at) ?? safeTimestamp(row.created_at),
    }),
  }
}
```

그리고 switch에 한 줄 — `case 'minute'` 아래:

```ts
      case 'issue': return loadIssue(client, job)
```

- [ ] **Step 5: `backfill.ts`에 소스를 추가한다**

`INDEX_BACKFILL_DOMAINS`에 `'issues'`를 추가하고, 도메인→엔티티 매핑(`backfill.ts:16` 부근)에
`issues: 'issue',`를, `SOURCE_TABLES`에 다음을 추가한다:

```ts
  issues: { table: 'issues', columns: 'id, project_id, updated_at, created_at', projectColumn: 'project_id' },
```

- [ ] **Step 6: `verifier.ts`의 `DOMAIN_PATH`에 `issues`를 추가한다**

`BOT_DOMAINS`가 늘어났으므로 이 줄이 없으면 `verifier.ts:41`의
`satisfies Record<BotDomain, …>`가 깨진다. 경로 루트는 `loadIssue`의 `href`와 같아야
`isInternalHref` 검증도 통과한다.

```ts
  issues: projectId => projectId ? [`/p/${projectId}/issues`] : [],
```

- [ ] **Step 7: 통과를 확인한다**

Run: `npx vitest run tests/ai/ 2>&1 | tail -20`
Run: `npx tsc --noEmit 2>&1 | grep -E "protocol|verifier|router|content|backfill" || echo "관련 타입 에러 0건"`

Expected: vitest PASS + 위 파일들에 타입 에러 0건.
**`tsc`를 반드시 돌려라** — vitest(oxc)는 타입체크를 하지 않고 `BOT_DOMAINS`를 열거하는
테스트가 `tests/` 전체에 0건이라, 이 태스크가 만든 타입 깨짐은 vitest로 절대 안 잡힌다.

- [ ] **Step 7: 커밋**

```bash
git add src/lib/ai/chat/protocol.ts src/lib/ai/index/content.ts \
        src/lib/ai/index/backfill.ts tests/ai/index-issue-loader.test.ts
git commit -m "feat(index): 이슈를 색인 대상에 추가 — 어휘·로더·열거 4곳

content.ts 에 case 만 넣으면 한 건도 안 들어간다. pgvector 가 BOT_DOMAINS·
BOT_ENTITY_TYPES 로 만든 Set 으로 검증해 upsert 를 거부하기 때문이다."
```

---

## Task 6: RRF 융합과 청크 접기

**Files:**
- Create: `src/lib/domain/searchFusion.ts`
- Test: `tests/domain/search-fusion.test.ts`

**Interfaces:**
- Consumes: 없음 (순수 함수)
- Produces:
  ```ts
  export interface FusionCandidate {
    domain: string; entityType: string; entityId: string
    projectId: string | null; chunkNo: number
    title: string; content: string; href: string
    occurredOn: string | null
  }
  export interface FusedDocument extends FusionCandidate {
    score: number
    matchedBy: Array<'vector' | 'lexical'>
  }
  export const RRF_K = 60
  export function fuseSearchResults(
    vector: readonly FusionCandidate[],
    lexical: readonly FusionCandidate[],
    limit?: number,
  ): FusedDocument[]
  ```
  Task 8의 라우트가 호출한다.

기존 `mergeHybridResults`(hybrid.ts:191)는 **가중합**이고 dedup 키에 `chunkNo`가 들어 있다.
회의록 1건이 평균 20청크라 접지 않으면 상위 10건이 한 건으로 도배된다.
챗봇이 그 함수를 공유하므로 **교체 대신 새 함수를 만든다**(회귀 위험 격리).

- [ ] **Step 1: 실패하는 테스트를 쓴다**

```ts
// tests/domain/search-fusion.test.ts
import { describe, expect, it } from 'vitest'
import { fuseSearchResults, RRF_K, type FusionCandidate } from '@/lib/domain/searchFusion'

function chunk(entityId: string, chunkNo: number, extra: Partial<FusionCandidate> = {}): FusionCandidate {
  return {
    domain: 'minutes', entityType: 'minute', entityId, projectId: 'p1', chunkNo,
    title: `회의록 ${entityId}`, content: `본문 ${chunkNo}`, href: `/m/${entityId}`,
    occurredOn: '2026-07-01', ...extra,
  }
}

describe('fuseSearchResults', () => {
  it('같은 문서의 청크 여러 개를 한 행으로 접는다', () => {
    const out = fuseSearchResults([chunk('A', 0), chunk('A', 1), chunk('A', 2)], [])
    expect(out).toHaveLength(1)
    expect(out[0].entityId).toBe('A')
  })

  it('문서 점수는 최고 청크 점수다 — 합산하면 긴 문서가 유리해진다', () => {
    // A 는 1·2·3위를 독식, B 는 4위 하나. 합산이면 A 가 압도하지만
    // 최고점 기준이면 A(1위) > B(4위) 로 격차가 청크 수에 안 휘둘린다.
    const out = fuseSearchResults([chunk('A', 0), chunk('A', 1), chunk('A', 2), chunk('B', 0)], [])
    expect(out.map(d => d.entityId)).toEqual(['A', 'B'])
    expect(out[0].score).toBeCloseTo(1 / (RRF_K + 1), 10)
    expect(out[1].score).toBeCloseTo(1 / (RRF_K + 4), 10)
  })

  it('두 다리에 모두 걸리면 점수가 합쳐진다', () => {
    const out = fuseSearchResults([chunk('A', 0)], [chunk('A', 0)])
    expect(out[0].score).toBeCloseTo(2 / (RRF_K + 1), 10)
    expect(out[0].matchedBy).toEqual(['lexical', 'vector'])
  })

  it('한쪽이 비어도 동작한다', () => {
    expect(fuseSearchResults([], [chunk('A', 0)])).toHaveLength(1)
    expect(fuseSearchResults([], [])).toEqual([])
  })

  it('동점은 occurred_on 최신 → entityId 사전순으로 깬다(결정성)', () => {
    const older = chunk('Z', 0, { occurredOn: '2026-01-01' })
    const newer = chunk('A', 0, { occurredOn: '2026-08-01' })
    // 양쪽 다 어휘 1위 하나씩이 되도록 서로 다른 배열의 같은 순위에 놓는다
    const out = fuseSearchResults([newer], [older])
    expect(out.map(d => d.entityId)).toEqual(['A', 'Z'])
  })

  it('서로 다른 도메인의 같은 entityId 는 다른 문서다', () => {
    const a = chunk('X', 0)
    const b = chunk('X', 0, { domain: 'issues', entityType: 'issue' })
    expect(fuseSearchResults([a, b], [])).toHaveLength(2)
  })

  it('limit 을 넘기면 잘린다', () => {
    const many = Array.from({ length: 30 }, (_, i) => chunk(`E${i}`, 0))
    expect(fuseSearchResults(many, [], 10)).toHaveLength(10)
  })
})
```

- [ ] **Step 2: 실패를 확인한다**

Run: `npx vitest run tests/domain/search-fusion.test.ts`
Expected: FAIL — `Cannot find module '@/lib/domain/searchFusion'`

- [ ] **Step 3: 구현한다**

```ts
// src/lib/domain/searchFusion.ts

/**
 * 두 다리(벡터·어휘) 결과의 RRF 융합 + 청크 → 문서 접기.
 *
 * 왜 RRF 인가: 코사인 유사도(0~1)와 trigram word_similarity 는 척도가 달라
 * 직접 더할 수 없다. RRF 는 점수 대신 순위만 쓰므로 정규화가 필요 없고
 * 튜닝 상수가 k 하나다.
 *
 * 왜 새 함수인가: 기존 mergeHybridResults(hybrid.ts:191)는 가중합이고
 * dedup 키에 chunkNo 가 들어 있다. 챗봇이 그 함수를 공유하므로 교체하면
 * 챗봇 검색 결과가 함께 바뀐다. 회귀 위험을 격리하려고 따로 만든다.
 */

export const RRF_K = 60
const DEFAULT_LIMIT = 20

export interface FusionCandidate {
  domain: string
  entityType: string
  entityId: string
  projectId: string | null
  chunkNo: number
  title: string
  content: string
  href: string
  occurredOn: string | null
}

export interface FusedDocument extends FusionCandidate {
  score: number
  matchedBy: Array<'vector' | 'lexical'>
}

/** 청크가 아니라 문서를 가리키는 키 — chunkNo 를 뺀다. */
function documentKey(candidate: FusionCandidate): string {
  return [
    candidate.projectId ?? 'global',
    candidate.domain,
    candidate.entityType,
    candidate.entityId,
  ].join('\u001f')   // 구분자 없이 이으면 서로 다른 튜플이 같은 키가 된다
}

export function fuseSearchResults(
  vector: readonly FusionCandidate[],
  lexical: readonly FusionCandidate[],
  limit: number = DEFAULT_LIMIT,
): FusedDocument[] {
  const merged = new Map<string, FusedDocument>()

  const absorb = (list: readonly FusionCandidate[], kind: 'vector' | 'lexical') => {
    list.forEach((candidate, index) => {
      const contribution = 1 / (RRF_K + index + 1)
      const key = documentKey(candidate)
      const existing = merged.get(key)
      if (!existing) {
        const created: FusedDocument = { ...candidate, score: contribution, matchedBy: [kind] }
        merged.set(key, created)
        // 첫 삽입에서도 다리별 점수를 기록해야 한다. 안 하면 다음 청크가 legScore 0 을
        // 읽어 `contribution > 0` 이 항상 참이 되고, 최고점 교체가 아니라 합산이 된다 —
        // §5.4 가 금지한 길이 편향이 그대로 되살아난다.
        setLegScore(created, kind, contribution)
        return
      }
      // 문서 점수는 최고 청크 점수다. 합산하면 청크가 많은 긴 문서가 유리해져
      // similarity() 에서 배제한 길이 편향이 다른 경로로 되살아난다.
      const sameLeg = existing.matchedBy.includes(kind)
      if (sameLeg) {
        // 같은 다리의 다른 청크 — 더 높은 쪽만 남긴다.
        if (contribution > legScore(existing, kind)) {
          existing.score = existing.score - legScore(existing, kind) + contribution
          setLegScore(existing, kind, contribution)
          adoptBetterChunk(existing, candidate)
        }
        return
      }
      existing.matchedBy.push(kind)
      setLegScore(existing, kind, contribution)
      existing.score += contribution
    })
  }

  // 다리별 최고 점수를 추적해야 "최고 청크만" 규칙을 지킬 수 있다.
  const legScores = new WeakMap<FusedDocument, { vector: number; lexical: number }>()
  function legScore(doc: FusedDocument, kind: 'vector' | 'lexical'): number {
    return legScores.get(doc)?.[kind] ?? 0
  }
  function setLegScore(doc: FusedDocument, kind: 'vector' | 'lexical', value: number): void {
    const current = legScores.get(doc) ?? { vector: 0, lexical: 0 }
    current[kind] = value
    legScores.set(doc, current)
  }
  function adoptBetterChunk(doc: FusedDocument, candidate: FusionCandidate): void {
    doc.chunkNo = candidate.chunkNo
    doc.content = candidate.content
  }

  absorb(vector, 'vector')
  absorb(lexical, 'lexical')

  const bounded = Math.max(1, Math.floor(limit))
  return [...merged.values()]
    .map(doc => ({ ...doc, matchedBy: [...doc.matchedBy].sort() }))
    .sort((a, b) =>
      b.score - a.score
      || (b.occurredOn ?? '').localeCompare(a.occurredOn ?? '')
      || a.entityId.localeCompare(b.entityId))
    .slice(0, bounded)
}
```

- [ ] **Step 4: 통과를 확인한다**

Run: `npx vitest run tests/domain/search-fusion.test.ts`
Expected: PASS (7 tests)

- [ ] **Step 5: 커밋**

```bash
git add src/lib/domain/searchFusion.ts tests/domain/search-fusion.test.ts
git commit -m "feat(search): RRF 융합 + 청크를 문서로 접기

기존 mergeHybridResults 는 가중합이고 dedup 키에 chunkNo 가 있어 회의록
한 건의 청크 20개가 서로 다른 문서로 잡힌다 — 접지 않으면 상위 결과가
한 건으로 도배된다. 문서 점수를 합산이 아니라 최고 청크 점수로 두는 이유는
합산하면 긴 문서가 유리해져 길이 편향이 되살아나기 때문이다.

챗봇이 mergeHybridResults 를 공유하므로 교체 대신 새 함수로 격리했다."
```

---

## Task 7: 어휘 다리 어댑터

**Files:**
- Create: `src/lib/ai/index/lexical.ts`
- Test: `tests/ai/index-lexical.test.ts`

**Interfaces:**
- Consumes: `SupabaseKnowledgeClient`(`./pgvector`), `FusionCandidate`(`@/lib/domain/searchFusion`)
- Produces:
  ```ts
  export type LexicalSearchResult =
    | { ok: true; candidates: FusionCandidate[] }
    | { ok: false; errorCode: string }
  export function createLexicalSearch(client: SupabaseKnowledgeClient): (input: {
    query: string; projectIds: string[]; limit: number
  }) => Promise<LexicalSearchResult>
  ```
  Task 8이 호출한다.

- [ ] **Step 1: 실패하는 테스트를 쓴다**

```ts
// tests/ai/index-lexical.test.ts
import { describe, expect, it, vi } from 'vitest'
import { createLexicalSearch, toFusionCandidate } from '@/lib/ai/index/lexical'

const PROJECT = '11111111-1111-1111-1111-111111111111'

function client(response: { data: unknown; error: unknown }) {
  return { rpc: vi.fn(async () => response) } as never
}

const row = {
  id: 'r1', project_id: PROJECT, domain: 'minutes', entity_type: 'minute',
  entity_id: 'm1', chunk_no: 3, title: '정례 회의', content: '계정 발급',
  href: '/m/m1', occurred_on: '2026-07-01', similarity: 0.8,
}

describe('createLexicalSearch', () => {
  it('RPC 결과를 FusionCandidate 로 옮긴다', async () => {
    const search = createLexicalSearch(client({ data: [row], error: null }))
    const result = await search({ query: '계정', projectIds: [PROJECT], limit: 20 })
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('실패하면 안 된다')
    expect(result.candidates[0]).toMatchObject({
      entityId: 'm1', chunkNo: 3, domain: 'minutes', title: '정례 회의',
    })
  })

  it('projectIds 가 비면 RPC 를 부르지 않는다 — 빈 스코프는 전체 허용이 아니다', async () => {
    const c = client({ data: [row], error: null })
    const search = createLexicalSearch(c)
    const result = await search({ query: '계정', projectIds: [], limit: 20 })
    expect(result).toEqual({ ok: true, candidates: [] })
    expect((c as unknown as { rpc: ReturnType<typeof vi.fn> }).rpc).not.toHaveBeenCalled()
  })

  it('빈 질의는 RPC 를 부르지 않는다', async () => {
    const c = client({ data: [row], error: null })
    const result = await createLexicalSearch(c)({ query: '   ', projectIds: [PROJECT], limit: 20 })
    expect(result).toEqual({ ok: true, candidates: [] })
    expect((c as unknown as { rpc: ReturnType<typeof vi.fn> }).rpc).not.toHaveBeenCalled()
  })

  it('RPC 오류를 조용히 빈 결과로 위장하지 않는다', async () => {
    const search = createLexicalSearch(client({ data: null, error: { message: 'boom' } }))
    const result = await search({ query: '계정', projectIds: [PROJECT], limit: 20 })
    expect(result).toMatchObject({ ok: false, errorCode: 'LEXICAL_SEARCH_FAILED' })
  })

  it('형태가 깨진 행은 버리되 나머지는 살린다', async () => {
    const search = createLexicalSearch(client({ data: [{ id: 'x' }, row], error: null }))
    const result = await search({ query: '계정', projectIds: [PROJECT], limit: 20 })
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('실패하면 안 된다')
    expect(result.candidates).toHaveLength(1)
  })
})
```

- [ ] **Step 2: 실패를 확인한다**

Run: `npx vitest run tests/ai/index-lexical.test.ts`
Expected: FAIL — `Cannot find module '@/lib/ai/index/lexical'`

- [ ] **Step 3: 구현한다**

```ts
// src/lib/ai/index/lexical.ts
import type { FusionCandidate } from '@/lib/domain/searchFusion'
import type { SupabaseKnowledgeClient } from './pgvector'

/**
 * 어휘 다리 — 0083 의 match_ai_documents_lexical 어댑터.
 * 벡터가 어휘 불일치를 풀고, 이쪽이 고유명사·ID·약어 같은 정확 검색을 맡는다.
 */
export type LexicalSearchResult =
  | { ok: true; candidates: FusionCandidate[] }
  | { ok: false; errorCode: string }

type Row = Record<string, unknown>

function str(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

export function toFusionCandidate(row: Record<string, unknown>): FusionCandidate | null {
  const domain = str(row.domain)
  const entityType = str(row.entity_type)
  const entityId = str(row.entity_id)
  const href = str(row.href)
  if (!domain || !entityType || !entityId || !href) return null
  return {
    domain,
    entityType,
    entityId,
    projectId: str(row.project_id),
    chunkNo: typeof row.chunk_no === 'number' ? row.chunk_no : 0,
    title: str(row.title) ?? '',
    content: str(row.content) ?? '',
    href,
    occurredOn: str(row.occurred_on),
  }
}

export function createLexicalSearch(client: SupabaseKnowledgeClient) {
  return async (input: {
    query: string
    projectIds: string[]
    limit: number
  }): Promise<LexicalSearchResult> => {
    const query = input.query.trim()
    // 빈 스코프는 "전 프로젝트" 가 아니라 "아무것도 없음" 이다. RPC 를 부르지 않는다.
    if (!query || input.projectIds.length === 0) return { ok: true, candidates: [] }

    const { data, error } = await client.rpc('match_ai_documents_lexical', {
      p_query: query,
      match_count: Math.max(1, Math.min(Math.floor(input.limit), 100)),
      p_project_ids: input.projectIds,
      p_include_global: false,
      p_domains: null,
      p_entity_types: null,
      p_index_version: 1,
    })

    // 조회 실패를 "결과 없음" 으로 위장하지 않는다(에러 처리 3원칙).
    if (error) {
      console.error('[search] 어휘 검색 실패:', error)
      return { ok: false, errorCode: 'LEXICAL_SEARCH_FAILED' }
    }

    const rows = Array.isArray(data) ? data as Row[] : []
    return { ok: true, candidates: rows.flatMap(row => {
      const candidate = toFusionCandidate(row)
      return candidate ? [candidate] : []
    }) }
  }
}
```

- [ ] **Step 4: 통과를 확인한다**

Run: `npx vitest run tests/ai/index-lexical.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: 커밋**

```bash
git add src/lib/ai/index/lexical.ts tests/ai/index-lexical.test.ts
git commit -m "feat(search): 0083 어휘 검색 RPC 어댑터

빈 스코프와 빈 질의는 RPC 를 부르지 않는다 — 빈 목록을 전체 허용으로 읽으면
프로젝트 격리가 무너진다. RPC 오류는 빈 결과로 위장하지 않고 그대로 올린다."
```

---

## Task 8: 검색 API

**Files:**
- Create: `src/app/api/wiki/search/route.ts`
- Test: `tests/actions/wiki-search-route.test.ts`

**Interfaces:**
- Consumes: `decideSearchAccess`(Task 2) · `fuseSearchResults`(Task 6) · `createLexicalSearch`(Task 7) · `embedDocuments`(`@/lib/ai/embeddings`) · `createSupabaseAccessScopeResolver`(`@/lib/authz/accessScope`)
- Produces: `POST /api/wiki/search` — 요청 `{ projectId: string; q: string }`, 응답 `{ results: FusedDocument[]; degraded: boolean }`

`degraded: true`는 **임베딩이 실패해 어휘 다리만으로 답했다**는 뜻이다. 화면이 이 사실을 표시한다 —
조용히 품질을 떨어뜨리지 않는다.

- [ ] **Step 1: 실패하는 테스트를 쓴다**

```ts
// tests/actions/wiki-search-route.test.ts
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({
  getActorForView: vi.fn(),
  resolveScope: vi.fn(),
  embedDocuments: vi.fn(),
  lexical: vi.fn(),
  rpc: vi.fn(),
}))

vi.mock('@/lib/authz', () => ({ getActorForView: mocks.getActorForView }))
vi.mock('@/lib/authz/accessScope', () => ({
  createSupabaseAccessScopeResolver: () => ({ resolve: mocks.resolveScope }),
}))
vi.mock('@/lib/ai/embeddings', () => ({ embedDocuments: mocks.embedDocuments }))
vi.mock('@/lib/ai/index/lexical', () => ({ createLexicalSearch: () => mocks.lexical }))
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({ rpc: mocks.rpc }),
}))

import { POST } from '@/app/api/wiki/search/route'

const PROJECT = '11111111-1111-1111-1111-111111111111'
const OTHER = '22222222-2222-2222-2222-222222222222'

function request(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/wiki/search', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.getActorForView.mockResolvedValue({ userId: 'u1' })
  mocks.resolveScope.mockResolvedValue({ ok: true, scope: { allowedProjectIds: [PROJECT] } })
  mocks.embedDocuments.mockResolvedValue([[0.1, 0.2]])
  mocks.lexical.mockResolvedValue({ ok: true, candidates: [] })
  mocks.rpc.mockResolvedValue({ data: [], error: null })
})

describe('POST /api/wiki/search', () => {
  it('허용되지 않은 프로젝트는 403 — 비공개 프로젝트 유출을 막는다', async () => {
    const res = await POST(request({ projectId: OTHER, q: '권한' }))
    expect(res.status).toBe(403)
    expect(mocks.rpc).not.toHaveBeenCalled()
    expect(mocks.lexical).not.toHaveBeenCalled()
  })

  it('로그인하지 않았으면 401', async () => {
    mocks.getActorForView.mockResolvedValue(null)
    expect((await POST(request({ projectId: PROJECT, q: '권한' }))).status).toBe(401)
  })

  it('스코프 조회 실패는 503 — 빈 결과로 위장하지 않는다', async () => {
    mocks.resolveScope.mockResolvedValue({ ok: false, code: 'ACCESS_SCOPE_UNAVAILABLE' })
    expect((await POST(request({ projectId: PROJECT, q: '권한' }))).status).toBe(503)
  })

  it('벡터 RPC 에 서버가 확정한 projectIds 만 넘긴다', async () => {
    await POST(request({ projectId: PROJECT, q: '권한', projectIds: [OTHER] }))
    expect(mocks.rpc).toHaveBeenCalledWith('match_ai_documents', expect.objectContaining({
      p_project_ids: [PROJECT], p_include_global: false,
    }))
  })

  it('임베딩이 실패하면 어휘 다리만으로 답하고 degraded 를 알린다', async () => {
    mocks.embedDocuments.mockResolvedValue(null)
    const res = await POST(request({ projectId: PROJECT, q: '권한' }))
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ degraded: true })
    expect(mocks.rpc).not.toHaveBeenCalled()
    expect(mocks.lexical).toHaveBeenCalled()
  })

  it('빈 질의는 200 에 빈 결과', async () => {
    const res = await POST(request({ projectId: PROJECT, q: '  ' }))
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ results: [] })
  })
})
```

- [ ] **Step 2: 실패를 확인한다**

Run: `npx vitest run tests/actions/wiki-search-route.test.ts`
Expected: FAIL — `Cannot find module '@/app/api/wiki/search/route'`

- [ ] **Step 3: 구현한다**

```ts
// src/app/api/wiki/search/route.ts
import { NextResponse, type NextRequest } from 'next/server'
import { embedDocuments } from '@/lib/ai/embeddings'
import { createLexicalSearch } from '@/lib/ai/index/lexical'
import { getActorViewState } from '@/lib/authz'
import { createSupabaseAccessScopeResolver } from '@/lib/authz/accessScope'
import { decideSearchAccess } from '@/lib/domain/searchAccess'
import { fuseSearchResults } from '@/lib/domain/searchFusion'
import type { SupabaseKnowledgeClient } from '@/lib/ai/index/pgvector'
import { createAdminClient } from '@/lib/supabase/admin'

const MAX_QUERY_CHARS = 200
const CANDIDATE_LIMIT = 50
const RESULT_LIMIT = 20

// row → FusionCandidate 매핑은 Task 7 이 export 한 것을 재사용한다. 여기 다시 쓰면
// 같은 로직이 두 벌이 되어 필드 하나가 바뀔 때 조용히 갈라진다.

export async function POST(request: NextRequest) {
  // getActorForView() 는 미인증과 권한 조회 실패를 똑같이 null 로 돌려준다(authz/index.ts:90-113).
  // 그 둘을 401 로 뭉개면 조회 실패를 인증 실패로 위장하게 된다 — 에러 처리 3원칙 위반.
  const { actor, degraded } = await getActorViewState()
  if (degraded) return NextResponse.json({ error: 'ACTOR_LOOKUP_FAILED' }, { status: 503 })
  if (!actor?.userId) return NextResponse.json({ error: 'UNAUTHENTICATED' }, { status: 401 })

  const body = await request.json().catch(() => null) as { projectId?: unknown; q?: unknown } | null
  const projectId = typeof body?.projectId === 'string' ? body.projectId : ''
  const query = (typeof body?.q === 'string' ? body.q : '').slice(0, MAX_QUERY_CHARS).trim()

  const admin = createAdminClient()
  const scope = await createSupabaseAccessScopeResolver(admin).resolve(actor.userId)

  // 이 판정이 유일한 관문이다 — ai_documents 의 RLS 는 authenticated using (true) 다.
  const access = decideSearchAccess(projectId, scope)
  if (!access.ok) return NextResponse.json({ error: access.reason }, { status: access.status })

  if (!query) return NextResponse.json({ results: [], degraded: false })

  // 임베딩이 실패해도 검색이 통째로 죽으면 안 된다 — 어휘 다리로 계속한다.
  const embeddings = await embedDocuments([query], 'RETRIEVAL_QUERY').catch(() => null)
  const queryEmbedding = embeddings?.[0] ?? null

  // createLexicalSearch 는 구조적 인터페이스 SupabaseKnowledgeClient 를 받는다.
  // 리포 관용구대로 이중 캐스트로 넘긴다.
  const lexicalSearch = createLexicalSearch(admin as unknown as SupabaseKnowledgeClient)
  const [vectorRows, lexicalResult] = await Promise.all([
    queryEmbedding
      ? admin.rpc('match_ai_documents', {
          query_embedding: queryEmbedding,
          match_count: CANDIDATE_LIMIT,
          p_project_ids: access.projectIds,
          p_include_global: false,
          p_domains: null,
          p_entity_types: null,
          p_team: null,
          p_date_from: null,
          p_date_to: null,
          p_index_version: 1,
        })
      : Promise.resolve({ data: [], error: null }),
    lexicalSearch({ query, projectIds: access.projectIds, limit: CANDIDATE_LIMIT }),
  ])

  if (vectorRows.error) {
    console.error('[search] 벡터 검색 실패:', vectorRows.error)
    return NextResponse.json({ error: 'VECTOR_SEARCH_FAILED' }, { status: 503 })
  }
  if (!lexicalResult.ok) {
    return NextResponse.json({ error: lexicalResult.errorCode }, { status: 503 })
  }

  const vector = (Array.isArray(vectorRows.data) ? vectorRows.data as Array<Record<string, unknown>> : [])
    .flatMap(row => { const c = toFusionCandidate(row); return c ? [c] : [] })

  return NextResponse.json({
    results: fuseSearchResults(vector, lexicalResult.candidates, RESULT_LIMIT),
    degraded: queryEmbedding === null,
  })
}
```

- [ ] **Step 4: 통과를 확인한다**

Run: `npx vitest run tests/actions/wiki-search-route.test.ts`
Expected: PASS (6 tests)

- [ ] **Step 5: 커밋**

```bash
git add src/app/api/wiki/search/route.ts tests/actions/wiki-search-route.test.ts
git commit -m "feat(search): 검색 API — 인가 뒤에 두 다리를 병렬로

p_project_ids 는 클라이언트 값이 아니라 서버가 확정한 것만 넘긴다. 요청 본문에
projectIds 를 실어 보내도 무시된다는 것을 테스트로 못박았다. 임베딩이 실패하면
어휘 다리만으로 답하되 degraded 를 실어 화면이 그 사실을 표시하게 한다."
```

---

## Task 9: 워커 기동과 크론

**Files:**
- Modify: `vercel.json`
- Create: `src/app/api/cron/ai-index/route.ts` (Vercel 크론 → 기존 워커 어댑터)
- Test: `tests/actions/cron-ai-index.test.ts`

**Interfaces:**
- Consumes: `runIndexWorkerOnce`(`@/lib/ai/index/worker`)
- Produces: `GET /api/cron/ai-index`

**어댑터가 필요한 이유** — 기존 `/api/chat/index/worker`는 `POST` + `x-cron-secret` 헤더로
인증한다. Vercel 크론은 `GET` + `Authorization: Bearer $CRON_SECRET` 규약을 쓴다
(`inbox-retention/route.ts:14-18` 참고). 규약이 달라 크론이 그 라우트를 직접 못 부른다.

- [ ] **Step 1: 실패하는 테스트를 쓴다**

```ts
// tests/actions/cron-ai-index.test.ts
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({
  runIndexWorkerOnce: vi.fn(),
  // 라우트가 admin.from('projects').select('id') 를 부르므로 빈 객체를 주면 TypeError 로 죽는다.
  createAdminClient: vi.fn(() => ({
    from: () => ({ select: () => ({ limit: async () => ({ data: [{ id: 'p1' }], error: null }) }) }),
  })),
}))
vi.mock('@/lib/ai/index/worker', () => ({ runIndexWorkerOnce: mocks.runIndexWorkerOnce }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: mocks.createAdminClient }))

import { GET } from '@/app/api/cron/ai-index/route'

function request(auth?: string): NextRequest {
  return new NextRequest('http://localhost/api/cron/ai-index', {
    headers: auth ? { Authorization: auth } : {},
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv('CRON_SECRET', 'topsecret')
  vi.stubEnv('CHAT_V2_INDEX_WORKER_ENABLED', 'true')
  mocks.runIndexWorkerOnce.mockResolvedValue({ claimed: 3, succeeded: 3, failed: 0 })
})

describe('GET /api/cron/ai-index', () => {
  it('Bearer 가 맞으면 워커를 한 번 돌린다', async () => {
    const res = await GET(request('Bearer topsecret'))
    expect(res.status).toBe(200)
    expect(mocks.runIndexWorkerOnce).toHaveBeenCalledOnce()
  })

  it('Bearer 가 틀리면 401 이고 워커를 부르지 않는다', async () => {
    expect((await GET(request('Bearer wrong'))).status).toBe(401)
    expect(mocks.runIndexWorkerOnce).not.toHaveBeenCalled()
  })

  it('헤더가 없으면 401', async () => {
    expect((await GET(request())).status).toBe(401)
  })

  it('CRON_SECRET 이 미설정이면 존재를 숨긴다(404)', async () => {
    vi.stubEnv('CRON_SECRET', '')
    expect((await GET(request('Bearer topsecret'))).status).toBe(404)
    expect(mocks.runIndexWorkerOnce).not.toHaveBeenCalled()
  })

  it('워커 플래그가 꺼져 있으면 404', async () => {
    vi.stubEnv('CHAT_V2_INDEX_WORKER_ENABLED', 'false')
    expect((await GET(request('Bearer topsecret'))).status).toBe(404)
  })

  it('프로젝트 조회가 실패하면 503 — 빈 스코프로 위장하지 않는다', async () => {
    mocks.createAdminClient.mockReturnValue({
      from: () => ({ select: () => ({ limit: async () => ({ data: null, error: { message: 'boom' } }) }) }),
    })
    expect((await GET(request('Bearer topsecret'))).status).toBe(503)
    expect(mocks.runIndexWorkerOnce).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: 실패를 확인한다**

Run: `npx vitest run tests/actions/cron-ai-index.test.ts`
Expected: FAIL — `Cannot find module '@/app/api/cron/ai-index/route'`

- [ ] **Step 3: 크론 어댑터를 만든다**

먼저 `src/app/api/cron/inbox-retention/route.ts`를 읽고 **상수시간 비교 헬퍼(`secretMatches`,
createHash + timingSafeEqual)를 그대로 가져온다.** 평문 `!==` 비교는 타이밍 정보를 흘린다.

시크릿 미설정 시의 응답만 다르게 간다 — inbox-retention 은 503, 이쪽은 **404**로 존재를 숨긴다
(기존 `/api/chat/index/worker` 의 태도를 따른다). 그 차이를 코드 주석에 근거로 남긴다.

```ts
// src/app/api/cron/ai-index/route.ts
import { NextResponse, type NextRequest } from 'next/server'
import { runIndexWorkerOnce } from '@/lib/ai/index/worker'
import { createAdminClient } from '@/lib/supabase/admin'

/**
 * Vercel 크론 → 색인 워커 어댑터.
 *
 * 기존 /api/chat/index/worker 는 POST + x-cron-secret 헤더로 인증하는데
 * Vercel 크론은 GET + Authorization: Bearer $CRON_SECRET 을 보낸다. 규약이
 * 달라 크론이 그 라우트를 직접 못 부른다. 로직은 중복하지 않고 그대로 위임한다.
 */
export const dynamic = 'force-dynamic'

const BATCH = 25

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET
  // 시크릿이 없으면 존재 자체를 숨긴다(기존 워커 라우트와 같은 태도).
  if (!secret) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 })
  if (process.env.CHAT_V2_INDEX_WORKER_ENABLED !== 'true') {
    return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 })
  }
  // 상수시간 비교 — inbox-retention 이 쓰는 관용구를 그대로 가져온다.
  // (404/503 은 다르다: 이쪽은 워커 라우트의 태도를 따라 존재를 숨긴다.)
  if (!secretMatches(request.headers.get('authorization'), secret)) {
    return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 })
  }

  // runIndexWorkerOnce 는 모든 I/O 를 주입받는 순수 오케스트레이션이다.
  // 어댑터 3종 조립은 /api/chat/index/worker/route.ts:101-107 과 동일하게 한다.
  const admin = createAdminClient()
  const projectsResult = await admin.from('projects').select('id').limit(100)
  // 조회 실패를 빈 스코프로 위장하면 "처리할 것이 없다" 로 보이는 조용한 무동작이 된다.
  if (projectsResult.error) {
    console.error('[cron/ai-index] 프로젝트 조회 실패:', projectsResult.error)
    return NextResponse.json({ error: 'PROJECTS_READ_FAILED' }, { status: 503 })
  }
  const allowedProjectIds = (projectsResult.data as Array<{ id?: unknown }> ?? [])
    .map(row => (typeof row.id === 'string' ? row.id : ''))
    .filter(Boolean)
  const accessScope = { allowedProjectIds, allowGlobal: true }

  const summary = await runIndexWorkerOnce({
    queue: createSupabaseIndexJobQueue(admin, accessScope),
    index: createSupabasePgvectorKnowledgeIndex(admin, accessScope),
    loadContent: createSupabaseIndexContentLoader(admin),
    batchSize: BATCH,
  })
  return NextResponse.json({ ok: true, ...summary })
}
```

import 는 다음과 같다:

```ts
import { runIndexWorkerOnce } from '@/lib/ai/index/worker'
import { createSupabaseIndexContentLoader } from '@/lib/ai/index/content'
import {
  createSupabaseIndexJobQueue,
  createSupabasePgvectorKnowledgeIndex,
} from '@/lib/ai/index/pgvector'
```

**정확한 export 위치를 `pgvector.ts`에서 확인하고 맞춘다.** 요약 필드는
`{ claimed, upserted, deleted, failed, requeued }`다(`worker.ts:52`).

- [ ] **Step 4: `vercel.json`에 크론을 단다**

```json
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "regions": ["icn1"],
  "crons": [
    { "path": "/api/cron/inbox-retention", "schedule": "0 19 * * *" },
    { "path": "/api/cron/ai-index", "schedule": "*/30 * * * *" }
  ]
}
```

- [ ] **Step 5: 통과를 확인한다**

Run: `npx vitest run tests/actions/cron-ai-index.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 6: 운영 env 를 설정한다**

Task 1에서 확인한 값에 따라 없는 것만 추가한다.

Task 1 실측 결과(2026-08-14): `CRON_SECRET` 은 **이미 있고**(19일 전 설정) 나머지 셋은 없다.

```bash
vercel env add CHAT_V2_INDEX_WORKER_ENABLED production   # 값: true
vercel env add CHAT_V2_INDEX_CRON_SECRET production      # 값: 새로 생성한 난수
vercel env add CHAT_V2_INDEX_ENQUEUE_ENABLED production  # 값: true  ← Task 10 이 이것 없이는 영구 no-op
```

**스테이징(`dflow-staging`)은 별도 Vercel 프로젝트다.** Task 11 이 스테이징에 백필을 돌리므로
그쪽에도 `CHAT_V2_INDEX_WORKER_ENABLED` · `CHAT_V2_INDEX_CRON_SECRET` 을 설정해야 한다.
안 하면 워커 라우트가 404 를 돌려준다(`route.ts:70,73`).

- [ ] **Step 7: 커밋**

```bash
git add vercel.json src/app/api/cron/ai-index/route.ts tests/actions/cron-ai-index.test.ts
git commit -m "feat(index): 색인 워커에 크론을 붙인다

워커 라우트는 이미 있었는데 부르는 사람이 없어 ai_documents 가 비어 있었다.
기존 라우트는 POST + x-cron-secret 이고 Vercel 크론은 GET + Bearer 라
규약이 달라 얇은 어댑터를 둔다 — 로직은 위임만 한다."
```

---

## Task 10: enqueue 배선

**Files:**
- Modify: `src/lib/ai/index/enqueue.ts` (호출 계약 확인만, 변경 없을 수 있음)
- Modify: 원천 쓰기 경로 — `src/app/actions/minutes.ts` · `src/app/actions/issues.ts` · `src/app/actions/wbs.ts` · `src/app/actions/announcements.ts`
- Test: `tests/ai/index-enqueue-wiring.test.ts`

**Interfaces:**
- Consumes:
  ```ts
  // src/lib/ai/index/enqueue.ts — 실측 시그니처
  export async function enqueueIndexMutationBestEffort(
    queue: Pick<IndexJobQueue, 'enqueue'>,
    mutations: readonly IndexMutation[],
  ): Promise<void>
  ```
  큐 어댑터는 `createSupabaseIndexJobQueue(admin, accessScope)`(`./pgvector`)로 만든다.
- Produces: 없음

**배선하지 않으면 백필 직후부터 색인이 굳는다.** `enqueue.ts:14`는
`CHAT_V2_INDEX_ENQUEUE_ENABLED !== 'true'`면 완전한 no-op이고, 호출부가 src 전체에 0건이다.

> ⚠️ **이 작업은 명시적 설계 결정을 뒤집는다.** `enqueue.ts`의 주석은
> *"이번 단계에서는 운영 쓰기 경로에 배선하지 않는다(별도 승인 후 연결)"*라고 적혀 있다.
> 원저자가 승인 게이트를 의도적으로 둔 것이므로, **배선 전에 사용자 승인을 받고**
> 그 사실을 커밋 메시지에 남긴다. 승인 없이 진행하지 않는다.

- [ ] **Step 1: 배선 승인을 받는다**

사용자에게 확인한다: "`enqueue.ts`에 '별도 승인 후 연결' 주석이 있습니다. 원천 쓰기 경로
4곳에 배선해도 될까요? 플래그가 꺼져 있으면 no-op이라 배선 자체로는 동작이 안 바뀝니다."

**승인 전에는 다음 단계로 가지 않는다.**

- [ ] **Step 2: 실패하는 테스트를 쓴다**

```ts
// tests/ai/index-enqueue-wiring.test.ts
import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import { enqueueIndexMutationBestEffort } from '@/lib/ai/index/enqueue'

function source(path: string): string {
  return readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8')
}

describe('원천 쓰기 경로가 색인 큐에 알린다', () => {
  const WIRED = [
    'src/app/actions/minutes.ts',
    'src/app/actions/issues.ts',
    'src/app/actions/wbs.ts',
    'src/app/actions/announcements.ts',
  ]

  // 문자열 검사는 배선 누락만 잡는 얕은 그물이다. 주석에 이름을 적어도 통과하므로
  // 이것만으로는 부족하다 — 아래 행동 테스트가 실제 계약을 검증한다.
  it.each(WIRED)('%s 가 enqueue 를 부른다', path => {
    expect(source(path)).toMatch(/enqueueIndexMutationBestEffort/)
  })
})

describe('enqueue 계약 — 무엇을 어떤 형태로 넣는가', () => {
  it('플래그가 켜져 있으면 mutation 을 그대로 큐에 넣는다', async () => {
    vi.stubEnv('CHAT_V2_INDEX_ENQUEUE_ENABLED', 'true')
    const enqueue = vi.fn(async () => ({ ok: true as const }))
    await enqueueIndexMutationBestEffort({ enqueue }, [{
      operation: 'upsert', domain: 'minutes', entityType: 'minute',
      entityId: 'm1', projectId: 'p1',
    }])
    expect(enqueue).toHaveBeenCalledWith([expect.objectContaining({
      operation: 'upsert', domain: 'minutes', entityType: 'minute', entityId: 'm1',
    })])
  })

  it('플래그가 꺼져 있으면 큐를 건드리지 않는다', async () => {
    vi.stubEnv('CHAT_V2_INDEX_ENQUEUE_ENABLED', 'false')
    const enqueue = vi.fn()
    await enqueueIndexMutationBestEffort({ enqueue }, [{
      operation: 'upsert', domain: 'minutes', entityType: 'minute',
      entityId: 'm1', projectId: 'p1',
    }])
    expect(enqueue).not.toHaveBeenCalled()
  })

  it('큐가 던져도 호출부로 전파하지 않는다 — 색인 실패가 업무 쓰기를 되돌리면 안 된다', async () => {
    vi.stubEnv('CHAT_V2_INDEX_ENQUEUE_ENABLED', 'true')
    const enqueue = vi.fn(async () => { throw new Error('boom') })
    await expect(enqueueIndexMutationBestEffort({ enqueue }, [{
      operation: 'upsert', domain: 'minutes', entityType: 'minute',
      entityId: 'm1', projectId: 'p1',
    }])).resolves.toBeUndefined()
  })
})
```

- [ ] **Step 3: 실패를 확인한다**

Run: `npx vitest run tests/ai/index-enqueue-wiring.test.ts`
Expected: FAIL — 4개 경로 모두 `enqueueIndexMutationBestEffort` 미포함

- [ ] **Step 4: 각 쓰기 경로에 배선한다**

**원천 데이터를 바꾸지 않는다는 제약을 지킨다** — enqueue는 `ai_index_jobs`에만 쓴다.
각 액션의 쓰기 성공 직후, 응답 반환 전에 넣는다. 예(회의록 본문 커밋 경로):

```ts
  // 색인 큐에 알린다. CHAT_V2_INDEX_ENQUEUE_ENABLED 가 꺼져 있으면 no-op 이므로
  // 배선 자체는 동작을 바꾸지 않는다. 실패해도 원천 쓰기를 되돌리지 않는다 —
  // 색인은 나중에 정합성 점검(consistency)이 따라잡는다.
  await enqueueIndexMutationBestEffort(
    createSupabaseIndexJobQueue(admin, { allowedProjectIds: [projectId], allowGlobal: false }),
    [{ operation: 'upsert', domain: 'minutes', entityType: 'minute', entityId: minuteId, projectId }],
  )
```

`issues`/`wbs`/`announcements`도 같은 형태로 `domain`·`entityType`만 바꾼다:
`issues`/`issue` · `wbs`/`wbs_item` · `announcements`/`announcement`.

`enqueueIndexMutationBestEffort`는 **절대 throw 하지 않는다**(enqueue.ts:19-25가 내부에서
전부 삼킨다). 그래서 호출부에 `.catch()`를 덧붙일 필요가 없다 — 붙이면 이미 삼킨 것을
한 번 더 감싸는 죽은 코드가 된다.

`IndexMutation`의 정확한 필드는 `src/lib/ai/index/types.ts`에서 확인하고 맞춘다.

- [ ] **Step 5: 통과를 확인한다**

Run: `npx vitest run tests/ai/index-enqueue-wiring.test.ts && npx vitest run tests/actions/ 2>&1 | tail -10`
Expected: PASS — 새 테스트 5건 + 기존 액션 테스트 회귀 없음

- [ ] **Step 6: 커밋**

```bash
git add src/app/actions/minutes.ts src/app/actions/issues.ts src/app/actions/wbs.ts \
        src/app/actions/announcements.ts tests/ai/index-enqueue-wiring.test.ts
git commit -m "feat(index): 원천 쓰기 경로를 색인 큐에 연결

enqueue 는 있는데 부르는 곳이 0건이라 백필 직후부터 색인이 굳는다. 플래그가
꺼져 있으면 no-op 이므로 배선만으로는 동작이 바뀌지 않는다. enqueue 실패가
원천 쓰기를 되돌리지 않게 삼킨다 — 정합성 점검이 나중에 따라잡는다."
```

---

## Task 11: 백필 실행

**Files:**
- Create: `scripts/index-backfill.mjs`
- 코드 테스트 없음 (운영 스크립트). 검증은 실행 결과로 한다.

**Interfaces:**
- Consumes: `/api/chat/index/worker`의 `mode: 'backfill'`
- Produces: `ai_documents` 행

**인가(Task 2·8)가 먼저다.** `0031:67-72`가 정한 게이트다.

> ⚠️ **이 태스크는 배포된 URL 에 대고 돈다 — 로컬 커밋만으로는 성립하지 않는다.**
> 백필이 옳게 돌려면 다음이 그 환경에 **배포돼 있어야** 한다:
> - Task 4(회의록 스코프 skew 수정) — 없으면 회의록 47/67 이 dead_letter
> - Task 5(이슈 로더 + `INDEX_BACKFILL_DOMAINS`) — 없으면 이슈가 한 건도 안 들어감
> - Task 9(워커 env) — 없으면 워커 라우트가 404
>
> 따라서 스테이징 백필 전에 **Task 4·5·9 커밋을 `staging` 브랜치로 push** 해 배포를 받고,
> `dflow-staging` Vercel 프로젝트에도 워커 env 2종을 설정한다.
> 운영 백필 전에는 **main push + 운영 env 설정**이 선행돼야 한다.

- [ ] **Step 1: 러너를 만든다**

```js
// scripts/index-backfill.mjs
// 초기 백필 러너 — 기존 /api/chat/index/worker 의 mode:'backfill' 을 호출한다.
// Vercel 함수 타임아웃 안에 2,200건이 안 끝나므로 로컬에서 나눠 돌린다.
// content_hash 가 있어 재실행이 멱등이다 — 중단해도 다시 돌리면 된다.
import { setTimeout as sleep } from 'node:timers/promises'

const args = process.argv.slice(2)
const flag = (name, fallback) => {
  const hit = args.find(a => a.startsWith(`--${name}=`))
  return hit ? hit.slice(name.length + 3) : fallback
}

const BASE = flag('base', 'http://localhost:3000')
const SECRET = process.env.CHAT_V2_INDEX_CRON_SECRET
const DOMAINS = flag('domains', 'minutes,issues,wbs,announcements').split(',')
const BATCH = Number(flag('batch', '25'))
const PAUSE_MS = Number(flag('pause', '3000'))

if (!SECRET) {
  console.error('✗ CHAT_V2_INDEX_CRON_SECRET 이 필요합니다.')
  process.exit(1)
}

async function call(body) {
  const res = await fetch(`${BASE}/api/chat/index/worker`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-cron-secret': SECRET },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`)
  return res.json()
}

for (const domain of DOMAINS) {
  console.log(`\n=== ${domain} 큐잉 ===`)
  // route.ts:114-121 실측 형태 — { mode, domain, projectId?, dryRun?, batchSize? }
  console.log(JSON.stringify(await call({ mode: 'backfill', domain })))
}

console.log('\n=== 워커 반복 실행 ===')
let round = 0
for (;;) {
  const summary = await call({ mode: 'worker', batchSize: BATCH })
  round += 1
  console.log(`#${round}`, JSON.stringify(summary))
  // 요약은 { mode, claimed, upserted, deleted, failed, requeued } 로 평탄하게 온다
  // (route.ts:108 `{ mode: 'worker', ...summary }`). 처리할 것이 없으면 끝.
  if (!summary?.claimed) break
  await sleep(PAUSE_MS)   // 무료 티어 한도를 넘지 않도록 간격을 둔다
}
console.log('\n백필 완료')
```

요청 형태는 `src/app/api/chat/index/worker/route.ts:101-121` 실측 기준이다 —
worker 는 `{ mode, batchSize }`, backfill 은 `{ mode, domain, projectId?, dryRun?, batchSize? }`.
`domain` 은 `INDEX_BACKFILL_DOMAINS` 값(`wbs`·`weekly`·`meetings`·`announcements`·`minutes`,
Task 5 이후 `issues`)이며 **엔티티 타입이 아니다.**

- [ ] **Step 2: 임베딩 무료 한도를 실측한다** (전량 전에 반드시)

회의록 한 도메인만, 작은 배치로 먼저 돌려 소요 시간과 429 발생 여부를 잰다.

```bash
CHAT_V2_INDEX_CRON_SECRET=... node scripts/index-backfill.mjs \
  --base=https://dflow-staging.vercel.app --domains=minutes --batch=10 --pause=5000
```

기록할 것: 배치당 소요 시간 · 429 횟수 · 성공/실패 건수.
**이 값으로 `--batch`와 `--pause`를 정한 뒤에 전량을 돌린다.** 무료 티어 한도는 미실측이다.

- [ ] **Step 3: 스테이징에서 전량 백필**

```bash
CHAT_V2_INDEX_CRON_SECRET=... node scripts/index-backfill.mjs --base=https://dflow-staging.vercel.app
```

- [ ] **Step 4: 스테이징 결과를 검증한다**

```sql
select domain, entity_type, count(*) chunks, count(distinct entity_id) docs,
       count(embedding) embedded
from public.ai_documents group by 1,2 order by chunks desc;

select status, count(*) from public.ai_index_jobs group by 1;
```

**합격 기준** — 셋 다 참이어야 한다:
1. `dead_letter` 0건 (있으면 `last_error` 를 읽고 Task 4·5 로 돌아간다)
2. 회의록 문서 수가 원천 건수와 일치
3. **`count(embedding) = count(*)`** — 임베딩이 실제로 붙었는가

3번이 없으면 **거짓 통과한다.** `embedDocuments` 는 API 키가 없으면 호출조차 하지 않고
`null` 을 돌려주므로(`provider.ts` 의 `embedConfig().apiKey` 분기), 모든 청크가
`embedding = null` 인 채로 들어가고 1·2번은 그대로 통과한다. 그 상태에서는 의미 검색이
전혀 동작하지 않는데 아무도 못 잡는다.

```sql
select domain, count(*) chunks, count(embedding) embedded
from public.ai_documents group by 1 order by chunks desc;
```

`embedded` 가 `chunks` 보다 작으면 **해당 환경에 `GEMINI_API_KEY` 가 있는지 먼저 확인한다.**
스테이징에 키가 없으면 한도 실측은 운영 소량 배치로 옮긴다
(`--domains=announcements --batch=5` — 공지는 5건이라 안전하다).

- [ ] **Step 5: 운영 백필**

같은 명령을 `--base=https://wbs-web.vercel.app`으로. 같은 검증을 반복한다.

- [ ] **Step 6: 커밋**

```bash
git add scripts/index-backfill.mjs
git commit -m "chore(index): 초기 백필 로컬 러너

Vercel 함수 타임아웃 안에 2,200건이 안 끝나 로컬에서 나눠 돌린다.
content_hash 덕에 재실행이 멱등이라 중단해도 이어서 돌리면 된다."
```

---

## Task 12: 검색 화면

**Files:**
- Create: `src/lib/domain/searchView.ts` (순수 — 응답 → 화면 상태 매핑)
- Create: `src/components/wiki/WikiSearchResults.tsx` (순수 표시 — 상태를 props 로 받는다)
- Create: `src/components/wiki/WikiSearch.tsx` (클라이언트 셸 — fetch·상태 소유)
- Modify: `src/app/(app)/p/[projectId]/wiki/page.tsx`
- Modify: `src/lib/i18n/dict/wiki.ts` (ko/en 양쪽)
- Test: `tests/domain/search-view.test.ts`
- Test: `tests/ui/wiki-search-results.test.tsx`

**Interfaces:**
- Consumes: `POST /api/wiki/search`(Task 8) — 응답 `{ results: FusedDocument[]; degraded: boolean }`
- Produces:
  ```ts
  // src/lib/domain/searchView.ts
  export interface SearchHit {
    domain: string; entityType: string; entityId: string
    title: string; content: string; href: string
    occurredOn: string | null; score: number; matchedBy: string[]
  }
  export type SearchViewState =
    | { kind: 'idle' }
    | { kind: 'loading' }
    | { kind: 'done'; hits: SearchHit[]; degraded: boolean }
    | { kind: 'error' }
  export function toSearchViewState(
    response: { ok: boolean; status: number; body: unknown },
  ): SearchViewState
  ```

> **테스트 전략 — 계획 초판에서 교체됨 (컨트롤러 ruling, 2026-08-14).**
> 초판은 `@testing-library/react` · `@testing-library/user-event` · `toBeInTheDocument`(jest-dom)를
> 썼는데 **이 리포에는 셋 다 설치돼 있지 않다**(devDependencies 에 `jsdom` 만 있고
> `toBeInTheDocument` 사용은 리포 전체 0건). 의존성을 새로 들이는 대신 리포 관용구를 따른다 —
> 파일 첫 줄 `// @vitest-environment jsdom` 도크블록 + `renderToStaticMarkup` + 문자열 단언
> (`toContain`, 리포에서 431회 사용).
>
> 그래서 컴포넌트를 셋으로 나눈다: 상태 매핑 순수 함수 · 상태를 props 로 받는 표시 컴포넌트 ·
> fetch 를 소유하는 클라이언트 셸. 로직은 앞의 둘에 있고 둘 다 테스트된다.
> **타이핑·Enter 같은 상호작용 자체는 자동 테스트에서 빠진다** — 그 부분은 눈으로 확인한다.

**옛 컴포넌트 파일은 지우지 않는다.** 화면만 교체해 두면 문제 시 `page.tsx` 한 줄로 되돌아간다.
파일 삭제는 2단계다.

- [ ] **Step 1: 상태 매핑의 실패하는 테스트를 쓴다**

```ts
// tests/domain/search-view.test.ts
import { describe, expect, it } from 'vitest'
import { toSearchViewState } from '@/lib/domain/searchView'

const hit = {
  domain: 'minutes', entityType: 'minute', entityId: 'm1',
  title: '정례 회의', content: '계정 발급은 IT팀 경유로 한다',
  href: '/p/x/minutes/m1', occurredOn: '2026-07-14', score: 0.9, matchedBy: ['vector'],
}

describe('toSearchViewState', () => {
  it('200 이면 결과와 degraded 를 그대로 옮긴다', () => {
    const state = toSearchViewState({ ok: true, status: 200, body: { results: [hit], degraded: false } })
    expect(state).toMatchObject({ kind: 'done', degraded: false })
    if (state.kind !== 'done') throw new Error('done 이어야 한다')
    expect(state.hits[0].entityId).toBe('m1')
  })

  it('degraded 를 잃지 않는다 — 조용히 품질을 떨어뜨리면 안 된다', () => {
    const state = toSearchViewState({ ok: true, status: 200, body: { results: [hit], degraded: true } })
    expect(state).toMatchObject({ kind: 'done', degraded: true })
  })

  it('503 은 error 다 — 결과 없음으로 위장하지 않는다', () => {
    expect(toSearchViewState({ ok: false, status: 503, body: { error: 'VECTOR_SEARCH_FAILED' } }))
      .toEqual({ kind: 'error' })
  })

  it('403 도 error 다', () => {
    expect(toSearchViewState({ ok: false, status: 403, body: { error: 'PROJECT_FORBIDDEN' } }))
      .toEqual({ kind: 'error' })
  })

  it('200 인데 본문 형태가 깨졌으면 error 다 — 빈 결과로 넘기지 않는다', () => {
    expect(toSearchViewState({ ok: true, status: 200, body: null })).toEqual({ kind: 'error' })
    expect(toSearchViewState({ ok: true, status: 200, body: { results: 'nope' } })).toEqual({ kind: 'error' })
  })

  it('결과 0건은 정상 done 이다', () => {
    expect(toSearchViewState({ ok: true, status: 200, body: { results: [], degraded: false } }))
      .toEqual({ kind: 'done', hits: [], degraded: false })
  })
})
```

- [ ] **Step 2: 실패를 확인한다**

Run: `npx vitest run tests/domain/search-view.test.ts`
Expected: FAIL — `Cannot find module '@/lib/domain/searchView'`

- [ ] **Step 3: 상태 매핑을 구현한다**

```ts
// src/lib/domain/searchView.ts

/**
 * 검색 응답 → 화면 상태. 컴포넌트에서 떼어낸 이유는 이것이 이 화면의 유일한 분기 로직이고,
 * 리포의 UI 테스트 관용구(renderToStaticMarkup)로는 fetch 분기를 검증할 수 없기 때문이다.
 */
export interface SearchHit {
  domain: string
  entityType: string
  entityId: string
  title: string
  content: string
  href: string
  occurredOn: string | null
  score: number
  matchedBy: string[]
}

export type SearchViewState =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'done'; hits: SearchHit[]; degraded: boolean }
  | { kind: 'error' }

function isHit(value: unknown): value is SearchHit {
  if (typeof value !== 'object' || value === null) return false
  const row = value as Record<string, unknown>
  return typeof row.domain === 'string'
    && typeof row.entityId === 'string'
    && typeof row.href === 'string'
}

export function toSearchViewState(
  response: { ok: boolean; status: number; body: unknown },
): SearchViewState {
  // 실패를 "결과 없음" 으로 위장하지 않는다(에러 처리 3원칙).
  if (!response.ok) return { kind: 'error' }

  const body = response.body
  if (typeof body !== 'object' || body === null) return { kind: 'error' }
  const results = (body as Record<string, unknown>).results
  if (!Array.isArray(results)) return { kind: 'error' }

  return {
    kind: 'done',
    hits: results.filter(isHit),
    degraded: (body as Record<string, unknown>).degraded === true,
  }
}
```

- [ ] **Step 4: 통과를 확인한다**

Run: `npx vitest run tests/domain/search-view.test.ts`
Expected: PASS (6 tests)

- [ ] **Step 5: 표시 컴포넌트의 실패하는 테스트를 쓴다**

```tsx
// @vitest-environment jsdom
// tests/ui/wiki-search-results.test.tsx — 네 상태의 렌더 분기 검증
import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { WikiSearchResults } from '@/components/wiki/WikiSearchResults'
import type { SearchHit } from '@/lib/domain/searchView'

const hit: SearchHit = {
  domain: 'minutes', entityType: 'minute', entityId: 'm1',
  title: '정례 회의', content: '계정 발급은 IT팀 경유로 한다',
  href: '/p/x/minutes/m1', occurredOn: '2026-07-14', score: 0.9, matchedBy: ['vector'],
}

function html(state: Parameters<typeof WikiSearchResults>[0]['state']): string {
  return renderToStaticMarkup(<WikiSearchResults state={state} locale="ko" />)
}

describe('WikiSearchResults', () => {
  it('결과와 출처 배지를 보여준다', () => {
    const out = html({ kind: 'done', hits: [hit], degraded: false })
    expect(out).toContain('정례 회의')
    expect(out).toContain('회의록')
    expect(out).toContain('/p/x/minutes/m1')
  })

  it('degraded 를 조용히 넘기지 않고 알린다', () => {
    expect(html({ kind: 'done', hits: [hit], degraded: true })).toContain('어휘 검색만')
  })

  it('검색 실패를 결과 없음으로 위장하지 않는다', () => {
    const out = html({ kind: 'error' })
    expect(out).toContain('불러오지 못했습니다')
    expect(out).not.toContain('결과가 없습니다')
  })

  it('결과 0건이면 그렇게 말한다', () => {
    expect(html({ kind: 'done', hits: [], degraded: false })).toContain('결과가 없습니다')
  })

  it('idle 에서는 아무 안내도 띄우지 않는다', () => {
    const out = html({ kind: 'idle' })
    expect(out).not.toContain('결과가 없습니다')
    expect(out).not.toContain('불러오지 못했습니다')
  })

  it('이슈 출처는 이슈 배지로 나온다', () => {
    const out = html({ kind: 'done', degraded: false, hits: [{ ...hit, domain: 'issues', entityType: 'issue' }] })
    expect(out).toContain('이슈')
  })
})
```

- [ ] **Step 6: 실패를 확인한다**

Run: `npx vitest run tests/ui/wiki-search-results.test.tsx`
Expected: FAIL — `Cannot find module '@/components/wiki/WikiSearchResults'`

- [ ] **Step 7: i18n 키를 추가한다**

`src/lib/i18n/dict/wiki.ts`의 `wikiKo`와 `wikiEn` **양쪽에** 같은 키를 넣는다
(`Record<keyof typeof wikiKo, string>`이 컴파일 타임에 패리티를 강제한다).

```ts
  'wiki.search2.placeholder': '무엇을 찾으세요? 예: MES 권한은 어떻게 신청하지?',
  'wiki.search2.count': '결과 {n}건',
  'wiki.search2.empty': '결과가 없습니다. 다른 표현으로 찾아보세요.',
  'wiki.search2.error': '검색 결과를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.',
  'wiki.search2.degraded': '의미 검색을 쓸 수 없어 어휘 검색만으로 찾았습니다.',
  'wiki.search2.source.minutes': '회의록',
  'wiki.search2.source.issues': '이슈',
  'wiki.search2.source.wbs': 'WBS',
  'wiki.search2.source.announcements': '공지',
  'wiki.search2.source.meetings': '회의',
  'wiki.search2.source.weekly': '주간업무',
```

en 값: `'What are you looking for?'` · `'{n} results'` · `'No results. Try different wording.'` ·
`'Could not load search results. Please try again shortly.'` ·
`'Semantic search is unavailable; these are lexical matches only.'` ·
`'Minutes'` · `'Issues'` · `'WBS'` · `'Announcements'` · `'Meetings'` · `'Weekly'`

`meetings`·`weekly`까지 넣는 이유는, 기존 큐나 정합성 점검이 그 도메인을 색인해 두면
폴백 라벨 때문에 회의가 회의록으로 잘못 보이기 때문이다.

- [ ] **Step 8: 표시 컴포넌트를 만든다**

**클래스는 실측값이다** — 입력은 `app-input`(`globals.css:245`), 배지는 `chip`(wiki 컴포넌트에서
35회), 흐린 글자는 `text-ink-muted`(56회). `input`·`text-muted`·`badge`·`text-danger`는 이 리포에 없다.
**상태 변형 display 유틸(`group-hover:flex` 등)을 쓰지 않는다** — `globals.css`의 unlayered
반응형 안전망에 져서 조용히 동작하지 않는다(CLAUDE.md).

```tsx
import { t, type DictKey, type Locale } from '@/lib/i18n/dict'
import type { SearchViewState } from '@/lib/domain/searchView'

const SOURCE_KEYS: Record<string, DictKey> = {
  minutes: 'wiki.search2.source.minutes',
  issues: 'wiki.search2.source.issues',
  wbs: 'wiki.search2.source.wbs',
  announcements: 'wiki.search2.source.announcements',
  meetings: 'wiki.search2.source.meetings',
  weekly: 'wiki.search2.source.weekly',
}

export function WikiSearchResults({ state, locale }: { state: SearchViewState; locale: Locale }) {
  if (state.kind === 'idle' || state.kind === 'loading') return null

  if (state.kind === 'error') {
    return <p className="text-sm text-delayed">{t(locale, 'wiki.search2.error')}</p>
  }

  return (
    <div className="flex flex-col gap-3">
      {state.degraded && (
        <p className="text-sm text-ink-muted">{t(locale, 'wiki.search2.degraded')}</p>
      )}

      {state.hits.length === 0
        ? <p className="text-sm text-ink-muted">{t(locale, 'wiki.search2.empty')}</p>
        : (
          <>
            <p className="text-sm text-ink-muted">
              {t(locale, 'wiki.search2.count').replace('{n}', String(state.hits.length))}
            </p>
            <ul className="flex flex-col gap-3">
              {state.hits.map(hit => (
                <li key={`${hit.domain}:${hit.entityId}`} className="card p-4">
                  <a href={hit.href} className="font-medium text-brand hover:text-brand-hover">
                    {hit.title}
                  </a>
                  <p className="mt-1 text-sm text-ink-muted line-clamp-2">{hit.content}</p>
                  <div className="mt-2 flex items-center gap-2 text-xs text-ink-muted">
                    <span className="chip bg-brand-weak text-brand">
                      {SOURCE_KEYS[hit.domain] ? t(locale, SOURCE_KEYS[hit.domain]) : hit.domain}
                    </span>
                    {hit.occurredOn && <span>{hit.occurredOn}</span>}
                  </div>
                </li>
              ))}
            </ul>
          </>
        )}
    </div>
  )
}
```

`text-delayed`가 리포에 있는지 확인하고, 없으면 wiki 컴포넌트가 에러 문구에 실제로 쓰는
클래스를 grep 해서 맞춘다.

- [ ] **Step 9: 통과를 확인한다**

Run: `npx vitest run tests/ui/wiki-search-results.test.tsx tests/domain/search-view.test.ts`
Expected: PASS (6 + 6 tests)

- [ ] **Step 10: 클라이언트 셸을 만든다**

```tsx
'use client'
import { useCallback, useEffect, useRef, useState } from 'react'
import { WikiSearchResults } from './WikiSearchResults'
import { toSearchViewState, type SearchViewState } from '@/lib/domain/searchView'
import { t, type Locale } from '@/lib/i18n/dict'

export function WikiSearch({ projectId, locale, initialQuery }: {
  projectId: string
  locale: Locale
  initialQuery: string
}) {
  const [query, setQuery] = useState(initialQuery)
  const [state, setState] = useState<SearchViewState>({ kind: 'idle' })

  const run = useCallback(async (next: string) => {
    if (!next.trim()) { setState({ kind: 'idle' }); return }
    setState({ kind: 'loading' })
    try {
      const res = await fetch('/api/wiki/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId, q: next }),
      })
      const body = await res.json().catch(() => null)
      setState(toSearchViewState({ ok: res.ok, status: res.status, body }))
    } catch {
      setState({ kind: 'error' })
    }
  }, [projectId])

  // ?q= 딥링크로 들어오면 한 번은 실제로 검색해 준다. 안 하면 검색어만 채워지고 결과가 빈다.
  const ranInitial = useRef(false)
  useEffect(() => {
    if (ranInitial.current || !initialQuery.trim()) return
    ranInitial.current = true
    void run(initialQuery)
  }, [initialQuery, run])

  return (
    <div className="flex flex-col gap-4">
      <input
        type="search"
        value={query}
        onChange={event => setQuery(event.target.value)}
        onKeyDown={event => { if (event.key === 'Enter') void run(query) }}
        placeholder={t(locale, 'wiki.search2.placeholder')}
        className="app-input w-full"
      />
      <WikiSearchResults state={state} locale={locale} />
    </div>
  )
}
```

- [ ] **Step 11: `page.tsx`를 교체한다**

현행 화면은 `projectId` 접근 검증을 하지 않는다. 검색이 회의록 본문을 스니펫으로 내보내므로
여기서 함께 막는다. **다만 조회 실패를 404로 위장하지 않는다** — `listProjects()`가 실패 시
조용히 `[]`를 돌려주는 구조라면, 그 구분이 가능한 API를 쓰거나 서버에서 접근 범위를 직접 판정한다.

먼저 `src/app/actions/project.ts`의 `listProjects` 가 조회 실패를 어떻게 다루는지 읽고,
실패와 "없음"이 구분되지 않으면 `createSupabaseAccessScopeResolver`로 판정한다.

교체 시 **더는 쓰지 않는 import를 전부 제거한다** — `getWikiOverview` · `WikiOverview` ·
`WIKI_VIEWS` · `parseView` · `parseQuestionId` · `isProjectAdmin` · `isProjectMember` ·
`getActorForView`. 남기면 `no-unused-vars`로 lint가 깨진다(Step 12가 lint 에러 0을 요구한다).
`notFound()`를 쓴다면 `import { notFound } from 'next/navigation'`을 추가한다.

- [ ] **Step 12: 전체 검증**

Run: `npx vitest run 2>&1 | tail -6`
Run: `npm run lint 2>&1 | tail -6`
Run: `npx tsc --noEmit 2>&1 | grep -c "error TS"`

Expected: 테스트 전량 PASS · lint 에러 0 · tsc 에러가 착수 전(20건)보다 늘지 않음

- [ ] **Step 13: 커밋**

```bash
git add src/lib/domain/searchView.ts src/components/wiki/WikiSearchResults.tsx \
        src/components/wiki/WikiSearch.tsx "src/app/(app)/p/[projectId]/wiki/page.tsx" \
        src/lib/i18n/dict/wiki.ts tests/domain/search-view.test.ts \
        tests/ui/wiki-search-results.test.tsx
git commit -m "feat(wiki): 화면을 검색 하나로 교체

옛 섹션은 화면에서 빠지되 컴포넌트 파일은 남긴다 — 문제가 생기면 page.tsx
한 줄로 되돌아간다. 현행 화면이 하지 않던 projectId 접근 검증을 함께 넣는다.

상태 매핑을 순수 함수로 떼어낸 이유는 이 리포에 testing-library 가 없어
fetch 분기를 컴포넌트 테스트로 검증할 수 없기 때문이다. 로직은 순수 함수와
표시 컴포넌트에 있고 둘 다 테스트된다."
```

---

## Task 13: 평가 세트와 측정

**Files:**
- Create: `tests/search/eval-set.json`
- Create: `scripts/search-eval.mjs`
- 코드 테스트 없음 (측정 도구)

**Interfaces:**
- Consumes: `POST /api/wiki/search`(Task 8) · `POST /api/wiki/ask`(기준선)
- Produces: Recall@10 · MRR 비교표

**사용자에게 실패 사례를 요청해야 한다.** "표현이 달라서 못 찾은" 경우를 우선 수집한다.

- [ ] **Step 1: 사용자에게 실패 사례를 받는다**

물어볼 것: 검색어로 무엇을 쳤고, 실제로 찾고 싶었던 내용이 무엇이었는지. 3~5건이면 시작할 수 있다.
**받기 전에는 다음 단계로 가지 않는다** — 지어낸 질문으로 만든 평가 세트는 아무것도 재지 못한다.

- [ ] **Step 2: 평가 세트를 만든다**

```json
{
  "version": 1,
  "note": "어휘 불일치 사례를 우선 수집한다. expect 의 id 는 운영 DB 실측값이어야 한다.",
  "cases": [
    {
      "q": "MES 권한은 어떻게 신청하지?",
      "why": "검색어는 '권한 신청', 본문은 '계정 발급 요청' — 어휘 불일치",
      "expect": [{ "domain": "minutes", "entityId": "PUT-REAL-UUID-HERE" }]
    }
  ]
}
```

- [ ] **Step 3: 측정 스크립트를 만든다**

```js
// scripts/search-eval.mjs
// 검색 품질 측정 — Recall@10 · MRR.
// 기준선은 /api/wiki/ask 하나로 고정한다(현행 검색이 4벌이라 '현행'이 모호하다).
import { readFileSync } from 'node:fs'

const BASE = process.argv.find(a => a.startsWith('--base='))?.slice(7) ?? 'http://localhost:3000'
const PROJECT = process.argv.find(a => a.startsWith('--project='))?.slice(10)
const COOKIE = process.env.EVAL_COOKIE   // 로그인 세션 쿠키

if (!PROJECT || !COOKIE) {
  console.error('사용법: EVAL_COOKIE=... node scripts/search-eval.mjs --project=<uuid> [--base=URL]')
  process.exit(1)
}

const set = JSON.parse(readFileSync(new URL('../tests/search/eval-set.json', import.meta.url), 'utf8'))

async function post(path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', cookie: COOKIE },
    body: JSON.stringify(body),
  })
  if (!res.ok) return null
  return res.json()
}

function score(hitIds, expected) {
  const wanted = new Set(expected.map(e => `${e.domain}:${e.entityId}`))
  const top10 = hitIds.slice(0, 10)
  const recall = top10.some(id => wanted.has(id)) ? 1 : 0
  const rank = top10.findIndex(id => wanted.has(id))
  return { recall, rr: rank === -1 ? 0 : 1 / (rank + 1) }
}

const totals = { next: { recall: 0, rr: 0 }, base: { recall: 0, rr: 0 } }

for (const testCase of set.cases) {
  const next = await post('/api/wiki/search', { projectId: PROJECT, q: testCase.q })
  const nextIds = (next?.results ?? []).map(r => `${r.domain}:${r.entityId}`)
  const nextScore = score(nextIds, testCase.expect)

  const base = await post('/api/wiki/ask', { projectId: PROJECT, question: testCase.q })
  // ask 의 응답 형태에 맞춰 출처 id 를 뽑는다. 실제 필드명을 라우트에서 확인할 것.
  const baseIds = (base?.sources ?? []).map(s => `${s.domain ?? 'minutes'}:${s.id}`)
  const baseScore = score(baseIds, testCase.expect)

  totals.next.recall += nextScore.recall; totals.next.rr += nextScore.rr
  totals.base.recall += baseScore.recall; totals.base.rr += baseScore.rr

  console.log(`${nextScore.recall ? '✓' : '✗'} (기준선 ${baseScore.recall ? '✓' : '✗'})  ${testCase.q}`)
}

const n = set.cases.length
console.log(`\n         Recall@10   MRR`)
console.log(`기준선   ${totals.base.recall}/${n}        ${(totals.base.rr / n).toFixed(3)}`)
console.log(`새 검색  ${totals.next.recall}/${n}        ${(totals.next.rr / n).toFixed(3)}`)
```

- [ ] **Step 4: 기준선을 측정한다** (백필 전)

```bash
EVAL_COOKIE="..." node scripts/search-eval.mjs --project=<D-CUBE uuid>
```

기록한다. 기준선이 낮은 것은 코퍼스가 31건이기 때문이지 알고리즘 때문이 아니다.

- [ ] **Step 5: 백필 후 다시 측정한다**

같은 명령. 개선폭을 기록한다.

- [ ] **Step 6: 알고리즘만의 효과를 3자 비교한다**

`/api/wiki/search`에 임시 플래그를 주거나 스크립트에서 두 다리를 개별 호출해
`벡터만` · `어휘만` · `두 다리`를 비교한다. 이 결과로 `RRF_K`와 후보 수 `N`을 정한다.

- [ ] **Step 7: 커밋**

```bash
git add tests/search/eval-set.json scripts/search-eval.mjs
git commit -m "test(search): 평가 세트와 측정 스크립트

'좋아진 것 같다' 가 아니라 숫자로 말하기 위한 도구다. 기준선은 /api/wiki/ask
하나로 고정한다 — 현행 검색이 4벌이라 '현행' 이 모호하다. 기준선 점수가 낮은
것은 코퍼스가 31건이라서지 알고리즘 때문이 아니므로, 알고리즘 효과는 새 코퍼스
위에서 벡터만·어휘만·두 다리 3자 비교로 본다."
```

---

## 완료 기준

1단계가 끝났다고 말하려면 전부 참이어야 한다.

- [ ] **0083이 스테이징·운영 양쪽에 적용됨** (`match_ai_documents_lexical` 존재 확인)
- [ ] `ai_documents`에 회의록·이슈·WBS·공지 문서가 들어 있고 `ai_index_jobs`의 `dead_letter`가 0건
- [ ] **`count(embedding) = count(*)`** — 임베딩이 실제로 붙었다(키 부재 거짓 통과 방지)
- [ ] 회의록 문서 수 = 원천 건수 (Task 4의 skew가 실제로 해소됐다는 증거)
- [ ] **원천을 한 건 수정하면 `ai_index_jobs`에 pending 이 생긴다** (Task 10 배선 + `ENQUEUE_ENABLED` 확인)
- [ ] `/api/wiki/search`가 다른 프로젝트 요청에 403을 낸다 (테스트로 고정됨)
- [ ] 검색 결과에 같은 문서가 청크로 중복되지 않는다
- [ ] 평가 세트 측정치가 기록돼 있다 (기준선 / 새 검색 / 3자 비교)
- [ ] `npm run test` 전량 통과 · `npm run lint` 에러 0 · `tsc` 에러가 착수 전보다 늘지 않음
- [ ] `npm run smoke:prod` 통과

## 2단계로 미루는 것

주간업무 색인 · 요약 버튼 · 옛 컴포넌트 파일 삭제 · 주제 상세 라우트 제거 ·
챗봇 `search_wiki` 재배선 · 죽은 i18n 키 정리.
