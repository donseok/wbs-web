// tests/skills/dflow-wbs-contract-rules.test.ts
// 병렬 머지 충돌 예방(2026-09-23 §3) — 계약 Task 규칙이 /dflow-wbs 문서와 생성 산출물(acceptance)에 실린다.
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const WBS = readFileSync(join(process.cwd(), '.claude/skills/dflow-wbs/SKILL.md'), 'utf8')
const FIXED = [
  '- 공유 시험은 틀의 존재·탑재 순서만 단정한다. 빈 라우터·스텁 목록(`STUBS` 등)을 단정하지 않는다',
  '- 기능 Task 마다 자기 시험 파일과 소유 파일을 design.md `## 기능 Task 편집 지점` 에 적고, 두 Task 가 한 파일을 나눠 갖지 않는다',
  '- 등록(라우트·핸들러 목록)은 자동 수집이며 기능 Task 가 공유 진입점에 줄을 더하지 않아도 된다',
  '- 계약 문서가 지정한 파일(공용 시험 헬퍼 포함)이 모두 있다',
]

describe('/dflow-wbs — 계약 Task 의 공유 파일 규칙', () => {
  it('절이 있고 C1~C7 이 있다', () => {
    expect(WBS).toContain('### 계약 Task 의 공유 파일 규칙')
    for (const c of ['| C1 |', '| C2 |', '| C3 |', '| C4 |', '| C5 |', '| C6 |', '| C7 |']) expect(WBS).toContain(c)
  })
  it('절은 「의존 그래프 구조 예외」 뒤, 엑셀 export 앞에 있다(프로그램 리스트 골격 뒤)', () => {
    const at = WBS.indexOf('### 계약 Task 의 공유 파일 규칙')
    expect(at).toBeGreaterThan(WBS.indexOf('⚠️ **의존 그래프 구조 예외**'))
    expect(at).toBeLessThan(WBS.indexOf('## 엑셀 export'))
  })
  it('acceptance 고정 네 줄과 기능 Task requirements 한 줄을 그대로 싣는다', () => {
    const sec = WBS.slice(WBS.indexOf('### 계약 Task 의 공유 파일 규칙'), WBS.indexOf('## 엑셀 export'))
    for (const l of FIXED) expect(sec).toContain(l)
    expect(sec).toContain('- 계약 Task design.md 「기능 Task 편집 지점」 의 자기 소유 파일만 고친다')
  })
  it('PRD 모드 관례가 그 절을 잇고, 출력 예의 계약 Task 에도 네 줄이 있다', () => {
    expect(WBS).toContain('- 공유 파일 규칙(C1~C7)과 acceptance 고정 네 줄은 아래 「계약 Task 의 공유 파일 규칙」 절을 따른다')
    const example = WBS.slice(WBS.indexOf('### TSK-01-02: users 스키마 + User 타입 정의 (계약 전용)'))
    for (const l of FIXED) expect(example).toContain('  ' + l)
  })
  it('의존 그래프 검증(자기 리뷰 게이트)에 계약 acceptance 네 줄 확인이 있다', () => {
    expect(WBS).toContain('계약 Task(`tags: contract`)마다 acceptance 에 「계약 Task 의 공유 파일 규칙」 의 고정 네 줄이 있는지')
  })
})
