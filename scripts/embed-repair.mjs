#!/usr/bin/env node
// 임베딩 복구 러너 — `ai_documents.embedding is null` 인 행만 채운다.
//
// 왜 별도 러너인가:
//   위키 검색 색인의 유일한 트리거는 브라우저 버튼(WikiReindexButton)인데, 그 루프는
//   브라우저가 주도해서 검색하거나 화면을 옮기면 끊긴다. 2,385청크 중 1,199건이 남은
//   상황에서 60회 이상 클릭 루프를 사람이 지키고 있어야 한다. 이 러너는 같은 일을
//   터미널에서 끝까지 돌린다.
//
// 왜 route 가 아니라 직접 호출인가:
//   scripts/index-backfill.mjs --repair 는 /api/chat/index/worker 를 거치므로 크론
//   시크릿과 서버리스 타임아웃에 묶인다. 여기서는 Supabase REST + Gemini 를 직접 부른다.
//   임베딩 계약(모델·차원·taskType)은 src/lib/ai/embeddings.ts 와 반드시 동일하게 유지할 것 —
//   다르면 기존 벡터와 의미 공간이 섞여 검색 품질이 조용히 무너진다.
//
// 사용법:
//   node scripts/embed-repair.mjs --target prod
//   node scripts/embed-repair.mjs --target staging --max 100
//   node scripts/embed-repair.mjs --target prod --dry-run
//
// env 파일을 교체하지 않는다(.env.local 을 건드리면 이 PC 의 병렬 세션이 전부 영향받는다).
// --target 에 맞는 .env.local.<target> 을 직접 읽는다.

import { readFileSync } from 'node:fs'
import { setTimeout as sleep } from 'node:timers/promises'
import { execFileSync } from 'node:child_process'
import { PROD_REF, STAGING_REF } from './lib/staging.config.mjs'

const args = process.argv.slice(2)
const flagValue = name => {
  const eq = args.find(a => a.startsWith(`--${name}=`))
  if (eq) return eq.slice(name.length + 3)
  const i = args.indexOf(`--${name}`)
  return i !== -1 ? args[i + 1] : undefined
}

const TARGET = flagValue('target')
const BATCH = Number(flagValue('batch') ?? 25)
const CONCURRENCY = Number(flagValue('concurrency') ?? 5)
const MAX = Number(flagValue('max') ?? Infinity)
const DRY_RUN = args.includes('--dry-run')

// src/lib/ai/embeddings.ts 와 동일해야 하는 계약. 바꾸려면 양쪽을 같이 바꾸고,
// 기존 벡터를 전부 다시 만들어야 한다(섞으면 안 된다).
const EMBED_MODEL = 'gemini-embedding-001'
const EMBED_DIM = 768
const TASK_TYPE = 'RETRIEVAL_DOCUMENT'
const MAX_EMBED_CHARS = 8000
const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta'

if (TARGET !== 'prod' && TARGET !== 'staging') {
  console.error('✗ --target 은 prod 또는 staging 이어야 합니다.')
  process.exit(1)
}
for (const [label, value] of [['batch', BATCH], ['concurrency', CONCURRENCY]]) {
  if (!Number.isFinite(value) || value < 1) {
    console.error(`✗ --${label} 는 1 이상의 수여야 합니다 (현재: ${value})`)
    process.exit(1)
  }
}

const REF = TARGET === 'prod' ? PROD_REF : STAGING_REF

function readEnvFile(path) {
  let raw
  try {
    raw = readFileSync(path, 'utf8')
  } catch {
    console.error(`✗ ${path} 를 읽을 수 없습니다.`)
    process.exit(1)
  }
  const out = {}
  for (const line of raw.split('\n')) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim())
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, '').trim()
  }
  return out
}

const env = readEnvFile(new URL(`../.env.local.${TARGET}`, import.meta.url).pathname)
const SUPABASE_URL = env.NEXT_PUBLIC_SUPABASE_URL
const SERVICE_KEY = env.SUPABASE_SERVICE_ROLE_KEY
const GEMINI_KEY = env.GEMINI_API_KEY || env.GOOGLE_API_KEY

// 조회 실패를 "데이터 없음"으로 위장하지 않는다 — 없으면 즉시 멈춘다.
for (const [name, value] of [
  ['NEXT_PUBLIC_SUPABASE_URL', SUPABASE_URL],
  ['SUPABASE_SERVICE_ROLE_KEY', SERVICE_KEY],
  ['GEMINI_API_KEY', GEMINI_KEY],
]) {
  if (!value) {
    console.error(`✗ .env.local.${TARGET} 에 ${name} 이 없습니다.`)
    process.exit(1)
  }
}
// URL 이 --target 과 어긋나면(파일 교체 사고) 엉뚱한 DB 를 고친다 — 선제 차단.
if (!SUPABASE_URL.includes(REF)) {
  console.error(`✗ .env.local.${TARGET} 의 URL(${SUPABASE_URL})이 ${TARGET} ref(${REF})와 다릅니다.`)
  process.exit(1)
}

const rest = (path, init = {}) =>
  fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
    },
  })

async function countRemaining() {
  const res = await rest('ai_documents?select=id&embedding=is.null', {
    method: 'HEAD',
    headers: { Prefer: 'count=exact', Range: '0-0' },
  })
  if (!res.ok) throw new Error(`남은 건수 조회 실패: HTTP ${res.status}`)
  const range = res.headers.get('content-range') // "0-0/1199"
  const total = Number(range?.split('/')[1])
  if (!Number.isFinite(total)) throw new Error(`content-range 를 해석하지 못했습니다: ${range}`)
  return total
}

async function fetchBatch(limit) {
  const res = await rest(`ai_documents?select=id,content&embedding=is.null&order=id&limit=${limit}`)
  if (!res.ok) throw new Error(`대상 행 조회 실패: HTTP ${res.status} ${await res.text()}`)
  const rows = await res.json()
  if (!Array.isArray(rows)) throw new Error('대상 행 응답이 배열이 아닙니다.')
  return rows.filter(r => typeof r?.id === 'string' && typeof r?.content === 'string')
}

class QuotaExhausted extends Error {}

/** 단건 임베딩. 429 는 분당/일일을 구분한다 — 일일 소진이면 더 돌려도 소용없으므로 즉시 중단시킨다. */
async function embedOne(text) {
  const capped = text.length > MAX_EMBED_CHARS ? text.slice(0, MAX_EMBED_CHARS) : text
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(`${GEMINI_BASE}/models/${EMBED_MODEL}:embedContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': GEMINI_KEY },
      body: JSON.stringify({
        model: `models/${EMBED_MODEL}`,
        content: { parts: [{ text: capped }] },
        taskType: TASK_TYPE,
        outputDimensionality: EMBED_DIM,
      }),
    })
    if (res.ok) {
      const json = await res.json()
      const values = json?.embedding?.values
      // 차원이 다르면 vector(768) 에 넣을 수 없다 — 조용히 넘기지 않고 실패로 센다.
      if (!Array.isArray(values) || values.length !== EMBED_DIM) {
        throw new Error(`차원 불일치: ${values?.length ?? 0} (기대 ${EMBED_DIM})`)
      }
      return values
    }
    const body = await res.text()
    if (res.status === 429) {
      if (/per ?day|PerDay|daily/i.test(body)) throw new QuotaExhausted(body.slice(0, 400))
      if (attempt < 5) { await sleep(4000 * 2 ** attempt); continue }
      throw new QuotaExhausted(body.slice(0, 400))
    }
    if ((res.status === 503 || res.status === 500) && attempt < 4) {
      await sleep(1000 * 2 ** attempt)
      continue
    }
    throw new Error(`embed ${res.status}: ${body.slice(0, 200)}`)
  }
}

async function saveVector(id, vector) {
  const res = await rest(`ai_documents?id=eq.${id}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({ embedding: vector }),
  })
  if (!res.ok) throw new Error(`저장 실패(${id}): HTTP ${res.status} ${(await res.text()).slice(0, 160)}`)
}

function accessToken() {
  const fromEnv = process.env.SUPABASE_ACCESS_TOKEN?.trim()
  if (fromEnv) return fromEnv
  try {
    const raw = execFileSync(
      'security',
      ['find-generic-password', '-s', 'Supabase CLI', '-a', 'supabase', '-w'],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
    ).trim()
    return raw.startsWith('go-keyring-base64:')
      ? Buffer.from(raw.slice('go-keyring-base64:'.length), 'base64').toString()
      : raw
  } catch {
    return null
  }
}

async function analyze() {
  const token = accessToken()
  if (!token) {
    console.warn('⚠ Supabase 토큰이 없어 analyze 를 건너뜁니다. 통계가 낡으면 검색이 느려집니다.')
    return
  }
  const res = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: 'analyze public.ai_documents' }),
  })
  if (!res.ok) {
    console.warn(`⚠ analyze 실패: HTTP ${res.status} ${(await res.text()).slice(0, 160)}`)
    return
  }
  console.log('✓ analyze 완료 — 통계 갱신됨')
}

async function main() {
  const startRemaining = await countRemaining()
  console.log(`
=== 임베딩 복구 ===
대상      : ${TARGET} (${REF})
모델      : ${EMBED_MODEL} · ${EMBED_DIM}차원 · ${TASK_TYPE}
남은 행   : ${startRemaining}
배치/동시 : ${BATCH} / ${CONCURRENCY}${Number.isFinite(MAX) ? `\n상한      : ${MAX}` : ''}${DRY_RUN ? '\n모드      : DRY-RUN (쓰기 없음)' : ''}
`)
  if (startRemaining === 0) {
    console.log('✓ 남은 항목이 없습니다.')
    return
  }

  let repaired = 0
  let failed = 0
  let quotaHit = null
  const failSamples = []

  outer: while (repaired + failed < Math.min(startRemaining, MAX)) {
    const want = Math.min(BATCH, MAX - (repaired + failed))
    // 실패한 행은 null 로 남으므로 같은 행이 다시 잡힌다 — offset 으로 건너뛴다.
    const rows = (await fetchBatch(want + failed)).slice(failed)
    if (rows.length === 0) break

    let cursor = 0
    const worker = async () => {
      for (;;) {
        const i = cursor++
        if (i >= rows.length) return
        const row = rows[i]
        try {
          const vector = await embedOne(row.content)
          if (!DRY_RUN) await saveVector(row.id, vector)
          repaired++
        } catch (e) {
          if (e instanceof QuotaExhausted) { quotaHit = e.message; throw e }
          failed++
          if (failSamples.length < 5) failSamples.push(`${row.id}: ${e.message}`)
        }
      }
    }
    try {
      await Promise.all(Array.from({ length: Math.min(CONCURRENCY, rows.length) }, worker))
    } catch (e) {
      if (e instanceof QuotaExhausted) break outer
      throw e
    }
    const done = repaired + failed
    process.stdout.write(`  진행 ${done}/${Math.min(startRemaining, MAX)} (성공 ${repaired} · 실패 ${failed})\n`)
    await sleep(300)
  }

  const endRemaining = await countRemaining()
  console.log(`
=== 결과 ===
성공      : ${repaired}
실패      : ${failed}
남은 행   : ${endRemaining} (시작 ${startRemaining})`)
  if (failSamples.length) console.log(`실패 샘플 :\n  ${failSamples.join('\n  ')}`)
  if (quotaHit) {
    console.log(`
⚠ 일일 쿼터 소진으로 중단했습니다. 내일(태평양 자정 = KST 16:00 리셋) 다시 실행하면 이어집니다.
  ${quotaHit.replace(/\n/g, ' ').slice(0, 300)}`)
  }
  if (!DRY_RUN && repaired > 0) await analyze()
  if (endRemaining > 0) console.log(`\n남은 ${endRemaining}건은 같은 명령을 다시 실행하면 이어집니다(멱등).`)
  else console.log('\n✓ 임베딩 100% 완주.')
}

main().catch(err => {
  console.error('\n✗ 복구 실패:', err instanceof Error ? err.message : String(err))
  process.exit(1)
})
