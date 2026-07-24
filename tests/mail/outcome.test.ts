import { describe, it, expect } from 'vitest'
import type { DictKey } from '@/lib/i18n/dict'
import { DICT } from '@/lib/i18n/dict'
import { describeNotifyResult, type MeetingNotifyResult } from '@/lib/mail/outcome'

// 실제 ko 사전을 그대로 쓴다 — 키 오타가 테스트에서 잡힌다.
const t = (k: DictKey) => (DICT.ko as Record<string, string>)[k] ?? k

function res(over: Partial<MeetingNotifyResult> = {}): MeetingNotifyResult {
  return { ok: true, sentTo: [], skipped: [], ...over }
}

describe('describeNotifyResult', () => {
  it('전원 발송이면 토스트로 알린다', () => {
    const out = describeNotifyResult(res({ sentTo: ['김철수', '박영희'] }), t)
    expect(out.kind).toBe('toast')
    expect(out.message).toBe('수신자 2명에게 회의 안내 메일을 보냈습니다.')
  })

  it('일부 제외가 있으면 패널을 띄우고 이름과 사유를 적는다', () => {
    const out = describeNotifyResult(res({
      sentTo: ['김철수'],
      skipped: [{ name: '박영희', reason: 'no_email' }, { name: '이민수', reason: 'invalid_email' }],
    }), t)
    expect(out.kind).toBe('panel')
    expect(out).toMatchObject({ tone: 'warn' })
    expect(out.message).toContain('1명에게 발송했고')
    expect(out.message).toContain('박영희(이메일 없음)')
    expect(out.message).toContain('이민수(이메일 형식 오류)')
  })

  it('보낼 주소가 하나도 없으면 전용 문구를 쓴다', () => {
    const out = describeNotifyResult(res({
      sentTo: [], skipped: [{ name: '박영희', reason: 'no_email' }],
    }), t)
    expect(out.kind).toBe('panel')
    expect(out.message).toBe('회의가 저장되었습니다. 보낼 수 있는 수신자가 없어 메일을 보내지 않았습니다.')
  })

  it('발송 실패는 error 톤 패널이며 사유를 그대로 싣는다', () => {
    const out = describeNotifyResult(res({ ok: false, error: '메일 계정 인증에 실패했습니다.' }), t)
    expect(out).toMatchObject({ kind: 'panel', tone: 'error' })
    expect(out.message).toBe('회의는 정상 저장되었습니다. 다만 메일 발송에 실패했습니다 — 메일 계정 인증에 실패했습니다.')
  })

  it('실패인데 사유가 없으면 결과 미확인 문구로 폴백한다', () => {
    const out = describeNotifyResult(res({ ok: false }), t)
    expect(out).toMatchObject({ kind: 'panel', tone: 'error' })
    expect(out.message).toBe('회의는 저장되었으나 발송 결과를 확인하지 못했습니다.')
  })

  it('rejected 사유도 사람이 읽는 말로 바꾼다', () => {
    const out = describeNotifyResult(res({
      sentTo: ['김철수'], skipped: [{ name: '박영희', reason: 'rejected' }],
    }), t)
    expect(out.message).toContain('박영희(수신 거부됨)')
  })

  it('사전에 없는 키로 새지 않는다 — 모든 문구가 원문 키와 달라야 한다', () => {
    const out = describeNotifyResult(res({ sentTo: ['김철수'] }), t)
    expect(out.message).not.toContain('meet.notify')
    expect(out.message).not.toContain('{')
  })
})
