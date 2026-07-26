// 일회성 운영 러너 — Wiki 전량 재구축을 로컬에서 프로덕션과 같은 코드 경로로 실행한다.
// Vercel이 sensitive env(WIKI_WORKER_SECRET)를 내려주지 않아 /api/wiki/worker를 직접
// 호출할 수 없고, cron은 하루 1회 limit=10이라 즉시 실행이 불가능해서 쓴다.
//
// 실행: npx vitest run --config scripts/wiki-rebuild.vitest.ts
// (vitest를 쓰는 이유는 'server-only' 별칭과 tsconfig paths가 이미 설정돼 있기 때문이다.)
//
// 안전성: 이 러너는 앱과 동일한 runWikiWorkerOnce만 호출한다. lease/generation 펜싱이
// 그대로 적용되므로 같은 시각 Vercel cron이 돌아도 서로 덮어쓰지 않는다.
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

function loadEnvLocal(): void {
  const raw = readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
  for (const line of raw.split('\n')) {
    const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim())
    if (!match) continue
    const [, key, rawValue] = match
    if (process.env[key]) continue
    process.env[key] = rawValue.replace(/^"(.*)"$/, '$1')
  }
}

loadEnvLocal()

const { runWikiWorkerOnce } = await import('@/lib/ai/wiki-ingest')

describe('wiki 전량 재구축', () => {
  it('더 처리할 작업이 없을 때까지 워커를 반복 실행한다', async () => {
    expect(process.env.SUPABASE_SERVICE_ROLE_KEY, '.env.local 로드 실패').toBeTruthy()

    let round = 0
    let totalAttempted = 0
    let totalCompleted = 0
    // 무한 루프 방지 상한. 회의록 13건 기준 필요 라운드는 1~2회다.
    while (round < 12) {
      round += 1
      const result = await runWikiWorkerOnce(20)
      totalAttempted += result.attempted
      totalCompleted += result.completed
      console.log(`[round ${round}] attempted=${result.attempted} completed=${result.completed}`)
      if (result.attempted === 0) break
    }

    console.log(`총 시도 ${totalAttempted}건 / 전진 ${totalCompleted}건 (라운드 ${round})`)
    expect(totalAttempted).toBeGreaterThan(0)
  }, 3_600_000)
})
