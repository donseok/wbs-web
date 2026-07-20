import { Skeleton } from '@/components/ui/Skeleton'

/**
 * 회의록 세그먼트 공용 로딩 폴백 — 목록(/minutes)과 상세(/minutes/[id])를 함께 덮는다.
 * 위치 근거는 p/[projectId]/loading.tsx 주석과 동일: 상위 (app)/loading.tsx 의 경계는
 * /minutes → /minutes/[id] 이동에서 재마운트되지 않아 무반응 구간이 그대로 남는다.
 *
 * 두 화면의 골격이 달라(목록=히어로+뷰, 상세=메타 헤더+본문+챗 패널) 공통 분모인
 * "상단 바 + 본문(+ xl 이상에서 우측 패널)"만 잡는다.
 */
export default function Loading() {
  return (
    <div className="flex h-full min-h-0 flex-col gap-4" role="status" aria-label="회의록을 불러오는 중">
      <Skeleton className="h-14 shrink-0 rounded-2xl" />
      <div className="grid min-h-0 flex-1 gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
        <Skeleton className="h-[420px] rounded-2xl" />
        <Skeleton className="hidden h-[420px] rounded-2xl xl:block" />
      </div>
    </div>
  )
}
