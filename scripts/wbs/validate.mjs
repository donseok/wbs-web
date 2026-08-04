#!/usr/bin/env node
/**
 * WBS 초안 정합 검사 — xlsx 로 굽기 전에 JSON 단계에서 잡는다.
 *
 * 왜 필요한가:
 *   초안을 여러 사람(또는 여러 에이전트)이 영역을 나눠 쓰면 개별 영역은 멀쩡한데
 *   합쳐 놓으면 어긋난다. 2026-08-04 Track3 초안에서 실제로 나온 것들이다:
 *     · 상위 묶음 기간이 하위 작업 범위와 안 맞음 (간트가 엉뚱하게 그려진다)
 *     · 형제 가중치 합이 1.0 이 아님 (롤업 공정율이 조용히 틀어진다)
 *     · 주말·공휴일에 시작하거나 끝남 (계획% 계산이 실제와 어긋난다)
 *     · 선행 작업이 끝나기 전에 후행이 시작 (사슬이 성립하지 않는다)
 *   앞 셋은 여기서 전부 잡는다. 마지막은 --chain 으로 규칙을 줘야 잡을 수 있다.
 *
 * 사용:
 *   node scripts/wbs/validate.mjs <areas.json>
 *   node scripts/wbs/validate.mjs <areas.json> --chain chain.json
 *
 * chain.json 형태 — 선행 종료 < 후행 착수 를 검사한다:
 *   [ { "label": "환경 구축 → 구현 착수", "before": "환경 오픈", "after": "DDL 적용" } ]
 *   before/after 는 작업명에 대한 정규식이다. 매칭이 0건이면 '판정불가'로 보고한다.
 *
 * 종료 코드: 0 통과 / 1 문제 발견
 */
import { readFileSync } from 'node:fs'

const HOLIDAYS = new Set(['2026-08-15', '2026-10-03', '2026-10-09', '2026-12-25'])

const [src, ...rest] = process.argv.slice(2)
if (!src) {
  console.error('사용법: node scripts/wbs/validate.mjs <areas.json> [--chain chain.json]')
  process.exit(1)
}
const chainPath = rest.includes('--chain') ? rest[rest.indexOf('--chain') + 1] : null

const { areas } = JSON.parse(readFileSync(src, 'utf8'))
const problems = []
const leaves = []

function isWeekend(iso) {
  const d = new Date(iso + 'T12:00:00').getDay()
  return d === 0 || d === 6
}

function checkGroup(label, nodes) {
  const sum = nodes.reduce((s, n) => s + (Number(n.weight) || 0), 0)
  // weight 가 전부 null 이면 '형제 균등'이라는 뜻이라 통과시킨다(임포터 계약).
  if (nodes.every(n => n.weight == null)) return
  if (Math.abs(sum - 1) > 0.005) problems.push(`${label}: 형제 가중치 합 ${sum.toFixed(4)} (자식 ${nodes.length}개)`)
}

function checkDates(label, t) {
  if (!t.start || !t.end) { problems.push(`${label}: 날짜 누락`); return }
  if (t.start > t.end) problems.push(`${label}: 시작(${t.start}) > 종료(${t.end})`)
  if (isWeekend(t.start)) problems.push(`${label}: 시작이 주말 (${t.start})`)
  if (isWeekend(t.end)) problems.push(`${label}: 종료가 주말 (${t.end})`)
  if (HOLIDAYS.has(t.start) || HOLIDAYS.has(t.end)) problems.push(`${label}: 공휴일에 시작·종료`)
}

checkGroup('최상위', areas)
for (const a of areas) {
  const l3 = a.children ?? []
  if (l3.length === 0) { problems.push(`${a.key ?? a.l2}: 하위 묶음이 없음`); continue }
  checkGroup(`${a.key ?? a.l2}`, l3)

  for (const [i, c3] of l3.entries()) {
    const tag = `${a.key ?? a.l2}.${i + 1} ${c3.name}`
    const kids = c3.children ?? []
    if (kids.length === 0) { problems.push(`${tag}: 최말단 작업이 없음`); continue }
    checkGroup(tag, kids)

    // 상위 묶음 기간은 하위 최소~최대와 정확히 같아야 한다.
    const ss = kids.map(t => t.start).filter(Boolean).sort()[0]
    const ee = kids.map(t => t.end).filter(Boolean).sort().pop()
    if (c3.start !== ss || c3.end !== ee) {
      problems.push(`${tag}: 묶음 기간(${c3.start}~${c3.end}) ≠ 하위 범위(${ss}~${ee})`)
    }

    for (const [j, t] of kids.entries()) {
      checkDates(`${tag} / ${j + 1} ${t.name}`, t)
      if (!t.deliverable) problems.push(`${tag} / ${j + 1} ${t.name}: 산출물 없음`)
      leaves.push({ area: a.key ?? a.l2, ...t })
    }
  }
}

const chainReport = []
if (chainPath) {
  for (const rule of JSON.parse(readFileSync(chainPath, 'utf8'))) {
    const before = leaves.filter(t => new RegExp(rule.before).test(t.name))
    const after = leaves.filter(t => new RegExp(rule.after).test(t.name))
    if (!before.length || !after.length) {
      chainReport.push(`?  ${rule.label} — 매칭 실패(before ${before.length} / after ${after.length})`)
      continue
    }
    const bEnd = before.map(t => t.end).sort().pop()
    const aStart = after.map(t => t.start).sort()[0]
    const ok = bEnd < aStart
    chainReport.push(`${ok ? 'OK' : '✗ '} ${rule.label}  ${bEnd} → ${aStart}`)
    if (!ok) problems.push(`사슬 역전: ${rule.label} (선행 종료 ${bEnd} ≥ 후행 착수 ${aStart})`)
  }
}

console.log(`영역 ${areas.length} · 묶음 ${areas.reduce((s, a) => s + (a.children?.length ?? 0), 0)} · 최말단 ${leaves.length}`)
if (chainReport.length) {
  console.log('\n사슬 검사')
  chainReport.forEach(l => console.log('  ' + l))
}
if (problems.length) {
  console.log(`\n문제 ${problems.length}건`)
  problems.slice(0, 60).forEach(p => console.log('  · ' + p))
  if (problems.length > 60) console.log(`  ... 외 ${problems.length - 60}건`)
  process.exit(1)
}
console.log('\n검사 통과')
