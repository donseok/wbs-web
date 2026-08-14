// split-weekly-ops.runner.ts 전용 vitest 설정. 기본 include(tests/**)와 분리해
// `npm test`가 이 운영 러너를 절대 집어가지 않게 한다(backfill-0076.vitest.ts 전례).
import { defineConfig } from 'vitest/config'
import path from 'node:path'

const root = path.resolve(__dirname, '..')

export default defineConfig({
  root,
  test: {
    environment: 'node',
    include: ['scripts/split-weekly-ops.runner.ts'],
    testTimeout: 120_000,
    hookTimeout: 120_000,
  },
  resolve: {
    alias: {
      '@': path.resolve(root, 'src'),
      'server-only': path.resolve(root, 'node_modules/server-only/empty.js'),
    },
  },
})
