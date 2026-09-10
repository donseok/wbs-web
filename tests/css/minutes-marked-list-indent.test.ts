import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * 회의록 AI 마킹·이슈 연결 블록의 좌측 선과 목록 글머리 기호가 겹치지 않아야 한다.
 *
 * 마킹은 루트 블록 단위라 목록이면 <ul>/<ol> 전체에 data-ins / data-issue-count 가 붙는다.
 * `.minutes-md [data-ins]` 의 padding-left(0.6em)는 `.minutes-md ul` 보다 특이성이 높아
 * 목록 들여쓰기(1.45em)를 덮고, 바깥쪽(outside) 글머리 기호가 3px 좌측 선 위에 얹힌다
 * (2026-09-10 제보). 목록이면 기본 들여쓰기에 마킹 여백을 더해야 한다.
 */

const root = fileURLToPath(new URL('../..', import.meta.url))
const css = readFileSync(join(root, 'src/app/globals.css'), 'utf8')

/** 선택자가 정확히 일치하는 규칙의 선언부. */
function declarationsOf(selector: string): string | null {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return css.match(new RegExp(`(?:^|[\\s}])${escaped}\\s*\\{([^}]*)\\}`))?.[1] ?? null
}

function paddingLeftOf(selector: string): string | null {
  return declarationsOf(selector)?.match(/padding-left:\s*([^;]+);/)?.[1].trim() ?? null
}

describe('회의록 마킹 목록 들여쓰기', () => {
  const listIndent = paddingLeftOf('.minutes-md ul')
  const markIndent = paddingLeftOf('.minutes-md [data-ins]')

  it('전제: 목록 기본 들여쓰기와 마킹 여백이 정의돼 있다', () => {
    expect(listIndent).toBeTruthy()
    expect(markIndent).toBeTruthy()
    expect(paddingLeftOf('.minutes-md ol')).toBe(listIndent)
  })

  it('마킹·이슈 연결된 목록은 목록 들여쓰기 + 마킹 여백만큼 민다 — 글머리 기호가 좌측 선에 얹히지 않게', () => {
    const marked = paddingLeftOf('.minutes-md :is(ul, ol):is([data-ins], [data-issue-count])')
    expect(marked).toBe(`calc(${listIndent} + ${markIndent})`)
  })
})
