// wiki-rebuild.runner.ts 전용 vitest 설정. 기본 include(tests/**)와 분리해
// `npm test`가 이 운영 러너를 절대 집어가지 않게 한다.
import { defineConfig } from 'vitest/config'
import path from 'node:path'

const root = path.resolve(__dirname, '..')

export default defineConfig({
  root,
  test: {
    environment: 'node',
    include: ['scripts/wiki-rebuild.runner.ts'],
    testTimeout: 3_600_000,
    hookTimeout: 600_000,
    // LLM 왕복이 길어 기본 격리/병렬화가 필요 없다.
    fileParallelism: false,
  },
  resolve: {
    alias: {
      '@': path.resolve(root, 'src'),
      'server-only': path.resolve(root, 'node_modules/server-only/empty.js'),
    },
  },
})
