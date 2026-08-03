# 멤버/권한 화면 용어 정리 — 설계

작성일: 2026-08-03

## 문제

이 시스템에는 "멤버"가 두 개, "admin"이 두 개 있고 서로 다른 것을 가리킨다.

**① 권한 축 — 무엇을 할 수 있나**

| 테이블 | 뜻 |
|---|---|
| `auth.users` | 로그인 계정 |
| `memberships` (user_id PK) | 계정 ↔ 소속 팀 + `is_superuser`(전역 등급) |
| `project_roles` (project_id, user_id) | `admin` \| `member`. 행 부재 = 조회 전용(viewer) |

판정은 `is_superuser` + `project_roles` 두 개로만 한다(`src/lib/domain/authz.ts`).
`memberships.role` 은 0054 에서 deprecated — not null 제약 때문에 더미 값만 채운다.

**② 인력 명단 축 — 이 프로젝트에 누가 있나**

| 테이블 | 뜻 |
|---|---|
| `project_members` | 프로젝트별 인력 로스터. `role: admin \| contributor` + 이름·이메일·팀·직함 |

권한이 아니라 **표시용 명단**이다. 로그인하지 않는 외부 인력·협력사도 넣을 수 있게
`user_id` 가 nullable 이다(0003 설계 의도, 0019 는 링크 컬럼만 추가).
근태(`attendance_records.member_id`)·회의 참석자·이슈 담당자가 이 로스터의 id 를 참조한다.

**혼란의 진원지**: `/p/{id}/members` 화면이 `project_members.role='admin'` 을 세어
**"ADMINS / 프로젝트 관리자"** KPI 로 크게 띄운다. 사실과 다르다 — 진짜 관리자는
`project_roles` 이고 `/p/{id}/settings › 권한` 과 `/admin/accounts` 에 있다.
같은 화면군에서 '관리자'가 두 뜻으로 쓰인다.

## 결정

**표시 문자열만 바꾼다.** DB 값(`admin`/`contributor`)·타입·권한 판정 로직은 무변경.
마이그레이션 없음. 데이터 이관 없음.

명단 축의 직책명을 권한 어휘와 겹치지 않는 말로 바꾸고(**리더 / 실무**),
두 화면이 서로를 안내하게 한다.

기각한 대안:
- *DB 구조 개편(테이블 통합·컬럼 개명)* — 근태·이슈·회의 참석자가 전부 로스터 id 를
  참조해 비용이 크다. 혼란의 90%는 라벨에서 오므로 비용 대비 효과가 나쁘다.
- *두 축 자동 동기화(권한 부여 시 로스터 자동 등록)* — 별개 과제. 이번 범위 밖.
- *명단에서 직책 표시 자체를 제거* — KPI 카드 하나와 입력 필드가 사라져 정보가 준다.

## 변경 내역

### ① 명단 화면 `/p/{id}/members`

`src/lib/i18n/dict/members.ts` (ko/en 동시 — en 은 `Record<keyof ko, string>` 이라 키 패리티가 컴파일 타임에 강제된다):

| 키 | 지금 | 바꿀 것 |
|---|---|---|
| `members.roleAdmin` | 관리자 / Admin | 리더 / Lead |
| `members.roleContributor` | 기여자 / Contributor | 실무 / Contributor |
| `members.kpiAdminsSub` | 프로젝트 관리자 | 총괄·리더 |
| `members.kpiContributorsSub` | 실무 기여자 | 실무 담당 |
| `members.heroDesc` | 참여자를 역할과 소속이 명확한 팀 보드로 정리했습니다. | 근태·회의 참석자의 기준이 되는 참여 인력 명단입니다. |
| `members.fieldRole` | 역할 | 명단 구분 |

신규 키 2개 — 안내 문구와 링크 라벨(`members.rosterNotice`, `members.rosterNoticeLink`).

`page.tsx`: KPI 라벨 `ADMINS` → `LEADS`, 아이콘 `ShieldCheck` → `UserCog`.
`MembersBoard.tsx`: 리더 배지 아이콘도 `ShieldCheck` → `UserCog`.
방패는 권한 기호라 명단 화면에 있으면 오해를 부른다.

**안내 한 줄** — 보드 헤더 바로 아래, 스크롤되지 않는 고정 영역:

> ℹ️ 여기는 참여 인력 명단입니다 (근태·회의 참석자 기준). 로그인 권한은 설정 › 권한에서 관리합니다. →

링크는 `canEdit`(프로젝트 관리자)일 때만 건다. 멤버가 눌러 가면 권한 섹션이 보이지
않아 막다른 길이 된다(settings 페이지 자체는 전원 접근 가능, 권한 섹션만 `isAdmin` 게이트).
문장은 전원에게 노출한다.

### ② 권한 화면 `/p/{id}/settings › 권한`

섹션 제목 아래 설명 한 줄:

> 로그인 계정의 이 프로젝트 권한입니다. 참여 인력 명단은 팀 구성에 있습니다. →

이 섹션은 관리자에게만 보이므로 링크에 조건을 걸지 않는다.

### ③ 챗봇

봇이 명단을 읽어 "관리자"라고 말하면 화면과 어긋난다.

- `src/lib/ai/chat/orchestrator.ts` 라벨 맵: `admin: '관리자', contributor: '구성원'`
  → `admin: '리더', contributor: '실무'`. 바로 위 주석 `// 공지 분류 · 멤버 권한` 도
  `// 공지 분류 · 멤버 명단 구분` 으로 — 주석 자체가 이것을 권한이라 잘못 부르고 있다.
  이 맵은 값으로 키를 잡는 전역 맵이지만 봇은 `project_roles` 를 노출하지 않으므로
  (읽기 전용 도구에 권한 도메인이 없다) `admin` 키의 소비자는 로스터뿐이다.
- `src/lib/ai/chat/planner.ts` `list_members.argHints`:
  `role은 admin|contributor` → `role은 admin|contributor (명단 구분: 리더/실무 — 권한 아님)`.
- `tests/ai/golden/cases.ts`: "리더 멤버 알려줘" → `list_members {role:'admin'}` 골든 케이스 추가.
  기존 "관리자 멤버 알려줘" 케이스는 그대로 둔다 — 사용자가 옛 말을 써도 잡혀야 한다.

### ④ 주석 고정

`src/lib/domain/types.ts` `ProjectMemberRole` 에 JSDoc 한 줄:
"명단 표시용 구분이다. 권한이 아니다 — 권한은 `project_roles`." 다음 사람이 같은 곳에서
헷갈리지 않게 타입 선언부에 박아 둔다.

## 범위 밖

- `/admin/accounts` — 이미 "계정 관리"라 명확하다. 손대지 않는다.
- 명단 카드에 각자의 실제 권한(viewer/member/admin) 배지 표시 — 두 축 연결에 해당.
- `memberships.role` deprecated 컬럼 제거 — 별개 마이그레이션 과제.

## 검증

- `npm run lint` · `npm run build` · `npm run test`
- i18n ko/en 키 패리티는 타입이 강제한다.
- 봇 회귀는 골든 테스트가 잡는다.
- 건드리는 파일 중 CLAUDE.md 의 UI 위험 파일(`globals.css` · `layout.tsx` ·
  `(app)/layout.tsx` · `components/app/*`)은 **없다.** main 직행 가능하며 커밋에
  `Preview-checked: n/a — 표시 문자열·아이콘만 교체` 트레일러를 단다.
