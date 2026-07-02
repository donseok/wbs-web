'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Pencil } from 'lucide-react'
import { Modal } from '@/components/ui/Modal'
import { useToast } from '@/components/ui/Toast'
import { updateProject } from '@/app/actions/project'
import { isValidDateRange } from '@/lib/domain/validate'
import { useLocale } from '@/components/providers/LocaleProvider'

export function ProjectInfoEditButton({
  projectId, name, description, startDate, endDate,
}: {
  projectId: string
  name: string
  description: string | null
  startDate: string | null
  endDate: string | null
}) {
  const router = useRouter()
  const { toast } = useToast()
  const { t } = useLocale()
  const [open, setOpen] = useState(false)
  const [pending, start] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [form, setForm] = useState({
    name, description: description ?? '', start_date: startDate ?? '', end_date: endDate ?? '',
  })

  const save = () => {
    setError(null)
    if (!isValidDateRange(form.start_date || null, form.end_date || null)) {
      setError(t('settings.invalidDateRange'))
      return
    }
    start(async () => {
      const res = await updateProject(projectId, {
        name: form.name,
        description: form.description,
        start_date: form.start_date || null,
        end_date: form.end_date || null,
      })
      if (!res.ok) { setError(res.error ?? t('settings.saveFailed')); return }
      setOpen(false)
      toast({ title: t('settings.infoSaved'), variant: 'success' })
      router.refresh()
    })
  }

  return (
    <>
      <button onClick={() => setOpen(true)} className="btn btn-ghost h-9 px-3 text-[13px]">
        <Pencil className="h-3.5 w-3.5" />{t('common.edit')}
      </button>
      <Modal open={open} onClose={() => setOpen(false)} eyebrow="CORE INFORMATION" title={t('settings.editInfoTitle')}
        footer={
          <>
            <button onClick={() => setOpen(false)} className="btn btn-ghost h-9 px-4">{t('common.cancel')}</button>
            <button onClick={save} disabled={pending || !form.name.trim()} className="btn btn-primary h-9 px-4">{pending ? t('settings.saving') : t('common.save')}</button>
          </>
        }>
        <div className="space-y-4">
          <label className="block">
            <span className="mb-1.5 block text-xs font-semibold text-ink-muted">{t('settings.projectName')} *</span>
            <input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} className="app-input" placeholder={t('settings.projectNamePlaceholder')} />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-xs font-semibold text-ink-muted">{t('settings.description')}</span>
            <textarea value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} rows={3} className="app-textarea" placeholder={t('settings.descriptionPlaceholder')} />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block"><span className="mb-1.5 block text-xs font-semibold text-ink-muted">{t('settings.startDate')}</span><input type="date" value={form.start_date} onChange={e => setForm({ ...form, start_date: e.target.value })} className="app-input px-2 text-xs" /></label>
            <label className="block"><span className="mb-1.5 block text-xs font-semibold text-ink-muted">{t('settings.endDate')}</span><input type="date" value={form.end_date} min={form.start_date || undefined} onChange={e => setForm({ ...form, end_date: e.target.value })} className="app-input px-2 text-xs" /></label>
          </div>
          {error && <p className="text-xs font-medium text-delayed">{error}</p>}
        </div>
      </Modal>
    </>
  )
}
