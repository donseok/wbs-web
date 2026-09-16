# 작업 지시 프롬프트 — WBS 실시간 반영 구현

아래 블록을 `wbs-web` 리포에서 작업할 세션에 그대로 붙여 넣는다.

---

```text
리포 `/Users/jji/project/wbs-web` 에서 WBS 실시간 반영(WebSocket push)을 구현한다.

## 먼저 읽을 것

1. `docs/superpowers/specs/2026-09-16-wbs-realtime-push-design.md` — 승인된 설계다.
   전송 방식·갱신 입도·페이로드·정합성 함정이 전부 여기 있다. 이걸 다시 설계하지 마라.
2. `CLAUDE.md` — git 운영·스테이징·pre-push 훅 규칙. 여기 어긋나면 push 가 막힌다.
3. `supabase/migrations/0075_notification_realtime.sql` 과
   `src/lib/hooks/useInboxRealtime.ts` — 그대로 본뜰 선례다.
4. `src/components/weekly/WeeklySheetView.tsx:160-192` — 재연결 보정 패턴의 출처.

설계 문서에 사실과 다른 곳이 있으면 **구현하지 말고 먼저 보고해라.** 특히
`0097_stage_credits_single_table.sql:201` 의 `update public.wbs_items` 가 여전히
평범한 UPDATE 인지 확인해라. 이게 아니면 트리거 설계 전체가 무너진다.

## 만들 것

**커밋 1 — 마이그레이션 (코드와 절대 섞지 않는다)**
- `supabase/migrations/0098_wbs_realtime.sql`
  - `public.wbs_items_broadcast()` 트리거 함수.
    `realtime.send(payload, 'wbs_changed', 'project-'||new.project_id||'-wbs', true)`.
    `exception when others then null` 로 감싼다 — 송신 실패가 본 UPDATE 를 죽이면 안 된다.
  - 트리거: `after update of stage, actual_pct ... for each row
    when (old.stage is distinct from new.stage or old.actual_pct is distinct from new.actual_pct)`.
    `of` 절과 `when` 절을 둘 다 둔다.
  - `realtime.messages` 의 select 정책. 토픽에서 project_id 를 뽑아
    기존 `public.is_project_member(uuid)` 에 넘긴다. 서브쿼리를 인라인하지 마라.
  - 멱등하게 쓴다(`create or replace`, `drop ... if exists`). 헤더 주석에 계약을 남긴다 —
    0075 헤더가 형식의 본보기다.
- `supabase/migrations/0098_wbs_realtime_rollback.sql` — 실시간만 꺼지고 저장·조회는 무영향.

**커밋 2 — 클라이언트**
- `src/lib/hooks/useWbsRealtime.ts` 신규. 책임은 넷이다.
  - private 채널 구독. 세션은 `getUser()` 가 아니라 `getSession()` 으로 읽는다(무왕복).
  - 정리(`removeChannel`) — 채널 leak 1순위 함정이다.
  - 순서 판정: 보유 행의 `updated_at` 보다 오래된 페이로드는 버린다.
  - 재연결 보정: `subscribe` 콜백에서 `SUBSCRIBED` 가 **두 번째 이후로** 올 때만
    `router.refresh()`. 최초 구독은 SSR 결과가 이미 최신이라 부르지 않는다.
  - 구독 설정 전체를 try/catch 로 감싸 실패를 삼킨다. 향상 계층이다.
- 호출부 넷을 연결한다.
  | 화면 | 방식 |
  |---|---|
  | WBS 목록/트리 | 부분 패치 |
  | `src/components/wbs/RowDetailPanel.tsx` | 열린 항목 id 대조 후 부분 패치 |
  | 승인 대기 목록 | 부분 패치. 단계가 조건을 벗어나면 행 제거 |
  | 대시보드 진척률 | 1초 trailing 디바운스 `router.refresh()` |

  대시보드만 재조회인 이유는 집계값이라 행 단위 페이로드로 패치가 정의되지 않기 때문이다.

## 규율

- TDD. vitest 로 먼저 실패를 만들고 구현한다. 최소 세 건:
  순서 역전 페이로드 폐기 / 승인 대기 목록의 행 제거 / 디바운스가 연속 이벤트를 1회로 합침.
- `git add -A` 금지. 파일명을 명시해 stage 한다. 병렬 세션의 dirty 파일이 섞인다.
- 마이그레이션 커밋과 코드 커밋을 분리한다(pre-push 훅 G1).
- 0072 이상 마이그레이션이라 **스테이징 리허설이 필수다**(훅 G4).
  `npm run staging:sync` → `npm run db:apply -- --target staging` → 검증 →
  커밋 트레일러 `Staging-verified:` → staging push → `db:apply --target prod` → main push.
  절차 정본은 `docs/runbook-staging.md`.
- 육안 검증: 브라우저 두 개를 열고 한쪽에서 단계를 바꿔 다른 쪽이 새로고침 없이 변하는지 본다.
  개발자도구로 오프라인을 걸었다 풀어 재연결 보정도 확인한다.
- 배포 후 `npm run smoke:prod`, 화면까지 확인되면 `npm run mark:good`.

## 결정이 필요하면 물어라

설계 문서 13절에 열린 결정 둘이 있다.
- 승인 대기 목록에서 조건을 벗어난 행을 즉시 제거할지, 흐리게 남길지.
- 대시보드 디바운스 1초가 적절한지(스테이징 실측으로 조정).

임의로 정하지 말고 물어라. 나머지는 설계대로 간다.
```

---

## D'Flow 작업으로 올릴 경우

위 프롬프트는 세션에 직접 붙이는 형태다. D'Flow 작업으로 등록해 에이전트에게 위임하려면
`category: dev`, `tags: agent` 로 만들고 본문에 위 블록을 넣는다. 선행 작업은 없다.
