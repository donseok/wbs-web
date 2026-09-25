# 태스크 정보 뷰·에이전트 오피스·팀장 스킬 초기 기록

> `docs/idea.md` 에서 옮긴 상세(2026-09-25). 요약 한 줄은 idea.md 에 남아 있다.

- 태스크 정보 뷰에 대해 너무 복잡하다. (완)
  - 변경이력은 자리 너무 많이 차지 한다. 각 항목별로 한줄로 ... 
  - 변경이력 처음에는 최대 마지막 3개까지만 보이고 나머지는 접혀있는 것이 좋겠어.
  - 명세항목 개선필요 
  - 제일 처음 담당, 계획일정, 가중치, 산출물은 표형태로 단순하게
  - 담당, 단계는  축약해서 높이를 줄이자.에이전트 스튜디오 구현 — 정리본 · 스프라이트 참조 이미지 · [목업](https://claude.ai/code/artifact/2ab42176-327d-49e4-916c-bc089e6c0e13) · ⚠️ 착수 전 남은 확인 사항 필독 · 배경: 자율 러너 설계. **2026-09-14 착수** — 결정 1\~3 확정, v1 구현 스펙 2026-09-14-agent-office-v1-design.md(브랜치 `feat/agent-office`, 기점 staging). 좌석 식별 파일은 워크트리 루트 `.dflow-agent`.
  - 팀장 스킬 /dflow-team 구현 — D'Flow 에서 내게 배정되고 agent 태그가 붙은 ready 작업을 상시 폴링해 팀원 슬롯(기본 3, 상한 4)에 나눠 주고, 끝나면 다음 작업을 보충한다. 팀원은 **자기 서브에이전트를 띄울 수 있는 독립 세션**이며(Orca=pane, 그 밖=에이전트 팀 `isolation: worktree`), 각자 워크트리에서 `/dflow-dev --worker` 를 돈다. 기존 스킬은 수동 동작이 퇴행하지 않는 조건에서 원문도 고친다. 사용법 `/dflow-team [인원] <종료시각> [모델]`. 문서: 스펙 · 계획(Task 1\~10, 테스트 71건) · 남은 확인 사항 · 검토 원문 `superpowers/specs/reviews/`. 착수는 명시 지시 대기, 실행은 subagent-driven(계획서 "실행 준비" 의 `feat/dflow-team` 워크트리부터).
    - [ ] Task 1 `/dflow-dev` 원문 수정(claim 전 detach·exit 4 재시도·Phase 0-가 는 `/dflow-merge` 절차·reported 커밋·`api_base`)과 `--worker` 블록(행 A\~H), 보존 테스트
    - [ ] Task 2 `/dflow-merge` 원격 후보·보고 분기·충돌 되돌림·push 순서·뒷정리
    - [ ] Task 3 `references/worker-prompt.md` — 격리 확인·부트스트랩·인증 판정·`.result` 계약
    - [ ] Task 4 `references/backends.md`·`events.md` — Orca·에이전트 팀 spawn·정리·이벤트
    - [ ] Task 5 `SKILL.md` — 전제 검사·잠금·매 기상 재구성·poll 기동·결과 처리·승인 스윕·마감
    - [ ] Task 6 킷 배포 목록·권한 allow 병합·설치 안내·가이드(머지 없음)
    - [ ] Task 7 리허설 준비(bare 원격·스테이징 한정 PAT)와 A0 단독 실측(통과 전 Task 8·9 금지)
    - [ ] Task 8 Orca 백엔드 리허설
    - [ ] Task 9 에이전트 팀 백엔드 리허설과 권한 목록
    - [ ] Task 10 main·staging 머지와 적용 확인(사람 확인 후)
    - [ ] (후속) dev 플러그인(`~/project/dev-plugin`) hooks.json 로드 실패 수정 → tmux pane 백엔드
    - [ ] (후속) 좌석표 S1 에 `.dflow-agent`→heartbeat\_agent, `blocked` 상태, 팀장 STANDBY 신호 반영 요청 (스펙 §9)위임/승인
      - 위임.승인 페이지가 너무 허접하다. 체크 버튼도 너무 날것으로 보인다. 보기 좋은 데이터 테이블 형태로 보이게 해야 한다. (완료)
