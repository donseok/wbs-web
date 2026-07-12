# 회의록 뷰어 인사이트 (AI 마킹 + 하이라이트 공유 + 목차) 설계

- 작성일: 2026-07-12
- 상태: 사용자 승인 완료 (섹션별 승인) + 적대적 스펙 검증 반영 (4렌즈 43건 → 전건 반영)
- 범위: 뷰어 `/minutes/[id]` 확장 — AI 핵심 요약 카드·인라인 마킹, 블록 단위 하이라이트 실명 공유, 헤딩 목차 내비게이션

## 1. 개요

회의록 뷰어를 "읽는 화면"에서 "빨리 파악하고, 중요한 곳을 서로 알려주는 화면"으로 확장한다.

1. **AI 레이어** — 업로드/교체 시 LLM이 본문 블록을 결정·액션·기한·리스크로 분류해 상단 요약 카드와
   인라인 마킹으로 표시 (1회 생성 후 DB 캐시).
2. **하이라이트 레이어** — 독자가 블록 단위로 형광펜 하이라이트. 실명 + 인원수 집계로 공유되며,
   많이 겹칠수록 진하게 표시.
3. **목차(TOC)** — 헤딩 기반 내비게이션 + AI 마킹·하이라이트 위치 도트. 요약 카드·목차·인라인
   세 진입로에서 해당 블록으로 점프.

### 확정된 요구사항 (사용자 결정 로그)

| 결정 항목 | 결정 내용 |
|-----------|-----------|
| 중요도 판정 주체 | **D안 — AI 기본 레이어 + 사람 하이라이트 누적** (조합) |
| 하이라이트 단위 | **A안 — 블록 단위** (자유 텍스트 범위·메모는 비범위) |
| AI 표시 형태 | **C안 — 상단 요약 카드 + 인라인 마킹 연동** (클릭 점프) |
| 하이라이트 공개 수준 | **C안 — 실명 + 집계** (색 진하기 + 인원 배지, 클릭 시 명단) |
| 편의 기능 범위 | **B안 — 코어 + 목차 내비게이션** (읽음 표시는 비범위) |
| 블록 앵커링 구현 | **접근 1 — mdast 공유 블록 모델** (아래 §2) |

### 전제 (기존 시스템 계약)

- 본문은 `minutes.body_md`(≤100,000자)가 원천, 앱 내 에디터 없음, `.md` 재업로드로 통째 교체 가능.
- 렌더는 `react-markdown@10.1.0` + `remark-gfm@4.0.1`, rehype-raw 미사용(raw HTML 미렌더, XSS 차단).
- LLM은 무료 Gemini 체인(`generateAnswer` — 모델 폴백 + 429 방어 내장, 실패 시 null, 절대 throw 안 함).
- 읽기는 인증 사용자 전원, 관리(본문 교체 등)는 소유자 or `pmo_admin`. RLS 헬퍼는 `app_role()`
  (`current_role()` 금지 — 프로덕션 드리프트 문서화됨).
- 기존 DK Bot·doc/archive 채팅 경로는 일절 수정하지 않는다.

## 2. 블록 앵커 아키텍처 — `src/lib/minutes/blocks.ts` (신규, 서버·클라 공용)

**원칙: 파서는 하나다.** 서버(검증·AI 입력·재매칭)와 클라이언트(렌더 스탬핑)가 완전히 동일한
remark 파이프라인(remark-parse + remark-gfm — react-markdown 내부와 같은 조합)으로 mdast 루트
블록을 얻는다. 인덱스 불일치를 원천 차단한다.

> 검증된 함정 1: react-markdown의 hast 트리는 블록 사이에 `\n` 텍스트 노드가 삽입되므로
> (mdast-util-to-hast `wrap()`), rehype 레벨에서 인덱스를 세면 안 된다. 인덱스는 mdast 루트
> children 기준이며, 스탬핑은 mdast `data.hProperties` 경로로 hast에 자동 복사된다.

> 검증된 함정 2 (코드 블록 특례): mdast `code` 노드의 `hProperties`는 루트 `<pre>`가 아니라
> 내부 `<code>` 요소에 적용된다(mdast-util-to-hast code 핸들러 실측). 또한 `hProperties`에
> `className`을 넣으면 `applyData`가 Object.assign으로 **기존 `language-*` 클래스를 대체**해
> mermaid 감지가 파괴된다. 따라서 **스탬프는 data-\* 속성 전용**(클래스 스탬프 금지)이고,
> 코드 블록은 §2.3의 호이스팅 특례로 처리한다.

### 2.1 API

```ts
export type InsightKind = 'decision' | 'action' | 'deadline' | 'risk'

export interface MinuteBlock {
  index: number          // mdast 루트 children 순번 (비렌더 블록도 인덱스 차지)
  hash: string           // FNV-1a 64bit hex — normalize(text) 기준
  text: string           // toString(node, { includeHtml: false }) 후 정규화(trim + 연속 공백/개행 → ' ' 1개)
  rendered: boolean      // 제자리 렌더 여부 — mdast type이 html·footnoteDefinition·definition 이면 false
  headingDepth?: number  // heading 블록이면 1~6 (TOC용)
}

// marks: 렌더러에 전달하는 표시 상태 (인덱스 키)
export type BlockMarks = Record<number, {
  ins?: InsightKind      // 복수 kind 시 우선순위 최상위 1개 (§6.3)
  hlTier?: 1 | 2 | 3     // 하이라이트 인원 단계 (1명 / 2–3명 / 4명+)
  hlCount?: number       // distinct 사용자 수 (배지 숫자)
}>

export function splitMinuteBlocks(bodyMd: string): MinuteBlock[]
export function fnv1a64(text: string): string           // 본문 전체 해시(body_hash)에도 동일 사용
export function remarkAnnotateBlocks(marks: BlockMarks): Plugin  // 동기 remark 플러그인 팩토리
```

- **스탬프는 data-\* 전용**: `data-mblock`(인덱스), `data-ins`(kind), `data-hl`(1|2|3),
  `data-hl-count`(숫자). 클래스는 스탬프하지 않는다(함정 2). 도착 강조(flash)는 marks 경유가
  아니라 점프 핸들러의 DOM classList 직접 조작(§6.5) — 플러그인 스탬프 대상이 아니다.
- **하이라이트·AI 마킹 가능 블록** = `rendered === true` && 정규화 텍스트 비어있지 않음.
  이 규칙은 세 곳에서 동일 적용: 클라 팝오버 미발동, 서버 토글 검증 거부, AI 입력 제외.
  - `includeHtml: false`로 raw HTML 블록은 자동으로 빈 텍스트가 되고, `rendered=false`
    (html·footnoteDefinition·definition — GFM 각주 정의는 제자리에 렌더되지 않고 문서 끝으로
    이동하므로 비렌더로 분류)가 이중 방어.
- 해시는 재매칭·정합성 검증용(비암호) — FNV-1a 64bit. **구현 노트**: tsconfig target이
  ES2017이라 BigInt 리터럴(`0x…n`) 사용 불가 — `BigInt('0x…')` 생성자 + `BigInt.asUintN(64, …)`
  마스킹으로 구현 (서버 Node·브라우저 결과 동일, 스펙 결정적).
  - **수용 리스크**: FNV는 충돌 제작이 가능해, 악의적 회의록 소유자가 해시 충돌 블록으로 본문을
    교체하면 타인 실명 하이라이트가 무관한 문구로 전이될 수 있다. 내부 도구 + 소유자 악의 전제라
    발생 개연성이 낮아 수용하고, 문제 시 128bit 계열로 교체한다.
- `remarkAnnotateBlocks`는 **반드시 동기** (react-markdown 기본 컴포넌트는 `runSync`).

### 2.2 의존성

`unified@^11` / `remark-parse@^11` / `mdast-util-to-string@^4`를 package.json dependencies에
**명시 추가** — 전부 react-markdown의 transitive로 이미 설치돼 있어(11.0.5 / 11.0.0 / 4.0.0)
신규 설치 없음. phantom dependency(호이스팅 의존) 상태로 import하지 않기 위한 조치.
클라이언트 번들 증가도 없음(react-markdown이 이미 포함).

### 2.3 MarkdownView 수정

- `marks?: BlockMarks` prop 추가 → `useMemo`로 `remarkAnnotateBlocks` 플러그인 배열 구성.
- **코드/mermaid 특례 (함정 2 대응)**: `pre` 컴포넌트 오버라이드가 code 자식의 props
  (mermaidSourceFrom이 이미 읽는 위치)에서 `data-mblock`·`data-ins`·`data-hl`·`data-hl-count`를
  꺼내 `<pre>` 자신 또는 `MermaidBlock` 래퍼 div로 **호이스팅**한다. `MermaidBlock`은
  loading/error/rendered **세 렌더 경로 모두**에 이 속성들을 포워딩해야 §8 SSR 파리티가 성립
  (SSR은 loading 상태를 렌더).
- **성능 경계**: `MarkdownView`를 `React.memo`로 감싸고 `marks`는 참조 안정화(`useMemo`)를
  전제한다 — 팝오버 개폐 등 무관한 상태 변화가 100k자 재파싱을 유발하지 않도록. 하이라이트
  토글·타 사용자 반영 등 marks 실변경 시에만 재파싱을 수용한다(≤100k자, 실측상 수용 가능 —
  기존에도 본문 전체를 매 렌더 파싱).

## 3. 데이터 모델 — `supabase/migrations/0025_minute_annotations.sql`

0021 템플릿 미러: 헤더 주석(권한/멱등/Management API 적용 경로/적용 순서/app_role 드리프트 경고),
`create table if not exists` + `drop policy if exists` → `create policy`.
**두 테이블 모두 `alter table … enable row level security`를 명시적으로 포함한다** —
§3.2의 "쓰기 정책 생략 = 기본 거부" 구조가 이 한 줄에 걸려 있다.
스토리지 정책은 일절 건드리지 않음(0021 버킷 DELETE 정책 재적용 보류 건과 분리).

### 3.1 `minute_highlights` — 사람 하이라이트

| 컬럼 | 타입 | 제약 |
|------|------|------|
| `id` | uuid | PK, `gen_random_uuid()` |
| `minute_id` | uuid | NOT NULL, FK → `minutes` ON DELETE CASCADE |
| `block_index` | int | NOT NULL, **CHECK (block_index >= 0)** |
| `block_hash` | text | NOT NULL |
| `created_by` | uuid | NOT NULL, FK → `auth.users` **ON DELETE CASCADE** |
| `created_by_name` | text | 실명 스냅샷 — `displayNameFrom` (기존 관례) |
| `created_at` | timestamptz | DEFAULT now() |

- unique `(minute_id, created_by, block_index)` — 토글 판정 기준. 인덱스 `(minute_id)`.
- **excerpt 컬럼 없음** (검증 반영): 표시용 발췌는 클라이언트가 이미 계산해 둔
  `splitMinuteBlocks` 결과에서 파생한다(§6.2). 저장 스냅샷을 두면 PostgREST 직접 INSERT로
  위조 텍스트를 전원에게 노출시킬 수 있고(RLS는 created_by만 검사), orphan 행의 구 본문이
  REST로 영구 노출되는 표면도 생긴다 — 컬럼 제거로 두 표면 모두 소멸.
- **수용 리스크**: `created_by_name`은 직접 REST 쓰기로 위조 가능(타인 실명 사칭). 0013/0021의
  기존 스냅샷 관례를 승계하는 내부 도구 표면으로 수용한다.
- created_by CASCADE는 minutes의 SET NULL 관례에서 의도적으로 벗어남: 하이라이트는 개인 행위라
  익명 잔존이 무의미하고, 탈퇴 시 집계에서 빠지는 게 맞다.
- RLS (0013/0021 패턴): SELECT `to authenticated using (true)`;
  INSERT `with check (created_by = auth.uid() and app_role() is not null)`;
  DELETE `using (created_by = auth.uid() or app_role() = 'pmo_admin')`.
  UPDATE 정책 없음 — 토글은 insert/delete만, 재매칭은 service_role(RLS 우회 — 타인 행 이동은
  본문 교체 권한자(소유자/pmo_admin)의 행위에 종속된 시스템 동작이므로 정당).

### 3.2 `minute_insights` — AI 분류 결과 (쓰기 service_role 전용)

| 컬럼 | 타입 | 제약 |
|------|------|------|
| `id` | uuid | PK |
| `minute_id` | uuid | NOT NULL, FK → `minutes` ON DELETE CASCADE |
| `body_hash` | text | NOT NULL — 생성 시점 `fnv1a64(body_md)` (캐시 키) |
| `kind` | text | NOT NULL, CHECK IN (`'decision'`,`'action'`,`'deadline'`,`'risk'`,`'none'`) |
| `label` | text | NOT NULL DEFAULT `''` — 요약 카드 한 줄 (서버 120자 캡) |
| `block_index` | int | NOT NULL — `'none'` 마커는 `-1` |
| `block_hash` | text | NOT NULL DEFAULT `''` — `'none'` 마커는 `''` |
| `created_at` | timestamptz | DEFAULT now() |

- **unique `(minute_id, block_index, kind)`** (검증 반영) + insert는 `on conflict do nothing`:
  서버리스 인스턴스 2개가 동시에 delete-and-reinsert를 인터리브해도 행이 2벌로 불어나지 않는다
  (none 마커 `(-1,'none')`도 자연 커버). 두 실행의 결과가 섞일 수는 있으나 모두 유효한 분류이고
  최종 일관성은 다음 재생성이 회수. 인덱스 `(minute_id)`.
- RLS: `enable row level security` + SELECT `to authenticated using (true)`만 — 쓰기 정책 생략
  (정책 없는 명령은 기본 거부 → service_role만 RLS 우회로 기록, `minute_embeddings` 패턴 미러).
- **`kind='none'` 마커 1행** = "분석 성공, 뽑을 항목 없음". **행 0개** = 미생성/실패 → self-heal
  재시도 대상. (LLM 유틸이 실패를 null로 삼키므로 상태 구분 장치가 필요 — 정찰 확인 사항.)

### 3.3 정합성 안전핀 — 클라이언트 검증 규칙 (양 레이어 공통)

클라이언트는 `splitMinuteBlocks(minute.bodyMd)`를 `useMemo`로 1회 계산해 아래 판정에 공용한다.

1. **인사이트 신선도 (카드 레벨)**: `fnv1a64(현재 bodyMd)`를 클라이언트가 직접 계산해
   insights 행들의 `body_hash`와 비교. **행 0개 또는 하나라도 불일치 → 카드는 "준비 중"
   (stale — §4.3 ensure 대기)**. 전부 일치할 때만: `none` 마커면 "핵심 항목 없음", 아니면
   항목 렌더. fresh 케이스는 ensure 응답을 기다리지 않고 즉시 렌더한다(플리커 없음).
   `block_index=-1`인 none 마커는 아래 블록 표시 규칙의 적용 대상이 아니다(카드 상태 판정 전용).
2. **블록 표시 규칙 (항목 레벨)**: 하이라이트/인사이트 항목은 `block_index` 위치 블록이
   존재하고, `rendered === true`이며, 현재 해시가 저장된 `block_hash`와 일치할 때만 표시.
   본문이 교체돼도 엉뚱한 블록에 붙는 일이 구조적으로 없고, 어긋난 항목은 자동 숨김
   (orphan은 시각적으로 존재하지 않음).
3. **본문 교체 재매칭**: §5. 재매칭 실패·지연 시에도 1·2번 규칙 덕에 오표시는 없다
   (잠시 숨겨질 뿐).

## 4. AI 인사이트 파이프라인 — `src/lib/ai/minutes-insights.ts` (신규)

`minutes-ingest.ts` 계약 미러: **절대 throw하지 않음**, 실패는 `console.error` 로그만,
가드는 `hasLLM()` + Supabase admin env.

### 4.1 `generateMinuteInsights(minuteId, bodyMd)`

1. `splitMinuteBlocks(bodyMd)` → **하이라이트 가능 블록만**(rendered && 비어있지 않음, §2.1)
   `[인덱스] 블록텍스트(블록당 800자 캡)`로 번호 매긴 사용자 메시지 조립. 본문 캡 10만 자라
   컨텍스트 초과 없음.
2. `generateAnswer(system, [{role:'user', content}])` 호출 — 기존 비스트리밍 함수 재사용
   (모델 폴백 체인 + 429 Retry-After ≤6초 대기 + 모델당 50초 타임아웃 내장). null이면 중단(행 미기록).
3. 시스템 프롬프트(한국어): "결정사항/액션아이템/기한/리스크에 해당하는 블록만 골라
   JSON 배열만 출력 — `[{"i":3,"k":"decision","label":"…"}]`. 확실한 것만, 최대 20항목,
   label은 60자 이내 한 문장, JSON 외 텍스트 금지." 출력 압축은 `maxOutputTokens 4096`
   상한(thinking 토큰 합산) 대응.
4. **관용 파싱** `parseInsightItems(raw, blocks)` (export — 단위 테스트 대상): 코드펜스 제거 →
   첫 `[` ~ 마지막 `]` 슬라이스 → `JSON.parse` → 항목 검증(인덱스가 하이라이트 가능 블록,
   kind enum, label 문자열 → 120자 캡, 최대 30개, **(블록, kind) 쌍 중복 제거** — 한 블록에
   서로 다른 kind 복수 허용). 파싱 실패 → 중단.
5. 성공 시 service_role로 **delete 후 insert(on conflict do nothing)** (§3.2): 유효 항목 0개면
   `kind='none'` 마커 1행. 각 행에 `body_hash` + 해당 블록의 `block_hash` 기록.

**시간 예산 (정직한 계약)**: 폴백 체인 최악 시나리오는 플랫폼 함수 시간 제한을 넘을 수 있다.
제한 킬은 데이터 손상이 아니라 "행 0개(미생성)"로 남고 self-heal이 회수한다 — 추가 설정 없이
수용. 구현 중 실측으로 빈발하면 `/minutes/[id]` 세그먼트에 `maxDuration` 상향을 후속 검토.

### 4.2 트리거 3곳

| 시점 | 동작 |
|------|------|
| `createMinute` after() | `await ingestMinute(...)` → `await generateMinuteInsights(...)` **순차** (동시 발사 시 무료 쿼터 RPM 20 경합 방지) |
| `replaceMinuteBody` after() | ① 하이라이트 재매칭(§5) → ② 재인제스트 → ③ 인사이트 재생성 (순차) |
| 뷰어 열람 self-heal | §4.3 |

### 4.3 열람 self-heal — 서버 액션 `ensureMinuteInsights(minuteId)`

업로드 시점 쿼터 소진 등으로 분류가 실패했거나 배포 이전에 업로드된 회의록을 회수한다.
**서버 페이지에서 await하지 않는다** — LLM 타임아웃이 페이지 로딩을 잡아먹기 때문.
요약 카드가 클라이언트에서 **stale/행 0개로 판정한 경우에만**(§3.3-1, fresh면 호출 자체 없음)
마운트 후 1회 호출:

- 게이트: `getMembership()` + `getSession()` (검증 반영 — 세션만 가드하면 비멤버 인증 사용자가
  전체 회의록 순회로 무료 LLM 쿼터(DK Bot과 공유)를 소모시킬 수 있음. 비멤버 열람 시 self-heal
  미발동은 수용 — 읽기 기준선은 불변).
- 회의록 로드 → 본문 비었으면 `{ status: 'ready' }` (스킵). insights 존재 + `body_hash` 일치 →
  `{ status: 'ready' }`.
- 행 0개 또는 불일치 → 생성 시도. **회의록 단위** in-flight dedupe(Map) + 60초 쿨다운
  (기존 heal 패턴 미러 — 모듈 변수라 서버리스 인스턴스별 독립. 인스턴스 간 동시 실행은
  §3.2 unique + on conflict가 중복 행을 차단). 성공 → `{ status: 'generated' }` →
  클라이언트 `router.refresh()`.
- 실패/키 없음/쿨다운 중 → `{ status: 'unavailable' }` → 카드에 "AI 요약을 만들지 못했습니다"
  + 재시도 버튼. **AI 없이도 뷰어·하이라이트·목차는 완전 동작** (정직한 강등, 기존 컨벤션).

## 5. 본문 교체 재매칭 — `src/lib/minutes/rematch.ts` (신규, 순수 함수)

```ts
export function rematchHighlights(
  old: MinuteHighlightRow[],          // 전 사용자 행 (id·created_by·created_by_name·created_at 포함 스냅샷)
  newBlocks: MinuteBlock[],
): { reinserts: MinuteHighlightRow[]; deleteIds: string[] }
// reinserts = 인덱스가 바뀌는 행들의 전체 스냅샷(새 block_index 반영, id·created_at 등 원본 보존)
// deleteIds = 재배정 불가(orphan) 행 + reinserts 대상 행의 원 id
```

- **사용자별·해시별** 매칭: 같은 (created_by, hash) 그룹의 기존 하이라이트를 옛 인덱스 순으로,
  같은 해시를 가진 **하이라이트 가능** 새 블록 인덱스 큐(문서 순)에 1:1 배정. 큐 소진 시 나머지는
  삭제(orphan 미보존). 서로 다른 사용자는 같은 새 인덱스를 공유할 수 있음(unique는 사용자 스코프).
  인덱스가 그대로면 reinserts에서 제외(무변경).
- **적용 방식 (검증 반영 — 행별 UPDATE 금지)**: unique `(minute_id, created_by, block_index)`가
  non-deferrable이라, 본문 상단에 문단 하나만 추가돼도(전체 인덱스 +1 시프트) 인접 하이라이트의
  순차 UPDATE가 23505로 터지고, 스왑 케이스는 어떤 적용 순서로도 불가. 따라서
  **delete(deleteIds ∪ reinserts의 원 id) 선실행 → reinserts 일괄 insert** 2단계로 적용
  (id·created_at·created_by_name 원본 보존 재삽입 — service_role). 충돌이 구조적으로 불가능.
- 실행은 `replaceMinuteBody`의 after()에서 service_role로(타인 하이라이트 행 갱신은 RLS상
  소유자 세션으로 불가). 실패해도 로그만 — §3.3 안전핀이 오표시 차단.
- 인사이트는 재매칭하지 않고 **전체 삭제 후 재생성** (본문이 바뀌면 분류 자체가 무효).
- `rematch.test.ts` 필수 케이스: 전체 +1 시프트 + 인접 하이라이트, 두 블록 스왑, 중복 해시,
  소실(삭제), 다중 사용자 동일 블록 (§8).

## 6. UI

### 6.1 배치 (xl 기준 / 미만은 세로 스택: 메타 → 요약 → 목차 아코디언 → 본문 → 채팅)

```
┌ 메타 헤더 (기존, shrink-0) ─────────────────────────────┐
├ ✨ 핵심 요약 카드 (신규, shrink-0, 접기, max-h 내부 스크롤) ┤
│  [결정 2] [액션 3] [기한 1] [리스크 1]        [접기 ^]    │
│  ● 결정 — …label…                          ← 클릭 점프  │
│  ◈ 많이 주목한 구간 — "…본문 파생 발췌…" 👤3              │
├────────┬──────────────────────────────┬────────────────┤
│ 목차    │ 본문 카드 (xl 자체 스크롤)     │ 채팅 패널(기존) │
│ 220px  │  ┃ 좌측 3px kind색 보더 = AI   │ 340px          │
│ (자체   │  ▒ 배경 틴트 + 👤n = 하이라이트 │                │
│ 스크롤) │                              │                │
└────────┴──────────────────────────────┴────────────────┘
```

- 요약 카드·목차 추가 시 기존 xl 높이 체인(`shrink-0` / `min-h-0` / `flex-1`)을 유지해야
  본문 카드 자체 스크롤이 깨지지 않음 (정찰 확인 사항).

### 6.2 핵심 요약 카드 (`MinuteInsightCard` 신규)

- kind 칩 색 매핑(기존 토큰): 결정=`done`(녹) · 액션=`progress`(청) · 기한=`accent-warning`(주황) ·
  리스크=`delayed`(적). `.chip` 클래스 + `StatusPill` 패턴 복제.
- 항목 리스트(kind 그룹 순), 클릭 → 해당 블록 점프(§6.5). §3.3-2 검증 탈락 항목은 숨김.
- **인젝션 방어 (검증 반영)**: `label`과 주목 구간 발췌는 **React 순수 텍스트 노드로만 렌더** —
  마크다운 해석·링크화·`dangerouslySetInnerHTML` 금지. 근거: 회의록 본문이 LLM 입력이므로
  프롬프트 인젝션으로 label에 피싱 링크가 섞일 수 있음 — 2026-07-09 스펙 §6.2-5(채팅 링크화
  차단)와 동일한 결정을 계승.
- **많이 주목한 구간**: 하이라이트를 블록별 집계(**distinct 사용자 수** 내림차순, 동률은 블록 순)
  상위 3개. 발췌 텍스트는 클라이언트의 `splitMinuteBlocks` 결과에서 해당 블록 정규화 텍스트
  앞 100자를 파생(DB 저장 안 함 — §3.1). 클릭 점프. 0건이면 섹션 숨김.
- 카드 상태 (§3.3-1의 신선도 판정): fresh+항목 → 리스트 / fresh+none 마커 → "핵심 항목 없음"
  한 줄 / stale·행 0개 → "AI 요약 준비 중…" + ensure 대기 / ensure `unavailable` →
  "만들지 못했습니다" + 재시도 버튼.
- 펼침 시 `max-h-60`(240px) 내부 스크롤(본문 잠식 방지). 접힘 시 **kind 칩 카운트 바만 남김**.
  접기 상태는 로컬 useState(채팅 패널과 동일, 비영속).

### 6.3 인라인 마킹 (globals.css `.minutes-md` 스코프 확장)

- **CSS는 속성 선택자 사용** (클래스 스탬프 금지 — §2 함정 2): `[data-ins="decision"]` 등 4종,
  `[data-hl="1|2|3"]`, `[data-hl-count]::after { content: attr(data-hl-count) }` 인원 배지.
- AI 마킹: `border-left 3px` kind 색 + 은은한 배경. **배경은 opacity 스케일로 확정**
  (`accent-warning`에는 `-weak` 토큰이 없어 4개 kind 일관 처리가 불가하므로 `-weak` 안 폐기).
  한 블록에 복수 kind면 **인라인 보더는 우선순위 1개만**: risk > deadline > decision > action
  (`data-ins`에 최상위 kind만 스탬프 — §2.1 BlockMarks). 요약 카드에는 전 kind 항목이 다 나온다.
- **blockquote 특례**: 기존 `.minutes-md blockquote`의 `border-l-4 border-line`과 같은 변에서
  충돌 — 마킹된 blockquote는 마킹 보더가 기본 보더를 **대체**(색만 kind 색으로 교체)하도록
  속성 선택자 규칙이 오버라이드.
- 하이라이트: 배경 틴트 3단계 — 1명 / 2–3명 / 4명+ (`accent-warning` 계열 opacity 스케일 —
  토큰 기반이라 다크 자동). 코드 블록은 기존 `.minutes-md pre code { bg-transparent }`보다
  특이도 높은 규칙으로 pre 레벨 틴트 적용(§2.3 호이스팅 전제).
- 두 레이어 중첩 공존(보더 + 배경). kind의 텍스트 라벨은 색에만 의존하지 않도록 팝오버·요약 카드
  칩에서 문자로 제공(색약 대응).

### 6.4 상호작용 — 블록 클릭 → 팝오버 (`MinuteBlockPopover` 신규)

- 본문 래퍼에 이벤트 위임: `closest('[data-mblock]')`. **발동 제외**: `closest('a, button')`,
  텍스트 드래그 선택 중(`getSelection()` 비어있지 않음), 하이라이트 불가 블록(§2.1).
- 팝오버 내용: 형광펜 토글 버튼(내 하이라이트 여부 반영) + 하이라이트한 사람 실명 목록 +
  AI 분류 칩(있으면).
- **배치 계약 (검증 반영 — HeaderChrome 패턴은 외부 클릭 닫기만 차용)**: 마크다운 DOM 내부에
  React 자식을 렌더할 수 없으므로, 클릭한 블록의 `getBoundingClientRect` 기준 **`position:
  fixed` 배치** (블록 하단 우선, 뷰포트 하단 근접 시 상단 플립, 좌우 뷰포트 클램프).
  스크롤·리사이즈 시 닫기, 외부 클릭 닫기.
- **낙관적 토글 병합 계약 (검증 반영)**: 내 하이라이트 여부는 **로컬 상태가 단독 소유**
  (서버 prop의 내 행은 초기값으로만 사용). 표시 집계 = (서버 highlights에서 내 행 제외한
  distinct 사용자 수) + (로컬 내 하이라이트 시 +1) — revalidate로 서버 prop이 갱신돼도 이중
  계산·깜빡임·역전이 없다. 실패 시 로컬 롤백 + Toast.
- 데스크톱/터치 분기 없음(hover 거터 버튼 없음) — hover 시 시각 힌트만(커서 + 옅은 outline).

### 6.5 점프 + 도착 강조

- `scrollIntoView({ behavior, block: 'start' })` — xl(본문 카드)/미만(main)의 스크롤 컨테이너
  차이를 자동 처리. 대상 블록에 `scroll-mt` 여유.
  **behavior는 `matchMedia('(prefers-reduced-motion: reduce)')` 매치 시 `'auto'`, 아니면
  `'smooth'`** (검증 반영 — JS 명시 smooth는 전역 CSS `scroll-behavior: auto !important`의
  영향을 받지 않으므로 직접 분기해야 접근성 논리가 일관).
- 도착 강조: 점프 핸들러가 대상 요소 `classList`에 `mblock-flash`(정적 ring)를 **직접 부여**,
  2초 후 제거 — marks/플러그인 경유 아님(§2.1 — 점프마다 100k 재파싱 2회를 피함). keyframe이
  아닌 정적 스타일이라 reduced-motion에서도 유효.
- 점프 대상이 DOM에 없으면 조용히 무시 (§3.3-2의 `rendered` 필터가 1차 방어라 실제로는 드묾).

### 6.6 목차 (`MinuteToc` 신규)

- 소스: `splitMinuteBlocks` 결과의 `headingDepth` 1~3 블록 (별도 파싱 없음). 헤딩이 없으면
  컬럼/아코디언 자체를 렌더하지 않음.
- xl: 본문 왼쪽 `w-[220px] shrink-0` 자체 스크롤 컬럼. xl 미만: 요약 카드 아래 접이식 바 —
  펼쳐서 항목 클릭 시 점프 후 자동 접힘. 접힌 아코디언에서는 스크롤 스파이 비활성(관찰 중단).
- **섹션 정의 (검증 반영)**: 항목의 담당 구간 = 이 헤딩부터 **다음 depth ≤ 3 헤딩** 직전까지
  (h4~h6 하위 구간은 상위 TOC 항목에 귀속). 첫 depth ≤ 3 헤딩 이전 블록들은 무귀속(도트 없음).
- 항목 옆 도트: 담당 구간에 존재하는 AI kind 색 도트(kind별 1개) + 하이라이트 도트(집계 ≥1이면 1개).
- 스크롤 스파이: IntersectionObserver — `root: null`(뷰포트 기준이라 xl/미만 공통),
  `rootMargin: '0px 0px -70% 0px'`, 활성 항목 = 교차 중 최상단 헤딩(없으면 마지막으로 통과한 헤딩).

### 6.7 데이터 흐름·서버 액션 (`actions/minutes.ts` 확장)

- 뷰어 페이지 `src/app/(app)/minutes/[id]/page.tsx` **수정**: 기존 `Promise.all`에
  `getMinuteAnnotations(minuteId)` (`src/lib/data/minutes.ts` 신규 함수) 합류 →
  `MinuteViewer` prop.
- 도메인 타입(types.ts):
  ```ts
  interface MinuteHighlight { id; minuteId; blockIndex; blockHash; createdBy; createdByName: string|null; createdAt }
  interface MinuteInsight  { id; minuteId; bodyHash; kind: InsightKind|'none'; label; blockIndex; blockHash }
  // getMinuteAnnotations(minuteId): Promise<{ highlights: MinuteHighlight[]; insights: MinuteInsight[] }>
  ```
- `toggleMinuteHighlight(minuteId, blockIndex, blockHash)`:
  `getMembership()`+`getSession()` 게이트 → 회의록 로드 → `splitMinuteBlocks(body_md)`로
  **(인덱스, 해시) 재검증 + 하이라이트 불가 블록(비렌더·빈 텍스트) 거부** (불일치 = 오래된 화면
  → "본문이 변경되었습니다. 새로고침 해주세요." — 서버 액션 에러 문자열은 기존 관례대로
  비 i18n 한국어 하드코딩) → 기존 행 `(minute_id, 본인, block_index)` 조회:
  - 있고 **저장 해시 == 요청 해시** → delete (끄기, `on:false`)
  - 있고 **해시 불일치(stale 행 — 재매칭 실패 잔존)** → stale 행 delete 후 새 행 insert
    (켜기, `on:true`) — 검증 반영: 이 분기가 없으면 숨겨진 stale 행이 delete만 되어
    "켜기 클릭이 무반응"이 됨
  - 없음 → insert (`created_by_name = displayNameFrom(...)`), unique 위반(23505)은
    "이미 하이라이트됨" ok 처리(멱등)
  → `revalidatePath('/minutes/' + id)` → `{ ok, on?: boolean, error? }`.
- `ensureMinuteInsights(minuteId)` → §4.3.
- 타인 하이라이트의 실시간 반영은 비범위 — 토글 시 revalidate + 재방문 시 자연 갱신
  (병합 계약은 §6.4).

### 6.8 i18n — 키 목록 (ko·en 동시 추가, 패리티 타입 강제)

| 키 | ko | en |
|----|----|----|
| `min.insight.title` | 핵심 요약 | Key takeaways |
| `min.insight.kind.decision` | 결정 | Decision |
| `min.insight.kind.action` | 액션 | Action |
| `min.insight.kind.deadline` | 기한 | Deadline |
| `min.insight.kind.risk` | 리스크 | Risk |
| `min.insight.preparing` | AI 요약 준비 중… | Preparing AI summary… |
| `min.insight.unavailable` | AI 요약을 만들지 못했습니다 | Couldn't generate the AI summary |
| `min.insight.retry` | 다시 시도 | Retry |
| `min.insight.none` | AI가 뽑은 핵심 항목이 없습니다 | No key items found |
| `min.insight.attention` | 많이 주목한 구간 | Most highlighted |
| `min.insight.collapse` / `expand` | 접기 / 펼치기 | Collapse / Expand |
| `min.hl.add` / `remove` | 하이라이트 / 하이라이트 해제 | Highlight / Remove highlight |
| `min.hl.people` | 하이라이트한 사람 | Highlighted by |
| `min.hl.failed` | 하이라이트를 저장하지 못했습니다 | Couldn't save the highlight |
| `min.toc.title` | 목차 | Contents |

(구현 중 필요한 부수 키는 같은 네임스페이스에 추가 — ko/en 동시.)

## 7. 엣지케이스

| 상황 | 처리 |
|------|------|
| 옛 화면에서 토글(그 사이 본문 교체) | 서버 (인덱스, 해시) 재검증 실패 → 에러 + 새로고침 유도 |
| 같은 인덱스에 stale 행 잔존(재매칭 실패) 상태에서 토글 | 해시 비교로 stale 감지 → delete+insert로 "켜기" 처리 (§6.7) |
| 본문 상단 삽입으로 전체 인덱스 시프트 / 블록 스왑 | 재매칭을 delete→reinsert 2단계로 적용해 unique 충돌 원천 차단 (§5) |
| 재매칭에서 같은 해시 블록 여러 개 | 사용자별·해시별 문서 순 1:1 배정, 잔여 삭제 (§5) |
| 제자리 렌더되지 않는 블록 (raw HTML, GFM 각주 정의, 링크 정의) | `rendered=false` + `includeHtml:false` — AI 입력 제외·서버 토글 거부·클라 항목 숨김·점프 무시 (§2.1, §3.3-2) |
| mermaid/코드 블록 | 스탬프가 `<code>`에 떨어지는 특례 — pre 오버라이드가 data-\* 를 pre/MermaidBlock으로 호이스팅, 클래스 스탬프 금지로 `language-*` 보존 (§2.3) |
| 동시 토글 경합(중복 insert) | unique 위반(23505)은 "이미 하이라이트됨" ok 처리 (멱등) |
| self-heal·after() 재생성 동시 실행(인스턴스 상이) | `minute_insights` unique + on conflict do nothing으로 중복 행 차단 (§3.2) |
| 빈 본문 | 요약 카드·self-heal·인사이트 생성 모두 스킵 (인제스트와 동일 가드) |
| LLM 실패/키 없음/시간 제한 킬 | 행 0개 유지 → self-heal 재시도(60초 쿨다운), UI는 정직한 강등 — 뷰어·하이라이트·목차는 AI 없이 완전 동작 |
| LLM이 JSON 외 텍스트/깨진 JSON/인젝션 label | 관용 파싱 → 실패 시 행 미기록. label은 순수 텍스트 렌더로 링크화 원천 차단 (§6.2) |
| 사용자/회의록 삭제 | FK ON DELETE CASCADE로 하이라이트·인사이트 자동 정리 |
| 멤버십 없는 인증 사용자 | 읽기 가능, 하이라이트 쓰기는 RLS 차단, self-heal도 미발동(멤버십 게이트 — 쿼터 보호) |
| 배포 이전 업로드된 기존 회의록 | 별도 백필 불필요 — 멤버 열람 self-heal이 첫 방문 시 생성 |
| 100k 자 대형 문서 | 블록당 800자 캡 입력·스탬핑 O(n)·TOC h1~h3 제한·React.memo(marks 실변경 시에만 재파싱)·flash는 classList 직접 조작 |

## 8. 테스트 (vitest, `tests/minutes/`)

- `blocks.test.ts`: 헤딩/문단/표/코드/구분선/raw HTML/각주 정의/빈 문서 분할, `rendered` 플래그,
  해시가 공백 변화에 안정, 빈 블록·비렌더 블록 제외 규칙, headingDepth.
- `stamp-parity.test.tsx` — **가장 가치 있는 테스트**: 같은 마크다운을 `splitMinuteBlocks`와
  `react-dom/server` 렌더(MarkdownView)에 넣어 `data-mblock` 순서·개수 일치 검증.
  필수 케이스: **marks가 부여된 mermaid/코드 블록**(호이스팅 + `language-*` 클래스 보존 확인,
  SSR은 MermaidBlock loading 경로), raw HTML·각주 포함 문서(비렌더 블록이 DOM에 없어도 인덱스
  정합 유지).
- `insights-parse.test.ts`: 코드펜스/서두 문장 제거, 잘못된 인덱스·kind 드롭, 비렌더 블록 인덱스
  드롭, label 캡, (블록, kind) 중복 제거, 항목 캡.
- `rematch.test.ts`: **전체 +1 시프트 + 인접 하이라이트**, **두 블록 스왑**, 중복 해시, 소실(삭제),
  다중 사용자 동일 블록, 무변경 행 제외.
- 클라이언트 표시 필터(§3.3)를 순수 함수로 분리해 단위 테스트: orphan 숨김, none 마커,
  body_hash 불일치(stale), rendered=false 숨김.
- 렌더 안전: 링크 마크다운이 포함된 label이 요약 카드에서 텍스트 그대로 표시되는지.
- 검증 관례: `npm run build` / `npm run lint` / `vitest` + curl (브라우저로 dev 서버 접근 불가 환경).

## 9. 구현 페이즈 · 배포 순서

### 9.1 구현 페이즈 (검증 리뷰 반영 — 각 페이즈 독립 배포 가능)

- **Phase 1 — 앵커 + 목차** (DB 무관): `blocks.ts` + 스탬핑 + MarkdownView/mermaid 호이스팅 +
  TOC + 점프/플래시 + parity 테스트. 이 페이즈만으로 목차 내비게이션이 출시 가능.
- **Phase 2 — 하이라이트**: 0025 중 `minute_highlights` + 토글 액션 + 팝오버 + 집계 표시 +
  재매칭 + 관련 테스트.
- **Phase 3 — AI 인사이트**: `minute_insights` + 파이프라인 + 요약 카드 + self-heal +
  관련 테스트.

(마이그레이션 0025는 한 파일로 두 테이블을 모두 담되, Phase 2 시작 시점에 한 번 적용.)

### 9.2 배포 순서

1. `0025_minute_annotations.sql` 프로덕션 적용 — Management API 레시피(0021과 동일 경로),
   **코드 배포보다 먼저**. 멱등 SQL. `supabase db push` 금지.
2. package.json 의존성 3개 명시(`unified`, `remark-parse`, `mdast-util-to-string`) — lockfile 정합만.
3. main 푸시 → Vercel 배포.
4. 스모크: **전용 테스트 프로젝트 회의록에서만** (운영 D-CUBE 데이터 불가침) —
   업로드 → 요약 생성 확인 → 하이라이트 토글/집계 → 본문 교체 → 재매칭·재분류 확인 →
   기존 회의록 열람 self-heal 확인.
5. 커밋 시 `git add` **파일 명시** (병렬 세션 관례 — 워킹트리에 무관한 report/excel 수정 존재).

## 10. 비범위 (Out of Scope)

- 자유 텍스트 범위 하이라이트, 하이라이트 코멘트/메모 (B·C안에서 제외 결정)
- 실시간 하이라이트 동기화(구독), 하이라이트/요약 알림
- 읽음 표시 (질문 5에서 제외 결정)
- TOC·요약 카드 접기 상태의 계정 동기화 (로컬 상태만)
- doc/archive 채팅 프롬프트에 인사이트 주입
- 블록 팝오버의 키보드 접근 (요약 카드·목차는 버튼 기반이라 키보드 접근 가능 — 하이라이트 토글의
  키보드 경로는 차기 과제)
- AI 분류의 수동 편집/삭제

## 11. 구현 파일 맵 (신규/수정)

| 파일 | 신규/수정 | 내용 |
|------|-----------|------|
| `supabase/migrations/0025_minute_annotations.sql` | 신규 | 테이블 2종(RLS enable 명시) + unique/CHECK + 정책 |
| `src/lib/minutes/blocks.ts` | 신규 | splitMinuteBlocks / fnv1a64 / remarkAnnotateBlocks / BlockMarks (서버·클라 공용) |
| `src/lib/minutes/rematch.ts` | 신규 | rematchHighlights 순수 함수 (delete→reinsert 산출) |
| `src/lib/ai/minutes-insights.ts` | 신규 | generateMinuteInsights + parseInsightItems + self-heal 상태 |
| `src/app/actions/minutes.ts` | 수정 | toggleMinuteHighlight / ensureMinuteInsights / after() 훅 확장(재매칭+재분류) |
| `src/lib/data/minutes.ts` | 수정 | getMinuteAnnotations |
| `src/lib/domain/types.ts` | 수정 | MinuteHighlight / MinuteInsight / InsightKind (§6.7 정의) |
| `src/app/(app)/minutes/[id]/page.tsx` | 수정 | Promise.all에 annotations 합류 + MinuteViewer prop |
| `src/components/minutes/MinuteViewer.tsx` | 수정 | 레이아웃 통합(요약 카드·TOC 컬럼) + 낙관적 하이라이트 상태(§6.4 병합 계약) |
| `src/components/minutes/MarkdownView.tsx` | 수정 | marks prop + 플러그인 + pre/mermaid data-\* 호이스팅 + React.memo |
| `src/components/minutes/MinuteInsightCard.tsx` | 신규 | 요약 카드 (kind 칩·주목 구간·상태 머신·self-heal 트리거) |
| `src/components/minutes/MinuteToc.tsx` | 신규 | 목차 컬럼/아코디언 + 도트 + 스크롤 스파이 |
| `src/components/minutes/MinuteBlockPopover.tsx` | 신규 | 블록 팝오버 (fixed 배치·토글·명단·kind 칩) |
| `src/lib/i18n/dict/minutes.ts` | 수정 | §6.8 키 목록 ko·en |
| `src/app/globals.css` | 수정 | 속성 선택자 마킹·하이라이트·mblock-flash·배지 (토큰 기반, 다크 자동) |
| `package.json` | 수정 | unified / remark-parse / mdast-util-to-string 명시 |
| `tests/minutes/*` | 신규 | §8 테스트 5종 |
