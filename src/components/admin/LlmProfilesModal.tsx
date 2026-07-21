'use client'

import { useEffect, useRef, useState, useTransition } from 'react'
import { Eye, EyeOff, KeyRound, Pencil, PlugZap, Plus, Server, Trash2 } from 'lucide-react'
import { Modal } from '@/components/ui/Modal'
import {
  createLlmProfile, deleteLlmProfile, listLlmProfiles, testLlmConnection, updateLlmProfile,
  type LlmProfileInput, type LlmProfileMasked,
} from '@/app/actions/llmConfig'

type Provider = 'gemini' | 'openai'

export interface LlmPreset {
  id: string
  label: string
  provider: Provider
  /** 프리셋이 자동으로 채우는 base_url. 빈값 = 제공자 기본 엔드포인트(서버가 해석) */
  baseUrl: string
  tokenHint: string
}

/**
 * 프로필 생성 폼의 서비스 템플릿(스펙 §2).
 * provider 는 D'Flow 의 2종뿐이며, OpenAI 호환 서버(Ollama/LM Studio/사내 LLM)는
 * 전부 openai + base_url 조합으로 커버한다.
 */
export const LLM_PRESETS: readonly LlmPreset[] = [
  { id: 'gemini', label: 'Google Gemini', provider: 'gemini', baseUrl: '', tokenHint: 'API 키 필요' },
  { id: 'openai', label: 'OpenAI', provider: 'openai', baseUrl: '', tokenHint: 'API 키 필요' },
  { id: 'ollama', label: 'Ollama', provider: 'openai', baseUrl: 'http://localhost:11434/v1', tokenHint: '키 불필요' },
  { id: 'lmstudio', label: 'LM Studio', provider: 'openai', baseUrl: 'http://localhost:1234/v1', tokenHint: '키 불필요' },
  { id: 'custom', label: '직접 입력 (OpenAI 호환)', provider: 'openai', baseUrl: '', tokenHint: '키 선택' },
]

/** 저장된 preset_id 의 표시 라벨. 미등록 값(수동 삽입 등)은 원문을 그대로 보여준다. */
export function presetLabel(id: string): string {
  return LLM_PRESETS.find((p) => p.id === id)?.label ?? id
}

type View = 'list' | 'form' | 'delete'

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-semibold text-ink-muted">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-[11px] leading-4 text-ink-subtle">{hint}</span>}
    </label>
  )
}

export function LlmProfilesModal({
  open, onClose, profiles, onProfilesChange, startInCreate = false,
}: {
  open: boolean
  onClose: () => void
  profiles: LlmProfileMasked[]
  /** CRUD 후 갱신된 목록 — 부모의 dangling 폴백 트리거를 겸한다. */
  onProfilesChange: (profiles: LlmProfileMasked[]) => void
  /** 열릴 때 곧바로 생성 폼으로 진입('＋ 새 프로필 만들기…' 경로) */
  startInCreate?: boolean
}) {
  const [view, setView] = useState<View>('list')
  const [editing, setEditing] = useState<LlmProfileMasked | null>(null)
  const [target, setTarget] = useState<LlmProfileMasked | null>(null) // 삭제 대상
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  // 에러는 스크롤 컨테이너(max-h-70vh) 안에, 저장 버튼은 그 밖 footer 에 있다.
  // 긴 폼에서 에러가 화면 밖에 렌더되면 '눌렀는데 아무 반응 없음'으로 보이므로 뷰로 끌어온다.
  const errorRef = useRef<HTMLParagraphElement>(null)
  useEffect(() => {
    if (error) errorRef.current?.scrollIntoView({ block: 'nearest' })
  }, [error])

  // 폼 상태
  const [presetId, setPresetId] = useState('gemini')
  const [provider, setProvider] = useState<Provider>('gemini')
  const [name, setName] = useState('')
  const [baseUrl, setBaseUrl] = useState('')
  const [model, setModel] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [showKey, setShowKey] = useState(false)
  const [maxOut, setMaxOut] = useState('')
  const [testResult, setTestResult] = useState<{ ok: boolean; message?: string } | null>(null)

  function resetForm(p: LlmProfileMasked | null) {
    setEditing(p)
    setPresetId(p?.preset_id ?? 'gemini')
    setProvider(p?.provider ?? 'gemini')
    setName(p?.name ?? '')
    setBaseUrl(p?.base_url ?? '')
    setModel(p?.model ?? '')
    setApiKey('') // 기존 키는 되채우지 않는다(마스킹만 안내) — 빈값 = 유지
    setShowKey(false)
    setMaxOut(p?.max_output_tokens != null ? String(p.max_output_tokens) : '')
    setTestResult(null)
    setError(null)
  }

  // 열릴 때마다 초기 상태로 되돌린다(직전 편집 잔상 방지).
  useEffect(() => {
    if (!open) return
    setTarget(null)
    if (startInCreate) { resetForm(null); setView('form') }
    else { setError(null); setView('list') }
    // startInCreate 는 여는 쪽이 정하는 진입 모드라 open 전환에만 반응하면 된다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  /** CRUD 후 목록 재조회 — 실패는 문자열로 돌려 화면에 표시한다(조용한 실패 금지). */
  async function reload(): Promise<string | null> {
    const res = await listLlmProfiles()
    if ('error' in res) return res.error
    onProfilesChange(res.profiles)
    return null
  }

  function applyPreset(p: LlmPreset) {
    // 이름·키 등 이미 입력한 값은 건드리지 않는다 — 프리셋은 provider/base_url 템플릿일 뿐.
    setPresetId(p.id)
    setProvider(p.provider)
    setBaseUrl(p.baseUrl)
    setTestResult(null)
  }

  function buildInput(): LlmProfileInput {
    const input: LlmProfileInput = {
      name: name.trim(),
      preset_id: presetId,
      provider,
      model: model.trim(),
    }
    if (baseUrl.trim()) input.base_url = baseUrl.trim()
    // 키가 빈값이면 필드 자체를 생략 — 서버의 "빈값 = 기존 키 유지" 규칙과 페어다.
    if (apiKey.trim()) input.auth_token = apiKey.trim()
    if (maxOut.trim()) input.max_output_tokens = Number(maxOut)
    return input
  }

  function submitForm() {
    setError(null)
    if (!name.trim()) { setError('프로필 이름을 입력하세요'); return }
    if (!model.trim()) { setError('모델을 입력하세요'); return }
    const input = buildInput()
    startTransition(async () => {
      try {
        const res = editing ? await updateLlmProfile(editing.id, input) : await createLlmProfile(input)
        if ('error' in res) { setError(res.error); return }
        const listError = await reload()
        if (listError) { setError(listError); return }
        setView('list')
      } catch {
        setError('요청 처리 중 오류가 발생했습니다. 잠시 후 다시 시도하세요.')
      }
    })
  }

  function runTest() {
    setError(null)
    setTestResult(null)
    startTransition(async () => {
      try {
        const res = await testLlmConnection({
          provider,
          model: model.trim(),
          base_url: baseUrl.trim() || undefined,
          auth_token: apiKey.trim() || undefined,
          // 키를 비운 채 편집 중이면 저장된 키로 폴백해 테스트한다.
          profile_id: editing?.id,
        })
        setTestResult({ ok: res.success, message: res.error })
      } catch {
        setTestResult({ ok: false, message: '요청 처리 중 오류가 발생했습니다.' })
      }
    })
  }

  function confirmDelete() {
    if (!target) return
    setError(null)
    startTransition(async () => {
      try {
        const res = await deleteLlmProfile(target.id)
        if ('error' in res) { setError(res.error); return }
        const listError = await reload()
        if (listError) { setError(listError); return }
        setTarget(null)
        setView('list')
      } catch {
        setError('요청 처리 중 오류가 발생했습니다. 잠시 후 다시 시도하세요.')
      }
    })
  }

  const title = view === 'delete' ? '프로필 삭제' : view === 'form' ? (editing ? '프로필 편집' : '새 프로필') : 'LLM 프로필 관리'
  const eyebrow = view === 'delete' ? 'Delete profile' : view === 'form' ? 'Profile form' : 'LLM profiles'

  // 삭제 확인은 별도 모달을 겹치지 않고 같은 모달의 뷰로 처리한다
  // (모달 중첩 시 앞 모달의 포커스 트랩이 Tab 을 다시 낚아채므로).
  const footer =
    view === 'delete' ? (
      <>
        <button onClick={() => { setTarget(null); setView('list') }} className="btn btn-ghost" disabled={pending}>취소</button>
        <button
          onClick={confirmDelete}
          disabled={pending}
          className="btn bg-delayed text-white shadow-sm transition hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {pending ? '삭제 중…' : '삭제'}
        </button>
      </>
    ) : view === 'form' ? (
      <>
        <button onClick={() => setView('list')} className="btn btn-ghost" disabled={pending}>목록으로</button>
        <button onClick={submitForm} className="btn btn-primary" disabled={pending}>
          {pending ? '저장 중…' : editing ? '변경 저장' : '프로필 만들기'}
        </button>
      </>
    ) : (
      <button onClick={onClose} className="btn btn-ghost" disabled={pending}>닫기</button>
    )

  return (
    <Modal open={open} onClose={onClose} eyebrow={eyebrow} title={title} size="lg" footer={footer}>
      {view === 'list' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm text-ink-muted">등록된 프로필 {profiles.length}개 — 활성 선택은 이 창을 닫은 뒤 저장해야 적용됩니다.</p>
            <button onClick={() => { resetForm(null); setView('form') }} className="btn btn-primary btn-sm shrink-0" disabled={pending}>
              <Plus className="h-4 w-4" />새 프로필
            </button>
          </div>

          {error && <p ref={errorRef} role="alert" className="text-sm font-medium text-delayed">{error}</p>}

          {profiles.length === 0 ? (
            <div className="panel-soft flex flex-col items-center gap-2 px-6 py-10 text-center">
              <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-brand-weak text-brand"><Server className="h-5 w-5" /></span>
              <p className="text-sm font-semibold text-ink">등록된 프로필이 없습니다</p>
              <p className="text-xs text-ink-muted">Gemini·OpenAI·Ollama 등 접속 정보를 프로필로 저장해 두고 전환할 수 있습니다.</p>
            </div>
          ) : (
            <ul className="divide-y divide-line rounded-2xl border border-line">
              {profiles.map((p) => (
                <li key={p.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="truncate text-sm font-semibold text-ink">{p.name}</span>
                      <span className="chip bg-surface-2 text-ink-muted">{presetLabel(p.preset_id)}</span>
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-muted">
                      <span className="font-mono">{p.model}</span>
                      <span className="inline-flex items-center gap-1">
                        <KeyRound className="h-3 w-3" />
                        {p.has_token ? <code className="font-mono">{p.auth_token_masked}</code> : <span className="text-ink-subtle">키 없음</span>}
                      </span>
                      {p.base_url && <span className="truncate font-mono text-ink-subtle">{p.base_url}</span>}
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5">
                    <button onClick={() => { resetForm(p); setView('form') }} className="btn btn-ghost btn-sm" disabled={pending}>
                      <Pencil className="h-3.5 w-3.5" />편집
                    </button>
                    <button
                      onClick={() => { setTarget(p); setError(null); setView('delete') }}
                      className="btn btn-ghost btn-sm text-delayed"
                      disabled={pending}
                    >
                      <Trash2 className="h-3.5 w-3.5" />삭제
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {view === 'delete' && (
        <div className="space-y-3">
          <p className="text-sm leading-6 text-ink-muted">
            <b className="text-ink">&apos;{target?.name}&apos;</b> 프로필을 삭제할까요? 이 프로필을 쓰는 설정은 해제됩니다.
          </p>
          {error && <p ref={errorRef} role="alert" className="text-sm font-medium text-delayed">{error}</p>}
        </div>
      )}

      {view === 'form' && (
        <div className="space-y-4">
          <div>
            <span className="mb-1.5 block text-xs font-semibold text-ink-muted">프리셋</span>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {LLM_PRESETS.map((p) => {
                const active = p.id === presetId
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => applyPreset(p)}
                    aria-pressed={active}
                    className={`rounded-xl border px-3 py-2.5 text-left transition ${
                      active ? 'border-brand bg-brand-weak text-brand' : 'border-line bg-surface text-ink-muted hover:border-line-strong hover:text-ink'
                    }`}
                  >
                    <span className="block text-[13px] font-semibold leading-tight">{p.label}</span>
                    <span className="mt-0.5 block text-[11px] leading-4 opacity-80">{p.tokenHint}</span>
                  </button>
                )
              })}
            </div>
          </div>

          <Field label="이름 (필수)">
            <input className="app-input" value={name} onChange={(e) => setName(e.target.value)} placeholder="예) 사내 Gemini" />
          </Field>

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="모델 (필수)">
              <input className="app-input font-mono" value={model} onChange={(e) => setModel(e.target.value)} placeholder="gemini-2.5-flash" />
            </Field>
            <Field label="Base URL (선택)" hint="비우면 제공자 기본 엔드포인트를 사용합니다.">
              <input className="app-input font-mono" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="http://localhost:11434/v1" />
            </Field>
          </div>

          <Field
            label="API 키"
            hint={editing?.has_token ? `현재: ${editing.auth_token_masked} — 비워두면 기존 키 유지` : '키가 필요 없는 서버(Ollama·LM Studio)는 비워 두세요.'}
          >
            <div className="relative">
              <input
                className="app-input pr-11 font-mono"
                type={showKey ? 'text' : 'password'}
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder={editing?.has_token ? (editing.auth_token_masked ?? '') : 'sk-…'}
                autoComplete="off"
              />
              <button
                type="button"
                onClick={() => setShowKey((v) => !v)}
                aria-label={showKey ? 'API 키 숨기기' : 'API 키 표시'}
                className="absolute inset-y-0 right-0 flex w-11 items-center justify-center text-ink-subtle transition hover:text-ink"
              >
                {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </Field>

          {/* 최대 입력 토큰은 런타임이 읽는 곳이 없어(프롬프트 크기 제어 미구현) 노출하지 않는다 —
              저장은 되는데 아무 효과가 없는 설정을 관리자에게 보여주지 않기 위함. 컬럼은 유지. */}
          <Field label="최대 출력 토큰 (선택)" hint="비우면 모델 기본값(Gemini 4096)을 사용합니다.">
            <input className="app-input" type="number" min={0} value={maxOut} onChange={(e) => setMaxOut(e.target.value)} placeholder="미지정" />
          </Field>

          <div className="flex flex-wrap items-center gap-3">
            <button type="button" onClick={runTest} className="btn btn-ghost" disabled={pending || !model.trim()}>
              <PlugZap className="h-4 w-4" />연결 테스트
            </button>
            {testResult && (
              <p role="status" className={`min-w-0 flex-1 text-xs leading-5 ${testResult.ok ? 'text-done' : 'text-delayed'}`}>
                {testResult.ok ? '연결에 성공했습니다.' : `연결 실패 — ${testResult.message ?? '알 수 없는 오류'}`}
              </p>
            )}
          </div>

          {error && <p ref={errorRef} role="alert" className="text-sm font-medium text-delayed">{error}</p>}
        </div>
      )}
    </Modal>
  )
}
