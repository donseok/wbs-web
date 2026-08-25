'use client'

import { useCallback, useEffect, useState } from 'react'
import { Check, Copy, KeyRound, Trash2 } from 'lucide-react'
import { Modal } from '@/components/ui/Modal'
import { EmptyState } from '@/components/ui/EmptyState'
import { useToast } from '@/components/ui/Toast'
import { useLocale } from '@/components/providers/LocaleProvider'
import type { DictKey } from '@/lib/i18n/dict'
import {
  createAgentToken, listMyAgentTokens, revokeAgentToken,
} from '@/app/actions/agentTokens'

type TokenRow = {
  id: string; name: string; token_prefix: string; scopes: string[]
  project_id: string | null; expires_at: string; revoked_at: string | null; last_seen_at: string | null
}

// 스코프 설명(스테이징 실사용 피드백 2026-08-11) — 52명+ 로스터에서 claim 스코프가 조회를
// 포함한다는 사실이 체크박스 라벨만으론 드러나지 않아 오발급 문의가 있었다.
// work:report 는 **폐지됐다**(2026-08-25) — claim 할 수 있으면 그 결과도 적을 수 있어야 하고,
// claim 이 무제한인 이상 보고만 따로 막는 건 실질 방어선이 아니었다. 신규 발급에는 붙이지 않는다
// (옛 토큰에 남은 work:report 는 서버가 work:claim 과 동등하게 받아준다 — externalApi 참조).
const SCOPE_OPTIONS: readonly { value: string; label: string; descKey: DictKey }[] = [
  { value: 'work:read', label: '조회 (work:read)', descKey: 'account.scope.workRead.desc' },
  { value: 'work:claim', label: 'claim/release/완료보고 (work:claim)', descKey: 'account.scope.workClaim.desc' },
] as const

const EXPIRES_OPTIONS = [30, 90, 180] as const

/** PAT 발급·목록·폐기(결정 D). 평문은 발급 직후 1회만 표시. */
export function MyTokensSection({ projects }: { projects: { id: string; name: string }[] }) {
  const { toast } = useToast()
  const { t } = useLocale()
  const [tokens, setTokens] = useState<TokenRow[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)

  const [name, setName] = useState('')
  const [projectId, setProjectId] = useState('')
  const [scopes, setScopes] = useState<string[]>(['work:read'])
  const [expiresDays, setExpiresDays] = useState<number>(90)
  const [issuing, setIssuing] = useState(false)
  const [issueError, setIssueError] = useState<string | null>(null)
  const [issued, setIssued] = useState<{ token: string; prefix: string } | null>(null)
  const [copied, setCopied] = useState(false)

  const [revoking, setRevoking] = useState<TokenRow | null>(null)
  const [revokeBusy, setRevokeBusy] = useState(false)

  const reload = useCallback(async () => {
    setLoading(true)
    const r = await listMyAgentTokens()
    if (!r.ok) { setLoadError(r.error); setLoading(false); return }
    setLoadError(null)
    setTokens(r.tokens as TokenRow[])
    setLoading(false)
  }, [])
  useEffect(() => { void reload() }, [reload])

  function toggleScope(value: string) {
    setScopes((prev) => prev.includes(value) ? prev.filter((s) => s !== value) : [...prev, value])
  }

  async function submitIssue() {
    setIssueError(null)
    const trimmed = name.trim()
    if (!trimmed) { setIssueError('이름을 입력하세요.'); return }
    if (scopes.length === 0) { setIssueError('스코프를 1개 이상 선택하세요.'); return }
    setIssuing(true)
    try {
      const r = await createAgentToken({
        name: trimmed, projectId: projectId || null, scopes, expiresDays,
      })
      if (!r.ok) { setIssueError(r.error); return }
      setIssued({ token: r.token, prefix: r.prefix })
      setCopied(false)
      setName('')
      setProjectId('')
      setScopes(['work:read'])
      setExpiresDays(90)
      await reload()
    } catch {
      setIssueError('요청 처리 중 오류가 발생했습니다. 잠시 후 다시 시도하세요.')
    } finally {
      setIssuing(false)
    }
  }

  async function copyIssued() {
    if (!issued) return
    try { await navigator.clipboard.writeText(issued.token); setCopied(true) } catch { /* 클립보드 미지원 시 무시 */ }
  }

  async function confirmRevoke() {
    if (!revoking) return
    setRevokeBusy(true)
    try {
      const r = await revokeAgentToken(revoking.id)
      if (!r.ok) { toast({ title: r.error ?? '폐기 실패', variant: 'error' }); return }
      toast({ title: '토큰을 폐기했습니다.', variant: 'success' })
      setRevoking(null)
      await reload()
    } finally {
      setRevokeBusy(false)
    }
  }

  const projectName = (id: string | null) => id ? (projects.find((p) => p.id === id)?.name ?? id) : '전체'

  return (
    <div className="card overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-4 sm:px-6">
        <div>
          <div className="eyebrow">Agent access</div>
          <h2 className="mt-0.5 text-sm font-semibold text-ink">개인 액세스 토큰(PAT)</h2>
        </div>
      </div>

      <div className="grid gap-6 p-5 sm:p-6 lg:grid-cols-[1.1fr_1fr]">
        <div className="min-w-0">
          {loadError && <p role="alert" className="mb-3 text-sm font-medium text-delayed">토큰 목록을 불러오지 못했습니다: {loadError}</p>}
          {loading ? (
            <p className="text-sm text-ink-subtle">불러오는 중…</p>
          ) : tokens.length === 0 ? (
            <EmptyState icon={KeyRound} title="발급된 토큰이 없습니다" description="오른쪽 폼으로 새 토큰을 발급하세요." />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[560px] text-sm">
                <thead>
                  <tr className="border-b border-line text-left text-xs font-semibold uppercase tracking-wide text-ink-subtle">
                    <th className="py-2 pr-3">이름</th>
                    <th className="py-2 pr-3">prefix</th>
                    <th className="py-2 pr-3">스코프</th>
                    <th className="py-2 pr-3">프로젝트</th>
                    <th className="py-2 pr-3">만료</th>
                    <th className="py-2 pr-3">최근 사용</th>
                    <th className="py-2 pr-3 text-right">작업</th>
                  </tr>
                </thead>
                <tbody>
                  {tokens.map((tk) => {
                    const isRevoked = !!tk.revoked_at
                    const isExpired = Date.parse(tk.expires_at) <= Date.now()
                    return (
                      <tr key={tk.id} className="border-b border-line/60">
                        <td className="py-2.5 pr-3 font-medium text-ink">{tk.name}</td>
                        <td className="py-2.5 pr-3 font-mono text-xs text-ink-muted">{tk.token_prefix}</td>
                        <td className="py-2.5 pr-3 text-ink-muted">{tk.scopes.join(', ')}</td>
                        <td className="py-2.5 pr-3 text-ink-muted">{projectName(tk.project_id)}</td>
                        <td className="py-2.5 pr-3 text-ink-subtle">{tk.expires_at.slice(0, 10)}</td>
                        <td className="py-2.5 pr-3 text-ink-subtle">{tk.last_seen_at ? tk.last_seen_at.slice(0, 10) : '—'}</td>
                        <td className="py-2.5 pr-3 text-right">
                          {isRevoked ? (
                            <span className="chip bg-surface-2 text-ink-subtle">폐기됨</span>
                          ) : isExpired ? (
                            <span className="chip bg-surface-2 text-ink-subtle">만료됨</span>
                          ) : (
                            <button onClick={() => setRevoking(tk)} className="btn btn-ghost btn-sm" title="폐기">
                              <Trash2 className="h-3.5 w-3.5" />폐기
                            </button>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="rounded-2xl border border-line bg-surface-2 p-4">
          <h3 className="text-sm font-semibold text-ink">새 토큰 발급</h3>
          <div className="mt-3 space-y-3">
            <label className="block">
              <span className="mb-1.5 block text-xs font-semibold text-ink-muted">이름</span>
              <input className="app-input" value={name} onChange={(e) => setName(e.target.value)} placeholder="예: 노트북" maxLength={64} disabled={issuing} />
            </label>
            <label className="block">
              <span className="mb-1.5 block text-xs font-semibold text-ink-muted">프로젝트</span>
              <select className="app-input" value={projectId} onChange={(e) => setProjectId(e.target.value)} disabled={issuing}>
                <option value="">전체 프로젝트</option>
                {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </label>
            <div>
              <span className="mb-1.5 block text-xs font-semibold text-ink-muted">스코프</span>
              <div className="flex flex-col gap-1.5">
                {SCOPE_OPTIONS.map((opt) => (
                  <label key={opt.value} className="flex items-start gap-2 text-sm text-ink">
                    <input type="checkbox" checked={scopes.includes(opt.value)} onChange={() => toggleScope(opt.value)} disabled={issuing} className="mt-0.5" />
                    <span>
                      {opt.label}
                      <span className="block text-xs text-ink-subtle">{t(opt.descKey)}</span>
                    </span>
                  </label>
                ))}
              </div>
            </div>
            <label className="block">
              <span className="mb-1.5 block text-xs font-semibold text-ink-muted">만료</span>
              <select className="app-input" value={expiresDays} onChange={(e) => setExpiresDays(Number(e.target.value))} disabled={issuing}>
                {EXPIRES_OPTIONS.map((d) => <option key={d} value={d}>{d}일</option>)}
              </select>
            </label>
            {issueError && <p role="alert" className="text-sm font-medium text-delayed">{issueError}</p>}
            <button onClick={submitIssue} className="btn btn-primary w-full" disabled={issuing}>
              {issuing ? '발급 중…' : '토큰 발급'}
            </button>
          </div>

          {issued && (
            <div className="mt-4 rounded-xl border border-line bg-surface px-3.5 py-3">
              <p className="text-xs font-medium text-delayed">이 창을 닫으면 다시 볼 수 없습니다. 지금 복사해 안전한 곳에 보관하세요.</p>
              <div className="mt-2 flex items-center gap-2">
                <code className="min-w-0 flex-1 truncate rounded-lg bg-surface-2 px-2.5 py-1.5 font-mono text-xs text-ink">{issued.token}</code>
                <button type="button" onClick={copyIssued} className="btn btn-ghost btn-sm shrink-0">
                  {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}{copied ? '복사됨' : '복사'}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      <Modal
        open={!!revoking} onClose={() => setRevoking(null)} eyebrow="Revoke token" title="토큰 폐기"
        footer={
          <>
            <button onClick={() => setRevoking(null)} className="btn btn-ghost" disabled={revokeBusy}>취소</button>
            <button onClick={confirmRevoke} className="btn btn-primary" disabled={revokeBusy}>{revokeBusy ? '폐기 중…' : '폐기'}</button>
          </>
        }
      >
        <p className="text-sm text-ink-muted">
          <b className="text-ink">{revoking?.name}</b> 토큰을 폐기합니다. 이 토큰을 사용하는 에이전트는 즉시 인증에 실패합니다. 되돌릴 수 없습니다.
        </p>
      </Modal>
    </div>
  )
}
