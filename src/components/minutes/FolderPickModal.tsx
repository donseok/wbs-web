'use client'
import { useMemo } from 'react'
import { Folder, FolderOpen } from 'lucide-react'
import type { FolderNode, MinuteFolder } from '@/lib/domain/types'
import { buildFolderTree } from '@/lib/domain/minutes'
import { useLocale } from '@/components/providers/LocaleProvider'
import { Modal } from '@/components/ui/Modal'

/** 이동 대상 폴더 픽커 — 트리 들여쓰기 + 미분류. 선택 즉시 onPick(닫기는 호출부).
 *  scopeProjectId 로 그 프로젝트 소속 폴더만 보여준다 — 교차 프로젝트 편철은 서버도 거부하므로
 *  (moveMinuteToFolder·createMinuteFolder 의 자식=부모 프로젝트 불변식) 애초에 고를 수 없게 한다.
 *  null = 미지정 폴더만. */
export function FolderPickModal({
  open, folders, scopeProjectId, onClose, onPick,
}: {
  open: boolean
  folders: MinuteFolder[]
  scopeProjectId: string | null
  onClose: () => void
  onPick: (folderId: string | null) => void
}) {
  const { t } = useLocale()
  const scoped = useMemo(
    () => folders.filter(f => (f.projectId ?? null) === scopeProjectId),
    [folders, scopeProjectId],
  )
  const { roots } = buildFolderTree(scoped, [])

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
