// scripts/lib/staging-core.mjs
// staging-sync / db-apply / predev 가드가 공유하는 순수 로직.
// 부작용(키체인·psql·fetch)은 여기 두지 않는다 — vitest 로 검증하기 위해서다.

export function parseDsnRef(dsn) {
  const user = dsn.match(/^postgresql:\/\/([^:@/]+)[:@]/)?.[1] ?? ''
  const byUser = user.match(/^[a-z_]+\.([a-z0-9]{20})$/)?.[1]
  if (byUser) return byUser
  const byHost = dsn.match(/@db\.([a-z0-9]{20})\.supabase\.co/)?.[1]
  return byHost ?? null
}

export function assertStagingWritable(dsn, { stagingRef, prodRef }) {
  const ref = parseDsnRef(dsn)
  if (ref === prodRef) throw new Error(`쓰기 대상이 운영(${prodRef})입니다 — staging:sync 는 운영에 쓰지 않습니다. 중단.`)
  if (ref !== stagingRef) throw new Error(`쓰기 대상 ref 판독 실패 또는 allowlist 밖(${ref ?? '판독불가'}) — fail-closed 중단.`)
}

// NULL 토큰 컬럼이면 로그인 시 "Database error querying schema" (공식 트러블슈팅 확인, 스펙 §6.1-3).
export function authTokenFixSql() {
  return `update auth.users set
    confirmation_token = coalesce(confirmation_token, ''),
    recovery_token = coalesce(recovery_token, ''),
    email_change_token_new = coalesce(email_change_token_new, ''),
    email_change = coalesce(email_change, '')`
}

export function detectEnvTarget(envText, { stagingRef, prodRef }) {
  const url = envText.match(/^\s*NEXT_PUBLIC_SUPABASE_URL\s*=[ \t]*(\S*)/m)?.[1] ?? ''
  if (url.includes(prodRef)) return 'prod'
  if (url.includes(stagingRef)) return 'staging'
  return 'unknown'
}

export function maskDsn(dsn) {
  return dsn.replace(/(:\/\/[^:@/]+:).+@/, '$1***@')
}
