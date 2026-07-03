---
description: 변경사항 커밋 → 원격 푸시 → Vercel 배포 상태 확인까지 한 번에 실행
argument-hint: "[커밋 메시지 힌트 (생략 가능)]"
allowed-tools: Bash(git status:*), Bash(git diff:*), Bash(git log:*), Bash(git add:*), Bash(git commit:*), Bash(git push:*), Bash(vercel ls:*), Bash(vercel inspect:*)
---

## 목적
현재 작업 트리의 변경사항을 커밋하고 `main`에 푸시한 뒤, Vercel 배포가 정상적으로 트리거되어 완료되는지 확인한다.

인자(선택): `$ARGUMENTS` — 커밋 메시지에 반영할 힌트. 없으면 diff를 보고 알아서 판단.

## 절차

1. **변경사항 확인**: `git status` / `git diff` (staged+unstaged)로 무엇이 바뀌었는지 파악. 변경사항이 전혀 없으면 여기서 멈추고 사용자에게 알린다.
2. **커밋**: 관련 파일만 개별적으로 stage (`git add -A` 금지 — `.env` 등 민감 파일 실수 포함 방지). 커밋 메시지는 한국어로 간결하게, "무엇"보다 "왜"에 집중. `Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>` 트레일러 포함.
3. **푸시**: `git push origin main`.
   - **주의**: 이 저장소는 Vercel과 GitHub 연동이 되어 있어 `git push`만으로 prod 배포가 자동 트리거된다. **`vercel --prod`를 별도로 실행하지 않는다** — 같은 커밋이 두 번 빌드되고 별칭(alias)이 CLI 배포로 덮어써지는 낭비가 생긴다 ([[dflow-infra]] 메모리 참고).
4. **배포 확인**: `vercel ls wbs-web` (또는 `vercel ls`)로 최신 배포를 확인한다. 방금 푸시한 커밋에 해당하는 배포가 `Building` 상태면 몇 초 간격으로 다시 확인해 `Ready`가 될 때까지 지켜본다. `Error` 상태면 `vercel inspect <deployment-url> --logs`로 원인을 확인해 사용자에게 보고한다.
5. **결과 보고**: 커밋 해시, 푸시된 브랜치, 최종 배포 URL과 상태(Ready/Error)를 간단히 요약해서 알려준다.
