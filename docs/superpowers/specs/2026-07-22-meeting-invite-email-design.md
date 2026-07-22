# 회의 안내 메일 자동 발송 설계

- 작성일: 2026-07-22
- 상태: 설계 확정 (구현 전)
- 범위: 회의일정 메뉴에서 **새 회의를 만들 때** 선택한 참석자에게 회의 안내 메일을 자동 발송한다.

## 1. 배경과 목표

`회의일정`에서 회의를 만들면 참석자를 고를 수 있지만, 그 사실이 참석자에게 전달되는 경로가 없다.
앱에 들어와 달력을 열어야만 알 수 있다. 회의를 만든 사람이 따로 구두·메신저로 알리는 것이 현재의 실질적 운영이다.

이 설계는 그 수동 단계를 없앤다. 회의를 저장하면 참석자에게 메일 한 통이 나간다.

### 확정된 요구사항

| 항목 | 결정 |
|---|---|
| 메일 형태 | **알림 메일만.** 캘린더 초대(`.ics`) 아님 |
| 발신 경로 | **Gmail SMTP** + 앱 비밀번호 (개인 계정, 임시방편임을 인지) |
| 발송 시점 | **회의 저장 시 자동.** 폼의 체크박스로 끌 수 있음 (기본 켜짐) |
| 발송 범위 | **생성 시에만.** 수정·취소·리마인더는 범위 밖 |
| 대기 여부 | **기다린다.** 발송 결과를 사용자에게 보여준다 |
| 수신자 구성 | **참석자 전원을 `To`에 한 통**, `Reply-To`는 회의 작성자 |

### 성공 기준

1. 참석자를 골라 회의를 저장하면, 이메일이 있는 참석자 전원이 회의 안내 메일을 받는다.
2. 메일 발송이 어떤 이유로 실패해도 **회의 데이터는 정상 저장된다.**
3. 메일을 못 받은 참석자가 있으면 **회의를 만든 사람이 즉시 안다.**

## 2. 현재 코드 상태

```
MeetingsView.tsx
  └ MeetingFormModal.tsx  ── MeetingAttendeePicker (project_members.id[] 선택)
        └ createMeeting(projectId, input)   src/app/actions/meetings.ts:103
              ├ meetings insert
              └ replaceAttendees() → meeting_attendees insert
                    실패 시 방금 만든 meetings 행을 삭제(보상 롤백)
```

관련 사실:

- `project_members.email`은 **nullable**이다. 참석자 피커(`MeetingAttendeePicker.tsx:57`)에 이미 "이메일 없음" 경고 아이콘이 있다.
- `getProjectMembers`(`src/lib/data/members.ts`)는 `email`을 클라이언트 페이로드에 포함시킨다. 피커의 경고가 그것을 쓴다.
- `getMeetingDetail(id)`는 `{ meeting, attendees: MeetingAttendeeInfo[] }`를 반환하고 `attendees`에 `email`이 들어 있다. **재사용 가능하다.**
- `useToast()`(`src/components/ui/Toast.tsx`)가 이미 있다. success/error/info, 3.5초 자동 소멸.
- **메일 발송 인프라는 전무하다.** `package.json`에 메일 라이브러리 없음, 환경변수는 Supabase 3개 + `GEMINI_API_KEY`뿐, 크론 없음(`vercel.json`은 `regions: ["icn1"]`만).
- `0011_member_email_check`의 이메일 CHECK 제약은 `NOT VALID`이고 백필은 실행된 적이 없다. **형식이 깨진 이메일이 DB에 존재할 수 있다.**

## 3. 아키텍처 결정

### 결정: 발송을 `createMeeting`에서 분리한다

`createMeeting`은 손대지 않는다. 모달이 저장 성공(`res.ok`)을 받은 뒤, 체크박스가 켜져 있으면
**두 번째 서버 액션** `notifyMeetingCreated(meetingId)`를 호출한다.

근거:

1. **회의 저장은 메일 때문에 실패해서는 안 된다.** 이미 커밋된 뒤에 부르므로 구조적으로 불가능해진다.
2. `createMeeting`은 이미 참석자 저장 실패 시 회의를 롤백하는 보상 로직으로 복잡하다(`meetings.ts:126-137`).
   여기에 발송·부분실패를 얹으면 "무엇이 저장을 실패시키는가"가 흐려진다.
3. 회의 ID 하나만 받는 순수한 단위이므로, 나중에 재발송·수정알림·리마인더가 같은 함수를 재사용한다.
4. 저장 로직을 건드리지 않고 발송만 격리 테스트할 수 있다.

대가: 서버 왕복이 1회 늘어난다(저장 후 1~3초 추가 대기). 기다리기로 합의했으므로 수용한다.

### 검토했으나 버린 안

- **`createMeeting` 안에서 직접 발송** — 왕복은 줄지만 위 1·2·3을 전부 잃는다.
- **API 라우트 + 백그라운드 큐** — "기다리고 결과를 본다"를 선택했으므로 비동기 이점이 사라진다.
  발송 로그 화면까지 새로 만들어야 한다. 이 요구사항에는 과설계다.

### 트랜스포트를 어댑터로 둔다

Gmail 개인 계정은 임시방편이다. 사내 SMTP나 Resend로 갈아탈 때
`src/lib/mail/transport.ts` 한 파일만 바꾸면 되도록 격리한다. 지금 추상화가 필요해서가 아니라,
교체가 예정된 부품이기 때문이다.

## 4. 모듈 구조

```
신규
  src/lib/mail/transport.ts          nodemailer 트랜스포트 — 유일한 부작용 지점
  src/lib/mail/meetingInvite.ts      회의 → {subject, html, text} 순수 렌더
  src/lib/mail/recipients.ts         classifyRecipients() 순수 분류
  src/app/actions/meetingNotify.ts   서버 액션 — 권한→조회→분류→렌더→전송→결과

수정
  src/components/meetings/MeetingFormModal.tsx   체크박스·결과 패널·폼 잠금
  src/lib/i18n/dict/meetings.ts                  신규 문구

불변
  src/app/actions/meetings.ts        한 줄도 건드리지 않는다
```

경계 원칙: **순수한 렌더링과 부작용 있는 전송을 가른다.** SMTP를 띄우지 않고 메일 내용과
수신자 분류를 검증할 수 있어야 한다.

## 5. 계약

```ts
// src/app/actions/meetingNotify.ts
export interface MeetingNotifyResult {
  ok: boolean
  error?: string                                  // 전송 자체가 불가능했던 사유(사용자 표시용)
  sentTo: string[]                                // 메일이 나간 참석자 이름
  skipped: { name: string; reason: SkipReason }[] // 제외된 참석자와 이유
}

export type SkipReason = 'no_email' | 'invalid_email' | 'rejected'

export async function notifyMeetingCreated(meetingId: string): Promise<MeetingNotifyResult>
```

**인자가 `meetingId` 하나뿐인 것은 의도적이다.** 클라이언트가 수신자 목록을 넘기지 않으므로,
조작된 요청으로 임의의 주소에 메일을 보낼 수 없다. 수신자는 서버가 DB에서 다시 읽는다.

```ts
// src/lib/mail/recipients.ts
export interface Classified {
  valid: { name: string; email: string }[]
  skipped: { name: string; reason: 'no_email' | 'invalid_email' }[]
}
export function classifyRecipients(attendees: MeetingAttendeeInfo[]): Classified
```

```ts
// src/lib/mail/meetingInvite.ts
export function renderMeetingInvite(input: {
  meeting: Meeting
  attendeeNames: string[]
  senderName: string
  appUrl: string | null
}): { subject: string; html: string; text: string }
```

```ts
// src/lib/mail/transport.ts
import 'server-only'

export interface MailMessage {
  to: string[]
  replyTo: string | null
  subject: string
  html: string
  text: string
}

export type Transport =
  | { ok: true; send: (msg: MailMessage) => Promise<{ rejected: string[] }> }
  | { ok: false; error: string }

export function getTransport(): Transport
```

`from`은 `MailMessage`에 없다. 발신 계정은 트랜스포트가 환경변수로 소유하며 호출자가 바꿀 수 없다.

## 6. 액션 실행 순서

1. `getMembership()` + `getSession()` — 없으면 `{ ok: false, error: '로그인 필요', sentTo: [], skipped: [] }`
2. `getMeetingDetail(meetingId)` — 없으면 `회의를 찾을 수 없습니다.`
3. **권한 게이트**: `meeting.createdBy === user.id || membership.role === 'pmo_admin'`.
   아니면 `권한 없음`으로 즉시 반환하고 **트랜스포트를 만들지 않는다.**
   이 게이트가 없으면 남의 회의 ID로 메일을 반복 발송하는 통로가 열린다.
4. `classifyRecipients(attendees)`
5. `valid.length === 0`이면 **전송을 시도하지 않고** `{ ok: true, sentTo: [], skipped }` 반환.
   빈 `To`로 SMTP를 때리면 계정 평판만 깎인다.
6. `getTransport()` — `ok: false`면 그 `error`를 그대로 반환
7. `renderMeetingInvite(...)` → `send(...)`
8. `info.rejected`에 담긴 주소를 `skipped`에 `reason: 'rejected'`로 합쳐 반환

## 7. 메일 내용

### 제목

```
[회의 안내] 주간 진척 점검 · 7/25(금) 14:00
```

반복 회의:

```
[회의 안내] 주간 진척 점검 · 매주 금요일 14:00 (7/25~8/29)
```

종일 회의는 시각을 생략하고 `종일`로 표기한다.

날짜·요일은 `meeting_date` 문자열(`YYYY-MM-DD`)을 **UTC로 파싱해** 계산한다.
기존 `expandMeetings`(`src/lib/domain/meetings.ts`)와 같은 규칙이며, 로컬 타임존으로 파싱하면
서버 타임존에 따라 요일이 하루 어긋난다.

### 본문 항목

일시 / 장소 / 구분 / 참석자 명단 / 안건(회의 `body`) / 작성자 / `회의일정에서 보기` 링크.
장소·안건이 비어 있으면 해당 줄을 아예 넣지 않는다(빈 항목을 나열하지 않는다).

### 헤더

```
From:     "D-CUBE 회의알림" <SMTP_USER>
Reply-To: 회의 작성자 이메일
To:       참석자 전원
```

Gmail은 `From` 주소를 인증 계정으로 강제하므로 표시명만 바꾼다.
회신이 개인 Gmail이 아니라 회의를 만든 사람에게 가도록 `Reply-To`를 지정한다.

### 형식 규칙

- **HTML과 텍스트 두 파트를 모두 생성한다.** 텍스트 파트가 없는 메일은 스팸 점수가 올라간다.
  개인 Gmail 발신은 그 여유가 없다.
- **제목·장소·안건·참석자 이름을 HTML 이스케이프한다.** 전부 사용자 입력이며 메일 클라이언트에서 렌더된다.
- **본문 언어는 한국어 고정.** 앱은 ko/en을 지원하지만 수신자의 언어를 알 수 없고
  (발신자 로케일을 쓰는 것은 틀린 답이다) 참석자 대부분이 한국어 사용자다.

## 8. 사용자 흐름

### 폼

참석자 피커 바로 아래에 체크박스 한 줄: `참석자에게 회의 안내 메일 보내기`. 기본 켜짐.

- **신규 생성일 때만 노출한다**(`initial === null`). 수정은 발송 범위 밖이므로 체크박스도 없어야 혼란이 없다.
- 참석자가 0명이면 비활성 + `참석자를 선택하면 메일을 보낼 수 있습니다`.

### 저장 이후

`createMeeting`이 성공하고 체크가 켜져 있으면 버튼이 `메일 보내는 중…`으로 바뀌고
`notifyMeetingCreated(id)`를 기다린다. 결과는 세 갈래다.

| 결과 | 화면 |
|---|---|
| 전원 발송 (`skipped` 없음) | 모달 닫힘 + 토스트(success) `참석자 5명에게 회의 안내 메일을 보냈습니다` |
| 일부 제외 | **모달 유지**, 결과 패널: `회의가 저장되었습니다. 4명에게 발송했고, 이메일이 없는 김OO·박OO은 제외했습니다.` |
| 발송 실패 | **모달 유지**, 오류 패널: `회의는 정상 저장되었습니다. 다만 메일 발송에 실패했습니다 — {사유}` |

토스트는 3.5초 뒤 사라지므로 **성공 케이스에만** 쓴다.
사용자가 알아야 할 나쁜 소식은 모달에 남긴다.

### 중복 생성 방지

결과 패널 때문에 모달이 열린 채 남으면 사용자가 저장 버튼을 다시 눌러
**같은 회의를 하나 더 만들 수 있다.** 그래서 결과 패널이 뜨는 순간:

- 폼 전체를 읽기전용으로 잠근다
- 푸터 버튼을 `닫기` 하나로 교체한다
- 닫으면 평소처럼 `onSaved()`가 실행되어 목록이 갱신된다

## 9. 실패 모드

| 상황 | 처리 |
|---|---|
| `SMTP_USER`/`SMTP_PASS` 미설정 (로컬·Preview) | **throw하지 않고** `{ ok: false, error: '메일 발송이 설정되지 않았습니다.' }` 반환. `service_role`이 Preview에서 throw해 화면을 죽이던 전례를 반복하지 않는다 |
| 앱 비밀번호 만료·취소 (`EAUTH`) | 사용자에겐 `메일 계정 인증에 실패했습니다.` **원문 에러는 서버 로그에만.** 에러 메시지에 계정 정보가 섞여 나간다 |
| Gmail 응답 지연 | connection/greeting/socket 타임아웃 **각 10초** 명시. nodemailer 기본값은 훨씬 길어 사용자가 저장 버튼 앞에서 하염없이 기다린다 |
| 형식이 깨진 이메일 (0011 미백필) | `classifyRecipients`가 `invalid_email`로 걸러낸다. 그대로 넘기면 **메일 한 통 전체가 거절되어 멀쩡한 참석자까지 못 받는다** |
| 유효 주소 0명 | 전송 시도를 건너뛰고 `ok: true` + 전원 `skipped` |
| Gmail이 일부 주소 거절 | `info.rejected`를 `skipped`에 `reason: 'rejected'`로 합친다 |
| 액션 호출 자체가 실패(네트워크) | `회의는 저장되었으나 발송 결과를 확인하지 못했습니다.` — 회의가 사라진 게 아님을 반드시 알린다 |

## 10. 보안

- **권한 게이트**(작성자 또는 `pmo_admin`)가 유일한 남용 차단선이다. 이것이 없으면 메일 폭탄 통로가 된다.
- `transport.ts` 최상단에 `import 'server-only'` — `SMTP_PASS`가 클라이언트 번들에 새는 경로를 빌드 타임에 차단한다.
- 사용자 입력을 HTML 이스케이프한다(메일 클라이언트에서의 HTML 인젝션).
- SMTP 원문 에러를 사용자에게 노출하지 않는다(계정·호스트 정보 유출).
- 참석자 이메일이 `To`에 서로 공개된다. 사내 회의라는 전제 하에 합의된 사항이다.

## 11. 환경변수

| 이름 | 용도 |
|---|---|
| `SMTP_USER` | Gmail 주소 (발신 계정) |
| `SMTP_PASS` | Google **앱 비밀번호**. 일반 비밀번호가 아니며 2단계 인증이 켜져 있어야 발급된다 |
| `MAIL_FROM_NAME` | 발신인 표시명. 기본값 `D-CUBE 회의알림` |
| `NEXT_PUBLIC_APP_URL` | 메일 속 링크의 절대 주소. 없으면 `VERCEL_PROJECT_PRODUCTION_URL`로 폴백하고, 그것도 없으면 링크를 생략한다 |

`.env.local.example`에 네 항목을 추가한다.
Vercel에는 **Production 환경**에 등록한다(Preview는 미설정 상태로 두고 위 실패 모드로 처리).

새 의존성: `nodemailer` 1개. `smtp.gmail.com:465`(secure)로 접속한다.

**DB 마이그레이션은 없다.** 새 테이블도 새 컬럼도 필요하지 않다.

## 12. 테스트

기존 `tests/actions/announcement-from-meeting-gate.test.ts` 패턴을 따른다.

| 파일 | 검증 |
|---|---|
| `tests/mail/meetingInvite.test.ts` | 반복 회의 표기, 종일 회의, 장소·안건 없음, `<script>` 이스케이프, 참석자 명단, text 파트 존재 |
| `tests/mail/recipients.test.ts` | `classifyRecipients()` — 정상 / null / 공백 / 형식오류 분류 |
| `tests/actions/meeting-notify-gate.test.ts` | 비작성자·비pmo는 거부하고 **트랜스포트를 만들지 않는다** |

수동 검증: 로컬에서 본인 주소를 참석자로 넣어 실제 1회 발송하고, HTML·텍스트 렌더와 `Reply-To`를 눈으로 확인한다.

## 13. 범위 밖

의도적으로 제외한다:

- 회의 수정·취소 시 알림
- 하루 전 리마인더 및 Vercel Cron
- `.ics` 캘린더 초대 (`METHOD:REQUEST`/`PUBLISH`)
- 발송 이력 DB 테이블, 재발송 버튼
- 수신 거부(opt-out) 설정
- 개별 발송 / BCC 발송
- 영문 메일 본문

## 14. 미해결 사항

- **Gmail 발신의 사내 전달률은 실측이 필요하다.** `@dongkuk` 게이트웨이가 개인 Gmail 발신을 어떻게 판정하는지는
  실제로 보내보기 전까지 알 수 없다. 스팸함으로 간다면 발신 경로 교체(사내 SMTP 릴레이 또는 도메인 인증된 외부 API)가
  후속 과제가 된다. 트랜스포트를 어댑터로 둔 이유가 이것이다.
- 무료 Gmail은 하루 약 500 수신자 제한이 있다. 현재 사용량으로는 충분하지만 상한이 존재한다는 사실은 기록해 둔다.
