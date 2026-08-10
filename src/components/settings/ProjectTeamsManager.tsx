'use client'

// 프로젝트 스코프 팀 관리(0071) — admin/TeamsManager 를 본뜨되 가드·액션·문구가 다르다.
// 회의록은 전역 팀 축이라 여기서 시드 폴더를 만들지 않는다(addProjectTeam/copyGlobalTeams 계약).
// 삭제 버튼은 없다: 비활성화가 삭제(전역 팀과 동일 관례).
import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowDown, ArrowUp, Copy, Eye, EyeOff, Plus, Power } from 'lucide-react'
import { addProjectTeam, copyGlobalTeams, updateProjectTeam } from '@/app/actions/projectTeams'
import { Modal } from '@/components/ui/Modal'
import { useToast } from '@/components/ui/Toast'

/** admin/TeamsManager.tsx 의 AdminTeamRow 와 형태가 같지만 별개 선언이다 — 액션·문구가
 *  프로젝트 스코프로 갈라져 있어 import 로 묶으면 오히려 결합이 생긴다(브리프 지시). */
export interface AdminTeamRow {
  id: string
  code: string
  sortOrder: number
  active: boolean
  progressVisible: boolean
}

/** 상속 중(프로젝트 팀 0개) 상태에서 첫 추가/복사를 실행하기 전에만 뜨는 경고. */
const INHERITANCE_WARNING =
  '이 프로젝트는 더 이상 전역 팀을 따르지 않습니다. 기존 WBS 담당이 전역 팀에 걸려 있으면 화면에서 \'목록 밖 팀\'으로 처리됩니다(칸반 미배정·엑셀 열 덧붙임). 계속할까요?'

type PendingAction = { type: 'add'; code: string } | { type: 'copy' }

export function ProjectTeamsManager({ projectId, teams, inherited }: {
  projectId: string
  teams: AdminTeamRow[]
  inherited: boolean
}) {
  const router = useRouter()
  const { toast } = useToast()
  const [newCode, setNewCode] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  // 상속 안내 패널에서 '빈 목록에서 시작'을 눌렀을 때만 추가 입력을 드러낸다.
  const [showAddInput, setShowAddInput] = useState(false)
  const [confirming, setConfirming] = useState<PendingAction | null>(null)

  function run(fn: () => Promise<{ ok: boolean; error?: string }>) {
    setError(null)
    startTransition(async () => {
      const r = await fn()
      if (!r.ok) { setError(r.error ?? '실패했습니다.'); return }
      router.refresh()
    })
  }

  function doAdd(code: string) {
    run(async () => {
      const r = await addProjectTeam(projectId, code)
      if (r.ok) { setNewCode(''); toast({ title: `'${code}' 팀을 추가했습니다.`, variant: 'success' }) }
      return r
    })
  }

  function doCopy() {
    run(async () => {
      const r = await copyGlobalTeams(projectId)
      if (r.ok) toast({ title: '전역 팀을 복사했습니다.', variant: 'success' })
      return r
    })
  }

  function submitAdd() {
    const code = newCode.trim()
    if (!code) { setError('팀 이름을 입력하세요.'); return }
    // 상속 중일 때만 경고 — 이미 프로젝트 팀이 정의돼 있으면(inherited=false) 곧장 추가한다.
    if (inherited) { setConfirming({ type: 'add', code }); return }
    doAdd(code)
  }

  function confirmProceed() {
    const action = confirming
    setConfirming(null)
    if (!action) return
    if (action.type === 'add') doAdd(action.code)
    else doCopy()
  }

  /** 정렬 스왑 — 인접 행과 sortOrder 교환(2건 update). */
  function move(idx: number, dir: -1 | 1) {
    const a = teams[idx], b = teams[idx + dir]
    if (!a || !b) return
    run(async () => {
      const r1 = await updateProjectTeam(projectId, a.id, { sortOrder: b.sortOrder })
      if (!r1.ok) return r1
      return updateProjectTeam(projectId, b.id, { sortOrder: a.sortOrder })
    })
  }

  const warningModal = (
    <Modal
      open={!!confirming}
      onClose={() => { if (!pending) setConfirming(null) }}
      eyebrow="Teams"
      title="전역 팀 상속 종료"
      size="sm"
      footer={
        <>
          <button type="button" className="btn btn-ghost" disabled={pending} onClick={() => setConfirming(null)}>
            취소
          </button>
          <button type="button" className="btn btn-primary" disabled={pending} onClick={confirmProceed}>
            {pending ? '처리 중…' : '계속'}
          </button>
        </>
      }
    >
      <p className="text-sm leading-6 text-ink-muted">{INHERITANCE_WARNING}</p>
    </Modal>
  )

  if (inherited) {
    return (
      <section className="card overflow-hidden">
        <div className="p-5 sm:p-6">
          {error && (
            <p role="alert" className="mb-3 rounded-lg bg-delayed-weak px-3 py-2 text-sm text-delayed">{error}</p>
          )}
          <div className="panel-soft flex flex-col gap-4 p-5">
            <p className="text-sm leading-6 text-ink">
              현재 전역 팀을 상속 중입니다. 이 프로젝트만의 팀을 정의하면 상속이 끊깁니다.
            </p>
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={() => setConfirming({ type: 'copy' })} className="btn btn-primary" disabled={pending}>
                <Copy className="h-4 w-4" />전역 팀 복사로 시작
              </button>
              <button type="button" onClick={() => setShowAddInput(true)} className="btn btn-ghost" disabled={pending || showAddInput}>
                <Plus className="h-4 w-4" />빈 목록에서 시작
              </button>
            </div>
            {showAddInput && (
              <div className="flex items-center gap-2 border-t border-line pt-4">
                <input
                  value={newCode}
                  onChange={e => setNewCode(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') submitAdd() }}
                  placeholder="새 팀 이름"
                  maxLength={20}
                  className="app-input w-40"
                  disabled={pending}
                  autoFocus
                />
                <button onClick={submitAdd} className="btn btn-primary" disabled={pending}>
                  <Plus className="h-4 w-4" />팀 추가
                </button>
                <button type="button" onClick={() => { setShowAddInput(false); setNewCode(''); setError(null) }} className="btn btn-ghost" disabled={pending}>
                  취소
                </button>
              </div>
            )}
          </div>
          <p className="mt-4 text-xs leading-5 text-ink-subtle">
            이 팀 목록은 이 프로젝트의 WBS 담당·명단·칸반·보고서에만 적용됩니다. 회의록 보관함은 전역 팀 기준을 유지합니다.
          </p>
        </div>
        {warningModal}
      </section>
    )
  }

  return (
    <section className="card overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-4 sm:px-6">
        <div>
          <h2 className="text-base font-semibold text-ink">팀 목록</h2>
          <p className="text-sm text-ink-muted">
            이 프로젝트의 WBS 담당·명단·칸반·보고서가 이 목록을 씁니다. 비활성화하면 화면에서 숨겨지고
            기존 데이터는 보존됩니다.
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
                        onClick={() => run(() => updateProjectTeam(projectId, t.id, { progressVisible: !t.progressVisible }))}
                        className="btn btn-ghost btn-sm" disabled={pending}
                        title={t.progressVisible ? '팀별 진척현황에서 숨기기' : '팀별 진척현황에 표시'}>
                        {t.progressVisible ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                        진척
                      </button>
                      <button
                        onClick={() => run(() => updateProjectTeam(projectId, t.id, { active: !t.active }))}
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
        <p className="mt-3 text-xs leading-5 text-ink-subtle">
          이 팀 목록은 이 프로젝트의 WBS 담당·명단·칸반·보고서에만 적용됩니다. 회의록 보관함은 전역 팀 기준을 유지합니다.
        </p>
      </div>
    </section>
  )
}
