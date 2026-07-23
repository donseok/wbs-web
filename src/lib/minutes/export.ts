import JSZip from 'jszip'
import { meetingBodyOf } from '@/lib/domain/minutes'

/** 일괄 내보내기의 정본 행. Storage 원본/첨부가 아니라 현재 DB 본문을 담는다. */
export interface MinuteExportRow {
  id: string
  minuteDate: string
  teamCode: string
  title: string
  bodyMd: string
  meetingId: string | null
  createdByName: string | null
  createdAt: string
  updatedAt: string
}

export interface MinuteExportManifestEntry {
  id: string
  date: string
  team: string
  meetingGroup: string
  title: string
  createdByName: string | null
  meetingId: string | null
  createdAt: string
  updatedAt: string
  bodyBytes: number
  path: string
}

export const MINUTES_EXPORT_SOURCE_MAX_BYTES = 100 * 1024 * 1024

const textEncoder = new TextEncoder()
const ZIP_MIN_DATE = new Date('1980-01-01T00:00:00.000Z')

export function utf8ByteLength(value: string): number {
  return textEncoder.encode(value).byteLength
}

/**
 * 사용자 제목을 ZIP 경로 한 조각으로 바꾼다.
 * 한글은 보존하되 zip-slip/Windows 금지 문자/제어문자와 점 경로를 제거한다.
 */
export function sanitizeArchiveSegment(value: string, fallback = '회의록', maxLength = 100): string {
  const cleaned = value
    .normalize('NFC')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/\.{2,}/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^[. ]+|[. ]+$/g, '')
  const clipped = Array.from(cleaned).slice(0, maxLength).join('').replace(/[. ]+$/g, '')
  if (!clipped || clipped === '.' || clipped === '..') return fallback
  return clipped
}

export function minuteExportEntryPath(row: MinuteExportRow): string {
  const team = sanitizeArchiveSegment(row.teamCode, '미분류', 30)
  const group = sanitizeArchiveSegment(meetingBodyOf(row.title), '회의록', 80)
  const title = sanitizeArchiveSegment(row.title, '회의록', 100)
  const id = sanitizeArchiveSegment(row.id, 'id', 64)
  return `minutes/${team}/${group}/${row.minuteDate}__${title}__${id}.md`
}

function safeZipDate(value: string | Date, fallback = ZIP_MIN_DATE): Date {
  const parsed = value instanceof Date ? new Date(value) : new Date(value)
  const year = parsed.getUTCFullYear()
  return Number.isFinite(parsed.getTime()) && year >= 1980 && year <= 2107 ? parsed : fallback
}

/** CSV 수식 주입을 막고 RFC 4180 형태로 항상 큰따옴표 인용한다. */
function csvCell(raw: string | number | null): string {
  let value = raw === null ? '' : String(raw)
  if (/^[\t\r\n ]*[=+\-@]/.test(value)) value = `'${value}`
  return `"${value.replace(/"/g, '""')}"`
}

export function minutesManifestCsv(entries: MinuteExportManifestEntry[]): string {
  const headers = [
    'id', 'date', 'team', 'meeting_group', 'title', 'created_by_name', 'meeting_id',
    'created_at', 'updated_at', 'body_bytes', 'path',
  ]
  const lines = entries.map(entry => [
    entry.id, entry.date, entry.team, entry.meetingGroup, entry.title, entry.createdByName,
    entry.meetingId, entry.createdAt, entry.updatedAt, entry.bodyBytes, entry.path,
  ].map(csvCell).join(','))
  // Excel에서도 한글이 UTF-8로 열리도록 BOM을 붙인다.
  return `\uFEFF${headers.map(csvCell).join(',')}\r\n${lines.join('\r\n')}${lines.length ? '\r\n' : ''}`
}

function compareRows(a: MinuteExportRow, b: MinuteExportRow): number {
  if (a.minuteDate !== b.minuteDate) return a.minuteDate < b.minuteDate ? 1 : -1
  if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? 1 : -1
  return a.id.localeCompare(b.id)
}

function uniqueEntryPath(basePath: string, used: Set<string>): string {
  if (!used.has(basePath)) {
    used.add(basePath)
    return basePath
  }
  const stem = basePath.endsWith('.md') ? basePath.slice(0, -3) : basePath
  let suffix = 2
  while (used.has(`${stem}__${suffix}.md`)) suffix += 1
  const path = `${stem}__${suffix}.md`
  used.add(path)
  return path
}

export function createMinutesExportArchive(
  rows: MinuteExportRow[],
  exportedAt: Date = new Date(),
): { zip: JSZip; manifest: MinuteExportManifestEntry[] } {
  const stableRows = [...rows].sort(compareRows)
  const zip = new JSZip()
  const manifest: MinuteExportManifestEntry[] = []
  const usedPaths = new Set<string>()
  const archiveDate = safeZipDate(exportedAt)

  for (const row of stableRows) {
    const meetingGroup = meetingBodyOf(row.title)
    const path = uniqueEntryPath(minuteExportEntryPath(row), usedPaths)
    // 본문은 분석 정본이므로 front matter 등을 덧붙이지 않고 바이트 내용 그대로 보존한다.
    zip.file(path, row.bodyMd, { date: safeZipDate(row.updatedAt, archiveDate), createFolders: false })
    manifest.push({
      id: row.id,
      date: row.minuteDate,
      team: row.teamCode,
      meetingGroup,
      title: row.title,
      createdByName: row.createdByName,
      meetingId: row.meetingId,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      bodyBytes: utf8ByteLength(row.bodyMd),
      path,
    })
  }

  const readme = [
    "D'Flow 회의록 전체 내보내기",
    `생성 시각: ${exportedAt.toISOString()}`,
    `회의록 수: ${manifest.length}`,
    '',
    '- minutes/ 아래의 .md 파일은 다운로드 시점 DB의 최신 회의록 본문입니다.',
    '- 원본 파일이 없는 연동 회의록도 포함됩니다.',
    '- 일반 첨부파일은 이 분석용 묶음에 포함되지 않습니다.',
    '- _manifest.csv에서 날짜, 담당, 제목, 작성자와 각 문서 경로를 확인할 수 있습니다.',
    '',
  ].join('\n')
  zip.file('_manifest.csv', minutesManifestCsv(manifest), { date: archiveDate, createFolders: false })
  zip.file('_README.txt', readme, { date: archiveDate, createFolders: false })

  return { zip, manifest }
}
