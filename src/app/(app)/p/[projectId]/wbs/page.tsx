import { getComputedWbs } from '@/lib/data/wbs'
import { getMembership } from '@/lib/auth'
import { WbsBoard } from '@/components/wbs/WbsBoard'

export default async function WbsPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params
  const [{ items, holidays, today }, m] = await Promise.all([getComputedWbs(projectId), getMembership()])
  return <WbsBoard items={items} holidays={holidays} today={today} membership={m} />
}
