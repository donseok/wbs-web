import { notFound } from 'next/navigation'
import { getMinuteDetail, getMinuteAnnotations, getMinuteCommitments } from '@/lib/data/minutes'
import { getMembership, getSession } from '@/lib/auth'
import { listProjects } from '@/app/actions/project'
import { MinuteViewer } from '@/components/minutes/MinuteViewer'
import { parseMinuteSourceAnchor } from '@/lib/minutes/source'

export default async function MinuteDetailPage({
  params, searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{
    block?: string | string[]
    hash?: string | string[]
    body?: string | string[]
  }>
}) {
  const [{ id }, query] = await Promise.all([params, searchParams])
  const sourceAnchor = parseMinuteSourceAnchor(query)
  const [detail, annotations, commitments, m, user, projects] = await Promise.all([
    getMinuteDetail(id), getMinuteAnnotations(id), getMinuteCommitments(id),
    getMembership(), getSession(), listProjects(),
  ])
  if (!detail) notFound()
  const canManage = !!user && (detail.minute.createdBy === user.id || m?.role === 'pmo_admin')
  return (
    <MinuteViewer
      minute={detail.minute} files={detail.files} canManage={canManage}
      annotations={annotations} commitments={commitments}
      userId={user?.id ?? null} projects={projects}
      sourceAnchor={sourceAnchor}
    />
  )
}
