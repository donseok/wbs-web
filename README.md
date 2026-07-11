# D'Flow — PI 프로젝트 운영 스위트

동국씨엠 PI(Process Innovation) 관리를 위해 구축한 통합 운영 도구다. WBS·간트,
경영진 대시보드, 칸반, 주간업무 시트(실시간 동시편집), 회사 공식 양식
주간보고 PPT/Excel 생성, 회의 달력, 회의록 보관함(RAG 챗봇), 공지, 근태,
계정 관리, DK Bot(WBS RAG 챗봇), 한/영 i18n을 포함한다.

## 도메인 원칙

- 진척 계산(영업일·계획%·달성율·가중 롤업)은 서버의 **순수 함수**로 수행하고 단위 테스트로 검증한다.
- 권한은 **RLS + 서버 액션 재검증**으로 이중 강제한다.
- 실적%는 leaf(`activity`)에만 저장하고, 상위 레벨은 항상 가중 롤업 계산값이다.
- 가중치가 `null`이면 형제 균등(1/n)으로 간주한다.
- 날짜는 DB에 `date`로 저장하고 앱 표준 타임존은 `Asia/Seoul`이다.

## 기술 스택

Next.js 15(App Router) · React 19 · TypeScript · Tailwind CSS v4 ·
Supabase(Postgres + RLS + Realtime + pgvector) · Gemini API(무료 티어, OpenAI
호환 엔드포인트로 전환 가능) · SheetJS/exceljs(엑셀 가져오기·내보내기) ·
jszip(PPTX 템플릿 채움) · mermaid · react-markdown · lucide-react ·
Vitest(+jsdom)

## 로컬 실행

Node.js 20+, npm, Supabase 프로젝트(무료 플랜으로 충분)가 필요하다.

```bash
# 의존성 설치
npm install

# 환경 변수 파일 생성 (아래 "환경 변수" 절 참고)
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

진입 동선: 미인증 사용자는 미들웨어가 `/login` 으로 리다이렉트한다. 로그인 후
`/projects` 에서 프로젝트를 선택해 WBS 보드·대시보드·설정 등으로 이동한다.

## 환경 변수

`.env.local.example` 을 복사해 채운다. Supabase 3종
(`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
`SUPABASE_SERVICE_ROLE_KEY`)은 필수이며, 모두 Supabase 대시보드 →
Project Settings → API 에서 확인할 수 있다. `SUPABASE_SERVICE_ROLE_KEY`는
서버 전용이므로 클라이언트에 노출하면 안 된다.

DK Bot(AI 챗봇)을 쓰려면 `GEMINI_API_KEY`(Google AI Studio에서 발급, 서버
전용)를 추가로 설정한다 — 키가 없어도 봇은 구조화 질의 기반 결정형
답변으로 자동 폴백해 동작한다. 모델·폴백 체인 오버라이드(`GEMINI_MODEL`,
`GEMINI_FALLBACK_MODELS`, `GEMINI_EMBED_MODEL`)와, OpenAI 호환 엔드포인트
(Groq/OpenRouter/사내 LLM)로 전환하는 `AI_PROVIDER=openai` 계열 변수도
`.env.local.example`에 예시가 있다.

## 데이터베이스

`supabase/migrations/` 의 `0001`~`0024`를 번호순으로 실행한다(`0018`은
결번이고, `0019_project_member_user_link_rollback.sql`·
`0022_leaf_actual_rls_rollback.sql` 2개 롤백 파일은 실행 대상에서
제외한다). 시드는 `supabase/seed.sql`이며 팀 4개(PMO/가공/ERP/MES)를
생성한다.

알려진 드리프트: 레포의 `0002`/`0004` 마이그레이션 파일에 적힌
`current_role()` 헬퍼는 `current_role`이 PostgreSQL 예약어라 그대로
적용할 수 없어서, 프로덕션에는 `0012`부터 도입된 `app_role()`로 대체
적용되어 있다(`0012_announcements.sql`의 주석 참고).

DK Bot(pgvector 임베딩) 스키마는 `scripts/apply-dkbot-migration.mjs`
스크립트로 적용한다.

## 계정

가입 UI는 없다. 관리자 화면(`/admin/accounts`)에서 PMO 관리자가 계정을
생성·일괄생성·비밀번호 리셋할 수 있다. 다만 이 화면에 접근할 최초의
`pmo_admin` 1명은 Supabase 대시보드(Authentication → Users +
`memberships` 테이블 insert)에서 수동으로 부트스트랩해야 한다.

## 프로젝트 구조

```
src/
  app/
    (app)/
      admin/             # 관리자 — 계정 생성/일괄생성/리셋
      meetings/          # 전사 회의 달력(내 회의)
      minutes/           # 회의록 보관함 (RAG 챗봇)
      projects/          # 프로젝트 목록/생성
      p/[projectId]/
        announcements/   # 공지사항
        attendance/      # 근태현황
        dashboard/       # 경영진 대시보드
        gantt/           # 간트
        kanban/          # 칸반 보드
        meetings/        # 프로젝트별 회의
        members/         # 멤버 관리
        settings/        # 프로젝트 설정(멤버·공휴일·임포트)
        wbs/             # WBS 보드
        weekly/          # 주간업무 시트(실시간 동시편집)
    actions/             # 서버 액션 (project, wbs, weekly, minutes, meetings 등)
    api/
      chat/              # DK Bot 챗봇 API
      export/            # 엑셀/PPT 내보내기
      import/            # 엑셀 임포트
      minutes/           # 회의록 업로드/RAG
      report/            # 주간보고 생성
    login/               # 로그인
  lib/
    ai/          # DK Bot·회의록 RAG (임베딩, 검색, LLM 프로바이더, 폴백)
    domain/      # 순수 도메인 로직 (진척·롤업·영업일·트리 등) — 테스트 대상
    data/        # DB 조회 + 도메인 조립
    excel/       # 엑셀 파싱/검증 — 순수, 테스트 대상
    report/      # 주간보고 PPT/Excel 생성
    i18n/        # 한/영 사전 + 서버 헬퍼
    prefs/       # 계정별 UI 설정 동기화
    supabase/    # 서버/브라우저 클라이언트
    auth.ts      # 세션/멤버십(역할·팀) 조회
  components/    # 화면별·공용 컴포넌트 18개 디렉터리 (ui/ 가 공용 프리미티브 13종)
supabase/
  migrations/    # 0001~0024 (0018 결번, *_rollback.sql 2개 제외)
  seed.sql       # 팀 4개(PMO/가공/ERP/MES)
tests/
  actions/ ai/ domain/ excel/ lib/ minutes/ report/ ui/   # Vitest 단위 테스트
```
