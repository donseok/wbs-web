'use client'
// 이슈 조치/해결 경과 이력 — 목록 + 등록 폼.
//
// 구조는 IssueAttachments.tsx 복제다: 자체 load() 로 지연 로드하고 부모를 refresh 하지
// 않는다. IssueDetailModal 은 useEffect([issue]) 로 폼을 재베이스라인하므로(:202-207)
// 여기서 router.refresh() 를 하면 옆에서 입력 중인 내용이 리셋된다.
//
// 표시 토글은 전부 JSX 조건부 렌더다. 상태 변형 display 유틸은 globals.css 끝의 unlayered
// 안전망에 져서 조용히 동작하지 않는다.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { CircleSlash, MessageSquare, RotateCcw, Trash2 } from 'lucide-react'
import { useLocale } from '@/components/providers/LocaleProvider'
import {
  addIssueUpdate, archiveIssueUpdate, listIssueUpdates, purgeIssueUpdate, unarchiveIssueUpdate,
} from '@/app/actions/issueUpdates'
import {
  ISSUE_UPDATE_BODY_MAX,
  ISSUE_UPDATE_CATEGORIES,
  ISSUE_UPDATE_CATEGORY_META,
  MIGRATED_AUTHOR_NAME,
  canArchiveUpdate,
  canPurgeUpdate,
  parseStatusChange,
  type IssueUpdate,
  type IssueUpdateCategory,
} from '@/lib/domain/issueUpdates'
import { ISSUE_STATUS_META } from '@/lib/domain/issues'

/** 기본으로 펴는 건수 — 모달 본문이 max-h-[70vh] 스크롤 박스라 전량을 펴면 푸터가 밀린다. */
const VISIBLE_DEFAULT = 5

export interface IssueUpdatesProps {
  issueId: string
  /** 프로젝트 멤버 이상인가 — 입력 UI 노출 기준. canEdit(이슈 작성자 축)과 다른 축이다. */
  canWrite: boolean
  currentUserId: string | null
  isProjectAdmin: boolean
}

function fmtAt(iso: string, locale: string): string {
  const d = new Date(iso)
  return d.toLocaleString(locale === 'en' ? 'en-US' : 'ko-KR', {
    month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit',
  })
}

export function IssueUpdates({ issueId, canWrite, currentUserId, isProjectAdmin }: IssueUpdatesProps) {
  const { t, locale } = useLocale()
  const [list, setList] = useState<IssueUpdate[] | null>(null)
  // 실패 '여부'만 담는다 — 번역문을 state 에 넣으면 load 가 t 에 의존해 무한 루프가 된다.
  const [loadFailed, setLoadFailed] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const [showArchived, setShowArchived] = useState(true)
  const [body, setBody] = useState('')
  const [category, setCategory] = useState<IssueUpdateCategory | ''>('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const load = useCallback(() => {
    listIssueUpdates(issueId)
      .then(res => {
        if (res.ok) { setList(res.items); setLoadFailed(false); return }
        // 조회 실패를 '경과 없음'으로 위장하면 사용자는 조치 이력이 소실됐다고 읽는다.
        console.error('[IssueUpdates] 이력 조회 실패:', res.error)
        setList([]); setLoadFailed(true)
      })
      .catch((cause: unknown) => {
        console.error('[IssueUpdates] 이력 조회 호출 실패:', cause)
        setList([]); setLoadFailed(true)
      })
  }, [issueId])
  useEffect(() => { setList(null); load() }, [issueId, load])

  const all = useMemo(() => list ?? [], [list])
  const archivedCount = all.filter(u => u.archivedAt !== null).length
  const shown = showArchived ? all : all.filter(u => u.archivedAt === null)
  const hiddenCount = Math.max(0, shown.length - VISIBLE_DEFAULT)
  const visible = expanded ? shown : shown.slice(-VISIBLE_DEFAULT)

  async function run(fn: () => Promise<{ ok: boolean; error?: string; partial?: string }>) {
    setBusy(true); setErr(null); setNotice(null)
    try {
      const res = await fn()
      if (!res.ok) { setErr(res.error ?? t('issue.err.updateSaveFailed')); return false }
      if (res.partial) setNotice(res.partial)
      load()
      return true
    } catch (cause) {
      // 액션 호출 자체가 거부된 경우. finally 가 busy 는 풀어주지만 아무 메시지도 없으면
      // 사용자에겐 '아무 일도 안 일어남' 으로 보인다 — load() 가 같은 이유로 이미 catch 를 둔다.
      console.error('[IssueUpdates] 이력 액션 호출 실패:', cause)
      setErr(t('issue.err.updateSaveFailed'))
      return false
    } finally { setBusy(false) }
  }

  async function submit() {
    const text = body.trim()
    if (text.length === 0) return
    const ok = await run(() => addIssueUpdate(issueId, {
      body: text,
      category: category === '' ? null : category,
      mentionedMemberIds: [],
    }))
    // 성공했을 때만 비운다 — 실패했는데 지우면 사용자가 쓴 글이 사라진다.
    if (ok) { setBody(''); setCategory('') }
  }

  return (
    <section className="space-y-3 rounded-2xl border border-line bg-surface-2 p-4">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-subtle">
          <MessageSquare className="h-3.5 w-3.5" aria-hidden /> {t('issue.update.section')}
        </div>
        {archivedCount > 0 && (
          <button
            type="button"
            onClick={() => setShowArchived(v => !v)}
            className="text-[11px] font-medium text-ink-subtle hover:text-ink"
          >
            {(showArchived ? t('issue.update.hideArchived') : t('issue.update.showArchived'))
              .replace('{n}', String(archivedCount))}
          </button>
        )}
      </div>

      {loadFailed && <p className="text-xs font-medium text-delayed">{t('issue.err.updateLoadFailed')}</p>}
      {err && <p className="text-xs font-medium text-delayed">{err}</p>}
      {notice && <p className="text-xs font-medium text-delayed">{notice}</p>}

      {list == null ? (
        <p className="text-sm text-ink-subtle">{t('common.loading')}</p>
      ) : shown.length === 0 ? (
        <p className="text-sm text-ink-subtle">{t('issue.update.empty')}</p>
      ) : (
        <>
          {!expanded && hiddenCount > 0 && (
            <button
              type="button"
              onClick={() => setExpanded(true)}
              className="text-[11px] font-medium text-brand hover:underline"
            >
              {t('issue.update.more').replace('{n}', String(hiddenCount))}
            </button>
          )}
          <ol className="space-y-2">
            {visible.map(u => {
              const archived = u.archivedAt !== null
              const status = u.kind === 'status' ? parseStatusChange(u.body) : null
              const mayArchive = canWrite && canArchiveUpdate(u, currentUserId, isProjectAdmin) && u.kind === 'note'
              const mayPurge = canWrite && canPurgeUpdate(isProjectAdmin)
              return (
                <li
                  key={u.id}
                  className={`rounded-lg border border-line px-2.5 py-2 ${
                    u.kind === 'status' ? 'bg-surface-1/40' : 'bg-surface-1'
                  }`}
                >
                  <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-ink-subtle">
                    <span className="font-medium text-ink-muted">{u.authorName}</span>
                    <span aria-hidden>·</span>
                    <time dateTime={u.createdAt}>{fmtAt(u.createdAt, locale)}</time>
                    {u.authorName === MIGRATED_AUTHOR_NAME && (
                      <span className="text-[11px] text-ink-subtle">{t('issue.update.migrated')}</span>
                    )}
                    {u.category && (
                      <span className="rounded bg-surface-2 px-1.5 py-0.5 text-[10px] font-medium text-ink-muted">
                        {t(ISSUE_UPDATE_CATEGORY_META[u.category].labelKey)}
                      </span>
                    )}
                    <span className="ml-auto flex items-center gap-1">
                      {mayArchive && !archived && (
                        <button
                          type="button" disabled={busy}
                          onClick={() => run(() => archiveIssueUpdate(issueId, u.id))}
                          aria-label={t('issue.update.archive')} title={t('issue.update.archive')}
                          className="rounded p-0.5 text-ink-subtle hover:text-delayed"
                        >
                          <CircleSlash className="h-3.5 w-3.5" aria-hidden />
                        </button>
                      )}
                      {mayArchive && archived && (
                        <button
                          type="button" disabled={busy}
                          onClick={() => run(() => unarchiveIssueUpdate(issueId, u.id))}
                          aria-label={t('issue.update.unarchive')} title={t('issue.update.unarchive')}
                          className="rounded p-0.5 text-ink-subtle hover:text-ink"
                        >
                          <RotateCcw className="h-3.5 w-3.5" aria-hidden />
                        </button>
                      )}
                      {mayPurge && (
                        <button
                          type="button" disabled={busy}
                          onClick={() => {
                            if (confirmPurge(t('issue.update.purgeConfirm'))) void run(() => purgeIssueUpdate(issueId, u.id))
                          }}
                          aria-label={t('issue.update.purge')} title={t('issue.update.purge')}
                          className="rounded p-0.5 text-ink-subtle hover:text-delayed"
                        >
                          <Trash2 className="h-3.5 w-3.5" aria-hidden />
                        </button>
                      )}
                    </span>
                  </div>
                  {status ? (
                    <p className="mt-1 text-[13px] text-ink-muted">
                      {t('issue.update.statusChange')
                        .replace('{from}', t(ISSUE_STATUS_META[status.from].labelKey))
                        .replace('{to}', t(ISSUE_STATUS_META[status.to].labelKey))}
                    </p>
                  ) : (
                    <p
                      className={`mt-1 whitespace-pre-wrap text-[13px] leading-5 ${
                        archived ? 'text-ink-muted line-through decoration-ink-subtle/50' : 'text-ink'
                      }`}
                    >
                      {u.body}
                    </p>
                  )}
                  {archived && u.archivedByName && (
                    <p className="mt-1 text-[11px] text-ink-subtle">
                      {t('issue.update.archivedBy').replace('{name}', u.archivedByName)}
                    </p>
                  )}
                </li>
              )
            })}
          </ol>
        </>
      )}

      {canWrite && (
        <div className="space-y-2">
          <textarea
            className="app-textarea min-h-[72px] resize-y"
            value={body}
            maxLength={ISSUE_UPDATE_BODY_MAX}
            onChange={e => setBody(e.target.value)}
            placeholder={t('issue.update.placeholder')}
          />
          <div className="flex items-center gap-2">
            <label className="sr-only" htmlFor="issue-update-category">{t('issue.update.category')}</label>
            <select
              id="issue-update-category"
              className="app-input h-8 w-auto text-xs"
              value={category}
              onChange={e => setCategory(e.target.value as IssueUpdateCategory | '')}
            >
              <option value="">{t('issue.update.categoryNone')}</option>
              {ISSUE_UPDATE_CATEGORIES.map(c => (
                <option key={c} value={c}>{t(ISSUE_UPDATE_CATEGORY_META[c].labelKey)}</option>
              ))}
            </select>
            <button
              type="button"
              onClick={submit}
              disabled={busy || body.trim().length === 0}
              className="btn btn-primary ml-auto h-8 text-xs"
            >
              {t('issue.update.add')}
            </button>
          </div>
        </div>
      )}
    </section>
  )
}

/**
 * 완전 삭제 확인. window.confirm 은 Modal 의 Escape·포커스 트랩과 싸우지 않는 유일하게
 * 값싼 수단이고, 이 앱의 다른 파괴적 동작은 전용 모달을 쓰지만 그건 이슈 단위다.
 * 이력 한 건에 모달을 하나 더 띄우면 모달 안의 모달이 된다.
 *
 * 문구는 호출부가 t('issue.update.purgeConfirm') 로 번역해 넘긴다 — 여기서 하드코딩하면
 * EN 로케일 사용자가 되돌릴 수 없는 동작 앞에서 한국어 대화상자를 보게 된다.
 */
function confirmPurge(message: string): boolean {
  if (typeof window === 'undefined') return false
  return window.confirm(message)
}
