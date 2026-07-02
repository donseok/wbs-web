// 특일(공휴일·국경일·기념일) 이름 사전 — 이 파일은 holidays 영역 담당만 수정한다.
// 키는 src/lib/domain/holidays.ts의 KrSpecialDayName과 `hol.${name}`으로 1:1 대응한다.
// en은 Record<keyof ko, string> 타입으로 ko와의 키 패리티를 컴파일 타임에 강제한다.
export const holidaysKo = {
  'hol.newYear': '신정',
  'hol.seollal': '설날',
  'hol.samiljeol': '삼일절',
  'hol.childrensDay': '어린이날',
  'hol.buddha': '부처님오신날',
  'hol.memorialDay': '현충일',
  'hol.jeheonjeol': '제헌절',
  'hol.liberationDay': '광복절',
  'hol.chuseok': '추석',
  'hol.gaecheonjeol': '개천절',
  'hol.hangulDay': '한글날',
  'hol.christmas': '성탄절',
  'hol.substitute': '대체공휴일',
  'hol.electionDay': '선거일',
  'hol.tempHoliday': '임시공휴일',
  'hol.workersDay': '근로자의날',
  'hol.laborDay': '노동절',
  'hol.armedForcesDay': '국군의날',
} as const

export const holidaysEn: Record<keyof typeof holidaysKo, string> = {
  'hol.newYear': "New Year's Day",
  'hol.seollal': 'Seollal',
  'hol.samiljeol': 'Independence Movement Day',
  'hol.childrensDay': "Children's Day",
  'hol.buddha': "Buddha's Birthday",
  'hol.memorialDay': 'Memorial Day',
  'hol.jeheonjeol': 'Constitution Day',
  'hol.liberationDay': 'Liberation Day',
  'hol.chuseok': 'Chuseok',
  'hol.gaecheonjeol': 'National Foundation Day',
  'hol.hangulDay': 'Hangeul Day',
  'hol.christmas': 'Christmas Day',
  'hol.substitute': 'Substitute holiday',
  'hol.electionDay': 'Election Day',
  'hol.tempHoliday': 'Temporary holiday',
  'hol.workersDay': "Workers' Day",
  'hol.laborDay': 'Labor Day',
  'hol.armedForcesDay': 'Armed Forces Day',
}
