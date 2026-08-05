'use client'
// 이슈 첨부 — 한 컴포넌트가 세 자리를 덮는다.
//   등록 폼   issueId=null  editable   → 고른 파일을 부모 state 에 담기만 한다(업로드 안 함)
//   수정 폼   issueId 있음  editable   → 고르는 즉시 업로드
//   상세 모달 issueId 있음  editable=X → 파일명 클릭 = 다운로드
//
// 등록 폼의 파일 state 를 이 컴포넌트가 갖지 않는 이유: 저장 성공 직후 업로드를 await 해야
// 하는 코드가 IssueFormModal.submit() 안에 있고, 여기 두면 모달이 닫힐 때 값이 사라진다.
// 그래서 pending 은 부모가 소유하고 이 컴포넌트는 표시·편집만 한다(controlled).
//
// 표시 토글은 전부 JSX 조건부 렌더다. 상태 변형 display 유틸은 globals.css 끝의 unlayered
// 안전망에 져서 조용히 동작하지 않는다(tests/css/breakpoint-safety-net.test.ts 가 검사).
import { useCallback, useEffect, useState, type ChangeEvent } from 'react'
import { useRouter } from 'next/navigation'
import { FileText, Paperclip, Upload, X } from 'lucide-react'
import { useLocale } from '@/components/providers/LocaleProvider'
import { listIssueAttachments, removeIssueAttachment } from '@/app/actions/issueAttachments'
import {
  ISSUE_ATTACHMENT_MAX_BYTES,
  ISSUE_ATTACHMENT_MAX_COUNT,
  isIssueAttachmentSizeAllowed,
  remainingIssueAttachmentSlots,
  type IssueAttachment,
} from '@/lib/domain/issueAttachments'
import { uploadIssueAttachments } from '@/lib/issues/uploadIssueAttachments'

const MAX_MB = Math.round(ISSUE_ATTACHMENT_MAX_BYTES / 1024 / 1024)

function fmtSize(n: number | null): string {
  if (n == null) return ''
  if (n < 1024) return `${n}B`
  if (n < 1024 * 1024) return `${Math.round(n / 1024)}KB`
  return `${(n / 1024 / 1024).toFixed(1)}MB`
}

export interface IssueAttachmentsProps {
  /** null 이면 아직 저장되지 않은 이슈 — 고른 파일을 부모에게 넘기기만 한다. */
  issueId: string | null
  editable?: boolean
  /** 등록 폼 전용: 아직 올리지 않은 파일들(부모 소유). */
  pending?: readonly File[]
  onPendingChange?: (files: File[]) => void
}

export function IssueAttachments({ issueId, editable, pending, onPendingChange }: IssueAttachmentsProps) {
  const router = useRouter()
  const { t } = useLocale()
  const [list, setList] = useState<IssueAttachment[] | null>(issueId ? null : [])
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const load = useCallback(() => {
    if (!issueId) { setList([]); return }
    listIssueAttachments(issueId).then(setList).catch(() => setList([]))
  }, [issueId])
  useEffect(() => { if (issueId) setList(null); load() }, [issueId, load])

  const saved = list ?? []
  const pendingFiles = pending ?? []
  const total = saved.length + pendingFiles.length
  const remaining = remainingIssueAttachmentSlots(total)

  async function onPick(e: ChangeEvent<HTMLInputElement>) {
    const picked = Array.from(e.target.files ?? [])
    e.target.value = ''
    if (picked.length === 0) return
    setErr(null)

    if (picked.length > remaining) {
      setErr(t('issue.err.attachTooMany').replace('{n}', String(ISSUE_ATTACHMENT_MAX_COUNT)))
      return
    }
    const tooBig = picked.find(f => !isIssueAttachmentSizeAllowed(f.size))
    if (tooBig) {
      setErr(t('issue.err.attachTooLarge').replace('{name}', tooBig.name).replace('{mb}', String(MAX_MB)))
      return
    }

    // 저장 전 이슈 — 담아만 둔다. 실제 업로드는 저장 성공 후 IssueFormModal 이 한다.
    if (!issueId) { onPendingChange?.([...pendingFiles, ...picked]); return }

    setBusy(true)
    try {
      const res = await uploadIssueAttachments(issueId, picked)
      if (!res.ok) {
        setErr(
          res.reason === 'too-large'
            ? t('issue.err.attachTooLarge').replace('{name}', res.fileName).replace('{mb}', String(MAX_MB))
            : t('issue.err.attachUploadFailed').replace('{name}', res.fileName),
        )
        // 일부라도 올라갔으면 목록에 반영한다.
        if (res.doneCount > 0) { load(); router.refresh() }
        return
      }
      load()
      router.refresh()
    } finally { setBusy(false) }
  }

  async function del(id: string) {
    setBusy(true); setErr(null)
    const res = await removeIssueAttachment(id)
    setBusy(false)
    if (!res.ok) { setErr(res.error ?? t('issue.err.attachRemoveFailed')); return }
    load(); router.refresh()
  }

  function dropPending(index: number) {
    onPendingChange?.(pendingFiles.filter((_, i) => i !== index))
  }

  return (
    <section>
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.08em] text-ink-subtle">
          <Paperclip className="h-3.5 w-3.5" /> {t('issue.attach.section')}
        </div>
        {editable && remaining > 0 && (
          <label className="btn btn-ghost h-7 cursor-pointer px-2.5 text-xs">
            <Upload className="h-3.5 w-3.5" /> {busy ? t('issue.attach.uploading') : t('issue.attach.add')}
            {/* 숨김 input 은 Modal 포커스 트랩에서 빠진다(offsetParent 필터). 라벨로 연다. */}
            <input type="file" multiple className="hidden" onChange={onPick} disabled={busy} />
          </label>
        )}
      </div>

      {editable && (
        <p className="mb-2 text-[11px] text-ink-subtle">
          {t('issue.attach.limit').replace('{mb}', String(MAX_MB)).replace('{n}', String(ISSUE_ATTACHMENT_MAX_COUNT))}
        </p>
      )}
      {err && <p className="mb-2 text-xs font-medium text-delayed">{err}</p>}

      {list == null ? (
        <p className="text-sm text-ink-subtle">{t('common.loading')}</p>
      ) : total === 0 ? (
        <p className="text-sm text-ink-subtle">{t('issue.attach.empty')}</p>
      ) : (
        <ul className="space-y-1.5">
          {saved.map(a => (
            <li key={a.id} className="flex items-center gap-2 rounded-lg border border-line bg-surface-2/60 px-2.5 py-2">
              <FileText className="h-3.5 w-3.5 shrink-0 text-ink-subtle" />
              <a
                href={a.url ?? '#'}
                target="_blank"
                rel="noreferrer"
                className="min-w-0 flex-1 truncate text-[13px] text-brand hover:underline"
                title={a.fileName}
              >
                {a.fileName}
              </a>
              {a.size != null && <span className="shrink-0 text-[11px] tabular-nums text-ink-subtle">{fmtSize(a.size)}</span>}
              {editable && (
                <button
                  type="button"
                  onClick={() => del(a.id)}
                  disabled={busy}
                  aria-label={t('issue.attach.remove')}
                  title={t('issue.attach.remove')}
                  className="shrink-0 rounded p-1 text-ink-subtle hover:text-delayed"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </li>
          ))}
          {pendingFiles.map((f, i) => (
            <li
              key={`pending-${i}-${f.name}`}
              className="flex items-center gap-2 rounded-lg border border-dashed border-line bg-surface-2/30 px-2.5 py-2"
            >
              <FileText className="h-3.5 w-3.5 shrink-0 text-ink-subtle" />
              <span className="min-w-0 flex-1 truncate text-[13px] text-ink" title={f.name}>{f.name}</span>
              <span className="shrink-0 text-[11px] tabular-nums text-ink-subtle">{fmtSize(f.size)}</span>
              <button
                type="button"
                onClick={() => dropPending(i)}
                aria-label={t('issue.attach.remove')}
                title={t('issue.attach.remove')}
                className="shrink-0 rounded p-1 text-ink-subtle hover:text-delayed"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}
      {pendingFiles.length > 0 && (
        <p className="mt-2 text-[11px] text-ink-subtle">{t('issue.attach.pending')}</p>
      )}
    </section>
  )
}
