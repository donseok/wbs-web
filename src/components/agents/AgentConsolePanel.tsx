'use client'
// 오피스 콘솔 — 팀장·팀원 세션에 프롬프트를 보내고, 전달 상태와 최근 화면(끝 40줄)을 본다(2026-10-06).
// 표시 전용 틀이다: 초안(draft)은 부모가 쥔다 — 30초 폴링과 RosterBoard 의 자리 다시 고르기가 작성 중인 글을 지우지 않게.
// 보내기는 세션 주인 본인만, 화면 보기는 본인과 프로젝트 관리자만이다. 여기의 canSend·canView 는 어포던스이고 최종 판정은 서버가 한다.
import { useId } from 'react'
import { ageLabel } from '@/lib/domain/seatmap'
import {
  CONSOLE_ISSUE_TEXT, CONSOLE_SCREEN_LINES, CONSOLE_STATUS_LABEL, CONSOLE_TEXT_MAX, consoleTextIssue, consoleTextLength,
  normalizeConsoleText, type ConsolePromptStatus, type ConsoleTargetKind,
} from '@/lib/domain/agentConsole'

export interface ConsoleTarget {
  kind: ConsoleTargetKind
  /** 대상 식별 — 초안·상태를 묶는 열쇠. 형식은 계약(§2.12)이 정한다. */
  key: string
  label: string
}
export interface ConsolePromptView {
  id: string; text: string
  /** 서버가 준 값 그대로 — 모르는 값이 오면 「알 수 없음」으로 보인다. */
  status: ConsolePromptStatus | string
  /** 거절·만료 사유(로컬 폴러가 돌려준 값). */
  reason: string | null
  createdAt: string
}
export interface ConsoleScreenView { lines: string[]; capturedAt: string }

const STATUS_TONE: Record<ConsolePromptStatus, string> = {
  pending: 'var(--color-pending)', claimed: 'var(--color-brand)', sent: 'var(--color-done)',
  refused: 'var(--color-critical)', expired: 'var(--color-delayed)', unknown: 'var(--color-ink-muted)',
}

function statusOf(s: string): ConsolePromptStatus {
  return Object.hasOwn(CONSOLE_STATUS_LABEL, s) ? s as ConsolePromptStatus : 'unknown'
}

/** 서버 시각이 깨져 있으면 「—」 — ageLabel 은 null 만 거른다. */
function safeAge(iso: string, nowMs: number): string {
  return Number.isNaN(Date.parse(iso)) ? '—' : ageLabel(iso, nowMs)
}

const H3 = 'text-[10px] font-bold uppercase tracking-[0.14em] text-ink-subtle'

export function AgentConsolePanel({
  target, nowMs, canSend, sendBlockedReason, draft, onDraftChange, onSend, sending = false, sendError,
  prompts, promptsError, canView, screen, screenError,
}: {
  target: ConsoleTarget; nowMs: number
  canSend: boolean
  /** 보낼 수 없을 때 보일 문구. 없으면 기본 문구(본인만). */
  sendBlockedReason?: string
  draft: string
  onDraftChange: (text: string) => void
  /** 정리된 본문을 받는다 — 서버도 같은 정리를 다시 한다. 없으면 보내기 버튼이 잠긴다(데이터 연결 전). */
  onSend?: (normalized: string) => void
  sending?: boolean
  sendError?: string | null
  /** 보낸 프롬프트의 전달 상태. undefined 면 표를 그리지 않는다. null 은 조회 실패다(빈 목록과 다르다). */
  prompts?: ConsolePromptView[] | null
  /** 조회 실패 문구 — 지난 목록을 들고 있어도(재조회만 실패) 목록 위에 보인다. */
  promptsError?: string | null
  canView: boolean
  /** undefined = 아직 읽는 중, null = 올라온 화면이 없음. */
  screen?: ConsoleScreenView | null
  screenError?: string | null
}) {
  const hintId = useId()
  const normalized = normalizeConsoleText(draft)
  const issue = consoleTextIssue(normalized)
  // 비어 있을 때는 경고하지 않는다 — 아직 쓰지 않은 것뿐이다.
  const shownIssue = issue && issue !== 'empty' ? CONSOLE_ISSUE_TEXT[issue] : null
  const lines = screen ? screen.lines.slice(-CONSOLE_SCREEN_LINES) : []
  const showScreen = canView && !screenError
  return (
    <section data-console={target.kind} data-console-target={target.key} className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        <h3 className={H3}>프롬프트 보내기 · {target.label}</h3>
        {canSend ? (
          <>
            <textarea data-console-input="" rows={3} value={draft} readOnly={sending}
              aria-label={`${target.label}에게 보낼 프롬프트`} aria-describedby={hintId} aria-invalid={shownIssue !== null}
              placeholder="받는 세션의 입력창에 한 줄로 들어갑니다"
              className="w-full resize-y rounded-xl border border-line bg-surface px-3 py-2 text-sm text-ink"
              onChange={e => onDraftChange(e.target.value)} />
            <div className="flex items-center gap-2">
              <button type="button" data-console-send=""
                disabled={issue !== null || sending || !onSend}
                className="rounded-xl border border-brand bg-brand-weak px-3 py-1.5 text-xs font-bold text-brand disabled:opacity-50"
                onClick={() => onSend?.(normalized)}>
                {sending ? '보내는 중…' : '보내기'}
              </button>
              <span id={hintId} data-console-hint=""
                className={shownIssue ? 'text-[11px] text-critical' : 'text-[11px] text-ink-subtle'}>
                {shownIssue ?? `${consoleTextLength(normalized).toLocaleString()}/${CONSOLE_TEXT_MAX.toLocaleString()}자 · 줄바꿈은 공백으로 바뀝니다 · 바쁜 세션에도 바로 넣습니다`}
              </span>
              {/* 낭독은 문제 문구가 바뀔 때만 — 글자 수까지 live 영역에 두면 한 글자마다 읽힌다. */}
              <span data-console-issue-live="" aria-live="polite" className="sr-only">{shownIssue ?? ''}</span>
            </div>
          </>
        ) : (
          <p data-console-send-blocked="" className="text-sm text-ink-muted">
            {sendBlockedReason ?? '보내기는 이 세션의 주인 본인만 할 수 있습니다.'}
          </p>
        )}
        {sendError && <p data-console-send-error="" role="alert" className="text-xs text-critical">{sendError}</p>}
      </div>

      {prompts !== undefined && (
        <div className="flex flex-col gap-1.5">
          <h3 className={H3}>전달 상태</h3>
          {(prompts === null || promptsError) && (
            <p data-console-prompts-error="" role="alert" className="text-xs text-critical">{promptsError ?? '전달 상태 조회에 실패했습니다.'}</p>
          )}
          {prompts !== null && (prompts.length === 0
            ? <p data-console-prompts-empty="" className="text-xs text-ink-subtle">보낸 프롬프트가 없습니다.</p>
            : (
              <ul data-console-prompts="" className="flex flex-col gap-1">
                {prompts.map(p => {
                  const st = statusOf(p.status)
                  return (
                    <li key={p.id} data-console-prompt={st} className="flex min-w-0 flex-col rounded-lg border border-line px-2 py-1">
                      <span className="flex items-center gap-2 text-[11px]">
                        <b style={{ color: STATUS_TONE[st] }}>{CONSOLE_STATUS_LABEL[st]}</b>
                        <span className="text-ink-subtle">{safeAge(p.createdAt, nowMs)}</span>
                      </span>
                      <span className="line-clamp-3 break-all text-xs text-ink" title={p.text}>{p.text}</span>
                      {p.reason && <span data-console-reason="" className="text-[11px] text-ink-muted">사유: {p.reason}</span>}
                    </li>
                  )
                })}
              </ul>
            ))}
        </div>
      )}

      <div className="flex flex-col gap-1.5">
        <h3 className={H3}>최근 화면{showScreen && screen ? ` · ${safeAge(screen.capturedAt, nowMs)}` : ''}</h3>
        {!canView
          ? <p data-console-screen-blocked="" className="text-xs text-ink-muted">화면은 세션 주인과 프로젝트 관리자만 볼 수 있습니다.</p>
          : screenError
            ? <p data-console-screen-error="" role="alert" className="text-xs text-critical">{screenError}</p>
            : screen === undefined
              ? <p data-console-screen-loading="" className="text-xs text-ink-subtle">화면을 읽는 중입니다.</p>
              : !screen || lines.length === 0
                ? <p data-console-screen-empty="" className="text-xs text-ink-subtle">아직 올라온 화면이 없습니다 — 로컬 폴러가 30초마다 올립니다.</p>
                : (
                  <pre data-console-screen="" tabIndex={0} role="region" aria-label={`${target.label} 최근 화면`}
                    className="max-h-80 overflow-auto rounded-xl border border-line bg-canvas p-2 font-mono text-[11px] leading-snug text-ink">
                    {lines.join('\n')}
                  </pre>
                )}
      </div>
    </section>
  )
}
