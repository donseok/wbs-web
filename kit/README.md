# dflow-kit — D'Flow 에이전트 스킬 배포 킷

D'Flow(작업 관리) 와 Claude Code 를 잇는 스킬 묶음. **wbs-web 리포 없이** 어느 PC·어느 프로젝트 리포에서든
`/dflow-dev`, `/dflow-poll`, `/dflow-merge`, `/dflow-wbs-nlevel`, `/dflow-export` 를 쓸 수 있게 한다.

정본은 wbs-web 리포 `.claude/skills/dflow-*` 이고 이 킷은 `scripts/kit-build.sh` 가 만든 산출물이다.
킷에서 스킬을 고치지 말 것 — 다음 빌드에 덮인다. 고칠 건 wbs-web 에.

## 설치 (PC 마다 1회, 프로젝트 리포마다 1회)

```bash
git clone git@github.com:jongik-sv/dflow-kit.git ~/dflow-kit
~/dflow-kit/install.sh ~/project/<내 리포>
```

install.sh 가 하는 일: 의존 명령 점검(git curl jq python3 gh) → `<리포>/.claude/skills/dflow-*` 복사 →
`.env` 초안 + `.gitignore` 보강 → 다음 단계 안내.

그 다음 사람이 할 일:

1. D'Flow 웹 → `/account` "내 토큰" → PAT 발급
2. `<리포>/.env` 에 `DFLOW_API_BASE`(스테이징/운영) · `DFLOW_PATS` · `DFLOW_PROJECT_ID` 기입
3. 확인: `cd <리포> && (set -a; . ./.env; set +a; .claude/skills/dflow-work/scripts/dflow.sh doctor)`
4. Claude Code 를 **리포 루트에서** 연다 — 스킬은 프로젝트 스코프(`.claude/skills/`)라 cwd 가 리포 루트여야 한다

`.claude/skills/` 는 리포에 커밋한다. 팀원은 클론만으로 같은 스킬을 쓴다. `.env` 는 커밋하지 않는다.

## 들어 있는 것

| 스킬 | 역할 |
|---|---|
| dflow-work | `dflow.sh` — D'Flow Agent API 래퍼(me/list/show/claim/progress/done/release/doctor). 다른 스킬의 기반 |
| dflow-dev | 작업 1건 개발 사이클(착수 판정→설계→TDD→검증→보고). 규율 정본 `references/dev-discipline.md` 동봉 |
| dflow-poll | `poll.sh` — 에이전트 위임(tags: agent) 작업 감시 → 자동 착수. 낮 시간 반자동 |
| dflow-merge | 승인된 작업 브랜치를 main 에 반영(조상 순서, --no-ff) |
| dflow-wbs-nlevel | levels 계약 wbs.md 생성·검증. 계약 문서·골격 샘플 동봉 |
| dflow-export | wbs.md → import payload(v2.1). 기본 dry-run |

사용법과 대화 예시는 wbs-web `docs/agent/claude-skill/dflow-skills-guide.md`.

## 갱신

```bash
cd ~/dflow-kit && git pull && ./install.sh ~/project/<내 리포>
```

`doctor` 가 계약 버전 불일치를 알리면 이 절차로 갱신한다. `VERSION` 파일에 빌드 원본(wbs-web 커밋) 이 있다.

## 의존

git · curl · jq · python3 · gh(GitHub CLI, `done --auto-links` 와 리포 생성용). macOS: `brew install jq gh`.
