# D'Flow 프로젝트 초대 — 구현 계약 v2 (안전 설계)

> v1(`project-invite-spec.md`)의 실측 검증 결과(2026-08-03, 16 에이전트) 설계 blocker 4건이
> 확인되어 **v2 로 재설계**했다. v1 과 `kickoff-prompt.md` 는 **폐기**한다 — 참조하지 말 것.
> 이 문서가 구현의 단일 진실이다.

---

## 0. v1 을 폐기한 이유 (요약)

이 레포의 RLS 는 `authenticated` 전원에게 `using (true)` 다(프로덕션 실측: SELECT 정책
`qual=true` 인 테이블 40개 이상 — minutes·wbs_items·issues·attendance·weekly·wiki·
project_members). 즉 **계정 발급 = 전사 읽기 개방**이고, `project_roles` 의 `member` 는
조회 등급이 아니라 **쓰기 등급**이다(`attendance_records`·`wbs_progress_snapshots` 는
`cmd=ALL`, issues UPDATE, weekly_report_rows INSERT/UPDATE, wbs_items 실적 UPDATE).
`app_role()` 은 project_roles 행의 **존재만으로** `team_editor` 를 돌려주어
`minute_folders` 전역 INSERT 까지 연다.

v1 은 "링크를 아는 누구나 임의 이메일로 가입"을 허용했다. 그 상태로는 링크 한 줄의 유출이
곧 전사 데이터 열람 + 운영 데이터 쓰기였다.

**v2 의 해법은 RLS 를 건드리지 않고 링크의 성질을 바꾸는 것이다** — 링크를 "아무나 쓸 수
있는 열쇠"에서 **"지정된 한 사람에게, 그 사람의 메일함으로만, 한 번만 가는 열쇠"** 로.

---

## 1. 설계 원칙 (v1 대비 변경점)

| # | v1 | v2 | 이유 |
|---|---|---|---|
| P1 | 이메일 자유 입력 | **초대에 수신 이메일을 못 박고, 가입 폼에 이메일 입력란이 없다** | 사칭 원천 차단. 서버가 초대 행의 이메일로만 계정을 만든다 |
| P2 | 링크를 관리자가 복사·전달 | **초대 생성 시 그 주소로 메일 발송**(nodemailer 재사용) | 링크가 메일함에만 도달 = 이메일 소유 증명 |
| P3 | 도메인 제한 없음 | **허용 도메인 화이트리스트**(기본 `dongkuk.com`) | 외부 주소 오입력 차단. 미설정 시에도 기본값 적용(fail-closed) |
| P4 | `max_uses` nullable(무제한), 만료 선택 | **1회용 고정 + 만료 필수**(기본 7일, 최대 30일) | 유출 창 최소화. 정당한 수신자가 먼저 쓰면 소진 |
| P5 | 취소 = 행 삭제 | **소프트 취소(`revoked_at`) + 합류 기록 영구 보존** | 사고 시 "누가 만든 어떤 초대로 누가 언제 들어왔나" 추적 |
| P6 | 팀 = 생성자 팀 암묵 상속 | **관리자가 팀을 명시 선택** | 팀이 WBS 쓰기 범위를 결정한다. 암묵 상속은 위험 |
| P7 | 읽기 범위 미고지 | **초대 생성 UI에 경고 문구 상설** | 관리자가 알고 발급하게 한다 |
| P8 | 페이지에서 `getClaims()` 로 세션 판정 | **페이지는 세션을 읽지 않는다.** 클라이언트에서 판정 | `/invite` 는 미들웨어 밖이라 토큰 갱신을 못 받는다. RSC 에서 쿠키 쓰기는 throw → 500 |

**남는 위험(수용, UI 에 고지):** ① 지정 이메일의 메일함이 침해되면 그 사람으로 가입 가능
(모든 초대 시스템 공통). ② 합류자는 이 레포 RLS 구조상 전 프로젝트 데이터를 조회할 수
있다 — 초대 기능 범위 밖의 구조 문제이며, 별도 과제로 남긴다.

---

## 2. 데이터 모델

마이그레이션: `supabase/migrations/0065_project_invites.sql` + `0065_project_invites_rollback.sql`
(**0065 가 다음 빈 번호다. 현재 최대는 0064** — v1 의 "최대 0054" 는 틀렸다.)
짝 테스트: `tests/migrations/project-invites.test.ts` (레포 관례 — SQL 본문 문자열 단언)

```sql
create table public.project_invites (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references public.projects(id) on delete cascade,
  token       uuid not null unique,
  email       text not null,
  team_id     uuid not null references public.teams(id) on delete restrict,
  created_by  uuid references auth.users(id) on delete set null,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null,
  revoked_at  timestamptz,
  redeemed_by uuid references auth.users(id) on delete set null,
  redeemed_at timestamptz,
  constraint project_invites_email_normalized check (email = lower(btrim(email)) and email <> ''),
  -- 한 방향만 금지한다. (uuid, null) 즉 "합류자는 있는데 합류 시각이 없는" 상태만 거부하고,
  -- (null, timestamp) 즉 "합류는 있었으나 그 계정이 지워진" 감사 기록은 허용한다.
  -- 등가(=)로 묶으면 redeemed_by 의 on delete set null 이 만드는 상태를 CHECK 가 거부해
  -- auth.users 삭제 자체가 실패하고, 가입 실패 시 보상 롤백(deleteUser)까지 막힌다.
  constraint project_invites_redeem_pair check (redeemed_by is null or redeemed_at is not null)
);
```

- `use_count`/`max_uses` 없음 — **1회용**이다. `redeemed_at is null` 이 곧 미사용.
- 부분 유니크: `(project_id, email) where redeemed_at is null and revoked_at is null`
  → 같은 사람에게 활성 초대가 둘 생기지 않는다.
- 조회 인덱스: `(project_id, created_at desc)`
- RLS enable + **정책 0개** + `revoke all ... from public, anon, authenticated` +
  `grant all ... to service_role` (0049 선례. RLS 는 TRUNCATE 를 막지 못한다 — 0051 주석)

원자 소비 함수 — 검증과 소비를 단일 UPDATE 로:

```sql
create or replace function public.consume_project_invite(
  p_token uuid, p_email text, p_user uuid
) returns table (project_id uuid, team_id uuid, invite_email text, created_by uuid)
language sql
volatile
security invoker
set search_path = public, extensions
as $$
  update public.project_invites pi
     set redeemed_by = p_user, redeemed_at = now()
   where pi.token = p_token
     and pi.redeemed_at is null
     and pi.revoked_at is null
     and pi.expires_at > now()
     and pi.email = lower(btrim(p_email))
  returning pi.project_id, pi.team_id, pi.email, pi.created_by;
$$;
revoke all on function public.consume_project_invite(uuid, text, uuid) from public, anon, authenticated;
grant execute on function public.consume_project_invite(uuid, text, uuid) to service_role;
```

**이메일 일치를 DB 레벨에서 강제**하는 것이 v2 의 핵심이다. 행이 안 나오면
"만료·취소·이미 사용·이메일 불일치" 중 하나이며, 사용자에게는 구분하지 않는다.

파일 상단에 레포 관례의 헤더 주석(왜 / 핵심 계약 / 멱등 / 적용은 Management API /
롤백 파일명 / **적용 순서: 이 마이그레이션을 먼저 적용한 뒤 코드를 배포**)을 붙인다.
끝에 `do $$ ... raise exception ...` 검증 블록.

기존 테이블 변경: **없음**.

---

## 3. 도메인 순수함수 — `src/lib/domain/invites.ts` (신규)

```ts
/** 공개 라우트 토큰 형식. 선례: src/lib/minutes/share.ts isShareToken */
export function isInviteToken(s: string): boolean

/** 소문자·trim. DB check(email = lower(btrim(email))) 와 같은 규칙. */
export function normalizeInviteEmail(raw: string): string

/** 허용 도메인 목록 파싱. 빈 입력이면 기본값 ['dongkuk.com'] (fail-closed). */
export function parseAllowedDomains(raw: string | undefined): string[]

/** normalizeInviteEmail 을 거친 주소가 허용 도메인인가. */
export function isAllowedInviteDomain(email: string, domains: string[]): boolean

export const DEFAULT_INVITE_DAYS = 7
export const MAX_INVITE_DAYS = 30
/** 1~30 정수만 통과. 그 외는 null. */
export function normalizeInviteDays(v: unknown): number | null

export interface InviteStateRow {
  expiresAt: string; revokedAt: string | null; redeemedAt: string | null
}
export type InviteStatus = 'active' | 'redeemed' | 'revoked' | 'expired'
/** 우선순위: revoked > redeemed > expired > active. now 주입(순수). */
export function inviteStatus(row: InviteStateRow, now: Date): InviteStatus
export function inviteStatusLabel(s: InviteStatus): string  // '유효' | '합류 완료' | '취소됨' | '만료됨'

/** 메일·화면 표시용 마스킹: 'nam.yu@dongkuk.com' → 'na****@dongkuk.com' */
export function maskEmail(email: string): string

export interface SignupInput { name: string; password: string; passwordConfirmation: string }
/** 이메일은 초대가 정하므로 검증 대상이 아니다. isValidPassword(8자) 재사용. */
export function validateSignupInput(i: SignupInput): { ok: true } | { ok: false; error: string }
```

- `expiresAt` 파싱 실패는 **`'expired'`** 로 판정한다(fail-closed). v1 은 fail-open 이었다.
- `isValidPassword` 는 `src/lib/domain/accounts.ts` 에서 import (재구현 금지).
- 테스트: `tests/domain/invites.test.ts` — 만료 경계(정확히 now), 상태 우선순위 4종,
  도메인 판정(대소문자·서브도메인 비허용), days 경계(0·1·30·31·비정수), 마스킹, 파싱 실패.

---

## 4. 메일 — `src/lib/mail/projectInvite.ts` (신규)

`src/lib/mail/meetingInvite.ts` 의 구성(순수 렌더 함수 + `MailMessage` 반환)을 따른다.
본문은 한국어 고정(선례 주석과 동일한 이유). 발송은 `getTransport()`(transport.ts) 재사용 —
**환경변수가 없으면 `ok:false` 를 낼 뿐 throw 하지 않는다**(로컬·Preview 에서 화면을 죽이지 않음).

```ts
export interface InviteMailInput {
  projectName: string; inviterName: string | null
  url: string; expiresAt: string   // ISO
}
export function renderInviteMail(i: InviteMailInput): { subject: string; html: string; text: string }
```
- 제목: `[D-CUBE] {projectName} 프로젝트 초대`
- 본문: 프로젝트명 · 초대한 사람 · **버튼/링크 전문** · 만료 일시 · "본인이 요청하지 않은
  메일이면 무시하세요" · "링크는 1회용이며 이 주소로만 사용할 수 있습니다"
- 테스트: `tests/mail/project-invite.test.ts` — URL·만료 표기 포함, HTML 이스케이프.

---

## 5. 서버 액션

### 5-1. 관리 — `src/app/actions/projectInvites.ts` (신규)

게이트: 세 함수 모두 `requireProjectAdmin(projectId)`. DB 는 전부 `createAdminClient()`.
반환 관례 `{ ok: true, ... } | { ok: false, error }`.

```ts
export interface InviteRow {
  id: string; email: string; teamCode: string | null
  status: InviteStatus; expiresAt: string; createdAt: string
  redeemedAt: string | null
  /** status === 'active' 인 행에만 채워진다. token 은 내보내지 않는다 — 설정 화면의 RSC
   *  페이로드에 전 초대의 가입 자격이 실릴 이유가 없다. */
  url: string | null
}
export async function listProjectInvites(projectId: string):
  Promise<{ ok: true; rows: InviteRow[] } | { ok: false; error: string }>

export interface CreateInviteInput { email: string; teamCode: string; days?: number }
/** 생성 + 메일 발송. 메일 실패는 초대를 무효화하지 않는다 — mailed:false 로 알리고
 *  관리자가 링크를 복사할 수 있게 한다. */
export async function createProjectInvite(projectId: string, input: CreateInviteInput):
  Promise<{ ok: true; row: InviteRow; url: string; mailed: boolean; mailError?: string }
        | { ok: false; error: string }>

/** 소프트 취소. 이미 합류했거나 이미 취소된 초대는 거부. */
export async function revokeProjectInvite(projectId: string, inviteId: string):
  Promise<{ ok: true } | { ok: false; error: string }>
```

구현 규칙:
1. `createProjectInvite` 순서 — 입력 검증(이메일 정규화·도메인·팀 코드·days) →
   **이미 계정이 있는 이메일인지 확인**(있으면 `alreadyAccount` 로 안내하되 초대는 허용:
   기존 계정 합류 경로가 있다) → 활성 중복 초대 확인 → `crypto.randomUUID()` →
   insert → 링크 조립 → 메일 발송 → 결과 반환.
2. **링크 origin 은 `process.env.NEXT_PUBLIC_APP_URL`** (프로덕션에 설정돼 있음).
   미설정이면 `{ ok:false, error:'앱 주소(NEXT_PUBLIC_APP_URL)가 설정되지 않아 초대 링크를 만들 수 없습니다.' }`
   — 잘못된 origin 의 링크를 발송하느니 중단한다(fail-closed).
3. `revokeProjectInvite` 의 update 는 **`.eq('id',…).eq('project_id',…).is('redeemed_at',null).is('revoked_at',null).select('id')`**
   후 길이 0 검사. `.select()` 없이는 0행과 1행이 구분되지 않는다
   (선례: `src/app/actions/minutes.ts` 의 `.select('id')` 후 길이 검사).
4. 성공 시 `revalidatePath('/p/' + projectId + '/settings')`.
5. **토큰을 로그에 남기지 않는다.**
6. 팀 코드 검증은 `activeTeamCodesSync()`(`src/lib/teams/master.ts`) — accounts.ts 선례.
7. 게이트 테스트: `tests/actions/project-invites-gate.test.ts` —
   `tests/actions/accounts-gate.test.ts` 의 mock 패턴(`vi.hoisted` + `@/lib/authz` ·
   `@/lib/supabase/admin` · `next/cache` 3중 mock)을 따른다. 비-admin 3케이스가
   admin client 도달 전에 차단됨을 단언.

### 5-2. 공개 redeem — `src/app/actions/inviteRedeem.ts` (신규)

인증 게이트 없음. 모든 함수 첫 줄 `isInviteToken(token)` — 실패 시 미존재와 같은 문구.

```ts
export interface InvitePreview {
  projectName: string; projectDescription: string | null
  maskedEmail: string          // 전체 주소를 노출하지 않는다
  status: InviteStatus
  accountExists: boolean       // 가입 폼 / 로그인 폼 분기용
}
export async function getInvitePreview(token: string):
  Promise<{ ok: true; preview: InvitePreview } | { ok: false; error: string }>

/** 로그인 사용자 합류. 세션 이메일이 초대 이메일과 다르면 거부. */
export async function redeemInvite(token: string):
  Promise<{ ok: true; projectId: string; alreadyMember: boolean } | { ok: false; error: string }>

/** 가입+합류. **이메일을 인자로 받지 않는다** — 서버가 초대 행에서 읽는다. */
export async function redeemInviteWithSignup(token: string, input: SignupInput):
  Promise<{ ok: true; projectId: string; email: string } | { ok: false; error: string }>
```

`redeemInvite` 절차:
1. `getSession()`(`src/lib/auth.ts`) — 서버 액션은 쿠키를 쓸 수 있으므로 여기서는 안전하다.
   세션 없으면 `'로그인이 필요합니다.'`
2. **토큰으로 초대 행 조회**(project_id·email 확보). 조회 실패는 `'초대를 확인할 수 없어 중단했습니다.'`
   (에러 처리 3원칙 — 조회 실패를 '없음'으로 위장하지 않는다). 미존재는 `'초대를 찾을 수 없습니다.'`
3. 세션 이메일 ≠ 초대 이메일 → `'이 초대는 다른 이메일 주소를 위한 것입니다. 초대받은 계정으로 로그인해 주세요.'`
4. 이미 `project_roles` 행이 있으면 소비 없이 `{ ok:true, alreadyMember:true }`
5. `admin.rpc('consume_project_invite', { p_token, p_email, p_user })` — 행 0개면
   `'만료되었거나 사용할 수 없는 초대입니다.'`
6. `project_roles` upsert — **`{ onConflict: 'project_id,user_id', ignoreDuplicates: true }` 필수**
   (빠뜨리면 admin 이 member 로 강등된다). `granted_by` = 초대 생성자(`created_by`) ?? 본인
7. 소비 후 6 실패 시: `redeemed_by/redeemed_at` 을 되돌려(`update ... set null`) 재시도 가능하게 한다.
   **v1 은 이 복구를 포기했는데, 1회용 초대에서는 그러면 재시도가 원리적으로 불가능하다.**
   되돌리기까지 실패하면 `console.error` 후 에러 반환.
8. `revalidatePath('/projects')`

`redeemInviteWithSignup` 절차:
1. 세션이 있으면 `'이미 로그인되어 있습니다.'`
2. `validateSignupInput` (이름·비밀번호·확인)
3. 토큰으로 초대 조회 → 상태가 `'active'` 가 아니면 `'만료되었거나 사용할 수 없는 초대입니다.'`
4. `admin.auth.admin.createUser({ email: 초대의 이메일, password, email_confirm: true,
   user_metadata: { full_name: name } })` — 실패 시 `'이미 가입된 계정이거나 입력값을 확인해 주세요.'`
5. `memberships` insert `{ user_id, team_id: 초대의 team_id, role: 'team_editor' }`
   (`role` 은 deprecated 이나 not null — accounts.ts 관례)
6. rpc consume (이메일은 초대의 것) — 0행이면 **보상 롤백**(`deleteUser`) 후 실패
7. `project_roles` upsert (위와 동일)
8. 로스터 사후 연결: `project_members.update({ user_id }).is('user_id', null).eq('email', 이메일)`
   — 실패해도 전체 성공 유지(console.error). 이메일이 **관리자가 지정한 값**이므로
   v1 의 로스터 탈취 위험은 사라진다.
9. 4단계 이후 5·6·7 실패 시 `deleteUser` 보상 롤백(memberships·project_roles 는 FK cascade —
   프로덕션 실측 확인). 롤백 실패는 `console.error` 만.
10. 성공: `{ ok:true, projectId, email }` — 클라이언트가 이 email + 입력한 password 로
    `signInWithPassword`

`getInvitePreview` 는 `createAdminClient()` + 컬럼 화이트리스트(projects 는 name/description 만).
`accountExists` 판정은 `listAllAuthUsers`(`src/lib/data/accounts.ts`) 대신
`admin.auth.admin.listUsers` 페이지네이션 비용을 피해 **`project_members`/`memberships` 가 아닌
auth 조회가 필요**하므로, `admin.rpc` 없이 `listAllAuthUsers` 를 재사용하고 결과를 이메일로 찾는다.
(계정 수 51개 규모라 비용 문제 없음.)

---

## 6. 미들웨어 — `src/middleware.ts`

matcher 의 negative-lookahead 그룹에 `invite/` 를 추가한다(슬래시 앵커 필수).
**바로 위 주석 블록에 제외 사유 한 줄을 함께 추가한다** — 이 파일의 다른 제외 항목은 전부
사유가 적혀 있고, CLAUDE.md 가 "'무엇'보다 '왜'" 를 요구한다.

```
- '/share/' : 비로그인 외부 열람 경로
+ '/invite/': 비로그인 초대 수령 경로 (링크만으로 가입·합류)
```

---

## 7. UI

### 7-1. `src/components/settings/ProjectInviteManager.tsx` (신규, `'use client'`)

삽입 지점: `src/app/(app)/p/[projectId]/settings/page.tsx` 의 **eyebrow 가 `AUTHORIZATION` 인
SectionCard**(실측: 273-292행) 안, `ProjectRolesManager` **아래**. 다른 섹션·순서는 건드리지 않는다.
`listProjectInvites` 호출은 **JSX 안의 async IIFE 가 아니라** 페이지 상단에서 다른 데이터와
함께 await 한 뒤 props 로 내린다(기존 페이지 패턴). import 2줄 추가 필요.

`ProjectRolesManager.tsx` 패턴(useTransition + 서버액션 직접 호출 + 행별 에러 +
`router.refresh()`)을 따른다. 외부 UI 라이브러리 금지. 네이티브 `alert/confirm` 금지.

- 소제목 `초대 링크`
- **경고 배너(상설)**: `합류한 사람은 이 프로젝트뿐 아니라 D-CUBE 전체의 회의록·WBS·이슈·근태를 조회할 수 있습니다. 사내 인원에게만 발급하세요.`
- 생성 폼: 이메일 `<input type="email">` · 팀 `<select>`(`useTeams()` 또는 props 로 받은 활성 팀) ·
  유효기간 `<input type="number" min=1 max=30>`(기본 7, 라벨 `유효기간(일)`) · `초대 보내기` 버튼
- 목록(0개면 `발급한 초대가 없습니다.`): 이메일 · 팀 · 상태 배지(`inviteStatusLabel`) ·
  만료 일시 · 합류 일시(있으면) · 링크 복사 버튼(active 만) · 취소 버튼(active 만)
  - 링크는 서버가 준 `url` 을 쓴다. **`window.location.origin` 을 렌더 중에 읽지 않는다**
    (서버 프리렌더에서 `window is not defined`). 목록 행의 링크는
    `NEXT_PUBLIC_APP_URL` 기반으로 서버에서 조립해 내려준다.
  - 복사 성공 시 1.5초 `Check` 아이콘(평시 `Copy`) — lucide-react
  - 취소는 기존 `Modal`(`src/components/ui/Modal.tsx`, props: `open/onClose/title/eyebrow/children/footer/size`)
    로 확인. confirm 프리셋이 없으므로 footer 에 버튼을 직접 만든다.
    문구 `이 초대를 취소할까요? 이미 합류한 사람은 영향받지 않습니다.`
- 결과 표시: 성공 시 `useToast()` 의 `toast({ title, variant: 'success' })`.
  메일 발송이 실패했으면 `variant: 'info'` 로 `초대는 만들었지만 메일 발송에 실패했습니다. 링크를 복사해 전달해 주세요.`
- 실패 시 폼/행 하단 `role="alert"` 빨간 텍스트(서버 error 문구 우선)
- **금지**: 상태 변형 display 유틸(`group-hover:flex`·`data-[state=open]:hidden`·`print:hidden`),
  컨테이너 쿼리 display 와 반응형 display 혼용 (CLAUDE.md CSS 안전망)

### 7-2. `src/app/invite/[token]/page.tsx` (신규) + `src/components/invite/InviteRedeemCard.tsx`

**page.tsx** — 서버 컴포넌트, `(app)` 그룹 밖(share 페이지와 같은 위상):
- `export const dynamic = 'force-dynamic'`
- `export const metadata = { robots: { index: false, follow: false } }`
- `params` 는 Promise: `{ params }: { params: Promise<{ token: string }> }` → `await params`
- service_role env 미설정이면 `notFound()` (share 페이지 선례)
- **세션을 읽지 않는다**(P8). `getInvitePreview` 결과만 클라이언트에 넘긴다.
- 로그인 화면의 톤을 참고한 중앙 카드. 단 login/page.tsx 는 하드코딩 hex 를 쓰는 예외
  화면이므로 **디자인 토큰을 쓰는 공용 컴포넌트 관례를 따른다**(다크 모드 대응).

**InviteRedeemCard** (`'use client'`) — 마운트 시
`createBrowserClient().auth.getUser()` 로 세션·이메일을 판정한다(브라우저는 쿠키를 쓸 수
있어 토큰 갱신이 정상 동작한다).

| 상태 | 화면 |
|---|---|
| status ≠ active (또는 preview 실패) | `만료되었거나 유효하지 않은 초대 링크입니다.` + `로그인 화면으로` |
| 로그인 · 이메일 일치 | 프로젝트명 + `합류하기` → `redeemInvite` → toast 후 `/projects` |
| 로그인 · 이메일 불일치 | `이 초대는 {maskedEmail} 님을 위한 것입니다. 해당 계정으로 로그인해 주세요.` + `로그인 화면으로` |
| 비로그인 · `accountExists:false` | 이름 / 비밀번호 / 비밀번호 확인 3필드 (**이메일은 읽기 전용 표시**) + `가입하고 합류하기` |
| 비로그인 · `accountExists:true` | 비밀번호 1필드(이메일 읽기 전용) + `로그인하고 합류하기` |

- 가입 성공 → `createBrowserClient().auth.signInWithPassword({ email: 반환값, password })`
  → `/projects`. signIn 실패 시 `variant:'info'` toast 후 `/login`
- 로그인 제출 → `signInWithPassword` → 성공 시 이어서 `redeemInvite(token)`
- 대기 중 버튼 `disabled` + 라벨 `처리 중…`
- 클라이언트 선검증: 비밀번호 불일치는 제출 없이 인라인 에러
- `ToastProvider` 는 루트 레이아웃에 있으므로(`src/app/layout.tsx`) `(app)` 밖에서도 `useToast()` 가 동작한다

---

## 8. 에러 문구

| # | 상황 | 문구 |
|---|---|---|
| E1 | 토큰 형식 오류 / 미존재 | `초대를 찾을 수 없습니다.` (구분하지 않는다) |
| E2 | 만료·취소·사용됨·이메일 불일치(소비 실패) | `만료되었거나 사용할 수 없는 초대입니다.` (페이지: `만료되었거나 유효하지 않은 초대 링크입니다.`) |
| E3 | 비로그인 `redeemInvite` | `로그인이 필요합니다.` |
| E4 | 로그인 상태 `redeemInviteWithSignup` | `이미 로그인되어 있습니다.` |
| E5 | 세션 이메일 ≠ 초대 이메일 | `이 초대는 다른 이메일 주소를 위한 것입니다. 초대받은 계정으로 로그인해 주세요.` |
| E6 | 이름 공백 | `이름을 입력해 주세요.` |
| E7 | 비밀번호 8자 미만 | `비밀번호는 8자 이상이어야 합니다.` |
| E8 | 비밀번호 불일치 | `비밀번호가 일치하지 않습니다.` |
| E9 | createUser 실패 | `이미 가입된 계정이거나 입력값을 확인해 주세요.` |
| E10 | 허용되지 않은 도메인 | `사내 이메일 주소(@dongkuk.com)로만 초대할 수 있습니다.` |
| E11 | 이메일 형식 오류 | `이메일 형식을 확인해 주세요.` |
| E12 | 유효기간 범위 밖 | `유효기간은 1~30일 사이여야 합니다.` |
| E13 | 활성 초대 중복 | `이 주소로 발급한 초대가 아직 유효합니다. 취소 후 다시 보내세요.` |
| E14 | 취소 대상 없음/타 프로젝트/이미 처리됨 | `취소할 수 있는 초대가 아닙니다.` |
| E15 | 팀 코드 오류 | `알 수 없는 팀 코드` |
| E16 | `NEXT_PUBLIC_APP_URL` 미설정 | `앱 주소가 설정되지 않아 초대 링크를 만들 수 없습니다.` |
| E17 | 조회 실패(가드·선행조회) | `초대를 확인할 수 없어 중단했습니다.` |

원시 Postgres/Supabase 메시지를 사용자에게 노출하지 않는다.

---

## 9. 구현 순서

| # | 태스크 | 산출물 | 게이트 |
|---|---|---|---|
| T1 | 마이그레이션 | `0065_project_invites.sql`, `0065_project_invites_rollback.sql`, `tests/migrations/project-invites.test.ts` | 해당 테스트 green. **DB 적용 금지**(사람이 Management API 로) |
| T2 | 도메인 함수 | `src/lib/domain/invites.ts`, `tests/domain/invites.test.ts` | 해당 테스트 green |
| T3 | 메일 템플릿 | `src/lib/mail/projectInvite.ts`, `tests/mail/project-invite.test.ts` | 해당 테스트 green |
| T4 | 관리 액션 | `src/app/actions/projectInvites.ts`, `tests/actions/project-invites-gate.test.ts` | 해당 테스트 green |
| T5 | redeem 액션 | `src/app/actions/inviteRedeem.ts`, `tests/actions/invite-redeem.test.ts` | 해당 테스트 green |
| T6 | 미들웨어 | `src/middleware.ts` (matcher 1줄 + 주석 1줄) | 기존 미들웨어 테스트 green |
| T7 | 설정 UI | `ProjectInviteManager.tsx`, `settings/page.tsx` | 타입체크 신규 에러 0 |
| T8 | 공개 페이지 | `invite/[token]/page.tsx`, `InviteRedeemCard.tsx` | 타입체크 신규 에러 0 |
| T9 | 통합 검증 | — | `npm run test` 전량 green · `npm run lint` · 타입체크 신규 에러 0 |

**타입체크 게이트는 "baseline 대비 신규 에러 0"이다.** `npx tsc --noEmit` 은 이 작업과
무관하게 이미 2건 실패한다(`tests/report/issue-analysis-*.test.ts` 의 `majorId` — 0062 잔재).
그 2건을 고치려 들지 말 것(범위 밖·회귀 위험).

의존: T1·T2·T3 병렬 → T4·T5·T6 병렬 → T7·T8 병렬 → T9.

---

## 10. 배포 절차 (사람이 수행)

CLAUDE.md 규칙을 따른다.

1. **마이그레이션을 먼저 적용**한다 — Supabase Management API 경유(`db push` 금지).
   코드가 먼저 나가면 모든 프로젝트 관리자의 설정 화면이 PGRST 에러를 낸다(0027 교훈).
2. 마이그레이션 커밋과 코드 커밋을 **분리**한다(pre-push G1). `git add -A` 금지 — 파일명 명시.
3. `git push origin main` → Vercel 자동 배포
4. `npm run smoke:prod`
5. 화면 확인 후 `npm run mark:good`
6. 롤백은 코드 revert → 필요 시 `0065_project_invites_rollback.sql`

---

## 11. 수용 기준

전제: **검증용 쓰기는 `에이전트 루프 검증(테스트)` 프로젝트에서만** 한다
(CLAUDE.md: 운영 D-CUBE 데이터 훼손 금지 — 로컬 dev 도 프로덕션 DB 를 공유한다).
시나리오 종료 후 생성한 초대·권한·계정을 정리한다.

1. M1 발급: 관리자가 이메일·팀·기간으로 초대 → 목록에 `유효` 배지, 해당 주소로 메일 수신
2. M2 가입+합류: 메일의 링크 → 이름·비밀번호만 입력(이메일은 읽기 전용) → 자동 로그인 → `/projects` 에 프로젝트 표시
3. M3 1회성: 같은 링크 재접속 → `만료되었거나 유효하지 않은 초대 링크입니다.`
4. M4 이메일 불일치: 다른 계정으로 로그인한 채 링크 접속 → 안내 문구, 합류 버튼 없음
5. M5 도메인 차단: `@gmail.com` 으로 초대 생성 시도 → E10
6. M6 중복 차단: 같은 주소로 두 번째 초대 생성 → E13
7. M7 취소: 취소 후 링크 접속 → 무효 화면. 목록에는 `취소됨` 으로 남아 있음(삭제되지 않음)
8. M8 만료: `expires_at` 을 과거로 update(대상 토큰 한정) → 무효 화면
9. M9 강등 없음: admin 계정이 자기 프로젝트 초대를 밟아도 role 이 admin 그대로
10. M10 비로그인 게이트: 비로그인으로 `/invite/{유효토큰}` → `/login` 리다이렉트 없이 초대 화면
11. M11 잘못된 토큰: `/invite/not-a-uuid` 와 `/invite/{무작위 uuid}` 가 동일 화면
12. M12 토큰 비노출: anon 키로 `project_invites` REST 조회 → 빈 배열 또는 permission 에러

**이 샌드박스에서는 브라우저로 dev 서버에 접근할 수 없다**(verify 스킬). M1~M11 은
사람이 배포 후 수행한다. 자동 확인 가능한 것은 M12 와 단위 테스트뿐이다.

---

## 12. 구현 반영 사항 (2026-08-03 — 구현 후 계약 갱신)

구현과 적대적 리뷰를 거치며 위 계약에서 의도적으로 벗어난 지점이다. **코드가 정본이고
이 절이 그 이유를 설명한다.** 위 §2~§8 중 여기와 어긋나는 서술은 이 절이 이긴다.

| # | 계약 원문 | 실제 구현 | 이유 |
|---|---|---|---|
| C1 | redeem 쌍 CHECK 를 등가(`=`)로 | 한 방향만 금지 | 등가면 `on delete set null` 과 배타적이라 합류자 계정 삭제·보상 롤백이 영구히 막힌다(§2 인라인 주석) |
| C2 | `InviteRow.token: string` | `token` 제거, `url: string \| null`(active 행만) | 설정 화면 RSC 페이로드에 전 초대의 원본 토큰이 실렸다 |
| C3 | 카드가 `createBrowserClient().auth.getUser()` 로 세션 판정 | 서버 액션 `getInviteSessionState(token)` 추가 → `{ authed, emailMatches }` | 클라이언트가 마스킹 문자열로 본인 여부를 비교하면 `hong.gd@` 와 `hong.gs@` 가 같은 값이 된다. 해시도 내려보내지 않는다(사내 주소 공간이 작아 역산됨) |
| C4 | 비로그인·계정 있음 = 비밀번호 1필드(이메일 읽기 전용) | 이메일 + 비밀번호 2필드 | 서버가 마스킹만 내려주므로 읽기 전용 값을 만들 수 없다. 불일치는 서버가 판정하고, E5 를 받으면 **방금 만든 세션을 `signOut()` 으로 되돌린다** |
| C5 | 만료 초대 자동 정리(초기 구현) | 자동 정리 제거 — 만료 행도 관리자가 명시적으로 취소 | `revoked_at` 으로 덮어쓰면 아무도 취소하지 않은 초대가 '취소됨'으로 남아 P5 의 감사 목적을 깎는다. 대신 **취소 버튼을 `expired` 행에도 노출**한다(안 그러면 재발급 길이 막힌다) |
| C6 | `redeemInvite` 는 팀을 쓰지 않음 | `memberships` 행이 **아예 없을 때만** 초대의 팀으로 채움 | 기존 소속을 덮어쓰지 않는다는 원칙은 유지하되, 팀 없는 계정은 WBS 담당 판정이 깨진다 |
| C7 | §8 문구 표 | 문구 추가·동적화 | E10 은 실제 허용 목록으로 조립(하드코딩 폐지). 추가: 만료분 중복 시 `이 주소로 발급한 초대가 남아 있습니다. 목록에서 취소한 뒤 다시 보내세요.` / 합류 실패 2종 / 가입 실패 / 형상 오류 `입력값을 확인해 주세요.` |
| C8 | (없음) | 환경변수 `INVITE_ALLOWED_DOMAINS` | 허용 도메인 목록. 미설정이면 `dongkuk.com` 한 곳(fail-closed). `.env.local.example` 에 등재 |
| C9 | (없음) | `tests/ui/invite-redeem-card.test.tsx` | 카드의 5가지 상태 전이를 고정 |

**알려진 결합:** `InviteRedeemCard` 는 서버의 E5 문구와 **문자열 동등 비교**로 맞물린다
(액션 모듈이 `'use server'` 라 상수를 공유할 수 없다). E5 를 바꾸면 카드도 함께 고쳐야 하며,
테스트가 이 결합을 잡는다.

**구현 시점 검증 결과:** `npm run test` 3612건 green(초대 계열 신규 127건), `npx tsc --noEmit`
기준선 2건 외 신규 에러 0, `npm run lint` 무경고. 런타임 검증은 §11 대로 사람이 수행한다.
