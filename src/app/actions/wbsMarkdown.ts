'use server'

import { revalidatePath } from 'next/cache'
import { requireProjectAdmin } from '@/lib/authz'
import { createAdminClient } from '@/lib/supabase/admin'
import { runWbsImport, validateLevels } from '@/lib/agent/wbsImport'
import { parseWbsMarkdown, toImportNodes, validateWbsDoc, type WbsDoc } from '@/lib/wbsmd/parse'
import { chunked } from '@/lib/ai/util'

/**
 * wbs.md 웹 업로드 — 스펙 §업로드 경로 2개의 "웹 경로(자동 부착 + 확인)".
 * 미리보기(previewWbsUpload)가 부착점·levels 정합·신규/갱신을 보여주고, 사람은 노드를 고르지
 * 않고 확인만 한다. 적용(applyWbsUpload)은 클라이언트 미리보기를 신뢰하지 않고 전 과정을
 * 다시 검증한 뒤 API 라우트와 같은 코어(runWbsImport)를 태운다 — 두 경로의 규칙 분기 금지.
 * 권한: 프로젝트 관리자 전용(import API 와 동일).
 */

export type WbsUploadPreview = {
  ok: boolean
  error?: string
  mode?: 'skeleton' | 'pl'
  module?: string
  attach?: string                    // frontmatter 표기 (PH-03/SYS-QA)
  attachRef?: string | null          // 해석된 full external_ref (mes-skel/SYS-QA)
  attachFound?: boolean
  levelsStatus?: 'match' | 'mismatch' | 'seed'
  serverLevels?: string[] | null
  fileLevels?: string[]
  counts?: Record<string, number>
  newCount?: number
  updateCount?: number
  foldCount?: number
  errors?: string[]
  warnings?: string[]
  canApply?: boolean
}

type Admin = ReturnType<typeof createAdminClient>

/** 파싱 + 구조·본문 검증 — 미리보기·적용이 공유하는 앞단. */
function parseAndValidate(md: string): { doc: WbsDoc; role: 'pl' | 'skeleton'; errors: string[]; warnings: string[]; counts: Record<string, number> } {
  const doc = parseWbsMarkdown(md)
  const role: 'pl' | 'skeleton' = doc.front.attach ? 'pl' : 'skeleton'
  const errors: string[] = []
  const lv = validateLevels(doc.levels)
  if ('error' in lv) errors.push(`levels 검증 실패: ${lv.error}`)
  const v = validateWbsDoc(doc, role)
  errors.push(...v.errors)
  return { doc, role, errors, warnings: v.warnings, counts: v.counts }
}

/** attach 경로 표기(PH-03/SYS-OP)의 마지막 세그먼트를 full external_ref 로 해석.
 *  0건 = 골격 미업로드(fail-closed 표시), 2건+ = 모호(에러 — 자동 부착 불가). */
async function resolveAttachRef(admin: Admin, projectId: string, attach: string):
  Promise<{ ref: string | null; ambiguous: boolean }> {
  const last = attach.split('/').pop() ?? ''
  const { data, error } = await admin
    .from('wbs_items').select('external_ref')
    .eq('project_id', projectId).like('external_ref', `%/${last}`).limit(2)
  if (error) throw new Error(`attach 해석 실패: ${error.message}`)
  const rows = (data ?? []) as Array<{ external_ref: string }>
  if (rows.length === 1) return { ref: rows[0].external_ref, ambiguous: false }
  return { ref: null, ambiguous: rows.length > 1 }
}

export async function previewWbsUpload(projectId: string, md: string): Promise<WbsUploadPreview> {
  const g = await requireProjectAdmin(projectId)
  if (!g.ok) return { ok: false, error: g.error }

  try {
    const { doc, role, errors, warnings, counts } = parseAndValidate(md)
    const admin = createAdminClient()

    // attach 자동 판정 (PL 만)
    let attachRef: string | null = null
    let attachFound = false
    if (role === 'pl' && doc.front.attach) {
      const r = await resolveAttachRef(admin, projectId, doc.front.attach)
      attachRef = r.ref
      attachFound = r.ref !== null
      if (r.ambiguous) errors.push(`attach 부착점이 모호합니다(같은 ID 가 여러 모듈에 있음): ${doc.front.attach}`)
      else if (!attachFound) errors.push(`attach 노드가 서버에 없습니다: ${doc.front.attach} — 골격을 먼저 업로드하세요.`)
    }

    // levels 정합 (PL: 정본 대조 / 골격: 시드 예정)
    let levelsStatus: WbsUploadPreview['levelsStatus'] = 'seed'
    let serverLevels: string[] | null = null
    if (role === 'pl') {
      const { data: ps, error: psErr } = await admin
        .from('project_settings').select('level_labels').eq('project_id', projectId).maybeSingle()
      if (psErr) throw new Error(`프로젝트 설정 조회 실패: ${psErr.message}`)
      serverLevels = (ps as { level_labels: string[] } | null)?.level_labels ?? null
      const fileLabels = doc.levels.map(l => l.name)
      levelsStatus = serverLevels && JSON.stringify(serverLevels) === JSON.stringify(fileLabels) ? 'match' : 'mismatch'
      if (levelsStatus === 'mismatch') {
        errors.push(`levels 가 프로젝트 정본과 다릅니다 (정본: ${serverLevels?.join('>') ?? '없음'}) — 골격의 levels 를 다시 복사하세요.`)
      }
    }

    // 신규/갱신 분류 — 업로드될 노드의 external_ref 존재 조회
    const module_ = doc.front.module ?? ''
    const nodes = toImportNodes(doc)
    const refs = nodes.map(n => `${module_}/${n.id}`)
    const existing = new Set<string>()
    for (const refChunk of chunked(refs, 200)) {
      const { data, error } = await admin
        .from('wbs_items').select('external_ref')
        .eq('project_id', projectId).in('external_ref', refChunk)
      if (error) throw new Error(`기존 노드 조회 실패: ${error.message}`)
      for (const r of (data ?? []) as Array<{ external_ref: string }>) existing.add(r.external_ref)
    }
    const updateCount = refs.filter(r => existing.has(r)).length
    const foldCount = doc.nodes.filter(n => doc.levels[n.level]?.upload === 'fold').length

    return {
      ok: true,
      mode: role,
      module: module_ || undefined,
      attach: doc.front.attach,
      attachRef,
      attachFound,
      levelsStatus,
      serverLevels,
      fileLevels: doc.levels.map(l => l.name),
      counts,
      newCount: refs.length - updateCount,
      updateCount,
      foldCount,
      errors,
      warnings,
      canApply: errors.length === 0 && (role === 'skeleton' || (attachFound && levelsStatus === 'match')),
    }
  } catch (e) {
    console.error('[wbs-md] 미리보기 실패:', e instanceof Error ? e.message : e)
    return { ok: false, error: e instanceof Error ? e.message : '미리보기에 실패했습니다.' }
  }
}

export async function applyWbsUpload(projectId: string, md: string): Promise<{
  ok: boolean; error?: string
  upserted?: number; ordersCreated?: number
  unmatched?: Array<{ id: string; assignee: string }>
}> {
  const g = await requireProjectAdmin(projectId)
  if (!g.ok) return { ok: false, error: g.error }

  try {
    // 클라이언트 미리보기를 신뢰하지 않는다 — 전 과정 재검증(fail-closed).
    const { doc, role, errors } = parseAndValidate(md)
    if (errors.length > 0) return { ok: false, error: `검증 실패 ${errors.length}건: ${errors.slice(0, 3).join(' / ')}` }
    const module_ = doc.front.module ?? ''
    if (!/^[A-Za-z0-9_-]{1,32}$/.test(module_)) return { ok: false, error: 'module 형식이 올바르지 않습니다.' }

    const admin = createAdminClient()
    let attachRef: string | null = null
    if (role === 'pl' && doc.front.attach) {
      const r = await resolveAttachRef(admin, projectId, doc.front.attach)
      if (!r.ref) {
        return { ok: false, error: r.ambiguous
          ? `attach 부착점이 모호합니다: ${doc.front.attach}`
          : `attach 노드가 서버에 없습니다: ${doc.front.attach} — 골격을 먼저 업로드하세요.` }
      }
      attachRef = r.ref
    }

    const result = await runWbsImport(admin, {
      projectId, module: module_, actorUserId: g.actor.userId,
      levels: doc.levels, attachRef, nodes: toImportNodes(doc),
    })
    if (!result.ok) return { ok: false, error: result.message }

    revalidatePath(`/p/${projectId}/wbs`)
    return { ok: true, upserted: result.upserted, ordersCreated: result.ordersCreated, unmatched: result.unmatched }
  } catch (e) {
    console.error('[wbs-md] 적용 실패:', e instanceof Error ? e.message : e)
    return { ok: false, error: e instanceof Error ? e.message : '업로드에 실패했습니다.' }
  }
}
