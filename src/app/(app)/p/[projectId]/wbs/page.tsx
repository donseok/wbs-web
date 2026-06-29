import { getComputedWbs } from '@/lib/data/wbs'
import { getMembership } from '@/lib/auth'
import { WbsSheet } from '@/components/wbs/WbsSheet'

export default async function WbsPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params
  const [{ items }, m] = await Promise.all([getComputedWbs(projectId), getMembership()])
  return <WbsSheet items={items} membership={m} />
}
