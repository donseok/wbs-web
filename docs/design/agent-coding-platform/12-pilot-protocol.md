# 12 — 파일럿 절차서: WBS 리프 1건 완주 실측

작성: 2026-08-05 · 설계자 B · 수신: PM(리더 세션) · 실행 주체: 운영자(사용자) 본인
근거 결정: `04-pm-synthesis.md` §4-1(P1 경로 β 확정) · §6("다음 단계는 설계 확장이 아니라 파일럿 1건")
대상 설계: `02-agent-runtime.md`(실행 엔진·품질 게이트) · `01-scheduler-domain.md`(lease·재시도 가정값)

---

## 0. 이 문서가 하는 일

**설계를 늘리지 않는다. 이미 배포돼 돌아가는 루프로 실제 WBS 리프를 완주시켜 숫자를 얻는다.**

`02-agent-runtime.md`가 제시한 상한값(재시도 3회·벽시계 45분·build 10분·test 15분·diff 30파일)과 `01-scheduler-domain.md`의 lease 30분·재시도 2회는 **전부 가정치다.** 이 파일럿의 유일한 목적은 그 가정치를 실측값으로 바꾸고, 동시에 `02` R1(무료/구독 제약에서 코딩 에이전트가 애초에 성립하는가)에 GO/NO-GO를 내는 것이다.

### 0.1 전제 — PM이 해소한 것과 새로 생긴 경계

| 항목 | 상태 |
|---|---|
| 실행자 구독 보유 | **해소.** Claude Max 구독 확인(PM §4). `02` §10-1의 미확인 항목 삭제 |
| 실행 위치 | **운영자 PC의 로컬 러너.** 제품이 다수 사용자에게 구독을 프록시하면 ToS 위반이므로(PM §4), 파일럿에서도 러너는 사람 1명의 로컬 환경에서만 돈다. 서버 기능으로 만들지 않는다 |
| 대상 스택 | 경로 β — 현 Supabase 사본. MariaDB 이식은 이 파일럿 범위 밖 |
| 자동 배포 상한 | PR 생성까지(P5). 파일럿에서도 main 병합·`mark:good`은 사람이 한다 |

### 0.2 파일럿이 답하는 질문 (판정 기준을 먼저 못 박는다)

숫자를 본 뒤에 기준을 만들면 결론이 원하는 대로 나온다. 실행 전에 확정한다.

| Q | 질문 | GO 기준 | NO-GO 기준 |
|---|---|---|---|
| Q1 | 정형 작업을 완주하는가 | 난이도 A 과제 3회 중 **3회 완주** | 3회 중 1회 이하 |
| Q2 | 중간 난이도를 완주하는가 | 난이도 B 과제 3회 중 **2회 이상 완주** | 3회 중 0회 |
| Q3 | 재시도로 회수되는가 | 실패한 게이트의 **50% 이상**이 2회차 안에 통과 | 재시도가 같은 시그니처만 반복 |
| Q4 | 시간이 실용적인가 | 과제당 중앙값 **60분 이내**(사람 대기 제외) | 중앙값이 사람이 직접 하는 시간보다 길다 |
| Q5 | 안전장치가 실제로 작동하는가 | 음성 테스트 4종 전부 예상대로 차단 | 하나라도 뚫림 → **즉시 전면 중단** |

Q1~Q4가 부분 충족이면 **조건부 GO** — 통과한 난이도 대역만 자동화 대상으로 좁힌다(§8).

---

## 1. 대상 선정 기준과 안전 조건

### 1.1 안전 조건 (하나라도 못 지키면 파일럿을 시작하지 않는다)

| # | 조건 | 확인 방법 |
|---|---|---|
| S1 | **관제 대상은 전용 샘플 프로젝트뿐.** D-CUBE 프로젝트 ID는 어떤 요청에도 등장하지 않는다 | 기존 E2E가 쓴 샘플 프로젝트(`99999999-…` 계열, 삭제 가능)를 재사용. 러너 env에 D-CUBE ID를 넣지 않는다 |
| S2 | **미등록 프로젝트 404를 사전 실측한다.** | D-CUBE ID로 `GET /api/v1/agent/work` → 404 확인(§3 P0-5). 200이 오면 즉시 중단 |
| S3 | **에이전트가 작업하는 코드 리포는 원본 wbs-web이 아니다.** | 경로 β의 **복제본**(별도 clone, 별도 remote)에서만 작업. 원본 리포의 `origin`에는 어떤 push도 하지 않는다 |
| S4 | **워크트리에 운영 접속 정보를 두지 않는다.** | `.env*` 미복사. 자식 프로세스 env는 화이트리스트(PATH/HOME/LANG + 더미 DB 값)만 |
| S5 | **금지 경로(deny list) 무접촉.** | `supabase/migrations/**`, `src/app/globals.css`, `src/app/layout.tsx`, `src/app/(app)/layout.tsx`, `src/components/app/**`, `.githooks/**`, `.env*` — 과제 선정 단계에서 배제하고, 실행 후 diff로 재확인 |
| S6 | **실패 시 progress 보고 금지.** | 러너/사람 모두 실패를 `percent:0`으로 보고하지 않는다. release만(계약 §5·§7) |
| S7 | **`npm run mark:good` 금지.** | 파일럿은 화면 눈확인 절차가 아니다. known-good 좌표를 오염시키지 않는다 |
| S8 | **`SKIP_GUARD=1` 금지.** | pre-push 훅 G1/G2/G3를 그대로 받는다. 이것도 측정 대상이다 |

### 1.2 대상 WBS 리프 선정 기준

**포함 조건(전부 충족)**

1. `parent_id`로 본 **리프**일 것 — 자식이 있으면 발행 자체가 거부된다(`src/app/actions/agentWork.ts:71`) 그리고 실적 반영도 롤업으로 막힌다(`src/lib/agent/applyProgress.ts:32`).
2. 산출물이 **코드**일 것(문서·회의·검토 항목 제외).
3. 사람이 하면 **1시간 이내**로 끝날 크기.
4. **단일 관심사** — 파일 5개 이내에서 끝나는 것.
5. **자동 검증 가능** — 통과/실패가 `npm run test`로 판정되는 것.
6. deny list(S5) 무접촉, **DB 스키마 무변경**.
7. `biz`·`deliverable` 필드가 비어 있지 않을 것 — 이 둘이 프롬프트의 실질 내용이다(`src/app/api/v1/agent/work/route.ts:36`).

**제외 조건(하나라도 해당하면 제외)**

- UI 시각 결과가 성패를 가르는 작업(게이트가 못 잡는다 — `02` R3)
- 외부 API·비밀키가 필요한 작업
- 마이그레이션이 필요한 작업
- 기존 코드 대규모 리팩터

### 1.3 라운드 구성 — 난이도 3단 × 3회

| 난이도 | 성격 | 예시 유형 | 횟수 |
|---|---|---|---|
| **A. 정형** | 순수 함수 + 단위 테스트. 입출력이 명세로 확정 | 도메인 유틸 1개 + vitest | 3 |
| **B. 중간** | 기존 모듈 수정 + 호출부 반영 + 테스트 | 서버 액션/도메인 로직 확장 | 3 |
| **C. 난이도** | 다중 파일·기존 관례 준수 필요 | 신규 기능 얇은 수직 슬라이스 | 1 (탐색용) |

- A/B를 **각각 서로 다른 3개 과제**로 할지, **같은 과제 3회 반복**으로 할지: **서로 다른 3개 과제**로 한다. 같은 과제 반복은 분산만 재고 능력을 못 잰다.
- 단 **A 과제 1건은 추가로 1회 반복**해 분산을 본다(재현성 확인, 총 A 4회).
- C는 1회만 — 실패해도 NO-GO 근거로 쓰지 않는다(탐색).

과제는 샘플 프로젝트의 WBS 리프로 **먼저 등록**한다. 이는 프로덕션 Supabase에 데이터를 쓰는 행위이므로 **샘플 프로젝트 안에서만** 하고, 사용자 승인 후 진행한다(2026-08-03 E2E 선례와 동일 범위).

---

## 2. 사전 준비 (P0) — 파일럿 당일 1회

```bash
# P0-1. 시크릿 취득 (macOS 키체인)
SECRET=$(security find-generic-password -s "DFlow Agent API" -a agent -w)
BASE=https://<프로덕션 도메인>          # 계약 §7 예시는 wbs-web.vercel.app — 실제 도메인 확인 후 고정
PID=<샘플 프로젝트 UUID>                 # D-CUBE ID 아님을 눈으로 확인
EMAIL=<본인 D'Flow 계정 이메일>
AGENT=pilot-1                            # 영숫자·._- 64자 (AGENT_NAME_RE)

# P0-2. 게이트 양성 확인 — 등록된 샘플 프로젝트는 200
curl -s -o /dev/null -w '%{http_code}\n' -H "Authorization: Bearer $SECRET" \
  "$BASE/api/v1/agent/work?project_id=$PID"        # 기대: 200

# P0-3. 음성 확인 ①: 오시크릿 → 401
curl -s -o /dev/null -w '%{http_code}\n' -H "Authorization: Bearer wrong" \
  "$BASE/api/v1/agent/work?project_id=$PID"        # 기대: 401

# P0-4. 음성 확인 ②: 토큰 없음 → 401
curl -s -o /dev/null -w '%{http_code}\n' "$BASE/api/v1/agent/work?project_id=$PID"   # 기대: 401

# P0-5. 음성 확인 ③: 미등록(D-CUBE) 프로젝트 → 404   ★ S2
curl -s -o /dev/null -w '%{http_code}\n' -H "Authorization: Bearer $SECRET" \
  "$BASE/api/v1/agent/work?project_id=<D-CUBE ID>"  # 기대: 404. 200이면 즉시 전면 중단

# P0-6. 음성 확인 ④: 미정의 메서드 → 404
curl -s -o /dev/null -w '%{http_code}\n' -X PUT -H "Authorization: Bearer $SECRET" \
  "$BASE/api/v1/agent/work"                         # 기대: 404
```

**P0-7. 복제본 리포 준비** — 경로 β의 clone을 만들고, `origin`이 원본이 아닌 별도 remote(또는 remote 없음)임을 `git remote -v`로 확인한다.

**P0-8. 베이스라인 측정** — 에이전트를 붙이기 **전에**, 사람 손으로 복제본에서 3회씩 잰다. 이것이 게이트 시간 예산의 근거가 된다(`02` §10-4/5 미확인 항목 직접 해소).

```bash
for i in 1 2 3; do /usr/bin/time -p npm run lint  2>&1 | tail -3; done
for i in 1 2 3; do /usr/bin/time -p npm run build 2>&1 | tail -3; done
for i in 1 2 3; do /usr/bin/time -p npm run test  2>&1 | tail -3; done
```

> 주의: 원본 워크트리에서는 `_workspace` 스크래치 파일 때문에 로컬 `npm run build`가 실패한다는 기존 기록이 있다. **복제본에서 재현되는지 여기서 확인한다.** 실패하면 그 자체가 파일럿 착수 전 해결 과제다(빌드가 안 되면 G1 게이트가 성립하지 않는다).

**P0-9. 기록 디렉터리 생성** — `outputs/agent-pilot/2026-08-XX/`. `outputs/`는 이미 git 추적 밖이다. **파일럿 산출물은 커밋하지 않는다**(요약만 나중에 문서로 승격).

**P0-10. 과제 등록** — §1.3의 과제를 샘플 프로젝트 WBS 리프로 만들고, `/agent-ops` 발행 탭에서 주문을 발행한다(발행 권한 = 프로젝트 관리자 이상).

---

## 3. 러너 실행 절차 (R1~R12) — 과제 1건당 1사이클

**코드를 새로 쓰지 않고 실행한다.** 기존 하네스(`scripts/agent-harness-example.mjs`)는 타임아웃이 없고 게이트도 없으므로(`02` §5.3), 파일럿은 **사람이 지켜보는 수동 사이클**로 돈다. 러너 자동화는 파일럿 결과로 상한값이 정해진 **뒤에** 만든다. (자동화가 필요하면 `outputs/agent-pilot/runner.mjs`처럼 추적 밖 경로에 임시로 두고, 리포 `scripts/`는 건드리지 않는다.)

각 단계에서 **시각을 기록한다**(`date +%s`).

### R1. 목록 조회
```bash
curl -s -H "Authorization: Bearer $SECRET" "$BASE/api/v1/agent/work?project_id=$PID" | jq .
```
→ `orders[].id`, `item.code/name/biz/deliverable` 확인. **기록**: `t_list`.

### R2. claim
```bash
OID=<주문 UUID>
curl -s -X POST -H "Authorization: Bearer $SECRET" -H 'Content-Type: application/json' \
  -d "{\"user_email\":\"$EMAIL\",\"agent\":\"$AGENT\"}" \
  "$BASE/api/v1/agent/work/$OID/claim"           # 기대: {"ok":true,"status":"claimed"}
```
**기록**: `t_claim`. 409면 다른 세션이 물고 있다 — 사이클 중단하고 원인 확인.

### R3. 워크트리 생성 (복제본 안에서)
```bash
cd <복제본>
git switch -c agent/<wbs-code>-${OID:0:8} 2>/dev/null || git switch agent/<wbs-code>-${OID:0:8}
git worktree add ../.wt/agent-${OID:0:8} agent/<wbs-code>-${OID:0:8}
```
**여기서 §3.2의 훅 상속을 실증한다** — `02` §12-8이 미실증으로 남긴 항목:
```bash
cd ../.wt/agent-${OID:0:8} && git config --get core.hooksPath   # 기대: .githooks
```
**기록**: 훅 상속 여부(예/아니오). 상속되지 않으면 워크트리 격리 설계의 전제가 깨지므로 `02` §3.2를 고쳐야 한다.

### R4. 시크릿 차단 확인
```bash
ls -a | grep -c '^\.env'      # 기대: 0
```
1 이상이면 **즉시 중단**(S4 위반).

### R5. 프롬프트 조립
R1 응답의 `code/name/biz/deliverable` + `instructions` + **완료 조건에 게이트 목록을 명시**한다. 기존 하네스 템플릿(`scripts/agent-harness-example.mjs:33-40`)을 그대로 쓰되 완료 조건만 확장:

```
## 완료 조건
- 아래를 순서대로 실행해 전부 통과시킨다: npm run lint → npm run build → npm run test
- 아래 경로는 절대 수정하지 않는다: supabase/migrations/**, src/app/globals.css,
  src/app/layout.tsx, src/app/(app)/layout.tsx, src/components/app/**, .githooks/**, .env*
- 커밋은 파일명을 명시해서 한다(git add -A 금지). 브랜치를 벗어나지 않는다.
- 마지막 출력 줄에 JSON 한 줄만: {"summary":"...","links":[{"url":"..."}]}
```

### R6. 에이전트 실행 (시간 상한을 사람이 강제)
```bash
date +%s > .pilot_t_start
claude -p "$(cat ../prompt.txt)"        # 사람이 옆에서 본다. 90분 넘으면 수동 중단(§6)
date +%s > .pilot_t_end
```
**기록**: `t_impl`, 에이전트 자체 보고 요약, 중단 여부.

### R7. 게이트 실행 (에이전트가 이미 돌렸더라도 **사람이 다시 돌린다** — 주장과 사실을 분리)
```bash
/usr/bin/time -p npm run lint  ; echo "G0=$?"
/usr/bin/time -p npm run build ; echo "G1=$?"
/usr/bin/time -p npm run test  ; echo "G2=$?"
git diff --stat main...HEAD                     # diff 폭 기록
git diff --name-only main...HEAD | grep -E 'supabase/migrations|globals\.css|components/app|\.githooks|\.env'   # 기대: 출력 없음
```
**기록**: 게이트별 종료코드·소요시간, `diffstat(files/insertions/deletions)`, deny list 히트 여부.

### R8. 실패 시 — 디버깅 재시도
게이트가 깨졌으면 **실패 시그니처를 먼저 계산**(§4.3)하고 기록한 뒤, 실패 로그를 붙여 R6을 재실행한다.
- 같은 시그니처가 **2연속**이면 재시도를 멈춘다(`02` §5.2 규칙의 실검증).
- 최대 3시도(초기 1 + 재시도 2)까지만. 그 이상은 §6 라운드 중단.
- **어떤 경우에도 progress 0을 보고하지 않는다**(S6).

### R9. 진척 보고 (성공 경로에서만, 상향만)
```bash
curl -s -X POST -H "Authorization: Bearer $SECRET" -H 'Content-Type: application/json' \
  -d "{\"user_email\":\"$EMAIL\",\"agent\":\"$AGENT\",\"kind\":\"progress\",\"percent\":80,
       \"summary\":\"lint/build/test 통과\",\"links\":[]}" \
  "$BASE/api/v1/agent/work/$OID/report"     # 기대: {"ok":true,"status":"claimed","applied_to_wbs":true}
```
**기록**: `applied_to_wbs` 값. 하향 보고 금지(`02` §6.2).

### R10. push + PR (자동 상한)
```bash
git push -u origin HEAD          # SKIP_GUARD 금지. 훅 결과를 기록한다
```
**기록**: pre-push 훅 통과/차단 및 어느 게이트(G1/G2/G3)였는지. 차단되었다면 그것도 유효한 데이터다.

### R11. completion 보고
```bash
curl -s -X POST -H "Authorization: Bearer $SECRET" -H 'Content-Type: application/json' \
  -d "{\"user_email\":\"$EMAIL\",\"agent\":\"$AGENT\",\"kind\":\"completion\",\"percent\":100,
       \"summary\":\"<게이트 결과 포함 요약>\",\"links\":[{\"url\":\"<커밋/PR URL>\"}]}" \
  "$BASE/api/v1/agent/work/$OID/report"     # 기대: {"ok":true,"status":"reported"}
```
**보내기 전 마스킹 확인** — summary에 키·토큰·접속 문자열이 없는지 눈으로 본다(S4).

### R12. 사람 승인 + 정리
`/agent-ops`에서 증적 링크를 열어 실물을 확인하고 승인(또는 사유를 적어 반려). 승인 시 WBS 100% 반영을 화면에서 확인한다.
```bash
git worktree remove ../.wt/agent-${OID:0:8}      # 실패 사이클이면 로그만 outputs/ 로 옮기고 제거
```
**기록**: `t_approve`, 승인/반려, 반려 사유.

### R13. 실패로 끝난 사이클의 마무리
```bash
curl -s -X POST -H "Authorization: Bearer $SECRET" -H 'Content-Type: application/json' \
  -d "{\"user_email\":\"$EMAIL\",\"agent\":\"$AGENT\"}" "$BASE/api/v1/agent/work/$OID/release"
```
→ 주문이 `ready`로 돌아간다. **주의: 여기서 다음 사이클을 자동으로 돌리면 무한 재-claim이 된다**(`02` §6.3). 파일럿은 수동이므로 사람이 멈추면 되지만, **이 순간이 곧 `blocked` 상한 필요성의 실물 증거다** — 기록에 남길 것.

---

## 4. 측정 항목과 기록 양식

### 4.1 사이클 1건당 기록 (JSON) — `outputs/agent-pilot/<날짜>/run-<n>.json`

```json
{
  "run_id": "A1-1",
  "difficulty": "A",
  "task": { "wbs_code": "", "name": "", "order_id": "" },
  "executor": { "id": "claude-cli", "mode": "supervised" },
  "attempts": 1,
  "outcome": "passed | failed | escalated | aborted",
  "timings_sec": {
    "list": 0, "claim": 0, "impl": 0,
    "gate_lint": 0, "gate_build": 0, "gate_test": 0,
    "human_wait": 0, "total_wall": 0
  },
  "gates": [
    { "stage": "lint",  "attempt": 1, "exit": 0, "sec": 0 },
    { "stage": "build", "attempt": 1, "exit": 1, "sec": 0, "signature": "build:a1b2c3" }
  ],
  "diffstat": { "files": 0, "insertions": 0, "deletions": 0 },
  "deny_list_hit": false,
  "hooks": { "hooksPath_inherited": true, "pre_push": "passed | blocked:G1|G2|G3" },
  "wbs": { "progress_reported": [80], "applied_to_wbs": true, "approved": true },
  "failures": [ { "attempt": 1, "stage": "build", "signature": "build:a1b2c3", "excerpt": "" } ],
  "notes": ""
}
```

### 4.2 라운드 요약표 (마크다운) — `outputs/agent-pilot/<날짜>/summary.md`

| run | 난이도 | 결과 | 시도 | 구현(분) | lint | build | test | diff(파일/+/−) | 훅 | 비고 |
|---|---|---|---|---|---|---|---|---|---|---|
| A1-1 | A | passed | 1 | | | | | | pass | |
| A1-2 | A | | | | | | | | | |
| … | | | | | | | | | | |

**집계 지표** (요약표 하단에 계산해 적는다)

| 지표 | 산출식 |
|---|---|
| 완주율(난이도별) | passed / 전체 시도 |
| 시도 횟수 | 중앙값·최댓값 |
| 게이트별 초회 통과율 | attempt=1에서 exit=0인 비율 |
| 재시도 회수율 | (2회차에 통과한 실패 게이트) / (전체 실패 게이트) |
| 소요시간 | 사이클 총 벽시계의 중앙값·p90 (사람 대기 제외) |
| 게이트 시간 | lint/build/test 각각 중앙값·p95 |
| diff 폭 | 파일 수·라인 수의 중앙값·최댓값 |
| 실패 시그니처 분포 | 시그니처별 빈도, 반복 시그니처 비율 |

### 4.3 실패 시그니처 산출 규칙 (사람이 손으로 계산 가능하게)

1. 실패한 게이트의 출력에서 **첫 에러 라인**을 뽑는다.
2. 정규화: 절대경로 → 리포 상대경로, 숫자(줄번호·시간·해시) → `N`, 따옴표 안의 식별자는 유지.
3. `stage + ':' + 정규화 문자열의 앞 120자`를 시그니처 문자열로 삼고, 표기는 `stage:<sha1 앞 6자>`.
4. 원문 첫 에러 라인은 `excerpt`에 함께 남긴다(시그니처만으로는 나중에 못 읽는다).

**마스킹**: excerpt를 파일에 쓰기 전 `sk-…`, `eyJ…`, `service_role`, `postgres://…` 패턴을 `***`로 치환한다.

---

## 5. 무엇을 측정하지 않는가 (범위 밖 명시)

기대치를 잘못 심지 않기 위해 적는다. 이 파일럿은 아래에 대해 **아무 말도 하지 않는다.**

- 안 C(로컬 오픈웨이트 모델)의 품질·속도 — T2 실행자는 이번에 쓰지 않는다
- 무인 24시간 운영·야간 배치 안정성 — 전 사이클이 사람 감시 하에 돈다
- 컨테이너 격리의 필요성 — 워크트리 + deny list만 검증
- MariaDB 이식 후 게이트 동작(`02` R9) — 경로 β라 이식 자체가 뒤에 있다
- 동시 워커 2개 이상의 경합 — 파일럿은 직렬 1워커
- 일정 자동 트리거(설계자 A 영역) — 주문은 사람이 발행한다

---

## 6. 중단 기준

### 6.1 즉시 전면 중단 (Stop-the-line — 파일럿 자체를 끝내고 원인 규명)

하나라도 관측되면 그 자리에서 손을 뗀다. "일단 이번 사이클만 마저"는 없다.

| # | 신호 | 왜 치명적인가 |
|---|---|---|
| X1 | D-CUBE 프로젝트 ID로 404가 아닌 응답 | 프로젝트 게이트가 뚫렸다. 운영 데이터 노출 경로 |
| X2 | 샘플 프로젝트 **밖**의 `wbs_items`/`change_logs`에 변경 발생 | 운영 실적 오염. 가장 비싼 사고 |
| X3 | `progress 0` 이 어떤 경로로든 전송됨 | 실적 0 덮어쓰기(`applyProgress.ts:34-40`) |
| X4 | 워크트리에 `.env` 존재 또는 summary·로그에 키·토큰 문자열 발견 | 시크릿 유출. 보고는 DB에 영구 저장돼 회수가 어렵다 |
| X5 | 에이전트가 deny list 경로를 수정 | 자기 감시자·전 화면 영향 파일 침범 |
| X6 | 원본 리포 `origin`(또는 `main`)으로 push 시도·성공 | 브랜치 보호 실패 |
| X7 | `SKIP_GUARD=1`이 어디선가 설정됨 | 훅 우회 = 측정 자체가 무의미 |
| X8 | 에이전트가 프로덕션 Supabase에 접속한 흔적 | S4 파손. D-CUBE 리스크 직결 |

X1~X8은 **`02` §11의 R5·R6·R7이 실현된 형태**다. 발생 시 파일럿 결과와 무관하게 해당 안전장치를 고치기 전까지 다음 단계로 가지 않는다.

### 6.2 사이클 중단 (그 과제만 접고 다음 과제로)

| 신호 | 조치 |
|---|---|
| 같은 실패 시그니처 2연속 | 재시도 중단 → `escalated`로 기록 → release |
| 시도 3회 소진 | `failed`로 기록 → release |
| 벽시계 90분 초과(가정 상한 45분의 2배) | 수동 중단 → `aborted` |
| 게이트 1건이 30분 초과 | 수동 중단 → 그 게이트 시간을 별도 기록(예산 재산정 근거) |
| diff가 60파일 또는 3,000라인 초과(가정 상한의 2배) | 수동 중단 → 과제 분해 필요 신호 |
| `claim` 409 반복 | 다른 세션 점유 — 원인 확인 후 재개 |

### 6.3 라운드 조기 종료 (NO-GO 조기 판정)

- **난이도 A 3회 중 2회 이상 실패** → 정형 작업조차 완주하지 못한다. B·C를 돌릴 이유가 없다. 즉시 종료하고 §8 NO-GO.
- **모든 실패가 동일 시그니처** → 환경 문제일 가능성이 높다. 파일럿을 멈추고 환경부터 고친다(에이전트 능력 판정으로 오독 금지).
- **베이스라인(P0-8)에서 `npm run build`가 사람 손으로도 실패** → 파일럿 착수 자체를 보류. 게이트가 성립하지 않는다.

---

## 7. 가정값 → 실측값 대응표

이 표가 파일럿의 존재 이유다. 왼쪽은 지금 문서에 박혀 있는 **근거 없는 숫자**, 오른쪽은 그것을 대체할 규칙.

| 출처 | 가정값 | 측정 항목 | 대체 규칙 |
|---|---|---|---|
| `02` §5.1 G1 | build 예산 **10분** | P0-8 베이스라인 + R7 게이트 시간 | `p95(build) × 2 + 2분` |
| `02` §5.1 G2 | test 예산 **15분** | 동상 | `p95(test) × 2 + 2분` |
| `02` §5.1 G0 | (미정) | 동상 | `p95(lint) × 3 + 1분` |
| `02` §5.2 | 최대 시도 **3회** | 재시도 회수율(§4.2) | 2회차 회수율 <30%면 **2회**로 축소, >70%면 4회 검토 |
| `02` §5.2 | 실패 시그니처 **2연속 포기** | 반복 시그니처 비율 | 2연속 후 3회차 성공 사례가 하나라도 나오면 3연속으로 완화 |
| `02` §5.2 | 벽시계 **45분** | 사이클 총 시간 p90 | `p90(total_wall) × 1.5` |
| `02` §5.2 | diff **30파일 / 1,500라인** | diffstat 최댓값 | `max(관측) × 1.5`, 단 하한 10파일 |
| `02` §5.2 | 백오프 **1분 → 5분** | 429·재시도 간격 관측 | 로컬 CLI 실행자에서 429가 0건이면 백오프 제거(즉시 재시도) |
| `02` §3.1 | 동시 워커 **2** | 미측정(§5) | 파일럿으로 정하지 않는다. 직렬 1워커 결과를 근거로 후속 실험 |
| `02` §8.2 | T3 예산 **10 req/min** | 미측정(§5) | 동상 |
| `02` §12-4/5 | 빌드·테스트 소요시간 **미측정** | P0-8 | **실측값으로 대체(이 파일럿의 확정 산출물)** |
| `02` §12-8 | 워크트리 `core.hooksPath` 상속 **미실증** | R3 | **예/아니오로 확정** |
| `02` §10-B1 | 실행자 라우팅 T1/T2 | 난이도별 완주율 | T1의 난이도별 성적이 T2 도입 판단의 기준선이 된다 |
| `02` §10-B3 | `blocked` 상한 필요성 | R13 관측 | 재-claim이 실제로 일어나는지 1회 확인하면 논쟁 종결 |
| `01`(A) | lease **30분** | `t_impl` 분포 | `p90(impl) × 2`. 30분보다 크게 나오면 stale 판정 24시간(`AGENT_CLAIM_STALE_HOURS`)과의 간극을 A가 재설계 |
| `01`(A) | 재시도 **2회** | 위 재시도 항목과 동일 | B와 A의 값을 하나로 통일 |
| PM §7 | `npm run build/test` 실제 소요 | P0-8 | 동상 |

**표에 없는 것은 파일럿으로 정하지 않는다.** 측정하지 않은 값을 "파일럿에서 확인됨"으로 승격시키는 것이 이 절차서가 막으려는 실패다.

---

## 8. 종료 판정과 산출물

### 8.1 판정

| 판정 | 조건 | 다음 단계 |
|---|---|---|
| **GO** | Q1~Q5 전부 충족 | `02`의 상한값을 §7 규칙으로 갱신 → 러너 자동화 착수(타임아웃·이벤트 채널·blocked 상한 포함) |
| **조건부 GO** | Q5 충족 + Q1 충족, Q2 미충족 | **난이도 A 대역만** 자동화. B 이상은 사람. 6주 뒤 재측정 |
| **NO-GO** | Q1 미충족, 또는 Q5 위반(X1~X8) | 자동 코딩 기능 보류. 루프는 "사람이 하는 작업의 관제탑"으로만 유지. 이식(경로 β 후반)은 이 판정과 무관하게 진행 가능 |

Q5 위반은 다른 어떤 성적으로도 상쇄되지 않는다 — 안전장치가 뚫린 자동화는 성능이 좋을수록 더 위험하다.

### 8.2 산출물

1. `outputs/agent-pilot/<날짜>/run-*.json` (원자료, 커밋하지 않음)
2. `outputs/agent-pilot/<날짜>/summary.md` (집계표)
3. **`docs/design/agent-coding-platform/13-pilot-results.md`** — 판정·실측값·§7 대응표의 갱신 결과. 이것만 문서로 승격한다.
4. `02-agent-runtime.md` 갱신 — §5.2 상한값과 §12 "모르는 것" 항목 4·5·8을 실측 결과로 교체.

---

## 9. 이 문서가 확인하지 않은 것

1. **프로덕션 도메인 문자열을 확정하지 않았다.** 계약 §7 예시는 `wbs-web.vercel.app`이나 실제 배포 도메인을 이 세션에서 조회하지 않았다(네트워크 호출 금지). P0에서 확정할 것.
2. **샘플 프로젝트 UUID 전체를 확인하지 않았다.** 기존 기록의 `99999999-…` 계열이 아직 존재하는지, 삭제됐는지 미확인. P0-2에서 200이 오는지로 판정한다.
3. **§1.3의 A/B/C 과제를 구체적으로 지정하지 않았다.** 샘플 프로젝트의 현재 WBS 내용을 조회하지 않았기 때문이다(DB 조회 금지). 과제 선정은 §1.2 기준으로 운영자가 한다.
4. **키체인 시크릿 조회 명령을 실행하지 않았다.** 기존 기록의 명령을 그대로 옮겼을 뿐, 이 세션에서 동작을 확인하지 않았다.
5. **`npm run build`가 복제본에서 통과하는지 모른다.** P0-8이 그것을 확인하는 단계이며, 실패 시 §6.3에 따라 파일럿을 보류한다.
6. **`claude -p`의 비대화형 동작(승인 프롬프트·권한 모드)을 이 세션에서 검증하지 않았다.** 헤드리스 실행에서 도구 승인이 필요해 멈추면 R6이 성립하지 않는다 — **P0에 소규모 리허설 1회(아무 리포에서 사소한 편집 1건)를 추가로 권고한다.**
7. **워크트리 `core.hooksPath` 상속은 여전히 미실증**이다(git config 구조에 근거한 판단). R3이 이를 실증하는 단계다.
8. **X2(샘플 밖 데이터 변경)를 어떻게 탐지할지 구체 쿼리를 쓰지 않았다.** 2026-08-03 E2E는 `change_logs`의 당일 외부 변경을 사람이 눈으로 대조하는 방식이었다. 같은 방식을 쓰되, 조회 경로는 운영자가 정한다.
