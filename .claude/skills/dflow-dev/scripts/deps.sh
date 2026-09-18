#!/usr/bin/env bash
# /dflow-dev --worker 행 H: 팀원 워크트리의 의존성을 설치한다. cwd = 워크트리 루트.
# npm(package-lock.json)이면 lockfile·node 버전·플랫폼이 같은 설치본을 리포 공용 캐시
# (<git-common-dir>/dflow-deps/<key>)에서 복제한다. APFS·reflink 파일시스템에서는 쓸 때만 실제로 복사된다.
# 캐시는 이 스크립트의 npm ci 가 성공한 결과로만 채운다. 사람 체크아웃의 node_modules 는 쓰지 않는다
# (lockfile 과 어긋난 채 남아 있을 수 있다).
# 출력 첫 단어: DEPS_SKIP · DEPS_CLONED · DEPS_INSTALLED · DEPS_FAILED(exit 는 설치 명령의 exit)
set -u

[ -f package.json ] || { echo "DEPS_SKIP package.json 없음"; exit 0; }
[ -e node_modules ] && { echo "DEPS_SKIP node_modules 있음"; exit 0; }

clone_dir() { # $1 원본 $2 대상(없어야 한다)
  case "$(uname -s)" in
    Darwin) cp -Rc "$1" "$2" 2>/dev/null || { rm -rf "$2"; cp -R "$1" "$2"; } ;;
    *)      cp -R --reflink=auto "$1" "$2" 2>/dev/null || { rm -rf "$2"; cp -R "$1" "$2"; } ;;
  esac
}

if [ -f package-lock.json ]; then
  key=$( { cksum < package-lock.json; node -v 2>/dev/null || echo nonode; uname -sm; } | cksum | cut -d' ' -f1)
  C="$(git rev-parse --path-format=absolute --git-common-dir)/dflow-deps"
  E="$C/$key"
  if [ -f "$E/ok" ]; then
    t="node_modules.dflow-tmp.$$"; rm -rf "$t"
    if clone_dir "$E/node_modules" "$t" && mv "$t" node_modules; then
      touch "$E"   # 최근 사용 표시(정리 순서)
      echo "DEPS_CLONED $key"; exit 0
    fi
    rm -rf "$t" node_modules
    echo "DEPS_CLONE_FAILED $key, npm ci 로 설치한다"
  fi
  npm ci || { rc=$?; echo "DEPS_FAILED npm ci exit $rc"; exit "$rc"; }
  echo "DEPS_INSTALLED npm ci"
  # 캐시 채우기. mkdir 에 성공한 한 팀원만 쓰고, 다 쓴 뒤 ok 를 남긴다. 실패해도 설치 결과는 유효하다.
  mkdir -p "$C" 2>/dev/null
  if mkdir "$E" 2>/dev/null; then
    if clone_dir node_modules "$E/node_modules"; then
      rm -rf "$E/node_modules/.cache" "$E/node_modules/.vite"   # 절대경로를 품을 수 있는 도구 캐시
      date +%s > "$E/ok"; echo "DEPS_CACHED $key"
    else
      rm -rf "$E"
    fi
  fi
  # 정리: ok 없이 60분 넘은 항목(쓰다 죽음)과, 최근 3개를 넘는 완성 항목
  for d in "$C"/*; do
    [ -d "$d" ] && [ ! -f "$d/ok" ] && [ -n "$(find "$d" -maxdepth 0 -mmin +60 2>/dev/null)" ] && rm -rf "$d"
  done
  ls -1t "$C" 2>/dev/null | tail -n +4 | while IFS= read -r d; do [ -f "$C/$d/ok" ] && rm -rf "${C:?}/$d"; done
  exit 0
elif [ -f pnpm-lock.yaml ]; then
  pnpm install --frozen-lockfile || { rc=$?; echo "DEPS_FAILED pnpm install --frozen-lockfile exit $rc"; exit "$rc"; }
  echo "DEPS_INSTALLED pnpm"
elif [ -f yarn.lock ]; then
  yarn install --frozen-lockfile || { rc=$?; echo "DEPS_FAILED yarn install --frozen-lockfile exit $rc"; exit "$rc"; }
  echo "DEPS_INSTALLED yarn"
else
  echo "DEPS_SKIP lockfile 없음"
fi
