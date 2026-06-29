import { getComputedWbs } from '@/lib/data/wbs'
import { DashboardView } from '@/components/dashboard/DashboardView'

export default async function Dashboard({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params
  const { items } = await getComputedWbs(projectId)
  return <DashboardView items={items} />
}
