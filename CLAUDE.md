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

  ⚠️ **Preview 의 한계를 알고 쓸 것** — 이 프로젝트의 Vercel env 는 **전부 Production 대상이고
  Preview 대상은 0건**이다(2026-07-28 `vercel env ls` 실측). 즉 Preview 배포는 Supabase 에
  접근하지 못해 **로그인 뒤 화면을 볼 수 없다.** `globals.css` 변경은 로그인 페이지가 CSS 전량을
  로드하므로 확인이 되지만, `src/components/app/*` 변경은 Preview 로 검증할 수 없다.
  **G2 는 무심코 직행하는 것을 막는 속도 방지턱이지, 화면이 멀쩡하다는 보증이 아니다.**
  (뒤집어 말하면 Preview 에서 운영 데이터가 훼손될 위험도 없다.)
  Preview 가 필요 없는 변경이라면 근거를 커밋에 남긴다:
  `git commit --amend --trailer "Preview-checked: n/a — 주석만 수정"`
- **`git push --force origin main` 금지.** 병렬 세션의 커밋이 소리 없이 사라진다.

### 스테이징 (2026-08-11 이후 표준)

상시 스테이징: `staging` 브랜치 → dflow-staging.vercel.app (스테이징 Supabase, 운영과 격리).
운영 절차·좌표는 `docs/runbook-staging.md`.

- **새 화면·신규 기능은 스테이징 URL에서 확인 후 main 머지** (관례 — 훅 강제는 아래 둘뿐).
- **마이그레이션은 스테이징 리허설 필수** — `staging:sync` → `db:apply --target staging` → 검증 →
  커밋 트레일러 `Staging-verified:` → staging push → `db:apply --target prod` → main push. G4 훅이 막는다. — 상세는 docs/runbook-staging.md
- staging push 전 `origin/main` back-merge(각 세션 책임). staging→main 머지 커밋은 정상. force push 금지.
- staging 에는 main 에 갈 커밋만 올린다. 실험은 별도 브랜치 + Preview(이제 Preview 도 로그인 된다).
- 소액 변경(오타·주석·문서)은 종전대로 main 직행 허용.

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
| G4 | 0072+ 마이그레이션의 main 직행 차단(스테이징 리허설 트레일러) | 범위 내 빈 커밋 트레일러로도 인정 |

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

- **운영 D-CUBE 데이터를 훼손하지 않는다.** 로컬 dev 기본값은 **스테이징 DB**다
  (`npm run env:staging`/`env:prod` 로 전환 — 파일 교체라 이 PC 의 모든 병렬 세션에 즉시 영향,
  운영 전환 후엔 복귀가 예절이고 predev 가드가 잊음을 잡는다). 운영을 향한 `npm run dev` 는
  `FORCE_PROD_DEV=1` 없이는 차단된다. 쓰기 검증은 스테이징에서.
- 마이그레이션은 **스테이징 리허설 후** Supabase Management API 로 적용(`npm run db:apply`).
  `supabase db push` 는 쓰지 않는다. — 상세는 docs/runbook-staging.md
- 새 마이그레이션에는 `_rollback.sql` 을 함께 만든다.

### Supabase 계정 (2026-08-05 실측)

프로젝트 `rglfgrwwwwdqejohdnty` (ap-northeast-2, Postgres 17). **조직이 `DOC` 로 옮겨졌고 요금제는 Pro 다.**
**ref·URL·anon/service_role 키는 이동 후에도 그대로다** — 옮긴 것은 소유 조직뿐이라 env 는 손댈 게 없다.
(과거 문서·플랜에 박힌 ref 도 여전히 유효하다. 바뀐 줄 알고 고치지 말 것.)

Pro 로 바뀐 것과 **바뀌지 않은 것**을 구분할 것:

| | 상태 |
|---|---|
| 일 백업 | **생김**(무료엔 없었다). PITR 은 **꺼짐** — Pro 위에 얹는 별도 유료 애드온 |
| 컴퓨트 | **Micro 그대로** — 2 vCPU(공유)·1GB·직접연결 60·풀러 200 |
| 자동 일시정지 | 없어짐(무료의 미사용 정지 규칙은 더는 해당 없음) |
| DB 네트워크·SSL | 전면 개방(`0.0.0.0/0`)·SSL 강제 꺼짐. Pro 에선 잠글 수 있다 |

⚠️ **Pro 전환이 2026-08-05 PostgREST 풀 고갈을 막아주지 않는다** — 그 장애가 난 사양이
바로 이 Micro 다. 커넥션·풀 여유가 필요하면 컴퓨트 애드온을 따로 올려야 한다.

## 권한

3단이다 — **슈퍼유저**(전역) · **관리자**(지정된 프로젝트) · **멤버**(지정된 프로젝트).
프로젝트 역할이 없으면 조회 전용이다.

- 판정은 `src/lib/domain/authz.ts`(순수) + `src/lib/authz/index.ts`(가드) 두 곳에서만 한다.
  액션에 `role === '...'` 을 직접 적지 않는다.
- 가드는 셋뿐이다: `requireSuperuser()` · `requireProjectAdmin(pid)` · `requireProjectMember(pid)`.
  `projectId` 를 인자로 받지 않는 액션은 `resolveProjectId(table, id)` 로 먼저 읽는다.
- `memberships.role` 은 **deprecated** 다(0054). 읽지 말 것. 전역 등급은 `is_superuser`,
  프로젝트 역할은 `project_roles` 다. 옛 문자열 계약이 남은 화면은 `effectiveLegacyRole` shim 만 쓴다.
- **회의록·위키·AI 브리핑은 RLS 쓰기 정책이 없다.** service_role 로 쓰기 때문에
  RLS 2차 방어선이 없고 서버 액션 가드가 유일한 관문이다. 이 계열을 손댈 때 특히 주의할 것.
- 사용 현황(`/usage`)은 슈퍼유저 전용 — `canViewUsage()` 와 0053 `read_usage_events` 가 쌍이다.
- 설계 정본: `docs/superpowers/specs/2026-07-29-authz-three-tier-design.md`

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
