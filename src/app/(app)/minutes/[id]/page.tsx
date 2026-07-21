import { notFound } from 'next/navigation'
import { getMinuteDetail, getMinuteAnnotations } from '@/lib/data/minutes'
import { getMembership, getSession } from '@/lib/auth'
import { listProjects } from '@/app/actions/project'
import { getUiPrefs } from '@/app/actions/preferences'
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
  // prefs 는 기존 병렬 묶음에 합류 — 직렬 왕복 단수는 그대로다(스펙 §4.5)
  const [detail, annotations, m, user, projects, prefs] = await Promise.all([
    getMinuteDetail(id), getMinuteAnnotations(id), getMembership(), getSession(), listProjects(),
    getUiPrefs(),
  ])
  if (!detail) notFound()
  const canManage = !!user && (detail.minute.createdBy === user.id || m?.role === 'pmo_admin')
  return (
    <MinuteViewer
      minute={detail.minute} files={detail.files} canManage={canManage}
      annotations={annotations} userId={user?.id ?? null} projects={projects}
      sourceAnchor={sourceAnchor} initialFontSize={prefs.minuteFontSize ?? null}
    />
  )
}
