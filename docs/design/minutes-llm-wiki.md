# 회의록 기반 LLM Wiki

## 목표

프로젝트 회의록을 감사 가능한 근거로 유지하면서, 명시된 결정·사실·액션·질문·리스크·
제약·근거를 프로젝트 Wiki에 자동 반영한다. PMO 결재나 별도 승인 큐는 두지 않는다.
대신 불명확하거나 상충하는 문장은 현재 지식을 조용히 덮지 않고 열린 항목/충돌로 보존한다.

## 사용자 흐름

1. 기존 `/minutes`에서 `.md` 회의록을 업로드하고 프로젝트·회의 회차를 연결한다.
2. 저장과 동시에 원문 v1과 Wiki 처리 작업이 영속적으로 기록된다.
3. 회의록 상세에서 원본 버전 이력과 해당 회의록의 Wiki 반영 결과를 확인한다.
4. 프로젝트 사이드바의 `Wiki`에서 주제별 현재 지식, 결정, 열린 액션/질문/리스크,
   충돌, 변경 이력을 본다.
5. 모든 근거 링크는 `minute_version_id + body/block hash`로 당시 원문 블록을 연다.

기존 회의록 탐색·상세·검색 인터페이스는 유지하고, 프로젝트 표시, 새 버전 업로드,
버전 이력, Wiki 반영 카드만 보강한다.

## 원본 보존 계약

- `minutes`는 현재 표시 포인터이고 `minute_versions`가 불변 원본 정본이다.
- 생성은 `create_minute_with_version`, 본문 교체는 `commit_minute_body_version` RPC로만
  처리해 `minutes + version + current file pointer`를 한 트랜잭션으로 커밋한다.
- 과거 버전에는 본문뿐 아니라 당시 제목·일자·팀·프로젝트·회의 회차 메타도 저장한다.
- 인증 사용자의 `minutes` 직접 INSERT/UPDATE/DELETE와 버전 UPDATE/DELETE를 막는다.
- 버전이 참조하는 Storage 객체는 삭제 정책으로 보호한다.
- 사용자 “삭제”는 soft archive다. 목록에서는 숨기지만 원본, 버전, 파일, Wiki 감사
  근거는 유지하며 직접 근거 링크에서는 읽기 전용으로 열 수 있다.

## 자동 지식 반영

- LLM은 원문 블록에서 원자적 지식 후보와 직접 근거 블록만 추출한다.
- 코드가 열거값, 길이, 날짜, 근거 블록, 잠정 표현, 변경/철회/해소 표지를 다시 검증한다.
- 잠정 표현은 `open`, 같은 문장은 `reaffirm`, 명시적 보완·대체·철회·해소만 현재값
  변경 후보가 된다.
- 동일 키의 다른 명시 문장이 안전 조건을 만족하지 않으면 `conflicted`로 나란히 보존한다.
- 항목·출처·관계·변경 이벤트는 프로젝트/지식 키 잠금과 expected-current 검증을 거친
  원자 RPC로 반영한다.
- 오래된 회의록 버전 작업은 최신 버전이 생긴 뒤 현재 지식을 역행시키지 않는다.
- 각 지식 mutation RPC는 `job id + locked_by + apply generation`을 다시 잠그고 확인한다.
  lease가 회수된 구세대 LLM worker는 항목·근거·변경 이력을 한 건도 늦게 쓸 수 없다.
- rebuild generation의 첫 단계는 수동/잠금 항목을 보존한 채 기존 AI current 항목과
  활성 근거를 한 번 soft-reset한 뒤 재생한다. live 상태 위에 과거 회의를 덧씌워 생기는
  거짓 충돌이나 중복 current를 남기지 않는다.
- 수동 작성 항목은 `auto_update_locked` 값과 무관하게 AI가 refine·supersede·resolve
  하지 않는다. 동일 내용은 근거만 재확인하고, 다른 명시적 내용은 별도 conflict로 남긴다.
- 본문 내용이 바뀐 새 버전은 이전 버전 Wiki 근거를 같은 DB 트랜잭션에서 철회하고,
  같은 트랜잭션에 프로젝트 재구성 generation을 남긴다. 워커는 `(회의 시점, 회의록 ID)`
  keyset cursor로 활성 회의록 최신 버전을 한 건씩 재처리한다. 500건 같은 고정 상한이나
  한 번의 serverless 실행시간에 의존하지 않으며, 성공한 단계에서만 cursor가 전진한다.
  새 본문에서 삭제된 문장이 과거 source 때문에 현재 지식으로 남지 않는다.
- 프로젝트 회의록 생성은 모두 ordered project queue로 보낸다. 정상적인 시간축 끝 추가는
  완료 cursor 뒤에 이어 붙여 기존 Wiki를 reset하지 않고, 과거 삽입·회의일/회차일 변경만
  새 generation을 올려 full rebuild한다. 저장 순서와 비동기 실행 순서가 달라도
  `(회의 시점, 회의록 ID)` 순서로 재생하고, 새 회의록이 잦아도 매번 처음부터 시작하지 않는다.
- 같은 날짜의 순서는 변경 가능한 version 생성 시각이 아니라 원 회의록의 생성 시각으로
  고정한다. 파일 연결이나 본문 버전 추가가 기존 회의들의 상대 순서를 뒤집지 않는다.
- 마이그레이션 시 기존 활성 프로젝트 회의록도 최초 rebuild job으로 backfill한다.
- 파일 연결처럼 본문이 같은 새 불변 버전은 원문 이력만 추가하며 의미가 같은 기존 Wiki
  근거를 그대로 유효하게 본다. replay 도중 같은 본문의 새 버전이 생겨도 직전 source를
  stale로 버리지 않으며, 본문 또는 시간축이 실제로 바뀔 때만 full rebuild한다.

## 프로젝트 이동과 보관

프로젝트 재귀속/보관 시 해당 회의록 출처를 soft-retract하고, 그 출처가 영향을 준 AI
항목을 archive한다. 이후 남아 있는 활성 회의록의 최신 불변 버전을 시간순으로 재처리해
프로젝트의 현재 지식을 복원한다. 수동 항목과 자동 갱신 잠금 항목은 자동으로 지우지 않는다.
보관 시 기존 공유는 즉시 꺼지고, 레거시 회의록 벡터와 DK Bot 검색 문서도 삭제한다.
프로젝트 이동은 모든 과거 검색 scope에 delete tombstone을, 새 scope에 upsert를 남긴다.
프로젝트 미지정은 누락값이 아니라 명시적 `global` 검색 scope로 동일하게 처리한다.
색인 문서를 쓰는 마지막 DB 지점에서도 현재 프로젝트·보관 상태를 재검증하므로, lease
만료 뒤 늦게 도착한 구세대 색인 작업도 보관본이나 과거 scope를 되살릴 수 없다.

## 운영

- 정상 저장은 응답 전에 `wiki_processing_jobs`에 작업을 넣고, 실제 LLM 처리는 비동기로
  실행한다.
- 철회가 필요한 변경은 같은 DB 트랜잭션에서 `wiki_project_rebuild_jobs`를 갱신한다.
  `generation + rerun_requested`가 실행 중 들어온 재요청을 보존하고, 단계와 minute job을
  결박해 응답 유실 시에도 같은 처리를 중복 force하지 않는다.
- inline 실행이 끊겨도 `/api/wiki/worker`가 pending/stale 작업을 재시도한다.
- 한 단계가 dead-letter된 뒤 새 forward 회의록이 들어오면 project row뿐 아니라 결박된
  minute job도 같은 멱등 세대로 다시 열어, poison step 뒤의 정상 회의록이 영구 정체되지 않는다.
- Vercel Cron은 `CRON_SECRET` Bearer 인증, 수동 POST는 별도 `WIKI_WORKER_SECRET`을 쓴다.
- 필요한 환경 변수:
  - `WIKI_WORKER_ENABLED=true`
  - `CRON_SECRET=<16자 이상의 무작위 값>`
  - `WIKI_WORKER_SECRET=<수동 실행용 별도 값>`
- 먼저 `0045_minutes_wiki.sql`, 이어서 `0046_wiki_atomic_apply.sql`을 적용한 후 앱을
  배포한다. 롤백은 파생 Wiki와 버전 이력을 제거하므로 운영 데이터가 생긴 뒤에는 일반
  배포 롤백 수단으로 사용하지 않는다.
