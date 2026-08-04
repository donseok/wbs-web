#!/usr/bin/env node
/**
 * 묶음 파일들 → areas.json 하나로 합친다.
 *
 * 왜 파일을 쪼개서 쓰는가:
 *   초안을 LLM 으로 만들 때 한 영역을 한 번에 뱉게 하면 출력 토큰 상한(8192)에 걸려
 *   **응답이 통째로 유실된다.** 2026-08-04 에 14개 영역이 전부 이 이유로 죽었다.
 *   L3 묶음 하나당 파일 하나로 나눠 쓰게 하면 응답당 출력이 작아져 상한에 걸리지 않는다.
 *   이 스크립트는 그렇게 쪼개진 것을 되돌린다.
 *
 * 입력 파일 하나의 형태 — <KEY>.<nn>.json:
 *   { key, l1, l2, l2Deliverable, seq, name, deliverable, start, end, weight,
 *     tasks: [ { name, deliverable, start, end, weight } ] }
 *
 * 순서는 파일명이 아니라 seq 를 정본으로 본다(파일을 순서 없이 썼을 수 있다).
 * 영역 순서는 --order 로 주고, 없으면 key 사전순이다.
 *
 * 사용:
 *   node scripts/wbs/merge-groups.mjs <dir> <areas.json>
 *   node scripts/wbs/merge-groups.mjs <dir> <areas.json> --order A1,A2,B1,C1
 *
 * 종료 코드: 0 정상 / 1 구조 결손 발견
 */
import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const [dir, out, ...rest] = process.argv.slice(2)
if (!dir || !out) {
  console.error('사용법: node scripts/wbs/merge-groups.mjs <dir> <areas.json> [--order A1,A2,...]')
  process.exit(1)
}
const order = rest.includes('--order') ? rest[rest.indexOf('--order') + 1].split(',') : null

const problems = []
const byKey = new Map()

for (const f of readdirSync(dir).filter(f => f.endsWith('.json')).sort()) {
  let j
  try { j = JSON.parse(readFileSync(join(dir, f), 'utf8')) }
  catch (e) { problems.push(`${f}: JSON 파싱 실패 — ${e.message}`); continue }

  for (const k of ['key', 'l1', 'l2', 'name', 'start', 'end', 'tasks']) {
    if (j[k] === undefined) problems.push(`${f}: 필드 누락 '${k}'`)
  }
  if (!Array.isArray(j.tasks) || j.tasks.length === 0) {
    problems.push(`${f}: tasks 가 비어 있음`)
    continue
  }

  if (!byKey.has(j.key)) {
    byKey.set(j.key, { key: j.key, l1: j.l1, l2: j.l2, l2Deliverable: j.l2Deliverable ?? '', children: [] })
  }
  const area = byKey.get(j.key)
  if (j.l2Deliverable && !area.l2Deliverable) area.l2Deliverable = j.l2Deliverable

  area.children.push({
    seq: Number(j.seq ?? 0),
    name: j.name,
    deliverable: j.deliverable ?? '',
    start: j.start, end: j.end, weight: Number(j.weight ?? 0),
    children: j.tasks.map(t => ({
      name: t.name, deliverable: t.deliverable ?? '',
      start: t.start, end: t.end, weight: Number(t.weight ?? 0),
    })),
  })
}

for (const a of byKey.values()) a.children.sort((x, y) => x.seq - y.seq || x.name.localeCompare(y.name))

const keys = order ?? [...byKey.keys()].sort()
const missing = keys.filter(k => !byKey.has(k))
if (missing.length) problems.push(`영역 자체가 없음: ${missing.join(', ')}`)

const areas = keys.filter(k => byKey.has(k)).map(k => byKey.get(k))
writeFileSync(out, JSON.stringify({ areas }, null, 2))

const leaves = areas.reduce((s, a) => s + a.children.reduce((t, c) => t + c.children.length, 0), 0)
console.log(`영역 ${areas.length} · 묶음 ${areas.reduce((s, a) => s + a.children.length, 0)} · 최말단 ${leaves}`)
for (const a of areas) {
  const n = a.children.reduce((t, c) => t + c.children.length, 0)
  console.log(`  ${a.key.padEnd(4)} ${a.l2.padEnd(24)} 묶음 ${String(a.children.length).padStart(2)} · 최말단 ${String(n).padStart(3)}`)
}
if (problems.length) {
  console.log(`\n문제 ${problems.length}건`)
  problems.forEach(p => console.log('  · ' + p))
  process.exit(1)
}
console.log('\n구조 문제 없음')
