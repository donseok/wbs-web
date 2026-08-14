#!/usr/bin/env node
// 초기 백필 러너 — 기존 /api/chat/index/worker 의 mode:'backfill' 을 호출한다.
// Vercel 함수 타임아웃 안에 2,200건이 안 끝나므로 로컬에서 나눠 돈다.
// content_hash 가 있어 재실행이 멱등이다 — 중단해도 다시 돌리면 된다.

import { setTimeout as sleep } from 'node:timers/promises'

const args = process.argv.slice(2)

const flag = (name, fallback) => {
  const hit = args.find(a => a.startsWith(`--${name}=`))
  return hit ? hit.slice(name.length + 3) : fallback
}

const BASE = flag('base', 'http://localhost:3000')
const SECRET = process.env.CHAT_V2_INDEX_CRON_SECRET
const DOMAINS = flag('domains', 'minutes,issues,wbs,announcements').split(',').filter(Boolean)
const BATCH = Number(flag('batch', '25'))
const PAUSE_MS = Number(flag('pause', '3000'))

// 입력 검증
if (!SECRET) {
  console.error('✗ CHAT_V2_INDEX_CRON_SECRET 환경변수가 필요합니다.')
  process.exit(1)
}

if (!DOMAINS.length) {
  console.error('✗ --domains 인자는 최소 1개 도메인을 포함해야 합니다.')
  process.exit(1)
}

if (!Number.isFinite(BATCH) || BATCH < 1) {
  console.error(`✗ --batch 인자는 양수여야 합니다 (현재: ${BATCH})`)
  process.exit(1)
}

if (!Number.isFinite(PAUSE_MS) || PAUSE_MS < 0) {
  console.error(`✗ --pause 인자는 음이 아닌 정수여야 합니다 (현재: ${PAUSE_MS})`)
  process.exit(1)
}

console.log(`
=== 백필 구성 ===
Base URL: ${BASE}
Domains: ${DOMAINS.join(', ')}
Batch size: ${BATCH}
Pause between batches: ${PAUSE_MS}ms
`)

async function call(body) {
  const res = await fetch(`${BASE}/api/chat/index/worker`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-cron-secret': SECRET },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`HTTP ${res.status}: ${text}`)
  }
  return res.json()
}

async function main() {
  try {
    // Step 1: 각 도메인을 큐에 넣는다
    console.log('\n=== 도메인 큐잉 ===')
    for (const domain of DOMAINS) {
      console.log(`\n[${domain}]`)
      // route.ts:114-121 실측 형태 — { mode, domain, projectId?, dryRun?, batchSize? }
      const result = await call({ mode: 'backfill', domain })
      console.log(JSON.stringify(result, null, 2))
    }

    // Step 2: 워커 반복 실행
    console.log('\n=== 워커 반복 실행 ===')
    let round = 0
    for (;;) {
      const summary = await call({ mode: 'worker', batchSize: BATCH })
      round += 1
      console.log(`#${round}:`, JSON.stringify(summary))
      // 요약은 { mode, claimed, upserted, deleted, failed, requeued } 로 평탄하게 온다
      // (route.ts:108 `{ mode: 'worker', ...summary }`). 처리할 것이 없으면 끝.
      if (!summary?.claimed) {
        console.log(`✓ 라운드 ${round}에서 처리할 항목 없음 — 백필 완료`)
        break
      }
      await sleep(PAUSE_MS)
    }
  } catch (err) {
    console.error('\n✗ 백필 실패:')
    console.error(err instanceof Error ? err.message : String(err))
    process.exit(1)
  }
}

main()
