# 스테이징 운영 runbook

> 이 문서의 존재 이유: 스테이징 환경은 프로덕션 데이터를 복제하여 UAT 및 마이그레이션 리허설을 하는 유일한 공간이다. 좌표를 모르거나 프로세스를 빠뜨리면 운영 데이터가 오염되거나 배포가 실패한다.
>
> 마이그레이션은 절대 운영에서 첫 실행이 아니다. 스테이징에서 리허설하고 증명서(Staging-verified 트레일러)를 남긴 뒤 운영으로 진행한다.

---

## 1. 좌표

### 스테이징 Supabase

- **ref**: `abtyahghvvkcriawffty` (무료 조직 `dflow-staging`, ap-northeast-2, Postgres 17)
- **URL**: https://dflow-staging.vercel.app
- **키체인 항목**:
  - `"DFlow Staging DB"`: 스테이징 Postgres DSN (host 는 `aws-0` — 운영 pooler `aws-1` 과 다름)
  - `"DFlow Prod Reader"`: 운영 읽기 전용 `staging_reader` 역할의 DSN (sync 용)
  - `"Supabase CLI"`: Management API 토큰 (`go-keyring-base64:` 인코딩)
- **좌표 정본**: `scripts/lib/staging.config.mjs`
  - 실제 exports: `PROD_REF`, `STAGING_REF`, `POOLER_HOST`(스테이징용 aws-0 풀러) 셋뿐
  - 키체인 서비스명(`"DFlow Staging DB"` 등)은 스크립트(`staging-sync.mjs`, `db-apply.mjs`) 내 리터럴 문자열로 정의됨

### Vercel 스테이징

- **프로젝트**: `dflow-staging`
- **Production Branch**: `staging` (Ignored Build Step: `[ "$VERCEL_GIT_COMMIT_REF" != "staging" ]` 로 자동 필터링)
- **배포 트리거**: `git push origin staging` → Vercel 자동 배포 → `https://dflow-staging.vercel.app` 반영

---

## 2. 일상 흐름

### 일반 작업 → staging → 검증 → main → production

```
작업 → git add · commit
  ↓
git switch staging && git merge origin/main  # origin/main 최신 반영(스테이징이 뒤처진 경우)
  ↓
git merge <작업 브랜치 또는 main>         # feature 를 staging 에 먼저 병합
  ↓
git push origin staging                       # Vercel 자동 배포
  ↓
https://dflow-staging.vercel.app 에서 검증/UAT
  ↓
git switch main && git merge staging          # staging 을 main 으로
  ↓
git push origin main                          # 프로덕션 배포
  ↓
npm run smoke:prod                            # 프로덕션 검증
  ↓
npm run mark:good                             # known-good 태그
```

**핵심**: staging 은 main 의 "무대 리허설"이다. 거기서 운영 데이터가 손상되거나 배포가 실패하면 프로덕션 직진을 막을 수 있다.

---

## 3. 데이터 동기화

### `npm run staging:sync` — 운영 → 스테이징 단방향 복제

```bash
npm run staging:sync               # 표준 실행 (활성 접속 중이면 프롬프트)
npm run staging:sync -- --yes      # 프롬프트 + 활성 접속 가드 함께 우회 (자동화 전용; npm은 `--` 뒤 인자만 스크립트에 전달)
```

**동작**:
- 운영 PostgreSQL (`DFlow Prod Reader` DSN 의 `staging_reader` 역할) 에서 **전체 테이블 읽기** (RLS 정책은 `bypassrls` 로 무시)
- 스테이징 (`DFlow Staging DB` DSN) 을 초기화하고 데이터 쓰기
- **매번 초기화이므로** 스테이징에서 한 작업은 다음 sync 때 사라진다

**첨부파일**:
- 실체(파일 내용) 는 복사되지 않음 — S3/R2  파일 목록만 복제되어 404 가 정상
- 임베딩 벡터(`pgvector`)는 일반 컬럼 데이터로 pg_dump/restore 에 그대로 실려온다 (별도 재생성 없음)

**제약 및 주의**:
- **UAT 진행 중에는 금지** — 활성 접속이 있으면 즉시 중단한다(경고 출력). 조율 후 `npm run staging:sync -- --yes` 로 재실행.
- **대규모 마이그레이션 리허설 전에는 일정 조율** — 여러 팀이 동시에 데이터를 손상시킬 수 있다.
- `--yes` 플래그를 쓰면 **확인 프롬프트와 활성 접속 가드가 함께 무시**되므로 자동화 시나리오에서만 사용.

### staging_reader 역할 재생성

운영 DB 에서 `staging_reader` 를 삭제하거나 암호를 초기화해야 할 때:

```sql
-- 운영 DB 접속 (superuser 또는 pg_create_role 권한자)
create role staging_reader login password '<새 비밀번호>';
grant pg_read_all_data to staging_reader;
alter role staging_reader bypassrls;
```

**3문장**이다. 두 문장만 실행하면 RLS 에 막혀 스테이징 복제가 공테이블만 보인다 (버그).

---

## 4. 마이그레이션 (G4 와 한 몸)

**규칙**: 마이그레이션은 절대 운영에서 **첫 실행이 아니다.** 스테이징에서 리허설하고 증명서(Staging-verified 트레일러)를 남긴 뒤 운영으로 진행한다.

### 마이그레이션 파일 작성

새 마이그레이션 파일을 `supabase/migrations/` 에 생성:

```
supabase/migrations/00NN_descriptive_name.sql
supabase/migrations/00NN_descriptive_name_rollback.sql   # 2026-07-28 이후 필수
```

> **rollback 파일 규칙**: 2026-07-28 이후 모든 정방향 마이그레이션은 대응하는 `_rollback.sql` 을 강제한다. 테스트가 검증한다.

### 6단계 리허설 절차

#### 1단계: 스테이징과 운영을 같은 출발점으로

```bash
npm run staging:sync               # 운영 데이터를 스테이징에 복제 (대화형 확인 프롬프트)
                                   # 자동화에서만 -- --yes (확인 프롬프트+활성 접속 가드가 함께 꺼진다 — §3 참조)
```

**활성 접속이 있는 UAT 진행 중에는 금지** — 무시하면 사용자 데이터 손실.

#### 2단계: 워킹트리 파일로 스테이징에 리허설

마이그레이션을 **커밋하지 말고** 워킹트리 파일 상태로 적용:

```bash
npm run db:apply -- supabase/migrations/00NN_descriptive_name.sql --target staging
```

**출력**:
- 성공: SQL 쿼리 실행 결과 표시
- 실패: 에러 메시지 (예: 문법 오류, 제약 위반)

#### 3단계: 검증 후 로컬 main 에서 커밋 + 트레일러

스테이징 쿼리가 정상인지 (Supabase Studio 또는 API) 확인한 뒤, 로컬 main 브랜치에서 마이그레이션 파일만 커밋(G1 — 코드와 분리):

```bash
git switch main && git pull origin main
git add supabase/migrations/00NN_descriptive_name*.sql
git commit -m "<마이그레이션 이유>" \
  --trailer "Staging-verified: $(date +%F) db 리허설 통과"
```

**트레일러 형식**: `Staging-verified: YYYY-MM-DD db 리허설 통과` (날짜 자동, "db 리허설 통과" 고정)

#### 4단계: 스테이징 병합 → 앱 레벨 검증

```bash
git switch staging && git merge main && git push && git switch main
# https://dflow-staging.vercel.app 에서 눈으로 앱 통합 테스트
```

**확인 사항**:
- 로그인 후 흐름이 정상인가
- 새 필드/쿼리가 의도대로 동작하는가

**실패하면**: 수정 커밋을 2단계부터 쌓는다 (히스토리 재작성 금지). 2→3→4 반복.

#### 5단계: 운영 적용

```bash
npm run db:apply -- supabase/migrations/00NN_descriptive_name.sql --target prod
```

**주의**: `--target prod` 는 대화형으로 운영 ref 를 입력하도록 요구한다. 확인 프롬프트에 **운영 ref 문자열을 정확히 입력**할 것. `--yes` 플래그는 무시된다.

#### 6단계: 운영 배포

```bash
git push origin main
```

**G4 가드**: push 범위 안에 `Staging-verified:` 트레일러가 **하나라도 있으면** 통과한다.

**트레일러를 빠뜨렸으면**: no-op 커밋으로 추가:

```bash
git commit --allow-empty -m "마이그레이션 스테이징 리허설" \
  --trailer "Staging-verified: $(date +%F) db 리허설 통과"
git push origin main
```

### 배포 후 검증

```bash
npm run smoke:prod
npm run mark:good
```

---

## 5. 로컬 dev 환경 전환

기본값은 **스테이징**이다.

### 스테이징 ↔ 운영 전환

```bash
npm run env:staging              # 이 PC 의 모든 세션에서 스테이징 사용
npm run env:prod                 # 이 PC 의 모든 세션에서 운영 사용 (위험)
```

**scope**: 컨테이너화되지 않은 환경이므로 이 PC 의 **모든 claude-code 세션**에 영향.

### predev 가드

`npm run dev` 를 실행하기 전에 `predev` 훅이 환경을 검사:

- **기본(staging)**: 통과
- **운영 환경 설정됨**: 에러로 차단
  - 우회하려면: `FORCE_PROD_DEV=1 npm run dev` (위험 — 실제 고객 데이터 접근)

### npx next dev 직접 실행의 함정

```bash
npx next dev              # npm 훅 우회 — predev 미실행!
npm run dev               # 권장 — predev 실행
```

**문서에 명시할 것**: 절대 `npx next dev` 를 쓰지 말 것. 팀원들이 모르면 운영에 직진할 수 있다.

---

## 새 PC 온보딩 (predev에 처음 차단됐을 때)

merge 이후 다른 PC 의 `npm run dev` 는 `.env.local` 이 운영을 가리키면 차단된다. 절차:

### 1단계: 운영 원복용 보존

```bash
cp .env.local .env.local.prod
```

`.env.local.prod` 첫 줄에 주석 추가:

```
# ⚠ 운영 — 사용 후 npm run env:staging 복귀
```

### 2단계: 스테이징 환경파일 생성

`.env.local.example` 을 참고해 `.env.local.staging` 생성. 값 출처:

- **`NEXT_PUBLIC_SUPABASE_URL`**: `https://abtyahghvvkcriawffty.supabase.co`
- **anon/service_role 키**: 스테이징 Supabase 대시보드(조직 `dflow-staging`) → Settings → API Keys 에서 복사
  - 또는 Management API: `GET /v1/projects/abtyahghvvkcriawffty/api-keys` (키체인 "Supabase CLI" 토큰)
- **`GEMINI_API_KEY`**: 스테이징용 무료 키 (발급 전이면 빈 값 — 봇은 결정형 폴백으로 동작)
- **`SUPABASE_DB_URL` 줄은 넣지 않는다** — 운영 직결 URL 잔존 방지

### 3단계: 스테이징으로 전환 후 실행

```bash
npm run env:staging
npm run dev
```

> **주의**: `FORCE_PROD_DEV=1` 은 의도적 운영 접속 전용이다 — 온보딩 우회 수단이 아니다.

---

## 6. 무료 티어 일시정지 복구

Supabase 무료 조직은 **1주일 미사용 시 정지**(복구 가능 1년).

### 증상

- `sync` 실행: `connection refused`
- 앱 배포: `cannot connect to database`
- 이 외 모든 데이터베이스 접근 실패

### 복구

1. [Supabase 대시보드](https://supabase.com/dashboard/projects) 접속
2. `dflow-staging` 프로젝트 선택
3. **Project Settings** → **General** → **Restore** 버튼
4. 5–10분 대기 (복구 진행 중)
5. `npm run staging:sync` 로 접속 확인

### 재발 방지

- 매달 마지막 주에 `staging:sync` 를 자동화 크론으로 실행하는 것을 고려.
- 프로젝트가 정지되면 그때부터 1년 안에 복구해야 하므로 너무 방치하지 말 것.

---

## 7. staging 오염 복구

**이 절의 범위**: git 브랜치 오염만 다룬다. **스테이징 DB 자체가 오염되면** §3의 `staging:sync` 재실행으로 초기화하면 된다. (역방향 — 스테이징발 운영 DB 오염 — 은 sync가 운영에 읽기 전용 롤·쓰기 allowlist만 쓰므로 sync 경로로는 불가.)

### 원칙

1. **revert**: 잘못된 커밋을 되돌린다. 히스토리 보존, 가장 안전.
   ```bash
   git log --oneline origin/staging..HEAD           # 스테이징만의 커밋
   git revert <범인-sha>
   git push origin staging
   ```
   **쌍이 main 으로 흐르면** 수용한다 (이후 운영 배포에서 같이 리버트되므로 무해).

2. **Vercel Instant Rollback** (빠름, 코드만 되돌림)
   
   대시보드: Vercel → dflow-staging → Deployments 에서 직전 배포의 `⋯` → **Instant Rollback** → 배포 상태는 Deployments 에서 확인.

### 대규모 오염 (예외 절차)

원인 불명의 다수 커밋이 staging 브랜치에 쌓인 경우만, **전 세션 공지와 동기화 후**:

```bash
git switch staging && git reset --hard origin/main   # staging = main
git push --force origin staging                      # 예외: 여기서만 force push 허용
```

**주의**: 전 팀이 현재 진행 중인 작업을 먼저 확인하고, 공지 후 실행할 것.

### DB 오염 복구

운영 데이터 보호는 이 문서 범위 밖: `docs/runbook-rollback.md` + Supabase 일 백업 참고.

---

## 8. 스테이징 재구축 (프로젝트를 날렸을 때)

Supabase 프로젝트 자체를 삭제하고 새로 만들어야 할 경우 (거의 없음, 응급 절차).

### Step 1: 스테이징 Supabase 재생성

Task 1~2 의 체크리스트를 다시 수행:

- [ ] Supabase 대시보드에서 새 프로젝트 생성 (`dflow-staging`, ap-northeast-2)
- [ ] **Site URL**: `https://dflow-staging.vercel.app` 설정
- [ ] **Redirect 허용 목록**: `https://dflow-staging.vercel.app`, `http://localhost:3000/**`
- [ ] **이메일 발송 차단** (가짜 SMTP + rate limit):
  - Auth → Email → SMTP Settings → `127.0.0.1:2525`
  - Rate limit → `1` (0은 API 하한이므로 불가)
- [ ] **autoconfirm 활성화**: Auth → Users → Auto Confirm New Users
- [ ] **vector 확장**: Database → Extensions → `vector` (자동으로 `public` 스키마에 설치됨)

### Step 2: 키체인 갱신

새 프로젝트의 DSN 을 키체인에 저장:

- `"DFlow Staging DB"`: 새 스테이징 Postgres DSN
- `"DFlow Prod Reader"`: 운영 `staging_reader` DSN (변경 없음)
- `"Supabase CLI"`: Management API 토큰 (변경 없음)

### Step 3: 좌표 파일 업데이트

`scripts/lib/staging.config.mjs`:

```javascript
export const STAGING_REF = 'new-ref-from-dashboard';  // 새 ref
```

### Step 4: staging_reader 생성

운영 DB 에서:

```sql
create role staging_reader login password '<새 비밀번호>';
grant pg_read_all_data to staging_reader;
alter role staging_reader bypassrls;
```

### Step 5: 첫 sync

```bash
npm run staging:sync
```

### Step 6: Vercel 재설정 (필요 시)

비공식 엔드포인트로 Production Branch 를 설정한 경우, Vercel 콘솔에서 수동으로 확인:

- Project Settings → Git → Production Branch = `staging`
- Ignored Build Step: `[ "$VERCEL_GIT_COMMIT_REF" != "staging" ]`

---

## 9. GEMINI API 키 (스테이징 봇)

**상태**: 미발급 (사용자 대기)

이 프로젝트의 환경변수명은 **`GEMINI_API_KEY` 하나**다 (스코프로 구분).

봇 기능이 필요할 때까지:
- `GEMINI_API_KEY` 는 설정되지 않음
- 챗봇 도구 중 AI 기반 기능은 결정형 폴백으로 동작 (도움말 제시 등)

발급 후 세 곳에 등록:

1. **Vercel 대시보드에서**:
   - `dflow-staging` 프로젝트 → Settings → Environment Variables 에 `GEMINI_API_KEY` (Production 스코프) 추가
   - 기존 `wbs-web` 프로젝트 → Settings → Environment Variables 에 같은 이름으로 Preview 스코프 추가 (다른 키)

2. **로컬 `.env.local.staging`**:
   ```
   GEMINI_API_KEY=<발급받은키>
   ```

---

## 참고

| 항목 | 문서 · 경로 |
|---|---|
| 프로덕션 롤백 | `docs/runbook-rollback.md` |
| 마이그레이션 적용 (Management API) | MEMORY.md: `supabase-mgmt-api-recipe` |
| pre-push 훅 (G1-G4) | `.githooks/pre-push` |
| 스테이징 스크립트 | `scripts/staging-sync.mjs`, `scripts/db-apply.mjs` |
| Supabase 관리 | https://supabase.com/dashboard/projects/abtyahghvvkcriawffty |
| Vercel 배포 | https://vercel.com/dashboard/projects/dflow-staging |
