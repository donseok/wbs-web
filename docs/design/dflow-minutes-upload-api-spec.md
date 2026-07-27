# D'Flow 회의록 업로드 API 스펙 (또박또박 연동용)

- 버전: **v2.3 (2026-07-27)** — **`folder_path` 편철 · 일괄 재편철 배치 · 연결 초기화를 반영한 개정** (하단 'v2.3 변경' 참조). v2.2 (2026-07-19): D'Flow 측 구현(F1~F6) 완료 반영. v2.1: wbs-web 레포 코드 직접 조사 후 전면 개정 + 전 미결사항 확정
- 작성 목적: 또박또박(로컬 회의 녹음·전사·회의록 앱)이 생성한 회의록 마크다운을 D'Flow(https://wbs-web.vercel.app) 회의록 화면에 **자동 등록**할 수 있도록, 양측이 **동시에 개발해 한 번에 통합**할 수 있는 완결 사양을 정의한다.
- 대상 독자: D'Flow 개발팀(팀장) + 또박또박 개발측
- 근거: wbs-web 레포(https://github.com/donseok/wbs-web) 전체 조사 기반. "확인"은 코드 인용이 있는 사실, "제안"은 신규 설계 요청.
- **문서 관계**: 본 문서가 **API 계약의 단일 출처(single source of truth)**다. 또박또박 측 상세 구현은 별도 문서(`ddobak-dflow-sender-spec.md`)가 다루되, 계약(필드·에러·의미)은 반드시 본 문서 §3~§7을 따른다. 계약 변경은 본 문서 개정 → 양측 반영 순서로만 한다.
- **사본 관계 (v2.3 명문화)**: **정본은 wbs-web 레포 사본(`docs/design/dflow-minutes-upload-api-spec.md`)이다.** 또박또박 측 사본(`tasks/dflow-minutes-upload/artifacts/`, **v2.1에서 정지**)은 이 파일을 **뒤따라 동기화**한다 — 반대 방향(또박또박 사본 → 정본) 반영은 금지. 두 사본이 갈라진 채로 착수하면 또박또박 구현자가 자기 레포의 "API 계약 단일 출처"에서 **이번 개정과 모순된 지시**(접두 제목·`folder_path` 부재·"해제 API 없음")를 읽는다.
- **v2.3 개정 근거**: `docs/design/dflow-folder-path-worklist-2026-07-27.md`(D'Flow 작업지시 — 결정 D1~D6·E1~E4 확정본). 본 문서는 그중 **계약(필드·의미·에러)** 만 옮긴다. 구현 순서·배포 차수의 정본은 그 문서 §11.2이고, 본 문서는 §14.1에서 1줄로만 참조한다.

---

## 개발 기능 요약 (한눈에)

**만드는 것**: 또박또박에서 완성한 회의록을 버튼 한 번으로 D'Flow `/minutes` 화면에 등록·갱신하는 연동. 같은 회의는 몇 번을 보내도 D'Flow에 1건만 유지(멱등), 또박또박에서 수정 후 재전송하면 D'Flow 기존 레코드가 갱신된다.

**D'Flow 측 개발** (§9 — 기존 파일 수정 0, 전부 신규):

| # | 기능 | 내용 |
|---|---|---|
| F1 | 업로드 API | `POST /api/v1/minutes` — JSON으로 회의록 수신, `external_id` 기준 upsert (생성/갱신/스킵) |
| F2 | 조회 API | `GET /api/v1/minutes` (external_id·기간·구분 필터), `GET /api/v1/minutes/meta` (구분·프로젝트·제한값) |
| F3 | 연결 API | `POST /api/v1/minutes/link` — D'Flow에 수동 업로드했던 기존 회의록에 `external_id`를 부여해 또박또박과 연결 |
| F4 | 인증 | env 시크릿(Bearer) + `user_email`→D'Flow 계정 매칭 (없으면 403 거부) |
| F5 | 스키마 | `minutes.external_id` 컬럼 + 부분 unique 인덱스 (마이그레이션 1개) |
| F6 | **MDM 팀 추가** | 구분(team)에 `MDM` 신설 — DB CHECK 2곳 + TS 타입/상수 + UI 색 토큰 (§9.8, 별도 선행 작업) |

**또박또박 측 개발** (`ddobak-dflow-sender-spec.md` — 별도 문서):

| # | 기능 | 내용 |
|---|---|---|
| T1 | 전송 식별자 | `meetings.public_uid` (UUIDv7, 최초 전송 시 발급·불변) — D'Flow `external_id`의 원천 |
| T2 | 전송 기능 | 회의 상세 "D'Flow로 보내기" — 서버(Rails)가 export md를 D'Flow API로 POST |
| T3 | 설정·자동 매핑 | D'Flow URL·시크릿(관리자). team은 **최상위 폴더명으로 자동 판정**(MES/PMO/ERP/가공/MDM), 폴더 계층은 **`folder_path`로 그대로 전송**(§4.2) — 수동 매핑 설정 없음.<br>⚠️ **v2.3: 제목 `<하위폴더명>-` 접두 조립은 폐지**(§0 D10) — `folder_path`를 보내면 원제목 그대로다. 접두는 실폴더가 없던 시절의 우회책이었다 |
| T4 | 연결 관리 | public_uid 보기/수동 입력/해제/재발급 + D'Flow 기존 레코드 검색·연결 (F3 사용) |
| T5 | 상태 표시 | 회의 상세에 전송됨/재전송 필요 배지, "D'Flow에서 보기" 링크 |
| T6 | export 호환 | 회의/폴더/프로젝트 export·import에 public_uid·매핑 포함 (다른 또박또박 인스턴스로 이동해도 D'Flow 연결 유지) |

**적용**: 양측 동시 개발 → §14 순서로 한 번에 통합 (D'Flow는 env 미설정이면 API 전체 404라 먼저 배포해도 무해).

### v2.3 변경 (`folder_path` 편철 · 배치 재편철 · 연결 초기화 — 양측 필독)

0040/0043으로 D'Flow에 **실폴더 트리**가 생겼다. v2.2까지의 계약은 그 이전 모델이라 또박또박의 폴더 계층이 **전송 순간 전부 소실**되고 2단째 폴더명만 제목 접두로 남았다. v2.3은 그 우회책을 걷어내고 폴더를 **필드로** 주고받는다.

| # | 변경 | 내용 |
|---|---|---|
| C1 | **§0 D10 개정 — 제목 접두 폐지** | `folder_path`를 **함께 보낼 때는** `<하위폴더명>-` 접두를 붙이지 않는다(원제목 그대로). 접두는 "실폴더가 없으니 제목으로 흉내낸다"는 전제(§1.2)의 우회책이었고 그 전제가 소멸했다. **기존 전송분 제목은 소급 수정하지 않는다** |
| C2 | **§4.2 `folder_path` 신설** | `string[]`·선택·root-first. **키 부재 / `[]` / 비어있지 않은 배열의 3값 규약** — 재전송 시 폴더 위치의 SSOT는 또박또박이다. 미전송 시 동작은 v2.2와 100% 동일(하위호환) |
| C3 | **§4.3 응답 `folder_id`·`folder_path` 에코** | **둘 다 nullable.** 절단·한 칸 내림이 반영된 **실제 편철 결과**. 폴더 목록 API가 없으므로(§0 D15) 이 에코가 **유일한 사후 피드백 경로**다 |
| C4 | **§4.7 신설 — 정규화·편철 규칙** | ① `path[0] === team`이면 그대로 ② 팀코드가 아닌 자유 루트는 `[team, ...path]`로 **한 칸 내림** ③ 다른 팀의 팀코드면 **400**. + 깊이 5 절단 · 폴더 자동 생성 가드 · **미분류 폴백 시 `folder_id`·`folder_path` 둘 다 `null`** |
| C5 | **§4c 신설 — `POST /minutes/folder`** | 기존 전송분 **일괄 재편철** 배치. `dry_run` 기본 `true`, `items` 최대 200건, 건별 `status` 값 집합을 **계약으로 고정**. 신규 엔드포인트는 이 1개뿐 |
| C6 | **§4b 개정 — "해제 API 없음" 철회** | D'Flow 회의 정보 수정 모달에 **연결 초기화**(`external_id` → `null`)가 생겨 DB 수작업이 필요 없다. 단 **초기화는 API가 아니라 D'Flow UI 조작**이고, **재연결은 여전히 `POST /minutes/link`(claim)** 다 — §4b-1에서 셋을 분리 |
| C7 | **§5.1 `include_archived` + `archived`** | 보관(archive)과 연결 초기화가 **`exists_on_dflow: false`로 뭉개지던 오진**을 없앤다. 기본 `false` = 종전 동작(하위호환), `true`면 보관분 포함. 응답 `items[]`에 `archived: boolean` |
| C8 | **배포 순서 1줄 (§14.1)** | `folder_path` 차수에서는 **일괄 재편철(§4c)이 또박또박의 전송 전환보다 앞선다.** 순서표의 정본은 본 문서가 아니라 D'Flow 작업지시 §11.2 |

> 또박또박 측 사본(v2.1)은 이 개정을 뒤따라 동기화한다(정본 = 본 파일 — 상단 「사본 관계」).

### v2.2 변경 (D'Flow 구현 확정 반영 — 또박또박 측도 참조)

| # | 변경 | 내용 |
|---|---|---|
| C1 | §0 D3 세분화 | replace 갱신 범위의 `meeting_id`는 **필드가 전송된 경우에만** 갱신 — 부재=기존 값 유지, 명시적 null=해제. 또박또박 v1은 미전송이므로 동작 차이 없음. 수동 연결분(E4) 재전송 시 프로젝트 연결이 소리 없이 끊기는 것을 방지 |
| C2 | uuid 형식 검증 | `meeting_id`·`minute_id`·`project_id`(전부 D'Flow 자신의 uuid PK 참조)는 uuid 형식 검증 — 비형식은 400 `validation_failed` (§6 '형식 오류'의 명시 적용). `external_id`는 계속 불투명·무검증(§4.6) |
| C3 | 범위 초과 페이지 | GET /minutes 에서 offset이 total을 넘는 page 요청은 500이 아니라 빈 `items` + 정확한 `total`의 정상 응답 |
| C4 | §9.2 구현 방식 | `rematchMinuteHighlights`는 export 승격이 아니라 **lib 복제**로 확정 — 'use server' 파일의 export는 인증 검사 없는 공개 Server Action 엔드포인트가 되기 때문. 결과적으로 API 작업의 기존 파일 수정 0줄 |
| C5 | 0034 보강 | `external_id` 보호 트리거 추가 — authenticated/anon 세션의 PostgREST 직접 세팅·변조를 차단해 멱등키 불변식을 DB 계층에서 강제(선점 하이재킹·키 해제 방지). service_role(연동 API)·직접 SQL(수동 운영)은 허용 |
| C6 | 존재 은닉 보강 | 미정의 메서드(PUT/DELETE/PATCH/OPTIONS)도 404 — 405 + Allow 응답으로 비활성 라우트의 존재가 드러나지 않게 |

---

## 0. 확정 사항 (미결 없음 — 그대로 구현)

| # | 항목 | 확정 내용 |
|---|---|---|
| D1 | 원본 .md 파일(`minute_files role='body'`) | **v1 생략.** 뷰어는 `body_md`만으로 완전 동작(확인). API가 만든 회의록은 external_id로만 갱신되고 UI 업로드 건과 섞이지 않으므로 "body 파일 1개" 관례와 충돌 없음. 원본 다운로드 필요 시 v1.1에서 서버 합성 추가 |
| D2 | 본문 한도 | **100,000자 고정** (`MINUTE_BODY_MAX` 그대로). 초과분 처리는 또박또박 책임 — 전송 전 검사해 초과 시 전송하지 않고 사용자에게 안내(자동 절단 금지) |
| D3 | `on_conflict=replace` 갱신 범위 | `minute_date, team_code, title, body_md, updated_at` 갱신 + `meeting_id`는 **필드가 전송된 경우에만** 갱신(부재=유지, 명시적 null=해제 — v2.2 C1) + **`folder_id`는 `folder_path` 3값 규약대로** 갱신(키 부재=**기존 위치 유지**, `[]`=팀 루트로 되돌림, 경로=그 경로로 이동 — §4.2, v2.3 C2). **`created_by`/`created_by_name`은 최초 생성 시 값 유지** (재전송자가 달라도 소유권 불변) |
| D4 | 시간 보정 | API 경로는 `correctMinuteBodyTime` **미적용** (§1.4) |
| D5 | 인증 | env 시크릿(`MINUTES_API_ENABLED`+`MINUTES_API_SECRET`) + `user_email` 매칭. 사용자별 PAT는 v2 |
| D6 | 시크릿 전달 | D'Flow 관리자(팀장)가 생성(`openssl rand -base64 48`)해 Vercel env에 설정하고, 또박또박 관리자에게 보안 채널(대면/암호화 메신저)로 전달. 코드·문서·커밋에 평문 금지 |
| D7 | rate limit / multipart 첨부 / GET /minutes/{id} | v1 제외 (§13 단계표) |
| D8 | 적용 순서 | D'Flow 먼저 배포(env 미설정 상태 = 전 라우트 404라 무해) → env 설정 → 스모크 → 또박또박 설정 입력 → E2E (§14) |
| D9 | team 코드셋 | **5종: `PMO`·`ERP`·`MES`·`가공`·`MDM`** — MDM은 현재 D'Flow에 없어 F6(§9.8) 선행 추가 필요. 또박또박은 하드코딩하지 않고 `GET /minutes/meta`의 `teams`를 사용 |
| D10 | team·제목 자동 규칙 (또박또박) | **⚠️ v2.3 개정 — 제목 접두 폐지 (v2.3 C1).**<br>**team** = 회의 폴더 체인의 **최상위 폴더명** (meta.teams에 있으면 자동, 없으면 다이얼로그 수동 선택) — **변경 없음**.<br>**제목** = `folder_path`를 **함께 보낼 때는 `<하위폴더명>-` 접두를 붙이지 않는다** — 원제목 그대로 전송한다(다이얼로그에서 수정 가능). 종전 규칙 `<최상위 바로 아래 폴더명>-<원제목>`은 "D'Flow에 실폴더가 없으니 제목으로 폴더를 흉내낸다"는 전제(§1.2)로 만든 우회책이고, 0040/0043 실폴더 + `folder_path`(§4.2·§4.7) 도입으로 **그 전제가 소멸**했다. 접두를 유지하면 실폴더 `품질` 안의 회의록 제목이 `품질-주간회의`인 **이중 라벨**이 된다.<br>**기존 전송분 제목은 소급 수정하지 않는다** — 재작성은 `minute_versions` 히스토리를 오염시키고, `title`은 위키 재인덱싱 대상이라 전건 재빌드를 유발한다. **접두 있는 제목과 없는 제목이 당분간 공존하는 것은 의도된 상태**다(제목 접두 정리는 §4c.6대로 별건).<br>`folder_path`를 **보내지 않는** 구버전 클라이언트는 종전 접두 규칙을 그대로 써도 된다 — D'Flow는 title 형식을 강제하지 않고 200자 검증만 한다.<br>프로젝트명은 양 시스템 동일 전제 — v1 전송엔 미사용, v1.1 meeting 자동 연결 시 이름 매칭에 사용 |
| D11 | `folder_path` 3값 규약 | **키 부재 / `[]` / 비어있지 않은 배열**을 구분한다. 재전송 시 **폴더 위치의 SSOT는 또박또박**이다 — 재전송마다 D'Flow 위치를 갱신한다. 단 키 부재는 "미제공"이므로 **기존 위치를 유지**한다. 상세 = §4.2 |
| D12 | 폴더명 60자 초과 | **400 거절**(`validation_failed`). **절단하지 않는다** — 절단하면 긴 이름끼리 같은 60자로 뭉개져 **서로 다른 폴더가 한 폴더로 합쳐지는 조용한 사고**가 난다. 사용자가 또박또박에서 이름을 줄이면 된다 (또박또박은 100자까지 허용하므로 **전송 전 사전 차단 필요**) |
| D13 | 팀코드가 아닌 자유 루트 | `[team, ...path]`로 **팀 루트 아래 한 칸 내려** 편철한다(§4.7 ②). 또박또박 폴더 구조를 자유롭게 두면서 D'Flow의 `team_code` 축을 지키는 유일한 방법. **외부 API는 루트 폴더를 만들지 않는다** — 루트 생성을 허용하면 곧 팀 축이 무한 증식해 D'Flow 대시보드·칸반·진척 전 화면에 새 축이 튀어나온다 |
| D14 | 미분류 폴백 시 응답 값 | `folder_id: null` **＋ `folder_path: null`**. `[]`(= 팀 루트 편철 **성공**)와 **반드시 구분**한다 — `[]`로 돌려주면 클라이언트가 "팀 루트에 편철됨"이라는 **정반대 안내**를 한다. 클라이언트 타입은 `string[] \| null`이어야 한다 (§4.3) |
| D15 | 폴더 목록 노출 | **하지 않는다.** `GET /minutes/meta`에 폴더 목록을 싣지 않고, 폴더 조회 엔드포인트도 신설하지 않는다. 하위 폴더는 blind 자동 생성이라 **항상 성공**하므로 사전 미리보기가 없어도 전송이 실패하지 않는다. ⚠️ **대가**: 사전 미리보기를 포기했으므로 **응답 에코(§4.3)가 유일한 사후 피드백**이다 → 클라이언트의 `folder_path` 표시는 권장이 아니라 **필수** |
| D16 | 기존 전송분 재편철 | **재전송(`replace`)으로 하지 않는다.** 전용 배치 엔드포인트 **`POST /minutes/folder`**(§4c)를 쓴다 — `dry_run` 기본 `true`, 200건/요청, 멱등, `updated_at`·버전·위키 무영향 |
| D17 | 연결 초기화 | `minutes.external_id`를 `null`로 되돌리는 수단은 **D'Flow UI 조작**(회의 정보 수정 모달)이다. **해제용 API 엔드포인트는 v2.3에도 없다.** 재연결은 종전대로 `POST /minutes/link`(claim) — §4b-1 |
| D18 | `folder_path` 차수의 배포 순서 | **일괄 재편철(§4c)이 또박또박의 전송 전환보다 앞선다.** 근거·차수표 정본 = D'Flow 작업지시 §11.2 (본 문서는 §14.1에서 참조만) |

---

## 1. D'Flow 실제 구조 (코드 확인 사실)

### 1.1 회의록 저장 모델

`minutes` 테이블 (`supabase/migrations/0021_minutes.sql:12-22`, `0026_minute_share.sql`):

| 컬럼 | 타입 | 비고 |
|---|---|---|
| `id` | uuid PK | `gen_random_uuid()` |
| `minute_date` | date not null | 목록 월별 그룹 기준 |
| `team_code` | text not null | CHECK `in ('PMO','ERP','MES','가공')` — **F6(§9.8)에서 MDM 추가 예정** |
| `title` | text not null | ≤ 200자 (앱 검증) |
| `body_md` | text not null | 마크다운 **원문 그대로** 저장 (파싱·블록 분해는 조회 시 파생 계산) |
| `meeting_id` | uuid null | FK → `meetings(id)` on delete set null. **프로젝트 연결은 이 경로뿐** |
| `created_by` | uuid null | FK → `auth.users(id)` |
| `created_by_name` | text null | 표시용 스냅샷 |
| `share_token` / `share_enabled` | | 공유 링크 (`/share/minutes/{token}`) |

- **`external_id` 같은 멱등키 컬럼 없음** (전 레포 grep 0건) — 신규 마이그레이션 필요.
- **`project_id` 컬럼 없음.** 회의록은 전역 아카이브이며 프로젝트 연결은 `meeting_id → meetings.project_id` 간접 조인뿐 (`src/lib/domain/types.ts:178-191`).
- 원본 파일: `minute_files` 테이블 + Storage `minutes` 버킷(비공개, 20MB). `role='body'`는 회의록당 **정확히 1개**(부분 unique index `minute_files_one_body_idx`), `role='attachment'`는 최대 10개.
- 앱 검증 상수 (`src/lib/domain/minutes.ts:3-7`): 본문 **100,000자**, 본문 .md 파일 1MB, 첨부 개당 20MB, 첨부 10개.
- 저장 후처리 (`src/app/actions/minutes.ts:95-98`): `ingestMinute`(임베딩) + `generateMinuteInsights`(AI 분류) 비동기 실행. 본문 교체 시 하이라이트 재매칭 포함 3단 (`minutes.ts:178-182`).

### 1.2 트리 뷰 = "폴더 구조"의 실체

`/minutes` 트리 뷰는 **구분(team_code) → 회의체 → 회의록** 2단 폴더다. 회의체 폴더는 별도 엔티티가 아니라 **제목에서 파생**된다 (`src/lib/domain/minutes.ts:57-83`, 스펙 `docs/superpowers/specs/2026-07-17-minutes-tree-view-design.md`):

- 제목을 `_`·공백으로 토큰화 → 노이즈 토큰(날짜형 `260716`·`2026-07-16`·`7.16` 등 5패턴, 회차형 `제3차`·`12차`, 요일 괄호 `(수)`) 제거 → 남은 토큰을 공백 결합한 것이 회의체 이름.
- 예: `물류공정_260716(수)` → 폴더 "물류공정". `주간정례 제12차 2026-07-16` → 폴더 "주간정례".

→ ~~**또박또박이 "폴더 구조에 맞게" 넣으려면 별도 필드가 아니라 ① `team` 값 ② 제목만 지키면 된다.** 제목 = `<하위폴더명>-<원제목>`~~ ← **v2.3에서 철회.** 이제 **별도 필드가 바로 정답**이다: `folder_path`(§4.2·§4.7)로 폴더 계층을 그대로 보내면 D'Flow가 팀 루트 아래에 같은 트리를 만들어 편철한다. 제목으로 폴더를 흉내낼 이유가 없어졌으므로 접두도 붙이지 않는다(§0 D10).

> ### ⚠️ v2.3 정정 — 이 절은 **0040 이전 모델**이다
>
> `0040_minute_folders.sql`·`0043`으로 D'Flow에 **실폴더 트리**(`minute_folders` — 팀코드 5축 **시드 루트** + 그 아래 최대 5단)가 생겼고, `/minutes` 탐색기는 제목 파생이 아니라 **그 실폴더를 그린다.** 제목 파생(`meetingBodyOf`)은 탐색기에서 **퇴역**했고 zip export 그룹핑에만 잔존한다.
>
> → **v2.3부터 또박또박은 제목으로 폴더를 흉내내지 않고 `folder_path` 필드(§4.2·§4.7)로 실제 경로를 보낸다.** 위 "① team ② 제목만 지키면 된다"와 제목 접두 규칙은 **`folder_path`를 보내지 않는 구버전 경로에만** 유효하다. 두 문단은 삭제하지 않고 그 경로의 사양으로 남겨 둔다.

### 1.3 외부 API·인증 현황

- 회의록 생성 경로는 Server Action `createMinute()`뿐 — **외부 호출 가능한 업로드 API 없음** (확인).
- 인증은 전부 Supabase 쿠키 세션. PAT/Bearer/API-key 관례 0건.
- 유일한 비세션 인증 선례: `api/chat/index/worker/route.ts` — env 시크릿 헤더(`x-cron-secret`)를 sha256+`timingSafeEqual`로 대조, env 미설정 시 404로 존재 은닉. **본 스펙의 인증은 이 선례를 확장한다** (§3).
- `middleware.ts`는 `/api/**`를 인증 리다이렉트에서 제외 — Route Handler가 자체 인증하는 구조 (확인).
- RLS: `insert_own_minutes`가 `created_by = auth.uid()` 강제 → API 경로는 `createAdminClient()`(service_role)로 우회하고 앱 코드가 인가를 대체해야 함 (기존 공유 페이지·worker route와 동일 패턴).

### 1.4 ⚠️ 시간 보정 함정 (반드시 반영)

`createMinute`/`replaceMinuteBody`는 본문에 `**날짜**:`·`**시간**:`·`**상태**:`·`**생성자**:` 4마커가 모두 있으면 `**시간**: HH:MM ~ HH:MM` 줄을 **+9h 자동 보정**한다 (`src/lib/minutes/timeFix.ts:41-54`). 이 4마커는 정확히 또박또박 export 헤더 포맷이다. 또박또박은 이미 올바른 KST를 보내므로, **API 경로가 기존 로직을 그대로 재사용하면 이중 보정으로 시간이 9시간 밀린다.** → API 경로는 `correctMinuteBodyTime` **미적용**이 기본이어야 한다 (§4.5).

### 1.5 또박또박 측에서 보낼 수 있는 것

또박또박은 회의별로 아래 데이터를 이미 보유·내보내기 가능하다 (`GET /api/v1/meetings/:id/export`, text/markdown 또는 JSON):

- 회의 제목, 날짜/시작·종료 시각, 생성자(이메일 계정), 참석자, 태그, 폴더, 프로젝트
- AI 회의록 전문(markdown), Action Items, 메모, 발화 원문(화자·타임스탬프)
- 마크다운 구조: `# 제목` → 메타데이터 목록 → `## AI 회의록` → `### Action Items` → `## 메모` → `## 원본 텍스트`

---

## 2. 설계 개요

- 스타일: REST, JSON 기본. Next.js **Route Handler**(`src/app/api/v1/**/route.ts`).
- Base URL: `https://wbs-web.vercel.app/api/v1`
- 인증: 서버 시크릿 + **사용자 이메일 매칭** (§3)
- 날짜 `YYYY-MM-DD`(Asia/Seoul), UTF-8.

| 메서드 | 경로 | 용도 | 우선순위 |
|---|---|---|---|
| POST | `/minutes` | 회의록 생성/갱신(upsert by `external_id`) | **v1 필수** |
| GET | `/minutes?external_id=` | 존재/동기화 확인, 연결 후보 검색 | **v1 필수** |
| GET | `/minutes/meta` | 구분·프로젝트·회의 목록 + 제한값 | **v1 필수** |
| POST | `/minutes/link` | 기존 D'Flow 회의록에 `external_id` 부여 (수동 연결) | **v1 필수** |
| POST | `/minutes/folder` | 이미 등록된 회의록의 **일괄 재편철**(배치·dry-run 기본) | **v1.2 필수** (★ v2.3 신설 — §4c) |
| GET | `/minutes/{id}` | 단건 조회 | v1.1 |
| POST | (multipart 첨부) | md 외 첨부 파일 | v1.1 |

---

## 3. 인증 — 2계층: 서버 시크릿 + 사용자 매칭

### 3.1 요구사항 (또박또박 측 정책)

**또박또박에서 보내는 사용자가 D'Flow에도 동일 계정(이메일)으로 존재해야 업로드가 허용**되고, 없으면 실패해야 한다. 업로드된 회의록의 작성자는 그 D'Flow 사용자로 기록된다.

### 3.2 계층 ① — 서버 간 시크릿 (요청 자체의 신뢰)

```
Authorization: Bearer <MINUTES_API_SECRET>
```

- env 2단 게이트 (기존 worker route 관례 그대로): `MINUTES_API_ENABLED=true` + `MINUTES_API_SECRET=<long-random>`. 미설정 시 라우트는 **404** (존재 은닉).
- 검증은 sha256 해시 후 `timingSafeEqual` 상수시간 비교 (`api/chat/index/worker/route.ts:30-36` 유틸 재사용).
- 이 시크릿은 또박또박 **서버(Rails 백엔드)**에만 저장 — 브라우저·개별 사용자에게 노출되지 않는다.
- 사용자별 PAT 테이블·발급 UI는 **v2로 연기** (레포에 선례가 없어 v1 부담이 크고, 현재 클라이언트는 또박또박 하나뿐).

### 3.3 계층 ② — 사용자 이메일 매칭 (작성자 귀속)

POST 요청 필드 `user_email`에 **또박또박에서 업로드를 실행한 사용자의 이메일**을 넣는다. D'Flow는:

1. `lower(trim(email))` 정규화 후 `auth.users`에서 조회 (`deleted_at is null` 계정만) — `0019_project_member_user_link.sql:51-61`의 기존 이메일 매칭 관례와 동일 규칙.
2. **일치하는 사용자가 없으면 `403` 실패** (레코드 미생성): `{ "error": "해당 이메일의 D'Flow 사용자가 없습니다.", "code": "unknown_user" }`
3. 일치하면 `created_by = 그 사용자의 uuid`, `created_by_name = 표시 이름` (기존 `displayNameFrom` 관례)으로 저장.

효과 (확인된 코드 기준): `created_by`가 실제 사용자이므로 그 사용자는 D'Flow 화면에서 자기가 올린 회의록을 **직접 수정·삭제**할 수 있다 (`canManage` 판정이 소유자 기준 — `(app)/minutes/[id]/page.tsx:24`). `created_by=null`로 넣는 대안은 pmo_admin 외에는 아무도 관리 못 하게 되므로 채택하지 않는다.

구현 힌트: 이메일→uuid 조회는 `admin.auth.admin.listUsers()`(`src/app/actions/accounts.ts:185`에서 이미 사용) 순회 또는 `security definer` SQL 함수 중 택일.

### 3.4 실패 응답

| 상황 | 응답 |
|---|---|
| env 미설정 | `404` |
| 시크릿 불일치/누락 | `401` `{ "error": "인증이 필요합니다." }` |
| `user_email` 누락 | `400` |
| 해당 이메일 사용자 없음/삭제됨 | `403` `{ "error": "...", "code": "unknown_user" }` |

---

## 4. POST /minutes — 회의록 생성/갱신

### 4.1 Content-Type

- v1: **`application/json`** (본문 마크다운 문자열 전송)
- v1.1: `multipart/form-data` (첨부 동반 시. 동일 필드 + `attachments[]`)

### 4.2 요청 필드

| 필드 | 타입 | 필수 | 설명 |
|---|---|---|---|
| `user_email` | string | ✅ | 업로드 실행 사용자 이메일 (§3.3). 미일치 시 403 |
| `date` | string `YYYY-MM-DD` | ✅ | → `minute_date` |
| `team` | string | ✅ | → `team_code`. 허용값 `PMO`·`ERP`·`MES`·`가공`·`MDM` (MDM은 F6/§9.8 선행 추가 후. 클라이언트는 하드코딩 대신 `GET /minutes/meta`의 `teams` 사용). ※ v1 스펙의 `category`에서 개명 — D'Flow `meetings.category`(general/routine/…)와 동명이의 충돌 방지 |
| `title` | string ≤ 200자 | ✅ | 회의록 제목. **v2.3: `folder_path`를 함께 보내면 `<하위폴더명>-` 접두 없이 원제목 그대로**(§0 D10) — 폴더는 `folder_path`가 나르므로 제목으로 흉내낼 이유가 없다. `folder_path`를 보내지 않는 구버전 경로에서만 종전 접두 관례가 유효하다. D'Flow는 어느 쪽도 형식을 강제하지 않고 200자 검증만 한다 |
| `body_markdown` | string ≤ **100,000자** | ✅ | → `body_md` 원문 저장. 한도는 D'Flow 기존 검증 상수(`MINUTE_BODY_MAX`)와 정합 |
| `external_id` | string ≤ 128자 | ✅ | **멱등 키**. 또박또박은 `ddobak:<회의 UUIDv7>` — 최초 업로드 시 발급하는 불변 `public_uid` (§10). unique |
| `meeting_id` | uuid | — | D'Flow 회의 엔티티 연결(선택). uuid 형식·존재 검증 후 저장(비형식/불존재 400 — v2.2 C2). replace 시 필드 부재=기존 값 유지, 명시적 null=해제(v2.2 C1). **프로젝트 연결은 이 필드 경유가 유일** |
| `folder_path` | **string[]** | — | ★ **v2.3 신설.** 회의가 속한 **폴더 경로**를 **root-first**(최상위 → 말단)로 보낸다. 예: `["MES","품질","주간정례"]`.<br>· 배열이 아니면 **400** `validation_failed`. 원소는 문자열만<br>· 각 원소는 `btrim` 후 **1~60자**. 벗어나면 **400 거절 — 절단하지 않는다**(§0 D12)<br>· 정규화(§4.7 ①②③) 후 **깊이 5 초과분은 절단**하고 5단째에 편철<br>· 실제 편철 결과는 응답에 **에코**된다(§4.3) — 절단·한 칸 내림이 반영된 값<br>· **키 부재 / `[]` / 비어있지 않은 배열을 3값으로 구분한다** → 아래 「3값 규약」<br>· 편철·자동 생성 규칙 전문 = **§4.7** |
| `on_conflict` | `replace`\|`skip`\|`error` | — | 기본 `replace` |

v1 스펙에 있던 `project_id`(minutes에 저장 컬럼 없음), `occurred_start_at/end_at`·`attendees`·`tags`(전부 minutes 컬럼 없음 — `meetings` 엔티티 속성), `external_source`·`external_instance`·`external_url`(컬럼 없음)은 **v1에서 제외**. 발신 시스템 식별은 `external_id`의 `ddobak:` prefix로 충분하다. 추가 메타 보존이 필요해지면 v1.1에서 `external_meta jsonb` 컬럼 1개로 수용(제안).

**`on_conflict` 의미** (동일 `external_id` 기존 레코드 존재 시):

- `replace`(기본): 본문·메타 갱신 + **후처리 파이프라인 재실행** (§4.5). → 또박또박 재전송 흐름
- `skip`: 변경 없이 기존 레코드 반환 (`action: "skipped"`)
- `error`: `409`

**기존 레코드가 없으면** `on_conflict` 값과 무관하게 **항상 신규 생성**(201 `created`)이다 (보장). 또박또박에 uuid가 이미 발급돼 있어도 D'Flow에 해당 `external_id` 레코드가 없는 상황(레코드 삭제됨, DB 초기화, 과거 전송 미도달)에서 전송하면 같은 `external_id`로 새 레코드가 만들어진다 — "이미 발급된 uuid인데 왜 없지"를 이유로 거부하지 말 것.

#### `folder_path` 3값 규약 (★ v2.3 — §0 D11)

재전송(`replace`) 시 **폴더 위치의 SSOT는 또박또박**이다. 단 "보내지 않음"과 "빈 값을 보냄"은 다른 뜻이므로 **3값**으로 구분한다:

| 값 | 의미 | 신규 생성 | `on_conflict=replace` |
|---|---|---|---|
| **키 부재** | 폴더 정보 **미제공** (구버전 클라이언트) | 팀 루트에 편철 (**v2.2까지의 동작 그대로**) | **기존 `folder_id` 유지** — 갱신 대상에서 제외 |
| **`[]`** | 명시적 **"폴더 없음"** | 팀 루트에 편철 | **팀 루트로 되돌림** |
| **`["A","B"]`** | 그 경로 | 경로대로 편철 (없는 하위 폴더는 자동 생성) | 그 경로로 **이동** |

> ⚠️ **`[]`를 "키 부재와 동일"로 뭉개지 말 것.** 그러면 또박또박에서 회의를 **폴더 밖으로 뺀 조작만 영영 전파되지 않는** 유일한 케이스가 된다. `meeting_id`의 "필드가 전송된 경우에만 갱신"(v2.2 C1)과 동형이되, **`[]`가 유의미한 값**인 점이 다르다.

- **`folder_path` 미전송 시 동작은 v2.2와 100% 동일하다** — 필드 도입만으로는 클라이언트 배포 순서를 강제하지 않는다(하위호환).
- `date`(→ `minute_date`)는 종전대로 재전송마다 갱신된다. `folder_id`와 달리 `minute_date`는 **위키 재인덱싱 대상**이므로 날짜가 바뀌면 철회·재빌드가 걸린다 — 날짜도 또박또박이 SSOT다.

### 4.3 응답

**`201`** (신규) / **`200`** (replace·skip):

```json
{
  "ok": true,
  "id": "3f2b9c4e-8a1d-4c7b-9e2f-1a5d8c3b7e90",
  "action": "created",
  "title": "물류공정_260716",
  "date": "2026-07-16",
  "team": "MES",
  "folder_id": "9f3c1d0a-52b7-4f88-9c31-6ad2e7b40f15",
  "folder_path": ["MES", "품질", "주간정례"],
  "meeting_id": null,
  "external_id": "ddobak:0198c9f2-3a41-7c22-b1e4-9f3d2a8c1b77",
  "created_by_name": "홍길동",
  "url": "https://wbs-web.vercel.app/minutes/3f2b9c4e-8a1d-4c7b-9e2f-1a5d8c3b7e90",
  "created_at": "2026-07-19T10:12:00+09:00",
  "updated_at": "2026-07-19T10:12:00+09:00"
}
```

- 모든 ID는 **UUID** (D'Flow PK 전부 `gen_random_uuid()` — 확인).
- `url`은 상세 페이지 `/minutes/{id}` — 실재하는 경로지만 **로그인한 사용자만 열람 가능** (middleware 리다이렉트 대상). 비로그인 공유가 필요하면 기존 공유 링크 기능(`/share/minutes/{token}`, opt-in)을 별도 사용.
- 예시의 `title`이 v2.2의 `"물류-물류공정_260716"`에서 접두 없는 값으로 바뀐 것은 §0 D10 개정 반영이다.

#### `folder_id` · `folder_path` (★ v2.3 신설 — **둘 다 nullable**)

응답의 `folder_path`는 **요청 값의 반향이 아니라** 정규화(한 칸 내림)·자동 생성·깊이 절단이 모두 반영된 **실제 편철 결과**다(root-first). D'Flow는 폴더 목록을 노출하지 않으므로(§0 D15) **이 에코가 유일한 사후 피드백 경로**다 — 클라이언트는 전송 다이얼로그에 이 값을 **반드시** 표시한다(권장 아님).

| `folder_id` | `folder_path` | 의미 | 클라이언트가 안내할 것 |
|---|---|---|---|
| uuid | `["MES"]` | **팀 루트**에 편철됨 (요청이 키 부재 또는 `[]`) | "MES 폴더에 등록됨" |
| uuid | `["MES","품질","주간정례"]` | 그 경로에 편철됨 (없던 하위 폴더는 자동 생성) | 경로 그대로 |
| **`null`** | **`null`** | ⚠️ **미분류** — 시드 팀 루트가 없어 편철에 실패. 단 **회의록 등록 자체는 성공**했다(§4.7-5) | **"미분류로 등록됨 — D'Flow에서 편철 필요"** |

> ⚠️ **`folder_path: []`를 미분류 신호로 쓰지 말 것.** `[]`는 **요청 축**에서 "팀 루트로 보내라"는 뜻이고 **응답 축에는 나오지 않는다** — 팀 루트 편철에 성공하면 `["MES"]`처럼 팀코드 1원소가 실린다. 미분류는 **`null`로만** 표현된다.
>
> 그래서 클라이언트 타입은 반드시 **`folder_id: string | null`, `folder_path: string[] | null`** 이어야 한다. `string[]`로 고정하면 런타임에서 깨지고, `null`을 `[]`로 관대 변환하면 **"팀 루트에 편철됨"이라는 정반대 안내**를 하게 된다.
>
> 수용 기준: **`folder_id: null` 응답에서 클라이언트 다이얼로그가 "팀 루트"라고 말하지 않는다.**

### 4.4 요청 예시

```bash
curl -X POST https://wbs-web.vercel.app/api/v1/minutes \
  -H "Authorization: Bearer $MINUTES_API_SECRET" \
  -H "Content-Type: application/json" \
  -d '{
    "user_email": "jjinie73@gmail.com",
    "date": "2026-07-16",
    "team": "MES",
    "folder_path": ["MES", "품질", "주간정례"],
    "title": "물류공정_260716",
    "body_markdown": "# 물류공정_260716\n\n- **날짜**: 2026-07-16\n- **시간**: 14:00 ~ 15:10\n...",
    "external_id": "ddobak:0198c9f2-3a41-7c22-b1e4-9f3d2a8c1b77",
    "on_conflict": "replace"
  }'
```

(v2.3: `folder_path` 추가 + `title`에서 `<하위폴더명>-` 접두 제거 — §0 D10. `folder_path`를 빼면 v2.2와 동일한 요청이며 동작도 동일하다.)

### 4.5 서버 처리 규칙 (D'Flow 구현 요구)

1. 인증 2계층 (§3) → 입력 검증은 기존 `validateMinuteInput` 재사용 (단 `title` 필수화).
2. **`correctMinuteBodyTime`(+9h 보정) 적용 금지** — §1.4의 이중 보정 방지. 기존 `createMinute`를 그대로 재사용하지 말고 보정 단계만 제외한 공용 함수로 분리할 것.
3. `meeting_id` 있으면 `meetings` 존재 확인 (기존과 동일), 없으면 400.
4. `external_id` **사전 select 후 insert/update 분기** (DB `ON CONFLICT` upsert 구문 사용 금지 — 부분 unique 인덱스는 conflict 대상 추론에 매칭되지 않아 42P10 실패, §12 주의 참조). replace 시 `updated_at = now()`.
5. 원본 .md 파일: **v1 생략 확정** (§0 D1) — `minute_files`·Storage 접근 없음. 뷰어·트리·검색 모두 `body_md` 기준이라 기능 결손 없음.
6. replace 갱신 범위는 §0 D3 — `created_by`/`created_by_name` 유지.
7. 저장 성공 후 **후처리 파이프라인 실행** (누락 시 검색·AI 챗·인사이트가 낡은 본문 참조): 신규 = `ingestMinute` + `generateMinuteInsights`, replace = `rematchMinuteHighlights` → `ingestMinute` → `generateMinuteInsights` (기존 순서 그대로, `actions/minutes.ts:95-98`·`178-182`).
8. **(v2.3)** `folder_path` 편철은 **§4.7**. 신규 생성·`replace` 두 경로가 **같은 해석 함수를 공유**해야 한다 — 구현이 갈라지면 등록 결과와 재편철 결과가 어긋난다.
9. **(v2.3)** `folder_id` 갱신 범위는 §4.2 3값 규약. 폴더 이동은 **버전 append도 위키 재인덱싱도 유발하지 않는다**(재인덱싱 대상은 `title`·`team_code`·`minute_date`뿐 — `folder_id`는 대상이 아니다). 이 "싼" 성질이 §4c 배치의 전제이므로, 폴더 갱신을 본문 커밋 경로에 얹지 말 것.

### 4.6 external_id 정밀 정의 (계약)

- **형식**: `ddobak:` + 소문자 UUID. 정규식 `^ddobak:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$` (총 43자).
- UUID는 또박또박이 발급하는 **UUIDv7** (RFC 9562, `SecureRandom.uuid_v7` — Ruby 4.0.2 확인). 회의당 1개, 최초 전송 시 발급, 이후 **불변**.
- **D'Flow는 이 값을 불투명(opaque) 문자열로만 다룬다** — 파싱·분해·형식 검증 금지, 정확 일치 비교만. 유일한 예외: 길이 ≤128 검사와 빈 문자열 거부. (또박또박이 아닌 다른 클라이언트가 향후 다른 prefix를 쓸 수 있도록)
- **발신 서버 무검증 (보장)**: replace는 `external_id` 일치만 본다. D'Flow는 "어느 또박또박 서버가 보냈는가"를 추적·검증하지 **않는다** — 의도된 설계다. 회의가 export/import로 **다른 또박또박 서버로 이동해도** 같은 uuid로 보내는 한 기존 레코드가 정상 갱신되어야 한다. 구현 시 발신 인스턴스 소유권 검사를 추가하지 말 것 (인증은 §3의 시크릿+이메일 매칭으로 충분).
- 발급·저장·재발급 규칙은 또박또박 책임 (§10 + `ddobak-dflow-sender-spec.md`).

### 4.7 `folder_path` 정규화·편철 규칙 (★ v2.3 신설 — 계약)

또박또박의 폴더 구조는 **자유**다 — 최상위 폴더명이 D'Flow 팀코드가 아닐 수 있다. 반면 D'Flow는 `team_code` 5축을 반드시 지켜야 한다(`minutes.team_code` not null + 목록 필터 `?team=` + 버전 테이블 + 위키 파이프라인이 전부 물려 있다). 그래서 아래 규칙으로 **팀 루트 아래에 같은 트리를 재현**한다.

#### 정규화 3분기

```
① path[0] === team                      (팀코드 캐시 조회 없음 — 단독 조건)
   → 편철 경로 = path 그대로

   또박또박:  MES / 품질 / 주간정례 / 2026-07
   D'Flow:    MES / 품질 / 주간정례 / 2026-07

──── 이하는 ①에 해당하지 않을 때(= path[0] !== team)만 판정한다 ────

② path[0] ∉ 활성 팀코드 목록          (= 팀코드가 아닌 자유 루트)
   → 편철 경로 = [team, ...path]        ("한 칸 내림" — §0 D13)

   또박또박:  신규TF / 킥오프 / 1차          (team=MES 로 전송)
   D'Flow:    MES / 신규TF / 킥오프 / 1차

③ path[0] ∈ 활성 팀코드 목록          (= 다른 팀의 팀코드)
   → 400 거절 (code: validation_failed)
   조용히 한쪽을 따르면 목록 필터(?team=)와 폴더 위치가 어긋난다
```

> ⚠️ **①에 팀코드 목록 조회를 넣지 말 것.** `path[0] === team`이면 그 팀 루트로 편철하는 것이 정의상 맞으므로 목록을 볼 이유가 없고, 넣으면 **해롭다**: 관리자가 팀을 **비활성화**하면(팀 삭제는 정책상 없다 — 비활성화가 삭제다) 그 팀코드로 저장된 **기존 회의록의 배치 재편철(§4c)이 ①에서 탈락해 ②로 떨어져** `["MDM","MDM","품질"]`처럼 **루트 세그먼트가 중복**된다. DB의 형제 이름 unique 인덱스는 부분 인덱스라 이를 막지 못한다.
>
> ②/③ 분기에만 팀코드 목록이 관여하며, **안전한 쪽으로 degrade한다** — 목록에 없는 값이면 ②(한 칸 내림)로 빠지지 ③(400)으로 가지 않는다. **이 방향을 뒤집지 말 것**: "모르는 값은 거절"이 아니라 **"모르는 값은 자유 폴더로 취급"** 이 맞다.

4. **깊이 상한** — 정규화 후 **5단 초과분은 절단**하고 5단째에 편철한다. 실제 결과는 응답에 에코(§4.3).
   - ⚠️ **정책 비대칭(인지할 것)**: 폴더명 60자 초과는 **400 거절**인데 깊이 초과는 **무통보 절단**이다. `신규TF/A/B/C/D1`과 `…/D2`가 한 칸 내림 후 6단이 되면 둘 다 `MES/신규TF/A/B/C`로 **병합되는데 에러가 없다.** v2.3은 현행(절단)을 규정하고, 최소 완화로 **응답 에코 표시를 클라이언트 필수**로 올린다(§0 D15). 정책 자체의 재확정은 별건.
5. **미분류 폴백** — 정규화 후 `path[0]`에 해당하는 **시드 팀 루트가 없으면** `folder_id = null`(미분류)로 두고 **로그를 남긴 뒤 등록은 성공시킨다.** 편철 실패가 등록 자체를 막으면 안 된다.
   - 응답 값은 **`folder_id: null` + `folder_path: null`** (§4.3 · §0 D14). `[]`가 아니다.
   - ⚠️ **배치(§4c)에서는 이 폴백을 적용하지 않는다** — 등록과 이동은 목적이 다르다. 배치에서 `folder_id`를 `null`로 만드는 것은 **회의록을 미분류로 빼내는 것**이라 목적과 정반대다. 배치는 `folder_id`를 건드리지 않고 `failed(no_team_root)`로 보고한다(§4c.3).
   - 이 폴백이 실제로 발동하면 원인은 거의 항상 **팀 루트 시드(0043) 미적용**이다.
6. **폴더 자동 생성 규칙** (경로 중 없는 마디를 만들 때)
   - **루트 폴더는 외부 API가 만들지 않는다.** 루트는 팀코드 5축 시드 전용이다(§0 D13) — 루트를 만들 수 있다는 것은 곧 **팀을 만들 수 있다**는 뜻이고, D'Flow 대시보드·칸반·진척 전 화면에 새 축이 튀어나온다.
   - 하위 폴더는 **blind 자동 생성** — 사전 조회 API가 없어도 **항상 성공**한다(§0 D15의 근거).
   - **`ON CONFLICT` 사용 금지.** 형제 이름 unique는 **부분 인덱스**(`where parent_id is not null`)라 conflict 대상 추론에 실패해 `42P10`으로 죽는다. **pre-select → insert → `23505`면 재조회** 순서로 구현할 것(동시 전송 2건이 같은 경로를 만들어도 폴더 중복·500이 없어야 한다). `minutes` upsert가 이미 같은 함정을 겪고 사전 select로 우회 중이다(§4.5-4).
   - 자동 생성 폴더의 **`created_by`는 전송 사용자의 uuid**로 채운다. **`null`은 시드 루트 표식**이라 그 값을 쓰면 스쿼팅 방어와 시드 재실행 판정이 무력화된다.
   - 폴더명 길이 검증은 **생성 전에** 한다(60자 — §0 D12). DB CHECK에 맡기면 `23514`로 편철 전체가 실패한다.

**요약(클라이언트 관점)**: 또박또박은 자기 폴더 트리를 그대로 root-first 배열로 보내면 된다. 루트가 팀코드면 그대로, 아니면 D'Flow가 팀 루트 아래로 한 칸 내려 준다. **다른 팀의 팀코드를 루트로 보내는 것만 금지**(400)이며, 실제 결과는 응답으로 확인한다.

## 4b. POST /minutes/link — 기존 회의록 수동 연결 (claim)

**용도**: 연동 이전에 D'Flow UI로 수동 업로드했던 회의록(= `external_id`가 null인 레코드)을 또박또박 회의와 연결한다. 연결되면 이후 또박또박의 재전송이 그 레코드를 갱신한다(중복 생성 방지).

요청 (`application/json`):

| 필드 | 타입 | 필수 | 설명 |
|---|---|---|---|
| `user_email` | string | ✅ | §3.3 동일 매칭. 없으면 403 `unknown_user` |
| `minute_id` | uuid | ✅ | 연결 대상 D'Flow 회의록 id |
| `external_id` | string | ✅ | 부여할 값 (§4.6 형식, 또박또박이 생성한 public_uid 기반) |

동작 (원자적으로):

1. `minute_id` 불존재 → **404** `{ "error": "...", "code": "not_found" }`
2. 대상의 `external_id`가 이미 **같은 값** → **200** `action: "linked"` (멱등 — 재호출 안전)
3. 대상의 `external_id`가 이미 **다른 값** → **409** `{ "code": "link_conflict" }` (기존 연결 보호 — **link로는 덮어쓸 수 없다**. 먼저 D'Flow에서 그 회의록의 연결을 초기화해야 한다 — **§4b-1**. ~~해제 API는 제공하지 않음, 필요 시 D'Flow DB에서 수동 처리~~ ← **v2.3에서 철회**)
4. 해당 `external_id`가 **다른 레코드에 이미 사용 중** → **409** `{ "code": "link_conflict" }`
5. 정상 → 대상 레코드에 `external_id` 세팅, **본문·메타는 변경하지 않음** (내용 갱신은 이후 POST /minutes replace가 수행) → **200**:

```json
{ "ok": true, "id": "<uuid>", "action": "linked", "external_id": "ddobak:0198..." }
```

콘텐츠는 건드리지 않으므로 후처리 파이프라인 불필요. 구현은 `update ... set external_id = $1 where id = $2 and external_id is null` + 영향 행 0이면 재조회로 사유 판별(unique 충돌은 DB 에러 코드 `23505`로 감지).

### 4b-1. 연결 초기화 (★ v2.3 — "해제 API는 제공하지 않음" 철회, §0 D17)

v2.2까지 §4b는 "**해제 API는 제공하지 않음, 필요 시 D'Flow DB에서 수동 처리**"라고 적었다. **v2.3에서 이 문장을 철회한다** — D'Flow 회의 정보 수정 모달에 **연동 식별자 표시 + 연결 초기화**가 생겨, `minutes.external_id`를 `null`로 되돌리는 정식 수단이 **DB 수작업 없이** 존재한다.

⚠️ **초기화는 API가 아니다.** 혼동을 막기 위해 셋을 분리해 적는다:

| 조작 | 주체·경로 | API 계약상 |
|---|---|---|
| **연결 초기화** (`external_id` → `null`) | **D'Flow UI 조작** — 회의 정보 수정 모달의 [연결 초기화] 버튼. 권한은 메타 수정과 동일(작성자 또는 `pmo_admin`), 확인 다이얼로그 필수 | **엔드포인트 없음.** 또박또박이 호출로 해제할 수단은 v2.3에도 **없다** — 의도된 설계다(해제는 D'Flow 소유자의 결정). 클라이언트는 이 절을 "해제 API가 생겼다"로 읽지 말 것 |
| **재연결** | 또박또박 → **`POST /minutes/link`** (claim) — **변경 없음** | 초기화된 레코드는 `external_id is null`이 되므로 §4b의 **정상 claim 대상**이 된다. `GET /minutes?linked=false` 목록에도 다시 나타난다 |
| **본문 갱신** | 또박또박 → `POST /minutes` (`replace`) — **변경 없음** | 재연결 이후의 재전송이 종전처럼 그 레코드를 갱신한다 |

초기화의 성질 (클라이언트가 알아야 할 것):

- **한쪽만 끊긴다.** D'Flow `external_id`는 `null`이 되지만 또박또박 `public_uid`·전송 상태(`dflow_synced_at`·`dflow_url`)는 **그대로 남는다** → 또박또박 화면은 계속 "연결됨"으로 보인다.
- 그 상태로 재전송하면 `external_id` 매칭이 실패해 **새 회의록이 생성(중복)** 되고 초기화된 원본은 **고아**로 남는다. 자가 치유되지 않는다.
- **감지 경로는 이미 있다** — `GET /minutes?external_id=`가 0건이면 연결이 끊긴 것이다(또박또박 `dflow/status`의 `exists_on_dflow: false`). **전송 전에 확인할 것.**
- ⚠️ **`exists_on_dflow: false`는 초기화 전용 신호가 아니다** — **보관(archived)·삭제도 같은 값**을 만든다. 초기화로 단정하면 사용자에게 잘못된 복구 절차를 안내하게 된다. v2.3은 이를 구분할 수 있도록 **§5.1에 `include_archived`·`archived`를 추가**했다.
- **복구는 깨끗하다** — `POST /minutes/link`는 본문·`updated_at`·후처리 파이프라인을 건드리지 않는 claim 경로다. 즉 **초기화는 되돌릴 수 있다.** 단 **되돌리는 조작은 또박또박 쪽에서** 해야 한다.
- **보관(archived) 회의록은 초기화할 수 없다.** `link`가 archived를 거절하므로, 초기화만 되고 재연결이 안 되는 **편도 상태**를 만들지 않기 위한 대칭 가드다.
- 초기화는 `updated_at`을 갱신하되(사용자 조작이므로) **버전 append·위키 재인덱싱은 없다** — `external_id`는 재인덱싱 대상이 아니다.

> **왜 이 기능이 계약에 들어오나**: 또박또박이 미연결 회의록을 자동 링크(claim)하기 시작하면 **오매칭 가능성**이 생기고, 오매칭 상태에서 재전송(`replace`)이 **엉뚱한 회의록 본문을 덮어쓴다.** 되돌리려면 `external_id`를 떼야 하는데 그 수단이 초기화뿐이다. → **자동 링크를 켜기 전에 초기화가 배포돼 있어야 한다.**
>
> 역방향 주의: 초기화가 클라이언트의 "연결 해제 감지 안내"보다 **먼저** 배포되면 위 "중복 생성 + 원본 고아" 창이 열린다. 양측 배포 순서는 D'Flow 작업지시 §11.2를 따른다.

---

## 4c. POST /minutes/folder — 일괄 재편철 (배치 · ★ v2.3 신설, §0 D16)

**용도**: `folder_path` 계약 **이전에** 전송돼 팀 루트에 평평하게 쌓인 회의록을, 또박또박이 아는 실제 폴더 경로로 **일괄 이동**한다. 신규 생성·본문 갱신은 하지 않는다 — **오직 `minutes.folder_id`만 바꾼다.**

> ⚠️ **재전송(`POST /minutes` `replace`)으로 대신하지 말 것.** 본문이 동일해도 **버전은 무조건 append**된다 → 회의록 N건이면 버전 N행 + 본문 전문 N회 복사. 게다가 후처리 파이프라인(하이라이트 재매칭 → 임베딩 → AI 인사이트)이 전건 재실행돼 **LLM 호출이 폭주**하고, 사용자에게는 "전 회의록이 방금 수정됨"으로 보인다.
> 반면 **폴더만 바꾸는 것은 지극히 싸다** — `folder_id`는 위키 재인덱싱 대상이 아니고(§4.5-9) 버전도 만들지 않는다. 그래서 전용 경량 엔드포인트를 둔다.

인증·게이트는 `/minutes*`와 동일하며 **순서가 계약이다**: env 2단 게이트(**404**) → Bearer 시크릿(**401**) → `user_email` 파싱 → 사용자 매칭(**403** `unknown_user`) → **페이로드 검증**(400). 즉 **계정이 불량이면 `items`를 보기 전에 403이 먼저 난다**(§4c.4-9의 프로브가 성립하는 근거).

### 4c.1 요청

```jsonc
{
  "user_email": "hong@dongkuk.com",
  "dry_run": true,                          // 기본 true — 실제 이동은 명시적 false 필요
  "overwrite_manual": false,                // §4c.5
  "items": [
    { "external_id": "ddobak:018f…", "team": "MES", "folder_path": ["MES","품질","주간정례"] },
    { "external_id": "ddobak:018f…", "folder_path": ["신규TF","킥오프"] },   // team 생략
    { "external_id": "ddobak:018f…", "team": "MES", "folder_path": [] }
  ]
}
```

| 필드 | 타입 | 필수 | 설명 |
|---|---|---|---|
| `user_email` | string | ✅ | §3.3 동일 매칭. 없으면 403 `unknown_user` |
| `dry_run` | boolean | — | **기본 `true`**. **필드 부재 = dry run.** 실제 이동은 명시적 `false`가 있어야 한다 |
| `overwrite_manual` | boolean | — | 기본 `false`. 사람이 옮겨 둔 것으로 판정된 건을 덮을지 — §4c.5 |
| `items` | object[] | ✅ | **최대 200건/요청.** 초과는 **400**. 클라이언트가 나눠 보낸다. **빈 배열 `[]`도 유효**(§4c.4-9) |
| `items[].external_id` | string | ✅ | 대상 회의록의 멱등키(§4.6). 불투명 문자열, 정확 일치 |
| `items[].team` | string | — | **선택.** 생략하면 **그 회의록에 저장된 기존 `team_code`를 그대로 쓴다** |
| `items[].folder_path` | string[] | ✅ | 목표 경로(root-first). 해석은 **§4.7 그대로**(별도 규칙 없음). `[]`면 팀 루트 |

> **`items[].team`이 왜 선택인가**: 또박또박은 **전송 당시 사용자가 고른 team을 기록하지 않는다.** 루트가 팀코드가 아니었던 회의는 마이그레이션 시점에 team을 재판정할 수 없다. **D'Flow에 이미 저장된 `team_code`가 그 시점의 정답**이므로 그것을 쓴다.
>
> `team`이 **주어졌는데** 회의록의 기존 `team_code`와 다르면 → **`failed` (`reason: "team_mismatch"`)**. 마이그레이션이 팀을 옮기는 도구가 되면 안 된다 — 팀 변경은 위키 재인덱싱을 유발한다.

### 4c.2 응답

```jsonc
{
  "ok": true, "dry_run": true,
  "summary": { "total": 200, "moved": 173, "already_correct": 1, "skipped": 21, "not_found": 3, "failed": 2 },
  // total = moved + already_correct + skipped + not_found + failed (200 = 173+1+21+3+2). total은 요청 상한 200을 넘지 않는다
  "results": [
    { "external_id": "ddobak:018f…", "status": "moved",
      "from": ["MES"], "to": ["MES","품질","주간정례"], "folder_id": "9f3c…" },
    { "external_id": "ddobak:018f…", "status": "already_correct",
      "from": ["MES","품질"], "folder_id": "9f3c…" },
    { "external_id": "ddobak:018f…", "status": "skipped", "reason": "manual_placement" },
    { "external_id": "ddobak:018f…", "status": "not_found" },
    { "external_id": "ddobak:018f…", "status": "failed", "reason": "folder_name_too_long: 현장품질개선…(72자)" },
    { "external_id": "ddobak:018f…", "status": "failed", "reason": "no_team_root",
      "from": ["MES"] }        // ⚠️ to·folder_id 없음 — 이동하지 않았음을 형태로 드러낸다
  ]
}
```

- `summary`의 6개 카운트는 **항등식**을 만족한다: `total = moved + already_correct + skipped + not_found + failed`.
- `dry_run: true`에서도 `results`는 **실행했을 때와 동일한 판정**을 담는다(`moved` = "이동 예정"). dry-run 결과와 실제 실행 결과가 어긋나면 계약 위반이다.
- `from`은 이동 전 경로, `to`는 이동 후 경로(둘 다 root-first). **이동하지 않은 status에는 `to`·`folder_id`를 싣지 않는다** — 성공 형태와 구분되어야 한다.

### 4c.3 `status` 값 집합 (계약 — 응답 예시에서 유추 금지)

| `status` | `reason` | 의미 |
|---|---|---|
| `moved` | — | 목표 위치로 이동 완료 (dry run이면 "이동 예정") |
| `already_correct` | — | 이미 목표 위치. **`moved`에 섞지 말 것**(§4c.4-6·10) |
| `skipped` | `manual_placement` | 사람이 옮긴 것으로 판정 (§4c.5) |
| `skipped` | `archived` | `archived_at is not null` (§4c.4-4) |
| `not_found` | — | 그 `external_id`의 회의록이 D'Flow에 없음 |
| `failed` | `team_mismatch` | `items[].team`이 회의록의 기존 `team_code`와 다름 |
| `failed` | `folder_name_too_long: <이름>(<n>자)` | 폴더명 60자 초과 (§0 D12) |
| `failed` | `validation_failed: <사유>` | `folder_path` 타입 오류·§4.7 ③(다른 팀 루트) 등 |
| `failed` | `no_team_root` | 정규화 후 `path[0]`의 **시드 팀 루트가 없음** — §4.7-5 미분류 폴백을 **적용하지 않고** 이 상태로 보고한다 |
| `failed` | `folder_error: <경로> 생성 실패` | APPLY 중 목표 경로의 중간 폴더를 만들지 못함. **조상에 떨구지 않는다** — 리포트(`to`)와 실제 트리가 어긋나면 안 되므로 이동 자체를 하지 않는다 |
| `failed` | `update_failed: <사유>` | 폴더는 확정됐으나 `minutes` 갱신이 실패(0행 포함). 조용한 no-op을 성공으로 위장하지 않는다 |

> `folder_error`·`update_failed`는 **DB 실패 계열**이라 재실행으로 해소될 수 있다(멱등). 위 4개(`team_mismatch`·`folder_name_too_long`·`validation_failed`·`no_team_root`)는 **입력·전제 문제**라 재실행해도 같은 결과다 — 또박또박은 이 구분으로 "재시도 대상"과 "사람이 고칠 대상"을 갈라야 한다.

**dry run의 `folder_id`**: dry run은 **폴더를 만들지 않는다**. 목표 경로의 폴더가 아직 없으면 `status: "moved"`(이동 예정) + **`folder_id: null`** 로 보고하고 `to`에 목표 경로를 싣는다. `folder_id`가 채워져 오는 것은 그 폴더가 **이미 실재**한다는 뜻이다.

> ⚠️ **`no_team_root`를 `moved`로 집계하면 안 된다.** 배치는 '등록'이 아니라 **'이동'** 이다. 등록(`POST /minutes`)에서는 편철 실패가 등록을 막지 않도록 `null` 폴백이 옳지만, 배치에서 `folder_id`를 `null`로 만드는 것은 **회의록을 미분류로 빼내는 것**이라 목적과 정반대다. `moved`로 집계하면 **리포트는 성공인데 트리엔 반영이 없는** 상태가 되고, 멱등 재실행마다 같은 건이 또 `moved`로 나온다. → **`folder_id` 변경 없이 `failed(no_team_root)`.** 이 카테고리가 나오면 원인은 거의 항상 **팀 루트 시드(0043) 미적용**이다.
>
> ⚠️ **§4.7과 충돌하지 않게 읽을 것**: 경로 해석 함수는 두 호출자에게 **동일하게** `null`을 돌려준다(호출자별 분기 금지 — 두 번째 정규화 구현이 생기는 통로다). **그 `null`을 어떻게 처리할지만** 호출자가 정한다 — `POST /minutes`는 `folder_id: null`로 **등록**하고, 배치는 **건드리지 않고 `failed`로 보고**한다.

### 4c.4 동작 규약 (구현 요건)

1. **`folder_path` 해석은 §4.7 규칙을 그대로 재사용한다** — 등록 경로와 **같은 함수**를 공유할 것. 별도 구현 금지(두 경로가 갈라지면 마이그레이션 결과와 이후 전송 결과가 어긋난다).
   ⚠️ **시그니처 계약**: 공유 함수의 `teamCode`는 **필수·구체값**이다. `items[].team`이 선택인 것은 **배치 라우트의 책임** — 라우트가 먼저 team을 확정(주어짐 → 기존 `team_code`와 대조, 생략 → 기존 `team_code` 채택)한 뒤 확정값으로 호출한다. 공유 함수 안에 `teamCode` 옵션 분기를 만들지 말 것.
2. **`updated_at`을 갱신하지 않는다.** 조직 백필이 외부 연동 `GET`의 `updated_at`에 "갱신"으로 비치면 안 된다 — 대량 마이그레이션에서 갱신하면 **또박또박 목록이 전건 "방금 수정됨"** 으로 보인다. (사용자의 단건 폴더 이동은 UI 조작이라 다르다.)
3. **버전 append 없음.** 본문 커밋 경로를 경유하지 말고 `folder_id`만 직접 update.
4. `archived_at is not null` → **`skipped` (`reason: "archived"`)**.
5. **배치 상한 `items` 200건**. 초과는 **400**.
6. **이미 목표 위치인 건은 `already_correct`** — `moved`에 섞지 말 것. 섞으면 재실행마다 `moved`가 전건으로 나와 **진척 신호로 못 쓴다.**
7. **부분 실패는 전체를 롤백하지 않는다** — 건별 `results`로 보고. **재실행이 멱등**이므로 실패분만 다시 보내면 된다.
8. **`dry_run: true`가 기본값.** 필드 부재 = dry run.
9. **`items: []`(빈 배열)은 유효 요청이다** — **`200 OK`** + **전 카운트 0인 summary**(`{ total: 0, moved: 0, already_correct: 0, skipped: 0, not_found: 0, failed: 0 }`) + `results: []`. **400으로 거절하지 말 것.**
   - **이유**: 클라이언트가 **배치 시작 전 실행 계정(`user_email`) 검증 프로브**로 이 요청을 쓴다(빈 `items` + `dry_run: true` 1회). 배치는 rake 등 비대화형 경로에서 도는데 거기엔 로그인 사용자가 없어 이메일을 인자로 받는다 — **잘못된 계정으로 수백 건을 전부 403으로 태우는 것을 막는 유일한 수단**이다.
   - **게이트 순서가 이 프로브의 전제다**(절 머리말) — `items` 검증을 "비어있지 않은 배열"로 좁히면(흔한 기본값) **정상 계정에서도 400**이 나와 클라이언트의 "프로브 실패 시 중단" 규칙에 걸려 **마이그레이션 시작 자체가 불가**해진다.
10. **판정 선후 — `already_correct`가 `overwrite_manual` 판정보다 먼저다.** 현재 위치가 목표 위치와 **동일하면 §4c.5 판정 표 전체보다 먼저** `already_correct`로 확정한다(표의 어느 행에도 걸리지 않는다 — "팀 루트" 행 포함).
    - **이유**: 그러지 않으면 1차 실행으로 하위 폴더에 옮긴 건들이 **재실행 dry-run에서 전부 `manual_placement`로 집계**된다(현재 `folder_id`만 보면 하위 폴더이므로). 클라이언트는 그 수치를 `overwrite_manual`을 켤지 말지의 **판단 근거**로 쓰므로 근거가 오염된다. 최악은 담당자가 그 수치를 보고 `overwrite_manual: true`를 켜서 **진짜 사람이 옮긴 건까지 덮는 것**이다.
11. **`status` 값 집합은 §4c.3이 계약**이다. 응답 예시에서 유추하지 말 것.

### 4c.5 `overwrite_manual` — 수동 이동분 보호

D'Flow 사용자가 탐색기에서 직접 옮겨 둔 회의록을 마이그레이션이 덮으면 **사람이 한 일이 지워진다.** 판정 기준:

> ⚠️ **게이트**: 아래 판정은 **현재 위치 ≠ 목표 위치**일 때만 적용한다 — 동일하면 §4c.4-10에 따라 `already_correct`로 먼저 확정한다.

| 현재 `folder_id` | 해석 | `overwrite_manual: false`(기본) |
|---|---|---|
| `null`(미분류) | 아직 편철 안 됨 | **이동** |
| 팀 루트 = 외부 API가 자동 편철한 자리 | 자동 편철 그대로 | **이동** (목표도 팀 루트면 `already_correct`) |
| 그 외(하위 폴더 어딘가) | 사람이 옮겼을 가능성 | **skip** (`reason: "manual_placement"`) — 단 목표 위치와 같으면 `already_correct`가 먼저 |

`overwrite_manual: true`면 전부 이동. **dry run으로 `manual_placement` 건수를 먼저 확인한 뒤 결정**할 것.

> ⚠️ **이 판정 표의 2·3행은 배포 순서에 의존한다.** "하위 폴더 = 사람이 옮긴 것"이라는 추론은 **등록 경로가 아직 팀 루트에만 떨구고 있을 때**만 참이다. 클라이언트가 `folder_path` 전송을 켜면 그 순간부터 **"하위 폴더에 있지만 사람이 옮긴 게 아닌"** 회의록이 생겨 3행의 추론이 무너진다.
> → 그래서 **일괄 재편철을 전송 전환보다 앞세운다**(§0 D18 · §14.1). 순서를 뒤집으면 `manual_placement` 집계가 오염되고, 그 수치를 보고 `overwrite_manual`을 켜면 **진짜 수동 이동분까지 덮인다.**

### 4c.6 이 배치가 **하지 않는** 것

- **제목 접두(`<하위폴더명>-`) 정리는 포함하지 않는다.** `title` 변경은 **위키 재인덱싱 대상**이라 폴더 이동의 "공짜" 성질이 사라지고, 과거 버전 행은 그때의 제목을 보존해야 맞다(소급 재작성 = 히스토리 오염). → **별건**(§0 D10).
- **team 이동을 하지 않는다** — `team_mismatch`로 거절한다(§4c.1).
- **신규 등록을 하지 않는다** — 없는 `external_id`는 `not_found`이며, 배치가 회의록을 만들지 않는다.
- **미분류로 빼내지 않는다** — `no_team_root`는 `folder_id` 무변경(§4c.3).

---

## 5. 조회 API

### 5.1 GET /minutes

| 파라미터 | 설명 |
|---|---|
| `external_id` | 정확 일치 (멱등 확인용 — 핵심) |
| `linked` | `true`=external_id 있는 것만, `false`=**없는 것만** (수동 연결 후보 검색용 — §4b) |
| `date_from` / `date_to` | 일자 범위 |
| `team` | 구분 필터 |
| `page` / `per_page` | 기본 20, 최대 100 |
| `include_archived` | ★ **v2.3 신설.** `true`면 **보관(archived)된 회의록도 포함**한다. **기본 `false` = 종전과 동일**(보관분 제외) — 하위호환이므로 기존 클라이언트는 무수정으로 같은 결과를 받는다 |

응답: `{ "items": [...], "total": 27, "page": 1, "per_page": 20 }`

`items[]` 필드 (연결 후보 화면이 표시할 최소 집합): `id, title, date, team, external_id(null 가능), created_by_name, created_at, updated_at, url` **＋ `archived`(boolean — ★ v2.3 신설)**. **본문 제외.**

- `archived`는 `include_archived` 값과 **무관하게 항상 실린다**(기본 조회에서는 늘 `false`). 클라이언트가 분기용 필드의 유무를 조건부로 다루지 않게 하기 위해서다.

#### 왜 필요한가 — `exists_on_dflow: false`의 archived 오진 (v2.3 C7)

v2.2까지 `GET /minutes`는 `archived_at is null` 필터를 **`external_id` 정확 조회를 포함한 모든 질의에 무조건** 적용했다(범위 초과 페이지의 폴백 카운트 쿼리에도 다시 적용). 그래서 D'Flow에서 회의록을 **보관만 해도** 클라이언트의 존재 확인이 0건이 되고, 또박또박은 이를 **"D'Flow에서 연결이 초기화(해제)되었습니다"로 오진**한다. 초기화는 일어나지 않았고 `external_id`는 **그대로 살아 있다.**

오진의 대가가 큰 이유는 **그때 안내되는 복구 두 갈래가 둘 다 막히기 때문**이다:

| 안내되는 갈래 | 보관분에서 실제로 | 이유 |
|---|---|---|
| **[D'Flow에서 찾기]로 재연결** (권장 갈래) | **불가** | `GET /minutes?linked=false` 목록에도 같은 `archived_at is null` 필터가 걸려 **고를 대상이 화면에 없다** |
| **[새로 전송]** | **불가** | 같은 `external_id`로 오면 **409 `archived`**("보관된 회의록입니다. 복원 후 다시 시도하세요.")로 막힌다 |

즉 사용자는 "연결이 끊겼습니다 + 이렇게 고치세요" 안내를 받은 뒤 **양쪽 다 실패**한다. 진짜 해법인 "**D'Flow에서 보관 해제**"는 어느 화면에도 적혀 있지 않았다. 부수 피해로, 자동 링크의 재연결 경로에서 **보관분이 '초기화분'으로 분류**돼 D'Flow에 원본이 살아 있는데도 엉뚱한 회의록을 claim하러 들어간다.

→ v2.3은 **원인을 없애는 쪽**을 택했다: 클라이언트가 **초기화 · 보관 · 삭제를 구분**할 수 있게 한다. (문구만 완화하는 안은 오진을 못 없애고 사용자에게 전가하므로 기각.) 신규 엔드포인트가 아니라 **기존 라우트의 파라미터 추가**이므로 "신규 엔드포인트는 `POST /minutes/folder` 1개뿐" 방침과 충돌하지 않는다.

**클라이언트(또박또박) 사용 규약**:

| 호출 | 결과 | 안내할 것 |
|---|---|---|
| `GET /minutes?external_id=<id>&include_archived=true` | **0건** | 초기화 또는 삭제 → "연결이 해제되었습니다" + 두 갈래([D'Flow에서 찾기] 재연결 / 새로 전송) |
| 〃 | **1건 + `archived: true`** | ⚠️ **"D'Flow에서 보관됨 — 복원 후 다시 시도"**. 이때 [새로 전송]·[재연결]을 **권하지 말 것**(둘 다 실패한다) |
| 〃 | **1건 + `archived: false`** | 정상 연결 |

- **존재 확인(status)에는 `include_archived=true`를 켠다.** 켜지 않으면 v2.2와 같은 오진이 그대로 남는다.
- **연결 후보 조회(`linked=false`)에는 켜지 않는다.** 보관분을 claim 대상으로 삼으면 안 된다(`link`가 archived를 거절한다 — §4b-1).

### 5.2 GET /minutes/meta

```json
{
  "teams": ["PMO", "ERP", "MES", "가공", "MDM"],
  "projects": [ { "id": "<uuid>", "name": "D-CUBE 프로젝트" } ],
  "limits": { "max_body_chars": 100000, "max_request_bytes": 4194304, "max_attachments": 10, "max_attachment_bytes": 20971520 }
}
```

`teams`는 또박또박이 최상위 폴더명 자동 판정(§0 D10)의 기준으로 쓰므로, D'Flow에 팀이 추가/변경되면 이 응답만으로 또박또박이 무수정 추종한다.

- `teams`는 `TEAM_CODES` 상수(`src/lib/domain/minutes.ts:9`) 재사용.
- `projects`에 `status` 컬럼 없음 (확인).
- 회의 목록은 프로젝트 종속이므로 별도 파라미터: **`GET /minutes/meta?project_id=<uuid>`** 일 때만 `meetings: [{id, title, date}]` 포함 (기존 `fetchProjectMeetingsLite`가 projectId 필수 — 확인).

### 5.3 GET /minutes/{id} (v1.1)

4.3 응답 + `body_markdown`, `attachments[]`.

---

## 6. 오류 응답 규격

D'Flow 전 라우트의 기존 관례는 평면 `{ "error": string }` (공용 헬퍼 없음 — 확인). 신규 API도 **평면 유지 + 기계 판독용 `code` 추가**로 절충:

```json
{ "error": "team은 PMO, ERP, MES, 가공, MDM 중 하나여야 합니다.", "code": "validation_failed" }
```

| HTTP | code | 상황 |
|---|---|---|
| 400 | `validation_failed` | 필수 누락, 형식 오류, 허용 외 `team`, 본문 100,000자 초과, `meeting_id` 불존재<br>**(v2.3 추가)** `folder_path`가 배열이 아님·원소가 문자열이 아님, **폴더명 60자 초과**(절단하지 않고 거절 — §0 D12), **`folder_path[0]`이 다른 팀의 팀코드**(§4.7 ③), `POST /minutes/folder`의 `items` **200건 초과** |
| 401 | `unauthorized` | 시크릿 없음/불일치 |
| 403 | `unknown_user` | `user_email`에 해당하는 D'Flow 사용자 없음 (§3.3 — **요구사항: 반드시 실패**) |
| 404 | `not_found` | env 미설정 (존재 은닉, code 없이 Next 기본 404) / link 대상 `minute_id` 불존재 |
| 409 | `conflict` | `on_conflict=error` + `external_id` 중복 |
| 409 | `link_conflict` | link: 대상이 이미 다른 `external_id`를 가짐, 또는 `external_id`가 타 레코드에 사용 중 (§4b). **해소는 D'Flow UI의 연결 초기화 — §4b-1** |
| 409 | `archived` | **(v2.3 명문화 — 기존 구현에 이미 존재)** `replace` 대상이 **보관된** 회의록: "보관된 회의록입니다. 복원 후 다시 시도하세요." `link`도 archived 대상을 거절한다. ⚠️ 이 상태는 `GET /minutes`에서 **기본적으로 조회되지 않으므로** 클라이언트는 `include_archived=true`로 구분할 것(§5.1) |
| 413 | `payload_too_large` | 요청 크기 초과 (※ Vercel 플랫폼이 라우트 도달 전에 자체 형식으로 응답할 수 있음 — 클라이언트는 상태코드만 신뢰) |
| 500 | `internal_error` | 서버 오류 |

Rate limit(429)은 **v1 제외** — 레포에 카운터 저장 인프라(Redis 등)가 없고 stateless serverless라 신설 비용이 큼. 필요 시 v2.

---

## 7. 제한 (D'Flow 실측 기준)

| 항목 | 값 | 근거 |
|---|---|---|
| `body_markdown` | **100,000자 (확정, §0 D2)** | `MINUTE_BODY_MAX` (`domain/minutes.ts:4`) — 기존 UI 경로와 동일 검증기 공유. 또박또박은 **원본 텍스트 제외 export**(`include_transcript=false`)가 기본이며 전송 전 길이 검사·초과 시 안내(자동 절단 금지) |
| 요청 전체 | 4MB | Vercel serverless 바디 한도(~4.5MB). `vercel.json` 없음(기본값 사용 중 — 확인) |
| 첨부 | 개당 20MB, 10개 | Storage 버킷 `file_size_limit` + `MINUTE_ATTACHMENTS_MAX_COUNT` (확인). v1.1 |
| **`folder_path` 원소(폴더명)** | **`btrim` 후 1~60자** | `minute_folders.name check (length(btrim(name)) between 1 and 60)`. **또박또박은 100자까지 허용**하므로 **전송 전 사전 차단 필요** — 초과는 **400 거절, 절단하지 않는다**(§0 D12) |
| **`folder_path` 깊이** | **5단** (정규화 후) | 앱 상수 `MINUTE_FOLDER_DEPTH_MAX = 5` (DB 제약이 아니라 **앱 상수**). 초과분은 절단 후 5단째에 편철하고 **실제 결과를 응답에 에코**(§4.3). 더 깊게 만들면 UI가 만들 수 없는 깊이가 생겨 탐색기의 "하위 폴더 만들기"가 비활성인 채 트리만 깊어진다 |
| **`POST /minutes/folder` `items`** | **200건 / 요청** | 초과는 400. 클라이언트가 나눠 보낸다 (§4c.4-5) |

## 8. 보안

- HTTPS 전용. 시크릿 검증은 상수시간 비교, env 미설정 시 404 은닉 (기존 관례).
- `MINUTES_API_SECRET`은 충분히 긴 랜덤값, 또박또박 Rails 서버 credential로만 보관 (프런트 노출 금지).
- `user_email`은 신원 **선택**이지 인증이 아님 — 인증은 계층 ①이 담당. 시크릿 유출 시 임의 사용자 위장이 가능하므로 유출 시 즉시 회전. (사용자별 소유 증명이 필요해지면 v2 PAT로 승격)
- `body_markdown` 렌더링은 기존 뷰어 파이프라인 그대로 (react-markdown, raw HTML 미허용 — 기존과 동일).
- service_role 클라이언트 사용 라우트이므로 입력 화이트리스트 검증 필수 (기존 `parseBody` 수동 타입가드 스타일).
- CORS 불필요 (서버-투-서버).

---

## 9. D'Flow 측 작업 지시 (파일 단위)

전부 신규 파일 + env 추가. 기존 파일 수정은 **최대 1줄** — `rematchMinuteHighlights`(`actions/minutes.ts:45`, 현재 비-export)에 `export` 키워드 추가(로직 복제를 택하면 0줄). 기존 UI 업로드·Server Action 경로와 완전히 분리되어 회귀 위험이 없다.

### 9.1 신규 마이그레이션 — `supabase/migrations/0034_minutes_external_id.sql`

```sql
-- 외부 시스템(또박또박) 업로드 멱등키. UI 업로드 건은 null 유지.
-- share_token(0026)과 동일한 부분 유니크 인덱스 관례.
alter table minutes add column if not exists external_id text;
create unique index if not exists minutes_external_id_uidx
  on minutes (external_id) where external_id is not null;
```

컬럼 추가뿐이므로 기존 조회(`MINUTE_COLUMNS` 화이트리스트 select — `repositories/supabase/minutes.ts:18-21`)에 영향 없음(확인).

### 9.2 신규 공용 유틸 — `src/lib/minutes/externalApi.ts`

- `verifyApiSecret(req): boolean` — `api/chat/index/worker/route.ts:30-36`의 sha256+`timingSafeEqual` 로직을 복제(또는 해당 유틸을 export로 승격해 재사용). env: `MINUTES_API_ENABLED`, `MINUTES_API_SECRET`.
- `resolveUserByEmail(admin, email): Promise<{id, name} | null>` — `lower(trim(email))` 정규화 후 `admin.auth.admin.listUsers()` 페이지 순회(`actions/accounts.ts:185` 관례)로 `deleted_at` 없는 일치 사용자 검색. 표시 이름은 기존 `displayNameFrom` 관례 재사용.
- `parseMinutePayload(body: unknown)` — 수동 타입가드(레포 관례, zod 미사용). `validateMinuteInput`(`domain/minutes.ts:22-30`) 재사용 + `title`·`external_id`·`user_email` 필수 검사 추가. **`correctMinuteBodyTime` 호출 없음** (§0 D4).
- 후처리 재사용 주의: `ingestMinute`·`generateMinuteInsights`는 export 함수라 그대로 import 가능하나, **`rematchMinuteHighlights`는 비-export**(`actions/minutes.ts:45`) — `export` 승격(기존 파일 1줄 수정) 또는 로직 복제 중 택일해 명시적으로 처리.

### 9.3 신규 라우트 — `src/app/api/v1/minutes/route.ts` (POST + GET)

§12 골격대로. 핵심 흐름: env 게이트(404) → 시크릿(401) → JSON 파싱(400) → 사용자 매칭(403 `unknown_user`) → 검증(400) → `meeting_id` 존재 확인(400) → `external_id` 사전 select로 `on_conflict` 분기 → insert 또는 update(§0 D3 범위) → 후처리 파이프라인(§4.5-7) → 응답(§4.3). DB 접근은 전부 `createAdminClient()`.

### 9.4 신규 라우트 — `src/app/api/v1/minutes/meta/route.ts` (GET)

§5.2. `TEAM_CODES` 상수 + `admin.from('projects').select('id,name')` + (`project_id` 쿼리 시) 해당 프로젝트 meetings.

### 9.4b 신규 라우트 — `src/app/api/v1/minutes/link/route.ts` (POST)

§4b. 인증 2계층 동일 → `minute_id` 조회 → external_id null 검사 → 조건부 update. unique 위반(23505)은 409 `link_conflict`로 변환.

### 9.5 env — `.env.local.example` 추가 + Vercel 프로젝트 설정

```
MINUTES_API_ENABLED=true            # 미설정이면 API 전체 404 (존재 은닉)
MINUTES_API_SECRET=long-random      # openssl rand -base64 48
```

### 9.6 테스트 — `tests/minutes/external-api.test.ts` (vitest, 기존 `tests/minutes/` 관례)

최소 케이스: ① env 미설정→404 ② 시크릿 불일치→401 ③ 미지 이메일→403 `unknown_user` ④ 필수 누락·허용 외 team·100,000자 초과→400 ⑤ 신규→201 `created` ⑥ 같은 `external_id` 재전송→200 `replaced` + D3 범위만 갱신 ⑦ `on_conflict=skip`→200 `skipped` ⑧ `on_conflict=error`→409 ⑨ 본문에 4마커 있어도 시간 무보정(§1.4 회귀 방지 — **필수 케이스**) ⑩ link: null 레코드→200 `linked` / 같은 값 재호출→200 / 다른 값·중복 값→409 `link_conflict` / 불존재→404 ⑪ GET `linked=false` 필터.

### 9.7 규모 요약

| 구분 | 내용 | 규모 |
|---|---|---|
| 마이그레이션 | 0034 (컬럼 1 + 부분 unique 인덱스 1) | 소 |
| 신규 코드 | 유틸 1 + 라우트 3 (minutes, meta, link) | 중 (기존 파일 수정 최대 1줄 — export 승격) |
| env | 2개 | 소 |
| MDM 팀 추가 (§9.8) | 별도 작업 — API보다 논리적으로 선행 (같은 배포로 묶어도 무방) | 중 |
| 변경 없음 | 기존 Server Action·UI·RLS·다른 라우트 전부 | — |

### 9.8 MDM 팀 추가 (F6 — API와 별개의 선행 작업)

또박또박 최상위 폴더에 MDM이 실재하므로 D'Flow 구분에 MDM이 필요하다. 현재 team 코드셋은 **등록형이 아니라 3계층 하드코딩**이다 (실측):

| 계층 | 위치 | 수정 |
|---|---|---|
| DB CHECK 2곳 | `0014_rename_dt_to_gagong.sql:11` (`teams.code`), `0021_minutes.sql:15` (`minutes.team_code`) | 신규 마이그레이션 `0035_add_mdm_team.sql`: 두 CHECK 제약 drop 후 `in ('PMO','가공','ERP','MES','MDM')`로 재생성 + `insert into teams (code, name) values ('MDM','MDM')` |
| TS 타입·상수 | `TeamCode` 유니온(`types.ts:2`), `TEAM_CODES`(`domain/minutes.ts:9`), `KANBAN_TEAM_CODES`(`KanbanBoard.tsx:20`) | 각 배열/유니온에 `'MDM'` 추가 |
| `Record<TeamCode,…>` 리터럴 9곳 | `MinutesTree.tsx:11`(FOLDER_TINT), `wbs/shared.tsx:3`(TEAM 색), `MembersBoard.tsx:15`, `excel/export.ts:10`(TEAM_COL — **엑셀 컬럼 번호**), `repositories/supabase/wbs.ts:51`, `report/brand.ts:33`, `data/wbs.ts:62`, `domain/kanban.ts:22`, `domain/tree.ts:6` | `'MDM'` 추가 시 **tsc가 9곳 전부 컴파일 에러로 강제 열거** — 각 1줄(색·순서·컬럼) 추가. 누락 불가능 |
| CSS 색 토큰 | `globals.css:73-76`(라이트)·`:143-144`(다크) | 라이트 1줄(`--color-team-mdm` + `--color-team-mdm-weak` 2값) + 다크 1줄(`--color-team-mdm-weak` 1값) 추가 — 기존 팀당 패턴 동일 |

**부수효과 (팀장 확인 필요)**: WBS·칸반·근태·멤버 화면에 MDM 팀이 등장하고, **엑셀 import/export의 팀 컬럼(TEAM_COL)과 주간보고에 MDM 열이 추가**된다 — 기존 WBS 엑셀 템플릿을 쓰는 팀이 있으면 템플릿 정합 확인. minutes 한정 추가(반쪽)나 타입 분리(부채) 대안은 검토 후 기각 — 전 모듈 정식 추가가 비용 동일하면서 완전함.

## 10. 또박또박 측 연동 계획 (참고)

```
[또박또박] 회의 종료 · 최종 회의록 생성 (또는 "D'Flow로 보내기" 클릭)
   │
   ├─ 1. 자체 export (include_transcript=false 기본) → markdown 확보
   ├─ 2. GET /minutes/meta → teams 목록 확보 (자동 판정 기준 + 실패 시 다이얼로그 선택지)
   └─ 3. POST /minutes
          user_email    ← 또박또박 로그인 사용자의 이메일 (D'Flow 계정과 동일해야 함)
          date          ← meeting.started_at 날짜
          team          ← 최상위 폴더명 자동 판정 (meta.teams에 있으면 채택, 없으면 다이얼로그 수동 선택 — §0 D10)
          folder_path   ← ★ v2.3. 회의 폴더 체인을 root-first 배열로 (모델 체인이 leaf-first면 뒤집을 것)
                          폴더가 없으면 [] (= 팀 루트). 미전송(키 부재)과 [] 는 다른 뜻이다 — §4.2
          title         ← ★ v2.3. **접두 없는 원제목 그대로** (다이얼로그 수정 가능 — §0 D10 개정)
                          ※ folder_path를 보내지 않는 구버전 경로에서만 "<하위폴더명>-<원제목>" 유지
          body_markdown ← 1의 markdown (KST 그대로 — D'Flow는 보정하지 않음 §4.5)
          meeting_id    ← (선택) v1 미전송 (또박또박 v1 범위 제외)
          external_id   ← "ddobak:<meeting.public_uid>"
          on_conflict   ← replace
   └─ 4. 응답의 folder_id·folder_path를 전송 다이얼로그에 표시 (★ v2.3 필수 — §4.3)
          folder_id: null 이면 "미분류로 등록됨"으로 안내. "팀 루트"라고 말하지 말 것
```

### 10.1 public_uid / external_id 규칙 (정밀 정의)

- **정의**: `meetings.public_uid` = 회의당 1개의 **UUIDv7** (RFC 9562), 소문자 36자, `SecureRandom.uuid_v7`로 생성. nullable(미전송 회의는 null), 로컬 DB unique index. `external_id = "ddobak:" + public_uid` (§4.6 계약 형식).
- **왜 UUIDv7**: 전역 유일(서버 다중 운영·DB 백업 복제·리셋과 무관) + 시간순 정렬 가능(디버깅 편의). `설치ID+정수id` 조합은 백업 복제·autoincrement 재사용 시 충돌하므로 기각. 키에 제목·날짜 등 **편집 가능한 값 포함 금지**.
- **발급 시점**: 최초 전송 시(lazy). backfill 불필요.
- **발급 순서 (불변 규칙)**: ① `SecureRandom.uuid_v7` 생성 → ② 로컬 DB **커밋** → ③ D'Flow 전송. 전송을 먼저 하면 "전송 성공 후 로컬 저장 전 크래시" 시 다음 전송에서 새 uuid가 발급돼 D'Flow에 중복이 생긴다. 커밋 후 전송이면 재시도가 항상 같은 키를 재사용해 upsert로 안전.
- **불변성**: 한번 발급된 public_uid는 회의 수정·재전송·제목 변경과 무관하게 유지. 변경되는 경로는 §10.2의 명시적 수동 조작뿐.

### 10.2 이미 존재하는 회의록과의 연결 (수동 관리)

또박또박 회의 상세의 "D'Flow 연동" 관리 화면에서 처리하는 4가지 시나리오:

| 시나리오 | 상황 | 절차 |
|---|---|---|
| **A. uid 소실 복구** | D'Flow엔 올라가 있는데 또박또박 로컬 DB 재설치·복원으로 public_uid가 사라짐 | D'Flow 목록 검색(`GET /minutes?date_from=&team=` — 또박또박 백엔드가 프록시) → 해당 레코드 선택 → 그 레코드의 `external_id`(`ddobak:<uuid>`)에서 uuid를 **또박또박 public_uid로 역주입** 저장. 이후 재전송 = replace |
| **B. 수동 업로드분 연결** | 연동 전에 D'Flow UI로 손 업로드한 회의록(external_id null)을 또박또박 회의와 연결 | 목록 검색(`linked=false` 필터) → 선택 → 또박또박이 public_uid 발급(§10.1 순서)·저장 → **`POST /minutes/link`** 호출로 그 레코드에 external_id 부여 → 이후 재전송 = replace |
| **C. uuid 직접 입력** | 사용자가 external_id 값을 알고 있음 (예: D'Flow 담당자가 알려줌) | UUID 형식 검증 → `GET /minutes?external_id=` 존재 확인 → public_uid로 저장. 존재하지 않으면 경고(저장은 허용 — 다음 전송 시 신규 생성됨) |
| **D. 재발급/해제** | 잘못 연결됨, 새 레코드로 보내고 싶음 | "연결 해제"(public_uid → null) 또는 "재발급"(새 uuid). **경고 필수**: 다음 전송이 D'Flow에 **새 레코드를 생성**하며 기존 레코드는 남는다(고아). 기존 레코드 정리는 D'Flow에서 수동 삭제 |
| **E. D'Flow 쪽에서 초기화됨** ★ v2.3 | D'Flow 사용자가 그 회의록의 연결을 초기화(`external_id` → null)함. 또박또박은 여전히 "연결됨"으로 보임 | 존재 확인이 0건이면 **그 상태로 재전송하지 말 것**(중복 레코드 생성 + 원본 고아). `linked=false` 목록에서 그 회의록을 찾아 **`POST /minutes/link`로 재연결**한 뒤 재전송한다. ⚠️ **0건이 곧 초기화는 아니다** — 보관·삭제도 0건이므로 `include_archived=true`로 구분할 것(§5.1). 상세 = **§4b-1** |

원칙: **연결 상태의 진실은 또박또박 `public_uid`가 아니라 "D'Flow에 같은 external_id 레코드가 있는가"다.** 관리 화면은 열릴 때마다 `GET /minutes?external_id=`로 실제 존재를 확인해 표시한다(로컬 값만 믿지 않음). **v2.3부터 이 확인은 `include_archived=true`로 한다** — 보관을 초기화로 오진하지 않기 위해서다(§5.1).

**또박또박 측 추가 구현 목록** (상세는 `ddobak-dflow-sender-spec.md`):
- `meetings.public_uid` 컬럼 (nullable uuid)
- 설정: D'Flow URL·시크릿 (관리자) — 폴더 매핑 설정은 없음(자동 규칙 §0 D10)
- 전송은 Rails 백엔드에서 (시크릿 서버 보관)
- 사용자 이메일 불일치(403 `unknown_user`) 시 UI 안내: "D'Flow에 동일 이메일 계정 필요"

## 11. OpenAPI 3.1 요약

```yaml
openapi: 3.1.0
info: { title: D'Flow Minutes API, version: "2.0-draft" }
servers: [ { url: https://wbs-web.vercel.app/api/v1 } ]
components:
  securitySchemes:
    serverSecret: { type: http, scheme: bearer, description: "MINUTES_API_SECRET (env)" }
  schemas:
    Minute:
      type: object
      properties:
        ok: { type: boolean }
        id: { type: string, format: uuid }
        action: { type: string, enum: [created, replaced, skipped] }
        title: { type: string }
        date: { type: string, format: date }
        team: { type: string, enum: [PMO, ERP, MES, 가공, MDM] }
        folder_id: { type: [string, "null"], format: uuid, description: "v2.3. null = 미분류(편철 실패, 등록은 성공)" }
        folder_path:
          type: [array, "null"]
          items: { type: string }
          description: "v2.3. 실제 편철 결과(root-first). null = 미분류. []는 응답에 나오지 않는다 — §4.3"
        meeting_id: { type: [string, "null"], format: uuid }
        external_id: { type: string }
        created_by_name: { type: [string, "null"] }
        url: { type: string, format: uri }
        created_at: { type: string, format: date-time }
        updated_at: { type: string, format: date-time }
    Error:
      type: object
      properties:
        error: { type: string }
        code: { type: string }
security: [ { serverSecret: [] } ]
paths:
  /minutes:
    post:
      summary: 회의록 생성/갱신 (upsert by external_id)
      requestBody:
        content:
          application/json:
            schema:
              type: object
              required: [user_email, date, team, title, body_markdown, external_id]
              properties:
                user_email: { type: string, format: email }
                date: { type: string, format: date }
                team: { type: string, enum: [PMO, ERP, MES, 가공, MDM] }
                title: { type: string, maxLength: 200 }
                body_markdown: { type: string, maxLength: 100000 }
                external_id: { type: string, maxLength: 128 }
                meeting_id: { type: string, format: uuid }
                folder_path:
                  type: array
                  items: { type: string, minLength: 1, maxLength: 60 }
                  description: "v2.3. root-first. 키 부재/[]/비어있지 않은 배열이 3값 — §4.2. 정규화·편철 = §4.7"
                on_conflict: { type: string, enum: [replace, skip, error], default: replace }
      responses:
        "201": { description: created, content: { application/json: { schema: { $ref: "#/components/schemas/Minute" } } } }
        "200": { description: replaced/skipped, content: { application/json: { schema: { $ref: "#/components/schemas/Minute" } } } }
        "403": { description: unknown_user — user_email에 해당하는 D'Flow 계정 없음 }
        "4XX": { description: error, content: { application/json: { schema: { $ref: "#/components/schemas/Error" } } } }
    get:
      summary: 존재/동기화 확인
      parameters:
        - { name: external_id, in: query, schema: { type: string } }
        - { name: date_from, in: query, schema: { type: string, format: date } }
        - { name: date_to, in: query, schema: { type: string, format: date } }
        - { name: team, in: query, schema: { type: string } }
        - { name: linked, in: query, schema: { type: boolean }, description: "true=external_id 있는 것만, false=없는 것만(연결 후보)" }
        - { name: include_archived, in: query, schema: { type: boolean, default: false }, description: "v2.3. true면 보관분 포함. 기본 false = 종전 동작" }
        - { name: page, in: query, schema: { type: integer, default: 1 } }
        - { name: per_page, in: query, schema: { type: integer, default: 20, maximum: 100 } }
      responses: { "200": { description: "list — items[]에 archived(boolean) 포함 (v2.3)" } }
  /minutes/meta:
    get:
      summary: 구분·프로젝트(·회의) 목록 + 제한값
      parameters:
        - { name: project_id, in: query, schema: { type: string, format: uuid }, description: "지정 시 해당 프로젝트의 meetings 포함" }
      responses: { "200": { description: meta } }
  /minutes/link:
    post:
      summary: 기존 회의록에 external_id 부여 (수동 연결)
      requestBody:
        content:
          application/json:
            schema:
              type: object
              required: [user_email, minute_id, external_id]
              properties:
                user_email: { type: string, format: email }
                minute_id: { type: string, format: uuid }
                external_id: { type: string, maxLength: 128 }
      responses:
        "200": { description: linked (멱등 — 같은 값 재호출 포함) }
        "404": { description: minute_id 불존재 }
        "409": { description: link_conflict — 이미 다른 external_id 보유 또는 값이 타 레코드에 사용 중 }
  /minutes/folder:
    post:
      summary: 일괄 재편철 (배치 · v2.3 신설 — §4c)
      requestBody:
        content:
          application/json:
            schema:
              type: object
              required: [user_email, items]
              properties:
                user_email: { type: string, format: email }
                dry_run: { type: boolean, default: true, description: "필드 부재 = dry run" }
                overwrite_manual: { type: boolean, default: false }
                items:
                  type: array
                  maxItems: 200
                  description: "빈 배열도 유효 요청 — 실행 계정 검증 프로브 (§4c.4-9)"
                  items:
                    type: object
                    required: [external_id, folder_path]
                    properties:
                      external_id: { type: string, maxLength: 128 }
                      team: { type: string, description: "선택. 생략 시 회의록의 기존 team_code 사용" }
                      folder_path: { type: array, items: { type: string, minLength: 1, maxLength: 60 } }
      responses:
        "200": { description: "summary + results[] (status = moved|already_correct|skipped|not_found|failed — §4c.3)" }
        "400": { description: "validation_failed — items 200건 초과 등" }
        "403": { description: unknown_user }
```

## 12. 구현 힌트 (D'Flow, 실코드 기반)

```ts
// src/app/api/v1/minutes/route.ts — 기존 관례 조합
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { validateMinuteInput } from '@/lib/domain/minutes'
// 시크릿 검증: api/chat/index/worker/route.ts의 sha256+timingSafeEqual 유틸 추출 재사용

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  // 1) env 게이트 — 미설정 시 404 (worker route 패턴)
  // 2) Bearer 시크릿 상수시간 대조 — 실패 401
  // 3) req.json() try/catch — 실패 400 (기존 관례: zod 없이 수동 타입가드)
  // 4) user_email → auth.users 조회 (lower/trim, deleted_at null) — 없으면 403 unknown_user
  // 5) validateMinuteInput 재사용 + title 필수 — 실패 400
  //    ⚠️ correctMinuteBodyTime 호출 금지 (이중 +9h 보정 방지, timeFix.ts:13 주석 참조)
  // 6) meeting_id 있으면 존재 확인 — 없으면 400
  // 7) external_id로 사전 select → 없으면 insert / 있으면 on_conflict 분기
  //    (replace = §0 D3 범위 update, skip = 기존 반환, error = 409)
  //    ⚠️ admin.from('minutes').upsert({...}, { onConflict: 'external_id' }) 사용 금지 —
  //    부분 unique 인덱스(where external_id is not null)는 ON CONFLICT (external_id) 대상 추론에
  //    매칭되지 않아 42P10 에러로 실패한다 (supabase-js onConflict는 index predicate 지정 불가)
  // 8) after(): ingestMinute + generateMinuteInsights (+replace 시 rematchMinuteHighlights 선행)
  //    ※ rematchMinuteHighlights는 비-export(actions/minutes.ts:45) — §9.2 참조 (export 승격 또는 복제)
  // 9) NextResponse.json({ ok: true, id, action, ... }, { status: created ? 201 : 200 })
}
```

- 컬럼 매핑: `date→minute_date`, `team→team_code`, `title→title`, `body_markdown→body_md`, `meeting_id→meeting_id`, `external_id→external_id`(신규).
- 응답 `url`: `${origin}/minutes/${id}`.
- 에러는 전부 `NextResponse.json({ error, code }, { status })` — 레포 평면 관례 유지.

## 13. 단계

| 단계 | 범위 |
|---|---|
| **v1 (최소)** | **MDM 팀 추가(§9.8, 선행)**, POST /minutes (JSON), POST /minutes/link, GET /minutes?external_id=, GET /minutes/meta, env 시크릿 + 이메일 매칭 인증, `external_id` 마이그레이션, 시간 보정 미적용, 후처리 파이프라인 |
| **v1.2 (= 본 v2.3 개정 범위 · 현재 차수)** | `folder_path` 편철(§4.2·§4.7) + 응답 `folder_id`·`folder_path` 에코(§4.3) + `replace` 폴더 동기화(3값 규약) + **POST /minutes/folder** 일괄 재편철(§4c) + `GET /minutes`의 `include_archived`·`archived`(§5.1) + D'Flow UI 연결 초기화(§4b-1) + 제목 접두 폐지(§0 D10).<br>**스키마 마이그레이션 없음** — `folder_id`는 기존 컬럼이고 메타 갱신 allowlist에도 이미 있다. **v1.1보다 먼저 배포된다** |
| v1.1 | multipart 첨부(개당 20MB·10개), GET /minutes/{id}, `external_meta jsonb`(발신 서버 추적 등), body 파일 서버 합성 |
| v2 후보 | 사용자별 PAT 발급 UI(테이블+해시+revoke), rate limit, 웹훅, 삭제 API |

v1만으로 또박또박 자동 등록 흐름은 완성된다.

---

## 14. 통합 적용 순서와 E2E 검증 (양측 공통)

양측이 **동시에 개발**하고, 적용은 아래 순서로 한 번에 통합한다. D'Flow는 env 미설정 시 API 전체가 404이므로 **먼저 배포해도 아무 것도 노출되지 않는다** — 순서 의존성이 느슨해 안전하다.

### 14.1 적용 순서

1. **[D'Flow]** 마이그레이션 **0034 + 0035(MDM, §9.8)** 적용 + 코드 배포 (env는 아직 미설정 → 라우트 404, 무해)
2. **[D'Flow]** vitest 통과 확인 (§9.6 — 특히 시간 무보정 케이스)
3. **[D'Flow]** Vercel env 설정 (`MINUTES_API_ENABLED=true`, `MINUTES_API_SECRET=...`) 후 재배포
4. **[공통]** 아래 curl 스모크 4종 실행 (또박또박 없이 API 계약만 검증)
5. **[또박또박]** 설정 화면에 D'Flow URL·시크릿 입력 (매핑 구성 없음 — 자동 규칙)
6. **[공통]** E2E 시나리오 (14.3)
7. 이상 없으면 완료. 문제 시 D'Flow env만 지우면 즉시 전체 차단(롤백 불필요)

> **v2.3 — `folder_path` 차수의 순서 1줄 (§0 D18)**: 이 차수에서는 **기존 전송분 일괄 재편철(§4c)이 또박또박의 전송 전환(접두 제거 + `folder_path` 전송)보다 앞선다.** 전송 전환이 먼저 나가면 "하위 폴더에 있지만 사람이 옮긴 게 아닌" 회의록이 쌓여 §4c.5의 `manual_placement` 판정이 무너지기 때문이다. 따라서 D'Flow는 **배치 엔드포인트(§4c)를 `folder_path` 코어와 함께(또는 먼저) 배포**한다.
> **차수표의 정본은 본 문서가 아니다** — D'Flow 작업지시 `dflow-folder-path-worklist-2026-07-27.md` §11.2를 따른다. 본 문서는 계약(필드·의미·에러)만 규정한다.

### 14.2 curl 스모크 (D'Flow 단독 검증 — 팀장이 실행)

```bash
BASE=https://wbs-web.vercel.app/api/v1
SECRET=<MINUTES_API_SECRET>
EMAIL=<D'Flow에 실존하는 계정 이메일>

# S1. 인증 실패 → 401
curl -si $BASE/minutes/meta -H "Authorization: Bearer wrong" | head -1

# S2. meta → 200, teams 5종(MDM 포함) + projects + limits
curl -s $BASE/minutes/meta -H "Authorization: Bearer $SECRET"

# S3. 미지 이메일 → 403 {"code":"unknown_user"}, 레코드 미생성
curl -si -X POST $BASE/minutes -H "Authorization: Bearer $SECRET" -H "Content-Type: application/json" \
  -d '{"user_email":"nobody@nowhere.test","date":"2026-07-19","team":"PMO","title":"스모크_260719","body_markdown":"# t","external_id":"smoke:auth-test"}' | head -1

# S4. 생성 → 201 created / 같은 요청 재실행 → 200 replaced / GET ?external_id= 로 1건 확인
curl -s -X POST $BASE/minutes -H "Authorization: Bearer $SECRET" -H "Content-Type: application/json" \
  -d '{"user_email":"'$EMAIL'","date":"2026-07-19","team":"PMO","title":"스모크_260719","body_markdown":"# 스모크","external_id":"smoke:e2e-1"}'
curl -s "$BASE/minutes?external_id=smoke:e2e-1" -H "Authorization: Bearer $SECRET"
# 확인 후 D'Flow UI에서 스모크 레코드 수동 삭제
```

### 14.3 E2E 시나리오 (양측 연동)

| # | 시나리오 | 기대 결과 |
|---|---|---|
| E1 | 또박또박에서 회의록 최초 전송 | 201 `created` · D'Flow `/minutes` 목록·**트리 뷰의 의도한 구분/회의체 폴더**에 표시 · 작성자 = 전송 사용자 · 본문 `**시간**:` 값이 또박또박 원본과 **정확히 일치**(+9h 밀림 없음) · 또박또박 `meetings.public_uid` 저장됨 |
| E2 | 또박또박에서 회의록 수정 후 재전송 | 200 `replaced` · 중복 레코드 없음 · 본문 갱신 · 작성자 불변 · D'Flow AI 챗/검색이 새 본문 반영(임베딩 재색인) |
| E3 | D'Flow에 없는 이메일 사용자로 전송 | 403 `unknown_user` · D'Flow에 레코드 미생성 · 또박또박 UI에 "D'Flow에 동일 이메일 계정 필요" 안내 |
| E4 | D'Flow에 수동 업로드했던 회의록을 또박또박에서 검색·연결(claim) 후 재전송 | link 200 `linked` · 이후 전송이 그 레코드를 replace (중복 미생성) · 트리 위치는 갱신된 제목 기준 |
| E5 | 회의 tgz export → 다른 또박또박 인스턴스 import → 재전송 | public_uid 보존 · 재전송이 기존 D'Flow 레코드 replace (신규 생성 없음) |
| **E6** ★v2.3 | `folder_path`를 실어 전송 (3단 이상 · 자유 루트 · `[]` 각 1건) | 201 `created` · D'Flow 탐색기의 **같은 경로**에 편철(자유 루트는 팀 루트 아래로 한 칸 내려감) · 응답 `folder_path`가 **실제 편철 결과**와 일치 · **제목에 `<하위폴더명>-` 접두 없음** · 자동 생성 폴더의 소유자가 전송 사용자 |
| **E7** ★v2.3 | `folder_path` 없이 재전송 / `[]`로 재전송 | 전자 = 폴더 위치 **유지**, 후자 = **팀 루트로 되돌아감** (3값 규약 §4.2) |
| **E8** ★v2.3 | 기존 전송분을 `POST /minutes/folder`로 dry-run → apply → 같은 요청 재실행 | dry-run은 **아무것도 이동하지 않음** · apply 후 `minute_versions` 행 수·`updated_at` **불변**, 위키 잡 신규 **없음** · **재실행 dry-run에서 방금 옮긴 건이 `already_correct`**(`skipped(manual_placement)` 아님) |
| **E9** ★v2.3 | D'Flow에서 회의록 **보관** 후 또박또박이 존재 확인 | `include_archived=true`로 **1건 + `archived: true`** · 또박또박이 **"보관됨 — 복원 후 재시도"** 안내(“초기화됨”으로 오진하지 않음) |
| **E10** ★v2.3 | D'Flow에서 **연결 초기화** → 또박또박 [D'Flow에서 찾기] 재연결 | `external_id` null → `linked=false` 목록에 노출 → `POST /minutes/link` 200 `linked` · 본문·`updated_at` 불변 · 이후 재전송이 그 레코드를 replace(중복 미생성) |

### 14.4 계약 준수 체크리스트 (양측 개발 완료 선언 전 각자 확인)

- [ ] D'Flow: §9.6 테스트 11케이스 green, API 작업은 기존 파일 무수정(rematch는 lib 복제 — v2.2 C4; F6 MDM 추가는 별도 범위) 확인 (`git diff --stat`)
- [ ] D'Flow: 시크릿이 로그에 찍히지 않음 (요청 로깅 시 Authorization 헤더 마스킹)
- [ ] 또박또박: uuid 발급 → 로컬 커밋 → 전송 순서 준수 (§10), 재시도가 같은 `external_id` 재사용
- [ ] 또박또박: 100,000자 사전 검사, 초과 시 미전송+안내 (§0 D2)
- [ ] 또박또박: 시크릿은 서버(Rails credential/env)에만, 프런트 미노출
- [ ] 공통: 필드명·에러 코드가 본 문서 §4·§6과 문자 단위 일치

**v2.3 추가분**

- [ ] D'Flow: **`folder_path` 미전송 요청이 v2.2와 동일하게 동작**(회귀 없음) — 하위호환이 이 개정의 전제다
- [ ] D'Flow: 자동 생성 폴더의 `created_by`가 **전송 사용자**(시드 표식 `null` 아님), **루트 폴더는 생성되지 않음**, 동시 전송 2건에 폴더 중복·500 없음(§4.7-6)
- [ ] D'Flow: 등록 경로와 배치 경로가 **같은 경로 해석 함수**를 공유(§4c.4-1) — 정규화 구현이 둘이 아님
- [ ] D'Flow: 배치가 `updated_at`·버전·위키를 건드리지 않음, `items: []`가 **200**(400 아님), 불량 계정 + `items: []`가 **403**(게이트가 페이로드 검증보다 먼저)
- [ ] 또박또박: 응답 `folder_path`를 전송 다이얼로그에 **표시(필수)**, 타입은 **`string[] | null`**, `folder_id: null`을 "팀 루트"로 안내하지 않음
- [ ] 또박또박: 폴더명 **61자 이상 사전 차단**(D'Flow 400 원문 노출 금지), 경로 조립이 **root-first**(모델 체인이 leaf-first면 뒤집었는지)
- [ ] 또박또박: 존재 확인에 **`include_archived=true`** 사용, `archived: true`를 "초기화됨"으로 안내하지 않음
- [ ] 공통: 또박또박 측 계약 사본이 **본 문서 v2.3으로 동기화**됨(상단 「사본 관계」 — 정본은 wbs-web 사본)
