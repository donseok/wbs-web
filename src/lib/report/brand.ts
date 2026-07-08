import type { Status, TeamCode } from '@/lib/domain/types'

/** D'Flow 브랜드 토큰 (globals.css 라이트 테마 기준). Hex는 '#' 없는 6자리(RRGGBB).
 *  Excel(exceljs) 출력에서 화면과 동일한 브랜드 컬러를 쓰기 위한 단일 출처. */
export const C = {
  brand: '0F766E',
  brandHover: '155E75',
  brandWeak: 'E3EFEC',
  ink: '17181D',
  inkMuted: '4A4440',
  inkSubtle: '7A6F68',
  surface: 'FFFAF4',
  surface2: 'F3ECE1',
  canvas: 'F5EFE6',
  line: 'E6DCCD',
  lineStrong: 'D6C9B6',
  white: 'FFFFFF',
  // 상태
  done: '138A67',
  progress: '2D6FB0',
  delayed: 'CB4B5F',
  pending: '7A6F68',
  doneWeak: 'E3F3EC',
  delayedWeak: 'F8E6E9',
  // dark (표지/푸터)
  dark1: '1C2028',
  dark2: '14181F',
  dark3: '0D1014',
  heroInk: 'F4EFE7',
  heroInkMuted: 'B6AA9E',
} as const

export const TEAM_COLOR: Record<TeamCode, string> = {
  PMO: '4F46E5',
  가공: '0276A8',
  ERP: '7C3AED',
  MES: 'A65B00',
}

export const STATUS_COLOR: Record<Status, string> = {
  not_started: C.pending,
  in_progress: C.progress,
  delayed: C.delayed,
  done: C.done,
}

export const STATUS_LABEL: Record<Status, string> = {
  not_started: '시작전',
  in_progress: '진행중',
  delayed: '지연',
  done: '완료',
}

/** 담당 배지 텍스트: '● PMO  △ 가공' 형태. */
export function ownersText(owners: { team: TeamCode; kind: 'primary' | 'support' }[]): string {
  if (!owners.length) return '-'
  return owners.map(o => `${o.kind === 'primary' ? '●' : '△'} ${o.team}`).join('  ')
}

/** '#' 없는 6자리 hex → exceljs ARGB(FF + RRGGBB). */
export function argb(hex: string): string {
  return 'FF' + hex
}
