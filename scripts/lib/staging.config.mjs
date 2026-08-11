// scripts/lib/staging.config.mjs
// 스테이징/운영 프로젝트 좌표. ref 는 비밀이 아니다(프로젝트 URL 에 그대로 들어간다).
// 비밀값(DSN·키)은 키체인("DFlow Staging DB"/"DFlow Prod Reader")에만 둔다.
export const PROD_REF = 'rglfgrwwwwdqejohdnty'
export const STAGING_REF = 'abtyahghvvkcriawffty'
// Supavisor 세션 풀러(IPv4, 5432). 사용자명은 `<롤>.<ref>` 형식.
export const POOLER_HOST = 'aws-0-ap-northeast-2.pooler.supabase.com'
