# 킥오프 프롬프트 — 총괄 (시스템별 배치 완료)

작성 2026-08-11. 각 구획을 해당 세션에 그대로 붙여 넣으면 착수된다.
**킥오프는 시스템(리포)별로 나뉘어 있다** — 그 세션이 여는 리포에 자기 몫이 있다:

| 시스템 | 킥오프 위치 | 내용 |
|---|---|---|
| wbs-web | 이 파일 ⓪·① | 알림함 · 연동 본편 |
| dev-plugin | `dev-plugin/docs/kickoff-dflow-toolchain.md` | 툴체인 DEV-02·03 (② — 아래 사본은 참고용, 그쪽이 정위치) |
| wbs-wsf 스킬 | `docs/superpowers/2026-08-11-kickoff-wbs-wsf.md` — ✅ **완료(2026-08-11)**: 실물 `~/.claude/skills/wbs-wsf/` (스크립트·레퍼런스 동봉 독립 패키지, 리포 밖) | 프로그램 리스트 어댑터(DEV-04) 반영·검증 완료 |

**실행 순서:**

```
⓪ 알림함 (wbs-web)          ← 선행. 팀장 진행
      ↓ 완료 후
① 연동 본편 (wbs-web)   ∥   ② 툴체인 (dev-plugin)   ∥   wbs-wsf 오버라이드 (dev-workflow)
      └─ Task 14(import)만 ②의 DEV-02 에 의존(과도기 우회 있음)
```

---

## ⓪ 알림함 — wbs-web 세션

```
알림함 구현 건입니다. docs/superpowers/plans/2026-08-11-notification-inbox.md 가 실행
문서입니다 — Task 1~8 순서대로, 각 Task에 코드·테스트·커밋 절차가 다 있습니다.
실행은 superpowers:subagent-driven-development (계획 헤더에 명시).

주의 3가지:
1. 마이그레이션(Task 1·8)은 단독 커밋(pre-push G1) + 적용은 Supabase Management API
   (supabase db push 금지). 0074 적용은 Task 3 이후 코드가 main 에 push 되기 전에.
2. Task 6·8의 HeaderChrome 변경은 ui/ 브랜치로 push 후 머지(pre-push G2).
   Preview 는 로그인 화면 검증이 안 되니 로컬 dev 에서 눈으로 확인.
3. Task 7의 CRON_SECRET 은 Vercel Production env 에 수동 추가
   (미설정 동안 라우트는 503 으로 안전).
```

---

## ① 연동 본편 — wbs-web 세션 (알림함 완료 후)

```
D'Flow × Claude Code 작업 연동 구현을 시작한다. 알림함 개발이 선행 완료된 상태다.

## 착수 전 확인 (5분)
1. git pull 후 존재 확인: src/lib/notify/emit.ts(emitNotification) ·
   supabase/migrations/0074_notification_inbox.sql. 없으면 알림함
   (docs/superpowers/plans/2026-08-11-notification-inbox.md)이 미완이므로 중단하고 보고할 것.
2. 정본 문서를 이 순서로 읽는다:
   - docs/superpowers/specs/2026-08-10-claude-code-work-integration-review.md (요약·결정 목록)
   - 같은 폴더 -appendix.md (구현 명세 정본 — 리졸버 §2.1, DDL §2.5, 선행 하드 차단 §2.9,
     알림 발행 §2.10, 로드맵 WP-00~07, 수용 기준)
   - docs/superpowers/plans/2026-08-10-dflow-agent-work-server.md (실행 문서 — Task 19개
     + 상단 "알림 발행 삽입 지점" 표)

## 실행 방식
superpowers:subagent-driven-development 로 계획의 Task 1(계약 동결)부터 순서대로.
착수 게이트 ⓪①②는 2026-08-10 결정 완료 — 재결정하지 말 것.
TSK-00-02(테스트 환경 실측)는 Task 9 이후 실배포 검증에만 필요 — Task 1~8은 vitest 로 진행 가능.

## 리포 절대 규칙
- 운영 D-CUBE 무훼손 — 로컬 dev 도 프로덕션 Supabase 공유. 운영 프로젝트를 agent_projects 에
  등록하지 않는다(미결 ⑤ — 별도 승인). AGENT_API_* 발급은 테스트 환경 전용(운영 Vercel env 금지).
- 마이그레이션 번호는 0069·0071·0072·0073 만 (0070·0074·0075는 선점됨). 단독 커밋(G1) ·
  _rollback.sql 동반 · 적용은 Supabase Management API(supabase db push 금지).
- git add -A 금지(파일명 명시 stage) · force push 금지 · HeaderChrome 1줄 변경(Task 8)은
  ui/ 브랜치 경유(G2).
- 보안 순서: 멤버십 게이트(Task 5)가 PAT 발급 액션(Task 8)보다 앞 커밋 — 어기면 토큰
  하나로 전 프로젝트가 샌다.
- 각 Task 가 "알림 발행 삽입 지점" 표에 있으면 emitNotification 호출을 반드시 포함 —
  핵심은 태스크 할당(work.assigned)·구현 시작(work.claimed)·완료 승인 대기(work.reported).

## 완료 기준
WP-06 통합 검증 — 수직 E2E(업로드→배정→자동 발행→claim→보고→PM 승인 + 각 단계 알림
검증·행위자 무발행·재업로드 중복 0건) · 보안 매트릭스 · 온보딩 10분 실측.
큰 단위 완료 시 npm run smoke:prod 후 npm run mark:good.

외부 의존: DEV-02(--export v2)·DEV-03(4단 정규식)은 dev-workflow 리포 몫 —
Task 14(import)는 DEV-02 미완이면 부록 §2.6의 과도기 변환기로 진행.
```

---

## ② 툴체인 — dev-workflow 리포 세션 (①과 병렬 가능)

```
~/project/dev-workflow 에서 dev 플러그인 툴체인 개선을 시작한다.
정본 계획: wbs-web 리포의 docs/superpowers/plans/2026-08-10-dev-workflow-toolchain.md
(코드 실행 검증 완료본 — MES 67노드 export 실측 포함)

우선순위:
1. DEV-02 wbs-parse.py --export 신설 — 계약 v2(전 계층 노드 + spec_sections + acceptance[]
   + priority 라벨). wbs-web 의 /wbs/import(Task 14)가 이 출력을 기다린다. 최우선.
2. DEV-03 wbs-validate·merge-wbs-status 의 TSK 정규식 세그먼트 무제한화(4단 ACT 지원) —
   MES 4단 WBS 가 첫 대상이라 필수.
3. 프로그램 리스트 입력 어댑터(DEV-04)와 wbs-wsf 로컬 오버라이드는 별도 계획:
   docs/superpowers/plans/2026-08-10-wbs-wsf-skill-local-changes.md

실행은 superpowers:subagent-driven-development. 상태 표기·6상태는 로컬에 구현하지 않는다
(DEV-01 스코프 아웃 — 상태 전이는 D'Flow stage 가 정본, 파일→DB는 부트스트랩 1회).
```
