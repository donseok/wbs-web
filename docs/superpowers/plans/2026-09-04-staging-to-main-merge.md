# staging → main 머지 실행 계획 (102 커밋 · 마이그레이션 3건)

> **For agentic workers:** 이 문서는 **재조사 없이 곧바로 실행**하도록 쓰였다. §2 「확정 사실」은 2026-09-04 실측이며 재도출하지 말 것. 다만 §1 의 신선도 검사를 먼저 돌려 원격·DB 가 그때와 같은지 확인하고, 다르면 달라진 항목만 다시 본다. 단계는 체크박스(`- [ ]`)로 추적한다.

**Goal:** `origin/staging`(7fa4364)에 쌓인 102 커밋을 `main` 으로 올려 운영 배포하되, **DB(0089·0090·0092)를 코드보다 먼저 적용**해 운영 화면·에이전트 API 가 깨지지 않게 한다.

**상태 (2026-09-04 11:30 KST):** 배포 완료 — E3 눈확인·E4 mark:good 만 남음(사용자).
- 머지 커밋 `a15d3dc`(부모 `4e107c3`·`7fa4364`) + 리허설 기록 `4d93838` → `origin/main` push, Vercel 운영 Ready(11:09:46 KST, 빌드 2분)
- DB: 0092 스테이징 적용(대상 3→0, change_logs 3) · 운영 0089→0090→0092 적용 — 컬럼 5·RPC 3인자·PostgREST 캐시 REST 200
- 운영 실측: `npm run smoke:prod` 통과 · `GET /api/v1/wbs/structure?project_id=<MES>` 가 **200 + level_idx 포함**(새 코드+새 컬럼+캐시 end-to-end) · `/api/import/template` 401(새 라우트 존재)
- 롤백 재료: `outputs/0092-staging-before.json`, `outputs/0089-prod-before.json`
- staging 은 `push main:staging` 으로 main 과 동일하게 맞춤(E5)
- §5 눈확인(E3) 은 2026-09-04 에이전트가 macOS Chrome(로그인 세션)으로 수행 — 비컴팩트·모바일 폭만 미확인
- **남은 것:** `npm run mark:good`(E4, 사용자 승인) · §7 사용자 결정 2건 · §6 버그 후속 커밋

**근거:** 2026-09-04 6관점 병렬 감사(에이전트 93개 · 발견 43건 · 반박 검증에서 뒤집힌 것 0건) + Supabase Management API 읽기 전용 실측. 핵심 결론만 이 문서에 옮겼고 원본 워크플로 출력은 세션 스크래치에 있어 휘발된다.

---

## 1. 시작 전 신선도 검사 (필수)

이 문서의 전제가 아직 유효한지 확인한다. **하나라도 다르면 그 항목의 결론을 다시 세운 뒤 진행한다.**

```bash
cd /Users/jerry/wbs-web
git fetch origin --prune --tags
for r in origin/main origin/staging HEAD; do printf '%-16s %s\n' "$r" "$(git rev-parse --short $r)"; done
#   origin/staging 기대: 7fa4364  ← 다르면 staging 에 새 작업이 올라온 것. §2 를 다시 볼 것
#   origin/main 은 SHA 를 고정하지 않는다(이 계획서 자체가 main 에 커밋되며 바뀐다). 아래로 검사한다.
#   (주의: `git rev-parse --short a b` 는 이 git 에서 "Needed a single revision" 으로 죽는다. 위 루프를 쓸 것)

git log --oneline origin/main..origin/staging | wc -l   # 기대: 102 (staging 에만 있는 것)

# main 에만 있는 커밋 — 이 계획서 관련 docs 커밋뿐이어야 한다.
# 코드·마이그레이션 커밋이 섞여 있으면 그 사이 누군가 main 에 직접 올린 것이므로 §2·§4 를 다시 판정할 것.
git log --oneline origin/staging..origin/main
git diff --name-only $(git merge-base origin/main origin/staging) origin/main
#   기대: docs/superpowers/plans/2026-09-04-staging-to-main-merge.md 한 줄뿐
#   (`git diff origin/staging origin/main` 은 양방향 차이라 144 파일이 나온다 — 쓰지 말 것)

git merge-tree --write-tree origin/main origin/staging >/dev/null && echo "충돌 없음"
git status -sb | head -3                                 # 로컬 dirty 파일이 머지 대상과 겹치는지
```

`c036d0e`(태그 `good-20260903-1353`)가 감사 시점의 main 앵커다. `git merge-base origin/main origin/staging` 이 여전히 `c036d0e` 를 가리키면 이 문서의 판정은 전부 유효하다.

DB 상태 재확인은 §4 의 검증 스크립트를 `--dry` 감각으로 그대로 쓰면 된다(읽기 전용).
`wbs_items` 에 `agent_prompt` 가 **이미 있으면** 0090 은 누군가 적용한 것이므로 §3 의 해당 단계를 건너뛴다.

---

## 2. 확정 사실 (재조사 금지)

### 2.1 git

| 항목 | 값 |
|---|---|
| `origin/main` | `c036d0e`(태그 `good-20260903-1353`) + **이 계획서 docs 커밋**. SHA 는 문서 수정마다 바뀌므로 고정하지 않는다 |
| 머지 베이스 | `c036d0e` — `git merge-base origin/main origin/staging` 가 이걸 가리키면 이 문서의 판정은 유효하다 |
| `origin/staging` | `7fa4364` (2026-09-03 13:50:12, `Merge branch 'fix/wiki-fnv1a64-linear' into staging`) |
| 로컬 `main` | origin/main 과 동일하게 맞춰둠(2026-09-04 정리 완료) |
| 로컬 `staging` | `29a7089` — origin/staging 보다 **442 뒤**, 그리고 `c036d0e` 의 조상 |
| 범위 | main→staging **102 커밋** / 144 파일 / +10,745 −2,405 |
| 반대 방향 | main 에만 있는 커밋은 **이 계획서 docs 커밋들뿐** — 앱 코드·마이그레이션은 0건 |
| 충돌 | **없음** — `git merge-tree` 로 확인. staging 은 이 문서 파일을 건드리지 않는다 |

> 감사 당시(`c036d0e`)에는 main 이 staging 의 조상이라 순수 fast-forward 였다. 이 계획서를 main 에 커밋하면서 반대 방향 1건이 생겨 **진짜 머지**가 됐지만, docs 전용 파일이라 충돌은 없고 `--no-ff` 권고(§3 A3)는 어차피 그대로다.

**함정:** 로컬 `staging` 이 442 뒤처져 있어 runbook §2 를 문자 그대로(`git switch main && git merge staging`) 따르면 main 이 1커밋 ff 되는 데 그치고 **102 커밋이 하나도 들어가지 않는다.** 반드시 `origin/staging` 을 직접 머지한다.

- 머지 커밋 28건 중 충돌 해소가 실제로 있었던 것 6건은 전부 정상 조합으로 확인했다. 특히 `76163b0` 은 main 의 `pinned` 슬롯과 staging 의 `flush` prop 을 **둘 다** 보존했다(어느 쪽도 유실 없음).
- `7fa4364` 는 `c036d0e` 의 순수 머지다 — 메시지의 `fix/wiki-fnv1a64-linear` 는 로컬 브랜치 라벨일 뿐 0093 은 main 경유로 정상 유입됐다.
- 삭제 8파일(`/agent-ops` 화면·구 dflow-work 문서)에 대한 잔여 import 0건.
- 스테이징 Vercel 최신 Ready 배포(9/3 13:50:17)가 **팁 커밋 7fa4364 그 자체**다 → 스테이징에서 도는 코드 = 머지될 코드.
- 스테이징 팁에서 `vitest run` 440 파일 / **5,096 테스트 전부 통과**.
- pre-push 훅 드라이런(staging 팁 → main) **exit 0 통과**.

### 2.2 운영 DB (`rglfgrwwwwdqejohdnty`) 2026-09-04 실측

| 사실 | 값 | 의미 |
|---|---|---|
| `wbs_items` 의 `agent_prompt`·`level_idx`·`milestone`·`credit_key`·`if_id` | **전부 없음** | 0089·0090 **미적용** ← 이번 작업의 핵심 |
| `import_wbs_upsert` | 2인자 (`p_project_id, p_nodes`) | 0089 가 3인자로 교체 예정 |
| `stage` 가 채워진 행 | **0건** | 0092 는 운영에서 **완전 no-op** |
| `change_logs` 시각 컬럼 | `at` 만 (`created_at` 없음) | §6 버그의 근거 |
| `dev_workflow = true` 행 | 28건 | 기존 상태 |
| `tags` 에 `agent` 붙은 행 | **0건** | 배포만으로 자동 발행 없음 |
| `depends` 채워진 행 | **27건** — 전부 `MES 공통 개발`(`5a2e12b2-d3c0-489b-b270-1999e27f80f2`) | §5 표시 변화 대상 |
| `agent_projects` | 1건(같은 MES 프로젝트, enabled) | |
| 살아있는 PAT | 1개 — `개발`, scopes `work:read/claim/report`, MES 프로젝트, 2027-02-10 만료 | §7 권한 변화 대상 |
| 0091·0093 | 적용됨 | main 쪽 마이그레이션은 이미 반영 |

### 2.3 스테이징 DB (`abtyahghvvkcriawffty`)

0089·0090·0091·0093 적용됨. **0092 미적용**(상위 항목에 stage 찍힌 대상 3건 존재 → 리허설 재료가 이미 있다).

---

## 3. 실행 절차

### Phase A — 로컬 머지 (push 없음, 되돌리기 쉬움)

- [x] A1. `cd /Users/jerry/wbs-web && git fetch origin --prune --tags`
- [x] A2. `git switch main && git merge --ff-only origin/main` (2026-09-04 시점엔 이미 같아서 "Already up to date" 가 정상)
- [x] A3. 머지 — **`origin/staging` 을 직접**, `--no-ff` 로:
  ```bash
  git merge --no-ff origin/staging \
    -m "merge: staging → main — N단 임포트 v2.2·에이전트 프롬프트·의존성 그래프·리프 단계 정리 (0089·0090·0092)"
  ```
- [x] A4. 검산 — 머지 후 트리가 `origin/staging` 과 **이 계획서 파일 하나만** 달라야 한다:
  ```bash
  git diff --name-only origin/staging HEAD
  #   기대 출력: docs/superpowers/plans/2026-09-04-staging-to-main-merge.md  (이 한 줄뿐)
  #   다른 파일이 나오면 머지가 무언가를 빠뜨렸거나 덧붙인 것 — 멈추고 원인을 볼 것
  git log --oneline --first-parent -2
  ```

**`--no-ff` 를 쓰는 이유:** 과거 staging→main 은 전부 ff 였지만 이번은 102 커밋에 머지 커밋만 28개다. ff 로 올리면 되돌릴 단위가 없어 `runbook-rollback` §3(b) 트리 복원(그 사이 병렬 세션 커밋까지 날린다)뿐이지만, `--no-ff` 면 `git revert -m 1 <머지sha>` 한 번으로 이 범위만 정확히 되돌린다. 훅은 양쪽 다 통과한다(G1·G2 는 `--no-merges` 로 머지 커밋을 제외하고 evil merge 만 보는데 충돌 없는 머지는 `diff-tree --cc` 가 빈다).

> ⚠️ 머지 revert 후 staging 을 다시 머지하면 revert 를 한 번 더 revert 하기 전엔 변경이 돌아오지 않는다(git 특성).

**여기서 멈춘다. 아직 push 하지 않는다.**

### Phase B — 0092 스테이징 리허설

0092 는 리허설 기록이 없는데 **G4 훅이 잡지 못한다** — push 범위에 0089(`5d9b564`)·0090(`fe47c6d`) 트레일러가 이미 있어 범위 단위 검사를 통과해버린다. 사람이 챙겨야 한다.

- [x] B1. **`staging:sync` 를 돌리지 않는다.** `scripts/staging-sync.mjs:99` 가 `drop schema public cascade` 후 운영 덤프를 복원하므로, 지금 sync 하면 스테이징의 0089·0090 컬럼이 사라져 스테이징 앱이 깨진다. 현재 스테이징에 대상 3행이 이미 있어 리허설 재료로 충분하다.
- [x] B2. `npm run db:apply -- supabase/migrations/0092_clear_nonleaf_stage.sql --target staging`
- [x] B3. 검증 — 대상 0건이 되고 `change_logs` 에 복원용 기록 3건이 생겼는지:
      `select count(*) from wbs_items w where w.stage is not null and exists (select 1 from wbs_items c where c.parent_id = w.id);` → 0
      `select count(*) from change_logs where field='stage' and user_id is null and new_value is null;` → 3
- [x] B4. 트레일러 커밋:
  ```bash
  git commit --allow-empty -m "chore(db): 0092 스테이징 리허설 완료 기록" \
    --trailer "Staging-verified: $(date +%F) db 리허설 통과"
  ```

### Phase C — 운영 DB 적용 (**사용자가 직접**)

`db:apply --target prod` 는 확인 프롬프트에 운영 ref `rglfgrwwwwdqejohdnty` 를 손으로 입력해야 진행된다(`--yes` 무시). 에이전트가 대신할 수 없다.

- [x] C1. `npm run db:apply -- supabase/migrations/0089_wbs_nlevel_import.sql --target prod`
- [x] C2. `npm run db:apply -- supabase/migrations/0090_wbs_agent_prompt.sql --target prod`
- [x] C3. `npm run db:apply -- supabase/migrations/0092_clear_nonleaf_stage.sql --target prod` (운영 대상 0건 — 원장 정합용)

**0089 는 `drop function if exists public.import_wbs_upsert(uuid, jsonb)` 후 3인자로 재생성한다.** 세 번째 인자에 `default null` 이 있어 현재 운영 코드의 2인자 호출이 그대로 해석되므로, DB 를 먼저 적용해도 **현재 배포된 코드는 깨지지 않는다.**

> 적용 전 안전장치: `select prosrc from pg_proc where proname='import_wbs_upsert';` 원문을 outputs/ 에 저장해 두면 되돌릴 재료가 된다.

### Phase D — 검증 (push 직전)

- [x] D1. 스키마 실측 — 아래 스크립트를 스크래치에 쓰고 실행(읽기 전용):

```javascript
// scratch/verify-prod.mjs — 읽기 전용
import { execFileSync } from 'node:child_process'
import { PROD_REF } from '/Users/jerry/wbs-web/scripts/lib/staging.config.mjs'
const raw = execFileSync('security', ['find-generic-password','-s','Supabase CLI','-a','supabase','-w'],
  { encoding:'utf8', stdio:['ignore','pipe','ignore'] }).trim()
const token = raw.startsWith('go-keyring-base64:')
  ? Buffer.from(raw.slice('go-keyring-base64:'.length),'base64').toString() : raw
const q = async sql => {
  const r = await fetch(`https://api.supabase.com/v1/projects/${PROD_REF}/database/query`, {
    method:'POST', headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},
    body:JSON.stringify({query:sql}) })
  if (!r.ok) throw new Error(await r.text()); return r.json() }
console.log('컬럼5(기대 5행):', await q(`select column_name from information_schema.columns
  where table_schema='public' and table_name='wbs_items'
    and column_name in ('agent_prompt','level_idx','milestone','credit_key','if_id') order by 1`))
console.log('RPC(기대 3인자 1개):', await q(`select pg_get_function_identity_arguments(oid) as args
  from pg_proc where proname='import_wbs_upsert'`))
console.log('0092 잔여(기대 0):', await q(`select count(*)::int as n from wbs_items w
  where w.stage is not null and exists (select 1 from wbs_items c where c.parent_id=w.id)`))
```

- [x] D2. **PostgREST 스키마 캐시 확인** — `information_schema` 통과만으로는 부족하다. 이 프로젝트는 DDL 이 DB 에 들어간 뒤에도 캐시가 낡아 앱이 죽은 전례가 둘 있다(0038 `llm_config`, 0021 minutes). 캐시가 낡으면 **증상이 미적용과 똑같다.** REST 층을 직접 두드린다:

```bash
ANON=$(grep -m1 NEXT_PUBLIC_SUPABASE_ANON_KEY /Users/jerry/wbs-web/.env.local | cut -d= -f2-)
curl -s -o /dev/null -w '컬럼 REST: %{http_code}\n' -H "apikey: $ANON" \
  "https://rglfgrwwwwdqejohdnty.supabase.co/rest/v1/wbs_items?select=agent_prompt,level_idx,milestone,credit_key,if_id&limit=1"
# 200 이어야 한다(RLS 로 [] 여도 200). 400 이면 캐시 미갱신.
```

낡았으면 Management API 로 `notify pgrst, 'reload schema';` 를 한 번 쏘고 재확인한다.

- [x] D3. 위 셋이 전부 통과한 **뒤에만** push.

### Phase E — 배포

- [x] E1. `git push origin main` (Vercel 자동 배포. `vercel --prod` 는 쓰지 않는다)
- [x] E2. `npm run smoke:prod`
- [x] E3. 눈확인 — §5 목록
- [ ] E4. `npm run mark:good`
- [x] E5. staging back-merge: `git switch staging && git merge --ff-only origin/staging && git merge --ff-only origin/main && git push origin staging`
      (`--no-ff` 머지 커밋의 부모가 7fa4364 라 ff 된다)

---

## 4. 왜 순서가 이런가 — 코드 선배포 시 깨지는 것

운영에 0089·0090 이 없는 상태로 코드가 먼저 나가면, PostgREST 가 없는 컬럼 select 를 **요청 전체 400** 으로 거부하기 때문에:

| 깨지는 곳 | 근거 | 증상 |
|---|---|---|
| WBS 상세 **명세 패널 (전 프로젝트)** | `src/app/actions/wbsSpec.ts:83` 이 `agent_prompt` 를 조건 없이 select → null 반환 → `WbsSpecPanel.tsx:75-78` 이 `'error'` | "명세를 불러오지 못했습니다" 만 표시. 명세 편집·위임 토글·프롬프트 입력 전부 도달 불가 |
| 에이전트 **claim / 상세 API** | `src/lib/agent/depends.ts:20` `ITEM_DETAIL_COLUMNS` 에 `agent_prompt` | 500 (fail-closed). `/dflow-dev`·`/dflow-poll` 이 아무 작업도 착수 못 함 |
| `GET /api/v1/wbs/structure` | `route.ts:53` 이 `level_idx` select | 500 |
| **WBS 업로드** | `runWbsImport` 가 attach 있을 때만 3인자 호출 | 골격 업로드는 **200 인데 v2.2 필드를 조용히 버린다**(나중에 DB 만 고쳐도 백필 안 됨 — 재업로드 필요) · PL 업로드는 PGRST202 |

담당·단계 섹션과 승인/반려(`WbsAgentOrderStatus`)는 별도 로더라 살아남는다.

**반대 방향(DB 먼저)은 안전하다** — 0089·0090 은 전부 nullable 컬럼 추가에 DML 이 없고, 현재 운영 코드는 새 컬럼을 어디서도 읽지 않으며, 2인자 RPC 호출은 default 인자로 3인자 함수에 해석된다.

**DB 적용 ~ 코드 배포 사이 창에서는 WBS 업로드(API·마법사 wbs.md 모드)를 하지 않는다.** 0089 가 `weight = excluded.weight` 를 추가해 weight 를 '파일 소유' 필드로 바꾸므로, 구 코드가 재업로드하면 웹에서 조정한 가중치가 null(균등)로 덮인다. 운영에는 해당 행이 0건이라 지금은 무해하지만 창을 짧게 유지하는 편이 낫다.

---

## 5. 배포 후 눈으로 볼 것

`npm run smoke:prod` 는 `/login` 과 CSS 전달 무결성만 본다. 이번 변경의 급소는 전부 로그인 뒤에 있다.

- [x] WBS 그리드 → 행 클릭 → 상세 패널 **명세** 펼침 (0090 확인의 실화면) — 2026-09-04 브라우저 확인: '명세 없음·PRD 참조 미지정·수용 기준 없음' + 편집 버튼 정상(실패 문구 아님)
- [x] **`MES 공통 개발` 프로젝트 간트** — 확인: 의존선은 hover 시에만 주황 화살표로 표시(3→4→6→9, 9→13→15 연결 실측), 평소엔 숨김 — — `depends` 27행이 이제 의존성으로 합성되어 연결선·크리티컬 패스·지연 표시가 달라진다. D-CUBE 는 `depends` 가 없어 무관
- [x] WBS 간트 하단 여백(컴팩트 1568×639 만 확인 — 마지막 행이 스크롤바에 바로 붙음, 죽은 공간 없음; **비컴팩트·모바일 폭은 이 기기 화면 한계로 미확인**) (`flush` prop + `(app)/layout.tsx` 패딩 축소) — 랩탑·모바일 폭 둘 다
- [x] 위키 검색 카드가 컴팩트 뷰포트에서 살아 있는지 — 확인: 검색창·칩·질문하기 전부 표시 (`pinned` 슬롯이 머지에서 보존됐음을 확인했지만 실화면 재확인)
- [x] 사이드바·헤더 — 대시보드·WBS·위키 3화면에서 정상 (UI 위험 파일 4개 변경 — 빌드·테스트로 안 잡히는 종류)
- [x] 간트 의존선이 **hover 전용**으로 바뀌고 툴바의 '작업 의존성 N'·크리티컬·지연 요약 칩이 사라진 것 (의도된 변경)

---

## 6. 머지와 함께 들어오는 알려진 결함 (차단 사유는 아님 · 후속 커밋)

**승인 되감기의 실적 복원이 항상 실패한다.** `src/app/actions/agentWork.ts:313-316` 이 `change_logs` 를 `.gte('created_at', reviewedAt).order('created_at')` 로 조회하는데, 그 테이블의 시각 컬럼은 **`at`** 이다(양쪽 DB 실측 확인, 같은 파일의 다른 코드와 `src/app/actions/wbs.ts:39` 는 전부 `at` 을 쓴다). 결과: "승인 취소"·"재작업 요청" 을 누르면 주문과 stage 는 되감기지만 **실적 100% 가 그대로 남는다**(경고 토스트는 뜬다 — 3원칙대로 위장하지는 않는다).

**컬럼명만 고치면 안 된다.** `approveAgentCompletion` 이 `updateActual`(DB 시계 `now()`)로 이력을 남긴 **뒤** JS 시계로 `reviewed_at` 을 찍기 때문에, 승인 이력의 `at` 은 항상 `reviewed_at` 보다 앞선다 → `.gte('at', reviewedAt)` 는 그 이력을 창 밖으로 밀어낸다. 올바른 수정은 하한을 같은 DB 시계 값으로 잡는 것이다(예: 이미 읽고 있는 `agent_work_reports.created_at` 을 하한으로 쓰거나, 승인 쪽에서 `now` 를 `updateActual` 앞에 찍어 `reviewed_at ≤ at` 을 보장).

테스트가 큐 기반 목이라 컬럼명을 검증하지 않아 5,096건이 전부 통과한다 — 수정 시 `gte` 호출 인자를 단언하는 케이스를 추가할 것.

그 전까지: 승인 취소·재작업 요청을 쓰면 진척률을 손으로 되돌려야 한다.

---

## 7. 사용자 결정이 필요한 항목

- [ ] **권한 하향이 의도인가.** 에이전트 루프 등록이 `requireSuperuser()` → `requireProjectAdmin()` 로 내려왔고(`src/app/actions/agentWork.ts:30-35` 에 "같은 단계로 내렸다"고 명시), `/api/v1/wbs/import` 스코프가 `work:report`(자율 발급 불가라 사실상 아무도 못 쓰던 것) → `work:claim`(누구나 자율 발급) 으로 바뀌었다. 운영에 살아있는 PAT 1개가 `work:claim` 을 갖고 있어(MES 프로젝트, 2027-02-10 만료) **머지 시점부터 그 토큰으로 운영 WBS 를 upsert 할 수 있게 된다.** `agent_projects` 는 쓰기 RLS 가 없어 이 서버 가드가 유일한 관문이다.
  또한 자율 러너 설계 메모(`wbs-autonomous-runner.md`)는 "wbs:import 스코프 분리"를 L0 필수로 적었는데 구현은 `work:claim` 에 합쳐졌다 — 설계 드리프트로 볼지 판단 필요.
- [ ] **`/agent-ops` 삭제에 리다이렉트를 둘 것인가.** 화면이 사라지는데 리다이렉트가 없어 이미 발송된 알림의 링크가 404 로 간다.

---

## 8. 후속 백로그 (이번 머지 범위 밖)

- `scripts/kit-build.sh:22` 가 gitignore 된 `kit/.env.example` 을 요구한다(`.gitignore:34` 의 `.env*`). 작성자 PC 의 untracked 파일에 의존해 **다른 PC·새 클론에서는 킷 빌드가 실패**한다. `.gitignore` 에 `!kit/.env.example` 예외를 두거나 `install.sh` 가 `.env` 초안을 자체 생성하도록.
- 다른 PC 의 구 dflow 킷은 승인 되감기·재작업 요청을 감지하지 못한다 — 머지 후 킷 재빌드·재설치 필요(위 항목이 선행).
- `vitest.config.ts` 의 `execArgv: ['--no-experimental-webstorage']` 는 **Node ≥22.4 전용**인데 `engines`·`.nvmrc` 가 없다. Node 20 PC 에서는 vitest 가 전부 죽고 pre-push G3 가 그것을 "안전망 검사 실패"로 보고해 push 를 막는다. 이 PC 는 v22.18.0 으로 통과.
- `src/components/app/Sidebar.tsx:66` 에 이미 삭제된 `/agent-ops` 링크를 설명하는 고아 주석.
- `scripts/staging-sync.mjs` 가 이 PC 에서 dirty 상태이고 untracked `scripts/lib/pg-tools.mjs` 에 의존한다 — sync 를 돌린다면 로컬 수정본이 실행된다는 뜻.

---

## 9. 롤백

**코드:** `git revert -m 1 <머지sha>` (Phase A 에서 `--no-ff` 를 썼기 때문에 가능) 또는 Vercel Instant Rollback. 되돌림 커밋이 UI 위험 파일을 포함하므로 G2 에 걸린다 — `Preview-checked: n/a — 롤백` 트레일러로 통과시킨다.

**DB:** 원칙적으로 되돌리지 않는다. 0089·0090 은 nullable 컬럼 추가라 **코드만 되돌려도 안전**하다(구 코드는 새 컬럼을 읽지 않는다). rollback SQL 을 돌리면 컬럼이 drop 되어 그 사이 입력된 값이 사라진다. 0092 rollback 은 `change_logs` 기록에 의존하는데 시간창이 없어 stale 복원 가능성이 있다.

상세는 `docs/runbook-rollback.md` · `docs/runbook-staging.md`.
