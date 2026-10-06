'use client'
// 오피스 콘솔 컨테이너 — 좌석 키 하나의 보내기 자격·전달 상태·최근 화면을 서버 액션으로 읽고 보낸다(계약 §2.12).
// 표시는 AgentConsolePanel 이 하고, 여기는 데이터만 맡는다. 에이전트 보기 프로필(팀장·조정·임시 팀원·팀원)과
// 평면도·상태 레인의 상세(팀원 좌석) 두 곳에 꽂힌다.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { getConsoleView, sendConsolePrompt, type ConsoleViewResult } from '@/app/actions/agentHub'
import { consoleTargetOfAgent, type ConsoleTargetKind } from '@/lib/domain/agentConsole'
import type { SeatState } from '@/lib/domain/seatState'
import { AgentConsolePanel } from './AgentConsolePanel'

type DraftUpdate = string | ((prev: string) => string)
/**
 * 작성 중인 초안 — 좌석 키마다 하나. 오피스(SeatmapView)가 ConsoleDraftProvider 로 쥔다: 30초 폴링이 좌석표를 다시 그리거나
 * 에이전트 보기가 고른 자리를 바꿔 이 컴포넌트가 사라졌다 돌아와도 쓰던 글이 남게 하려는 것이다.
 * Provider 가 없으면(단독으로 그릴 때) 컴포넌트 안의 상태로 대신한다.
 */
export interface ConsoleDrafts { get: (key: string) => string; set: (key: string, next: DraftUpdate) => void }
export const ConsoleDraftContext = createContext<ConsoleDrafts | null>(null)

/** 초안 저장소 — 좌석 키 → 글, 빈 글은 지워 둔다. 상태를 여기 가둬 한 글자 칠 때 오피스 전체(children)가 다시 그려지지 않게 한다. */
export function ConsoleDraftProvider({ children }: { children: ReactNode }) {
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const set = useCallback((key: string, next: DraftUpdate) => setDrafts(prev => {
    const cur = prev[key] ?? ''
    const text = typeof next === 'function' ? next(cur) : next
    if (text === cur) return prev
    if (text === '') { const rest = { ...prev }; delete rest[key]; return rest }
    return { ...prev, [key]: text }
  }), [])
  const value = useMemo<ConsoleDrafts>(() => ({ get: key => drafts[key] ?? '', set }), [drafts, set])
  return <ConsoleDraftContext.Provider value={value}>{children}</ConsoleDraftContext.Provider>
}

/** 팀원 세션이 자리에 앉아 있는 좌석 상태 — 콘솔을 여는 좌석이다(빈자리·승인 대기·완료는 세션이 없다). */
export const CONSOLE_SEAT_STATES: readonly SeatState[] = ['ACTIVE', 'REJECTED', 'BLOCKED', 'STALE', 'OFFLINE']

/** 이 자리에 콘솔을 꽂을지 — 대상 규칙에 맞는 신원이고, 팀원 좌석이면 세션이 앉아 있을 때만. */
export function hasConsole(agent: string | null | undefined, seatState?: SeatState): agent is string {
  if (!agent || !consoleTargetOfAgent(agent)) return false
  return seatState === undefined || CONSOLE_SEAT_STATES.includes(seatState)
}

const KIND_LABEL: Record<ConsoleTargetKind, string> = {
  coord_lead: '팀장(조정)', coord_lane: '임시 팀원', team_lead: '팀장', team_worker: '팀원',
}
/** 화면 갱신 주기 — 폴러가 30초마다 올리므로 그보다 자주 읽을 까닭이 없다. */
const VIEW_POLL_MS = 30_000

type View = Extract<ConsoleViewResult, { ok: true }>

/**
 * 호출처는 key={seatKey} 를 함께 준다 — 자리를 바꾸면 새로 그려 앞 자리의 화면·보내는 중 표시가 한 순간도 섞이지 않게(계약).
 * 그래도 응답은 요청 번호로 걸러, 같은 인스턴스에서 좌석이 바뀌거나 앞선 조회가 늦게 와도 가장 최근 요청의 응답만 쓴다.
 */
export function AgentConsole({ seatKey, label, nowMs }: { seatKey: string; label?: string; nowMs: number }) {
  const target = consoleTargetOfAgent(seatKey)
  const shared = useContext(ConsoleDraftContext)
  const [localDraft, setLocalDraft] = useState('')
  const draft = shared ? shared.get(seatKey) : localDraft
  const setDraft = useCallback((t: DraftUpdate) => (shared ? shared.set(seatKey, t) : setLocalDraft(t)), [shared, seatKey])
  const [view, setView] = useState<View | null>(null)
  const [viewError, setViewError] = useState<string | null>(null)
  const [sending, setSending] = useState(false)
  const [sendError, setSendError] = useState<string | null>(null)
  // 가장 최근 조회의 번호 — 30초 조회가 보내기 뒤 조회보다 늦게 와서 새 프롬프트가 없는 목록으로 덮어쓰지 않게 한다.
  const seqRef = useRef(0)
  // 지금 효과의 생존 표식 — 자리가 바뀌거나 사라지면 꺼진다. 보내기 응답이 왔을 때 꺼져 있으면 화면을 건드리지 않는다.
  const lifeRef = useRef({ alive: false })

  const load = useCallback(async () => {
    const seq = ++seqRef.current
    try {
      const r = await getConsoleView(seatKey)
      if (seqRef.current !== seq) return
      if (r.ok) { setView(r); setViewError(null) } else setViewError(r.error)
    } catch (e) {
      if (seqRef.current !== seq) return
      setViewError(e instanceof Error ? e.message : String(e))
    }
  }, [seatKey])

  useEffect(() => {
    if (!target) return
    const life = { alive: true }
    lifeRef.current = life
    setView(null); setViewError(null); setSendError(null)
    void load()
    const t = window.setInterval(() => { if (document.visibilityState !== 'hidden') void load() }, VIEW_POLL_MS)
    // 숨겨진 동안은 쉬었으니 다시 보이면 바로 한 번 읽는다(다음 주기까지 낡은 화면을 두지 않게).
    const onVisible = () => { if (document.visibilityState === 'visible') void load() }
    document.addEventListener('visibilitychange', onVisible)
    return () => { life.alive = false; window.clearInterval(t); document.removeEventListener('visibilitychange', onVisible) }
  }, [load, target === null]) // eslint-disable-line react-hooks/exhaustive-deps

  // 보낼 글은 시작할 때 초안에서 뺀다 — 응답 전에 자리를 떠났다 돌아와도 같은 글을 다시 보낼 수 없고,
  // 그사이 새로 쓴 글을 성공 처리가 지우지도 않는다. 실패하면 초안이 비어 있을 때만 되돌린다.
  const onSend = useCallback(async (normalized: string) => {
    const key = seatKey
    const life = lifeRef.current
    const raw = draft
    setSending(true); setSendError(null); setDraft('')
    let error: string | null = null
    try {
      const r = await sendConsolePrompt(key, normalized)
      if (!r.ok) error = r.error
    } catch (e) {
      error = e instanceof Error ? e.message : String(e)
    }
    if (error !== null) setDraft(prev => (prev === '' ? raw : prev))
    setSending(false)
    if (!life.alive) return
    if (error !== null) setSendError(error)
    else await load()
  }, [seatKey, draft, setDraft, load])

  // 대상이 아닌 좌석(단독 감시·옛 조정 키·규칙 밖 신원)에는 콘솔을 그리지 않는다.
  if (!target) return null
  const consoleTarget = { kind: target.kind, key: seatKey, label: label ?? `${KIND_LABEL[target.kind]} ${target.ref}` }
  if (view === null) {
    return (
      <section data-console-loading={target.kind} className="flex flex-col gap-1.5">
        <h3 className="text-[10px] font-bold uppercase tracking-[0.14em] text-ink-subtle">콘솔 · {consoleTarget.label}</h3>
        {viewError
          ? <p data-console-view-error="" role="alert" className="text-xs text-critical">{viewError}</p>
          : <p role="status" className="text-xs text-ink-subtle">콘솔을 읽는 중입니다.</p>}
      </section>
    )
  }
  return (
    <>
      <AgentConsolePanel
        target={consoleTarget} nowMs={nowMs}
        canSend={view.canSend} sendBlockedReason={view.sendBlockedReason ?? undefined}
        draft={draft} onDraftChange={setDraft} onSend={(t) => { void onSend(t) }} sending={sending} sendError={sendError}
        // 전달 상태는 본인만 — 남의 세션이면 표를 그리지 않는다(undefined).
        prompts={view.canSend ? (view.prompts ?? null) : undefined} promptsError={view.promptsError ?? null}
        canView={view.canView}
        screen={view.screenError ? null : view.screen} screenError={view.screenError ?? null}
      />
      {/* 재조회만 실패했을 때 — 지난 값은 그대로 두고 실패를 따로 알린다(위장 금지). */}
      {viewError && <p data-console-view-error="" role="alert" className="text-xs text-critical">콘솔 갱신 실패 · {viewError}</p>}
    </>
  )
}
