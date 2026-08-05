'use server'
// 이슈 쓰기 액션 — 전부 프로젝트 역할 가드 fail-closed. RLS 는 "멤버면 수정 가능" 백스톱까지만
// 보장하므로(0041 헤더 참조) 진행 필드 vs 전체 편집의 세분화는 여기서 강제한다.
// updated_at 트리거 없음 — 모든 update 페이로드에 수동 포함(레포 관례).
import { createServerClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getSession } from '@/lib/auth'
import { getActor, requireProjectAdmin, requireProjectMember, resolveProjectId } from '@/lib/authz'
import { revalidatePath } from 'next/cache'
import { displayNameFrom } from '@/lib/domain/display-name'
import {
  ISSUE_SEVERITIES, canTransition, nextResolvedAt,
  type IssueSeverity, type IssueStatus,
} from '@/lib/domain/issues'
import {
  isIssueMegaCode,
  normalizeIssueAnalysisInput,
  type IssueAnalysisInput,
  type IssueMajorProcess,
  type IssueMegaCode,
  type NormalizedIssueAnalysisInput,
} from '@/lib/domain/issueAnalysis'
import {
  ISSUE_MINUTE_SOURCE_KINDS,
  makeMinuteIssueSourceKey,
  validateIssueDateRange,
  type IssueMinuteSourceKind,
} from '@/lib/domain/issueMinuteSource'
import {
  fnv1a64, isMarkableBlock, minuteBlockDraftText, splitMinuteBlocks, type MinuteBlock,
} from '@/lib/minutes/blocks'
import {
  MINUTE_SELECTION_MAX_BLOCK_SPAN, MINUTE_SELECTION_MAX_CHARS,
  matchMinuteSelection, minuteSelectionKeyHash,
} from '@/lib/minutes/selection'
import { sortByKoreanName } from '@/lib/domain/nameSort'
import type { ProjectMember, ProjectMemberRole, TeamCode } from '@/lib/domain/types'
import { generateAnswer } from '@/lib/ai/llm'
import { hasLLM } from '@/lib/ai/provider'
import {
  MINUTE_ISSUE_DRAFT_SYSTEM_PROMPT,
  buildFallbackMinuteIssueDraft,
  buildMinuteIssueDraft,
  buildMinuteIssueDraftPrompt,
  type MinuteIssueDraft,
  type MinuteIssueMajorProcessReference,
  type MinuteIssueSubProcessReference,
} from '@/lib/ai/minute-issue-draft'

export interface IssueActionResult {
  ok: boolean
  error?: string
  id?: string
  issueNo?: number
  piIssueCode?: string | null
  /** CAS 0행 — 다른 사용자가 먼저 상태를 바꿨다. 클라이언트는 router.refresh() 후 안내. */
  conflict?: boolean
}

export interface IssueInput extends IssueAnalysisInput {
  title: string
  body: string
  severity: IssueSeverity
  assigneeMemberIds: string[]
  startDate: string | null
  dueDate: string | null
}

export interface IssueProgressPatch {
  status?: IssueStatus
  /** status 를 보낼 때 필수 — 클라이언트가 화면에 보이는 상태(CAS 비교 기준). 서버가 방금 읽은 상태가 아니다. */
  expectedStatus?: IssueStatus
  assigneeMemberIds?: string[]
  resolutionNote?: string
}

export interface MinuteIssueSourceInput {
  minuteId: string
  minuteVersionId: string
  bodyHash: string
  blockIndex: number
  blockHash: string
  kind: IssueMinuteSourceKind
  /** 드래그 선택 등록일 때만 존재. blockIndex/blockHash 는 시작 블록 앵커가 된다. */
  selection?: {
    text: string
    endBlockIndex: number
    endBlockHash: string
  }
}

export interface IssueProjectMembersResult {
  ok: boolean
  members?: ProjectMember[]
  error?: string
}

export interface MinuteIssueDraftActionResult {
  ok: boolean
  draft?: MinuteIssueDraft
  error?: string
}

export interface IssueMajorProcessesResult {
  ok: boolean
  majors?: IssueMajorProcess[]
  error?: string
}

/** 폼의 Major Process 자동완성 후보 — 조회 전용(로그인 사용자, 이슈 읽기 관례와 동일 범위). */
export async function fetchIssueMajorProcesses(projectId: string): Promise<IssueMajorProcessesResult> {
  const user = await getSession()
  if (!user || !projectId) return { ok: false, error: '로그인 필요' }
  const sb = await createServerClient()
  const { data, error } = await sb
    .from('issue_major_processes')
    .select('id, project_id, mega_code, major_seq, name')
    .eq('project_id', projectId)
    .order('mega_code', { ascending: true })
    .order('major_seq', { ascending: true })
  if (error) {
    console.error('[fetchIssueMajorProcesses] 조회 실패:', error.message)
    return { ok: false, error: 'Major Process 목록을 불러오지 못했습니다. 다시 시도하세요.' }
  }
  return {
    ok: true,
    majors: ((data ?? []) as Record<string, unknown>[]).map(row => ({
      id: row.id as string,
      projectId: row.project_id as string,
      megaCode: row.mega_code as IssueMegaCode,
      majorSeq: Number(row.major_seq),
      name: row.name as string,
    })),
  }
}

/** 프로젝트 미지정 회의록의 빠른 등록에서 프로젝트 선택 후 담당자 목록을 지연 로드한다. */
export async function fetchIssueProjectMembers(projectId: string): Promise<IssueProjectMembersResult> {
  // 조회 전용 — 담당자 후보 명단은 프로젝트 화면을 볼 수 있는 로그인 사용자면 읽을 수 있다.
  const user = await getSession()
  if (!user || !projectId) return { ok: false, error: '로그인 필요' }
  const sb = await createServerClient()
  const { data, error } = await sb
    .from('project_members')
    .select('id, project_id, name, email, role, title, user_id, created_at, teams(code)')
    .eq('project_id', projectId)
    .order('created_at', { ascending: true })
  if (error) {
    console.error('[fetchIssueProjectMembers] 조회 실패:', error.message)
    return { ok: false, error: '담당자 목록을 불러오지 못했습니다. 다시 시도하세요.' }
  }
  const rows = sortByKoreanName(data ?? [], row => (row as Record<string, unknown>).name as string)
  return {
    ok: true,
    members: rows.map((row: Record<string, unknown>) => {
      const team = row.teams as { code: TeamCode } | { code: TeamCode }[] | null
      const teamCode = (Array.isArray(team) ? team[0]?.code : team?.code) ?? null
      return {
        id: row.id as string,
        projectId: row.project_id as string,
        name: row.name as string,
        email: (row.email as string) ?? null,
        teamCode: teamCode as TeamCode | null,
        role: (row.role as ProjectMemberRole) ?? 'contributor',
        title: (row.title as string) ?? null,
        hasAccount: row.user_id != null,
        createdAt: row.created_at as string,
      }
    }),
  }
}

const TITLE_MAX = 200
const TEXT_MAX = 20000
const ASSIGNEES_MAX = 20
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const BLOCK_HASH_RE = /^[0-9a-f]{16}$/i

interface VerifiedMinuteIssueBlock {
  storedBodyHash: string
  block: MinuteBlock
  insightLabel: string | null
  draftContextText: string
  /** 드래그 선택 등록이면 검증·정규화된 발췌, 블록 등록이면 null. */
  selectionExcerpt: string | null
}

type MinuteIssueBlockVerification =
  | { ok: true; value: VerifiedMinuteIssueBlock }
  | { ok: false; error: string }

function minuteIssueDraftContext(
  blocks: readonly MinuteBlock[],
  selectedIndex: number,
  version: { title?: unknown; minute_date?: unknown },
): string {
  const lines: string[] = []
  const title = typeof version.title === 'string' ? version.title.trim() : ''
  const date = typeof version.minute_date === 'string' ? version.minute_date.trim() : ''
  if (title || date) lines.push(`회의록: ${[title, date].filter(Boolean).join(' · ')}`)

  // 선택 블록이 속한 heading 계층만 추적한다. 같은 문서의 다른 절 제목을 섞지 않는다.
  const headings: MinuteBlock[] = []
  let parentDepth = Number.POSITIVE_INFINITY
  for (let index = selectedIndex - 1; index >= 0; index -= 1) {
    const candidate = blocks[index]
    if (!candidate?.headingDepth || candidate.headingDepth >= parentDepth) continue
    headings.unshift(candidate)
    parentDepth = candidate.headingDepth
    if (parentDepth === 1) break
  }
  if (headings.length) lines.push(`상위 섹션: ${headings.map(heading => heading.text).join(' > ')}`)

  // 한 블록만으로 대명사나 대상이 불명확할 때를 위해 같은 절의 바로 앞·뒤 본문만 보조로 준다.
  const neighbors: string[] = []
  for (const direction of [-1, 1] as const) {
    for (let index = selectedIndex + direction; index >= 0 && index < blocks.length; index += direction) {
      const candidate = blocks[index]
      if (candidate.headingDepth) break
      if (isMarkableBlock(candidate)) {
        neighbors.push(
          `${direction < 0 ? '직전 문맥' : '직후 문맥'}: ${minuteBlockDraftText(candidate)}`,
        )
        break
      }
    }
  }
  lines.push(...neighbors)
  return lines.join('\n')
}

/** 선택이 걸친 블록 전체 원문 — 잘린 문장 경계를 AI 가 원문으로 보완할 수 있게 컨텍스트로 준다. */
function selectionRangeContext(
  blocks: readonly MinuteBlock[],
  startIndex: number,
  endIndex: number,
): string {
  const texts: string[] = []
  for (let index = startIndex; index <= endIndex && index < blocks.length; index += 1) {
    const candidate = blocks[index]
    if (candidate && isMarkableBlock(candidate)) texts.push(minuteBlockDraftText(candidate))
  }
  return texts.length ? `선택 범위 블록 원문:\n${texts.join('\n')}` : ''
}

function validMinuteIssueSource(source: MinuteIssueSourceInput): boolean {
  const base = Boolean(
    source.minuteId
    && source.minuteVersionId
    && Number.isSafeInteger(source.blockIndex)
    && source.blockIndex >= 0
    && BLOCK_HASH_RE.test(source.blockHash)
    && BLOCK_HASH_RE.test(source.bodyHash)
    && ISSUE_MINUTE_SOURCE_KINDS.includes(source.kind),
  )
  if (!base) return false
  const selection = source.selection
  // null 도 '선택 없음'으로 취급한다 — 임의 JSON 페이로드가 TypeError(500)를 만들지 않게.
  if (selection == null) return true
  // 선택 등록은 인사이트 kind 를 얹지 않는다 — manual 만 유효(스펙 §4.1).
  return Boolean(
    source.kind === 'manual'
    && typeof selection.text === 'string'
    && selection.text.length > 0
    && selection.text.length <= MINUTE_SELECTION_MAX_CHARS
    && Number.isSafeInteger(selection.endBlockIndex)
    && selection.endBlockIndex >= source.blockIndex
    && selection.endBlockIndex - source.blockIndex <= MINUTE_SELECTION_MAX_BLOCK_SPAN
    && BLOCK_HASH_RE.test(selection.endBlockHash),
  )
}

/**
 * 회의록 기반 초안 생성과 최종 저장이 같은 불변 원문 검증을 공유한다.
 * 클라이언트는 버전/블록 앵커만 제시하며, 실제 AI 입력·저장 스냅샷은 여기서 찾은 블록만 사용한다.
 */
async function verifyMinuteIssueBlock(
  projectId: string,
  source: MinuteIssueSourceInput,
  logLabel: string,
  includeInsight = false,
): Promise<MinuteIssueBlockVerification> {
  // 상한 초과는 형식 오류가 아니라 사용자가 고칠 수 있는 입력이다 — 오도 문구와 분리한다.
  if (
    source.selection
    && typeof source.selection.text === 'string'
    && (
      source.selection.text.length > MINUTE_SELECTION_MAX_CHARS
      || (
        Number.isSafeInteger(source.selection.endBlockIndex)
        && source.selection.endBlockIndex - source.blockIndex > MINUTE_SELECTION_MAX_BLOCK_SPAN
      )
    )
  ) {
    return { ok: false, error: '선택 범위가 너무 큽니다. 더 작은 범위를 선택해 주세요.' }
  }
  if (!projectId || !validMinuteIssueSource(source)) {
    return { ok: false, error: '회의록 원문 정보가 올바르지 않습니다. 블록을 다시 선택해 주세요.' }
  }

  const sb = await createServerClient()
  const [versionRes, minuteRes] = await Promise.all([
    sb
      .from('minute_versions')
      .select('id, minute_id, body_md, body_hash, title, minute_date')
      .eq('id', source.minuteVersionId)
      .eq('minute_id', source.minuteId)
      .maybeSingle(),
    sb
      .from('minutes')
      .select('project_id, archived_at')
      .eq('id', source.minuteId)
      .maybeSingle(),
  ])
  const { data: version, error: versionErr } = versionRes
  if (versionErr) {
    console.error(`[${logLabel}] 원문 버전 조회 실패:`, versionErr.message)
    return { ok: false, error: '회의록 원문을 확인하지 못했습니다. 잠시 후 다시 시도하세요.' }
  }
  if (!version) return { ok: false, error: '회의록 원문 버전을 찾을 수 없습니다.' }
  if (minuteRes.error) {
    console.error(`[${logLabel}] 현재 회의록 조회 실패:`, minuteRes.error.message)
    return { ok: false, error: '회의록 상태를 확인하지 못했습니다. 잠시 후 다시 시도하세요.' }
  }
  if (!minuteRes.data) return { ok: false, error: '회의록을 찾을 수 없습니다.' }
  if (minuteRes.data.archived_at) {
    return { ok: false, error: '보관된 회의록에서는 이슈를 등록할 수 없습니다.' }
  }

  // 버전의 project_id는 생성 당시 스냅샷이다. 이동 후에는 현재 회의록의 프로젝트만 경계로 쓴다.
  const currentProjectId = (minuteRes.data.project_id as string | null) ?? null
  if (currentProjectId !== null && currentProjectId !== projectId) {
    return { ok: false, error: '회의록과 이슈의 프로젝트가 일치하지 않습니다.' }
  }

  const bodyMd = version.body_md as string
  const storedBodyHash = (version.body_hash as string).toLowerCase()
  if (storedBodyHash !== source.bodyHash.toLowerCase() || fnv1a64(bodyMd) !== storedBodyHash) {
    return { ok: false, error: '회의록 원문 버전이 변경되었습니다. 블록을 다시 선택해 주세요.' }
  }
  const blocks = splitMinuteBlocks(bodyMd)
  const block = blocks[source.blockIndex]
  if (!block || !isMarkableBlock(block) || block.hash !== source.blockHash.toLowerCase()) {
    return { ok: false, error: '회의록 본문이 변경되었습니다. 블록을 다시 선택해 주세요.' }
  }

  let selectionExcerpt: string | null = null
  if (source.selection) {
    const match = matchMinuteSelection(
      blocks,
      source.blockIndex,
      source.blockHash,
      source.selection.endBlockIndex,
      source.selection.endBlockHash,
      source.selection.text,
    )
    if (!match.ok) {
      return {
        ok: false,
        error: '선택 영역을 회의록 원문과 대조하지 못했습니다. 범위를 다시 선택하거나 블록 단위로 등록해 주세요.',
      }
    }
    // 제목만의 선택으로는 이슈를 만들지 않는다 — 블록 흐름의 heading 거절과 같은 원칙.
    const endIndex = source.selection.endBlockIndex
    const hasBody = blocks.some((candidate, index) =>
      index >= source.blockIndex && index <= endIndex
      && isMarkableBlock(candidate) && !candidate.headingDepth)
    if (!hasBody) {
      return { ok: false, error: '제목이 아닌 실제 이슈 내용이 있는 범위를 선택해 주세요.' }
    }
    selectionExcerpt = match.excerpt
  }

  let insightLabel: string | null = null
  if (includeInsight && source.kind !== 'manual') {
    const { data: insight, error: insightErr } = await sb
      .from('minute_insights')
      .select('label')
      .eq('minute_id', source.minuteId)
      .eq('body_hash', storedBodyHash)
      .eq('block_index', source.blockIndex)
      .eq('block_hash', block.hash)
      .eq('kind', source.kind)
      .maybeSingle()
    if (insightErr) {
      // 보조 라벨 조회 실패는 원문 검증 실패가 아니다. 본문만으로도 결정형 초안을 만들 수 있다.
      console.error(`[${logLabel}] 인사이트 라벨 조회 실패(무시):`, insightErr.message)
    } else if (typeof insight?.label === 'string') {
      insightLabel = insight.label
    }
  }
  return {
    ok: true,
    value: {
      storedBodyHash,
      block,
      insightLabel,
      selectionExcerpt,
      draftContextText: source.selection
        ? [
            minuteIssueDraftContext(blocks, source.blockIndex, version),
            selectionRangeContext(blocks, source.blockIndex, source.selection.endBlockIndex),
          ].filter(Boolean).join('\n')
        : minuteIssueDraftContext(blocks, source.blockIndex, version),
    },
  }
}

/** 형식 + 실재성(2026-02-30 반려) — announcements isValidDate 관례. */
function isValidDate(s: string): boolean {
  if (!DATE_RE.test(s)) return false
  const d = new Date(`${s}T00:00:00Z`)
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s
}

/** 서버 액션 인자는 클라이언트가 임의로 만든다 — 배열 형태·원소 타입·개수를 여기서 못박는다. */
function validateAssignees(ids: unknown): string | null {
  if (!Array.isArray(ids) || ids.some(id => typeof id !== 'string')) return '담당자 형식이 올바르지 않습니다.'
  if (ids.length > ASSIGNEES_MAX) return `담당자는 최대 ${ASSIGNEES_MAX}명까지 지정할 수 있습니다.`
  return null
}

type IssueInputMode = 'normal-create' | 'minute-create' | 'update'
type NormalizedIssueInput = Omit<IssueInput, keyof IssueAnalysisInput> & NormalizedIssueAnalysisInput
type IssueInputValidation =
  | { ok: true; value: NormalizedIssueInput }
  | { ok: false; error: string }

function validateInput(input: IssueInput, mode: IssueInputMode): IssueInputValidation {
  const title = input.title.trim()
  if (!title) return { ok: false, error: '제목을 입력하세요.' }
  if (title.length > TITLE_MAX) return { ok: false, error: `제목은 ${TITLE_MAX}자 이하여야 합니다.` }
  if (input.body.length > TEXT_MAX) return { ok: false, error: `내용은 ${TEXT_MAX}자 이하여야 합니다.` }
  if (!ISSUE_SEVERITIES.includes(input.severity)) return { ok: false, error: '잘못된 심각도입니다.' }
  const assigneeErr = validateAssignees(input.assigneeMemberIds)
  if (assigneeErr) return { ok: false, error: assigneeErr }
  // 과거 날짜는 허용(즉시 지연 표시 안내는 폼 몫) — 형식·실재성만 검증
  if (input.startDate !== null && !isValidDate(input.startDate)) {
    return { ok: false, error: '이슈 시작일 날짜 형식이 올바르지 않습니다.' }
  }
  if (input.dueDate !== null && !isValidDate(input.dueDate)) {
    return { ok: false, error: '목표 해결일 날짜 형식이 올바르지 않습니다.' }
  }
  if (!validateIssueDateRange(input.startDate, input.dueDate)) {
    return { ok: false, error: '이슈 시작일은 목표 해결일보다 늦을 수 없습니다.' }
  }

  // 회의록 생성은 클라이언트 sourceType을 신뢰하지 않고 검증된 원문 경로로 강제한다.
  const analysis = normalizeIssueAnalysisInput(
    mode === 'minute-create' ? { ...input, sourceType: 'minutes' } : input,
    { allowMinutesSource: mode !== 'normal-create' },
  )
  if (!analysis.ok) return analysis

  return {
    ok: true,
    value: {
      ...input,
      ...analysis.value,
      title,
    },
  }
}

/**
 * 담당자 전체 교체 — 회의 replaceAttendees 관례.
 * 유효성 검증(해당 프로젝트 멤버인지)을 delete 보다 먼저 수행해, 잘못된 id 목록이
 * 기존 담당자를 먼저 지워버리는 것을 막는다. 0042 복합 FK 가 DB 에서 이중 방어한다.
 */
async function replaceAssignees(
  sb: Awaited<ReturnType<typeof createServerClient>>,
  issueId: string,
  projectId: string,
  memberIds: string[],
): Promise<string | null> {
  const unique = [...new Set(memberIds)]
  if (unique.length === 0) {
    const { error: clrErr } = await sb.from('issue_assignees').delete().eq('issue_id', issueId)
    return clrErr ? clrErr.message : null
  }
  const { data: valid, error: validErr } = await sb
    .from('project_members')
    .select('id')
    .eq('project_id', projectId)
    .in('id', unique)
  // 쓰기 선행 검증 조회 실패를 '유효 멤버 0명'으로 오인하면 담당자 변경이 통째로 유실되며
  // 액션은 성공을 보고한다 — 실패는 실패로 올린다(silent-empty 금지).
  if (validErr) {
    console.error('[replaceAssignees] 멤버 검증 조회 실패:', validErr.message)
    return validErr.message
  }
  const validIds = (valid ?? []).map((r: { id: string }) => r.id)
  if (validIds.length !== unique.length) return '프로젝트 멤버가 아닌 담당자가 있습니다. 새로고침 후 다시 시도하세요.'
  const { error: delErr } = await sb.from('issue_assignees').delete().eq('issue_id', issueId)
  if (delErr) return delErr.message // 삭제 실패를 삼키면 이어지는 insert 가 PK 충돌이 된다
  const { error } = await sb
    .from('issue_assignees')
    .insert(validIds.map(id => ({ issue_id: issueId, member_id: id, project_id: projectId })))
  return error ? error.message : null
}

function revalidateIssues(projectId: string) {
  revalidatePath(`/p/${projectId}/issues`)
}

/**
 * Major Process resolve-or-create — 같은 (project, mega, 이름)은 기존 체번을 재사용하고,
 * 새 이름은 insert 때 0062 트리거가 advisory lock 아래 다음 번호(01, 02, 03…)를 발급한다.
 * 동시 등록 경합의 유니크 충돌(23505)은 승자 행 재조회로 수렴. 조회 실패는 중단(쓰기 선행 조회 원칙).
 */
async function resolveIssueMajorId(
  sb: Awaited<ReturnType<typeof createServerClient>>,
  projectId: string,
  megaCode: IssueMegaCode,
  majorName: string,
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const findExisting = async () => sb
    .from('issue_major_processes')
    .select('id')
    .eq('project_id', projectId)
    .eq('mega_code', megaCode)
    .eq('name', majorName)
    .maybeSingle()

  const { data: existing, error: selErr } = await findExisting()
  if (selErr) {
    console.error('[resolveIssueMajorId] 선행 조회 실패:', selErr.message)
    return { ok: false, error: 'Major Process 정보를 확인할 수 없어 중단했습니다.' }
  }
  if (existing) return { ok: true, id: existing.id as string }

  const { data: inserted, error: insErr } = await sb
    .from('issue_major_processes')
    .insert({ project_id: projectId, mega_code: megaCode, name: majorName })
    .select('id')
    .single()
  if (!insErr && inserted) return { ok: true, id: inserted.id as string }

  if (insErr?.code === '23505') {
    const { data: winner, error: reErr } = await findExisting()
    if (reErr) {
      console.error('[resolveIssueMajorId] 경합 재조회 실패:', reErr.message)
      return { ok: false, error: 'Major Process 정보를 확인할 수 없어 중단했습니다.' }
    }
    if (winner) return { ok: true, id: winner.id as string }
  }
  console.error('[resolveIssueMajorId] 등록 실패:', insErr?.message ?? 'empty result')
  return { ok: false, error: 'Major Process 등록에 실패했습니다. 다시 시도하세요.' }
}

const ERR_LOOKUP = '권한을 확인할 수 없어 중단했습니다.'

/**
 * 전체 편집·삭제의 공통 게이트 — 대상 이슈의 프로젝트를 먼저 확정한 뒤 그 프로젝트의
 * 관리자면 무조건 통과시키고, 아니면 '작성자 본인' 판정을 호출부로 넘긴다(각 액션이 이미
 * created_by 를 선검증 조회하므로 비교는 거기서 한다). 비로그인·권한 조회 실패는 중단(fail-closed).
 */
type OwnerGate = { ok: true; isAdmin: boolean; userId: string } | { ok: false; error: string }
async function adminOrOwnerGate(issueId: string): Promise<OwnerGate> {
  const found = await resolveProjectId('issues', issueId)
  if (!found.ok) return { ok: false, error: found.error }
  const g = await requireProjectAdmin(found.projectId)
  if (g.ok) return { ok: true, isAdmin: true, userId: g.actor.userId }
  let actor: Awaited<ReturnType<typeof getActor>> = null
  try { actor = await getActor() } catch { actor = null }
  if (!actor) return { ok: false, error: g.error }
  return { ok: true, isAdmin: false, userId: actor.userId }
}

export async function createIssue(projectId: string, input: IssueInput): Promise<IssueActionResult> {
  const g = await requireProjectMember(projectId)
  if (!g.ok) return { ok: false, error: g.error }
  const checked = validateInput(input, 'normal-create')
  if (!checked.ok) return { ok: false, error: checked.error }
  const value = checked.value
  const user = await getSession()
  if (!user) return { ok: false, error: '로그인 필요' }

  const sb = await createServerClient()
  const major = await resolveIssueMajorId(sb, projectId, value.megaCode, value.majorName)
  if (!major.ok) return { ok: false, error: major.error }
  const { data, error } = await sb
    .from('issues')
    .insert({
      project_id: projectId,
      title: value.title,
      body: value.body,
      severity: value.severity,
      start_date: value.startDate,
      due_date: value.dueDate,
      mega_code: value.megaCode,
      major_id: major.id,
      sub_process: value.subProcess,
      owner_department: value.ownerDepartment,
      related_systems: value.relatedSystems,
      source_type: value.sourceType,
      source_detail: value.sourceDetail,
      created_by: user.id,
      created_by_name: displayNameFrom(user.user_metadata, user.email),
    })
    .select('id, issue_no, pi_issue_code')
    .single()
  if (error) return { ok: false, error: error.message }
  const issueId = data.id as string

  const assignErr = await replaceAssignees(sb, issueId, projectId, value.assigneeMemberIds)
  if (assignErr) {
    // 담당자 저장 실패 시 방금 만든 이슈를 롤백(보상)해 담당 없는 반쪽 이슈가 남지 않게 한다(회의 관례).
    const { error: rbErr } = await sb.from('issues').delete().eq('id', issueId)
    if (rbErr) {
      console.error('[createIssue] 담당자 저장 실패 후 이슈 롤백 실패(담당 없는 이슈 잔존):', rbErr.message)
      revalidateIssues(projectId)
      return { ok: false, error: `담당자 저장에 실패했습니다(${assignErr}). 이슈가 생성됐을 수 있으니 목록을 확인하세요.` }
    }
    return { ok: false, error: assignErr }
  }
  revalidateIssues(projectId)
  return {
    ok: true,
    id: issueId,
    issueNo: Number(data.issue_no),
    piIssueCode: (data.pi_issue_code as string | null) ?? null,
  }
}

// 동일한 불변 블록을 폼에서 다시 열 때마다 모델 비용·대기 시간을 만들지 않는다.
// 서버리스 인스턴스 로컬 캐시이므로 정합성 경계로 사용하지 않으며, 원문 앵커는 매 요청 재검증한다.
const MINUTE_DRAFT_CACHE_MAX = 200
const minuteDraftCache = new Map<string, MinuteIssueDraft>()
const minuteDraftInFlight = new Map<string, Promise<MinuteIssueDraft | null>>()

function rememberMinuteDraft(key: string, draft: MinuteIssueDraft): void {
  if (minuteDraftCache.size >= MINUTE_DRAFT_CACHE_MAX) {
    const oldest = minuteDraftCache.keys().next().value as string | undefined
    if (oldest) minuteDraftCache.delete(oldest)
  }
  minuteDraftCache.set(key, draft)
}

async function summarizeVerifiedMinuteBlock(
  cacheKey: string,
  blockText: string,
  insightLabel: string | null,
  prompt: string,
): Promise<MinuteIssueDraft | null> {
  const fallback = buildFallbackMinuteIssueDraft(blockText, insightLabel)
  const cached = minuteDraftCache.get(cacheKey)
  if (cached) return cached
  if (!hasLLM()) return fallback

  const existing = minuteDraftInFlight.get(cacheKey)
  if (existing) return existing

  const pending = (async (): Promise<MinuteIssueDraft | null> => {
    let raw: string | null
    try {
      raw = await generateAnswer(
        MINUTE_ISSUE_DRAFT_SYSTEM_PROMPT,
        [{ role: 'user', content: prompt }],
        {
          // 충실한 초안을 만들 생성 여유를 주되, 장애 시에는 결정형 초안으로 이어진다.
          timeoutMs: 15_000,
          // Gemini 3.x는 thinking 토큰도 이 상한에 포함하므로 사고 예산과 복수 근거 bullet을
          // 함께 수용한다. 저장 한도는 응답을 자르지 않는 파서가 별도로 검증한다.
          maxOutputTokens: 8_192,
          allowModelFallback: false,
          retries: 0,
          retryRateLimit: false,
        },
      )
    } catch (cause) {
      console.error(
        '[prepareMinuteIssueDraft] AI 초안 생성 실패(결정형 초안 사용):',
        cause instanceof Error ? cause.message : cause,
      )
      return fallback
    }
    const draft = buildMinuteIssueDraft({ sourceText: blockText, insightLabel, aiResponse: raw }) ?? fallback
    // 일시 장애로 만든 폴백은 캐시하지 않아 다음 열기에서 AI를 다시 시도할 수 있게 한다.
    if (draft?.mode === 'ai') rememberMinuteDraft(cacheKey, draft)
    return draft
  })()
  minuteDraftInFlight.set(cacheKey, pending)
  try {
    return await pending
  } finally {
    if (minuteDraftInFlight.get(cacheKey) === pending) minuteDraftInFlight.delete(cacheKey)
  }
}

async function loadKnownMajorProcesses(projectId: string): Promise<MinuteIssueMajorProcessReference[]> {
  try {
    const sb = await createServerClient()
    const { data, error } = await sb
      .from('issue_major_processes')
      .select('mega_code, name')
      .eq('project_id', projectId)
      .order('mega_code', { ascending: true })
      .order('major_seq', { ascending: true })
    if (error) throw error
    return ((data ?? []) as Array<Record<string, unknown>>).flatMap(row => {
      const megaCode = row.mega_code
      const name = typeof row.name === 'string' ? row.name.trim() : ''
      if (!isIssueMegaCode(megaCode) || !name) return []
      return [{ megaCode, name }]
    })
  } catch (cause) {
    // 기존 Major 사례는 이름 재사용을 돕는 보조 정보다. 조회 실패가 등록 흐름을 막지는 않는다.
    console.error(
      '[prepareMinuteIssueDraft] Major Process 사례 조회 실패(무시):',
      cause instanceof Error ? cause.message : cause,
    )
    return []
  }
}

async function loadKnownSubProcesses(projectId: string): Promise<MinuteIssueSubProcessReference[]> {
  let rows: Array<Record<string, unknown>> = []
  try {
    const sb = await createServerClient()
    const { data, error } = await sb
      .from('issues')
      .select('mega_code, sub_process')
      .eq('project_id', projectId)
    if (error) throw error
    rows = (data ?? []) as Array<Record<string, unknown>>
  } catch (cause) {
    // 기존 분류 사례는 추천 품질을 높이는 보조 정보다. 조회 실패가 등록 흐름을 막지는 않는다.
    console.error(
      '[prepareMinuteIssueDraft] Sub Process 사례 조회 실패(무시):',
      cause instanceof Error ? cause.message : cause,
    )
    return []
  }
  const seen = new Set<string>()
  const references: MinuteIssueSubProcessReference[] = []
  for (const row of rows) {
    const megaCode = row.mega_code
    const subProcess = typeof row.sub_process === 'string'
      ? row.sub_process.trim()
      : ''
    if (!isIssueMegaCode(megaCode) || !subProcess) continue
    const key = `${megaCode}\u0000${subProcess}`
    if (seen.has(key)) continue
    seen.add(key)
    references.push({ megaCode, subProcess })
  }
  return references.sort((a, b) =>
    a.megaCode.localeCompare(b.megaCode)
    || a.subProcess.localeCompare(b.subProcess, 'ko'))
}

/**
 * 회의록 블록을 이슈 폼용 핵심 초안으로 정리한다.
 * 원문 문자열은 받지 않고 불변 앵커만 받아, 서버에서 검증한 블록만 모델 입력으로 사용한다.
 */
export async function prepareMinuteIssueDraft(
  projectId: string,
  source: MinuteIssueSourceInput,
): Promise<MinuteIssueDraftActionResult> {
  const gate = await requireProjectMember(projectId)
  if (!gate.ok) return { ok: false, error: gate.error }

  const verified = await verifyMinuteIssueBlock(projectId, source, 'prepareMinuteIssueDraft', true)
  if (!verified.ok) return verified
  const { block, insightLabel, draftContextText, selectionExcerpt } = verified.value
  if (!source.selection && block.headingDepth) {
    return { ok: false, error: '제목이 아닌 실제 이슈 내용이 있는 블록을 선택해 주세요.' }
  }
  const [knownMajorProcesses, knownSubProcesses] = await Promise.all([
    loadKnownMajorProcesses(projectId),
    loadKnownSubProcesses(projectId),
  ])
  const blockText = selectionExcerpt ?? minuteBlockDraftText(block)
  const prompt = buildMinuteIssueDraftPrompt(blockText, insightLabel, {
    contextText: draftContextText,
    knownMajorProcesses,
    knownSubProcesses,
  })
  const cacheKey = [
    // v4: majorProcess 5키 스키마 — 구버전 4키 캐시 초안과 섞이지 않게 버전으로 격리한다.
    'minute-issue-draft-v4', projectId, source.minuteVersionId, source.blockIndex, block.hash,
    source.kind, fnv1a64(prompt),
  ].join(':')
  const draft = await summarizeVerifiedMinuteBlock(cacheKey, blockText, insightLabel, prompt)
  if (!draft) {
    return {
      ok: false,
      error: '선택한 범위를 사실 손실 없이 이슈 초안으로 정리할 수 없습니다. 내용이 더 구체적이거나 작은 블록을 선택해 주세요.',
    }
  }
  return { ok: true, draft }
}

const MINUTE_ISSUE_SOURCE_EXCERPT_MAX = 4_000
const MINUTE_ISSUE_SOURCE_EXCERPT_NOTICE = '\n[전체 내용은 연결된 회의록 원문에서 확인]'

function minuteIssueSourceExcerpt(value: string): string {
  if (value.length <= MINUTE_ISSUE_SOURCE_EXCERPT_MAX) return value
  const budget = MINUTE_ISSUE_SOURCE_EXCERPT_MAX - MINUTE_ISSUE_SOURCE_EXCERPT_NOTICE.length
  let prefix = value.slice(0, budget)
  // 서로게이트 쌍 중간에서 자르면 깨진 문자가 저장되므로 경계만 한 글자 당긴다.
  if (/[\uD800-\uDBFF]$/.test(prefix)) prefix = prefix.slice(0, -1)
  return `${prefix.trimEnd()}${MINUTE_ISSUE_SOURCE_EXCERPT_NOTICE}`
}

/**
 * 회의록의 불변 버전 블록에서 이슈를 생성한다.
 * 클라이언트가 보낸 원문/프로젝트를 신뢰하지 않고 서버에서 버전 본문을 다시 분할해 검증한 뒤,
 * DB RPC가 이슈·담당자·원문 링크를 한 트랜잭션으로 저장한다.
 */
export async function createIssueFromMinuteBlock(
  projectId: string,
  input: IssueInput,
  source: MinuteIssueSourceInput,
): Promise<IssueActionResult> {
  const g = await requireProjectMember(projectId)
  if (!g.ok) return { ok: false, error: g.error }
  const checked = validateInput(input, 'minute-create')
  if (!checked.ok) return { ok: false, error: checked.error }
  const value = checked.value
  const user = await getSession()
  if (!user) return { ok: false, error: '로그인 필요' }

  const verified = await verifyMinuteIssueBlock(projectId, source, 'createIssueFromMinuteBlock')
  if (!verified.ok) return verified
  const { storedBodyHash, block, selectionExcerpt } = verified.value
  const excerpt = minuteIssueSourceExcerpt(selectionExcerpt ?? minuteBlockDraftText(block))
  const sourceKey = makeMinuteIssueSourceKey({
    minuteVersionId: source.minuteVersionId,
    blockIndex: source.blockIndex,
    blockHash: block.hash,
    kind: source.kind,
    selectionHash: selectionExcerpt ? minuteSelectionKeyHash(selectionExcerpt) : null,
  })

  let admin: ReturnType<typeof createAdminClient>
  try {
    admin = createAdminClient()
  } catch (cause) {
    console.error('[createIssueFromMinuteBlock] service_role 설정 실패:', cause)
    return { ok: false, error: '이슈 원문 연결 설정을 확인하세요.' }
  }
  // 이 RPC와 issue_links INSERT는 service_role 전용이다. 브라우저가 직접 호출해
  // 검증된 block hash/excerpt를 위조하지 못하도록, 파싱 검증이 끝난 서버 액션만 진입한다.
  const { data: created, error } = await admin.rpc('create_issue_from_minute_block', {
    p_project_id: projectId,
    p_title: value.title,
    p_body: value.body,
    p_severity: value.severity,
    p_assignee_member_ids: [...new Set(value.assigneeMemberIds)],
    p_start_date: value.startDate,
    p_due_date: value.dueDate,
    p_mega_code: value.megaCode,
    p_major_name: value.majorName,
    p_sub_process: value.subProcess,
    p_owner_department: value.ownerDepartment,
    p_related_systems: value.relatedSystems,
    // 클라이언트 값과 무관하게 minute 버전/블록 검증을 통과한 이 경로에서만 고정한다.
    p_source_type: 'minutes',
    p_source_detail: value.sourceDetail,
    p_actor_id: user.id,
    p_created_by_name: displayNameFrom(user.user_metadata, user.email),
    p_minute_id: source.minuteId,
    p_minute_version_id: source.minuteVersionId,
    p_body_hash: storedBodyHash,
    p_block_index: source.blockIndex,
    p_block_hash: block.hash,
    p_excerpt_snapshot: excerpt,
    p_source_kind: source.kind,
    p_source_key: sourceKey,
  }).single()
  if (error || !created) {
    console.error('[createIssueFromMinuteBlock] 원자적 생성 실패:', error?.message ?? 'empty result')
    return { ok: false, error: error?.message ?? '이슈 등록에 실패했습니다.' }
  }

  const row = created as {
    issue_id: string
    issue_no: number | string
    pi_issue_code: string | null
  }
  revalidateIssues(projectId)
  revalidatePath(`/minutes/${source.minuteId}`)
  return {
    ok: true,
    id: row.issue_id,
    issueNo: Number(row.issue_no),
    piIssueCode: row.pi_issue_code,
  }
}

/** 전체 편집(제목·내용·심각도·기한·담당자) — 작성자 또는 프로젝트 관리자만. */
export async function updateIssue(issueId: string, input: IssueInput): Promise<IssueActionResult> {
  const gate = await adminOrOwnerGate(issueId)
  if (!gate.ok) return { ok: false, error: gate.error }
  const checked = validateInput(input, 'update')
  if (!checked.ok) return { ok: false, error: checked.error }
  const value = checked.value

  const sb = await createServerClient()
  // 소유권 선검증(RLS 와 동일 — 0행 무음 성공 방지, meetings 관례)
  const { data: cur, error: curErr } = await sb
    .from('issues')
    .select('project_id, created_by, mega_code, source_type')
    .eq('id', issueId)
    .maybeSingle()
  if (curErr) return { ok: false, error: ERR_LOOKUP } // 소유권 판정의 입력이다 — 실패를 '없음'으로 위장하지 않는다
  if (!cur) return { ok: false, error: '이슈를 찾을 수 없습니다.' }
  const isOwner = (cur.created_by as string | null) === gate.userId
  if (!gate.isAdmin && !isOwner) return { ok: false, error: '권한 없음' }
  const currentMegaCode = (cur.mega_code as string | null) ?? null
  if (currentMegaCode !== null && currentMegaCode !== value.megaCode) {
    return { ok: false, error: '발급된 이슈 ID의 Mega 영역은 변경할 수 없습니다.' }
  }
  const currentSourceType = (cur.source_type as string | null) ?? null
  if (currentSourceType === 'minutes' && value.sourceType !== 'minutes') {
    return { ok: false, error: '회의록 원천은 검증된 원문 연결을 유지해야 하므로 변경할 수 없습니다.' }
  }
  if (value.sourceType === 'minutes' && currentSourceType !== 'minutes') {
    if (currentSourceType !== null) {
      return { ok: false, error: '등록된 이슈 원천을 회의록 원천으로 변경할 수 없습니다.' }
    }
    // 0055 이전에 생성된 회의록 파생 이슈는 source_type이 null이다. 이 경우에만 불변
    // minute_block 링크를 strict 조회해 최초 분류를 허용한다. 링크 조회 실패/0행을
    // '회의록 출처 없음'으로 뭉개면 provenance 사칭이나 정상 이슈의 분류 불능이 된다.
    const { data: minuteLink, error: minuteLinkErr } = await sb
      .from('issue_links')
      .select('id')
      .eq('issue_id', issueId)
      .eq('link_type', 'minute_block')
      .limit(1)
      .maybeSingle()
    if (minuteLinkErr) {
      console.error('[updateIssue] 회의록 원천 링크 조회 실패:', minuteLinkErr.message)
      return { ok: false, error: ERR_LOOKUP }
    }
    if (!minuteLink) {
      return { ok: false, error: '회의록 원천은 검증된 회의록 링크가 있는 이슈에만 지정할 수 있습니다.' }
    }
  }

  // Major 는 오분류 교정·레거시 백필을 위해 편집에서 바꿀 수 있다(mega 와 달리 이슈 ID 와 무관).
  const major = await resolveIssueMajorId(sb, cur.project_id as string, value.megaCode, value.majorName)
  if (!major.ok) return { ok: false, error: major.error }

  const { data: updated, error } = await sb
    .from('issues')
    .update({
      title: value.title,
      body: value.body,
      severity: value.severity,
      start_date: value.startDate,
      due_date: value.dueDate,
      mega_code: value.megaCode,
      major_id: major.id,
      sub_process: value.subProcess,
      owner_department: value.ownerDepartment,
      related_systems: value.relatedSystems,
      source_type: value.sourceType,
      source_detail: value.sourceDetail,
      updated_at: new Date().toISOString(),
      // created_by / status / resolution_note 는 여기서 SET 하지 않음(전자 불변, 후자는 진행 액션 전용)
    })
    .eq('id', issueId)
    .select('id, pi_issue_code')
    .single()
  if (error) return { ok: false, error: error.message }
  // 본문 수정은 이미 커밋됨 — 담당자 교체가 실패해도 변경분이 보이도록 revalidate 후 에러 보고(회의 관례).
  const assignErr = await replaceAssignees(sb, issueId, cur.project_id as string, input.assigneeMemberIds)
  revalidateIssues(cur.project_id as string)
  // 부분 실패는 부분 실패로 고지한다 — 맨 에러만 돌려주면 사용자가 전체 실패로 읽고
  // 이미 저장된 제목·내용 변경을 모른 채 지나간다(updateIssueProgress 와 같은 문구 원칙).
  if (assignErr) return { ok: false, error: `담당자 저장에 실패했습니다(${assignErr}). 제목·내용 등 나머지 변경은 저장되었습니다.` }
  return {
    ok: true,
    piIssueCode: (updated.pi_issue_code as string | null) ?? null,
  }
}

/** 진행 업데이트(상태·담당자·조치메모) — 멤버 전체. 상태 변경은 전환 맵 검증 + CAS. */
export async function updateIssueProgress(issueId: string, patch: IssueProgressPatch): Promise<IssueActionResult> {
  // 진행 업데이트는 그 이슈가 속한 프로젝트의 멤버면 누구나 — 대상 프로젝트를 먼저 확정한다.
  const found = await resolveProjectId('issues', issueId)
  if (!found.ok) return { ok: false, error: found.error }
  const g = await requireProjectMember(found.projectId)
  if (!g.ok) return { ok: false, error: g.error }
  if (patch.status === undefined && patch.assigneeMemberIds === undefined && patch.resolutionNote === undefined) {
    return { ok: false, error: '변경할 내용이 없습니다.' }
  }
  if (patch.status !== undefined && patch.expectedStatus === undefined) {
    return { ok: false, error: '상태 기준값이 없습니다. 새로고침 후 다시 시도하세요.' }
  }
  if (patch.resolutionNote !== undefined && patch.resolutionNote.length > TEXT_MAX) {
    return { ok: false, error: `조치 메모는 ${TEXT_MAX}자 이하여야 합니다.` }
  }
  if (patch.assigneeMemberIds !== undefined) {
    const assigneeErr = validateAssignees(patch.assigneeMemberIds)
    if (assigneeErr) return { ok: false, error: assigneeErr }
  }

  const sb = await createServerClient()
  const { data: cur } = await sb.from('issues').select('project_id, created_by, status, resolved_at').eq('id', issueId).maybeSingle()
  if (!cur) return { ok: false, error: '이슈를 찾을 수 없습니다.' }
  const curStatus = cur.status as IssueStatus

  // 담당자만 바꿔도 issues.updated_at 은 반드시 오른다 — AI 인덱스 신선도 가드의 입력(0041 헤더).
  const payload: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if (patch.resolutionNote !== undefined) payload.resolution_note = patch.resolutionNote
  if (patch.status !== undefined) {
    // CAS 비교 기준은 서버가 방금 읽은 curStatus 가 아니라 클라이언트가 화면에서 관측한 expectedStatus.
    // 그래야 read→write 사이가 아니라 "클라이언트가 화면을 마지막으로 갱신한 시점 이후" 변경까지 잡아낸다.
    if (curStatus !== patch.expectedStatus) {
      return { ok: false, conflict: true, error: '다른 사용자가 먼저 변경했거나 이슈가 삭제되었습니다. 최신 상태로 새로고침합니다.' }
    }
    if (!canTransition(patch.expectedStatus, patch.status)) {
      return { ok: false, error: '허용되지 않는 상태 전환입니다. 화면을 새로고침해 주세요.' }
    }
    payload.status = patch.status
    payload.resolved_at = nextResolvedAt(patch.expectedStatus, patch.status, (cur.resolved_at as string | null) ?? null, new Date().toISOString())
  }

  if (patch.status !== undefined) {
    // CAS: expectedStatus 와 같을 때만 반영(위 선검증과 동일 기준). 0행 = 그 사이(read→write) 추가 경합.
    // .select() 필수 — RLS/0행은 error 없이 빈 배열이라 그대로 두면 실패가 성공으로 둔갑한다(wbs.ts 관례).
    const { data: updated, error } = await sb
      .from('issues')
      .update(payload)
      .eq('id', issueId)
      .eq('status', patch.expectedStatus)
      .select('id')
    if (error) return { ok: false, error: error.message }
    if (!updated?.length) {
      return { ok: false, conflict: true, error: '다른 사용자가 먼저 변경했거나 이슈가 삭제되었습니다. 최신 상태로 새로고침합니다.' }
    }
  } else {
    const { data: updated, error } = await sb
      .from('issues')
      .update(payload)
      .eq('id', issueId)
      .select('id')
    if (error) return { ok: false, error: error.message }
    if (!updated?.length) return { ok: false, error: '이슈가 삭제되어 저장할 수 없습니다.' }
  }

  // 담당자 교체는 상태 CAS 가 통과한 뒤에만 — 충돌 감지 시 담당자까지 절반만 저장되는 일이 없게 한다.
  if (patch.assigneeMemberIds !== undefined) {
    const assignErr = await replaceAssignees(sb, issueId, cur.project_id as string, patch.assigneeMemberIds)
    if (assignErr) {
      // 상태·메모는 이미 커밋됐다 — 화면이 그 변경을 반영하도록 revalidate 하고 실패는 실패로 알린다.
      revalidateIssues(cur.project_id as string)
      return { ok: false, error: `담당자 저장에 실패했습니다(${assignErr}). 나머지 변경은 저장되었습니다.` }
    }
  }
  revalidateIssues(cur.project_id as string)
  return { ok: true }
}

export async function deleteIssue(issueId: string): Promise<IssueActionResult> {
  const gate = await adminOrOwnerGate(issueId)
  if (!gate.ok) return { ok: false, error: gate.error }

  const sb = await createServerClient()
  const { data: cur, error: curErr } = await sb.from('issues').select('project_id, created_by').eq('id', issueId).maybeSingle()
  if (curErr) return { ok: false, error: ERR_LOOKUP }
  if (!cur) return { ok: false, error: '이슈를 찾을 수 없습니다.' }
  const isOwner = (cur.created_by as string | null) === gate.userId
  if (!gate.isAdmin && !isOwner) return { ok: false, error: '권한 없음' }

  // 첨부 정리(0068). 메타 행은 복합 FK cascade 로 사라지지만 버킷 객체는 영구 잔존한다.
  // 경로 조회가 실패하면 중단한다 — 지울 대상을 모르는 채 이슈를 지우면 객체를 다시 찾을 수 없다.
  const { data: atts, error: attErr } = await sb
    .from('issue_attachments').select('file_path').eq('issue_id', issueId)
  if (attErr) {
    console.error('[deleteIssue] 첨부 경로 조회 실패:', attErr.message)
    return { ok: false, error: ERR_LOOKUP }
  }
  const paths = (atts ?? []).map(a => a.file_path as string)
  if (paths.length > 0) {
    // remove() 는 아무것도 지우지 못해도 error 가 null 이라 성공을 판정할 수 없다.
    // 여기서 막으면 이슈를 못 지우게 되므로, 최악의 결과인 '고아 객체'를 감수하고 진행한다.
    const { error: rmErr } = await sb.storage.from('issue-attachments').remove(paths)
    if (rmErr) console.error('[deleteIssue] 첨부 객체 삭제 실패(고아 잔존):', rmErr.message)
  }

  const { error } = await sb.from('issues').delete().eq('id', issueId).select('id').single()
  if (error) return { ok: false, error: error.message }
  revalidateIssues(cur.project_id as string)
  return { ok: true }
}
