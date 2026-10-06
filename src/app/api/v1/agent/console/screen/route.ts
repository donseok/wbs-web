import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { apiBadRequest, apiInternalError } from '@/lib/agent/externalApi'
import { fetchConsoleSeats } from '@/lib/data/agentSeatmap'
import {
  CONSOLE_HOST_RE, CONSOLE_SCREEN_ITEMS_MAX, consolePatMaySeatKey, consoleTargetKey, parseConsoleScreenItem,
  type ConsoleScreenItem, type ConsoleTargetKind,
} from '@/lib/domain/agentConsole'
import { apiNotFound, consoleCall } from '../_shared'

/**
 * screen — 폴러가 이 PC 의 대상마다 화면 끝 40줄을 올린다(계약 §2.12). 대상마다 최신 1행을 덮어쓴다.
 * lines 가 있으면 저장, 없으면 touch(sha 가 저장된 것과 같을 때 captured_at 만 갱신, 다르거나 행이 없으면 need_full).
 * 검사는 항목마다 해서 거절된 항목만 rejected 로 돌려준다. owner 의 좌석에 없는 대상은 unknown_target —
 * 프로젝트 한정 PAT 는 그 프로젝트 좌석과 프로젝트 없는 조정 세션 칸만 대상이다(다른 프로젝트 관리자가 보는 화면에 쓰지 못하게).
 * DB 왕복은 PC 마다 30초에 한 번이라 묶는다: 저장분은 upsert 한 번, touch 는 기존 sha 조회 한 번 + 같은 시각끼리 갱신 한 번.
 * DB 쓰기가 실패하면 항목별 사유로 감추지 않고 500 으로 답한다 — 폴러는 다음 주기에 다시 보낸다.
 * 화면은 폴러가 비밀 모양 문자열을 가린 뒤 올린다. 서버는 글자 그대로 저장하고 본문을 로그에 남기지 않는다.
 */
export const dynamic = 'force-dynamic'

/** 24시간 갱신이 없는 화면은 지운다 — 크론 없이 올릴 때마다 게으르게. */
const SCREEN_TTL_MS = 24 * 3600_000

type Status = 'stored' | 'touched' | 'need_full' | 'rejected'
type Result = { target_kind: string | undefined; target_ref: string | undefined; status: Status; reason?: string }

/** PostgREST or() 안의 값 — 참조에 쓰는 `.`·`:` 가 구분자로 읽히지 않게 큰따옴표로 감싼다(참조 형식상 따옴표·역슬래시는 없다). */
const q = (v: string) => `"${v}"`

export async function POST(req: NextRequest) {
  try {
    const admin = createAdminClient()
    const call = await consoleCall(req, admin)
    if (call instanceof NextResponse) return call
    const { owner, body } = call
    if (typeof body.host !== 'string' || !CONSOLE_HOST_RE.test(body.host)) return apiBadRequest('host 는 PC 슬러그([a-z0-9-])여야 합니다.')
    const host = body.host
    if (!Array.isArray(body.items) || body.items.length > CONSOLE_SCREEN_ITEMS_MAX) {
      return apiBadRequest(`items 는 ${CONSOLE_SCREEN_ITEMS_MAX}개 이하의 배열이어야 합니다.`)
    }
    // 대상 대조 재료 — 조회 실패는 500(위장 금지). 빈 목록이면 모든 항목이 unknown_target 이다.
    // 화면 행은 (owner, host, 종류, 참조) 하나를 같은 열쇠의 좌석들이 함께 쓴다 — 프로젝트 한정 PAT 는 그 열쇠의 좌석이 전부 자기
    // 프로젝트이거나 전부 프로젝트 없는 보조 좌석(조정 세션 칸)일 때만 쓸 수 있다(프로젝트 있는 좌석·다른 프로젝트 좌석과 겹치면
    // 그쪽 화면을 덮어쓰게 되므로 거절, fail-closed). 판정은 consolePatMaySeatKey 한 곳에서 한다.
    const byKey = new Map<string, { kind: ConsoleTargetKind; pids: Array<string | null> }>()
    for (const s of await fetchConsoleSeats(admin, owner)) {
      if (s.host !== host) continue
      const k = consoleTargetKey(s)
      byKey.set(k, { kind: s.kind, pids: [...(byKey.get(k)?.pids ?? []), s.projectId] })
    }
    const seats = new Set([...byKey].filter(([, v]) => consolePatMaySeatKey(call.projectId, v.kind, v.pids)).map(([k]) => k))
    const now = new Date()
    const results: Result[] = []
    // 같은 대상이 한 요청에 두 번 오면 마지막 것만 쓴다(한 upsert 문장이 같은 행을 두 번 고칠 수 없다).
    const lastIndex = new Map<string, number>()
    const parsed = body.items.map((raw: unknown, i: number) => {
      const r = parseConsoleScreenItem(raw, now.getTime())
      if ('item' in r) lastIndex.set(consoleTargetKey({ host, kind: r.item.kind, ref: r.item.ref }), i)
      return r
    })
    const accepted: Array<{ at: number; item: ConsoleScreenItem }> = []
    parsed.forEach((r, i) => {
      if ('reason' in r) { results[i] = { target_kind: r.kind, target_ref: r.ref, status: 'rejected', reason: r.reason }; return }
      const echo = { target_kind: r.item.kind, target_ref: r.item.ref }
      const key = consoleTargetKey({ host, kind: r.item.kind, ref: r.item.ref })
      if (!seats.has(key)) { results[i] = { ...echo, status: 'rejected', reason: 'unknown_target' }; return }
      if (lastIndex.get(key) !== i) { results[i] = { ...echo, status: 'rejected', reason: 'duplicate_target' }; return }
      accepted.push({ at: i, item: r.item })
    })

    const stores = accepted.filter(a => a.item.lines !== null)
    if (stores.length > 0) {
      const { error } = await admin.from('agent_console_screens').upsert(
        stores.map(({ item }) => ({
          owner, host, target_kind: item.kind, target_ref: item.ref, lines: item.lines, sha: item.sha,
          captured_at: item.capturedAt, updated_at: now.toISOString(),
        })),
        { onConflict: 'owner,host,target_kind,target_ref' },
      )
      if (error) { console.error('[agent-api] console screen 저장 실패:', error.message); return apiInternalError() }
      for (const { at, item } of stores) results[at] = { target_kind: item.kind, target_ref: item.ref, status: 'stored' }
    }

    const touches = accepted.filter(a => a.item.lines === null)
    if (touches.length > 0) {
      const { data, error } = await admin.from('agent_console_screens').select('target_kind, target_ref, sha')
        .eq('owner', owner).eq('host', host)
      if (error) { console.error('[agent-api] console screen 조회 실패:', error.message); return apiInternalError() }
      const stored = new Map(((data ?? []) as Array<{ target_kind: string; target_ref: string; sha: string }>)
        .map(r => [consoleTargetKey({ host, kind: r.target_kind as ConsoleScreenItem['kind'], ref: r.target_ref }), r.sha]))
      // 폴러는 한 주기를 같은 시각으로 찍으므로 대개 한 번의 갱신으로 끝난다.
      const byTime = new Map<string, typeof touches>()
      for (const t of touches) {
        if (stored.get(consoleTargetKey({ host, kind: t.item.kind, ref: t.item.ref })) !== t.item.sha) {
          results[t.at] = { target_kind: t.item.kind, target_ref: t.item.ref, status: 'need_full' }
          continue
        }
        byTime.set(t.item.capturedAt, [...(byTime.get(t.item.capturedAt) ?? []), t])
      }
      for (const [capturedAt, group] of byTime) {
        const { data: hit, error: upErr } = await admin.from('agent_console_screens')
          .update({ captured_at: capturedAt, updated_at: now.toISOString() })
          .eq('owner', owner).eq('host', host)
          .or(group.map(g => `and(target_kind.eq.${g.item.kind},target_ref.eq.${q(g.item.ref)},sha.eq.${g.item.sha})`).join(','))
          .select('target_kind, target_ref')
        if (upErr) { console.error('[agent-api] console screen touch 실패:', upErr.message); return apiInternalError() }
        // 조회와 갱신 사이에 행이 바뀌거나 지워졌으면 갱신되지 않는다 — 그 대상은 need_full 이다.
        const done = new Set(((hit ?? []) as Array<{ target_kind: string; target_ref: string }>).map(r => `${r.target_kind}\u0000${r.target_ref}`))
        for (const g of group) {
          results[g.at] = { target_kind: g.item.kind, target_ref: g.item.ref, status: done.has(`${g.item.kind}\u0000${g.item.ref}`) ? 'touched' : 'need_full' }
        }
      }
    }

    const { error: gcErr } = await admin.from('agent_console_screens').delete().lt('updated_at', new Date(now.getTime() - SCREEN_TTL_MS).toISOString())
    if (gcErr) console.error('[agent-api] console screen 오래된 행 정리 실패:', gcErr.message)
    return NextResponse.json({ ok: true, results })
  } catch (e) {
    console.error('[agent-api] console screen 처리 실패:', e instanceof Error ? e.message : e)
    return apiInternalError()
  }
}

export const GET = apiNotFound
export const PUT = apiNotFound
export const DELETE = apiNotFound
export const PATCH = apiNotFound
export const OPTIONS = apiNotFound
