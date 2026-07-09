/** 회의록 md 를 임베딩용 청크로 분할 — 헤딩 경계 우선, 넘치면 문단 경계, 최후엔 강제 절단. */
export function chunkMarkdown(text: string, max = 1500): string[] {
  const trimmed = text.trim()
  if (!trimmed) return []
  // 1) 헤딩 라인(#~######) 기준 섹션 분리
  const sections = trimmed.split(/\n(?=#{1,6}\s)/)
  const out: string[] = []
  for (const sec of sections) {
    if (sec.length <= max) { pushIf(out, sec); continue }
    // 2) 문단(빈 줄) 경계로 max 이하 누적
    let buf = ''
    for (const para of sec.split(/\n{2,}/)) {
      if (para.length > max) {
        pushIf(out, buf); buf = ''
        for (let i = 0; i < para.length; i += max) pushIf(out, para.slice(i, i + max)) // 3) 강제 절단
        continue
      }
      const joined = buf ? `${buf}\n\n${para}` : para
      if (joined.length > max) { pushIf(out, buf); buf = para } else { buf = joined }
    }
    pushIf(out, buf)
  }
  return out
}

function pushIf(arr: string[], s: string): void {
  const t = s.trim()
  if (t) arr.push(t)
}
