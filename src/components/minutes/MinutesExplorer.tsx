'use client'
import { useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import {
  BookOpenText, CheckSquare, ChevronDown, ChevronRight, ExternalLink, FileText, Folder, FolderOpen,
  FolderPlus, MoreHorizontal, Paperclip, Square, Star,
} from 'lucide-react'
import type {
  ExplorerLeaf, FolderNode, MeetingCategory, Minute, MinuteFolder,
} from '@/lib/domain/types'
import { buildFolderTree, folderDepthOf, isTeamRootFolder, MINUTE_FOLDER_DEPTH_MAX } from '@/lib/domain/minutes'
import {
  resolveFolderDrop, resolveLeafDrop, type MinuteDropReject, type MinuteDropResult,
} from '@/lib/domain/minutes-drop'
import { MEETING_META } from '@/lib/domain/meetings'
import {
  assignMinutesProject, fetchMinuteDetail, moveMinuteFolder, moveMinuteToFolder,
} from '@/app/actions/minutes'
import { useLocale } from '@/components/providers/LocaleProvider'
import type { DictKey } from '@/lib/i18n/dict'
import { EmptyState } from '@/components/ui/EmptyState'
import { useToast } from '@/components/ui/Toast'
import { teamStyle } from '@/components/wbs/shared'
import { Modal } from '@/components/ui/Modal'
import { FolderManageModal } from './FolderManageModal'
import { FolderPickModal } from './FolderPickModal'
import { MinuteMetaModal } from './MinuteMetaModal'

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

/** 드래그 중인 항목. 드롭 판정을 dataTransfer 가 아니라 이 상태에서 읽는다 — dragOver 단계에서도
 *  같은 판정이 필요한데(수락 대상만 하이라이트), dataTransfer.getData 는 drop 전에는 빈 문자열이다. */
type DragItem = { kind: 'leaf'; id: string } | { kind: 'folder'; id: string }
/** dragSource() 가 돌려주는 소스 props — 카드·행 컴포넌트가 그대로 펼쳐 쓴다. */
type DragSourceProps = {
  draggable: true
  onDragStart: (e: React.DragEvent) => void
  onDragEnd: () => void
}
/** 드롭 대상 키 — 폴더는 id, 루트 레벨과 미분류는 예약 키. */
const ROOT_KEY = '__root__'
const UNFILED_KEY = '__unfiled__'

const DROP_REJECT_KEY: Record<MinuteDropReject, DictKey> = {
  'team-root': 'min.fold.dropTeamRoot',
  'not-found': 'min.fold.dropNotFound',
  cycle: 'min.fold.dropCycle',
  depth: 'min.fold.dropDepth',
  'anchor-squat': 'min.fold.dropAnchor',
  'cross-project': 'min.fold.dropCrossProject',
}

const rowCls = (active: boolean) =>
  `flex h-8 w-full min-w-0 items-center gap-2 rounded-lg px-2 text-left transition-colors duration-100 ${
    active ? 'bg-brand-weak font-semibold text-brand' : 'text-ink hover:bg-surface-2'}`

/** 탐색기 v2 — 실제 폴더 디렉토리(스펙 2026-07-23-minutes-folders-design.md).
 *  데이터·즐겨찾기·레이아웃 상태는 MinutesView 소유. 여기는 선택·펼침·노출 개수·모달만 관리(비영속).
 *  leaves 는 팀 탭 필터가 이미 적용된 것 — 카운트·스코프가 필터와 정합. folders 는 항상 전부. */
export function MinutesExplorer({
  folders, leaves, favorites, onToggleFavorite, onRetryFavorites,
  layout, currentUserId, isFolderAdmin, adminProjectIds = [], isSuperuser = false,
  onChanged, onFolderSelect, teamCodes = [], projects = [],
  myProjectIds = null,
}: {
  folders: MinuteFolder[]
  leaves: ExplorerLeaf[]
  favorites: Set<string> | null
  onToggleFavorite: (id: string) => void
  onRetryFavorites: () => void
  layout: ExplorerLayout
  currentUserId: string | null
  /** 폴더는 프로젝트에 속하지 않는 전역 리소스 — 서버 가드도 isAnyProjectAdmin 이라 전역 불리언 하나로 맞는다. */
  isFolderAdmin: boolean
  /** 회의록 개별 건은 **그 회의록 프로젝트의** 관리자 기준(서버 checkOwner). 관리자인 프로젝트 id 목록. */
  adminProjectIds?: string[]
  /** 프로젝트 미지정(projectId null) 회의록은 isProjectAdmin(actor, null)=슈퍼유저만 — fail-closed. */
  isSuperuser?: boolean
  onChanged: () => void
  onFolderSelect?: (folderId: string | null) => void
  /** 루트 예약어(팀 앵커) 판정용. 여기서 훅으로 직접 읽지 않는 이유는 이 목록이 **활성** 팀이라
   *  비활성 팀 앵커를 놓칠 수 있어서다 — 최종 판정은 전체 등록 팀을 아는 서버가 한다(fail-closed). */
  teamCodes?: readonly string[]
  /** 카드 [수정] 이 여는 메타 모달의 프로젝트 셀렉트 옵션. 빈 배열이면 '연결 없음'만 고를 수 있다. */
  projects?: { id: string; name: string }[]
  /** 내가 멤버로 등록된 프로젝트 id — 수정 모달의 프로젝트 기본 선택 근거. */
  myProjectIds?: string[] | null
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
  const [leafMenuFor, setLeafMenuFor] = useState<string | null>(null)  // '...' 메뉴가 열린 회의록
  // 다중 선택 — 평소에는 꺼 둔다. 체크박스를 상시 노출하면 '읽는 화면'이 '고르는 화면'이 된다.
  const [selecting, setSelecting] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [assignOpen, setAssignOpen] = useState(false)
  const [assignBusy, setAssignBusy] = useState(false)
  // 카드에서 바로 여는 수정 모달. 트리는 ExplorerLeaf(요약)만 갖고 있어 메타 모달이 필요로 하는
  // meetingId·externalId 등이 없다 — 열 때 상세를 한 번 받아온다.
  const [editMinute, setEditMinute] = useState<Minute | null>(null)
  const [editLoadingId, setEditLoadingId] = useState<string | null>(null)
  const [drag, setDrag] = useState<DragItem | null>(null)
  const [dragOverKey, setDragOverKey] = useState<string | null>(null)
  const resultsScrollRef = useRef<HTMLElement>(null)
  // 같은 드롭이 두 번 커밋되는 것을 막는 동기 가드(렌더와 무관하므로 ref)
  const dropInFlightRef = useRef(false)
  // 드래그 고스트(아래 DragGhost) — 종류별로 하나씩 화면 밖에 상주시킨다. 상태가 아니라 ref 인 이유는
  // setDragImage 를 dragstart 안에서 동기적으로 불러야 해서다(리렌더를 기다릴 수 없다).
  const leafGhostRef = useRef<HTMLDivElement>(null)
  const folderGhostRef = useRef<HTMLDivElement>(null)

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
    // 스코프를 옮기면 고른 것도 버린다 — 화면에서 사라진 선택을 들고 다니면 다음 실행이
    // 보이지 않는 건을 건드린다. 모드는 유지한다(폴더를 옮겨 가며 정리하는 동선이라).
    setSelected(new Set())
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
  const canManageFolder = (f: MinuteFolder) => isFolderAdmin || (f.createdBy !== null && f.createdBy === currentUserId)
  /** isProjectAdmin(actor, projectId) 의 클라이언트 등가식 — 슈퍼유저는 모든 프로젝트의 관리자다. */
  const isAdminOf = (projectId: string | null | undefined) =>
    isSuperuser || (projectId != null && adminProjectIds.includes(projectId))
  // 서버 checkOwner 와 같은 식: 작성자 본인 또는 **그 회의록 프로젝트의** 관리자.
  // 전역 shim(어느 프로젝트든 관리자)으로 판정하면 A 프로젝트 관리자에게 B 프로젝트 회의록의
  // 이동·일괄지정 어포던스가 열리고 전부 서버에서 거부된다.
  const canMoveLeaf = (l: ExplorerLeaf) =>
    (l.createdBy !== null && l.createdBy === currentUserId) || isAdminOf(l.projectId)

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

  /** 카드/행의 [수정] — 상세를 받아 메타 모달을 연다. 상세 없이 열면 모달이 빈 값으로 저장을
   *  덮어써 meetingId·프로젝트 연결이 조용히 끊긴다. 실패는 토스트로 드러낸다(빈 모달 금지). */
  async function openEdit(id: string) {
    setLeafMenuFor(null)
    setEditLoadingId(id)
    try {
      const detail = await fetchMinuteDetail(id)
      if (!detail) { toast({ title: t('min.exp.editLoadFailed'), variant: 'error' }); return }
      setEditMinute(detail.minute)
    } catch (e) {
      console.error('[MinutesExplorer] 회의록 상세 조회 실패:', e)
      toast({ title: t('min.exp.editLoadFailed'), variant: 'error' })
    } finally {
      setEditLoadingId(null)
    }
  }

  function exitSelect() { setSelecting(false); setSelected(new Set()) }
  /** 진입은 카드·행의 '...' 메뉴에서만. 연 몇 번 쓰는 정리 작업이라 상시 버튼으로 한 줄을
   *  차지할 값이 아니다. 연 회의록을 첫 선택으로 넣어 진입 직후 한 번 더 고르게 하지 않는다. */
  function startSelect(id: string) {
    setLeafMenuFor(null); setSelecting(true); setSelected(new Set([id]))
  }
  function toggleSelect(id: string) {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }
  // 지금 화면에 보이는 것만 — 사용자가 보지 않은 뒤쪽 페이지까지 잡아 200건을 바꾸면 안 된다
  const selectableShown = shown.filter(canMoveLeaf)
  const allShownSelected = selectableShown.length > 0 && selectableShown.every(l => selected.has(l.id))
  /** 실행 대상 = 고른 것 ∩ 지금 화면에 있고 권한도 있는 것. selected 는 팀 탭을 바꿔도
   *  (컴포넌트가 언마운트되지 않으므로) 살아남는데 rows 는 갈린다 — 교집합을 취하지 않으면
   *  화면에 없는 건이 조용히 바뀐다. 표시 건수도 이 값을 쓴다(보이는 것과 세는 것이 같아야 한다). */
  const selectedIds = selectableShown.filter(l => selected.has(l.id)).map(l => l.id)
  // 지정할 프로젝트가 하나도 없으면 고를 이유도 없다 — 메뉴에 진입 항목을 내놓지 않는다
  const canSelect = !selecting && projects.length > 0

  /** 선택분에 프로젝트를 일괄 지정. 건별 결과가 갈리므로 요약을 그대로 보여준다. */
  async function assignProject(projectId: string | null) {
    const ids = selectedIds
    if (ids.length === 0) return
    setAssignBusy(true)
    try {
      const res = await assignMinutesProject(ids, projectId)
      if (!res.ok) { toast({ title: res.error ?? t('min.fold.error'), variant: 'error' }); return }
      // 건너뛴 건이 있으면 '전부 됐다'로 읽히지 않게 건수를 함께 알린다
      if (res.skipped.length > 0) {
        toast({
          title: t('min.exp.assignPartial')
            .replace('{n}', String(res.updated)).replace('{k}', String(res.skipped.length)),
          description: res.skipped[0].reason,
          variant: 'info',
        })
      } else {
        toast({ title: t('min.exp.assignDone').replace('{n}', String(res.updated + res.unchanged)), variant: 'info' })
      }
      setAssignOpen(false)
      exitSelect()
      onChanged()
    } catch (e) {
      console.error('[MinutesExplorer] 프로젝트 일괄 지정 실패:', e)
      toast({ title: t('min.fold.error'), variant: 'error' })
    } finally {
      setAssignBusy(false)
    }
  }

  async function moveTo(folderId: string | null) {
    const id = movingId
    setMovingId(null)
    if (!id) return
    const res = await moveMinuteToFolder(id, folderId)
    if (!res.ok) { toast({ title: res.error ?? t('min.fold.error'), variant: 'error' }); return }
    toast({ title: t('min.fold.moved'), variant: 'info' })
    onChanged()
  }

  /* ── 드래그앤드롭 ────────────────────────────────────────────────────────────
     대상 키: 폴더 id / ROOT_KEY(전체 행 = 루트 레벨) / UNFILED_KEY(미분류 행).
     회의록은 폴더·미분류에만, 폴더는 폴더·루트에만 놓을 수 있다 — 나머지 조합은 판정 null(무반응).
     미분류 행은 0건이면 렌더되지 않으므로(위 rail 참조) 그때는 드롭으로 미분류에 보낼 수 없다.
     이동 버튼의 폴더 픽커가 그 경로를 계속 담당한다.
     권한은 draggable 단계에서 이미 걸러진다(canMoveLeaf/canManageFolder). */

  /** item 을 target 에 놓았을 때의 판정. null = 이 조합은 드롭 대상이 아님.
   *  dragOver(수락·하이라이트)와 drop(실행)이 같은 함수를 쓰므로 표시와 동작이 어긋나지 않는다. */
  function verdictOf(item: DragItem | null, target: string): MinuteDropResult | null {
    if (!item) return null
    if (item.kind === 'leaf') {
      if (target === ROOT_KEY) return null
      const l = leafById.get(item.id)
      return l ? resolveLeafDrop(l, target === UNFILED_KEY ? null : target) : null
    }
    if (target === UNFILED_KEY) return null
    const f = folderById.get(item.id)
    return f ? resolveFolderDrop(f, target === ROOT_KEY ? null : target, folders, teamCodes) : null
  }

  async function handleDrop(target: string) {
    const item = drag
    // 하이라이트·드래그 상태는 await 앞에서 비운다 — 실패해도 강조가 남지 않게
    setDrag(null); setDragOverKey(null)
    const v = verdictOf(item, target)
    if (!item || !v || v.kind === 'noop' || dropInFlightRef.current) return
    if (v.kind === 'reject') {
      toast({
        title: t(DROP_REJECT_KEY[v.reason]).replace('{n}', String(MINUTE_FOLDER_DEPTH_MAX)),
        variant: 'error',
      })
      return
    }
    dropInFlightRef.current = true
    try {
      if (item.kind === 'leaf') {
        const res = await moveMinuteToFolder(item.id, target === UNFILED_KEY ? null : target)
        if (!res.ok) { toast({ title: res.error ?? t('min.fold.error'), variant: 'error' }); return }
        toast({ title: t('min.fold.moved'), variant: 'info' })
      } else {
        const newParentId = target === ROOT_KEY ? null : target
        const res = await moveMinuteFolder(item.id, newParentId)
        if (!res.ok) { toast({ title: res.error ?? t('min.fold.error'), variant: 'error' }); return }
        // expanded 는 최초 렌더 1회만 계산된다 — 지금까지 자식이 없던 폴더로 옮기면 그 부모가
        // 집합에 없어 옮긴 폴더가 접힌 채 사라져 보인다. 재조회로도 복구되지 않으므로 여기서 펼친다.
        if (newParentId) setExpanded(prev => new Set(prev).add(newParentId))
        toast({ title: t('min.fold.folderMoved'), variant: 'info' })
      }
      onChanged()
    } finally {
      dropInFlightRef.current = false
    }
  }

  /** 드롭 대상 행의 공통 props + 강조 클래스. 거부 대상도 preventDefault 한다 — 사유를
   *  토스트로 알려주려면 drop 이 실제로 발생해야 하기 때문이다(dropEffect='none' 은 drop 을 없앤다).
   *  대신 행 자체를 거부 색으로 칠해 시각적으로 구분한다. */
  function dropTarget(target: string) {
    const v = verdictOf(drag, target)
    const over = dragOverKey === target && v !== null
    return {
      handlers: v === null ? {} : {
        onDragOver: (e: React.DragEvent) => { e.preventDefault(); setDragOverKey(target) },
        onDragLeave: () => setDragOverKey(k => (k === target ? null : k)),
        onDrop: (e: React.DragEvent) => { e.preventDefault(); void handleDrop(target) },
      },
      cls: !over || v.kind === 'noop' ? ''
        : v.kind === 'move' ? 'bg-brand-weak ring-2 ring-brand-ring'
          : 'bg-delayed-weak ring-2 ring-delayed',
    }
  }

  /** 브라우저 기본 드래그 이미지는 끌고 있는 요소 전체를 그대로 스냅샷한다 — 그리드 카드(최대 3열 중 1열)
   *  나 리스트 행(폭 전체)이라 커서 주변을 크게 덮어 정작 놓을 곳인 왼쪽 폴더 트리가 가려진다.
   *  대신 문서·폴더 모양의 작은 칩을 스냅샷으로 쓴다. 커서 기준 오른쪽 아래로 펼쳐지도록 앵커를 잡아
   *  왼쪽(트리 방향) 시야를 비운다. setDragImage 가 없는 환경(jsdom 등)에서는 기본 동작에 맡긴다. */
  function applyDragGhost(e: React.DragEvent, item: DragItem) {
    const ghost = (item.kind === 'leaf' ? leafGhostRef : folderGhostRef).current
    if (!ghost || typeof e.dataTransfer.setDragImage !== 'function') return
    const label = item.kind === 'leaf'
      ? leafById.get(item.id)?.title
      : folderById.get(item.id)?.name
    const slot = ghost.querySelector('[data-drag-ghost-label]')
    if (slot) slot.textContent = label ?? ''
    e.dataTransfer.setDragImage(ghost, 14, 14)
  }

  /** 드래그 소스 props. dataTransfer.setData 는 Firefox 가 드래그를 시작하는 조건이라 필수지만,
   *  판정은 drag 상태에서 읽는다(dragOver 시점엔 getData 가 빈 문자열). */
  function dragSource(item: DragItem): DragSourceProps {
    return {
      draggable: true,
      onDragStart: (e: React.DragEvent) => {
        e.dataTransfer.setData('text/plain', item.id)
        e.dataTransfer.effectAllowed = 'move'
        applyDragGhost(e, item)
        setDrag(item)
      },
      onDragEnd: () => { setDrag(null); setDragOverKey(null) },
    }
  }

  function folderRow(node: FolderNode, depth: number): React.ReactNode {
    const f = node.folder
    const hasChildren = node.children.length > 0
    const isExpanded = expanded.has(f.id)
    const active = scope.kind === 'folder' && scope.id === f.id
    const FolderIcon = active || isExpanded ? FolderOpen : Folder
    const drop = dropTarget(f.id)
    const canDrag = canManageFolder(f) && !isTeamRootFolder(f)
    const dragging = drag?.kind === 'folder' && drag.id === f.id
    return (
      <li key={f.id}>
        {/* 드롭 핸들러는 이 행 div 에만 — li 에 걸면 아래 중첩 ul 의 자식 행 드롭까지 가로챈다 */}
        <div
          data-drop-target={f.id}
          {...(canDrag ? dragSource({ kind: 'folder', id: f.id }) : {})}
          {...drop.handlers}
          className={`group flex items-center gap-0.5 rounded-lg ${drop.cls} ${
            canDrag ? 'cursor-grab select-none active:cursor-grabbing' : ''} ${dragging ? 'opacity-40' : ''}`}
          style={{ paddingLeft: `${depth * 12}px` }}>
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
    // 전체 행 = 루트 레벨(폴더 전용), 미분류 행 = 회의록 전용
    const rootDrop = dropTarget(ROOT_KEY)
    const unfiledDrop = dropTarget(UNFILED_KEY)
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
          <div data-drop-target={ROOT_KEY} {...rootDrop.handlers}
            className={`flex items-center gap-0.5 rounded-lg ${rootDrop.cls}`}>
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
                <div data-drop-target={UNFILED_KEY} {...unfiledDrop.handlers}
                  className={`flex items-center gap-0.5 rounded-lg ${unfiledDrop.cls}`}>
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
          {/* 선택 액션바 — 선택 모드일 때만. 평소에는 결과 위에 아무 것도 두지 않는다(진입은 카드 '...').
              rows 가 비어도 띄운다 — 빈 폴더로 들어갔을 때 [취소]가 사라지면 빠져나올 곳이 없다. */}
          {selecting && (
            <div className="card flex flex-wrap items-center gap-2 px-3 py-2 text-sm">
              <span className="font-medium text-ink">
                {t('min.exp.selectedN').replace('{n}', String(selectedIds.length))}
              </span>
              <button onClick={() => setSelected(prev => {
                if (allShownSelected) {
                  const next = new Set(prev)
                  for (const l of selectableShown) next.delete(l.id)
                  return next
                }
                return new Set([...prev, ...selectableShown.map(l => l.id)])
              })} disabled={selectableShown.length === 0} className="btn h-8 px-2.5 text-xs">
                {t(allShownSelected ? 'min.exp.selectNone' : 'min.exp.selectAll')}
              </button>
              <button onClick={() => setAssignOpen(true)} disabled={selectedIds.length === 0}
                className="btn btn-primary h-8 px-2.5 text-xs">
                {t('min.exp.assignProject')}
              </button>
              <button onClick={exitSelect} className="btn ml-auto h-8 px-2.5 text-xs">
                {t('min.exp.selectCancel')}
              </button>
            </div>
          )}
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
                      canMove={canMoveLeaf(l)} onMove={() => { setLeafMenuFor(null); setMovingId(l.id) }}
                      menuOpen={leafMenuFor === l.id} menuBusy={editLoadingId === l.id}
                      onMenuToggle={() => setLeafMenuFor(cur => (cur === l.id ? null : l.id))}
                      onEdit={() => void openEdit(l.id)}
                      dragProps={canMoveLeaf(l) ? dragSource({ kind: 'leaf', id: l.id }) : undefined}
                      dragging={drag?.kind === 'leaf' && drag.id === l.id}
                      onToggle={onToggleFavorite}
                      canSelect={canSelect} onSelect={() => startSelect(l.id)}
                      selecting={selecting && canMoveLeaf(l)} selected={selected.has(l.id)}
                      onSelectToggle={() => toggleSelect(l.id)} />
                  ))}
                </div>
              ) : (
                <div className="card p-2">
                  <ul className="divide-y divide-line/70">
                    {shown.map(l => (
                      <MinuteRow key={l.id} l={l} t={t} folderName={folderNameOf(l, folderById, showFolderChip)}
                        fav={favorites?.has(l.id) ?? false} favDisabled={favorites === null}
                        canMove={canMoveLeaf(l)} onMove={() => { setLeafMenuFor(null); setMovingId(l.id) }}
                        menuOpen={leafMenuFor === l.id} menuBusy={editLoadingId === l.id}
                        onMenuToggle={() => setLeafMenuFor(cur => (cur === l.id ? null : l.id))}
                        onEdit={() => void openEdit(l.id)}
                        dragProps={canMoveLeaf(l) ? dragSource({ kind: 'leaf', id: l.id }) : undefined}
                        dragging={drag?.kind === 'leaf' && drag.id === l.id}
                        onToggle={onToggleFavorite}
                        canSelect={canSelect} onSelect={() => startSelect(l.id)}
                        selecting={selecting && canMoveLeaf(l)} selected={selected.has(l.id)}
                        onSelectToggle={() => toggleSelect(l.id)} />
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
      <ProjectAssignModal open={assignOpen} projects={projects} count={selectedIds.length} busy={assignBusy}
        onClose={() => setAssignOpen(false)} onPick={pid => void assignProject(pid)} t={t} />
      {/* 목록에서 바로 여는 수정 모달 — 열 때마다 리마운트해 이전 회의록 값이 남지 않게 한다
          (뷰어의 metaOpen 과 같은 규약). 저장 성공은 onChanged 로 트리를 다시 읽는다. */}
      {editMinute && (
        <MinuteMetaModal open minute={editMinute} projects={projects} myProjectIds={myProjectIds}
          onClose={() => setEditMinute(null)}
          onSaved={() => { setEditMinute(null); onChanged() }} />
      )}

      <DragGhost kind="leaf" innerRef={leafGhostRef} />
      <DragGhost kind="folder" innerRef={folderGhostRef} />
    </div>
  )
}

/** 드래그 중 커서를 따라다니는 칩. 카드·행 전체를 스냅샷하는 기본 드래그 이미지 대신 쓴다(applyDragGhost).
 *  화면 밖에 **상시 렌더**해 둔다 — display:none·visibility:hidden 이거나 DOM 에 없으면 브라우저가
 *  스냅샷을 뜨지 못해 조용히 기본 이미지로 되돌아간다. 라벨은 dragstart 때 textContent 로 갈아끼운다
 *  (그 시점에 상태 업데이트는 늦다). fixed 라 레이아웃에는 영향이 없다. */
function DragGhost({ kind, innerRef }: {
  kind: DragItem['kind']
  innerRef: React.RefObject<HTMLDivElement | null>
}) {
  const Icon = kind === 'leaf' ? FileText : Folder
  return (
    <div ref={innerRef} aria-hidden data-drag-ghost={kind}
      className="pointer-events-none fixed -top-[9999px] left-0 flex w-max max-w-[200px] items-center gap-1.5 rounded-lg border border-line bg-surface px-2.5 py-1.5 text-[13px] font-medium text-ink shadow-[var(--shadow-md)]">
      <Icon aria-hidden className="h-4 w-4 shrink-0 text-brand" />
      <span data-drag-ghost-label className="min-w-0 truncate" />
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

/** 카드·행의 '...' 메뉴 — 상세 페이지로 들어가지 않고 목록에서 바로 수정·이동한다.
 *  카드 전면을 덮는 링크 오버레이(absolute inset-0) 위로 올라와야 하므로 z 를 준다.
 *  display 를 상태로 토글하는 변형 유틸은 쓰지 않는다(CLAUDE.md 반응형 안전망 제약) — 항상
 *  렌더하고 opacity 만 바꾼다(폴더 메뉴와 같은 방식). */
/** 선택분에 지정할 프로젝트를 고르는 모달. '연결 없음'은 해제 — 위키에서 회수된다. */
function ProjectAssignModal({ open, projects, count, busy, onClose, onPick, t }: {
  open: boolean
  projects: { id: string; name: string }[]
  count: number
  busy: boolean
  onClose: () => void
  onPick: (projectId: string | null) => void
  t: T
}) {
  return (
    <Modal open={open} onClose={onClose} title={t('min.exp.assignProject')} size="sm">
      <p className="mb-2 text-sm text-ink-muted">
        {t('min.exp.assignDesc').replace('{n}', String(count))}
      </p>
      <ul className="max-h-80 space-y-0.5 overflow-y-auto">
        {projects.map(p => (
          <li key={p.id}>
            <button onClick={() => onPick(p.id)} disabled={busy}
              className="flex h-9 w-full min-w-0 items-center gap-2 rounded-lg px-2 text-left transition-colors duration-100 hover:bg-surface-2 disabled:opacity-40">
              <BookOpenText aria-hidden className="h-4 w-4 shrink-0 text-brand" />
              <span className="min-w-0 flex-1 truncate text-[13px] text-ink">{p.name}</span>
            </button>
          </li>
        ))}
        <li>
          <button onClick={() => onPick(null)} disabled={busy}
            className="flex h-9 w-full min-w-0 items-center gap-2 rounded-lg px-2 text-left transition-colors duration-100 hover:bg-surface-2 disabled:opacity-40">
            <Square aria-hidden className="h-4 w-4 shrink-0 text-ink-subtle" />
            <span className="min-w-0 flex-1 truncate text-[13px] text-ink-muted">{t('min.exp.assignNone')}</span>
          </button>
        </li>
      </ul>
    </Modal>
  )
}

/** 선택 모드 체크박스 — 링크 오버레이 위(z)에서 클릭을 받는다. */
function SelectBox({ checked, onToggle, t }: { checked: boolean; onToggle: () => void; t: T }) {
  const Icon = checked ? CheckSquare : Square
  return (
    <button onClick={onToggle} role="checkbox" aria-checked={checked} aria-label={t('min.exp.selectAria')}
      className={`relative z-20 shrink-0 rounded-md p-1 transition-colors duration-100 hover:bg-surface-2 ${
        checked ? 'text-brand' : 'text-ink-subtle'}`}>
      <Icon aria-hidden className="h-4 w-4" />
    </button>
  )
}

function LeafMenu({ open, busy, onToggle, onEdit, onMove, canSelect, onSelect, t }: {
  open: boolean; busy: boolean
  onToggle: () => void; onEdit: () => void; onMove: () => void
  /** 다중 선택 진입 — 이 메뉴가 유일한 진입 경로다(상시 버튼 없음) */
  canSelect?: boolean; onSelect?: () => void
  t: T
}) {
  return (
    // Escape 로도 닫는다 — 바깥 클릭용 백드롭은 tabIndex=-1 이라 키보드로 닿지 않는다.
    // 유일한 선택 진입 경로가 된 뒤로는 이 메뉴에서 빠져나올 키보드 길이 있어야 한다.
    <div onKeyDown={e => { if (e.key === 'Escape' && open) { e.stopPropagation(); onToggle() } }}
      className="relative z-20 shrink-0">
      <button onClick={onToggle} disabled={busy}
        aria-label={t('min.exp.leafMenuAria')} aria-expanded={open} aria-haspopup="menu"
        className="rounded-md p-1 text-ink-subtle transition-colors duration-100 hover:bg-surface-2 hover:text-ink disabled:opacity-40">
        <MoreHorizontal aria-hidden className="h-4 w-4" />
      </button>
      {open && (
        <>
          {/* 바깥 클릭 닫기 — 패널보다 낮고 카드 링크보다 높아야 한다 */}
          <button aria-hidden tabIndex={-1} onClick={onToggle} className="fixed inset-0 z-20 cursor-default" />
          <div role="menu"
            className="absolute right-0 z-30 mt-1 w-36 rounded-xl border border-line bg-surface p-1 shadow-[var(--shadow-md)]">
            <button role="menuitem" onClick={onEdit}
              className="block w-full rounded-lg px-2 py-1.5 text-left text-[13px] text-ink hover:bg-surface-2">
              {t('min.detail.edit')}
            </button>
            <button role="menuitem" onClick={onMove}
              className="block w-full rounded-lg px-2 py-1.5 text-left text-[13px] text-ink hover:bg-surface-2">
              {t('min.fold.move')}
            </button>
            {canSelect && (
              <button role="menuitem" onClick={onSelect}
                className="block w-full rounded-lg px-2 py-1.5 text-left text-[13px] text-ink hover:bg-surface-2">
                {t('min.exp.selectMulti')}
              </button>
            )}
          </div>
        </>
      )}
    </div>
  )
}

function CategoryChip({ cat, t }: { cat: MeetingCategory; t: T }) {
  const meta = MEETING_META[cat]
  return <span className={`chip ${meta.chip}`}>{t(meta.labelKey)}</span>
}

/** 연결된 회의 — 상세 뷰어와 같은 문구·같은 대상(그 회의가 속한 프로젝트의 회의 달력).
 *  회의가 없거나 회의의 프로젝트를 못 읽으면 아예 렌더하지 않는다(호출부 판정).
 *  z-10: 카드·행 전면을 덮는 링크 오버레이 위로 올려야 클릭이 회의로 간다.
 *  draggable=false: 앵커는 기본 draggable 이라 그대로 두면 카드 대신 이 링크가 끌린다. */
function LinkedMeetingChip({ projectId, t }: { projectId: string; t: T }) {
  return (
    <Link draggable={false} href={`/p/${projectId}/meetings`}
      className="chip relative z-10 bg-brand-weak text-brand underline-offset-2 hover:underline">
      <ExternalLink aria-hidden className="h-3 w-3 shrink-0" />{t('min.detail.linkedMeeting')}
    </Link>
  )
}

/** 카드·행 공통 판정 — 상세 뷰어와 같은 조건(둘 다 있어야 링크가 성립). */
function meetingLinkOf(l: ExplorerLeaf): string | null {
  return l.meetingId && l.meetingProjectId ? l.meetingProjectId : null
}

function MinuteCard({
  l, fav, favDisabled, canMove, onMove, menuOpen, menuBusy, onMenuToggle, onEdit,
  onToggle, folderName, t, dragProps, dragging, canSelect, onSelect,
  selecting = false, selected = false, onSelectToggle,
}: {
  l: ExplorerLeaf; fav: boolean; favDisabled: boolean
  canMove: boolean; onMove: () => void
  menuOpen: boolean; menuBusy: boolean; onMenuToggle: () => void; onEdit: () => void
  onToggle: (id: string) => void; folderName: string | null; t: T
  dragProps?: DragSourceProps; dragging?: boolean
  /** 다중 선택 진입 — '...' 메뉴 안에만 있다 */
  canSelect?: boolean; onSelect?: () => void
  /** 선택 모드 — 켜지면 카드 전체가 '열기'가 아니라 '고르기'가 된다(링크 오버레이 미렌더) */
  selecting?: boolean; selected?: boolean; onSelectToggle?: () => void
}) {
  const meetingProjectId = meetingLinkOf(l)
  return (
    <article {...dragProps}
      className={`card relative flex flex-col gap-2 p-4 transition-shadow duration-150 hover:shadow-[var(--shadow-md)] ${
        dragProps ? 'cursor-grab select-none active:cursor-grabbing' : ''} ${dragging ? 'opacity-40' : ''}`}>
      {/* 선택 모드에서는 링크를 렌더하지 않는다 — 고르려다 상세로 튕겨 나가면 선택 자체가 불가능하다.
          draggable=false 필수 — 앵커는 기본 draggable 이라 그대로 두면 카드 대신 링크(href)가 끌린다 */}
      {!selecting && (
        <Link draggable={false} href={`/minutes/${l.id}`} aria-label={l.title} className="absolute inset-0 rounded-2xl" />
      )}
      {selecting && (
        <button aria-hidden tabIndex={-1} onClick={onSelectToggle}
          className="absolute inset-0 cursor-pointer rounded-2xl" />
      )}
      <div className="flex items-start gap-1.5">
        {selecting
          ? <SelectBox checked={selected} onToggle={() => onSelectToggle?.()} t={t} />
          : <StarButton id={l.id} fav={fav} disabled={favDisabled} onToggle={onToggle} t={t} />}
        <h4 className="min-w-0 flex-1 truncate pt-0.5 text-sm font-semibold text-ink">{l.title}</h4>
        {canMove && <LeafMenu open={menuOpen} busy={menuBusy} onToggle={onMenuToggle}
          onEdit={onEdit} onMove={onMove} canSelect={canSelect} onSelect={onSelect} t={t} />}
        <span className={`inline-flex shrink-0 justify-center rounded-md px-1.5 py-0.5 text-[11px] font-bold text-white ${teamStyle(l.teamCode).bar}`}>
          {l.teamCode}
        </span>
      </div>
      {(l.projectName || l.meetingCategory || folderName || meetingProjectId) && (
        <div className="flex flex-wrap items-center gap-1.5">
          {l.projectName && (
            <span className="chip bg-brand-weak text-brand">
              <BookOpenText aria-hidden className="h-3 w-3" />{l.projectName}
            </span>
          )}
          {l.meetingCategory && <CategoryChip cat={l.meetingCategory} t={t} />}
          {meetingProjectId && <LinkedMeetingChip projectId={meetingProjectId} t={t} />}
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
  l, fav, favDisabled, canMove, onMove, menuOpen, menuBusy, onMenuToggle, onEdit,
  onToggle, folderName, t, dragProps, dragging, canSelect, onSelect,
  selecting = false, selected = false, onSelectToggle,
}: {
  l: ExplorerLeaf; fav: boolean; favDisabled: boolean
  canMove: boolean; onMove: () => void
  menuOpen: boolean; menuBusy: boolean; onMenuToggle: () => void; onEdit: () => void
  onToggle: (id: string) => void; folderName: string | null; t: T
  dragProps?: DragSourceProps; dragging?: boolean
  /** 다중 선택 진입 — '...' 메뉴 안에만 있다 */
  canSelect?: boolean; onSelect?: () => void
  /** 선택 모드 — 켜지면 카드 전체가 '열기'가 아니라 '고르기'가 된다(링크 오버레이 미렌더) */
  selecting?: boolean; selected?: boolean; onSelectToggle?: () => void
}) {
  const meetingProjectId = meetingLinkOf(l)
  return (
    <li {...dragProps} className={`relative ${dragging ? 'opacity-40' : ''}`}>
      {/* 선택 모드에서는 링크를 렌더하지 않는다(카드와 같은 이유).
          draggable=false 필수 — 앵커는 기본 draggable 이라 그대로 두면 행 대신 링크(href)가 끌린다 */}
      {!selecting && (
        <Link draggable={false} href={`/minutes/${l.id}`} aria-label={l.title} className="absolute inset-0 rounded-lg" />
      )}
      {selecting && (
        <button aria-hidden tabIndex={-1} onClick={onSelectToggle}
          className="absolute inset-0 cursor-pointer rounded-lg" />
      )}
      <div className={`flex items-center gap-3 rounded-lg px-2 py-2.5 transition-colors duration-100 hover:bg-surface-2 ${
        dragProps ? 'cursor-grab select-none active:cursor-grabbing' : ''}`}>
        {selecting
          ? <SelectBox checked={selected} onToggle={() => onSelectToggle?.()} t={t} />
          : <StarButton id={l.id} fav={fav} disabled={favDisabled} onToggle={onToggle} t={t} />}
        <span className={`inline-flex w-12 shrink-0 justify-center rounded-md px-1.5 py-0.5 text-[11px] font-bold text-white ${teamStyle(l.teamCode).bar}`}>
          {l.teamCode}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium text-ink">{l.title}</span>
          {l.bodyPreview && <span className="block truncate text-xs text-ink-subtle">{l.bodyPreview}</span>}
        </span>
        {l.meetingCategory && <span className="hidden shrink-0 sm:inline-flex"><CategoryChip cat={l.meetingCategory} t={t} /></span>}
        {meetingProjectId && (
          <span className="hidden shrink-0 sm:inline-flex">
            <LinkedMeetingChip projectId={meetingProjectId} t={t} />
          </span>
        )}
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
        {canMove && <LeafMenu open={menuOpen} busy={menuBusy} onToggle={onMenuToggle}
          onEdit={onEdit} onMove={onMove} canSelect={canSelect} onSelect={onSelect} t={t} />}
        <span className="w-20 shrink-0 text-right text-xs tabular-nums text-ink-subtle">{l.minuteDate}</span>
      </div>
    </li>
  )
}
