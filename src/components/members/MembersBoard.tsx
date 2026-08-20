'use client'

import { useEffect, useMemo, useRef, useState, useTransition } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { UserPlus, Pencil, Trash2, Mail, UserCog, UserRound, AlertTriangle, Users, Unlink, Info, ArrowUpRight } from 'lucide-react'
import { Modal } from '@/components/ui/Modal'
import { useLocale } from '@/components/providers/LocaleProvider'
import { useTeamCodes } from '@/components/app/TeamsProvider'
import { EmptyState } from '@/components/ui/EmptyState'
import { teamStyle } from '@/components/wbs/shared'
import { addMember, updateMember, removeMember } from '@/app/actions/members'
import { searchMemberCandidates, type MemberCandidate } from '@/app/actions/memberSearch'
import { isValidEmail } from '@/lib/domain/validate'
import type { ProjectMember, ProjectMemberRole, TeamCode } from '@/lib/domain/types'
import { useBotPageContext } from '@/components/chat/BotPageContextProvider'

const TEAM_META: Record<TeamCode, { chip: string; avatar: string }> = {
  PMO: { chip: 'bg-team-pmo-weak text-team-pmo', avatar: 'from-team-pmo to-brand' },
  가공: { chip: 'bg-team-dt-weak text-team-dt', avatar: 'from-team-dt to-brand' },
  ERP: { chip: 'bg-team-erp-weak text-team-erp', avatar: 'from-team-erp to-accent-secondary' },
  MES: { chip: 'bg-team-mes-weak text-team-mes', avatar: 'from-team-mes to-brand' },
  MDM: { chip: 'bg-team-mdm-weak text-team-mdm', avatar: 'from-team-mdm to-brand' },
}
/** 팀별 CSS 토큰은 기존 5팀만 정의 — 팀 마스터의 신규 팀은 중립 메타. */
const teamMeta = (team: TeamCode): { chip: string; avatar: string } =>
  TEAM_META[team] ?? { chip: 'bg-surface-2 text-ink-muted', avatar: 'from-ink-subtle to-brand' }


// 아바타 그라디언트 팔레트(디자인 토큰 재사용). 멤버 id 해시로 결정적 배정 —
// 이름·이니셜이 같은(예: '테스트사용자'/'테스트QA' → 둘 다 '테스') 멤버도 색으로 구분된다.
// 소속 팀은 카드 하단 칩으로 별도 표시하므로 팀 정보가 사라지지 않는다.
const AVATAR_GRADIENTS = [
  'from-team-pmo to-brand',
  'from-team-dt to-brand',
  'from-team-erp to-accent-secondary',
  'from-team-mes to-brand',
  'from-team-mdm to-brand',
  'from-brand to-brand-hover',
  'from-accent-secondary to-brand',
]
function avatarGradient(seed: string): string {
  let h = 0
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) | 0
  return AVATAR_GRADIENTS[Math.abs(h) % AVATAR_GRADIENTS.length]
}

/** 명단상의 구분(리더/실무)이다. 권한이 아니므로 방패(ShieldCheck) 계열 아이콘을 쓰지 않는다. */
function roleMeta(role: ProjectMemberRole) {
  return role === 'admin'
    ? { labelKey: 'members.roleAdmin' as const, chip: 'bg-brand-weak text-brand', Icon: UserCog }
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
  const { t, locale } = useLocale()
  const teamCodes = useTeamCodes()
  const searchParams = useSearchParams()
  // 챗봇 딥링크 ?team= 초기 팀 필터 — 무효 값은 조용히 무시('all').
  const [teamFilter, setTeamFilter] = useState<TeamCode | 'all'>(() => {
    const team = searchParams.get('team')
    return team && (teamCodes as readonly string[]).includes(team) ? (team as TeamCode) : 'all'
  })
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<ProjectMember | null>(null)
  const [deleting, setDeleting] = useState<ProjectMember | null>(null)
  useBotPageContext({
    domain: 'members',
    projectId,
    selectedEntity: editing ? { type: 'member', id: editing.id } : null,
    filters: teamFilter === 'all' ? {} : { team: teamFilter },
  })
  const visibleMembers = useMemo(
    () => (teamFilter === 'all' ? members : members.filter((m) => m.teamCode === teamFilter)),
    [members, teamFilter],
  )

  function openAdd() {
    setEditing(null)
    setFormOpen(true)
  }
  function openEdit(member: ProjectMember) {
    setEditing(member)
    setFormOpen(true)
  }

  // 카드가 스크롤 영역을 꽉 채우고(h-full), 헤더는 고정된 채 그리드만 내부에서 스크롤된다.
  // WBS 시트와 동일한 "단일 내부 스크롤 컨테이너" 패턴.
  return (
    <div className="card flex h-full min-h-0 flex-col overflow-hidden">
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-4 sm:px-6">
        <div>
          <div className="eyebrow">Member board</div>
          <h2 className="mt-0.5 text-sm font-semibold text-ink">{t('members.boardTitle')} · {members.length}{t('members.unitPeople')}</h2>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {/* 신규 문구는 dict 미보유라 locale 분기(근태 삭제 확인 문구 관례) */}
          <select
            value={teamFilter}
            onChange={(e) => setTeamFilter(e.target.value as TeamCode | 'all')}
            className="app-input h-10 w-auto min-w-[120px]"
            aria-label={locale === 'en' ? 'Team filter' : '팀 필터'}
          >
            <option value="all">{locale === 'en' ? 'All teams' : '전체 팀'}</option>
            {teamCodes.map((code) => (
              <option key={code} value={code}>{code}</option>
            ))}
          </select>
          {canEdit && (
            <button onClick={openAdd} className="btn btn-primary">
              <UserPlus className="h-4 w-4" />
              {t('members.addMember')}
            </button>
          )}
        </div>
      </div>

      {/* 명단 ≠ 권한. 이 화면의 '리더'는 직책이고, 로그인 권한은 설정 › 권한에 있다.
          링크는 관리자에게만 — 멤버가 눌러 가면 권한 섹션이 보이지 않아 막다른 길이 된다. */}
      <div className="flex shrink-0 flex-wrap items-center gap-x-2 gap-y-1 border-b border-line bg-surface-2 px-5 py-2.5 sm:px-6">
        <Info className="h-3.5 w-3.5 shrink-0 text-ink-subtle" aria-hidden />
        <p className="text-xs leading-5 text-ink-muted">{t('members.rosterNotice')}</p>
        {canEdit && (
          <Link
            href={`/p/${projectId}/settings`}
            className="inline-flex items-center gap-0.5 text-xs font-semibold text-brand hover:underline"
          >
            {t('members.rosterNoticeLink')}
            <ArrowUpRight className="h-3.5 w-3.5" aria-hidden />
          </Link>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-y-contain p-5 sm:p-6">
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
        ) : visibleMembers.length === 0 ? (
          <EmptyState
            icon={Users}
            title={locale === 'en' ? 'No members in this team' : '해당 팀 멤버가 없습니다'}
          />
        ) : (
          <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {visibleMembers.map((member) => (
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
          <div className="mt-0.5 flex min-w-0 items-center gap-1.5 text-xs text-ink-muted">
            <span className="truncate" title={member.title ?? undefined}>
              {member.title ?? t('members.noTitle')}
            </span>
            {member.roleLabel && (
              <span className="chip shrink-0 bg-brand-weak text-brand">{member.roleLabel}</span>
            )}
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
          <span className={`chip ${teamMeta(member.teamCode).chip}`}>
            <span className={`h-1.5 w-1.5 rounded-full ${teamStyle(member.teamCode).bar}`} />
            {member.teamCode}
          </span>
        ) : (
          <span className="chip bg-surface-2 text-ink-subtle">{t('members.noTeam')}</span>
        )}
        {/* 이메일은 있는데 로그인 계정과 이어지지 않은 행 — 이 사람은 '내 회의'가 빈 화면이다.
            이메일 자체가 없는 행(외부 인력)은 아래 이메일 줄이 이미 '미등록'을 보여준다. */}
        {member.email && !member.hasAccount && (
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
  const { t, locale } = useLocale()
  const teamCodes = useTeamCodes()
  const isEdit = !!initial
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [teamCode, setTeamCode] = useState<TeamCode | ''>('')
  const [role, setRole] = useState<ProjectMemberRole>('contributor')
  const [title, setTitle] = useState('')
  const [roleLabel, setRoleLabel] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  // ── 이름 자동완성(추가 모드 전용) ──────────────────────────────
  // 이메일이 사람의 전역 키라서 기존 인물은 기존 이름 그대로 입력해야만 저장된다.
  // 타이핑한 이름으로 로스터 후보를 찾아 선택하면 폼을 채우고 이름·이메일을 잠가
  // "같은 사람, 다른 표기"로 서버에 거부당하는 함정을 없앤다. 수정 모드는 기존 동작
  // 유지(이름 변경엔 슈퍼유저 제약이 따로 있다).
  const [locked, setLocked] = useState(false)
  const [candidates, setCandidates] = useState<MemberCandidate[]>([])
  const [acOpen, setAcOpen] = useState(false)
  // 문구는 렌더 시 t()로 뽑는다 — t 를 effect 의존성에 넣지 않기 위한 boolean.
  const [acError, setAcError] = useState(false)
  const [activeIdx, setActiveIdx] = useState(-1)
  // 응답 역전 방지 — 마지막 요청만 반영한다.
  const acSeq = useRef(0)

  useEffect(() => {
    if (!open) return
    setName(initial?.name ?? '')
    setEmail(initial?.email ?? '')
    setTeamCode(initial?.teamCode ?? '')
    setRole(initial?.role ?? 'contributor')
    setTitle(initial?.title ?? '')
    setRoleLabel(initial?.roleLabel ?? '')
    setError(null)
    setLocked(false)
    setCandidates((prev) => (prev.length ? [] : prev))
    setAcOpen(false)
    setAcError(false)
    setActiveIdx(-1)
    acSeq.current++
  }, [open, initial])

  useEffect(() => {
    if (isEdit || !open || locked) return
    const q = name.trim()
    if (q.length < 2) {
      acSeq.current++
      // 동일 참조 유지 — 빈 배열을 매번 새로 만들면 렌더 루프가 된다.
      setCandidates((prev) => (prev.length ? [] : prev))
      setAcOpen(false)
      setAcError(false)
      setActiveIdx(-1)
      return
    }
    const timer = setTimeout(() => {
      const seq = ++acSeq.current
      const fail = (cause: unknown) => {
        if (seq !== acSeq.current) return
        // 조회 실패를 "후보 없음"으로 위장하지 않는다 — 표시 = 로깅.
        console.error('[members] 이름 후보 검색 실패:', cause)
        setAcError(true)
        setCandidates((prev) => (prev.length ? [] : prev))
        setAcOpen(false)
        setActiveIdx(-1)
      }
      searchMemberCandidates(projectId, q)
        .then((res) => {
          if (seq !== acSeq.current) return
          if (!res.ok) {
            fail(res.error)
            return
          }
          const list = res.candidates ?? []
          setAcError(false)
          setCandidates(list)
          setAcOpen(list.length > 0)
          setActiveIdx(-1)
        })
        .catch(fail)
    }, 250)
    return () => clearTimeout(timer)
  }, [name, isEdit, open, locked, projectId])

  function selectCandidate(c: MemberCandidate) {
    acSeq.current++ // 진행 중인 응답 무효화
    setName(c.name)
    setEmail(c.email ?? '')
    setTeamCode(c.teamCode ?? '')
    setTitle(c.title ?? '')
    setRoleLabel(c.roleLabel ?? '')
    setLocked(true)
    setCandidates((prev) => (prev.length ? [] : prev))
    setAcOpen(false)
    setAcError(false)
    setActiveIdx(-1)
  }

  function unlockManual() {
    setLocked(false)
    setName('')
    setEmail('')
  }

  function onNameKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (isEdit || locked) return
    if (e.key === 'Escape') {
      // 드롭다운이 열려 있으면 모달(document keydown)까지 닫히지 않게 여기서 흡수한다.
      if (acOpen) {
        e.stopPropagation()
        setAcOpen(false)
        setActiveIdx(-1)
      }
      return
    }
    if (!acOpen || candidates.length === 0) return
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActiveIdx((i) => (i + 1) % candidates.length)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActiveIdx((i) => (i <= 0 ? candidates.length - 1 : i - 1))
    } else if (e.key === 'Enter' && activeIdx >= 0) {
      e.preventDefault()
      selectCandidate(candidates[activeIdx])
    }
  }

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
      roleLabel: roleLabel.trim() || null,
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
        <div className="relative">
          <label className="block">
            <span className="mb-1.5 block text-xs font-semibold text-ink-muted">{t('members.fieldName')}</span>
            <input
              className="app-input read-only:bg-surface-2 read-only:text-ink-muted"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={onNameKeyDown}
              onBlur={() => { setAcOpen(false); setActiveIdx(-1) }}
              placeholder={t('members.phName')}
              autoFocus
              readOnly={locked}
              {...(!isEdit
                ? {
                    role: 'combobox' as const,
                    'aria-expanded': acOpen,
                    'aria-controls': 'member-ac-listbox',
                    'aria-autocomplete': 'list' as const,
                    'aria-activedescendant': activeIdx >= 0 ? `member-ac-option-${activeIdx}` : undefined,
                  }
                : {})}
            />
          </label>
          {/* 상태 변형 display 유틸 금지(unlayered 안전망) — 표시/숨김은 조건부 렌더링으로. */}
          {!isEdit && acOpen && candidates.length > 0 && (
            <ul
              id="member-ac-listbox"
              role="listbox"
              aria-label={t('members.acListboxLabel')}
              className="absolute left-0 right-0 top-full z-20 mt-1 max-h-56 overflow-y-auto rounded-xl border border-line bg-surface py-1 shadow-[var(--shadow-md)]"
              onMouseDown={(e) => e.preventDefault()} // blur 로 닫히기 전에 클릭이 씹히지 않게
            >
              {candidates.map((c, i) => (
                <li
                  key={`${c.name}|${c.email ?? ''}`}
                  id={`member-ac-option-${i}`}
                  role="option"
                  aria-selected={i === activeIdx}
                  className={`flex cursor-pointer flex-col gap-0.5 px-3 py-2 ${i === activeIdx ? 'bg-brand-weak' : 'hover:bg-surface-2'}`}
                  onMouseEnter={() => setActiveIdx(i)}
                  onClick={() => selectCandidate(c)}
                >
                  <span className="flex items-baseline gap-1.5 text-sm">
                    <span className="font-semibold text-ink">{c.name}</span>
                    {c.title && <span className="truncate text-xs text-ink-muted">{c.title}</span>}
                  </span>
                  <span className="text-xs text-ink-subtle">{c.email ?? t('members.noEmail')}</span>
                </li>
              ))}
            </ul>
          )}
          {!isEdit && acError && (
            <p className="mt-1.5 text-[11px] leading-4 text-delayed">{t('members.acSearchError')}</p>
          )}
        </div>

        <label className="block">
          <span className="mb-1.5 block text-xs font-semibold text-ink-muted">{t('members.fieldEmail')}</span>
          <input
            className="app-input read-only:bg-surface-2 read-only:text-ink-muted"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder={t('members.phEmail')}
            readOnly={locked}
          />
          <span className="mt-1.5 block text-[11px] leading-4 text-ink-subtle">
            {t('members.identityHint')}
          </span>
        </label>

        {locked && (
          <div className="flex items-start justify-between gap-2 rounded-xl border border-line bg-surface-2 px-3 py-2.5">
            <span className="text-[11px] leading-4 text-ink-muted">{t('members.acLockedNotice')}</span>
            <button
              type="button"
              onClick={unlockManual}
              className="shrink-0 text-[11px] font-semibold text-brand hover:underline"
            >
              {t('members.acManualSwitch')}
            </button>
          </div>
        )}

        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="mb-1.5 block text-xs font-semibold text-ink-muted">{t('members.fieldTeam')}</span>
            <select
              className="app-input"
              value={teamCode}
              onChange={(e) => setTeamCode(e.target.value as TeamCode | '')}
            >
              <option value="">{t('members.noTeamOption')}</option>
              {teamCodes.map((t) => (
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

        {/* 신규 문구는 dict 미보유 → locale 분기(근태 삭제 확인 문구 관례) */}
        <label className="block">
          <span className="mb-1.5 block text-xs font-semibold text-ink-muted">{locale === 'en' ? 'Role' : '역할'}</span>
          <input className="app-input" value={roleLabel} onChange={(e) => setRoleLabel(e.target.value)}
            placeholder={locale === 'en' ? 'e.g. PM, Dev, QA' : '예: PM · 개발 · QA'} maxLength={30} />
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
