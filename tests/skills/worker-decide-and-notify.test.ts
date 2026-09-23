// tests/skills/worker-decide-and-notify.test.ts
// 팀원은 판단 분기마다 멈추지 않고 "합리적으로 고르고 나중에 알린다"(2026-09-19 사용자 지시).
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = process.cwd()
const prompt = readFileSync(join(ROOT, '.claude/skills/dflow-team/references/worker-prompt.md'), 'utf8')
const dev = readFileSync(join(ROOT, '.claude/skills/dflow-dev/SKILL.md'), 'utf8')

describe('워커 판단 규칙: 골라서 진행하고 기록한다', () => {
  it('기본값이 없어도 멈추지 않고 design.md 고정 절에 다섯 항목을 남긴다', () => {
    expect(prompt).toContain('기본값이 없어도 멈추지 않는다')
    expect(prompt).toContain('`## 담당자 확인 필요 결정` 에 결정마다 다섯 가지를 남긴다: 질문, 선택지, 택한 것, 근거, 반려되면 재작업할 방향')
    expect(prompt).not.toContain('기본값이 없어 담당자 결정이 꼭 필요할 때만 멈춘다')
  })
  it('blocked 는 되돌리기 어려운 결정뿐이다', () => {
    expect(prompt).toContain('**`blocked` 로 멈추는 것은 되돌리기 어려운 결정뿐이다**')
    expect(dev).toContain('`blocked` 는 되돌리기 어려운 결정(데이터 삭제·외부 공개·다른 Task 산출물의 대폭 수정·보안·권한 변경)에만 쓴다')
  })
  it('done 요약과 .result 사유에 결정 건수를 싣는다', () => {
    expect(prompt).toContain('`확인 필요 결정 N건: <질문 요약; …>`')
    expect(prompt).toContain('끝에 `(결정 N건)`')
    expect(dev).toContain('Phase 06 `done` 요약 끝에 `확인 필요 결정 N건: …` 을 싣는다')
  })
  it('Phase 06 은 결정 목록을 decisions.json 으로 옮겨 done --decisions 로 넘기고, 0건이면 [] 를 쓴다(과제 C)', () => {
    for (const doc of [prompt, dev]) {
      expect(doc).toContain('decisions.json')
      expect(doc).toContain('--decisions')
    }
    expect(prompt).toContain('**0건이면 `[]` 를 써서 넘긴다**')
    expect(prompt).toContain('`done --auto-links --decisions …`')
    expect(prompt).toContain('`chosen`(택한 선택지의 0부터 센 색인 — 문구가 아니다)')
    expect(dev).toContain('supervised 모드(플래그 없음)도 넘긴다')
    expect(dev).toContain('done 이 exit 0 이면 지우고')
  })
  it('dflow-work 문서가 --decisions 와 경고 코드의 뜻을 안내한다', () => {
    const skill = readFileSync(join(ROOT, '.claude/skills/dflow-work/SKILL.md'), 'utf8')
    const trouble = readFileSync(join(ROOT, '.claude/skills/dflow-work/references/troubleshooting.md'), 'utf8')
    expect(skill).toContain('--decisions')
    for (const code of ['DECISIONS_INVALID', 'DECISIONS_COUNT_MISMATCH', 'DECISIONS_SUFFIX_MISSING', '서버가 결정 목록을 모릅니다']) {
      expect(trouble).toContain(code)
    }
  })
})
