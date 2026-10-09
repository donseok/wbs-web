// tests/skills/_curl-fetch-shim.mjs — dflow.mjs 의 fetch 를 PATH 의 가짜 curl 로 연결하는 시험 전용 preload.
// dflow.sh 는 curl 을 불렀고 시험은 가짜 curl 스크립트(-o 파일·-w 코드·-X·-H·--data·url)로 HTTP 를 흉내 냈다.
// dflow.mjs 는 fetch 를 쓰므로 같은 가짜 curl 계약을 그대로 살리려고 fetch 호출을 그 호출 꼴로 바꿔 실행한다.
// 사용: 스크립트를 띄우는 env 에 NODE_OPTIONS=`--import ${CURL_SHIM}` 을 넣는다(tests/skills/_curl-shim.ts).
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

globalThis.fetch = async (input, init = {}) => {
  const dir = mkdtempSync(join(tmpdir(), 'curl-shim-'))
  const out = join(dir, 'body')
  try {
    const args = ['-sS', '-o', out, '-w', '%{http_code}', '-X', String(init.method ?? 'GET')]
    const headers = init.headers ?? {}
    for (const [k, v] of Object.entries(headers)) args.push('-H', `${k}: ${v}`)
    if (init.body !== undefined && init.body !== null) args.push('--data', String(init.body))
    args.push(String(input))
    const r = spawnSync('curl', args, { encoding: 'utf8' })
    // 가짜 curl 이 0 이 아닌 값으로 끝나면 curl 의 네트워크 오류와 같다 — fetch 는 TypeError 를 던진다.
    if (r.status !== 0) throw new TypeError('fetch failed')
    let body = ''
    try { body = readFileSync(out, 'utf8') } catch { /* 본문 파일이 없으면 빈 본문 */ }
    return new Response(body, { status: Number(r.stdout.trim()) || 0 })
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}
