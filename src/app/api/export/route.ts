import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { getComputedWbs } from '@/lib/data/wbs'
import { listProjects } from '@/app/actions/project'
import { buildWbsWorkbook } from '@/lib/excel/export'

// 현재 WBS를 xlsx로 내보낸다(읽기 전용 — 로그인 사용자 누구나). 임포트 포맷과 라운드트립.
export async function GET(req: NextRequest) {
  if (!(await getSession())) return NextResponse.json({ error: '인증이 필요합니다.' }, { status: 401 })

  const projectId = req.nextUrl.searchParams.get('projectId')
  if (!projectId) return NextResponse.json({ error: '프로젝트 누락' }, { status: 400 })

  const [{ items, holidays }, projects] = await Promise.all([getComputedWbs(projectId), listProjects()])
  const project = (projects as { id: string; name: string }[]).find(p => p.id === projectId)
  const name = project?.name ?? 'WBS'

  const buf = buildWbsWorkbook(items, holidays.map(d => ({ date: d, name: '' })), name)
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date())
  const filename = `WBS_${name}_${today}.xlsx`.replace(/[^\w가-힣.\-]+/g, '_')

  return new NextResponse(buf, {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="wbs_export.xlsx"; filename*=UTF-8''${encodeURIComponent(filename)}`,
      'Cache-Control': 'no-store',
    },
  })
}
