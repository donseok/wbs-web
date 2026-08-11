// scripts/env-swap.mjs — .env.local 을 스테이징/운영 소스로 교체한다.
// ⚠ 파일 교체는 이 PC 의 모든 병렬 세션에 즉시 영향을 준다 (CLAUDE.md 명시).
import { copyFileSync, existsSync, readFileSync } from 'node:fs'
import { PROD_REF, STAGING_REF } from './lib/staging.config.mjs'
import { detectEnvTarget } from './lib/staging-core.mjs'

const target = process.argv[2]
if (!['staging', 'prod'].includes(target)) { console.error('사용법: npm run env:staging | env:prod'); process.exit(1) }
const src = `.env.local.${target}`
if (!existsSync(src)) { console.error(`✗ ${src} 없음 — .env.local.example 을 참고해 만들고 값 채우기`); process.exit(1) }
copyFileSync(src, '.env.local')
const got = detectEnvTarget(readFileSync('.env.local', 'utf8'), { stagingRef: STAGING_REF, prodRef: PROD_REF })
if (got !== target) { console.error(`✗ 전환 검증 실패 — .env.local 이 ${got} 을 가리킴`); process.exit(1) }
console.log(`✓ .env.local → ${target} (${target === 'prod' ? '⚠ 운영 DB — 작업 후 npm run env:staging 복귀' : '스테이징'})`)
