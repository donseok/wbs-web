# 위키를 '사람이 쓰는 문서'로 — 활용성·직관성 개선 (설계)

2026-08-13. 대상: `src/components/wiki/*`, `src/app/(app)/p/[projectId]/wiki/*`,
`src/lib/data/wiki.ts`, `src/lib/domain/wikiView.ts`, `src/app/actions/wiki.ts`,
`src/lib/ai/wiki-ingest.ts`, `src/components/app/Sidebar.tsx`.
마이그레이션 있음(0079). 스테이징 리허설 필수(G4).

범위는 아래 세 덩어리 중 **A + B** 다. C 는 별도 스펙으로 남긴다(§10).

| | 덩어리 | 내용 |
|---|---|---|
| **A** | 문서 위키 코어 | 본문 문서(작성·편집·이력) · 문서 트리 · 검색 · 쓰기 권한 · 메뉴 복귀 |
| **B** | AI 제안 루프 | 자동 반영 재개(제안 대기함으로만) · 승인/무시 · 문서에 근거 부착 |
| C | 도달 경로 확장 | 회의록·이슈·WBS ↔ 위키 상호 링크 · 전역 검색 · 봇 조회 정밀화 |

---

## 1. 왜 지금

2026-08-05 커밋 `9cf7ff5`(사용자 지시)가 위키 자동 반영을 전역 중단하고 사이드바 메뉴를
감췄다. 그 뒤 8일간 새 지식이 한 건도 쌓이지 않았고, 메뉴에 없으니 아무도 열지 않는다.
"활용성이 떨어진다"는 관찰은 정확하지만, 원인은 **화면 품질이 아니라 세 가지 구조적 사실**이다.

1. **꺼져 있고 숨겨져 있다.** `WIKI_SERVICE_ENABLED` 기본값이 꺼짐이고, `vercel.json` 의
   워커 크론이 제거됐고, `Sidebar.tsx:52` 의 메뉴 줄이 주석이다. URL 직접 접근만 산다.
2. **사람이 쓸 수 없다.** 이건 위키가 아니라 **AI 회의록 요약 뷰어**다. 문장 편집은 설계상
   금지돼 있고(`WikiItemActions.tsx:2-4` — 원문 추적 계약), 사람이 할 수 있는 것은
   완료·숨김·고정·확정·주제 병합뿐이다. 용어집·표준 절차·온보딩 문서를 담을 곳이 없다.
3. **읽으려면 분류 체계를 먼저 배워야 한다.** 한 항목이 kind 7종 × lifecycle 6종 ×
   certainty 2종 × decisionState 4종으로 표현되고, 홈은 탭 7개 + 종류 칩 8개 +
   상태 라벨 17종을 노출한다.

여기에 §3 이 밝히는 **무음 절단 결함**이 겹친다.

## 2. 결정된 방향 (브레인스토밍 2026-08-13)

| 질문 | 결정 |
|---|---|
| 위키의 정체 | **사람이 쓰는 위키 + AI 초안.** AI 추출물은 제안으로 들어오고 사람이 승인해야 반영된다 |
| 사람이 쓰는 단위 | **주제마다 본문 문서 한 장.** AI 항목은 문서 하단의 '근거'로 내려간다 |
| 기존 데이터 | **자산이다.** 항목 1,219건은 살리고 **주제(문서) 층만 사람이 다시 잡는다** |
| 주 용도 | 레퍼런스 · 결정 확인 · 온보딩 · 미결 추적 **네 가지 모두** |
| 아키텍처 | **기존 `wiki_topics` 를 문서로 승격** + "항목으로 본문 초안 만들기" 버튼 |

기각한 대안 둘을 남긴다.

- **새 `wiki_pages` 테이블로 분리** — 구현은 깨끗하지만 "지식 단위"가 둘이 된다. 사용자가
  매번 "이건 페이지에 있나 항목에 있나"를 판단해야 하고 검색 결과도 두 종류가 섞인다.
  직관성 목표에 정면으로 반한다.
- **AI 가 본문 마크다운을 직접 쓴다** — 문단이 어느 회의 어느 블록에서 왔는지 걸 수 없어
  원문 추적 계약이 깨진다. 그리고 AI 가 사람이 쓴 본문을 덮어쓰게 되므로 8/5 에 스위치를
  내린 그 위험이 오히려 커진다. `wiki-ingest.ts` 1,299줄을 다시 써야 한다.

## 3. 실측 — 조용히 깨져 있는 곳

`getWikiOverview`(`src/lib/data/wiki.ts:398`)는 세 쿼리를 자른다.

| 쿼리 | 상한 | 2026-07-30 실측 행 수 | 도달 못 하는 양 |
|---|---:|---:|---:|
| `wiki_topics` | `limit(200)` | 232 | 32 |
| `wiki_items` (5개 상태) | `limit(500)` | 1,219 | **719 (59%)** |
| `wiki_change_events` | `limit(100)` | 2,034(누적) | 나머지 전부 |

항목 쿼리는 `lifecycle_state in ('active','open','conflicted','archived','resolved')` 를 걸고,
7/30 기준 그 모집단이 살아있는 407 + archived 812 = 1,219 이다. `updated_at desc` 로 자르므로
**오래된 것부터 사라진다.**

세 가지가 동시에 나쁘다.

1. **절단 사실이 화면에 없다.** 사용자에게는 "검색해도 안 나온다"로만 보인다.
2. **탭 건수가 틀리다.** `countWikiViews`(`wikiView.ts:212`)는 도착한 배열만 세므로,
   숫자가 데이터가 아니라 상한을 반영한다.
3. **전량이 브라우저로 내려간다.** 항목 500건 + 근거 + 회의록 메타가 매 렌더마다 props 로
   실린다. 여기에 본문 마크다운까지 얹으면 못 버틴다.

이 결함은 §7 이 고친다.

## 4. 설계의 중심 규칙

> **본문(`body_md`)이 쓰인 주제만 문서 트리에 선다.**

이 한 줄이 세 문제를 동시에 닫는다.

1. AI 가 만든 주제 232개가 첫 화면을 덮지 않는다.
2. AI 가 앞으로 주제를 몇 개를 만들든 **사람의 네비게이션을 오염시키지 못한다.**
   2026-07-30 스펙이 다룬 흡인체·파편화 문제의 UX 측면이 구조적으로 닫힌다.
3. '문서'와 '미분류 지식'에 별도 테이블·별도 상세 화면이 필요 없다. 같은 주제가 본문을
   얻는 순간 문서가 되고, 본문을 비우면 다시 내려간다.

따름정리 — **AI 는 `body_md` 를 쓸 수 없다.** 이것이 §9 에서 자동 반영 스위치를 되살릴
안전 근거이며, 테스트로 증명한다(§11).

## 5. 데이터 모델 (마이그레이션 0079)

현재 최신은 `0078_agent_runners.sql` 이다. 파일은 `0079_wiki_documents.sql` +
`0079_wiki_documents_rollback.sql`.

### 5.1 `wiki_topics` 확장

```sql
alter table public.wiki_topics
  add column if not exists body_md         text,
  add column if not exists body_updated_at timestamptz,
  add column if not exists body_updated_by uuid references auth.users(id) on delete set null,
  add column if not exists parent_id       uuid references public.wiki_topics(id) on delete set null,
  add column if not exists sort            integer not null default 0,
  add column if not exists pinned_order    integer,
  add column if not exists origin          text not null default 'ai'
                                             check (origin in ('ai','manual'));
```

- `body_md is null` 또는 공백 = **아직 문서가 아님**(트리에 안 섬).
- `origin` 은 `wiki_items` 에 이미 있는 `('ai','manual')` 과 같은 이름·같은 값 집합을 쓴다.
  쓰임은 하나다 — "정리 안 된 지식"(본문 없는 주제) 화면에서 **AI 가 만든 주제**와
  **사람이 만들었지만 아직 본문을 안 쓴 문서**를 갈라 보여준다. 둘은 다뤄야 할 일이 다르다
  (전자는 병합·본문화 대상, 후자는 그냥 미완성 초안이다).
- `pinned_order` 는 홈의 "이 프로젝트 시작하기" 순서. `null` 이면 핀 아님.
- `parent_id` 는 **자기 참조**다. 문서가 곧 폴더이며 별도 폴더 테이블을 만들지 않는다
  (`minute_folders` 는 회의록에서 폴더와 문서가 서로 다른 것이라 분리했지만, 위키에서는
  같은 것이다).
- `on delete set null` 인 이유: 주제 행은 사실상 삭제되지 않으므로(§6.4) 방어값이다.

### 5.2 `wiki_topic_revisions` (신규)

`minute_versions`(0045) 패턴을 그대로 따른다. 공동 편집 위키에서 되돌리기가 없으면 아무도
남의 문서에 손대지 못한다.

```sql
create table if not exists public.wiki_topic_revisions (
  id              uuid primary key default gen_random_uuid(),
  topic_id        uuid not null,
  project_id      uuid not null,
  version_no      integer not null check (version_no > 0),
  body_md         text not null,
  body_hash       text not null check (body_hash <> ''),
  title           text not null,              -- 그 시점 제목 스냅샷
  edited_by       uuid references auth.users(id) on delete set null,
  edited_by_name  text,
  created_at      timestamptz not null default now(),
  constraint wiki_topic_revisions_topic_version_unique unique (topic_id, version_no),
  constraint wiki_topic_revisions_topic_project_fk
    foreign key (topic_id, project_id) references public.wiki_topics (id, project_id)
);
```

`version_no` 는 저장 액션이 `max(version_no)+1` 로 채운다. 동시 저장 경쟁은 unique 제약이
막고, 충돌한 쪽은 §6.5 의 낙관적 잠금 오류와 같은 메시지를 받는다.

### 5.3 `wiki_items.review_state` (신규 컬럼)

```sql
alter table public.wiki_items
  add column if not exists review_state text not null default 'accepted'
    check (review_state in ('pending','accepted','rejected'));
```

- 기존 1,219건은 기본값 `accepted` 를 그대로 받는다 → **지금 동작이 보존된다.**
- 자동 반영이 재개되면 AI 가 만드는 새 항목은 `pending` 으로 들어온다.
- `pending`·`rejected` 항목은 근거 목록·검색·집계·봇 조회 **어디에도 나오지 않는다.**
  제안 검토 화면에만 뜬다.

**`lifecycle_state` 에 값을 더하지 않는 이유**: 그 축은 `wikiView.ts` 의 모든 판정
함수가 참조한다. 값을 늘리면 `CLOSED_STATES`·`CONFLICT_STATES` 같은 집합에 안 들어간 새
값이 조용히 "그 외"로 흘러 모든 필터가 흔들린다. 직교하는 새 축이 안전하고, 모르는 값은
안 보여주는 fail-closed 가 자연스럽다.

### 5.4 인덱스

```sql
create index if not exists wiki_topics_project_parent_idx
  on public.wiki_topics (project_id, parent_id, sort);
create index if not exists wiki_topics_project_pinned_idx
  on public.wiki_topics (project_id, pinned_order) where pinned_order is not null;
create index if not exists wiki_items_project_review_idx
  on public.wiki_items (project_id, review_state);
```

검색용 `pg_trgm` GIN 인덱스는 **이 마이그레이션에 넣지 않는다.** 이유는 §7.3.

## 6. 화면

### 6.1 위키 홈 — 좌측 문서 트리 + 우측 랜딩

현행은 「지식 탐색기 → 최근 변경 → 주요 주제」 세로 스택이고, §2 의 네 용도 중 어디에도
맞지 않는다. 2단으로 바꾼다.

```
┌──────────────┬────────────────────────────────────────┐
│ 🔍 위키 검색  │  이 프로젝트 시작하기        (온보딩)   │
│              │  ① 프로젝트 개요  ② 용어집  ③ 개발 규칙 │
│ ▾ 프로세스    │                                        │
│   입고 관리   │  최근 변경                   (결정 확인) │
│   검수 절차   │  · 홍길동이 「검수 절차」 편집 · 2시간 전│
│ ▾ 시스템      │  · [결정] MES 조회 전용 한정 · 7/22     │
│   MES 권한    │                                        │
│   원가 산출   │  반영 대기 제안 12건  [검토]  (관리자)  │
│              │                                        │
│ ─────────    │  미결 사항 34건                (미결)   │
│ 정리 안 된    │  · 액션 18 · 질문 9 · 리스크 4 · 상충 3 │
│ 지식  62 ›    │                                        │
└──────────────┴────────────────────────────────────────┘
```

네 용도가 각각 자리를 하나씩 갖는다. 규범적 규칙:

1. 트리에 서는 조건은 `body_md is not null and btrim(body_md) <> ''` 하나뿐이다.
2. **"정리 안 된 지식"** 은 본문 없는 주제 전량이다. 현행 `WikiTopicGrid` 가 통째로 이
   화면으로 들어간다. 사람이 본문을 쓰는 순간 그 주제는 트리로 올라간다.
3. 트리는 `parent_id` + `sort` 로 조립하고 **깊이 상한 3**(루트 + 2단)이다. 사이드바
   가독성이 이유이며, 상한을 넘기는 저장은 액션이 거부한다.
4. 부모가 **문서가 아닌**(본문 없는) 주제를 가리키면 그 노드를 루트로 올린다. 부모 선택 UI
   는 문서만 제시하지만, DB 제약으로 막지 않으므로 조립기가 방어한다.
5. **순환 참조는 조립기가 방문 집합으로 끊고**, 끊긴 노드를 루트로 올린 뒤 `console.warn`
   을 남긴다. 조용히 사라지게 두지 않는다.
6. 트리·랜딩의 모든 건수는 §7.1 의 서버 집계에서 온다. 배열 길이로 세지 않는다.

### 6.2 문서 상세 — 섹션 5개를 2개(+조건부 2개)로

현행은 「현재 지식 / 핵심 결정 / 논의 중 / 변경 타임라인 / 열린 액션·질문·리스크」다.
읽으려면 분류 체계를 먼저 배워야 한다.

```
┌ MES 메뉴 열람 권한                    [편집] [이력] ┐
│  ## 개요                          ← 본문이 주인공    │
│  MES 메뉴는 기본 조회 전용이며 …                     │
│  ## 예외 절차                                       │
│  1. 팀장 승인 → 2. 관리자 부여                      │
├ ▸ 회의에서 나온 근거 12건            (기본 접힘)     │
│   펼치면 현행 결정/사실/액션 분류가 그대로 나온다    │
├ ▸ 반영 대기 제안 3건  [승인][무시]   (있을 때만)     │
├ ▸ 이력                               (있을 때만)     │
│   본문 편집 이력 + AI 변경 타임라인을 한 줄기로      │
└─────────────────────────────────────────────────────┘
```

- 본문 없는 주제를 열면 본문 자리에 **"이 주제로 문서 쓰기"** 안내와 **"항목 12건으로 초안
  만들기"** 버튼이 놓인다. 초안은 LLM 이 만들지만 **편집기 안에 채워질 뿐 저장되지 않는다.**
  사람이 저장 버튼을 눌러야 `body_md` 가 생긴다.
- 편집기는 `WbsSpecPanel.tsx` 선례를 따른다 — 보기 = `MarkdownView`, 편집 = `textarea`,
  그리고 **`MarkdownView` 는 `dynamic(..., { ssr: false })`** 로 가져온다. 정적 import 하면
  react-markdown·remark-gfm·unified·mermaid 체인 약 47KB 가 위키를 안 여는 사용자에게도
  실린다(`WbsSpecPanel.tsx:11-19` 의 실측, `WikiShared.tsx:32-38` 의 같은 경고).

### 6.3 어휘 줄이기

**탭 7개 → 4개.** `WIKI_VIEWS` 상수에 `attention` 을 더하고 화면에는 넷만 노출한다.

| 탭 | 판정 |
|---|---|
| 전체 | 사람이 닫거나 숨기지 않은 `accepted` 항목 전부 |
| 결정 | `isActiveWikiDecision` |
| 미결 | `isOpenWikiItem` (액션·질문·리스크) |
| **확인 필요** | `isConflictedWikiItem` ∪ `isDiscussingWikiItem` (신규 합성 뷰) |

`완료`·`숨김`은 "더보기" 드롭다운으로 내린다. **기존 값은 지우지 않는다** — 봇 딥링크와
`?view=` 파라미터가 쓰고 있고, `parseView`(`wiki/page.tsx:13`)가 모르는 값을 `all` 로 되돌리
므로 옛 링크는 안전하다. 종류 칩 8개도 "필터 더보기" 안으로 접는다.

**상태 라벨 17종 → 5종.** 표시 계층에만 두는 접기 함수를 만들고 원래 값은 `title` 속성에
남긴다. **데이터는 건드리지 않는다.**

| 표시 | 원래 값 |
|---|---|
| 현재 유효 | `active`, `confirmed` |
| 열림 | `open` |
| 논의 중 | `tentative`, `proposed`, `on_hold` |
| 상충 | `conflict`, `conflicted`, `disputed` |
| 종료 | `resolved`, `done`, `closed`, `superseded`, `withdrawn`, `reversed`, `archived` |

### 6.4 문서 삭제는 "본문 비우기"다

주제 행 자체를 지우지 않는다. 항목·근거·변경 이벤트가 FK 로 매달려 있고, 지우면 회의록
추적이 끊긴다. **본문을 비우면 문서가 아니게 되어 "정리 안 된 지식"으로 내려간다.** 주제를
없애야 하면 기존 `merge_wiki_topics` RPC 로 병합한다(관리자).

### 6.5 동시 편집 — 낙관적 잠금

저장 요청은 클라이언트가 열 때 받은 `body_updated_at` 을 함께 보낸다. DB 값과 다르면
저장을 **거부**하고 "다른 사람이 먼저 저장했습니다"와 함께 최신 본문을 보여준다. 실시간
공동 편집은 범위 밖(§10)이다.

### 6.6 메뉴 복귀

`Sidebar.tsx:52` 의 주석 한 줄을 푼다. 커밋 `9cf7ff5` 가 "되살릴 때 아래 한 줄의 주석만
풀면 된다"고 남겨 두었다. 이 파일은 **UI 위험 파일**(`src/components/app/*`)이므로 §11 의
브랜치 규칙을 따른다.

## 7. 검색과 로딩

§3 의 무음 절단을 여기서 끝낸다.

### 7.1 홈은 집계만 받는다

건수(탭 4개 · 미결 내역 · 정리 안 된 지식 · 반영 대기 제안)를 **행을 받지 않고** 센다.
PostgREST 의 `{ count: 'exact', head: true }` 를 쓴다.

```ts
sb.from('wiki_items')
  .select('id', { count: 'exact', head: true })
  .eq('project_id', projectId).eq('review_state', 'accepted')
  .in('lifecycle_state', [...])
```

- 상태 조합이 `wikiView.ts` 의 순수 함수와 갈리면 화면과 숫자가 어긋난다. 그래서 **각 뷰의
  SQL 조건을 `wikiView.ts` 옆에 표로 고정하고**, 같은 픽스처로 두 경로(순수 함수 / SQL 조건)
  가 같은 수를 내는지 테스트한다(§11).
- `isConflictedWikiItem` 은 `wiki_item_sources.relation='contradicts'` 까지 보므로 단일
  테이블 count 로 셀 수 없다. **상충 건수만 별도 쿼리**로 센다(항목 id 조인 후 distinct).
  이 예외를 스펙에 적어 두지 않으면 구현이 조용히 틀린 수를 낸다.

### 7.2 목록은 커서 페이지네이션

현행 "전량 내려받고 클라이언트에서 12개씩 노출"을 끝낸다. `(updated_at desc, id desc)` 안정
정렬에 커서를 건다. `limit` 만으로 자르고 잘린 사실을 안 알리는 경로를 하나도 남기지 않는다.

### 7.3 검색은 서버 액션으로

```ts
searchWikiKnowledge(projectId, q, { scope: 'all' | 'docs' | 'items', cursor })
```

- 문서(제목 + `body_md`)와 지식(항목 `statement` + 근거 `evidence_excerpt`)을 함께 보고,
  결과를 **두 그룹으로 나눠 문서를 먼저** 낸다.
- 현행 `matchesWikiQuery` 의 **공백 AND 토큰 규칙을 유지**한다. 서버로 옮기면서 규칙이
  바뀌면 같은 검색어가 다른 결과를 내 사용자가 신뢰를 잃는다.

**인덱스 — `pg_trgm`, 단 계측 후에 넣는다.**

이 DB 에는 `pgcrypto`·`vector` 만 있고 `pg_trgm` 은 없다(실측: `create extension` 검색 결과
`0001`·`0010`·`0021`·`0031` 넷뿐). `tsvector` 를 쓰지 않는 이유는 Postgres 기본 파서가
한국어 형태소를 나누지 못해 `to_tsvector('simple', …)` 이 사실상 공백 토큰화가 되기 때문이다
— "입고관리"로 "입고 관리"를 찾지 못한다. trigram 은 부분일치가 되고 한국어에서도 인덱스가
먹는다.

그럼에도 **0079 에 넣지 않는다.** 대상이 1,219행 + 문서 수십 장 규모라 Micro 컴퓨트에서도
seq scan 이 더 빠를 수 있다. 스펙은 **쿼리 경로만 고정**하고, 인덱스는 스테이징에서
`explain analyze` 로 재고 그 수치를 커밋 메시지에 남겨 별도 마이그레이션으로 낸다.
근거 없이 넣은 GIN 인덱스는 쓰기마다 비용을 물린다.

**의미검색(임베딩)은 범위 밖이다.** `vector` 인프라는 있지만 2026-07-30 스펙 §11 이
`wbs_embeddings` 스테일·`ref_id` dangling 을 지적했다. 문자검색이 정확해진 뒤에 볼 문제다.

## 8. 권한과 RLS

| 동작 | 가드 |
|---|---|
| 읽기 | 현행과 같음(프로젝트 접근권) |
| **본문 작성·편집·되돌리기** | **`requireProjectMember(projectId)`** |
| 문서 삭제(본문 비우기)·트리 이동·핀 고정 | `requireProjectAdmin(projectId)` |
| 제안 승인/무시 · 주제 병합 · 항목 큐레이션 | `requireProjectAdmin(projectId)` (현행과 같음) |

본문 편집을 관리자 전용으로 하면 위키는 죽는다. 되돌리기를 멤버에게 주는 이유도 같다 —
이력이 남으므로 안전하고, 되돌릴 수단이 없으면 아무도 남의 문서에 손대지 못한다.

가드는 기존 셋만 쓴다. 액션에 `role === '...'` 을 직접 적지 않는다(CLAUDE.md).
`topicId` 만 받는 액션은 `resolveProjectId('wiki_topics', topicId)` 로 먼저 읽고, 그
프로젝트로 판정한다 — 클라이언트가 보낸 `projectId` 만 믿으면 자기가 관리자인 프로젝트를
적어 남의 프로젝트 문서를 고칠 수 있다(`actions/wiki.ts:46-51` 이 이미 같은 이유로 대상
결합을 한다).

### 8.1 RLS 2차 방어선 — 이번 작업의 보안상 순이득

현재 `wiki_topics`·`wiki_items` 는 `_read` 정책만 있고 쓰기 정책이 하나도 없다
(`0045_minutes_wiki.sql:1960-1966`). 모든 쓰기가 service_role 로 나가므로, CLAUDE.md 가
경고한 대로 **서버 액션 가드가 유일한 관문**이다.

본문·트리 컬럼은 사람이 쓰는 것이므로 여기서 갈라놓는다.

- `authenticated` 로 쓰고, **프로젝트 멤버십을 확인하는 `update` 정책**을 건다.
- 컬럼 범위 제한은 **컬럼 단위 권한을 1순위로 쓴다.** RLS 의 `using`/`with check` 는 행
  조건만 걸 뿐 **어느 컬럼이 바뀌었는지 못 본다** — 그래서 정책만으로는 AI 컬럼이 함께
  열린다.

  ```sql
  grant update (body_md, body_updated_at, body_updated_by, parent_id, sort, pinned_order)
    on public.wiki_topics to authenticated;
  ```

  스테이징 실행에서 이 방식이 supabase-js 경로와 맞지 않으면(예: 클라이언트가 전체 컬럼을
  보내 권한 오류가 나면) `OLD`/`NEW` 를 비교하는 `before update` 트리거로 대체한다.
  **둘 중 하나를 반드시 고르고 그 근거를 마이그레이션 커밋에 남긴다.**
- AI 가 쓰는 컬럼은 지금처럼 service_role 전용으로 남는다.
- `wiki_topic_revisions` 는 `insert`(멤버) + `select`(프로젝트 접근권) 정책을 갖는다.

## 9. 자동 반영 재개 (B)

순서는 **A 배포 → B 배포 → 그 다음에 스위치**다.

### 9.1 AI 가 하는 일

- 추출 파이프라인(`wiki-ingest.ts`)은 **거의 그대로 둔다.** 새 항목에
  `review_state='pending'` 을 붙이는 것이 유일한 필수 변경이다.
- **AI 가 주제를 새로 만드는 것을 막지 않는다.** §4 의 규칙 덕분에 그 주제는 `body_md` 가
  없어 트리에 서지 않고 "정리 안 된 지식"에만 있다. 사람의 네비게이션은 오염되지 않는다.
- 2026-07-30 스펙의 포화 게이팅(`WIKI_TOPIC_ITEM_CAP`·카탈로그 3단 구성)은 **그대로 둔다.**
  사람이 문지기가 됐으니 예전만큼 중요하지 않지만, 끄면 카탈로그 프롬프트가 다시 커져
  출력 잘림(`f74fc5a`)으로 큐가 멈추는 경로가 돌아온다.

### 9.2 제안 검토

- 승인 단위는 **항목 하나씩**, 그리고 **"이 문서의 제안 전부 승인"** 이다. 전부 무시는
  제공하지 않는다 — 되돌리기 부담이 비대칭이다.
- `pending → accepted | rejected`. `rejected → pending` 되돌리기는 허용한다(오클릭 복구).
  `accepted → pending` 은 불가다 — 이미 근거로 편입됐으므로 기존 큐레이션(숨김)으로 처리한다.
- **어느 문서에도 안 붙는 제안**(본문 없는 주제의 `pending`)은 홈의 "반영 대기 제안"에서
  `새 주제: 〈이름〉` 으로 묶어 보여준다. **승인은 "이 추출이 맞다"는 뜻이지 "문서를
  만든다"는 뜻이 아니다.** 문서화는 사람이 본문을 쓸 때만 일어난다.

### 9.3 스위치를 올리기 전 게이트 셋

1. **"AI 경로가 `body_md`·`body_updated_*`·`parent_id`·`sort`·`pinned_order` 를 쓰지
   않는다"는 테스트가 통과한다**(§11).
2. 스테이징에서 회의록 1건을 실제로 태워 `pending` 으로만 쌓이는 것을 확인한다.
3. **첫 배치는 크론 없이 수동 1회.** 제안이 어떤 모양으로 생기는지 눈으로 본 뒤에
   `vercel.json` 크론과 `WIKI_WORKER_ENABLED` 를 켠다.

이 셋을 통과한 뒤에야 Vercel Production 에 `WIKI_SERVICE_ENABLED=true` 를 넣는다.

## 10. 범위 밖

이번에 하지 않는다. 각각 별도 스펙이다.

- **C 덩어리 전체** — 회의록·이슈·WBS·주간보고 ↔ 위키 상호 링크, 전역 검색 진입,
  봇 `getWikiTopic` 의 `ilike` + `limit(1)` 정밀화(2026-07-30 스펙 §11 이 남긴 숙제).
- 드래그앤드롭 트리 재배치 — 1차는 부모 선택 드롭다운.
- 의미검색(임베딩) — §7.3.
- 실시간 공동 편집 — 1차는 낙관적 잠금(§6.5).
- 문서 첨부파일, 문서별 비공개 권한, 문서 템플릿.
- 문장 편집 허용 — **하지 않는다.** AI 항목의 문장은 계속 못 고친다. 원문 추적 계약을
  지키는 대신, 사람이 하고 싶은 말은 본문에 쓴다.

## 11. 테스트 계획

프로덕션 DB 를 건드리는 테스트는 만들지 않는다.

**순수 도메인** (`tests/domain/`)
- 트리 조립 — 정상 3단, 깊이 4 거부, 고아(부모가 문서 아님) 루트 승격, **순환 참조 끊기**
- 문서/미정리 판정 — `body_md` 가 `null`·`''`·공백만·정상일 때
- `review_state` 필터 — `pending`·`rejected` 가 근거·검색·집계에 안 나온다
- 상태 라벨 접기 17→5 매핑 고정
- **§7.1 의 SQL 조건표와 `wikiView.ts` 순수 함수가 같은 픽스처에서 같은 수를 낸다**

**액션 가드** (`tests/actions/`, 기존 `authz-gate-*` 패턴)
- 본문 저장·되돌리기: 멤버 통과 / 무권한 거부
- 트리 이동·핀·제안 승인: 관리자만 통과
- **타 프로젝트 문서에 자기 관리자 `projectId` 를 붙여 보내면 거부**
- 낙관적 잠금 — 오래된 `body_updated_at` 으로 저장하면 거부

**마이그레이션** (`tests/migrations/`, 기존 패턴)
- 백필이 1,219건 전부를 `accepted` 로 만든다
- `_rollback.sql` 이 컬럼·테이블·정책을 되돌린다
- RLS update 정책이 본문·트리 컬럼 외의 변경을 거부한다

**안전 (이 스펙의 핵심 테스트)**
- **AI 경로가 본문 계열 컬럼을 `select` 하지도 `update` 하지도 않는다.**
  `tests/ai/wiki-service-suspended.test.ts` 가 "반환값만 보면 쓰고 나서 null 을 준 경우를
  못 잡는다"며 **DB 클라이언트를 아예 만들지 않는 것까지 보는** 방식을 그대로 따른다.

**UI** (`tests/ui/`)
- 본문 저장 → revision 생성 → 되돌리기 → 트리 반영
- 초안 버튼이 **저장하지 않는다**(편집기에만 채운다)

## 12. 이행

### 12.1 커밋·배포 순서

CLAUDE.md 의 규칙을 그대로 따른다.

1. **마이그레이션 커밋을 코드와 분리한다**(G1 훅). `supabase/migrations/0079_*` 는 별도 커밋.
2. **스테이징 리허설 필수**(G4 훅) — `staging:sync` → `db:apply --target staging` → 검증 →
   `Staging-verified:` 트레일러 → staging push → `db:apply --target prod` → main push.
   상세는 `docs/runbook-staging.md`.
3. `Sidebar.tsx` 는 UI 위험 파일이므로 `ui/wiki-*` 브랜치로 push 해 Preview·스테이징에서
   눈으로 확인한 뒤 머지한다. 위키 홈이 2단이 되면서 `globals.css`·`components/app/*` 를
   건드리고 싶어지는데, **건드리지 않는 것을 목표로 한다.** 2026-07-27 사고 때 vitest
   2,438건이 전부 통과했다 — 이 영역은 테스트가 깨짐을 잡지 못한다.
4. 배포 후 `npm run smoke:prod`, 화면까지 확인되면 `npm run mark:good`.

### 12.2 첫 화면 문제

이행 직후 트리는 **0장**이고 "정리 안 된 지식 62"만 있다. 빈 위키는 아무도 쓰지 않는다.

그래서 **관리자용 "시작 문서 만들기" 액션**(1회성)을 A 범위에 포함한다. 프로젝트 개요 ·
용어집 · 자주 묻는 질문 세 장의 **제목과 빈 뼈대만** 만들고 핀에 올린다. 내용은 사람이
채운다. 마이그레이션이 콘텐츠를 넣지 않는다 — 롤백이 불가능해지고 프로젝트마다 맥락이 다르다.

### 12.3 롤백

- 코드: `_rollback.sql` 로 컬럼·테이블·정책을 되돌린다. `wiki_items.review_state` 가 사라지면
  모든 항목이 다시 보이므로 **읽기는 이행 전 상태로 정확히 복귀**한다.
- 잃는 것: 사람이 쓴 본문과 revision. **롤백 전에 `body_md` 를 덤프**한다. 이 절차를
  런북에 적지 않으면 롤백이 곧 문서 소실이다.
- 자동 반영은 `WIKI_SERVICE_ENABLED` 를 내리면 즉시 멈춘다(현재 기본값이 꺼짐).

## 13. 위험과 완화

| 위험 | 완화 | 확인 |
|---|---|---|
| **RLS 정책은 컬럼 범위를 못 막는다** — `using`/`with check` 는 행 조건만 본다 | 컬럼 단위 `grant update` 를 1순위로, 안 맞으면 `before update` 트리거. 근거를 커밋에 남긴다(§8.1) | 마이그레이션 테스트 |
| 서버 집계(§7.1)와 순수 함수(`wikiView.ts`)가 갈려 숫자가 또 틀린다 | 조건표를 한 곳에 고정하고 같은 픽스처로 두 경로를 대조 | 도메인 테스트 |
| 상충 건수를 단일 테이블 count 로 세어 틀린다 | `wiki_item_sources` 조인 별도 쿼리로 분리(§7.1) | 도메인 테스트 |
| 자동 반영 재개가 8/5 의 위험을 되살린다 | AI 는 `body_md` 계열을 못 쓴다(§4 따름정리) + 게이트 3개(§9.3) | 안전 테스트, 스테이징 실측 |
| `MarkdownView` 정적 import 로 위키를 안 여는 사용자에게 47KB 가 실린다 | `dynamic(..., { ssr: false })` — `WbsSpecPanel` 선례 | 번들 크기 확인 |
| 위키 홈 2단 개편이 전 화면 레이아웃을 깬다 | `globals.css`·`components/app/*` 를 안 건드리는 것을 목표. 불가피하면 브랜치 + 스테이징 육안 확인 | Preview·스테이징 |
| 첫 화면이 비어 아무도 안 쓴다 | 시작 문서 3장 뼈대 + 핀(§12.2) | — |
| **롤백이 사람이 쓴 본문을 지운다** | 롤백 전 `body_md` 덤프를 런북에 명시(§12.3) | 런북 |
| `pg_trgm` 인덱스를 근거 없이 넣어 쓰기 비용만 는다 | 계측 후 별도 마이그레이션, 수치를 커밋에 남긴다(§7.3) | `explain analyze` |
| 기존 `?view=` 딥링크가 깨진다 | `WIKI_VIEWS` 값을 지우지 않고 더하기만 한다. `parseView` 가 모르는 값을 `all` 로 되돌린다 | UI 테스트 |
| 회의록 42건이 오래돼 제안이 안 쌓여 B 의 효과를 못 본다 | 재개 후 전량 재구축 여부는 별도 판단. 이 스펙은 파이프라인만 안전하게 되살린다 | — |

## 14. 성공 판정

| # | 지표 | 이행 전 | 판정 |
|---|---|---:|---|
| 1 | 위키 홈이 잘라 버리는 항목 수 | 719 (59%) | **0** |
| 2 | 탭 건수와 실제 행 수의 차이 | 미측정(틀림) | **일치** |
| 3 | 사이드바에서 위키 도달 가능 | 불가 | **가능** |
| 4 | 사람이 쓴 문서 수 | 0 | **3 이상**(시작 문서) |
| 5 | 문서 상세의 최상위 섹션 수 | 5 | **2 (+조건부 2)** |
| 6 | 화면에 노출되는 상태 라벨 종류 | 17 | **5** |
| 7 | AI 경로가 본문 컬럼을 건드리는가 | — | **아니오(테스트로 증명)** |
| 8 | `WIKI_SERVICE_ENABLED` | 꺼짐 | **켜짐**(게이트 3개 통과 후) |

지표 1·2 는 §3 의 결함이 실제로 닫혔는지 본다. 지표 7 이 자동 반영 재개의 유일한 근거이며,
통과하지 못하면 지표 8 로 넘어가지 않는다.
