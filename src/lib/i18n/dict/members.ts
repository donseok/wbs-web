// members 화면 사전 — 이 파일은 members 영역 담당만 수정한다.
// en은 Record<keyof ko, string> 타입으로 ko와의 키 패리티를 컴파일 타임에 강제한다.
export const membersKo = {
  // 히어로(page.tsx)
  'members.projectFallback': '프로젝트',
  // 프로젝트명 뒤에 붙는 접미사 — JSX에서 `${projectName} ${t(...)}` 로 조합
  'members.heroTitleSuffix': '팀 구성',
  'members.heroDesc': '근태·회의 참석자의 기준이 되는 참여 인력 명단입니다.',
  'members.kpiTeamSizeSub': '전체 참여자',
  'members.kpiAdminsSub': '총괄·리더',
  'members.kpiContributorsSub': '실무 담당',
  // 보드 헤더 — '팀 보드 · {n}명' 은 {t(boardTitle)} · {n}{t(unitPeople)} 로 조합
  'members.boardTitle': '팀 보드',
  'members.unitPeople': '명',
  // 명단/권한 구분 안내 — 이 화면의 '리더'는 직책이지 권한이 아니다(설정 › 권한이 권한 창구).
  'members.rosterNotice': '여기는 참여 인력 명단입니다 (근태·회의 참석자 기준). 로그인 권한은 설정 › 권한에서 관리합니다.',
  'members.rosterNoticeLink': '설정 › 권한 열기',
  'members.addMember': '멤버 추가',
  'members.emptyTitle': '아직 등록된 멤버가 없습니다',
  'members.emptyDesc': '멤버를 추가해 역할과 소속이 명확한 팀 보드를 구성하세요.',
  // 멤버 카드 — 명단상의 구분이지 권한이 아니다(권한은 project_roles).
  'members.roleAdmin': '리더',
  'members.roleContributor': '실무',
  'members.noTitle': '직함 미지정',
  'members.noTeam': '소속 미지정',
  'members.noEmail': '이메일 미등록',
  'members.unlinked': '계정 미연결',
  'members.unlinkedHint': '이 이메일과 일치하는 로그인 계정이 없습니다. 본인이 로그인해도 “내 회의”에 이 사람의 회의가 표시되지 않습니다.',
  // aria 접미사 — `${member.name}${t(...)}` 로 조합 (선행 공백/구두점 포함)
  'members.ariaEditSuffix': ' 수정',
  'members.ariaDeleteSuffix': ' 삭제',
  // 추가/수정 모달
  'members.editMember': '멤버 수정',
  'members.fieldName': '이름',
  'members.fieldEmail': '이메일',
  'members.fieldTeam': '소속 팀',
  'members.fieldRole': '명단 구분',
  'members.fieldTitle': '직함 / 역할 설명',
  'members.phName': '예: 홍길동',
  'members.phEmail': '예: name@company.com',
  'members.identityHint': '동일한 이메일은 모든 프로젝트에서 같은 이름을 사용합니다. 여러 프로젝트에서 쓰는 이름 변경은 슈퍼유저만 가능합니다.',
  'members.phTitle': '예: PM / 프로젝트 총괄',
  'members.noTeamOption': '소속 없음',
  'members.saving': '저장 중…',
  'members.saveChanges': '변경 저장',
  // 이름 자동완성(추가 모드 전용) — 이메일이 전역 키라 기존 인물은 기존 이름 그대로여야 저장된다.
  // 후보 선택 시 이름·이메일을 잠가 "같은 사람, 다른 표기" 서버 거부 함정을 없앤다.
  'members.acListboxLabel': '기존 인물 후보',
  'members.acLockedNotice': '기존 인물 정보로 채웠습니다. 이름·이메일은 잠겨 있습니다.',
  'members.acManualSwitch': '직접 입력으로 전환',
  'members.acSearchError': '후보 검색에 실패했습니다.',
  'members.errNameRequired': '이름을 입력하세요.',
  'members.errEmailRequired': '이메일을 입력하세요. 모든 참여자는 D\'Flow 계정과 연결되어야 합니다.',
  'members.errEmailInvalid': '올바른 이메일 형식이 아닙니다. (예: name@company.com)',
  'members.errSaveFailed': '저장에 실패했습니다.',
  // 삭제 확인 모달
  'members.deleteMember': '멤버 삭제',
  'members.deleting': '삭제 중…',
  // `<strong>{name}</strong>{t(...)}` 로 조합 (선행 공백 포함)
  'members.deleteConfirmSuffix': ' 님을 팀 보드에서 삭제할까요? 이 작업은 되돌릴 수 없습니다.',
  'members.errDeleteFailed': '삭제에 실패했습니다.',
} as const
