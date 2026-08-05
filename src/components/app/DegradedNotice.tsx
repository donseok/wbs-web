/**
 * 권한·프로젝트 조회가 실패했을 때 그 사실을 화면에 드러내는 배너.
 *
 * 2026-08-05 REST 장애 때 화면이 조회 실패를 '게스트 · 등록된 프로젝트 없음' 으로 그려
 * 로그인 실패로 신고됐다. 에러 처리 3원칙 ①('조회 실패를 데이터 없음으로 위장하지 않는다')
 * 의 표시 절반이 빠져 있던 자리다.
 *
 * 서버 컴포넌트에서 그대로 렌더한다 — 상태도 이벤트도 없다.
 */
export function DegradedNotice({
  actorFailed,
  projectsFailed,
}: {
  actorFailed: boolean
  projectsFailed: boolean
}) {
  if (!actorFailed && !projectsFailed) return null
  const what = actorFailed && projectsFailed ? '권한과 프로젝트 목록을'
    : actorFailed ? '권한 정보를'
      : '프로젝트 목록을'
  return (
    <div
      role="alert"
      data-degraded-notice
      className="mb-3 rounded-2xl border border-delayed/40 bg-delayed-weak/50 px-4 py-3"
    >
      <p className="text-sm font-bold text-delayed">일부 정보를 불러오지 못했습니다</p>
      <p className="mt-1 text-xs text-ink-muted">
        {what} 읽지 못해 메뉴·목록이 실제와 다르게 보일 수 있습니다.
        계정이나 데이터가 바뀐 것이 아니니 잠시 뒤 새로고침하세요. 계속되면 관리자에게 알려 주세요.
      </p>
    </div>
  )
}
