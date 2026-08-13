'use client'

import dynamic from 'next/dynamic'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { BadgeCheck, FilePlus2, Pencil, Save, X } from 'lucide-react'
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
  const [title, setTitle] = useState(snapshot.title)
  const [bodyMd, setBodyMd] = useState(snapshot.bodyMd)
  const [kind, setKind] = useState<WikiDocumentKind>(snapshot.kind)
  const [editing, setEditing] = useState(!topic)
  const [busy, setBusy] = useState(false)
  const [verifying, setVerifying] = useState(false)
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null)

  const path = topic
    ? `/p/${projectId}/wiki/topics/${topic.id}`
    : `/p/${projectId}/wiki`

  function changeKind(next: WikiDocumentKind) {
    setKind(next)
    if (!bodyMd.trim()) setBodyMd(TEMPLATE[next][locale])
  }

  function cancel() {
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
      setMessage({ tone: 'error', text: result.error ?? t(locale, 'wiki.document.saveFailed') })
      return
    }

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
        {!bodyMd.trim() && (
          <button type="button" onClick={() => setBodyMd(TEMPLATE[kind][locale])} className="btn btn-ghost h-9 px-3 text-xs">
            <FilePlus2 className="h-3.5 w-3.5" aria-hidden />
            {t(locale, 'wiki.document.applyTemplate')}
          </button>
        )}
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
        <div className="min-h-48 rounded-2xl border border-line/70 bg-surface px-4 py-4 sm:px-6 sm:py-5">
          <MarkdownView content={snapshot.bodyMd} />
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
