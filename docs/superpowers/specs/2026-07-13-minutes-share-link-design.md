# 회의록 외부 링크 공유 — 설계 스펙

- 날짜: 2026-07-13
- 상태: 사용자 승인(브레인스토밍 세션에서 범위·열람·수명 관리 선택 완료)
- 선행: `2026-07-09-meeting-minutes-design.md`(보관함), `2026-07-12-minutes-viewer-insights-design.md`(뷰어 인사이트)

## 1. 목표

구글 시트/슬라이드의 "링크가 있는 모든 사용자 보기" 감각으로, 회의록 뷰어에서 **비로그인 외부 열람 링크**를 발급한다. 사내(로그인) 사용자의 전 회의록 열람은 현행 유지 — 이 기능은 로그인 없는 외부인에게 읽기 전용 뷰를 여는 것만 다룬다.

### 사용자 선택(확정)

| 축 | 선택 |
|---|---|
| 공유 범위 | 외부 링크 공유(비로그인 열람) |
| 열람 범위 | 본문 + 목차만 — AI 채팅·하이라이트·인사이트 마킹·첨부·수정 버튼 전부 제외 |
| 수명 관리 | 켜기/끄기 토글 + 재발급(기존 링크 즉시 무효). 만료일 없음 |

## 2. 비범위 (YAGNI)

- 사내 권한 제어(특정 인원/프로젝트 제한, 뷰어·편집자 역할) — 현행 전 회원 열람 유지
- 첨부파일 외부 다운로드, 외부 열람자용 AI 채팅
- 만료일, 비밀번호, 열람 통계
- 목록/보관함 화면의 공유 상태 뱃지(뷰어 모달 안에서만 상태 확인)

## 3. 아키텍처

### 3.1 데이터 (마이그레이션 0026)

`minutes` 테이블에 컬럼 2개 추가:

```sql
alter table minutes add column if not exists share_token uuid;
alter table minutes add column if not exists share_enabled boolean not null default false;
create index if not exists idx_minutes_share_token on minutes(share_token) where share_token is not null;
```

- `share_token`: 첫 공유 ON 때 `crypto.randomUUID()`로 생성(128bit — 추측 불가). 재발급 = 새 UUID로 교체.
- RLS 무변경: 기존 `read_all_minutes`(authenticated)·`update_own_minutes`(owner or `app_role()='pmo_admin'`)가 그대로 적용된다. **anon 정책은 추가하지 않는다** — 비로그인 경로는 아래 서버 컴포넌트가 service_role로만 조회하므로 anon이 REST로 열거할 표면 자체가 없다.
- 브레인스토밍 때 언급한 SECURITY DEFINER RPC는 채택하지 않는다. 이 레포에 이미 서버 전용 `createAdminClient()`(service_role) 패턴이 있어, RPC + anon grant보다 공개 표면이 더 작고 구현이 단순하다. 보안 등가(토큰 대조는 서버에서만).

### 3.2 조회 경로 (공개 페이지)

`src/app/share/minutes/[token]/page.tsx` — `(app)` 그룹 밖 서버 컴포넌트.

- `createAdminClient()`로 `minutes where share_token = :token and share_enabled = true` 단건 조회. 반환 컬럼: `minute_date, team_code, title, body_md` **만**(작성자 실명 미노출 — 대회 실명 제거 방침과 일관).
- 토큰 형식이 UUID가 아니거나 미일치/OFF면 `notFound()` — 존재 여부를 구분해 주지 않는다(404 단일 응답).
- `export const metadata = { robots: { index: false, follow: false } }` 로 검색엔진 차단.
- 미들웨어 matcher의 부정 룩어헤드에 `share` 추가 — 비로그인 접근이 `/login`으로 리다이렉트되지 않게 한다. 나머지 전 경로의 인증 게이트는 불변.

### 3.3 공개 뷰어 컴포넌트

`src/components/minutes/ShareViewer.tsx` (client) — 미니멀 읽기 전용 셸:

- 상단 바: 로고 + 제목 + 날짜 + 팀 뱃지. 앱 사이드바/헤더/채팅 없음.
- 본문: 기존 `MarkdownView`(marks 없이) 재사용. 목차: 기존 `MinuteToc` 재사용(insights/highlights는 빈 배열) + `MinuteViewer`와 동일한 jumpTo/스크롤 스파이 로직의 축약판.
- 블록 클릭 팝오버 없음(onClick 미부착), 하이라이트/인사이트 데이터 미전달.
- 루트 레이아웃의 Theme/Locale/Toast 프로바이더가 감싸므로 `useLocale` 사용 가능.

### 3.4 공유 관리 (서버 액션)

`src/app/actions/minutes.ts`에 2개 추가:

- `getMinuteShare(id)` → `{ ok, enabled, token? }`: 로그인 + (소유자 or pmo_admin) 검증 후 반환. 토큰은 이 액션으로만 클라이언트에 전달 — 페이지 payload(`Minute` 타입)에 넣지 않아 일반 열람자에게 새지 않는다.
- `setMinuteShare(id, op: 'enable' | 'disable' | 'regenerate')` → `{ ok, enabled, token?, error? }`: 동일 검증. enable은 토큰 없으면 생성, disable은 `share_enabled=false`(토큰 보존 — 다시 켜면 같은 링크), regenerate는 새 UUID + enabled 유지. 쓰기는 일반 서버 클라이언트(RLS `update_own_minutes`가 최종 방어선).

브레인스토밍에서 언급한 `POST /api/minutes/[id]/share` 라우트 대신 서버 액션을 쓴다 — 이 레포의 기존 뮤테이션 패턴(`replaceMinuteBody` 등)과 일관.

### 3.5 뷰어 UI (공유 모달)

- `MinuteViewer` 메타 헤더 액션 줄(펼침 영역)에 `canManage`일 때 "공유" 버튼(Share2 아이콘) 추가.
- 클릭 → `MinuteShareModal`(신규, `Modal` size sm/md, 기존 z-150 스케일): 열릴 때 `getMinuteShare` 호출 → 토글 스위치(ON/OFF), ON이면 전체 URL 표시 + "링크 복사"(clipboard API + 토스트) + "재발급"(확인 문구 포함 — 기존 링크 즉시 무효 경고).
- URL 조립: `window.location.origin + /share/minutes/ + token`.
- i18n: `min.share.*` 키를 ko/en 딕셔너리에 추가.

## 4. 보안 검토

- **열거 불가**: anon용 RLS 정책·RPC 없음. 유일한 비로그인 표면은 `[token]` 페이지이고 service_role 쿼리는 정확 일치만 조회.
- **토큰 강도**: UUID v4 122bit 랜덤 — URL 추측 불가. 토큰은 소유자/관리자에게만 서버 액션으로 전달.
- **즉시 차단**: OFF/재발급은 DB 단일 행 갱신 — 다음 요청부터 404. 정적 캐시 방지를 위해 공개 페이지는 동적 렌더(admin 클라이언트 쿼리로 자동 dynamic, 필요시 `dynamic = 'force-dynamic'` 명시).
- **실명·부속 데이터 미노출**: 반환 컬럼 화이트리스트(작성자·첨부·하이라이트·인사이트 제외).
- **검색엔진**: noindex 메타. sitemap 미등록.

## 5. 에러 처리

- 잘못된/꺼진/삭제된 토큰 → 404(not-found 페이지).
- 서버 액션 실패 → 모달 내 에러 문구 + 토스트, 토글 상태 롤백.
- clipboard 실패(비보안 컨텍스트 등) → URL 텍스트 선택 가능한 input으로 표시(수동 복사 가능).

## 6. 테스트 & 검증

- 유닛: 서버 액션 권한 분기(비로그인/비소유자 거부), op별 상태 전이(enable→disable→enable 토큰 보존, regenerate 토큰 교체)는 로직 함수로 분리해 테스트(`tests/minutes/share.test.ts`).
- 게이트: `npm run build` + lint + 기존 테스트 전체 그린.
- 런타임: verify 스킬 절차(브라우저 없이 curl) — 공개 라우트 200/404 분기는 배포 후 프로덕션 URL로 확인(로컬 dev도 프로덕션 DB 공유이므로 테스트 프로젝트 회의록으로만 검증).

## 7. 배포 순서

1. 마이그레이션 0026 프로덕션 적용(Management API 레시피 — 컬럼 추가만이라 무중단·추가적).
2. 코드 푸시(main) → Vercel 배포.
3. 테스트 회의록으로 공유 ON → 시크릿 창 열람 → OFF 즉시 404 → 재발급 후 구 링크 404 확인.
