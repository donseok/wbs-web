#!/usr/bin/env node
/**
 * 에이전트 작업 루프 레퍼런스 하네스 (헤드리스 모드 예시).
 * 사용: AGENT_BASE=https://wbs-web.vercel.app AGENT_SECRET=... AGENT_EMAIL=dev@example.com \
 *      AGENT_NAME=claude-cli-dev1 AGENT_PROJECT=<uuid> REPO_DIR=/path/to/repo \
 *      node scripts/agent-harness-example.mjs
 * 전제: 로컬에 claude CLI 로그인 완료. 1회 실행 = 주문 1건 처리(크론/루프는 사용자 몫).
 */
import { execFileSync } from 'node:child_process'

const { AGENT_BASE, AGENT_SECRET, AGENT_EMAIL, AGENT_NAME, AGENT_PROJECT, REPO_DIR } = process.env
for (const [k, v] of Object.entries({ AGENT_BASE, AGENT_SECRET, AGENT_EMAIL, AGENT_NAME, AGENT_PROJECT, REPO_DIR })) {
  if (!v) { console.error(`env ${k} 필요`); process.exit(1) }
}

async function api(path, init = {}) {
  const res = await fetch(`${AGENT_BASE}/api/v1${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${AGENT_SECRET}`, ...init.headers },
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(`${path} → ${res.status} ${JSON.stringify(body)}`)
  return body
}
const actor = { user_email: AGENT_EMAIL, agent: AGENT_NAME }

const { orders } = await api(`/agent/work?project_id=${AGENT_PROJECT}`)
if (orders.length === 0) { console.log('ready 작업 없음'); process.exit(0) }
const order = orders[0]
console.log(`claim: ${order.item?.code} ${order.item?.name}`)
await api(`/agent/work/${order.id}/claim`, { method: 'POST', body: JSON.stringify(actor) })

const prompt = [
  `너는 D'Flow WBS 작업을 수행하는 에이전트다. 아래 작업을 이 리포에서 구현하라.`,
  `## WBS 항목`, `- 코드: ${order.item?.code}`, `- 이름: ${order.item?.name}`,
  `- 업무내용: ${order.item?.biz ?? '-'}`, `- 산출물: ${order.item?.deliverable ?? '-'}`,
  `## 지시문`, order.instructions || '(없음)',
  `## 완료 조건`, `- 구현 후 빌드·테스트를 실행해 통과를 확인하고 커밋한다.`,
  `- 마지막 출력 줄에 JSON 한 줄만 출력한다: {"summary":"...", "links":[{"url":"<커밋/PR URL>"}]}`,
].join('\n')

let result
try {
  const out = execFileSync('claude', ['-p', prompt], { cwd: REPO_DIR, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] })
  const lastJson = out.trim().split('\n').reverse().find(l => l.trim().startsWith('{'))
  result = lastJson ? JSON.parse(lastJson) : { summary: out.slice(-2000), links: [] }
} catch (e) {
  // 실패 = release 로 점유만 반납한다 — 진척(progress) 은 절대 보고하지 않는다.
  // progress 보고는 호출 즉시 WBS 실적(actual_pct)에 반영되므로(계약 §3.3), 실패했다고
  // percent:0 을 보고하면 이미 쌓여 있던 정상 실적을 0 으로 덮어써 버린다 — 침묵보다 더 나쁜 사고다.
  // 규약: 에이전트 실패(비정상 종료·타임아웃·권한 오류) 시 release 만 시도한다.
  // release 호출 자체는 자체 try/catch 로 감싸 항상 시도되게 하고, 실패해도 콘솔에만 남긴다
  // (여기서 또 던지면 이 catch 블록 자체가 실패해 release 시도 여부가 불명확해진다).
  // release 마저 실패하면 주문은 claimed 로 남아 24시간 뒤 보드에 "응답 없음"으로 표시되고
  // 사람이 수동 회수해야 한다 — 그래도 실적을 훼손하는 것보다 낫다.
  try {
    await api(`/agent/work/${order.id}/release`, { method: 'POST', body: JSON.stringify(actor) })
  } catch (releaseErr) {
    console.error(`release 실패: ${releaseErr.message}`)
  }
  console.error(`작업 실패: ${e.message}`)
  process.exit(1)
}

await api(`/agent/work/${order.id}/report`, {
  method: 'POST',
  body: JSON.stringify({ ...actor, kind: 'completion', percent: 100, summary: result.summary, links: result.links ?? [] }),
})
console.log('completion 보고 완료 — 승인은 /agent-ops 에서')
