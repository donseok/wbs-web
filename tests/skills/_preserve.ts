// tests/skills/_preserve.ts
const BEGIN = /^\s*<!-- worker:begin -->\s*$/
const END = /^\s*<!-- worker:end -->\s*$/

export type WorkerBlock = { prev: string; next: string; body: string }

/**
 * 표지 블록을 순서대로 돌려준다. prev 는 begin 표지 앞의 마지막 비어 있지 않은 줄,
 * next 는 end 표지 뒤의 첫 비어 있지 않은 줄, body 는 두 표지 사이다.
 * 표지가 겹치거나 짝이 맞지 않으면 throw 한다.
 */
export function workerBlocks(text: string): WorkerBlock[] {
  const lines = text.split('\n')
  const out: WorkerBlock[] = []
  let start = -1
  lines.forEach((line, i) => {
    if (BEGIN.test(line)) {
      if (start !== -1) throw new Error(`표지 겹침: ${i + 1}행`)
      start = i
    } else if (END.test(line)) {
      if (start === -1) throw new Error(`짝 없는 end 표지: ${i + 1}행`)
      const prev = lines.slice(0, start).reverse().find((l) => l.trim() !== '') ?? ''
      const next = lines.slice(i + 1).find((l) => l.trim() !== '') ?? ''
      out.push({ prev, next, body: lines.slice(start + 1, i).join('\n') })
      start = -1
    }
  })
  if (start !== -1) throw new Error('닫히지 않은 begin 표지')
  return out
}

/** 표지 블록(표지 줄 포함)을 뺀 본문. 수동 경로가 읽는 문서다. */
export function stripWorkerBlocks(text: string): string {
  const out: string[] = []
  let inside = false
  for (const line of text.split('\n')) {
    if (BEGIN.test(line)) { inside = true; continue }
    if (END.test(line)) { inside = false; continue }
    if (!inside) out.push(line)
  }
  return out.join('\n')
}

/**
 * orig 의 줄 중 changed 에 없는 줄이 next 에 같은 순서로 모두 남아 있는지 본다.
 * changed 에 든 원문 줄은 바뀌거나 지워져도 된다. next 에 새 줄이 끼어드는 것은 허용한다.
 * 반환: 찾지 못한 첫 원문 줄(보존 위반). 모두 찾으면 null.
 */
export function firstLostLine(orig: string, next: string, changed: readonly string[]): string | null {
  const skip = new Set(changed)
  const b = next.split('\n')
  let j = 0
  for (const line of orig.split('\n')) {
    if (skip.has(line)) continue
    while (j < b.length && b[j] !== line) j++
    if (j === b.length) return line
    j++
  }
  return null
}

/**
 * 줄 묶음 교체를 반영한다. 각 범위는 [시작 줄, 범위 뒤 첫 줄] 이며 시작 줄부터 끝 줄 앞까지를 지운다.
 * 원문을 여러 줄 통째로 바꾸는 곳에 쓴다. 그 안에 다른 곳에도 있는 줄(예 코드 펜스)이 있으면
 * CHANGED 한 줄 목록으로는 "정확히 한 번씩" 을 지킬 수 없기 때문이다.
 * 경계 줄이 없거나 두 번 이상 있으면 throw 한다.
 */
export function dropRanges(text: string, ranges: readonly (readonly [string, string])[]): string {
  let lines = text.split('\n')
  for (const [start, end] of ranges) {
    const s = lines.indexOf(start)
    if (s === -1 || lines.indexOf(start, s + 1) !== -1) throw new Error(`범위 시작 줄이 한 번이 아니다: ${start}`)
    const e = lines.indexOf(end, s + 1)
    if (e === -1 || lines.indexOf(end, e + 1) !== -1) throw new Error(`범위 끝 줄이 한 번이 아니다: ${end}`)
    lines = [...lines.slice(0, s), ...lines.slice(e)]
  }
  return lines.join('\n')
}

const FIXTURE_HEAD = /^<!-- fixture: git show ([0-9a-f]{40}):(\S+) .*-->\n/

/**
 * fixture 파일을 머리 주석(첫 줄)과 원문으로 가른다. 머리 주석은 fixture 를 뜬 커밋 sha 와 원문 경로다.
 * 머리 주석이 없으면 throw 한다(손으로 만든 fixture 를 막는다).
 */
export function parseFixture(raw: string): { sha: string; path: string; text: string } {
  const m = raw.match(FIXTURE_HEAD)
  if (!m) throw new Error('fixture 첫 줄에 "<!-- fixture: git show <sha>:<경로> …-->" 머리 주석이 없다')
  return { sha: m[1], path: m[2], text: raw.slice(m[0].length) }
}
