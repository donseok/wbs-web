'use client'

// WBS 단계(레벨) 편집 — 라벨 배열이 곧 깊이(labels.length = max_depth).
// 축소·중복·빈 라벨 검증의 정본은 서버 액션(updateLevelSettings → domain/levelSettings)이며
// 여기서는 입력 UI 와 결과 표시만 한다. 실패를 조용히 삼키지 않는다(표시 = 로깅 원칙).
import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Plus, X } from 'lucide-react'
import { updateLevelSettings } from '@/app/actions/project'
import { LEVEL_LABELS_MAX } from '@/lib/domain/levelSettings'

export function LevelSettingsManager({ projectId, levelLabels }: {
  projectId: string
  levelLabels: string[]
}) {
  const router = useRouter()
  const [labels, setLabels] = useState<string[]>(levelLabels)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  function save() {
    setError(null)
    startTransition(async () => {
      const r = await updateLevelSettings(projectId, labels)
      if (!r.ok) { setError(r.error ?? '저장에 실패했습니다.'); return }
      router.refresh()
    })
  }

  return (
    <div className="space-y-2">
      <ol className="space-y-1.5">
        {labels.map((label, i) => (
          <li key={i} className="flex items-center gap-2">
            <span className="w-10 shrink-0 text-right text-xs tabular-nums text-ink-subtle">{i + 1}단</span>
            <input
              data-level-label
              className="input h-8 flex-1 text-sm"
              value={label}
              onChange={(e) => setLabels(labels.map((l, j) => (j === i ? e.target.value : l)))}
              disabled={pending}
            />
            {labels.length > 1 && (
              <button
                type="button"
                data-remove-level
                className="btn btn-ghost h-8 w-8 shrink-0 p-0"
                aria-label={`${i + 1}단 삭제`}
                onClick={() => setLabels(labels.filter((_, j) => j !== i))}
                disabled={pending}
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </li>
        ))}
      </ol>
      <div className="flex items-center gap-2">
        {labels.length < LEVEL_LABELS_MAX && (
          <button
            type="button"
            data-add-level
            className="btn btn-ghost h-8 text-sm"
            onClick={() => setLabels([...labels, ''])}
            disabled={pending}
          >
            <Plus className="h-4 w-4" /> 단계 추가
          </button>
        )}
        <button type="button" data-save-levels className="btn btn-primary h-8 text-sm" onClick={save} disabled={pending}>
          저장
        </button>
      </div>
      {error && <p className="text-xs text-delayed">{error}</p>}
    </div>
  )
}
