'use client'

// 병목 제안 기준(강제 진행 스펙 2026-09-23 F14) — 한 선행이 후속 N건 이상을 T시간 넘게 막으면 오피스 층 머리에
// 강제 진행을 제안한다. 제안까지만 한다(자동 면제 없음). 검증 정본은 도메인 validateBottleneckSettings 이고
// 서버 액션(updateBottleneckSettings)이 다시 검사한다.
import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { updateBottleneckSettings } from '@/app/actions/project'
import type { BottleneckSettings } from '@/lib/domain/forceProgress'

export function BottleneckSettingsForm({ projectId, initial, editable }: { projectId: string; initial: BottleneckSettings; editable: boolean }) {
  const router = useRouter()
  const [bn, setBn] = useState<BottleneckSettings>(initial)
  const [msg, setMsg] = useState<string | null>(null)
  const [pending, start] = useTransition()
  const save = () => start(async () => {
    const r = await updateBottleneckSettings(projectId, bn)
    setMsg(r.ok ? '저장했습니다.' : r.error ?? '저장하지 못했습니다.')
    if (r.ok) router.refresh()
  })
  return (
    <div data-bottleneck-settings className="space-y-1.5">
      <div className="flex flex-wrap items-center gap-2 text-xs text-ink">
        <label className="flex items-center gap-1.5">후속
          <input type="number" min={1} step={1} className="app-input h-7 w-16 text-xs" disabled={!editable || pending}
            aria-label="막힌 후속 건수" value={bn.minSuccessors} onChange={e => setBn({ ...bn, minSuccessors: Number(e.target.value) })} />
          건 이상을</label>
        <label className="flex items-center gap-1.5">
          <input type="number" min={1} step={1} className="app-input h-7 w-16 text-xs" disabled={!editable || pending}
            aria-label="막힌 시간" value={bn.minHours} onChange={e => setBn({ ...bn, minHours: Number(e.target.value) })} />
          시간 넘게 막으면 제안</label>
        {editable && (
          <button type="button" className="btn h-7 px-2.5 text-xs" disabled={pending} onClick={save}>저장</button>
        )}
      </div>
      {msg && <p role="status" className="text-[11px] text-ink-muted">{msg}</p>}
    </div>
  )
}
