# dflow-kit — D'Flow 에이전트 스킬 배포 킷

D'Flow(작업 관리) 와 Claude Code 를 잇는 스킬 묶음. **wbs-web 리포 없이** 어느 PC·어느 프로젝트 리포에서든
`/dflow-dev`, `/dflow-poll`, `/dflow-merge`, `/dflow-team`, `/dflow-wbs-nlevel`, `/dflow-export` 를 쓸 수 있게 한다.

정본은 wbs-web 리포 `.claude/skills/dflow-*` 이고 이 킷은 `scripts/kit-build.sh` 가 만든 산출물이다.
킷에서 스킬을 고치지 말 것 — 다음 빌드에 덮인다. 고칠 건 wbs-web 에.

## 설치 (PC 마다 1회, 프로젝트 리포마다 1회)

```bash
git clone git@github.com:jongik-sv/dflow-kit.git ~/dflow-kit
~/dflow-kit/install.sh ~/project/<내 리포>
```

install.sh 가 하는 일: 의존 명령 점검(git curl jq python3 gh) → `<리포>/.claude/skills/dflow-*` 복사 →
`.dflow`·`.dflow.local` 초안 + `.gitignore` 보강 → `.claude/settings.json` 에 워커 허용 목록 병합(git 은 이 PC 의 절대경로) → 다음 단계 안내.

그 다음 사람이 할 일:

1. D'Flow 웹 → `/account` "내 토큰" → PAT 발급
2. `<리포>/.dflow` 에 `api_base`(스테이징/운영)·`project_id` 기입(커밋 대상). `<리포>/.dflow.local` 에 `pats`·`dev_branch` 기입(개인, 커밋하지 않음). 토큰이 둘 이상이면 `.dflow.local` 의 `as=<prefix>`(내부적으로 `DFLOW_AS`) 로 이 리포의 키를 고정한다(prefix 는 `dflow.sh profiles` 로 확인. `/dflow-team` 은 비어 있으면 시작할 때 묻고 적는다)
3. 확인: `cd <리포> && .claude/skills/dflow-work/scripts/dflow.sh doctor`
4. Claude Code 를 **리포 루트에서** 연다 — 스킬은 프로젝트 스코프(`.claude/skills/`)라 cwd 가 리포 루트여야 한다

`.claude/skills/` 는 리포에 커밋하고 기본 브랜치에 push 한다(`/dflow-team` 팀원 워크트리는 `origin` 의 스킬을 쓴다). 팀원은 클론만으로 같은 스킬을 쓴다. `.dflow` 는 커밋하고 `.dflow.local` 은 커밋하지 않는다.

## 들어 있는 것

| 스킬 | 역할 |
|---|---|
| dflow-work | `dflow.sh` — D'Flow Agent API 래퍼(me/list/show/claim/progress/done/release/doctor). 다른 스킬의 기반 |
| dflow-dev | 작업 1건 개발 사이클(착수 판정→설계→TDD→검증→보고). 규율 정본 `references/dev-discipline.md` 동봉 |
| dflow-poll | `poll.sh` — 에이전트 위임(tags: agent) 작업 감시 → 자동 착수. 낮 시간 반자동 |
| dflow-merge | 승인된 작업 브랜치를 main 에 반영(조상 순서, --no-ff) |
| dflow-team | 팀장. 에이전트 위임 작업을 슬롯 N개 팀원(Orca pane 또는 별도 claude -p 프로세스)에게 나눠 동시에 개발시킨다. 낮 시간 supervised |
| dflow-wbs-nlevel | levels 계약 wbs.md 생성·검증. 계약 문서·골격 샘플 동봉 |
| dflow-export | wbs.md → import payload(v2.1). 기본 dry-run |

사용법과 대화 예시는 wbs-web `docs/agent/claude-skill/dflow-skills-guide.md`.

## 갱신

```bash
cd ~/dflow-kit && git pull && ./install.sh ~/project/<내 리포>
```

`doctor` 가 계약 버전 불일치를 알리면 이 절차로 갱신한다. `VERSION` 파일에 빌드 원본(wbs-web 커밋) 이 있다.

좌석표 heartbeat 훅(`~/.dflow/hooks/heartbeat.sh`)을 예전에 설치했다면 `.dflow`·`.dflow.local` 전환 뒤
`./install.sh ~/project/<내 리포> --hooks` 를 다시 돌려 훅도 갱신한다 — 예전 훅은 `.env` 만 읽어 새 방식
리포에서는 신호를 보내지 못한다.

## 의존

git · curl · jq · python3 · gh(GitHub CLI, `done --auto-links` 와 리포 생성용). macOS: `brew install jq gh`.

## Windows(Git Bash)

Git for Windows 의 Git Bash 에서 같은 `install.sh` 를 쓴다. 킷과 설치 대상의 `.gitattributes` 가 스킬 줄끝을
LF 로 고정한다(이미 CRLF 로 받은 클론은 `git add --renormalize .`). `.dflow`·`.dflow.local` 을 CRLF 로 저장해도 `dflow.sh`·
heartbeat 훅이 `\r` 을 걷어낸다. 네이티브 설치기(`irm https://claude.ai/install.ps1 | iex`)는 `~/.local/bin` 을
PATH 에 넣으라고 경고하므로 그대로 따른다. `/dflow-team` 은 `powershell.exe` 를 쓴다(프로세스 시작 시각·권한 감지).

## 좌석표 heartbeat 훅

D'Flow 좌석표(`/agents`)가 "진행 중/무응답/끊김"을 구분하려면 에이전트가 도구를 쓸 때마다 60초에 1회 신호가 서버에 닿아야 한다.
훅은 진행 중 작업(`docs/tasks/*/state.json` 의 phase 가 design/build/verify/refactor/rejected)이 있는 워크트리에서만 보내고,
`.dflow-agent` 가 없으면 `agent/` 브랜치에서만 보낸다. 기본 브랜치의 팀장 세션에서는 아무것도 보내지 않는다.

1. `./install.sh <리포> --hooks` → `~/.dflow/hooks/heartbeat.sh`
2. `~/.claude/settings.json` 의 `hooks.PostToolUse` 배열에 아래 원소를 추가한다(기존 원소는 그대로 둔다):
   ```json
   { "matcher": "*", "hooks": [ { "type": "command", "timeout": 5,
     "command": "if [ -x \"${HOME-}/.dflow/hooks/heartbeat.sh\" ]; then /bin/sh \"${HOME-}/.dflow/hooks/heartbeat.sh\"; else cat >/dev/null 2>&1 || :; fi" } ] }
   ```
3. 확인: 작업 리포에서 `/dflow-dev` 를 한 사이클 돌리며 D'Flow `/agents` 의 그 책상이 1~2분 간격으로 갱신되는지 본다.

끄기: settings.json 에서 위 원소를 지운다. 훅은 `.dflow.local` 의 첫 PAT 를 쓰고 토큰을 출력하거나 기록하지 않는다.

**중단**: D'Flow 화면에서 사람이 "중단" 을 누르면 서버가 그 주문의 heartbeat 에 `409 code=cancelled` 를 준다. 훅은 그때만
`~/.dflow/hb/<주문>.cancelled` 표식을 남기고 `{"continue": false, "stopReason": …}` 를 출력해 세션을 세우며, state.json 의
phase 를 `cancelled` 로 바꾼다. 표식이 남아 있는 동안은 60초 절제와 무관하게 매 도구 호출마다 다시 세운다. 반응은 최대
약 1분(절제 간격)이다. 네트워크 실패·다른 409·5xx 는 지금처럼 무시한다. `/dflow-team` 팀장은 spawn 직전에 서버 status 로 확인하고 낡은 표식을 지운다(서버가 `ready`·`claimed` 라고 말하는 주문의
표식). 수동 `/dflow-dev` 세션에서 같은 주문을 이어 가려면 사람이 표식 파일을 지운다.
