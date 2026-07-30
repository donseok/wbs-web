'use server'
import { createServerClient } from '@/lib/supabase/server'
import { getSession } from '@/lib/auth'
import { requireProjectMember, resolveProjectId } from '@/lib/authz'
import { isProjectAdmin } from '@/lib/domain/authz'
import { revalidatePath } from 'next/cache'
import type { DeliverableAttachment } from '@/lib/domain/types'

const BUCKET = 'deliverables'

/**
 * 산출물 첨부 권한 — 관리자는 프로젝트 전체, 멤버는 자기 팀이 담당인 항목만(can_attach RLS 와 같은 규칙).
 * 담당 조회가 실패하면 '담당 아님'도 '담당'도 아니므로 중단한다(fail-closed).
 */
async function requireAttachPermission(itemId: string): Promise<
  { ok: true; projectId: string | null; userId: string } | { ok: false; error: string }
> {
  const found = await resolveProjectId('wbs_items', itemId)
  if (!found.ok) return { ok: false, error: found.error }
  const g = await requireProjectMember(found.projectId)
  if (!g.ok) return { ok: false, error: g.error }
  const granted = { ok: true, projectId: found.projectId, userId: g.actor.userId } as const
  if (isProjectAdmin(g.actor, found.projectId)) return granted

  const sb = await createServerClient()
  const { data: owners, error: ownErr } = await sb.from('item_owners').select('team_id').eq('wbs_item_id', itemId)
  if (ownErr || !owners) {
    console.error('[attachments] 담당 팀 조회 실패:', ownErr?.message)
    return { ok: false, error: '권한을 확인할 수 없어 중단했습니다.' }
  }
  if (!owners.some(o => o.team_id === g.actor.teamId)) return { ok: false, error: '권한 없음' }
  return granted
}

/** 항목의 첨부 목록(서명 URL 포함, 최신순). 로그인만 확인 — 조회는 전 프로젝트 개방(D6). */
export async function listAttachments(itemId: string): Promise<DeliverableAttachment[]> {
  // 반환 타입에 에러 채널이 없어 빈 목록으로 폴백하되, 조회 실패와 구분되도록 사유를 로그에 남긴다.
  if (!(await getSession())) {
    console.error('[listAttachments] 비로그인 호출 — 빈 목록 반환')
    return []
  }
  const sb = await createServerClient()
  const { data } = await sb
    .from('deliverable_attachments')
    .select('*')
    .eq('wbs_item_id', itemId)
    .order('created_at', { ascending: false })
  const out: DeliverableAttachment[] = []
  for (const r of data ?? []) {
    const { data: signed } = await sb.storage.from(BUCKET).createSignedUrl(r.file_path as string, 3600)
    out.push({
      id: r.id as string,
      wbsItemId: r.wbs_item_id as string,
      fileName: r.file_name as string,
      filePath: r.file_path as string,
      size: (r.size as number) ?? null,
      mime: (r.mime as string) ?? null,
      createdAt: r.created_at as string,
      url: signed?.signedUrl ?? null,
    })
  }
  return out
}

/** 클라이언트가 Storage 업로드를 끝낸 뒤 메타데이터 기록. */
export async function recordAttachment(
  itemId: string,
  file: { fileName: string; filePath: string; size: number; mime: string },
): Promise<{ ok: boolean; error?: string }> {
  const g = await requireAttachPermission(itemId)
  if (!g.ok) return { ok: false, error: g.error }
  const sb = await createServerClient()
  const { error } = await sb.from('deliverable_attachments').insert({
    wbs_item_id: itemId, file_name: file.fileName, file_path: file.filePath,
    size: file.size, mime: file.mime, uploaded_by: g.userId,
  })
  if (error) return { ok: false, error: error.message }
  if (g.projectId) revalidatePath(`/p/${g.projectId}`, 'layout')
  return { ok: true }
}

/** 첨부 삭제(Storage 객체 + 메타). */
export async function removeAttachment(id: string): Promise<{ ok: boolean; error?: string }> {
  const sb = await createServerClient()
  // 어느 항목의 첨부인지 모르면 권한을 판정할 수 없다 — 조회 실패는 '없음'으로 위장하지 않고 중단한다.
  const { data: att, error: attErr } = await sb
    .from('deliverable_attachments').select('id, file_path, wbs_item_id').eq('id', id).maybeSingle()
  if (attErr) {
    console.error('[removeAttachment] 첨부 조회 실패:', attErr.message)
    return { ok: false, error: '권한을 확인할 수 없어 중단했습니다.' }
  }
  if (!att) return { ok: false, error: '첨부 없음' }
  const g = await requireAttachPermission(att.wbs_item_id as string)
  if (!g.ok) return { ok: false, error: g.error }
  await sb.storage.from(BUCKET).remove([att.file_path as string])
  const { error } = await sb.from('deliverable_attachments').delete().eq('id', id)
  if (error) return { ok: false, error: error.message }
  return { ok: true }
}
