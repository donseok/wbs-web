import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import type { DashboardIssue } from '@/lib/domain/issueDashboard'

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a>,
}))

import { registerEn } from '@/lib/i18n/dict'
import { EN } from '@/lib/i18n/dict/en'
import { IssueStatusCard } from '@/components/dashboard/IssueStatusCard'

// 영문 단언이 한국어 폴백으로 통과하지 않게 — 서버(i18n/server)가 하는 EN 등록을 테스트에서도 한다.
registerEn(EN)
import { IssueTrendCard } from '@/components/dashboard/IssueTrendCard'
import { IssueQueueCard } from '@/components/dashboard/IssueQueueCard'

const TODAY = '2026-08-28'
/** 태그를 벗긴 텍스트 — 클래스명 안의 숫자(text-[10px] 등)가 단언을 오염시키지 않게. */
const textOf = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ')
let seq = 0
function issue(over: Partial<DashboardIssue> = {}): DashboardIssue {
  seq += 1
  return {
    id: `i${seq}`, issueNo: seq, piIssueCode: `PI-00-${String(seq).padStart(3, '0')}`, megaCode: '00',
    title: `이슈 ${seq}`, status: 'open', severity: 'medium', dueDate: null, resolvedAt: null,
    createdAt: '2026-07-01T00:00:00+00:00', ...over,
  }
}

// 상태 4종·Mega 3영역·미분류·지연·임박·최근 해결이 한 번에 드러나는 표본
const ISSUES: DashboardIssue[] = [
  issue({ id: 'ov14', title: '작업지시 실적 수기 입력 지연', megaCode: '05', severity: 'high', dueDate: '2026-08-14' }),
  issue({ id: 'ov3', title: '설계KEY 자동 채움 규칙', megaCode: '00', severity: 'high', dueDate: '2026-08-25', status: 'in_progress' }),
  issue({ id: 'd0', title: '오늘 마감 이슈', megaCode: '03', dueDate: '2026-08-28' }),
  issue({ id: 'hold', title: '보류 이슈', megaCode: '00', status: 'on_hold' }),
  issue({ id: 'res', title: '해결 이슈', megaCode: '03', status: 'resolved', resolvedAt: '2026-08-26T00:00:00+00:00', dueDate: '2026-08-01' }),
  issue({ id: 'none', title: '미분류 이슈', megaCode: null, piIssueCode: null, issueNo: 99 }),
]

describe('IssueStatusCard', () => {
  it('KPI(미해결·지연·심각·최근 7일 해결)와 상태 범례 건수를 표시한다', () => {
    const html = renderToStaticMarkup(<IssueStatusCard issues={ISSUES} projectId="p1" today={TODAY} locale="ko" />)
    expect(html).toContain('이슈 현황')
    const text = textOf(html)
    expect(text).toContain('전체 6건')
    // 히어로 링 = 해결률 1/6 → 17%
    expect(text).toMatch(/17% 해결률/)
    // 미해결 5 · 지연 2(ov14, ov3) · 심각 미해결 2 · 최근 7일 해결 1
    expect(text).toMatch(/미해결 5 /)
    expect(text).toMatch(/지연 2 /)
    expect(text).toMatch(/심각 · 미해결 2 /)
    expect(text).toMatch(/최근 7일 해결 1 /)
    // 범례: 열림 3 · 진행중 1 · 보류 1 · 해결 1
    expect(text).toMatch(/열림 3 /)
    expect(text).toMatch(/보류 1 /)
  })

  it('Mega 8영역을 코드순으로 전부 미니 링 타일로 그리고, 이슈 없는 영역은 –·이슈 없음, 미분류 타일은 마지막', () => {
    const html = renderToStaticMarkup(<IssueStatusCard issues={ISSUES} projectId="p1" today={TODAY} locale="ko" />)
    const order = ['기준관리', '손익관리', '영업', '품질·설계', '생산계획', '조업', '출하', '원가', '미분류']
    const idx = order.map(n => html.indexOf(n))
    expect(idx.every(i => i >= 0)).toBe(true)
    expect([...idx].sort((a, b) => a - b)).toEqual(idx)
    const text = textOf(html)
    // 품질·설계: 2건 중 해결 1 → 링 50%
    expect(text).toMatch(/품질·설계 2건 · 해결 1/)
    expect(text).toMatch(/50% 03 품질·설계/)
    // 손익관리: 이슈 없음 → 링 자리 – + '이슈 없음'
    expect(text).toMatch(/– 01 손익관리 이슈 없음/)
    // 상태 점 — 열림 3건이면 열림 색 점 3개(타일 합계)
    expect((html.match(/data-dot="open"/g) ?? []).length).toBe(3)
  })

  it('타일의 상태 점은 14개까지만 찍고 나머지는 +N 으로 알린다', () => {
    const many = Array.from({ length: 20 }, () => issue({ megaCode: '05' }))
    const html = renderToStaticMarkup(<IssueStatusCard issues={many} projectId="p1" today={TODAY} locale="ko" />)
    expect((html.match(/data-dot="open"/g) ?? []).length).toBe(14)
    expect(textOf(html)).toContain('+6')
  })

  it('카드 제목 액션이 이슈관리 페이지로 링크된다', () => {
    const html = renderToStaticMarkup(<IssueStatusCard issues={ISSUES} projectId="p1" today={TODAY} locale="ko" />)
    expect(html).toContain('href="/p/p1/issues"')
  })

  it('캡션 기준일은 다른 날짜와 같은 서식(26.08.28)', () => {
    const html = renderToStaticMarkup(<IssueStatusCard issues={ISSUES} projectId="p1" today={TODAY} locale="ko" />)
    expect(html).toContain('기준일 26.08.28')
    expect(html).not.toContain('기준일 2026-08-28')
  })

  it('이슈 0건이면 빈 상태 문구만 — KPI 타일을 그리지 않는다', () => {
    const html = renderToStaticMarkup(<IssueStatusCard issues={[]} projectId="p1" today={TODAY} locale="ko" />)
    expect(html).toContain('등록된 이슈가 없습니다')
    expect(html).not.toContain('최근 7일 해결')
  })

  it('영문 로케일에서는 Mega 영문명과 영문 사전을 쓴다(한국어 폴백 없음)', () => {
    const html = renderToStaticMarkup(<IssueStatusCard issues={ISSUES} projectId="p1" today={TODAY} locale="en" />)
    expect(html).toContain('Master Data')
    expect(html).toContain('Total 6 items')
    expect(textOf(html)).not.toMatch(/[가-힣]/)
  })

  it('타일 상태 점은 ISSUE_STATUSES 순(열림→진행중→해결→보류)이고 title·sr-only 가 건수를 글로 나른다', () => {
    const html = renderToStaticMarkup(<IssueStatusCard issues={ISSUES} projectId="p1" today={TODAY} locale="ko" />)
    // 00 기준관리 타일 = 진행중 1(ov3) + 보류 1(hold)
    const tile = html.slice(html.indexOf('title="기준관리:'), html.indexOf('title="손익관리:'))
    expect([...tile.matchAll(/data-dot="([a-z_]+)"/g)].map(m => m[1])).toEqual(['in_progress', 'on_hold'])
    expect(tile).toContain('title="기준관리: 진행중 1 · 보류 1"')
    expect(tile).toContain('<span class="sr-only">진행중 1 · 보류 1</span>')
    // 전체 점 = 이슈 6건(미분류 포함)
    expect((html.match(/data-dot="/g) ?? []).length).toBe(6)
  })
})

describe('IssueTrendCard', () => {
  it('SVG 접근성 라벨에 등록·해결·미해결 끝값을 담고, 끝점 라벨은 미해결 잔량 하나', () => {
    const html = renderToStaticMarkup(<IssueTrendCard issues={ISSUES} today={TODAY} locale="ko" />)
    expect(html).toContain('<svg')
    expect(html).toMatch(/aria-label="[^"]*등록 누적 6[^"]*해결 누적 1[^"]*미해결 5/)
    // 끝점 라벨은 svg text 로(aria 가 아니라) 그려진다
    expect(html).toMatch(/<text[^>]*>미해결 5<\/text>/)
    // 면(area) = 미해결 잔량 — 그라데이션 채움을 참조하는 닫힌 path, 등록 누적은 점선
    expect(html).toMatch(/<path d="M[^"]+ Z" fill="url\(#issue-backlog-wash\)"/)
    expect(html).toMatch(/<path[^>]*class="stroke-ink-muted"[^>]*stroke-dasharray="3 3"/)
  })

  it('이번 주 등록·해결·미해결 잔량 타일을 붙인다', () => {
    const html = renderToStaticMarkup(<IssueTrendCard issues={ISSUES} today={TODAY} locale="ko" />)
    const text = textOf(html)
    // 표본: 이번 주(8.24~) 등록 0 · 해결 1(26일) · 잔량 5
    expect(text).toMatch(/이번 주 등록 0 건/)
    expect(text).toMatch(/이번 주 해결 1 건/)
    expect(text).toMatch(/미해결 잔량 5 건/)
  })

  it('x축에 첫 주와 마지막 주 시작일을 표기한다(12주)', () => {
    const html = renderToStaticMarkup(<IssueTrendCard issues={ISSUES} today={TODAY} locale="ko" />)
    expect(html).toContain('26.06.08')
    expect(html).toContain('26.08.24')
  })

  it('전량 해결(백로그 0)이어도 미해결 라벨은 축 위에 남고 면은 그려지지 않는다', () => {
    const allResolved = Array.from({ length: 10 }, () => issue({ status: 'resolved', resolvedAt: '2026-08-20T00:00:00+00:00' }))
    const html = renderToStaticMarkup(<IssueTrendCard issues={allResolved} today={TODAY} locale="ko" />)
    expect(html).toContain('미해결 0')
    expect(html).toContain('<linearGradient')
  })

  it('건수가 커도 y축 눈금은 8개를 넘지 않는다(눈금 겹침 방지)', () => {
    const many = Array.from({ length: 1000 }, () => issue())
    const html = renderToStaticMarkup(<IssueTrendCard issues={many} today={TODAY} locale="ko" />)
    const ticks = (html.match(/text-anchor="end" font-size="9"/g) ?? []).length
    expect(ticks).toBeLessThanOrEqual(8)
    expect(ticks).toBeGreaterThanOrEqual(3)
  })

  it('차트 아래에 최근 6주 주간 표(등록·해결·미해결)를 붙인다 — 차트의 표 쌍', () => {
    const html = renderToStaticMarkup(<IssueTrendCard issues={ISSUES} today={TODAY} locale="ko" />)
    expect(html).toContain('<table')
    expect((html.match(/<tr/g) ?? []).length).toBe(7) // 헤더 1 + 6주
    expect(html).toContain('최근 6주')
    // 마지막 주(8.24~8.30) 행: 등록 0 · 해결 1(26일) · 미해결 5 — 표 본문만 본다(축 라벨·타일 구간 제외)
    const table = html.slice(html.indexOf('<table'), html.indexOf('</table>'))
    const lastRow = textOf(table.slice(table.lastIndexOf('<tr')))
    expect(lastRow).toMatch(/^ ?26\.08\.24 0 1 5 ?$/)
  })

  it('이슈 0건이면 차트 대신 빈 상태', () => {
    const html = renderToStaticMarkup(<IssueTrendCard issues={[]} today={TODAY} locale="ko" />)
    expect(html).not.toContain('viewBox="0 0 640')  // 헤더 아이콘도 svg 라 차트 svg 만 본다
    expect(html).toContain('등록된 이슈가 없습니다')
  })
})

describe('IssueQueueCard', () => {
  it('지연(경과 많은 순) → 임박 순으로 focus 딥링크 행을 그린다', () => {
    const html = renderToStaticMarkup(<IssueQueueCard issues={ISSUES} projectId="p1" today={TODAY} locale="ko" />)
    const hrefs = [...html.matchAll(/href="([^"]+)"/g)].map(m => m[1]).filter(h => h.includes('focus='))
    expect(hrefs).toEqual(['/p/p1/issues?focus=ov14', '/p/p1/issues?focus=ov3', '/p/p1/issues?focus=d0'])
    expect(html).toContain('14일 지연')
    expect(html).toContain('3일 지연')
    expect(html).toContain('오늘 마감')
  })

  it('배지는 지연·마감임박 건수, 미분류 이슈는 #번호로 표기', () => {
    const html = renderToStaticMarkup(<IssueQueueCard issues={[...ISSUES, issue({ id: 'n2', megaCode: null, piIssueCode: null, issueNo: 77, dueDate: '2026-08-29' })]} projectId="p1" today={TODAY} locale="ko" />)
    expect(html).toContain('지연 2 · 마감임박 2')
    expect(html).toContain('#77')
    expect(html).toContain('D-1')
  })

  it('행 aria-label 에 심각도와 마감일이 들어간다(색·위치 없이도 읽히게)', () => {
    const html = renderToStaticMarkup(<IssueQueueCard issues={ISSUES} projectId="p1" today={TODAY} locale="ko" />)
    expect(html).toMatch(/aria-label="PI-00-001 작업지시 실적 수기 입력 지연, 높음, 14일 지연, 26\.08\.14"/)
  })

  it('상한을 넘으면 +N 과 이슈관리 링크를 보인다 — 조용히 자르지 않는다', () => {
    const many = Array.from({ length: 7 }, (_, i) => issue({ dueDate: `2026-08-${String(10 + i).padStart(2, '0')}` }))
    const html = renderToStaticMarkup(<IssueQueueCard issues={many} projectId="p1" today={TODAY} locale="ko" />)
    expect((html.match(/focus=/g) ?? []).length).toBe(5)
    expect(html).toContain('+2')
    expect(html).toContain('href="/p/p1/issues"')
  })

  it('해당 이슈가 없으면 안내 문구', () => {
    const html = renderToStaticMarkup(<IssueQueueCard issues={[issue()]} projectId="p1" today={TODAY} locale="ko" />)
    expect(html).toContain('기한이 지났거나')
    expect(html).not.toContain('focus=')
  })
})
