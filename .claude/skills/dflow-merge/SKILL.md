---
name: dflow-merge
description: 승인(approved)된 D'Flow 작업의 agent 브랜치를 기본브랜치(main)에 반영. 스택 브랜치는 조상 순서대로, approved 확인 전 머지 금지. 트리거 - "/dflow-merge", "승인된 작업 머지", "approved 반영". 사용법 - /dflow-merge [<ref>...]
---

# /dflow-merge — 승인된 작업의 main 반영

인자: `$ARGUMENTS` (선택 — ref 목록. 없으면 로컬 reported 전체가 후보)

> **위치 선언**: /dflow-dev 는 done(reported, 승인 대기)에서 끝난다. 사람이 D'Flow 웹에서
> approve 한 뒤 그 브랜치를 main 에 합치는 것이 이 스킬이다. 이게 없으면 후속 작업의 선행
> 게이트(`merge-base --is-ancestor` 검사)가 영원히 거짓이고 스택 브랜치가 무한히 깊어진다.
> 서버 통신은 dflow.sh, exit code 분기, dflow-work 금지사항 상속.

## 절차

1. **후보 식별**: 인자 없으면 대상 저장소의 `docs/tasks/*/state.json` 에서 `phase=reported`
   인 작업 전부. 각각 `dflow.sh show <ref>` 로 서버 상태 확인.
2. **판정 — approved 만 진행**: `status=approved` 가 아니면 건너뛰고 "승인 대기"로 보고.
   **approved 확인 전 머지 절대 금지** — 로컬 state 나 기억이 아니라 show 응답이 판정이다.
3. **순서 — 스택은 조상 먼저**: 대상이 여럿이면 `git merge-base --is-ancestor A B` 로 조상
   관계를 판정해 조상부터 머지한다. 선행이 approved 가 아니어서 조상 브랜치를 머지할 수 없으면
   그 위의 후손도 이번엔 머지하지 않는다(선행을 건너뛰고 후손만 합치면 미승인 커밋이 main 에
   섞인다).
4. **머지**:
   ```bash
   git fetch origin && git switch <기본브랜치> && git pull --ff-only origin <기본브랜치>
   git merge --no-ff agent/<id8>-<slug> -m "merge: <TSK> <제목> (approved)"
   git push origin <기본브랜치>
   ```
   `--no-ff` 고정 — 작업 단위 경계가 머지 커밋으로 남아야 추적이 된다. push 가 훅에 거부되면
   우회 금지, 중단·보고.
5. **뒷정리** (머지된 작업마다):
   - state.json `phase=merged` 갱신 → 기본브랜치에 커밋(파일명 명시).
   - 머지된 `agent/` 브랜치 삭제(로컬 + 원격). 아직 미승인 후손 스택 브랜치는 **삭제·rebase
     하지 않는다** — 이미 머지된 커밋을 조상으로 포함하므로 그대로 두면 제 차례에 깨끗이 머지된다.
6. **보고**: 머지된 목록 / 승인 대기로 남은 목록 / 건너뛴 목록(사유)을 표로.

## 금지

- approved 아닌 작업의 머지(reported·claimed 포함). 서버 approve 시도.
- force push. 훅 우회(SKIP_GUARD).
- 머지 순서 뒤집기(후손 먼저).
- 대상 저장소가 wbs-web 자신이면 G1~G4 훅 제약을 사용자에게 사전 경고.
