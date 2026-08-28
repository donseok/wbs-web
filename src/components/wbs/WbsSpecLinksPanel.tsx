'use client'

import { useEffect, useState } from 'react'
import { GitBranch } from 'lucide-react'
import { getWbsSpecLinks, type SpecLinkItem, type WbsSpecLinks } from '@/app/actions/wbsSpec'
import { specLinkState, specStartReadiness } from '@/lib/domain/specDependency'
import { useLocale } from '@/components/providers/LocaleProvider'
import type { DictKey } from '@/lib/i18n/dict'

const SPEC_STAGE_KEYS: Record<string, DictKey> = {
  as: 'wbs.stageAs', fp: 'wbs.stageFp', ip: 'wbs.stageIp', im: 'wbs.stageIm', xx: 'wbs.stageXx',
}

const STATE_STYLE = {
  satisfied: { label: 'wbs.depSatisfied' as DictKey, cls: 'border-done/35 bg-done-weak text-done' },
  waiting: { label: 'wbs.depWaiting' as DictKey, cls: 'border-pending/35 bg-pending-weak text-pending' },
  unknown: { label: 'wbs.depUnknown' as DictKey, cls: 'border-delayed/35 bg-delayed-weak text-delayed' },
}

/** external_ref(<module>/<id>) 는 마지막 세그먼트만 보여준다. 전체는 title 로. */
function lastSegment(ref: string): string {
  const idx = ref.lastIndexOf('/')
  return idx === -1 ? ref : ref.slice(idx + 1)
}

/**
 * 명세 선행·후행 항목(§실행 순서 축) — 명세 패널에서 분리한 독립 섹션.
 *
 * 아래쪽 "작업 의존성"(task_dependencies)과는 다른 축이다: 이쪽은 wbs.md import 로만 들어오는
 * depends(external_ref)이며 에이전트 claim 게이트·후행 알림의 근거고, 저쪽은 화면에서 직접 잇는
 * FS/SS 로 일정 계산·간트 연결선에 쓰인다. 둘은 동기화되지 않는다.
 */
export function WbsSpecLinksPanel({ itemId, onSelectItem }: {
  itemId: string
  /** 항목 클릭 시 그 작업으로 상세를 갈아끼운다. 없으면 클릭 불가 텍스트로 남는다. */
  onSelectItem?: (id: string) => void
}) {
  const { t } = useLocale()
  // 실패는 'error' 로 남긴다 — 빈 배열로 내리면 "선행 없음 → 시작 가능"으로 화면이 조용히 뒤집힌다.
  const [links, setLinks] = useState<WbsSpecLinks | 'error' | null>(null)

  useEffect(() => {
    let alive = true
    setLinks(null)
    getWbsSpecLinks(itemId).then(r => { if (alive) setLinks(r ?? 'error') }).catch(() => { if (alive) setLinks('error') })
    return () => { alive = false }
  }, [itemId])

  const readiness = links && links !== 'error' ? specStartReadiness(links.predecessors) : null

  return (
    <section className="rounded-xl border border-line bg-surface-2/40 p-3" aria-label={t('wbs.specLinksTitle')}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.08em] text-ink-subtle">
          <GitBranch className="h-3.5 w-3.5" /> {t('wbs.specLinksTitle')}
        </div>
        {readiness && (
          readiness.unknownCount > 0 ? (
            <span className="rounded-full border border-delayed/35 bg-delayed-weak px-2 py-0.5 text-[10px] font-bold text-delayed" role="status">
              {t('wbs.startUnknown').replace('{n}', String(readiness.unknownCount))}
            </span>
          ) : readiness.waitingCount > 0 ? (
            <span className="rounded-full border border-pending/35 bg-pending-weak px-2 py-0.5 text-[10px] font-bold text-pending" role="status">
              {t('wbs.startBlocked').replace('{n}', String(readiness.waitingCount))}
            </span>
          ) : (
            <span className="rounded-full border border-done/35 bg-done-weak px-2 py-0.5 text-[10px] font-bold text-done" role="status">
              {t('wbs.startReady')}
            </span>
          )
        )}
      </div>

      {links === 'error' ? (
        <p className="mt-2 text-xs font-medium text-delayed" role="alert">{t('wbs.specLinksLoadFail')}</p>
      ) : links === null ? (
        <p className="mt-2 text-xs text-ink-subtle">{t('common.loading')}</p>
      ) : (
        <div className="mt-2 space-y-2">
          <LinkList
            label={t('wbs.specDependsLabel')} emptyText={t('wbs.specDependsNone')}
            items={links.predecessors} showState onSelectItem={onSelectItem} t={t}
          />
          <LinkList
            label={t('wbs.specSuccessorsLabel')} emptyText={t('wbs.specSuccessorsNone')}
            items={links.successors} showState={false} onSelectItem={onSelectItem} t={t}
          />
        </div>
      )}
    </section>
  )
}

function LinkList({
  label, emptyText, items, showState, onSelectItem, t,
}: {
  label: string
  emptyText: string
  items: SpecLinkItem[]
  showState: boolean
  onSelectItem?: (id: string) => void
  t: (k: DictKey) => string
}) {
  return (
    <div>
      <div className="mb-1 text-[11px] font-semibold text-ink-muted">{label}</div>
      {items.length === 0 ? (
        <p className="text-xs text-ink-subtle">{emptyText}</p>
      ) : (
        <ul className="space-y-1">
          {items.map(item => <LinkRow key={item.ref} link={item} showState={showState} onSelectItem={onSelectItem} t={t} />)}
        </ul>
      )}
    </div>
  )
}

function LinkRow({
  link, showState, onSelectItem, t,
}: {
  link: SpecLinkItem
  showState: boolean
  onSelectItem?: (id: string) => void
  t: (k: DictKey) => string
}) {
  const state = specLinkState(link)
  const stageLabel = link.stage && SPEC_STAGE_KEYS[link.stage]
    ? t(SPEC_STAGE_KEYS[link.stage])
    : link.itemId ? t('wbs.stageNoneOption') : null
  const caption = link.name ?? lastSegment(link.ref)
  return (
    <li className="flex items-center gap-2 rounded-lg border border-line bg-surface px-2 py-1.5 text-xs">
      {link.itemId && onSelectItem ? (
        <button
          type="button"
          onClick={() => onSelectItem(link.itemId!)}
          className="min-w-0 flex-1 truncate text-left text-ink underline-offset-2 transition hover:text-brand hover:underline"
          title={`${caption} — ${t('wbs.openTaskDetail')}`}
        >
          <span className="mr-1 text-ink-subtle">{link.code ?? lastSegment(link.ref)}</span>
          {link.name}
        </button>
      ) : link.itemId ? (
        // 이동 콜백이 없어도 해석된 항목은 코드·이름을 그대로 보여준다(클릭만 못 할 뿐).
        <span className="min-w-0 flex-1 truncate text-ink" title={caption}>
          <span className="mr-1 text-ink-subtle">{link.code ?? lastSegment(link.ref)}</span>
          {link.name}
        </span>
      ) : (
        <span className="min-w-0 flex-1 truncate text-ink-subtle" title={link.ref}>{lastSegment(link.ref)}</span>
      )}
      {stageLabel && <span className="shrink-0 rounded bg-surface-2 px-1.5 py-0.5 text-[10px] font-semibold text-ink-muted">{stageLabel}</span>}
      {showState && (
        <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-bold ${STATE_STYLE[state].cls}`}>
          {t(STATE_STYLE[state].label)}
        </span>
      )}
    </li>
  )
}
