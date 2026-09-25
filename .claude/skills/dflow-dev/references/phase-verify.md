# Phase 04 — Verify (검증)

`/dflow-dev` 의 Verify 서브에이전트가 읽는 파일이다. 커밋·읽기·병렬 조사·포그라운드·무거운 명령·토큰 규칙은 프롬프트
(phase-prompt.md 템플릿)에 있다.

Verify 는 전체 스위트를 다시 돌리는 Phase 가 아니다. Build 게이트가 이미 본 전체 회귀를 되풀이하지 않고, Build 가
남긴 증거를 감사한다.

1. **입력은 Build 게이트 결과다**: 오케스트레이터가 넘긴 sha·명령 줄·통과/실패 수(신규 실패 목록)를 받는다.
   전체 스위트를 다시 돌리지 않는다. 린트는 돌린다(가볍다).
2. **변이 검증 기록 감사**: build-log.md 「변이 검증 기록」 표의 행마다 표의 변이를 다시 넣고 표의 대상 테스트가
   빨강을 내는지 확인한다(Build 의 fail-fast·되돌리기·`heavy.sh` 규칙 그대로 — phase-build.md 「TDD 와 변이 검증」).
   「불변 규칙」 에 있는데 표에 없는 규칙, 표와 결과가 다른 행, `안 잡힘` 인데 보고가 없는 행을 찾아 보고한다. E2E 스위트
   전체가 대상인 행도 같다. 끝나면 넣은 변이를 모두 되돌려 `git status --porcelain` 이 Task 문서 밖에서 비어 있게 한다.
   research/docs 특례 작업은 표 대신 문서 검증 체크리스트를 순회한다(spec 의 category 가 research/docs).
3. **화면 작업이면 E2E 를 돌린다**(spec 에 `entry-point` 가 있거나 domain 이 `fullstack`·`frontend` 인 작업.
   `references/e2e.md` 「스모크 넷」, 스크린샷 포함). 서버는 e2e.md 「E2E 서버 슬롯」 대로
   슬롯을 붙잡고 띄우며, 끝나면 끄고 푼다.
4. 감사 결과는 보고로 돌려주고 design.md 에 적지 않는다.
5. **리포에 게이트 대응표(`.dflow-gates`)가 있으면** Build 게이트는 바꾼 모듈만 돌았을 수 있다(`{BUILD_GATE}` 의
   `scope` 가 `module`). 그때 전체 스위트는 당신이 끝난 뒤 **오케스트레이터의 Verify 게이트가 한 번** 돈다 — 머지 전
   최종 증거다. 당신은 여전히 전체 스위트를 돌리지 않는다.

- 실패 시 수정은 **Build 규율로 회귀**한다: 테스트를 삭제·skip 해 초록을 만드는 것 금지,
  테스트 총수 감소 = 게이트 실패. 수정 커밋은 Build 커밋과 분리.
- 코드를 고치면 오케스트레이터의 Verify 게이트가 전체 스위트를 다시 돈다. `git diff --name-only <Build 게이트 sha>..HEAD` 가
  Task 문서(`<TASKS>/<TSK>/` 아래)와 `*.md` 뿐이고 `git status --porcelain` 도 Task 문서 밖에서 비어 있으면 재실행을
  생략한다. 그러니 넣은 변이를 되돌리지 않고 끝내지 않는다.
- 재시도는 1회. 두 번째 실패는 중단하고 사람에게 보고한다.
- 전체 스위트·빌드·E2E 는 `heavy.sh` 로 감싼다(dev-discipline.md 「무거운 명령 줄 세우기」 정본). `HEAVY_BUSY` 는 재시도에
  세지 않는다.
