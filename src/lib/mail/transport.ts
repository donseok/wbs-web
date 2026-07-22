import 'server-only'
import nodemailer from 'nodemailer'

export interface MailMessage {
  to: string[]
  replyTo: string | null
  subject: string
  html: string
  text: string
}

export type Transport =
  | { ok: true; send: (msg: MailMessage) => Promise<{ rejected: string[] }> }
  | { ok: false; error: string }

// nodemailer 기본 타임아웃은 훨씬 길다. 사용자가 저장 버튼 앞에서 기다리는 동기 경로이므로 짧게 묶는다.
const TIMEOUT_MS = 10_000
const DEFAULT_FROM_NAME = 'D-CUBE 회의알림'

/**
 * Gmail SMTP 트랜스포트.
 * 환경변수가 없으면 **throw 하지 않고** ok:false 를 낸다 — 로컬·Preview 에서 화면을 죽이지 않기 위해서다.
 * `from` 은 이 모듈이 소유한다. 호출자가 발신 주소를 바꿀 수 없다.
 */
export function getTransport(): Transport {
  const user = process.env.SMTP_USER?.trim()
  const pass = process.env.SMTP_PASS?.trim()
  if (!user || !pass) return { ok: false, error: '메일 발송이 설정되지 않았습니다.' }

  const fromName = process.env.MAIL_FROM_NAME?.trim() || DEFAULT_FROM_NAME
  const tx = nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 465,
    secure: true,
    auth: { user, pass },
    connectionTimeout: TIMEOUT_MS,
    greetingTimeout: TIMEOUT_MS,
    socketTimeout: TIMEOUT_MS,
  })

  return {
    ok: true,
    send: async (msg) => {
      const info = await tx.sendMail({
        from: { name: fromName, address: user },
        to: msg.to,
        replyTo: msg.replyTo ?? undefined,
        subject: msg.subject,
        html: msg.html,
        text: msg.text,
      })
      // nodemailer 의 rejected 는 문자열 또는 주소 객체가 섞여 올 수 있다.
      const rejected = (info.rejected ?? []) as unknown[]
      return {
        rejected: rejected.map(r =>
          typeof r === 'string' ? r : String((r as { address?: string })?.address ?? r)),
      }
    },
  }
}
