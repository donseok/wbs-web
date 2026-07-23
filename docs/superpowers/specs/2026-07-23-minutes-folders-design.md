# 회의록 폴더 디렉토리 설계 — 탐색기 v2 (2026-07-23)

## 배경·목표

탐색기 v1(스펙 `2026-07-23-minutes-explorer-design.md`, 배포됨)의 좌측 레일은 "팀(구분)→회의체(제목 파생)"라는 **파생 가상 폴더**다. 이를 **DB 기반 실제 디렉토리 구조**로 교체한다: 주간업무 구분 10개를 기본 폴더로 시드하고, 누구나 폴더를 자유롭게 추가·중첩할 수 있으며, 회의록이 폴더에 소속된다.

## 확정 요구사항 (사용자 결정 이력)

| 결정 | 내용 |
|------|------|
| 기본 폴더 | 주간업무 구분 10개(`WEEKLY_SECTIONS`, weeklySheet.ts:19 — PMO·영업·구매·관리회계·품질·생산계획·조업및표준화·물류·설비및L2·가공)를 루트에 시드 |
| 초기 배정 | 기존 회의록·폴더 미지정 업로드(또박또박 API 포함)는 **미분류 가상 폴더**(folder_id null) — 자동 분류 없음 |
| 중첩 | **자유 중첩 + 깊이 상한 5단**(루트=1단) |
| 접근 | **접근 A** — `minute_folders` 테이블 + `minutes.folder_id`, 파생 회의체 축은 탐색기에서 폐기 |
| 권한 | 폴더 생성=전 구성원, 수정·삭제=생성자 or pmo_admin(시드 폴더는 created_by null → pmo_admin 전용), 회의록 이동=기존 minutes update 정책(작성자 or pmo_admin) |

## 아키텍처

### 1) 마이그레이션 `supabase/migrations/0040_minute_folders.sql` (멱등 + 롤백 파일 동반)

```sql
create table if not exists minute_folders (
  id         uuid primary key default gen_random_uuid(),
  name       text not null check (length(btrim(name)) between 1 and 60),
  parent_id  uuid references minute_folders(id) on delete cascade,
  sort       int not null default 100,  -- 시드(0~9) 뒤에 정렬되도록 사용자 생성 기본값을 100으로

  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- 같은 부모 안 이름 중복 금지 — 루트(parent null)와 하위를 부분 인덱스 2개로 커버
create unique index if not exists minute_folders_root_name_uniq
  on minute_folders (name) where parent_id is null;
create unique index if not exists minute_folders_child_name_uniq
  on minute_folders (parent_id, name) where parent_id is not null;

alter table minutes add column if not exists folder_id
  uuid references minute_folders(id) on delete set null;  -- 폴더 삭제 → 미분류 강등(소실 없음)
create index if not exists minutes_folder_idx on minutes (folder_id);

-- 기본 10구분 시드(멱등: 루트 유니크에 on conflict do nothing). created_by null → pmo_admin만 관리.
insert into minute_folders (name, sort) values
  ('PMO',0),('영업',1),('구매',2),('관리회계',3),('품질',4),
  ('생산계획',5),('조업및표준화',6),('물류',7),('설비및L2',8),('가공',9)
on conflict do nothing;
```

RLS(0021 minutes 관례 — 프로덕션 헬퍼 `app_role()`):

```sql
alter table minute_folders enable row level security;
-- 읽기: 전 구성원 / 생성: 본인 명의 / 수정·삭제: 생성자 or pmo_admin
drop policy if exists read_all_minute_folders on minute_folders;
create policy read_all_minute_folders on minute_folders
  for select to authenticated using (true);
drop policy if exists insert_own_minute_folders on minute_folders;
create policy insert_own_minute_folders on minute_folders
  for insert to authenticated
  with check (created_by = auth.uid() and app_role() is not null);
drop policy if exists update_own_minute_folders on minute_folders;
create policy update_own_minute_folders on minute_folders
  for update to authenticated
  using (created_by = auth.uid() or app_role() = 'pmo_admin')
  with check (created_by = auth.uid() or app_role() = 'pmo_admin');
drop policy if exists delete_own_minute_folders on minute_folders;
create policy delete_own_minute_folders on minute_folders
  for delete to authenticated
  using (created_by = auth.uid() or app_role() = 'pmo_admin');
```

- `on conflict do nothing`은 부분 유니크 인덱스를 타깃하지 못하므로 실제 시드는 `insert ... select ... where not exists` 형태로 작성한다(계획서에 전문 확정). 재실행 안전이 요건.
- 깊이 상한 5단·순환 방지는 서버 액션에서 검증(폴더 테이블이 작아 전량 로드 후 조상 체인 걷기). DB 트리거는 과설계로 비범위.
- 롤백: `minutes.folder_id` drop + 테이블 drop. **역순 주의**(코드가 folder_id 조회) — 코드 롤백 후 적용. 롤백 시 모든 폴더 배정이 소실됨을 경고 주석에 명시.

### 2) 도메인 — `src/lib/domain/minutes.ts` (+types)

- **삭제**: `buildMinutesTree`, `MinutesTreeGroup/Body/Leaf` 타입, 관련 도메인 테스트(트리 조립 부분). `meetingBodyOf`·노이즈 패턴은 **유지**(내보내기 ZIP이 사용, export.ts:60·122) — 그 테스트도 유지.
- **신규 타입**(types.ts):

```ts
export interface MinuteFolder {
  id: string; name: string; parentId: string | null; sort: number; createdBy: string | null
}
/** 탐색기 리프 — 목록 조회 shape에 폴더 소속 부착. */
export interface ExplorerLeaf {
  id: string; minuteDate: string; teamCode: TeamCode; title: string
  fileCount: number; createdByName: string | null
  bodyPreview: string; meetingCategory: MeetingCategory | null
  folderId: string | null
}
export interface FolderNode {
  folder: MinuteFolder
  children: FolderNode[]
  directLeaves: ExplorerLeaf[]   // 이 폴더 직계 소속(입력 순서 = 날짜 내림차순)
  totalCount: number             // 하위 포함 재귀 합계
}
```

- **신규 순수 함수** `buildFolderTree(folders: MinuteFolder[], leaves: ExplorerLeaf[]): { roots: FolderNode[]; unfiled: ExplorerLeaf[] }`
  - 루트 정렬: `sort asc, name asc`(시드 10개가 0~9라 먼저, 사용자 추가 루트는 sort 기본값 그대로 뒤에 이름순). 하위 동일 규칙.
  - 방어: `parent_id`가 목록에 없는 고아 폴더는 루트로 승격, 순환 참조는 감지 시 루트로 절단(조용히 버리지 않음). `folder_id`가 목록에 없는 리프는 unfiled로.
  - `unfiled` = folder_id null(또는 dangling) 리프.
- **신규 검증 함수** `validateFolderName(name): string | null`(1~60자, trim 후 비면 에러), `folderDepthOf(folders, parentId): number`(조상 체인 길이 — 액션의 5단 검증에 사용, 순환 시 상한 초과 취급).
- `MINUTES_FOLDER_DEPTH_MAX = 5`, `MINUTE_FOLDER_NAME_MAX = 60`.

### 3) 데이터 계층 — `src/lib/data/minutes.ts`

- `LIST_COLS`에 `folder_id` 추가, `mapMinute`에 `folderId` 매핑(`Minute` 타입에 `folderId?: string | null`).
- `getMinutesTree` → **`getMinutesExplorer`로 교체**: `Promise.all`로 ① minutes 전 기간 `MINUTES_TREE_LIMIT`(기존과 동일) ② `minute_folders` 전량 조회. 반환 `{ folders: MinuteFolder[]; leaves: ExplorerLeaf[]; total: number; truncated: boolean } | null`(실패 시 로깅+null — 기존 계약 유지). 트리 조립은 클라이언트(`buildFolderTree`를 탐색기 useMemo에서) — 팀 탭 필터를 리프에 먼저 적용한 뒤 조립해야 하므로 서버 조립은 성립하지 않는다.
- `getMinuteFolders()` 단독 함수는 만들지 않는다(YAGNI — 탐색기 페이로드에 동봉).

### 4) 서버 액션 — `src/app/actions/minutes.ts`

모두 세션 가드 + 실패 시 `{ ok: false, error }` 또는 null(조회) — 기존 관례.

- `fetchMinutesExplorer()` — `fetchMinutesTree` 대체(미로그인/실패 null 계약 동일).
- `createMinuteFolder(name, parentId | null)` — 이름 검증·부모 존재·깊이 5단·같은 부모 내 중복 검사(유니크 인덱스가 최종 방어, 23505 → 친절한 에러 문구). 성공 시 생성된 폴더 반환.
- `renameMinuteFolder(id, name)` — 이름 검증(+중복 23505 처리). RLS가 권한 거부.
- `deleteMinuteFolder(id)` — FK cascade(하위 폴더)·set null(회의록)이 정리. 확인 다이얼로그 문구는 건수를 넣지 않는다("하위 폴더가 함께 삭제되고 소속 회의록은 미분류로 이동합니다") — 클라이언트 totalCount는 팀 탭 필터가 걸리면 실제 건수와 달라 오표기가 되기 때문.
- `moveMinuteToFolder(minuteId, folderId | null)` — folderId 존재 검증(null=미분류 허용) 후 `minutes.folder_id` 업데이트. 권한은 기존 `update_own_minutes` RLS(작성자 or pmo_admin)가 담당 — 0행 업데이트면 권한 없음으로 판정해 `{ok:false}`.

### 5) UI

**`MinutesExplorer.tsx` 개편** (v1 골격 유지 — 2단 레이아웃, 그리드/리스트, 더 보기 30, 즐겨찾기, 스트레치드 링크):

- 스코프: `all | favorites | unfiled | folder(id)`. 팀 탭 프루닝은 리프 필터로 이동(폴더는 항상 전부 표시, 카운트는 필터된 리프 기준 재계산). 선택 폴더가 삭제되면 all 강등(v1 프루닝 강등과 동일 패턴).
- **레일**: ⭐즐겨찾기 → 📁전체 `[+]` → 폴더 트리(재귀, 자식 있는 폴더만 셰브런) → 📂미분류. 카운트=재귀 합계. 폴더 행 호버 `⋯` 메뉴: 이름 변경·하위 폴더 추가·삭제. `[+]`(레일 헤더)=루트 폴더 생성.
- **폴더 관리 모달**(신규 소형 컴포넌트 `FolderManageModal`): 생성/이름 변경 공용(텍스트 입력+검증 에러 표시), 삭제 확인("하위 폴더 포함 N건은 미분류로 이동합니다"). 기존 `Modal`·`useToast` 사용. 성공 시 탐색기 데이터 재조회(MinutesView `loadTree` 재사용).
- **우측 콘텐츠**:
  - `all`: 루트 폴더 카드들 + 미분류 카드 + **전체 회의록 flat 날짜순**(v1 UX 유지 — 최신 훑기용).
  - `folder(id)`: 직계 하위 폴더 카드 + **직계 소속 회의록만**(파일시스템 시맨틱). 폴더 카드 메타: `회의록 {재귀 N}건 · 하위 폴더 {직계 M}개`(M=0이면 생략).
  - `unfiled`: 미분류 리프만. `favorites`: 기존 그대로(fav ∩ 전체 리프).
  - 경로 표시 = 전체 › 조상 체인 › 현재(조상 클릭 이동).
- **회의록 카드**: 회의체 칩 폐기 → **폴더 칩**(all·favorites 스코프에서, 소속 있을 때만). `⋯` 이동 버튼(작성자·pmo_admin만 표시) → **폴더 선택 모달**(`FolderPickModal` — 레일과 같은 트리 + 미분류, 선택 시 `moveMinuteToFolder` 낙관 없이 성공 후 재조회·토스트).
- **업로드 모달**(`MinuteUploadModal`): 폴더 셀렉트 추가(트리 들여쓰기 옵션 + 미분류 기본). 탐색기에서 폴더 선택 중이면 그 폴더가 기본값 — 탐색기 `onFolderSelect` 콜백으로 MinutesView가 마지막 선택 폴더를 기억해 모달에 전달. 폴더는 `MinuteInput`에 넣지 않고 **`createMinute`의 별도 파라미터**로만 받는다(존재 확인은 액션에서) — `MinuteInput`은 updateMinuteMeta·replaceBody와 공유되므로 거기 넣으면 메타 수정이 폴더 배정을 덮어쓰는 사고 경로가 생긴다. 이동은 전용 액션(`moveMinuteToFolder`)만 사용, updateMinuteMeta는 folder_id를 건드리지 않는다. 또박또박 API는 무변경(folder_id 미지정 → 미분류).
- **MinutesView**: treeState 기계·검색 강제 리스트·월 라벨·챗 스코프·favState·exLayout **모두 유지**. 페이로드 타입만 교체(`fetchMinutesExplorer`), 업로드 기본 폴더 전달, 폴더 변경 후 재조회 배선.

### 6) i18n (`min.fold.*` ko/en 쌍)

전체/미분류/새 폴더/하위 폴더 추가/이름 변경/삭제/삭제 확인 문구({n} 치환)/이동/폴더 선택/이름 검증 에러/중복 에러/깊이 초과 에러/폴더 메뉴 aria. 기존 `min.exp.*`는 유지(재사용), `min.exp.subfolderCount`·`min.exp.latest` 등 그대로.

## 에러 처리

- 탐색기 조회: 기존 계약 그대로(스켈레톤/에러 카드+재시도/EmptyState).
- 폴더 CRUD·이동 실패: 토스트로 서버 에러 문구 표시(23505→중복, 깊이 초과, 권한 없음). 조용한 실패 금지.
- 시드 폴더 개명·삭제를 일반 구성원이 시도: 버튼은 렌더하되 서버 거부 시 권한 토스트(클라이언트에서 created_by를 알 수 있으므로 **본인 소유가 아니고 pmo_admin도 아니면 ⋯ 메뉴 자체를 숨김** — 이중 방어).

## 테스트

- 도메인: `buildFolderTree`(정렬·재귀 카운트·고아/순환 방어·unfiled), `validateFolderName`, `folderDepthOf`(5단 경계·순환). `buildMinutesTree` 테스트 삭제, `meetingBodyOf` 테스트 유지.
- 액션: 폴더 CRUD 가드·검증 분기·23505 매핑, `moveMinuteToFolder` 0행=권한 거부(가짜 빌더 관례).
- UI: 탐색기 재작성(스코프 4종·직계 표시·재귀 카운트·팀 탭 리프 필터·폴더 메뉴 노출 조건·이동 모달·강등), 업로드 모달 폴더 셀렉트, MinutesView 배선 계약(기존 파일 갱신 — 1회 조회·캐시·에러 재시도 유지).
- 수동: build/lint/test + 프로덕션 스모크(폴더 생성→업로드 기본값→이동→삭제 시 미분류 강등).

## 배포 순서

0040을 프로덕션 DB에 **선적용** 후 머지-푸시(0039와 동일 — 코드가 folder_id를 조회). 기존 회의록은 백필 없음(전부 미분류 시작).

## 비범위 (v2 이후)

- 드래그&드롭 이동, 회의록 일괄 이동, **폴더 자체의 부모 변경(이동)**, 폴더 즐겨찾기, 펼침 상태 영속화, 내보내기 ZIP 폴더 구조 반영(현행 팀/회의체 유지), 폴더별 권한(비공개 폴더), 정렬 커스터마이즈(sort 편집 UI)
