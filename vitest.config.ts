import { defineConfig } from 'vitest/config'
import path from 'node:path'

export default defineConfig({
  test: { environment: 'node', include: ['tests/**/*.test.{ts,tsx}'] },
  // Next.js tsconfig은 jsx: preserve — vitest(oxc)에서는 JSX를 직접 변환해야 함.
  oxc: { jsx: { runtime: 'automatic' } },
  resolve: { alias: { '@': path.resolve(__dirname, 'src') } },
})
