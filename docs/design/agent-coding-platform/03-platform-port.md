# 03 — 플랫폼 이식 · 인프라 (설계자 C)

작성: 2026-08-05 · 설계자 C · 수신: PM
대상 킥오프: `docs/design/agent-coding-platform/00-kickoff.md` §5 설계자 C

---

## 1. 요약

1. **RLS는 이식하지 않는 것이 옳다.** 조회 정책 50개 중 42개가 `using (true)`라 RLS는 이미 읽기 권한에 기여하지 않고, 쓰기 정책(0053)은 **PostgREST가 브라우저에 직접 노출돼 있기 때문에** 필요한 방어선이다. MySQL 스택에는 그 노출 자체가 없으므로 방어 대상이 사라진다. 대신 권한 판정은 이미 순수 TS로 존재한다(`src/lib/domain/authz.ts`) — 그것을 정본으로 삼고, `wbs_items` 컬럼 제한 트리거(0052)만 MySQL 트리거로 옮긴다.
2. **pgvector는 MySQL 무료판으로 이식 불가다.** MySQL Community 9.x는 `VECTOR` 타입은 주지만 거리 계산 함수 `DISTANCE()`를 HeatWave(유상)에만 둔다. **MariaDB 11.8 Community(무료·MySQL 호환)로 가면 HNSW 인덱스 + `VEC_DISTANCE_COSINE`이 그대로 성립한다** — 이것이 1순위 권고이고, "MySQL 무료판" 제약의 해석을 PM이 확정해야 한다(§5 D1).
3. **런타임은 Next.js/Node 유지, Tomcat 기각.** 현 코드는 TS 76,425줄·461파일·테스트 238파일이고 RSC/서버액션에 Java 대응물이 없다. Tomcat 전환은 DB 이식(코드의 약 15~20%)이 아니라 **전면 재작성(100%)** 이다. Node는 킥오프가 허용한 "대중적 무상 스택"을 이미 만족한다.
4. **Supabase Auth·Storage·Realtime은 이식하되 비용은 중간이다.** Auth는 자체 세션(쿠키+세션 테이블)으로 대체, Storage는 로컬 파일시스템 + HMAC 서명 URL(브라우저 직업로드 → 서버 경유로 변경), Realtime은 서버 발신 SSE로 대체. **Realtime은 킥오프가 열거하지 않은 다섯 번째 의존이다**(실측 3곳).
5. **데이터는 옮기지 말고 빈 상태로 시작할 것을 권고한다.** 사본은 신제품이고 원본 D'Flow는 계속 돈다. WBS는 이미 배포된 임포트 마법사(엑셀)로 넣을 수 있어 DB→DB ETL이 필요 없다. 계정 비밀번호 해시 이행 가능성은 확인하지 못했다(§6).

---

## 2. 복제 전략

### 2.1 무엇을 복사하는가

새 GitHub 리포로 `git clone`(전체 히스토리 유지). 근거: 커밋 949개·`.git` 26MB로 비용이 사실상 없고, 이 리포는 **왜 그렇게 했는지가 커밋 메시지와 마이그레이션 주석에 들어 있는** 구조다(예: `0053_project_scoped_rls.sql` 상단 30줄이 정책 이름 드리프트의 위험을 설명한다). 히스토리를 지우면 이식 중 "이건 왜 이렇게 돼 있지"를 매번 다시 추론해야 한다.

### 2.2 무엇을 버리는가

| 대상 | 규모(실측) | 판정 |
|---|---|---|
| 위키 | src 5,558줄 + 마이그레이션 4,042줄(0045~0048) + 테이블 7개 | **제외** |
| `progress_snapshots` | 0009에서 이미 drop | 제외 |
| `migration_ledger`(0050) | — | 새 러너의 원장으로 재작성 |
| 임베딩 3종 데이터 | `wbs_embeddings`·`minute_embeddings`·`ai_documents` | 데이터는 버리고 **원문에서 재생성**(재색인 경로가 이미 있다) |
| Supabase 전용 스크립트 | `scripts/apply-00*.mjs` 10개, `smoke-prod.mjs`, `wiki-*` | Management API 의존 — 새 러너로 대체 |

위키 제외만으로 **테이블 57개 → 50개, SQL 9,646줄 → 5,600줄대**로 이식 표면이 줄어든다. 이식 작업의 첫 커밋은 "위키 삭제"여야 한다.

### 2.3 원본과의 향후 동기화

**자동 병합·정기 rebase를 하지 않는다. 단방향 수동 체리픽만.**

근거: 이식 후 두 리포는 데이터 접근 계층이 완전히 갈라진다. 현재 DB 호출 지점은 457곳이고 그중 서버 액션에 234곳이 몰려 있다 — 원본의 기능 커밋은 대부분 이 층을 건드리므로 몇 주 안에 거의 모든 커밋이 충돌한다.

공유가 실제로 가능한 것은 **DB를 모르는 순수 계층**뿐이다:

- `src/lib/domain/**` (권한 판정·롤업·타입)
- `src/lib/excel/**`, `src/lib/report/**` (엑셀·PPT 생성)
- `src/lib/i18n/**`

권고: 이 셋을 사본에서 **디렉터리 그대로 유지**하고, 원본에서 해당 경로 커밋이 나오면 `git cherry-pick` 한다. npm 워크스페이스로 패키지 분리하는 안은 두 리포가 같은 조직 안에 있을 때만 이득이라 지금은 과설계다.

---

## 3. Supabase → MySQL 이식 갭 분석 (핵심)

### 3.0 먼저 — 이식 대상은 넷이 아니라 여섯이다

킥오프 §5는 RLS·Auth·Storage·pgvector 넷을 들었다. 코드 확인 결과 **둘이 더 있다.**

| # | 의존 | 실측 근거 |
|---|---|---|
| 5 | **Realtime**(postgres_changes + Presence) | `src/components/weekly/WeeklySheetView.tsx:149-152`, `src/components/weekly/usePresence.ts:54`, `src/components/app/usePagePresence.ts:37` |
| 6 | **PostgREST 쿼리 빌더 + DB 함수** | `.from('table')` 457곳, `.rpc()` 37곳(28종), `create function` 85회(57종), 트리거 12개 |

6번이 실제로는 가장 큰 이식 비용이다. 넷만 보고 견적을 내면 틀린다.

---

### 3.1 RLS — **이식하지 않는다** (판정: 폐기 + 보상통제)

#### 현황 실측

- `create policy` 184회. 그중 **조회 정책 50개 중 42개가 `using (true)`** (전 마이그레이션 실측).
- `can_read_project(pid)`의 본문은 `select true`다 — `supabase/migrations/0052_authz_roles.sql:58-59`.
- 실질적으로 작동하는 RLS는 **쓰기 정책 34개**(`0053_project_scoped_rls.sql`)와 **Storage 객체 정책 6개**뿐이다.
- 그런데 **회의록·AI 브리핑·에이전트 원장은 쓰기 RLS 정책이 아예 0개**다. `0057_agent_work_loop.sql:56-90`이 명시적으로 "쓰기 정책은 만들지 않는다 — 쓰기는 전부 service_role 경유이며 서버 가드가 유일한 관문"이라고 적고 `revoke all ... from authenticated`를 건다. CLAUDE.md도 같은 사실을 기록하고 있다.

#### 판정 근거

RLS가 이 제품에서 방어하는 위협은 하나다: **`NEXT_PUBLIC_SUPABASE_ANON_KEY`가 브라우저에 노출돼 있으므로, 로그인한 사용자가 앱 UI를 건너뛰고 PostgREST에 직접 쿼리를 던질 수 있다.** 서버 액션 가드는 그 경로를 막지 못하므로 DB 안에 두 번째 관문이 필요했다.

MySQL 스택에는 **그 노출된 엔드포인트가 존재하지 않는다.** DB는 앱 서버만 접속하고, 앱 서버는 서버 액션·API 라우트를 통해서만 쿼리한다. 즉 RLS를 옮겨도 막을 대상이 없고, 실제로 옮길 수도 없다 — MySQL에는 행 수준 보안이 없다(뷰 + `DEFINER` + 세션 변수로 흉내 낼 수는 있으나, 커넥션 풀에서 세션 변수 오염이 나면 **조용히 남의 데이터가 보인다.** 지금보다 나쁜 실패 모드다).

#### 대체물 — 이미 존재한다

권한 판정은 이미 DB 밖 순수 함수로 이중화돼 있다:

- 순수 계층: `src/lib/domain/authz.ts` — `roleIn()` / `isProjectAdmin()` / `isProjectMember()`
- 가드 3종: `src/lib/authz/index.ts` — `requireSuperuser()` / `requireProjectAdmin(pid)` / `requireProjectMember(pid)`
- 대상 행에서 프로젝트를 역추적: `resolveProjectId(table, id)` (같은 파일)

`is_superuser()` / `is_project_admin()` / `is_project_member()` SQL 함수는 이 TS 함수들의 거울이다. 이식은 **거울 하나를 없애는 것**이지 판정 규칙을 새로 만드는 것이 아니다.

#### 반드시 함께 가야 할 보상통제 (이게 빠지면 이식은 실패다)

RLS를 버리면 **서버 코드의 가드 누락 = 즉시 데이터 유출**이 된다. 지금은 한 겹이 더 있어서 살아남는다. 세 가지를 요구한다.

| 통제 | 내용 |
|---|---|
| **C-1 단일 접근 경계** | DB 호출을 `src/lib/repositories/**` 한 층으로 모으고, 그 밖에서 DB 드라이버 import를 ESLint `no-restricted-imports`로 금지한다. 현재는 457곳이 흩어져 있고 리포지터리 층은 35곳뿐이다 — **이식은 이 정리를 강제할 유일한 기회**다. |
| **C-2 가드 강제 테스트** | 모든 서버 액션에 대해 "가드 호출 없이 리포지터리를 쓰지 않는다"를 검사하는 정적 테스트. 기존 `tests/authz/**`가 이미 있어 확장하면 된다. |
| **C-3 컬럼 범위 트리거 유지** | `0052_authz_roles.sql:133-159`의 `guard_non_admin_column_scope`(비관리자는 `actual_pct`·`deliverable`만 수정)는 **MySQL BEFORE UPDATE 트리거로 옮긴다.** MySQL에는 `to_jsonb(new) - 'col'` 차분 관용구가 없으므로 컬럼 비교를 명시적으로 쓴다 — `wbs_items` 컬럼 수를 감안해도 30줄 이내. 가장 위험한 테이블의 마지막 방어선이라 값이 있다. |

**이식 비용:** 정책 이식 0줄, 보상통제 C-1이 사실상 전체 이식의 절반(§3.6 참조).

---

### 3.2 Supabase Auth — **이식한다** (판정: 자체 세션으로 대체, 비용 중)

#### 현황 실측

| 기능 | 근거 |
|---|---|
| 비대칭(ES256) JWT + JWKS 로컬 검증, 미들웨어에서 토큰 자동 갱신 | `src/middleware.ts:26` 및 그 위 주석 8줄 |
| 쿠키 세션(`@supabase/ssr`) | `src/lib/supabase/server.ts`, `src/lib/supabase/client.ts` |
| 비밀번호 로그인 | `src/app/login/page.tsx:62` |
| 로그아웃 | `src/components/app/HeaderChrome.tsx:84` |
| 비밀번호 변경(재인증 후 `updateUser`) | `src/components/account/ChangePasswordModal.tsx:36,44` |
| 관리자 계정 CRUD (`auth.admin.*`) | `accounts.ts:83,100,249` · `inviteRedeem.ts:141,344` · `projectInvites.ts:310` |
| 계정 목록(이메일·마지막 로그인) | `src/lib/data/accounts.ts:22` · `src/lib/data/usage.ts:134` · `src/lib/minutes/externalApi.ts:135` |
| DB 결합 | `references auth.users(id)` **42회** |

#### 대체 설계

**JWT가 아니라 서버 세션 테이블 + HttpOnly 쿠키를 권고한다.**

근거: 현재 JWT를 쓰는 이유는 PostgREST/Storage/Realtime이 **앱 서버를 거치지 않고** 토큰을 검증해야 하기 때문이다. 그 세 소비자가 사라지면 JWT의 유일한 장점(무상태 검증)이 사라지고, 대신 리프레시 토큰 회전·만료·JWKS 캐시라는 복잡도만 남는다. 세션 테이블이면 즉시 폐기(강제 로그아웃)가 `DELETE` 한 줄이다.

```
users(id CHAR(36) PK, email, password_hash, created_at, last_sign_in_at, disabled_at)
sessions(id CHAR(36) PK, user_id, expires_at, created_at, user_agent, ip)
```

- 해시: **argon2id**(없으면 bcrypt cost≥12). Node 라이브러리 무료.
- `auth.users` 42개 FK → 위 `users` 테이블로 그대로 치환. 스키마 관점에서는 오히려 단순해진다(교차 스키마 FK가 사라진다).
- 미들웨어(`src/middleware.ts`)는 세션 쿠키 조회 + 만료 슬라이딩으로 교체. 현재 파일의 주석이 경고하는 "쿠키를 직접 디코드하지 말 것"은 GoTrue 갱신 경로 때문이며, 세션 테이블에서는 해당 없음.
- `auth.admin.*` 8개 호출 지점 → `users` 테이블 CRUD. `listUsers({page, perPage})` 3곳은 그냥 `SELECT ... LIMIT/OFFSET`.
- 메일 발송은 **이미 자체 SMTP(nodemailer)** 다(`src/lib/mail/transport.ts`). Supabase 메일에 의존하지 않으므로 초대·비밀번호 재설정 메일 경로는 그대로 산다.

#### 이식 비용

중. 인증 코어 신규 작성 ~400줄 + 호출 지점 교체 ~20곳 + 미들웨어. **위험은 코드량이 아니라 "직접 만든 인증"의 결함 가능성**이다(§7 R2).

---

### 3.3 Storage — **이식한다** (판정: 파일시스템 + HMAC 서명 URL, 비용 중, 업로드 흐름 변경 필요)

#### 현황 실측

- 비공개 버킷 2개: `deliverables`(`0008_attachments.sql:4-6`), `minutes`(20MB 상한, `0021_minutes.sql:56-58`).
- 서명 URL 1시간: `src/app/actions/attachments.ts:50`, `src/app/actions/minutes.ts:714-715`, `src/lib/data/minutes.ts:246`.
- **브라우저가 스토리지에 직접 업로드한다** — `MinuteUploadModal.tsx:136,178`, `MinuteViewer.tsx:604`, `RowDetailPanel.tsx:575`. 실패 시 객체를 되돌리는 보상 로직까지 클라이언트에 있다(`MinuteUploadModal.tsx:153,186`).
- 객체 접근 제어는 RLS 정책 6개(그중 하나는 `can_attach(...)` 함수 호출).

#### 대체 설계와 그 대가

| 안 | 평가 |
|---|---|
| **A. 앱 서버 로컬 디스크 + HMAC 서명 URL** | **권고.** 무료·의존 0. 다운로드는 `/api/files/[token]`이 서명 검증 후 스트리밍. |
| B. Cloudflare R2 / Backblaze B2 (S3 호환) | 프리티어 존재. presigned PUT을 지원하므로 **브라우저 직업로드를 유지**할 수 있다. 다만 외부 서비스 의존이 생기고 "완전 무상"이 아니다. |
| C. MySQL BLOB 저장 | **기각.** 백업 크기 폭증, 스트리밍 불가, 20MB 파일에 부적합. |

**A를 택하면 업로드가 서버 경유로 바뀐다.** 20MB 본문이 앱 서버를 통과한다. 이것은 결과적으로 **Vercel 서버리스를 배제하는 근거**이기도 하다(요청 본문 상한 4.5MB). 즉 §5 D3(자체 호스팅)와 묶여 있는 결정이다.

객체 접근 제어는 RLS 정책 대신 **서명 토큰에 (파일ID, 사용자ID, 만료)를 담고 발급 시점에 서버 가드로 판정**한다. `can_attach()`의 로직은 이미 TS로 재현 가능하다(`isProjectAdmin` + 팀 담당 확인).

---

### 3.4 pgvector — **MySQL 무료판으로는 이식 불가.** (판정: DB 선택을 바꾸거나, 기능 등급을 낮추거나)

여기가 이 문서에서 가장 중요한 항목이다. 숨길 것이 없도록 근거부터 적는다.

#### 현황 실측

| 대상 | 근거 |
|---|---|
| `wbs_embeddings.embedding vector(768)` + HNSW 인덱스 | `0010_dkbot_pgvector.sql:20,28-29` |
| `minute_embeddings` + HNSW | `0021_minutes.sql:43-53` |
| `ai_documents.embedding vector(768)` + HNSW | `0031_ai_knowledge_index.sql:31,64` |
| 검색 RPC 3종 (`<=>` 코사인 거리) | `0010:45-68`, `0021:112-139`, `0031:252` |
| 앱 소비처 | `src/lib/ai/retrieve.ts:41`(챗봇), `minutes-answer.ts`(회의록 검색), 인사이트·브리핑·이슈분석 |
| 차원 고정 | 768 (`gemini-embedding-001`을 `outputDimensionality=768`로 축소) — `0010` 헤더 주석, `src/lib/ai/embeddings.ts:35` |

#### MySQL 쪽 사실

- MySQL 9.x Community는 `VECTOR` **타입**을 제공하지만, 유사도 계산 함수 `DISTANCE()`는 **HeatWave(유상 OCI 제품) 전용**이다. 커뮤니티 에디션에는 거리 함수도, 벡터 인덱스도 없다.
- 즉 **"MySQL 무료판"을 문자 그대로 지키면 의미검색을 DB에서 수행할 수 없다.**

#### 선택지 4개와 판정

| 안 | 무료? | 결과 | 판정 |
|---|---|---|---|
| **1. MariaDB 11.8 Community** | ○ | 네이티브 `VECTOR(N)` + HNSW `VECTOR INDEX` + `VEC_DISTANCE_COSINE()`. 최대 16,383차원이라 768은 여유. SQL·와이어 프로토콜이 MySQL 호환이라 나머지 이식 설계는 그대로 유효 | **1순위 권고** |
| 2. MySQL + 앱 메모리 브루트포스 | ○ | 임베딩을 `JSON`/`BLOB`로 저장하고 Node에서 코사인 계산. 인덱스 없음 → 전량 스캔 | 조건부 가능(§아래) |
| 3. MySQL + 별도 벡터 엔진(Qdrant·Chroma 자체 호스팅) | ○ | 성능은 충분하나 **운영 컴포넌트가 하나 더 늘고 데이터가 두 곳으로 갈라진다** | 3순위 |
| 4. 의미검색 폐기 | ○ | 챗봇을 결정형(구조화 조회) 답변만으로 운영 | 최후 수단 |

**안 2의 성립 조건:** 청크 3만 개 × 768차원 × 4바이트 ≈ 92MB. 프로세스 메모리에 상주시키면 질의당 3만 회 내적(≈수십 ms)으로 실용 범위다. 다만 **현재 프로덕션의 실제 청크 수를 확인하지 못했다**(운영 DB 무접촉 제약, §6). 10만을 넘으면 이 안은 무너진다. 채택 전 반드시 실측할 것.

**안 4가 "그냥 죽는" 것이 아니라는 사실은 코드로 확인했다.** `src/lib/ai/retrieve.ts:36-68`은 임베딩 키 없음·마이그레이션 미적용·RPC 오류 중 무엇이든 **빈 배열로 강등**해 결정형 답변 경로가 끊기지 않게 설계돼 있다. 즉 의미검색 없이도 챗봇은 500을 내지 않고 동작한다. 품질만 떨어진다. 이 여유가 있다는 것이 이 이식의 몇 안 되는 행운이다.

**권고:** D1(§5)에서 MariaDB 허용 여부를 먼저 확정한다. 불가하면 안 2로 가되 **청크 수 실측을 선행 조건으로 건다.**

---

### 3.5 Realtime — **부분 이식** (킥오프 미열거 항목)

| 용도 | 위치 | 대체 |
|---|---|---|
| 주간시트 행 변경 브로드캐스트(`postgres_changes`) | `WeeklySheetView.tsx:149-152` | **서버 발신 SSE.** 모든 쓰기가 서버 액션을 통과하므로 write 경로에서 인프로세스 pub/sub로 이벤트를 쏘면 된다. DB 변경 캡처(CDC) 불필요 |
| 주간시트 프레즌스 | `usePresence.ts:54` | SSE + 하트비트(인메모리 맵) |
| 페이지 프레즌스 | `usePagePresence.ts:37` | 동일 |

**함정:** 인프로세스 pub/sub은 **앱 인스턴스가 1개일 때만 맞다.** 다중 인스턴스로 가면 Redis pub/sub이 필요하다. 자체 호스팅 단일 VM(§4 권고)이면 문제없고, 수평 확장하면 즉시 깨진다. 설계 문서에 "단일 인스턴스 전제"를 명시하고 배포 스크립트가 그것을 강제해야 한다.

---

### 3.6 PostgREST 쿼리 빌더 + DB 함수 — **가장 큰 비용** (킥오프 미열거 항목)

#### 규모 실측

| 항목 | 수 |
|---|---|
| `.from('table')` 호출 지점 | **457** (actions 234 · data 68 · ai 55 · repositories 35 · api 30 · minutes 15 · agent 8 · components 4 · teams 1) |
| `.rpc()` 호출 | 37회 / 28종 |
| 중첩 리소스 임베딩(`teams(code)` 같은 암묵 조인) | 20회 / 16종 |
| `.maybeSingle()` / `.single()` | 127 / 59 |
| `create function` | 85회 / 57종 (위키 약 17종 제외 시 ~40종) |
| 트리거 | 12개 |
| 마이그레이션 SQL | 9,646줄(위키 제외 시 ~5,600줄) |

#### MySQL에서 성립하지 않는 SQL 관용구 (실측 건수)

| 관용구 | 건수 | MySQL 대응 |
|---|---|---|
| `returning` | 61 | **없음**(MariaDB는 INSERT/DELETE만). 재조회로 대체 |
| `on conflict ... do update` | 46 | `ON DUPLICATE KEY UPDATE` — 다만 `where` 조건부 upsert 2건은 재작성 |
| `uuid` 타입 / `gen_random_uuid()` | 483 / 35 | `CHAR(36) CHARACTER SET ascii`. 생성은 앱에서(`crypto.randomUUID()`) |
| `timestamptz` | 169 | `DATETIME(3)` + **전 구간 UTC 저장 규약**. MySQL `TIMESTAMP`의 세션 타임존 변환은 사고의 원인이라 쓰지 않는다 |
| `text[]` / `uuid[]` / `int[]` | 34 | 배열 타입 없음 → `JSON` 배열 또는 조인 테이블. `project_settings`(0058)의 5개 배열 컬럼이 대표 |
| `jsonb` 연산자(`-`, `||`, `@>`) | 223회 언급 | `JSON` + `JSON_REMOVE`/`JSON_MERGE_PATCH`/`JSON_CONTAINS`. **`to_jsonb(new) - 'col'` 차분 관용구는 대응물 없음** → 명시적 컬럼 비교로 재작성(0052 트리거) |
| 데이터 변경 CTE(`with x as (update ... returning)`) | 3 | **완전 불가.** 다단 문장으로 분해 |
| 부분 인덱스(`create unique index ... where`) | 1 (`minute_files_one_body_idx`) | 불가 → 생성 컬럼 + 유니크 인덱스 또는 앱 제약 |
| `pg_advisory_xact_lock` | 5 (위키 3 제외 시 2) | 트랜잭션 스코프 자문 락 없음. `GET_LOCK()`은 **세션 스코프**라 의미가 다름 → 카운터 행 `SELECT ... FOR UPDATE`로 대체. `issue_number_counters` 테이블이 이미 있어 자연스럽다 |
| `for update skip locked` | 2 | MySQL 8.0+ / MariaDB 10.6+ 지원 — **그대로 이식 가능** |
| `check` 제약 | 233 | MySQL 8.0.16+ 지원 — 이식 가능 |
| `security definer` 함수 | 31 | `DEFINER` 존재하나 §3.1 판정에 따라 대부분 폐기 |

#### DB 함수 처리 방침 — **대부분 애플리케이션 트랜잭션으로 흡수한다**

이 함수들이 DB에 있는 이유는 둘이다: (a) PostgREST 직접 호출에 원자성을 주기 위해, (b) `service_role`이 RLS를 우회해 여러 테이블을 한 번에 쓰기 위해. **앱 서버만 DB에 붙는 구조에서는 둘 다 앱 트랜잭션으로 동일하게 달성된다.** 게다가 테스트가 쉬워진다(현재 `tests/migrations/**`는 SQL 텍스트 검사에 가깝다).

예외로 **DB에 남길 것 3개:**

1. `guard_non_admin_column_scope` (0052) — 최후 방어선(§3.1 C-3)
2. 이슈 번호 채번 (`assign_issue_major_seq` 0062 / `assign_issue_analysis_code` 0055) — 번호 불변이 계약이므로 경합을 DB에서 막는 편이 안전. 자문 락 → 카운터 행 `FOR UPDATE`
3. `minute_versions_immutable_trg` (0045) — 회의록 버전 불변 트리거

`import_wbs` / `replace_wbs`는 **앱 트랜잭션으로 재구현을 권고**한다. 이미 임포트 마법사(0061)가 검증 로직을 TS로 갖고 있어 중복이 줄어든다.

#### 접근 계층 — 무엇을 쓸 것인가

권고: **Kysely**(타입 안전 SQL 빌더, 무료, 런타임 얇음). Prisma는 스키마 소유권을 가져가 기존 마이그레이션 관례(수동 SQL + `_rollback.sql`)와 충돌한다. Drizzle도 가능하나, 현 팀이 이미 SQL을 직접 쓰는 문화라 Kysely 쪽이 마찰이 적다.

**반대 대안(검토했으나 기각):** supabase-js 쿼리 빌더 표면을 MySQL 위에 흉내 내는 shim. 457곳을 안 고쳐도 된다는 유혹이 크지만, `.maybeSingle()`의 에러 코드 의미(`src/lib/repositories/supabase/common.ts:isRetryableReadError`가 `PGRST100/200/204`를 분기한다)까지 재현해야 하고, **§3.1 C-1(단일 접근 경계)을 영구히 포기하게 된다.** RLS를 버린 마당에 그것까지 포기하면 방어선이 0이 된다.

#### 이식 비용 (정직한 견적)

이 항목이 전체의 60~70%다. 457개 호출 지점 중 상당수가 단순 CRUD라 기계적이지만, **서버 액션 234곳은 가드·검증·트랜잭션 경계를 함께 재배치해야 해서 기계적이지 않다.** 위키 제외 후에도 사람-주 단위의 작업이며, 이 문서가 낼 수 있는 정확도로는 범위만 제시하고 정확한 기간은 §6에 "모르는 것"으로 남긴다.

---

## 4. 런타임 — Next.js 유지 vs Tomcat

### 4.1 실측 규모

- TypeScript/TSX 461파일 · **76,425줄**
- 테스트 238파일
- React 19 + Next.js 15 App Router: RSC, 서버 액션 28파일, API 라우트 26개
- 서버 전용 자산 파이프라인: PPTX 템플릿 번들링(`next.config.ts` `outputFileTracingIncludes`), 엑셀 생성(exceljs/xlsx), mermaid, remark

### 4.2 비교

| | Next.js/Node 유지 | Tomcat/Java 전환 |
|---|---|---|
| 재작성 범위 | DB 접근 계층 + 인증 + 스토리지 ≈ **코드의 15~20%** | **100%** — RSC·서버 액션에 Java 대응물이 없어 프론트엔드까지 전부 |
| 테스트 자산 | 238파일 대부분 생존(도메인 순수 계층은 무손실) | 전량 폐기 |
| 엑셀/PPT 생성 | exceljs·pptx 템플릿 그대로 | Apache POI로 재작성 — **주간보고 PPT 서식 규약**(빈 줄·연속 슬라이드·페이지네이션)을 픽셀 단위로 재현해야 함 |
| AI 계층 | `src/lib/ai/**` 그대로 | 전량 재작성 |
| "무상 스택" 충족 | ○ (Node·npm) | ○ (Tomcat) |

### 4.3 권고

**Next.js/Node 유지. Tomcat 기각.**

킥오프 §3-4는 "Tomcat 또는 Node 등 대중적인 무상 스택"이라 했고 Node는 이미 그 조건을 만족한다. Tomcat 전환은 제약을 만족시키는 행위가 아니라 **제품을 처음부터 다시 만드는 행위**다. Java 조직 표준 같은 외부 요구가 있다면 그것은 기술 결정이 아니라 정책 결정이므로 PM이 §5 D2에서 확정해야 한다.

---

## 5. 인증·권한을 새 스택에서 재현하기

### 5.1 3단 권한은 그대로 산다

슈퍼유저(전역) / 관리자(프로젝트) / 멤버(프로젝트), 역할 없으면 조회 전용 — 이 모델은 `project_roles` + `memberships.is_superuser` **두 테이블**로 표현돼 있고 판정은 이미 TS 순수 함수다. **DB 종류와 무관하다.** 옮길 것은 스키마 2개와 함수 파일 1개뿐이다.

주의: `memberships.role`은 0054에서 deprecated 됐다. 이식 스키마에 **다시 넣지 않는다.** 옛 문자열 계약이 필요한 화면은 `effectiveLegacyRole` shim만 쓴다(`src/lib/domain/authz.ts:37-56`).

### 5.2 RLS 2차 방어선 상실에 대한 대응

§3.1의 C-1/C-2/C-3이 그 답이다. 추가로 **DB 계정 최소권한**을 건다:

| DB 계정 | 권한 |
|---|---|
| `app` (앱 런타임) | 앱 스키마에 `SELECT/INSERT/UPDATE/DELETE`. **DDL 없음** |
| `migrator` (마이그레이션 전용) | DDL 포함. 배포 파이프라인만 사용 |
| `backup` | `SELECT`, `LOCK TABLES`, `RELOAD` |

이것으로 "앱 코드 결함 → 스키마 파괴"는 막힌다. "앱 코드 결함 → 데이터 유출"은 못 막는다 — 그건 C-1/C-2로만 막는다. **이 한계를 문서에 남기고 넘어가는 것이 정직하다.**

### 5.3 에이전트 API 인증은 영향 없음

`/api/v1/agent/work/**`는 JWT가 아니라 공유 시크릿(`AGENT_API_SECRET`)과 미등록 프로젝트 404 게이트를 쓴다. claim 경합도 DB 락이 아니라 **CAS(`update ... where status='ready'`)** 로 처리한다 — `src/app/api/v1/agent/work/[id]/claim/route.ts:24-35`. MySQL에서 그대로 성립한다. **에이전트 루프의 동시성 설계는 이식으로 손댈 것이 없다.** (설계자 A/B에게 전달할 사실)

---

## 6. 배포 · 운영

### 6.1 호스팅 — 자체 호스팅 단일 VM 권고

현재는 Vercel(`vercel.json`: `regions: ["icn1"]`) + Supabase다. 새 스택 권고:

```
1 x Linux VM
├── nginx            (TLS 종단, 정적, 업로드 본문 상한)
├── node (next start, standalone)  ← systemd
├── mysql/mariadb                  ← systemd
├── /var/lib/dflow/files           ← Storage 대체
└── systemd timers                 ← cron 대체
```

**왜 서버리스가 아닌가 — 넷 다 실제 제약이다:**

1. 업로드가 서버 경유로 바뀌면 20MB 본문이 통과해야 하는데 Vercel 서버리스 본문 상한은 4.5MB다(§3.3).
2. Realtime 대체(SSE + 인메모리 프레즌스)는 상태 있는 장수명 프로세스를 요구한다(§3.5).
3. 에이전트 실행 엔진(설계자 B 범위)은 장시간 프로세스를 돌린다 — 서버리스 실행 시간 제한과 정면 충돌.
4. Vercel Hobby(무료) 플랜은 상업적 사용을 허용하지 않는다. 회사 프로젝트에서 "무료"의 답이 아니다.

**대가:** 운영 부담이 우리에게 온다. 지금은 Vercel이 하던 일(TLS 갱신, 무중단 배포, 롤백)을 스크립트로 만들어야 한다. VM 비용은 "무상"이 아니다 — 사내 서버가 있으면 0, 없으면 월 비용 발생. §7 D3.

### 6.2 CI/CD

GitHub Actions(프라이빗 리포 무료 분 한도 내) → `npm ci && npm run lint && npm run test && npm run build` → 산출물을 VM에 `rsync` → `systemctl restart`. 무중단이 필요하면 포트 2개 + nginx upstream 교체.

**기존 pre-push 훅(G1/G2/G3)의 운명:**

- **G1**(마이그레이션+코드 혼합 커밋 차단) — **유지.** DB가 바뀌어도 이유는 그대로다.
- **G2**(Preview 미경유 UI 변경 차단) — **폐기하고 재설계.** 근거: CLAUDE.md가 이미 기록하듯 이 프로젝트의 Vercel Preview는 env가 Production 대상뿐이라 로그인 뒤 화면을 볼 수 없다. 자체 호스팅에서는 **staging 인스턴스를 진짜로 띄울 수 있으므로**, G2를 "staging 배포 확인"으로 바꾸면 오히려 지금보다 강해진다.
- **G3**(반응형 안전망 desync 검사) — 유지. CSS는 이식 대상이 아니다.

### 6.3 마이그레이션 관리

Supabase Management API 경유는 사라진다. 대체:

- 파일 규약 유지: `NNNN_name.sql` + `NNNN_name_rollback.sql`
- 러너: Node 스크립트 하나. `migration_ledger`(0050 아이디어)를 MySQL 테이블로 재작성해 적용 이력·체크섬·적용자를 남긴다
- **멱등 관례 유지.** 0053 헤더가 설명하는 "중간에 끊긴 적용을 다시 돌릴 때 42710에서 멈추는" 사고는 MySQL에서도 똑같이 난다(`DROP ... IF EXISTS` + 사전검증)

### 6.4 백업 — 지금보다 좋아지는 유일한 항목

| | 현재(Supabase Pro) | 자체 호스팅 |
|---|---|---|
| 일 백업 | ○ | `mysqldump` nightly + 원격 복사 |
| PITR | **꺼짐**(별도 유료 애드온) | **binlog로 무료 제공** |
| 파일 | Storage(별도) | DB 덤프와 같은 스냅샷에 포함 가능 |

**리스토어 리허설을 분기 1회 의무화할 것.** 검증하지 않은 백업은 백업이 아니다.

### 6.5 관측 · 로그

현재는 `console.error` → Vercel 로그다(에러 처리 3원칙의 "표시 = 로깅"이 여기 의존). 자체 호스팅에서는 journald + 파일 로테이션이 최소선. 여유가 있으면 Grafana + Loki(무료 자체 호스팅). **2026-08-05 장애(디스크 풀 → PostgREST 크래시 루프)의 교훈에 따라 디스크 사용률 알람을 1일차부터 건다.** 같은 사고가 자체 호스팅에서 더 쉽게 재발한다(로그·업로드·binlog가 전부 같은 디스크에 쌓인다).

---

## 7. 마이그레이션 경로 — 데이터를 옮기는가

### 권고: **빈 상태로 시작한다. DB→DB ETL을 만들지 않는다.**

근거 셋:

1. **사본은 신제품이다.** 킥오프 §1에 따르면 원본 D'Flow는 계속 운영된다. 사본이 D-CUBE 운영 데이터를 가질 이유가 없고, 갖는 순간 "운영 데이터 훼손 금지" 제약이 사본에도 전염된다.
2. **WBS는 제품 기능으로 넣을 수 있다.** 임포트 마법사(Plan B, 0061, 배포 완료)가 엑셀 양식을 자동 감지해 N단 구조를 넣는다. DB 덤프 변환기를 새로 만드는 것보다 **이미 E2E가 끝난 경로**가 안전하다.
3. **임베딩은 어차피 재생성이다.** 벡터는 원문에서 다시 만들면 되고(§2.2), MariaDB로 가면 저장 형식 자체가 다르다.

### 그래도 옮겨야 한다면 — 계층별 판정

| 계층 | 판정 |
|---|---|
| 마스터(teams·projects·memberships·project_roles·holidays·project_settings) | 옮긴다. 소량, 변환 단순 |
| WBS(wbs_items·item_owners·task_dependencies) | **엑셀 임포트 경로 사용** |
| 트랜잭션(issues·meetings·attendance·weekly·announcements·minutes) | 필요한 것만 선별. `uuid`→`CHAR(36)`, `timestamptz`→UTC `DATETIME(3)`, 배열 컬럼→JSON 변환기 필요 |
| 첨부 파일 | Storage에서 내려받아 파일시스템으로. 경로 규약 재작성 |
| 임베딩 3종 | **옮기지 않는다.** 재색인 |
| 위키 7테이블 | **제외** |
| 계정 | §아래 |

### 계정 이행의 미해결 지점

`auth.users`의 비밀번호 해시를 내보낼 수 있는지 **확인하지 못했다**(운영 무접촉 제약). 두 경우로 갈린다:

- 해시 이행 가능(bcrypt 계열이면 검증 로직 이식 가능) → 사용자 무감각 전환
- 불가 → **전원 비밀번호 재설정.** 이미 배포된 초대 v2(메일 발송·1회용·도메인 제한, 0065)의 발송 경로를 재사용하면 재설정 메일 인프라를 새로 만들지 않아도 된다

**권고:** 빈 상태 시작이면 이 문제 자체가 사라진다. 이것도 §5 D4 권고의 근거다.

---

## 8. 결정이 필요한 사항 (각 항목에 권고안 포함)

### D1. "MySQL 무료판"에 MariaDB Community를 포함하는가 — **가장 시급**

- **권고: 포함한다(MariaDB 11.8 LTS Community).**
- 근거: MySQL Community에는 벡터 거리 함수가 없다(HeatWave 전용). MariaDB 11.8은 네이티브 `VECTOR` + HNSW 인덱스 + `VEC_DISTANCE_COSINE`을 무료로 제공하고, SQL·와이어 프로토콜이 MySQL 호환이라 §3.6의 이식 설계가 그대로 유효하다. 이 결정 하나로 챗봇·회의록 검색·AI 브리핑·이슈분석의 검색 품질이 보존된다.
- 불가 판정 시 대안: 앱 메모리 브루트포스(§3.4 안 2). **단, 현행 청크 수 실측을 선행 조건으로 건다.**

### D2. 런타임 — Java/Tomcat 요구가 조직 정책인가

- **권고: Node/Next.js 유지.**
- 근거: Tomcat 전환은 76,425줄 전면 재작성이고 테스트 238파일이 전량 폐기된다. 킥오프가 Node를 이미 허용한다.
- 정책적 Java 요구가 실재한다면 그것은 **이 프로젝트를 새로 만드는 결정**이며, 일정·인력 견적을 처음부터 다시 잡아야 한다.

### D3. 호스팅 — 자체 VM인가, PaaS 무료 티어인가

- **권고: 자체 호스팅 단일 Linux VM.**
- 근거: 20MB 업로드 서버 경유, SSE 장수명 프로세스, 에이전트 실행 엔진의 장시간 작업, Vercel Hobby의 상업적 사용 금지 — 넷 다 서버리스를 배제한다.
- 확인 필요: **사내 서버가 있는가.** 없으면 "무상"이 깨지므로(월 VM 비용) 사용자가 알고 결정해야 한다.

### D4. 데이터 이행 범위

- **권고: 빈 DB로 시작. WBS는 엑셀 임포트 마법사로 투입.**
- 근거: §7. 사본은 신제품이고, ETL을 만들지 않는 것이 훼손 위험도 0으로 만든다.

### D5. RLS 폐기를 승인하는가

- **권고: 폐기 + 보상통제 C-1/C-2/C-3 동시 착수.**
- 근거: §3.1. 이식하려 해도 MySQL/MariaDB에 대응물이 없고, 뷰+세션변수 흉내는 커넥션 풀 오염 시 조용히 뚫려 지금보다 나쁘다.
- **조건:** C-1(단일 접근 경계 + ESLint 금지 규칙)이 없는 폐기는 승인하지 않기를 권고한다. 그것 없이는 방어선이 0이 된다.

### D6. 브라우저 직업로드를 포기하는가

- **권고: 포기하고 서버 경유 업로드로 전환**(로컬 파일시스템 + HMAC 서명 URL).
- 대안: R2/B2를 쓰면 presigned PUT으로 직업로드를 유지할 수 있으나 외부 의존이 생긴다. 파일 총량이 크면(수십 GB) 이쪽이 낫다 — **현행 스토리지 사용량을 모른다**(§9).

### D7. 원본과의 동기화 정책

- **권고: 단방향 수동 체리픽. 공유 대상은 `src/lib/domain`·`src/lib/excel`·`src/lib/report`·`src/lib/i18n`으로 한정.**

---

## 9. 리스크 (낙관 금지)

| # | 리스크 | 실패 지점 | 완화 |
|---|---|---|---|
| **R1** | **457개 DB 호출 지점 재작성 중 가드 누락** | RLS가 사라진 상태에서 서버 액션 하나가 `requireProjectAdmin`을 빠뜨리면 **즉시 타 프로젝트 데이터 유출**. 지금은 RLS가 받아준다 | C-1 단일 경계 + C-2 정적 테스트를 **이식 첫 주에** 세운다. 나중에 하면 안 한다 |
| **R2** | **자체 인증 구현 결함** | 세션 고정, 타이밍 공격, 쿠키 속성 누락, 비밀번호 재설정 토큰 재사용. GoTrue가 공짜로 주던 것들 | 검증된 라이브러리 조합(argon2 + 표준 세션 미들웨어) 사용, 인증 전용 테스트 스위트, 외부 보안 리뷰 1회 |
| **R3** | **의미검색 품질 붕괴** | D1이 MySQL 고정으로 결정되고 청크 수가 예상보다 많으면 브루트포스가 실용성을 잃는다. 챗봇은 죽지 않지만(`retrieve.ts:36-68`) "답을 못 찾는 봇"이 된다 | D1 확정 전 **청크 수 실측**. MariaDB 불가 시 안 3(별도 벡터 엔진)을 2순위로 준비 |
| **R4** | **이식이 "리팩터링 겸사겸사"로 번진다** | 457곳을 만지는 동안 "이왕 여는 김에" 구조를 고치기 시작하면 끝이 안 난다. 그러면 **원본과 사본이 동시에 미완성**이 된다 | 이식 커밋에 기능 변경 금지 규칙. 개선 항목은 별도 백로그로 적재 |
| **R5** | **운영 부담이 개발을 잡아먹는다** | Vercel+Supabase가 해주던 TLS·배포·백업·모니터링이 전부 우리 일이 된다. 그런데 이 팀의 주 목표는 **에이전트 코딩 기능**이지 인프라가 아니다 | 1일차부터 스크립트화. 디스크 알람은 필수(2026-08-05 장애 재발 경로) |
| **R6** | **단일 인스턴스 전제가 조용히 깨진다** | SSE 프레즌스·인메모리 pub/sub은 인스턴스 2개가 되는 순간 절반의 사용자에게만 이벤트가 간다. **에러가 아니라 침묵으로 깨진다** | 배포 스크립트가 인스턴스 수를 강제. 수평 확장 시 Redis 필요를 문서에 박제 |
| **R7** | **UTC 규약 이탈** | `timestamptz` 169곳이 `DATETIME`으로 바뀌면 타임존 정보가 사라진다. MySQL `TIMESTAMP`의 세션 타임존 자동 변환에 한 번이라도 발을 들이면 근태·회의·주간보고 날짜가 하루씩 어긋난다 | `DATETIME(3)` + 전 구간 UTC + 세션 `time_zone='+00:00'` 강제. 경계 테스트 필수 |
| **R8** | **에이전트 기능이 시작도 못 하고 이식에 갇힌다** | 이 프로젝트의 목적은 §3의 네 가지 신규 기능인데, 이식이 선행 작업으로 앞에 서 있다. 이식이 길어지면 목적 자체가 지연된다 | **선후를 뒤집는 안을 검토할 것**(§10) |

---

## 10. PM에게 제기하는 순서 문제 (설계자 A/B와 겹치는 지점)

킥오프는 "이식 + 복제" 위에 신규 기능 셋을 얹는 구조로 그려져 있다. 그런데 §3~§9의 견적을 놓고 보면 **이식이 신규 기능보다 크다.** 그리고 §5.3에서 확인했듯 **에이전트 루프의 핵심 설계(CAS claim·404 게이트·시크릿 인증)는 DB 종류와 무관하다.**

그렇다면 선택지가 둘이다:

- **경로 α (킥오프대로):** 이식 완료 → 그 위에 신규 기능. 목적 달성이 이식 완료 이후로 밀린다.
- **경로 β:** 현 Supabase 사본 위에서 신규 기능 셋(일정 트리거·품질 게이트·자율 선택)을 먼저 만들어 **가치를 증명한 뒤** 이식한다. 이식은 그때 "동작하는 명세"를 갖고 시작하므로 오히려 쉬워진다.

**설계자 C의 권고는 β다.** 단, 이것은 킥오프의 범위 정의를 바꾸는 제안이므로 **PM 판단 사항으로 올린다.** β를 택하면 이 문서는 폐기되지 않고 "언제든 실행 가능한 이식 계획"으로 남는다.

(경로 β의 전제인 "무료 LLM으로 코딩 에이전트가 성립하는가"는 설계자 B의 판정 대상이다. B가 불가 판정을 내리면 α든 β든 순서 문제 자체가 무의미해진다.)

---

## 11. 모르는 것 / 확인하지 못한 것

추측을 사실로 쓰지 않기 위해 명시한다.

1. **벡터 청크의 실제 행 수.** `wbs_embeddings`·`minute_embeddings`·`ai_documents` 각각 몇 행인지 모른다. 운영 DB 무접촉 제약 때문에 조회하지 않았다. §3.4 안 2(브루트포스)의 성립 여부가 여기 달려 있다. **D1 확정 전 실측 필요.**
2. **Storage 실제 사용량.** `deliverables`·`minutes` 버킷의 객체 수·총 바이트를 모른다. D6(파일시스템 vs 오브젝트 스토리지)의 근거가 된다.
3. **`auth.users` 비밀번호 해시의 내보내기 가능 여부와 해시 알고리즘.** 확인하지 않았다. §7 계정 이행이 여기 달려 있다.
4. **프로덕션 DB의 실제 정책·함수 정의.** 이 문서의 모든 SQL 근거는 **리포의 마이그레이션 파일**이다. 과거 드리프트 이력(`app_role()` vs `current_role()` 등)이 있었으므로 프로덕션 실물과 100% 일치한다고 단정할 수 없다. 다만 §3의 판정(RLS 폐기·pgvector 불가)은 드리프트에 영향받지 않는 성격이다.
5. **이식 기간.** 사람-주 단위라는 것 외에 정확한 견적을 내지 않았다. 457개 호출 지점 중 기계적 변환 가능 비율을 표본 조사하지 않았기 때문이다. 숫자를 지어내지 않는다.
6. **MariaDB 11.8의 768차원 HNSW 실측 성능.** 문서상 지원(최대 16,383차원)은 확인했으나 이 데이터 규모에서의 재현율·지연을 직접 측정하지 않았다. 채택 시 PoC 1일 권고.
7. **`0045`/`0046`의 위키 외 부수 기능 포함 여부.** 두 파일은 3,442줄이고 위키가 주제지만, 회의록 버전(`minute_versions`)·불변 트리거 등 **위키가 아닌 것도 섞여 있다.** "위키 제외"를 파일 단위로 하면 회의록 기능이 함께 사라진다. 이식 착수 시 **문장 단위 분류가 필요하다.** 이 문서에서는 그 분류를 완료하지 못했다.
8. **사내 서버 가용성.** D3의 "무상" 성립 여부를 결정하지만 알 수 없다.

---

## 출처 (§3.4 MySQL/MariaDB 벡터 지원 근거)

- [MySQL 9.7 Reference Manual — Vector Functions](https://dev.mysql.com/doc/refman/9.7/en/vector-functions.html)
- [MySQL HeatWave User Guide — Vector Functions (`DISTANCE()`)](https://dev.mysql.com/doc/heatwave/en/mys-hw-vector-functions.html)
- [Paths of MySQL, vector search edition — The Consensus](https://theconsensus.dev/p/2026/02/08/paths-of-mysql-vector-search-edition.html)
- [Announcing MariaDB Community Server 11.7 GA with Vector Search](https://mariadb.com/resources/blog/announcing-mariadb-community-server-11-7-ga-with-vector-search-and-mariadb-community-server-11-8-rc/)
- [MariaDB Documentation — VEC_DISTANCE_COSINE](https://mariadb.com/docs/server/reference/sql-functions/vector-functions/vec_distance_cosine)
- [MariaDB Vector — 프로젝트 개요](https://mariadb.org/projects/mariadb-vector/)
