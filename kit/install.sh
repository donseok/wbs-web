#!/bin/sh
# install.sh — dflow-kit 을 대상 리포에 심는다.
# 사용법: ./install.sh <대상 리포 경로> [--hooks] [--gradle-pc]  (옵션은 대상보다 먼저 와도 된다: --gradle-pc <리포>)
#         ./install.sh --gradle-pc              (리포 없이 이 PC 의 ~/.gradle 안전망만 설치)
#   --hooks       좌석표 heartbeat 훅을 이 PC 의 ~/.dflow/hooks 에 설치(README 「좌석표 heartbeat 훅」)
#   --gradle-pc   이 PC(팀원을 돌리는 PC) 의 ~/.gradle 에 Gradle 권장 설정 안전망을 설치(README 「Gradle 권장 설정」)
#                 리포 인자 없이 단독으로도 쓸 수 있다 — 스킬 복사·.dflow 초안·settings.json 병합은 하지 않는다.
#                 심링크 배포 리포(.claude/skills/dflow-* 가 wbs-web 등을 가리키는 심링크)에서는 반드시 이 단독
#                 형태를 쓴다. install.sh <리포> 는 그 리포의 .claude/skills/dflow-* 를 rm -rf 뒤 cp -R 로
#                 덮어써 심링크를 평범한 폴더로 바꿔 버린다.
# 하는 일: 의존 명령 점검 → .claude/skills/dflow-* 복사(갱신) → .dflow·.dflow.local 초안·.gitignore 보강 →
#         대상 리포가 Gradle 리포면 gradle.properties 권장 설정 점검·안내 → 다음 단계 안내
# 하지 않는 일: 토큰 발급·.dflow.local 값 기입(사람 몫), git commit.
set -eu

KIT_DIR=$(cd "$(dirname "$0")" && pwd)

# Gradle 권장 키 → 값 한 줄. 리포 설정 점검(아래)과 --gradle-pc(단독·리포 모드 공통) 이 함께 쓴다.
gradle_key_line() {
  case "$1" in
    org.gradle.caching) echo 'org.gradle.caching=true' ;;
    org.gradle.workers.max) echo 'org.gradle.workers.max=3' ;;
    org.gradle.daemon.idletimeout) echo 'org.gradle.daemon.idletimeout=600000' ;;
    *) echo "$1=" ;;
  esac
}

# --gradle-pc — 이 PC(팀원을 돌리는 PC) 의 ~/.gradle 에 안전망을 심는다. 프로젝트별 리포 설정과는 별도 층이며
# GRADLE_USER_HOME 값이 프로젝트의 gradle.properties 보다 우선 적용된다는 점을 주의로 낸다. 리포 유무와 무관하게
# 돌므로 TARGET 을 참조하지 않는다(단독 모드에서도 그대로 쓴다).
install_gradle_pc() {
  GUH="${GRADLE_USER_HOME:-$HOME/.gradle}"
  mkdir -p "$GUH"
  gp="$GUH/gradle.properties"
  [ -f "$gp" ] || : > "$gp"
  # 파일이 있는데 마지막 줄이 개행으로 끝나지 않으면 >> 로 이어붙일 때 그 줄에 값이 붙어버린다(예:
  # org.gradle.workers.max=99org.gradle.caching=true) — 붙이기 전에 개행을 하나 보장한다.
  if [ -s "$gp" ] && [ -n "$(tail -c 1 "$gp")" ]; then printf '\n' >> "$gp"; fi
  for gk in org.gradle.caching org.gradle.workers.max org.gradle.daemon.idletimeout; do
    if grep -Eq "^[[:space:]]*${gk}[[:space:]]*=" "$gp"; then
      echo "건너뜀: $gp 의 $gk (이미 있음 — 값은 건드리지 않았다)"
    else
      gradle_key_line "$gk" >> "$gp"
      echo "설치: $gp 에 $(gradle_key_line "$gk") 추가"
    fi
  done
  echo "주의: $GUH 의 값은 각 프로젝트 gradle.properties 보다 우선 적용된다."
  mkdir -p "$GUH/init.d"
  gi="$GUH/init.d/dflow-test-jvm.gradle"
  if [ -f "$gi" ]; then
    echo "건너뜀: $gi (이미 있다 — 덮어쓰지 않았다)"
  else
    cp "$KIT_DIR/gradle/dflow-test-jvm.gradle" "$gi"
    echo "설치: $gi — 모든 Test 태스크를 빌드 캐시에서 빼고, .dflow-agent 워크트리에서만 -XX:TieredStopAtLevel=1 을 붙인다"
  fi
}

usage() { echo "사용법: install.sh <대상 리포 경로> [--hooks] [--gradle-pc]  또는  install.sh --gradle-pc" >&2; }

# 옵션은 대상보다 먼저 와도, 순서·개수 무관이다 — 인자 전체에서 --hooks·--gradle-pc 를 먼저 가려내고
# (둘 다 줄 수 있다) 옵션이 아닌 인자 중 첫 번째만 대상으로 삼는다. 그 뒤 남는 인자는 알 수 없는 옵션으로 무시한다.
DO_HOOKS=0
DO_GRADLE_PC=0
TARGET=""
for _arg in "$@"; do
  case "$_arg" in
    --hooks) DO_HOOKS=1 ;;
    --gradle-pc) DO_GRADLE_PC=1 ;;
    *)
      if [ -n "$TARGET" ]; then echo "알 수 없는 옵션: $_arg (무시)" >&2
      else TARGET="$_arg"; fi
      ;;
  esac
done

# --gradle-pc 단독 모드: 인자가 정확히 "--gradle-pc" 하나뿐이면(대상도 --hooks 도 없으면) 리포 없이
# 이 PC 안전망만 설치하고 끝낸다.
if [ -z "$TARGET" ] && [ "$DO_GRADLE_PC" = 1 ] && [ "$DO_HOOKS" = 0 ] && [ "$#" -eq 1 ]; then
  install_gradle_pc
  exit 0
fi

[ -n "$TARGET" ] || { usage; exit 2; }
[ -d "$TARGET" ] || { echo "대상 폴더 없음: $TARGET" >&2; exit 2; }
TARGET=$(cd "$TARGET" && pwd)
[ -d "$TARGET/.git" ] || echo "경고: $TARGET 은 git 리포가 아니다 — dflow-dev 는 git 리포 루트에서만 동작한다." >&2

# 1) 의존 점검 — dflow.sh(curl·jq), poll.sh(jq), nlevel/export 스크립트(python3 또는 python), done --auto-links(gh)
#    Windows 는 Git Bash(Git for Windows) 에서 실행한다. dflow-team 은 powershell.exe 도 쓴다(프로세스 시작 시각).
missing=""
for c in git curl jq gh; do command -v "$c" >/dev/null 2>&1 || missing="$missing $c"; done
command -v python3 >/dev/null 2>&1 || command -v python >/dev/null 2>&1 || missing="$missing python3"
if [ -n "$missing" ]; then
  echo "필요한 명령이 없다:$missing" >&2
  echo "  macOS: brew install${missing}" >&2
  echo "  Windows(Git Bash): winget 또는 scoop 으로 설치${missing} (python3 은 python 으로 대신할 수 있다)" >&2
  exit 2
fi

# 2) 스킬 복사 — 스킬 폴더 단위로 통째 갱신(사본에서 고친 것은 덮인다 — 정본은 킷)
#    주의: .claude/skills/dflow-* 가 심링크(다른 리포를 가리킴)인 대상에서는 이 단계가 그 심링크를 지우고
#    평범한 폴더로 바꿔 버린다. 심링크 배포 리포에는 install.sh 를 리포 인자 없이 --gradle-pc 단독으로만 써라.
mkdir -p "$TARGET/.claude/skills"
for s in "$KIT_DIR"/skills/dflow-*; do
  name=$(basename "$s")
  rm -rf "$TARGET/.claude/skills/$name"
  cp -R "$s" "$TARGET/.claude/skills/$name"
done
chmod +x "$TARGET"/.claude/skills/dflow-work/scripts/dflow.sh "$TARGET"/.claude/skills/dflow-poll/scripts/poll.sh
# gradle-check.sh 는 dflow-team 킷에 늘 딸려 오지만(kit-build.sh SKILLS 목록), 없어도 이 단계는 죽지 않는다 —
# 아래 3-d) 는 어차피 -f 로 있는지 다시 확인하고 sh 로 직접 불러 실행 비트에 기대지 않는다.
[ -f "$TARGET/.claude/skills/dflow-team/scripts/gradle-check.sh" ] \
  && chmod +x "$TARGET/.claude/skills/dflow-team/scripts/gradle-check.sh" || true

# 3) 설정 초안 + .gitignore — .dflow 는 커밋 대상, .dflow.local 은 개인 파일
#    레거시 대상(.env 에 DFLOW_* 가 있고 .dflow·.dflow.local 이 둘 다 없음)은 초안을 만들지 않는다.
#    둘 다 만들면 dflow-config.sh 가 즉시 new 모드로 판정해 .env 값을 무시하고(NO_DEV_BRANCH 로 멈춘다),
#    레거시로 잘 동작하던 리포가 install.sh 한 번으로 깨진다.
EX="$TARGET/.claude/skills/dflow-work"
LEGACY_ENV=0
if [ -f "$TARGET/.env" ] && grep -Eq '^[[:space:]]*(export[[:space:]]+)?DFLOW_' "$TARGET/.env" \
   && [ ! -f "$TARGET/.dflow" ] && [ ! -f "$TARGET/.dflow.local" ]; then
  LEGACY_ENV=1
fi
if [ "$LEGACY_ENV" = 1 ]; then
  echo "⚠ $TARGET/.env 에 DFLOW_* 가 있고 .dflow·.dflow.local 이 없다 — 레거시 모드로 남긴다(초안을 만들지 않았다)."
  echo "  새 방식으로 옮기려면: cp $EX/dflow.example $TARGET/.dflow && cp $EX/dflow.local.example $TARGET/.dflow.local"
  echo "  뒤 .env 의 값을 두 파일에 나눠 적고(공통은 .dflow, 개인은 .dflow.local) .env 를 지워라."
else
  if [ ! -f "$TARGET/.dflow" ]; then cp "$EX/dflow.example" "$TARGET/.dflow"; echo ".dflow 초안 생성 — 값을 채워 커밋하라: $TARGET/.dflow"
  else echo ".dflow 이미 있음"; fi
  if [ ! -f "$TARGET/.dflow.local" ]; then
    ( umask 077; cp "$EX/dflow.local.example" "$TARGET/.dflow.local" ); echo ".dflow.local 초안 생성 — pats·dev_branch 를 채워라: $TARGET/.dflow.local"
  else echo ".dflow.local 이미 있음 — pats·dev_branch 가 있는지 확인할 것"; fi
  [ -f "$TARGET/.env" ] && grep -Eq '^[[:space:]]*(export[[:space:]]+)?DFLOW_' "$TARGET/.env" \
    && echo "⚠ .env 의 DFLOW_* 는 .dflow·.dflow.local 로 옮겨라(두 파일이 있으면 .env 는 읽지 않는다)"
fi
touch "$TARGET/.gitignore"
grep -qx '\.dflow\.local' "$TARGET/.gitignore" || printf '\n# dflow-kit — 개인 설정(토큰)\n.dflow.local\n' >> "$TARGET/.gitignore"

# 3-c) 줄끝 고정: Windows 의 core.autocrlf=true 클론에서 스킬 스크립트가 CRLF 로 바뀌면 sh 가 `\r` 에서 죽는다.
touch "$TARGET/.gitattributes"
grep -qxF '.claude/skills/** text eol=lf' "$TARGET/.gitattributes" || printf '\n# dflow-kit — 스킬 스크립트 줄끝 고정\n.claude/skills/** text eol=lf\n' >> "$TARGET/.gitattributes"

# 3-b) 좌석표 heartbeat 훅 — --hooks 를 붙였을 때만 ~/.dflow/hooks 에 복사한다. settings.json 은 건드리지 않는다(안내만).
if [ "$DO_HOOKS" = 1 ]; then
  mkdir -p "$HOME/.dflow/hooks"
  cp "$KIT_DIR/hooks/heartbeat.sh" "$HOME/.dflow/hooks/heartbeat.sh"
  chmod +x "$HOME/.dflow/hooks/heartbeat.sh"
  echo "훅 복사: $HOME/.dflow/hooks/heartbeat.sh — ~/.claude/settings.json 등록은 README 「좌석표 heartbeat 훅」 참조"
fi

# 3-d) Gradle 권장 설정 — 대상 리포가 Gradle 리포일 때만 gradle.properties 상태를 점검한다(리포 정본, 다른 PC·CI 에도
#      적용된다). 파일이 없으면 권장 3키로 새로 만든다. 있는데 키가 빠졌으면 고치지 않고 붙일 줄만 안내한다(커밋은
#      사람 몫). 판정 로직은 dflow-team 의 gradle-check.sh 하나뿐 — /dflow-team 전제 검사도 같은 스크립트를 부른다.
GC="$TARGET/.claude/skills/dflow-team/scripts/gradle-check.sh"
if [ -f "$GC" ]; then
  gout=$(sh "$GC" "$TARGET" 2>/dev/null || true)
  if printf '%s\n' "$gout" | grep -Eq '^ROOT '; then
    echo
    echo "Gradle 권장 설정 점검(빌드 루트마다):"
    printf '%s\n' "$gout" | while IFS= read -r gline; do
      case "$gline" in
        "NOFILE "*)
          groot=${gline#NOFILE }
          gprops="$groot/gradle.properties"
          {
            echo '# dflow-kit — Gradle 권장 설정(install.sh 가 생성. 근거는 dflow-kit README 「Gradle 권장 설정」)'
            for gk in org.gradle.caching org.gradle.workers.max org.gradle.daemon.idletimeout; do gradle_key_line "$gk"; done
          } > "$gprops"
          echo "  생성: $gprops (권장 3키) — git add·커밋은 사람이 한다"
          ;;
        "MISSING "*)
          grest=${gline#MISSING }
          groot=${grest% *}
          gkeys=${grest##* }
          echo "  안내: $groot/gradle.properties 에 권장 키 일부가 빠졌다 — 파일은 고치지 않았다. 필요하면 끝에 추가하라:"
          for gk in $(printf '%s' "$gkeys" | tr ',' ' '); do echo "    $(gradle_key_line "$gk")"; done
          ;;
        "OK "*)
          groot=${gline#OK }
          echo "  확인: $groot/gradle.properties 에 권장 3키가 이미 있다(손대지 않았다)"
          ;;
        "ROOT "*) : ;;
      esac
    done
    echo "  참고: 테스트 JVM -XX:TieredStopAtLevel=1(CPU 약 25%↓, 경과 시간은 측정상 동일)은 빌드 스크립트 수정이라"
    echo "        자동 반영하지 않는다. Test 태스크를 빌드 캐시에서 빼는 것도 함께 권한다 — 선언되지 않은 외부 입력을"
    echo "        읽는 테스트가 흔해 캐시가 그 실패를 숨길 수 있기 때문이다. 캐시에서 빼는 방법은 outputs.doNotCacheIf"
    echo "        (또는 같은 뜻인 outputs.cacheIf { false })다 — 위험을 감수하고 Test 도 캐시하려면(opt-out) 그 줄을 지운다."
    echo "        스니펫 전문은 $KIT_DIR/README.md 「Gradle 권장 설정」 참고."
    echo "        이 PC 가 D'Flow 팀원을 돌리는 전용 PC 라면 './install.sh --gradle-pc' 로 사용자 홈 안전망을 더할 수 있다."
  fi
fi

# 3-e) --gradle-pc(리포와 함께) — 위 install_gradle_pc 를 그대로 쓴다.
if [ "$DO_GRADLE_PC" = 1 ]; then
  install_gradle_pc
fi

# 3-2) 워커 권한 준비: dflow-team 의 프로세스 백엔드 팀원(claude -p)은 비대화형이라 권한 확인이
#      필요한 명령이 거부되면 failed permission 으로 끝난다. 워커는 git 을 절대경로로 부르므로 허용
#      규칙도 절대경로 형태로 넣는다. 이미 있는 항목과 settings.json 의 다른 키는 보존한다.
GIT_ABS=$(command -v git)
SETTINGS="$TARGET/.claude/settings.json"
[ -f "$SETTINGS" ] || printf '{}\n' > "$SETTINGS"
jq --arg git "Bash($GIT_ABS *)" --slurpfile add "$KIT_DIR/worker-allow.json" \
  '.permissions.allow = (((.permissions.allow // []) + [$git] + $add[0].allow) | unique)' \
  "$SETTINGS" > "$SETTINGS.tmp" && mv "$SETTINGS.tmp" "$SETTINGS"
echo "권한 준비: $SETTINGS 의 permissions.allow 에 워커 허용 목록을 합쳤다 (Bash($GIT_ABS *) 는 이 PC 의 git 경로다. 다른 PC 에서 설치하면 그 경로의 규칙이 하나 더 붙는다)"

# 4) 버전 표식
cp "$KIT_DIR/VERSION" "$TARGET/.claude/skills/DFLOW_KIT_VERSION" 2>/dev/null || true

cat <<EOF

설치 완료: $TARGET/.claude/skills/ (dflow-work · dflow-dev · dflow-poll · dflow-merge · dflow-team · dflow-export · dflow-wbs-nlevel)

다음 단계
  1. D'Flow 웹 → 우상단 계정 → /account "내 토큰" 에서 PAT 발급
  2. $TARGET/.dflow 에 api_base·project_id, $TARGET/.dflow.local 에 pats·dev_branch 기입(값은 어디에도 붙여넣지 말 것). .dflow 는 커밋한다
  3. cd $TARGET && .claude/skills/dflow-work/scripts/dflow.sh doctor
  4. Claude Code 를 $TARGET 에서 열고 "/dflow-dev" 등 스킬 사용. 스킬 킷은 리포에 커밋해 팀과 공유한다.
  Windows(Git Bash): .gitattributes 로 스킬 줄끝을 LF 로 고정했다. 이미 CRLF 로 받은 클론이면 git add --renormalize . 뒤 커밋한다.
  5. 좌석표 heartbeat 훅: ./install.sh <리포> --hooks 뒤 README 「좌석표 heartbeat 훅」 대로 settings.json 등록
  6. Gradle 리포면 위 점검 결과를 확인. 이 PC 에서 팀원을 여럿 돌린다면 ./install.sh --gradle-pc(리포 없이 단독,
     심링크 배포 리포는 반드시 이 형태) 또는 ./install.sh $TARGET --gradle-pc 로 ~/.gradle 안전망도 추가할 수 있다
     (README 「Gradle 권장 설정」)
EOF
