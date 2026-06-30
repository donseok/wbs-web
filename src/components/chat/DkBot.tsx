'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { usePathname } from 'next/navigation'
import { RotateCcw, X, Send, Sparkles, CalendarDays } from 'lucide-react'
import { BearMascot } from './BearMascot'
import { QUICK_SUGGESTIONS } from '@/lib/ai/intent'

type Role = 'user' | 'assistant'
interface Msg {
  id: number
  role: Role
  content: string
}
interface BotContext {
  currentProject: { id: string; name: string; taskCount: number; donePct: number } | null
  totalProjects: number
  weekStartCount: number
}

const PROJECT_RE = /\/p\/([0-9a-fA-F-]{8,})/

function welcomeText(ctx: BotContext | null): string {
  if (!ctx) return '안녕하세요, DK Bot입니다.\n궁금한 점을 자유롭게 질문하세요!'
  const lines = ['안녕하세요, DK Bot입니다.']
  if (ctx.currentProject) {
    lines.push(`현재 프로젝트: "${ctx.currentProject.name}"`)
    lines.push(`작업 ${ctx.currentProject.taskCount}건 | 공정률 ${ctx.currentProject.donePct}%`)
  }
  if (ctx.totalProjects > 0) lines.push(`전체 ${ctx.totalProjects}개 프로젝트에 대해서도 질문할 수 있습니다.`)
  lines.push('궁금한 점을 자유롭게 질문하세요!')
  return lines.join('\n')
}

export function DkBot({ projects }: { projects: { id: string; name: string }[] }) {
  const pathname = usePathname()
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
        setMessages(prev => (prev.length ? prev : [{ id: nextId(), role: 'assistant', content: welcomeText(c) }]))
      })
      .catch(() => {
        if (genRef.current !== gen) return
        setMessages(prev => (prev.length ? prev : [{ id: nextId(), role: 'assistant', content: welcomeText(null) }]))
      })
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

  const send = useCallback(
    async (raw: string) => {
      const text = raw.trim()
      if (!text || loading) return
      const gen = genRef.current // 이 요청이 속한 대화 세대
      const history = messages.map(m => ({ role: m.role, content: m.content }))
      setMessages(prev => [...prev, { id: nextId(), role: 'user', content: text }])
      setInput('')
      if (inputRef.current) inputRef.current.style.height = 'auto'
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
          setMessages(prev => [...prev, { id: nextId(), role: 'assistant', content: data.error ?? '문제가 발생했어요.' }])
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
          setMessages(prev => [...prev, { id: nextId(), role: 'assistant', content: '답변을 가져오지 못했어요.' }])
        }
      } catch {
        if (genRef.current !== gen) return
        setMessages(prev => [
          ...prev,
          { id: nextId(), role: 'assistant', content: '죄송해요, 답변 중 문제가 발생했어요. 잠시 후 다시 시도해 주세요.' },
        ])
      } finally {
        if (genRef.current === gen) setLoading(false)
      }
    },
    [messages, loading, currentProjectId],
  )

  const reset = () => setMessages([{ id: nextId(), role: 'assistant', content: welcomeText(ctx) }])

  const onInputKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
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
          aria-label="DK Bot 열기"
          className="fixed bottom-5 right-5 z-[120] flex h-16 w-16 items-center justify-center rounded-full text-white ring-1 ring-white/10 transition hover:scale-105 active:scale-95"
          style={{ backgroundImage: 'var(--gradient-dark)', boxShadow: 'var(--shadow-lg)' }}
        >
          <BearMascot className="h-11 w-11" />
          {ctx && ctx.weekStartCount > 0 && (
            <span className="absolute right-1 top-1 h-3 w-3 rounded-full border-2 border-[#13161c] bg-brand" />
          )}
        </button>
      )}

      {/* ── 패널 ── */}
      {open && (
        <div
          role="dialog"
          aria-label="DK Bot 채팅"
          className="fixed bottom-5 right-5 z-[130] flex h-[min(720px,calc(100dvh-2.5rem))] w-[min(420px,calc(100vw-2rem))] flex-col overflow-hidden rounded-3xl border border-line bg-surface"
          style={{ boxShadow: 'var(--shadow-xl)' }}
        >
          {/* 헤더 */}
          <header className="flex items-center gap-3 px-4 py-3.5 text-white" style={{ backgroundImage: 'var(--gradient-dark)' }}>
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-white/10 ring-1 ring-white/15">
              <BearMascot className="h-8 w-8" />
            </span>
            <div className="min-w-0 flex-1">
              <div className="text-[15px] font-bold leading-tight">DK Bot</div>
              <div className="truncate text-xs text-white/60">{currentProjectName ?? '전체 프로젝트'}</div>
            </div>
            <button
              onClick={reset}
              aria-label="대화 초기화"
              className="flex h-9 w-9 items-center justify-center rounded-full text-white/70 transition hover:bg-white/10 hover:text-white"
            >
              <RotateCcw className="h-4 w-4" />
            </button>
            <button
              onClick={() => setOpen(false)}
              aria-label="닫기"
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
                  <Sparkles className="h-4 w-4" /> 프로액티브 인사이트
                </div>
                <p className="mt-1.5 text-[13px] leading-5 text-ink-muted">
                  {ctx.weekStartCount > 0
                    ? `이번 주 시작 예정 작업 ${ctx.weekStartCount}건을 확인해 보세요.`
                    : '이번 주 시작 예정 작업이 없습니다. 진행 현황을 확인해 보세요.'}
                </p>
                <div className="mt-2.5 flex flex-wrap gap-1.5">
                  <button
                    onClick={() => send('이번 주 시작 작업 알려줘')}
                    disabled={loading}
                    className="inline-flex items-center gap-1 rounded-full bg-brand px-3 py-1.5 text-xs font-medium text-white transition hover:brightness-110 disabled:opacity-50"
                  >
                    <CalendarDays className="h-3.5 w-3.5" /> 이번 주 시작 {ctx.weekStartCount}건
                  </button>
                  <button
                    onClick={() => send('주간 요약')}
                    disabled={loading}
                    className="rounded-full border border-line bg-surface px-3 py-1.5 text-xs font-medium text-ink-muted transition hover:border-brand-ring hover:text-brand disabled:opacity-50"
                  >
                    주간 요약
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
                  {q}
                </button>
              ))}
            </div>

            {/* 메시지 */}
            {messages.map(m => (
              <Bubble key={m.id} role={m.role} content={m.content} />
            ))}
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
                placeholder="질문을 입력하세요 (Enter로 전송)"
                aria-label="질문 입력"
                className="max-h-32 min-h-[44px] flex-1 resize-none rounded-2xl border border-line bg-canvas px-3.5 py-3 text-sm text-ink outline-none transition placeholder:text-ink-subtle focus:border-brand focus:ring-2 focus:ring-brand-ring"
              />
              <button
                onClick={() => send(input)}
                disabled={!input.trim() || loading}
                aria-label="전송"
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
