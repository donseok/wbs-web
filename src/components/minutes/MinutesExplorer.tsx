'use client'
import { useMemo, useState } from 'react'
import Link from 'next/link'
import {
  ChevronDown, ChevronRight, Folder, FolderOpen, FolderPlus, LayoutGrid, List,
  MoreHorizontal, Paperclip, Star,
} from 'lucide-react'
import type {
  ExplorerLeaf, FolderNode, MeetingCategory, MinuteFolder,
} from '@/lib/domain/types'
import { buildFolderTree, folderDepthOf, isTeamRootFolder, MINUTE_FOLDER_DEPTH_MAX } from '@/lib/domain/minutes'
import { MEETING_META } from '@/lib/domain/meetings'
import { moveMinuteToFolder } from '@/app/actions/minutes'
import { useLocale } from '@/components/providers/LocaleProvider'
import type { DictKey } from '@/lib/i18n/dict'
import { SegmentedTabs } from '@/components/ui/SegmentedTabs'
import { EmptyState } from '@/components/ui/EmptyState'
import { useToast } from '@/components/ui/Toast'
import { teamStyle } from '@/components/wbs/shared'
import { FolderManageModal } from './FolderManageModal'
import { FolderPickModal } from './FolderPickModal'

export type ExplorerLayout = 'grid' | 'list'
type Scope =
  | { kind: 'all' }
  | { kind: 'favorites' }
  | { kind: 'unfiled' }
  | { kind: 'folder'; id: string }
type ManageState =
  | { mode: 'create'; parentId: string | null }
  | { mode: 'rename'; folder: MinuteFolder }
  | { mode: 'delete'; folder: MinuteFolder }
  | null

const PAGE_SIZE = 30
type T = (k: DictKey) => string

const rowCls = (active: boolean) =>
  `flex h-8 w-full min-w-0 items-center gap-2 rounded-lg px-2 text-left transition-colors duration-100 ${
    active ? 'bg-brand-weak font-semibold text-brand' : 'text-ink hover:bg-surface-2'}`

/** 탐색기 v2 — 실제 폴더 디렉토리(스펙 2026-07-23-minutes-folders-design.md).
 *  데이터·즐겨찾기·레이아웃 상태는 MinutesView 소유. 여기는 선택·펼침·노출 개수·모달만 관리(비영속).
 *  leaves 는 팀 탭 필터가 이미 적용된 것 — 카운트·스코프가 필터와 정합. folders 는 항상 전부. */
export function MinutesExplorer({
  folders, leaves, favorites, onToggleFavorite, onRetryFavorites,
  layout, onLayoutChange, currentUserId, isAdmin, onChanged, onFolderSelect,
}: {
  folders: MinuteFolder[]
  leaves: ExplorerLeaf[]
  favorites: Set<string> | null
  onToggleFavorite: (id: string) => void
  onRetryFavorites: () => void
  layout: ExplorerLayout
  onLayoutChange: (v: ExplorerLayout) => void
  currentUserId: string | null
  isAdmin: boolean
  onChanged: () => void
  onFolderSelect?: (folderId: string | null) => void
}) {
  const { t } = useLocale()
  const { toast } = useToast()
  const [scopeRaw, setScopeRaw] = useState<Scope>({ kind: 'all' })
  // 기본 전체 펼침(부모 id 집합) — 시드 트리가 얕아(깊이 상한 5) 접힌 채 시작하면 하위 폴더 메뉴·이동이
  // 첫 렌더에 발견 불가능해진다. 최초 렌더 1회만 계산(폴더 추가/삭제는 토글로 사용자가 직접 관리).
  const [expanded, setExpanded] = useState<Set<string>>(
    () => new Set(folders.map(f => f.parentId).filter((id): id is string => id !== null)),
  )
  const [visible, setVisible] = useState(PAGE_SIZE)
  const [mobileOpen, setMobileOpen] = useState(false)
  const [manage, setManage] = useState<ManageState>(null)
  const [menuFor, setMenuFor] = useState<string | null>(null)
  const [movingId, setMovingId] = useState<string | null>(null)   // 폴더 픽커 대상 회의록

  const { roots, unfiled } = useMemo(() => buildFolderTree(folders, leaves), [folders, leaves])
  const nodeById = useMemo(() => {
    const map = new Map<string, FolderNode>()
    const walk = (nodes: FolderNode[]) => { for (const n of nodes) { map.set(n.folder.id, n); walk(n.children) } }
    walk(roots)
    return map
  }, [roots])
  const folderById = useMemo(() => new Map(folders.map(f => [f.id, f])), [folders])

  // 재조회로 폴더가 사라지면 선택이 유령을 가리킬 수 있다 — 조용히 all 로 강등
  const scope: Scope = useMemo(() => (
    scopeRaw.kind === 'folder' && !nodeById.has(scopeRaw.id) ? { kind: 'all' } : scopeRaw
  ), [scopeRaw, nodeById])

  function select(next: Scope) {
    setScopeRaw(next); setVisible(PAGE_SIZE); setMenuFor(null)
    onFolderSelect?.(next.kind === 'folder' ? next.id : null)
  }
  function toggleExpand(id: string) {
    setExpanded(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }
  const canManageFolder = (f: MinuteFolder) => isAdmin || (f.createdBy !== null && f.createdBy === currentUserId)
  const canMoveLeaf = (l: ExplorerLeaf) => isAdmin || (l.createdBy !== null && l.createdBy === currentUserId)

  const total = leaves.length
  const favCount = favorites === null
    ? null
    : leaves.reduce((n, l) => n + (favorites.has(l.id) ? 1 : 0), 0)

  const rows: ExplorerLeaf[] = useMemo(() => {
    switch (scope.kind) {
      case 'all': return leaves
      case 'favorites': return favorites ? leaves.filter(l => favorites.has(l.id)) : []
      case 'unfiled': return unfiled
      case 'folder': return nodeById.get(scope.id)?.directLeaves ?? []
    }
  }, [scope, leaves, favorites, unfiled, nodeById])
  const shown = rows.slice(0, visible)
  const remaining = rows.length - shown.length
  const showFolderChip = scope.kind === 'all' || scope.kind === 'favorites'

  async function moveTo(folderId: string | null) {
    const id = movingId
    setMovingId(null)
    if (!id) return
    const res = await moveMinuteToFolder(id, folderId)
    if (!res.ok) { toast({ title: res.error ?? t('min.fold.error'), variant: 'error' }); return }
    toast({ title: t('min.fold.moved'), variant: 'info' })
    onChanged()
  }

  function folderRow(node: FolderNode, depth: number): React.ReactNode {
    const f = node.folder
    const hasChildren = node.children.length > 0
    const isExpanded = expanded.has(f.id)
    const active = scope.kind === 'folder' && scope.id === f.id
    const FolderIcon = active || isExpanded ? FolderOpen : Folder
    return (
      <li key={f.id}>
        <div className="group flex items-center gap-0.5" style={{ paddingLeft: `${depth * 12}px` }}>
          {hasChildren ? (
            <button onClick={() => toggleExpand(f.id)} aria-expanded={isExpanded} aria-label={f.name}
              className="shrink-0 rounded-md p-1 text-ink-subtle transition-colors duration-100 hover:bg-surface-2">
              <ChevronRight aria-hidden
                className={`h-3.5 w-3.5 transition-transform duration-150 ${isExpanded ? 'rotate-90' : ''}`} />
            </button>
          ) : <span aria-hidden className="w-[22px] shrink-0" />}
          <button onClick={() => select({ kind: 'folder', id: f.id })} className={rowCls(active)}>
            <FolderIcon aria-hidden className="h-4 w-4 shrink-0 text-ink-subtle" />
            <span className="min-w-0 flex-1 truncate text-[13px]">{f.name}</span>
            <span className="shrink-0 text-xs tabular-nums text-ink-muted">{node.totalCount}</span>
          </button>
          {canManageFolder(f) && (
            <div className="relative shrink-0">
              <button onClick={() => setMenuFor(cur => (cur === f.id ? null : f.id))}
                aria-label={t('min.fold.menuAria')} aria-expanded={menuFor === f.id}
                className="rounded-md p-1 text-ink-subtle opacity-0 transition-opacity duration-100 hover:bg-surface-2 focus-visible:opacity-100 group-hover:opacity-100">
                <MoreHorizontal aria-hidden className="h-3.5 w-3.5" />
              </button>
              {menuFor === f.id && (
                <>
                  <button aria-hidden tabIndex={-1} onClick={() => setMenuFor(null)}
                    className="fixed inset-0 z-10 cursor-default" />
                  <div className="absolute right-0 z-20 mt-1 w-36 rounded-xl border border-line bg-surface p-1 shadow-[var(--shadow-md)]">
                    {/* 팀 루트 시드(편철 앵커)만 개명·삭제 불가 — 하위 폴더는 개명·삭제가
                        업로드·수정 모달의 하위 구분 옵션에 그대로 반영된다(서버 가드와 동일 기준) */}
                    {!isTeamRootFolder(f) && (
                      <button onClick={() => { setMenuFor(null); setManage({ mode: 'rename', folder: f }) }}
                        className="block w-full rounded-lg px-2 py-1.5 text-left text-[13px] text-ink hover:bg-surface-2">
                        {t('min.fold.rename')}
                      </button>
                    )}
                    {folderDepthOf(folders, f.id) < MINUTE_FOLDER_DEPTH_MAX && (
                      <button onClick={() => { setMenuFor(null); setManage({ mode: 'create', parentId: f.id }) }}
                        className="block w-full rounded-lg px-2 py-1.5 text-left text-[13px] text-ink hover:bg-surface-2">
                        {t('min.fold.addSub')}
                      </button>
                    )}
                    {!isTeamRootFolder(f) && (
                      <button onClick={() => { setMenuFor(null); setManage({ mode: 'delete', folder: f }) }}
                        className="block w-full rounded-lg px-2 py-1.5 text-left text-[13px] text-delayed hover:bg-surface-2">
                        {t('min.fold.delete')}
                      </button>
                    )}
                  </div>
                </>
              )}
            </div>
          )}
        </div>
        {hasChildren && isExpanded && <ul>{node.children.map(c => folderRow(c, depth + 1))}</ul>}
      </li>
    )
  }

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
          <div className="flex items-center gap-0.5">
            <button onClick={() => go({ kind: 'all' })} className={rowCls(scope.kind === 'all')}>
              <FolderOpen aria-hidden className="h-4 w-4 shrink-0 text-ink-subtle" />
              <span className="min-w-0 flex-1 truncate text-[13px] font-medium">{t('min.exp.all')}</span>
              <span className="shrink-0 text-xs tabular-nums text-ink-muted">{total}</span>
            </button>
            <button onClick={() => setManage({ mode: 'create', parentId: null })}
              aria-label={t('min.fold.new')} title={t('min.fold.new')}
              className="shrink-0 rounded-md p-1 text-ink-subtle transition-colors duration-100 hover:bg-surface-2 hover:text-ink">
              <FolderPlus aria-hidden className="h-4 w-4" />
              <span className="sr-only">{t('min.fold.new')}</span>
            </button>
          </div>
          <ul className="ml-2 mt-0.5 border-l border-line pl-1.5">
            {roots.map(r => folderRow(r, 0))}
            {/* 미분류는 예외 버킷(폴더 삭제 강등분) — 0건이면 숨김. 자동 편철(0043) 후 평시엔 비어 있다.
                단, 현재 스코프가 미분류면 마지막 1건 이동 직후에도 행을 유지해 발 디딜 곳을 남긴다. */}
            {(unfiled.length > 0 || scope.kind === 'unfiled') && (
              <li>
                <div className="flex items-center gap-0.5">
                  <span aria-hidden className="w-[22px] shrink-0" />
                  <button onClick={() => go({ kind: 'unfiled' })} className={rowCls(scope.kind === 'unfiled')}>
                    <FolderOpen aria-hidden className="h-4 w-4 shrink-0 text-ink-subtle" />
                    <span className="min-w-0 flex-1 truncate text-[13px] text-ink-muted">{t('min.fold.unfiled')}</span>
                    <span className="shrink-0 text-xs tabular-nums text-ink-muted">{unfiled.length}</span>
                  </button>
                </div>
              </li>
            )}
          </ul>
        </li>
      </ul>
    )
  }

  // 경로 표시 — 폴더 스코프의 조상 체인(클릭 이동)
  const crumbs: MinuteFolder[] = useMemo(() => {
    if (scope.kind !== 'folder') return []
    const chain: MinuteFolder[] = []
    let cur: string | null = scope.id
    const seen = new Set<string>()
    while (cur && !seen.has(cur)) {
      seen.add(cur)
      const f = folderById.get(cur)
      if (!f) break
      chain.unshift(f)
      cur = f.parentId
    }
    return chain
  }, [scope, folderById])

  // 폴더 카드 그리드는 전면 제거(사용자 결정 2026-07-24) — 전체 스코프 루트 카드에 이어
  // 폴더 스코프의 하위 폴더 카드도 삭제. 폴더 탐색은 왼쪽 레일 트리로 일원화. 재도입 금지.

  return (
    <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
      <nav className="card hidden w-[250px] shrink-0 p-2 lg:block">{rail()}</nav>
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

      <section className="min-w-0 flex-1">
        <div data-minutes-content-header className="flex flex-wrap items-center gap-2">
          <div className="flex min-w-0 items-center gap-1.5 text-sm">
            {scope.kind === 'favorites' ? (
              <span className="font-semibold text-ink">{t('min.exp.favorites')}</span>
            ) : scope.kind === 'unfiled' ? (
              <>
                <button onClick={() => select({ kind: 'all' })} className="text-ink-muted transition-colors hover:text-ink">
                  {t('min.exp.all')}
                </button>
                <ChevronRight aria-hidden className="h-3.5 w-3.5 shrink-0 text-ink-subtle" />
                <span className="font-semibold text-ink">{t('min.fold.unfiled')}</span>
              </>
            ) : (
              <>
                <button onClick={() => select({ kind: 'all' })}
                  className={scope.kind === 'all' ? 'font-semibold text-ink' : 'text-ink-muted transition-colors hover:text-ink'}>
                  {t('min.exp.all')}
                </button>
                {crumbs.map((f, i) => (
                  <span key={f.id} className="flex min-w-0 items-center gap-1.5">
                    <ChevronRight aria-hidden className="h-3.5 w-3.5 shrink-0 text-ink-subtle" />
                    {i === crumbs.length - 1
                      ? <span className="truncate font-semibold text-ink">{f.name}</span>
                      : (
                        <button onClick={() => select({ kind: 'folder', id: f.id })}
                          className="truncate text-ink-muted transition-colors hover:text-ink">{f.name}</button>
                      )}
                  </span>
                ))}
              </>
            )}
          </div>
          <div className="ml-auto">
            <SegmentedTabs<ExplorerLayout>
              tabs={[{ key: 'grid', label: t('min.exp.layout.grid'), icon: LayoutGrid },
                     { key: 'list', label: t('min.exp.layout.list'), icon: List }]}
              value={layout} onChange={onLayoutChange} size="sm" />
          </div>
        </div>

        <div data-minutes-content-body className="mt-4 space-y-4 lg:mt-0.5">
          {scope.kind === 'favorites' && favorites === null ? (
            <EmptyState title={t('min.exp.favError')}
              action={<button onClick={onRetryFavorites} className="btn">{t('min.tree.retry')}</button>} />
          ) : (
            <>
              {rows.length === 0 ? (
                scope.kind === 'favorites'
                  ? <EmptyState icon={Star} title={t('min.exp.favEmpty')} />
                  : <EmptyState title={t('min.empty.title')} description={t('min.empty.desc')} />
              ) : layout === 'grid' ? (
                <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                  {shown.map(l => (
                    <MinuteCard key={l.id} l={l} t={t} folderName={folderNameOf(l, folderById, showFolderChip)}
                      fav={favorites?.has(l.id) ?? false} favDisabled={favorites === null}
                      canMove={canMoveLeaf(l)} onMove={() => setMovingId(l.id)}
                      onToggle={onToggleFavorite} />
                  ))}
                </div>
              ) : (
                <div className="card p-2">
                  <ul className="divide-y divide-line/70">
                    {shown.map(l => (
                      <MinuteRow key={l.id} l={l} t={t} folderName={folderNameOf(l, folderById, showFolderChip)}
                        fav={favorites?.has(l.id) ?? false} favDisabled={favorites === null}
                        canMove={canMoveLeaf(l)} onMove={() => setMovingId(l.id)}
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
        </div>
      </section>

      {manage && (
        <FolderManageModal open mode={manage.mode}
          folder={manage.mode !== 'create' ? manage.folder : undefined}
          parentId={manage.mode === 'create' ? manage.parentId : null}
          onClose={() => setManage(null)}
          onDone={() => { setManage(null); onChanged() }} />
      )}
      <FolderPickModal open={movingId !== null} folders={folders}
        onClose={() => setMovingId(null)} onPick={id => void moveTo(id)} />
    </div>
  )
}

/** 폴더 칩 라벨 — all·favorites 스코프에서 소속이 있을 때만. */
function folderNameOf(
  l: ExplorerLeaf, folderById: Map<string, MinuteFolder>, show: boolean,
): string | null {
  if (!show || !l.folderId) return null
  return folderById.get(l.folderId)?.name ?? null
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

function MoveButton({ onMove, t }: { onMove: () => void; t: T }) {
  return (
    <button onClick={onMove} aria-label={t('min.fold.move')} title={t('min.fold.move')}
      className="relative z-10 shrink-0 rounded-md p-1 text-ink-subtle transition-colors duration-100 hover:bg-surface-2 hover:text-ink">
      <FolderOpen aria-hidden className="h-4 w-4" />
    </button>
  )
}

function CategoryChip({ cat, t }: { cat: MeetingCategory; t: T }) {
  const meta = MEETING_META[cat]
  return <span className={`chip ${meta.chip}`}>{t(meta.labelKey)}</span>
}

function MinuteCard({ l, fav, favDisabled, canMove, onMove, onToggle, folderName, t }: {
  l: ExplorerLeaf; fav: boolean; favDisabled: boolean
  canMove: boolean; onMove: () => void
  onToggle: (id: string) => void; folderName: string | null; t: T
}) {
  return (
    <article className="card relative flex flex-col gap-2 p-4 transition-shadow duration-150 hover:shadow-[var(--shadow-md)]">
      <Link href={`/minutes/${l.id}`} aria-label={l.title} className="absolute inset-0 rounded-2xl" />
      <div className="flex items-start gap-1.5">
        <StarButton id={l.id} fav={fav} disabled={favDisabled} onToggle={onToggle} t={t} />
        <h4 className="min-w-0 flex-1 truncate pt-0.5 text-sm font-semibold text-ink">{l.title}</h4>
        {canMove && <MoveButton onMove={onMove} t={t} />}
        <span className={`inline-flex shrink-0 justify-center rounded-md px-1.5 py-0.5 text-[11px] font-bold text-white ${teamStyle(l.teamCode).bar}`}>
          {l.teamCode}
        </span>
      </div>
      {(l.meetingCategory || folderName) && (
        <div className="flex flex-wrap items-center gap-1.5">
          {l.meetingCategory && <CategoryChip cat={l.meetingCategory} t={t} />}
          {folderName && (
            <span className="chip bg-surface-2 text-ink-muted">
              <Folder aria-hidden className="h-3 w-3" />{folderName}
            </span>
          )}
        </div>
      )}
      {l.bodyPreview && <p className="line-clamp-3 text-[13px] leading-5 text-ink-muted">{l.bodyPreview}</p>}
      <div className="mt-auto flex items-center gap-2 pt-1 text-xs text-ink-subtle">
        <span className="tabular-nums">{l.minuteDate}</span>
        {l.createdByName && <><span aria-hidden>·</span><span className="truncate">{l.createdByName}</span></>}
        {l.fileCount > 0 && (
          <span className="ml-auto inline-flex items-center gap-1">
            <Paperclip aria-hidden className="h-3 w-3" />{l.fileCount}
          </span>
        )}
      </div>
    </article>
  )
}

function MinuteRow({ l, fav, favDisabled, canMove, onMove, onToggle, folderName, t }: {
  l: ExplorerLeaf; fav: boolean; favDisabled: boolean
  canMove: boolean; onMove: () => void
  onToggle: (id: string) => void; folderName: string | null; t: T
}) {
  return (
    <li className="relative">
      <Link href={`/minutes/${l.id}`} aria-label={l.title} className="absolute inset-0 rounded-lg" />
      <div className="flex items-center gap-3 rounded-lg px-2 py-2.5 transition-colors duration-100 hover:bg-surface-2">
        <StarButton id={l.id} fav={fav} disabled={favDisabled} onToggle={onToggle} t={t} />
        <span className={`inline-flex w-12 shrink-0 justify-center rounded-md px-1.5 py-0.5 text-[11px] font-bold text-white ${teamStyle(l.teamCode).bar}`}>
          {l.teamCode}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium text-ink">{l.title}</span>
          {l.bodyPreview && <span className="block truncate text-xs text-ink-subtle">{l.bodyPreview}</span>}
        </span>
        {l.meetingCategory && <span className="hidden shrink-0 sm:inline-flex"><CategoryChip cat={l.meetingCategory} t={t} /></span>}
        {folderName && (
          <span className="chip hidden shrink-0 bg-surface-2 text-ink-muted md:inline-flex">
            <Folder aria-hidden className="h-3 w-3" />{folderName}
          </span>
        )}
        {canMove && <MoveButton onMove={onMove} t={t} />}
        <span className="w-20 shrink-0 text-right text-xs tabular-nums text-ink-subtle">{l.minuteDate}</span>
      </div>
    </li>
  )
}
