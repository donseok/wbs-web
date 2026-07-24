'use client'
import { useEffect, useRef, useState, type ChangeEvent } from 'react'
import type { MinuteFolder, TeamCode } from '@/lib/domain/types'
import {
  MINUTE_ATTACHMENTS_MAX_COUNT, MINUTE_ATTACHMENT_MAX, MINUTE_BODY_FILE_MAX,
  MINUTE_BODY_MAX, sanitizeFileName, subgroupsOf,
  subgroupFolderId, teamSubOfFolder,
} from '@/lib/domain/minutes'
import {
  createMinute, fetchMinuteFoldersLite, fetchProjectMeetingsLite, recordMinuteFile,
} from '@/app/actions/minutes'
import { createBrowserClient } from '@/lib/supabase/client'
import { useLocale } from '@/components/providers/LocaleProvider'
import { useTeamCodes } from '@/components/app/TeamsProvider'
import { useToast } from '@/components/ui/Toast'
import { Modal } from '@/components/ui/Modal'
import { SegmentedTabs } from '@/components/ui/SegmentedTabs'

const BUCKET = 'minutes'

export function MinuteUploadModal({
  open, onClose, onSaved, todayIso, projects, defaultTeam, folders, defaultFolderId,
}: {
  open: boolean
  onClose: () => void
  onSaved: () => void
  todayIso: string
  projects: { id: string; name: string }[]
  defaultTeam?: TeamCode | null
  folders: MinuteFolder[]
  defaultFolderId: string | null
}) {
  const { t } = useLocale()
  const { toast } = useToast()
  // 탐색기에서 특정 폴더를 보며 열었으면 그 폴더의 (팀, 하위)를 초기값으로 — 시드 체인 밖이면 팀 탭 기본
  const initial = teamSubOfFolder(folders, defaultFolderId)
  const teamCodes = useTeamCodes()
  const fallbackTeam = teamCodes[0] ?? 'PMO'
  const [date, setDate] = useState(todayIso)
  const [team, setTeamState] = useState<TeamCode>(initial?.team ?? defaultTeam ?? fallbackTeam)
  const [sub, setSub] = useState<string>(
    initial?.sub ?? subgroupsOf(folders, initial?.team ?? defaultTeam ?? fallbackTeam)[0])
  // 폴더 목록은 prop(탐색기 상태)으로 즉시 그리되 열림 시점에 재조회로 대체 — 하위 폴더가
  // 삭제 가능해지면서 타 세션의 삭제·개명을 모르는 stale 목록이면 죽은 폴더 탭으로의 업로드가
  // 새로고침 전까지 반복 실패한다(수정 모달의 열림 시 재조회와 동일 패턴, 리뷰 반영)
  const [liveFolders, setLiveFolders] = useState<MinuteFolder[]>(folders)
  const [title, setTitle] = useState('')
  const [bodyFile, setBodyFile] = useState<File | null>(null)
  const [bodyText, setBodyText] = useState('')
  const [attachments, setAttachments] = useState<File[]>([])
  const [projectId, setProjectId] = useState('')
  const [meetingId, setMeetingId] = useState('')
  const [meetings, setMeetings] = useState<{ id: string; title: string; meetingDate: string }[]>([])
  const [busy, setBusy] = useState(false)
  // 재조회 응답 도착 시점의 사용자 팀 선택을 초기 팀이 덮지 않게 현재 팀 추적(수정 모달과 동일 경합 가드)
  const teamRef = useRef<TeamCode>(initial?.team ?? defaultTeam ?? fallbackTeam)

  useEffect(() => {
    let alive = true
    void fetchMinuteFoldersLite().then(fs => {
      if (!alive || fs.length === 0) return   // 빈 응답(조회 실패 폴백)은 prop 목록 유지
      setLiveFolders(fs)
      // 현재 (팀, 하위)가 신선 목록에서도 유효하면 무접촉 — 사용자 선택 존중
      setSub(cur => {
        const names = subgroupsOf(fs, teamRef.current)
        return names.includes(cur) ? cur : names[0]
      })
    }).catch(err => console.error('[MinuteUploadModal] 폴더 재조회 실패(프리페치 목록 사용):', err))
    return () => { alive = false }
  }, [])

  function setTeam(next: TeamCode) {
    setTeamState(next)
    teamRef.current = next
    setSub(subgroupsOf(liveFolders, next)[0])  // 팀 전환 시 하위 구분은 그 팀의 대표(첫 항목)로 재설정
  }
  const [err, setErr] = useState<string | null>(null)
  // 부분 실패 후 재시도 시 회의록 재생성·파일 중복 기록 방지 (모달은 열 때마다 리마운트되므로 세션 단위)
  const progressRef = useRef<{ id: string; done: number } | null>(null)

  /** 파일 일괄 선택(단일 입력 UX) — 본문이 비어 있으면 첫 .md가 본문, 나머지는 전부 첨부로 자동 분류.
   *  검증을 모두 통과한 뒤에만 상태를 반영해 부분 적용을 막는다. */
  async function onFiles(e: ChangeEvent<HTMLInputElement>) {
    const files = [...(e.target.files ?? [])]
    e.target.value = ''
    if (files.length === 0) return
    setErr(null)
    const isMd = (f: File) => /\.(md|markdown)$/i.test(f.name)
    const bodyCand = !bodyFile ? files.find(isMd) ?? null : null
    const rest = files.filter(f => f !== bodyCand)
    if (bodyCand && bodyCand.size > MINUTE_BODY_FILE_MAX) { setErr(t('min.err.bodyFileMax')); return }
    if (attachments.length + rest.length > MINUTE_ATTACHMENTS_MAX_COUNT) { setErr(t('min.err.attachCount')); return }
    if (rest.some(f => f.size > MINUTE_ATTACHMENT_MAX)) { setErr(t('min.err.attachMax')); return }
    if (bodyCand) {
      const text = await bodyCand.text()
      if (text.length > MINUTE_BODY_MAX) { setErr(t('min.err.bodyMax')); return }
      setBodyFile(bodyCand); setBodyText(text)
      if (!title.trim()) setTitle(bodyCand.name.replace(/\.(md|markdown)$/i, ''))
    }
    if (rest.length) setAttachments(prev => [...prev, ...rest])
  }

  async function onProject(pid: string) {
    setProjectId(pid); setMeetingId(''); setMeetings([])
    if (pid) setMeetings(await fetchProjectMeetingsLite(pid))
  }

  async function save() {
    if (!bodyFile) { setErr(t('min.err.bodyRequired')); return }
    setBusy(true); setErr(null)
    try {
      let minuteId = progressRef.current?.id ?? null
      if (!minuteId) {
        // 편철 폴더 = (팀, 하위 구분) → 실폴더. 해석 실패(null)면 서버가 팀 루트로 자동 편철
        const res = await createMinute({
          minuteDate: date, teamCode: team, title: title.trim() || bodyFile.name,
          bodyMd: bodyText, meetingId: meetingId || null,
        }, subgroupFolderId(liveFolders, team, sub))
        if (!res.ok || !res.id) { setErr(res.error ?? t('min.err.upload')); return }
        minuteId = res.id
        progressRef.current = { id: minuteId, done: 0 }
        if (res.timeFix) {
          toast({
            title: t('min.timeFix.title'),
            description: `${t('min.timeFix.desc')}: ${res.timeFix.from} → ${res.timeFix.to}`,
            variant: 'info',
          })
        }
      }
      const sb = createBrowserClient()
      const files: { role: 'body' | 'attachment'; f: File }[] = [
        { role: 'body', f: bodyFile },
        ...attachments.map(f => ({ role: 'attachment' as const, f })),
      ]
      // 파일 업로드 실패 시에도 회의록은 유지한다(body_md 가 원천 — 스펙 §7).
      // body 파일 실패면 뷰어가 '재업로드 유도' 상태를 안내하고, replaceMinuteBody 로 복구 가능.
      for (let i = progressRef.current?.done ?? 0; i < files.length; i++) {
        const { role, f } = files[i]
        const path = `${minuteId}/${Date.now()}-${sanitizeFileName(f.name)}`
        const up = await sb.storage.from(BUCKET).upload(path, f, { upsert: false })
        if (up.error) { setErr(`${t('min.err.upload')}: ${up.error.message}`); return }
        const rec = await recordMinuteFile(minuteId, {
          role, fileName: f.name, filePath: path,
          size: f.size, mime: f.type || 'application/octet-stream',
        })
        if (!rec.ok) {
          // 메타 기록 실패 → 방금 올린 객체 정리(보상). 회의록은 유지.
          await sb.storage.from(BUCKET).remove([path])
          setErr(rec.error ?? t('min.err.record')); return
        }
        progressRef.current = { id: minuteId, done: i + 1 }
      }
      onSaved()
    } finally { setBusy(false) }
  }

  return (
    <Modal open={open} onClose={onClose} title={t('min.upload')} size="md"
      footer={
        <div className="flex justify-end gap-2">
          <button onClick={save} disabled={busy || !bodyFile} className="btn btn-primary">
            {busy ? t('min.form.saving') : t('min.form.save')}
          </button>
        </div>
      }>
      <div className="space-y-3">
        <label className="block text-sm">
          <span className="mb-1 block font-medium">{t('min.form.date')}</span>
          <input type="date" value={date} onChange={e => setDate(e.target.value)} className="app-input" />
        </label>
        <div className="text-sm">
          <span className="mb-1 block font-medium">{t('min.form.team')}</span>
          <SegmentedTabs<TeamCode>
            tabs={teamCodes.map(tk => ({ key: tk, label: tk }))}
            value={team} onChange={setTeam} size="sm" />
        </div>
        {/* 폴더 목록 미확보(프리페치 실패 등)면 하위 구분을 숨긴다 — 선택을 보여주고 무시하는
            허위 어포던스 방지. 이때는 서버가 담당 팀 루트로 자동 편철한다 */}
        {liveFolders.length > 0 && (
          <div className="text-sm">
            <span className="mb-1 block font-medium">{t('min.form.subTeam')}</span>
            {/* 하위 구분 = 팀 루트의 실제 하위 폴더(생성/개명/삭제 즉시 반영). 하위 폴더가 없는 팀은 자기 자신 1개 */}
            <SegmentedTabs
              tabs={subgroupsOf(liveFolders, team).map(s => ({ key: s, label: s }))}
              value={sub} onChange={setSub} size="sm" />
          </div>
        )}
        <label className="block text-sm">
          <span className="mb-1 block font-medium">{t('min.form.files')}</span>
          <input type="file" multiple onChange={e => void onFiles(e)} className="app-input pt-1.5" />
          <span className="mt-1 block text-xs text-ink-subtle">{t('min.form.filesHint')}</span>
          {(bodyFile || attachments.length > 0) && (
            <ul className="mt-1.5 space-y-0.5 text-xs text-ink-subtle">
              {bodyFile && (
                <li className="flex items-center justify-between gap-2">
                  <span className="flex min-w-0 items-center gap-1.5">
                    <span className="shrink-0 rounded bg-progress-weak px-1 text-[10px] font-semibold text-accent-ink">{t('min.form.roleBody')}</span>
                    <span className="truncate">{bodyFile.name} · {bodyText.length.toLocaleString()}자</span>
                  </span>
                  <button type="button" className="text-delayed" onClick={() => { setBodyFile(null); setBodyText('') }}>✕</button>
                </li>
              )}
              {attachments.map((f, i) => (
                <li key={`${f.name}-${i}`} className="flex items-center justify-between gap-2">
                  <span className="flex min-w-0 items-center gap-1.5">
                    <span className="shrink-0 rounded bg-surface-2 px-1 text-[10px] font-semibold text-ink-muted">{t('min.form.roleAttach')}</span>
                    <span className="truncate">{f.name}</span>
                  </span>
                  <button type="button" className="text-delayed"
                    onClick={() => setAttachments(prev => prev.filter((_, j) => j !== i))}>✕</button>
                </li>
              ))}
            </ul>
          )}
        </label>
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
