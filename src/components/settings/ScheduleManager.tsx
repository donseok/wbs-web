'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { CalendarClock, Plus, RotateCcw, Trash2 } from 'lucide-react'
import { useToast } from '@/components/ui/Toast'
import { setBaseDate, addHoliday, removeHoliday } from '@/app/actions/project'
import { useLocale } from '@/components/providers/LocaleProvider'

export function ScheduleManager({
  projectId, baseDate, holidays, canEdit,
}: {
  projectId: string
  baseDate: string | null
  holidays: string[]
  canEdit: boolean
}) {
  const router = useRouter()
  const { toast } = useToast()
  const { t } = useLocale()
  const [pending, start] = useTransition()
  const [dateInput, setDateInput] = useState(baseDate ?? '')
  const [holDate, setHolDate] = useState('')
  const [holName, setHolName] = useState('')
  const sorted = [...holidays].sort()

  const run = (fn: () => Promise<unknown>, msg: string) => start(async () => {
    try {
      const res = await fn()
      if (res && typeof res === 'object' && 'ok' in res && (res as { ok: boolean }).ok === false) {
        toast({ title: (res as { error?: string }).error ?? t('settings.actionFailed'), variant: 'error' })
        return
      }
      router.refresh()
      toast({ title: msg, variant: 'success' })
    } catch {
      toast({ title: t('settings.actionError'), variant: 'error' })
    }
  })

  return (
    <div className="space-y-6">
      {/* 공정율 기준일 */}
      <div>
        <div className="flex items-center gap-2 text-sm font-semibold text-ink">
          <CalendarClock className="h-4 w-4 text-brand" />{t('settings.baseDateHeading')}
        </div>
        <p className="mt-1 text-xs leading-5 text-ink-muted">
          {t('settings.baseDateDesc1')}<strong className="text-ink">{t('settings.baseDateDescStrong')}</strong>{t('settings.baseDateDesc2')}
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className={`chip ${baseDate ? 'bg-pending-weak text-accent-warning' : 'bg-brand-weak text-brand'}`}>
            {baseDate ? `${t('settings.manualFixed')} · ${baseDate}` : t('settings.autoTodayChip')}
          </span>
          {canEdit && (
            <>
              <input type="date" value={dateInput} onChange={e => setDateInput(e.target.value)} className="app-input h-9 w-40 px-2 text-xs" />
              <button disabled={pending || !dateInput} onClick={() => run(() => setBaseDate(projectId, dateInput), t('settings.baseDateApplied'))} className="btn btn-primary h-9 px-3 text-[13px]">{t('settings.apply')}</button>
              {baseDate && (
                <button disabled={pending} onClick={() => { setDateInput(''); run(() => setBaseDate(projectId, null), t('settings.baseDateReset')) }} className="btn btn-ghost h-9 px-3 text-[13px]"><RotateCcw className="h-3.5 w-3.5" />{t('settings.toAuto')}</button>
              )}
            </>
          )}
        </div>
      </div>

      {/* 공휴일 / 비근무일 */}
      <div className="border-t border-line pt-5">
        <div className="text-sm font-semibold text-ink">{t('settings.holidaysHeading')}</div>
        <p className="mt-1 text-xs leading-5 text-ink-muted">{t('settings.holidaysDesc')} {t('settings.holidaysTotalPrefix')}{sorted.length}{t('settings.holidaysTotalSuffix')}</p>

        {sorted.length > 0 ? (
          <ul className="mt-3 flex flex-wrap gap-2">
            {sorted.map(d => (
              <li key={d} className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-surface-2 py-1 pl-2.5 pr-1.5 text-xs tabular-nums text-ink">
                {d}
                {canEdit && (
                  <button disabled={pending} onClick={() => run(() => removeHoliday(projectId, d), t('settings.holidayRemoved'))} className="flex h-5 w-5 items-center justify-center rounded text-ink-subtle transition hover:bg-delayed-weak hover:text-delayed" aria-label={`${t('settings.holidayRemoveAria')}: ${d}`}><Trash2 className="h-3 w-3" /></button>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-3 text-xs text-ink-subtle">{t('settings.noHolidays')}</p>
        )}

        {canEdit && (
          <div className="mt-3 flex flex-wrap items-end gap-2">
            <label className="block"><span className="mb-1 block text-[11px] font-semibold text-ink-muted">{t('settings.date')}</span><input type="date" value={holDate} onChange={e => setHolDate(e.target.value)} className="app-input h-9 w-40 px-2 text-xs" /></label>
            <label className="block"><span className="mb-1 block text-[11px] font-semibold text-ink-muted">{t('settings.nameOptional')}</span><input value={holName} onChange={e => setHolName(e.target.value)} placeholder={t('settings.holidayNamePlaceholder')} className="app-input h-9 w-44 text-xs" /></label>
            <button disabled={pending || !holDate} onClick={() => { run(() => addHoliday(projectId, holDate, holName), t('settings.holidayAdded')); setHolDate(''); setHolName('') }} className="btn btn-primary h-9 px-3 text-[13px]"><Plus className="h-3.5 w-3.5" />{t('common.add')}</button>
          </div>
        )}
      </div>
    </div>
  )
}
