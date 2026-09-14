// scripts/seatmap-load.mjs — 좌석표 폴링 부하 재현(스테이징 전용). 스펙 §6.
// 사용법: node scripts/seatmap-load.mjs --viewers 20 --minutes 3 --interval 30
// 열람자 1명 = interval 초마다 좌석표 조회 6개(주문·항목·부모·보고·watcher·프로젝트)를 주문·항목 조회 뒤 나머지 넷은 동시에 보낸다.
import { readFileSync } from 'node:fs'

const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? Number(process.argv[i + 1]) : d }
const VIEWERS = arg('viewers', 20), MINUTES = arg('minutes', 3), INTERVAL = arg('interval', 30)
const REQUEST_TIMEOUT_MS = 10_000

let env
try {
  env = Object.fromEntries(readFileSync('.env', 'utf8').split('\n').filter(l => l.includes('=') && !l.startsWith('#')).map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()] }))
} catch {
  console.error('.env 가 없다 — 워크트리 루트에서 실행하세요'); process.exit(2)
}
const URL = env.NEXT_PUBLIC_SUPABASE_URL, KEY = env.SUPABASE_SERVICE_ROLE_KEY
if (!URL || !KEY) { console.error('.env 에 NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 가 없다'); process.exit(2) }
if (URL.includes('rglfgrwwwwdqejohdnty')) { console.error('운영 프로젝트를 가리키고 있다 — 스테이징에서만 돌린다(npm run env:staging)'); process.exit(2) }

const H = { apikey: KEY, Authorization: `Bearer ${KEY}` }
const lat = [], errors = []
async function get(path) {
  const t0 = performance.now()
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  try {
    const r = await fetch(`${URL}/rest/v1/${path}`, { headers: H, signal: controller.signal })
    lat.push(performance.now() - t0)
    if (!r.ok) errors.push(`${r.status} ${path.slice(0, 40)}`)
    return r.ok ? r.json() : []
  } catch (e) {
    lat.push(performance.now() - t0)
    const msg = e.name === 'AbortError' ? `timeout ${path.slice(0, 40)}` : String(e)
    errors.push(msg)
    return []
  } finally {
    clearTimeout(timer)
  }
}
async function poll() {
  const since = new Date(Date.now() - 7 * 86400_000).toISOString()
  const orders = await get(`agent_work_orders?select=id,project_id,wbs_item_id,status,updated_at,last_heartbeat_at&or=(status.in.(ready,claimed,reported),and(status.eq.approved,updated_at.gte.${since}))&limit=2000`)
  const itemIds = [...new Set(orders.map(o => o.wbs_item_id).filter(Boolean))].slice(0, 500)
  const items = itemIds.length ? await get(`wbs_items?select=id,code,name,parent_id,actual_pct&id=in.(${itemIds.join(',')})`) : []
  const parentIds = [...new Set(items.map(i => i.parent_id).filter(Boolean))].slice(0, 500)
  const orderIds = [...new Set(orders.map(o => o.id).filter(Boolean))].slice(0, 500)
  const projIds = [...new Set(orders.map(o => o.project_id).filter(Boolean))].slice(0, 500)
  await Promise.all([
    parentIds.length ? get(`wbs_items?select=id,code,name,parent_id,actual_pct&id=in.(${parentIds.join(',')})`) : Promise.resolve([]),
    orderIds.length ? get(`agent_work_reports?select=work_order_id,review_action,review_note,created_at&kind=eq.completion&work_order_id=in.(${orderIds.join(',')})`) : Promise.resolve([]),
    get(`agent_watchers?select=id,agent,last_seen_at&last_seen_at=gte.${new Date(Date.now() - 70 * 60_000).toISOString()}`),
    projIds.length ? get(`projects?select=id,name&id=in.(${projIds.join(',')})`) : Promise.resolve([]),
  ])
}
async function viewer(i) {
  await new Promise(r => setTimeout(r, (i / VIEWERS) * INTERVAL * 1000)) // 열람자 시작 시각을 흩뿌린다
  const end = Date.now() + MINUTES * 60_000
  while (Date.now() < end) { await poll(); await new Promise(r => setTimeout(r, INTERVAL * 1000)) }
}
const t0 = Date.now()
await Promise.all(Array.from({ length: VIEWERS }, (_, i) => viewer(i)))
lat.sort((a, b) => a - b)
const q = p => Math.round(lat[Math.min(lat.length - 1, Math.floor(lat.length * p))])
console.log(JSON.stringify({
  viewers: VIEWERS, minutes: MINUTES, interval: INTERVAL, requests: lat.length,
  p50_ms: q(0.5), p95_ms: q(0.95), max_ms: Math.round(lat[lat.length - 1] ?? 0),
  errors: errors.length, error_samples: errors.slice(0, 5), wall_s: Math.round((Date.now() - t0) / 1000),
}, null, 2))
