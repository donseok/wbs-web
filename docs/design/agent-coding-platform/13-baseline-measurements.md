# 13 — 기준선 실측 (설계자 C · 2라운드)

측정 2026-08-05 · 설계자 C · 대상: `04-pm-synthesis.md` §7 "착수 전 반드시 실측할 것"
전제: 사용자 결정 P1(경로 β — 이식 보류) 이후, 임무는 설계가 아니라 **실측**이다.

> **접근 방식** — 전부 **읽기 전용 `SELECT`**. Supabase Management API `/database/query`(리포 기존 관례).
> INSERT·UPDATE·DELETE·DDL·마이그레이션 적용 **0건**. 운영 D-CUBE 데이터 무변경.
> 자격증명은 이 문서에 적지 않는다(추출 절차는 메모리 `supabase-mgmt-api-recipe` 참조).
> 측정 시각 `2026-08-05 03:26 UTC` · 대상 `PostgreSQL 17.6` · `pg_database_size` 53 MB.

---

## 0. 결과 한눈에

| §7 항목 | 남긴이 | 결과 | 판정 |
|---|---|---|---|
| `task_dependencies` 등록 건수 | A-11 | **0건** (전 프로젝트) | **A의 우려가 현실이다.** 임계경로·총여유 기반 우선순위는 현재 데이터로 작동하지 않는다 |
| 벡터 청크 행 수 | C-1 | **총 1,390행** (124 / 1,266 / 0) | **가정치 30,000의 1/20.** 브루트포스가 여유롭게 성립 → 이식 리스크 R3 대폭 하락 |
| Storage 객체 수·용량 | C-2 | **25객체 / 363 kB** | **파일시스템 압승.** 오브젝트 스토리지 논쟁 종료 |
| `auth.users` 해시 이행 가능성 | C-3 | **bcrypt `$2a$` · 52계정** | 기술적으로 이행 가능(단서는 §4) |
| `npm run build`·`test` 소요시간 | B-4/5 | **측정 못 함** | 빌드 실행 금지 + 리포에 CI 이력 없음(§5) |
| 사내 서버 가용성 | C-8 | **측정 못 함** | DB 조회로 확인 가능한 성질이 아님(§5) |

---

## 1. `task_dependencies` 등록 건수 — **0건**

### 결과

| project_id | 프로젝트 | 등록된 의존 |
|---|---|---|
| `7a1c6034-…f6f3` | D-CUBE 프로젝트 | **0** |
| `99999999-…9999` | 에이전트 루프 검증(테스트) | **0** |
| | **합계** | **0** |

프로젝트는 이 둘이 전부다.

### 조회 방법

```sql
select p.id::text as project_id, p.name, count(td.id) as deps
from projects p left join task_dependencies td on td.project_id = p.id
group by p.id, p.name order by deps desc, p.name;

select count(*) as total from task_dependencies;   -- → 0
```

### 맥락 — 그러면 무엇으로 순서를 정하는가 (보충 측정)

의존이 0이라 "그럼 스케줄러가 볼 것이 아예 없는가"가 곧바로 따라온다. 대체 근거가 되는 계획일 채움률을 함께 쟀다.

| 프로젝트 | 전체 항목 | 리프 | 리프 중 `planned_start` 있음 | `planned_end` 있음 |
|---|---|---|---|---|
| D-CUBE 프로젝트 | 145 | **98** | **98 (100%)** | **98 (100%)** |
| 에이전트 루프 검증(테스트) | 28 | 16 | 12 (75%) | 12 (75%) |

```sql
select p.name,
 count(*) filter (where not exists (select 1 from wbs_items c where c.parent_id=w.id)) as leaves,
 count(*) filter (where not exists (select 1 from wbs_items c where c.parent_id=w.id) and w.planned_start is not null) as leaves_with_start,
 count(*) filter (where not exists (select 1 from wbs_items c where c.parent_id=w.id) and w.planned_end is not null) as leaves_with_end
from wbs_items w join projects p on p.id=w.project_id group by p.name order by leaves desc;
```

### 설계자 A에게 전달할 함의

- **의존성 기반 트리거·임계경로·총여유(slack) 우선순위는 지금 데이터로 검증조차 불가능하다.** 0건이므로 어떤 정렬을 넣어도 전부 동률이 된다.
- 반면 **계획일은 D-CUBE 리프 98개가 100% 채워져 있다.** 즉 킥오프 §3-1의 "계획 시작일이 되면 착수"는 **오늘 당장 실행 가능한 유일한 트리거**다.
- 판단: 의존성 축은 설계에 남기되 **비활성 상태로 두고**, 1차 구현의 트리거·우선순위는 계획일(+`code`/`sort_order` 결정적 타이브레이크)로 간다. 의존성을 전제로 한 기능을 1차에 넣으면 **테스트할 데이터가 없어 검증 없이 배포된다.**
- 남는 질문(이 문서가 답하지 않음): 의존이 0인 것이 "필요 없어서"인지 "입력 UI가 있는데 안 쓴 것"인지. 전자면 축을 접어도 되고, 후자면 데이터 입력이 선행 과제다. **사용자에게 물어야 한다.**

---

## 2. 벡터 청크 행 수 — **총 1,390행**

### 결과

| 테이블 | 행 수 | 임베딩 non-null | 차원(실측) | 물리 크기 |
|---|---|---|---|---|
| `wbs_embeddings` | **124** | 124 | 768 | 1,408 kB |
| `minute_embeddings` | **1,266** | 1,266 | 768 | 12 MB |
| `ai_documents` | **0** | 0 | — | 64 kB (빈 테이블) |
| **합계** | **1,390** | 1,390 | | |

HNSW 인덱스는 세 테이블 모두 실재한다(`ai_documents`는 빈 채로).

### 조회 방법

```sql
select 'wbs_embeddings' as t, count(*) as rows, count(embedding) as with_vec from wbs_embeddings
union all select 'minute_embeddings', count(*), count(embedding) from minute_embeddings
union all select 'ai_documents',      count(*), count(embedding) from ai_documents;

-- 차원 실측
select 'wbs_embeddings' as t, vector_dims(embedding) as dims, count(*) from wbs_embeddings group by 1,2
union all select 'minute_embeddings', vector_dims(embedding), count(*) from minute_embeddings group by 1,2;

-- 인덱스 실재
select tablename, indexname, indexdef from pg_indexes
where schemaname='public' and indexdef ilike '%hnsw%';

-- 물리 크기
select relname, pg_size_pretty(pg_total_relation_size(c.oid)) as sz
from pg_class c join pg_namespace n on n.oid=c.relnamespace
where n.nspname='public' and relname in ('wbs_embeddings','minute_embeddings','ai_documents');
```

### 함의 — `03-platform-port.md` §3.4 안 2가 확정적으로 성립한다

내 이식 문서는 "청크 3만 개 ≈ 92MB이면 브루트포스 실용 범위, 단 실측 필요"라고 썼다. **실측값은 1,390행으로 가정치의 1/20이다.**

- 메모리: 1,390 × 768 × 4바이트 ≈ **4.1 MB** (JS `number` 배열로 올려도 ≈ 8.1 MB)
- 질의당 연산: 1,390회 내적 × 768차원 ≈ **107만 회 곱셈-덧셈** — Node에서 한 자릿수 밀리초
- 10배 늘어도(13,900행) 41 MB / 10.7M 연산으로 여전히 여유

**따라서:**

1. **P2(MariaDB 허용)는 이제 "필수"가 아니라 "편의"다.** MySQL Community로 고정되더라도 의미검색이 죽지 않는다. 앱 브루트포스로 충분하다. — `03-platform-port.md` **R3(의미검색 품질 붕괴)를 하향 조정**한다.
2. 다만 MariaDB 권고 자체는 유지한다. 브루트포스는 "지금 규모에서 맞는" 답이고, 인덱스는 규모가 커져도 맞는 답이다. **결정을 미룰 수 있게 됐을 뿐 바뀌지 않았다.**
3. 이식 시 벡터 데이터는 재생성이 정답이라는 판단도 유지 — 1,390행 재색인은 무료 티어 RPM 20에서도 몇 시간이면 끝난다(설계자 B의 레이트리밋 큐 설계와 같은 축).

### 부수 발견 — `ai_documents`가 비어 있고 색인 잡 76건이 대기 중이다

```sql
select status, count(*) as n from ai_index_jobs group by status order by n desc;
-- → [{"status":"pending","n":76}]
```

`0031_ai_knowledge_index.sql`의 통합 지식 인덱스(챗봇 v2용)는 **테이블·HNSW 인덱스까지 만들어져 있으나 행이 0이고, 색인 잡 76건이 `pending`으로 쌓여 있다.** 워커가 돈 적이 없거나 꺼져 있다는 뜻이다(`CHAT_V2_INDEX_WORKER_ENABLED` 계열 플래그 존재 확인, 실제 값은 이 세션에서 확인하지 않음).

이것은 이식이나 에이전트 기능의 선행 조건은 아니지만, **"챗봇 v2가 통합 인덱스를 쓴다"는 전제로 무언가를 설계하면 그 전제가 지금 거짓**이다. 현재 실제로 검색되는 것은 `wbs_embeddings`(124) + `minute_embeddings`(1,266)뿐이다. PM에게 별건으로 보고한다.

---

## 3. Storage 버킷 객체 수·총 용량 — **25객체 / 363 kB**

### 결과

| 버킷 | 공개 | 파일 크기 상한 | 객체 수 | 총 용량 | 최대 파일 | 최초/최종 객체 |
|---|---|---|---|---|---|---|
| `deliverables` | 비공개 | 없음 | **0** | 0 B | — | — |
| `minutes` | 비공개 | 20 MB | **25** | **372,207 B (363 kB)** | 42,398 B | 2026-07-10 / 2026-08-04 |

### 조회 방법

```sql
select id, public, file_size_limit, created_at from storage.buckets order by id;

select bucket_id, count(*) as objects,
       sum((metadata->>'size')::bigint) as total_bytes,
       pg_size_pretty(sum((metadata->>'size')::bigint)) as total_pretty,
       max((metadata->>'size')::bigint) as max_bytes,
       min(created_at)::date as first, max(created_at)::date as last
from storage.objects group by bucket_id order by bucket_id;

-- deliverables 가 group by 에 안 나온 것이 '0건'인지 확인
select (select count(*) from storage.objects where bucket_id='deliverables') as obj_deliverables,
       (select count(*) from storage.objects where bucket_id='minutes')      as obj_minutes,
       (select count(*) from deliverable_attachments) as meta_deliverable_attachments,
       (select count(*) from minute_files)            as meta_minute_files;
```

### 함의 — `03-platform-port.md` D6이 자명해졌다

- 총 363 kB다. **오브젝트 스토리지(R2/B2)를 도입할 이유가 없다.** 로컬 파일시스템 + HMAC 서명 URL(§3.3 안 A)로 확정.
- 브라우저 직업로드를 포기하고 서버 경유로 바꾸는 대가도 무시할 만하다 — **현존 최대 파일이 42 kB**다. 버킷 상한은 20 MB지만 실사용은 그 0.2%다.
- 다만 이 숫자는 "지금까지의 사용량"이지 "앞으로의 상한"이 아니다. 산출물 첨부(`deliverables`)가 **0건**인 것은 기능이 안 쓰이고 있다는 뜻이며, 쓰이기 시작하면 도면·PPT 같은 큰 파일이 들어올 수 있다. **상한 설계는 20 MB 기준을 유지한다.**

### 부수 발견 — 메타데이터 없는 객체 3건

```sql
select count(*) as objects_without_meta from storage.objects o where o.bucket_id='minutes'
 and not exists (select 1 from minute_files f where f.file_path = o.name);          -- → 3

select count(*) as meta_without_object from minute_files f
 where not exists (select 1 from storage.objects o where o.bucket_id='minutes' and o.name = f.file_path);  -- → 0
```

`minutes` 버킷 객체 25건 중 **3건이 `minute_files`에 대응 행이 없다.** 반대 방향(메타는 있는데 객체가 없음)은 0건이다.

**진단하지 않고 관찰만 남긴다.** 업로드 실패 시 클라이언트가 객체를 되돌리는 보상 로직이 있는데(`MinuteUploadModal.tsx:153,186`) 그것이 돌지 못한 경우일 수 있고, 다른 경로일 수도 있다. 데이터 훼손은 아니며(고아 객체 3개, 총 용량 무시할 수준) 이식 결정에 영향이 없다. **이식 시 파일 복사는 `minute_files` 기준으로 하면 고아가 자연 소거된다**는 점만 기록한다.

---

## 4. `auth.users` 해시 이행 가능성 — **bcrypt `$2a$` · 52계정** (C-3, 부분 해소)

### 결과

| 항목 | 값 |
|---|---|
| 계정 수 | **52** |
| `encrypted_password` 보유 | **52 (100%)** |
| 로그인 이력 있음(`last_sign_in_at`) | 48 |
| 해시 알고리즘 식별자 | **`$2a$`** (bcrypt) — 52건 전부 동일 |

### 조회 방법 — 최소 노출 원칙

해시 원문을 조회하지 않았다. **알고리즘 식별자에 해당하는 앞 4글자만** 집계했다.

```sql
select left(encrypted_password,4) as algo_prefix, count(*) as n
from auth.users group by left(encrypted_password,4) order by n desc;
-- → [{"algo_prefix":"$2a$","n":52}]

select count(*) as users, count(encrypted_password) as with_pw,
       count(*) filter (where last_sign_in_at is not null) as ever_signed_in
from auth.users;
```

### 판정

- **기술적으로 이행 가능하다.** `$2a$`는 표준 bcrypt이고 Node의 `bcrypt`/`bcryptjs`가 그대로 검증한다. 새 스택에서 "기존 비밀번호로 로그인"이 성립한다.
- **읽기 경로도 존재한다** — 이 조회 경로(Management API)로 해당 컬럼에 접근된다는 사실이 확인됐다.
- **다만 "가능"과 "해도 된다"는 다르다.** 52명분 비밀번호 해시를 반출하는 것은 별도의 승인 사항이며 이 문서의 권한 밖이다. 그리고 `03-platform-port.md` §7의 권고(**빈 DB로 시작**)를 유지하면 이 문제 자체가 발생하지 않는다.
- 반출을 하지 않기로 하면 대안은 이미 있다 — 초대 v2(0065)의 메일 발송 경로로 전원 재설정. 인프라를 새로 만들 필요가 없다.

**따라서 C-3은 "미확인"에서 "확인됨(이행 가능) / 단 실행은 권고하지 않음"으로 상태를 바꾼다.**

---

## 5. 측정하지 못한 항목 — 왜 못 했는가

### 5.1 `npm run build` · `npm run test` 실제 소요시간 (B-4/5)

**측정 못 함. 사유 둘:**

1. **이 세션은 빌드·설치 실행이 금지돼 있다**(안전 제약). 직접 재는 방법이 차단됐다.
2. **간접 측정할 이력도 리포에 없다** — `.github/workflows/` 디렉터리가 존재하지 않는다(실측). 즉 CI 실행 기록이라는 형태로 남은 소요시간이 없다.

```bash
ls -la .github/workflows/    # → 디렉터리 없음
```

**대신 아는 것:** 빌드는 Vercel이 강제하고 있으므로(CLAUDE.md) **Vercel 배포 이력에는 빌드 시간이 남아 있다.** 사용자가 Vercel 대시보드에서 최근 배포 몇 건의 Build 소요를 보면 즉시 답이 나온다. 테스트는 로컬에서 `npm run test`를 한 번 돌리면 된다(테스트 파일 238개).

**설계자 B에게:** 품질 게이트의 `build 10분 / test 15분`은 여전히 **근거 없는 가정값**이다. 이 문서가 그것을 실측으로 바꾸지 못했다. 파일럿 전에 위 두 방법 중 하나로 반드시 채울 것.

### 5.2 사내 서버 가용성 (C-8 / P4)

**측정 못 함.** DB 조회로 확인되는 성질의 정보가 아니다. 사용자·조직에 물어야 답이 나온다.

PM 문서 §4-1이 **"없음/미확인"** 으로 기록했고, 경로 β 채택으로 **당장은 무해**하다(이식 착수 전까지 비활성). 이식 착수 결정 시점에 반드시 다시 올려야 하는 미해결 항목으로 남는다.

### 5.3 이 문서가 일부러 재지 않은 것

- **운영 데이터의 내용**은 조회하지 않았다. 전부 `count`·`sum`·크기·스키마 메타데이터다. 유일한 예외가 §4의 해시 접두 4글자이며, 그것도 알고리즘 식별자 이상은 읽지 않았다.
- **디스크 사용률**은 재지 않았다(2026-08-05 장애 원인). §7 항목이 아니고, `pg_database_size`(53 MB)는 디스크 점유의 일부일 뿐이라 이 경로로는 오답이 나온다. 필요하면 Supabase 대시보드의 Database 사용량 지표를 봐야 한다.

---

## 6. 이 실측이 기존 문서에 일으키는 변경

| 문서 | 항목 | 변경 |
|---|---|---|
| `03-platform-port.md` | §9 R3 (의미검색 품질 붕괴) | **하향.** 1,390행이면 브루트포스가 확정적으로 성립. "MySQL 고정 = 검색 사망"이 아니다 |
| `03-platform-port.md` | §8 D1 (MariaDB 허용 여부) | **긴급도 하락.** 권고는 유지하되 "가장 시급"은 아니게 됐다. P2로 이미 허용됐으므로 실무 영향 없음 |
| `03-platform-port.md` | §8 D6 (직업로드 포기 여부) | **확정.** 363 kB·최대 42 kB → 파일시스템 + 서버 경유. 오브젝트 스토리지 검토 종료 |
| `03-platform-port.md` | §11-1·2·3 (모르는 것) | **1·2·3 해소.** 5(이식 기간)·6(MariaDB 성능 PoC)·7(0045/0046 분류)·8(사내 서버)은 그대로 미해결 |
| `01-scheduler-domain.md` | 의존성 기반 우선순위 | **재검토 필요.** 등록 0건 — 임계경로·총여유 축은 검증 불가. 계획일 축으로 1차 구현 권고 |
| `02-agent-runtime.md` | 품질 게이트 시간 예산 | **미해소.** 여전히 가정값(§5.1) |
| `04-pm-synthesis.md` | §7 표 | 6항목 중 **3개 완전 해소 · 1개 부분 해소 · 2개 미해소** |

---

## 7. 남은 미확인 (이 문서 기준)

1. `task_dependencies`가 0인 이유 — 불필요해서인가, 입력을 안 한 것인가. **사용자 확인 필요.**
2. `ai_index_jobs` 76건이 왜 `pending`에 머물러 있는가 — 워커 플래그 값을 확인하지 않았다.
3. `npm run build`/`test` 소요시간 (§5.1).
4. 사내 서버 가용성 (§5.2).
5. `minutes` 버킷 고아 객체 3건의 발생 경위 — 관찰만 했고 원인을 추적하지 않았다.
