# 로그인·계정 관리 기능 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 관리자 초대형 계정 관리(`/admin/accounts`에서 단건·일괄 생성, 비번 리셋, 팀/권한 수정), 본인 비밀번호 변경 모달, 로그인 화면 아이디/비번 분실 안내를 추가한다.

**Architecture:** 신규 DB 테이블 없음 — 기존 `auth.users` + `memberships`를 사용한다. 계정 쓰기(생성/리셋/멤버십)는 RLS를 우회해야 하므로 전부 `createAdminClient()`(service_role) 서버액션에서 수행하고, 호출자 권한은 `getMembership()`으로 `pmo_admin`을 검증한다(기존 `members.ts` 패턴). UI는 기존 `Modal`/`app-input`/`btn`/`useToast`/`useTransition` 패턴을 그대로 따른다.

**Tech Stack:** Next.js 15 App Router(서버액션), Supabase Auth(@supabase/supabase-js v2 admin API), React 19, TypeScript, Tailwind(디자인 토큰 클래스), vitest.

**Spec:** `docs/superpowers/specs/2026-07-08-auth-account-management-design.md`

---

## File Structure

**신규**
| 파일 | 책임 |
|------|------|
| `src/lib/domain/accounts.ts` | 순수 함수 — 상수(`TEAM_CODES`/`ACCOUNT_ROLES`), 타입가드, 비번 검증, 일괄 붙여넣기 파서 |
| `src/app/actions/accounts.ts` | 서버액션 — `listAccounts`/`createAccount`/`bulkCreateAccounts`/`resetPassword`/`updateAccountRole` (전부 pmo_admin 게이트) |
| `src/app/(app)/admin/accounts/page.tsx` | 서버컴포넌트 — pmo_admin 게이트 + 목록 로드 + `AccountsManager` 렌더 |
| `src/components/admin/AccountsManager.tsx` | 클라이언트 — 목록 표 + 추가/일괄/리셋/권한수정 모달 |
| `src/components/account/ChangePasswordModal.tsx` | 클라이언트 — 본인 비밀번호 변경 모달 |
| `tests/domain/accounts.test.ts` | `accounts.ts` 순수 함수 단위테스트 |
| `tests/actions/accounts-gate.test.ts` | 서버액션 권한 게이트 거부 테스트(모킹) |

**수정**
| 파일 | 변경 |
|------|------|
| `src/components/app/HeaderChrome.tsx` | 프로필 팝오버에 "비밀번호 변경" 버튼 + (pmo_admin) "계정 관리" 링크 + 모달 렌더 |
| `src/app/login/page.tsx` | 로그인 버튼 아래 아이디/비번 분실 안내 문구 |

---

## Task 1: 순수 도메인 모듈 (`src/lib/domain/accounts.ts`)

**Files:**
- Create: `src/lib/domain/accounts.ts`
- Test: `tests/domain/accounts.test.ts`

- [ ] **Step 1: 실패하는 테스트 작성**

Create `tests/domain/accounts.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import {
  TEAM_CODES, ACCOUNT_ROLES, isTeamCode, isAccountRole, isValidPassword, parseBulkAccounts,
} from '@/lib/domain/accounts'

describe('상수/타입가드', () => {
  it('팀 코드는 PMO·가공·ERP·MES', () => {
    expect([...TEAM_CODES].sort()).toEqual(['ERP', 'MES', 'PMO', '가공'].sort())
  })
  it('권한은 pmo_admin·team_editor', () => {
    expect([...ACCOUNT_ROLES].sort()).toEqual(['pmo_admin', 'team_editor'])
  })
  it('isTeamCode', () => {
    expect(isTeamCode('PMO')).toBe(true)
    expect(isTeamCode('가공')).toBe(true)
    expect(isTeamCode('DT')).toBe(false)
    expect(isTeamCode('')).toBe(false)
  })
  it('isAccountRole', () => {
    expect(isAccountRole('pmo_admin')).toBe(true)
    expect(isAccountRole('team_editor')).toBe(true)
    expect(isAccountRole('admin')).toBe(false)
  })
})

describe('isValidPassword', () => {
  it('8자 이상은 true', () => {
    expect(isValidPassword('12345678')).toBe(true)
    expect(isValidPassword('a-long-password')).toBe(true)
  })
  it('8자 미만/비문자열은 false', () => {
    expect(isValidPassword('1234567')).toBe(false)
    expect(isValidPassword('')).toBe(false)
    // @ts-expect-error 런타임 방어 확인
    expect(isValidPassword(undefined)).toBe(false)
  })
})

describe('parseBulkAccounts', () => {
  it('정상 4열(콤마)', () => {
    const r = parseBulkAccounts('a@b.com, PMO, team_editor, password1')
    expect(r).toHaveLength(1)
    expect(r[0]).toMatchObject({ lineNo: 1, ok: true, email: 'a@b.com', teamCode: 'PMO', role: 'team_editor', password: 'password1', name: null })
  })
  it('정상 5열(이름 포함)', () => {
    const r = parseBulkAccounts('a@b.com,가공,pmo_admin,password1,홍길동')
    expect(r[0]).toMatchObject({ ok: true, teamCode: '가공', role: 'pmo_admin', name: '홍길동' })
  })
  it('탭 구분(엑셀 붙여넣기)도 허용', () => {
    const r = parseBulkAccounts('a@b.com\tMES\tteam_editor\tpassword1')
    expect(r[0]).toMatchObject({ ok: true, email: 'a@b.com', teamCode: 'MES' })
  })
  it('빈 줄은 건너뛰되 lineNo는 파일 행번호 유지', () => {
    const r = parseBulkAccounts('\n\na@b.com,PMO,team_editor,password1\n')
    expect(r).toHaveLength(1)
    expect(r[0].lineNo).toBe(3)
  })
  it('열 부족은 실패', () => {
    const r = parseBulkAccounts('a@b.com, PMO, team_editor')
    expect(r[0].ok).toBe(false)
    expect(r[0].error).toContain('열')
  })
  it('이메일 형식 오류는 실패', () => {
    const r = parseBulkAccounts('not-an-email, PMO, team_editor, password1')
    expect(r[0]).toMatchObject({ ok: false })
    expect(r[0].error).toContain('이메일')
  })
  it('알 수 없는 팀은 실패', () => {
    const r = parseBulkAccounts('a@b.com, DT, team_editor, password1')
    expect(r[0].ok).toBe(false)
    expect(r[0].error).toContain('팀')
  })
  it('알 수 없는 권한은 실패', () => {
    const r = parseBulkAccounts('a@b.com, PMO, superuser, password1')
    expect(r[0].ok).toBe(false)
    expect(r[0].error).toContain('권한')
  })
  it('짧은 비밀번호는 실패', () => {
    const r = parseBulkAccounts('a@b.com, PMO, team_editor, short')
    expect(r[0].ok).toBe(false)
    expect(r[0].error).toContain('8자')
  })
})
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npm test -- tests/domain/accounts.test.ts`
Expected: FAIL — `Cannot find module '@/lib/domain/accounts'` (모듈 미존재).

- [ ] **Step 3: 최소 구현 작성**

Create `src/lib/domain/accounts.ts`:

```ts
// 계정(auth.users + memberships) 관련 순수 함수 — 클라이언트/서버 공용, 부수효과 없음.
import { isValidEmail } from '@/lib/domain/validate'
import type { TeamCode } from '@/lib/domain/types'

/** 로그인 계정 권한 (memberships.role 화이트리스트). project_members.role 과 다르다. */
export const ACCOUNT_ROLES = ['pmo_admin', 'team_editor'] as const
export type AccountRole = (typeof ACCOUNT_ROLES)[number]

/** 팀 코드 런타임 화이트리스트 (teams.code CHECK 와 일치). */
export const TEAM_CODES = ['PMO', '가공', 'ERP', 'MES'] as const satisfies readonly TeamCode[]

export function isTeamCode(v: string): v is TeamCode {
  return (TEAM_CODES as readonly string[]).includes(v)
}
export function isAccountRole(v: string): v is AccountRole {
  return (ACCOUNT_ROLES as readonly string[]).includes(v)
}

/** 비밀번호 정책 — 최소 8자(Supabase 기본 정책과 정합). */
export function isValidPassword(pw: unknown): boolean {
  return typeof pw === 'string' && pw.length >= 8
}

/** 일괄 등록 한 줄의 파싱 결과. ok=false 이면 error 에 사유. */
export interface ParsedAccountLine {
  lineNo: number          // 파일 기준 1-base 행번호(빈 줄 포함해 계산)
  raw: string
  ok: boolean
  email?: string
  teamCode?: TeamCode
  role?: AccountRole
  password?: string
  name?: string | null
  error?: string
}

/**
 * 일괄 붙여넣기 텍스트를 행 단위로 파싱·검증한다.
 * 형식: 고정 4열 `이메일, 팀코드, 권한, 초기비번` + 선택 5열 `이름`.
 * 구분자는 콤마 또는 탭(엑셀 붙여넣기 대응). 빈 줄은 결과에서 제외한다.
 * 주의: 초기비번에는 콤마·탭을 쓸 수 없다(구분자로 해석됨).
 */
export function parseBulkAccounts(text: string): ParsedAccountLine[] {
  const out: ParsedAccountLine[] = []
  const lines = text.split(/\r?\n/)
  lines.forEach((raw, i) => {
    const trimmed = raw.trim()
    if (!trimmed) return // 빈 줄 제외
    const lineNo = i + 1
    const cols = trimmed.split(/\s*[,\t]\s*/)
    const [email, teamCode, role, password, name] = cols
    if (cols.length < 4) {
      out.push({ lineNo, raw: trimmed, ok: false, error: '열 부족 — 이메일, 팀, 권한, 초기비번이 필요합니다.' })
      return
    }
    if (!isValidEmail(email)) {
      out.push({ lineNo, raw: trimmed, ok: false, email, error: '이메일 형식 오류' })
      return
    }
    if (!isTeamCode(teamCode)) {
      out.push({ lineNo, raw: trimmed, ok: false, email, error: `알 수 없는 팀: ${teamCode}` })
      return
    }
    if (!isAccountRole(role)) {
      out.push({ lineNo, raw: trimmed, ok: false, email, error: `알 수 없는 권한: ${role}` })
      return
    }
    if (!isValidPassword(password)) {
      out.push({ lineNo, raw: trimmed, ok: false, email, error: '비밀번호는 8자 이상이어야 합니다.' })
      return
    }
    out.push({
      lineNo, raw: trimmed, ok: true,
      email: email.trim(), teamCode, role, password,
      name: name?.trim() || null,
    })
  })
  return out
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npm test -- tests/domain/accounts.test.ts`
Expected: PASS (전체 통과).

- [ ] **Step 5: 커밋**

```bash
git add src/lib/domain/accounts.ts tests/domain/accounts.test.ts
git commit -m "feat(accounts): 계정 일괄등록 파서·검증 순수함수 추가"
```

---

## Task 2: 서버액션 (`src/app/actions/accounts.ts`)

**Files:**
- Create: `src/app/actions/accounts.ts`
- Test: `tests/actions/accounts-gate.test.ts`

- [ ] **Step 1: 권한 게이트 실패 테스트 작성**

Create `tests/actions/accounts-gate.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

// next/cache · auth · admin 클라이언트를 모킹해 게이트 로직만 검증한다.
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/lib/auth', () => ({ getMembership: vi.fn() }))
const createAdminClient = vi.fn(() => {
  throw new Error('createAdminClient 는 게이트 통과 전에 호출되면 안 된다')
})
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient }))

import { getMembership } from '@/lib/auth'
import {
  createAccount, bulkCreateAccounts, resetPassword, updateAccountRole,
} from '@/app/actions/accounts'

const NON_ADMIN = [null, { role: 'team_editor', teamCode: 'PMO', teamId: 't1' }] as const

describe('계정 서버액션 권한 게이트', () => {
  beforeEach(() => { createAdminClient.mockClear() })

  it.each(NON_ADMIN)('비-pmo_admin(%o)은 createAccount 거부', async (membership) => {
    vi.mocked(getMembership).mockResolvedValue(membership as never)
    const res = await createAccount({ email: 'a@b.com', password: 'password1', teamCode: 'PMO', role: 'team_editor', name: null })
    expect(res).toEqual({ ok: false, error: '권한 없음' })
    expect(createAdminClient).not.toHaveBeenCalled()
  })

  it('비-pmo_admin은 bulkCreateAccounts 거부', async () => {
    vi.mocked(getMembership).mockResolvedValue(null)
    const res = await bulkCreateAccounts('a@b.com,PMO,team_editor,password1')
    expect(res.ok).toBe(false)
    expect(res.error).toBe('권한 없음')
    expect(createAdminClient).not.toHaveBeenCalled()
  })

  it('비-pmo_admin은 resetPassword 거부', async () => {
    vi.mocked(getMembership).mockResolvedValue(null)
    expect(await resetPassword('u1', 'password1')).toEqual({ ok: false, error: '권한 없음' })
    expect(createAdminClient).not.toHaveBeenCalled()
  })

  it('비-pmo_admin은 updateAccountRole 거부', async () => {
    vi.mocked(getMembership).mockResolvedValue(null)
    expect(await updateAccountRole('u1', 'PMO', 'team_editor')).toEqual({ ok: false, error: '권한 없음' })
    expect(createAdminClient).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npm test -- tests/actions/accounts-gate.test.ts`
Expected: FAIL — `Cannot find module '@/app/actions/accounts'`.

- [ ] **Step 3: 서버액션 구현 작성**

Create `src/app/actions/accounts.ts`:

```ts
'use server'
import { revalidatePath } from 'next/cache'
import { getMembership } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { isValidEmail } from '@/lib/domain/validate'
import {
  isValidPassword, isTeamCode, isAccountRole, parseBulkAccounts, type AccountRole,
} from '@/lib/domain/accounts'
import type { TeamCode } from '@/lib/domain/types'

type AdminClient = ReturnType<typeof createAdminClient>

export interface AccountRow {
  id: string
  email: string
  name: string | null
  teamCode: TeamCode | null
  role: string | null      // 'pmo_admin' | 'team_editor' | null(멤버십 없음)
  createdAt: string
}

export interface AccountInput {
  email: string
  password: string
  teamCode: TeamCode
  role: AccountRole
  name: string | null
}

export interface AccountActionResult {
  ok: boolean
  error?: string
}

export interface BulkResultRow {
  lineNo: number
  email: string
  ok: boolean
  error?: string
}

async function isAdmin(): Promise<boolean> {
  const m = await getMembership()
  return m?.role === 'pmo_admin'
}

async function resolveTeamId(admin: AdminClient, teamCode: TeamCode): Promise<string | null> {
  const { data } = await admin.from('teams').select('id').eq('code', teamCode).single()
  return (data?.id as string | undefined) ?? null
}

/** 게이트/클라이언트 생성 이후 단건 생성 — bulk 에서 재사용(게이트 재검사 없음). */
async function createOne(admin: AdminClient, input: AccountInput): Promise<AccountActionResult> {
  if (!isValidEmail(input.email)) return { ok: false, error: '올바른 이메일 형식이 아닙니다.' }
  if (!isValidPassword(input.password)) return { ok: false, error: '비밀번호는 8자 이상이어야 합니다.' }
  if (!isTeamCode(input.teamCode)) return { ok: false, error: '알 수 없는 팀 코드' }
  if (!isAccountRole(input.role)) return { ok: false, error: '알 수 없는 권한' }

  const teamId = await resolveTeamId(admin, input.teamCode)
  if (!teamId) return { ok: false, error: '팀을 찾을 수 없습니다.' }

  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email: input.email.trim(),
    password: input.password,
    email_confirm: true, // SMTP 없이 즉시 로그인 가능하도록 확인 처리
    user_metadata: input.name ? { full_name: input.name } : {},
  })
  if (createErr || !created?.user) return { ok: false, error: createErr?.message ?? '계정 생성 실패' }

  const { error: memErr } = await admin.from('memberships').insert({
    user_id: created.user.id, team_id: teamId, role: input.role,
  })
  if (memErr) {
    // 보상 롤백 — 멤버십 없는 유령 계정 방지
    await admin.auth.admin.deleteUser(created.user.id)
    return { ok: false, error: '팀/권한 저장 실패: ' + memErr.message }
  }
  return { ok: true }
}

export async function createAccount(input: AccountInput): Promise<AccountActionResult> {
  if (!(await isAdmin())) return { ok: false, error: '권한 없음' }
  const admin = createAdminClient()
  const res = await createOne(admin, input)
  if (res.ok) revalidatePath('/admin/accounts')
  return res
}

export async function bulkCreateAccounts(
  text: string,
): Promise<{ ok: boolean; error?: string; results: BulkResultRow[] }> {
  if (!(await isAdmin())) return { ok: false, error: '권한 없음', results: [] }
  const admin = createAdminClient()
  const lines = parseBulkAccounts(text)
  if (lines.length === 0) return { ok: false, error: '처리할 행이 없습니다.', results: [] }

  const results: BulkResultRow[] = []
  for (const line of lines) {
    if (!line.ok) {
      results.push({ lineNo: line.lineNo, email: line.email ?? line.raw, ok: false, error: line.error })
      continue
    }
    const res = await createOne(admin, {
      email: line.email!, password: line.password!, teamCode: line.teamCode!, role: line.role!, name: line.name ?? null,
    })
    results.push({ lineNo: line.lineNo, email: line.email!, ok: res.ok, error: res.error })
  }
  revalidatePath('/admin/accounts')
  return { ok: true, results }
}

export async function resetPassword(userId: string, password: string): Promise<AccountActionResult> {
  if (!(await isAdmin())) return { ok: false, error: '권한 없음' }
  if (!isValidPassword(password)) return { ok: false, error: '비밀번호는 8자 이상이어야 합니다.' }
  const admin = createAdminClient()
  const { error } = await admin.auth.admin.updateUserById(userId, { password })
  if (error) return { ok: false, error: error.message }
  return { ok: true }
}

export async function updateAccountRole(
  userId: string, teamCode: string, role: string,
): Promise<AccountActionResult> {
  if (!(await isAdmin())) return { ok: false, error: '권한 없음' }
  if (!isTeamCode(teamCode)) return { ok: false, error: '알 수 없는 팀 코드' }
  if (!isAccountRole(role)) return { ok: false, error: '알 수 없는 권한' }
  const admin = createAdminClient()
  const teamId = await resolveTeamId(admin, teamCode)
  if (!teamId) return { ok: false, error: '팀을 찾을 수 없습니다.' }
  // memberships PK 는 user_id — 없으면 삽입, 있으면 갱신
  const { error } = await admin
    .from('memberships')
    .upsert({ user_id: userId, team_id: teamId, role }, { onConflict: 'user_id' })
  if (error) return { ok: false, error: error.message }
  revalidatePath('/admin/accounts')
  return { ok: true }
}

export async function listAccounts(): Promise<AccountRow[]> {
  if (!(await isAdmin())) return []
  const admin = createAdminClient()

  // 1) auth.users 전체 수집(페이지네이션)
  type RawUser = { id: string; email: string; created_at: string; full_name: string | null }
  const users: RawUser[] = []
  const perPage = 200
  for (let page = 1; ; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage })
    if (error || !data) break
    for (const u of data.users) {
      users.push({
        id: u.id,
        email: u.email ?? '',
        created_at: u.created_at,
        full_name: (u.user_metadata?.full_name as string | undefined) ?? null,
      })
    }
    if (data.users.length < perPage) break
  }

  // 2) memberships + teams 조인
  const { data: mems } = await admin.from('memberships').select('user_id, role, teams(code)')
  const byUser = new Map<string, { role: string; teamCode: TeamCode | null }>()
  for (const row of mems ?? []) {
    const team = row.teams as unknown as { code: TeamCode } | null
    byUser.set(row.user_id as string, { role: row.role as string, teamCode: team?.code ?? null })
  }

  return users
    .map<AccountRow>((u) => ({
      id: u.id,
      email: u.email,
      name: u.full_name,
      teamCode: byUser.get(u.id)?.teamCode ?? null,
      role: byUser.get(u.id)?.role ?? null,
      createdAt: u.created_at,
    }))
    .sort((a, b) => a.email.localeCompare(b.email))
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npm test -- tests/actions/accounts-gate.test.ts`
Expected: PASS (게이트 거부 4종 통과).

- [ ] **Step 5: 타입 체크**

Run: `npx tsc --noEmit`
Expected: 에러 없음.

- [ ] **Step 6: 커밋**

```bash
git add src/app/actions/accounts.ts tests/actions/accounts-gate.test.ts
git commit -m "feat(accounts): 계정 생성/일괄/리셋/권한수정/목록 서버액션 추가"
```

---

## Task 3: 관리 페이지 서버컴포넌트 (`src/app/(app)/admin/accounts/page.tsx`)

**Files:**
- Create: `src/app/(app)/admin/accounts/page.tsx`

- [ ] **Step 1: 페이지 구현 작성**

Create `src/app/(app)/admin/accounts/page.tsx`:

```tsx
import { redirect } from 'next/navigation'
import { ShieldCheck, Users, UserCog } from 'lucide-react'
import { getMembership } from '@/lib/auth'
import { listAccounts } from '@/app/actions/accounts'
import { PageHero, HeroBadge } from '@/components/ui/PageHero'
import { KpiCard } from '@/components/ui/KpiCard'
import { AccountsManager } from '@/components/admin/AccountsManager'

export const dynamic = 'force-dynamic' // 목록은 항상 최신(admin API) 조회

export default async function AccountsAdminPage() {
  const m = await getMembership()
  if (m?.role !== 'pmo_admin') redirect('/projects')

  const accounts = await listAccounts()
  const total = accounts.length
  const admins = accounts.filter((a) => a.role === 'pmo_admin').length
  const editors = accounts.filter((a) => a.role === 'team_editor').length

  return (
    <div className="space-y-6">
      <PageHero
        eyebrow="ADMIN"
        badge={<HeroBadge>Accounts</HeroBadge>}
        title="계정 관리"
        description="로그인 계정을 만들고 팀·권한을 지정하거나 비밀번호를 리셋합니다."
        heroKpis={
          <>
            <KpiCard variant="hero" label="ACCOUNTS" value={total} sub="전체 로그인 계정" icon={Users} tone="brand" />
            <KpiCard variant="hero" label="PMO ADMIN" value={admins} sub="관리자" icon={ShieldCheck} tone="success" />
            <KpiCard variant="hero" label="TEAM EDITOR" value={editors} sub="팀 편집자" icon={UserCog} tone="default" />
          </>
        }
      />
      <AccountsManager accounts={accounts} />
    </div>
  )
}
```

- [ ] **Step 2: 타입 체크 (AccountsManager 미구현이므로 임시 확인)**

Run: `npx tsc --noEmit`
Expected: `Cannot find module '@/components/admin/AccountsManager'` 한 건만 남는다(Task 4에서 해소). 다른 에러가 있으면 수정한다.

- [ ] **Step 3: 커밋 (Task 4와 함께 빌드되므로 커밋은 Task 4 끝에서)**

이 파일은 단독으로 빌드되지 않는다(AccountsManager 의존). Task 4 완료 후 함께 커밋한다.

---

## Task 4: 계정 관리 클라이언트 (`src/components/admin/AccountsManager.tsx`)

**Files:**
- Create: `src/components/admin/AccountsManager.tsx`

- [ ] **Step 1: 컴포넌트 구현 작성**

Create `src/components/admin/AccountsManager.tsx`:

```tsx
'use client'

import { useEffect, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { UserPlus, Upload, KeyRound, UserCog, ShieldCheck, UserRound, Wand2 } from 'lucide-react'
import { Modal } from '@/components/ui/Modal'
import { EmptyState } from '@/components/ui/EmptyState'
import { useToast } from '@/components/ui/Toast'
import {
  createAccount, bulkCreateAccounts, resetPassword, updateAccountRole,
  type AccountRow, type BulkResultRow,
} from '@/app/actions/accounts'
import { TEAM_CODES, ACCOUNT_ROLES, type AccountRole } from '@/lib/domain/accounts'
import { isValidEmail } from '@/lib/domain/validate'
import type { TeamCode } from '@/lib/domain/types'

const TEAM_OPTIONS = TEAM_CODES as readonly TeamCode[]
const ROLE_LABEL: Record<string, string> = { pmo_admin: 'PMO 관리자', team_editor: '팀 편집자' }

/** 브라우저 crypto 로 임시 비밀번호(12자) 생성 — 리셋/추가 시 [생성] 버튼용. */
function randomPassword(): string {
  const chars = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  const arr = new Uint32Array(12)
  crypto.getRandomValues(arr)
  return Array.from(arr, (n) => chars[n % chars.length]).join('')
}

export function AccountsManager({ accounts }: { accounts: AccountRow[] }) {
  const [addOpen, setAddOpen] = useState(false)
  const [bulkOpen, setBulkOpen] = useState(false)
  const [resetting, setResetting] = useState<AccountRow | null>(null)
  const [editing, setEditing] = useState<AccountRow | null>(null)

  return (
    <div className="card overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-4 sm:px-6">
        <div>
          <div className="eyebrow">Account board</div>
          <h2 className="mt-0.5 text-sm font-semibold text-ink">로그인 계정 · {accounts.length}개</h2>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setBulkOpen(true)} className="btn btn-ghost">
            <Upload className="h-4 w-4" />일괄 추가
          </button>
          <button onClick={() => setAddOpen(true)} className="btn btn-primary">
            <UserPlus className="h-4 w-4" />계정 추가
          </button>
        </div>
      </div>

      <div className="p-5 sm:p-6">
        {accounts.length === 0 ? (
          <EmptyState
            icon={UserRound}
            title="계정이 없습니다"
            description="계정 추가 또는 일괄 추가로 로그인 계정을 만드세요."
            action={<button onClick={() => setAddOpen(true)} className="btn btn-primary"><UserPlus className="h-4 w-4" />계정 추가</button>}
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead>
                <tr className="border-b border-line text-left text-xs font-semibold uppercase tracking-wide text-ink-subtle">
                  <th className="py-2 pr-3">이메일</th>
                  <th className="py-2 pr-3">이름</th>
                  <th className="py-2 pr-3">팀</th>
                  <th className="py-2 pr-3">권한</th>
                  <th className="py-2 pr-3">생성일</th>
                  <th className="py-2 pr-3 text-right">작업</th>
                </tr>
              </thead>
              <tbody>
                {accounts.map((a) => (
                  <tr key={a.id} className="border-b border-line/60">
                    <td className="py-2.5 pr-3 font-medium text-ink">{a.email}</td>
                    <td className="py-2.5 pr-3 text-ink-muted">{a.name ?? '—'}</td>
                    <td className="py-2.5 pr-3">
                      {a.teamCode ? <span className="chip bg-surface-2 text-ink-muted">{a.teamCode}</span> : <span className="text-ink-subtle">—</span>}
                    </td>
                    <td className="py-2.5 pr-3">
                      {a.role ? (
                        <span className={`chip ${a.role === 'pmo_admin' ? 'bg-brand-weak text-brand' : 'bg-progress-weak text-progress'}`}>
                          {a.role === 'pmo_admin' ? <ShieldCheck className="h-3 w-3" /> : <UserRound className="h-3 w-3" />}
                          {ROLE_LABEL[a.role] ?? a.role}
                        </span>
                      ) : (
                        <span className="chip bg-delayed-weak text-delayed">미지정</span>
                      )}
                    </td>
                    <td className="py-2.5 pr-3 text-ink-subtle">{a.createdAt.slice(0, 10)}</td>
                    <td className="py-2.5 pr-3">
                      <div className="flex items-center justify-end gap-1.5">
                        <button onClick={() => setEditing(a)} className="btn btn-ghost btn-sm" title="팀·권한 수정">
                          <UserCog className="h-3.5 w-3.5" />권한
                        </button>
                        <button onClick={() => setResetting(a)} className="btn btn-ghost btn-sm" title="비밀번호 리셋">
                          <KeyRound className="h-3.5 w-3.5" />비번 리셋
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <AddAccountModal open={addOpen} onClose={() => setAddOpen(false)} />
      <BulkAddModal open={bulkOpen} onClose={() => setBulkOpen(false)} />
      <ResetPasswordModal account={resetting} onClose={() => setResetting(null)} />
      <RoleEditModal account={editing} onClose={() => setEditing(null)} />
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-semibold text-ink-muted">{label}</span>
      {children}
    </label>
  )
}

function AddAccountModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const router = useRouter()
  const { toast } = useToast()
  const [email, setEmail] = useState('')
  const [name, setName] = useState('')
  const [teamCode, setTeamCode] = useState<TeamCode>('PMO')
  const [role, setRole] = useState<AccountRole>('team_editor')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  useEffect(() => {
    if (!open) return
    setEmail(''); setName(''); setTeamCode('PMO'); setRole('team_editor'); setPassword(''); setError(null)
  }, [open])

  function submit() {
    setError(null)
    if (!isValidEmail(email)) { setError('올바른 이메일을 입력하세요.'); return }
    if (password.length < 8) { setError('초기 비밀번호는 8자 이상이어야 합니다.'); return }
    startTransition(async () => {
      const res = await createAccount({ email: email.trim(), password, teamCode, role, name: name.trim() || null })
      if (res.ok) {
        toast({ title: '계정을 만들었습니다.', description: email.trim(), variant: 'success' })
        onClose(); router.refresh()
      } else {
        setError(res.error ?? '생성 실패')
      }
    })
  }

  return (
    <Modal
      open={open} onClose={onClose} eyebrow="New account" title="계정 추가"
      footer={
        <>
          <button onClick={onClose} className="btn btn-ghost" disabled={pending}>취소</button>
          <button onClick={submit} className="btn btn-primary" disabled={pending}>{pending ? '생성 중…' : '계정 만들기'}</button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="이메일 (로그인 아이디)">
          <input className="app-input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="user@company.com" autoFocus />
        </Field>
        <Field label="이름 (선택)">
          <input className="app-input" value={name} onChange={(e) => setName(e.target.value)} placeholder="홍길동" />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="팀">
            <select className="app-input" value={teamCode} onChange={(e) => setTeamCode(e.target.value as TeamCode)}>
              {TEAM_OPTIONS.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </Field>
          <Field label="권한">
            <select className="app-input" value={role} onChange={(e) => setRole(e.target.value as AccountRole)}>
              {ACCOUNT_ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
            </select>
          </Field>
        </div>
        <Field label="초기 비밀번호 (8자 이상)">
          <div className="flex gap-2">
            <input className="app-input" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="초기 비밀번호" />
            <button type="button" onClick={() => setPassword(randomPassword())} className="btn btn-ghost shrink-0"><Wand2 className="h-4 w-4" />생성</button>
          </div>
        </Field>
        {error && <p role="alert" className="text-sm font-medium text-delayed">{error}</p>}
      </div>
    </Modal>
  )
}

function BulkAddModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const router = useRouter()
  const [text, setText] = useState('')
  const [results, setResults] = useState<BulkResultRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  useEffect(() => {
    if (!open) return
    setText(''); setResults(null); setError(null)
  }, [open])

  function submit() {
    setError(null); setResults(null)
    startTransition(async () => {
      const res = await bulkCreateAccounts(text)
      if (!res.ok) { setError(res.error ?? '처리 실패'); return }
      setResults(res.results)
      router.refresh() // 성공분을 목록에 반영
    })
  }

  const okCount = results?.filter((r) => r.ok).length ?? 0
  const failCount = results?.filter((r) => !r.ok).length ?? 0

  return (
    <Modal
      open={open} onClose={onClose} eyebrow="Bulk create" title="일괄 추가" size="lg"
      footer={
        <>
          <button onClick={onClose} className="btn btn-ghost" disabled={pending}>닫기</button>
          <button onClick={submit} className="btn btn-primary" disabled={pending || !text.trim()}>{pending ? '처리 중…' : '일괄 생성'}</button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="rounded-xl bg-surface-2 px-3.5 py-3 text-xs leading-5 text-ink-muted">
          한 줄에 하나씩, <b>이메일, 팀코드, 권한, 초기비번</b> 순서(선택: 이름). 콤마 또는 탭 구분.<br />
          팀코드: <code>PMO · 가공 · ERP · MES</code> / 권한: <code>pmo_admin · team_editor</code><br />
          예) <code>hong@company.com, 가공, team_editor, password1, 홍길동</code>
        </div>
        <textarea
          className="app-input min-h-[160px] font-mono text-[13px]"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={'user1@company.com, PMO, team_editor, password1\nuser2@company.com, 가공, team_editor, password2, 김철수'}
        />
        {error && <p role="alert" className="text-sm font-medium text-delayed">{error}</p>}
        {results && (
          <div>
            <div className="mb-2 text-sm font-semibold text-ink">결과 — 성공 {okCount} · 실패 {failCount}</div>
            <div className="max-h-52 overflow-y-auto rounded-xl border border-line">
              <table className="w-full text-xs">
                <tbody>
                  {results.map((r, i) => (
                    <tr key={i} className="border-b border-line/60 last:border-0">
                      <td className="px-3 py-1.5 text-ink-subtle">{r.lineNo}행</td>
                      <td className="px-3 py-1.5 text-ink">{r.email}</td>
                      <td className="px-3 py-1.5">
                        {r.ok
                          ? <span className="chip bg-done-weak text-done">성공</span>
                          : <span className="chip bg-delayed-weak text-delayed" title={r.error}>실패</span>}
                      </td>
                      <td className="px-3 py-1.5 text-ink-muted">{r.error ?? ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </Modal>
  )
}

function ResetPasswordModal({ account, onClose }: { account: AccountRow | null; onClose: () => void }) {
  const { toast } = useToast()
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  useEffect(() => {
    if (account) { setPassword(randomPassword()); setError(null) }
  }, [account])

  function submit() {
    setError(null)
    if (!account) return
    if (password.length < 8) { setError('임시 비밀번호는 8자 이상이어야 합니다.'); return }
    startTransition(async () => {
      const res = await resetPassword(account.id, password)
      if (res.ok) {
        toast({ title: '비밀번호를 리셋했습니다.', description: '아래 임시 비밀번호를 사용자에게 전달하세요.', variant: 'success' })
        onClose()
      } else {
        setError(res.error ?? '리셋 실패')
      }
    })
  }

  return (
    <Modal
      open={!!account} onClose={onClose} eyebrow="Reset password" title="비밀번호 리셋"
      footer={
        <>
          <button onClick={onClose} className="btn btn-ghost" disabled={pending}>취소</button>
          <button onClick={submit} className="btn btn-primary" disabled={pending}>{pending ? '적용 중…' : '리셋'}</button>
        </>
      }
    >
      <div className="space-y-4">
        <p className="text-sm text-ink-muted"><b className="text-ink">{account?.email}</b> 의 비밀번호를 임시값으로 변경합니다. 사용자는 로그인 후 본인이 변경하게 하세요.</p>
        <Field label="임시 비밀번호 (8자 이상)">
          <div className="flex gap-2">
            <input className="app-input" value={password} onChange={(e) => setPassword(e.target.value)} />
            <button type="button" onClick={() => setPassword(randomPassword())} className="btn btn-ghost shrink-0"><Wand2 className="h-4 w-4" />생성</button>
          </div>
        </Field>
        {error && <p role="alert" className="text-sm font-medium text-delayed">{error}</p>}
      </div>
    </Modal>
  )
}

function RoleEditModal({ account, onClose }: { account: AccountRow | null; onClose: () => void }) {
  const router = useRouter()
  const { toast } = useToast()
  const [teamCode, setTeamCode] = useState<TeamCode>('PMO')
  const [role, setRole] = useState<AccountRole>('team_editor')
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  useEffect(() => {
    if (!account) return
    setTeamCode((account.teamCode as TeamCode) ?? 'PMO')
    setRole((account.role as AccountRole) === 'pmo_admin' ? 'pmo_admin' : 'team_editor')
    setError(null)
  }, [account])

  function submit() {
    setError(null)
    if (!account) return
    startTransition(async () => {
      const res = await updateAccountRole(account.id, teamCode, role)
      if (res.ok) {
        toast({ title: '팀·권한을 변경했습니다.', variant: 'success' })
        onClose(); router.refresh()
      } else {
        setError(res.error ?? '변경 실패')
      }
    })
  }

  return (
    <Modal
      open={!!account} onClose={onClose} eyebrow="Team & role" title="팀·권한 수정"
      footer={
        <>
          <button onClick={onClose} className="btn btn-ghost" disabled={pending}>취소</button>
          <button onClick={submit} className="btn btn-primary" disabled={pending}>{pending ? '저장 중…' : '저장'}</button>
        </>
      }
    >
      <div className="space-y-4">
        <p className="text-sm text-ink-muted"><b className="text-ink">{account?.email}</b></p>
        <div className="grid grid-cols-2 gap-3">
          <Field label="팀">
            <select className="app-input" value={teamCode} onChange={(e) => setTeamCode(e.target.value as TeamCode)}>
              {TEAM_OPTIONS.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </Field>
          <Field label="권한">
            <select className="app-input" value={role} onChange={(e) => setRole(e.target.value as AccountRole)}>
              {ACCOUNT_ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
            </select>
          </Field>
        </div>
        {error && <p role="alert" className="text-sm font-medium text-delayed">{error}</p>}
      </div>
    </Modal>
  )
}
```

- [ ] **Step 2: 타입 체크**

Run: `npx tsc --noEmit`
Expected: 에러 없음. (`btn-sm` 클래스가 없으면 시각적 크기만 다르고 타입 에러는 아님 — 무시 가능. Task 8에서 육안 확인.)

- [ ] **Step 3: 커밋 (Task 3 페이지 + Task 4 컴포넌트 함께)**

```bash
git add "src/app/(app)/admin/accounts/page.tsx" src/components/admin/AccountsManager.tsx
git commit -m "feat(accounts): /admin/accounts 관리 화면(목록·추가·일괄·리셋·권한수정)"
```

---

## Task 5: 본인 비밀번호 변경 모달 (`src/components/account/ChangePasswordModal.tsx`)

**Files:**
- Create: `src/components/account/ChangePasswordModal.tsx`

- [ ] **Step 1: 컴포넌트 구현 작성**

Create `src/components/account/ChangePasswordModal.tsx`:

```tsx
'use client'

import { useEffect, useState, useTransition } from 'react'
import { Modal } from '@/components/ui/Modal'
import { useToast } from '@/components/ui/Toast'
import { createBrowserClient } from '@/lib/supabase/client'

/**
 * 로그인한 본인의 비밀번호 변경. 현재 비밀번호 재확인(signInWithPassword) 후
 * updateUser 로 변경한다. 이메일은 현재 세션에서 조회하므로 별도 prop 불필요.
 */
export function ChangePasswordModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { toast } = useToast()
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  useEffect(() => {
    if (!open) return
    setCurrent(''); setNext(''); setConfirm(''); setError(null)
  }, [open])

  function submit() {
    setError(null)
    if (next.length < 8) { setError('새 비밀번호는 8자 이상이어야 합니다.'); return }
    if (next !== confirm) { setError('새 비밀번호가 일치하지 않습니다.'); return }
    startTransition(async () => {
      const sb = createBrowserClient()
      const { data } = await sb.auth.getUser()
      const email = data.user?.email
      if (!email) { setError('세션을 확인할 수 없습니다. 다시 로그인해 주세요.'); return }
      // 현재 비밀번호 재확인(같은 사용자 재로그인 — 세션 유지)
      const { error: reauth } = await sb.auth.signInWithPassword({ email, password: current })
      if (reauth) { setError('현재 비밀번호가 올바르지 않습니다.'); return }
      const { error: updErr } = await sb.auth.updateUser({ password: next })
      if (updErr) { setError(updErr.message); return }
      toast({ title: '비밀번호가 변경되었습니다.', variant: 'success' })
      onClose()
    })
  }

  return (
    <Modal
      open={open} onClose={onClose} eyebrow="Security" title="비밀번호 변경"
      footer={
        <>
          <button onClick={onClose} className="btn btn-ghost" disabled={pending}>취소</button>
          <button onClick={submit} className="btn btn-primary" disabled={pending}>{pending ? '변경 중…' : '변경'}</button>
        </>
      }
    >
      <div className="space-y-4">
        <label className="block">
          <span className="mb-1.5 block text-xs font-semibold text-ink-muted">현재 비밀번호</span>
          <input className="app-input" type="password" value={current} onChange={(e) => setCurrent(e.target.value)} autoComplete="current-password" autoFocus />
        </label>
        <label className="block">
          <span className="mb-1.5 block text-xs font-semibold text-ink-muted">새 비밀번호 (8자 이상)</span>
          <input className="app-input" type="password" value={next} onChange={(e) => setNext(e.target.value)} autoComplete="new-password" />
        </label>
        <label className="block">
          <span className="mb-1.5 block text-xs font-semibold text-ink-muted">새 비밀번호 확인</span>
          <input className="app-input" type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" />
        </label>
        {error && <p role="alert" className="text-sm font-medium text-delayed">{error}</p>}
      </div>
    </Modal>
  )
}
```

- [ ] **Step 2: 타입 체크**

Run: `npx tsc --noEmit`
Expected: 에러 없음.

- [ ] **Step 3: 커밋**

```bash
git add src/components/account/ChangePasswordModal.tsx
git commit -m "feat(account): 본인 비밀번호 변경 모달"
```

---

## Task 6: 헤더 프로필 메뉴 연결 (`src/components/app/HeaderChrome.tsx`)

**Files:**
- Modify: `src/components/app/HeaderChrome.tsx`

- [ ] **Step 1: import 추가**

기존 import 블록에서 lucide 아이콘 목록에 `KeyRound`, `UserCog` 를 추가하고, 컴포넌트 import 두 줄을 추가한다.

lucide import 줄을 다음으로 교체:

```tsx
import {
  AlertTriangle, Bell, ChevronRight, Clock4, Globe, KeyRound, LogOut, Menu, Moon, Sun, User, UserCog, X,
} from 'lucide-react'
```

`import type { SidebarProject } from './Sidebar'` 아래에 추가:

```tsx
import { ChangePasswordModal } from '@/components/account/ChangePasswordModal'
```

- [ ] **Step 2: 비밀번호 모달 상태 추가**

`const [open, setOpen] = useState<null | 'notif' | 'profile'>(null)` 아래에 추가:

```tsx
  const [pwOpen, setPwOpen] = useState(false)
```

- [ ] **Step 3: 프로필 팝오버에 메뉴 항목 추가**

프로필 `Popover` 내부에서 기존 로그아웃 버튼:

```tsx
                  <button onClick={signOut} className="flex w-full items-center gap-2 px-4 py-3 text-left text-sm text-ink-muted transition hover:bg-surface-2 hover:text-delayed">
                    <LogOut className="h-4 w-4" />{t('chrome.logout')}
                  </button>
```

을 다음으로 교체(위에 "비밀번호 변경"·조건부 "계정 관리" 추가):

```tsx
                  <button onClick={() => { setOpen(null); setPwOpen(true) }} className="flex w-full items-center gap-2 px-4 py-3 text-left text-sm text-ink-muted transition hover:bg-surface-2 hover:text-ink">
                    <KeyRound className="h-4 w-4" />비밀번호 변경
                  </button>
                  {membership?.role === 'pmo_admin' && (
                    <Link href="/admin/accounts" onClick={() => setOpen(null)} className="flex w-full items-center gap-2 border-t border-line px-4 py-3 text-left text-sm text-ink-muted transition hover:bg-surface-2 hover:text-ink">
                      <UserCog className="h-4 w-4" />계정 관리
                    </Link>
                  )}
                  <button onClick={signOut} className="flex w-full items-center gap-2 border-t border-line px-4 py-3 text-left text-sm text-ink-muted transition hover:bg-surface-2 hover:text-delayed">
                    <LogOut className="h-4 w-4" />{t('chrome.logout')}
                  </button>
```

- [ ] **Step 4: 모달 렌더**

컴포넌트 최상위 반환의 닫는 `</>` 직전(모바일 메뉴 `{menuOpen && <MobileMenu ... />}` 다음 줄)에 추가:

```tsx
      <ChangePasswordModal open={pwOpen} onClose={() => setPwOpen(false)} />
```

- [ ] **Step 5: 타입 체크 + 린트**

Run: `npx tsc --noEmit && npm run lint`
Expected: 에러 없음.

- [ ] **Step 6: 커밋**

```bash
git add src/components/app/HeaderChrome.tsx
git commit -m "feat(account): 프로필 메뉴에 비밀번호 변경·계정 관리 연결"
```

---

## Task 7: 로그인 화면 안내 문구 (`src/app/login/page.tsx`)

**Files:**
- Modify: `src/app/login/page.tsx`

- [ ] **Step 1: 안내 문구 추가**

로그인 폼의 제출 버튼(`<button type="submit" ...>…로그인…</button>`)을 감싼 닫는 `</button>` 다음, `</form>` 이전에 안내 문구를 추가한다. 아래 블록에서:

```tsx
                <LogIn className="h-4 w-4" />
                {loading ? '로그인 중…' : '로그인'}
              </button>
            </form>
```

를 다음으로 교체:

```tsx
                <LogIn className="h-4 w-4" />
                {loading ? '로그인 중…' : '로그인'}
              </button>

              <p className="pt-1 text-center text-[13px] leading-5 text-[#7a6f68]">
                아이디(이메일) 또는 비밀번호를 잊으셨다면 관리자에게 문의하세요.
              </p>
            </form>
```

- [ ] **Step 2: 타입 체크 + 린트**

Run: `npx tsc --noEmit && npm run lint`
Expected: 에러 없음.

- [ ] **Step 3: 커밋**

```bash
git add src/app/login/page.tsx
git commit -m "feat(login): 아이디/비번 분실 시 관리자 문의 안내 문구"
```

---

## Task 8: 전체 검증

**Files:** 없음(검증만)

- [ ] **Step 1: 단위테스트 전체 통과**

Run: `npm test`
Expected: 신규 `tests/domain/accounts.test.ts`, `tests/actions/accounts-gate.test.ts` 포함 전체 PASS.

- [ ] **Step 2: 타입 + 린트 + 빌드**

Run: `npx tsc --noEmit && npm run lint && npm run build`
Expected: 에러 없음. `/admin/accounts` 라우트가 빌드 산출물에 포함됨.

- [ ] **Step 3: 수동 스모크 (dev 서버)**

Run: `npm run dev` 후 브라우저에서 확인:
1. **계정 생성**: pmo_admin 으로 로그인 → 프로필 메뉴 → 계정 관리 → 계정 추가(이메일/팀/권한/초기비번) → 성공 토스트. 새 이메일/비번으로 로그아웃 후 로그인 → `/projects` 진입되고 팀·권한 반영 확인.
2. **일괄 추가**: 2~3줄 붙여넣기(1줄은 일부러 잘못된 팀코드) → 결과 표에 성공/실패가 행별로 표시되고, 성공분만 목록에 추가됨.
3. **비번 변경**: 임의 계정으로 로그인 → 프로필 메뉴 → 비밀번호 변경(현재 비번 틀리게 → 거부 확인, 맞게 → 성공) → 로그아웃 후 새 비번으로 로그인.
4. **비번 리셋**: pmo_admin 으로 계정 관리 → 대상 행 [비번 리셋] → 임시비번 적용 → 그 계정으로 로그인 확인.
5. **권한 게이트**: team_editor 계정으로 로그인 → 프로필 메뉴에 "계정 관리" 미노출, 주소창에 `/admin/accounts` 직접 입력 시 `/projects` 로 리다이렉트.
6. **로그인 안내 문구**: 로그아웃 상태에서 로그인 화면 하단 안내 문구 노출.

- [ ] **Step 4: 최종 커밋(있으면)**

수동 확인 중 수정이 있었다면 커밋. 없으면 생략.

```bash
git status
```

---

## Self-Review (계획 작성자 확인 완료)

**1. Spec coverage:** 스펙 §4 A(계정관리)→Task 2·3·4, B(비번변경)→Task 5·6, C(비번찾기=관리자리셋)→Task 4 ResetPasswordModal + Task 2 resetPassword, D(아이디찾기 안내)→Task 7. §5 보안(2중 게이트·admin 클라이언트·부분실패 롤백·중복처리)→Task 2. §7 테스트→Task 1·2. §9 완료기준 8개→Task 8 스모크로 커버. 누락 없음.

**2. Placeholder scan:** "TBD/TODO/적절히" 없음. 모든 코드 스텝에 완전한 코드 포함.

**3. Type consistency:** `AccountRow`/`AccountInput`/`BulkResultRow`/`AccountRole` 는 Task 2에서 정의하고 Task 3·4에서 동일 이름으로 import. `TEAM_CODES`/`ACCOUNT_ROLES`/`isTeamCode`/`isAccountRole`/`isValidPassword`/`parseBulkAccounts` 는 Task 1 정의 ↔ Task 2·4 사용 시그니처 일치. 서버액션명(`createAccount`/`bulkCreateAccounts`/`resetPassword`/`updateAccountRole`/`listAccounts`)이 Task 2 정의 ↔ Task 3·4 호출과 일치.

**주의 사항(구현자 참고):**
- 서버액션은 반드시 service_role 키(`SUPABASE_SERVICE_ROLE_KEY`)가 있어야 동작한다. 로컬 `.env.local` 에 설정돼 있는지 먼저 확인.
- `btn-sm` 유틸 클래스가 프로젝트에 없을 수 있다. 없으면 육안상 버튼이 클 뿐 기능/타입 문제는 없다. 필요 시 기존 `btn` 만 사용하도록 축소.
