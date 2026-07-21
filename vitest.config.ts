import { defineConfig } from 'vitest/config'
import path from 'node:path'

export default defineConfig({
  test: { environment: 'node', include: ['tests/**/*.test.{ts,tsx}'] },
  // Next.js tsconfig은 jsx: preserve — vitest(oxc)에서는 JSX를 직접 변환해야 함.
  oxc: { jsx: { runtime: 'automatic' } },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
      // 'server-only' 는 react-server 조건에서만 no-op 이고 그 외에는 throw 한다.
      // vitest(node)에는 그 조건이 없으므로 Next 가 쓰는 empty.js 로 직접 연결한다.
      'server-only': path.resolve(__dirname, 'node_modules/server-only/empty.js'),
    },
  },
})
