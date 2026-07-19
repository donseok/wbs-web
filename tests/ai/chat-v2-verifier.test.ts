import { describe, expect, it } from 'vitest'
import { verifyBotSources, verifyGroundedClaims, verifySynthesizedAnswer } from '@/lib/ai/chat/verifier'
import { buildEvidencePack, type EvidencePack } from '@/lib/ai/chat/evidence'
import { deterministicEvidenceAnswer } from '@/lib/ai/chat/orchestrator'

function source(id: string, entityId: string) {
  return {
    id, domain: 'wbs' as const, entityType: 'wbs_item' as const, entityId, projectId: 'p1',
    title: `작업 ${entityId}`, href: `/p/p1/wbs?focus=${entityId}`, updatedAt: null,
  }
}

describe('chat v2 source and answer verifier', () => {
  it('drops external, cross-project, and forged focus links', () => {
    const base = {
      domain: 'wbs' as const, entityType: 'wbs_item' as const, entityId: 'a', projectId: 'p1',
      title: '작업 A', updatedAt: null,
    }
    const result = verifyBotSources([
      { ...base, id: 'safe', href: '/p/p1/wbs?focus=a' },
      { ...base, id: 'external', href: 'https://evil.example/a' },
      { ...base, id: 'wrong-project', projectId: 'p2', href: '/p/p2/wbs?focus=a' },
      { ...base, id: 'wrong-focus', href: '/p/p1/wbs?focus=b' },
    ], { allowedProjectIds: ['p1'] })
    expect(result.sources.map(s => s.id)).toEqual(['safe'])
    expect(result.warnings).toHaveLength(3)
  })

  it('reports malformed runtime sources instead of throwing during verification', () => {
    const result = verifyBotSources([
      null as never,
      { ...source('bad-excerpt', 'bad-excerpt'), excerpt: 123 } as never,
      source('safe', 'safe'),
    ], { allowedProjectIds: ['p1'] })

    expect(result.sources.map(item => item.id)).toEqual(['safe'])
    expect(result.warnings).toHaveLength(2)
  })

  it('rejects invented citations and accepts a grounded citation', () => {
    const pack = buildEvidencePack([{
      callId: 'c1', tool: 'find_wbs_items',
      result: {
        status: 'ok', facts: { total: 1 }, records: [{ name: '설계' }],
        sources: [{
          id: 'local', domain: 'wbs', entityType: 'wbs_item', entityId: 'a', projectId: 'p1',
          title: '설계', href: '/p/p1/wbs?focus=a', updatedAt: null,
        }],
        asOf: '2026-07-19T00:00:00.000Z', truncated: false, warnings: [],
      },
    }])
    expect(verifySynthesizedAnswer('설계 작업입니다. [S9]', pack).ok).toBe(false)
    expect(verifySynthesizedAnswer('설계 작업입니다. [S1]', pack)).toMatchObject({ ok: true })
  })

  it('keeps separately qualified occurrences and anchors during source deduplication', () => {
    const base = {
      domain: 'meetings' as const, entityType: 'meeting_occurrence' as const,
      entityId: 'series-a', projectId: 'p1', title: '주간회의', href: '/p/p1/meetings', updatedAt: null,
    }
    const result = verifyBotSources([
      { ...base, id: 'occ-1', qualifier: { occurrenceDate: '2026-07-19' } },
      { ...base, id: 'occ-1-copy', qualifier: { occurrenceDate: '2026-07-19' } },
      { ...base, id: 'occ-2', qualifier: { occurrenceDate: '2026-07-20' } },
      { ...base, id: 'anchor-a', qualifier: { occurrenceDate: '2026-07-20', anchor: 'agenda' } },
    ], { allowedProjectIds: ['p1'] })

    expect(result.sources.map(item => item.id)).toEqual(['occ-1', 'occ-2', 'anchor-a'])
  })

  it('detects Korean-unit and Korean-date claims followed by particles', () => {
    const pack = buildEvidencePack([{
      callId: 'c1', tool: 'find_wbs_items',
      result: {
        status: 'ok',
        facts: { totalMatched: 3 },
        records: [{ id: 'a', actualPct: 30, delayDays: 2, durationMinutes: 10, date: '2026-07-19' }],
        sources: [source('local-a', 'a')],
        asOf: '2026-07-19T00:00:00.000Z', truncated: false, warnings: [],
      },
    }])

    expect(verifySynthesizedAnswer(
      '총 3건이며 진척률은 30%이고 지연은 2일간, 소요는 10분입니다. [S1]\n일정은 7월 19일에 있습니다. [S1]',
      pack,
    )).toMatchObject({ ok: true })

    for (const answer of ['4건의 작업 [S1]', '31%입니다 [S1]', '3일간 지연 [S1]', '11분입니다 [S1]', '7월 20일에 진행 [S1]']) {
      expect(verifySynthesizedAnswer(answer, pack).ok, answer).toBe(false)
    }
  })

  it('does not ground claims from F/S labels or numeric UUID fragments', () => {
    const pack = buildEvidencePack([{
      callId: 'c1', tool: 'find_wbs_items',
      result: {
        status: 'ok', facts: { projectFound: true },
        records: [{ id: '30f10000-0000-4000-8000-000000000001', name: '설계' }],
        sources: [source('local', '30f10000-0000-4000-8000-000000000001')],
        asOf: '2026-07-19T00:00:00.000Z', truncated: false, warnings: [],
      },
    }])

    expect(verifySynthesizedAnswer('1건입니다 [S1]', pack).ok).toBe(false)
    expect(verifySynthesizedAnswer('진척률은 30%입니다 [S1]', pack).ok).toBe(false)
  })

  it('binds a numeric fact to the cited tool source', () => {
    const pack = buildEvidencePack([
      {
        callId: 'c1', tool: 'find_wbs_items',
        result: {
          status: 'ok', facts: { totalMatched: 3 }, records: [], sources: [source('local-a', 'a')],
          asOf: '2026-07-19T00:00:00.000Z', truncated: false, warnings: [],
        },
      },
      {
        callId: 'c2', tool: 'find_wbs_items',
        result: {
          status: 'ok', facts: { totalMatched: 4 }, records: [], sources: [source('local-b', 'b')],
          asOf: '2026-07-19T00:00:00.000Z', truncated: false, warnings: [],
        },
      },
    ])

    expect(verifySynthesizedAnswer('3건입니다 [S1]', pack).ok).toBe(true)
    expect(verifySynthesizedAnswer('3건입니다 [S2]', pack).ok).toBe(false)
    expect(verifySynthesizedAnswer('3건 [S2], 4건 [S1]입니다.', pack).ok).toBe(false)
    expect(verifySynthesizedAnswer('3건 [S1], 4건 [S2]입니다.', pack).ok).toBe(true)
  })

  it('narrows record claims to the record entity source within a shared tool call', () => {
    const pack = buildEvidencePack([{
      callId: 'c1', tool: 'find_wbs_items',
      result: {
        status: 'ok', facts: {}, records: [{ id: 'a', actualPct: 30 }, { id: 'b', actualPct: 40 }],
        sources: [source('local-a', 'a'), source('local-b', 'b')],
        asOf: '2026-07-19T00:00:00.000Z', truncated: false, warnings: [],
      },
    }])

    expect(verifySynthesizedAnswer('진척률은 30%입니다 [S1]', pack).ok).toBe(true)
    expect(verifySynthesizedAnswer('진척률은 30%입니다 [S2]', pack).ok).toBe(false)
    expect(pack.records.map(record => record.sourceIds)).toEqual([['S1'], ['S2']])
  })

  it('narrows a meetingId-only record to its own source inside the verifier', () => {
    const meetingSource = (id: string, entityId: string) => ({
      id, domain: 'meetings' as const, entityType: 'meeting' as const, entityId,
      projectId: 'p1', title: `회의 ${entityId}`, href: '/p/p1/meetings', updatedAt: null,
    })
    // buildEvidencePack의 좁힘을 거치지 않은 광역 sourceIds 팩 — verifier가 evidence와 동일한
    // 결속 규칙(meetingId 포함)을 쓰는지 검증한다(리뷰 M-2 회귀).
    const pack: EvidencePack = {
      facts: [],
      records: [{
        id: 'R1', tool: 'get_meeting_detail',
        value: { meetingId: 'm1', durationMinutes: 30 }, sourceIds: ['S1', 'S2'],
      }],
      sources: [meetingSource('S1', 'm1'), meetingSource('S2', 'm2')],
      asOf: '2026-07-19T00:00:00.000Z', truncated: false, warnings: [],
      tools: ['get_meeting_detail'], partialTools: [],
    }

    expect(verifySynthesizedAnswer('소요는 30분입니다. [S1]', pack).ok).toBe(true)
    expect(verifySynthesizedAnswer('소요는 30분입니다. [S2]', pack).ok).toBe(false)
  })

  it('keeps verification behavior on a large pack with precomputed leaf claims', () => {
    // 리뷰 M-8: leaf당 1회 주장 추출 캐시가 결과를 바꾸지 않는지(동작 동일성만) 확인한다.
    const records = Array.from({ length: 300 }, (_, i) => ({
      id: 'a',
      name: `설계 세부 ${i}`,
      plannedEnd: '2026-08-01',
      durationMinutes: 45,
    }))
    const pack = buildEvidencePack([{
      callId: 'c1', tool: 'find_wbs_items',
      result: {
        status: 'ok', facts: { totalMatched: 300 }, records, sources: [source('local-a', 'a')],
        asOf: '2026-07-19T00:00:00.000Z', truncated: false, warnings: [],
      },
    }])

    expect(verifySynthesizedAnswer(
      '총 300건이며 완료 예정일은 2026-08-01, 소요는 45분입니다. [S1]',
      pack,
    )).toMatchObject({ ok: true })
    expect(verifySynthesizedAnswer('총 301건입니다. [S1]', pack).ok).toBe(false)
    expect(verifySynthesizedAnswer('완료 예정일은 2026-08-02입니다. [S1]', pack).ok).toBe(false)
  })

  it('binds weekly comparison records by section/module and caps deterministic citations', () => {
    const weeklySource = (id: string, entityId: string, title: string) => ({
      id, domain: 'weekly' as const, entityType: 'weekly_row' as const,
      entityId, projectId: 'p1', title, href: '/p/p1/weekly', updatedAt: null,
    })
    const pack = buildEvidencePack([{
      callId: 'c1', tool: 'compare_weekly_sheets',
      result: {
        status: 'ok', facts: { totalCompared: 2 },
        records: [
          { section: 'ERP', module: 'FI', change: 'changed' },
          { section: 'MES', module: '품질', change: 'added' },
        ],
        sources: [
          weeklySource('a-old', 'a-old', 'ERP · FI'),
          weeklySource('a-new', 'a-new', 'ERP · FI'),
          weeklySource('b-old', 'b-old', 'MES · 품질'),
          weeklySource('b-new', 'b-new', 'MES · 품질'),
        ],
        asOf: '2026-07-19T00:00:00.000Z', truncated: false, warnings: [],
      },
    }])

    expect(pack.records.map(record => record.sourceIds)).toEqual([
      ['S1', 'S2'],
      ['S3', 'S4'],
    ])
    const answer = deterministicEvidenceAnswer(pack)
    const citedLine = answer.split('\n').find(line => line.includes('[S1]')) ?? ''
    expect(citedLine).toContain('[S1][S2][S3]')
    expect(citedLine).not.toContain('[S4]')
  })

  it('grounds an attendance person count with the memberCount fact', () => {
    const pack = buildEvidencePack([{
      callId: 'c1', tool: 'get_attendance',
      result: {
        status: 'ok', facts: { memberCount: 2 }, records: [], sources: [source('local', 'a')],
        asOf: '2026-07-19T00:00:00.000Z', truncated: false, warnings: [],
      },
    }])
    expect(verifySynthesizedAnswer('대상자는 2명입니다. [S1]', pack).ok).toBe(true)
  })

  it('supports natural attendance, meeting, and attendee count units', () => {
    const packFor = (tool: string, facts: Record<string, number>) => buildEvidencePack([{
      callId: 'c1', tool,
      result: {
        status: 'ok' as const, facts, records: [], sources: [source('local', 'a')],
        asOf: '2026-07-19T00:00:00.000Z', truncated: false, warnings: [],
      },
    }])

    expect(verifySynthesizedAnswer(
      '휴가자는 2명입니다. [S1]',
      packFor('get_attendance', { totalMatched: 2, returned: 2 }),
    ).ok).toBe(true)
    expect(verifySynthesizedAnswer(
      '예정 회의는 2회입니다. [S1]',
      packFor('list_meetings', { totalMatched: 2 }),
    ).ok).toBe(true)
    expect(verifySynthesizedAnswer(
      '참석자는 2명입니다. [S1]',
      packFor('get_meeting_detail', { attendeeCount: 2 }),
    ).ok).toBe(true)
  })

  it('requires every explicitly bound fact to match without substring grounding', () => {
    const pack = buildEvidencePack([{
      callId: 'c1', tool: 'find_wbs_items',
      result: {
        status: 'ok', facts: { totalMatched: 10, returned: 1 }, records: [], sources: [source('local', 'a')],
        asOf: '2026-07-19T00:00:00.000Z', truncated: false, warnings: [],
      },
    }])
    const [ten, one] = pack.facts

    expect(verifyGroundedClaims([{
      text: '1건', kind: 'count', value: 1, unit: '건', sourceFactIds: [ten.id],
    }], pack).invalid).toHaveLength(1)
    expect(verifyGroundedClaims([{
      text: '1건', kind: 'count', value: 1, unit: '건', sourceFactIds: [one.id],
    }], pack).valid).toHaveLength(1)
    expect(verifyGroundedClaims([{
      text: '1건', kind: 'count', value: 1, unit: '건', sourceFactIds: [one.id, ten.id],
    }], pack).invalid).toHaveLength(1)
  })
})
