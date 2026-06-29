import { Eye } from 'lucide-react'
import { DEMO } from '@/lib/demo'

/** 데모 모드 안내 배너 — 인증 우회 + 모든 쓰기 비활성(읽기 전용). DEMO일 때만 렌더. */
export function DemoBanner() {
  if (!DEMO) return null
  return (
    <div
      role="status"
      className="flex items-center justify-center gap-2 border-b border-accent-warning/30 bg-accent-warning/10 px-4 py-1.5 text-center text-[12px] font-medium text-accent-warning"
    >
      <Eye className="h-3.5 w-3.5 shrink-0" aria-hidden />
      <span>
        데모 모드 — 실제 데이터 없이 <strong>읽기 전용</strong>으로 둘러보는 중입니다. 편집·저장은 비활성화됩니다.
      </span>
    </div>
  )
}
