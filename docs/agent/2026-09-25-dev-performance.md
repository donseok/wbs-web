# 개발 성능 관련 개선안 (효과가 큰 순서)

> `docs/idea.md` 에서 옮긴 상세(2026-09-25). 요약 한 줄은 idea.md 에 남아 있다.

## 남은 것

- 1·3·5·6 은 구현 완료 챕터로 옮겼다(2026-09-25). 남은 2·4 는 dmes-standard 리포 작업이다(테스트 설정·`gradle.properties`, 스킬의 `--no-daemon` 은 E2E·방언 예시 문구뿐).

2. MSSQL 컨테이너를 하나만 쓰기: Testcontainers 재사용(withReuse(true) + testcontainers.reuse.enable=true)을 쓰거나, 컨테이너 하나를 띄워 두고 워커마다 DB 를 나눠 쓰게 합니다. 이 작업은 dmes-standard 의 테스트 설정을 바꾸는 일입니다.
4. Gradle 제한: --no-daemon 을 풀고 데몬을 재사용하게 합니다. 대신 --stop 은 계속 금지합니다(전에 전역 데몬을 세웠던 사고 때문입니다). 여기에 org.gradle.workers.max 와 테스트 fork 수, 힙 크기에 상한을 둡니다.

## 완료분 (2026-09-25)

1. 무거운 검증을 PC 전체에서 줄 세우기: testAll, MSSQL 테스트, E2E 서버 같은 무거운 명령은 PC 전체에서 동시에 K개(예: 2개)까지만 돌게 하는 잠금 스크립트를 스킬에 넣습니다. 설계와 코딩은 6명이 병렬로 하고, 무거운 검증만 차례로 돌리는 방식입니다. 스킬만 고치면 되고 효과가 가장 큽니다. (구현됨: `dflow-dev/scripts/heavy.sh`)
3. 자원에 맞춰 팀원 수 정하기: 팀장이 새 팀원을 띄우기 전에 여유 메모리나 스왑 상태를 보고, 부족하면 띄우지 않게 합니다. 이 장비라면 동시에 3명 정도가 적정해 보입니다. (구현됨: `dflow-team/scripts/capacity.sh`)
5. 워커 세션을 가볍게 띄우기: 팀원 세션은 필요한 MCP 만 켜고 띄웁니다(예: --strict-mcp-config). E2E 용으로 띄운 서버는 끝나면 반드시 종료하는 규칙도 넣습니다. (구현됨: `--no-chrome --strict-mcp-config`, dflow-dev e2e.md 「서버 프로세스」)
6. 주간 사용량에 따라 90% 이상이 되면 최대 2개만 실행하도록 제한하고 95% 이상이 되면 더 이상 할당이 되지 않도록 수정 (구현: `capacity.sh usage`, `DFLOW_CAP_WEEKLY_*`, staging 9474997c)
