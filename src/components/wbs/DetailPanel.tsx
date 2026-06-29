'use client'
import { useState } from 'react'
import type { ComputedItem } from '@/lib/domain/types'
import { updateActual } from '@/app/actions/wbs'
import { useRouter } from 'next/navigation'

export function DetailPanel({ item, canEdit }: { item: ComputedItem | null; canEdit: boolean }) {
  const router = useRouter()
  const [val, setVal] = useState('')
  const [msg, setMsg] = useState('')
  if (!item) return <aside className="border-l p-3 text-sm text-gray-400">행을 선택하세요</aside>
  const isLeaf = item.children.length === 0
  async function save() {
    const res = await updateActual(item!.id, Number(val))
    if (res.ok) { setMsg('저장됨'); router.refresh() } else setMsg(res.error ?? '오류')
  }
  return (
    <aside className="space-y-2 border-l p-3 text-sm">
      <h3 className="font-semibold">{item.name}</h3>
      <p>산출물: {item.deliverable ?? '-'}</p>
      <p>일정: {item.plannedStart ?? '-'} ~ {item.plannedEnd ?? '-'}</p>
      <p>담당: {item.owners.map(o => `${o.team}(${o.kind === 'primary' ? '주관' : '지원'})`).join(', ') || '-'}</p>
      <p>계획 {item.plannedPct}% / 실적 {item.rolledActualPct}% / 달성율 {item.achievement ?? '-'}%</p>
      {isLeaf && canEdit ? (
        <div className="flex items-center gap-2">
          <input className="w-20 border p-1" type="number" min={0} max={100}
            placeholder={String(item.rolledActualPct)} value={val} onChange={e => setVal(e.target.value)} />
          <button className="bg-black px-2 text-white" onClick={save}>저장</button>
          <span className="text-xs text-gray-500">{msg}</span>
        </div>
      ) : isLeaf ? <p className="text-xs text-gray-400">담당 작업만 수정 가능</p>
        : <p className="text-xs text-gray-400">상위 항목은 자동 집계</p>}
    </aside>
  )
}
