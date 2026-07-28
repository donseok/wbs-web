'use client'
import { useMemo, useRef, useState, type DragEvent } from 'react'
import Link from 'next/link'
import {
  BookOpenText, ChevronDown, ChevronRight, Folder, FolderOpen, MoreHorizontal, Paperclip, Star,
} from 'lucide-react'
import type {
  ExplorerLeaf, FolderNode, MeetingCategory, MinuteFolder,
} from '@/lib/domain/types'
import { buildFolderTree, folderDepthOf, isTeamRootFolder, MINUTE_FOLDER_DEPTH_MAX } from '@/lib/domain/minutes'
import {
  canDropFolder, canDropMinute, type FolderDropReason, type MinuteDropReason,
} from '@/lib/domain/folder-drop'
import { MEETING_META } from '@/lib/domain/meetings'
import { moveMinuteFolder, moveMinuteToFolder } from '@/app/actions/minutes'
import { useLocale } from '@/components/providers/LocaleProvider'
import type { DictKey } from '@/lib/i18n/dict'
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
  | { mode: 'create'; parentId: string }   // 루트 생성은 W18 로 금지 — 항상 상위 폴더가 있다
  | { mode: 'rename'; folder: MinuteFolder }
  | { mode: 'delete'; folder: MinuteFolder }
  | null

const PAGE_SIZE = 30
type T = (k: DictKey) => string

const rowCls = (active: boolean) =>
  `flex h-8 w-full min-w-0 items-center gap-2 rounded-lg px-2 text-left transition-colors duration-100 ${
    active ? 'bg-brand-weak font-semibold text-brand' : 'text-ink hover:bg-surface-2'}`

/* ── 드래그앤드롭(§6.4·§6.5 W22) ── */

/** 드래그 중인 대상. dataTransfer 가 아니라 이 상태가 드롭 판정의 진실이다 —
 *  dragover 중에는 브라우저 보안상 getData() 가 빈 문자열을 돌려줘 무엇을 끌고 있는지 알 수 없다.
 *  칸반(KanbanBoard.tsx)이 같은 이유로 draggingId 상태를 쓴다. */
type DragItem = { kind: 'minute' | 'folder'; id: string }

/** dataTransfer 백업 페이로드(`kind:id`) — 실제 drop 에서만 읽는다. 상태가 비어 있는
 *  예외 상황(다른 창에서 시작한 드래그 등)에 엉뚱한 이동을 하지 않도록 파싱은 엄격하게. */
function parseDragItem(raw: string): DragItem | null {
  const sep = raw.indexOf(':')
  if (sep < 0) return null
  const kind = raw.slice(0, sep)
  const id = raw.slice(sep + 1)
  if (!id || (kind !== 'minute' && kind !== 'folder')) return null
  return { kind, id }
}

// reason(kebab) → i18n 키(camel) 매핑. canDropFolder 는 서버 액션과 같은 함수라 사유 문구도
// 서버 거절과 일치한다. 매핑을 Record 로 두면 사유가 늘 때 타입이 누락을 잡아 준다.
const FOLDER_DROP_KEY: Record<FolderDropReason, DictKey> = {
  'not-admin': 'min.fold.drop.notAdmin',
  'seed-root': 'min.fold.drop.seedRoot',
  'to-root': 'min.fold.drop.toRoot',
  cycle: 'min.fold.drop.cycle',
  depth: 'min.fold.drop.depth',
  'cross-team': 'min.fold.drop.crossTeam',
  'dup-name': 'min.fold.drop.dupName',
  'unknown-folder': 'min.fold.drop.unknownFolder',
  'same-parent': 'min.fold.drop.sameParent',
}
// 회의록 드롭 사유는 전용 문구가 없다(드롭존 비활성으로 대부분 도달 불가) — 뜻이 같은 기존 키로.
const MINUTE_DROP_KEY: Record<MinuteDropReason, DictKey> = {
  'no-permission': 'min.fold.error',
  'unknown-folder': 'min.fold.drop.unknownFolder',
  'same-folder': 'min.fold.drop.sameParent',
  'no-team': 'min.form.folderNoTeam',
}

/** 접힌 폴더 위에 머물면 자동으로 펼치는 대기 시간(ms) — 지나가는 중에 트리가 튀지 않을 만큼. */
const SPRING_OPEN_MS = 600

/** 탐색기 v2 — 실제 폴더 디렉토리(스펙 2026-07-23-minutes-folders-design.md).
 *  데이터·즐겨찾기·레이아웃 상태는 MinutesView 소유. 여기는 선택·펼침·노출 개수·모달만 관리(비영속).
 *  leaves 는 팀 탭 필터가 이미 적용된 것 — 카운트·스코프가 필터와 정합. folders 는 항상 전부. */
export function MinutesExplorer({
  folders, leaves, favorites, onToggleFavorite, onRetryFavorites,
  layout, currentUserId, isAdmin, dndEnabled = false, onChanged, onFolderSelect,
}: {
  folders: MinuteFolder[]
  leaves: ExplorerLeaf[]
  favorites: Set<string> | null
  onToggleFavorite: (id: string) => void
  onRetryFavorites: () => void
  layout: ExplorerLayout
  currentUserId: string | null
  isAdmin: boolean
  /** R4 게이트(결정 §2-A C-2) — 끄면 **드래그앤드롭만** 닫힌다. [이동] 버튼의 폴더 픽커와
   *  업로드·수정 모달의 폴더 트리 선택은 그대로 열려 있다. 서버 액션 `moveMinuteFolder` 도
   *  같은 플래그로 막히므로 UI 를 우회해도 통하지 않는다. */
  dndEnabled?: boolean
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
  const [drag, setDrag] = useState<DragItem | null>(null)         // 드래그 중인 대상(드롭 판정의 진실)
  const [dropTargetId, setDropTargetId] = useState<string | null>(null)  // 하이라이트 중인 폴더
  const resultsScrollRef = useRef<HTMLElement>(null)
  // 접힌 폴더 자동 펼침 타이머 — 렌더와 무관한 동기 상태라 ref.
  const springRef = useRef<{ id: string; timer: ReturnType<typeof setTimeout> } | null>(null)

  const { roots, unfiled } = useMemo(() => buildFolderTree(folders, leaves), [folders, leaves])
  const nodeById = useMemo(() => {
    const map = new Map<string, FolderNode>()
    const walk = (nodes: FolderNode[]) => { for (const n of nodes) { map.set(n.folder.id, n); walk(n.children) } }
    walk(roots)
    return map
  }, [roots])
  const folderById = useMemo(() => new Map(folders.map(f => [f.id, f])), [folders])
  const leafById = useMemo(() => new Map(leaves.map(l => [l.id, l])), [leaves])

  // 재조회로 폴더가 사라지면 선택이 유령을 가리킬 수 있다 — 조용히 all 로 강등
  const scope: Scope = useMemo(() => (
    scopeRaw.kind === 'folder' && !nodeById.has(scopeRaw.id) ? { kind: 'all' } : scopeRaw
  ), [scopeRaw, nodeById])

  function select(next: Scope) {
    setScopeRaw(next); setVisible(PAGE_SIZE); setMenuFor(null)
    if (resultsScrollRef.current) resultsScrollRef.current.scrollTop = 0
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

  async function moveTo(folderId: string) {
    const id = movingId
    setMovingId(null)
    if (!id) return
    const res = await moveMinuteToFolder(id, folderId)
    if (!res.ok) { toast({ title: res.error ?? t('min.fold.error'), variant: 'error' }); return }
    toast({ title: t('min.fold.moved'), variant: 'info' })
    onChanged()
  }

  /* ── D&D: 판정 → 시각 표시 → 이동 (§6.6 W22) ────────────────────────────────
     "놓고 나서 에러 토스트"는 금지다. 드래그가 시작되는 순간 모든 폴더에 대해 판정해 두고,
     받을 수 있는 폴더만 onDragOver 에서 preventDefault() 한다(안 하면 브라우저가 금지 커서를
     띄운다 — 칸반의 accepts 패턴). 판정은 서버 액션과 **같은** canDrop* 함수로 한다. */

  /** 이 폴더가 지금 끌고 있는 것을 받을 수 있는가. 사유까지 돌려 drop 시점 토스트에 재사용한다. */
  function dropVerdict(item: DragItem, targetFolderId: string):
    { ok: true } | { ok: false; key: DictKey; silent?: boolean } {
    if (item.kind === 'folder') {
      const v = canDropFolder(folders, item.id, targetFolderId, isAdmin)
      return v.ok ? { ok: true } : { ok: false, key: FOLDER_DROP_KEY[v.reason] }
    }
    const l = leafById.get(item.id)
    if (!l) return { ok: false, key: FOLDER_DROP_KEY['unknown-folder'] }
    const v = canDropMinute(folders, { folderId: l.folderId, teamCode: l.teamCode }, targetFolderId, canMoveLeaf(l))
    // 같은 폴더로의 드롭은 실패가 아니라 무동작 — 토스트로 알릴 일이 아니다.
    return v.ok
      ? { ok: true }
      : { ok: false, key: MINUTE_DROP_KEY[v.reason], silent: v.reason === 'same-folder' }
  }

  // 드래그 중일 때만 전량 판정(폴더 수는 깊이 상한 5의 수십 규모). 드래그가 없으면 비용 0이라
  // memo 로 감싸지 않는다 — 캐시가 folders/권한 변화와 어긋날 여지를 만들지 않는 편이 안전하다.
  const acceptingIds = new Set<string>()
  if (drag) for (const f of folders) { if (dropVerdict(drag, f.id).ok) acceptingIds.add(f.id) }

  function cancelSpring() {
    if (springRef.current) { clearTimeout(springRef.current.timer); springRef.current = null }
  }
  /** 접힌 폴더 위에 머물면 펼친다 — 안 하면 하위 폴더가 드롭 대상으로 아예 보이지 않는다. */
  function springOpen(id: string, hasChildren: boolean, isExpanded: boolean) {
    if (!hasChildren || isExpanded || springRef.current?.id === id) return
    cancelSpring()
    springRef.current = {
      id,
      timer: setTimeout(() => {
        springRef.current = null
        setExpanded(prev => (prev.has(id) ? prev : new Set(prev).add(id)))
      }, SPRING_OPEN_MS),
    }
  }

  function startDrag(e: DragEvent<HTMLElement>, item: DragItem) {
    // 백업 페이로드. 판정에는 쓰지 않는다(dragover 에서 읽을 수 없다) — drop 시 상태가 비었을 때만.
    e.dataTransfer.setData('text/plain', `${item.kind}:${item.id}`)
    e.dataTransfer.effectAllowed = 'move'
    setDrag(item)
    setMenuFor(null)          // 열린 폴더 메뉴는 드롭존을 덮는다
  }
  function endDrag() { setDrag(null); setDropTargetId(null); cancelSpring() }

  async function handleDrop(e: DragEvent<HTMLElement>, targetFolderId: string) {
    e.preventDefault()
    // R4 게이트 — 드래그가 시작될 수 없으므로 정상 경로로는 여기 오지 않지만, 다른 창에서
    // 온 드래그가 우연히 같은 페이로드 형식을 실어 오는 경우까지 막는다(fail-closed).
    if (!dndEnabled) return
    const item = drag ?? parseDragItem(e.dataTransfer.getData('text/plain'))
    endDrag()
    if (!item) {
      console.error('[MinutesExplorer] 드롭 대상을 식별하지 못했습니다(빈 dataTransfer)')
      toast({ title: t('min.fold.error'), variant: 'error' })
      return
    }
    // 드롭존은 이미 걸렀지만 드래그 중 재조회로 트리가 바뀌었을 수 있다 — 보내기 전에 다시 본다.
    const v = dropVerdict(item, targetFolderId)
    if (!v.ok) { if (!v.silent) toast({ title: t(v.key), variant: 'error' }); return }

    const res = item.kind === 'folder'
      ? await moveMinuteFolder(item.id, targetFolderId)
      : await moveMinuteToFolder(item.id, targetFolderId)
    if (!res.ok) {
      console.error(`[MinutesExplorer] ${item.kind} 이동 실패:`, res.error)
      toast({ title: res.error ?? t('min.fold.error'), variant: 'error' })
      return
    }
    toast({ title: t(item.kind === 'folder' ? 'min.fold.folderMoved' : 'min.fold.moved'), variant: 'success' })
    onChanged()
  }

  function folderRow(node: FolderNode, depth: number): React.ReactNode {
    const f = node.folder
    const hasChildren = node.children.length > 0
    const isExpanded = expanded.has(f.id)
    const active = scope.kind === 'folder' && scope.id === f.id
    const FolderIcon = active || isExpanded ? FolderOpen : Folder
    // 시드 팀 루트는 0043 편철 앵커라 드래그 자체를 막는다(§6.8) — 서버 M1 과 같은 기준.
    // R4 게이트 — 폴더 이동은 D&D 가 유일한 경로라 게이트가 곧 기능 차단이다.
    // 서버 액션 moveMinuteFolder 도 같은 플래그로 막는다(UI 우회 방지).
    const canDragFolder = dndEnabled && isAdmin && !isTeamRootFolder(f)
    const accepts = acceptingIds.has(f.id)
    const dropActive = accepts && dropTargetId === f.id
    return (
      <li key={f.id}>
        <div
          className={`group flex items-center gap-0.5 rounded-lg border transition-colors duration-100 ${
            dropActive ? 'border-brand ring-2 ring-brand-ring' : 'border-transparent'} ${
            canDragFolder ? 'cursor-grab select-none active:cursor-grabbing' : ''} ${
            drag?.kind === 'folder' && drag.id === f.id ? 'opacity-40' : ''}`}
          style={{ paddingLeft: `${depth * 12}px` }}
          draggable={canDragFolder}
          onDragStart={canDragFolder ? e => startDrag(e, { kind: 'folder', id: f.id }) : undefined}
          onDragEnd={canDragFolder ? endDrag : undefined}
          onDragOver={e => {
            if (!accepts) return          // preventDefault 를 하지 않으면 브라우저가 금지 커서를 띄운다
            e.preventDefault()
            e.dataTransfer.dropEffect = 'move'
            setDropTargetId(f.id)
            springOpen(f.id, hasChildren, isExpanded)
          }}
          onDragLeave={() => { setDropTargetId(k => (k === f.id ? null : k)); cancelSpring() }}
          onDrop={e => void handleDrop(e, f.id)}
        >
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
            {/* 루트 '새 폴더' 버튼은 제거했다 — W18(§6.3)이 루트 생성을 거절하므로 누르면 항상
                실패하는 죽은 어포던스가 된다. 폴더는 팀 폴더 행의 ⋯ 메뉴 → '하위 폴더 추가'로 만든다.
                팀 축 자체는 팀 마스터(/admin/teams)가 만들고, 그때 시드 루트가 함께 생성된다. */}
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

  // 폴더 카드 그리드는 전면 제거(사용자 결정 2026-07-24) — 전체 스코프 루트 카드에 이어
  // 폴더 스코프의 하위 폴더 카드도 삭제. 폴더 탐색은 왼쪽 레일 트리로 일원화. 재도입 금지.

  return (
    <div
      data-minutes-explorer
      className="flex flex-col gap-4 lg:min-h-0 lg:flex-1 lg:flex-row lg:items-stretch"
    >
      <nav
        data-minutes-navigation
        className="card hidden w-[250px] shrink-0 p-2 lg:block lg:min-h-0 lg:overflow-y-auto lg:overscroll-y-contain"
      >
        {rail()}
      </nav>
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

      <section
        ref={resultsScrollRef}
        data-minutes-results-scroll-region
        className="min-w-0 flex-1 lg:-mr-1 lg:min-h-0 lg:overflow-y-auto lg:overscroll-y-contain lg:pb-1 lg:pr-1"
      >
        <div data-minutes-content-body className="space-y-4">
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
                      canMove={canMoveLeaf(l)} canDrag={dndEnabled && canMoveLeaf(l)}
                      onMove={() => setMovingId(l.id)}
                      dragging={drag?.kind === 'minute' && drag.id === l.id}
                      onDragStart={e => startDrag(e, { kind: 'minute', id: l.id })} onDragEnd={endDrag}
                      onToggle={onToggleFavorite} />
                  ))}
                </div>
              ) : (
                <div className="card p-2">
                  <ul className="divide-y divide-line/70">
                    {shown.map(l => (
                      <MinuteRow key={l.id} l={l} t={t} folderName={folderNameOf(l, folderById, showFolderChip)}
                        fav={favorites?.has(l.id) ?? false} favDisabled={favorites === null}
                        canMove={canMoveLeaf(l)} canDrag={dndEnabled && canMoveLeaf(l)}
                      onMove={() => setMovingId(l.id)}
                        dragging={drag?.kind === 'minute' && drag.id === l.id}
                        onDragStart={e => startDrag(e, { kind: 'minute', id: l.id })} onDragEnd={endDrag}
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

function MinuteCard({
  l, fav, favDisabled, canMove, canDrag, onMove, onToggle, folderName, t, dragging, onDragStart, onDragEnd,
}: {
  l: ExplorerLeaf; fav: boolean; favDisabled: boolean
  /** [이동] 버튼 노출 권한. R4 게이트와 무관하게 유지된다. */
  canMove: boolean
  /** 드래그 가능 여부 = 권한 && R4 게이트(dndEnabled). 버튼과 분리해 둔다. */
  canDrag: boolean
  onMove: () => void
  onToggle: (id: string) => void; folderName: string | null; t: T
  dragging: boolean
  onDragStart: (e: DragEvent<HTMLElement>) => void
  onDragEnd: () => void
}) {
  return (
    <article
      draggable={canDrag}
      onDragStart={canDrag ? onDragStart : undefined}
      onDragEnd={canDrag ? onDragEnd : undefined}
      className={`card relative flex flex-col gap-2 p-4 transition-shadow duration-150 hover:shadow-[var(--shadow-md)] ${
        canDrag ? 'cursor-grab select-none active:cursor-grabbing' : ''} ${dragging ? 'opacity-40' : ''}`}
    >
      {/* draggable={false} 필수 — <a> 는 브라우저 기본 draggable 이라, 전면 오버레이인 이 Link 가
          카드 드래그를 가로채고 text/uri-list(주소)를 실어 보낸다(회의록 이동이 URL 드래그가 된다). */}
      <Link href={`/minutes/${l.id}`} aria-label={l.title} draggable={false} className="absolute inset-0 rounded-2xl" />
      <div className="flex items-start gap-1.5">
        <StarButton id={l.id} fav={fav} disabled={favDisabled} onToggle={onToggle} t={t} />
        <h4 className="min-w-0 flex-1 truncate pt-0.5 text-sm font-semibold text-ink">{l.title}</h4>
        {canMove && <MoveButton onMove={onMove} t={t} />}
        <span className={`inline-flex shrink-0 justify-center rounded-md px-1.5 py-0.5 text-[11px] font-bold text-white ${teamStyle(l.teamCode).bar}`}>
          {l.teamCode}
        </span>
      </div>
      {(l.projectName || l.meetingCategory || folderName) && (
        <div className="flex flex-wrap items-center gap-1.5">
          {l.projectName && (
            <span className="chip bg-brand-weak text-brand">
              <BookOpenText aria-hidden className="h-3 w-3" />{l.projectName}
            </span>
          )}
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

function MinuteRow({
  l, fav, favDisabled, canMove, canDrag, onMove, onToggle, folderName, t, dragging, onDragStart, onDragEnd,
}: {
  l: ExplorerLeaf; fav: boolean; favDisabled: boolean
  /** [이동] 버튼 노출 권한. R4 게이트와 무관하게 유지된다. */
  canMove: boolean
  /** 드래그 가능 여부 = 권한 && R4 게이트(dndEnabled). 버튼과 분리해 둔다. */
  canDrag: boolean
  onMove: () => void
  onToggle: (id: string) => void; folderName: string | null; t: T
  dragging: boolean
  onDragStart: (e: DragEvent<HTMLElement>) => void
  onDragEnd: () => void
}) {
  return (
    <li
      draggable={canDrag}
      onDragStart={canDrag ? onDragStart : undefined}
      onDragEnd={canDrag ? onDragEnd : undefined}
      className={`relative ${canDrag ? 'cursor-grab select-none active:cursor-grabbing' : ''} ${
        dragging ? 'opacity-40' : ''}`}
    >
      {/* draggable={false} 필수 — 카드와 같은 이유(전면 <a> 오버레이가 드래그를 가로챈다) */}
      <Link href={`/minutes/${l.id}`} aria-label={l.title} draggable={false} className="absolute inset-0 rounded-lg" />
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
        {l.projectName && (
          <span className="chip hidden max-w-40 shrink-0 bg-brand-weak text-brand lg:inline-flex">
            <BookOpenText aria-hidden className="h-3 w-3" />
            <span className="truncate">{l.projectName}</span>
          </span>
        )}
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
