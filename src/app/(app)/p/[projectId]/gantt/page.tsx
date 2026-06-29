import { getComputedWbs } from '@/lib/data/wbs'
import { GanttView } from '@/components/wbs/GanttView'

export default async function GanttPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params
  const { items, holidays, today } = await getComputedWbs(projectId)
  return <GanttView items={items} holidays={holidays} today={today} />
}
