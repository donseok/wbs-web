'use client'

import { useEffect, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { UserPlus, Pencil, Trash2, Mail, ShieldCheck, UserRound, AlertTriangle, Info, Users } from 'lucide-react'
import { Modal } from '@/components/ui/Modal'
import { EmptyState } from '@/components/ui/EmptyState'
import { TEAM } from '@/components/wbs/shared'
import { addMember, updateMember, removeMember } from '@/app/actions/members'
import type { ProjectMember, ProjectMemberRole, TeamCode } from '@/lib/domain/types'

const IS_DEMO = process.env.NEXT_PUBLIC_DEMO_MODE === '1'

const TEAM_META: Record<TeamCode, { chip: string; avatar: string }> = {
  PMO: { chip: 'bg-team-pmo-weak text-team-pmo', avatar: 'from-team-pmo to-brand' },
  DT: { chip: 'bg-team-dt-weak text-team-dt', avatar: 'from-team-dt to-brand' },
  ERP: { chip: 'bg-team-erp-weak text-team-erp', avatar: 'from-team-erp to-accent-secondary' },
  MES: { chip: 'bg-team-mes-weak text-team-mes', avatar: 'from-team-mes to-brand' },
}

const TEAM_OPTIONS: TeamCode[] = ['PMO', 'DT', 'ERP', 'MES']

function roleMeta(role: ProjectMemberRole) {
  return role === 'admin'
    ? { label: '관리자', chip: 'bg-brand-weak text-brand', Icon: ShieldCheck }
    : { label: '기여자', chip: 'bg-progress-weak text-progress', Icon: UserRound }
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
          <h2 className="mt-0.5 text-sm font-semibold text-ink">팀 보드 · {members.length}명</h2>
        </div>
        {canEdit && (
          <button onClick={openAdd} className="btn btn-primary">
            <UserPlus className="h-4 w-4" />
            멤버 추가
          </button>
        )}
      </div>

      <div className="p-5 sm:p-6">
        {members.length === 0 ? (
          <EmptyState
            icon={Users}
            title="아직 등록된 멤버가 없습니다"
            description="멤버를 추가해 역할과 소속이 명확한 팀 보드를 구성하세요."
            action={
              canEdit ? (
                <button onClick={openAdd} className="btn btn-primary">
                  <UserPlus className="h-4 w-4" />
                  멤버 추가
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
  const role = roleMeta(member.role)
  const RoleIcon = role.Icon
  const avatar = member.teamCode ? TEAM_META[member.teamCode].avatar : 'from-brand to-brand-hover'

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
            {member.title ?? '직함 미지정'}
          </div>
        </div>
        {canEdit && (
          <div className="flex shrink-0 items-center gap-1">
            <button
              onClick={onEdit}
              aria-label={`${member.name} 수정`}
              className="flex h-7 w-7 items-center justify-center rounded-lg border border-line text-ink-subtle transition hover:border-line-strong hover:text-ink"
            >
              <Pencil className="h-3.5 w-3.5" />
            </button>
            <button
              onClick={onDelete}
              aria-label={`${member.name} 삭제`}
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
          {role.label}
        </span>
        {member.teamCode ? (
          <span className={`chip ${TEAM_META[member.teamCode].chip}`}>
            <span className={`h-1.5 w-1.5 rounded-full ${TEAM[member.teamCode].bar}`} />
            {member.teamCode}
          </span>
        ) : (
          <span className="chip bg-surface-2 text-ink-subtle">소속 미지정</span>
        )}
      </div>

      <div className="mt-auto flex items-center gap-1.5 border-t border-line pt-3 text-xs text-ink-subtle">
        <Mail className="h-3.5 w-3.5 shrink-0" />
        <span className="truncate" title={member.email ?? undefined}>
          {member.email ?? '이메일 미등록'}
        </span>
      </div>
    </div>
  )
}

function DemoNote() {
  if (!IS_DEMO) return null
  return (
    <div className="mt-4 flex items-center gap-2 rounded-xl border border-line bg-surface-2 px-3 py-2.5 text-xs text-ink-muted">
      <Info className="h-3.5 w-3.5 shrink-0 text-accent-warning" />
      데모 모드에서는 저장되지 않습니다.
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
      setError('이름을 입력하세요.')
      return
    }
    const input = {
      name: name.trim(),
      email: email.trim() || null,
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
        setError(res.error ?? '저장에 실패했습니다.')
      }
    })
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      eyebrow={isEdit ? 'Edit member' : 'New member'}
      title={isEdit ? '멤버 수정' : '멤버 추가'}
      footer={
        <>
          <button onClick={onClose} className="btn btn-ghost" disabled={pending}>
            취소
          </button>
          <button onClick={submit} className="btn btn-primary" disabled={pending}>
            {pending ? '저장 중…' : isEdit ? '변경 저장' : '멤버 추가'}
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <label className="block">
          <span className="mb-1.5 block text-xs font-semibold text-ink-muted">이름</span>
          <input
            className="app-input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="예: 이돈석"
            autoFocus
          />
        </label>

        <label className="block">
          <span className="mb-1.5 block text-xs font-semibold text-ink-muted">이메일</span>
          <input
            className="app-input"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="예: name@company.com"
          />
        </label>

        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="mb-1.5 block text-xs font-semibold text-ink-muted">소속 팀</span>
            <select
              className="app-input"
              value={teamCode}
              onChange={(e) => setTeamCode(e.target.value as TeamCode | '')}
            >
              <option value="">소속 없음</option>
              {TEAM_OPTIONS.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </label>

          <label className="block">
            <span className="mb-1.5 block text-xs font-semibold text-ink-muted">역할</span>
            <select
              className="app-input"
              value={role}
              onChange={(e) => setRole(e.target.value as ProjectMemberRole)}
            >
              <option value="contributor">기여자</option>
              <option value="admin">관리자</option>
            </select>
          </label>
        </div>

        <label className="block">
          <span className="mb-1.5 block text-xs font-semibold text-ink-muted">직함 / 역할 설명</span>
          <input
            className="app-input"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="예: PM / 프로젝트 총괄"
          />
        </label>

        {error && (
          <div className="flex items-center gap-2 rounded-xl border border-delayed/40 bg-delayed-weak px-3 py-2.5 text-xs font-medium text-delayed">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
            {error}
          </div>
        )}

        <DemoNote />
      </div>
    </Modal>
  )
}

function DeleteMemberModal({ member, onClose }: { member: ProjectMember | null; onClose: () => void }) {
  const router = useRouter()
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
        setError(res.error ?? '삭제에 실패했습니다.')
      }
    })
  }

  return (
    <Modal
      open={!!member}
      onClose={onClose}
      eyebrow="Remove member"
      title="멤버 삭제"
      footer={
        <>
          <button onClick={onClose} className="btn btn-ghost" disabled={pending}>
            취소
          </button>
          <button
            onClick={confirm}
            disabled={pending}
            className="btn bg-delayed text-white shadow-sm transition hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {pending ? '삭제 중…' : '삭제'}
          </button>
        </>
      }
    >
      <p className="text-sm leading-6 text-ink-muted">
        <strong className="text-ink">{member?.name}</strong> 님을 팀 보드에서 삭제할까요? 이 작업은 되돌릴 수 없습니다.
      </p>
      {error && (
        <div className="mt-4 flex items-center gap-2 rounded-xl border border-delayed/40 bg-delayed-weak px-3 py-2.5 text-xs font-medium text-delayed">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
          {error}
        </div>
      )}
      <DemoNote />
    </Modal>
  )
}
