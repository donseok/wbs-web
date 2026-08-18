/**
 * service_role 환경변수의 단일 출처 — 이름을 읽는 곳은 이 파일뿐이다(12개 파일 17곳 흡수).
 *
 * admin.ts 가 아니라 별도 파일인 이유: admin.ts 는 테스트에서 통째로 vi.mock 되는 모듈이고
 * (createAdminClient 하나만 스텁하는 테스트가 53개) 판정 함수를 거기 두면 모킹된 문맥에서
 * undefined 호출이 된다. 더 나쁜 건 호출부가 try/catch 안이면 그 TypeError 가 삼켜져
 * '설정 안 됨'으로 조용히 오판된다는 것 — 실제로 이 배치로 테스트 17건이 깨졌다.
 * 순수 판정은 I/O 모듈과 분리해 둔다.
 */

/** 클라이언트 생성에 필요한 두 값. 값이 필요한 쪽(createAdminClient)이 쓴다. */
export function serviceRoleEnv(): { url: string | undefined; key: string | undefined } {
  return {
    url: process.env.NEXT_PUBLIC_SUPABASE_URL,
    key: process.env.SUPABASE_SERVICE_ROLE_KEY,
  }
}

/** service_role 자격이 갖춰졌는지 — createAdminClient 가 던질지 미리 판정할 때 쓴다. */
export function serviceRoleConfigured(): boolean {
  const { url, key } = serviceRoleEnv()
  return Boolean(url && key)
}
