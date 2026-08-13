import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  requireProjectMember: vi.fn(),
  requireProjectAdmin: vi.fn(),
  rpc: vi.fn(),
  from: vi.fn(),
  revalidatePath: vi.fn(),
}))

vi.mock('@/lib/authz', () => ({
  requireProjectMember: mocks.requireProjectMember,
  requireProjectAdmin: mocks.requireProjectAdmin,
}))
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath }))
vi.mock('@/lib/supabase/server', () => ({
  createServerClient: async () => ({ rpc: mocks.rpc, from: mocks.from }),
}))

import {
  answerWikiQuestion,
  createWikiDocument,
  createWikiQuestion,
  restoreWikiDocumentRevision,
  reviewWikiItem,
  submitWikiFeedback,
  updateWikiDocument,
  verifyWikiDocument,
} from '@/app/actions/wiki'

const MEMBER = {
  userId: 'member-1', teamCode: 'ERP', teamId: 'team-1', isSuperuser: false,
  projectRoles: new Map([['project-1', 'member']]), rosterTeams: new Map(),
}

function scopeResult(data: unknown = { id: 'topic-1' }, error: unknown = null) {
  mocks.from.mockImplementation(() => {
    const builder: Record<string, unknown> = {}
    for (const method of ['select', 'eq', 'maybeSingle']) {
      builder[method] = vi.fn(() => builder)
    }
    ;(builder as { then: (resolve: (value: unknown) => void) => void }).then = resolve => {
      resolve({ data, error })
    }
    return builder
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.requireProjectMember.mockResolvedValue({ ok: true, actor: MEMBER })
  mocks.requireProjectAdmin.mockResolvedValue({ ok: true, actor: MEMBER })
  mocks.rpc.mockResolvedValue({ data: null, error: null })
  scopeResult()
})

describe('사람이 쓰는 Wiki 문서 액션', () => {
  it('구성원이 아니면 생성 RPC에 도달하지 않는다', async () => {
    mocks.requireProjectMember.mockResolvedValue({ ok: false, error: '권한 없음' })
    const result = await createWikiDocument({
      projectId: 'project-1', title: '프로젝트 개요', bodyMd: '# 개요', documentKind: 'overview',
    })
    expect(result).toEqual({ ok: false, error: '권한 없음' })
    expect(mocks.rpc).not.toHaveBeenCalled()
  })

  it('문서 생성은 고정된 RPC 인자로 보내고 새 상세 주소를 돌려준다', async () => {
    mocks.rpc.mockResolvedValue({ data: 'topic-new', error: null })
    const result = await createWikiDocument({
      projectId: 'project-1', title: ' 프로젝트 개요 ', bodyMd: '# 개요',
      documentKind: 'overview', parentId: null,
    })
    expect(result).toEqual({ ok: true, topicId: 'topic-new' })
    expect(mocks.rpc).toHaveBeenCalledWith('create_wiki_document', {
      p_project_id: 'project-1', p_title: '프로젝트 개요', p_body_md: '# 개요',
      p_document_kind: 'overview', p_parent_id: null,
    })
    expect(mocks.revalidatePath).toHaveBeenCalledWith('/p/project-1/wiki')
  })

  it('타 프로젝트 topicId를 붙인 저장은 권한 검사와 RPC 전에 거부한다', async () => {
    scopeResult(null)
    const result = await updateWikiDocument({
      projectId: 'project-1', topicId: 'other-topic', title: '문서', bodyMd: '본문',
      documentKind: 'reference', expectedUpdatedAt: null,
    })
    expect(result.ok).toBe(false)
    expect(mocks.requireProjectMember).not.toHaveBeenCalled()
    expect(mocks.rpc).not.toHaveBeenCalled()
  })

  it('낙관적 잠금 충돌을 일반 실패와 구분한다', async () => {
    mocks.rpc.mockResolvedValue({
      data: null,
      error: { message: 'WIKI_DOCUMENT_EDIT_CONFLICT' },
    })
    const result = await updateWikiDocument({
      projectId: 'project-1', topicId: 'topic-1', title: '문서', bodyMd: '본문',
      documentKind: 'reference', expectedUpdatedAt: '2026-08-13T00:00:00Z',
    })
    expect(result.ok).toBe(false)
    expect(result.conflict).toBe(true)
    expect(result.error).toContain('다른 사람이')
  })

  it('검증 주기를 1~365일로 제한한다', async () => {
    const result = await verifyWikiDocument({
      projectId: 'project-1', topicId: 'topic-1', reviewDays: 0,
      expectedUpdatedAt: '2026-08-13T00:00:00Z',
    })
    expect(result.ok).toBe(false)
    expect(mocks.rpc).not.toHaveBeenCalled()
  })

  it('문서 검증은 사용자가 실제로 읽은 본문 수정 토큰을 함께 보낸다', async () => {
    await verifyWikiDocument({
      projectId: 'project-1', topicId: 'topic-1', reviewDays: 90,
      expectedUpdatedAt: '2026-08-13T00:00:00Z',
    })
    expect(mocks.rpc).toHaveBeenCalledWith('verify_wiki_document', {
      p_topic_id: 'topic-1', p_review_days: 90,
      p_expected_updated_at: '2026-08-13T00:00:00Z',
    })
  })

  it('이력 복원도 현재 수정 토큰을 보내고 새 버전을 받는다', async () => {
    mocks.rpc.mockResolvedValue({
      data: [{ body_updated_at: '2026-08-13T01:00:00Z', version_no: 4 }],
      error: null,
    })
    const result = await restoreWikiDocumentRevision({
      projectId: 'project-1', topicId: 'topic-1', revisionId: 'revision-2',
      expectedUpdatedAt: '2026-08-13T00:00:00Z',
    })
    expect(result).toMatchObject({ ok: true, versionNo: 4, updatedAt: '2026-08-13T01:00:00Z' })
    expect(mocks.rpc).toHaveBeenCalledWith('restore_wiki_document_revision', {
      p_topic_id: 'topic-1', p_revision_id: 'revision-2',
      p_expected_updated_at: '2026-08-13T00:00:00Z',
    })
  })
})

describe('Ask 지식 공백', () => {
  it('근거 부족 질문을 프로젝트 범위 RPC로 등록한다', async () => {
    mocks.rpc.mockResolvedValue({ data: 'question-1', error: null })
    const result = await createWikiQuestion({
      projectId: 'project-1', question: ' 야간 장애 대응 절차가 무엇인가요? ',
    })
    expect(result).toEqual({ ok: true, questionId: 'question-1' })
    expect(mocks.rpc).toHaveBeenCalledWith('create_wiki_question', {
      p_project_id: 'project-1',
      p_topic_id: null,
      p_question: '야간 장애 대응 절차가 무엇인가요?',
    })
  })

  it('작은 품질 피드백은 프로젝트를 topic에서 다시 확인한 뒤 RPC로 보낸다', async () => {
    mocks.rpc.mockResolvedValue({ data: 'feedback-1', error: null })
    const result = await submitWikiFeedback({
      projectId: 'project-1', topicId: 'topic-1', kind: 'outdated', comment: '절차가 바뀌었습니다.',
    })
    expect(result).toEqual({ ok: true, feedbackId: 'feedback-1' })
    expect(mocks.rpc).toHaveBeenCalledWith('submit_wiki_feedback', {
      p_topic_id: 'topic-1', p_kind: 'outdated', p_comment: '절차가 바뀌었습니다.',
    })
  })

  it('구성원 답변은 질문 소속을 확인하고 프로젝트 범위에서 닫는다', async () => {
    const result = await answerWikiQuestion({
      projectId: 'project-1', questionId: 'question-1', answerMd: '당직자가 먼저 복구합니다.',
      topicId: 'topic-1',
    })
    expect(result).toEqual({ ok: true })
    expect(mocks.rpc).toHaveBeenCalledWith('answer_wiki_question', {
      p_question_id: 'question-1', p_answer: '당직자가 먼저 복구합니다.', p_topic_id: 'topic-1',
    })
  })

  it('AI 제안 승인은 관리자 가드를 통과한 항목만 RPC로 보낸다', async () => {
    const result = await reviewWikiItem({
      projectId: 'project-1', topicId: 'topic-1', itemId: 'item-1', reviewState: 'accepted',
    })
    expect(result).toEqual({ ok: true })
    expect(mocks.requireProjectAdmin).toHaveBeenCalledWith('project-1')
    expect(mocks.rpc).toHaveBeenCalledWith('review_wiki_item', {
      p_item_id: 'item-1', p_review_state: 'accepted',
    })
  })
})
