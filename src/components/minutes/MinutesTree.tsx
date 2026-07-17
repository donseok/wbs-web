'use client'
import { useState } from 'react'
import Link from 'next/link'
import { ChevronDown, ChevronRight, Paperclip } from 'lucide-react'
import type { MinutesTreeGroup } from '@/lib/domain/types'
import { useLocale } from '@/components/providers/LocaleProvider'
import { TEAM } from '@/components/wbs/shared'

/** 구분→회의체→회의록 트리 (스펙 2026-07-17-minutes-tree-view-design.md).
 *  레벨1은 접힘 Set(기본 펼침), 레벨2는 펼침 Set(기본 접힘) — 시드 없이 기본 상태가 성립.
 *  재조회로 groups가 바뀌어도 두 Set은 유지(사라진 키는 무해). 접힘 상태는 비영속(v1). */
export function MinutesTree({ groups }: { groups: MinutesTreeGroup[] }) {
  const { t } = useLocale()
  const [collapsedTeams, setCollapsedTeams] = useState<Set<string>>(new Set())
  const [expandedBodies, setExpandedBodies] = useState<Set<string>>(new Set())
  // 버튼 라벨·동작은 마지막으로 누른 동작 기준(개별 노드 조작은 영향 없음). 초기 '전체 펼치기'.
  const [allExpanded, setAllExpanded] = useState(false)

  function toggleTeam(teamKey: string) {
    setCollapsedTeams(prev => {
      const next = new Set(prev)
      if (next.has(teamKey)) next.delete(teamKey); else next.add(teamKey)
      return next
    })
  }
  function toggleBody(bodyKey: string) {
    setExpandedBodies(prev => {
      const next = new Set(prev)
      if (next.has(bodyKey)) next.delete(bodyKey); else next.add(bodyKey)
      return next
    })
  }
  function toggleAll() {
    if (allExpanded) {
      // 전체 접기 — 레벨1까지 전부 접음(라벨과 일치)
      setCollapsedTeams(new Set(groups.map(g => g.teamCode)))
      setExpandedBodies(new Set())
    } else {
      setCollapsedTeams(new Set())
      setExpandedBodies(new Set(groups.flatMap(g => g.bodies.map(b => `${g.teamCode}/${b.name}`))))
    }
    setAllExpanded(v => !v)
  }

  return (
    <div className="card p-3">
      <div className="mb-1 flex justify-end">
        <button onClick={toggleAll} className="btn h-8 px-2.5 text-xs">
          {allExpanded ? t('min.tree.collapseAll') : t('min.tree.expandAll')}
        </button>
      </div>
      <ul className="space-y-0.5">
        {groups.map(g => {
          const teamCollapsed = collapsedTeams.has(g.teamCode)
          return (
            <li key={g.teamCode}>
              <button onClick={() => toggleTeam(g.teamCode)} aria-expanded={!teamCollapsed}
                className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left hover:bg-surface-2">
                {teamCollapsed
                  ? <ChevronRight className="h-4 w-4 shrink-0 text-ink-subtle" />
                  : <ChevronDown className="h-4 w-4 shrink-0 text-ink-subtle" />}
                {/* 미지 팀 코드(방어 케이스)는 회색 점 폴백 */}
                <span className={`inline-block h-2.5 w-2.5 shrink-0 rounded-full ${TEAM[g.teamCode]?.bar ?? 'bg-ink-subtle'}`} />
                <span className="text-sm font-semibold text-ink">{g.teamCode}</span>
                <span className="text-xs tabular-nums text-ink-muted">{g.count}</span>
              </button>
              {!teamCollapsed && (
                <ul className="ml-5 space-y-0.5 border-l border-line/70 pl-2">
                  {g.bodies.map(b => {
                    const bodyKey = `${g.teamCode}/${b.name}`
                    const expanded = expandedBodies.has(bodyKey)
                    return (
                      <li key={bodyKey}>
                        <button onClick={() => toggleBody(bodyKey)} aria-expanded={expanded}
                          className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-surface-2">
                          {expanded
                            ? <ChevronDown className="h-4 w-4 shrink-0 text-ink-subtle" />
                            : <ChevronRight className="h-4 w-4 shrink-0 text-ink-subtle" />}
                          <span className="truncate text-sm font-medium text-ink">{b.name}</span>
                          <span className="text-xs tabular-nums text-ink-muted">{b.count}</span>
                          <span className="ml-auto text-xs tabular-nums text-ink-subtle">{b.latestDate}</span>
                        </button>
                        {expanded && (
                          <ul className="ml-5 divide-y divide-line/70 border-l border-line/70 pl-2">
                            {b.leaves.map(leaf => (
                              <li key={leaf.id}>
                                <Link href={`/minutes/${leaf.id}`}
                                  className="flex items-center gap-3 rounded-lg px-2 py-2 hover:bg-surface-2">
                                  <span className="w-20 shrink-0 text-xs tabular-nums text-ink-subtle">{leaf.minuteDate}</span>
                                  <span className="flex-1 truncate text-sm font-medium text-ink">{leaf.title}</span>
                                  {leaf.fileCount > 0 && (
                                    <span className="inline-flex items-center gap-1 text-xs text-ink-subtle">
                                      <Paperclip className="h-3.5 w-3.5" />{leaf.fileCount}
                                    </span>
                                  )}
                                  <span className="w-24 truncate text-right text-xs text-ink-subtle">{leaf.createdByName ?? ''}</span>
                                </Link>
                              </li>
                            ))}
                          </ul>
                        )}
                      </li>
                    )
                  })}
                </ul>
              )}
            </li>
          )
        })}
      </ul>
    </div>
  )
}
