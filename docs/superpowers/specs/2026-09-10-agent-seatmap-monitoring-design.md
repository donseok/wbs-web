# 에이전트 좌석표 모니터링 설계 정리 (2026-09-10)

대상: `/dflow-dev` · `/dflow-poll` 로 도는 에이전트 작업의 진행 상황을 세션 밖에서 보는 화면과 그 데이터 경로.
상태: **설계 정리본**. 2026-09-14 부터 v1 구현 착수 — 구현 스펙은 `2026-09-14-agent-office-v1-design.md`(정정 목록 §9 포함, 어긋나면 그쪽이 정본). 러너 설계 개정(`2026-08-20-wbs-autonomous-runner-design.md`,
`2026-08-21-runner-design-review.md`)과 좌표가 겹치므로 착수 시 같이 다룰지 먼저 정한다.
목업: https://claude.ai/code/artifact/2ab42176-327d-49e4-916c-bc089e6c0e13 (v2, 2026-09-10)

## 1. 왜

관측 지점은 셋인데 해상도가 전부 Phase 경계 이상이다.

| 지점 | 보이는 것 | 안 보이는 것 |
|---|---|---|
| D'Flow 웹 | 주문 상태(claimed/reported) · progress 25/60/85 이력 | Phase 안에서 지금 무엇을 하는지 |
| GitHub `agent/*` 브랜치 | push 단위 물리 증거 | push 사이의 침묵 |
| 실행 세션 터미널 | 가장 세밀 | 세션 밖(타 PC · 팀장)에서는 아예 안 보임 |

그래서 외부에서는 `claimed` 가 **진행 중인지 죽었는지 구분이 안 된다.** 러너 검토 보고의 "침묵 실패 외부 검출"과
같은 뿌리다. 반자동(`/dflow-poll`)이든 무인(러너)이든, 승인자가 진행을 봐야 승인 흐름이 돈다.

## 2. 사용자가 확정한 형태

- **좌석 배치도.** 층·구역·책상을 **WBS 에서 자동 파생**한다: 프로젝트(저장소) = 층, WP = 구역, 작업 주문 = 책상.
  오피스 맵을 사람이 그리는 도구(pixel-agents 류의 레이아웃 에디터)는 쓰지 않는다.
- **사람은 사람답게.** v2 는 위에서 내려다본 SVG(머리카락·얼굴·귀·어깨·팔·손, 에이전트별 머리색·옷색·머리 모양 3종).
  **최종 형태는 참고 이미지 수준의 비트맵 캐릭터 + 상태별로 전부 따로 만든 애니메이션**(§4, 2026-09-10 확정).
- **Buzz 에서도 본다.** 외부 에이전트 게시 방식(§5-3). Buzz 관리형 에이전트로 dflow-dev 를 돌리는 방식은 비추천.

## 3. 상태 모델

책상 색 = 상태, 사람 자세 = 상태, 판정 근거는 **서버가 아는 사실**로만 한다(로컬 state.json 은 보조).

| 상태 | 판정 | 책상 | 사람(v2 SVG) | 픽셀 애니메이션(목표) |
|---|---|---|---|---|
| 업무 중 ACTIVE | claimed · heartbeat ≤ 5분 | 파랑 · progress 바 | 손을 책상에 | 타이핑, 모니터 깜빡임. Phase 소품: design=화이트보드, build=키보드, verify=돋보기·체크, refactor=빗자루 |
| 무응답 STALE | claimed · heartbeat 5~30분 | 파랑 빗금 · `!` | 머리 둘레 붉은 점선 | 졸기(zzz) 또는 물음표 말풍선 |
| 끊김 OFFLINE | claimed · heartbeat > 30분 | 회색 · 붉은 테두리 · `끊김` | 빈 의자(점선) | 의자 빔, 모니터 꺼짐 |
| 승인 대기 IDLE | reported | 주황 | 손을 무릎에 | **커피 마시기, 기지개, 의자 돌리기** (쉬는 동작) |
| 반려 REJECTED | 마지막 완료 리포트 `review_action=reject` (status 는 claimed 로 돌아감) | 붉은 스트라이프 | 손을 책상에 | 서류 다시 들추기, 땀방울 |
| 결정 대기 BLOCKED | claimed · `heartbeat_phase=blocked` (시간 판정보다 우선, 2026-09-14 추가 — v1 스펙 §2) | 파랑 · `?` | 손 든 자세(v1 은 idle_look 정지 프레임) | 손 들기 + 말풍선(질문) |
| 빈자리 READY | ready (주문만 존재) | 점선 테두리 | 빈 의자 | 빈 의자 |
| 머지 완료 DONE | approved + 로컬 merged | 회색 | 빈 의자 | 퇴근(캐릭터 없음). 층에서 접기 옵션 |
| 감시 STANDBY (층 단위) | poll.sh 실행 중 | 층 헤더 초록 배지 | — | 당직 캐릭터가 통로를 순찰 |

임계값 5분 / 30분은 초안이다. heartbeat 주기(§5-1)의 3배·15배로 잡았고 운영하며 조정한다.

## 4. 비트맵 캐릭터와 상태별 애니메이션 (2026-09-10 확정)

참고 이미지: [`2026-09-10-agent-seatmap-sprite-reference.png`](2026-09-10-agent-seatmap-sprite-reference.png)
(105×103 · 정면 · 큰 머리 · 1px 어두운 외곽선 · 2~3톤 명암의 블록형 캐릭터).
**이 수준의 비트맵으로 캐릭터를 만들고, 상태별 애니메이션은 전부 따로 둔다.**
참고 이미지 자체도 픽셀 격자가 맞지 않는 확대본이다(중간 행 런 길이 1~4 혼재, 근사색 `#D78136`/`#D98236` 다수).
따라서 어떤 생성 경로를 쓰든 §4-4 의 격자 정리 단계가 빠질 수 없다.

### 4-1. 규격

| 항목 | 값 |
|---|---|
| 시점 | 정면(참고 이미지). v2 의 위에서 본 시점은 폐기. 책상이 캐릭터 앞(아래)에 놓이므로 앉은 자세에서는 다리가 가려진다 |
| 셀 | **96×96 px**(2026-09-10 시연으로 64 에서 개정 — 손·키보드가 살아남는 최소 크기). 소품(커피·zzz·땀) 여백 포함. 앵커는 좌석 기준 (48, 90) |
| 표시 | CSS 96 px + `image-rendering: pixelated`. 레티나에서는 브라우저가 정수 2배로 올린다. 좌석표 의자 칸은 96 px |
| 팔레트 | 외곽선 1 + 피부 3톤 + 머리카락 3톤 + 상의 3톤 + 바지 2톤 + 소품 고정색. 피부·머리카락·상의·바지는 **키 색**(정본 값 고정)이고 런타임에 에이전트별로 치환한다 |
| 정체성 | 에이전트 이름 해시 → 머리 모양 6 × 머리색 6 × 상의색 6 × 피부 3. 같은 에이전트는 늘 같은 사람 |

### 4-2. 파츠 분해 — 통짜 시트가 아니라 부품 조립

프레임을 캐릭터 통짜로 그리면 (상태 8 × 프레임 4~6) × 머리 모양 6 = 200장이 넘고, 생성 이미지 특유의 프레임 간
어긋남을 매 장 손봐야 한다. 대신 **부품을 한 번 그리고 프레임은 조합표로 만든다.**

| 파츠 | 수 | 비고 |
|---|---|---|
| 머리(피부) | 1 | 표정 레이어 3: 뜬 눈 · 감은 눈 · 졸린 눈+입 |
| 머리카락 | 6 | 정면, 머리 위에 얹는 레이어. 머리가 1 px 까딱이면 같이 이동 |
| 몸통(상의, 앉은 정면) | 1 | 바지는 앉은 자세에서 대부분 가려진다 |
| 팔 포즈 | 11 | 타이핑 2 · 커피 3(들기/마시기/내리기) · 기지개 2 · 서류 2 · 무릎 1 · 화이트보드 · 돋보기 · 빗자루 |
| 전신 걷기 | 4 | STANDBY 순찰 전용. 유일하게 서 있는 자세 |
| 소품 | 12 | 모니터(켬/끔/깜빡) · 키보드 · 의자(빈/등받이) · 커피잔 · 화이트보드 · 돋보기+체크 · 빗자루 · 서류 · zzz 3단계 · 땀방울 · 물음표 |

프레임 = `{파츠 id, 오프셋(dx, dy)}` 목록. 픽셀 아트는 회전·확대를 쓰지 않고 **위치 이동과 파츠 교체**만으로 움직인다.

- 정의: 공용 `assets/sprites/animations.json` + 캐릭터별 `assets/sprites/<char>/character.json`(§4-4 확장 절).
- 빌드: Python 스크립트(`scripts/sprites/*.py`)가 캐릭터별 동작 스트립 `public/sprites/<char>/<동작>.png` + `manifest.json` 을 굽는다. (초안의 `build.mjs`·아틀라스 1장 방식은 쓰지 않았다 — 2026-09-14 정정)
- 런타임: 아틀라스를 에이전트 팔레트로 한 번 재색칠(canvas, 정체성별 캐시, blob URL)한 뒤 CSS `steps(n)` 으로
  `background-position` 을 옮긴다. JS 타이머 없이 GPU 합성이라 책상 60개 이상에서도 가볍다.
  `prefers-reduced-motion` 이면 정지 프레임.

### 4-3. 상태별 애니메이션 — 전부 별도

| 상태 | 애니메이션 | 프레임 · 속도 | 소품 |
|---|---|---|---|
| ACTIVE · build | 타이핑(팔 2교대) + 머리 1 px 까딱 | 4f · 8fps | 모니터 깜빡(2f 별도 루프) · 키보드 |
| ACTIVE · design | 책상 옆 화이트보드에 쓰기 | 4f · 6fps | 화이트보드 |
| ACTIVE · verify | 돋보기 들여다보기 → 체크 | 4f · 4fps | 돋보기 · 체크 |
| ACTIVE · refactor | 빗자루질 | 4f · 6fps | 빗자루 |
| STALE | 졸기: 고개 숙임 + zzz 3단계 상승 | 4f · 2fps | zzz · 물음표(30초마다 1회) |
| OFFLINE | 없음(정지) | 1f | 빈 의자 · 모니터 꺼짐 |
| IDLE(승인 대기) | 커피 마시기 / 기지개 / 둘러보기(의자 돌리기 대체)를 10초 주기로 무작위 교체 | 6f·4fps / 6f·4fps / 6f·3fps | 커피잔 |
| REJECTED | 서류 들추기 + 땀방울 | 4f · 6fps | 서류 · 땀 |
| READY | 없음 | 1f | 빈 의자(점선) |
| DONE | 캐릭터 없음 | 1f | 빈 의자 |
| STANDBY(층) | 순찰 걷기(층 헤더 통로 좌우 왕복) — 미제작, 서 있는 기준 그림 필요 | 4f · 8fps | — |

### 4-4. 제작 경로 — Gemini 는 디자인과 키 포즈, 프레임은 스크립트

이미지 생성 모델이 잘하는 것과 못하는 것을 나눠 쓴다. 잘하는 것은 참고 이미지를 붙여 같은 캐릭터를 여러 자세로 뽑는 일과
스타일 유지다. 못하는 것은 픽셀 격자를 정확히 맞추는 일, 프레임 사이 픽셀 단위 일관성, 지정 해상도(48 px) 출력이다.

1. **Gemini 이미지 생성(참고 이미지 첨부)** 으로 파츠 시트를 뽑는다(프롬프트 §8-A). 캐릭터 1명을 파츠별로 분리해 격자 칸에
   배치한 한 장이며 머리카락 6종도 같은 장에 넣는다. 이어서 §8-B 로 상태별 키 포즈 스트립(4칸)을 뽑아 팔 포즈·소품의
   참고로 쓴다. 배경은 마젠타(`#FF00FF`) 단색을 요구해 추출을 쉽게 한다. 결과가 흐리면 같은 프롬프트로 2~3회 다시 뽑는
   편이 손보정보다 싸다.
2. **정리 스크립트**(Python Pillow, `scripts/sprites/clean.py`): 키 색 배경 제거 → 격자 피치 추정(행·열 런 길이 최빈값) →
   최근접 다운샘플 → 정본 팔레트로 양자화(피부·머리카락·상의는 키 색으로 강제) → 셀 분할·앵커 정렬 → 파츠 PNG 저장.
3. **손보정**: Pixelorama(무료, MIT) 또는 Aseprite(유료). 생성 결과에서 어긋난 픽셀만 고친다. 파츠 35장 기준 2~4시간 예상.
   모니터·의자·키보드·zzz·땀방울 같은 단순 소품은 생성하지 않고 코드로 직접 찍는다.
4. **조립 스크립트**(`scripts/sprites/build.mjs`): 파츠 + `anim.json` → 아틀라스. 애니메이션 미리보기 페이지를 같이 만들어
   프레임 조합과 속도를 눈으로 조정한다.

대안: 픽셀 아트 전용 생성 서비스(Retro Diffusion 류)는 격자가 맞는 출력을 내므로 2단계 부담이 줄지만 별도 유료다.
Gemini 결과의 정리 부담이 크면 그때 검토한다. 공개 스프라이트 팩(LPC · Kenney 등)은 참고 이미지의 블록형 정면 스타일과
맞지 않아 쓰지 않는다.

**실측(09-10 오후, Antigravity 가 뽑은 모니터봇 프레임 4장 — 원본은 폐기, 기준 그림만 `assets/sprites/<char>/source.png` 로 보관)**: Gemini 에 프레임 4장을 따로 뽑게 한 결과, 프레임마다 몸 위치가
어긋나고 오른쪽 모니터가 생겼다 사라졌다 했다. 64px 기준 프레임 간 차이 픽셀 46~66%, 512px 원본은 같은 색 런 길이 최빈값이
1 이라 픽셀 격자 자체가 없다. **결정: 애니메이션 프레임은 Gemini 에서 만들지 않는다.** Gemini 는 캐릭터당 기준 그림 1장만 뽑고,
그 1장을 격자 정리 → 레이어 분해(머리·팔·몸통·소품) → 오프셋·파츠 교체로 프레임을 리포 안에서 만든다(§4-2 그대로).
소품(모니터·키보드·커피·zzz)은 생성 이미지에 넣지 않고 우리가 따로 그려 합성한다. 화면 얼굴 캐릭터(모니터 머리·돔 로봇)는
표정이 화면 픽셀이라 파츠 편집이 가장 쉽다. 사람·고양이 캐릭터는 얼굴 구조를 유지해야 해서 손보정이 더 든다.

**시연(09-10, 모니터봇)**: `scripts/sprites/clean.py`(박스 축소 → 알파 이진화 → 22색 양자화, 96px) +
`assets/sprites/monitor_bot/anim.json`(머리·양손·눈 사각형 5개) + `scripts/sprites/animate.py`(이동·깜빡임 → 시트) 로
타이핑 4 프레임을 만들었다. 프레임 간 차이 0.3~8.9%(Gemini 생성은 46~66%). 결과 `public/sprites/monitor_bot/typing.png`,
비교 페이지 https://claude.ai/code/artifact/3b77dd5a-021e-4bbf-94b6-2360d8d74036 . 셀 크기는 64 보다 96 이 손·키보드가 살아
96 으로 간다(§4-1 의 64 는 이 결과로 개정).

**확장(09-10, 캐릭터 4종 × 동작 9종)**: 조합표를 공용 `assets/sprites/animations.json` 으로 빼고 캐릭터별
`assets/sprites/<char>/character.json`(파츠 5개 · 앵커 11개 · 색)만 다르게 두는 구조로 바꿨다. 연산은 move · raise(소매 막대) ·
move_to/raise_to/raise_lerp(앵커 기준) · blink · prop · fill. 소품은 `scripts/sprites/props.py` 의 ASCII 픽셀 맵(머그·김·zzz·서류·
땀·돋보기·체크·빗자루·먼지·화이트보드·마커·물음표·공용 빈자리). 동작: typing · design · verify · refactor · stale · idle_coffee ·
idle_stretch · idle_look · rejected. 결과 `public/sprites/<char>/<동작>.png` + `manifest.json`, 빈자리 `public/sprites/empty.png`.
갤러리: https://claude.ai/code/artifact/50093aab-c8c1-45b7-bcef-2dfd0f3625fc . 남은 것: STANDBY 순찰 걷기(서 있는 기준 그림 필요), 의자 돌리기(뒷모습
없음 → 둘러보기로 대체), 소매 막대가 몸통을 가로지르는 프레임(cup·chest 앵커를 손에서 20px 안쪽에 두면 완화).

이 단계는 화면 껍데기 교체이지 데이터 경로와 무관하다. **다만 1~3 의 자산 제작은 코드와 독립이라 S1~S3 와 병행해
지금부터 시작해도 된다.**

## 5. 데이터 경로

### 5-1. 진행 중 heartbeat — 서버로 **계속** 보고해야 한다

진행 중 상태를 외부가 알려면 에이전트가 살아 있다는 신호가 **주기적으로 서버에 닿아야** 한다. 현재는 Phase 완료
시점의 progress 25/60/85 뿐이라 Phase 하나(수십 분)가 통째로 침묵 구간이다.

**현행 API 로 heartbeat 를 흉내 내면 안 되는 이유** (2026-09-10 `report/route.ts` 실측):
`kind=progress` 재보고는 같은 percent 면 WBS 반영은 no-op 이지만 **`agent_work_reports` 행을 매번 insert** 하고
progress 스냅샷을 찍는다. 1분 heartbeat 면 시간당 60행이 승인 화면의 보고 이력에 쌓인다. 리허설 1회는 허용해도
운영 경로로는 부적합하다.

**제안: 전용 heartbeat 경로** (서버 변경 소).
- `POST /api/v1/agent/work/{id}/heartbeat` — body `{ agent, phase, host?, note? }`. PAT `work:claim` 스코프.
- 효과: `agent_work_orders.updated_at` touch(이미 "보드의 활동 시각"으로 쓰는 열) + 새 열 `last_heartbeat_at`,
  `heartbeat_phase`, `heartbeat_agent`. **보고 행·스냅샷·알림 없음.** status 가 `claimed` 가 아니면 409.
- 마이그레이션 1건(열 3개, `_rollback.sql` 동봉, 스테이징 리허설·G4 트레일러 규칙 적용).
- `dflow.sh heartbeat <ref> [--phase p] [--agent a]` 추가. `list`/`show` 응답에 `last_heartbeat_at` 노출.

**누가 보내나** — 두 층을 겹친다.
1. **활동 heartbeat(주 신호)**: Claude Code 훅. Phase 서브에이전트가 도구를 쓸 때마다(PostToolUse) 훅 스크립트가
   현재 브랜치 `agent/<TSK>` → `docs/tasks/<TSK>/state.json` → order id 를 읽어 **60초에 1회로 절제해** heartbeat 를
   보낸다(마지막 전송 시각은 `docs/tasks/<TSK>/.hb` 파일). 죽거나 멈춘 에이전트는 도구 호출이 없으므로 heartbeat 도
   멈춘다 — 타이머와 달리 **"살아 있다"가 실제 활동의 증거**가 된다. 훅은 fire-and-forget(curl `--max-time 1.5`),
   출력 없음, 실패는 무시. 글로벌 훅에는 이미 Orca 훅이 `*` 매처로 걸려 있어 병합 공존한다.
2. **Phase 경계 이벤트(보조 신호)**: dflow-dev 가 Phase 진입·종료 시 `dflow.sh heartbeat --phase` 를 1회 명시 호출.
   Phase 종료 시 progress 25/60/85 보고는 지금 그대로.
- 타이머형 백그라운드 heartbeat(`run_in_background` 로 N초마다 핑)는 **채택하지 않는다.** 멈춘 에이전트도 살아 있는
  것처럼 보이게 만들어 §1 의 문제를 가린다.

### 5-2. 이벤트 로그(로컬)

훅과 dflow-dev 가 같은 한 줄 스크립트로 `~/.dflow/events.jsonl` 에도 append 한다.
`{ts, host, repo, tsk, order, phase, event, agent}`. 서버가 죽어도 로컬 사후 분석이 되고, Buzz 게시의 입력이 된다.
poll.sh 의 exit 분기(0 발견 · 9 승인 · 10 반려 · 8 종료)도 여기 적는다.

### 5-3. Buzz 게시

`~/.local/bin/buzz`(Buzz.app 0.5.10 번들) 로 **게시만** 한다(외부 에이전트는 수신 불가 — block/buzz #2663).
- 세션·러너마다 Nostr 키 1개, `buzz agents` 로 owner 승인. 채널 `#dflow-agents`.
- Phase 진입·완료·승인 대기·반려는 TSK 스레드에 `buzz messages send --reply-to`. heartbeat 는 게시하지 않는다(소음).
- `buzz users set-status "TSK-xx · build 60%"` 로 프로필 상태줄 갱신, 세션 종료 시 `set-presence offline`.
- `buzz canvas set --content -` 로 채널 canvas 에 좌석표 markdown 요약(층별 카운트 + 확인 필요 목록)을 갱신.
- 승인·반려는 계속 D'Flow 웹에서 한다. 모바일 앱(iOS/Android)에서는 읽기만.

### 5-4. 화면(D'Flow 웹)

- 새 페이지 `/agents`(슈퍼유저·프로젝트 관리자) 또는 프로젝트 페이지 탭. 데이터는 `agent_work_orders` +
  `wbs_items`(WP 계층) + `last_heartbeat_at` 하나의 조회. 30초 폴링이면 충분하다(실시간 소켓 불필요).
- 목업 v2 의 구성을 그대로 옮긴다: 상단 4 카운터(Active/Standby/Idle/Offline), "확인 필요" 띠, 층→구역→책상,
  우측 상세 패널(Phase 사다리 · 에이전트 · 브랜치 · 마지막 이벤트 · heartbeat · 근거 3곳 · 웹/Buzz 링크).
- STANDBY 는 poll.sh 가 서버에 기록을 남기지 않으므로 v1 에서는 표시하지 않거나, poll.sh 가 주기마다
  `PUT /agent/watch` 류로 자기 존재를 알리는 추가 계약이 필요하다(미결).

## 6. 단계

| 단계 | 내용 | 검증 |
|---|---|---|
| S0 (완료) | 목업 v2 아티팩트 | 사용자 확인 |
| S1 | heartbeat 마이그레이션 + API + `dflow.sh heartbeat` + 훅 스크립트 + dflow-dev Phase 경계 호출 | 스테이징에서 mes-runlog 리허설 1건, `last_heartbeat_at` 갱신 확인 |
| S2 | D'Flow 웹 좌석표 페이지(SVG 사람) | 스테이징 URL 눈확인 후 main |
| S3 | Buzz 게시(스레드·상태줄·canvas) | 모바일 앱에서 확인 |
| S4 | 비트맵 스프라이트 + 상태별 애니메이션(§4) | 화면 껍데기 교체. 자산 제작(§4-4 의 1~3)은 코드와 독립이라 S1 과 병행 가능 |

## 7. 미결

- 러너 개정과 묶어서 갈지(§5-1 의 heartbeat 계약은 러너의 "침묵 실패 검출"과 같은 것이다).
- STANDBY(poll.sh 존재)를 서버에 어떻게 알릴지.
- Buzz 채널·키 발급(owner 승인)과 릴레이 좌표.
- Gemini 파츠 시트의 격자 정리 부담이 감당할 수준인지. 1회 시험 생성 뒤 판단하고, 크면 픽셀 전용 생성 서비스를 검토한다.
- 임계값(5분/30분)과 훅 절제 주기(60초)의 운영 조정.

## 8. 부록 — Gemini 이미지 생성 프롬프트 (§4-4 의 1단계)

두 프롬프트 모두 **참고 이미지(`2026-09-10-agent-seatmap-sprite-reference.png`)를 첨부**한 상태로 보낸다.
이미지 모델은 영어 지시를 더 정확히 따르므로 원문은 영어로 두고, 아래에 한국어 해설을 붙였다.
출력 크기는 가장 큰 옵션을 고르고, 결과가 흐리거나 격자가 무너지면 같은 프롬프트로 다시 뽑는다.

### 8-A. 파츠 시트

```text
Pixel art character PARTS sheet, front view, in exactly the same style, proportions and outfit as the attached reference
character: big blocky head, 1-pixel dark outline, flat colors with 3-tone shading, no anti-aliasing, no gradients, no shadows.
Render every art pixel as a crisp 16x16 block so the image can be downscaled 16x without blur.

Layout: a grid of 128x128 cells separated by thin gray guide lines. Inside every cell the background is flat magenta #FF00FF.
Nothing may cross a cell border. No text, no labels.

Row 1 - head only, no hair, three cells: eyes open / eyes closed / sleepy half-closed eyes with an open mouth.
Row 2 - six different hairstyles drawn alone (short crop, side part, bob, bun, curly, spiky), each sized to sit on the head
        from row 1. Hair color brown.
Row 3 - torso only, seated, wearing the reference jacket and shirt, no arms, no head.
Row 4 and 5 - PAIRS OF ARMS only, one pose per cell, ten cells: hands on keyboard (down) / hands on keyboard (raised) /
        holding a coffee cup at chest height / cup raised to the mouth / both arms stretched straight up / holding papers /
        hands resting on the lap / writing on a whiteboard to the right / holding a magnifying glass / holding a broom.
Row 6 - full body standing, side view walking to the right, four walk-cycle frames.

Use exactly these flat colors and nothing else:
skin #F0A868 #D78136 #A85E22, hair #6B4423 #4A2E1E #2A1B12, jacket #C98A4B #A66A30 #7A4B1E, shirt #E88AA0,
pants #3A4A7A #2A3560, outline #1A1420, props gray #9AA0A8 #5C636B.
```

해설: 1행 머리 3표정, 2행 머리 모양 6종, 3행 몸통, 4~5행 팔 포즈 10종, 6행 순찰 걷기 4프레임. 색을 고정하는 이유는
정리 스크립트가 피부·머리카락·상의를 색으로 분류해 키 색으로 치환하기 때문이다. 재킷·셔츠 색은 참고 이미지 기준이며
런타임 팔레트 치환 대상이라 정확할 필요는 없다.

### 8-B. 상태별 키 포즈 스트립 (상태마다 1회)

```text
Same character as the attached reference, same pixel art style: front view, big blocky head, 1-pixel dark outline, 3-tone
flat shading, no anti-aliasing. Every art pixel is a crisp 16x16 block. Flat magenta #FF00FF background.

Draw ONE horizontal strip of four 128x128 cells separated by thin gray guide lines. The character sits at a desk seen from
the front; the desk edge hides the legs. Between cells only the arms, the head tilt, the facial expression and the prop
change. Body position, size, outfit and colors stay identical in all four cells. No text.

Cells, left to right: {POSE_1} / {POSE_2} / {POSE_3} / {POSE_4}
```

`{POSE_n}` 자리에 아래 표의 네 칸을 넣는다.

| 상태 | POSE_1 | POSE_2 | POSE_3 | POSE_4 |
|---|---|---|---|---|
| ACTIVE · build | hands on keyboard, down | hands raised above keyboard | head tilted slightly right, hands down | hands raised |
| ACTIVE · design | turned to a whiteboard on the right, marker touching board | marker slightly higher | marker lower | looking at the board, marker down |
| ACTIVE · verify | holding a magnifying glass over papers | glass closer to the face | glass over papers, eyes narrowed | a big green check mark above the desk |
| ACTIVE · refactor | holding a broom to the left | broom sweeping center | broom to the right | broom center, small dust puff |
| STALE | sitting upright, eyes half closed | head nodding forward | head down, eyes closed, a small "z" | head down, "zZ" rising |
| IDLE · coffee | coffee cup on the desk, hands on lap | lifting the cup | cup at the mouth, eyes closed | lowering the cup |
| IDLE · stretch | hands on the desk | arms half raised | both arms straight up, eyes closed | arms back down, relaxed |
| IDLE · spin | facing front | turned 45 degrees right, chair back visible | facing away, only chair back and hair visible | turned 45 degrees left |
| REJECTED | holding papers, looking at them | flipping a page | papers close to the face | papers down, one sweat drop on the forehead |

해설: 이 스트립은 그대로 프레임이 되기보다 §4-2 파츠(팔 포즈·소품·표정)의 참고로 쓴다. 특히 의자 돌리기(IDLE · spin)와
순찰 걷기는 파츠 조합으로 만들기 어려우므로 이 스트립을 정리해 통짜 프레임으로 넣는다.

### 8-C. 정리 스크립트 입력 규약

- 입력: 8-A/8-B 결과 PNG. 배경 `#FF00FF` ± 허용 오차 40, 안내선 회색은 배경으로 간주.
- 격자 피치: 행·열 방향 동일 색 런 길이의 최빈값. 요구한 16 에서 크게 벗어나면(±4 초과) 경고 후 사용자 확인.
- 출력: 파츠별 PNG(투명 배경, 팔레트 인덱스 PNG), 셀 좌표와 앵커를 담은 `parts.json`.

### 8-D. 좌석별 4종 다각화 캐릭터 에셋 목록 (2026-09-10 구현)

좌석표의 시각적 재미와 다양성을 위해 4가지 개별 에이전트 캐릭터의 4프레임 애니메이션 및 스프라이트 시트를 일괄 제작했다.
에셋 저장 위치: `public/sprites/chars/`, `docs/superpowers/specs/sprites/chars/`
미리보기 뷰어: `public/sprites/preview.html` (4인 좌석 배치 시뮬레이션 포함)

1. **`char1_monitor_bot` (CRT 모니터봇)**: 8 FPS (125ms), 매트릭스 코드 스크롤 및 안테나 점등
2. **`char2_cat_dev` (픽셀 냥이 개발자)**: 6 FPS (166ms), 귀 쫑긋 빠른 타건 및 물고기 머그잔 음미
3. **`char3_human_dev` (인간형 테크 개발자)**: 6 FPS (166ms), 넥밴드 헤드폰 착용 비트 코딩
4. **`char4_dome_bot` (미니 돔 안드로이드)**: 4 FPS (250ms), 넥타이 셔츠 룩, 안테나 점등 윙크 및 오일 시음

## 9. 검토 — D'Flow 안에서 가상 오피스 중계가 되는가 (2026-09-10)

조사는 Sonnet 5 에이전트 둘(데이터·API / 화면·배포)이 읽기 전용으로 했다. 결론: **된다. 다만 두 단계로 나뉜다.**
heartbeat 없이도 좌석표는 뜨지만 "업무 중/무응답/끊김" 구분과 Phase 별 동작은 S1 이 있어야 한다.

### 9-1. 지금 있는 것 / 없는 것

| 필요 데이터 | 상태 | 근거 |
|---|---|---|
| 주문 status(ready/claimed/reported/approved/cancelled) | 있음 | `supabase/migrations/0057_agent_work_loop.sql:25` |
| 반려 판정 | 파생 | status=claimed + 최신 completion 보고 `review_action=reject` (`src/app/actions/agentWork.ts` reject 경로) |
| 활동 시각 | 근사치 있음 | `agent_work_orders.updated_at` 을 claim·보고·승인·반려 때마다 touch. Phase 안 침묵은 못 잡음 |
| heartbeat 시각 · Phase | 없음 | 서버 어디에도 없음. `wbs_items.actual_pct` 의 25/60/85 는 스킬 관례일 뿐 |
| 주문 → 항목 → WP → 프로젝트 | 파생 | `wbs_item_id` FK + `parent_id` 체인 + 프로젝트 `levelLabels` 로 "WP" depth 결정(`src/lib/domain/levelSettings.ts`). "WP" 열은 없다 |
| 프로젝트 전체 주문 조회 함수 | 없음 | `getAgentOrderForItem(itemId)` 항목 단위뿐. 조인 쿼리 신설 필요 |
| 목록 API 의 updated_at | 없음 | `GET /api/v1/agent/work` 응답에 미노출. 페이지는 서버 컴포넌트가 DB 를 직접 읽으므로 API 확장은 불필요 |
| 갱신 방식 | 선례 있음 | Supabase Realtime `postgres_changes` 와 `setInterval` 둘 다 리포 안에 있음. 30초 폴링이면 충분 |
| 스프라이트 서빙 | 됨 | `middleware.ts` 가 png 를 인증 리다이렉트에서 제외. `public/sprites/` 320 KB, Vercel 기본 캐시 |

### 9-2. 페이지 형태 결정

- 위치: 전역 `src/app/(app)/agents/page.tsx`. 층 = 프로젝트라 프로젝트 탭보다 전역이 맞다. 게이트는 `usage/page.tsx` 방식
  (`getActorForView()` → 순수 판정 함수 → 아니면 redirect). 판정은 "슈퍼유저 또는 관리자인 프로젝트가 1개 이상",
  층 목록은 그 프로젝트들. 판정 함수는 `src/lib/authz/agentsAccess.ts` 로 새로 둔다(가드 3종 우회 아님).
- 구성: 서버 page 가 `agent_work_orders` + `wbs_items` + 최신 completion 보고를 `Promise.all` 로 읽어 초기 데이터를 넘기고,
  클라이언트 뷰(`src/components/agents/*`, **`src/components/app/*` 에 두지 않는다**)가 30초마다 서버 액션으로 재조회한다.
- 상태 판정은 순수 함수 `src/lib/domain/seatState.ts` 로 빼고 `tests/domain` 에 유닛 테스트를 둔다. 임계값 5분/30분은 여기 상수.
- 스프라이트: `public/sprites/<char>/manifest.json` 을 읽어 CSS `steps(n)` 으로 재생. `image-rendering: pixelated` 와
  `@keyframes` 는 리포에 선례가 없으니 컴포넌트 범위 CSS(모듈 또는 인라인 style)로 넣고 **`globals.css` 는 건드리지 않는다**.
  상태 변형(`dark:` `group-hover:` `data-[state]:`)과 display 유틸 조합 금지 — 안전망 테스트가 잡는다. 다크는 `.dark` 토큰.
- 사이드바 메뉴 추가는 `src/components/app/Sidebar.tsx` 를 건드리므로 그 커밋만 브랜치 + Preview(G2) 대상이다.
  1차는 메뉴 없이 URL 직접 진입으로 두고, 메뉴는 별도 커밋으로 붙인다.
- 캐릭터 배정: 에이전트 이름 해시 → 4종 중 하나. 팔레트 치환은 2차.

### 9-3. 단계별 도달 범위

| 단계 | 서버 변경 | 화면에서 구분되는 상태 | 동작 |
|---|---|---|---|
| S2-lite (S1 없이) | 없음. 조회 쿼리·페이지만 | READY · 업무 중(claimed, updated_at 근사) · IDLE(reported) · REJECTED · DONE(approved) | typing 고정 · idle 3종 · rejected · 빈자리 |
| S1 + S2 | 마이그레이션 0094(`last_heartbeat_at`·`heartbeat_phase`·`heartbeat_agent` + `_rollback.sql`, G4 스테이징 리허설) · `work/[id]/heartbeat/route.ts`(`resolveWriteActor` + `work:claim` 재사용) · `dflow.sh heartbeat` · PostToolUse 훅 | 위 + ACTIVE/STALE/OFFLINE 분리 | 위 + Phase 별 design/verify/refactor · stale 졸기 |

S2-lite 는 서버 계약을 바꾸지 않아 스테이징 눈확인 뒤 main 으로 갈 수 있다. S1 은 마이그레이션이라 별도 커밋과 리허설이 필요하다.
둘을 같은 커밋에 섞지 않는다(G1).

### 9-4. 남은 결정

- 갱신 방식: 30초 폴링으로 시작. heartbeat 가 60초 절제라 Realtime 은 이득이 작다. 필요해지면 `agent_work_orders` 채널 추가.
- STANDBY(poll.sh 존재)는 여전히 서버에 흔적이 없다(§7).
- 개요 번호(1.2.3) 자동 채번 함수는 못 찾았다. 좌석표는 `wbs_items.code` 를 그대로 쓴다.
