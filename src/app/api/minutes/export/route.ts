import { Readable } from 'node:stream'
import { NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { createServerClient } from '@/lib/supabase/server'
import {
  createMinutesExportArchive,
  MINUTES_EXPORT_SOURCE_MAX_BYTES,
  utf8ByteLength,
  type MinuteExportRow,
} from '@/lib/minutes/export'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const PAGE_SIZE = 500
const SELECT_COLUMNS = [
  'id', 'minute_date', 'team_code', 'title', 'body_md', 'meeting_id',
  'created_by_name', 'created_at', 'updated_at',
].join(', ')

type DbRow = Record<string, unknown>

function jsonError(error: string, status: number): NextResponse {
  return NextResponse.json({ error }, {
    status,
    headers: { 'Cache-Control': 'no-store' },
  })
}

function requiredString(row: DbRow, key: string): string {
  const value = row[key]
  if (typeof value !== 'string') throw new Error(`회의록 export 행의 ${key} 값이 올바르지 않습니다.`)
  return value
}

function mapRow(row: DbRow): MinuteExportRow {
  const meetingId = row.meeting_id ?? null
  const createdByName = row.created_by_name ?? null
  if (meetingId !== null && typeof meetingId !== 'string') {
    throw new Error('회의록 export 행의 meeting_id 값이 올바르지 않습니다.')
  }
  if (createdByName !== null && typeof createdByName !== 'string') {
    throw new Error('회의록 export 행의 created_by_name 값이 올바르지 않습니다.')
  }
  return {
    id: requiredString(row, 'id'),
    minuteDate: requiredString(row, 'minute_date'),
    teamCode: requiredString(row, 'team_code'),
    title: requiredString(row, 'title'),
    bodyMd: requiredString(row, 'body_md'),
    meetingId: meetingId as string | null,
    createdByName: createdByName as string | null,
    createdAt: requiredString(row, 'created_at'),
    updatedAt: requiredString(row, 'updated_at'),
  }
}

/**
 * UUID PK keyset으로 전 건을 읽는다. UI 트리의 1,000건 cap/offset pagination을 재사용하지 않는다.
 * 시작 시각 이후 생성된 행은 다음 export로 넘겨 한 번의 ZIP 범위를 고정한다.
 */
async function loadAllMinutes(cutoffIso: string): Promise<MinuteExportRow[]> {
  const sb = await createServerClient()
  const rows: MinuteExportRow[] = []
  let cursor: string | null = null
  let sourceBytes = 0

  for (;;) {
    let query = sb.from('minutes')
      .select(SELECT_COLUMNS)
      .lte('created_at', cutoffIso)
      .order('id', { ascending: true })
      .limit(PAGE_SIZE)
    if (cursor) query = query.gt('id', cursor)

    const { data, error } = await query
    if (error) throw new Error(`회의록 조회 실패: ${error.message}`)
    const page = (data ?? []) as unknown as DbRow[]

    for (const raw of page) {
      const mapped = mapRow(raw)
      sourceBytes += utf8ByteLength(mapped.bodyMd)
      if (sourceBytes > MINUTES_EXPORT_SOURCE_MAX_BYTES) {
        const tooLarge = new Error('회의록 본문 전체 용량이 동기 내보내기 한도를 초과했습니다.')
        tooLarge.name = 'MinutesExportTooLargeError'
        throw tooLarge
      }
      rows.push(mapped)
    }

    if (page.length < PAGE_SIZE) break
    const nextCursor = requiredString(page[page.length - 1], 'id')
    if (cursor !== null && nextCursor <= cursor) throw new Error('회의록 페이지 순서가 올바르지 않습니다.')
    cursor = nextCursor
  }

  return rows
}

function seoulDate(date: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(date)
}

/** 로그인 사용자가 현재 열람 가능한 전역 회의록 본문을 분석용 ZIP으로 받는다. */
export async function GET() {
  if (!(await getSession())) return jsonError('인증이 필요합니다.', 401)

  const exportedAt = new Date()
  try {
    const rows = await loadAllMinutes(exportedAt.toISOString())
    if (rows.length === 0) return jsonError('내려받을 회의록이 없습니다.', 404)

    const { zip } = createMinutesExportArchive(rows, exportedAt)
    // 결과 Buffer를 한 번 더 만들지 않고 압축 결과를 스트림으로 응답한다.
    const nodeStream = zip.generateNodeStream({
      type: 'nodebuffer',
      streamFiles: true,
      compression: 'DEFLATE',
      compressionOptions: { level: 6 },
      platform: 'UNIX',
    })
    const stream = Readable.toWeb(nodeStream as unknown as Readable) as ReadableStream<Uint8Array>
    const date = seoulDate(exportedAt)
    const utf8Name = `DFlow_회의록_전체_${date}.zip`
    const fallbackName = `DFlow_minutes_all_${date}.zip`

    return new Response(stream as unknown as BodyInit, {
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="${fallbackName}"; filename*=UTF-8''${encodeURIComponent(utf8Name)}`,
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    })
  } catch (error) {
    if (error instanceof Error && error.name === 'MinutesExportTooLargeError') {
      return jsonError(
        '전체 회의록 용량이 너무 큽니다. 담당·기간별 내보내기 기능으로 나누어야 합니다.',
        413,
      )
    }
    console.error('[minutes/export] 일괄 다운로드 실패:', error instanceof Error ? error.message : error)
    return jsonError('회의록 묶음을 만드는 중 오류가 발생했습니다.', 500)
  }
}
