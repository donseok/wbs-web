import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * 회의록 목록의 글머리 기호(점·번호)가 목록 상자 밖으로 나가지 않아야 한다.
 * 목록 상자 가장자리에는 hover 테두리([data-mblock]:hover outline)와 마킹·이슈 좌측 선이 그려진다.
 *
 * 1) 마킹은 루트 블록 단위라 목록이면 <ul>/<ol> 전체에 data-ins / data-issue-count 가 붙는다.
 *    `.minutes-md [data-ins]` 의 padding-left(0.6em)는 `.minutes-md ul` 보다 특이성이 높아 목록
 *    들여쓰기를 덮고, 바깥쪽(outside) 기호가 3px 좌측 선 위에 얹혔다(2026-09-10 제보).
 * 2) 번호 폭은 자릿수마다 늘어난다(Pretendard 16px 실측 "9. " 1.093em · "35. " 1.692em ·
 *    "135. " 2.131em). 한 자리 기준 들여쓰기(1.45em)에 두 자리 번호가 hover 테두리 밖으로
 *    튀어나왔다(2026-09-10 제보). 번호 목록은 자릿수(--ol-digits, MarkdownView 가 넣는다)만큼 민다.
 */

const root = fileURLToPath(new URL('../..', import.meta.url))
const css = readFileSync(join(root, 'src/app/globals.css'), 'utf8')

/** 선택자가 정확히 일치하는 규칙의 선언부. */
function declarationsOf(selector: string): string | null {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return css.match(new RegExp(`(?:^|[\\s}])${escaped}\\s*\\{([^}]*)\\}`))?.[1] ?? null
}

function declOf(selector: string, prop: string): string | null {
  const escaped = prop.replace(/[-]/g, '\\-')
  return declarationsOf(selector)?.match(new RegExp(`(?:^|[;\\s])${escaped}:\\s*([^;]+);`))?.[1].trim() ?? null
}

/** 실측 번호 폭 증가량(2자리 − 1자리) — 자릿수당 여백이 이보다 작으면 두 자리부터 다시 튀어나온다. */
const MARKER_GROWTH_PER_DIGIT_EM = 1.692 - 1.093

describe('회의록 목록 들여쓰기', () => {
  const baseIndent = declOf('.minutes-md ul', '--list-indent')
  const markIndent = declOf('.minutes-md [data-ins]', 'padding-left')

  it('글머리 목록은 기본 들여쓰기를 --list-indent 로 둔다', () => {
    expect(baseIndent).toBe('1.45em')
    expect(declOf('.minutes-md ul', 'padding-left')).toBe('var(--list-indent)')
  })

  it('번호 목록은 자릿수만큼 들여쓰기를 늘린다 — 번호가 hover 테두리 밖으로 튀어나오지 않게', () => {
    const olIndent = declOf('.minutes-md ol', '--list-indent')
    expect(declOf('.minutes-md ol', 'padding-left')).toBe('var(--list-indent)')
    const m = olIndent?.match(/^calc\(([\d.]+em) \+ \(var\(--ol-digits, 1\) - 1\) \* ([\d.]+)em\)$/)
    expect(m, `ol --list-indent: ${olIndent}`).not.toBeNull()
    expect(m![1]).toBe(baseIndent)  // 한 자리 목록은 글머리 목록과 같은 들여쓰기
    expect(Number(m![2])).toBeGreaterThanOrEqual(MARKER_GROWTH_PER_DIGIT_EM)
  })

  it('마킹·이슈 연결된 목록은 목록 들여쓰기 + 마킹 여백만큼 민다 — 기호가 좌측 선에 얹히지 않게', () => {
    expect(markIndent).toBe('0.6em')
    expect(declOf('.minutes-md :is(ul, ol):is([data-ins], [data-issue-count])', 'padding-left'))
      .toBe(`calc(var(--list-indent) + ${markIndent})`)
  })
})
