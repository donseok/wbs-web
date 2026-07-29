'use client'
import { useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react'
import { Folder } from 'lucide-react'
import type { MinuteFolder, TeamCode } from '@/lib/domain/types'
import {
  MINUTE_ATTACHMENTS_MAX_COUNT, MINUTE_ATTACHMENT_MAX, MINUTE_BODY_FILE_MAX,
  MINUTE_BODY_MAX, sanitizeFileName, teamSubOfFolder,
} from '@/lib/domain/minutes'
import { pickDefaultProjectId, sortMyProjectsFirst } from '@/lib/domain/projectPick'
import {
  createMinute, fetchMinuteFoldersLite, fetchProjectMeetingsLite, recordMinuteFile,
} from '@/app/actions/minutes'
import { createBrowserClient } from '@/lib/supabase/client'
import { useLocale } from '@/components/providers/LocaleProvider'
import { useTeamCodes } from '@/components/app/TeamsProvider'
import { useToast } from '@/components/ui/Toast'
import { Modal } from '@/components/ui/Modal'
import { FolderPickModal } from './FolderPickModal'

const BUCKET = 'minutes'

export function MinuteUploadModal({
  open, onClose, onSaved, todayIso, projects, defaultTeam, folders, defaultFolderId,
  myProjectIds = null,
}: {
  open: boolean
  onClose: () => void
  onSaved: () => void
  todayIso: string
  projects: { id: string; name: string }[]
  defaultTeam?: TeamCode | null
  folders: MinuteFolder[]
  defaultFolderId: string | null
  /** 내가 멤버로 등록된 프로젝트 id — 기본 선택의 근거. null = 조회 실패(소속 없음과 같은 폴백). */
  myProjectIds?: string[] | null
}) {
  const { t } = useLocale()
  const { toast } = useToast()
  const teamCodes = useTeamCodes()
  const fallbackTeam = teamCodes[0] ?? 'PMO'
  const [date, setDate] = useState(todayIso)
  // 탐색기에서 보던 폴더를 초기 선택으로 — 폴더가 곧 편철 대상이므로 팀은 여기서 파생된다
  const [folderId, setFolderId] = useState<string | null>(defaultFolderId)
  const [folderPickOpen, setFolderPickOpen] = useState(false)
  // 폴더 목록은 prop(탐색기 상태)으로 즉시 그리되 열림 시점에 재조회로 대체 — 하위 폴더가
  // 삭제 가능해지면서 타 세션의 삭제·개명을 모르는 stale 목록이면 죽은 폴더로의 업로드가
  // 새로고침 전까지 반복 실패한다(수정 모달의 열림 시 재조회와 동일 패턴, 리뷰 반영)
  const [liveFolders, setLiveFolders] = useState<MinuteFolder[]>(folders)
  const [title, setTitle] = useState('')
  const [bodyFile, setBodyFile] = useState<File | null>(null)
  const [bodyText, setBodyText] = useState('')
  const [attachments, setAttachments] = useState<File[]>([])
  // 올리는 사람의 프로젝트 소속에서 기본값을 유도한다(pickDefaultProjectId). 고르지 않고 올린
  // 회의록은 위키·이슈·대시보드 어디에도 잡히지 않는다(2026-07-29 실측: 42건 중 27건).
  const defaultProjectId = pickDefaultProjectId(projects, myProjectIds) ?? ''
  const [projectId, setProjectId] = useState(defaultProjectId)
  // 여럿일 때 고르는 비용을 줄인다 — 내가 속한 프로젝트가 먼저 나온다
  const projectOptions = useMemo(
    () => sortMyProjectsFirst(projects, myProjectIds), [projects, myProjectIds],
  )
  const [meetingId, setMeetingId] = useState('')
  const [meetings, setMeetings] = useState<{ id: string; title: string; meetingDate: string }[]>([])
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let alive = true
    void fetchMinuteFoldersLite().then(fs => {
      // null = 조회 실패. 빈 배열('고를 폴더가 없다')과 구분해 로깅하고 prop 목록을 유지한다.
      if (!alive) return
      if (fs === null) { console.error('[MinuteUploadModal] 폴더 재조회 실패(프리페치 목록 사용)'); return }
      if (fs.length === 0) return
      setLiveFolders(fs)
    }).catch(err => console.error('[MinuteUploadModal] 폴더 재조회 실패(프리페치 목록 사용):', err))
    return () => { alive = false }
  }, [])

  // 프로젝트가 기본 선택된 채로 열리면 회의 셀렉트는 활성인데 목록이 비어 있다 — 사용자는
  // '연결할 회의가 없다'고 오인한다. 기본값일 때만 도는 1회 조회(사용자 변경은 onProject 담당).
  useEffect(() => {
    if (!defaultProjectId) return
    let alive = true
    void fetchProjectMeetingsLite(defaultProjectId)
      .then(list => { if (alive) setMeetings(list) })
      .catch(err => console.error('[MinuteUploadModal] 회의 목록 조회 실패:', err))
    return () => { alive = false }
  }, [defaultProjectId])

  // 선택 폴더가 팀 시드 체인 안이면 그 팀, 밖(미분류·커스텀 폴더 등)이면 defaultTeam → 활성 팀 1순위
  const team: TeamCode = useMemo(
    () => teamSubOfFolder(liveFolders, folderId)?.team ?? defaultTeam ?? fallbackTeam,
    [liveFolders, folderId, defaultTeam, fallbackTeam],
  )
  const folderName = (folderId && liveFolders.find(f => f.id === folderId)?.name) || t('min.fold.unfiled')
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
        // 원본 .md를 먼저 Storage에 올리고, 그 경로와 client-generated UUID를 본체 생성과 함께
        // 전달한다. v1은 처음부터 파일 메타를 가진 불변 행으로 INSERT되며 사후 UPDATE하지 않는다.
        const candidateId = crypto.randomUUID()
        const bodyPath = `${candidateId}/${Date.now()}-${sanitizeFileName(bodyFile.name)}`
        const sb = createBrowserClient()
        const bodyUpload = await sb.storage.from(BUCKET).upload(bodyPath, bodyFile, { upsert: false })
        if (bodyUpload.error) { setErr(`${t('min.err.upload')}: ${bodyUpload.error.message}`); return }
        // 편철 폴더 = 사용자가 고른 폴더 그대로. 미분류(null)면 서버가 팀 루트로 자동 편철
        const res = await createMinute({
          minuteDate: date, teamCode: team, title: title.trim() || bodyFile.name,
          bodyMd: bodyText, meetingId: meetingId || null, projectId: projectId || null,
          meetingOccurrenceDate: meetingId ? date : null,
        }, folderId, {
          minuteId: candidateId,
          file: {
            fileName: bodyFile.name,
            filePath: bodyPath,
            size: bodyFile.size,
            mime: bodyFile.type || 'text/markdown',
          },
        })
        if (!res.ok || !res.id) {
          await sb.storage.from(BUCKET).remove([bodyPath])
          setErr(res.error ?? t('min.err.upload'))
          return
        }
        minuteId = res.id
        // body는 createMinute가 메타와 v1까지 함께 기록했으므로 첨부 루프에서는 건너뛴다.
        progressRef.current = { id: minuteId, done: 1 }
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
        <label className="block text-sm">
          <span className="mb-1 block font-medium">{t('min.form.folder')}</span>
          <button type="button" onClick={() => setFolderPickOpen(true)}
            className="app-input flex w-full items-center justify-between gap-2 text-left">
            <span className="truncate">{folderName}</span>
            <Folder aria-hidden className="h-4 w-4 shrink-0 text-ink-subtle" />
          </button>
        </label>
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
      </div>
      <FolderPickModal open={folderPickOpen} folders={liveFolders}
        onClose={() => setFolderPickOpen(false)}
        onPick={id => { setFolderId(id); setFolderPickOpen(false) }} />
    </Modal>
  )
}
