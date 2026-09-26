// tests/skills/dflow-dev-split.test.ts — /dflow-dev 스킬 문서 분할(안내 본문 + 단계 파일) 불변식.
// 설계: docs/superpowers/specs/2026-09-26-dflow-dev-skill-router-design.md §8·§9
import { describe, expect, it } from 'vitest'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { devFiles, devOrch, devRouter, orchOrder, ROUTES, routeText } from './_dflow-dev'
import { firstLostLine, workerBlocks } from './_preserve'

const ROOT = process.cwd()
const DEV_DIR = join(ROOT, '.claude/skills/dflow-dev')
const presplit = readFileSync(join(ROOT, 'tests/skills/fixtures/dflow-dev.SKILL.presplit.md'), 'utf8').replace(/\n$/, '').split('\n')
const moveMap = readFileSync(join(ROOT, 'tests/skills/fixtures/dflow-dev.move-map.txt'), 'utf8')
  .split('\n').filter((l) => l.trim() && !l.startsWith('#'))
  .map((l) => {
    const m = l.match(/^(\d+)-(\d+) (\S+)$/)
    if (!m) throw new Error(`이동 지도 형식 오류: ${l}`)
    return { from: Number(m[1]), to: Number(m[2]), file: m[3] }
  })

/**
 * 분할 뒤 정리(중복 정본화·근거 이관·포인터 교체)로 지우거나 바꾼 분할 전 줄. 이 밖의 줄은 이동 지도의 대상 파일에
 * 같은 순서로 남아야 한다. 이 목록이 분할 뒤 무엇을 지웠는지의 감사 기록이다 — 줄마다 이유를 주석으로 단다.
 */
const CHANGED_SPLIT: readonly string[] = []

describe('이동 지도(분할 전 SKILL.md → 안내 본문·단계 파일)', () => {
  it('분할 전 모든 줄이 정확히 한 범위에 속한다', () => {
    let next = 1
    for (const r of moveMap) {
      expect(r.from, `${r.from}-${r.to}`).toBe(next)
      expect(r.to).toBeGreaterThanOrEqual(r.from)
      next = r.to + 1
    }
    expect(next - 1).toBe(presplit.length)
  })

  it('각 범위의 줄이 대상 파일에 같은 순서로 남아 있다(CHANGED_SPLIT 제외)', () => {
    for (const r of moveMap) {
      const target = readFileSync(join(DEV_DIR, r.file), 'utf8')
      const range = presplit.slice(r.from - 1, r.to).join('\n')
      expect(firstLostLine(range, target, CHANGED_SPLIT), `${r.from}-${r.to} → ${r.file}`).toBeNull()
    }
  })

  it('CHANGED_SPLIT 줄은 분할 전 원문에 있고 지금 어느 파일에도 없다', () => {
    const now = Object.values(devFiles()).join('\n').split('\n')
    for (const l of CHANGED_SPLIT) {
      expect(presplit, l).toContain(l)
      expect(now, l).not.toContain(l)
    }
  })
})

describe('단계 지도와 단계 파일', () => {
  const router = devRouter()
  const order = orchOrder(router)

  it('fail-closed 순서의 파일과 orch 폴더의 파일이 같다', () => {
    const onDisk = readdirSync(join(DEV_DIR, 'references/orch')).filter((f) => f.endsWith('.md')).map((f) => f.replace(/\.md$/, ''))
    expect([...order].sort()).toEqual([...onDisk].sort())
  })

  it('안내 본문과 단계 파일이 가리키는 orch/ 파일은 모두 있다', () => {
    for (const [name, text] of Object.entries(devFiles()))
      for (const m of text.matchAll(/`orch\/([a-z-]+)\.md`/g)) expect(existsSync(join(DEV_DIR, 'references/orch', `${m[1]}.md`)), `${name} → ${m[1]}`).toBe(true)
  })

  it('단계 지도의 모든 파일이 표에 나온다', () => {
    const table = router.split('## 단계 지도')[1]?.split('## 압축 뒤')[0] ?? ''
    for (const n of order) expect(table, n).toContain(`\`orch/${n}.md\``)
  })

  it('단계 파일마다 머리 안내와 「다음 단계」 가 있다', () => {
    for (const n of order) {
      const t = devOrch(n)
      expect(t, n).toMatch(/^# \/dflow-dev 단계 — /)
      expect(t, n).toContain('SKILL.md 「단계 지도」 가 가리킬 때 읽는다')
      expect(t, n).toContain('**다음 단계**:')
    }
  })

  it('압축 뒤 복구 규칙이 안내 본문에 있다', () => {
    expect(router).toContain('## 압축 뒤')
    expect(router).toContain('압축 요약의 기억으로 단계 절차를 대신하지 않는다')
  })

  it('caps 표식과 진입 표지 블록은 안내 본문에 남는다(팀장 precheck)', () => {
    expect(router).toMatch(/^<!-- dflow-caps: worker /m)
    expect(workerBlocks(router)[0].body).toContain('`--worker` 는 `/dflow-team` 팀장 전용 플래그다')
  })

  it('경로 텍스트: 각 경로가 자기 핵심 절차에 닿는다', () => {
    expect(routeText('manual')).toContain('## Phase 01-가 — 승인 스윕')
    expect(routeText('worker')).not.toContain('## Phase 01-가 — 승인 스윕')
    expect(routeText('resume')).toContain('3. **재개**(Phase 01 1번 「설계 선행 재개」)')
    expect(routeText('rework')).toContain('**재개가 아니라 재작업이다.**')
    for (const r of Object.keys(ROUTES) as (keyof typeof ROUTES)[]) expect(routeText(r), r).toContain('## Phase 06 — 마감')
  })
})
