'use client'

// 팀 기준정보 관리 테이블 — AccountsManager 와 동일한 카드·버튼·칩 컨벤션.
// 삭제 버튼은 의도적으로 없다: 비활성화가 삭제(데이터 보존, 사용자 결정 2026-07-24).
import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowDown, ArrowUp, Eye, EyeOff, Plus, Power } from 'lucide-react'
import { addTeam, updateTeam } from '@/app/actions/teams'
import { useToast } from '@/components/ui/Toast'

export interface AdminTeamRow {
  id: string
  code: string
  sortOrder: number
  active: boolean
  progressVisible: boolean
}

export function TeamsManager({ teams }: { teams: AdminTeamRow[] }) {
  const router = useRouter()
  const { toast } = useToast()
  const [newCode, setNewCode] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  function run(fn: () => Promise<{ ok: boolean; error?: string }>) {
    setError(null)
    startTransition(async () => {
      const r = await fn()
      if (!r.ok) { setError(r.error ?? '실패했습니다.'); return }
      router.refresh()
    })
  }

  function submitAdd() {
    const code = newCode.trim()
    if (!code) { setError('팀 이름을 입력하세요.'); return }
    run(async () => {
      const r = await addTeam(code)
      if (r.ok) { setNewCode(''); toast({ title: `'${code}' 팀을 추가했습니다.`, variant: 'success' }) }
      return r
    })
  }

  /** 정렬 스왑 — 인접 행과 sortOrder 교환(2건 update). */
  function move(idx: number, dir: -1 | 1) {
    const a = teams[idx], b = teams[idx + dir]
    if (!a || !b) return
    run(async () => {
      const r1 = await updateTeam(a.id, { sortOrder: b.sortOrder })
      if (!r1.ok) return r1
      return updateTeam(b.id, { sortOrder: a.sortOrder })
    })
  }

  return (
    <section className="card overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-4 sm:px-6">
        <div>
          <h2 className="text-base font-semibold text-ink">팀 목록</h2>
          <p className="text-sm text-ink-muted">
            여기 등록된 팀이 탭·필터·검증·엑셀·회의록 편철의 단일 기준입니다. 비활성화하면 화면에서
            숨겨지고 기존 데이터는 보존됩니다.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <input
            value={newCode}
            onChange={e => setNewCode(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') submitAdd() }}
            placeholder="새 팀 이름"
            maxLength={20}
            className="app-input w-40"
            disabled={pending}
          />
          <button onClick={submitAdd} className="btn btn-primary" disabled={pending}>
            <Plus className="h-4 w-4" />팀 추가
          </button>
        </div>
      </div>

      <div className="p-5 sm:p-6">
        {error && (
          <p role="alert" className="mb-3 rounded-lg bg-delayed-weak px-3 py-2 text-sm text-delayed">{error}</p>
        )}
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] text-sm">
            <thead>
              <tr className="border-b border-line text-left text-ink-subtle">
                <th className="py-2 pr-3">순서</th>
                <th className="py-2 pr-3">팀</th>
                <th className="py-2 pr-3">상태</th>
                <th className="py-2 pr-3">팀별 진척현황</th>
                <th className="py-2 pr-3 text-right">작업</th>
              </tr>
            </thead>
            <tbody>
              {teams.map((t, i) => (
                <tr key={t.id} className={`border-b border-line/60 ${t.active ? '' : 'opacity-60'}`}>
                  <td className="py-2.5 pr-3">
                    <div className="flex items-center gap-1">
                      <button onClick={() => move(i, -1)} disabled={pending || i === 0}
                        className="btn btn-ghost btn-sm" aria-label={`${t.code} 위로`}>
                        <ArrowUp className="h-3.5 w-3.5" />
                      </button>
                      <button onClick={() => move(i, 1)} disabled={pending || i === teams.length - 1}
                        className="btn btn-ghost btn-sm" aria-label={`${t.code} 아래로`}>
                        <ArrowDown className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </td>
                  <td className="py-2.5 pr-3 font-medium text-ink">{t.code}</td>
                  <td className="py-2.5 pr-3">
                    <span className={`chip ${t.active ? 'bg-done-weak text-done' : 'bg-surface-2 text-ink-subtle'}`}>
                      {t.active ? '활성' : '비활성'}
                    </span>
                  </td>
                  <td className="py-2.5 pr-3">
                    <span className={`chip ${t.progressVisible ? 'bg-brand-weak text-brand' : 'bg-surface-2 text-ink-subtle'}`}>
                      {t.progressVisible ? '표시' : '숨김'}
                    </span>
                  </td>
                  <td className="py-2.5 pr-3">
                    <div className="flex items-center justify-end gap-1.5">
                      <button
                        onClick={() => run(() => updateTeam(t.id, { progressVisible: !t.progressVisible }))}
                        className="btn btn-ghost btn-sm" disabled={pending}
                        title={t.progressVisible ? '팀별 진척현황에서 숨기기' : '팀별 진척현황에 표시'}>
                        {t.progressVisible ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                        진척
                      </button>
                      <button
                        onClick={() => run(() => updateTeam(t.id, { active: !t.active }))}
                        className="btn btn-ghost btn-sm" disabled={pending}
                        title={t.active ? '비활성화(화면에서 숨김, 데이터 보존)' : '다시 활성화'}>
                        <Power className="h-3.5 w-3.5" />
                        {t.active ? '비활성화' : '활성화'}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-xs text-ink-subtle">
          팀 추가 시 회의록 보관함에 같은 이름의 기본 폴더(자동 편철 앵커)가 함께 생성됩니다. 이름
          변경(개명)은 편철·데이터 연쇄가 있어 지원하지 않습니다.
        </p>
      </div>
    </section>
  )
}
