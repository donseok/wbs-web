import { describe, expect, it } from 'vitest'
import JSZip from 'jszip'
import {
  createMinutesExportArchive,
  minuteExportEntryPath,
  minutesManifestCsv,
  sanitizeArchiveSegment,
  type MinuteExportRow,
} from '@/lib/minutes/export'

function row(patch: Partial<MinuteExportRow> = {}): MinuteExportRow {
  return {
    id: '11111111-1111-1111-1111-111111111111',
    minuteDate: '2026-07-23',
    teamCode: 'PMO',
    title: '주간정례 2026-07-23',
    bodyMd: '# 결정사항\n\n본문 그대로',
    meetingId: null,
    createdByName: '홍길동',
    createdAt: '2026-07-23T01:00:00.000Z',
    updatedAt: '2026-07-23T02:00:00.000Z',
    ...patch,
  }
}

describe('minutes bulk export archive', () => {
  it('preserves Unicode while removing path traversal and platform-forbidden characters', () => {
    expect(sanitizeArchiveSegment('../한글/회의:*?')).toBe('__한글_회의___')
    const path = minuteExportEntryPath(row({ title: '../../비밀/회의 2026-07-23' }))
    expect(path).toContain('minutes/PMO/')
    expect(path).not.toContain('..')
    expect(path.split('/')).toHaveLength(4)
  })

  it('stores every canonical body verbatim and includes a matching UTF-8 manifest', async () => {
    const rows = [
      row(),
      row({
        id: '22222222-2222-2222-2222-222222222222',
        minuteDate: '2026-07-22',
        title: 'ERP 인터페이스_260722',
        teamCode: 'ERP',
        bodyMd: '한글 본문\n- 액션',
        createdByName: '=HYPERLINK("bad")',
      }),
    ]
    const { zip, manifest } = createMinutesExportArchive(rows, new Date('2026-07-23T03:00:00.000Z'))
    const bytes = await zip.generateAsync({ type: 'uint8array' })
    const opened = await JSZip.loadAsync(bytes)

    expect(manifest).toHaveLength(2)
    for (const entry of manifest) {
      const original = rows.find(item => item.id === entry.id)!
      expect(await opened.file(entry.path)!.async('string')).toBe(original.bodyMd)
    }
    const csv = await opened.file('_manifest.csv')!.async('string')
    expect(csv.charCodeAt(0)).toBe(0xfeff)
    expect(csv).toContain('ERP 인터페이스_260722')
    expect(csv).toContain("'=HYPERLINK")
    expect(await opened.file('_README.txt')!.async('string')).toContain('일반 첨부파일은')
  })

  it('uses full ids and a suffix fallback so duplicate titles cannot overwrite an entry', () => {
    const duplicate = row()
    const { manifest } = createMinutesExportArchive([duplicate, duplicate])
    expect(new Set(manifest.map(item => item.path)).size).toBe(2)
    expect(manifest[0].path).toContain(duplicate.id)
    expect(manifest[1].path).toMatch(/__2\.md$/)
  })

  it('neutralizes spreadsheet formulas in manifest metadata', () => {
    const csv = minutesManifestCsv([{
      id: 'id', date: '2026-07-23', team: 'PMO', meetingGroup: '@cmd', title: '-2+3',
      createdByName: '+SUM(1,1)', meetingId: null, createdAt: 'now', updatedAt: 'now',
      bodyBytes: 0, path: 'minutes/a.md',
    }])
    expect(csv).toContain("'@cmd")
    expect(csv).toContain("'-2+3")
    expect(csv).toContain("'+SUM")
  })
})
