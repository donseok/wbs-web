# 강제 진행 스텁 — 승격 관문 훅 예시

운영 브랜치(`.dflow` 의 `release_branch`)로 push 할 때만 스텁 표식을 검사한다. 대상 리포의 `.githooks/pre-push`
(또는 쓰는 훅 관리자)에 넣는다.

```sh
#!/bin/sh
# pre-push: 운영 브랜치로 가는 push 에 FORCE-STUB 표식이 있으면 거부한다.
DFLOW=.claude/skills/dflow-work/scripts/dflow.sh
REL=$(sh "$DFLOW" branch release 2>/dev/null) || exit 0   # 설정이 없으면 관여하지 않는다
while read -r _local_ref _local_sha _remote_ref _remote_sha; do
  [ "$_remote_ref" = "refs/heads/${REL#origin/}" ] || continue
  sh "$DFLOW" stub-check "$_local_sha" || { echo "운영 브랜치에 강제 진행 스텁이 남아 있다 — 스텁 제거 작업을 먼저 끝내라" >&2; exit 1; }
done
exit 0
```

개발 브랜치와 운영 브랜치가 같은 리포(종전 운영)는 이 훅으로 막을 수 없다 — `/dflow-merge` 가 머지 전에 같은 검사를 한다.
