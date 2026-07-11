/* 동국제강 그룹 공정보고 디자인 토큰. Hex는 '#' 없는 6자리(RRGGBB).
 * 공식 CI: DONGKUK BLUE #002452 + DONGKUK RED #C51F2A (블루+레드 듀오톤).
 * Excel(exceljs) = 보라(퍼플) 테마. PPT는 사내 D-Cube 템플릿(.pptx)의 서식을
 * 그대로 재사용하므로(templateFill) 색 토큰이 필요 없다. */

import { formatPct1 } from '@/lib/domain/format'

/** Excel — 보라 공정보고 */
export const PX = {
  purple: '6B21A8',     // 섹션/표 헤더
  purpleLight: 'E9DEF2',// 라벨 셀 · 합계행
  phaseRow: 'E4D7EF',   // WBS Phase 행
  actRow: 'F3EDF8',     // WBS Activity 행
  workload: 'F0E9F6',   // 워크로드 숫자 배경
  zebra: 'F8FAFC',      // 줄무늬
  white: 'FFFFFF',
  ink: '1E293B',
  gray: '64748B',       // 라벨 텍스트
  red: 'DC2626', redBg: 'FEE2E2',
  green: '166534', greenBg: 'DCFCE7',
  amber: '9A3412', amberBg: 'FFF7ED',
  line: 'E2E8F0',
} as const

/** '#' 없는 6자리 hex → exceljs ARGB(FF + RRGGBB). */
export function argb(hex: string): string {
  return 'FF' + hex
}

/** 진척률 텍스트 막대 (Excel 비고 컬럼용). 12칸, 라벨은 대시보드와 같은 소수 1자리. */
export function asciiBar(pct: number): string {
  const p = Math.max(0, Math.min(100, pct))
  const filled = Math.round((p / 100) * 12)
  return `${'█'.repeat(filled)}${'░'.repeat(12 - filled)} ${formatPct1(p)}%`
}
