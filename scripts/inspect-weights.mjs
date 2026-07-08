// ---------------------------------------------------------------------------
// 가중치 스케일 진단 (READ ONLY — 아무것도 변경하지 않음)
//
// 목적: 0~1 → 0~100 스케일 마이그레이션 전에 실제 데이터 모양을 확인한다.
//   1) 전역 합이 1.0 인가? (leaf 기준 / 전체 기준)
//   2) null 과 명시값이 섞인 형제 그룹이 있는가? (rollup.ts 의 null→1 폴백이 스케일 민감)
//   3) 형제 합이 부모 가중치와 일치하는가? (전역 절대 지분 모델 검증)
//
// 사용:
//   supabase login   (최초 1회)
//   node scripts/inspect-weights.mjs
//
// 또는 SUPABASE_DB_URL / SUPABASE_SERVICE_ROLE_KEY 를 .env.local 에 넣어도 동작.
// ---------------------------------------------------------------------------
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

function readEnvLocal(key) {
  try {
    for (const line of readFileSync(join(root, '.env.local'), 'utf8').split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
      if (m && m[1] === key) return m[2].replace(/^['"]|['"]$/g, '').trim()
    }
  } catch {
    /* no .env.local */
  }
  return ''
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL || readEnvLocal('NEXT_PUBLIC_SUPABASE_URL')
const key = process.env.SUPABASE_SERVICE_ROLE_KEY || readEnvLocal('SUPABASE_SERVICE_ROLE_KEY')

if (!url || !key) {
  console.error('✗ NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 가 필요합니다.')
  console.error('  Supabase Dashboard > Project Settings > API > service_role key 를')
  console.error('  .env.local 의 SUPABASE_SERVICE_ROLE_KEY= 뒤에 붙여넣으세요.')
  process.exit(1)
}

const rest = async path => {
  const r = await fetch(`${url}/rest/v1/${path}`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` },
  })
  if (!r.ok) throw new Error(`${r.status} ${await r.text()}`)
  return r.json()
}

const num = v => (v == null ? null : Number(v))
const f = (n, d = 6) => (n == null ? 'null' : Number(n).toFixed(d))

const rows = await rest(
  'wbs_items?select=id,parent_id,project_id,level,code,name,weight,sort_order&order=sort_order',
)
console.log(`전체 항목: ${rows.length}`)

const byProject = new Map()
for (const r of rows) {
  if (!byProject.has(r.project_id)) byProject.set(r.project_id, [])
  byProject.get(r.project_id).push(r)
}

for (const [pid, items] of byProject) {
  console.log(`\n${'='.repeat(70)}\nproject ${pid}  (${items.length} items)\n${'='.repeat(70)}`)

  const kids = new Map() // parent_id -> children[]
  for (const it of items) {
    const k = it.parent_id ?? '__root__'
    if (!kids.has(k)) kids.set(k, [])
    kids.get(k).push(it)
  }
  const isLeaf = it => !kids.has(it.id)

  // ── 1) 전역 합 ──────────────────────────────────────────────────────────
  const withW = items.filter(it => it.weight != null)
  const leaves = items.filter(isLeaf)
  const leavesW = leaves.filter(it => it.weight != null)
  const sum = a => a.reduce((s, it) => s + num(it.weight), 0)

  console.log(`\n[1] 전역 합`)
  console.log(`  가중치 지정된 항목 : ${withW.length} / ${items.length}`)
  console.log(`  전체 합            : ${f(sum(withW))}`)
  console.log(`  leaf 만 합         : ${f(sum(leavesW))}   (leaf ${leavesW.length}/${leaves.length})`)
  if (withW.length) {
    const vals = withW.map(it => num(it.weight))
    console.log(`  min ${f(Math.min(...vals))}  max ${f(Math.max(...vals))}`)
  }

  // ── 2) null 혼합 형제 그룹 ──────────────────────────────────────────────
  console.log(`\n[2] null + 명시값이 섞인 형제 그룹  ← 있으면 ×100 시 실적%가 바뀜`)
  let mixed = 0
  for (const [parentId, children] of kids) {
    const nn = children.filter(c => c.weight != null).length
    if (nn > 0 && nn < children.length) {
      mixed++
      const p = items.find(i => i.id === parentId)
      console.log(
        `  ⚠ parent=${p ? `${p.code} ${p.name.slice(0, 20)}` : 'ROOT'} ` +
          `— ${children.length}개 중 ${nn}개만 가중치 지정`,
      )
      for (const c of children) console.log(`      ${c.level.padEnd(9)} ${String(c.code).padEnd(10)} ${f(num(c.weight))}`)
    }
  }
  console.log(mixed === 0 ? '  ✓ 없음 — ×100 이 롤업 결과를 바꾸지 않음' : `  ✗ ${mixed}개 그룹 — null 폴백 정책 정리 필요`)

  // ── 3) 형제 합 == 부모 가중치 ? (전역 절대 지분 모델) ───────────────────
  console.log(`\n[3] 형제 합 vs 부모 가중치  (전역 절대 지분 모델 검증)`)
  let modelOk = 0
  let modelBad = 0
  for (const [parentId, children] of kids) {
    if (parentId === '__root__') continue
    const p = items.find(i => i.id === parentId)
    if (!p || p.weight == null) continue
    if (children.some(c => c.weight == null)) continue
    const cs = sum(children)
    const pw = num(p.weight)
    const ok = Math.abs(cs - pw) < 1e-6
    if (ok) modelOk++
    else {
      modelBad++
      console.log(`  ✗ ${p.code} ${p.name.slice(0, 24)} : 부모 ${f(pw)} ≠ 자식합 ${f(cs)}`)
    }
  }
  console.log(`  일치 ${modelOk} / 불일치 ${modelBad}`)

  // ── 4) 형제 합 == 1.0 ? (형제 정규화 모델) ──────────────────────────────
  console.log(`\n[4] 형제 합 vs 1.0  (형제 정규화 모델 검증 — 위와 배타적)`)
  let oneOk = 0
  let oneBad = 0
  for (const [, children] of kids) {
    if (children.some(c => c.weight == null)) continue
    const cs = sum(children)
    if (Math.abs(cs - 1) < 1e-6) oneOk++
    else oneBad++
  }
  console.log(`  합=1.0 인 그룹 ${oneOk} / 아닌 그룹 ${oneBad}`)

  // ── 판정 ────────────────────────────────────────────────────────────────
  console.log(`\n[판정]`)
  const total = sum(withW)
  const leafTotal = sum(leavesW)
  if (Math.abs(leafTotal - 1) < 0.02) console.log(`  → leaf 전역 합 ≈ 1.0 : 전역 절대 지분 모델. ×100 이 맞음.`)
  else if (Math.abs(total - 1) < 0.02) console.log(`  → 전체 합 ≈ 1.0 : 전역 절대 지분 모델. ×100 이 맞음.`)
  else if (oneOk > oneBad) console.log(`  → 형제 합 ≈ 1.0 : 형제 정규화 모델. 검증 기준을 "형제 합=100" 으로 잡아야 함.`)
  else console.log(`  → 어느 모델도 아님 (합 ${f(total)}). 마이그레이션 보류하고 원본 확인 필요.`)
}

console.log('\n(읽기 전용 — 아무것도 변경하지 않았습니다)')
