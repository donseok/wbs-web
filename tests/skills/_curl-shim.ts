// tests/skills/_curl-shim.ts — dflow.mjs 를 가짜 curl 로 돌리는 시험이 env 에 얹는 NODE_OPTIONS (shim 설명은 _curl-fetch-shim.mjs).
import { join } from 'node:path'

export const CURL_SHIM_OPTS = `--import ${join(process.cwd(), 'tests/skills/_curl-fetch-shim.mjs')}`
