#!/usr/bin/env bash
# /dflow-dev --worker 행 H: 팀원 워크트리의 의존성을 설치한다. cwd = 워크트리 루트.
#
# 1) gradle-wrapper.jar 복구: *.jar 는 gitignore 대상이라 새 워크트리에 gradle/wrapper/gradle-wrapper.jar 가
#    없을 수 있다. 메인 체크아웃(env MAIN_CHECKOUT, 없으면 `git worktree list --porcelain` 의 첫 worktree)의
#    같은 상대 경로에 jar 가 있고 이 워크트리에 없을 때만 복사한다(이미 있으면 건드리지 않는다). gradlew 가
#    있는 폴더(루트 포함)마다 본다. 링크가 아니라 복사인 이유: 워크트리를 지워도 메인 체크아웃 쪽이 안전하다.
#    메인 체크아웃에도 jar 가 없으면 DEPS_GRADLE_JAR_MISSING <폴더> 로 알리기만 하고 계속한다(실패로 치지 않는다 —
#    jar 없이 방치된 예제 폴더도 있다). 조용히 건너뛰면 팀원이 testAll 실패 뒤에야 원인을 찾는다(2026-09-24).
# 1-1) gitignore 된 심링크 복제: 메인 체크아웃에서 ignore 된 심링크(.claude·node_modules 아래 제외, 깊이
#    DEPS_MAXDEPTH 미만)가 이 워크트리의 같은 상대 경로에 없으면 `ln -s <메인>/<경로>` 로 건다. 이미 무엇이든
#    있으면 건드리지 않는다. 외부 설계 문서 링크(dmes-standard docs/mdm/design)가 새 워크트리에 없어 팀원이 절대경로를
#    추측해 읽은 일(2026-09-24 TSK-02-02)에서 나왔다. Windows(Git Bash) 의 ln -s 는 복사본을 만든다.
#    `node_modules` 자체가 심링크인 것은 걸지 않는다 — 링크째 걸리면 워커의 설치가 사람 체크아웃에 쓴다.
# 2) JS 의존성 설치. 루트뿐 아니라 하위 폴더의 lockfile 도 찾아 각각 설치한다(예 src/frontend/pnpm-lock.yaml)
#    — node_modules·.git·.claude(워크트리 포함) 는 제외하고 깊이는 DEPS_MAXDEPTH(기본 4)로 제한한다. 폴더마다
#    한 줄씩 보고하며, 루트 줄의 형식은 기존 계약과 글자 그대로 같다(접미사 없음) — 하위 폴더 줄만 끝에 그 폴더
#    경로를 붙인다. 복제는 macOS 는 cp -Rc(APFS 복제), 그 밖은 cp -R --reflink=auto 이고 안 되면 cp -R 이다.
#    APFS·reflink 파일시스템에서는 쓸 때만 실제로 복사된다.
#  2-a) npm(package-lock.json): lockfile·node 버전·플랫폼·폴더가 같은 설치본을 리포 공용 캐시
#    (<git-common-dir>/dflow-deps/<key>)에서 복제한다. 캐시는 이 스크립트의 npm ci 가 성공한 결과로만 채운다.
#    npm 은 사람 체크아웃의 node_modules 를 쓰지 않는다 — npm ci 는 node_modules 를 지우고 시작하므로 무엇을
#    복제해 두든 이득이 없고, 사람 체크아웃은 lockfile 과 어긋난 채 남아 있을 수 있다.
#    캐시는 완성 항목 최근 3개만 남긴다. 복제는 postinstall 을 다시 돌리지 않는다 — Playwright 브라우저처럼 postinstall 이
#    받는 것은 사용자 전역 캐시(macOS ~/Library/Caches/ms-playwright)에 있어 첫 npm ci 가 받아 두면 그대로 쓴다. 이 점을
#    "고치려고" 복제 뒤에 npm rebuild 를 넣지 않는다.
#  2-b) pnpm(pnpm-lock.yaml): 메인 체크아웃(MAIN)의 같은 폴더에 설치본이 있으면 그 node_modules 와 워크스페이스
#    패키지의 node_modules 를 같은 상대 경로로 복제한 뒤, 이 워크트리의 lockfile 로
#    `pnpm install --frozen-lockfile --prefer-offline --config.confirmModulesPurge=false` 를 한 번 돌린다.
#    사람 체크아웃의 설치본을 이제 써도 되는 이유: pnpm 은 기존 node_modules 를 lockfile 과 대조해 다른 것만
#    바로잡으므로, 사람 쪽이 어긋나 있어도(lockfile 을 받고 설치를 안 했거나, 스택 기점의 lockfile 이 기본 브랜치와
#    달라도) 이 install 뒤에는 워커 기점의 lockfile 대로다. 복제는 빈 폴더에서 시작하는 설치를 줄이는 출발점일
#    뿐 정답의 근거가 아니다(2026-09-24 실측: 의존 추가·제거가 이 install 에서 반영됐다).
#    실측으로 정한 세부(pnpm 10.14, 2026-09-24):
#    - 복제 뒤 모든 `*/node_modules/.bin`(.pnpm 안 포함)을 지운다. 셈의 NODE_PATH 에 메인의 절대경로가 박혀 있고,
#      install 은 최상위 셈만 새로 쓰고 .pnpm 안 패키지의 셈은 메인 경로로 남긴다. 지우면 install 이 전부 다시 만든다.
#    - confirmModulesPurge=false 없이 store 경로가 다르면(.modules.yaml 의 storeDir 는 절대경로) pnpm 은 "modules
#      디렉터리를 지우고 다시 설치할까" 를 묻고, stdin 이 /dev/null 이어도 실패하지 않고 영원히 기다린다. 이 설정이
#      있으면 묻지 않고 지운 뒤 새로 설치한다(결과는 맞고 이득만 없다). 같은 PC 의 워커는 store 가 같아 해당 없다.
#    - 메인의 node_modules 가 심링크면 복제하지 않는다(링크째 복제되면 워커의 install 이 사람 체크아웃에 쓴다).
#    - 복제나 복제 뒤 install 이 실패하면 복제본을 모두 지우고 새로 설치한다(반쯤 망가진 node_modules 를 남기지 않는다).
#    메인 복제는 DFLOW_DEPS_MAIN_CLONE=1 일 때만 한다(기본 꺼짐). dmes-standard src/frontend(파일 약 7.9만 개) 실측에서
#    복제+설치 134s·53s 가 새 설치(--prefer-offline, 따뜻한 store) 53s·26s 보다 두 배쯤 느렸다 — 시간이 cp 에 든다(2026-09-24).
#    메인에 설치본이 없으면 새로 설치한다(`--prefer-offline` 으로 전역 store 를 최대한 쓴다). pnpm 은 공용 캐시를
#    두지 않는다 — 메인 복제가 그 역할을 하고, 새 설치도 store 에서 링크만 하므로 캐시로 줄일 몫이 작다.
#  2-c) yarn(yarn.lock): 종전대로 새로 설치한다(이 PC 에 yarn 이 없어 복제 방식을 실측하지 못했다).
#
# 3) 설치 명령(npm ci · pnpm install · yarn install)은 같은 폴더의 heavy.sh(PC 전역 무거운 명령 세마포어)로 감싸 돈다.
#    팀원 여럿이 동시에 설치하면 그것만으로 메모리·CPU 가 바닥난다(2026-09-24, 16GB PC 에서 Gradle JVM 10개와 겹쳤다).
#    복제·심링크·jar 복사는 감싸지 않는다(가볍다). heavy.sh 가 대기 상한 안에 슬롯을 못 얻으면(HEAVY_BUSY, exit 75)
#    그 폴더를 `DEPS_BUSY <dir>`(루트는 ".") 로 알리고 곧바로 exit 75 로 끝난다. 실패가 아니다 — 같은 명령을 다시 부르면
#    이미 끝난 폴더는 DEPS_SKIP(node_modules 있음)으로 넘기고 이어서 진행한다(멱등). 그래서 BUSY 때는 반쯤 만든
#    node_modules(메인 복제본)를 남기지 않는다. 설치 명령 자신이 75 로 끝나도 BUSY 와 같이 거기서 멈춘다(드묾).
#    heavy.sh 의 출력(stderr)은 설치 출력과 함께 stdout 으로 나온다. 시험은 DFLOW_HEAVY_DIR 로 슬롯 폴더를 바꾼다.
#
# 4) 준비 빌드(prepare): 설치가 모두 성공한 뒤, 리포 루트의 `.dflow-gates` 에 `prepare<TAB><명령>` 줄이 있으면 그 명령을
#    리포 루트에서 **한 번** 돌린다(`bash -c`, heavy.sh 로 감싼다 — 설치와 같다). 새 워크트리에는 워크스페이스 라이브러리의
#    dist 가 없어 첫 vitest·lint 가 실패했다(2026-09-26 dmes-standard 성능 감사 P9). 예: `prepare	pnpm --filter "<패키지>^..." build`.
#    - `.dflow-gates` 는 한 줄에 `<키 또는 경로 접두><TAB><명령>` 이고 `full`·`prepare` 가 예약어다. 여기서는 첫 필드가 정확히
#      `prepare` 인 첫 줄만 읽는다(`#` 주석·빈 줄 무시). 파일이나 줄이 없으면 아무것도 하지 않는다.
#    - 이미 돌렸으면 다시 돌리지 않는다(DEPS_PREPARE_SKIP). 표식은 작업 트리 밖, 워크트리마다의 git 디렉터리
#      `$(git rev-parse --absolute-git-dir)/dflow-prepare.done` 에 명령의 cksum 으로 남긴다 — 명령이 바뀌면 다시 돈다.
#    - **이번 호출에서 실제로 설치를 했으면(heavy.sh 로 감싼 npm ci·pnpm install·yarn install 을 실제로 돌렸으면 —
#      캐시·메인 복제만으로 끝난 DEPS_CLONED 는 포함하지 않는다) 준비를 시작하지 않고 `DEPS_PREPARE_PENDING` 과 exit 75 로
#      끝낸다.** 설치 슬롯 대기(최대 90초)+설치+준비 슬롯 대기(최대 90초)+빌드가 한 호출에 다 쌓이면 Bash 도구 timeout
#      상한(600000ms)을 넘어 하네스가 백그라운드로 옮기는 정지 사고가 난다(설계 wbs-web 리포 docs/superpowers/specs/2026-09-26-dflow-perf-audit-kit-design.md, 킷에는 미동봉).
#      호출자가 다시 부르면 그때는 설치가 DEPS_SKIP 으로 끝나므로 준비만 돈다. `DEPS_BUSY`(exit 75)와 같은 뜻이다 — 실패가
#      아니며 같은 호출을 다시 한다. 설치가 필요 없던 호출(이미 설치돼 있어 DEPS_SKIP)에서는 이 호출 안에서 바로 돈다.
#    - 실패하면 `DEPS_PREPARE_FAIL exit <rc> <명령>` 경고만 내고 exit 는 설치 결과(0) 그대로다. 준비 빌드는 첫 게이트 실패를
#      줄이는 최적화이고, 실패 원인은 게이트가 다시 보여 준다. 표식을 남기지 않으므로 다음 호출이 다시 시도한다.
#    - 슬롯을 못 얻으면(HEAVY_BUSY) `DEPS_BUSY prepare` 와 exit 75 — 설치와 같이 다시 부르면 준비만 이어서 돈다.
#
# 출력 첫 단어: DEPS_GRADLE_JAR · DEPS_GRADLE_JAR_MISSING · DEPS_LINK · DEPS_SKIP · DEPS_CLONED · DEPS_CLONE_FAILED ·
#   DEPS_CACHED · DEPS_SYNCED · DEPS_SYNC_FAILED · DEPS_INSTALLED · DEPS_FAILED(exit 는 설치 명령의 exit) ·
#   DEPS_BUSY(exit 75, 다시 부른다) · DEPS_PREPARE · DEPS_PREPARED · DEPS_PREPARE_SKIP · DEPS_PREPARE_PENDING(exit 75, 다시
#   부르면 준비만 돈다) · DEPS_PREPARE_FAIL(경고, exit 0)
set -u

MAXDEPTH="${DEPS_MAXDEPTH:-4}"
# install_dir 이 폴더로 cd 하기 전에 절대경로로 잡는다
HEAVY="$(cd "$(dirname "$0")" && pwd)/heavy.sh"
BUSY_RC=75
HBUSY=0

# 이번 호출에서 heavy_install 을 실제로 돌렸는지(설치를 시도했는지)의 표식. 준비 빌드가 같은 호출 안에서 이어지면
# 설치 슬롯 대기+설치+준비 슬롯 대기+빌드가 다 쌓여 Bash timeout 상한을 넘을 수 있다(머리 주석 4) — 그래서 이 표식이
# 있으면 준비를 미루고 DEPS_PREPARE_PENDING 으로 끝낸다. 작업 트리 밖에 두어 DIRTY 검사에 걸리지 않고, EXIT 트랩으로 지운다.
INSTALL_MARK=$(mktemp "${TMPDIR:-/tmp}/dflow-deps-install-mark.XXXXXX" 2>/dev/null) || INSTALL_MARK=""
[ -n "$INSTALL_MARK" ] && trap 'rm -f "$INSTALL_MARK"' EXIT

# 설치 명령을 heavy.sh 로 감싸 돌리고 그 exit 를 돌려준다. 슬롯을 못 얻었으면(HEAVY_BUSY) HBUSY=1 로 표시한다.
# heavy.sh 가 없거나 실행할 수 없으면 그냥 돌린다(줄 세우기는 성능 보호다 — fail-open, heavy.sh 와 같은 태도).
# 호출될 때마다(성공·실패·BUSY 무관) INSTALL_MARK 를 남긴다 — 이 함수를 부른다는 것 자체가 "설치 명령을 실제로
# 돌렸다(또는 돌리려 했다)"는 뜻이라 가장 단순한 판정 지점이다. 캐시 복제(DEPS_CLONED)는 이 함수를 거치지 않으므로
# 표식이 남지 않는다 — heavy.sh 슬롯 대기가 없어 시간 누적 위험이 없기 때문이다.
heavy_install() {
  local lf rc
  HBUSY=0
  [ -n "$INSTALL_MARK" ] && printf 1 >> "$INSTALL_MARK" 2>/dev/null
  if [ ! -x "$HEAVY" ]; then "$@"; return; fi
  lf=$(mktemp "${TMPDIR:-/tmp}/dflow-deps-heavy.XXXXXX" 2>/dev/null) || lf=""
  if [ -z "$lf" ]; then "$HEAVY" "$@"; return; fi
  "$HEAVY" "$@" 2>&1 | tee "$lf"
  rc=${PIPESTATUS[0]}
  [ "$rc" -eq "$BUSY_RC" ] && grep -q '^HEAVY_BUSY' "$lf" 2>/dev/null && HBUSY=1
  rm -f "$lf"
  return "$rc"
}

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

# ---- 1-1) gitignore 된 심링크 복제 ----
# 메인 체크아웃에 ignore 된 심링크(예 docs/mdm/design -> 리포 밖 설계 문서)는 새 워크트리에 따라오지 않는다.
# --directory 라 ignore 된 폴더(node_modules·build·워크트리)는 한 줄(끝 /)로만 나와 파고들지 않는다.
if [ -n "$MAIN" ] && [ "$(cd "$MAIN" && pwd -P)" != "$(pwd -P)" ]; then
  git -C "$MAIN" ls-files --others --ignored --exclude-standard --directory 2>/dev/null |
  while IFS= read -r p; do
    # node_modules 자체가 심링크여도 걸지 않는다 — 링크째 걸리면 워커의 설치가 사람 체크아웃에 쓴다(2-b)
    case "$p" in */|.claude/*|*node_modules/*|node_modules|*/node_modules|.git/*) continue ;; esac
    [ "$(printf '%s' "$p" | tr -cd / | wc -c)" -lt "$MAXDEPTH" ] || continue
    [ -L "$MAIN/$p" ] || continue
    { [ -e "$p" ] || [ -L "$p" ]; } && continue
    mkdir -p "$(dirname "$p")" && ln -s "$MAIN/$p" "$p" && echo "DEPS_LINK $p"
  done
fi

# ---- 2) JS 의존성 ----
clone_dir() { # $1 원본 $2 대상(없어야 한다)
  case "$(uname -s)" in
    Darwin) cp -Rc "$1" "$2" 2>/dev/null || { rm -rf "$2"; cp -R "$1" "$2"; } ;;
    *)      cp -R --reflink=auto "$1" "$2" 2>/dev/null || { rm -rf "$2"; cp -R "$1" "$2"; } ;;
  esac
}

# pnpm install 옵션. confirmModulesPurge=false 가 없으면 store 가 다를 때 non-TTY 에서도 영원히 기다린다(머리 주석 2-b).
PNPM_FLAGS="--frozen-lockfile --prefer-offline --config.confirmModulesPurge=false"

# $1 = 메인 쪽 워크스페이스 루트(절대경로). cwd = 워커 쪽 같은 폴더. 복제할 워크스페이스 패키지 폴더(상대경로)를
# 한 줄씩 낸다. 조건: 메인에 package.json 과 실제 폴더인 node_modules 가 있고, 자기 lockfile 이 없고(있으면 따로
# 설치되는 프로젝트다), 워커 트리에도 package.json 이 있으며 node_modules 는 아직 없다. .claude(다른 워커의
# 워크트리)·node_modules·.git 아래는 보지 않는다.
pnpm_ws_pkgs() {
  (cd "$1" && find . -maxdepth "$MAXDEPTH" \( -name node_modules -o -name .git -o -name .claude \) -prune -o -name package.json -type f -print 2>/dev/null) |
  while IFS= read -r f; do
    p=$(dirname "$f"); p=${p#./}
    [ "$p" = "." ] && continue
    { [ -f "$1/$p/pnpm-lock.yaml" ] || [ -f "$1/$p/package-lock.json" ] || [ -f "$1/$p/yarn.lock" ]; } && continue
    [ -d "$1/$p/node_modules" ] && [ ! -L "$1/$p/node_modules" ] || continue
    [ -f "$p/package.json" ] || continue
    { [ -e "$p/node_modules" ] || [ -L "$p/node_modules" ]; } && continue
    printf '%s\n' "$p"
  done
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
    heavy_install npm ci; rc=$?
    [ "$HBUSY" = 1 ] && { echo "DEPS_BUSY $dir"; exit "$BUSY_RC"; }
    [ "$rc" -eq 0 ] || { echo "DEPS_FAILED npm ci exit $rc$suffix"; exit "$rc"; }
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
    # 2-b) 메인 체크아웃의 설치본을 복제한 뒤 이 워크트리의 lockfile 로 바로잡는다(머리 주석).
    src_root="$MAIN/$dir"
    if [ "${DFLOW_DEPS_MAIN_CLONE:-0}" = 1 ] && [ -n "$MAIN" ] && [ -d "$src_root/node_modules" ] && [ ! -L "$src_root/node_modules" ]; then
      cloned=""; ok=1
      t="node_modules.dflow-tmp.$$"; rm -rf "$t"
      if clone_dir "$src_root/node_modules" "$t" && mv "$t" node_modules; then
        cloned="node_modules"
        pkgs=$(pnpm_ws_pkgs "$src_root")
        while IFS= read -r p; do
          [ -z "$p" ] && continue
          if clone_dir "$src_root/$p/node_modules" "$p/node_modules"; then
            cloned="$cloned
$p/node_modules"
          else
            cloned="$cloned
$p/node_modules"; ok=0; break
          fi
        done <<EOF
$pkgs
EOF
      else
        ok=0
      fi
      if [ "$ok" = 1 ]; then
        while IFS= read -r c; do
          find "./$c" -type d -path '*/node_modules/.bin' -prune -exec rm -rf {} + 2>/dev/null
          rm -rf "$c/.cache" "$c/.vite"   # 절대경로를 품을 수 있는 도구 캐시
        done <<EOF
$cloned
EOF
        heavy_install pnpm install $PNPM_FLAGS; rc=$?
        if [ "$HBUSY" = 1 ]; then
          :   # 아래에서 복제본을 지우고 DEPS_BUSY 로 끝낸다(다시 부르면 처음부터 — 멱등)
        elif [ "$rc" -eq 0 ]; then
          echo "DEPS_SYNCED pnpm 메인 복제 + frozen install$suffix"; exit 0
        else
          echo "DEPS_SYNC_FAILED pnpm install exit $rc, 복제본을 지우고 새로 설치한다$suffix"
        fi
      else
        echo "DEPS_CLONE_FAILED 메인 node_modules 복제 실패, 새로 설치한다$suffix"
      fi
      rm -rf "$t"
      while IFS= read -r c; do [ -n "$c" ] && rm -rf "$c"; done <<EOF
$cloned
EOF
      [ "$HBUSY" = 1 ] && { echo "DEPS_BUSY $dir"; exit "$BUSY_RC"; }
    fi
    heavy_install pnpm install $PNPM_FLAGS; rc=$?
    [ "$HBUSY" = 1 ] && { echo "DEPS_BUSY $dir"; exit "$BUSY_RC"; }
    [ "$rc" -eq 0 ] || { echo "DEPS_FAILED pnpm install --frozen-lockfile exit $rc$suffix"; exit "$rc"; }
    echo "DEPS_INSTALLED pnpm$suffix"
  elif [ -f yarn.lock ]; then
    heavy_install yarn install --frozen-lockfile; rc=$?
    [ "$HBUSY" = 1 ] && { echo "DEPS_BUSY $dir"; exit "$BUSY_RC"; }
    [ "$rc" -eq 0 ] || { echo "DEPS_FAILED yarn install --frozen-lockfile exit $rc$suffix"; exit "$rc"; }
    echo "DEPS_INSTALLED yarn$suffix"
  else
    echo "DEPS_SKIP lockfile 없음$suffix"
  fi
)

status=0
# 설치 슬롯을 못 얻은 폴더(DEPS_BUSY, exit 75)가 나오면 거기서 멈추고 75 로 끝난다 — 다시 부르면 이어서 진행한다
install_dir . || status=$?
[ "$status" -eq "$BUSY_RC" ] && exit "$BUSY_RC"

# 하위 폴더의 lockfile 도 찾는다(루트 자신은 제외). node_modules·.git·.claude(워크트리 포함) 는 배제한다.
# -mindepth 는 쓰지 않는다 — -prune 과 섞으면 얕은 깊이에서 -prune 이 억눌릴 수 있다. 대신 dirname 뒤 "." 을
# 걸러 루트를 뺀다(루트는 위에서 이미 처리했다).
sub_dirs=$(find . -maxdepth "$MAXDEPTH" \( -name node_modules -o -name .git -o -path ./.claude \) -prune -o \( -name package-lock.json -o -name pnpm-lock.yaml -o -name yarn.lock \) -type f -print 2>/dev/null |
  while IFS= read -r f; do dirname "$f"; done | sed 's#^\./##' | sort -u | grep -v '^\.$')

if [ -n "$sub_dirs" ]; then
  while IFS= read -r d; do
    [ -z "$d" ] && continue
    install_dir "$d" || { rc=$?; [ "$rc" -eq "$BUSY_RC" ] && exit "$BUSY_RC"; [ "$status" -eq 0 ] && status=$rc; }
  done <<EOF
$sub_dirs
EOF
fi

# ---- 4) 준비 빌드(prepare) ----
# 설치가 모두 성공했을 때만 돈다(머리 주석 4). 표식은 워크트리마다의 git 디렉터리(--git-common-dir 가 아니다 —
# 그러면 두 번째 워크트리가 자기 준비를 건너뛴다)에 둔다. 작업 트리 밖이라 DIRTY 검사에 걸리지 않는다.
if [ "$status" -eq 0 ]; then
  top=$(git rev-parse --show-toplevel 2>/dev/null) || top=$(pwd)
  gf="$top/.dflow-gates"
  pcmd=""
  if [ -f "$gf" ]; then
    # 첫 필드가 정확히 prepare 인 첫 줄. # 주석·빈 줄은 무시하고 CR(Windows 줄끝)은 지운다. 명령 = 첫 TAB 뒤 전부
    pcmd=$(tr -d '\r' < "$gf" | awk -F '\t' '
      /^[ \t]*#/ || /^[ \t]*$/ { next }
      $1 == "prepare" { sub(/^[^\t]*\t/, ""); print; exit }')
    pcmd=$(printf '%s' "$pcmd" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')
  fi
  if [ -n "$pcmd" ]; then
    gd=$(git rev-parse --absolute-git-dir 2>/dev/null) || gd=""
    mark="${gd:+$gd/dflow-prepare.done}"
    h=$(printf '%s' "$pcmd" | cksum | cut -d' ' -f1)
    if [ -n "$mark" ] && [ "$(cat "$mark" 2>/dev/null)" = "$h" ]; then
      echo "DEPS_PREPARE_SKIP 이미 돌렸다: $pcmd"
    elif [ -n "$INSTALL_MARK" ] && [ -s "$INSTALL_MARK" ]; then
      # 이번 호출에서 실제로 설치를 했다(머리 주석 4) — 여기서 멈추고 다시 부르게 한다. 다음 호출은 설치가
      # DEPS_SKIP 으로 끝나므로 곧장 준비만 돈다. DEPS_BUSY 와 같은 뜻(실패 아님, 재호출)이라 같은 exit 를 쓴다.
      echo "DEPS_PREPARE_PENDING $pcmd"
      exit "$BUSY_RC"
    else
      echo "DEPS_PREPARE $pcmd"
      # 리포 루트에서 돈다(스크립트의 마지막 단계라 cd 를 되돌리지 않는다. 서브셸로 감싸면 HBUSY 가 밖으로 나오지 않는다)
      cd "$top" 2>/dev/null
      heavy_install bash -c "$pcmd"; rc=$?
      if [ "$HBUSY" = 1 ]; then
        # 슬롯을 못 얻었다 — 설치 명령과 같이 거기서 멈춘다. 다시 부르면 설치는 DEPS_SKIP 으로 넘기고 준비만 다시 돈다
        echo "DEPS_BUSY prepare"; exit "$BUSY_RC"
      elif [ "$rc" -eq 0 ]; then
        if [ -n "$mark" ]; then
          printf '%s\n' "$h" > "$mark.tmp.$$" 2>/dev/null && mv -f "$mark.tmp.$$" "$mark" 2>/dev/null
          rm -f "$mark.tmp.$$" 2>/dev/null
        fi
        echo "DEPS_PREPARED $pcmd"
      else
        # 경고만 한다(exit 는 설치 결과 그대로) — 준비 빌드는 첫 게이트 실패를 줄이는 최적화다. 실패하면 게이트가 같은 원인을
        # 보여 준다. 표식을 남기지 않으므로 다음 deps.sh 호출이 다시 시도한다.
        echo "DEPS_PREPARE_FAIL exit $rc $pcmd"
      fi
    fi
  fi
fi

exit "$status"
