'use client'

import { avatarLabel, presenceColor } from '@/lib/domain/sheetPresence'

/** 겹쳐 보여줄 아바타 상한 — 초과분은 +N 원으로 축약. */
const MAX_AVATARS = 5

/** 접속자 아바타 스트립 — 같은 화면을 보는 사용자(본인 포함)를 구글 문서식
 *  원형 아바타(이름 2자)로 겹쳐 표시. 전체 이름은 각 원의 title(툴팁)로.
 *  비어 있으면 아무것도 렌더하지 않는다. 색상은 userId 결정적(presenceColor). */
export function PresenceStrip({ online, meId }: {
  online: { userId: string; name: string }[]
  meId?: string | null
}) {
  if (online.length === 0) return null
  return (
    <div className="flex items-center" title={`함께 보는 중: ${online.map(o => o.name).join(', ')}`}>
      {online.slice(0, MAX_AVATARS).map(o => (
        <span key={o.userId} title={o.userId === meId ? `${o.name} (나)` : o.name}
          className="-ml-1.5 flex h-7 w-7 select-none items-center justify-center rounded-full text-[10px] font-bold text-white ring-2 ring-canvas first:ml-0"
          style={{ background: presenceColor(o.userId) }}>
          {avatarLabel(o.name)}
        </span>
      ))}
      {online.length > MAX_AVATARS && (
        <span className="-ml-1.5 flex h-7 w-7 items-center justify-center rounded-full bg-neutral-500 text-[10px] font-bold text-white ring-2 ring-canvas">
          +{online.length - MAX_AVATARS}
        </span>
      )}
    </div>
  )
}
