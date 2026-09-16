# WBS 실시간 반영 설계 — 에이전트 쓰기를 화면으로 밀어 넣기

작성일 2026-09-16 · 대상 리포 `wbs-web` · 상태 **설계 검토 대기**

---

## 1. 문제

에이전트가 작업을 끝내고 D'Flow API 로 단계를 올려도 **열려 있는 브라우저 화면은 그대로다.** 사용자는 새로고침하거나 다른 경로로 이동했다 돌아와야 바뀐 상태를 본다.

원인은 구조에 있다. 이 앱은 Server Component 로 읽고 Server Action 으로 쓰며 `revalidatePath` 로 무효화한다. 이 경로는 **자기 브라우저가 일으킨 변경만** 갱신한다. 에이전트는 서버 쪽 SQL 을 직접 바꾸므로 브라우저로 향하는 신호가 애초에 존재하지 않는다.

폴링은 채택하지 않는다. 사용자가 명시적으로 배제했고, 아래 3절이 보이듯 리포에 이미 검증된 push 경로가 있다.

## 2. 전제 — 이미 깔려 있는 것

조사로 확인한 사실만 적는다.

| 항목 | 확인 내용 | 근거 |
|---|---|---|
| 에이전트 쓰기가 SQL UPDATE 인가 | 그렇다. RPC 가 `update public.wbs_items` 를 수행한다 | `supabase/migrations/0097_stage_credits_single_table.sql:201` |
| broadcast 선례 | DB 트리거 → `realtime.send()` → private 채널 → 클라 훅 | `0075_notification_realtime.sql`, `src/lib/hooks/useInboxRealtime.ts` |
| `postgres_changes` 선례 | 존재하지만 **0075 가 의도적으로 배제**했다 | `WeeklySheetView.tsx:167` / `0075` 헤더 주석 |
| 프로젝트 멤버 판정 함수 | `public.is_project_member(uuid)`, `authenticated` 에 grant 됨 | `0052_authz_roles.sql:50,67` |
| `wbs_items` 읽기 범위 | `read_all_items ... using (true)` — 인증 사용자는 전 항목을 읽는다 | `0002_rls.sql:21` (0053 은 쓰기 정책만 교체) |
| 최신 마이그레이션 | `0097` → 신규는 `0098` | `supabase/migrations/` |
| 의존성 | `@supabase/supabase-js` 이미 설치 — 신규 패키지 0건 | `package.json` |

### 전송 방식을 broadcast 로 고정하는 이유

`0075` 헤더가 `postgres_changes` 를 배제한 근거를 그대로 승계한다.

> postgres_changes 를 쓰지 않는다 — 구독자 수 비례 RLS 재검사가 Micro 컴퓨트(2vCPU 공유·1GB)에 불리하다. realtime.send(broadcast) 는 송신 1회로 끝난다.

컴퓨트는 지금도 Micro 다(`CLAUDE.md`, 2026-08-05 실측 — Pro 요금제이되 컴퓨트는 Micro 그대로). 따라서 전제가 유지되며 결론도 유지된다.

## 3. 구조

```
wbs_items UPDATE (에이전트 RPC·사용자 Server Action 양쪽 모두)
  └─ 트리거 wbs_items_broadcast  ── when (stage/actual_pct 가 실제로 바뀐 경우에만)
       └─ realtime.send(payload, 'wbs_changed', 'project-<project_id>-wbs', private := true)
            └─ [WebSocket] Supabase Realtime
                 └─ useWbsRealtime(projectId)  ── 클라이언트 훅 1개
                      ├─ 행 정체성이 있는 화면 → 부분 패치
                      └─ 집계 화면        → 디바운스된 router.refresh()
```

트리거를 택한 이유는 **에이전트 쓰기와 사용자 쓰기를 한 지점에서 모두 잡기** 때문이다. 애플리케이션 코드에서 송신하면 RPC 를 거치는 에이전트 경로를 놓친다.

## 4. 갱신 입도 — 부분 패치와 재조회를 나눈다

사용자는 "변경 행만 부분 패치"를 선택했다. 다만 **적용 범위로 선택한 화면 4종이 균질하지 않다.**

부분 패치는 **페이로드에 행 정체성이 있을 때만 정의된다.** WBS 목록·작업 상세 패널·승인 대기 목록은 모두 `wbs_items.id` 로 자기 행을 지목할 수 있다. 반면 대시보드의 진척률은 집계값이라서, `{item_id, stage}` 만으로는 새 집계를 유도할 수 없다. 롤업을 다시 돌리지 않으면 값이 나오지 않는다.

그래서 다음과 같이 나눈다. 이것은 절충이 아니라 선택지를 정확히 읽은 결과다.

| 화면 | 방식 | 근거 |
|---|---|---|
| WBS 목록/트리 | 부분 패치 | 행 정체성 있음 |
| 작업 상세 패널(`RowDetailPanel`) | 부분 패치 | 열려 있는 항목 id 와 대조 |
| 승인 대기 목록 | 부분 패치 | 행 정체성 있음. 단계가 조건에서 벗어나면 행 제거 |
| 대시보드 진척률 | 디바운스 `router.refresh()` (1s) | 집계값 — 행 단위로 패치 불가 |

## 5. 페이로드

```jsonc
{
  "id": "…",           // wbs_items.id — 패치 대상 지목
  "project_id": "…",   // 채널 검증 이중화
  "stage": "as",
  "actual_pct": 40,
  "updated_at": "2026-09-16T…"  // 순서 판정용
}
```

**정보 노출 검토.** private 채널 인가는 **토픽 단위**(`is_project_member(project_id)`)이지 행 단위가 아니다. 따라서 페이로드에 담는 값은 "프로젝트 멤버 전원이 이미 읽을 수 있는 값"이어야 한다. `wbs_items` 의 SELECT 정책이 `using (true)` 이므로 위 네 필드는 이 조건을 만족한다. **향후 SELECT 정책이 좁아지면 이 페이로드도 같이 좁혀야 한다** — 그 경우 `{id, project_id, updated_at}` 만 실어 보내고 각 화면이 해당 행 1건을 재조회하는 형태로 바꾼다. 여전히 부분 갱신이고 비용도 작다.

## 6. 정합성 — 세 가지 함정

**(1) 순서 역전.** broadcast 는 `postgres_changes` 와 달리 전송 순서를 보장하지 않는다. 단계를 연속으로 두 번 바꾸면 늦게 만든 페이로드가 먼저 도착할 수 있다. 각 화면은 보유 중인 행의 `updated_at` 보다 **오래된 페이로드를 버린다.**

**(2) 연결 끊김.** 부분 패치만 있으면 WebSocket 이 한 번 끊긴 사이의 변경이 영구히 유실되어 화면이 조용히 낡는다. `WeeklySheetView.tsx:186-189` 의 회복 패턴을 그대로 승계한다 — `subscribe` 콜백에서 `SUBSCRIBED` 가 **두 번째 이후로** 올 때만 `router.refresh()` 를 호출해 누락분을 보정한다(최초 구독은 SSR 결과가 이미 최신이므로 불필요하다).

**(3) 이벤트 쇄도.** 에이전트가 단계를 연속으로 밀면 갱신이 몰린다. 부분 패치는 상태 갱신이라 가볍지만, 대시보드의 `router.refresh()` 는 Server Component 전량 재렌더라 비싸다. 대시보드 경로에만 **1초 trailing 디바운스**를 건다.

## 7. 실패해도 죽지 않는다 — 향상 계층 원칙

`0075` 가 세운 계약을 그대로 따른다.

- **DB 측**: `realtime.send` 를 `exception when others then null` 로 감싼다. 송신 실패가 본 UPDATE 를 되돌리면 안 된다. 실시간은 편의이고 기록이 본질이다.
- **클라 측**: 구독 설정 전체를 `try/catch` 로 감싸고 실패를 삼킨다. 구독이 죽어도 기존의 경로 전환 재조회가 폴백으로 남는다.
- **롤백 영향**: `0098_..._rollback.sql` 을 적용하면 실시간만 꺼진다. 저장·조회·기존 갱신 경로는 무영향이다.

## 8. 트리거 발화 조건

```sql
create trigger wbs_items_broadcast
  after update of stage, actual_pct on public.wbs_items
  for each row
  when (old.stage is distinct from new.stage
        or old.actual_pct is distinct from new.actual_pct)
  execute function public.wbs_items_broadcast();
```

`when` 절이 없으면 무관한 컬럼 수정마다 broadcast 가 나간다. `of stage, actual_pct` 와 `when` 을 **둘 다** 둔다 — 전자는 트리거 자체의 발화를 줄이고, 후자는 같은 값 재기록을 걸러낸다.

## 9. 수신 인가 정책

```sql
create policy receive_project_wbs_channel on realtime.messages
  for select to authenticated
  using (
    realtime.topic() = 'project-' || <project_id> || '-wbs'
    and extension = 'broadcast'
    and public.is_project_member(<project_id>)
  );
```

토픽 문자열에서 `project_id` 를 추출해 `is_project_member` 에 넘긴다. 알림(`0075`)은 토픽에 `auth.uid()` 가 박혀 있어 등식 비교로 끝났지만, 여기서는 프로젝트 범위라 멤버십 판정이 필요하다. 이미 있는 함수를 쓰고 서브쿼리를 인라인하지 않는다.

## 10. 변경 목록

**마이그레이션 (별도 커밋 — G1)**
- `supabase/migrations/0098_wbs_realtime.sql`
- `supabase/migrations/0098_wbs_realtime_rollback.sql`

**코드 (별도 커밋)**
- `src/lib/hooks/useWbsRealtime.ts` — 신규. 구독·정리·순서 판정·재연결 보정을 담당한다.
- WBS 목록/트리 컴포넌트 — 훅 연결 + 행 교체
- `src/components/wbs/RowDetailPanel.tsx` — 훅 연결 + 열린 항목 대조
- 승인 대기 목록 컴포넌트 — 훅 연결 + 행 교체/제거
- 대시보드 컴포넌트 — 훅 연결 + 디바운스 `router.refresh()`

## 11. 검증

- **단위(vitest)**: 순서 역전 페이로드를 버리는지, 단계가 조건에서 벗어난 행을 승인 대기 목록에서 제거하는지, 디바운스가 연속 이벤트를 1회로 합치는지.
- **스테이징 리허설(필수)**: 0072 이상 마이그레이션이라 G4 훅이 main 직행을 막는다. `staging:sync` → `db:apply --target staging` → 두 브라우저를 열고 한쪽에서 단계를 바꿔 다른 쪽이 즉시 변하는지 육안 확인 → 커밋 트레일러 `Staging-verified:` → staging push → `db:apply --target prod` → main push. 절차는 `docs/runbook-staging.md`.
- **실패 경로**: 구독을 강제로 끊고(개발자도구 오프라인) 단계를 바꾼 뒤 재연결했을 때 화면이 보정되는지 확인한다.

## 12. 리포 규칙 체크리스트

- [ ] 마이그레이션과 코드를 **같은 커밋에 담지 않는다** (G1)
- [ ] `_rollback.sql` 동봉
- [ ] `git add -A` 쓰지 않고 파일명을 명시해 stage
- [ ] 0072 이상 → 스테이징 리허설 + `Staging-verified:` 트레일러 (G4)
- [ ] UI 위험 파일(`src/components/app/*` 등)을 건드리면 브랜치 + Preview (G2) — 현재 변경 목록에는 해당 없음
- [ ] 배포 후 `npm run smoke:prod`, 화면 확인되면 `npm run mark:good`

## 13. 남은 결정

- 승인 대기 목록에서 **조건을 벗어난 행을 즉시 제거할지, 흐리게 표시하고 남길지.** 즉시 제거는 보고 있던 항목이 눈앞에서 사라지는 체감을 준다.
- 대시보드 디바운스 1초가 적절한지는 스테이징에서 실제 에이전트 주행으로 재어 본다.
