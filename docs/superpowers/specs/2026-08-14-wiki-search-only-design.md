# 프로젝트 Wiki — 검색 전용 축소 설계

작성 2026-08-14 · 기준 커밋 `c44e8be` · 운영 실측 포함

---

## 1. 배경

사용자 요구는 둘이다.

> "다른 기능은 필요없고 이 프로젝트에 추가되는 각종 정보들에 대해서 지식검색이 가능한
> 수준으로만 유지하고 싶어. (…) 다른 기능들 다 제거하고 지식 검색기능의 정확도를
> 최대한 높여서 활용성을 극대화 하고 싶어"

실패 유형을 물었을 때 답은 명확했다 — **"표현이 달라서 못 찾는 경우가 제일 많다."**
검색어와 본문의 어휘가 다르면 못 찾는다는 뜻이고, 문자열 매칭으로는 원리적으로 풀 수 없다.

## 2. 운영 실측 — 설계의 전제

2026-08-14 운영 DB(`rglfgrwwwwdqejohdnty`) 읽기 전용 조회 결과다. **이 숫자들이 설계를 결정했다.**

### 2.1 검색할 내용이 사실상 없다

```
wiki_items 2,299건
  archived    2,268  (98.7%)   ← 화면·봇·Ask 어디에도 안 나온다
  active         13
  open           17
  conflicted      1
              ─────
  실제 검색 가능   31건

wiki_topics 423건 중 body_md 있는 것    0건
wiki_questions                          0건
```

`archived` 2,268건은 2026-07-26 ~ 08-04에 걸쳐 여러 차례 나뉘어 밀려났고 `valid_to`는
**한 건도 설정돼 있지 않다**. 유효기간 종료가 아니라 재구축이 이전 세대를 밀어낸 흔적이다.
그 재구축은 완주하지 못했다:

```
wiki_processing_jobs       done 52 · pending 7 · running 1 (2026-08-03 멈춤)
wiki_project_rebuild_jobs  pending 2 (2026-08-11부터 방치)
```

**밀어내기만 하고 새로 채우지 못한 채 멈춰 있다.** "활용도가 전혀 없다"의 직접 원인이다.
검색 알고리즘을 아무리 고쳐도 코퍼스가 31건이면 소용없다.

### 2.2 필요한 인프라는 이미 설치돼 있고, 비어 있다

```
ai_documents          존재 · HNSW 인덱스 존재 · 행 0건
ai_index_jobs         pending 96건 (minute upsert 50 + delete 46) — 2026-08-13 까지 계속 쌓이는 중
match_ai_documents    존재 (순수 벡터)
replace_ai_document_chunks  존재
runIndexWorkerOnce()  존재 (worker.ts:51)
워커 라우트           존재 (/api/chat/index/worker, worker·backfill·consistency 3모드)
하이브리드 융합       존재 (hybrid.ts — 단 RRF 아님, 가중합)
백필 러너             존재 (backfill.ts:45 runIndexBackfill)
정합성 점검           존재 (consistency.ts)
enqueue(TS)           존재하나 호출부 0건 (enqueue.ts) — 단 DB RPC 가 회의록을 이미 큐잉한다(§2.2.2)
vercel.json crons     inbox-retention 하나뿐
```

**`ai_documents`가 빈 이유는 코드 부재가 아니라 스위치가 꺼져 있고 아무도 부르지 않아서다.**

```
CHAT_V2_INDEX_WORKER_ENABLED   !== 'true' → 라우트가 404 (route.ts:70)
CHAT_V2_INDEX_CRON_SECRET      미설정     → 라우트가 404 (route.ts:73)
CHAT_V2_INDEX_ENQUEUE_ENABLED  !== 'true' → enqueue 완전 no-op (enqueue.ts:14)
vercel.json                                → 이 라우트에 크론이 안 달림
enqueue 호출부                             → src 전체 0건
```

세 플래그의 **운영 값을 2026-08-14 실측했다**: 셋 다 **미설정**이다.
별개로 `CRON_SECRET` 은 이미 있다(19일 전 설정, `inbox-retention` 용).

### 2.2.2 정정 — enqueue 는 이미 돌고 있다 (DB 레벨)

초판은 "enqueue 호출부가 0건이라 색인이 굳는다"고 적었다. **TS 헬퍼에 한해서만 맞다.**

큐의 생성일 분포를 보면 2026-08-13 까지 계속 쌓이고 있다:

```
07-27  07-29  07-31  08-04  08-06  08-11  08-12  08-13
 7건    53건   14건   2건    1건    10건   8건    1건
```

채우는 주체는 **DB 함수**다. 회의록 CRUD 전 경로가 이들을 탄다:

```
queue_minute_ai_index_scope_change      -- job_key 멱등 upsert
archive_minute_with_wiki_retraction
update_minute_metadata_with_wiki_retraction
upsert_ai_index_jobs
```

`job_key = 'v1:{project}:minutes:minute:{id}'` 로 `on conflict (job_key) do update` 한다.
**`CHAT_V2_INDEX_ENQUEUE_ENABLED` 는 이 경로를 게이팅하지 않는다.**

결과적으로 **회의록은 이미 배선돼 있다.** TS 배선이 필요한 것은 이슈·WBS·공지 셋뿐이다.

잡 96건의 정체도 실측했다 — `upsert` 50건은 **전부 현재 스코프와 일치**하고(워커를 켜면 그대로
옳게 색인된다), `delete` 46건은 전부 옛 스코프라 지울 대상이 없어 무해하다. 그래서
**큐를 폐기하지 않는다.**

### 2.2.1 이 설계에서 새로 만들 것은 생각보다 적다

| 필요한 것 | 상태 |
|---|---|
| 벡터 검색 | **있음** `match_ai_documents` |
| 하이브리드 융합 | **있음** `mergeHybridResults` — 단 RRF로 교체 필요(§5.2) |
| 프로젝트 격리 교집합 | **있음** `normalizeSearchQuery`(hybrid.ts:103) |
| 접근 범위 판정 | **있음** `createSupabaseAccessScopeResolver`(authz/accessScope.ts) |
| 색인 워커·백필·정합성 | **있음** 라우트 3모드 |
| 청커 | **있음** `md1500-v1` |
| 어휘 다리(pg_trgm) | **없음** — 0083에서 신설 |
| 이슈 색인 | **없음** — 4곳 배선 필요(§7 작업 5) |
| enqueue 배선 | **없음** — 호출부 0건 |
| 문서 접기 | **없음** — 현행 dedup 키에 `chunkNo`가 들어 있다(§5.4) |
| 검색 화면 | **없음** |

### 2.3 전문검색 인프라는 0이다

`supabase/migrations/*` 전량에 `tsvector` · `pg_trgm` · `unaccent` · `using gin` 히트 0건.
활성 확장은 `pgcrypto` · `vector` 등뿐. 벡터 인덱스 3개(`ai_documents` 빈 테이블,
`minute_embeddings` 1,401건, `wbs_embeddings` 107건)만 존재한다.

### 2.4 색인 가능한 원천

| 원천 | 건수 | 로더 |
|---|---|---|
| 회의록 `minutes` | 67 | **있음** (`content.ts:317`) |
| WBS `wbs_items` | 674 | **있음** (:313) |
| 이슈 `issues` | 68 | **없음 — 추가 필요** |
| 공지 `announcements` | 5 | **있음** (:316) |
| 주간보고 | — | **있음** (:314), 2단계 |
| 회의 `meeting` | — | **있음** (:315) |

## 3. 확정된 결정

사용자가 대화에서 직접 확정한 것이다. 재논의 대상이 아니다.

| # | 결정 | 근거 |
|---|---|---|
| D1 | 검색 대상은 **회의록 + 프로젝트 전반**(이슈·WBS·주간·공지) | "각종 정보들" |
| D2 | **목록이 기본, 요약은 온디맨드** | 검색은 LLM 없이 항상 빠르게 |
| D3 | 제거는 **화면만, 데이터는 보존** | 코드만 되돌리면 복구 |
| D4 | 코퍼스는 **원천 데이터 직접 색인**. `wiki_items`는 사실상 폐기 | §2.1 |
| D5 | 검색은 **벡터 + 어휘 두 다리** | 벡터만 쓰면 정확 검색이 나빠짐 |
| D6 | **평가 세트를 만든다** | 개선을 숫자로 확인 |
| D7 | **archived 2,268건은 되살리지 않는다** | 낡은 세대가 정확도를 깎음 |

## 4. 최종 화면

`/p/[projectId]/wiki` 한 페이지, 세 요소.

1. **검색창** — 의미 검색이 기본
2. **결과 목록** — 출처 배지(회의록/이슈/WBS/공지) · 관련도 · 매칭 스니펫 · 원문 링크 · 출처 종류 필터 칩
3. **요약 버튼** — 누를 때만 LLM 1회 호출

**사라지는 것**: 확인할 지식(REVIEW QUEUE) · 핵심 결정(CURRENT DECISIONS) · 최근 변경
(KNOWLEDGE CHANGES) · 답변된 질문 · 문서와 주제(KNOWLEDGE MAP) · 뷰 탭 · 주제 병합 ·
큐레이션 액션 · 제안 승인 · 리비전 복원 · 피드백 버튼 · 신뢰 정보 패널.

**주제 상세 `/wiki/topics/[topicId]`는 라우트째 제거한다.** 검색 결과에서 원문으로 직행한다.
`body_md`가 운영에 0건이므로 이 페이지가 유일한 생산 수단이었다는 사실은 **실질 손실이 없다**(§2.1).

**존치**: 챗봇 `search_wiki` 도구. 다만 2단계에서 새 검색 엔진으로 재배선한다.

## 5. 검색 엔진

### 5.1 `match_ai_documents`는 순수 벡터다

```sql
order by d.embedding <=> query_embedding
limit greatest(1, least(coalesce(match_count, 20), 100));
```

키워드 다리가 없다. 벡터는 어휘 불일치를 풀지만 **고유명사·ID·약어**("MES", "이슈 42",
"0079", 사람 이름)에서 약하다. 지금 ILIKE가 잘하는 유일한 것이 그것이다.

### 5.2 두 다리 + RRF

```
질의
 ├─ 의미: match_ai_documents(임베딩)           → 상위 N
 └─ 어휘: match_ai_documents_lexical(pg_trgm)  → 상위 N
                    ↓
          RRF:  score = Σ 1/(k + rank),  k = 60
                    ↓
          청크 → 문서 접기 (§5.4)
                    ↓
              결과 목록 + 스니펫
```

**RRF를 쓰는 이유**: 코사인 유사도(0~1)와 trigram 유사도는 척도가 달라 직접 더할 수 없다.
RRF는 점수 대신 **순위**만 쓰므로 정규화가 필요 없고 튜닝 상수가 `k` 하나다.

`k=60`은 원논문(Cormack et al. 2009)의 기본값이며, 평가 세트로 재조정할 수 있게 상수로 둔다.

**기존 융합을 교체하는 것이다 — 신설이 아니다.** `mergeHybridResults`(hybrid.ts:191)는 이미 있고
`keyword * 0.6 + vector * 0.4 + 0.05`(양쪽 히트 보너스) 가중합을 쓴다. 이 방식은 §5.3에서 실측한
문제를 그대로 안는다 — 두 점수의 척도가 다른데 상수 가중치로 더하므로, 한쪽 척도가 바뀌면
가중치를 다시 튜닝해야 하고 그 근거가 없다. RRF로 바꾼다.

기존 호출부(챗봇 검색)가 이 함수를 공유하므로 **교체는 챗봇 검색 결과도 바꾼다.** 평가 세트로
회귀를 확인한 뒤 바꾸거나, 새 함수를 병행 도입하고 호출부를 단계적으로 옮긴다. 어느 쪽이든
구현 계획에서 명시적으로 정한다.

### 5.3 어휘 다리 — 스테이징 실측 (2026-08-14)

스테이징에 `pg_trgm`을 설치해 한국어 실효성을 직접 측정했다. 측정 후 확장·인덱스는 제거했다.

**결론: 한국어에서 작동한다. 단 `similarity()`를 랭킹에 쓰면 안 된다.**

| 시나리오 | `similarity` | 판정 |
|---|---|---|
| 띄어쓰기 — `권한 신청` / `권한신청` | 0.375 | 넘음 |
| 부분 포함 — `MES 권한` / `MES 계정 권한` | 0.700 | 넘음 |
| 어순 — `발주 자동화` / `자동 발주` | 0.625 | 넘음 |
| 접미 — `인터페이스` / `인터페이스 구축` | 0.667 | 넘음 |
| 표기 — `스케줄링` / `스케쥴링` | 0.250 | 약하나 잡힘 |
| **어휘 불일치** — `권한 신청` / `계정 발급 요청` | **0.000** | **원리적으로 못 넘음** |

마지막 줄이 **D5(두 다리)의 근거다.** 사용자가 겪은 실패 유형은 어휘 불일치이고,
그것은 trigram으로 풀리지 않는다. 벡터 다리가 없으면 이 설계는 목적을 달성하지 못한다.

**`similarity()` 길이 편향** — 실데이터(`wiki_items`)로 "발주 자동화"를 검색한 결과:

| 문장 | `similarity` | `word_similarity` |
|---|---|---|
| 원료 **발주 자동화** 범위에서 납기는… | 0.143 | 1.000 |
| 보호필름 **발주 자동화** 로직을… | 0.233 | 1.000 |
| 원료 발주는 월 베이스… **발주 자동화** 범위에 | 0.103 | 1.000 |

`similarity()`는 전체 trigram 수로 나누므로 **검색어를 정확히 품고 있어도 문장이 길면 밀린다.**
위 표에서 순위가 실제로 뒤집혔다. 따라서 어휘 다리는 **`word_similarity()` / `<%` 연산자**를 쓴다.

**인덱스 실측** — `gin_trgm_ops`가 한글에서 두 접근 경로를 모두 가속한다.

```
인덱스 없음   Seq Scan            cost=141.74
GIN 생성 후   Bitmap Index Scan   cost=35.40   ← ILIKE '%발주 자동화%'
              Bitmap Index Scan   cost=44.09   ← '발주 자동화' <% statement
```

**동점 처리** — `word_similarity`는 검색어를 온전히 품은 문장 전부에서 **1.000으로 포화**한다
(위 표의 세 건 모두 1.000). 즉 어휘 다리는 **후보 선별**만 하고 순서를 정하지 못한다.
동점은 다음 순으로 깬다: ① 벡터 다리 순위 ② `occurred_on` 최신순 ③ `entity_id` 사전순(결정성 확보).
어휘 다리 단독 결과(벡터 실패 시)는 ②③만으로 정렬한다.

### 5.4 청크 → 문서 접기

`ai_documents`는 **청크 단위**다(`md1500-v1`, 1,500자). 접지 않으면 긴 회의록 하나가
상위 결과를 도배한다. 회의록 67건이 약 1,400청크이므로 평균 20청크/건이다.

**현행 코드는 접지 않는다.** `stableDocumentKey`(hybrid.ts:172-181)는
`projectId | domain | entityType | entityId | chunkNo | indexVersion`으로 키를 만든다 —
`chunkNo`가 들어 있어 같은 회의록의 청크 20개가 **서로 다른 20개 문서로 취급된다.**
이 키를 그대로 두고 화면만 만들면 상위 10건이 회의록 한 건으로 채워진다.

- 융합 후 `(domain, entity_type, entity_id)` 기준으로 묶는다
- 문서 점수 = **그 문서에 속한 청크 중 최고 RRF 점수** (합산하지 않는다 — 합산하면 긴 문서가 유리해져
  §5.3에서 배제한 길이 편향이 다른 경로로 되살아난다)
- 화면에는 문서당 1행. 스니펫은 최고 점수 청크에서 뽑는다
- 청크를 접은 뒤 결과 수가 줄어드는 만큼, 두 다리의 후보 수 N은 최종 표시 수보다 넉넉히 잡는다
  (초기값 N=50, 표시 20)

### 5.5 질의 임베딩

검색 1회 = 임베딩 1회. 같은 질의 반복을 줄이기 위해 질의 문자열 해시 기준 캐시를 둔다.
임베딩 실패 시 **어휘 다리만으로 결과를 낸다** — 검색이 통째로 죽으면 안 된다.
이때 결과가 어휘 검색만이라는 사실을 화면에 표시한다(조용히 품질을 떨어뜨리지 않는다).

### 5.6 권한과 격리

**회의록·이슈·WBS 원문을 색인하므로 검색은 새로운 정보 유출 경로가 된다.** 기존 화면 가드를
우회하지 않도록 다음을 강제한다.

**DB는 프로젝트를 막지 않는다.** `0031:74-79`의 정책은 다음과 같다.

```sql
create policy ai_documents_read on public.ai_documents
  for select to authenticated using (true);
grant select on table public.ai_documents to authenticated;
```

`match_ai_documents`도 `security invoker` + `authenticated` 실행 허용이다. 즉 **프로젝트 격리는
전적으로 앱 코드 몫이다.**

그리고 `0031:67-72`에 설계자가 명시적 게이트를 박아 뒀다. 원문 그대로:

> 향후 프로젝트 ACL을 원본에 도입하면 이 정책도 원본과 반드시 함께 갱신해야 하며,
> **백필(재색인) 전에 정책 정렬을 끝내는 것이 게이트다. 정렬 없이 백필하면 색인 사본이
> 원본보다 넓게 노출된다.**

비공개 프로젝트(0070)는 **RLS 잠금이 아니라 앱의 `canSeeProject` 판정 하나**다. 따라서
projectId를 아는 로그인 사용자라면 누구든 비공개 프로젝트의 회의록 본문 스니펫을 받을 수 있는
경로가 생긴다 — 검색 API가 접근 판정을 안 하면.

**강제 규칙**

- `/api/wiki/search`는 세션 확인 후 `createSupabaseAccessScopeResolver`(`authz/accessScope.ts`)로
  `allowedProjectIds`를 **서버에서 확정**한다. 이 리졸버가 이미
  `is_private × project_roles × is_superuser`를 판정한다
- 요청 `projectId`가 그 집합에 없으면 **403**
- `p_project_ids`는 클라이언트 값이 아니라 **서버 확정 집합과의 교집합**으로만 넘긴다.
  `normalizeSearchQuery`(hybrid.ts:103)가 이 교집합을 이미 구현하고 있으니 재사용한다
- `p_include_global`은 `false` 고정
- **현행 wiki 페이지는 `projectId` 접근 검증을 하지 않는다**(`wiki/page.tsx:41-48`이 `getActorForView()`를
  `canCurate`/`canEdit` 계산에만 쓴다). 새 화면에서는 이 구멍을 함께 막는다

**백필 전 선행조건** — 위 인가가 검색 경로에 들어가기 전에는 백필을 시작하지 않는다.
`0031:67-72`의 게이트를 그대로 따른다.

**구현 시 검증할 것**: 회의록이 프로젝트 단위보다 좁은 접근 제어(폴더·팀)를 갖는지 확인한다.
프로젝트 격리만으로 충분하지 않다면 색인 행에 그 축을 실어 필터해야 한다. 현재 미확인이다.

## 6. 색인 파이프라인

```
원천 변경 → ai_index_jobs 큐잉 → 워커 → 임베딩 → replace_ai_document_chunks → ai_documents
                                    ↑
                        /api/cron/ai-index (증분)
                        로컬 백필 스크립트 (초기)
```

- 청커는 기존 `md1500-v1`(1,500자)을 그대로 쓴다
- `content_hash`가 있어 재실행이 멱등이다 → 백필 중단·재개가 안전하다
- 초기 백필은 **로컬 스크립트**로 돈다. Vercel 함수 타임아웃 안에 2,200건이 안 끝난다
- 크론은 **증분만** 담당한다

## 7. 단계

### 1단계 — 검색이 실제로 되게 한다

| # | 작업 | 신설/수정 |
|---|---|---|
| 0 | **운영 env 실측** — `CHAT_V2_INDEX_WORKER_ENABLED` · `CHAT_V2_INDEX_CRON_SECRET` · `CHAT_V2_INDEX_ENQUEUE_ENABLED` 현재 값 확인 | 조사 |
| 1 | 밀린 큐 96건 폐기 (delete 46 포함). 작업 2 이후 백필이 새로 큐잉 | 신설 |
| 2 | **인가 먼저** — `/api/wiki/search`의 접근 판정(§5.6). `0031:67-72` 게이트라 백필보다 앞선다 | 신설 |
| 3 | 마이그레이션 0083 — `pg_trgm` + `ai_documents(title, content)` `gin_trgm_ops` GIN + `match_ai_documents_lexical`(`word_similarity`) | 신설 |
| 4 | **회의록 스코프 skew 수정** — `backfill.ts:123`의 `columns`에 `project_id` 추가 + `rowProjectId`를 `project_id ?? meetings.project_id`로 통일 | 수정 |
| 5 | **이슈 색인 4곳 배선** — ① `protocol.ts` `BOT_DOMAINS`에 `issues`, `BOT_ENTITY_TYPES`에 `issue` ② `content.ts` `loadIssue` + `case` ③ `backfill.ts` `INDEX_BACKFILL_DOMAINS`·`SOURCE_TABLES` ④ `chat/router.ts`·`verifier.ts` 파급 확인 | 수정 |
| 6 | **워커 기동** — env 3종 설정 + `vercel.json`에 크론 등록. 기존 `/api/chat/index/worker` 3모드를 그대로 쓴다 | 수정 |
| 7 | **enqueue 배선** — 호출부 0건이라 백필 직후부터 색인이 굳는다. 원천 쓰기 경로에 연결 | 신설 |
| 8 | 백필 실행 — 기존 `mode:'backfill'`을 호출하는 로컬 러너 | 신설(얇게) |
| 9 | 융합을 RRF로 교체 + **문서 접기**(§5.4). `stableDocumentKey`에서 `chunkNo` 제외한 문서 키 도입 | 수정 |
| 10 | 검색 화면 (§4). 옛 섹션은 화면에서 빠지되 **파일은 남긴다** | 신설 |
| 11 | 평가 세트 + 측정 스크립트 | 신설 |

**순서 제약** — 0 → 1 → 2 → 3 → (4·5 병렬) → 6 → 7 → 8 → 9 → 10 → 11.
작업 2(인가)가 8(백필)보다 앞서는 것은 취향이 아니라 `0031:67-72`이 정한 게이트다.

**작업 4가 blocker인 이유** — `backfill.ts:123`은 `columns: 'id, updated_at, created_at, meetings(project_id)'`로
`minutes.project_id`를 **읽지 않는다**. 그래서 `job.projectId`가 `null`로 큐잉되는데,
로더는 `content.ts:282`에서 `row.project_id ?? meetingProjectId`를 쓰고 `job.projectId`와
다르면 `scopeMismatch()` → `retryable: false`(content.ts:48) → `dead_letter`로 끊는다.
`minutes.project_id`는 0045에서 추가됐고 0076이 회의록 트리의 1차 축으로 쓴다.
**고치지 않으면 D1의 최우선 코퍼스인 회의록이 통째로 색인되지 않을 수 있다.**
실제 영향 건수(`project_id`만 있고 `meeting` 미연결인 회의록 수)는 미확인 — 착수 시 조회한다.

**작업 5가 4곳인 이유** — `content.ts`에 `case 'issue'`만 넣으면 한 건도 색인되지 않는다.
`pgvector.ts:175-176`이 `BOT_DOMAINS`·`BOT_ENTITY_TYPES`로 Set을 만들어 검증하므로
`mapDocument`가 `null`을 반환하고 upsert가 거부된다. DB 쪽은 무해하다 —
`0031`의 `domain`·`entity_type`에 CHECK 제약이 없다.

**코퍼스**: 회의록 67(≈1,400 청크) + WBS 674 + 이슈 68 + 공지 5 + 살아있는 wiki 31 ≈ **2,200건**

### 2단계 — 넓히고 걷어낸다

주간업무 색인 · 요약 버튼 · 옛 컴포넌트 파일 삭제 · 주제 상세 라우트 제거 ·
챗봇 `search_wiki` 재배선 · 죽은 i18n 키 정리.

**제거는 새 검색이 동작하는 걸 확인한 뒤다.** 1단계에서 화면만 교체해 두면 문제 발생 시
컴포넌트 한 줄 되돌리기로 복구된다.

## 8. 제거 시 함정 (코드 실측)

| 함정 | 위치 | 대응 |
|---|---|---|
| `hasKnowledge` 게이트에 `data.changes.length`가 들어 있다 | `WikiOverview.tsx:294` | '최근 변경' 제거 시 이 조건을 같이 고치지 않으면 화면에 없는 값이 EmptyState를 결정한다 |
| '확인할 지식'은 pending 제안 승인의 유일한 홈 UI | `WikiOverview.tsx:325-333` | 운영 pending 0건이라 실질 무해. 사실만 기록 |
| '답변된 질문'은 Ask 출처 딥링크 착지점 | `ask/route.ts:239` → `page.tsx:19-23` | `wiki_questions` 0건이라 실질 무해 |
| `isActiveWikiDecision`은 봇이 계속 쓴다 | `tools/wiki.ts:50` | 화면은 지우되 **함수는 남긴다** |
| `WikiChangeList`는 상세 타임라인과 공유 | `WikiTopicDetail.tsx:364` | 상세를 지우면 함께 정리 |
| 죽은 i18n 키가 이미 있다 | `wiki.section.unsettled.*` 등 | ko/en 패리티가 컴파일 타임 강제라 양쪽 동시 삭제 |
| `archive_minute_with_wiki_retraction` 등 RPC가 wiki 테이블을 직접 쓴다 | `0045` | **테이블 드롭 금지**. D3이 이미 데이터 보존이라 해당 없음 |

## 9. 평가 세트

`tests/search/eval-set.json`에 질문·정답 쌍을 둔다.

```json
{ "q": "MES 권한은 어떻게 신청하지?",
  "expect": [{ "source": "minute", "id": "…", "why": "계정 발급 요청 절차" }] }
```

측정 스크립트 `scripts/search-eval.mjs`가 **Recall@10 · MRR을 나란히 출력**한다.

**비교 기준을 명시한다** — 현행 검색은 네 벌이라 "현행"이 모호하다. 기준선은
**`/api/wiki/ask`**(서버 ILIKE, 세 코퍼스를 훑는 가장 강한 현행 경로) 하나로 고정한다.
클라이언트 필터 두 벌은 페이지에 내려온 배열에서만 도는 구조라 공정한 비교 대상이 아니다.

기준선이 이미 처참할 것으로 예상되는 점을 미리 밝힌다 — 살아있는 `wiki_items`가 31건이므로
(§2.1) 기준선 점수는 코퍼스 부재를 반영한다. 따라서 **개선폭을 알고리즘 효과로 해석하지 않는다.**
알고리즘 자체의 효과를 보려면 새 코퍼스 위에서 `벡터만` · `어휘만` · `두 다리`를 비교한다.
이 3자 비교가 RRF의 `k`와 후보 수 `N`을 정하는 근거가 된다.

목표는 "좋아진 것 같다"가 아니라 "8/20 → 17/20"이다.

**사용자가 못 찾았던 질문 사례를 제공해야 한다.** 구현 착수 시 요청한다.
초기에는 어휘 불일치 사례(검색어와 본문 표현이 다른 것)를 우선 수집한다.

## 10. 위험과 되돌리기

| 위험 | 완화 |
|---|---|
| 밀린 큐 96건의 delete 46이 실존 회의록을 겨냥 | 워커 켜기 전 큐 정리가 1번 작업 |
| 임베딩 무료 한도 미실측 | 백필 첫 100건으로 실측 후 배치 크기 결정 |
| **검색이 새 정보 유출 경로가 된다** | §5.6. DB RLS가 `authenticated using (true)`라 앱이 유일한 관문. 인가가 백필보다 앞선다(`0031:67-72` 게이트) |
| 회의록의 프로젝트 하위 접근 제어 미확인 | 구현 착수 시 확인. 있으면 색인 행에 축을 실어 필터 |
| `word_similarity` 포화로 어휘 다리 단독 랭킹 불가 | §5.3 동점 규칙 |
| **회의록 스코프 skew로 회의록이 통째로 dead_letter** | §7 작업 4. 최우선 코퍼스가 안 들어오는 문제라 blocker |
| **enqueue 호출부 0건 → 백필 직후부터 색인이 굳음** | §7 작업 7 |
| 융합 교체가 **챗봇 검색 결과도 바꾼다** | `mergeHybridResults` 공유. 평가 세트로 회귀 확인 후 교체하거나 병행 도입 |
| 스펙 초판이 "워커 호출부 없음"으로 오진했다 | 2026-08-14 적대적 검토에서 정정(§2.2). 착수 전 §2.2.1의 '있음/없음'을 다시 실측할 것 |
| Vercel 함수 타임아웃 | 초기 백필은 로컬, 크론은 증분만 |
| 0079 미적용 코드가 운영에 떠 있음 | 2단계 제거로 해소. 그때까지 현상 유지 |
| 화면과 봇이 다른 답 | 2단계 재배선까지 남는 알려진 문제 |
| G4 훅 | 0083은 0072+ 범위 → 스테이징 리허설 + `Staging-verified:` 트레일러 필수 |

| 잘못되면 | 되돌리기 |
|---|---|
| 검색 품질 미달 | 화면 컴포넌트만 옛것으로. 데이터 무손상 |
| 색인 오류 | `ai_documents` 비우고 백필 재실행 |
| 0083 문제 | `0083_*_rollback.sql`로 인덱스·RPC만 제거 |
| 임베딩 비용 폭주 | 크론 정지. 기존 색인은 계속 검색됨 |

**원천 데이터(회의록·이슈·WBS·공지)는 이 작업에서 한 번도 쓰지 않는다. 전부 읽기만 한다.**

## 11. 범위 밖

- `archived` 2,268건 복구 (D7)
- 재구축·처리 큐가 멈춘 원인 규명 — 별도 작업
- AI 지식 추출 파이프라인 수정 — 원천 색인으로 우회하므로 손대지 않는다
- 0079(`wiki_documents`) 운영 적용 — 2단계 제거 대상이므로 적용하지 않는다
- `HeaderChrome`의 `SECTION_LABEL`이 locale 무시하는 구조적 결함 — 전 12개 섹션 공통 문제, 별건
