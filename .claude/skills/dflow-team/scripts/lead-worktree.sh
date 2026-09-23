#!/usr/bin/env bash
# 같은 리포에서 두 번째 /dflow-team 팀장을 띄울 링크드 워크트리를 만든다.
# 사용: lead-worktree.sh <이름>   (주 체크아웃 루트에서 실행. 이름은 소문자·숫자·- 만)
# 만드는 것: <주 체크아웃>/.claude/worktrees/lead-<이름> (origin/<개발브랜치> 에서 detached),
#           .claude/skills 링크(스킬이 git 추적되지 않을 때), .dflow.local 복사본(as 줄은 뺀다. 레거시는 .env 에서 DFLOW_AS 를 뺀다. 값은 출력하지 않는다).
set -eu
name=${1:-}
case "$name" in ''|*[!a-z0-9-]*) echo "FAIL BAD_NAME 사용: lead-worktree.sh <이름> (소문자·숫자·- 만)" >&2; exit 2 ;; esac

ROOT=$(git rev-parse --show-toplevel)
PRIMARY=$(dirname "$(git rev-parse --path-format=absolute --git-common-dir)")
[ "$ROOT" = "$PRIMARY" ] || { echo "FAIL NOT_PRIMARY 주 체크아웃($PRIMARY)에서 실행하라" >&2; exit 2; }
[ -z "$(git rev-parse --show-prefix)" ] || { echo "FAIL NOT_REPO_ROOT 리포 루트에서 실행하라" >&2; exit 2; }

. "$(dirname "$0")/../../dflow-work/scripts/dflow-config.sh"
DFLOW_CONFIG_DIR=$PRIMARY; export DFLOW_CONFIG_DIR
dflow_config_load || exit 2
base=$(dflow_config_branch dev) || { echo "FAIL NO_DEFAULT_BRANCH" >&2; exit 2; }

ex=$(git rev-parse --git-path info/exclude); mkdir -p "$(dirname "$ex")"; touch "$ex"
grep -qxF '**/.claude/worktrees/' "$ex" || printf '%s\n' '**/.claude/worktrees/' >> "$ex"
grep -qxF '.dflow.local' "$ex" || printf '%s\n' '.dflow.local' >> "$ex"

LW="$PRIMARY/.claude/worktrees/lead-$name"
if [ -e "$LW" ]; then
  echo "EXISTS $LW"
else
  git fetch -q origin
  git worktree add -q --detach "$LW" "origin/$base"
  echo "CREATED $LW (origin/$base, detached)"
fi

if [ -z "$(git ls-files .claude/skills | head -n 1)" ]; then
  grep -qxF '/.claude/skills' "$ex" || printf '%s\n' '/.claude/skills' >> "$ex"
  mkdir -p "$LW/.claude"
  [ -e "$LW/.claude/skills" ] || ln -s "$PRIMARY/.claude/skills" "$LW/.claude/skills"
elif [ -z "$(git ls-files .claude/skills/dflow-dev | head -n 1)" ]; then
  # 일반 스킬은 추적되고 dflow-* 만 심링크인 리포 — 추적 스킬은 워크트리에 이미 있으니 dflow-* 만 링크한다.
  grep -qxF '/.claude/skills/dflow-*' "$ex" || printf '%s\n' '/.claude/skills/dflow-*' >> "$ex"
  mkdir -p "$LW/.claude/skills"
  for s in "$PRIMARY"/.claude/skills/dflow-*; do
    [ -e "$s" ] || continue
    [ -e "$LW/.claude/skills/${s##*/}" ] || ln -s "$s" "$LW/.claude/skills/${s##*/}"
  done
fi

if [ "$DFLOW_CONFIG_MODE" = new ]; then
  # .dflow 가 커밋돼 있으면 워크트리에 이미 있다. 주 체크아웃에만 있는 것은 링크한다.
  if [ ! -e "$LW/.dflow" ] && [ -f "$PRIMARY/.dflow" ]; then ln -s "$PRIMARY/.dflow" "$LW/.dflow"; echo "DFLOW_LINKED $LW/.dflow"; fi
  if [ -e "$LW/.dflow.local" ]; then
    echo "LOCAL_KEPT $LW/.dflow.local"
  else
    # as 는 주 체크아웃 팀장의 키다. 따라가면 SAME_IDENTITY_LEAD 로 거부되므로 그 줄만 빼고 복사한다.
    ( umask 077; grep -v -E '^[[:space:]]*as[[:space:]]*=' "$PRIMARY/.dflow.local" > "$LW/.dflow.local" || [ $? = 1 ] )
    chmod 600 "$LW/.dflow.local"
    echo "LOCAL_COPIED $LW/.dflow.local (as 는 뺐다)"
  fi
else
  if [ -e "$LW/.env" ]; then
    echo "ENV_KEPT $LW/.env"
  elif [ -f "$PRIMARY/.env" ]; then
    # DFLOW_AS 는 주 체크아웃 팀장의 키다. 따라가면 이 워크트리의 /dflow-team 이 키를 묻지 않고 같은 신원으로
    # 돌다가 SAME_IDENTITY_LEAD 로 거부된다. 그 줄만 빼고 복사해 키 판정이 이 워크트리의 키를 새로 정하게 한다.
    ( umask 077; grep -v -E '^[[:space:]]*(export[[:space:]]+)?DFLOW_AS=' "$PRIMARY/.env" > "$LW/.env" || [ $? = 1 ] )
    chmod 600 "$LW/.env"
    echo "ENV_COPIED $LW/.env (DFLOW_AS 는 뺐다)"
  else
    echo "ENV_MISSING 주 체크아웃에 .env 가 없다. $LW/.env 를 만들어라"
  fi
fi

echo "NEXT 1) 키는 /dflow-team 이 시작할 때 정한다(다른 워크트리의 팀장이 쓰는 신원은 후보에서 빠진다). 미리 정하려면 $LW/.dflow.local 에 as=<prefix>(레거시는 .env 에 DFLOW_AS=<prefix>)"
echo "NEXT 2) cd $LW && claude  →  /dflow-team <종료시각> …"
