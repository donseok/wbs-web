import { notFound } from 'next/navigation'
import {
  getMinuteDetail, getMinuteAnnotations, getMinuteVersions, getMinuteWikiImpact,
  getMinuteVersionBody,
} from '@/lib/data/minutes'
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
    version?: string | string[]
  }>
}) {
  const [{ id }, query] = await Promise.all([params, searchParams])
  const sourceAnchor = parseMinuteSourceAnchor(query)
  const requestedVersionId = typeof query.version === 'string' ? query.version : null
  // prefs 는 기존 병렬 묶음에 합류 — 직렬 왕복 단수는 그대로다(스펙 §4.5)
  const [detail, annotations, versions, requestedVersion, m, user, projects, prefs] = await Promise.all([
    getMinuteDetail(id), getMinuteAnnotations(id), getMinuteVersions(id),
    requestedVersionId ? getMinuteVersionBody(id, requestedVersionId) : Promise.resolve(null),
    getMembership(), getSession(), listProjects(), getUiPrefs(),
  ])
  if (!detail) notFound()
  if (requestedVersionId && !requestedVersion) notFound()
  const wikiImpact = await getMinuteWikiImpact(
    id,
    detail.minute.projectId ?? null,
    detail.minute.projectName ?? null,
  )
  const historicalVersion = requestedVersion
    ? { id: requestedVersion.id, versionNo: requestedVersion.versionNo }
    : null
  const displayMinute = requestedVersion
    ? {
      ...detail.minute,
      bodyMd: requestedVersion.bodyMd,
      title: requestedVersion.title ?? detail.minute.title,
      minuteDate: requestedVersion.minuteDate ?? detail.minute.minuteDate,
      teamCode: requestedVersion.teamCode ?? detail.minute.teamCode,
      meetingId: requestedVersion.meetingId,
      projectId: requestedVersion.projectId,
      projectName: projects.find(project => project.id === requestedVersion.projectId)?.name ?? null,
      meetingOccurrenceDate: requestedVersion.meetingOccurrenceDate,
      updatedAt: requestedVersion.createdAt,
    }
    : detail.minute
  const displayAnnotations = requestedVersion ? { highlights: [], insights: [] } : annotations
  const canManage = !requestedVersion
    && !detail.minute.archivedAt
    && !!user
    && (detail.minute.createdBy === user.id || m?.role === 'pmo_admin')
  return (
    <MinuteViewer
      minute={displayMinute} files={detail.files} canManage={canManage}
      annotations={displayAnnotations} userId={user?.id ?? null} projects={projects}
      sourceAnchor={sourceAnchor} initialFontSize={prefs.minuteFontSize ?? null}
      versions={versions} wikiImpact={wikiImpact}
      historicalVersion={historicalVersion}
    />
  )
}
