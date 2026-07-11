'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { RotateCcw, X, Send, Sparkles, CalendarDays } from 'lucide-react'
import { RobotMascot } from './RobotMascot'
import { QUICK_SUGGESTIONS } from '@/lib/ai/intent'
import { useLocale } from '@/components/providers/LocaleProvider'
import type { DictKey } from '@/lib/i18n/dict'
import { isCommandUtterance } from '@/lib/ai/commands/cue'
import type { CommandProposal, CommandCandidate } from '@/lib/ai/commands/types'
import { updateActual, updateWbsFields } from '@/app/actions/wbs'

type Role = 'user' | 'assistant'
interface Msg {
  id: number
  role: Role
  content: string
  proposal?: CommandProposal // 있으면 Bubble 대신 ProposalCard 렌더
  proposalState?: 'pending' | 'applied' | 'cancelled'
}
interface BotContext {
  currentProject: { id: string; name: string; taskCount: number; donePct: number } | null
  totalProjects: number
  weekStartCount: number
}

const PROJECT_RE = /\/p\/([0-9a-fA-F-]{8,})/

type T = (k: DictKey) => string

// 빠른 질문 칩의 표시 라벨 매핑 — 전송 문구(한국어, 서버 인텐트 매칭용)는 그대로 두고 표시만 번역한다.
const SUGGESTION_LABEL_KEY: Record<string, DictKey> = {
  '전체 프로젝트 현황 알려줘': 'chat.suggestion.allStatus',
  '지연된 작업이 뭐야?': 'chat.suggestion.delayed',
  '이번 주 작업 알려줘': 'chat.suggestion.thisWeek',
  '멤버별 업무 정리해줘': 'chat.suggestion.byMember',
  '완료된 작업 목록 보여줘': 'chat.suggestion.doneList',
}

function welcomeText(ctx: BotContext | null, t: T): string {
  if (!ctx) return `${t('chat.welcome.greeting')}\n${t('chat.welcome.ask')}`
  const lines = [t('chat.welcome.greeting')]
  if (ctx.currentProject) {
    lines.push(`${t('chat.welcome.currentProject')}: "${ctx.currentProject.name}"`)
    lines.push(
      `${t('chat.welcome.tasksPrefix')}${ctx.currentProject.taskCount}${t('chat.welcome.tasksSuffix')} | ${t('chat.welcome.progressPrefix')}${ctx.currentProject.donePct}${t('chat.welcome.progressSuffix')}`,
    )
  }
  if (ctx.totalProjects === 1) {
    // N=1일 때 "전체 1개 프로젝트에 대해서도 질문할 수 있습니다"는 어색하다 — 단일 프로젝트 전용 문구로 대체.
    lines.push('이 프로젝트에 대해 무엇이든 질문하세요')
  } else if (ctx.totalProjects > 1) {
    lines.push(`${t('chat.welcome.totalPrefix')}${ctx.totalProjects}${t('chat.welcome.totalSuffix')}`)
  }
  lines.push(t('chat.welcome.ask'))
  lines.push('실적 변경 같은 명령도 할 수 있어요 — 예: "○○ 실적 80으로 올려줘"')
  return lines.join('\n')
}

export function DkBot({ projects }: { projects: { id: string; name: string }[] }) {
  const { t } = useLocale()
  const pathname = usePathname()
  const router = useRouter()
  const currentProjectId = pathname?.match(PROJECT_RE)?.[1] ?? null
  const currentProjectName = projects.find(p => p.id === currentProjectId)?.name ?? null

  const [open, setOpen] = useState(false)
  const [ctx, setCtx] = useState<BotContext | null>(null)
  const [messages, setMessages] = useState<Msg[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)

  const idRef = useRef(0)
  const nextId = () => (idRef.current += 1)
  const loadedKeyRef = useRef<string | null>(null)
  const genRef = useRef(0) // 대화 세대 — 프로젝트 전환 시 증가, 진행 중 요청의 stale 결과를 폐기
  const scrollRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const lastCommandRef = useRef<string>('') // disambiguate 후속용 원문 보관

  // 패널 열림 + 프로젝트 컨텍스트 부트스트랩 (프로젝트가 바뀌면 새 대화로 갱신)
  useEffect(() => {
    if (!open) return
    const key = currentProjectId ?? 'none'
    if (loadedKeyRef.current === key) return // 이미 로드된 대화 → 닫았다 열어도 보존
    loadedKeyRef.current = key
    const gen = (genRef.current += 1) // 새 대화 세대 시작
    // 프로젝트 전환 = 새 대화. 이전 진행 중 send() 의 결과는 세대 불일치로 무시된다.
    setMessages([])
    setLoading(false)
    setInput('')
    setCtx(null)
    fetch(`/api/chat/context?projectId=${currentProjectId ?? ''}`, { cache: 'no-store' })
      .then(r => (r.ok ? (r.json() as Promise<BotContext>) : null))
      .then(c => {
        if (genRef.current !== gen) return // 그 사이 프로젝트 전환 → 폐기
        setCtx(c)
        // 사용자가 그새 질문을 보냈으면(messages 비어있지 않음) 환영문구로 덮어쓰지 않는다.
        setMessages(prev => (prev.length ? prev : [{ id: nextId(), role: 'assistant', content: welcomeText(c, t) }]))
      })
      .catch(() => {
        if (genRef.current !== gen) return
        setMessages(prev => (prev.length ? prev : [{ id: nextId(), role: 'assistant', content: welcomeText(null, t) }]))
      })
    // t는 의도적으로 deps에서 제외 — locale 전환이 진행 중 대화를 리셋하면 안 된다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, currentProjectId])

  // Esc 닫기
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  // 메시지 추가 시 하단 스크롤 + 입력 포커스
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages, loading])
  useEffect(() => {
    if (open) inputRef.current?.focus()
  }, [open])

  /**
   * 입력창 비우기 — setInput('') 만으로는 한글 IME 조합 중이던 마지막 글자가 입력창에
   * 되살아난다: React 상태를 비워도 브라우저의 조합(composition) 버퍼는 살아 있어서,
   * 다음 커밋 시점에 조합 중이던 글자를 빈 입력창에 다시 써 넣는다(전송 버튼 클릭은
   * 포커스를 뺏지 않아 조합이 안 끝난 채 남고, Enter 는 조합 확정과 전송이 겹친다).
   * blur 로 조합을 강제 종료(확정)시킨 뒤 DOM 값까지 직접 비우고 포커스를 되돌린다.
   * setInput('') 는 마지막에 — blur 가 확정분으로 onChange 를 한 번 더 발화시켜도 덮어쓴다.
   */
  const clearInput = useCallback(() => {
    const el = inputRef.current
    if (el) {
      el.blur()
      el.value = ''
      el.style.height = 'auto'
      el.focus()
    }
    setInput('')
  }, [])

  // 명령 제안 요청 — send()의 명령 분기와 후보 칩 선택(pickCandidate)이 공유
  const requestProposal = useCallback(
    async (message: string, targetId?: string) => {
      const gen = genRef.current
      setLoading(true)
      try {
        const res = await fetch('/api/chat/command', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ projectId: currentProjectId, message, targetId }),
        })
        const proposal = (await res.json()) as CommandProposal
        if (genRef.current !== gen) return 'stale' as const
        if (proposal.kind === 'not_command') return 'not_command' as const
        const content =
          proposal.kind === 'proposal' ? '변경 내용을 확인해 주세요:'
          : proposal.kind === 'disambiguate' ? '어떤 작업인지 골라 주세요:'
          : proposal.kind === 'not_found' ? `"${proposal.targetQuery}" 작업을 찾지 못했어요. 작업명을 더 정확히 말해 주세요.`
          : proposal.message
        setMessages(prev => [...prev, {
          id: nextId(), role: 'assistant', content,
          ...(proposal.kind === 'proposal' || proposal.kind === 'disambiguate'
            ? { proposal, proposalState: 'pending' as const } : {}),
        }])
        return 'handled' as const
      } catch {
        if (genRef.current !== gen) return 'stale' as const
        return 'not_command' as const // 명령 경로 실패 → 호출부가 스트리밍으로 폴백
      } finally {
        if (genRef.current === gen) setLoading(false) // ← 로딩 고착 방지 (stale이면 다른 세대 소유)
      }
    },
    [currentProjectId],
  )

  const send = useCallback(
    async (raw: string) => {
      const text = raw.trim()
      if (!text || loading) return
      const gen = genRef.current // 이 요청이 속한 대화 세대
      const history = messages.map(m => ({ role: m.role, content: m.content }))
      setMessages(prev => [...prev, { id: nextId(), role: 'user', content: text }])
      clearInput()
      if (isCommandUtterance(text)) {
        lastCommandRef.current = text
        const outcome = await requestProposal(text)
        if (outcome !== 'not_command') return // handled/stale — 스트리밍 경로 미진입
        // not_command → 아래 기존 스트리밍 경로 그대로 계속
      }
      setLoading(true)
      let asstId: number | null = null
      try {
        const res = await fetch('/api/chat/stream', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ projectId: currentProjectId, message: text, history }),
        })
        if (!res.ok || !res.body) {
          const data = (await res.json().catch(() => ({}))) as { error?: string }
          if (genRef.current !== gen) return
          setMessages(prev => [...prev, { id: nextId(), role: 'assistant', content: data.error ?? t('chat.error.generic') }])
          return
        }
        // 토큰 스트리밍 — 첫 청크에서 어시스턴트 버블을 만들고 이후 누적 갱신
        const reader = res.body.getReader()
        const decoder = new TextDecoder()
        let acc = ''
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          if (genRef.current !== gen) {
            reader.cancel()
            return // 스트리밍 중 프로젝트 전환 → 폐기
          }
          acc += decoder.decode(value, { stream: true })
          if (asstId === null) {
            const id = nextId()
            asstId = id
            setMessages(prev => [...prev, { id, role: 'assistant', content: acc }])
          } else {
            const id = asstId
            setMessages(prev => prev.map(m => (m.id === id ? { ...m, content: acc } : m)))
          }
        }
        if (asstId === null && genRef.current === gen) {
          setMessages(prev => [...prev, { id: nextId(), role: 'assistant', content: t('chat.error.empty') }])
        }
      } catch {
        if (genRef.current !== gen) return
        setMessages(prev => [
          ...prev,
          { id: nextId(), role: 'assistant', content: t('chat.error.retry') },
        ])
      } finally {
        if (genRef.current === gen) setLoading(false)
      }
    },
    [messages, loading, currentProjectId, clearInput, t, requestProposal],
  )

  const applyProposal = useCallback(
    async (msgId: number, p: Extract<CommandProposal, { kind: 'proposal' }>) => {
      const mark = (state: 'applied' | 'cancelled') =>
        setMessages(prev => prev.map(m => (m.id === msgId ? { ...m, proposalState: state } : m)))
      const say = (content: string) =>
        setMessages(prev => [...prev, { id: nextId(), role: 'assistant', content }])
      // 원시 params 사용 — 표시 문자열('80%', '미정') 역파싱 금지
      const result = p.params.actualPct !== undefined
        ? await updateActual(p.target.id, p.params.actualPct, p.target.currentActual)
        : await updateWbsFields(p.target.id, {
            ...(p.params.plannedStart !== undefined ? { plannedStart: p.params.plannedStart } : {}),
            ...(p.params.plannedEnd !== undefined ? { plannedEnd: p.params.plannedEnd } : {}),
          })
      if (result.ok) {
        mark('applied')
        say(`✓ 변경했어요. ${p.target.name} — ${p.changes.map(c => `${c.label} ${c.after}`).join(', ')}`)
        router.refresh()
      } else {
        mark('cancelled')
        say(`변경하지 못했어요: ${result.error ?? '알 수 없는 오류'}`) // 서버 액션의 한국어 에러 그대로 — AI도 권한을 우회하지 못한다
      }
    },
    [router],
  )

  const pickCandidate = useCallback((c: CommandCandidate) => {
    // 되묻기 후속: 같은 명령 원문 + targetId 재요청 (requestProposal 재사용)
    void requestProposal(lastCommandRef.current, c.id)
  }, [requestProposal])

  const cancelProposal = useCallback((msgId: number) => {
    setMessages(prev => prev.map(m => (m.id === msgId ? { ...m, proposalState: 'cancelled' } : m)))
  }, [])

  const reset = () => {
    // 진행 중 스트림이 있으면 폐기한다 — 세대를 올리면 send() 루프가 reader.cancel() 후 중단하고,
    // 늦게 도착한 토큰이 새 대화에 끼어들지 않는다. 로딩도 직접 해제(스트림 finally 는 옛 세대라 건너뜀).
    genRef.current += 1
    setLoading(false)
    clearInput()
    setMessages([{ id: nextId(), role: 'assistant', content: welcomeText(ctx, t) }])
  }

  const onInputKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // 한글 IME 조합 중의 Enter 는 '조합 확정' 키다 — 이때 전송하면 마지막 글자가 잘리거나
    // 조합 버퍼가 입력창에 남는다. 조합이 끝난 Enter 만 전송으로 처리한다.
    if (e.nativeEvent.isComposing) return
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      send(input)
    }
  }
  const onInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value)
    const el = e.target
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`
  }

  return (
    <>
      {/* ── FAB ── */}
      {!open && (
        <button
          onClick={() => setOpen(true)}
          aria-label={t('chat.open')}
          className="fixed bottom-16 right-5 z-[120] flex h-[52px] w-[52px] items-center justify-center rounded-full text-white ring-1 ring-white/10 transition hover:scale-105 active:scale-95"
          style={{ backgroundImage: 'var(--gradient-dark)', boxShadow: 'var(--shadow-lg)' }}
        >
          <RobotMascot className="h-9 w-9" />
          {ctx && ctx.weekStartCount > 0 && (
            <span className="absolute right-1 top-1 h-3 w-3 rounded-full border-2 border-[#13161c] bg-brand" />
          )}
        </button>
      )}

      {/* ── 패널 ── */}
      {open && (
        <div
          role="dialog"
          aria-label={t('chat.dialog')}
          className="fixed bottom-16 right-5 z-[130] flex h-[min(720px,calc(100dvh-5.25rem))] w-[min(420px,calc(100vw-2rem))] flex-col overflow-hidden rounded-3xl border border-line bg-surface"
          style={{ boxShadow: 'var(--shadow-xl)' }}
        >
          {/* 헤더 */}
          <header className="flex items-center gap-3 px-4 py-3.5 text-white" style={{ backgroundImage: 'var(--gradient-dark)' }}>
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-white/10 ring-1 ring-white/15">
              <RobotMascot className="h-8 w-8" />
            </span>
            <div className="min-w-0 flex-1">
              <div className="text-[15px] font-bold leading-tight">DK Bot</div>
              <div className="truncate text-xs text-white/60">{currentProjectName ?? t('nav.allProjects')}</div>
            </div>
            <button
              onClick={reset}
              aria-label={t('chat.reset')}
              className="flex h-9 w-9 items-center justify-center rounded-full text-white/70 transition hover:bg-white/10 hover:text-white"
            >
              <RotateCcw className="h-4 w-4" />
            </button>
            <button
              onClick={() => setOpen(false)}
              aria-label={t('common.close')}
              className="flex h-9 w-9 items-center justify-center rounded-full text-white/70 transition hover:bg-white/10 hover:text-white"
            >
              <X className="h-4 w-4" />
            </button>
          </header>

          {/* 본문 */}
          <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto bg-canvas px-4 py-4">
            {/* 프로액티브 인사이트 */}
            {ctx?.currentProject && (
              <div className="rounded-2xl border border-brand-ring/40 bg-brand-weak/50 p-3.5">
                <div className="flex items-center gap-1.5 text-[13px] font-semibold text-brand">
                  <Sparkles className="h-4 w-4" /> {t('chat.insight.title')}
                </div>
                <p className="mt-1.5 text-[13px] leading-5 text-ink-muted">
                  {ctx.weekStartCount > 0
                    ? `${t('chat.insight.weekPrefix')}${ctx.weekStartCount}${t('chat.insight.weekSuffix')}`
                    : t('chat.insight.none')}
                </p>
                <div className="mt-2.5 flex flex-wrap gap-1.5">
                  <button
                    onClick={() => send('이번 주 시작 작업 알려줘')}
                    disabled={loading}
                    className="inline-flex items-center gap-1 rounded-full bg-brand px-3 py-1.5 text-xs font-medium text-white transition hover:brightness-110 disabled:opacity-50"
                  >
                    <CalendarDays className="h-3.5 w-3.5" /> {t('chat.chip.weekStartPrefix')}
                    {ctx.weekStartCount}
                    {t('chat.chip.weekStartSuffix')}
                  </button>
                  <button
                    onClick={() => send('주간 요약')}
                    disabled={loading}
                    className="rounded-full border border-line bg-surface px-3 py-1.5 text-xs font-medium text-ink-muted transition hover:border-brand-ring hover:text-brand disabled:opacity-50"
                  >
                    {t('chat.chip.weeklySummary')}
                  </button>
                </div>
              </div>
            )}

            {/* 빠른 질문 칩 */}
            <div className="flex flex-wrap gap-1.5">
              {QUICK_SUGGESTIONS.map(q => (
                <button
                  key={q}
                  onClick={() => send(q)}
                  disabled={loading}
                  className="rounded-full border border-line bg-surface px-3 py-1.5 text-[12.5px] text-ink-muted transition hover:border-brand-ring hover:text-brand disabled:opacity-50"
                >
                  {SUGGESTION_LABEL_KEY[q] ? t(SUGGESTION_LABEL_KEY[q]) : q}
                </button>
              ))}
            </div>

            {/* 메시지 */}
            {messages.map(m =>
              m.proposal ? (
                <div key={m.id} className="space-y-1.5">
                  <Bubble role="assistant" content={m.content} />
                  <ProposalCard msg={m} onApply={applyProposal} onPick={pickCandidate} onCancel={cancelProposal} />
                </div>
              ) : (
                <Bubble key={m.id} role={m.role} content={m.content} />
              ),
            )}
            {/* 첫 토큰 도착 전(마지막 메시지가 사용자)에만 타이핑 표시 — 이후엔 버블이 스트리밍됨 */}
            {loading && messages[messages.length - 1]?.role !== 'assistant' && <TypingBubble />}
          </div>

          {/* 입력 */}
          <footer className="border-t border-line bg-surface px-3 py-3">
            <div className="flex items-end gap-2">
              <textarea
                ref={inputRef}
                value={input}
                onChange={onInputChange}
                onKeyDown={onInputKey}
                rows={1}
                placeholder={t('chat.inputPlaceholder')}
                aria-label={t('chat.inputAria')}
                className="max-h-32 min-h-[44px] flex-1 resize-none rounded-2xl border border-line bg-canvas px-3.5 py-3 text-sm text-ink outline-none transition placeholder:text-ink-subtle focus:border-brand focus:ring-2 focus:ring-brand-ring"
              />
              <button
                onClick={() => send(input)}
                disabled={!input.trim() || loading}
                aria-label={t('chat.send')}
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-white transition hover:brightness-105 disabled:opacity-40"
                style={{ backgroundColor: '#ef9a9a', boxShadow: 'var(--shadow-sm)' }}
              >
                <Send className="h-5 w-5" />
              </button>
            </div>
          </footer>
        </div>
      )}
    </>
  )
}

function Bubble({ role, content }: { role: Role; content: string }) {
  const isUser = role === 'user'
  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`max-w-[88%] whitespace-pre-wrap rounded-2xl px-3.5 py-2.5 text-[13px] leading-relaxed ${
          isUser
            ? 'rounded-br-md bg-brand text-white'
            : 'rounded-bl-md border border-brand-ring/30 bg-brand-weak/50 text-ink'
        }`}
      >
        {content}
      </div>
    </div>
  )
}

function ProposalCard({
  msg, onApply, onPick, onCancel,
}: {
  msg: Msg
  onApply: (msgId: number, p: Extract<CommandProposal, { kind: 'proposal' }>) => void
  onPick: (c: CommandCandidate) => void
  onCancel: (msgId: number) => void
}) {
  const p = msg.proposal
  if (!p || (p.kind !== 'proposal' && p.kind !== 'disambiguate')) return null
  const disabled = msg.proposalState !== 'pending'
  return (
    <div className="flex justify-start">
      <div className="max-w-[88%] rounded-2xl rounded-bl-md border border-brand-ring/30 bg-brand-weak/50 px-3.5 py-2.5 text-[13px] leading-relaxed text-ink">
        {p.kind === 'proposal' ? (
          <>
            <div className="font-medium">{p.target.name}</div>
            <div className="mt-0.5 text-[12px] text-ink-muted">
              [{p.target.phaseName}] · 담당 {p.target.ownersText}
            </div>
            <ul className="mt-1.5 space-y-0.5">
              {p.changes.map(c => (
                <li key={c.field}>
                  {c.label}: <span className="line-through opacity-60">{c.before}</span>
                  {' → '}<span className="font-semibold text-brand">{c.after}</span>
                </li>
              ))}
            </ul>
            <div className="mt-2 flex gap-1.5">
              <button
                onClick={() => onApply(msg.id, p)}
                disabled={disabled}
                className="inline-flex items-center gap-1 rounded-full bg-brand px-3 py-1.5 text-xs font-medium text-white transition hover:brightness-110 disabled:opacity-50"
              >
                적용
              </button>
              <button
                onClick={() => onCancel(msg.id)}
                disabled={disabled}
                className="rounded-full border border-line bg-surface px-3 py-1.5 text-xs text-ink-muted transition hover:border-brand-ring disabled:opacity-50"
              >
                취소
              </button>
            </div>
            {msg.proposalState === 'applied' && <div className="mt-1.5 text-[12px] text-ink-subtle">적용됨</div>}
            {msg.proposalState === 'cancelled' && <div className="mt-1.5 text-[12px] text-ink-subtle">취소됨</div>}
          </>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {p.candidates.map(c => (
              <button
                key={c.id}
                onClick={() => onPick(c)}
                disabled={disabled}
                className="rounded-full border border-line bg-surface px-3 py-1.5 text-[12.5px] text-ink-muted transition hover:border-brand-ring hover:text-brand disabled:opacity-50"
              >
                {c.name} <span className="opacity-60">({c.phaseName})</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function TypingBubble() {
  return (
    <div className="flex justify-start">
      <div className="flex items-center gap-1 rounded-2xl rounded-bl-md border border-brand-ring/30 bg-brand-weak/50 px-4 py-3">
        {[0, 1, 2].map(i => (
          <span
            key={i}
            className="h-1.5 w-1.5 animate-bounce rounded-full bg-ink-subtle"
            style={{ animationDelay: `${i * 0.15}s` }}
          />
        ))}
      </div>
    </div>
  )
}
