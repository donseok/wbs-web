import { NextResponse } from 'next/server'
import { getMembership } from '@/lib/auth'
import { dkbotHealth } from '@/lib/ai/health'

export const dynamic = 'force-dynamic'

/** DK Bot 진단 — 키 설정/마이그레이션 적용 상태를 노출(관리자 전용). 설정 화면 배지와 동일 소스. */
export async function GET() {
  const m = await getMembership()
  if (m?.role !== 'pmo_admin') return NextResponse.json({ error: '권한이 없습니다.' }, { status: 403 })
  try {
    return NextResponse.json(await dkbotHealth())
  } catch (e) {
    console.error('[dkbot] /api/chat/health 오류:', e)
    return NextResponse.json({ error: '헬스 체크에 실패했습니다.' }, { status: 500 })
  }
}
