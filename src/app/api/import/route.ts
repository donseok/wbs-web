import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { getMembership } from '@/lib/auth'
import { parseWbsWorkbook } from '@/lib/excel/parse'
import { validateAndLink } from '@/lib/excel/validate'

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

  const sb = await createServerClient()
  // 팀 코드 → id 매핑
  const { data: teams } = await sb.from('teams').select('id, code')
  const teamId = new Map((teams ?? []).map((t: { code: string; id: string }) => [t.code, t.id]))

  // 1패스: tempId 순서대로 insert, id 회수
  const idMap = new Map<string, string>()
  for (const it of result.items) {
    const { data, error } = await sb.from('wbs_items').insert({
      project_id: projectId,
      parent_id: it.parentTempId ? idMap.get(it.parentTempId) : null,
      level: it.level, code: it.code, sort_order: it.sortOrder, name: it.name,
      biz: it.biz, deliverable: it.deliverable, planned_start: it.plannedStart, planned_end: it.plannedEnd,
      weight: it.weight, actual_pct: it.actualPct,
    }).select('id').single()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    idMap.set(it.tempId, data.id)
    // owners
    for (const o of it.owners) {
      await sb.from('item_owners').insert({ wbs_item_id: data.id, team_id: teamId.get(o.team), kind: o.kind })
    }
  }
  // holidays
  for (const h of parsed.holidays) {
    await sb.from('holidays').upsert({ project_id: projectId, date: h.date, name: h.name })
  }
  return NextResponse.json({ ok: true, count: result.items.length })
}
