import { notFound } from 'next/navigation'
import { getMinuteDetail, getMinuteAnnotations } from '@/lib/data/minutes'
import { getMembership, getSession } from '@/lib/auth'
import { MinuteViewer } from '@/components/minutes/MinuteViewer'

export default async function MinuteDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const [detail, annotations, m, user] = await Promise.all([
    getMinuteDetail(id), getMinuteAnnotations(id), getMembership(), getSession(),
  ])
  if (!detail) notFound()
  const canManage = !!user && (detail.minute.createdBy === user.id || m?.role === 'pmo_admin')
  return (
    <MinuteViewer
      minute={detail.minute} files={detail.files} canManage={canManage}
      annotations={annotations} userId={user?.id ?? null}
    />
  )
}
