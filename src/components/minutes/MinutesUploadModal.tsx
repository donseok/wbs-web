'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useLocale } from '@/components/providers/LocaleProvider'
import { Modal } from '@/components/ui/Modal'
import { createBrowserClient } from '@/lib/supabase/client'
import { createMinutes, deleteMinutes } from '@/app/actions/minutes'
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

      // 3) .md 면 본문을 읽는다. 아직 DB/Storage 를 건드리지 않았으므로 실패해도 남는 게 없다.
      let contentMd: string | null = null
      if (isMarkdownFile(path)) {
        contentMd = await file.text()
        // Blob.text() 는 UTF-8 로만 디코드한다. EUC-KR 로 저장된 한글 .md 는 U+FFFD 로 깨진 채
        // content_md 에 영구 저장되고 상세 화면이 그대로 렌더한다. 되돌릴 수 없으므로 여기서 거른다.
        // (ASCII-only 파일은 EUC-KR 이어도 UTF-8 과 바이트가 같아 오탐이 없다.)
        if (contentMd.includes('\uFFFD')) { setErr(t('min.err.encoding')); return }
      }

      // 4) MINUTES_MD_MAX(500,000자) 는 MINUTES_FILE_MAX(20MB) 와 별개 상한이다.
      //    15MB .md 는 파일 상한을 통과하지만 본문 상한에 걸려 createMinutes 가 거절한다.
      //    이미 실패가 확정된 입력을 DB/Storage 까지 보내지 않는다 — 모든 사전 검사는 여기서 끝난다.
      const invalid = validateMinutesInput({ ...meta, contentMd })
      if (invalid) { setErr(invalid); return }

      // createBrowserClient() 는 env 가 없으면 throw 한다. 아래 INSERT 와 upload 사이에서 터지면
      // 바깥 catch 로 빠져 롤백을 건너뛰므로, 행을 만들기 **전에** 미리 만들어 둔다.
      const sb = createBrowserClient()

      // ─────────────────────────────────────────────────────────────────────────────
      // 보상 트랜잭션: **행 먼저, 객체 나중.** 순서가 핵심이고, 뒤집으면 고아 객체가 생긴다.
      //
      // 0020 의 "minutes delete" 스토리지 정책은 삭제 권한을
      //     bucket_id = 'minutes' and exists (
      //       select 1 from meeting_minutes mm
      //       where mm.file_path = storage.objects.name
      //         and (mm.created_by = auth.uid() or app_role() = 'pmo_admin'))
      // 으로 정의한다 — 즉 **객체를 지우려면 그 객체를 가리키는 행이 살아 있어야 한다.**
      //
      // 객체를 먼저 올리면(= RowDetailPanel.tsx 의 순서) 롤백 시점엔 아직 행이 없다.
      // 그러면 EXISTS 가 거짓이라 삭제가 거부되고, remove() 는 거부를 200/[]/error:null 로 돌려주므로
      // 코드는 성공으로 착각한 채 아무도 참조하지 않는 객체가 영구히 남는다(= 보이지 않는 고아).
      //
      // 행을 먼저 넣으면 그 함정이 사라진다. minutesStoragePath() 는 순수 함수라 I/O 전에 경로를
      // 알 수 있고, file_path 의 UNIQUE 인덱스가 그 경로를 예약한다. 업로드가 실패하면 행이 살아 있는
      // 상태에서 deleteMinutes() 를 부르므로 EXISTS 가 참이 되어 객체 삭제가 허가된다.
      // storage.objects.owner 가 채워지는지 여부에 기대지 않는다 — 확인 불가능한 가정이었다.
      //
      // **객체가 존재하는데 그를 가리키는 행이 없는 순간 자체가 없다** → 고아 객체는 구조적으로 불가능.
      // 최악의 잔여 상태는 객체가 안 올라간 '깨진 링크 행'인데, 이건 목록에 **보이고**
      // 사용자가 삭제하면 스스로 낫는다(deleteMinutes 의 remove() 는 없는 키에 멱등한 no-op).
      // 대가: 업로드가 끝나기 전 몇 초간 다운로드 링크가 404 다. content_md 는 5) 에서 이미 들어가므로
      // .md 의 바로보기/챗은 그 순간에도 정상 동작한다.
      //
      // RowDetailPanel.tsx:318-340 은 반대 순서(객체→메타)를 쓴다. 그 버킷은 삭제 정책이 다르다.
      // 여기서 순서를 "관례에 맞춘다"며 되돌리지 말 것 — 의도된 분기이지 실수가 아니다.
      // ─────────────────────────────────────────────────────────────────────────────

      // 5) 행 먼저. 서버 액션은 throw 하지 않지만 전송(fetch)은 끊길 수 있다.
      const res = await createMinutes(
        projectId,
        { ...meta, contentMd },
        { fileName: file.name, filePath: path, size: file.size, mime: file.type || 'application/octet-stream' },
      ).catch(() => null)

      if (res === null) {
        // 전송 유실 — insert 됐는지 알 수 없다. 하지만 객체는 아직 올리지 않았으니 고아는 불가능하다.
        // 행이 생겼다면 '깨진 링크 행'으로 목록에 보인다. 새로고침해서 사용자에게 드러낸다.
        setErr(t('min.err.recordFail'))
        router.refresh()
        return
      }
      // 거절 — createMinutes 의 ok:false 경로는 전부 INSERT 이전(권한/검증/경로/md 게이트)이거나
      // INSERT 자체의 실패다. 어느 쪽이든 행이 없으니 정리할 것도 없다.
      if (!res.ok) { setErr(res.error ?? t('min.err.recordFail')); return }
      // ok 인데 id 가 없는 건 현재 구현상 도달 불가다. 그래도 행은 생긴 것이므로 롤백 대상을 잃었다 —
      // 조용히 숨기지 말고 새로고침해 깨진 링크 행을 드러낸다.
      if (!res.id) { setErr(t('min.err.uploadRollbackFail')); router.refresh(); return }
      const rowId = res.id

      // 6) 객체 업로드. upsert:false — 경로에 ms 타임스탬프가 붙고 file_path 에 UNIQUE 가 있으므로
      //    충돌은 곧 이상 신호다. 덮어쓰지 않고 시끄럽게 실패한다.
      //    throw 를 여기서 잡아 아래 롤백으로 흘린다 — 바깥 catch 로 빠지면 행이 그대로 남는다.
      const up = await sb.storage.from(BUCKET).upload(path, file, { upsert: false }).catch(() => null)
      const upErr = up?.error ?? null

      if (!up || upErr) {
        // 7) 롤백 — 행이 살아 있는 지금 부른다. deleteMinutes 가 객체 제거 → 행 삭제 순으로 처리하고,
        //    객체가 아예 안 올라갔으면 remove() 는 멱등한 no-op 이다. 손으로 remove() 하지 않는다.
        const rb = await deleteMinutes(rowId).catch(() => null)
        if (!rb || !rb.ok) {
          // 롤백까지 실패 → 깨진 링크 행이 남았다. 숨기지 말고 보여주고, 할 일을 정확히 알려준다.
          setErr(t('min.err.uploadRollbackFail'))
          router.refresh()
          return
        }
        setErr(upErr ? `${t('min.err.uploadFail')}: ${upErr.message}` : t('min.err.uploadFail'))
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
