# WBS 웹 관리 도구

엑셀로 관리하던 프로젝트 WBS를 여러 팀이 동시에 입력하고, 진척이 자동 집계되며, 간트로 시각화되는 웹앱(MVP).

- 진척 계산(영업일·계획%·달성율·가중 롤업)은 서버의 **순수 함수**로 수행하고 단위 테스트로 검증한다.
- 권한은 **RLS + 서버 액션 재검증**으로 이중 강제한다.
- 실적%는 leaf(`activity`)에만 저장하고, 상위 레벨은 항상 가중 롤업 계산값이다.
- 가중치가 `null`이면 형제 균등(1/n)으로 간주한다.
- 날짜는 DB에 `date`로 저장하고 앱 표준 타임존은 `Asia/Seoul`이다.

## 기술 스택

- Next.js 15 (App Router, TypeScript strict), React 19
- Supabase (Postgres + Auth + RLS) — `@supabase/ssr`, `@supabase/supabase-js`
- SheetJS(`xlsx`) 엑셀 임포트
- Tailwind CSS
- Vitest (도메인 순수 함수 단위 테스트)
- Vercel 배포

## 요구 사항

- Node.js 20+
- npm
- Supabase 프로젝트(무료 플랜으로 충분)

## 1. 로컬 실행

```bash
# 의존성 설치
npm install

# 환경 변수 파일 생성 (아래 2번 참고)
cp .env.local.example .env.local
# .env.local 을 열어 실제 Supabase 값으로 채운다

# 개발 서버
npm run dev          # http://localhost:3000

# 프로덕션 빌드 / 실행
npm run build
npm run start

# 단위 테스트 (영업일·진척·롤업·트리·엑셀 파서/검증)
npm run test

# 린트
npm run lint
```

진입 동선: 미인증 사용자는 미들웨어가 `/login` 으로 리다이렉트한다. 로그인 후 `/projects` 에서 프로젝트를 선택해 WBS 보드·대시보드·설정으로 이동한다.

## 2. 환경 변수

`.env.local` 에 다음 값을 설정한다 (`.env.local.example` 참고). 모두 Supabase 대시보드 → Project Settings → **API** 에서 확인할 수 있다.

| 변수 | 용도 | 노출 범위 |
|------|------|-----------|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase 프로젝트 URL | 클라이언트/서버 |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | 익명(anon) 공개 키 | 클라이언트/서버 |
| `SUPABASE_SERVICE_ROLE_KEY` | 엑셀 임포트 서버 처리용 서비스 롤 키 | **서버 전용 (절대 클라이언트 노출 금지)** |
| `NEXT_PUBLIC_DEMO_MODE` | 데모 모드 토글 (`1`=켜짐). 미설정/`0`=정상 | 클라이언트/서버 |

```env
NEXT_PUBLIC_SUPABASE_URL=https://your-project-ref.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
NEXT_PUBLIC_DEMO_MODE=0
```

> `.env.local` 은 `.gitignore` 에 의해 커밋되지 않는다. 플레이스홀더 값으로도 `npm run build` 는 통과하지만, 실제 동작에는 위 값이 필요하다.

### 데모 모드 (Supabase 없이 둘러보기)

Supabase 프로젝트 없이 UI 전체를 둘러보려면 `.env.local` 에 `NEXT_PUBLIC_DEMO_MODE=1` 을 설정한다.

- 인증 우회 — `/login` 의 **"데모로 입장"** 버튼만 누르면 진입 (아이디/비밀번호 불필요)
- 원본 `docs/WBS-original.xlsx` 를 파싱한 샘플 데이터로 프로젝트/WBS·간트/대시보드 렌더
- 모든 쓰기(실적%·가중치·공휴일·프로젝트 생성)는 no-op (둘러보기 전용)

> ⚠️ **운영 환경에서는 절대 켜지 말 것** — 인증이 전부 우회된다. 기본값은 꺼짐(`0`)이며 코드는 이 플래그가 켜졌을 때만 데모 분기를 탄다. `src/app/preview/*` 는 Supabase·로그인 없이 컴포넌트만 확인하는 dev 전용 라우트다(미들웨어 인증 제외).

## 3. Supabase 마이그레이션 + 시드 적용

`supabase/` 디렉터리에 스키마·RLS·시드가 들어 있다. **순서대로** 실행한다.

```
supabase/
  migrations/0001_init.sql   # 테이블 + 인덱스
  migrations/0002_rls.sql    # RLS 정책 + 헬퍼 함수
  seed.sql                   # 팀 4개(PMO/DT/ERP/MES)
```

### 방법 A — Supabase 대시보드 SQL Editor (권장, 간단)

1. Supabase 대시보드 → **SQL Editor** 진입
2. `supabase/migrations/0001_init.sql` 내용을 붙여넣고 **Run**
3. `supabase/migrations/0002_rls.sql` 내용을 붙여넣고 **Run**
4. `supabase/seed.sql` 내용을 붙여넣고 **Run** (PMO/DT/ERP/MES 팀 4개 생성)

### 방법 B — Supabase CLI

```bash
# 프로젝트 연결 (한 번만)
supabase link --project-ref your-project-ref

# 마이그레이션 푸시
supabase db push

# 시드 적용
psql "$DATABASE_URL" -f supabase/seed.sql
```

## 4. 첫 PMO 관리자 계정 생성

가입 UI는 없다. 첫 PMO 관리자는 **(1) Supabase Auth 사용자 생성 → (2) `memberships` 에 `pmo_admin` 행 insert** 두 단계로 만든다.

### Step 1 — Supabase Auth 사용자 생성

Supabase 대시보드 → **Authentication → Users → Add user → Create new user**
- Email: 예) `admin@example.com`
- Password: 원하는 비밀번호
- (선택) **Auto Confirm User** 체크 → 이메일 확인 절차 생략

### Step 2 — `memberships` 에 PMO 관리자 행 insert

SQL Editor 에서 아래를 실행한다. 위에서 만든 이메일과 시드된 PMO 팀을 조인하므로 UUID를 직접 복사할 필요가 없다.

```sql
insert into memberships (user_id, team_id, role)
select u.id, t.id, 'pmo_admin'
from auth.users u
cross join teams t
where u.email = 'admin@example.com'   -- Step 1에서 만든 이메일
  and t.code = 'PMO';
```

이제 해당 이메일/비밀번호로 `/login` 에서 로그인하면 PMO 관리자 권한(프로젝트 생성, WBS 구조/실적 전체 수정, 멤버·공휴일·임포트)을 갖는다.

### (참고) 팀 편집자 추가

다른 팀(DT/ERP/MES) 편집자는 동일하게 Auth 사용자 생성 후 `role`/`code` 만 바꿔 insert 한다. 팀 편집자는 자기 팀이 담당(primary/support)인 `activity` 의 실적%만 수정할 수 있다(RLS + 서버 액션 이중 강제).

```sql
insert into memberships (user_id, team_id, role)
select u.id, t.id, 'team_editor'
from auth.users u
cross join teams t
where u.email = 'dt-editor@example.com'
  and t.code = 'DT';
```

## 5. Vercel 배포

1. GitHub 등 저장소에 push 후 [Vercel](https://vercel.com/new) 에서 **Import Project** 로 이 repo를 연결한다. Next.js는 자동 감지된다(빌드 커맨드 `next build`).
2. **Settings → Environment Variables** 에 다음 3개를 등록한다(Production/Preview 모두):
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY` (서버 전용 — Sensitive 처리)
3. **Deploy** 를 실행한다. 환경 변수 변경 후에는 **Redeploy** 가 필요하다.
4. 배포 후 Supabase 대시보드 → Authentication → **URL Configuration** 의 Site URL / Redirect URLs 에 Vercel 도메인을 추가한다.

> 마이그레이션·시드·첫 PMO 계정 생성(3·4번)은 배포와 별개로 Supabase 측에서 한 번 수행해야 한다.

## 프로젝트 구조

```
src/
  lib/
    domain/      # 순수 도메인 로직 (dates, progress, rollup, tree, types) — 테스트 대상
    excel/       # 엑셀 파싱/검증 (parse, validate) — 순수, 테스트 대상
    supabase/    # 서버/브라우저 클라이언트
    data/        # WBS 트리 조회 + 진척 계산 조립(getComputedWbs)
    auth.ts      # 세션/멤버십(역할·팀) 조회
  app/
    login/                         # 로그인
    (app)/projects/                # 프로젝트 목록/생성
    (app)/p/[projectId]/wbs/       # WBS 보드(트리 + 간트 + 상세)
    (app)/p/[projectId]/dashboard/ # 대시보드(KPI/지연 목록)
    (app)/p/[projectId]/settings/  # 멤버/공휴일/임포트·익스포트
    api/import/                    # 엑셀 업로드 처리
    actions/                       # 서버 액션 (project, wbs + 변경 이력)
  components/
    wbs/         # TreeTable, GanttChart, DetailPanel, ProgressBar, WbsBoard
    dashboard/   # Kpi, DelayedList
supabase/
  migrations/0001_init.sql, 0002_rls.sql
  seed.sql
tests/
  domain/*, excel/*               # Vitest 단위 테스트
```

## 테스트

진척 계산·영업일·가중 롤업·트리 구성·엑셀 파싱/검증은 DB·네트워크 의존이 없는 순수 함수로 구현되어 `npm run test` 로 검증된다.

```bash
npm run test         # 1회 실행
npm run test:watch   # 워치 모드
```
