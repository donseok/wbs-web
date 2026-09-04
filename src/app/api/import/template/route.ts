import { NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { buildWbsTemplateWorkbook } from '@/lib/excel/template'

/** wbs.xlsx 양식 다운로드 — 프로젝트 무관(정적 내용). 로그인 사용자 누구나. 임포트 마법사 xlsx 탭의 "양식 다운로드". */
export async function GET() {
  if (!(await getSession())) return NextResponse.json({ error: '인증이 필요합니다.' }, { status: 401 })
  const buf = buildWbsTemplateWorkbook()
  return new NextResponse(buf, {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="wbs-template.xlsx"; filename*=UTF-8''${encodeURIComponent('wbs-양식.xlsx')}`,
      'Cache-Control': 'no-store',
    },
  })
}
