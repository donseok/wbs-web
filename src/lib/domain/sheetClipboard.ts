/* ── 셀 격자 ↔ TSV 직렬화(순수) — 구글시트/엑셀 상호 호환. I/O 없음. ── */

/** 셀에 탭·개행·따옴표가 있으면 인용 필요(그 외는 그대로). */
function needsQuote(cell: string): boolean {
  return /[\t\n\r"]/.test(cell)
}

/** 한 셀 직렬화 — 인용 시 `"…"`로 감싸고 내부 `"`는 `""`로 이스케이프. */
function serializeCell(cell: string): string {
  return needsQuote(cell) ? `"${cell.replace(/"/g, '""')}"` : cell
}

/** 셀 격자(행 우선) → TSV. 행 구분 `\n`, 열 구분 `\t`. */
export function serializeTsv(cells: string[][]): string {
  return cells.map(row => row.map(serializeCell).join('\t')).join('\n')
}

/**
 * TSV → 셀 격자(행 우선). 따옴표/멀티라인 셀 존중.
 * - `\r\n`·단독 `\r`은 행 경계로 정규화(단, 인용 안의 `\r`/`\n`은 셀 내용으로 보존).
 * - `"`로 시작하는 필드는 인용 필드: 닫는 `"`까지 읽되 `""`는 리터럴 `"`로 해제.
 * - 후행 개행 1개는 빈 행을 만들지 않는다(엑셀/시트 복사본 말미 `\n` 대응).
 * - 반환은 직사각형 보장 안 함 — 소비자(pasteEdits)가 앵커 기준으로 clip.
 */
export function parseTsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let inQuotes = false
  let lastWasRowSep = false // 후행 개행 판정 — 마지막 처리가 행 구분이면 EOF 플러시 생략
  const n = text.length
  let i = 0

  while (i < n) {
    const ch = text[i]
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 2; continue } // 이스케이프된 따옴표
        inQuotes = false; i++; continue                             // 인용 종료
      }
      field += ch; i++; continue // 인용 안의 \t·\n·\r는 셀 내용
    }
    if (ch === '"' && field === '') { inQuotes = true; lastWasRowSep = false; i++; continue } // 필드 선두 따옴표만 인용 시작
    if (ch === '\t') { row.push(field); field = ''; lastWasRowSep = false; i++; continue }
    if (ch === '\r' || ch === '\n') {
      row.push(field); field = ''; rows.push(row); row = []; lastWasRowSep = true
      i += ch === '\r' && text[i + 1] === '\n' ? 2 : 1 // \r\n은 한 경계로
      continue
    }
    field += ch; lastWasRowSep = false; i++
  }

  // 마지막 필드/행 플러시 — 단, 텍스트가 행 구분으로 끝났으면(후행 개행) 빈 행을 만들지 않는다.
  if (!(lastWasRowSep && field === '' && row.length === 0)) {
    row.push(field)
    rows.push(row)
  }
  return rows
}
