// attendance 화면 사전 — 이 파일은 attendance 영역 담당만 수정한다.
// en은 Record<keyof ko, string> 타입으로 ko와의 키 패리티를 컴파일 타임에 강제한다.
export const attendanceKo = {} as const

export const attendanceEn: Record<keyof typeof attendanceKo, string> = {}
