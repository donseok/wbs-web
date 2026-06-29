'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Plus, FolderPlus } from 'lucide-react'
import { Modal } from '@/components/ui/Modal'
import { createProject } from '@/app/actions/project'

/**
 * 워크스페이스 홈의 "새 프로젝트 시작" 트리거 + 다이얼로그.
 * D'Flow 'WORKSPACE DIALOG / 새 프로젝트' 모달.
 * 데모 모드에서는 createProject가 no-op이지만 닫기/새로고침은 정상 동작한다.
 */
export function NewProjectModal({
  label = '새 프로젝트 시작',
  className = 'inline-flex h-10 items-center gap-2 rounded-xl border border-white/15 bg-white/10 px-4 text-sm font-semibold text-hero-ink backdrop-blur transition hover:bg-white/20',
}: {
  label?: string
  className?: string
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [start, setStart] = useState('')
  const [end, setEnd] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function reset() {
    setName('')
    setDescription('')
    setStart('')
    setEnd('')
    setError(null)
  }

  function close() {
    if (busy) return
    setOpen(false)
    reset()
  }

  async function submit() {
    const trimmed = name.trim()
    if (!trimmed || busy) return
    setBusy(true)
    setError(null)
    try {
      await createProject(trimmed, start || null, end || null, description.trim() || null)
      router.refresh()
      setOpen(false)
      reset()
    } catch (e) {
      setError(e instanceof Error ? e.message : '프로젝트를 만들지 못했습니다.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <button type="button" className={className} onClick={() => setOpen(true)}>
        <Plus className="h-4 w-4" />
        {label}
      </button>

      <Modal
        open={open}
        onClose={close}
        eyebrow="Workspace dialog"
        title="새 프로젝트"
        footer={
          <>
            <button type="button" className="btn btn-ghost" onClick={close} disabled={busy}>
              취소
            </button>
            <button type="button" className="btn btn-primary" onClick={submit} disabled={!name.trim() || busy}>
              <FolderPlus className="h-4 w-4" />
              {busy ? '생성 중…' : '프로젝트 생성'}
            </button>
          </>
        }
      >
        <div className="space-y-4">
          <p className="text-sm leading-6 text-ink-muted">
            기본 정보를 입력해 새 프로젝트를 시작하세요. 생성 후 설정에서 WBS 엑셀을 가져올 수 있습니다.
          </p>

          <label className="block">
            <span className="mb-1.5 block text-xs font-semibold text-ink-muted">
              프로젝트명 <span className="text-delayed">*</span>
            </span>
            <input
              className="app-input"
              placeholder="예: ERP 고도화 프로젝트"
              value={name}
              onChange={e => setName(e.target.value)}
              autoFocus
              onKeyDown={e => {
                if (e.key === 'Enter') submit()
              }}
            />
          </label>

          <label className="block">
            <span className="mb-1.5 block text-xs font-semibold text-ink-muted">설명</span>
            <textarea
              className="app-textarea min-h-[84px]"
              placeholder="프로젝트의 목표나 범위를 간단히 적어주세요."
              value={description}
              onChange={e => setDescription(e.target.value)}
            />
          </label>

          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="mb-1.5 block text-xs font-semibold text-ink-muted">시작일</span>
              <input type="date" className="app-input px-2.5 text-sm" value={start} onChange={e => setStart(e.target.value)} />
            </label>
            <label className="block">
              <span className="mb-1.5 block text-xs font-semibold text-ink-muted">종료일</span>
              <input type="date" className="app-input px-2.5 text-sm" value={end} min={start || undefined} onChange={e => setEnd(e.target.value)} />
            </label>
          </div>

          {error && (
            <p className="rounded-xl border border-delayed/30 bg-delayed-weak px-3 py-2 text-xs font-medium text-delayed">{error}</p>
          )}
        </div>
      </Modal>
    </>
  )
}
