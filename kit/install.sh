#!/bin/sh
# install.sh — dflow-kit 을 대상 리포에 심는다.
# 사용법: ./install.sh <대상 리포 경로> [--hooks]
# 하는 일: 의존 명령 점검 → .claude/skills/dflow-* 복사(갱신) → .dflow·.dflow.local 초안·.gitignore 보강 → 다음 단계 안내
# 하지 않는 일: 토큰 발급·.dflow.local 값 기입(사람 몫), git commit.
set -eu

KIT_DIR=$(cd "$(dirname "$0")" && pwd)
TARGET="${1:-}"
[ -n "$TARGET" ] || { echo "사용법: install.sh <대상 리포 경로> [--hooks]" >&2; exit 2; }
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
mkdir -p "$TARGET/.claude/skills"
for s in "$KIT_DIR"/skills/dflow-*; do
  name=$(basename "$s")
  rm -rf "$TARGET/.claude/skills/$name"
  cp -R "$s" "$TARGET/.claude/skills/$name"
done
chmod +x "$TARGET"/.claude/skills/dflow-work/scripts/dflow.sh "$TARGET"/.claude/skills/dflow-poll/scripts/poll.sh

# 3) 설정 초안 + .gitignore — .dflow 는 커밋 대상, .dflow.local 은 개인 파일
EX="$TARGET/.claude/skills/dflow-work"
if [ ! -f "$TARGET/.dflow" ]; then cp "$EX/dflow.example" "$TARGET/.dflow"; echo ".dflow 초안 생성 — 값을 채워 커밋하라: $TARGET/.dflow"
else echo ".dflow 이미 있음"; fi
if [ ! -f "$TARGET/.dflow.local" ]; then
  ( umask 077; cp "$EX/dflow.local.example" "$TARGET/.dflow.local" ); echo ".dflow.local 초안 생성 — pats·dev_branch 를 채워라: $TARGET/.dflow.local"
else echo ".dflow.local 이미 있음 — pats·dev_branch 가 있는지 확인할 것"; fi
[ -f "$TARGET/.env" ] && grep -q '^DFLOW_' "$TARGET/.env" && echo "⚠ .env 의 DFLOW_* 는 .dflow·.dflow.local 로 옮겨라(두 파일이 있으면 .env 는 읽지 않는다)"
touch "$TARGET/.gitignore"
grep -qx '\.dflow\.local' "$TARGET/.gitignore" || printf '\n# dflow-kit — 개인 설정(토큰)\n.dflow.local\n' >> "$TARGET/.gitignore"

# 3-c) 줄끝 고정: Windows 의 core.autocrlf=true 클론에서 스킬 스크립트가 CRLF 로 바뀌면 sh 가 `\r` 에서 죽는다.
touch "$TARGET/.gitattributes"
grep -qxF '.claude/skills/** text eol=lf' "$TARGET/.gitattributes" || printf '\n# dflow-kit — 스킬 스크립트 줄끝 고정\n.claude/skills/** text eol=lf\n' >> "$TARGET/.gitattributes"

# 3-b) 좌석표 heartbeat 훅 — --hooks 를 붙였을 때만 ~/.dflow/hooks 에 복사한다. settings.json 은 건드리지 않는다(안내만).
if [ "${2:-}" = "--hooks" ]; then
  mkdir -p "$HOME/.dflow/hooks"
  cp "$KIT_DIR/hooks/heartbeat.sh" "$HOME/.dflow/hooks/heartbeat.sh" && chmod +x "$HOME/.dflow/hooks/heartbeat.sh"
  echo "훅 복사: $HOME/.dflow/hooks/heartbeat.sh — ~/.claude/settings.json 등록은 README 「좌석표 heartbeat 훅」 참조"
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
EOF
