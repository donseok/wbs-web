import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { getMembership } from '@/lib/auth'
import { parseWbsWorkbook } from '@/lib/excel/parse'
import { splitLeafOwners, validateAndLink } from '@/lib/excel/validate'
import { ingestProject } from '@/lib/ai/ingest'
import { teamsSync } from '@/lib/teams/master'
import { recordProgressSnapshot } from '@/lib/data/snapshots'

export async function POST(req: NextRequest) {
  const m = await getMembership()
  if (m?.role !== 'pmo_admin') return NextResponse.json({ error: '권한 없음' }, { status: 403 })
  const form = await req.formData()
  const file = form.get('file') as File | null
  const projectId = String(form.get('projectId') ?? '')
  if (!file || !projectId) return NextResponse.json({ error: '파일/프로젝트 누락' }, { status: 400 })

  const parsed = parseWbsWorkbook(await file.arrayBuffer())

  // 팀 마스터 대조 — 미등록 팀 헤더는 조용한 스킵 대신 팀명을 담아 명시 거부(마스터 등록 선행).
  const registered = new Set(teamsSync().map(t => t.code))
  const unknownTeams = [...new Set(parsed.rows.flatMap(r => r.owners.map(o => o.team)))]
    .filter(t => !registered.has(t))
  if (unknownTeams.length > 0) {
    return NextResponse.json({
      errors: [`등록되지 않은 팀 열이 있습니다: ${unknownTeams.join(', ')} — 관리자 화면(팀 관리)에서 먼저 등록하세요.`],
    }, { status: 400 })
  }

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

  // 임포트는 실적·계획 전면 교체 — 즉시 스냅샷 기록(라우트라 await로 충분).
  await recordProgressSnapshot(projectId)

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
