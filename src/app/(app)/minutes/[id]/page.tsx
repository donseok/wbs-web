import { notFound } from 'next/navigation'
import {
  getMinuteDetail, getMinuteAnnotations, getMinuteVersions, getMinuteWikiImpact,
  getMinuteVersionBody, getMinuteFolderPath,
} from '@/lib/data/minutes'
import { getSession } from '@/lib/auth'
import { getActor } from '@/lib/authz'
import { isProjectAdmin } from '@/lib/domain/authz'
import { listProjects } from '@/app/actions/project'
import { getUiPrefs } from '@/app/actions/preferences'
import { MinuteViewer } from '@/components/minutes/MinuteViewer'
import { parseMinuteSourceAnchor } from '@/lib/minutes/source'
import { getMinuteLinkedIssues } from '@/lib/data/issues'
import { getProjectMembers, getMyProjectIds } from '@/lib/data/members'

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
  const [detail, annotations, versions, requestedVersion, m, user, projects, prefs, linkedIssues] = await Promise.all([
    getMinuteDetail(id), getMinuteAnnotations(id), getMinuteVersions(id),
    requestedVersionId ? getMinuteVersionBody(id, requestedVersionId) : Promise.resolve(null),
    getActor(), getSession(), listProjects(), getUiPrefs(), getMinuteLinkedIssues(id),
  ])
  if (!detail) notFound()
  if (requestedVersionId && !requestedVersion) notFound()
  const issueProjectId = detail.minute.projectId ?? detail.minute.meetingProjectId ?? null
  // folderPath 는 folderId 를 알아야 풀 수 있어 이 2단 묶음에 합류시킨다 — 위 Promise.all 로
  // 끌어올릴 수 없고, 단독으로 await 하면 직렬 왕복이 한 단 더 붙는다.
  const [wikiImpact, issueMembers, folderPath, myProjectIds] = await Promise.all([
    getMinuteWikiImpact(
      id,
      detail.minute.projectId ?? null,
      detail.minute.projectName ?? null,
    ),
    issueProjectId ? getProjectMembers(issueProjectId) : Promise.resolve([]),
    getMinuteFolderPath(detail.minute.folderId ?? null),
    getMyProjectIds(),
  ])
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
  // 미지정(projectId null) 회의록은 isProjectAdmin(m, null)=슈퍼유저만 — 서버 checkOwner 와 같은 규칙.
  const canManage = !requestedVersion
    && !detail.minute.archivedAt
    && !!user
    && (detail.minute.createdBy === user.id || isProjectAdmin(m, detail.minute.projectId ?? null))
  return (
    <MinuteViewer
      minute={displayMinute} files={detail.files} canManage={canManage}
      annotations={displayAnnotations} userId={user?.id ?? null} projects={projects}
      sourceAnchor={sourceAnchor} initialFontSize={prefs.minuteFontSize ?? null}
      versions={versions} wikiImpact={wikiImpact}
      historicalVersion={historicalVersion}
      issueMembers={issueMembers} linkedIssues={linkedIssues}
      folderPath={folderPath} myProjectIds={myProjectIds}
    />
  )
}
