'use server'
import { createServerClient } from '@/lib/supabase/server'
import { getMembership } from '@/lib/auth'
import { revalidatePath } from 'next/cache'
import type { DeliverableAttachment, Membership } from '@/lib/domain/types'

const BUCKET = 'deliverables'

/** 산출물 첨부 권한 — PMO 전체, 팀 편집자는 자기 팀이 담당인 항목만. */
async function canAttach(
  sb: Awaited<ReturnType<typeof createServerClient>>,
  itemId: string,
  m: Membership,
): Promise<boolean> {
  if (m.role === 'pmo_admin') return true
  const { data } = await sb.from('item_owners').select('team_id').eq('wbs_item_id', itemId).eq('team_id', m.teamId).maybeSingle()
  return !!data
}

/** 항목의 첨부 목록(서명 URL 포함, 최신순). */
export async function listAttachments(itemId: string): Promise<DeliverableAttachment[]> {
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
  const m = await getMembership()
  if (!m) return { ok: false, error: '로그인 필요' }
  const sb = await createServerClient()
  if (!(await canAttach(sb, itemId, m))) return { ok: false, error: '담당 작업이 아닙니다.' }
  const { data: u } = await sb.auth.getUser()
  const { error } = await sb.from('deliverable_attachments').insert({
    wbs_item_id: itemId, file_name: file.fileName, file_path: file.filePath,
    size: file.size, mime: file.mime, uploaded_by: u.user?.id,
  })
  if (error) return { ok: false, error: error.message }
  const { data: it } = await sb.from('wbs_items').select('project_id').eq('id', itemId).maybeSingle()
  if (it?.project_id) revalidatePath(`/p/${it.project_id as string}`, 'layout')
  return { ok: true }
}

/** 첨부 삭제(Storage 객체 + 메타). */
export async function removeAttachment(id: string): Promise<{ ok: boolean; error?: string }> {
  const m = await getMembership()
  if (!m) return { ok: false, error: '로그인 필요' }
  const sb = await createServerClient()
  const { data: att } = await sb.from('deliverable_attachments').select('id, file_path, wbs_item_id').eq('id', id).maybeSingle()
  if (!att) return { ok: false, error: '첨부 없음' }
  if (!(await canAttach(sb, att.wbs_item_id as string, m))) return { ok: false, error: '권한 없음' }
  await sb.storage.from(BUCKET).remove([att.file_path as string])
  const { error } = await sb.from('deliverable_attachments').delete().eq('id', id)
  if (error) return { ok: false, error: error.message }
  return { ok: true }
}
