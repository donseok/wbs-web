'use client'
import { useState, type ReactNode } from 'react'
import { ChevronRight } from 'lucide-react'
import { queueUiPref } from '@/lib/prefs/debouncedSave'

export interface AccordionGroup { id: string; title: ReactNode; content: ReactNode }

/** 서버가 렌더한 그룹 콘텐츠를 받아 접기/펼치기만 담당. 펼침 상태는 UiPrefs로 전역 저장. */
export function DetailAccordion({ groups, initialExpanded }: {
  groups: AccordionGroup[]
  initialExpanded: string[]
}) {
  const [open, setOpen] = useState<Set<string>>(() => new Set(initialExpanded))
  // 부수효과(queueUiPref)는 업데이터 밖 이벤트 핸들러에서 — 업데이터는 순수 유지(StrictMode 이중호출 안전).
  const toggle = (id: string) => {
    const next = new Set(open)
    if (next.has(id)) next.delete(id); else next.add(id)
    setOpen(next)
    queueUiPref({ dashSections: [...next] })
  }

  return (
    <div className="space-y-3">
      {groups.map(g => {
        const isOpen = open.has(g.id)
        return (
          <div key={g.id} className="card overflow-hidden">
            <button
              type="button" onClick={() => toggle(g.id)} aria-expanded={isOpen}
              className="flex w-full items-center gap-2 px-5 py-3.5 text-left text-[13px] font-semibold text-ink transition hover:bg-surface-2/50"
            >
              <ChevronRight className={`h-4 w-4 text-ink-subtle transition-transform ${isOpen ? 'rotate-90' : ''}`} />
              {g.title}
            </button>
            {isOpen && <div className="border-t border-line px-5 pb-5 pt-4">{g.content}</div>}
          </div>
        )
      })}
    </div>
  )
}
