import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { renderInviteMail, type InviteMailInput } from '@/lib/mail/projectInvite'

const URL = 'https://wbs-web.vercel.app/invite/3f2a1c9e-0b7d-4c8a-9f1e-2d6b5a4c3e10'

function render(overrides: Partial<InviteMailInput> = {}) {
  return renderInviteMail({
    projectName: 'D-CUBE 구축',
    inviterName: '김철수',
    url: URL,
    expiresAt: '2026-08-10T08:00:00Z',
    ...overrides,
  })
}

describe('renderInviteMail — 제목', () => {
  it('프로젝트명을 담은 고정 형식이다', () => {
    expect(render().subject).toBe('[D-CUBE] D-CUBE 구축 프로젝트 초대')
  })

  it('프로젝트명의 CR/LF 를 걷어낸다 — 메일 헤더는 한 줄이다', () => {
    const { subject } = render({ projectName: '구축\r\nBcc: evil@x.com' })
    expect(subject).not.toMatch(/[\r\n]/)
    expect(subject).toBe('[D-CUBE] 구축 Bcc: evil@x.com 프로젝트 초대')
  })
})

describe('renderInviteMail — 링크', () => {
  it('html 에 a 태그와 주소 전문을 둘 다 싣는다', () => {
    const { html } = render()
    expect(html).toContain(`href="${URL}"`)
    // 버튼을 죽이는 클라이언트에서도 주소를 복사할 수 있어야 한다.
    expect(html.split(URL).length - 1).toBeGreaterThanOrEqual(2)
  })

  it('text 파트에도 주소가 그대로 있다 — 없으면 평문 수신자는 합류할 길이 없다', () => {
    expect(render().text).toContain(URL)
  })
})

describe('renderInviteMail — 만료 표기', () => {
  it('Asia/Seoul 로 표기한다', () => {
    const { html, text } = render()
    expect(text).toContain('만료: 2026-08-10 17:00 (한국 시간)')
    expect(html).toContain('2026-08-10 17:00 (한국 시간)')
  })

  it('날짜 경계를 넘기는 UTC 시각도 한국 날짜로 찍는다', () => {
    // 2026-08-10T16:00Z = 2026-08-11 01:00 KST — UTC 로 찍으면 하루 어긋난다.
    expect(render({ expiresAt: '2026-08-10T16:00:00Z' }).text)
      .toContain('만료: 2026-08-11 01:00 (한국 시간)')
  })

  it('파싱 실패를 그럴듯한 날짜로 위장하지 않는다', () => {
    const { text, html } = render({ expiresAt: 'not-a-date' })
    expect(text).toContain('만료: 확인할 수 없음')
    expect(text).not.toContain('Invalid')
    expect(html).not.toContain('Invalid')
    // 만료를 못 읽어도 링크는 나가야 한다 — 만료 판정은 어차피 DB 가 한다.
    expect(text).toContain(URL)
  })
})

// 서버 타임존이 달라도 수신자가 보는 시각은 같아야 한다. 기본 TZ 로만 돌리면 CI 가 이를 놓친다.
describe('renderInviteMail — 서버 타임존에 흔들리지 않는다', () => {
  const ORIGINAL_TZ = process.env.TZ

  beforeAll(() => { process.env.TZ = 'America/Los_Angeles' })

  // TZ 가 원래 없었으면 지운다 — undefined 를 대입하면 문자열 'undefined' 가 박힌다.
  afterAll(() => {
    if (ORIGINAL_TZ === undefined) delete process.env.TZ
    else process.env.TZ = ORIGINAL_TZ
  })

  it('음수 오프셋 타임존에서도 만료 표기가 그대로다', () => {
    expect(render().text).toContain('만료: 2026-08-10 17:00 (한국 시간)')
  })
})

describe('renderInviteMail — 본문 필수 항목', () => {
  it('프로젝트명·초대한 사람을 담는다', () => {
    const { html, text } = render()
    expect(text).toContain('프로젝트: D-CUBE 구축')
    expect(text).toContain('초대한 사람: 김철수')
    expect(html).toContain('>김철수<')
  })

  it('1회용·수신자 한정 안내와 무시 안내를 담는다', () => {
    const { html, text } = render()
    for (const part of [text, html]) {
      expect(part).toContain('이 링크는 1회용이며 이 메일 주소로만 사용할 수 있습니다.')
      expect(part).toContain('본인이 요청하지 않은 메일이면 무시하세요.')
    }
  })

  it('text 파트를 항상 만든다 — 없으면 스팸 점수가 올라간다', () => {
    expect(render().text.length).toBeGreaterThan(0)
  })

  it('모든 셀에 폰트를 되풀이한다 — Outlook 은 표 셀로 폰트를 상속시키지 않는다', () => {
    const cells = render().html.match(/<td style="[^"]*"/g) ?? []
    expect(cells.length).toBeGreaterThan(0)
    for (const cell of cells) {
      expect(cell).toContain('font-family:')
      expect(cell).toContain('font-size:14px')
    }
  })

  it('외부 CSS 에 기대지 않는다 — 메일 클라이언트는 <style>/class 를 못 읽는다', () => {
    const { html } = render()
    expect(html).not.toContain('<style')
    expect(html).not.toContain('class=')
  })
})

describe('renderInviteMail — 초대한 사람이 없을 때', () => {
  it('null 이어도 깨지지 않고 그 줄만 빠진다', () => {
    const { html, text } = render({ inviterName: null })
    expect(text).not.toContain('초대한 사람')
    expect(html).not.toContain('초대한 사람')
    expect(text).toContain('프로젝트: D-CUBE 구축')
    expect(text).toContain(URL)
    expect(text).not.toContain('null')
  })

  it('공백뿐인 이름도 줄을 만들지 않는다', () => {
    expect(render({ inviterName: '   ' }).text).not.toContain('초대한 사람')
  })
})

describe('renderInviteMail — 이스케이프', () => {
  it('프로젝트명의 HTML 을 이스케이프한다', () => {
    const { html } = render({ projectName: '<script>alert(1)</script> A & B' })
    expect(html).not.toContain('<script>')
    expect(html).toContain('&lt;script&gt;')
    expect(html).toContain('A &amp; B')
  })

  it('초대한 사람 이름도 이스케이프한다', () => {
    const { html } = render({ inviterName: '<img src=x onerror=1>' })
    expect(html).not.toContain('<img src=x')
    expect(html).toContain('&lt;img src=x onerror=1&gt;')
  })

  it('따옴표를 이스케이프한다 — 속성값 밖으로 빠져나가지 못하게', () => {
    const { html } = render({ projectName: 'A "B" \'C\'' })
    expect(html).toContain('&quot;')
    expect(html).toContain('&#39;')
  })

  it('text 파트는 이스케이프하지 않고 원문을 담는다', () => {
    expect(render({ projectName: 'A & B' }).text).toContain('A & B')
  })
})
