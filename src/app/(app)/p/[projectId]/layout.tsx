import Link from 'next/link'

export default async function ProjectLayout({
  children,
  params,
}: {
  children: React.ReactNode
  params: Promise<{ projectId: string }>
}) {
  const { projectId } = await params
  const base = `/p/${projectId}`
  return (
    <div className="space-y-4 p-4">
      <nav className="flex gap-3 border-b pb-2 text-sm">
        <Link href={`${base}/wbs`}>WBS</Link>
        <Link href={`${base}/dashboard`}>대시보드</Link>
        <Link href={`${base}/settings`}>설정</Link>
      </nav>
      {children}
    </div>
  )
}
