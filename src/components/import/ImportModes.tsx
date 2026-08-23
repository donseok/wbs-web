'use client'

import { useState } from 'react'
import { FileSpreadsheet, FileText } from 'lucide-react'
import { ImportWizard } from '@/components/import/ImportWizard'
import { WbsMarkdownImport } from '@/components/import/WbsMarkdownImport'

/**
 * 임포트 모드 전환 — wbs.md(levels 계약 N단, 자동 부착) | 엑셀(.xlsx 위저드).
 * 기본은 마크다운: N단 분리 업로드의 정본 경로. 엑셀 위저드는 레거시·표 형태 입력용으로 유지.
 */
export function ImportModes({ projectId, isSuperuser, currentItemCount }: {
  projectId: string; isSuperuser: boolean; currentItemCount: number | null
}) {
  const [mode, setMode] = useState<'md' | 'xlsx'>('md')
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-1 rounded-xl bg-surface-2 p-1 w-fit" role="tablist">
        <button
          role="tab" aria-selected={mode === 'md'} data-mode-md
          className={`btn ${mode === 'md' ? 'btn-primary' : 'btn-ghost'}`}
          onClick={() => setMode('md')}
        >
          <FileText className="h-3.5 w-3.5" />WBS 마크다운 (wbs.md)
        </button>
        <button
          role="tab" aria-selected={mode === 'xlsx'} data-mode-xlsx
          className={`btn ${mode === 'xlsx' ? 'btn-primary' : 'btn-ghost'}`}
          onClick={() => setMode('xlsx')}
        >
          <FileSpreadsheet className="h-3.5 w-3.5" />엑셀 (.xlsx)
        </button>
      </div>
      {mode === 'md'
        ? <WbsMarkdownImport projectId={projectId} />
        : <ImportWizard projectId={projectId} isSuperuser={isSuperuser} currentItemCount={currentItemCount} />}
    </div>
  )
}
