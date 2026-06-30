import { NextRequest, NextResponse } from 'next/server'
import { getComputedWbs } from '@/lib/data/wbs'
import { getProjectMembers } from '@/lib/data/members'
import { getAttendanceRecords } from '@/lib/data/attendance'
import { listProjects } from '@/app/actions/project'
import { buildWeeklyReportModel } from '@/lib/report/weekly'
import { buildReportWorkbook } from '@/lib/report/excel'
import { buildReportDeck } from '@/lib/report/pptx'

// pptxgenjs/exceljs는 Node 전용 → Edge 런타임 금지.
export const runtime = 'nodejs'

/** 현재 시각을 Asia/Seoul 'YYYY-MM-DD HH:mm' 으로. */
function seoulNow(): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(new Date())
  const get = (t: string) => parts.find(p => p.type === t)?.value ?? ''
  return `${get('year')}-${get('month')}-${get('day')} ${get('hour')}:${get('minute')}`
}

const FORMATS = {
  xlsx: {
    ext: 'xlsx',
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  },
  pptx: {
    ext: 'pptx',
    type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  },
} as const

/**
 * 현황 보고서를 Excel/PPT로 내보낸다(읽기 전용 — /api/export와 동일, 데모 포함 누구나).
 * 데이터 페치는 RLS가 적용돼 권한이 자동 반영된다. 화면 모달과 동일한 buildReportModel 사용.
 */
export async function GET(req: NextRequest) {
  const projectId = req.nextUrl.searchParams.get('projectId')
  const format = req.nextUrl.searchParams.get('format')
  if (!projectId) return NextResponse.json({ error: '프로젝트 누락' }, { status: 400 })
  if (format !== 'xlsx' && format !== 'pptx') {
    return NextResponse.json({ error: 'format은 xlsx 또는 pptx여야 합니다' }, { status: 400 })
  }

  const [{ items, today }, projects, members, attendance] = await Promise.all([
    getComputedWbs(projectId), listProjects(), getProjectMembers(projectId), getAttendanceRecords(projectId),
  ])
  const project = (projects as { id: string; name: string; description?: string | null; start_date?: string | null; end_date?: string | null }[]).find(
    p => p.id === projectId,
  )
  if (!project) return NextResponse.json({ error: '프로젝트를 찾을 수 없습니다' }, { status: 404 })

  const model = buildWeeklyReportModel(items, project, today, { members, attendance, generatedAt: seoulNow() })
  const meta = FORMATS[format]
  const body = format === 'xlsx' ? await buildReportWorkbook(model) : await buildReportDeck(model)

  const docName = format === 'xlsx' ? '공정보고' : '주간보고'
  const filename = `${docName}_${project.name}_${today}.${meta.ext}`.replace(/[^\w가-힣.\-]+/g, '_')

  return new NextResponse(body as ArrayBuffer, {
    headers: {
      'Content-Type': meta.type,
      'Content-Disposition': `attachment; filename="report.${meta.ext}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
      'Cache-Control': 'no-store',
    },
  })
}
