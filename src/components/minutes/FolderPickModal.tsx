'use client'
import { Folder, FolderOpen } from 'lucide-react'
import type { FolderNode, MinuteFolder } from '@/lib/domain/types'
import { buildFolderTree } from '@/lib/domain/minutes'
import { useLocale } from '@/components/providers/LocaleProvider'
import { Modal } from '@/components/ui/Modal'

/** 이동 대상 폴더 픽커 — 트리 들여쓰기 + 미분류. 선택 즉시 onPick(닫기는 호출부). */
export function FolderPickModal({
  open, folders, onClose, onPick,
}: {
  open: boolean
  folders: MinuteFolder[]
  onClose: () => void
  onPick: (folderId: string | null) => void
}) {
  const { t } = useLocale()
  const { roots } = buildFolderTree(folders, [])

  function rows(nodes: FolderNode[], depth: number): React.ReactNode[] {
    return nodes.flatMap(n => [
      <li key={n.folder.id}>
        <button onClick={() => onPick(n.folder.id)}
          style={{ paddingLeft: `${8 + depth * 16}px` }}
          className="flex h-8 w-full min-w-0 items-center gap-2 rounded-lg pr-2 text-left transition-colors duration-100 hover:bg-surface-2">
          <Folder aria-hidden className="h-4 w-4 shrink-0 text-ink-subtle" />
          <span className="min-w-0 flex-1 truncate text-[13px] text-ink">{n.folder.name}</span>
        </button>
      </li>,
      ...rows(n.children, depth + 1),
    ])
  }

  return (
    <Modal open={open} onClose={onClose} title={t('min.fold.pickTitle')} size="sm">
      <ul className="max-h-80 space-y-0.5 overflow-y-auto">
        <li>
          <button onClick={() => onPick(null)}
            className="flex h-8 w-full min-w-0 items-center gap-2 rounded-lg px-2 text-left transition-colors duration-100 hover:bg-surface-2">
            <FolderOpen aria-hidden className="h-4 w-4 shrink-0 text-ink-subtle" />
            <span className="min-w-0 flex-1 truncate text-[13px] text-ink">{t('min.fold.unfiled')}</span>
          </button>
        </li>
        {rows(roots, 0)}
      </ul>
    </Modal>
  )
}
