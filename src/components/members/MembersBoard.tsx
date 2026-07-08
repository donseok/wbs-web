'use client'

import { useEffect, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { UserPlus, Pencil, Trash2, Mail, ShieldCheck, UserRound, AlertTriangle, Users, Unlink } from 'lucide-react'
import { Modal } from '@/components/ui/Modal'
import { useLocale } from '@/components/providers/LocaleProvider'
import { EmptyState } from '@/components/ui/EmptyState'
import { TEAM } from '@/components/wbs/shared'
import { addMember, updateMember, removeMember } from '@/app/actions/members'
import { isValidEmail } from '@/lib/domain/validate'
import type { ProjectMember, ProjectMemberRole, TeamCode } from '@/lib/domain/types'

const TEAM_META: Record<TeamCode, { chip: string; avatar: string }> = {
  PMO: { chip: 'bg-team-pmo-weak text-team-pmo', avatar: 'from-team-pmo to-brand' },
  가공: { chip: 'bg-team-dt-weak text-team-dt', avatar: 'from-team-dt to-brand' },
  ERP: { chip: 'bg-team-erp-weak text-team-erp', avatar: 'from-team-erp to-accent-secondary' },
  MES: { chip: 'bg-team-mes-weak text-team-mes', avatar: 'from-team-mes to-brand' },
}

const TEAM_OPTIONS: TeamCode[] = ['PMO', 'ERP', 'MES', '가공']

// 아바타 그라디언트 팔레트(디자인 토큰 재사용). 멤버 id 해시로 결정적 배정 —
// 이름·이니셜이 같은(예: '테스트사용자'/'테스트QA' → 둘 다 '테스') 멤버도 색으로 구분된다.
// 소속 팀은 카드 하단 칩으로 별도 표시하므로 팀 정보가 사라지지 않는다.
const AVATAR_GRADIENTS = [
  'from-team-pmo to-brand',
  'from-team-dt to-brand',
  'from-team-erp to-accent-secondary',
  'from-team-mes to-brand',
  'from-brand to-brand-hover',
  'from-accent-secondary to-brand',
]
function avatarGradient(seed: string): string {
  let h = 0
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) | 0
  return AVATAR_GRADIENTS[Math.abs(h) % AVATAR_GRADIENTS.length]
}

function roleMeta(role: ProjectMemberRole) {
  return role === 'admin'
    ? { labelKey: 'members.roleAdmin' as const, chip: 'bg-brand-weak text-brand', Icon: ShieldCheck }
    : { labelKey: 'members.roleContributor' as const, chip: 'bg-progress-weak text-progress', Icon: UserRound }
}

function initials(name: string) {
  const t = name.trim()
  if (!t) return '?'
  const parts = t.split(/\s+/)
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase()
  return t.slice(0, 2).toUpperCase()
}

export function MembersBoard({
  members,
  canEdit,
  projectId,
}: {
  members: ProjectMember[]
  canEdit: boolean
  projectId: string
}) {
  const { t } = useLocale()
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<ProjectMember | null>(null)
  const [deleting, setDeleting] = useState<ProjectMember | null>(null)

  function openAdd() {
    setEditing(null)
    setFormOpen(true)
  }
  function openEdit(member: ProjectMember) {
    setEditing(member)
    setFormOpen(true)
  }

  return (
    <div className="card overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-4 sm:px-6">
        <div>
          <div className="eyebrow">Member board</div>
          <h2 className="mt-0.5 text-sm font-semibold text-ink">{t('members.boardTitle')} · {members.length}{t('members.unitPeople')}</h2>
        </div>
        {canEdit && (
          <button onClick={openAdd} className="btn btn-primary">
            <UserPlus className="h-4 w-4" />
            {t('members.addMember')}
          </button>
        )}
      </div>

      <div className="p-5 sm:p-6">
        {members.length === 0 ? (
          <EmptyState
            icon={Users}
            title={t('members.emptyTitle')}
            description={t('members.emptyDesc')}
            action={
              canEdit ? (
                <button onClick={openAdd} className="btn btn-primary">
                  <UserPlus className="h-4 w-4" />
                  {t('members.addMember')}
                </button>
              ) : undefined
            }
          />
        ) : (
          <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {members.map((member) => (
              <li key={member.id}>
                <MemberCard member={member} canEdit={canEdit} onEdit={() => openEdit(member)} onDelete={() => setDeleting(member)} />
              </li>
            ))}
          </ul>
        )}
      </div>

      <MemberFormModal
        open={formOpen}
        onClose={() => setFormOpen(false)}
        projectId={projectId}
        initial={editing}
      />
      <DeleteMemberModal member={deleting} onClose={() => setDeleting(null)} />
    </div>
  )
}

function MemberCard({
  member,
  canEdit,
  onEdit,
  onDelete,
}: {
  member: ProjectMember
  canEdit: boolean
  onEdit: () => void
  onDelete: () => void
}) {
  const { t } = useLocale()
  const role = roleMeta(member.role)
  const RoleIcon = role.Icon
  const avatar = avatarGradient(member.id)

  return (
    <div className="group flex h-full flex-col gap-4 rounded-2xl border border-line bg-surface p-5 transition duration-200 hover:-translate-y-0.5 hover:border-line-strong hover:shadow-[var(--shadow-md)]">
      <div className="flex items-start gap-3">
        <span
          className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br ${avatar} text-sm font-bold text-white shadow-[var(--shadow-sm)]`}
        >
          {initials(member.name)}
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[15px] font-semibold text-ink" title={member.name}>
            {member.name}
          </div>
          <div className="mt-0.5 truncate text-xs text-ink-muted" title={member.title ?? undefined}>
            {member.title ?? t('members.noTitle')}
          </div>
        </div>
        {canEdit && (
          <div className="flex shrink-0 items-center gap-1">
            <button
              onClick={onEdit}
              aria-label={`${member.name}${t('members.ariaEditSuffix')}`}
              className="flex h-7 w-7 items-center justify-center rounded-lg border border-line text-ink-subtle transition hover:border-line-strong hover:text-ink"
            >
              <Pencil className="h-3.5 w-3.5" />
            </button>
            <button
              onClick={onDelete}
              aria-label={`${member.name}${t('members.ariaDeleteSuffix')}`}
              className="flex h-7 w-7 items-center justify-center rounded-lg border border-line text-ink-subtle transition hover:border-delayed hover:text-delayed"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        <span className={`chip ${role.chip}`}>
          <RoleIcon className="h-3 w-3" />
          {t(role.labelKey)}
        </span>
        {member.teamCode ? (
          <span className={`chip ${TEAM_META[member.teamCode].chip}`}>
            <span className={`h-1.5 w-1.5 rounded-full ${TEAM[member.teamCode].bar}`} />
            {member.teamCode}
          </span>
        ) : (
          <span className="chip bg-surface-2 text-ink-subtle">{t('members.noTeam')}</span>
        )}
        {/* 이메일은 있는데 로그인 계정과 이어지지 않은 행 — 이 사람은 '내 회의'가 빈 화면이다.
            이메일 자체가 없는 행(외부 인력)은 아래 이메일 줄이 이미 '미등록'을 보여준다. */}
        {member.email && !member.userId && (
          <span className="chip bg-pending-weak text-accent-warning" title={t('members.unlinkedHint')}>
            <Unlink className="h-3 w-3" />
            {t('members.unlinked')}
          </span>
        )}
      </div>

      <div className="mt-auto flex items-center gap-1.5 border-t border-line pt-3 text-xs text-ink-subtle">
        <Mail className="h-3.5 w-3.5 shrink-0" />
        <span className="truncate" title={member.email ?? undefined}>
          {member.email ?? t('members.noEmail')}
        </span>
      </div>
    </div>
  )
}

function MemberFormModal({
  open,
  onClose,
  projectId,
  initial,
}: {
  open: boolean
  onClose: () => void
  projectId: string
  initial: ProjectMember | null
}) {
  const router = useRouter()
  const { t } = useLocale()
  const isEdit = !!initial
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [teamCode, setTeamCode] = useState<TeamCode | ''>('')
  const [role, setRole] = useState<ProjectMemberRole>('contributor')
  const [title, setTitle] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  useEffect(() => {
    if (!open) return
    setName(initial?.name ?? '')
    setEmail(initial?.email ?? '')
    setTeamCode(initial?.teamCode ?? '')
    setRole(initial?.role ?? 'contributor')
    setTitle(initial?.title ?? '')
    setError(null)
  }, [open, initial])

  function submit() {
    if (!name.trim()) {
      setError(t('members.errNameRequired'))
      return
    }
    const trimmedEmail = email.trim()
    // 이메일은 선택 필드 — 입력이 있을 때만 형식 검증(서버에서도 재검증하므로 이건 UX용).
    if (trimmedEmail && !isValidEmail(trimmedEmail)) {
      setError(t('members.errEmailInvalid'))
      return
    }
    const input = {
      name: name.trim(),
      email: trimmedEmail || null,
      teamCode: teamCode || null,
      role,
      title: title.trim() || null,
    }
    startTransition(async () => {
      const res = isEdit ? await updateMember(initial!.id, input) : await addMember(projectId, input)
      if (res.ok) {
        onClose()
        router.refresh()
      } else {
        setError(res.error ?? t('members.errSaveFailed'))
      }
    })
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      eyebrow={isEdit ? 'Edit member' : 'New member'}
      title={isEdit ? t('members.editMember') : t('members.addMember')}
      footer={
        <>
          <button onClick={onClose} className="btn btn-ghost" disabled={pending}>
            {t('common.cancel')}
          </button>
          <button onClick={submit} className="btn btn-primary" disabled={pending}>
            {pending ? t('members.saving') : isEdit ? t('members.saveChanges') : t('members.addMember')}
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <label className="block">
          <span className="mb-1.5 block text-xs font-semibold text-ink-muted">{t('members.fieldName')}</span>
          <input
            className="app-input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t('members.phName')}
            autoFocus
          />
        </label>

        <label className="block">
          <span className="mb-1.5 block text-xs font-semibold text-ink-muted">{t('members.fieldEmail')}</span>
          <input
            className="app-input"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder={t('members.phEmail')}
          />
        </label>

        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="mb-1.5 block text-xs font-semibold text-ink-muted">{t('members.fieldTeam')}</span>
            <select
              className="app-input"
              value={teamCode}
              onChange={(e) => setTeamCode(e.target.value as TeamCode | '')}
            >
              <option value="">{t('members.noTeamOption')}</option>
              {TEAM_OPTIONS.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </label>

          <label className="block">
            <span className="mb-1.5 block text-xs font-semibold text-ink-muted">{t('members.fieldRole')}</span>
            <select
              className="app-input"
              value={role}
              onChange={(e) => setRole(e.target.value as ProjectMemberRole)}
            >
              <option value="contributor">{t('members.roleContributor')}</option>
              <option value="admin">{t('members.roleAdmin')}</option>
            </select>
          </label>
        </div>

        <label className="block">
          <span className="mb-1.5 block text-xs font-semibold text-ink-muted">{t('members.fieldTitle')}</span>
          <input
            className="app-input"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={t('members.phTitle')}
          />
        </label>

        {error && (
          <div className="flex items-center gap-2 rounded-xl border border-delayed/40 bg-delayed-weak px-3 py-2.5 text-xs font-medium text-delayed">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
            {error}
          </div>
        )}
      </div>
    </Modal>
  )
}

function DeleteMemberModal({ member, onClose }: { member: ProjectMember | null; onClose: () => void }) {
  const router = useRouter()
  const { t } = useLocale()
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  useEffect(() => {
    if (member) setError(null)
  }, [member])

  function confirm() {
    if (!member) return
    startTransition(async () => {
      const res = await removeMember(member.id)
      if (res.ok) {
        onClose()
        router.refresh()
      } else {
        setError(res.error ?? t('members.errDeleteFailed'))
      }
    })
  }

  return (
    <Modal
      open={!!member}
      onClose={onClose}
      eyebrow="Remove member"
      title={t('members.deleteMember')}
      footer={
        <>
          <button onClick={onClose} className="btn btn-ghost" disabled={pending}>
            {t('common.cancel')}
          </button>
          <button
            onClick={confirm}
            disabled={pending}
            className="btn bg-delayed text-white shadow-sm transition hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {pending ? t('members.deleting') : t('common.delete')}
          </button>
        </>
      }
    >
      <p className="text-sm leading-6 text-ink-muted">
        <strong className="text-ink">{member?.name}</strong>{t('members.deleteConfirmSuffix')}
      </p>
      {error && (
        <div className="mt-4 flex items-center gap-2 rounded-xl border border-delayed/40 bg-delayed-weak px-3 py-2.5 text-xs font-medium text-delayed">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
          {error}
        </div>
      )}
    </Modal>
  )
}
