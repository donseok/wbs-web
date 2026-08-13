'use client'

import dynamic from 'next/dynamic'
import { useRouter } from 'next/navigation'
import { useEffect, useState, type CSSProperties } from 'react'
import { BadgeCheck, FilePlus2, Pencil, RotateCcw, Save, X } from 'lucide-react'
import {
  createWikiDocument,
  updateWikiDocument,
  verifyWikiDocument,
  WIKI_DOCUMENT_KINDS,
  type WikiDocumentKind,
} from '@/app/actions/wiki'
import type { Locale } from '@/lib/i18n/dict'
import { t } from '@/lib/i18n/dict'
import { Modal } from '@/components/ui/Modal'
import { formatWikiDate } from './WikiShared'
import { trackWikiEvent } from './wikiAnalytics'

const MarkdownView = dynamic(
  () => import('@/components/minutes/MarkdownView').then((module) => module.MarkdownView),
  { ssr: false },
)

type EditableTopic = {
  id: string
  title: string
  bodyMd?: string | null
  bodyUpdatedAt?: string | null
  documentKind?: string | null
}

const KIND_LABEL: Record<WikiDocumentKind, { ko: string; en: string }> = {
  overview: { ko: '프로젝트 개요', en: 'Overview' },
  decision: { ko: '결정 기록', en: 'Decision' },
  how_to: { ko: '사용 방법', en: 'How-to' },
  runbook: { ko: '운영 런북', en: 'Runbook' },
  faq: { ko: '자주 묻는 질문', en: 'FAQ' },
  glossary: { ko: '용어집', en: 'Glossary' },
  reference: { ko: '참조 자료', en: 'Reference' },
}

const TEMPLATE: Record<WikiDocumentKind, { ko: string; en: string }> = {
  overview: {
    ko: '## 목적\n\n이 프로젝트가 해결하는 문제를 적어 주세요.\n\n## 범위\n\n- 포함:\n- 제외:\n\n## 시작하기\n\n새 참여자가 가장 먼저 알아야 할 내용을 적어 주세요.',
    en: '## Purpose\n\nDescribe the problem this project solves.\n\n## Scope\n\n- Included:\n- Excluded:\n\n## Getting started\n\nAdd what a new teammate should know first.',
  },
  decision: {
    ko: '## 결정\n\n결론을 한 문장으로 적어 주세요.\n\n## 맥락\n\n왜 이 결정이 필요했는지 적어 주세요.\n\n## 검토한 선택지\n\n- 선택지 A:\n- 선택지 B:\n\n## 영향과 후속 작업\n\n- ',
    en: '## Decision\n\nState the outcome in one sentence.\n\n## Context\n\nExplain why the decision was needed.\n\n## Options considered\n\n- Option A:\n- Option B:\n\n## Consequences and follow-ups\n\n- ',
  },
  how_to: {
    ko: '## 언제 사용하나요?\n\n이 절차가 필요한 상황을 적어 주세요.\n\n## 준비 사항\n\n- \n\n## 절차\n\n1. \n2. \n3. \n\n## 완료 확인\n\n성공 여부를 확인하는 방법을 적어 주세요.',
    en: '## When to use this\n\nDescribe when this procedure applies.\n\n## Prerequisites\n\n- \n\n## Steps\n\n1. \n2. \n3. \n\n## Verify completion\n\nExplain how to confirm success.',
  },
  runbook: {
    ko: '## 증상\n\n관찰되는 현상을 적어 주세요.\n\n## 확인\n\n1. \n2. \n\n## 조치\n\n1. \n2. \n\n## 복구 확인\n\n- \n\n## 에스컬레이션\n\n담당자와 기준을 적어 주세요.',
    en: '## Symptoms\n\nDescribe what is observed.\n\n## Diagnose\n\n1. \n2. \n\n## Remediate\n\n1. \n2. \n\n## Verify recovery\n\n- \n\n## Escalation\n\nAdd the owner and escalation criteria.',
  },
  faq: {
    ko: '## 질문\n\n자주 반복되는 질문을 적어 주세요.\n\n## 답변\n\n짧고 직접적인 답을 적어 주세요.\n\n## 예외와 참고\n\n- ',
    en: '## Question\n\nAdd a frequently repeated question.\n\n## Answer\n\nGive a short, direct answer.\n\n## Exceptions and references\n\n- ',
  },
  glossary: {
    ko: '## 용어\n\n### 용어 이름\n\n정의와 프로젝트에서 사용하는 맥락을 적어 주세요.\n\n### 다른 용어\n\n정의를 적어 주세요.',
    en: '## Terms\n\n### Term name\n\nAdd the definition and how the project uses it.\n\n### Another term\n\nAdd its definition.',
  },
  reference: {
    ko: '## 요약\n\n참조할 핵심 내용을 적어 주세요.\n\n## 상세\n\n- \n\n## 관련 링크\n\n- ',
    en: '## Summary\n\nAdd the key reference information.\n\n## Details\n\n- \n\n## Related links\n\n- ',
  },
}

function documentKind(value: string | null | undefined): WikiDocumentKind {
  return (WIKI_DOCUMENT_KINDS as readonly string[]).includes(value ?? '')
    ? value as WikiDocumentKind
    : 'overview'
}

/**
 * 작성 중 본문 보호. 새 문서는 Modal 안에서 쓰는데 Modal 은 Escape·백드롭 클릭에서
 * 확인 없이 onClose 하고(components/ui/Modal.tsx), Modal 은 앱 전역이 쓰는 파일이라
 * 여기 사정으로 닫기 의미를 바꿀 수 없다. 그래서 "닫기를 막는" 대신 "닫혀도 잃지 않게"
 * 한다 — 초안을 로컬에 남겨 두고 다음에 열 때 되돌려준다. 확인 모달이 없으니 화면도
 * 그만큼 조용하다.
 *
 * 로컬 저장이라 다른 PC 로는 따라가지 않는다. 서버 draft 는 별도 스펙이다.
 */
const DRAFT_PREFIX = 'wiki-draft'
const DRAFT_DEBOUNCE_MS = 600

interface WikiDraft {
  title: string
  bodyMd: string
  kind: WikiDocumentKind
  savedAt: string
}

function draftKey(projectId: string, topicId: string | null): string {
  return `${DRAFT_PREFIX}:${projectId}:${topicId ?? 'new'}`
}

function readDraft(key: string): WikiDraft | null {
  try {
    const raw = window.localStorage.getItem(key)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<WikiDraft>
    if (typeof parsed.bodyMd !== 'string' || typeof parsed.title !== 'string') return null
    return {
      title: parsed.title,
      bodyMd: parsed.bodyMd,
      kind: documentKind(parsed.kind),
      savedAt: typeof parsed.savedAt === 'string' ? parsed.savedAt : '',
    }
  } catch {
    // 사파리 프라이빗 모드 등 localStorage 가 throw 하는 환경에서도 편집은 계속돼야 한다.
    return null
  }
}

function writeDraft(key: string, draft: WikiDraft): void {
  try { window.localStorage.setItem(key, JSON.stringify(draft)) } catch { /* 저장 실패는 편집을 막지 않는다 */ }
}

function clearDraft(key: string): void {
  try { window.localStorage.removeItem(key) } catch { /* 위와 같다 */ }
}

export function WikiDocumentEditor({
  projectId,
  locale,
  topic = null,
  canEdit = false,
  canVerify = false,
  onDone,
}: {
  projectId: string
  locale: Locale
  topic?: EditableTopic | null
  canEdit?: boolean
  canVerify?: boolean
  onDone?: () => void
}) {
  const router = useRouter()
  const [snapshot, setSnapshot] = useState({
    title: topic?.title ?? '',
    bodyMd: topic?.bodyMd ?? '',
    bodyUpdatedAt: topic?.bodyUpdatedAt ?? null,
    kind: documentKind(topic?.documentKind),
  })
  const initialKind = documentKind(topic?.documentKind)
  const [title, setTitle] = useState(snapshot.title)
  // 새 문서는 기본 유형의 템플릿으로 열어 둔다. 빈 mono textarea 앞에서 무엇을 쓸지
  // 몰라 그대로 닫는 것이 관찰된 이탈 지점이고, 유형 select 를 '바꿀' 때만 템플릿이
  // 들어오던 기존 동작은 기본값을 그대로 쓰는 다수에게 한 번도 발동하지 않았다.
  const [bodyMd, setBodyMd] = useState(topic ? snapshot.bodyMd : TEMPLATE[initialKind][locale])
  const [kind, setKind] = useState<WikiDocumentKind>(snapshot.kind)
  const [editing, setEditing] = useState(!topic)
  const [busy, setBusy] = useState(false)
  const [verifying, setVerifying] = useState(false)
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null)
  const [draft, setDraft] = useState<WikiDraft | null>(null)

  const path = topic
    ? `/p/${projectId}/wiki/topics/${topic.id}`
    : `/p/${projectId}/wiki`

  const storageKey = draftKey(projectId, topic?.id ?? null)
  // 손대지 않은 템플릿은 "쓴 것"이 아니다. 이걸 구분하지 않으면 새 문서를 열자마자
  // 초안이 쌓이고, 유형을 바꿔도 템플릿이 갈리지 않는다.
  const untouchedTemplate = !topic
    && title.trim() === ''
    && WIKI_DOCUMENT_KINDS.some((value) => bodyMd === TEMPLATE[value][locale])
  const dirty = !untouchedTemplate
    && (title.trim() !== snapshot.title.trim() || bodyMd !== snapshot.bodyMd)

  // 초안 저장 — 타이핑마다 쓰지 않도록 debounce 한다.
  useEffect(() => {
    if (!editing) return
    if (!dirty) { clearDraft(storageKey); return }
    const timer = window.setTimeout(() => {
      writeDraft(storageKey, { title, bodyMd, kind, savedAt: new Date().toISOString() })
    }, DRAFT_DEBOUNCE_MS)
    return () => window.clearTimeout(timer)
  }, [editing, dirty, storageKey, title, bodyMd, kind])

  // 탭을 닫거나 새로고침하는 경우엔 debounce 를 기다릴 수 없다.
  useEffect(() => {
    if (!editing || !dirty) return
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      writeDraft(storageKey, { title, bodyMd, kind, savedAt: new Date().toISOString() })
      event.preventDefault()
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [editing, dirty, storageKey, title, bodyMd, kind])

  // 열 때 남아 있는 초안을 찾아 복구 배너로 제시한다. 몰래 덮어쓰지 않는 이유는
  // 서버 본문이 그 사이 남의 편집으로 바뀌었을 수 있기 때문이다 — 선택은 사람이 한다.
  useEffect(() => {
    if (!editing) { setDraft(null); return }
    const found = readDraft(storageKey)
    setDraft(found && found.bodyMd !== snapshot.bodyMd ? found : null)
  }, [editing, storageKey, snapshot.bodyMd])

  function changeKind(next: WikiDocumentKind) {
    setKind(next)
    // 아직 손대지 않은 템플릿이거나 빈 본문이면 새 유형의 템플릿으로 갈아 끼운다.
    if (!bodyMd.trim() || untouchedTemplate) setBodyMd(TEMPLATE[next][locale])
  }

  function applyTemplate() {
    // 이미 쓴 내용이 있으면 덮어쓰지 않고 아래에 붙인다. 되돌리기 없는 파괴적 동작을
    // 버튼 하나에 두지 않기 위해서다.
    setBodyMd((current) => (
      current.trim() && !untouchedTemplate
        ? `${current.replace(/\s*$/, '')}\n\n${TEMPLATE[kind][locale]}`
        : TEMPLATE[kind][locale]
    ))
  }

  function restoreDraft() {
    if (!draft) return
    setTitle(draft.title)
    setBodyMd(draft.bodyMd)
    setKind(draft.kind)
    setDraft(null)
  }

  function discardDraft() {
    clearDraft(storageKey)
    setDraft(null)
  }

  function cancel() {
    // 취소는 명시적 폐기다 — 초안을 남기면 다음에 열 때 방금 버린 내용이 되살아난다.
    clearDraft(storageKey)
    setDraft(null)
    if (!topic) { onDone?.(); return }
    setTitle(snapshot.title)
    setBodyMd(snapshot.bodyMd)
    setKind(snapshot.kind)
    setMessage(null)
    setEditing(false)
  }

  async function save() {
    if (!title.trim() || !bodyMd.trim() || busy) return
    setBusy(true)
    setMessage(null)
    const result = topic
      ? await updateWikiDocument({
          projectId,
          topicId: topic.id,
          title: title.trim(),
          bodyMd,
          documentKind: kind,
          expectedUpdatedAt: snapshot.bodyUpdatedAt,
        })
      : await createWikiDocument({
          projectId,
          title: title.trim(),
          bodyMd,
          documentKind: kind,
        })
    setBusy(false)

    if (!result.ok) {
      // 충돌은 막다른 길이 아니어야 한다. 저장에 실패한 순간이 본문을 잃기 가장 쉬운
      // 지점이므로, 여기서 초안을 debounce 없이 즉시 확정해 둔다.
      if (result.conflict) writeDraft(storageKey, { title, bodyMd, kind, savedAt: new Date().toISOString() })
      setMessage({
        tone: 'error',
        text: result.conflict
          ? t(locale, 'wiki.document.conflictHint')
          : result.error ?? t(locale, 'wiki.document.saveFailed'),
      })
      return
    }

    clearDraft(storageKey)
    setDraft(null)
    trackWikiEvent(topic ? 'wiki_document_saved' : 'wiki_document_created', path, { document_kind: kind })
    if (!topic && result.topicId) {
      onDone?.()
      router.push(`/p/${projectId}/wiki/topics/${result.topicId}`)
      return
    }
    const next = {
      title: title.trim(),
      bodyMd,
      bodyUpdatedAt: result.updatedAt ?? snapshot.bodyUpdatedAt,
      kind,
    }
    setSnapshot(next)
    setTitle(next.title)
    setEditing(false)
    setMessage({ tone: 'ok', text: t(locale, 'wiki.document.saved') })
    router.refresh()
  }

  async function verify() {
    if (!topic || verifying) return
    setVerifying(true)
    setMessage(null)
    const result = await verifyWikiDocument({
      projectId,
      topicId: topic.id,
      reviewDays: 90,
      expectedUpdatedAt: snapshot.bodyUpdatedAt,
    })
    setVerifying(false)
    if (!result.ok) {
      setMessage({ tone: 'error', text: result.error ?? t(locale, 'wiki.document.verifyFailed') })
      return
    }
    trackWikiEvent('wiki_document_verified', path, { review_days: 90 })
    setMessage({ tone: 'ok', text: t(locale, 'wiki.document.verified') })
    router.refresh()
  }

  if (editing) {
    return (
      <div className="space-y-4">
        {draft && (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-pending/40 bg-pending-weak px-4 py-3">
            <p className="text-xs font-medium text-ink">
              {t(locale, 'wiki.document.draftFound')}
              {draft.savedAt && (
                <span className="ml-1.5 font-normal text-ink-muted">
                  {formatWikiDate(draft.savedAt, locale)}
                </span>
              )}
            </p>
            <div className="flex shrink-0 gap-2">
              <button type="button" onClick={restoreDraft} className="btn btn-primary h-8 px-3 text-xs">
                <RotateCcw className="h-3.5 w-3.5" aria-hidden />
                {t(locale, 'wiki.document.draftRestore')}
              </button>
              <button type="button" onClick={discardDraft} className="btn btn-ghost h-8 px-3 text-xs">
                {t(locale, 'wiki.document.draftDiscard')}
              </button>
            </div>
          </div>
        )}
        <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_190px]">
          <label className="block">
            <span className="mb-1 block text-[11px] font-semibold text-ink-muted">{t(locale, 'wiki.document.titleLabel')}</span>
            <input autoFocus={!topic} value={title} onChange={(event) => setTitle(event.target.value)} maxLength={160} className="app-input" placeholder={t(locale, 'wiki.document.titlePlaceholder')} />
          </label>
          <label className="block">
            <span className="mb-1 block text-[11px] font-semibold text-ink-muted">{t(locale, 'wiki.document.kindLabel')}</span>
            <select value={kind} onChange={(event) => changeKind(event.target.value as WikiDocumentKind)} className="app-input">
              {WIKI_DOCUMENT_KINDS.map((value) => <option key={value} value={value}>{KIND_LABEL[value][locale]}</option>)}
            </select>
          </label>
        </div>
        <label className="block">
          <span className="mb-1 flex flex-wrap items-center justify-between gap-2 text-[11px] font-semibold text-ink-muted">
            <span>{t(locale, 'wiki.document.bodyLabel')}</span>
            <span className="font-normal text-ink-subtle">{t(locale, 'wiki.document.markdownHint')}</span>
          </span>
          <textarea value={bodyMd} onChange={(event) => setBodyMd(event.target.value)} rows={18} className="app-textarea min-h-80 resize-y font-mono text-[13px] leading-6" placeholder={t(locale, 'wiki.document.bodyPlaceholder')} />
        </label>
        {/* 항상 노출한다 — 유형을 고른 뒤 한 줄이라도 쓰면 템플릿에 닿을 길이 없어져
            목차가 중요한 런북·결정 기록에서 구조를 손으로 다시 짜게 된다. */}
        <button type="button" onClick={applyTemplate} className="btn btn-ghost h-9 px-3 text-xs">
          <FilePlus2 className="h-3.5 w-3.5" aria-hidden />
          {t(locale, bodyMd.trim() && !untouchedTemplate
            ? 'wiki.document.appendTemplate'
            : 'wiki.document.applyTemplate')}
        </button>
        {message && <p role={message.tone === 'error' ? 'alert' : 'status'} className={`text-xs font-medium ${message.tone === 'error' ? 'text-delayed' : 'text-done'}`}>{message.text}</p>}
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => void save()} disabled={busy || !title.trim() || !bodyMd.trim()} className="btn btn-primary">
            <Save className="h-4 w-4" aria-hidden />
            {busy ? t(locale, 'wiki.document.saving') : t(locale, 'wiki.document.save')}
          </button>
          <button type="button" onClick={cancel} disabled={busy} className="btn btn-ghost">
            <X className="h-4 w-4" aria-hidden />
            {t(locale, 'wiki.document.cancel')}
          </button>
        </div>
      </div>
    )
  }

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2 border-b border-line pb-3">
        <span className="chip bg-brand-weak text-brand">{KIND_LABEL[snapshot.kind][locale]}</span>
        <div className="flex flex-wrap gap-2">
          {canVerify && snapshot.bodyMd.trim() && (
            <button type="button" onClick={() => void verify()} disabled={verifying} className="btn btn-ghost h-9 px-3 text-xs">
              <BadgeCheck className="h-3.5 w-3.5" aria-hidden />
              {verifying ? t(locale, 'wiki.document.verifying') : t(locale, 'wiki.document.verify')}
            </button>
          )}
          {canEdit && (
            <button type="button" onClick={() => { setMessage(null); setEditing(true) }} className="btn btn-primary h-9 px-3 text-xs">
              <Pencil className="h-3.5 w-3.5" aria-hidden />
              {snapshot.bodyMd.trim() ? t(locale, 'wiki.document.edit') : t(locale, 'wiki.document.write')}
            </button>
          )}
        </div>
      </div>
      {message && <p role={message.tone === 'error' ? 'alert' : 'status'} className={`mb-3 text-xs font-medium ${message.tone === 'error' ? 'text-delayed' : 'text-done'}`}>{message.text}</p>}
      {snapshot.bodyMd.trim() ? (
        // 읽기 폭과 크기를 본문용으로 따로 잡는다. .minutes-md 는 회의록(짧은 글) 기준이라
        // 14px·폭 무제한인데, 위키 본문은 장문이라 넓은 화면에서 한 줄이 110자를 넘는다
        // (WCAG 2.1 AAA 상한 80자, Baymard 최적 66자). max-w 는 한글이 라틴보다 글자폭이
        // 넓은 것을 감안해 ch 대신 rem 으로 잡았다 — 46rem 이면 한글 약 45자.
        // --minutes-fs 는 globals.css 가 인라인 주입을 전제로 만든 훅이라(MinuteViewer 와
        // 같은 방식) UI 위험 파일을 건드리지 않고 본문만 키울 수 있다.
        <div
          className="min-h-48 rounded-2xl border border-line/70 bg-surface px-4 py-4 sm:px-6 sm:py-5"
          style={{ '--minutes-fs': '15px' } as CSSProperties}
        >
          <div className="max-w-[46rem]">
            <MarkdownView content={snapshot.bodyMd} />
          </div>
        </div>
      ) : (
        <div className="rounded-2xl border border-dashed border-line px-5 py-10 text-center">
          <FilePlus2 className="mx-auto h-6 w-6 text-ink-subtle" aria-hidden />
          <h3 className="mt-3 text-sm font-semibold text-ink">{t(locale, 'wiki.document.emptyTitle')}</h3>
          <p className="mx-auto mt-1 max-w-md text-xs leading-5 text-ink-muted">{t(locale, 'wiki.document.emptyDesc')}</p>
          {canEdit && <button type="button" onClick={() => setEditing(true)} className="btn btn-primary mt-4">{t(locale, 'wiki.document.write')}</button>}
        </div>
      )}
    </div>
  )
}

export function WikiCreateDocumentButton({ projectId, locale }: { projectId: string; locale: Locale }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="btn btn-primary">
        <FilePlus2 className="h-4 w-4" aria-hidden />
        {t(locale, 'wiki.document.create')}
      </button>
      <Modal open={open} onClose={() => setOpen(false)} title={t(locale, 'wiki.document.create')} size="lg">
        <WikiDocumentEditor projectId={projectId} locale={locale} canEdit onDone={() => setOpen(false)} />
      </Modal>
    </>
  )
}
