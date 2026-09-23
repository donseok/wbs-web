#!/usr/bin/env bash
# /dflow-dev --worker 행 H: 팀원 워크트리의 의존성을 설치한다. cwd = 워크트리 루트.
#
# 1) gradle-wrapper.jar 복구: *.jar 는 gitignore 대상이라 새 워크트리에 gradle/wrapper/gradle-wrapper.jar 가
#    없을 수 있다. 메인 체크아웃(env MAIN_CHECKOUT, 없으면 `git worktree list --porcelain` 의 첫 worktree)의
#    같은 상대 경로에 jar 가 있고 이 워크트리에 없을 때만 복사한다(이미 있으면 건드리지 않는다). gradlew 가
#    있는 폴더(루트 포함)마다 본다. 링크가 아니라 복사인 이유: 워크트리를 지워도 메인 체크아웃 쪽이 안전하다.
#    메인 체크아웃에도 jar 가 없으면 DEPS_GRADLE_JAR_MISSING <폴더> 로 알리기만 하고 계속한다(실패로 치지 않는다 —
#    jar 없이 방치된 예제 폴더도 있다). 조용히 건너뛰면 팀원이 testAll 실패 뒤에야 원인을 찾는다(2026-09-24).
# 2) JS 의존성 설치: npm(package-lock.json)이면 lockfile·node 버전·플랫폼·폴더가 같은 설치본을 리포 공용
#    캐시(<git-common-dir>/dflow-deps/<key>)에서 복제한다. APFS·reflink 파일시스템에서는 쓸 때만 실제로
#    복사된다. 캐시는 이 스크립트의 npm ci 가 성공한 결과로만 채운다. 사람 체크아웃의 node_modules 는 쓰지
#    않는다(lockfile 과 어긋난 채 남아 있을 수 있다). 루트뿐 아니라 하위 폴더의 lockfile 도 찾아 각각
#    설치한다(예 src/frontend/pnpm-lock.yaml) — node_modules·.git·.claude(워크트리 포함) 는 제외하고 깊이는
#    DEPS_MAXDEPTH(기본 4)로 제한한다. 폴더마다 한 줄씩 보고하며, 루트 줄의 형식은 기존 계약과 글자 그대로
#    같다(접미사 없음) — 하위 폴더 줄만 끝에 그 폴더 경로를 붙인다.
#
# 출력 첫 단어: DEPS_GRADLE_JAR · DEPS_GRADLE_JAR_MISSING · DEPS_SKIP · DEPS_CLONED · DEPS_INSTALLED · DEPS_FAILED(exit 는 설치 명령의 exit)
set -u

MAXDEPTH="${DEPS_MAXDEPTH:-4}"

# ---- 1) gradle-wrapper.jar ----
MAIN="${MAIN_CHECKOUT:-}"
if [ -z "$MAIN" ]; then
  MAIN=$(git worktree list --porcelain 2>/dev/null | sed -n '1s/^worktree //p')
fi
[ -n "$MAIN" ] && [ -d "$MAIN" ] || MAIN=""
find . -maxdepth "$MAXDEPTH" \( -name node_modules -o -name .git -o -path ./.claude \) -prune -o -name gradlew -type f -print 2>/dev/null |
while IFS= read -r gw; do
  d=$(dirname "$gw"); d=${d#./}
  if [ "$d" = "." ]; then rel="gradle/wrapper/gradle-wrapper.jar"; else rel="$d/gradle/wrapper/gradle-wrapper.jar"; fi
  [ -f "$rel" ] && continue
  if [ -n "$MAIN" ] && [ -f "$MAIN/$rel" ]; then
    mkdir -p "$(dirname "$rel")" && cp "$MAIN/$rel" "$rel" && echo "DEPS_GRADLE_JAR $d"
  else
    echo "DEPS_GRADLE_JAR_MISSING $d"   # 경고만 한다(exit 0): 이 폴더의 gradlew 는 jar 가 없어 실패한다
  fi
done

# ---- 2) JS 의존성 ----
clone_dir() { # $1 원본 $2 대상(없어야 한다)
  case "$(uname -s)" in
    Darwin) cp -Rc "$1" "$2" 2>/dev/null || { rm -rf "$2"; cp -R "$1" "$2"; } ;;
    *)      cp -R --reflink=auto "$1" "$2" 2>/dev/null || { rm -rf "$2"; cp -R "$1" "$2"; } ;;
  esac
}

# $1 = 대상 폴더(상대경로, 루트는 "."). 그 폴더로 cd 해 설치하고 exit code 를 그대로 돌려준다(서브셸).
# 루트(".")는 출력 줄 끝에 폴더를 붙이지 않아 기존 계약과 글자 그대로 같다. 그 밖은 끝에 " <dir>" 을 붙인다.
install_dir() (
  dir="$1"
  cd "$dir" || { echo "DEPS_FAILED cd $dir exit 1"; exit 1; }
  suffix=""
  [ "$dir" = "." ] || suffix=" $dir"

  [ -f package.json ] || { echo "DEPS_SKIP package.json 없음$suffix"; exit 0; }
  [ -e node_modules ] && { echo "DEPS_SKIP node_modules 있음$suffix"; exit 0; }

  if [ -f package-lock.json ]; then
    key=$( { cksum < package-lock.json; node -v 2>/dev/null || echo nonode; uname -sm; printf '%s' "$dir"; } | cksum | cut -d' ' -f1)
    C="$(git rev-parse --path-format=absolute --git-common-dir)/dflow-deps"
    E="$C/$key"
    if [ -f "$E/ok" ]; then
      t="node_modules.dflow-tmp.$$"; rm -rf "$t"
      if clone_dir "$E/node_modules" "$t" && mv "$t" node_modules; then
        touch "$E"   # 최근 사용 표시(정리 순서)
        echo "DEPS_CLONED $key$suffix"; exit 0
      fi
      rm -rf "$t" node_modules
      echo "DEPS_CLONE_FAILED $key, npm ci 로 설치한다$suffix"
    fi
    npm ci || { rc=$?; echo "DEPS_FAILED npm ci exit $rc$suffix"; exit "$rc"; }
    echo "DEPS_INSTALLED npm ci$suffix"
    # 캐시 채우기. mkdir 에 성공한 한 팀원만 쓰고, 다 쓴 뒤 ok 를 남긴다. 실패해도 설치 결과는 유효하다.
    mkdir -p "$C" 2>/dev/null
    if mkdir "$E" 2>/dev/null; then
      if clone_dir node_modules "$E/node_modules"; then
        rm -rf "$E/node_modules/.cache" "$E/node_modules/.vite"   # 절대경로를 품을 수 있는 도구 캐시
        date +%s > "$E/ok"; echo "DEPS_CACHED $key$suffix"
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
    pnpm install --frozen-lockfile || { rc=$?; echo "DEPS_FAILED pnpm install --frozen-lockfile exit $rc$suffix"; exit "$rc"; }
    echo "DEPS_INSTALLED pnpm$suffix"
  elif [ -f yarn.lock ]; then
    yarn install --frozen-lockfile || { rc=$?; echo "DEPS_FAILED yarn install --frozen-lockfile exit $rc$suffix"; exit "$rc"; }
    echo "DEPS_INSTALLED yarn$suffix"
  else
    echo "DEPS_SKIP lockfile 없음$suffix"
  fi
)

status=0
install_dir . || status=$?

# 하위 폴더의 lockfile 도 찾는다(루트 자신은 제외). node_modules·.git·.claude(워크트리 포함) 는 배제한다.
# -mindepth 는 쓰지 않는다 — -prune 과 섞으면 얕은 깊이에서 -prune 이 억눌릴 수 있다. 대신 dirname 뒤 "." 을
# 걸러 루트를 뺀다(루트는 위에서 이미 처리했다).
sub_dirs=$(find . -maxdepth "$MAXDEPTH" \( -name node_modules -o -name .git -o -path ./.claude \) -prune -o \( -name package-lock.json -o -name pnpm-lock.yaml -o -name yarn.lock \) -type f -print 2>/dev/null |
  while IFS= read -r f; do dirname "$f"; done | sed 's#^\./##' | sort -u | grep -v '^\.$')

if [ -n "$sub_dirs" ]; then
  while IFS= read -r d; do
    [ -z "$d" ] && continue
    install_dir "$d" || { rc=$?; [ "$status" -eq 0 ] && status=$rc; }
  done <<EOF
$sub_dirs
EOF
fi

exit "$status"
