# /dflow-merge 승인 전 머지분 판정

SKILL.md 「절차」 1번 로컬 스캔의 넷째 칸이 `merged` 인 후보(`--on-report` 가 `unapproved: true` 를 남기고 머지한 작업)가
**있을 때만** 읽는다. 아래 "4번" 은 SKILL.md 「절차」 4번이다.

## 승인 전 머지분 판정

절대 다시 머지하지 않는다. SKILL.md 「절차」 1번의 같은 show 출력으로 가른다.

- `status=approved`: "승인 반영(이미 머지됨)". state.json 에서 `unapproved` 를 지우는 커밋 하나만 기본 브랜치에 올린다
  (4번의 머지 자리·push 실패 처리 그대로, `git merge` 단계만 없다. 커밋 메시지 `chore(<TSK>): approved (승인 전 머지분)`).
  이유: 표식이 남으면 매 스윕이 같은 작업을 다시 show 한다. 머지 자리의 state.json 에 표식이 이미 없으면
  (`jq -e '.unapproved == true'` 가 거짓) 커밋하지 않고 건너뛴다. 호출한 체크아웃이 옛 커밋에 머물러 표식을 계속
  읽어도 기본 브랜치에 빈 커밋이 쌓이지 않게 한다.
- 마지막 completion 리포트가 `review_action=reject`: "반려(머지됨): 되돌리기 또는 재작업 필요 (<review_note>)". state.json 은
  고치지 않는다. 이유: 반려 재작업(`/dflow-dev` Phase 01 1번)은 로컬 `merged` 와 서버 `claimed` 로 반려를 알아보며, 승인
  뒤 재작업처럼 기본 브랜치에서 새 agent 브랜치를 따 머지된 코드 위에 수정 커밋을 얹는다. 되돌리기(`git revert`)는
  스윕이 하지 않는다. 그 위에 이미 다른 작업이 올라갔을 수 있어 사람이 고른다. 보고에 **그 위에 쌓였을 수 있는 작업**을
  붙인다: 다른 승인 전 머지분 가운데, 그 작업의 첫 산출 커밋이 반려된 작업의 첫 산출 커밋을 조상으로 갖는 것이다.
  ```bash
  git log origin/<기본브랜치> --grep='DFlow-Order: <order>' --format=%H | tail -n 1   # 각 작업의 첫 산출 커밋
  git merge-base --is-ancestor <반려된 작업의 첫 커밋> <다른 작업의 첫 커밋>        # 참이면 그 위에 쌓였을 수 있다
  ```
- `status=reported`: "승인 대기(머지됨)". 보고만 한다.
- 그 밖의 status(`claimed` 인데 반려 리포트가 아님 등): "건너뜀(머지됨, 서버 <status>)".
- show 실패: "건너뜀(조회 실패)".
