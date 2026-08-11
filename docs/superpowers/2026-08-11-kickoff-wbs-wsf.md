# 킥오프 — wbs-wsf 스킬 (프로그램 리스트 입력)

작성 2026-08-11. **스킬 수정 작업은 wbs-web 리포에서 관리한다**(사용자 결정 2026-08-11).
기존 로컬 오버라이드(`~/project/dev-workflow/.claude/skills/wbs-wsf/` — 6상태 버전)는
같은 날 **삭제됐다** — 6상태 로컬 실행이 WBS 중앙관리 결정으로 무의미해졌기 때문.
정본 구현 계획: `docs/superpowers/plans/2026-08-10-wbs-wsf-skill-local-changes.md`
(⚠️ 계획의 대상 경로가 "로컬 오버라이드"로 적혀 있다 — 착수 시 새 스킬 위치를 먼저 확정하고
계획 경로를 그에 맞춰 읽을 것. 후보: dflow-work 스킬과 같은 방식의 리포 정본 + `ln -s`).

---

```
wbs-wsf 스킬 개선을 시작한다.
정본 계획: docs/superpowers/plans/2026-08-10-wbs-wsf-skill-local-changes.md

전제(계획과 달라진 것):
- 기존 로컬 오버라이드(~/project/dev-workflow/.claude/skills/wbs-wsf)는 2026-08-11 삭제됐다.
  스킬을 새 위치에 만든다 — 위치는 사용자와 확정(권장: wbs-web 리포 정본
  docs/agent/claude-skill/wbs-wsf/ + ln -s ~/.claude/skills/wbs-wsf, dflow-work 스킬과 동일 방식).
- 6상태 로컬 워크플로우 서술은 넣지 않는다 — 상태 전이는 D'Flow stage(API)가 정본,
  wbs.md 생성 시 상태는 항상 [ ] (부트스트랩 전용).

핵심 변경:
1. 프로그램 리스트 입력 어댑터(DEV-04) — PRD/TRD 외에 프로그램 리스트
   (json/md/csv/xlsx/yaml)를 입력으로 받아 정규화 어댑터 1층으로 공통 스키마
   (모듈·프로그램ID·프로그램명·유형·난이도·담당)에 수렴.
2. 생성 규칙 — 모듈→ACT/WP, 프로그램 1개=Task 1개(수직 슬라이스 강제: 한 Task 안에
   백엔드+프론트, domain: fullstack, 화면 있으면 entry-point 필수. "OO화면 API"/"OO화면 UI"
   분리 Task 생성 금지), 유형→category/domain, 난이도→model·기간 추정.
3. assignee 시드 — 담당 컬럼을 wbs.md assignee(email)로 기록(D'Flow import 시 로스터 매칭).
4. 검증 — 필수 컬럼(모듈·ID·명)·ID 중복 검사, 매핑 실패 항목은 생략하지 않고 리포트.

실행은 superpowers:subagent-driven-development 로 계획 Task 순서대로.
```
