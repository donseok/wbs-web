# D'Flow 작업 처리 스킬 (dflow-work)

D'Flow 작업을 Claude Code 에서 직접 조회, 착수, 진행 보고, 완료 보고할 수 있는 스킬입니다.

- **SKILL.md** — 워크플로우·금지사항·명령 규약
- **references/troubleshooting.md** — exit code 별 문제 해결

## 설치 (10분)

### 1단계: API 토큰 발급

1. wbs-web 웹 인터페이스에 로그인
2. `/account` 또는 `/agent-ops` 접속
3. **"내 API 토큰"** 또는 **"API 토큰 발급"** 클릭
4. 다음 스코프 선택:
   - `work:read` (작업 조회)
   - `work:claim` (작업 착수)
   - (선택) `work:report` (완료 보고)

5. 토큰 생성 후 **평문 1회만 표시** — 반드시 복사해 저장

### 2단계: 환경 변수 설정

작업 리포(예: 로컬 d-flow, MES 등)의 `.env` 또는 셸 프로필에 추가:

```bash
export DFLOW_API_BASE="https://d-flow.your-org.com"
export DFLOW_PATS="dflow_pat_..."
```

**여러 계정 사용 시** (선택):
```bash
export DFLOW_PATS="dflow_pat_alice_...,dflow_pat_bob_..."
```

각 명령에서 `--as alice@example.com` 으로 사용자 지정 가능.

**보안 권장**:
```bash
chmod 600 .env  # 파일 권한 제한
```

### 3단계: 심볼릭 링크 설정

wbs-web 클론의 경로를 **절대 경로**로 확인하고:

```bash
ln -s /Users/yourname/project/wbs-web/docs/agent/claude-skill/dflow-work ~/.claude/skills/dflow-work
```

또는 상대 경로 사용:

```bash
ln -s ../../../path/to/wbs-web/docs/agent/claude-skill/dflow-work ~/.claude/skills/dflow-work
```

### 4단계: 설치 확인

```bash
~/.claude/skills/dflow-work/scripts/dflow.sh doctor
```

성공 출력 (exit 0):
```
✓ doctor check passed
✓ API reachable: https://d-flow.your-org.com
✓ Authentication: <user_email>
✓ Contract version: 2.0
```

오류가 나면 `references/troubleshooting.md` 의 해당 exit code 절차를 따릅니다.

## 사용법 (예시)

### 내 작업 목록

```bash
dflow.sh list
```

출력:
```
[1] TSK-01-01 (priority: high) — Description...
[2] TSK-01-02 (priority: medium) — Description...
...
```

### 작업 착수

```bash
dflow.sh claim 1
```

성공 시:
- 브랜치 자동 생성: `agent/12345678-task-slug`
- 명세 스냅샷 생성: `docs/tasks/TSK-01-01/spec.md`
- **반드시 spec.md 읽고 구현 시작**

### 진행 보고

```bash
dflow.sh progress 1 50 "개발 50% 완료, 테스트 예정"
```

진행률은 **0~99** 범위만 허용 (100 금지).

### 완료 보고

```bash
git push origin agent/12345678-task-slug
dflow.sh done 1 "완료·테스트 통과·PR 병합됨" --auto-links
```

**중요**: push 후에 done 호출. push 없이는 exit 2 오류.

## 워크플로우 다이어그램

```
1. dflow.sh list
   ↓
2. dflow.sh claim <순번>
   ├─ exit 4 → git fetch/merge 후 재시도
   └─ exit 0 → branch 생성, spec.md 읽기
   ↓
3. 구현 & 커밋
   ↓
4. dflow.sh progress <순번> <%> "<요약>"  (선택, 중간 보고)
   ↓
5. git push origin agent/<주문-slug>
   ├─ exit 2 if push 미완료 → git push 후 재시도
   └─ exit 0 if push 완료
   ↓
6. dflow.sh done <순번> "<요약>"
   └─ 상태 → reported (승인 대기)
```

## wbs-web 자체 작업 시 유의

wbs-web 리포에서 작업할 때는 다음 규칙을 따릅니다:

### git 커밋

```bash
# ✓ 파일명 명시
git add src/lib/feature.ts src/lib/feature.test.ts
git commit -m "feat(feature): 기능 추가"

# ✗ git add -A 금지
# → DFLOW_PATS 같은 env 파일과 함께 섞여 올라갈 수 있음
```

### 마이그레이션

마이그레이션과 코드를 **같은 커밋에 담지 않음**:

```bash
# ✓ 마이그레이션 먼저 커밋
git add supabase/migrations/0070_*.sql
git commit -m "db: 스키마 변경"

# ✓ 그 다음 코드 커밋
git add src/lib/...
git commit -m "feat: 기능 구현"
```

### UI 파일 변경 시

다음 파일 변경 시 Vercel Preview 에서 **눈으로 확인**:
- `src/app/globals.css`
- `src/app/layout.tsx`
- `src/app/(app)/layout.tsx`
- `src/components/app/*`

이들 파일은 전 화면에 영향을 주는데 테스트로 깨짐이 안 잡히므로:

```bash
git switch -c ui/feature-name
git push -u origin HEAD
# ← Vercel Preview URL 에서 확인

git switch main && git merge ui/feature-name && git push
```

## 혼자 vs 여럿 작업하기

### 프로필 여럿

```bash
# 모든 프로필의 작업 조회
dflow.sh list --all

# alice 계정으로 작업 (--as는 반드시 서브커맨드 앞)
dflow.sh --as alice@example.com list
dflow.sh --as alice@example.com claim 1
```

### 다중 PC·세션

로컬 상태 파일에 의존하지 않으므로 안전:

```bash
# 다른 PC 에서 claimed 상태 복구
dflow.sh list --scope claimed
dflow.sh show <순번>
```

## 문제 해결

**설치 후 스킬이 트리거되지 않으면**:
1. 경로 재확인: `ls -la ~/.claude/skills/dflow-work/scripts/dflow.sh`
2. 파일 권한: `chmod 755 ~/.claude/skills/dflow-work/scripts/dflow.sh`
3. Claude Code 재시작

**명령 실패 시**:
- `references/troubleshooting.md` 의 exit code 별 절차 참고
- `dflow.sh doctor` 로 환경 진단
- `~/.cache/dflow/` 캐시 제거 후 재시도 (드문 경우)

## 스킬 파일 구조

```
~/.claude/skills/dflow-work/
├── SKILL.md                      ← 워크플로우·금지사항
├── README.md                      ← 이 파일
├── scripts/
│   └── dflow.sh                  ← 실행 스크립트 (755 권한)
└── references/
    ├── api-contract.md           ← API 명세
    └── troubleshooting.md         ← 문제 해결 가이드
```

## 지원

문제가 지속되면:

1. `dflow.sh doctor` 출력 수집
2. 환경 변수 확인 (토큰 제외): `env | grep DFLOW`
3. D'Flow 관리자에게 보고 (exit code, 타임스탐프, 위 정보 포함)

---

**마지막 업데이트**: 2026-08-12
**API 계약 버전**: 2.0
