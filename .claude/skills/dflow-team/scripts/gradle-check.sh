#!/bin/sh
# gradle-check.sh <리포 경로> — Gradle 빌드 루트를 찾아 gradle.properties 의 권장 키 상태를 보고한다.
# 하는 일: 탐색과 판정만. 파일을 고치지 않는다 — install.sh 와 /dflow-team 전제 검사가 이 출력을 보고 각자 판단한다
# (install.sh 는 새로 만들거나 안내하고, 전제 검사는 WARN 만 낸다. 로직을 두 곳에 중복시키지 않으려고 이 스크립트로 뺐다).
#
# 출력(한 줄씩, 해당 없으면 아무것도 내지 않고 exit 0):
#   ROOT <경로>                — gradlew 또는 settings.gradle(.kts) 가 있는 빌드 루트
#   NOFILE <경로>               — 그 루트에 gradle.properties 가 없음
#   MISSING <경로> <키,키,...>   — gradle.properties 는 있지만 권장 키 일부가 빠짐
#   OK <경로>                   — 권장 키 3개가 모두 있음
#
# 권장 키(근거는 dflow-kit README 「Gradle 권장 설정」):
#   org.gradle.caching=true · org.gradle.workers.max=3 · org.gradle.daemon.idletimeout=600000
set -eu

REPO="${1:-.}"
[ -d "$REPO" ] || exit 0
REPO=$(cd "$REPO" && pwd)

KEYS="org.gradle.caching org.gradle.workers.max org.gradle.daemon.idletimeout"

# 깊이 4 로 제한하고 node_modules·.git·build·.gradle·.claude 밑은 내려가지 않는다.
roots=$(find "$REPO" -maxdepth 4 \
    \( -name node_modules -o -name .git -o -name build -o -name .gradle -o -name .claude \) -prune -o \
    \( -name gradlew -o -name settings.gradle -o -name settings.gradle.kts \) -print 2>/dev/null \
  | while IFS= read -r f; do dirname "$f"; done | sort -u)

[ -n "$roots" ] || exit 0

printf '%s\n' "$roots" | while IFS= read -r root; do
  [ -n "$root" ] || continue
  # 리포 루트 자신이 아닌데 .git(디렉터리든, 워크트리의 gitdir 포인터 파일이든) 이 있으면 다른 체크아웃이다
  # (예: /dflow-team 팀원 워크트리 <리포>/dflow-<id8>/). 그 안의 gradle.properties 는 건드리지 않는다.
  if [ "$root" != "$REPO" ] && [ -e "$root/.git" ]; then continue; fi
  echo "ROOT $root"
  props="$root/gradle.properties"
  if [ ! -f "$props" ]; then
    echo "NOFILE $root"
    continue
  fi
  missing=""
  for k in $KEYS; do
    grep -Eq "^[[:space:]]*${k}[[:space:]]*=" "$props" || missing="$missing,$k"
  done
  if [ -n "$missing" ]; then
    echo "MISSING $root ${missing#,}"
  else
    echo "OK $root"
  fi
done
