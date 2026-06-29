'use client'
import { useState } from 'react'
import type { ComputedItem } from '@/lib/domain/types'
import { updateActual } from '@/app/actions/wbs'
import { useRouter } from 'next/navigation'

const STATUS: Record<string, { label: string; cls: string }> = {
  not_started: { label: '시작전', cls: 'bg-pending-weak text-pending' },
  in_progress: { label: '진행중', cls: 'bg-progress-weak text-progress' },
  delayed: { label: '지연', cls: 'bg-delayed-weak text-delayed' },
  done: { label: '완료', cls: 'bg-done-weak text-done' },
}

export function DetailPanel({ item, canEdit }: { item: ComputedItem | null; canEdit: boolean }) {
  const router = useRouter()
  const [val, setVal] = useState('')
  const [msg, setMsg] = useState('')
  if (!item) return (
    <aside className="card sticky top-20 flex min-h-[200px] items-center justify-center p-4 text-center text-sm text-ink-subtle">
      행을 선택하면 상세 정보가 표시됩니다
    </aside>
  )
  const isLeaf = item.children.length === 0
  const st = STATUS[item.status]
  async function save() {
    const res = await updateActual(item!.id, Number(val))
    if (res.ok) { setMsg('저장됨'); router.refresh() } else setMsg(res.error ?? '오류')
  }
  return (
    <aside className="card sticky top-20 flex flex-col overflow-hidden text-sm">
      <div className="border-b border-line bg-surface-2 px-4 py-3">
        <div className="mb-1.5 flex items-center gap-2">
          <span className={`badge ${st.cls}`}>{st.label}</span>
          {!isLeaf && <span className="badge bg-pending-weak text-pending">집계 항목</span>}
        </div>
        <h3 className="font-semibold leading-snug text-ink">{item.name}</h3>
      </div>

      <div className="space-y-3 p-4">
        <Field label="산출물" value={item.deliverable ?? '-'} />
        <Field label="일정" value={`${item.plannedStart ?? '-'} ~ ${item.plannedEnd ?? '-'}`} mono />
        <Field
          label="담당"
          value={item.owners.map(o => `${o.team}(${o.kind === 'primary' ? '주관' : '지원'})`).join(', ') || '-'}
        />

        <div className="grid grid-cols-3 gap-2 pt-1">
          <Stat label="계획" value={`${item.plannedPct}%`} />
          <Stat label="실적" value={`${item.rolledActualPct}%`} tone={item.status === 'delayed' ? 'delayed' : 'done'} />
          <Stat label="달성율" value={item.achievement != null ? `${item.achievement}%` : '-'} />
        </div>

        {isLeaf && canEdit ? (
          <div className="mt-2 rounded-lg border border-line bg-surface-2 p-3">
            <label className="mb-1.5 block text-xs font-medium text-ink-muted">실적% 입력</label>
            <div className="flex items-center gap-2">
              <input className="app-input w-24" type="number" min={0} max={100}
                placeholder={String(item.rolledActualPct)} value={val} onChange={e => setVal(e.target.value)} />
              <button className="btn btn-primary" onClick={save}>저장</button>
            </div>
            {msg && <span className="mt-1.5 block text-xs text-ink-muted">{msg}</span>}
          </div>
        ) : isLeaf ? <p className="text-xs text-ink-subtle">담당 작업만 수정 가능합니다.</p>
          : <p className="text-xs text-ink-subtle">상위 항목은 하위 작업에서 자동 집계됩니다.</p>}
      </div>
    </aside>
  )
}

function Field({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <div className="mb-0.5 text-xs font-medium text-ink-muted">{label}</div>
      <div className={`text-ink ${mono ? 'font-mono text-[13px]' : ''}`}>{value}</div>
    </div>
  )
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: 'done' | 'delayed' }) {
  const color = tone === 'delayed' ? 'text-delayed' : tone === 'done' ? 'text-done' : 'text-ink'
  return (
    <div className="rounded-lg border border-line bg-surface-2 px-2 py-2 text-center">
      <div className="text-[11px] text-ink-muted">{label}</div>
      <div className={`mt-0.5 text-base font-semibold tabular-nums ${color}`}>{value}</div>
    </div>
  )
}
