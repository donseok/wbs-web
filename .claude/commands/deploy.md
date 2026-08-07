---
description: 변경사항 커밋 → 원격 푸시 → Vercel 배포 상태 확인까지 한 번에 실행
argument-hint: "[커밋 메시지 힌트 (생략 가능)]"
allowed-tools: Bash(git status:*), Bash(git diff:*), Bash(git log:*), Bash(git add:*), Bash(git commit:*), Bash(git push:*), Bash(vercel ls:*), Bash(vercel inspect:*), Bash(npm run lint:*), Bash(npm test:*), Bash(npm run build:*), Bash(npm run smoke:prod:*), Bash(npm run mark:good:*)
---

## 목적
현재 작업 트리의 변경사항을 커밋하고 `main`에 푸시한 뒤, Vercel 배포가 정상적으로 트리거되어 완료되는지 확인한다.

인자(선택): `$ARGUMENTS` — 커밋 메시지에 반영할 힌트. 없으면 diff를 보고 알아서 판단.

## 절차

1. **변경사항 확인**: `git status` / `git diff` (staged+unstaged)로 무엇이 바뀌었는지 파악. 변경사항이 전혀 없으면 여기서 멈추고 사용자에게 알린다.
2. **배포 전 검증**: `npm run lint`, `npm test`, `npm run build`를 순서대로 실행한다. 하나라도 실패하면 커밋·푸시하지 않고 실패 원인을 보고한다.
3. **커밋**: 관련 파일만 개별적으로 stage (`git add -A` 금지 — `.env` 등 민감 파일 실수 포함 방지. 이 저장소는 병렬 세션이 돌기도 해서, 무관한 dirty 파일이 섞여 들어가지 않게 파일명을 명시할 것). 커밋 메시지는 한국어로 간결하게, "무엇"보다 "왜"에 집중. `Co-Authored-By:` 트레일러는 **실제로 작업한 모델 이름**으로 넣는다(하네스 기본 트레일러를 그대로 사용). 특정 모델명을 여기에 하드코딩하지 않는다 — 세션마다 달라진다.
4. **푸시**: `git push origin main`.
   - **주의**: 이 저장소는 Vercel과 GitHub 연동이 되어 있어 `git push`만으로 prod 배포가 자동 트리거된다. **`vercel --prod`를 별도로 실행하지 않는다** — 같은 커밋이 두 번 빌드되고 별칭(alias)이 CLI 배포로 덮어써지는 낭비가 생긴다 ([[dflow-infra]] 메모리 참고).
5. **배포 확인**: `vercel ls wbs-web 2>&1`로 방금 트리거된 최상단 배포 URL을 확인한다.
   - **주의**: `vercel ls`와 `vercel inspect` 모두 사람이 읽는 출력(상태 표, `status` 필드)을 **stderr**로 내보낸다. stdout에는 URL만 남는다. 따라서 `2>/dev/null`로 걸러 파이프하면 `Building`/`Ready` 판정이 항상 빈 문자열이 되어 폴링 루프가 즉시 빠져나간다. **파이프할 때는 반드시 `2>&1`을 붙일 것.**
   - 상태 폴링은 `vercel inspect <deployment-url>`로 한다(`vercel ls`는 표 파싱이 줄 위치에 의존해 깨지기 쉽다). 검증된 방식:
     ```bash
     DEP="<deployment-url>"
     for i in $(seq 1 40); do
       ST=$(vercel inspect "$DEP" 2>&1 | grep -E "^\s+status" | awk '{print $NF}')
       echo "[$i] status=$ST"
       case "$ST" in Ready|Error|Canceled) break ;; esac
       sleep 10
     done
     ```
     (foreground `sleep`이 막혀 있으므로 이 루프는 `run_in_background`로 돌린다. 빌드는 보통 1분 안팎.)
   - `Error`면 `vercel inspect <deployment-url> --logs`로 원인을 확인해 사용자에게 보고한다.
6. **별칭 확인**: `Ready`면 `vercel inspect <deployment-url> 2>&1 | grep -A6 Aliases`로 프로덕션 별칭(`wbs-web.vercel.app`)이 이 배포를 가리키는지 확인한다.
7. **스모크 (2층 관문)**: `npm run smoke:prod`.
   - 배포된 CSS 가 잘려서 도착하지 않았는지(전송 완결성·중괄호 균형), 레이아웃 급소 규칙(`.hidden`/`.lg\:flex`/`.sm\:flex`)이 배포본에 실제로 있는지 검사한다. `next build`가 통과해도 이 계층은 별개다 — 2026-07-27 사이드바 실종 회귀는 build·lint·tsc·vitest 2438건을 전부 통과했다.
   - **실패(exit 1)면 배포를 성공으로 보고하지 않는다.** 즉시 `docs/runbook-rollback.md`의 롤백 절차를 사용자에게 안내한다.
8. **known-good 태그**: 스모크가 통과했고 **사용자가 화면을 눈으로 확인**했으면 `npm run mark:good`.
   - 사용자 확인 없이 임의로 태그하지 않는다. 이 태그는 다음 사고 때 되돌아갈 좌표라, 확인되지 않은 시점을 찍으면 의미가 없어진다. 큰 작업이 끝난 배포에서만 제안한다.
9. **결과 보고**: 커밋 해시, 푸시된 브랜치, 최종 배포 URL과 상태(Ready/Error), 프로덕션 별칭, 스모크 결과를 간단히 요약해서 알려준다.

## push 가드 (1층 관문)

`.githooks/pre-push`가 세 가지를 막는다 — 걸리면 우회하지 말고 원인을 해소한다.

| | 차단 조건 | 해소 |
|---|---|---|
| G1 | 마이그레이션과 `src/` 코드가 같은 커밋 (머지·revert 커밋은 제외) | `git rebase -i`로 분리 |
| G2 | UI 위험 파일(`globals.css`·`layout.tsx`·`components/app/*`)이 **원격 어디에도 올라간 적 없이** main 직행 | 브랜치로 push해 Preview 확인 후 머지(ff 가능), 또는 `Preview-checked:` 트레일러 |
| G3 | 반응형 안전망 desync·충돌 | `npx vitest run tests/css/breakpoint-safety-net.test.ts` |

검사 대상은 이번 push로 원격에 처음 올라가는 커밋뿐이다(`--not --remotes`). 범위 계산이 실패하면 fail-closed로 막으므로, 그때는 `git fetch origin` 후 재시도한다.

긴급 시 `SKIP_GUARD=1 git push`로 우회할 수 있으나, **우회했으면 배포 후 스모크(6번)는 반드시 돌린다.**
