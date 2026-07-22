'use client'

import { useMemo } from 'react'
import { Modal } from '@/components/ui/Modal'
import { lintWeeklySheet, type LintFinding, type LintKind } from '@/lib/domain/weeklyLint'
import type { WeeklyCellEdit, WeeklyCellKey, WeeklySheetRow } from '@/lib/domain/weeklySheet'

const KIND_LABEL: Record<LintKind, string> = { duplicate: '중복', numbering: '체번', format: '정리' }
const KIND_TONE: Record<LintKind, string> = {
  duplicate: 'bg-amber-100 text-amber-800',
  numbering: 'bg-amber-100 text-amber-800',
  format: 'bg-sky-100 text-sky-800',
}

/** 주간보고 점검 패널 — 현재 화면의 rows로 지적을 계산해 보여주고, 항목별로 수정을 적용한다.
 *  저장은 부모가 넘긴 onApply(=runBatch)가 담당한다. 이 컴포넌트는 I/O를 하지 않는다. */
export function WeeklyLintPanel({ open, rows, onClose, onApply, onGoToCell }: {
  open: boolean
  rows: WeeklySheetRow[]
  onClose: () => void
  onApply: (edits: WeeklyCellEdit[]) => void
  onGoToCell: (rowId: string, cellKey: WeeklyCellKey) => void
}) {
  // 열려 있는 동안 rows가 바뀔 때마다 재계산 — 적용 직후에도, 타인의 Realtime 수정에도 목록이 따라간다.
  // 10행 × 4열이라 비용은 무시할 만하다. 닫혀 있으면 계산하지 않는다.
  const findings = useMemo(() => (open ? lintWeeklySheet(rows) : []), [open, rows])

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="주간보고 점검"
      eyebrow={findings.length > 0 ? `${findings.length}건` : undefined}
      size="lg"
      footer={<button type="button" className="btn btn-ghost" onClick={onClose}>닫기</button>}
    >
      {findings.length === 0 ? (
        <p className="py-6 text-center text-sm text-ink-muted">점검할 내용이 없습니다.</p>
      ) : (
        <ul className="divide-y divide-line">
          {findings.map(f => (
            <LintRow
              key={f.id}
              finding={f}
              onApply={() => onApply(f.edits)}
              onGo={() => { onClose(); onGoToCell(f.rowId, f.cellKey) }}
            />
          ))}
        </ul>
      )}
    </Modal>
  )
}

function LintRow({ finding, onApply, onGo }: {
  finding: LintFinding; onApply: () => void; onGo: () => void
}) {
  return (
    <li className="flex items-start gap-3 py-3">
      <span className={`mt-0.5 shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ${KIND_TONE[finding.kind]}`}>
        {KIND_LABEL[finding.kind]}
      </span>
      <div className="min-w-0 flex-1">
        {/* 제목 클릭 = 모달 닫고 해당 셀로 이동. 어디를 말하는지 눈으로 확인하고 직접 고칠 수 있게. */}
        <button
          type="button"
          onClick={onGo}
          className="text-left text-sm font-semibold text-ink underline-offset-2 hover:underline"
        >
          {finding.title}
        </button>
        <p className="mt-0.5 whitespace-pre-wrap break-words text-xs text-ink-muted">{finding.detail}</p>
      </div>
      <button type="button" className="btn btn-ghost shrink-0 text-xs" onClick={onApply}>적용</button>
    </li>
  )
}
