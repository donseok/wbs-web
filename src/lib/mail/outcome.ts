import type { DictKey } from '@/lib/i18n/dict'
import type { SkipReason } from '@/lib/mail/recipients'

export interface MeetingNotifyResult {
  ok: boolean
  /** 전송 자체가 불가능했던 사유(사용자에게 그대로 보여줄 수 있는 한국어 문장). */
  error?: string
  /** 메일이 나간 참석자 이름. */
  sentTo: string[]
  /** 제외된 참석자와 이유. */
  skipped: { name: string; reason: SkipReason }[]
}

export type NotifyOutcome =
  /** 전원 성공 — 모달을 닫고 토스트만 띄운다. */
  | { kind: 'toast'; message: string }
  /** 사용자가 읽고 넘겨야 하는 결과 — 모달을 붙잡아 둔다. */
  | { kind: 'panel'; tone: 'warn' | 'error'; message: string }

function fill(template: string, vars: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (_, k: string) => vars[k] ?? '')
}

type T = (key: DictKey) => string

/**
 * 발송 결과 → 화면 표시 방식.
 * 토스트는 3.5초 뒤 사라지므로 성공에만 쓰고, 나쁜 소식은 패널로 남긴다.
 */
export function describeNotifyResult(res: MeetingNotifyResult, t: T): NotifyOutcome {
  if (!res.ok) {
    return {
      kind: 'panel',
      tone: 'error',
      message: res.error
        ? fill(t('meet.notify.failed'), { error: res.error })
        : t('meet.notify.unknown'),
    }
  }

  if (res.sentTo.length === 0) {
    return { kind: 'panel', tone: 'warn', message: t('meet.notify.noneSent') }
  }

  if (res.skipped.length === 0) {
    return { kind: 'toast', message: fill(t('meet.notify.sent'), { n: String(res.sentTo.length) }) }
  }

  const names = res.skipped
    .map(s => `${s.name}(${t(`meet.notify.reason.${s.reason}` as DictKey)})`)
    .join(', ')
  return {
    kind: 'panel',
    tone: 'warn',
    message: fill(t('meet.notify.partial'), { n: String(res.sentTo.length), names }),
  }
}
