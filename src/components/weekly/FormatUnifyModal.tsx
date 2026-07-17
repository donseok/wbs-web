'use client'

import { Modal } from '@/components/ui/Modal'
import { WEEKLY_CELL_LABEL } from '@/lib/domain/weeklySheet'
import type { WeeklyFormatEdit } from '@/lib/domain/weeklyFormat'

/** 양식 통일 미리보기 — 바뀌는 셀만 전/후 대조로 보여준다. 적용(저장·undo)은 부모의 runBatch가 수행. */
export function FormatUnifyModal({ open, edits, onClose, onApply }: {
  open: boolean
  edits: WeeklyFormatEdit[]
  onClose: () => void
  onApply: () => void
}) {
  const footer = (
    <>
      <button type="button" onClick={onClose} className="btn btn-ghost">취소</button>
      <button type="button" onClick={onApply} className="btn btn-primary">{edits.length}개 셀 적용</button>
    </>
  )
  return (
    <Modal open={open} onClose={onClose} eyebrow="Format unify" title="양식 통일 미리보기" size="lg" footer={footer}>
      <p className="mb-4 text-sm text-ink-muted">
        마커·번호·빈 줄만 표준 양식으로 정리하며 내용은 바꾸지 않습니다. 적용 후 Ctrl+Z로 되돌릴 수 있습니다.
      </p>
      <div className="space-y-4">
        {edits.map(e => (
          <div key={`${e.rowId}:${e.cellKey}`} className="card p-3">
            <div className="mb-2 text-xs font-semibold text-ink">{e.section} · {WEEKLY_CELL_LABEL[e.cellKey]}</div>
            {/* 셀 원문 대조 — 시트와 같은 이유('문서')로 다크모드에서도 밝은 고정 색상 */}
            <div className="grid grid-cols-2 gap-2 text-[12px] leading-5">
              <div>
                <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-ink-subtle">전</div>
                <pre className="whitespace-pre-wrap rounded border border-neutral-300 bg-white p-2 font-mono text-neutral-500">{e.before}</pre>
              </div>
              <div>
                <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-ink-subtle">후</div>
                <pre className="whitespace-pre-wrap rounded border border-neutral-300 bg-white p-2 font-mono text-black">{e.after}</pre>
              </div>
            </div>
          </div>
        ))}
      </div>
    </Modal>
  )
}
