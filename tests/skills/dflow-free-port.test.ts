// tests/skills/dflow-free-port.test.ts
// free-port.sh — E2E 서버용 빈 포트를 OS 에서 받는 도우미(dmes-standard 성능 감사 P8)와 e2e.md 운영 지침.
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { spawnSync } from 'node:child_process'
import { chmodSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const ROOT = process.cwd()
const FP = join(ROOT, '.claude/skills/dflow-dev/scripts/free-port.sh')
const E2E = readFileSync(join(ROOT, '.claude/skills/dflow-dev/references/e2e.md'), 'utf8')

let tmp: string
beforeEach(() => { tmp = realpathSync(mkdtempSync(join(tmpdir(), 'dflow-free-port-'))) })
afterEach(() => { rmSync(tmp, { recursive: true, force: true }) })

const fake = (name: string, body: string) => {
  writeFileSync(join(tmp, name), `#!/bin/sh\n${body}\n`)
  chmodSync(join(tmp, name), 0o755)
}
/** 가짜 도구만 보이는 PATH(시스템 lsof 는 /usr/sbin 이라 빠진다) */
const run = (path = process.env.PATH!) => {
  const r = spawnSync('bash', [FP], { encoding: 'utf8', env: { ...process.env, PATH: path }, timeout: 30000 })
  return { code: r.status, stdout: r.stdout || '', stderr: r.stderr || '' }
}
const bindable = (port: number) => new Promise<boolean>((res) => {
  const s = createServer()
  s.once('error', () => res(false))
  s.listen(port, () => s.close(() => res(true)))
})

describe('free-port.sh', { timeout: 30000 }, () => {
  it('실행 비트가 있고, 번호 한 줄만 내며 그 포트에 곧바로 bind 할 수 있다', async () => {
    expect(statSync(FP).mode & 0o111).not.toBe(0)
    const r = run()
    expect(r.code, r.stderr).toBe(0)
    expect(r.stdout).toMatch(/^\d+\n$/)
    const p = Number(r.stdout.trim())
    expect(p).toBeGreaterThanOrEqual(1024)
    expect(p).toBeLessThanOrEqual(65535)
    expect(await bindable(p)).toBe(true)
  })

  it('python 이 가짜(스토어 안내 문구)면 폴백으로 lsof 확인을 거친 번호를 낸다', () => {
    fake('python3', 'echo "Python was not found; run without arguments to install from the Microsoft Store"; exit 9009')
    fake('python', 'exit 1')
    fake('lsof', `echo "$*" >> '${tmp}/lsof.log'; exit 1`) // 아무것도 리슨하지 않음
    const r = run(`${tmp}:/usr/bin:/bin`)
    expect(r.code, r.stderr).toBe(0)
    const p = Number(r.stdout.trim())
    expect(p).toBeGreaterThanOrEqual(20000)
    expect(p).toBeLessThan(60000)
    expect(readFileSync(join(tmp, 'lsof.log'), 'utf8')).toContain(`-iTCP:${p} -sTCP:LISTEN`)
  })

  it('폴백에서 고른 포트가 모두 쓰이고 있으면 FREE_PORT_FAIL·exit 1', () => {
    fake('python3', 'exit 1')
    fake('python', 'exit 1')
    fake('lsof', 'exit 0') // 늘 리슨 중
    const r = run(`${tmp}:/usr/bin:/bin`)
    expect(r.code).toBe(1)
    expect(r.stdout).toBe('')
    expect(r.stderr).toContain('FREE_PORT_FAIL')
  })
})

describe('e2e.md 운영 지침(P8)', () => {
  const proc = E2E.slice(E2E.indexOf('## 서버 프로세스'), E2E.indexOf('## E2E 서버 슬롯')).replace(/\s*\n\s*/g, ' ')
  it('빈 포트는 free-port.sh 로 받고, bind 실패면 새로 받는다', () => {
    expect(proc).toContain('`.claude/skills/dflow-dev/scripts/free-port.sh`')
    expect(proc).toContain('PORT=$(.claude/skills/dflow-dev/scripts/free-port.sh)')
    expect(proc).toContain('다시 받아')
    expect(proc).not.toContain('빈 포트를 직접 골라')
  })
  it('라이브러리 빌드는 프런트 dev 서버 기동 전에 끝내고, 기동 뒤 다시 빌드했으면 dev 서버도 다시 띄운다', () => {
    expect(proc).toContain('프런트 dev 서버')
    expect(proc).toContain('기동 **전에** 끝낸다')
    expect(proc).toContain('dev 서버도 다시 띄운다')
  })
  it('DB 초기화는 서버 재기동이 아니라 픽스처 재투입을 권한다', () => {
    expect(proc).toContain('픽스처')
    expect(proc).toContain('서버를 다시 띄우지 않고')
  })
  it('특정 프로젝트 이름을 쓰지 않는다', () => {
    expect(E2E).not.toMatch(/dmes-standard|@dk-oasis|m-mdm|m-mcm/)
  })
})
