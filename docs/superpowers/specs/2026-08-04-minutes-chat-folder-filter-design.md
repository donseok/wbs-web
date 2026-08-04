# 회의록 챗 '전체 회의록' 범위 — 하위 폴더 필터 설계

2026-08-04. 요청: 뷰어 챗 패널의 '전체 회의록' 범위에서 팀(대분류) 칩만 있어
범위가 너무 뭉쳐 있다 — 팀 아래 하위 카테고리(폴더)까지 골라 질문하고 싶다.

## 결론

팀 칩 아래에 **둘째 줄 칩(전체 + 팀 루트의 직계 하위 폴더)** 를 추가하고,
선택한 폴더의 **하위 트리 전체**(자기+자손)를 검색 필터로 관통시킨다.
벡터 검색(RPC)·키워드 검색(ILIKE) 둘 다 같은 폴더 집합을 본다.

하위 카테고리의 원천은 탐색기·업로드 모달과 동일하게 **실폴더 동적 유도**
(`minute_folders`에서 팀 시드 루트의 직계 하위) — 하드코딩 목록을 만들지 않는다.

## 대안 비교

- **A안(채택)** 폴더 필터를 RPC까지 관통 — `match_minute_documents`에
  `p_folder_ids uuid[] default null` 추가(0066, 하위호환). 키워드 검색은
  `.in('folder_id', ids)`. 두 경로가 같은 범위를 본다.
- B안(기각) 마이그레이션 없이 벡터 결과 후필터 — match 8건이 팀 기준으로 잘린 뒤
  폴더로 거르면 결과가 거의 0이 되는 품질 문제.
- C안(기각) 키워드만 폴더 필터 — 벡터/키워드가 서로 다른 범위를 보는 비정합.

## 구성 요소

### 1. DB — 0066 (+_rollback)

```sql
-- match_minute_documents 에 p_folder_ids uuid[] default null 추가
-- where 절: and (p_folder_ids is null or m.folder_id = any(p_folder_ids))
```

기존 호출(파라미터 미전달)은 default null 로 무영향 — 마이그레이션 선적용 후
코드 배포 순서가 안전하다. 적용은 Management API 경유(레시피 준수), 별도 커밋(G1).

### 2. 도메인 순수 함수 — `src/lib/domain/minutes.ts`

- `folderSubtreeIds(folders, rootId): string[]` — 자기+자손 전부. 순환·끊긴 참조 가드.
- `teamChildFoldersOf(folders, team): MinuteFolder[]` — 기존 private `teamChildFolders`
  를 export (트리와 같은 정렬 `byFolderOrder`). UI 칩의 원천.

### 3. API — `/api/minutes/chat` (archive 모드)

- `filters.folderId?: string` 수용.
- 검증(fail-closed): folderId 가 있으면 폴더 스냅샷을 읽어
  ① 폴더가 실재하고 ② 선택한 팀의 시드 루트 트리에 소속함을 확인. 아니면 400.
  조용히 무시하면 필터가 소리 없이 넓어진다(에러 3원칙 위반).
  team 없이 folderId 만 오는 요청도 400(UI 는 팀 선택 시에만 칩을 노출).
- 통과 시 하위 트리로 확장해 `folderIds: string[]` 로 전달.

### 4. 검색 — `streamArchiveAnswer`

`filters.folderIds?: string[] | null` 추가.
- 벡터: RPC 호출에 `p_folder_ids` 전달.
- 키워드: `q.in('folder_id', folderIds)`.
- 팀 루트 직속 회의록(folder_id=루트)·미분류(null)는 하위 폴더 선택 시 제외 —
  '전체'(폴더 미선택)가 그것까지 포함하는 팀 전체다. 의도된 사양.

### 5. UI — `MinuteChatPanel`

- archive 범위 첫 진입 시 `fetchMinuteFoldersLite()` 지연 로드(1회, 상태 보관).
- 팀 ≠ ALL 이고 직계 하위 폴더가 있으면 팀 칩 아래 둘째 줄:
  `[전체, <하위 폴더…>]` — key=폴더 id, label=폴더명, 가로 스크롤 허용.
- 팀 변경 시 폴더 선택 리셋. 요청 body 에 `filters.folderId` 포함.
- 폴더 로드 실패는 숨김이 아니라 안내 문구(표시=로깅) — 팀 필터만으로 계속 사용 가능.
- 목록 페이지 `ArchiveChatPanel` 은 페이지 필터 상속 구조 유지, 이번 범위 제외.

## 테스트

- `folderSubtreeIds`: 깊은 트리·형제 배제·순환 가드·부재 id.
- `teamChildFoldersOf`: 시드 루트 한정·정렬·루트 부재.
- 기존 vitest 스위트 회귀 0.

## 배포 순서

0066 적용(Management API) → 마이그레이션 커밋 → 코드 커밋 → push → `smoke:prod`.
