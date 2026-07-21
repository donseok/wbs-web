'use client'
import { useMemo, useRef } from 'react'
import { splitMinuteBlocks } from '@/lib/minutes/blocks'
import type { TeamCode } from '@/lib/domain/types'
import { useLocale } from '@/components/providers/LocaleProvider'
import { BrandGlyph } from '@/components/ui/BrandMark'
import { TEAM } from '@/components/wbs/shared'
import { MarkdownView } from './MarkdownView'
import { MinuteToc } from './MinuteToc'
import { useMinuteTocSpy } from './useMinuteTocSpy'
import { MinuteFontSizeControl } from './MinuteFontSizeControl'
import { useMinuteFontSize } from './useMinuteFontSize'

/** 비로그인 외부 열람 전용 미니멀 뷰어 — 본문+목차만(스펙 §3.3). 채팅·하이라이트·인사이트·첨부 없음. */
export function ShareViewer({ minuteDate, teamCode, title, bodyMd }: {
  minuteDate: string
  teamCode: TeamCode
  title: string
  bodyMd: string
}) {
  const { t } = useLocale()
  const bodyRef = useRef<HTMLDivElement>(null)
  const blocks = useMemo(() => splitMinuteBlocks(bodyMd), [bodyMd])
  const { activeToc, jumpTo } = useMinuteTocSpy(blocks, bodyRef)
  // 비로그인 열람 — 서버 저장 없이 localStorage 에만 유지(스펙 §4.2)
  const fs = useMinuteFontSize({ persist: false })

  return (
    <div className="app-backdrop min-h-screen">
      <div className="flex w-full flex-col gap-4 px-4 py-6 sm:px-5 lg:px-7">
        <div className="card flex flex-wrap items-center gap-3 p-4">
          <BrandGlyph size={28} />
          <span className="text-sm tabular-nums text-ink-muted">{minuteDate}</span>
          <span className={`inline-flex rounded-md px-1.5 py-0.5 text-[11px] font-bold text-white ${TEAM[teamCode].bar}`}>
            {teamCode}
          </span>
          <h1 className="min-w-0 flex-1 truncate text-lg font-bold text-ink">{title}</h1>
          <span className="text-xs text-ink-subtle">{t('min.share.readonly')}</span>
          <MinuteFontSizeControl
            size={fs.size} onDec={fs.dec} onInc={fs.inc} onReset={fs.reset}
            canDec={fs.canDec} canInc={fs.canInc}
          />
        </div>
        <div className="flex flex-col gap-4 xl:flex-row">
          <MinuteToc blocks={blocks} insights={[]} highlights={[]} onJump={jumpTo} activeIndex={activeToc} />
          <div ref={bodyRef} className="card min-w-0 flex-1 p-5"
            style={{ '--minutes-fs': `${fs.size}px` } as React.CSSProperties}>
            <MarkdownView content={bodyMd} />
          </div>
        </div>
      </div>
    </div>
  )
}
