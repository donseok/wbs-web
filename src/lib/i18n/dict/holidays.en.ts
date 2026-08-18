// holidays 영어 사전 — ko 파일과 물리 분리(웹팩이 En 을 클라이언트 공통 청크에 싣지 않도록).
// 키 패리티는 import type 으로만 강제한다 — 값 import 를 넣으면 분리가 무효가 된다.
import type { holidaysKo } from './holidays'

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
