#!/bin/bash
# Vercel ignoreCommand — 낭비 빌드 차단(2026-08-21, Hobby 배포 한도 대응).
#
# 이 리포는 Vercel 프로젝트 둘(wbs-web=운영, dflow-staging=스테이징)에 연결돼 있어
# push 한 번에 빌드가 두 개 돌았다. 실제로 쓰는 조합만 남긴다:
#   - 각 프로젝트의 Production 빌드(wbs-web←main, dflow-staging←staging): 항상 수행
#   - dflow-staging 프로젝트의 Preview 빌드: 전부 스킵(용도 없음)
#   - wbs-web 프로젝트의 staging 브랜치 Preview: 스킵(스테이징 확인은 dflow-staging 몫)
#   - wbs-web 프로젝트의 피처 브랜치 Preview: 유지(G2 Preview 워크플로)
#
# exit 0 = 빌드 스킵, exit 1 = 빌드 진행 (Vercel ignoreCommand 계약).
# VERCEL_PROJECT_PRODUCTION_URL 이 ignore 단계에 없으면 case 가 안 걸려 dflow-staging
# 의 피처 Preview 만 남는 안전한 퇴화 — 빌드가 필요한 경우를 잘못 스킵하지는 않는다.

if [ "$VERCEL_ENV" = "production" ]; then
  exit 1
fi

case "$VERCEL_PROJECT_PRODUCTION_URL" in
  dflow-staging*) exit 0 ;;
esac

if [ "$VERCEL_GIT_COMMIT_REF" = "staging" ]; then
  exit 0
fi

exit 1
