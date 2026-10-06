// 터미널 글(입력 요청 발췌·최근 화면)을 웹에 그릴 때의 안전한 표기 — IO 없는 순수 함수.
// 이 글은 사람이 읽고 답(키)을 정하는 근거다. 눈에 보이지 않거나 글자 순서를 뒤집는 문자가 섞이면 웹에서 보이는 명령과
// 실제 명령이 달라 보일 수 있으므로, 그런 문자는 ⟨U+XXXX⟩ 꼴의 눈에 보이는 기호로 바꿔 그린다.
// 화면에서만 바꾼다 — 서버에서 지우면 PC 가 계산한 발췌 해시와 어긋나므로 저장된 글은 그대로 둔다.
// (호모글리프 — 모양만 같은 다른 글자 — 는 알려진 한계이며 다루지 않는다.)

const hex = (cp: number) => `⟨U+${cp.toString(16).toUpperCase().padStart(4, '0')}⟩`

/** 눈에 보이는 기호로 바꿀 코드포인트. ZWJ(U+200D)는 별도 규칙이라 여기에 넣지 않는다. */
function isHidden(cp: number): boolean {
  return (
    (cp >= 0x202A && cp <= 0x202E) || (cp >= 0x2066 && cp <= 0x2069) || cp === 0x200E || cp === 0x200F || cp === 0x061C || // 양방향 제어
    cp === 0x200B || cp === 0x200C || (cp >= 0x2060 && cp <= 0x2064) || cp === 0xFEFF || cp === 0x00AD || cp === 0x034F || cp === 0x180E || // 폭 없는 문자·숨는 문자
    (cp >= 0xE0000 && cp <= 0xE007F) || // 태그 문자(아스트랄)
    cp === 0x2028 || cp === 0x2029 // 줄 구분 — pre-wrap 에서 줄바꿈으로 그려져 가짜 줄처럼 보인다
  )
}

const PICTO = /^\p{Extended_Pictographic}$/u
const EMOJI_TAIL = /^(?:\p{Extended_Pictographic}|\p{Emoji_Modifier}|️)$/u

/**
 * ZWJ(U+200D) 규칙 — 이모지 조합 안의 ZWJ 는 그대로 둔다(👨‍👩‍👧 처럼 ZWJ 로 이은 시퀀스가 깨져 보이면 정상 글자를 바꾸는 셈이다).
 * 앞이 이모지(그림 문자·피부색 수식어·VS16)이고 바로 뒤가 그림 문자일 때만 조합으로 본다. 단독이거나 글자·공백 사이,
 * 줄 끝의 ZWJ 는 아무것도 잇지 않으면서 보이지 않을 뿐이라 기호로 바꾼다.
 */
function isEmojiJoiner(prev: string | undefined, next: string | undefined): boolean {
  return prev !== undefined && next !== undefined && EMOJI_TAIL.test(prev) && PICTO.test(next)
}

/** 터미널 한 줄을 그릴 글로 바꾼다. 정상 글자(한글·영문·이모지 시퀀스)는 바꾸지 않는다. */
export function showableTerminalLine(line: string): string {
  const cps = [...line] // 코드포인트 단위 — 태그 문자 같은 아스트랄도 한 글자로 센다
  let out = ''
  for (let i = 0; i < cps.length; i++) {
    const c = cps[i]
    const cp = c.codePointAt(0)!
    if (cp === 0x200D) out += isEmojiJoiner(cps[i - 1], cps[i + 1]) ? c : hex(cp)
    else out += isHidden(cp) ? hex(cp) : c
  }
  return out
}
