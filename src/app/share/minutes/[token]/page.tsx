import { notFound } from 'next/navigation'
import { createAdminClient } from '@/lib/supabase/admin'
import { isShareToken } from '@/lib/minutes/share'
import { ShareViewer } from '@/components/minutes/ShareViewer'
import type { TeamCode } from '@/lib/domain/types'

// 공유 OFF/재발급이 다음 요청부터 즉시 반영되도록 정적 캐시 금지
export const dynamic = 'force-dynamic'
export const metadata = { robots: { index: false, follow: false } }

export default async function SharedMinutePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  if (!isShareToken(token)) notFound()
  const admin = createAdminClient()
  // 반환 컬럼 화이트리스트(스펙 §3.2) — 작성자 실명·첨부·하이라이트·인사이트 미노출
  const { data } = await admin.from('minutes')
    .select('minute_date, team_code, title, body_md')
    .eq('share_token', token).eq('share_enabled', true).maybeSingle()
  if (!data) notFound()
  return (
    <ShareViewer
      minuteDate={data.minute_date as string}
      teamCode={data.team_code as TeamCode}
      title={data.title as string}
      bodyMd={data.body_md as string}
    />
  )
}
