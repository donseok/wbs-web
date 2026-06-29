import { getComputedWbs } from '@/lib/data/wbs'
import { getMembership } from '@/lib/auth'
import { WbsGanttSheet } from '@/components/wbs/WbsGanttSheet'

export default async function WbsPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params
  const [{ items, holidays, today }, m] = await Promise.all([
    getComputedWbs(projectId),
    getMembership(),
  ])
  return <WbsGanttSheet items={items} holidays={holidays} today={today} membership={m} />
}
