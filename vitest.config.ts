import { defineConfig } from 'vitest/config'
import path from 'node:path'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.{ts,tsx}'],
    // CSS 모듈 import(seatmap.module.css)가 프로젝트 postcss.config.mjs(문자열 플러그인 표기,
    // Next 전용 로더가 해석)를 vite 가 그대로 돌리려다 죽는다. jsdom 테스트는 실제 스타일 계산이
    // 필요 없으므로 CSS 처리를 끄고 클래스명 그대로 돌려주는 기본 프록시를 쓴다.
    css: false,
    // Node 26 은 globalThis.localStorage 를 getter 로 미리 깔아두는데 --localstorage-file
    // 없이는 undefined 를 돌려준다. jsdom 환경은 전역에 이미 있는 키를 건너뛰므로 진짜
    // Storage 가 실리지 못하고 jsdom UI 테스트가 전부 TypeError 로 죽는다. 워커에서 웹스토리지
    // 자체를 꺼서 그 자리를 비워둔다. package.json 이 아니라 여기 두는 이유는 npx vitest
    // 직접 실행에도 먹히기 때문.
    execArgv: ['--no-experimental-webstorage'],
  },
  // Next.js tsconfig은 jsx: preserve — vitest(oxc)에서는 JSX를 직접 변환해야 함.
  oxc: { jsx: { runtime: 'automatic' } },
  // postcss.config.mjs 는 문자열 플러그인 표기(Next 전용 로더가 해석)라 vite 가 파일을 그대로
  // 읽어 postcss() 에 넘기면 죽는다. 빈 인라인 설정으로 그 탐색 자체를 건너뛴다 — CSS 모듈은
  // 어차피 test.css:false 프록시로 클래스명만 돌려주므로 실제 처리가 필요 없다.
  css: { postcss: {} },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
      // 'server-only' 는 react-server 조건에서만 no-op 이고 그 외에는 throw 한다.
      // vitest(node)에는 그 조건이 없으므로 Next 가 쓰는 empty.js 로 직접 연결한다.
      'server-only': path.resolve(__dirname, 'node_modules/server-only/empty.js'),
    },
  },
})
