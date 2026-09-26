// tests/skills/_dflow-dev.ts — /dflow-dev 스킬 문서를 읽는 공용 헬퍼.
// SKILL.md 는 안내 본문이고 단계 절차는 references/orch/*.md 에 있다(설계 2026-09-26-dflow-dev-skill-router-design.md).
// 문구 검사는 "그 규칙이 어느 파일엔가 있는가" 를 보므로 안내 본문과 단계 파일을 이어 붙인 devAll() 을 쓴다.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const DEV_DIR = join(process.cwd(), '.claude/skills/dflow-dev')

export const devRouter = (): string => readFileSync(join(DEV_DIR, 'SKILL.md'), 'utf8')

export const devOrch = (name: string): string => readFileSync(join(DEV_DIR, 'references/orch', `${name}.md`), 'utf8')

/** 안내 본문 「단계 지도」 의 fail-closed 문장이 정한 단계 파일 순서(정본은 SKILL.md 한 곳). */
export function orchOrder(router = devRouter()): string[] {
  const m = router.match(/((?:[a-z-]+·){3,}[a-z-]+) 순서로 모두 읽는다/)
  if (!m) throw new Error('SKILL.md 「단계 지도」 에서 단계 파일 순서를 찾지 못했다')
  return m[1].split('·')
}

/** 안내 본문 + 단계 파일 전부(단계 지도 순서). */
export function devAll(): string {
  const router = devRouter()
  return [router, ...orchOrder(router).map(devOrch)].join('\n')
}

/** 안내 본문과 단계 파일을 이름별로. */
export function devFiles(): Record<string, string> {
  const router = devRouter()
  return Object.fromEntries([['SKILL.md', router], ...orchOrder(router).map((n) => [`orch/${n}.md`, devOrch(n)])])
}

/** 경로별로 읽는 파일(단계 지도의 행을 따라간 순서). 도달성 검사용. */
export const ROUTES = {
  manual: ['sweep', 'start', 'base', 'claim', 'baseline', 'phase-common', 'design', 'build', 'verify', 'refactor', 'close'],
  worker: ['start', 'base', 'claim', 'design-first', 'baseline', 'phase-common', 'design', 'build', 'verify', 'close'],
  resume: ['start', 'design-first', 'base', 'baseline', 'phase-common', 'design', 'build', 'verify', 'close'],
  rework: ['sweep', 'start', 'rework', 'phase-common', 'design', 'build', 'verify', 'refactor', 'close'],
} as const

export function routeText(route: keyof typeof ROUTES): string {
  const extra = route === 'worker' || route === 'resume'
    ? [readFileSync(join(DEV_DIR, 'references/worker-mode.md'), 'utf8')] : []
  return [devRouter(), ...extra, ...ROUTES[route].map(devOrch)].join('\n')
}
