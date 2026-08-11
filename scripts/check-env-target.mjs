// scripts/check-env-target.mjs — predev 가드. 운영 DB 를 향한 dev 서버를 무심코 띄우지 못하게 한다.
// 의도적 운영 접속은 FORCE_PROD_DEV=1 로만 통과 (스펙 §9 — 예절이 아니라 기계 가드).
import { readFileSync } from 'node:fs'
import { PROD_REF, STAGING_REF } from './lib/staging.config.mjs'
import { detectEnvTarget } from './lib/staging-core.mjs'

let text = ''
try { text = readFileSync('.env.local', 'utf8') } catch { /* 없으면 unknown 처리 */ }
const target = detectEnvTarget(text, { stagingRef: STAGING_REF, prodRef: PROD_REF })
if (target === 'prod' && process.env.FORCE_PROD_DEV !== '1') {
  console.error('\n████ 차단: .env.local 이 운영 DB 를 가리킵니다 ████')
  console.error('  스테이징으로: npm run env:staging')
  console.error('  의도적 운영 접속: FORCE_PROD_DEV=1 npm run dev (D-CUBE 데이터 훼손 금지)\n')
  process.exit(1)
}
if (target === 'unknown') console.warn('! .env.local 대상 판독 불가 — 스테이징/운영 어느 쪽도 아님 (진행은 허용)')
else console.log(`dev 대상: ${target}`)
