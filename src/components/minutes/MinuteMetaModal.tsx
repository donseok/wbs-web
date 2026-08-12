'use client'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Folder } from 'lucide-react'
import type { Minute, MinuteFolder, TeamCode } from '@/lib/domain/types'
import { teamSubOfFolder } from '@/lib/domain/minutes'
import { pickDefaultProjectId, sortMyProjectsFirst } from '@/lib/domain/projectPick'
import {
  fetchMinuteFoldersLite, fetchProjectMeetingsLite, resetMinuteExternalId, updateMinuteMeta,
} from '@/app/actions/minutes'
import { useLocale } from '@/components/providers/LocaleProvider'
import { Modal } from '@/components/ui/Modal'
import { FolderPickModal } from './FolderPickModal'

export function MinuteMetaModal({
  open, onClose, onSaved, minute, projects, myProjectIds = null,
}: {
  open: boolean
  onClose: () => void
  onSaved: () => void
  minute: Minute
  projects: { id: string; name: string }[]
  /** 내가 멤버로 등록된 프로젝트 id — **비어 있는** 프로젝트를 채울 때만 쓴다. */
  myProjectIds?: string[] | null
}) {
  const { t } = useLocale()
  const [date, setDate] = useState(minute.minuteDate)
  // 열림 시점의 소속 폴더 — 변경 없는 저장이 커스텀 편철을 되돌리지 않게 더티 판정 기준으로 고정
  const initialFolderIdRef = useRef<string | null>(minute.folderId ?? null)
  const [folderId, setFolderId] = useState<string | null>(minute.folderId ?? null)
  const [folderPickOpen, setFolderPickOpen] = useState(false)
  const [folders, setFolders] = useState<MinuteFolder[]>([])
  const [title, setTitle] = useState(minute.title)
  // 이미 귀속이 있으면 절대 건드리지 않는다 — 남의 회의록을 열었다는 이유만으로 프로젝트가
  // 조용히 바뀌면 위키 귀속까지 따라 움직인다. 비어 있을 때만 내 소속으로 채운다.
  const existingProjectId = minute.projectId ?? minute.meetingProjectId ?? ''
  const [projectId, setProjectId] = useState(
    existingProjectId || (pickDefaultProjectId(projects, myProjectIds) ?? ''),
  )
  const projectOptions = useMemo(
    () => sortMyProjectsFirst(projects, myProjectIds), [projects, myProjectIds],
  )
  const [meetingId, setMeetingId] = useState(minute.meetingId ?? '')
  const [meetings, setMeetings] = useState<{ id: string; title: string; meetingDate: string }[]>([])
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  // 또박또박 연결 — 표시는 opaque 문자열 그대로(파싱·형식검증 금지). 초기화는 저장과 별개 즉시 액션.
  const [externalId, setExternalId] = useState(minute.externalId ?? null)
  const [extResetConfirm, setExtResetConfirm] = useState(false)
  const [extBusy, setExtBusy] = useState(false)
  const [extErr, setExtErr] = useState<string | null>(null)

  // 기존 연결이 있으면 열릴 때 해당 프로젝트의 회의 목록을 채워 현재 선택이 보이게 한다
  const initialProjectId = minute.projectId ?? minute.meetingProjectId ?? ''
  useEffect(() => {
    if (!open || !initialProjectId) return
    let alive = true
    void fetchProjectMeetingsLite(initialProjectId).then(list => { if (alive) setMeetings(list) })
    return () => { alive = false }
  }, [open, initialProjectId])

  // 폴더 선택 UI(트리 픽커) 자체는 최신 폴더 목록에서 그린다 — folderId 초기값은 위에서
  // minute 값으로 즉시 정해지므로(경합 없음) 이 조회는 목록 표시용일 뿐이다
  useEffect(() => {
    if (!open) return
    let alive = true
    // null = 조회 실패. 빈 트리와 구분되지 않으므로 최소한 원인은 남긴다(조용한 빈 화면 금지).
    void fetchMinuteFoldersLite()
      .then(fs => {
        if (!alive) return
        if (fs === null) { console.error('[MinuteMetaModal] 폴더 목록 조회 실패'); return }
        setFolders(fs)
      })
      .catch((e: unknown) => {
        if (!alive) return
        console.error('[MinuteMetaModal] 폴더 목록 조회 실패:', e)
        setFolders([])
      })
    return () => { alive = false }
  }, [open])

  // 담당(teamCode)은 선택 폴더에서 파생 — 시드 체인 밖(미분류·커스텀 폴더)이면 기존 담당 유지
  const team: TeamCode = useMemo(
    () => teamSubOfFolder(folders, folderId)?.team ?? minute.teamCode,
    [folders, folderId, minute.teamCode],
  )
  const folderName = folderId === null
    ? t('min.fold.unfiled')
    : folders.find(f => f.id === folderId)?.name ?? '…'

  async function onProject(pid: string) {
    setProjectId(pid); setMeetingId(''); setMeetings([])
    // 사용자가 프로젝트를 바꾸면 고른 폴더가 새 스코프 밖일 수 있다 — 해제(미분류)한다.
    // 초기값(minute.folderId)은 여기서 건드리지 않는다 — 커스텀 편철 존중은 이 모달의 핵심 계약
    // (위 save() 참조). folders 가 아직 비어 있으면(재조회 경합) 판정 불가이므로 손대지 않는다.
    if (folderId !== null && folders.length > 0) {
      const f = folders.find(x => x.id === folderId)
      if (!f || (f.projectId ?? null) !== (pid || null)) setFolderId(null)
    }
    if (pid) setMeetings(await fetchProjectMeetingsLite(pid))
  }

  async function save() {
    setBusy(true); setErr(null)
    // 폴더 선택을 안 바꿨으면 undefined(무접촉, 커스텀 편철 존중). 바꿨으면 미분류(null)
    // 포함해 그 값 그대로 전달 — 명시적 미분류 이동도 지원한다.
    const fid = folderId !== initialFolderIdRef.current ? folderId : undefined
    const res = await updateMinuteMeta(minute.id, {
      minuteDate: date, teamCode: team, title, meetingId: meetingId || null,
      projectId: projectId || null, meetingOccurrenceDate: meetingId ? date : null,
    }, fid)
    setBusy(false)
    if (!res.ok) { setErr(res.error ?? 'error'); return }
    onSaved()
  }

  async function doResetExternalId() {
    setExtBusy(true); setExtErr(null)
    const res = await resetMinuteExternalId(minute.id)
    setExtBusy(false)
    if (!res.ok) { setExtErr(res.error ?? t('min.ext.resetFailed')); return }
    setExternalId(null)
    setExtResetConfirm(false)
  }

  return (
    <Modal open={open} onClose={onClose} title={t('min.meta.title')} size="sm"
      footer={<div className="flex justify-end"><button onClick={save} disabled={busy} className="btn btn-primary">{t('min.meta.save')}</button></div>}>
      <div className="space-y-3">
        <label className="block text-sm">
          <span className="mb-1 block font-medium">{t('min.form.date')}</span>
          <input type="date" value={date} onChange={e => setDate(e.target.value)} className="app-input" />
        </label>
        <label className="block text-sm">
          <span className="mb-1 block font-medium">{t('min.form.folder')}</span>
          <button type="button" onClick={() => setFolderPickOpen(true)}
            className="app-input flex w-full items-center justify-between gap-2 text-left">
            <span className="truncate">{folderName}</span>
            <Folder aria-hidden className="h-4 w-4 shrink-0 text-ink-subtle" />
          </button>
        </label>
        <label className="block text-sm">
          <span className="mb-1 block font-medium">{t('min.form.title')}</span>
          <input value={title} onChange={e => setTitle(e.target.value)} maxLength={200} className="app-input" />
        </label>
        <div className="grid grid-cols-2 gap-2 text-sm">
          <label className="block">
            <span className="mb-1 block font-medium">{t('min.form.project')}</span>
            <select value={projectId} onChange={e => void onProject(e.target.value)} className="app-input">
              <option value="">{t('min.form.projectNone')}</option>
              {projectOptions.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
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
        {err && <p className="text-sm text-delayed">{err}</p>}
        <div className="space-y-1.5 rounded-xl border border-line p-2.5 text-sm">
          <span className="block font-medium">{t('min.ext.title')}</span>
          <p className="truncate text-xs text-ink-subtle">{externalId ?? t('min.ext.none')}</p>
          {externalId && (
            extResetConfirm ? (
              <div className="flex flex-wrap items-center gap-2 text-xs text-delayed">
                <span className="min-w-0 flex-1">{t('min.ext.resetConfirm')}</span>
                <button type="button" onClick={() => void doResetExternalId()} disabled={extBusy}
                  className="btn text-delayed">{t('min.ext.reset')}</button>
                <button type="button" onClick={() => setExtResetConfirm(false)} className="btn">{t('common.cancel')}</button>
              </div>
            ) : (
              <button type="button" onClick={() => setExtResetConfirm(true)} className="btn">
                {t('min.ext.reset')}
              </button>
            )
          )}
          {extErr && <p className="text-xs text-delayed">{extErr}</p>}
        </div>
      </div>
      <FolderPickModal open={folderPickOpen} folders={folders} scopeProjectId={projectId || null}
        onClose={() => setFolderPickOpen(false)}
        onPick={id => { setFolderId(id); setFolderPickOpen(false) }} />
    </Modal>
  )
}
