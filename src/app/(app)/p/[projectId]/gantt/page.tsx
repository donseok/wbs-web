import { redirect } from 'next/navigation'

// 간트는 WBS 화면(/wbs)에 통합되었다. 기존 북마크는 타임라인 집중 모드로 넘긴다.
export default async function GanttPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params
  redirect(`/p/${projectId}/wbs?view=timeline`)
}
