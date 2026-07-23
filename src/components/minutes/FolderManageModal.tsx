'use client'
import { useState } from 'react'
import type { MinuteFolder } from '@/lib/domain/types'
import { createMinuteFolder, deleteMinuteFolder, renameMinuteFolder } from '@/app/actions/minutes'
import { useLocale } from '@/components/providers/LocaleProvider'
import { Modal } from '@/components/ui/Modal'

/** 폴더 생성/이름 변경/삭제 확인 공용 모달. 성공 시 onDone(재조회는 호출부 책임). */
export function FolderManageModal({
  open, mode, folder, parentId, onClose, onDone,
}: {
  open: boolean
  mode: 'create' | 'rename' | 'delete'
  folder?: MinuteFolder            // rename/delete 대상
  parentId: string | null          // create 의 부모(null=루트)
  onClose: () => void
  onDone: () => void
}) {
  const { t } = useLocale()
  const [name, setName] = useState(mode === 'rename' ? folder?.name ?? '' : '')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  async function submit() {
    setBusy(true); setErr(null)
    try {
      const res = mode === 'create'
        ? await createMinuteFolder(name, parentId)
        : mode === 'rename'
          ? await renameMinuteFolder(folder!.id, name)
          : await deleteMinuteFolder(folder!.id)
      if (!res.ok) { setErr(res.error ?? t('min.fold.error')); return }
      onDone()
    } finally { setBusy(false) }
  }

  const title = mode === 'create' ? t('min.fold.new') : mode === 'rename' ? t('min.fold.rename') : t('min.fold.deleteTitle')
  return (
    <Modal open={open} onClose={onClose} title={title} size="sm"
      footer={
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="btn">{t('min.fold.cancel')}</button>
          <button onClick={() => void submit()} disabled={busy || (mode !== 'delete' && !name.trim())}
            className={mode === 'delete' ? 'btn bg-delayed text-white hover:bg-delayed' : 'btn btn-primary'}>
            {busy ? t('min.form.saving') : mode === 'delete' ? t('min.fold.delete') : t('min.form.save')}
          </button>
        </div>
      }>
      <div className="space-y-3">
        {mode === 'delete' ? (
          <p className="text-sm text-ink">
            <span className="font-semibold">{folder?.name}</span> — {t('min.fold.deleteConfirm')}
          </p>
        ) : (
          <label className="block text-sm">
            <span className="mb-1 block font-medium">{t('min.fold.name')}</span>
            <input value={name} onChange={e => setName(e.target.value)} maxLength={60}
              autoFocus className="app-input" />
          </label>
        )}
        {err && <p className="text-sm text-delayed">{err}</p>}
      </div>
    </Modal>
  )
}
