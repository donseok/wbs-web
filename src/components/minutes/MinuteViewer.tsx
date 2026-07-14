'use client'
import { useCallback, useMemo, useRef, useState, type ChangeEvent } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ArrowLeft, Download, ExternalLink, Maximize2, Minimize2, Paperclip, Share2 } from 'lucide-react'
import type { InsightKind, Minute, MinuteFile, MinuteHighlight, MinuteInsight } from '@/lib/domain/types'
import {
  MINUTE_BODY_FILE_MAX, MINUTE_BODY_MAX, sanitizeFileName,
} from '@/lib/domain/minutes'
import {
  getMinuteFileUrl, replaceMinuteBody, deleteMinute, toggleMinuteHighlight,
} from '@/app/actions/minutes'
import { fnv1a64, isMarkableBlock, splitMinuteBlocks, type BlockMarks } from '@/lib/minutes/blocks'
import { INS_PRIORITY, hlTier, visibleHighlights, visibleInsights } from '@/lib/minutes/annotations'
import { createBrowserClient } from '@/lib/supabase/client'
import { useLocale } from '@/components/providers/LocaleProvider'
import { useToast } from '@/components/ui/Toast'
import { Modal } from '@/components/ui/Modal'
import { MarkdownView } from './MarkdownView'
import { MinuteMetaModal } from './MinuteMetaModal'
import { MinuteShareModal } from './MinuteShareModal'
import { MinuteChatPanel } from './MinuteChatPanel'
import { MinuteInsightCard } from './MinuteInsightCard'
import { MinuteToc } from './MinuteToc'
import { useMinuteTocSpy } from './useMinuteTocSpy'
import { MinuteBlockPopover, type PopoverState } from './MinuteBlockPopover'
import { TEAM } from '@/components/wbs/shared'

export function MinuteViewer({
  minute, files, canManage, annotations, userId, projects,
}: {
  minute: Minute
  files: MinuteFile[]
  canManage: boolean
  annotations: { highlights: MinuteHighlight[]; insights: MinuteInsight[] }
  userId: string | null
  projects: { id: string; name: string }[]
}) {
  const router = useRouter()
  const { t } = useLocale()
  const { toast } = useToast()
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [metaOpen, setMetaOpen] = useState(false)
  const [shareOpen, setShareOpen] = useState(false)
  const [focus, setFocus] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const bodyFile = files.find(f => f.role === 'body') ?? null
  const attachments = files.filter(f => f.role === 'attachment')

  const bodyRef = useRef<HTMLDivElement>(null)
  const [popover, setPopover] = useState<PopoverState | null>(null)
  const [hlBusy, setHlBusy] = useState(false)

  const blocks = useMemo(() => splitMinuteBlocks(minute.bodyMd), [minute.bodyMd])
  const { activeToc, jumpTo } = useMinuteTocSpy(blocks, bodyRef, { flash: true })
  const bodyHash = useMemo(() => fnv1a64(minute.bodyMd), [minute.bodyMd])

  // 낙관적 병합 계약(스펙 §6.4): 내 하이라이트는 로컬 단독 소유(서버 prop 은 초기값),
  // 타인 하이라이트는 항상 서버 prop 파생 — revalidate 가 와도 이중 계산/역전 없음.
  const [myIndexes, setMyIndexes] = useState<Set<number>>(() => new Set(
    visibleHighlights(annotations.highlights, blocks)
      .filter(h => h.createdBy === userId).map(h => h.blockIndex),
  ))
  const others = useMemo(
    () => visibleHighlights(annotations.highlights, blocks).filter(h => h.createdBy !== userId),
    [annotations.highlights, blocks, userId],
  )
  const insights = useMemo(
    () => visibleInsights(annotations.insights, blocks, bodyHash),
    [annotations.insights, blocks, bodyHash],
  )

  const marks = useMemo<BlockMarks>(() => {
    const m: BlockMarks = {}
    for (const i of insights) {
      const k = i.kind as InsightKind
      const cur = m[i.blockIndex]?.ins
      // 복수 kind 는 우선순위 최상위 1개만 인라인 표시(스펙 §6.3)
      if (!cur || INS_PRIORITY.indexOf(k) < INS_PRIORITY.indexOf(cur)) {
        m[i.blockIndex] = { ...m[i.blockIndex], ins: k }
      }
    }
    const counts = new Map<number, Set<string>>()
    for (const h of others) {
      if (!counts.has(h.blockIndex)) counts.set(h.blockIndex, new Set())
      counts.get(h.blockIndex)!.add(h.createdBy)
    }
    for (const idx of myIndexes) {
      if (!counts.has(idx)) counts.set(idx, new Set())
      counts.get(idx)!.add('me')
    }
    for (const [idx, users] of counts) {
      m[idx] = { ...m[idx], hlTier: hlTier(users.size), hlCount: users.size }
    }
    return m
  }, [insights, others, myIndexes])

  // 블록 클릭 → 팝오버 (이벤트 위임 — 링크/버튼/드래그 선택 제외, 스펙 §6.4)
  const onBodyClick = useCallback((e: React.MouseEvent) => {
    const target = e.target as HTMLElement
    if (target.closest('a, button')) return
    if (window.getSelection()?.toString()) return
    const blockEl = target.closest<HTMLElement>('[data-mblock]')
    if (!blockEl) return
    const idx = Number(blockEl.dataset.mblock)
    if (!blocks[idx] || !isMarkableBlock(blocks[idx])) return
    const r = blockEl.getBoundingClientRect()
    setPopover({ blockIndex: idx, rect: { top: r.top, bottom: r.bottom, left: r.left, width: r.width } })
  }, [blocks])

  async function onToggleHighlight() {
    if (!popover) return
    const idx = popover.blockIndex
    const wasOn = myIndexes.has(idx)
    const rollback = () =>
      setMyIndexes(prev => { const s = new Set(prev); if (wasOn) s.add(idx); else s.delete(idx); return s })
    // 낙관적 업데이트 → 실패/예외 시 롤백 + 토스트
    setMyIndexes(prev => { const s = new Set(prev); if (wasOn) s.delete(idx); else s.add(idx); return s })
    setHlBusy(true)
    try {
      const res = await toggleMinuteHighlight(minute.id, idx, blocks[idx].hash)
      if (!res.ok) {
        rollback()
        toast({ title: t('min.hl.failed'), description: res.error, variant: 'error' })
      }
    } catch {
      // 네트워크 드롭·500·직렬화 오류 등 reject 경로 — busy 고착·팝오버 잔존·미롤백 방지(스펙 §6.4)
      rollback()
      toast({ title: t('min.hl.failed'), variant: 'error' })
    } finally {
      setHlBusy(false)
      setPopover(null)
    }
  }

  async function download(fileId: string) {
    setBusy(true)
    const res = await getMinuteFileUrl(fileId)
    setBusy(false)
    if (res.ok && res.url) {
      window.open(res.url, '_blank', 'noopener,noreferrer')
      setErr(null)
    } else {
      setErr(res.error ?? t('min.err.download'))
    }
  }

  async function onReplaceBody(e: ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]
    e.target.value = ''
    if (!f) return
    setErr(null)
    if (!/\.(md|markdown)$/i.test(f.name)) { setErr(t('min.err.bodyExt')); return }
    if (f.size > MINUTE_BODY_FILE_MAX) { setErr(t('min.err.bodyFileMax')); return }
    const text = await f.text()
    if (text.length > MINUTE_BODY_MAX) { setErr(t('min.err.bodyMax')); return }
    setBusy(true)
    try {
      const sb = createBrowserClient()
      const path = `${minute.id}/${Date.now()}-${sanitizeFileName(f.name)}`
      const up = await sb.storage.from('minutes').upload(path, f, { upsert: false })
      if (up.error) { setErr(`${t('min.err.upload')}: ${up.error.message}`); return }
      const res = await replaceMinuteBody(minute.id, text, {
        fileName: f.name, filePath: path, size: f.size, mime: f.type || 'text/markdown',
      })
      if (!res.ok) { await sb.storage.from('minutes').remove([path]); setErr(res.error ?? t('min.err.upload')); return }
      router.refresh()
    } finally { setBusy(false) }
  }

  async function onDelete() {
    setBusy(true)
    const res = await deleteMinute(minute.id)
    setBusy(false)
    if (!res.ok) { setErr(res.error ?? 'error'); return }
    router.push('/minutes')
  }

  const popNames = popover
    ? [...new Set(others.filter(h => h.blockIndex === popover.blockIndex)
        .map(h => h.createdByName ?? '이름 없음'))]
    : []
  const popKinds = popover
    ? [...new Set(insights.filter(i => i.blockIndex === popover.blockIndex).map(i => i.kind as InsightKind))]
    : []

  return (
    // 폭은 레이아웃 main(헤더와 동일 px 스케일)에 맡긴다 — 자체 max-w/패딩을 두면 헤더 기준선보다 안쪽으로 좁아짐
    // xl↑는 뷰포트 높이에 고정하고 본문 카드가 자체 스크롤 — 메타 헤더·채팅 패널은 스크롤과 무관하게 상주
    <div className="flex flex-col gap-4 xl:h-full xl:min-h-0">
      {/* 메타 헤더 — 메타·액션 단일 행(접기 없음). 좁은 폭에서만 wrap */}
      <div className="card shrink-0 space-y-2 p-4">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <Link href="/minutes" className="inline-flex items-center gap-1 text-sm text-ink-muted hover:text-ink">
            <ArrowLeft className="h-4 w-4" />{t('min.detail.back')}
          </Link>
          <span className="text-sm tabular-nums text-ink-muted">{minute.minuteDate}</span>
          <span className={`inline-flex rounded-md px-1.5 py-0.5 text-[11px] font-bold text-white ${TEAM[minute.teamCode].bar}`}>
            {minute.teamCode}
          </span>
          <h1 className="min-w-0 flex-1 truncate text-lg font-bold text-ink">{minute.title}</h1>

          <div className="flex flex-wrap items-center justify-end gap-x-2 gap-y-1">
            {bodyFile ? (
              <button onClick={() => void download(bodyFile.id)} disabled={busy} className="btn h-8 px-2.5 text-xs">
                <Download className="h-3.5 w-3.5" />{t('min.detail.download')}
              </button>
            ) : (
              <span className="text-xs text-delayed">{t('min.detail.noBodyFile')}</span>
            )}
            {attachments.map(f => (
              <button key={f.id} onClick={() => void download(f.id)} disabled={busy}
                className="btn h-8 max-w-[10rem] px-2.5 text-xs">
                <Paperclip className="h-3.5 w-3.5 shrink-0" /><span className="truncate">{f.fileName}</span>
              </button>
            ))}
            {minute.meetingId && minute.meetingProjectId && (
              <Link href={`/p/${minute.meetingProjectId}/meetings`}
                className="inline-flex items-center gap-1 text-xs text-brand underline underline-offset-2 hover:text-brand-hover">
                <ExternalLink className="h-3.5 w-3.5" />{t('min.detail.linkedMeeting')}
              </Link>
            )}
            {canManage && (
              <>
                <button onClick={() => setShareOpen(true)} className="btn h-8 px-2.5 text-xs">
                  <Share2 className="h-3.5 w-3.5" />{t('min.share.button')}
                </button>
                <button onClick={() => setMetaOpen(true)} className="btn h-8 px-2.5 text-xs">{t('min.detail.edit')}</button>
                <label className="btn h-8 cursor-pointer px-2.5 text-xs">
                  {t('min.detail.replaceBody')}
                  <input type="file" accept=".md,.markdown" className="hidden" onChange={onReplaceBody} />
                </label>
                <button onClick={() => setConfirmOpen(true)} className="btn h-8 px-2.5 text-xs text-delayed">
                  {t('min.detail.delete')}
                </button>
              </>
            )}
            <span className="text-xs text-ink-subtle">{minute.createdByName ?? ''}</span>
            <button onClick={() => setFocus(f => !f)}
              title={focus ? t('min.focus.off') : t('min.focus.on')}
              aria-label={focus ? t('min.focus.off') : t('min.focus.on')} aria-pressed={focus}
              className={`inline-flex items-center gap-1 text-xs ${focus ? 'text-brand' : 'text-ink-muted hover:text-ink'}`}>
              {focus ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
              {t('min.focus.on')}
            </button>
          </div>
        </div>
        {err && <p className="text-sm text-delayed">{err}</p>}
      </div>

      {/* 핵심 요약 카드 — shrink-0 유지(xl 높이 체인) */}
      <MinuteInsightCard
        minuteId={minute.id} insights={annotations.insights} highlights={annotations.highlights}
        blocks={blocks} bodyHash={bodyHash} onJump={jumpTo}
      />

      {/* xl 미만 목차 아코디언은 MinuteToc 내부에서 분기 렌더 */}
      {/* 목차 + 본문 + (Task 17: 우측 채팅 패널) */}
      <div className="flex flex-col gap-4 xl:min-h-0 xl:flex-1 xl:flex-row">
        {/* 집중 모드 — 목차·채팅을 숨겨 본문이 전체 폭 사용 */}
        {!focus && (
          <MinuteToc
            blocks={blocks} insights={insights} highlights={annotations.highlights}
            onJump={jumpTo} activeIndex={activeToc}
          />
        )}
        <div ref={bodyRef} onClick={onBodyClick} className="card min-w-0 flex-1 p-5 xl:overflow-y-auto">
          <MarkdownView content={minute.bodyMd} marks={marks} />
        </div>
        {!focus && <MinuteChatPanel minuteId={minute.id} />}
      </div>

      {popover && (
        <MinuteBlockPopover
          state={popover} mine={myIndexes.has(popover.blockIndex)}
          names={popNames} insKinds={popKinds} busy={hlBusy}
          onToggle={() => void onToggleHighlight()} onClose={() => setPopover(null)}
        />
      )}

      {/* 열 때마다 리마운트 — 이전 입력·회의 선택이 잔존하지 않게 현재 회의록 값으로 초기화 */}
      {metaOpen && (
        <MinuteMetaModal open onClose={() => setMetaOpen(false)} onSaved={() => { setMetaOpen(false); router.refresh() }}
          minute={minute} projects={projects} />
      )}

      <MinuteShareModal open={shareOpen} onClose={() => setShareOpen(false)} minuteId={minute.id} />

      <Modal open={confirmOpen} onClose={() => setConfirmOpen(false)} title={t('min.detail.delete')} size="sm"
        footer={
          <div className="flex justify-end gap-2">
            <button onClick={() => setConfirmOpen(false)} className="btn">{t('common.cancel')}</button>
            <button onClick={() => { setConfirmOpen(false); void onDelete() }} disabled={busy} className="btn text-delayed">
              {t('min.detail.delete')}
            </button>
          </div>
        }>
        <p className="text-sm text-ink">{t('min.detail.deleteConfirm')}</p>
      </Modal>
    </div>
  )
}
