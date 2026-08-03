'use client'

import { useId, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Check, Copy, Send, ShieldAlert } from 'lucide-react'
import { Modal } from '@/components/ui/Modal'
import { useToast } from '@/components/ui/Toast'
import { useTeamCodes } from '@/components/app/TeamsProvider'
import {
  createProjectInvite, revokeProjectInvite, type InviteRow,
} from '@/app/actions/projectInvites'
import { DEFAULT_INVITE_DAYS, MAX_INVITE_DAYS, inviteStatusLabel, type InviteStatus } from '@/lib/domain/invites'
import type { TeamCode } from '@/lib/domain/types'

const STATUS_CLASS: Record<InviteStatus, string> = {
  active: 'bg-done-weak text-done',
  redeemed: 'bg-brand-weak text-brand',
  revoked: 'bg-surface-2 text-ink-muted',
  expired: 'bg-pending-weak text-pending',
}

/** 복사 성공 아이콘 유지 시간 — 눈으로 알아볼 최소치. */
const COPIED_MS = 1500

/**
 * 취소 버튼을 노출할 상태.
 *
 * 만료 행에도 필요하다 — 부분 유니크는 만료 여부를 보지 않으므로 만료된 초대가 남아 있으면
 * 같은 주소로 다시 보낼 수 없다(actions 의 ERR_DUP_EXPIRED 가 "목록에서 취소한 뒤"라고
 * 안내한다). 여기서 만료를 빼면 그 안내가 가리키는 버튼이 화면에 없는 막다른 길이 된다.
 */
function canRevoke(s: InviteStatus): boolean {
  return s === 'active' || s === 'expired'
}

function fmtDateTime(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return new Intl.DateTimeFormat('ko-KR', {
    timeZone: 'Asia/Seoul', dateStyle: 'short', timeStyle: 'short',
  }).format(d)
}

/**
 * 프로젝트 초대 발급·취소.
 *
 * 링크는 서버가 조립해 내려준 url 을 그대로 쓴다 — 여기서 window.location.origin 을 읽으면
 * 서버 프리렌더에서 죽고, 메일에 실린 링크와 화면의 링크가 갈릴 수도 있다.
 * 목록 조회가 실패했으면 loadError 로 받아 그 사실을 드러낸다: '초대 0건'으로 보이면
 * 관리자가 같은 주소로 다시 발급하다 중복 제약에 이유 없이 막힌다.
 */
export function ProjectInviteManager({ projectId, rows, loadError }: {
  projectId: string
  rows: InviteRow[]
  loadError: string | null
}) {
  const router = useRouter()
  const { toast } = useToast()
  const teamOptions = useTeamCodes()
  const teamHintId = useId()
  const [email, setEmail] = useState('')
  const [teamCode, setTeamCode] = useState<TeamCode>(teamOptions[0] ?? 'PMO')
  const [days, setDays] = useState(String(DEFAULT_INVITE_DAYS))
  const [formError, setFormError] = useState<string | null>(null)
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({})
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [revoking, setRevoking] = useState<InviteRow | null>(null)
  const [pending, startTransition] = useTransition()
  const [revokePending, startRevoke] = useTransition()

  function submit(e: React.FormEvent) {
    e.preventDefault()
    setFormError(null)
    startTransition(async () => {
      try {
        // days 는 폼 문자열이라 빈 값·소수를 그대로 넘긴다 — 판정은 서버 한 곳에서만 한다.
        const res = await createProjectInvite(projectId, { email, teamCode, days: Number(days) })
        if (!res.ok) { setFormError(res.error); return }
        toast(res.mailed
          ? {
              title: '초대 메일을 보냈습니다.',
              description: res.alreadyAccount
                ? `${res.row.email} · 이미 계정이 있는 주소라 로그인 후 합류하게 됩니다.`
                : res.row.email,
              variant: 'success',
            }
          : {
              title: '초대는 만들었지만 메일 발송에 실패했습니다. 링크를 복사해 전달해 주세요.',
              description: res.mailError,
              variant: 'info',
            })
        setEmail('')
        router.refresh()
      } catch {
        setFormError('요청 처리 중 오류가 발생했습니다. 잠시 후 다시 시도하세요.')
      }
    })
  }

  async function copyLink(row: InviteRow) {
    if (!row.url) return
    try {
      await navigator.clipboard.writeText(row.url)
      setCopiedId(row.id)
      setTimeout(() => setCopiedId(id => (id === row.id ? null : id)), COPIED_MS)
    } catch {
      setRowErrors(prev => ({ ...prev, [row.id]: '링크를 복사하지 못했습니다. 브라우저 권한을 확인해 주세요.' }))
    }
  }

  function confirmRevoke() {
    const target = revoking
    if (!target) return
    setRowErrors(prev => ({ ...prev, [target.id]: '' }))
    startRevoke(async () => {
      try {
        const res = await revokeProjectInvite(projectId, target.id)
        // 성공이든 실패든 모달은 닫는다 — 실패 사유는 그 행 아래에 남겨야 보인다.
        setRevoking(null)
        if (!res.ok) { setRowErrors(prev => ({ ...prev, [target.id]: res.error })); return }
        toast({ title: '초대를 취소했습니다.', variant: 'success' })
        router.refresh()
      } catch {
        setRevoking(null)
        setRowErrors(prev => ({ ...prev, [target.id]: '요청 처리 중 오류가 발생했습니다. 잠시 후 다시 시도하세요.' }))
      }
    })
  }

  return (
    <div className="space-y-4">
      <h4 className="text-sm font-semibold text-ink">초대 링크</h4>

      <div className="flex items-start gap-2.5 rounded-xl border border-line bg-pending-weak px-3.5 py-3">
        <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-pending" />
        <p className="text-xs leading-5 text-ink">
          합류한 사람은 이 프로젝트뿐 아니라 D-CUBE 전체의 회의록·WBS·이슈·근태를 조회할 수 있습니다. 사내 인원에게만 발급하세요.
        </p>
      </div>

      <form onSubmit={submit} className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto_auto_auto] sm:items-end">
        <label className="block">
          <span className="mb-1.5 block text-xs font-semibold text-ink-muted">이메일</span>
          <input
            type="email"
            className="app-input"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="name@dongkuk.com"
            autoComplete="off"
            required
          />
        </label>
        <label className="block">
          <span className="mb-1.5 block text-xs font-semibold text-ink-muted">팀</span>
          <select
            className="app-input sm:w-32"
            value={teamCode}
            onChange={(e) => setTeamCode(e.target.value as TeamCode)}
            aria-describedby={teamHintId}
          >
            {teamOptions.map(code => <option key={code} value={code}>{code}</option>)}
          </select>
        </label>
        <label className="block">
          <span className="mb-1.5 block text-xs font-semibold text-ink-muted">유효기간(일)</span>
          <input
            type="number"
            className="app-input sm:w-24"
            value={days}
            min={1}
            max={MAX_INVITE_DAYS}
            onChange={(e) => setDays(e.target.value)}
          />
        </label>
        <button type="submit" className="btn btn-primary" disabled={pending}>
          <Send className="h-4 w-4" />{pending ? '보내는 중…' : '초대 보내기'}
        </button>
        {/* 힌트는 select 아래가 아니라 폼 전체 폭의 한 줄로 둔다 — items-end 그리드에서
            한 칸만 높아지면 입력들의 밑선이 어긋난다. 연결은 aria-describedby 가 한다. */}
        <p id={teamHintId} className="text-xs leading-5 text-ink-subtle sm:col-span-4">
          선택한 팀은 <strong className="font-semibold text-ink-muted">새로 가입하는 계정에만</strong> 적용됩니다.
          이미 계정이 있는 사람이 합류하면 기존 소속이 그대로 유지됩니다.
        </p>
      </form>
      {formError && <p role="alert" className="text-sm font-medium text-delayed">{formError}</p>}

      {loadError ? (
        <p role="alert" className="text-sm font-medium text-delayed">{loadError}</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-ink-subtle">발급한 초대가 없습니다.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm">
            <thead>
              <tr className="border-b border-line text-left text-xs font-semibold uppercase tracking-wide text-ink-subtle">
                <th className="py-2 pr-3">이메일</th>
                <th className="py-2 pr-3">팀</th>
                <th className="py-2 pr-3">상태</th>
                <th className="py-2 pr-3">만료</th>
                <th className="py-2 pr-3">합류</th>
                <th className="py-2 pr-3" />
              </tr>
            </thead>
            <tbody>
              {rows.map(row => (
                <tr key={row.id} className="border-b border-line/60 align-top">
                  <td className="py-2.5 pr-3 font-medium text-ink">{row.email}</td>
                  <td className="py-2.5 pr-3">
                    {row.teamCode
                      ? <span className="chip bg-surface-2 text-ink-muted">{row.teamCode}</span>
                      : <span className="text-ink-subtle">—</span>}
                  </td>
                  <td className="py-2.5 pr-3">
                    <span className={`badge ${STATUS_CLASS[row.status]}`}>{inviteStatusLabel(row.status)}</span>
                  </td>
                  <td className="py-2.5 pr-3 tabular-nums text-ink-muted">{fmtDateTime(row.expiresAt)}</td>
                  <td className="py-2.5 pr-3 tabular-nums text-ink-muted">
                    {row.redeemedAt ? fmtDateTime(row.redeemedAt) : <span className="text-ink-subtle">—</span>}
                  </td>
                  <td className="py-2.5 pr-3">
                    {canRevoke(row.status) && (
                      <div className="flex flex-wrap items-center gap-2">
                        {/* url 은 서버가 active 행에만 채운다 — 만료 행에는 복사할 링크 자체가 없다. */}
                        {row.url ? (
                          <button
                            type="button"
                            className="btn btn-ghost h-8 px-3 text-xs"
                            onClick={() => void copyLink(row)}
                          >
                            {copiedId === row.id ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                            {copiedId === row.id ? '복사됨' : '링크 복사'}
                          </button>
                        ) : row.status === 'active' ? (
                          // active 인데 url 이 없다는 건 NEXT_PUBLIC_APP_URL 이 비었다는 뜻이다. 추측
                          // origin 으로 링크를 만들어 주느니 만들 수 없다고 말한다(잘못된 링크는 회수되지 않는다).
                          <span className="text-xs text-ink-subtle">앱 주소 미설정</span>
                        ) : null}
                        <button
                          type="button"
                          className="btn btn-ghost h-8 px-3 text-xs text-delayed"
                          onClick={() => { setRowErrors(prev => ({ ...prev, [row.id]: '' })); setRevoking(row) }}
                        >
                          취소
                        </button>
                      </div>
                    )}
                    {rowErrors[row.id] ? (
                      <p role="alert" className="mt-1 text-xs font-medium text-delayed">{rowErrors[row.id]}</p>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Modal
        open={!!revoking}
        onClose={() => { if (!revokePending) setRevoking(null) }}
        eyebrow="Invite"
        title="초대 취소"
        size="sm"
        footer={
          <>
            <button type="button" className="btn btn-ghost" disabled={revokePending} onClick={() => setRevoking(null)}>
              닫기
            </button>
            <button type="button" className="btn btn-primary" disabled={revokePending} onClick={confirmRevoke}>
              {revokePending ? '취소 중…' : '초대 취소'}
            </button>
          </>
        }
      >
        <p className="text-sm text-ink-muted">
          이 초대를 취소할까요? 이미 합류한 사람은 영향받지 않습니다.
        </p>
        {/* 만료 행에서 '취소'는 무의미해 보인다 — 왜 눌러야 하는지 그 자리에서 말해 준다. */}
        {revoking?.status === 'expired' && (
          <p className="mt-2 text-sm text-ink-muted">
            만료된 초대가 남아 있는 동안에는 같은 주소로 다시 보낼 수 없습니다. 취소하면 재발급할 수 있습니다.
          </p>
        )}
        {revoking && <p className="mt-2 text-sm font-semibold text-ink">{revoking.email}</p>}
      </Modal>
    </div>
  )
}
