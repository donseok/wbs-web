#!/usr/bin/env node
// 초기 백필 러너 — 기존 /api/chat/index/worker 의 mode:'backfill' 을 호출한다.
// Vercel 함수 타임아웃 안에 2,200건이 안 끝나므로 로컬에서 나눠 돈다.
// content_hash 가 있어 재실행이 멱등이다 — 중단해도 다시 돌리면 된다.
// 백필 후 analyze 를 통계를 갱신해야 한다 — 없으면 검색이 9배 느려진다(15ms → 232ms).
//
// --repair: mode:'backfill'/'worker' 대신 mode:'repair' 를 반복 호출한다. 0085 클로버
// 방지가 재발은 막지만, 과거에 이미 null 로 덮인 임베딩(운영 실측 808→651)은 복구해야
// 채워진다 — 그 복구 전용 경로. 임베딩 API 키가 Vercel 에만 있어 서버(route)에서 돌아야
// 하고, 로컬에서는 이 스크립트로 반복 호출만 한다.

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
const REPAIR = args.includes('--repair')

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

async function runRepair() {
  console.log('\n=== 복구 모드 (embedding is null 행만 재시도) ===')
  let round = 0
  let lastStillNull = Infinity
  for (;;) {
    const summary = await call({ mode: 'repair', batchSize: BATCH })
    round += 1
    console.log(`#${round}:`, JSON.stringify(summary))
    // 요약은 { mode, scanned, repaired, stillNull } 로 온다.
    if (!summary || typeof summary.stillNull !== 'number') {
      throw new Error(`repair 응답 형태가 예상과 다릅니다: ${JSON.stringify(summary)}`)
    }
    if (!summary.scanned) {
      console.log(`✓ 라운드 ${round}에서 남은 null 임베딩 없음 — 복구 완료`)
      break
    }
    // stillNull 이 줄지 않으면(같은 항목이 계속 실패) 더 돌려도 소용없다 — 무한 루프 방지.
    if (summary.stillNull >= lastStillNull) {
      console.warn(
        `✗ stillNull(${summary.stillNull})이 이전 라운드(${lastStillNull})보다 줄지 않았습니다 — 중단합니다.\n` +
        '  남은 항목은 임베딩 API 가 계속 거부하는 본문(예: 여전히 너무 긴 텍스트)일 수 있습니다.',
      )
      break
    }
    lastStillNull = summary.stillNull
    await sleep(PAUSE_MS)
  }
}

async function main() {
  try {
    if (REPAIR) {
      await runRepair()
      return
    }

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
