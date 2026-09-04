# dflow-work — 이동됨

정본은 `.claude/skills/dflow-work/` 다. 이 경로에 있던 사본(SKILL.md·README.md·scripts/dflow.sh·
references/)은 2026-08-12 이후 갱신되지 않아 정본과 갈라진 채 남아 있었고, 2026-08-28 에 지웠다.

여기를 심링크 대상으로 쓰지 말 것 — 옛 README 가 다음을 안내했지만 지금은 죽은 링크다.

```
ln -s .../wbs-web/docs/agent/claude-skill/dflow-work ~/.claude/skills/dflow-work   # 쓰지 말 것
```

설치는 둘 중 하나다.

- **배포 킷(표준)** — `dflow-kit` 의 `install.sh`. 대상 리포 안에 `.claude/skills/` 로 설치한다.
- **wbs-web 클론이 있으면** — `.claude/skills/dflow-work` 정본을 직접 링크한다.

이 파일은 옛 링크용 포인터이며 내용을 갖지 않는다(`../dev-discipline.md` 와 같은 처리).
