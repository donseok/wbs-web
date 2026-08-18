// account 영어 사전 — ko 파일과 물리 분리(웹팩이 En 을 클라이언트 공통 청크에 싣지 않도록).
// 키 패리티는 import type 으로만 강제한다 — 값 import 를 넣으면 분리가 무효가 된다.
import type { accountKo } from './account'

export const accountEn: Record<keyof typeof accountKo, string> = {
  'account.scope.workRead.desc': 'View work list and detail only',
  'account.scope.workClaim.desc': 'Can claim/release work as well — includes read access',
  'account.scope.reportAdminOnly': 'Tokens with report completion (work:report) scope are admin-issued only.',
}
