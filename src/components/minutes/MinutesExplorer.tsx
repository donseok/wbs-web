'use client'
import { useMemo, useState } from 'react'
import Link from 'next/link'
import {
  ChevronDown, ChevronRight, Folder, FolderOpen, LayoutGrid, List, Paperclip, Star,
} from 'lucide-react'
import type { MeetingCategory, MinutesTreeGroup, TeamCode } from '@/lib/domain/types'
import { MEETING_META } from '@/lib/domain/meetings'
import { queueUiPref } from '@/lib/prefs/debouncedSave'
import { useLocale } from '@/components/providers/LocaleProvider'
import type { DictKey } from '@/lib/i18n/dict'
import { SegmentedTabs } from '@/components/ui/SegmentedTabs'
import { EmptyState } from '@/components/ui/EmptyState'
import { TEAM } from '@/components/wbs/shared'

/** 팀 폴더 틴트 — MinutesTree(폐기)에서 승계. Tailwind 정적 스캔 제약으로 리터럴 맵 유지. */
const FOLDER_TINT: Record<TeamCode, string> = {
  PMO: 'fill-team-pmo-weak',
  가공: 'fill-team-dt-weak',
  ERP: 'fill-team-erp-weak',
  MES: 'fill-team-mes-weak',
  MDM: 'fill-team-mdm-weak',
}

export type ExplorerLayout = 'grid' | 'list'
type Scope =
  | { kind: 'all' }
  | { kind: 'favorites' }
  | { kind: 'team'; team: TeamCode }
  | { kind: 'body'; team: TeamCode; body: string }

/** 카드 렌더용 리프 — 소속(팀·회의체)을 부착한 행. */
interface LeafRow {
  id: string; minuteDate: string; title: string; fileCount: number
  createdByName: string | null; bodyPreview: string; meetingCategory: MeetingCategory | null
  team: TeamCode; body: string
}

const PAGE_SIZE = 30
type T = (k: DictKey) => string

const rowCls = (active: boolean) =>
  `flex h-8 w-full min-w-0 items-center gap-2 rounded-lg px-2 text-left transition-colors duration-100 ${
    active ? 'bg-brand-weak font-semibold text-brand' : 'text-ink hover:bg-surface-2'}`

/** 탐색기 — 좌측 폴더 레일 + 우측 폴더/회의록 카드 (스펙 2026-07-23-minutes-explorer-design.md).
 *  트리 데이터·즐겨찾기 상태는 MinutesView 소유(뷰 전환 언마운트에도 생존해야 함) — 여기는
 *  선택·펼침·레이아웃·노출 개수만 관리하며 전부 비영속(v1, 레이아웃만 prefs 동기화). */
export function MinutesExplorer({
  groups, favorites, onToggleFavorite, onRetryFavorites, initialLayout = 'grid',
}: {
  groups: MinutesTreeGroup[]
  /** null = 로딩/실패 — 카운트 '–', 별 비활성, 즐겨찾기 스코프는 에러 카드+재시도 */
  favorites: Set<string> | null
  onToggleFavorite: (id: string) => void
  onRetryFavorites: () => void
  initialLayout?: ExplorerLayout
}) {
  const { t } = useLocale()
  const [scopeRaw, setScopeRaw] = useState<Scope>({ kind: 'all' })
  const [collapsedTeams, setCollapsedTeams] = useState<Set<string>>(new Set())
  const [layout, setLayout] = useState<ExplorerLayout>(initialLayout)
  const [visible, setVisible] = useState(PAGE_SIZE)
  const [mobileOpen, setMobileOpen] = useState(false)

  // 팀 탭 프루닝으로 groups 가 좁아지면 선택이 유령 노드를 가리킬 수 있다 — 조용히 all 로 강등
  const scope: Scope = useMemo(() => {
    if (scopeRaw.kind === 'team' && !groups.some(g => g.teamCode === scopeRaw.team)) return { kind: 'all' }
    if (scopeRaw.kind === 'body' &&
      !groups.some(g => g.teamCode === scopeRaw.team && g.bodies.some(b => b.name === scopeRaw.body)))
      return { kind: 'all' }
    return scopeRaw
  }, [scopeRaw, groups])

  function select(next: Scope) { setScopeRaw(next); setVisible(PAGE_SIZE) }
  function toggleTeam(tk: string) {
    setCollapsedTeams(prev => {
      const next = new Set(prev)
      if (next.has(tk)) next.delete(tk); else next.add(tk)
      return next
    })
  }
  function changeLayout(v: ExplorerLayout) { setLayout(v); queueUiPref({ minutesExplorerLayout: v }) }

  const allRows: LeafRow[] = useMemo(() =>
    groups
      .flatMap(g => g.bodies.flatMap(b => b.leaves.map(l => ({ ...l, team: g.teamCode, body: b.name }))))
      // 그룹 평탄화로 잃은 전역 날짜순 복원 — 안정 정렬이라 회의체 내부 순서(입력 순서)는 유지
      .sort((a, b) => (a.minuteDate < b.minuteDate ? 1 : a.minuteDate > b.minuteDate ? -1 : 0)),
  [groups])

  const total = groups.reduce((n, g) => n + g.count, 0)
  const favCount = favorites === null
    ? null
    : allRows.reduce((n, r) => n + (favorites.has(r.id) ? 1 : 0), 0)

  const rows: LeafRow[] = useMemo(() => {
    switch (scope.kind) {
      case 'all': return allRows
      case 'favorites': return favorites ? allRows.filter(r => favorites.has(r.id)) : []
      case 'team': return allRows.filter(r => r.team === scope.team)
      case 'body': return allRows.filter(r => r.team === scope.team && r.body === scope.body)
    }
  }, [scope, allRows, favorites])
  const shown = rows.slice(0, visible)
  const remaining = rows.length - shown.length
  const showBodyChip = scope.kind !== 'body'

  function rail(onNavigate?: () => void) {
    const go = (s: Scope) => { select(s); onNavigate?.() }
    return (
      <ul className="space-y-0.5">
        <li>
          <button onClick={() => go({ kind: 'favorites' })} className={rowCls(scope.kind === 'favorites')}>
            <Star aria-hidden className="h-4 w-4 shrink-0 fill-accent-warning text-accent-warning" />
            <span className="min-w-0 flex-1 truncate text-[13px] font-medium">{t('min.exp.favorites')}</span>
            <span className="shrink-0 text-xs tabular-nums text-ink-muted">{favCount ?? '–'}</span>
          </button>
        </li>
        <li>
          <button onClick={() => go({ kind: 'all' })} className={rowCls(scope.kind === 'all')}>
            <FolderOpen aria-hidden className="h-4 w-4 shrink-0 text-ink-subtle" />
            <span className="min-w-0 flex-1 truncate text-[13px] font-medium">{t('min.exp.all')}</span>
            <span className="shrink-0 text-xs tabular-nums text-ink-muted">{total}</span>
          </button>
          <ul className="ml-2 mt-0.5 border-l border-line pl-1.5">
            {groups.map(g => {
              const collapsed = collapsedTeams.has(g.teamCode)
              const TeamIcon = collapsed ? Folder : FolderOpen
              return (
                <li key={g.teamCode}>
                  <div className="flex items-center gap-0.5">
                    <button onClick={() => toggleTeam(g.teamCode)} aria-expanded={!collapsed} aria-label={g.teamCode}
                      className="shrink-0 rounded-md p-1 text-ink-subtle transition-colors duration-100 hover:bg-surface-2">
                      <ChevronRight aria-hidden
                        className={`h-3.5 w-3.5 transition-transform duration-150 ${collapsed ? '' : 'rotate-90'}`} />
                    </button>
                    <button onClick={() => go({ kind: 'team', team: g.teamCode })}
                      className={rowCls(scope.kind === 'team' && scope.team === g.teamCode)}>
                      {/* 미지 팀 코드(방어 케이스)는 중립 폴백 */}
                      <TeamIcon aria-hidden
                        className={`h-4 w-4 shrink-0 ${TEAM[g.teamCode]?.fg ?? 'text-ink-subtle'} ${FOLDER_TINT[g.teamCode] ?? ''}`} />
                      <span className="min-w-0 flex-1 truncate text-[13px] font-semibold">{g.teamCode}</span>
                      <span className="shrink-0 text-xs tabular-nums text-ink-muted">{g.count}</span>
                    </button>
                  </div>
                  {!collapsed && (
                    <ul className="ml-5 border-l border-line pl-1.5">
                      {g.bodies.map(b => (
                        <li key={b.name}>
                          <button onClick={() => go({ kind: 'body', team: g.teamCode, body: b.name })}
                            className={rowCls(scope.kind === 'body' && scope.team === g.teamCode && scope.body === b.name)}>
                            <Folder aria-hidden className="h-4 w-4 shrink-0 text-ink-subtle" />
                            <span className="min-w-0 flex-1 truncate text-[13px]">{b.name}</span>
                            <span className="shrink-0 text-xs tabular-nums text-ink-muted">{b.count}</span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              )
            })}
          </ul>
        </li>
      </ul>
    )
  }

  const folderCards = scope.kind === 'all' ? (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {groups.map(g => (
        <button key={g.teamCode} onClick={() => select({ kind: 'team', team: g.teamCode })}
          className="card flex flex-col gap-3 p-4 text-left transition-shadow duration-150 hover:shadow-[var(--shadow-md)]">
          <span className="flex min-w-0 items-center gap-2">
            <Folder aria-hidden className={`h-5 w-5 shrink-0 ${TEAM[g.teamCode]?.fg ?? 'text-ink-subtle'} ${FOLDER_TINT[g.teamCode] ?? ''}`} />
            <span className="truncate text-sm font-semibold text-ink">{g.teamCode}</span>
          </span>
          <span className="text-xs text-ink-muted">
            {t('min.exp.meetingCount').replace('{n}', String(g.count))}
            {' · '}
            {t('min.exp.subfolderCount').replace('{n}', String(g.bodies.length))}
          </span>
        </button>
      ))}
    </div>
  ) : scope.kind === 'team' ? (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {(groups.find(g => g.teamCode === scope.team)?.bodies ?? []).map(b => (
        <button key={b.name} onClick={() => select({ kind: 'body', team: scope.team, body: b.name })}
          className="card flex flex-col gap-3 p-4 text-left transition-shadow duration-150 hover:shadow-[var(--shadow-md)]">
          <span className="flex min-w-0 items-center gap-2">
            <Folder aria-hidden className="h-5 w-5 shrink-0 text-ink-subtle" />
            <span className="truncate text-sm font-semibold text-ink">{b.name}</span>
          </span>
          <span className="text-xs text-ink-muted">
            {t('min.exp.meetingCount').replace('{n}', String(b.count))}
            {' · '}
            {t('min.exp.latest').replace('{d}', b.latestDate)}
          </span>
        </button>
      ))}
    </div>
  ) : null

  return (
    <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
      {/* lg+: 상주 폴더 레일 */}
      <nav className="card hidden w-[240px] shrink-0 p-2 lg:block">{rail()}</nav>
      {/* lg 미만: 접이식 폴더 바 (MinuteToc 관례) */}
      <div className="card shrink-0 p-3 lg:hidden">
        <button onClick={() => setMobileOpen(o => !o)}
          className="flex w-full items-center gap-2 text-sm font-semibold text-ink">
          <Folder aria-hidden className="h-4 w-4 text-brand" />{t('min.exp.folders')}
          {mobileOpen
            ? <ChevronDown aria-hidden className="ml-auto h-4 w-4" />
            : <ChevronRight aria-hidden className="ml-auto h-4 w-4" />}
        </button>
        {mobileOpen && <div className="mt-2">{rail(() => setMobileOpen(false))}</div>}
      </div>

      {/* 우측 콘텐츠 */}
      <section className="min-w-0 flex-1 space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex min-w-0 items-center gap-1.5 text-sm">
            {scope.kind === 'favorites' ? (
              <span className="font-semibold text-ink">{t('min.exp.favorites')}</span>
            ) : (
              <>
                <button onClick={() => select({ kind: 'all' })}
                  className={scope.kind === 'all' ? 'font-semibold text-ink' : 'text-ink-muted transition-colors hover:text-ink'}>
                  {t('min.exp.all')}
                </button>
                {(scope.kind === 'team' || scope.kind === 'body') && (
                  <>
                    <ChevronRight aria-hidden className="h-3.5 w-3.5 shrink-0 text-ink-subtle" />
                    <button onClick={() => select({ kind: 'team', team: scope.team })}
                      className={scope.kind === 'team' ? 'font-semibold text-ink' : 'text-ink-muted transition-colors hover:text-ink'}>
                      {scope.team}
                    </button>
                  </>
                )}
                {scope.kind === 'body' && (
                  <>
                    <ChevronRight aria-hidden className="h-3.5 w-3.5 shrink-0 text-ink-subtle" />
                    <span className="truncate font-semibold text-ink">{scope.body}</span>
                  </>
                )}
              </>
            )}
          </div>
          <div className="ml-auto">
            <SegmentedTabs<ExplorerLayout>
              tabs={[{ key: 'grid', label: t('min.exp.layout.grid'), icon: LayoutGrid },
                     { key: 'list', label: t('min.exp.layout.list'), icon: List }]}
              value={layout} onChange={changeLayout} size="sm" />
          </div>
        </div>

        {scope.kind === 'favorites' && favorites === null ? (
          <EmptyState title={t('min.exp.favError')}
            action={<button onClick={onRetryFavorites} className="btn">{t('min.tree.retry')}</button>} />
        ) : (
          <>
            {folderCards}
            {rows.length === 0 ? (
              scope.kind === 'favorites' && <EmptyState icon={Star} title={t('min.exp.favEmpty')} />
            ) : layout === 'grid' ? (
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                {shown.map(r => (
                  <MinuteCard key={r.id} r={r} t={t} showBodyChip={showBodyChip}
                    fav={favorites?.has(r.id) ?? false} disabled={favorites === null}
                    onToggle={onToggleFavorite} />
                ))}
              </div>
            ) : (
              <div className="card p-2">
                <ul className="divide-y divide-line/70">
                  {shown.map(r => (
                    <MinuteRow key={r.id} r={r} t={t} showBodyChip={showBodyChip}
                      fav={favorites?.has(r.id) ?? false} disabled={favorites === null}
                      onToggle={onToggleFavorite} />
                  ))}
                </ul>
              </div>
            )}
            {remaining > 0 && (
              <div className="flex justify-center">
                <button onClick={() => setVisible(v => v + PAGE_SIZE)} className="btn">
                  {t('min.exp.more').replace('{n}', String(remaining))}
                </button>
              </div>
            )}
          </>
        )}
      </section>
    </div>
  )
}

function StarButton({ id, fav, disabled, onToggle, t }: {
  id: string; fav: boolean; disabled: boolean; onToggle: (id: string) => void; t: T
}) {
  return (
    <button onClick={() => onToggle(id)} disabled={disabled} aria-pressed={fav}
      aria-label={t(fav ? 'min.exp.starRemove' : 'min.exp.starAdd')}
      className="relative z-10 shrink-0 rounded-md p-1 text-ink-subtle transition-colors duration-100 hover:bg-surface-2 hover:text-ink disabled:opacity-40">
      <Star aria-hidden className={`h-4 w-4 ${fav ? 'fill-accent-warning text-accent-warning' : ''}`} />
    </button>
  )
}

function CategoryChip({ cat, t }: { cat: MeetingCategory; t: T }) {
  const meta = MEETING_META[cat]
  return <span className={`chip ${meta.chip}`}>{t(meta.labelKey)}</span>
}

function MinuteCard({ r, fav, disabled, onToggle, showBodyChip, t }: {
  r: LeafRow; fav: boolean; disabled: boolean; onToggle: (id: string) => void
  showBodyChip: boolean; t: T
}) {
  return (
    <article className="card relative flex flex-col gap-2 p-4 transition-shadow duration-150 hover:shadow-[var(--shadow-md)]">
      {/* 스트레치드 링크 — 카드 전면 클릭, 별 버튼만 z-10 으로 위에 */}
      <Link href={`/minutes/${r.id}`} aria-label={r.title} className="absolute inset-0 rounded-2xl" />
      <div className="flex items-start gap-1.5">
        <StarButton id={r.id} fav={fav} disabled={disabled} onToggle={onToggle} t={t} />
        <h4 className="min-w-0 flex-1 truncate pt-0.5 text-sm font-semibold text-ink">{r.title}</h4>
        <span className={`inline-flex shrink-0 justify-center rounded-md px-1.5 py-0.5 text-[11px] font-bold text-white ${TEAM[r.team]?.bar ?? 'bg-ink-subtle'}`}>
          {r.team}
        </span>
      </div>
      {(r.meetingCategory || showBodyChip) && (
        <div className="flex flex-wrap items-center gap-1.5">
          {r.meetingCategory && <CategoryChip cat={r.meetingCategory} t={t} />}
          {showBodyChip && (
            <span className="chip bg-surface-2 text-ink-muted">
              <Folder aria-hidden className="h-3 w-3" />{r.body}
            </span>
          )}
        </div>
      )}
      {r.bodyPreview && <p className="line-clamp-3 text-[13px] leading-5 text-ink-muted">{r.bodyPreview}</p>}
      <div className="mt-auto flex items-center gap-2 pt-1 text-xs text-ink-subtle">
        <span className="tabular-nums">{r.minuteDate}</span>
        {r.createdByName && <><span aria-hidden>·</span><span className="truncate">{r.createdByName}</span></>}
        {r.fileCount > 0 && (
          <span className="ml-auto inline-flex items-center gap-1">
            <Paperclip aria-hidden className="h-3 w-3" />{r.fileCount}
          </span>
        )}
      </div>
    </article>
  )
}

function MinuteRow({ r, fav, disabled, onToggle, showBodyChip, t }: {
  r: LeafRow; fav: boolean; disabled: boolean; onToggle: (id: string) => void
  showBodyChip: boolean; t: T
}) {
  return (
    <li className="relative">
      <Link href={`/minutes/${r.id}`} aria-label={r.title} className="absolute inset-0 rounded-lg" />
      <div className="flex items-center gap-3 rounded-lg px-2 py-2.5 transition-colors duration-100 hover:bg-surface-2">
        <StarButton id={r.id} fav={fav} disabled={disabled} onToggle={onToggle} t={t} />
        <span className={`inline-flex w-12 shrink-0 justify-center rounded-md px-1.5 py-0.5 text-[11px] font-bold text-white ${TEAM[r.team]?.bar ?? 'bg-ink-subtle'}`}>
          {r.team}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium text-ink">{r.title}</span>
          {r.bodyPreview && <span className="block truncate text-xs text-ink-subtle">{r.bodyPreview}</span>}
        </span>
        {r.meetingCategory && <span className="hidden shrink-0 sm:inline-flex"><CategoryChip cat={r.meetingCategory} t={t} /></span>}
        {showBodyChip && (
          <span className="chip hidden shrink-0 bg-surface-2 text-ink-muted md:inline-flex">
            <Folder aria-hidden className="h-3 w-3" />{r.body}
          </span>
        )}
        <span className="w-20 shrink-0 text-right text-xs tabular-nums text-ink-subtle">{r.minuteDate}</span>
      </div>
    </li>
  )
}
