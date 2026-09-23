# 에이전트 화면 — 행의 키 판정 (2026-09-18)

## 결론: 신원은 한 규칙이 아니라 세 규칙이다

| 컬럼 | 실제 값 | 서버 검증 | 슬래시 |
|---|---|---|---|
| `agent_work_orders.heartbeat_agent` | `<신원>/<host>/w<슬롯>` 또는 `claude-<host>` | 길이 1~120 | 허용 |
| `agent_watchers.agent` | `<신원>/<host>/lead`, `<신원>/<host>/poll` | 길이 1~120 | 허용 |
| `agent_work_orders.claimed_by` | `claude-<host>` 또는 `pat-<runnerId8>` | `/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/` | **거부** |
| `agent_work_reports.agent` | 동상 | 동상 | **거부** |

`<신원>` = PAT 소유자 이메일 로컬파트를 슬러그한 값, `<host>` = `hostname` 첫 점 앞을 슬러그한 값
(`.claude/skills/dflow-work/scripts/dflow.sh:261-272`).

## 따라서 행의 키

`<신원>/<host>` 를 **호스트(작업 PC) 키**로 잡고 그 아래에 좌석을 단다. 2단 구조다.

- 1단 = 호스트: `jji/macbook` — 여기에 감시자(lead·poll), 슬롯 수, 자격증명(PAT)이 붙는다.
- 2단 = 좌석: `.../w1`, `.../w2`, `.../poll` — 여기에 현재 주문·phase·heartbeat 가 붙는다.

감시자와 워커를 한 행으로 억지로 합치지 않는다. 둘은 접미어가 달라 같은 행이 아니고,
합칠 수 있는 지점은 `<신원>/<host>` 접두어뿐이다.

## 합류가 끊기는 지점 (시안에 명시할 것)

보고 이력(`agent_work_reports.agent`)과 점유 라벨(`claimed_by`)은 정규식이 슬래시를 거부해서
**좌석(슬롯) 단위로 내려오지 않는다.** `claude-<host>` 까지가 한계다.
즉 "이 좌석이 지난주에 무엇을 했는가"는 지금 데이터로 답할 수 없고, "이 호스트가 무엇을 했는가"까지만 된다.
좌석 단위 이력을 원하면 신원 정규화(정규식 확장 또는 별도 컬럼)가 선행 과제다.

## 이력의 유일한 원천

`agent_work_reports` 하나뿐이다(append-only, `agent`·`kind`·`percent`·`summary`·`links`·`evidence`·`created_at`).
- `usage_events` 는 PAT 트래픽을 전혀 기록하지 않는다 — 0078 주석의 "감사는 usage 몫"은 구현되지 않았다.
- `change_logs`·`notification_events` 는 `actor_user_id`(사람)에 귀속되어 에이전트 단위로 못 쪼갠다.
- heartbeat 는 설계상 이력을 남기지 않고 주문 행 4열을 덮어쓴다(0094).
- `~/.dflow/events.jsonl` 은 팀장 PC 로컬 파일이라 서버가 못 본다.

## 자격증명 표시 한계

`agent_runners` 는 RLS 정책 0개, `token_hash` 비노출. 본인 소유분만 조회된다
(`listMyAgentTokens` 가 `owner_user_id` 로 건다). 관리자가 조직 전체 PAT 를 보는 화면은 없다.
표시 한계는 `token_prefix`·`scopes`·`expires_at`·`last_seen_at`·`revoked_at`.

## 결정 (2026-09-18, 사용자)

- 채택 시안은 `claude-v2.html` 이다. v1(`claude.html`)은 비교용으로만 남긴다.
- 좌석은 `팀원 1/2/3` 으로 부르고, 원래 id(`w1`, `<신원>/<host>/w2`)는 보조 글씨로 둔다.
- 팀장(lead)·단독 감시자(poll)도 작업 PC 의 맨 앞 책상에 앉힌다. 신호 기준은 감시자 TTL 70분이다.
- **히어로 디자인 확정**: 다크 그라디언트 띠 + 탭 3개(위임·승인 / 에이전트 스튜디오 / 에이전트) +
  한 문장 요약("작업 PC 3대에서 4명이 일하고 있다. 1명이 당신의 답을 기다린다.") +
  상태별 인원 누적 막대 + 상태 타일 5개(업무 중·결정 대기·무응답·끊김·빈자리) + 우측 상단 "출처 보기" 토글.
- 코덱스 병행 시안은 결과 없이 중단했다(Orca run_f20cb79cd9cd, 30분 넘게 산출물 없음).
- 구현 착수는 아직 아니다 — 명시 지시를 기다린다.
