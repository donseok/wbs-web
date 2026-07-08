'use client'

import { useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Download, FileText, Plus, Trash2 } from 'lucide-react'
import { useLocale } from '@/components/providers/LocaleProvider'
import { useToast } from '@/components/ui/Toast'
import { Modal } from '@/components/ui/Modal'
import { EmptyState } from '@/components/ui/EmptyState'
import { SegmentedTabs, type SegTab } from '@/components/ui/SegmentedTabs'
import { canCreateMinutes, canDeleteMinutes, filterMinutes } from '@/lib/domain/minutes'
import { deleteMinutes, getMinutesFileUrl } from '@/app/actions/minutes'
import { MinutesUploadModal } from './MinutesUploadModal'
import type { MeetingMinutes, Membership, TeamOption } from '@/lib/domain/types'

/** 삭제 확인 다이얼로그의 위험 버튼 — AnnouncementsView.tsx:537 과 동일한 클래스 조합. */
const DANGER_BTN =
  'btn bg-delayed text-white shadow-sm transition hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-50'

export function MinutesView({
  projectId, initial, teams, membership, userId,
}: {
  projectId: string
  initial: MeetingMinutes[]
  teams: TeamOption[]
  membership: Membership | null
  userId: string | null
}) {
  const { t } = useLocale()
  const { toast } = useToast()
  const router = useRouter()

  // 팀은 teamId(uuid)로 거른다 — teams.code 의 '가공'은 비-ASCII 라 URL/쿼리에 부적합.
  const [teamId, setTeamId] = useState<string | null>(null)
  const [q, setQ] = useState('')
  const [uploadOpen, setUploadOpen] = useState(false)
  const [pendingDelete, setPendingDelete] = useState<MeetingMinutes | null>(null)
  const [downloadingId, setDownloadingId] = useState<string | null>(null)
  const [busy, startTransition] = useTransition()

  const rows = useMemo(() => filterMinutes(initial, { teamId, q }), [initial, teamId, q])

  // 어떤 팀에든 올릴 수 있으면 버튼을 보인다(모달 안에서 팀별로 다시 막고, 서버 액션이 최종 게이트다).
  const canUpload = useMemo(() => teams.some(tm => canCreateMinutes(membership, tm.id)), [teams, membership])

  const tabs: SegTab<string>[] = [
    { key: 'all', label: t('min.tab.all') },
    ...teams.map(tm => ({ key: tm.id, label: tm.code })),
  ]

  async function onDownload(row: MeetingMinutes) {
    if (downloadingId) return
    setDownloadingId(row.id)
    try {
      const { url } = await getMinutesFileUrl(row.id)
      if (!url) { toast({ title: t('min.err.downloadFail'), variant: 'error' }); return }
      // 반환값을 검사하지 말 것: 'noopener' 가 지정되면 명세상 window.open 은 성공해도 항상 null 을
      // 돌려준다(HTML §window.open). `if (!w) location.href = url` 류의 팝업차단 폴백은 매번 오발동한다.
      // 클릭 직후 await 1회이므로 transient activation(5s) 안에 열린다.
      window.open(url, '_blank', 'noopener,noreferrer')
    } catch {
      toast({ title: t('min.err.downloadFail'), variant: 'error' })
    } finally {
      setDownloadingId(null)
    }
  }

  function onConfirmDelete() {
    const row = pendingDelete
    if (!row) return
    startTransition(async () => {
      const res = await deleteMinutes(row.id).catch(() => null)
      setPendingDelete(null)
      if (!res || !res.ok) {
        toast({ title: t('min.err.deleteFail'), description: res?.error, variant: 'error' })
      }
      // 성공/실패 모두 새로고침한다. deleteMinutes 는 "객체 먼저, 행 나중" 순서라
      // 실패가 곧 무변경을 뜻하지 않는다 — 객체만 지워진 '깨진 링크 행'이 남을 수 있고,
      // 전송 유실(res === null)이면 실제로는 성공했을 수도 있다. 목록이 거짓말하지 않게 한다.
      // (서버의 revalidatePath 만으로는 현재 마운트된 트리가 새 RSC 페이로드를 받지 못한다.)
      router.refresh()
    })
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <SegmentedTabs tabs={tabs} value={teamId ?? 'all'} onChange={k => setTeamId(k === 'all' ? null : k)} size="sm" />
        <div className="min-w-52 flex-1">
          <input
            value={q}
            onChange={e => setQ(e.target.value)}
            placeholder={t('min.search')}
            className="app-input h-9"
            aria-label={t('min.search')}
          />
        </div>
        {canUpload && (
          <button className="btn btn-primary h-9" onClick={() => setUploadOpen(true)}>
            <Plus className="h-4 w-4" /> {t('min.upload')}
          </button>
        )}
      </div>

      {rows.length === 0 ? (
        <EmptyState
          icon={FileText}
          title={initial.length === 0 ? t('min.empty.title') : t('min.empty.filtered')}
          description={initial.length === 0 ? t('min.empty.desc') : undefined}
        />
      ) : (
        <ul className="card divide-y divide-line overflow-hidden">
          {rows.map(row => (
            <li key={row.id} className="flex items-center gap-3 p-4">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-brand-weak text-brand">
                <FileText className="h-4 w-4" />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="shrink-0 rounded-full bg-surface-2 px-2 py-0.5 text-[11px] font-semibold text-ink-muted">{row.teamCode}</span>
                  {row.hasMd ? (
                    <Link href={`/p/${projectId}/minutes/${row.id}`} className="truncate text-sm font-semibold text-ink hover:underline">
                      {row.title}
                    </Link>
                  ) : (
                    <span className="truncate text-sm font-semibold text-ink">{row.title}</span>
                  )}
                </div>
                <p className="mt-0.5 truncate text-xs text-ink-muted">
                  {row.minutesDate} · {row.createdByName ?? '—'} · {row.fileName}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <button
                  className="btn btn-ghost h-8 w-8 px-0"
                  onClick={() => onDownload(row)}
                  disabled={downloadingId !== null}
                  aria-label={t('min.download')}
                  title={t('min.download')}
                >
                  <Download className="h-4 w-4" />
                </button>
                {canDeleteMinutes(row, userId, membership?.role ?? null) && (
                  <button
                    className="btn btn-ghost h-8 w-8 px-0 text-delayed hover:bg-delayed-weak"
                    onClick={() => setPendingDelete(row)}
                    aria-label={t('min.delete')}
                    title={t('min.delete')}
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      {canUpload && (
        <MinutesUploadModal
          open={uploadOpen}
          onClose={() => setUploadOpen(false)}
          projectId={projectId}
          teams={teams}
          membership={membership}
        />
      )}

      {/* 브라우저 confirm() 금지 — Modal.tsx 사용 */}
      <Modal
        open={!!pendingDelete}
        // 삭제 진행 중에는 Escape/백드롭으로도 닫히지 않게 한다(Modal 은 footer 의 disabled 를 모른다).
        onClose={() => { if (!busy) setPendingDelete(null) }}
        title={t('min.deleteConfirm.title')}
        size="sm"
        footer={
          <>
            <button className="btn btn-ghost" onClick={() => setPendingDelete(null)} disabled={busy}>{t('min.cancel')}</button>
            <button className={DANGER_BTN} onClick={onConfirmDelete} disabled={busy}>
              {busy ? t('min.deleting') : t('min.delete')}
            </button>
          </>
        }
      >
        <p className="text-sm text-ink-muted">{t('min.deleteConfirm.desc')}</p>
      </Modal>
    </div>
  )
}
