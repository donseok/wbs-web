'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useLocale } from '@/components/providers/LocaleProvider'
import { Modal } from '@/components/ui/Modal'
import { createBrowserClient } from '@/lib/supabase/client'
import { createMinutes } from '@/app/actions/minutes'
import {
  MINUTES_FILE_MAX, canCreateMinutes, isMarkdownFile, minutesStoragePath, validateMinutesInput,
} from '@/lib/domain/minutes'
import type { Membership, TeamOption } from '@/lib/domain/types'

const BUCKET = 'minutes'

function seoulToday(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date())
}

export function MinutesUploadModal({
  open, onClose, projectId, teams, membership,
}: {
  open: boolean
  onClose: () => void
  projectId: string
  teams: TeamOption[]
  membership: Membership | null
}) {
  const { t } = useLocale()
  const router = useRouter()
  const fileRef = useRef<HTMLInputElement>(null)

  const allowed = teams.filter(tm => canCreateMinutes(membership, tm.id))
  const [teamId, setTeamId] = useState(allowed[0]?.id ?? '')
  const [minutesDate, setMinutesDate] = useState(seoulToday())
  const [title, setTitle] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  // setBusy 는 다음 렌더에서야 반영된다. 첫 await(file.text())가 이벤트 루프를 양보하는 사이
  // 두 번째 클릭이 들어오면 disabled 가 아직 걸리지 않아 onSubmit 이 재진입한다 —
  // 그러면 서로 다른 타임스탬프 경로로 두 번 업로드되고 행도 두 개 생긴다
  // (file_path UNIQUE 는 경로가 달라 못 막는다). 동기 ref 게이트로 재진입을 차단한다.
  const submittingRef = useRef(false)

  // 모달은 항상 마운트돼 있다(open 프롭만 토글). 다시 열 때 지난 에러가 남아 있지 않게 하고,
  // 자정을 넘겨도 기본 회의일이 '오늘'이 되도록 되살린다.
  useEffect(() => {
    if (!open) return
    setErr(null)
    setMinutesDate(seoulToday())
  }, [open])

  function handleClose() {
    if (submittingRef.current) return // 업로드 중 Escape/백드롭 닫기 금지
    onClose()
  }

  async function onSubmit() {
    if (submittingRef.current) return
    submittingRef.current = true
    setBusy(true)
    setErr(null)

    try {
      const file = fileRef.current?.files?.[0]
      if (!file) { setErr(t('min.err.noFile')); return }
      if (file.size > MINUTES_FILE_MAX) { setErr(t('min.err.tooLarge')); return }

      const meta = { teamId, minutesDate, title }

      // 1) 팀/제목/날짜 먼저. teamId 가 비면 아래 storage 경로가 `projectId//…` 로 망가지고
      //    createMinutes 의 접두사 검사에 걸린다 — 그 전에 여기서 막는다.
      const preErr = validateMinutesInput({ ...meta, contentMd: null })
      if (preErr) { setErr(preErr); return }

      // 2) 경로를 먼저 만든다(순수). md 판정은 **경로 문자열**로 한다 —
      //    createMinutes 가 검사하는 것도, DB 의 minutes_md_only 체크제약이 보는 것도 file_path 다.
      //    file.name 으로 판정하면 sanitizeFileName 이 확장자를 바꾸는 날 클라이언트와 서버가 갈린다.
      const path = minutesStoragePath(projectId, teamId, file.name, Date.now())

      // 3) .md 면 본문을 읽는다. 아직 Storage 를 건드리지 않았으므로 여기서 실패해도 고아 객체가 없다.
      let contentMd: string | null = null
      if (isMarkdownFile(path)) {
        contentMd = await file.text()
        // Blob.text() 는 UTF-8 로만 디코드한다. EUC-KR 로 저장된 한글 .md 는 U+FFFD 로 깨진 채
        // content_md 에 영구 저장되고 상세 화면이 그대로 렌더한다. 되돌릴 수 없으므로 여기서 거른다.
        // (ASCII-only 파일은 EUC-KR 이어도 UTF-8 과 바이트가 같아 오탐이 없다.)
        if (contentMd.includes('\uFFFD')) { setErr(t('min.err.encoding')); return }
      }

      // 4) MINUTES_MD_MAX(500,000자) 는 MINUTES_FILE_MAX(20MB) 와 별개 상한이다.
      //    15MB .md 는 파일 상한을 통과하지만 본문 상한에 걸려 createMinutes 가 거절한다 —
      //    업로드 뒤에 거절당하면 고아 객체가 남는다. 그래서 업로드 **전에** 여기서 검사한다.
      const invalid = validateMinutesInput({ ...meta, contentMd })
      if (invalid) { setErr(invalid); return }

      // 5) Storage 업로드. upsert:false — 경로에 ms 타임스탬프가 붙고 file_path 에 UNIQUE 가 있으므로
      //    충돌은 곧 이상 신호다. 덮어쓰지 않고 시끄럽게 실패한다.
      const sb = createBrowserClient()
      const up = await sb.storage.from(BUCKET).upload(path, file, { upsert: false })
      if (up.error) { setErr(`${t('min.err.uploadFail')}: ${up.error.message}`); return }

      // ── 이 지점부터 객체가 존재한다. 아래 모든 실패 경로는 롤백하거나, 의도적으로 남긴다. ──

      // 6) 메타 기록. 서버 액션은 throw 하지 않지만 전송(fetch)은 끊길 수 있다.
      const res = await createMinutes(
        projectId,
        { ...meta, contentMd },
        { fileName: file.name, filePath: path, size: file.size, mime: file.type || 'application/octet-stream' },
      ).catch(() => null)

      if (res === null) {
        // 전송 실패 — insert 가 됐는지 알 수 없다. 여기서 지우면 정상 등록된 행의 파일을 날려
        // 되살릴 수 없는 '깨진 링크 행'을 만든다. 객체를 남기는 쪽이 덜 파괴적이다(최악은 고아 객체).
        console.error('[minutes] createMinutes 응답 유실 — 행 생성 여부 불명, 객체를 남깁니다:', `${BUCKET}/${path}`)
        setErr(t('min.err.recordFail'))
        return
      }

      // 7) 거절 → 보상 트랜잭션.
      //
      // 이 remove() 는 조용히 실패할 수 있다. 0020 의 "minutes delete" 정책은
      //   owner = auth.uid()  OR  exists(file_path 가 이 객체를 가리키는 meeting_minutes 행)
      // 인데, createMinutes 가 실패해 그 행이 없으므로 여기서는 owner 분기에만 의존한다.
      // 최신 Supabase 가 owner(uuid) 대신 owner_id(text) 를 채우면 그 분기가 죽어 삭제가 거부된다
      // (0020 주석이 말하는 '우아한 열화'가 정확히 이 경우다 → 고아 객체).
      //
      // 결정적으로 "거부"와 "성공"은 둘 다 error:null 로 온다 — data 로만 구분된다.
      // remove() 는 실제로 지운 객체 목록을 돌려주므로 빈 배열 = 아무것도 안 지워짐 = 고아 확정
      // (방금 업로드에 성공한 객체라 '원래 없었음'은 불가능하다). 최소한 로그로 회수 가능하게 남긴다.
      if (!res.ok) {
        try {
          const rm = await sb.storage.from(BUCKET).remove([path])
          if (rm.error || (rm.data?.length ?? 0) === 0) {
            console.error(
              '[minutes] 롤백 실패 — 고아 객체가 남았습니다:',
              `${BUCKET}/${path}`,
              rm.error?.message ?? '삭제된 객체 0개(스토리지 삭제 정책 거부로 추정)',
            )
          }
        } catch (e) {
          // 네트워크 단절 등. remove() 는 멱등이므로 같은 경로로 재시도해도 안전하다.
          console.error('[minutes] 롤백 요청 실패 — 고아 객체가 남았을 수 있습니다:', `${BUCKET}/${path}`, e)
        }
        setErr(res.error ?? t('min.err.recordFail'))
        return
      }

      // 8) 성공 — revalidatePath(서버)와 router.refresh()(현재 트리) 둘 다 필요하다.
      setTitle('')
      if (fileRef.current) fileRef.current.value = ''
      onClose()
      router.refresh()
    } catch {
      setErr(t('min.err.uploadFail'))
    } finally {
      submittingRef.current = false
      setBusy(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={handleClose}
      title={t('min.upload')}
      footer={
        <>
          <button className="btn btn-ghost" onClick={handleClose} disabled={busy}>{t('min.cancel')}</button>
          <button className="btn btn-primary" onClick={onSubmit} disabled={busy || !teamId}>
            {busy ? t('min.uploading') : t('min.form.submit')}
          </button>
        </>
      }
    >
      <div className="space-y-3">
        <label className="block text-sm">
          <span className="text-ink-muted">{t('min.form.team')}</span>
          <select className="app-input mt-1" value={teamId} onChange={e => setTeamId(e.target.value)} disabled={busy}>
            {allowed.map(tm => <option key={tm.id} value={tm.id}>{tm.code}</option>)}
          </select>
        </label>
        <label className="block text-sm">
          <span className="text-ink-muted">{t('min.form.date')}</span>
          <input type="date" className="app-input mt-1" value={minutesDate} onChange={e => setMinutesDate(e.target.value)} disabled={busy} />
        </label>
        <label className="block text-sm">
          <span className="text-ink-muted">{t('min.form.title')}</span>
          <input className="app-input mt-1" value={title} onChange={e => setTitle(e.target.value)} maxLength={200} disabled={busy} />
        </label>
        <label className="block text-sm">
          <span className="text-ink-muted">{t('min.form.file')}</span>
          {/* accept 를 걸지 않는다 — .md 외 형식도 다운로드 전용으로 받는다. */}
          <input ref={fileRef} type="file" className="mt-1 w-full text-sm" disabled={busy} />
        </label>
        <p className="text-xs text-ink-muted">{t('min.form.mdOnlyHint')}</p>
        {err && <p className="text-sm text-delayed" role="alert">{err}</p>}
      </div>
    </Modal>
  )
}
