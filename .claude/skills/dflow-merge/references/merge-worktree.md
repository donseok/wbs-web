# /dflow-merge 임시 머지 워크트리

SKILL.md 「절차」 4번에서 **호출한 체크아웃이 기본 브랜치에 있지 않을 때만** 읽는다(detached HEAD·다른 브랜치 — 링크드
워크트리의 `/dflow-team` 팀장 등). 아래 "1~5", "1단계"·"4단계"·"5단계", "5번 뒷정리" 는 SKILL.md 「절차」 4번·5번의 번호다.

## 임시 머지 워크트리

   호출한 체크아웃이 기본 브랜치에 있지 않을 때 쓴다. 스윕을 시작할 때 한 번 만들고
   끝날 때 지운다. `<ROOT>` 는 호출한 체크아웃의 `git rev-parse --show-toplevel` 이다.
   ```bash
   W="<ROOT>/.claude/worktrees/dflow-merge"
   ex=$(git rev-parse --git-path info/exclude); mkdir -p "$(dirname "$ex")"; touch "$ex"
   grep -qxF '**/.claude/worktrees/' "$ex" || printf '%s\n' '**/.claude/worktrees/' >> "$ex"
   git worktree remove --force "$W" 2>/dev/null; rm -rf "$W"; git worktree prune
   git fetch origin && git worktree add --detach "$W" origin/<기본브랜치> || echo MERGE_WT_FAILED
   echo "W=$W"
   ```
   - `MERGE_WT_FAILED` 면 이번 스윕은 아무것도 머지하지 않고 "머지 워크트리 생성 실패" 로 보고한다.
   - **`$W` 를 쓰는 뒤 호출은 모두 아래 가드 줄로 시작한다.** Bash 호출 사이에는 셸 변수가 남지 않는다.
     빈 `$W` 로 `git -C "" …` 를 부르면 git 은 호출한 체크아웃에서 돈다 — 사용자 브랜치에 머지하고, 그것을
     `HEAD:<기본브랜치>` 로 push 하고, 실패하면 `reset --hard` 로 그 체크아웃을 되돌린다. 가드는 `$W` 를 같은
     규칙(`<ROOT>` = 호출한 체크아웃의 최상위)으로 다시 구하고, 워크트리가 없으면 아무것도 하지 않고 멈춘다.
     ```bash
     W="$(git rev-parse --show-toplevel)/.claude/worktrees/dflow-merge"; [ -e "$W/.git" ] || { echo NO_MERGE_WT; exit 1; }
     ```
     `NO_MERGE_WT` 면 그 후보를 처리하지 않고 "머지 워크트리 없음" 으로 보고한 뒤 스윕을 멈춘다.
   - `decisions.sh`(3·3-1단계)는 호출한 체크아웃 최상위에서 그 체크아웃의 스킬 경로로 부르고 `-C "$W"` 를 붙인다
     (예: `.claude/skills/dflow-merge/scripts/decisions.sh renumber -C "$W" --tsk <TSK> --order <order>`). `<W>` 에는 스킬이
     없을 수 있기 때문이다(gitignore 된 심링크로 배포한 리포).
   - 후보마다 위 1~5를 `<W>` 에서 한다. 달라지는 것은 셋뿐이다. 설정 블록과 같은 호출 안에서 이어 돌 때만
     가드 없이 `$W` 를 그대로 쓴다. 아래 `<W>`·`"$W"` 는 가드 줄이 구한 값이다.
     1. 1단계는 `git -C "$W" fetch origin && git -C "$W" switch --detach origin/<기본브랜치>` 다. `pull` 대신
        detach 하는 이유: `<W>` 는 브랜치를 잡지 않는다. 그 뒤 `git -C "$W" rev-parse HEAD` 를 머지 직전 HEAD 로 기록한다.
     2. 4단계의 state.json 은 `<W>/<후보 state.json 경로>` 를 고쳐 `<W>` 에서 커밋한다(같은 경로 재사용 규칙).
     3. 5단계는 `git -C "$W" push origin HEAD:<기본브랜치>` 다. 실패하면 `git -C "$W" reset --hard <기록한 HEAD>` 로
        되돌리고 같은 규칙(경합·훅·그 밖)으로 가른다. `--keep` 대신 `--hard` 를 쓰는 이유: `<W>` 는 이 스윕만 쓰는
        임시 트리라 지킬 미커밋 변경이 없다.
   - 5번 뒷정리의 로컬 `git branch -d` 도 `git -C "$W"` 로 한다. `-d` 는 브랜치가 현재 HEAD 에 머지됐는지 보는데,
     머지 커밋은 `<W>` 의 HEAD 에만 있기 때문이다.
   - 스윕이 끝나면(멈춘 경우 포함) `git worktree remove --force "$W"` 로 지운다. 로컬 브랜치 저장소는 모든
     워크트리가 함께 쓰므로 `<W>` 를 지워도 머지·삭제 결과는 남는다.
   - 호출한 체크아웃은 건드리지 않는다. 팀장처럼 detached HEAD 로 도는 체크아웃은 스윕 뒤 스스로
     `origin/<기본브랜치>` 로 다시 detach 해 최신을 따른다(`/dflow-team` 「4. 승인 스윕」).
