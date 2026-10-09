#!/bin/sh
# kit-build.sh — dflow-* 스킬로 dflow-kit 배포 킷을 조립한다.
# 스킬 정본은 dmes-standard/.claude/skills/dflow-* 이고(2026-10-01), 여기 .claude/skills/dflow-* 는 그곳으로 가는 링크다.
# 링크가 아니라 링크 대상의 실제 파일을 복사한다(cp -R 은 링크 자체를 복사하므로 경로/. 로 내용을 복사).
# 사용법: scripts/kit-build.sh <출력 폴더>   (예: ~/dflow-kit — 그 폴더가 git 리포면 커밋·push 는 사람이)
# 출력: <출력>/skills/dflow-* · skills/_shared(node·bin·platform-support.md·style) · install.sh · README.md · VERSION
set -eu

ROOT=$(cd "$(dirname "$0")/.." && pwd)
OUT="${1:-}"
[ -n "$OUT" ] || { echo "사용법: kit-build.sh <출력 폴더>" >&2; exit 2; }
mkdir -p "$OUT/skills"

SKILLS="dflow-work dflow-dev dflow-poll dflow-merge dflow-team dflow-export dflow-wbs-nlevel"
for s in $SKILLS; do
  [ -d "$ROOT/.claude/skills/$s" ] || { echo "정본 스킬 없음(링크 대상 확인): $s" >&2; exit 2; }
  SRC=$(cd "$ROOT/.claude/skills/$s" && pwd -P)
  rm -rf "$OUT/skills/$s"
  mkdir -p "$OUT/skills/$s"
  cp -R "$SRC/." "$OUT/skills/$s/"
  find "$OUT/skills/$s" -name '__pycache__' -type d -prune -exec rm -rf {} + 2>/dev/null || true
  find "$OUT/skills/$s" -name '.pytest_cache' -type d -prune -exec rm -rf {} + 2>/dev/null || true
done

# _shared — dflow-* 스크립트가 ../../_shared/{node,bin} 을 import·참조한다(node 공용 모듈·윈도우 동봉 jq).
# 정본은 스킬 정본 리포의 .claude/skills/_shared 다. 시험(node/tests·tests)과 dflow 가 쓰지 않는 문서는 싣지 않는다.
SH_SRC=$(cd "$(cd "$ROOT/.claude/skills/dflow-work" && pwd -P)/.." && pwd -P)/_shared
[ -d "$SH_SRC/node" ] && [ -d "$SH_SRC/bin" ] || { echo "정본 _shared 없음(node·bin 확인): $SH_SRC" >&2; exit 2; }
rm -rf "$OUT/skills/_shared"
mkdir -p "$OUT/skills/_shared/node" "$OUT/skills/_shared/bin"
cp -R "$SH_SRC/bin/." "$OUT/skills/_shared/bin/"
for f in "$SH_SRC"/node/*; do
  [ "$(basename "$f")" = tests ] && continue
  cp -R "$f" "$OUT/skills/_shared/node/"
done
cp "$SH_SRC/platform-support.md" "$OUT/skills/_shared/platform-support.md"
# 문체 가이드 — 스킬이 ../_shared/style/Korean-STE-*.md 를 가리킨다(정본 = 스킬 정본 리포 .claude/skills/_shared/style).
mkdir -p "$OUT/skills/_shared/style"
for f in Korean-STE-Writing-Guide.md Korean-STE-LLM-Guide.md; do
  [ -f "$SH_SRC/style/$f" ] || { echo "정본 문체 가이드 없음: $SH_SRC/style/$f" >&2; exit 2; }
  cp "$SH_SRC/style/$f" "$OUT/skills/_shared/style/$f"
done
# 스킬이 가리키는 _shared 스크립트가 실제로 실렸는지 확인 — 빠지면 설치한 리포에서 ERR_MODULE_NOT_FOUND 로 죽는다.
for ref in $(grep -rhoE '_shared/(bin|node)/[A-Za-z0-9_.-]+\.(mjs|sh)' "$OUT"/skills/dflow-* | sort -u); do
  [ -f "$OUT/skills/$ref" ] || { echo "킷에 없는 _shared 파일을 스킬이 참조한다: $ref" >&2; exit 1; }
done

cp "$ROOT/kit/install.sh" "$OUT/install.sh"; chmod +x "$OUT/install.sh"
cp "$ROOT/kit/.gitattributes" "$OUT/.gitattributes"
cp "$ROOT/kit/worker-allow.json" "$OUT/worker-allow.json"
cp "$ROOT/kit/README.md" "$OUT/README.md"
mkdir -p "$OUT/hooks" && cp "$ROOT/kit/hooks/heartbeat.sh" "$OUT/hooks/heartbeat.sh" && chmod +x "$OUT/hooks/heartbeat.sh"
mkdir -p "$OUT/gradle" && cp "$ROOT/kit/gradle/dflow-test-jvm.gradle" "$OUT/gradle/dflow-test-jvm.gradle"
SKILLS_REPO=$(cd "$ROOT/.claude/skills/dflow-work" && git rev-parse --show-toplevel)
printf 'source: %s %s (kit: wbs-web %s)\nbuilt: %s\nskills: %s\n' \
  "$(basename "$SKILLS_REPO")" "$(git -C "$SKILLS_REPO" rev-parse --short HEAD)" \
  "$(git -C "$ROOT" rev-parse --short HEAD)" "$(date +%Y-%m-%d)" "$SKILLS" > "$OUT/VERSION"

# 킷 밖을 가리키는 경로가 남아 있으면 빌드 실패 — 다른 PC 에서 깨진다.
if grep -rn 'docs/superpowers\|docs/agent/claude-skill\|~/project/wbs-web' "$OUT/skills" "$OUT/hooks" --include='*.md' --include='*.sh' \
   | grep -v '킷에는 미동봉\|wbs-web 리포 docs/superpowers\|wbs-web docs/superpowers\|정본은 `wbs-web/.claude/skills/` 뿐이다\|docs/superpowers/specs/2026-10-07-skills-windows-compat.md' ; then   # 마지막은 _shared 문서 안의 설계 근거 표기(정본 리포 문서, 실행과 무관)
  echo "위: 킷 밖 참조가 남아 있다 — SKILL.md 를 고치고 다시 빌드" >&2; exit 1
fi

echo "빌드 완료: $OUT"; cat "$OUT/VERSION"
