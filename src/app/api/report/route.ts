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
import { fillWeeklyTemplate, fillSheetTemplate } from '@/lib/report/templateFill'
import { mondayIso, sheetWeekMeta } from '@/lib/report/week'
import { buildSheetSections, sheetLineText } from '@/lib/report/sheetNarrative'
import { getWeeklySheet } from '@/lib/data/weeklySheet'
import { briefToExtraSlide, type ExtraNarrativeSlide } from '@/lib/report/aiComment'
import { loadProjectFacts } from '@/lib/ai/projectFacts'
import { briefFactsHash, buildBriefFacts } from '@/lib/ai/brief'
import { getAiBrief } from '@/lib/data/aiBriefs'

// exceljs·템플릿 zip 읽기(fs)는 Node 전용 → Edge 런타임 금지.
export const runtime = 'nodejs'

/** 시각을 Asia/Seoul 'YYYY-MM-DD HH:mm' 으로. */
function seoulStamp(at: Date | string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(typeof at === 'string' ? new Date(at) : at)
  const get = (t: string) => parts.find(p => p.type === t)?.value ?? ''
  return `${get('year')}-${get('month')}-${get('day')} ${get('hour')}:${get('minute')}`
}

/** 현재 시각(Asia/Seoul). */
const seoulNow = (): string => seoulStamp(new Date())

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

  // ── 주간업무 시트 PPT (source=sheet): WBS 모델 페치를 우회하고 시트 rows만 사용 ──
  const source = req.nextUrl.searchParams.get('source')
  if (source === 'sheet') {
    if (format !== 'pptx') return NextResponse.json({ error: '시트 보고서는 pptx만 지원합니다' }, { status: 400 })
    const week = req.nextUrl.searchParams.get('week')
    if (!week || !/^\d{4}-\d{2}-\d{2}$/.test(week)) {
      return NextResponse.json({ error: 'week(YYYY-MM-DD)가 필요합니다' }, { status: 400 })
    }
    const weekStart = mondayIso(week) // 임의 날짜 → 월요일 정규화(스펙 §7)
    const [projects, sheet] = await Promise.all([listProjects(), getWeeklySheet(projectId, weekStart)])
    const project = (projects as { id: string; name: string }[]).find(p => p.id === projectId)
    if (!project) return NextResponse.json({ error: '프로젝트를 찾을 수 없습니다' }, { status: 404 })
    const hasContent = sheet?.rows.some(r =>
      (r.thisContent + r.thisIssue + r.nextContent + r.nextIssue).trim() !== '')
    if (!sheet || !hasContent) {
      return NextResponse.json({ error: '해당 주차에 작성된 내용이 없습니다' }, { status: 400 })
    }
    const wk = sheetWeekMeta(weekStart)
    // 구분(업무영역)당 1페이지 — 내용 없는 구분도 페이지를 만들고, 각 페이지에 그 구분의 실적·계획·이슈·이벤트를 함께 싣는다.
    const body = await fillSheetTemplate(
      buildSheetSections(sheet.rows),
      { meta: { prevWeekRange: wk.thisRange, weekRange: wk.nextRange } }, // 좌=금주실적, 우=차주계획
      { labels: { left: '금주실적', right: '차주계획' }, lineFormatter: sheetLineText },

    )
    const filename = `${project.name}_주간업무_${wk.weekTag}_${weekStart}.pptx`.replace(/[^\w가-힣.\-]+/g, '_')
    return new NextResponse(body as unknown as ArrayBuffer, { // Buffer 단독 타입 → 기존 반환부(route.ts:74)의 ArrayBuffer|Buffer 유니온과 달리 unknown 경유 필요
      headers: {
        'Content-Type': FORMATS.pptx.type,
        'Content-Disposition': `attachment; filename="report.pptx"; filename*=UTF-8''${encodeURIComponent(filename)}`,
        'Cache-Control': 'no-store',
      },
    })
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

  // ── AI 코멘트 슬라이드(ai=1, pptx 전용) — LLM 0콜: 캐시된 주간 브리핑을 읽기만 한다.
  // 신선도는 팩트 해시 재계산으로 서버가 최종 판정 — stale 캐시로 조용한 구식 코멘트 PPT 를
  // 만드는 대신 409 로 정직하게 실패한다(UI 체크박스는 평시 게이트일 뿐, URL 직접 호출 방어).
  // loadProjectFacts 가 WBS 를 한 번 더 읽지만 온디맨드 다운로드 경로라 수용(코드 단일화 우선).
  let extra: ExtraNarrativeSlide | undefined
  if (format === 'pptx' && req.nextUrl.searchParams.get('ai') === '1') {
    const src = await loadProjectFacts(projectId)
    const facts = src ? buildBriefFacts(src) : null
    const row = facts ? await getAiBrief(projectId, 'weekly', facts.todayWbs) : null
    const fresh = !!row && !!facts && row.status === 'ready' && row.inputHash === briefFactsHash(facts)
    if (!fresh || !row) {
      return NextResponse.json(
        { error: 'AI 브리핑이 없거나 최신이 아닙니다. 대시보드에서 AI 브리핑을 먼저 생성하세요.' },
        { status: 409 },
      )
    }
    extra = briefToExtraSlide(
      { headline: row.headline, bodyMd: row.bodyMd },
      row.updatedAt ? seoulStamp(row.updatedAt) : seoulNow(),
    )
  }

  // pptx는 사내 D-Cube 템플릿(.pptx)의 slide2 표 셀만 교체 — 내용이 넘치면 동일 디자인의 연속 슬라이드 추가.
  const body = format === 'xlsx'
    ? await buildReportWorkbook(model)
    : await fillWeeklyTemplate(buildWeeklyNarrative(model), model, extra ? { extra } : {})

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
