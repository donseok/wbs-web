// tests/skills/dflow-team-shell-blocks.test.ts
// 팀장 절차의 실행체는 .sh 파일이 아니라 스킬 문서의 ```bash 블록이다(스펙 §3-21: bash 와 zsh 양쪽에서 돈다).
// 펜스를 뽑아 <…> 플레이스홀더를 치환한 뒤 sh/bash/zsh 의 -n 으로 파싱하고, zsh 에서만 갈라지는 확장 형태를 금지한다.
import { describe, expect, it } from 'vitest'
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = process.cwd()
const DOCS = [
  '.claude/skills/dflow-team/SKILL.md',
  '.claude/skills/dflow-team/references/backends.md',
  '.claude/skills/dflow-team/references/events.md',
  '.claude/skills/dflow-team/references/restart.md',
  '.claude/skills/dflow-team/references/worker-prompt.md',
  '.claude/skills/dflow-team/references/resolve-prompt.md',
  '.claude/skills/dflow-team/references/merge-conflict.md',
  '.claude/skills/dflow-dev/SKILL.md',
  '.claude/skills/dflow-dev/references/worker-mode.md',
  '.claude/skills/dflow-merge/SKILL.md',
]

type Block = { file: string; line: number; code: string }

function blocks(rel: string): Block[] {
  const lines = readFileSync(join(ROOT, rel), 'utf8').split('\n')
  const out: Block[] = []
  let open: number | null = null
  let indent = ''
  const buf: string[] = []
  lines.forEach((raw, i) => {
    const m = raw.match(/^(\s*)```(bash|sh)\s*$/)
    if (open === null && m) { open = i + 1; indent = m[1]; buf.length = 0; return }
    if (open !== null && raw.trim() === '```') {
      out.push({ file: rel, line: open, code: buf.join('\n') + '\n' })
      open = null
      return
    }
    if (open !== null) buf.push(raw.startsWith(indent) ? raw.slice(indent.length) : raw.trimStart())
  })
  return out
}

// 문서의 <플레이스홀더> 는 셸 문법이 아니다. 플레이스홀더에는 코드 문자(= ; ( ) $ " ' & |)가 없으므로 그것으로 가려
// 리다이렉트(`< /dev/null`, `2>&1`)와 `i<=NF … 2>/dev/null` 같은 비교·리다이렉트 구간은 건드리지 않는다.
const substitute = (code: string) => code.replace(/<[^<>\n=;()$"'&|]+>/g, 'PH')

function parses(shell: string, code: string): { ok: boolean; err: string } {
  const r = spawnSync(shell, ['-n'], { input: code, encoding: 'utf8' })
  return { ok: r.status === 0, err: (r.stderr || '').trim() }
}

const hasZsh = spawnSync('zsh', ['-c', 'true']).status === 0
const all = DOCS.flatMap(blocks)

describe('스킬 문서의 셸 블록은 sh·bash·zsh 로 파싱된다(스펙 §3-21)', () => {
  it('블록을 충분히 찾았다(팀장 문서 4 + dflow-dev + dflow-merge)', () => {
    expect(all.length).toBeGreaterThanOrEqual(35)
    for (const rel of DOCS) expect(all.some((b) => b.file === rel), rel).toBe(true)
  })

  for (const shell of hasZsh ? ['sh', 'bash', 'zsh'] : ['sh', 'bash']) {
    it(`${shell} -n: 모든 블록이 통과한다`, () => {
      const bad = all
        .map((b) => ({ ...b, r: parses(shell, substitute(b.code)) }))
        .filter((b) => !b.r.ok)
        .map((b) => `${b.file}:${b.line} ${b.r.err.split('\n')[0]}`)
      expect(bad, bad.join('\n')).toEqual([])
    })
  }

  it('zsh 에서 한 단어로 붙는 `${V:+a "$V"}` 꼴 확장을 쓰지 않는다', () => {
    // zsh 는 인용 없는 매개변수 확장에 단어 분할을 하지 않아 대체값 안의 공백이 인자 경계가 되지 않는다.
    const bad = all.filter((b) => /\$\{[A-Za-z_][A-Za-z_0-9]*:[+-][^}]*\s[^}]*\}/.test(b.code)).map((b) => `${b.file}:${b.line}`)
    expect(bad, bad.join('\n')).toEqual([])
  })

  it('Windows(Git Bash) 에 없는 `hostname -s` 를 명령으로 쓰지 않는다(네 자리 모두)', () => {
    for (const rel of [
      '.claude/skills/dflow-team/SKILL.md',
      '.claude/skills/dflow-team/references/events.md',
      '.claude/skills/dflow-work/scripts/dflow.sh',
      'kit/hooks/heartbeat.sh',
    ]) {
      const t = readFileSync(join(ROOT, rel), 'utf8')
      expect(t, rel).not.toMatch(/\$\(hostname -s|hostname -s \|/)
      expect(t, rel).toMatch(/hostname( 2>\/dev\/null)? \| cut -d\. -f1/)
    }
  })
})
