/**
 * scripts/wbs/build-xlsx.mjs 가 만든 파일이 **앱의 실제 임포트 경로를 통과하는지** 고정한다.
 *
 * 왜 이 테스트가 있는가:
 *   초안 생성기는 detect.ts 의 감지 규칙에 맞춰 열을 배치한다. 그 규칙이 바뀌면 생성기는
 *   조용히 어긋나고, 결과물은 "임포트는 성공했는데 값이 비어 있는" 최악의 형태가 된다.
 *   특히 날짜 — parseWithProfile.toIso 는 number|Date 만 받으므로 문자열로 쓰면 전부 null 이
 *   되는데 임포트 자체는 성공한다. 그래서 '생성 → 감지 → 파싱 → 링킹'을 한 번에 태운다.
 */
import { describe, it, expect } from 'vitest'
import * as XLSX from 'xlsx'
import { buildWorkbook } from '../../scripts/wbs/build-xlsx.mjs'
import { detectWorkbook } from '@/lib/excel/detect'
import { parseWithProfile, linkByDepth, resolveLegacyLevelLabels } from '@/lib/excel/parseWithProfile'

const AREAS = [
  {
    key: 'A1', l1: '공통', l2: '기술스택 검토·확정', l2Deliverable: '아키텍처 청사진',
    children: [
      {
        name: '후보 조사', deliverable: '비교표', start: '2026-08-03', end: '2026-08-07', weight: 0.6,
        children: [
          { name: 'DB 후보 비교표 작성', deliverable: '비교표(xlsx)', start: '2026-08-03', end: '2026-08-05', weight: 0.5 },
          { name: '그리드 라이브러리 비교표 작성', deliverable: '비교표(xlsx)', start: '2026-08-05', end: '2026-08-07', weight: 0.5 },
        ],
      },
      {
        name: 'PoC 수행', deliverable: '합격판정서', start: '2026-08-10', end: '2026-08-14', weight: 0.4,
        children: [
          { name: '코일 실적 5만행 조회 성능 측정', deliverable: '측정 결과서', start: '2026-08-10', end: '2026-08-14', weight: 1 },
        ],
      },
    ],
  },
  {
    key: 'B1', l1: '개별설계', l2: '사외창고 프로그램', l2Deliverable: '선행설계서',
    children: [
      {
        name: '기준정보 확정', deliverable: '코드 정의서', start: '2026-08-24', end: '2026-08-28', weight: 1,
        children: [
          { name: '창고사·로케이션 코드 정의', deliverable: '코드 정의서', start: '2026-08-24', end: '2026-08-26', weight: 0.5 },
          { name: '반출사유·차이유형 코드 정의', deliverable: '코드 정의서', start: '2026-08-26', end: '2026-08-28', weight: 0.5 },
        ],
      },
    ],
  },
]

function toBuffer(wb: XLSX.WorkBook): ArrayBuffer {
  const b = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer
  return b
}

describe('WBS 초안 생성기 — 앱 임포트 경로 왕복', () => {
  const { wb, rows, problems } = buildWorkbook(AREAS)
  const buf = toBuffer(wb)

  it('생성 단계에서 날짜 결손·역전을 보고하지 않는다', () => {
    expect(problems).toEqual([])
    // 1단 2개(공통·개별설계) + 2단 2개 + 3단 3개 + 4단 5개
    expect(rows.length - 1).toBe(12)
  })

  it('감지: 시트·계층·논리 열이 사람 손질 없이 잡힌다', () => {
    const det = detectWorkbook(buf)
    expect(det.ok).toBe(true)
    if (!det.ok) return
    const { profile, confidence } = det.result

    expect(profile.sheetName).toBe('WBS')
    expect(profile.holidaySheetName).toBe('Holiday')
    expect(profile.headerRow).toBe(0)
    expect(profile.hierarchy.kind).toBe('outline')
    // 논리 열이 하나라도 null 이면 그 정보는 임포트에서 사라진다.
    for (const [k, v] of Object.entries(profile.logical)) {
      expect(v, `logical.${k} 가 null`).not.toBeNull()
    }
    // 완전일치만으로 채워져야 마법사 2단계에서 손볼 게 없다.
    expect(confidence.logical).toBe(1)
  })

  it('파싱: 날짜가 문자열이 아니라 값으로 들어온다', () => {
    const det = detectWorkbook(buf)
    if (!det.ok) throw new Error(det.error)
    const parsed = parseWithProfile(buf, det.result.profile)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return

    // 이 단정이 이 파일의 존재 이유다 — 날짜를 문자열로 쓰면 여기서 전부 null 이 된다.
    for (const r of parsed.rows) {
      expect(r.plannedStart, `${r.name} 시작일 유실`).toMatch(/^\d{4}-\d{2}-\d{2}$/)
      expect(r.plannedEnd, `${r.name} 종료일 유실`).toMatch(/^\d{4}-\d{2}-\d{2}$/)
      expect(r.weight, `${r.name} 가중치 유실`).not.toBeNull()
    }
    expect(parsed.rows[0].plannedStart).toBe('2026-08-03')
    expect(parsed.holidays.length).toBe(4)
    expect(parsed.holidays[0].date).toBe('2026-08-15')
  })

  it('링킹: 깊이 건너뜀·코드 중복 없이 트리가 선다', () => {
    const det = detectWorkbook(buf)
    if (!det.ok) throw new Error(det.error)
    const parsed = parseWithProfile(buf, det.result.profile)
    if (!parsed.ok) throw new Error(parsed.error)

    const linked = linkByDepth(parsed.rows, {
      legacyLevelLabels: resolveLegacyLevelLabels(det.result.profile),
    })
    expect(linked.ok, JSON.stringify((linked as { errors?: unknown }).errors)).toBe(true)
    if (!linked.ok) return

    const codes = linked.items.map(i => i.code)
    expect(codes.length).toBe(new Set(codes).size)
    // 1단만 부모가 없다.
    expect(linked.items.filter(i => i.parentTempId === null).map(i => i.code)).toEqual(['1', '2'])
  })

  it('가중치: 형제 합이 1.0 이다', () => {
    const det = detectWorkbook(buf)
    if (!det.ok) throw new Error(det.error)
    const parsed = parseWithProfile(buf, det.result.profile)
    if (!parsed.ok) throw new Error(parsed.error)

    const groups = new Map<string, number[]>()
    for (const r of parsed.rows) {
      const parent = (r.code ?? '').split('.').slice(0, -1).join('.') || '(root)'
      groups.set(parent, [...(groups.get(parent) ?? []), r.weight ?? 0])
    }
    for (const [parent, ws] of groups) {
      const sum = ws.reduce((s, w) => s + w, 0)
      expect(Math.abs(sum - 1), `${parent} 형제 합 ${sum}`).toBeLessThan(0.005)
    }
  })
})
