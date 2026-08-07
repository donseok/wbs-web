'use client'

import { useEffect, useMemo, useState } from 'react'
import { LoaderCircle, Sparkles } from 'lucide-react'
import { Modal } from '@/components/ui/Modal'
import { WEEKLY_CELL_MAX } from '@/lib/domain/weeklySheet'
import type { WeeklyRewriteCandidate } from '@/lib/domain/weeklyRewrite'

export interface WeeklyAiRewriteItem extends WeeklyRewriteCandidate {
  section: string
  label: string
}

const itemKey = (item: Pick<WeeklyAiRewriteItem, 'rowId' | 'cellKey'>) =>
  `${item.rowId}:${item.cellKey}`

/** AI 결과는 저장 전 미리보기로만 보여주며, 사용자가 고른 제안만 부모의 배치 저장 경로로 넘긴다. */
export function WeeklyAiRewriteModal({
  open, busy, error, items, onClose, onRetry, onApply,
}: {
  open: boolean
  busy: boolean
  error: string | null
  items: WeeklyAiRewriteItem[]
  onClose: () => void
  onRetry: () => void
  onApply: (items: WeeklyRewriteCandidate[]) => void
}) {
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [checked, setChecked] = useState<Record<string, boolean>>({})

  useEffect(() => {
    if (!open) return
    setDrafts(Object.fromEntries(items.map(item => [itemKey(item), item.content])))
    setChecked(Object.fromEntries(items.map(item => [itemKey(item), item.content !== item.original])))
  }, [open, items])

  const selected = useMemo(() => items.flatMap(item => {
    const key = itemKey(item)
    const content = drafts[key] ?? item.content
    if (!checked[key] || !content.trim() || content === item.original) return []
    return [{ rowId: item.rowId, cellKey: item.cellKey, original: item.original, content }]
  }), [checked, drafts, items])

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="AI로 다시 작성"
      eyebrow={items.length > 0 ? `${items.length}개 셀` : undefined}
      size="lg"
      footer={(
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose}>취소</button>
          <button type="button" className="btn btn-ghost" disabled={busy} onClick={onRetry}>다시 생성</button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={busy || selected.length === 0}
            onClick={() => onApply(selected)}
          >
            선택한 제안 적용{selected.length > 0 ? ` (${selected.length})` : ''}
          </button>
        </>
      )}
    >
      <div className="space-y-4">
        <div className="flex gap-3 rounded-2xl border border-violet-200 bg-violet-50 px-4 py-3 text-sm text-violet-950">
          <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-violet-600" />
          <p>
            선택한 내용과 구분 정보만 AI에 보내 보고서 문장으로 다듬습니다. 아래에서 원문과 제안을 비교한 뒤
            적용할 수 있으며, <b>적용 전에는 저장되지 않습니다.</b>
          </p>
        </div>

        {error && (
          <div role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        )}

        {busy && items.length === 0 && (
          <div className="flex min-h-40 flex-col items-center justify-center gap-3 text-sm text-ink-muted" aria-live="polite">
            <LoaderCircle className="h-7 w-7 animate-spin text-violet-600" />
            선택한 내용을 깔끔하게 다듬고 있습니다…
          </div>
        )}

        {!busy && items.length === 0 && !error && (
          <p className="py-8 text-center text-sm text-ink-muted">다듬을 제안이 없습니다.</p>
        )}

        {items.length > 0 && (
          <div className={`space-y-3 ${busy ? 'pointer-events-none opacity-60' : ''}`} aria-busy={busy}>
            {items.map(item => {
              const key = itemKey(item)
              const draft = drafts[key] ?? item.content
              const changed = draft !== item.original
              return (
                <section key={key} className="rounded-2xl border border-line bg-surface-2 p-4">
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <label className="flex min-w-0 items-center gap-2 text-sm font-semibold text-ink">
                      <input
                        type="checkbox"
                        checked={!!checked[key]}
                        onChange={event => setChecked(current => ({ ...current, [key]: event.target.checked }))}
                        aria-label={`${item.section} ${item.label} 제안 선택`}
                      />
                      <span className="truncate">{item.section}</span>
                      <span className="shrink-0 text-xs font-normal text-ink-muted">{item.label}</span>
                    </label>
                    {!changed && <span className="shrink-0 text-xs text-ink-muted">변경 없음</span>}
                  </div>
                  <div className="grid gap-3 md:grid-cols-2">
                    <div>
                      <div className="mb-1 text-xs font-semibold text-ink-muted">원문</div>
                      <div className="min-h-28 whitespace-pre-wrap break-words rounded-xl border border-line bg-surface px-3 py-2.5 text-sm text-ink-muted">
                        {item.original}
                      </div>
                    </div>
                    <label>
                      <span className="mb-1 block text-xs font-semibold text-violet-700">AI 제안 · 수정 가능</span>
                      <textarea
                        value={draft}
                        maxLength={WEEKLY_CELL_MAX}
                        rows={5}
                        onChange={event => {
                          const content = event.target.value
                          setDrafts(current => ({ ...current, [key]: content }))
                          setChecked(current => ({ ...current, [key]: content !== item.original }))
                        }}
                        aria-label={`${item.section} ${item.label} AI 제안`}
                        className="min-h-28 w-full resize-y rounded-xl border border-violet-200 bg-surface px-3 py-2.5 text-sm text-ink outline-none transition focus:border-violet-500 focus:ring-2 focus:ring-violet-200"
                      />
                    </label>
                  </div>
                </section>
              )
            })}
          </div>
        )}
      </div>
    </Modal>
  )
}
