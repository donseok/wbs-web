// 에이전트 보기의 말풍선 대사 — IO 없음(2026-09-18 사용자 요청).
// 팀원 보고가 한동안 없으면 팀장이 잔소리를 하고, 팀원이 보고하면 그 요약을 말풍선으로 띄운다.
// 대사는 nowMs 로 돌리므로(8초마다 다음 줄) 서버·클라이언트가 같은 줄을 고른다. 작업 PC 마다 시작 줄이 다르다.
import { fnv1a32 } from './seatState'
import type { RosterDesk, RosterHost } from './agentRoster'

/** 이 시간 동안 어떤 팀원도 보고하지 않으면 팀장이 잔소리를 시작한다. */
export const QUIET_MS = 60_000 // 사용자 요청(09-18) 10분 → 1분
/** 팀원 보고 말풍선이 떠 있는 시간 — 지나면 단계 말풍선으로 돌아간다. */
export const REPORT_FRESH_MS = 10 * 60_000
/** 막 보고가 들어왔을 때 팀장이 칭찬하는 시간. */
export const PRAISE_MS = 45_000 // 잔소리 기준(1분)보다 짧아야 칭찬 뒤 잔소리가 이어진다
/** 대사가 바뀌는 간격. */
export const ROTATE_MS = 8_000

/** {name} 은 가장 오래 조용한 팀원의 자리 이름(팀원 2 …)으로 바뀐다. */
export const NAG_LINES: readonly string[] = [
  '놀다 걸리면 국물도 없어.',
  '김매니저 또 어디갔어?',
  '실장님 그게 아니고, 제 말씀은...',
  '{name} 또 어디 갔어?',
  '보고는 언제 올라오나…',
  '다들 점심 먹으러 갔나?',
  '{name}, 진행 상황 공유 좀!',
  '조용하네… 너무 조용해.',
  '커피 한 잔만 마시고 온다더니…',
  '회의 들어간 사람 손?',
  '{name}, 모니터 켜져 있는 거 다 보여.',
  '오늘 안에는 되는 거지?',
  '퇴근은 보고하고 하는 거다.',
  '내가 해도 이것보단 빠르겠다.',
  '{name}, 로그라도 좀 남겨 봐.',
  '이러다 스탠드업 때 할 말 없다.',
  '누가 서버 전원 뽑았어?',
  '{name} 자리 비우면 말을 하고 가지.',
  '진척률 0이면 내 평가도 0이야.',
  '야근 각이다, 다들.',
  '보고서 양식 몰라서 그래? 한 줄이면 돼.',
  '메신저 읽씹 금지!',
  '{name}, 설마 조는 거 아니지?',
  '커밋 하나만 보여 줘, 제발.',
  '본부장님이 물어보시면 뭐라고 하지…',
  '{name} 찾습니다. 보신 분?',
  '주간보고 마감이 코앞이다!',
  '핑이라도 좀 보내 봐.',
  '무소식이 희소식… 은 여기선 아니다.',
  '나 혼자 일하는 거 아니지?',
  '{name}, 지금 뭐 해?',
  '다들 어디 숨었어?',
  '{name}, 이따 잠깐 나 좀 봐.',
  '일정표 다시 짜야 하나…',
  '{name}, 버그랑 싸우는 중이면 소리라도 질러.',
  '오늘 회식은 없던 걸로 한다.',
  '기다리다 목 빠지겠네.',
  '간식 사 온다던 사람 누구야?',
  '{name}, 대답 없으면 반차 처리한다.',
  '휴… 팀장은 외롭다.',
  '토큰만 태우고 있는 거 아니지?',
  '{name}, 컨텍스트 날아간 거 아니지?',
  '회사 놀러 나온 거야?',
  '{name}, 여기 카페 아니다.',
  '놀 거면 집에서 놀아.',
  '{name}, 월급 루팡 소리 듣고 싶어?',
  '일하라고 불렀지, 구경하라고 불렀나.',
  '{name}, 점심시간은 아까 끝났어.',
  '다들 화장실 갔어? 단체로?',
  '{name}, 무한 루프 돌고 있는 거 아니지?',
  '이 조용함… 다들 유튜브 보나?',
  '{name}, 탭 전환하는 소리 다 들린다.',
  '보고 없으면 내가 가서 모니터 본다.',
  '{name}, 잠깐 나 좀 볼까? 아니 지금.',
  '마감이 우리를 기다려 주지 않는다.',
  '{name}, 커밋 메시지라도 좀 써 봐.',
  '팀장 속 타는 소리 들리나?',
  '{name}, 혹시 퇴사 준비 중이야?',
  '이러다 내가 코딩한다?',
  '{name}, 테스트 돌려 놓고 딴짓하지?',
  '다음 주 평가 시즌인 거 알지?',
  '{name}, 스택 오버플로 그만 보고 와.',
  '빨간 불 들어온 거 다 보인다.',
  '{name}, 배포는 금요일 오후에 하는 거 아니다.',
  '보고는 짧게, 자주. 몇 번을 말해.',
  '{name}, 알림 꺼 놨지?',
  '회의록에 너 이름 적는다.',
  '{name}, 키보드 소리가 안 들린다.',
  '오늘 저녁은 다 같이 편의점이다.',
  // 꼰대 모드
  '나 때는 말이야, 밤새서 했어.',
  '{name}, 요즘 애들은 끈기가 없어.',
  '라떼는 보고서를 손으로 썼다.',
  '{name}, 내가 신입 때는 30분 일찍 왔어.',
  '열정이 없어, 열정이.',
  '{name}, 까라면 까는 거야.',
  '내가 다 너 잘되라고 하는 소리야.',
  '{name}, 그건 네 생각이고.',
  '우리 때는 칼퇴가 뭔지도 몰랐어.',
  '{name}, 일은 머리로 하는 게 아니라 엉덩이로 하는 거야.',
  '회사가 학교야? 하나하나 알려 줘야 돼?',
  '{name}, 토 달지 말고 일단 해 봐.',
  '요즘은 보고도 문자로 하나? 얼굴 보고 해.',
  '{name}, 그 정도는 알아서 해야지.',
  '내가 이 회사에 20년 있었어.',
  '{name}, 주인 의식을 가져, 주인 의식.',
  '젊은 사람이 벌써 피곤하면 어떡해.',
  '{name}, 회식 빠지면 섭섭하다?',
  // 반장 모드
  '떠든 사람 이름 칠판에 적는다.',
  '{name}, 이름 적었다. 떠든 사람.',
  '딴짓한 사람 다 적어 놨어.',
  '{name}, 칠판에 이름 두 번째다.',
  '자습 시간에 누가 떠들어?',
  '{name}, 뒤로 나가서 손 들고 서 있어.',
  '선생님 오시면 다 이른다.',
  '{name}, 반성문 세 장.',
  '조용히 해! 떠든 사람 청소 당번.',
  '{name}, 교무실로 따라와.',
]

/** 막 보고가 들어왔을 때 팀장의 반응. {name} 은 보고한 팀원. */
export const PRAISE_LINES: readonly string[] = [
  '오, 좋아! 계속 그렇게.',
  '역시 {name}!',
  '이 맛에 팀장 한다.',
  '{name}, 오늘 커피는 내가 쏜다.',
  '그렇지, 그렇게 하는 거야.',
  '{name} 덕분에 한숨 돌렸다.',
  '보고 받았다, 수고!',
  '{name}, 오늘 점심은 내가 산다!',
  '이게 팀워크지.',
  '{name}, 이번 분기 MVP 후보다.',
  '좋아, 이 속도 유지!',
  '{name} 없었으면 어쩔 뻔했어.',
  '보고 딱 좋다, 딱 이렇게.',
]

/** 일하는 팀원이 하나도 없을 때(빈자리뿐) 팀장의 한탄. */
export const EMPTY_LINES: readonly string[] = [
  '모두 일 안 하고 어디 갔어?',
  '다들 휴가 갔나?',
  '사무실이 텅 비었네…',
  '일감 어디 없나…',
  '커피나 한 잔 할까.',
  '조용한 게 제일 무섭다.',
  '출근 도장만 찍고 사라졌나?',
  '빈 의자만 나를 보고 있다.',
  '이럴 거면 나도 퇴근한다.',
  '누가 위임 좀 해 줘요.',
  '오늘 할 일이 없는 게 할 일인가.',
  '다 어디 갔어, 회식이라도 간 거야?',
  '회사 놀러 나온 거야?',
  '여기가 무슨 동아리방이야?',
  '월급날만 출근하는 거 아니지?',
  '자리 비울 거면 메모라도 남기지.',
  '여기 사무실 맞지? 독서실 아니고?',
  '일 안 주면 나도 논다?',
  '위임 버튼 고장 났나?',
  '오늘은 에어컨만 열일하네.',
  '빈 책상 먼지 쌓이겠다.',
  '팀원 모집합니다. 경력 무관.',
  '할 일 목록이 텅 비면 불안하다.',
  '이 평화, 폭풍 전야 같은데…',
]

/** 팀장의 혼잣말 — 신세 한탄·메뉴 고민·골프 생각. 빈자리일 때 한탄과 섞이고, 잔소리 중에도 네 번에 한 번 끼어든다(사용자 요청). */
export const MUSING_LINES: readonly string[] = [
  // 신세 한탄
  '내가 이러려고 팀장 됐나…',
  '위에선 까이고 아래선 치이고.',
  '팀장 수당이 이거 받으려고 받는 건가.',
  '나도 한때는 잘나가는 팀원이었는데.',
  '승진하면 편할 줄 알았지…',
  '결재판만 들고 다니는 인생.',
  '주말에도 슬랙 알림이 꿈에 나온다.',
  '내 연차는 언제 쓰나…',
  '요즘 탈모가 심해졌어.',
  '이번 달도 카드값이 월급을 이긴다.',
  '로또나 사러 갈까.',
  '회사 그만두고 치킨집이나 할까…',
  '퇴근하고 싶다. 출근한 지 10분 됐다.',
  '커피가 없으면 나도 없다.',
  // 메뉴 고민
  '점심 뭐 먹지…',
  '오늘은 짜장이냐 짬뽕이냐.',
  '김치찌개? 된장찌개? 아 고민되네.',
  '국밥 한 그릇 땡기는 날씨다.',
  '오늘 구내식당 메뉴 뭐였더라.',
  '돈가스 먹을 사람 손!',
  '제육볶음 아니면 안 먹어.',
  '마라탕 한 번 가 볼까.',
  '저녁은 치킨이다. 반박 시 야근.',
  '떡볶이 시킬 사람?',
  '오늘은 샐러드… 는 무슨, 삼겹살이다.',
  '라면 물 올려 놓을까.',
  '편의점 도시락도 나쁘지 않지.',
  '회식은 소고기면 간다.',
  // 골프 생각
  '이번 주말 라운딩 날씨 괜찮으려나.',
  '드라이버 새로 살까… 아내한테 뭐라 하지.',
  '어제 연습장에서 슬라이스만 났어.',
  '백돌이 탈출은 언제 하나.',
  '버디 한 번만 해 보고 싶다.',
  '점심시간에 스크린 한 게임 어때?',
  '상무님이랑 라운딩, 적당히 져 드려야지.',
  '공 또 해저드에 빠졌던 꿈 꿨다.',
  '퍼팅만 되면 싱글인데.',
  '머리 들지 말자, 머리 들지 말자…',
  '이 보고서만 끝나면 연습장 간다.',
  '멀리건 한 번만 쓰자.',
]

/** 단독 감시(/poll) — 팀장이 곧 팀원이라 자기를 부르지 않고 혼잣말을 한다. */
export const SOLO_NAG_LINES: readonly string[] = [
  '혼자 하니까 보고할 사람도 없네.',
  '내가 팀장이고 내가 팀원이다.',
  '야근 수당은 누가 주나…',
  '나한테 잔소리할 사람도 없고…',
  '1인 기업의 비애.',
  '보고서는 나 혼자 쓰고 나 혼자 읽는다.',
  '이거 끝나면 나한테 칭찬해 줘야지.',
  '셀프 스탠드업 시작합니다.',
  '회의 소집합니다. 참석자: 나.',
  '나 오늘 좀 열일하는 듯.',
  '결재도 내가, 실행도 내가.',
  '누가 커피 좀 타 줬으면…',
]
export const SOLO_PRAISE_LINES: readonly string[] = [
  '오, 나 좀 하는데?',
  '셀프 칭찬 한 번.',
  '이 정도면 승진 각.',
  '역시 나야.',
  '박수 짝짝짝, 셀프로.',
  '나 자신, 칭찬해.',
]
export const SOLO_EMPTY_LINES: readonly string[] = [
  '혼자인데 일도 없네…',
  '일감아, 어디 있니.',
  '나 혼자 사무실 지키는 중.',
  '위임 좀 해 주세요, 한가합니다.',
  '혼자 멍 때리는 중.',
  '오늘 할 일: 기다리기.',
]

/** 팀원 보고 말풍선의 머리말 — 요약 앞에 붙는 한마디. */
export const REPORT_OPENERS: Readonly<Record<'progress' | 'completion', readonly string[]>> = {
  progress: ['팀장님, 보고드립니다!', '중간 보고요~', '잘 되고 있어요!', '짜잔, 진행 상황!', '놀고 있던 거 아닙니다!', '진척 있어요!',
    '보고 안 한다고 혼날까 봐…', '살아 있습니다!', '딴짓 아니고 일했어요!', '팀장님, 이것 좀 보세요!', '생존 신고합니다!'],
  completion: ['다 했습니다!', '완료 보고 올립니다!', '끝! 검토 부탁해요.', '승인 부탁드려요~', '퇴근해도 되죠?',
    '칼퇴 각!', '제 몫은 끝났습니다!', '검토는 팀장님 몫!', '커피 쿠폰 주시는 거죠?'],
}

const WORKING = new Set(['ACTIVE', 'STALE', 'OFFLINE', 'REJECTED'])

/** 잔소리 네 번에 한 번은 혼잣말(한탄·메뉴)로 샌다. */
function musingTurn(seed: string, nowMs: number): boolean {
  return (Math.floor(nowMs / ROTATE_MS) + fnv1a32(seed)) % 4 === 3
}

function pick(lines: readonly string[], seed: string, nowMs: number): string {
  const i = (Math.floor(nowMs / ROTATE_MS) + fnv1a32(seed)) % lines.length
  return lines[i]
}

function reportMs(d: RosterDesk): number {
  const at = d.seat?.lastReport?.at
  return at ? Date.parse(at) : 0
}

/** 팀원 말풍선 — 최근 보고가 있으면 머리말 + 요약. 없으면 null(단계 말풍선을 쓴다). */
export function memberReportBubble(d: RosterDesk, nowMs: number): { opener: string; text: string; kind: 'progress' | 'completion' } | null {
  const r = d.seat?.lastReport
  if (!r || nowMs - Date.parse(r.at) > REPORT_FRESH_MS) return null
  const pool = REPORT_OPENERS[r.kind]
  // 머리말은 보고 하나에 하나로 고정한다 — 8초마다 바뀌면 산만하다.
  return { opener: pool[fnv1a32(`${d.key}|${r.at}`) % pool.length], text: r.summary, kind: r.kind }
}

/**
 * 팀장 말풍선 — 막 보고가 들어왔으면 칭찬, 일하는 팀원이 있는데 QUIET_MS 동안 아무도 보고하지 않았거나
 * 누가 무응답·끊김이면 잔소리, 일하는 팀원이 하나도 없으면(빈자리뿐) 한탄.
 * 단독 감시(/poll)는 자기가 곧 팀원이라 자기 이름을 부르지 않고 혼잣말 묶음을 쓴다.
 * 결정 대기 팀원만 있으면(공이 사람에게 있다) 말하지 않는다.
 */
export function leadChatter(host: RosterHost, nowMs: number, lead?: Pick<RosterDesk, 'slot'>): { tone: 'nag' | 'praise' | 'empty'; text: string } | null {
  const solo = lead?.slot === 'poll'
  const members = host.desks.filter(d => d.kind === 'member' && d.seat)
  const working = members.filter(d => WORKING.has(d.seat!.state))
  if (working.length === 0) {
    if (members.length > 0) return null
    return { tone: 'empty', text: pick([...(solo ? SOLO_EMPTY_LINES : EMPTY_LINES), ...MUSING_LINES], host.key, nowMs) }
  }
  const latest = working.reduce((a, d) => (reportMs(d) > reportMs(a) ? d : a))
  if (reportMs(latest) > 0 && nowMs - reportMs(latest) <= PRAISE_MS) {
    return { tone: 'praise', text: pick(solo ? SOLO_PRAISE_LINES : PRAISE_LINES, host.key, nowMs).replaceAll('{name}', latest.label) }
  }
  const lagging = working.some(d => d.seat!.state === 'STALE' || d.seat!.state === 'OFFLINE')
  const quiet = working.every(d => nowMs - reportMs(d) > QUIET_MS)
  if (!lagging && !quiet) return null
  if (musingTurn(host.key, nowMs)) return { tone: 'empty', text: pick(MUSING_LINES, `${host.key}|m`, nowMs) }
  if (solo) return { tone: 'nag', text: pick(SOLO_NAG_LINES, host.key, nowMs) }
  // 지목 대상 — 끊긴 팀원이 먼저, 그다음 가장 오래 보고가 없는 팀원.
  const rank = (d: RosterDesk) => (d.seat!.state === 'OFFLINE' ? 2 : d.seat!.state === 'STALE' ? 1 : 0)
  const target = [...working].sort((a, b) => rank(b) - rank(a) || reportMs(a) - reportMs(b))[0]
  return { tone: 'nag', text: pick(NAG_LINES, host.key, nowMs).replaceAll('{name}', target.label) }
}
