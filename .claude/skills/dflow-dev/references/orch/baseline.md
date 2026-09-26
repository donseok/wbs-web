# /dflow-dev 단계 — 기준선·모델 결정

SKILL.md 「단계 지도」 가 가리킬 때 읽는다. 다 읽기 전에 이 단계를 시작하지 않는다. 모든 단계에 공통인 규칙(게이트 집행 원칙·상태 모델·서버 통신)은 SKILL.md 에 있다.

4. **게이트 기준선 기록**: dev-discipline 의 기준선 절차 실행, state.json 에 저장(`api_base` 가 아직 없으면 함께 기록한다. 상태 모델).
   기준선 명령은 하나씩 캐시 스크립트로 감싸 돌린다(dev-discipline 「기준선 캐시」 — 같은 기점·같은 명령은 한 번만 잰다).
   ```bash
   .claude/skills/dflow-dev/scripts/baseline.sh list --base <기점>   # 이 기점에서 이미 잰 명령. 같은 일을 재는 명령이 있으면 그 문자열·cwd 를 글자 그대로 쓴다
   .claude/skills/dflow-dev/scripts/baseline.sh run --base <기점> --task-dir <TASKS>/<TSK> -- '<테스트 명령>' 2>&1 | tail -30
   ```
   `<기점>` 은 3번 `git switch -c` 에 준 기점이다. 새로 쟀으면(`BASELINE_MEASURED ... key=`) 총수·실패 목록을
   `baseline.sh note` 로 더하고, 재사용했으면(`BASELINE_REUSED`) `BASELINE_SUMMARY` 의 수를 쓴다. state.json `baseline` 에는
   명령마다 `"cmd"`·`"source"`·`"cache_key"`·`"measured_at"` 을 적는다 — 형식·끄기(`DFLOW_BASELINE_CACHE=0`)·다시
   재기(`DFLOW_BASELINE_CACHE=refresh`)는 dev-discipline 「기준선 캐시」 다.
   Phase 프롬프트(`{VERIFY_CMDS}`)와 게이트로 옮기는 「기준선에서 실제로 돌린 명령 줄」 은 **`--` 뒤의 명령**이다 — 감싼
   줄을 옮기면 게이트가 캐시된 기준선을 자기 결과로 받는다.
   리포 최상위에 `.dflow-gates` 가 있으면 기준선 명령은 그 `full` 줄의 명령(들)이고 리포 최상위에서 잰다. state.json
   `baseline` 에 `"base": "<기점 sha>"` 를 적는다 — 재개한 세션도 게이트 범위 판정(`gate-scope.sh --base`)에 같은 기점을 쓴다.
   모듈 명령의 기준선은 여기서 재지 않고 Design 게이트 뒤에 잰다(`orch/design.md` 「Design 게이트」).
5. spec.md 읽기(필수) + 복잡도 판정(dev-discipline 의 점수표) → 설계 모델 결정, 한 줄 출력.
   이어서 Build 모델: 배정표로 `build_model_base` 를 정하고, state.json 에 `build_model_trial` 이 없을 때만
   `.claude/skills/dflow-dev/scripts/build-trial.sh <external_ref> <build_model_base>` 로 시험 여부를 판정해 두 값을 state.json 에
   적는다(커밋하지 않는다 — Design 산출물 커밋에 실린다). 있으면(재개) 다시 판정하지 않는다. 한 줄 출력:
   `Build 모델: <sonnet|opus> (배정 <base>, 시험 <BUILD_TRIAL 줄의 on|off·reason>)`. 규칙은 dev-discipline 「Build 모델 시험(build_model_trial)」.
   범위가 `build` 면 Design 서브에이전트를 띄우지 않으므로 설계 모델은 정하지 않는다(복잡도 판정은 Build 모델 배정에 쓴다).
  `build_model_base`·`build_model_trial`(Phase 01 5번)은 배정표가 정한 Build 모델과 Build 모델 시험 여부(`true`|`false`)다 —
  한 번 적으면 재개해도 다시 판정하지 않는다(dev-discipline 「Build 모델 시험(build_model_trial)」).
6. **준비 끝 표시**: state.json 의 `phase` 가 `prepare` 이면 `design` 으로 바꾼다(Design 서브에이전트를 띄우기 전, 커밋하지
   않는다). 빠뜨리면 Design 동안 좌석이 계속 「준비」로 보인다.


**다음 단계**: `orch/phase-common.md` → `orch/design.md`.
