# /dflow-merge push 실패

SKILL.md 「절차」 4번 5단계의 `git push` 가 **실패했을 때만** 읽는다. 먼저 `git reset --keep <기록한 HEAD>` 로 되돌린 뒤
(임시 머지 워크트리면 `references/merge-worktree.md` 의 `reset --hard`) 출력 모양으로 가른다. 승인 반영 커밋
(`references/unapproved.md`)의 push 실패도 같다. 해소 머지(`--resolve`)는 `references/resolve.md` 8번을 따른다.

## push 실패

- 출력에 `non-fast-forward` 나 `fetch first` 가 있으면 경합이다. "push 실패(경합)" 로 보고하고 스윕을
  멈춘다. 다음 실행은 fetch 부터 다시 한다. 이유: 다른 스윕이 먼저 머지한 것이라 fetch 부터 다시 해야
  후보가 맞다.
- 그런 문구 없이 1 로 끝나면 훅 거부다(로컬 pre-push 훅은 고정 문구 없이 훅 출력과
  `failed to push some refs` 만 남긴다). "push 실패(훅)" 로 보고하고 그 작업과 그 후손(3번의 스택 관계)만
  빼고 다음 후보로 간다. 이유: 훅이 막은 작업은 사람이 풀 때까지 매번 막히므로 그 한 건이 뒤의
  승인분까지 막으면 안 되며, `/dflow-dev` Phase 01-가 의 원문도 이 작업만 건너뛰고 스윕을 계속했다.
- 그 밖의 실패(128 등 연결·권한 오류)는 "push 실패" 로 보고하고 스윕을 멈춘다. 원인을 모르는
  실패에서 머지를 계속 시도하지 않는 것이 지금 동작이기 때문이다.

`origin` 으로 리셋하지 않는다. 이유: 수동 사용자의 기본 브랜치에 있던 미push 커밋을 보호한다. 훅 거부를
우회하지 않는 것은 그대로다.

스윕을 멈추는 경우에도 SKILL.md 「절차」 6번 보고(「방언 검증」 포함)와 임시 머지 워크트리 지우기는 한다.
