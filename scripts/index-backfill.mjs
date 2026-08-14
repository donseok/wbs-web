#!/usr/bin/env node
// 초기 백필 러너 — 기존 /api/chat/index/worker 의 mode:'backfill' 을 호출한다.
// Vercel 함수 타임아웃 안에 2,200건이 안 끝나므로 로컬에서 나눠 돈다.
// content_hash 가 있어 재실행이 멱등이다 — 중단해도 다시 돌리면 된다.
// 백필 후 analyze 를 통계를 갱신해야 한다 — 없으면 검색이 9배 느려진다(15ms → 232ms).

import { setTimeout as sleep } from 'node:timers/promises'
import { execFileSync } from 'node:child_process'
import { PROD_REF, STAGING_REF } from './lib/staging.config.mjs'

const args = process.argv.slice(2)

const flag = (name, fallback) => {
  const hit = args.find(a => a.startsWith(`--${name}=`))
  return hit ? hit.slice(name.length + 3) : fallback
}

const flagArg = (name) => {
  const i = args.indexOf(`--${name}`)
  return i !== -1 ? args[i + 1] : undefined
}

const BASE = flag('base', 'http://localhost:3000')
const SECRET = process.env.CHAT_V2_INDEX_CRON_SECRET
const DOMAINS = flag('domains', 'minutes,issues,wbs,announcements').split(',').filter(Boolean)
const BATCH = Number(flag('batch', '25'))
const PAUSE_MS = Number(flag('pause', '3000'))
const TARGET = flagArg('target')

// 토큰은 두 경로 중 하나 (db-apply.mjs 와 동일)
function accessToken() {
  const fromEnv = process.env.SUPABASE_ACCESS_TOKEN?.trim()
  if (fromEnv) return fromEnv
  let raw
  try {
    raw = execFileSync(
      'security',
      ['find-generic-password', '-s', 'Supabase CLI', '-a', 'supabase', '-w'],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
    ).trim()
  } catch {
    // 토큰 없어도 백필은 가능하지만 analyze 가 실패한다
    return null
  }
  return raw.startsWith('go-keyring-base64:')
    ? Buffer.from(raw.slice('go-keyring-base64:'.length), 'base64').toString()
    : raw
}

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
      // 요약은 { mode, claimed, upserted, deleted, failed, requeued, claimFailed? } 로 평탄하게 온다.
      // claimFailed 가 있으면 조회 실패 — 백필을 중단하고 에러로 보고한다(3원칙).
      if (summary?.claimFailed) {
        throw new Error(`claim 실패: ${summary.claimFailed}`)
      }
      // claimed=0 이면 처리할 것이 없다 — 끝.
      if (!summary?.claimed) {
        console.log(`✓ 라운드 ${round}에서 처리할 항목 없음 — 백필 완료`)
        break
      }
      await sleep(PAUSE_MS)
    }

    // Step 3: 통계 갱신 (analyze)
    if (!TARGET) {
      console.warn(`
⚠ --target 플래그가 없어서 analyze 를 건너뜁니다.
통계가 낡으면 검색이 9배 느려집니다(15ms → 232ms).
직접 다음을 실행하세요:

  analyze public.ai_documents;

또는 --target staging|prod 로 다시 실행하면 자동으로 analyze 됩니다.
`)
    } else {
      const REFS = { staging: STAGING_REF, prod: PROD_REF }
      if (!REFS[TARGET]) {
        throw new Error(`--target 은 staging|prod 중 하나여야 함 (현재: ${TARGET})`)
      }
      const ref = REFS[TARGET]
      const token = accessToken()
      if (!token) {
        throw new Error('Supabase Management API 토큰을 찾을 수 없습니다. SUPABASE_ACCESS_TOKEN 을 설정하거나 npx supabase login 하세요.')
      }

      console.log('\n=== 통계 갱신 (analyze) ===')
      const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: 'analyze public.ai_documents' }),
      })
      if (!res.ok) {
        const text = await res.text()
        throw new Error(`analyze 실패: ${res.status} ${res.statusText}\n${text}`)
      }
      console.log('✓ analyze 완료 — 통계 갱신됨')
    }
  } catch (err) {
    console.error('\n✗ 백필 실패:')
    console.error(err instanceof Error ? err.message : String(err))
    process.exit(1)
  }
}

main()
