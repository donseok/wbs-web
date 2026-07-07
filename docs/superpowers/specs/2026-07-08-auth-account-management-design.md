# 로그인·계정 관리 기능 설계 (v1)

- 작성일: 2026-07-08
- 대상 앱: wbs-web (Next.js 15 App Router + Supabase Auth)
- 상태: 승인됨 (구현 계획 대기)

## 1. 목적

현재 앱에는 로그인 화면만 있고 가입·비밀번호 변경·비밀번호 찾기·아이디 찾기 기능이 없다.
사내 프로젝트 관리 도구 성격에 맞게 **최대한 단순하게** 다음을 제공한다.

1. 관리자가 새 로그인 계정을 만든다(단건 + 일괄).
2. 로그인한 사용자가 본인 비밀번호를 변경한다.
3. 비밀번호를 잊은 사용자를 관리자가 임시 비밀번호로 리셋한다.
4. 아이디(=이메일)를 잊은 사용자를 위한 안내를 제공한다.

핵심 방향: **공개 가입 없음 → 관리자 초대형.** 신규 DB 테이블 0개. 기존 `auth.users + memberships` 구조를 그대로 사용한다.

## 2. 현재 상태 (설계 근거)

- 인증: Supabase Auth 이메일/비밀번호. 로그인은 `signInWithPassword({ email, password })`. **별도 username 없음 — 아이디 = 이메일.**
- 계정 모델:
  - `auth.users` + `memberships`(`user_id` → `team_id` + `role`) = 실제 로그인 계정. **membership(팀·권한)이 있어야 앱 사용 가능.**
  - `project_members` = 프로젝트 명단 데이터(로그인 계정 아님). 본 설계와 무관.
- 팀 코드: `PMO · 가공 · ERP · MES` (`teams.code`, 마이그레이션 0014에서 DT→가공).
- 계정 권한(`memberships.role`): `pmo_admin` (PMO 관리자) · `team_editor` (팀 편집자).
- `src/lib/supabase/admin.ts`에 service_role 클라이언트(`createAdminClient()`)가 이미 존재 — RLS 우회, 서버 전용.
- `src/middleware.ts`가 미로그인 사용자를 전부 `/login`으로 리다이렉트. `/login`과 정적 자산만 예외.
- `src/components/app/HeaderChrome.tsx` 프로필 팝오버에 현재 "로그아웃"만 존재.
- SMTP(메일 발송) 미설정. 이메일 기반 재설정은 채택하지 않는다.

## 3. 확정된 결정

### 사용자와 합의한 5개 갈림길
1. **가입 모델**: 관리자 초대형 (공개 가입 페이지 없음).
2. **계정 생성 수단**: 인앱 관리 화면 (`pmo_admin` 전용).
3. **비밀번호 찾기**: 관리자 리셋 (SMTP 불필요).
4. **아이디 찾기**: 별도 기능 없음 + 로그인 화면 안내 문구.
5. **관리 화면 경로**: `/admin/accounts`, 메뉴명 "계정 관리".

### 단순화를 위한 세부 결정
1. **이름 필드**: 표시용 이름을 `user_metadata.full_name`에 **선택 입력**으로 저장(목록 가독성).
2. **첫 로그인 비번 강제 변경**: v1 제외. 임시비번 안내로 대체(나중에 추가 가능).
3. **본인 비번 변경 시 현재 비번 확인**: 포함(재인증).
4. **계정 삭제/비활성화**: v1 제외(데이터 cascade 위험). 팀/권한 수정 + 비번 리셋만.
5. **테스트**: 일괄 파서·검증 순수함수는 vitest 단위테스트. 서버액션은 권한 게이트 로직 중심으로 가볍게.

## 4. 기능 상세

### A. 계정 관리 화면 (`/admin/accounts`, pmo_admin 전용)

- **목록**: 이메일 · 이름(있으면) · 팀 · 권한 · 생성일. 데이터 소스 = `admin.listUsers()`(이메일·이름·생성일) + `memberships`+`teams` 조인(팀·권한). 서버에서만 조립. `listUsers`는 페이지당 기본 50건이므로 다음 페이지가 있으면 모두 순회해 합친다(사내 규모 <수백명 가정).
- **계정 추가(단건)**: 이메일 + 초기 비밀번호 + 팀 + 권한 (+ 이름 선택) 입력 → 서버액션이 `admin.createUser({ email, password, email_confirm: true, user_metadata })` → `memberships` insert.
- **일괄 추가**: textarea에 한 줄씩 붙여넣기. 형식 = 고정 4열 `이메일, 팀코드, 권한, 초기비번` + 선택 5번째 열 `이름`. 구분자는 콤마 또는 탭(엑셀 붙여넣기 대응). 빈 줄은 무시. 파싱·검증 후 행 단위 생성. 결과를 행별 성공/실패로 표로 표시.
- **비번 리셋**: 각 행 [비번 리셋] → 관리자가 임시비번 입력(최소 8자, [생성] 버튼으로 랜덤 채우기 가능) → `admin.updateUserById(id, { password })`.
- **팀/권한 수정**: 각 행에서 팀·권한 변경 → `memberships` update.

### B. 비밀번호 변경 (본인)

- 프로필 팝오버(HeaderChrome)에 "비밀번호 변경" 항목 추가 → 모달.
- 입력: 현재 비밀번호 + 새 비밀번호 + 새 비밀번호 확인.
- 처리: 현재 비밀번호를 `signInWithPassword`(현재 이메일)로 재확인 → 통과 시 `updateUser({ password })`.
- 성공 시 토스트 + 모달 닫기.

### C. 비밀번호 찾기 (관리자 리셋)

- 별도 사용자 흐름 없음. A의 [비번 리셋]으로 처리.
- 로그인 화면에 "비밀번호를 잊으셨나요? 관리자에게 문의하세요" 안내 문구.

### D. 아이디 찾기 (안내)

- 로그인 화면 비밀번호 필드 아래 정적 문구: "아이디(이메일) 또는 비밀번호를 잊으셨다면 관리자에게 문의하세요."
- 관리자는 목록에서 이메일을 직접 확인해 알려준다.

## 5. 데이터 모델 & 보안

- **신규 테이블/마이그레이션 없음.** 계정 = `auth.users` 1행 + `memberships` 1행.
- 팀은 `teams.code`(`PMO·가공·ERP·MES`)로 `team_id` 조회. 권한은 `pmo_admin·team_editor`.
- 이름(선택)은 `auth.users.user_metadata.full_name`에 저장.
- **권한 게이트 2중**:
  1. `/admin/accounts` 서버컴포넌트에서 `getMembership()?.role !== 'pmo_admin'`이면 접근 차단(리다이렉트).
  2. `accounts.ts`의 모든 서버액션 첫 줄에서 동일 체크(기존 `members.ts` 패턴).
- **service_role 키는 절대 클라이언트로 노출하지 않는다.** `createAdminClient()`는 서버액션 내부에서만 호출.
- **검증**: 이메일은 기존 `isValidEmail` 재사용, 비밀번호 최소 8자, 팀코드·권한은 화이트리스트.
- **부분 실패 안전(유령 계정 방지)**: 계정 생성 시 `createUser` 성공 후 `memberships` insert 실패하면 방금 만든 user를 삭제(보상 롤백)한다. 일괄 등록도 행 단위로 이 규칙을 적용.
- **중복 처리**: 이미 존재하는 이메일은 생성 실패로 처리하고 그 행만 실패 리포트(다른 행은 계속 진행).

## 6. 파일 (신규/수정)

### 신규
| 파일 | 역할 |
|------|------|
| `src/app/(app)/admin/accounts/page.tsx` | 서버컴포넌트 — pmo_admin 게이트 + 목록 로드 |
| `src/components/admin/AccountsManager.tsx` | 클라이언트 — 추가/일괄/리셋/수정 UI |
| `src/app/actions/accounts.ts` | 서버액션 — `listAccounts / createAccount / bulkCreateAccounts / resetPassword / updateAccountRole` |
| `src/components/account/ChangePasswordModal.tsx` | 본인 비번 변경 모달 |
| `src/lib/domain/accounts.ts` | 순수 함수 — 일괄 붙여넣기 파서 + 비번/이메일/화이트리스트 검증 |

### 수정
| 파일 | 변경 |
|------|------|
| `src/components/app/HeaderChrome.tsx` | 프로필 팝오버에 "비밀번호 변경" + (pmo_admin) "계정 관리" 링크 |
| `src/app/login/page.tsx` | 비밀번호 필드 아래 안내 문구 |
| `src/lib/supabase/admin.ts` | 재사용(변경 없음) |

## 7. 테스트

- `src/lib/domain/accounts.ts` 순수 함수 vitest 단위테스트 (`tests/` 기존 패턴):
  - 일괄 붙여넣기 파서: 정상/공백/열 부족/잘못된 팀코드·권한/잘못된 이메일/짧은 비번 케이스.
  - 검증 함수: 이메일·비번·팀코드·권한 화이트리스트.
- 서버액션 권한 게이트: 비-pmo_admin 요청 거부 확인(모킹 기반 최소 테스트).
- 수동 검증: 계정 생성→로그인, 비번 변경, 관리자 리셋→재로그인 흐름.

## 8. 범위 밖 (YAGNI)

- 공개 회원가입 · 이메일 인증 · SMTP · 이메일 재설정 링크
- 소셜 로그인 · 2FA · 세션 관리 화면
- 계정 삭제/비활성화(v1)
- 첫 로그인 비번 강제 변경(v1)

## 9. 완료 기준 (Acceptance Criteria)

1. pmo_admin이 `/admin/accounts`에서 새 계정을 만들면, 해당 이메일/비번으로 로그인해 정상적으로 앱을 사용할 수 있다(팀·권한 반영).
2. 일괄 붙여넣기로 여러 계정을 한 번에 만들 수 있고, 각 행의 성공/실패가 표로 보인다. 일부 실패해도 나머지는 생성된다.
3. 비-pmo_admin은 `/admin/accounts` 접근 및 계정 서버액션이 모두 차단된다.
4. 로그인한 사용자가 프로필 메뉴에서 본인 비밀번호를 변경할 수 있고, 변경 후 새 비번으로 로그인된다.
5. pmo_admin이 임의 계정의 비밀번호를 임시값으로 리셋할 수 있고, 사용자가 그 값으로 로그인할 수 있다.
6. 로그인 화면에 아이디/비번 분실 시 관리자 문의 안내가 보인다.
7. service_role 키가 클라이언트 번들에 포함되지 않는다.
8. 일괄 파서·검증 단위테스트가 통과한다.
