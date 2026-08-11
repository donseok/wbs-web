# 알림함(Notification Inbox) 설계

작성 2026-08-11 · 상태 **설계 확정(구현 미착수)** · 조사 기반: Jira Inbox 공식·UX 리뷰, GitHub/Linear/Asana/Slack 비교,
알림 인프라 3사(Knock·Novu·Courier), Supabase Realtime 권고, D'Flow 코드 실측(7개 조사 에이전트, 2026-08-11)

> 연동 짝: [Claude Code × D'Flow 연동 부록 §2.10](2026-08-10-claude-code-work-integration-review-appendix.md)이
> 작업 루프 쪽 **발행 지점**을 규정한다. 이 문서는 알림함 자체(저장·수신·UI)의 정본이다.

---

## 한 줄 결론

**메시징이 아니라 알림 전용이다**(Jira도 그렇다 — 대화는 이슈 댓글·Slack 몫).
저장은 **개인(수신자 행)·전체(워터마크) 이원**, 수신은 **한 벨·한 피드·배지 합산으로 통합**한다.
기존 벨(지연·마감임박 파생 피드)은 신규 알림함이 흡수한다.

## 사용자 확정 결정 (2026-08-11)

| # | 결정 |
|---|---|
| N1 | 스코프는 **알림만** — 메시징(쪽지·대화) 제외 |
| N2 | **개인 알림과 전체 알림을 구분해 저장**한다 — 개인 = 이벤트 + 수신자별 행, 전체 = 이벤트 1행 + 사용자별 워터마크 |
| N3 | **개인은 둘 다 받는다** — 벨 하나, 피드 하나, 배지는 개인 안읽음 + 전체 미확인 합산. 저장만 이원, 수신은 통합 |
| N4 | 첫 소비자는 **작업 루프**(태스크 할당 · AI 작업 시작 · 작업 종료/승인 대기 등) — 8/10 연동 설계와 맞물림 |

## 현황 실측 (2026-08-11)

- **개인 지정 인앱 알림은 현재 0건.** 사용자에게 "너에게 온" 알림을 만드는 코드가 없다.
- 기존 벨은 알림함이 아니라 **프로젝트 단위 파생 피드**다 — `src/app/actions/notifications.ts:26`이
  지연·마감임박(7일)을 조회 시점에 계산하고, 읽음만 `prefs.notifRead[projectId]`(id 목록, 상한 200)로 기억한다.
  이벤트 저장 없음 · 개인 수신자 없음. 이름(`notifications`)과 벨 자리를 신규 알림함과 다투므로 **흡수 대상**.
- 전체 공지의 확인 모델 선례: `announcement_seen`(0012) — 사용자별 본 시각 워터마크. **전체 알림이 이 패턴을 승격**해 쓴다.
- Realtime 선례 1건: `weekly_report_rows`의 postgres_changes(publication 등록 `0023_weekly_sheet.sql:57`).
- 벨 UI 슬롯: `src/components/app/HeaderChrome.tsx:43` — 패널 상태 `'notif' | 'profile'` 단일 슬롯.
- 로스터 다리: `project_members.user_id`는 nullable(0019 자동 링크) — **프로젝트 사건의 수신자 키는 user_id가 아니라
  `member_id`**로 잡아야 계정 없는 외부 인력·미링크 구간에서 행이 유실되지 않는다.
  프로젝트 밖 사건(`system.pat_expiring` 등)만 `user_id`를 직접 쓴다.

---

## 데이터 모델

이벤트/수신자 2테이블. 마이그레이션 번호는 **0074부터**(0069·0071·0072·0073은 연동 설계가 예약, 0070은 기사용).
`_rollback.sql` 동반, 마이그레이션 단독 커밋(G1).

```sql
-- 0074_notification_inbox.sql (스케치 — DDL 동결은 구현 계획에서)
create table notification_events (
  id          uuid primary key default gen_random_uuid(),
  type        text not null,              -- 카탈로그의 타입 코드 (예: work.assigned)
  category    text not null check (category in ('work','issue','meeting','announce','system')),
  audience    text not null check (audience in ('direct','project','global')),
  project_id  uuid null references projects(id) on delete cascade,  -- global이면 null
  actor_user_id uuid null,                -- 행위자(자기 행위는 자기에게 알리지 않는다)
  entity_type text null, entity_id uuid null,  -- 딥링크 대상 (wbs_item / order / issue / ...)
  payload     jsonb not null default '{}'::jsonb,  -- 렌더에 필요한 스냅샷(제목 등) — 조회 시 조인 최소화
  dedupe_key  text null,                  -- 멱등 발행 키
  created_at  timestamptz not null default now()
);
create unique index on notification_events (dedupe_key) where dedupe_key is not null;

create table notification_recipients (    -- audience='direct'일 때만 행 생성
  id         uuid primary key default gen_random_uuid(),
  event_id   uuid not null references notification_events(id) on delete cascade,
  member_id  uuid null references project_members(id) on delete cascade,  -- 프로젝트 사건의 수신자 키(로스터 축)
  user_id    uuid null,                   -- 링크 스냅샷(realtime 채널 키) 겸 프로젝트 밖 사건(system.*)의 수신자 키
  seen_at    timestamptz null,            -- 벨 열람(배지 소등)
  read_at    timestamptz null,            -- 항목 클릭/읽음
  archived_at timestamptz null,           -- 사용자 명시 정리(자동 아카이브 금지 — Asana 롤백 교훈)
  check (member_id is not null or user_id is not null)
);
-- 멱등: 같은 이벤트 중복 수신 불가 (수신자 축별 부분 유니크)
create unique index on notification_recipients (event_id, member_id) where member_id is not null;
create unique index on notification_recipients (event_id, user_id) where member_id is null;
create index on notification_recipients (user_id) where seen_at is null;  -- 배지(unseen) count 전용

-- 전체 알림 확인 모델: 별도 테이블을 만들지 않는다 (2026-08-11 실측 정정).
-- 기존 announcements + announcement_seen(0012 워터마크)이 이미 정확히 그 구조다 —
-- 벨은 배지 합산·피드 구획으로 "통합 수신"만 구현한다. audience='project'|'global' 값은
-- 훗날 공지 외 전체 알림이 생길 때를 위한 예약(v1 발행은 전부 'direct').
```

- **RLS**: 3테이블 모두 `enable row level security` + **쓰기 정책 0개**(발행은 service_role — 0051/0057 관례,
  서버 액션 가드가 유일 관문 계열임을 헤더에 명시). SELECT는 recipients·watermarks 본인 행,
  events는 수신 가능 범위(direct=내 행 존재 ∪ project=멤버 ∪ global).
- **배지 쿼리**: `count(*)` + 부분 인덱스(`where seen_at is null`) — 카운터 컬럼을 따로 두지 않는다(드리프트 원천).
  배지 기준은 **unseen**(벨 열람 = 배지 소등, Knock 관례) — `read_at`은 항목의 읽음 흐림용.
  전체분은 기존 `getUnreadAnnouncementCount`(announcement_seen 워터마크 이후)를 합산.
- **retention**: 읽음 90일 경과 행 삭제(주기 잡). 안읽음은 보존.

## 알림 카탈로그

조사에서 확정한 원칙: **noise가 알림함의 최대 실패 요인**(Jira "모두에게 전부" 기본값의 교훈) — 기본값은 보수적으로,
행위자 자신에게는 발행하지 않는다. 카테고리 5종 = `work / issue / meeting / announce / system`.

### A. 작업 루프 (audience=direct — 8/10 연동 설계의 이벤트)

| 타입 | 트리거 | 수신자 | 기본 |
|---|---|---|---|
| `work.assigned` | WBS 담당자 배정(웹 UI·import 매칭) | 담당자 | ON |
| `work.order_created` | 배정 기반 자동 발행(`ensureOrderForAssignedLeaf`) | 담당자 | ON |
| `work.claimed` | AI(또는 사람) claim — **작업 시작** | 담당자(대리 claim 시)·발행 관리자 | ON |
| `work.progress` | progress 보고 | 담당자 | OFF (noise — 상세 화면 몫) |
| `work.reported` | completion 보고 → `reported` **승인 대기** | 프로젝트 관리자 | **REQUIRED** (승인 요청은 끌 수 없다 — Courier 관례) |
| `work.approved` | PM 승인 | claim 소유자·담당자 | ON |
| `work.rejected` | PM 반려 | claim 소유자·담당자 | **REQUIRED** |
| `work.released` | AI 실패·반납(release) | 담당자·발행 관리자 | ON |
| `work.revoked` | 관리자 회수·취소 | claim 소유자 | ON |
| `work.unblocked` | 선행 전부 `im` 이상 도달 — 착수 가능 | 후행 담당자 | ON |
| `work.human_gate` | 에이전트가 사람 전용 전이 요구(403 `human_gate` 발생) | 담당자·관리자 | ON |

### B. 협업

| 타입 | 트리거 | 수신자 | 기본 |
|---|---|---|---|
| `issue.assigned` | 이슈 담당자 지정(신규 추가분만 — `replaceAssignees`가 delete-then-insert라 diff 필수) | 담당자 | ON |
| `issue.status` | 내 담당 이슈 상태 변경 | 담당자 | ON |
| `member.invited` | 프로젝트 멤버 등록 | 대상자 | ON |
| `member.joined` | 초대 수락·계정 링크 | 프로젝트 관리자 | OFF |
| `announce.posted` | 공지 게시 — **v1은 이벤트를 발행하지 않는다.** 기존 announcements가 곧 전체 알림이며 벨이 재사용(배지 합산·피드 구획) | 프로젝트 멤버 전원 | ON |

> **회의록 액션아이템 담당 지정은 카탈로그에서 제외(2026-08-11 실측)** — `minute_insights`는 AI 분류 라벨뿐
> 담당자 컬럼이 없다. 담당 지정의 유일한 실경로는 블록→이슈 전환(`createIssueFromMinuteBlock`)이고
> 그것은 `issue.assigned`가 커버한다.

### C. 시스템 (audience=direct)

| 타입 | 트리거 | 수신자 | 기본 |
|---|---|---|---|
| `system.pat_expiring` | PAT 만료 7일 전(주기 스캔) | 토큰 소유자 | ON |
| `system.import_result` | `/wbs/import` 완료 — upsert 수·미매칭 담당자 | 업로드 실행자 | ON |
| `system.runner_stale` | heartbeat stale(WP-05 도입 후) | 발행 관리자 | OFF |

### 파생 상태 알림 (이벤트 아님 — 기존 벨 흡수분)

지연·마감임박은 "발생 사건"이 아니라 "현재 상태"라 이벤트화하면 매일 재발행 스팸이 된다.
기존 파생 로직(`notifications.ts`)을 유지하고 **피드의 별도 구획**으로 렌더, 읽음도 기존 `prefs.notifRead` 그대로.
장기적으로 워터마크 테이블로 이전 가능하나 v1 스코프 아웃.

## 발행 계약

- 단일 헬퍼 `src/lib/notify/emit.ts` — `emitNotification({type, audience, projectId, actorUserId, entity, payload, recipients?, dedupeKey?})`.
  service_role insert. **fire-and-forget**: 알림 실패가 본 동작(claim·승인 등)을 실패시키지 않는다 —
  단 에러 3원칙에 따라 **실패는 반드시 로깅**한다(조용한 유실 금지).
- 멱등: 재시도 가능 지점(import 재실행·자동 발행 no-op 경로)은 `dedupe_key` 필수
  (예: `order_created:{wbs_item_id}:{order_id}`). recipients는 PK가 멱등을 보장.
- 행위자 제외: `recipients`에서 `actor_user_id` 본인은 발행 시 제거.
- 발행 지점의 코드 위치는 연동 부록 §2.10의 표가 정본 — 두 문서가 서로를 참조하고 목록은 부록에만 둔다(중복 방지).

## 수신 모델

- 3단계: **unseen → seen → read** (+ `archived` 독립 축) — Knock/Novu 관례.
  벨 열람 = 피드 항목 일괄 `seen_at`(배지 소등), 항목 클릭 = `read_at`, 정리 = `archived_at`(자동 아카이브 없음).
- **배지 = 개인 unseen(`seen_at is null`) + 공지 안읽음(워터마크 이후) 합산** (결정 N3).
- 피드: 최신순, 카테고리 필터 탭, 같은 entity 연속 알림은 **UI에서 그룹 렌더**
  (서버측 배칭·다이제스트는 만들지 않는다 — Jira의 3~10분 배칭은 이메일 채널 문제였고 인앱은 그룹 렌더로 충분).
- 설정: 사용자별 타입 ON/OFF(`user_preferences.prefs.notif` 확장 — 새 테이블 불필요, 0017 테이블·`UiPrefs` 타입).
  판정은 **조회 시점 필터**(발행 시 수신자별 prefs N회 조회 회피 + 토글이 소급 적용). REQUIRED 타입은 UI에서 토글 비활성.

## Realtime

- **broadcast-from-database** 채택: `notification_recipients` INSERT 트리거가 `realtime.broadcast_changes`로
  private 채널 `user-{user_id}-notifications`에 송신. `user_id null`(미링크 로스터) 행은 송신 생략 — 로그인하면 폴링이 잡는다.
- **postgres_changes는 쓰지 않는다** — 구독자 수 비례 RLS 재검사로 Micro 컴퓨트(2 vCPU 공유·1GB)에 불리.
  0023의 기존 선례는 유지하되 추종하지 않는다.
- 전체 알림(project/global)은 v1에서 realtime 생략 — 페이지 전환 시 배지 재조회로 충분.
- 클라이언트: 구독은 벨 마운트 시 1회, **unmount 시 `removeChannel` 필수** — 채널 leak이 조사에서 확인된 함정 1순위.
- realtime 자체가 실패해도 동작 저하 없음(폴링 폴백) — 향상 계층이지 의존 계층이 아니다.

## UI

- 벨 자리 통합: `HeaderChrome.tsx`의 기존 벨을 알림함 패널로 교체(파생 구획 포함). **`src/components/app/*` = G2 브랜치 경유.**
- 패널: 배지(합산) → 목록(카테고리 탭 · 그룹 렌더 · 항목 클릭 시 딥링크 + read) → '모두 읽음' → 설정 링크.
- 전체 알림 항목은 시각적으로 구분(공지 아이콘)하되 같은 피드에 시간순 배치.

## 안티패턴 가드 (조사 결론 → 설계 반영)

1. 기본값 "모두에게 전부" 금지 → 카탈로그 기본값 보수(progress OFF 등) ✅
2. 자동 아카이브 금지(Asana 롤백) → archived는 사용자 명시 행위만 ✅
3. unread 카운터 컬럼(드리프트) 금지 → count(*)+부분 인덱스 ✅
4. 알림 실패의 본 동작 전파 금지 + 조용한 유실 금지 → fire-and-forget+로깅 ✅
5. 표시와 알림의 결합(Slack 교훈) → seen(배지)과 read(항목) 분리 ✅
6. 이벤트 아닌 상태의 이벤트화 금지 → 지연·마감은 파생 구획 유지 ✅
7. 행위자 본인 알림 금지 ✅
8. 끌 수 없는 것은 승인 요청류만(REQUIRED 남발 금지) ✅
9. 채널 leak → removeChannel 계약 명시 ✅

## 스코프 밖

이메일·Slack 등 외부 채널 / 서버측 배칭·다이제스트 / snooze·리마인더 / 멘션(메시징 계열) /
브라우저 푸시 / 전체 알림 realtime. 전부 후속 승인 대상.

## 로드맵 스케치 (별도 WBS — 구현 계획 작성 시 확정)

**알림함을 연동보다 먼저 개발한다(2026-08-11 사용자 결정)** — 선행 의존이 없고, 알림함이 먼저 있으면
연동 서버 Task가 emit 훅을 직접 포함해 retrofit 단계가 소멸한다.
구현 계획: [`docs/superpowers/plans/2026-08-11-notification-inbox.md`](../plans/2026-08-11-notification-inbox.md)

1. **WP-N1 저장·발행** — 0074 마이그레이션(단독 커밋) + `emit.ts` + 이미 존재하는 발행 지점 retrofit은
   **이슈 계열 2곳**(`replaceAssignees` diff — 신규 추가분만 · `createIssueFromMinuteBlock` RPC 경로).
   공지는 재발행 없이 재사용. 연동 기능이 아직 없어도 단독 가치 있음.
2. **WP-N2 벨 UI 통합** — 패널 교체(G2 브랜치)·배지 합산(개인 unseen + 공지 안읽음)·파생 구획 흡수·설정.
3. **WP-N3 작업 루프 발행** — ~~retrofit~~ → **연동 서버 Task가 emit를 직접 포함**(알림함 선행이므로).
   부록 §2.10 표가 지점 정본. 연동이 먼저 나가는 예외 상황에만 retrofit으로 후속.
4. **WP-N4 realtime** — 0075 트리거·private 채널·클라 구독.

dev-workflow(플러그인·스킬) 변경은 **0** — 발행은 전부 D'Flow 서버측이고, AI 작업 시작/종료 알림도
claim/report API 처리 중 서버가 발행한다.
