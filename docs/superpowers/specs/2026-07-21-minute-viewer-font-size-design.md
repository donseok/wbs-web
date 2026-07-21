# 회의록 뷰어 글자크기 조절 — 설계

날짜: 2026-07-21
상태: 승인됨

## 1. 배경 / 목표

회의록 본문은 `.minutes-md` 가 `text-[14px]` 로 고정되어 있어 조절 수단이 없다.
장문 회의록을 읽는 임원·현장 사용자가 확대할 방법이 브라우저 전체 줌뿐이며,
전체 줌은 헤더·사이드바·채팅 패널까지 함께 커져 본문 가독 폭이 오히려 줄어든다.

목표: 회의록 **본문만** 12~28px 범위에서 1px 단위로 조절하고, 그 값을 계정에 동기화한다.

레퍼런스: 헤더 우측의 `A-  28  A+` 컨트롤 (첨부 이미지).

## 2. 결정 사항 (사용자 확정)

| 항목 | 결정 |
|------|------|
| 적용 범위 | 본문 마크다운(`.minutes-md`)만. 목차·AI 채팅·요약 카드·메타 헤더는 고정 |
| 지속성 | 계정 동기화 (`UiPrefs.minuteFontSize`) + localStorage 미러 |
| 단계·범위 | 12~28px, 1px 스텝, 기본 14px |
| 외부 공유 뷰어 | 포함 (비로그인이므로 localStorage 만) |

## 3. 접근법 선택

**채택 — CSS 변수 + em 상대 단위.**
`.minutes-md { font-size: var(--minutes-fs, 14px) }` 로 두고 하위 타이포를 `em` 으로 전환.
글자크기 값은 **본문 카드 div 의 인라인 CSS 변수**로만 주입한다.

CSS 변수는 상속되므로 `MarkdownView`(memo + ReactMarkdown)의 props 가 바뀌지 않는다.
→ 1px 조절마다 최대 10만 자 마크다운이 재파싱되는 일이 없고, 순수 CSS 리페인트만 발생한다.
`MarkdownView.tsx` 는 **수정하지 않는다.**

기각한 대안:
- **Tailwind 변형 클래스 스와핑** — 17단계면 클래스 17개. 유지보수 불가.
- **`transform: scale()`** — 텍스트 흐림, 컨테이너 폭 불일치, `useMinuteTocSpy` 의
  스크롤 위치 계산(`getBoundingClientRect` 기반)이 깨진다.

## 4. 컴포넌트 설계

### 4.1 `src/lib/minutes/fontSize.ts` (순수 · 테스트 대상)

```
MINUTE_FS_MIN = 12
MINUTE_FS_MAX = 28
MINUTE_FS_DEFAULT = 14
MINUTE_FS_STEP = 1
MINUTE_FS_STORAGE_KEY = 'dflow-minute-fs'

clampMinuteFontSize(v: unknown): number
  숫자 아님 / NaN / Infinity / 비정수 / 범위 밖 → 안전값으로 정규화.
  비정수는 반올림 후 clamp. 복구 불가 입력은 DEFAULT.

stepMinuteFontSize(cur: unknown, dir: 1 | -1): number
  clamp(cur) 후 STEP 만큼 이동, 다시 clamp.
```

의존성 없음. 서버·클라이언트 양쪽에서 import 가능.

### 4.2 `src/components/minutes/useMinuteFontSize.ts` (클라이언트 훅)

입력: `initial?: number | null` (서버 `UiPrefs.minuteFontSize`)
반환: `{ size, setSize, dec, inc, reset, canDec, canInc }`

동작 계약:
- **초기값** = `clampMinuteFontSize(initial)` — 서버값이 있으면 SSR/CSR 이 동일하게 렌더되어
  하이드레이션 불일치·깜빡임이 없다.
- **서버값이 없을 때만** 마운트 후 effect 에서 localStorage 값을 읽어 적용한다.
  (SSR 은 localStorage 를 알 수 없으므로 초기 렌더에 넣으면 하이드레이션이 깨진다.)
- 변경 시: state 갱신 → localStorage 기록(try/catch, 실패 무시) →
  `queueUiPref({ minuteFontSize })` debounce 저장.
- **비로그인(공유 뷰어)** 은 `persist: false` 옵션으로 서버 저장을 건너뛴다.
  서버 액션은 미로그인 시 no-op 이지만, 불필요한 왕복 자체를 만들지 않는다.

### 4.3 `src/components/minutes/MinuteFontSizeControl.tsx` (프레젠테이션)

`A-  |  숫자  |  A+` 인라인 버튼 그룹.
- 경계값에서 해당 버튼 `disabled`
- 숫자 버튼 클릭 → 기본값(14px) 리셋, `title`/`aria-label` 로 안내
- 숫자는 `tabular-nums`, `aria-live="polite"` 로 변경 고지
- 모든 라벨 i18n (`min.fs.*`)

props: `{ size, onDec, onInc, onReset, canDec, canInc }` — 상태를 갖지 않는다.

### 4.4 CSS (`src/app/globals.css` 231~253행)

- `.minutes-md` 에 `font-size: var(--minutes-fs, 14px)` 추가 (`text-[14px]` 제거)
- 제목·코드·표의 절대 px → base 대비 `em`
  - h1 `1.4em` / h2 `1.3em` / h3 `1.15em` / h4~h6 `1em` / code · table `0.93em`
- 문단·목록·제목의 **세로 여백**과 목록 들여쓰기도 `em`
  — 28px 에서 문단 구분이 뭉개지지 않게 함께 비례 확대
- **px 고정 유지**: 보더 두께, `rounded-*`, 하이라이트 인원 배지(`10px`),
  `scroll-mt-16`(헤더 오프셋), `data-ins` 좌측 3px 보더

`@apply` 로 표현 불가한 em 값은 plain CSS 로 쓴다 (파일 내 279~282행에 이미 같은 혼용 선례).

### 4.5 배선

- `UiPrefs` 에 `minuteFontSize?: number` 추가 (`src/lib/domain/types.ts`)
- `src/app/(app)/minutes/[id]/page.tsx` — 기존 `Promise.all` 에 `getUiPrefs()` 합류.
  **직렬 왕복 증가 0단** (병렬 확장이므로 체감 지연에 영향 없음)
- `MinuteViewer` — `initialFontSize` prop 수신, 훅 호출,
  본문 카드 div 에 `style={{ ['--minutes-fs']: `${size}px` }}`,
  컨트롤을 메타 헤더 액션 줄 우측(집중 모드 버튼 인접)에 배치
- `ShareViewer` — 훅을 `persist: false` 로 호출, 헤더 카드 우측에 컨트롤 배치
- DB 스키마 변경 없음 (`user_preferences.prefs` JSONB 부분 병합)
- 서버 액션 신규 없음 (`saveUiPrefs` 재사용)

## 5. 데이터 흐름

```
[서버] getUiPrefs() ──minuteFontSize──> MinuteViewer(prop)
                                            │
                                     useMinuteFontSize
                                            │
                          ┌─────────────────┼─────────────────┐
                          ▼                 ▼                 ▼
                  본문 div CSS 변수    localStorage      queueUiPref(debounce 600ms)
                  (즉시 리페인트)      (즉시)            → saveUiPrefs 부분 병합
```

공유 뷰어는 좌측 서버 경로가 없고, localStorage 만 읽고 쓴다.

## 6. 에러 처리

프로젝트 3원칙(표시=로깅 · 쓰기 선행조회=중단 · 보안가드=fail-closed)에 따라:

- localStorage 접근 실패(사파리 프라이빗 등) → try/catch 삼킴 + 기본값 유지.
  **표시 실패가 아니라 캐시 실패**이므로 사용자 고지 불필요.
- 서버 저장 실패 → 기존 `queueUiPref` 계약대로 무시(로컬 값이 진실).
  `saveUiPrefs` 는 선행 조회 실패 시 이미 저장을 중단해 타 설정 소실을 막는다.
- 서버에서 온 값이 오염(문자열·범위 밖)돼도 `clampMinuteFontSize` 가 흡수 →
  깨진 레이아웃이 아니라 기본 14px 로 수렴.

## 7. 테스트

**`tests/minutes/fontSize.test.ts`** (순수)
- 경계: 12·28 에서 더 줄이거나 키워도 범위 유지
- 비정상 입력: `undefined` / `null` / `'14'` / `NaN` / `Infinity` / `13.7` / `0` / `999`
- 스텝 왕복: 14 → inc×3 → dec×3 = 14

**`tests/ui/minute-font-size.test.tsx`** (RTL)
- A+ 클릭 → 본문 컨테이너의 `--minutes-fs` 가 증가
- 최대치 도달 시 A+ 가 `disabled`, 최소치에서 A- 가 `disabled`
- 숫자 버튼 클릭 → 14px 리셋
- 변경 후 localStorage 에 값이 기록됨
- 서버 초기값이 주어지면 첫 렌더부터 그 값으로 렌더 (하이드레이션 파리티)

## 8. 범위 밖 (YAGNI)

- 줄간격·글꼴·본문 폭 조절
- 목차·채팅 패널 스케일링
- 인쇄 전용 크기
- 키보드 단축키(Ctrl +/-) — 브라우저 기본 줌과 충돌하므로 넣지 않는다
