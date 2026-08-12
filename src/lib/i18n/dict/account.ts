// 내 계정 — PAT 발급 폼(MyTokensSection). 스코프 설명·안내 문구(스테이징 피드백 2026-08-11).
export const accountKo = {
  'account.scope.workRead.desc': '작업 목록·상세 조회만 가능',
  'account.scope.workClaim.desc': '작업 착수(claim)·반납(release)까지 가능 — 조회 포함',
  'account.scope.reportAdminOnly': '완료 보고(work:report) 권한 토큰은 관리자 발급 전용입니다.',
}

export const accountEn: Record<keyof typeof accountKo, string> = {
  'account.scope.workRead.desc': 'View work list and detail only',
  'account.scope.workClaim.desc': 'Can claim/release work as well — includes read access',
  'account.scope.reportAdminOnly': 'Tokens with report completion (work:report) scope are admin-issued only.',
}
