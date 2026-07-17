# 회의일정 → 공지 원클릭 등록 설계

**날짜:** 2026-07-17
**상태:** 승인됨 → 구현 대기

## 배경 / 목적

회의일정(회의 상세)에서 그 회의를 곧바로 공지사항으로 등록할 수 있게 한다.
PMO가 회의를 만든 뒤 공지 페이지로 이동해 같은 내용을 다시 타이핑하는 이중 작업을
없앤다. 회의는 그대로 유지하고, 그 내용을 바탕으로 **별도의** 공지를 하나 생성한다
("공지로**도**"의 의미 — 이전이 아니라 파생).

## 확정 요구사항

- **동작:** 회의는 두고 공지를 새로 생성 (원본 회의 유지)
- **흐름:** 원클릭 즉시 등록 (공지 폼 미리채움 없음)
- **권한:** `pmo_admin`만 버튼 노출 + 서버 재검증

## 배치

`src/components/meetings/MeetingDetailModal.tsx` 푸터에 **"공지로 등록"** 버튼.
- `role === 'pmo_admin'`일 때만 노출. role은 전역 단일값(`getMembership`)이라
  프로젝트 회의 뷰와 전역 "내 회의" 뷰 모두에서 일관되게 동작.
- 공지 생성 권한(`createAnnouncement`)이 pmo_admin 전용인 것과 정합.

## 동작 (원클릭 즉시 등록)

1. PMO가 회의 상세에서 **공지로 등록** 클릭.
2. 서버 액션 `createAnnouncementFromMeeting(meetingId, occurrenceDate)` 호출.
   - `pmo_admin` 재검증 (방어선 — 버튼 숨김에 의존하지 않음).
   - `meetings` 행 재조회(title, body, start_time, end_time, location, project_id 등).
   - 기존 `occurrenceGate` 로직을 재사용해 **occurrenceDate가 실제 규칙상 회차인지**
     검증(클라이언트가 보낸 날짜 불신). 단, 비반복 회의도 허용해야 하므로
     occurrenceGate의 "반복 회의만" 게이트는 이 경로에 맞게 조정/분기한다.
   - 서버에서 공지 본문을 조합한 뒤 `announcements` insert.
   - 작성자 워터마크 전진(`advanceSeenWatermark`) + `revalidateAnnouncements`.
3. 성공 시 버튼이 **"✓ 공지 등록됨"** 확정 상태로 바뀌고 비활성화(중복 클릭 방지).
   모달은 열린 채 유지 — 사용자가 직접 닫는다.
4. 실패 시 기존 모달의 `error` 영역에 메시지 표시.

## 생성되는 공지 내용

| 필드 | 값 |
|------|-----|
| title | 회의 제목 그대로 |
| body | 아래 형식으로 **서버**에서 조합(평문) |
| category | `general`(일반) 고정 |
| isPinned | false |
| publishFrom | 오늘 (Asia/Seoul, `seoulToday`) |
| publishTo | `max(오늘, 회의 회차일)` — 지금부터 회의 당일까지 게시 |

`publishTo`를 `max(오늘, 회차일)`로 두는 이유: 회차일이 과거인 회의를 공지로 올려도
`publishFrom(오늘) > publishTo` 위반이 나지 않도록 하기 위함. 회차일이 미래면
오늘~회차일 게시, 과거면 오늘 하루 게시.

### body 조합 형식 (한글 라벨 고정, 평문 저장)

```
일시: 2026-07-20 14:00–15:00
장소: 3F 회의실

{회의 본문 — 있을 때만}
```

- 종일 회의(start_time null): 시간 없이 `일시: 2026-07-20 (종일)` 형태.
- start_time 있고 end_time 없음: `일시: 2026-07-20 14:00`.
- 장소 없으면 `장소:` 줄 생략.
- 회의 본문 없으면 본문 블록 생략(일시/장소 줄만).
- 공지 본문은 DB에 평문 1벌로 저장되며 뷰어 언어로 재번역되지 않는다(기존 공지도
  사용자가 한글로 작성). 따라서 한글 라벨 고정.

## 파일 변경

1. **`src/app/actions/announcements.ts`**
   - `createAnnouncementFromMeeting(meetingId, occurrenceDate)` 추가.
   - 회차 검증 로직은 `src/app/actions/meetings.ts`의 `occurrenceGate` 패턴 참고
     (필요 시 비반복 허용 분기). 본문 조합 헬퍼 + `seoulToday`/`advanceSeenWatermark`/
     `revalidateAnnouncements` 재사용.
2. **`src/components/meetings/MeetingDetailModal.tsx`**
   - "공지로 등록" 버튼 + `posting`/`posted` 상태.
   - 성공 시 확정 상태(`posted`) 표시. 실패 시 기존 `error` 영역 사용.
3. **`src/lib/i18n/dict/meetings.ts`**
   - `meetingsKo` / `meetingsEn`에 키 추가:
     - `meet.detail.postAsAnnouncement` — "공지로 등록" / "Post as announcement"
     - `meet.detail.postedAsAnnouncement` — "공지 등록됨" / "Posted"
     - `meet.detail.posting` — "등록 중…" / "Posting…"
     - `meet.detail.postFailed` — "공지 등록에 실패했습니다." / "Failed to post announcement."

## 의도적으로 안 하는 것 (YAGNI)

- 공지 폼 미리채움(사용자가 원클릭 선택).
- 회의 카테고리 → 공지 카테고리 매핑(항상 `general`).
- 중복 등록 DB 제약(같은 회의를 두 번 공지할 수도 있음 — pending + 확정상태로만 방지).
- 회의↔공지 양방향 링크/역참조.

## 테스트 관점

- `createAnnouncementFromMeeting`: 비pmo_admin 거부 / 존재하지 않는 회의 거부 /
  가짜 occurrenceDate 거부 / 성공 시 announcements 1행 + 올바른 publish 기간.
- body 조합: 종일·시간만·시간범위·장소유무·본문유무 조합.
- `publishTo = max(오늘, 회차일)` 경계(과거 회차일).

## 데이터베이스

스키마 변경 없음. 기존 `announcements` 테이블에 insert만 수행.
