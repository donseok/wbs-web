import { describe, it, expect } from 'vitest'
import { meetingBodyOf } from '@/lib/domain/minutes'

describe('meetingBodyOf — 노이즈 토큰 제거', () => {
  it.each([
    // 스펙 예시 표 10케이스
    ['물류공정_260716_2026-07-16', '물류공정'],
    ['공정조_2026.07.16_2026-07-16', '공정조'],
    ['주간회의 260716', '주간회의'],
    ['주간정례_12차_260716', '주간정례'],
    ['물류공정_7.16(수)', '물류공정'],
    ['260716_주간회의', '주간회의'],
    ['PMO_260716_물류공정회의', 'PMO 물류공정회의'],
    ['물류공정_킥오프', '물류공정 킥오프'],
    ['7월 주간회의 메모', '7월 주간회의 메모'],
    ['2026-07-16', '2026-07-16'],
  ])('%s → %s', (title, expected) => {
    expect(meetingBodyOf(title)).toBe(expected)
  })

  it.each([
    // 노이즈 변형
    ['정산_2026-07-16(금)', '정산'],   // 요일 괄호 붙은 연월일
    ['정산_26.07.16', '정산'],         // 2자리 연도
    ['정산_2026/07/16', '정산'],       // 슬래시 구분
    ['정산_제3차', '정산'],            // 제N차
    ['정산_(5차)', '정산'],            // 괄호 회차
    ['정산_7.16 (수)', '정산'],        // 요일 괄호 단독 토큰
    ['정산_20260716', '정산'],         // 8자리
    ['정산_2026.07', '정산'],          // 연월만
  ])('노이즈 변형 %s → %s', (title, expected) => {
    expect(meetingBodyOf(title)).toBe(expected)
  })

  it('앞뒤 공백은 trim된다', () => {
    expect(meetingBodyOf('  물류공정_260716  ')).toBe('물류공정')
  })
  it('혼합 구분자(_와 공백)는 동일 취급', () => {
    expect(meetingBodyOf('물류 공정_260716 결과')).toBe('물류 공정 결과')
  })
  it('공백만 있는 제목은 빈 문자열', () => {
    expect(meetingBodyOf('   ')).toBe('')
  })
})

import { buildMinutesTree } from '@/lib/domain/minutes'
import type { Minute, TeamCode } from '@/lib/domain/types'

// 헬퍼 — 목록 조회 shape(bodyMd 빈 문자열). 입력은 minute_date desc 정렬로 넘긴다.
const minute = (id: string, date: string, team: TeamCode, title: string): Minute => ({
  id, minuteDate: date, teamCode: team, title, bodyMd: '',
  meetingId: null, createdBy: null, createdByName: `작성자${id}`,
  createdAt: `${date}T09:00:00Z`, updatedAt: `${date}T09:00:00Z`, fileCount: 1,
})

describe('buildMinutesTree', () => {
  it('구분→회의체→리프로 그룹핑하고 동일 이름을 병합한다', () => {
    const tree = buildMinutesTree([
      minute('a', '2026-07-16', 'MES', '물류공정_260716'),
      minute('b', '2026-07-09', 'MES', '물류공정_260709'),
      minute('c', '2026-07-15', 'MES', '공정조_260715'),
    ])
    expect(tree).toHaveLength(1)
    expect(tree[0].teamCode).toBe('MES')
    expect(tree[0].count).toBe(3)
    expect(tree[0].bodies.map(b => b.name)).toEqual(['물류공정', '공정조'])
    expect(tree[0].bodies[0].count).toBe(2)
    expect(tree[0].bodies[0].leaves.map(l => l.id)).toEqual(['a', 'b']) // 입력 순서 보존
  })

  it('팀 그룹은 TEAM_CODES 순서(PMO→ERP→MES→가공), 0건 팀은 미포함', () => {
    const tree = buildMinutesTree([
      minute('a', '2026-07-16', 'MES', 'X_260716'),
      minute('b', '2026-07-16', 'PMO', 'Y_260716'),
    ])
    expect(tree.map(g => g.teamCode)).toEqual(['PMO', 'MES'])
  })

  it('미지 팀 코드는 버리지 않고 TEAM_CODES 뒤에 등장 순으로 붙인다', () => {
    const rows = [
      { ...minute('a', '2026-07-16', 'MES', 'X_260716'), teamCode: '레거시' as TeamCode },
      minute('b', '2026-07-15', 'PMO', 'Y_260715'),
    ]
    const tree = buildMinutesTree(rows)
    expect(tree.map(g => String(g.teamCode))).toEqual(['PMO', '레거시'])
  })

  it('회의체는 latestDate desc 정렬, 동률이면 첫 등장 순', () => {
    const tree = buildMinutesTree([
      minute('a', '2026-07-16', 'MES', '나중등장동률_260716'), // 첫 등장
      minute('b', '2026-07-16', 'MES', '두번째동률_260716'),
      minute('c', '2026-07-10', 'MES', '오래된_260710'),
    ])
    expect(tree[0].bodies.map(b => b.name)).toEqual(['나중등장동률', '두번째동률', '오래된'])
    expect(tree[0].bodies[0].latestDate).toBe('2026-07-16')
  })

  it('리프는 fileCount·createdByName을 담고 자체 재정렬하지 않는다', () => {
    const tree = buildMinutesTree([minute('a', '2026-07-16', 'ERP', '정산_260716')])
    const leaf = tree[0].bodies[0].leaves[0]
    expect(leaf).toEqual({
      id: 'a', minuteDate: '2026-07-16', title: '정산_260716',
      fileCount: 1, createdByName: '작성자a',
    })
  })

  it('빈 입력은 빈 배열', () => {
    expect(buildMinutesTree([])).toEqual([])
  })

  it('미지 팀 코드가 여럿이면 등장 순서를 유지한다', () => {
    const rows = [
      { ...minute('a', '2026-07-16', 'MES', 'X_260716'), teamCode: '레거시B' as TeamCode },
      { ...minute('b', '2026-07-15', 'MES', 'Y_260715'), teamCode: '레거시A' as TeamCode },
    ]
    const tree = buildMinutesTree(rows)
    expect(tree.map(g => String(g.teamCode))).toEqual(['레거시B', '레거시A'])
  })

  it('팀이 다르면 같은 회의체 이름이라도 병합되지 않는다', () => {
    const tree = buildMinutesTree([
      minute('a', '2026-07-16', 'PMO', '정산_260716'),
      minute('b', '2026-07-15', 'ERP', '정산_260715'),
    ])
    expect(tree.map(g => g.teamCode)).toEqual(['PMO', 'ERP'])
    expect(tree[0].bodies[0].name).toBe('정산')
    expect(tree[1].bodies[0].name).toBe('정산')
    expect(tree[0].bodies[0].count).toBe(1)
    expect(tree[1].bodies[0].count).toBe(1)
  })
})
