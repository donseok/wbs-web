'use client'
import { useState } from 'react'
import Link from 'next/link'
import { ChevronRight, FileText, Folder, FolderOpen, Paperclip } from 'lucide-react'
import type { MinutesTreeGroup, TeamCode } from '@/lib/domain/types'
import { useLocale } from '@/components/providers/LocaleProvider'
import { TEAM } from '@/components/wbs/shared'

/** 레벨1 폴더 틴트 — TEAM[code].fg(외곽선)와 짝을 이루는 team-*-weak 토큰 fill.
 *  Tailwind 정적 스캔 제약으로 리터럴 맵 유지(동적 클래스 조합 금지). 라이트/다크는 토큰이 처리. */
const FOLDER_TINT: Record<TeamCode, string> = {
  PMO: 'fill-team-pmo-weak',
  가공: 'fill-team-dt-weak',
  ERP: 'fill-team-erp-weak',
  MES: 'fill-team-mes-weak',
  MDM: 'fill-team-mdm-weak',
}

/** 구분→회의체→회의록 트리 — 탐색기 폴더 메타포 (스펙 2026-07-17-minutes-tree-view-design.md).
 *  레벨1은 접힘 Set(기본 펼침), 레벨2는 펼침 Set(기본 접힘) — 시드 없이 기본 상태가 성립.
 *  재조회로 groups가 바뀌어도 두 Set은 유지(사라진 키는 무해). 접힘 상태는 비영속(v1).
 *  스캔성: 우측 메타는 고정폭 레일(건수 w-10 · 날짜 w-20)로 전 레벨 세로 정렬 — 팀 행의 날짜 자리,
 *  리프의 첨부 없음 자리에 빈 스페이서를 두어 레일이 흐트러지지 않게 한다. */
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
    <div className="card p-2">
      <div className="mb-1 flex justify-end">
        <button onClick={toggleAll} className="btn btn-ghost h-7 rounded-lg px-2.5 text-xs">
          {allExpanded ? t('min.tree.collapseAll') : t('min.tree.expandAll')}
        </button>
      </div>
      <ul>
        {groups.map(g => {
          const teamCollapsed = collapsedTeams.has(g.teamCode)
          const TeamFolder = teamCollapsed ? Folder : FolderOpen
          // 미지 팀 코드(방어 케이스)는 중립 폴백
          const folderCls = `h-4 w-4 shrink-0 ${TEAM[g.teamCode]?.fg ?? 'text-ink-subtle'} ${FOLDER_TINT[g.teamCode] ?? ''}`
          return (
            <li key={g.teamCode}>
              <button onClick={() => toggleTeam(g.teamCode)} aria-expanded={!teamCollapsed}
                className="flex h-8 w-full items-center gap-2 rounded-md px-2 text-left transition-colors duration-100 hover:bg-surface-2">
                <ChevronRight aria-hidden className={`h-3.5 w-3.5 shrink-0 text-ink-subtle transition-transform duration-150 ${!teamCollapsed ? 'rotate-90' : ''}`} />
                <TeamFolder aria-hidden className={folderCls} />
                <span className="min-w-0 flex-1 truncate text-[13px] font-semibold text-ink">{g.teamCode}</span>
                <span className="w-10 shrink-0 text-right text-xs tabular-nums text-ink-muted">{g.count}</span>
                {/* 날짜 레일 자리 맞춤(레벨2·리프와 세로 정렬) */}
                <span aria-hidden className="w-20 shrink-0" />
              </button>
              {!teamCollapsed && (
                <ul className="ml-4 border-l border-line pl-1.5">
                  {g.bodies.map(b => {
                    const bodyKey = `${g.teamCode}/${b.name}`
                    const expanded = expandedBodies.has(bodyKey)
                    const BodyFolder = expanded ? FolderOpen : Folder
                    return (
                      <li key={bodyKey}>
                        <button onClick={() => toggleBody(bodyKey)} aria-expanded={expanded}
                          className={`flex h-7 w-full items-center gap-2 rounded-md px-2 text-left transition-colors duration-100 ${expanded ? 'bg-surface-2/60' : ''} hover:bg-surface-2`}>
                          <ChevronRight aria-hidden className={`h-3.5 w-3.5 shrink-0 text-ink-subtle transition-transform duration-150 ${expanded ? 'rotate-90' : ''}`} />
                          <BodyFolder aria-hidden className="h-4 w-4 shrink-0 text-ink-subtle" />
                          <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-ink">{b.name}</span>
                          <span className="w-10 shrink-0 text-right text-xs tabular-nums text-ink-muted">{b.count}</span>
                          <span className="w-20 shrink-0 text-right text-xs tabular-nums text-ink-subtle">{b.latestDate}</span>
                        </button>
                        {expanded && (
                          <ul className="ml-4 border-l border-line pl-1.5">
                            {b.leaves.map(leaf => (
                              <li key={leaf.id}>
                                <Link href={`/minutes/${leaf.id}`}
                                  className="flex h-7 items-center gap-2 rounded-md px-2 transition-colors duration-100 hover:bg-surface-2">
                                  <FileText aria-hidden className="h-3.5 w-3.5 shrink-0 text-ink-subtle" />
                                  <span className="min-w-0 flex-1 truncate text-[13px] text-ink">{leaf.title}</span>
                                  <span className="w-24 shrink-0 truncate text-right text-xs text-ink-subtle">{leaf.createdByName ?? ''}</span>
                                  {/* 건수 레일 — 첨부 없으면 빈 자리 유지(레일 정렬) */}
                                  <span className="inline-flex w-10 shrink-0 items-center justify-end gap-0.5 text-xs tabular-nums text-ink-subtle">
                                    {leaf.fileCount > 0 && (<><Paperclip aria-hidden className="h-3 w-3" />{leaf.fileCount}</>)}
                                  </span>
                                  <span className="w-20 shrink-0 text-right text-xs tabular-nums text-ink-subtle">{leaf.minuteDate}</span>
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
