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
  'kanban.filterAll': '전체',
  'kanban.searchPlaceholder': '작업명·담당자 검색',
  // 드래그 안내 — hint1 + [완료] + hint2 + [시작전] + hint3 로 조합
  'kanban.hint1': '카드를 ',
  'kanban.hint2': ' 또는 ',
  'kanban.hint3': ' 컬럼으로 드래그(또는 카드 선택 후 Enter)하면 실적이 자동 반영됩니다.',
  'kanban.saving': '저장 중…',
  // 컬럼/보드
  'kanban.unassigned': '미배정',
  'kanban.dropHere': '여기에 카드를 놓으세요',
  'kanban.noTasks': '작업 없음',
  'kanban.emptyTitle': '표시할 작업이 없습니다',
  'kanban.emptyDesc': '설정에서 WBS 엑셀을 가져오면 작업이 Phase·담당자·상태별 카드로 나타납니다.',
  // 라이브 리전 메시지 — p1 + 작업명 + p2 + 상태라벨 + p3 로 조합
  'kanban.movedP1': '',
  'kanban.movedP2': ' 작업을 ',
  'kanban.movedP3': '(으)로 이동했습니다.',
  // p1 + 작업명 + p2 로 조합
  'kanban.clearedP1': '',
  'kanban.clearedP2': ' 완료를 해제하여 실적을 0%로 초기화했습니다.',
  // 에러
  'kanban.errStatusChange': '상태 변경에 실패했습니다.',
  'kanban.errChange': '변경에 실패했습니다.',
  'kanban.errNotStartedDrop':
    '이미 시작된 작업은 ‘시작전’으로 되돌릴 수 없습니다. 실적을 0%로 두면 ‘지연’으로 표시됩니다. 완료로 옮기거나 WBS에서 실적을 직접 수정하세요.',
  'kanban.errorModalTitle': '변경하지 못했습니다',
  // 카드 접근성
  'kanban.card.roleDesc': '상태 이동 카드',
  'kanban.card.actual': '실적',
  'kanban.card.enterDone': 'Enter로 완료 처리',
  'kanban.card.enterClear': 'Enter로 완료 해제',
} as const

export const kanbanEn: Record<keyof typeof kanbanKo, string> = {
  'kanban.projectFallback': 'Project',
  'kanban.heroTitleSuffix': 'Kanban board',
  'kanban.heroDesc': 'Manage tasks at a glance by phase, owner, and status.',
  'kanban.kpiTotalTasks': 'Total tasks',
  'kanban.kpiTotalTasksSub': 'Leaf task cards',
  'kanban.kpiOfTotalPrefix': 'of ',
  'kanban.kpiOfTotalSuffix': ' total',
  'kanban.kpiOverallProgress': 'Overall progress',
  'kanban.kpiOverallProgressSub': 'Average actual across phases',
  'kanban.byPhase': 'By phase',
  'kanban.byOwner': 'By owner',
  'kanban.byStatus': 'By status',
  'kanban.filterAll': 'All',
  'kanban.searchPlaceholder': 'Search tasks or owners',
  'kanban.hint1': 'Drag a card to the ',
  'kanban.hint2': ' or ',
  'kanban.hint3': ' column (or select a card and press Enter) to update actuals automatically.',
  'kanban.saving': 'Saving…',
  'kanban.unassigned': 'Unassigned',
  'kanban.dropHere': 'Drop a card here',
  'kanban.noTasks': 'No tasks',
  'kanban.emptyTitle': 'No tasks to show',
  'kanban.emptyDesc': 'Import a WBS Excel file in Settings and tasks will appear as cards by phase, owner, and status.',
  'kanban.movedP1': 'Moved ',
  'kanban.movedP2': ' to ',
  'kanban.movedP3': '.',
  'kanban.clearedP1': 'Cleared done for ',
  'kanban.clearedP2': ' — actual reset to 0%.',
  'kanban.errStatusChange': 'Failed to change status.',
  'kanban.errChange': 'Failed to apply the change.',
  'kanban.errNotStartedDrop':
    'A task that has already started cannot go back to "Not started". Leaving actual at 0% would mark it "Delayed". Move it to Done, or edit the actual directly in the WBS.',
  'kanban.errorModalTitle': 'Could not apply the change',
  'kanban.card.roleDesc': 'Status move card',
  'kanban.card.actual': 'actual',
  'kanban.card.enterDone': 'Press Enter to mark done',
  'kanban.card.enterClear': 'Press Enter to clear done',
}
