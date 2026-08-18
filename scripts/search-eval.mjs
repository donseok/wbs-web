#!/usr/bin/env node
// 검색 품질 측정 — Recall@10 · MRR
// 기준선은 /api/wiki/ask 하나로 고정한다(현행 검색이 4벌이라 '현행'이 모호하다).
// 새 검색은 /api/wiki/search(Task 8).

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))

const args = process.argv.slice(2)
const flagValue = (name) => {
  const hit = args.find(a => a.startsWith(`--${name}=`))
  return hit ? hit.slice(name.length + 3) : undefined
}

const BASE = flagValue('base') ?? 'http://localhost:3000'
const PROJECT = flagValue('project')
const COOKIE = process.env.EVAL_COOKIE

if (!PROJECT || !COOKIE) {
  console.error('사용법: EVAL_COOKIE=... node scripts/search-eval.mjs --project=<uuid> [--base=URL]')
  console.error('')
  console.error('예시:')
  console.error('  EVAL_COOKIE="sessionId=..." node scripts/search-eval.mjs --project=550e8400-e29b-41d4-a716-446655440000')
  process.exit(1)
}

const setPath = join(__dirname, '../tests/search/eval-set.json')
let set
try {
  set = JSON.parse(readFileSync(setPath, 'utf8'))
} catch (err) {
  console.error(`✗ 평가 세트를 읽지 못했습니다: ${setPath}`)
  console.error(err instanceof Error ? err.message : String(err))
  process.exit(1)
}

if (!Array.isArray(set.cases) || set.cases.length === 0) {
  console.error(`✗ 평가 세트가 비어 있습니다.`)
  console.error(`못 찾았던 검색어 사례를 ${setPath} 에 채우세요.`)
  console.error('')
  console.error('형식:')
  console.error(JSON.stringify(set._example, null, 2))
  process.exit(1)
}

async function post(path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', cookie: `${COOKIE}` },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    console.error(`✗ ${path}: HTTP ${res.status}`)
    return null
  }
  return res.json()
}

function score(hitIds, expected) {
  const wanted = new Set(expected.map(e => `${e.domain}:${e.entityId}`))
  const top10 = hitIds.slice(0, 10)
  const recall = top10.some(id => wanted.has(id)) ? 1 : 0
  const rank = top10.findIndex(id => wanted.has(id))
  return { recall, rr: rank === -1 ? 0 : 1 / (rank + 1) }
}

const totals = { next: { recall: 0, rr: 0 }, base: { recall: 0, rr: 0 } }

console.log('\n=== 검색 품질 측정 ===\n')

for (const testCase of set.cases) {
  // 새 검색: /api/wiki/search
  const next = await post('/api/wiki/search', { projectId: PROJECT, q: testCase.q })
  const nextIds = (next?.results ?? []).map(r => `${r.domain}:${r.entityId}`)
  const nextScore = score(nextIds, testCase.expect)

  // 기준선: /api/wiki/ask
  // BotSource 형태: { id, domain, entityType, entityId, projectId, title, href, ... }
  const base = await post('/api/wiki/ask', { projectId: PROJECT, question: testCase.q })
  const baseIds = (base?.sources ?? []).map(s => `${s.domain}:${s.entityId}`)
  const baseScore = score(baseIds, testCase.expect)

  totals.next.recall += nextScore.recall
  totals.next.rr += nextScore.rr
  totals.base.recall += baseScore.recall
  totals.base.rr += baseScore.rr

  const newMark = nextScore.recall ? '✓' : '✗'
  const baseMark = baseScore.recall ? '✓' : '✗'
  console.log(`${newMark} (기준선 ${baseMark})  ${testCase.q}`)
}

const n = set.cases.length
console.log(`\n           Recall@10   MRR`)
console.log(`기준선     ${totals.base.recall}/${n}        ${(totals.base.rr / n).toFixed(3)}`)
console.log(`새 검색    ${totals.next.recall}/${n}        ${(totals.next.rr / n).toFixed(3)}`)
console.log('')
