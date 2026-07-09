import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { getComputedWbs } from '@/lib/data/wbs'
import { getProjectMembers } from '@/lib/data/members'
import { getAttendanceRecords } from '@/lib/data/attendance'
import { getProjectMeetingData } from '@/lib/data/meetings'
import { getAnnouncements } from '@/lib/data/announcements'
import { listProjects } from '@/app/actions/project'
import { buildWeeklyReportModel } from '@/lib/report/weekly'
import { buildReportWorkbook } from '@/lib/report/excel'
import { buildWeeklyNarrative } from '@/lib/report/narrative'
import { fillWeeklyTemplate } from '@/lib/report/templateFill'

// exceljs·템플릿 zip 읽기(fs)는 Node 전용 → Edge 런타임 금지.
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
 * 현황 보고서를 Excel/PPT로 내보낸다(읽기 전용 — /api/export와 동일, 로그인 사용자 누구나).
 * 데이터 페치는 RLS가 적용돼 권한이 자동 반영된다. 화면 모달과 동일한 buildReportModel 사용.
 */
export async function GET(req: NextRequest) {
  if (!(await getSession())) return NextResponse.json({ error: '인증이 필요합니다.' }, { status: 401 })

  const projectId = req.nextUrl.searchParams.get('projectId')
  const format = req.nextUrl.searchParams.get('format')
  if (!projectId) return NextResponse.json({ error: '프로젝트 누락' }, { status: 400 })
  if (format !== 'xlsx' && format !== 'pptx') {
    return NextResponse.json({ error: 'format은 xlsx 또는 pptx여야 합니다' }, { status: 400 })
  }

  const [{ items, today }, projects, members, attendance, meetingData, announcements] = await Promise.all([
    getComputedWbs(projectId), listProjects(), getProjectMembers(projectId), getAttendanceRecords(projectId),
    getProjectMeetingData(projectId), getAnnouncements(projectId),
  ])
  const project = (projects as { id: string; name: string; description?: string | null; start_date?: string | null; end_date?: string | null }[]).find(
    p => p.id === projectId,
  )
  if (!project) return NextResponse.json({ error: '프로젝트를 찾을 수 없습니다' }, { status: 404 })

  const model = buildWeeklyReportModel(items, project, today, {
    members, attendance, generatedAt: seoulNow(),
    meetings: meetingData.meetings, meetingExceptions: meetingData.exceptions, announcements,
  })
  const meta = FORMATS[format]
  // pptx는 사내 D-Cube 템플릿(.pptx)의 slide2 표 셀만 교체 — 내용이 넘치면 동일 디자인의 연속 슬라이드 추가.
  const body = format === 'xlsx'
    ? await buildReportWorkbook(model)
    : await fillWeeklyTemplate(buildWeeklyNarrative(model), model)

  // 파일명: {프로젝트명}_{월기준 몇째주}_{기준일} (예: D-CUBE Project_7월1주차_2026-07-04)
  const filename = `${project.name}_${model.meta.weekTag}_${today}.${meta.ext}`.replace(/[^\w가-힣.\-]+/g, '_')

  return new NextResponse(body as ArrayBuffer, {
    headers: {
      'Content-Type': meta.type,
      'Content-Disposition': `attachment; filename="report.${meta.ext}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
      'Cache-Control': 'no-store',
    },
  })
}
