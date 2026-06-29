'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { CalendarClock, Plus, RotateCcw, Trash2 } from 'lucide-react'
import { useToast } from '@/components/ui/Toast'
import { setBaseDate, addHoliday, removeHoliday } from '@/app/actions/project'

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
  const [pending, start] = useTransition()
  const [dateInput, setDateInput] = useState(baseDate ?? '')
  const [holDate, setHolDate] = useState('')
  const [holName, setHolName] = useState('')
  const sorted = [...holidays].sort()

  const run = (fn: () => Promise<unknown>, msg: string) => start(async () => {
    try {
      const res = await fn()
      if (res && typeof res === 'object' && 'ok' in res && (res as { ok: boolean }).ok === false) {
        toast({ title: (res as { error?: string }).error ?? '처리에 실패했습니다.', variant: 'error' })
        return
      }
      router.refresh()
      toast({ title: msg, variant: 'success' })
    } catch {
      toast({ title: '처리 중 오류가 발생했습니다.', variant: 'error' })
    }
  })

  return (
    <div className="space-y-6">
      {/* 공정율 기준일 */}
      <div>
        <div className="flex items-center gap-2 text-sm font-semibold text-ink">
          <CalendarClock className="h-4 w-4 text-brand" />공정율 기준일 (Base date)
        </div>
        <p className="mt-1 text-xs leading-5 text-ink-muted">
          계획 공정율을 산정하는 기준 날짜입니다. 비워두면 <strong className="text-ink">오늘(자동)</strong>로 계산됩니다.
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className={`chip ${baseDate ? 'bg-pending-weak text-accent-warning' : 'bg-brand-weak text-brand'}`}>
            {baseDate ? `수동 고정 · ${baseDate}` : '자동 · 오늘 기준'}
          </span>
          {canEdit && (
            <>
              <input type="date" value={dateInput} onChange={e => setDateInput(e.target.value)} className="app-input h-9 w-40 px-2 text-xs" />
              <button disabled={pending || !dateInput} onClick={() => run(() => setBaseDate(projectId, dateInput), '공정율 기준일을 적용했습니다.')} className="btn btn-primary h-9 px-3 text-[13px]">적용</button>
              {baseDate && (
                <button disabled={pending} onClick={() => { setDateInput(''); run(() => setBaseDate(projectId, null), '자동(오늘) 기준으로 전환했습니다.') }} className="btn btn-ghost h-9 px-3 text-[13px]"><RotateCcw className="h-3.5 w-3.5" />자동으로</button>
              )}
            </>
          )}
        </div>
      </div>

      {/* 공휴일 / 비근무일 */}
      <div className="border-t border-line pt-5">
        <div className="text-sm font-semibold text-ink">공휴일 · 비근무일</div>
        <p className="mt-1 text-xs leading-5 text-ink-muted">영업일 기반 계획 공정율 계산에서 제외됩니다. 총 {sorted.length}일.</p>

        {sorted.length > 0 ? (
          <ul className="mt-3 flex flex-wrap gap-2">
            {sorted.map(d => (
              <li key={d} className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-surface-2 py-1 pl-2.5 pr-1.5 text-xs tabular-nums text-ink">
                {d}
                {canEdit && (
                  <button disabled={pending} onClick={() => run(() => removeHoliday(projectId, d), '공휴일을 삭제했습니다.')} className="flex h-5 w-5 items-center justify-center rounded text-ink-subtle transition hover:bg-delayed-weak hover:text-delayed" aria-label={`${d} 삭제`}><Trash2 className="h-3 w-3" /></button>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-3 text-xs text-ink-subtle">등록된 공휴일이 없습니다.</p>
        )}

        {canEdit && (
          <div className="mt-3 flex flex-wrap items-end gap-2">
            <label className="block"><span className="mb-1 block text-[11px] font-semibold text-ink-muted">날짜</span><input type="date" value={holDate} onChange={e => setHolDate(e.target.value)} className="app-input h-9 w-40 px-2 text-xs" /></label>
            <label className="block"><span className="mb-1 block text-[11px] font-semibold text-ink-muted">명칭(선택)</span><input value={holName} onChange={e => setHolName(e.target.value)} placeholder="예: 창립기념일" className="app-input h-9 w-44 text-xs" /></label>
            <button disabled={pending || !holDate} onClick={() => { run(() => addHoliday(projectId, holDate, holName), '공휴일을 추가했습니다.'); setHolDate(''); setHolName('') }} className="btn btn-primary h-9 px-3 text-[13px]"><Plus className="h-3.5 w-3.5" />추가</button>
          </div>
        )}
      </div>
    </div>
  )
}
