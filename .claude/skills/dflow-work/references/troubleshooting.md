# D'Flow 클라이언트 troubleshooting

## exit code 별 진단 및 해결

### exit 0 — 성공

문제 없음.

### exit 2 — 사용법·설정·push 미완료

**원인들**:
- 명령 사용법 오류 (e.g. 순번 누락, 진행률 범위 초과)
- `DFLOW_API_BASE` 미설정
- `progress` 명령에서 진행률 100을 시도
- `done` 명령 호출 시 git push 미완료

**해결**:
1. 명령 사용법 확인: `dflow.sh <명령> --help` (있으면)
2. env 변수 확인:
   ```bash
   echo "API_BASE: $DFLOW_API_BASE"
   echo "PAT: $(echo $DFLOW_PATS | head -c 20)..."
   ```
3. 진행률은 0~99 범위만 허용
4. `done` 전에 반드시 push 완료:
   ```bash
   git push origin agent/<주문id>-<slug>
   dflow.sh done <순번> "<요약>"
   ```

### exit 3 — 인증 실패

**원인**: 토큰 만료, 폐기, 또는 불일치

**해결**:
1. 웹 로그인 → `/account` → 'API 토큰' 확인
2. 토큰 만료 여부 확인 (만료 시 새로 발급)
3. 토큰 폐기 여부 확인 (폐기 시 새로 발급)
4. PAT 형식 재확인: `dflow_pat_` 로 시작해야 함
5. env 변수에 올바른 토큰이 설정되었는지 확인:
   ```bash
   # DFLOW_PATS (여러 토큰 쉼표 구분) 또는 DFLOW_PAT (단일)
   export DFLOW_PATS="dflow_pat_..."
   ```

토큰 스코프도 확인: `work:read` + `work:claim` 최소 필요.

### exit 4 — 상태 충돌 또는 선행 미반영

**HTTP 409 / 선행 의존성 미충족**

**409 conflict 원인들**:
- 다른 사람이 같은 작업을 동시에 claim/release
- 작업 상태가 예기치 않게 변경됨

**선행 미반영 원인** (로컬 게이트):
- claim 또는 show 호출 시 선행 작업이 로컬에 merge 되지 않음
- git 히스토리에 선행 커밋 도달 불가능

**해결**:
1. 상태 확인:
   ```bash
   dflow.sh show <순번>
   ```
2. 409 conflict 이면 작업 선택을 바꾸거나 다른 사람과 조율
3. 선행 미반영 이면 (exit 4):
   ```bash
   git fetch origin
   git merge origin/main  # 또는 해당 브랜치
   dflow.sh claim <순번>  # 재시도
   ```
   **우회 시도 금지** — 실패 이유가 있다.

### exit 5 — 권한 부족

**HTTP 403 원인들**:

| 상황 | 해결 |
|---|---|
| `insufficient_scope` | 토큰 스코프 부족. `/account` 에서 `work:read`, `work:claim` 재발급(완료 보고·import 는 `work:claim` 에 포함) |
| `not_claim_owner` | 다른 사람이 claim 한 작업을 당신이 release/report 시도. 소유자에게 요청 |
| `not_assignee` | 배정된 담당자만 claim 가능한 작업. 담당자 변경은 웹 UI에서 |
| `forbidden_role` | 프로젝트 멤버 아님. 프로젝트 관리자에게 멤버십 요청 |
| `dependency_not_met` | 선행 작업이 완료되지 않음 |

**기본 확인**:
```bash
dflow.sh me
```
출력 예:
```
user_email: a@b.c
scopes: work:read, work:claim
projects: Project A (admin), Project B (member)
```

- 스코프에 필요한 권한이 있는지 확인
- 프로젝트 멤버십이 있는지 확인
- 필요하면 웹 `/account` → 토큰 재발급 또는 멤버십 요청

### exit 6 — 네트워크 또는 서버 오류

**HTTP 5xx / 네트워크 불가**

**해결**:
1. 네트워크 연결 확인:
   ```bash
   ping $(echo $DFLOW_API_BASE | cut -d/ -f3)
   ```
2. `DFLOW_API_BASE` URL 확인 (올바른 호스트인지)
3. 서버 상태 확인 (조직 Slack 또는 상태 페이지)
4. 방화벽/VPN 확인
5. 잠시 기다렸다 재시도

### exit 7 — 기능 꺼짐

**HTTP 404 (의도적 비구분)**

다음 중 하나:
- API 기능이 꺼짐 (`AGENT_API_ENABLED ≠ 'true'`)
- D'Flow 프로젝트가 미등록
- 작업이 없음

**진단**:
```bash
dflow.sh me
```

| 결과 | 의미 | 해결 |
|---|---|---|
| exit 7 | 기능 꺼짐 | 조직에 문의 |
| exit 0 + 프로젝트 없음 | 아직 위임된 작업 없음, 또는 설정에서 "전체 중지" | 웹 → WBS 항목 명세 패널 "에이전트 위임" 체크(자동 활성) / 설정 › 에이전트 › 재개 |
| exit 0 + 프로젝트 있음 | 작업 없음 | 목록 다시 조회 또는 잠시 기다린 후 재시도 |

## cache 와 상태 복구

### cache 위치

- 프로필: `~/.cache/dflow/profiles.json`
- 명세 스냅샷: `docs/tasks/<TSK-ID>/spec.md` (작업 리포에서)

### 명세 스냅샷 갱신

claim 할 때마다 새로 생성되므로 별도 갱신 불필요. claim 후 spec.md 를 반드시 읽으면 된다.

### 상태 로컬 복구

```bash
# 현재 claimed 상태 작업 모두 조회
dflow.sh list --scope claimed

# 특정 작업 상태 확인
dflow.sh show <순번>
```

### 프로필 다중 관리

여러 계정의 토큰이 설정되면:

```bash
# 모든 프로필의 작업 조회
dflow.sh list --all

# 또는 각 프로필별 진단
dflow.sh doctor

# 특정 프로필로 작업 (--as는 반드시 서브커맨드 앞)
dflow.sh --as alice@example.com list
dflow.sh --as alice@example.com claim <순번>
```

## 기타 확인사항

### git branch 상태

claim 성공 후:
```bash
git branch -a
# agent/<주문id 8자>-<slug> 브랜치가 생성되어 있어야 함
```

### 커밋 트레일러 확인

push 전 커밋에 다음이 있는지 확인:
```bash
git log -1 --format=%B | grep "^DFlow-Order:"
```

없으면 추가:
```bash
git commit --amend --trailer "DFlow-Order: <주문 UUID>"
```

## 지속적인 문제

같은 exit code 가 반복되면:

1. 로그 수집:
   ```bash
   dflow.sh doctor
   ```

2. 환경 전체 확인:
   ```bash
   echo "=== ENV ===" && env | grep DFLOW
   echo "=== Network ===" && curl -I $DFLOW_API_BASE/api/v1/agent/me
   echo "=== Git ===" && git status
   ```

3. 조직의 D'Flow 관리자에게 보고 (exit code, 타임스탬프, 위 로그 포함)
