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
  - 여기서 `STAGING_REF`, `STAGING_URL`, `PROD_DSN_KEY`, `STAGING_DSN_KEY` 가 정의된다.

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
npm run staging:sync --yes         # 프롬프트 + 활성 접속 가드 함께 우회 (자동화 전용)
```

**동작**:
- 운영 PostgreSQL (`DFlow Prod Reader` DSN 의 `staging_reader` 역할) 에서 **전체 테이블 읽기** (RLS 정책은 `bypassrls` 로 무시)
- 스테이징 (`DFlow Staging DB` DSN) 을 초기화하고 데이터 쓰기
- **매번 초기화이므로** 스테이징에서 한 작업은 다음 sync 때 사라진다

**첨부파일**:
- 실체(파일 내용) 는 복사되지 않음 — S3/R2  파일 목록만 복제되어 404 가 정상
- 임베딩 벡터(`pgvector`) 는 자동 생성됨 (스펙대로 sync 스크립트가 RPC 호출)

**제약 및 주의**:
- **UAT 진행 중에는 금지** — 활성 접속이 있으면 프롬프트로 경고한다. 조율 없이 실행하면 테스트 데이터 손실.
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

**규칙**: 마이그레이션은 절대 운영에서 **첫 실행이 아니다.** 필수 순서는:

1. **스테이징 리허설** (npm run staging:sync → npm run db:apply --target staging)
2. **검증** (스테이징 배포 후 쿼리·로직 테스트)
3. **Staging-verified 트레일러 추가** (커밋 단위가 아니라 push 범위 단위)
4. **스테이징 배포 후 앱 통합 검증**
5. **운영 적용** (npm run db:apply --target prod)
6. **운영 배포 및 smoke:prod**

### Step 0: 마이그레이션 파일 작성

새 마이그레이션 파일을 `supabase/migrations/` 에 생성:

```
supabase/migrations/00NN_descriptive_name.sql
supabase/migrations/00NN_descriptive_name_rollback.sql   # 2026-07-28 이후 필수
```

> **rollback 파일 규칙**: 2026-07-28 이후 모든 정방향 마이그레이션은 대응하는 `_rollback.sql` 을 강제한다. 테스트가 검증한다.

### Step 1: 스테이징 sync

```bash
npm run staging:sync                 # 운영 데이터를 스테이징에 복제
```

**활성 접속이 있으면 프롬프트가 나온다.** 무시하고 진행하면 사용자가 작업하던 데이터가 손실되므로 조율할 것.

### Step 2: 스테이징 적용 (워킹트리 파일)

마이그레이션을 **커밋하지 말고** 워킹트리 파일 상태로 적용:

```bash
npm run db:apply -- supabase/migrations/00NN_descriptive_name.sql --target staging
```

**출력**:
- 성공: SQL 쿼리 실행 결과 표시
- 실패: 에러 메시지 (예: 문법 오류, 제약 위반)

### Step 3: 스테이징에서 검증

```bash
git switch staging && git merge origin/main
git push origin staging                       # 앱 배포
# https://dflow-staging.vercel.app 에서 눈으로 검증
```

**확인 사항**:
- 쿼리가 정상 작동하는가 (스튜디오 또는 앱)
- 로직이 새 스키마와 호환하는가
- 데이터 백필이 정상인가

### Step 4: Staging-verified 트레일러 추가

**중요**: 트레일러는 **커밋 단위가 아니라 push 범위 단위**로 검사된다.

- 0072 이상의 마이그레이션만 G4 가드에 걸린다.
- 이미 staging 브랜치에 push 된 커밋이라면 새 커밋을 만들어 트레일러를 추가:

```bash
git commit --allow-empty -m "마이그레이션 스테이징 리허설" \
  --trailer "Staging-verified: 2026-08-11 db 리허설 통과"
git push origin staging
```

**트레일러 형식**: `Staging-verified: YYYY-MM-DD db 리허설 통과` (날짜와 "db 리허설 통과" 고정)

### Step 5: 스테이징 앱 검증

```bash
# staging 브랜치가 이미 배포된 상태
# https://dflow-staging.vercel.app 에서 앱 통합 테스트
```

### Step 6: 운영 적용

```bash
npm run db:apply -- supabase/migrations/00NN_descriptive_name.sql --target prod
```

**주의**: `--target prod` 는 대화형으로 ref 를 입력하도록 요구한다. `--yes` 플래그는 무시되므로 **손수 입력해야 한다.**

### Step 7: 운영 배포

```bash
git add supabase/migrations/00NN_descriptive_name*.sql
git commit -m "마이그레이션: <설명>"    # 트레일러는 이미 포함됨
git push origin main
```

### Step 8: 검증

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

스테이징에 실수로 잘못된 데이터나 커밋이 들어왔을 때.

### 원칙

1. **revert**: 잘못된 커밋을 되돌린다. 히스토리 보존, 가장 안전.
   ```bash
   git log --oneline origin/staging..HEAD           # 스테이징만의 커밋
   git revert <범인-sha>
   git push origin staging
   ```

2. **Vercel Instant Rollback** (빠름, 코드 변경 0)
   ```bash
   vercel rollback <직전-배포-URL> --yes
   vercel rollback status dflow-staging
   ```

3. **force push는 금지** — 병렬 세션의 커밋이 소리 없이 사라진다.

### 대규모 오염 (전 세션 공지 후)

예: 스테이징 DB 를 실수로 운영으로 덮어씀

```bash
git switch staging && git reset --hard origin/main   # staging = main 동기화
git push --force origin staging                      # 주의: 병렬 작업 있나 확인
npm run staging:sync                                 # DB 재복제
```

**force push 전에 전 팀에 공지하고, 실행 후 `staging:sync` 로 DB 를 다시 초기화할 것.**

---

## 8. 스테이징 재구축 (프로젝트를 날렸을 때)

Supabase 프로젝트 자체를 삭제하고 새로 만들어야 할 경우 (거의 없음, 응급 절차).

### Step 1: 스테이징 Supabase 재생성

Task 1~2 의 체크리스트를 다시 수행:

- [ ] Supabase 대시보드에서 새 프로젝트 생성 (`dflow-staging`, ap-northeast-2)
- [ ] **Site URL**: `https://dflow-staging.vercel.app` 설정
- [ ] **Redirect 허용 목록**: `https://dflow-staging.vercel.app`, `https://localhost:3000`
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

봇 기능이 필요할 때까지:
- `GEMINI_API_KEY_STAGING` 환경변수는 설정되지 않음
- 챗봇 도구 중 AI 기반 기능은 결정형 폴백으로 동작 (도움말 제시 등)

발급 후 Vercel 환경변수 설정:

```bash
vercel env add GEMINI_API_KEY_STAGING --project dflow-staging
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
