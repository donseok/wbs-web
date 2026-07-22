// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { act, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { WeeklyLintPanel } from '@/components/weekly/WeeklyLintPanel'
import type { WeeklySheetRow } from '@/lib/domain/weeklySheet'

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

const row: WeeklySheetRow = {
  id: 'r1', reportId: 'rep', section: 'PMO', module: '', sortOrder: 1,
  thisContent: '가\n가', thisIssue: '', nextContent: '', nextIssue: '',
}

/** 실제 배선 재현: 트리거 버튼으로 패널을 열고(=Modal이 트리거를 포커스 복원 대상으로 캡처),
 *  지적 제목 클릭 시 패널을 닫으면서 시트 셀로 이동한다. */
function Harness() {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button data-testid="trigger" onClick={() => setOpen(true)}>주간보고 점검</button>
      <textarea data-testid="cell" data-sheet-cell="" />
      <WeeklyLintPanel
        open={open}
        rows={[row]}
        onClose={() => setOpen(false)}
        onApply={() => {}}
        onGoToCell={() => document.querySelector<HTMLTextAreaElement>('[data-testid="cell"]')!.focus()}
      />
    </>
  )
}

describe('주간보고 점검 — 지적에서 셀로 이동', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    document.body.innerHTML = ''
  })

  it('제목을 누르면 패널이 닫히고 포커스가 그 셀에 남는다', async () => {
    root = createRoot(container)
    act(() => root.render(<Harness />))

    const trigger = document.querySelector<HTMLButtonElement>('[data-testid="trigger"]')!
    act(() => trigger.focus())
    act(() => trigger.click())

    const title = [...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')]
      .find(b => b.textContent === '금주실적 내용')!
    // 모달 닫힘 커밋에서 Modal이 트리거로 포커스를 되돌리므로, 셀 이동은 그 뒤에 일어나야 한다.
    await act(async () => { title.click(); await new Promise(r => setTimeout(r, 0)) })

    expect(document.querySelector('[role="dialog"]')).toBeNull()
    expect(document.activeElement).toBe(document.querySelector('[data-testid="cell"]'))
  })
})
