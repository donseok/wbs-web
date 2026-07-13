# 회의록 외부 링크 공유 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 회의록 뷰어에서 비로그인 외부 열람 링크(켜기/끄기/재발급)를 발급하는 구글식 공유 기능.

**Architecture:** `minutes`에 `share_token/share_enabled` 컬럼을 추가하고, 비로그인 조회는 `/share/minutes/[token]` 서버 컴포넌트가 service_role(`createAdminClient`)로 정확 일치 조회만 수행한다(anon RLS 정책 없음). 토글/재발급은 서버 액션 + 기존 `update_own_minutes` RLS. 공개 뷰는 `MarkdownView`/`MinuteToc` 재사용 미니멀 셸.

**Tech Stack:** Next.js App Router(서버 액션·서버 컴포넌트), Supabase(postgres RLS, service_role), vitest.

## Global Constraints

- 스펙: `docs/superpowers/specs/2026-07-13-minutes-share-link-design.md`
- 공개 페이지 반환 컬럼 화이트리스트: `minute_date, team_code, title, body_md` 만 — 작성자 실명·첨부·하이라이트·인사이트 절대 미노출
- anon용 RLS 정책·RPC 추가 금지(열거 표면 차단)
- 커밋 시 `git add -A` 금지 — 파일 명시(병렬 세션 규칙)
- 마이그레이션 파일은 멱등(if not exists) 작성, 프로덕션 적용은 배포 단계에서 별도(Management API)
- i18n: 새 UI 문자열은 `src/lib/i18n/dict/minutes.ts` ko/en 양쪽에 추가

---

### Task 1: 공유 상태 전이 순수 로직 + 마이그레이션 0026

**Files:**
- Create: `supabase/migrations/0026_minute_share.sql`
- Create: `src/lib/minutes/share.ts`
- Test: `tests/minutes/share.test.ts`

**Interfaces:**
- Produces: `isShareToken(s: string): boolean`, `nextShareState(cur: ShareState, op: ShareOp, newToken: string): ShareState`, `interface ShareState { token: string | null; enabled: boolean }`, `type ShareOp = 'enable' | 'disable' | 'regenerate'` — Task 2·3이 import.

- [ ] **Step 1: 실패하는 테스트 작성**

```ts
// tests/minutes/share.test.ts
import { describe, expect, it } from 'vitest'
import { isShareToken, nextShareState } from '@/lib/minutes/share'

const T1 = '3f2b8c1e-9a4d-4e7b-8c2f-1d5e6a7b8c9d'
const T2 = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d'

describe('isShareToken', () => {
  it('UUID v4 형식만 통과', () => {
    expect(isShareToken(T1)).toBe(true)
    expect(isShareToken('abc')).toBe(false)
    expect(isShareToken('')).toBe(false)
    expect(isShareToken(`${T1}'; drop table minutes;--`)).toBe(false)
  })
})

describe('nextShareState', () => {
  it('enable: 토큰 없으면 새 토큰 발급', () => {
    expect(nextShareState({ token: null, enabled: false }, 'enable', T2))
      .toEqual({ token: T2, enabled: true })
  })
  it('enable: 기존 토큰 보존(disable 후 재개 시 동일 링크)', () => {
    expect(nextShareState({ token: T1, enabled: false }, 'enable', T2))
      .toEqual({ token: T1, enabled: true })
  })
  it('disable: 끄되 토큰 보존', () => {
    expect(nextShareState({ token: T1, enabled: true }, 'disable', T2))
      .toEqual({ token: T1, enabled: false })
  })
  it('regenerate: 토큰 교체 + enabled 유지', () => {
    expect(nextShareState({ token: T1, enabled: true }, 'regenerate', T2))
      .toEqual({ token: T2, enabled: true })
  })
})
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npx vitest run tests/minutes/share.test.ts`
Expected: FAIL — `Cannot find module '@/lib/minutes/share'` 계열

- [ ] **Step 3: 최소 구현**

```ts
// src/lib/minutes/share.ts
/** 외부 링크 공유 상태 전이 — 서버 액션(setMinuteShare)과 공개 라우트가 공유하는 순수 로직. */

export interface ShareState { token: string | null; enabled: boolean }
export type ShareOp = 'enable' | 'disable' | 'regenerate'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** 공개 라우트 토큰 형식 검증 — DB 조회 전 비정상 입력 차단. */
export function isShareToken(s: string): boolean {
  return UUID_RE.test(s)
}

/** disable 이 토큰을 보존하는 이유: 다시 켜면 같은 링크가 살아나는 구글 공유 감각. 무효화는 regenerate 로만. */
export function nextShareState(cur: ShareState, op: ShareOp, newToken: string): ShareState {
  switch (op) {
    case 'enable': return { token: cur.token ?? newToken, enabled: true }
    case 'disable': return { token: cur.token, enabled: false }
    case 'regenerate': return { token: newToken, enabled: cur.enabled }
  }
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npx vitest run tests/minutes/share.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: 마이그레이션 작성**

```sql
-- supabase/migrations/0026_minute_share.sql
-- 회의록 외부 링크 공유 — share_token(비로그인 열람 토큰) / share_enabled(토글).
-- 멱등: 반복 실행 안전. RLS 무변경 — anon 정책을 추가하지 않는다(공개 조회는
-- /share/minutes/[token] 서버 컴포넌트가 service_role 로 정확 일치 조회만 수행).
alter table minutes add column if not exists share_token uuid;
alter table minutes add column if not exists share_enabled boolean not null default false;

create index if not exists idx_minutes_share_token
  on minutes(share_token) where share_token is not null;
```

- [ ] **Step 6: 커밋**

```bash
git add supabase/migrations/0026_minute_share.sql src/lib/minutes/share.ts tests/minutes/share.test.ts
git commit -m "feat(minutes): 공유 상태 전이 로직 + 0026 share_token/share_enabled"
```

---

### Task 2: 서버 액션 getMinuteShare / setMinuteShare

**Files:**
- Modify: `src/app/actions/minutes.ts` (파일 끝에 추가; 상단 import 에 share.ts 타입 추가)

**Interfaces:**
- Consumes: Task 1의 `nextShareState`, `ShareOp`. 기존 `checkOwner(sb, id, userId, role)`, `getMembership`, `getSession`, `createServerClient`.
- Produces: `getMinuteShare(id: string): Promise<MinuteShareResult>`, `setMinuteShare(id: string, op: ShareOp): Promise<MinuteShareResult>`, `interface MinuteShareResult { ok: boolean; enabled?: boolean; token?: string | null; error?: string }` — Task 4 모달이 import.

- [ ] **Step 1: import 추가**

```ts
// src/app/actions/minutes.ts 상단 import 블록에 추가
import { nextShareState, type ShareOp } from '@/lib/minutes/share'
```

- [ ] **Step 2: 액션 구현 (파일 끝에 추가)**

```ts
export interface MinuteShareResult { ok: boolean; enabled?: boolean; token?: string | null; error?: string }

/** 공유 상태 조회 — 토큰은 이 액션으로만 클라이언트에 전달(페이지 payload 미포함, 소유자/관리자 한정). */
export async function getMinuteShare(id: string): Promise<MinuteShareResult> {
  const m = await getMembership()
  if (!m) return { ok: false, error: '로그인 필요' }
  const user = await getSession()
  if (!user) return { ok: false, error: '로그인 필요' }
  const sb = await createServerClient()
  const { data } = await sb.from('minutes')
    .select('created_by, share_token, share_enabled').eq('id', id).maybeSingle()
  if (!data) return { ok: false, error: '회의록을 찾을 수 없습니다.' }
  if ((data.created_by as string | null) !== user.id && m.role !== 'pmo_admin') return { ok: false, error: '권한 없음' }
  return { ok: true, enabled: !!data.share_enabled, token: (data.share_token as string | null) ?? null }
}

/** 공유 토글/재발급 — 쓰기는 RLS update_own_minutes 가 최종 방어선. updated_at 은 건드리지 않는다(내용 편집 아님). */
export async function setMinuteShare(id: string, op: ShareOp): Promise<MinuteShareResult> {
  const m = await getMembership()
  if (!m) return { ok: false, error: '로그인 필요' }
  const user = await getSession()
  if (!user) return { ok: false, error: '로그인 필요' }
  const sb = await createServerClient()
  const own = await checkOwner(sb, id, user.id, m.role)
  if (own) return { ok: false, error: own }
  const { data } = await sb.from('minutes')
    .select('share_token, share_enabled').eq('id', id).maybeSingle()
  if (!data) return { ok: false, error: '회의록을 찾을 수 없습니다.' }
  const next = nextShareState(
    { token: (data.share_token as string | null) ?? null, enabled: !!data.share_enabled },
    op, crypto.randomUUID(),
  )
  const { error } = await sb.from('minutes')
    .update({ share_token: next.token, share_enabled: next.enabled }).eq('id', id)
  if (error) return { ok: false, error: error.message }
  return { ok: true, enabled: next.enabled, token: next.token }
}
```

- [ ] **Step 3: 타입/린트 확인**

Run: `npx tsc --noEmit && npx eslint src/app/actions/minutes.ts`
Expected: 에러 없음

- [ ] **Step 4: 커밋**

```bash
git add src/app/actions/minutes.ts
git commit -m "feat(minutes): 공유 조회/토글/재발급 서버 액션 — 소유자·pmo_admin 한정"
```

---

### Task 3: 공개 라우트 + ShareViewer + 미들웨어 제외 + i18n(공개용)

**Files:**
- Create: `src/app/share/minutes/[token]/page.tsx`
- Create: `src/components/minutes/ShareViewer.tsx`
- Modify: `src/middleware.ts:26` (matcher 에 `share` 제외 추가)
- Modify: `src/lib/i18n/dict/minutes.ts` (ko/en 각 1키)

**Interfaces:**
- Consumes: Task 1의 `isShareToken`. 기존 `createAdminClient`, `MarkdownView`, `MinuteToc`, `splitMinuteBlocks`, `TEAM`, `useLocale`.
- Produces: `/share/minutes/<token>` 공개 URL — Task 4 모달이 이 경로 형식으로 URL 을 조립.

- [ ] **Step 1: 미들웨어 matcher 에 share 제외**

`src/middleware.ts` 의 matcher 를 다음으로 교체(부정 룩어헤드에 `share` 추가):

```ts
export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|login|api|share|.*\\.(?:png|jpg|jpeg|gif|webp|svg|ico)).*)'],
}
```

바로 위 주석에 한 줄 추가: `// /share/** 는 비로그인 외부 열람 경로 — 토큰 검증은 페이지가 수행.`

- [ ] **Step 2: i18n 키 추가**

`src/lib/i18n/dict/minutes.ts` — `minutesKo` 객체 끝에:

```ts
  'min.share.readonly': '읽기 전용 공유 문서',
```

`minutesEn` 객체 끝에:

```ts
  'min.share.readonly': 'Read-only shared document',
```

- [ ] **Step 3: ShareViewer 컴포넌트**

```tsx
// src/components/minutes/ShareViewer.tsx
'use client'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { splitMinuteBlocks } from '@/lib/minutes/blocks'
import type { TeamCode } from '@/lib/domain/types'
import { useLocale } from '@/components/providers/LocaleProvider'
import { TEAM } from '@/components/wbs/shared'
import { MarkdownView } from './MarkdownView'
import { MinuteToc } from './MinuteToc'

/** 비로그인 외부 열람 전용 미니멀 뷰어 — 본문+목차만(스펙 §3.3). 채팅·하이라이트·인사이트·첨부 없음. */
export function ShareViewer({ minuteDate, teamCode, title, bodyMd }: {
  minuteDate: string
  teamCode: TeamCode
  title: string
  bodyMd: string
}) {
  const { t } = useLocale()
  const bodyRef = useRef<HTMLDivElement>(null)
  const [activeToc, setActiveToc] = useState<number | null>(null)
  const blocks = useMemo(() => splitMinuteBlocks(bodyMd), [bodyMd])

  const jumpTo = useCallback((blockIndex: number) => {
    const el = bodyRef.current?.querySelector<HTMLElement>(`[data-mblock="${blockIndex}"]`)
    if (!el) return
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    el.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' })
  }, [])

  // 스크롤 스파이 — MinuteViewer 와 동일 규칙(교차 중 최상단 헤딩)
  const headingIndexes = useMemo(
    () => blocks.filter(b => b.headingDepth !== undefined && b.headingDepth <= 3).map(b => b.index),
    [blocks],
  )
  useEffect(() => {
    if (headingIndexes.length === 0 || !bodyRef.current) return
    const els = headingIndexes
      .map(i => bodyRef.current!.querySelector<HTMLElement>(`[data-mblock="${i}"]`))
      .filter((el): el is HTMLElement => !!el)
    if (els.length === 0) return
    const io = new IntersectionObserver(entries => {
      const visible = entries.filter(en => en.isIntersecting)
        .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)
      if (visible.length > 0) setActiveToc(Number((visible[0].target as HTMLElement).dataset.mblock))
    }, { root: null, rootMargin: '0px 0px -70% 0px' })
    els.forEach(el => io.observe(el))
    return () => io.disconnect()
  }, [headingIndexes])

  return (
    <div className="app-backdrop min-h-screen">
      <div className="mx-auto flex max-w-6xl flex-col gap-4 px-4 py-6">
        <div className="card flex flex-wrap items-center gap-3 p-4">
          <img src="/logo.png" alt="" width={28} height={28} className="block rounded-lg" />
          <span className="text-sm tabular-nums text-ink-muted">{minuteDate}</span>
          <span className={`inline-flex rounded-md px-1.5 py-0.5 text-[11px] font-bold text-white ${TEAM[teamCode].bar}`}>
            {teamCode}
          </span>
          <h1 className="min-w-0 flex-1 truncate text-lg font-bold text-ink">{title}</h1>
          <span className="text-xs text-ink-subtle">{t('min.share.readonly')}</span>
        </div>
        <div className="flex flex-col gap-4 xl:flex-row">
          <MinuteToc blocks={blocks} insights={[]} highlights={[]} onJump={jumpTo} activeIndex={activeToc} />
          <div ref={bodyRef} className="card min-w-0 flex-1 p-5">
            <MarkdownView content={bodyMd} />
          </div>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 4: 공개 페이지**

```tsx
// src/app/share/minutes/[token]/page.tsx
import { notFound } from 'next/navigation'
import { createAdminClient } from '@/lib/supabase/admin'
import { isShareToken } from '@/lib/minutes/share'
import { ShareViewer } from '@/components/minutes/ShareViewer'
import type { TeamCode } from '@/lib/domain/types'

// 공유 OFF/재발급이 다음 요청부터 즉시 반영되도록 정적 캐시 금지
export const dynamic = 'force-dynamic'
export const metadata = { robots: { index: false, follow: false } }

export default async function SharedMinutePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  if (!isShareToken(token)) notFound()
  const admin = createAdminClient()
  // 반환 컬럼 화이트리스트(스펙 §3.2) — 작성자 실명·첨부·하이라이트·인사이트 미노출
  const { data } = await admin.from('minutes')
    .select('minute_date, team_code, title, body_md')
    .eq('share_token', token).eq('share_enabled', true).maybeSingle()
  if (!data) notFound()
  return (
    <ShareViewer
      minuteDate={data.minute_date as string}
      teamCode={data.team_code as TeamCode}
      title={data.title as string}
      bodyMd={data.body_md as string}
    />
  )
}
```

- [ ] **Step 5: 빌드 확인**

Run: `npm run build`
Expected: `/share/minutes/[token]` 이 dynamic(ƒ) 라우트로 출력, 에러 없음

- [ ] **Step 6: 커밋**

```bash
git add src/app/share/minutes/\[token\]/page.tsx src/components/minutes/ShareViewer.tsx src/middleware.ts src/lib/i18n/dict/minutes.ts
git commit -m "feat(minutes): 비로그인 공개 라우트 /share/minutes/[token] + 읽기 전용 뷰어"
```

---

### Task 4: 공유 모달 + 뷰어 버튼 + i18n(모달용)

**Files:**
- Create: `src/components/minutes/MinuteShareModal.tsx`
- Modify: `src/components/minutes/MinuteViewer.tsx` (canManage 액션 줄에 공유 버튼 + 모달 렌더)
- Modify: `src/lib/i18n/dict/minutes.ts` (ko/en 각 10키)

**Interfaces:**
- Consumes: Task 2의 `getMinuteShare`, `setMinuteShare`, `MinuteShareResult`; Task 3의 URL 형식 `/share/minutes/<token>`; 기존 `Modal`, `useToast`, `useLocale`.

- [ ] **Step 1: i18n 키 추가**

`minutesKo` 객체 끝에:

```ts
  'min.share.button': '공유',
  'min.share.title': '외부 링크 공유',
  'min.share.desc': '켜면 링크가 있는 누구나 로그인 없이 본문과 목차를 볼 수 있습니다.',
  'min.share.on': '링크 공유 켜짐',
  'min.share.off': '링크 공유 꺼짐',
  'min.share.copy': '링크 복사',
  'min.share.copied': '링크를 복사했습니다.',
  'min.share.copyFailed': '복사에 실패했습니다. 주소를 직접 선택해 복사하세요.',
  'min.share.regen': '재발급',
  'min.share.regenConfirm': '기존 링크가 즉시 무효화됩니다. 재발급할까요?',
  'min.share.failed': '공유 설정 처리에 실패했습니다.',
```

`minutesEn` 객체 끝에:

```ts
  'min.share.button': 'Share',
  'min.share.title': 'Share via link',
  'min.share.desc': 'When on, anyone with the link can view the body and outline without signing in.',
  'min.share.on': 'Link sharing on',
  'min.share.off': 'Link sharing off',
  'min.share.copy': 'Copy link',
  'min.share.copied': 'Link copied.',
  'min.share.copyFailed': 'Copy failed. Select the URL and copy it manually.',
  'min.share.regen': 'Regenerate',
  'min.share.regenConfirm': 'The current link stops working immediately. Regenerate?',
  'min.share.failed': 'Failed to update sharing settings.',
```

- [ ] **Step 2: MinuteShareModal 구현**

```tsx
// src/components/minutes/MinuteShareModal.tsx
'use client'
import { useEffect, useState } from 'react'
import { Copy, RefreshCw } from 'lucide-react'
import { Modal } from '@/components/ui/Modal'
import { useToast } from '@/components/ui/Toast'
import { useLocale } from '@/components/providers/LocaleProvider'
import { getMinuteShare, setMinuteShare } from '@/app/actions/minutes'
import type { ShareOp } from '@/lib/minutes/share'

/** 구글식 공유 모달 — 토글 ON/OFF·링크 복사·재발급. 낙관적 갱신 없음(성공 응답으로만 상태 반영 → 롤백 불요). */
export function MinuteShareModal({ open, onClose, minuteId }: {
  open: boolean; onClose: () => void; minuteId: string
}) {
  const { t } = useLocale()
  const { toast } = useToast()
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [enabled, setEnabled] = useState(false)
  const [token, setToken] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [confirmRegen, setConfirmRegen] = useState(false)

  useEffect(() => {
    if (!open) return
    setLoading(true); setErr(null); setConfirmRegen(false)
    getMinuteShare(minuteId)
      .then(res => {
        if (res.ok) { setEnabled(!!res.enabled); setToken(res.token ?? null) }
        else setErr(res.error ?? t('min.share.failed'))
      })
      .catch(() => setErr(t('min.share.failed')))
      .finally(() => setLoading(false))
  }, [open, minuteId])  // t 는 로케일 전환 외 불변 — 의존성 제외

  async function run(op: ShareOp) {
    setBusy(true); setErr(null)
    try {
      const res = await setMinuteShare(minuteId, op)
      if (res.ok) { setEnabled(!!res.enabled); setToken(res.token ?? null); setConfirmRegen(false) }
      else setErr(res.error ?? t('min.share.failed'))
    } catch {
      setErr(t('min.share.failed'))
    } finally { setBusy(false) }
  }

  const url = token ? `${window.location.origin}/share/minutes/${token}` : ''

  async function copy() {
    try {
      await navigator.clipboard.writeText(url)
      toast({ title: t('min.share.copied') })
    } catch {
      toast({ title: t('min.share.copyFailed'), variant: 'error' })
    }
  }

  return (
    <Modal open={open} onClose={onClose} title={t('min.share.title')} size="sm">
      {loading ? (
        <p className="text-sm text-ink-muted">…</p>
      ) : (
        <div className="space-y-3">
          <p className="text-sm text-ink-muted">{t('min.share.desc')}</p>
          <button onClick={() => void run(enabled ? 'disable' : 'enable')} disabled={busy}
            role="switch" aria-checked={enabled}
            className={`btn w-full justify-between ${enabled ? 'border border-brand-ring bg-brand-weak text-brand' : ''}`}>
            <span>{enabled ? t('min.share.on') : t('min.share.off')}</span>
            <span aria-hidden className={`inline-block h-4 w-7 rounded-full p-0.5 transition ${enabled ? 'bg-brand' : 'bg-surface-2'}`}>
              <span className={`block h-3 w-3 rounded-full bg-white transition ${enabled ? 'translate-x-3' : ''}`} />
            </span>
          </button>
          {enabled && token && (
            <div className="space-y-2">
              <input readOnly value={url} onFocus={e => e.currentTarget.select()}
                className="input w-full text-xs" aria-label={t('min.share.copy')} />
              <div className="flex items-center gap-2">
                <button onClick={() => void copy()} disabled={busy} className="btn">
                  <Copy className="h-4 w-4" />{t('min.share.copy')}
                </button>
                {confirmRegen ? (
                  <span className="flex min-w-0 items-center gap-2 text-xs text-delayed">
                    <span className="min-w-0 flex-1">{t('min.share.regenConfirm')}</span>
                    <button onClick={() => void run('regenerate')} disabled={busy} className="btn text-delayed">
                      {t('min.share.regen')}
                    </button>
                    <button onClick={() => setConfirmRegen(false)} className="btn">{t('common.cancel')}</button>
                  </span>
                ) : (
                  <button onClick={() => setConfirmRegen(true)} disabled={busy} className="btn">
                    <RefreshCw className="h-4 w-4" />{t('min.share.regen')}
                  </button>
                )}
              </div>
            </div>
          )}
          {err && <p className="text-sm text-delayed">{err}</p>}
        </div>
      )}
    </Modal>
  )
}
```

주의: `input` 클래스가 이 레포 globals 에 없으면 기존 폼 인풋 클래스(`MinuteMetaModal` 의 인풋 클래스)를 복사해 맞출 것.

- [ ] **Step 3: MinuteViewer 에 버튼 + 모달 연결**

`src/components/minutes/MinuteViewer.tsx`:

1. import 에 `Share2` 추가(lucide-react), `MinuteShareModal` import 추가.
2. 상태 추가: `const [shareOpen, setShareOpen] = useState(false)`.
3. `canManage` 액션 스팬(`{t('min.detail.edit')}` 버튼 앞)에:

```tsx
<button onClick={() => setShareOpen(true)} className="btn">
  <Share2 className="h-4 w-4" />{t('min.share.button')}
</button>
```

4. `<MinuteMetaModal …/>` 아래에:

```tsx
<MinuteShareModal open={shareOpen} onClose={() => setShareOpen(false)} minuteId={minute.id} />
```

- [ ] **Step 4: 게이트**

Run: `npm run build && npm run lint && npm test`
Expected: 전부 그린(기존 테스트 + share.test.ts 5건 포함)

- [ ] **Step 5: 커밋**

```bash
git add src/components/minutes/MinuteShareModal.tsx src/components/minutes/MinuteViewer.tsx src/lib/i18n/dict/minutes.ts
git commit -m "feat(minutes): 뷰어 공유 모달 — 토글·링크 복사·재발급"
```

---

### Task 5: 스모크 준비(배포 전 확인 목록)

**Files:** 없음(검증만)

- [ ] **Step 1: 전체 게이트 재확인**

Run: `npm run build && npm run lint && npm test`
Expected: 전부 그린

- [ ] **Step 2: 배포 체크리스트 확인**

배포는 사용자 지시 시 별도 수행(스펙 §7):
1. 0026 프로덕션 적용(Management API 멱등 레시피)
2. main 푸시 → Vercel Ready
3. 테스트 프로젝트 회의록으로: 공유 ON → 시크릿 창 200 → OFF → 404 → 재발급 → 구 링크 404 / 새 링크 200 (D-CUBE 운영 데이터 미사용)
