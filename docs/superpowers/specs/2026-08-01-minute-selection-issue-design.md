# 회의록 드래그 선택 → 이슈 등록 — 설계

- 날짜: 2026-08-01
- 상태: 승인됨 (블록 단위 유지 + 드래그 선택 추가, 다중 블록 걸침 허용, AI 초안 동일 적용)
- 관련: 0049(issue_links)·0055(issue 분류 메타) 마이그레이션, `docs/superpowers/specs/` 이전 이슈 등록 개선(9f0c39a)

## 1. 문제

회의록에서 이슈 등록이 **블록(문단/불릿/표) 단위로만** 가능하다. 실제 회의록에서는
한 블록 안의 특정 문장만, 또는 인접한 여러 블록에 걸친 논의를 하나의 이슈로 만들고
싶은 경우가 잦다. 블록 단위는 너무 굵거나(블록 안 일부만 원함) 너무 잘다(여러 불릿을
묶고 싶음).

## 2. 목표 / 비목표

**목표**
- 마우스 드래그로 선택한 텍스트를 이슈 원문으로 등록할 수 있다.
- 선택이 인접한 여러 블록에 걸쳐도 통째로 등록할 수 있다.
- 기존 블록 클릭 → 팝오버 → 이슈 등록 흐름은 무변경으로 유지한다.
- 선택 등록도 기존과 동일하게 AI 초안 정리(제목·본문·분류 추천)를 거친다.
- **서버는 클라이언트가 보낸 텍스트를 신뢰하지 않는다** — 불변 버전 원문과 대조해
  실제 존재하는 텍스트만 발췌로 저장한다(기존 블록 검증 불변식 유지).

**비목표**
- 회의록 화면에서 선택 부분의 정밀 하이라이트 렌더링(블록 단위 점프로 충분).
- 하이라이트(형광펜) 기능의 선택 단위 확장 — 이번 범위는 이슈 등록만.
- 모바일/터치 선택 최적화.
- DB 스키마·RPC 변경(없음 — 아래 4절).

## 3. 접근 방식 결정

**채택: A. 기존 블록 앵커 계약의 확장.** 선택 텍스트를 "시작 블록에 앵커된 부분
발췌"로 취급한다. `issue_links` 행은 기존과 동일하게 시작 블록의
`(minute_version_id, body_hash, block_index, block_hash)`에 앵커되고,
`excerpt_snapshot`에 검증된 선택 텍스트가 들어간다.

기각한 대안:
- **B. `link_type='minute_selection'` 신설(DB 확장)** — 선택 정밀 하이라이트 렌더링이
  없는 현재 YAGNI. 마이그레이션+RPC 개정 비용만 추가된다.
- **C. 클라이언트 선택 텍스트를 그대로 저장** — 서버 원문 검증 불변식을 깬다. 배제.

## 4. 데이터 계약

### 4.1 소스 입력 확장 (`MinuteIssueSourceInput`)

```ts
export interface MinuteIssueSourceInput {
  minuteId: string
  minuteVersionId: string
  bodyHash: string
  blockIndex: number        // 선택 등록 시 = 시작 블록
  blockHash: string         // 선택 등록 시 = 시작 블록 해시
  kind: IssueMinuteSourceKind
  /** 드래그 선택 등록일 때만 존재. 없으면 기존 블록 단위 흐름 그대로. */
  selection?: {
    text: string            // DOM Range.toString() 원본(서버가 정규화·검증)
    endBlockIndex: number   // 끝 블록 (start와 같을 수 있음)
    endBlockHash: string
  }
}
```

- `selection` 미전송 = 기존 계약과 바이트 단위로 동일(하위 호환).
- 선택 등록의 `kind`는 항상 `'manual'`. 서버는 selection이 있으면 kind를 manual로
  강제한다(인사이트 라벨은 블록 단위 개념이므로 선택 흐름에 얹지 않는다).
- 유효성: `endBlockIndex >= blockIndex`, 두 해시 모두 16-hex, `text` 정규화 후 비어있지
  않음, `text` 길이 상한 20,000자·범위 블록 수 상한 200 — 상수는
  `MINUTE_SELECTION_MAX_CHARS`/`MINUTE_SELECTION_MAX_BLOCK_SPAN`으로 클라 게이트와 공유.
  상한 초과는 "선택 범위가 너무 큽니다" 전용 문구로 거절(형식 오류 문구와 분리).
  `selection: null`은 '선택 없음'으로 취급한다(TypeError 500 방지).

### 4.2 저장 (변경 없음)

- `issue_links`: 시작 블록 앵커 + `excerpt_snapshot` = 검증된 선택 텍스트(기존 4,000자
  캡·서로게이트 경계 처리 재사용). `source_kind='manual'`.
- `source_key`: 선택 등록은 기존 키에 `:sel:<fnv1a64(공백제거 선택텍스트)>` 접미사를
  붙인다(`makeMinuteIssueSourceKey` 확장). DB CHECK(`btrim <> ''`)는 형식을 강제하지
  않으므로 무마이그레이션. 같은 블록의 전체 블록 등록과 조회 키가 구분된다.
- RPC `create_issue_from_minute_block` 무변경 — excerpt는 이미 서버 액션이 검증 후
  전달하는 계약이다.

## 5. 서버 검증 — `matchMinuteSelection`

`src/lib/minutes/selection.ts` 신설. 순수 함수로 클라·서버·테스트가 공유한다.

```ts
matchMinuteSelection(
  blocks: readonly MinuteBlock[],
  startIndex: number, startHash: string,
  endIndex: number, endHash: string,
  rawText: string,
): { ok: true; excerpt: string } | { ok: false; reason: 'anchor' | 'text' | 'empty' }
```

판정 순서:
1. 시작·끝 블록이 존재하고 markable이며 해시가 일치하는가. (아니면 `anchor`)
2. `rawText`를 줄 단위 정규화(CRLF→LF, 줄 내 공백 압축, 빈 줄 제거)한 것이 비어있지
   않은가. (아니면 `empty`)
3. **공백 제거 대조**: 범위 `[startIndex..endIndex]` 안 markable 블록들의 `block.text`를
   이어붙이고 모든 공백을 제거한 문자열 H, 선택 텍스트에서 모든 공백을 제거한 문자열 N을
   만들어 N이 H의 **연속 부분 문자열**인지 확인한다. 매치는 시작 블록 안에서 시작하고
   끝 블록에 최소 1자 걸쳐야 한다(끝점 부풀리기 거절). 반복 문구 전수 순회(O(H×N))를
   피하기 위해 걸침 조건을 만족할 수 있는 최소 시작 위치부터 **단일 `indexOf`** 로
   등가 판정한다. (아니면 `text`)
4. **발췌는 클라이언트 문자열이 아니라 매치 좌표로 잘라낸 서버 원문이다** — 블록별
   스트립 위치→원문 위치 맵으로 `block.text` 슬라이스를 재구성하고 블록 경계만
   줄바꿈으로 구분한다. 클라이언트가 공백·줄바꿈 재배치로 발췌 뉘앙스를 위조해
   provenance 스냅샷에 심을 수 없다(2026-08-01 적대적 리뷰 발견 반영). 표 블록은
   mdast 평문 특성상 셀이 무간격으로 이어진다(결정적 서버 파생값).

공백 제거 비교를 쓰는 이유: DOM 렌더 텍스트와 mdast 평문의 차이(표 셀 사이 탭/개행,
목록 들여쓰기, 줄바꿈 위치)는 전부 공백 차이다. `block.text`(구분자 없는
`mdastToString`)를 기준으로 하면 표·체크박스·강조 마크업이 흡수된다. 체크박스의
`[완료]` 접두는 `draftText`에만 있고 `text`·DOM에는 없으므로 대조가 성립한다.

한계(문서화된 실패 허용): 각주 참조 번호 등 mdast 평문에 없는 DOM 텍스트가 선택에
포함되면 대조가 실패한다. 이때는 fail-closed로 에러를 내고 블록 단위 등록을 안내한다.
추측 재매칭은 하지 않는다(source.ts와 같은 원칙).

### 5.1 `verifyMinuteIssueBlock` 통합

- 기존 검증(버전 조회·body_hash 이중 확인·시작 블록 검증·아카이브/프로젝트 경계)을
  그대로 통과한 뒤, `selection`이 있으면 `matchMinuteSelection`을 추가로 수행한다.
- 성공 시 `VerifiedMinuteIssueBlock`에 `selectionExcerpt: string | null`을 추가로 담는다.
- `prepareMinuteIssueDraft`: 선택이 있으면 heading 블록 거절 규칙을 "범위에 non-heading
  markable 블록이 하나 이상"으로 바꾼다(제목만의 선택은 클라에서 이미 억제, 서버도
  거절). AI 원문 = `selectionExcerpt`, 컨텍스트 = 기존 `minuteIssueDraftContext`(시작
  블록 기준 상위 섹션·인접 블록) + "선택이 속한 블록 전체" 텍스트를 보조로 추가.
  AI 캐시 키에 선택 해시 포함.
- `createIssueFromMinuteBlock`: excerpt = `selectionExcerpt`(있으면) → 기존 4,000자 캡
  함수 통과 후 RPC 전달. source_key는 4.2 규칙.

## 6. 클라이언트 UX

### 6.1 선택 버블 (`MinuteSelectionBubble.tsx` 신설)

- `MinuteViewer` 본문 카드(`bodyRef`)에서 `pointerup` + `selectionchange`를 구독.
- 표출 조건(전부 충족, 2026-08-01 적대적 리뷰 반영):
  - 선택이 비어있지 않고 단일 Range(`rangeCount === 1` — Firefox 표 열 드래그 같은
    다중 Range 비연속 선택은 미지원), 양 끝의 조상 `[data-mblock]`이 **둘 다** bodyRef 안.
  - 공백 제거 5자 이상, 원본 20,000자·200블록 이하(서버 상한과 동일 게이트).
  - 과거 버전 열람·보관 회의록이 아님(기존 onBodyClick 비활성 조건과 동일).
  - 선택 범위에 heading이 아닌 markable 블록이 하나 이상.
  - **클라 선행 대조 통과**: `matchMinuteSelection`을 클라에서 미리 실행 — 머메이드·
    이미지 alt 등 렌더 전용 텍스트가 낀 선택은 버블 자체를 띄우지 않고, 통과하면
    저장될 발췌(서버 파생본)를 target 에 확보해 미리보기·폴백과 저장이 일치한다.
- **앵커 클램프**: Chrome 계열의 트리플클릭·문단 끝 넘김 드래그는 끝 앵커를 다음 블록의
  offset 0 에 두는데, 그 블록은 선택 문자를 기여하지 않아 서버 걸침 판정에서 거절된다.
  Range 교차 텍스트가 0자인 끝/시작 블록을 실제 기여 블록까지 당겨서 보낸다.
- **인플라이트 취소**: 선택 prepare 진행 중 바깥 클릭·선택 해제로 버블이 사라지면
  `onDismiss` → requestId 증가로 요청을 취소한다 — 뒤늦은 응답이 폼을 돌발 오픈하지
  않는다(블록 팝오버 onClose 와 같은 원칙).
- 위치: `Range.getBoundingClientRect()` 하단 근처 fixed 배치(팝오버와 같은 좌우 클램프).
  스크롤·리사이즈 시 rAF로 재계산해 따라간다. 선택 해제 시 즉시 숨김.
- 내용: "이슈로 등록" 버튼 하나(+ 로딩 스피너). 버튼 z-index·클릭이 기존 블록 클릭
  핸들러와 간섭하지 않게 버블 자체 클릭은 전파 중단.
- 기존 팝오버와의 공존: 현재 `onBodyClick`은 선택이 있으면 팝오버를 열지 않으므로
  충돌 없음. 버블이 떠 있는 동안 블록 클릭으로 팝오버가 열리면(선택 해제 클릭) 버블은
  selectionchange로 자연 소멸.

### 6.2 `MinuteViewer` 상태 재편

이슈 등록 원천을 판별 유니언으로 통합한다:

```ts
type IssueSourceSel =
  | { type: 'block'; index: number }
  | { type: 'selection'; startIndex: number; endIndex: number; text: string }
```

- 기존 `issueBlockIndex` 상태를 이 유니언으로 대체하고, `issueContextAt`·
  `beginIssueCreate`·`continueWithProject`·`createLinkedIssue`·`issueDraft`·
  `sourcePreview`가 유니언에서 분기한다. 블록 흐름의 로직·문구·에러 처리는 그대로.
- 선택 흐름의 폴백 초안: `buildFallbackMinuteIssueDraft(선택 정규화 텍스트, null)`.
- `sourcePreview.excerpt` = 선택 정규화 텍스트. 프로젝트 미지정 회의록의 프로젝트
  선택 모달 흐름도 동일 상태 기계를 그대로 통과한다.
- 선택 텍스트 정규화는 서버와 같은 함수(`normalizeSelectionText` — selection.ts에서
  export)를 클라에서도 사용해 미리보기와 저장 결과가 일치한다.

### 6.3 i18n

`min.sel.*` 키 신설(버블 버튼, 대조 실패 에러, 짧은 선택 안내 등) — ko/en 두 사전.
서버 액션 에러 문구는 기존 한국어 관례를 따른다.

## 7. 에러 처리

- 대조 실패(`text`/`anchor`): "선택 영역을 원문과 대조하지 못했습니다. 블록 단위로
  등록해 주세요." — fail-closed, 저장·AI 호출 진행하지 않음.
- 버전 변경·아카이브·프로젝트 불일치: 기존 블록 흐름과 동일 문구 재사용.
- AI 실패: 기존과 동일하게 결정형 폴백 초안 + 안내 토스트.
- 표시=로깅 원칙: 서버 검증 실패는 기존 `console.error` 라벨 관례를 따른다.

## 8. 테스트

- **`tests/minutes/selection.test.ts`(신설)** — 순수 매칭: 단일 블록 부분 선택 /
  다중 블록 걸침 / 표 셀 가로지르기(탭·개행 차이) / 체크박스 목록 / 강조·링크 마크업 /
  불일치 텍스트 거절 / 끝점 부풀리기 거절 / heading 경계 / 빈·공백 선택 / 정규화 일치.
- **`tests/actions/issue-from-minute.test.ts`(확장)** — selection 유효성(형식·범위 상한·
  kind 강제) / 검증 성공 시 excerpt·source_key / 대조 실패 fail-closed / prepare의
  heading-only 거절과 AI 입력이 선택 텍스트인 것.
- **`tests/ui/minute-issue-draft-flow.test.tsx`(확장) + 버블 UI 테스트** — 표출 조건
  (5자 미만·본문 밖·과거 버전 억제) / 선택 → 버블 → 모달 오픈, 미리보기 발췌 일치 /
  기존 블록 흐름 회귀 없음.

## 9. 변경 파일 요약

| 파일 | 변경 |
|---|---|
| `src/lib/minutes/selection.ts` | 신설 — 정규화·매칭 순수 함수 |
| `src/components/minutes/MinuteSelectionBubble.tsx` | 신설 — 선택 버블 |
| `src/components/minutes/MinuteViewer.tsx` | 소스 유니언 상태·버블 연결 |
| `src/app/actions/issues.ts` | selection 유효성·검증 통합·excerpt/source_key |
| `src/lib/domain/issueMinuteSource.ts` | source_key `:sel:` 확장 |
| `src/lib/i18n/dict/minutes.ts` (ko/en) | `min.sel.*` 키 |
| DB / RPC / 마이그레이션 | **변경 없음** |
