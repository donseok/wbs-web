#!/bin/sh
# install.sh — dflow-kit 을 대상 리포에 심는다.
# 사용법: ./install.sh <대상 리포 경로>
# 하는 일: 의존 명령 점검 → .claude/skills/dflow-* 복사(갱신) → .env 초안·.gitignore 보강 → 다음 단계 안내
# 하지 않는 일: 토큰 발급·.env 값 기입(사람 몫), git commit.
set -eu

KIT_DIR=$(cd "$(dirname "$0")" && pwd)
TARGET="${1:-}"
[ -n "$TARGET" ] || { echo "사용법: install.sh <대상 리포 경로>" >&2; exit 2; }
[ -d "$TARGET" ] || { echo "대상 폴더 없음: $TARGET" >&2; exit 2; }
TARGET=$(cd "$TARGET" && pwd)
[ -d "$TARGET/.git" ] || echo "경고: $TARGET 은 git 리포가 아니다 — dflow-dev 는 git 리포 루트에서만 동작한다." >&2

# 1) 의존 점검 — dflow.sh(curl·jq), poll.sh(jq), nlevel/export 스크립트(python3), done --auto-links(gh)
missing=""
for c in git curl jq python3 gh; do command -v "$c" >/dev/null 2>&1 || missing="$missing $c"; done
if [ -n "$missing" ]; then
  echo "필요한 명령이 없다:$missing" >&2
  echo "  macOS: brew install${missing}" >&2
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

# 3) .env 초안 + .gitignore
if [ ! -f "$TARGET/.env" ]; then
  cp "$KIT_DIR/.env.example" "$TARGET/.env"
  echo ".env 초안 생성 — 값을 채워야 한다: $TARGET/.env"
else
  echo ".env 이미 있음 — DFLOW_API_BASE / DFLOW_PATS / DFLOW_PROJECT_ID 세 키가 있는지 확인할 것"
fi
touch "$TARGET/.gitignore"
grep -qx '\.env' "$TARGET/.gitignore" || printf '\n# dflow-kit — 토큰 파일\n.env\n' >> "$TARGET/.gitignore"

# 3-2) 워커 권한 준비: dflow-team 의 프로세스 백엔드 팀원(claude -p)은 비대화형이라 권한 확인이
#      필요한 명령이 거부되면 failed permission 으로 끝난다. 워커는 git 을 절대경로로 부르므로 허용
#      규칙도 절대경로 형태로 넣는다. 이미 있는 항목과 settings.json 의 다른 키는 보존한다.
GIT_ABS=$(command -v git)
SETTINGS="$TARGET/.claude/settings.json"
[ -f "$SETTINGS" ] || printf '{}\n' > "$SETTINGS"
jq --arg git "Bash($GIT_ABS *)" --slurpfile add "$KIT_DIR/worker-allow.json" \
  '.permissions.allow = (((.permissions.allow // []) + [$git] + $add[0].allow) | unique)' \
  "$SETTINGS" > "$SETTINGS.tmp" && mv "$SETTINGS.tmp" "$SETTINGS"
echo "권한 준비: $SETTINGS 의 permissions.allow 에 워커 허용 목록을 합쳤다"

# 4) 버전 표식
cp "$KIT_DIR/VERSION" "$TARGET/.claude/skills/DFLOW_KIT_VERSION" 2>/dev/null || true

cat <<EOF

설치 완료: $TARGET/.claude/skills/ (dflow-work · dflow-dev · dflow-poll · dflow-merge · dflow-team · dflow-export · dflow-wbs-nlevel)

다음 단계
  1. D'Flow 웹 → 우상단 계정 → /account "내 토큰" 에서 PAT 발급
  2. $TARGET/.env 에 DFLOW_API_BASE · DFLOW_PATS · DFLOW_PROJECT_ID 기입 (값은 어디에도 붙여넣지 말 것)
  3. cd $TARGET && (set -a; . ./.env; set +a; .claude/skills/dflow-work/scripts/dflow.sh doctor)
  4. Claude Code 를 $TARGET 에서 열고 "/dflow-dev" 등 스킬 사용. 스킬 킷은 리포에 커밋해 팀과 공유한다.
EOF
