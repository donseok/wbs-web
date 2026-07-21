'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { PlugZap, Save, Settings2 } from 'lucide-react'
import { useToast } from '@/components/ui/Toast'
import { LlmProfilesModal } from '@/components/admin/LlmProfilesModal'
import {
  saveLlmConfig, testLlmConnection,
  type LlmMode, type LlmProfileMasked,
} from '@/app/actions/llmConfig'

export interface LlmConfigInitial {
  mode: LlmMode
  active_profile_id: number | null
  profiles: LlmProfileMasked[]
}

const NEW_PROFILE = '__new__' // 드롭다운 마지막 항목 — 값이 아니라 "생성 폼 열기" 트리거

const MODES: { value: LlmMode; label: string; desc: string }[] = [
  { value: 'env', label: '환경변수 기본값', desc: '배포 env 설정(AI_PROVIDER 등)을 그대로 사용합니다.' },
  { value: 'profile', label: '프로필 선택', desc: '등록해 둔 프로필 하나를 서버 전역 LLM 으로 사용합니다.' },
  { value: 'none', label: '선택 안함', desc: 'LLM 기능(요약·브리프·답변 등)을 실행하지 않습니다.' },
]

export function LlmConfigManager({ initial }: { initial: LlmConfigInitial }) {
  const router = useRouter()
  const { toast } = useToast()

  const [mode, setMode] = useState<LlmMode>(initial.mode)
  const [activeId, setActiveId] = useState<number | null>(initial.active_profile_id)
  const [profiles, setProfiles] = useState<LlmProfileMasked[]>(initial.profiles)
  const [modalOpen, setModalOpen] = useState(false)
  const [modalCreate, setModalCreate] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [testResult, setTestResult] = useState<{ ok: boolean; message?: string } | null>(null)
  const [pending, startTransition] = useTransition()

  const selected = profiles.find((p) => p.id === activeId) ?? null

  /**
   * 모달의 CRUD 결과 반영 + dangling 폴백.
   * 선택 중이던 프로필이 삭제됐는데 그대로 두면 저장이 '유효하지 않은 프로필입니다'로 반려되므로,
   * 서버의 on delete set null 과 같은 방향(env)으로 화면 선택을 되돌린다.
   */
  function handleProfilesChange(next: LlmProfileMasked[]) {
    setProfiles(next)
    setTestResult(null)
    if (activeId !== null && !next.some((p) => p.id === activeId)) {
      setActiveId(null)
      setMode((prev) => (prev === 'profile' ? 'env' : prev))
    }
  }

  function openModal(create: boolean) {
    setModalCreate(create)
    setModalOpen(true)
  }

  function onSelectProfile(value: string) {
    if (value === NEW_PROFILE) { openModal(true); return } // 선택값은 그대로 두고 생성 폼만 연다
    setTestResult(null)
    setActiveId(value ? Number(value) : null)
  }

  function runTest() {
    if (!selected) { setError('테스트할 프로필을 선택하세요'); return }
    setError(null)
    setTestResult(null)
    startTransition(async () => {
      try {
        const res = await testLlmConnection({
          provider: selected.provider,
          model: selected.model,
          base_url: selected.base_url ?? undefined,
          profile_id: selected.id, // 저장된 키를 서버에서 폴백 조회(키는 화면에 없다)
        })
        setTestResult({ ok: res.success, message: res.error })
      } catch {
        setTestResult({ ok: false, message: '요청 처리 중 오류가 발생했습니다.' })
      }
    })
  }

  function save() {
    setError(null)
    if (mode === 'profile' && activeId === null) { setError('사용할 프로필을 선택하세요'); return }
    startTransition(async () => {
      try {
        const res = await saveLlmConfig({ mode, active_profile_id: mode === 'profile' ? activeId : null })
        if ('error' in res) { setError(res.error); return }
        // 저장은 됐는데 런타임 캐시 갱신이 실패한 경우까지 '성공'으로 뭉뚱그리면,
        // 관리자가 '선택 안함'을 저장하고도 최대 1분간 LLM 이 도는 것을 모른 채 넘어간다.
        toast(
          res.warning
            ? { title: 'LLM 설정을 저장했습니다.', description: res.warning, variant: 'info' }
            : { title: 'LLM 설정을 저장했습니다.', description: MODES.find((m) => m.value === mode)?.label, variant: 'success' },
        )
        router.refresh()
      } catch {
        setError('요청 처리 중 오류가 발생했습니다. 잠시 후 다시 시도하세요.')
      }
    })
  }

  return (
    <div className="card overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-4 sm:px-6">
        <div>
          <div className="eyebrow">Active LLM</div>
          <h2 className="mt-0.5 text-sm font-semibold text-ink">서버 전역 LLM · 프로필 {profiles.length}개</h2>
        </div>
        <button onClick={() => openModal(false)} className="btn btn-ghost" disabled={pending}>
          <Settings2 className="h-4 w-4" />프로필 관리
        </button>
      </div>

      <div className="space-y-5 p-5 sm:p-6">
        <fieldset className="space-y-2.5">
          <legend className="mb-2 text-xs font-semibold text-ink-muted">활성 LLM</legend>
          {MODES.map((m) => {
            const active = mode === m.value
            return (
              <div key={m.value}>
                <label
                  className={`flex cursor-pointer items-start gap-3 rounded-2xl border px-4 py-3 transition ${
                    active ? 'border-brand bg-brand-weak' : 'border-line bg-surface hover:border-line-strong'
                  }`}
                >
                  <input
                    type="radio"
                    name="llm-mode"
                    className="mt-1 h-4 w-4 shrink-0 accent-[var(--color-brand)]"
                    value={m.value}
                    checked={active}
                    onChange={() => { setMode(m.value); setTestResult(null); setError(null) }}
                    disabled={pending}
                  />
                  <span className="min-w-0">
                    <span className={`block text-sm font-semibold ${active ? 'text-brand' : 'text-ink'}`}>{m.label}</span>
                    <span className="mt-0.5 block text-xs leading-5 text-ink-muted">{m.desc}</span>
                  </span>
                </label>

                {m.value === 'profile' && (
                  <div className="mt-2 pl-4">
                    <label className="block">
                      <span className="mb-1.5 block text-xs font-semibold text-ink-muted">사용할 프로필</span>
                      <select
                        className="app-input"
                        value={activeId !== null ? String(activeId) : ''}
                        onChange={(e) => onSelectProfile(e.target.value)}
                        disabled={pending || mode !== 'profile'}
                        aria-label="사용할 LLM 프로필"
                      >
                        <option value="">프로필을 선택하세요</option>
                        {profiles.map((p) => (
                          <option key={p.id} value={String(p.id)}>{p.name} — {p.model}</option>
                        ))}
                        <option value={NEW_PROFILE}>＋ 새 프로필 만들기…</option>
                      </select>
                    </label>
                    {mode === 'profile' && selected && (
                      <p className="mt-1.5 text-[11px] leading-4 text-ink-subtle">
                        {selected.provider} · {selected.base_url || '기본 엔드포인트'} · {selected.has_token ? `키 ${selected.auth_token_masked}` : '키 없음'}
                      </p>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </fieldset>

        {error && <p role="alert" className="text-sm font-medium text-delayed">{error}</p>}
        {testResult && (
          <p role="status" className={`text-sm leading-6 ${testResult.ok ? 'text-done' : 'text-delayed'}`}>
            {testResult.ok ? '연결에 성공했습니다.' : `연결 실패 — ${testResult.message ?? '알 수 없는 오류'}`}
          </p>
        )}

        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-line pt-4">
          {/* env 모드는 서버의 env 값으로만 판별되므로 화면에서 보낼 값이 없다 — 버튼을 숨긴다. */}
          {mode !== 'env' && (
            <button onClick={runTest} className="btn btn-ghost" disabled={pending || mode === 'none'}>
              <PlugZap className="h-4 w-4" />연결 테스트
            </button>
          )}
          <button onClick={save} className="btn btn-primary" disabled={pending}>
            <Save className="h-4 w-4" />{pending ? '저장 중…' : '저장'}
          </button>
        </div>
      </div>

      <LlmProfilesModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        profiles={profiles}
        onProfilesChange={handleProfilesChange}
        startInCreate={modalCreate}
      />
    </div>
  )
}
