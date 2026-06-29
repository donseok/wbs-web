import { redirect } from 'next/navigation'

// 간트는 WBS 통합 뷰로 합쳐졌다. 기존 링크 보존을 위해 redirect.
export default async function GanttPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params
  redirect(`/p/${projectId}/wbs`)
}
