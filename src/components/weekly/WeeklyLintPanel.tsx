'use client'

import { useMemo } from 'react'
import { Modal } from '@/components/ui/Modal'
import { lintWeeklySheet, type LintFinding, type LintKind } from '@/lib/domain/weeklyLint'
import type { WeeklyCellEdit, WeeklyCellKey, WeeklySheetRow } from '@/lib/domain/weeklySheet'

const KIND_LABEL: Record<LintKind, string> = {
  duplicate: '완전 중복', nearDuplicate: '유사 중복', numbering: '체번', format: '정리',
}
const KIND_TONE: Record<LintKind, string> = {
  duplicate: 'bg-amber-100 text-amber-800',
  nearDuplicate: 'bg-orange-100 text-orange-800',
  numbering: 'bg-amber-100 text-amber-800',
  format: 'bg-sky-100 text-sky-800',
}

/** 구분별 묶음. lintWeeklySheet가 구분 순서를 먼저 세워 내주므로, 처음 나온 순서를 그대로 쓴다. */
function groupBySection(findings: LintFinding[]): { section: string; items: LintFinding[] }[] {
  const out: { section: string; items: LintFinding[] }[] = []
  const at = new Map<string, number>()
  for (const f of findings) {
    const i = at.get(f.section)
    if (i === undefined) { at.set(f.section, out.length); out.push({ section: f.section, items: [f] }) }
    else out[i].items.push(f)
  }
  return out
}

/** 주간보고 점검 패널 — 현재 화면의 rows로 지적을 계산해 보여주고, 항목별로 수정을 적용한다.
 *  점검은 구분 안에서만 이뤄지므로(도메인 규칙) 목록도 구분별로 묶어 보여준다.
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
  const groups = useMemo(() => groupBySection(findings), [findings])

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
        <>
          {/* 왜 다른 구분의 같은 문구가 안 잡히는지 매번 묻지 않도록 점검 범위를 못박되,
              글머리 기호만 시트 전체 기준이라는 예외까지 같이 적는다(안 적으면 그 지적이 버그로 읽힌다). */}
          <p className="pb-2 text-xs text-ink-muted">
            점검은 구분 안에서만 합니다 — 서로 다른 구분끼리는 견주지 않습니다. (글머리 기호 통일만 시트 전체 기준)
          </p>
          <div className="divide-y divide-line">
            {groups.map(g => (
              <section key={g.section} data-lint-section={g.section} className="py-2">
                <h3 className="flex items-baseline gap-2 pb-1 text-sm font-semibold text-ink">
                  {g.section}
                  <span className="text-xs font-normal text-ink-muted">{g.items.length}건</span>
                </h3>
                <ul className="divide-y divide-line/60">
                  {g.items.map(f => (
                    <LintRow
                      key={f.id}
                      finding={f}
                      onApply={() => onApply(f.edits)}
                      // 셀 이동은 모달이 닫히는 커밋 '뒤'로 미룬다 — 같은 틱에 옮기면
                      // Modal이 닫히며 열 때 캡처한 트리거(점검 버튼)로 포커스를 되돌려 이동이 무효가 된다.
                      onGo={() => { onClose(); setTimeout(() => onGoToCell(f.rowId, f.cellKey), 0) }}
                    />
                  ))}
                </ul>
              </section>
            ))}
          </div>
        </>
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
      {/* 유사 중복은 edits 가 없다(어느 줄을 남길지는 사람의 판단) — 적용 버튼 대신 제목 클릭으로 셀에 간다. */}
      {finding.edits.length > 0 && (
        <button type="button" className="btn btn-ghost shrink-0 text-xs" onClick={onApply}>적용</button>
      )}
    </li>
  )
}
