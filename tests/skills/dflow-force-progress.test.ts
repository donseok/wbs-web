// 강제 진행 스킬 계약(스펙 2026-09-23 §3.3·§3.4·§4) — waived 간선은 로컬 도달 검사·행 G 에서 따로 다루고, 승격 관문은 stub-check.
import { describe, expect, it } from 'vitest'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const ROOT = process.cwd()
const DFLOW = join(ROOT, '.claude/skills/dflow-work/scripts/dflow.sh')
const sh = readFileSync(DFLOW, 'utf8')
const dev = readFileSync(join(ROOT, '.claude/skills/dflow-dev/SKILL.md'), 'utf8')
const merge = readFileSync(join(ROOT, '.claude/skills/dflow-merge/SKILL.md'), 'utf8')
const contract = readFileSync(join(ROOT, '.claude/skills/dflow-work/references/api-contract.md'), 'utf8')

function repo(files: Record<string, string>): string {
  const d = mkdtempSync(join(tmpdir(), 'fp-'))
  const g = (...a: string[]) => execFileSync('git', a, { cwd: d })
  g('init', '-q', '-b', 'main'); g('config', 'user.email', 't@t'); g('config', 'user.name', 't')
  for (const [p, c] of Object.entries(files)) writeFileSync(join(d, p), c)
  g('add', '.'); g('commit', '-qm', 'init')
  return d
}

describe('check_depends_local — waived 간선은 로컬 도달 검사에서 뺀다', () => {
  it('jq 필터가 waived 를 거른다', () => {
    expect(sh).toContain('.[] | select(.head_sha != null and .waived != true)')
  })
})

// 표식 문자열을 조립한다 — 이 테스트 파일 자체가 리포의 stub-check 에 걸리지 않게.
const MARK = 'FORCE-' + 'STUB: '

describe('dflow.sh stub-check', () => {
  it('FORCE-STUB 표식이 있으면 exit 4 와 건수', () => {
    const d = repo({ 'a.ts': `// ${MARK}TSK-03-01\nexport const x = 1\n`, 'b.ts': 'ok\n' })
    const r = spawnSync('sh', [DFLOW, 'stub-check', 'HEAD'], { cwd: d, encoding: 'utf8' })
    expect(r.status).toBe(4)
    expect(r.stdout).toContain('FORCE_STUB_FOUND 1')
    expect(r.stdout).toContain('a.ts:1:')
  })
  it('스킬·문서(.claude/·docs/·*.md)의 규칙 설명과 ID 없는 문구는 세지 않는다 — 코드의 진짜 표식만', () => {
    const d = repo({ 'README.md': `${MARK}TSK-01 예시\n`, 'guide.ts': `// 표식 형식: ${MARK}<선행 TSK-ID>\n`, 'svc.ts': `// ${MARK}TSK-09\n` })
    execFileSync('mkdir', ['-p', join(d, '.claude/skills'), join(d, 'docs')])
    writeFileSync(join(d, '.claude/skills/SKILL.md'), `${MARK}TSK-02\n`)
    writeFileSync(join(d, 'docs/spec.txt'), `${MARK}TSK-03\n`)
    execFileSync('git', ['add', '.'], { cwd: d }); execFileSync('git', ['commit', '-qm', 'docs'], { cwd: d })
    const r = spawnSync('sh', [DFLOW, 'stub-check', 'HEAD'], { cwd: d, encoding: 'utf8' })
    expect(r.status).toBe(4)
    expect(r.stdout).toContain('FORCE_STUB_FOUND 1')
    expect(r.stdout).toContain('svc.ts:1:')
  })
  it('이 리포(스킬·문서·테스트가 표식 문구를 담고 있다)에서도 0건으로 통과한다 — .dflow.local 이 없어도', () => {
    const r = spawnSync('sh', [DFLOW, 'stub-check', 'HEAD'], { cwd: ROOT, encoding: 'utf8', env: { ...process.env, HOME: tmpdir() } })
    expect(r.stdout).toContain('FORCE_STUB_NONE')
    expect(r.status).toBe(0)
  })
  it('없으면 exit 0', () => {
    const d = repo({ 'a.ts': 'clean\n' })
    const r = spawnSync('sh', [DFLOW, 'stub-check', 'HEAD'], { cwd: d, encoding: 'utf8' })
    expect(r.status).toBe(0)
    expect(r.stdout).toContain('FORCE_STUB_NONE')
  })
})

describe('/dflow-dev — waived 갈래', () => {
  it('선행 검사에 waived 갈래가 있고 기본 브랜치 반영 확인을 하지 않는다', () => {
    expect(dev).toContain("`d.waived === true` 면 **강제 진행 간선**이다")
    expect(dev).toContain('강제 진행: <선행> 은 스텁으로 대신한다')
    expect(dev).toContain('기점은 항상 `origin/<기본브랜치>`')
  })
  it('스텁 규칙(후행 소유 경로·표식·완료 보고 절)을 적는다', () => {
    expect(dev).toContain('FORCE-STUB: <선행 TSK-ID>')
    expect(dev).toContain('src/__stubs__/<선행 TSK-ID>/')
    expect(dev).toContain('「강제 진행 스텁」 절')
  })
})

describe('/dflow-merge — 개발 브랜치 = 운영 브랜치면 스텁 머지 거부', () => {
  it('stub-check 로 막는다', () => {
    expect(merge).toContain('dflow.sh stub-check <머지 대상>')
    expect(merge).toContain('개발 브랜치와 운영 브랜치가 같으면')
  })
})

describe('계약 문서 v2.8(변경점 절 유지, 버전은 2.9)', () => {
  it('waived 필드와 reached 관계를 적는다', () => {
    expect(contract).toContain('## v2.8 변경점')
    expect(contract).toContain('`depends_evidence[].waived`')
    expect(sh).toMatch(/^CONTRACT_VERSION=2\.9$/m)
  })
})
