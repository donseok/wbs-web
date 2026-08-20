---
name: dflow-dev
description: D'Flow 작업 1건의 전체 개발 사이클 실행 (claim→설계→TDD구현→테스트→리팩토링→완료보고). 서버 통신은 전부 dflow-work 의 dflow.sh 재사용 — 이 스킬은 그 사이의 구현 규율이다. 트리거 - "/dflow-dev", "작업 구현해", "D'Flow 작업 개발". 사용법 - /dflow-dev <순번|TSK-ID> [--only design|build|test|refactor] [--model opus|sonnet]
---

# /dflow-dev — D'Flow 작업 개발 사이클

인자: `$ARGUMENTS` (`<순번|TSK-ID>` + 옵션)
- 예: `1`, `TSK-00-01`, `1 --only build`, `2 --model opus`

> **역할 분리**: dflow-work = 서버 통신 계약(조회·claim·보고, exit code 분기).
> dflow-dev = claim 과 done 사이의 구현 규율. 서버 호출은 전부
> `~/.claude/skills/dflow-work/scripts/dflow.sh` 를 쓰고 산문 파싱 금지 — exit code 로 분기한다.
> dflow-work 의 금지사항(옵션은 서브커맨드 앞, 토큰 비보간, progress 100 금지,
> approve 금지, 409 재시도 금지, git add -A 금지, 마이그레이션+코드 혼합 커밋 금지)을 전부 상속한다.

## 상태 모델

정본 2층:

- **서버(D'Flow)**: claimed/reported 상태 + progress 숫자. 세션이 죽어도 남는 진실.
- **로컬 `docs/tasks/<TSK>/state.json`**: Phase 단위 세밀 상태.

```json
{ "tsk": "TSK-00-01", "order": "4bd9acd5",
  "phase": "build",
  "last": { "phase": "design", "event": "design.ok" } }
```

- `phase` = 다음에 실행할 Phase. **실패해도 되돌리지 않는다** — `last.event` 만 `*.fail` 로 기록.
  재실행하면 같은 Phase 자연 재개.
- state.json 유실 시 `dflow.sh show <ref>` 의 progress 로 복원한다:
  0→design, 25→build, 60→test, 85→refactor. (progress 는 성공한 Phase 까지만
  서버에 보고되므로 서버·로컬이 어긋나지 않는다.)

## Phase 0 — Claim·복잡도 판정 (오케스트레이터 본인)

1. `dflow.sh doctor` (세션 첫 호출이면). 실패 시 중단 — dflow-work 절차 참조.
2. `dflow.sh show <ref>` 로 상태 확인:
   - 미claim(`ready`) → `dflow.sh claim <ref>`. exit 4(선행 미충족)면 fetch/merge 후 1회 재시도,
     그래도 4면 **중단하고 선행 작업 상태를 사용자에게 보고**. 우회 금지.
   - 이미 `claimed` → claim 생략, state.json 또는 progress 로 재개 Phase 판정.
   - `reported`/`approved` → "이미 보고된 작업" 출력 후 종료.
3. claim 이 만든 `docs/tasks/<TSK>/spec.md` 를 **반드시 읽는다** (구현 전 필수).
4. 복잡도 점수 계산 (설계 모델 결정):

| 신호 | 조건 | 점수 |
|------|------|------|
| depends (show 출력) | 0–1개: 0 / 2–3개: +1 / 4개+: +2 | 0~2 |
| spec 키워드 | 아키텍처·트랜잭션·마이그레이션·인증·보안·외부연동 | +2 |
| category | research·docs | −1 |

**3점 이상 → 설계 opus, 미만 → sonnet.**
우선순위: `--model` 인자 > spec 의 `model:` 필드 > 자동 점수.
**설계는 haiku 금지** — haiku 가 지정돼도 설계만 sonnet 으로 대체하고 한 줄 알린다.
판정 결과를 한 줄 출력: `ℹ️ Design 모델: {model} ({score}점, 요인: {factors})`

## Phase 파이프라인

각 Phase 는 **Agent 도구로 격리된 서브에이전트**에서 실행한다. 공통 prompt 골격:

```
docs/tasks/{TSK}/spec.md 를 읽고 아래 Phase 를 수행하라.
TSK={TSK} / 저장소 루트={cwd}
[Phase 별 지시]
완료 시 마지막 줄에 정확히 PHASE_RESULT: ok 또는 PHASE_RESULT: fail <한줄사유> 를 출력하라.
```

| # | Phase | 모델 | 지시 요약 | 산출물 게이트 (오케스트레이터가 실재 확인) | 성공 시 서버 보고 |
|---|-------|------|-----------|--------------------------------------------|-------------------|
| 1 | Design | 복잡도 판정값 | spec 해석, 접근 방식·파일 목록·테스트 전략을 `docs/tasks/<TSK>/design.md` 로 | design.md 존재 + 비어있지 않음 | `dflow.sh progress <ref> 25 "설계 완료"` |
| 2 | Build | sonnet | **TDD — 테스트 먼저 작성해 실패 확인 후 구현**. design.md 를 따르되 이탈 시 사유를 design.md 에 추기 | 새 테스트 존재 + 관련 테스트 exit 0 | `dflow.sh progress <ref> 60 "구현 완료"` |
| 3 | Test | haiku | 전체 테스트 스위트 + lint 실행, 실패 목록 보고 | 전체 스위트 exit 0 (기존 실패로 알려진 건은 제외하되 목록 명시) | `dflow.sh progress <ref> 85 "검증 완료"` |
| 4 | Refactor | sonnet | 중복·네이밍·구조 개선. **동작 변경 금지**, 끝나면 전체 테스트 재실행 | 테스트 여전히 exit 0 (regression = 실패) | — |

### 게이트 규칙 (fail-closed)

Phase 서브에이전트가 끝날 때마다 오케스트레이터가:

1. `PHASE_RESULT` 와 **산출물 실재**(파일 존재, 테스트 exit code)를 직접 확인한다 —
   서브에이전트의 자기 신고만 믿지 않는다.
2. state.json 에 `last` 기록. 성공이면 `phase` 를 다음으로 전진.
3. **실패면 즉시 중단**: `"{TSK} {Phase} 실패 — {사유}. phase={현재값} 유지, 재실행 시 같은 Phase 재개."`
   를 사용자에게 보고하고 이후 Phase 를 실행하지 않는다.

**Test Phase 만 예외적으로 1회 재시도**: 실패 시 sonnet 으로 승격해 원인 수정 후 재실행.
두 번째 실패는 무조건 중단·보고. (재시도 예산 정교화는 리허설에서 필요가 증명되면.)

## Phase 5 — 마감 (오케스트레이터 본인)

1. 커밋 정리: 파일명 명시 stage (`git add -A` 금지), Phase 단위 커밋이 안 돼 있으면 여기서 커밋.
2. `git push origin <현재 브랜치>` (claim 이 만든 `agent/<id8>-<slug>` 브랜치).
3. `dflow.sh done <ref> "<요약>" --auto-links` — push 없이 done 금지(exit 2).
4. state.json 의 `phase` 를 `reported` 로. 사용자에게 **"완료"가 아니라 "승인 대기로 보고했습니다"** 로 전달.

## --only 옵션

`--only design|build|test|refactor`: 해당 Phase 만 실행하고 종료. 게이트·재개 판정 무시,
서버 progress 보고도 생략(부분 실행은 상태 전진이 아니다). state.json 도 갱신하지 않는다.

## 대상 저장소

이 스킬은 **현재 작업 디렉터리의 repo** 에서 작업한다. 저장소↔프로젝트 매핑 자동화는
보류된 설계(메모리 dflow-ops-structure 참조) — 올바른 폴더에서 실행하는 것은 호출자 책임.

## 금지 (dflow-work 상속 + 추가)

- progress 100·approve 시도 금지. push 없이 done 금지.
- wbs.md 를 읽거나 쓰지 않는다 — 작업 정본은 D'Flow 서버다.
- 서브에이전트 실패를 성공으로 요약하지 않는다. 게이트는 산출물 실재로만 판정.
- wbs-web 자신이 대상이면: G1(마이그레이션 혼합)·G2(UI 위험 파일) 규칙을 사용자에게 경고.
