'use client'

import { useState } from 'react'
import { FileText } from 'lucide-react'
import type { ComputedItem } from '@/lib/domain/types'
import { ReportModal } from './ReportModal'

/**
 * 대시보드 히어로의 "현황 보고서" 액션 버튼.
 * 클릭 시 인쇄/PDF 가능한 ReportModal을 연다. (라우트 아님)
 */
export function ReportButton({
  items,
  projectName,
  projectDescription,
  today,
  startDate,
  endDate,
}: {
  items: ComputedItem[]
  projectName: string
  projectDescription?: string | null
  today: string
  startDate?: string | null
  endDate?: string | null
}) {
  const [open, setOpen] = useState(false)

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex h-10 items-center gap-2 rounded-xl border border-white/15 bg-white/10 px-4 text-sm font-semibold text-hero-ink backdrop-blur transition hover:bg-white/20"
      >
        <FileText className="h-4 w-4" />
        현황 보고서
      </button>

      <ReportModal
        open={open}
        onClose={() => setOpen(false)}
        items={items}
        projectName={projectName}
        projectDescription={projectDescription}
        today={today}
        startDate={startDate}
        endDate={endDate}
      />
    </>
  )
}
