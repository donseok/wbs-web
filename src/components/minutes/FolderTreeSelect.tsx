'use client'
import { Folder, FolderOpen } from 'lucide-react'
import type { FolderNode, MinuteFolder } from '@/lib/domain/types'
import { buildFolderTree, teamSubOfFolder } from '@/lib/domain/minutes'

/**
 * 인라인 폴더 트리 선택기 — 업로드·수정 모달의 "담당 + 하위 구분" 2단 셀렉트를 대체한다(§6).
 *
 * **미분류 항목이 없다.** 폴더가 team_code 의 유일한 출처가 되므로(§6.3) 회의록은 반드시
 * 시드 팀 루트의 서브트리 어딘가에 있어야 한다. 폴더에서 팀을 파생할 수 없는 노드
 * (시드 체인 밖)는 선택 자체를 막는다 — 조용히 기본 팀으로 폴백하면 불변식 위반 데이터가
 * 계속 생산된다.
 */
export function FolderTreeSelect({
  folders, value, onChange, ariaLabel,
}: {
  folders: MinuteFolder[]
  value: string | null
  onChange: (folderId: string) => void
  ariaLabel?: string
}) {
  const { roots } = buildFolderTree(folders, [])

  function rows(nodes: FolderNode[], depth: number): React.ReactNode[] {
    return nodes.flatMap(n => {
      const selected = n.folder.id === value
      // 팀 파생이 안 되는 폴더는 저장 시 서버가 거절하므로 선택 자체를 막는다(허위 어포던스 방지)
      const selectable = teamSubOfFolder(folders, n.folder.id) !== null
      return [
        <li key={n.folder.id}>
          <button
            type="button"
            role="option"
            aria-selected={selected}
            disabled={!selectable}
            onClick={() => onChange(n.folder.id)}
            style={{ paddingLeft: `${8 + depth * 16}px` }}
            // 탐색기 rowCls 와 같은 선택 강조(bg-brand-weak) — 트리 표현이 화면마다 달라지면 안 된다
            className={`flex h-8 w-full min-w-0 items-center gap-2 rounded-lg pr-2 text-left transition-colors duration-100 ${
              selected ? 'bg-brand-weak font-semibold text-brand' : 'text-ink hover:bg-surface-2'
            } ${selectable ? '' : 'cursor-not-allowed opacity-40'}`}
          >
            {selected
              ? <FolderOpen aria-hidden className="h-4 w-4 shrink-0" />
              : <Folder aria-hidden className="h-4 w-4 shrink-0 text-ink-subtle" />}
            <span className="min-w-0 flex-1 truncate text-[13px]">{n.folder.name}</span>
          </button>
        </li>,
        ...rows(n.children, depth + 1),
      ]
    })
  }

  return (
    <ul role="listbox" aria-label={ariaLabel} className="max-h-56 space-y-0.5 overflow-y-auto rounded-lg border border-line p-1">
      {rows(roots, 0)}
    </ul>
  )
}
