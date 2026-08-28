# D'Flow 작업 처리 스킬 (dflow-work)

D'Flow 작업을 Claude Code 에서 직접 조회, 착수, 진행 보고, 완료 보고할 수 있는 스킬입니다.

- **SKILL.md** — 워크플로우·금지사항·명령 규약
- **references/troubleshooting.md** — exit code 별 문제 해결

## 설치 (10분)

### 1단계: API 토큰 발급

1. wbs-web 웹 인터페이스에 로그인
2. `/account` 접속
3. **"내 API 토큰"** 또는 **"API 토큰 발급"** 클릭
4. 다음 스코프 선택:
   - `work:read` (작업 조회)
   - `work:claim` (작업 착수)
   - 완료 보고(report)·WBS import 는 `work:claim` 에 포함된다 — 별도 스코프 없음(2026-08-25 폐지)

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

### 3단계: 스킬 설치

스킬은 `~/.claude/skills/` 가 아니라 **대상 리포 안의 `.claude/skills/`** 에 설치한다
(dflow-dev 등이 리포 루트 기준 경로로 동작한다). 경로 둘 중 하나:

**A. 배포 킷 dflow-kit — 표준.** wbs-web 클론이 없는 PC 는 이 방법으로 설치한다:

```bash
git clone https://github.com/jongik-sv/dflow-kit.git
cd dflow-kit && ./install.sh <대상 리포 경로>
```

`install.sh` 가 `.claude/skills/dflow-*` 6종을 대상 리포에 복사하고, `.env` 초안 생성과
`.gitignore` 보강까지 한다. 갱신도 같은 명령이다(스킬 폴더 단위로 통째 덮는다).

**B. wbs-web 클론이 있는 PC.** 정본 `.claude/skills/` 를 심볼릭 링크한다:

```bash
ln -s /path/to/wbs-web/.claude/skills/dflow-work <대상리포>/.claude/skills/dflow-work
```

⚠️ 정본은 `wbs-web/.claude/skills/` 뿐이다. `docs/agent/claude-skill/` 아래 사본은
낡은 잔재이므로 링크 대상으로 쓰지 않는다.

### 4단계: 설치 확인

대상 리포 루트에서:

```bash
set -a; . ./.env; set +a
.claude/skills/dflow-work/scripts/dflow.sh doctor
```

exit 0 이면 base URL 과 프로필별 계약 버전이 출력된다.
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
- 명세 스냅샷 생성: `docs/tasks/TSK-01-01/spec.md`
- **반드시 spec.md 읽고 구현 시작**

⚠️ 브랜치는 만들어지지 않는다 — claim 직후 직접 만든다(SKILL.md 착수 절 참조):

```bash
git fetch origin && git switch -c agent/12345678-task-slug origin/<기본브랜치>
```

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
   ├─ exit 4(선행·상태 진행 불가) → git fetch/merge 후 재시도
   └─ exit 0 → spec.md 읽기, agent/ 브랜치 직접 생성
   ↓
3. 구현 & 커밋
   ↓
4. dflow.sh progress <순번> <%> "<요약>"  (선택, 중간 보고)
   ↓
5. git push origin agent/<주문-slug>
   ├─ exit 2 if push 미완료 → git push 후 재시도
   └─ exit 0 if push 완료
   ↓
6. dflow.sh done <순번> "<요약>" --auto-links
   └─ 상태 → reported (승인 대기)
```

`--auto-links` 를 빼먹으면 `evidence` 가 `{}` 로 영구 고정된다 — 후속 작업의 선행 도달
검사가 그 값을 쓴다.

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

**설치 후 스킬이 트리거되지 않으면** (대상 리포 루트에서):
1. 경로 재확인: `ls -la .claude/skills/dflow-work/scripts/dflow.sh`
2. 파일 권한: `chmod 755 .claude/skills/dflow-work/scripts/dflow.sh`
3. Claude Code 재시작

**명령 실패 시**:
- `references/troubleshooting.md` 의 exit code 별 절차 참고
- `dflow.sh doctor` 로 환경 진단
- `~/.cache/dflow/` 캐시 제거 후 재시도 (드문 경우)

## 스킬 파일 구조

```
<대상 리포>/.claude/skills/dflow-work/
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

**마지막 업데이트**: 2026-08-28
**API 계약 버전**: 2.1
