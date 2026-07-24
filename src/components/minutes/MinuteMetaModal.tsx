'use client'
import { useEffect, useRef, useState } from 'react'
import type { Minute, MinuteFolder, TeamCode } from '@/lib/domain/types'
import {
  subgroupFolderId, subgroupsOf, teamRootFolderIdOf, teamSubOfFolder,
} from '@/lib/domain/minutes'
import { fetchMinuteFoldersLite, fetchProjectMeetingsLite, updateMinuteMeta } from '@/app/actions/minutes'
import { useLocale } from '@/components/providers/LocaleProvider'
import { useTeamCodes } from '@/components/app/TeamsProvider'
import { Modal } from '@/components/ui/Modal'
import { SegmentedTabs } from '@/components/ui/SegmentedTabs'

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
  const teamCodes = useTeamCodes()
  const [date, setDate] = useState(minute.minuteDate)
  const [team, setTeamState] = useState<TeamCode>(minute.teamCode)
  // sub '' = 하위 미지정(무선택) — 팀 루트 편철·미분류가 여기 해당하며, 미지정 저장은 팀 루트로
  const [sub, setSub] = useState<string>('')
  const [folders, setFolders] = useState<MinuteFolder[]>([])
  const [title, setTitle] = useState(minute.title)
  const [projectId, setProjectId] = useState(minute.meetingProjectId ?? '')
  const [meetingId, setMeetingId] = useState(minute.meetingId ?? '')
  const [meetings, setMeetings] = useState<{ id: string; title: string; meetingDate: string }[]>([])
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  // 열림 시점의 (팀, 하위) — 변경 없는 저장이 폴더를 건드리지 않게(수동 편철 존중) 더티 판정 기준
  const initialRef = useRef<{ team: TeamCode; sub: string } | null>(null)
  // 폴더 로드 경합 가드 — 응답 도착 시점의 사용자 팀 선택을 초기값이 덮지 않게 현재 팀 추적
  const teamRef = useRef<TeamCode>(minute.teamCode)

  function setTeam(next: TeamCode) {
    if (next === team) return                       // 같은 탭 재클릭이 하위 선택을 리셋하면 안 됨
    setTeamState(next)
    teamRef.current = next
    // 원래 팀으로 돌아오면 열림 시점 하위를 복원(왕복이 편철을 바꾸면 안 됨), 타 팀은 미지정
    setSub(next === initialRef.current?.team ? initialRef.current.sub : '')
  }

  // 기존 연결이 있으면 열릴 때 해당 프로젝트의 회의 목록을 채워 현재 선택이 보이게 한다
  const initialProjectId = minute.meetingProjectId ?? ''
  useEffect(() => {
    if (!open || !initialProjectId) return
    let alive = true
    void fetchProjectMeetingsLite(initialProjectId).then(list => { if (alive) setMeetings(list) })
    return () => { alive = false }
  }, [open, initialProjectId])

  // 폴더 로드 후 현 소속 폴더의 (팀, 하위)로 초기화. 실제 하위 폴더에 편철된 경우에만 선택
  // 표시 — 팀 루트·미분류·타팀/체인 밖 폴더는 미지정('')으로 두어 실소속과 다른 하위가
  // '선택됨'으로 보이는 허위 표시를 막는다(대표 하위로의 이동도 이 덕에 변경으로 판정됨)
  useEffect(() => {
    if (!open) return
    let alive = true
    void fetchMinuteFoldersLite().then(fs => {
      if (!alive) return
      setFolders(fs)
      const ts = teamSubOfFolder(fs, minute.folderId ?? null)
      const sub0 = ts && ts.team === minute.teamCode ? (ts.sub ?? '') : ''
      initialRef.current = { team: minute.teamCode, sub: sub0 }
      // 응답 전에 사용자가 팀을 바꿨으면 그 선택을 덮지 않는다(경합 가드)
      if (teamRef.current === minute.teamCode) setSub(sub0)
    }).catch(() => { if (alive) setFolders([]) })   // 전송 실패도 '빈 목록=하위 구분 숨김' 계약으로
    return () => { alive = false }
  }, [open, minute.id, minute.teamCode, minute.folderId])

  async function onProject(pid: string) {
    setProjectId(pid); setMeetingId(''); setMeetings([])
    if (pid) setMeetings(await fetchProjectMeetingsLite(pid))
  }

  async function save() {
    setBusy(true); setErr(null)
    // 폴더 이동은 (팀, 하위) 선택이 실제로 바뀌었거나 미분류일 때만 — 무변경 저장이
    // 커스텀 폴더 편철을 시드 폴더로 되돌리면 안 된다. 하위 미지정('')은 팀 루트로.
    const init = initialRef.current
    const changed = init !== null && (team !== init.team || sub !== init.sub)
    const needFolder = folders.length > 0 && (changed || minute.folderId == null)
    const fid = needFolder
      ? (sub ? subgroupFolderId(folders, team, sub) : teamRootFolderIdOf(folders, team))
      : null
    const res = await updateMinuteMeta(minute.id, {
      minuteDate: date, teamCode: team, title, meetingId: meetingId || null,
    }, fid ?? undefined)
    setBusy(false)
    if (!res.ok) { setErr(res.error ?? 'error'); return }
    onSaved()
  }

  return (
    <Modal open={open} onClose={onClose} title={t('min.meta.title')} size="sm"
      footer={<div className="flex justify-end"><button onClick={save} disabled={busy} className="btn btn-primary">{t('min.meta.save')}</button></div>}>
      <div className="space-y-3">
        <label className="block text-sm">
          <span className="mb-1 block font-medium">{t('min.form.date')}</span>
          <input type="date" value={date} onChange={e => setDate(e.target.value)} className="app-input" />
        </label>
        <div className="text-sm">
          <span className="mb-1 block font-medium">{t('min.form.team')}</span>
          <SegmentedTabs<TeamCode> tabs={teamCodes.map(tk => ({ key: tk, label: tk }))}
            value={team} onChange={setTeam} size="sm" />
        </div>
        {/* 폴더 목록 미확보(로드 전/실패)면 하위 구분을 숨긴다 — 허위 어포던스 방지(업로드 모달과 동일) */}
        {folders.length > 0 && (
          <div className="text-sm">
            <span className="mb-1 block font-medium">{t('min.form.subTeam')}</span>
            <SegmentedTabs
              tabs={subgroupsOf(folders, team).map(s => ({ key: s, label: s }))}
              value={sub} onChange={setSub} size="sm" />
          </div>
        )}
        <label className="block text-sm">
          <span className="mb-1 block font-medium">{t('min.form.title')}</span>
          <input value={title} onChange={e => setTitle(e.target.value)} maxLength={200} className="app-input" />
        </label>
        <div className="grid grid-cols-2 gap-2 text-sm">
          <label className="block">
            <span className="mb-1 block font-medium">{t('min.form.project')}</span>
            <select value={projectId} onChange={e => void onProject(e.target.value)} className="app-input">
              <option value="">{t('min.form.meetingNone')}</option>
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
        {err && <p className="text-sm text-delayed">{err}</p>}
      </div>
    </Modal>
  )
}
