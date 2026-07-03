import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { getMembership } from '@/lib/auth'
import { parseWbsWorkbook } from '@/lib/excel/parse'
import { splitLeafOwners, validateAndLink } from '@/lib/excel/validate'
import { ingestProject } from '@/lib/ai/ingest'

export async function POST(req: NextRequest) {
  const m = await getMembership()
  if (m?.role !== 'pmo_admin') return NextResponse.json({ error: '권한 없음' }, { status: 403 })
  const form = await req.formData()
  const file = form.get('file') as File | null
  const projectId = String(form.get('projectId') ?? '')
  if (!file || !projectId) return NextResponse.json({ error: '파일/프로젝트 누락' }, { status: 400 })

  const parsed = parseWbsWorkbook(await file.arrayBuffer())
  const result = validateAndLink(parsed)
  if (!result.ok) return NextResponse.json({ errors: result.errors }, { status: 400 })

  // 복수 담당 말단 항목은 담당별 sub-activity 로 분리해 팀별 실적 관리 가능하게.
  const items = splitLeafOwners(result.items)

  const sb = await createServerClient()
  // 원자적 임포트: RPC 한 번으로 전체 삽입(중간 실패 시 전부 롤백 → '부분 반영' 방지).
  const { data, error } = await sb.rpc('import_wbs', {
    p_project_id: projectId,
    p_items: items,
    p_holidays: parsed.holidays,
  })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // 임포트 성공 후 DK Bot 의미검색 색인 갱신(베스트에포트 — 임베딩 키 없으면 자동 skip).
  let reindexed = 0
  try {
    reindexed = (await ingestProject(projectId)).count
  } catch (e) {
    console.error('[dkbot] 임포트 후 색인 실패(무시):', e)
  }

  return NextResponse.json({
    ok: true,
    count: typeof data === 'number' ? data : items.length,
    reindexed,
  })
}
