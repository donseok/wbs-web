'use client'
import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  ArrowLeft, ChevronRight, Download, ExternalLink, FolderOpen, History, Maximize2, Minimize2,
  Paperclip, Share2,
} from 'lucide-react'
import type {
  InsightKind, Minute, MinuteFile, MinuteHighlight, MinuteInsight, ProjectMember,
} from '@/lib/domain/types'
import {
  MINUTE_BODY_FILE_MAX, MINUTE_BODY_MAX, sanitizeFileName,
} from '@/lib/domain/minutes'
import {
  getMinuteFileUrl, replaceMinuteBody, deleteMinute, toggleMinuteHighlight,
} from '@/app/actions/minutes'
import {
  createIssueFromMinuteBlock, fetchIssueProjectMembers, prepareMinuteIssueDraft,
  type IssueActionResult, type IssueInput, type MinuteIssueSourceInput,
} from '@/app/actions/issues'
import {
  fnv1a64, isMarkableBlock, minuteBlockDraftText, splitMinuteBlocks, type BlockMarks,
} from '@/lib/minutes/blocks'
import { INS_PRIORITY, hlTier, visibleHighlights, visibleInsights } from '@/lib/minutes/annotations'
import { resolveMinuteSourceBlock, type MinuteSourceAnchor } from '@/lib/minutes/source'
import { compareKoreanName } from '@/lib/domain/nameSort'
import { createBrowserClient } from '@/lib/supabase/client'
import { useLocale } from '@/components/providers/LocaleProvider'
import { useToast } from '@/components/ui/Toast'
import { Modal } from '@/components/ui/Modal'
import { MarkdownView } from './MarkdownView'
import { MinuteMetaModal } from './MinuteMetaModal'
import { MinuteShareModal } from './MinuteShareModal'
import { MinuteChatPanel } from './MinuteChatPanel'
import { MinuteInsightCard } from './MinuteInsightCard'
import { MinuteToc } from './MinuteToc'
import { useMinuteTocSpy } from './useMinuteTocSpy'
import { MinuteBlockPopover, type PopoverState } from './MinuteBlockPopover'
import { MinuteSelectionBubble, type MinuteSelectionTarget } from './MinuteSelectionBubble'
import { MinuteFontSizeControl } from './MinuteFontSizeControl'
import { useMinuteFontSize } from './useMinuteFontSize'
import { MinuteVersionPanel, type MinuteVersionListItem } from './MinuteVersionPanel'
import { MinuteWikiImpactCard, type MinuteWikiImpactCardProps } from './MinuteWikiImpactCard'
import { teamStyle } from '@/components/wbs/shared'
import {
  type IssueMinuteSourceKind,
  type MinuteLinkedIssue,
} from '@/lib/domain/issueMinuteSource'
import {
  buildFallbackMinuteIssueDraft, type MinuteIssueDraft,
} from '@/lib/ai/minute-issue-draft'
import { IssueFormModal, type IssueFormDraft } from '@/components/issues/IssueModals'

const EMPTY_WIKI_IMPACT: MinuteWikiImpactCardProps = {
  status: 'unlinked',
  counts: { created: 0, changed: 0, reaffirmed: 0, conflicted: 0 },
  items: [],
}

/** 이슈 등록의 원천 — 블록 팝오버(블록 전체)와 드래그 선택(부분 발췌)이 같은 상태 기계를 공유한다. */
type IssueOrigin =
  | { type: 'block'; index: number }
  | {
      type: 'selection'
      startIndex: number
      endIndex: number
      startHash: string
      endHash: string
      text: string
      /** 버블이 클라에서 대조해 얻은 서버 파생 발췌 — 미리보기·폴백 초안이 저장 발췌와 일치. */
      excerpt: string
    }

export function MinuteViewer({
  minute, files, canManage, annotations, userId, projects, sourceAnchor = null,
  initialFontSize = null, versions = [], wikiImpact = EMPTY_WIKI_IMPACT,
  historicalVersion = null, issueMembers = [], linkedIssues = [], folderPath = null,
  myProjectIds = null,
}: {
  minute: Minute
  files: MinuteFile[]
  canManage: boolean
  annotations: { highlights: MinuteHighlight[]; insights: MinuteInsight[] }
  userId: string | null
  projects: { id: string; name: string }[]
  sourceAnchor?: MinuteSourceAnchor | null
  initialFontSize?: number | null
  versions?: MinuteVersionListItem[]
  wikiImpact?: MinuteWikiImpactCardProps
  historicalVersion?: { id: string; versionNo: number } | null
  issueMembers?: ProjectMember[]
  linkedIssues?: MinuteLinkedIssue[]
  /** 소속 폴더의 root-first 경로명. null = 미분류이거나 경로 해석 실패(둘은 렌더에서 구분). */
  folderPath?: string[] | null
  /** 내가 멤버로 등록된 프로젝트 id — 수정 모달의 프로젝트 기본 선택 근거. */
  myProjectIds?: string[] | null
}) {
  const router = useRouter()
  const { t } = useLocale()
  const { toast } = useToast()
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [metaOpen, setMetaOpen] = useState(false)
  const [shareOpen, setShareOpen] = useState(false)
  const [focus, setFocus] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const fs = useMinuteFontSize({ initial: initialFontSize })
  const bodyFile = historicalVersion ? null : files.find(f => f.role === 'body') ?? null
  const attachments = historicalVersion ? [] : files.filter(f => f.role === 'attachment')
  // breadcrumb 세그먼트 — 루트가 팀 코드면 접는다. 바로 왼쪽 배지가 이미 같은 글자를
  // 보여주고 있어 'MES [MES › 생산계획]' 이 되고, 한 행에 넣으면 그 폭이 제목을 밀어낸다.
  // 팀 루트에 바로 꽂힌 회의록(경로 1칸)은 접으면 남는 게 없으므로 그대로 둔다.
  const pathSegments = folderPath && folderPath.length > 0
    ? (folderPath.length > 1 && folderPath[0] === minute.teamCode ? folderPath.slice(1) : folderPath)
    : null
  // 잘린 세그먼트는 hover 로 전체 경로를 확인한다 — 접은 팀 루트까지 포함한 원본을 쓴다.
  const pathTitle = folderPath && folderPath.length > 0 ? folderPath.join(' / ') : undefined

  const bodyRef = useRef<HTMLDivElement>(null)
  const [popover, setPopover] = useState<PopoverState | null>(null)
  const [hlBusy, setHlBusy] = useState(false)
  const [issueOrigin, setIssueOrigin] = useState<IssueOrigin | null>(null)
  const [issueFormOpen, setIssueFormOpen] = useState(false)
  const [projectPickerOpen, setProjectPickerOpen] = useState(false)
  const [issueProjectId, setIssueProjectId] = useState(
    minute.projectId ?? minute.meetingProjectId ?? '',
  )
  const [issueMemberOptions, setIssueMemberOptions] = useState<ProjectMember[]>(issueMembers)
  const [preparedIssueDraft, setPreparedIssueDraft] = useState<MinuteIssueDraft | null>(null)
  const [issueBusy, setIssueBusy] = useState(false)
  const [issueProjectError, setIssueProjectError] = useState<string | null>(null)
  const issueProjectRequestRef = useRef(0)
  // 선택 흐름 prepare 의 진행 중 여부 — issueBusy 상태로 판정하면 안 된다. 성공 연속 코드의
  // removeAllRanges 가 만든 selectionchange 는 React 커밋보다 먼저 실행될 수 있어, 그 시점의
  // 클로저는 아직 busy=true 로 보이고 dismiss 취소가 방금 연 폼의 origin 을 지워
  // issueFormOpen=true·issueBlock=null 유령 상태(폼 미렌더 + 버블 영구 비활성)를 만든다.
  const issuePrepareInFlightRef = useRef(false)

  const blocks = useMemo(() => splitMinuteBlocks(minute.bodyMd), [minute.bodyMd])
  const { activeToc, jumpTo } = useMinuteTocSpy(blocks, bodyRef, { flash: true })
  const bodyHash = useMemo(() => fnv1a64(minute.bodyMd), [minute.bodyMd])
  const currentVersion = useMemo(
    () => [...versions].sort((a, b) => b.versionNo - a.versionNo)[0] ?? null,
    [versions],
  )
  const sourceBlockIndex = useMemo(
    () => sourceAnchor ? resolveMinuteSourceBlock(blocks, bodyHash, sourceAnchor) : null,
    [blocks, bodyHash, sourceAnchor],
  )
  const attemptedSourceRef = useRef<string | null>(null)

  useEffect(() => {
    if (!sourceAnchor) {
      attemptedSourceRef.current = null
      return
    }
    const sourceKey = [
      minute.id, bodyHash, sourceAnchor.bodyHash, sourceAnchor.blockIndex, sourceAnchor.blockHash,
    ].join(':')
    if (attemptedSourceRef.current === sourceKey) return

    if (sourceBlockIndex === null) {
      attemptedSourceRef.current = sourceKey
      toast({ title: t('min.source.missing'), variant: 'info' })
      return
    }
    // Strict Mode의 effect setup→cleanup→setup에서도 첫 frame 취소 뒤 두 번째 setup이 다시 예약되게,
    // 실제 점프가 실행된 뒤에만 완료 키를 기록한다.
    const frame = requestAnimationFrame(() => {
      jumpTo(sourceBlockIndex)
      const target = bodyRef.current?.querySelector<HTMLElement>(`[data-mblock="${sourceBlockIndex}"]`)
      if (target) {
        target.tabIndex = -1
        target.focus({ preventScroll: true })
      }
      attemptedSourceRef.current = sourceKey
    })
    return () => cancelAnimationFrame(frame)
  }, [bodyHash, jumpTo, minute.id, sourceAnchor, sourceBlockIndex, t, toast])

  // 낙관적 병합 계약(스펙 §6.4): 내 하이라이트는 로컬 단독 소유(서버 prop 은 초기값),
  // 타인 하이라이트는 항상 서버 prop 파생 — revalidate 가 와도 이중 계산/역전 없음.
  const [myIndexes, setMyIndexes] = useState<Set<number>>(() => new Set(
    visibleHighlights(annotations.highlights, blocks)
      .filter(h => h.createdBy === userId).map(h => h.blockIndex),
  ))
  const others = useMemo(
    () => visibleHighlights(annotations.highlights, blocks).filter(h => h.createdBy !== userId),
    [annotations.highlights, blocks, userId],
  )
  const insights = useMemo(
    () => visibleInsights(annotations.insights, blocks, bodyHash),
    [annotations.insights, blocks, bodyHash],
  )
  const issueAnchorIndex = issueOrigin === null
    ? null
    : issueOrigin.type === 'block' ? issueOrigin.index : issueOrigin.startIndex
  const issueBlock = issueAnchorIndex === null ? null : blocks[issueAnchorIndex] ?? null
  const issueInsight = useMemo(() => {
    if (issueOrigin?.type !== 'block') return null
    const candidates = insights.filter(i =>
      i.blockIndex === issueOrigin.index && (i.kind === 'risk' || i.kind === 'action'))
    return candidates.find(i => i.kind === 'risk') ?? candidates.find(i => i.kind === 'action') ?? null
  }, [insights, issueOrigin])
  const issueSourceText = issueOrigin?.type === 'selection'
    ? issueOrigin.excerpt
    : issueBlock ? minuteBlockDraftText(issueBlock) : ''
  const issueDraft = useMemo<IssueFormDraft | undefined>(() => {
    if (!issueBlock || !issueSourceText) return undefined
    const draft = preparedIssueDraft
      ?? buildFallbackMinuteIssueDraft(
        issueSourceText,
        issueOrigin?.type === 'block' ? issueInsight?.label : null,
      )
    if (!draft) return undefined
    return {
      ...draft,
      // AI 초안 스키마의 majorProcess 를 폼 입력 정본(majorName)으로 경계에서 변환한다.
      majorName: draft.majorProcess,
      severity: 'medium',
      assigneeMemberIds: [],
      startDate: null,
      dueDate: null,
    }
  }, [issueBlock, issueInsight, issueOrigin, issueSourceText, preparedIssueDraft])

  const marks = useMemo<BlockMarks>(() => {
    const m: BlockMarks = {}
    for (const i of insights) {
      const k = i.kind as InsightKind
      const cur = m[i.blockIndex]?.ins
      // 복수 kind 는 우선순위 최상위 1개만 인라인 표시(스펙 §6.3)
      if (!cur || INS_PRIORITY.indexOf(k) < INS_PRIORITY.indexOf(cur)) {
        m[i.blockIndex] = { ...m[i.blockIndex], ins: k }
      }
    }
    const counts = new Map<number, Set<string>>()
    for (const h of others) {
      if (!counts.has(h.blockIndex)) counts.set(h.blockIndex, new Set())
      counts.get(h.blockIndex)!.add(h.createdBy)
    }
    for (const idx of myIndexes) {
      if (!counts.has(idx)) counts.set(idx, new Set())
      counts.get(idx)!.add('me')
    }
    for (const [idx, users] of counts) {
      m[idx] = { ...m[idx], hlTier: hlTier(users.size), hlCount: users.size }
    }
    return m
  }, [insights, others, myIndexes])

  // 블록 클릭 → 팝오버 (이벤트 위임 — 링크/버튼/드래그 선택 제외, 스펙 §6.4)
  const onBodyClick = useCallback((e: React.MouseEvent) => {
    const target = e.target as HTMLElement
    if (target.closest('a, button')) return
    if (window.getSelection()?.toString()) return
    const blockEl = target.closest<HTMLElement>('[data-mblock]')
    if (!blockEl) return
    const idx = Number(blockEl.dataset.mblock)
    if (!blocks[idx] || !isMarkableBlock(blocks[idx])) return
    const r = blockEl.getBoundingClientRect()
    setPopover({ blockIndex: idx, rect: { top: r.top, bottom: r.bottom, left: r.left, width: r.width } })
  }, [blocks])

  async function onToggleHighlight() {
    if (!popover) return
    const idx = popover.blockIndex
    const wasOn = myIndexes.has(idx)
    const rollback = () =>
      setMyIndexes(prev => { const s = new Set(prev); if (wasOn) s.add(idx); else s.delete(idx); return s })
    // 낙관적 업데이트 → 실패/예외 시 롤백 + 토스트
    setMyIndexes(prev => { const s = new Set(prev); if (wasOn) s.delete(idx); else s.add(idx); return s })
    setHlBusy(true)
    try {
      const res = await toggleMinuteHighlight(minute.id, idx, blocks[idx].hash)
      if (!res.ok) {
        rollback()
        toast({ title: t('min.hl.failed'), description: res.error, variant: 'error' })
      }
    } catch {
      // 네트워크 드롭·500·직렬화 오류 등 reject 경로 — busy 고착·팝오버 잔존·미롤백 방지(스펙 §6.4)
      rollback()
      toast({ title: t('min.hl.failed'), variant: 'error' })
    } finally {
      setHlBusy(false)
      setPopover(null)
    }
  }

  /** 블록의 인사이트 파생 kind·라벨 — 소스 빌더와 폴백 초안이 공유한다. */
  function blockInsightAt(index: number) {
    const candidates = insights.filter(insight =>
      insight.blockIndex === index && (insight.kind === 'risk' || insight.kind === 'action'))
    const insight = candidates.find(candidate => candidate.kind === 'risk')
      ?? candidates.find(candidate => candidate.kind === 'action')
      ?? null
    const kind: IssueMinuteSourceKind = insight?.kind === 'risk'
      ? 'risk'
      : insight?.kind === 'action' ? 'action' : 'manual'
    return { insight, kind }
  }

  /** 초안 준비(prepare)와 최종 저장(create)이 같은 원문 앵커를 쓰도록 원천에서 소스를 만든다. */
  function issueSourceInputFor(origin: IssueOrigin): MinuteIssueSourceInput | null {
    if (!currentVersion) return null
    if (origin.type === 'block') {
      const block = blocks[origin.index]
      if (!block) return null
      return {
        minuteId: minute.id,
        minuteVersionId: currentVersion.id,
        bodyHash,
        blockIndex: block.index,
        blockHash: block.hash,
        kind: blockInsightAt(origin.index).kind,
      }
    }
    const start = blocks[origin.startIndex]
    const end = blocks[origin.endIndex]
    if (!start || !end) return null
    return {
      minuteId: minute.id,
      minuteVersionId: currentVersion.id,
      bodyHash,
      blockIndex: start.index,
      blockHash: start.hash,
      kind: 'manual',
      selection: { text: origin.text, endBlockIndex: end.index, endBlockHash: end.hash },
    }
  }

  function issueContextFor(origin: IssueOrigin) {
    const source = issueSourceInputFor(origin)
    if (!source) return null
    if (origin.type === 'selection') {
      return { source, fallback: buildFallbackMinuteIssueDraft(origin.excerpt, null) }
    }
    const block = blocks[origin.index]
    if (!block) return null
    return {
      source,
      fallback: buildFallbackMinuteIssueDraft(
        minuteBlockDraftText(block),
        blockInsightAt(origin.index).insight?.label,
      ),
    }
  }

  async function beginIssueCreateFrom(origin: IssueOrigin) {
    const requestId = ++issueProjectRequestRef.current
    setIssueBusy(false)
    if (!currentVersion) {
      toast({ title: t('min.issue.versionMissing'), variant: 'error' })
      setPopover(null)
      return
    }
    const context = issueContextFor(origin)
    if (!context) {
      toast({ title: t('min.issue.versionMissing'), variant: 'error' })
      setPopover(null)
      return
    }
    setIssueOrigin(origin)
    setPreparedIssueDraft(null)
    setIssueProjectError(null)
    const fixedProjectId = minute.projectId ?? minute.meetingProjectId ?? ''
    if (fixedProjectId) {
      setIssueProjectId(fixedProjectId)
      setIssueMemberOptions(issueMembers)
      setIssueBusy(true)
      issuePrepareInFlightRef.current = true
      try {
        const result = await prepareMinuteIssueDraft(fixedProjectId, context.source)
        if (issueProjectRequestRef.current !== requestId) return
        if (!result.ok || !result.draft) {
          toast({
            title: t('min.issue.prepareFailed'),
            description: result.error,
            variant: 'error',
          })
          setIssueOrigin(null)
          setPopover(null)
          return
        }
        setPreparedIssueDraft(result.draft)
      } catch {
        if (issueProjectRequestRef.current !== requestId) return
        // 네트워크 단절은 원문 검증 실패와 다르다. 로컬 결정형 초안으로 편집 흐름을 계속한다.
        if (!context.fallback) {
          toast({
            title: t('min.issue.draftUnavailable'),
            variant: 'error',
          })
          setIssueOrigin(null)
          setPopover(null)
          return
        }
        setPreparedIssueDraft(context.fallback)
        toast({ title: t('min.issue.fallbackUsed'), variant: 'info' })
      } finally {
        // requestId 가 낡았다면 취소 주체가 이미 정리했다 — 새 요청의 플래그를 건드리지 않는다.
        if (issueProjectRequestRef.current === requestId) {
          issuePrepareInFlightRef.current = false
          setIssueBusy(false)
        }
      }
      if (issueProjectRequestRef.current !== requestId) return
      setPopover(null)
      // 선택 흐름은 폼이 열리면 선택을 해제해 버블을 정리한다(블록 흐름에는 영향 없음).
      window.getSelection()?.removeAllRanges()
      setIssueFormOpen(true)
      return
    }
    setPopover(null)
    window.getSelection()?.removeAllRanges()
    setIssueProjectId('')
    setIssueMemberOptions([])
    setProjectPickerOpen(true)
  }

  function beginIssueCreate() {
    if (!popover) return
    void beginIssueCreateFrom({ type: 'block', index: popover.blockIndex })
  }

  function onSelectionIssue(target: MinuteSelectionTarget) {
    if (!target.excerpt) return
    void beginIssueCreateFrom({ type: 'selection', ...target })
  }

  // 선택 흐름의 prepare 진행 중 사용자가 버블을 떠나면(바깥 클릭·선택 해제) 요청을 취소해
  // 뒤늦게 도착한 응답이 이슈 폼을 돌발 오픈하지 않게 한다(팝오버 onClose 와 같은 원칙).
  function onSelectionDismiss() {
    // 진행 중 판정은 동기 ref 로만 한다 — selectionchange 가 커밋을 앞지르면 issueBusy
    // 클로저는 낡은 true 라서, 완료된 요청을 취소하며 방금 연 폼의 origin 을 지운다.
    if (!issuePrepareInFlightRef.current || issueOrigin?.type !== 'selection') return
    if (issueFormOpen || projectPickerOpen) return
    issuePrepareInFlightRef.current = false
    issueProjectRequestRef.current += 1
    setIssueBusy(false)
    setPreparedIssueDraft(null)
    setIssueOrigin(null)
  }

  async function continueWithProject() {
    if (!issueProjectId) {
      setIssueProjectError(t('min.issue.projectRequired'))
      return
    }
    const requestedProjectId = issueProjectId
    const requestId = ++issueProjectRequestRef.current
    setIssueBusy(true)
    setIssueProjectError(null)
    if (issueOrigin === null) {
      setIssueProjectError(t('min.issue.versionMissing'))
      setIssueBusy(false)
      return
    }
    const context = issueContextFor(issueOrigin)
    if (!context) {
      setIssueProjectError(t('min.issue.versionMissing'))
      setIssueBusy(false)
      return
    }
    try {
      const [membersResult, draftResult] = await Promise.allSettled([
        fetchIssueProjectMembers(requestedProjectId),
        prepareMinuteIssueDraft(requestedProjectId, context.source),
      ])
      if (issueProjectRequestRef.current !== requestId) return
      if (membersResult.status === 'rejected' || !membersResult.value.ok) {
        setIssueProjectError(
          membersResult.status === 'fulfilled'
            ? membersResult.value.error ?? t('min.issue.membersFailed')
            : t('min.issue.membersFailed'),
        )
        return
      }
      if (draftResult.status === 'fulfilled' && (!draftResult.value.ok || !draftResult.value.draft)) {
        setIssueProjectError(draftResult.value.error ?? t('min.issue.prepareFailed'))
        return
      }
      if (draftResult.status === 'rejected') {
        if (!context.fallback) {
          setIssueProjectError(
            t('min.issue.draftUnavailable'),
          )
          return
        }
        toast({ title: t('min.issue.fallbackUsed'), variant: 'info' })
      }
      const draft = draftResult.status === 'fulfilled' ? draftResult.value.draft! : context.fallback!
      setIssueProjectId(requestedProjectId)
      setIssueMemberOptions(membersResult.value.members ?? [])
      setPreparedIssueDraft(draft)
      setProjectPickerOpen(false)
      setIssueFormOpen(true)
    } catch {
      if (issueProjectRequestRef.current !== requestId) return
      setIssueProjectError(t('min.issue.membersFailed'))
    } finally {
      if (issueProjectRequestRef.current === requestId) setIssueBusy(false)
    }
  }

  function closeProjectPicker() {
    issueProjectRequestRef.current += 1
    setIssueBusy(false)
    setProjectPickerOpen(false)
    setPreparedIssueDraft(null)
    setIssueOrigin(null)
  }

  function createLinkedIssue(projectId: string, input: IssueInput) {
    if (!issueOrigin || !currentVersion) {
      return Promise.resolve({ ok: false, error: t('min.issue.versionMissing') })
    }
    const source = issueSourceInputFor(issueOrigin)
    if (!source) {
      return Promise.resolve({ ok: false, error: t('min.issue.versionMissing') })
    }
    return createIssueFromMinuteBlock(projectId, input, source)
  }

  function closeIssueForm() {
    setIssueFormOpen(false)
    setPreparedIssueDraft(null)
    setIssueOrigin(null)
  }

  function onIssueCreated(_id: string, result: IssueActionResult) {
    toast({
      title: t('min.issue.created'),
      description: result.piIssueCode
        ? t('min.issue.createdCode').replace('{code}', result.piIssueCode)
        : t('min.issue.createdDesc'),
      variant: 'success',
    })
  }

  // 원본 파일이 없는 회의록 — 본문 마크다운을 그대로 .md 파일로 내려받는다(클라이언트 Blob, 서버 왕복 없음)
  function downloadBodyMd() {
    // OS 파일명 금지 문자만 치환 — 한글 등 유니코드는 download 속성에서 그대로 허용
    const safeTitle = minute.title.replace(/[\\/:*?"<>|]/g, '_').trim() || t('nav.minutes')
    const blob = new Blob([minute.bodyMd], { type: 'text/markdown;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${minute.minuteDate} ${safeTitle} 내용.md`
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
  }

  async function download(fileId: string) {
    setBusy(true)
    const res = await getMinuteFileUrl(fileId)
    setBusy(false)
    if (res.ok && res.url) {
      window.open(res.url, '_blank', 'noopener,noreferrer')
      setErr(null)
    } else {
      setErr(res.error ?? t('min.err.download'))
    }
  }

  async function onReplaceBody(e: ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]
    e.target.value = ''
    if (!f) return
    setErr(null)
    if (!/\.(md|markdown)$/i.test(f.name)) { setErr(t('min.err.bodyExt')); return }
    if (f.size > MINUTE_BODY_FILE_MAX) { setErr(t('min.err.bodyFileMax')); return }
    const text = await f.text()
    if (text.length > MINUTE_BODY_MAX) { setErr(t('min.err.bodyMax')); return }
    setBusy(true)
    try {
      const sb = createBrowserClient()
      const path = `${minute.id}/${Date.now()}-${sanitizeFileName(f.name)}`
      const up = await sb.storage.from('minutes').upload(path, f, { upsert: false })
      if (up.error) { setErr(`${t('min.err.upload')}: ${up.error.message}`); return }
      const res = await replaceMinuteBody(minute.id, text, {
        fileName: f.name, filePath: path, size: f.size, mime: f.type || 'text/markdown',
      })
      if (!res.ok) { await sb.storage.from('minutes').remove([path]); setErr(res.error ?? t('min.err.upload')); return }
      if (res.timeFix) {
        toast({
          title: t('min.timeFix.title'),
          description: `${t('min.timeFix.desc')}: ${res.timeFix.from} → ${res.timeFix.to}`,
          variant: 'info',
        })
      }
      router.refresh()
    } finally { setBusy(false) }
  }

  async function onDelete() {
    setBusy(true)
    const res = await deleteMinute(minute.id)
    setBusy(false)
    if (!res.ok) { setErr(res.error ?? 'error'); return }
    router.push('/minutes')
  }

  // 같은 문장을 하이라이트한 사람 명단 — 하이라이트를 누른 시각순이 아니라 가나다순으로 보여준다.
  const popNames = popover
    ? [...new Set(others.filter(h => h.blockIndex === popover.blockIndex)
        .map(h => h.createdByName ?? '이름 없음'))].sort(compareKoreanName)
    : []
  const popKinds = popover
    ? [...new Set(insights.filter(i => i.blockIndex === popover.blockIndex).map(i => i.kind as InsightKind))]
    : []
  const popLinkedIssues = popover && currentVersion
    ? linkedIssues.filter(link =>
      link.minuteVersionId === currentVersion.id
      && link.bodyHash === bodyHash
      && link.blockIndex === popover.blockIndex
      && link.blockHash === blocks[popover.blockIndex]?.hash)
    : []

  return (
    // 폭은 레이아웃 main(헤더와 동일 px 스케일)에 맡긴다 — 자체 max-w/패딩을 두면 헤더 기준선보다 안쪽으로 좁아짐
    // xl↑는 뷰포트 높이에 고정하고 본문 카드가 자체 스크롤 — 메타 헤더·채팅 패널은 스크롤과 무관하게 상주
    <div className="flex flex-col gap-3 xl:h-full xl:min-h-0">
      {/* 메타 헤더 — 메타·액션 단일 행(접기 없음). 좁은 폭에서만 wrap */}
      <div className="card shrink-0 space-y-2 px-4 py-2">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <Link href="/minutes" className="inline-flex items-center gap-1 text-sm text-ink-muted hover:text-ink">
            <ArrowLeft className="h-4 w-4" />{t('min.detail.back')}
          </Link>
          {/* 편철 위치 — 팀 배지와 경로를 테두리 있는 한 덩어리 칩으로 묶어 메타 행 맨 앞에 둔다.
              이전엔 배지·경로가 따로 놀고 경로가 잔글씨(ink-subtle)라 옆 메타에 묻혔다.
              별도 줄로 빼지 않는 이유는 90627c7 — 헤더가 두 줄로 커진다.
              표시 전용 링크 아님 — 탐색기가 아직 폴더 딥링크(?folder=)를 받지 않는다. */}
          <div className={`inline-flex min-w-0 max-w-[22rem] items-center gap-1.5 rounded-full border py-1 pl-1 pr-2.5 shadow-sm ${
            pathSegments ? 'border-line-strong bg-surface' : 'border-dashed border-line-strong bg-surface/60'}`}>
            <span className={`inline-flex shrink-0 rounded-full px-2 py-0.5 text-[11px] font-bold text-white ${teamStyle(minute.teamCode).bar}`}>
              {minute.teamCode}
            </span>
            <nav aria-label={t('min.detail.pathAria')} title={pathTitle}
              className="flex min-w-0 items-center gap-1 text-xs">
              <FolderOpen aria-hidden className={`h-3.5 w-3.5 shrink-0 ${pathSegments ? 'text-brand' : 'text-ink-subtle'}`} />
              {pathSegments ? (
                pathSegments.map((seg, i) => (
                  <span key={`${i}-${seg}`} className="flex min-w-0 items-center gap-1">
                    {i > 0 && <ChevronRight aria-hidden className="h-3 w-3 shrink-0 text-ink-subtle" />}
                    {/* 현재 위치(마지막 칸)는 줄이지 않고 조상부터 줄인다 — 어디에 있는지가 먼저다 */}
                    <span className={i === pathSegments.length - 1
                      ? 'max-w-[11rem] shrink-0 truncate font-semibold text-ink'
                      : 'truncate text-ink-muted'}>
                      {seg}
                    </span>
                  </span>
                ))
              ) : (
                // folderId 가 있는데 경로가 없다 = 조회 실패이거나 끊긴 체인. '미분류'로 위장하지 않는다.
                <span className={`truncate ${minute.folderId ? 'font-medium text-delayed' : 'text-ink-subtle'}`}>
                  {minute.folderId ? t('min.detail.pathUnknown') : t('min.fold.unfiled')}
                </span>
              )}
            </nav>
          </div>
          <span className="text-sm tabular-nums text-ink-muted">{minute.minuteDate}</span>
          <h1 className="min-w-0 flex-1 truncate text-lg font-bold text-ink">{minute.title}</h1>

          <div className="flex flex-wrap items-center justify-end gap-x-2 gap-y-1">
            {bodyFile ? (
              <button onClick={() => void download(bodyFile.id)} disabled={busy} className="btn h-8 px-2.5 text-xs">
                <Download className="h-3.5 w-3.5" />{t('min.detail.download')}
              </button>
            ) : (
              <button onClick={downloadBodyMd} className="btn h-8 px-2.5 text-xs">
                <Download className="h-3.5 w-3.5" />{t('min.detail.downloadBody')}
              </button>
            )}
            {attachments.map(f => (
              <button key={f.id} onClick={() => void download(f.id)} disabled={busy}
                className="btn h-8 max-w-[10rem] px-2.5 text-xs">
                <Paperclip className="h-3.5 w-3.5 shrink-0" /><span className="truncate">{f.fileName}</span>
              </button>
            ))}
            {minute.meetingId && minute.meetingProjectId && (
              <Link href={`/p/${minute.meetingProjectId}/meetings`}
                className="inline-flex items-center gap-1 text-xs text-brand underline underline-offset-2 hover:text-brand-hover">
                <ExternalLink className="h-3.5 w-3.5" />{t('min.detail.linkedMeeting')}
              </Link>
            )}
            {canManage && (
              <>
                <button onClick={() => setShareOpen(true)} className="btn h-8 px-2.5 text-xs">
                  <Share2 className="h-3.5 w-3.5" />{t('min.share.button')}
                </button>
                <button onClick={() => setMetaOpen(true)} className="btn h-8 px-2.5 text-xs">{t('min.detail.edit')}</button>
                <label className="btn h-8 cursor-pointer px-2.5 text-xs">
                  {t('min.detail.replaceBody')}
                  <input type="file" accept=".md,.markdown" className="hidden" onChange={onReplaceBody} />
                </label>
                <button onClick={() => setConfirmOpen(true)} className="btn h-8 px-2.5 text-xs text-delayed">
                  {t('min.detail.delete')}
                </button>
              </>
            )}
            <span className="text-xs text-ink-subtle">{minute.createdByName ?? ''}</span>
            <MinuteFontSizeControl
              size={fs.size} onDec={fs.dec} onInc={fs.inc} onReset={fs.reset}
              canDec={fs.canDec} canInc={fs.canInc}
            />
            <button onClick={() => setFocus(f => !f)}
              title={focus ? t('min.focus.off') : t('min.focus.on')}
              aria-label={focus ? t('min.focus.off') : t('min.focus.on')} aria-pressed={focus}
              className={`inline-flex items-center gap-1 text-xs ${focus ? 'text-brand' : 'text-ink-muted hover:text-ink'}`}>
              {focus ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
              {t('min.focus.on')}
            </button>
          </div>
        </div>
        {err && <p className="text-sm text-delayed">{err}</p>}
      </div>

      {historicalVersion && (
        <div className="card flex shrink-0 flex-wrap items-center gap-2 border-brand/30 bg-brand-weak/35 px-4 py-2">
          <History className="h-4 w-4 text-brand" aria-hidden />
          <p className="text-sm font-medium text-ink">
            {t('min.version.viewingBanner').replace('{n}', String(historicalVersion.versionNo))}
          </p>
          <Link href={`/minutes/${minute.id}`} className="ml-auto text-xs font-medium text-brand hover:text-brand-hover">
            {t('min.version.backCurrent')}
          </Link>
        </div>
      )}
      {minute.archivedAt && !historicalVersion && (
        <div className="card flex shrink-0 items-center gap-2 border-line-strong bg-surface-2 px-4 py-2">
          <History className="h-4 w-4 text-ink-muted" aria-hidden />
          <p className="text-sm font-medium text-ink">{t('min.archive.banner')}</p>
        </div>
      )}

      {/* 핵심 요약 카드 — shrink-0 유지(xl 높이 체인) */}
      {!historicalVersion && (
        <MinuteInsightCard
          minuteId={minute.id} insights={annotations.insights} highlights={annotations.highlights}
          blocks={blocks} bodyHash={bodyHash} onJump={jumpTo}
          details={
            <>
              <MinuteVersionPanel
                versions={versions}
                currentVersionNo={versions[0]?.versionNo ?? null}
                embedded
              />
              <MinuteWikiImpactCard {...wikiImpact} embedded />
            </>
          }
        />
      )}

      {/* 과거 버전에서는 핵심 요약을 숨기므로 버전 이동 패널만 기존 위치에 유지한다. */}
      {historicalVersion && (
        <MinuteVersionPanel
          versions={versions}
          currentVersionNo={versions[0]?.versionNo ?? null}
          selectedVersionNo={historicalVersion?.versionNo ?? null}
        />
      )}

      {/* xl 미만 목차 아코디언은 MinuteToc 내부에서 분기 렌더 */}
      {/* 목차 + 본문 + (Task 17: 우측 채팅 패널) */}
      <div className="flex flex-col gap-3 xl:min-h-0 xl:flex-1 xl:flex-row">
        {/* 집중 모드 — 목차·채팅을 숨겨 본문이 전체 폭 사용 */}
        {!focus && (
          <MinuteToc
            blocks={blocks} insights={insights} highlights={annotations.highlights}
            onJump={jumpTo} activeIndex={activeToc}
          />
        )}
        {/* 글자크기는 CSS 변수로만 내려보낸다 — MarkdownView props 가 그대로여야 재파싱이 없다(스펙 §3) */}
        <div ref={bodyRef} onClick={historicalVersion || minute.archivedAt ? undefined : onBodyClick} className="card min-w-0 flex-1 p-4 xl:overflow-y-auto"
          style={{ '--minutes-fs': `${fs.size}px` } as React.CSSProperties}>
          <MarkdownView content={minute.bodyMd} marks={marks} />
        </div>
        {!focus && !historicalVersion && !minute.archivedAt && <MinuteChatPanel minuteId={minute.id} />}
      </div>

      {popover && (
        <MinuteBlockPopover
          state={popover} mine={myIndexes.has(popover.blockIndex)}
          names={popNames} insKinds={popKinds} busy={hlBusy || issueBusy}
          linkedIssues={popLinkedIssues} issueBusy={issueBusy}
          canCreateIssue={!blocks[popover.blockIndex]?.headingDepth}
          onToggle={() => void onToggleHighlight()}
          onCreateIssue={() => void beginIssueCreate()}
          onClose={() => {
            if (issueBusy) {
              issueProjectRequestRef.current += 1
              setIssueBusy(false)
              setPreparedIssueDraft(null)
              setIssueOrigin(null)
            }
            setPopover(null)
          }}
        />
      )}

      {!historicalVersion && !minute.archivedAt && (
        <MinuteSelectionBubble
          bodyRef={bodyRef}
          blocks={blocks}
          disabled={issueFormOpen || projectPickerOpen}
          busy={issueBusy}
          onCreateIssue={onSelectionIssue}
          onDismiss={onSelectionDismiss}
        />
      )}

      <Modal
        open={projectPickerOpen}
        onClose={closeProjectPicker}
        title={t('min.issue.projectTitle')}
        size="sm"
        footer={
          <div className="flex w-full justify-end gap-2">
            <button
              onClick={closeProjectPicker}
              className="btn btn-ghost text-xs"
            >
              {t('common.cancel')}
            </button>
            <button onClick={() => void continueWithProject()} disabled={issueBusy} className="btn btn-primary text-xs">
              {issueBusy ? t('min.issue.summarizing') : t('min.issue.continue')}
            </button>
          </div>
        }
      >
        <div className="space-y-3">
          <p className="text-sm leading-6 text-ink-muted">{t('min.issue.projectDesc')}</p>
          <label className="block">
            <span className="mb-1.5 block text-xs font-semibold text-ink-muted">{t('min.form.project')}</span>
            <select
              className="app-input"
              value={issueProjectId}
              disabled={issueBusy}
              onChange={e => {
                issueProjectRequestRef.current += 1
                setIssueProjectId(e.target.value)
                setIssueProjectError(null)
              }}
            >
              <option value="">{t('min.form.projectNone')}</option>
              {projects.map(project => (
                <option key={project.id} value={project.id}>{project.name}</option>
              ))}
            </select>
          </label>
          {issueProjectError && <p className="text-sm text-delayed">{issueProjectError}</p>}
        </div>
      </Modal>

      {issueBlock && (
        <IssueFormModal
          open={issueFormOpen}
          onClose={closeIssueForm}
          projectId={issueProjectId}
          initial={null}
          members={issueMemberOptions}
          draft={issueDraft}
          sourcePreview={{
            // 링크에 저장될 불변 버전 메타를 그대로 미리 보여 줘, 메타데이터만
            // 수정된 회의록에서도 확인 카드와 생성 후 상세의 출처명이 어긋나지 않는다.
            title: currentVersion?.title ?? minute.title,
            date: currentVersion?.minuteDate ?? minute.minuteDate,
            excerpt: issueSourceText,
            label: `${issueOrigin?.type === 'selection'
              ? t('min.sel.sourceLabel')
              : t('min.issue.sourceLabel')} · v${currentVersion?.versionNo ?? 1}`,
            organizedDraft: true,
            classificationRecommended: preparedIssueDraft?.mode === 'ai'
              && Boolean(preparedIssueDraft.megaCode && preparedIssueDraft.subProcess),
          }}
          onCreate={createLinkedIssue}
          onCreated={onIssueCreated}
        />
      )}

      {/* 열 때마다 리마운트 — 이전 입력·회의 선택이 잔존하지 않게 현재 회의록 값으로 초기화 */}
      {metaOpen && (
        <MinuteMetaModal open onClose={() => setMetaOpen(false)} onSaved={() => { setMetaOpen(false); router.refresh() }}
          minute={minute} projects={projects} myProjectIds={myProjectIds} />
      )}

      <MinuteShareModal open={shareOpen} onClose={() => setShareOpen(false)} minuteId={minute.id} />

      <Modal open={confirmOpen} onClose={() => setConfirmOpen(false)} title={t('min.detail.delete')} size="sm"
        footer={
          <div className="flex justify-end gap-2">
            <button onClick={() => setConfirmOpen(false)} className="btn">{t('common.cancel')}</button>
            <button onClick={() => { setConfirmOpen(false); void onDelete() }} disabled={busy} className="btn text-delayed">
              {t('min.detail.delete')}
            </button>
          </div>
        }>
        <p className="text-sm text-ink">{t('min.detail.deleteConfirm')}</p>
      </Modal>
    </div>
  )
}
