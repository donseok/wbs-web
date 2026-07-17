'use server'

import { revalidatePath } from 'next/cache'
import { getMembership, getSession } from '@/lib/auth'
import { displayNameFrom } from '@/lib/domain/display-name'
import { TEAM_CODES } from '@/lib/domain/minutes'
import type { MinuteCommitmentReviewStatus, TeamCode } from '@/lib/domain/types'
import { generateMinuteCommitments } from '@/lib/ai/minutes-commitments-generator'
import { commitmentContextHash, isValidIsoDate } from '@/lib/ai/minutes-commitments'
import { fnv1a64, splitMinuteBlocks } from '@/lib/minutes/blocks'
import { createServerClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

type Sb = Awaited<ReturnType<typeof createServerClient>>
type ParentMinute = { bodyMd: string; minuteDate: string }

export interface MinuteCommitmentActionResult {
  ok: boolean
  count?: number
  error?: string
}

export interface ReviewMinuteCommitmentInput {
  commitmentId: string
  status: MinuteCommitmentReviewStatus
  commitmentText?: string
  ownerName?: string | null
  ownerTeam?: TeamCode | null
  ownerUnassigned?: boolean
  dueDate?: string | null
  dueUndecided?: boolean
}

async function readOwnedMinute(
  sb: Sb, minuteId: string, userId: string, role: string,
): Promise<{ minute: ParentMinute } | { error: string }> {
  const { data, error } = await sb.from('minutes')
    .select('created_by, body_md, minute_date').eq('id', minuteId).maybeSingle()
  if (error) {
    console.error('[minute-commitments] 회의록 권한 조회 실패:', error.message)
    return { error: '권한 확인에 실패했습니다. 잠시 후 다시 시도하세요.' }
  }
  if (!data) return { error: '회의록을 찾을 수 없습니다.' }
  if ((data.created_by as string | null) !== userId && role !== 'pmo_admin')
    return { error: '권한 없음' }
  return { minute: { bodyMd: data.body_md as string, minuteDate: data.minute_date as string } }
}

/** 현재 원문에서 약속 후보를 새로 추출한다. 확인/제외 이력은 generator가 보존한다. */
export async function extractMinuteCommitmentsAction(
  minuteId: string,
): Promise<MinuteCommitmentActionResult> {
  const membership = await getMembership()
  const user = await getSession()
  if (!membership || !user) return { ok: false, error: '로그인 필요' }
  const sb = await createServerClient()
  const owned = await readOwnedMinute(sb, minuteId, user.id, membership.role)
  if ('error' in owned) return { ok: false, error: owned.error }

  const result = await generateMinuteCommitments(minuteId, owned.minute.bodyMd)
  if (!result.ok) {
    const error = result.reason === 'changed'
      ? '분석 중 회의록이 변경되었습니다. 다시 시도하세요.'
      : result.reason === 'unavailable'
        ? 'AI 약속 추출을 사용할 수 없습니다. 잠시 후 다시 시도하세요.'
        : result.reason === 'parse'
          ? 'AI 결과를 검증하지 못했습니다. 다시 시도하세요.'
          : '약속 후보를 저장하지 못했습니다.'
    return { ok: false, error }
  }
  revalidatePath(`/minutes/${minuteId}`)
  return { ok: true, count: result.count }
}

function normalizeOptional(
  value: string | null | undefined, cap: number,
): { value: string | null; valid: boolean } {
  if (value == null || value.trim() === '') return { value: null, valid: true }
  const normalized = value.replace(/\s+/g, ' ').trim()
  return normalized.length <= cap
    ? { value: normalized, valid: true }
    : { value: null, valid: false }
}

/** 후보를 확인/제외하거나 다시 검토한다. 최종 상태 전이는 revision 잠금 RPC가 원자적으로 수행한다. */
export async function reviewMinuteCommitmentAction(
  input: ReviewMinuteCommitmentInput,
): Promise<MinuteCommitmentActionResult> {
  const membership = await getMembership()
  const user = await getSession()
  if (!membership || !user) return { ok: false, error: '로그인 필요' }
  if (!input.commitmentId || !['pending', 'confirmed', 'rejected'].includes(input.status))
    return { ok: false, error: '잘못된 요청입니다.' }

  const sb = await createServerClient()
  const { data: row, error: rowError } = await sb.from('minute_commitments')
    .select('id, minute_id, body_hash, context_hash, source_revision, block_index, block_hash, source_quote, review_status, commitment_text, owner_name, owner_team, owner_unassigned, due_date, due_undecided')
    .eq('id', input.commitmentId).maybeSingle()
  if (rowError) return { ok: false, error: rowError.message }
  if (!row) return { ok: false, error: '약속 후보를 찾을 수 없습니다.' }

  const currentStatus = row.review_status as MinuteCommitmentReviewStatus
  if (input.status === 'pending' && currentStatus === 'pending')
    return { ok: false, error: '이미 검토 대기 중인 약속입니다.' }
  if (input.status !== 'pending' && currentStatus !== 'pending')
    return { ok: false, error: '이미 처리된 약속입니다.' }

  const minuteId = row.minute_id as string
  const owned = await readOwnedMinute(sb, minuteId, user.id, membership.role)
  if ('error' in owned) return { ok: false, error: owned.error }

  let commitmentText = row.commitment_text as string
  let ownerName = (row.owner_name as string | null) ?? null
  let ownerTeam = (row.owner_team as TeamCode | null) ?? null
  let ownerUnassigned = !!row.owner_unassigned
  let dueDate = (row.due_date as string | null) ?? null
  let dueUndecided = !!row.due_undecided

  if (input.status === 'confirmed') {
    const { bodyMd, minuteDate } = owned.minute
    const blocks = splitMinuteBlocks(bodyMd)
    const blockIndex = row.block_index as number
    const block = blocks[blockIndex]
    const sourceQuote = (row.source_quote as string).replace(/\s+/g, ' ').trim()
    const current =
      fnv1a64(bodyMd) === (row.body_hash as string)
      && commitmentContextHash(bodyMd, minuteDate) === (row.context_hash as string)
      && !!block && block.rendered && block.hash === (row.block_hash as string)
      && block.text.includes(sourceQuote)
    if (!current) return { ok: false, error: '원문이 변경되었습니다. 약속을 다시 추출하세요.' }

    commitmentText = (input.commitmentText ?? commitmentText).replace(/\s+/g, ' ').trim()
    const normalizedOwner = normalizeOptional(
      input.ownerName === undefined ? ownerName : input.ownerName,
      120,
    )
    if (!commitmentText || commitmentText.length > 500 || !normalizedOwner.valid)
      return { ok: false, error: '약속 또는 담당자 입력이 너무 깁니다.' }
    ownerName = normalizedOwner.value
    ownerTeam = input.ownerTeam === undefined ? ownerTeam : input.ownerTeam
    if (ownerTeam !== null && !TEAM_CODES.includes(ownerTeam))
      return { ok: false, error: '잘못된 담당팀입니다.' }
    ownerUnassigned = input.ownerUnassigned ?? ownerUnassigned
    if (ownerUnassigned && (ownerName !== null || ownerTeam !== null))
      return { ok: false, error: '담당 미정을 선택하려면 담당자와 담당팀을 비워 주세요.' }
    if (!ownerUnassigned && ownerName === null && ownerTeam === null)
      return { ok: false, error: '담당자를 입력하거나 담당 미정을 선택하세요.' }

    const normalizedDueDate = normalizeOptional(
      input.dueDate === undefined ? dueDate : input.dueDate,
      10,
    )
    if (!normalizedDueDate.valid
      || (normalizedDueDate.value !== null && !isValidIsoDate(normalizedDueDate.value)))
      return { ok: false, error: '기한을 올바른 날짜로 입력하세요.' }
    dueDate = normalizedDueDate.value
    dueUndecided = input.dueUndecided ?? dueUndecided
    if (dueUndecided && dueDate !== null)
      return { ok: false, error: '기한 미정을 선택하려면 날짜를 비워 주세요.' }
    if (!dueUndecided && dueDate === null)
      return { ok: false, error: '기한을 입력하거나 기한 미정을 선택하세요.' }
  }

  const admin = createAdminClient()
  const { data, error } = await admin.rpc('transition_minute_commitment_review', {
    p_commitment_id: input.commitmentId,
    p_status: input.status,
    p_commitment_text: commitmentText,
    p_owner_name: ownerName,
    p_owner_team: ownerTeam,
    p_owner_unassigned: ownerUnassigned,
    p_due_date: dueDate,
    p_due_undecided: dueUndecided,
    p_reviewer_id: user.id,
    p_reviewer_name: displayNameFrom(user.user_metadata, user.email),
  })
  if (error) return { ok: false, error: error.message }
  const transition = data as string | null
  if (transition === 'stale') return { ok: false, error: '원문이 변경되었습니다. 약속을 다시 추출하세요.' }
  if (transition === 'missing') return { ok: false, error: '약속 후보를 찾을 수 없습니다.' }
  if (transition === 'conflict') return { ok: false, error: '다른 사용자가 먼저 처리했습니다. 새로고침하세요.' }
  if (transition === 'incomplete' || transition === 'invalid')
    return { ok: false, error: '담당자와 기한의 확인 상태를 다시 확인하세요.' }
  if (transition !== input.status) return { ok: false, error: '약속 검토 결과를 저장하지 못했습니다.' }
  revalidatePath(`/minutes/${minuteId}`)
  return { ok: true }
}
