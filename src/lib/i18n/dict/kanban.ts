// kanban 화면 사전 — 이 파일은 kanban 영역 담당만 수정한다.
// en은 Record<keyof ko, string> 타입으로 ko와의 키 패리티를 컴파일 타임에 강제한다.
export const kanbanKo = {
  // 페이지 히어로/KPI
  'kanban.projectFallback': '프로젝트',
  'kanban.heroTitleSuffix': '칸반 보드',
  'kanban.heroDesc': '작업을 Phase·담당자·상태별로 한눈에 관리하세요.',
  'kanban.kpiTotalTasks': '전체 작업',
  'kanban.kpiTotalTasksSub': '말단 작업 카드',
  'kanban.kpiOfTotalPrefix': '전체 ',
  'kanban.kpiOfTotalSuffix': '건 중',
  'kanban.kpiOverallProgress': '전체 진척률',
  'kanban.kpiOverallProgressSub': 'Phase 평균 실적',
  // 툴바
  'kanban.byPhase': 'Phase별',
  'kanban.byOwner': '담당자별',
  'kanban.byStatus': '상태별',
  'kanban.searchPlaceholder': '작업명·담당자 검색',
  'kanban.saving': '저장 중…',
  // 컬럼/보드
  'kanban.unassigned': '미배정',
  'kanban.dropHere': '여기에 카드를 놓으세요',
  'kanban.noTasks': '작업 없음',
  'kanban.emptyTitle': '표시할 작업이 없습니다',
  'kanban.emptyDesc': '설정에서 WBS 엑셀을 가져오면 작업이 Phase·담당자·상태별 카드로 나타납니다.',
  // 에러
  'kanban.errChange': '변경에 실패했습니다.',
  // 카드 접근성
  'kanban.card.actual': '실적',
  // ── 재개편(실행 보드) ──
  'kanban.byProgress': '진행',
  'kanban.readOnlyHint': '이 뷰는 조회 전용입니다 — 진척 이동은 ‘진행’ 뷰에서 하세요.',
  // 렌즈·필터
  'kanban.lensMyTeam': '내 팀',
  'kanban.lensAll': '전체',
  'kanban.qfOverdue': '지연',
  'kanban.qfDueThisWeek': '이번 주 마감',
  'kanban.qfInProgress': '진행중',
  'kanban.qfNotStarted': '미착수',
  'kanban.qfScheduleHint': '여러 개를 켜면 조건을 모두 만족하는 카드만 남습니다.',
  'kanban.qfBucketHint': '진행중·미착수는 함께 켜면 둘 다 보여줍니다(합집합).',
  // 카드 액션·배지
  'kanban.start': '착수',
  'kanban.complete': '완료',
  'kanban.reopen': '재개',
  'kanban.decrease': '실적 10% 감소',
  'kanban.increase': '실적 10% 증가',
  'kanban.openInWbs': 'WBS에서 열기',
  'kanban.overduePrefix': '지연 ',
  'kanban.overdueSuffix': '일',
  'kanban.ddayPrefix': 'D-',
  'kanban.ddayToday': 'D-DAY',
  // 진척 입력 팝오버
  'kanban.progressTitle': '진척 입력',
  'kanban.progressDesc': '이 작업의 실적%를 선택하세요.',
  'kanban.progressCustom': '직접 입력(1~99)',
  'kanban.progressApply': '적용',
  // 되돌림 확인
  'kanban.resetTitle': '진척을 0%로 되돌릴까요?',
  'kanban.resetDesc': '현재 진척이 사라지고 ‘시작전’으로 이동합니다.',
  'kanban.resetConfirm': '0%로 되돌리기',
  'kanban.cancel': '취소',
  // 토스트
  'kanban.saveFailedTitle': '저장 실패',
  'kanban.conflict': '다른 사용자가 먼저 변경했어요. 새로고침 후 다시 시도하세요.',
  // 온보딩·빈 상태
  'kanban.coachTitle': '카드를 끌어 진척을 옮겨보세요',
  'kanban.coachDesc': '시작전·진행중·완료 사이로 드래그하거나, 카드의 +/− 로 실적을 조정할 수 있어요.',
  'kanban.coachDismiss': '알겠어요',
  'kanban.noMatchTitle': '필터에 맞는 작업이 없습니다',
  'kanban.noMatchDesc': '렌즈·필터·검색을 조정해 보세요.',
} as const
