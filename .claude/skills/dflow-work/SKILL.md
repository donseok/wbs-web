---
name: dflow-work
description: D'Flow 작업(내 작업 조회·착수·진행 보고·완료 보고)을 처리할 때 사용. "내 D'Flow 작업", "디플로우 작업", "작업 착수", "진행 보고", "작업 완료" 같은 요청에서 트리거.
---

# D'Flow 작업 처리

모든 호출은 `~/.claude/skills/dflow-work/scripts/dflow.sh` 로 한다. 산문 파싱 금지 —
**exit code 로 분기한다**: 0 성공 / 2 사용법·설정·push 미완료 / 3 인증 실패 / 4 상태 충돌·선행 미반영 / 5 권한 부족 / 6 네트워크·서버 오류 / 7 기능 꺼짐.

## 시작 절차 (매 세션 1회)

1. `dflow.sh doctor` 실행 — 모든 프로필 확인, 계약 버전 검증.
   ```bash
   dflow.sh doctor
   ```
   성공(exit 0) 출력:
   ```
   base: https://d-flow.example.com
   프로필 1: alice@example.com (계약 2.0, 프로젝트 3)
   ```
   계약 버전이 2.0이 아니면 wbs-web 클론을 pull 하라고 사용자에게 안내.

2. 프로필이 여럿이면(`DFLOW_PATS` 에 쉼표 구분 여러 토큰) 사용자가 지목한 사람으로 `--as <이름|email>` 옵션을 사용한다.

## 워크플로우

### 내 신원 확인

```bash
dflow.sh me
```

현재 사용자 신원, 스코프, 접근 가능 프로젝트 출력. 토큰 설정 후 첫 확인용.

### 목록 조회

```bash
dflow.sh [--as <이름|email>] list [--scope available|claimed|assigned|all] [--all]
```

기본값: `--scope available` (새 작업).

작업 목록 출력. 순번(1~N)을 사용자에게 그대로 보여준다.

**옵션**:
- `--all`: 모든 프로필의 작업을 동시 조회 (다중 계정 설정 시)
- `--scope`: available(기본), claimed, assigned, all

**예시**:
```bash
dflow.sh list --scope all           # 모든 상태 조회
dflow.sh --as bob@example.com list  # 다른 계정 (--as는 반드시 서브커맨드 앞)
dflow.sh list --all                 # 모든 프로필 순회
```

### 상태 확인

```bash
dflow.sh show <순번>
```

특정 작업의 상세 정보 조회. JSON 형식. ref는 순번 또는 UUID 8자 접두.

### 착수

```bash
dflow.sh claim <순번>
```

선행 조건이 미충족이면 **exit 4 로 차단**된다. 이 경우 fetch/merge 후 재시도한다. 우회 금지.

성공 시:
- `docs/tasks/<TSK>/spec.md` 캐시 생성 — **구현 전 반드시 읽는다** (명세 정본은 D'Flow DB, 이 파일은 claim 시점 스냅샷)

⚠️ **브랜치는 만들어지지 않는다** — dflow.sh 는 git 브랜치를 생성하지 않는다(스크립트에 해당 코드 없음).
`agent/<주문id 8자>-<slug>` 브랜치는 **호출자가 claim 직후 직접 만든다**:
```bash
git fetch origin && git switch -c agent/<주문id8>-<slug> origin/<기본브랜치>
```
main·staging 위에서 구현을 진행하지 말 것 — done 의 push 검증은 현재 브랜치를 그대로 쓰므로
브랜치를 안 만들면 main push 사고로 이어진다.

### 진행 보고

```bash
dflow.sh progress <순번> <0-99> "<요약>"
```

진행률은 **0~99 범위만 허용**한다(100은 서버가 400으로 거부).

출력: 현재 상태 (e.g. `claimed`).

### 완료 보고

**push 완료가 선행 필수** — push 없이 done 을 호출하면 exit 2 로 거부된다.

```bash
git push origin agent/<주문id 8자>-<slug>
dflow.sh done <순번> "<요약>" --auto-links
```

`--auto-links` 옵션: git 정보(브랜치, SHA, PR URL)를 자동 수집해 서버 보고.

보고 후 상태는 **reported(승인 대기)** 다. 사용자에게 "완료했습니다"가 아니라 "승인 대기로 보고했습니다"로 전달한다.

### 포기

```bash
dflow.sh release <순번>
```

claim 했던 작업을 포기. 상태 -> ready 로 돌아감.

## 금지사항 (명령형)

다음을 엄격히 금지한다:

- **옵션은 반드시 서브커맨드 앞에** — `dflow.sh --as bob@example.com list` (O), `dflow.sh list --as bob@example.com` (X). 뒤에 붙이면 에러 없이 다른 신원으로 조용히 실행되는 오동작 발생.
- **토큰을 echo·파일 기록·명령 문자열에 보간하지 않는다** — env 확장으로만 사용.
- `DFLOW_API_BASE` 기본값을 지어내지 않는다 — 미설정 시 즉시 실패.
- `--pct 100` 또는 `progress 100` 금지. approve 시도 금지(승인은 사람 몫).
- 409 충돌을 재시도로 뚫지 않는다 — 상태를 `dflow.sh show <순번>` 으로 확인하고 사용자에게 보고.
- 실패를 성공으로 요약하지 않는다 — 정직한 상태 전달.
- git author 를 D'Flow 신원으로 바꾸지 않는다 — 커밋 author 는 PC 주인 그대로.

### 작업 대상이 wbs-web 자신이면

- `git add -A` 금지 — 항상 파일명을 명시해 stage 한다.
- 마이그레이션과 코드를 같은 커밋에 담지 않는다(G1 pre-push 훅이 검사).
- `src/app/globals.css`, `src/app/layout.tsx`, `src/app/(app)/layout.tsx`, `src/components/app/*` 변경 시 'Preview 확인 필요(G2)' 를 사용자에게 경고.

## 세션 복구

로컬 상태 파일에 의존하지 않는다. 언제든:

```bash
dflow.sh list --scope claimed
```

로 서버에서 claimed 상태 작업을 복원한다.
