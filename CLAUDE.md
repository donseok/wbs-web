# wbs-web — 작업 규칙

D'Flow. Next.js 15 (App Router) + Tailwind v4 + Supabase. 프로덕션은 `origin/main` 이며 push 하면 Vercel 이 자동 배포한다.

---

## git 운영

**이 리포는 여러 PC·여러 세션이 동시에 쓴다.** 아래는 그 전제에서 나온 규칙이다.

### 커밋

- **`git add -A` 금지.** 항상 파일명을 명시해 stage 한다. 병렬 세션의 dirty 파일과 `.env` 가 섞여 들어간다.
- **마이그레이션과 코드를 같은 커밋에 담지 않는다.** `supabase/migrations/*` 는 별도 커밋으로.
  섞으면 `git revert` 가 코드만 되돌리고 DB 는 남아 롤백이 반쪽이 된다. pre-push 훅(G1)이 막는다.
- 커밋 메시지는 한국어. "무엇"보다 "왜".

### 브랜치

- 일반 작업은 `main` 직행으로 해도 된다.
- **UI 위험 파일을 건드리면 브랜치를 쓴다** — `src/app/globals.css`, `src/app/layout.tsx`,
  `src/app/(app)/layout.tsx`, `src/components/app/*`.
  이 파일들은 전 화면에 영향을 주는데 **빌드·린트·타입체크·테스트로 깨짐이 잡히지 않는다**
  (2026-07-27 사고 때 vitest 2438건이 전부 통과했다). Vercel Preview 에서 눈으로 봐야 한다.
  ```bash
  git switch -c ui/<주제>
  git push -u origin HEAD      # Preview URL 에서 화면 확인
  git switch main && git merge ui/<주제> && git push   # ff 머지도 괜찮다
  ```
  pre-push 훅(G2)은 **"원격 어디에도 올라간 적 없는 UI 커밋"** 이 main 으로 가는 것만 막는다.
  브랜치로 한 번이라도 push 했다면 Preview 를 받은 것이므로 ff 머지든 `--no-ff` 든 통과한다.
  Preview 가 필요 없는 변경이라면 근거를 커밋에 남긴다:
  `git commit --amend --trailer "Preview-checked: n/a — 주석만 수정"`
- **`git push --force origin main` 금지.** 병렬 세션의 커밋이 소리 없이 사라진다.

### 배포와 검증

```bash
git push origin main     # Vercel 자동 배포. vercel --prod 를 따로 실행하지 않는다.
npm run smoke:prod       # 배포 완료 후. CSS 전달 무결성 + 레이아웃 급소 규칙 검사
npm run mark:good        # 화면까지 확인됐으면 known-good 태그를 남긴다
```

`mark:good` 태그가 **다음 사고 때 되돌아갈 유일한 좌표**다. 큰 작업을 마쳤으면 남길 것.
깨졌을 때는 `docs/runbook-rollback.md`.

### pre-push 훅

`.githooks/pre-push` — `npm install` 이 `core.hooksPath` 를 걸어 자동 설치된다(리포에 커밋되므로 모든 PC 에 따라감). 검사는 셋:

| | 내용 | 예외 |
|---|---|---|
| G1 | 마이그레이션+코드 혼합 커밋 차단 | 머지·revert 커밋은 제외 |
| G2 | Preview 를 거치지 않은 UI 변경의 main 직행 차단 | `Preview-checked:` 트레일러 |
| G3 | 반응형 안전망 desync·충돌 검사 | vitest 없으면 건너뛰고 그 사실을 알림 |

검사 대상은 **이번 push 로 원격에 처음 올라가는 커밋**(`--not --remotes`)뿐이다. 브랜치에 `origin/main` 을 머지해도 남의 커밋이 검사에 끌려들어오지 않는다.

빌드/테스트는 여기서 돌리지 않는다 — 이미 초록인 검사를 반복해 시간만 쓴다. 빌드는 Vercel 이 강제한다.
긴급 우회는 `SKIP_GUARD=1 git push`. 우회했으면 배포 후 `npm run smoke:prod` 를 반드시 돌린다.

---

## CSS — 반응형 안전망 주의

`src/app/globals.css` 끝에 `@layer` 밖(unlayered) 반응형 display 유틸이 있다(`15e0eef`).
2026-07-27 사고의 응급 대응이며 **근본원인은 미확정, 효과도 미검증**이다. 상세는 `docs/runbook-rollback.md` 부록.

unlayered 규칙은 특이성과 무관하게 모든 named layer 를 이긴다. 따라서:

- `group-hover:flex`, `data-[state=open]:hidden`, `print:hidden` 같은 **상태 변형 display 유틸을 쓰지 않는다.** 안전망에 져서 조용히 동작하지 않는다.
- 한 요소에 **컨테이너 쿼리 display 와 반응형 display 를 같이 쓰지 않는다** (`hidden @[15rem]:flex lg:flex`).
- `@theme` 에 `--breakpoint-*` 를 추가하면 **안전망의 하드코딩 값도 같이 고친다.**

셋 다 `tests/css/breakpoint-safety-net.test.ts` 가 검사한다.

---

## 데이터

- **운영 D-CUBE 데이터를 훼손하지 않는다.** 로컬 dev 도 프로덕션 Supabase 를 공유한다. 쓰기 검증은 전용 테스트 프로젝트에서.
- 마이그레이션 적용은 Supabase Management API 경유. `supabase db push` 는 쓰지 않는다.
- 새 마이그레이션에는 `_rollback.sql` 을 함께 만든다.

## 에러 처리 3원칙

- 조회 실패를 "데이터 없음"으로 위장하지 않는다 — 표시 = 로깅
- 쓰기 전 선행 조회가 실패하면 중단한다
- 보안 가드는 fail-closed. 모르면 `unknown`

---

## 자주 쓰는 명령

```bash
npm run dev
npm run build
npm run lint
npm run test
npm run smoke:prod       # 프로덕션 스모크
npm run mark:good        # known-good 태그
```
