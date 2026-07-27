'use client'
import { useEffect, useState } from 'react'
import { Copy, Link2Off } from 'lucide-react'
import type { Minute, MinuteFolder } from '@/lib/domain/types'
import { teamSubOfFolder } from '@/lib/domain/minutes'
import {
  clearMinuteExternalId, fetchMinuteFoldersLite, fetchProjectMeetingsLite, updateMinuteMeta,
} from '@/app/actions/minutes'
import { useLocale } from '@/components/providers/LocaleProvider'
import { useToast } from '@/components/ui/Toast'
import { Modal } from '@/components/ui/Modal'
import { FolderTreeSelect } from './FolderTreeSelect'

const DDOBAK_PREFIX = 'ddobak:'

export function MinuteMetaModal({
  open, onClose, onSaved, minute, projects,
}: {
  open: boolean
  onClose: () => void
  onSaved: () => void
  minute: Minute
  projects: { id: string; name: string }[]
}) {
  const { t } = useLocale()
  const { toast } = useToast()
  const [date, setDate] = useState(minute.minuteDate)
  // 폴더가 team_code 의 유일한 출처(§6.3) — 담당·하위 구분 입력은 없애고 폴더 하나만 고른다
  const [folderId, setFolderId] = useState<string | null>(minute.folderId ?? null)
  const [folders, setFolders] = useState<MinuteFolder[]>([])
  const [title, setTitle] = useState(minute.title)
  const [projectId, setProjectId] = useState(minute.projectId ?? minute.meetingProjectId ?? '')
  const [meetingId, setMeetingId] = useState(minute.meetingId ?? '')
  const [meetings, setMeetings] = useState<{ id: string; title: string; meetingDate: string }[]>([])
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  // 폴더 조회 실패를 '고를 폴더가 없음'과 구분해 표시하기 위한 플래그(문구는 렌더에서 t 로 — 조회 effect 가 t 에 묶이면 안 된다)
  const [folderLoadFailed, setFolderLoadFailed] = useState(false)
  // 연동 초기화 확인 — 부모 모달과 배타로 열어 포커스 트랩·Escape 가 두 겹 걸리지 않게 한다
  const [resetOpen, setResetOpen] = useState(false)
  const [resetBusy, setResetBusy] = useState(false)

  // 기존 연결이 있으면 열릴 때 해당 프로젝트의 회의 목록을 채워 현재 선택이 보이게 한다
  const initialProjectId = minute.projectId ?? minute.meetingProjectId ?? ''
  useEffect(() => {
    if (!open || !initialProjectId) return
    let alive = true
    void fetchProjectMeetingsLite(initialProjectId).then(list => { if (alive) setMeetings(list) })
    return () => { alive = false }
  }, [open, initialProjectId])

  // 폴더 목록은 열릴 때 재조회 — 타 세션의 개명·삭제·이동을 모르는 stale 트리면 죽은 폴더로
  // 저장이 반복 실패한다. 선택값은 minute.folderId 그대로라 응답과 경합하지 않는다.
  useEffect(() => {
    if (!open) return
    let alive = true
    void fetchMinuteFoldersLite().then(fs => { if (alive) setFolders(fs) })
      .catch((e: unknown) => {
        if (!alive) return
        // 빈 트리는 '고를 폴더가 없다'와 구분되지 않으므로 반드시 화면에 남긴다(조용한 빈 화면 금지)
        console.error('[MinuteMetaModal] 폴더 목록 조회 실패:', e)
        setFolders([]); setFolderLoadFailed(true)
      })
    return () => { alive = false }
  }, [open, minute.id])

  async function onProject(pid: string) {
    setProjectId(pid); setMeetingId(''); setMeetings([])
    if (pid) setMeetings(await fetchProjectMeetingsLite(pid))
  }

  async function save() {
    // 폴더는 필수 입력이고 team 은 거기서 파생한다 — 파생 불가 폴더로 저장하면 서버가 거절하므로
    // 여기서 먼저 막는다(폴더 id 는 항상 전달 → 3단 이상 경로가 2단으로 강등되지 않는다, §6.2)
    if (!folderId) { setErr(t('min.form.folderRequired')); return }
    const ts = teamSubOfFolder(folders, folderId)
    if (!ts) { setErr(t('min.form.folderNoTeam')); return }
    setBusy(true); setErr(null)
    const res = await updateMinuteMeta(minute.id, {
      minuteDate: date, teamCode: ts.team, title, meetingId: meetingId || null,
      projectId: projectId || null, meetingOccurrenceDate: meetingId ? date : null,
    }, folderId)
    setBusy(false)
    if (!res.ok) {
      console.error('[MinuteMetaModal] 메타 저장 실패:', res.error)
      setErr(res.error ?? t('min.fold.error'))
      return
    }
    onSaved()
  }

  const externalId = minute.externalId ?? null
  const isDdobak = externalId != null && externalId.startsWith(DDOBAK_PREFIX)
  // ddobak: 프리픽스는 D'Flow 내부 멱등 키 형식이라 사용자에게는 또박또박이 아는 uuid 만 보인다
  const externalShown = isDdobak ? externalId.slice(DDOBAK_PREFIX.length) : externalId
  // 보관분은 link 경로가 409 로 막혀 재연결이 불가하다 — 초기화만 되는 편도 상태를 만들지 않는다(§9.4-6)
  const resetDisabled = externalId == null || !!minute.archivedAt

  async function copyExternal() {
    if (!externalShown) return
    try {
      await navigator.clipboard.writeText(externalShown)
      toast({ title: t('min.ext.copied'), variant: 'success' })
    } catch (e) {
      console.error('[MinuteMetaModal] 식별자 복사 실패:', e)
      toast({ title: t('min.ext.copyFailed'), variant: 'error' })
    }
  }

  async function runReset() {
    setResetBusy(true)
    const res = await clearMinuteExternalId(minute.id)
    setResetBusy(false)
    setResetOpen(false)
    if (!res.ok) {
      console.error('[MinuteMetaModal] 연동 초기화 실패:', res.error)
      toast({ title: res.error ?? t('min.fold.error'), variant: 'error' })
      return
    }
    toast({ title: t('min.ext.resetDone'), variant: 'success' })
    onSaved()
  }

  return (
    <>
      <Modal open={open && !resetOpen} onClose={onClose} title={t('min.meta.title')} size="sm"
        footer={<button onClick={save} disabled={busy} className="btn btn-primary">{t('min.meta.save')}</button>}>
        <div className="space-y-3">
          <label className="block text-sm">
            <span className="mb-1 block font-medium">{t('min.form.date')}</span>
            <input type="date" value={date} onChange={e => setDate(e.target.value)} className="app-input" />
          </label>
          <div className="text-sm">
            <span className="mb-1 block font-medium">{t('min.form.folder')}</span>
            <FolderTreeSelect folders={folders} value={folderId} onChange={setFolderId}
              ariaLabel={t('min.form.folderPick')} />
            {folderLoadFailed && <p className="mt-1 text-delayed">{t('min.fold.error')}</p>}
          </div>
          <label className="block text-sm">
            <span className="mb-1 block font-medium">{t('min.form.title')}</span>
            <input value={title} onChange={e => setTitle(e.target.value)} maxLength={200} className="app-input" />
          </label>
          <div className="grid grid-cols-2 gap-2 text-sm">
            <label className="block">
              <span className="mb-1 block font-medium">{t('min.form.project')}</span>
              <select value={projectId} onChange={e => void onProject(e.target.value)} className="app-input">
                <option value="">{t('min.form.projectNone')}</option>
                {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </label>
            <label className="block">
              <span className="mb-1 block font-medium">{t('min.form.meeting')}</span>
              <select value={meetingId} onChange={e => setMeetingId(e.target.value)} disabled={!projectId} className="app-input">
                <option value="">{t('min.form.meetingNone')}</option>
                {meetings.map(mt => <option key={mt.id} value={mt.id}>{mt.meetingDate} · {mt.title}</option>)}
              </select>
            </label>
          </div>
          {/* 연동 식별자(§9.2) — 어느 또박또박 회의와 묶였는지 확인하고, 잘못 묶인 것을 풀 수 있어야 한다 */}
          <div className="border-t border-line pt-3 text-sm">
            <span className="mb-1 block font-medium">
              {externalId == null ? t('min.ext.none') : isDdobak ? t('min.ext.label') : t('min.ext.other')}
            </span>
            <div className="flex items-center gap-2">
              {externalShown && (
                <>
                  <code className="min-w-0 flex-1 truncate rounded-lg bg-surface-2 px-2 py-1 text-[12px] text-ink">{externalShown}</code>
                  <button type="button" onClick={() => void copyExternal()} className="btn btn-ghost shrink-0"
                    aria-label={t('min.ext.copy')} title={t('min.ext.copy')}>
                    <Copy className="h-4 w-4" />
                  </button>
                </>
              )}
              <button type="button" onClick={() => setResetOpen(true)} disabled={resetDisabled}
                className={`btn shrink-0 ${externalShown ? '' : 'ml-auto'} disabled:opacity-50`}>
                <Link2Off className="h-4 w-4" />{t('min.ext.reset')}
              </button>
            </div>
          </div>
          {err && <p className="text-sm text-delayed">{err}</p>}
        </div>
      </Modal>

      {/* 초기화는 되돌릴 수 있지만 되돌리는 조작이 또박또박 쪽에 있다(§9.3) — 3가지를 모두 알린다 */}
      <Modal open={resetOpen} onClose={() => { if (!resetBusy) setResetOpen(false) }} title={t('min.ext.resetTitle')} size="sm"
        footer={
          <>
            <button onClick={() => setResetOpen(false)} disabled={resetBusy} className="btn">{t('common.cancel')}</button>
            <button onClick={() => void runReset()} disabled={resetBusy} className="btn bg-delayed text-white disabled:opacity-50">
              {t('min.ext.resetConfirm')}
            </button>
          </>
        }>
        <ul className="list-disc space-y-1 pl-4 text-sm text-ink">
          <li>{t('min.ext.resetWarn1')}</li>
          <li>{t('min.ext.resetWarn2')}</li>
          <li>{t('min.ext.resetWarn3')}</li>
        </ul>
      </Modal>
    </>
  )
}
