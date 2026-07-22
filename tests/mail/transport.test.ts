import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const { createTransport, sendMail } = vi.hoisted(() => {
  const sendMail = vi.fn()
  return { sendMail, createTransport: vi.fn(() => ({ sendMail })) }
})
vi.mock('nodemailer', () => ({ default: { createTransport } }))

import { getTransport } from '@/lib/mail/transport'

describe('getTransport', () => {
  beforeEach(() => { createTransport.mockClear(); sendMail.mockReset() })
  afterEach(() => { vi.unstubAllEnvs() })

  it('SMTP_USER 가 없으면 throw 하지 않고 ok:false 를 낸다', () => {
    vi.stubEnv('SMTP_USER', '')
    vi.stubEnv('SMTP_PASS', 'pw')
    const tx = getTransport()
    expect(tx.ok).toBe(false)
    expect(createTransport).not.toHaveBeenCalled()
  })

  it('SMTP_PASS 가 없어도 ok:false 를 낸다', () => {
    vi.stubEnv('SMTP_USER', 'a@gmail.com')
    vi.stubEnv('SMTP_PASS', '')
    expect(getTransport().ok).toBe(false)
    expect(createTransport).not.toHaveBeenCalled()
  })

  it('둘 다 있으면 Gmail SMTP 를 465/secure + 10초 타임아웃으로 만든다', () => {
    vi.stubEnv('SMTP_USER', 'a@gmail.com')
    vi.stubEnv('SMTP_PASS', 'pw')
    expect(getTransport().ok).toBe(true)
    expect(createTransport).toHaveBeenCalledWith(expect.objectContaining({
      host: 'smtp.gmail.com', port: 465, secure: true,
      auth: { user: 'a@gmail.com', pass: 'pw' },
      connectionTimeout: 10_000, greetingTimeout: 10_000, socketTimeout: 10_000,
    }))
  })

  it('send 는 발신 표시명을 붙이고 rejected 를 문자열 배열로 돌려준다', async () => {
    vi.stubEnv('SMTP_USER', 'a@gmail.com')
    vi.stubEnv('SMTP_PASS', 'pw')
    vi.stubEnv('MAIL_FROM_NAME', '테스트 발신')
    sendMail.mockResolvedValue({ rejected: ['bad@x.com'] })

    const tx = getTransport()
    if (!tx.ok) throw new Error('트랜스포트가 만들어져야 한다')
    const out = await tx.send({
      to: ['a@dongkuk.com'], replyTo: 'me@dongkuk.com',
      subject: 'S', html: '<b>H</b>', text: 'T',
    })

    expect(out).toEqual({ rejected: ['bad@x.com'] })
    expect(sendMail).toHaveBeenCalledWith(expect.objectContaining({
      from: { name: '테스트 발신', address: 'a@gmail.com' },
      to: ['a@dongkuk.com'], replyTo: 'me@dongkuk.com',
      subject: 'S', html: '<b>H</b>', text: 'T',
    }))
  })

  it('rejected 가 없으면 빈 배열을 낸다', async () => {
    vi.stubEnv('SMTP_USER', 'a@gmail.com')
    vi.stubEnv('SMTP_PASS', 'pw')
    sendMail.mockResolvedValue({})
    const tx = getTransport()
    if (!tx.ok) throw new Error('트랜스포트가 만들어져야 한다')
    expect(await tx.send({ to: ['a@b.com'], replyTo: null, subject: 'S', html: 'H', text: 'T' }))
      .toEqual({ rejected: [] })
  })
})
