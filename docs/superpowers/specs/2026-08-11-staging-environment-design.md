# 테스트계(스테이징 환경) 구축 설계

- 작성일: 2026-08-11
- 상태: 설계 승인(사용자) — 구현 전. 기술 전제 16건 웹 검증 + 독립 비평 15건 반영(§15)
- 관련: `docs/runbook-rollback.md`, `CLAUDE.md`(git 운영·데이터 절), Supabase Management API 적용 레시피(키체인 "Supabase CLI" 토큰)

## 1. 배경과 문제

D'Flow는 운영 중인 서비스이며 기능 추가가 계속된다. 그런데 테스트 전용 환경이 없어:

- **로컬 dev가 프로덕션 Supabase를 그대로 공유한다.** 개발 중 실수가 운영 D-CUBE 데이터를 직접 훼손할 수 있다.
- **Vercel Preview에는 환경변수가 0건이다.** Preview 배포는 로그인이 안 되고, UI 위험 파일 훅(G2)은 "속도 방지턱" 이상이 되지 못한다.
- **마이그레이션이 운영 DB에 처음 적용된다.** 리허설 무대가 없다.
- 새 기능의 실화면 검증·팀 UAT를 할 곳이 없다.

목표: **운영 반영 전에 실화면·실데이터로 검증할 수 있는 상시 스테이징 환경을 추가 비용 없이 구축한다.**

## 2. 확정 전제 (사용자 결정, 2026-08-11)

| 항목 | 결정 |
|---|---|
| 비용 | 완전 무료 — Supabase 무료 조직 + Vercel Hobby 추가 프로젝트 |
| 데이터 | 운영 사본 — 덤프→복원 동기화 스크립트, 필요할 때 수동 실행 |
| 형태 | 상시 스테이징 URL(별도 Vercel 프로젝트 + `staging` 브랜치) **+** 기존 프로젝트 Preview도 스테이징 DB에 연결 |
| 강제 수준 | 위험 변경만 기계적 강제 — 마이그레이션(G4 신규)·UI 위험 파일(G2 기존). 소액 변경 main 직행은 유지 |

**용량 실측(2026-08-11, 운영 읽기 조회):** DB 전체 54MB — public 52MB(최대 minute_embeddings 12MB), auth 3.2MB, storage 메타 0.6MB. **무료 티어 500MB 한도에 여유** — 임베딩 포함 전량 복제 가능, 제외 테이블 불필요. (운영 디스크 8GB 증설은 로그·WAL 때문이었고 실데이터가 아니다.)

## 3. 목표 아키텍처

| 환경 | 코드 | DB | URL |
|---|---|---|---|
| 운영 | `main` → 기존 Vercel 프로젝트 | 기존 Supabase Pro (`rglfgrwwwwdqejohdnty`) | 기존 주소 |
| 스테이징 | `staging` → 신규 Vercel 프로젝트 | 신규 Supabase 무료 프로젝트 | `dflow-staging.vercel.app` (고정) |
| 로컬 dev | 작업 브랜치 | **스테이징 DB (기본값 전환)** | localhost |

표준 흐름:

```
작업 → staging 머지 & push → 스테이징 자동 배포 → 검증/UAT
     → main 머지 & push → 운영 배포 → smoke:prod → mark:good
```

## 4. 인프라 구성

### 4.1 Supabase 스테이징 프로젝트

- 새 **무료 조직**(제안명 `dflow-staging`)에 프로젝트 1개. 리전 ap-northeast-2, Postgres 17(운영과 동일 메이저). Pro 조직 보유 계정도 무료 조직 병존 가능(공식 확인, §15).
- 생성은 대시보드에서 수동 1회. DB 비밀번호는 키체인 항목 **"DFlow Staging DB"** 로 보관(기존 "Supabase CLI"·"DFlow Agent API" 관례와 동일).
- 무료 티어 특성: **1주 미사용 시 자동 일시정지**(대시보드 원클릭 복구, 정지 후 1년까지), DB 500MB 제한(§2 실측으로 여유 확인).
- **생성 직후 수동 설정 체크리스트** (DB 행이 아니라서 sync로 복제되지 않는 것들):
  1. Auth → Site URL = 스테이징 URL, redirect 허용 목록에 스테이징 URL 등록.
  2. **Auth 이메일 발송 차단** — 이메일 발송 rate limit을 0으로(또는 동등한 차단) + autoconfirm 활성. 이유: auth.users에 **실사용자 이메일**이 복사되는데, GoTrue 내장 메일러는 앱의 `SMTP_*` 미설정과 무관하게 동작한다. 차단하지 않으면 스테이징에서 비밀번호 재설정을 트리거할 때 실사용자에게 진짜 메일이 발송된다.
  3. 확장 `vector` 활성화(복원 전 필수 — 미준비 시 `type "vector" does not exist`로 복원 실패).

### 4.2 Vercel 스테이징 프로젝트

- 두 번째 프로젝트 `dflow-staging`을 **같은 GitHub 리포**에 연결하고, Production Branch를 `staging`으로 지정(Hobby에서 가능, 리포당 25개 프로젝트까지).
- 이 프로젝트 기준의 "Production" 배포(= `staging` 브랜치)가 상시 스테이징 URL. Hobby의 Deployment Protection(Standard)은 production 도메인을 보호하지 않으므로 별도 설정 없이 공개 — **접근 제어는 Supabase 로그인(운영 계정 사본)이 담당한다.**
- **Ignored Build Step 설정 필수**: 같은 리포가 두 프로젝트에 연결되면 모든 브랜치 push가 양쪽에서 빌드된다. 스테이징 프로젝트에 `staging` 브랜치 외 빌드를 건너뛰는 스크립트를 설정해 Hobby 동시 빌드 1개 제한의 대기열 낭비를 막는다.
- `vercel.json`(리전 icn1, crons 없음)은 리포 공유라 그대로 적용된다.
- ⚠️ **리스크 노트 — Hobby 상용 사용 제한**: Vercel Fair Use 정책상 Hobby는 비상업적 개인 용도 한정이며, 급여를 받는 직원이 만드는 사내 업무용 앱은 이 정의에 저촉될 소지가 있다. **현 운영도 이미 Hobby로 배포 중인 기존 조건**이라 이 설계가 새로 만드는 리스크는 아니지만, 장기적으로 Pro 팀 이전 검토 대상. (집행은 통상 사전 연락 후 시정 방식.)

### 4.3 기존 Vercel 프로젝트의 Preview 환경변수

- Preview 스코프에 **스테이징 Supabase** URL/키를 등록한다. 이제 어떤 브랜치의 Preview URL에서도 로그인이 되므로, G2 훅의 "Preview로는 화면 확인 불가" 한계가 해소된다.
- Preview URL의 Deployment Protection은 **요구사항이 아니다** — 기본값 그대로 두고, 접근 제어는 스테이징 URL과 동일하게 스테이징 Supabase 로그인이 담당한다.

### 4.4 환경변수 매트릭스 (스테이징 프로젝트 + 기존 프로젝트 Preview 스코프)

원칙: **"운영과 같게, 바깥으로 나가는 것만 끊는다."**

| 변수 | 스테이징 값 | 이유 |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | 스테이징 프로젝트 URL | 격리의 본체 |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | 스테이징 anon 키 | 〃 |
| `SUPABASE_SERVICE_ROLE_KEY` | 스테이징 service_role 키 | 〃 (**NEXT_PUBLIC_ 접두 없음** — 클라이언트 노출 금지) |
| `CHAT_V2_ENABLED` 등 기능 플래그 | 운영과 동일 | 같은 동작을 테스트해야 의미 있음 |
| `GEMINI_API_KEY` | **별도 무료 키 신규 발급** | 무료 RPM 20을 운영과 나누면 스테이징 테스트가 운영 429를 유발 |
| `SMTP_USER` / `SMTP_PASS` | 미설정 | 앱 발송 메일 차단 — 미설정 시 `{ok:false}` 반환하는 기존 안전 설계 활용. Auth 메일은 §4.1-2가 별도 차단 |
| `MINUTES_API_ENABLED` | 미설정 | 또박또박 연동 라우트 404(존재 은닉). 연동 테스트가 필요해지면 별도 시크릿으로만 개방 |
| `NEXT_PUBLIC_APP_URL` | 스테이징 URL | 링크 오염 방지 |
| `STAGING` (신규) | `1` | noindex 헤더 + STAGING 배지의 판정 근거. 운영·로컬에는 미설정 |

## 5. 스테이징 표시와 noindex

- `STAGING=1`이면 `next.config.ts`의 `headers()`로 전 경로에 `X-Robots-Tag: noindex` 부착(미들웨어는 이미 인증을 다루므로 건드리지 않는다).
- 운영과 화면이 똑같아 헷갈리는 것을 막기 위해 `(app)` 레이아웃 헤더에 작은 **STAGING 배지**를 표시한다. UI 위험 파일 수정을 수반하지만, 이 변경 자체가 스테이징에서 먼저 검증되고 나서 main으로 간다.

## 6. 데이터 동기화 — `npm run staging:sync`

운영 → 스테이징 **단방향 전용** 복제 스크립트(`scripts/staging-sync.mjs`). 실행할 때마다 스테이징을 운영 사본으로 초기화한다(멱등).

### 6.1 절차

1. **사전 점검**:
   - 운영 public 스키마 크기 실측 → 스테이징 500MB 한도 대비 여유 경고.
   - 운영 `pg_extension`·`pg_publication_tables` 조회 → 스테이징에 동일 확장 생성, publication 대상 기록.
   - **스테이징 `pg_stat_activity` 조회 → 활성 접속 N건 존재 시 경고 + 확인 요구** (UAT·병렬 세션 리허설 진행 중 sync가 상대 작업을 파괴하는 것 방지).
   - **advisory lock 획득** — sync·db:apply 동시 실행 배제. 획득 실패 시 중단.
2. **스테이징 `public` 재생성**: `drop schema public cascade` → 재생성 → **스키마 GRANT 복원**(`grant usage on schema public to anon, authenticated, service_role` 등 — 덤프에 스키마 레벨 GRANT가 포함되지 않을 수 있으므로 스크립트가 명시 실행).
3. **auth 교체**: `truncate auth.users cascade` — identities·sessions·refresh_tokens·mfa_* 등 파생 테이블이 함께 비워진다(의도된 초기화, 어차피 전체 사본 교체). 이후 운영 `auth.users` → `auth.identities` 순서로 insert. 주의 2건:
   - **`confirmation_token` 등 토큰류 컬럼의 NULL을 `''`로 치환**해 insert — NULL이면 로그인 시 "Database error querying schema"로 깨지는 공식 확인된 함정(§15).
   - `auth.identities` 누락 금지 — 없으면 이메일 로그인이 invalid_grant로 실패한다.
   - 결과: **본인 계정·비밀번호(bcrypt 해시)로 스테이징 로그인 가능.** JWT 시크릿이 달라 운영 세션 쿠키는 무효 — 새로 로그인하면 된다.
   - public 테이블이 auth.users를 FK 참조하므로 **public 데이터 복원(4단계)보다 먼저** 실행.
4. **`public` 복원**: 스키마+데이터 전량 — 테이블·RLS 정책·함수·트리거·GRANT가 함께 담긴다.
5. **storage**: `storage.buckets` truncate 후 운영 행 insert(멱등). `storage.objects`와 파일 실체는 제외.
6. **마무리**: `supabase_realtime` publication 대상 재등록, 시퀀스 값 확인, advisory lock 해제.

접속은 세션 풀러(Supavisor session mode, 포트 5432, IPv4 — 무료 티어 포함 제공) 경유. `pg_dump`/`psql`은 **Postgres 17 이상 클라이언트 필수**(하위 버전은 "server version mismatch"로 거부됨 — 스크립트가 버전 검사, 없으면 `brew install libpq` 안내).

### 6.2 안전장치 (이 스크립트의 핵심)

- **쓰기 대상 ref를 스테이징 ref로 하드코딩 allowlist.** 대상이 운영 ref면 무조건 거부.
- **운영 접속은 전용 읽기 전용 롤로만.** 운영 DB에 `pg_read_all_data` 권한의 LOGIN 롤(예: `staging_reader`)을 1회 생성(Management API 경유, runbook 절차)하고, sync는 그 자격증명만 사용한다 — 운영 쓰기가 자격증명 수준에서 불가능해진다.
- 실행 시 대상 프로젝트명을 실제 조회해 보여주고 확인 입력을 받는다(`--yes`로 생략 가능).
- 자격증명은 키체인("DFlow Staging DB" / "DFlow Prod Reader")에서 읽는다. 평문 커밋 금지.

### 6.3 알려진 한계 (v1)

- 파일 실체 미복사 → 스테이징에서 회의록 첨부 열람은 404가 정상. 필요해지면 파일 복사 옵션을 v2로.
- 수동 실행이다(자동 주기 동기화 없음). 마이그레이션 리허설 전·대규모 테스트 전 실행을 권장.
- `vault` 등 기타 스키마는 복제하지 않는다(현재 미사용). auth·storage 스키마에 가한 커스텀이 생기면 별도 반영 필요(현재 없음).

## 7. 마이그레이션 워크플로 — `npm run db:apply`

기존 Management API 적용 레시피를 스크립트화·파라미터화한다: `npm run db:apply -- supabase/migrations/0072_*.sql --target staging|prod`.

### 7.1 규칙(순서)

1. `staging:sync` — 스테이징을 운영 스키마와 같은 출발점으로.
2. `db:apply --target staging` — **커밋 전, 워킹트리 파일로** 스테이징 DB에 리허설.
3. 검증 후 마이그레이션 커밋에 트레일러 기록: `Staging-verified: <날짜 메모>`.
   - **트레일러가 증명하는 범위는 "스테이징 DB 리허설 통과"까지다** (앱 레벨 완료 아님).
4. `staging` push → 스테이징 URL에서 앱 레벨 검증. 여기서 실패하면 **수정 커밋을 쌓고 2~4를 반복**(히스토리 재작성 금지).
5. `db:apply --target prod` → `main` push.

커밋 전에 DB 리허설을 끝내는 이유: 트레일러는 커밋에 박히므로, 검증을 커밋 뒤로 미루면 amend/rewrite가 필요해져 병렬 세션 규칙과 충돌한다.

**db:apply 안전장치(sync와 대칭):** `--target prod`일 때는 대상 프로젝트명을 실조회해 보여주고 명시적 확인 문자열 입력을 요구한다(`--yes` 무시). staging/prod 두 ref만 허용하는 allowlist. advisory lock으로 sync·apply 동시 실행 배제.

### 7.2 훅 G4 (신규)

- **발동 조건**: push 대상이 `main`이고, `origin/main..`(origin/main에 새로 들어가는 커밋)에 `supabase/migrations/*.sql` 추가·수정이 있을 때. 머지 커밋의 자체 변경은 기존 `evil_files()` 경로를 재사용해 같은 기준으로 검사한다.
- **검사 방식 — 범위 단위**: 해당 push 범위 안의 **최소 1개 커밋**에 `Staging-verified:` 트레일러가 있으면 통과. 커밋 단위가 아니라 범위 단위인 이유: 표준 흐름상 마이그레이션 커밋은 origin/staging에 먼저 올라가 있어 amend가 불가능하다 — 커밋 단위 강제는 "고칠 수 없는 차단 → SKIP_GUARD 상습화"를 낳는다. 트레일러를 빠뜨렸다면 **빈 커밋에 트레일러를 달아** 통과시킨다(히스토리 재작성 없는 복구 경로).
- **컷오프**: 파일명 선두 번호 **0072 이상**만 검사. 이미 프로덕션에 적용됐고 병렬 세션에 미푸시로 남아 있는 0069~0071 커밋들을 소급 차단하지 않기 위한 그랜드파더링.
- 검사 범위를 기존 G1·G2의 `--not --remotes`가 아니라 `--not origin/main`으로 잡는 이유: 마이그레이션 커밋은 origin/staging에 먼저 올라가므로 `--not --remotes`로는 main push 시점에 검사망을 빠져나간다.
- rev-list 등 판정 실패 시 **fail-closed**(차단, 기존 훅 관례 상속). 긴급 우회는 기존 `SKIP_GUARD=1` 그대로. G2와 같은 성격 — 보증이 아니라 절차 리마인더다.

## 8. Git 워크플로

- `staging` 브랜치를 상시 유지한다. **staging에는 main에 갈 예정인 커밋만 올린다**(실험은 별도 브랜치 + Preview로).
- main은 소액 직행으로 수시로 독립 전진하므로 staging→main이 항상 fast-forward가 되지는 않는다 — **불변식은 이렇다**: ① staging push 전에 `origin/main`을 back-merge한다(각 세션 책임, push 전 fetch+merge — 기존 병렬 세션 관례와 동일). ② staging→main 머지에서 머지 커밋이 생기는 것은 정상이다.
- **force push 금지**(staging 포함 — 병렬 세션 보호, 기존 규칙 그대로).
- **staging 오염 복구**(main에 가면 안 되는 커밋이 실수로 올라간 경우): 원칙은 revert — revert 쌍이 main 히스토리로 흐르는 것은 수용한다. 대규모 오염 시에만 전 세션 공지·동기화를 전제로 staging 브랜치 재생성(runbook에 문서화된 예외).
- 소액 변경(오타·주석·문서)은 지금처럼 main 직행 허용. 기계적 강제는 G4(마이그레이션)·G2(UI 위험 파일) 둘뿐이고, "새 화면·신규 기능은 스테이징 URL에서 확인 후 main 머지"는 CLAUDE.md 운영 관례로 남긴다.

## 9. 로컬 dev 전환

- `.env.local` 기본값을 **스테이징 Supabase**로 바꾼다. 운영 접속은 의식적 전환으로만:
  - 소스 파일 `.env.local.staging` / `.env.local.prod`(둘 다 gitignore 확인) → `npm run env:staging` / `npm run env:prod`가 `.env.local`로 복사. 파일 첫 줄 주석에 현재 대상 표시, 스크립트가 전환 결과 출력. (`.env.local.*`는 Next.js가 자동 로드하지 않는 이름이라 안전.)
- **기계적 가드(예절에만 의존하지 않는다)**: `predev` 훅이 `.env.local`의 URL에서 **운영 ref를 감지하면 눈에 띄는 경고와 확인 절차 없이는 dev 서버를 시작하지 않는다**(의도적 운영 접속은 명시 env로만 통과). env:prod 사용 후 env:staging 복귀를 관례로 두되, 잊어도 다음 `npm run dev`가 잡아낸다.
- **스왑은 파일 교체라 병렬 세션 전체에 영향** — CLAUDE.md에 명시.

## 10. 에러 처리와 안전장치 요약

- sync: 대상 allowlist(fail-closed) + 운영은 읽기 전용 롤 자격증명 + 활성 접속 검사 + advisory lock + 대상 프로젝트명 실조회 확인.
- db:apply: staging/prod allowlist + prod는 명시적 확인 문자열(§7.1) + advisory lock.
- **운영 쓰기 경로는 db:apply `--target prod` 하나로 수렴**하고, 그 경로에 확인 절차가 있다. (sync는 자격증명 수준에서 운영 쓰기 불가.)
- 스테이징 일시정지: sync·접속 실패 시 "무료 티어 일시정지 가능성 — 대시보드에서 복구" 안내를 출력한다(에러를 삼키지 않는다 — 에러 처리 3원칙).
- 스테이징 앱에는 스테이징 키만 설정되므로 배포된 코드 경로로 운영 DB에 닿을 방법이 없다.
- 사용현황 이벤트가 스테이징 DB에도 쌓이지만 격리되어 무해(알려진 동작).

## 11. 비범위 (하지 않는 것)

- Supabase Branching(종량 과금) — 비용 전제와 어긋나 제외.
- storage 파일 실체 복사 — v2 후보.
- 자동 주기 동기화(크론) — v2 후보.
- `smoke:staging`(스모크 대상 파라미터화) — 선택 후속.
- E2E 자동화 테스트 스위트 도입 — 별도 주제.

## 12. 구축 후 검증 계획 (E2E 리허설)

1. `staging:sync` 실행 → 주요 테이블 행 수를 운영과 대조.
2. 스테이징 URL에서 본인 계정 로그인 → 대시보드·WBS·회의록·이슈 화면 조회.
3. **스테이징에서 비밀번호 재설정 시도 → 실메일이 발송되지 않는지 확인**(§4.1-2 차단 검증).
4. 더미 마이그레이션을 staging에 적용 → 확인 → 롤백(db:apply 경로 검증).
5. 소규모 UI 변경(STAGING 배지가 이 역할)을 staging 배포로 눈확인 → main 머지 → `smoke:prod`.
6. sync 스크립트에 운영 ref를 대상으로 넣어 **거부되는지** 확인(안전장치 테스트).
7. `predev` 가드: `.env.local`을 운영으로 바꾼 뒤 `npm run dev` → 경고·차단 확인.
8. 기존 프로젝트 Preview 배포에서 로그인 확인(G2 한계 해소 검증).

## 13. 구현 페이즈 (순서 제약 있음)

**페이즈 A — 인프라와 데이터 경로** (§12의 1·4·6·7 검증 포함 — 로그인 자체는 로컬 dev를 스테이징 DB로 돌려 선검증 가능)
| 작업 | 비고 |
|---|---|
| Supabase 스테이징 프로젝트 생성 + §4.1 수동 체크리스트 | 콘솔 수동 1회 |
| 운영 읽기 전용 롤 `staging_reader` 생성 | Management API 1회, runbook 기록 |
| `scripts/staging-sync.mjs` (§6) | 신규 |
| `scripts/db-apply.mjs` (§7) | 신규 — 기존 레시피 스크립트화 |
| `scripts/env-swap.mjs` + `predev` 가드 (§9) | 신규 |
| `.env.local.example` 갱신, `package.json` 스크립트 등록 | |

**페이즈 B — 배포 파이프라인과 훅** (§12의 2·3·8 검증 포함, **A 완주 후에만**)
| 작업 | 비고 |
|---|---|
| Vercel 스테이징 프로젝트 생성 + Ignored Build Step + env 매트릭스(§4.2·4.4) | 콘솔 수동 1회 |
| 기존 프로젝트 Preview env 등록 (§4.3) | 콘솔 수동 1회 |
| `staging` 브랜치 생성·초기 push | |
| `.githooks/pre-push`에 G4 추가 (§7.2) | **db:apply·runbook이 실증된 뒤 배포** — 먼저 켜면 모든 세션의 마이그레이션 push를 막는다 |
| `docs/runbook-staging.md` (생성·동기화·마이그레이션·일시정지 복구·오염 복구) | 신규 |
| `CLAUDE.md` 갱신 (§8 흐름·G4·로컬 기본값) | |

**페이즈 C — 화면 표시** (§12의 5 검증 포함)
| 작업 | 비고 |
|---|---|
| `next.config.ts` STAGING noindex 헤더 (§5) | |
| `(app)` 레이아웃 STAGING 배지 (§5) | UI 위험 파일 — staging 경유 검증 |

## 14. 수동 설정 의존 항목 (sync로 복제되지 않는 것)

| 항목 | 위치 | 시점 |
|---|---|---|
| Auth Site URL·redirect 허용 목록·이메일 차단·autoconfirm | Supabase 콘솔 | 프로젝트 생성 직후(§4.1) |
| `vector` 확장 활성화 | Supabase 콘솔/SQL | 〃 |
| Vercel 스테이징 프로젝트 env 일체(§4.4) | Vercel 콘솔 | 페이즈 B |
| 기존 프로젝트 Preview env | Vercel 콘솔 | 페이즈 B |
| Ignored Build Step | Vercel 콘솔 | 페이즈 B |
| 키체인 자격증명("DFlow Staging DB"·"DFlow Prod Reader") | 각 PC | 페이즈 A(PC마다) |
| GEMINI 스테이징용 무료 키 | Google AI Studio + Vercel env | 페이즈 B |

## 15. 검증 기록 (2026-08-11)

기술 전제 16건을 웹 교차 검증해 전부 확인(confirmed). 핵심 출처:

- 무료 조직 병존·2개 무료 프로젝트: supabase.com/docs/guides/troubleshooting/keeping-free-projects-after-pro-upgrade-Kf9Xm2
- auth 사용자 이전(비밀번호 해시 유지·JWT 차이는 재로그인만): supabase.com/docs/guides/troubleshooting/migrating-auth-users-between-projects
- `confirmation_token` NULL 함정: supabase.com/docs/guides/troubleshooting/scan-error-on-column-confirmation_token-…
- auth.identities 누락 시 로그인 실패: github.com/orgs/supabase/discussions/5248
- 백업·복원 절차(확장 선행 활성화 포함): supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore
- pg_dump 버전 규칙: postgresql.org/docs/17/app-pgdump.html
- Vercel 리포당 25 프로젝트(Hobby): vercel.com/changelog/increased-limit-for-projects-per-git-repo
- Production Branch 변경·Deployment Protection 범위·env 스코프: vercel.com/docs/git, /docs/deployment-protection, /docs/environment-variables
- Hobby 상용 제한: vercel.com/docs/limits/fair-use-guidelines#commercial-usage

독립 비평 15건(blocker 1·important 7·minor 7)은 §4.1 체크리스트, §6.1 상세화, §6.2 읽기 전용 롤, §7.2 범위 단위 검사·컷오프, §8 불변식 재기술, §9 predev 가드, §13 페이즈 분할, §14 목록화로 반영 완료.
