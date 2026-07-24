'use client'

import { useState } from 'react'
import { Modal } from '@/components/ui/Modal'
import { useLocale } from '@/components/providers/LocaleProvider'

const PRESETS = [10, 30, 50, 70, 90]

/** 진척% 입력 — 프리셋 칩 + 직접입력(1~99, initial로 프리필). 진행중 진입/재개 시 사용. Modal(size sm) 기반. */
export function ProgressPopover({
  open, title, initial, onSubmit, onClose,
}: {
  open: boolean
  title: string
  initial: number
  onSubmit: (pct: number) => void
  onClose: () => void
}) {
  const { t } = useLocale()
  const [custom, setCustom] = useState(String(initial))
  const clamp = (n: number) => Math.max(1, Math.min(99, Math.round(n)))
  return (
    <Modal
      open={open}
      onClose={onClose}
      eyebrow="KANBAN"
      title={title}
      size="sm"
      footer={<button className="btn btn-ghost" onClick={onClose}>{t('kanban.cancel')}</button>}
    >
      <p className="mb-3 text-sm text-ink-muted">{t('kanban.progressDesc')}</p>
      <div className="flex flex-wrap gap-2">
        {PRESETS.map(p => (
          <button
            key={p}
            className="badge bg-surface-2 text-ink hover:bg-brand-weak hover:text-brand"
            onClick={() => onSubmit(p)}
          >{p}%</button>
        ))}
      </div>
      <div className="mt-4 flex items-center gap-2">
        <input
          type="number" min={1} max={99} inputMode="numeric"
          value={custom}
          onChange={e => setCustom(e.target.value)}
          placeholder={t('kanban.progressCustom')}
          aria-label={t('kanban.progressCustom')}
          className="app-input w-32"
        />
        <button
          className="btn btn-primary"
          disabled={custom.trim() === '' || Number.isNaN(Number(custom))}
          onClick={() => onSubmit(clamp(Number(custom)))}
        >{t('kanban.progressApply')}</button>
      </div>
    </Modal>
  )
}
