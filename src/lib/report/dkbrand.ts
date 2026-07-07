import type { Status } from '@/lib/domain/types'

/* 동국제강 그룹 주간보고/공정보고 디자인 토큰. Hex는 '#' 없는 6자리(RRGGBB).
 * 공식 CI: DONGKUK BLUE #002452 + DONGKUK RED #C51F2A (블루+레드 듀오톤).
 * PPT(pptxgenjs) = 네이비 본문 + 레드 브랜드 악센트 · Excel(exceljs) = 보라(퍼플) 테마. */

/** PPT — 동국제강 그룹 네이비 주간보고 */
export const PN = {
  navy: '002452',       // 헤더바 · 표지 배경 (DONGKUK BLUE)
  navy2: '003670',      // 보조 네이비
  ink: '1A1A2E',        // 진한 텍스트 · 표 헤더 배경
  body: '2A2F3C',       // 본문
  body2: '3E4555',
  gray: '5C6370',       // 라벨
  subtle: '8B92A0',     // 부제 · 페이지번호
  line: 'D4D8E0',       // 테두리 · 막대 트랙
  divider: 'A6A6A6',    // 내지 헤더 구분선(중립 회색, 참조 bg1 65%)
  footerGray: 'B6B6B6', // 푸터·페이지번호(중립 회색, 참조 lt2/bg2)
  red: 'C51F2A',        // DONGKUK RED — 브랜드 악센트(표지·헤더 룰) · 이슈/미달
  green: '0D7C3E',      // 초과 · 양호
  chip: 'E8EDF4',       // 상태 칩 배경
  zebra: 'F7F8FA',      // 줄무늬 행
  white: 'FFFFFF',
  surface: 'FFFFFF',
} as const

/** PPT 상태 칩 텍스트 색 */
export const PN_STATUS: Record<Status, string> = {
  not_started: '5C6370',
  in_progress: '1D4ED8',
  delayed: 'C51F2A',
  done: '0D7C3E',
}

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

/** 진척률 텍스트 막대 (Excel 비고 컬럼용). 12칸. */
export function asciiBar(pct: number): string {
  const p = Math.max(0, Math.min(100, Math.round(pct)))
  const filled = Math.round((p / 100) * 12)
  return `${'█'.repeat(filled)}${'░'.repeat(12 - filled)} ${p}%`
}
